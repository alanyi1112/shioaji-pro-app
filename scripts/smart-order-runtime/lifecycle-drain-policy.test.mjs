import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_LIFECYCLE_OPERATIONS,
    evaluateForcedLifecycleOperation,
    evaluateModeSwitchPreflight,
    evaluateProtectionObligationRelease,
    evaluateSmartOrderLifecycleDrain,
    isStrictSmartOrderLifecycleOperation,
    projectLifecycleRecovery,
    projectRuntimeTrackedUnprotectedRemainder,
    selectSmartOrderLifecycleDrainProjection,
} from './lifecycle-drain-policy.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_C = `sha256:${'c'.repeat(64)}`;

function emptyCounts(overrides = {}) {
    return {
        nonTerminalStrategies: 0,
        nonQuiescedStrategies: 0,
        nonTerminalActivations: 0,
        nonTerminalSideEffectIntents: 0,
        nonTerminalBrokerOrders: 0,
        nonTerminalProtectionCommitments: 0,
        nonTerminalProtectionObligations: 0,
        activeEntryExposureReservations: 0,
        activeExitClaims: 0,
        openResolutionCases: 0,
        openSafetyBlockers: 0,
        durableSideEffectHistory: 0,
        durableObligationHistory: 0,
        ...overrides,
    };
}

function drainInput(operation, overrides = {}) {
    return {
        operation,
        newActivationsStopped: true,
        writeMaster: 'disabled',
        currentRuntimeState: 'observe_only',
        reconciliationEvidenceHash: DIGEST_A,
        inFlightExecutionLeaseCount: 0,
        brokerResultDurability: 'no_in_flight_result',
        counts: emptyCounts(),
        ordinaryUnmanagedPositionShares: 0,
        runtimeTrackedUnprotectedRemainder: {
            state: 'known',
            shares: 0,
            conservativeMaximumShares: 0,
        },
        ...overrides,
    };
}

function releaseInput(path, overrides = {}) {
    return {
        path,
        entryTerminal: true,
        filledShares: 0,
        confirmedExitedShares: 0,
        positionShares: 0,
        brokerEvidenceHash: DIGEST_A,
        accountReconciliationEvidenceHash: DIGEST_B,
        resources: {
            activeEntryReservationCount: 1,
            activeExitClaimCount: 0,
            atomicReleasePrepared: true,
        },
        breakGlass: {
            confirmationEvidenceHashes: [],
            handoffSnapshotHash: null,
            unmonitoredAuditHash: null,
            operatorAcknowledgedManualHandoff: false,
        },
        ...overrides,
    };
}

function modeInput(overrides = {}) {
    return {
        lifecycleDrainAllowed: true,
        modeMarker: {
            state: 'known_private',
            mode: 'simulation',
            apiGeneration: 'simulation:generation-1',
        },
        apiInfo: {
            state: 'current',
            simulation: true,
            apiGeneration: 'simulation:generation-1',
        },
        expectedApiGeneration: 'simulation:generation-1',
        inFlightExecutionLeaseCount: 0,
        brokerResultDurability:
            'durable_acknowledged_or_terminal_or_unknown',
        exclusiveModeLeaseState: 'acquired_after_shared_drain',
        unmanagedApiListenerDetected: false,
        ...overrides,
    };
}

