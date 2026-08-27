import { createHash, randomUUID } from 'node:crypto';
import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_TRUST_SCHEMA_VERSION } from './smart-order-runtime/task13-2-completed-evidence-trust.mjs';
import {
    SMART_ORDER_TASK_13_2_EVIDENCE_CAPABILITY_FILE,
    readOrCreateSmartOrderTask13_2EvidenceCapability,
} from './smart-order-runtime/task13-2-evidence-capability.mjs';
import { currentSmartOrderTask13_2EvidenceSourceFingerprint } from './smart-order-runtime/task13-2-formal-evidence.mjs';
import {
    importSmartOrderTask13_2CompletedTask03Evidence,
    verifySmartOrderTask13_2CompletedTask03Lineage,
} from './smart-order-task13-2-completed-evidence-import.mjs';

const roots = [];
const nowEpochMs = Date.parse('2026-08-25T03:00:00.000Z');
const PREFLIGHT_SCHEMA =
    'smart-order-simulation-write-preflight-evidence/2026-08-23.1';
const PROOF_SCHEMA = 'smart-order-task-0.3-trigger-proof/2026-08-22.1';
const RESULT_SCHEMA = 'smart-order-task-0.3-event-trigger/2026-08-24.1';

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digest(label) {
    return sha256(label);
}

async function prepareRoot() {
    const root = await realpath(
        await mkdtemp(path.join(os.tmpdir(), 'task13-2-import-')),
    );
    roots.push(root);
    await chmod(root, 0o700);
    await mkdir(path.join(root, 'smart-order', 'private'), {
        recursive: true,
        mode: 0o700,
    });
    await chmod(path.join(root, 'smart-order'), 0o700);
    const privateDirectory = path.join(root, 'smart-order', 'private');
    await chmod(privateDirectory, 0o700);
    return { root, privateDirectory };
}

