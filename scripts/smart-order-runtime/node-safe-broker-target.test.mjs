import { describe, expect, it } from 'vitest';
import { createNodeSafeBrokerTargetExecutor } from './node-safe-broker-target.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function account(overrides = {}) {
    return {
        brokerId: 'broker-A',
        accountId: 'account-A',
        accountType: 'S',
        ...overrides,
    };
}

function refreshedTrade({
    fixedAccount = account(),
    action = 'Buy',
    code = '2330',
    exchange = 'TSE',
    orderLot = 'Common',
    orderQuantity = 1,
    dealQuantity = 0,
    cancelQuantity = 0,
    status = 'Submitted',
    price = '100',
    tradeId = 'trade-1',
    orderId = 'order-1',
    seqno = 'seq-1',
    ordno = 'ord-1',
    customField = 'SAFE01',
} = {}) {
    return {
        contract: {
            code,
            exchange,
            security_type: 'STK',
        },
        order: {
            account: {
                broker_id: fixedAccount.brokerId,
                account_id: fixedAccount.accountId,
                account_type: fixedAccount.accountType,
            },
            action,
            id: tradeId,
            order_cond: 'Cash',
            order_lot: orderLot,
            order_type: 'ROD',
            ordno,
            price,
            price_type: 'LMT',
            quantity: orderQuantity,
            seqno,
            custom_field: customField,
        },
        status: {
            cancel_quantity: cancelQuantity,
            deal_quantity: dealQuantity,
            id: orderId,
            order_quantity: orderQuantity,
            status,
        },
    };
}

function target(overrides = {}) {
    const contractUnit = overrides.contractUnit ?? 1_000;
    const quantityShares = overrides.quantityShares ?? contractUnit;
    const filledShares = overrides.filledShares ?? 0;
    return {
        account: account(),
        brokerOrderId: 'broker-order-1',
        brokerOrderRevision: 3,
        contractKey: 'TSE:2330:STK:Common',
        contractUnit,
        controlRevision: 2,
        evidenceSha256: DIGEST,
        filledShares,
        identifiers: {
            tradeId: 'trade-1',
            orderId: 'order-1',
            seqno: 'seq-1',
            ordno: 'ord-1',
            exchangeSequence: null,
            customField: 'SAFE01',
        },
        orderCondition: 'Cash',
        orderLot: 'Common',
        priceDecimal: '100',
        priceType: 'LMT',
        quantityShares,
        quantityUnit: 'CommonLot',
        remainingShares: quantityShares - filledShares,
        side: 'Buy',
        state: filledShares === 0 ? 'submitted' : 'part_filled',
        targetRevision: DIGEST,
        timeInForce: 'ROD',
        tradeDate: '2026-08-11',
        ...overrides,
    };
}

function executor({ refresh, write, nowEpochMs } = {}) {
    const writes = [];
    const instance = createNodeSafeBrokerTargetExecutor({
        nowEpochMs:
            nowEpochMs ?? (() => Date.parse('2026-08-11T04:00:00.000Z')),
        transport: {
            refreshFixedAccountTrades:
                refresh ?? (async () => [refreshedTrade()]),
            write:
                write ??
                (async (request) => {
                    writes.push(request);
                    return refreshedTrade();
                }),
        },
    });
    return { instance, writes };
}

function execution({
    operation = { kind: 'cancel' },
    target: currentTarget = target(),
    beforeWrite = async () => {},
} = {}) {
    return { beforeWrite, operation, target: currentTarget };
}

