import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';

export const SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION =
    'smart-order-task-0.3c-external-sell-target/2026-08-27.1';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKING = new Set(['PendingSubmit', 'PreSubmitted', 'Submitted']);

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function validAccount(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value) ||
        value.account_type !== 'S' ||
        typeof value.broker_id !== 'string' ||
        value.broker_id.length < 1 ||
        typeof value.account_id !== 'string' ||
        value.account_id.length < 1
    ) {
        throw new TypeError('Task 0.3c account is invalid');
    }
    return value;
}

function matchingAccount(trade, account) {
    return (
        trade.account.brokerId === account.broker_id &&
        trade.account.accountId === account.account_id &&
        trade.account.accountType === 'S'
    );
}

function targetIdentifiers(trade) {
    return Object.freeze({
        tradeId: trade.tradeId,
        orderId: trade.orderId,
        seqno: trade.seqno,
        ordno: trade.ordno,
        customField: trade.customField,
    });
}

function sameTarget(trade, target) {
    return (
        trade.tradeId === target.tradeId &&
        trade.orderId === target.orderId &&
        trade.seqno === target.seqno &&
        trade.ordno === target.ordno &&
        trade.customField === target.customField
    );
}

function relevantWorkingSells(trades, account) {
    return canonicalizeShioajiRefreshedStockTrades(trades).filter(
        (trade) =>
            matchingAccount(trade, account) &&
            trade.contractKey === 'TSE:2330:STK:Common' &&
            trade.action === 'Sell' &&
            WORKING.has(trade.status),
    );
}

function validatePosition(positions, contractUnit, committedLots) {
    if (!Array.isArray(positions) || utilTypes.isProxy(positions)) {
        throw new TypeError('Task 0.3c positions are invalid');
    }
    const relevant = positions.filter((position) => position?.code === '2330');
    if (relevant.length !== 1) {
        throw new Error('Task 0.3c requires one unambiguous 2330 position');
    }
    const [position] = relevant;
    if (
        !position ||
        typeof position !== 'object' ||
        Array.isArray(position) ||
        utilTypes.isProxy(position) ||
        position.direction !== 'Buy' ||
        !Number.isSafeInteger(position.id) ||
        !Number.isSafeInteger(position.quantity) ||
        !Number.isSafeInteger(position.yd_quantity) ||
        position.quantity < contractUnit * 2 ||
        position.yd_quantity < 0 ||
        position.yd_quantity > position.quantity ||
        position.quantity - committedLots * contractUnit < contractUnit
    ) {
        throw new Error(
            'Task 0.3c position is insufficient, unavailable, or unknown',
        );
    }
    return Object.freeze({
        positionLineageRef: sha256(
            canonicalJson(['task-0.3c-position', position.id, position.code]),
        ),
        quantityShares: position.quantity,
        yesterdayQuantityShares: position.yd_quantity,
    });
}

export function assertSmartOrderTask03cExternalSellBaseline({
    account: accountValue,
    contractUnit,
    expectedCustomField,
    operationOrdinal,
    positions,
    previousTargets,
    trades,
}) {
    const account = validAccount(accountValue);
    if (
        !Number.isSafeInteger(contractUnit) ||
        contractUnit < 1 ||
        !/^[A-Z0-9]{6}$/.test(expectedCustomField ?? '') ||
        ![1, 2].includes(operationOrdinal) ||
        !Array.isArray(previousTargets) ||
        previousTargets.length !== operationOrdinal - 1
    ) {
        throw new TypeError('Task 0.3c baseline scope is invalid');
    }
    const workingSells = relevantWorkingSells(trades, account);
    if (workingSells.length !== previousTargets.length) {
        throw new Error('Task 0.3c working-sell baseline is not the exact known set');
    }
    for (const target of previousTargets) {
        const matches = workingSells.filter((trade) => sameTarget(trade, target));
        if (
            target?.schemaVersion !== SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION ||
            target.accountScopeSha256 !==
                smartOrderGateProbeAccountScopeSha256(account) ||
            target.operationOrdinal !== 1 ||
            matches.length !== 1 ||
            matches[0].orderQuantity !== 1 ||
            matches[0].remaining !== 1 ||
            matches[0].cumulativeDeal !== 0 ||
            matches[0].cumulativeCancel !== 0 ||
            matches[0].unit !== 'CommonLot'
        ) {
            throw new Error('Task 0.3c prior external sell is not current and exact');
        }
    }
    if (
        canonicalizeShioajiRefreshedStockTrades(trades).some(
            (trade) =>
                matchingAccount(trade, account) &&
                trade.contractKey === 'TSE:2330:STK:Common' &&
                trade.action === 'Sell' &&
                trade.customField === expectedCustomField,
        )
    ) {
        throw new Error('Task 0.3c operation already has a broker target');
    }
    const position = validatePosition(
        positions,
        contractUnit,
        previousTargets.length,
    );
    return Object.freeze({
        position,
        workingSellCount: workingSells.length,
        workingSetSha256: sha256(
            canonicalJson(
                workingSells
                    .map((trade) => ({
                        ...targetIdentifiers(trade),
                        quantity: trade.orderQuantity,
                        remaining: trade.remaining,
                        status: trade.status,
                    }))
                    .sort((left, right) =>
                        canonicalJson(left).localeCompare(canonicalJson(right)),
                    ),
            ),
        ),
        brokerAuthority: false,
    });
}

