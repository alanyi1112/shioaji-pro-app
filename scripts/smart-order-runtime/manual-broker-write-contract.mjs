import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

export const SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION =
    'smart-order-manual-broker-write-request/2026-08-14.1';

const BROKER_PATH_BY_OPERATION = Object.freeze({
    place: '/api/v1/order/place_order',
    update_price: '/api/v1/order/update_price',
    update_quantity: '/api/v1/order/update_qty',
    cancel: '/api/v1/order/cancel_order',
});

const STOCK_ORDER_LOTS = new Set(['Common', 'IntradayOdd']);
const STOCK_PRICE_TYPES = new Set(['LMT', 'MKT']);
const STOCK_ORDER_TYPES = new Set(['ROD', 'IOC', 'FOK']);

function snapshotOwnData(value, requiredKeys, optionalKeys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be an object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
        actualKeys.some((key) => typeof key !== 'string') ||
        requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
        actualKeys.some((key) => !allowed.has(key))
    ) {
        throw new TypeError(`${label} has an invalid schema`);
    }
    const result = {};
    for (const key of actualKeys) {
        const descriptor = descriptors[key];
        if (
            descriptor?.enumerable !== true ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use own data properties`);
        }
        result[key] = descriptor.value;
    }
    return Object.freeze(result);
}

function token(value, label, maximumLength = 240) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumLength ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function finiteNumber(value, label, { positive = false } = {}) {
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (positive ? value <= 0 : value < 0)
    ) {
        throw new TypeError(`${label} must be a finite number`);
    }
    return value;
}

function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${label} must be a positive safe integer`);
    }
    return value;
}

function canonicalContract(value) {
    const input = snapshotOwnData(
        value,
        ['code', 'exchange', 'region', 'security_type', 'target_code'],
        [],
        'manual stock contract',
    );
    if (
        input.security_type !== 'STK' ||
        input.region !== 'TW' ||
        !['TSE', 'OTC'].includes(input.exchange) ||
        (input.target_code !== null && typeof input.target_code !== 'string')
    ) {
        throw new TypeError('manual stock contract is unsupported');
    }
    return Object.freeze({
        security_type: 'STK',
        region: 'TW',
        exchange: input.exchange,
        code: stockCode(input.code, 'manual stock contract code'),
        target_code:
            input.target_code === null
                ? null
                : stockCode(
                      input.target_code,
                      'manual stock target code',
                  ),
    });
}

function stockCode(value, label) {
    const current = token(value, label, 32);
    if (!/^[A-Z0-9]+$/.test(current)) {
        throw new TypeError(`${label} is invalid`);
    }
    return current;
}

function canonicalAccount(value) {
    const input = snapshotOwnData(
        value,
        ['account_id', 'account_type', 'broker_id'],
        [],
        'manual stock account',
    );
    if (input.account_type !== 'S') {
        throw new TypeError('manual stock account type must be S');
    }
    return Object.freeze({
        broker_id: token(input.broker_id, 'manual stock broker id'),
        account_id: token(input.account_id, 'manual stock account id'),
        account_type: 'S',
    });
}

function canonicalStockOrder(value) {
    const input = snapshotOwnData(
        value,
        ['account', 'action', 'price', 'price_type', 'quantity', 'order_type'],
        ['custom_field', 'daytrade_short', 'order_lot'],
        'manual stock order',
    );
    if (
        !['Buy', 'Sell'].includes(input.action) ||
        !STOCK_PRICE_TYPES.has(input.price_type) ||
        !STOCK_ORDER_TYPES.has(input.order_type) ||
        !STOCK_ORDER_LOTS.has(input.order_lot ?? 'Common') ||
        (input.daytrade_short !== undefined &&
            typeof input.daytrade_short !== 'boolean')
    ) {
        throw new TypeError('manual stock order class is invalid');
    }
    if (
        input.daytrade_short === true &&
        (input.order_lot ?? 'Common') !== 'Common'
    ) {
        throw new TypeError(
            'manual day-trade short requires Common order lot',
        );
    }
    const price = finiteNumber(input.price, 'manual stock price');
    if (input.price_type === 'LMT' && price <= 0) {
        throw new TypeError('manual LMT stock order requires a positive price');
    }
    if (
        input.custom_field !== undefined &&
        (typeof input.custom_field !== 'string' ||
            !/^[A-Za-z0-9]{1,6}$/.test(input.custom_field))
    ) {
        throw new TypeError('manual stock custom field is invalid');
    }
    return Object.freeze({
        action: input.action,
        price,
        quantity: positiveInteger(input.quantity, 'manual stock quantity'),
        price_type: input.price_type,
        order_type: input.order_type,
        order_lot: input.order_lot ?? 'Common',
        ...(input.daytrade_short === undefined
            ? {}
            : { daytrade_short: input.daytrade_short }),
        ...(input.custom_field === undefined
            ? {}
            : { custom_field: input.custom_field }),
        account: canonicalAccount(input.account),
    });
}

function canonicalPayload(operation, value) {
    if (operation === 'place') {
        const input = snapshotOwnData(
            value,
            ['contract', 'stock_order'],
            [],
            'manual place payload',
        );
        return Object.freeze({
            contract: canonicalContract(input.contract),
            stock_order: canonicalStockOrder(input.stock_order),
        });
    }
    if (operation === 'update_price') {
        const input = snapshotOwnData(
            value,
            ['account', 'price', 'trade_id'],
            [],
            'manual update price payload',
        );
        return Object.freeze({
            trade_id: token(input.trade_id, 'manual trade id'),
            price: finiteNumber(input.price, 'manual update price', {
                positive: true,
            }),
            account: canonicalAccount(input.account),
        });
    }
    if (operation === 'update_quantity') {
        const input = snapshotOwnData(
            value,
            ['account', 'quantity', 'trade_id'],
            [],
            'manual update quantity payload',
        );
        return Object.freeze({
            trade_id: token(input.trade_id, 'manual trade id'),
            quantity: positiveInteger(
                input.quantity,
                'manual update quantity',
            ),
            account: canonicalAccount(input.account),
        });
    }
    const input = snapshotOwnData(
        value,
        ['account', 'trade_id'],
        [],
        'manual cancel payload',
    );
    return Object.freeze({
        trade_id: token(input.trade_id, 'manual trade id'),
        account: canonicalAccount(input.account),
    });
}

export function canonicalManualStockBrokerWriteRequest(
    value,
    { expectedOperation } = {},
) {
    const input = snapshotOwnData(
        value,
        ['brokerPath', 'operation', 'payload', 'schemaVersion'],
        [],
        'manual broker write request',
    );
    if (
        input.schemaVersion !==
            SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION ||
        !Object.hasOwn(BROKER_PATH_BY_OPERATION, input.operation) ||
        input.brokerPath !== BROKER_PATH_BY_OPERATION[input.operation] ||
        (expectedOperation !== undefined &&
            input.operation !== expectedOperation)
    ) {
        throw new TypeError('manual broker write request binding is invalid');
    }
    const request = Object.freeze({
        schemaVersion:
            SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
        operation: input.operation,
        brokerPath: input.brokerPath,
        payload: canonicalPayload(input.operation, input.payload),
    });
    // `canonicalJson` intentionally rejects non-integer numbers. Shioaji stock
    // limit prices are decimal numbers, so construct every key above in one
    // fixed order and serialize that immutable projection directly. No caller
    // object or insertion order reaches this hash boundary.
    const requestJson = JSON.stringify(request);
    return Object.freeze({
        request,
        requestJson,
        requestSha256: `sha256:${createHash('sha256')
            .update(requestJson)
            .digest('hex')}`,
    });
}