describe('smart-order lifecycle drain policy', () => {
    it('classifies stop, rollback, feature-off and uninstall as strict drains', () => {
        expect(SMART_ORDER_LIFECYCLE_OPERATIONS).toEqual([
            'graceful_stop',
            'production_readonly',
            'rollback',
            'feature_off',
            'uninstall',
        ]);
        for (const operation of [
            'graceful_stop',
            'rollback',
            'feature_off',
            'uninstall',
        ]) {
            expect(isStrictSmartOrderLifecycleOperation(operation)).toBe(true);
            expect(
                evaluateSmartOrderLifecycleDrain(drainInput(operation)),
            ).toMatchObject({
                allowed: true,
                policyClass: 'strict_no_non_terminal_strategy',
            });
        }
        expect(isStrictSmartOrderLifecycleOperation('production_readonly')).toBe(
            false,
        );
        expect(() =>
            isStrictSmartOrderLifecycleOperation('mode_switch'),
        ).toThrow('not supported');
    });

    it('selects one repository projection without letting new operations invent a relaxed drain', () => {
        const lifecycle = {
            productionReadonlyDrainAllowed: true,
            productionReadonlyBlockerCount: 0,
            gracefulStopAllowed: false,
            gracefulStopBlockerCount: 2,
            uninstallAllowed: false,
            uninstallBlockerCount: 3,
        };
        expect(
            selectSmartOrderLifecycleDrainProjection(
                lifecycle,
                'production_readonly',
            ),
        ).toMatchObject({ allowed: true, blockerCount: 0 });
        for (const operation of [
            'graceful_stop',
            'rollback',
            'feature_off',
        ]) {
            expect(
                selectSmartOrderLifecycleDrainProjection(
                    lifecycle,
                    operation,
                ),
            ).toMatchObject({
                allowed: false,
                blockerCount: 2,
                policyClass: 'strict_no_non_terminal_strategy',
            });
        }
        expect(
            selectSmartOrderLifecycleDrainProjection(lifecycle, 'uninstall'),
        ).toMatchObject({ allowed: false, blockerCount: 3 });
        expect(() =>
            selectSmartOrderLifecycleDrainProjection(
                {
                    ...lifecycle,
                    gracefulStopAllowed: true,
                },
                'rollback',
            ),
        ).toThrow('projection is inconsistent');
    });

    it.each([
        ['nonTerminalStrategies', 'non_terminal_strategy'],
        ['nonTerminalActivations', 'non_terminal_activation'],
        [
            'nonTerminalSideEffectIntents',
            'non_terminal_side_effect_intent',
        ],
        ['nonTerminalBrokerOrders', 'non_terminal_broker_order'],
        [
            'nonTerminalProtectionCommitments',
            'non_terminal_protection_commitment',
        ],
        [
            'nonTerminalProtectionObligations',
            'non_terminal_protection_obligation',
        ],
        [
            'activeEntryExposureReservations',
            'active_entry_exposure_reservation',
        ],
        ['activeExitClaims', 'active_exit_claim'],
        ['openResolutionCases', 'open_resolution_case'],
        ['openSafetyBlockers', 'open_safety_blocker'],
    ])('blocks strict drain for %s', (key, code) => {
        const decision = evaluateSmartOrderLifecycleDrain(
            drainInput('uninstall', {
                counts: emptyCounts({ [key]: 1 }),
            }),
        );
        expect(decision).toMatchObject({ allowed: false });
        expect(decision.blockers).toContainEqual({ code, count: 1 });
    });

    it('allows only production-readonly to retain a quiesced zero-obligation strategy', () => {
        const counts = emptyCounts({
            nonTerminalStrategies: 1,
            nonQuiescedStrategies: 0,
        });
        expect(
            evaluateSmartOrderLifecycleDrain(
                drainInput('production_readonly', { counts }),
            ),
        ).toMatchObject({ allowed: true });
        for (const operation of [
            'graceful_stop',
            'rollback',
            'feature_off',
            'uninstall',
        ]) {
            expect(
                evaluateSmartOrderLifecycleDrain(
                    drainInput(operation, { counts }),
                ),
            ).toMatchObject({
                allowed: false,
                blockers: [{ code: 'non_terminal_strategy', count: 1 }],
            });
        }
    });

    it('blocks pending-submit/reconciling equivalents, in-flight leases, memory-only ack and unknown remainder', () => {
        const decision = evaluateSmartOrderLifecycleDrain(
            drainInput('uninstall', {
                inFlightExecutionLeaseCount: 1,
                brokerResultDurability: 'broker_ack_memory_only',
                counts: emptyCounts({
                    nonTerminalSideEffectIntents: 1,
                    nonTerminalBrokerOrders: 1,
                    durableSideEffectHistory: 2,
                }),
                runtimeTrackedUnprotectedRemainder: {
                    state: 'unknown',
                    shares: null,
                    conservativeMaximumShares: 1_000,
                },
            }),
        );
        expect(decision.allowed).toBe(false);
        expect(decision.blockers).toEqual(
            expect.arrayContaining([
                { code: 'in_flight_execution_lease', count: 1 },
                { code: 'broker_result_not_durable', count: 1 },
                { code: 'non_terminal_side_effect_intent', count: 1 },
                { code: 'non_terminal_broker_order', count: 1 },
                { code: 'runtime_tracked_unprotected_remainder', count: 1 },
            ]),
        );
        expect(decision).toMatchObject({
            forcedOperationAuthorized: false,
            brokerOutcomeInferred: false,
        });
    });

    it('requires current reconciliation after any durable side-effect or obligation history', () => {
        expect(
            evaluateSmartOrderLifecycleDrain(
                drainInput('graceful_stop', {
                    currentRuntimeState: 'reconciling',
                    reconciliationEvidenceHash: null,
                    counts: emptyCounts({ durableSideEffectHistory: 1 }),
                }),
            ),
        ).toMatchObject({
            allowed: false,
            reconciliationAllowsDrain: false,
            blockers: [
                { code: 'current_reconciliation_required', count: 1 },
            ],
        });
        expect(
            evaluateSmartOrderLifecycleDrain(
                drainInput('graceful_stop', {
                    currentRuntimeState: 'reconciling',
                    reconciliationEvidenceHash: null,
                }),
            ),
        ).toMatchObject({ allowed: true, reconciliationAllowsDrain: true });
    });

    it('does not confuse a conservative maximum with a known zero remainder', () => {
        expect(
            evaluateSmartOrderLifecycleDrain(
                drainInput('graceful_stop', {
                    runtimeTrackedUnprotectedRemainder: {
                        state: 'known',
                        shares: 0,
                        conservativeMaximumShares: 1_000,
                    },
                }),
            ),
        ).toMatchObject({ allowed: true, blockers: [] });
    });

    it('does not treat an ordinary position without a Runtime obligation as a lifecycle blocker', () => {
        expect(
            evaluateSmartOrderLifecycleDrain(
                drainInput('uninstall', {
                    ordinaryUnmanagedPositionShares: 25_000,
                }),
            ),
        ).toMatchObject({
            allowed: true,
            blockers: [],
            ordinaryUnmanagedPositionsBlockDrain: false,
        });
    });

    it('blocks new activations or an enabled write master without hiding the input state', () => {
        expect(
            evaluateSmartOrderLifecycleDrain(
                drainInput('graceful_stop', {
                    newActivationsStopped: false,
                    writeMaster: 'enabled',
                }),
            ),
        ).toMatchObject({
            allowed: false,
            writeMaster: 'enabled',
            blockers: [
                { code: 'new_activations_not_stopped', count: 1 },
                { code: 'write_master_not_disabled', count: 1 },
            ],
        });
    });
});

