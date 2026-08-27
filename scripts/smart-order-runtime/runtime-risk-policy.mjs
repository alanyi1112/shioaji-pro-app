import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION } from './protected-entry-contract.mjs';

export const SMART_ORDER_RUNTIME_RISK_POLICY_SCHEMA_VERSION =
    'smart-order-runtime-risk-policy/2026-08-14.1';
export const SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION =
    'smart-order-runtime-risk-policy-editor/2026-08-14.1';

export const SMART_ORDER_RUNTIME_RISK_DIMENSIONS = Object.freeze([
    'quantityShares',
    'notionalMinorUnits',
    'cashMinorUnits',
    'positionShares',
    'orderCount',
]);

function invalid(message) {
    throw new TypeError(`runtime risk policy is invalid: ${message}`);
}

function snapshot(value, label, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object') return value;
    if (utilTypes.isProxy(value) || seen.has(value)) {
        invalid(`${label} must be an acyclic non-Proxy data structure`);
    }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== 'string')) {
        invalid(`${label} must not contain symbols`);
    }
    if (Array.isArray(value)) {
        const expected = [
            ...Array.from({ length: value.length }, (_, index) => String(index)),
            'length',
        ];
        if (
            ownKeys.length !== expected.length ||
            ownKeys.some((key, index) => key !== expected[index])
        ) {
            invalid(`${label} must be a dense array without extra fields`);
        }
        const result = Array.from({ length: value.length }, (_, index) => {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                invalid(`${label}[${index}] must be an own data property`);
            }
            return snapshot(descriptor.value, `${label}[${index}]`, seen);
        });
        seen.delete(value);
        return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        invalid(`${label} must be a plain data object`);
    }
    const result = Object.create(null);
    for (const key of ownKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            invalid(`${label}.${key} must be an enumerable own data property`);
        }
        result[key] = snapshot(descriptor.value, `${label}.${key}`, seen);
    }
    seen.delete(value);
    return Object.freeze(result);
}

function exact(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        JSON.stringify(Object.keys(value).sort()) !==
            JSON.stringify([...keys].sort())
    ) {
        invalid(`${label} fields do not match the versioned schema`);
    }
    return value;
}

function nonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        invalid(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function limitVector(value, label) {
    const record = exact(value, SMART_ORDER_RUNTIME_RISK_DIMENSIONS, label);
    return Object.freeze(
        Object.fromEntries(
            SMART_ORDER_RUNTIME_RISK_DIMENSIONS.map((dimension) => {
                const limit = record[dimension];
                if (limit === null) return [dimension, null];
                return [
                    dimension,
                    nonNegativeInteger(limit, `${label}.${dimension}`),
                ];
            }),
        ),
    );
}

export function canonicalRuntimeRiskPolicyEditorInput(candidate) {
    const input = snapshot(candidate, 'editor');
    const record = exact(
        input,
        [
            'accountDailyLossLimitMinorUnits',
            'accountLimits',
            'buyFeeBps',
            'cashBufferMinorUnits',
            'identityDailyLossLimitMinorUnits',
            'identityLimits',
            'minimumBuyFeeMinorUnits',
            'schemaVersion',
        ],
        'editor',
    );
    if (
        record.schemaVersion !==
        SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION
    ) {
        invalid('editor.schemaVersion is unsupported');
    }
    const accountLimits = limitVector(record.accountLimits, 'accountLimits');
    const identityLimits = limitVector(record.identityLimits, 'identityLimits');
    const reservedDimensions = SMART_ORDER_RUNTIME_RISK_DIMENSIONS.filter(
        (dimension) => {
            const accountEnabled = accountLimits[dimension] !== null;
            const identityEnabled = identityLimits[dimension] !== null;
            if (accountEnabled !== identityEnabled) {
                invalid(
                    `${dimension} must be enabled or disabled at both account and identity scopes`,
                );
            }
            return accountEnabled;
        },
    );
    if (reservedDimensions.length === 0) {
        invalid('at least one exposure dimension must be reserved');
    }
    const buyFeeBps = nonNegativeInteger(record.buyFeeBps, 'buyFeeBps');
    if (buyFeeBps > 10_000) invalid('buyFeeBps must not exceed 10000');
    return Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION,
        buyFeeBps,
        minimumBuyFeeMinorUnits: nonNegativeInteger(
            record.minimumBuyFeeMinorUnits,
            'minimumBuyFeeMinorUnits',
        ),
        cashBufferMinorUnits: nonNegativeInteger(
            record.cashBufferMinorUnits,
            'cashBufferMinorUnits',
        ),
        accountLimits,
        identityLimits,
        accountDailyLossLimitMinorUnits: nonNegativeInteger(
            record.accountDailyLossLimitMinorUnits,
            'accountDailyLossLimitMinorUnits',
        ),
        identityDailyLossLimitMinorUnits: nonNegativeInteger(
            record.identityDailyLossLimitMinorUnits,
            'identityDailyLossLimitMinorUnits',
        ),
        reservedDimensions: Object.freeze(reservedDimensions),
    });
}

