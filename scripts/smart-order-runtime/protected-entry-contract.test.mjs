import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
    canonicalProtectedEntryIntentPayload,
    canonicalProtectedEntryPlan,
    deriveProtectedEntryFormalProtection,
} from './protected-entry-contract.mjs';

const CONFIRMATION = `sha256:${'a'.repeat(64)}`;
const ATR_COMPLETENESS = `sha256:${'b'.repeat(64)}`;
const ATR_SOURCE = `sha256:${'c'.repeat(64)}`;

function fixedPlan(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        confirmationSnapshotHash: CONFIRMATION,
        contractKey: 'TSE:2330:STK:Common',
        contractPricePolicy: {
            categoryCode: '24',
            limitDownMinorUnits: 9000,
            limitUpMinorUnits: 11000,
        },
        modeRevision: 'api-generation-1',
        riskRevision: 'risk-policy-1',
        riskPolicy: {
            schemaVersion:
                SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
            policyRevision: 'risk-policy-1',
            buyFeeBps: 15,
            minimumBuyFeeMinorUnits: 2_000,
            cashBufferMinorUnits: 0,
        },
        basis: {
            source: 'entry_weighted_average_fill',
            previewPrice: '100',
        },
        entryOrder: {
            side: 'Buy',
            orderCond: 'Cash',
            orderLot: 'Common',
            baseShares: 1_000,
            commonLots: 1,
            contractUnit: 1_000,
            priceType: 'LMT',
            timeInForce: 'ROD',
            limitPrice: '100',
        },
        fixedAtrSnapshot: null,
        protection: {
            family: 'fixed',
            legs: [
                {
                    legId: 'stop',
                    type: 'stop',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                    execution: {
                        priceType: 'MKT',
                        timeInForce: 'IOC',
                        limitPrice: null,
                    },
                },
            ],
        },
        ...overrides,
    };
}

function intentPayload(plan) {
    const canonicalPlan = canonicalProtectedEntryPlan(plan);
    return {
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
        confirmationSnapshotHash: plan.confirmationSnapshotHash,
        entryOrder: plan.entryOrder,
        protectionPlan: plan,
        protectionPlanSha256: canonicalPlan.planSha256,
    };
}

