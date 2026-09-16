import { describe, expect, it } from 'vitest';
import {
    INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT,
    INTRADAY_MONITOR_OWNERSHIP_INVENTORY_SCHEMA,
    createIntradayMonitorOwnershipInventoryAdapter,
    intradayMonitorPhysicalKey,
} from './ownership-inventory-adapter.mjs';
import {
    createIntradayMonitorSubscriptionCoordinator,
} from './subscription-coordinator.mjs';
import {
    INTRADAY_MONITOR_PROVIDER_SUBSCRIPTION_EVENT_SCHEMA,
    createIntradayMonitorTransportReceiptVerifier,
} from './transport-confirmation-receipt.mjs';
import {
    SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS,
    createSmartOrderQuoteSubscriptionCoordinator,
} from '../smart-order-runtime/quote-subscription-coordinator.mjs';

function contract(code = '2330', exchange = 'TSE') {
    return { code, exchange, securityType: 'STK' };
}

function owner({
    generation = 'generation-1',
    code = '2330',
    exchange = 'TSE',
    ownerId = `owner-${code}`,
    ownerKind = 'chart',
    quoteType = 'tick',
    refCount = 1,
    confirmation = 'confirmed',
    observedAtEpochMs = 9_999,
} = {}) {
    const canonicalContract = contract(code, exchange);
    return {
        ownerId,
        ownerKind,
        connectionGeneration: generation,
        physicalKey: intradayMonitorPhysicalKey(
            generation,
            canonicalContract,
            quoteType,
        ),
        contract: canonicalContract,
        quoteType,
        refCount,
        confirmation,
        observedAtEpochMs,
    };
}

function inventory({
    generation = 'generation-1',
    owners = [],
    generatedAtEpochMs = 10_000,
    validUntilEpochMs = 20_000,
    overrides = {},
} = {}) {
    return {
        schemaVersion: INTRADAY_MONITOR_OWNERSHIP_INVENTORY_SCHEMA,
        evidenceId: `evidence-${generation}`,
        generatedAtEpochMs,
        validUntilEpochMs,
        connectionGeneration: generation,
        countingDimension: 'shioaji-subscription-item/v1',
        ownershipComplete: true,
        externalUsageVisible: true,
        officialPhysicalLimit: 200,
        localPhysicalLimit: 160,
        requiredHeadroom: 40,
        owners,
        pollingFallbackAllowed: false,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
        ...overrides,
    };
}

function demand({
    consumerId,
    ownerKind = 'intraday_monitor',
    userOrder = 0,
    code = '2330',
    exchange = 'TSE',
    quoteType = 'tick',
}) {
    return {
        consumerId,
        ownerKind,
        userOrder,
        contract: contract(code, exchange),
        quoteType,
    };
}

function harness({ owners = [], now = 11_000, generation = 'generation-1' } = {}) {
    const clock = { value: now };
    const adapter = createIntradayMonitorOwnershipInventoryAdapter({
        nowEpochMs: () => clock.value,
        maximumAgeMs: 10_000,
    });
    const issued = adapter.issue(
        inventory({
            generation,
            owners,
            generatedAtEpochMs: now - 1_000,
            validUntilEpochMs: now + 9_000,
        }),
    );
    expect(issued.issued).toBe(true);
    const coordinator = createIntradayMonitorSubscriptionCoordinator({
        ownershipInventory: issued,
        nowEpochMs: () => clock.value,
    });
    const receiptVerifier = createIntradayMonitorTransportReceiptVerifier({
        nowEpochMs: () => clock.value,
    });
    return { adapter, clock, coordinator, issued, receiptVerifier };
}