export function verifySmartOrderTask03cCompleteExternalSellSet({
    account: accountValue,
    contractUnit,
    positions,
    targets,
    trades,
}) {
    const account = validAccount(accountValue);
    if (
        !Number.isSafeInteger(contractUnit) ||
        contractUnit < 1 ||
        !Array.isArray(targets) ||
        targets.length !== 2 ||
        targets[0]?.operationOrdinal !== 1 ||
        targets[1]?.operationOrdinal !== 2 ||
        targets.some(
            (target) =>
                target?.schemaVersion !==
                    SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION ||
                target.accountScopeSha256 !==
                    smartOrderGateProbeAccountScopeSha256(account) ||
                target.contractUnit !== contractUnit,
        )
    ) {
        throw new TypeError('Task 0.3c complete target set is invalid');
    }
    const workingSells = relevantWorkingSells(trades, account);
    if (
        workingSells.length !== 2 ||
        targets.some(
            (target) =>
                workingSells.filter((trade) => sameTarget(trade, target))
                    .length !== 1,
        ) ||
        workingSells.some(
            (trade) =>
                trade.orderQuantity !== 1 ||
                trade.remaining !== 1 ||
                trade.cumulativeDeal !== 0 ||
                trade.cumulativeCancel !== 0 ||
                trade.unit !== 'CommonLot',
        )
    ) {
        throw new Error(
            'Task 0.3c account-scoped working-sell set is incomplete or drifted',
        );
    }
    const position = validatePosition(positions, contractUnit, 1);
    const identifiers = targets.map((target) =>
        Object.freeze({
            targetIdSha256: target.targetIdSha256,
            brokerOrderId: target.orderId,
            tradeId: target.tradeId,
            orderId: target.orderId,
            seqno: target.seqno,
            ordno: target.ordno,
            customField: target.customField,
            quantityCommonLots: 1,
            status: workingSells.find((trade) => sameTarget(trade, target)).status,
        }),
    );
    return Object.freeze({
        complete: true,
        position,
        identifiers: Object.freeze(identifiers),
        identifierSetSha256: sha256(canonicalJson(identifiers)),
        brokerAuthority: false,
    });
}

function matchesPlacedTarget(trade, scope) {
    return (
        matchingAccount(trade, scope.account) &&
        trade.contractKey === 'TSE:2330:STK:Common' &&
        trade.action === 'Sell' &&
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

export function deriveSmartOrderTask03cPlacedTarget({
    account: accountValue,
    contractUnit,
    expectedCustomField,
    expectedPriceDecimal,
    operationOrdinal,
    placeResponse,
    refreshedTrades,
    runId,
    tradeDate,
}) {
    const account = validAccount(accountValue);
    if (
        !UUID.test(runId ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !Number.isSafeInteger(contractUnit) ||
        contractUnit < 1 ||
        ![1, 2].includes(operationOrdinal) ||
        !/^[A-Z0-9]{6}$/.test(expectedCustomField ?? '') ||
        typeof expectedPriceDecimal !== 'string'
    ) {
        throw new TypeError('Task 0.3c placed target scope is invalid');
    }
    const scope = { account, expectedCustomField, expectedPriceDecimal };
    const [responseTrade] = canonicalizeShioajiRefreshedStockTrades([
        placeResponse,
    ]);
    const matches = canonicalizeShioajiRefreshedStockTrades(
        refreshedTrades,
    ).filter((trade) => matchesPlacedTarget(trade, scope));
    if (
        !matchesPlacedTarget(responseTrade, scope) ||
        matches.length !== 1 ||
        !sameTarget(matches[0], responseTrade)
    ) {
        throw new Error('Task 0.3c place did not resolve one response-linked target');
    }
    const trade = matches[0];
    const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
    const targetIdSha256 = sha256(
        canonicalJson({
            accountScopeSha256,
            runId: runId.toLowerCase(),
            operationOrdinal,
            tradeDate,
            contractKey: trade.contractKey,
            action: trade.action,
            ...targetIdentifiers(trade),
        }),
    );
    const targetRevision = sha256(
        canonicalJson({
            targetIdSha256,
            price: trade.price,
            quantity: trade.orderQuantity,
            remaining: trade.remaining,
            status: trade.status,
        }),
    );
    const privateTarget = Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_TARGET_SCHEMA_VERSION,
        originRunId: runId.toLowerCase(),
        operationOrdinal,
        targetIdSha256,
        targetRevision,
        accountScopeSha256,
        tradeDate,
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
        publicTarget: Object.freeze({
            targetRef: `…${targetIdSha256.slice(-12)}`,
            targetRevision,
            operationOrdinal,
            tradeDate,
            accountRef: `…${accountScopeSha256.slice(-12)}`,
            brokerAuthority: false,
        }),
    });
}
