import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS,
    SMART_ORDER_SUBSCRIPTION_OWNERSHIP_SCHEMA,
    SMART_ORDER_SUBSCRIPTION_OWNERSHIP_VERSION,
} from './gate-evidence-verifier.mjs';
import {
    SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND,
    createSmartOrderResourceCoordinator as createRawSmartOrderResourceCoordinator,
    verifyCurrentSmartOrderSubscriptionOwnership,
} from './resource-coordinator.mjs';

const coordinators = new Set();
let monotonicTestOffset = 0;

function countingDimension() {
    return `verified-subscription-item/${createHash('sha256')
        .update(expect.getState().currentTestName ?? 'unknown-test')
        .digest('hex')}`;
}

function testDigests() {
    const testName = expect.getState().currentTestName ?? 'unknown-test';
    const digest = (label) =>
        createHash('sha256').update(`${label}\u001f${testName}`).digest('hex');
    return Object.freeze({
        source: digest('source'),
        app: digest('app'),
        shioaji: digest('shioaji'),
    });
}

function createSmartOrderResourceCoordinator(options) {
    const rawClock = options?.nowMonotonicMs;
    const coordinator = createRawSmartOrderResourceCoordinator({
        ...options,
        ...(rawClock
            ? { nowMonotonicMs: () => monotonicTestOffset + rawClock() }
            : {}),
    });
    coordinators.add(coordinator);
    return coordinator;
}

afterEach(() => {
    for (const coordinator of coordinators) {
        coordinator.close();
    }
    coordinators.clear();
});

beforeEach(() => {
    monotonicTestOffset += 1_000_000;
});

function subscriptionExpected() {
    const digests = testDigests();
    return {
        sourceSha256: digests.source,
        appBuildSha256: digests.app,
        shioajiCapabilitySha256: digests.shioaji,
        countingDimension: countingDimension(),
        officialLimitUnits: 200,
        localLimitUnits: 160,
        reservedHeadroomUnits: 40,
    };
}

function withResultHash(report) {
    const result = structuredClone(report);
    result.resultHash = createHash('sha256')
        .update(canonicalJson({ ...result, resultHash: '' }))
        .digest('hex');
    return result;
}

function subscriptionReport({
    generatedAtEpochMs,
    usageByConsumer = {},
    consumerOverrides = {},
    poolOverrides = {},
} = {}) {
    const digests = testDigests();
    const consumers = SMART_ORDER_REQUIRED_SUBSCRIPTION_CONSUMER_IDS.map(
        (consumerId) => ({
            consumerId,
            visible: true,
            usageKnown: true,
            usageUnits: usageByConsumer[consumerId] ?? 0,
            ...(consumerOverrides[consumerId] ?? {}),
        }),
    );
    const totalUsageUnits = consumers.reduce(
        (sum, consumer) =>
            sum + (consumer.usageKnown ? consumer.usageUnits : 0),
        0,
    );
    return withResultHash({
        schema: SMART_ORDER_SUBSCRIPTION_OWNERSHIP_SCHEMA,
        version: SMART_ORDER_SUBSCRIPTION_OWNERSHIP_VERSION,
        codeRevision: `sha256:${digests.source}`,
        generatedAt: new Date(generatedAtEpochMs).toISOString(),
        runId: randomUUID(),
        executionMode: 'live-readonly',
        evidenceClass: 'subscription_ownership',
        countingDimension: countingDimension(),
        fingerprint: {
            appBuildSha256: digests.app,
            shioajiCapabilitySha256: digests.shioaji,
        },
        consumers,
        pool: {
            officialLimitUnits: 200,
            localLimitUnits: 160,
            reservedHeadroomUnits: 40,
            ownershipComplete: true,
            usageComplete: true,
            sharedPoolVerified: true,
            totalUsageUnits,
            ...poolOverrides,
        },
        accountIdentifiersPersisted: false,
        testOutcome: 'pass',
        overall: 'pass',
        resultHash: '',
    });
}

function verifiedOwnership({
    nowEpochMs,
    report = subscriptionReport({ generatedAtEpochMs: nowEpochMs - 1_000 }),
    maximumAgeMs = 10_000,
} = {}) {
    return verifyCurrentSmartOrderSubscriptionOwnership({
        report,
        expected: subscriptionExpected(),
        nowEpochMs,
        maximumAgeMs,
    });
}

function subscriptionDemand(overrides = {}) {
    return {
        demandId: 'smart-order-2330-last',
        countingDimension: countingDimension(),
        units: 1,
        transport: 'subscription',
        ...overrides,
    };
}

function operation(operationId, kind) {
    const testName = expect.getState().currentTestName ?? 'unknown-test';
    const namespace = createHash('sha256')
        .update(testName)
        .digest('hex')
        .slice(0, 12);
    return { operationId: `${namespace}:${operationId}`, kind };
}

