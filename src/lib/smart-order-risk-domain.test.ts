import { describe, expect, it } from 'vitest';
import { shares } from './smart-order-domain-money';
import { taipeiTradeDate } from './smart-order-domain-calendar';
import {
    SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION,
    SMART_ORDER_MAX_EXPOSURE_VALUE,
    SMART_ORDER_PNL_POLICY_SCHEMA_VERSION,
    SMART_ORDER_RISK_TEST_ONLY,
    SmartOrderRiskDomainError,
    calculateRuntimeTrackedUnprotectedRemainder,
    createEntryExposureReservation,
    createOrderClassMatrix,
    createPnlPolicy,
    deriveIdentityGroupId,
    entryExposureReservationId,
    evaluateGateManifest,
    evaluateOrderClass,
    evaluatePnlReadiness,
    exitClaimId,
    projectDistinctExitClaims,
    recalculatePnlTotals,
    reserveWorstCaseEntry,
    type BrokerWriteProvenance,
    type CanonicalOrderClass,
    type CurrentDispatchAuthorityInput,
    type EntryExposureLedger,
    type ExposureVector,
    type GateManifestInput,
    type IdentityGroupId,
    type PnlReadinessEvidenceInput,
    type VerifiedExitClaimScope,
    type VerifiedOrderClassMatrix,
} from './smart-order-risk-domain';

if (!SMART_ORDER_RISK_TEST_ONLY) {
    throw new Error('smart-order risk test issuer surface is unavailable');
}

const {
    issueCurrentDispatchAuthority: issueCurrentDispatchAuthorityForTest,
    issueIdentityKeyHandle: issueIdentityKeyHandleForTest,
    issueRiskEvaluationTime: issueRiskEvaluationTimeForTest,
    issueVerifiedCanonicalPrincipal: issueVerifiedCanonicalPrincipalForTest,
    issueVerifiedEntryExposureLedger: issueVerifiedEntryExposureLedgerForTest,
    issueVerifiedExitClaimEvidence: issueVerifiedExitClaimEvidenceForTest,
    issueVerifiedExitClaimProjectionContext:
        issueVerifiedExitClaimProjectionContextForTest,
    issueVerifiedExitClaimScope: issueVerifiedExitClaimScopeForTest,
    issueVerifiedExposureBaseline: issueVerifiedExposureBaselineForTest,
    issueVerifiedExposureLimitPolicy: issueVerifiedExposureLimitPolicyForTest,
    issueVerifiedGateManifest: issueVerifiedGateManifestForTest,
    issueVerifiedOrderClassMatrix: issueVerifiedOrderClassMatrixForTest,
    issueVerifiedPnlEvidence: issueVerifiedPnlEvidenceForTest,
    issueVerifiedPnlPolicy: issueVerifiedPnlPolicyForTest,
    issueVerifiedWorstCaseExposure: issueVerifiedWorstCaseExposureForTest,
} = SMART_ORDER_RISK_TEST_ONLY;

const DIGEST = `sha256:${'b'.repeat(64)}` as `sha256:${string}`;
const OTHER_DIGEST = `sha256:${'c'.repeat(64)}` as `sha256:${string}`;
const IDENTITY = `hmac-sha256:${'d'.repeat(64)}` as IdentityGroupId;
const TRADE_DATE = taipeiTradeDate('2026-08-11');

function pnlPolicy() {
    return issueVerifiedPnlPolicyForTest({
        schemaVersion: SMART_ORDER_PNL_POLICY_SCHEMA_VERSION,
        policyRevision: 'pnl-r1',
        tradeDateTimeZone: 'Asia/Taipei',
        aggregation: ['per_account', 'identity_group'],
        freshnessTtlMs: 5_000,
        decimalRounding: 'toward_zero_minor_unit',
        resetGate: 'official_calendar_business_session_all_accounts_reconciled',
        valuationPriceSource: 'broker-position-and-fresh-quote',
        componentSources: [
            ['realized', 'deals.realized'],
            ['unrealized', 'positions.unrealized'],
            ['fee', 'deals.fee'],
            ['transaction_tax', 'deals.tax'],
        ].map(([component, fieldPath]) => ({
            component: component as
                | 'realized'
                | 'unrealized'
                | 'fee'
                | 'transaction_tax',
            sourceId: 'account-scoped-full-day',
            fieldPath: fieldPath!,
            coverage: 'current_trade_date_full_account_scoped' as const,
        })),
    });
}

function pnlEvidenceInput(
    policyDefinitionSha256: string,
    overrides: Partial<PnlReadinessEvidenceInput> = {},
): PnlReadinessEvidenceInput {
    return {
        policyRevision: 'pnl-r1',
        policyDefinitionSha256,
        tradeDate: TRADE_DATE,
        identityGroupId: IDENTITY,
        accountSetRevision: 'accounts-r1',
        dealLedgerRevision: 'deals-r1',
        sourceIntegritySha256: DIGEST,
        runtimeEpochId: 'runtime-epoch-1',
        apiGeneration: 'api-generation-1',
        asOfEpochMs: 10_000,
        runtimeStartedAtEpochMs: 8_000,
        fullDayAccountScopedCoverage: true,
        includesPreRuntimeActivity: true,
        includesExternalClientActivity: true,
        completeComponents: [
            'realized',
            'unrealized',
            'fee',
            'transaction_tax',
        ],
        allAccountsReconciled: true,
        identityMappingReady: true,
        totals: {
            realizedMinorUnits: -1_000n,
            unrealizedMinorUnits: 500n,
            feeMinorUnits: 10n,
            transactionTaxMinorUnits: 5n,
            netMinorUnits: -515n,
        },
        ...overrides,
    };
}

function riskTime(nowEpochMs: number) {
    return issueRiskEvaluationTimeForTest({
        runtimeEpochId: 'runtime-epoch-1',
        apiGeneration: 'api-generation-1',
        clockRevision: 'clock-r1',
        nowEpochMs,
    });
}

