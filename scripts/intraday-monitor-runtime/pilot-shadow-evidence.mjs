import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const INTRADAY_MONITOR_PILOT_STAGE_PLAN_SCHEMA =
    'intraday-monitor-pilot-stage-plan/1';
export const INTRADAY_MONITOR_PILOT_SAMPLE_SCHEMA =
    'intraday-monitor-pilot-sample/1';
export const INTRADAY_MONITOR_PILOT_SESSION_SCHEMA =
    'intraday-monitor-pilot-session/1';
export const INTRADAY_MONITOR_PILOT_BUNDLE_SCHEMA =
    'intraday-monitor-pilot-evidence-bundle/1';

const CHANGE_ID = 'add-configurable-intraday-relative-volume-monitor';
const STAGES = new Set([20, 50, 100, 160]);
const SYMBOL = /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE = /^(?:09:(?:0[1-9]|[1-5]\d)|1[0-2]:[0-5]\d|13:(?:[0-2]\d|30))$/;
const OPAQUE = /^[A-Za-z0-9:_-]{8,128}$/;
const VERSION = /^[A-Za-z0-9:._-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const RESOURCE_BUDGET_KEYS = Object.freeze([
    'maxCpuBasisPoints',
    'maxRssBytes',
    'maxDatabaseGrowthBytes',
    'maxSseLatencyMs',
    'maxChartFreshnessMs',
]);

const PLAN_KEYS = Object.freeze([
    'schemaVersion',
    'changeId',
    'stage',
    'cohort',
    'cohortReceiptManifestHash',
    'minimumActiveMonitorCount',
    'minimumCompleteTradingDays',
    'requiredHeadroom',
    'resourceBudgets',
    'userVisibleFeatureEnabled',
    'notificationsEnabled',
    'simulationOnly',
    'providerRequestAuthority',
    'automaticSubscriptionAuthority',
    'subscriptionTransportAuthority',
    'serviceLifecycleAuthority',
    'brokerWriteAuthority',
    'createdAt',
    'planHash',
]);
const SAMPLE_INPUT_KEYS = Object.freeze([
    'capturedAt',
    'minuteKey',
    'configRevision',
    'configured',
    'eligible',
    'active',
    'waiting',
    'unknown',
    'degraded',
    'gate0EvidenceCurrent',
    'globalOwnershipComplete',
    'confirmedPhysicalUsage',
    'confirmedOtherPhysicalUsage',
    'headroom',
    'minuteEvidenceCount',
    'completeMinuteEvidenceCount',
    'triggerCount',
    'incompleteTriggerCount',
    'notificationDispatchCount',
    'duplicateNotificationCount',
    'brokerWriteAttemptCount',
    'productionTransitionCount',
    'serviceLifecycleMutationCount',
    'cpuBasisPoints',
    'rssBytes',
    'databaseBytes',
    'sseLatencyMs',
    'chartFreshnessMs',
    'connectionGeneration',
    'sourceVersion',
]);
const SAMPLE_KEYS = Object.freeze([
    'schemaVersion',
    'tradeDate',
    ...SAMPLE_INPUT_KEYS,
    'sampleHash',
]);
const SESSION_INPUT_KEYS = Object.freeze([
    'tradeDate',
    'previousTradeDate',
    'calendarSourceVersion',
    'connectionGeneration',
    'startedAt',
    'coverageStartMinute',
]);
const SESSION_FINISH_KEYS = Object.freeze([
    'endedAt',
    'coverageEndMinute',
    'replay',
    'reconnect',
    'existingFeatures',
]);
const SESSION_KEYS = Object.freeze([
    'schemaVersion',
    'stage',
    'planHash',
    'tradeDate',
    'previousTradeDate',
    'calendarSourceVersion',
    'connectionGeneration',
    'startedAt',
    'endedAt',
    'coverageStartMinute',
    'coverageEndMinute',
    'samples',
    'replay',
    'reconnect',
    'existingFeatures',
    'notificationDispatchAuthority',
    'providerRequestAuthority',
    'subscriptionTransportAuthority',
    'serviceLifecycleAuthority',
    'brokerWriteAuthority',
    'sessionHash',
]);
const REPLAY_KEYS = Object.freeze([
    'executed',
    'consistent',
    'inputHash',
    'outputHash',
    'triggerCount',
    'recomputedTriggerCount',
]);
const RECONNECT_KEYS = Object.freeze([
    'attempted',
    'recovered',
    'generationAdvanced',
]);
const EXISTING_FEATURE_KEYS = Object.freeze([
    'chartFresh',
    'watchlistHealthy',
    'alertHealthy',
    'smartOrderHealthy',
    'simulationRuntimeHealthy',
]);
const BUNDLE_KEYS = Object.freeze([
    'schemaVersion',
    'plan',
    'sessions',
    'createdAt',
    'notificationDispatchAuthority',
    'providerRequestAuthority',
    'subscriptionTransportAuthority',
    'serviceLifecycleAuthority',
    'brokerWriteAuthority',
    'bundleHash',
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return (
        actual.length === expected.length &&
        actual.every((key, index) => key === expected[index])
    );
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validDate(value) {
    return (
        typeof value === 'string' &&
        DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeCount(value) {
    return safeCount(value) && value > 0;
}

function validResourceBudgets(value) {
    return Boolean(
        exactRecord(value, RESOURCE_BUDGET_KEYS) &&
            positiveSafeCount(value.maxCpuBasisPoints) &&
            value.maxCpuBasisPoints <= 100_000 &&
            positiveSafeCount(value.maxRssBytes) &&
            safeCount(value.maxDatabaseGrowthBytes) &&
            positiveSafeCount(value.maxSseLatencyMs) &&
            value.maxSseLatencyMs <= 300_000 &&
            positiveSafeCount(value.maxChartFreshnessMs) &&
            value.maxChartFreshnessMs <= 300_000,
    );
}

function hash(value) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function withHash(seed, key) {
    return deepFreeze({ ...seed, [key]: hash(seed) });
}

function hashMatches(value, key) {
    if (!value || typeof value !== 'object' || !HASH.test(value[key])) return false;
    const seed = { ...value };
    delete seed[key];
    return hash(seed) === value[key];
}

function validPlan(value) {
    return Boolean(
        exactRecord(value, PLAN_KEYS) &&
            value.schemaVersion === INTRADAY_MONITOR_PILOT_STAGE_PLAN_SCHEMA &&
            value.changeId === CHANGE_ID &&
            STAGES.has(value.stage) &&
            Array.isArray(value.cohort) &&
            value.cohort.length >= 1 &&
            value.cohort.length <= 200 &&
            value.cohort.every((symbol) => typeof symbol === 'string' && SYMBOL.test(symbol)) &&
            new Set(value.cohort).size === value.cohort.length &&
            HASH.test(value.cohortReceiptManifestHash) &&
            safeCount(value.minimumActiveMonitorCount) &&
            value.minimumActiveMonitorCount >= 1 &&
            value.minimumActiveMonitorCount <= value.cohort.length &&
            value.minimumCompleteTradingDays === 2 &&
            value.requiredHeadroom === 40 &&
            validResourceBudgets(value.resourceBudgets) &&
            value.userVisibleFeatureEnabled === false &&
            value.notificationsEnabled === false &&
            value.simulationOnly === true &&
            value.providerRequestAuthority === false &&
            value.automaticSubscriptionAuthority === false &&
            value.subscriptionTransportAuthority === false &&
            value.serviceLifecycleAuthority === false &&
            value.brokerWriteAuthority === false &&
            validInstant(value.createdAt) &&
            hashMatches(value, 'planHash'),
    );
}

export function createIntradayMonitorPilotStagePlan({
    stage,
    cohort,
    cohortReceiptManifestHash,
    minimumActiveMonitorCount,
    resourceBudgets,
    createdAt,
} = {}) {
    const normalizedCohort = Array.isArray(cohort)
        ? cohort.map((value) => String(value).trim().toUpperCase())
        : [];
    const seed = {
        schemaVersion: INTRADAY_MONITOR_PILOT_STAGE_PLAN_SCHEMA,
        changeId: CHANGE_ID,
        stage,
        cohort: normalizedCohort,
        cohortReceiptManifestHash,
        minimumActiveMonitorCount,
        minimumCompleteTradingDays: 2,
        requiredHeadroom: 40,
        resourceBudgets: structuredClone(resourceBudgets),
        userVisibleFeatureEnabled: false,
        notificationsEnabled: false,
        simulationOnly: true,
        providerRequestAuthority: false,
        automaticSubscriptionAuthority: false,
        subscriptionTransportAuthority: false,
        serviceLifecycleAuthority: false,
        brokerWriteAuthority: false,
        createdAt,
    };
    const plan = withHash(seed, 'planHash');
    if (!validPlan(plan)) throw new TypeError('pilot stage plan is invalid');
    return plan;
}

export function validateIntradayMonitorPilotStagePlan(value) {
    const valid = validPlan(value);
    return deepFreeze({
        valid,
        reasons: valid ? [] : ['invalid_stage_plan'],
    });
}

function normalizeSample(input, tradeDate, plan) {
    if (!exactRecord(input, SAMPLE_INPUT_KEYS)) {
        throw new TypeError('pilot sample schema is invalid');
    }
    const counts = [
        'configRevision', 'configured', 'eligible', 'active', 'waiting', 'unknown',
        'degraded', 'minuteEvidenceCount', 'completeMinuteEvidenceCount',
        'triggerCount', 'incompleteTriggerCount', 'notificationDispatchCount',
        'duplicateNotificationCount', 'brokerWriteAttemptCount',
        'productionTransitionCount', 'serviceLifecycleMutationCount', 'rssBytes',
        'databaseBytes',
    ];
    if (
        !validInstant(input.capturedAt) ||
        !input.capturedAt.startsWith(tradeDate) ||
        typeof input.minuteKey !== 'string' ||
        !MINUTE.test(input.minuteKey) ||
        counts.some((key) => !safeCount(input[key])) ||
        input.configured !== plan.cohort.length ||
        input.eligible > input.configured ||
        input.active > input.eligible ||
        input.waiting > input.configured ||
        input.unknown > input.configured ||
        input.degraded > input.configured ||
        input.completeMinuteEvidenceCount > input.minuteEvidenceCount ||
        input.incompleteTriggerCount > input.triggerCount ||
        typeof input.gate0EvidenceCurrent !== 'boolean' ||
        input.globalOwnershipComplete !== null ||
        input.confirmedPhysicalUsage !== null ||
        input.confirmedOtherPhysicalUsage !== null ||
        input.headroom !== null ||
        !safeCount(input.cpuBasisPoints) ||
        input.cpuBasisPoints > 100_000 ||
        !safeCount(input.sseLatencyMs) ||
        input.sseLatencyMs > 300_000 ||
        !safeCount(input.chartFreshnessMs) ||
        input.chartFreshnessMs > 300_000 ||
        typeof input.connectionGeneration !== 'string' ||
        !OPAQUE.test(input.connectionGeneration) ||
        typeof input.sourceVersion !== 'string' ||
        !VERSION.test(input.sourceVersion)
    ) {
        throw new TypeError('pilot sample is invalid');
    }
    return withHash(
        {
            schemaVersion: INTRADAY_MONITOR_PILOT_SAMPLE_SCHEMA,
            tradeDate,
            ...structuredClone(input),
        },
        'sampleHash',
    );
}

function validSample(value, tradeDate, plan) {
    if (
        !exactRecord(value, SAMPLE_KEYS) ||
        value.schemaVersion !== INTRADAY_MONITOR_PILOT_SAMPLE_SCHEMA ||
        value.tradeDate !== tradeDate ||
        !hashMatches(value, 'sampleHash')
    ) {
        return false;
    }
    try {
        const input = { ...value };
        delete input.schemaVersion;
        delete input.tradeDate;
        delete input.sampleHash;
        normalizeSample(input, tradeDate, plan);
        return true;
    } catch {
        return false;
    }
}

function validReplay(value) {
    return Boolean(
        exactRecord(value, REPLAY_KEYS) &&
            typeof value.executed === 'boolean' &&
            typeof value.consistent === 'boolean' &&
            (value.inputHash === null || HASH.test(value.inputHash)) &&
            (value.outputHash === null || HASH.test(value.outputHash)) &&
            safeCount(value.triggerCount) &&
            safeCount(value.recomputedTriggerCount),
    );
}

function validReconnect(value) {
    return Boolean(
        exactRecord(value, RECONNECT_KEYS) &&
            typeof value.attempted === 'boolean' &&
            typeof value.recovered === 'boolean' &&
            typeof value.generationAdvanced === 'boolean' &&
            (!value.recovered || value.attempted) &&
            (!value.generationAdvanced || value.recovered),
    );
}

function validExistingFeatures(value) {
    return Boolean(
        exactRecord(value, EXISTING_FEATURE_KEYS) &&
            EXISTING_FEATURE_KEYS.every((key) => typeof value[key] === 'boolean'),
    );
}

function validSession(value, plan) {
    return Boolean(
        exactRecord(value, SESSION_KEYS) &&
            value.schemaVersion === INTRADAY_MONITOR_PILOT_SESSION_SCHEMA &&
            value.stage === plan.stage &&
            value.planHash === plan.planHash &&
            validDate(value.tradeDate) &&
            validDate(value.previousTradeDate) &&
            value.previousTradeDate < value.tradeDate &&
            typeof value.calendarSourceVersion === 'string' &&
            VERSION.test(value.calendarSourceVersion) &&
            typeof value.connectionGeneration === 'string' &&
            OPAQUE.test(value.connectionGeneration) &&
            validInstant(value.startedAt) &&
            validInstant(value.endedAt) &&
            value.startedAt.startsWith(value.tradeDate) &&
            value.endedAt.startsWith(value.tradeDate) &&
            Date.parse(value.endedAt) > Date.parse(value.startedAt) &&
            typeof value.coverageStartMinute === 'string' &&
            MINUTE.test(value.coverageStartMinute) &&
            typeof value.coverageEndMinute === 'string' &&
            MINUTE.test(value.coverageEndMinute) &&
            value.coverageStartMinute <= value.coverageEndMinute &&
            Array.isArray(value.samples) &&
            value.samples.length > 0 &&
            value.samples.length <= 10_000 &&
            value.samples.every((sample) => validSample(sample, value.tradeDate, plan)) &&
            value.samples.every(
                (sample, index) =>
                    index === 0 ||
                    (Date.parse(sample.capturedAt) > Date.parse(value.samples[index - 1].capturedAt) &&
                        sample.minuteKey >= value.samples[index - 1].minuteKey),
            ) &&
            validReplay(value.replay) &&
            validReconnect(value.reconnect) &&
            validExistingFeatures(value.existingFeatures) &&
            value.notificationDispatchAuthority === false &&
            value.providerRequestAuthority === false &&
            value.subscriptionTransportAuthority === false &&
            value.serviceLifecycleAuthority === false &&
            value.brokerWriteAuthority === false &&
            hashMatches(value, 'sessionHash'),
    );
}

export function createIntradayMonitorPilotShadowRecorder({ plan, session } = {}) {
    if (!validPlan(plan) || !exactRecord(session, SESSION_INPUT_KEYS)) {
        throw new TypeError('pilot recorder input is invalid');
    }
    if (
        !validDate(session.tradeDate) ||
        !validDate(session.previousTradeDate) ||
        session.previousTradeDate >= session.tradeDate ||
        typeof session.calendarSourceVersion !== 'string' ||
        !VERSION.test(session.calendarSourceVersion) ||
        typeof session.connectionGeneration !== 'string' ||
        !OPAQUE.test(session.connectionGeneration) ||
        !validInstant(session.startedAt) ||
        !session.startedAt.startsWith(session.tradeDate) ||
        typeof session.coverageStartMinute !== 'string' ||
        !MINUTE.test(session.coverageStartMinute)
    ) {
        throw new TypeError('pilot recorder session is invalid');
    }
    const samples = [];
    let finished = false;

    function recordSample(input) {
        if (finished) throw new Error('pilot recorder is finished');
        const sample = normalizeSample(input, session.tradeDate, plan);
        const previous = samples.at(-1);
        if (
            previous &&
            (Date.parse(sample.capturedAt) <= Date.parse(previous.capturedAt) ||
                sample.minuteKey < previous.minuteKey)
        ) {
            throw new TypeError('pilot sample order is invalid');
        }
        if (samples.length >= 10_000) throw new RangeError('pilot sample limit exceeded');
        samples.push(sample);
        return sample;
    }

    function finish(input) {
        if (finished) throw new Error('pilot recorder is finished');
        if (!exactRecord(input, SESSION_FINISH_KEYS) || samples.length === 0) {
            throw new TypeError('pilot session finish input is invalid');
        }
        if (
            !validInstant(input.endedAt) ||
            !input.endedAt.startsWith(session.tradeDate) ||
            Date.parse(input.endedAt) <= Date.parse(session.startedAt) ||
            typeof input.coverageEndMinute !== 'string' ||
            !MINUTE.test(input.coverageEndMinute) ||
            input.coverageEndMinute < session.coverageStartMinute ||
            !validReplay(input.replay) ||
            !validReconnect(input.reconnect) ||
            !validExistingFeatures(input.existingFeatures)
        ) {
            throw new TypeError('pilot session finish input is invalid');
        }
        finished = true;
        const evidence = withHash(
            {
                schemaVersion: INTRADAY_MONITOR_PILOT_SESSION_SCHEMA,
                stage: plan.stage,
                planHash: plan.planHash,
                tradeDate: session.tradeDate,
                previousTradeDate: session.previousTradeDate,
                calendarSourceVersion: session.calendarSourceVersion,
                connectionGeneration: session.connectionGeneration,
                startedAt: session.startedAt,
                endedAt: input.endedAt,
                coverageStartMinute: session.coverageStartMinute,
                coverageEndMinute: input.coverageEndMinute,
                samples: [...samples],
                replay: structuredClone(input.replay),
                reconnect: structuredClone(input.reconnect),
                existingFeatures: structuredClone(input.existingFeatures),
                notificationDispatchAuthority: false,
                providerRequestAuthority: false,
                subscriptionTransportAuthority: false,
                serviceLifecycleAuthority: false,
                brokerWriteAuthority: false,
            },
            'sessionHash',
        );
        if (!validSession(evidence, plan)) {
            throw new TypeError('pilot session evidence is invalid');
        }
        return evidence;
    }

    return Object.freeze({
        recordSample,
        finish,
        status: () => deepFreeze({
            finished,
            sampleCount: samples.length,
            providerRequestAuthority: false,
            subscriptionTransportAuthority: false,
            serviceLifecycleAuthority: false,
            brokerWriteAuthority: false,
        }),
    });
}

function validBundle(value) {
    return Boolean(
        exactRecord(value, BUNDLE_KEYS) &&
            value.schemaVersion === INTRADAY_MONITOR_PILOT_BUNDLE_SCHEMA &&
            validPlan(value.plan) &&
            Array.isArray(value.sessions) &&
            value.sessions.length <= 16 &&
            value.sessions.every((session) => validSession(session, value.plan)) &&
            value.sessions.every(
                (session, index) =>
                    index === 0 ||
                    session.tradeDate > value.sessions[index - 1].tradeDate,
            ) &&
            validInstant(value.createdAt) &&
            value.notificationDispatchAuthority === false &&
            value.providerRequestAuthority === false &&
            value.subscriptionTransportAuthority === false &&
            value.serviceLifecycleAuthority === false &&
            value.brokerWriteAuthority === false &&
            hashMatches(value, 'bundleHash'),
    );
}

export function createIntradayMonitorPilotEvidenceBundle({ plan, sessions, createdAt } = {}) {
    if (
        !validPlan(plan) ||
        !Array.isArray(sessions) ||
        sessions.length > 16 ||
        sessions.some((session) => !validSession(session, plan)) ||
        sessions.some(
            (session, index) =>
                index > 0 && session.tradeDate <= sessions[index - 1].tradeDate,
        ) ||
        !validInstant(createdAt)
    ) {
        throw new TypeError('pilot evidence bundle input is invalid');
    }
    return withHash(
        {
            schemaVersion: INTRADAY_MONITOR_PILOT_BUNDLE_SCHEMA,
            plan,
            sessions: [...sessions],
            createdAt,
            notificationDispatchAuthority: false,
            providerRequestAuthority: false,
            subscriptionTransportAuthority: false,
            serviceLifecycleAuthority: false,
            brokerWriteAuthority: false,
        },
        'bundleHash',
    );
}

export function validateIntradayMonitorPilotEvidenceBundle(value) {
    if (!validBundle(value)) {
        return deepFreeze({
            valid: false,
            readyForHumanReview: false,
            reasons: ['invalid_bundle'],
            metrics: null,
        });
    }
    const reasons = new Set();
    const completeDates = new Set();
    let reconnectVerified = false;
    let maxCpuBasisPoints = 0;
    let maxRssBytes = 0;
    let maxDatabaseBytes = 0;
    let maxDatabaseGrowthBytes = 0;
    let maxSseLatencyMs = 0;
    let maxChartFreshnessMs = 0;

    for (const session of value.sessions) {
        if (
            session.coverageStartMinute <= '09:01' &&
            session.coverageEndMinute >= '13:30'
        ) {
            completeDates.add(session.tradeDate);
        }
        if (
            !session.replay.executed ||
            !session.replay.consistent ||
            session.replay.triggerCount !== session.replay.recomputedTriggerCount ||
            !HASH.test(session.replay.inputHash ?? '') ||
            !HASH.test(session.replay.outputHash ?? '')
        ) {
            reasons.add('replay_not_reproducible');
        }
        if (
            session.reconnect.attempted &&
            session.reconnect.recovered &&
            session.reconnect.generationAdvanced
        ) {
            reconnectVerified = true;
        }
        if (!Object.values(session.existingFeatures).every(Boolean)) {
            reasons.add('existing_feature_regression');
        }
        for (const sample of session.samples) {
            if (!sample.gate0EvidenceCurrent) reasons.add('gate0_evidence_not_current');
            if (
                sample.configured !== value.plan.cohort.length ||
                sample.eligible < value.plan.minimumActiveMonitorCount ||
                sample.active < value.plan.minimumActiveMonitorCount ||
                sample.degraded > 0
            ) {
                reasons.add('stage_not_fully_active');
            }
            if (sample.incompleteTriggerCount > 0) reasons.add('incomplete_data_triggered');
            if (sample.notificationDispatchCount > 0) reasons.add('notification_dispatch_not_zero');
            if (sample.duplicateNotificationCount > 0) reasons.add('duplicate_notification');
            if (sample.brokerWriteAttemptCount > 0) reasons.add('broker_write_attempted');
            if (sample.productionTransitionCount > 0) reasons.add('production_transition_detected');
            if (sample.serviceLifecycleMutationCount > 0) reasons.add('service_lifecycle_mutation_detected');
            if (sample.cpuBasisPoints > value.plan.resourceBudgets.maxCpuBasisPoints) {
                reasons.add('cpu_budget_exceeded');
            }
            if (sample.rssBytes > value.plan.resourceBudgets.maxRssBytes) {
                reasons.add('rss_budget_exceeded');
            }
            if (sample.sseLatencyMs > value.plan.resourceBudgets.maxSseLatencyMs) {
                reasons.add('sse_latency_budget_exceeded');
            }
            if (sample.chartFreshnessMs > value.plan.resourceBudgets.maxChartFreshnessMs) {
                reasons.add('chart_freshness_budget_exceeded');
            }
            maxCpuBasisPoints = Math.max(maxCpuBasisPoints, sample.cpuBasisPoints);
            maxRssBytes = Math.max(maxRssBytes, sample.rssBytes);
            maxDatabaseBytes = Math.max(maxDatabaseBytes, sample.databaseBytes);
            maxSseLatencyMs = Math.max(maxSseLatencyMs, sample.sseLatencyMs);
            maxChartFreshnessMs = Math.max(maxChartFreshnessMs, sample.chartFreshnessMs);
        }
        const databaseValues = session.samples.map((sample) => sample.databaseBytes);
        const databaseGrowthBytes = Math.max(...databaseValues) - Math.min(...databaseValues);
        maxDatabaseGrowthBytes = Math.max(maxDatabaseGrowthBytes, databaseGrowthBytes);
        if (databaseGrowthBytes > value.plan.resourceBudgets.maxDatabaseGrowthBytes) {
            reasons.add('database_growth_budget_exceeded');
        }
        const finalSample = session.samples.at(-1);
        const expectedMinuteEvidence =
            Math.max(...session.samples.map((sample) => sample.active)) * 270;
        if (
            finalSample.minuteKey !== '13:30' ||
            finalSample.minuteEvidenceCount < expectedMinuteEvidence ||
            finalSample.completeMinuteEvidenceCount !==
                finalSample.minuteEvidenceCount
        ) {
            reasons.add('minute_evidence_incomplete');
        }
        if (finalSample.triggerCount !== session.replay.triggerCount) {
            reasons.add('replay_trigger_count_mismatch');
        }
    }
    if (completeDates.size < value.plan.minimumCompleteTradingDays) {
        reasons.add('insufficient_complete_trading_days');
    }
    if (!reconnectVerified) reasons.add('reconnect_evidence_missing');
    return deepFreeze({
        valid: true,
        readyForHumanReview: reasons.size === 0,
        reasons: [...reasons].sort(),
        metrics: {
            stage: value.plan.stage,
            configuredMonitorCount: value.plan.cohort.length,
            minimumActiveMonitorCount: value.plan.minimumActiveMonitorCount,
            resourceBudgets: value.plan.resourceBudgets,
            completeTradingDays: completeDates.size,
            sessionCount: value.sessions.length,
            sampleCount: value.sessions.reduce(
                (total, session) => total + session.samples.length,
                0,
            ),
            providerPhysicalUsage: null,
            providerHeadroom: null,
            maxCpuBasisPoints,
            maxRssBytes,
            maxDatabaseBytes,
            maxDatabaseGrowthBytes,
            maxSseLatencyMs,
            maxChartFreshnessMs,
            reconnectVerified,
        },
    });
}
