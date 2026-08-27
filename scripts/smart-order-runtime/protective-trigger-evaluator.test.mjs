import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
    deriveProtectedEntryFormalProtection,
} from './protected-entry-contract.mjs';
import { evaluateSmartOrderProtectiveTrigger } from './protective-trigger-evaluator.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function plan(protection) {
    return {
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
        accountBrokerRef: 'S',
        accountIdRef: 'fixed-account',
        contractKey: 'TSE:STK:2330',
        confirmationSnapshotHash: DIGEST,
        modeRevision: 'simulation-generation-1',
        contractPricePolicy: {
            categoryCode: '24',
            limitDownMinorUnits: 9000,
            limitUpMinorUnits: 11000,
        },
        riskRevision: 'risk-1',
        basis: { source: 'entry_weighted_average_fill', previewPrice: '100' },
        entryOrder: {
            side: 'Buy',
            orderCond: 'Cash',
            orderLot: 'Common',
            priceType: 'LMT',
            timeInForce: 'ROD',
            limitPrice: '100',
            commonLots: 1,
            contractUnit: 1000,
            baseShares: 1000,
        },
        fixedAtrSnapshot: {
            algorithmVersion: 'wilder-atr-14/v1',
            asOfTradingDate: '2026-08-20',
            completenessSha256: DIGEST,
            period: 14,
            sourceSha256: DIGEST,
            timeframe: '1d',
            value: '4',
        },
        protection,
        riskPolicy: {
            schemaVersion: SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
            policyRevision: 'risk-1',
            buyFeeBps: 15,
            minimumBuyFeeMinorUnits: 20,
            cashBufferMinorUnits: 0,
        },
    };
}

function evaluate(protectionPlan, observedPrice, previousHead = null) {
    return evaluateSmartOrderProtectiveTrigger({
        formalProtection: deriveProtectedEntryFormalProtection(
            protectionPlan,
            10_000_000,
            1000,
        ),
        observedPrice,
        previousHead,
        protectionPlan,
    });
}

