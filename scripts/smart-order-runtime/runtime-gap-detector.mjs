import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION =
    'smart-order-runtime-gap-detector/2026-08-13.3';
export const SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION =
    'smart-order-runtime-gap-observation/2026-08-12.1';
export const SMART_ORDER_RUNTIME_GAP_SIGNAL_SCHEMA_VERSION =
    'smart-order-runtime-gap-signal/2026-08-12.1';
export const SMART_ORDER_RUNTIME_GAP_POLICY_VERSION =
    'smart-order-runtime-gap-policy/2026-08-12.1';
export const SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION =
    'smart-order-runtime-gap-invalidation/2026-08-13.3';

export const SMART_ORDER_RUNTIME_GAP_REASON_CODES = Object.freeze([
    'API_GENERATION_GAP',
    'EVENT_LOOP_PAUSE_GAP',
    'RUNTIME_GAP_INPUT_INVALID',
    'SLEEP_WAKE_GAP',
    'SSE_CURSOR_GAP',
    'SSE_EPOCH_GAP',
    'SSE_SEQUENCE_GAP',
    'SSE_STREAM_BASELINE_MISSING',
    'WALL_CLOCK_JUMP_GAP',
]);

const REASON_CODE_SET = new Set(SMART_ORDER_RUNTIME_GAP_REASON_CODES);
const CONTINUITY_MODES = new Set([
    'epoch_only',
    'gate_verified_sequence',
    'runtime_cursor_chain',
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GLOBAL_SCOPE_SHA256 = sha256('runtime-gap-scope\u001fglobal');
const VERSIONED_MAXIMUM_EVENT_LOOP_PAUSE_MS = 5_000;
const VERSIONED_MAXIMUM_WALL_CLOCK_JUMP_MS = 2_000;
const VERSIONED_MAXIMUM_TRACKED_SSE_STREAMS = 256;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function exactObject(value, requiredKeys) {
    return Boolean(
        value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            canonicalJson(Object.keys(value).sort()) ===
                canonicalJson([...requiredKeys].sort()),
    );
}

function boundedToken(value, label, maximumLength = 512) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumLength ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function nonNegativeSafeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function positiveSafeInteger(value, label, maximum) {
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > maximum
    ) {
        throw new TypeError(`${label} must be a positive bounded safe integer`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
        throw new TypeError(`${label} must be a sha256 digest`);
    }
    return value;
}

function canonicalSequence(value, label) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 128 ||
        !/^(?:0|[1-9]\d*)$/.test(value)
    ) {
        throw new TypeError(`${label} must be a canonical unsigned integer string`);
    }
    return value;
}

function nullableToken(value, label) {
    return value === null ? null : boundedToken(value, label);
}

function nullableSequence(value, label) {
    return value === null ? null : canonicalSequence(value, label);
}

function policyUnsigned({
    eventLoopPauseThresholdMs,
    wallClockJumpThresholdMs,
    maximumTrackedSseStreams,
}) {
    return {
        schemaVersion: SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
        eventLoopPauseThresholdMs: positiveSafeInteger(
            eventLoopPauseThresholdMs,
            'eventLoopPauseThresholdMs',
            VERSIONED_MAXIMUM_EVENT_LOOP_PAUSE_MS,
        ),
        wallClockJumpThresholdMs: positiveSafeInteger(
            wallClockJumpThresholdMs,
            'wallClockJumpThresholdMs',
            VERSIONED_MAXIMUM_WALL_CLOCK_JUMP_MS,
        ),
        maximumTrackedSseStreams: positiveSafeInteger(
            maximumTrackedSseStreams,
            'maximumTrackedSseStreams',
            VERSIONED_MAXIMUM_TRACKED_SSE_STREAMS,
        ),
    };
}

function createSmartOrderRuntimeGapPolicy({
    eventLoopPauseThresholdMs = 5_000,
    wallClockJumpThresholdMs = 2_000,
    maximumTrackedSseStreams = 256,
} = {}) {
    const unsigned = policyUnsigned({
        eventLoopPauseThresholdMs,
        wallClockJumpThresholdMs,
        maximumTrackedSseStreams,
    });
    if (unsigned.wallClockJumpThresholdMs > unsigned.eventLoopPauseThresholdMs) {
        throw new TypeError(
            'wallClockJumpThresholdMs must not exceed eventLoopPauseThresholdMs',
        );
    }
    return deepFreeze({
        ...unsigned,
        policySha256: sha256(canonicalJson(unsigned)),
    });
}

export const DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY =
    createSmartOrderRuntimeGapPolicy();

