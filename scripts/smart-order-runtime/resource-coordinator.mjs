import {
    isVerifiedSmartOrderGateEvidence,
    verifySmartOrderSubscriptionOwnershipEvidence,
} from './gate-evidence-verifier.mjs';

export const SMART_ORDER_RESOURCE_COORDINATOR_SCHEMA_VERSION =
    'smart-order-resource-coordinator/2026-08-12.1';
export const SMART_ORDER_SUBSCRIPTION_OFFICIAL_LIMIT_UNITS = 200;
export const SMART_ORDER_SUBSCRIPTION_LOCAL_LIMIT_UNITS = 160;
export const SMART_ORDER_SUBSCRIPTION_RESERVED_HEADROOM_UNITS = 40;
export const SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND = 5;
export const SMART_ORDER_UNVERIFIED_SUBSCRIPTION_COUNTING_DIMENSION =
    'subscription-counting-dimension-unverified';

export const SMART_ORDER_RESOURCE_OPERATION_KINDS = Object.freeze([
    'market_data',
    'reconciliation',
    'status',
    'user_confirmed_cancel',
    'reduce_only_protection',
    'new_exposure',
]);

const OPERATION_POLICY = Object.freeze({
    market_data: Object.freeze({
        priorityClass: 'reconciliation_status',
        readOnly: true,
    }),
    reconciliation: Object.freeze({
        priorityClass: 'reconciliation_status',
        readOnly: true,
    }),
    status: Object.freeze({
        priorityClass: 'reconciliation_status',
        readOnly: true,
    }),
    user_confirmed_cancel: Object.freeze({
        priorityClass: 'cancel_protection',
        readOnly: false,
    }),
    reduce_only_protection: Object.freeze({
        priorityClass: 'cancel_protection',
        readOnly: false,
    }),
    new_exposure: Object.freeze({
        priorityClass: 'new_exposure',
        readOnly: false,
    }),
});

// Weighted priority gives safety work most slots without allowing a permanently
// busy safety queue to starve new-exposure work forever. A grant from this
// scheduler is capacity only; it is never broker/socket authority.
const WEIGHTED_PRIORITY_CYCLE = Object.freeze([
    'reconciliation_status',
    'reconciliation_status',
    'reconciliation_status',
    'reconciliation_status',
    'cancel_protection',
    'cancel_protection',
    'new_exposure',
]);

const issuedSubscriptionOwnership = new WeakMap();
const issuedResourceCoordinators = new WeakSet();
// A verified ownership report describes one shared subscription pool. Its
// reservations therefore share one process-local ledger even when the same
// canonical report is verified again or used by multiple coordinators.
const sharedSubscriptionReservationLedgers = new Map();
const sharedOperationAuthority = {
    owner: undefined,
    commonDispatchTimes: [],
    activeOperationIds: new Set(),
    terminalOperationIds: new Set(),
    terminalOperationOrder: [],
};
const SHARED_TERMINAL_OPERATION_CAPACITY = 4_096;

function snapshotJsonData(value, seen = new Set()) {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean'
    ) {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('non-finite JSON');
        return value;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) {
        throw new TypeError('non-JSON or cyclic input');
    }
    seen.add(value);
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError('input descriptors are unavailable');
    }
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) {
        throw new TypeError('symbol properties are forbidden');
    }
    let snapshot;
    if (Array.isArray(value)) {
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor?.value;
        if (!Number.isSafeInteger(length) || length < 0) {
            throw new TypeError('array length is invalid');
        }
        const expectedKeys = [
            ...Array.from({ length }, (_, index) => String(index)),
            'length',
        ].sort();
        if (
            keys.length !== expectedKeys.length ||
            !keys
                .sort()
                .every((key, index) => key === expectedKeys[index])
        ) {
            throw new TypeError('sparse or extended arrays are forbidden');
        }
        snapshot = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (
                !descriptor ||
                !descriptor.enumerable ||
                !Object.hasOwn(descriptor, 'value') ||
                Object.hasOwn(descriptor, 'get') ||
                Object.hasOwn(descriptor, 'set')
            ) {
                throw new TypeError('array accessors are forbidden');
            }
            snapshot.push(snapshotJsonData(descriptor.value, seen));
        }
    } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError('non-plain object is forbidden');
        }
        snapshot = {};
        for (const key of keys.sort()) {
            const descriptor = descriptors[key];
            if (
                !descriptor.enumerable ||
                !Object.hasOwn(descriptor, 'value') ||
                Object.hasOwn(descriptor, 'get') ||
                Object.hasOwn(descriptor, 'set')
            ) {
                throw new TypeError('object accessors are forbidden');
            }
            snapshot[key] = snapshotJsonData(descriptor.value, seen);
        }
    }
    seen.delete(value);
    return Object.freeze(snapshot);
}

