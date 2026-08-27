import { types as utilTypes } from 'node:util';
import {
    SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
    normalizeCanonicalSmartOrderBrokerEvent,
} from './broker-event-normalizer.mjs';

export const SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION =
    'smart-order-shioaji-stock-event-and-quote-mapping/2026-08-26.2';
export const SMART_ORDER_MAX_REFRESHED_TRADES = 4_096;

const TAIPEI_DATE = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function object(value, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} must be a plain object`);
    }
    return value;
}

function fields(value, names, label) {
    object(value, label);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = {};
    for (const name of names) {
        const descriptor = descriptors[name];
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true
        ) {
            throw new TypeError(`${label}.${name} must be an own data property`);
        }
        result[name] = descriptor.value;
    }
    return Object.freeze(result);
}

function optionalDataField(value, name, label) {
    object(value, label);
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor) return undefined;
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
        throw new TypeError(`${label}.${name} must be an own data property`);
    }
    return descriptor.value;
}

function token(value, label, maximum = 160) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function nullableMessage(value, label) {
    if (value === undefined || value === null || value === '') return null;
    return token(value, label, 512);
}

function nonnegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function positiveInteger(value, label) {
    const result = nonnegativeInteger(value, label);
    if (result < 1) throw new TypeError(`${label} must be positive`);
    return result;
}

function epochMs(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${label} must be a positive epoch number`);
    }
    const milliseconds =
        value > 1e14 ? Math.trunc(value / 1e6) : value > 1e11 ? Math.trunc(value) : Math.trunc(value * 1_000);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) {
        throw new TypeError(`${label} is outside the supported epoch range`);
    }
    return milliseconds;
}

function canonicalDecimal(value, label) {
    const text = typeof value === 'number' ? String(value) : value;
    if (
        typeof text !== 'string' ||
        !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(text)
    ) {
        throw new TypeError(`${label} must be a canonical decimal`);
    }
    return text;
}

function account(value, label) {
    const input = fields(
        value,
        ['account_id', 'account_type', 'broker_id'],
        label,
    );
    if (input.account_type !== 'S') {
        throw new TypeError(`${label} must be a stock account`);
    }
    return Object.freeze({
        brokerId: token(input.broker_id, `${label}.broker_id`, 128),
        accountId: token(input.account_id, `${label}.account_id`, 128),
        accountType: 'S',
    });
}

function sameAccount(left, right) {
    return (
        left.brokerId === right.brokerId &&
        left.accountId === right.accountId &&
        left.accountType === right.accountType
    );
}

