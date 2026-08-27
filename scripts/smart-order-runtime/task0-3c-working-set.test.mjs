import { describe, expect, it } from 'vitest';
import { smartOrderTask03cCustomField } from './task0-3c-operation-contract.mjs';
import {
    assertSmartOrderTask03cExternalSellBaseline,
    deriveSmartOrderTask03cPlacedTarget,
    verifySmartOrderTask03cCompleteExternalSellSet,
} from './task0-3c-working-set.mjs';

const runId = '123e4567-e89b-42d3-a456-426614174610';
const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});

function position(quantity = 7_000) {
    return {
        id: 1,
        code: '2330',
        direction: 'Buy',
        quantity,
        price: 100,
        last_price: 101,
        pnl: 1_000,
        yd_quantity: quantity,
    };
}

function trade(operationOrdinal, overrides = {}) {
    return {
        contract: {
            code: '2330',
            exchange: 'TSE',
            security_type: 'STK',
        },
        order: {
            account,
            action: 'Sell',
            id: `trade-${operationOrdinal}`,
            order_cond: 'Cash',
            order_lot: 'Common',
            order_type: 'ROD',
            ordno: `00000${operationOrdinal}`,
            price: 116 + operationOrdinal,
            price_type: 'LMT',
            quantity: 1,
            seqno: `00000${operationOrdinal}`,
            custom_field: smartOrderTask03cCustomField(
                runId,
                operationOrdinal,
            ),
            ...overrides.order,
        },
        status: {
            status: 'Submitted',
            id: `trade-${operationOrdinal}`,
            order_quantity: 1,
            deal_quantity: 0,
            cancel_quantity: 0,
            ...overrides.status,
        },
    };
}

function placedTarget(operationOrdinal, trades) {
    return deriveSmartOrderTask03cPlacedTarget({
        account,
        contractUnit: 1_000,
        expectedCustomField: smartOrderTask03cCustomField(
            runId,
            operationOrdinal,
        ),
        expectedPriceDecimal: String(116 + operationOrdinal),
        operationOrdinal,
        placeResponse: trades.at(-1),
        refreshedTrades: trades,
        runId,
        tradeDate: '2026-08-27',
    }).privateTarget;
}

describe('Task 0.3c external working-sell set', () => {
    it('requires an empty first baseline and enough known available position', () => {
        const result = assertSmartOrderTask03cExternalSellBaseline({
            account,
            contractUnit: 1_000,
            expectedCustomField: smartOrderTask03cCustomField(runId, 1),
            operationOrdinal: 1,
            positions: [position()],
            previousTargets: [],
            trades: [],
        });
        expect(result).toMatchObject({
            workingSellCount: 0,
            position: { quantityShares: 7_000 },
            brokerAuthority: false,
        });
    });

    it('binds the second operation to exactly the first known target', () => {
        const firstTrade = trade(1);
        const firstTarget = placedTarget(1, [firstTrade]);
        expect(
            assertSmartOrderTask03cExternalSellBaseline({
                account,
                contractUnit: 1_000,
                expectedCustomField: smartOrderTask03cCustomField(runId, 2),
                operationOrdinal: 2,
                positions: [position()],
                previousTargets: [firstTarget],
                trades: [firstTrade],
            }),
        ).toMatchObject({ workingSellCount: 1 });
        expect(() =>
            assertSmartOrderTask03cExternalSellBaseline({
                account,
                contractUnit: 1_000,
                expectedCustomField: smartOrderTask03cCustomField(runId, 2),
                operationOrdinal: 2,
                positions: [position()],
                previousTargets: [firstTarget],
                trades: [firstTrade, trade(2)],
            }),
        ).toThrow('exact known set');
    });

    it('proves the complete two-order account-scoped identifier set', () => {
        const firstTrade = trade(1);
        const firstTarget = placedTarget(1, [firstTrade]);
        const secondTrade = trade(2);
        const secondTarget = placedTarget(2, [firstTrade, secondTrade]);
        expect(
            verifySmartOrderTask03cCompleteExternalSellSet({
                account,
                contractUnit: 1_000,
                positions: [position()],
                targets: [firstTarget, secondTarget],
                trades: [firstTrade, secondTrade],
            }),
        ).toMatchObject({
            complete: true,
            identifiers: [
                { quantityCommonLots: 1, status: 'Submitted' },
                { quantityCommonLots: 1, status: 'Submitted' },
            ],
            brokerAuthority: false,
        });
    });

    it.each([
        ['insufficient position', [position(1_000)], []],
        ['unknown partial fill', [position()], [trade(1, { status: { status: 'PartFilled', deal_quantity: 1 } })]],
    ])('fails closed on %s', (_label, positions, trades) => {
        expect(() =>
            assertSmartOrderTask03cExternalSellBaseline({
                account,
                contractUnit: 1_000,
                expectedCustomField: smartOrderTask03cCustomField(runId, 1),
                operationOrdinal: 1,
                positions,
                previousTargets: [],
                trades,
            }),
        ).toThrow();
    });
});
