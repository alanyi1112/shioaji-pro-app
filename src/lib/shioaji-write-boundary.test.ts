import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    apiPost: vi.fn(),
    submitManualStockBrokerWrite: vi.fn(),
}));

vi.mock('./api', () => ({
    apiDelete: vi.fn(),
    apiGet: vi.fn(),
    apiPost: mocks.apiPost,
    apiPut: vi.fn(),
}));
vi.mock('./account-store', () => ({
    accountFor: vi.fn(() => ({
        broker_id: 'TEST',
        account_id: 'SIMULATION',
        account_type: 'S',
    })),
}));
vi.mock('./smart-order-client', () => ({
    submitManualStockBrokerWrite: mocks.submitManualStockBrokerWrite,
}));

import {
    cancelFuturesOrder,
    cancelOrder,
    placeFuturesOrder,
    placeStockOrder,
    updateOrderPrice,
} from './shioaji';
import type { Trade } from './types/order';

const account = {
    broker_id: 'TEST',
    account_id: 'SIMULATION',
    account_type: 'S',
};
const stockTrade = {
    contract: {
        security_type: 'STK',
        region: 'TW',
        exchange: 'TSE',
        code: '2330',
        target_code: null,
    },
    order: { id: 'trade-1', account },
    status: {},
} as unknown as Trade;

describe('Shioaji browser stock write boundary', () => {
    beforeEach(() => {
        mocks.apiPost.mockReset();
        mocks.submitManualStockBrokerWrite.mockReset();
        mocks.submitManualStockBrokerWrite.mockRejectedValue(
            new Error('broker_write_gate_closed'),
        );
    });

    it('routes place, update and cancel through the stock gateway with exact account binding', async () => {
        await expect(
            placeStockOrder(
                stockTrade.contract,
                {
                    action: 'Sell',
                    price: 0,
                    quantity: 17,
                    price_type: 'MKT',
                    order_type: 'FOK',
                    order_lot: 'IntradayOdd',
                    daytrade_short: false,
                },
                'STK-MAN-PLACE-TICKET',
            ),
        ).rejects.toThrow('broker_write_gate_closed');
        await expect(
            updateOrderPrice(
                stockTrade.order.id,
                101.5,
                stockTrade.order.account,
                'STK-MAN-UPDATE-ORDER-PRICE',
            ),
        ).rejects.toThrow('broker_write_gate_closed');
        await expect(
            cancelOrder(
                stockTrade.order.id,
                stockTrade.order.account,
                'STK-MAN-CANCEL-ORDER-TABLE',
            ),
        ).rejects.toThrow('broker_write_gate_closed');

        expect(mocks.apiPost).not.toHaveBeenCalled();
        expect(mocks.submitManualStockBrokerWrite).toHaveBeenCalledTimes(3);
        expect(mocks.submitManualStockBrokerWrite.mock.calls[1]?.[1]).toMatchObject(
            {
                operation: 'update_price',
                payload: { trade_id: 'trade-1', account },
            },
        );
        expect(mocks.submitManualStockBrokerWrite.mock.calls[2]?.[1]).toMatchObject(
            {
                operation: 'cancel',
                payload: { trade_id: 'trade-1', account },
            },
        );
    });

    it('cannot use the direct futures helpers with a stock contract or trade', async () => {
        await expect(
            placeFuturesOrder(stockTrade.contract, {
                action: 'Sell',
                price: 100,
                quantity: 1,
                price_type: 'LMT',
                order_type: 'ROD',
                octype: 'Auto',
            }),
        ).rejects.toThrow('futures contract');
        expect(() => cancelFuturesOrder(stockTrade)).toThrow('futures trade');
        expect(mocks.apiPost).not.toHaveBeenCalled();
    });
});