function fingerprintSet() {
    return {
        buildSha256: DIGEST,
        adapterSha256: DIGEST,
        shioajiCapabilitySha256: DIGEST,
        platformSha256: DIGEST,
        routeCoverageSha256: DIGEST,
        pnlPolicyRevision: 'pnl-r1',
        pnlPolicyDefinitionSha256: DIGEST,
        orderClassMatrixRevision: 'matrix-r1',
        orderClassMatrixSha256: DIGEST,
    } as const;
}

function automationWriteScope() {
    return {
        intentId: 'intent-automation-1',
        accountBrokerRef: 'broker-account-A',
        accountIdRef: 'account-A',
        routeId: 'automation.smart.place',
        operationKind: 'place',
        requestPayloadSha256: DIGEST,
        strategyId: 'strategy-1',
        activationId: 'activation-1',
    } as const;
}

function manualWriteScope() {
    return {
        intentId: 'intent-manual-1',
        accountBrokerRef: 'broker-account-A',
        accountIdRef: 'account-A',
        routeId: 'manual.ticket.place',
        operationKind: 'place',
        requestPayloadSha256: DIGEST,
        manualRequestId: 'manual-request-1',
    } as const;
}

function gateInput(provenance: BrokerWriteProvenance): GateManifestInput {
    return {
        schemaVersion: SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION,
        provenance,
        manifestRevision: `manifest-${provenance}`,
        productBoundaryConsentVersion: 'local-not-cloud-r1',
        validUntilEpochMs: 20_000,
        requiredEvidenceSha256: [DIGEST],
        ...fingerprintSet(),
    };
}

function automationAuthority(
    overrides: Partial<Extract<CurrentDispatchAuthorityInput, { provenance: 'automation' }>> = {},
): Extract<CurrentDispatchAuthorityInput, { provenance: 'automation' }> {
    return {
        provenance: 'automation',
        readinessRevision: 'ready-r1',
        currentReadiness: true,
        gate1Passed: true,
        featureGatePassed: true,
        userWriteMasterArmed: true,
        strategyArmed: true,
        writeScope: automationWriteScope(),
        ...fingerprintSet(),
        ...overrides,
    };
}

function manualAuthority(
    state: 'available' | 'consumed' | 'expired' = 'available',
): Extract<CurrentDispatchAuthorityInput, { provenance: 'manual_user_confirmed' }> {
    return {
        provenance: 'manual_user_confirmed',
        readinessRevision: 'ready-r1',
        currentReadiness: true,
        routeCoveragePassed: true,
        confirmationId: 'confirmation-1',
        confirmationRevision: 7,
        confirmationState: state,
        writeScope: manualWriteScope(),
        ...fingerprintSet(),
    };
}

function vector(overrides: Partial<ExposureVector> = {}): ExposureVector {
    return {
        quantityShares: 0n,
        notionalMinorUnits: 0n,
        cashMinorUnits: 0n,
        positionShares: 0n,
        orderCount: 0n,
        ...overrides,
    };
}

