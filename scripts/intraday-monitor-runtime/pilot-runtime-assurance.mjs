import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const INTRADAY_MONITOR_PILOT_RUNTIME_ASSURANCE_SCHEMA =
    'intraday-monitor-pilot-runtime-assurance/1';

const HASH = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GENERATION = /^[A-Za-z0-9:_-]{8,128}$/;
const REF_KEYS = Object.freeze(['path', 'sha256']);
const CHART_KEYS = Object.freeze([
    'canonicalSymbol', 'sourceUrl', 'firstObservedAt', 'lastObservedAt',
    'freshnessMs', 'canvasCount', 'canvasWidth', 'canvasHeight',
    'beforeSha256', 'afterSha256', 'changed',
]);
const RECONNECT_KEYS = Object.freeze([
    'transport', 'attempted', 'recovered', 'clientGenerationBefore',
    'clientGenerationAfter', 'generationAdvanced', 'serverGenerationBefore',
    'serverGenerationAfter', 'cursorBefore', 'cursorAfter', 'cursorPreserved',
    'oldConnectionClosed', 'replayedEventCount', 'duplicateNotificationCount',
]);
const FEATURE_KEYS = Object.freeze([
    'chartFresh', 'watchlistHealthy', 'alertHealthy', 'smartOrderHealthy',
    'simulationRuntimeHealthy',
]);
const OPERATION_KEYS = Object.freeze([
    'methods', 'subscriptionMutations', 'notificationDispatches',
    'brokerWrites', 'productionTransitions', 'serviceLifecycleMutations',
]);
const ASSURANCE_KEYS = Object.freeze([
    'schemaVersion', 'tradeDate', 'previousTradeDate', 'observedAt',
    'simulation', 'chart', 'reconnect', 'existingFeatures',
    'regressionEvidenceRefs', 'operations', 'assuranceHash',
]);

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length &&
        actual.every((key, index) => key === expected[index]);
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validRef(value) {
    return Boolean(
        exactRecord(value, REF_KEYS) &&
        typeof value.path === 'string' &&
        value.path.length > 0 &&
        !value.path.startsWith('/') &&
        !value.path.startsWith('../') &&
        !value.path.includes('\\') &&
        HASH.test(value.sha256),
    );
}

function validLoopbackUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(url.hostname);
    } catch {
        return false;
    }
}

function validChart(value) {
    return Boolean(
        exactRecord(value, CHART_KEYS) &&
        typeof value.canonicalSymbol === 'string' &&
        /^[A-Z0-9.]{2,32}$/.test(value.canonicalSymbol) &&
        validLoopbackUrl(value.sourceUrl) &&
        validInstant(value.firstObservedAt) &&
        validInstant(value.lastObservedAt) &&
        Date.parse(value.lastObservedAt) >= Date.parse(value.firstObservedAt) &&
        safeCount(value.freshnessMs) &&
        value.freshnessMs <= 300_000 &&
        safeCount(value.canvasCount) && value.canvasCount > 0 &&
        safeCount(value.canvasWidth) && value.canvasWidth > 0 &&
        safeCount(value.canvasHeight) && value.canvasHeight > 0 &&
        HASH.test(value.beforeSha256) &&
        HASH.test(value.afterSha256) &&
        typeof value.changed === 'boolean',
    );
}

function validNullableCursor(value) {
    return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 512);
}

function validNullableGeneration(value) {
    return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 256);
}

function validReconnect(value) {
    return Boolean(
        exactRecord(value, RECONNECT_KEYS) &&
        value.transport === 'intraday-monitor-trigger-sse' &&
        value.attempted === true &&
        typeof value.recovered === 'boolean' &&
        GENERATION.test(value.clientGenerationBefore ?? '') &&
        GENERATION.test(value.clientGenerationAfter ?? '') &&
        typeof value.generationAdvanced === 'boolean' &&
        value.generationAdvanced ===
            (value.clientGenerationBefore !== value.clientGenerationAfter) &&
        validNullableGeneration(value.serverGenerationBefore) &&
        validNullableGeneration(value.serverGenerationAfter) &&
        validNullableCursor(value.cursorBefore) &&
        validNullableCursor(value.cursorAfter) &&
        typeof value.cursorPreserved === 'boolean' &&
        typeof value.oldConnectionClosed === 'boolean' &&
        safeCount(value.replayedEventCount) &&
        safeCount(value.duplicateNotificationCount) &&
        (!value.recovered || (
            value.generationAdvanced &&
            value.cursorPreserved &&
            value.oldConnectionClosed &&
            value.duplicateNotificationCount === 0
        )),
    );
}

