import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const controllerRegistry = vi.hoisted(() => ({
    issued: new WeakSet(),
}));

vi.mock('./runtime-controller.mjs', () => ({
    isIssuedPrimarySmartOrderRuntimeController(value) {
        return controllerRegistry.issued.has(value);
    },
}));

import {
    DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY,
    SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
    SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
} from './runtime-gap-detector.mjs';
import {
    SMART_ORDER_RUNTIME_GAP_COORDINATOR_SCHEMA_VERSION,
    SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
    createSmartOrderRuntimeGapCoordinator,
} from './runtime-gap-coordinator.mjs';

const RAW_API_GENERATION = 'simulation:private-api-generation';
let runtimeEpochSequence = 0;

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function nextRuntimeEpochId(label = 'runtime-epoch') {
    runtimeEpochSequence += 1;
    return `${label}-${runtimeEpochSequence}`;
}

function epochDigest(runtimeEpochId) {
    return sha256(`smart-order-runtime-gap-epoch\u001f${runtimeEpochId}`);
}

function durableResult(input, overrides = {}) {
    return Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
        runtimeEpochIdSha256: input.runtimeEpochIdSha256,
        state: 'reconciling',
        previousState: 'ready',
        revision: 2,
        reason: 'continuity_gap_invalidated',
        continuitySignalSha256: input.signalSha256,
        reasonCodes: Object.freeze([...input.reasonCodes]),
        recoveryStrategyCount: 0,
        supersededRearmCount: 0,
        recoveredIntentCount: 0,
        invalidatedGateManifestCount: 0,
        manualInterventionStrategyCount: 0,
        automaticRedispatchAllowed: false,
        userRearmRequiredAfterReconciliation: true,
        requiresProcessRestart: false,
        dispatchAllowed: false,
        ...overrides,
    });
}

function issuedController(runtimeEpochId, handler = durableResult) {
    const controller = Object.freeze({
        runtimeEpochIdSha256: epochDigest(runtimeEpochId),
        invalidateRuntimeContinuityGap: vi.fn(handler),
    });
    controllerRegistry.issued.add(controller);
    return controller;
}

function coordinatorOptions(overrides = {}) {
    const runtimeEpochId = overrides.runtimeEpochId ?? nextRuntimeEpochId();
    return {
        runtimeController:
            overrides.runtimeController ?? issuedController(runtimeEpochId),
        runtimeEpochId,
        apiGeneration: RAW_API_GENERATION,
        observedWallTimeMs: 1_000_000,
        observedMonotonicTimeMs: 10_000,
        ...overrides,
    };
}

function eventLoopGap(coordinator) {
    return coordinator.observeClockSample({
        observedWallTimeMs: 1_005_001,
        observedMonotonicTimeMs: 15_001,
    });
}