describe('verified PnL policy and reconciliation', () => {
    it('requires complete sources and deterministic signed deal-ledger totals', async () => {
        const policy = await pnlPolicy();
        expect(policy.componentSources).toHaveLength(4);
        const deal = {
            dealId: 'deal-1',
            accountRef: 'account-A',
            tradeDate: TRADE_DATE,
            realizedMinorUnits: -1_000n,
            feeMinorUnits: 10n,
            transactionTaxMinorUnits: 5n,
        } as const;
        const forward = recalculatePnlTotals({
            deals: [deal, { ...deal }],
            unrealizedMinorUnits: 500n,
        });
        const reverse = recalculatePnlTotals({
            deals: [{ ...deal }, deal],
            unrealizedMinorUnits: 500n,
        });
        expect(forward).toEqual(reverse);
        expect(forward.netMinorUnits).toBe(-515n);
        expect(() =>
            recalculatePnlTotals({
                deals: [deal, { ...deal, realizedMinorUnits: -999n }],
                unrealizedMinorUnits: 500n,
            }),
        ).toThrowError(SmartOrderRiskDomainError);
    });

    it('rejects untrusted, stale, prior-date and external-incomplete evidence', async () => {
        const policy = await pnlPolicy();
        const evidence = issueVerifiedPnlEvidenceForTest(
            pnlEvidenceInput(policy.policyDefinitionSha256),
        );
        const base = {
            policy,
            evidence,
            currentTradeDate: TRADE_DATE,
            expectedAccountSetRevision: 'accounts-r1',
            expectedIdentityGroupId: IDENTITY,
            time: riskTime(15_000),
        } as const;
        expect(evaluatePnlReadiness(base)).toMatchObject({ ready: true, ageMs: 5_000 });
        expect(
            evaluatePnlReadiness({ ...base, evidence: { ...evidence } }),
        ).toMatchObject({ ready: false, reason: 'untrusted_evidence' });
        expect(
            evaluatePnlReadiness({ ...base, time: riskTime(15_001) }),
        ).toMatchObject({ ready: false, reason: 'stale' });
        const prior = issueVerifiedPnlEvidenceForTest(
            pnlEvidenceInput(policy.policyDefinitionSha256, {
                tradeDate: taipeiTradeDate('2026-08-10'),
            }),
        );
        expect(evaluatePnlReadiness({ ...base, evidence: prior })).toMatchObject({
            ready: false,
            reason: 'trade_date_mismatch',
        });
        const incomplete = issueVerifiedPnlEvidenceForTest(
            pnlEvidenceInput(policy.policyDefinitionSha256, {
                includesExternalClientActivity: false,
            }),
        );
        expect(evaluatePnlReadiness({ ...base, evidence: incomplete })).toMatchObject({
            ready: false,
            reason: 'external_activity_missing',
        });
        const differentPolicyDefinition = issueVerifiedPnlEvidenceForTest(
            pnlEvidenceInput(OTHER_DIGEST),
        );
        expect(
            evaluatePnlReadiness({
                ...base,
                evidence: differentPolicyDefinition,
            }),
        ).toMatchObject({
            ready: false,
            reason: 'policy_definition_mismatch',
        });
        expect(
            evaluatePnlReadiness({ ...base, policy: { ...base.policy } }),
        ).toMatchObject({ ready: false, reason: 'policy_untrusted' });
        expect(
            evaluatePnlReadiness({ ...base, time: { ...base.time } }),
        ).toMatchObject({ ready: false, reason: 'time_untrusted_or_stale' });
        const nextGeneration = riskTime(15_000);
        const mismatchedEvidence = issueVerifiedPnlEvidenceForTest(
            pnlEvidenceInput(policy.policyDefinitionSha256, {
                apiGeneration: 'api-generation-old',
            }),
        );
        expect(
            evaluatePnlReadiness({
                ...base,
                time: nextGeneration,
                evidence: mismatchedEvidence,
            }),
        ).toMatchObject({ ready: false, reason: 'runtime_generation_mismatch' });
    });

    it('preserves pre-runtime external losses and fails closed on incomplete full-day or cross-day reconciliation', async () => {
        const policy = await pnlPolicy();
        const preRuntimeExternalLoss = {
            dealId: 'external-before-midday-restart',
            accountRef: 'account-A',
            tradeDate: TRADE_DATE,
            realizedMinorUnits: -2_500n,
            feeMinorUnits: 30n,
            transactionTaxMinorUnits: 75n,
        } as const;
        const postRuntimeDeal = {
            dealId: 'runtime-after-midday-restart',
            accountRef: 'account-A',
            tradeDate: TRADE_DATE,
            realizedMinorUnits: 100n,
            feeMinorUnits: 5n,
            transactionTaxMinorUnits: 0n,
        } as const;
        const totals = recalculatePnlTotals({
            deals: [
                postRuntimeDeal,
                preRuntimeExternalLoss,
                { ...preRuntimeExternalLoss },
            ],
            unrealizedMinorUnits: 250n,
        });
        expect(
            recalculatePnlTotals({
                deals: [
                    { ...preRuntimeExternalLoss },
                    postRuntimeDeal,
                    preRuntimeExternalLoss,
                ],
                unrealizedMinorUnits: 250n,
            }),
        ).toEqual(totals);
        expect(totals).toEqual({
            realizedMinorUnits: -2_400n,
            unrealizedMinorUnits: 250n,
            feeMinorUnits: 35n,
            transactionTaxMinorUnits: 75n,
            netMinorUnits: -2_260n,
        });

        const evidence = issueVerifiedPnlEvidenceForTest(
            pnlEvidenceInput(policy.policyDefinitionSha256, {
                asOfEpochMs: 12_000,
                runtimeStartedAtEpochMs: 10_000,
                totals,
            }),
        );
        const base = {
            policy,
            evidence,
            currentTradeDate: TRADE_DATE,
            expectedAccountSetRevision: 'accounts-r1',
            expectedIdentityGroupId: IDENTITY,
            time: riskTime(12_500),
        } as const;
        expect(evaluatePnlReadiness(base)).toMatchObject({
            ready: true,
            totals: { netMinorUnits: -2_260n },
        });

        const incompleteCases = [
            [
                { fullDayAccountScopedCoverage: false },
                'full_day_coverage_missing',
            ],
            [{ includesPreRuntimeActivity: false }, 'pre_runtime_activity_missing'],
            [
                { includesExternalClientActivity: false },
                'external_activity_missing',
            ],
            [
                { allAccountsReconciled: false },
                'account_reconciliation_incomplete',
            ],
        ] as const;
        for (const [overrides, reason] of incompleteCases) {
            const incomplete = issueVerifiedPnlEvidenceForTest(
                pnlEvidenceInput(policy.policyDefinitionSha256, {
                    asOfEpochMs: 12_000,
                    runtimeStartedAtEpochMs: 10_000,
                    totals,
                    ...overrides,
                }),
            );
            expect(
                evaluatePnlReadiness({ ...base, evidence: incomplete }),
            ).toMatchObject({ ready: false, reason });
        }

        for (const missingComponent of ['fee', 'transaction_tax'] as const) {
            const incomplete = issueVerifiedPnlEvidenceForTest(
                pnlEvidenceInput(policy.policyDefinitionSha256, {
                    asOfEpochMs: 12_000,
                    runtimeStartedAtEpochMs: 10_000,
                    totals,
                    completeComponents: [
                        'realized',
                        'unrealized',
                        'fee',
                        'transaction_tax',
                    ].filter((component) => component !== missingComponent) as (
                        | 'realized'
                        | 'unrealized'
                        | 'fee'
                        | 'transaction_tax'
                    )[],
                }),
            );
            expect(
                evaluatePnlReadiness({ ...base, evidence: incomplete }),
            ).toEqual({
                ready: false,
                reason: 'component_missing',
                missingComponents: [missingComponent],
            });
        }

        const priorTradeDate = issueVerifiedPnlEvidenceForTest(
            pnlEvidenceInput(policy.policyDefinitionSha256, {
                tradeDate: taipeiTradeDate('2026-08-10'),
                asOfEpochMs: 12_000,
                runtimeStartedAtEpochMs: 10_000,
                totals,
                allAccountsReconciled: false,
            }),
        );
        expect(
            evaluatePnlReadiness({ ...base, evidence: priorTradeDate }),
        ).toMatchObject({ ready: false, reason: 'trade_date_mismatch' });
    });
});