describe('RuntimeTrackedUnprotectedRemainder projection', () => {
    it('counts each fresh ExitClaim lineage once across duplicate representations', () => {
        const claim = {
            lineageHash: DIGEST_A,
            state: 'monitoring_reserved',
            quantityShares: 600,
            runtimeMonitoringFresh: true,
            brokerWorkingUniquelyReconciled: false,
        };
        expect(
            projectRuntimeTrackedUnprotectedRemainder({
                filledShares: 1_000,
                confirmedExitedShares: 100,
                runtimeReadinessFresh: true,
                accountReconciliationEvidenceHash: DIGEST_B,
                claims: [claim, { ...claim }],
            }),
        ).toEqual({
            schemaVersion:
                'smart-order-lifecycle-drain-policy/2026-08-12.1',
            state: 'known',
            shares: 300,
            conservativeMaximumShares: 900,
            activelyCoveredShares: 600,
            distinctExitClaimLineageCount: 1,
            representationDoubleCounted: false,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        });
    });

    it('does not count stale monitoring or unconfirmed broker-working claims as covered', () => {
        expect(
            projectRuntimeTrackedUnprotectedRemainder({
                filledShares: 1_000,
                confirmedExitedShares: 200,
                runtimeReadinessFresh: false,
                accountReconciliationEvidenceHash: null,
                claims: [
                    {
                        lineageHash: DIGEST_A,
                        state: 'monitoring_reserved',
                        quantityShares: 300,
                        runtimeMonitoringFresh: false,
                        brokerWorkingUniquelyReconciled: false,
                    },
                    {
                        lineageHash: DIGEST_B,
                        state: 'broker_working',
                        quantityShares: 300,
                        runtimeMonitoringFresh: false,
                        brokerWorkingUniquelyReconciled: false,
                    },
                ],
            }),
        ).toMatchObject({
            state: 'known',
            shares: 800,
            activelyCoveredShares: 0,
        });
    });

    it('returns unknown for an unknown claim or conflicting same-lineage representation', () => {
        for (const claims of [
            [
                {
                    lineageHash: DIGEST_A,
                    state: 'unknown',
                    quantityShares: 400,
                    runtimeMonitoringFresh: false,
                    brokerWorkingUniquelyReconciled: false,
                },
            ],
            [
                {
                    lineageHash: DIGEST_A,
                    state: 'monitoring_reserved',
                    quantityShares: 400,
                    runtimeMonitoringFresh: true,
                    brokerWorkingUniquelyReconciled: false,
                },
                {
                    lineageHash: DIGEST_A,
                    state: 'broker_working',
                    quantityShares: 400,
                    runtimeMonitoringFresh: false,
                    brokerWorkingUniquelyReconciled: true,
                },
            ],
        ]) {
            expect(
                projectRuntimeTrackedUnprotectedRemainder({
                    filledShares: 1_000,
                    confirmedExitedShares: 0,
                    runtimeReadinessFresh: true,
                    accountReconciliationEvidenceHash: DIGEST_B,
                    claims,
                }),
            ).toMatchObject({
                state: 'unknown',
                shares: null,
                conservativeMaximumShares: 1_000,
                activelyCoveredShares: null,
            });
        }
    });
});

