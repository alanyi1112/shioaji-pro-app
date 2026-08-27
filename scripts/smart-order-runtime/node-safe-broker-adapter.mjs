import { types as utilTypes } from 'node:util';
import {
    acquireSmartOrderBrokerDispatchTransportOperation,
    createFencedSmartOrderBrokerAdapter,
    createGateClosedSmartOrderBrokerAdapter,
    revalidateSmartOrderBrokerDispatchAuthorityImmediatelyBeforeWrite,
} from './broker-dispatch-coordinator.mjs';
import { isIssuedCurrentSmartOrderBrokerContractCapability } from './broker-contract-verifier-authority.mjs';
import { createSmartOrderModeWriteAdmission } from './mode-write-admission.mjs';
import {
    createNodeSafeBrokerTargetExecutor,
    withNodeSafeBrokerAccountLock,
} from './node-safe-broker-target.mjs';
import {
    canonicalProtectedEntryIntentPayload,
    canonicalProtectedEntryPlan,
} from './protected-entry-contract.mjs';
import {
    SMART_ORDER_PROTECTIVE_BROKER_INTENT_SCHEMA_VERSION,
    canonicalSmartOrderProtectiveBrokerIntentPayload,
} from './broker-execution-policy.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';
import {
    smartOrderCommonLotsToShares,
    smartOrderSharesToCommonLots,
} from './canonical-stock-unit-contract.mjs';

export const SMART_ORDER_NODE_SAFE_BROKER_ADAPTER_SCHEMA_VERSION =
    'smart-order-node-safe-broker-adapter/2026-08-20.1';

const BASE_URL = 'http://127.0.0.1:8080';
const MAX_JSON_BYTES = 2 * 1024 * 1024;

function exactCommonOrderShares(commonLots, contractUnit) {
    try {
        return smartOrderCommonLotsToShares(commonLots, contractUnit);
    } catch {
        return null;
    }
}

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

function requestAccount(account) {
    return Object.freeze({
        broker_id: token(account.brokerId, 'account.brokerId', 128),
        account_id: token(account.accountId, 'account.accountId', 128),
        account_type:
            account.accountType === 'S'
                ? 'S'
                : (() => {
                      throw new TypeError('account.accountType must be S');
                  })(),
    });
}

async function readBoundedJson(response, requestUrl, { allowEmpty = false } = {}) {
    if (
        !response ||
        response.url !== requestUrl ||
        response.redirected === true ||
        !response.ok
    ) {
        throw new Error('Shioaji broker response identity/status is invalid');
    }
    if (
        allowEmpty &&
        (response.status === 204 ||
            response.headers?.get?.('content-length') === '0')
    ) {
        return null;
    }
    const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
    if (contentType !== 'application/json') {
        throw new Error('Shioaji broker response content type is invalid');
    }
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
        throw new Error('Shioaji broker response is too large');
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
        throw new Error('Shioaji broker response is too large');
    }
    return JSON.parse(text);
}

async function nativeJsonRequest(
    pathname,
    { body, allowEmpty = false },
    acquireResourceTransportOperation,
) {
    const requestUrl = `${BASE_URL}${pathname}`;
    await acquireResourceTransportOperation();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await globalThis.fetch(requestUrl, {
            method: 'POST',
            headers: Object.freeze({
                accept: 'application/json',
                'content-type': 'application/json',
            }),
            body: JSON.stringify(body),
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
        });
        return await readBoundedJson(response, requestUrl, { allowEmpty });
    } finally {
        clearTimeout(timer);
    }
}