function canonicalPolicy(value) {
    if (
        !exactObject(value, [
            'schemaVersion',
            'eventLoopPauseThresholdMs',
            'wallClockJumpThresholdMs',
            'maximumTrackedSseStreams',
            'policySha256',
        ]) ||
        value.schemaVersion !== SMART_ORDER_RUNTIME_GAP_POLICY_VERSION
    ) {
        throw new TypeError('runtime gap policy schema is invalid');
    }
    const normalized = createSmartOrderRuntimeGapPolicy(value);
    if (normalized.policySha256 !== value.policySha256) {
        throw new TypeError('runtime gap policy integrity is invalid');
    }
    return normalized;
}

function streamScopeSha256(streamId) {
    return sha256(`runtime-gap-scope\u001fstream\u001f${streamId}`);
}

function normalizeSseBaseline(value) {
    if (
        !exactObject(value, [
            'streamId',
            'streamEpoch',
            'continuityMode',
            'sequence',
            'cursor',
            'eventFingerprintSha256',
        ])
    ) {
        throw new TypeError('SSE baseline schema is invalid');
    }
    const streamId = boundedToken(value.streamId, 'SSE baseline streamId');
    const streamEpoch = boundedToken(
        value.streamEpoch,
        'SSE baseline streamEpoch',
    );
    if (!CONTINUITY_MODES.has(value.continuityMode)) {
        throw new TypeError('SSE baseline continuityMode is unsupported');
    }
    const sequence = nullableSequence(value.sequence, 'SSE baseline sequence');
    const cursor = nullableToken(value.cursor, 'SSE baseline cursor');
    if (
        (value.continuityMode === 'gate_verified_sequence' &&
            (sequence === null || cursor !== null)) ||
        (value.continuityMode === 'runtime_cursor_chain' &&
            (cursor === null || sequence !== null)) ||
        (value.continuityMode === 'epoch_only' &&
            (sequence !== null || cursor !== null))
    ) {
        throw new TypeError(
            'SSE baseline does not match its verified continuity contract',
        );
    }
    return deepFreeze({
        streamIdSha256: streamScopeSha256(streamId),
        streamEpochSha256: sha256(`runtime-gap-stream-epoch\u001f${streamEpoch}`),
        continuityMode: value.continuityMode,
        lastSequence: sequence,
        lastCursorSha256:
            cursor === null
                ? null
                : sha256(`runtime-gap-sse-cursor\u001f${cursor}`),
        lastEventFingerprintSha256: digest(
            value.eventFingerprintSha256,
            'SSE baseline eventFingerprintSha256',
        ),
    });
}

function unsignedState(value) {
    const {
        stateSha256: _stateSha256,
        ...unsigned
    } = value;
    return unsigned;
}

function sealState(value) {
    const unsigned = unsignedState(value);
    return deepFreeze({
        ...unsigned,
        stateSha256: sha256(canonicalJson(unsigned)),
    });
}