async function writePrivateJson(filePath, value) {
    await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function buildLineage({
    coordinationId = randomUUID(),
    sourceFingerprintSha256,
    proofSchema = PROOF_SCHEMA,
} = {}) {
    const sourceFingerprint =
        sourceFingerprintSha256 ??
        (await currentSmartOrderTask13_2EvidenceSourceFingerprint(
            '0.3:place_confirmed',
        ));
    const accountScopeSha256 = digest('fixed-account');
    const requestSha256 = digest(`request:${coordinationId}`);
    const envelopeSha256 = digest(`envelope:${coordinationId}`);
    const adjacentSimulationAttestationSha256 = digest(
        `adjacent:${coordinationId}`,
    );
    const createdAtEpochMs = nowEpochMs - 2_000;
    const observerDeadlineEpochMs = nowEpochMs + 30_000;
    const preflightContent = Object.freeze({
        accountIdentifiersPersisted: false,
        accountScopeSha256,
        accountType: 'S',
        adjacentSimulationAttestationSha256,
        apiGenerationSha256: digest('simulation-generation'),
        apiSimulation: true,
        automaticRetryAllowed: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        caLoaded: false,
        cleanupAllowed: false,
        cliAuthorizationSha256: digest(`authorization:${coordinationId}`),
        coordinationId,
        createdAtEpochMs,
        envelopeSha256,
        initialSimulationAttestationSha256: digest(
            `initial:${coordinationId}`,
        ),
        maskedAccountRef: `…${accountScopeSha256.slice(-12)}`,
        maximumQuantity: 1,
        modeExecutionLeaseEvidenceHash: digest(`lease:${coordinationId}`),
        modeMarker: 'simulation',
        operation: 'place',
        operationIdSha256: digest(`operation:${coordinationId}`),
        productionLoaded: false,
        quantityUnit: 'CommonLot',
        readinessCurrent: true,
        readinessDeadlineEpochMs: observerDeadlineEpochMs,
        readinessEvidenceSha256: digest(`readiness:${coordinationId}`),
        requestSha256,
        requestedQuantity: 1,
        schemaVersion: PREFLIGHT_SCHEMA,
        sharedModeLeaseHeld: true,
        sourceFingerprintSha256: sourceFingerprint,
    });
    const resultHash = sha256(canonicalJson(preflightContent));
    const preflight = Object.freeze({
        ...preflightContent,
        resultHash,
        evidenceHmacSha256: digest('historical-rotated-preflight-hmac'),
    });
    const resultEvidenceSha256 = digest(`result-evidence:${coordinationId}`);
    const tradeIdentitySha256 = digest(`trade:${coordinationId}`);
    const proof = Object.freeze({
        accountIdentifiersPersisted: false,
        accountScopeSha256,
        brokerWriteAttempted: true,
        confirmedAtEpochMs: nowEpochMs - 1_000,
        coordinationId,
        observerDeadlineEpochMs,
        proofHmacSha256: digest('historical-rotated-proof-hmac'),
        requestSha256,
        resultEvidenceSha256,
        schemaVersion: proofSchema,
        state: 'confirmed',
        tradeIdentitySha256,
    });
    const result = Object.freeze({
        accountIdentifiersPersisted: false,
        adjacentSimulationAttestationSha256,
        automaticRetryAllowed: false,
        boundedReconciliationCanConfirmOutcome: false,
        boundedReconciliationObservedMatches: null,
        brokerWriteAttempted: true,
        brokerWriteNetworked: true,
        cleanupAllowed: false,
        coordinationId,
        envelopeSha256,
        resultEvidenceSha256,
        schemaVersion: RESULT_SCHEMA,
        state: 'confirmed',
    });
    const ledger = Object.freeze({
        accountIdentifiersPersisted: false,
        accountScopeSha256,
        apiGenerationSha256: preflight.apiGenerationSha256,
        automaticRetryAllowed: false,
        brokerWriteAttempted: true,
        brokerWriteNetworked: true,
        cleanupAllowed: false,
        cliAuthorizationSha256: preflight.cliAuthorizationSha256,
        coordinationId,
        envelopeSha256,
        initialSimulationAttestationSha256:
            preflight.initialSimulationAttestationSha256,
        modeExecutionLeaseEvidenceHash:
            preflight.modeExecutionLeaseEvidenceHash,
        requestSha256,
        schemaVersion: RESULT_SCHEMA,
        state: 'dispatching_unknown_no_retry',
    });
    const trust = Object.freeze({
        schemaVersion:
            SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_TRUST_SCHEMA_VERSION,
        evidenceKey: '0.3:place_confirmed',
        coordinationId,
        requestSha256,
        sourceFingerprintSha256: sourceFingerprint,
        preflightResultHash: resultHash,
        resultEvidenceSha256,
        tradeIdentitySha256,
        artifactSha256: Object.freeze({
            ledger: digest('ledger-artifact'),
            result: digest('result-artifact'),
            preflight: digest('preflight-artifact'),
            proof: digest('proof-artifact'),
        }),
        evidenceRecord: Object.freeze({ fixture: true }),
    });
    return { ledger, preflight, proof, result, trust, sourceFingerprint };
}

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('Task 13.2 completed Task 0.3 evidence importer', () => {
    it('accepts one complete current lineage without needing the rotated historical HMAC key', async () => {
        const lineage = await buildLineage();
        const verified = verifySmartOrderTask13_2CompletedTask03Lineage({
            ...lineage,
            currentSourceFingerprintSha256: lineage.sourceFingerprint,
            nowEpochMs,
        });

        expect(verified).toMatchObject({
            ledger: { state: 'dispatching_unknown_no_retry' },
            proof: { state: 'confirmed', brokerWriteAttempted: true },
            result: { state: 'confirmed', brokerWriteNetworked: true },
        });
    });

    it('rejects forged, old-source and old-schema lineage content', async () => {
        const forged = await buildLineage();
        expect(() =>
            verifySmartOrderTask13_2CompletedTask03Lineage({
                ...forged,
                proof: {
                    ...forged.proof,
                    tradeIdentitySha256: digest('forged-trade'),
                },
                currentSourceFingerprintSha256: forged.sourceFingerprint,
                nowEpochMs,
            }),
        ).toThrow('lineage drifted');

        const oldSource = await buildLineage();
        expect(() =>
            verifySmartOrderTask13_2CompletedTask03Lineage({
                ...oldSource,
                currentSourceFingerprintSha256: digest('new-source'),
                nowEpochMs,
            }),
        ).toThrow('trust anchor is invalid or stale');

        const oldSchema = await buildLineage({ proofSchema: 'legacy/task-0.3' });
        expect(() =>
            verifySmartOrderTask13_2CompletedTask03Lineage({
                ...oldSchema,
                currentSourceFingerprintSha256: oldSchema.sourceFingerprint,
                nowEpochMs,
            }),
        ).toThrow('proof is not eligible');
    });

    it('rejects renamed or fabricated files instead of scanning for a plausible lineage', async () => {
        const { root, privateDirectory } = await prepareRoot();
        const lineage = await buildLineage();
        const replayId = randomUUID();
        await writePrivateJson(
            path.join(
                privateDirectory,
                `task0-3-trigger-proof-${replayId}.json`,
            ),
            lineage.proof,
        );
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('network forbidden'));

        await expect(
            importSmartOrderTask13_2CompletedTask03Evidence({
                appSupportRoot: root,
                nowEpochMs,
            }),
        ).rejects.toThrow();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('creates one persistent private evidence capability and reuses the exact bytes', async () => {
        const { privateDirectory } = await prepareRoot();
        const first =
            await readOrCreateSmartOrderTask13_2EvidenceCapability(
                privateDirectory,
            );
        const second =
            await readOrCreateSmartOrderTask13_2EvidenceCapability(
                privateDirectory,
            );
        const filePath = path.join(
            privateDirectory,
            SMART_ORDER_TASK_13_2_EVIDENCE_CAPABILITY_FILE,
        );

        expect(first).toEqual(second);
        expect(first).toHaveLength(32);
        expect((await stat(filePath)).mode & 0o777).toBe(0o600);
        expect(await readFile(filePath)).toEqual(Buffer.from(first));
        first.fill(0);
        second.fill(0);
    });
});
