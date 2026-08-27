import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_RUNTIME_READINESS_POLICY_SCHEMA_VERSION =
    'smart-order-runtime-readiness-policy/2026-08-12.1';

// This is the exact task 5.11 deny-union.  Keeping the list here prevents a
// caller from omitting a conjunct and then presenting a partial projection as
// trading readiness.
export const SMART_ORDER_RUNTIME_READINESS_CONJUNCT_IDS = Object.freeze([
    'account_reconciliation',
    'calendar',
    'canonical_pnl',
    'canonical_risk',
    'contract',
    'external_working_visibility',
    'fixed_account',
    'fresh_quote',
    'gate_manifest',
    'global_resources',
    'identity',
    'mode_api_attestation',
    'repository_integrity',
    'single_writer_fence',
    'trade_subscription',
    'unknown_intent_clear',
]);

const CONJUNCT_STATES = new Set([
    'current_verified',
    'missing',
    'stale',
    'conflict',
    'unknown',
    'invalid',
]);
const DEFAULT_MAXIMUM_AGE_MS = 10 * 60 * 1000;
const MAXIMUM_AGE_BY_CONJUNCT = Object.freeze({
    account_reconciliation: 5_000,
    canonical_pnl: 5_000,
    canonical_risk: 5_000,
    external_working_visibility: 5_000,
    fresh_quote: 5_000,
    global_resources: 5_000,
    mode_api_attestation: 5_000,
    trade_subscription: 5_000,
    unknown_intent_clear: 5_000,
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

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
        if (prototype !== Object.prototype && prototype !== null) {
            return undefined;
        }
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return undefined;
    }
    const actualKeys = Reflect.ownKeys(descriptors);
    if (actualKeys.some((key) => typeof key !== 'string')) return undefined;
    actualKeys.sort();
    const expectedKeys = [...keys].sort();
    if (
        actualKeys.length !== expectedKeys.length ||
        !actualKeys.every((key, index) => key === expectedKeys[index])
    ) {
        return undefined;
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !descriptor.enumerable ||
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

function snapshotOwnDataArray(value) {
    if (
        !Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        return undefined;
    }
    let descriptors;
    try {
        if (Object.getPrototypeOf(value) !== Array.prototype) {
            return undefined;
        }
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return undefined;
    }
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const keys = Reflect.ownKeys(descriptors);
    const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        'length',
    ].sort();
    if (
        keys.some((key) => typeof key !== 'string') ||
        keys.length !== expectedKeys.length ||
        !keys.sort().every((key, index) => key === expectedKeys[index])
    ) {
        return undefined;
    }
    const snapshot = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            return undefined;
        }
        snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
}

