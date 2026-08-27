import { randomUUID } from 'node:crypto';
import {
    chmod,
    mkdir,
    mkdtemp,
    realpath,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SMART_ORDER_TASK_13_2_EVIDENCE_FILES,
    runSmartOrderTask13_2EvidenceAggregate,
} from './smart-order-task13-2-evidence-aggregate.mjs';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
} from './smart-order-runtime/task13-2-formal-evidence.mjs';
import {
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_PLACE_TRUST,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_UPDATE_TRUST,
    SMART_ORDER_TASK_13_2_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS,
} from './smart-order-runtime/task13-2-completed-evidence-trust.mjs';

const roots = [];
const capability = Buffer.alloc(32, 0x52);
const nowEpochMs = Date.parse('2026-08-24T03:00:00.000Z');
const accountScopeSha256 = `sha256:${'a'.repeat(64)}`;
const apiGenerationSha256 = `sha256:${'b'.repeat(64)}`;
const targetIdSha256 = `sha256:${'c'.repeat(64)}`;
const task03bRunId = '123e4567-e89b-42d3-a456-426614174000';

function digest(index, offset = 0) {
    return `sha256:${String(index + offset).padStart(64, '0')}`;
}

async function prepareRoot() {
    const rawRoot = await mkdtemp(path.join(os.tmpdir(), 'task13-2-aggregate-'));
    const root = await realpath(rawRoot);
    roots.push(root);
    await chmod(root, 0o700);
    const privateDirectory = path.join(root, 'smart-order', 'private');
    await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
    await chmod(path.join(root, 'smart-order'), 0o700);
    await chmod(privateDirectory, 0o700);
    await writeFile(
        path.join(privateDirectory, 'task13-2-evidence-hmac-key.bin'),
        capability,
        { mode: 0o600 },
    );
    return { root, privateDirectory };
}

async function issue(key, index, overrides = {}) {
    const [taskId, operationKey] = key.split(':');
    const write = !key.startsWith('0.7:') && !key.startsWith('pnl_current_day:');
    return createSmartOrderTask13_2FormalEvidence({
        capability,
        input: {
            schemaVersion: SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
            evidenceId: randomUUID(),
            taskId,
            operationKey,
            runId: taskId === '0.3b' ? task03bRunId : randomUUID(),
            observedTradeDate: '2026-08-24',
            accountScopeSha256,
            apiGenerationSha256,
            sourceFingerprintSha256:
                await currentSmartOrderTask13_2EvidenceSourceFingerprint(key),
            verifierFingerprintSha256:
                await currentSmartOrderTask13_2VerifierFingerprint(),
            requestSha256: write ? digest(index, 100) : null,
            resultSha256: digest(index, 200),
            targetIdSha256: taskId === '0.3b' ? targetIdSha256 : null,
            quantityCommonLots: write ? 1 : null,
            generatedAtEpochMs: nowEpochMs - 1_000,
            validUntilEpochMs:
                taskId === 'pnl_current_day' ? nowEpochMs + 5_000 : null,
            formalEvidence: true,
            fixture: false,
            brokerWriteAttempted: write,
            brokerWriteNetworked: write,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            accountIdentifiersPersisted: false,
            ...overrides,
        },
    });
}

async function writeEvidence(privateDirectory, key, evidence, options = {}) {
    await writeFile(
        path.join(privateDirectory, SMART_ORDER_TASK_13_2_EVIDENCE_FILES[key]),
        `${JSON.stringify(evidence)}\n`,
        { mode: options.mode ?? 0o600 },
    );
}