describe('authenticated identity grouping', () => {
    it('derives only from verifier-issued principal evidence and key handles', async () => {
        const principal = await issueVerifiedCanonicalPrincipalForTest({
            canonicalPrincipal: 'broker-authenticated-principal',
            mappingRevision: 'mapping-r1',
            authorityRevision: 'broker-r1',
            accountSetSha256: DIGEST,
        });
        const handle = await issueIdentityKeyHandleForTest({
            identityKey: new Uint8Array(32).fill(7),
            keyRevision: 'key-r1',
        });
        const first = await deriveIdentityGroupId({
            principalEvidence: principal,
            identityKeyHandle: handle,
        });
        const second = await deriveIdentityGroupId({
            principalEvidence: principal,
            identityKeyHandle: handle,
        });
        expect(first).toBe(second);
        expect(first).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
        await expect(
            deriveIdentityGroupId({
                principalEvidence: { ...principal },
                identityKeyHandle: handle,
            }),
        ).rejects.toMatchObject({ code: 'untrusted_identity_evidence' });
        const conflicted = await issueVerifiedCanonicalPrincipalForTest({
            canonicalPrincipal: 'broker-authenticated-principal',
            mappingRevision: 'mapping-r2',
            authorityRevision: 'broker-r1',
            accountSetSha256: DIGEST,
            conflictState: 'conflict',
        });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: conflicted,
                identityKeyHandle: handle,
            }),
        ).rejects.toMatchObject({ code: 'untrusted_identity_evidence' });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: principal,
                identityKeyHandle: handle,
            }),
        ).rejects.toMatchObject({ code: 'untrusted_identity_evidence' });

        const remapped = await issueVerifiedCanonicalPrincipalForTest({
            canonicalPrincipal: 'broker-authenticated-principal',
            mappingRevision: 'mapping-r3',
            authorityRevision: 'broker-r2',
            accountSetSha256: DIGEST,
        });
        const rotatedHandle = await issueIdentityKeyHandleForTest({
            identityKey: new Uint8Array(32).fill(9),
            keyRevision: 'key-r2',
        });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: remapped,
                identityKeyHandle: handle,
            }),
        ).rejects.toMatchObject({ code: 'untrusted_identity_evidence' });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: remapped,
                identityKeyHandle: rotatedHandle,
            }),
        ).resolves.toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    });

    it('fails closed for key loss, stale key handles and account-set mapping collisions', async () => {
        await expect(
            issueIdentityKeyHandleForTest({
                identityKey: new Uint8Array(),
                keyRevision: 'key-missing',
            }),
        ).rejects.toMatchObject({ code: 'invalid_identity_key' });

        const principal = await issueVerifiedCanonicalPrincipalForTest({
            canonicalPrincipal: 'broker-principal-A',
            mappingRevision: 'mapping-collision-r1',
            authorityRevision: 'broker-authority-r1',
            accountSetSha256: OTHER_DIGEST,
        });
        const oldHandle = await issueIdentityKeyHandleForTest({
            identityKey: new Uint8Array(32).fill(11),
            keyRevision: 'key-before-loss',
        });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: principal,
                identityKeyHandle: oldHandle,
            }),
        ).resolves.toMatch(/^hmac-sha256:[0-9a-f]{64}$/);

        const replacementHandle = await issueIdentityKeyHandleForTest({
            identityKey: new Uint8Array(32).fill(12),
            keyRevision: 'key-after-recovery',
        });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: principal,
                identityKeyHandle: oldHandle,
            }),
        ).rejects.toMatchObject({ code: 'untrusted_identity_evidence' });

        const conflicted = await issueVerifiedCanonicalPrincipalForTest({
            canonicalPrincipal: 'broker-principal-B',
            mappingRevision: 'mapping-collision-r2',
            authorityRevision: 'broker-authority-r2',
            accountSetSha256: OTHER_DIGEST,
            conflictState: 'conflict',
        });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: principal,
                identityKeyHandle: replacementHandle,
            }),
        ).rejects.toMatchObject({ code: 'untrusted_identity_evidence' });
        await expect(
            deriveIdentityGroupId({
                principalEvidence: conflicted,
                identityKeyHandle: replacementHandle,
            }),
        ).rejects.toMatchObject({ code: 'untrusted_identity_evidence' });
    });
});

describe('verified provenance-specific gate manifests', () => {
    it('derives provenance from verifier-issued manifest and current authority', async () => {
        const manifest = await issueVerifiedGateManifestForTest(gateInput('automation'));
        const time = riskTime(10_000);
        const authority = issueCurrentDispatchAuthorityForTest(
            automationAuthority(),
            time,
        );
        expect(
            evaluateGateManifest({
                manifest,
                authority,
                time,
                expectedWriteScope: automationWriteScope(),
            }),
        ).toMatchObject({
            allowed: true,
            provenance: 'automation',
            readinessRevision: 'ready-r1',
        });
        const staleFingerprint = issueCurrentDispatchAuthorityForTest(
            automationAuthority({ buildSha256: OTHER_DIGEST }),
            time,
        );
        expect(
            evaluateGateManifest({
                manifest,
                authority: staleFingerprint,
                time,
                expectedWriteScope: automationWriteScope(),
            }),
        ).toMatchObject({ allowed: false, reasons: ['fingerprint_mismatch'] });
        expect(
            evaluateGateManifest({
                manifest,
                authority,
                time,
                expectedWriteScope: {
                    ...automationWriteScope(),
                    accountIdRef: 'account-B',
                },
            }),
        ).toMatchObject({ allowed: false, reasons: ['write_scope_mismatch'] });
    });

    it('rejects forged manifests, provenance mismatch and consumed confirmation', async () => {
        const automation = await issueVerifiedGateManifestForTest(gateInput('automation'));
        const time = riskTime(10_000);
        expect(
            evaluateGateManifest({
                manifest: { ...automation },
                authority: issueCurrentDispatchAuthorityForTest(
                    automationAuthority(),
                    time,
                ),
                time,
                expectedWriteScope: automationWriteScope(),
            }),
        ).toMatchObject({ allowed: false, reasons: ['manifest_untrusted'] });
        expect(
            evaluateGateManifest({
                manifest: automation,
                authority: issueCurrentDispatchAuthorityForTest(
                    manualAuthority(),
                    time,
                ),
                time,
                expectedWriteScope: automationWriteScope(),
            }),
        ).toMatchObject({
            allowed: false,
            reasons: expect.arrayContaining([
                'provenance_mismatch',
                'write_scope_mismatch',
            ]),
        });

        const manual = await issueVerifiedGateManifestForTest(
            gateInput('manual_user_confirmed'),
        );
        expect(
            evaluateGateManifest({
                manifest: manual,
                authority: issueCurrentDispatchAuthorityForTest(
                    manualAuthority('available'),
                    time,
                ),
                time,
                expectedWriteScope: manualWriteScope(),
            }),
        ).toMatchObject({
            allowed: true,
            atomicConsume: {
                kind: 'manual_confirmation',
                id: 'confirmation-1',
                revision: 7,
            },
        });
        expect(
            evaluateGateManifest({
                manifest: manual,
                authority: issueCurrentDispatchAuthorityForTest(
                    manualAuthority('consumed'),
                    time,
                ),
                time,
                expectedWriteScope: manualWriteScope(),
            }),
        ).toMatchObject({
            allowed: false,
            reasons: ['manual_confirmation_unavailable'],
        });
        const nextRuntime = issueRiskEvaluationTimeForTest({
            runtimeEpochId: 'runtime-epoch-2',
            apiGeneration: 'api-generation-2',
            clockRevision: 'clock-r2',
            nowEpochMs: 10_001,
        });
        expect(
            evaluateGateManifest({
                manifest: automation,
                authority: issueCurrentDispatchAuthorityForTest(
                    automationAuthority(),
                    time,
                ),
                time: nextRuntime,
                expectedWriteScope: automationWriteScope(),
            }),
        ).toMatchObject({
            allowed: false,
            reasons: expect.arrayContaining([
                'authority_stale_or_generation_mismatch',
            ]),
        });
    });
});