function assertState(value) {
    if (
        !exactObject(value, [
            'schemaVersion',
            'policy',
            'observationRevision',
            'lastObservedWallTimeMs',
            'lastObservedMonotonicTimeMs',
            'apiGenerationSha256',
            'lifecycleState',
            'sseStreams',
            'recovery',
            'stateSha256',
        ]) ||
        value.schemaVersion !== SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION
    ) {
        throw new TypeError('runtime gap detector state schema is invalid');
    }
    const policy = canonicalPolicy(value.policy);
    nonNegativeSafeInteger(value.observationRevision, 'observationRevision');
    nonNegativeSafeInteger(
        value.lastObservedWallTimeMs,
        'lastObservedWallTimeMs',
    );
    nonNegativeSafeInteger(
        value.lastObservedMonotonicTimeMs,
        'lastObservedMonotonicTimeMs',
    );
    digest(value.apiGenerationSha256, 'apiGenerationSha256');
    if (!['awake', 'sleeping'].includes(value.lifecycleState)) {
        throw new TypeError('runtime gap lifecycle state is invalid');
    }
    if (
        !Array.isArray(value.sseStreams) ||
        value.sseStreams.length > policy.maximumTrackedSseStreams
    ) {
        throw new TypeError('runtime gap SSE stream state is invalid');
    }
    let previousStreamIdSha256 = null;
    const streamScopes = new Set();
    for (const stream of value.sseStreams) {
        if (
            !exactObject(stream, [
                'streamIdSha256',
                'streamEpochSha256',
                'continuityMode',
                'lastSequence',
                'lastCursorSha256',
                'lastEventFingerprintSha256',
            ]) ||
            !CONTINUITY_MODES.has(stream.continuityMode)
        ) {
            throw new TypeError('runtime gap SSE stream entry is invalid');
        }
        digest(stream.streamIdSha256, 'streamIdSha256');
        digest(stream.streamEpochSha256, 'streamEpochSha256');
        digest(
            stream.lastEventFingerprintSha256,
            'lastEventFingerprintSha256',
        );
        const sequence = nullableSequence(
            stream.lastSequence,
            'lastSequence',
        );
        const cursorSha256 =
            stream.lastCursorSha256 === null
                ? null
                : digest(stream.lastCursorSha256, 'lastCursorSha256');
        if (
            (stream.continuityMode === 'gate_verified_sequence' &&
                (sequence === null || cursorSha256 !== null)) ||
            (stream.continuityMode === 'runtime_cursor_chain' &&
                (sequence !== null || cursorSha256 === null)) ||
            (stream.continuityMode === 'epoch_only' &&
                (sequence !== null || cursorSha256 !== null)) ||
            (previousStreamIdSha256 !== null &&
                stream.streamIdSha256 <= previousStreamIdSha256)
        ) {
            throw new TypeError('runtime gap SSE stream ordering is invalid');
        }
        previousStreamIdSha256 = stream.streamIdSha256;
        streamScopes.add(stream.streamIdSha256);
    }
    if (
        !exactObject(value.recovery, [
            'required',
            'firstDetectedRevision',
            'reasons',
            'signal',
        ]) ||
        typeof value.recovery.required !== 'boolean' ||
        !Array.isArray(value.recovery.reasons)
    ) {
        throw new TypeError('runtime gap recovery state is invalid');
    }
    const maximumReasons =
        SMART_ORDER_RUNTIME_GAP_REASON_CODES.length +
        value.sseStreams.length * 3;
    if (value.recovery.reasons.length > maximumReasons) {
        throw new TypeError('runtime gap recovery reasons exceed their bound');
    }
    let previousReasonIdentity = null;
    let earliestReasonRevision = null;
    for (const entry of value.recovery.reasons) {
        if (
            !exactObject(entry, [
                'code',
                'firstDetectedRevision',
                'scopeSha256',
                'evidenceSha256',
            ]) ||
            !REASON_CODE_SET.has(entry.code)
        ) {
            throw new TypeError('runtime gap recovery reason is invalid');
        }
        const revision = nonNegativeSafeInteger(
            entry.firstDetectedRevision,
            'firstDetectedRevision',
        );
        if (revision < 1 || revision > value.observationRevision) {
            throw new TypeError('runtime gap recovery reason revision is invalid');
        }
        digest(entry.scopeSha256, 'scopeSha256');
        digest(entry.evidenceSha256, 'evidenceSha256');
        if (
            entry.scopeSha256 !== GLOBAL_SCOPE_SHA256 &&
            !streamScopes.has(entry.scopeSha256)
        ) {
            throw new TypeError('runtime gap recovery reason scope is invalid');
        }
        const identity = `${entry.code}\u001f${entry.scopeSha256}`;
        if (previousReasonIdentity !== null && identity <= previousReasonIdentity) {
            throw new TypeError('runtime gap recovery reason ordering is invalid');
        }
        previousReasonIdentity = identity;
        earliestReasonRevision =
            earliestReasonRevision === null
                ? revision
                : Math.min(earliestReasonRevision, revision);
    }
    if (value.recovery.required) {
        if (
            value.recovery.reasons.length === 0 ||
            value.recovery.firstDetectedRevision !== earliestReasonRevision ||
            value.recovery.signal === null ||
            canonicalJson(value.recovery.signal) !==
                canonicalJson(buildSignal(value.recovery.reasons))
        ) {
            throw new TypeError('runtime gap recovery latch is inconsistent');
        }
    } else if (
        value.recovery.reasons.length !== 0 ||
        value.recovery.firstDetectedRevision !== null ||
        value.recovery.signal !== null
    ) {
        throw new TypeError('runtime gap clear state is inconsistent');
    }
    if (sha256(canonicalJson(unsignedState(value))) !== value.stateSha256) {
        throw new TypeError('runtime gap detector state integrity is invalid');
    }
    return value;
}

function buildSignal(reasons) {
    if (reasons.length === 0) return null;
    const reasonCodes = [...new Set(reasons.map((reason) => reason.code))].sort();
    const apiGenerationGap = reasonCodes.includes('API_GENERATION_GAP');
    const signal = {
        schemaVersion: SMART_ORDER_RUNTIME_GAP_SIGNAL_SCHEMA_VERSION,
        signalType: 'runtime_recovery_reconcile_required',
        dispatchReadiness: 'blocked_by_continuity_gap',
        runtimeTransitionReasonCodes: [
            ...(apiGenerationGap ? ['RUNTIME_API_GENERATION_SUPERSEDED'] : []),
            'RUNTIME_RECONCILIATION_REQUIRED',
        ],
        modeTransitionReasonCodes: apiGenerationGap
            ? ['MODE_GENERATION_CHANGED']
            : [],
        strategyTransitionReasonCode:
            'READINESS_LOST_RECONCILIATION_REQUIRED',
        requiredReconciliationDomains: [
            'calendar',
            'mode_generation',
            'orders',
            'positions',
            'reservations',
            'subscriptions',
        ],
        userRearmRequiredAfterReconciliation: true,
        reasonCodes,
        reasons,
    };
    return deepFreeze({
        ...signal,
        signalSha256: sha256(canonicalJson(signal)),
    });
}

