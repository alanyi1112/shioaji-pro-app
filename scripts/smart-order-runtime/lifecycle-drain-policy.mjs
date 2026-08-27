import { createHash } from 'node:crypto';

export const SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION =
    'smart-order-lifecycle-drain-policy/2026-08-12.1';

export const SMART_ORDER_LIFECYCLE_OPERATIONS = Object.freeze([
    'graceful_stop',
    'production_readonly',
    'rollback',
    'feature_off',
    'uninstall',
]);

export const SMART_ORDER_STRICT_DRAIN_OPERATIONS = Object.freeze([
    'graceful_stop',
    'rollback',
    'feature_off',
    'uninstall',
]);

const lifecycleOperations = new Set(SMART_ORDER_LIFECYCLE_OPERATIONS);
const strictDrainOperations = new Set(SMART_ORDER_STRICT_DRAIN_OPERATIONS);
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const terminalClaimStates = new Set(['consumed', 'released']);
const runtimeMonitoredClaimStates = new Set([
    'monitoring_reserved',
    'intent_reserved',
]);
const allowedClaimStates = new Set([
    ...runtimeMonitoredClaimStates,
    'broker_working',
    'unknown',
    ...terminalClaimStates,
]);

function frozen(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) frozen(child);
    return Object.freeze(value);
}

function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value;
}

function exactKeys(value, expected, label) {
    const actual = Object.keys(record(value, label)).sort();
    const wanted = [...expected].sort();
    if (
        actual.length !== wanted.length ||
        actual.some((entry, index) => entry !== wanted[index])
    ) {
        throw new TypeError(`${label} has an invalid shape`);
    }
}