describe('immutable manual and automation order-class matrix', () => {
    it('strictly validates, deep-freezes and keeps automation narrower', async () => {
        const manualClass: CanonicalOrderClass = {
            orderCond: 'Cash',
            orderLot: 'IntradayOdd',
            priceType: 'LMT',
            orderType: 'FOK',
            side: 'Buy',
            daytradeShort: false,
        };
        const automationClass: CanonicalOrderClass = {
            orderCond: 'Cash',
            orderLot: 'Common',
            priceType: 'LMT',
            orderType: 'ROD',
            side: 'Buy',
            daytradeShort: false,
        };
        const matrix = await issueVerifiedOrderClassMatrixForTest({
            matrixRevision: 'matrix-r1',
            routeCoverageSha256: DIGEST,
            adapterSha256: DIGEST,
            entries: [
                {
                    provenance: 'manual_user_confirmed',
                    routeId: 'manual.ticket.place',
                    orderClass: manualClass,
                    enabled: true,
                    evidenceRevision: 'manual-r1',
                },
                {
                    provenance: 'automation',
                    routeId: 'automation.smart.place',
                    orderClass: automationClass,
                    enabled: true,
                    evidenceRevision: 'automation-r1',
                },
            ],
        });
        (manualClass as { orderLot: CanonicalOrderClass['orderLot'] }).orderLot =
            'Common';
        expect(matrix.entries[0]!.orderClass.orderLot).toBe('IntradayOdd');
        const time = riskTime(10_000);
        const authority = issueCurrentDispatchAuthorityForTest(
            automationAuthority({
                orderClassMatrixRevision: matrix.matrixRevision,
                orderClassMatrixSha256: matrix.matrixDefinitionSha256,
            }),
            time,
        );
        expect(
            evaluateOrderClass({
                matrix,
                authority,
                time,
                routeId: 'automation.smart.place',
                orderClass: automationClass,
            }).supported,
        ).toBe(true);
        expect(
            evaluateOrderClass({
                matrix,
                authority,
                time,
                routeId: 'automation.smart.place',
                orderClass: { ...automationClass, orderLot: 'Odd' },
            }),
        ).toMatchObject({ supported: false, reason: 'automation_cash_common_only' });
        const plainMatrix = createOrderClassMatrix({
            matrixRevision: 'plain-r1',
            routeCoverageSha256: DIGEST,
            adapterSha256: DIGEST,
            entries: matrix.entries,
        });
        expect(
            evaluateOrderClass({
                matrix: plainMatrix as unknown as VerifiedOrderClassMatrix,
                authority,
                time,
                routeId: 'automation.smart.place',
                orderClass: automationClass,
            }),
        ).toMatchObject({ supported: false, reason: 'matrix_untrusted' });
        const mismatchedAuthority = issueCurrentDispatchAuthorityForTest(
            automationAuthority({ adapterSha256: OTHER_DIGEST }),
            time,
        );
        expect(
            evaluateOrderClass({
                matrix,
                authority: mismatchedAuthority,
                time,
                routeId: 'automation.smart.place',
                orderClass: automationClass,
            }),
        ).toMatchObject({
            supported: false,
            reason: 'authority_matrix_mismatch',
        });
        const staleMatrixAuthority = issueCurrentDispatchAuthorityForTest(
            automationAuthority({
                orderClassMatrixRevision: matrix.matrixRevision,
                orderClassMatrixSha256: OTHER_DIGEST,
            }),
            time,
        );
        expect(
            evaluateOrderClass({
                matrix,
                authority: staleMatrixAuthority,
                time,
                routeId: 'automation.smart.place',
                orderClass: automationClass,
            }),
        ).toMatchObject({
            supported: false,
            reason: 'authority_matrix_mismatch',
        });
        expect(() =>
            createOrderClassMatrix({
                matrixRevision: 'bad',
                routeCoverageSha256: DIGEST,
                adapterSha256: DIGEST,
                entries: [
                    {
                        provenance: 'automation',
                        routeId: 'bad',
                        orderClass: {
                            ...automationClass,
                            priceType: 'UNKNOWN',
                        } as unknown as CanonicalOrderClass,
                        enabled: true,
                        evidenceRevision: 'bad',
                    },
                ],
            }),
        ).toThrowError(SmartOrderRiskDomainError);
    });

    it('preserves a verified manual FOK odd-lot route without admitting it as automation', async () => {
        const manualOnlyClass: CanonicalOrderClass = {
            orderCond: 'Cash',
            orderLot: 'IntradayOdd',
            priceType: 'LMT',
            orderType: 'FOK',
            side: 'Buy',
            daytradeShort: false,
        };
        const matrix = await issueVerifiedOrderClassMatrixForTest({
            matrixRevision: 'manual-regression-r1',
            routeCoverageSha256: DIGEST,
            adapterSha256: DIGEST,
            entries: [
                {
                    provenance: 'manual_user_confirmed',
                    routeId: 'manual.ticket.place',
                    orderClass: manualOnlyClass,
                    enabled: true,
                    evidenceRevision: 'manual-fok-odd-r1',
                },
                {
                    provenance: 'automation',
                    routeId: 'automation.smart.place',
                    orderClass: manualOnlyClass,
                    enabled: true,
                    evidenceRevision: 'adversarial-automation-r1',
                },
            ],
        });
        const time = riskTime(10_000);
        const manual = issueCurrentDispatchAuthorityForTest(
            {
                ...manualAuthority(),
                orderClassMatrixRevision: matrix.matrixRevision,
                orderClassMatrixSha256: matrix.matrixDefinitionSha256,
            },
            time,
        );
        expect(
            evaluateOrderClass({
                matrix,
                authority: manual,
                time,
                routeId: 'manual.ticket.place',
                orderClass: manualOnlyClass,
            }),
        ).toMatchObject({ supported: true });

        const automation = issueCurrentDispatchAuthorityForTest(
            automationAuthority({
                orderClassMatrixRevision: matrix.matrixRevision,
                orderClassMatrixSha256: matrix.matrixDefinitionSha256,
            }),
            time,
        );
        expect(
            evaluateOrderClass({
                matrix,
                authority: automation,
                time,
                routeId: 'automation.smart.place',
                orderClass: manualOnlyClass,
            }),
        ).toMatchObject({
            supported: false,
            reason: 'automation_cash_common_only',
        });
    });
});