export function materializeRuntimeRiskPolicy(candidate, revision) {
    const editor = canonicalRuntimeRiskPolicyEditorInput(candidate);
    if (!Number.isSafeInteger(revision) || revision < 0) {
        invalid('revision must be a non-negative safe integer');
    }
    const policyRevision = `${SMART_ORDER_RUNTIME_RISK_POLICY_SCHEMA_VERSION}:${revision}`;
    const executionPolicy = Object.freeze({
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
        policyRevision,
        buyFeeBps: editor.buyFeeBps,
        minimumBuyFeeMinorUnits: editor.minimumBuyFeeMinorUnits,
        cashBufferMinorUnits: editor.cashBufferMinorUnits,
    });
    const executionPolicyJson = canonicalJson(executionPolicy);
    const executionPolicyHash = `sha256:${createHash('sha256')
        .update(executionPolicyJson)
        .digest('hex')}`;
    const policy = Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_RISK_POLICY_SCHEMA_VERSION,
        revision,
        policyRevision,
        executionPolicy,
        reservedDimensions: editor.reservedDimensions,
        accountLimits: editor.accountLimits,
        identityLimits: editor.identityLimits,
        accountDailyLossLimitMinorUnits:
            editor.accountDailyLossLimitMinorUnits,
        identityDailyLossLimitMinorUnits:
            editor.identityDailyLossLimitMinorUnits,
    });
    const policyJson = canonicalJson(policy);
    return Object.freeze({
        policy,
        policyJson,
        policyHash: `sha256:${createHash('sha256')
            .update(policyJson)
            .digest('hex')}`,
        policyRevision,
        executionPolicy,
        executionPolicyHash,
    });
}

export function revalidateRuntimeRiskPolicy(candidate) {
    const policy = snapshot(candidate, 'policy');
    const record = exact(
        policy,
        [
            'accountDailyLossLimitMinorUnits',
            'accountLimits',
            'executionPolicy',
            'identityDailyLossLimitMinorUnits',
            'identityLimits',
            'policyRevision',
            'reservedDimensions',
            'revision',
            'schemaVersion',
        ],
        'policy',
    );
    if (record.schemaVersion !== SMART_ORDER_RUNTIME_RISK_POLICY_SCHEMA_VERSION) {
        invalid('policy.schemaVersion is unsupported');
    }
    const execution = exact(
        record.executionPolicy,
        [
            'buyFeeBps',
            'cashBufferMinorUnits',
            'minimumBuyFeeMinorUnits',
            'policyRevision',
            'schemaVersion',
        ],
        'policy.executionPolicy',
    );
    const materialized = materializeRuntimeRiskPolicy(
        {
            schemaVersion: SMART_ORDER_RUNTIME_RISK_POLICY_EDITOR_SCHEMA_VERSION,
            buyFeeBps: execution.buyFeeBps,
            minimumBuyFeeMinorUnits: execution.minimumBuyFeeMinorUnits,
            cashBufferMinorUnits: execution.cashBufferMinorUnits,
            accountLimits: record.accountLimits,
            identityLimits: record.identityLimits,
            accountDailyLossLimitMinorUnits:
                record.accountDailyLossLimitMinorUnits,
            identityDailyLossLimitMinorUnits:
                record.identityDailyLossLimitMinorUnits,
        },
        record.revision,
    );
    if (
        materialized.policyRevision !== record.policyRevision ||
        canonicalJson(materialized.policy) !== canonicalJson(record) ||
        canonicalJson(record.reservedDimensions) !==
            canonicalJson(materialized.policy.reservedDimensions)
    ) {
        invalid('policy does not match its canonical revision and projection');
    }
    return materialized;
}
