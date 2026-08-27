import { describe, expect, it, vi } from 'vitest';

const authority = vi.hoisted(() => ({ verifiers: new WeakSet() }));
vi.mock('./account-reconciliation-verifier-authority.mjs', () => ({
    isVerifiedSmartOrderAccountReconciliationVerifier(value) {
        return authority.verifiers.has(value);
    },
}));

import {
    createSmartOrderAccountReconciliationCoordinator,
    currentSmartOrderAccountReconciliationProjection,
} from './account-reconciliation-coordinator.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './canonical-pnl-policy.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const WATERMARK = `sha256:${'c'.repeat(64)}`;
const BASE_AS_OF_EPOCH_MS = 1_786_550_400_100;
const fixedAccount = Object.freeze({
    accountId: 'account-A',
    accountType: 'S',
    brokerId: 'broker-A',
});

function makeVerifier({
    beforeVerify,
    evidenceSha256 = nextEvidenceDigest(),
} = {}) {
    const evidenceDigests = new WeakMap();
    function issueEvidence(nextDigest = evidenceSha256) {
        const evidence = Object.freeze({ kind: 'snapshot-evidence' });
        evidenceDigests.set(evidence, nextDigest);
        return evidence;
    }
    const evidence = issueEvidence();
    const verifier = Object.freeze({
        verifySnapshotEvidence(candidate, expected) {
            beforeVerify?.(candidate, expected);
            const candidateDigest = evidenceDigests.get(candidate);
            return Object.freeze({
                evidenceSha256: candidateDigest ?? evidenceSha256,
                valid:
                    candidateDigest !== undefined &&
                    expected.accountScopeSha256.startsWith('sha256:') &&
                    expected.snapshotSha256.startsWith('sha256:') &&
                    expected.sourceSnapshotSha256.startsWith('sha256:'),
            });
        },
    });
    authority.verifiers.add(verifier);
    return { evidence, issueEvidence, verifier };
}

let evidenceCounter = 0;
let snapshotCounter = 0;

function nextEvidenceDigest() {
    evidenceCounter += 1;
    return `sha256:${evidenceCounter.toString(16).padStart(64, '0')}`;
}

function makeCoordinator({
    apiGeneration = 'generation-1',
    connectionId = 'connection-1',
    nowMonotonicMs,
    runtimeEpochId = 'runtime-epoch-1',
    verifier = makeVerifier(),
} = {}) {
    let monotonicMs = 100;
    const coordinator = createSmartOrderAccountReconciliationCoordinator({
        apiGeneration,
        connectionId,
        nowMonotonicMs:
            nowMonotonicMs ??
            (() => {
                monotonicMs += 1;
                return monotonicMs;
            }),
        runtimeEpochId,
        tradeDate: '2026-08-13',
        verifier: verifier?.verifier ?? null,
    });
    return { coordinator, ...verifier };
}

