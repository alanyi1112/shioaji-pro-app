import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_TASK_PROBE_MAX_PLAN_LIFETIME_MS,
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    assertSmartOrderTaskProbePinnedPriceCurrent,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const nowEpochMs = Date.parse('2026-08-24T02:00:00.000Z');

function input(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: '0.3b',
        runId: '123e4567-e89b-42d3-a456-426614174000',
        operation: 'place',
        purpose: 'working_non_marketable',
        side: 'Buy',
        priceType: 'LMT',
        timeInForce: 'ROD',
        priceOrdinal: 1,
        quantityCommonLots: 1,
        accountScopeSha256: digest('a'),
        tradeDate: '2026-08-24',
        sourceFingerprintSha256: digest('b'),
        apiGenerationSha256: digest('c'),
        positionsSha256: digest('d'),
        workingOrdersSha256: digest('e'),
        nowEpochMs,
        target: null,
        contract: {
            contractKey: 'TSE:2330:STK:Common',
            categoryCode: '24',
            contractUnit: 1_000,
            referenceMinorUnits: 11_500,
            limitDownMinorUnits: 10_350,
            limitUpMinorUnits: 12_650,
            updateDate: '2026-08-24',
            observedAtEpochMs: nowEpochMs - 100,
            validUntilEpochMs: nowEpochMs + 4_000,
            evidenceSha256: digest('f'),
        },
        quote: {
            tradeDate: '2026-08-24',
            bestBidMinorUnits: 11_500,
            bestAskMinorUnits: 11_550,
            exchangeTimeEpochMs: nowEpochMs - 300,
            observedAtEpochMs: nowEpochMs - 100,
            validUntilEpochMs: nowEpochMs + 4_000,
            evidenceSha256: digest('1'),
        },
        ...overrides,
    };
}

function target(overrides = {}) {
    return {
        originRunId: '123e4567-e89b-42d3-a456-426614174000',
        targetIdSha256: digest('2'),
        accountScopeSha256: digest('a'),
        tradeDate: '2026-08-24',
        priceMinorUnits: 11_450,
        revision: 0,
        ...overrides,
    };
}

