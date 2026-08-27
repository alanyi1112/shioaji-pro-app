import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE,
    aggregateSmartOrderTask13_2FormalEvidence,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './task13-2-formal-evidence.mjs';
import { SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST } from './task13-2-completed-evidence-trust.mjs';

const capability = Buffer.alloc(32, 7);
const sourceFingerprintSha256 = `sha256:${'a'.repeat(64)}`;
const verifierFingerprintSha256 = `sha256:${'e'.repeat(64)}`;
const accountScopeSha256 = `sha256:${'b'.repeat(64)}`;
const apiGenerationSha256 = `sha256:${'c'.repeat(64)}`;
const targetIdSha256 = `sha256:${'d'.repeat(64)}`;
const task03bRunId = '123e4567-e89b-42d3-a456-426614174000';
const nowEpochMs = Date.parse('2026-08-24T03:00:00.000Z');

function digest(index, seed = 0) {
    return `sha256:${(index + seed).toString(16).padStart(64, '0')}`;
}

function inputFor(key, index, overrides = {}) {
    const [taskId, operationKey] = key.split(':');
    const write = !key.startsWith('0.7:') && !key.startsWith('pnl_current_day:');
    return {
        schemaVersion: SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
        evidenceId: `123e4567-e89b-42d3-a456-${String(426614174100 + index).padStart(12, '0')}`,
        taskId,
        operationKey,
        runId:
            taskId === '0.3b'
                ? task03bRunId
                : `123e4567-e89b-42d3-a456-${String(426614175100 + index).padStart(12, '0')}`,
        observedTradeDate: '2026-08-24',
        accountScopeSha256,
        apiGenerationSha256,
        sourceFingerprintSha256,
        verifierFingerprintSha256,
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
    };
}

function issueAll(overridesByKey = {}) {
    return SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.map((key, index) => {
        const signed = createSmartOrderTask13_2FormalEvidence({
            capability,
            input: inputFor(key, index, overridesByKey[key]),
        });
        return verifySmartOrderTask13_2FormalEvidence({
            capability,
            evidence: signed,
            expectedSourceFingerprintSha256: sourceFingerprintSha256,
            expectedVerifierFingerprintSha256: verifierFingerprintSha256,
        });
    });
}

describe('Task 13.2 formal evidence aggregation', () => {
    it('keeps completed Task 0.3 on its manifest-pinned source while recomputing current and Task 0.7 lineages', async () => {
        expect(
            SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST
                .sourceFingerprintSha256,
        ).toBe(
            'sha256:6e3b8933a62c132677814a42d05d2deac5eae2d9d69f7f47ad74eabf86f10d13',
        );
        const currentTask03 =
            await currentSmartOrderTask13_2EvidenceSourceFingerprint(
                '0.3:place_confirmed',
            );
        expect(currentTask03).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(currentTask03).not.toBe(
            SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST
                .sourceFingerprintSha256,
        );
        await expect(
            currentSmartOrderTask13_2EvidenceSourceFingerprint(
                '0.7:unit_contract',
            ),
        ).resolves.toBe(
            'sha256:7fe72ad78e4b57d225dc58faf4ae035a9096a2c75034ea75433c6a3e1ac59208',
        );
    });

    it('accepts exactly one verified row for every required contract without broker authority', () => {
        const aggregate = aggregateSmartOrderTask13_2FormalEvidence({
            evidence: issueAll(),
            expectedPnlTradeDate: '2026-08-24',
            nowEpochMs,
        });
        expect(aggregate).toMatchObject({
            eligible: true,
            blockers: [],
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
        expect(aggregate.evidence).toHaveLength(
            SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.length,
        );
    });

    it('reports the exact missing evidence matrix without attempting an operation', () => {
        const rows = issueAll().slice(0, -1);
        const aggregate = aggregateSmartOrderTask13_2FormalEvidence({
            evidence: rows,
            expectedPnlTradeDate: '2026-08-24',
            nowEpochMs,
        });
        expect(aggregate.eligible).toBe(false);
        expect(aggregate.blockers).toEqual([
            'missing:pnl_current_day:full_day',
        ]);
        expect(aggregate.brokerWriteAttempted).toBe(false);
    });

    it.each([
        ['legacy schema', { schemaVersion: 'legacy/v1' }],
        ['fixture', { fixture: true }],
        ['retry permission', { automaticRetryAllowed: true }],
        ['raw account persistence', { accountIdentifiersPersisted: true }],
        ['wrong quantity', { quantityCommonLots: 2 }],
    ])('rejects %s before evidence issuance', (_label, override) => {
        expect(() =>
            createSmartOrderTask13_2FormalEvidence({
                capability,
                input: inputFor('0.3:place_confirmed', 0, override),
            }),
        ).toThrow();
    });

    it('rejects forged, tampered and stale-source evidence', () => {
        const signed = createSmartOrderTask13_2FormalEvidence({
            capability,
            input: inputFor('0.3:place_confirmed', 0),
        });
        expect(
            verifySmartOrderTask13_2FormalEvidence({
                capability,
                evidence: { ...signed, resultSha256: digest(999) },
                expectedSourceFingerprintSha256: sourceFingerprintSha256,
                expectedVerifierFingerprintSha256: verifierFingerprintSha256,
            }),
        ).toMatchObject({ eligible: false });
        expect(
            verifySmartOrderTask13_2FormalEvidence({
                capability,
                evidence: signed,
                expectedSourceFingerprintSha256: digest(998),
                expectedVerifierFingerprintSha256: verifierFingerprintSha256,
            }),
        ).toMatchObject({ eligible: false });
        expect(
            aggregateSmartOrderTask13_2FormalEvidence({
                evidence: [signed],
                expectedPnlTradeDate: '2026-08-24',
                nowEpochMs,
            }),
        ).toMatchObject({ eligible: false, blockers: ['unverified_evidence'] });
    });

    it('rejects replay, account drift, Task 0.3b lineage drift and stale PnL', () => {
        const replayed = issueAll();
        replayed[1] = replayed[0];
        expect(
            aggregateSmartOrderTask13_2FormalEvidence({
                evidence: replayed,
                expectedPnlTradeDate: '2026-08-24',
                nowEpochMs,
            }).blockers,
        ).toContain('replayed_evidence_id');

        const drifted = issueAll({
            '0.3b:update_confirmed': {
                targetIdSha256: digest(700),
                accountScopeSha256: digest(701),
            },
            'pnl_current_day:full_day': {
                observedTradeDate: '2026-08-23',
                validUntilEpochMs: nowEpochMs - 1,
            },
        });
        const aggregate = aggregateSmartOrderTask13_2FormalEvidence({
            evidence: drifted,
            expectedPnlTradeDate: '2026-08-24',
            nowEpochMs,
        });
        expect(aggregate.blockers).toEqual(
            expect.arrayContaining([
                'current_day_pnl_stale',
                'fixed_account_scope_drift',
                'task0.3b_lineage_drift',
            ]),
        );
    });

    it('rejects Proxy evidence input', () => {
        expect(() =>
            createSmartOrderTask13_2FormalEvidence({
                capability,
                input: new Proxy(inputFor('0.3:place_confirmed', 0), {}),
            }),
        ).toThrow('non-Proxy');
    });
});