function validFeatures(value) {
    return Boolean(
        exactRecord(value, FEATURE_KEYS) &&
        FEATURE_KEYS.every((key) => typeof value[key] === 'boolean'),
    );
}

function validOperations(value) {
    return Boolean(
        exactRecord(value, OPERATION_KEYS) &&
        Array.isArray(value.methods) &&
        value.methods.length >= 1 &&
        value.methods.length <= 8 &&
        value.methods.every((method) => typeof method === 'string' && /^[A-Z]{3,12}$/.test(method)) &&
        new Set(value.methods).size === value.methods.length &&
        value.methods.every((method, index) => index === 0 || value.methods[index - 1] < method) &&
        ['subscriptionMutations', 'notificationDispatches', 'brokerWrites',
            'productionTransitions', 'serviceLifecycleMutations']
            .every((key) => safeCount(value[key])),
    );
}

function operationsAreReadOnly(value) {
    return value.methods.length === 1 && value.methods[0] === 'GET';
}

function operationsHaveNoAuthorityMutations(value) {
    return ['subscriptionMutations', 'notificationDispatches', 'brokerWrites',
        'productionTransitions', 'serviceLifecycleMutations']
        .every((key) => value[key] === 0);
}

function digest(value) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validAssurance(value) {
    if (!exactRecord(value, ASSURANCE_KEYS) ||
        value.schemaVersion !== INTRADAY_MONITOR_PILOT_RUNTIME_ASSURANCE_SCHEMA ||
        !DATE.test(value.tradeDate ?? '') ||
        !DATE.test(value.previousTradeDate ?? '') ||
        value.previousTradeDate >= value.tradeDate ||
        !validInstant(value.observedAt) ||
        value.simulation !== true ||
        !validChart(value.chart) ||
        !validReconnect(value.reconnect) ||
        !validFeatures(value.existingFeatures) ||
        !Array.isArray(value.regressionEvidenceRefs) ||
        value.regressionEvidenceRefs.length < 1 ||
        !value.regressionEvidenceRefs.every(validRef) ||
        !validOperations(value.operations) ||
        !HASH.test(value.assuranceHash ?? '')) return false;
    const seed = { ...value };
    delete seed.assuranceHash;
    return digest(seed) === value.assuranceHash;
}

export function createIntradayMonitorPilotRuntimeAssurance(input = {}) {
    const seed = {
        schemaVersion: INTRADAY_MONITOR_PILOT_RUNTIME_ASSURANCE_SCHEMA,
        tradeDate: input.tradeDate,
        previousTradeDate: input.previousTradeDate,
        observedAt: input.observedAt,
        simulation: input.simulation,
        chart: structuredClone(input.chart),
        reconnect: structuredClone(input.reconnect),
        existingFeatures: structuredClone(input.existingFeatures),
        regressionEvidenceRefs: structuredClone(input.regressionEvidenceRefs),
        operations: structuredClone(input.operations),
    };
    if (!validOperations(seed.operations)) {
        throw new TypeError('pilot runtime assurance is invalid');
    }
    const assurance = { ...seed, assuranceHash: digest(seed) };
    if (!validAssurance(assurance)) {
        throw new TypeError('pilot runtime assurance is invalid');
    }
    return Object.freeze(assurance);
}

export function validateIntradayMonitorPilotRuntimeAssurance(value) {
    const valid = validAssurance(value);
    const reasons = [];
    if (!valid) reasons.push('invalid_runtime_assurance');
    else {
        if (!value.chart.changed) reasons.push('chart_freshness_not_observed');
        if (!value.reconnect.recovered) reasons.push('reconnect_not_recovered');
        if (!Object.values(value.existingFeatures).every(Boolean)) {
            reasons.push('existing_feature_regression');
        }
        if (!operationsAreReadOnly(value.operations)) {
            reasons.push('browser_request_not_read_only');
        }
        if (value.operations.subscriptionMutations > 0) {
            reasons.push('subscription_mutation_detected');
        }
        if (!operationsHaveNoAuthorityMutations(value.operations)) {
            reasons.push('authority_mutation_detected');
        }
    }
    return Object.freeze({
        valid,
        ready: valid && reasons.length === 0,
        reasons: Object.freeze(reasons),
    });
}