function nativeTargetTransport(acquireResourceTransportOperation) {
    return Object.freeze({
        async refreshFixedAccountTrades(account) {
            const body = requestAccount(account);
            // Shioaji server v1.7.1 exposes the account-scoped trades route as
            // the update-status operation followed by a cache read. There is
            // no standalone HTTP /order/update_status route.
            const trades = await nativeJsonRequest('/api/v1/order/trades', {
                body,
            }, acquireResourceTransportOperation);
            if (!Array.isArray(trades)) {
                throw new TypeError('fixed-account trades response must be an array');
            }
            return trades;
        },
        async write(request) {
            const current = snapshot(
                request,
                ['body', 'path'],
                [],
                'broker transport write request',
            );
            if (
                ![
                    '/api/v1/order/place_order',
                    '/api/v1/order/update_price',
                    '/api/v1/order/update_qty',
                    '/api/v1/order/cancel_order',
                ].includes(current.path)
            ) {
                throw new TypeError('broker transport write path is not allowlisted');
            }
            return nativeJsonRequest(
                current.path,
                { body: current.body },
                acquireResourceTransportOperation,
            );
        },
    });
}

function stockContractFromKey(contractKey) {
    const parts = token(contractKey, 'envelope.contractKey').split(':');
    if (
        parts.length !== 4 ||
        !['TSE', 'OTC'].includes(parts[0]) ||
        !/^[A-Z0-9]+$/.test(parts[1]) ||
        parts[2] !== 'STK' ||
        parts[3] !== 'Common'
    ) {
        throw new Error('place contract is outside the supported stock scope');
    }
    return Object.freeze({
        exchange: parts[0],
        code: parts[1],
        region: 'TW',
        security_type: 'STK',
        target_code: null,
    });
}

export function canonicalProtectedEntryPlaceRequest(input) {
    const current = snapshot(
        input,
        ['accountBrokerRef', 'accountIdRef', 'contractKey', 'payload', 'side'],
        [],
        'protected entry place request input',
    );
    const canonicalIntent = canonicalProtectedEntryIntentPayload(
        current.payload,
    );
    const canonicalPlan = canonicalProtectedEntryPlan(
        canonicalIntent.payload.protectionPlan,
    );
    const plan = canonicalPlan.plan;
    const order = plan.entryOrder;
    if (
        current.side !== 'Buy' ||
        current.accountBrokerRef !== plan.accountBrokerRef ||
        current.accountIdRef !== plan.accountIdRef ||
        current.contractKey !== plan.contractKey ||
        order.orderCond !== 'Cash' ||
        order.orderLot !== 'Common'
    ) {
        throw new Error('protected entry place envelope scope is inconsistent');
    }
    const fixedAccount = Object.freeze({
        brokerId: token(current.accountBrokerRef, 'accountBrokerRef', 128),
        accountId: token(current.accountIdRef, 'accountIdRef', 128),
        accountType: 'S',
    });
    const request = Object.freeze({
        path: '/api/v1/order/place_order',
        body: Object.freeze({
            contract: stockContractFromKey(current.contractKey),
            stock_order: Object.freeze({
                account: requestAccount(fixedAccount),
                action: 'Buy',
                order_cond: 'Cash',
                order_lot: 'Common',
                order_type: order.timeInForce,
                price:
                    order.limitPrice === null
                        ? 0
                        : Number(order.limitPrice),
                price_type: order.priceType,
                quantity: order.commonLots,
            }),
        }),
    });
    return Object.freeze({
        brokerAuthority: false,
        contractKey: current.contractKey,
        contractUnit: order.contractUnit,
        expectedShares: order.baseShares,
        fixedAccount,
        request,
    });
}

const GOOD_TILL_INTENT_SCHEMA_VERSION =
    'smart-order-good-till-intent/2026-08-21.1';
const PARENT_CHILD_INTENT_SCHEMA_VERSION =
    'smart-order-parent-child-intent/2026-08-21.1';