function digest(value) {
    return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function epoch(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function blocker(conjunctId, reason) {
    return `${conjunctId}:${reason}`;
}

function evaluateConjunct(rawConjunct, nowEpochMs) {
    const conjunct = snapshotOwnDataRecord(rawConjunct, [
        'conjunctId',
        'evidenceSha256',
        'observedAtEpochMs',
        'state',
        'validUntilEpochMs',
    ]);
    if (!conjunct) {
        return Object.freeze({ valid: false, reason: 'schema_invalid' });
    }
    if (
        !SMART_ORDER_RUNTIME_READINESS_CONJUNCT_IDS.includes(
            conjunct.conjunctId,
        ) ||
        !CONJUNCT_STATES.has(conjunct.state)
    ) {
        return Object.freeze({ valid: false, reason: 'schema_invalid' });
    }
    if (conjunct.state !== 'current_verified') {
        const nonCurrentShape =
            conjunct.evidenceSha256 === null &&
            conjunct.observedAtEpochMs === null &&
            conjunct.validUntilEpochMs === null;
        return Object.freeze({
            valid: nonCurrentShape,
            conjunctId: conjunct.conjunctId,
            reason: nonCurrentShape ? conjunct.state : 'schema_invalid',
            observedAtEpochMs: null,
            validUntilEpochMs: null,
        });
    }
    if (
        !digest(conjunct.evidenceSha256) ||
        !epoch(conjunct.observedAtEpochMs) ||
        !epoch(conjunct.validUntilEpochMs)
    ) {
        return Object.freeze({
            valid: false,
            conjunctId: conjunct.conjunctId,
            reason: 'schema_invalid',
        });
    }
    const maximumAgeMs =
        MAXIMUM_AGE_BY_CONJUNCT[conjunct.conjunctId] ??
        DEFAULT_MAXIMUM_AGE_MS;
    if (
        conjunct.observedAtEpochMs > nowEpochMs ||
        conjunct.validUntilEpochMs <= conjunct.observedAtEpochMs ||
        conjunct.validUntilEpochMs - conjunct.observedAtEpochMs >
            maximumAgeMs ||
        nowEpochMs >= conjunct.validUntilEpochMs
    ) {
        return Object.freeze({
            valid: true,
            conjunctId: conjunct.conjunctId,
            reason: 'stale',
            observedAtEpochMs: conjunct.observedAtEpochMs,
            validUntilEpochMs: conjunct.validUntilEpochMs,
        });
    }
    return Object.freeze({
        valid: true,
        conjunctId: conjunct.conjunctId,
        reason: null,
        evidenceSha256: conjunct.evidenceSha256,
        observedAtEpochMs: conjunct.observedAtEpochMs,
        validUntilEpochMs: conjunct.validUntilEpochMs,
    });
}

function projectionSha256(value) {
    return `sha256:${createHash('sha256')
        .update(canonicalJson(value))
        .digest('hex')}`;
}

/**
 * Computes a redacted task 5.11 candidate projection.  This module has no
 * production evidence issuer and therefore deliberately never returns
 * authoritative trading readiness.  Runtime integration must replace the
 * `production_readiness_authority_unintegrated` blocker with opaque,
 * repository/current-head verified conjuncts; booleans or browser JSON are
 * not authority.
 */
export function projectSmartOrderRuntimeReadinessCandidate(input) {
    const request = snapshotOwnDataRecord(input, [
        'apiGenerationSha256',
        'conjuncts',
        'health',
        'nowEpochMs',
        'runtimeEpochIdSha256',
    ]);
    if (!request) {
        throw new TypeError('readiness input schema is invalid');
    }
    const health = snapshotOwnDataRecord(request.health, [
        'processResponsive',
    ]);
    const conjuncts = snapshotOwnDataArray(request.conjuncts);
    if (
        !health ||
        typeof health.processResponsive !== 'boolean' ||
        !conjuncts ||
        !epoch(request.nowEpochMs) ||
        !digest(request.runtimeEpochIdSha256) ||
        !digest(request.apiGenerationSha256)
    ) {
        throw new TypeError('readiness input schema is invalid');
    }

    const evaluated = conjuncts.map((conjunct) =>
        evaluateConjunct(conjunct, request.nowEpochMs),
    );
    const actualIds = evaluated.map((entry) => entry.conjunctId);
    if (
        evaluated.some((entry) => !entry.valid || !entry.conjunctId) ||
        canonicalJson(actualIds) !==
            canonicalJson(SMART_ORDER_RUNTIME_READINESS_CONJUNCT_IDS)
    ) {
        throw new TypeError(
            'readiness conjuncts must be the exact canonical deny-union',
        );
    }

    const blockers = evaluated
        .filter((entry) => entry.reason !== null)
        .map((entry) => blocker(entry.conjunctId, entry.reason));
    const allConjunctsStructurallyCurrent = blockers.length === 0;
    if (!health.processResponsive) {
        blockers.push('process_health:down');
    }
    if (allConjunctsStructurallyCurrent) {
        blockers.push('production_readiness_authority_unintegrated');
    }
    const evidenceProjection = Object.freeze(
        evaluated.map((entry) =>
            Object.freeze({
                conjunctId: entry.conjunctId,
                current: entry.reason === null,
                evidenceSha256: entry.evidenceSha256 ?? null,
                observedAtEpochMs: entry.observedAtEpochMs ?? null,
                state: entry.reason ?? 'current_verified',
                validUntilEpochMs: entry.validUntilEpochMs ?? null,
            }),
        ),
    );
    const output = {
        schemaVersion: SMART_ORDER_RUNTIME_READINESS_POLICY_SCHEMA_VERSION,
        health: health.processResponsive ? 'up' : 'down',
        allConjunctsStructurallyCurrent,
        authorityIntegrated: false,
        readiness: false,
        readinessState: !health.processResponsive
            ? 'process_unresponsive'
            : allConjunctsStructurallyCurrent
              ? 'authority_unintegrated'
              : 'observe_only_blocked',
        blockers: Object.freeze(blockers),
        projectionSha256: projectionSha256({
            apiGenerationSha256: request.apiGenerationSha256,
            evidenceProjection,
            health: health.processResponsive,
            nowEpochMs: request.nowEpochMs,
            runtimeEpochIdSha256: request.runtimeEpochIdSha256,
        }),
        snapshotWatchdogAuthoritativeForReadiness: false,
        authoritativeForDispatch: false,
        writeMasterAuthority: false,
        brokerAuthority: false,
        accountIdentifiersExposed: false,
    };
    return Object.freeze(output);
}