function snapshot(overrides = {}) {
    snapshotCounter += 1;
    return {
        account: fixedAccount,
        apiGeneration: 'generation-1',
        asOfEpochMs: BASE_AS_OF_EPOCH_MS + snapshotCounter,
        connectionId: 'connection-1',
        deals: [
            {
                dealId: 'deal-1',
                feeMinorUnits: 10,
                realizedMinorUnits: -500,
                transactionTaxMinorUnits: 20,
            },
        ],
        eventStreamWatermarkSha256: WATERMARK,
        fullDayDealsComplete: true,
        fullDayFeesComplete: true,
        fullDayTaxesComplete: true,
        includesExternalClientActivity: true,
        includesPreRuntimeActivity: true,
        positions: [
            {
                averagePriceMinorUnits: 10_000,
                availableShares: 2_000,
                contractKey: 'TSE:2330:STK:Common',
                lastPriceMinorUnits: 10_100,
                positionLineageId: 'position-lineage-1',
                quantityShares: 2_000,
                unrealizedMinorUnits: 100,
                yesterdayQuantityShares: 1_000,
            },
        ],
        pnlPolicyDefinitionSha256:
            SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
        pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
        reconciliationGeneration: 1,
        runtimeEpochId: 'runtime-epoch-1',
        sourceRevision: 'source-r1',
        tradeDate: '2026-08-13',
        workingOrders: [
            {
                brokerOrderId: 'external-order-1',
                contractKey: 'TSE:2330:STK:Common',
                filledShares: 0,
                origin: 'external',
                quantityShares: 1_000,
                remainingShares: 1_000,
                side: 'Sell',
                state: 'Submitted',
            },
            {
                brokerOrderId: 'runtime-buy-1',
                contractKey: 'TSE:2317:STK:Common',
                filledShares: 0,
                origin: 'runtime',
                quantityShares: 1_000,
                remainingShares: 1_000,
                side: 'Buy',
                state: 'Submitted',
            },
        ],
        workingOrderSetComplete: true,
        ...overrides,
    };
}

function acquireAndPlan(coordinator) {
    const handle = coordinator.runtime.acquire({
        account: fixedAccount,
        consumerId: 'runtime-reconciliation',
    });
    const [plan] = coordinator.observer.pendingPlans();
    return { handle, plan };
}

