import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
    canonicalManualStockBrokerWriteRequest,
} from './manual-broker-write-contract.mjs';

function placeRequest(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
        operation: 'place',
        brokerPath: '/api/v1/order/place_order',
        payload: {
            contract: {
                security_type: 'STK',
                region: 'TW',
                exchange: 'TSE',
                code: '2330',
                target_code: null,
            },
            stock_order: {
                action: 'Sell',
                price: 0,
                quantity: 17,
                price_type: 'MKT',
                order_type: 'FOK',
                order_lot: 'IntradayOdd',
                daytrade_short: false,
                custom_field: 'MAN001',
                account: {
                    broker_id: 'TEST',
                    account_id: 'SIMULATION',
                    account_type: 'S',
                },
            },
        },
        ...overrides,
    };
}

describe('manual stock broker write contract', () => {
    const account = {
        broker_id: 'TEST',
        account_id: 'SIMULATION',
        account_type: 'S',
    };
    it('preserves the legal manual payload without applying automation restrictions', () => {
        const canonical = canonicalManualStockBrokerWriteRequest(placeRequest(), {
            expectedOperation: 'place',
        });

        expect(canonical.request.payload.stock_order).toEqual(
            placeRequest().payload.stock_order,
        );
        expect(canonical.request.payload.contract).toEqual(
            placeRequest().payload.contract,
        );
        expect(canonical.requestSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(Object.isFrozen(canonical.request)).toBe(true);
    });

    it('preserves a legal Common day-trade short independently of automation policy', () => {
        const candidate = placeRequest({
            payload: {
                ...placeRequest().payload,
                stock_order: {
                    ...placeRequest().payload.stock_order,
                    order_lot: 'Common',
                    daytrade_short: true,
                },
            },
        });
        expect(
            canonicalManualStockBrokerWriteRequest(candidate).request.payload
                .stock_order,
        ).toMatchObject({
            order_lot: 'Common',
            daytrade_short: true,
            price_type: 'MKT',
            order_type: 'FOK',
        });
    });

    it.each([
        [
            'update_price',
            '/api/v1/order/update_price',
            { trade_id: 'trade-1', price: 123.5, account },
        ],
        [
            'update_quantity',
            '/api/v1/order/update_qty',
            { trade_id: 'trade-1', quantity: 3, account },
        ],
        [
            'cancel',
            '/api/v1/order/cancel_order',
            { trade_id: 'trade-1', account },
        ],
    ])('canonicalizes %s without widening its broker path', (operation, brokerPath, payload) => {
        const canonical = canonicalManualStockBrokerWriteRequest({
            schemaVersion: SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
            operation,
            brokerPath,
            payload,
        });
        expect(canonical.request).toEqual({
            schemaVersion: SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
            operation,
            brokerPath,
            payload,
        });
    });

    it('rejects route confusion, extra fields, accessors, and proxies', () => {
        expect(() =>
            canonicalManualStockBrokerWriteRequest(
                placeRequest({ brokerPath: '/api/v1/order/cancel_order' }),
            ),
        ).toThrow(/binding/);
        expect(() =>
            canonicalManualStockBrokerWriteRequest({
                ...placeRequest(),
                provenance: 'manual_user_confirmed',
            }),
        ).toThrow(/schema/);
        expect(() =>
            canonicalManualStockBrokerWriteRequest(
                Object.defineProperty(placeRequest(), 'payload', {
                    enumerable: true,
                    get: () => placeRequest().payload,
                }),
            ),
        ).toThrow(/own data/);
        expect(() =>
            canonicalManualStockBrokerWriteRequest(new Proxy(placeRequest(), {})),
        ).toThrow(/object/);
        expect(() =>
            canonicalManualStockBrokerWriteRequest(
                placeRequest({
                    payload: {
                        ...placeRequest().payload,
                        stock_order: {
                            ...placeRequest().payload.stock_order,
                            daytrade_short: true,
                        },
                    },
                }),
            ),
        ).toThrow(/Common/);
    });
});