export function canonicalGoodTillPlaceRequest(input) {
    const current = snapshot(
        input,
        ['accountBrokerRef', 'accountIdRef', 'contractKey', 'payload', 'side'],
        [],
        'good-till place request input',
    );
    const payload = snapshot(
        current.payload,
        [
            'activationTradeDate',
            'conditionEvidenceHash',
            'confirmationSnapshotHash',
            'order',
            'progress',
            'schemaVersion',
            'strategyId',
        ],
        [],
        'good-till intent payload',
    );
    const order = snapshot(
        payload.order,
        [
            'baseShares',
            'commonLots',
            'contractKey',
            'contractUnit',
            'limitPrice',
            'orderCond',
            'orderLot',
            'policyRevision',
            'priceType',
            'side',
            'timeInForce',
        ],
        [],
        'good-till intent order',
    );
    const progress = snapshot(
        payload.progress,
        [
            'confirmedFilledSharesBefore',
            'remainingTargetSharesAfter',
            'targetShares',
        ],
        [],
        'good-till intent progress',
    );
    const limitPrice = Number(order.limitPrice);
    if (
        payload.schemaVersion !== GOOD_TILL_INTENT_SCHEMA_VERSION ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.activationTradeDate) ||
        !/^sha256:[a-f0-9]{64}$/.test(payload.conditionEvidenceHash) ||
        !/^sha256:[a-f0-9]{64}$/.test(payload.confirmationSnapshotHash) ||
        typeof payload.strategyId !== 'string' ||
        payload.strategyId.length < 1 ||
        current.side !== 'Buy' ||
        order.side !== 'Buy' ||
        order.orderCond !== 'Cash' ||
        order.orderLot !== 'Common' ||
        order.priceType !== 'LMT' ||
        !['ROD', 'IOC'].includes(order.timeInForce) ||
        current.contractKey !== order.contractKey ||
        !Number.isSafeInteger(order.baseShares) ||
        !Number.isSafeInteger(order.commonLots) ||
        !Number.isSafeInteger(order.contractUnit) ||
        order.baseShares < 1 ||
        order.commonLots < 1 ||
        order.contractUnit < 1 ||
        order.baseShares !==
            exactCommonOrderShares(order.commonLots, order.contractUnit) ||
        typeof order.policyRevision !== 'string' ||
        order.policyRevision.length < 1 ||
        typeof order.limitPrice !== 'string' ||
        !Number.isFinite(limitPrice) ||
        limitPrice <= 0 ||
        !Number.isSafeInteger(progress.targetShares) ||
        !Number.isSafeInteger(progress.confirmedFilledSharesBefore) ||
        !Number.isSafeInteger(progress.remainingTargetSharesAfter) ||
        progress.targetShares < 1 ||
        progress.confirmedFilledSharesBefore < 0 ||
        progress.remainingTargetSharesAfter < 0 ||
        progress.confirmedFilledSharesBefore +
            order.baseShares +
            progress.remainingTargetSharesAfter !==
            progress.targetShares
    ) {
        throw new Error('good-till place envelope is inconsistent');
    }
    const fixedAccount = Object.freeze({
        brokerId: token(current.accountBrokerRef, 'accountBrokerRef', 128),
        accountId: token(current.accountIdRef, 'accountIdRef', 128),
        accountType: 'S',
    });
    return Object.freeze({
        brokerAuthority: false,
        contractKey: current.contractKey,
        contractUnit: order.contractUnit,
        expectedShares: order.baseShares,
        fixedAccount,
        request: Object.freeze({
            path: '/api/v1/order/place_order',
            body: Object.freeze({
                contract: stockContractFromKey(current.contractKey),
                stock_order: Object.freeze({
                    account: requestAccount(fixedAccount),
                    action: 'Buy',
                    order_cond: 'Cash',
                    order_lot: 'Common',
                    order_type: order.timeInForce,
                    price: limitPrice,
                    price_type: 'LMT',
                    quantity: order.commonLots,
                }),
            }),
        }),
        automaticRetryAllowed: false,
    });
}

