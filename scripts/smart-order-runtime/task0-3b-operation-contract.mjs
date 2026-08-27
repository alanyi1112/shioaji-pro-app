import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS,
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    canonicalSmartOrderGateProbeSafetyEnvelope,
} from './gate-probe-safety-envelope.mjs';
import { SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION } from './manual-broker-write-contract.mjs';
import { isIssuedSmartOrderTaskProbeMarketPlan } from './task-probe-market-plan.mjs';

export const SMART_ORDER_TASK_0_3B_OPERATION_CONTRACT_SCHEMA_VERSION =
    'smart-order-task-0.3b-operation-contract/2026-08-26.1';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function account(value) {
    const current = exact(
        value,
        ['account_id', 'account_type', 'broker_id'],
        'Task 0.3b fixed account',
    );
    if (
        current.account_type !== 'S' ||
        typeof current.broker_id !== 'string' ||
        current.broker_id.length < 1 ||
        typeof current.account_id !== 'string' ||
        current.account_id.length < 1
    ) {
        throw new TypeError('Task 0.3b fixed account is invalid');
    }
    return current;
}

function privateTarget(value, plan) {
    if (value === null) return null;
    const current = exact(
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
    if (
        current.schemaVersion !==
            'smart-order-task-0.3b-target-lineage/2026-08-24.1' ||
        !UUID.test(current.originRunId ?? '') ||
        current.originRunId.toLowerCase() !== plan.runId ||
        current.accountScopeSha256 !== plan.accountScopeSha256 ||
        current.tradeDate !== plan.tradeDate ||
        current.targetIdSha256 !== plan.target?.targetIdSha256 ||
        current.revision !== plan.target?.revision ||
        current.priceMinorUnits !== plan.target?.priceMinorUnits ||
        !DIGEST.test(current.targetRevision ?? '') ||
        !Number.isSafeInteger(current.contractUnit) ||
        current.contractUnit < 1 ||
        typeof current.tradeId !== 'string' ||
        current.tradeId.length < 1 ||
        current.tradeId.length > 160
    ) {
        throw new TypeError('Task 0.3b private target does not match the current plan');
    }
    return current;
}

export function smartOrderTask03bCustomField(runId) {
    if (!UUID.test(runId ?? '')) {
        throw new TypeError('Task 0.3b run identity is invalid');
    }
    return createHash('sha256')
        .update(`task-0.3b\u001f${runId}`)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
}

export function buildSmartOrderTask03bOperationContract({
    account: accountValue,
    marketPlan,
    marketPlanSha256,
    nonce,
    nowEpochMs,
    operationId,
    target: targetValue,
}) {
    if (
        !isIssuedSmartOrderTaskProbeMarketPlan(marketPlan) ||
        marketPlan.taskId !== '0.3b' ||
        typeof marketPlanSha256 !== 'string' ||
        !DIGEST.test(marketPlanSha256) ||
        sha256(canonicalJson(marketPlan)) !== marketPlanSha256 ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < marketPlan.observedAtEpochMs ||
        nowEpochMs >= marketPlan.validUntilEpochMs
    ) {
        throw new TypeError('Task 0.3b issued market plan is invalid or stale');
    }
    const fixedAccount = account(accountValue);
    const target = privateTarget(targetValue, marketPlan);
    if (
        (marketPlan.operation === 'place' && target !== null) ||
        (marketPlan.operation !== 'place' && target === null)
    ) {
        throw new TypeError('Task 0.3b operation target is invalid');
    }
    const [exchange, code] = marketPlan.contractKey.split(':');
    let request;
    let gateTarget = null;
    if (marketPlan.operation === 'place') {
        request = Object.freeze({
            schemaVersion: SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
            operation: 'place',
            brokerPath: '/api/v1/order/place_order',
            payload: Object.freeze({
                contract: Object.freeze({
                    security_type: 'STK',
                    region: 'TW',
                    exchange,
                    code,
                    target_code: null,
                }),
                stock_order: Object.freeze({
                    action: 'Buy',
                    price: Number(marketPlan.price),
                    quantity: 1,
                    price_type: 'LMT',
                    order_type: 'ROD',
                    order_lot: 'Common',
                    custom_field: smartOrderTask03bCustomField(marketPlan.runId),
                    account: fixedAccount,
                }),
            }),
        });
    } else {
        gateTarget = Object.freeze({
            originRunId: target.originRunId,
            targetIdSha256: target.targetIdSha256,
            tradeIdSha256: sha256(JSON.stringify(target.tradeId)),
            accountScopeSha256: target.accountScopeSha256,
            tradeDate: target.tradeDate,
            revision: target.revision,
            quantityCommonLots: 1,
            nonTerminal: true,
            correlationUnique: true,
        });
        request = Object.freeze({
            schemaVersion: SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
            operation: marketPlan.operation,
            brokerPath:
                marketPlan.operation === 'update_price'
                    ? '/api/v1/order/update_price'
                    : '/api/v1/order/cancel_order',
            payload: Object.freeze({
                trade_id: target.tradeId,
                ...(marketPlan.operation === 'update_price'
                    ? { price: Number(marketPlan.price) }
                    : {}),
                account: fixedAccount,
            }),
        });
    }
    const expectedOperation =
        marketPlan.operation === 'update_price' ? 'update' : marketPlan.operation;
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(
        Object.freeze({
            schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
            runId: marketPlan.runId,
            operationId,
            nonce,
            request,
            target: gateTarget,
            tradeDate: marketPlan.tradeDate,
            confirmation: Object.freeze({
                accountScopeSha256: marketPlan.accountScopeSha256,
                confirmed: true,
                expectedOperation,
                maximumCommonLots: 1,
                simulation: true,
            }),
            // The market plan must be fresh while this exact request is built,
            // but the human authorization window is independent. The executor
            // performs a new fail-closed market/account/target revalidation
            // immediately before the sole broker write.
            validUntilEpochMs:
                nowEpochMs + SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS,
        }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3B_OPERATION_CONTRACT_SCHEMA_VERSION,
        marketPlanSha256,
        canonical,
        publicSummary: Object.freeze({
            taskId: '0.3b',
            runId: marketPlan.runId,
            operation: marketPlan.operation,
            contractKey: marketPlan.contractKey,
            side: marketPlan.side,
            price: marketPlan.price,
            priceType: marketPlan.priceType,
            timeInForce: marketPlan.timeInForce,
            quantityCommonLots: 1,
            accountRef: `…${marketPlan.accountScopeSha256.slice(-12)}`,
            tradeDate: marketPlan.tradeDate,
            target:
                gateTarget === null
                    ? null
                    : Object.freeze({
                          targetRef: `…${gateTarget.targetIdSha256.slice(-12)}`,
                          revision: gateTarget.revision,
                      }),
            requestSha256: canonical.envelope.requestSha256,
            envelopeSha256: canonical.envelopeSha256,
            marketPlanSha256,
            validUntilEpochMs: canonical.envelope.validUntilEpochMs,
            brokerWriteAttempted: false,
            brokerAuthority: false,
        }),
    });
}
