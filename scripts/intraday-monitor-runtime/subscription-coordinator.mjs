import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
    INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT,
    INTRADAY_MONITOR_REQUIRED_HEADROOM,
    inspectIssuedIntradayMonitorOwnershipInventory,
    intradayMonitorPhysicalKey,
} from './ownership-inventory-adapter.mjs';
import { inspectIssuedIntradayMonitorTransportReceipt } from './transport-confirmation-receipt.mjs';

export const INTRADAY_MONITOR_SUBSCRIPTION_COORDINATOR_SCHEMA =
    'intraday-monitor-subscription-coordinator/1';
export const INTRADAY_MONITOR_MAX_TOTAL_DEMANDS = 4_096;

const DEMAND_KEYS = Object.freeze([
    'consumerId',
    'ownerKind',
    'userOrder',
    'contract',
    'quoteType',
]);
const CONTRACT_KEYS = Object.freeze(['code', 'exchange', 'securityType']);
const REPLACEMENT_KEYS = Object.freeze(['ownershipInventory']);
const DISCONNECT_KEYS = Object.freeze(['connectionGeneration']);
const OWNER_PRIORITY = Object.freeze({
    chart: 0,
    alert: 1,
    smart_order_safety: 1,
    intraday_monitor: 2,
});
const QUOTE_TYPES = new Set(['tick', 'bidask']);
const EXCHANGES = new Set(['TSE', 'OTC']);
const RETAINED_STATES = new Set([
    'confirmed',
    'subscribe_unknown',
    'planned_unsubscribe',
    'unsubscribe_unknown',
    'inventory_unknown',
    'inventory_unsubscribe_pending',
]);
const issuedDemandHandles = new WeakMap();
const issuedPlans = new WeakMap();

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function exactSnapshot(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (actual.some((key) => typeof key !== 'string')) {
        throw new TypeError(`${label} symbol properties are forbidden`);
    }
    actual.sort();
    if (
        actual.length !== expected.length ||
        !actual.every((key, index) => key === expected[index])
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const output = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use enumerable data properties`);
        }
        output[key] = descriptor.value;
    }
    return Object.freeze(output);
}

function boundedToken(value, label, maximum = 256) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function normalizeContract(value) {
    const input = exactSnapshot(value, CONTRACT_KEYS, 'demand contract');
    const code = boundedToken(input.code, 'contract.code', 16);
    if (
        input.securityType !== 'STK' ||
        !EXCHANGES.has(input.exchange) ||
        !/^\d{4,6}[A-Z]?$/.test(code)
    ) {
        throw new TypeError('demand contract is unsupported');
    }
    return Object.freeze({
        code,
        exchange: input.exchange,
        securityType: 'STK',
    });
}

function normalizeDemand(value) {
    const input = exactSnapshot(value, DEMAND_KEYS, 'subscription demand');
    const consumerId = boundedToken(input.consumerId, 'consumerId');
    if (!Object.hasOwn(OWNER_PRIORITY, input.ownerKind)) {
        throw new TypeError('ownerKind is unsupported');
    }
    if (
        !Number.isSafeInteger(input.userOrder) ||
        input.userOrder < 0 ||
        input.userOrder > 1_000_000
    ) {
        throw new TypeError('userOrder is invalid');
    }
    if (!QUOTE_TYPES.has(input.quoteType)) {
        throw new TypeError('quoteType is unsupported');
    }
    return Object.freeze({
        consumerId,
        ownerKind: input.ownerKind,
        userOrder: input.userOrder,
        contract: normalizeContract(input.contract),
        quoteType: input.quoteType,
    });
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
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
        pollingFallbackAllowed: false,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
    });
}

function compareDemands(left, right) {
    const priorityDelta =
        OWNER_PRIORITY[left.ownerKind] - OWNER_PRIORITY[right.ownerKind];
    if (priorityDelta !== 0) return priorityDelta;
    if (
        left.ownerKind === 'intraday_monitor' &&
        right.ownerKind === 'intraday_monitor' &&
        left.userOrder !== right.userOrder
    ) {
        return left.userOrder - right.userOrder;
    }
    const leftKey = `${left.contract.exchange}:${left.contract.code}:${left.quoteType}:${left.consumerId}`;
    const rightKey = `${right.contract.exchange}:${right.contract.code}:${right.quoteType}:${right.consumerId}`;
    return leftKey.localeCompare(rightKey);
}

function hashPlan(parts) {
    return `intraday-subscription-plan:${createHash('sha256')
        .update(JSON.stringify(parts))
        .digest('hex')}`;
}

export function createIntradayMonitorSubscriptionCoordinator({
    ownershipInventory,
    nowEpochMs = () => Date.now(),
} = {}) {
    let inventory = inspectIssuedIntradayMonitorOwnershipInventory(
        ownershipInventory,
    );
    if (!inventory) {
        throw new TypeError('verifier-issued ownership inventory is required');
    }
    if (typeof nowEpochMs !== 'function' || isProxy(nowEpochMs)) {
        throw new TypeError('nowEpochMs must be a non-Proxy function');
    }

    const aggregates = new Map();
    const demandRecords = new Map();
    const consumerIndex = new Map();
    const pendingPlans = new Map();
    let connectionGeneration = inventory.connectionGeneration;
    let connectionActive = true;
    let revision = 0;
    let lastNow = -1;
    let clockInvalid = false;
    let closed = false;

    function currentNow() {
        if (clockInvalid) return undefined;
        let value;
        try {
            value = Reflect.apply(nowEpochMs, undefined, []);
        } catch {
            clockInvalid = true;
            return undefined;
        }
        if (!Number.isSafeInteger(value) || value < 0 || value < lastNow) {
            clockInvalid = true;
            return undefined;
        }
        lastNow = value;
        return value;
    }

    function evidenceCurrent() {
        const now = currentNow();
        return Boolean(
            now !== undefined &&
                now >= inventory.generatedAtEpochMs &&
                now < inventory.validUntilEpochMs,
        );
    }

    function createAggregate({ contract, quoteType, physicalKey }) {
        return {
            physicalKey,
            contract,
            quoteType,
            inventoryOwned: false,
            inventoryOwnerKinds: new Set(),
            inventoryRefCount: 0,
            demands: new Set(),
            physicalState: 'absent',
            pendingPlanId: null,
            planRevision: 0,
            lastPlanReason: null,
        };
    }

    function seedInventory() {
        for (const physical of inventory.physicalSubscriptions) {
            const aggregate = createAggregate(physical);
            aggregate.inventoryOwned = true;
            aggregate.inventoryRefCount = physical.ownerRefCount;
            aggregate.inventoryOwnerKinds = new Set(physical.ownerKinds);
            aggregate.physicalState =
                physical.confirmation === 'confirmed'
                    ? 'confirmed'
                    : physical.confirmation === 'unsubscribe_pending'
                      ? 'inventory_unsubscribe_pending'
                      : 'inventory_unknown';
            aggregates.set(aggregate.physicalKey, aggregate);
        }
    }

    seedInventory();

    function invalidatePlan(aggregate, rollback = true) {
        if (!aggregate.pendingPlanId) return;
        const record = pendingPlans.get(aggregate.pendingPlanId);
        pendingPlans.delete(aggregate.pendingPlanId);
        aggregate.pendingPlanId = null;
        if (rollback && record?.action === 'subscribe') {
            aggregate.physicalState = 'absent';
        } else if (rollback && record?.action === 'unsubscribe') {
            aggregate.physicalState = 'confirmed';
        }
    }

    function planFor(aggregate, action, reason) {
        const existing = aggregate.pendingPlanId
            ? pendingPlans.get(aggregate.pendingPlanId)
            : undefined;
        if (existing?.action === action && existing?.reason === reason) {
            return existing.plan;
        }
        invalidatePlan(aggregate);
        revision += 1;
        aggregate.planRevision += 1;
        const plan = deepFreeze({
            schemaVersion: INTRADAY_MONITOR_SUBSCRIPTION_COORDINATOR_SCHEMA,
            planId: hashPlan([
                connectionGeneration,
                aggregate.physicalKey,
                action,
                aggregate.planRevision,
                revision,
            ]),
            action,
            reason,
            connectionGeneration,
            physicalKey: aggregate.physicalKey,
            contract: aggregate.contract,
            quoteType: aggregate.quoteType,
            refCount: aggregate.inventoryRefCount + aggregate.demands.size,
            coordinatorRevision: revision,
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        const record = { action, reason, aggregate, plan };
        pendingPlans.set(plan.planId, record);
        issuedPlans.set(plan, record);
        aggregate.pendingPlanId = plan.planId;
        aggregate.lastPlanReason = reason;
        aggregate.physicalState =
            action === 'subscribe' ? 'planned_subscribe' : 'planned_unsubscribe';
        return plan;
    }

    function retainedPhysicalUsage() {
        return [...aggregates.values()].filter((aggregate) =>
            RETAINED_STATES.has(aggregate.physicalState),
        ).length;
    }

    function aggregateBestDemand(aggregate) {
        return [...aggregate.demands]
            .map((handle) => demandRecords.get(handle)?.input)
            .filter(Boolean)
            .sort(compareDemands)[0];
    }

    function hasOnlyIntradayDemand(aggregate) {
        return (
            aggregate.demands.size > 0 &&
            [...aggregate.demands].every(
                (handle) =>
                    demandRecords.get(handle)?.input.ownerKind ===
                    'intraday_monitor',
            )
        );
    }

    function inventoryAllowsPlanning() {
        return (
            !inventory.inventoryHasUnknownPhysicalState &&
            inventory.ownershipComplete &&
            inventory.externalUsageVisible
        );
    }

    function recompute() {
        if (
            closed ||
            !connectionActive ||
            !evidenceCurrent() ||
            !inventoryAllowsPlanning()
        ) {
            for (const aggregate of aggregates.values()) {
                invalidatePlan(aggregate);
            }
            return;
        }

        const absentCandidates = [...aggregates.values()]
            .filter(
                (aggregate) =>
                    aggregate.demands.size > 0 &&
                    ['absent', 'planned_subscribe'].includes(
                        aggregate.physicalState,
                    ),
            )
            .map((aggregate) => ({
                aggregate,
                bestDemand: aggregateBestDemand(aggregate),
            }))
            .sort((left, right) =>
                compareDemands(left.bestDemand, right.bestDemand),
            );

        const used = retainedPhysicalUsage();
        const highPriorityWaiting = absentCandidates.filter(
            ({ bestDemand }) => bestDemand.ownerKind !== 'intraday_monitor',
        ).length;
        const free = Math.max(
            0,
            INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT - used,
        );
        const preemptNeeded = Math.max(0, highPriorityWaiting - free);
        if (preemptNeeded > 0) {
            const victims = [...aggregates.values()]
                .filter(
                    (aggregate) =>
                        !aggregate.inventoryOwned &&
                        aggregate.physicalState === 'confirmed' &&
                        hasOnlyIntradayDemand(aggregate),
                )
                .sort((left, right) => {
                    const demandOrder = compareDemands(
                        aggregateBestDemand(right),
                        aggregateBestDemand(left),
                    );
                    return demandOrder !== 0
                        ? demandOrder
                        : right.physicalKey.localeCompare(left.physicalKey);
                })
                .slice(0, preemptNeeded);
            for (const victim of victims) {
                planFor(victim, 'unsubscribe', 'higher_priority_demand');
            }
        }

        const slots = Math.max(
            0,
            INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT - retainedPhysicalUsage(),
        );
        const selected = new Set(
            absentCandidates.slice(0, slots).map(({ aggregate }) => aggregate),
        );
        for (const { aggregate } of absentCandidates) {
            if (selected.has(aggregate)) {
                planFor(aggregate, 'subscribe', 'demand_admitted');
            } else if (aggregate.physicalState === 'planned_subscribe') {
                invalidatePlan(aggregate);
            }
        }
    }

    function acquireDemand(value) {
        if (closed) return deny('subscription_coordinator_closed');
        let input;
        try {
            input = normalizeDemand(value);
        } catch {
            return deny('subscription_demand_schema_invalid');
        }
        if (demandRecords.size >= INTRADAY_MONITOR_MAX_TOTAL_DEMANDS) {
            return deny('subscription_demand_limit_reached');
        }
        const consumerIdentity = `${input.ownerKind}\u001f${input.consumerId}`;
        if (consumerIndex.has(consumerIdentity)) {
            return deny('subscription_consumer_duplicate');
        }
        const physicalKey = intradayMonitorPhysicalKey(
            connectionGeneration,
            input.contract,
            input.quoteType,
        );
        let aggregate = aggregates.get(physicalKey);
        if (!aggregate) {
            aggregate = createAggregate({
                physicalKey,
                contract: input.contract,
                quoteType: input.quoteType,
            });
            aggregates.set(physicalKey, aggregate);
        }
        const handle = deepFreeze({
            allowed: true,
            schemaVersion: INTRADAY_MONITOR_SUBSCRIPTION_COORDINATOR_SCHEMA,
            handleClass: 'intraday_monitor_subscription_demand',
            consumerId: input.consumerId,
            ownerKind: input.ownerKind,
            physicalKey,
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        const record = { handle, input, aggregate, released: false };
        issuedDemandHandles.set(handle, record);
        demandRecords.set(handle, record);
        consumerIndex.set(consumerIdentity, handle);
        aggregate.demands.add(handle);
        revision += 1;
        recompute();
        return handle;
    }

    function releaseDemand(handle) {
        if (closed) return deny('subscription_coordinator_closed');
        if (!handle || typeof handle !== 'object' || isProxy(handle)) {
            return deny('subscription_demand_handle_invalid');
        }
        const record = issuedDemandHandles.get(handle);
        if (
            !record ||
            record.handle !== handle ||
            record.released ||
            !demandRecords.has(handle)
        ) {
            return deny('subscription_demand_handle_invalid');
        }
        record.released = true;
        record.aggregate.demands.delete(handle);
        demandRecords.delete(handle);
        consumerIndex.delete(
            `${record.input.ownerKind}\u001f${record.input.consumerId}`,
        );
        revision += 1;
        const aggregate = record.aggregate;
        if (aggregate.demands.size === 0 && !aggregate.inventoryOwned) {
            if (aggregate.physicalState === 'planned_subscribe') {
                invalidatePlan(aggregate);
                aggregates.delete(aggregate.physicalKey);
            } else if (aggregate.physicalState === 'absent') {
                aggregates.delete(aggregate.physicalKey);
            } else if (aggregate.physicalState === 'confirmed') {
                planFor(aggregate, 'unsubscribe', 'last_demand_released');
            }
        }
        recompute();
        return deepFreeze({
            allowed: true,
            action: 'demand_released',
            physicalState: aggregate.physicalState,
            capacityReleased: aggregate.physicalState === 'absent',
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function currentPlanRecord(plan) {
        if (!plan || typeof plan !== 'object' || isProxy(plan)) return undefined;
        const issued = issuedPlans.get(plan);
        if (
            !issued ||
            issued.plan !== plan ||
            issued.aggregate.pendingPlanId !== plan.planId ||
            pendingPlans.get(plan.planId) !== issued ||
            plan.connectionGeneration !== connectionGeneration
        ) {
            return undefined;
        }
        return issued;
    }

    function confirmPlan(plan, transportReceipt) {
        if (closed) return deny('subscription_coordinator_closed');
        const record = currentPlanRecord(plan);
        if (!record) return deny('subscription_plan_not_current');
        const receipt = inspectIssuedIntradayMonitorTransportReceipt(transportReceipt);
        if (!receipt || receipt.planId !== plan.planId || receipt.action !== plan.action ||
            receipt.connectionGeneration !== plan.connectionGeneration ||
            receipt.physicalKey !== plan.physicalKey) {
            return deny('subscription_confirmation_receipt_invalid');
        }
        const { aggregate, action } = record;
        pendingPlans.delete(plan.planId);
        aggregate.pendingPlanId = null;
        revision += 1;
        if (action === 'subscribe') {
            if (aggregate.demands.size === 0) {
                aggregate.physicalState = 'subscribe_unknown';
                return deny('subscription_demand_disappeared');
            }
            aggregate.physicalState = 'confirmed';
        } else {
            aggregate.physicalState = 'absent';
            if (aggregate.demands.size === 0 && !aggregate.inventoryOwned) {
                aggregates.delete(aggregate.physicalKey);
            }
        }
        recompute();
        return deepFreeze({
            allowed: true,
            action:
                action === 'subscribe'
                    ? 'subscription_confirmed'
                    : 'unsubscription_confirmed',
            physicalKey: aggregate.physicalKey,
            capacityReleased: action === 'unsubscribe',
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function reportPlanUnknown(plan) {
        if (closed) return deny('subscription_coordinator_closed');
        const record = currentPlanRecord(plan);
        if (!record) return deny('subscription_plan_not_current');
        pendingPlans.delete(plan.planId);
        record.aggregate.pendingPlanId = null;
        record.aggregate.physicalState =
            record.action === 'subscribe'
                ? 'subscribe_unknown'
                : 'unsubscribe_unknown';
        revision += 1;
        recompute();
        return deepFreeze({
            allowed: true,
            action: 'subscription_result_unknown_retained',
            physicalState: record.aggregate.physicalState,
            capacityReleased: false,
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function markDisconnected(value) {
        if (closed) return deny('subscription_coordinator_closed');
        let input;
        try {
            input = exactSnapshot(
                value,
                DISCONNECT_KEYS,
                'subscription disconnect',
            );
        } catch {
            return deny('subscription_disconnect_schema_invalid');
        }
        if (
            input.connectionGeneration !== connectionGeneration ||
            !connectionActive
        ) {
            return deny('subscription_generation_mismatch');
        }
        connectionActive = false;
        revision += 1;
        for (const aggregate of aggregates.values()) {
            invalidatePlan(aggregate, false);
            if (
                ['confirmed', 'planned_subscribe', 'planned_unsubscribe'].includes(
                    aggregate.physicalState,
                )
            ) {
                aggregate.physicalState = 'subscribe_unknown';
            }
        }
        return deepFreeze({
            allowed: true,
            action: 'connection_generation_paused',
            connectionGeneration,
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function replaceOwnershipInventory(value) {
        if (closed) return deny('subscription_coordinator_closed');
        let input;
        try {
            input = exactSnapshot(
                value,
                REPLACEMENT_KEYS,
                'ownership replacement',
            );
        } catch {
            return deny('ownership_replacement_schema_invalid');
        }
        const next = inspectIssuedIntradayMonitorOwnershipInventory(
            input.ownershipInventory,
        );
        if (!next) return deny('ownership_inventory_unverified');
        if (next.connectionGeneration === connectionGeneration) {
            return deny('connection_generation_not_advanced');
        }
        const now = currentNow();
        if (
            now === undefined ||
            now < next.generatedAtEpochMs ||
            now >= next.validUntilEpochMs
        ) {
            return deny('ownership_inventory_stale');
        }
        for (const aggregate of aggregates.values()) {
            invalidatePlan(aggregate, false);
        }
        const records = [...demandRecords.values()];
        aggregates.clear();
        inventory = next;
        connectionGeneration = next.connectionGeneration;
        connectionActive = true;
        seedInventory();
        for (const record of records) {
            const physicalKey = intradayMonitorPhysicalKey(
                connectionGeneration,
                record.input.contract,
                record.input.quoteType,
            );
            let aggregate = aggregates.get(physicalKey);
            if (!aggregate) {
                aggregate = createAggregate({
                    physicalKey,
                    contract: record.input.contract,
                    quoteType: record.input.quoteType,
                });
                aggregates.set(physicalKey, aggregate);
            }
            record.aggregate = aggregate;
            aggregate.demands.add(record.handle);
        }
        revision += 1;
        recompute();
        return deepFreeze({
            allowed: true,
            action: 'connection_generation_replaced',
            connectionGeneration,
            pendingPlans: sortedPlans(),
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function sortedPlans() {
        return deepFreeze(
            [...pendingPlans.values()]
                .map((record) => record.plan)
                .sort((left, right) => {
                    if (left.action !== right.action) {
                        return left.action === 'unsubscribe' ? -1 : 1;
                    }
                    const leftAggregate = pendingPlans.get(left.planId)?.aggregate;
                    const rightAggregate = pendingPlans.get(right.planId)?.aggregate;
                    const leftDemand = leftAggregate
                        ? aggregateBestDemand(leftAggregate)
                        : undefined;
                    const rightDemand = rightAggregate
                        ? aggregateBestDemand(rightAggregate)
                        : undefined;
                    if (leftDemand && rightDemand) {
                        const demandOrder = compareDemands(
                            leftDemand,
                            rightDemand,
                        );
                        if (demandOrder !== 0) return demandOrder;
                    }
                    return left.physicalKey.localeCompare(right.physicalKey);
                }),
        );
    }

    function subscriptionStatus(aggregate, current) {
        const demands = [...aggregate.demands]
            .map((handle) => demandRecords.get(handle)?.input)
            .filter(Boolean)
            .sort(compareDemands);
        const hasIntraday = demands.some(
            (demand) => demand.ownerKind === 'intraday_monitor',
        );
        const active =
            current &&
            connectionActive &&
            aggregate.physicalState === 'confirmed';
        let admission = active ? 'active' : 'waiting_capacity';
        let reason = active ? 'none' : 'capacity_exhausted';
        if (!current || !inventoryAllowsPlanning()) {
            admission = 'waiting_gate';
            reason = !current
                ? 'gate_evidence_missing'
                : 'ownership_incomplete';
        } else if (!connectionActive) {
            admission = 'degraded';
            reason = 'stream_disconnected';
        } else if (
            [
                'subscribe_unknown',
                'unsubscribe_unknown',
                'inventory_unknown',
                'inventory_unsubscribe_pending',
            ].includes(aggregate.physicalState)
        ) {
            admission = 'degraded';
            reason = 'subscription_confirmation_unknown';
        } else if (aggregate.physicalState === 'planned_subscribe') {
            reason = 'subscription_confirmation_pending';
        }
        return deepFreeze({
            physicalKey: aggregate.physicalKey,
            connectionGeneration,
            contract: aggregate.contract,
            quoteType: aggregate.quoteType,
            physicalState: aggregate.physicalState,
            inventoryOwned: aggregate.inventoryOwned,
            inventoryOwnerKinds: [...aggregate.inventoryOwnerKinds].sort(),
            inventoryRefCount: aggregate.inventoryRefCount,
            demandRefCount: demands.length,
            totalRefCount: aggregate.inventoryRefCount + demands.length,
            demandOwners: demands.map((demand) => demand.ownerKind),
            hasIntradayDemand: hasIntraday,
            admission,
            reason,
            active,
            pendingPlanId: aggregate.pendingPlanId,
        });
    }

    function status() {
        const current = evidenceCurrent();
        const subscriptions = [...aggregates.values()]
            .map((aggregate) => subscriptionStatus(aggregate, current))
            .sort((left, right) =>
                left.physicalKey.localeCompare(right.physicalKey),
            );
        const confirmedPhysicalUsage = subscriptions.filter(
            (entry) => entry.physicalState === 'confirmed',
        ).length;
        const retainedUsage = subscriptions.filter((entry) =>
            RETAINED_STATES.has(entry.physicalState),
        ).length;
        const confirmedOtherPhysicalUsage = subscriptions.filter(
            (entry) =>
                entry.physicalState === 'confirmed' &&
                (entry.inventoryOwnerKinds.some(
                    (kind) => kind !== 'intraday_monitor',
                ) ||
                    entry.demandOwners.some(
                        (kind) => kind !== 'intraday_monitor',
                    )),
        ).length;
        const intraday = subscriptions.filter(
            (entry) => entry.hasIntradayDemand,
        );
        const gateCurrent =
            current && inventoryAllowsPlanning() && connectionActive;
        return deepFreeze({
            schemaVersion: INTRADAY_MONITOR_SUBSCRIPTION_COORDINATOR_SCHEMA,
            revision,
            connectionGeneration,
            connectionActive,
            evidenceId: inventory.evidenceId,
            evidenceAtEpochMs: inventory.generatedAtEpochMs,
            evidenceValidUntilEpochMs: inventory.validUntilEpochMs,
            gate0EvidenceCurrent: gateCurrent,
            globalOwnershipComplete:
                inventory.ownershipComplete && inventory.externalUsageVisible,
            configuredDemandCount: demandRecords.size,
            trackedPhysicalCount: subscriptions.length,
            confirmedPhysicalUsage,
            retainedPhysicalUsage: retainedUsage,
            confirmedOtherPhysicalUsage,
            localPhysicalLimit: INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT,
            requiredHeadroom: INTRADAY_MONITOR_REQUIRED_HEADROOM,
            availableForMonitor: gateCurrent
                ? Math.max(
                      0,
                      INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT -
                          confirmedPhysicalUsage,
                  )
                : 0,
            activeIntradayCount: intraday.filter((entry) => entry.active).length,
            waitingIntradayCount: intraday.filter(
                (entry) => !entry.active && entry.admission !== 'degraded',
            ).length,
            degradedIntradayCount: intraday.filter(
                (entry) => entry.admission === 'degraded',
            ).length,
            pendingPlanCount: pendingPlans.size,
            subscriptions,
            clockInvalid,
            closed,
            sharedExistingLoginRequired: true,
            createsNewLogin: false,
            productionAdapterConfigured: false,
            automaticDispatchAllowed: false,
            snapshotPollingFallbackAllowed: false,
            ticksPollingFallbackAllowed: false,
            kbarsPollingFallbackAllowed: false,
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function close() {
        if (closed) return status();
        closed = true;
        for (const aggregate of aggregates.values()) {
            invalidatePlan(aggregate, false);
            if (aggregate.physicalState !== 'absent') {
                aggregate.physicalState = 'subscribe_unknown';
            }
        }
        revision += 1;
        return status();
    }

    return Object.freeze({
        acquireDemand,
        releaseDemand,
        confirmPlan,
        reportPlanUnknown,
        markDisconnected,
        replaceOwnershipInventory,
        pendingPlans: sortedPlans,
        status,
        close,
    });
}
