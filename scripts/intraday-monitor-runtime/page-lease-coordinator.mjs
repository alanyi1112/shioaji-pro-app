import { randomBytes } from 'node:crypto';
import { types as utilTypes } from 'node:util';

export const INTRADAY_MONITOR_PAGE_LEASE_SCHEMA = 'intraday-monitor-lease/1';
export const INTRADAY_MONITOR_PAGE_LEASE_COORDINATOR_SCHEMA =
    'intraday-monitor-page-lease-coordinator/1';
export const INTRADAY_MONITOR_DEFAULT_LEASE_TTL_MS = 15_000;
export const INTRADAY_MONITOR_MIN_LEASE_TTL_MS = 5_000;
export const INTRADAY_MONITOR_MAX_LEASE_TTL_MS = 60_000;

const ACQUIRE_KEYS = Object.freeze(['clientId', 'generation']);
const RETRY_KEYS = Object.freeze([]);
const issuedLeases = new WeakMap();

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

function boundedOpaque(value, label) {
    if (
        typeof value !== 'string' ||
        value.length < 16 ||
        value.length > 128 ||
        !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function snapshotCapability(value) {
    if (!value || typeof value !== 'object' || isProxy(value)) {
        throw new TypeError('sessionController is invalid');
    }
    const methods = [
        'startIntradayDemands',
        'flushMinuteEvidence',
        'releaseIntradayDemands',
    ];
    const output = { receiver: value };
    for (const method of methods) {
        let candidate;
        try {
            candidate = value[method];
        } catch {
            throw new TypeError(`sessionController.${method} is unavailable`);
        }
        if (typeof candidate !== 'function' || isProxy(candidate)) {
            throw new TypeError(`sessionController.${method} is invalid`);
        }
        output[method] = candidate;
    }
    return Object.freeze(output);
}

function snapshotResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) {
        return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output = {};
    for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') return undefined;
        const descriptor = descriptors[key];
        if (
            !descriptor.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            return undefined;
        }
        output[key] = descriptor.value;
    }
    if (
        typeof output.allowed !== 'boolean' ||
        output.subscriptionTransportAuthority !== false ||
        output.brokerWriteAuthority !== false
    ) {
        return undefined;
    }
    return Object.freeze(output);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function deny(reason) {
    return deepFreeze({
        allowed: false,
        reason,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
    });
}

function invoke(capability, method) {
    try {
        return snapshotResult(
            Reflect.apply(capability[method], capability.receiver, []),
        );
    } catch {
        return undefined;
    }
}

export function createIntradayMonitorPageLeaseCoordinator({
    sessionController,
    nowEpochMs = () => Date.now(),
    leaseTtlMs = INTRADAY_MONITOR_DEFAULT_LEASE_TTL_MS,
    scheduleWakeup = (callback, delayMs) => setTimeout(callback, delayMs),
    cancelWakeup = (timer) => clearTimeout(timer),
} = {}) {
    const capability = snapshotCapability(sessionController);
    if (
        typeof nowEpochMs !== 'function' ||
        isProxy(nowEpochMs) ||
        typeof scheduleWakeup !== 'function' ||
        isProxy(scheduleWakeup) ||
        typeof cancelWakeup !== 'function' ||
        isProxy(cancelWakeup) ||
        !Number.isSafeInteger(leaseTtlMs) ||
        leaseTtlMs < INTRADAY_MONITOR_MIN_LEASE_TTL_MS ||
        leaseTtlMs > INTRADAY_MONITOR_MAX_LEASE_TTL_MS
    ) {
        throw new TypeError('page lease coordinator options are invalid');
    }

    const leases = new Map();
    const clientIndex = new Map();
    let timer;
    let lastNow = -1;
    let clockInvalid = false;
    let sessionState = 'idle';
    let demandActive = false;
    let acceptingEvents = false;
    let flushRevision = null;
    let lastFailure = null;
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

    function cancelTimer() {
        if (timer === undefined) return;
        try {
            Reflect.apply(cancelWakeup, undefined, [timer]);
        } catch {
            clockInvalid = true;
        }
        timer = undefined;
    }

    function scheduleExpiry() {
        cancelTimer();
        if (closed || leases.size === 0 || clockInvalid) return;
        const now = currentNow();
        if (now === undefined) return;
        const nextExpiry = Math.min(
            ...[...leases.values()].map((record) => record.expiresAtEpochMs),
        );
        try {
            timer = Reflect.apply(scheduleWakeup, undefined, [
                () => {
                    timer = undefined;
                    sweepExpired();
                },
                Math.max(0, nextExpiry - now),
            ]);
            timer?.unref?.();
        } catch {
            clockInvalid = true;
        }
    }

    function startSession() {
        if (demandActive) {
            if (sessionState === 'active') acceptingEvents = true;
            return demandActive;
        }
        const result = invoke(capability, 'startIntradayDemands');
        if (!result?.allowed) {
            sessionState = 'start_failed';
            acceptingEvents = false;
            lastFailure = result?.reason ?? 'start_result_invalid';
            return false;
        }
        demandActive = true;
        acceptingEvents = true;
        sessionState = 'active';
        lastFailure = null;
        return true;
    }

    function stopSession() {
        acceptingEvents = false;
        if (!demandActive) {
            sessionState = 'idle';
            lastFailure = null;
            return true;
        }
        if (sessionState !== 'release_unknown') {
            sessionState = 'flushing';
            const flushed = invoke(capability, 'flushMinuteEvidence');
            if (!flushed?.allowed) {
                sessionState = 'flush_failed';
                lastFailure = flushed?.reason ?? 'flush_result_invalid';
                return false;
            }
            flushRevision = Number.isSafeInteger(flushed.persistedRevision)
                ? flushed.persistedRevision
                : flushRevision;
        }
        sessionState = 'releasing';
        const released = invoke(capability, 'releaseIntradayDemands');
        if (!released?.allowed) {
            sessionState = 'release_unknown';
            lastFailure = released?.reason ?? 'release_result_invalid';
            return false;
        }
        demandActive = false;
        sessionState = 'idle';
        lastFailure = null;
        return true;
    }

    function newLease(clientId, generation, acquiredAtEpochMs) {
        const leaseId = randomBytes(24).toString('base64url');
        const expiresAtEpochMs = acquiredAtEpochMs + leaseTtlMs;
        const lease = deepFreeze({
            schemaVersion: INTRADAY_MONITOR_PAGE_LEASE_SCHEMA,
            leaseId,
            clientId,
            generation,
            acquiredAt: new Date(acquiredAtEpochMs).toISOString(),
            expiresAt: new Date(expiresAtEpochMs).toISOString(),
        });
        const record = {
            lease,
            leaseId,
            clientId,
            generation,
            acquiredAtEpochMs,
            expiresAtEpochMs,
            terminal: false,
        };
        issuedLeases.set(lease, record);
        leases.set(leaseId, record);
        clientIndex.set(clientId, record);
        return lease;
    }

    function acquire(value) {
        if (closed) return deny('lease_coordinator_closed');
        let input;
        try {
            input = exactSnapshot(value, ACQUIRE_KEYS, 'lease acquire');
            input = Object.freeze({
                clientId: boundedOpaque(input.clientId, 'clientId'),
                generation: boundedOpaque(input.generation, 'generation'),
            });
        } catch {
            return deny('lease_acquire_schema_invalid');
        }
        if (clientIndex.has(input.clientId)) {
            return deny('client_lease_already_exists');
        }
        const now = currentNow();
        if (now === undefined) return deny('lease_clock_invalid');
        if (leases.size === 0 && demandActive && sessionState !== 'active') {
            return deny('previous_session_stop_unresolved');
        }
        const lease = newLease(input.clientId, input.generation, now);
        if (leases.size === 1) startSession();
        scheduleExpiry();
        return lease;
    }

    function validRecord(lease) {
        if (!lease || typeof lease !== 'object' || isProxy(lease)) return undefined;
        const record = issuedLeases.get(lease);
        if (
            !record ||
            record.lease !== lease ||
            record.terminal ||
            leases.get(record.leaseId) !== record
        ) {
            return undefined;
        }
        return record;
    }

    function terminalize(record) {
        record.terminal = true;
        leases.delete(record.leaseId);
        if (clientIndex.get(record.clientId) === record) {
            clientIndex.delete(record.clientId);
        }
    }

    function renew(lease) {
        if (closed) return deny('lease_coordinator_closed');
        const record = validRecord(lease);
        if (!record) return deny('lease_handle_invalid');
        const now = currentNow();
        if (now === undefined) return deny('lease_clock_invalid');
        if (now >= record.expiresAtEpochMs) {
            terminalize(record);
            if (leases.size === 0) stopSession();
            scheduleExpiry();
            return deny('lease_expired');
        }
        terminalize(record);
        const renewed = newLease(record.clientId, record.generation, now);
        scheduleExpiry();
        return renewed;
    }

    function release(lease) {
        if (closed) return deny('lease_coordinator_closed');
        const record = validRecord(lease);
        if (!record) return deny('lease_handle_invalid');
        terminalize(record);
        const stopped = leases.size === 0 ? stopSession() : true;
        scheduleExpiry();
        return deepFreeze({
            allowed: true,
            action: 'lease_released',
            lastLease: leases.size === 0,
            stopCompleted: stopped,
            activeLeaseCount: leases.size,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function sweepExpired() {
        if (closed) return deny('lease_coordinator_closed');
        const now = currentNow();
        if (now === undefined) return deny('lease_clock_invalid');
        let expired = 0;
        for (const record of [...leases.values()]) {
            if (now >= record.expiresAtEpochMs) {
                terminalize(record);
                expired += 1;
            }
        }
        const stopped = leases.size === 0 && expired > 0 ? stopSession() : true;
        scheduleExpiry();
        return deepFreeze({
            allowed: true,
            action: 'expired_leases_swept',
            expiredLeaseCount: expired,
            activeLeaseCount: leases.size,
            stopCompleted: stopped,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function retryStop(value = {}) {
        if (closed) return deny('lease_coordinator_closed');
        try {
            exactSnapshot(value, RETRY_KEYS, 'lease stop retry');
        } catch {
            return deny('lease_stop_retry_schema_invalid');
        }
        if (leases.size !== 0) return deny('active_lease_exists');
        if (!['flush_failed', 'release_unknown'].includes(sessionState)) {
            return deny('lease_stop_retry_not_required');
        }
        return deepFreeze({
            allowed: stopSession(),
            action: 'lease_stop_retried',
            sessionState,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function status() {
        return deepFreeze({
            schemaVersion: INTRADAY_MONITOR_PAGE_LEASE_COORDINATOR_SCHEMA,
            leaseTtlMs,
            activeLeaseCount: leases.size,
            activeClientCount: clientIndex.size,
            sessionState,
            demandActive,
            acceptingEvents:
                acceptingEvents && leases.size > 0 && sessionState === 'active',
            flushRevision,
            lastFailure,
            correctnessDependsOnBeforeUnload: false,
            boundedHeartbeatRequired: true,
            clockInvalid,
            closed,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    }

    function close() {
        if (closed) return status();
        cancelTimer();
        for (const record of [...leases.values()]) terminalize(record);
        stopSession();
        closed = true;
        return status();
    }

    return Object.freeze({
        acquire,
        renew,
        release,
        sweepExpired,
        retryStop,
        status,
        close,
    });
}
