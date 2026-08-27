import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
    createCanonicalSmartOrderBrokerEventLedger,
    isNormalizedCanonicalSmartOrderBrokerEvent,
    normalizeCanonicalSmartOrderBrokerEvent,
} from './broker-event-normalizer.mjs';
import { isVerifiedSmartOrderTradeSubscriptionTransportVerifier } from './trade-subscription-verifier-authority.mjs';

export const SMART_ORDER_TRADE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION =
    'smart-order-trade-subscription-coordinator/2026-08-13.2';
export const SMART_ORDER_MAX_FIXED_TRADE_ACCOUNTS = 32;
export const SMART_ORDER_MAX_TRADE_SUBSCRIPTION_DEMANDS = 512;
export const SMART_ORDER_MAX_TRADE_VERIFICATION_BINDINGS = 4096;

const CONSTRUCTOR_KEYS = Object.freeze([
    'apiGeneration',
    'connectionId',
    'initialConnectionEvidence',
    'nowMonotonicMs',
    'transportVerifier',
]);
const ACCOUNT_KEYS = Object.freeze(['brokerId', 'accountId', 'accountType']);
const DEMAND_KEYS = Object.freeze(['account', 'consumerId']);
const CONNECTION_KEYS = Object.freeze(['apiGeneration', 'connectionId']);
const FAILURE_KEYS = Object.freeze([
    'apiGeneration',
    'connectionId',
    'planId',
    'reason',
]);
const FAILURE_REASONS = new Set([
    'subscribe_failed',
    'subscribe_result_unknown',
    'transport_disconnected',
]);
const claimedTransportVerifiers = new WeakSet();

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

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function snapshotExactDataProperties(value, expectedKeys, label) {
    if (
        !value ||
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
    if (
        keys.some((key) => typeof key !== 'string') ||
        keys.length !== expectedKeys.length ||
        ![...keys].sort().every((key, index) =>
            key === [...expectedKeys].sort()[index]
        )
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
            throw new TypeError(`${label} must use own data properties`);
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

function canonicalAccount(value) {
    const account = snapshotExactDataProperties(
        value,
        ACCOUNT_KEYS,
        'fixed trade account',
    );
    if (account.accountType !== 'S') {
        throw new TypeError('fixed trade account must be a stock account');
    }
    return Object.freeze({
        brokerId: boundedToken(account.brokerId, 'account.brokerId', 128),
        accountId: boundedToken(account.accountId, 'account.accountId', 128),
        accountType: 'S',
    });
}

function accountKey(account) {
    return JSON.stringify([
        account.brokerId,
        account.accountId,
        account.accountType,
    ]);
}

function accountScopeSha256(account) {
    return sha256(`smart-order-fixed-trade-account\u001f${accountKey(account)}`);
}

function deny(reason, details = {}) {
    return deepFreeze({
        allowed: false,
        reason,
        ...details,
        runtimeReadinessContribution: false,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
    });
}

function snapshotVerifier(value) {
    if (value === null) return null;
    const verifier = snapshotExactDataProperties(
        value,
        [
            'verifyConnectionEvidence',
            'verifyEventEvidence',
            'verifySubscriptionEvidence',
        ],
        'trade subscription transport verifier',
    );
    for (const methodName of [
        'verifyConnectionEvidence',
        'verifyEventEvidence',
        'verifySubscriptionEvidence',
    ]) {
        if (
            typeof verifier[methodName] !== 'function' ||
            isProxy(verifier[methodName])
        ) {
            throw new TypeError(
                `trade subscription verifier ${methodName} is invalid`,
            );
        }
    }
    if (!isVerifiedSmartOrderTradeSubscriptionTransportVerifier(value)) {
        throw new TypeError(
            'trade subscription transport verifier is not authority-issued',
        );
    }
    return Object.freeze({
        receiver: value,
        verifyConnectionEvidence: verifier.verifyConnectionEvidence,
        verifyEventEvidence: verifier.verifyEventEvidence,
        verifySubscriptionEvidence: verifier.verifySubscriptionEvidence,
    });
}

function verifiedDigest(result, label) {
    let snapshot;
    try {
        snapshot = snapshotExactDataProperties(
            result,
            ['evidenceSha256', 'valid'],
            label,
        );
    } catch {
        return undefined;
    }
    if (
        snapshot.valid !== true ||
        typeof snapshot.evidenceSha256 !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(snapshot.evidenceSha256)
    ) {
        return undefined;
    }
    return snapshot.evidenceSha256;
}

/**
 * Private, fail-closed task 5.4 core. It owns no HTTP/SSE client and cannot
 * create a Shioaji login. A production transport must supply a private
 * verifier capability; without one, no subscription plan can be issued.
 * Even verified test projections never grant readiness or broker authority.
 */
export function createSmartOrderTradeSubscriptionCoordinator(options) {
    const constructor = snapshotExactDataProperties(
        options,
        CONSTRUCTOR_KEYS,
        'trade subscription coordinator options',
    );
    let apiGeneration = boundedToken(
        constructor.apiGeneration,
        'apiGeneration',
    );
    let connectionId = boundedToken(constructor.connectionId, 'connectionId');
    if (
        typeof constructor.nowMonotonicMs !== 'function' ||
        isProxy(constructor.nowMonotonicMs)
    ) {
        throw new TypeError('nowMonotonicMs must be a non-Proxy function');
    }
    const verifier = snapshotVerifier(constructor.transportVerifier);
    const accounts = new Map();
    const demandRecords = new WeakMap();
    const consumerIndex = new Map();
    const pendingPlans = new Map();
    const issuedPlans = new WeakMap();
    const streamRecords = new WeakMap();
    const consumedConnectionEvidenceSha256 = new Set();
    const consumedSubscriptionEvidenceSha256 = new Set();
    const eventEvidenceBindings = new Map();
    const retiredConnectionLineages = new Set([
        JSON.stringify([apiGeneration, connectionId]),
    ]);
    let connectionLineageRevision = 1;
    let connectionActive = false;
    let totalDemandCount = 0;
    let lastMonotonicMs = -1;
    let clockInvalid = false;
    let closed = false;

    function currentMonotonicMs() {
        if (clockInvalid) return undefined;
        let value;
        try {
            value = Reflect.apply(constructor.nowMonotonicMs, undefined, []);
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
    if (verifier) {
        if (claimedTransportVerifiers.has(verifier.receiver)) {
            throw new TypeError(
                'trade subscription transport verifier is already claimed',
            );
        }
        claimedTransportVerifiers.add(verifier.receiver);
        let initialVerification;
        try {
            initialVerification = Reflect.apply(
                verifier.verifyConnectionEvidence,
                verifier.receiver,
                [
                    constructor.initialConnectionEvidence,
                    Object.freeze({
                        action: 'initialize',
                        currentApiGeneration: null,
                        currentConnectionId: null,
                        currentConnectionLineageRevision: 0,
                        nextApiGeneration: apiGeneration,
                        nextConnectionId: connectionId,
                    }),
                ],
            );
        } catch {
            initialVerification = undefined;
        }
        const initialEvidenceSha256 = verifiedDigest(
            initialVerification,
            'initial trade connection verification result',
        );
        connectionActive = Boolean(initialEvidenceSha256);
        if (initialEvidenceSha256) {
            consumedConnectionEvidenceSha256.add(initialEvidenceSha256);
        }
    }

    function createAccountRecord(account) {
        const key = accountKey(account);
        return {
            key,
            account,
            accountScopeSha256: accountScopeSha256(account),
            consumers: new Set(),
            demandRevision: 0,
            planRevision: 0,
            pendingPlanId: null,
            confirmation: null,
            physicalState: verifier
                ? 'unsubscribed'
                : 'transport_unintegrated',
            lastFailureReason: null,
            reconciliationRequired: true,
            acceptedEventCount: 0,
            duplicateEventCount: 0,
            staleEventCount: 0,
            ledger: createCanonicalSmartOrderBrokerEventLedger(),
        };
    }

    function removePendingPlan(record) {
        if (!record.pendingPlanId) return;
        pendingPlans.delete(record.pendingPlanId);
        record.pendingPlanId = null;
    }

    function invalidateRecord(record, state, reason) {
        removePendingPlan(record);
        record.confirmation = null;
        record.physicalState = state;
        record.lastFailureReason = reason;
        record.reconciliationRequired = true;
    }

    function planSubscription(record) {
        if (
            closed ||
            !connectionActive ||
            clockInvalid ||
            !verifier ||
            record.consumers.size === 0 ||
            record.physicalState === 'subscription_result_unknown'
        ) {
            return undefined;
        }
        const issuedAtMonotonicMs = currentMonotonicMs();
        if (issuedAtMonotonicMs === undefined) {
            invalidateRecord(
                record,
                'clock_invalid',
                'trade_subscription_clock_invalid',
            );
            return undefined;
        }
        removePendingPlan(record);
        record.planRevision += 1;
        const planId = `trade-subscription-plan:${sha256(
            JSON.stringify([
                SMART_ORDER_TRADE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
                apiGeneration,
                connectionId,
                connectionLineageRevision,
                record.accountScopeSha256,
                record.demandRevision,
                record.planRevision,
            ]),
        ).slice(7)}`;
        const plan = deepFreeze({
            schemaVersion:
                SMART_ORDER_TRADE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            planId,
            action: 'subscribe_trade',
            account: record.account,
            accountScopeSha256: record.accountScopeSha256,
            apiGeneration,
            connectionId,
            connectionLineageRevision,
            demandRevision: record.demandRevision,
            issuedAtMonotonicMs,
            fixedAccountRequired: true,
            sharedExistingLoginRequired: true,
            createsNewLogin: false,
            automaticRetryAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        record.pendingPlanId = planId;
        record.physicalState = 'subscribe_planned';
        pendingPlans.set(planId, { plan, record });
        issuedPlans.set(plan, { plan, record });
        return plan;
    }

    function acquireFixedAccount(input) {
        if (closed) return deny('trade_subscription_coordinator_closed');
        let demand;
        try {
            demand = snapshotExactDataProperties(
                input,
                DEMAND_KEYS,
                'fixed trade account demand',
            );
        } catch {
            return deny('trade_subscription_demand_schema_invalid');
        }
        let account;
        let consumerId;
        try {
            account = canonicalAccount(demand.account);
            consumerId = boundedToken(demand.consumerId, 'consumerId', 240);
        } catch {
            return deny('trade_subscription_demand_schema_invalid');
        }
        if (totalDemandCount >= SMART_ORDER_MAX_TRADE_SUBSCRIPTION_DEMANDS) {
            return deny('trade_subscription_demand_capacity_exhausted');
        }
        const key = accountKey(account);
        const consumerKey = `${consumerId}\u001f${key}`;
        if (consumerIndex.has(consumerKey)) {
            return deny('trade_subscription_consumer_duplicate');
        }
        let record = accounts.get(key);
        if (!record) {
            if (accounts.size >= SMART_ORDER_MAX_FIXED_TRADE_ACCOUNTS) {
                return deny('fixed_trade_account_capacity_exhausted');
            }
            record = createAccountRecord(account);
            accounts.set(key, record);
        }
        const handle = deepFreeze({
            schemaVersion:
                SMART_ORDER_TRADE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            handleClass: 'fixed_trade_account_demand',
            accountScopeSha256: record.accountScopeSha256,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        const handleRecord = {
            active: true,
            consumerKey,
            handle,
            record,
        };
        demandRecords.set(handle, handleRecord);
        consumerIndex.set(consumerKey, handle);
        record.consumers.add(handle);
        record.demandRevision += 1;
        totalDemandCount += 1;
        if (
            record.physicalState === 'unsubscribed' ||
            record.physicalState === 'subscribe_failed'
        ) {
            planSubscription(record);
        }
        return handle;
    }

    function releaseFixedAccount(handle) {
        if (closed) return deny('trade_subscription_coordinator_closed');
        if (!handle || typeof handle !== 'object' || isProxy(handle)) {
            return deny('trade_subscription_handle_invalid');
        }
        const demand = demandRecords.get(handle);
        if (!demand || !demand.active || demand.handle !== handle) {
            return deny('trade_subscription_handle_invalid');
        }
        demand.active = false;
        demand.record.consumers.delete(handle);
        demand.record.demandRevision += 1;
        consumerIndex.delete(demand.consumerKey);
        totalDemandCount -= 1;
        if (demand.record.consumers.size > 0) {
            return deepFreeze({
                allowed: true,
                action: 'refcount_decremented',
                remainingDemandCount: demand.record.consumers.size,
                runtimeReadinessContribution: false,
                subscriptionTransportAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        removePendingPlan(demand.record);
        if (demand.record.confirmation || demand.record.physicalState === 'subscription_result_unknown') {
            invalidateRecord(
                demand.record,
                'orphaned_until_disconnect',
                'trade_subscription_cannot_be_unsubscribed_safely',
            );
            return deepFreeze({
                allowed: true,
                action: 'retained_until_disconnect',
                remainingDemandCount: 0,
                runtimeReadinessContribution: false,
                subscriptionTransportAuthority: false,
                brokerWriteAuthority: false,
            });
        }
        accounts.delete(demand.record.key);
        return deepFreeze({
            allowed: true,
            action: 'unconfirmed_demand_released',
            remainingDemandCount: 0,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function pendingSubscriptionPlans() {
        return Object.freeze(
            [...pendingPlans.values()]
                .map(({ plan }) => plan)
                .sort((left, right) =>
                    left.accountScopeSha256 < right.accountScopeSha256
                        ? -1
                        : left.accountScopeSha256 > right.accountScopeSha256
                          ? 1
                          : 0,
                ),
        );
    }

    function confirmSubscription(plan, evidence) {
        if (closed) return deny('trade_subscription_coordinator_closed');
        if (!plan || typeof plan !== 'object' || isProxy(plan)) {
            return deny('trade_subscription_plan_invalid');
        }
        const issued = issuedPlans.get(plan);
        if (!issued || issued.plan !== plan || !verifier) {
            return deny('trade_subscription_plan_invalid');
        }
        const pending = pendingPlans.get(plan.planId);
        const record = issued.record;
        if (
            !pending ||
            pending.plan !== plan ||
            pending.record !== record ||
            record.pendingPlanId !== plan.planId ||
            !connectionActive ||
            plan.apiGeneration !== apiGeneration ||
            plan.connectionId !== connectionId ||
            plan.connectionLineageRevision !== connectionLineageRevision
        ) {
            return deny('trade_subscription_plan_not_current');
        }
        let verification;
        try {
            verification = Reflect.apply(
                verifier.verifySubscriptionEvidence,
                verifier.receiver,
                [
                    evidence,
                    Object.freeze({
                        accountScopeSha256: record.accountScopeSha256,
                        apiGeneration,
                        connectionId,
                        connectionLineageRevision,
                        planId: plan.planId,
                    }),
                ],
            );
        } catch {
            return deny('trade_subscription_evidence_invalid');
        }
        const evidenceSha256 = verifiedDigest(
            verification,
            'trade subscription verification result',
        );
        if (!evidenceSha256) {
            return deny('trade_subscription_evidence_invalid');
        }
        const currentPending = pendingPlans.get(plan.planId);
        if (
            !currentPending ||
            currentPending.plan !== plan ||
            currentPending.record !== record ||
            record.pendingPlanId !== plan.planId ||
            !connectionActive ||
            plan.apiGeneration !== apiGeneration ||
            plan.connectionId !== connectionId ||
            plan.connectionLineageRevision !== connectionLineageRevision
        ) {
            return deny('trade_subscription_plan_not_current');
        }
        if (
            consumedSubscriptionEvidenceSha256.has(evidenceSha256) ||
            consumedSubscriptionEvidenceSha256.size >=
                SMART_ORDER_MAX_TRADE_VERIFICATION_BINDINGS
        ) {
            return deny('trade_subscription_evidence_replayed');
        }
        consumedSubscriptionEvidenceSha256.add(evidenceSha256);
        removePendingPlan(record);
        record.confirmation = Object.freeze({
            apiGeneration,
            connectionId,
            connectionLineageRevision,
            evidenceSha256,
            planId: plan.planId,
        });
        record.physicalState = 'confirmed';
        record.lastFailureReason = null;
        record.reconciliationRequired = true;
        const stream = deepFreeze({
            schemaVersion:
                SMART_ORDER_TRADE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            handleClass: 'confirmed_trade_event_stream',
            accountScopeSha256: record.accountScopeSha256,
            apiGeneration,
            connectionId,
            connectionLineageRevision,
            confirmationEvidenceSha256: evidenceSha256,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        streamRecords.set(stream, {
            active: true,
            record,
            stream,
        });
        return stream;
    }

    function reportSubscriptionFailure(plan, input) {
        if (closed) return deny('trade_subscription_coordinator_closed');
        if (!plan || typeof plan !== 'object' || isProxy(plan)) {
            return deny('trade_subscription_plan_invalid');
        }
        const issued = issuedPlans.get(plan);
        let failure;
        try {
            failure = snapshotExactDataProperties(
                input,
                FAILURE_KEYS,
                'trade subscription failure',
            );
        } catch {
            return deny('trade_subscription_failure_schema_invalid');
        }
        if (
            !issued ||
            issued.plan !== plan ||
            !FAILURE_REASONS.has(failure.reason) ||
            failure.planId !== plan.planId ||
            failure.apiGeneration !== apiGeneration ||
            failure.connectionId !== connectionId
        ) {
            return deny('trade_subscription_failure_schema_invalid');
        }
        const record = issued.record;
        const pending = pendingPlans.get(plan.planId);
        if (!pending || pending.plan !== plan || record.pendingPlanId !== plan.planId) {
            return deny('trade_subscription_plan_not_current');
        }
        invalidateRecord(
            record,
            failure.reason === 'subscribe_result_unknown'
                ? 'subscription_result_unknown'
                : failure.reason === 'transport_disconnected'
                  ? 'disconnected'
                  : 'subscribe_failed',
            failure.reason,
        );
        return deepFreeze({
            allowed: true,
            action: 'subscription_failure_latched',
            reason: failure.reason,
            reconciliationRequired: true,
            automaticRetryAllowed: false,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function retrySubscription(handle) {
        if (closed) return deny('trade_subscription_coordinator_closed');
        if (!handle || typeof handle !== 'object' || isProxy(handle)) {
            return deny('trade_subscription_handle_invalid');
        }
        const demand = demandRecords.get(handle);
        if (!demand || !demand.active || demand.handle !== handle) {
            return deny('trade_subscription_handle_invalid');
        }
        const record = demand.record;
        if (record.physicalState !== 'subscribe_failed') {
            return deny('trade_subscription_retry_not_allowed');
        }
        const plan = planSubscription(record);
        return plan
            ? deepFreeze({
                  allowed: true,
                  action: 'explicit_retry_planned',
                  plan,
                  runtimeReadinessContribution: false,
                  subscriptionTransportAuthority: false,
                  brokerWriteAuthority: false,
              })
            : deny('trade_subscription_retry_failed_closed');
    }

    function recordEvent(stream, candidate, evidence) {
        if (closed) return deny('trade_subscription_coordinator_closed');
        if (!stream || typeof stream !== 'object' || isProxy(stream)) {
            return deny('trade_stream_authority_invalid');
        }
        const streamRecord = streamRecords.get(stream);
        if (
            !streamRecord ||
            !streamRecord.active ||
            streamRecord.stream !== stream ||
            !verifier
        ) {
            return deny('trade_stream_authority_invalid');
        }
        const record = streamRecord.record;
        if (
            !connectionActive ||
            !record.confirmation ||
            record.physicalState !== 'confirmed' ||
            stream.connectionLineageRevision !== connectionLineageRevision ||
            stream.apiGeneration !== apiGeneration ||
            stream.connectionId !== connectionId
        ) {
            return deny('trade_stream_not_current');
        }
        let normalized;
        try {
            normalized = isNormalizedCanonicalSmartOrderBrokerEvent(candidate)
                ? candidate
                : normalizeCanonicalSmartOrderBrokerEvent(candidate);
        } catch {
            invalidateRecord(
                record,
                'event_schema_invalid',
                'trade_event_schema_invalid',
            );
            return deny('trade_event_schema_invalid', {
                reconciliationRequired: true,
            });
        }
        if (
            accountKey(normalized.account) !== record.key ||
            normalized.apiGeneration !== apiGeneration
        ) {
            invalidateRecord(
                record,
                'event_scope_mismatch',
                'trade_event_scope_mismatch',
            );
            return deny('trade_event_scope_mismatch', {
                reconciliationRequired: true,
            });
        }
        let verification;
        try {
            verification = Reflect.apply(
                verifier.verifyEventEvidence,
                verifier.receiver,
                [
                    evidence,
                    Object.freeze({
                        accountScopeSha256: record.accountScopeSha256,
                        apiGeneration,
                        brokerEventKeySha256:
                            normalized.brokerEventKeySha256,
                        brokerEventEvidenceSha256:
                            normalized.brokerEventEvidenceSha256,
                        connectionId,
                        connectionLineageRevision,
                        mappingRevision: normalized.mappingRevision,
                        payloadSha256: normalized.payloadSha256,
                    }),
                ],
            );
        } catch {
            verification = undefined;
        }
        const eventEvidenceSha256 = verifiedDigest(
            verification,
            'trade event verification result',
        );
        if (!eventEvidenceSha256) {
            invalidateRecord(
                record,
                'event_evidence_invalid',
                'trade_event_evidence_invalid',
            );
            return deny('trade_event_evidence_invalid', {
                reconciliationRequired: true,
            });
        }
        if (
            !connectionActive ||
            !record.confirmation ||
            record.physicalState !== 'confirmed' ||
            stream.connectionLineageRevision !== connectionLineageRevision ||
            stream.apiGeneration !== apiGeneration ||
            stream.connectionId !== connectionId ||
            stream.confirmationEvidenceSha256 !==
                record.confirmation.evidenceSha256
        ) {
            return deny('trade_stream_not_current', {
                reconciliationRequired: true,
            });
        }
        const existingEventEvidence = eventEvidenceBindings.get(
            eventEvidenceSha256,
        );
        if (
            existingEventEvidence !== undefined &&
            existingEventEvidence !== normalized.brokerEventEvidenceSha256
        ) {
            invalidateRecord(
                record,
                'event_evidence_replayed',
                'trade_event_evidence_replayed',
            );
            return deny('trade_event_evidence_replayed', {
                reconciliationRequired: true,
            });
        }
        if (
            existingEventEvidence === undefined &&
            eventEvidenceBindings.size >=
                SMART_ORDER_MAX_TRADE_VERIFICATION_BINDINGS
        ) {
            invalidateRecord(
                record,
                'event_evidence_capacity_exhausted',
                'trade_event_evidence_capacity_exhausted',
            );
            return deny('trade_event_evidence_capacity_exhausted', {
                reconciliationRequired: true,
            });
        }
        let accepted;
        try {
            accepted = record.ledger.acceptNormalized(normalized);
        } catch {
            invalidateRecord(
                record,
                'event_conflict',
                'trade_event_conflict',
            );
            return deny('trade_event_conflict', {
                reconciliationRequired: true,
            });
        }
        if (accepted.state === 'accepted') record.acceptedEventCount += 1;
        if (accepted.state === 'duplicate') record.duplicateEventCount += 1;
        if (accepted.state === 'stale') record.staleEventCount += 1;
        eventEvidenceBindings.set(
            eventEvidenceSha256,
            normalized.brokerEventEvidenceSha256,
        );
        return deepFreeze({
            allowed: true,
            state: accepted.state,
            event: accepted.event,
            accountScopeSha256: record.accountScopeSha256,
            reconciliationRequired: true,
            repositoryIngressAuthority: false,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function invalidateConnection(input, evidence, nextActive) {
        if (closed) return deny('trade_subscription_coordinator_closed');
        let connection;
        try {
            connection = snapshotExactDataProperties(
                input,
                CONNECTION_KEYS,
                'trade subscription connection',
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
            return deny('trade_subscription_connection_schema_invalid');
        }
        if (!nextActive) {
            if (
                !connectionActive ||
                connection.apiGeneration !== apiGeneration ||
                connection.connectionId !== connectionId
            ) {
                return deny('trade_subscription_connection_not_current');
            }
        } else if (
            connection.apiGeneration === apiGeneration &&
            connection.connectionId === connectionId
        ) {
            return deny('trade_subscription_connection_lineage_not_advanced');
        }
        const nextConnectionKey = JSON.stringify([
            connection.apiGeneration,
            connection.connectionId,
        ]);
        if (nextActive && retiredConnectionLineages.has(nextConnectionKey)) {
            return deny('trade_subscription_connection_lineage_retired');
        }
        if (!verifier) {
            return deny('trade_subscription_transport_unintegrated');
        }
        const verifiedCurrentApiGeneration = apiGeneration;
        const verifiedCurrentConnectionId = connectionId;
        const verifiedCurrentLineageRevision = connectionLineageRevision;
        let verification;
        try {
            verification = Reflect.apply(
                verifier.verifyConnectionEvidence,
                verifier.receiver,
                [
                    evidence,
                    Object.freeze({
                        action: nextActive ? 'replace' : 'disconnect',
                        currentApiGeneration: apiGeneration,
                        currentConnectionId: connectionId,
                        currentConnectionLineageRevision:
                            connectionLineageRevision,
                        nextApiGeneration: connection.apiGeneration,
                        nextConnectionId: connection.connectionId,
                    }),
                ],
            );
        } catch {
            verification = undefined;
        }
        const connectionEvidenceSha256 = verifiedDigest(
            verification,
            'trade connection verification result',
        );
        if (!connectionEvidenceSha256) {
            return deny('trade_subscription_connection_evidence_invalid');
        }
        if (
            apiGeneration !== verifiedCurrentApiGeneration ||
            connectionId !== verifiedCurrentConnectionId ||
            connectionLineageRevision !== verifiedCurrentLineageRevision ||
            (!nextActive && !connectionActive)
        ) {
            return deny('trade_subscription_connection_not_current');
        }
        if (
            consumedConnectionEvidenceSha256.has(connectionEvidenceSha256) ||
            consumedConnectionEvidenceSha256.size >=
                SMART_ORDER_MAX_TRADE_VERIFICATION_BINDINGS ||
            (nextActive &&
                retiredConnectionLineages.size >=
                    SMART_ORDER_MAX_TRADE_VERIFICATION_BINDINGS)
        ) {
            return deny('trade_subscription_connection_evidence_replayed');
        }
        consumedConnectionEvidenceSha256.add(connectionEvidenceSha256);
        if (nextActive) retiredConnectionLineages.add(nextConnectionKey);
        connectionLineageRevision += 1;
        connectionActive = nextActive;
        apiGeneration = connection.apiGeneration;
        connectionId = connection.connectionId;
        for (const record of accounts.values()) {
            invalidateRecord(
                record,
                nextActive ? 'unsubscribed' : 'disconnected',
                nextActive
                    ? 'trade_connection_replaced'
                    : 'trade_connection_disconnected',
            );
            if (nextActive && record.consumers.size > 0) {
                planSubscription(record);
            } else if (!nextActive && record.consumers.size === 0) {
                accounts.delete(record.key);
            }
        }
        return deepFreeze({
            allowed: true,
            action: nextActive
                ? 'connection_lineage_replaced'
                : 'connection_invalidated',
            connectionLineageRevision,
            reconciliationRequired: true,
            automaticResubscribeDispatchAllowed: false,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function accountStatus(record) {
        return deepFreeze({
            accountScopeSha256: record.accountScopeSha256,
            demandCount: record.consumers.size,
            physicalState: record.physicalState,
            subscriptionConfirmedCurrentLineage: Boolean(
                connectionActive &&
                    record.confirmation &&
                    record.confirmation.connectionLineageRevision ===
                        connectionLineageRevision &&
                    record.physicalState === 'confirmed',
            ),
            acceptedEventCount: record.acceptedEventCount,
            duplicateEventCount: record.duplicateEventCount,
            staleEventCount: record.staleEventCount,
            lastFailureReason: record.lastFailureReason,
            reconciliationRequired: true,
            accountIdentifiersExposed: false,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function status() {
        const projectedAccounts = Object.freeze(
            [...accounts.values()]
                .sort((left, right) =>
                    left.accountScopeSha256 < right.accountScopeSha256
                        ? -1
                        : left.accountScopeSha256 > right.accountScopeSha256
                          ? 1
                          : 0,
                )
                .map(accountStatus),
        );
        return deepFreeze({
            schemaVersion:
                SMART_ORDER_TRADE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            apiGenerationSha256: sha256(
                `smart-order-api-generation\u001f${apiGeneration}`,
            ),
            connectionIdSha256: sha256(
                `smart-order-trade-connection\u001f${connectionId}`,
            ),
            connectionLineageRevision,
            connectionActive,
            fixedAccountCount: accounts.size,
            totalDemandCount,
            pendingPlanCount: pendingPlans.size,
            confirmedAccountCount: projectedAccounts.filter(
                (entry) => entry.subscriptionConfirmedCurrentLineage,
            ).length,
            transportVerifierConfigured: Boolean(verifier),
            productionAdapterConfigured: Boolean(verifier),
            automaticResubscribeDispatchAllowed: false,
            reconciliationRequired: true,
            clockInvalid,
            closed,
            accounts: projectedAccounts,
            accountIdentifiersExposed: false,
            eventIdentifiersExposed: false,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function close() {
        if (closed) return status();
        closed = true;
        connectionActive = false;
        pendingPlans.clear();
        for (const record of accounts.values()) {
            invalidateRecord(
                record,
                'closed_subscription_unknown',
                'trade_subscription_coordinator_closed',
            );
        }
        return status();
    }

    const runtime = Object.freeze({
        acquireFixedAccount,
        releaseFixedAccount,
        confirmSubscription,
        reportSubscriptionFailure,
        retrySubscription,
        recordEvent,
        replaceConnection(input, evidence) {
            return invalidateConnection(input, evidence, true);
        },
        markDisconnected(input, evidence) {
            return invalidateConnection(input, evidence, false);
        },
        close,
    });
    const observer = Object.freeze({
        pendingSubscriptionPlans,
        status,
    });
    return Object.freeze({ observer, runtime });
}