describe('protection obligation terminal/release paths', () => {
    it('allows true zero-fill only with terminal entry, current broker evidence and no ExitClaim', () => {
        expect(
            evaluateProtectionObligationRelease(releaseInput('zero_fill')),
        ).toMatchObject({
            allowed: true,
            targetObligationState: 'zero_fill_terminal',
            targetCommitmentState: 'zero_fill_terminal',
            unmonitored: false,
            originalIntentRedispatchAllowed: false,
        });
        expect(
            evaluateProtectionObligationRelease(
                releaseInput('zero_fill', { filledShares: 1 }),
            ),
        ).toMatchObject({ allowed: false, reasonCode: 'not_true_zero_fill' });
    });

    it('allows broker-confirmed full exit or current account-scoped position-zero, never zero-fill laundering', () => {
        expect(
            evaluateProtectionObligationRelease(
                releaseInput('confirmed_exit_or_position_zero', {
                    filledShares: 1_000,
                    confirmedExitedShares: 1_000,
                }),
            ),
        ).toMatchObject({
            allowed: true,
            targetObligationState: 'fulfilled',
            targetCommitmentState: 'materialized',
            unmonitored: false,
        });
        expect(
            evaluateProtectionObligationRelease(
                releaseInput('confirmed_exit_or_position_zero', {
                    filledShares: 1_000,
                    confirmedExitedShares: 400,
                    positionShares: 0,
                }),
            ),
        ).toMatchObject({ allowed: true, brokerOutcomeInferred: false });
        expect(
            evaluateProtectionObligationRelease(
                releaseInput('confirmed_exit_or_position_zero'),
            ),
        ).toMatchObject({
            allowed: false,
            reasonCode: 'zero_fill_must_use_zero_fill_path',
        });
        expect(
            evaluateProtectionObligationRelease(
                releaseInput('confirmed_exit_or_position_zero', {
                    entryTerminal: false,
                    filledShares: 1_000,
                    confirmedExitedShares: 1_000,
                }),
            ),
        ).toMatchObject({
            allowed: false,
            reasonCode: 'entry_not_terminal',
        });
    });

    it('requires two confirmations, handoff snapshot and unmonitored audit for break-glass relinquishment', () => {
        const base = releaseInput('break_glass_relinquish', {
            filledShares: 1_000,
            confirmedExitedShares: 0,
            positionShares: 1_000,
            brokerEvidenceHash: null,
            accountReconciliationEvidenceHash: null,
        });
        expect(evaluateProtectionObligationRelease(base)).toMatchObject({
            allowed: false,
            reasonCode:
                'break_glass_second_confirmation_or_snapshot_missing',
        });
        expect(
            evaluateProtectionObligationRelease({
                ...base,
                breakGlass: {
                    confirmationEvidenceHashes: [DIGEST_A, DIGEST_B],
                    handoffSnapshotHash: DIGEST_B,
                    unmonitoredAuditHash: DIGEST_C,
                    operatorAcknowledgedManualHandoff: true,
                },
            }),
        ).toMatchObject({
            allowed: true,
            targetObligationState: 'released_manual',
            targetCommitmentState: 'released_manual',
            unmonitored: true,
            brokerOutcomeInferred: false,
            originalIntentRedispatchAllowed: false,
        });
    });

    it('rejects duplicate break-glass confirmation evidence', () => {
        expect(
            evaluateProtectionObligationRelease(
                releaseInput('break_glass_relinquish', {
                    breakGlass: {
                        confirmationEvidenceHashes: [DIGEST_A, DIGEST_A],
                        handoffSnapshotHash: DIGEST_B,
                        unmonitoredAuditHash: DIGEST_C,
                        operatorAcknowledgedManualHandoff: true,
                    },
                }),
            ),
        ).toMatchObject({
            allowed: false,
            reasonCode:
                'break_glass_second_confirmation_or_snapshot_missing',
        });
    });

    it('does not mix break-glass evidence into a broker-confirmed release path', () => {
        expect(() =>
            evaluateProtectionObligationRelease(
                releaseInput('confirmed_exit_or_position_zero', {
                    filledShares: 1_000,
                    confirmedExitedShares: 1_000,
                    breakGlass: {
                        confirmationEvidenceHashes: [DIGEST_A, DIGEST_B],
                        handoffSnapshotHash: DIGEST_B,
                        unmonitoredAuditHash: DIGEST_C,
                        operatorAcknowledgedManualHandoff: true,
                    },
                }),
            ),
        ).toThrow('break-glass evidence is not valid');
    });

    it('never releases active reservation/claim without one atomic release transaction', () => {
        expect(
            evaluateProtectionObligationRelease(
                releaseInput('confirmed_exit_or_position_zero', {
                    filledShares: 1_000,
                    confirmedExitedShares: 1_000,
                    resources: {
                        activeEntryReservationCount: 1,
                        activeExitClaimCount: 1,
                        atomicReleasePrepared: false,
                    },
                }),
            ),
        ).toMatchObject({
            allowed: false,
            reasonCode: 'atomic_reservation_claim_release_not_prepared',
        });
    });
});