function operationId(localId) {
    return operation(localId, 'status').operationId;
}

function completeGrant(coordinator, grant) {
    if (!['reconciliation', 'status'].includes(grant.kind)) {
        expect(
            coordinator.markOperationDispatching({
                operationId: grant.operationId,
            }),
        ).toMatchObject({
            allowed: true,
            state: 'dispatching_bytes_possible',
            brokerAuthority: false,
        });
    }
    return coordinator.completeOperation({ operationId: grant.operationId });
}


describe('task 5.10 verifier-issued subscription resource accounting', () => {
    it('fails closed without a current verifier-issued ownership handle or when it is cloned', () => {
        const now = 1_900_000_000_000;
        const missing = createSmartOrderResourceCoordinator({
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        expect(
            missing.reserveSubscriptionDemand(subscriptionDemand()),
        ).toEqual({
            allowed: false,
            reason: 'subscription_ownership_unverified',
        });

        const issued = verifiedOwnership({ nowEpochMs: now });
        expect(issued).toMatchObject({
            issued: true,
            grantsWriteAuthority: false,
        });
        const cloned = structuredClone(issued);
        const forged = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: cloned,
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        expect(
            forged.reserveSubscriptionDemand(subscriptionDemand()),
        ).toMatchObject({
            allowed: false,
            reason: 'subscription_ownership_unverified',
        });
        expect(forged.status()).toMatchObject({
            writeMasterAuthority: false,
            brokerAuthority: false,
        });
    });

    it.each([
        ['unknown usage', { usageKnown: false, usageUnits: null }],
        ['invisible consumer', { visible: false }],
    ])('rejects ownership evidence with %s', (_label, consumerOverride) => {
        const now = 1_900_000_000_000;
        const report = subscriptionReport({
            generatedAtEpochMs: now - 1_000,
            consumerOverrides: { external_clients: consumerOverride },
            poolOverrides: { usageComplete: false },
        });
        const evidence = verifiedOwnership({ nowEpochMs: now, report });
        expect(evidence).toMatchObject({
            issued: false,
            reasons: expect.arrayContaining([
                'consumer_usage_unknown',
                'ownership_or_usage_incomplete',
            ]),
        });
    });

    it('expires current evidence and rejects unknown counting dimensions', () => {
        let now = 1_900_000_000_000;
        const evidence = verifiedOwnership({
            nowEpochMs: now,
            maximumAgeMs: 2_000,
        });
        const coordinator = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: evidence,
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        expect(
            coordinator.reserveSubscriptionDemand(
                subscriptionDemand({ countingDimension: 'unknown' }),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'subscription_counting_dimension_mismatch',
        });
        now += 2_001;
        expect(
            coordinator.reserveSubscriptionDemand(subscriptionDemand()),
        ).toMatchObject({
            allowed: false,
            reason: 'subscription_ownership_stale',
        });
    });

    it('latches a regressed evidence clock instead of making stale ownership current again', () => {
        let now = 1_900_000_000_000;
        const coordinator = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: verifiedOwnership({
                nowEpochMs: now,
            }),
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        const first = coordinator.reserveSubscriptionDemand(
            subscriptionDemand({ demandId: 'before-regression' }),
        );
        expect(first.allowed).toBe(true);
        now -= 1;
        expect(
            coordinator.reserveSubscriptionDemand(
                subscriptionDemand({ demandId: 'during-regression' }),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'subscription_ownership_stale',
        });
        now += 2;
        expect(
            coordinator.reserveSubscriptionDemand(
                subscriptionDemand({ demandId: 'after-regression' }),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'subscription_ownership_stale',
        });
        expect(coordinator.status()).toMatchObject({
            subscriptionEvidenceCurrent: false,
            evidenceClockInvalid: true,
            writeMasterAuthority: false,
        });
        first.release();
    });

    it('enforces the strict local 160 ceiling and preserves at least 40 official units of headroom', () => {
        const now = 1_900_000_000_000;
        const report = subscriptionReport({
            generatedAtEpochMs: now - 1_000,
            usageByConsumer: { '5173': 157 },
        });
        const coordinator = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: verifiedOwnership({
                nowEpochMs: now,
                report,
            }),
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        const twoUnits = coordinator.reserveSubscriptionDemand(
            subscriptionDemand({ demandId: 'two-units', units: 2 }),
        );
        expect(twoUnits).toMatchObject({
            allowed: true,
            projectedUsageUnits: 159,
            brokerAuthority: false,
        });
        expect(
            coordinator.reserveSubscriptionDemand(
                subscriptionDemand({ demandId: 'reaches-160' }),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'local_subscription_budget_exhausted',
            projectedUsageUnits: 160,
        });
        twoUnits.release();
        const afterRelease = coordinator.reserveSubscriptionDemand(
            subscriptionDemand({ demandId: 'after-release' }),
        );
        expect(afterRelease).toMatchObject({
            allowed: true,
            projectedUsageUnits: 158,
        });
        afterRelease.release();
        coordinator.close();
    });

    it('shares one ledger across coordinators and repeated verification of the same report', () => {
        const now = 1_900_000_000_000;
        const report = subscriptionReport({
            generatedAtEpochMs: now - 1_000,
            usageByConsumer: { '5173': 150 },
        });
        const firstEvidence = verifiedOwnership({ nowEpochMs: now, report });
        const secondEvidence = verifiedOwnership({ nowEpochMs: now, report });
        const first = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: firstEvidence,
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        const second = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: firstEvidence,
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        const reverified = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: secondEvidence,
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        const lease = first.reserveSubscriptionDemand(
            subscriptionDemand({ demandId: 'shared-first', units: 9 }),
        );
        expect(lease).toMatchObject({
            allowed: true,
            projectedUsageUnits: 159,
        });
        for (const [coordinator, demandId] of [
            [second, 'shared-second'],
            [reverified, 'shared-reverified'],
        ]) {
            expect(
                coordinator.reserveSubscriptionDemand(
                    subscriptionDemand({ demandId, units: 9 }),
                ),
            ).toMatchObject({
                allowed: false,
                reason: 'local_subscription_budget_exhausted',
                projectedUsageUnits: 168,
            });
        }
        expect(second.status()).toMatchObject({
            subscriptionReservedUnits: 9,
        });
        lease.release();
        expect(
            reverified.reserveSubscriptionDemand(
                subscriptionDemand({
                    demandId: 'shared-after-release',
                    units: 9,
                }),
            ),
        ).toMatchObject({ allowed: true, projectedUsageUnits: 159 });
        first.close();
        second.close();
        reverified.close();
    });

    it('retires an older ownership snapshot and rejects equal-time conflicts', () => {
        const now = 1_900_000_000_000;
        const older = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: verifiedOwnership({
                nowEpochMs: now,
                report: subscriptionReport({
                    generatedAtEpochMs: now - 5_000,
                    usageByConsumer: { '5173': 0 },
                }),
            }),
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        const newer = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: verifiedOwnership({
                nowEpochMs: now,
                report: subscriptionReport({
                    generatedAtEpochMs: now - 1_000,
                    usageByConsumer: { '5173': 158 },
                }),
            }),
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        expect(
            newer.reserveSubscriptionDemand(
                subscriptionDemand({ demandId: 'new-head' }),
            ),
        ).toMatchObject({ allowed: true, projectedUsageUnits: 159 });
        expect(
            older.reserveSubscriptionDemand(
                subscriptionDemand({ demandId: 'old-head', units: 158 }),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'subscription_ownership_superseded',
        });
        expect(older.status()).toMatchObject({
            subscriptionEvidenceCurrent: false,
            subscriptionEvidenceBlocker: 'subscription_ownership_superseded',
        });

        const equalTimeConflict = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: verifiedOwnership({
                nowEpochMs: now,
                report: subscriptionReport({
                    generatedAtEpochMs: now - 1_000,
                    usageByConsumer: { '5173': 157 },
                }),
            }),
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        expect(
            equalTimeConflict.reserveSubscriptionDemand(
                subscriptionDemand({ demandId: 'conflicted-head' }),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'subscription_ownership_conflict',
        });
        older.close();
        newer.close();
        equalTimeConflict.close();
    });

    it('rejects accessor-backed verifier inputs before deriving a ledger lineage', () => {
        const now = 1_900_000_000_000;
        const report = subscriptionReport({ generatedAtEpochMs: now - 1_000 });
        const expected = subscriptionExpected();
        let reads = 0;
        Object.defineProperty(expected, 'sourceSha256', {
            enumerable: true,
            get() {
                reads += 1;
                return DIGESTS.source;
            },
        });
        expect(
            verifyCurrentSmartOrderSubscriptionOwnership({
                report,
                expected,
                nowEpochMs: now,
            }),
        ).toEqual({
            issued: false,
            evidenceClass: 'subscription_ownership',
            reasons: ['verifier_context_invalid'],
        });
        expect(reads).toBe(0);
    });

    it('rejects accessor-backed demand fields before subscription accounting', () => {
        const now = 1_900_000_000_000;
        const coordinator = createSmartOrderResourceCoordinator({
            subscriptionOwnershipEvidence: verifiedOwnership({
                nowEpochMs: now,
            }),
            nowEpochMs: () => now,
            nowMonotonicMs: () => 0,
        });
        const demand = subscriptionDemand({ demandId: 'accessor-units' });
        Object.defineProperty(demand, 'units', {
            enumerable: true,
            get() {
                return 9;
            },
        });
        expect(coordinator.reserveSubscriptionDemand(demand)).toEqual({
            allowed: false,
            reason: 'subscription_demand_schema_invalid',
        });
        expect(coordinator.status()).toMatchObject({
            subscriptionReservedUnits: 0,
        });
    });

    it.each(['snapshot', 'ticks', 'kbars'])(
        'forbids %s polling as a subscription substitute',
        (transport) => {
            const now = 1_900_000_000_000;
            const coordinator = createSmartOrderResourceCoordinator({
                subscriptionOwnershipEvidence: verifiedOwnership({
                    nowEpochMs: now,
                }),
                nowEpochMs: () => now,
                nowMonotonicMs: () => 0,
            });
            expect(
                coordinator.reserveSubscriptionDemand(
                    subscriptionDemand({ transport }),
                ),
            ).toEqual({
                allowed: false,
                reason: 'snapshot_polling_substitute_forbidden',
            });
        },
    );
});

describe('task 5.10 bounded weighted broker-operation queue', () => {
    it('drives production async admission through the same bounded scheduler', async () => {
        let monotonic = 0;
        const scheduled = [];
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            scheduleOperationPump(callback, delayMs) {
                scheduled.push({ callback, delayMs });
            },
        });
        const reconciliationGrant = coordinator.acquireOperation(
            operation('managed-reconciliation', 'reconciliation'),
        );
        const exposureGrant = coordinator.acquireOperation(
            operation('managed-exposure', 'new_exposure'),
        );
        expect(scheduled).toHaveLength(1);
        scheduled.shift().callback();
        await expect(reconciliationGrant).resolves.toMatchObject({
            allowed: true,
            kind: 'reconciliation',
            schedulerGrantOnly: true,
            brokerAuthority: false,
        });
        expect(coordinator.takeNextOperation()).toEqual({
            allowed: false,
            reason: 'managed_operation_scheduler_active',
        });
        expect(
            coordinator.completeOperation({
                operationId: operationId('managed-reconciliation'),
            }),
        ).toMatchObject({ allowed: true, action: 'complete' });
        expect(scheduled).toHaveLength(1);
        monotonic = 1_001;
        scheduled.shift().callback();
        await expect(exposureGrant).resolves.toMatchObject({
            allowed: true,
            kind: 'new_exposure',
            schedulerGrantOnly: true,
            brokerAuthority: false,
        });
        expect(
            coordinator.markOperationDispatching({
                operationId: operationId('managed-exposure'),
            }),
        ).toMatchObject({ allowed: true });
        expect(
            coordinator.completeOperation({
                operationId: operationId('managed-exposure'),
            }),
        ).toMatchObject({ allowed: true, action: 'complete' });
    });

    it('counts every additional transport unit against the same rolling limiter', async () => {
        let monotonic = 0;
        const scheduled = [];
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            scheduleOperationPump(callback, delayMs) {
                scheduled.push({ callback, delayMs });
            },
        });
        expect(
            coordinator.enqueueOperation(
                operation('multi-request-operation', 'reconciliation'),
            ),
        ).toMatchObject({ allowed: true });
        const grant = coordinator.takeNextOperation();
        expect(grant.allowed).toBe(true);
        for (let index = 0; index < 5; index += 1) {
            await expect(
                coordinator.acquireOperationUnit({
                    operationId: grant.operationId,
                }),
            ).resolves.toMatchObject({
                allowed: true,
                operationUnit: true,
                rateLimitPerSecond: 5,
            });
        }
        let sixthSettled = false;
        const sixth = coordinator
            .acquireOperationUnit({
                operationId: grant.operationId,
            })
            .finally(() => {
                sixthSettled = true;
            });
        await Promise.resolve();
        expect(sixthSettled).toBe(false);
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].delayMs).toBe(1_001);
        monotonic = 1_001;
        scheduled.shift().callback();
        await expect(sixth).resolves.toMatchObject({
            allowed: true,
            operationUnit: true,
        });
        expect(
            coordinator.completeOperation({
                operationId: grant.operationId,
            }),
        ).toMatchObject({ allowed: true });
    });

    it('fixes the scheduler to one in-flight operation', () => {
        expect(() =>
            createSmartOrderResourceCoordinator({ maxInFlight: 2 }),
        ).toThrow('resource coordinator limits are inconsistent');
    });

    it('rejects accessor-backed kinds instead of mixing policy and payload', () => {
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => 0,
        });
        let reads = 0;
        const input = { operationId: 'accessor-kind', kind: 'status' };
        Object.defineProperty(input, 'kind', {
            enumerable: true,
            get() {
                reads += 1;
                return reads === 1 ? 'status' : 'new_exposure';
            },
        });
        expect(coordinator.enqueueOperation(input)).toEqual({
            allowed: false,
            reason: 'operation_schema_invalid',
        });
        expect(reads).toBe(0);
        expect(coordinator.status()).toMatchObject({ queueDepth: 0 });
    });

    it.each(['__proto__', 'constructor', 'toString'])(
        'rejects inherited operation kind %s without throwing',
        (kind) => {
            const coordinator = createSmartOrderResourceCoordinator({
                nowMonotonicMs: () => 0,
            });
            expect(
                coordinator.enqueueOperation(
                    operation(`prototype-${kind}`, kind),
                ),
            ).toEqual({
                allowed: false,
                reason: 'operation_kind_unknown',
            });
            coordinator.close();
        },
    );

    it('shares one in-flight and rolling-rate authority across coordinators', async () => {
        let monotonic = 0;
        const first = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        const second = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        first.enqueueOperation(operation('cross-instance-first', 'status'));
        expect(
            second.enqueueOperation(
                operation('cross-instance-second', 'status'),
            ),
        ).toEqual({
            allowed: false,
            reason: 'operation_authority_already_claimed',
        });
        const firstGrant = first.takeNextOperation();
        expect(firstGrant).toMatchObject({ allowed: true });
        await first.acquireOperationUnit({
            operationId: firstGrant.operationId,
        });
        first.completeOperation({
            operationId: operationId('cross-instance-first'),
        });
        for (let index = 0; index < 4; index += 1) {
            first.enqueueOperation(
                operation(`cross-instance-rate-${index}`, 'status'),
            );
            const grant = first.takeNextOperation();
            expect(grant.allowed).toBe(true);
            await first.acquireOperationUnit({
                operationId: grant.operationId,
            });
            first.completeOperation({ operationId: grant.operationId });
        }
        first.close();
        expect(
            second.enqueueOperation(
                operation('cross-instance-second', 'status'),
            ),
        ).toMatchObject({ allowed: true });
        expect(second.takeNextOperation()).toMatchObject({
            allowed: false,
            reason: 'common_operation_rate_limited',
        });
        monotonic = 1_001;
        expect(second.takeNextOperation()).toMatchObject({ allowed: true });
        second.completeOperation({
            operationId: operationId('cross-instance-second'),
        });
        second.close();
    });

    it('does not let close move a granted write into dispatching bytes', () => {
        let monotonic = 10_000;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        coordinator.enqueueOperation(
            operation('close-before-bytes', 'new_exposure'),
        );
        expect(coordinator.takeNextOperation()).toMatchObject({ allowed: true });
        coordinator.close();
        expect(
            coordinator.markOperationDispatching({
                operationId: operationId('close-before-bytes'),
            }),
        ).toEqual({
            allowed: false,
            reason: 'resource_coordinator_closed',
        });
        monotonic += 1;
    });

    it('keeps terminal operation IDs blocked across coordinator ownership handoff', () => {
        let monotonic = 20_000;
        const first = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        expect(
            first.enqueueOperation(operation('global-replay-id', 'status')),
        ).toMatchObject({ allowed: true });
        const grant = first.takeNextOperation();
        expect(grant).toMatchObject({ allowed: true });
        first.completeOperation({
            operationId: operationId('global-replay-id'),
        });
        first.close();
        const second = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        expect(
            second.enqueueOperation(operation('global-replay-id', 'status')),
        ).toEqual({
            allowed: false,
            reason: 'operation_id_replay',
        });
    });

    it('reserves queue capacity for cancel/protection and reconciliation/status', () => {
        let monotonic = 0;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 8,
            safetyReservedCapacity: 3,
            reconciliationReservedCapacity: 1,
            maxTerminalRecords: 32,
        });

        for (let index = 0; index < 5; index += 1) {
            expect(
                coordinator.enqueueOperation(
                    operation(`exposure-${index}`, 'new_exposure'),
                ),
            ).toMatchObject({ allowed: true });
        }
        expect(
            coordinator.enqueueOperation(
                operation('exposure-overflow', 'new_exposure'),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'safety_capacity_reserved',
        });

        for (const [operationId, kind] of [
            ['cancel-1', 'user_confirmed_cancel'],
            ['protect-1', 'reduce_only_protection'],
        ]) {
            expect(
                coordinator.enqueueOperation(operation(operationId, kind)),
            ).toMatchObject({ allowed: true });
        }
        expect(
            coordinator.enqueueOperation(
                operation('cancel-overflow', 'user_confirmed_cancel'),
            ),
        ).toMatchObject({
            allowed: false,
            reason: 'reconciliation_capacity_reserved',
        });
        expect(
            coordinator.enqueueOperation(
                operation('reconcile-final-slot', 'reconciliation'),
            ),
        ).toMatchObject({ allowed: true });
        expect(
            coordinator.enqueueOperation(
                operation('status-overflow', 'status'),
            ),
        ).toMatchObject({ allowed: false, reason: 'broker_queue_full' });
        expect(coordinator.status()).toMatchObject({
            queueDepth: 8,
            queueDepthByPriority: {
                reconciliation_status: 1,
                cancel_protection: 2,
                new_exposure: 5,
            },
        });
        monotonic += 1;
    });

    it('uses weighted safety priority while guaranteeing progress for new exposure', () => {
        let monotonic = 0;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 16,
            safetyReservedCapacity: 4,
            reconciliationReservedCapacity: 2,
            maxTerminalRecords: 64,
        });
        for (let index = 0; index < 4; index += 1) {
            coordinator.enqueueOperation(
                operation(`reconcile-${index}`, 'reconciliation'),
            );
        }
        coordinator.enqueueOperation(
            operation('cancel-1', 'user_confirmed_cancel'),
        );
        coordinator.enqueueOperation(
            operation('protect-1', 'reduce_only_protection'),
        );
        coordinator.enqueueOperation(operation('exposure-1', 'new_exposure'));

        const sequence = [];
        for (let index = 0; index < 7; index += 1) {
            const grant = coordinator.takeNextOperation();
            expect(grant.allowed).toBe(true);
            sequence.push(grant.operationId);
            expect(grant).toMatchObject({
                schedulerGrantOnly: true,
                brokerAuthority: false,
                operationBucketMode: 'conservative_common_unclassified',
            });
            completeGrant(coordinator, grant);
            monotonic += 1_001;
        }
        expect(sequence).toEqual([
            operationId('reconcile-0'),
            operationId('reconcile-1'),
            operationId('reconcile-2'),
            operationId('reconcile-3'),
            operationId('cancel-1'),
            operationId('protect-1'),
            operationId('exposure-1'),
        ]);
    });

    it.each([
        { maxQueued: 8, safety: 3, reconciliation: 1 },
        { maxQueued: 16, safety: 6, reconciliation: 2 },
        { maxQueued: 32, safety: 10, reconciliation: 4 },
    ])(
        'preserves reserved-capacity invariants for maxQueued=$maxQueued',
        ({ maxQueued, safety, reconciliation }) => {
            const coordinator = createSmartOrderResourceCoordinator({
                nowMonotonicMs: () => 0,
                maxQueued,
                safetyReservedCapacity: safety,
                reconciliationReservedCapacity: reconciliation,
                maxTerminalRecords: maxQueued * 2,
            });
            let exposureCount = 0;
            for (let index = 0; index < maxQueued * 2; index += 1) {
                const result = coordinator.enqueueOperation(
                    operation(`exposure-${index}`, 'new_exposure'),
                );
                if (!result.allowed) break;
                exposureCount += 1;
            }
            expect(exposureCount).toBe(maxQueued - safety);

            let cancelCount = 0;
            for (let index = 0; index < maxQueued * 2; index += 1) {
                const result = coordinator.enqueueOperation(
                    operation(`cancel-${index}`, 'user_confirmed_cancel'),
                );
                if (!result.allowed) break;
                cancelCount += 1;
            }
            expect(exposureCount + cancelCount).toBe(
                maxQueued - reconciliation,
            );

            let reconciliationCount = 0;
            for (let index = 0; index < maxQueued * 2; index += 1) {
                const result = coordinator.enqueueOperation(
                    operation(`reconciliation-${index}`, 'reconciliation'),
                );
                if (!result.allowed) break;
                reconciliationCount += 1;
            }
            expect(
                exposureCount + cancelCount + reconciliationCount,
            ).toBe(maxQueued);
        },
    );

    it('bounds scheduler grants to one in-flight operation by default', () => {
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => 0,
            maxQueued: 8,
            safetyReservedCapacity: 3,
            reconciliationReservedCapacity: 1,
            maxTerminalRecords: 32,
        });
        coordinator.enqueueOperation(operation('status-1', 'status'));
        coordinator.enqueueOperation(operation('status-2', 'status'));
        expect(coordinator.takeNextOperation()).toMatchObject({
            allowed: true,
            operationId: operationId('status-1'),
        });
        expect(coordinator.takeNextOperation()).toEqual({
            allowed: false,
            reason: 'broker_operation_in_flight',
        });
        coordinator.completeOperation({ operationId: operationId('status-1') });
        expect(coordinator.takeNextOperation()).toMatchObject({
            allowed: true,
            operationId: operationId('status-2'),
        });
    });

    it('does not starve new exposure under a continuously replenished reconciliation queue', () => {
        let monotonic = 0;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 16,
            safetyReservedCapacity: 4,
            reconciliationReservedCapacity: 2,
            maxTerminalRecords: 64,
        });
        coordinator.enqueueOperation(operation('exposure', 'new_exposure'));
        for (let index = 0; index < 8; index += 1) {
            coordinator.enqueueOperation(
                operation(`reconcile-${index}`, 'reconciliation'),
            );
        }

        const firstFive = [];
        for (let index = 0; index < 5; index += 1) {
            const grant = coordinator.takeNextOperation();
            firstFive.push(grant.operationId);
            completeGrant(coordinator, grant);
            if (grant.operationId !== operationId('exposure')) {
                coordinator.enqueueOperation(
                    operation(`replenished-${index}`, 'reconciliation'),
                );
            }
            monotonic += 1_001;
        }
        expect(
            firstFive
                .slice(0, 4)
                .every((id) => id.endsWith(':reconcile-0') || id.includes(':reconcile-')),
        ).toBe(true);
        expect(firstFive).toContain(operationId('exposure'));
    });

    it('never accepts a caller bucket hint and enforces a common rolling <=5/s limiter', async () => {
        let monotonic = 0;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 128,
            safetyReservedCapacity: 8,
            reconciliationReservedCapacity: 4,
            maxTerminalRecords: 256,
        });
        expect(
            coordinator.enqueueOperation({
                ...operation('forged-bucket', 'status'),
                operationBucket: 'orders_250_per_10_seconds',
            }),
        ).toEqual({ allowed: false, reason: 'operation_schema_invalid' });

        for (let index = 0; index < 100; index += 1) {
            expect(
                coordinator.enqueueOperation(
                    operation(`status-${index}`, 'status'),
                ),
            ).toMatchObject({ allowed: true });
        }
        const grantTimes = [];
        while (grantTimes.length < 100) {
            const grant = coordinator.takeNextOperation();
            if (!grant.allowed) {
                expect(grant.reason).toBe('common_operation_rate_limited');
                monotonic += grant.retryAfterMs;
                continue;
            }
            grantTimes.push(monotonic);
            await coordinator.acquireOperationUnit({
                operationId: grant.operationId,
            });
            completeGrant(coordinator, grant);
        }
        for (
            let index = SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND;
            index < grantTimes.length;
            index += 1
        ) {
            expect(
                grantTimes[index] -
                    grantTimes[
                        index - SMART_ORDER_COMMON_OPERATION_RATE_PER_SECOND
                    ],
            ).toBeGreaterThan(1_000);
        }
        expect(coordinator.status()).toMatchObject({
            operationBucketMode: 'conservative_common_unclassified',
            operationRateLimitPerSecond: 5,
            writeMasterAuthority: false,
        });
    });
});

