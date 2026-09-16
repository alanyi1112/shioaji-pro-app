import { describe, expect, it } from 'vitest';
import {
    createIntradayMonitorPageLeaseCoordinator,
} from './page-lease-coordinator.mjs';

function successfulResult(overrides = {}) {
    return {
        allowed: true,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
        ...overrides,
    };
}

function controllerHarness() {
    const calls = [];
    const results = {
        start: successfulResult({ action: 'demands_started' }),
        flush: successfulResult({
            action: 'minute_evidence_flushed',
            persistedRevision: 17,
        }),
        release: successfulResult({ action: 'demands_released' }),
    };
    return {
        calls,
        results,
        controller: {
            startIntradayDemands() {
                calls.push('start');
                return results.start;
            },
            flushMinuteEvidence() {
                calls.push('flush');
                return results.flush;
            },
            releaseIntradayDemands() {
                calls.push('release');
                return results.release;
            },
        },
    };
}

function schedulerHarness() {
    let nextId = 0;
    const scheduled = new Map();
    return {
        schedule(callback, delayMs) {
            const id = ++nextId;
            scheduled.set(id, { callback, delayMs });
            return id;
        },
        cancel(id) {
            scheduled.delete(id);
        },
        runNext() {
            const [id, task] = scheduled.entries().next().value ?? [];
            if (!task) throw new Error('no scheduled expiry');
            scheduled.delete(id);
            task.callback();
        },
        size() {
            return scheduled.size;
        },
    };
}

function leaseInput(index = 1) {
    return {
        clientId: `client_identity_${String(index).padStart(3, '0')}`,
        generation: `page_generation_${String(index).padStart(3, '0')}`,
    };
}

function harness() {
    const clock = { value: 1_900_000_000_000 };
    const actions = controllerHarness();
    const scheduler = schedulerHarness();
    const coordinator = createIntradayMonitorPageLeaseCoordinator({
        sessionController: actions.controller,
        nowEpochMs: () => clock.value,
        leaseTtlMs: 5_000,
        scheduleWakeup: scheduler.schedule,
        cancelWakeup: scheduler.cancel,
    });
    return { actions, clock, coordinator, scheduler };
}

describe('intraday monitor page lease coordinator', () => {
    it('starts demand only for the first lease and flushes then releases after the last lease', () => {
        const { actions, coordinator } = harness();
        const first = coordinator.acquire(leaseInput(1));
        const second = coordinator.acquire(leaseInput(2));

        expect(actions.calls).toEqual(['start']);
        expect(coordinator.status()).toMatchObject({
            activeLeaseCount: 2,
            sessionState: 'active',
            demandActive: true,
            acceptingEvents: true,
            correctnessDependsOnBeforeUnload: false,
        });
        expect(coordinator.release(first)).toMatchObject({
            allowed: true,
            lastLease: false,
        });
        expect(actions.calls).toEqual(['start']);
        expect(coordinator.release(second)).toMatchObject({
            allowed: true,
            lastLease: true,
            stopCompleted: true,
        });
        expect(actions.calls).toEqual(['start', 'flush', 'release']);
        expect(coordinator.status()).toMatchObject({
            activeLeaseCount: 0,
            sessionState: 'idle',
            demandActive: false,
            acceptingEvents: false,
            flushRevision: 17,
        });
    });

    it('expires an abandoned page by TTL without any unload callback', () => {
        const { actions, clock, coordinator, scheduler } = harness();
        coordinator.acquire(leaseInput());
        expect(scheduler.size()).toBe(1);
        clock.value += 5_000;
        scheduler.runNext();

        expect(actions.calls).toEqual(['start', 'flush', 'release']);
        expect(coordinator.status()).toMatchObject({
            activeLeaseCount: 0,
            acceptingEvents: false,
            correctnessDependsOnBeforeUnload: false,
        });
    });

    it('renews with a new opaque handle, invalidates the old handle, and extends TTL', () => {
        const { clock, coordinator } = harness();
        const first = coordinator.acquire(leaseInput());
        clock.value += 2_000;
        const renewed = coordinator.renew(first);

        expect(renewed.leaseId).not.toBe(first.leaseId);
        expect(Date.parse(renewed.expiresAt) - Date.parse(renewed.acquiredAt)).toBe(
            5_000,
        );
        expect(coordinator.release(first)).toMatchObject({
            allowed: false,
            reason: 'lease_handle_invalid',
        });
        expect(coordinator.release(renewed).allowed).toBe(true);
    });

    it('rejects cloned handles and duplicate client leases', () => {
        const { coordinator } = harness();
        const lease = coordinator.acquire(leaseInput());
        expect(coordinator.acquire(leaseInput())).toMatchObject({
            allowed: false,
            reason: 'client_lease_already_exists',
        });
        expect(coordinator.renew({ ...lease })).toMatchObject({
            allowed: false,
            reason: 'lease_handle_invalid',
        });
    });

    it('stops new events when flush fails and retains demand until an explicit successful retry', () => {
        const { actions, coordinator } = harness();
        const lease = coordinator.acquire(leaseInput());
        actions.results.flush = {
            ...successfulResult(),
            allowed: false,
            reason: 'sqlite_busy',
        };
        expect(coordinator.release(lease)).toMatchObject({
            stopCompleted: false,
        });
        expect(actions.calls).toEqual(['start', 'flush']);
        expect(coordinator.status()).toMatchObject({
            activeLeaseCount: 0,
            sessionState: 'flush_failed',
            demandActive: true,
            acceptingEvents: false,
            lastFailure: 'sqlite_busy',
        });
        expect(coordinator.acquire(leaseInput(2))).toMatchObject({
            allowed: false,
            reason: 'previous_session_stop_unresolved',
        });

        actions.results.flush = successfulResult({
            action: 'minute_evidence_flushed',
            persistedRevision: 18,
        });
        expect(coordinator.retryStop({})).toMatchObject({
            allowed: true,
            sessionState: 'idle',
        });
        expect(actions.calls).toEqual(['start', 'flush', 'flush', 'release']);
    });

    it('retains demand and rejects a new session when release outcome is unknown', () => {
        const { actions, coordinator } = harness();
        const lease = coordinator.acquire(leaseInput());
        actions.results.release = {
            ...successfulResult(),
            allowed: false,
            reason: 'unsubscribe_unknown',
        };
        coordinator.release(lease);
        expect(coordinator.status()).toMatchObject({
            sessionState: 'release_unknown',
            demandActive: true,
            acceptingEvents: false,
        });
        expect(coordinator.acquire(leaseInput(2))).toMatchObject({
            allowed: false,
            reason: 'previous_session_stop_unresolved',
        });
        actions.results.release = successfulResult({ action: 'demands_released' });
        expect(coordinator.retryStop({})).toMatchObject({
            allowed: true,
            sessionState: 'idle',
        });
        expect(actions.calls).toEqual(['start', 'flush', 'release', 'release']);
    });

    it('fails closed if a session callback attempts to return transport or broker authority', () => {
        const clock = { value: 1_900_000_000_000 };
        const actions = controllerHarness();
        actions.results.start = {
            allowed: true,
            subscriptionTransportAuthority: true,
            brokerWriteAuthority: false,
        };
        const coordinator = createIntradayMonitorPageLeaseCoordinator({
            sessionController: actions.controller,
            nowEpochMs: () => clock.value,
            leaseTtlMs: 5_000,
        });
        coordinator.acquire(leaseInput());
        expect(coordinator.status()).toMatchObject({
            sessionState: 'start_failed',
            demandActive: false,
            acceptingEvents: false,
            lastFailure: 'start_result_invalid',
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        coordinator.close();
    });
});
