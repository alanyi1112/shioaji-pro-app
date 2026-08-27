import { describe, expect, it } from 'vitest';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import {
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';
import {
    SMART_ORDER_TASK_0_4_0_6_PROFILES,
    buildSmartOrderTask0406OperationContract,
    smartOrderTask0406CustomField,
} from './task0-4-0-6-operation-contract.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
const runId = '11111111-2222-4333-8444-555555555555';
const operationId = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const nonce = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const nowEpochMs = Date.parse('2026-08-24T02:00:00.000Z');

function plan(profile) {
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    return buildSmartOrderTaskProbeMarketPlan({
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: policy.taskId,
        runId,
        operation: 'place',
        purpose: policy.purpose,
        side: policy.side,
        priceType: policy.priceType,
        timeInForce: policy.timeInForce,
        priceOrdinal: policy.priceOrdinal,
        quantityCommonLots: 1,
        accountScopeSha256,
        tradeDate: '2026-08-24',
        sourceFingerprintSha256: `sha256:${'1'.repeat(64)}`,
        apiGenerationSha256: `sha256:${'2'.repeat(64)}`,
        positionsSha256: `sha256:${'3'.repeat(64)}`,
        workingOrdersSha256: `sha256:${'4'.repeat(64)}`,
        nowEpochMs,
        target: null,
        contract: {
            categoryCode: '24',
            contractKey: 'TSE:2330:STK:Common',
            contractUnit: 1_000,
            evidenceSha256: `sha256:${'5'.repeat(64)}`,
            limitDownMinorUnits: 10_000,
            limitUpMinorUnits: 13_000,
            observedAtEpochMs: nowEpochMs - 100,
            referenceMinorUnits: 11_500,
            updateDate: '2026-08-24',
            validUntilEpochMs: nowEpochMs + 20_000,
        },
        quote: {
            bestAskMinorUnits: 11_550,
            bestBidMinorUnits: 11_500,
            evidenceSha256: `sha256:${'6'.repeat(64)}`,
            exchangeTimeEpochMs: nowEpochMs - 200,
            observedAtEpochMs: nowEpochMs - 100,
            tradeDate: '2026-08-24',
            validUntilEpochMs: nowEpochMs + 20_000,
        },
    });
}

describe('Task 0.4/0.6 exact place-only operation contract', () => {
    it.each(Object.keys(SMART_ORDER_TASK_0_4_0_6_PROFILES))(
        'binds %s into the exact one-shot simulation payload and envelope',
        (profile) => {
            const market = plan(profile);
            const result = buildSmartOrderTask0406OperationContract({
                account,
                marketPlan: market.plan,
                marketPlanSha256: market.planSha256,
                nonce,
                nowEpochMs,
                operationId,
                profile,
            });
            const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
            const order = result.canonical.request.payload.stock_order;
            expect(result.publicSummary).toMatchObject({
                taskId: policy.taskId,
                profile,
                priceType: policy.priceType,
                timeInForce: policy.timeInForce,
                quantityCommonLots: 1,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
            });
            expect(order).toMatchObject({
                action: policy.side,
                price_type: policy.priceType,
                order_type: policy.timeInForce,
                order_lot: 'Common',
                quantity: 1,
                account,
            });
            expect(order.custom_field).toMatch(/^[A-Z0-9]{6}$/);
            expect(order.price).toBe(policy.priceType === 'MKT' ? 0 : Number(market.plan.price));
            expect(result.canonical.envelope).toMatchObject({
                operation: 'place',
                accountScopeSha256,
                quantityCommonLots: 1,
                target: null,
                validUntilEpochMs: nowEpochMs + 300_000,
            });
        },
    );

    it('domain-separates custom fields and rejects a profile/plan confusion', () => {
        expect(
            smartOrderTask0406CustomField({ profile: 'round_trip_lmt_ioc', runId }),
        ).not.toBe(
            smartOrderTask0406CustomField({ profile: 'lmt_rod_fill', runId }),
        );
        const market = plan('round_trip_lmt_ioc');
        expect(() =>
            buildSmartOrderTask0406OperationContract({
                account,
                marketPlan: market.plan,
                marketPlanSha256: market.planSha256,
                nonce,
                nowEpochMs,
                operationId,
                profile: 'lmt_ioc_zero_fill',
            }),
        ).toThrow('invalid or stale');
    });
});
