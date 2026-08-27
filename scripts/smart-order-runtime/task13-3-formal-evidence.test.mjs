import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_TASK_13_3_FORMAL_EVIDENCE_SCHEMA_VERSION,
    SMART_ORDER_TASK_13_3_REQUIRED_PROFILES,
    aggregateSmartOrderTask13_3FormalEvidence,
    createSmartOrderTask13_3FormalEvidence,
    verifySmartOrderTask13_3FormalEvidence,
} from './task13-3-formal-evidence.mjs';

const capability = Buffer.alloc(32, 0x53);
const sourceFingerprintSha256 = `sha256:${'a'.repeat(64)}`;
const verifierFingerprintSha256 = `sha256:${'b'.repeat(64)}`;
const policy = Object.freeze({
    protected_entry_lmt_ioc: ['Buy', 'filled_with_order_and_deal', '115.5'],
    protected_exit_working_lmt_rod: ['Sell', 'working_no_deal', '116'],
    protected_exit_marketable_lmt_ioc: [
        'Sell',
        'filled_with_order_and_deal',
        '114.5',
    ],
    protected_exit_ioc_unfilled: ['Sell', 'zero_fill_no_deal', '116.5'],
});

function issue(profile) {
    const [side, expectedOutcome, authorizedPrice] = policy[profile];
    return createSmartOrderTask13_3FormalEvidence({
        capability,
        input: {
            schemaVersion: SMART_ORDER_TASK_13_3_FORMAL_EVIDENCE_SCHEMA_VERSION,
            evidenceId: randomUUID(),
            profile,
            runId: randomUUID(),
            operationId: randomUUID(),
            observedTradeDate: '2026-08-27',
            accountScopeSha256: `sha256:${'c'.repeat(64)}`,
            apiGenerationSha256: `sha256:${'d'.repeat(64)}`,
            sourceFingerprintSha256,
            verifierFingerprintSha256,
            requestSha256: `sha256:${profile.length.toString(16).padStart(64, '0')}`,
            resultSha256: `sha256:${(profile.length + 100).toString(16).padStart(64, '0')}`,
            authorizedPrice,
            side,
            expectedOutcome,
            generatedAtEpochMs: Date.parse('2026-08-27T03:00:00.000Z'),
            formalEvidence: true,
            fixture: false,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            accountIdentifiersPersisted: false,
        },
    });
}

function verify(evidence) {
    return verifySmartOrderTask13_3FormalEvidence({
        capability,
        evidence,
        expectedSourceFingerprintSha256: sourceFingerprintSha256,
        expectedVerifierFingerprintSha256: verifierFingerprintSha256,
    });
}

describe('Task 13.3 formal protective-exit smoke evidence', () => {
    it('accepts four distinct task-specific prices and preserves the no-chasing boundary', () => {
        const aggregate = aggregateSmartOrderTask13_3FormalEvidence(
            SMART_ORDER_TASK_13_3_REQUIRED_PROFILES.map((profile) =>
                verify(issue(profile)),
            ),
        );
        expect(aggregate).toMatchObject({
            eligible: true,
            blockers: [],
            prepareBeforeEntryCovered: true,
            partialFillCoveredByDeterministicCore: true,
            ocoRemainderCoveredByDeterministicCore: true,
            iocUnfilledCovered: true,
            restartReconcileCoveredByDeterministicCore: true,
            partialFillBrokerChasingAttempted: false,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            brokerAuthority: false,
        });
    });

    it('rejects a forged result and reused exact request while allowing BBO-derived price coincidence', () => {
        const forged = issue('protected_entry_lmt_ioc');
        expect(
            verify({ ...forged, resultSha256: `sha256:${'f'.repeat(64)}` }).eligible,
        ).toBe(false);
        const rows = SMART_ORDER_TASK_13_3_REQUIRED_PROFILES.map((profile) => {
            const evidence = issue(profile);
            if (profile !== 'protected_exit_ioc_unfilled') return verify(evidence);
            return verify(
                createSmartOrderTask13_3FormalEvidence({
                    capability,
                    input: {
                        ...Object.fromEntries(
                            Object.entries(evidence).filter(
                                ([key]) =>
                                    !['evidenceHashSha256', 'evidenceHmacSha256'].includes(key),
                            ),
                        ),
                        evidenceId: randomUUID(),
                        authorizedPrice: '116',
                        requestSha256:
                            profile === 'protected_exit_ioc_unfilled'
                                ? `sha256:${'1'.repeat(64)}`
                                : evidence.requestSha256,
                    },
                }),
            );
        });
        expect(aggregateSmartOrderTask13_3FormalEvidence(rows)).toMatchObject({
            eligible: true,
            blockers: [],
            distinctTaskSpecificMarketPlans: true,
        });

        const duplicateRequest = rows.map((row, index) =>
            index !== rows.length - 1
                ? row
                : verify(
                      createSmartOrderTask13_3FormalEvidence({
                          capability,
                          input: {
                              ...Object.fromEntries(
                                  Object.entries(issue(row.profile)).filter(
                                      ([key]) =>
                                          ![
                                              'evidenceHashSha256',
                                              'evidenceHmacSha256',
                                          ].includes(key),
                                  ),
                              ),
                              evidenceId: randomUUID(),
                              requestSha256: rows[0].requestSha256,
                          },
                      }),
                  ),
        );
        expect(
            aggregateSmartOrderTask13_3FormalEvidence(duplicateRequest),
        ).toMatchObject({
            eligible: false,
            blockers: ['reused_exact_request'],
            distinctTaskSpecificMarketPlans: false,
        });
    });
});
