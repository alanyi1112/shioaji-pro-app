import { describe, expect, it } from 'vitest';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import {
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';
import { buildSmartOrderTask03bOperationContract } from './task0-3b-operation-contract.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const nowEpochMs = Date.parse('2026-08-24T02:00:00.000Z');
const runId = '123e4567-e89b-42d3-a456-426614174000';
const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);

function planInput(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: '0.3b',
        runId,
        operation: 'place',
        purpose: 'working_non_marketable',
        side: 'Buy',
        priceType: 'LMT',
        timeInForce: 'ROD',
        priceOrdinal: 1,
        quantityCommonLots: 1,
        accountScopeSha256,
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
        originRunId: runId,
        targetIdSha256: digest('2'),
        accountScopeSha256,
        tradeDate: '2026-08-24',
        priceMinorUnits: 11_450,
        revision: 0,
        ...overrides,
    };
}

function privateTarget(overrides = {}) {
    return {
        schemaVersion: 'smart-order-task-0.3b-target-lineage/2026-08-24.1',
        ...target(),
        targetRevision: digest('3'),
        tradeId: 'same-run-trade',
        orderId: 'same-run-order',
        seqno: '000001',
        ordno: '000001',
        customField: 'A1B2C3',
        contractUnit: 1_000,
        status: 'Submitted',
        ...overrides,
    };
}

function build(planResult, targetValue = null, overrides = {}) {
    return buildSmartOrderTask03bOperationContract({
        account,
        marketPlan: planResult.plan,
        marketPlanSha256: planResult.planSha256,
        nonce: '123e4567-e89b-42d3-a456-426614174003',
        nowEpochMs,
        operationId: '123e4567-e89b-42d3-a456-426614174002',
        target: targetValue,
        ...overrides,
    });
}

describe('Task 0.3b exact operation contract', () => {
    it('binds dynamic P1 and the full fixed account into the exact place request', () => {
        const result = build(buildSmartOrderTaskProbeMarketPlan(planInput()));
        expect(result.publicSummary).toMatchObject({
            operation: 'place',
            price: '114.5',
            accountRef: `…${accountScopeSha256.slice(-12)}`,
            brokerAuthority: false,
            brokerWriteAttempted: false,
        });
        expect(result.canonical.request.payload).toMatchObject({
            contract: { code: '2330', exchange: 'TSE' },
            stock_order: {
                action: 'Buy',
                price: 114.5,
                quantity: 1,
                price_type: 'LMT',
                order_type: 'ROD',
                account,
            },
        });
        expect(result.canonical.request.payload.stock_order.custom_field).toMatch(
            /^[A-F0-9]{6}$/,
        );
        expect(result.canonical.envelope.validUntilEpochMs).toBe(
            nowEpochMs + 300_000,
        );
        expect(JSON.stringify(result.publicSummary)).not.toContain('SIM-ACCOUNT');
    });

    it('binds distinct P2 and cancel to the same run target revision', () => {
        const updatedPlan = buildSmartOrderTaskProbeMarketPlan(
            planInput({ operation: 'update_price', priceOrdinal: 2, target: target() }),
        );
        const updated = build(updatedPlan, privateTarget());
        expect(updated.publicSummary).toMatchObject({
            operation: 'update_price',
            price: '114',
            target: { revision: 0 },
        });
        expect(updated.canonical.request.payload).toEqual({
            trade_id: 'same-run-trade',
            price: 114,
            account,
        });
        const cancelledPlan = buildSmartOrderTaskProbeMarketPlan(
            planInput({
                operation: 'cancel',
                purpose: 'cancel_same_run_target',
                priceType: null,
                timeInForce: null,
                priceOrdinal: 0,
                target: target({ priceMinorUnits: 11_400, revision: 1 }),
            }),
        );
        const cancelled = build(
            cancelledPlan,
            privateTarget({ priceMinorUnits: 11_400, revision: 1 }),
        );
        expect(cancelled.publicSummary).toMatchObject({
            operation: 'cancel',
            price: null,
            target: { revision: 1 },
        });
        expect(cancelled.canonical.request.payload).toEqual({
            trade_id: 'same-run-trade',
            account,
        });
    });

    it.each([
        ['clone plan', (issued) => ({ ...issued.plan })],
        ['cross-run private target', (_issued) => privateTarget({ originRunId: '223e4567-e89b-42d3-a456-426614174000' })],
        ['account drift', (_issued) => privateTarget({ accountScopeSha256: digest('9') })],
        ['revision drift', (_issued) => privateTarget({ revision: 9 })],
    ])('rejects %s before producing an envelope', (_label, mutation) => {
        const issued = buildSmartOrderTaskProbeMarketPlan(
            planInput({ operation: 'update_price', priceOrdinal: 2, target: target() }),
        );
        if (_label === 'clone plan') {
            expect(() =>
                buildSmartOrderTask03bOperationContract({
                    account,
                    marketPlan: mutation(issued),
                    marketPlanSha256: issued.planSha256,
                    nonce: '123e4567-e89b-42d3-a456-426614174003',
                    nowEpochMs,
                    operationId: '123e4567-e89b-42d3-a456-426614174002',
                    target: privateTarget(),
                }),
            ).toThrow('issued');
        } else {
            expect(() => build(issued, mutation(issued))).toThrow('target');
        }
    });

    it('rejects stale plan, changed hash and Proxy account', () => {
        const issued = buildSmartOrderTaskProbeMarketPlan(planInput());
        expect(() => build(issued, null, { nowEpochMs: nowEpochMs + 4_000 })).toThrow(
            'stale',
        );
        expect(() =>
            build(issued, null, { marketPlanSha256: digest('9') }),
        ).toThrow('invalid');
        expect(() =>
            build(issued, null, { account: new Proxy(account, {}) }),
        ).toThrow('non-Proxy');
    });
});