function confirmationEvent(plan, observedAtEpochMs = 11_000, overrides = {}) {
    return {
        schemaVersion: INTRADAY_MONITOR_PROVIDER_SUBSCRIPTION_EVENT_SCHEMA,
        planId: plan.planId,
        action: plan.action,
        connectionGeneration: plan.connectionGeneration,
        physicalKey: plan.physicalKey,
        providerEventCode: 16,
        providerTopic: `${plan.quoteType === 'tick' ? 'TIC' : 'QUO'}/v1/STK/*/${plan.contract.exchange}/${plan.contract.code}`,
        observedAtEpochMs,
        providerConfirmed: true,
        operationCorrelated: true,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
        ...overrides,
    };
}

function confirm(harnessValue, plan) {
    const receipt = harnessValue.receiptVerifier.issue(
        plan,
        confirmationEvent(plan, harnessValue.clock.value),
    );
    expect(receipt.issued).toBe(true);
    return harnessValue.coordinator.confirmPlan(plan, receipt);
}

function manyOwners(count, generation = 'generation-1') {
    return Array.from({ length: count }, (_, index) => {
        const numeric = 1000 + index;
        return owner({
            generation,
            code: String(numeric),
            ownerId: `chart-${numeric}`,
        });
    });
}

describe('intraday ownership inventory adapter', () => {
    it('projects current physical ownership with cross-owner deduplication and no authority', () => {
        const samePhysical = [
            owner({ ownerId: 'chart-1', ownerKind: 'chart', refCount: 2 }),
            owner({ ownerId: 'alert-1', ownerKind: 'alert', refCount: 1 }),
        ];
        const adapter = createIntradayMonitorOwnershipInventoryAdapter({
            nowEpochMs: () => 10_000,
            maximumAgeMs: 10_000,
        });
        const issued = adapter.issue(inventory({ owners: samePhysical }));

        expect(issued).toMatchObject({
            issued: true,
            confirmedPhysicalUsage: 1,
            retainedPhysicalUsage: 1,
            availableForMonitor: 159,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(adapter.status()).toMatchObject({
            readOnly: true,
            pollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    });

    it.each([
        ['incomplete ownership', { ownershipComplete: false }],
        ['hidden external usage', { externalUsageVisible: false }],
        ['polling authority', { pollingFallbackAllowed: true }],
        ['transport authority', { subscriptionTransportAuthority: true }],
        ['broker authority', { brokerWriteAuthority: true }],
    ])('fails closed for %s', (_label, overrides) => {
        const adapter = createIntradayMonitorOwnershipInventoryAdapter({
            nowEpochMs: () => 10_000,
            maximumAgeMs: 10_000,
        });
        expect(adapter.issue(inventory({ overrides }))).toMatchObject({
            issued: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    });

    it('rejects stale owner evidence, mixed generations, and noncanonical physical keys', () => {
        const adapter = createIntradayMonitorOwnershipInventoryAdapter({
            nowEpochMs: () => 10_000,
            maximumAgeMs: 1_000,
        });
        const stale = owner({ observedAtEpochMs: 8_999 });
        const mixed = {
            ...owner(),
            connectionGeneration: 'generation-2',
        };
        const wrongKey = { ...owner(), physicalKey: 'sha256:not-canonical' };

        expect(adapter.issue(inventory({ owners: [stale] })).issued).toBe(false);
        expect(adapter.issue(inventory({ owners: [mixed] })).issued).toBe(false);
        expect(adapter.issue(inventory({ owners: [wrongKey] })).issued).toBe(false);
    });

    it('makes unknown physical state consume capacity while disabling admission', () => {
        const adapter = createIntradayMonitorOwnershipInventoryAdapter({
            nowEpochMs: () => 10_000,
            maximumAgeMs: 10_000,
        });
        const issued = adapter.issue(
            inventory({ owners: [owner({ confirmation: 'unknown' })] }),
        );
        expect(issued).toMatchObject({
            issued: true,
            confirmedPhysicalUsage: 0,
            retainedPhysicalUsage: 1,
            availableForMonitor: 0,
        });
    });
});

describe('intraday subscription ownership and capacity coordinator', () => {
    it('requires a fresh correlated provider receipt instead of HTTP acceptance', () => {
        const context = harness();
        const plan = context.coordinator.acquireDemand(
            demand({ consumerId: 'monitor-2330' }),
        ).allowed
            ? context.coordinator.pendingPlans()[0]
            : null;

        expect(plan).toBeTruthy();
        expect(context.receiptVerifier.issue(plan, {
            httpStatus: 200,
            success: true,
        })).toMatchObject({
            issued: false,
            reasons: ['provider_confirmation_schema_invalid'],
        });
        expect(context.receiptVerifier.issue(
            plan,
            confirmationEvent(plan, context.clock.value, {
                providerTopic: 'TIC/v1/STK/*/TSE/9999',
            }),
        )).toMatchObject({
            issued: false,
            reasons: ['provider_confirmation_mismatch'],
        });
        const receipt = context.receiptVerifier.issue(
            plan,
            confirmationEvent(plan, context.clock.value),
        );
        expect(context.coordinator.confirmPlan(plan, { ...receipt })).toMatchObject({
            allowed: false,
            reason: 'subscription_confirmation_receipt_invalid',
        });
        expect(context.coordinator.confirmPlan(plan, receipt).allowed).toBe(true);
    });

    it('rejects stale provider confirmation before it reaches the coordinator', () => {
        const context = harness();
        context.coordinator.acquireDemand(demand({ consumerId: 'monitor-2330' }));
        const plan = context.coordinator.pendingPlans()[0];
        context.clock.value = 20_000;
        expect(context.receiptVerifier.issue(
            plan,
            confirmationEvent(plan, 11_000),
        )).toMatchObject({
            issued: false,
            reasons: ['provider_confirmation_stale'],
        });
        expect(context.coordinator.status().activeIntradayCount).toBe(0);
    });

    it('deduplicates chart, alert, safety, and monitor demand by generation, contract, and quote type', () => {
        const existing = owner({ ownerId: 'chart-existing', ownerKind: 'chart' });
        const { coordinator } = harness({ owners: [existing] });
        const monitor = coordinator.acquireDemand(
            demand({ consumerId: 'monitor-2330' }),
        );
        coordinator.acquireDemand(
            demand({
                consumerId: 'safety-2330',
                ownerKind: 'smart_order_safety',
            }),
        );

        expect(monitor.allowed).toBe(true);
        expect(coordinator.pendingPlans()).toEqual([]);
        expect(coordinator.status()).toMatchObject({
            trackedPhysicalCount: 1,
            confirmedPhysicalUsage: 1,
            activeIntradayCount: 1,
            confirmedOtherPhysicalUsage: 1,
        });
        expect(coordinator.status().subscriptions[0]).toMatchObject({
            inventoryRefCount: 1,
            demandRefCount: 2,
            totalRefCount: 3,
        });
    });

    it('uses opaque demand and plan handles and rejects structural clones', () => {
        const context = harness();
        const { coordinator } = context;
        const handle = coordinator.acquireDemand(
            demand({ consumerId: 'monitor-2330' }),
        );
        const plan = coordinator.pendingPlans()[0];

        expect(coordinator.releaseDemand({ ...handle })).toMatchObject({
            allowed: false,
            reason: 'subscription_demand_handle_invalid',
        });
        expect(coordinator.confirmPlan({ ...plan })).toMatchObject({
            allowed: false,
            reason: 'subscription_plan_not_current',
        });
        expect(coordinator.confirmPlan(plan)).toMatchObject({
            allowed: false,
            reason: 'subscription_confirmation_receipt_invalid',
        });
        expect(confirm(context, plan).allowed).toBe(true);
        expect(coordinator.releaseDemand(handle).allowed).toBe(true);
    });

    it('admits at most 160 physical subscriptions and orders monitor waiting by user order then symbol', () => {
        const context = harness({ owners: manyOwners(159) });
        const { coordinator } = context;
        coordinator.acquireDemand(
            demand({ consumerId: 'later', code: '9999', userOrder: 10 }),
        );
        coordinator.acquireDemand(
            demand({ consumerId: 'earlier-b', code: '8888', userOrder: 1 }),
        );
        coordinator.acquireDemand(
            demand({ consumerId: 'earlier-a', code: '7777', userOrder: 1 }),
        );

        const plans = coordinator.pendingPlans();
        expect(plans).toHaveLength(1);
        expect(plans[0].contract.code).toBe('7777');
        expect(coordinator.status()).toMatchObject({
            confirmedPhysicalUsage: 159,
            retainedPhysicalUsage: 159,
            availableForMonitor: 1,
            pendingPlanCount: 1,
            activeIntradayCount: 0,
            waitingIntradayCount: 3,
            localPhysicalLimit: 160,
            requiredHeadroom: 40,
        });
    });

    it('preempts a locally confirmed monitor subscription for chart demand without rotating monitors', () => {
        const context = harness({ owners: manyOwners(159) });
        const { coordinator } = context;
        coordinator.acquireDemand(
            demand({ consumerId: 'monitor', code: '9000', userOrder: 0 }),
        );
        const monitorSubscribe = coordinator.pendingPlans()[0];
        expect(confirm(context, monitorSubscribe).allowed).toBe(true);
        expect(coordinator.status().retainedPhysicalUsage).toBe(160);

        coordinator.acquireDemand(
            demand({
                consumerId: 'chart',
                ownerKind: 'chart',
                code: '9001',
            }),
        );
        const preemption = coordinator.pendingPlans()[0];
        expect(preemption).toMatchObject({
            action: 'unsubscribe',
            reason: 'higher_priority_demand',
            contract: expect.objectContaining({ code: '9000' }),
        });
        expect(confirm(context, preemption).allowed).toBe(true);
        expect(coordinator.pendingPlans()[0]).toMatchObject({
            action: 'subscribe',
            contract: expect.objectContaining({ code: '9001' }),
        });
        expect(coordinator.status().waitingIntradayCount).toBe(1);
    });

    it('retains capacity for unknown subscribe and unsubscribe until a new generation', () => {
        const context = harness({ owners: manyOwners(159) });
        const { coordinator } = context;
        const first = coordinator.acquireDemand(
            demand({ consumerId: 'first', code: '9000' }),
        );
        const subscribe = coordinator.pendingPlans()[0];
        expect(coordinator.reportPlanUnknown(subscribe)).toMatchObject({
            physicalState: 'subscribe_unknown',
            capacityReleased: false,
        });
        expect(coordinator.releaseDemand(first).allowed).toBe(true);
        coordinator.acquireDemand(
            demand({ consumerId: 'second', code: '9001', userOrder: 1 }),
        );
        expect(coordinator.pendingPlans()).toHaveLength(0);
        expect(coordinator.status().retainedPhysicalUsage).toBe(160);
    });

    it('reuses capacity only after unsubscribe confirmation', () => {
        const context = harness({ owners: manyOwners(159) });
        const { coordinator } = context;
        const first = coordinator.acquireDemand(
            demand({ consumerId: 'first', code: '9000' }),
        );
        expect(confirm(context, coordinator.pendingPlans()[0]).allowed).toBe(
            true,
        );
        expect(coordinator.releaseDemand(first).allowed).toBe(true);
        coordinator.acquireDemand(
            demand({ consumerId: 'waiting', code: '9001' }),
        );
        const unsubscribe = coordinator.pendingPlans().find(
            (plan) => plan.action === 'unsubscribe',
        );
        expect(unsubscribe).toBeTruthy();
        expect(
            coordinator.pendingPlans().some((plan) => plan.action === 'subscribe'),
        ).toBe(false);

        expect(confirm(context, unsubscribe).allowed).toBe(true);
        expect(coordinator.pendingPlans()).toEqual([
            expect.objectContaining({
                action: 'subscribe',
                contract: expect.objectContaining({ code: '9001' }),
            }),
        ]);
    });

    it('fails closed for expired evidence and exposes no polling fallback', () => {
        const { clock, coordinator } = harness();
        clock.value = 20_000;
        coordinator.acquireDemand(
            demand({ consumerId: 'monitor-2330' }),
        );

        expect(coordinator.pendingPlans()).toEqual([]);
        expect(coordinator.status()).toMatchObject({
            gate0EvidenceCurrent: false,
            availableForMonitor: 0,
            activeIntradayCount: 0,
            snapshotPollingFallbackAllowed: false,
            ticksPollingFallbackAllowed: false,
            kbarsPollingFallbackAllowed: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    });

    it('invalidates stale plans on disconnect and only reclaims unknown state with a new verified generation', () => {
        const { adapter, coordinator } = harness();
        coordinator.acquireDemand(
            demand({ consumerId: 'monitor-2330' }),
        );
        const stalePlan = coordinator.pendingPlans()[0];
        expect(
            coordinator.markDisconnected({
                connectionGeneration: 'generation-1',
            }).allowed,
        ).toBe(true);
        expect(coordinator.confirmPlan(stalePlan)).toMatchObject({
            allowed: false,
            reason: 'subscription_plan_not_current',
        });
        expect(coordinator.status().retainedPhysicalUsage).toBe(1);

        const next = adapter.issue(
            inventory({
                generation: 'generation-2',
                generatedAtEpochMs: 10_500,
                validUntilEpochMs: 19_500,
            }),
        );
        expect(next.issued).toBe(true);
        expect(
            coordinator.replaceOwnershipInventory({ ownershipInventory: next }),
        ).toMatchObject({
            allowed: true,
            connectionGeneration: 'generation-2',
        });
        expect(coordinator.status().retainedPhysicalUsage).toBe(0);
        expect(coordinator.pendingPlans()).toHaveLength(1);
    });

    it('rejects cloned inventory authority and incomplete external usage', () => {
        const adapter = createIntradayMonitorOwnershipInventoryAdapter({
            nowEpochMs: () => 10_000,
        });
        const issued = adapter.issue(inventory());
        expect(
            () =>
                createIntradayMonitorSubscriptionCoordinator({
                    ownershipInventory: { ...issued },
                    nowEpochMs: () => 10_000,
                }),
        ).toThrow(/verifier-issued/);
        expect(
            adapter.issue(
                inventory({ overrides: { externalUsageVisible: false } }),
            ).issued,
        ).toBe(false);
    });

    it('preserves the existing smart-order fail-closed and 160-unit safety contract', () => {
        const adapter = createIntradayMonitorOwnershipInventoryAdapter({
            nowEpochMs: () => 10_000,
        });
        const readOnlyInventory = adapter.issue(inventory());
        expect(() =>
            createSmartOrderQuoteSubscriptionCoordinator({
                apiGeneration: 'generation-1',
                connectionId: 'connection-1',
                nowMonotonicMs: () => 1,
                resourceCoordinator: readOnlyInventory,
                resourceCountingDimension: 'shioaji-subscription-item/v1',
            }),
        ).toThrow(/resourceCoordinator/);

        const smartOrder = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
            nowMonotonicMs: () => 1,
            resourceCoordinator: null,
            resourceCountingDimension: null,
        });
        const safetyDemand = smartOrder.runtime.acquireDemand({
            consumerId: 'protective-exit-2330',
            contract: contract(),
            quoteType: 'tick',
        });

        expect(SMART_ORDER_QUOTE_MAX_TRACKED_SUBSCRIPTIONS).toBe(
            INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT,
        );
        expect(safetyDemand).toMatchObject({
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(smartOrder.observer.pendingPlans()).toEqual([]);
        expect(smartOrder.observer.status()).toMatchObject({
            trackedSubscriptionCount: 1,
            runtimeDemandCount: 1,
            resourceCoordinatorConfigured: false,
            runtimeReadinessContribution: false,
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
    });
});
