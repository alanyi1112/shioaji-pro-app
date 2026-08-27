import { describe, expect, it } from 'vitest';
import {
    advanceSmartOrderTask03bTargetRevision,
    assertNoExistingSmartOrderTask03bRunTarget,
    confirmSmartOrderTask03bCancelledTarget,
    deriveSmartOrderTask03bPlacedTarget,
    verifySmartOrderTask03bCurrentTarget,
} from './task0-3b-target-lineage.mjs';

const account = Object.freeze({
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
});
const runId = '123e4567-e89b-42d3-a456-426614174000';

function trade(overrides = {}) {
    const order = {
        account,
        action: 'Buy',
        id: 'same-run-trade',
        order_cond: 'Cash',
        order_lot: 'Common',
        order_type: 'ROD',
        ordno: '000001',
        price: 114.5,
        price_type: 'LMT',
        quantity: 1,
        seqno: '000001',
        custom_field: 'A1B2C3',
        ...overrides.order,
    };
    return {
        contract: {
            code: '2330',
            exchange: 'TSE',
            security_type: 'STK',
            ...overrides.contract,
        },
        order,
        status: {
            cancel_quantity: 0,
            deal_quantity: 0,
            id: 'same-run-order',
            order_quantity: 1,
            status: 'Submitted',
            ...overrides.status,
        },
    };
}

function placed(overrides = {}) {
    const response = trade(overrides.response ?? {});
    return deriveSmartOrderTask03bPlacedTarget({
        account,
        contractUnit: 1_000,
        expectedCustomField: 'A1B2C3',
        expectedPriceDecimal: '114.5',
        placeResponse: response,
        refreshedTrades: overrides.refreshedTrades ?? [response],
        runId,
        tradeDate: '2026-08-24',
    });
}

