import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';
import {
    smartOrderCommonLotsToShares,
    smartOrderSharesToCommonLots,
} from './canonical-stock-unit-contract.mjs';

export const SMART_ORDER_NODE_SAFE_BROKER_TARGET_SCHEMA_VERSION =
    'smart-order-node-safe-broker-target/2026-08-20.1';

const ACCOUNT_LOCKS = new Map();
const ORDER_LOCKS = new Map();
const TERMINAL_STATUSES = new Set(['Filled', 'Cancelled', 'Inactive', 'Failed']);

function snapshot(value, requiredKeys, optionalKeys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be a non-Proxy object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
        keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
        requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const result = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            descriptor?.enumerable !== true ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label}.${key} must be an own data property`);
        }
        result[key] = descriptor.value;
    }
    return Object.freeze(result);
}

function token(value, label, maximum = 240) {
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

function digest(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sha256(value, label) {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function nonnegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function positiveInteger(value, label) {
    const current = nonnegativeInteger(value, label);
    if (current < 1) throw new TypeError(`${label} must be positive`);
    return current;
}

function account(value) {
    const current = snapshot(
        value,
        ['accountId', 'accountType', 'brokerId'],
        [],
        'fixed account',
    );
    if (current.accountType !== 'S') {
        throw new TypeError('fixed account must be a stock account');
    }
    return Object.freeze({
        brokerId: token(current.brokerId, 'fixed account brokerId', 128),
        accountId: token(current.accountId, 'fixed account accountId', 128),
        accountType: 'S',
    });
}

function identifiers(value) {
    const current = snapshot(
        value,
        ['customField', 'exchangeSequence', 'orderId', 'ordno', 'seqno', 'tradeId'],
        [],
        'broker target identifiers',
    );
    const result = {};
    for (const key of [
        'tradeId',
        'orderId',
        'seqno',
        'ordno',
        'exchangeSequence',
        'customField',
    ]) {
        const value = current[key];
        result[key] = value === null ? null : token(value, `target.${key}`, 160);
    }
    if (!result.tradeId || !result.seqno || !result.ordno) {
        throw new TypeError(
            'broker target requires durable tradeId, seqno and ordno identifiers',
        );
    }
    return Object.freeze(result);
}

function target(value) {
    const current = snapshot(
        value,
        [
            'account',
            'brokerOrderId',
            'brokerOrderRevision',
            'contractKey',
            'contractUnit',
            'controlRevision',
            'evidenceSha256',
            'filledShares',
            'identifiers',
            'orderCondition',
            'orderLot',
            'priceDecimal',
            'priceType',
            'quantityShares',
            'quantityUnit',
            'remainingShares',
            'side',
            'state',
            'targetRevision',
            'timeInForce',
            'tradeDate',
        ],
        [],
        'broker target',
    );
    const fixedAccount = account(current.account);
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(current.tradeDate) ||
        !['Buy', 'Sell'].includes(current.side) ||
        !['Share', 'CommonLot'].includes(current.quantityUnit) ||
        !['pending_submit', 'pre_submitted', 'submitted', 'part_filled'].includes(
            current.state,
        )
    ) {
        throw new TypeError('broker target scope or state is invalid');
    }
    const quantityShares = positiveInteger(
        current.quantityShares,
        'target.quantityShares',
    );
    const filledShares = nonnegativeInteger(
        current.filledShares,
        'target.filledShares',
    );
    const remainingShares = positiveInteger(
        current.remainingShares,
        'target.remainingShares',
    );
    if (filledShares + remainingShares !== quantityShares) {
        throw new TypeError('broker target quantity projection is inconsistent');
    }
    return Object.freeze({
        account: fixedAccount,
        brokerOrderId: token(current.brokerOrderId, 'target.brokerOrderId'),
        brokerOrderRevision: nonnegativeInteger(
            current.brokerOrderRevision,
            'target.brokerOrderRevision',
        ),
        contractKey: token(current.contractKey, 'target.contractKey'),
        contractUnit: positiveInteger(current.contractUnit, 'target.contractUnit'),
        controlRevision: nonnegativeInteger(
            current.controlRevision,
            'target.controlRevision',
        ),
        evidenceSha256: sha256(current.evidenceSha256, 'target.evidenceSha256'),
        filledShares,
        identifiers: identifiers(current.identifiers),
        orderCondition: token(current.orderCondition, 'target.orderCondition'),
        orderLot: token(current.orderLot, 'target.orderLot'),
        priceDecimal:
            current.priceDecimal === null
                ? null
                : token(current.priceDecimal, 'target.priceDecimal'),
        priceType: token(current.priceType, 'target.priceType'),
        quantityShares,
        quantityUnit: current.quantityUnit,
        remainingShares,
        side: current.side,
        state: current.state,
        targetRevision: sha256(current.targetRevision, 'target.targetRevision'),
        timeInForce: token(current.timeInForce, 'target.timeInForce'),
        tradeDate: current.tradeDate,
    });
}

function operation(value) {
    const root = snapshot(value, ['kind'], ['price', 'quantityShares'], 'operation');
    if (root.kind === 'cancel' && Object.keys(root).length === 1) {
        return Object.freeze({ kind: 'cancel' });
    }
    if (root.kind === 'update_price' && Object.keys(root).sort().join() === 'kind,price') {
        const price = token(root.price, 'operation.price', 48);
        if (!/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(price) || price === '0') {
            throw new TypeError('operation.price must be a positive canonical decimal');
        }
        return Object.freeze({ kind: root.kind, price });
    }
    if (
        root.kind === 'update_quantity' &&
        Object.keys(root).sort().join() === 'kind,quantityShares'
    ) {
        return Object.freeze({
            kind: root.kind,
            quantityShares: positiveInteger(
                root.quantityShares,
                'operation.quantityShares',
            ),
        });
    }
    throw new TypeError('broker target operation is invalid');
}

function taipeiTradeDate(epochMs) {
    if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
        throw new TypeError('nowEpochMs must return a non-negative safe integer');
    }
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(epochMs));
}

function shares(quantity, unit, contractUnit, label) {
    const current = nonnegativeInteger(quantity, label);
    if (unit === 'Share') return current;
    if (unit !== 'CommonLot') throw new TypeError(`${label} unit is invalid`);
    try {
        return smartOrderCommonLotsToShares(current, contractUnit);
    } catch {
        throw new TypeError(`${label} exceeds Share bounds`);
    }
}

function sameAccount(left, right) {
    return (
        left.brokerId === right.brokerId &&
        left.accountId === right.accountId &&
        left.accountType === right.accountType
    );
}

function accountLockKey(fixedAccount) {
    return digest(
        canonicalJson([
            'smart-order-account-lock/2026-08-20.1',
            account(fixedAccount),
        ]),
    );
}

function liveTargetMatches(expected, live) {
    const ids = expected.identifiers;
    if (
        !sameAccount(expected.account, live.account) ||
        live.contractKey !== expected.contractKey ||
        live.action !== expected.side ||
        live.unit !== expected.quantityUnit ||
        live.tradeId !== ids.tradeId ||
        live.seqno !== ids.seqno ||
        live.ordno !== ids.ordno ||
        (ids.orderId !== null && live.orderId !== ids.orderId) ||
        (ids.customField !== null && live.customField !== ids.customField) ||
        live.orderCondition !== expected.orderCondition ||
        live.orderLot !== expected.orderLot ||
        live.priceType !== expected.priceType ||
        live.timeInForce !== expected.timeInForce ||
        live.price !== expected.priceDecimal ||
        TERMINAL_STATUSES.has(live.status)
    ) {
        return false;
    }
    const quantityShares = shares(
        live.orderQuantity - live.cumulativeCancel,
        live.unit,
        expected.contractUnit,
        'live order quantity',
    );
    const filledShares = shares(
        live.cumulativeDeal,
        live.unit,
        expected.contractUnit,
        'live filled quantity',
    );
    const remainingShares = shares(
        live.remaining,
        live.unit,
        expected.contractUnit,
        'live remaining quantity',
    );
    return (
        quantityShares === expected.quantityShares &&
        filledShares === expected.filledShares &&
        remainingShares === expected.remainingShares
    );
}

function upstreamOperation(current, expectedTarget) {
    if (current.kind === 'cancel') {
        return Object.freeze({
            path: '/api/v1/order/cancel_order',
            body: Object.freeze({ trade_id: expectedTarget.identifiers.tradeId }),
        });
    }
    if (current.kind === 'update_price') {
        return Object.freeze({
            path: '/api/v1/order/update_price',
            body: Object.freeze({
                trade_id: expectedTarget.identifiers.tradeId,
                price: Number(current.price),
            }),
        });
    }
    let commonLots;
    try {
        commonLots = smartOrderSharesToCommonLots(
            current.quantityShares,
            expectedTarget.contractUnit,
        );
    } catch {
        commonLots = null;
    }
    if (
        current.quantityShares >= expectedTarget.quantityShares ||
        current.quantityShares <= expectedTarget.filledShares ||
        commonLots === null
    ) {
        throw new Error('update quantity is not an exact safe reduction');
    }
    return Object.freeze({
        path: '/api/v1/order/update_qty',
        body: Object.freeze({
            trade_id: expectedTarget.identifiers.tradeId,
            quantity:
                expectedTarget.quantityUnit === 'Share'
                    ? current.quantityShares
                    : commonLots,
        }),
    });
}

async function withLock(registry, key, callback) {
    const previous = registry.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current);
    registry.set(key, tail);
    await previous;
    try {
        return await callback();
    } finally {
        release();
        if (registry.get(key) === tail) registry.delete(key);
    }
}

export async function withNodeSafeBrokerAccountLock(
    fixedAccount,
    callback,
) {
    if (typeof callback !== 'function' || utilTypes.isProxy(callback)) {
        throw new TypeError('broker account lock callback is invalid');
    }
    return withLock(
        ACCOUNT_LOCKS,
        accountLockKey(fixedAccount),
        callback,
    );
}

function staleResult(reason, expectedTarget) {
    return Object.freeze({
        schemaVersion: SMART_ORDER_NODE_SAFE_BROKER_TARGET_SCHEMA_VERSION,
        state: 'reconciling',
        terminalOutcome: reason,
        targetRevision: expectedTarget.targetRevision,
        brokerBytesPossible: false,
        brokerWriteAttempted: false,
        automaticRetryAllowed: false,
        brokerAuthority: false,
    });
}

function possibleBytesResult(reason, expectedTarget) {
    return Object.freeze({
        schemaVersion: SMART_ORDER_NODE_SAFE_BROKER_TARGET_SCHEMA_VERSION,
        state: 'unknown',
        terminalOutcome: reason,
        targetRevision: expectedTarget.targetRevision,
        brokerBytesPossible: true,
        brokerWriteAttempted: true,
        automaticRetryAllowed: false,
        brokerAuthority: false,
    });
}

export function createNodeSafeBrokerTargetExecutor(options) {
    const input = snapshot(
        options,
        ['nowEpochMs', 'transport'],
        [],
        'broker target executor options',
    );
    if (typeof input.nowEpochMs !== 'function') {
        throw new TypeError('nowEpochMs must be a function');
    }
    const transport = snapshot(
        input.transport,
        ['refreshFixedAccountTrades', 'write'],
        [],
        'broker target transport',
    );
    if (
        typeof transport.refreshFixedAccountTrades !== 'function' ||
        typeof transport.write !== 'function' ||
        utilTypes.isProxy(transport.refreshFixedAccountTrades) ||
        utilTypes.isProxy(transport.write)
    ) {
        throw new TypeError('broker target transport methods are invalid');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_NODE_SAFE_BROKER_TARGET_SCHEMA_VERSION,
        brokerAuthority: false,
        async execute(value) {
            const call = snapshot(
                value,
                ['beforeWrite', 'operation', 'target'],
                [],
                'broker target execution',
            );
            if (
                typeof call.beforeWrite !== 'function' ||
                utilTypes.isProxy(call.beforeWrite)
            ) {
                throw new TypeError(
                    'broker target beforeWrite must be a non-Proxy function',
                );
            }
            const expectedTarget = target(call.target);
            const currentOperation = operation(call.operation);
            const accountKey = accountLockKey(expectedTarget.account);
            const orderKey = digest(
                canonicalJson([
                    'smart-order-order-lock/2026-08-20.1',
                    accountKey,
                    expectedTarget.tradeDate,
                    expectedTarget.brokerOrderId,
                    expectedTarget.identifiers,
                ]),
            );
            return withLock(ACCOUNT_LOCKS, accountKey, () =>
                withLock(ORDER_LOCKS, orderKey, async () => {
                    if (
                        taipeiTradeDate(
                            Reflect.apply(input.nowEpochMs, undefined, []),
                        ) !== expectedTarget.tradeDate
                    ) {
                        return staleResult(
                            'broker_target_trade_date_stale_before_write',
                            expectedTarget,
                        );
                    }
                    let refreshed;
                    try {
                        refreshed = await Reflect.apply(
                            transport.refreshFixedAccountTrades,
                            input.transport,
                            [expectedTarget.account],
                        );
                    } catch {
                        return staleResult(
                            'broker_target_refresh_failed_before_write',
                            expectedTarget,
                        );
                    }
                    let trades;
                    try {
                        trades = canonicalizeShioajiRefreshedStockTrades(refreshed);
                    } catch {
                        return staleResult(
                            'broker_target_refresh_invalid_before_write',
                            expectedTarget,
                        );
                    }
                    const matches = trades.filter((candidate) =>
                        liveTargetMatches(expectedTarget, candidate),
                    );
                    if (matches.length !== 1) {
                        return staleResult(
                            'broker_target_changed_before_write',
                            expectedTarget,
                        );
                    }
                    let request;
                    try {
                        request = upstreamOperation(
                            currentOperation,
                            expectedTarget,
                        );
                    } catch {
                        return staleResult(
                            'broker_target_operation_invalid_before_write',
                            expectedTarget,
                        );
                    }
                    // This module-issued callback revalidates the shared mode
                    // lease, marker, API generation, /info.simulation and
                    // sender fence after the target refresh and account/order
                    // locks. Failure propagates without invoking the transport;
                    // the dispatch coordinator then settles conservatively.
                    await Reflect.apply(call.beforeWrite, undefined, []);
                    // The refresh and write-adjacent callback are both async.
                    // Re-read the executor-owned clock after them so an
                    // update/cancel that crossed the Asia/Taipei date cannot
                    // reuse yesterday's durable target. Keep this synchronous
                    // check immediately adjacent to the transport invocation.
                    if (
                        taipeiTradeDate(
                            Reflect.apply(input.nowEpochMs, undefined, []),
                        ) !== expectedTarget.tradeDate
                    ) {
                        return staleResult(
                            'broker_target_trade_date_stale_before_write',
                            expectedTarget,
                        );
                    }
                    let response;
                    try {
                        response = await Reflect.apply(
                            transport.write,
                            input.transport,
                            [request],
                        );
                    } catch {
                        return possibleBytesResult(
                            'broker_target_write_result_unknown',
                            expectedTarget,
                        );
                    }
                    try {
                        const [confirmed] =
                            canonicalizeShioajiRefreshedStockTrades([response]);
                        if (!liveTargetMatches(expectedTarget, confirmed)) {
                            return possibleBytesResult(
                                'broker_target_response_mismatch_unknown',
                                expectedTarget,
                            );
                        }
                    } catch {
                        return possibleBytesResult(
                            'broker_target_response_invalid_unknown',
                            expectedTarget,
                        );
                    }
                    return Object.freeze({
                        schemaVersion:
                            SMART_ORDER_NODE_SAFE_BROKER_TARGET_SCHEMA_VERSION,
                        state: 'reconciling',
                        terminalOutcome:
                            'broker_target_write_requires_reconciliation',
                        targetRevision: expectedTarget.targetRevision,
                        brokerBytesPossible: true,
                        brokerWriteAttempted: true,
                        automaticRetryAllowed: false,
                        brokerAuthority: false,
                    });
                }),
            );
        },
    });
}
