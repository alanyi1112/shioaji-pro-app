import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';

export const SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION =
    'smart-order-manual-resolution/2026-08-11.6' as const;

export const SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION =
    'smart-order-safety-blocker-resolution/2026-08-11.3' as const;

export const MANUAL_INTERVENTION_REASON_CODES = [
    'BROKER_OUTCOME_UNKNOWN',
    'BROKER_CORRELATION_AMBIGUOUS',
    'BROKER_ACCOUNT_MISMATCH',
    'BROKER_FINAL_EVIDENCE_CONFLICT',
    'ACTIVATION_ID_CONFLICT',
    'ENTRY_RESULT_UNKNOWN',
    'EXIT_CLAIM_UNKNOWN',
    'EXTERNAL_POSITION_DRIFT',
    'QUOTE_GAP_CROSSING_UNKNOWN',
    'TRAILING_GAP_EXTREME_UNKNOWN',
    'POSITION_OR_UNIT_UNKNOWN',
    'PROTECTION_UNPROTECTED_REMAINDER',
    'DB_INTEGRITY_FAILED',
    'IDENTITY_MAPPING_CONFLICT',
] as const;

export type ManualInterventionReasonCode =
    (typeof MANUAL_INTERVENTION_REASON_CODES)[number];

export const CANONICAL_BLOCKING_RESOLUTION_REASON_CODES = [
    'BROKER_RESPONSE_LOST_RECONCILE',
    'BROKER_TARGET_REVISION_CHANGED',
    'ACKNOWLEDGED_RECONCILIATION_REQUIRED',
    'BROKER_STATE_UNKNOWN',
    'PROTECTION_RECONCILIATION_REQUIRED',
    'EXTERNAL_WORKING_SET_INCOMPLETE',
    'ENTRY_RESERVATION_UNKNOWN',
    'SIMULATION_ATTESTATION_FAILED',
    'MODE_GENERATION_CHANGED',
    'GATE_MANIFEST_INVALID',
] as const;

export type CanonicalBlockingResolutionReasonCode =
    (typeof CANONICAL_BLOCKING_RESOLUTION_REASON_CODES)[number];

export type BlockingResolutionReasonCode =
    | ManualInterventionReasonCode
    | CanonicalBlockingResolutionReasonCode;

export type ResolutionEvidenceClass =
    | 'broker_full_orders_trades_deals'
    | 'broker_position_and_working_set'
    | 'canonical_broker_correlation'
    | 'fixed_account_subscription'
    | 'immutable_evidence_hashes'
    | 'activation_key_and_unique_index_audit'
    | 'entry_cumulative_fill_projection'
    | 'exit_claim_remainder_projection'
    | 'full_position_unit_reconciliation'
    | 'full_external_working_set'
    | 'eligible_observation_gap_evidence'
    | 'current_protection_remainder_snapshot'
    | 'verified_database_restore_integrity'
    | 'single_writer_fence_evidence'
    | 'identity_mapping_and_key_audit'
    | 'fresh_confirmation_snapshot'
    | 'gate_approved_zero_exposure_bounds'
    | 'canonical_safety_blocker_successor_binding'
    | 'new_runtime_epoch_reconciliation'
    | 'mode_generation_manifest_reconciliation';

export type ManualResolutionOperation =
    | 'generic_resume'
    | 'apply_unique_final_evidence'
    | 'reconfirm_and_pause'
    | 'cancel_strategy'
    | 'copy_to_new_draft'
    | 'repair_gate_observe_only'
    | 'break_glass_relinquish'
    | 'remain_open';

export type ResolutionDestination =
    | 'manual_intervention'
    | 'paused'
    | 'cancel_pending'
    | 'observe_only'
    | 'terminal_entity_unchanged'
    | 'resolution_case_open'
    | 'resolution_case_relinquished_unknown';

export type ResolutionStateEntityKind =
    | 'strategy'
    | 'activation'
    | 'order_intent'
    | 'broker_order'
    | 'pending_protection_commitment'
    | 'protection_obligation'
    | 'entry_exposure_reservation'
    | 'exit_claim'
    | 'external_sell_claim'
    | 'runtime_epoch'
    | 'durable_dispatch_blocker'
    | 'resolution_case'
    | 'safety_blocker';

export interface ResolutionStateTransitionBinding {
    readonly kind: 'state_transition';
    readonly entityKind: ResolutionStateEntityKind;
    readonly entityId: string;
    readonly lineageId: string;
    readonly lineageGeneration: number;
    readonly expectedRevision: number;
    readonly effectProjectionSha256: `sha256:${string}`;
    readonly edgeId: string;
    readonly fromState: string;
    readonly toState: string;
    readonly transitionReasonCode: string;
}

export type ResolutionServiceOperation =
    | 'cancel_strategy'
    | 'copy_to_new_draft'
    | 'repair_gate_observe_only'
    | 'remain_open';

export interface ResolutionServiceExecutionBoundary {
    readonly kind: 'resolution_service';
    readonly operation: ResolutionServiceOperation;
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly sourceEntityKind: 'strategy' | 'runtime_epoch' | 'resolution_case';
    readonly sourceEntityId: string;
    readonly sourceEntityExpectedRevision: number;
    readonly serviceRequestSha256: `sha256:${string}`;
}

export type ResolutionExecutionBoundary =
    | ResolutionStateTransitionBinding
    | ResolutionServiceExecutionBoundary;

export type BlockingStateResolutionOperation =
    | 'apply_canonical_projection_keep_blocked'
    | 'apply_canonical_resolution_final'
    | 'apply_unique_final_evidence'
    | 'resolve_safety_blocker'
    | 'supersede_safety_blocker';

export type SafetyBlockerResolutionKind =
    | 'unknown_broker_side_effect'
    | 'terminal_evidence_conflict'
    | 'relinquished_unknown_exposure'
    | 'position_or_unit_conflict'
    | 'external_working_set_incomplete'
    | 'identity_mapping_conflict'
    | 'db_integrity_unverified'
    | 'mode_generation_conflict';

export interface SafetyBlockerScopeBinding {
    readonly scopeId: string;
    /**
     * Verifier-issued canonical atomic scope members.  The state machine never
     * parses scope IDs or infers hierarchy from display strings.
     */
    readonly memberSha256: readonly `sha256:${string}`[];
}

export interface SafetyBlockerSuccessorBinding {
    readonly blockerId: string;
    readonly blockerKind: SafetyBlockerResolutionKind;
    readonly resolutionCaseId: string;
    readonly predecessorBlockerId: string;
    readonly predecessorLineageId: string;
    readonly lineageId: string;
    readonly lineageGeneration: number;
    readonly scope: SafetyBlockerScopeBinding;
    readonly worstCasePositionDeltaShares?: string;
    readonly possiblyWorkingShares?: string;
    readonly bindingSha256: `sha256:${string}`;
}

export type SafetyBlockerResolutionPath =
    | 'blocker_kind_policy_evidence'
    | 'canonical_unique_final_current_exposure'
    | 'gate_approved_zero_exposure_bounds'
    | 'supersede_strict_scope';

export interface SafetyBlockerResolutionBinding {
    readonly policyVersion: typeof SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION;
    readonly blockerId: string;
    readonly blockerKind: SafetyBlockerResolutionKind;
    readonly resolutionCaseId: string;
    readonly lineageId: string;
    readonly lineageGeneration: number;
    readonly scope: SafetyBlockerScopeBinding;
    readonly worstCasePositionDeltaShares?: string;
    readonly possiblyWorkingShares?: string;
    readonly resolutionPath: SafetyBlockerResolutionPath;
    readonly gateApprovedZeroBoundsEvidenceSha256?: `sha256:${string}`;
    readonly successor?: SafetyBlockerSuccessorBinding;
}

export type RearmPolicy =
    | 'never'
    | 'new_arm_generation_after_fresh_false'
    | 'new_remainder_generation_after_reconciliation'
    | 'new_runtime_epoch_and_user_arm'
    | 'new_confirmation_and_user_arm';

export type LocalObligationPolicy =
    | 'settle_from_unique_final_quantities'
    | 'preserve_unknown_and_block'
    | 'recompute_after_full_reconciliation'
    | 'release_only_with_durable_unknown_exposure_blocker'
    | 'preserve_existing_broker_obligations'
    | 'rebuild_only_as_new_claim_generation';

export type AtomicResolutionCompanion =
    | 'resolution_case_terminal'
    | 'strategy_cancel_requested'
    | 'copy_to_new_draft_created'
    | 'runtime_observe_only_blocker_open'
    | 'fresh_confirmation_snapshot'
    | 'reservation_claim_obligation_settlement'
    | 'terminal_evidence_correction'
    | 'safety_blocker_open'
    | 'relinquished_unknown_exposure_open'
    | 'burned_authorization_nonce'
    | 'break_glass_audit_snapshot';

export interface ManualResolutionMatrixRow {
    readonly reasonCode: ManualInterventionReasonCode;
    readonly requiredEvidence: readonly ResolutionEvidenceClass[];
    readonly allowedOperations: readonly Exclude<
        ManualResolutionOperation,
        'generic_resume'
    >[];
    readonly destinations: readonly ResolutionDestination[];
    readonly rearmPolicy: RearmPolicy;
    readonly obligationPolicy: LocalObligationPolicy;
    readonly breakGlassAllowed: boolean;
    readonly oldIntentDisposition: 'never_resend';
}

export interface VerifiedResolutionEvidence {
    readonly evidenceClass: ResolutionEvidenceClass;
    readonly reasonCode: BlockingResolutionReasonCode;
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly scopeSha256: `sha256:${string}`;
    readonly targetSideEffectSha256: `sha256:${string}`;
    readonly evidenceSha256: `sha256:${string}`;
    readonly revision: string;
    readonly finality: 'not_final' | 'unique_broker_terminal';
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
}

export interface VerifiedResolutionEvidenceSet {
    readonly reasonCode: BlockingResolutionReasonCode;
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly scopeSha256: `sha256:${string}`;
    readonly targetSideEffectSha256: `sha256:${string}`;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly evidence: readonly VerifiedResolutionEvidence[];
    readonly evidenceSnapshotSha256: `sha256:${string}`;
    readonly uniqueFinalEvidenceSha256?: `sha256:${string}`;
}

export interface VerifiedResolutionRuntimeContext {
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly reasonCode: BlockingResolutionReasonCode;
    readonly scopeSha256: `sha256:${string}`;
    readonly targetSideEffectSha256: `sha256:${string}`;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly nowEpochMs: number;
    readonly issuedAtMonotonicMs: number;
    readonly validUntilMonotonicMs: number;
}

export interface VerifiedResolutionConfirmationStep {
    readonly kind: 'user_rearm' | 'lifecycle' | 'break_glass';
    readonly reasonCode: ManualInterventionReasonCode;
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly scopeSha256: `sha256:${string}`;
    readonly targetSideEffectSha256: `sha256:${string}`;
    readonly evidenceSnapshotSha256: `sha256:${string}`;
    readonly stepId: string;
    readonly confirmationLineageId: string;
    readonly stepIndex: 1 | 2;
    readonly nonce: string;
    readonly nonceRevision: number;
    readonly nonceState: 'available' | 'consumed' | 'expired';
    readonly userConfirmationSha256: `sha256:${string}`;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly confirmedAtEpochMs: number;
    readonly confirmedAtMonotonicMs: number;
    readonly freshConfirmationSha256?: `sha256:${string}`;
    readonly previousStepSha256?: `sha256:${string}`;
    readonly stepSha256: `sha256:${string}`;
}

export interface VerifiedResolutionAuthorization {
    readonly kind: 'user_rearm' | 'lifecycle' | 'break_glass';
    readonly reasonCode: ManualInterventionReasonCode;
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly scopeSha256: `sha256:${string}`;
    readonly targetSideEffectSha256: `sha256:${string}`;
    readonly authorizationSha256: `sha256:${string}`;
    readonly evidenceSnapshotSha256: `sha256:${string}`;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly authorizedAtEpochMs: number;
    readonly validUntilMonotonicMs: number;
    readonly freshConfirmationSha256?: `sha256:${string}`;
    readonly steps: readonly VerifiedResolutionConfirmationStep[];
}

