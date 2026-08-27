import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
} from './quick-field-mapping.mjs';
import { isTrustedSmartOrderQuickFieldNormalization } from './quick-field-normalizer.mjs';

export const SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION =
    'smart-order-quote-subscription-coordinator/2026-08-12.1';
export const SMART_ORDER_QUOTE_FRESHNESS_TTL_MS = 3_000;
export const SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS = 160;
export const SMART_ORDER_QUOTE_MAX_TOTAL_DEMANDS = 4_096;
export const SMART_ORDER_QUOTE_TYPES = Object.freeze(['tick', 'bidask']);

const QUOTE_TYPE_SET = new Set(SMART_ORDER_QUOTE_TYPES);
const EXCHANGE_SET = new Set(['TSE', 'OTC']);
const SUBSCRIPTION_INPUT_KEYS = Object.freeze([
    'consumerId',
    'contract',
    'quoteType',
]);
const CONTRACT_KEYS = Object.freeze(['code', 'exchange', 'securityType']);
const SUBSCRIPTION_LOOKUP_KEYS = Object.freeze(['contract', 'quoteType']);
const CONNECTION_KEYS = Object.freeze(['apiGeneration', 'connectionId']);
const PLAN_CONFIRMATION_KEYS = Object.freeze([
    'action',
    'apiGeneration',
    'connectionId',
    'planId',
]);
const PLAN_FAILURE_KEYS = Object.freeze([
    'action',
    'apiGeneration',
    'connectionId',
    'planId',
    'reason',
]);
const OBSERVATION_KEYS = Object.freeze([
    'observationId',
    'streamSequence',
]);
const CONSTRUCTOR_KEYS = Object.freeze([
    'apiGeneration',
    'connectionId',
    'nowMonotonicMs',
    'resourceCoordinator',
    'resourceCountingDimension',
]);
const PLAN_FAILURE_REASONS = new Set([
    'subscribe_failed',
    'unsubscribe_failed',
    'transport_disconnected',
    'transport_timeout',
]);
const PLAN_BLOCKED_PHYSICAL_STATES = new Set([
    'subscribe_failed_closed',
    'subscribe_result_unknown',
    'stream_identity_collision',
    'stream_sequence_collision',
    'unsubscribe_failed_unknown',
]);
const UNKNOWN_PHYSICAL_SUBSCRIPTION_STATES = new Set([
    'subscribe_result_unknown',
    'stream_identity_collision',
    'stream_sequence_collision',
    'unsubscribe_failed_unknown',
]);
const ISSUED_PROTECTIVE_QUOTE_OBSERVATIONS = new WeakSet();
const ISSUED_QUICK_CONDITION_OBSERVATIONS = new WeakSet();

export function isTrustedSmartOrderProtectiveQuoteObservation(value) {
    try {
        return Boolean(
            value &&
                typeof value === 'object' &&
                !utilTypes.isProxy(value) &&
                ISSUED_PROTECTIVE_QUOTE_OBSERVATIONS.has(value),
        );
    } catch {
        return false;
    }
}

export function isTrustedSmartOrderQuickConditionObservation(value) {
    try {
        return Boolean(
            value &&
                typeof value === 'object' &&
                !utilTypes.isProxy(value) &&
                ISSUED_QUICK_CONDITION_OBSERVATIONS.has(value),
        );
    } catch {
        return false;
    }
}

