import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { canonicalProtectedEntryPlan } from './protected-entry-contract.mjs';
import {
    SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION,
    canonicalExistingPositionProtectionPlan,
} from './existing-position-protection-contract.mjs';

export const SMART_ORDER_BROKER_EXECUTION_POLICY_SCHEMA_VERSION =
    'smart-order-broker-execution-policy/2026-08-20.1';
export const SMART_ORDER_PROTECTIVE_BROKER_INTENT_SCHEMA_VERSION =
    'smart-order-protective-broker-intent/2026-08-20.1';
export const SMART_ORDER_PROTECTIVE_EXECUTION_POLICY_REVISION =
    'smart-order-protective-execution-policy/2026-08-20.1';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTRACT_PATTERN = /^(?:TSE|OTC):[A-Z0-9]+:STK:Common$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CONTRACT_LIMIT_TTL_MS = 5_000;

function snapshotOwnDataRecord(value, keys) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        return undefined;
    }
    let descriptors;
    try {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return undefined;
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return undefined;
    }
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== expected.length ||
        !actual.sort().every((key, index) => key === expected[index])
    ) {
        return undefined;
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            return undefined;
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function canonicalPositiveDecimal(value) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 80 ||
        !DECIMAL_PATTERN.test(value)
    ) {
        return null;
    }
    const [integer, rawFraction = ''] = value.split('.');
    const fraction = rawFraction.replace(/0+$/, '');
    const normalized = fraction.length > 0 ? `${integer}.${fraction}` : integer;
    return normalized === '0' ? null : normalized;
}

function compareDecimal(left, right) {
    const [leftInteger, leftFraction = ''] = left.split('.');
    const [rightInteger, rightFraction = ''] = right.split('.');
    if (leftInteger.length !== rightInteger.length) {
        return leftInteger.length < rightInteger.length ? -1 : 1;
    }
    if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
    const scale = Math.max(leftFraction.length, rightFraction.length);
    const scaledLeft = leftFraction.padEnd(scale, '0');
    const scaledRight = rightFraction.padEnd(scale, '0');
    return scaledLeft === scaledRight ? 0 : scaledLeft < scaledRight ? -1 : 1;
}