describe('task 5.10 timeout and retry boundary', () => {
    it('bounds proven-unsent retry but converts possible broker bytes to unknown with no retry', () => {
        let monotonic = 0;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 8,
            safetyReservedCapacity: 3,
            reconciliationReservedCapacity: 1,
            maxRetries: 2,
            retryBaseDelayMs: 100,
            retryMaximumDelayMs: 400,
            maxTerminalRecords: 32,
        });
        coordinator.enqueueOperation(operation('write-1', 'new_exposure'));
        expect(coordinator.takeNextOperation()).toMatchObject({
            allowed: true,
            operationId: operationId('write-1'),
            attempt: 0,
        });
        expect(
            coordinator.handleOperationFailure({
                operationId: operationId('write-1'),
                deliveryState: 'proven_unsent',
                failure: 'timeout',
            }),
        ).toEqual({
            allowed: false,
            reason: 'operation_failure_schema_invalid',
        });
        expect(
            coordinator.handleOperationFailure({
                operationId: operationId('write-1'),
                failure: 'timeout',
            }),
        ).toMatchObject({
            allowed: true,
            action: 'bounded_backoff',
            retry: true,
            attempt: 1,
            delayMs: 100,
        });
        monotonic = 99;
        expect(coordinator.takeNextOperation()).toMatchObject({
            allowed: false,
            reason: 'bounded_backoff_pending',
        });
        monotonic = 100;
        expect(coordinator.takeNextOperation()).toMatchObject({
            allowed: true,
            operationId: operationId('write-1'),
            attempt: 1,
        });
        expect(
            coordinator.markOperationDispatching({
                operationId: operationId('write-1'),
            }),
        ).toMatchObject({
            allowed: true,
            state: 'dispatching_bytes_possible',
            brokerAuthority: false,
        });
        expect(
            coordinator.handleOperationFailure({
                operationId: operationId('write-1'),
                failure: 'connection_error',
            }),
        ).toEqual({
            allowed: true,
            action: 'mark_unknown_reconcile',
            retry: false,
            reason: 'broker_bytes_possible_no_retry',
            brokerAuthority: false,
        });
        expect(
            coordinator.enqueueOperation(operation('write-1', 'new_exposure')),
        ).toMatchObject({ allowed: false, reason: 'operation_id_replay' });
    });

    it('marks possible broker bytes unknown even after monotonic clock regression', () => {
        let monotonic = 50_000;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        coordinator.enqueueOperation(
            operation('write-clock-regression', 'new_exposure'),
        );
        expect(coordinator.takeNextOperation()).toMatchObject({ allowed: true });
        expect(
            coordinator.markOperationDispatching({
                operationId: operationId('write-clock-regression'),
            }),
        ).toMatchObject({ allowed: true });
        monotonic -= 1;
        expect(
            coordinator.handleOperationFailure({
                operationId: operationId('write-clock-regression'),
                failure: 'connection_error',
            }),
        ).toEqual({
            allowed: true,
            action: 'mark_unknown_reconcile',
            retry: false,
            reason: 'broker_bytes_possible_no_retry',
            brokerAuthority: false,
        });
        expect(coordinator.status()).toMatchObject({
            clockInvalid: true,
            inFlight: 0,
        });
    });

    it('allows only bounded read-only backoff and fails closed after exhaustion', () => {
        let monotonic = 0;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 8,
            safetyReservedCapacity: 3,
            reconciliationReservedCapacity: 1,
            maxRetries: 2,
            retryBaseDelayMs: 10,
            retryMaximumDelayMs: 20,
            maxTerminalRecords: 32,
        });
        coordinator.enqueueOperation(operation('read-1', 'reconciliation'));
        for (const expected of [
            { attempt: 1, delayMs: 10 },
            { attempt: 2, delayMs: 20 },
        ]) {
            const grant = coordinator.takeNextOperation();
            expect(grant.allowed).toBe(true);
            const retry = coordinator.handleOperationFailure({
                operationId: operationId('read-1'),
                failure: 'timeout',
            });
            expect(retry).toMatchObject({
                action: 'bounded_backoff',
                retry: true,
                ...expected,
            });
            monotonic += expected.delayMs;
        }
        expect(coordinator.takeNextOperation()).toMatchObject({
            allowed: true,
            attempt: 2,
        });
        expect(
            coordinator.handleOperationFailure({
                operationId: operationId('read-1'),
                failure: 'timeout',
            }),
        ).toMatchObject({
            allowed: true,
            action: 'retry_exhausted',
            retry: false,
        });
    });

    it('latches a regressed monotonic clock and never grants queued work afterward', () => {
        let monotonic = 10;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 8,
            safetyReservedCapacity: 3,
            reconciliationReservedCapacity: 1,
            maxTerminalRecords: 32,
        });
        expect(
            coordinator.enqueueOperation(operation('read-1', 'status')),
        ).toMatchObject({ allowed: true });
        monotonic = 9;
        expect(coordinator.takeNextOperation()).toEqual({
            allowed: false,
            reason: 'resource_clock_invalid',
        });
        monotonic = 11;
        expect(coordinator.takeNextOperation()).toEqual({
            allowed: false,
            reason: 'resource_clock_invalid',
        });
        expect(coordinator.status()).toMatchObject({
            clockInvalid: true,
            brokerAuthority: false,
        });
    });

    it('keeps the replay registry bounded without permanently exhausting a long-running Runtime', () => {
        let monotonic = 0;
        const coordinator = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
            maxQueued: 4,
            safetyReservedCapacity: 2,
            reconciliationReservedCapacity: 1,
            maxTerminalRecords: 4,
        });
        for (let index = 0; index < 12; index += 1) {
            const enqueued = coordinator.enqueueOperation(
                operation(`bounded-terminal-${index}`, 'status'),
            );
            expect(enqueued.allowed).toBe(true);
            const grant = coordinator.takeNextOperation();
            expect(grant.allowed).toBe(true);
            expect(coordinator.completeOperation({
                operationId: grant.operationId,
            }).allowed).toBe(true);
            monotonic += 1_001;
        }
        expect(coordinator.status()).toMatchObject({
            terminalRecords: 4,
            closed: false,
        });
    });

    it('never retries a dispatching operation on close but releases the scheduler for reconciliation', () => {
        let monotonic = 0;
        const first = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        expect(
            first.enqueueOperation(operation('closing-write', 'new_exposure')),
        ).toMatchObject({ allowed: true });
        const writeGrant = first.takeNextOperation();
        expect(writeGrant.allowed).toBe(true);
        expect(
            first.markOperationDispatching({
                operationId: writeGrant.operationId,
            }),
        ).toMatchObject({ state: 'dispatching_bytes_possible' });
        first.close();

        const replacement = createSmartOrderResourceCoordinator({
            nowMonotonicMs: () => monotonic,
        });
        expect(
            replacement.enqueueOperation(
                operation('replacement-reconciliation', 'reconciliation'),
            ),
        ).toMatchObject({ allowed: true });
        expect(replacement.takeNextOperation()).toMatchObject({
            allowed: true,
            kind: 'reconciliation',
        });
    });
});
