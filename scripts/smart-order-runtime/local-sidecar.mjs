import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import { startSmartOrderControlPlaneServer } from './control-plane-server.mjs';
import { startSmartOrderLocalNotificationPump } from './local-notification.mjs';
import {
    assertPrivateLifecycleStopBarrierClear,
    prepareSmartOrderPrivateStorage,
    readPrivateSecret,
    removePrivateLifecycleStopBarrier,
    rotatePrivateGatewayCapability,
    verifyPrivateLifecycleStopBarrier,
    writePrivateLifecycleStopBarrier,
    writePrivateLifecycleStopCompletion,
    writePrivateRuntimeDiscovery,
} from './private-storage.mjs';
import { startSmartOrderRuntimeController } from './runtime-controller.mjs';
import { createSmartOrderRuntimeGapCoordinator } from './runtime-gap-coordinator.mjs';
import {
    SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
    createSmartOrderQuoteSubscriptionCoordinator,
} from './quote-subscription-coordinator.mjs';
import {
    SMART_ORDER_UNVERIFIED_SUBSCRIPTION_COUNTING_DIMENSION,
    createSmartOrderResourceCoordinator,
} from './resource-coordinator.mjs';
import { startSmartOrderShioajiTradeObserver } from './shioaji-trade-observer.mjs';
import { assertSmartOrderLocalSidecarTradeObserverRuntimeAuthority } from './shioaji-trade-observer-runtime-authority.mjs';
import { createSmartOrderOfficialMarketCalendarAuthority } from './official-market-calendar-authority.mjs';

export const SMART_ORDER_LOCAL_SIDECAR_SCHEMA_VERSION =
    'smart-order-local-sidecar/2026-08-11.1';

function epoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative epoch millisecond`);
    }
    return value;
}

function projectQuoteSubscriptionStatus(
    coordinator,
    observer,
    resourceCoordinator,
) {
    let status;
    let transportStatus;
    let resourceStatus;
    try {
        status = coordinator?.observer.status();
    } catch {
        status = undefined;
    }
    try {
        transportStatus = observer?.status();
    } catch {
        transportStatus = undefined;
    }
    try {
        resourceStatus = resourceCoordinator?.status();
    } catch {
        resourceStatus = undefined;
    }
    const integrationInvariantSatisfied = Boolean(
        status &&
            status.closed === false &&
            status.clockInvalid === false &&
            status.browserDemandCount === 0 &&
            status.retainedResourceReservationsOnClose === 0 &&
            status.resourceCoordinatorConfigured === true &&
            status.resourceCountingDimension ===
                SMART_ORDER_UNVERIFIED_SUBSCRIPTION_COUNTING_DIMENSION &&
            resourceStatus?.subscriptionEvidenceCurrent === false &&
            resourceStatus?.writeMasterAuthority === false &&
            resourceStatus?.brokerAuthority === false &&
            status.productionAdapterConfigured === false &&
            transportStatus?.productionQuoteTransportConfigured === true &&
            transportStatus?.sharedExistingLogin === true &&
            transportStatus?.createsNewLogin === false &&
            transportStatus?.snapshotPollingFallbackAllowed === false &&
            transportStatus?.ticksPollingFallbackAllowed === false &&
            transportStatus?.kbarsPollingFallbackAllowed === false &&
            transportStatus?.quoteConnectionActive ===
                status.connectionActive &&
            status.runtimeReadinessContribution === false &&
            status.subscriptionTransportAuthority === false &&
            status.conditionEligibilityAuthority === false &&
            status.brokerWriteAuthority === false,
    );
    const startupRecoveryInvariantSatisfied = Boolean(
        !transportStatus &&
            status &&
            status.closed === false &&
            status.clockInvalid === false &&
            status.connectionActive === false &&
            status.browserDemandCount === 0 &&
            status.pendingPlanCount === 0 &&
            status.currentHeadCount === 0 &&
            status.resourceCoordinatorConfigured === true &&
            status.resourceCountingDimension ===
                SMART_ORDER_UNVERIFIED_SUBSCRIPTION_COUNTING_DIMENSION &&
            resourceStatus?.subscriptionEvidenceCurrent === false &&
            resourceStatus?.writeMasterAuthority === false &&
            resourceStatus?.brokerAuthority === false &&
            status.runtimeReadinessContribution === false &&
            status.subscriptionTransportAuthority === false &&
            status.conditionEligibilityAuthority === false &&
            status.brokerWriteAuthority === false,
    );
    return Object.freeze({
        schemaVersion:
            SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
        state: status?.closed
            ? 'closed_fail_closed'
            : integrationInvariantSatisfied
              ? 'transport_wired_resource_blocked'
              : startupRecoveryInvariantSatisfied
                ? 'transport_unavailable_fail_closed'
                : 'integration_invariant_violated',
        blocker: status?.closed
            ? 'quote_subscription_coordinator_closed'
            : integrationInvariantSatisfied
              ? (resourceStatus?.subscriptionEvidenceBlocker ??
                'subscription_resource_admission_unavailable')
              : startupRecoveryInvariantSatisfied
                ? 'quote_transport_unavailable_startup_recovery'
                : 'quote_subscription_integration_invariant_violated',
        connectionActive: status?.connectionActive === true,
        trackedSubscriptionCount: status?.trackedSubscriptionCount ?? 0,
        runtimeDemandCount: status?.runtimeDemandCount ?? 0,
        browserDemandCount: status?.browserDemandCount ?? 0,
        pendingPlanCount: status?.pendingPlanCount ?? 0,
        currentHeadCount: status?.currentHeadCount ?? 0,
        resourceCoordinatorConfigured:
            status?.resourceCoordinatorConfigured === true,
        resourceEvidenceCurrent:
            resourceStatus?.subscriptionEvidenceCurrent === true,
        productionAdapterConfigured:
            transportStatus?.productionQuoteTransportConfigured === true,
        sharedExistingLogin: true,
        createsNewLogin: false,
        runtimeReadinessContribution: false,
        automaticResubscribeDispatchAllowed: false,
        subscriptionTransportAuthority: false,
        conditionEligibilityAuthority: false,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        subscriptionIdentifiersExposed: false,
    });
}

function projectTradeObserverStatus(observer) {
    try {
        const status = observer?.status();
        if (status && status.accountIdentifiersExposed === false) return status;
    } catch {
        // A status projection defect is itself fail closed.
    }
    return Object.freeze({
        state: 'observer_status_unavailable',
        fixedAccountCount: 0,
        confirmedAccountCount: 0,
        reconciliationRequired: true,
        accountIdentifiersExposed: false,
        eventIdentifiersExposed: false,
        runtimeReadinessContribution: false,
        brokerWriteAuthority: false,
    });
}

const CRITICAL_STREAM_LIFECYCLE_KEYS = Object.freeze([
    'observedWallTimeMs',
    'phase',
    'streamEpoch',
    'streamId',
]);

function snapshotCriticalStreamLifecycle(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('critical stream lifecycle is invalid');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Reflect.ownKeys(descriptors).length !==
            CRITICAL_STREAM_LIFECYCLE_KEYS.length ||
        !CRITICAL_STREAM_LIFECYCLE_KEYS.every((key) => {
            const descriptor = descriptors[key];
            return (
                descriptor?.enumerable === true &&
                Object.hasOwn(descriptor, 'value')
            );
        })
    ) {
        throw new TypeError(
            'critical stream lifecycle must use exact own data properties',
        );
    }
    return Object.freeze(
        Object.fromEntries(
            CRITICAL_STREAM_LIFECYCLE_KEYS.map((key) => [
                key,
                descriptors[key].value,
            ]),
        ),
    );
}

function controllerReleasedRuntimeLease(controller) {
    const status = controller.status();
    return Boolean(
        status?.state === 'closed' &&
            status.repositoryOpened === false &&
            status.tradingSenderAuthority === 'none',
    );
}

function controllerRetainsBlockedRuntime(controller, stopError) {
    if (stopError?.name !== 'RuntimeStopBlockedError') return false;
    const status = controller.status();
    return Boolean(
        status?.role === 'primary' &&
            ['observe_only', 'reconciling', 'quiescing'].includes(status.state) &&
            status.repositoryOpened === true &&
            status.dispatchAllowed === false &&
            status.tradingSenderAuthority === 'runtime_only',
    );
}

function startupFailureRecoverySidecar({
    controller,
    storage,
    apiGeneration,
    runtimeEpochId,
    quoteSubscriptionCoordinator,
    resourceCoordinator,
    officialMarketCalendarAuthority,
    unlinkDiscovery,
}) {
    let closed = false;
    let runtimeGapCoordinator;
    let generationFailoverPromise;

    async function removeStaleDiscovery() {
        await unlinkDiscovery(storage.paths.controlPlaneDiscoveryPath).catch(
            (error) => {
                if (error?.code !== 'ENOENT') throw error;
            },
        );
    }

    return Object.freeze({
        schemaVersion: SMART_ORDER_LOCAL_SIDECAR_SCHEMA_VERSION,
        role: 'primary',
        host: '127.0.0.1',
        port: null,
        runtimeEpochId,
        dispatchAllowed: false,
        createRuntimeGapCoordinator({
            observedWallTimeMs,
            observedMonotonicTimeMs,
        }) {
            if (closed) throw new Error('smart-order sidecar is closed');
            if (runtimeGapCoordinator) {
                throw new Error(
                    'runtime gap coordinator was already created for this RuntimeEpoch',
                );
            }
            runtimeGapCoordinator = createSmartOrderRuntimeGapCoordinator({
                runtimeController: controller,
                runtimeEpochId,
                apiGeneration,
                observedWallTimeMs,
                observedMonotonicTimeMs,
            });
            return runtimeGapCoordinator;
        },
        status() {
            const controllerStatus = controller.status();
            const released = controllerReleasedRuntimeLease(controller);
            return Object.freeze({
                ...controllerStatus,
                controlPlane: released
                    ? 'closed'
                    : 'startup_failed_fail_closed',
                startupRecoveryRequired: !released,
                quoteSubscription: projectQuoteSubscriptionStatus(
                    quoteSubscriptionCoordinator,
                    undefined,
                    resourceCoordinator,
                ),
                dispatchAllowed: false,
            });
        },
        async invalidateApiGeneration({
            observedApiGeneration,
            nowEpochMs: invalidatedAtEpochMs,
        }) {
            if (closed) throw new Error('smart-order sidecar is closed');
            return controller.invalidateApiGeneration({
                observedApiGeneration,
                nowEpochMs: epoch(
                    invalidatedAtEpochMs,
                    'invalidateApiGeneration.nowEpochMs',
                ),
            });
        },
        async closeForGenerationFailover({
            observedApiGeneration,
            nowEpochMs: invalidatedAtEpochMs,
        }) {
            if (generationFailoverPromise) return generationFailoverPromise;
            if (closed) return undefined;
            const failoverAt = epoch(
                invalidatedAtEpochMs,
                'closeForGenerationFailover.nowEpochMs',
            );
            generationFailoverPromise = (async () => {
                runtimeGapCoordinator?.stop();
                let result;
                let controllerError;
                let discoveryError;
                try {
                    result = await controller.closeForGenerationFailover({
                        observedApiGeneration,
                        nowEpochMs: failoverAt,
                    });
                } catch (error) {
                    controllerError = error;
                } finally {
                    if (controllerReleasedRuntimeLease(controller)) {
                        closed = true;
                        quoteSubscriptionCoordinator?.runtime.close();
                        resourceCoordinator.close();
                        officialMarketCalendarAuthority.close();
                    }
                }
                try {
                    await removeStaleDiscovery();
                } catch (error) {
                    discoveryError = error;
                }
                if (controllerError || discoveryError) {
                    throw controllerError && discoveryError
                        ? new AggregateError(
                              [controllerError, discoveryError],
                              'startup recovery generation handoff failed closed',
                          )
                        : (controllerError ?? discoveryError);
                }
                return result;
            })();
            return generationFailoverPromise;
        },
        async close({ nowEpochMs: stopAtEpochMs }) {
            if (closed) return;
            runtimeGapCoordinator?.stop();
            // A blocked stop remains observable by the supervisor and keeps
            // the exclusive Runtime lease. Never turn a control-plane startup
            // failure into an unmonitored local obligation.
            let result;
            try {
                result = await controller.stop({
                    nowEpochMs: epoch(stopAtEpochMs, 'close.nowEpochMs'),
                });
            } finally {
                if (controllerReleasedRuntimeLease(controller)) {
                    closed = true;
                }
            }
            if (!closed) {
                throw new Error(
                    'startup recovery stop did not release Runtime ownership',
                );
            }
            quoteSubscriptionCoordinator?.runtime.close();
            resourceCoordinator.close();
            officialMarketCalendarAuthority.close();
            await removeStaleDiscovery();
            return result;
        },
    });
}

export async function startSmartOrderLocalSidecar({
    appSupportRoot,
    apiGeneration,
    nowEpochMs,
    runtimeEpochId = randomUUID(),
    senderFence = randomUUID(),
    expectedOrigin = 'http://127.0.0.1:5173',
    port = 0,
    repositoryOptions = {},
    notificationOptions = {},
    startControlPlane = startSmartOrderControlPlaneServer,
    startTradeObserver = startSmartOrderShioajiTradeObserver,
    tradeObserverFetch = globalThis.fetch,
    unlinkDiscovery = unlink,
    now = () => Date.now(),
    monotonicNow = () => Math.floor(performance.now()),
}) {
    assertSmartOrderLocalSidecarTradeObserverRuntimeAuthority({
        productionObserver: startSmartOrderShioajiTradeObserver,
        startTradeObserver,
        tradeObserverFetch,
    });
    const startedAtEpochMs = epoch(nowEpochMs, 'nowEpochMs');
    const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot });
    // A barrier is published before the old primary releases its Runtime
    // lease and is removed only after the lifecycle caller has unloaded that
    // exact job.  Refuse a replacement while a crashed or not-yet-booted-out
    // handoff is outstanding.
    await assertPrivateLifecycleStopBarrierClear(
        storage.paths.lifecycleStopBarrierPath,
    );
    // This object never leaves the managed sidecar process and is created only
    // for the production control-plane implementation. Injected test/control
    // plane implementations receive no probe authority, so a sibling holding
    // the issued controller cannot manufacture CLI provenance by calling the
    // controller method directly.
    const gateProbeControlPlaneAuthority =
        startControlPlane === startSmartOrderControlPlaneServer
            ? Object.freeze({})
            : null;
    const strategyConfirmationControlPlaneAuthority =
        startControlPlane === startSmartOrderControlPlaneServer
            ? Object.freeze({})
            : null;
    const resourceCoordinator = createSmartOrderResourceCoordinator({
        nowEpochMs: now,
        nowMonotonicMs: monotonicNow,
    });
    const officialMarketCalendarAuthority =
        createSmartOrderOfficialMarketCalendarAuthority();
    let controller;
    try {
        controller = await startSmartOrderRuntimeController({
            appSupportRoot,
            apiGeneration,
            gateProbeControlPlaneAuthority,
            strategyConfirmationControlPlaneAuthority,
            nowEpochMs: startedAtEpochMs,
            runtimeEpochId,
            senderFence,
            repositoryOptions,
            resourceCoordinator,
            officialMarketCalendarAuthority,
        });
    } catch (error) {
        resourceCoordinator.close();
        officialMarketCalendarAuthority.close();
        throw error;
    }
    if (controller.role !== 'primary') {
        await controller.close();
        resourceCoordinator.close();
        officialMarketCalendarAuthority.close();
        return Object.freeze({
            schemaVersion: SMART_ORDER_LOCAL_SIDECAR_SCHEMA_VERSION,
            role: 'secondary_readonly',
            dispatchAllowed: false,
            status: controller.status,
            async close() {},
        });
    }

    let server;
    let notificationPump;
    let closed = false;
    let generationFailoverResult;
    let generationFailoverPromise;
    let runtimeGapCoordinator;
    let pendingRuntimeGapLifecycle;
    let quoteSubscriptionCoordinator;
    let tradeObserver;
    let protectionDemandSyncTimer;
    let protectionDemandSyncPromise;
    const protectionDemandHandles = new Map();
    let lifecycleStopBinding;
    let lifecycleStopPromise;
    let lifecycleStopPrecommitBinding;
    let resolveLifecycleStop;
    const lifecycleStop = new Promise((resolve) => {
        resolveLifecycleStop = resolve;
    });

    function reportRuntimeGapLifecycle(input) {
        const observation = snapshotCriticalStreamLifecycle(input);
        if (runtimeGapCoordinator) {
            return runtimeGapCoordinator.observeSseLifecycle(observation);
        }
        // The trade observer is started before the entrypoint mints the one
        // RuntimeEpoch gap coordinator. Retain only the first revocation-only
        // lifecycle event; a single gap is sufficient to require full
        // reconciliation and no queued event can unlock readiness.
        pendingRuntimeGapLifecycle ??= observation;
        return Object.freeze({
            queuedForRuntimeGapCoordinator: true,
            dispatchAllowed: false,
        });
    }
    function snapshotProtectionDemand(value) {
        if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            utilTypes.isProxy(value)
        ) {
            throw new TypeError('protective quote demand is invalid');
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = ['consumerId', 'contract', 'quoteType'];
        if (
            Reflect.ownKeys(descriptors).length !== keys.length ||
            !keys.every(
                (key) =>
                    descriptors[key]?.enumerable === true &&
                    Object.hasOwn(descriptors[key], 'value'),
            )
        ) {
            throw new TypeError(
                'protective quote demand must use exact own data properties',
            );
        }
        const contract = descriptors.contract.value;
        if (
            !contract ||
            typeof contract !== 'object' ||
            Array.isArray(contract) ||
            utilTypes.isProxy(contract)
        ) {
            throw new TypeError('protective quote demand contract is invalid');
        }
        const contractDescriptors = Object.getOwnPropertyDescriptors(contract);
        const contractKeys = ['code', 'exchange', 'securityType'];
        if (
            Reflect.ownKeys(contractDescriptors).length !==
                contractKeys.length ||
            !contractKeys.every(
                (key) =>
                    contractDescriptors[key]?.enumerable === true &&
                    Object.hasOwn(contractDescriptors[key], 'value'),
            ) ||
            typeof descriptors.consumerId.value !== 'string' ||
            !/^(?:protection|quick|good_till|multi_condition):[0-9a-f]{64}$/.test(
                descriptors.consumerId.value,
            ) ||
            !['tick', 'bidask'].includes(descriptors.quoteType.value) ||
            !['TSE', 'OTC'].includes(contractDescriptors.exchange.value) ||
            contractDescriptors.securityType.value !== 'STK' ||
            typeof contractDescriptors.code.value !== 'string' ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
                contractDescriptors.code.value,
            )
        ) {
            throw new TypeError('protective quote demand projection is invalid');
        }
        return Object.freeze({
            consumerId: descriptors.consumerId.value,
            contract: Object.freeze({
                code: contractDescriptors.code.value,
                exchange: contractDescriptors.exchange.value,
                securityType: contractDescriptors.securityType.value,
            }),
            quoteType: descriptors.quoteType.value,
        });
    }
    function snapshotGoodTillRenewalContext(value) {
        if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            utilTypes.isProxy(value)
        ) {
            throw new TypeError('good-till renewal context is invalid');
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = [
            'accountBrokerRef',
            'accountIdRef',
            'monitorContractKey',
            'orderContractKey',
            'snapshotHash',
            'strategyId',
            'strategyRevision',
        ];
        if (
            Reflect.ownKeys(descriptors).length !== keys.length ||
            !keys.every(
                (key) =>
                    descriptors[key]?.enumerable === true &&
                    Object.hasOwn(descriptors[key], 'value'),
            ) ||
            !Number.isSafeInteger(descriptors.strategyRevision.value) ||
            descriptors.strategyRevision.value < 0 ||
            !/^sha256:[a-f0-9]{64}$/.test(descriptors.snapshotHash.value)
        ) {
            throw new TypeError(
                'good-till renewal context must use exact own data properties',
            );
        }
        for (const key of [
            'accountBrokerRef',
            'accountIdRef',
            'monitorContractKey',
            'orderContractKey',
            'strategyId',
        ]) {
            if (
                typeof descriptors[key].value !== 'string' ||
                descriptors[key].value.length < 1
            ) {
                throw new TypeError(`good-till renewal ${key} is invalid`);
            }
        }
        return Object.freeze(
            Object.fromEntries(
                keys.map((key) => [key, descriptors[key].value]),
            ),
        );
    }
    function snapshotMultiConditionRenewalContext(value) {
        if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            utilTypes.isProxy(value)
        ) {
            throw new TypeError('multi-condition renewal context is invalid');
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = [
            'accountBrokerRef',
            'accountIdRef',
            'monitorContractKeys',
            'orderContractKey',
            'snapshotHash',
            'strategyId',
            'strategyRevision',
        ];
        if (
            Reflect.ownKeys(descriptors).length !== keys.length ||
            !keys.every(
                (key) =>
                    descriptors[key]?.enumerable === true &&
                    Object.hasOwn(descriptors[key], 'value'),
            )
        ) {
            throw new TypeError(
                'multi-condition renewal context must use exact own data properties',
            );
        }
        const monitorContractKeys = descriptors.monitorContractKeys.value;
        const monitorContractDescriptors =
            Array.isArray(monitorContractKeys) &&
            !utilTypes.isProxy(monitorContractKeys)
                ? Object.getOwnPropertyDescriptors(monitorContractKeys)
                : null;
        if (
            monitorContractDescriptors === null ||
            !Object.hasOwn(monitorContractDescriptors, 'length') ||
            !Object.hasOwn(monitorContractDescriptors.length, 'value') ||
            !Number.isSafeInteger(monitorContractDescriptors.length.value) ||
            monitorContractDescriptors.length.value < 1 ||
            monitorContractDescriptors.length.value > 7 ||
            Reflect.ownKeys(monitorContractDescriptors).length !==
                monitorContractDescriptors.length.value + 1
        ) {
            throw new TypeError('multi-condition renewal monitor contracts are invalid');
        }
        const canonicalMonitorContractKeys = [];
        for (
            let index = 0;
            index < monitorContractDescriptors.length.value;
            index += 1
        ) {
            const descriptor = monitorContractDescriptors[String(index)];
            if (
                descriptor?.enumerable !== true ||
                !Object.hasOwn(descriptor, 'value') ||
                typeof descriptor.value !== 'string' ||
                !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
                    descriptor.value,
                )
            ) {
                throw new TypeError(
                    'multi-condition renewal monitor contracts are invalid',
                );
            }
            canonicalMonitorContractKeys.push(descriptor.value);
        }
        return Object.freeze({
            accountBrokerRef: descriptors.accountBrokerRef.value,
            accountIdRef: descriptors.accountIdRef.value,
            monitorContractKeys: Object.freeze(canonicalMonitorContractKeys),
            orderContractKey: descriptors.orderContractKey.value,
            snapshotHash: descriptors.snapshotHash.value,
            strategyId: descriptors.strategyId.value,
            strategyRevision: descriptors.strategyRevision.value,
        });
    }
    async function syncProtectionQuoteDemands() {
        if (
            closed ||
            startTradeObserver !== startSmartOrderShioajiTradeObserver
        ) {
            return;
        }
        if (protectionDemandSyncPromise) return protectionDemandSyncPromise;
        protectionDemandSyncPromise = (async () => {
            const quoteResourceAdmissionConfigured =
                quoteSubscriptionCoordinator?.observer.status()
                    ?.resourceCoordinatorConfigured === true;
            const renewalContexts = quoteResourceAdmissionConfigured
                ? await controller.listGoodTillConfirmationRenewalContexts()
                : [];
            const multiRenewalContexts = quoteResourceAdmissionConfigured
                ? await controller.listMultiConditionConfirmationRenewalContexts()
                : [];
            if (
                !Array.isArray(renewalContexts) ||
                utilTypes.isProxy(renewalContexts)
            ) {
                throw new TypeError(
                    'good-till renewal context projection must be an array',
                );
            }
            for (const candidate of renewalContexts) {
                const context = snapshotGoodTillRenewalContext(candidate);
                const orderContractEvidence =
                    await tradeObserver.issueCanonicalContractEvidence({
                        accountBrokerRef: context.accountBrokerRef,
                        accountIdRef: context.accountIdRef,
                        contractKey: context.orderContractKey,
                        decisionTradingDate: null,
                        fixedAtrRequired: false,
                        strategyDefinitionHash: null,
                    });
                const monitorContractEvidence =
                    await tradeObserver.issueCanonicalContractEvidence({
                        accountBrokerRef: context.accountBrokerRef,
                        accountIdRef: context.accountIdRef,
                        contractKey: context.monitorContractKey,
                        decisionTradingDate: null,
                        fixedAtrRequired: false,
                        strategyDefinitionHash: null,
                    });
                const refreshed =
                    await controller.refreshGoodTillConfirmationEvidence({
                        monitorContractEvidence,
                        orderContractEvidence,
                        snapshotHash: context.snapshotHash,
                        strategyId: context.strategyId,
                    });
                if (
                    refreshed?.state !== 'refreshed' ||
                    refreshed.brokerWriteAuthority !== false ||
                    refreshed.automaticDispatchAllowed !== false
                ) {
                    throw new Error(
                        'good-till confirmation renewal failed closed',
                    );
                }
            }
            if (
                !Array.isArray(multiRenewalContexts) ||
                utilTypes.isProxy(multiRenewalContexts)
            ) {
                throw new TypeError(
                    'multi-condition renewal context projection must be an array',
                );
            }
            for (const candidate of multiRenewalContexts) {
                const context = snapshotMultiConditionRenewalContext(candidate);
                const orderContractEvidence =
                    await tradeObserver.issueCanonicalContractEvidence({
                        accountBrokerRef: context.accountBrokerRef,
                        accountIdRef: context.accountIdRef,
                        contractKey: context.orderContractKey,
                        decisionTradingDate: null,
                        fixedAtrRequired: false,
                        strategyDefinitionHash: null,
                    });
                const monitorContractEvidence = await Promise.all(
                    context.monitorContractKeys.map((contractKey) =>
                        tradeObserver.issueCanonicalContractEvidence({
                            accountBrokerRef: context.accountBrokerRef,
                            accountIdRef: context.accountIdRef,
                            contractKey,
                            decisionTradingDate: null,
                            fixedAtrRequired: false,
                            strategyDefinitionHash: null,
                        }),
                    ),
                );
                const refreshed =
                    await controller.refreshMultiConditionConfirmationEvidence({
                        monitorContractEvidence,
                        orderContractEvidence,
                        snapshotHash: context.snapshotHash,
                        strategyId: context.strategyId,
                    });
                if (
                    refreshed?.state !== 'refreshed' ||
                    refreshed.brokerWriteAuthority !== false ||
                    refreshed.automaticDispatchAllowed !== false
                ) {
                    throw new Error(
                        'multi-condition confirmation renewal failed closed',
                    );
                }
            }
            const projected = await controller.listSmartOrderQuoteDemands();
            if (!Array.isArray(projected) || utilTypes.isProxy(projected)) {
                throw new TypeError(
                    'protective quote demand projection must be an array',
                );
            }
            const next = new Map();
            for (const candidate of projected) {
                const demand = snapshotProtectionDemand(candidate);
                if (next.has(demand.consumerId)) {
                    throw new Error('protective quote demand is duplicated');
                }
                next.set(demand.consumerId, demand);
            }
            for (const [consumerId, handle] of protectionDemandHandles) {
                if (!next.has(consumerId)) {
                    await tradeObserver.releaseRuntimeQuoteDemand(handle);
                    protectionDemandHandles.delete(consumerId);
                }
            }
            for (const [consumerId, demand] of next) {
                if (protectionDemandHandles.has(consumerId)) continue;
                const handle = await tradeObserver.acquireRuntimeQuoteDemand(
                    demand,
                );
                if (
                    !handle ||
                    typeof handle !== 'object' ||
                    handle.brokerWriteAuthority !== false
                ) {
                    throw new Error(
                        'protective quote demand acquisition failed closed',
                    );
                }
                protectionDemandHandles.set(consumerId, handle);
            }
        })();
        try {
            await protectionDemandSyncPromise;
        } finally {
            protectionDemandSyncPromise = undefined;
        }
    }
    async function stopProtectionQuoteDemandSync() {
        if (protectionDemandSyncTimer !== undefined) {
            clearInterval(protectionDemandSyncTimer);
            protectionDemandSyncTimer = undefined;
        }
        await protectionDemandSyncPromise?.catch(() => {});
    }
    try {
        quoteSubscriptionCoordinator =
            createSmartOrderQuoteSubscriptionCoordinator({
                apiGeneration,
                connectionId: 'quote-transport-awaiting-sse',
                nowMonotonicMs: monotonicNow,
                resourceCoordinator,
                resourceCountingDimension:
                    SMART_ORDER_UNVERIFIED_SUBSCRIPTION_COUNTING_DIMENSION,
            });
        const quoteDisconnected =
            quoteSubscriptionCoordinator.runtime.markDisconnected({
                apiGeneration,
                connectionId: 'quote-transport-awaiting-sse',
            });
        if (quoteDisconnected.allowed !== true) {
            throw new Error(
                'quote subscription coordinator did not enter fail-closed disconnected state',
            );
        }
        tradeObserver = await startTradeObserver({
            apiGeneration,
            cancelRetry: clearTimeout,
            fetchImpl: tradeObserverFetch,
            nowEpochMs: now,
            nowMonotonicMs: monotonicNow,
            quoteSubscriptionCoordinator,
            resourceCoordinator,
            reportRuntimeGapLifecycle,
            runtimeController: controller,
            runtimeEpochId,
            scheduleRetry: setTimeout,
        });
        if (startTradeObserver === startSmartOrderShioajiTradeObserver) {
            await syncProtectionQuoteDemands();
            protectionDemandSyncTimer = setInterval(() => {
                void syncProtectionQuoteDemands().catch(() => {
                    // A missing/stale demand projection stays off-wire and
                    // cannot grant activation or broker authority. Retry on
                    // the next bounded read-side pass.
                });
            }, 1_000);
            protectionDemandSyncTimer.unref?.();
        }
        // The controller has acquired the exclusive Runtime lease at this
        // point. Rotate before publishing discovery so a secondary process can
        // neither replace the current key nor advertise a stale authority.
        await unlinkDiscovery(storage.paths.controlPlaneDiscoveryPath).catch(
            (error) => {
                if (error?.code !== 'ENOENT') throw error;
            },
        );
        await unlinkDiscovery(storage.paths.lifecycleStopCompletionPath).catch(
            (error) => {
                if (error?.code !== 'ENOENT') throw error;
            },
        );
        await rotatePrivateGatewayCapability(storage.paths.capabilityPath);
        if (startControlPlane === startSmartOrderControlPlaneServer) {
            await rotatePrivateGatewayCapability(
                storage.paths.gateProbeCliCapabilityPath,
            );
        }
        try {
            notificationPump = await startSmartOrderLocalNotificationPump({
                ...notificationOptions,
                readEvents: (input) => controller.listEvents(input),
            });
        } catch {
            // Desktop notifications are a best-effort convenience only. A
            // missing permission, unavailable osascript, or notification
            // adapter defect must never stop the durable Runtime or change a
            // strategy/broker state.
            notificationPump = Object.freeze({
                authoritativeForBrokerState: false,
                async close() {},
            });
        }
        const capability = await readPrivateSecret(storage.paths.capabilityPath);
        const gateProbeCliCapability =
            startControlPlane === startSmartOrderControlPlaneServer
                ? await readPrivateSecret(
                      storage.paths.gateProbeCliCapabilityPath,
                  )
                : null;
        try {
            server = await startControlPlane({
                capability,
                ...(gateProbeCliCapability === null
                    ? {}
                    : { gateProbeCliCapability }),
                gateProbeControlPlaneAuthority,
                strategyConfirmationControlPlaneAuthority,
                strategyConfirmationEvidenceProvider:
                    startControlPlane === startSmartOrderControlPlaneServer
                        ? async (input) => {
                              if (
                                  input.strategyId !== null &&
                                  input.expectedRevision !== null &&
                                  typeof input.decisionTradingDate ===
                                      'string' &&
                                  typeof input.fixedAtrRequired ===
                                      'boolean' &&
                                  typeof input.strategyDefinitionHash ===
                                      'string'
                              ) {
                                  return tradeObserver.issueCanonicalContractEvidence(
                                      {
                                          accountBrokerRef:
                                              input.accountBrokerRef,
                                          accountIdRef: input.accountIdRef,
                                          contractKey: input.contractKey,
                                          decisionTradingDate:
                                              input.decisionTradingDate,
                                          fixedAtrRequired:
                                              input.fixedAtrRequired,
                                          strategyDefinitionHash:
                                              input.strategyDefinitionHash,
                                      },
                                  );
                              }
                              if (
                                  input.strategyId === null &&
                                  input.expectedRevision === null
                              ) {
                                  return tradeObserver.issueCanonicalContractEvidence(
                                      {
                                          accountBrokerRef:
                                              input.accountBrokerRef,
                                          accountIdRef: input.accountIdRef,
                                          contractKey: input.contractKey,
                                          decisionTradingDate: null,
                                          fixedAtrRequired: false,
                                          strategyDefinitionHash: null,
                                      },
                                  );
                              }
                              const context =
                                  await controller.strategyConfirmationEvidenceContext(
                                      {
                                          accountBrokerRef:
                                              input.accountBrokerRef,
                                          accountIdRef: input.accountIdRef,
                                          expectedRevision:
                                              input.expectedRevision,
                                          strategyId: input.strategyId,
                                      },
                                  );
                              if (
                                  ![
                                      context.contractKey,
                                      context.monitorContractKey,
                                      ...(Array.isArray(
                                          context.monitorContractKeys,
                                      )
                                          ? context.monitorContractKeys
                                          : []),
                                  ].includes(input.contractKey) ||
                                  context.strategyId !== input.strategyId ||
                                  context.strategyRevision !==
                                      input.expectedRevision ||
                                  context.brokerWriteAuthority !== false
                              ) {
                                  throw new Error(
                                      'strategy confirmation evidence context drifted',
                                  );
                              }
                              return tradeObserver.issueCanonicalContractEvidence(
                                  {
                                      accountBrokerRef:
                                          input.accountBrokerRef,
                                      accountIdRef: input.accountIdRef,
                                      contractKey: input.contractKey,
                                      decisionTradingDate:
                                          context.decisionTradingDate,
                                      fixedAtrRequired:
                                          context.fixedAtrRequired,
                                      strategyDefinitionHash:
                                          context.strategyDefinitionHash,
                                  },
                              );
                          }
                        : null,
                quoteReadinessProvider:
                    startControlPlane === startSmartOrderControlPlaneServer
                        ? () => tradeObserver.protectiveQuoteStatus()
                        : null,
                runtimeEpochId,
                runtimeController: controller,
                onLifecycleStopPrecommit,
                onLifecycleStopAborted,
                onLifecycleStopCommitted,
                expectedOrigin,
                port,
                now,
            });
        } finally {
            capability.fill(0);
            gateProbeCliCapability?.fill(0);
        }
        await writePrivateRuntimeDiscovery(
            storage.paths.controlPlaneDiscoveryPath,
            {
                schemaVersion: SMART_ORDER_LOCAL_SIDECAR_SCHEMA_VERSION,
                host: server.host,
                port: server.port,
                runtimeEpochId,
                startedAtEpochMs,
            },
        );
        async function closePublishedControlPlane() {
            // Stop the listener before removing its advertisement.  The
            // exclusive Runtime lease is still held by the caller, so no
            // replacement can publish a new discovery document in between.
            const results = await Promise.allSettled([
                notificationPump.close(),
                server.close(),
            ]);
            try {
                await unlinkDiscovery(storage.paths.controlPlaneDiscoveryPath);
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    results.push({ status: 'rejected', reason: error });
                }
            }
            closed = true;
            const failure = results.find(
                (result) => result.status === 'rejected',
            );
            if (failure?.status === 'rejected') throw failure.reason;
        }

        async function onLifecycleStopPrecommit(precommit) {
            if (lifecycleStopPrecommitBinding !== undefined) {
                if (
                    JSON.stringify(lifecycleStopPrecommitBinding) !==
                    JSON.stringify(precommit)
                ) {
                    throw new Error(
                        'lifecycle stop pre-commit conflicts with its in-flight binding',
                    );
                }
                return;
            }
            const capability = await readPrivateSecret(
                storage.paths.capabilityPath,
            );
            try {
                await writePrivateLifecycleStopBarrier(
                    storage.paths.lifecycleStopBarrierPath,
                    { capability, binding: precommit },
                );
                lifecycleStopPrecommitBinding = Object.freeze({
                    ...precommit,
                });
            } finally {
                capability.fill(0);
            }
        }

        async function onLifecycleStopAborted(precommit) {
            if (
                lifecycleStopPrecommitBinding === undefined ||
                JSON.stringify(lifecycleStopPrecommitBinding) !==
                    JSON.stringify(precommit)
            ) {
                throw new Error(
                    'lifecycle stop abort does not match the published pre-commit barrier',
                );
            }
            const capability = await readPrivateSecret(
                storage.paths.capabilityPath,
            );
            try {
                await removePrivateLifecycleStopBarrier(
                    storage.paths.lifecycleStopBarrierPath,
                    { capability, expected: precommit },
                );
                lifecycleStopPrecommitBinding = undefined;
            } finally {
                capability.fill(0);
            }
        }

        async function onLifecycleStopCommitted(stopCommit) {
            const binding = JSON.stringify(stopCommit);
            if (lifecycleStopBinding !== undefined) {
                if (lifecycleStopBinding !== binding) {
                    throw new Error(
                        'lifecycle stop callback conflicts with the committed stop',
                    );
                }
                return lifecycleStopPromise;
            }
            lifecycleStopBinding = binding;
            lifecycleStopPromise = (async () => {
                runtimeGapCoordinator?.stop();
                await stopProtectionQuoteDemandSync();
                await tradeObserver?.close();
                quoteSubscriptionCoordinator?.runtime.close();
                const completionCapability = await readPrivateSecret(
                    storage.paths.capabilityPath,
                );
                try {
                    const completionBinding = {
                        operation: stopCommit.operation,
                        runtimeEpochIdSha256:
                            stopCommit.runtimeEpochIdSha256,
                        apiGenerationSha256:
                            stopCommit.apiGenerationSha256,
                        stopRevision: stopCommit.stopRevision,
                        completionNonceSha256:
                            stopCommit.completionNonceSha256,
                        requestIdSha256: stopCommit.requestIdSha256,
                    };
                    if (
                        lifecycleStopPrecommitBinding === undefined ||
                        JSON.stringify(lifecycleStopPrecommitBinding) !==
                            JSON.stringify(completionBinding)
                    ) {
                        throw new Error(
                            'durable lifecycle stop is missing its exact pre-commit barrier',
                        );
                    }
                    await verifyPrivateLifecycleStopBarrier(
                        storage.paths.lifecycleStopBarrierPath,
                        {
                            capability: completionCapability,
                            expected: completionBinding,
                        },
                    );
                    // The Runtime lease remains held until the listener and
                    // its discovery record are both gone.  A replacement can
                    // therefore never be mistaken for this completed stop.
                    await closePublishedControlPlane();
                    const release = await controller.releaseStoppedRuntime();
                    if (
                        release?.state !== 'closed' ||
                        release.repositoryClosed !== true ||
                        release.runtimeLeaseReleased !== true
                    ) {
                        throw new Error(
                            'lifecycle stop did not release exact Runtime ownership',
                        );
                    }
                    resourceCoordinator.close();
                    officialMarketCalendarAuthority.close();
                    await writePrivateLifecycleStopCompletion(
                        storage.paths.lifecycleStopCompletionPath,
                        {
                            capability: completionCapability,
                            completion: {
                                ...completionBinding,
                                completedAtEpochMs: Math.max(
                                    startedAtEpochMs,
                                    now(),
                                ),
                                repositoryClosed: true,
                                controlPlaneUnpublished: true,
                                runtimeLeaseReleased: true,
                            },
                        },
                    );
                    const result = Object.freeze({
                        state: 'closed',
                        operation: stopCommit.operation,
                        stopRevision: stopCommit.stopRevision,
                        dispatchAllowed: false,
                        brokerWriteAttempted: false,
                    });
                    resolveLifecycleStop(result);
                    return result;
                } finally {
                    completionCapability.fill(0);
                }
            })();
            return lifecycleStopPromise;
        }

        return Object.freeze({
            schemaVersion: SMART_ORDER_LOCAL_SIDECAR_SCHEMA_VERSION,
            role: 'primary',
            host: server.host,
            port: server.port,
            runtimeEpochId,
            dispatchAllowed: false,
            lifecycleStop,
            createRuntimeGapCoordinator({
                observedWallTimeMs,
                observedMonotonicTimeMs,
            }) {
                if (closed) throw new Error('smart-order sidecar is closed');
                if (runtimeGapCoordinator) {
                    throw new Error(
                        'runtime gap coordinator was already created for this RuntimeEpoch',
                    );
                }
                runtimeGapCoordinator = createSmartOrderRuntimeGapCoordinator({
                    runtimeController: controller,
                    runtimeEpochId,
                    apiGeneration,
                    observedWallTimeMs,
                    observedMonotonicTimeMs,
                });
                if (pendingRuntimeGapLifecycle) {
                    runtimeGapCoordinator.observeSseLifecycle(
                        pendingRuntimeGapLifecycle,
                    );
                    pendingRuntimeGapLifecycle = undefined;
                }
                return runtimeGapCoordinator;
            },
            status() {
                return Object.freeze({
                    ...controller.status(),
                    controlPlane: closed ? 'closed' : 'loopback_authenticated',
                    quoteSubscription: projectQuoteSubscriptionStatus(
                        quoteSubscriptionCoordinator,
                        tradeObserver,
                        resourceCoordinator,
                    ),
                    tradeSubscription: projectTradeObserverStatus(tradeObserver),
                    dispatchAllowed: false,
                });
            },
            async acquireRuntimeQuoteDemand(input) {
                if (closed) throw new Error('smart-order sidecar is closed');
                return tradeObserver.acquireRuntimeQuoteDemand(input);
            },
            async releaseRuntimeQuoteDemand(handle) {
                if (closed) throw new Error('smart-order sidecar is closed');
                return tradeObserver.releaseRuntimeQuoteDemand(handle);
            },
            async invalidateApiGeneration({
                observedApiGeneration,
                nowEpochMs: invalidatedAtEpochMs,
            }) {
                if (closed) throw new Error('smart-order sidecar is closed');
                return controller.invalidateApiGeneration({
                    observedApiGeneration,
                    nowEpochMs: epoch(
                        invalidatedAtEpochMs,
                        'invalidateApiGeneration.nowEpochMs',
                    ),
                });
            },
            async closeForGenerationFailover({
                observedApiGeneration,
                nowEpochMs: invalidatedAtEpochMs,
            }) {
                if (generationFailoverResult) return generationFailoverResult;
                if (generationFailoverPromise) return generationFailoverPromise;
                if (closed) return undefined;
                const failoverAt = epoch(
                    invalidatedAtEpochMs,
                    'closeForGenerationFailover.nowEpochMs',
                );
                generationFailoverPromise = (async () => {
                    const failures = [];
                    runtimeGapCoordinator?.stop();
                    await stopProtectionQuoteDemandSync();
                    // Keep the exclusive sender lease while first latching and
                    // durably invalidating the old generation.  Only after the
                    // old control plane and discovery are gone may the
                    // controller release that lease for a replacement process.
                    try {
                        await controller.invalidateApiGeneration({
                            observedApiGeneration,
                            nowEpochMs: failoverAt,
                        });
                    } catch (error) {
                        failures.push(error);
                    } finally {
                        // The controller synchronously latches dispatch before
                        // awaiting durable invalidation. Only then retire quote
                        // monitoring for this process incarnation.
                        try {
                            await tradeObserver?.close();
                        } catch (error) {
                            failures.push(error);
                        }
                        quoteSubscriptionCoordinator?.runtime.close();
                    }
                    try {
                        await closePublishedControlPlane();
                    } catch (error) {
                        failures.push(error);
                    }
                    try {
                        generationFailoverResult =
                            await controller.closeForGenerationFailover({
                                observedApiGeneration,
                                nowEpochMs: failoverAt,
                            });
                    } catch (error) {
                        failures.push(error);
                    }
                    resourceCoordinator.close();
                    officialMarketCalendarAuthority.close();
                    if (failures.length > 0) {
                        throw failures.length === 1
                            ? failures[0]
                            : new AggregateError(
                                  failures,
                                  'smart-order generation failover failed closed',
                              );
                    }
                    return generationFailoverResult;
                })();
                return generationFailoverPromise;
            },
            async close({ nowEpochMs: stopAtEpochMs }) {
                if (closed) return;
                runtimeGapCoordinator?.stop();
                await stopProtectionQuoteDemandSync();
                await controller.stop({
                    nowEpochMs: epoch(stopAtEpochMs, 'close.nowEpochMs'),
                });
                await tradeObserver?.close();
                quoteSubscriptionCoordinator?.runtime.close();
                resourceCoordinator.close();
                officialMarketCalendarAuthority.close();
                await closePublishedControlPlane();
            },
        });
    } catch (error) {
        await stopProtectionQuoteDemandSync();
        await tradeObserver?.close().catch(() => {});
        await notificationPump?.close().catch(() => {});
        await server?.close().catch(() => {});
        let stopError;
        try {
            await controller.stop({
                nowEpochMs: Math.max(startedAtEpochMs, now()),
            });
        } catch (caught) {
            stopError = caught;
        }
        let discoveryError;
        await unlinkDiscovery(storage.paths.controlPlaneDiscoveryPath).catch(
            (unlinkError) => {
                if (unlinkError?.code !== 'ENOENT') {
                    discoveryError = unlinkError;
                }
            },
        );
        if (controllerRetainsBlockedRuntime(controller, stopError)) {
            return startupFailureRecoverySidecar({
                controller,
                storage,
                apiGeneration,
                runtimeEpochId,
                quoteSubscriptionCoordinator,
                resourceCoordinator,
                officialMarketCalendarAuthority,
                unlinkDiscovery,
            });
        }
        quoteSubscriptionCoordinator?.runtime.close();
        resourceCoordinator.close();
        officialMarketCalendarAuthority.close();
        const cleanupErrors = [stopError, discoveryError].filter(Boolean);
        if (cleanupErrors.length > 0) {
            throw new AggregateError(
                [error, ...cleanupErrors],
                'smart-order sidecar startup and cleanup failed closed',
            );
        }
        throw error;
    }
}