function snapshotExactDataProperties(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return undefined;
    }
    const actual = Reflect.ownKeys(descriptors);
    if (actual.some((key) => typeof key !== 'string')) return undefined;
    actual.sort();
    const sortedExpected = [...expected].sort();
    if (
        actual.length !== sortedExpected.length ||
        !actual.every((key, index) => key === sortedExpected[index])
    ) {
        return undefined;
    }
    const snapshot = {};
    for (const key of expected) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
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

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value, label, maximum = 1_000_000) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function boundedToken(value, label) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 256 ||
        !/^[A-Za-z0-9_.:@/-]+$/.test(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function deny(reason, details = {}) {
    return Object.freeze({
        allowed: false,
        reason,
        ...details,
    });
}

function invalidEvidence(reasons) {
    return Object.freeze({
        issued: false,
        evidenceClass: 'subscription_ownership',
        reasons: Object.freeze([...new Set(reasons)].sort()),
    });
}

/**
 * Wraps the canonical Gate evidence verifier and binds its verified report to
 * the resource projection used by this module. The returned object is opaque:
 * cloning its visible fields does not reproduce the WeakMap-held authority.
 * It still grants no subscription, broker, or write-master authority by itself.
 */
export function verifyCurrentSmartOrderSubscriptionOwnership({
    report,
    expected,
    nowEpochMs,
    maximumAgeMs,
}) {
    let reportSnapshot;
    let expectedSnapshot;
    try {
        reportSnapshot = snapshotJsonData(report);
        expectedSnapshot = snapshotJsonData(expected);
    } catch {
        return invalidEvidence(['verifier_context_invalid']);
    }
    let gateEvidence;
    try {
        gateEvidence = verifySmartOrderSubscriptionOwnershipEvidence({
            report: reportSnapshot,
            expected: expectedSnapshot,
            nowEpochMs,
            ...(maximumAgeMs === undefined ? {} : { maximumAgeMs }),
        });
    } catch {
        return invalidEvidence(['verifier_context_invalid']);
    }
    if (
        !gateEvidence.eligible ||
        !isVerifiedSmartOrderGateEvidence(gateEvidence)
    ) {
        return invalidEvidence(gateEvidence.reasons ?? ['evidence_invalid']);
    }

    const limitsMatchTaskContract =
        reportSnapshot?.pool?.officialLimitUnits ===
            SMART_ORDER_SUBSCRIPTION_OFFICIAL_LIMIT_UNITS &&
        reportSnapshot?.pool?.localLimitUnits ===
            SMART_ORDER_SUBSCRIPTION_LOCAL_LIMIT_UNITS &&
        reportSnapshot?.pool?.reservedHeadroomUnits ===
            SMART_ORDER_SUBSCRIPTION_RESERVED_HEADROOM_UNITS &&
        reportSnapshot.pool.localLimitUnits +
                reportSnapshot.pool.reservedHeadroomUnits ===
            reportSnapshot.pool.officialLimitUnits;
    if (!limitsMatchTaskContract) {
        return invalidEvidence(['resource_limit_contract_mismatch']);
    }

    const handle = Object.freeze({
        issued: true,
        evidenceClass: 'subscription_ownership',
        evidenceId: gateEvidence.evidenceId,
        resultSha256: gateEvidence.resultSha256,
        validUntilEpochMs: gateEvidence.validUntilEpochMs,
        countingDimension: reportSnapshot.countingDimension,
        totalUsageUnits: reportSnapshot.pool.totalUsageUnits,
        grantsWriteAuthority: false,
    });
    const projection = Object.freeze({
        gateEvidence,
        poolAuthorityLineage: JSON.stringify([
            'smart-order-shared-subscription-pool/v1',
            reportSnapshot.countingDimension,
            reportSnapshot.pool.officialLimitUnits,
            reportSnapshot.pool.localLimitUnits,
            reportSnapshot.pool.reservedHeadroomUnits,
        ]),
        generatedAtEpochMs: gateEvidence.generatedAtEpochMs,
        validUntilEpochMs: gateEvidence.validUntilEpochMs,
        countingDimension: reportSnapshot.countingDimension,
        totalUsageUnits: reportSnapshot.pool.totalUsageUnits,
        officialLimitUnits: reportSnapshot.pool.officialLimitUnits,
        localLimitUnits: reportSnapshot.pool.localLimitUnits,
        reservedHeadroomUnits: reportSnapshot.pool.reservedHeadroomUnits,
    });
    issuedSubscriptionOwnership.set(handle, projection);
    sharedSubscriptionLedgerFor(projection);
    return handle;
}

function subscriptionEvidenceProjection(evidence) {
    const projection = issuedSubscriptionOwnership.get(evidence);
    if (
        !projection ||
        !isVerifiedSmartOrderGateEvidence(projection.gateEvidence)
    ) {
        return undefined;
    }
    return projection;
}

function sharedSubscriptionLedgerFor(projection) {
    if (!projection) return undefined;
    const lineageKey = projection.poolAuthorityLineage;
    let ledger = sharedSubscriptionReservationLedgers.get(lineageKey);
    if (!ledger) {
        ledger = {
            currentEvidenceId: projection.gateEvidence.evidenceId,
            currentGeneratedAtEpochMs: projection.generatedAtEpochMs,
            currentResultSha256: projection.gateEvidence.resultSha256,
            currentTotalUsageUnits: projection.totalUsageUnits,
            conflicted: false,
            reservationUnits: 0,
            reservations: new Map(),
        };
        sharedSubscriptionReservationLedgers.set(lineageKey, ledger);
    } else if (
        projection.generatedAtEpochMs > ledger.currentGeneratedAtEpochMs
    ) {
        ledger.currentEvidenceId = projection.gateEvidence.evidenceId;
        ledger.currentGeneratedAtEpochMs = projection.generatedAtEpochMs;
        ledger.currentResultSha256 = projection.gateEvidence.resultSha256;
        ledger.currentTotalUsageUnits = projection.totalUsageUnits;
        ledger.conflicted = false;
    } else if (
        projection.generatedAtEpochMs === ledger.currentGeneratedAtEpochMs &&
        (projection.gateEvidence.resultSha256 !== ledger.currentResultSha256 ||
            projection.totalUsageUnits !== ledger.currentTotalUsageUnits)
    ) {
        ledger.conflicted = true;
    }
    return ledger;
}

/**
 * Offline resource policy core for task 5.10.
 *
 * The coordinator deliberately has no broker adapter callback and cannot
 * create dispatch authority. Operation-bucket classification is not yet
 * backed by task 0.16 live evidence, so every operation shares the stricter
 * rolling five-per-second limiter. A future classified-bucket implementation
 * must add a separate verifier-issued evidence type rather than accepting a
 * caller-provided bucket string.
 */
export function createSmartOrderResourceCoordinator({
    subscriptionOwnershipEvidence,
    nowEpochMs = () => Date.now(),
    nowMonotonicMs = () => Math.floor(performance.now()),
    maxQueued = 32,
    maxInFlight = 1,
    safetyReservedCapacity = 10,
    reconciliationReservedCapacity = 4,
    maxRetries = 3,
    retryBaseDelayMs = 100,
    retryMaximumDelayMs = 2_000,
    maxTerminalRecords = 4_096,
    scheduleOperationPump = setTimeout,
} = {}) {
    positiveInteger(maxQueued, 'maxQueued', 100_000);
    positiveInteger(maxInFlight, 'maxInFlight', 1_024);
    positiveInteger(
        safetyReservedCapacity,
        'safetyReservedCapacity',
        maxQueued,
    );
    positiveInteger(
        reconciliationReservedCapacity,
        'reconciliationReservedCapacity',
        safetyReservedCapacity,
    );
    positiveInteger(maxRetries, 'maxRetries', 32);
    positiveInteger(retryBaseDelayMs, 'retryBaseDelayMs', 60_000);
    positiveInteger(retryMaximumDelayMs, 'retryMaximumDelayMs', 600_000);
    positiveInteger(maxTerminalRecords, 'maxTerminalRecords', 1_000_000);
    if (
        maxInFlight !== 1 ||
        safetyReservedCapacity >= maxQueued ||
        reconciliationReservedCapacity >= safetyReservedCapacity ||
        retryBaseDelayMs > retryMaximumDelayMs ||
        maxTerminalRecords < maxQueued
    ) {
        throw new TypeError('resource coordinator limits are inconsistent');
    }
    if (typeof scheduleOperationPump !== 'function') {
        throw new TypeError('scheduleOperationPump must be a function');
    }

    const evidenceProjection = subscriptionEvidenceProjection(
        subscriptionOwnershipEvidence,
    );
    const sharedSubscriptionLedger = sharedSubscriptionLedgerFor(
        evidenceProjection,
    );
    const coordinatorOwner = Object.freeze({});
    const subscriptionReservations = new Map();
    const queues = new Map(
        [...new Set(WEIGHTED_PRIORITY_CYCLE)].map((priorityClass) => [
            priorityClass,
            [],
        ]),
    );
    const queuedOperations = new Map();
    const inFlightOperations = new Map();
    const terminalOperationIds = new Set();
    const terminalOperationOrder = [];
    const managedOperationWaiters = new Map();
    const additionalOperationUnitWaiters = new Set();
    let priorityCursor = 0;
    let managedPumpScheduled = false;
    let managedPumpTaking = false;
    let closed = false;
    let clockInvalid = false;
    let evidenceClockInvalid = false;
    let lastEpochMs = -1;
    let lastMonotonicMs = -1;

    const currentEpochMs = () => {
        if (evidenceClockInvalid) return undefined;
        const value = nowEpochMs();
        if (
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value < lastEpochMs
        ) {
            evidenceClockInvalid = true;
            return undefined;
        }
        lastEpochMs = value;
        return value;
    };
    const currentMonotonicMs = () => {
        if (clockInvalid) return undefined;
        const value = nowMonotonicMs();
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
    };
    const evidenceState = () => {
        if (!evidenceProjection) {
            return deny('subscription_ownership_unverified');
        }
        if (sharedSubscriptionLedger.conflicted) {
            return deny('subscription_ownership_conflict');
        }
        if (
            evidenceProjection.generatedAtEpochMs !==
                sharedSubscriptionLedger.currentGeneratedAtEpochMs ||
            evidenceProjection.gateEvidence.resultSha256 !==
                sharedSubscriptionLedger.currentResultSha256 ||
            evidenceProjection.totalUsageUnits !==
                sharedSubscriptionLedger.currentTotalUsageUnits
        ) {
            return deny('subscription_ownership_superseded');
        }
        const epochMs = currentEpochMs();
        if (
            epochMs === undefined ||
            epochMs < evidenceProjection.generatedAtEpochMs ||
            epochMs >= evidenceProjection.validUntilEpochMs
        ) {
            return deny('subscription_ownership_stale');
        }
        return Object.freeze({ allowed: true, epochMs });
    };
    const totalPending = () =>
        queuedOperations.size + inFlightOperations.size;
    const queueCapacityReason = (priorityClass) => {
        const current = totalPending();
        if (current >= maxQueued) return 'broker_queue_full';
        if (
            priorityClass === 'new_exposure' &&
            current >= maxQueued - safetyReservedCapacity
        ) {
            return 'safety_capacity_reserved';
        }
        if (
            priorityClass === 'cancel_protection' &&
            current >= maxQueued - reconciliationReservedCapacity
        ) {
            return 'reconciliation_capacity_reserved';
        }
        return undefined;
    };
    const retryDelay = (attempt) =>
        Math.min(
            retryMaximumDelayMs,
            retryBaseDelayMs * 2 ** Math.max(0, attempt - 1),
        );
    const closeOperation = (operationId) => {
        while (terminalOperationIds.size >= maxTerminalRecords) {
            terminalOperationIds.delete(terminalOperationOrder.shift());
        }
        while (
            sharedOperationAuthority.terminalOperationIds.size >=
            SHARED_TERMINAL_OPERATION_CAPACITY
        ) {
            sharedOperationAuthority.terminalOperationIds.delete(
                sharedOperationAuthority.terminalOperationOrder.shift(),
            );
        }
        terminalOperationIds.add(operationId);
        terminalOperationOrder.push(operationId);
        sharedOperationAuthority.terminalOperationIds.add(operationId);
        sharedOperationAuthority.terminalOperationOrder.push(operationId);
        sharedOperationAuthority.activeOperationIds.delete(operationId);
        return true;
    };
    const releaseOperationAuthorityIfClosedAndSettled = () => {
        if (
            inFlightOperations.size === 0 &&
            queuedOperations.size === 0 &&
            sharedOperationAuthority.owner === coordinatorOwner
        ) {
            sharedOperationAuthority.owner = undefined;
        }
    };
    const releaseSubscriptionReservations = () => {
        for (const reservation of [...subscriptionReservations.values()]) {
            reservation.lease.release();
        }
    };
    const enqueueRecord = (record) => {
        const capacityReason = queueCapacityReason(record.priorityClass);
        if (capacityReason) return deny(capacityReason);
        queues.get(record.priorityClass).push(record);
        queuedOperations.set(record.operationId, record);
        return Object.freeze({
            allowed: true,
            operationId: record.operationId,
            priorityClass: record.priorityClass,
            attempt: record.attempt,
            brokerAuthority: false,
        });
    };

    let coordinator;
    const rejectManagedWaiters = (reason) => {
        const error = new Error(`resource coordinator failed closed: ${reason}`);
        for (const waiter of managedOperationWaiters.values()) {
            waiter.reject(error);
        }
        managedOperationWaiters.clear();
        for (const waiter of additionalOperationUnitWaiters) {
            waiter.reject(error);
        }
        additionalOperationUnitWaiters.clear();
    };
    const scheduleManagedPump = (delayMs = 0) => {
        if (
            closed ||
            managedPumpScheduled ||
            managedOperationWaiters.size === 0
        ) {
            return;
        }
        managedPumpScheduled = true;
        scheduleOperationPump(() => {
            managedPumpScheduled = false;
            if (closed || managedOperationWaiters.size === 0) return;
            managedPumpTaking = true;
            let grant;
            try {
                grant = coordinator.takeNextOperation();
            } finally {
                managedPumpTaking = false;
            }
            if (grant.allowed === true) {
                const waiter = managedOperationWaiters.get(grant.operationId);
                if (!waiter) {
                    coordinator.abandonOperation({
                        operationId: grant.operationId,
                    });
                    closed = true;
                    rejectManagedWaiters('scheduler_grant_without_waiter');
                    return;
                }
                managedOperationWaiters.delete(grant.operationId);
                waiter.resolve(grant);
                return;
            }
            if (
                [
                    'broker_operation_in_flight',
                    'bounded_backoff_pending',
                    'common_operation_rate_limited',
                ].includes(grant.reason)
            ) {
                scheduleManagedPump(
                    Number.isSafeInteger(grant.retryAfterMs)
                        ? grant.retryAfterMs
                        : 1,
                );
                return;
            }
            closed = true;
            rejectManagedWaiters(grant.reason ?? 'resource_scheduler_invalid');
        }, delayMs);
    };

    coordinator = Object.freeze({
        acquireOperation(input) {
            const operation = snapshotExactDataProperties(input, [
                'kind',
                'operationId',
            ]);
            if (!operation) {
                return Promise.reject(
                    new TypeError('managed operation schema is invalid'),
                );
            }
            const enqueued = coordinator.enqueueOperation(operation);
            if (enqueued.allowed !== true) {
                return Promise.reject(
                    new Error(
                        `resource operation admission denied: ${enqueued.reason}`,
                    ),
                );
            }
            const grant = new Promise((resolve, reject) => {
                managedOperationWaiters.set(operation.operationId, {
                    reject,
                    resolve,
                });
            });
            scheduleManagedPump();
            return grant;
        },

        acquireOperationUnit(input) {
            const operation = snapshotExactDataProperties(input, [
                'operationId',
            ]);
            if (!operation) {
                return Promise.reject(
                    new TypeError(
                            'operation unit schema is invalid',
                    ),
                );
            }
            return new Promise((resolve, reject) => {
                const waiter = { reject };
                additionalOperationUnitWaiters.add(waiter);
                const finish = (callback, value) => {
                    if (!additionalOperationUnitWaiters.delete(waiter)) return;
                    callback(value);
                };
                const attempt = () => {
                    if (!additionalOperationUnitWaiters.has(waiter)) return;
                    if (closed) {
                        finish(
                            reject,
                            new Error(
                                'resource coordinator failed closed: resource_coordinator_closed',
                            ),
                        );
                        return;
                    }
                    if (!inFlightOperations.has(operation.operationId)) {
                        finish(
                            reject,
                            new Error(
                                'resource operation unit requires the current in-flight grant',
                            ),
                        );
                        return;
                    }
                    const monotonicMs = currentMonotonicMs();
                    if (monotonicMs === undefined) {
                        finish(
                            reject,
                            new Error(
                                'resource coordinator failed closed: resource_clock_invalid',
                            ),
                        );
                        return;
                    }
                    const cutoff = monotonicMs - 1_000;
                    while (
                        sharedOperationAuthority.commonDispatchTimes.length >
                            0 &&
                        sharedOperationAuthority.commonDispatchTimes[0] <
                            cutoff
                    ) {
                        sharedOperationAuthority.commonDispatchTimes.shift();
                    }
                    if (
                        sharedOperationAuthority.commonDispatchTimes.length >=
                        SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND
                    ) {
                        const retryAfterMs = Math.max(
                            1,
                            sharedOperationAuthority.commonDispatchTimes[0] +
                                1_001 -
                                monotonicMs,
                        );
                        scheduleOperationPump(attempt, retryAfterMs);
                        return;
                    }
                    sharedOperationAuthority.commonDispatchTimes.push(
                        monotonicMs,
                    );
                    finish(
                        resolve,
                        Object.freeze({
                            allowed: true,
                            operationId: operation.operationId,
                            operationBucketMode:
                                'conservative_common_unclassified',
                            rateLimitPerSecond:
                                SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND,
                            operationUnit: true,
                            brokerAuthority: false,
                        }),
                    );
                };
                attempt();
            });
        },

        reserveSubscriptionDemand(input) {
            if (closed) return deny('resource_coordinator_closed');
            const demand = snapshotExactDataProperties(input, [
                'countingDimension',
                'demandId',
                'transport',
                'units',
            ]);
            if (!demand) {
                return deny('subscription_demand_schema_invalid');
            }
            let demandId;
            try {
                demandId = boundedToken(demand.demandId, 'demandId');
            } catch {
                return deny('subscription_demand_schema_invalid');
            }
            if (demand.transport !== 'subscription') {
                return deny('snapshot_polling_substitute_forbidden');
            }
            const currentEvidence = evidenceState();
            if (!currentEvidence.allowed) return currentEvidence;
            if (
                typeof demand.countingDimension !== 'string' ||
                demand.countingDimension !==
                    evidenceProjection.countingDimension ||
                demand.countingDimension === 'unknown'
            ) {
                return deny('subscription_counting_dimension_mismatch');
            }
            if (!safeCount(demand.units) || demand.units === 0) {
                return deny('subscription_units_invalid');
            }
            if (sharedSubscriptionLedger.reservations.has(demandId)) {
                return deny('subscription_demand_duplicate');
            }
            const projectedUsage =
                sharedSubscriptionLedger.currentTotalUsageUnits +
                sharedSubscriptionLedger.reservationUnits +
                demand.units;
            // The OpenSpec scenario requires the sum to remain strictly below
            // the local ceiling; reaching 160 is a denial, preserving >=40
            // official units of headroom.
            if (
                projectedUsage >= evidenceProjection.localLimitUnits ||
                evidenceProjection.officialLimitUnits - projectedUsage <
                    evidenceProjection.reservedHeadroomUnits
            ) {
                return deny('local_subscription_budget_exhausted', {
                    projectedUsageUnits: projectedUsage,
                });
            }
            let released = false;
            const lease = Object.freeze({
                allowed: true,
                demandId,
                countingDimension: evidenceProjection.countingDimension,
                units: demand.units,
                projectedUsageUnits: projectedUsage,
                brokerAuthority: false,
                release() {
                    if (released) return;
                    released = true;
                    const reservation =
                        sharedSubscriptionLedger.reservations.get(demandId);
                    if (
                        reservation?.lease !== lease ||
                        reservation.owner !== coordinatorOwner
                    ) {
                        return;
                    }
                    sharedSubscriptionLedger.reservations.delete(demandId);
                    subscriptionReservations.delete(demandId);
                    sharedSubscriptionLedger.reservationUnits -= demand.units;
                },
            });
            const reservation = {
                lease,
                owner: coordinatorOwner,
                units: demand.units,
            };
            sharedSubscriptionLedger.reservations.set(demandId, reservation);
            subscriptionReservations.set(demandId, reservation);
            sharedSubscriptionLedger.reservationUnits += demand.units;
            return lease;
        },

        enqueueOperation(input) {
            if (closed) return deny('resource_coordinator_closed');
            const monotonicMs = currentMonotonicMs();
            if (monotonicMs === undefined) {
                return deny('resource_clock_invalid');
            }
            const operation = snapshotExactDataProperties(input, [
                'kind',
                'operationId',
            ]);
            if (!operation) {
                // In particular, a caller-supplied official bucket hint cannot
                // widen or bypass the conservative common limiter.
                return deny('operation_schema_invalid');
            }
            let operationId;
            try {
                operationId = boundedToken(
                    operation.operationId,
                    'operationId',
                );
            } catch {
                return deny('operation_schema_invalid');
            }
            const policy = Object.hasOwn(OPERATION_POLICY, operation.kind)
                ? OPERATION_POLICY[operation.kind]
                : undefined;
            if (!policy) return deny('operation_kind_unknown');
            if (
                terminalOperationIds.has(operationId) ||
                sharedOperationAuthority.terminalOperationIds.has(operationId) ||
                sharedOperationAuthority.activeOperationIds.has(operationId) ||
                queuedOperations.has(operationId) ||
                inFlightOperations.has(operationId)
            ) {
                return deny('operation_id_replay');
            }
            if (
                sharedOperationAuthority.owner !== undefined &&
                sharedOperationAuthority.owner !== coordinatorOwner
            ) {
                return deny('operation_authority_already_claimed');
            }
            sharedOperationAuthority.owner = coordinatorOwner;
            const enqueued = enqueueRecord({
                operationId,
                kind: operation.kind,
                priorityClass: policy.priorityClass,
                readOnly: policy.readOnly,
                dispatching: false,
                attempt: 0,
                enqueuedAtMonotonicMs: monotonicMs,
                notBeforeMonotonicMs: monotonicMs,
            });
            if (enqueued.allowed) {
                sharedOperationAuthority.activeOperationIds.add(operationId);
            }
            return enqueued;
        },

        takeNextOperation() {
            if (closed) return deny('resource_coordinator_closed');
            if (
                managedOperationWaiters.size > 0 &&
                !managedPumpTaking
            ) {
                return deny('managed_operation_scheduler_active');
            }
            const monotonicMs = currentMonotonicMs();
            if (monotonicMs === undefined) {
                return deny('resource_clock_invalid');
            }
            if (inFlightOperations.size >= maxInFlight) {
                return deny('broker_operation_in_flight');
            }
            if (sharedOperationAuthority.owner !== coordinatorOwner) {
                return deny('operation_authority_not_owned');
            }
            const cutoff = monotonicMs - 1_000;
            while (
                sharedOperationAuthority.commonDispatchTimes.length > 0 &&
                sharedOperationAuthority.commonDispatchTimes[0] < cutoff
            ) {
                sharedOperationAuthority.commonDispatchTimes.shift();
            }
            if (
                sharedOperationAuthority.commonDispatchTimes.length >=
                SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND
            ) {
                return deny('common_operation_rate_limited', {
                    retryAfterMs: Math.max(
                        1,
                        sharedOperationAuthority.commonDispatchTimes[0] +
                            1_001 -
                            monotonicMs,
                    ),
                });
            }

            let selected;
            let selectedCycleIndex = -1;
            for (
                let offset = 0;
                offset < WEIGHTED_PRIORITY_CYCLE.length;
                offset += 1
            ) {
                const cycleIndex =
                    (priorityCursor + offset) %
                    WEIGHTED_PRIORITY_CYCLE.length;
                const priorityClass = WEIGHTED_PRIORITY_CYCLE[cycleIndex];
                const queue = queues.get(priorityClass);
                const recordIndex = queue.findIndex(
                    (record) =>
                        record.notBeforeMonotonicMs <= monotonicMs,
                );
                if (recordIndex < 0) continue;
                selected = queue.splice(recordIndex, 1)[0];
                selectedCycleIndex = cycleIndex;
                break;
            }
            if (!selected) {
                if (queuedOperations.size === 0) return deny('broker_queue_empty');
                const notBefore = Math.min(
                    ...[...queuedOperations.values()].map(
                        (record) => record.notBeforeMonotonicMs,
                    ),
                );
                return deny('bounded_backoff_pending', {
                    retryAfterMs: Math.max(1, notBefore - monotonicMs),
                });
            }
            priorityCursor =
                (selectedCycleIndex + 1) % WEIGHTED_PRIORITY_CYCLE.length;
            queuedOperations.delete(selected.operationId);
            inFlightOperations.set(selected.operationId, selected);
            return Object.freeze({
                allowed: true,
                operationId: selected.operationId,
                kind: selected.kind,
                priorityClass: selected.priorityClass,
                attempt: selected.attempt,
                operationBucketMode: 'conservative_common_unclassified',
                rateLimitPerSecond:
                    SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND,
                schedulerGrantOnly: true,
                brokerAuthority: false,
            });
        },

        completeOperation(input) {
            const completion = snapshotExactDataProperties(input, [
                'operationId',
            ]);
            if (!completion) {
                return deny('operation_completion_schema_invalid');
            }
            const record = inFlightOperations.get(completion.operationId);
            if (!record) return deny('operation_not_in_flight');
            if (!record.readOnly && !record.dispatching) {
                return deny('write_dispatch_phase_unproven');
            }
            inFlightOperations.delete(completion.operationId);
            if (!closeOperation(completion.operationId)) {
                return deny('terminal_registry_inconsistent');
            }
            releaseOperationAuthorityIfClosedAndSettled();
            scheduleManagedPump();
            return Object.freeze({
                allowed: true,
                action: 'complete',
                retry: false,
                brokerAuthority: false,
            });
        },

        abandonOperation(input) {
            const abandonment = snapshotExactDataProperties(input, [
                'operationId',
            ]);
            if (!abandonment) {
                return deny('operation_abandonment_schema_invalid');
            }
            let record = inFlightOperations.get(abandonment.operationId);
            if (!record) {
                record = queuedOperations.get(abandonment.operationId);
                if (!record) return deny('operation_not_pending');
                const queue = queues.get(record.priorityClass);
                const index = queue.indexOf(record);
                if (index < 0) return deny('operation_queue_inconsistent');
                queue.splice(index, 1);
                queuedOperations.delete(abandonment.operationId);
            }
            if (record.dispatching) {
                return deny('broker_bytes_possible_no_abandonment');
            }
            inFlightOperations.delete(abandonment.operationId);
            if (!closeOperation(abandonment.operationId)) {
                return deny('terminal_registry_inconsistent');
            }
            releaseOperationAuthorityIfClosedAndSettled();
            scheduleManagedPump();
            return Object.freeze({
                allowed: true,
                action: 'abandon_proven_unsent',
                retry: false,
                brokerAuthority: false,
            });
        },

        markOperationDispatching(input) {
            if (closed) return deny('resource_coordinator_closed');
            const dispatch = snapshotExactDataProperties(input, [
                'operationId',
            ]);
            if (!dispatch) {
                return deny('operation_dispatch_schema_invalid');
            }
            const record = inFlightOperations.get(dispatch.operationId);
            if (!record) return deny('operation_not_in_flight');
            if (record.readOnly) {
                return deny('read_only_operation_has_no_dispatch_phase');
            }
            record.dispatching = true;
            return Object.freeze({
                allowed: true,
                operationId: record.operationId,
                state: 'dispatching_bytes_possible',
                brokerAuthority: false,
            });
        },

        handleOperationFailure(input) {
            const failure = snapshotExactDataProperties(input, [
                'failure',
                'operationId',
            ]);
            if (!failure) {
                return deny('operation_failure_schema_invalid');
            }
            const record = inFlightOperations.get(failure.operationId);
            if (!record) return deny('operation_not_in_flight');
            if (
                ![
                    'timeout',
                    'connection_error',
                    'transient_unavailable',
                ].includes(failure.failure)
            ) {
                return deny('operation_failure_schema_invalid');
            }
            if (
                !record.readOnly &&
                record.dispatching
            ) {
                // Once bytes may have crossed the local boundary, an invalid
                // retry clock cannot weaken the unknown/no-retry transition.
                currentMonotonicMs();
                inFlightOperations.delete(failure.operationId);
                if (!closeOperation(failure.operationId)) {
                    return deny('terminal_registry_inconsistent');
                }
                releaseOperationAuthorityIfClosedAndSettled();
                scheduleManagedPump();
                return Object.freeze({
                    allowed: true,
                    action: 'mark_unknown_reconcile',
                    retry: false,
                    reason: 'broker_bytes_possible_no_retry',
                    brokerAuthority: false,
                });
            }

            const monotonicMs = currentMonotonicMs();
            if (monotonicMs === undefined) {
                return deny('resource_clock_invalid');
            }
            inFlightOperations.delete(failure.operationId);

            // A write is retry-safe only while the coordinator still records
            // it as scheduler-granted but not dispatching. The caller cannot
            // submit a structural `proven_unsent` flag to reopen this branch.
            const retrySafe = record.readOnly || !record.dispatching;
            if (!retrySafe) {
                closeOperation(failure.operationId);
                releaseOperationAuthorityIfClosedAndSettled();
                scheduleManagedPump();
                return Object.freeze({
                    allowed: true,
                    action: 'fail_closed',
                    retry: false,
                    reason: 'retry_safety_unproven',
                    brokerAuthority: false,
                });
            }
            if (record.attempt >= maxRetries) {
                closeOperation(failure.operationId);
                releaseOperationAuthorityIfClosedAndSettled();
                scheduleManagedPump();
                return Object.freeze({
                    allowed: true,
                    action: 'retry_exhausted',
                    retry: false,
                    brokerAuthority: false,
                });
            }
            const nextAttempt = record.attempt + 1;
            const delayMs = retryDelay(nextAttempt);
            const notBeforeMonotonicMs = monotonicMs + delayMs;
            if (!Number.isSafeInteger(notBeforeMonotonicMs)) {
                closeOperation(failure.operationId);
                releaseOperationAuthorityIfClosedAndSettled();
                scheduleManagedPump();
                return Object.freeze({
                    allowed: true,
                    action: 'fail_closed',
                    retry: false,
                    reason: 'retry_clock_overflow',
                    brokerAuthority: false,
                });
            }
            const requeued = enqueueRecord({
                ...record,
                attempt: nextAttempt,
                enqueuedAtMonotonicMs: monotonicMs,
                notBeforeMonotonicMs,
            });
            if (!requeued.allowed) {
                closeOperation(failure.operationId);
                releaseOperationAuthorityIfClosedAndSettled();
                return Object.freeze({
                    allowed: true,
                    action: 'fail_closed',
                    retry: false,
                    reason: requeued.reason,
                    brokerAuthority: false,
                });
            }
            return Object.freeze({
                allowed: true,
                action: 'bounded_backoff',
                retry: true,
                attempt: nextAttempt,
                delayMs,
                brokerAuthority: false,
            });
        },

        status() {
            const projection = evidenceProjection;
            const currentEvidence = evidenceState();
            const queueDepthByPriority = Object.fromEntries(
                [...queues].map(([priorityClass, queue]) => [
                    priorityClass,
                    queue.length,
                ]),
            );
            return Object.freeze({
                schemaVersion: SMART_ORDER_RESOURCE_COORDINATOR_SCHEMA_VERSION,
                subscriptionEvidenceIssued: Boolean(projection),
                subscriptionEvidenceCurrent: currentEvidence.allowed,
                subscriptionEvidenceBlocker: currentEvidence.allowed
                    ? null
                    : currentEvidence.reason,
                subscriptionCountingDimension:
                    projection?.countingDimension ?? 'unknown',
                subscriptionObservedUsageUnits:
                    projection?.totalUsageUnits ?? null,
                subscriptionReservedUnits:
                    sharedSubscriptionLedger?.reservationUnits ?? 0,
                subscriptionLocalLimitUnits:
                    SMART_ORDER_SUBSCRIPTION_LOCAL_LIMIT_UNITS,
                subscriptionReservedHeadroomUnits:
                    SMART_ORDER_SUBSCRIPTION_RESERVED_HEADROOM_UNITS,
                operationBucketMode: 'conservative_common_unclassified',
                operationRateLimitPerSecond:
                    SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND,
                queueDepth: queuedOperations.size,
                queueDepthByPriority: Object.freeze(queueDepthByPriority),
                inFlight: inFlightOperations.size,
                maxQueued,
                maxInFlight,
                safetyReservedCapacity,
                reconciliationReservedCapacity,
                terminalRecords: terminalOperationIds.size,
                clockInvalid,
                evidenceClockInvalid,
                closed,
                writeMasterAuthority: false,
                brokerAuthority: false,
            });
        },

        close() {
            releaseSubscriptionReservations();
            for (const operationId of [...queuedOperations.keys()]) {
                queuedOperations.delete(operationId);
                closeOperation(operationId);
            }
            for (const queue of queues.values()) queue.length = 0;
            for (const operationId of [...inFlightOperations.keys()]) {
                // Closing a process-local scheduler never requeues an
                // operation, including one whose bytes may have crossed the
                // adapter boundary. Durable broker state remains unknown /
                // reconciling, while a replacement coordinator must still be
                // able to run higher-priority reconciliation work.
                inFlightOperations.delete(operationId);
                closeOperation(operationId);
            }
            closed = true;
            rejectManagedWaiters('resource_coordinator_closed');
            releaseOperationAuthorityIfClosedAndSettled();
        },
    });
    issuedResourceCoordinators.add(coordinator);
    return coordinator;
}

export function isIssuedSmartOrderResourceCoordinator(value) {
    return Boolean(
        value &&
            typeof value === 'object' &&
            issuedResourceCoordinators.has(value),
    );
}