describe('protective trigger evaluator', () => {
    it('evaluates fixed integer-bps and absolute legs as one OCO observation', () => {
        const protectionPlan = plan({
            family: 'fixed',
            legs: [
                {
                    legId: 'stop',
                    type: 'stop',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 500 },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
                {
                    legId: 'take',
                    type: 'take',
                    comparator: 'gte',
                    distance: { kind: 'absolute', value: '5' },
                    execution: { priceType: 'LMT', timeInForce: 'ROD', limitPrice: '105' },
                },
            ],
        });
        expect(evaluate(protectionPlan, '95').triggeredLegIds).toEqual(['stop']);
        expect(evaluate(protectionPlan, '105').triggeredLegIds).toEqual(['take']);
        expect(evaluate(protectionPlan, '100').nextState).toBe('monitoring');
    });

    it('applies directional canonical stock ticks before comparing the live trade', () => {
        const fixedPlan = plan({
            family: 'fixed',
            legs: [
                {
                    legId: 'rounded-stop',
                    type: 'stop',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 333 },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
                {
                    legId: 'rounded-take',
                    type: 'take',
                    comparator: 'gte',
                    distance: { kind: 'pct_bps', pctBps: 333 },
                    execution: { priceType: 'LMT', timeInForce: 'ROD', limitPrice: '103' },
                },
            ],
        });
        expect(evaluate(fixedPlan, '96.7').triggeredLegIds).toEqual([
            'rounded-stop',
        ]);
        expect(evaluate(fixedPlan, '103').triggeredLegIds).toEqual([
            'rounded-take',
        ]);

        const etfPlan = plan({
            family: 'fixed',
            legs: [
                {
                    legId: 'etf-rounded-stop',
                    type: 'stop',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 4996 },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
            ],
        });
        etfPlan.contractPricePolicy = {
            categoryCode: '00',
            limitDownMinorUnits: 4000,
            limitUpMinorUnits: 12000,
        };
        expect(evaluate(etfPlan, '50.05').triggeredLegIds).toEqual([
            'etf-rounded-stop',
        ]);

        const trailingPlan = plan({
            family: 'trailing',
            legs: [
                {
                    legId: 'rounded-activation',
                    type: 'trailing_activation',
                    comparator: 'gte',
                    distance: { kind: 'pct_bps', pctBps: 333 },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
                {
                    legId: 'rounded-retracement',
                    type: 'trailing_retracement',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 333 },
                    execution: { priceType: 'LMT', timeInForce: 'IOC', limitPrice: '100' },
                },
            ],
        });
        expect(evaluate(trailingPlan, '103').nextState).toBe('active');
        expect(
            evaluate(trailingPlan, '106.5', {
                family: 'trailing',
                state: 'active',
                savedHighDecimal: '110',
            }),
        ).toMatchObject({
            retracementTriggerDecimal: '106.5',
            triggeredLegIds: ['rounded-retracement'],
        });
    });

    it('persists activation and monotonic saved high before retracement', () => {
        const atrSnapshot = {
            algorithmVersion: 'wilder-atr-14/v1',
            asOfTradingDate: '2026-08-20',
            completenessSha256: DIGEST,
            period: 14,
            sourceSha256: DIGEST,
            timeframe: '1d',
            value: '4',
        };
        const atrSnapshotSha256 = `sha256:${createHash('sha256')
            .update(canonicalJson(atrSnapshot))
            .digest('hex')}`;
        const protectionPlan = plan({
            family: 'trailing',
            legs: [
                {
                    legId: 'activate',
                    type: 'trailing_activation',
                    comparator: 'gte',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
                {
                    legId: 'retrace',
                    type: 'trailing_retracement',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 500 },
                    execution: { priceType: 'LMT', timeInForce: 'IOC', limitPrice: '95' },
                },
                {
                    legId: 'fixed',
                    type: 'fixed_stop',
                    comparator: 'lte',
                    distance: { kind: 'fixed_atr', atrSnapshotSha256, multiplier: '2' },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
            ],
        });
        protectionPlan.fixedAtrSnapshot = atrSnapshot;
        const activated = evaluate(protectionPlan, '103');
        expect(activated).toMatchObject({
            nextState: 'active',
            savedHighDecimal: '103',
            triggeredLegIds: [],
        });
        const high = evaluate(protectionPlan, '110', {
            family: 'trailing',
            state: 'active',
            savedHighDecimal: '103',
        });
        expect(high.savedHighDecimal).toBe('110');
        const retraced = evaluate(protectionPlan, '104.5', {
            family: 'trailing',
            state: 'active',
            savedHighDecimal: '110',
        });
        expect(retraced.triggeredLegIds).toEqual(['retrace']);
        expect(retraced.savedHighDecimal).toBe('110');
        expect(evaluate(protectionPlan, '92').triggeredLegIds).toEqual(['fixed']);
    });

    it('uses the one fixed ATR snapshot for fixed stop/take and trailing activation/retracement', () => {
        const fixedPlan = plan({
            family: 'fixed',
            legs: [
                {
                    legId: 'atr-stop',
                    type: 'stop',
                    comparator: 'lte',
                    distance: {
                        kind: 'fixed_atr',
                        atrSnapshotSha256: `sha256:${createHash('sha256')
                            .update(canonicalJson(plan({ family: 'fixed', legs: [] }).fixedAtrSnapshot))
                            .digest('hex')}`,
                        multiplier: '2',
                    },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
                {
                    legId: 'atr-take',
                    type: 'take',
                    comparator: 'gte',
                    distance: {
                        kind: 'fixed_atr',
                        atrSnapshotSha256: `sha256:${createHash('sha256')
                            .update(canonicalJson(plan({ family: 'fixed', legs: [] }).fixedAtrSnapshot))
                            .digest('hex')}`,
                        multiplier: '1',
                    },
                    execution: { priceType: 'LMT', timeInForce: 'ROD', limitPrice: '104' },
                },
            ],
        });
        expect(evaluate(fixedPlan, '92').triggeredLegIds).toEqual(['atr-stop']);
        expect(evaluate(fixedPlan, '104').triggeredLegIds).toEqual(['atr-take']);

        const atrSnapshotSha256 = `sha256:${createHash('sha256')
            .update(canonicalJson(fixedPlan.fixedAtrSnapshot))
            .digest('hex')}`;
        const trailingPlan = plan({
            family: 'trailing',
            legs: [
                {
                    legId: 'atr-activate',
                    type: 'trailing_activation',
                    comparator: 'gte',
                    distance: {
                        kind: 'fixed_atr',
                        atrSnapshotSha256,
                        multiplier: '1',
                    },
                    execution: { priceType: 'MKT', timeInForce: 'IOC', limitPrice: null },
                },
                {
                    legId: 'atr-retrace',
                    type: 'trailing_retracement',
                    comparator: 'lte',
                    distance: {
                        kind: 'fixed_atr',
                        atrSnapshotSha256,
                        multiplier: '1.5',
                    },
                    execution: { priceType: 'LMT', timeInForce: 'IOC', limitPrice: '100' },
                },
            ],
        });
        expect(evaluate(trailingPlan, '104')).toMatchObject({
            nextState: 'active',
            savedHighDecimal: '104',
        });
        expect(
            evaluate(trailingPlan, '104', {
                family: 'trailing',
                state: 'active',
                savedHighDecimal: '110',
            }).triggeredLegIds,
        ).toEqual(['atr-retrace']);
    });

    it('rejects hostile structural input before reading an accessor', () => {
        let reads = 0;
        const hostile = {
            get formalProtection() {
                reads += 1;
                return null;
            },
            observedPrice: '100',
            previousHead: null,
            protectionPlan: {},
        };
        expect(() => evaluateSmartOrderProtectiveTrigger(hostile)).toThrow(
            'own data properties',
        );
        expect(reads).toBe(0);
        expect(() =>
            evaluateSmartOrderProtectiveTrigger(
                new Proxy({}, { ownKeys() { throw new Error('trap'); } }),
            ),
        ).toThrow('schema is invalid');
    });
});