function reason({ code, revision, scopeSha256, evidence }) {
    if (!REASON_CODE_SET.has(code)) {
        throw new TypeError('runtime gap reason code is not allowlisted');
    }
    return deepFreeze({
        code,
        firstDetectedRevision: revision,
        scopeSha256,
        evidenceSha256: sha256(canonicalJson(evidence)),
    });
}

function mergeReasons(existing, additions) {
    const byIdentity = new Map();
    for (const candidate of [...existing, ...additions]) {
        const identity = `${candidate.code}\u001f${candidate.scopeSha256}`;
        if (!byIdentity.has(identity)) byIdentity.set(identity, candidate);
    }
    return [...byIdentity.values()].sort((left, right) =>
        `${left.code}\u001f${left.scopeSha256}`.localeCompare(
            `${right.code}\u001f${right.scopeSha256}`,
        ),
    );
}

function finalizeObservation(state, {
    updates = {},
    additions = [],
    classification = 'continuous',
} = {}) {
    const observationRevision = state.observationRevision + 1;
    const stamped = additions.map((candidate) =>
        reason({ ...candidate, revision: observationRevision }),
    );
    const reasons = mergeReasons(state.recovery.reasons, stamped);
    const recoverySignal = buildSignal(reasons);
    const nextState = sealState({
        ...unsignedState(state),
        ...updates,
        observationRevision,
        recovery: {
            required: reasons.length > 0,
            firstDetectedRevision:
                state.recovery.firstDetectedRevision ??
                (reasons.length > 0 ? observationRevision : null),
            reasons,
            signal: recoverySignal,
        },
    });
    const effectiveClassification = recoverySignal
        ? 'recovery_required'
        : classification;
    return deepFreeze({
        classification: effectiveClassification,
        newlyDetectedReasonCodes: [...new Set(stamped.map((entry) => entry.code))].sort(),
        state: nextState,
        signal: recoverySignal,
    });
}

function createSmartOrderRuntimeGapDetectorState({
    policy = DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY,
    observedWallTimeMs,
    observedMonotonicTimeMs,
    apiGeneration,
    sseBaselines = [],
}) {
    const canonical = canonicalPolicy(policy);
    const wallTime = nonNegativeSafeInteger(
        observedWallTimeMs,
        'observedWallTimeMs',
    );
    const monotonicTime = nonNegativeSafeInteger(
        observedMonotonicTimeMs,
        'observedMonotonicTimeMs',
    );
    const generation = boundedToken(apiGeneration, 'apiGeneration');
    if (!Array.isArray(sseBaselines)) {
        throw new TypeError('sseBaselines must be an array');
    }
    if (sseBaselines.length > canonical.maximumTrackedSseStreams) {
        throw new RangeError('sseBaselines exceed the versioned stream limit');
    }
    const streams = sseBaselines.map(normalizeSseBaseline).sort((left, right) =>
        left.streamIdSha256.localeCompare(right.streamIdSha256),
    );
    if (
        streams.some(
            (stream, index) =>
                index > 0 &&
                stream.streamIdSha256 === streams[index - 1].streamIdSha256,
        )
    ) {
        throw new TypeError('SSE baselines must contain unique stream IDs');
    }
    return sealState({
        schemaVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
        policy: canonical,
        observationRevision: 0,
        lastObservedWallTimeMs: wallTime,
        lastObservedMonotonicTimeMs: monotonicTime,
        apiGenerationSha256: sha256(
            `runtime-gap-api-generation\u001f${generation}`,
        ),
        lifecycleState: 'awake',
        sseStreams: streams,
        recovery: {
            required: false,
            firstDetectedRevision: null,
            reasons: [],
            signal: null,
        },
    });
}

function normalizeClockObservation(observation, kind) {
    const expectedKeys = [
        'schemaVersion',
        'kind',
        'observedWallTimeMs',
        'observedMonotonicTimeMs',
        ...(kind === 'lifecycle' ? ['phase'] : []),
    ];
    if (
        !exactObject(observation, expectedKeys) ||
        observation.schemaVersion !==
            SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION
    ) {
        throw new TypeError(`${kind} observation schema is invalid`);
    }
    if (
        kind === 'lifecycle' &&
        !['sleep', 'wake'].includes(observation.phase)
    ) {
        throw new TypeError('lifecycle phase is invalid');
    }
    return {
        wallTime: nonNegativeSafeInteger(
            observation.observedWallTimeMs,
            'observedWallTimeMs',
        ),
        monotonicTime: nonNegativeSafeInteger(
            observation.observedMonotonicTimeMs,
            'observedMonotonicTimeMs',
        ),
        phase: kind === 'lifecycle' ? observation.phase : null,
    };
}

