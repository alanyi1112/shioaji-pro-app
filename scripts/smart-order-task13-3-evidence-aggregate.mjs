#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { managedSmartOrderReadonlyProbeAppSupportRoot } from './smart-order-contract-probe.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './smart-order-runtime/task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_3_REQUIRED_PROFILES,
    SMART_ORDER_TASK_13_3_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS,
    aggregateSmartOrderTask13_3FormalEvidence,
    currentSmartOrderTask13_3SourceFingerprint,
    currentSmartOrderTask13_3VerifierFingerprint,
    verifySmartOrderTask13_3FormalEvidence,
} from './smart-order-runtime/task13-3-formal-evidence.mjs';
import { smartOrderTask0406FormalEvidenceFileName } from './smart-order-runtime/task0-4-0-6-operation-executor.mjs';

const MAX_BYTES = 64 * 1024;

async function readEvidence(filePath) {
    const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 2 ||
            before.size > MAX_BYTES ||
            (before.mode & 0o777) !== 0o600 ||
            before.uid !== process.getuid()
        ) {
            throw new Error('Task 13.3 evidence is not private');
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
            throw new Error('Task 13.3 evidence changed while reading');
        }
        return JSON.parse(bytes.toString('utf8'));
    } finally {
        await handle.close();
    }
}

export async function runSmartOrderTask13_3EvidenceAggregate({ appSupportRoot }) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('Task 13.3 aggregate root is invalid');
    }
    const root = await realpath(appSupportRoot);
    if (root !== appSupportRoot) {
        throw new Error('Task 13.3 aggregate root is not canonical');
    }
    const privateDirectory = await realpath(
        path.join(root, 'smart-order', 'private'),
    );
    const capability =
        await readOrCreateSmartOrderTask13_2EvidenceCapability(privateDirectory);
    try {
        const [sourceFingerprintSha256, verifierFingerprintSha256] =
            await Promise.all([
                currentSmartOrderTask13_3SourceFingerprint(),
                currentSmartOrderTask13_3VerifierFingerprint(),
            ]);
        const rows = [];
        for (const profile of SMART_ORDER_TASK_13_3_REQUIRED_PROFILES) {
            const fileName = smartOrderTask0406FormalEvidenceFileName({
                profile,
                runId: '00000000-0000-4000-8000-000000000000',
                operationId: '00000000-0000-4000-8000-000000000000',
            });
            try {
                const evidence = await readEvidence(
                    path.join(privateDirectory, fileName),
                );
                let verified = Object.freeze({ eligible: false });
                for (const expectedVerifierFingerprintSha256 of [
                    verifierFingerprintSha256,
                    ...SMART_ORDER_TASK_13_3_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS,
                ]) {
                    verified = verifySmartOrderTask13_3FormalEvidence({
                        capability,
                        evidence,
                        expectedSourceFingerprintSha256: sourceFingerprintSha256,
                        expectedVerifierFingerprintSha256,
                    });
                    if (verified.eligible) break;
                }
                if (verified.eligible) rows.push(verified);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
        }
        return aggregateSmartOrderTask13_3FormalEvidence(rows);
    } finally {
        capability.fill(0);
    }
}

async function main() {
    const result = await runSmartOrderTask13_3EvidenceAggregate({
        appSupportRoot: await realpath(
            managedSmartOrderReadonlyProbeAppSupportRoot(),
        ),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.eligible) process.exitCode = 1;
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        process.stderr.write(
            `smart_order_task13_3_aggregate=unavailable:${error?.name ?? 'Error'}\n`,
        );
        process.exitCode = 1;
    });
}
