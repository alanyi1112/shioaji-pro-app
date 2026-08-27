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

export const SMART_ORDER_TASK_0_4_0_6_OPERATION_CONTRACT_SCHEMA_VERSION =
    'smart-order-task-0.4-0.6-operation-contract/2026-08-26.2';

export const SMART_ORDER_TASK_0_4_0_6_PROFILES = Object.freeze({
    round_trip_lmt_ioc: Object.freeze({
        taskId: '0.4',
        side: 'Buy',
        purpose: 'marketable_fill',
        priceType: 'LMT',
        timeInForce: 'IOC',
        priceOrdinal: 1,
        expectedOutcome: 'filled_with_order_and_deal',
    }),
    lmt_rod_fill: Object.freeze({
        taskId: '0.6',
        side: 'Buy',
        purpose: 'marketable_fill',
        priceType: 'LMT',
        timeInForce: 'ROD',
        priceOrdinal: 1,
        expectedOutcome: 'filled_with_order_and_deal',
    }),
    lmt_ioc_zero_fill: Object.freeze({
        taskId: '0.6',
        side: 'Buy',
        purpose: 'ioc_zero_fill',
        priceType: 'LMT',
        timeInForce: 'IOC',
        priceOrdinal: 1,
        expectedOutcome: 'zero_fill_no_deal',
    }),
    mkt_ioc_fill: Object.freeze({
        taskId: '0.6',
        side: 'Buy',
        purpose: 'market_order',
        priceType: 'MKT',
        timeInForce: 'IOC',
        priceOrdinal: 0,
        expectedOutcome: 'filled_with_order_and_deal',
    }),
    protected_entry_lmt_ioc: Object.freeze({
        taskId: '13.3',
        side: 'Buy',
        purpose: 'marketable_fill',
        priceType: 'LMT',
        timeInForce: 'IOC',
        priceOrdinal: 10,
        expectedOutcome: 'filled_with_order_and_deal',
    }),
    protected_exit_working_lmt_rod: Object.freeze({
        taskId: '13.3',
        side: 'Sell',
        purpose: 'working_non_marketable',
        priceType: 'LMT',
        timeInForce: 'ROD',
        priceOrdinal: 1,
        expectedOutcome: 'working_no_deal',
    }),
    protected_exit_marketable_lmt_ioc: Object.freeze({
        taskId: '13.3',
        side: 'Sell',
        purpose: 'marketable_fill',
        priceType: 'LMT',
        timeInForce: 'IOC',
        priceOrdinal: 10,
        expectedOutcome: 'filled_with_order_and_deal',
    }),
    protected_exit_ioc_unfilled: Object.freeze({
        taskId: '13.3',
        side: 'Sell',
        purpose: 'ioc_zero_fill',
        priceType: 'LMT',
        timeInForce: 'IOC',
        priceOrdinal: 2,
        expectedOutcome: 'zero_fill_no_deal',
    }),
});

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

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

function fixedAccount(value) {
    const account = exact(
        value,
        ['account_id', 'account_type', 'broker_id'],
        'Task 0.4/0.6 fixed account',
    );
    if (
        account.account_type !== 'S' ||
        typeof account.account_id !== 'string' ||
        account.account_id.length < 1 ||
        typeof account.broker_id !== 'string' ||
        account.broker_id.length < 1
    ) {
        throw new TypeError('Task 0.4/0.6 fixed account is invalid');
    }
    return account;
}

export function smartOrderTask0406CustomField({ profile, runId }) {
    if (!Object.hasOwn(SMART_ORDER_TASK_0_4_0_6_PROFILES, profile) || !UUID.test(runId ?? '')) {
        throw new TypeError('Task 0.4/0.6 custom-field scope is invalid');
    }
    const taskScope = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile].taskId === '13.3'
        ? 'task-13.3'
        : 'task-0.4-0.6';
    return createHash('sha256')
        .update(`${taskScope}\u001f${profile}\u001f${runId.toLowerCase()}`)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
}

export function buildSmartOrderTask0406OperationContract({
    account: accountValue,
    marketPlan,
    marketPlanSha256,
    nonce,
    nowEpochMs,
    operationId,
    profile,
}) {
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    if (
        !policy ||
        !isIssuedSmartOrderTaskProbeMarketPlan(marketPlan) ||
        marketPlan.taskId !== policy.taskId ||
        marketPlan.side !== policy.side ||
        marketPlan.operation !== 'place' ||
        marketPlan.purpose !== policy.purpose ||
        marketPlan.priceType !== policy.priceType ||
        marketPlan.timeInForce !== policy.timeInForce ||
        marketPlan.target !== null ||
        !DIGEST.test(marketPlanSha256 ?? '') ||
        sha256(canonicalJson(marketPlan)) !== marketPlanSha256 ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < marketPlan.observedAtEpochMs ||
        nowEpochMs >= marketPlan.validUntilEpochMs
    ) {
        throw new TypeError('Task 0.4/0.6 issued market plan is invalid or stale');
    }
    const account = fixedAccount(accountValue);
    const [exchange, code] = marketPlan.contractKey.split(':');
    const customField = smartOrderTask0406CustomField({
        profile,
        runId: marketPlan.runId,
    });
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
                action: marketPlan.side,
                price: marketPlan.priceType === 'MKT' ? 0 : Number(marketPlan.price),
                quantity: 1,
                price_type: marketPlan.priceType,
                order_type: marketPlan.timeInForce,
                order_lot: 'Common',
                custom_field: customField,
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
        schemaVersion: SMART_ORDER_TASK_0_4_0_6_OPERATION_CONTRACT_SCHEMA_VERSION,
        profile,
        expectedOutcome: policy.expectedOutcome,
        customField,
        marketPlanSha256,
        canonical,
        publicSummary: Object.freeze({
            taskId: policy.taskId,
            profile,
            runId: marketPlan.runId,
            operation: 'place',
            contractKey: marketPlan.contractKey,
            side: marketPlan.side,
            price: marketPlan.price,
            brokerPrice: marketPlan.priceType === 'MKT' ? 0 : marketPlan.price,
            priceType: marketPlan.priceType,
            timeInForce: marketPlan.timeInForce,
            quantityCommonLots: 1,
            customField,
            expectedOutcome: policy.expectedOutcome,
            accountRef: `…${marketPlan.accountScopeSha256.slice(-12)}`,
            tradeDate: marketPlan.tradeDate,
            requestSha256: canonical.envelope.requestSha256,
            envelopeSha256: canonical.envelopeSha256,
            marketPlanSha256,
            validUntilEpochMs: canonical.envelope.validUntilEpochMs,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            brokerWriteAttempted: false,
            brokerAuthority: false,
        }),
    });
}