function observeClock(state, observation, kind) {
    const normalized = normalizeClockObservation(observation, kind);
    const wallDelta =
        BigInt(normalized.wallTime) - BigInt(state.lastObservedWallTimeMs);
    const monotonicDelta =
        BigInt(normalized.monotonicTime) -
        BigInt(state.lastObservedMonotonicTimeMs);
    const additions = [];
    if (
        monotonicDelta < 0n ||
        monotonicDelta > BigInt(state.policy.eventLoopPauseThresholdMs)
    ) {
        additions.push({
            code: 'EVENT_LOOP_PAUSE_GAP',
            scopeSha256: GLOBAL_SCOPE_SHA256,
            evidence: {
                detectorVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                monotonicRelation:
                    monotonicDelta < 0n
                        ? 'regressed'
                        : 'exceeded_versioned_pause_threshold',
                policySha256: state.policy.policySha256,
            },
        });
    }
    const clockDeltaDifference =
        wallDelta >= monotonicDelta
            ? wallDelta - monotonicDelta
            : monotonicDelta - wallDelta;
    if (
        wallDelta < 0n ||
        clockDeltaDifference > BigInt(state.policy.wallClockJumpThresholdMs)
    ) {
        additions.push({
            code: 'WALL_CLOCK_JUMP_GAP',
            scopeSha256: GLOBAL_SCOPE_SHA256,
            evidence: {
                detectorVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                wallClockRelation:
                    wallDelta < 0n
                        ? 'regressed'
                        : 'diverged_from_monotonic_clock',
                policySha256: state.policy.policySha256,
            },
        });
    }
    if (kind === 'lifecycle') {
        additions.push({
            code: 'SLEEP_WAKE_GAP',
            scopeSha256: GLOBAL_SCOPE_SHA256,
            evidence: {
                detectorVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                phase: normalized.phase,
                policySha256: state.policy.policySha256,
            },
        });
    }
    return finalizeObservation(state, {
        updates: {
            lastObservedWallTimeMs: normalized.wallTime,
            lastObservedMonotonicTimeMs: normalized.monotonicTime,
            ...(kind === 'lifecycle'
                ? {
                      lifecycleState:
                          normalized.phase === 'sleep' ? 'sleeping' : 'awake',
                  }
                : {}),
        },
        additions,
    });
}

function normalizeApiGenerationObservation(observation) {
    if (
        !exactObject(observation, [
            'schemaVersion',
            'kind',
            'apiGeneration',
        ]) ||
        observation.schemaVersion !==
            SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION
    ) {
        throw new TypeError('api_generation observation schema is invalid');
    }
    return boundedToken(observation.apiGeneration, 'apiGeneration');
}

function observeApiGeneration(state, observation) {
    let observedGenerationSha256;
    try {
        const generation = normalizeApiGenerationObservation(observation);
        observedGenerationSha256 = sha256(
            `runtime-gap-api-generation\u001f${generation}`,
        );
    } catch {
        return finalizeObservation(state, {
            additions: [
                {
                    code: 'API_GENERATION_GAP',
                    scopeSha256: GLOBAL_SCOPE_SHA256,
                    evidence: {
                        detectorVersion:
                            SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                        generationRelation: 'untrusted',
                        policySha256: state.policy.policySha256,
                    },
                },
            ],
        });
    }
    return finalizeObservation(state, {
        additions:
            observedGenerationSha256 === state.apiGenerationSha256
                ? []
                : [
                      {
                          code: 'API_GENERATION_GAP',
                          scopeSha256: GLOBAL_SCOPE_SHA256,
                          evidence: {
                              detectorVersion:
                                  SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                              generationRelation: 'changed',
                              expectedGenerationSha256:
                                  state.apiGenerationSha256,
                              observedGenerationSha256,
                              policySha256: state.policy.policySha256,
                          },
                      },
                  ],
    });
}