export function canonicalParentChildPlaceRequest(input) {
    const current = snapshot(
        input,
        ['accountBrokerRef', 'accountIdRef', 'contractKey', 'payload', 'side'],
        [],
        'parent-child place request input',
    );
    const payload = snapshot(
        current.payload,
        [
            'activationTradeDate',
            'childPositionLineageId',
            'conditionEvidenceHash',
            'confirmationSnapshotHash',
            'leg',
            'order',
            'parentSettlementHash',
            'schemaVersion',
            'strategyId',
        ],
        [],
        'parent-child intent payload',
    );
    const order = snapshot(
        payload.order,
        [
            'baseShares',
            'commonLots',
            'contractKey',
            'contractUnit',
            'limitPrice',
            'orderCond',
            'orderLot',
            'policyRevision',
            'priceType',
            'side',
            'timeInForce',
        ],
        [],
        'parent-child intent order',
    );
    const limitPrice = Number(order.limitPrice);
    if (
        payload.schemaVersion !== PARENT_CHILD_INTENT_SCHEMA_VERSION ||
        !['parent', 'child'].includes(payload.leg) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.activationTradeDate) ||
        !/^sha256:[a-f0-9]{64}$/.test(payload.conditionEvidenceHash) ||
        !/^sha256:[a-f0-9]{64}$/.test(payload.confirmationSnapshotHash) ||
        typeof payload.strategyId !== 'string' ||
        payload.strategyId.length < 1 ||
        current.side !== order.side ||
        (payload.leg === 'parent' && order.side !== 'Buy') ||
        (payload.leg === 'child' && order.side !== 'Sell') ||
        (payload.leg === 'parent' &&
            (payload.parentSettlementHash !== null ||
                payload.childPositionLineageId !== null)) ||
        (payload.leg === 'child' &&
            (!/^sha256:[a-f0-9]{64}$/.test(payload.parentSettlementHash) ||
                typeof payload.childPositionLineageId !== 'string' ||
                payload.childPositionLineageId.length < 1)) ||
        order.orderCond !== 'Cash' ||
        order.orderLot !== 'Common' ||
        order.priceType !== 'LMT' ||
        !['ROD', 'IOC'].includes(order.timeInForce) ||
        current.contractKey !== order.contractKey ||
        !Number.isSafeInteger(order.baseShares) ||
        !Number.isSafeInteger(order.commonLots) ||
        !Number.isSafeInteger(order.contractUnit) ||
        order.baseShares < 1 ||
        order.commonLots < 1 ||
        order.contractUnit < 1 ||
        order.baseShares !==
            exactCommonOrderShares(order.commonLots, order.contractUnit) ||
        typeof order.policyRevision !== 'string' ||
        order.policyRevision.length < 1 ||
        typeof order.limitPrice !== 'string' ||
        !Number.isFinite(limitPrice) ||
        limitPrice <= 0
    ) {
        throw new Error('parent-child place envelope is inconsistent');
    }
    const fixedAccount = Object.freeze({
        brokerId: token(current.accountBrokerRef, 'accountBrokerRef', 128),
        accountId: token(current.accountIdRef, 'accountIdRef', 128),
        accountType: 'S',
    });
    return Object.freeze({
        brokerAuthority: false,
        contractKey: current.contractKey,
        contractUnit: order.contractUnit,
        expectedShares: order.baseShares,
        expectedSide: order.side,
        fixedAccount,
        request: Object.freeze({
            path: '/api/v1/order/place_order',
            body: Object.freeze({
                contract: stockContractFromKey(current.contractKey),
                stock_order: Object.freeze({
                    account: requestAccount(fixedAccount),
                    action: order.side,
                    order_cond: 'Cash',
                    order_lot: 'Common',
                    order_type: order.timeInForce,
                    price: limitPrice,
                    price_type: 'LMT',
                    quantity: order.commonLots,
                }),
            }),
        }),
        automaticRetryAllowed: false,
    });
}