describe('worst-case entry reservation', () => {
    const policy = issueVerifiedExposureLimitPolicyForTest({
        policyRevision: 'risk-r1',
        policyDefinitionSha256: DIGEST,
        reservedDimensions: ['notional_minor_units'],
        noReservableDimensions: false,
        perAccountLimits: { notional_minor_units: 1_500n },
        identityGroupLimits: { notional_minor_units: 2_000n },
    });

    async function seedLedger(): Promise<EntryExposureLedger> {
        const baseline = issueVerifiedExposureBaselineForTest({
            identityGroupId: IDENTITY,
            policy,
            sourceRevision: 'baseline-r1',
            identityExposure: vector({ notionalMinorUnits: 200n }),
            accountExposure: {
                'account-A': vector({ notionalMinorUnits: 100n }),
                'account-B': vector({ notionalMinorUnits: 100n }),
            },
        });
        return issueVerifiedEntryExposureLedgerForTest({
            revision: 0,
            identityGroupId: IDENTITY,
            policy,
            baseline,
            reservations: [],
        });
    }

    async function reservation(id: string, accountRef: string, notional = 1_000n) {
        const exposure = await issueVerifiedWorstCaseExposureForTest({
            quantityShares: 1n,
            worstPriceMinorPerShare: notional,
            feeMinorUnits: 0n,
            transactionTaxMinorUnits: 0n,
            orderDefinitionSha256: DIGEST,
            policy,
        });
        return createEntryExposureReservation({
            reservationId: entryExposureReservationId(id),
            strategyId: `strategy-${id}`,
            accountRef,
            identityGroupId: IDENTITY,
            exposure,
        });
    }

    it('checks account and identity aggregates using trusted worst-case exposure', async () => {
        const first = reserveWorstCaseEntry({
            policy,
            ledger: await seedLedger(),
            expectedRevision: 0,
            reservation: await reservation('one', 'account-A'),
        });
        expect(first).toMatchObject({ allowed: true });
        if (!first.allowed) throw new Error('first reservation must pass');
        expect(first.accountAggregate.notionalMinorUnits).toBe(1_100n);
        expect(first.identityAggregate.notionalMinorUnits).toBe(1_200n);
        expect(first.atomicCommit).toEqual({
            expectedLedgerRevision: 0,
            nextLedgerRevision: 1,
            reservationId: 'one',
            companions: [
                'order_intent_prepared',
                'entry_exposure_reservation_created',
            ],
        });
        expect(
            reserveWorstCaseEntry({
                policy,
                ledger: first.nextLedger,
                expectedRevision: 1,
                reservation: await reservation('two', 'account-A'),
            }),
        ).toMatchObject({
            allowed: false,
            reason: 'account_limit_exceeded',
        });
        expect(
            reserveWorstCaseEntry({
                policy,
                ledger: first.nextLedger,
                expectedRevision: 1,
                reservation: await reservation('three', 'account-B'),
            }),
        ).toMatchObject({
            allowed: false,
            reason: 'identity_limit_exceeded',
        });
    });

    it('cannot inject a released candidate, forge exposure or exceed persistence bounds', async () => {
        const ledger = await seedLedger();
        const canonical = await reservation('one', 'account-A', 100n);
        expect(() =>
            reserveWorstCaseEntry({
                policy,
                ledger,
                expectedRevision: 0,
                reservation: { ...canonical, state: 'released' },
            }),
        ).toThrowError(SmartOrderRiskDomainError);
        const exposure = await issueVerifiedWorstCaseExposureForTest({
            quantityShares: 1n,
            worstPriceMinorPerShare: 100n,
            feeMinorUnits: 0n,
            transactionTaxMinorUnits: 0n,
            orderDefinitionSha256: DIGEST,
            policy,
        });
        expect(() =>
            createEntryExposureReservation({
                reservationId: entryExposureReservationId('forged'),
                strategyId: 'strategy-forged',
                accountRef: 'account-A',
                identityGroupId: IDENTITY,
                exposure: { ...exposure },
            }),
        ).toThrowError(SmartOrderRiskDomainError);
        await expect(
            issueVerifiedWorstCaseExposureForTest({
                quantityShares: SMART_ORDER_MAX_EXPOSURE_VALUE + 1n,
                worstPriceMinorPerShare: 1n,
                feeMinorUnits: 0n,
                transactionTaxMinorUnits: 0n,
                orderDefinitionSha256: DIGEST,
                policy,
            }),
        ).rejects.toBeInstanceOf(SmartOrderRiskDomainError);
    });

    it('rejects cloned policy, omitted-ledger history and mutated reservation exposure', async () => {
        const first = reserveWorstCaseEntry({
            policy,
            ledger: await seedLedger(),
            expectedRevision: 0,
            reservation: await reservation('bound-one', 'account-A', 100n),
        });
        if (!first.allowed) throw new Error('first reservation must pass');
        const second = await reservation('bound-two', 'account-A', 100n);
        const third = await reservation('bound-three', 'account-A', 100n);

        expect(() =>
            reserveWorstCaseEntry({
                policy: { ...policy },
                ledger: first.nextLedger,
                expectedRevision: 1,
                reservation: second,
            }),
        ).toThrowError(SmartOrderRiskDomainError);

        const missingAccount = await reservation(
            'missing-account',
            'account-not-in-baseline',
            100n,
        );
        expect(() =>
            reserveWorstCaseEntry({
                policy,
                ledger: first.nextLedger,
                expectedRevision: 1,
                reservation: missingAccount,
            }),
        ).toThrowError(SmartOrderRiskDomainError);

        const maxRevisionLedger = issueVerifiedEntryExposureLedgerForTest({
            revision: Number.MAX_SAFE_INTEGER,
            identityGroupId: IDENTITY,
            policy,
            baseline: first.nextLedger.baseline,
            reservations: first.nextLedger.reservations,
        });
        const overflowReservation = await reservation(
            'overflow',
            'account-A',
            100n,
        );
        expect(() =>
            reserveWorstCaseEntry({
                policy,
                ledger: maxRevisionLedger,
                expectedRevision: Number.MAX_SAFE_INTEGER,
                reservation: overflowReservation,
            }),
        ).toThrowError(SmartOrderRiskDomainError);

        expect(() =>
            reserveWorstCaseEntry({
                policy,
                ledger: {
                    ...first.nextLedger,
                    reservations: [],
                },
                expectedRevision: 1,
                reservation: third,
            }),
        ).toThrowError(SmartOrderRiskDomainError);

        const canonical = await reservation('bound-four', 'account-A', 100n);
        expect(() =>
            reserveWorstCaseEntry({
                policy,
                ledger: first.nextLedger,
                expectedRevision: 1,
                reservation: {
                    ...canonical,
                    worstCase: vector(),
                },
            }),
        ).toThrowError(SmartOrderRiskDomainError);
    });
});