export type ResolutionDecisionReason =
    | 'unknown_reason'
    | 'generic_resume_forbidden'
    | 'operation_not_allowed'
    | 'evidence_untrusted'
    | 'evidence_scope_mismatch'
    | 'evidence_snapshot_untrusted'
    | 'resolution_context_untrusted_or_stale'
    | 'resolution_case_revision_mismatch'
    | 'required_evidence_missing'
    | 'unique_final_evidence_missing'
    | 'authorization_untrusted'
    | 'authorization_mismatch'
    | 'second_confirmation_missing'
    | 'confirmation_lineage_invalid'
    | 'confirmation_not_separate'
    | 'authorization_nonce_unavailable'
    | 'decision_already_issued_for_target_revision'
    | 'execution_boundary_mismatch'
    | 'safety_blocker_binding_missing'
    | 'safety_blocker_policy_mismatch'
    | 'successor_scope_not_strict_superset';

export interface VerifiedManualResolutionDecision {
          allowed: true;
          decisionSchemaVersion: typeof SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION;
          reasonCode: ManualInterventionReasonCode;
          resolutionCaseId: string;
          caseRevision: number;
          scopeSha256: `sha256:${string}`;
          targetSideEffectSha256: `sha256:${string}`;
          runtimeEpochId: string;
          apiGeneration: string;
          authorizedAtEpochMs: number;
          validUntilMonotonicMs: number;
          operation: Exclude<ManualResolutionOperation, 'generic_resume'>;
          evidenceSnapshotSha256: `sha256:${string}`;
          freshConfirmationSha256?: `sha256:${string}`;
          authorizationSha256?: `sha256:${string}`;
          confirmationSteps: readonly Readonly<{
              stepIndex: 1 | 2;
              nonce: string;
              nonceRevision: number;
              userConfirmationSha256: `sha256:${string}`;
              stepSha256: `sha256:${string}`;
          }>[];
          executionBoundary: ResolutionExecutionBoundary;
          row: ManualResolutionMatrixRow;
          destination: ResolutionDestination;
          oldIntentDisposition: 'never_resend';
          atomicConsume: readonly Readonly<{
              nonce: string;
              revision: number;
          }>[];
          atomicCompanions: readonly AtomicResolutionCompanion[];
}

export interface VerifiedBlockingStateResolutionDecision {
    readonly allowed: true;
    readonly decisionSchemaVersion: typeof SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION;
    readonly reasonCode: BlockingResolutionReasonCode;
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly scopeSha256: `sha256:${string}`;
    readonly targetSideEffectSha256: `sha256:${string}`;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly authorizedAtEpochMs: number;
    readonly validUntilMonotonicMs: number;
    readonly operation: BlockingStateResolutionOperation;
    readonly evidenceSnapshotSha256: `sha256:${string}`;
    readonly evidenceClasses: readonly ResolutionEvidenceClass[];
    readonly uniqueFinalEvidenceSha256?: `sha256:${string}`;
    readonly safetyBlockerResolutionBinding?: SafetyBlockerResolutionBinding;
    readonly transitionBinding: ResolutionStateTransitionBinding;
    readonly oldIntentDisposition: 'never_resend';
}

export type BlockingStateResolutionDecision =
    | Readonly<VerifiedBlockingStateResolutionDecision>
    | Readonly<{
          allowed: false;
          reason: ResolutionDecisionReason;
          missingEvidence?: readonly ResolutionEvidenceClass[];
      }>;

export type ManualResolutionDecision =
    | Readonly<VerifiedManualResolutionDecision>
    | Readonly<{
          allowed: false;
          reason: ResolutionDecisionReason;
          missingEvidence?: readonly ResolutionEvidenceClass[];
      }>;

const verifiedEvidence = new WeakSet<object>();
const verifiedEvidenceSets = new WeakSet<object>();
const verifiedRuntimeContexts = new WeakSet<object>();
const verifiedConfirmationSteps = new WeakSet<object>();
const verifiedAuthorizations = new WeakSet<object>();
const verifiedManualResolutionDecisions = new WeakSet<object>();
const consumedManualResolutionDecisions = new WeakSet<object>();
const verifiedBlockingStateResolutionDecisions = new WeakSet<object>();
const consumedBlockingStateResolutionDecisions = new WeakSet<object>();
const verifiedSafetyBlockerSuccessorBindings = new WeakSet<object>();
const consumedResolutionAuthorizations = new WeakSet<object>();
const consumedResolutionSteps = new WeakSet<object>();
const issuedResolutionDecisionTargets = new Set<string>();
const latestResolutionCaseHead = new Map<
    string,
    Readonly<{
        caseRevision: number;
        reasonCode: BlockingResolutionReasonCode;
        scopeSha256: `sha256:${string}`;
        targetSideEffectSha256: `sha256:${string}`;
        runtimeEpochId: string;
        apiGeneration: string;
    }>
>();

export const SMART_ORDER_RESOLUTION_CONTEXT_TTL_MS = 1_000 as const;

function fail(message: string): never {
    throw new TypeError(message);
}

function token(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 180 ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        return fail(`${label} must be a bounded token`);
    }
    return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
        return fail(`${label} must be a SHA-256 digest`);
    }
    return value as `sha256:${string}`;
}

function safeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        return fail(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function optionalNonNegativeIntegerText(
    value: unknown,
    label: string,
): string | undefined {
    if (value === undefined) return undefined;
    if (
        typeof value !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(value) ||
        value.length > 80
    ) {
        return fail(`${label} must be a canonical non-negative integer string`);
    }
    return value;
}

function freezeSafetyBlockerScopeBinding(
    input: SafetyBlockerScopeBinding,
    label: string,
): Readonly<SafetyBlockerScopeBinding> {
    if (!input || typeof input !== 'object') {
        return fail(`${label} is required`);
    }
    if (!Array.isArray(input.memberSha256) || input.memberSha256.length === 0) {
        return fail(`${label} must contain canonical scope members`);
    }
    const members = input.memberSha256.map((item, index) =>
        digest(item, `${label}.memberSha256[${index}]`),
    );
    if (new Set(members).size !== members.length) {
        return fail(`${label} contains duplicate scope members`);
    }
    members.sort();
    return Object.freeze({
        scopeId: token(input.scopeId, `${label}.scopeId`),
        memberSha256: Object.freeze(members),
    });
}

function isStrictScopeSuperset(
    predecessor: SafetyBlockerScopeBinding,
    successor: SafetyBlockerScopeBinding,
): boolean {
    if (
        predecessor.scopeId === successor.scopeId ||
        successor.memberSha256.length <= predecessor.memberSha256.length
    ) {
        return false;
    }
    const successorMembers = new Set(successor.memberSha256);
    return predecessor.memberSha256.every((item) =>
        successorMembers.has(item),
    );
}

function freezeSafetyBlockerResolutionBinding(
    input: SafetyBlockerResolutionBinding,
    operation: BlockingStateResolutionOperation,
    context: VerifiedResolutionRuntimeContext,
    evidenceSet: VerifiedResolutionEvidenceSet,
): Readonly<SafetyBlockerResolutionBinding> {
    if (!input || typeof input !== 'object') {
        return fail('safety blocker resolution binding is required');
    }
    if (
        input.policyVersion !==
        SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION
    ) {
        return fail('safety blocker resolution policy version is unsupported');
    }
    if (!isSafetyBlockerReasonAllowed(input.blockerKind, context.reasonCode)) {
        return fail('safety blocker kind does not allow this opening reason');
    }
    const scope = freezeSafetyBlockerScopeBinding(
        input.scope,
        'safetyBlocker.scope',
    );
    const base = {
        policyVersion: SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION,
        blockerId: token(input.blockerId, 'safetyBlocker.blockerId'),
        blockerKind: input.blockerKind,
        resolutionCaseId: token(
            input.resolutionCaseId,
            'safetyBlocker.resolutionCaseId',
        ),
        lineageId: token(input.lineageId, 'safetyBlocker.lineageId'),
        lineageGeneration: safeInteger(
            input.lineageGeneration,
            'safetyBlocker.lineageGeneration',
        ),
        scope,
        ...(input.worstCasePositionDeltaShares !== undefined
            ? {
                  worstCasePositionDeltaShares:
                      optionalNonNegativeIntegerText(
                          input.worstCasePositionDeltaShares,
                          'safetyBlocker.worstCasePositionDeltaShares',
                      )!,
              }
            : {}),
        ...(input.possiblyWorkingShares !== undefined
            ? {
                  possiblyWorkingShares: optionalNonNegativeIntegerText(
                      input.possiblyWorkingShares,
                      'safetyBlocker.possiblyWorkingShares',
                  )!,
              }
            : {}),
    };
    if (base.resolutionCaseId !== context.resolutionCaseId) {
        return fail('safety blocker binding uses another ResolutionCase');
    }
    if (
        (base.blockerKind === 'unknown_broker_side_effect' ||
            base.blockerKind === 'relinquished_unknown_exposure') &&
        (base.worstCasePositionDeltaShares === undefined ||
            base.possiblyWorkingShares === undefined)
    ) {
        return fail(
            'unknown exposure SafetyBlocker binding requires both effect bounds',
        );
    }

    const evidenceByClass = new Map(
        evidenceSet.evidence.map((item) => [item.evidenceClass, item] as const),
    );
    const requiredEvidence = getSafetyBlockerResolutionRequiredEvidence(
        base.blockerKind,
        input.resolutionPath,
    );
    if (requiredEvidence.some((item) => !evidenceByClass.has(item))) {
        return fail('safety blocker kind-specific evidence is incomplete');
    }

    if (operation === 'resolve_safety_blocker') {
        if (input.successor !== undefined) {
            return fail('SafetyBlocker resolution cannot carry a successor');
        }
        const needsUniqueFinal =
            base.blockerKind === 'unknown_broker_side_effect' ||
            base.blockerKind === 'relinquished_unknown_exposure';
        if (input.resolutionPath === 'gate_approved_zero_exposure_bounds') {
            if (
                base.blockerKind !== 'relinquished_unknown_exposure' ||
                base.worstCasePositionDeltaShares !== '0' ||
                base.possiblyWorkingShares !== '0' ||
                !input.gateApprovedZeroBoundsEvidenceSha256
            ) {
                return fail(
                    'Gate-approved zero bounds apply only to an explicitly zero relinquished exposure',
                );
            }
            const gateEvidence = evidenceByClass.get(
                'gate_approved_zero_exposure_bounds',
            );
            const gateDigest = digest(
                input.gateApprovedZeroBoundsEvidenceSha256,
                'gateApprovedZeroBoundsEvidenceSha256',
            );
            if (!gateEvidence || gateEvidence.evidenceSha256 !== gateDigest) {
                return fail(
                    'Gate-approved zero bounds must bind opaque verifier evidence',
                );
            }
            return Object.freeze({
                ...base,
                resolutionPath: 'gate_approved_zero_exposure_bounds',
                gateApprovedZeroBoundsEvidenceSha256: gateDigest,
            });
        }
        if (
            needsUniqueFinal &&
            input.resolutionPath !==
                'canonical_unique_final_current_exposure'
        ) {
            return fail(
                'unknown exposure blocker requires canonical unique-final resolution',
            );
        }
        if (
            !needsUniqueFinal &&
            input.resolutionPath !== 'blocker_kind_policy_evidence'
        ) {
            return fail('safety blocker uses the wrong resolution path');
        }
        if (needsUniqueFinal && !evidenceSet.uniqueFinalEvidenceSha256) {
            return fail(
                'unknown exposure blocker requires unique canonical final evidence',
            );
        }
        if (input.gateApprovedZeroBoundsEvidenceSha256 !== undefined) {
            return fail('non-Gate resolution cannot carry Gate evidence');
        }
        return Object.freeze({
            ...base,
            resolutionPath: input.resolutionPath,
        });
    }

    if (
        operation !== 'supersede_safety_blocker' ||
        input.resolutionPath !== 'supersede_strict_scope' ||
        input.gateApprovedZeroBoundsEvidenceSha256 !== undefined ||
        !input.successor
    ) {
        return fail('safety blocker supersession binding is incomplete');
    }
    if (!verifiedSafetyBlockerSuccessorBindings.has(input.successor)) {
        return fail(
            'SafetyBlocker successor must be an opaque verifier-issued canonical projection',
        );
    }
    const successorScope = freezeSafetyBlockerScopeBinding(
        input.successor.scope,
        'safetyBlocker.successor.scope',
    );
    const successor = Object.freeze({
        blockerId: token(
            input.successor.blockerId,
            'safetyBlocker.successor.blockerId',
        ),
        blockerKind: input.successor.blockerKind,
        resolutionCaseId: token(
            input.successor.resolutionCaseId,
            'safetyBlocker.successor.resolutionCaseId',
        ),
        predecessorBlockerId: token(
            input.successor.predecessorBlockerId,
            'safetyBlocker.successor.predecessorBlockerId',
        ),
        predecessorLineageId: token(
            input.successor.predecessorLineageId,
            'safetyBlocker.successor.predecessorLineageId',
        ),
        lineageId: token(
            input.successor.lineageId,
            'safetyBlocker.successor.lineageId',
        ),
        lineageGeneration: safeInteger(
            input.successor.lineageGeneration,
            'safetyBlocker.successor.lineageGeneration',
        ),
        scope: successorScope,
        bindingSha256: digest(
            input.successor.bindingSha256,
            'safetyBlocker.successor.bindingSha256',
        ),
        ...(input.successor.worstCasePositionDeltaShares !== undefined
            ? {
                  worstCasePositionDeltaShares:
                      optionalNonNegativeIntegerText(
                          input.successor.worstCasePositionDeltaShares,
                          'safetyBlocker.successor.worstCasePositionDeltaShares',
                      )!,
              }
            : {}),
        ...(input.successor.possiblyWorkingShares !== undefined
            ? {
                  possiblyWorkingShares: optionalNonNegativeIntegerText(
                      input.successor.possiblyWorkingShares,
                      'safetyBlocker.successor.possiblyWorkingShares',
                  )!,
              }
            : {}),
    });
    if (
        successor.blockerId === base.blockerId ||
        successor.blockerKind !== base.blockerKind ||
        successor.resolutionCaseId !== base.resolutionCaseId ||
        successor.predecessorBlockerId !== base.blockerId ||
        successor.predecessorLineageId !== base.lineageId ||
        successor.lineageId === base.lineageId ||
        successor.lineageGeneration !== base.lineageGeneration + 1
    ) {
        return fail('successor SafetyBlocker lineage is not connected');
    }
    if (
        (base.blockerKind === 'unknown_broker_side_effect' ||
            base.blockerKind === 'relinquished_unknown_exposure') &&
        (successor.worstCasePositionDeltaShares === undefined ||
            successor.possiblyWorkingShares === undefined ||
            BigInt(successor.worstCasePositionDeltaShares) <
                BigInt(base.worstCasePositionDeltaShares!) ||
            BigInt(successor.possiblyWorkingShares) <
                BigInt(base.possiblyWorkingShares!))
    ) {
        return fail(
            'unknown exposure successor must preserve or increase both effect bounds',
        );
    }
    if (!isStrictScopeSuperset(scope, successorScope)) {
        return fail('successor SafetyBlocker scope is not a strict superset');
    }
    const successorEvidence = evidenceByClass.get(
        'canonical_safety_blocker_successor_binding',
    );
    if (
        !successorEvidence ||
        successorEvidence.evidenceSha256 !== successor.bindingSha256
    ) {
        return fail(
            'successor SafetyBlocker must be bound to opaque canonical evidence',
        );
    }
    return Object.freeze({
        ...base,
        resolutionPath: 'supersede_strict_scope',
        successor,
    });
}

type StateBoundManualResolutionOperation = Extract<
    ManualResolutionOperation,
    | 'apply_unique_final_evidence'
    | 'reconfirm_and_pause'
    | 'break_glass_relinquish'
>;

type ResolutionTransitionContract = readonly [
    ResolutionStateEntityKind,
    string,
    string,
    string,
    string,
];

const MANUAL_TRANSITION_CONTRACTS: Readonly<
    Record<StateBoundManualResolutionOperation, readonly ResolutionTransitionContract[]>
> = Object.freeze({
    reconfirm_and_pause: Object.freeze([
        ['strategy', 'STR-010', 'manual_intervention', 'paused', 'MANUAL_RESOLUTION_RECONFIRMED'],
        ['resolution_case', 'RC-005', 'decision_required', 'resolved_by_reconfirmation', 'RESOLUTION_CASE_RESOLVED_RECONFIRMED'],
    ] as const),
    apply_unique_final_evidence: Object.freeze([
        ['order_intent', 'INT-011', 'reconciling', 'terminal', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['order_intent', 'INT-014', 'unknown', 'terminal', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['activation', 'ACT-015C', 'unknown', 'filled', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['activation', 'ACT-015D', 'unknown', 'cancelled', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['activation', 'ACT-015E', 'unknown', 'failed', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['pending_protection_commitment', 'PPC-010B', 'unknown', 'materialized', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['pending_protection_commitment', 'PPC-010C', 'unknown', 'zero_fill_terminal', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-013E', 'safety_blocked', 'fulfilled', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-013F', 'safety_blocked', 'zero_fill_terminal', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['entry_exposure_reservation', 'EER-006B', 'unknown', 'consumed', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['entry_exposure_reservation', 'EER-006C', 'unknown', 'released', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['exit_claim', 'EXC-010B', 'unknown', 'consumed', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['exit_claim', 'EXC-010C', 'unknown', 'released', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['external_sell_claim', 'EXC-010B', 'unknown', 'consumed', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['external_sell_claim', 'EXC-010C', 'unknown', 'released', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['resolution_case', 'RC-004A', 'open', 'resolved_by_final_evidence', 'RESOLUTION_CASE_RESOLVED_FINAL_EVIDENCE'],
        ['resolution_case', 'RC-004B', 'evidence_collecting', 'resolved_by_final_evidence', 'RESOLUTION_CASE_RESOLVED_FINAL_EVIDENCE'],
        ['resolution_case', 'RC-004C', 'decision_required', 'resolved_by_final_evidence', 'RESOLUTION_CASE_RESOLVED_FINAL_EVIDENCE'],
    ] as const),
    break_glass_relinquish: Object.freeze([
        ['order_intent', 'INT-011', 'reconciling', 'terminal', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['order_intent', 'INT-014', 'unknown', 'terminal', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['activation', 'ACT-015E', 'unknown', 'failed', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['pending_protection_commitment', 'PPC-011', 'unknown', 'released_manual', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['protection_obligation', 'POB-014', 'safety_blocked', 'released_manual', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['entry_exposure_reservation', 'EER-006C', 'unknown', 'released', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['exit_claim', 'EXC-010C', 'unknown', 'released', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['external_sell_claim', 'EXC-010C', 'unknown', 'released', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['resolution_case', 'RC-006', 'decision_required', 'relinquished_unknown', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        ['runtime_epoch', 'RTE-016', 'quiescing', 'failed_stop', 'RUNTIME_BREAK_GLASS_FORCED_STOP'],
    ] as const),
});

const BLOCKING_TRANSITION_CONTRACTS: Readonly<
    Record<BlockingStateResolutionOperation, readonly ResolutionTransitionContract[]>
> = Object.freeze({
    apply_canonical_projection_keep_blocked: Object.freeze([
        ['order_intent', 'INT-010', 'reconciling', 'acknowledged', 'BROKER_WORKING_EVIDENCE_APPLIED'],
        ['broker_order', 'BRO-001B', 'unknown', 'pending_submit', 'BROKER_PENDING_SUBMIT_OBSERVED'],
        ['broker_order', 'BRO-002C', 'unknown', 'pre_submitted', 'BROKER_PRE_SUBMITTED_OBSERVED'],
        ['broker_order', 'BRO-003D', 'unknown', 'submitted', 'BROKER_SUBMITTED_OBSERVED'],
        ['broker_order', 'BRO-004E', 'unknown', 'part_filled', 'BROKER_RECONCILIATION_EVIDENCE_APPLIED'],
        ['activation', 'ACT-015A', 'unknown', 'working', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['activation', 'ACT-015B', 'unknown', 'part_filled', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['pending_protection_commitment', 'PPC-010A', 'unknown', 'materializing', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-012A', 'reconciling', 'pending_entry', 'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-012B', 'reconciling', 'monitoring', 'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-012C', 'reconciling', 'exit_working', 'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-012D', 'reconciling', 'partially_exited', 'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED'],
        ['exit_claim', 'EXC-010A', 'unknown', 'broker_working', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['external_sell_claim', 'EXC-010A', 'unknown', 'broker_working', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
    ] as const),
    apply_canonical_resolution_final: Object.freeze([
        ['protection_obligation', 'POB-013A', 'safety_blocked', 'pending_entry', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-013B', 'safety_blocked', 'monitoring', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-013C', 'safety_blocked', 'exit_working', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-013D', 'safety_blocked', 'partially_exited', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
        ['entry_exposure_reservation', 'EER-006A', 'unknown', 'partially_consumed', 'MANUAL_FINAL_EVIDENCE_APPLIED'],
    ] as const),
    apply_unique_final_evidence: Object.freeze([
        ['broker_order', 'BRO-005E', 'unknown', 'filled', 'BROKER_RECONCILIATION_EVIDENCE_APPLIED'],
        ['broker_order', 'BRO-006E', 'unknown', 'cancelled', 'BROKER_RECONCILIATION_EVIDENCE_APPLIED'],
        ['broker_order', 'BRO-007E', 'unknown', 'inactive', 'BROKER_RECONCILIATION_EVIDENCE_APPLIED'],
        ['broker_order', 'BRO-008E', 'unknown', 'failed', 'BROKER_RECONCILIATION_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-012E', 'reconciling', 'fulfilled', 'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED'],
        ['protection_obligation', 'POB-012F', 'reconciling', 'zero_fill_terminal', 'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED'],
    ] as const),
    resolve_safety_blocker: Object.freeze([
        ['safety_blocker', 'SB-002', 'open', 'resolved', 'SAFETY_BLOCKER_RESOLVED'],
        ['safety_blocker', 'SB-002', 'open', 'resolved', 'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED'],
    ] as const),
    supersede_safety_blocker: Object.freeze([
        ['safety_blocker', 'SB-003', 'open', 'superseded_by_stricter_blocker', 'SAFETY_BLOCKER_OPENED'],
    ] as const),
});

function transitionContractMatches(
    contract: ResolutionTransitionContract,
    binding: ResolutionStateTransitionBinding,
): boolean {
    return (
        contract[0] === binding.entityKind &&
        contract[1] === binding.edgeId &&
        contract[2] === binding.fromState &&
        contract[3] === binding.toState &&
        contract[4] === binding.transitionReasonCode
    );
}

export function manualResolutionOperationForTransition(
    binding: ResolutionStateTransitionBinding,
): StateBoundManualResolutionOperation | undefined {
    for (const operation of Object.keys(
        MANUAL_TRANSITION_CONTRACTS,
    ) as StateBoundManualResolutionOperation[]) {
        if (
            MANUAL_TRANSITION_CONTRACTS[operation].some((contract) =>
                transitionContractMatches(contract, binding),
            )
        ) {
            return operation;
        }
    }
    return undefined;
}

export function blockingResolutionOperationForTransition(
    binding: ResolutionStateTransitionBinding,
): BlockingStateResolutionOperation | undefined {
    for (const operation of Object.keys(
        BLOCKING_TRANSITION_CONTRACTS,
    ) as BlockingStateResolutionOperation[]) {
        if (
            BLOCKING_TRANSITION_CONTRACTS[operation].some((contract) =>
                transitionContractMatches(contract, binding),
            )
        ) {
            return operation;
        }
    }
    return undefined;
}

function freezeTransitionBinding(
    binding: ResolutionStateTransitionBinding,
): Readonly<ResolutionStateTransitionBinding> {
    if (binding.kind !== 'state_transition') {
        return fail('resolution execution boundary must be a state transition');
    }
    return Object.freeze({
        kind: 'state_transition',
        entityKind: binding.entityKind,
        entityId: token(binding.entityId, 'resolution transition entityId'),
        lineageId: token(binding.lineageId, 'resolution transition lineageId'),
        lineageGeneration: safeInteger(
            binding.lineageGeneration,
            'resolution transition lineageGeneration',
        ),
        expectedRevision: safeInteger(
            binding.expectedRevision,
            'resolution transition expectedRevision',
        ),
        effectProjectionSha256: digest(
            binding.effectProjectionSha256,
            'resolution transition effectProjectionSha256',
        ),
        edgeId: token(binding.edgeId, 'resolution transition edgeId'),
        fromState: token(binding.fromState, 'resolution transition fromState'),
        toState: token(binding.toState, 'resolution transition toState'),
        transitionReasonCode: token(
            binding.transitionReasonCode,
            'resolution transition reasonCode',
        ),
    });
}

function tryFreezeTransitionBinding(
    binding: ResolutionStateTransitionBinding,
): Readonly<ResolutionStateTransitionBinding> | undefined {
    try {
        return freezeTransitionBinding(binding);
    } catch {
        return undefined;
    }
}

function resolutionExecutionBoundary(
    operation: Exclude<ManualResolutionOperation, 'generic_resume'>,
    boundary: ResolutionExecutionBoundary | undefined,
    context: VerifiedResolutionRuntimeContext,
): Readonly<ResolutionExecutionBoundary> | undefined {
    const serviceOperations: readonly ResolutionServiceOperation[] = [
        'cancel_strategy',
        'copy_to_new_draft',
        'repair_gate_observe_only',
        'remain_open',
    ];
    if (!boundary || typeof boundary !== 'object') return undefined;
    if ((serviceOperations as readonly string[]).includes(operation)) {
        if (
            boundary.kind !== 'resolution_service' ||
            boundary.operation !== operation ||
            boundary.resolutionCaseId !== context.resolutionCaseId ||
            boundary.caseRevision !== context.caseRevision
        ) {
            return undefined;
        }
        const expectedSourceKind: ResolutionServiceExecutionBoundary['sourceEntityKind'] =
            operation === 'repair_gate_observe_only'
                ? 'runtime_epoch'
                : operation === 'remain_open'
                  ? 'resolution_case'
                  : 'strategy';
        if (boundary.sourceEntityKind !== expectedSourceKind) return undefined;
        try {
            return Object.freeze({
                kind: 'resolution_service',
                operation: boundary.operation,
                resolutionCaseId: token(
                    boundary.resolutionCaseId,
                    'resolution service resolutionCaseId',
                ),
                caseRevision: safeInteger(
                    boundary.caseRevision,
                    'resolution service caseRevision',
                ),
                sourceEntityKind: boundary.sourceEntityKind,
                sourceEntityId: token(
                    boundary.sourceEntityId,
                    'resolution service sourceEntityId',
                ),
                sourceEntityExpectedRevision: safeInteger(
                    boundary.sourceEntityExpectedRevision,
                    'resolution service sourceEntityExpectedRevision',
                ),
                serviceRequestSha256: digest(
                    boundary.serviceRequestSha256,
                    'resolution service request digest',
                ),
            });
        } catch {
            return undefined;
        }
    }
    if (boundary.kind !== 'state_transition') return undefined;
    const frozen = tryFreezeTransitionBinding(boundary);
    if (!frozen) return undefined;
    return manualResolutionOperationForTransition(frozen) === operation
        ? frozen
        : undefined;
}

function resolutionDecisionTargetKey(
    context: VerifiedResolutionRuntimeContext,
    boundary: ResolutionExecutionBoundary,
): string {
    const prefix = [
        context.resolutionCaseId,
        context.caseRevision,
        context.targetSideEffectSha256,
    ].join('|');
    return boundary.kind === 'state_transition'
        ? [
              prefix,
              'state_transition',
              boundary.entityKind,
              boundary.entityId,
              boundary.lineageId,
              boundary.lineageGeneration,
              boundary.expectedRevision,
          ].join('|')
        : [
              prefix,
              'resolution_service',
              boundary.sourceEntityKind,
              boundary.sourceEntityId,
              boundary.sourceEntityExpectedRevision,
          ].join('|');
}

function monotonicNowMs(): number {
    const value = globalThis.performance?.now();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return fail('monotonic clock is unavailable');
    }
    return value;
}

function isSmartOrderDomainTestBuild(): boolean {
    return SMART_ORDER_DOMAIN_TEST_MODE;
}

function requireTestIssuer(): void {
    if (!isSmartOrderDomainTestBuild()) {
        return fail('test-only resolution evidence issuer is unavailable');
    }
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
        .join(',')}}`;
}

function bytesToHex(value: ArrayBuffer): string {
    return Array.from(new Uint8Array(value), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
}

async function sha256(value: string): Promise<`sha256:${string}`> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return fail('WebCrypto is unavailable');
    const result = await subtle.digest('SHA-256', new TextEncoder().encode(value));
    return `sha256:${bytesToHex(result)}`;
}

const UNKNOWN_BROKER_EVIDENCE = [
    'broker_full_orders_trades_deals',
    'broker_position_and_working_set',
    'canonical_broker_correlation',
] as const satisfies readonly ResolutionEvidenceClass[];

function row(
    input: Omit<ManualResolutionMatrixRow, 'oldIntentDisposition'>,
): ManualResolutionMatrixRow {
    return Object.freeze({
        ...input,
        requiredEvidence: Object.freeze([...input.requiredEvidence]),
        allowedOperations: Object.freeze([...input.allowedOperations]),
        destinations: Object.freeze([...input.destinations]),
        oldIntentDisposition: 'never_resend',
    });
}

export const MANUAL_RESOLUTION_MATRIX: readonly ManualResolutionMatrixRow[] =
    Object.freeze([
        row({
            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            requiredEvidence: UNKNOWN_BROKER_EVIDENCE,
            allowedOperations: [
                'apply_unique_final_evidence',
                'break_glass_relinquish',
                'remain_open',
            ],
            destinations: [
                'paused',
                'resolution_case_open',
                'resolution_case_relinquished_unknown',
            ],
            rearmPolicy: 'never',
            obligationPolicy: 'settle_from_unique_final_quantities',
            breakGlassAllowed: true,
        }),
        row({
            reasonCode: 'BROKER_CORRELATION_AMBIGUOUS',
            requiredEvidence: UNKNOWN_BROKER_EVIDENCE,
            allowedOperations: [
                'apply_unique_final_evidence',
                'break_glass_relinquish',
                'remain_open',
            ],
            destinations: [
                'paused',
                'resolution_case_open',
                'resolution_case_relinquished_unknown',
            ],
            rearmPolicy: 'never',
            obligationPolicy: 'preserve_unknown_and_block',
            breakGlassAllowed: true,
        }),
        row({
            reasonCode: 'BROKER_ACCOUNT_MISMATCH',
            requiredEvidence: [
                'fixed_account_subscription',
                'broker_full_orders_trades_deals',
                'canonical_broker_correlation',
            ],
            allowedOperations: ['apply_unique_final_evidence', 'remain_open'],
            destinations: ['paused', 'resolution_case_open'],
            rearmPolicy: 'never',
            obligationPolicy: 'preserve_unknown_and_block',
            breakGlassAllowed: false,
        }),
        row({
            reasonCode: 'BROKER_FINAL_EVIDENCE_CONFLICT',
            requiredEvidence: [
                'immutable_evidence_hashes',
                'broker_full_orders_trades_deals',
                'broker_position_and_working_set',
            ],
            allowedOperations: ['apply_unique_final_evidence', 'remain_open'],
            destinations: ['terminal_entity_unchanged', 'resolution_case_open'],
            rearmPolicy: 'never',
            obligationPolicy: 'recompute_after_full_reconciliation',
            breakGlassAllowed: false,
        }),
        row({
            reasonCode: 'ACTIVATION_ID_CONFLICT',
            requiredEvidence: [
                'immutable_evidence_hashes',
                'activation_key_and_unique_index_audit',
                'canonical_broker_correlation',
                'broker_position_and_working_set',
            ],
            allowedOperations: ['apply_unique_final_evidence', 'remain_open'],
            destinations: ['terminal_entity_unchanged', 'resolution_case_open'],
            rearmPolicy: 'never',
            obligationPolicy: 'recompute_after_full_reconciliation',
            breakGlassAllowed: false,
        }),
        row({
            reasonCode: 'ENTRY_RESULT_UNKNOWN',
            requiredEvidence: [
                ...UNKNOWN_BROKER_EVIDENCE,
                'entry_cumulative_fill_projection',
            ],
            allowedOperations: [
                'apply_unique_final_evidence',
                'break_glass_relinquish',
                'remain_open',
            ],
            destinations: [
                'paused',
                'resolution_case_open',
                'resolution_case_relinquished_unknown',
            ],
            rearmPolicy: 'never',
            obligationPolicy: 'settle_from_unique_final_quantities',
            breakGlassAllowed: true,
        }),
        row({
            reasonCode: 'EXIT_CLAIM_UNKNOWN',
            requiredEvidence: [
                ...UNKNOWN_BROKER_EVIDENCE,
                'exit_claim_remainder_projection',
            ],
            allowedOperations: [
                'apply_unique_final_evidence',
                'break_glass_relinquish',
                'remain_open',
            ],
            destinations: [
                'paused',
                'resolution_case_open',
                'resolution_case_relinquished_unknown',
            ],
            rearmPolicy: 'new_remainder_generation_after_reconciliation',
            obligationPolicy: 'rebuild_only_as_new_claim_generation',
            breakGlassAllowed: true,
        }),
        row({
            reasonCode: 'EXTERNAL_POSITION_DRIFT',
            requiredEvidence: [
                'full_position_unit_reconciliation',
                'full_external_working_set',
                'fresh_confirmation_snapshot',
            ],
            allowedOperations: [
                'reconfirm_and_pause',
                'cancel_strategy',
                'copy_to_new_draft',
                'remain_open',
            ],
            destinations: ['paused', 'cancel_pending', 'resolution_case_open'],
            rearmPolicy: 'new_confirmation_and_user_arm',
            obligationPolicy: 'recompute_after_full_reconciliation',
            breakGlassAllowed: false,
        }),
        row({
            reasonCode: 'QUOTE_GAP_CROSSING_UNKNOWN',
            requiredEvidence: ['eligible_observation_gap_evidence'],
            allowedOperations: [
                'reconfirm_and_pause',
                'cancel_strategy',
                'copy_to_new_draft',
                'remain_open',
            ],
            destinations: ['paused', 'cancel_pending', 'resolution_case_open'],
            rearmPolicy: 'new_arm_generation_after_fresh_false',
            obligationPolicy: 'preserve_existing_broker_obligations',
            breakGlassAllowed: false,
        }),
        row({
            reasonCode: 'TRAILING_GAP_EXTREME_UNKNOWN',
            requiredEvidence: [
                'eligible_observation_gap_evidence',
                'broker_position_and_working_set',
            ],
            allowedOperations: [
                'cancel_strategy',
                'copy_to_new_draft',
                'break_glass_relinquish',
                'remain_open',
            ],
            destinations: [
                'cancel_pending',
                'resolution_case_open',
                'resolution_case_relinquished_unknown',
            ],
            rearmPolicy: 'never',
            obligationPolicy: 'release_only_with_durable_unknown_exposure_blocker',
            breakGlassAllowed: true,
        }),
        row({
            reasonCode: 'POSITION_OR_UNIT_UNKNOWN',
            requiredEvidence: [
                'full_position_unit_reconciliation',
                'broker_position_and_working_set',
                'new_runtime_epoch_reconciliation',
            ],
            allowedOperations: ['repair_gate_observe_only', 'remain_open'],
            destinations: ['observe_only', 'resolution_case_open'],
            rearmPolicy: 'new_runtime_epoch_and_user_arm',
            obligationPolicy: 'preserve_unknown_and_block',
            breakGlassAllowed: false,
        }),
        row({
            reasonCode: 'PROTECTION_UNPROTECTED_REMAINDER',
            requiredEvidence: [
                'current_protection_remainder_snapshot',
                'full_position_unit_reconciliation',
                'full_external_working_set',
            ],
            allowedOperations: [
                'reconfirm_and_pause',
                'break_glass_relinquish',
                'remain_open',
            ],
            destinations: [
                'paused',
                'resolution_case_open',
                'resolution_case_relinquished_unknown',
            ],
            rearmPolicy: 'new_remainder_generation_after_reconciliation',
            obligationPolicy: 'rebuild_only_as_new_claim_generation',
            breakGlassAllowed: true,
        }),
        row({
            reasonCode: 'DB_INTEGRITY_FAILED',
            requiredEvidence: [
                'verified_database_restore_integrity',
                'single_writer_fence_evidence',
                'broker_full_orders_trades_deals',
                'broker_position_and_working_set',
            ],
            allowedOperations: ['repair_gate_observe_only', 'remain_open'],
            destinations: ['observe_only', 'resolution_case_open'],
            rearmPolicy: 'new_runtime_epoch_and_user_arm',
            obligationPolicy: 'recompute_after_full_reconciliation',
            breakGlassAllowed: false,
        }),
        row({
            reasonCode: 'IDENTITY_MAPPING_CONFLICT',
            requiredEvidence: [
                'identity_mapping_and_key_audit',
                'broker_position_and_working_set',
            ],
            allowedOperations: ['repair_gate_observe_only', 'remain_open'],
            destinations: ['observe_only', 'resolution_case_open'],
            rearmPolicy: 'new_runtime_epoch_and_user_arm',
            obligationPolicy: 'preserve_unknown_and_block',
            breakGlassAllowed: false,
        }),
    ]);

const rowByReason = new Map(
    MANUAL_RESOLUTION_MATRIX.map((item) => [item.reasonCode, item]),
);

if (
    rowByReason.size !== MANUAL_INTERVENTION_REASON_CODES.length ||
    MANUAL_INTERVENTION_REASON_CODES.some((reason) => !rowByReason.has(reason))
) {
    fail('manual resolution matrix reason coverage is incomplete');
}

const manualReasonCodes = new Set<string>(MANUAL_INTERVENTION_REASON_CODES);

function isManualInterventionReasonCode(
    reasonCode: BlockingResolutionReasonCode,
): reasonCode is ManualInterventionReasonCode {
    return manualReasonCodes.has(reasonCode);
}

const canonicalBlockingEvidenceByReason: Readonly<
    Record<
        CanonicalBlockingResolutionReasonCode,
        readonly ResolutionEvidenceClass[]
    >
> = Object.freeze({
    BROKER_RESPONSE_LOST_RECONCILE: UNKNOWN_BROKER_EVIDENCE,
    BROKER_TARGET_REVISION_CHANGED: UNKNOWN_BROKER_EVIDENCE,
    ACKNOWLEDGED_RECONCILIATION_REQUIRED: UNKNOWN_BROKER_EVIDENCE,
    BROKER_STATE_UNKNOWN: UNKNOWN_BROKER_EVIDENCE,
    PROTECTION_RECONCILIATION_REQUIRED: Object.freeze([
        'current_protection_remainder_snapshot',
        'full_position_unit_reconciliation',
        'full_external_working_set',
    ] as const),
    EXTERNAL_WORKING_SET_INCOMPLETE: Object.freeze([
        'broker_position_and_working_set',
        'full_external_working_set',
    ] as const),
    ENTRY_RESERVATION_UNKNOWN: Object.freeze([
        ...UNKNOWN_BROKER_EVIDENCE,
        'entry_cumulative_fill_projection',
    ] as const),
    SIMULATION_ATTESTATION_FAILED: Object.freeze([
        'new_runtime_epoch_reconciliation',
        'mode_generation_manifest_reconciliation',
        'fixed_account_subscription',
    ] as const),
    MODE_GENERATION_CHANGED: Object.freeze([
        'new_runtime_epoch_reconciliation',
        'mode_generation_manifest_reconciliation',
        'fixed_account_subscription',
    ] as const),
    GATE_MANIFEST_INVALID: Object.freeze([
        'new_runtime_epoch_reconciliation',
        'mode_generation_manifest_reconciliation',
        'fixed_account_subscription',
    ] as const),
});

const SAFETY_BLOCKER_REASON_POLICY: Readonly<
    Record<
        SafetyBlockerResolutionKind,
        readonly BlockingResolutionReasonCode[]
    >
> = Object.freeze({
    unknown_broker_side_effect: Object.freeze([
        'BROKER_OUTCOME_UNKNOWN',
        'BROKER_CORRELATION_AMBIGUOUS',
        'BROKER_ACCOUNT_MISMATCH',
        'ENTRY_RESULT_UNKNOWN',
        'EXIT_CLAIM_UNKNOWN',
        'BROKER_RESPONSE_LOST_RECONCILE',
        'BROKER_TARGET_REVISION_CHANGED',
        'ACKNOWLEDGED_RECONCILIATION_REQUIRED',
        'BROKER_STATE_UNKNOWN',
        'ENTRY_RESERVATION_UNKNOWN',
    ] as const),
    terminal_evidence_conflict: Object.freeze([
        'BROKER_FINAL_EVIDENCE_CONFLICT',
        'ACTIVATION_ID_CONFLICT',
    ] as const),
    relinquished_unknown_exposure: Object.freeze([
        'BROKER_OUTCOME_UNKNOWN',
        'BROKER_CORRELATION_AMBIGUOUS',
        'ENTRY_RESULT_UNKNOWN',
        'EXIT_CLAIM_UNKNOWN',
        'TRAILING_GAP_EXTREME_UNKNOWN',
        'PROTECTION_UNPROTECTED_REMAINDER',
        'BROKER_RESPONSE_LOST_RECONCILE',
        'ACKNOWLEDGED_RECONCILIATION_REQUIRED',
        'BROKER_STATE_UNKNOWN',
        'PROTECTION_RECONCILIATION_REQUIRED',
        'ENTRY_RESERVATION_UNKNOWN',
    ] as const),
    position_or_unit_conflict: Object.freeze([
        'EXTERNAL_POSITION_DRIFT',
        'POSITION_OR_UNIT_UNKNOWN',
        'ENTRY_RESERVATION_UNKNOWN',
    ] as const),
    external_working_set_incomplete: Object.freeze([
        'EXTERNAL_WORKING_SET_INCOMPLETE',
    ] as const),
    identity_mapping_conflict: Object.freeze([
        'IDENTITY_MAPPING_CONFLICT',
    ] as const),
    db_integrity_unverified: Object.freeze(['DB_INTEGRITY_FAILED'] as const),
    mode_generation_conflict: Object.freeze([
        'SIMULATION_ATTESTATION_FAILED',
        'MODE_GENERATION_CHANGED',
        'GATE_MANIFEST_INVALID',
    ] as const),
});

const SAFETY_BLOCKER_EVIDENCE_POLICY: Readonly<
    Record<SafetyBlockerResolutionKind, readonly ResolutionEvidenceClass[]>
> = Object.freeze({
    unknown_broker_side_effect: Object.freeze([
        'broker_position_and_working_set',
        'full_external_working_set',
    ] as const),
    terminal_evidence_conflict: Object.freeze([
        'immutable_evidence_hashes',
        'broker_full_orders_trades_deals',
        'broker_position_and_working_set',
    ] as const),
    relinquished_unknown_exposure: Object.freeze([
        'broker_position_and_working_set',
        'full_external_working_set',
    ] as const),
    position_or_unit_conflict: Object.freeze([
        'full_position_unit_reconciliation',
        'broker_position_and_working_set',
    ] as const),
    external_working_set_incomplete: Object.freeze([
        'broker_position_and_working_set',
        'full_external_working_set',
    ] as const),
    identity_mapping_conflict: Object.freeze([
        'identity_mapping_and_key_audit',
        'broker_position_and_working_set',
    ] as const),
    db_integrity_unverified: Object.freeze([
        'verified_database_restore_integrity',
        'single_writer_fence_evidence',
        'broker_full_orders_trades_deals',
        'broker_position_and_working_set',
        'full_external_working_set',
    ] as const),
    mode_generation_conflict: Object.freeze([
        'new_runtime_epoch_reconciliation',
        'mode_generation_manifest_reconciliation',
        'single_writer_fence_evidence',
        'fixed_account_subscription',
        'broker_position_and_working_set',
    ] as const),
});

export function getSafetyBlockerResolutionRequiredEvidence(
    blockerKind: SafetyBlockerResolutionKind,
    resolutionPath: SafetyBlockerResolutionPath,
): readonly ResolutionEvidenceClass[] {
    const policy = SAFETY_BLOCKER_EVIDENCE_POLICY[blockerKind];
    if (!policy) return Object.freeze([]);
    const required = [
        ...policy,
        ...(resolutionPath === 'gate_approved_zero_exposure_bounds'
            ? (['gate_approved_zero_exposure_bounds'] as const)
            : []),
        ...(resolutionPath === 'supersede_strict_scope'
            ? (['canonical_safety_blocker_successor_binding'] as const)
            : []),
    ];
    return Object.freeze([...new Set(required)]);
}

export function isSafetyBlockerReasonAllowed(
    blockerKind: SafetyBlockerResolutionKind,
    reasonCode: BlockingResolutionReasonCode,
): boolean {
    const policy = SAFETY_BLOCKER_REASON_POLICY[blockerKind];
    return Boolean(policy?.includes(reasonCode));
}

function requiredEvidenceForResolutionReason(
    reasonCode: BlockingResolutionReasonCode,
): readonly ResolutionEvidenceClass[] | undefined {
    return isManualInterventionReasonCode(reasonCode)
        ? rowByReason.get(reasonCode)?.requiredEvidence
        : canonicalBlockingEvidenceByReason[reasonCode];
}

export function getBlockingResolutionRequiredEvidence(
    reasonCode: BlockingResolutionReasonCode,
): readonly ResolutionEvidenceClass[] {
    return Object.freeze([
        ...(requiredEvidenceForResolutionReason(reasonCode) ?? []),
    ]);
}

async function issueSafetyBlockerSuccessorBindingForTest(
    input: Omit<SafetyBlockerSuccessorBinding, 'bindingSha256'>,
): Promise<Readonly<SafetyBlockerSuccessorBinding>> {
    requireTestIssuer();
    if (!SAFETY_BLOCKER_EVIDENCE_POLICY[input.blockerKind]) {
        return fail('unknown SafetyBlocker successor kind');
    }
    const scope = freezeSafetyBlockerScopeBinding(
        input.scope,
        'safetyBlocker.successor.scope',
    );
    const canonical = Object.freeze({
        policyVersion: SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION,
        blockerId: token(
            input.blockerId,
            'safetyBlocker.successor.blockerId',
        ),
        blockerKind: input.blockerKind,
        resolutionCaseId: token(
            input.resolutionCaseId,
            'safetyBlocker.successor.resolutionCaseId',
        ),
        predecessorBlockerId: token(
            input.predecessorBlockerId,
            'safetyBlocker.successor.predecessorBlockerId',
        ),
        predecessorLineageId: token(
            input.predecessorLineageId,
            'safetyBlocker.successor.predecessorLineageId',
        ),
        lineageId: token(
            input.lineageId,
            'safetyBlocker.successor.lineageId',
        ),
        lineageGeneration: safeInteger(
            input.lineageGeneration,
            'safetyBlocker.successor.lineageGeneration',
        ),
        scope,
        ...(input.worstCasePositionDeltaShares !== undefined
            ? {
                  worstCasePositionDeltaShares:
                      optionalNonNegativeIntegerText(
                          input.worstCasePositionDeltaShares,
                          'safetyBlocker.successor.worstCasePositionDeltaShares',
                      )!,
              }
            : {}),
        ...(input.possiblyWorkingShares !== undefined
            ? {
                  possiblyWorkingShares: optionalNonNegativeIntegerText(
                      input.possiblyWorkingShares,
                      'safetyBlocker.successor.possiblyWorkingShares',
                  )!,
              }
            : {}),
    });
    const successor = Object.freeze({
        blockerId: canonical.blockerId,
        blockerKind: canonical.blockerKind,
        resolutionCaseId: canonical.resolutionCaseId,
        predecessorBlockerId: canonical.predecessorBlockerId,
        predecessorLineageId: canonical.predecessorLineageId,
        lineageId: canonical.lineageId,
        lineageGeneration: canonical.lineageGeneration,
        scope: canonical.scope,
        ...(canonical.worstCasePositionDeltaShares !== undefined
            ? {
                  worstCasePositionDeltaShares:
                      canonical.worstCasePositionDeltaShares,
              }
            : {}),
        ...(canonical.possiblyWorkingShares !== undefined
            ? {
                  possiblyWorkingShares:
                      canonical.possiblyWorkingShares,
              }
            : {}),
        bindingSha256: await sha256(stableJson(canonical)),
    });
    verifiedSafetyBlockerSuccessorBindings.add(successor);
    return successor;
}

function contextMatches(
    context: VerifiedResolutionRuntimeContext,
    value: {
        reasonCode: BlockingResolutionReasonCode;
        resolutionCaseId: string;
        caseRevision: number;
        scopeSha256: `sha256:${string}`;
        targetSideEffectSha256: `sha256:${string}`;
        runtimeEpochId: string;
        apiGeneration: string;
    },
): boolean {
    return (
        value.reasonCode === context.reasonCode &&
        value.resolutionCaseId === context.resolutionCaseId &&
        value.caseRevision === context.caseRevision &&
        value.scopeSha256 === context.scopeSha256 &&
        value.targetSideEffectSha256 === context.targetSideEffectSha256 &&
        value.runtimeEpochId === context.runtimeEpochId &&
        value.apiGeneration === context.apiGeneration
    );
}

function isCurrentResolutionContext(
    context: VerifiedResolutionRuntimeContext,
): boolean {
    if (
        !verifiedRuntimeContexts.has(context) ||
        monotonicNowMs() > context.validUntilMonotonicMs
    ) {
        return false;
    }
    const head = latestResolutionCaseHead.get(context.resolutionCaseId);
    return Boolean(head && contextMatches(context, {
        ...head,
        resolutionCaseId: context.resolutionCaseId,
    }));
}

function issueResolutionRuntimeContextForTest(input: {
    resolutionCaseId: string;
    caseRevision: number;
    reasonCode: BlockingResolutionReasonCode;
    scopeSha256: string;
    targetSideEffectSha256: string;
    runtimeEpochId: string;
    apiGeneration: string;
    nowEpochMs: number;
}): VerifiedResolutionRuntimeContext {
    requireTestIssuer();
    if (!requiredEvidenceForResolutionReason(input.reasonCode)) {
        return fail('unknown resolution reason');
    }
    const resolutionCaseId = token(input.resolutionCaseId, 'resolutionCaseId');
    const caseRevision = safeInteger(input.caseRevision, 'caseRevision');
    if (caseRevision < 1) return fail('caseRevision must be positive');
    const head = Object.freeze({
        caseRevision,
        reasonCode: input.reasonCode,
        scopeSha256: digest(input.scopeSha256, 'scopeSha256'),
        targetSideEffectSha256: digest(
            input.targetSideEffectSha256,
            'targetSideEffectSha256',
        ),
        runtimeEpochId: token(input.runtimeEpochId, 'runtimeEpochId'),
        apiGeneration: token(input.apiGeneration, 'apiGeneration'),
    });
    const current = latestResolutionCaseHead.get(resolutionCaseId);
    if (
        current &&
        (caseRevision < current.caseRevision ||
            (caseRevision === current.caseRevision &&
                stableJson(current) !== stableJson(head)))
    ) {
        return fail('resolution context does not match the canonical case head');
    }
    if (!current || caseRevision > current.caseRevision) {
        latestResolutionCaseHead.set(resolutionCaseId, head);
    }
    const issuedAtMonotonicMs = monotonicNowMs();
    const context = Object.freeze({
        resolutionCaseId,
        ...head,
        nowEpochMs: safeInteger(input.nowEpochMs, 'nowEpochMs'),
        issuedAtMonotonicMs,
        validUntilMonotonicMs:
            issuedAtMonotonicMs + SMART_ORDER_RESOLUTION_CONTEXT_TTL_MS,
    });
    verifiedRuntimeContexts.add(context);
    return context;
}

function issueResolutionEvidenceForTest(input: {
    context: VerifiedResolutionRuntimeContext;
    evidenceClass: ResolutionEvidenceClass;
    evidenceSha256: string;
    revision: string;
    finality?: 'not_final' | 'unique_broker_terminal';
}): VerifiedResolutionEvidence {
    requireTestIssuer();
    if (!isCurrentResolutionContext(input.context)) {
        return fail('resolution evidence context is untrusted or stale');
    }
    const finality = input.finality ?? 'not_final';
    const requiredEvidence = requiredEvidenceForResolutionReason(
        input.context.reasonCode,
    );
    if (!requiredEvidence) return fail('unknown resolution reason');
    if (
        finality === 'unique_broker_terminal' &&
        ![
            'broker_full_orders_trades_deals',
            'canonical_broker_correlation',
        ].includes(input.evidenceClass)
    ) {
        return fail(
            'unique final must be canonical broker terminal evidence',
        );
    }
    const evidence = Object.freeze({
        evidenceClass: input.evidenceClass,
        reasonCode: input.context.reasonCode,
        resolutionCaseId: input.context.resolutionCaseId,
        caseRevision: input.context.caseRevision,
        scopeSha256: input.context.scopeSha256,
        targetSideEffectSha256: input.context.targetSideEffectSha256,
        evidenceSha256: digest(input.evidenceSha256, 'evidenceSha256'),
        revision: token(input.revision, 'revision'),
        finality,
        runtimeEpochId: input.context.runtimeEpochId,
        apiGeneration: input.context.apiGeneration,
    });
    verifiedEvidence.add(evidence);
    return evidence;
}

async function issueResolutionEvidenceSetForTest(input: {
    context: VerifiedResolutionRuntimeContext;
    evidence: readonly VerifiedResolutionEvidence[];
}): Promise<VerifiedResolutionEvidenceSet> {
    requireTestIssuer();
    if (!isCurrentResolutionContext(input.context)) {
        return fail('resolution evidence set context is untrusted or stale');
    }
    if (input.evidence.length === 0) return fail('resolution evidence set is empty');
    const seen = new Set<string>();
    let uniqueFinalEvidenceSha256: `sha256:${string}` | undefined;
    const evidence = [...input.evidence]
        .map((item) => {
            if (!verifiedEvidence.has(item) || !contextMatches(input.context, item)) {
                return fail('resolution evidence set contains untrusted or stale evidence');
            }
            const key = `${item.evidenceClass}|${item.revision}`;
            if (seen.has(key)) return fail('duplicate resolution evidence revision');
            seen.add(key);
            if (item.finality === 'unique_broker_terminal') {
                if (uniqueFinalEvidenceSha256) {
                    return fail('resolution evidence has multiple unique final outcomes');
                }
                uniqueFinalEvidenceSha256 = item.evidenceSha256;
            }
            return item;
        })
        .sort((left, right) =>
            `${left.evidenceClass}|${left.revision}`.localeCompare(
                `${right.evidenceClass}|${right.revision}`,
            ),
        );
    const canonical = {
        reasonCode: input.context.reasonCode,
        resolutionCaseId: input.context.resolutionCaseId,
        caseRevision: input.context.caseRevision,
        scopeSha256: input.context.scopeSha256,
        targetSideEffectSha256: input.context.targetSideEffectSha256,
        runtimeEpochId: input.context.runtimeEpochId,
        apiGeneration: input.context.apiGeneration,
        evidence: evidence.map((item) => ({
            evidenceClass: item.evidenceClass,
            evidenceSha256: item.evidenceSha256,
            revision: item.revision,
            finality: item.finality,
        })),
    };
    const evidenceSet = Object.freeze({
        ...canonical,
        evidence: Object.freeze(evidence),
        evidenceSnapshotSha256: await sha256(stableJson(canonical)),
        ...(uniqueFinalEvidenceSha256 ? { uniqueFinalEvidenceSha256 } : {}),
    });
    verifiedEvidenceSets.add(evidenceSet);
    return evidenceSet;
}

interface ResolutionStepInput {
    readonly stepId: string;
    readonly confirmationLineageId: string;
    readonly nonce: string;
    readonly nonceRevision: number;
    readonly nonceState?: 'available' | 'consumed' | 'expired';
    readonly userConfirmationSha256: string;
}

async function buildResolutionStep(input: {
    kind: 'user_rearm' | 'lifecycle' | 'break_glass';
    stepIndex: 1 | 2;
    context: VerifiedResolutionRuntimeContext;
    evidenceSet: VerifiedResolutionEvidenceSet;
    step: ResolutionStepInput;
    freshConfirmationSha256?: string;
    previousStep?: VerifiedResolutionConfirmationStep;
}): Promise<VerifiedResolutionConfirmationStep> {
    if (
        !isManualInterventionReasonCode(input.context.reasonCode) ||
        !isCurrentResolutionContext(input.context) ||
        !verifiedEvidenceSets.has(input.evidenceSet) ||
        !contextMatches(input.context, input.evidenceSet)
    ) {
        return fail('resolution step context or evidence is untrusted');
    }
    const canonical = {
        kind: input.kind,
        reasonCode: input.context.reasonCode,
        resolutionCaseId: input.context.resolutionCaseId,
        caseRevision: input.context.caseRevision,
        scopeSha256: input.context.scopeSha256,
        targetSideEffectSha256: input.context.targetSideEffectSha256,
        evidenceSnapshotSha256: input.evidenceSet.evidenceSnapshotSha256,
        stepId: token(input.step.stepId, 'stepId'),
        confirmationLineageId: token(
            input.step.confirmationLineageId,
            'confirmationLineageId',
        ),
        stepIndex: input.stepIndex,
        nonce: token(input.step.nonce, 'nonce'),
        nonceRevision: safeInteger(input.step.nonceRevision, 'nonceRevision'),
        nonceState: input.step.nonceState ?? 'available',
        userConfirmationSha256: digest(
            input.step.userConfirmationSha256,
            'userConfirmationSha256',
        ),
        runtimeEpochId: input.context.runtimeEpochId,
        apiGeneration: input.context.apiGeneration,
        confirmedAtEpochMs: input.context.nowEpochMs,
        confirmedAtMonotonicMs: monotonicNowMs(),
        ...(input.freshConfirmationSha256
            ? {
                  freshConfirmationSha256: digest(
                      input.freshConfirmationSha256,
                      'freshConfirmationSha256',
                  ),
              }
            : {}),
        ...(input.previousStep
            ? { previousStepSha256: input.previousStep.stepSha256 }
            : {}),
    };
    const result = Object.freeze({
        ...canonical,
        stepSha256: await sha256(stableJson(canonical)),
    });
    verifiedConfirmationSteps.add(result);
    return result;
}

async function issueResolutionAuthorizationForTest(input: {
    kind: 'user_rearm' | 'lifecycle';
    context: VerifiedResolutionRuntimeContext;
    evidenceSet: VerifiedResolutionEvidenceSet;
    freshConfirmationSha256?: string;
    step: ResolutionStepInput;
}): Promise<VerifiedResolutionAuthorization> {
    requireTestIssuer();
    if (!isManualInterventionReasonCode(input.context.reasonCode)) {
        return fail('manual resolution authorization requires a manual reason');
    }
    if (input.kind === 'user_rearm' && !input.freshConfirmationSha256) {
        return fail('user rearm authorization requires a fresh confirmation');
    }
    const step = await buildResolutionStep({
        ...input,
        stepIndex: 1,
    });
    return buildResolutionAuthorization(input.context, input.evidenceSet, [step]);
}

async function issueBreakGlassStepOneForTest(input: {
    context: VerifiedResolutionRuntimeContext;
    evidenceSet: VerifiedResolutionEvidenceSet;
    step: ResolutionStepInput;
}): Promise<VerifiedResolutionConfirmationStep> {
    requireTestIssuer();
    if (
        !isManualInterventionReasonCode(input.context.reasonCode) ||
        !rowByReason.get(input.context.reasonCode)?.breakGlassAllowed
    ) {
        return fail('break-glass is forbidden for this resolution reason');
    }
    return buildResolutionStep({ ...input, kind: 'break_glass', stepIndex: 1 });
}

async function issueBreakGlassStepTwoForTest(input: {
    context: VerifiedResolutionRuntimeContext;
    evidenceSet: VerifiedResolutionEvidenceSet;
    stepOne: VerifiedResolutionConfirmationStep;
    step: ResolutionStepInput;
}): Promise<VerifiedResolutionConfirmationStep> {
    requireTestIssuer();
    if (
        !verifiedConfirmationSteps.has(input.stepOne) ||
        consumedResolutionSteps.has(input.stepOne) ||
        input.stepOne.kind !== 'break_glass' ||
        input.stepOne.stepIndex !== 1 ||
        !contextMatches(input.context, input.stepOne) ||
        input.stepOne.evidenceSnapshotSha256 !==
            input.evidenceSet.evidenceSnapshotSha256 ||
        input.context.nowEpochMs <= input.stepOne.confirmedAtEpochMs ||
        monotonicNowMs() <= input.stepOne.confirmedAtMonotonicMs ||
        input.step.confirmationLineageId !==
            input.stepOne.confirmationLineageId ||
        input.step.nonce === input.stepOne.nonce ||
        input.step.userConfirmationSha256 ===
            input.stepOne.userConfirmationSha256
    ) {
        return fail('break-glass second confirmation is not independently later');
    }
    return buildResolutionStep({
        ...input,
        kind: 'break_glass',
        stepIndex: 2,
        previousStep: input.stepOne,
    });
}

async function buildResolutionAuthorization(
    context: VerifiedResolutionRuntimeContext,
    evidenceSet: VerifiedResolutionEvidenceSet,
    steps: readonly VerifiedResolutionConfirmationStep[],
): Promise<VerifiedResolutionAuthorization> {
    if (
        !isManualInterventionReasonCode(context.reasonCode) ||
        !isCurrentResolutionContext(context) ||
        !verifiedEvidenceSets.has(evidenceSet) ||
        !contextMatches(context, evidenceSet) ||
        steps.length === 0 ||
        steps.some(
            (step) =>
                !verifiedConfirmationSteps.has(step) ||
                consumedResolutionSteps.has(step) ||
                !contextMatches(context, step) ||
                step.evidenceSnapshotSha256 !==
                    evidenceSet.evidenceSnapshotSha256 ||
                step.nonceState !== 'available',
        )
    ) {
        return fail('resolution authorization input is untrusted');
    }
    const first = steps[0]!;
    const canonical = {
        kind: first.kind,
        reasonCode: context.reasonCode,
        resolutionCaseId: context.resolutionCaseId,
        caseRevision: context.caseRevision,
        scopeSha256: context.scopeSha256,
        targetSideEffectSha256: context.targetSideEffectSha256,
        evidenceSnapshotSha256: evidenceSet.evidenceSnapshotSha256,
        runtimeEpochId: context.runtimeEpochId,
        apiGeneration: context.apiGeneration,
        authorizedAtEpochMs: context.nowEpochMs,
        validUntilMonotonicMs: context.validUntilMonotonicMs,
        ...(first.freshConfirmationSha256
            ? { freshConfirmationSha256: first.freshConfirmationSha256 }
            : {}),
        stepSha256: steps.map((step) => step.stepSha256),
    };
    const authorization = Object.freeze({
        ...canonical,
        authorizationSha256: await sha256(stableJson(canonical)),
        steps: Object.freeze([...steps]),
    });
    steps.forEach((step) => consumedResolutionSteps.add(step));
    verifiedAuthorizations.add(authorization);
    return authorization;
}

async function issueBreakGlassAuthorizationForTest(input: {
    context: VerifiedResolutionRuntimeContext;
    evidenceSet: VerifiedResolutionEvidenceSet;
    stepOne: VerifiedResolutionConfirmationStep;
    stepTwo: VerifiedResolutionConfirmationStep;
}): Promise<VerifiedResolutionAuthorization> {
    requireTestIssuer();
    if (
        input.stepOne.kind !== 'break_glass' ||
        input.stepTwo.kind !== 'break_glass' ||
        input.stepOne.stepIndex !== 1 ||
        input.stepTwo.stepIndex !== 2 ||
        input.stepTwo.previousStepSha256 !== input.stepOne.stepSha256 ||
        input.stepTwo.confirmedAtEpochMs <= input.stepOne.confirmedAtEpochMs ||
        input.stepTwo.confirmedAtMonotonicMs <=
            input.stepOne.confirmedAtMonotonicMs ||
        input.stepOne.userConfirmationSha256 ===
            input.stepTwo.userConfirmationSha256
    ) {
        return fail('break-glass confirmation chain is invalid');
    }
    return buildResolutionAuthorization(input.context, input.evidenceSet, [
        input.stepOne,
        input.stepTwo,
    ]);
}

function destinationFor(
    operation: Exclude<ManualResolutionOperation, 'generic_resume'>,
    reasonCode: ManualInterventionReasonCode,
): ResolutionDestination {
    switch (operation) {
        case 'apply_unique_final_evidence':
            return [
                'BROKER_FINAL_EVIDENCE_CONFLICT',
                'ACTIVATION_ID_CONFLICT',
            ].includes(reasonCode)
                ? 'terminal_entity_unchanged'
                : 'paused';
        case 'reconfirm_and_pause':
            return 'paused';
        case 'cancel_strategy':
            return 'cancel_pending';
        case 'copy_to_new_draft':
        case 'remain_open':
            return 'resolution_case_open';
        case 'repair_gate_observe_only':
            return 'observe_only';
        case 'break_glass_relinquish':
            return 'resolution_case_relinquished_unknown';
    }
}

export function evaluateManualResolution(input: {
    context: VerifiedResolutionRuntimeContext;
    operation: ManualResolutionOperation;
    evidenceSet: VerifiedResolutionEvidenceSet;
    authorization?: VerifiedResolutionAuthorization;
    executionBoundary: ResolutionExecutionBoundary;
}): ManualResolutionDecision {
    if (!isManualInterventionReasonCode(input.context.reasonCode)) {
        return Object.freeze({ allowed: false, reason: 'unknown_reason' });
    }
    const row = rowByReason.get(input.context.reasonCode);
    if (!row) return Object.freeze({ allowed: false, reason: 'unknown_reason' });
    if (!isCurrentResolutionContext(input.context)) {
        return Object.freeze({
            allowed: false,
            reason: 'resolution_context_untrusted_or_stale',
        });
    }
    if (input.operation === 'generic_resume') {
        return Object.freeze({
            allowed: false,
            reason: 'generic_resume_forbidden',
        });
    }
    if (!row.allowedOperations.includes(input.operation)) {
        return Object.freeze({ allowed: false, reason: 'operation_not_allowed' });
    }
    const executionBoundary = resolutionExecutionBoundary(
        input.operation,
        input.executionBoundary,
        input.context,
    );
    if (!executionBoundary) {
        return Object.freeze({
            allowed: false,
            reason: 'execution_boundary_mismatch',
        });
    }
    if (!verifiedEvidenceSets.has(input.evidenceSet)) {
        return Object.freeze({
            allowed: false,
            reason: 'evidence_snapshot_untrusted',
        });
    }
    if (
        !contextMatches(input.context, input.evidenceSet)
    ) {
        return Object.freeze({
            allowed: false,
            reason: 'evidence_scope_mismatch',
        });
    }
    const available = new Set(
        input.evidenceSet.evidence.map((item) => item.evidenceClass),
    );
    const missing = row.requiredEvidence.filter((item) => !available.has(item));
    if (missing.length > 0) {
        return Object.freeze({
            allowed: false,
            reason: 'required_evidence_missing',
            missingEvidence: Object.freeze(missing),
        });
    }
    if (
        input.operation === 'apply_unique_final_evidence' &&
        !input.evidenceSet.uniqueFinalEvidenceSha256
    ) {
        return Object.freeze({
            allowed: false,
            reason: 'unique_final_evidence_missing',
        });
    }

    let atomicConsume: readonly Readonly<{ nonce: string; revision: number }>[] =
        Object.freeze([]);
    if (
        input.operation === 'reconfirm_and_pause' ||
        input.operation === 'cancel_strategy' ||
        input.operation === 'copy_to_new_draft' ||
        input.operation === 'break_glass_relinquish' ||
        input.operation === 'repair_gate_observe_only'
    ) {
        if (
            !input.authorization ||
            !verifiedAuthorizations.has(input.authorization) ||
            consumedResolutionAuthorizations.has(input.authorization)
        ) {
            return Object.freeze({
                allowed: false,
                reason: 'authorization_untrusted',
            });
        }
        const requiredKind =
            input.operation === 'break_glass_relinquish'
                ? 'break_glass'
                : input.operation === 'reconfirm_and_pause'
                  ? 'user_rearm'
                  : 'lifecycle';
        if (
            input.authorization.kind !== requiredKind ||
            !contextMatches(input.context, input.authorization) ||
            input.authorization.evidenceSnapshotSha256 !==
                input.evidenceSet.evidenceSnapshotSha256 ||
            input.authorization.authorizedAtEpochMs !==
                input.context.nowEpochMs ||
            monotonicNowMs() > input.authorization.validUntilMonotonicMs
        ) {
            return Object.freeze({
                allowed: false,
                reason: 'authorization_mismatch',
            });
        }
        if (input.authorization.steps.some((step) => !verifiedConfirmationSteps.has(step))) {
            return Object.freeze({
                allowed: false,
                reason: 'authorization_untrusted',
            });
        }
        const expectedStepCount =
            input.operation === 'break_glass_relinquish' ? 2 : 1;
        if (input.authorization.steps.length !== expectedStepCount) {
            return Object.freeze({
                allowed: false,
                reason: 'second_confirmation_missing',
            });
        }
        const lineages = new Set(
            input.authorization.steps.map((step) => step.confirmationLineageId),
        );
        const stepIds = new Set(input.authorization.steps.map((step) => step.stepId));
        const nonces = new Set(input.authorization.steps.map((step) => step.nonce));
        if (
            lineages.size !== 1 ||
            stepIds.size !== expectedStepCount ||
            nonces.size !== expectedStepCount ||
            input.authorization.steps.some(
                (step, index) =>
                    step.kind !== requiredKind ||
                    !contextMatches(input.context, step) ||
                    step.evidenceSnapshotSha256 !==
                        input.evidenceSet.evidenceSnapshotSha256 ||
                    step.stepIndex !== index + 1,
            )
        ) {
            return Object.freeze({
                allowed: false,
                reason: 'confirmation_lineage_invalid',
            });
        }
        if (input.authorization.steps.some((step) => step.nonceState !== 'available')) {
            return Object.freeze({
                allowed: false,
                reason: 'authorization_nonce_unavailable',
            });
        }
        atomicConsume = Object.freeze(
            input.authorization.steps.map((step) =>
                Object.freeze({ nonce: step.nonce, revision: step.nonceRevision }),
            ),
        );
    }

    const destination = destinationFor(input.operation, input.context.reasonCode);
    if (!row.destinations.includes(destination)) {
        return Object.freeze({ allowed: false, reason: 'operation_not_allowed' });
    }
    const companions: AtomicResolutionCompanion[] = [];
    if (input.operation === 'apply_unique_final_evidence') {
        companions.push('resolution_case_terminal');
        if (
            [
                'settle_from_unique_final_quantities',
                'recompute_after_full_reconciliation',
                'rebuild_only_as_new_claim_generation',
            ].includes(row.obligationPolicy)
        ) {
            companions.push('reservation_claim_obligation_settlement');
        }
    }
    if (input.operation === 'reconfirm_and_pause') {
        companions.push('resolution_case_terminal', 'fresh_confirmation_snapshot');
        if (
            [
                'recompute_after_full_reconciliation',
                'rebuild_only_as_new_claim_generation',
            ].includes(row.obligationPolicy)
        ) {
            companions.push('reservation_claim_obligation_settlement');
        }
    }
    if (
        input.operation === 'apply_unique_final_evidence' &&
        ['BROKER_FINAL_EVIDENCE_CONFLICT', 'ACTIVATION_ID_CONFLICT'].includes(
            input.context.reasonCode,
        )
    ) {
        companions.push('terminal_evidence_correction');
    }
    if (input.operation === 'break_glass_relinquish') {
        companions.push(
            'resolution_case_terminal',
            'reservation_claim_obligation_settlement',
            'safety_blocker_open',
            'relinquished_unknown_exposure_open',
            'break_glass_audit_snapshot',
        );
    }
    if (input.operation === 'cancel_strategy') {
        companions.push('strategy_cancel_requested');
    }
    if (input.operation === 'copy_to_new_draft') {
        companions.push('copy_to_new_draft_created');
    }
    if (input.operation === 'repair_gate_observe_only') {
        companions.push('runtime_observe_only_blocker_open');
    }
    if (atomicConsume.length > 0) companions.push('burned_authorization_nonce');
    const decisionTargetKey = resolutionDecisionTargetKey(
        input.context,
        executionBoundary,
    );
    if (issuedResolutionDecisionTargets.has(decisionTargetKey)) {
        return Object.freeze({
            allowed: false,
            reason: 'decision_already_issued_for_target_revision',
        });
    }
    const decision = Object.freeze({
        allowed: true,
        decisionSchemaVersion: SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION,
        reasonCode: input.context.reasonCode,
        resolutionCaseId: input.context.resolutionCaseId,
        caseRevision: input.context.caseRevision,
        scopeSha256: input.context.scopeSha256,
        targetSideEffectSha256: input.context.targetSideEffectSha256,
        runtimeEpochId: input.context.runtimeEpochId,
        apiGeneration: input.context.apiGeneration,
        authorizedAtEpochMs: input.context.nowEpochMs,
        validUntilMonotonicMs: input.context.validUntilMonotonicMs,
        operation: input.operation,
        evidenceSnapshotSha256: input.evidenceSet.evidenceSnapshotSha256,
        ...(input.authorization?.freshConfirmationSha256
            ? {
                  freshConfirmationSha256:
                      input.authorization.freshConfirmationSha256,
              }
            : {}),
        ...(input.authorization
            ? { authorizationSha256: input.authorization.authorizationSha256 }
            : {}),
        confirmationSteps: Object.freeze(
            (input.authorization?.steps ?? []).map((step) =>
                Object.freeze({
                    stepIndex: step.stepIndex,
                    nonce: step.nonce,
                    nonceRevision: step.nonceRevision,
                    userConfirmationSha256: step.userConfirmationSha256,
                    stepSha256: step.stepSha256,
                }),
            ),
        ),
        executionBoundary,
        row,
        destination,
        oldIntentDisposition: 'never_resend',
        atomicConsume,
        atomicCompanions: Object.freeze(companions),
    });
    if (input.authorization) {
        consumedResolutionAuthorizations.add(input.authorization);
    }
    issuedResolutionDecisionTargets.add(decisionTargetKey);
    verifiedManualResolutionDecisions.add(decision);
    return decision;
}

export function evaluateBlockingStateResolution(input: {
    context: VerifiedResolutionRuntimeContext;
    operation: BlockingStateResolutionOperation;
    evidenceSet: VerifiedResolutionEvidenceSet;
    transitionBinding: ResolutionStateTransitionBinding;
    safetyBlockerResolutionBinding?: SafetyBlockerResolutionBinding;
}): BlockingStateResolutionDecision {
    const requiredEvidence = requiredEvidenceForResolutionReason(
        input.context.reasonCode,
    );
    if (!requiredEvidence) {
        return Object.freeze({ allowed: false, reason: 'unknown_reason' });
    }
    if (!isCurrentResolutionContext(input.context)) {
        return Object.freeze({
            allowed: false,
            reason: 'resolution_context_untrusted_or_stale',
        });
    }
    if (!verifiedEvidenceSets.has(input.evidenceSet)) {
        return Object.freeze({
            allowed: false,
            reason: 'evidence_snapshot_untrusted',
        });
    }
    if (!contextMatches(input.context, input.evidenceSet)) {
        return Object.freeze({
            allowed: false,
            reason: 'evidence_scope_mismatch',
        });
    }
    const available = new Set(
        input.evidenceSet.evidence.map((item) => item.evidenceClass),
    );
    const missing = requiredEvidence.filter((item) => !available.has(item));
    if (missing.length > 0) {
        return Object.freeze({
            allowed: false,
            reason: 'required_evidence_missing',
            missingEvidence: Object.freeze(missing),
        });
    }
    if (
        input.operation === 'apply_unique_final_evidence' &&
        !input.evidenceSet.uniqueFinalEvidenceSha256
    ) {
        return Object.freeze({
            allowed: false,
            reason: 'unique_final_evidence_missing',
        });
    }
    const isSafetyBlockerOperation =
        input.operation === 'resolve_safety_blocker' ||
        input.operation === 'supersede_safety_blocker';
    let safetyBlockerResolutionBinding:
        | Readonly<SafetyBlockerResolutionBinding>
        | undefined;
    if (isSafetyBlockerOperation) {
        if (!input.safetyBlockerResolutionBinding) {
            return Object.freeze({
                allowed: false,
                reason: 'safety_blocker_binding_missing',
            });
        }
        try {
            safetyBlockerResolutionBinding =
                freezeSafetyBlockerResolutionBinding(
                    input.safetyBlockerResolutionBinding,
                    input.operation,
                    input.context,
                    input.evidenceSet,
                );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return Object.freeze({
                allowed: false,
                reason: message.includes('strict superset')
                    ? 'successor_scope_not_strict_superset'
                    : 'safety_blocker_policy_mismatch',
            });
        }
    } else if (input.safetyBlockerResolutionBinding !== undefined) {
        return Object.freeze({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });
    }
    const transitionBinding = tryFreezeTransitionBinding(
        input.transitionBinding,
    );
    if (
        !transitionBinding ||
        blockingResolutionOperationForTransition(transitionBinding) !==
            input.operation
    ) {
        return Object.freeze({
            allowed: false,
            reason: 'execution_boundary_mismatch',
        });
    }
    if (
        safetyBlockerResolutionBinding &&
        (transitionBinding.entityKind !== 'safety_blocker' ||
            transitionBinding.entityId !==
                safetyBlockerResolutionBinding.blockerId ||
            transitionBinding.lineageId !==
                safetyBlockerResolutionBinding.lineageId ||
            transitionBinding.lineageGeneration !==
                safetyBlockerResolutionBinding.lineageGeneration)
    ) {
        return Object.freeze({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });
    }
    const decisionTargetKey = resolutionDecisionTargetKey(
        input.context,
        transitionBinding,
    );
    if (issuedResolutionDecisionTargets.has(decisionTargetKey)) {
        return Object.freeze({
            allowed: false,
            reason: 'decision_already_issued_for_target_revision',
        });
    }
    const decision = Object.freeze({
        allowed: true as const,
        decisionSchemaVersion: SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION,
        reasonCode: input.context.reasonCode,
        resolutionCaseId: input.context.resolutionCaseId,
        caseRevision: input.context.caseRevision,
        scopeSha256: input.context.scopeSha256,
        targetSideEffectSha256: input.context.targetSideEffectSha256,
        runtimeEpochId: input.context.runtimeEpochId,
        apiGeneration: input.context.apiGeneration,
        authorizedAtEpochMs: input.context.nowEpochMs,
        validUntilMonotonicMs: input.context.validUntilMonotonicMs,
        operation: input.operation,
        evidenceSnapshotSha256: input.evidenceSet.evidenceSnapshotSha256,
        evidenceClasses: Object.freeze(
            [...new Set(input.evidenceSet.evidence.map((item) => item.evidenceClass))].sort(),
        ),
        ...(input.evidenceSet.uniqueFinalEvidenceSha256
            ? {
                  uniqueFinalEvidenceSha256:
                      input.evidenceSet.uniqueFinalEvidenceSha256,
              }
            : {}),
        ...(safetyBlockerResolutionBinding
            ? { safetyBlockerResolutionBinding }
            : {}),
        transitionBinding,
        oldIntentDisposition: 'never_resend' as const,
    });
    issuedResolutionDecisionTargets.add(decisionTargetKey);
    verifiedBlockingStateResolutionDecisions.add(decision);
    return decision;
}

export function isVerifiedBlockingStateResolutionDecision(
    decision: unknown,
): decision is Readonly<VerifiedBlockingStateResolutionDecision> {
    if (
        typeof decision !== 'object' ||
        decision === null ||
        !verifiedBlockingStateResolutionDecisions.has(decision) ||
        consumedBlockingStateResolutionDecisions.has(decision)
    ) {
        return false;
    }
    const candidate = decision as VerifiedBlockingStateResolutionDecision;
    const head = latestResolutionCaseHead.get(candidate.resolutionCaseId);
    return Boolean(
        monotonicNowMs() <= candidate.validUntilMonotonicMs &&
            head &&
            candidate.caseRevision === head.caseRevision &&
            candidate.reasonCode === head.reasonCode &&
            candidate.scopeSha256 === head.scopeSha256 &&
            candidate.targetSideEffectSha256 ===
                head.targetSideEffectSha256 &&
            candidate.runtimeEpochId === head.runtimeEpochId &&
            candidate.apiGeneration === head.apiGeneration,
    );
}

export function consumeVerifiedBlockingStateResolutionDecision(
    decision: Readonly<VerifiedBlockingStateResolutionDecision>,
): boolean {
    if (!isVerifiedBlockingStateResolutionDecision(decision)) return false;
    consumedBlockingStateResolutionDecisions.add(decision);
    return true;
}

export function isVerifiedManualResolutionDecision(
    decision: unknown,
): decision is Readonly<VerifiedManualResolutionDecision> {
    if (
        typeof decision !== 'object' ||
        decision === null ||
        !verifiedManualResolutionDecisions.has(decision) ||
        consumedManualResolutionDecisions.has(decision)
    ) {
        return false;
    }
    const candidate = decision as VerifiedManualResolutionDecision;
    const head = latestResolutionCaseHead.get(candidate.resolutionCaseId);
    return Boolean(
        monotonicNowMs() <= candidate.validUntilMonotonicMs &&
            head &&
            candidate.caseRevision === head.caseRevision &&
            candidate.reasonCode === head.reasonCode &&
            candidate.scopeSha256 === head.scopeSha256 &&
            candidate.targetSideEffectSha256 ===
                head.targetSideEffectSha256 &&
            candidate.runtimeEpochId === head.runtimeEpochId &&
            candidate.apiGeneration === head.apiGeneration,
    );
}

/**
 * Marks one opaque resolution decision as consumed only after the caller has
 * completed every transition/companion validation for its atomic transaction.
 */
export function consumeVerifiedManualResolutionDecision(
    decision: Readonly<VerifiedManualResolutionDecision>,
): boolean {
    if (!isVerifiedManualResolutionDecision(decision)) return false;
    consumedManualResolutionDecisions.add(decision);
    return true;
}

/** Test-only verifier surface; every build command defines the marker false. */
export const SMART_ORDER_RESOLUTION_TEST_ONLY =
    isSmartOrderDomainTestBuild()
        ? Object.freeze({
              issueRuntimeContext: issueResolutionRuntimeContextForTest,
              issueEvidence: issueResolutionEvidenceForTest,
              issueEvidenceSet: issueResolutionEvidenceSetForTest,
              issueSafetyBlockerSuccessor:
                  issueSafetyBlockerSuccessorBindingForTest,
              issueAuthorization: issueResolutionAuthorizationForTest,
              issueBreakGlassStepOne: issueBreakGlassStepOneForTest,
              issueBreakGlassStepTwo: issueBreakGlassStepTwoForTest,
              issueBreakGlassAuthorization:
                  issueBreakGlassAuthorizationForTest,
          })
        : undefined;
