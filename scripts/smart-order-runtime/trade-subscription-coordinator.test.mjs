import { describe, expect, it, vi } from 'vitest';

const authority = vi.hoisted(() => ({ verifiers: new WeakSet() }));
vi.mock('./trade-subscription-verifier-authority.mjs', () => ({
    isVerifiedSmartOrderTradeSubscriptionTransportVerifier(value) {
        return authority.verifiers.has(value);
    },
}));
import { SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION } from './broker-event-normalizer.mjs';
import {
    createSmartOrderTradeSubscriptionCoordinator,
} from './trade-subscription-coordinator.mjs';

const DIGEST_INITIALIZE = `sha256:${'a'.repeat(64)}`;
const DIGEST_SUBSCRIPTION = `sha256:${'b'.repeat(64)}`;
const DIGEST_DISCONNECT = `sha256:${'c'.repeat(64)}`;
const DIGEST_REPLACE = `sha256:${'d'.repeat(64)}`;
const DIGEST_EVENT = `sha256:${'e'.repeat(64)}`;
const account = Object.freeze({
    brokerId: 'broker-A',
    accountId: 'account-A',
    accountType: 'S',
});

function event(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
        mappingRevision: 'gate-0-correlation-mapping/test-only',
        apiGeneration: 'generation-1',
        eventKind: 'deal',
        account,
        tradeDate: '2026-08-11',
        contractKey: 'TSE:2330:STK:Common',
        side: 'Buy',
        identifiers: {
            tradeId: 'trade-1',
            orderId: null,
            dealId: null,
            seqno: 'seq-1',
            ordno: 'ORD01001',
            exchangeSequence: 'exchange-1',
            customField: '',
        },
        operation: { type: null, code: null, message: null },
        status: 'PartFilled',
        orderClass: {
            orderCondition: 'Cash',
            orderLot: 'Common',
            priceType: 'LMT',
            timeInForce: 'ROD',
        },
        quantities: {
            order: 2,
            cumulativeDeal: 1,
            cumulativeCancel: 0,
            remaining: 1,
            eventDeal: 1,
            unit: 'CommonLot',
        },
        price: '100',
        timestamps: {
            exchangeEpochMs: 1_786_377_600_100,
            brokerEpochMs: 1_786_377_600_105,
            receiveEpochMs: 1_786_377_600_110,
        },
        ...overrides,
    };
}

function createVerifier({
    beforeConnectionVerification,
    beforeEventVerification,
    beforeSubscriptionVerification,
} = {}) {
    const disconnectEvidence = Object.freeze({ kind: 'disconnect' });
    const initializeEvidence = Object.freeze({ kind: 'initialize' });
    const replaceEvidence = Object.freeze({ kind: 'replace' });
    const subscriptionEvidence = Object.freeze({ kind: 'subscription' });
    const eventEvidence = Object.freeze({ kind: 'event' });
    const verifier = Object.freeze({
        verifyConnectionEvidence(evidence, expected) {
            beforeConnectionVerification?.(evidence, expected);
            return Object.freeze({
                valid:
                    expected.action === 'initialize'
                        ? evidence === initializeEvidence
                        : expected.action === 'disconnect'
                          ? evidence === disconnectEvidence
                          : evidence === replaceEvidence,
                evidenceSha256:
                    expected.action === 'initialize'
                        ? DIGEST_INITIALIZE
                        : expected.action === 'disconnect'
                          ? DIGEST_DISCONNECT
                          : DIGEST_REPLACE,
            });
        },
        verifyEventEvidence(evidence, expected) {
            beforeEventVerification?.(expected);
            return Object.freeze({
                valid:
                    evidence === eventEvidence &&
                    expected.apiGeneration === 'generation-1' &&
                    expected.connectionId === 'connection-1' &&
                    expected.brokerEventKeySha256.startsWith('sha256:') &&
                    expected.brokerEventEvidenceSha256.startsWith('sha256:') &&
                    expected.mappingRevision ===
                        'gate-0-correlation-mapping/test-only' &&
                    expected.payloadSha256.startsWith('sha256:'),
                evidenceSha256: DIGEST_EVENT,
            });
        },
        verifySubscriptionEvidence(evidence, expected) {
            beforeSubscriptionVerification?.(evidence, expected);
            return Object.freeze({
                valid:
                    evidence === subscriptionEvidence &&
                    expected.apiGeneration === 'generation-1' &&
                    expected.connectionId === 'connection-1' &&
                    expected.planId.startsWith('trade-subscription-plan:'),
                evidenceSha256: DIGEST_SUBSCRIPTION,
            });
        },
    });
    authority.verifiers.add(verifier);
    return {
        disconnectEvidence,
        eventEvidence,
        initializeEvidence,
        replaceEvidence,
        subscriptionEvidence,
        verifier,
    };
}