export function canonicalProtectiveExitPlaceRequest(input) {
    const current = snapshot(
        input,
        ['accountBrokerRef', 'accountIdRef', 'contractKey', 'payload', 'side'],
        [],
        'protective exit place request input',
    );
    const canonicalIntent =
        canonicalSmartOrderProtectiveBrokerIntentPayload(current.payload);
    const payload = canonicalIntent.payload;
    let commonLots;
    try {
        commonLots = smartOrderSharesToCommonLots(
            payload.quantityShares,
            payload.contractUnit,
        );
    } catch {
        commonLots = null;
    }
    if (current.side !== 'Sell' || commonLots === null || commonLots < 1) {
        throw new Error(
            'protective exit place envelope scope or CommonLot quantity is invalid',
        );
    }
    const fixedAccount = Object.freeze({
        brokerId: token(current.accountBrokerRef, 'accountBrokerRef', 128),
        accountId: token(current.accountIdRef, 'accountIdRef', 128),
        accountType: 'S',
    });
    return Object.freeze({
        brokerAuthority: false,
        contractKey: current.contractKey,
        contractUnit: payload.contractUnit,
        expectedShares: payload.quantityShares,
        fixedAccount,
        request: Object.freeze({
            path: '/api/v1/order/place_order',
            body: Object.freeze({
                contract: stockContractFromKey(current.contractKey),
                stock_order: Object.freeze({
                    account: requestAccount(fixedAccount),
                    action: 'Sell',
                    order_cond: 'Cash',
                    order_lot: 'Common',
                    order_type: payload.execution.timeInForce,
                    price:
                        payload.execution.limitPrice === null
                            ? 0
                            : Number(payload.execution.limitPrice),
                    price_type: payload.execution.priceType,
                    quantity: commonLots,
                }),
            }),
        }),
        automaticRetryAllowed: false,
        iocRemainderDisposition: payload.iocRemainderDisposition,
    });
}

async function executeProtectedEntryPlace(envelope, transport, beforeWrite) {
    const projection = canonicalProtectedEntryPlaceRequest({
        accountBrokerRef: envelope.accountBrokerRef,
        accountIdRef: envelope.accountIdRef,
        contractKey: envelope.contractKey,
        payload: envelope.payload,
        side: envelope.side,
    });
    const {
        contractKey,
        contractUnit,
        expectedShares,
        fixedAccount,
        request,
    } = projection;
    return withNodeSafeBrokerAccountLock(fixedAccount, async () => {
        await beforeWrite();
        let response;
        try {
            response = await Reflect.apply(transport.write, transport, [request]);
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'broker_place_write_result_unknown',
            });
        }
        try {
            const [trade] = canonicalizeShioajiRefreshedStockTrades([response]);
            const responseShares =
                trade.unit === 'Share'
                    ? trade.orderQuantity
                    : trade.orderQuantity * contractUnit;
            if (
                trade.account.brokerId !== fixedAccount.brokerId ||
                trade.account.accountId !== fixedAccount.accountId ||
                trade.account.accountType !== 'S' ||
                trade.contractKey !== contractKey ||
                trade.action !== 'Buy' ||
                responseShares !== expectedShares
            ) {
                throw new Error('place response scope mismatch');
            }
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'broker_place_response_invalid_unknown',
            });
        }
        return Object.freeze({
            state: 'reconciling',
            terminalOutcome: 'broker_place_write_requires_reconciliation',
        });
    });
}

async function executeGoodTillPlace(envelope, transport, beforeWrite) {
    const projection = canonicalGoodTillPlaceRequest({
        accountBrokerRef: envelope.accountBrokerRef,
        accountIdRef: envelope.accountIdRef,
        contractKey: envelope.contractKey,
        payload: envelope.payload,
        side: envelope.side,
    });
    const { contractKey, contractUnit, expectedShares, fixedAccount, request } =
        projection;
    return withNodeSafeBrokerAccountLock(fixedAccount, async () => {
        await beforeWrite();
        let response;
        try {
            response = await Reflect.apply(transport.write, transport, [request]);
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'good_till_place_write_result_unknown',
                automaticRetryAllowed: false,
            });
        }
        try {
            const [trade] = canonicalizeShioajiRefreshedStockTrades([response]);
            const responseShares =
                trade.unit === 'Share'
                    ? trade.orderQuantity
                    : trade.orderQuantity * contractUnit;
            if (
                trade.account.brokerId !== fixedAccount.brokerId ||
                trade.account.accountId !== fixedAccount.accountId ||
                trade.account.accountType !== 'S' ||
                trade.contractKey !== contractKey ||
                trade.action !== 'Buy' ||
                responseShares !== expectedShares
            ) {
                throw new Error('good-till place response scope mismatch');
            }
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'good_till_place_response_invalid_unknown',
                automaticRetryAllowed: false,
            });
        }
        return Object.freeze({
            state: 'reconciling',
            terminalOutcome: 'good_till_place_requires_reconciliation',
            automaticRetryAllowed: false,
        });
    });
}

