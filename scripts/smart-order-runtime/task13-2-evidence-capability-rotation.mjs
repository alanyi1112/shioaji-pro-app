import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readPrivateSecret } from './private-storage.mjs';
import {
    createSmartOrderTask13_2FormalEvidence,
    verifySmartOrderTask13_2FormalEvidence,
} from './task13-2-formal-evidence.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './task13-2-evidence-capability.mjs';
import { SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_4_0_6_CURRENT_TRUST } from './task13-2-completed-evidence-trust.mjs';
import { writeTaskProbeWritePreflightEvidence } from './task-probe-write-preflight.mjs';

export const SMART_ORDER_TASK_13_2_EVIDENCE_CAPABILITY_ROTATION_SCHEMA_VERSION =
    'smart-order-task13.2-evidence-capability-rotation/2026-08-26.1';

const MAX_EVIDENCE_BYTES = 64 * 1024;
const FIXED_FILE_BY_KEY = Object.freeze({
    '0.4:order_deal_round_trip':
        'task13-2-formal-0.4-order-deal-round-trip.json',
    '0.6:lmt_rod': 'task13-2-formal-0.6-lmt-rod.json',
    '0.6:lmt_ioc': 'task13-2-formal-0.6-lmt-ioc.json',
    '0.6:mkt_ioc': 'task13-2-formal-0.6-mkt-ioc.json',
});

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readStablePrivateEvidence(filePath) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.uid !== process.getuid() ||
            (before.mode & 0o777) !== 0o600 ||
            before.size < 2 ||
            before.size > MAX_EVIDENCE_BYTES
        ) {
            throw new Error('Task 13.2 rotation source is not private evidence');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.byteLength !== before.size
        ) {
            throw new Error('Task 13.2 rotation source changed while reading');
        }
        return Object.freeze({
            artifactSha256: sha256(bytes),
            evidence: JSON.parse(bytes.toString('utf8')),
        });
    } finally {
        await handle.close();
    }
}

async function writeOrVerifyExact({ evidence, evidencePath }) {
    try {
        await writeTaskProbeWritePreflightEvidence({ evidence, evidencePath });
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
    }
    const stored = await readStablePrivateEvidence(evidencePath);
    const expectedBytes = Buffer.from(`${JSON.stringify(evidence)}\n`, 'utf8');
    try {
        if (stored.artifactSha256 !== sha256(expectedBytes)) {
            throw new Error('Task 13.2 rotated evidence fixed slot conflicts');
        }
    } finally {
        expectedBytes.fill(0);
    }
    return stored.artifactSha256;
}

export function rotateSmartOrderTask13_2EvidenceRecord({
    evidenceCapability,
    evidenceKey,
    legacyCapability,
    predecessor,
    predecessorArtifactSha256,
    trust,
}) {
    if (
        predecessorArtifactSha256 !==
            (trust?.predecessorArtifactSha256 ?? trust?.artifactSha256) ||
        verifySmartOrderTask13_2FormalEvidence({
            capability: legacyCapability,
            evidence: predecessor,
            expectedSourceFingerprintSha256: trust?.sourceFingerprintSha256,
            expectedVerifierFingerprintSha256:
                trust?.verifierFingerprintSha256,
        }).eligible !== true
    ) {
        throw new Error(
            `Task 13.2 rotation predecessor is invalid: ${evidenceKey}`,
        );
    }
    const {
        evidenceHashSha256: _evidenceHashSha256,
        evidenceHmacSha256: _evidenceHmacSha256,
        ...input
    } = predecessor;
    const rotated = createSmartOrderTask13_2FormalEvidence({
        capability: evidenceCapability,
        input,
    });
    if (
        verifySmartOrderTask13_2FormalEvidence({
            capability: evidenceCapability,
            evidence: rotated,
            expectedSourceFingerprintSha256: trust.sourceFingerprintSha256,
            expectedVerifierFingerprintSha256:
                trust.verifierFingerprintSha256,
        }).eligible !== true
    ) {
        throw new Error(`Task 13.2 rotated evidence is invalid: ${evidenceKey}`);
    }
    return rotated;
}

export async function rotateSmartOrderTask13_2EvidenceCapability({
    appSupportRoot,
} = {}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        (await realpath(appSupportRoot)) !== appSupportRoot
    ) {
        throw new TypeError('Task 13.2 rotation root is invalid');
    }
    const privateDirectory = await realpath(
        path.join(appSupportRoot, 'smart-order', 'private'),
    );
    const legacyCapability = await readPrivateSecret(
        path.join(privateDirectory, 'gate-probe-cli-capability.bin'),
    );
    const evidenceCapability =
        await readOrCreateSmartOrderTask13_2EvidenceCapability(privateDirectory);
    const rows = [];
    try {
        for (const [evidenceKey, trust] of Object.entries(
            SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_4_0_6_CURRENT_TRUST.operations,
        )) {
            const predecessorFileName =
                trust.predecessorFileName ?? trust.fileName;
            const predecessorArtifactSha256 =
                trust.predecessorArtifactSha256 ?? trust.artifactSha256;
            const predecessor = await readStablePrivateEvidence(
                path.join(privateDirectory, predecessorFileName),
            );
            const rotated = rotateSmartOrderTask13_2EvidenceRecord({
                evidenceCapability,
                evidenceKey,
                legacyCapability,
                predecessor: predecessor.evidence,
                predecessorArtifactSha256: predecessor.artifactSha256,
                trust,
            });
            const fileName = FIXED_FILE_BY_KEY[evidenceKey];
            const artifactSha256 = await writeOrVerifyExact({
                evidence: rotated,
                evidencePath: path.join(privateDirectory, fileName),
            });
            rows.push(
                Object.freeze({
                    evidenceKey,
                    fileName,
                    artifactSha256,
                    predecessorFileName,
                    predecessorArtifactSha256,
                    evidenceHashSha256: rotated.evidenceHashSha256,
                }),
            );
        }
        return Object.freeze({
            schemaVersion:
                SMART_ORDER_TASK_13_2_EVIDENCE_CAPABILITY_ROTATION_SCHEMA_VERSION,
            rotated: Object.freeze(rows),
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
    } finally {
        legacyCapability.fill(0);
        evidenceCapability.fill(0);
    }
}
