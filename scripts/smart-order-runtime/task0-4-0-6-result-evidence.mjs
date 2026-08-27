import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';
import {
    SMART_ORDER_TASK_0_4_0_6_PROFILES,
    smartOrderTask0406CustomField,
} from './task0-4-0-6-operation-contract.mjs';

export const SMART_ORDER_TASK_0_4_0_6_RESULT_EVIDENCE_SCHEMA_VERSION =
    'smart-order-task-0.4-0.6-result-evidence/2026-08-26.4';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAIPEI_DATE = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function token(value, label, maximum = 160) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function object(value, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be a non-Proxy object`);
    }
    return value;
}

function optionalToken(value, label, maximum = 160) {
    if (value === undefined || value === null || value === '') return null;
    return token(value, label, maximum);
}

function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(`${label} must be a positive safe integer`);
    }
    return value;
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

function resultFailure(code, message, ErrorType = Error) {
    const error = new ErrorType(message);
    error.task0406ResultReason = code;
    return error;
}

export function smartOrderTask0406ResultFailureReason(error) {
    if (typeof error?.task0406ResultReason === 'string') {
        return error.task0406ResultReason;
    }
    const message = String(error?.message ?? '');
    if (message.includes('observer')) return 'observer_not_current';
    if (message.includes('reconciliation')) return 'readonly_reconciliation_failed';
    if (message.includes('generation')) return 'runtime_generation_drift';
    if (message.includes('source fingerprint')) return 'source_fingerprint_drift';
    return 'result_verification_failed';
}

function sameAccount(trade, account) {
    return (
        trade.account.brokerId === account.broker_id &&
        trade.account.accountId === account.account_id &&
        trade.account.accountType === 'S'
    );
}

function epochMilliseconds(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${label} is invalid`);
    }
    const result =
        value > 1e14
            ? Math.trunc(value / 1e6)
            : value > 1e11
              ? Math.trunc(value)
              : Math.trunc(value * 1_000);
    if (!Number.isSafeInteger(result) || result < 1) {
        throw new TypeError(`${label} is outside the supported range`);
    }
    return result;
}

function tradeDate(epochMs) {
    return TAIPEI_DATE.format(new Date(epochMs));
}

function accountFromEvent(value) {
    const account = object(value, 'order event account');
    if (
        account.account_type !== 'S' ||
        typeof account.broker_id !== 'string' ||
        typeof account.account_id !== 'string'
    ) {
        throw new TypeError('order event account is invalid');
    }
    return account;
}

function projectEvent(payload) {
    const event = object(payload, 'broker event');
    const data = object(event.data, 'broker event.data');
    if (event.state === 'StockOrder') {
        const body = object(data.StockOrder, 'StockOrder');
        const order = object(body.order, 'StockOrder.order');
        const status = object(body.status, 'StockOrder.status');
        const contract = object(body.contract, 'StockOrder.contract');
        const exchangeEpochMs = epochMilliseconds(
            status.exchange_ts,
            'StockOrder.status.exchange_ts',
        );
        return Object.freeze({
            kind: 'order',
            account: accountFromEvent(order.account),
            tradeId: token(order.id, 'StockOrder.order.id'),
            seqno: token(order.seqno, 'StockOrder.order.seqno'),
            code: token(contract.code, 'StockOrder.contract.code', 32),
            customField:
                order.custom_field === undefined || order.custom_field === null
                    ? null
                    : token(order.custom_field, 'StockOrder.order.custom_field', 6),
            tradeDate: tradeDate(exchangeEpochMs),
            exchangeEpochMs,
        });
    }
    if (event.state === 'StockDeal') {
        const body = object(data.StockDeal, 'StockDeal');
        const exchangeEpochMs = epochMilliseconds(body.ts, 'StockDeal.ts');
        if (!Number.isSafeInteger(body.quantity) || body.quantity < 1) {
            throw new TypeError('StockDeal.quantity is invalid');
        }
        return Object.freeze({
            kind: 'deal',
            accountId: token(body.account_id, 'StockDeal.account_id', 128),
            brokerId: token(body.broker_id, 'StockDeal.broker_id', 128),
            tradeId: token(body.trade_id, 'StockDeal.trade_id'),
            seqno: token(body.seqno, 'StockDeal.seqno'),
            ordno: token(body.ordno, 'StockDeal.ordno'),
            exchangeSequence: token(
                body.exchange_seq,
                'StockDeal.exchange_seq',
            ),
            code: token(body.code, 'StockDeal.code', 32),
            action: token(body.action, 'StockDeal.action', 16),
            customField: token(
                body.custom_field,
                'StockDeal.custom_field',
                6,
            ),
            orderCondition: token(
                body.order_cond,
                'StockDeal.order_cond',
                32,
            ),
            orderLot: token(body.order_lot, 'StockDeal.order_lot', 32),
            quantityCommonLots: body.quantity,
            tradeDate: tradeDate(exchangeEpochMs),
            exchangeEpochMs,
        });
    }
    return null;
}