async function executeParentChildPlace(envelope, transport, beforeWrite) {
    const projection = canonicalParentChildPlaceRequest({
        accountBrokerRef: envelope.accountBrokerRef,
        accountIdRef: envelope.accountIdRef,
        contractKey: envelope.contractKey,
        payload: envelope.payload,
        side: envelope.side,
    });
    const {
        contractKey,
        contractUnit,
        expectedShares,
        expectedSide,
        fixedAccount,
        request,
    } = projection;
    return withNodeSafeBrokerAccountLock(fixedAccount, async () => {
        await beforeWrite();
        let response;
        try {
            response = await Reflect.apply(transport.write, transport, [request]);
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'parent_child_place_write_result_unknown',
                automaticRetryAllowed: false,
            });
        }
        try {
            const [trade] = canonicalizeShioajiRefreshedStockTrades([response]);
            const responseShares =
                trade.unit === 'Share'
                    ? trade.orderQuantity
                    : trade.orderQuantity * contractUnit;
            if (
                trade.account.brokerId !== fixedAccount.brokerId ||
                trade.account.accountId !== fixedAccount.accountId ||
                trade.account.accountType !== 'S' ||
                trade.contractKey !== contractKey ||
                trade.action !== expectedSide ||
                responseShares !== expectedShares
            ) {
                throw new Error('parent-child place response scope mismatch');
            }
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'parent_child_place_response_invalid_unknown',
                automaticRetryAllowed: false,
            });
        }
        return Object.freeze({
            state: 'reconciling',
            terminalOutcome: 'parent_child_place_requires_reconciliation',
            automaticRetryAllowed: false,
        });
    });
}

async function executeProtectiveExitPlace(envelope, transport, beforeWrite) {
    const projection = canonicalProtectiveExitPlaceRequest({
        accountBrokerRef: envelope.accountBrokerRef,
        accountIdRef: envelope.accountIdRef,
        contractKey: envelope.contractKey,
        payload: envelope.payload,
        side: envelope.side,
    });
    const {
        contractKey,
        contractUnit,
        expectedShares,
        fixedAccount,
        request,
    } = projection;
    return withNodeSafeBrokerAccountLock(fixedAccount, async () => {
        await beforeWrite();
        let response;
        try {
            response = await Reflect.apply(transport.write, transport, [request]);
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'broker_place_write_result_unknown',
                automaticRetryAllowed: false,
            });
        }
        try {
            const [trade] = canonicalizeShioajiRefreshedStockTrades([response]);
            const responseShares =
                trade.unit === 'Share'
                    ? trade.orderQuantity
                    : trade.orderQuantity * contractUnit;
            if (
                trade.account.brokerId !== fixedAccount.brokerId ||
                trade.account.accountId !== fixedAccount.accountId ||
                trade.account.accountType !== 'S' ||
                trade.contractKey !== contractKey ||
                trade.action !== 'Sell' ||
                responseShares !== expectedShares
            ) {
                throw new Error('protective exit response scope mismatch');
            }
        } catch {
            return Object.freeze({
                state: 'unknown',
                terminalOutcome: 'broker_place_response_invalid_unknown',
                automaticRetryAllowed: false,
            });
        }
        return Object.freeze({
            state: 'reconciling',
            terminalOutcome: 'broker_place_write_requires_reconciliation',
            automaticRetryAllowed: false,
        });
    });
}

