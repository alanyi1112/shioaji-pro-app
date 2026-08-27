import { createHash, createHmac, randomBytes } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import { isIssuedPrimarySmartOrderRuntimeController } from './runtime-controller.mjs';
import {
    DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY,
    SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
    SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
    SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
    createSmartOrderRuntimeGapDetector,
} from './runtime-gap-detector.mjs';

export const SMART_ORDER_RUNTIME_GAP_COORDINATOR_SCHEMA_VERSION =
    'smart-order-runtime-gap-coordinator/2026-08-13.4';
export { SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION };

const ISSUED_RUNTIME_EPOCH_SHA256 = new Set();
const CONSTRUCTOR_KEYS = Object.freeze([
    'apiGeneration',
    'observedMonotonicTimeMs',
    'observedWallTimeMs',
    'runtimeController',
    'runtimeEpochId',
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
const API_GENERATION_KEYS = Object.freeze([
    'apiGeneration',
    'observedWallTimeMs',
]);
const SSE_LIFECYCLE_KEYS = Object.freeze([
    'observedWallTimeMs',
    'phase',
    'streamEpoch',
    'streamId',
]);
const DURABLE_INVALIDATION_RESULT_KEYS = Object.freeze([
    'automaticRedispatchAllowed',
    'continuitySignalSha256',
    'dispatchAllowed',
    'invalidatedGateManifestCount',
    'manualInterventionStrategyCount',
    'previousState',
    'reason',
    'reasonCodes',
    'recoveredIntentCount',
    'recoveryStrategyCount',
    'requiresProcessRestart',
    'revision',
    'runtimeEpochIdSha256',
    'schemaVersion',
    'state',
    'supersededRearmCount',
    'userRearmRequiredAfterReconciliation',
]);

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

function exactObject(value, expectedKeys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const actualKeys = Reflect.ownKeys(value);
    return (
        actualKeys.every((key) => typeof key === 'string') &&
        canonicalJson([...actualKeys].sort()) ===
            canonicalJson([...expectedKeys].sort())
    );
}

function snapshotExactDataProperties(value, expectedKeys, label) {
    if (!exactObject(value, expectedKeys)) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = {};
    for (const key of expectedKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use own data properties`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function boundedToken(value, label) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 512 ||
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

function stoppedError() {
    const error = new Error('runtime gap coordinator is permanently stopped');
    error.name = 'RuntimeGapCoordinatorStoppedError';
    return error;
}

function epochAlreadyIssuedError() {
    const error = new Error(
        'runtime gap coordinator baseline was already issued for this RuntimeEpoch',
    );
    error.name = 'RuntimeGapCoordinatorEpochAlreadyIssuedError';
    return error;
}

function completionResult({ runtimeEpochIdSha256, state }) {
    return deepFreeze({
        schemaVersion: SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
        runtimeEpochIdSha256,
        state,
        dispatchAllowed: false,
        automaticResetAllowed: false,
    });
}

function durableInvalidationMatches(value, expected) {
    return Boolean(
        exactObject(value, DURABLE_INVALIDATION_RESULT_KEYS) &&
            value.schemaVersion ===
                SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION &&
            value.runtimeEpochIdSha256 === expected.runtimeEpochIdSha256 &&
            value.state === 'reconciling' &&
            typeof value.previousState === 'string' &&
            value.previousState.length > 0 &&
            Number.isSafeInteger(value.revision) &&
            value.revision >= 1 &&
            value.reason === 'continuity_gap_invalidated' &&
            value.continuitySignalSha256 === expected.signalSha256 &&
            canonicalJson(value.reasonCodes) ===
                canonicalJson(expected.reasonCodes) &&
            Number.isSafeInteger(value.recoveryStrategyCount) &&
            value.recoveryStrategyCount >= 0 &&
            Number.isSafeInteger(value.supersededRearmCount) &&
            value.supersededRearmCount >= 0 &&
            Number.isSafeInteger(value.recoveredIntentCount) &&
            value.recoveredIntentCount >= 0 &&
            Number.isSafeInteger(value.invalidatedGateManifestCount) &&
            value.invalidatedGateManifestCount >= 0 &&
            Number.isSafeInteger(value.manualInterventionStrategyCount) &&
            value.manualInterventionStrategyCount >= 0 &&
            value.automaticRedispatchAllowed === false &&
            value.userRearmRequiredAfterReconciliation === true &&
            value.requiresProcessRestart === false &&
            value.dispatchAllowed === false
    );
}

/**
 * Owns the live continuity reducer for exactly one RuntimeEpoch.
 *
 * The reducer state and its per-instance sealing key never leave this closure.
 * Callers cannot supply a policy, detector state, reset, restore, SSE baseline,
 * or SSE continuity mode. The only SSE input is the production critical
 * transport lifecycle; it can only revoke readiness and cannot establish an
 * event-level continuity baseline or grant dispatch authority.
 */
export function createSmartOrderRuntimeGapCoordinator(options) {
    const constructorInput = snapshotExactDataProperties(
        options,
        CONSTRUCTOR_KEYS,
        'runtime gap coordinator options',
    );
    const runtimeController = constructorInput.runtimeController;
    if (!isIssuedPrimarySmartOrderRuntimeController(runtimeController)) {
        throw new TypeError(
            'an issued primary runtime controller is required',
        );
    }

    const runtimeEpochId = boundedToken(
        constructorInput.runtimeEpochId,
        'runtimeEpochId',
    );
    const apiGeneration = boundedToken(
        constructorInput.apiGeneration,
        'apiGeneration',
    );
    const observedWallTimeMs = nonNegativeSafeInteger(
        constructorInput.observedWallTimeMs,
        'observedWallTimeMs',
    );
    const observedMonotonicTimeMs = nonNegativeSafeInteger(
        constructorInput.observedMonotonicTimeMs,
        'observedMonotonicTimeMs',
    );
    const runtimeEpochIdSha256 = sha256(
        `smart-order-runtime-gap-epoch\u001f${runtimeEpochId}`,
    );
    if (
        runtimeController.runtimeEpochIdSha256 !== runtimeEpochIdSha256
    ) {
        throw new TypeError(
            'runtime gap coordinator epoch does not match its controller',
        );
    }
    if (ISSUED_RUNTIME_EPOCH_SHA256.has(runtimeEpochIdSha256)) {
        throw epochAlreadyIssuedError();
    }

    // The only baseline is minted here, once, with the immutable versioned
    // default policy and no caller-controlled state or SSE authority.
    const detector = createSmartOrderRuntimeGapDetector({
        observedWallTimeMs,
        observedMonotonicTimeMs,
        apiGeneration,
    });
    ISSUED_RUNTIME_EPOCH_SHA256.add(runtimeEpochIdSha256);

    const signalSealingKey = randomBytes(32);
    let lastTrustedWallTimeMs = observedWallTimeMs;
    let lastObservationKind = 'baseline';
    let stopped = false;
    let recoveryLatched = false;
    let signalSha256 = null;
    let reasonCodes = Object.freeze([]);
    let invalidationState = 'not_required';
    let completionSettled = false;
    let resolveCompletion;
    const invalidationCompletion = new Promise((resolve) => {
        resolveCompletion = resolve;
    });

    function settleCompletion(state) {
        if (completionSettled) return;
        completionSettled = true;
        resolveCompletion(
            completionResult({ runtimeEpochIdSha256, state }),
        );
    }

    function status() {
        const detectorStatus = detector.status();
        return deepFreeze({
            schemaVersion: SMART_ORDER_RUNTIME_GAP_COORDINATOR_SCHEMA_VERSION,
            coordinatorState: stopped
                ? 'stopped'
                : recoveryLatched
                  ? 'recovery_required'
                  : 'monitoring',
            runtimeEpochIdSha256,
            detectorSchemaVersion:
                SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
            policyVersion: SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
            policySha256:
                DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY.policySha256,
            sseContinuityAuthority: 'critical_transport_lifecycle_only',
            observationRevision: detectorStatus.observationRevision,
            lastObservationKind,
            recoveryRequired: recoveryLatched,
            dispatchBlockedByContinuityGap: recoveryLatched,
            grantsDispatchAuthority: false,
            userRearmRequiredAfterReconciliation: recoveryLatched,
            invalidationState,
            signalSha256,
            reasonCodes,
            stopped,
            stopIsFinal: true,
        });
    }

    function latchRecovery(signal, nowEpochMs) {
        if (recoveryLatched) return;

        // Set every local fail-closed bit before invoking an async or reentrant
        // callback. No callback outcome can clear this latch.
        recoveryLatched = true;
        invalidationState = 'pending';
        reasonCodes = Object.freeze([...signal.reasonCodes].sort());
        signalSha256 = `sha256:${createHmac('sha256', signalSealingKey)
            .update(
                canonicalJson({
                    coordinatorVersion:
                        SMART_ORDER_RUNTIME_GAP_COORDINATOR_SCHEMA_VERSION,
                    detectorSignalSha256: signal.signalSha256,
                    policySha256:
                        DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY.policySha256,
                    runtimeEpochIdSha256,
                }),
            )
            .digest('hex')}`;
        signalSealingKey.fill(0);
        const callbackInput = deepFreeze({
            schemaVersion:
                SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
            runtimeEpochIdSha256,
            signalSha256,
            reasonCodes,
            nowEpochMs: nonNegativeSafeInteger(
                nowEpochMs,
                'invalidation.nowEpochMs',
            ),
        });

        let callbackResult;
        try {
            callbackResult =
                runtimeController.invalidateRuntimeContinuityGap(callbackInput);
        } catch {
            invalidationState = 'failed_closed';
            settleCompletion('failed_closed');
            return;
        }
        void Promise.resolve(callbackResult).then(
            (durableResult) => {
                if (
                    durableInvalidationMatches(durableResult, {
                        runtimeEpochIdSha256,
                        signalSha256,
                        reasonCodes,
                    })
                ) {
                    invalidationState = 'committed';
                    settleCompletion('committed');
                    return;
                }
                invalidationState = 'failed_closed';
                settleCompletion('failed_closed');
            },
            () => {
                invalidationState = 'failed_closed';
                settleCompletion('failed_closed');
            },
        );
    }

    function applyObservation(result, nowEpochMs, observationKind) {
        lastObservationKind = observationKind;
        if (result.signal) latchRecovery(result.signal, nowEpochMs);
        return status();
    }

    function assertObservationAccepted() {
        if (stopped) throw stoppedError();
        return !recoveryLatched;
    }

    function observeClockSample(input) {
        if (!assertObservationAccepted()) return status();
        let observationWallTimeMs = lastTrustedWallTimeMs;
        if (exactObject(input, CLOCK_SAMPLE_KEYS)) {
            try {
                observationWallTimeMs = nonNegativeSafeInteger(
                    input.observedWallTimeMs,
                    'clock sample observedWallTimeMs',
                );
                const monotonicTimeMs = nonNegativeSafeInteger(
                    input.observedMonotonicTimeMs,
                    'clock sample observedMonotonicTimeMs',
                );
                lastTrustedWallTimeMs = observationWallTimeMs;
            } catch {
                // The detector receives the malformed input and latches it.
            }
        }
        return applyObservation(
            detector.observeClockSample(input),
            observationWallTimeMs,
            'clock_sample',
        );
    }

    function observeLifecycle(input) {
        if (!assertObservationAccepted()) return status();
        let observationWallTimeMs = lastTrustedWallTimeMs;
        if (exactObject(input, LIFECYCLE_KEYS)) {
            try {
                observationWallTimeMs = nonNegativeSafeInteger(
                    input.observedWallTimeMs,
                    'lifecycle observedWallTimeMs',
                );
                const monotonicTimeMs = nonNegativeSafeInteger(
                    input.observedMonotonicTimeMs,
                    'lifecycle observedMonotonicTimeMs',
                );
                lastTrustedWallTimeMs = observationWallTimeMs;
            } catch {
                // The detector receives the malformed input and latches it.
            }
        }
        return applyObservation(
            detector.observeLifecycle(input),
            observationWallTimeMs,
            'lifecycle',
        );
    }

    function observeApiGeneration(input) {
        if (!assertObservationAccepted()) return status();
        let observationWallTimeMs = lastTrustedWallTimeMs;
        if (exactObject(input, API_GENERATION_KEYS)) {
            try {
                observationWallTimeMs = nonNegativeSafeInteger(
                    input.observedWallTimeMs,
                    'API generation observedWallTimeMs',
                );
                lastTrustedWallTimeMs = observationWallTimeMs;
            } catch {
                // The detector receives the malformed input and latches it.
            }
        }
        return applyObservation(
            detector.observeApiGeneration(
                exactObject(input, API_GENERATION_KEYS)
                    ? { apiGeneration: input.apiGeneration }
                    : input,
            ),
            observationWallTimeMs,
            'api_generation',
        );
    }

    function observeSseLifecycle(input) {
        if (!assertObservationAccepted()) return status();
        let observationWallTimeMs = lastTrustedWallTimeMs;
        if (exactObject(input, SSE_LIFECYCLE_KEYS)) {
            try {
                observationWallTimeMs = nonNegativeSafeInteger(
                    input.observedWallTimeMs,
                    'SSE lifecycle observedWallTimeMs',
                );
                lastTrustedWallTimeMs = observationWallTimeMs;
            } catch {
                // The detector receives the malformed input and latches it.
            }
        }
        return applyObservation(
            detector.observeSseLifecycle(
                exactObject(input, SSE_LIFECYCLE_KEYS)
                    ? {
                          phase: input.phase,
                          streamEpoch: input.streamEpoch,
                          streamId: input.streamId,
                      }
                    : input,
            ),
            observationWallTimeMs,
            'sse_lifecycle',
        );
    }

    const coordinator = Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_GAP_COORDINATOR_SCHEMA_VERSION,
        status,
        observeClockSample,
        observeLifecycle,
        observeApiGeneration,
        observeSseLifecycle,
        waitForInvalidation() {
            return invalidationCompletion;
        },
        stop() {
            if (!stopped) {
                stopped = true;
                signalSealingKey.fill(0);
                if (!recoveryLatched) {
                    settleCompletion('stopped_without_invalidation');
                }
            }
            return status();
        },
    });
    return coordinator;
}