function normalizeSseObservation(observation) {
    if (
        !exactObject(observation, [
            'schemaVersion',
            'kind',
            'streamId',
            'streamEpoch',
            'continuityMode',
            'sequence',
            'cursor',
            'predecessorCursor',
            'eventFingerprintSha256',
        ]) ||
        observation.schemaVersion !==
            SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION
    ) {
        throw new TypeError('SSE observation schema is invalid');
    }
    const streamId = boundedToken(observation.streamId, 'SSE streamId');
    const streamEpoch = boundedToken(observation.streamEpoch, 'SSE streamEpoch');
    if (!CONTINUITY_MODES.has(observation.continuityMode)) {
        throw new TypeError('SSE observation continuityMode is unsupported');
    }
    const sequence = nullableSequence(observation.sequence, 'SSE sequence');
    const cursor = nullableToken(observation.cursor, 'SSE cursor');
    const predecessorCursor = nullableToken(
        observation.predecessorCursor,
        'SSE predecessorCursor',
    );
    if (
        (observation.continuityMode === 'gate_verified_sequence' &&
            (sequence === null ||
                cursor !== null ||
                predecessorCursor !== null)) ||
        (observation.continuityMode === 'runtime_cursor_chain' &&
            (sequence !== null || cursor === null || predecessorCursor === null)) ||
        (observation.continuityMode === 'epoch_only' &&
            (sequence !== null ||
                cursor !== null ||
                predecessorCursor !== null))
    ) {
        throw new TypeError(
            'SSE observation does not match its verified continuity contract',
        );
    }
    return {
        streamIdSha256: streamScopeSha256(streamId),
        streamEpochSha256: sha256(
            `runtime-gap-stream-epoch\u001f${streamEpoch}`,
        ),
        continuityMode: observation.continuityMode,
        sequence,
        cursorSha256:
            cursor === null
                ? null
                : sha256(`runtime-gap-sse-cursor\u001f${cursor}`),
        predecessorCursorSha256:
            predecessorCursor === null
                ? null
                : sha256(
                      `runtime-gap-sse-cursor\u001f${predecessorCursor}`,
                  ),
        eventFingerprintSha256: digest(
            observation.eventFingerprintSha256,
            'SSE eventFingerprintSha256',
        ),
    };
}

function invalidObservationReason(state, observation) {
    let kind = null;
    try {
        kind =
            observation && typeof observation === 'object'
                ? observation.kind
                : null;
    } catch {
        kind = null;
    }
    if (kind === 'api_generation') {
        return {
            code: 'API_GENERATION_GAP',
            scopeSha256: GLOBAL_SCOPE_SHA256,
            evidence: {
                detectorVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                generationRelation: 'untrusted',
                policySha256: state.policy.policySha256,
            },
        };
    }
    return {
        code: 'RUNTIME_GAP_INPUT_INVALID',
        scopeSha256: GLOBAL_SCOPE_SHA256,
        evidence: {
            detectorVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
            observationKind:
                typeof kind === 'string' && kind.length <= 32
                    ? kind
                    : 'unknown',
            policySha256: state.policy.policySha256,
        },
    };
}

function observeSseLifecycle(state, observation) {
    if (
        !exactObject(observation, [
            'schemaVersion',
            'kind',
            'streamId',
            'streamEpoch',
            'phase',
        ]) ||
        observation.schemaVersion !==
            SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION ||
        !['disconnect', 'heartbeat_timeout', 'reconnect'].includes(
            observation.phase,
        )
    ) {
        return finalizeObservation(state, {
            additions: [invalidObservationReason(state, observation)],
        });
    }
    let streamIdSha256;
    let streamEpochSha256;
    try {
        const streamId = boundedToken(observation.streamId, 'SSE streamId');
        const streamEpoch = boundedToken(
            observation.streamEpoch,
            'SSE streamEpoch',
        );
        streamIdSha256 = streamScopeSha256(streamId);
        streamEpochSha256 = sha256(
            `runtime-gap-stream-epoch\u001f${streamEpoch}`,
        );
    } catch {
        return finalizeObservation(state, {
            additions: [invalidObservationReason(state, observation)],
        });
    }
    const stream = state.sseStreams.find(
        (candidate) => candidate.streamIdSha256 === streamIdSha256,
    );
    if (!stream) {
        return finalizeObservation(state, {
            additions: [
                {
                    code: 'SSE_STREAM_BASELINE_MISSING',
                    scopeSha256: GLOBAL_SCOPE_SHA256,
                    evidence: {
                        detectorVersion:
                            SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                        policySha256: state.policy.policySha256,
                    },
                },
            ],
        });
    }
    return finalizeObservation(state, {
        additions: [
            {
                code: 'SSE_EPOCH_GAP',
                scopeSha256: stream.streamIdSha256,
                evidence: {
                    detectorVersion:
                        SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                    continuityRelation: observation.phase,
                    expectedEpochSha256: stream.streamEpochSha256,
                    observedEpochSha256: streamEpochSha256,
                    policySha256: state.policy.policySha256,
                },
            },
        ],
    });
}