describe('task-specific simulation market plan', () => {
    it('allows a five-minute authorization window but rejects longer evidence', () => {
        expect(SMART_ORDER_TASK_PROBE_MAX_PLAN_LIFETIME_MS).toBe(300_000);
        const validUntilEpochMs = nowEpochMs + 299_000;
        expect(
            buildSmartOrderTaskProbeMarketPlan(
                input({
                    contract: { ...input().contract, validUntilEpochMs },
                    quote: { ...input().quote, validUntilEpochMs },
                }),
            ).plan.validUntilEpochMs,
        ).toBe(validUntilEpochMs);
        expect(() =>
            buildSmartOrderTaskProbeMarketPlan(
                input({
                    contract: {
                        ...input().contract,
                        validUntilEpochMs: nowEpochMs + 300_001,
                    },
                }),
            ),
        ).toThrow('overlong');
    });

    it('derives distinct legal non-marketable P1/P2 prices without hard-coding 115', () => {
        const placed = buildSmartOrderTaskProbeMarketPlan(input());
        const updated = buildSmartOrderTaskProbeMarketPlan(
            input({
                operation: 'update_price',
                priceOrdinal: 2,
                target: target(),
            }),
        );
        expect(placed.plan).toMatchObject({
            price: '114.5',
            brokerWriteAuthority: false,
            automaticRetryAllowed: false,
        });
        expect(updated.plan.price).toBe('114');
        expect(updated.plan.price).not.toBe(placed.plan.price);
    });

    it('moves one more legal tick when the current BBO makes P2 collide with the target', () => {
        const updated = buildSmartOrderTaskProbeMarketPlan(
            input({
                operation: 'update_price',
                priceOrdinal: 2,
                target: target({ priceMinorUnits: 11_400 }),
            }),
        );
        expect(updated.plan.price).toBe('113.5');
        expect(updated.plan.priceMinorUnits).not.toBe(
            updated.plan.target.priceMinorUnits,
        );
    });

    it.each([
        ['Buy', 'marketable_fill', 1, '115.5'],
        ['Buy', 'ioc_zero_fill', 1, '114.5'],
        ['Sell', 'working_non_marketable', 1, '116'],
        ['Sell', 'marketable_fill', 1, '115'],
    ])('derives the exact %s %s LMT plan', (side, purpose, priceOrdinal, price) => {
        expect(
            buildSmartOrderTaskProbeMarketPlan(
                input({ taskId: '0.6', side, purpose, priceOrdinal }),
            ).plan.price,
        ).toBe(price);
    });

    it('keeps MKT+IOC price-less and cancel bound to a same-run target', () => {
        const market = buildSmartOrderTaskProbeMarketPlan(
            input({
                taskId: '0.6',
                purpose: 'market_order',
                priceType: 'MKT',
                timeInForce: 'IOC',
                priceOrdinal: 0,
            }),
        ).plan;
        expect(market.price).toBeNull();
        expect(
            assertSmartOrderTaskProbePinnedPriceCurrent({
                plan: market,
                contract: input().contract,
                quote: input().quote,
            }),
        ).toBe(true);
        expect(
            buildSmartOrderTaskProbeMarketPlan(
                input({
                    operation: 'cancel',
                    purpose: 'cancel_same_run_target',
                    priceType: null,
                    timeInForce: null,
                    priceOrdinal: 0,
                    target: target(),
                }),
            ).plan.target,
        ).toMatchObject({ revision: 0, accountScopeSha256: digest('a') });
    });

    it('keeps an exact authorized working price across harmless BBO movement', () => {
        const plan = buildSmartOrderTaskProbeMarketPlan(input()).plan;
        expect(
            assertSmartOrderTaskProbePinnedPriceCurrent({
                plan,
                contract: input().contract,
                quote: {
                    ...input().quote,
                    bestBidMinorUnits: 11_550,
                    bestAskMinorUnits: 11_600,
                },
            }),
        ).toBe(true);
    });

    it('rejects a pinned price that crosses the refreshed BBO or leaves current limits', () => {
        const plan = buildSmartOrderTaskProbeMarketPlan(input()).plan;
        expect(() =>
            assertSmartOrderTaskProbePinnedPriceCurrent({
                plan,
                contract: input().contract,
                quote: {
                    ...input().quote,
                    bestBidMinorUnits: 11_400,
                    bestAskMinorUnits: 11_450,
                },
            }),
        ).toThrow('purpose drifted');
        expect(() =>
            assertSmartOrderTaskProbePinnedPriceCurrent({
                plan,
                contract: {
                    ...input().contract,
                    limitDownMinorUnits: 11_500,
                },
                quote: input().quote,
            }),
        ).toThrow('invalid against the current market');
        expect(() =>
            assertSmartOrderTaskProbePinnedPriceCurrent({
                plan: { ...plan },
                contract: input().contract,
                quote: input().quote,
            }),
        ).toThrow('not issued');
    });

    it.each([
        ['stale quote', { nowEpochMs: nowEpochMs + 5_000 }],
        ['contract date drift', { tradeDate: '2026-08-25' }],
        ['crossed BBO', { quote: { ...input().quote, bestBidMinorUnits: 11_550 } }],
        ['illegal BBO tick', { quote: { ...input().quote, bestBidMinorUnits: 11_501 } }],
        ['account target drift', { operation: 'update_price', target: target({ accountScopeSha256: digest('9') }) }],
        ['cross-run target', { operation: 'update_price', target: target({ originRunId: '223e4567-e89b-42d3-a456-426614174000' }) }],
        ['cross-run missing target', { operation: 'update_price', target: null }],
        ['unchanged update price', { operation: 'update_price', priceOrdinal: 1, target: target() }],
        ['oversized quantity', { quantityCommonLots: 2 }],
    ])('fails closed on %s', (_label, overrides) => {
        expect(() => buildSmartOrderTaskProbeMarketPlan(input(overrides))).toThrow();
    });

    it('rejects Proxy and extra fields before producing a plan', () => {
        expect(() => buildSmartOrderTaskProbeMarketPlan(new Proxy(input(), {}))).toThrow(
            'non-Proxy',
        );
        expect(() =>
            buildSmartOrderTaskProbeMarketPlan({ ...input(), authorization: true }),
        ).toThrow('schema');
    });
});