function decimalMinorUnits(value) {
    const [integer, fraction = ''] = value.split('.');
    if (fraction.length > 2 || integer.length > 13) return null;
    const minor = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
    return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function stockTickMinorUnits(categoryCode, priceMinorUnits) {
    if (categoryCode === '00') return priceMinorUnits < 5_000 ? 1 : 5;
    if (!/^(?:0[1-9]|[1-9]\d)$/.test(categoryCode)) return null;
    if (priceMinorUnits < 1_000) return 1;
    if (priceMinorUnits < 5_000) return 5;
    if (priceMinorUnits < 10_000) return 10;
    if (priceMinorUnits < 50_000) return 50;
    if (priceMinorUnits < 100_000) return 100;
    return 500;
}

function reject(reason) {
    return Object.freeze({
        schemaVersion: SMART_ORDER_BROKER_EXECUTION_POLICY_SCHEMA_VERSION,
        candidateEligible: false,
        reason,
        automaticRetryAllowed: false,
        iocRemainderDisposition: 'manual_reconciliation_no_retry',
        mappingVerified: false,
        brokerWriteAuthority: false,
    });
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalExecution(value, label) {
    const execution = snapshotOwnDataRecord(value, [
        'limitPrice',
        'priceType',
        'timeInForce',
    ]);
    if (!execution) throw new TypeError(`${label} schema is invalid`);
    if (
        !(
            (execution.priceType === 'LMT' &&
                ['ROD', 'IOC'].includes(execution.timeInForce)) ||
            (execution.priceType === 'MKT' && execution.timeInForce === 'IOC')
        )
    ) {
        throw new TypeError(`${label} policy is unsupported`);
    }
    const limitPrice =
        execution.priceType === 'LMT'
            ? canonicalPositiveDecimal(execution.limitPrice)
            : execution.limitPrice === null
              ? null
              : undefined;
    if (limitPrice === null && execution.priceType === 'LMT') {
        throw new TypeError(`${label}.limitPrice is invalid`);
    }
    if (limitPrice === undefined) {
        throw new TypeError(`${label}.limitPrice must be null for MKT`);
    }
    return Object.freeze({
        limitPrice,
        priceType: execution.priceType,
        timeInForce: execution.timeInForce,
    });
}

function canonicalProtectiveIntent(value) {
    const payload = snapshotOwnDataRecord(value, [
        'automaticRetryAllowed',
        'contractUnit',
        'execution',
        'executionPolicyHash',
        'executionPolicyRevision',
        'iocRemainderDisposition',
        'legId',
        'quantityShares',
        'schemaVersion',
        'triggerPolicyHash',
    ]);
    if (
        !payload ||
        payload.schemaVersion !==
            SMART_ORDER_PROTECTIVE_BROKER_INTENT_SCHEMA_VERSION ||
        payload.executionPolicyRevision !==
            SMART_ORDER_PROTECTIVE_EXECUTION_POLICY_REVISION ||
        !DIGEST_PATTERN.test(payload.executionPolicyHash ?? '') ||
        !DIGEST_PATTERN.test(payload.triggerPolicyHash ?? '') ||
        typeof payload.legId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(payload.legId) ||
        !Number.isSafeInteger(payload.quantityShares) ||
        payload.quantityShares <= 0 ||
        !Number.isSafeInteger(payload.contractUnit) ||
        payload.contractUnit <= 0 ||
        payload.automaticRetryAllowed !== false
    ) {
        throw new TypeError('protective broker intent payload is invalid');
    }
    const execution = canonicalExecution(
        payload.execution,
        'protective broker intent execution',
    );
    const expectedDisposition =
        execution.timeInForce === 'IOC'
            ? 'manual_reconciliation_no_retry'
            : 'not_applicable';
    if (payload.iocRemainderDisposition !== expectedDisposition) {
        throw new TypeError(
            'protective broker intent remainder disposition is invalid',
        );
    }
    return Object.freeze({
        schemaVersion: payload.schemaVersion,
        legId: payload.legId,
        quantityShares: payload.quantityShares,
        contractUnit: payload.contractUnit,
        triggerPolicyHash: payload.triggerPolicyHash,
        executionPolicyRevision: payload.executionPolicyRevision,
        executionPolicyHash: payload.executionPolicyHash,
        execution,
        automaticRetryAllowed: false,
        iocRemainderDisposition: expectedDisposition,
    });
}

export function canonicalSmartOrderProtectiveBrokerIntentPayload(value) {
    const payload = canonicalProtectiveIntent(value);
    const payloadJson = canonicalJson(payload);
    return Object.freeze({
        payload,
        payloadJson,
        payloadSha256: sha256(payloadJson),
    });
}

export function buildSmartOrderProtectiveBrokerIntentPayload(input) {
    const request = snapshotOwnDataRecord(input, [
        'legId',
        'protectionPlan',
        'quantityShares',
        'triggerPolicyHash',
    ]);
    if (
        !request ||
        typeof request.legId !== 'string' ||
        !DIGEST_PATTERN.test(request.triggerPolicyHash ?? '') ||
        !Number.isSafeInteger(request.quantityShares) ||
        request.quantityShares <= 0
    ) {
        throw new TypeError('protective broker intent builder input is invalid');
    }
    const plan = request.protectionPlan?.schemaVersion ===
        SMART_ORDER_EXISTING_POSITION_PROTECTION_PLAN_SCHEMA_VERSION
        ? canonicalExistingPositionProtectionPlan(request.protectionPlan)
        : canonicalProtectedEntryPlan(request.protectionPlan);
    const contractUnit =
        plan.plan.entryOrder?.contractUnit ?? plan.contractUnit;
    const leg = plan.plan.protection.legs.find(
        (candidate) => candidate.legId === request.legId,
    );
    if (!leg) {
        throw new Error('protective broker intent leg is not in the durable plan');
    }
    const execution = canonicalExecution(
        leg.execution,
        'protective broker intent durable execution',
    );
    const executionPolicyHash = sha256(
        `${SMART_ORDER_PROTECTIVE_EXECUTION_POLICY_REVISION}\n${canonicalJson({
            contractKey: plan.plan.contractKey,
            contractUnit,
            execution,
            legId: leg.legId,
            planSha256: plan.planSha256,
            triggerPolicyHash: request.triggerPolicyHash,
        })}`,
    );
    return canonicalSmartOrderProtectiveBrokerIntentPayload({
        schemaVersion: SMART_ORDER_PROTECTIVE_BROKER_INTENT_SCHEMA_VERSION,
        legId: leg.legId,
        quantityShares: request.quantityShares,
        contractUnit,
        triggerPolicyHash: request.triggerPolicyHash,
        executionPolicyRevision:
            SMART_ORDER_PROTECTIVE_EXECUTION_POLICY_REVISION,
        executionPolicyHash,
        execution,
        automaticRetryAllowed: false,
        iocRemainderDisposition:
            execution.timeInForce === 'IOC'
                ? 'manual_reconciliation_no_retry'
                : 'not_applicable',
    });
}

/**
 * Evaluates the narrow automation execution policy without accepting trigger
 * truth or producing dispatch authority.  Current contract-limit evidence is
 * structural only until a production verifier/current-head adapter exists.
 */
export function evaluateSmartOrderBrokerExecutionPolicy(input) {
    const request = snapshotOwnDataRecord(input, [
        'contractLimits',
        'nowEpochMs',
        'order',
        'triggerPolicyHash',
    ]);
    if (
        !request ||
        !DIGEST_PATTERN.test(request.triggerPolicyHash ?? '') ||
        !Number.isSafeInteger(request.nowEpochMs) ||
        request.nowEpochMs < 0
    ) {
        return reject('input_schema_invalid');
    }
    const order = snapshotOwnDataRecord(request.order, [
        'contractKey',
        'limitPrice',
        'policyRevision',
        'priceType',
        'side',
        'timeInForce',
    ]);
    const limits = snapshotOwnDataRecord(request.contractLimits, [
        'categoryCode',
        'contractKey',
        'evidenceSha256',
        'limitDown',
        'limitUp',
        'observedAtEpochMs',
        'validUntilEpochMs',
    ]);
    if (!order || !limits) return reject('nested_schema_invalid');
    if (
        typeof order.contractKey !== 'string' ||
        !CONTRACT_PATTERN.test(order.contractKey) ||
        (order.side !== 'Buy' && order.side !== 'Sell') ||
        typeof order.policyRevision !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(order.policyRevision)
    ) {
        return reject('order_schema_invalid');
    }
    const supportedCombination =
        (order.priceType === 'LMT' &&
            (order.timeInForce === 'ROD' || order.timeInForce === 'IOC')) ||
        (order.priceType === 'MKT' && order.timeInForce === 'IOC');
    if (!supportedCombination) return reject('order_policy_not_approved');
    if (
        limits.contractKey !== order.contractKey ||
        typeof limits.categoryCode !== 'string' ||
        !DIGEST_PATTERN.test(limits.evidenceSha256 ?? '') ||
        !Number.isSafeInteger(limits.observedAtEpochMs) ||
        !Number.isSafeInteger(limits.validUntilEpochMs) ||
        limits.observedAtEpochMs < 0 ||
        limits.validUntilEpochMs <= limits.observedAtEpochMs ||
        limits.observedAtEpochMs > request.nowEpochMs ||
        request.nowEpochMs >= limits.validUntilEpochMs ||
        limits.validUntilEpochMs - limits.observedAtEpochMs >
            CONTRACT_LIMIT_TTL_MS
    ) {
        return reject('contract_limit_evidence_not_current');
    }
    const limitDown = canonicalPositiveDecimal(limits.limitDown);
    const limitUp = canonicalPositiveDecimal(limits.limitUp);
    if (!limitDown || !limitUp || compareDecimal(limitDown, limitUp) > 0) {
        return reject('contract_limit_invalid');
    }

    let limitPrice = null;
    if (order.priceType === 'LMT') {
        limitPrice = canonicalPositiveDecimal(order.limitPrice);
        if (!limitPrice) return reject('limit_price_invalid');
        const limitPriceMinorUnits = decimalMinorUnits(limitPrice);
        const tickMinorUnits =
            limitPriceMinorUnits === null
                ? null
                : stockTickMinorUnits(
                      limits.categoryCode,
                      limitPriceMinorUnits,
                  );
        if (
            tickMinorUnits === null ||
            limitPriceMinorUnits % tickMinorUnits !== 0
        ) {
            return reject('limit_price_not_on_current_tick');
        }
        if (
            compareDecimal(limitPrice, limitDown) < 0 ||
            compareDecimal(limitPrice, limitUp) > 0
        ) {
            return reject('limit_price_outside_current_bounds');
        }
    } else if (order.limitPrice !== null) {
        return reject('market_order_must_not_have_limit_price');
    }

    const immutableOrder = Object.freeze({
        contractKey: order.contractKey,
        side: order.side,
        priceType: order.priceType,
        timeInForce: order.timeInForce,
        limitPrice,
        policyRevision: order.policyRevision,
    });
    const executionPolicyHash = sha256(
        `${SMART_ORDER_BROKER_EXECUTION_POLICY_SCHEMA_VERSION}\n${canonicalJson({
            contractLimitEvidenceSha256: limits.evidenceSha256,
            categoryCode: limits.categoryCode,
            limitDown,
            limitUp,
            order: immutableOrder,
            triggerPolicyHash: request.triggerPolicyHash,
        })}`,
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_BROKER_EXECUTION_POLICY_SCHEMA_VERSION,
        candidateEligible: true,
        reason: null,
        triggerPolicySeparated: true,
        triggerPolicyHash: request.triggerPolicyHash,
        order: immutableOrder,
        contractLimitEvidenceSha256: limits.evidenceSha256,
        executionPolicyHash,
        automaticRetryAllowed: false,
        iocRemainderDisposition:
            order.timeInForce === 'IOC'
                ? 'manual_reconciliation_no_retry'
                : 'not_applicable',
        mappingVerified: false,
        brokerWriteAuthority: false,
    });
}