async function writeFullMatrix(privateDirectory, overridesByKey = {}) {
    await Promise.all(
        SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.map(async (key, index) => {
            await writeEvidence(
                privateDirectory,
                key,
                await issue(key, index, overridesByKey[key]),
            );
        }),
    );
}

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('Task 13.2 production evidence aggregate', () => {
    it('accepts a current complete fixed-file matrix without network or broker authority', async () => {
        const { root, privateDirectory } = await prepareRoot();
        await writeFullMatrix(privateDirectory);
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new Error('network forbidden'));

        const aggregate = await runSmartOrderTask13_2EvidenceAggregate({
            appSupportRoot: root,
            nowEpochMs,
        });

        expect(aggregate).toMatchObject({
            eligible: true,
            blockers: [],
            automaticOperationAllowed: false,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
        expect(aggregate.evidence).toHaveLength(
            SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.length,
        );
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(JSON.stringify(aggregate)).not.toContain(accountScopeSha256);
    });

    it('accepts only manifest-pinned historical source and verifier lineages for completed Task 0.3 and Task 0.3b place', async () => {
        const { root, privateDirectory } = await prepareRoot();
        await writeFullMatrix(privateDirectory, {
            '0.3:place_confirmed': {
                sourceFingerprintSha256:
                    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST
                        .sourceFingerprintSha256,
                verifierFingerprintSha256:
                    SMART_ORDER_TASK_13_2_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS[
                        '0.3:place_confirmed'
                    ][0],
            },
            '0.3b:place_confirmed': {
                sourceFingerprintSha256:
                    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_PLACE_TRUST
                        .sourceFingerprintSha256,
                verifierFingerprintSha256:
                    SMART_ORDER_TASK_13_2_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS[
                        '0.3b:place_confirmed'
                    ][0],
            },
            '0.3b:update_confirmed': {
                sourceFingerprintSha256:
                    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_UPDATE_TRUST
                        .formalSourceFingerprintSha256,
                verifierFingerprintSha256:
                    SMART_ORDER_TASK_13_2_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS[
                        '0.3b:update_confirmed'
                    ][0],
            },
        });

        const aggregate = await runSmartOrderTask13_2EvidenceAggregate({
            appSupportRoot: root,
            nowEpochMs,
        });

        expect(aggregate.eligible).toBe(true);
        expect(aggregate.blockers).toEqual([]);
    });

    it('reports the exact missing matrix without issuing or repairing evidence', async () => {
        const { root } = await prepareRoot();
        const aggregate = await runSmartOrderTask13_2EvidenceAggregate({
            appSupportRoot: root,
            nowEpochMs,
        });
        expect(aggregate.eligible).toBe(false);
        expect(aggregate.blockers).toEqual(
            SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.map((key) => `missing:${key}`).sort(),
        );
        expect(aggregate.brokerWriteAttempted).toBe(false);
    });

    it('rejects forged, old-schema and replayed signed reports', async () => {
        const { root, privateDirectory } = await prepareRoot();
        await writeFullMatrix(privateDirectory);
        const forged = await issue('0.3:place_confirmed', 0);
        await writeEvidence(privateDirectory, '0.3:place_confirmed', {
            ...forged,
            resultSha256: digest(999),
        });
        const oldSchema = await issue('0.4:order_deal_round_trip', 5);
        await writeEvidence(privateDirectory, '0.4:order_deal_round_trip', {
            ...oldSchema,
            schemaVersion: 'legacy/task13.2',
        });
        const repeatedEvidenceId = randomUUID();
        await writeEvidence(
            privateDirectory,
            '0.6:lmt_rod',
            await issue('0.6:lmt_rod', 6, { evidenceId: repeatedEvidenceId }),
        );
        await writeEvidence(
            privateDirectory,
            '0.6:lmt_ioc',
            await issue('0.6:lmt_ioc', 7, { evidenceId: repeatedEvidenceId }),
        );

        const aggregate = await runSmartOrderTask13_2EvidenceAggregate({
            appSupportRoot: root,
            nowEpochMs,
        });
        expect(aggregate.eligible).toBe(false);
        expect(aggregate.blockers).toEqual(
            expect.arrayContaining([
                'invalid:0.3:place_confirmed',
                'invalid:0.4:order_deal_round_trip',
                'replayed_evidence_id',
            ]),
        );
    });

    it('rejects symlink, non-private mode and stale current-day PnL evidence', async () => {
        const { root, privateDirectory } = await prepareRoot();
        await writeFullMatrix(privateDirectory, {
            'pnl_current_day:full_day': {
                observedTradeDate: '2026-08-23',
                validUntilEpochMs: nowEpochMs - 1,
            },
        });
        const source = path.join(privateDirectory, 'symlink-source.json');
        await writeFile(source, '{}\n', { mode: 0o600 });
        const symlinkKey = '0.3:place_confirmed';
        const symlinkPath = path.join(
            privateDirectory,
            SMART_ORDER_TASK_13_2_EVIDENCE_FILES[symlinkKey],
        );
        await rm(symlinkPath);
        await symlink(source, symlinkPath);
        await chmod(
            path.join(
                privateDirectory,
                SMART_ORDER_TASK_13_2_EVIDENCE_FILES['0.3b:place_confirmed'],
            ),
            0o644,
        );

        const aggregate = await runSmartOrderTask13_2EvidenceAggregate({
            appSupportRoot: root,
            nowEpochMs,
        });
        expect(aggregate.blockers).toEqual(
            expect.arrayContaining([
                'current_day_pnl_stale',
                'unreadable:0.3:place_confirmed',
                'unreadable:0.3b:place_confirmed',
            ]),
        );
    });
});