function targetOperationFromEnvelope(envelope) {
    if (!envelope.adapterTarget) {
        throw new Error('update/cancel dispatch is missing its durable adapter target');
    }
    if (envelope.operationKind === 'cancel') {
        return Object.freeze({ kind: 'cancel' });
    }
    const payload = snapshot(
        envelope.payload,
        ['schemaVersion'],
        ['price', 'quantityShares'],
        'broker update payload',
    );
    if (
        payload.schemaVersion ===
        'smart-order-broker-update-price-intent/2026-08-20.1'
    ) {
        return Object.freeze({ kind: 'update_price', price: payload.price });
    }
    if (
        payload.schemaVersion ===
        'smart-order-broker-update-quantity-intent/2026-08-20.1'
    ) {
        return Object.freeze({
            kind: 'update_quantity',
            quantityShares: payload.quantityShares,
        });
    }
    throw new Error('broker update intent payload is unsupported');
}

export function createProductionNodeSafeSmartOrderBrokerAdapter(options) {
    const input = snapshot(
        options,
        [
            'appSupportRoot',
            'expectedApiGeneration',
            'leaseDirectory',
            'resourceCoordinator',
        ],
        ['contractCapability'],
        'Node-safe broker adapter options',
    );
    if (
        !isIssuedCurrentSmartOrderBrokerContractCapability(
            input.contractCapability,
        )
    ) {
        return createGateClosedSmartOrderBrokerAdapter({
            schemaVersion: SMART_ORDER_NODE_SAFE_BROKER_ADAPTER_SCHEMA_VERSION,
            reason: 'Gate 0 broker contract capability is unavailable',
        });
    }
    const modeAdmission = createSmartOrderModeWriteAdmission({
        appSupportRoot: input.appSupportRoot,
        expectedApiGeneration: token(
            input.expectedApiGeneration,
            'expectedApiGeneration',
        ),
        leaseDirectory: input.leaseDirectory,
        resourceCoordinator: input.resourceCoordinator,
    });
    return createFencedSmartOrderBrokerAdapter({
        modeAdmission,
        async execute(authority) {
            const acquireResourceTransportOperation = () =>
                acquireSmartOrderBrokerDispatchTransportOperation(authority);
            const transport = nativeTargetTransport(
                acquireResourceTransportOperation,
            );
            const targetExecutor = createNodeSafeBrokerTargetExecutor({
                nowEpochMs: () => Date.now(),
                transport,
            });
            const envelope = authority.envelope;
            const beforeWrite = () =>
                revalidateSmartOrderBrokerDispatchAuthorityImmediatelyBeforeWrite(
                    authority,
                );
            if (envelope.operationKind === 'place') {
                if (
                    envelope.payload?.schemaVersion ===
                    SMART_ORDER_PROTECTIVE_BROKER_INTENT_SCHEMA_VERSION
                ) {
                    return executeProtectiveExitPlace(
                        envelope,
                        transport,
                        beforeWrite,
                    );
                }
                if (
                    envelope.payload?.schemaVersion ===
                    GOOD_TILL_INTENT_SCHEMA_VERSION
                ) {
                    return executeGoodTillPlace(
                        envelope,
                        transport,
                        beforeWrite,
                    );
                }
                if (
                    envelope.payload?.schemaVersion ===
                    PARENT_CHILD_INTENT_SCHEMA_VERSION
                ) {
                    return executeParentChildPlace(
                        envelope,
                        transport,
                        beforeWrite,
                    );
                }
                return executeProtectedEntryPlace(envelope, transport, beforeWrite);
            }
            if (!['update', 'cancel'].includes(envelope.operationKind)) {
                throw new Error('Node-safe broker operation is unsupported');
            }
            const result = await targetExecutor.execute({
                beforeWrite,
                operation: targetOperationFromEnvelope(envelope),
                target: envelope.adapterTarget,
            });
            return Object.freeze({
                state: result.state,
                terminalOutcome: result.terminalOutcome,
            });
        },
    });
}
