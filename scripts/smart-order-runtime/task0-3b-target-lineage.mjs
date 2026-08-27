import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';

export const SMART_ORDER_TASK_0_3B_TARGET_LINEAGE_SCHEMA_VERSION =
    'smart-order-task-0.3b-target-lineage/2026-08-24.1';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const WORKING = new Set(['PendingSubmit', 'PreSubmitted', 'Submitted']);

function exact(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be an exact non-Proxy object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        JSON.stringify([...actual].sort()) !== JSON.stringify([...keys].sort())
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    return Object.freeze(
        Object.fromEntries(
            keys.map((key) => {
                const descriptor = descriptors[key];
                if (
                    descriptor?.enumerable !== true ||
                    !Object.hasOwn(descriptor, 'value') ||
                    Object.hasOwn(descriptor, 'get') ||
                    Object.hasOwn(descriptor, 'set')
                ) {
                    throw new TypeError(`${label}.${key} must be an own data property`);
                }
                return [key, descriptor.value];
            }),
        ),
    );
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalAccount(value) {
    const account = exact(
        value,
        ['account_id', 'account_type', 'broker_id'],
        'Task 0.3b target account',
    );
    if (
        account.account_type !== 'S' ||
        typeof account.account_id !== 'string' ||
        account.account_id.length < 1 ||
        typeof account.broker_id !== 'string' ||
        account.broker_id.length < 1
    ) {
        throw new TypeError('Task 0.3b target account is invalid');
    }
    return account;
}

function matchesScope(trade, scope) {
    return (
        trade.account.brokerId === scope.account.broker_id &&
        trade.account.accountId === scope.account.account_id &&
        trade.account.accountType === 'S' &&
        trade.contractKey === 'TSE:2330:STK:Common' &&
        trade.action === 'Buy' &&
        trade.price === scope.expectedPriceDecimal &&
        trade.priceType === 'LMT' &&
        trade.timeInForce === 'ROD' &&
        trade.orderCondition === 'Cash' &&
        trade.orderLot === 'Common' &&
        trade.orderQuantity === 1 &&
        trade.unit === 'CommonLot' &&
        trade.customField === scope.expectedCustomField &&
        WORKING.has(trade.status) &&
        trade.cumulativeDeal === 0 &&
        trade.cumulativeCancel === 0 &&
        trade.remaining === 1
    );
}

function privateTargetRecord(value) {
    return exact(
        value,
        [
            'accountScopeSha256',
            'contractUnit',
            'customField',
            'orderId',
            'originRunId',
            'ordno',
            'priceMinorUnits',
            'revision',
            'schemaVersion',
            'seqno',
            'status',
            'targetIdSha256',
            'targetRevision',
            'tradeDate',
            'tradeId',
        ],
        'Task 0.3b private target',
    );
}

function sameIdentifiers(trade, target) {
    return (
        trade.tradeId === target.tradeId &&
        trade.orderId === target.orderId &&
        trade.seqno === target.seqno &&
        trade.ordno === target.ordno &&
        trade.customField === target.customField
    );
}

function targetProjection({ account, runId, tradeDate, trade, revision, contractUnit }) {
    const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
    const identifierProjection = Object.freeze({
        accountScopeSha256,
        runId,
        tradeDate,
        contractKey: trade.contractKey,
        action: trade.action,
        tradeId: trade.tradeId,
        orderId: trade.orderId,
        seqno: trade.seqno,
        ordno: trade.ordno,
        customField: trade.customField,
    });
    const targetIdSha256 = sha256(canonicalJson(identifierProjection));
    const targetRevision = sha256(
        canonicalJson({
            targetIdSha256,
            revision,
            price: trade.price,
            quantity: trade.orderQuantity,
            cumulativeDeal: trade.cumulativeDeal,
            cumulativeCancel: trade.cumulativeCancel,
            remaining: trade.remaining,
            status: trade.status,
        }),
    );
    const privateTarget = Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3B_TARGET_LINEAGE_SCHEMA_VERSION,
        originRunId: runId,
        targetIdSha256,
        targetRevision,
        accountScopeSha256,
        tradeDate,
        revision,
        priceMinorUnits: Math.round(Number(trade.price) * 100),
        tradeId: trade.tradeId,
        orderId: trade.orderId,
        seqno: trade.seqno,
        ordno: trade.ordno,
        customField: trade.customField,
        contractUnit,
        status: trade.status,
    });
    return Object.freeze({
        privateTarget,
        marketPlanTarget: Object.freeze({
            originRunId: runId,
            targetIdSha256,
            accountScopeSha256,
            tradeDate,
            priceMinorUnits: privateTarget.priceMinorUnits,
            revision,
        }),
        nodeSafeTarget: Object.freeze({
            account: Object.freeze({
                brokerId: account.broker_id,
                accountId: account.account_id,
                accountType: 'S',
            }),
            brokerOrderId: trade.orderId,
            brokerOrderRevision: revision,
            contractKey: trade.contractKey,
            contractUnit,
            controlRevision: revision,
            evidenceSha256: targetRevision,
            filledShares: 0,
            identifiers: Object.freeze({
                tradeId: trade.tradeId,
                orderId: trade.orderId,
                seqno: trade.seqno,
                ordno: trade.ordno,
                exchangeSequence: null,
                customField: trade.customField,
            }),
            orderCondition: trade.orderCondition,
            orderLot: trade.orderLot,
            priceDecimal: trade.price,
            priceType: trade.priceType,
            quantityShares: contractUnit,
            quantityUnit: 'CommonLot',
            remainingShares: contractUnit,
            side: 'Buy',
            state:
                trade.status === 'PendingSubmit'
                    ? 'pending_submit'
                    : trade.status === 'PreSubmitted'
                      ? 'pre_submitted'
                      : 'submitted',
            targetRevision,
            timeInForce: trade.timeInForce,
            tradeDate,
        }),
        publicTarget: Object.freeze({
            targetRef: `…${targetIdSha256.slice(-12)}`,
            targetRevision,
            revision,
            tradeDate,
            accountRef: `…${accountScopeSha256.slice(-12)}`,
            brokerAuthority: false,
        }),
    });
}