function tradeDateFor(epoch) {
    const parts = Object.fromEntries(
        TAIPEI_DATE.formatToParts(new Date(epoch)).map((part) => [
            part.type,
            part.value,
        ]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function orderLotUnit(orderLot) {
    return ['Odd', 'IntradayOdd'].includes(orderLot) ? 'Share' : 'CommonLot';
}

function unwrapStockEvent(payload) {
    const envelope = fields(payload, ['data', 'state'], 'Shioaji order event');
    if (!['StockOrder', 'StockDeal'].includes(envelope.state)) {
        throw new TypeError('only official stock order/deal callbacks are supported');
    }
    const data = object(envelope.data, 'Shioaji order event.data');
    const descriptor = Object.getOwnPropertyDescriptor(data, envelope.state);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Shioaji callback variant is missing');
    }
    return Object.freeze({
        eventKind: envelope.state === 'StockOrder' ? 'order' : 'deal',
        body: object(descriptor.value, `Shioaji ${envelope.state}`),
    });
}

function canonicalTrade(value, label) {
    const trade = fields(value, ['contract', 'order', 'status'], label);
    const contract = fields(
        trade.contract,
        ['code', 'exchange', 'security_type'],
        `${label}.contract`,
    );
    if (contract.security_type !== 'STK') {
        throw new TypeError(`${label} must describe a stock contract`);
    }
    const order = fields(
        trade.order,
        [
            'account',
            'action',
            'id',
            'order_cond',
            'order_lot',
            'order_type',
            'ordno',
            'price',
            'price_type',
            'quantity',
            'seqno',
        ],
        `${label}.order`,
    );
    const status = fields(
        trade.status,
        [
            'cancel_quantity',
            'deal_quantity',
            'id',
            'order_quantity',
            'status',
        ],
        `${label}.status`,
    );
    const modifiedPrice = optionalDataField(
        trade.status,
        'modified_price',
        `${label}.status`,
    );
    const canonicalAccount = account(order.account, `${label}.order.account`);
    const customField = optionalDataField(
        trade.order,
        'custom_field',
        `${label}.order`,
    );
    const requestedOrderQuantity = positiveInteger(
        order.quantity,
        `${label}.order.quantity`,
    );
    const reportedOrderQuantity = nonnegativeInteger(
        status.order_quantity,
        `${label}.status.order_quantity`,
    );
    const orderQuantity =
        reportedOrderQuantity === 0
            ? requestedOrderQuantity
            : reportedOrderQuantity;
    const cumulativeDeal = nonnegativeInteger(
        status.deal_quantity,
        `${label}.status.deal_quantity`,
    );
    const cumulativeCancel = nonnegativeInteger(
        status.cancel_quantity,
        `${label}.status.cancel_quantity`,
    );
    const remaining = orderQuantity - cumulativeDeal - cumulativeCancel;
    if (remaining < 0) {
        throw new TypeError(`${label} cumulative quantities are inconsistent`);
    }
    const originalPrice = canonicalDecimal(order.price, `${label}.order.price`);
    const effectivePrice =
        modifiedPrice === undefined ||
        modifiedPrice === null ||
        modifiedPrice === 0 ||
        modifiedPrice === '0'
            ? originalPrice
            : canonicalDecimal(modifiedPrice, `${label}.status.modified_price`);
    return Object.freeze({
        account: canonicalAccount,
        action: token(order.action, `${label}.order.action`),
        contractCode: token(contract.code, `${label}.contract.code`),
        contractKey: `${token(contract.exchange, `${label}.contract.exchange`)}:${token(contract.code, `${label}.contract.code`)}:STK:${token(order.order_lot, `${label}.order.order_lot`)}`,
        cumulativeCancel,
        cumulativeDeal,
        customField:
            customField === undefined || customField === '' || customField === null
                ? ''
                : token(customField, `${label}.order.custom_field`, 6),
        orderCondition: token(order.order_cond, `${label}.order.order_cond`),
        orderId: token(status.id, `${label}.status.id`),
        orderLot: token(order.order_lot, `${label}.order.order_lot`),
        orderQuantity,
        ordno: token(order.ordno, `${label}.order.ordno`),
        // Shioaji keeps the submitted price in order.price after UpdatePrice and
        // reports the current working price in status.modified_price.
        price: effectivePrice,
        priceType: token(order.price_type, `${label}.order.price_type`),
        remaining,
        seqno: token(order.seqno, `${label}.order.seqno`),
        status: token(status.status, `${label}.status.status`),
        timeInForce: token(order.order_type, `${label}.order.order_type`),
        tradeId: token(order.id, `${label}.order.id`),
        unit: orderLotUnit(order.order_lot),
    });
}

export function canonicalizeShioajiRefreshedStockTrades(value) {
    if (!Array.isArray(value) || isProxy(value) || value.length > SMART_ORDER_MAX_REFRESHED_TRADES) {
        throw new TypeError('refreshed trades must be a bounded array');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.freeze(
        Array.from({ length: value.length }, (_, index) => {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new TypeError('refreshed trades may not contain accessors or holes');
            }
            return canonicalTrade(descriptor.value, `refreshedTrades[${index}]`);
        }),
    );
}

function findUniqueTrade(trades, expectedAccount, predicate) {
    const matches = trades.filter(
        (trade) => sameAccount(trade.account, expectedAccount) && predicate(trade),
    );
    if (matches.length !== 1) {
        throw new Error('Shioaji event did not resolve to one fixed-account trade');
    }
    return matches[0];
}

export function mapShioajiStockBrokerEvent({
    account: fixedAccount,
    apiGeneration,
    payload,
    receiveEpochMs,
    refreshedTrades: refreshed,
}) {
    const expectedAccount = Object.freeze({
        brokerId: token(fixedAccount?.brokerId, 'account.brokerId', 128),
        accountId: token(fixedAccount?.accountId, 'account.accountId', 128),
        accountType:
            fixedAccount?.accountType === 'S'
                ? 'S'
                : (() => {
                      throw new TypeError('account.accountType must be S');
                  })(),
    });
    const receivedAt = nonnegativeInteger(receiveEpochMs, 'receiveEpochMs');
    const unwrapped = unwrapStockEvent(payload);
    const trades = canonicalizeShioajiRefreshedStockTrades(refreshed);
    let trade;
    let body;
    let exchangeEpochMs;
    let eventDeal = 0;
    let exchangeSequence = null;
    let ordno;
    let price;
    let operation;
    if (unwrapped.eventKind === 'order') {
        body = fields(
            unwrapped.body,
            ['contract', 'operation', 'order', 'status'],
            'StockOrder callback',
        );
        const callbackOrder = fields(
            body.order,
            ['account', 'id', 'seqno'],
            'StockOrder callback.order',
        );
        const callbackAccount = account(
            callbackOrder.account,
            'StockOrder callback.order.account',
        );
        if (!sameAccount(callbackAccount, expectedAccount)) {
            throw new Error('StockOrder callback account is not the fixed account');
        }
        trade = findUniqueTrade(
            trades,
            expectedAccount,
            (candidate) =>
                candidate.tradeId === callbackOrder.id &&
                candidate.seqno === callbackOrder.seqno,
        );
        const callbackStatus = fields(
            body.status,
            ['exchange_ts'],
            'StockOrder callback.status',
        );
        const callbackOperation = fields(
            body.operation,
            ['op_code', 'op_msg', 'op_type'],
            'StockOrder callback.operation',
        );
        exchangeEpochMs = epochMs(
            callbackStatus.exchange_ts,
            'StockOrder callback.status.exchange_ts',
        );
        ordno = trade.ordno;
        price = trade.price;
        operation = Object.freeze({
            type: token(callbackOperation.op_type, 'operation.op_type', 64),
            code: token(callbackOperation.op_code, 'operation.op_code', 64),
            message: nullableMessage(callbackOperation.op_msg, 'operation.op_msg'),
        });
    } else {
        body = fields(
            unwrapped.body,
            [
                'account_id',
                'action',
                'broker_id',
                'code',
                'custom_field',
                'exchange_seq',
                'ordno',
                'order_cond',
                'order_lot',
                'price',
                'quantity',
                'seqno',
                'trade_id',
                'ts',
            ],
            'StockDeal callback',
        );
        trade = findUniqueTrade(
            trades,
            expectedAccount,
            (candidate) =>
                candidate.tradeId === body.trade_id &&
                candidate.seqno === body.seqno &&
                candidate.contractCode === body.code &&
                candidate.action === body.action,
        );
        exchangeEpochMs = epochMs(body.ts, 'StockDeal callback.ts');
        eventDeal = positiveInteger(body.quantity, 'StockDeal callback.quantity');
        exchangeSequence = token(
            body.exchange_seq,
            'StockDeal callback.exchange_seq',
        );
        ordno = token(body.ordno, 'StockDeal callback.ordno');
        price = canonicalDecimal(body.price, 'StockDeal callback.price');
        if (
            token(body.broker_id, 'StockDeal callback.broker_id', 128) !==
                expectedAccount.brokerId ||
            token(body.account_id, 'StockDeal callback.account_id', 128) !==
                expectedAccount.accountId ||
            body.order_cond !== trade.orderCondition ||
            body.order_lot !== trade.orderLot ||
            body.custom_field !== trade.customField
        ) {
            throw new Error('StockDeal callback order lot changed its order lineage');
        }
        operation = Object.freeze({ type: null, code: null, message: null });
    }
    if (exchangeEpochMs > receivedAt) {
        throw new Error('broker event receive time precedes exchange time');
    }
    const candidate = {
        schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
        mappingRevision: SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
        apiGeneration: token(apiGeneration, 'apiGeneration'),
        eventKind: unwrapped.eventKind,
        account: expectedAccount,
        tradeDate: tradeDateFor(exchangeEpochMs),
        contractKey: trade.contractKey,
        side: trade.action,
        identifiers: {
            tradeId: trade.tradeId,
            orderId: unwrapped.eventKind === 'order' ? trade.orderId : null,
            dealId: null,
            seqno: trade.seqno,
            ordno,
            exchangeSequence,
            customField: trade.customField,
        },
        operation,
        status: trade.status,
        orderClass: {
            orderCondition: trade.orderCondition,
            orderLot: trade.orderLot,
            priceType: trade.priceType,
            timeInForce: trade.timeInForce,
        },
        quantities: {
            order: trade.orderQuantity,
            cumulativeDeal: trade.cumulativeDeal,
            cumulativeCancel: trade.cumulativeCancel,
            remaining: trade.remaining,
            eventDeal,
            unit: trade.unit,
        },
        price,
        timestamps: {
            exchangeEpochMs,
            brokerEpochMs: null,
            receiveEpochMs: receivedAt,
        },
    };
    return normalizeCanonicalSmartOrderBrokerEvent(candidate);
}