function observeSse(state, observation) {
    let normalized;
    try {
        normalized = normalizeSseObservation(observation);
    } catch {
        return finalizeObservation(state, {
            additions: [invalidObservationReason(state, observation)],
        });
    }
    const streamIndex = state.sseStreams.findIndex(
        (candidate) =>
            candidate.streamIdSha256 === normalized.streamIdSha256,
    );
    if (streamIndex < 0) {
        return finalizeObservation(state, {
            additions: [
                {
                    code: 'SSE_STREAM_BASELINE_MISSING',
                    scopeSha256: GLOBAL_SCOPE_SHA256,
                    evidence: {
                        detectorVersion:
                            SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                        policySha256: state.policy.policySha256,
                    },
                },
            ],
        });
    }
    const stream = state.sseStreams[streamIndex];
    const additions = [];
    let classification = 'continuous';
    let nextStream = stream;
    if (stream.streamEpochSha256 !== normalized.streamEpochSha256) {
        additions.push({
            code: 'SSE_EPOCH_GAP',
            scopeSha256: stream.streamIdSha256,
            evidence: {
                detectorVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                expectedEpochSha256: stream.streamEpochSha256,
                observedEpochSha256: normalized.streamEpochSha256,
                policySha256: state.policy.policySha256,
            },
        });
    } else if (stream.continuityMode !== normalized.continuityMode) {
        additions.push({
            code: 'RUNTIME_GAP_INPUT_INVALID',
            scopeSha256: stream.streamIdSha256,
            evidence: {
                detectorVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                observationKind: 'sse_continuity_contract_changed',
                policySha256: state.policy.policySha256,
            },
        });
    } else if (stream.continuityMode === 'gate_verified_sequence') {
        const current = BigInt(normalized.sequence);
        const previous = BigInt(stream.lastSequence);
        if (
            current === previous &&
            normalized.eventFingerprintSha256 ===
                stream.lastEventFingerprintSha256
        ) {
            classification = 'duplicate';
        } else if (current !== previous + 1n) {
            additions.push({
                code: 'SSE_SEQUENCE_GAP',
                scopeSha256: stream.streamIdSha256,
                evidence: {
                    detectorVersion:
                        SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                    continuityRelation:
                        current === previous
                            ? 'sequence_payload_conflict'
                            : current < previous
                              ? 'sequence_reordered'
                              : 'sequence_not_contiguous',
                    policySha256: state.policy.policySha256,
                },
            });
        } else {
            nextStream = deepFreeze({
                ...stream,
                lastSequence: normalized.sequence,
                lastEventFingerprintSha256:
                    normalized.eventFingerprintSha256,
            });
        }
    } else if (stream.continuityMode === 'runtime_cursor_chain') {
        if (
            normalized.cursorSha256 === stream.lastCursorSha256 &&
            normalized.eventFingerprintSha256 ===
                stream.lastEventFingerprintSha256
        ) {
            classification = 'duplicate';
        } else if (
            normalized.predecessorCursorSha256 !== stream.lastCursorSha256 ||
            normalized.cursorSha256 === stream.lastCursorSha256
        ) {
            additions.push({
                code: 'SSE_CURSOR_GAP',
                scopeSha256: stream.streamIdSha256,
                evidence: {
                    detectorVersion:
                        SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
                    continuityRelation:
                        normalized.cursorSha256 === stream.lastCursorSha256
                            ? 'cursor_payload_conflict'
                            : 'cursor_predecessor_mismatch',
                    policySha256: state.policy.policySha256,
                },
            });
        } else {
            nextStream = deepFreeze({
                ...stream,
                lastCursorSha256: normalized.cursorSha256,
                lastEventFingerprintSha256:
                    normalized.eventFingerprintSha256,
            });
        }
    } else {
        nextStream = deepFreeze({
            ...stream,
            lastEventFingerprintSha256: normalized.eventFingerprintSha256,
        });
    }
    const streams = [...state.sseStreams];
    streams[streamIndex] = nextStream;
    return finalizeObservation(state, {
        updates: { sseStreams: streams },
        additions,
        classification,
    });
}

/**
 * Pure continuity reducer. It never contacts a service, invokes a callback, or
 * grants dispatch authority. A detected gap only latches an immutable
 * recovery/reconciliation signal. The latch deliberately has no generic reset;
 * a reconciler must establish a fresh RuntimeEpoch baseline by constructing a
 * new detector state after durable reconciliation.
 */
function observeSmartOrderRuntimeGap(state, observation) {
    const current = assertState(state);
    if (!observation || typeof observation !== 'object') {
        return finalizeObservation(current, {
            additions: [invalidObservationReason(current, observation)],
        });
    }
    try {
        if (observation.kind === 'clock_sample') {
            return observeClock(current, observation, 'clock_sample');
        }
        if (observation.kind === 'lifecycle') {
            return observeClock(current, observation, 'lifecycle');
        }
        if (observation.kind === 'api_generation') {
            return observeApiGeneration(current, observation);
        }
        if (observation.kind === 'sse_event') {
            return observeSse(current, observation);
        }
        if (observation.kind === 'sse_lifecycle') {
            return observeSseLifecycle(current, observation);
        }
    } catch {
        return finalizeObservation(current, {
            additions: [invalidObservationReason(current, observation)],
        });
    }
    return finalizeObservation(current, {
        additions: [invalidObservationReason(current, observation)],
    });
}