function count(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function bool(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label} must be boolean`);
    }
    return value;
}

function token(value, label) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 240 ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !sha256Pattern.test(value)) {
        throw new TypeError(`${label} must be a sha256 digest`);
    }
    return value;
}

function optionalDigest(value, label) {
    if (value === null) return null;
    return digest(value, label);
}

function normalizedConfirmationEvidence(value, label) {
    if (!Array.isArray(value) || value.length > 2) {
        throw new TypeError(`${label} must contain at most two confirmations`);
    }
    const hashes = value.map((entry, index) =>
        digest(entry, `${label}[${index}]`),
    );
    return Object.freeze({
        hashes: Object.freeze(hashes),
        completeAndDistinct:
            hashes.length === 2 && hashes[0] !== hashes[1],
    });
}

function operation(value) {
    const selected = token(value, 'lifecycle operation');
    if (!lifecycleOperations.has(selected)) {
        throw new TypeError('lifecycle operation is not supported');
    }
    return selected;
}

function sha256CanonicalParts(parts) {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(String(part));
        hash.update('\u001f');
    }
    return `sha256:${hash.digest('hex')}`;
}

export function isStrictSmartOrderLifecycleOperation(value) {
    return strictDrainOperations.has(operation(value));
}

export function selectSmartOrderLifecycleDrainProjection(
    lifecycle,
    operationValue,
) {
    const projection = record(lifecycle, 'lifecycle projection');
    const selectedOperation = operation(operationValue);
    const productionReadonlyClass =
        selectedOperation === 'production_readonly';
    const allowedKey = productionReadonlyClass
        ? 'productionReadonlyDrainAllowed'
        : selectedOperation === 'uninstall'
          ? 'uninstallAllowed'
          : 'gracefulStopAllowed';
    const blockerKey = productionReadonlyClass
        ? 'productionReadonlyBlockerCount'
        : selectedOperation === 'uninstall'
          ? 'uninstallBlockerCount'
          : 'gracefulStopBlockerCount';
    const blockerCount = count(
        projection[blockerKey],
        `lifecycle.${blockerKey}`,
    );
    const allowed = projection[allowedKey] === true;
    if (allowed !== (blockerCount === 0)) {
        throw new TypeError('lifecycle drain projection is inconsistent');
    }
    return Object.freeze({
        operation: selectedOperation,
        allowed,
        blockerCount,
        policyClass: productionReadonlyClass
            ? 'production_readonly_quiesced_strategy_exception'
            : 'strict_no_non_terminal_strategy',
    });
}

const drainCountKeys = Object.freeze([
    'nonTerminalStrategies',
    'nonQuiescedStrategies',
    'nonTerminalActivations',
    'nonTerminalSideEffectIntents',
    'nonTerminalBrokerOrders',
    'nonTerminalProtectionCommitments',
    'nonTerminalProtectionObligations',
    'activeEntryExposureReservations',
    'activeExitClaims',
    'openResolutionCases',
    'openSafetyBlockers',
    'durableSideEffectHistory',
    'durableObligationHistory',
]);

function normalizedDrainCounts(input) {
    exactKeys(input, drainCountKeys, 'lifecycle drain counts');
    return Object.freeze(
        Object.fromEntries(
            drainCountKeys.map((key) => [key, count(input[key], key)]),
        ),
    );
}

function blocker(code, quantity) {
    return Object.freeze({ code, count: quantity });
}

function appendBlocker(blockers, code, quantity) {
    if (quantity > 0) blockers.push(blocker(code, quantity));
}

/**
 * Produces a redacted, deterministic lifecycle decision. This function has no
 * authority to stop a process or release a broker obligation; it only keeps
 * every lifecycle caller on the same fail-closed predicate.
 */
export function evaluateSmartOrderLifecycleDrain(input) {
    exactKeys(
        input,
        [
            'operation',
            'newActivationsStopped',
            'writeMaster',
            'currentRuntimeState',
            'reconciliationEvidenceHash',
            'inFlightExecutionLeaseCount',
            'brokerResultDurability',
            'counts',
            'runtimeTrackedUnprotectedRemainder',
            'ordinaryUnmanagedPositionShares',
        ],
        'lifecycle drain input',
    );
    const selectedOperation = operation(input.operation);
    const strict = strictDrainOperations.has(selectedOperation);
    const newActivationsStopped = bool(
        input.newActivationsStopped,
        'newActivationsStopped',
    );
    const writeMaster = token(input.writeMaster, 'writeMaster');
    const currentRuntimeState = token(
        input.currentRuntimeState,
        'currentRuntimeState',
    );
    const reconciliationEvidenceHash = optionalDigest(
        input.reconciliationEvidenceHash,
        'reconciliationEvidenceHash',
    );
    const inFlightExecutionLeaseCount = count(
        input.inFlightExecutionLeaseCount,
        'inFlightExecutionLeaseCount',
    );
    const brokerResultDurability = token(
        input.brokerResultDurability,
        'brokerResultDurability',
    );
    if (
        ![
            'no_in_flight_result',
            'durable_acknowledged_or_terminal_or_unknown',
            'broker_ack_memory_only',
            'durable_commit_failed',
            'unknown',
        ].includes(brokerResultDurability)
    ) {
        throw new TypeError('brokerResultDurability is invalid');
    }
    const counts = normalizedDrainCounts(input.counts);
    count(
        input.ordinaryUnmanagedPositionShares,
        'ordinaryUnmanagedPositionShares',
    );
    const remainder = record(
        input.runtimeTrackedUnprotectedRemainder,
        'runtimeTrackedUnprotectedRemainder',
    );
    exactKeys(
        remainder,
        ['state', 'shares', 'conservativeMaximumShares'],
        'runtimeTrackedUnprotectedRemainder',
    );
    const remainderState = token(remainder.state, 'remainder.state');
    if (!['known', 'unknown'].includes(remainderState)) {
        throw new TypeError('remainder.state is invalid');
    }
    if (remainderState === 'known') {
        count(remainder.shares, 'remainder.shares');
    } else if (remainder.shares !== null) {
        throw new TypeError('unknown remainder must not expose guessed shares');
    }
    const conservativeMaximumShares = count(
        remainder.conservativeMaximumShares,
        'remainder.conservativeMaximumShares',
    );
    if (
        remainderState === 'known' &&
        remainder.shares > conservativeMaximumShares
    ) {
        throw new TypeError('known remainder exceeds its conservative maximum');
    }

    const neverAuthorizedAndNoHistory =
        counts.durableSideEffectHistory === 0 &&
        counts.durableObligationHistory === 0;
    const reconciliationComplete =
        reconciliationEvidenceHash !== null &&
        ['ready', 'observe_only', 'quiescing'].includes(currentRuntimeState);
    const reconciliationAllowsDrain =
        reconciliationComplete || neverAuthorizedAndNoHistory;
    const blockers = [];
    if (!newActivationsStopped) {
        appendBlocker(blockers, 'new_activations_not_stopped', 1);
    }
    if (writeMaster !== 'disabled') {
        appendBlocker(blockers, 'write_master_not_disabled', 1);
    }
    appendBlocker(
        blockers,
        'in_flight_execution_lease',
        inFlightExecutionLeaseCount,
    );
    if (
        ![
            'no_in_flight_result',
            'durable_acknowledged_or_terminal_or_unknown',
        ].includes(brokerResultDurability)
    ) {
        appendBlocker(blockers, 'broker_result_not_durable', 1);
    }
    if (!reconciliationAllowsDrain) {
        appendBlocker(blockers, 'current_reconciliation_required', 1);
    }

    appendBlocker(
        blockers,
        strict ? 'non_terminal_strategy' : 'non_quiesced_strategy',
        strict
            ? counts.nonTerminalStrategies
            : counts.nonQuiescedStrategies,
    );
    appendBlocker(
        blockers,
        'non_terminal_activation',
        counts.nonTerminalActivations,
    );
    appendBlocker(
        blockers,
        'non_terminal_side_effect_intent',
        counts.nonTerminalSideEffectIntents,
    );
    appendBlocker(
        blockers,
        'non_terminal_broker_order',
        counts.nonTerminalBrokerOrders,
    );
    appendBlocker(
        blockers,
        'non_terminal_protection_commitment',
        counts.nonTerminalProtectionCommitments,
    );
    appendBlocker(
        blockers,
        'non_terminal_protection_obligation',
        counts.nonTerminalProtectionObligations,
    );
    appendBlocker(
        blockers,
        'active_entry_exposure_reservation',
        counts.activeEntryExposureReservations,
    );
    appendBlocker(blockers, 'active_exit_claim', counts.activeExitClaims);
    appendBlocker(blockers, 'open_resolution_case', counts.openResolutionCases);
    appendBlocker(blockers, 'open_safety_blocker', counts.openSafetyBlockers);
    if (remainderState === 'unknown' || remainder.shares > 0) {
        appendBlocker(blockers, 'runtime_tracked_unprotected_remainder', 1);
    }

    const blockerCount = blockers.reduce(
        (total, entry) => total + entry.count,
        0,
    );
    return frozen({
        schemaVersion: SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION,
        operation: selectedOperation,
        policyClass: strict
            ? 'strict_no_non_terminal_strategy'
            : 'production_readonly_quiesced_strategy_exception',
        allowed: blockerCount === 0,
        blockerCount,
        blockers,
        newActivationsStopped,
        writeMaster,
        reconciliationAllowsDrain,
        forcedOperationAuthorized: false,
        ordinaryUnmanagedPositionsBlockDrain: false,
        brokerOutcomeInferred: false,
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
    });
}

function normalizedClaim(input, index) {
    exactKeys(
        input,
        [
            'lineageHash',
            'state',
            'quantityShares',
            'runtimeMonitoringFresh',
            'brokerWorkingUniquelyReconciled',
        ],
        `claim[${index}]`,
    );
    const state = token(input.state, `claim[${index}].state`);
    if (!allowedClaimStates.has(state)) {
        throw new TypeError(`claim[${index}].state is invalid`);
    }
    return Object.freeze({
        lineageHash: digest(
            input.lineageHash,
            `claim[${index}].lineageHash`,
        ),
        state,
        quantityShares: count(
            input.quantityShares,
            `claim[${index}].quantityShares`,
        ),
        runtimeMonitoringFresh: bool(
            input.runtimeMonitoringFresh,
            `claim[${index}].runtimeMonitoringFresh`,
        ),
        brokerWorkingUniquelyReconciled: bool(
            input.brokerWorkingUniquelyReconciled,
            `claim[${index}].brokerWorkingUniquelyReconciled`,
        ),
    });
}

/**
 * Implements max(0, filled - confirmed exited - actively covered) without
 * double-counting multiple representations of the same ExitClaim lineage.
 */
export function projectRuntimeTrackedUnprotectedRemainder(input) {
    exactKeys(
        input,
        [
            'filledShares',
            'confirmedExitedShares',
            'runtimeReadinessFresh',
            'accountReconciliationEvidenceHash',
            'claims',
        ],
        'unprotected remainder input',
    );
    const filledShares = count(input.filledShares, 'filledShares');
    const confirmedExitedShares = count(
        input.confirmedExitedShares,
        'confirmedExitedShares',
    );
    if (confirmedExitedShares > filledShares) {
        throw new TypeError('confirmedExitedShares exceeds filledShares');
    }
    const runtimeReadinessFresh = bool(
        input.runtimeReadinessFresh,
        'runtimeReadinessFresh',
    );
    const accountReconciliationEvidenceHash = optionalDigest(
        input.accountReconciliationEvidenceHash,
        'accountReconciliationEvidenceHash',
    );
    if (!Array.isArray(input.claims)) {
        throw new TypeError('claims must be an array');
    }
    const claims = input.claims.map(normalizedClaim);
    const byLineage = new Map();
    let projectionUnknown = false;
    for (const claim of claims) {
        const previous = byLineage.get(claim.lineageHash);
        if (previous) {
            if (
                previous.quantityShares !== claim.quantityShares ||
                previous.state !== claim.state ||
                previous.runtimeMonitoringFresh !==
                    claim.runtimeMonitoringFresh ||
                previous.brokerWorkingUniquelyReconciled !==
                    claim.brokerWorkingUniquelyReconciled
            ) {
                projectionUnknown = true;
            }
            continue;
        }
        byLineage.set(claim.lineageHash, claim);
    }

    let activelyCoveredShares = 0;
    for (const claim of byLineage.values()) {
        if (claim.state === 'unknown') {
            projectionUnknown = true;
            continue;
        }
        if (
            runtimeMonitoredClaimStates.has(claim.state) &&
            runtimeReadinessFresh &&
            claim.runtimeMonitoringFresh
        ) {
            activelyCoveredShares += claim.quantityShares;
            continue;
        }
        if (
            claim.state === 'broker_working' &&
            accountReconciliationEvidenceHash !== null &&
            claim.brokerWorkingUniquelyReconciled
        ) {
            activelyCoveredShares += claim.quantityShares;
        }
    }
    const conservativeMaximumShares = filledShares - confirmedExitedShares;
    if (activelyCoveredShares > conservativeMaximumShares) {
        projectionUnknown = true;
    }
    const shares = projectionUnknown
        ? null
        : Math.max(
              0,
              filledShares - confirmedExitedShares - activelyCoveredShares,
          );
    return frozen({
        schemaVersion: SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION,
        state: projectionUnknown ? 'unknown' : 'known',
        shares,
        conservativeMaximumShares,
        activelyCoveredShares: projectionUnknown ? null : activelyCoveredShares,
        distinctExitClaimLineageCount: byLineage.size,
        representationDoubleCounted: false,
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
    });
}

function normalizedResourceProjection(input) {
    exactKeys(
        input,
        [
            'activeEntryReservationCount',
            'activeExitClaimCount',
            'atomicReleasePrepared',
        ],
        'resource projection',
    );
    return Object.freeze({
        activeEntryReservationCount: count(
            input.activeEntryReservationCount,
            'activeEntryReservationCount',
        ),
        activeExitClaimCount: count(
            input.activeExitClaimCount,
            'activeExitClaimCount',
        ),
        atomicReleasePrepared: bool(
            input.atomicReleasePrepared,
            'atomicReleasePrepared',
        ),
    });
}

function rejectLifecycleRelease(reasonCode, path) {
    return frozen({
        schemaVersion: SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION,
        path,
        allowed: false,
        reasonCode,
        targetObligationState: null,
        targetCommitmentState: null,
        brokerOutcomeInferred: false,
        unmonitored: false,
        originalIntentRedispatchAllowed: false,
        requiresAtomicResourceRelease: true,
    });
}

/**
 * Keeps zero-fill, broker-confirmed exit/position-zero, and break-glass
 * relinquishment as three non-interchangeable obligation release paths.
 */
export function evaluateProtectionObligationRelease(input) {
    exactKeys(
        input,
        [
            'path',
            'entryTerminal',
            'filledShares',
            'confirmedExitedShares',
            'positionShares',
            'brokerEvidenceHash',
            'accountReconciliationEvidenceHash',
            'resources',
            'breakGlass',
        ],
        'protection obligation release input',
    );
    const path = token(input.path, 'release path');
    if (
        ![
            'zero_fill',
            'confirmed_exit_or_position_zero',
            'break_glass_relinquish',
        ].includes(path)
    ) {
        throw new TypeError('protection obligation release path is invalid');
    }
    const entryTerminal = bool(input.entryTerminal, 'entryTerminal');
    const filledShares = count(input.filledShares, 'filledShares');
    const confirmedExitedShares = count(
        input.confirmedExitedShares,
        'confirmedExitedShares',
    );
    const positionShares = count(input.positionShares, 'positionShares');
    if (confirmedExitedShares > filledShares) {
        throw new TypeError('confirmedExitedShares exceeds filledShares');
    }
    const brokerEvidenceHash = optionalDigest(
        input.brokerEvidenceHash,
        'brokerEvidenceHash',
    );
    const accountReconciliationEvidenceHash = optionalDigest(
        input.accountReconciliationEvidenceHash,
        'accountReconciliationEvidenceHash',
    );
    const resources = normalizedResourceProjection(input.resources);
    const breakGlass = record(input.breakGlass, 'breakGlass');
    exactKeys(
        breakGlass,
        [
            'confirmationEvidenceHashes',
            'handoffSnapshotHash',
            'unmonitoredAuditHash',
            'operatorAcknowledgedManualHandoff',
        ],
        'breakGlass',
    );
    const confirmationEvidence = normalizedConfirmationEvidence(
        breakGlass.confirmationEvidenceHashes,
        'breakGlass.confirmationEvidenceHashes',
    );
    const handoffSnapshotHash = optionalDigest(
        breakGlass.handoffSnapshotHash,
        'breakGlass.handoffSnapshotHash',
    );
    const unmonitoredAuditHash = optionalDigest(
        breakGlass.unmonitoredAuditHash,
        'breakGlass.unmonitoredAuditHash',
    );
    const operatorAcknowledgedManualHandoff = bool(
        breakGlass.operatorAcknowledgedManualHandoff,
        'breakGlass.operatorAcknowledgedManualHandoff',
    );
    if (
        path !== 'break_glass_relinquish' &&
        (confirmationEvidence.hashes.length !== 0 ||
            handoffSnapshotHash !== null ||
            unmonitoredAuditHash !== null ||
            operatorAcknowledgedManualHandoff)
    ) {
        throw new TypeError(
            'break-glass evidence is not valid for this release path',
        );
    }

    if (path === 'zero_fill') {
        if (!entryTerminal) {
            return rejectLifecycleRelease('entry_not_terminal', path);
        }
        if (
            brokerEvidenceHash === null ||
            accountReconciliationEvidenceHash === null
        ) {
            return rejectLifecycleRelease(
                'zero_fill_broker_evidence_incomplete',
                path,
            );
        }
        if (
            filledShares !== 0 ||
            confirmedExitedShares !== 0 ||
            resources.activeExitClaimCount !== 0
        ) {
            return rejectLifecycleRelease('not_true_zero_fill', path);
        }
    } else if (path === 'confirmed_exit_or_position_zero') {
        if (!entryTerminal) {
            return rejectLifecycleRelease('entry_not_terminal', path);
        }
        if (filledShares === 0) {
            return rejectLifecycleRelease(
                'zero_fill_must_use_zero_fill_path',
                path,
            );
        }
        if (
            brokerEvidenceHash === null ||
            accountReconciliationEvidenceHash === null
        ) {
            return rejectLifecycleRelease(
                'final_broker_evidence_incomplete',
                path,
            );
        }
        if (
            confirmedExitedShares < filledShares &&
            positionShares !== 0
        ) {
            return rejectLifecycleRelease(
                'exit_or_position_zero_not_confirmed',
                path,
            );
        }
    } else {
        if (
            !confirmationEvidence.completeAndDistinct ||
            handoffSnapshotHash === null ||
            unmonitoredAuditHash === null ||
            !operatorAcknowledgedManualHandoff
        ) {
            return rejectLifecycleRelease(
                'break_glass_second_confirmation_or_snapshot_missing',
                path,
            );
        }
    }

    if (
        (resources.activeEntryReservationCount > 0 ||
            resources.activeExitClaimCount > 0) &&
        !resources.atomicReleasePrepared
    ) {
        return rejectLifecycleRelease(
            'atomic_reservation_claim_release_not_prepared',
            path,
        );
    }

    const breakGlassPath = path === 'break_glass_relinquish';
    return frozen({
        schemaVersion: SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION,
        path,
        allowed: true,
        reasonCode:
            path === 'zero_fill'
                ? 'protection_zero_fill_terminal_confirmed'
                : path === 'confirmed_exit_or_position_zero'
                  ? 'protection_exit_or_position_zero_confirmed'
                  : 'protection_break_glass_relinquished_unmonitored',
        targetObligationState: breakGlassPath
            ? 'released_manual'
            : path === 'zero_fill'
              ? 'zero_fill_terminal'
              : 'fulfilled',
        targetCommitmentState: breakGlassPath
            ? 'released_manual'
            : path === 'zero_fill'
              ? 'zero_fill_terminal'
              : 'materialized',
        brokerOutcomeInferred: false,
        unmonitored: breakGlassPath,
        originalIntentRedispatchAllowed: false,
        requiresAtomicResourceRelease: true,
        releaseProofHash: sha256CanonicalParts([
            path,
            filledShares,
            confirmedExitedShares,
            positionShares,
            brokerEvidenceHash ?? 'none',
            accountReconciliationEvidenceHash ?? 'none',
            ...confirmationEvidence.hashes,
            handoffSnapshotHash ?? 'none',
            unmonitoredAuditHash ?? 'none',
            operatorAcknowledgedManualHandoff,
            resources.activeEntryReservationCount,
            resources.activeExitClaimCount,
            resources.atomicReleasePrepared,
        ]),
    });
}

/**
 * Authorizes only the local break-glass monitoring handoff. It deliberately
 * does not release an obligation or claim a broker terminal outcome; each
 * obligation still needs evaluateProtectionObligationRelease independently.
 */
export function evaluateForcedLifecycleOperation(input) {
    exactKeys(
        input,
        [
            'operation',
            'affectedItemCount',
            'consistentSnapshotHash',
            'confirmationEvidenceHashes',
            'unmonitoredAuditItemCount',
            'unmonitoredAuditHash',
            'operatorAcknowledgedManualBrokerHandling',
        ],
        'forced lifecycle operation input',
    );
    const selectedOperation = operation(input.operation);
    const affectedItemCount = count(
        input.affectedItemCount,
        'affectedItemCount',
    );
    const consistentSnapshotHash = digest(
        input.consistentSnapshotHash,
        'consistentSnapshotHash',
    );
    const confirmationEvidence = normalizedConfirmationEvidence(
        input.confirmationEvidenceHashes,
        'confirmationEvidenceHashes',
    );
    const unmonitoredAuditItemCount = count(
        input.unmonitoredAuditItemCount,
        'unmonitoredAuditItemCount',
    );
    const unmonitoredAuditHash = digest(
        input.unmonitoredAuditHash,
        'unmonitoredAuditHash',
    );
    const operatorAcknowledgedManualBrokerHandling = bool(
        input.operatorAcknowledgedManualBrokerHandling,
        'operatorAcknowledgedManualBrokerHandling',
    );
    const blockers = [];
    if (affectedItemCount === 0) {
        appendBlocker(blockers, 'forced_operation_has_no_affected_item', 1);
    }
    if (!confirmationEvidence.completeAndDistinct) {
        appendBlocker(blockers, 'two_distinct_confirmations_required', 1);
    }
    if (unmonitoredAuditItemCount !== affectedItemCount) {
        appendBlocker(
            blockers,
            'unmonitored_audit_does_not_cover_every_item',
            Math.max(
                1,
                Math.abs(affectedItemCount - unmonitoredAuditItemCount),
            ),
        );
    }
    if (!operatorAcknowledgedManualBrokerHandling) {
        appendBlocker(
            blockers,
            'manual_broker_handling_not_acknowledged',
            1,
        );
    }
    const forcedOperationProofHash = sha256CanonicalParts([
        selectedOperation,
        affectedItemCount,
        consistentSnapshotHash,
        ...confirmationEvidence.hashes,
        unmonitoredAuditItemCount,
        unmonitoredAuditHash,
        operatorAcknowledgedManualBrokerHandling,
    ]);
    return frozen({
        schemaVersion: SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION,
        operation: selectedOperation,
        allowed: blockers.length === 0,
        blockerCount: blockers.reduce(
            (total, entry) => total + entry.count,
            0,
        ),
        blockers,
        affectedItemCount,
        forcedOperationProofHash,
        markEveryAffectedItemUnmonitored: blockers.length === 0,
        protectionObligationsReleased: false,
        separateRelinquishmentRequired: true,
        brokerOutcomeInferred: false,
        originalIntentRedispatchAllowed: false,
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
    });
}

/**
 * Pure preflight for a mode mutation. It never acquires a process lock and
 * therefore returns only whether a caller may proceed to the exclusive-lock
 * acquisition step.
 */
export function evaluateModeSwitchPreflight(input) {
    exactKeys(
        input,
        [
            'lifecycleDrainAllowed',
            'modeMarker',
            'apiInfo',
            'expectedApiGeneration',
            'inFlightExecutionLeaseCount',
            'brokerResultDurability',
            'exclusiveModeLeaseState',
            'unmanagedApiListenerDetected',
        ],
        'mode switch preflight input',
    );
    const lifecycleDrainAllowed = bool(
        input.lifecycleDrainAllowed,
        'lifecycleDrainAllowed',
    );
    const modeMarker = record(input.modeMarker, 'modeMarker');
    exactKeys(modeMarker, ['state', 'mode', 'apiGeneration'], 'modeMarker');
    const markerState = token(modeMarker.state, 'modeMarker.state');
    const markerMode =
        modeMarker.mode === null
            ? null
            : token(modeMarker.mode, 'modeMarker.mode');
    const markerGeneration =
        modeMarker.apiGeneration === null
            ? null
            : token(modeMarker.apiGeneration, 'modeMarker.apiGeneration');
    const apiInfo = record(input.apiInfo, 'apiInfo');
    exactKeys(apiInfo, ['state', 'simulation', 'apiGeneration'], 'apiInfo');
    const apiInfoState = token(apiInfo.state, 'apiInfo.state');
    const apiSimulation =
        apiInfo.simulation === null
            ? null
            : bool(apiInfo.simulation, 'apiInfo.simulation');
    const apiGeneration =
        apiInfo.apiGeneration === null
            ? null
            : token(apiInfo.apiGeneration, 'apiInfo.apiGeneration');
    const expectedApiGeneration = token(
        input.expectedApiGeneration,
        'expectedApiGeneration',
    );
    const inFlightExecutionLeaseCount = count(
        input.inFlightExecutionLeaseCount,
        'inFlightExecutionLeaseCount',
    );
    const brokerResultDurability = token(
        input.brokerResultDurability,
        'brokerResultDurability',
    );
    const exclusiveModeLeaseState = token(
        input.exclusiveModeLeaseState,
        'exclusiveModeLeaseState',
    );
    const unmanagedApiListenerDetected = bool(
        input.unmanagedApiListenerDetected,
        'unmanagedApiListenerDetected',
    );

    const blockers = [];
    if (!lifecycleDrainAllowed) {
        appendBlocker(blockers, 'lifecycle_drain_blocked', 1);
    }
    if (markerState !== 'known_private') {
        appendBlocker(blockers, 'mode_marker_unknown_or_untrusted', 1);
    }
    if (markerMode !== 'simulation') {
        appendBlocker(blockers, 'mode_marker_not_simulation', 1);
    }
    if (apiInfoState !== 'current') {
        appendBlocker(blockers, 'api_info_timeout_unknown_or_invalid', 1);
    }
    if (apiSimulation !== true) {
        appendBlocker(blockers, 'api_info_not_simulation', 1);
    }
    if (
        markerGeneration !== expectedApiGeneration ||
        apiGeneration !== expectedApiGeneration
    ) {
        appendBlocker(blockers, 'api_generation_mismatch', 1);
    }
    appendBlocker(
        blockers,
        'in_flight_execution_lease',
        inFlightExecutionLeaseCount,
    );
    if (
        ![
            'no_in_flight_result',
            'durable_acknowledged_or_terminal_or_unknown',
        ].includes(brokerResultDurability)
    ) {
        appendBlocker(blockers, 'broker_ack_or_unknown_not_durable', 1);
    }
    if (exclusiveModeLeaseState !== 'acquired_after_shared_drain') {
        appendBlocker(blockers, 'exclusive_mode_lease_not_acquired', 1);
    }
    if (unmanagedApiListenerDetected) {
        appendBlocker(blockers, 'unmanaged_api_listener', 1);
    }

    return frozen({
        schemaVersion: SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION,
        allowed: blockers.length === 0,
        blockerCount: blockers.reduce(
            (total, entry) => total + entry.count,
            0,
        ),
        blockers,
        markerChanged: false,
        apiGenerationChanged: false,
        brokerWriteWithdrawn: false,
        brokerOutcomeInferred: false,
    });
}

export function projectLifecycleRecovery(input) {
    exactKeys(
        input,
        [
            'reason',
            'previousApiGeneration',
            'currentApiGeneration',
            'accountSessionRevisionChanged',
            'reconciliationComplete',
            'subscriptionsRebuilt',
            'userResumeConfirmed',
            'strategyArmed',
        ],
        'lifecycle recovery input',
    );
    const reason = token(input.reason, 'recovery reason');
    if (
        ![
            'watchdog_restart',
            'api_generation_change',
            'relogin',
            'simulation_return',
            'runtime_upgrade',
            'migration',
        ].includes(reason)
    ) {
        throw new TypeError('lifecycle recovery reason is invalid');
    }
    const previousApiGeneration = token(
        input.previousApiGeneration,
        'previousApiGeneration',
    );
    const currentApiGeneration = token(
        input.currentApiGeneration,
        'currentApiGeneration',
    );
    const accountSessionRevisionChanged = bool(
        input.accountSessionRevisionChanged,
        'accountSessionRevisionChanged',
    );
    const reconciliationComplete = bool(
        input.reconciliationComplete,
        'reconciliationComplete',
    );
    const subscriptionsRebuilt = bool(
        input.subscriptionsRebuilt,
        'subscriptionsRebuilt',
    );
    const userResumeConfirmed = bool(
        input.userResumeConfirmed,
        'userResumeConfirmed',
    );
    const strategyArmed = bool(input.strategyArmed, 'strategyArmed');
    // Every allowed reason is itself a continuity boundary. A caller cannot
    // turn a relogin/watchdog/migration into a no-op by replaying the same
    // generation token, and a mislabeled generation-change event still fails
    // closed instead of preserving the previous sender fence.
    const discontinuity = true;
    const recoveryReady = reconciliationComplete && subscriptionsRebuilt;

    return frozen({
        schemaVersion: SMART_ORDER_LIFECYCLE_DRAIN_POLICY_SCHEMA_VERSION,
        reason,
        state: recoveryReady ? 'observe_only' : 'reconciling',
        previousFenceValid: !discontinuity,
        dispatchAllowed:
            !discontinuity &&
            recoveryReady &&
            userResumeConfirmed &&
            strategyArmed,
        automaticResumeAllowed: false,
        automaticPreparedIntentDispatchAllowed: false,
        userResumeAndArmRequired: true,
        reconciliationRequired: !reconciliationComplete,
        subscriptionRebuildRequired: !subscriptionsRebuilt,
        brokerOutcomeInferred: false,
    });
}