function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
    if (
        value === null ||
        typeof value !== 'object' ||
        Object.isFrozen(value)
    ) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function deny(reason, details = {}) {
    return deepFreeze({
        allowed: false,
        reason,
        ...details,
        subscriptionTransportAuthority: false,
        conditionEligibilityAuthority: false,
        brokerWriteAuthority: false,
    });
}

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function snapshotExactDataProperties(value, expectedKeys, label) {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} descriptors are unavailable`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} must be a plain object`);
    }
    const actualKeys = Reflect.ownKeys(descriptors);
    if (actualKeys.some((key) => typeof key !== 'string')) {
        throw new TypeError(`${label} symbol properties are forbidden`);
    }
    const sortedActual = [...actualKeys].sort();
    const sortedExpected = [...expectedKeys].sort();
    if (
        sortedActual.length !== sortedExpected.length ||
        !sortedActual.every((key, index) => key === sortedExpected[index])
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const snapshot = {};
    for (const key of expectedKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use enumerable own data properties`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function snapshotAllDataProperties(value, label) {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} descriptors are unavailable`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} must be a plain object`);
    }
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) {
        throw new TypeError(`${label} symbol properties are forbidden`);
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
            throw new TypeError(`${label} must use enumerable own data properties`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function boundedToken(value, label, maximum = 256) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function normalizeContract(value) {
    const snapshot = snapshotExactDataProperties(
        value,
        CONTRACT_KEYS,
        'canonical quote contract',
    );
    const exchange = boundedToken(snapshot.exchange, 'contract.exchange', 8);
    const securityType = boundedToken(
        snapshot.securityType,
        'contract.securityType',
        16,
    );
    const code = boundedToken(snapshot.code, 'contract.code', 32);
    if (
        !EXCHANGE_SET.has(exchange) ||
        securityType !== 'STK' ||
        !/^[A-Za-z0-9.-]+$/.test(code)
    ) {
        throw new TypeError('canonical quote contract is unsupported');
    }
    return Object.freeze({ code, exchange, securityType });
}

function normalizeQuoteType(value) {
    if (!QUOTE_TYPE_SET.has(value)) {
        throw new TypeError('quoteType is unsupported');
    }
    return value;
}

function normalizeSubscriptionInput(value) {
    const snapshot = snapshotExactDataProperties(
        value,
        SUBSCRIPTION_INPUT_KEYS,
        'quote demand',
    );
    const contract = normalizeContract(snapshot.contract);
    const quoteType = normalizeQuoteType(snapshot.quoteType);
    const consumerId = boundedToken(snapshot.consumerId, 'consumerId', 240);
    return Object.freeze({ consumerId, contract, quoteType });
}

function normalizeLookup(value) {
    const snapshot = snapshotExactDataProperties(
        value,
        SUBSCRIPTION_LOOKUP_KEYS,
        'quote subscription lookup',
    );
    return Object.freeze({
        contract: normalizeContract(snapshot.contract),
        quoteType: normalizeQuoteType(snapshot.quoteType),
    });
}

function subscriptionKey(contract, quoteType) {
    return JSON.stringify([
        contract.exchange,
        contract.securityType,
        contract.code,
        quoteType,
    ]);
}

function subscriptionKeySha256(key) {
    return `sha256:${sha256Hex(`smart-order-quote-subscription\u001f${key}`)}`;
}

function snapshotResourceCapability(value) {
    if (value === null) return undefined;
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError('resourceCoordinator must be an object capability');
    }
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError('resourceCoordinator descriptors are unavailable');
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(
                `resourceCoordinator.${key} must be an own data property`,
            );
        }
    }
    if (
        Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')
    ) {
        throw new TypeError('resourceCoordinator symbol properties are forbidden');
    }
    for (const methodName of ['reserveSubscriptionDemand', 'status']) {
        const descriptor = descriptors[methodName];
        if (
            !descriptor ||
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set') ||
            typeof descriptor.value !== 'function' ||
            isProxy(descriptor.value)
        ) {
            throw new TypeError(
                `resourceCoordinator.${methodName} must be an own data method`,
            );
        }
    }
    return Object.freeze({
        receiver: value,
        reserveSubscriptionDemand: descriptors.reserveSubscriptionDemand.value,
        status: descriptors.status.value,
    });
}

function validateReservationLease(value, expected) {
    const snapshot = snapshotAllDataProperties(
        value,
        'subscription reservation lease',
    );
    if (
        snapshot.allowed !== true ||
        snapshot.demandId !== expected.demandId ||
        snapshot.countingDimension !== expected.countingDimension ||
        snapshot.units !== 1 ||
        snapshot.brokerAuthority !== false ||
        !Number.isSafeInteger(snapshot.projectedUsageUnits) ||
        snapshot.projectedUsageUnits < 1 ||
        typeof snapshot.release !== 'function' ||
        isProxy(snapshot.release)
    ) {
        throw new TypeError('subscription reservation lease is invalid');
    }
    return Object.freeze({
        receiver: value,
        release: snapshot.release,
    });
}

/**
 * Pure Node/server quote-subscription state coordinator for task 5.6.
 *
 * It deliberately has no Shioaji adapter, network callback, login creator,
 * snapshot/ticks/Kbars polling fallback, broker write path, or write-master
 * authority. `runtime` and `browser` are separate object-capability facets:
 * no structural owner field exists, and a browser lease can never release a
 * Runtime lease. The embedding server must keep the Runtime facet private.
 */
export function createSmartOrderQuoteSubscriptionCoordinator(options) {
    const constructorInput = snapshotExactDataProperties(
        options,
        CONSTRUCTOR_KEYS,
        'quote subscription coordinator options',
    );
    const initialApiGeneration = boundedToken(
        constructorInput.apiGeneration,
        'apiGeneration',
    );
    const initialConnectionId = boundedToken(
        constructorInput.connectionId,
        'connectionId',
    );
    if (
        typeof constructorInput.nowMonotonicMs !== 'function' ||
        isProxy(constructorInput.nowMonotonicMs)
    ) {
        throw new TypeError('nowMonotonicMs must be a non-Proxy function');
    }
    const resourceCapability = snapshotResourceCapability(
        constructorInput.resourceCoordinator,
    );
    const resourceCountingDimension =
        constructorInput.resourceCountingDimension === null
            ? null
            : boundedToken(
                  constructorInput.resourceCountingDimension,
                  'resourceCountingDimension',
                  128,
              );
    if (
        Boolean(resourceCapability) !==
        Boolean(resourceCountingDimension)
    ) {
        throw new TypeError(
            'resource coordinator and counting dimension must be supplied together',
        );
    }

    const aggregates = new Map();
    const pendingPlans = new Map();
    const issuedPlanRecords = new WeakMap();
    const runtimeDemandRecords = new WeakMap();
    const browserDemandRecords = new WeakMap();
    const streamAuthorityRecords = new WeakMap();
    const runtimeConsumerIndex = new Map();
    const browserConsumerIndex = new Map();
    let totalDemandCount = 0;
    let connectionActive = true;
    let apiGeneration = initialApiGeneration;
    let connectionId = initialConnectionId;
    let connectionLineageRevision = 1;
    let lastMonotonicMs = -1;
    let clockInvalid = false;
    let closed = false;
    let retainedResourceReservationsOnClose = 0;

    function currentMonotonicMs() {
        if (clockInvalid) return undefined;
        let value;
        try {
            value = Reflect.apply(
                constructorInput.nowMonotonicMs,
                undefined,
                [],
            );
        } catch {
            clockInvalid = true;
            return undefined;
        }
        if (
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value < lastMonotonicMs
        ) {
            clockInvalid = true;
            return undefined;
        }
        lastMonotonicMs = value;
        return value;
    }

    if (currentMonotonicMs() === undefined) {
        throw new TypeError('initial monotonic clock is invalid');
    }

    function resourceStatus() {
        if (!resourceCapability) {
            return deny('subscription_resource_admission_unavailable');
        }
        let rawStatus;
        try {
            rawStatus = Reflect.apply(
                resourceCapability.status,
                resourceCapability.receiver,
                [],
            );
        } catch {
            return deny('subscription_resource_status_unavailable');
        }
        let status;
        try {
            status = snapshotAllDataProperties(
                rawStatus,
                'resource coordinator status',
            );
        } catch {
            return deny('subscription_resource_status_invalid');
        }
        if (
            status.subscriptionEvidenceCurrent !== true ||
            status.subscriptionCountingDimension !==
                resourceCountingDimension ||
            status.closed !== false ||
            status.brokerAuthority !== false ||
            status.writeMasterAuthority !== false
        ) {
            return deny('subscription_resource_admission_not_current');
        }
        return Object.freeze({ allowed: true });
    }

    function releaseResourceReservation(aggregate) {
        const reservation = aggregate.resourceReservation;
        aggregate.resourceReservation = undefined;
        if (!reservation) return true;
        try {
            Reflect.apply(reservation.release, reservation.receiver, []);
            return true;
        } catch {
            aggregate.resourceReleaseFailed = true;
            return false;
        }
    }

    function reserveResource(aggregate) {
        if (aggregate.resourceReservation) {
            return resourceStatus();
        }
        if (!resourceCapability || !resourceCountingDimension) {
            aggregate.resourceBlocker =
                'subscription_resource_admission_unavailable';
            return deny(aggregate.resourceBlocker);
        }
        const status = resourceStatus();
        if (!status.allowed) {
            aggregate.resourceBlocker = status.reason;
            return status;
        }
        const demand = Object.freeze({
            countingDimension: resourceCountingDimension,
            demandId: aggregate.resourceDemandId,
            transport: 'subscription',
            units: 1,
        });
        let rawLease;
        try {
            rawLease = Reflect.apply(
                resourceCapability.reserveSubscriptionDemand,
                resourceCapability.receiver,
                [demand],
            );
        } catch {
            aggregate.resourceBlocker =
                'subscription_resource_admission_failed';
            return deny(aggregate.resourceBlocker);
        }
        let leaseSnapshot;
        try {
            leaseSnapshot = snapshotAllDataProperties(
                rawLease,
                'subscription reservation result',
            );
        } catch {
            aggregate.resourceBlocker =
                'subscription_resource_admission_invalid';
            return deny(aggregate.resourceBlocker);
        }
        if (leaseSnapshot.allowed !== true) {
            aggregate.resourceBlocker =
                typeof leaseSnapshot.reason === 'string'
                    ? leaseSnapshot.reason
                    : 'subscription_resource_admission_denied';
            return deny(aggregate.resourceBlocker);
        }
        try {
            aggregate.resourceReservation = validateReservationLease(
                rawLease,
                demand,
            );
        } catch {
            aggregate.resourceBlocker =
                'subscription_resource_admission_invalid';
            return deny(aggregate.resourceBlocker);
        }
        aggregate.resourceBlocker = null;
        return Object.freeze({ allowed: true });
    }

    function refCounts(aggregate) {
        return Object.freeze({
            runtime: aggregate.runtimeDemands.size,
            browser: aggregate.browserDemands.size,
            total:
                aggregate.runtimeDemands.size +
                aggregate.browserDemands.size,
        });
    }

    function removePendingPlan(aggregate) {
        if (!aggregate.pendingPlanId) return;
        pendingPlans.delete(aggregate.pendingPlanId);
        aggregate.pendingPlanId = null;
    }

    function releaseAndRemoveAggregate(aggregate) {
        removePendingPlan(aggregate);
        releaseResourceReservation(aggregate);
        aggregates.delete(aggregate.key);
    }

    function createAggregate(contract, quoteType) {
        const key = subscriptionKey(contract, quoteType);
        const keyHash = subscriptionKeySha256(key);
        return {
            key,
            keyHash,
            contract,
            quoteType,
            resourceDemandId: `quote-subscription:${keyHash.slice(7)}`,
            resourceReservation: undefined,
            resourceBlocker: null,
            resourceReleaseFailed: false,
            runtimeDemands: new Set(),
            browserDemands: new Set(),
            demandRevision: 0,
            planRevision: 0,
            pendingPlanId: null,
            physicalState: 'absent',
            confirmation: null,
            head: null,
            mappedHead: null,
            protectiveHead: null,
            lastFailureReason: null,
        };
    }

    function planOperation(aggregate, action) {
        if (closed || !connectionActive || clockInvalid) return undefined;
        const counts = refCounts(aggregate);
        if (action === 'subscribe') {
            if (counts.total === 0) return undefined;
            const resource = reserveResource(aggregate);
            if (!resource.allowed) {
                aggregate.physicalState = 'resource_blocked';
                removePendingPlan(aggregate);
                return undefined;
            }
        } else if (action === 'unsubscribe') {
            if (counts.total !== 0 || !aggregate.confirmation) return undefined;
        } else {
            return undefined;
        }
        removePendingPlan(aggregate);
        aggregate.planRevision += 1;
        const planSeed = JSON.stringify([
            SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            connectionLineageRevision,
            apiGeneration,
            connectionId,
            aggregate.key,
            aggregate.demandRevision,
            aggregate.planRevision,
            action,
        ]);
        const planId = `quote-plan:${sha256Hex(planSeed)}`;
        const plan = deepFreeze({
            schemaVersion:
                SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            planId,
            action,
            contract: aggregate.contract,
            quoteType: aggregate.quoteType,
            apiGeneration,
            connectionId,
            connectionLineageRevision,
            demandRevision: aggregate.demandRevision,
            runtimeRefCount: counts.runtime,
            browserRefCount: counts.browser,
            resourceDemand: Object.freeze({
                countingDimension: resourceCountingDimension,
                demandId: aggregate.resourceDemandId,
                transport: 'subscription',
                units: 1,
            }),
            sharedExistingLoginRequired: true,
            createsNewLogin: false,
            snapshotPollingFallbackAllowed: false,
            ticksPollingFallbackAllowed: false,
            kbarsPollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
        pendingPlans.set(planId, { aggregate, plan });
        issuedPlanRecords.set(plan, { aggregate, plan });
        aggregate.pendingPlanId = planId;
        aggregate.physicalState = `${action}_planned`;
        return plan;
    }

    function refreshSubscribePlanIfPending(aggregate) {
        if (aggregate.physicalState === 'subscribe_planned') {
            planOperation(aggregate, 'subscribe');
        }
    }

    function demandConsumerIndexKey(consumerId, aggregateKey) {
        return `${consumerId}\u001f${aggregateKey}`;
    }

    function acquireDemand(ownerKind, input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        let normalized;
        try {
            normalized = normalizeSubscriptionInput(input);
        } catch {
            return deny('quote_demand_schema_invalid');
        }
        if (totalDemandCount >= SMART_ORDER_QUOTE_MAX_TOTAL_DEMANDS) {
            return deny('quote_demand_capacity_exhausted');
        }
        const key = subscriptionKey(
            normalized.contract,
            normalized.quoteType,
        );
        const consumerIndex =
            ownerKind === 'runtime'
                ? runtimeConsumerIndex
                : browserConsumerIndex;
        const consumerKey = demandConsumerIndexKey(
            normalized.consumerId,
            key,
        );
        if (consumerIndex.has(consumerKey)) {
            return deny('quote_consumer_demand_duplicate');
        }
        let aggregate = aggregates.get(key);
        if (!aggregate) {
            if (
                aggregates.size >=
                SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS
            ) {
                return deny('quote_subscription_capacity_exhausted');
            }
            aggregate = createAggregate(
                normalized.contract,
                normalized.quoteType,
            );
            aggregates.set(key, aggregate);
        }

        const handle = deepFreeze({
            schemaVersion:
                SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            handleClass:
                ownerKind === 'runtime'
                    ? 'runtime_quote_demand'
                    : 'browser_quote_demand',
            subscriptionKeySha256: aggregate.keyHash,
            contract: aggregate.contract,
            quoteType: aggregate.quoteType,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
        const record = {
            active: true,
            aggregate,
            consumerKey,
            handle,
            ownerKind,
        };
        if (ownerKind === 'runtime') {
            runtimeDemandRecords.set(handle, record);
            aggregate.runtimeDemands.add(handle);
        } else {
            browserDemandRecords.set(handle, record);
            aggregate.browserDemands.add(handle);
        }
        consumerIndex.set(consumerKey, handle);
        totalDemandCount += 1;
        aggregate.demandRevision += 1;

        if (aggregate.physicalState === 'unsubscribe_planned') {
            removePendingPlan(aggregate);
            aggregate.physicalState = aggregate.confirmation
                ? 'confirmed'
                : 'absent';
        }
        if (
            !PLAN_BLOCKED_PHYSICAL_STATES.has(aggregate.physicalState) &&
            (!aggregate.confirmation ||
                aggregate.confirmation.connectionLineageRevision !==
                    connectionLineageRevision)
        ) {
            planOperation(aggregate, 'subscribe');
        } else {
            refreshSubscribePlanIfPending(aggregate);
        }
        return handle;
    }

    function releaseDemand(ownerKind, handle) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        if (
            !handle ||
            typeof handle !== 'object' ||
            isProxy(handle)
        ) {
            return deny('quote_demand_handle_invalid');
        }
        const records =
            ownerKind === 'runtime'
                ? runtimeDemandRecords
                : browserDemandRecords;
        const record = records.get(handle);
        if (!record || !record.active || record.handle !== handle) {
            return deny('quote_demand_handle_invalid');
        }
        record.active = false;
        const aggregate = record.aggregate;
        const demands =
            ownerKind === 'runtime'
                ? aggregate.runtimeDemands
                : aggregate.browserDemands;
        demands.delete(handle);
        const consumerIndex =
            ownerKind === 'runtime'
                ? runtimeConsumerIndex
                : browserConsumerIndex;
        consumerIndex.delete(record.consumerKey);
        totalDemandCount -= 1;
        aggregate.demandRevision += 1;
        const counts = refCounts(aggregate);

        if (counts.total > 0) {
            refreshSubscribePlanIfPending(aggregate);
            return deepFreeze({
                allowed: true,
                action: 'refcount_decremented',
                runtimeRefCount: counts.runtime,
                browserRefCount: counts.browser,
                unsubscribePlanned: false,
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        if (
            UNKNOWN_PHYSICAL_SUBSCRIPTION_STATES.has(
                aggregate.physicalState,
            )
        ) {
            // A timed-out subscribe may have taken effect. Keep the shared
            // resource reservation and the aggregate tombstone until the
            // transport lineage is explicitly invalidated; retrying or
            // releasing capacity on the same connection could double count.
            return deepFreeze({
                allowed: true,
                action: 'unknown_subscription_retained_until_disconnect',
                runtimeRefCount: 0,
                browserRefCount: 0,
                unsubscribePlanned: false,
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }

        if (aggregate.physicalState === 'subscribe_planned') {
            removePendingPlan(aggregate);
            aggregate.physicalState = 'absent';
            releaseAndRemoveAggregate(aggregate);
            return deepFreeze({
                allowed: true,
                action: 'unconfirmed_subscribe_cancelled',
                runtimeRefCount: 0,
                browserRefCount: 0,
                unsubscribePlanned: false,
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        if (aggregate.confirmation && connectionActive) {
            const plan = planOperation(aggregate, 'unsubscribe');
            return deepFreeze({
                allowed: true,
                action: plan
                    ? 'unsubscribe_planned'
                    : 'unsubscribe_failed_closed',
                runtimeRefCount: 0,
                browserRefCount: 0,
                unsubscribePlanned: Boolean(plan),
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        releaseAndRemoveAggregate(aggregate);
        return deepFreeze({
            allowed: true,
            action: 'demand_released_without_active_subscription',
            runtimeRefCount: 0,
            browserRefCount: 0,
            unsubscribePlanned: false,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function sortedPlans() {
        return Object.freeze(
            [...pendingPlans.values()]
                .map(({ plan }) => plan)
                .sort((left, right) => {
                    const leftKey = `${left.action}\u001f${subscriptionKey(
                        left.contract,
                        left.quoteType,
                    )}`;
                    const rightKey = `${right.action}\u001f${subscriptionKey(
                        right.contract,
                        right.quoteType,
                    )}`;
                    return leftKey < rightKey
                        ? -1
                        : leftKey > rightKey
                          ? 1
                          : 0;
                }),
        );
    }

    function replaceConnection(input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        let connection;
        try {
            connection = snapshotExactDataProperties(
                input,
                CONNECTION_KEYS,
                'quote connection',
            );
            connection = Object.freeze({
                apiGeneration: boundedToken(
                    connection.apiGeneration,
                    'apiGeneration',
                ),
                connectionId: boundedToken(
                    connection.connectionId,
                    'connectionId',
                ),
            });
        } catch {
            return deny('quote_connection_schema_invalid');
        }
        connectionLineageRevision += 1;
        apiGeneration = connection.apiGeneration;
        connectionId = connection.connectionId;
        connectionActive = true;
        pendingPlans.clear();
        const removable = [];
        for (const aggregate of aggregates.values()) {
            aggregate.pendingPlanId = null;
            aggregate.confirmation = null;
            aggregate.head = null;
            aggregate.lastFailureReason = null;
            if (refCounts(aggregate).total === 0) {
                removable.push(aggregate);
                continue;
            }
            aggregate.physicalState = 'absent';
        }
        for (const aggregate of removable) {
            releaseAndRemoveAggregate(aggregate);
        }
        for (const aggregate of [...aggregates.values()].sort((left, right) =>
            left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
        )) {
            planOperation(aggregate, 'subscribe');
        }
        return deepFreeze({
            allowed: true,
            action: 'connection_lineage_replaced',
            apiGeneration,
            connectionId,
            connectionLineageRevision,
            resubscribePlans: sortedPlans(),
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function markDisconnected(input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        let connection;
        try {
            connection = snapshotExactDataProperties(
                input,
                CONNECTION_KEYS,
                'quote disconnection',
            );
        } catch {
            return deny('quote_connection_schema_invalid');
        }
        if (
            connection.apiGeneration !== apiGeneration ||
            connection.connectionId !== connectionId ||
            !connectionActive
        ) {
            return deny('quote_connection_lineage_mismatch');
        }
        connectionLineageRevision += 1;
        connectionActive = false;
        pendingPlans.clear();
        const removable = [];
        for (const aggregate of aggregates.values()) {
            aggregate.pendingPlanId = null;
            aggregate.confirmation = null;
            aggregate.head = null;
            aggregate.physicalState = 'disconnected';
            if (refCounts(aggregate).total === 0) removable.push(aggregate);
        }
        for (const aggregate of removable) {
            releaseAndRemoveAggregate(aggregate);
        }
        return deepFreeze({
            allowed: true,
            action: 'connection_invalidated',
            connectionLineageRevision,
            resubscribePlans: Object.freeze([]),
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function confirmPlan(planAuthority, input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        if (
            !planAuthority ||
            typeof planAuthority !== 'object' ||
            isProxy(planAuthority)
        ) {
            return deny('quote_plan_authority_invalid');
        }
        const issuedPlan = issuedPlanRecords.get(planAuthority);
        if (!issuedPlan || issuedPlan.plan !== planAuthority) {
            return deny('quote_plan_authority_invalid');
        }
        let confirmationInput;
        try {
            confirmationInput = snapshotExactDataProperties(
                input,
                PLAN_CONFIRMATION_KEYS,
                'quote plan confirmation',
            );
        } catch {
            return deny('quote_plan_confirmation_schema_invalid');
        }
        if (
            !connectionActive ||
            confirmationInput.apiGeneration !== apiGeneration ||
            confirmationInput.connectionId !== connectionId
        ) {
            return deny('quote_connection_lineage_mismatch');
        }
        const pending = pendingPlans.get(confirmationInput.planId);
        if (
            !pending ||
            pending.plan !== planAuthority ||
            pending.aggregate !== issuedPlan.aggregate ||
            pending.plan.action !== confirmationInput.action ||
            pending.plan.apiGeneration !== apiGeneration ||
            pending.plan.connectionId !== connectionId ||
            pending.plan.connectionLineageRevision !==
                connectionLineageRevision ||
            pending.aggregate.pendingPlanId !== confirmationInput.planId
        ) {
            return deny('quote_plan_not_current');
        }
        const aggregate = pending.aggregate;
        const counts = refCounts(aggregate);
        if (confirmationInput.action === 'subscribe') {
            if (counts.total === 0) return deny('quote_subscription_not_demanded');
            const currentResource = resourceStatus();
            if (!currentResource.allowed) return currentResource;
            pendingPlans.delete(confirmationInput.planId);
            aggregate.pendingPlanId = null;
            aggregate.confirmation = Object.freeze({
                connectionLineageRevision,
                planId: confirmationInput.planId,
            });
            aggregate.physicalState = 'confirmed';
            aggregate.head = null;
            aggregate.lastFailureReason = null;
            const streamAuthority = deepFreeze({
                schemaVersion:
                    SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
                handleClass: 'confirmed_quote_stream',
                subscriptionKeySha256: aggregate.keyHash,
                connectionLineageRevision,
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
            streamAuthorityRecords.set(streamAuthority, {
                aggregate,
                connectionLineageRevision,
                planId: confirmationInput.planId,
                streamAuthority,
            });
            return deepFreeze({
                allowed: true,
                action: 'subscription_confirmed_current_lineage',
                streamAuthority,
                subscriptionConfirmed: true,
                runtimeReadinessContribution: false,
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        if (confirmationInput.action === 'unsubscribe') {
            if (counts.total !== 0) return deny('quote_subscription_still_demanded');
            pendingPlans.delete(confirmationInput.planId);
            aggregate.pendingPlanId = null;
            aggregate.confirmation = null;
            aggregate.head = null;
            aggregate.physicalState = 'absent';
            const released = releaseResourceReservation(aggregate);
            aggregates.delete(aggregate.key);
            return deepFreeze({
                allowed: released,
                action: released
                    ? 'unsubscription_confirmed'
                    : 'unsubscription_confirmed_resource_release_failed',
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        return deny('quote_plan_action_invalid');
    }

    function reportPlanFailure(planAuthority, input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        if (
            !planAuthority ||
            typeof planAuthority !== 'object' ||
            isProxy(planAuthority)
        ) {
            return deny('quote_plan_authority_invalid');
        }
        const issuedPlan = issuedPlanRecords.get(planAuthority);
        if (!issuedPlan || issuedPlan.plan !== planAuthority) {
            return deny('quote_plan_authority_invalid');
        }
        let failure;
        try {
            failure = snapshotExactDataProperties(
                input,
                PLAN_FAILURE_KEYS,
                'quote plan failure',
            );
        } catch {
            return deny('quote_plan_failure_schema_invalid');
        }
        if (
            !PLAN_FAILURE_REASONS.has(failure.reason) ||
            failure.apiGeneration !== apiGeneration ||
            failure.connectionId !== connectionId
        ) {
            return deny('quote_plan_failure_schema_invalid');
        }
        const pending = pendingPlans.get(failure.planId);
        if (
            !pending ||
            pending.plan !== planAuthority ||
            pending.aggregate !== issuedPlan.aggregate ||
            pending.plan.action !== failure.action ||
            pending.aggregate.pendingPlanId !== failure.planId
        ) {
            return deny('quote_plan_not_current');
        }
        const aggregate = pending.aggregate;
        pendingPlans.delete(failure.planId);
        aggregate.pendingPlanId = null;
        aggregate.head = null;
        aggregate.lastFailureReason = failure.reason;
        if (failure.action === 'subscribe') {
            aggregate.confirmation = null;
            aggregate.physicalState =
                failure.reason === 'subscribe_failed'
                    ? 'subscribe_failed_closed'
                    : 'subscribe_result_unknown';
        } else {
            aggregate.physicalState = 'unsubscribe_failed_unknown';
        }
        return deepFreeze({
            allowed: true,
            action: 'plan_failure_latched',
            retryScheduled: false,
            physicalState: aggregate.physicalState,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function retryResourceAdmission(input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        let lookup;
        try {
            lookup = normalizeLookup(input);
        } catch {
            return deny('quote_subscription_lookup_invalid');
        }
        const aggregate = aggregates.get(
            subscriptionKey(lookup.contract, lookup.quoteType),
        );
        if (!aggregate || refCounts(aggregate).total === 0) {
            return deny('quote_subscription_not_demanded');
        }
        const resource = reserveResource(aggregate);
        if (!resource.allowed) return resource;
        if (!aggregate.confirmation && connectionActive) {
            planOperation(aggregate, 'subscribe');
        }
        return deepFreeze({
            allowed: true,
            action: 'resource_admission_current',
            pendingPlans: sortedPlans(),
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function retryPlan(input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        let lookup;
        try {
            lookup = normalizeLookup(input);
        } catch {
            return deny('quote_subscription_lookup_invalid');
        }
        const aggregate = aggregates.get(
            subscriptionKey(lookup.contract, lookup.quoteType),
        );
        if (!aggregate) return deny('quote_subscription_not_tracked');
        if (aggregate.pendingPlanId) return deny('quote_plan_already_pending');
        if (!connectionActive) return deny('quote_connection_not_current');
        const counts = refCounts(aggregate);
        let plan;
        if (
            counts.total > 0 &&
            aggregate.physicalState === 'subscribe_failed_closed'
        ) {
            plan = planOperation(aggregate, 'subscribe');
        } else if (
            counts.total === 0 &&
            aggregate.physicalState === 'unsubscribe_failed_unknown'
        ) {
            plan = planOperation(aggregate, 'unsubscribe');
        } else {
            return deny('quote_plan_retry_not_allowed');
        }
        if (!plan) {
            return deny(
                aggregate.resourceBlocker ?? 'quote_plan_retry_failed_closed',
            );
        }
        return deepFreeze({
            allowed: true,
            action: 'explicit_retry_planned',
            plan,
            automaticRetry: false,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function recordObservation(streamAuthority, input) {
        if (closed) return deny('quote_subscription_coordinator_closed');
        if (
            !streamAuthority ||
            typeof streamAuthority !== 'object' ||
            isProxy(streamAuthority)
        ) {
            return deny('quote_stream_authority_invalid');
        }
        const streamRecord = streamAuthorityRecords.get(streamAuthority);
        if (
            !streamRecord ||
            streamRecord.streamAuthority !== streamAuthority
        ) {
            return deny('quote_stream_authority_invalid');
        }
        let observation;
        try {
            observation = snapshotExactDataProperties(
                input,
                OBSERVATION_KEYS,
                'quote observation head',
            );
            observation = Object.freeze({
                observationId: boundedToken(
                    observation.observationId,
                    'observationId',
                    240,
                ),
                streamSequence:
                    observation.streamSequence === null
                        ? null
                        : (() => {
                              if (
                                  !Number.isSafeInteger(
                                      observation.streamSequence,
                                  ) ||
                                  observation.streamSequence < 0
                              ) {
                                  throw new TypeError(
                                      'streamSequence must be null or a non-negative safe integer',
                                  );
                              }
                              return observation.streamSequence;
                          })(),
            });
        } catch {
            return deny('quote_observation_schema_invalid');
        }
        const aggregate = streamRecord.aggregate;
        const confirmation = aggregate.confirmation;
        if (
            aggregates.get(aggregate.key) !== aggregate ||
            refCounts(aggregate).total === 0 ||
            !connectionActive ||
            !confirmation ||
            confirmation.planId !== streamRecord.planId ||
            confirmation.connectionLineageRevision !==
                streamRecord.connectionLineageRevision ||
            streamRecord.connectionLineageRevision !==
                connectionLineageRevision ||
            aggregate.physicalState !== 'confirmed'
        ) {
            return deny('quote_stream_lineage_not_current');
        }
        const resource = resourceStatus();
        if (!resource.allowed) return resource;
        const now = currentMonotonicMs();
        if (now === undefined) return deny('quote_monotonic_clock_invalid');
        const previous = aggregate.head;
        if (previous) {
            if (previous.observationId === observation.observationId) {
                if (previous.streamSequence !== observation.streamSequence) {
                    aggregate.head = null;
                    aggregate.confirmation = null;
                    aggregate.physicalState = 'stream_identity_collision';
                    aggregate.lastFailureReason =
                        'stream_observation_identity_collision';
                    return deny('quote_observation_identity_collision');
                }
                const ageMs = now - previous.receivedAtMonotonicMs;
                return deepFreeze({
                    allowed: true,
                    action: 'observation_replay_ignored',
                    replay: true,
                    headCurrent:
                        ageMs <= SMART_ORDER_QUOTE_FRESHNESS_TTL_MS,
                    ageMs,
                    subscriptionTransportAuthority: false,
                    conditionEligibilityAuthority: false,
                    brokerWriteAuthority: false,
                });
            }
            if (
                previous.streamSequence !== null &&
                observation.streamSequence === null
            ) {
                return deny('quote_observation_sequence_missing');
            }
            if (
                previous.streamSequence !== null &&
                observation.streamSequence !== null
            ) {
                if (observation.streamSequence < previous.streamSequence) {
                    return deny('quote_observation_out_of_order');
                }
                if (observation.streamSequence === previous.streamSequence) {
                    aggregate.head = null;
                    aggregate.confirmation = null;
                    aggregate.physicalState = 'stream_sequence_collision';
                    aggregate.lastFailureReason = 'stream_sequence_collision';
                    return deny('quote_observation_sequence_collision');
                }
            }
        }
        aggregate.head = Object.freeze({
            observationId: observation.observationId,
            streamSequence: observation.streamSequence,
            receivedAtMonotonicMs: now,
            connectionLineageRevision,
            confirmationPlanId: confirmation.planId,
        });
        return deepFreeze({
            allowed: true,
            action: 'freshness_head_advanced',
            replay: false,
            headCurrent: true,
            ageMs: 0,
            orderingEvidence:
                observation.streamSequence === null
                    ? 'trusted_receive_order_only'
                    : 'trusted_stream_sequence',
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function recordMappedObservation(streamAuthority, normalized) {
        if (
            !isTrustedSmartOrderQuickFieldNormalization(normalized) ||
            normalized.mappingRevision !==
                SMART_ORDER_QUICK_FIELD_MAPPING_REVISION ||
            normalized.mappingDefinitionSha256 !==
                SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256
        ) {
            return deny('quote_mapping_evidence_invalid');
        }
        const streamRecord = streamAuthorityRecords.get(streamAuthority);
        if (!streamRecord?.aggregate) {
            return deny('quote_stream_authority_invalid');
        }
        const aggregate = streamRecord.aggregate;
        const expectedContractKey = `${aggregate.contract.exchange}:${aggregate.contract.securityType}:${aggregate.contract.code}`;
        if (
            normalized.contractKey !== expectedContractKey ||
            normalized.eventKind !== aggregate.quoteType ||
            normalized.streamEpoch !== connectionId
        ) {
            return deny('quote_mapping_lineage_mismatch');
        }
        const totalQuantityProjection = normalized.projections.find(
            (entry) => entry.field === 'total_quantity',
        );
        const totalQuantity = totalQuantityProjection
            ? Number(totalQuantityProjection.value)
            : null;
        const previousMappedHead = aggregate.mappedHead;
        if (
            previousMappedHead &&
            (normalized.tradeDate < previousMappedHead.tradeDate ||
                (normalized.tradeDate === previousMappedHead.tradeDate &&
                    normalized.exchangeTimeMs <
                        previousMappedHead.exchangeTimeMs) ||
                (normalized.eventKind === 'tick' &&
                    normalized.tradeDate === previousMappedHead.tradeDate &&
                    (!Number.isSafeInteger(totalQuantity) ||
                        (previousMappedHead.totalQuantity !== null &&
                            totalQuantity <
                                previousMappedHead.totalQuantity))))
        ) {
            return deny('quote_mapping_observation_out_of_order');
        }
        const recorded = recordObservation(streamAuthority, {
            observationId: normalized.eventFingerprintSha256,
            streamSequence: normalized.sequence,
        });
        if (recorded.allowed !== true) return recorded;
        if (recorded.replay !== true) {
            aggregate.mappedHead = Object.freeze({
                exchangeTimeMs: normalized.exchangeTimeMs,
                observationId: normalized.eventFingerprintSha256,
                totalQuantity,
                tradeDate: normalized.tradeDate,
            });
        }
        if (recorded.replay === true) {
            return deepFreeze({
                ...recorded,
                quickConditionEligible: false,
                quickConditionReason: 'duplicate_observation_ignored',
                protectiveTriggerEligible: false,
                protectiveTriggerReason: 'duplicate_observation_ignored',
                lastEligibleExchangeTimeMs:
                    aggregate.protectiveHead?.exchangeTimeMs ?? null,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }

        const previousEligibleExchangeTimeMs =
            aggregate.protectiveHead?.exchangeTimeMs ?? null;
        const quickObservationBase = {
            ...recorded,
            quickConditionEligible: true,
            quickConditionReason: 'current_mapped_subscription_observation',
            observationId: normalized.eventFingerprintSha256,
            contractKey: normalized.contractKey,
            eventKind: normalized.eventKind,
            projections: normalized.projections,
            disabledFields: normalized.disabledFields,
            tradeDate: normalized.tradeDate,
            exchangeTimeMs: normalized.exchangeTimeMs,
            receiveTimeMs: normalized.receiveTimeMs,
            sequence: normalized.sequence,
            streamEpoch: normalized.streamEpoch,
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            mappingDefinitionSha256:
                SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        };
        if (aggregate.quoteType !== 'tick') {
            const quickObservation = deepFreeze({
                ...quickObservationBase,
                protectiveTriggerEligible: false,
                protectiveTriggerReason: 'field_not_last_trade',
                lastEligibleExchangeTimeMs: previousEligibleExchangeTimeMs,
            });
            ISSUED_QUICK_CONDITION_OBSERVATIONS.add(quickObservation);
            return quickObservation;
        }
        const lastPrice = normalized.projections.find(
            (entry) => entry.field === 'last_price',
        );
        const exchangeAgeAtReceiveMs =
            normalized.receiveTimeMs - normalized.exchangeTimeMs;
        if (
            recorded.headCurrent !== true ||
            !lastPrice ||
            lastPrice.protectiveTriggerCandidate !== true ||
            exchangeAgeAtReceiveMs < 0 ||
            exchangeAgeAtReceiveMs > SMART_ORDER_QUOTE_FRESHNESS_TTL_MS
        ) {
            const quickObservation = deepFreeze({
                ...quickObservationBase,
                protectiveTriggerEligible: false,
                protectiveTriggerReason: 'last_trade_stale_or_invalid',
                lastEligibleExchangeTimeMs: previousEligibleExchangeTimeMs,
            });
            ISSUED_QUICK_CONDITION_OBSERVATIONS.add(quickObservation);
            return quickObservation;
        }
        aggregate.protectiveHead = Object.freeze({
            connectionLineageRevision,
            exchangeTimeMs: normalized.exchangeTimeMs,
            observationId: normalized.eventFingerprintSha256,
            tradeDate: normalized.tradeDate,
            value: lastPrice.value,
        });
        const protectiveObservation = deepFreeze({
            ...quickObservationBase,
            protectiveTriggerEligible: true,
            protectiveTriggerReason: 'current_fresh_normal_lot_last_trade',
            observationId: normalized.eventFingerprintSha256,
            contractKey: normalized.contractKey,
            field: 'last_price',
            value: aggregate.protectiveHead.value,
            tradeDate: aggregate.protectiveHead.tradeDate,
            exchangeTimeMs: aggregate.protectiveHead.exchangeTimeMs,
            receiveTimeMs: normalized.receiveTimeMs,
            sequence: normalized.sequence,
            streamEpoch: normalized.streamEpoch,
            lastEligibleExchangeTimeMs:
                aggregate.protectiveHead.exchangeTimeMs,
            mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
            mappingDefinitionSha256:
                SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
        });
        ISSUED_QUICK_CONDITION_OBSERVATIONS.add(protectiveObservation);
        ISSUED_PROTECTIVE_QUOTE_OBSERVATIONS.add(protectiveObservation);
        return protectiveObservation;
    }

    function subscriptionStatusFromAggregate(aggregate) {
        const counts = refCounts(aggregate);
        const resource = aggregate.resourceReservation
            ? resourceStatus()
            : deny(
                  aggregate.resourceBlocker ??
                      'subscription_resource_admission_unavailable',
              );
        const now = currentMonotonicMs();
        const confirmationCurrent = Boolean(
            connectionActive &&
                aggregate.confirmation &&
                aggregate.confirmation.connectionLineageRevision ===
                    connectionLineageRevision &&
                aggregate.physicalState === 'confirmed',
        );
        const headCurrentLineage = Boolean(
            confirmationCurrent &&
                aggregate.head &&
                aggregate.head.connectionLineageRevision ===
                    connectionLineageRevision &&
                aggregate.head.confirmationPlanId ===
                    aggregate.confirmation.planId,
        );
        const ageMs =
            now !== undefined && headCurrentLineage
                ? now - aggregate.head.receivedAtMonotonicMs
                : null;
        const fresh = Boolean(
            resource.allowed &&
                headCurrentLineage &&
                Number.isSafeInteger(ageMs) &&
                ageMs >= 0 &&
                ageMs <= SMART_ORDER_QUOTE_FRESHNESS_TTL_MS,
        );
        const protectiveHeadCurrent = Boolean(
            aggregate.quoteType === 'tick' &&
                fresh &&
                aggregate.protectiveHead &&
                aggregate.protectiveHead.connectionLineageRevision ===
                    connectionLineageRevision &&
                aggregate.head?.observationId ===
                    aggregate.protectiveHead.observationId,
        );
        let blocker = null;
        if (closed) blocker = 'quote_subscription_coordinator_closed';
        else if (clockInvalid || now === undefined)
            blocker = 'quote_monotonic_clock_invalid';
        else if (!connectionActive) blocker = 'quote_connection_not_current';
        else if (counts.total === 0) blocker = 'quote_subscription_not_demanded';
        else if (!resource.allowed) blocker = resource.reason;
        else if (!confirmationCurrent)
            blocker = aggregate.lastFailureReason ?? 'quote_subscription_unconfirmed';
        else if (!headCurrentLineage) blocker = 'quote_freshness_head_missing';
        else if (!fresh) blocker = 'quote_freshness_head_stale';

        return deepFreeze({
            tracked: true,
            schemaVersion:
                SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            contract: aggregate.contract,
            quoteType: aggregate.quoteType,
            subscriptionKeySha256: aggregate.keyHash,
            runtimeRefCount: counts.runtime,
            browserRefCount: counts.browser,
            totalRefCount: counts.total,
            physicalState: aggregate.physicalState,
            resourceAdmitted: Boolean(aggregate.resourceReservation),
            resourceCurrent: resource.allowed,
            resourceBlocker: resource.allowed ? null : resource.reason,
            connectionActive,
            apiGeneration,
            connectionId,
            connectionLineageRevision,
            subscriptionConfirmedCurrentLineage: confirmationCurrent,
            headObservationId: headCurrentLineage
                ? aggregate.head.observationId
                : null,
            headStreamSequence: headCurrentLineage
                ? aggregate.head.streamSequence
                : null,
            headAgeMs: ageMs,
            headFresh: fresh,
            current: fresh,
            protectiveTriggerCurrent: protectiveHeadCurrent,
            protectiveTriggerState: protectiveHeadCurrent
                ? 'fresh'
                : aggregate.protectiveHead
                  ? 'stale'
                  : 'unverified',
            lastEligibleExchangeTimeMs:
                aggregate.protectiveHead?.exchangeTimeMs ?? null,
            protectiveTriggerAuthority: false,
            blocker,
            freshnessTtlMs: SMART_ORDER_QUOTE_FRESHNESS_TTL_MS,
            sharedExistingLoginRequired: true,
            createsNewLogin: false,
            productionAdapterConfigured: false,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function getSubscriptionStatus(input) {
        let lookup;
        try {
            lookup = normalizeLookup(input);
        } catch {
            return deny('quote_subscription_lookup_invalid');
        }
        const aggregate = aggregates.get(
            subscriptionKey(lookup.contract, lookup.quoteType),
        );
        if (!aggregate) {
            return deepFreeze({
                tracked: false,
                contract: lookup.contract,
                quoteType: lookup.quoteType,
                current: false,
                blocker: 'quote_subscription_not_tracked',
                productionAdapterConfigured: false,
                runtimeReadinessContribution: false,
                subscriptionTransportAuthority: false,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        return subscriptionStatusFromAggregate(aggregate);
    }

    function status() {
        const statuses = Object.freeze(
            [...aggregates.values()]
                .sort((left, right) =>
                    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
                )
                .map((aggregate) => subscriptionStatusFromAggregate(aggregate)),
        );
        return deepFreeze({
            schemaVersion:
                SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            apiGeneration,
            connectionId,
            connectionLineageRevision,
            connectionActive,
            trackedSubscriptionCount: aggregates.size,
            totalDemandCount,
            runtimeDemandCount: runtimeConsumerIndex.size,
            browserDemandCount: browserConsumerIndex.size,
            pendingPlanCount: pendingPlans.size,
            currentHeadCount: statuses.filter((entry) => entry.current).length,
            freshnessTtlMs: SMART_ORDER_QUOTE_FRESHNESS_TTL_MS,
            resourceCountingDimension,
            resourceCoordinatorConfigured: Boolean(resourceCapability),
            sharedExistingLoginRequired: true,
            createsNewLogin: false,
            productionAdapterConfigured: false,
            automaticResubscribeDispatchAllowed: false,
            snapshotPollingFallbackAllowed: false,
            ticksPollingFallbackAllowed: false,
            kbarsPollingFallbackAllowed: false,
            retainedResourceReservationsOnClose,
            clockInvalid,
            closed,
            subscriptions: statuses,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function close() {
        if (closed) return status();
        closed = true;
        pendingPlans.clear();
        retainedResourceReservationsOnClose = 0;
        for (const aggregate of aggregates.values()) {
            aggregate.pendingPlanId = null;
            aggregate.head = null;
            if (
                aggregate.confirmation ||
                UNKNOWN_PHYSICAL_SUBSCRIPTION_STATES.has(
                    aggregate.physicalState,
                )
            ) {
                // Releasing capacity while a physical subscription may still
                // exist would allow the shared pool to exceed its bound.
                retainedResourceReservationsOnClose += aggregate.resourceReservation
                    ? 1
                    : 0;
                aggregate.physicalState = 'closed_subscription_unknown';
            } else {
                releaseResourceReservation(aggregate);
                aggregate.physicalState = 'closed';
            }
            aggregate.confirmation = null;
        }
        return status();
    }

    const runtime = Object.freeze({
        acquireDemand(input) {
            return acquireDemand('runtime', input);
        },
        releaseDemand(handle) {
            return releaseDemand('runtime', handle);
        },
        replaceConnection,
        markDisconnected,
        confirmPlan,
        reportPlanFailure,
        retryResourceAdmission,
        retryPlan,
        recordObservation,
        recordMappedObservation,
        close,
    });
    const browser = Object.freeze({
        acquireDemand(input) {
            return acquireDemand('browser', input);
        },
        releaseDemand(handle) {
            return releaseDemand('browser', handle);
        },
    });
    const observer = Object.freeze({
        pendingPlans: sortedPlans,
        getSubscriptionStatus,
        status,
    });

    const root = Object.freeze({ browser, observer, runtime });
    return root;
}
