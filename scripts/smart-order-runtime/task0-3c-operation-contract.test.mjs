import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.mjs';
import { createHash } from 'node:crypto';
import {
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import {
    buildSmartOrderTask03cOperationContract,
    smartOrderTask03cCustomField,
} from './task0-3c-operation-contract.mjs';

const nowEpochMs = Date.parse('2026-08-27T02:00:00.000Z');
const runId = '123e4567-e89b-42d3-a456-426614174620';
const account = {
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
};

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function plan(operationOrdinal) {
    return buildSmartOrderTaskProbeMarketPlan({
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: '0.3c',
        runId,
        operation: 'place',
        purpose: 'working_non_marketable',
        side: 'Sell',
        priceType: 'LMT',
        timeInForce: 'ROD',
        priceOrdinal: operationOrdinal,
        quantityCommonLots: 1,
        accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
        tradeDate: '2026-08-27',
        sourceFingerprintSha256: `sha256:${'b'.repeat(64)}`,
        apiGenerationSha256: `sha256:${'c'.repeat(64)}`,
        positionsSha256: `sha256:${'d'.repeat(64)}`,
        workingOrdersSha256: `sha256:${'e'.repeat(64)}`,
        nowEpochMs,
        target: null,
        contract: {
            contractKey: 'TSE:2330:STK:Common',
            categoryCode: '24',
            contractUnit: 1_000,
            referenceMinorUnits: 11_500,
            limitDownMinorUnits: 10_350,
            limitUpMinorUnits: 12_650,
            updateDate: '2026-08-27',
            observedAtEpochMs: nowEpochMs,
            validUntilEpochMs: nowEpochMs + 30_000,
            evidenceSha256: `sha256:${'f'.repeat(64)}`,
        },
        quote: {
            bestBidMinorUnits: 11_450,
            bestAskMinorUnits: 11_500,
            exchangeTimeEpochMs: nowEpochMs - 500,
            tradeDate: '2026-08-27',
            observedAtEpochMs: nowEpochMs,
            validUntilEpochMs: nowEpochMs + 30_000,
            evidenceSha256: `sha256:${'1'.repeat(64)}`,
        },
    });
}

describe('Task 0.3c exact external sell operation contract', () => {
    it('builds distinct one-lot non-marketable Sell envelopes', () => {
        const first = plan(1);
        const second = plan(2);
        const build = (value, operationOrdinal) =>
            buildSmartOrderTask03cOperationContract({
                account,
                marketPlan: value.plan,
                marketPlanSha256: value.planSha256,
                nonce: `123e4567-e89b-42d3-a456-42661417462${operationOrdinal}`,
                nowEpochMs,
                operationId: `123e4567-e89b-42d3-a456-42661417463${operationOrdinal}`,
                operationOrdinal,
            });
        const firstContract = build(first, 1);
        const secondContract = build(second, 2);
        expect(firstContract.canonical.request.payload.stock_order).toMatchObject({
            action: 'Sell',
            quantity: 1,
            price_type: 'LMT',
            order_type: 'ROD',
            order_lot: 'Common',
            account,
        });
        expect(firstContract.canonical.envelope.target).toBeNull();
        expect(firstContract.publicSummary.operationOrdinal).toBe(1);
        expect(firstContract.publicSummary.price).not.toBe(
            secondContract.publicSummary.price,
        );
        expect(smartOrderTask03cCustomField(runId, 1)).not.toBe(
            smartOrderTask03cCustomField(runId, 2),
        );
        expect(firstContract.marketPlanSha256).toBe(
            sha256(canonicalJson(first.plan)),
        );
    });

    it('rejects an ordinal that is not one of the two exact operations', () => {
        const value = plan(1);
        expect(() =>
            buildSmartOrderTask03cOperationContract({
                account,
                marketPlan: value.plan,
                marketPlanSha256: value.planSha256,
                nonce: '123e4567-e89b-42d3-a456-426614174621',
                nowEpochMs,
                operationId: '123e4567-e89b-42d3-a456-426614174631',
                operationOrdinal: 3,
            }),
        ).toThrow();
    });
});
