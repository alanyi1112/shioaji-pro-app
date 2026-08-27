import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
    SMART_ORDER_QUOTE_FRESHNESS_TTL_MS,
    SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS,
    SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
    createSmartOrderQuoteSubscriptionCoordinator,
    isTrustedSmartOrderProtectiveQuoteObservation,
} from './quote-subscription-coordinator.mjs';
import { normalizeSmartOrderQuickFieldEvent } from './quick-field-normalizer.mjs';

const DIMENSION = 'verified-subscription-item/v1';

function contract(code = '2330', exchange = 'TSE') {
    return { code, exchange, securityType: 'STK' };
}

function lookup(code = '2330', quoteType = 'tick', exchange = 'TSE') {
    return { contract: contract(code, exchange), quoteType };
}

function demand(
    consumerId,
    code = '2330',
    quoteType = 'tick',
    exchange = 'TSE',
) {
    return {
        consumerId,
        contract: contract(code, exchange),
        quoteType,
    };
}

function createClock(initial = 1_000) {
    let value = initial;
    return Object.freeze({
        now() {
            return value;
        },
        advance(deltaMs) {
            value += deltaMs;
            return value;
        },
        set(next) {
            value = next;
        },
    });
}

function createResourceCoordinator({ capacity = 200 } = {}) {
    const reservations = new Map();
    let evidenceCurrent = true;
    let closed = false;
    let releaseCount = 0;
    const coordinator = Object.freeze({
        reserveSubscriptionDemand(input) {
            if (!evidenceCurrent || closed) {
                return Object.freeze({
                    allowed: false,
                    reason: 'resource_unavailable',
                });
            }
            if (reservations.has(input.demandId)) {
                return Object.freeze({
                    allowed: false,
                    reason: 'subscription_demand_duplicate',
                });
            }
            if (reservations.size >= capacity) {
                return Object.freeze({
                    allowed: false,
                    reason: 'local_subscription_budget_exhausted',
                });
            }
            let released = false;
            const lease = Object.freeze({
                allowed: true,
                demandId: input.demandId,
                countingDimension: input.countingDimension,
                units: input.units,
                projectedUsageUnits: reservations.size + 1,
                brokerAuthority: false,
                release() {
                    if (released) return;
                    released = true;
                    releaseCount += 1;
                    reservations.delete(input.demandId);
                },
            });
            reservations.set(input.demandId, lease);
            return lease;
        },
        status() {
            return Object.freeze({
                subscriptionEvidenceCurrent: evidenceCurrent,
                subscriptionCountingDimension: DIMENSION,
                closed,
                brokerAuthority: false,
                writeMasterAuthority: false,
            });
        },
    });
    return Object.freeze({
        coordinator,
        reservationCount() {
            return reservations.size;
        },
        releaseCount() {
            return releaseCount;
        },
        setEvidenceCurrent(next) {
            evidenceCurrent = next;
        },
        close() {
            closed = true;
        },
    });
}

function harness(overrides = {}) {
    const clock = overrides.clock ?? createClock();
    const resources =
        overrides.resources === undefined
            ? createResourceCoordinator()
            : overrides.resources;
    const coordinator = createSmartOrderQuoteSubscriptionCoordinator({
        apiGeneration: overrides.apiGeneration ?? 'generation-1',
        connectionId: overrides.connectionId ?? 'connection-1',
        nowMonotonicMs: () => clock.now(),
        resourceCoordinator: resources?.coordinator ?? null,
        resourceCountingDimension: resources ? DIMENSION : null,
    });
    return { clock, coordinator, resources };
}

function firstPlan(coordinator, action = 'subscribe') {
    const plans = coordinator.observer.pendingPlans();
    const plan = plans.find((entry) => entry.action === action);
    assert.ok(plan, `expected a pending ${action} plan`);
    return plan;
}

function confirmPlan(coordinator, plan = firstPlan(coordinator)) {
    return coordinator.runtime.confirmPlan(plan, {
        action: plan.action,
        apiGeneration: plan.apiGeneration,
        connectionId: plan.connectionId,
        planId: plan.planId,
    });
}

function confirmAndObserve(
    coordinator,
    { observationId = 'observation-1', streamSequence = 1 } = {},
) {
    const confirmation = confirmPlan(coordinator);
    assert.equal(confirmation.allowed, true);
    const observed = coordinator.runtime.recordObservation(
        confirmation.streamAuthority,
        { observationId, streamSequence },
    );
    assert.equal(observed.allowed, true);
    return confirmation.streamAuthority;
}

function mappedTick({
    sequence = 1,
    receiveDelayMs = 10,
    streamEpoch = 'connection-1',
    time = '09:01:02.123456',
    totalVolume = 10,
} = {}) {
    const exchangeTimeMs = Date.parse(`2026-08-13T${time.slice(0, 8)}+08:00`) +
        Number(time.slice(9, 12).padEnd(3, '0'));
    return normalizeSmartOrderQuickFieldEvent({
        contractKey: 'TSE:STK:2330',
        event: {
            eventKind: 'tick',
            code: '2330',
            date: '2026-08-13',
            time,
            close: '1200',
            volume: 1,
            totalVolume,
            priceChange: '1',
            percentChange: 8,
            simtrade: false,
            intradayOdd: false,
        },
        receiveTimeMs: exchangeTimeMs + receiveDelayMs,
        sequence,
        streamEpoch,
    });
}