describe('private runtime gap coordinator authority', () => {
    it('requires an issued controller and exposes one sanitized baseline', () => {
        const rawRuntimeEpochId = nextRuntimeEpochId('private-epoch');
        const coordinator = createSmartOrderRuntimeGapCoordinator(
            coordinatorOptions({ runtimeEpochId: rawRuntimeEpochId }),
        );
        expect(Object.isFrozen(coordinator)).toBe(true);
        expect(coordinator.status()).toMatchObject({
            schemaVersion: SMART_ORDER_RUNTIME_GAP_COORDINATOR_SCHEMA_VERSION,
            coordinatorState: 'monitoring',
            detectorSchemaVersion:
                SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
            policyVersion: SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
            policySha256:
                DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY.policySha256,
            sseContinuityAuthority: 'critical_transport_lifecycle_only',
            observationRevision: 0,
            recoveryRequired: false,
            grantsDispatchAuthority: false,
        });
        expect(JSON.stringify(coordinator.status())).not.toContain(
            rawRuntimeEpochId,
        );
        expect(() =>
            createSmartOrderRuntimeGapCoordinator({
                ...coordinatorOptions(),
                runtimeController: Object.freeze({
                    runtimeEpochIdSha256: epochDigest('forged'),
                    invalidateRuntimeContinuityGap: vi.fn(),
                }),
            }),
        ).toThrow('issued primary runtime controller');
    });

    it('rejects accessor input and snapshots a Proxy controller exactly once', async () => {
        const accessorEpoch = nextRuntimeEpochId('accessor-controller');
        const trustedAccessorController = issuedController(accessorEpoch);
        const forgedAccessorCallback = vi.fn((input) => durableResult(input));
        let accessorReads = 0;
        const accessorOptions = coordinatorOptions({
            runtimeEpochId: accessorEpoch,
            runtimeController: trustedAccessorController,
        });
        Object.defineProperty(accessorOptions, 'runtimeController', {
            enumerable: true,
            configurable: true,
            get() {
                accessorReads += 1;
                return accessorReads < 3
                    ? trustedAccessorController
                    : Object.freeze({
                          runtimeEpochIdSha256: epochDigest(accessorEpoch),
                          invalidateRuntimeContinuityGap:
                              forgedAccessorCallback,
                      });
            },
        });
        expect(() =>
            createSmartOrderRuntimeGapCoordinator(accessorOptions),
        ).toThrow('must use own data properties');
        expect(accessorReads).toBe(0);
        expect(forgedAccessorCallback).not.toHaveBeenCalled();

        const proxyEpoch = nextRuntimeEpochId('proxy-controller');
        const trustedProxyController = issuedController(proxyEpoch);
        const forgedProxyCallback = vi.fn((input) => durableResult(input));
        let propertyReads = 0;
        const proxyOptions = new Proxy(
            coordinatorOptions({
                runtimeEpochId: proxyEpoch,
                runtimeController: trustedProxyController,
            }),
            {
                get(target, property, receiver) {
                    if (property === 'runtimeController') {
                        propertyReads += 1;
                        return propertyReads === 1
                            ? trustedProxyController
                            : Object.freeze({
                                  runtimeEpochIdSha256:
                                      epochDigest(proxyEpoch),
                                  invalidateRuntimeContinuityGap:
                                      forgedProxyCallback,
                              });
                    }
                    return Reflect.get(target, property, receiver);
                },
            },
        );
        const coordinator = createSmartOrderRuntimeGapCoordinator(proxyOptions);
        eventLoopGap(coordinator);
        await coordinator.waitForInvalidation();
        expect(propertyReads).toBe(0);
        expect(
            trustedProxyController.invalidateRuntimeContinuityGap,
        ).toHaveBeenCalledTimes(1);
        expect(forgedProxyCallback).not.toHaveBeenCalled();
        expect(coordinator.status()).toMatchObject({
            invalidationState: 'committed',
            dispatchBlockedByContinuityGap: true,
        });
    });

    it.each(['policy', 'state', 'sseBaselines', 'continuityMode', 'detector']) (
        'rejects caller-controlled %s at construction',
        (key) => {
            const options = coordinatorOptions();
            options[key] = key === 'sseBaselines' ? [] : 'forged';
            expect(() =>
                createSmartOrderRuntimeGapCoordinator(options),
            ).toThrow('options schema is invalid');
        },
    );

    it('rejects an epoch that does not match its issued controller', () => {
        const controllerEpoch = nextRuntimeEpochId('controller-epoch');
        expect(() =>
            createSmartOrderRuntimeGapCoordinator(
                coordinatorOptions({
                    runtimeEpochId: nextRuntimeEpochId('forged-epoch'),
                    runtimeController: issuedController(controllerEpoch),
                }),
            ),
        ).toThrow('does not match its controller');
    });

    it('does not permit a second baseline for one RuntimeEpoch after stop', () => {
        const runtimeEpochId = nextRuntimeEpochId('single-baseline');
        const first = createSmartOrderRuntimeGapCoordinator(
            coordinatorOptions({ runtimeEpochId }),
        );
        first.stop();
        expect(() =>
            createSmartOrderRuntimeGapCoordinator(
                coordinatorOptions({ runtimeEpochId }),
            ),
        ).toThrow('baseline was already issued');
    });

    it('accepts healthy clock and generation samples', () => {
        const options = coordinatorOptions();
        const coordinator = createSmartOrderRuntimeGapCoordinator(options);
        coordinator.observeClockSample({
            observedWallTimeMs: 1_001_000,
            observedMonotonicTimeMs: 11_000,
        });
        const boundary = coordinator.observeClockSample({
            observedWallTimeMs: 1_006_000,
            observedMonotonicTimeMs: 16_000,
        });
        const sameGeneration = coordinator.observeApiGeneration({
            apiGeneration: RAW_API_GENERATION,
            observedWallTimeMs: 1_006_001,
        });
        expect(boundary.recoveryRequired).toBe(false);
        expect(sameGeneration.observationRevision).toBe(3);
        expect(
            options.runtimeController.invalidateRuntimeContinuityGap,
        ).not.toHaveBeenCalled();
    });

    it('synchronously revokes readiness before reentrant durable work', async () => {
        const runtimeEpochId = nextRuntimeEpochId('reentrant');
        let coordinator;
        let statusInsideController;
        let reentrantStatus;
        let release;
        const pending = new Promise((resolve) => {
            release = resolve;
        });
        const controller = issuedController(runtimeEpochId, (input) => {
            statusInsideController = coordinator.status();
            reentrantStatus = coordinator.observeClockSample({
                observedWallTimeMs: 1_005_002,
                observedMonotonicTimeMs: 15_002,
            });
            return pending.then(() => durableResult(input));
        });
        coordinator = createSmartOrderRuntimeGapCoordinator(
            coordinatorOptions({ runtimeEpochId, runtimeController: controller }),
        );

        const result = eventLoopGap(coordinator);
        expect(statusInsideController).toMatchObject({
            recoveryRequired: true,
            dispatchBlockedByContinuityGap: true,
            invalidationState: 'pending',
        });
        expect(reentrantStatus.observationRevision).toBe(
            result.observationRevision,
        );
        expect(controller.invalidateRuntimeContinuityGap).toHaveBeenCalledTimes(1);
        release();
        await expect(coordinator.waitForInvalidation()).resolves.toMatchObject({
            state: 'committed',
            dispatchAllowed: false,
            automaticResetAllowed: false,
        });
    });

    it.each([
        [{ observedWallTimeMs: 1_004_001, observedMonotonicTimeMs: 11_000 }, 'WALL_CLOCK_JUMP_GAP'],
        [{ observedWallTimeMs: 999_999, observedMonotonicTimeMs: 11_000 }, 'WALL_CLOCK_JUMP_GAP'],
    ])('latches clock discontinuity and durably verifies it', async (sample, reason) => {
        const options = coordinatorOptions();
        const coordinator = createSmartOrderRuntimeGapCoordinator(options);
        coordinator.observeClockSample(sample);
        await coordinator.waitForInvalidation();
        expect(
            options.runtimeController.invalidateRuntimeContinuityGap.mock
                .calls[0][0].reasonCodes,
        ).toContain(reason);
        expect(coordinator.status().invalidationState).toBe('committed');
    });

    it.each(['sleep', 'wake'])(
        'latches %s lifecycle evidence and durably blocks dispatch',
        async (phase) => {
            const options = coordinatorOptions();
            const coordinator = createSmartOrderRuntimeGapCoordinator(options);

            const result = coordinator.observeLifecycle({
                observedWallTimeMs: 1_000_100,
                observedMonotonicTimeMs: 10_100,
                phase,
            });

            expect(result).toMatchObject({
                recoveryRequired: true,
                dispatchBlockedByContinuityGap: true,
                invalidationState: 'pending',
            });
            await expect(coordinator.waitForInvalidation()).resolves.toMatchObject({
                state: 'committed',
                dispatchAllowed: false,
                automaticResetAllowed: false,
            });
            expect(
                options.runtimeController.invalidateRuntimeContinuityGap.mock
                    .calls[0][0].reasonCodes,
            ).toEqual(['SLEEP_WAKE_GAP']);
        },
    );

    it('sends an exact frozen epoch-bound invalidation envelope', async () => {
        const options = coordinatorOptions();
        const coordinator = createSmartOrderRuntimeGapCoordinator(options);
        eventLoopGap(coordinator);
        await coordinator.waitForInvalidation();
        const input =
            options.runtimeController.invalidateRuntimeContinuityGap.mock
                .calls[0][0];
        expect(Object.keys(input).sort()).toEqual(
            [
                'schemaVersion',
                'runtimeEpochIdSha256',
                'signalSha256',
                'reasonCodes',
                'nowEpochMs',
            ].sort(),
        );
        expect(input).toMatchObject({
            schemaVersion:
                SMART_ORDER_RUNTIME_GAP_INVALIDATION_SCHEMA_VERSION,
            runtimeEpochIdSha256: epochDigest(options.runtimeEpochId),
            nowEpochMs: 1_005_001,
        });
        expect(Object.isFrozen(input)).toBe(true);
        expect(Object.isFrozen(input.reasonCodes)).toBe(true);
        expect(JSON.stringify(input)).not.toContain(options.runtimeEpochId);
        expect(JSON.stringify(input)).not.toContain(RAW_API_GENERATION);
    });

    it.each([
        ['empty fulfillment', () => ({})],
        [
            'wrong epoch',
            (input) => durableResult(input, {
                runtimeEpochIdSha256: sha256('wrong'),
            }),
        ],
        [
            'wrong signal',
            (input) => durableResult(input, {
                continuitySignalSha256: sha256('wrong'),
            }),
        ],
        [
            'readiness reopened',
            (input) => durableResult(input, { dispatchAllowed: true }),
        ],
        [
            'wrong durable state',
            (input) => durableResult(input, { state: 'ready' }),
        ],
    ])('never calls forged %s committed', async (_label, handler) => {
        const runtimeEpochId = nextRuntimeEpochId('forged-result');
        const controller = issuedController(runtimeEpochId, handler);
        const coordinator = createSmartOrderRuntimeGapCoordinator(
            coordinatorOptions({ runtimeEpochId, runtimeController: controller }),
        );
        eventLoopGap(coordinator);
        await expect(coordinator.waitForInvalidation()).resolves.toMatchObject({
            state: 'failed_closed',
        });
        expect(coordinator.status()).toMatchObject({
            recoveryRequired: true,
            dispatchBlockedByContinuityGap: true,
            invalidationState: 'failed_closed',
        });
    });

    it.each([
        ['synchronous throw', () => { throw new Error('private'); }],
        ['asynchronous rejection', async () => { throw new Error('private'); }],
    ])('keeps the latch after %s', async (_label, handler) => {
        const runtimeEpochId = nextRuntimeEpochId('failure');
        const controller = issuedController(runtimeEpochId, handler);
        const coordinator = createSmartOrderRuntimeGapCoordinator(
            coordinatorOptions({ runtimeEpochId, runtimeController: controller }),
        );
        const first = eventLoopGap(coordinator);
        await coordinator.waitForInvalidation();
        const later = coordinator.observeClockSample({
            observedWallTimeMs: 1_006_001,
            observedMonotonicTimeMs: 16_001,
        });
        expect(later.signalSha256).toBe(first.signalSha256);
        expect(later.invalidationState).toBe('failed_closed');
        expect(controller.invalidateRuntimeContinuityGap).toHaveBeenCalledTimes(1);
    });

    it('cannot restore or reset a cloned status', async () => {
        const coordinator = createSmartOrderRuntimeGapCoordinator(
            coordinatorOptions(),
        );
        const latched = eventLoopGap(coordinator);
        await coordinator.waitForInvalidation();
        const forgedClear = {
            ...latched,
            recoveryRequired: false,
            signalSha256: null,
        };
        expect(coordinator.restore).toBeUndefined();
        expect(coordinator.reset).toBeUndefined();
        expect(() => latched.reasonCodes.push('FORGED')).toThrow();
        expect(coordinator.observeClockSample(forgedClear)).toMatchObject({
            recoveryRequired: true,
            signalSha256: latched.signalSha256,
        });
    });

    it('makes stop final without inventing a signal', async () => {
        const options = coordinatorOptions();
        const coordinator = createSmartOrderRuntimeGapCoordinator(options);
        const stopped = coordinator.stop();
        expect(stopped).toMatchObject({
            coordinatorState: 'stopped',
            recoveryRequired: false,
        });
        await expect(coordinator.waitForInvalidation()).resolves.toMatchObject({
            state: 'stopped_without_invalidation',
        });
        expect(() =>
            coordinator.observeClockSample({
                observedWallTimeMs: 1_001_000,
                observedMonotonicTimeMs: 11_000,
            }),
        ).toThrow('permanently stopped');
        expect(
            options.runtimeController.invalidateRuntimeContinuityGap,
        ).not.toHaveBeenCalled();
    });

    it('turns critical SSE lifecycle into durable recovery without event authority', async () => {
        const options = coordinatorOptions();
        const coordinator = createSmartOrderRuntimeGapCoordinator(options);
        const result = coordinator.observeSseLifecycle({
            observedWallTimeMs: 1_000_100,
            phase: 'disconnect',
            streamEpoch: 'trade-connection-1',
            streamId: 'shioaji-trade-sse',
        });
        expect(result).toMatchObject({
            recoveryRequired: true,
            dispatchBlockedByContinuityGap: true,
        });
        await coordinator.waitForInvalidation();
        expect(
            options.runtimeController.invalidateRuntimeContinuityGap.mock
                .calls[0][0].reasonCodes,
        ).toEqual(['SSE_STREAM_BASELINE_MISSING']);
    });

    it('keeps event-level SSE authority and caller detector injection absent', () => {
        const coordinator = createSmartOrderRuntimeGapCoordinator(
            coordinatorOptions(),
        );
        const source = readFileSync(
            new URL('./runtime-gap-coordinator.mjs', import.meta.url),
            'utf8',
        );
        expect(coordinator.status().sseContinuityAuthority).toBe(
            'critical_transport_lifecycle_only',
        );
        expect(Object.keys(coordinator)).not.toContain('observeSseEvent');
        expect(Object.keys(coordinator)).toContain('observeSseLifecycle');
        expect(Object.keys(coordinator)).not.toContain('continuityMode');
        expect(source).not.toContain('options.sseBaselines');
        expect(source).not.toContain('options.continuityMode');
        expect(source).not.toContain('options.detector');
        expect(source).not.toContain('options.invalidateRuntimeContinuityGap');
    });
});