describe('forced lifecycle handoff', () => {
    const forcedInput = (overrides = {}) => ({
        operation: 'uninstall',
        affectedItemCount: 2,
        consistentSnapshotHash: DIGEST_A,
        confirmationEvidenceHashes: [DIGEST_B, DIGEST_C],
        unmonitoredAuditItemCount: 2,
        unmonitoredAuditHash: DIGEST_C,
        operatorAcknowledgedManualBrokerHandling: true,
        ...overrides,
    });

    it('requires a consistent snapshot, two distinct confirmations and one unmonitored audit per affected item', () => {
        expect(evaluateForcedLifecycleOperation(forcedInput())).toMatchObject({
            allowed: true,
            affectedItemCount: 2,
            markEveryAffectedItemUnmonitored: true,
            protectionObligationsReleased: false,
            separateRelinquishmentRequired: true,
            brokerOutcomeInferred: false,
            originalIntentRedispatchAllowed: false,
        });
        expect(
            evaluateForcedLifecycleOperation(
                forcedInput({
                    unmonitoredAuditItemCount: 1,
                    operatorAcknowledgedManualBrokerHandling: false,
                }),
            ),
        ).toMatchObject({
            allowed: false,
            markEveryAffectedItemUnmonitored: false,
            blockers: expect.arrayContaining([
                {
                    code: 'unmonitored_audit_does_not_cover_every_item',
                    count: 1,
                },
                {
                    code: 'manual_broker_handling_not_acknowledged',
                    count: 1,
                },
            ]),
        });
    });

    it('does not accept duplicate forced-operation confirmations', () => {
        expect(
            evaluateForcedLifecycleOperation(
                forcedInput({
                    confirmationEvidenceHashes: [DIGEST_B, DIGEST_B],
                }),
            ),
        ).toMatchObject({
            allowed: false,
            blockers: [
                { code: 'two_distinct_confirmations_required', count: 1 },
            ],
        });
    });
});