export function deriveSmartOrderTask03bPlacedTarget(value) {
    const input = exact(
        value,
        [
            'account',
            'contractUnit',
            'expectedCustomField',
            'expectedPriceDecimal',
            'placeResponse',
            'refreshedTrades',
            'runId',
            'tradeDate',
        ],
        'Task 0.3b placed target input',
    );
    const account = canonicalAccount(input.account);
    if (
        !UUID.test(input.runId ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate ?? '') ||
        !Number.isSafeInteger(input.contractUnit) ||
        input.contractUnit < 1 ||
        typeof input.expectedCustomField !== 'string' ||
        !/^[A-Z0-9]{6}$/.test(input.expectedCustomField) ||
        typeof input.expectedPriceDecimal !== 'string' ||
        !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(input.expectedPriceDecimal)
    ) {
        throw new TypeError('Task 0.3b placed target scope is invalid');
    }
    const scope = Object.freeze({
        account,
        expectedCustomField: input.expectedCustomField,
        expectedPriceDecimal: input.expectedPriceDecimal,
    });
    const [responseTrade] = canonicalizeShioajiRefreshedStockTrades([
        input.placeResponse,
    ]);
    const refreshed = canonicalizeShioajiRefreshedStockTrades(input.refreshedTrades);
    const matches = refreshed.filter((trade) => matchesScope(trade, scope));
    if (
        !matchesScope(responseTrade, scope) ||
        matches.length !== 1 ||
        matches[0].tradeId !== responseTrade.tradeId ||
        matches[0].orderId !== responseTrade.orderId ||
        matches[0].seqno !== responseTrade.seqno ||
        matches[0].ordno !== responseTrade.ordno
    ) {
        throw new Error('Task 0.3b place did not resolve one response-linked target');
    }
    return targetProjection({
        account,
        runId: input.runId.toLowerCase(),
        tradeDate: input.tradeDate,
        trade: matches[0],
        revision: 0,
        contractUnit: input.contractUnit,
    });
}

export function assertNoExistingSmartOrderTask03bRunTarget(value) {
    const input = exact(
        value,
        ['account', 'expectedCustomField', 'refreshedTrades'],
        'Task 0.3b unique run target input',
    );
    const account = canonicalAccount(input.account);
    if (!/^[A-Z0-9]{6}$/.test(input.expectedCustomField ?? '')) {
        throw new TypeError('Task 0.3b run custom field is invalid');
    }
    const matches = canonicalizeShioajiRefreshedStockTrades(
        input.refreshedTrades,
    ).filter(
        (trade) =>
            trade.account.brokerId === account.broker_id &&
            trade.account.accountId === account.account_id &&
            trade.account.accountType === 'S' &&
            trade.contractKey === 'TSE:2330:STK:Common' &&
            trade.action === 'Buy' &&
            trade.customField === input.expectedCustomField,
    );
    if (matches.length !== 0) {
        throw new Error('Task 0.3b run already has a broker target');
    }
    return Object.freeze({
        unique: true,
        brokerAuthority: false,
    });
}