describe('fixed-account reconciliation coordinator', () => {
    it('stays fail closed without the production verifier seam', () => {
        const { coordinator } = makeCoordinator({ verifier: null });
        const handle = coordinator.runtime.acquire({
            account: fixedAccount,
            consumerId: 'runtime-reconciliation',
        });
        expect(handle).toMatchObject({
            handleClass: 'fixed_account_reconciliation',
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(coordinator.observer.pendingPlans()).toEqual([]);
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_transport_unintegrated',
        });
        expect(coordinator.observer.status()).toMatchObject({
            transportVerifierConfigured: false,
            pendingPlanCount: 0,
            coverageCompleteCount: 0,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    });

    it('rejects an unissued structural verifier', () => {
        expect(() =>
            createSmartOrderAccountReconciliationCoordinator({
                apiGeneration: 'generation-1',
                connectionId: 'connection-1',
                nowMonotonicMs: () => 1,
                runtimeEpochId: 'runtime-epoch-1',
                tradeDate: '2026-08-13',
                verifier: Object.freeze({
                    verifySnapshotEvidence() {
                        return { evidenceSha256: DIGEST_A, valid: true };
                    },
                }),
            }),
        ).toThrow('not authority-issued');
    });

    it('latches a clock regression before the first plan is issued', () => {
        const samples = [100, 99];
        const { coordinator } = makeCoordinator({
            nowMonotonicMs: () => samples.shift() ?? 101,
        });
        const handle = coordinator.runtime.acquire({
            account: fixedAccount,
            consumerId: 'runtime-reconciliation',
        });
        expect(coordinator.observer.pendingPlans()).toEqual([]);
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_clock_invalid',
            automaticRetryAllowed: false,
        });
        expect(coordinator.observer.status()).toMatchObject({
            clockInvalid: true,
            pendingPlanCount: 0,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    });

    it('issues exact bounded account-scoped update-status/trades/positions plans', () => {
        const { coordinator } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        expect(plan).toMatchObject({
            account: fixedAccount,
            phases: ['update_status', 'trades', 'positions'],
            attempt: 1,
            maximumAttempts: 3,
            boundedReadOnlyOperationCount: 3,
            automaticRetryAllowedBeforeUnknown: true,
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(
            coordinator.runtime.submit(structuredClone(plan), snapshot(), {}),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_plan_invalid',
        });
    });

    it('projects complete external working sells and full-day totals without authority', () => {
        const { coordinator, evidence } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        const result = coordinator.runtime.submit(plan, snapshot(), evidence);
        expect(result).toMatchObject({
            allowed: true,
            state: 'coverage_verified_offline',
            reconciliationGeneration: 1,
            workingOrderCount: 2,
            externalWorkingSellCount: 1,
            positionCount: 1,
            dealCount: 1,
            fullDayTotals: {
                realizedMinorUnits: -500,
                unrealizedMinorUnits: 100,
                feeMinorUnits: 10,
                transactionTaxMinorUnits: 20,
                netMinorUnits: -430,
            },
            coverageComplete: true,
            automaticWriteAllowed: false,
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(result.externalSellClaimCandidates).toEqual([
            expect.objectContaining({
                brokerOrderId: 'external-order-1',
                contractKey: 'TSE:2330:STK:Common',
                positionLineageId: 'position-lineage-1',
                quantityShares: 1_000,
                state: 'broker_working',
                repositoryMutationAuthority: false,
            }),
        ]);
        expect(currentSmartOrderAccountReconciliationProjection(result)).toMatchObject({
            schemaVersion:
                'smart-order-account-reconciliation-projection/2026-08-13.2',
            account: fixedAccount,
            tradeDate: '2026-08-13',
            deals: [expect.objectContaining({ dealId: 'deal-1' })],
            coverageComplete: true,
        });
        expect(
            currentSmartOrderAccountReconciliationProjection(
                structuredClone(result),
            ),
        ).toBeUndefined();
        expect(coordinator.observer.status()).toMatchObject({
            coverageCompleteCount: 1,
            reconciliationRequired: true,
            accountIdentifiersExposed: false,
        });
        expect(coordinator.observer.status()).not.toHaveProperty('apiGeneration');
        expect(coordinator.observer.status()).not.toHaveProperty('connectionId');
    });

    it.each([
        ['workingOrderSetComplete'],
        ['fullDayDealsComplete'],
        ['fullDayFeesComplete'],
        ['fullDayTaxesComplete'],
        ['includesPreRuntimeActivity'],
        ['includesExternalClientActivity'],
    ])('keeps coverage incomplete when %s is false', (field) => {
        const { coordinator, evidence } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.submit(
                plan,
                snapshot({ [field]: false }),
                evidence,
            ),
        ).toMatchObject({
            allowed: true,
            state: 'coverage_incomplete',
            coverageComplete: false,
            runtimeReadinessContribution: false,
        });
    });

    it('fails closed when an external working sell lacks a position lineage', () => {
        const { coordinator, evidence } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.submit(
                plan,
                snapshot({ positions: [] }),
                evidence,
            ),
        ).toMatchObject({
            allowed: true,
            state: 'external_claim_scope_incomplete',
            coverageComplete: false,
            externalWorkingSellCount: 1,
        });
    });

    it('keeps an unknown external working sell blocking even with complete source coverage', () => {
        const { coordinator, evidence } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        const [externalSell, runtimeBuy] = snapshot().workingOrders;
        expect(
            coordinator.runtime.submit(
                plan,
                snapshot({
                    workingOrders: [
                        { ...externalSell, state: 'Unknown' },
                        runtimeBuy,
                    ],
                }),
                evidence,
            ),
        ).toMatchObject({
            allowed: true,
            state: 'external_claim_unknown',
            coverageComplete: false,
            externalSellClaimCandidates: [
                expect.objectContaining({
                    brokerOrderId: 'external-order-1',
                    quantityShares: 1_000,
                    state: 'unknown',
                }),
            ],
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    });

    it('blocks external working sells whose remaining shares exceed the position', () => {
        const { coordinator, evidence } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        const [externalSell, runtimeBuy] = snapshot().workingOrders;
        expect(
            coordinator.runtime.submit(
                plan,
                snapshot({
                    positions: [
                        {
                            ...snapshot().positions[0],
                            availableShares: 500,
                            quantityShares: 500,
                        },
                    ],
                    workingOrders: [externalSell, runtimeBuy],
                }),
                evidence,
            ),
        ).toMatchObject({
            allowed: true,
            state: 'external_claim_quantity_conflict',
            coverageComplete: false,
            externalWorkingSellCount: 1,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    });

    it('rejects mismatched account, generation, connection, epoch, date and generation', () => {
        for (const mutation of [
            { account: { ...fixedAccount, accountId: 'account-B' } },
            { apiGeneration: 'generation-2' },
            { connectionId: 'connection-2' },
            { runtimeEpochId: 'runtime-epoch-2' },
            { tradeDate: '2026-08-12' },
            { reconciliationGeneration: 2 },
        ]) {
            const { coordinator, evidence } = makeCoordinator();
            const { plan } = acquireAndPlan(coordinator);
            expect(
                coordinator.runtime.submit(
                    plan,
                    snapshot(mutation),
                    evidence,
                ),
            ).toMatchObject({
                allowed: false,
                reason: 'reconciliation_snapshot_scope_mismatch',
                reconciliationRequired: true,
            });
        }
    });

    it('deduplicates exact rows and rejects conflicting duplicate keys', () => {
        const exact = snapshot().workingOrders[0];
        const { coordinator, evidence } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.submit(
                plan,
                snapshot({ workingOrders: [exact, { ...exact }] }),
                evidence,
            ),
        ).toMatchObject({ allowed: true, workingOrderCount: 1 });

        const second = makeCoordinator();
        const secondPlan = acquireAndPlan(second.coordinator).plan;
        expect(
            second.coordinator.runtime.submit(
                secondPlan,
                snapshot({
                    workingOrders: [
                        exact,
                        { ...exact, remainingShares: 999, quantityShares: 999 },
                    ],
                }),
                second.evidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_snapshot_invalid',
        });
    });

    it('rejects accessors and proxies without executing their getters or traps', () => {
        let getterReads = 0;
        const candidate = snapshot();
        Object.defineProperty(candidate, 'workingOrders', {
            enumerable: true,
            get() {
                getterReads += 1;
                return [];
            },
        });
        const { coordinator, evidence } = makeCoordinator();
        const { plan } = acquireAndPlan(coordinator);
        expect(coordinator.runtime.submit(plan, candidate, evidence)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_snapshot_invalid',
        });
        expect(getterReads).toBe(0);

        let proxyReads = 0;
        const proxy = new Proxy(snapshot(), {
            ownKeys(target) {
                proxyReads += 1;
                return Reflect.ownKeys(target);
            },
        });
        const second = makeCoordinator();
        const secondPlan = acquireAndPlan(second.coordinator).plan;
        expect(
            second.coordinator.runtime.submit(
                secondPlan,
                proxy,
                second.evidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_snapshot_invalid',
        });
        expect(proxyReads).toBe(0);
    });

    it('commits the exact snapshot verified before caller mutation', () => {
        let candidate;
        const issued = makeVerifier({
            beforeVerify() {
                candidate.deals[0].realizedMinorUnits = 999;
            },
        });
        const { coordinator } = makeCoordinator({ verifier: issued });
        const { plan } = acquireAndPlan(coordinator);
        candidate = snapshot();
        const result = coordinator.runtime.submit(
            plan,
            candidate,
            issued.evidence,
        );
        expect(candidate.deals[0].realizedMinorUnits).toBe(999);
        expect(result).toMatchObject({
            allowed: true,
            fullDayTotals: { realizedMinorUnits: -500 },
        });
    });

    it('rejects verifier reentrancy and leaves the plan current for one outer submit', () => {
        let coordinator;
        let plan;
        let snapshotValue;
        let evidence;
        let reentered = false;
        const issued = makeVerifier({
            beforeVerify() {
                if (reentered) return;
                reentered = true;
                expect(
                    coordinator.runtime.submit(plan, snapshotValue, evidence),
                ).toMatchObject({
                    allowed: false,
                    reason: 'reconciliation_verification_reentrant',
                });
            },
        });
        ({ coordinator } = makeCoordinator({ verifier: issued }));
        ({ plan } = acquireAndPlan(coordinator));
        snapshotValue = snapshot();
        evidence = issued.evidence;
        expect(
            coordinator.runtime.submit(plan, snapshotValue, evidence),
        ).toMatchObject({ allowed: true, coverageComplete: true });
    });

    it('does not commit when the verifier closes the coordinator reentrantly', () => {
        let coordinator;
        const issued = makeVerifier({
            beforeVerify() {
                coordinator.runtime.close();
            },
        });
        ({ coordinator } = makeCoordinator({ verifier: issued }));
        const { plan } = acquireAndPlan(coordinator);

        expect(
            coordinator.runtime.submit(plan, snapshot(), issued.evidence),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_evidence_invalid',
            reconciliationRequired: true,
        });
        expect(coordinator.observer.status()).toMatchObject({
            closed: true,
            pendingPlanCount: 0,
            coverageCompleteCount: 0,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    });

    it('rejects evidence replay across plans', () => {
        const { coordinator, evidence } = makeCoordinator();
        const { handle, plan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.submit(plan, snapshot(), evidence),
        ).toMatchObject({ allowed: true });
        const nextPlan = coordinator.runtime.planNext(handle);
        expect(nextPlan).toMatchObject({ reconciliationGeneration: 2 });
        expect(
            coordinator.runtime.submit(
                nextPlan,
                snapshot({
                    asOfEpochMs: 1_786_550_400_200,
                    reconciliationGeneration: 2,
                    sourceRevision: 'source-r2',
                }),
                evidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_evidence_invalid',
        });
    });

    it('rejects evidence replay across coordinator instances', () => {
        const evidenceSha256 = nextEvidenceDigest();
        const issued = makeVerifier({ evidenceSha256 });
        const first = makeCoordinator({ verifier: issued }).coordinator;
        const second = makeCoordinator({ verifier: issued }).coordinator;
        const firstPlan = acquireAndPlan(first).plan;
        const secondPlan = acquireAndPlan(second).plan;

        expect(
            first.runtime.submit(firstPlan, snapshot(), issued.evidence),
        ).toMatchObject({ allowed: true, evidenceSha256 });
        expect(
            second.runtime.submit(secondPlan, snapshot(), issued.evidence),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_evidence_invalid',
            reconciliationRequired: true,
        });
    });

    it('rejects a cross-coordinator rollback with newly issued evidence', () => {
        const issued = makeVerifier();
        const first = makeCoordinator({ verifier: issued }).coordinator;
        const second = makeCoordinator({ verifier: issued }).coordinator;
        const firstPlan = acquireAndPlan(first).plan;
        const secondPlan = acquireAndPlan(second).plan;
        const currentSnapshot = snapshot();

        expect(
            first.runtime.submit(firstPlan, currentSnapshot, issued.evidence),
        ).toMatchObject({ allowed: true, coverageComplete: true });
        expect(
            second.runtime.submit(
                secondPlan,
                snapshot({
                    asOfEpochMs: currentSnapshot.asOfEpochMs - 1,
                    sourceRevision: 'source-rollback',
                }),
                issued.issueEvidence(nextEvidenceDigest()),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_source_head_not_current',
            reconciliationRequired: true,
        });
    });

    it('does not reset the source head across connection and Runtime generations', () => {
        const firstIssued = makeVerifier();
        const first = makeCoordinator({ verifier: firstIssued }).coordinator;
        const firstPlan = acquireAndPlan(first).plan;
        const currentSnapshot = snapshot();
        expect(
            first.runtime.submit(firstPlan, currentSnapshot, firstIssued.evidence),
        ).toMatchObject({ allowed: true });

        const replacementIssued = makeVerifier();
        const replacement = makeCoordinator({
            apiGeneration: 'generation-2',
            connectionId: 'connection-2',
            runtimeEpochId: 'runtime-epoch-2',
            verifier: replacementIssued,
        }).coordinator;
        const replacementPlan = acquireAndPlan(replacement).plan;
        expect(
            replacement.runtime.submit(
                replacementPlan,
                snapshot({
                    apiGeneration: 'generation-2',
                    asOfEpochMs: currentSnapshot.asOfEpochMs - 1,
                    connectionId: 'connection-2',
                    runtimeEpochId: 'runtime-epoch-2',
                    sourceRevision: 'source-old-after-reconnect',
                }),
                replacementIssued.evidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_source_head_not_current',
            reconciliationRequired: true,
        });
    });

    it('rejects an older outer submit when verifier reentrancy advances the shared head', () => {
        let advanced = false;
        let newerCoordinator;
        let newerPlan;
        let newerEvidence;
        let newerSnapshot;
        const issued = makeVerifier({
            beforeVerify() {
                if (advanced) return;
                advanced = true;
                expect(
                    newerCoordinator.runtime.submit(
                        newerPlan,
                        newerSnapshot,
                        newerEvidence,
                    ),
                ).toMatchObject({ allowed: true, coverageComplete: true });
            },
        });
        const olderCoordinator = makeCoordinator({ verifier: issued }).coordinator;
        newerCoordinator = makeCoordinator({ verifier: issued }).coordinator;
        const olderPlan = acquireAndPlan(olderCoordinator).plan;
        newerPlan = acquireAndPlan(newerCoordinator).plan;
        const olderSnapshot = snapshot();
        newerSnapshot = snapshot();
        newerEvidence = issued.issueEvidence(nextEvidenceDigest());

        expect(
            olderCoordinator.runtime.submit(
                olderPlan,
                olderSnapshot,
                issued.evidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_source_head_not_current',
            reconciliationRequired: true,
        });
        expect(olderCoordinator.observer.status()).toMatchObject({
            coverageCompleteCount: 0,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    });

    it('does not consume the plan or evidence before totals validation succeeds', () => {
        const issued = makeVerifier({ evidenceSha256: nextEvidenceDigest() });
        const { coordinator } = makeCoordinator({ verifier: issued });
        const { plan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.submit(
                plan,
                snapshot({
                    deals: [
                        {
                            dealId: 'deal-overflow-a',
                            feeMinorUnits: 0,
                            realizedMinorUnits: Number.MAX_SAFE_INTEGER,
                            transactionTaxMinorUnits: 0,
                        },
                        {
                            dealId: 'deal-overflow-b',
                            feeMinorUnits: 0,
                            realizedMinorUnits: 1,
                            transactionTaxMinorUnits: 0,
                        },
                    ],
                }),
                issued.evidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_snapshot_invalid',
        });
        expect(coordinator.observer.pendingPlans()).toEqual([plan]);
        expect(
            coordinator.runtime.submit(plan, snapshot(), issued.evidence),
        ).toMatchObject({ allowed: true, coverageComplete: true });
    });

    it('rejects older and conflicting same-time source heads', () => {
        const firstVerifier = makeVerifier({
            evidenceSha256: nextEvidenceDigest(),
        });
        const { coordinator } = makeCoordinator({ verifier: firstVerifier });
        const { handle, plan } = acquireAndPlan(coordinator);
        const currentSnapshot = snapshot();
        expect(
            coordinator.runtime.submit(
                plan,
                currentSnapshot,
                firstVerifier.evidence,
            ),
        ).toMatchObject({ allowed: true });

        const nextPlan = coordinator.runtime.planNext(handle);
        const secondEvidence = firstVerifier.issueEvidence(nextEvidenceDigest());
        expect(
            coordinator.runtime.submit(
                nextPlan,
                snapshot({
                    asOfEpochMs: currentSnapshot.asOfEpochMs - 1,
                    reconciliationGeneration: 2,
                    sourceRevision: 'source-r2',
                }),
                secondEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_source_head_not_current',
        });
        expect(
            coordinator.runtime.submit(
                nextPlan,
                snapshot({
                    asOfEpochMs: currentSnapshot.asOfEpochMs,
                    reconciliationGeneration: 2,
                    sourceRevision: 'source-r-conflict',
                }),
                secondEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_source_head_not_current',
        });
    });

    it('latches unknown reads and does not self-retry on the same coordinator', () => {
        const { coordinator } = makeCoordinator();
        const { handle, plan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.reportFailure(plan, {
                planId: plan.planId,
                reason: 'read_result_unknown',
            }),
        ).toMatchObject({
            allowed: true,
            state: 'read_result_unknown',
            explicitRetryAllowed: false,
        });
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_read_result_unknown',
            automaticRetryAllowed: false,
        });
    });

    it('bounds definite-failure retries with monotonic backoff', () => {
        let monotonicMs = 100;
        const { coordinator } = makeCoordinator({
            nowMonotonicMs: () => monotonicMs,
        });
        const { handle, plan: firstPlan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.reportFailure(firstPlan, {
                planId: firstPlan.planId,
                reason: 'update_status_failed',
            }),
        ).toMatchObject({
            allowed: true,
            state: 'update_status_failed',
            explicitRetryAllowed: true,
            retryNotBeforeMonotonicMs: 1_100,
        });
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_retry_backoff',
        });

        monotonicMs = 1_100;
        const secondPlan = coordinator.runtime.planNext(handle);
        expect(secondPlan).toMatchObject({ attempt: 2, maximumAttempts: 3 });
        expect(
            coordinator.runtime.reportFailure(secondPlan, {
                planId: secondPlan.planId,
                reason: 'trades_failed',
            }),
        ).toMatchObject({
            allowed: true,
            explicitRetryAllowed: true,
            retryNotBeforeMonotonicMs: 3_100,
        });

        monotonicMs = 3_100;
        const thirdPlan = coordinator.runtime.planNext(handle);
        expect(thirdPlan).toMatchObject({ attempt: 3, maximumAttempts: 3 });
        expect(
            coordinator.runtime.reportFailure(thirdPlan, {
                planId: thirdPlan.planId,
                reason: 'positions_failed',
            }),
        ).toMatchObject({
            allowed: true,
            state: 'retry_exhausted',
            explicitRetryAllowed: false,
        });
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_retry_exhausted',
            automaticRetryAllowed: false,
        });
    });

    it('latches a monotonic clock regression during retry backoff', () => {
        let monotonicMs = 100;
        const { coordinator } = makeCoordinator({
            nowMonotonicMs: () => monotonicMs,
        });
        const { handle, plan } = acquireAndPlan(coordinator);
        expect(
            coordinator.runtime.reportFailure(plan, {
                planId: plan.planId,
                reason: 'trades_failed',
            }),
        ).toMatchObject({
            allowed: true,
            explicitRetryAllowed: true,
            retryNotBeforeMonotonicMs: 1_100,
        });

        monotonicMs = 99;
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_clock_invalid',
            automaticRetryAllowed: false,
        });
        monotonicMs = 2_000;
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_clock_invalid',
            automaticRetryAllowed: false,
        });
        expect(coordinator.observer.status()).toMatchObject({
            clockInvalid: true,
            pendingPlanCount: 0,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    });

    it('closes irreversibly without claiming reconciliation', () => {
        const { coordinator } = makeCoordinator();
        const { handle } = acquireAndPlan(coordinator);
        expect(coordinator.runtime.close()).toMatchObject({
            closed: true,
            pendingPlanCount: 0,
            reconciliationRequired: true,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(coordinator.runtime.planNext(handle)).toMatchObject({
            allowed: false,
            reason: 'reconciliation_coordinator_closed',
        });
    });
});