function exactTrade({
    account,
    contractKey,
    customField,
    expectedPrice,
    policy,
    trades,
}) {
    const matches = trades.filter(
        (trade) =>
            sameAccount(trade, account) &&
            trade.contractKey === contractKey &&
            trade.action === policy.side &&
            trade.orderCondition === 'Cash' &&
            trade.orderLot === 'Common' &&
            trade.unit === 'CommonLot' &&
            trade.orderQuantity === 1 &&
            trade.customField === customField &&
            trade.priceType === policy.priceType &&
            trade.timeInForce === policy.timeInForce &&
            (policy.priceType === 'MKT' ? trade.price === '0' : trade.price === expectedPrice),
    );
    if (matches.length !== 1) {
        throw resultFailure(
            'refreshed_trade_non_unique',
            'Task 0.4/0.6 correlation is non-unique',
        );
    }
    return matches[0];
}

export function projectSmartOrderTask0406PlaceResponse({
    account,
    marketPlan,
    placeResponse,
    profile,
    runId,
}) {
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    if (!policy || !UUID.test(runId ?? '')) {
        throw resultFailure(
            'place_response_invalid',
            'Task 0.4/0.6 place response scope is invalid',
            TypeError,
        );
    }
    try {
        const response = object(placeResponse, 'place response');
        const contract = object(response.contract, 'place response.contract');
        const order = object(response.order, 'place response.order');
        const status = object(response.status, 'place response.status');
        const responseAccount = object(order.account, 'place response.order.account');
        const [expectedExchange, expectedCode] = marketPlan.contractKey.split(':');
        const price = canonicalDecimal(order.price, 'place response.order.price');
        const expectedPrice = policy.priceType === 'MKT' ? '0' : marketPlan.price;
        const customField = smartOrderTask0406CustomField({ profile, runId });
        if (
            responseAccount.broker_id !== account.broker_id ||
            responseAccount.account_id !== account.account_id ||
            responseAccount.account_type !== 'S' ||
            contract.exchange !== expectedExchange ||
            contract.code !== expectedCode ||
            contract.security_type !== 'STK' ||
            order.action !== policy.side ||
            order.order_cond !== 'Cash' ||
            order.order_lot !== 'Common' ||
            order.price_type !== policy.priceType ||
            order.order_type !== policy.timeInForce ||
            positiveInteger(order.quantity, 'place response.order.quantity') !== 1 ||
            price !== expectedPrice ||
            order.custom_field !== customField
        ) {
            throw resultFailure(
                'place_response_payload_mismatch',
                'Task 0.4/0.6 place response payload is not exact',
            );
        }
        return Object.freeze({
            customField,
            orderId: optionalToken(status.id, 'place response.status.id'),
            ordno: optionalToken(order.ordno, 'place response.order.ordno'),
            seqno: token(order.seqno, 'place response.order.seqno'),
            tradeId: token(order.id, 'place response.order.id'),
        });
    } catch (error) {
        if (error?.task0406ResultReason) throw error;
        throw resultFailure(
            'place_response_invalid',
            'Task 0.4/0.6 place response is invalid',
            TypeError,
        );
    }
}