describe('mode switch and recovery fault policy', () => {
    it('permits preflight only after shared leases drain and broker ack/unknown is durable', () => {
        expect(evaluateModeSwitchPreflight(modeInput())).toMatchObject({
            allowed: true,
            markerChanged: false,
            apiGenerationChanged: false,
            brokerWriteWithdrawn: false,
        });
        expect(
            evaluateModeSwitchPreflight(
                modeInput({
                    inFlightExecutionLeaseCount: 1,
                    brokerResultDurability: 'broker_ack_memory_only',
                    exclusiveModeLeaseState: 'waiting_for_shared_drain',
                }),
            ).blockers,
        ).toEqual(
            expect.arrayContaining([
                { code: 'in_flight_execution_lease', count: 1 },
                { code: 'broker_ack_or_unknown_not_durable', count: 1 },
                { code: 'exclusive_mode_lease_not_acquired', count: 1 },
            ]),
        );
    });

    it.each([
        [
            { state: 'missing', mode: null, apiGeneration: null },
            { state: 'current', simulation: true, apiGeneration: 'simulation:generation-1' },
            'mode_marker_unknown_or_untrusted',
        ],
        [
            { state: 'known_private', mode: 'simulation', apiGeneration: 'simulation:generation-1' },
            { state: 'timeout', simulation: null, apiGeneration: null },
            'api_info_timeout_unknown_or_invalid',
        ],
        [
            { state: 'known_private', mode: 'simulation', apiGeneration: 'simulation:generation-1' },
            { state: 'current', simulation: false, apiGeneration: 'simulation:generation-1' },
            'api_info_not_simulation',
        ],
        [
            { state: 'known_private', mode: 'simulation', apiGeneration: 'simulation:generation-1' },
            { state: 'current', simulation: true, apiGeneration: 'simulation:generation-2' },
            'api_generation_mismatch',
        ],
    ])('fails closed for marker/info/generation fault', (modeMarker, apiInfo, code) => {
        const decision = evaluateModeSwitchPreflight(
            modeInput({ modeMarker, apiInfo }),
        );
        expect(decision.allowed).toBe(false);
        expect(decision.blockers).toContainEqual({ code, count: 1 });
        expect(decision).toMatchObject({
            markerChanged: false,
            apiGenerationChanged: false,
            brokerOutcomeInferred: false,
        });
    });

    it.each([
        ['watchdog_restart', true],
        ['api_generation_change', false],
        ['relogin', true],
        ['simulation_return', false],
        ['runtime_upgrade', false],
        ['migration', false],
    ])('keeps %s observe-only and requires explicit resume+arm', (reason, accountSessionRevisionChanged) => {
        const recovery = projectLifecycleRecovery({
            reason,
            previousApiGeneration: 'simulation:generation-1',
            currentApiGeneration: 'simulation:generation-2',
            accountSessionRevisionChanged,
            reconciliationComplete: true,
            subscriptionsRebuilt: true,
            userResumeConfirmed: true,
            strategyArmed: true,
        });
        expect(recovery).toMatchObject({
            state: 'observe_only',
            previousFenceValid: false,
            dispatchAllowed: false,
            automaticResumeAllowed: false,
            automaticPreparedIntentDispatchAllowed: false,
            userResumeAndArmRequired: true,
        });
    });

    it('keeps relogin reconciling until orders/positions/subscriptions are rebuilt', () => {
        expect(
            projectLifecycleRecovery({
                reason: 'relogin',
                previousApiGeneration: 'simulation:generation-1',
                currentApiGeneration: 'simulation:generation-1',
                accountSessionRevisionChanged: true,
                reconciliationComplete: false,
                subscriptionsRebuilt: false,
                userResumeConfirmed: false,
                strategyArmed: false,
            }),
        ).toMatchObject({
            state: 'reconciling',
            dispatchAllowed: false,
            reconciliationRequired: true,
            subscriptionRebuildRequired: true,
        });
    });
});