describe('scoped distinct exit claims and tracked remainder', () => {
    let reconciliationGeneration = 0;

    function scope(
        overrides: Partial<Parameters<typeof issueVerifiedExitClaimScopeForTest>[0]> = {},
    ): VerifiedExitClaimScope {
        return issueVerifiedExitClaimScopeForTest({
            accountRef: 'account-A',
            contractKey: 'TSE:2330',
            positionLineageId: 'position-1',
            obligationId: 'obligation-1',
            remainderGeneration: 1,
            brokerConfirmedAvailableShares: shares(2_000),
            reconciliationGeneration: (reconciliationGeneration += 1),
            reconciliationRevision: 'reconcile-r1',
            time: riskTime(10_000),
            ...overrides,
        });
    }

    function projectExitClaims(input: {
        scope: VerifiedExitClaimScope;
        representations: Parameters<typeof projectDistinctExitClaims>[0]['representations'];
        time: ReturnType<typeof riskTime>;
        contextTime?: ReturnType<typeof riskTime>;
    }) {
        return projectDistinctExitClaims({
            scope: input.scope,
            representations: input.representations,
            time: input.time,
            context: issueVerifiedExitClaimProjectionContextForTest({
                scope: input.scope,
                time: input.contextTime ?? input.time,
            }),
        });
    }

    function representation(input: {
        scope: VerifiedExitClaimScope;
        claimId: string;
        state: 'monitoring_reserved' | 'intent_reserved' | 'broker_working' | 'unknown';
        kind?: 'runtime' | 'external';
        start?: number;
        quantity?: number;
        validUntil?: number;
    }) {
        const claimId = exitClaimId(input.claimId);
        const representationKind = input.kind ?? 'runtime';
        const allocationStartShare = shares(input.start ?? 0);
        const quantityShares = shares(input.quantity ?? 1_000);
        const evidence = issueVerifiedExitClaimEvidenceForTest({
            scope: input.scope,
            claimId,
            kind:
                input.state === 'broker_working'
                    ? 'broker_reconciliation'
                    : 'runtime_readiness',
            representationKind,
            allocationStartShare,
            quantityShares,
            state: input.state,
            asOfEpochMs: 9_000,
            validUntilEpochMs: input.validUntil ?? 11_000,
            evidenceRevision: `${input.claimId}-${input.state}`,
        });
        return {
            claimId,
            kind: representationKind,
            accountRef: input.scope.accountRef,
            contractKey: input.scope.contractKey,
            positionLineageId: input.scope.positionLineageId,
            obligationId: input.scope.obligationId,
            remainderGeneration: input.scope.remainderGeneration,
            allocationStartShare,
            quantityShares,
            state: input.state,
            evidence,
        } as const;
    }

    it('counts one claim lineage once across its three active representations', () => {
        const target = scope();
        const projection = projectExitClaims({
            scope: target,
            time: riskTime(10_000),
            representations: [
                representation({ scope: target, claimId: 'claim-1', state: 'monitoring_reserved' }),
                representation({ scope: target, claimId: 'claim-1', state: 'intent_reserved' }),
                representation({ scope: target, claimId: 'claim-1', state: 'broker_working' }),
            ],
        });
        expect(projection).toMatchObject({
            valid: true,
            runtimeReservedShares: 1_000n,
            runtimeActivelyCoveredShares: 1_000n,
            distinctClaimCount: 1,
        });
        expect(
            calculateRuntimeTrackedUnprotectedRemainder({
                filledShares: shares(2_000),
                confirmedExitedShares: shares(500),
                projection,
            }),
        ).toMatchObject({
            runtimeTrackedUnprotectedRemainder: 500n,
            invariantStatus: 'consistent',
        });
    });

    it('blocks scope drift, overlapping slices and stale evidence', () => {
        const target = scope();
        const other = scope({ accountRef: 'account-B' });
        expect(
            projectExitClaims({
                scope: target,
                time: riskTime(10_000),
                representations: [
                    representation({ scope: other, claimId: 'other', state: 'monitoring_reserved' }),
                ],
            }),
        ).toMatchObject({ valid: false, blocker: 'scope_mismatch' });
        expect(
            projectExitClaims({
                scope: target,
                time: riskTime(10_000),
                representations: [
                    representation({ scope: target, claimId: 'a', state: 'monitoring_reserved', start: 0, quantity: 1_000 }),
                    representation({ scope: target, claimId: 'b', state: 'monitoring_reserved', start: 500, quantity: 1_000 }),
                ],
            }),
        ).toMatchObject({ valid: false, blocker: 'overlapping_allocation' });
        expect(
            projectExitClaims({
                scope: target,
                time: riskTime(12_000),
                representations: [
                    representation({ scope: target, claimId: 'stale', state: 'monitoring_reserved' }),
                ],
            }),
        ).toMatchObject({ valid: false, blocker: 'untrusted_or_stale_evidence' });
    });

    it('binds evidence to representation kind, allocation, quantity and reconciliation revision', () => {
        const target = scope();
        const canonical = representation({
            scope: target,
            claimId: 'bound-claim',
            state: 'monitoring_reserved',
            start: 100,
            quantity: 500,
        });
        for (const forged of [
            { ...canonical, kind: 'external' as const },
            { ...canonical, allocationStartShare: shares(101) },
            { ...canonical, quantityShares: shares(499) },
        ]) {
            expect(
                projectExitClaims({
                    scope: target,
                    time: riskTime(10_000),
                    representations: [forged],
                }),
            ).toMatchObject({
                valid: false,
                blocker: 'untrusted_or_stale_evidence',
            });
        }
        const revisedScope = scope({ reconciliationRevision: 'reconcile-r2' });
        expect(
            projectExitClaims({
                scope: revisedScope,
                time: riskTime(10_000),
                representations: [canonical],
            }),
        ).toMatchObject({
            valid: false,
            blocker: 'untrusted_or_stale_evidence',
        });
        const runtimeTarget = scope();
        const runtimeRepresentation = representation({
            scope: runtimeTarget,
            claimId: 'runtime-bound',
            state: 'monitoring_reserved',
        });
        const nextRuntime = issueRiskEvaluationTimeForTest({
            runtimeEpochId: 'runtime-epoch-next',
            apiGeneration: 'api-generation-next',
            clockRevision: 'clock-next',
            nowEpochMs: 10_000,
        });
        expect(
            projectExitClaims({
                scope: runtimeTarget,
                time: nextRuntime,
                contextTime: riskTime(10_000),
                representations: [runtimeRepresentation],
            }),
        ).toMatchObject({
            valid: false,
            blocker: 'untrusted_or_stale_evidence',
        });
    });

    it('clamps overcoverage to zero and returns a durable blocker signal', () => {
        const target = scope();
        const projection = projectExitClaims({
            scope: target,
            time: riskTime(10_000),
            representations: [
                representation({ scope: target, claimId: 'claim-1', state: 'broker_working' }),
            ],
        });
        expect(
            calculateRuntimeTrackedUnprotectedRemainder({
                filledShares: shares(1_000),
                confirmedExitedShares: shares(500),
                projection,
            }),
        ).toMatchObject({
            runtimeTrackedUnprotectedRemainder: 0n,
            overcoverageShares: 500n,
            invariantStatus: 'overcovered',
        });
    });

    it('never converts an unknown claim into numeric consistent coverage', () => {
        const target = scope();
        const projection = projectExitClaims({
            scope: target,
            time: riskTime(10_000),
            representations: [
                representation({
                    scope: target,
                    claimId: 'unknown-claim',
                    state: 'unknown',
                }),
            ],
        });
        expect(projection).toMatchObject({ valid: true, hasUnknown: true });
        expect(
            calculateRuntimeTrackedUnprotectedRemainder({
                filledShares: shares(1_000),
                confirmedExitedShares: shares(0),
                projection,
            }),
        ).toMatchObject({
            activelyCoveredShares: 'unknown',
            runtimeTrackedUnprotectedRemainder: 'unknown',
            invariantStatus: 'projection_blocked',
            blocker: 'unknown_claim',
        });
    });

    it('binds the latest reconciliation head to remainder and available shares', () => {
        const target = scope();
        expect(() =>
            issueVerifiedExitClaimScopeForTest({
                accountRef: target.accountRef,
                contractKey: target.contractKey,
                positionLineageId: target.positionLineageId,
                obligationId: target.obligationId,
                remainderGeneration: target.remainderGeneration + 1,
                brokerConfirmedAvailableShares: shares(1_500),
                reconciliationGeneration: target.reconciliationGeneration,
                reconciliationRevision: target.reconciliationRevision,
                time: riskTime(10_000),
            }),
        ).toThrowError(SmartOrderRiskDomainError);
    });

    it('rejects external claims that masquerade as runtime reservations', () => {
        const target = scope();
        expect(
            projectExitClaims({
                scope: target,
                time: riskTime(10_000),
                representations: [
                    representation({
                        scope: target,
                        claimId: 'external-runtime-reservation',
                        state: 'monitoring_reserved',
                        kind: 'external',
                    }),
                ],
            }),
        ).toMatchObject({
            valid: false,
            blocker: 'untrusted_or_stale_evidence',
        });
    });

    it('consumes projection context once and invalidates an older reconciliation head', () => {
        const target = scope();
        const time = riskTime(10_000);
        const claim = representation({
            scope: target,
            claimId: 'one-shot',
            state: 'monitoring_reserved',
        });
        const context = issueVerifiedExitClaimProjectionContextForTest({
            scope: target,
            time,
        });
        expect(
            projectDistinctExitClaims({
                scope: target,
                time,
                context,
                representations: [claim],
            }),
        ).toMatchObject({ valid: true });
        expect(
            projectDistinctExitClaims({
                scope: target,
                time,
                context,
                representations: [claim],
            }),
        ).toMatchObject({
            valid: false,
            blocker: 'untrusted_or_stale_evidence',
        });

        scope({ reconciliationRevision: 'reconcile-new-head' });
        expect(() =>
            issueVerifiedExitClaimProjectionContextForTest({
                scope: target,
                time: riskTime(10_000),
            }),
        ).toThrowError(SmartOrderRiskDomainError);
    });
});