describe('Task 0.3b same-run target lineage', () => {
    it('rejects every pre-existing fixed-account target with the same run custom field', () => {
        expect(
            assertNoExistingSmartOrderTask03bRunTarget({
                account,
                expectedCustomField: 'A1B2C3',
                refreshedTrades: [],
            }),
        ).toMatchObject({ unique: true, brokerAuthority: false });
        expect(() =>
            assertNoExistingSmartOrderTask03bRunTarget({
                account,
                expectedCustomField: 'A1B2C3',
                refreshedTrades: [trade({ status: { status: 'Cancelled', cancel_quantity: 1 } })],
            }),
        ).toThrow('already has');
    });

    it('derives one response-linked private, market-plan and Node-safe target', () => {
        const result = placed();
        expect(result.privateTarget).toMatchObject({
            originRunId: runId,
            revision: 0,
            priceMinorUnits: 11_450,
            tradeId: 'same-run-trade',
            orderId: 'same-run-order',
            status: 'Submitted',
        });
        expect(result.marketPlanTarget).toMatchObject({
            originRunId: runId,
            revision: 0,
            priceMinorUnits: 11_450,
        });
        expect(result.nodeSafeTarget).toMatchObject({
            quantityShares: 1_000,
            remainingShares: 1_000,
            quantityUnit: 'CommonLot',
            state: 'submitted',
            identifiers: {
                tradeId: 'same-run-trade',
                customField: 'A1B2C3',
            },
        });
        expect(JSON.stringify(result.publicTarget)).not.toContain('SIM-ACCOUNT');
        expect(JSON.stringify(result.publicTarget)).not.toContain('same-run-trade');
    });

    it('advances revision only after the same immutable target has the exact P2 price', () => {
        const first = placed();
        const updatedTrade = trade({ status: { modified_price: 114 } });
        const second = advanceSmartOrderTask03bTargetRevision({
            account,
            expectedPriceDecimal: '114',
            previousTarget: first.privateTarget,
            refreshedTrades: [updatedTrade],
        });
        expect(second.privateTarget).toMatchObject({
            targetIdSha256: first.privateTarget.targetIdSha256,
            revision: 1,
            priceMinorUnits: 11_400,
        });
        expect(second.privateTarget.targetRevision).not.toBe(
            first.privateTarget.targetRevision,
        );
    });

    it('verifies the exact old revision immediately before update/cancel', () => {
        const first = placed();
        expect(
            verifySmartOrderTask03bCurrentTarget({
                account,
                target: first.privateTarget,
                refreshedTrades: [trade()],
            }),
        ).toMatchObject({ current: true, revision: 0, brokerAuthority: false });
        expect(() =>
            verifySmartOrderTask03bCurrentTarget({
                account,
                target: first.privateTarget,
                refreshedTrades: [trade({ status: { modified_price: 114 } })],
            }),
        ).toThrow('changed');
    });

    it('confirms cancel only from the same identifiers and exact terminal quantity', () => {
        const first = placed();
        expect(
            confirmSmartOrderTask03bCancelledTarget({
                account,
                target: first.privateTarget,
                refreshedTrades: [
                    trade({
                        status: {
                            status: 'Cancelled',
                            cancel_quantity: 1,
                        },
                    }),
                ],
            }),
        ).toMatchObject({
            confirmed: true,
            terminalStatus: 'Cancelled',
            finalRevision: 1,
        });
        expect(() =>
            confirmSmartOrderTask03bCancelledTarget({
                account,
                target: first.privateTarget,
                refreshedTrades: [trade({ status: { status: 'Submitted' } })],
            }),
        ).toThrow('terminal');
    });

    it.each([
        ['duplicate match', { refreshedTrades: [trade(), trade()] }],
        ['cross-account', { refreshedTrades: [trade({ order: { account: { ...account, account_id: 'OTHER' } } })] }],
        ['wrong custom field', { refreshedTrades: [trade({ order: { custom_field: 'ZZZZZZ' } })] }],
        ['terminal', { refreshedTrades: [trade({ status: { status: 'Cancelled', cancel_quantity: 1 } })] }],
        ['partial fill', { refreshedTrades: [trade({ status: { status: 'PartFilled', deal_quantity: 1 } })] }],
        ['response mismatch', {
            response: { order: { id: 'other-trade' } },
            refreshedTrades: [trade()],
        }],
    ])('rejects %s target resolution', (_label, overrides) => {
        expect(() => placed(overrides)).toThrow();
    });

    it.each([
        ['identifier drift', { order: { id: 'other-trade' } }],
        ['revision still old price', { order: { price: 114.5 } }],
        ['terminal during update', { status: { modified_price: 114, status: 'Cancelled', cancel_quantity: 1 } }],
    ])('rejects %s while advancing revision', (_label, drift) => {
        const first = placed();
        expect(() =>
            advanceSmartOrderTask03bTargetRevision({
                account,
                expectedPriceDecimal: '114',
                previousTarget: first.privateTarget,
                refreshedTrades: [trade(drift)],
            }),
        ).toThrow();
    });

    it('rejects a cloned/incomplete previous target and Proxy input', () => {
        const first = placed();
        const { status: _status, ...incomplete } = first.privateTarget;
        expect(() =>
            advanceSmartOrderTask03bTargetRevision({
                account,
                expectedPriceDecimal: '114',
                previousTarget: incomplete,
                refreshedTrades: [trade({ order: { price: 114 } })],
            }),
        ).toThrow('schema');
        expect(() =>
            deriveSmartOrderTask03bPlacedTarget(
                new Proxy(
                    {
                        account,
                        contractUnit: 1_000,
                        expectedCustomField: 'A1B2C3',
                        expectedPriceDecimal: '114.5',
                        placeResponse: trade(),
                        refreshedTrades: [trade()],
                        runId,
                        tradeDate: '2026-08-24',
                    },
                    {},
                ),
            ),
        ).toThrow('non-Proxy');
    });
});