describe('Node-safe broker target executor', () => {
    it('refreshes one fixed account and emits only the supported cancel body', async () => {
        const { instance, writes } = executor();
        await expect(
            instance.execute(execution()),
        ).resolves.toMatchObject({
            state: 'reconciling',
            brokerBytesPossible: true,
            brokerWriteAttempted: true,
            automaticRetryAllowed: false,
            brokerAuthority: false,
        });
        expect(writes).toEqual([
            {
                path: '/api/v1/order/cancel_order',
                body: { trade_id: 'trade-1' },
            },
        ]);
    });

    it('rejects Proxy and accessor inputs before any broker write', async () => {
        const { instance, writes } = executor();
        await expect(
            instance.execute(
                new Proxy(
                    execution(),
                    {},
                ),
            ),
        ).rejects.toThrow('non-Proxy');
        const hostile = {
            beforeWrite: async () => {},
            operation: { kind: 'cancel' },
        };
        Object.defineProperty(hostile, 'target', {
            enumerable: true,
            get: () => target(),
        });
        await expect(instance.execute(hostile)).rejects.toThrow(
            'own data property',
        );
        expect(writes).toHaveLength(0);
    });

    it.each([
        ['cross-account', { fixedAccount: account({ accountId: 'account-B' }) }],
        ['cross-contract', { code: '2317' }],
        ['terminal', { status: 'Cancelled', cancelQuantity: 1 }],
        ['identifier-drift', { tradeId: 'trade-2' }],
    ])('fails closed before write on %s refreshed target drift', async (_label, drift) => {
        const { instance, writes } = executor({
            refresh: async () => [refreshedTrade(drift)],
        });
        await expect(
            instance.execute(execution()),
        ).resolves.toMatchObject({
            state: 'reconciling',
            brokerBytesPossible: false,
            brokerWriteAttempted: false,
            automaticRetryAllowed: false,
        });
        expect(writes).toHaveLength(0);
    });

    it('serializes the same order and invalidates a queued stale target', async () => {
        let live = refreshedTrade();
        let releaseFirstWrite;
        const firstWriteStarted = new Promise((resolve) => {
            releaseFirstWrite = resolve;
        });
        let writeCalls = 0;
        let completeFirst;
        const firstWriteResult = new Promise((resolve) => {
            completeFirst = resolve;
        });
        const { instance } = executor({
            refresh: async () => [live],
            write: async () => {
                writeCalls += 1;
                releaseFirstWrite();
                return firstWriteResult;
            },
        });
        const first = instance.execute(execution());
        await firstWriteStarted;
        const second = instance.execute(execution());
        live = refreshedTrade({ dealQuantity: 1, orderQuantity: 2 });
        completeFirst(refreshedTrade());
        await expect(first).resolves.toMatchObject({ state: 'reconciling' });
        await expect(second).resolves.toMatchObject({
            state: 'reconciling',
            brokerWriteAttempted: false,
            terminalOutcome: 'broker_target_changed_before_write',
        });
        expect(writeCalls).toBe(1);
    });

    it('treats any exception after invoking write as possible bytes and never retries', async () => {
        const { instance } = executor({
            write: async () => {
                throw new Error('response lost');
            },
        });
        await expect(
            instance.execute(execution()),
        ).resolves.toMatchObject({
            state: 'unknown',
            brokerBytesPossible: true,
            brokerWriteAttempted: true,
            automaticRetryAllowed: false,
            terminalOutcome: 'broker_target_write_result_unknown',
        });
    });

    it('uses the durable non-1000 contract unit for exact CommonLot quantity reduction', async () => {
        const writes = [];
        const { instance } = executor({
            refresh: async () => [refreshedTrade({ orderQuantity: 2 })],
            write: async (request) => {
                writes.push(request);
                return refreshedTrade({ orderQuantity: 2 });
            },
        });
        await expect(
            instance.execute(execution({
                operation: { kind: 'update_quantity', quantityShares: 500 },
                target: target({
                    contractUnit: 500,
                    quantityShares: 1_000,
                    remainingShares: 1_000,
                }),
            })),
        ).resolves.toMatchObject({
            state: 'reconciling',
            automaticRetryAllowed: false,
        });
        expect(writes).toEqual([
            {
                path: '/api/v1/order/update_qty',
                body: { trade_id: 'trade-1', quantity: 1 },
            },
        ]);
    });

    it('does not turn a quantity reduction into an implicit remainder cancel', async () => {
        const { instance, writes } = executor({
            refresh: async () => [
                refreshedTrade({
                    dealQuantity: 1,
                    orderQuantity: 2,
                }),
            ],
        });
        await expect(
            instance.execute(execution({
                operation: { kind: 'update_quantity', quantityShares: 500 },
                target: target({
                    contractUnit: 500,
                    filledShares: 500,
                    quantityShares: 1_000,
                    remainingShares: 500,
                }),
            })),
        ).resolves.toMatchObject({
            state: 'reconciling',
            brokerWriteAttempted: false,
            terminalOutcome: 'broker_target_operation_invalid_before_write',
        });
        expect(writes).toHaveLength(0);
    });

    it('rejects a cross-date target without refreshing or writing', async () => {
        let refreshed = 0;
        const { instance, writes } = executor({
            nowEpochMs: () => Date.parse('2026-08-12T04:00:00.000Z'),
            refresh: async () => {
                refreshed += 1;
                return [refreshedTrade()];
            },
        });
        await expect(
            instance.execute(execution()),
        ).resolves.toMatchObject({
            state: 'reconciling',
            brokerWriteAttempted: false,
            terminalOutcome: 'broker_target_trade_date_stale_before_write',
        });
        expect(refreshed).toBe(0);
        expect(writes).toHaveLength(0);
    });

    it('rejects when refresh or write-adjacent revalidation crosses the Taipei trade date', async () => {
        const clockSamples = [
            Date.parse('2026-08-11T15:59:59.999Z'),
            Date.parse('2026-08-11T16:00:00.000Z'),
        ];
        let clockReads = 0;
        let revalidated = 0;
        const { instance, writes } = executor({
            nowEpochMs: () =>
                clockSamples[Math.min(clockReads++, clockSamples.length - 1)],
        });

        await expect(
            instance.execute(
                execution({
                    beforeWrite: async () => {
                        revalidated += 1;
                    },
                }),
            ),
        ).resolves.toMatchObject({
            state: 'reconciling',
            brokerBytesPossible: false,
            brokerWriteAttempted: false,
            terminalOutcome: 'broker_target_trade_date_stale_before_write',
        });
        expect(clockReads).toBe(2);
        expect(revalidated).toBe(1);
        expect(writes).toHaveLength(0);
    });

    it('revalidates after target refresh and immediately before transport write', async () => {
        const events = [];
        const { instance } = executor({
            refresh: async () => {
                events.push('refresh');
                return [refreshedTrade()];
            },
            write: async () => {
                events.push('write');
                return refreshedTrade();
            },
        });
        await expect(
            instance.execute(
                execution({
                    beforeWrite: async () => {
                        events.push('revalidate');
                    },
                }),
            ),
        ).resolves.toMatchObject({ state: 'reconciling' });
        expect(events).toEqual(['refresh', 'revalidate', 'write']);
    });

    it('never invokes transport write when write-adjacent revalidation fails', async () => {
        const { instance, writes } = executor();
        await expect(
            instance.execute(
                execution({
                    beforeWrite: async () => {
                        throw new Error('generation changed');
                    },
                }),
            ),
        ).rejects.toThrow('generation changed');
        expect(writes).toHaveLength(0);
    });
});