describe('protected entry canonical contract', () => {
    it('binds the complete plan and entry order into deterministic canonical hashes', () => {
        const plan = fixedPlan();
        const first = canonicalProtectedEntryPlan(plan);
        const second = canonicalProtectedEntryPlan(structuredClone(plan));
        const payload = canonicalProtectedEntryIntentPayload(intentPayload(plan));

        expect(second).toEqual(first);
        expect(first.baseShares).toBe(1_000);
        expect(first.worstCaseExposure).toEqual({
            quantityShares: 1_000,
            notionalMinorUnits: 10_000_000,
            cashMinorUnits: 10_015_000,
            positionShares: 1_000,
            orderCount: 1,
        });
        expect(payload.payload.protectionPlanSha256).toBe(first.planSha256);
        expect(payload.payload.protectionPlan).toEqual(first.plan);
        expect(Object.isFrozen(payload.payload)).toBe(true);
    });

    it('derives formal protection from cumulative fill weighted average without binary floats', () => {
        const formal = deriveProtectedEntryFormalProtection(
            fixedPlan(),
            2_000_000,
            200,
        );
        expect(formal).toMatchObject({
            schemaVersion:
                'smart-order-formal-protection/2026-08-13.2',
            cumulativeFilledShares: 200,
            weightedAverageBasis: {
                numeratorMinorUnits: '10000',
                denominator: '1',
            },
            fixedAtrSnapshotSha256: null,
            legs: [
                {
                    legId: 'stop',
                    comparator: 'lte',
                    triggerPrice: {
                        numeratorMinorUnits: '9700',
                        denominator: '1',
                    },
                },
            ],
        });
        expect(Object.isFrozen(formal.legs)).toBe(true);
    });

    it('keeps trailing retracement pending until a durable saved high exists', () => {
        const formal = deriveProtectedEntryFormalProtection(
            fixedPlan({
                protection: {
                    family: 'trailing',
                    legs: [
                        {
                            legId: 'activate',
                            type: 'trailing_activation',
                            comparator: 'gte',
                            distance: { kind: 'pct_bps', pctBps: 300 },
                            execution: {
                                priceType: 'MKT',
                                timeInForce: 'IOC',
                                limitPrice: null,
                            },
                        },
                        {
                            legId: 'retrace',
                            type: 'trailing_retracement',
                            comparator: 'lte',
                            distance: { kind: 'pct_bps', pctBps: 500 },
                            execution: {
                                priceType: 'LMT',
                                timeInForce: 'IOC',
                                limitPrice: '95',
                            },
                        },
                    ],
                },
            }),
            2_000_000,
            200,
        );

        expect(formal.legs).toEqual([
            expect.objectContaining({
                legId: 'activate',
                triggerState: 'formal',
                triggerBasis: 'weighted_average_fill',
                triggerPrice: {
                    numeratorMinorUnits: '10300',
                    denominator: '1',
                },
            }),
            expect.objectContaining({
                legId: 'retrace',
                triggerState: 'pending_saved_high',
                triggerBasis: 'durable_saved_high',
                triggerPrice: null,
                distance: { kind: 'pct_bps', pctBps: 500 },
            }),
        ]);
        expect(Object.isFrozen(formal.legs[1].distance)).toBe(true);
    });

    it('rejects quantity, confirmation, risk, and canonical-plan hash drift', () => {
        const quantityDrift = fixedPlan();
        quantityDrift.entryOrder.commonLots = 2;
        expect(() => canonicalProtectedEntryPlan(quantityDrift)).toThrow(
            'quantity tuple is inconsistent',
        );

        const plan = fixedPlan();
        const payload = intentPayload(plan);
        expect(() =>
            canonicalProtectedEntryIntentPayload({
                ...payload,
                confirmationSnapshotHash: `sha256:${'d'.repeat(64)}`,
            }),
        ).toThrow('confirmationSnapshotHash');
        expect(() =>
            canonicalProtectedEntryIntentPayload({
                ...payload,
                protectionPlan: { ...plan, riskRevision: 'risk-policy-2' },
            }),
        ).toThrow('riskPolicy version or revision');
        expect(() =>
            canonicalProtectedEntryIntentPayload({
                ...payload,
                protectionPlanSha256: `sha256:${'e'.repeat(64)}`,
            }),
        ).toThrow('protectionPlanSha256');
    });

    it('accepts a complete fixed ATR(14) trailing plan and rejects incomplete leg sets', () => {
        const plan = fixedPlan({
            fixedAtrSnapshot: {
                algorithmVersion: 'wilder-atr-14/v1',
                asOfTradingDate: '2026-08-12',
                completenessSha256: ATR_COMPLETENESS,
                period: 14,
                sourceSha256: ATR_SOURCE,
                timeframe: '1d',
                value: '4.25',
            },
            protection: {
                family: 'trailing',
                legs: [
                    {
                        legId: 'activate',
                        type: 'trailing_activation',
                        comparator: 'gte',
                        distance: {
                            kind: 'fixed_atr',
                            atrSnapshotSha256: ATR_SOURCE,
                            multiplier: '1.5',
                        },
                        execution: {
                            priceType: 'MKT',
                            timeInForce: 'IOC',
                            limitPrice: null,
                        },
                    },
                    {
                        legId: 'retrace',
                        type: 'trailing_retracement',
                        comparator: 'lte',
                        distance: { kind: 'pct_bps', pctBps: 500 },
                        execution: {
                            priceType: 'LMT',
                            timeInForce: 'IOC',
                            limitPrice: '95',
                        },
                    },
                ],
            },
        });
        expect(canonicalProtectedEntryPlan(plan).plan.protection.family).toBe(
            'trailing',
        );

        const incomplete = structuredClone(plan);
        incomplete.protection.legs.pop();
        expect(() => canonicalProtectedEntryPlan(incomplete)).toThrow(
            'leg set conflicts',
        );
    });

    it('rejects Proxy, accessor, sparse-array, and extra-field inputs without reading getters', () => {
        let getterReads = 0;
        const accessorPlan = fixedPlan();
        Object.defineProperty(accessorPlan, 'riskRevision', {
            enumerable: true,
            get() {
                getterReads += 1;
                return 'risk-policy-1';
            },
        });
        expect(() => canonicalProtectedEntryPlan(accessorPlan)).toThrow(
            'own data property',
        );
        expect(getterReads).toBe(0);
        expect(() => canonicalProtectedEntryPlan(new Proxy(fixedPlan(), {}))).toThrow(
            'non-Proxy',
        );

        const sparse = fixedPlan();
        sparse.protection.legs.length = 2;
        expect(() => canonicalProtectedEntryPlan(sparse)).toThrow('dense array');
        expect(() =>
            canonicalProtectedEntryPlan({ ...fixedPlan(), unexpected: true }),
        ).toThrow('versioned schema');
    });
});