function createCoordinator({
    beforeConnectionVerification,
    beforeEventVerification,
    beforeSubscriptionVerification,
    withVerifier = true,
} = {}) {
    let monotonicMs = 100;
    const testVerifier = createVerifier({
        beforeConnectionVerification,
        beforeEventVerification,
        beforeSubscriptionVerification,
    });
    const coordinator = createSmartOrderTradeSubscriptionCoordinator({
        apiGeneration: 'generation-1',
        connectionId: 'connection-1',
        initialConnectionEvidence: withVerifier
            ? testVerifier.initializeEvidence
            : null,
        nowMonotonicMs() {
            monotonicMs += 1;
            return monotonicMs;
        },
        transportVerifier: withVerifier ? testVerifier.verifier : null,
    });
    return { coordinator, ...testVerifier };
}

function acquire(coordinator, consumerId = 'runtime-1') {
    return coordinator.runtime.acquireFixedAccount({ account, consumerId });
}

function confirm(coordinator, subscriptionEvidence) {
    const [plan] = coordinator.observer.pendingSubscriptionPlans();
    return {
        plan,
        stream: coordinator.runtime.confirmSubscription(
            plan,
            subscriptionEvidence,
        ),
    };
}

describe('smart-order fixed-account trade subscription coordinator', () => {
    it('stays fail closed without a private transport verifier', () => {
        const { coordinator } = createCoordinator({ withVerifier: false });
        const handle = acquire(coordinator);
        expect(handle).toMatchObject({
            handleClass: 'fixed_trade_account_demand',
            subscriptionTransportAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(coordinator.observer.pendingSubscriptionPlans()).toEqual([]);
        expect(coordinator.observer.status()).toMatchObject({
            fixedAccountCount: 1,
            transportVerifierConfigured: false,
            confirmedAccountCount: 0,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(coordinator.observer.status().connectionActive).toBe(false);
    });

    it('rejects a structural verifier that was not issued by the authority seam', () => {
        expect(() =>
            createSmartOrderTradeSubscriptionCoordinator({
                apiGeneration: 'generation-1',
                connectionId: 'connection-1',
                initialConnectionEvidence: null,
                nowMonotonicMs: () => 1,
                transportVerifier: Object.freeze({
                    verifyConnectionEvidence: () => ({
                        valid: true,
                        evidenceSha256: DIGEST_INITIALIZE,
                    }),
                    verifyEventEvidence: () => ({
                        valid: true,
                        evidenceSha256: DIGEST_EVENT,
                    }),
                    verifySubscriptionEvidence: () => ({
                        valid: true,
                        evidenceSha256: DIGEST_SUBSCRIPTION,
                    }),
                }),
            }),
        ).toThrow('not authority-issued');
    });

    it('allows one authority-issued verifier to be claimed by only one coordinator', () => {
        const testVerifier = createVerifier();
        const options = () => ({
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
            initialConnectionEvidence: testVerifier.initializeEvidence,
            nowMonotonicMs: () => 1,
            transportVerifier: testVerifier.verifier,
        });
        const first = createSmartOrderTradeSubscriptionCoordinator(options());
        expect(first.observer.status()).toMatchObject({
            schemaVersion:
                'smart-order-trade-subscription-coordinator/2026-08-13.2',
            transportVerifierConfigured: true,
        });
        first.runtime.close();
        expect(() =>
            createSmartOrderTradeSubscriptionCoordinator(options()),
        ).toThrow('transport verifier is already claimed');
    });

    it('deduplicates fixed-account demands and confirms only an issued current plan', () => {
        const { coordinator, subscriptionEvidence } = createCoordinator();
        const first = acquire(coordinator, 'runtime-1');
        const second = acquire(coordinator, 'runtime-2');
        expect(coordinator.observer.status()).toMatchObject({
            fixedAccountCount: 1,
            totalDemandCount: 2,
            pendingPlanCount: 1,
        });
        const { plan, stream } = confirm(coordinator, subscriptionEvidence);
        expect(plan.account).toEqual(account);
        expect(stream).toMatchObject({
            handleClass: 'confirmed_trade_event_stream',
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(
            coordinator.runtime.confirmSubscription(
                structuredClone(plan),
                subscriptionEvidence,
            ),
        ).toMatchObject({ allowed: false, reason: 'trade_subscription_plan_invalid' });
        expect(coordinator.runtime.releaseFixedAccount(first)).toMatchObject({
            action: 'refcount_decremented',
        });
        expect(coordinator.runtime.releaseFixedAccount(second)).toMatchObject({
            action: 'retained_until_disconnect',
        });
    });

    it('accepts deal-before-order, deduplicates redelivery and rejects evidence clones', () => {
        const {
            coordinator,
            eventEvidence,
            subscriptionEvidence,
        } = createCoordinator();
        acquire(coordinator);
        const { stream } = confirm(coordinator, subscriptionEvidence);
        expect(
            coordinator.runtime.recordEvent(stream, event(), eventEvidence),
        ).toMatchObject({ allowed: true, state: 'accepted' });
        expect(
            coordinator.runtime.recordEvent(
                stream,
                event({
                    timestamps: {
                        ...event().timestamps,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
                eventEvidence,
            ),
        ).toMatchObject({ allowed: true, state: 'duplicate' });
        expect(
            coordinator.runtime.recordEvent(
                stream,
                event(),
                structuredClone(eventEvidence),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'trade_event_evidence_invalid',
            reconciliationRequired: true,
        });
    });

    it('commits the exact normalized snapshot verified before caller mutation', () => {
        let candidate;
        const { coordinator, eventEvidence, subscriptionEvidence } =
            createCoordinator({
                beforeEventVerification() {
                    candidate.status = 'Filled';
                    candidate.quantities.remaining = 0;
                },
            });
        acquire(coordinator);
        const { stream } = confirm(coordinator, subscriptionEvidence);
        candidate = event();
        const result = coordinator.runtime.recordEvent(
            stream,
            candidate,
            eventEvidence,
        );
        expect(candidate.status).toBe('Filled');
        expect(result).toMatchObject({
            allowed: true,
            state: 'accepted',
            event: {
                status: 'PartFilled',
                quantities: { remaining: 1 },
            },
        });
    });

    it('does not commit an event after verifier reentrancy retires its stream', () => {
        let coordinator;
        let disconnectEvidence;
        let reentered = false;
        const created = createCoordinator({
            beforeEventVerification() {
                if (reentered) return;
                reentered = true;
                expect(
                    coordinator.runtime.markDisconnected(
                        {
                            apiGeneration: 'generation-1',
                            connectionId: 'connection-1',
                        },
                        disconnectEvidence,
                    ),
                ).toMatchObject({ allowed: true });
            },
        });
        coordinator = created.coordinator;
        disconnectEvidence = created.disconnectEvidence;
        acquire(coordinator);
        const { stream } = confirm(
            coordinator,
            created.subscriptionEvidence,
        );
        expect(
            coordinator.runtime.recordEvent(
                stream,
                event(),
                created.eventEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'trade_stream_not_current',
            reconciliationRequired: true,
        });
        expect(coordinator.observer.status()).toMatchObject({
            connectionActive: false,
            confirmedAccountCount: 0,
        });
    });

    it('invalidates the old stream on disconnect and plans resubscription on a new lineage', () => {
        const {
            coordinator,
            disconnectEvidence,
            eventEvidence,
            replaceEvidence,
            subscriptionEvidence,
        } = createCoordinator();
        acquire(coordinator);
        const { stream } = confirm(coordinator, subscriptionEvidence);
        expect(
            coordinator.runtime.markDisconnected({
                apiGeneration: 'generation-1',
                connectionId: 'connection-1',
            }, disconnectEvidence),
        ).toMatchObject({
            action: 'connection_invalidated',
            reconciliationRequired: true,
        });
        expect(
            coordinator.runtime.recordEvent(stream, event(), eventEvidence),
        ).toMatchObject({ allowed: false, reason: 'trade_stream_not_current' });
        expect(
            coordinator.runtime.replaceConnection({
                apiGeneration: 'generation-2',
                connectionId: 'connection-2',
            }, replaceEvidence),
        ).toMatchObject({ action: 'connection_lineage_replaced' });
        const [nextPlan] = coordinator.observer.pendingSubscriptionPlans();
        expect(nextPlan).toMatchObject({
            apiGeneration: 'generation-2',
            connectionId: 'connection-2',
        });
        expect(coordinator.observer.status()).toMatchObject({
            confirmedAccountCount: 0,
            reconciliationRequired: true,
            automaticResubscribeDispatchAllowed: false,
        });
        const status = coordinator.observer.status();
        expect(status).not.toHaveProperty('apiGeneration');
        expect(status).not.toHaveProperty('connectionId');
        expect(status.apiGenerationSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(status.connectionIdSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(
            coordinator.runtime.markDisconnected(
                {
                    apiGeneration: 'generation-2',
                    connectionId: 'connection-2',
                },
                disconnectEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'trade_subscription_connection_evidence_replayed',
        });
    });

    it('does not reuse one subscription confirmation across fixed accounts', () => {
        const { coordinator, subscriptionEvidence } = createCoordinator();
        acquire(coordinator, 'runtime-account-a');
        coordinator.runtime.acquireFixedAccount({
            account: {
                brokerId: 'broker-A',
                accountId: 'account-B',
                accountType: 'S',
            },
            consumerId: 'runtime-account-b',
        });
        const plans = coordinator.observer.pendingSubscriptionPlans();
        expect(plans).toHaveLength(2);
        expect(
            coordinator.runtime.confirmSubscription(
                plans[0],
                subscriptionEvidence,
            ),
        ).toMatchObject({ handleClass: 'confirmed_trade_event_stream' });
        expect(
            coordinator.runtime.confirmSubscription(
                plans[1],
                subscriptionEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'trade_subscription_evidence_replayed',
        });
    });

    it('does not bind one event evidence to different broker evidence', () => {
        const { coordinator, eventEvidence, subscriptionEvidence } =
            createCoordinator();
        acquire(coordinator);
        const { stream } = confirm(coordinator, subscriptionEvidence);
        expect(
            coordinator.runtime.recordEvent(stream, event(), eventEvidence),
        ).toMatchObject({ allowed: true, state: 'accepted' });
        expect(
            coordinator.runtime.recordEvent(
                stream,
                event({
                    identifiers: {
                        ...event().identifiers,
                        exchangeSequence: 'exchange-2',
                    },
                    status: 'Filled',
                    quantities: {
                        order: 2,
                        cumulativeDeal: 2,
                        cumulativeCancel: 0,
                        remaining: 0,
                        eventDeal: 1,
                        unit: 'CommonLot',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
                eventEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'trade_event_evidence_replayed',
            reconciliationRequired: true,
        });
    });

    it('latches subscribe failure and requires an explicit retry', () => {
        const { coordinator } = createCoordinator();
        const handle = acquire(coordinator);
        const [plan] = coordinator.observer.pendingSubscriptionPlans();
        expect(
            coordinator.runtime.reportSubscriptionFailure(plan, {
                apiGeneration: 'generation-1',
                connectionId: 'connection-1',
                planId: plan.planId,
                reason: 'subscribe_failed',
            }),
        ).toMatchObject({
            action: 'subscription_failure_latched',
            automaticRetryAllowed: false,
        });
        expect(coordinator.observer.pendingSubscriptionPlans()).toEqual([]);
        expect(coordinator.runtime.retrySubscription(handle)).toMatchObject({
            allowed: true,
            action: 'explicit_retry_planned',
        });
    });

    it('does not retry an unknown subscribe result on the same connection', () => {
        const { coordinator } = createCoordinator();
        const handle = acquire(coordinator);
        const [plan] = coordinator.observer.pendingSubscriptionPlans();
        coordinator.runtime.reportSubscriptionFailure(plan, {
            apiGeneration: 'generation-1',
            connectionId: 'connection-1',
            planId: plan.planId,
            reason: 'subscribe_result_unknown',
        });
        expect(coordinator.runtime.retrySubscription(handle)).toMatchObject({
            allowed: false,
            reason: 'trade_subscription_retry_not_allowed',
        });
        expect(coordinator.runtime.releaseFixedAccount(handle)).toMatchObject({
            action: 'retained_until_disconnect',
        });
    });

    it('fails closed on account mismatch and event conflicts', () => {
        const {
            coordinator,
            eventEvidence,
            subscriptionEvidence,
        } = createCoordinator();
        acquire(coordinator);
        const { stream } = confirm(coordinator, subscriptionEvidence);
        expect(
            coordinator.runtime.recordEvent(
                stream,
                event({
                    account: {
                        brokerId: 'broker-A',
                        accountId: 'account-B',
                        accountType: 'S',
                    },
                }),
                eventEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'trade_event_scope_mismatch',
        });
    });

    it('does not execute accessors or Proxy traps in public structural inputs', () => {
        const { coordinator } = createCoordinator();
        let accountReads = 0;
        const demand = { account, consumerId: 'runtime-1' };
        Object.defineProperty(demand, 'account', {
            enumerable: true,
            get() {
                accountReads += 1;
                return account;
            },
        });
        expect(coordinator.runtime.acquireFixedAccount(demand)).toMatchObject({
            allowed: false,
            reason: 'trade_subscription_demand_schema_invalid',
        });
        expect(accountReads).toBe(0);

        let proxyReads = 0;
        const proxy = new Proxy({ account, consumerId: 'runtime-2' }, {
            ownKeys(target) {
                proxyReads += 1;
                return Reflect.ownKeys(target);
            },
        });
        expect(coordinator.runtime.acquireFixedAccount(proxy)).toMatchObject({
            allowed: false,
            reason: 'trade_subscription_demand_schema_invalid',
        });
        expect(proxyReads).toBe(0);
    });

    it('closes fail closed without claiming unsubscription or reconciliation', () => {
        const { coordinator, replaceEvidence, subscriptionEvidence } =
            createCoordinator();
        acquire(coordinator);
        confirm(coordinator, subscriptionEvidence);
        expect(coordinator.runtime.close()).toMatchObject({
            closed: true,
            connectionActive: false,
            confirmedAccountCount: 0,
            reconciliationRequired: true,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(
            coordinator.runtime.replaceConnection(
                {
                    apiGeneration: 'generation-2',
                    connectionId: 'connection-2',
                },
                replaceEvidence,
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'trade_subscription_coordinator_closed',
        });
        expect(coordinator.observer.status()).toMatchObject({
            closed: true,
            connectionActive: false,
            pendingPlanCount: 0,
        });
    });
});