export function createSmartOrderTask0406ResultEvidence({
    account,
    apiGenerationSha256,
    marketPlan,
    observedEvents,
    placeResponse,
    profile,
    refreshedTrades,
    requestSha256,
    runId,
}) {
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    if (
        !policy ||
        !UUID.test(runId ?? '') ||
        marketPlan?.runId !== runId.toLowerCase() ||
        marketPlan?.taskId !== policy.taskId ||
        marketPlan?.purpose !== policy.purpose ||
        marketPlan?.priceType !== policy.priceType ||
        marketPlan?.timeInForce !== policy.timeInForce ||
        !/^sha256:[0-9a-f]{64}$/.test(apiGenerationSha256 ?? '') ||
        !/^sha256:[0-9a-f]{64}$/.test(requestSha256 ?? '') ||
        !Array.isArray(observedEvents)
    ) {
        throw resultFailure(
            'result_input_invalid',
            'Task 0.4/0.6 result input is invalid',
            TypeError,
        );
    }
    const customField = smartOrderTask0406CustomField({ profile, runId });
    const refreshed = canonicalizeShioajiRefreshedStockTrades(refreshedTrades);
    const response = projectSmartOrderTask0406PlaceResponse({
        account,
        marketPlan,
        placeResponse,
        profile,
        runId,
    });
    const trade = exactTrade({
        account,
        contractKey: marketPlan.contractKey,
        customField,
        expectedPrice: marketPlan.price,
        policy,
        trades: refreshed,
    });
    if (
        response.tradeId !== trade.tradeId ||
        response.seqno !== trade.seqno ||
        response.customField !== trade.customField
    ) {
        throw resultFailure(
            'place_response_stable_lineage_mismatch',
            'Task 0.4/0.6 place response stable lineage is not exact',
        );
    }
    if (
        (response.orderId !== null && response.orderId !== trade.orderId) ||
        (response.ordno !== null && response.ordno !== trade.ordno)
    ) {
        throw resultFailure(
            'place_response_final_identifier_mismatch',
            'Task 0.4/0.6 place response final identifiers conflict with reconciliation',
        );
    }
    const filledExpected = policy.expectedOutcome === 'filled_with_order_and_deal';
    const zeroFillExpected = policy.expectedOutcome === 'zero_fill_no_deal';
    const workingExpected = policy.expectedOutcome === 'working_no_deal';
    const cancelledZeroFill =
        zeroFillExpected &&
        trade.status === 'Cancelled' &&
        trade.cumulativeDeal === 0 &&
        trade.cumulativeCancel === 1 &&
        trade.remaining === 0;
    const submittedZeroFill =
        zeroFillExpected &&
        trade.status === 'Submitted' &&
        trade.cumulativeDeal === 0 &&
        trade.cumulativeCancel === 0 &&
        trade.remaining === 1;
    if (
        (filledExpected &&
            (trade.status !== 'Filled' ||
                trade.cumulativeDeal !== 1 ||
                trade.cumulativeCancel !== 0 ||
                trade.remaining !== 0)) ||
        (zeroFillExpected && !cancelledZeroFill && !submittedZeroFill) ||
        (workingExpected &&
            (trade.status !== 'Submitted' ||
                trade.cumulativeDeal !== 0 ||
                trade.cumulativeCancel !== 0 ||
                trade.remaining !== 1)) ||
        (!filledExpected && !zeroFillExpected && !workingExpected)
    ) {
        throw resultFailure(
            'broker_outcome_mismatch',
            'Task 0.4/0.6 broker outcome did not match the bounded profile',
        );
    }
    const projections = observedEvents
        .map(projectEvent)
        .filter((event) => event !== null && event.tradeDate === marketPlan.tradeDate);
    const orderEvents = projections.filter(
        (event) =>
            event.kind === 'order' &&
            event.tradeId === trade.tradeId &&
            event.seqno === trade.seqno &&
            event.code === marketPlan.contractKey.split(':')[1] &&
            event.account.broker_id === account.broker_id &&
            event.account.account_id === account.account_id &&
            event.account.account_type === 'S' &&
            (event.customField === null || event.customField === customField),
    );
    const dealEvents = projections.filter(
        (event) =>
            event.kind === 'deal' &&
            event.tradeId === trade.tradeId &&
            event.seqno === trade.seqno &&
            event.ordno === trade.ordno &&
            event.brokerId === account.broker_id &&
            event.accountId === account.account_id &&
            event.code === marketPlan.contractKey.split(':')[1] &&
            event.action === policy.side &&
            event.customField === customField &&
            event.orderCondition === 'Cash' &&
            event.orderLot === 'Common',
    );
    if (orderEvents.length < 1) {
        throw resultFailure(
            'exact_order_event_missing',
            'Task 0.4/0.6 exact order event is missing',
        );
    }
    const orderIdentities = new Set(
        orderEvents.map((event) => canonicalJson([event.tradeId, event.seqno, event.tradeDate])),
    );
    const dealIdentities = new Set(
        dealEvents.map((event) =>
            canonicalJson([
                event.tradeId,
                event.seqno,
                event.ordno,
                event.exchangeSequence,
                event.tradeDate,
            ]),
        ),
    );
    const uniqueDeals = new Map();
    for (const event of dealEvents) {
        const identity = canonicalJson([
            event.tradeId,
            event.seqno,
            event.ordno,
            event.exchangeSequence,
            event.tradeDate,
        ]);
        const previous = uniqueDeals.get(identity);
        if (
            previous !== undefined &&
            previous.quantityCommonLots !== event.quantityCommonLots
        ) {
            throw resultFailure(
                'canonical_event_correlation_invalid',
                'Task 0.4/0.6 duplicate deal event conflicts with its canonical identity',
            );
        }
        uniqueDeals.set(identity, event);
    }
    if (
        orderIdentities.size !== 1 ||
        (filledExpected &&
            (dealIdentities.size < 1 ||
                [...uniqueDeals.values()].reduce(
                    (total, event) => total + event.quantityCommonLots,
                    0,
                ) !== 1)) ||
        (!filledExpected && dealEvents.length !== 0)
    ) {
        throw resultFailure(
            'canonical_event_correlation_invalid',
            'Task 0.4/0.6 canonical event correlation is non-unique',
        );
    }
    const projection = Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_4_0_6_RESULT_EVIDENCE_SCHEMA_VERSION,
        taskId: policy.taskId,
        profile,
        expectedOutcome: policy.expectedOutcome,
        runId: runId.toLowerCase(),
        tradeDate: marketPlan.tradeDate,
        accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
        apiGenerationSha256,
        requestSha256,
        contractKey: marketPlan.contractKey,
        side: marketPlan.side,
        priceType: marketPlan.priceType,
        timeInForce: marketPlan.timeInForce,
        authorizedPrice: marketPlan.price,
        brokerPayloadPrice: marketPlan.priceType === 'MKT' ? 0 : marketPlan.price,
        quantityCommonLots: 1,
        customField,
        observedBrokerStatus: trade.status,
        brokerTerminal: filledExpected || cancelledZeroFill,
        zeroFillConfirmed: zeroFillExpected,
        zeroFillDisposition: !zeroFillExpected
            ? null
            : cancelledZeroFill
              ? 'broker_cancelled_terminal'
              : 'broker_submitted_nonterminal_manual_intervention',
        workingConfirmed: workingExpected,
        cumulativeDealCommonLots: trade.cumulativeDeal,
        cumulativeCancelCommonLots: trade.cumulativeCancel,
        tradeIdSha256: sha256(JSON.stringify(trade.tradeId)),
        orderIdSha256: sha256(JSON.stringify(trade.orderId)),
        seqnoSha256: sha256(JSON.stringify(trade.seqno)),
        ordnoSha256: sha256(JSON.stringify(trade.ordno)),
        exchangeSequenceSha256s: Object.freeze(
            [
                ...new Set(
                    [...uniqueDeals.values()].map((event) =>
                        sha256(JSON.stringify(event.exchangeSequence)),
                    ),
                ),
            ].sort(),
        ),
        orderEventObserved: true,
        dealEventObserved: filledExpected,
        placeResponseMatched: true,
        placeResponseFinalIdentifiersProvisional:
            response.orderId === null || response.ordno === null,
        correlationUnique: true,
        crossDateCollisionRejected: true,
        automaticRetryAllowed: false,
        blindCleanupAllowed: false,
        manualInterventionRequired: submittedZeroFill,
        accountIdentifiersPersisted: false,
        brokerWriteAttempted: true,
        brokerWriteNetworked: true,
        brokerAuthority: false,
    });
    return Object.freeze({
        evidence: projection,
        resultSha256: sha256(canonicalJson(projection)),
    });
}