export function advanceSmartOrderTask03bTargetRevision(value) {
    const input = exact(
        value,
        ['account', 'expectedPriceDecimal', 'previousTarget', 'refreshedTrades'],
        'Task 0.3b target revision input',
    );
    const account = canonicalAccount(input.account);
    const previous = privateTargetRecord(input.previousTarget);
    if (
        previous.schemaVersion !== SMART_ORDER_TASK_0_3B_TARGET_LINEAGE_SCHEMA_VERSION ||
        !DIGEST.test(previous.targetIdSha256 ?? '') ||
        !DIGEST.test(previous.targetRevision ?? '') ||
        previous.accountScopeSha256 !== smartOrderGateProbeAccountScopeSha256(account) ||
        typeof input.expectedPriceDecimal !== 'string' ||
        input.expectedPriceDecimal === String(previous.priceMinorUnits / 100)
    ) {
        throw new TypeError('Task 0.3b previous target or next price is invalid');
    }
    const refreshed = canonicalizeShioajiRefreshedStockTrades(input.refreshedTrades);
    const matches = refreshed.filter(
        (trade) =>
            matchesScope(trade, {
                account,
                expectedCustomField: previous.customField,
                expectedPriceDecimal: input.expectedPriceDecimal,
            }) &&
            trade.tradeId === previous.tradeId &&
            trade.orderId === previous.orderId &&
            trade.seqno === previous.seqno &&
            trade.ordno === previous.ordno,
    );
    if (matches.length !== 1) {
        throw new Error('Task 0.3b target revision changed or became ambiguous');
    }
    const next = targetProjection({
        account,
        runId: previous.originRunId,
        tradeDate: previous.tradeDate,
        trade: matches[0],
        revision: previous.revision + 1,
        contractUnit: previous.contractUnit,
    });
    if (next.privateTarget.targetIdSha256 !== previous.targetIdSha256) {
        throw new Error('Task 0.3b immutable target identity drifted');
    }
    return next;
}

export function verifySmartOrderTask03bCurrentTarget(value) {
    const input = exact(
        value,
        ['account', 'refreshedTrades', 'target'],
        'Task 0.3b current target input',
    );
    const account = canonicalAccount(input.account);
    const target = privateTargetRecord(input.target);
    if (
        target.schemaVersion !== SMART_ORDER_TASK_0_3B_TARGET_LINEAGE_SCHEMA_VERSION ||
        target.accountScopeSha256 !== smartOrderGateProbeAccountScopeSha256(account) ||
        !DIGEST.test(target.targetIdSha256 ?? '') ||
        !DIGEST.test(target.targetRevision ?? '')
    ) {
        throw new TypeError('Task 0.3b current target binding is invalid');
    }
    const price = String(target.priceMinorUnits / 100);
    const refreshed = canonicalizeShioajiRefreshedStockTrades(input.refreshedTrades);
    const matches = refreshed.filter(
        (trade) =>
            matchesScope(trade, {
                account,
                expectedCustomField: target.customField,
                expectedPriceDecimal: price,
            }) && sameIdentifiers(trade, target),
    );
    if (matches.length !== 1) {
        throw new Error('Task 0.3b target changed before broker write');
    }
    return Object.freeze({
        current: true,
        targetRevision: target.targetRevision,
        revision: target.revision,
        brokerAuthority: false,
    });
}

export function confirmSmartOrderTask03bCancelledTarget(value) {
    const input = exact(
        value,
        ['account', 'refreshedTrades', 'target'],
        'Task 0.3b cancelled target input',
    );
    const account = canonicalAccount(input.account);
    const target = privateTargetRecord(input.target);
    const refreshed = canonicalizeShioajiRefreshedStockTrades(input.refreshedTrades);
    const matches = refreshed.filter(
        (trade) =>
            trade.account.brokerId === account.broker_id &&
            trade.account.accountId === account.account_id &&
            trade.account.accountType === 'S' &&
            trade.contractKey === 'TSE:2330:STK:Common' &&
            trade.action === 'Buy' &&
            sameIdentifiers(trade, target),
    );
    if (
        matches.length !== 1 ||
        matches[0].status !== 'Cancelled' ||
        matches[0].remaining !== 0 ||
        matches[0].cumulativeDeal !== 0 ||
        matches[0].cumulativeCancel !== 1
    ) {
        throw new Error('Task 0.3b cancel did not reach one exact terminal target');
    }
    return Object.freeze({
        confirmed: true,
        terminalStatus: 'Cancelled',
        targetIdSha256: target.targetIdSha256,
        finalRevision: target.revision + 1,
        brokerAuthority: false,
    });
}