describe('smart-order quote subscription coordinator', () => {
    it('exports a fixed offline policy and never exposes adapter or broker authority', () => {
        const { coordinator } = harness();

        assert.equal(
            SMART_ORDER_QUOTE_SUBSCRIPTION_COORDINATOR_SCHEMA_VERSION,
            'smart-order-quote-subscription-coordinator/2026-08-12.1',
        );
        assert.equal(SMART_ORDER_QUOTE_FRESHNESS_TTL_MS, 3_000);
        const status = coordinator.observer.status();
        assert.equal(status.sharedExistingLoginRequired, true);
        assert.equal(status.createsNewLogin, false);
        assert.equal(status.productionAdapterConfigured, false);
        assert.equal(status.automaticResubscribeDispatchAllowed, false);
        assert.equal(status.snapshotPollingFallbackAllowed, false);
        assert.equal(status.ticksPollingFallbackAllowed, false);
        assert.equal(status.kbarsPollingFallbackAllowed, false);
        assert.equal(status.subscriptionTransportAuthority, false);
        assert.equal(status.conditionEligibilityAuthority, false);
        assert.equal(status.brokerWriteAuthority, false);
        assert.equal(status.runtimeReadinessContribution, false);
        assert.equal(Object.isFrozen(status), true);
    });

    it('fails closed without verified resource admission and produces no transport plan', () => {
        const { coordinator } = harness({ resources: null });
        const lease = coordinator.runtime.acquireDemand(demand('runtime-a'));

        assert.equal(lease.handleClass, 'runtime_quote_demand');
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.tracked, true);
        assert.equal(status.resourceAdmitted, false);
        assert.equal(
            status.blocker,
            'subscription_resource_admission_unavailable',
        );
        assert.equal(status.current, false);
        assert.equal(status.runtimeReadinessContribution, false);
    });

    it('deduplicates equal contract and quote type while retaining Runtime refcounts', () => {
        const { coordinator, resources } = harness();
        const first = coordinator.runtime.acquireDemand(demand('runtime-a'));
        const second = coordinator.runtime.acquireDemand(demand('runtime-b'));

        assert.equal(first.handleClass, 'runtime_quote_demand');
        assert.equal(second.handleClass, 'runtime_quote_demand');
        assert.notEqual(first, second);
        assert.equal(resources.reservationCount(), 1);
        assert.equal(coordinator.observer.pendingPlans().length, 1);
        const plan = firstPlan(coordinator);
        assert.equal(plan.runtimeRefCount, 2);
        assert.equal(plan.browserRefCount, 0);
        assert.equal(plan.resourceDemand.units, 1);
        assert.equal(plan.resourceDemand.transport, 'subscription');
        assert.equal(plan.sharedExistingLoginRequired, true);
        assert.equal(plan.createsNewLogin, false);
        assert.equal(plan.subscriptionTransportAuthority, false);
    });

    it('keeps Tick and BidAsk as separate physical subscription keys', () => {
        const { coordinator, resources } = harness();
        coordinator.runtime.acquireDemand(demand('tick-a', '2330', 'tick'));
        coordinator.runtime.acquireDemand(
            demand('bidask-a', '2330', 'bidask'),
        );

        assert.equal(resources.reservationCount(), 2);
        assert.equal(coordinator.observer.pendingPlans().length, 2);
        assert.equal(coordinator.observer.status().trackedSubscriptionCount, 2);
    });

    it('returns deterministic plans sorted by canonical subscription key', () => {
        const firstRun = harness();
        firstRun.coordinator.runtime.acquireDemand(
            demand('z', '6488', 'tick', 'OTC'),
        );
        firstRun.coordinator.runtime.acquireDemand(
            demand('a', '2330', 'bidask'),
        );
        firstRun.coordinator.runtime.acquireDemand(
            demand('b', '2330', 'tick'),
        );
        const firstPlans = firstRun.coordinator.observer.pendingPlans();

        const secondRun = harness();
        secondRun.coordinator.runtime.acquireDemand(
            demand('b', '2330', 'tick'),
        );
        secondRun.coordinator.runtime.acquireDemand(
            demand('a', '2330', 'bidask'),
        );
        secondRun.coordinator.runtime.acquireDemand(
            demand('z', '6488', 'tick', 'OTC'),
        );
        const secondPlans = secondRun.coordinator.observer.pendingPlans();

        assert.deepEqual(
            firstPlans.map((plan) => [plan.contract.code, plan.quoteType]),
            [
                ['6488', 'tick'],
                ['2330', 'bidask'],
                ['2330', 'tick'],
            ],
        );
        assert.deepEqual(
            firstPlans.map((plan) => plan.planId),
            secondPlans.map((plan) => plan.planId),
        );
    });

    it('does not accept a structural owner field that tries to forge Runtime demand', () => {
        const { coordinator } = harness();
        const forged = coordinator.browser.acquireDemand({
            ...demand('browser-a'),
            ownerKind: 'runtime',
        });

        assert.equal(forged.allowed, false);
        assert.equal(forged.reason, 'quote_demand_schema_invalid');
        assert.equal(coordinator.observer.status().runtimeDemandCount, 0);
        assert.equal(coordinator.observer.status().browserDemandCount, 0);
    });

    it('prevents browser release from accepting a Runtime handle or structural clone', () => {
        const { coordinator } = harness();
        const runtimeLease = coordinator.runtime.acquireDemand(
            demand('runtime-a'),
        );

        const wrongFacet = coordinator.browser.releaseDemand(runtimeLease);
        const forgedClone = coordinator.runtime.releaseDemand({
            ...runtimeLease,
        });
        assert.equal(wrongFacet.allowed, false);
        assert.equal(wrongFacet.reason, 'quote_demand_handle_invalid');
        assert.equal(forgedClone.allowed, false);
        assert.equal(forgedClone.reason, 'quote_demand_handle_invalid');
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup())
                .runtimeRefCount,
            1,
        );

        const released = coordinator.runtime.releaseDemand(runtimeLease);
        assert.equal(released.allowed, true);
    });

    it('keeps Runtime demand subscribed when the browser releases its own ref', () => {
        const { coordinator, resources } = harness();
        const runtimeLease = coordinator.runtime.acquireDemand(
            demand('runtime-a'),
        );
        const browserLease = coordinator.browser.acquireDemand(
            demand('browser-a'),
        );
        assert.equal(coordinator.observer.pendingPlans().length, 1);

        const released = coordinator.browser.releaseDemand(browserLease);
        assert.equal(released.allowed, true);
        assert.equal(released.unsubscribePlanned, false);
        assert.equal(released.runtimeRefCount, 1);
        assert.equal(resources.reservationCount(), 1);
        assert.equal(firstPlan(coordinator).runtimeRefCount, 1);
        assert.equal(firstPlan(coordinator).browserRefCount, 0);

        coordinator.runtime.releaseDemand(runtimeLease);
    });

    it('keeps browser demand subscribed when the Runtime releases its own ref', () => {
        const { coordinator } = harness();
        const runtimeLease = coordinator.runtime.acquireDemand(
            demand('runtime-a'),
        );
        coordinator.browser.acquireDemand(demand('browser-a'));

        const released = coordinator.runtime.releaseDemand(runtimeLease);
        assert.equal(released.allowed, true);
        assert.equal(released.unsubscribePlanned, false);
        assert.equal(released.browserRefCount, 1);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.runtimeRefCount, 0);
        assert.equal(status.browserRefCount, 1);
    });

    it('cancels an unconfirmed subscribe and releases capacity at final ref release', () => {
        const { coordinator, resources } = harness();
        const lease = coordinator.runtime.acquireDemand(demand('runtime-a'));
        assert.equal(resources.reservationCount(), 1);

        const released = coordinator.runtime.releaseDemand(lease);
        assert.equal(released.action, 'unconfirmed_subscribe_cancelled');
        assert.equal(released.unsubscribePlanned, false);
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        assert.equal(resources.reservationCount(), 0);
        assert.equal(resources.releaseCount(), 1);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).tracked,
            false,
        );
    });

    it('stays unready after subscribe confirmation until a current head exists', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const confirmation = confirmPlan(coordinator);

        assert.equal(confirmation.allowed, true);
        assert.equal(confirmation.subscriptionConfirmed, true);
        assert.equal(confirmation.runtimeReadinessContribution, false);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.subscriptionConfirmedCurrentLineage, true);
        assert.equal(status.headFresh, false);
        assert.equal(status.current, false);
        assert.equal(status.blocker, 'quote_freshness_head_missing');
        assert.equal(status.productionAdapterConfigured, false);
    });

    it('requires the exact server-issued plan object before accepting confirmation', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const plan = firstPlan(coordinator);
        const structuralConfirmation = {
            action: plan.action,
            apiGeneration: plan.apiGeneration,
            connectionId: plan.connectionId,
            planId: plan.planId,
        };

        const clonedPlan = coordinator.runtime.confirmPlan(
            { ...plan },
            structuralConfirmation,
        );
        assert.equal(clonedPlan.allowed, false);
        assert.equal(clonedPlan.reason, 'quote_plan_authority_invalid');
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup())
                .subscriptionConfirmedCurrentLineage,
            false,
        );

        const exactPlan = coordinator.runtime.confirmPlan(
            plan,
            structuralConfirmation,
        );
        assert.equal(exactPlan.allowed, true);
    });

    it('advances a current freshness head only through the confirmed stream capability', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator);

        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.current, true);
        assert.equal(status.headFresh, true);
        assert.equal(status.headObservationId, 'observation-1');
        assert.equal(status.headStreamSequence, 1);
        assert.equal(status.headAgeMs, 0);
        assert.equal(status.runtimeReadinessContribution, false);
        assert.equal(status.conditionEligibilityAuthority, false);

        const forged = coordinator.runtime.recordObservation(
            { ...streamAuthority },
            { observationId: 'observation-2', streamSequence: 2 },
        );
        assert.equal(forged.allowed, false);
        assert.equal(forged.reason, 'quote_stream_authority_invalid');
    });

    it('admits only the exact trusted current mapped last trade and retains its time after staleness', () => {
        const { clock, coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const confirmation = confirmPlan(coordinator);
        const mapped = mappedTick();
        const accepted = coordinator.runtime.recordMappedObservation(
            confirmation.streamAuthority,
            mapped,
        );
        assert.equal(accepted.allowed, true);
        assert.equal(accepted.protectiveTriggerEligible, true);
        assert.equal(
            isTrustedSmartOrderProtectiveQuoteObservation(accepted),
            true,
        );
        assert.equal(
            isTrustedSmartOrderProtectiveQuoteObservation({ ...accepted }),
            false,
        );
        assert.equal(accepted.value, '1200');
        assert.equal(accepted.conditionEligibilityAuthority, false);
        assert.equal(accepted.brokerWriteAuthority, false);
        assert.equal(
            coordinator.runtime.recordMappedObservation(
                confirmation.streamAuthority,
                { ...mapped },
            ).reason,
            'quote_mapping_evidence_invalid',
        );
        let status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.protectiveTriggerCurrent, true);
        assert.equal(status.protectiveTriggerState, 'fresh');
        assert.equal(status.lastEligibleExchangeTimeMs, mapped.exchangeTimeMs);

        clock.advance(SMART_ORDER_QUOTE_FRESHNESS_TTL_MS + 1);
        status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.protectiveTriggerCurrent, false);
        assert.equal(status.protectiveTriggerState, 'stale');
        assert.equal(status.lastEligibleExchangeTimeMs, mapped.exchangeTimeMs);
        const replay = coordinator.runtime.recordMappedObservation(
            confirmation.streamAuthority,
            mapped,
        );
        assert.equal(replay.allowed, true);
        assert.equal(replay.replay, true);
        assert.equal(replay.protectiveTriggerEligible, false);
        assert.equal(
            replay.protectiveTriggerReason,
            'duplicate_observation_ignored',
        );
        assert.equal(replay.lastEligibleExchangeTimeMs, mapped.exchangeTimeMs);
    });

    it('does not replace the last eligible time with a stale last trade or a wrong connection lineage', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const confirmation = confirmPlan(coordinator);
        const stale = mappedTick({ sequence: 2, receiveDelayMs: 3_001 });
        const deniedEligibility = coordinator.runtime.recordMappedObservation(
            confirmation.streamAuthority,
            stale,
        );
        assert.equal(deniedEligibility.allowed, true);
        assert.equal(deniedEligibility.protectiveTriggerEligible, false);
        assert.equal(
            deniedEligibility.protectiveTriggerReason,
            'last_trade_stale_or_invalid',
        );
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup())
                .lastEligibleExchangeTimeMs,
            null,
        );
        assert.equal(
            coordinator.runtime.recordMappedObservation(
                confirmation.streamAuthority,
                mappedTick({ sequence: 3, streamEpoch: 'connection-2' }),
            ).reason,
            'quote_mapping_lineage_mismatch',
        );
    });

    it('rejects a hostile mapped-result Proxy without executing its traps or throwing', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const confirmation = confirmPlan(coordinator);
        let reads = 0;
        const hostile = new Proxy(mappedTick(), {
            get() {
                reads += 1;
                throw new Error('get trap must not execute');
            },
            isExtensible() {
                throw new Error('isExtensible trap must not execute');
            },
        });
        assert.doesNotThrow(() => {
            assert.equal(
                coordinator.runtime.recordMappedObservation(
                    confirmation.streamAuthority,
                    hostile,
                ).reason,
                'quote_mapping_evidence_invalid',
            );
        });
        assert.equal(reads, 0);
    });

    it('rejects exchange-time and cumulative-volume regression before advancing the mapped head', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const confirmation = confirmPlan(coordinator);
        assert.equal(
            coordinator.runtime.recordMappedObservation(
                confirmation.streamAuthority,
                mappedTick({ sequence: 10, totalVolume: 100 }),
            ).allowed,
            true,
        );
        assert.equal(
            coordinator.runtime.recordMappedObservation(
                confirmation.streamAuthority,
                mappedTick({ sequence: 11, totalVolume: 99 }),
            ).reason,
            'quote_mapping_observation_out_of_order',
        );
        assert.equal(
            coordinator.runtime.recordMappedObservation(
                confirmation.streamAuthority,
                mappedTick({
                    sequence: 12,
                    time: '09:01:01.123456',
                    totalVolume: 101,
                }),
            ).reason,
            'quote_mapping_observation_out_of_order',
        );
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.headStreamSequence, 10);
    });

    it('uses the exact freshness boundary and becomes stale one millisecond later', () => {
        const { clock, coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        confirmAndObserve(coordinator);

        clock.advance(SMART_ORDER_QUOTE_FRESHNESS_TTL_MS);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).current,
            true,
        );
        clock.advance(1);
        const stale = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(stale.current, false);
        assert.equal(stale.blocker, 'quote_freshness_head_stale');
        assert.equal(stale.headAgeMs, SMART_ORDER_QUOTE_FRESHNESS_TTL_MS + 1);
    });

    it('does not let an exact observation replay refresh the freshness TTL', () => {
        const { clock, coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator);
        clock.advance(SMART_ORDER_QUOTE_FRESHNESS_TTL_MS + 1);

        const replay = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-1', streamSequence: 1 },
        );
        assert.equal(replay.allowed, true);
        assert.equal(replay.replay, true);
        assert.equal(replay.headCurrent, false);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).current,
            false,
        );
    });

    it('lets a strictly newer observation advance and refresh the head', () => {
        const { clock, coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator);
        clock.advance(SMART_ORDER_QUOTE_FRESHNESS_TTL_MS + 1);

        const advanced = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-2', streamSequence: 2 },
        );
        assert.equal(advanced.allowed, true);
        assert.equal(advanced.action, 'freshness_head_advanced');
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.current, true);
        assert.equal(status.headObservationId, 'observation-2');
    });

    it('rejects out-of-order stream sequence without refreshing or replacing the head', () => {
        const { clock, coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator, {
            observationId: 'observation-10',
            streamSequence: 10,
        });
        clock.advance(100);

        const rejected = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-9', streamSequence: 9 },
        );
        assert.equal(rejected.allowed, false);
        assert.equal(rejected.reason, 'quote_observation_out_of_order');
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.headObservationId, 'observation-10');
        assert.equal(status.headStreamSequence, 10);
        assert.equal(status.headAgeMs, 100);
    });

    it('latches fail-closed on equal sequence with a different observation identity', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator, {
            observationId: 'observation-a',
            streamSequence: 10,
        });

        const collision = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-b', streamSequence: 10 },
        );
        assert.equal(collision.allowed, false);
        assert.equal(collision.reason, 'quote_observation_sequence_collision');
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.current, false);
        assert.equal(status.subscriptionConfirmedCurrentLineage, false);
        assert.equal(status.physicalState, 'stream_sequence_collision');
    });

    it('rejects disappearance of sequence evidence after it became available', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator);

        const missing = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-2', streamSequence: null },
        );
        assert.equal(missing.allowed, false);
        assert.equal(missing.reason, 'quote_observation_sequence_missing');
    });

    it('supports receive-order-only heads but grants no condition eligibility authority', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const confirmation = confirmPlan(coordinator);

        const observed = coordinator.runtime.recordObservation(
            confirmation.streamAuthority,
            { observationId: 'observation-no-sequence', streamSequence: null },
        );
        assert.equal(observed.allowed, true);
        assert.equal(observed.orderingEvidence, 'trusted_receive_order_only');
        assert.equal(observed.conditionEligibilityAuthority, false);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup())
                .conditionEligibilityAuthority,
            false,
        );
    });

    it('invalidates confirmations and current heads on disconnect', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator);

        const disconnected = coordinator.runtime.markDisconnected({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
        });
        assert.equal(disconnected.allowed, true);
        assert.deepEqual(disconnected.resubscribePlans, []);
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.connectionActive, false);
        assert.equal(status.current, false);
        assert.equal(status.blocker, 'quote_connection_not_current');

        const staleStream = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-2', streamSequence: 2 },
        );
        assert.equal(staleStream.allowed, false);
        assert.equal(staleStream.reason, 'quote_stream_lineage_not_current');
    });

    it('reconnect emits only sorted deterministic resubscribe plans and remains unconfirmed', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('z', '6488', 'tick', 'OTC'));
        coordinator.runtime.acquireDemand(demand('a', '2330', 'tick'));
        for (const plan of coordinator.observer.pendingPlans()) {
            confirmPlan(coordinator, plan);
        }
        coordinator.runtime.markDisconnected({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
        });

        const reconnected = coordinator.runtime.replaceConnection({
            apiGeneration: 'generation-2',
            connectionId: 'connection-2',
        });
        assert.equal(reconnected.allowed, true);
        assert.deepEqual(
            reconnected.resubscribePlans.map((plan) => plan.contract.code),
            ['6488', '2330'],
        );
        assert.ok(
            reconnected.resubscribePlans.every(
                (plan) =>
                    plan.action === 'subscribe' &&
                    plan.apiGeneration === 'generation-2' &&
                    plan.connectionId === 'connection-2' &&
                    plan.subscriptionTransportAuthority === false,
            ),
        );
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).current,
            false,
        );
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).blocker,
            'quote_subscription_unconfirmed',
        );
    });

    it('rejects a stale confirmation from the previous connection lineage', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const stalePlan = firstPlan(coordinator);

        coordinator.runtime.replaceConnection({
            apiGeneration: 'generation-2',
            connectionId: 'connection-2',
        });
        const staleConfirmation = coordinator.runtime.confirmPlan(
            stalePlan,
            {
                action: stalePlan.action,
                apiGeneration: stalePlan.apiGeneration,
                connectionId: stalePlan.connectionId,
                planId: stalePlan.planId,
            },
        );
        assert.equal(staleConfirmation.allowed, false);
        assert.equal(
            staleConfirmation.reason,
            'quote_connection_lineage_mismatch',
        );
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).current,
            false,
        );
    });

    it('forces a fresh lineage even when a reconnect reuses visible IDs', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const oldStream = confirmAndObserve(coordinator);
        const before = coordinator.observer.status().connectionLineageRevision;

        const replacement = coordinator.runtime.replaceConnection({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
        });
        assert.equal(
            replacement.connectionLineageRevision,
            before + 1,
        );
        const stale = coordinator.runtime.recordObservation(oldStream, {
            observationId: 'observation-2',
            streamSequence: 2,
        });
        assert.equal(stale.allowed, false);
        assert.equal(stale.reason, 'quote_stream_lineage_not_current');
    });

    it('cancels pending unsubscribe when new browser demand arrives', () => {
        const { coordinator, resources } = harness();
        const runtimeLease = coordinator.runtime.acquireDemand(
            demand('runtime-a'),
        );
        confirmAndObserve(coordinator);

        const released = coordinator.runtime.releaseDemand(runtimeLease);
        assert.equal(released.unsubscribePlanned, true);
        assert.equal(firstPlan(coordinator, 'unsubscribe').action, 'unsubscribe');

        const browserLease = coordinator.browser.acquireDemand(
            demand('browser-a'),
        );
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        assert.equal(resources.reservationCount(), 1);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.physicalState, 'confirmed');
        assert.equal(status.browserRefCount, 1);
        coordinator.browser.releaseDemand(browserLease);
    });

    it('releases bounded resource capacity only after confirmed unsubscription', () => {
        const { coordinator, resources } = harness();
        const lease = coordinator.runtime.acquireDemand(demand('runtime-a'));
        confirmPlan(coordinator);
        coordinator.runtime.releaseDemand(lease);

        assert.equal(resources.reservationCount(), 1);
        const unsubscribe = firstPlan(coordinator, 'unsubscribe');
        const result = confirmPlan(coordinator, unsubscribe);
        assert.equal(result.allowed, true);
        assert.equal(result.action, 'unsubscription_confirmed');
        assert.equal(resources.reservationCount(), 0);
        assert.equal(resources.releaseCount(), 1);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).tracked,
            false,
        );
    });

    it('latches subscribe failure without automatic retry and needs explicit retry', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const plan = firstPlan(coordinator);

        const failed = coordinator.runtime.reportPlanFailure(plan, {
            action: plan.action,
            apiGeneration: plan.apiGeneration,
            connectionId: plan.connectionId,
            planId: plan.planId,
            reason: 'subscribe_failed',
        });
        assert.equal(failed.allowed, true);
        assert.equal(failed.retryScheduled, false);
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).physicalState,
            'subscribe_failed_closed',
        );

        coordinator.runtime.acquireDemand(demand('runtime-b'));
        assert.deepEqual(coordinator.observer.pendingPlans(), []);

        const retried = coordinator.runtime.retryPlan(lookup());
        assert.equal(retried.allowed, true);
        assert.equal(retried.automaticRetry, false);
        assert.notEqual(retried.plan.planId, plan.planId);
    });

    it('does not retry or release capacity when subscribe timeout may have taken effect', () => {
        const { coordinator, resources } = harness();
        const lease = coordinator.runtime.acquireDemand(demand('runtime-a'));
        const plan = firstPlan(coordinator);

        const failed = coordinator.runtime.reportPlanFailure(plan, {
            action: plan.action,
            apiGeneration: plan.apiGeneration,
            connectionId: plan.connectionId,
            planId: plan.planId,
            reason: 'transport_timeout',
        });
        assert.equal(failed.allowed, true);
        assert.equal(failed.physicalState, 'subscribe_result_unknown');
        assert.equal(failed.retryScheduled, false);
        assert.equal(coordinator.runtime.retryPlan(lookup()).allowed, false);

        const secondLease = coordinator.runtime.acquireDemand(
            demand('runtime-b'),
        );
        assert.deepEqual(coordinator.observer.pendingPlans(), []);

        const decremented = coordinator.runtime.releaseDemand(lease);
        assert.equal(decremented.action, 'refcount_decremented');
        assert.equal(resources.reservationCount(), 1);

        const released = coordinator.runtime.releaseDemand(secondLease);
        assert.equal(
            released.action,
            'unknown_subscription_retained_until_disconnect',
        );
        assert.equal(resources.reservationCount(), 1);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).tracked,
            true,
        );

        coordinator.runtime.markDisconnected({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
        });
        assert.equal(resources.reservationCount(), 0);
        assert.equal(coordinator.observer.pendingPlans().length, 0);
        const replacement = coordinator.runtime.replaceConnection({
            apiGeneration: 'generation-2',
            connectionId: 'connection-2',
        });
        assert.equal(replacement.resubscribePlans.length, 0);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).tracked,
            false,
        );
    });

    it('retains capacity after uncertain unsubscribe and retries only explicitly', () => {
        const { coordinator, resources } = harness();
        const lease = coordinator.runtime.acquireDemand(demand('runtime-a'));
        confirmPlan(coordinator);
        coordinator.runtime.releaseDemand(lease);
        const plan = firstPlan(coordinator, 'unsubscribe');

        const failed = coordinator.runtime.reportPlanFailure(plan, {
            action: plan.action,
            apiGeneration: plan.apiGeneration,
            connectionId: plan.connectionId,
            planId: plan.planId,
            reason: 'transport_timeout',
        });
        assert.equal(failed.physicalState, 'unsubscribe_failed_unknown');
        assert.equal(failed.retryScheduled, false);
        assert.equal(resources.reservationCount(), 1);
        assert.deepEqual(coordinator.observer.pendingPlans(), []);

        const retried = coordinator.runtime.retryPlan(lookup());
        assert.equal(retried.allowed, true);
        assert.equal(retried.plan.action, 'unsubscribe');
        assert.equal(resources.reservationCount(), 1);
    });

    it('fails current-head checks when resource evidence becomes stale', () => {
        const { coordinator, resources } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).current,
            true,
        );

        resources.setEvidenceCurrent(false);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.current, false);
        assert.equal(
            status.blocker,
            'subscription_resource_admission_not_current',
        );
        const observed = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-2', streamSequence: 2 },
        );
        assert.equal(observed.allowed, false);
        assert.equal(
            observed.reason,
            'subscription_resource_admission_not_current',
        );
    });

    it('requires an explicit resource-admission retry after evidence recovers', () => {
        const { coordinator, resources } = harness();
        resources.setEvidenceCurrent(false);
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        assert.equal(resources.reservationCount(), 0);

        resources.setEvidenceCurrent(true);
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        const retried = coordinator.runtime.retryResourceAdmission(lookup());
        assert.equal(retried.allowed, true);
        assert.equal(retried.action, 'resource_admission_current');
        assert.equal(resources.reservationCount(), 1);
        assert.equal(retried.pendingPlans.length, 1);
        assert.equal(retried.pendingPlans[0].action, 'subscribe');
        assert.equal(retried.subscriptionTransportAuthority, false);
    });

    it('latches a backward monotonic clock and never restores freshness', () => {
        const { clock, coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const streamAuthority = confirmAndObserve(coordinator);
        clock.advance(100);
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).current,
            true,
        );
        clock.set(500);

        const invalid = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(invalid.current, false);
        assert.equal(invalid.blocker, 'quote_monotonic_clock_invalid');
        clock.set(10_000);
        const stillInvalid = coordinator.runtime.recordObservation(
            streamAuthority,
            { observationId: 'observation-2', streamSequence: 2 },
        );
        assert.equal(stillInvalid.allowed, false);
        assert.equal(stillInvalid.reason, 'quote_monotonic_clock_invalid');
        assert.equal(coordinator.observer.status().clockInvalid, true);
    });

    it('rejects duplicate consumer demand per owner and subscription key', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));

        const duplicate = coordinator.runtime.acquireDemand(
            demand('runtime-a'),
        );
        assert.equal(duplicate.allowed, false);
        assert.equal(duplicate.reason, 'quote_consumer_demand_duplicate');
        assert.equal(coordinator.observer.status().totalDemandCount, 1);

        const differentQuoteType = coordinator.runtime.acquireDemand(
            demand('runtime-a', '2330', 'bidask'),
        );
        assert.equal(
            differentQuoteType.handleClass,
            'runtime_quote_demand',
        );
    });

    it('enforces the bounded unique-subscription registry before resource growth', () => {
        const { coordinator, resources } = harness();
        for (
            let index = 0;
            index < SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS;
            index += 1
        ) {
            const code = String(index + 1).padStart(4, '0');
            const acquired = coordinator.browser.acquireDemand(
                demand(`browser-${index}`, code),
            );
            assert.equal(acquired.handleClass, 'browser_quote_demand');
        }
        const denied = coordinator.browser.acquireDemand(
            demand('browser-overflow', '99999'),
        );
        assert.equal(denied.allowed, false);
        assert.equal(denied.reason, 'quote_subscription_capacity_exhausted');
        assert.equal(
            coordinator.observer.status().trackedSubscriptionCount,
            SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS,
        );
        assert.equal(
            resources.reservationCount(),
            SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS,
        );
    });

    it('rejects accessor and Proxy structural inputs without executing accessors', () => {
        const { coordinator } = harness();
        let accessorCalls = 0;
        const accessorDemand = {
            consumerId: 'browser-a',
            contract: contract(),
            quoteType: 'tick',
        };
        Object.defineProperty(accessorDemand, 'consumerId', {
            enumerable: true,
            get() {
                accessorCalls += 1;
                return 'forged-runtime';
            },
        });
        const accessorResult =
            coordinator.browser.acquireDemand(accessorDemand);
        assert.equal(accessorResult.allowed, false);
        assert.equal(accessorCalls, 0);

        const proxyResult = coordinator.runtime.acquireDemand(
            new Proxy(demand('runtime-a'), {}),
        );
        assert.equal(proxyResult.allowed, false);
        assert.equal(proxyResult.reason, 'quote_demand_schema_invalid');

        const lookupProxy = coordinator.observer.getSubscriptionStatus(
            new Proxy(lookup(), {}),
        );
        assert.equal(lookupProxy.allowed, false);
        assert.equal(lookupProxy.reason, 'quote_subscription_lookup_invalid');
    });

    it('rejects accessor, Proxy, and extra-key connection or confirmation inputs', () => {
        const { coordinator } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        const plan = firstPlan(coordinator);

        const proxyConnection = coordinator.runtime.replaceConnection(
            new Proxy(
                {
                    apiGeneration: 'generation-2',
                    connectionId: 'connection-2',
                },
                {},
            ),
        );
        assert.equal(proxyConnection.allowed, false);
        assert.equal(proxyConnection.reason, 'quote_connection_schema_invalid');

        let calls = 0;
        const accessorConfirmation = {
            action: plan.action,
            apiGeneration: plan.apiGeneration,
            connectionId: plan.connectionId,
            planId: plan.planId,
        };
        Object.defineProperty(accessorConfirmation, 'planId', {
            enumerable: true,
            get() {
                calls += 1;
                return plan.planId;
            },
        });
        const accessor = coordinator.runtime.confirmPlan(
            plan,
            accessorConfirmation,
        );
        assert.equal(accessor.allowed, false);
        assert.equal(calls, 0);

        const extra = coordinator.runtime.confirmPlan(plan, {
            action: plan.action,
            apiGeneration: plan.apiGeneration,
            connectionId: plan.connectionId,
            planId: plan.planId,
            trusted: true,
        });
        assert.equal(extra.allowed, false);
        assert.equal(extra.reason, 'quote_plan_confirmation_schema_invalid');
    });

    it('rejects Proxy and accessor coordinator construction inputs', () => {
        const clock = createClock();
        const resources = createResourceCoordinator();
        const base = {
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
            nowMonotonicMs: () => clock.now(),
            resourceCoordinator: resources.coordinator,
            resourceCountingDimension: DIMENSION,
        };

        assert.throws(
            () =>
                createSmartOrderQuoteSubscriptionCoordinator(
                    new Proxy(base, {}),
                ),
            /schema is invalid/,
        );

        let calls = 0;
        const accessor = { ...base };
        Object.defineProperty(accessor, 'apiGeneration', {
            enumerable: true,
            get() {
                calls += 1;
                return 'generation-1';
            },
        });
        assert.throws(
            () => createSmartOrderQuoteSubscriptionCoordinator(accessor),
            /own data properties/,
        );
        assert.equal(calls, 0);
    });

    it('rejects a resource coordinator accessor capability before use', () => {
        const clock = createClock();
        let calls = 0;
        const resourceCoordinator = {
            status() {
                return {};
            },
        };
        Object.defineProperty(
            resourceCoordinator,
            'reserveSubscriptionDemand',
            {
                enumerable: true,
                get() {
                    calls += 1;
                    return () => undefined;
                },
            },
        );

        assert.throws(
            () =>
                createSmartOrderQuoteSubscriptionCoordinator({
                    apiGeneration: 'generation-1',
                    connectionId: 'connection-1',
                    nowMonotonicMs: () => clock.now(),
                    resourceCoordinator,
                    resourceCountingDimension: DIMENSION,
                }),
            /own data (?:method|property)/,
        );
        assert.equal(calls, 0);
    });

    it('fails closed when resource admission returns a Proxy lease', () => {
        const clock = createClock();
        const resourceCoordinator = Object.freeze({
            reserveSubscriptionDemand(input) {
                return new Proxy(
                    {
                        allowed: true,
                        demandId: input.demandId,
                        countingDimension: input.countingDimension,
                        units: 1,
                        projectedUsageUnits: 1,
                        brokerAuthority: false,
                        release() {},
                    },
                    {},
                );
            },
            status() {
                return Object.freeze({
                    subscriptionEvidenceCurrent: true,
                    subscriptionCountingDimension: DIMENSION,
                    closed: false,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                });
            },
        });
        const coordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
            nowMonotonicMs: () => clock.now(),
            resourceCoordinator,
            resourceCountingDimension: DIMENSION,
        });

        coordinator.runtime.acquireDemand(demand('runtime-a'));
        assert.deepEqual(coordinator.observer.pendingPlans(), []);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.resourceAdmitted, false);
        assert.equal(
            status.blocker,
            'subscription_resource_admission_invalid',
        );
    });

    it('fails closed when resource status contains an accessor or reports authority', () => {
        const clock = createClock();
        let accessorCalls = 0;
        const resourceCoordinator = Object.freeze({
            reserveSubscriptionDemand() {
                return Object.freeze({ allowed: false, reason: 'unused' });
            },
            status() {
                const value = {
                    subscriptionEvidenceCurrent: true,
                    subscriptionCountingDimension: DIMENSION,
                    closed: false,
                    brokerAuthority: false,
                    writeMasterAuthority: false,
                };
                Object.defineProperty(value, 'brokerAuthority', {
                    enumerable: true,
                    get() {
                        accessorCalls += 1;
                        return true;
                    },
                });
                return value;
            },
        });
        const coordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
            nowMonotonicMs: () => clock.now(),
            resourceCoordinator,
            resourceCountingDimension: DIMENSION,
        });

        coordinator.runtime.acquireDemand(demand('runtime-a'));
        assert.equal(accessorCalls, 0);
        const status = coordinator.observer.getSubscriptionStatus(lookup());
        assert.equal(status.current, false);
        assert.equal(status.blocker, 'subscription_resource_status_invalid');
        assert.equal(accessorCalls, 0);
    });

    it('keeps a confirmed resource reservation on close when physical state is unknown', () => {
        const { coordinator, resources } = harness();
        coordinator.runtime.acquireDemand(demand('runtime-a'));
        confirmPlan(coordinator);
        assert.equal(resources.reservationCount(), 1);

        const closed = coordinator.runtime.close();
        assert.equal(closed.closed, true);
        assert.equal(closed.retainedResourceReservationsOnClose, 1);
        assert.equal(resources.reservationCount(), 1);
        assert.equal(closed.subscriptionTransportAuthority, false);
        assert.equal(closed.brokerWriteAuthority, false);
    });

    it('never lets a stale plan confirmation resurrect a released demand', () => {
        const { coordinator, resources } = harness();
        const lease = coordinator.runtime.acquireDemand(demand('runtime-a'));
        const stalePlan = firstPlan(coordinator);
        coordinator.runtime.releaseDemand(lease);
        assert.equal(resources.reservationCount(), 0);

        const stale = coordinator.runtime.confirmPlan(stalePlan, {
            action: stalePlan.action,
            apiGeneration: stalePlan.apiGeneration,
            connectionId: stalePlan.connectionId,
            planId: stalePlan.planId,
        });
        assert.equal(stale.allowed, false);
        assert.equal(stale.reason, 'quote_plan_not_current');
        assert.equal(
            coordinator.observer.getSubscriptionStatus(lookup()).tracked,
            false,
        );
    });
});
