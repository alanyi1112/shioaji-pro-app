import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS,
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    canonicalSmartOrderGateProbeSafetyEnvelope,
} from './gate-probe-safety-envelope.mjs';
import { SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION } from './manual-broker-write-contract.mjs';
import { isIssuedSmartOrderTaskProbeMarketPlan } from './task-probe-market-plan.mjs';

export const SMART_ORDER_TASK_0_3C_OPERATION_CONTRACT_SCHEMA_VERSION =
    'smart-order-task-0.3c-operation-contract/2026-08-27.1';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fixedSimulationAccount(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Reflect.ownKeys(value).sort().join('\u001f') !==
            ['account_id', 'account_type', 'broker_id'].sort().join('\u001f') ||
        value.account_type !== 'S' ||
        typeof value.account_id !== 'string' ||
        value.account_id.length < 1 ||
        typeof value.broker_id !== 'string' ||
        value.broker_id.length < 1
    ) {
        throw new TypeError('Task 0.3c fixed simulation account is invalid');
    }
    return Object.freeze({
        account_id: value.account_id,
        account_type: 'S',
        broker_id: value.broker_id,
    });
}

export function smartOrderTask03cCustomField(runId, operationOrdinal) {
    if (!UUID.test(runId ?? '') || ![1, 2].includes(operationOrdinal)) {
        throw new TypeError('Task 0.3c run or operation ordinal is invalid');
    }
    return createHash('sha256')
        .update(`task-0.3c\u001f${runId.toLowerCase()}\u001f${operationOrdinal}`)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
}

export function buildSmartOrderTask03cOperationContract({
    account: accountValue,
    marketPlan,
    marketPlanSha256,
    nonce,
    nowEpochMs,
    operationId,
    operationOrdinal,
}) {
    if (
        !isIssuedSmartOrderTaskProbeMarketPlan(marketPlan) ||
        marketPlan.taskId !== '0.3c' ||
        marketPlan.operation !== 'place' ||
        marketPlan.side !== 'Sell' ||
        marketPlan.purpose !== 'working_non_marketable' ||
        marketPlan.priceType !== 'LMT' ||
        marketPlan.timeInForce !== 'ROD' ||
        marketPlan.quantityCommonLots !== 1 ||
        ![1, 2].includes(operationOrdinal) ||
        !DIGEST.test(marketPlanSha256 ?? '') ||
        sha256(canonicalJson(marketPlan)) !== marketPlanSha256 ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < marketPlan.observedAtEpochMs ||
        nowEpochMs >= marketPlan.validUntilEpochMs
    ) {
        throw new TypeError('Task 0.3c issued market plan is invalid or stale');
    }
    const account = fixedSimulationAccount(accountValue);
    const [exchange, code] = marketPlan.contractKey.split(':');
    const request = Object.freeze({
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
                action: 'Sell',
                price: Number(marketPlan.price),
                quantity: 1,
                price_type: 'LMT',
                order_type: 'ROD',
                order_lot: 'Common',
                custom_field: smartOrderTask03cCustomField(
                    marketPlan.runId,
                    operationOrdinal,
                ),
                account,
            }),
        }),
    });
    const canonical = canonicalSmartOrderGateProbeSafetyEnvelope(
        Object.freeze({
            schemaVersion: SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
            runId: marketPlan.runId,
            operationId,
            nonce,
            request,
            target: null,
            tradeDate: marketPlan.tradeDate,
            confirmation: Object.freeze({
                accountScopeSha256: marketPlan.accountScopeSha256,
                confirmed: true,
                expectedOperation: 'place',
                maximumCommonLots: 1,
                simulation: true,
            }),
            validUntilEpochMs:
                nowEpochMs + SMART_ORDER_GATE_PROBE_MAX_LIFETIME_MS,
        }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_OPERATION_CONTRACT_SCHEMA_VERSION,
        marketPlanSha256,
        canonical,
        publicSummary: Object.freeze({
            taskId: '0.3c',
            runId: marketPlan.runId,
            operation: 'place',
            operationOrdinal,
            contractKey: marketPlan.contractKey,
            side: 'Sell',
            price: marketPlan.price,
            priceType: 'LMT',
            timeInForce: 'ROD',
            quantityCommonLots: 1,
            accountRef: `…${marketPlan.accountScopeSha256.slice(-12)}`,
            tradeDate: marketPlan.tradeDate,
            requestSha256: canonical.envelope.requestSha256,
            envelopeSha256: canonical.envelopeSha256,
            marketPlanSha256,
            validUntilEpochMs: canonical.envelope.validUntilEpochMs,
            brokerWriteAttempted: false,
            brokerAuthority: false,
        }),
    });
}