const DETECTOR_CONSTRUCTOR_KEYS = Object.freeze([
    'apiGeneration',
    'observedMonotonicTimeMs',
    'observedWallTimeMs',
]);
const CLOCK_SAMPLE_KEYS = Object.freeze([
    'observedMonotonicTimeMs',
    'observedWallTimeMs',
]);
const LIFECYCLE_KEYS = Object.freeze([
    'observedMonotonicTimeMs',
    'observedWallTimeMs',
    'phase',
]);
const API_GENERATION_KEYS = Object.freeze(['apiGeneration']);

function detectorObservationResult(result) {
    return deepFreeze({
        classification: result.classification,
        newlyDetectedReasonCodes: result.newlyDetectedReasonCodes,
        observationRevision: result.state.observationRevision,
        recoveryRequired: result.state.recovery.required,
        signal: result.signal,
    });
}

/**
 * Creates the only supported live detector facade.
 *
 * The reducer state, baseline constructor and reducer are deliberately
 * module-private. The facade has no restore/reset method and accepts neither a
 * policy nor an SSE continuity contract. Until a Gate-verified stream authority
 * exists, production SSE sequence/cursor observations therefore remain
 * mechanically unavailable instead of trusting a caller-supplied
 * `continuityMode`.
 */
export function createSmartOrderRuntimeGapDetector(options) {
    if (!exactObject(options, DETECTOR_CONSTRUCTOR_KEYS)) {
        throw new TypeError('runtime gap detector options schema is invalid');
    }
    let detectorState = createSmartOrderRuntimeGapDetectorState({
        policy: DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY,
        observedWallTimeMs: options.observedWallTimeMs,
        observedMonotonicTimeMs: options.observedMonotonicTimeMs,
        apiGeneration: options.apiGeneration,
        sseBaselines: [],
    });

    function apply(observation) {
        const result = observeSmartOrderRuntimeGap(detectorState, observation);
        detectorState = result.state;
        return detectorObservationResult(result);
    }

    function status() {
        return deepFreeze({
            schemaVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
            policyVersion: SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
            policySha256: DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY.policySha256,
            // Only critical transport lifecycle is accepted here. The
            // production Shioaji stream does not expose a Gate-verified
            // global sequence/cursor, so event-level continuity remains
            // unavailable and every disconnect/reconnect is reconciled.
            sseContinuityAuthority: 'critical_transport_lifecycle_only',
            observationRevision: detectorState.observationRevision,
            recoveryRequired: detectorState.recovery.required,
            signalSha256:
                detectorState.recovery.signal?.signalSha256 ?? null,
            reasonCodes:
                detectorState.recovery.signal?.reasonCodes ?? Object.freeze([]),
            grantsDispatchAuthority: false,
        });
    }

    return Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
        status,
        observeClockSample(input) {
            const valid = exactObject(input, CLOCK_SAMPLE_KEYS);
            return apply({
                schemaVersion: SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION,
                kind: 'clock_sample',
                observedWallTimeMs: valid ? input.observedWallTimeMs : null,
                observedMonotonicTimeMs: valid
                    ? input.observedMonotonicTimeMs
                    : null,
            });
        },
        observeLifecycle(input) {
            const valid = exactObject(input, LIFECYCLE_KEYS);
            return apply({
                schemaVersion: SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION,
                kind: 'lifecycle',
                observedWallTimeMs: valid ? input.observedWallTimeMs : null,
                observedMonotonicTimeMs: valid
                    ? input.observedMonotonicTimeMs
                    : null,
                phase: valid ? input.phase : null,
            });
        },
        observeApiGeneration(input) {
            const valid = exactObject(input, API_GENERATION_KEYS);
            return apply({
                schemaVersion: SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION,
                kind: 'api_generation',
                apiGeneration: valid ? input.apiGeneration : null,
            });
        },
        observeSseLifecycle(input) {
            const valid = exactObject(input, [
                'phase',
                'streamEpoch',
                'streamId',
            ]);
            return apply({
                schemaVersion: SMART_ORDER_RUNTIME_GAP_OBSERVATION_SCHEMA_VERSION,
                kind: 'sse_lifecycle',
                streamId: valid ? input.streamId : null,
                streamEpoch: valid ? input.streamEpoch : null,
                phase: valid ? input.phase : null,
            });
        },
    });
}
