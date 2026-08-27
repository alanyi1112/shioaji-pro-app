/**
 * Pure smart-order state-machine contract.
 *
 * This module intentionally owns no repository, broker, API, UI, clock, or
 * feature authority.  It validates the durable transition record that a
 * repository transaction proposes to commit.
 */

import {
    MANUAL_INTERVENTION_REASON_CODES,
    blockingResolutionOperationForTransition,
    consumeVerifiedBlockingStateResolutionDecision,
    consumeVerifiedManualResolutionDecision,
    isVerifiedBlockingStateResolutionDecision,
    isVerifiedManualResolutionDecision,
    manualResolutionOperationForTransition,
    type BlockingStateResolutionOperation,
    type ManualInterventionReasonCode,
    type ResolutionStateTransitionBinding,
    type SafetyBlockerResolutionBinding,
    type SafetyBlockerResolutionKind,
    type VerifiedBlockingStateResolutionDecision,
    type VerifiedManualResolutionDecision,
} from './smart-order-resolution-domain';

export const SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION =
    'smart-order-state-transitions/2026-08-11.4' as const;
export const SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION =
    'smart-order-state-machine-implementation/2026-08-12.9' as const;
export const SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256 =
    'e788bb3981e4784ee797277a73257b1fb8e68899b0b2bacc93c76016b4926d0d' as const;
export const BROKER_ORDER_QUANTITY_EVIDENCE_SCHEMA_VERSION =
    'broker-order-quantity-evidence/2026-08-12.1' as const;

export type ActorKind =
    | 'runtime_evaluator'
    | 'runtime_dispatcher'
    | 'interactive_user'
    | 'broker_event_consumer'
    | 'reconciliation_service'
    | 'resolution_service'
    | 'lifecycle_service'
    | 'gate_runner';

export type BrokerWriteProvenance =
    | 'none'
    | 'manual_user_confirmed'
    | 'automation'
    | 'gate_probe';

export type WallTimeTrustStatus =
    | 'trusted'
    | 'degraded'
    | 'untrusted'
    | 'unknown';

export type StrategyState =
    | 'draft'
    | 'observing'
    | 'monitoring'
    | 'paused'
    | 'recovery'
    | 'manual_intervention'
    | 'cancel_pending'
    | 'expired_with_obligation'
    | 'completed'
    | 'cancelled'
    | 'expired';

export type ActivationState =
    | 'armed'
    | 'triggered'
    | 'prepared'
    | 'dispatching'
    | 'working'
    | 'part_filled'
    | 'unknown'
    | 'filled'
    | 'cancelled'
    | 'failed'
    | 'missed';

export type OrderIntentState =
    | 'prepared'
    | 'dispatching'
    | 'acknowledged'
    | 'reconciling'
    | 'unknown'
    | 'terminal';

export type BrokerOrderState =
    | 'pending_submit'
    | 'pre_submitted'
    | 'submitted'
    | 'part_filled'
    | 'unknown'
    | 'filled'
    | 'cancelled'
    | 'inactive'
    | 'failed';

export type PendingProtectionCommitmentState =
    | 'prepared'
    | 'entry_dispatching'
    | 'waiting_entry_result'
    | 'materializing'
    | 'unknown'
    | 'materialized'
    | 'zero_fill_terminal'
    | 'released_pre_dispatch'
    | 'released_manual';

export type ProtectionObligationState =
    | 'pending_entry'
    | 'monitoring'
    | 'exit_dispatching'
    | 'exit_working'
    | 'partially_exited'
    | 'reconciling'
    | 'safety_blocked'
    | 'fulfilled'
    | 'zero_fill_terminal'
    | 'released_manual';

export type EntryExposureReservationState =
    | 'reserved'
    | 'partially_consumed'
    | 'unknown'
    | 'consumed'
    | 'released';

export type ExitClaimState =
    | 'monitoring_reserved'
    | 'intent_reserved'
    | 'broker_working'
    | 'unknown'
    | 'consumed'
    | 'released';

export type RuntimeEpochState =
    | 'starting'
    | 'fenced'
    | 'reconciling'
    | 'observe_only'
    | 'ready_unarmed'
    | 'write_armed'
    | 'quiescing'
    | 'stopped'
    | 'failed_stop'
    | 'superseded';

export type DurableDispatchBlockerState =
    | 'open'
    | 'cleared_acknowledged'
    | 'cleared_terminal'
    | 'cleared_unknown_durable'
    | 'cleared_reconciling_durable';

export type SafetyBlockerState =
    | 'open'
    | 'resolved'
    | 'superseded_by_stricter_blocker';

export type ResolutionCaseState =
    | 'open'
    | 'evidence_collecting'
    | 'decision_required'
    | 'resolved_by_final_evidence'
    | 'resolved_by_reconfirmation'
    | 'relinquished_unknown';

export type EntityKind =
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
    | 'safety_blocker'
    | 'resolution_case';

export interface EntityStateByKind {
    readonly strategy: StrategyState;
    readonly activation: ActivationState;
    readonly order_intent: OrderIntentState;
    readonly broker_order: BrokerOrderState;
    readonly pending_protection_commitment: PendingProtectionCommitmentState;
    readonly protection_obligation: ProtectionObligationState;
    readonly entry_exposure_reservation: EntryExposureReservationState;
    readonly exit_claim: ExitClaimState;
    readonly external_sell_claim: ExitClaimState;
    readonly runtime_epoch: RuntimeEpochState;
    readonly durable_dispatch_blocker: DurableDispatchBlockerState;
    readonly safety_blocker: SafetyBlockerState;
    readonly resolution_case: ResolutionCaseState;
}

interface StateEntityBase<Kind extends EntityKind, State extends string> {
    readonly entityKind: Kind;
    readonly entityId: string;
    readonly lineageId: string;
    readonly lineageGeneration: number;
    readonly state: State;
    readonly revision: number;
    readonly resolutionCaseId?: string;
}

export interface ImmutableStrategyDefinitionBinding {
    readonly strategyDefinitionHash: string;
    readonly confirmationSnapshotHash: string;
    readonly fixedAccountOpaqueRef: string;
    readonly identityGroupOpaqueRef: string;
    readonly intendedProvenance: 'automation';
}

interface StrategyRuntimeFields {
    readonly strategyId: string;
    readonly runtimeEpochId: string;
    readonly armGeneration: number;
    readonly manualResolutionReasonCode?: ReasonCode;
}

export interface DraftStrategy
    extends StateEntityBase<'strategy', 'draft' | 'cancelled'>,
        StrategyRuntimeFields {
    readonly definitionStatus: 'draft';
    readonly draftPayloadHash: string;
}

export interface SealedStrategy
    extends StateEntityBase<'strategy', Exclude<StrategyState, 'draft'>>,
        StrategyRuntimeFields,
        ImmutableStrategyDefinitionBinding {
    readonly definitionStatus: 'sealed';
}

export type Strategy = DraftStrategy | SealedStrategy;

export interface Activation
    extends StateEntityBase<'activation', ActivationState> {
    readonly activationId: string;
    readonly runtimeEpochId: string;
    readonly strategyId: string;
    readonly strategyDefinitionHash: string;
    readonly activationKind:
        | 'edge'
        | 'daily_edge'
        | 'schedule_slot'
        | 'parent_child'
        | 'protection_remainder';
    readonly logicalKeyHash: string;
    readonly remainderGeneration?: number;
    readonly winnerLegId?: string;
    readonly primaryPlaceIntentId?: string;
    readonly intentPurpose: 'entry' | 'exit' | 'unprotected_place';
    readonly dispatchOwner: IntentOwner;
    readonly intendedProvenance: Exclude<BrokerWriteProvenance, 'none'>;
}

export type IntentOperation = 'place' | 'update' | 'cancel';

export type IntentOwner =
    | Readonly<{
          kind: 'strategy_activation';
          strategyId: string;
          activationId: string;
      }>
    | Readonly<{
          kind: 'manual_confirmation';
          routeId: string;
          confirmationId: string;
      }>
    | Readonly<{
          kind: 'gate_probe_run';
          probeRunId: string;
          operationNonce: string;
      }>
    | Readonly<{
          kind: 'lifecycle_resolution';
          strategyId: string;
          resolutionCaseId: string;
          confirmationId: string;
      }>;

export type PlaceTerminalOutcome =
    | 'place_filled'
    | 'place_cancelled'
    | 'place_inactive'
    | 'place_rejected'
    | 'place_zero_fill'
    | 'place_cancelled_proven_unsent'
    | 'place_relinquished_unknown';

export type UpdateTerminalOutcome =
    | 'update_applied'
    | 'update_rejected'
    | 'target_already_terminal'
    | 'update_cancelled_proven_unsent'
    | 'update_stale_target_prebyte'
    | 'update_relinquished_unknown';

export type CancelTerminalOutcome =
    | 'cancel_applied'
    | 'cancel_rejected'
    | 'target_already_terminal'
    | 'cancel_cancelled_proven_unsent'
    | 'cancel_stale_target_prebyte'
    | 'cancel_relinquished_unknown';

export type OrderIntentTerminalOutcome =
    | PlaceTerminalOutcome
    | UpdateTerminalOutcome
    | CancelTerminalOutcome;

export interface OrderIntentTarget {
    readonly targetBrokerOrderId: string;
    readonly fixedAccountOpaqueRef: string;
    readonly tradeDate: string;
    readonly contractKey: string;
    readonly side: 'Buy' | 'Sell';
    readonly brokerIdentifiersHash: string;
    readonly targetRevision: number;
    readonly expectedRemainingShares: bigint;
}

export interface OrderIntent
    extends StateEntityBase<'order_intent', OrderIntentState> {
    readonly intentId: string;
    readonly operation: IntentOperation;
    readonly owner: IntentOwner;
    readonly purpose:
        | 'entry'
        | 'exit'
        | 'control_update'
        | 'control_cancel'
        | 'unprotected_place';
    readonly payloadHash: string;
    readonly intendedProvenance: Exclude<BrokerWriteProvenance, 'none'>;
    readonly target?: OrderIntentTarget;
    readonly createdBrokerOrderId?: string;
    readonly dispatchAttemptNonce?: string;
    readonly durableDispatchBlockerId?: string;
    readonly runtimeEpochId?: string;
    readonly senderFence?: string;
    readonly terminalOutcome?: OrderIntentTerminalOutcome;
}

export interface BrokerOrder
    extends StateEntityBase<'broker_order', BrokerOrderState> {
    readonly brokerOrderId: string;
    readonly intentId: string;
    readonly fixedAccountOpaqueRef: string;
    readonly tradeDate: string;
    readonly contractKey: string;
    readonly side: 'Buy' | 'Sell';
    readonly brokerCorrelationHash: string;
    readonly controlRevision: number;
    readonly quantityShares: bigint;
    readonly filledShares: bigint;
    readonly remainingShares: bigint;
}

export interface PendingProtectionCommitment
    extends StateEntityBase<
        'pending_protection_commitment',
        PendingProtectionCommitmentState
    > {
    readonly commitmentId: string;
    readonly strategyId: string;
    readonly entryIntentId: string;
    readonly entryIntentOwner: IntentOwner;
    readonly obligationId: string;
    readonly requestedShares: bigint;
    readonly cumulativeFilledShares: bigint;
    readonly openPotentialShares: bigint;
    readonly terminalUnfilledShares: bigint;
    readonly materializedFilledShares: bigint;
    readonly unmaterializedConfirmedFillShares: bigint;
}

export interface ProtectionObligation
    extends StateEntityBase<'protection_obligation', ProtectionObligationState> {
    readonly obligationId: string;
    readonly strategyId: string;
    readonly commitmentId: string;
    readonly entryIntentId: string;
    readonly entryIntentOwner: IntentOwner;
    readonly fixedAccountOpaqueRef: string;
    readonly contractKey: string;
    readonly filledShares: bigint;
    readonly confirmedExitedShares: bigint;
    readonly protectedShares: bigint | 'unknown';
    readonly runtimeTrackedUnprotectedRemainder: bigint | 'unknown';
}

export interface EntryExposureReservation
    extends StateEntityBase<
        'entry_exposure_reservation',
        EntryExposureReservationState
    > {
    readonly reservationId: string;
    readonly ownerIntentId: string;
    readonly entryIntentOwner: IntentOwner;
    readonly fixedAccountOpaqueRef: string;
    readonly contractKey: string;
    readonly worstCaseReservedShares: bigint;
    readonly reservedRemainingShares: bigint;
    readonly consumedShares: bigint;
    readonly releasedShares: bigint;
}

interface ExitClaimBase<Kind extends 'exit_claim' | 'external_sell_claim'>
    extends StateEntityBase<Kind, ExitClaimState> {
    readonly exitClaimId: string;
    readonly fixedAccountOpaqueRef: string;
    readonly contractKey: string;
    readonly positionLineageId: string;
    readonly remainderGeneration: number;
    readonly reservedShares: bigint;
    readonly activeShares: bigint;
    readonly consumedShares: bigint;
    readonly releasedShares: bigint;
}

export interface ExitClaim extends ExitClaimBase<'exit_claim'> {
    readonly origin: 'runtime';
    readonly strategyId: string;
    readonly obligationId: string;
}

export interface ExternalSellClaim extends ExitClaimBase<'external_sell_claim'> {
    readonly origin: 'external';
    readonly brokerOrderId: string;
}

export interface RuntimeEpoch
    extends StateEntityBase<'runtime_epoch', RuntimeEpochState> {
    readonly runtimeEpochId: string;
    readonly processInstanceId: string;
    readonly senderFence: string;
    readonly apiGeneration: string;
    readonly modeMarkerRevision: string;
    readonly manifestRevision: string;
    readonly fullReconciliationCompletedInEpoch: boolean;
}

export interface DurableDispatchBlocker
    extends StateEntityBase<
        'durable_dispatch_blocker',
        DurableDispatchBlockerState
    > {
    readonly intentId: string;
    readonly intentOperation: IntentOperation;
    readonly dispatchAttemptNonce: string;
    readonly runtimeEpochId: string;
    readonly senderFence: string;
    readonly apiGeneration: string;
    readonly modeMarkerRevision: string;
    readonly accountOpaqueRef: string;
    readonly intentProvenance: Exclude<BrokerWriteProvenance, 'none'>;
}

export type SafetyBlockerKind = SafetyBlockerResolutionKind;

export interface SafetyBlocker
    extends StateEntityBase<'safety_blocker', SafetyBlockerState> {
    readonly blockerId: string;
    readonly blockerKind: SafetyBlockerKind;
    readonly scopeId: string;
    readonly scopeMemberSha256: readonly `sha256:${string}`[];
    readonly resolutionCaseId: string;
    readonly worstCasePositionDeltaShares?: bigint;
    readonly possiblyWorkingShares?: bigint;
}

export type ResolutionCaseKind =
    | 'manual_reason'
    | 'terminal_evidence_conflict'
    | 'relinquished_unknown_exposure';

export interface ResolutionCase
    extends StateEntityBase<'resolution_case', ResolutionCaseState> {
    readonly resolutionCaseId: string;
    readonly caseKind: ResolutionCaseKind;
    readonly scopeId: string;
    readonly openingReasonCode: ReasonCode;
}

export interface ProtectionLegEvaluation {
    readonly protectionGroupId: string;
    readonly remainderGeneration: number;
    readonly activationId: string;
    readonly legId: string;
    readonly status: 'candidate' | 'winner' | 'suppressed';
    readonly brokerAuthority: false;
}

export type SmartOrderStateEntity =
    | Strategy
    | Activation
    | OrderIntent
    | BrokerOrder
    | PendingProtectionCommitment
    | ProtectionObligation
    | EntryExposureReservation
    | ExitClaim
    | ExternalSellClaim
    | RuntimeEpoch
    | DurableDispatchBlocker
    | SafetyBlocker
    | ResolutionCase;

export type EntityByKind<Kind extends EntityKind> = Extract<
    SmartOrderStateEntity,
    { readonly entityKind: Kind }
>;

export type NewEntityByKind<Kind extends EntityKind> =
    EntityByKind<Kind> extends infer Entity
        ? Entity extends SmartOrderStateEntity
            ? Omit<Entity, 'state' | 'revision'>
            : never
        : never;

const STATE_CLASSIFICATION = Object.freeze({
    strategy: {
        terminal: ['completed', 'cancelled', 'expired'],
        blocking: ['recovery', 'manual_intervention'],
    },
    activation: {
        terminal: ['filled', 'cancelled', 'failed', 'missed'],
        blocking: ['unknown'],
    },
    order_intent: {
        terminal: ['terminal'],
        blocking: ['reconciling', 'unknown'],
    },
    broker_order: {
        terminal: ['filled', 'cancelled', 'inactive', 'failed'],
        blocking: ['unknown'],
    },
    pending_protection_commitment: {
        terminal: [
            'materialized',
            'zero_fill_terminal',
            'released_pre_dispatch',
            'released_manual',
        ],
        blocking: ['unknown'],
    },
    protection_obligation: {
        terminal: ['fulfilled', 'zero_fill_terminal', 'released_manual'],
        blocking: ['reconciling', 'safety_blocked'],
    },
    entry_exposure_reservation: {
        terminal: ['consumed', 'released'],
        blocking: ['unknown'],
    },
    exit_claim: {
        terminal: ['consumed', 'released'],
        blocking: ['unknown'],
    },
    external_sell_claim: {
        terminal: ['consumed', 'released'],
        blocking: ['unknown'],
    },
    runtime_epoch: {
        terminal: ['stopped', 'failed_stop', 'superseded'],
        blocking: [],
    },
    durable_dispatch_blocker: {
        terminal: [
            'cleared_acknowledged',
            'cleared_terminal',
            'cleared_unknown_durable',
            'cleared_reconciling_durable',
        ],
        blocking: ['open'],
    },
    safety_blocker: {
        terminal: ['resolved', 'superseded_by_stricter_blocker'],
        blocking: ['open'],
    },
    resolution_case: {
        terminal: [
            'resolved_by_final_evidence',
            'resolved_by_reconfirmation',
            'relinquished_unknown',
        ],
        blocking: ['decision_required'],
    },
} satisfies {
    readonly [Kind in EntityKind]: Readonly<{
        terminal: readonly EntityStateByKind[Kind][];
        blocking: readonly EntityStateByKind[Kind][];
    }>;
});

export function isTerminalState<Kind extends EntityKind>(
    entityKind: Kind,
    state: EntityStateByKind[Kind],
): boolean {
    return (STATE_CLASSIFICATION[entityKind].terminal as readonly string[]).includes(
        state,
    );
}

export function isBlockingState<Kind extends EntityKind>(
    entityKind: Kind,
    state: EntityStateByKind[Kind],
): boolean {
    return (STATE_CLASSIFICATION[entityKind].blocking as readonly string[]).includes(
        state,
    );
}

interface ReasonGroup {
    readonly codes: readonly string[];
    readonly category: string;
    readonly defaultSeverity: 'info' | 'warning' | 'error' | 'critical';
    readonly blockingScope:
        | 'strategy'
        | 'global'
        | 'account'
        | 'account_contract'
        | 'identity_group'
        | 'resolution_case_scope'
        | 'request';
    readonly requiredEvidenceClass: string;
    readonly resolutionPolicyId: string;
}

const REASON_GROUPS = [
    {
        codes: [
            'USER_CONFIRMATION_ACCEPTED',
            'USER_PAUSE_REQUESTED',
            'USER_RESUME_AND_ARM_CONFIRMED',
            'USER_CANCEL_STRATEGY_REQUESTED',
            'USER_DRAFT_DISCARDED',
            'RECOVERY_RECONCILED_REARM_REQUIRED',
            'STRATEGY_CANCEL_DRAIN_COMPLETE',
            'STRATEGY_TARGET_COMPLETED',
            'EXPIRY_DRAIN_COMPLETE',
        ],
        category: 'strategy_control',
        defaultSeverity: 'info',
        blockingScope: 'strategy',
        requiredEvidenceClass: 'UserAuthorizationEvidence',
        resolutionPolicyId: 'strategy_state_policy',
    },
    {
        codes: [
            'USER_WRITE_MASTER_ARMED',
            'USER_WRITE_MASTER_DISARMED',
            'POLICY_PAUSE_AUTOMATION',
        ],
        category: 'runtime_control',
        defaultSeverity: 'warning',
        blockingScope: 'global',
        requiredEvidenceClass: 'RuntimeControlAuthorizationEvidence',
        resolutionPolicyId: 'runtime_rearm_policy',
    },
    {
        codes: [
            'ACTIVATION_ARMED',
            'ACTIVATION_CANCELLED_BEFORE_TRIGGER',
            'ACTIVATION_VALIDATION_FAILED_PRE_DISPATCH',
        ],
        category: 'activation_lifecycle',
        defaultSeverity: 'info',
        blockingScope: 'strategy',
        requiredEvidenceClass: 'StrategyDefinitionEvidence',
        resolutionPolicyId: 'activation_lifecycle_policy',
    },
    {
        codes: ['ACTIVATION_ID_CONFLICT'],
        category: 'activation_conflict',
        defaultSeverity: 'critical',
        blockingScope: 'strategy',
        requiredEvidenceClass: 'RepositoryConflictEvidence',
        resolutionPolicyId: 'terminal_conflict_resolution',
    },
    {
        codes: ['CONDITION_EDGE_FALSE_TO_TRUE', 'CONDITION_IMMEDIATE_CONFIRMED'],
        category: 'activation_observation',
        defaultSeverity: 'info',
        blockingScope: 'strategy',
        requiredEvidenceClass: 'CanonicalObservationEvidence',
        resolutionPolicyId: 'activation_edge_policy',
    },
    {
        codes: [
            'SCHEDULE_SLOT_MISSED_NOT_READY',
            'SCHEDULE_SLOT_BLOCKED_BY_PRIOR',
            'VALIDITY_ENDED_NO_OBLIGATION',
            'VALIDITY_ENDED_WITH_OBLIGATION',
        ],
        category: 'trusted_time',
        defaultSeverity: 'warning',
        blockingScope: 'strategy',
        requiredEvidenceClass: 'TrustedTimeCalendarEvidence',
        resolutionPolicyId: 'schedule_validity_policy',
    },
    {
        codes: ['INTENT_PREPARED_DURABLE', 'INTENT_CANCELLED_PROVEN_UNSENT'],
        category: 'intent_lifecycle',
        defaultSeverity: 'info',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'IntentSnapshotEvidence',
        resolutionPolicyId: 'intent_lifecycle_policy',
    },
    {
        codes: [
            'BROKER_UPDATE_TARGET_RESERVED',
            'BROKER_CANCEL_TARGET_RESERVED',
            'BROKER_TARGET_REVISION_CHANGED',
        ],
        category: 'control_target_revision',
        defaultSeverity: 'warning',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ControlTargetRevisionEvidence',
        resolutionPolicyId: 'control_target_reconcile',
    },
    {
        codes: ['DISPATCH_FENCE_COMMITTED'],
        category: 'dispatch_authority',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'DispatchFenceEvidence',
        resolutionPolicyId: 'no_automatic_retry',
    },
    {
        codes: [
            'BROKER_ACK_DURABLE',
            'BROKER_WORKING_EVIDENCE_APPLIED',
            'BROKER_FINAL_EVIDENCE_APPLIED',
        ],
        category: 'intent_broker_evidence',
        defaultSeverity: 'info',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerAccountSnapshotEvidence',
        resolutionPolicyId: 'broker_account_reconcile',
    },
    {
        codes: [
            'BROKER_RESPONSE_LOST_RECONCILE',
            'ACKNOWLEDGED_RECONCILIATION_REQUIRED',
            'BROKER_OUTCOME_UNKNOWN',
            'BROKER_CORRELATION_AMBIGUOUS',
            'BROKER_ACCOUNT_MISMATCH',
        ],
        category: 'intent_uncertainty',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerAccountSnapshotEvidence',
        resolutionPolicyId: 'manual_or_broker_reconcile',
    },
    {
        codes: [
            'BROKER_PENDING_SUBMIT_OBSERVED',
            'BROKER_PRE_SUBMITTED_OBSERVED',
            'BROKER_SUBMITTED_OBSERVED',
            'BROKER_ORDER_WORKING_CONFIRMED',
        ],
        category: 'broker_working_state',
        defaultSeverity: 'info',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerAccountSnapshotEvidence',
        resolutionPolicyId: 'broker_account_reconcile',
    },
    {
        codes: [
            'BROKER_PART_FILL_CONFIRMED',
            'BROKER_ADDITIONAL_FILL_CONFIRMED',
            'BROKER_FULL_FILL_CONFIRMED',
            'BROKER_CANCELLED_CONFIRMED',
            'BROKER_INACTIVE_CONFIRMED',
            'BROKER_FAILED_CONFIRMED',
            'BROKER_REJECTED_CONFIRMED',
            'BROKER_RECONCILIATION_EVIDENCE_APPLIED',
        ],
        category: 'broker_quantity_finality',
        defaultSeverity: 'warning',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerDealOrderPositionEvidence',
        resolutionPolicyId: 'broker_account_reconcile',
    },
    {
        codes: ['BROKER_STATE_UNKNOWN'],
        category: 'broker_state_uncertainty',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerDealOrderPositionEvidence',
        resolutionPolicyId: 'manual_or_broker_reconcile',
    },
    {
        codes: ['BROKER_FINAL_EVIDENCE_CONFLICT'],
        category: 'terminal_evidence_conflict',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ConflictingTerminalEvidence',
        resolutionPolicyId: 'terminal_conflict_resolution',
    },
    {
        codes: [
            'PROTECTION_PLAN_PREPARED_DURABLE',
            'PROTECTION_PLAN_CANCELLED_PROVEN_UNSENT',
            'PROTECTION_OBLIGATION_CREATED',
            'ENTRY_DISPATCH_FENCE_COMMITTED',
            'ENTRY_ACKNOWLEDGED_WAITING_FILL',
        ],
        category: 'protection_lifecycle',
        defaultSeverity: 'warning',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ProtectionPlanLedgerEvidence',
        resolutionPolicyId: 'protection_lifecycle_policy',
    },
    {
        codes: [
            'ENTRY_FILL_CONFIRMED_MATERIALIZING',
            'ENTRY_ADDITIONAL_FILL_MATERIALIZED',
            'ENTRY_FINAL_QUANTITY_MATERIALIZED',
            'ENTRY_ZERO_FILL_TERMINAL',
            'PROTECTION_CLAIM_CREATED_FROM_FILL',
        ],
        category: 'entry_quantity_projection',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerDealOrderPositionEvidence',
        resolutionPolicyId: 'entry_quantity_reconcile',
    },
    {
        codes: [
            'ENTRY_RESULT_UNKNOWN',
            'PROTECTION_RECONCILIATION_REQUIRED',
            'PROTECTION_UNPROTECTED_REMAINDER',
        ],
        category: 'protection_uncertainty',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ProtectionQuantityInvariantEvidence',
        resolutionPolicyId: 'manual_or_protection_reconcile',
    },
    {
        codes: [
            'PROTECTION_MONITORING_REVISION_UPDATED',
            'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED',
            'PROTECTION_REMAINDER_REARM_REQUIRED',
            'PROTECTION_FULLY_EXITED_CONFIRMED',
        ],
        category: 'protection_projection',
        defaultSeverity: 'warning',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ProtectionQuantityInvariantEvidence',
        resolutionPolicyId: 'protection_reconcile',
    },
    {
        codes: [
            'ENTRY_EXPOSURE_RESERVED',
            'ENTRY_RESERVATION_PARTIALLY_CONSUMED',
            'ENTRY_RESERVATION_FULLY_CONSUMED',
            'ENTRY_RESERVATION_RELEASED',
        ],
        category: 'entry_reservation',
        defaultSeverity: 'warning',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ReservationLedgerEvidence',
        resolutionPolicyId: 'entry_reservation_policy',
    },
    {
        codes: ['ENTRY_RESERVATION_UNKNOWN'],
        category: 'entry_reservation_uncertainty',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ReservationLedgerEvidence',
        resolutionPolicyId: 'manual_or_protection_reconcile',
    },
    {
        codes: [
            'EXIT_CLAIM_MONITORING_RESERVED',
            'EXTERNAL_SELL_CLAIM_DISCOVERED',
            'EXIT_CLAIM_RELEASED_UNUSED',
            'EXIT_CLAIM_BROKER_WORKING',
            'EXIT_INTENT_CANCELLED_PROVEN_UNSENT',
            'EXIT_CLAIM_CONSUMED_CONFIRMED',
            'EXIT_CLAIM_RELEASED_AFTER_TERMINAL',
        ],
        category: 'exit_claim',
        defaultSeverity: 'warning',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ExitClaimLedgerEvidence',
        resolutionPolicyId: 'exit_claim_reconcile',
    },
    {
        codes: ['EXIT_CLAIM_UNKNOWN'],
        category: 'exit_claim_uncertainty',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'ExitClaimLedgerEvidence',
        resolutionPolicyId: 'manual_or_protection_reconcile',
    },
    {
        codes: ['OCO_WINNER_SELECTED'],
        category: 'oco_selection',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'OcoWinnerCasEvidence',
        resolutionPolicyId: 'single_activation_oco_policy',
    },
    {
        codes: [
            'EXIT_BROKER_WORKING_CONFIRMED',
            'EXIT_PART_FILL_CONFIRMED',
            'EXIT_ADDITIONAL_FILL_CONFIRMED',
        ],
        category: 'exit_quantity_projection',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerDealOrderPositionEvidence',
        resolutionPolicyId: 'exit_quantity_reconcile',
    },
    {
        codes: [
            'RUNTIME_EPOCH_CREATED',
            'RUNTIME_SINGLE_WRITER_FENCE_ACQUIRED',
            'RUNTIME_STARTUP_FAIL_CLOSED',
            'RUNTIME_API_GENERATION_SUPERSEDED',
            'RUNTIME_SENDER_FAIL_STOP',
        ],
        category: 'runtime_epoch',
        defaultSeverity: 'critical',
        blockingScope: 'global',
        requiredEvidenceClass: 'RuntimeEpochFenceEvidence',
        resolutionPolicyId: 'runtime_epoch_policy',
    },
    {
        codes: [
            'RUNTIME_RECONCILIATION_STARTED',
            'RUNTIME_RECONCILED_OBSERVE_ONLY',
            'RUNTIME_READY_REARM_REQUIRED',
            'RUNTIME_READINESS_REVOKED',
            'RUNTIME_RECONCILIATION_REQUIRED',
        ],
        category: 'runtime_reconciliation',
        defaultSeverity: 'critical',
        blockingScope: 'global',
        requiredEvidenceClass: 'FullAccountReconciliationEvidence',
        resolutionPolicyId: 'runtime_reconcile_before_arm',
    },
    {
        codes: [
            'RUNTIME_QUIESCE_REQUESTED',
            'RUNTIME_GRACEFUL_STOP_COMPLETE',
            'RUNTIME_QUIESCE_BLOCKED_OBLIGATION',
        ],
        category: 'runtime_lifecycle',
        defaultSeverity: 'warning',
        blockingScope: 'global',
        requiredEvidenceClass: 'LifecycleDrainEvidence',
        resolutionPolicyId: 'runtime_drain_policy',
    },
    {
        codes: ['RUNTIME_BREAK_GLASS_FORCED_STOP'],
        category: 'runtime_break_glass',
        defaultSeverity: 'critical',
        blockingScope: 'global',
        requiredEvidenceClass: 'BreakGlassRelinquishmentEvidence',
        resolutionPolicyId: 'forced_stop_with_durable_blocker',
    },
    {
        codes: [
            'DURABLE_DISPATCH_BLOCKER_OPENED',
            'DURABLE_DISPATCH_BLOCKER_CLEARED_ACK',
            'DURABLE_DISPATCH_BLOCKER_CLEARED_TERMINAL',
            'DURABLE_DISPATCH_BLOCKER_CLEARED_UNKNOWN',
            'DURABLE_DISPATCH_BLOCKER_CLEARED_RECONCILING',
        ],
        category: 'durable_dispatch_blocker',
        defaultSeverity: 'critical',
        blockingScope: 'account',
        requiredEvidenceClass: 'DurableDispatchTransactionEvidence',
        resolutionPolicyId: 'dispatch_blocker_policy',
    },
    {
        codes: [
            'READINESS_LOST_RECONCILIATION_REQUIRED',
            'SENDER_FENCE_LOST',
            'RISK_POLICY_BLOCKED',
        ],
        category: 'runtime_readiness',
        defaultSeverity: 'critical',
        blockingScope: 'global',
        requiredEvidenceClass: 'RuntimeReadinessEvidence',
        resolutionPolicyId: 'runtime_reconcile_before_arm',
    },
    {
        codes: [
            'SIMULATION_ATTESTATION_FAILED',
            'MODE_GENERATION_CHANGED',
            'GATE_MANIFEST_INVALID',
        ],
        category: 'mode_gate',
        defaultSeverity: 'critical',
        blockingScope: 'global',
        requiredEvidenceClass: 'ModeGenerationGateEvidence',
        resolutionPolicyId: 'gate_revalidation',
    },
    {
        codes: ['IDENTITY_MAPPING_CONFLICT'],
        category: 'identity_conflict',
        defaultSeverity: 'critical',
        blockingScope: 'identity_group',
        requiredEvidenceClass: 'IdentityMappingEvidence',
        resolutionPolicyId: 'identity_gate_revalidation',
    },
    {
        codes: ['EXTERNAL_WORKING_SET_INCOMPLETE', 'WORKING_SELL_SET_CHANGED'],
        category: 'external_working_set',
        defaultSeverity: 'critical',
        blockingScope: 'account',
        requiredEvidenceClass: 'FullWorkingOrderSetEvidence',
        resolutionPolicyId: 'broker_account_reconcile',
    },
    {
        codes: ['CALENDAR_OR_TRUSTED_TIME_UNKNOWN'],
        category: 'time_trust',
        defaultSeverity: 'critical',
        blockingScope: 'global',
        requiredEvidenceClass: 'TrustedTimeCalendarEvidence',
        resolutionPolicyId: 'trusted_time_revalidation',
    },
    {
        codes: ['DB_COMMIT_FAILED', 'DB_INTEGRITY_FAILED'],
        category: 'database_durability',
        defaultSeverity: 'critical',
        blockingScope: 'global',
        requiredEvidenceClass: 'DatabaseIntegrityEvidence',
        resolutionPolicyId: 'restore_then_full_reconcile',
    },
    {
        codes: ['QUOTE_GAP_CROSSING_UNKNOWN', 'TRAILING_GAP_EXTREME_UNKNOWN'],
        category: 'quote_gap',
        defaultSeverity: 'critical',
        blockingScope: 'strategy',
        requiredEvidenceClass: 'CanonicalObservationGapEvidence',
        resolutionPolicyId: 'manual_quote_gap_resolution',
    },
    {
        codes: ['EXTERNAL_POSITION_DRIFT', 'POSITION_OR_UNIT_UNKNOWN'],
        category: 'position_uncertainty',
        defaultSeverity: 'critical',
        blockingScope: 'account_contract',
        requiredEvidenceClass: 'BrokerPositionUnitEvidence',
        resolutionPolicyId: 'manual_or_broker_reconcile',
    },
    {
        codes: [
            'RESOLUTION_CASE_OPENED',
            'RESOLUTION_CASE_EVIDENCE_ACCEPTED',
            'RESOLUTION_CASE_DECISION_REQUIRED',
            'RESOLUTION_CASE_RESOLVED_FINAL_EVIDENCE',
            'RESOLUTION_CASE_RESOLVED_RECONFIRMED',
            'TERMINAL_EVIDENCE_CORRECTION_RECORDED',
        ],
        category: 'resolution_case',
        defaultSeverity: 'critical',
        blockingScope: 'resolution_case_scope',
        requiredEvidenceClass: 'ResolutionCaseEvidence',
        resolutionPolicyId: 'typed_resolution_matrix',
    },
    {
        codes: [
            'SAFETY_BLOCKER_OPENED',
            'SAFETY_BLOCKER_RESOLVED',
            'RELINQUISHED_UNKNOWN_EXPOSURE_OPENED',
            'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED',
        ],
        category: 'safety_blocker',
        defaultSeverity: 'critical',
        blockingScope: 'resolution_case_scope',
        requiredEvidenceClass: 'SafetyBlockerEvidence',
        resolutionPolicyId: 'typed_resolution_matrix',
    },
    {
        codes: [
            'MANUAL_RECONCILIATION_STARTED',
            'MANUAL_FINAL_EVIDENCE_APPLIED',
            'MANUAL_RESOLUTION_RECONFIRMED',
            'MANUAL_BREAK_GLASS_RELINQUISHED',
        ],
        category: 'manual_resolution',
        defaultSeverity: 'critical',
        blockingScope: 'resolution_case_scope',
        requiredEvidenceClass: 'ManualResolutionAuthorizationEvidence',
        resolutionPolicyId: 'typed_resolution_matrix',
    },
    {
        codes: [
            'STATE_TRANSITION_NOT_ALLOWLISTED',
            'STATE_REVISION_CONFLICT',
            'REQUEST_REPLAY_PAYLOAD_MISMATCH',
        ],
        category: 'request_rejection',
        defaultSeverity: 'error',
        blockingScope: 'request',
        requiredEvidenceClass: 'RequestJournalEvidence',
        resolutionPolicyId: 'reject_and_journal',
    },
] as const satisfies readonly ReasonGroup[];

export type ReasonCode = (typeof REASON_GROUPS)[number]['codes'][number];
export type EvidenceClass =
    (typeof REASON_GROUPS)[number]['requiredEvidenceClass'];

export interface ReasonDefinition {
    readonly code: ReasonCode;
    readonly category: (typeof REASON_GROUPS)[number]['category'];
    readonly defaultSeverity: (typeof REASON_GROUPS)[number]['defaultSeverity'];
    readonly blockingScope: (typeof REASON_GROUPS)[number]['blockingScope'];
    readonly requiredEvidenceClass: EvidenceClass;
    readonly resolutionPolicyId: (typeof REASON_GROUPS)[number]['resolutionPolicyId'];
}

function buildReasonRegistry(): Readonly<Record<ReasonCode, ReasonDefinition>> {
    const entries = new Map<ReasonCode, ReasonDefinition>();
    for (const group of REASON_GROUPS) {
        for (const code of group.codes) {
            if (entries.has(code)) {
                throw new Error(`duplicate smart-order reason code: ${code}`);
            }
            entries.set(
                code,
                Object.freeze({
                    code,
                    category: group.category,
                    defaultSeverity: group.defaultSeverity,
                    blockingScope: group.blockingScope,
                    requiredEvidenceClass: group.requiredEvidenceClass,
                    resolutionPolicyId: group.resolutionPolicyId,
                }) as ReasonDefinition,
            );
        }
    }
    return Object.freeze(Object.fromEntries(entries)) as Readonly<
        Record<ReasonCode, ReasonDefinition>
    >;
}

export const SMART_ORDER_REASON_REGISTRY = buildReasonRegistry();

export type AuthorizationEvidenceKind =
    | 'UserArmAuthorization'
    | 'UserRearmAuthorization'
    | 'BreakGlassAuthorization';

export type CompanionOwnerKind =
    | 'default'
    | 'entry'
    | 'exit'
    | 'unprotected_place'
    | 'update'
    | 'cancel';

export type AtomicCompanionKind =
    | 'ImmutableStrategyDefinition'
    | 'ConfirmationSnapshot'
    | 'UserAuthorizationEvidence'
    | 'ResolutionCase.open'
    | 'ResolutionCase.terminal'
    | 'SafetyBlocker.open'
    | 'SafetyBlocker.resolved'
    | 'OrderIntent.prepared'
    | 'OrderIntent.dispatching'
    | 'OrderIntent.reconciling'
    | 'OrderIntent.unknown'
    | 'PendingProtectionCommitment.prepared'
    | 'ProtectionObligation.pending_entry'
    | 'ProtectionObligation.safety_blocked'
    | 'EntryExposureReservation.reserved_or_policy_not_required'
    | 'Activation.dispatching'
    | 'DurableDispatchBlocker.open'
    | 'DurableDispatchBlocker.cleared_acknowledged'
    | 'DurableDispatchBlocker.cleared_reconciling_durable'
    | 'DurableDispatchBlocker.cleared_unknown_durable'
    | 'DurableDispatchBlocker.cleared_terminal'
    | 'BrokerOrder.current_projection'
    | 'BrokerOrder.controlRevision_incremented'
    | 'OperationSpecificTerminalOutcome'
    | 'ReservationClaimSettlement'
    | 'TargetReservation'
    | 'CumulativeEntryQuantities'
    | 'EntryReservationProjection'
    | 'ProtectionObligation.projection'
    | 'ExitClaim.projection'
    | 'PositionProjection'
    | 'Activation.single_protection_generation'
    | 'ProtectionLegEvaluation.winner'
    | 'ProtectionLegEvaluation.suppressed'
    | 'ExitClaim.intent_reserved'
    | 'ExitOrderIntent.prepared'
    | 'CumulativeExitQuantities'
    | 'ClaimGenerationSettlement'
    | 'ReleasedOrFailedLocalEntities'
    | 'ResolutionCase.relinquished_unknown'
    | 'RelinquishedUnknownExposure.open'
    | 'BurnedDispatchNonce'
    | 'BreakGlassAuthorization'
    | 'AuditSnapshot'
    | 'RuntimeEpoch.failed_stop'
    | 'ForcedStopReleasedEntities'
    | 'ImmutableResolutionEvidence'
    | 'DerivedLedgerReprojection';

export interface AtomicCompanionVariant {
    readonly reasonCode?: ReasonCode;
    readonly ownerKind?: CompanionOwnerKind;
    readonly companions: readonly AtomicCompanionKind[];
}

export interface StateEdgeDefinition<Kind extends EntityKind = EntityKind> {
    readonly registryVersion: typeof SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION;
    readonly implementationVersion: typeof SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION;
    readonly reviewedArtifactSha256: typeof SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256;
    readonly edgeId: string;
    readonly entityKind: Kind;
    readonly from: EntityStateByKind[Kind] | '__create__';
    readonly to: EntityStateByKind[Kind];
    readonly allowedActorKinds: readonly ActorKind[];
    readonly brokerWriteProvenance: readonly BrokerWriteProvenance[];
    readonly reasonCodes: readonly ReasonCode[];
    readonly evidenceClassesByReason: Readonly<
        Partial<Record<ReasonCode, readonly EvidenceClass[]>>
    >;
    readonly atomicCompanions: readonly AtomicCompanionKind[];
    readonly atomicCompanionVariants: readonly AtomicCompanionVariant[];
    readonly requiredAuthorizationKinds: readonly AuthorizationEvidenceKind[];
    readonly authorizationKindsByReason: Readonly<
        Partial<Record<ReasonCode, readonly AuthorizationEvidenceKind[]>>
    >;
    readonly requiresTrustedWallTime: boolean;
}

interface RegisterEdgeOptions {
    readonly variants?: readonly AtomicCompanionVariant[];
    readonly requiredAuthorizationKinds?: readonly AuthorizationEvidenceKind[];
    readonly authorizationKindsByReason?: Readonly<
        Partial<Record<ReasonCode, readonly AuthorizationEvidenceKind[]>>
    >;
    readonly requiresTrustedWallTime?: boolean;
}

const EDGE_BUILDERS = new Map<string, StateEdgeDefinition>();

function edgeRegistryKey(entityKind: EntityKind, edgeId: string): string {
    return `${entityKind}:${edgeId}`;
}

function freezeAuthorizationKindsByReason(
    source: Readonly<
        Partial<Record<ReasonCode, readonly AuthorizationEvidenceKind[]>>
    > = {},
): Readonly<
    Partial<Record<ReasonCode, readonly AuthorizationEvidenceKind[]>>
> {
    const clone: Partial<
        Record<ReasonCode, readonly AuthorizationEvidenceKind[]>
    > = {};
    for (const [reasonCode, kinds] of Object.entries(source) as readonly [
        ReasonCode,
        readonly AuthorizationEvidenceKind[],
    ][]) {
        clone[reasonCode] = Object.freeze([...kinds]);
    }
    return Object.freeze(clone);
}

function registerEdge<Kind extends EntityKind>(
    entityKind: Kind,
    edgeId: string,
    from: EntityStateByKind[Kind] | '__create__',
    to: EntityStateByKind[Kind],
    allowedActorKinds: readonly ActorKind[],
    brokerWriteProvenance: readonly BrokerWriteProvenance[],
    reasonCodes: readonly ReasonCode[],
    atomicCompanions: readonly AtomicCompanionKind[],
    options: RegisterEdgeOptions = {},
): void {
    const key = edgeRegistryKey(entityKind, edgeId);
    if (EDGE_BUILDERS.has(key)) {
        throw new Error(`duplicate smart-order edge: ${key}`);
    }
    if (
        allowedActorKinds.length === 0 ||
        brokerWriteProvenance.length === 0 ||
        reasonCodes.length === 0
    ) {
        throw new Error(`incomplete smart-order edge metadata: ${key}`);
    }
    const evidenceClassesByReason: Partial<
        Record<ReasonCode, readonly EvidenceClass[]>
    > = {};
    for (const reasonCode of reasonCodes) {
        const reason = SMART_ORDER_REASON_REGISTRY[reasonCode];
        if (!reason) throw new Error(`unknown reason ${reasonCode} on ${key}`);
        evidenceClassesByReason[reasonCode] = Object.freeze([
            reason.requiredEvidenceClass,
        ]);
    }
    const definition: StateEdgeDefinition<Kind> = Object.freeze({
        registryVersion: SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION,
        implementationVersion: SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION,
        reviewedArtifactSha256:
            SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256,
        edgeId,
        entityKind,
        from,
        to,
        allowedActorKinds: Object.freeze([...allowedActorKinds]),
        brokerWriteProvenance: Object.freeze([...brokerWriteProvenance]),
        reasonCodes: Object.freeze([...reasonCodes]),
        evidenceClassesByReason: Object.freeze(evidenceClassesByReason),
        atomicCompanions: Object.freeze([...atomicCompanions]),
        atomicCompanionVariants: Object.freeze(
            (options.variants ?? []).map((variant) =>
                Object.freeze({
                    ...variant,
                    companions: Object.freeze([...variant.companions]),
                }),
            ),
        ),
        requiredAuthorizationKinds: Object.freeze([
            ...(options.requiredAuthorizationKinds ?? []),
        ]),
        authorizationKindsByReason: freezeAuthorizationKindsByReason(
            options.authorizationKindsByReason,
        ),
        requiresTrustedWallTime:
            options.requiresTrustedWallTime ??
            reasonCodes.some((code) => {
                const category = SMART_ORDER_REASON_REGISTRY[code].category;
                return (
                    category === 'trusted_time' ||
                    category === 'activation_observation' ||
                    category === 'dispatch_authority'
                );
            }),
    });
    EDGE_BUILDERS.set(key, definition as StateEdgeDefinition);
}

const NONE = Object.freeze([]) as readonly AtomicCompanionKind[];
const N: readonly BrokerWriteProvenance[] = ['none'];
const DISPATCH_PROVENANCE: readonly BrokerWriteProvenance[] = [
    'automation',
    'manual_user_confirmed',
    'gate_probe',
];
const USER: readonly ActorKind[] = ['interactive_user'];
const EVALUATOR: readonly ActorKind[] = ['runtime_evaluator'];
const DISPATCHER: readonly ActorKind[] = ['runtime_dispatcher'];
const RECONCILER: readonly ActorKind[] = ['reconciliation_service'];
const RESOLVER: readonly ActorKind[] = ['resolution_service'];
const LIFECYCLE: readonly ActorKind[] = ['lifecycle_service'];
const BROKER_OR_RECONCILER: readonly ActorKind[] = [
    'broker_event_consumer',
    'reconciliation_service',
];
const MANUAL_OPEN_COMPANIONS: readonly AtomicCompanionKind[] = [
    'ResolutionCase.open',
    'SafetyBlocker.open',
];
const BREAK_GLASS_COMPANIONS: readonly AtomicCompanionKind[] = [
    'ReleasedOrFailedLocalEntities',
    'ResolutionCase.relinquished_unknown',
    'RelinquishedUnknownExposure.open',
    'BurnedDispatchNonce',
    'BreakGlassAuthorization',
    'AuditSnapshot',
];
const ENTRY_PREPARE_COMPANIONS: readonly AtomicCompanionKind[] = [
    'OrderIntent.prepared',
    'PendingProtectionCommitment.prepared',
    'ProtectionObligation.pending_entry',
    'EntryExposureReservation.reserved_or_policy_not_required',
];
const EXIT_PREPARE_COMPANIONS: readonly AtomicCompanionKind[] = [
    'Activation.single_protection_generation',
    'ProtectionLegEvaluation.winner',
    'ProtectionLegEvaluation.suppressed',
    'ExitClaim.intent_reserved',
    'ExitOrderIntent.prepared',
];
const ENTRY_QUANTITY_COMPANIONS: readonly AtomicCompanionKind[] = [
    'CumulativeEntryQuantities',
    'EntryReservationProjection',
    'ProtectionObligation.projection',
    'ExitClaim.projection',
    'PositionProjection',
];
const EXIT_QUANTITY_COMPANIONS: readonly AtomicCompanionKind[] = [
    'CumulativeExitQuantities',
    'ClaimGenerationSettlement',
    'ProtectionObligation.projection',
    'PositionProjection',
];

const STR_MANUAL_REASONS = [
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
] as const satisfies readonly ReasonCode[];

registerEdge(
    'strategy',
    'STR-001',
    'draft',
    'observing',
    USER,
    N,
    ['USER_CONFIRMATION_ACCEPTED'],
    [
        'ImmutableStrategyDefinition',
        'ConfirmationSnapshot',
        'UserAuthorizationEvidence',
    ],
);
registerEdge('strategy', 'STR-002', 'draft', 'cancelled', USER, N, ['USER_DRAFT_DISCARDED'], NONE);
registerEdge(
    'strategy',
    'STR-003',
    'observing',
    'monitoring',
    EVALUATOR,
    N,
    ['USER_RESUME_AND_ARM_CONFIRMED'],
    NONE,
    { requiredAuthorizationKinds: ['UserArmAuthorization'] },
);
registerEdge('strategy', 'STR-004', 'observing', 'paused', USER, N, ['USER_PAUSE_REQUESTED'], NONE);
for (const [edgeId, from] of [
    ['STR-005A', 'observing'],
    ['STR-005B', 'monitoring'],
    ['STR-005C', 'paused'],
] as const) {
    registerEdge('strategy', edgeId, from, 'recovery', EVALUATOR, N, ['READINESS_LOST_RECONCILIATION_REQUIRED'], NONE);
}
registerEdge(
    'strategy',
    'STR-006',
    'monitoring',
    'paused',
    ['interactive_user', 'runtime_evaluator'],
    N,
    ['USER_PAUSE_REQUESTED', 'POLICY_PAUSE_AUTOMATION'],
    NONE,
);
registerEdge(
    'strategy',
    'STR-007',
    'paused',
    'monitoring',
    EVALUATOR,
    N,
    ['USER_RESUME_AND_ARM_CONFIRMED'],
    NONE,
    { requiredAuthorizationKinds: ['UserArmAuthorization'] },
);
registerEdge('strategy', 'STR-008', 'recovery', 'paused', RECONCILER, N, ['RECOVERY_RECONCILED_REARM_REQUIRED'], NONE);
for (const [edgeId, from] of [
    ['STR-009A', 'observing'],
    ['STR-009B', 'monitoring'],
    ['STR-009C', 'paused'],
    ['STR-009D', 'recovery'],
    ['STR-009E', 'cancel_pending'],
    ['STR-009F', 'expired_with_obligation'],
] as const) {
    registerEdge('strategy', edgeId, from, 'manual_intervention', RESOLVER, N, STR_MANUAL_REASONS, MANUAL_OPEN_COMPANIONS);
}
registerEdge(
    'strategy',
    'STR-010',
    'manual_intervention',
    'paused',
    RESOLVER,
    N,
    ['MANUAL_RESOLUTION_RECONFIRMED'],
    [
        'ResolutionCase.terminal',
        'ConfirmationSnapshot',
        'UserAuthorizationEvidence',
    ],
    { requiredAuthorizationKinds: ['UserRearmAuthorization'] },
);
for (const [edgeId, from] of [
    ['STR-011A', 'observing'],
    ['STR-011B', 'monitoring'],
    ['STR-011C', 'paused'],
    ['STR-011D', 'recovery'],
] as const) {
    registerEdge('strategy', edgeId, from, 'cancel_pending', USER, N, ['USER_CANCEL_STRATEGY_REQUESTED'], NONE);
}
for (const [edgeId, from] of [
    ['STR-012A', 'monitoring'],
    ['STR-012B', 'paused'],
    ['STR-012C', 'recovery'],
    ['STR-012D', 'manual_intervention'],
    ['STR-012E', 'cancel_pending'],
] as const) {
    registerEdge('strategy', edgeId, from, 'expired_with_obligation', LIFECYCLE, N, ['VALIDITY_ENDED_WITH_OBLIGATION'], NONE, { requiresTrustedWallTime: true });
}
registerEdge('strategy', 'STR-013', 'cancel_pending', 'cancelled', LIFECYCLE, N, ['STRATEGY_CANCEL_DRAIN_COMPLETE'], NONE);
registerEdge('strategy', 'STR-014', 'expired_with_obligation', 'expired', LIFECYCLE, N, ['EXPIRY_DRAIN_COMPLETE'], NONE);
for (const [edgeId, from] of [
    ['STR-015A', 'monitoring'],
    ['STR-015B', 'paused'],
] as const) {
    registerEdge('strategy', edgeId, from, 'completed', RECONCILER, N, ['STRATEGY_TARGET_COMPLETED'], NONE);
}
for (const [edgeId, from] of [
    ['STR-016A', 'observing'],
    ['STR-016B', 'paused'],
] as const) {
    registerEdge('strategy', edgeId, from, 'expired', LIFECYCLE, N, ['VALIDITY_ENDED_NO_OBLIGATION'], NONE, { requiresTrustedWallTime: true });
}

registerEdge('activation', 'ACT-001', '__create__', 'armed', EVALUATOR, N, ['ACTIVATION_ARMED'], NONE);
registerEdge(
    'activation',
    'ACT-002',
    'armed',
    'triggered',
    EVALUATOR,
    N,
    ['CONDITION_EDGE_FALSE_TO_TRUE', 'CONDITION_IMMEDIATE_CONFIRMED'],
    NONE,
    { requiresTrustedWallTime: true },
);
registerEdge(
    'activation',
    'ACT-003',
    'armed',
    'missed',
    LIFECYCLE,
    N,
    ['SCHEDULE_SLOT_MISSED_NOT_READY', 'SCHEDULE_SLOT_BLOCKED_BY_PRIOR'],
    NONE,
    { requiresTrustedWallTime: true },
);
registerEdge('activation', 'ACT-004', 'armed', 'cancelled', LIFECYCLE, N, ['ACTIVATION_CANCELLED_BEFORE_TRIGGER'], NONE);
registerEdge(
    'activation',
    'ACT-005',
    'triggered',
    'prepared',
    EVALUATOR,
    N,
    ['INTENT_PREPARED_DURABLE'],
    ['OrderIntent.prepared'],
    {
        variants: [
            { ownerKind: 'entry', companions: ENTRY_PREPARE_COMPANIONS },
            { ownerKind: 'exit', companions: EXIT_PREPARE_COMPANIONS },
            { ownerKind: 'unprotected_place', companions: ['OrderIntent.prepared'] },
        ],
    },
);

const INTENT_CREATORS: readonly ActorKind[] = [
    'runtime_evaluator',
    'interactive_user',
    'gate_runner',
    'resolution_service',
];
const TERMINAL_INTENT_COMPANIONS: readonly AtomicCompanionKind[] = [
    'OperationSpecificTerminalOutcome',
    'BrokerOrder.current_projection',
    'ReservationClaimSettlement',
];
const BREAK_GLASS_TERMINAL_INTENT_COMPANIONS: readonly AtomicCompanionKind[] = [
    ...TERMINAL_INTENT_COMPANIONS,
    ...BREAK_GLASS_COMPANIONS,
];

registerEdge(
    'order_intent',
    'INT-001',
    '__create__',
    'prepared',
    INTENT_CREATORS,
    N,
    ['INTENT_PREPARED_DURABLE'],
    NONE,
    {
        variants: [
            { ownerKind: 'entry', companions: ENTRY_PREPARE_COMPANIONS },
            { ownerKind: 'exit', companions: EXIT_PREPARE_COMPANIONS },
            { ownerKind: 'unprotected_place', companions: NONE },
            {
                ownerKind: 'update',
                companions: [
                    'BrokerOrder.controlRevision_incremented',
                    'OrderIntent.prepared',
                    'TargetReservation',
                ],
            },
            {
                ownerKind: 'cancel',
                companions: [
                    'BrokerOrder.controlRevision_incremented',
                    'OrderIntent.prepared',
                    'TargetReservation',
                ],
            },
        ],
    },
);
registerEdge(
    'order_intent',
    'INT-002',
    'prepared',
    'dispatching',
    DISPATCHER,
    DISPATCH_PROVENANCE,
    ['DISPATCH_FENCE_COMMITTED'],
    ['Activation.dispatching', 'OrderIntent.dispatching', 'DurableDispatchBlocker.open'],
    { requiresTrustedWallTime: true },
);
registerEdge(
    'order_intent',
    'INT-003A',
    'prepared',
    'terminal',
    ['interactive_user', 'lifecycle_service'],
    N,
    ['INTENT_CANCELLED_PROVEN_UNSENT'],
    NONE,
);
registerEdge(
    'order_intent',
    'INT-003B',
    'prepared',
    'terminal',
    DISPATCHER,
    N,
    ['BROKER_TARGET_REVISION_CHANGED'],
    NONE,
);
registerEdge(
    'order_intent',
    'INT-004',
    'dispatching',
    'acknowledged',
    BROKER_OR_RECONCILER,
    N,
    ['BROKER_ACK_DURABLE'],
    [
        'BrokerOrder.current_projection',
        'DurableDispatchBlocker.cleared_acknowledged',
    ],
);
for (const [edgeId, reason] of [
    ['INT-005A', 'BROKER_RESPONSE_LOST_RECONCILE'],
    ['INT-005B', 'BROKER_TARGET_REVISION_CHANGED'],
] as const) {
    registerEdge(
        'order_intent',
        edgeId,
        'dispatching',
        'reconciling',
        ['runtime_dispatcher', 'reconciliation_service'],
        N,
        [reason],
        [
            'OrderIntent.reconciling',
            'DurableDispatchBlocker.cleared_reconciling_durable',
        ],
    );
}
registerEdge(
    'order_intent',
    'INT-006',
    'dispatching',
    'unknown',
    RECONCILER,
    N,
    ['BROKER_OUTCOME_UNKNOWN'],
    [
        'OrderIntent.unknown',
        'DurableDispatchBlocker.cleared_unknown_durable',
        'SafetyBlocker.open',
    ],
);
registerEdge(
    'order_intent',
    'INT-007',
    'dispatching',
    'terminal',
    RECONCILER,
    N,
    ['BROKER_FINAL_EVIDENCE_APPLIED'],
    [...TERMINAL_INTENT_COMPANIONS, 'DurableDispatchBlocker.cleared_terminal'],
);
for (const [edgeId, reason] of [
    ['INT-008A', 'ACKNOWLEDGED_RECONCILIATION_REQUIRED'],
    ['INT-008B', 'BROKER_TARGET_REVISION_CHANGED'],
] as const) {
    registerEdge(
        'order_intent',
        edgeId,
        'acknowledged',
        'reconciling',
        RECONCILER,
        N,
        [reason],
        NONE,
    );
}
registerEdge(
    'order_intent',
    'INT-009',
    'acknowledged',
    'terminal',
    RECONCILER,
    N,
    ['BROKER_FINAL_EVIDENCE_APPLIED'],
    TERMINAL_INTENT_COMPANIONS,
);
registerEdge(
    'order_intent',
    'INT-010',
    'reconciling',
    'acknowledged',
    RECONCILER,
    N,
    ['BROKER_WORKING_EVIDENCE_APPLIED'],
    NONE,
);
registerEdge(
    'order_intent',
    'INT-011',
    'reconciling',
    'terminal',
    RESOLVER,
    N,
    ['MANUAL_FINAL_EVIDENCE_APPLIED', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
    TERMINAL_INTENT_COMPANIONS,
    {
        variants: [
            {
                reasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
                companions: BREAK_GLASS_TERMINAL_INTENT_COMPANIONS,
            },
        ],
        authorizationKindsByReason: {
            MANUAL_BREAK_GLASS_RELINQUISHED: ['BreakGlassAuthorization'],
        },
    },
);
registerEdge(
    'order_intent',
    'INT-012',
    'reconciling',
    'unknown',
    RECONCILER,
    N,
    ['BROKER_CORRELATION_AMBIGUOUS'],
    NONE,
);
registerEdge(
    'order_intent',
    'INT-013',
    'unknown',
    'reconciling',
    RESOLVER,
    N,
    ['MANUAL_RECONCILIATION_STARTED'],
    NONE,
);
registerEdge(
    'order_intent',
    'INT-014',
    'unknown',
    'terminal',
    RESOLVER,
    N,
    ['MANUAL_FINAL_EVIDENCE_APPLIED', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
    TERMINAL_INTENT_COMPANIONS,
    {
        variants: [
            {
                reasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
                companions: BREAK_GLASS_TERMINAL_INTENT_COMPANIONS,
            },
        ],
        authorizationKindsByReason: {
            MANUAL_BREAK_GLASS_RELINQUISHED: ['BreakGlassAuthorization'],
        },
    },
);

for (const [edgeId, from] of [
    ['BRO-001A', '__create__'],
    ['BRO-001B', 'unknown'],
] as const) {
    registerEdge(
        'broker_order',
        edgeId,
        from,
        'pending_submit',
        from === 'unknown' ? RESOLVER : BROKER_OR_RECONCILER,
        N,
        ['BROKER_PENDING_SUBMIT_OBSERVED'],
        NONE,
    );
}
for (const [edgeId, from, actors] of [
    ['BRO-002A', '__create__', BROKER_OR_RECONCILER],
    ['BRO-002B', 'pending_submit', BROKER_OR_RECONCILER],
    ['BRO-002C', 'unknown', RESOLVER],
] as const) {
    registerEdge('broker_order', edgeId, from, 'pre_submitted', actors, N, ['BROKER_PRE_SUBMITTED_OBSERVED'], NONE);
}
for (const [edgeId, from, actors] of [
    ['BRO-003A', '__create__', BROKER_OR_RECONCILER],
    ['BRO-003B', 'pending_submit', BROKER_OR_RECONCILER],
    ['BRO-003C', 'pre_submitted', BROKER_OR_RECONCILER],
    ['BRO-003D', 'unknown', RESOLVER],
] as const) {
    registerEdge('broker_order', edgeId, from, 'submitted', actors, N, ['BROKER_SUBMITTED_OBSERVED'], NONE);
}
for (const [edgeId, from, actors, reason] of [
    ['BRO-004A', 'pending_submit', BROKER_OR_RECONCILER, 'BROKER_PART_FILL_CONFIRMED'],
    ['BRO-004B', 'pre_submitted', BROKER_OR_RECONCILER, 'BROKER_PART_FILL_CONFIRMED'],
    ['BRO-004C', 'submitted', BROKER_OR_RECONCILER, 'BROKER_PART_FILL_CONFIRMED'],
    ['BRO-004D', 'part_filled', BROKER_OR_RECONCILER, 'BROKER_ADDITIONAL_FILL_CONFIRMED'],
    ['BRO-004E', 'unknown', RESOLVER, 'BROKER_RECONCILIATION_EVIDENCE_APPLIED'],
] as const) {
    registerEdge('broker_order', edgeId, from, 'part_filled', actors, N, [reason], NONE);
}
for (const [edgeId, from, actors, reason] of [
    ['BRO-005A', 'pending_submit', RECONCILER, 'BROKER_FULL_FILL_CONFIRMED'],
    ['BRO-005B', 'pre_submitted', RECONCILER, 'BROKER_FULL_FILL_CONFIRMED'],
    ['BRO-005C', 'submitted', RECONCILER, 'BROKER_FULL_FILL_CONFIRMED'],
    ['BRO-005D', 'part_filled', RECONCILER, 'BROKER_FULL_FILL_CONFIRMED'],
    ['BRO-005E', 'unknown', RESOLVER, 'BROKER_RECONCILIATION_EVIDENCE_APPLIED'],
] as const) {
    registerEdge('broker_order', edgeId, from, 'filled', actors, N, [reason], NONE);
}
for (const [prefix, to, normalReason] of [
    ['BRO-006', 'cancelled', 'BROKER_CANCELLED_CONFIRMED'],
    ['BRO-007', 'inactive', 'BROKER_INACTIVE_CONFIRMED'],
    ['BRO-008', 'failed', 'BROKER_FAILED_CONFIRMED'],
] as const) {
    for (const [suffix, from] of [
        ['A', 'pending_submit'],
        ['B', 'pre_submitted'],
        ['C', 'submitted'],
        ['D', 'part_filled'],
    ] as const) {
        registerEdge('broker_order', `${prefix}${suffix}`, from, to, RECONCILER, N, [normalReason], NONE);
    }
    registerEdge('broker_order', `${prefix}E`, 'unknown', to, RESOLVER, N, ['BROKER_RECONCILIATION_EVIDENCE_APPLIED'], NONE);
}
for (const [edgeId, from] of [
    ['BRO-009A', 'pending_submit'],
    ['BRO-009B', 'pre_submitted'],
    ['BRO-009C', 'submitted'],
    ['BRO-009D', 'part_filled'],
] as const) {
    registerEdge('broker_order', edgeId, from, 'unknown', RECONCILER, N, ['BROKER_STATE_UNKNOWN'], NONE);
}
const CONTROL_RESERVATION_ACTORS: readonly ActorKind[] = [
    'runtime_evaluator',
    'interactive_user',
    'gate_runner',
    'resolution_service',
    'lifecycle_service',
];
for (const [edgeId, state] of [
    ['BRO-010A', 'pending_submit'],
    ['BRO-010B', 'pre_submitted'],
    ['BRO-010C', 'submitted'],
    ['BRO-010D', 'part_filled'],
] as const) {
    registerEdge(
        'broker_order',
        edgeId,
        state,
        state,
        CONTROL_RESERVATION_ACTORS,
        N,
        ['BROKER_UPDATE_TARGET_RESERVED', 'BROKER_CANCEL_TARGET_RESERVED'],
        [
            'BrokerOrder.controlRevision_incremented',
            'OrderIntent.prepared',
            'TargetReservation',
        ],
    );
}

registerEdge('activation', 'ACT-006', 'triggered', 'failed', EVALUATOR, N, ['ACTIVATION_VALIDATION_FAILED_PRE_DISPATCH'], NONE);
registerEdge(
    'activation',
    'ACT-007',
    'prepared',
    'dispatching',
    DISPATCHER,
    DISPATCH_PROVENANCE,
    ['DISPATCH_FENCE_COMMITTED'],
    ['Activation.dispatching', 'OrderIntent.dispatching', 'DurableDispatchBlocker.open'],
    { requiresTrustedWallTime: true },
);
registerEdge('activation', 'ACT-008', 'prepared', 'cancelled', ['interactive_user', 'lifecycle_service'], N, ['INTENT_CANCELLED_PROVEN_UNSENT'], NONE);
registerEdge('activation', 'ACT-009', 'dispatching', 'working', BROKER_OR_RECONCILER, N, ['BROKER_ORDER_WORKING_CONFIRMED'], NONE);
for (const [edgeId, from] of [
    ['ACT-010A', 'dispatching'],
    ['ACT-010B', 'working'],
    ['ACT-010C', 'part_filled'],
] as const) {
    registerEdge('activation', edgeId, from, 'part_filled', BROKER_OR_RECONCILER, N, [edgeId === 'ACT-010C' ? 'BROKER_ADDITIONAL_FILL_CONFIRMED' : 'BROKER_PART_FILL_CONFIRMED'], NONE);
}
for (const [edgeId, from] of [
    ['ACT-011A', 'dispatching'],
    ['ACT-011B', 'working'],
    ['ACT-011C', 'part_filled'],
] as const) {
    registerEdge('activation', edgeId, from, 'filled', RECONCILER, N, ['BROKER_FULL_FILL_CONFIRMED'], NONE);
}
for (const [edgeId, from] of [
    ['ACT-012A', 'dispatching'],
    ['ACT-012B', 'working'],
    ['ACT-012C', 'part_filled'],
] as const) {
    registerEdge('activation', edgeId, from, 'cancelled', RECONCILER, N, ['BROKER_CANCELLED_CONFIRMED'], NONE);
}
for (const [edgeId, from] of [
    ['ACT-013A', 'dispatching'],
    ['ACT-013B', 'working'],
    ['ACT-013C', 'part_filled'],
] as const) {
    registerEdge('activation', edgeId, from, 'failed', RECONCILER, N, ['BROKER_REJECTED_CONFIRMED'], NONE);
}
for (const [edgeId, from, actors] of [
    ['ACT-014A', 'dispatching', ['runtime_dispatcher', 'reconciliation_service']],
    ['ACT-014B', 'working', ['reconciliation_service']],
    ['ACT-014C', 'part_filled', ['reconciliation_service']],
] as const) {
    registerEdge('activation', edgeId, from, 'unknown', actors, N, ['BROKER_OUTCOME_UNKNOWN'], NONE);
}
for (const [edgeId, to] of [
    ['ACT-015A', 'working'],
    ['ACT-015B', 'part_filled'],
    ['ACT-015C', 'filled'],
    ['ACT-015D', 'cancelled'],
] as const) {
    registerEdge('activation', edgeId, 'unknown', to, RESOLVER, N, ['MANUAL_FINAL_EVIDENCE_APPLIED'], NONE);
}
registerEdge(
    'activation',
    'ACT-015E',
    'unknown',
    'failed',
    RESOLVER,
    N,
    ['MANUAL_FINAL_EVIDENCE_APPLIED', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
    NONE,
    {
        variants: [
            {
                reasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
                companions: BREAK_GLASS_COMPANIONS,
            },
        ],
        authorizationKindsByReason: {
            MANUAL_BREAK_GLASS_RELINQUISHED: ['BreakGlassAuthorization'],
        },
    },
);

// PendingProtectionCommitment: the durable pre-entry protection promise.
registerEdge(
    'pending_protection_commitment',
    'PPC-001',
    '__create__',
    'prepared',
    INTENT_CREATORS,
    N,
    ['PROTECTION_PLAN_PREPARED_DURABLE'],
    ENTRY_PREPARE_COMPANIONS,
);
registerEdge(
    'pending_protection_commitment',
    'PPC-002',
    'prepared',
    'entry_dispatching',
    DISPATCHER,
    N,
    ['ENTRY_DISPATCH_FENCE_COMMITTED'],
    NONE,
);
registerEdge(
    'pending_protection_commitment',
    'PPC-003',
    'prepared',
    'released_pre_dispatch',
    ['interactive_user', 'lifecycle_service'],
    N,
    ['PROTECTION_PLAN_CANCELLED_PROVEN_UNSENT'],
    NONE,
);
registerEdge(
    'pending_protection_commitment',
    'PPC-004',
    'entry_dispatching',
    'waiting_entry_result',
    BROKER_OR_RECONCILER,
    N,
    ['ENTRY_ACKNOWLEDGED_WAITING_FILL'],
    NONE,
);
for (const [edgeId, from] of [
    ['PPC-005A', 'entry_dispatching'],
    ['PPC-005B', 'waiting_entry_result'],
] as const) {
    registerEdge(
        'pending_protection_commitment',
        edgeId,
        from,
        'materializing',
        RECONCILER,
        N,
        ['ENTRY_FILL_CONFIRMED_MATERIALIZING'],
        ENTRY_QUANTITY_COMPANIONS,
    );
}
registerEdge(
    'pending_protection_commitment',
    'PPC-006',
    'materializing',
    'materializing',
    RECONCILER,
    N,
    ['ENTRY_ADDITIONAL_FILL_MATERIALIZED'],
    ENTRY_QUANTITY_COMPANIONS,
);
for (const [edgeId, from] of [
    ['PPC-007A', 'materializing'],
    ['PPC-007B', 'waiting_entry_result'],
] as const) {
    registerEdge(
        'pending_protection_commitment',
        edgeId,
        from,
        'materialized',
        RECONCILER,
        N,
        ['ENTRY_FINAL_QUANTITY_MATERIALIZED'],
        ENTRY_QUANTITY_COMPANIONS,
    );
}
for (const [edgeId, from, actors] of [
    ['PPC-008A', 'waiting_entry_result', RECONCILER],
    ['PPC-008B', 'materializing', RESOLVER],
    ['PPC-008C', 'entry_dispatching', RECONCILER],
] as const) {
    registerEdge(
        'pending_protection_commitment',
        edgeId,
        from,
        'zero_fill_terminal',
        actors,
        N,
        ['ENTRY_ZERO_FILL_TERMINAL'],
        ENTRY_QUANTITY_COMPANIONS,
    );
}
for (const [edgeId, from] of [
    ['PPC-009A', 'entry_dispatching'],
    ['PPC-009B', 'waiting_entry_result'],
    ['PPC-009C', 'materializing'],
] as const) {
    registerEdge(
        'pending_protection_commitment',
        edgeId,
        from,
        'unknown',
        RECONCILER,
        N,
        ['ENTRY_RESULT_UNKNOWN'],
        NONE,
    );
}
for (const [edgeId, to] of [
    ['PPC-010A', 'materializing'],
    ['PPC-010B', 'materialized'],
    ['PPC-010C', 'zero_fill_terminal'],
] as const) {
    registerEdge(
        'pending_protection_commitment',
        edgeId,
        'unknown',
        to,
        RESOLVER,
        N,
        ['MANUAL_FINAL_EVIDENCE_APPLIED'],
        NONE,
    );
}
registerEdge(
    'pending_protection_commitment',
    'PPC-011',
    'unknown',
    'released_manual',
    RESOLVER,
    N,
    ['MANUAL_BREAK_GLASS_RELINQUISHED'],
    BREAK_GLASS_COMPANIONS,
    { requiredAuthorizationKinds: ['BreakGlassAuthorization'] },
);

const PROTECTION_SAFETY_REASONS = [
    'ENTRY_RESULT_UNKNOWN',
    'EXIT_CLAIM_UNKNOWN',
    'TRAILING_GAP_EXTREME_UNKNOWN',
    'EXTERNAL_POSITION_DRIFT',
    'PROTECTION_UNPROTECTED_REMAINDER',
    'POSITION_OR_UNIT_UNKNOWN',
    'EXTERNAL_WORKING_SET_INCOMPLETE',
    'DB_INTEGRITY_FAILED',
] as const satisfies readonly ReasonCode[];
const PROTECTION_SAFETY_COMPANIONS: readonly AtomicCompanionKind[] = [
    'ProtectionObligation.safety_blocked',
    'ResolutionCase.open',
    'SafetyBlocker.open',
];

// ProtectionObligation: remains live after the entry commitment becomes terminal.
registerEdge(
    'protection_obligation',
    'POB-001',
    '__create__',
    'pending_entry',
    INTENT_CREATORS,
    N,
    ['PROTECTION_OBLIGATION_CREATED'],
    ENTRY_PREPARE_COMPANIONS,
);
registerEdge(
    'protection_obligation',
    'POB-002',
    'pending_entry',
    'monitoring',
    RECONCILER,
    N,
    ['PROTECTION_CLAIM_CREATED_FROM_FILL'],
    ENTRY_QUANTITY_COMPANIONS,
);
for (const [edgeId, from] of [
    ['POB-003A', 'pending_entry'],
    ['POB-003B', 'monitoring'],
    ['POB-003C', 'exit_dispatching'],
    ['POB-003D', 'exit_working'],
    ['POB-003E', 'partially_exited'],
] as const) {
    registerEdge(
        'protection_obligation',
        edgeId,
        from,
        'reconciling',
        RECONCILER,
        N,
        ['PROTECTION_RECONCILIATION_REQUIRED'],
        NONE,
    );
}
registerEdge(
    'protection_obligation',
    'POB-004',
    'pending_entry',
    'zero_fill_terminal',
    RECONCILER,
    N,
    ['ENTRY_ZERO_FILL_TERMINAL'],
    NONE,
);
registerEdge(
    'protection_obligation',
    'POB-005',
    'monitoring',
    'monitoring',
    ['reconciliation_service', 'runtime_evaluator'],
    N,
    ['PROTECTION_MONITORING_REVISION_UPDATED'],
    ENTRY_QUANTITY_COMPANIONS,
);
registerEdge(
    'protection_obligation',
    'POB-006',
    'monitoring',
    'exit_dispatching',
    EVALUATOR,
    N,
    ['OCO_WINNER_SELECTED'],
    EXIT_PREPARE_COMPANIONS,
);
registerEdge(
    'protection_obligation',
    'POB-007',
    'exit_dispatching',
    'exit_working',
    BROKER_OR_RECONCILER,
    N,
    ['EXIT_BROKER_WORKING_CONFIRMED'],
    NONE,
);
for (const [edgeId, from, reasonCode] of [
    ['POB-008A', 'exit_dispatching', 'EXIT_PART_FILL_CONFIRMED'],
    ['POB-008B', 'exit_working', 'EXIT_PART_FILL_CONFIRMED'],
    ['POB-008C', 'partially_exited', 'EXIT_ADDITIONAL_FILL_CONFIRMED'],
] as const) {
    registerEdge(
        'protection_obligation',
        edgeId,
        from,
        'partially_exited',
        RECONCILER,
        N,
        [reasonCode],
        EXIT_QUANTITY_COMPANIONS,
    );
}
registerEdge(
    'protection_obligation',
    'POB-009',
    'partially_exited',
    'monitoring',
    RECONCILER,
    N,
    ['PROTECTION_REMAINDER_REARM_REQUIRED'],
    EXIT_QUANTITY_COMPANIONS,
    { requiredAuthorizationKinds: ['UserRearmAuthorization'] },
);
for (const [edgeId, from] of [
    ['POB-010A', 'exit_dispatching'],
    ['POB-010B', 'exit_working'],
    ['POB-010C', 'partially_exited'],
] as const) {
    registerEdge(
        'protection_obligation',
        edgeId,
        from,
        'fulfilled',
        RECONCILER,
        N,
        ['PROTECTION_FULLY_EXITED_CONFIRMED'],
        EXIT_QUANTITY_COMPANIONS,
    );
}
for (const [edgeId, from] of [
    ['POB-011A', 'pending_entry'],
    ['POB-011B', 'monitoring'],
    ['POB-011C', 'exit_dispatching'],
    ['POB-011D', 'exit_working'],
    ['POB-011E', 'partially_exited'],
    ['POB-011F', 'reconciling'],
] as const) {
    registerEdge(
        'protection_obligation',
        edgeId,
        from,
        'safety_blocked',
        RESOLVER,
        N,
        PROTECTION_SAFETY_REASONS,
        PROTECTION_SAFETY_COMPANIONS,
    );
}
for (const [edgeId, to] of [
    ['POB-012A', 'pending_entry'],
    ['POB-012B', 'monitoring'],
    ['POB-012C', 'exit_working'],
    ['POB-012D', 'partially_exited'],
    ['POB-012E', 'fulfilled'],
    ['POB-012F', 'zero_fill_terminal'],
] as const) {
    registerEdge(
        'protection_obligation',
        edgeId,
        'reconciling',
        to,
        RESOLVER,
        N,
        ['PROTECTION_RECONCILIATION_EVIDENCE_APPLIED'],
        NONE,
    );
}
for (const [edgeId, to] of [
    ['POB-013A', 'pending_entry'],
    ['POB-013B', 'monitoring'],
    ['POB-013C', 'exit_working'],
    ['POB-013D', 'partially_exited'],
    ['POB-013E', 'fulfilled'],
    ['POB-013F', 'zero_fill_terminal'],
] as const) {
    registerEdge(
        'protection_obligation',
        edgeId,
        'safety_blocked',
        to,
        RESOLVER,
        N,
        ['MANUAL_FINAL_EVIDENCE_APPLIED'],
        NONE,
    );
}
registerEdge(
    'protection_obligation',
    'POB-014',
    'safety_blocked',
    'released_manual',
    RESOLVER,
    N,
    ['MANUAL_BREAK_GLASS_RELINQUISHED'],
    BREAK_GLASS_COMPANIONS,
    { requiredAuthorizationKinds: ['BreakGlassAuthorization'] },
);

// EntryExposureReservation is monotonic: no edge can grow or reopen a reservation.
registerEdge(
    'entry_exposure_reservation',
    'EER-001',
    '__create__',
    'reserved',
    INTENT_CREATORS,
    N,
    ['ENTRY_EXPOSURE_RESERVED'],
    ENTRY_PREPARE_COMPANIONS,
);
registerEdge(
    'entry_exposure_reservation',
    'EER-002',
    'reserved',
    'partially_consumed',
    RECONCILER,
    N,
    ['ENTRY_RESERVATION_PARTIALLY_CONSUMED'],
    ENTRY_QUANTITY_COMPANIONS,
);
for (const [edgeId, from] of [
    ['EER-003A', 'reserved'],
    ['EER-003B', 'partially_consumed'],
] as const) {
    registerEdge(
        'entry_exposure_reservation',
        edgeId,
        from,
        'consumed',
        RECONCILER,
        N,
        ['ENTRY_RESERVATION_FULLY_CONSUMED'],
        ENTRY_QUANTITY_COMPANIONS,
    );
}
for (const [edgeId, from] of [
    ['EER-004A', 'reserved'],
    ['EER-004B', 'partially_consumed'],
] as const) {
    registerEdge(
        'entry_exposure_reservation',
        edgeId,
        from,
        'released',
        ['reconciliation_service', 'lifecycle_service'],
        N,
        ['ENTRY_RESERVATION_RELEASED'],
        NONE,
    );
}
for (const [edgeId, from] of [
    ['EER-005A', 'reserved'],
    ['EER-005B', 'partially_consumed'],
] as const) {
    registerEdge(
        'entry_exposure_reservation',
        edgeId,
        from,
        'unknown',
        RECONCILER,
        N,
        ['ENTRY_RESERVATION_UNKNOWN'],
        NONE,
    );
}
for (const [edgeId, to] of [
    ['EER-006A', 'partially_consumed'],
    ['EER-006B', 'consumed'],
] as const) {
    registerEdge(
        'entry_exposure_reservation',
        edgeId,
        'unknown',
        to,
        RESOLVER,
        N,
        ['MANUAL_FINAL_EVIDENCE_APPLIED'],
        NONE,
    );
}
registerEdge(
    'entry_exposure_reservation',
    'EER-006C',
    'unknown',
    'released',
    RESOLVER,
    N,
    ['MANUAL_FINAL_EVIDENCE_APPLIED', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
    NONE,
    {
        variants: [
            {
                reasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
                companions: BREAK_GLASS_COMPANIONS,
            },
        ],
        authorizationKindsByReason: {
            MANUAL_BREAK_GLASS_RELINQUISHED: ['BreakGlassAuthorization'],
        },
    },
);

// Runtime-owned ExitClaim and discovered ExternalSellClaim share only the
// broker-working/unknown/terminal suffix of their lifecycle.
registerEdge(
    'exit_claim',
    'EXC-001',
    '__create__',
    'monitoring_reserved',
    RECONCILER,
    N,
    ['EXIT_CLAIM_MONITORING_RESERVED'],
    NONE,
);
registerEdge(
    'external_sell_claim',
    'EXC-002',
    '__create__',
    'broker_working',
    RECONCILER,
    N,
    ['EXTERNAL_SELL_CLAIM_DISCOVERED'],
    NONE,
);
registerEdge(
    'exit_claim',
    'EXC-003',
    'monitoring_reserved',
    'intent_reserved',
    EVALUATOR,
    N,
    ['OCO_WINNER_SELECTED'],
    EXIT_PREPARE_COMPANIONS,
);
registerEdge(
    'exit_claim',
    'EXC-004',
    'monitoring_reserved',
    'released',
    ['reconciliation_service', 'lifecycle_service'],
    N,
    ['EXIT_CLAIM_RELEASED_UNUSED'],
    NONE,
);
registerEdge(
    'exit_claim',
    'EXC-005',
    'intent_reserved',
    'broker_working',
    BROKER_OR_RECONCILER,
    N,
    ['EXIT_CLAIM_BROKER_WORKING'],
    NONE,
);
registerEdge(
    'exit_claim',
    'EXC-006',
    'intent_reserved',
    'released',
    ['interactive_user', 'lifecycle_service'],
    N,
    ['EXIT_INTENT_CANCELLED_PROVEN_UNSENT'],
    NONE,
);
registerEdge(
    'exit_claim',
    'EXC-007A',
    'intent_reserved',
    'unknown',
    RECONCILER,
    N,
    ['EXIT_CLAIM_UNKNOWN'],
    NONE,
);
for (const kind of ['exit_claim', 'external_sell_claim'] as const) {
    registerEdge(
        kind,
        'EXC-007B',
        'broker_working',
        'unknown',
        RECONCILER,
        N,
        ['EXIT_CLAIM_UNKNOWN'],
        NONE,
    );
    registerEdge(
        kind,
        'EXC-008',
        'broker_working',
        'consumed',
        RECONCILER,
        N,
        ['EXIT_CLAIM_CONSUMED_CONFIRMED'],
        EXIT_QUANTITY_COMPANIONS,
    );
    registerEdge(
        kind,
        'EXC-009',
        'broker_working',
        'released',
        RECONCILER,
        N,
        ['EXIT_CLAIM_RELEASED_AFTER_TERMINAL'],
        EXIT_QUANTITY_COMPANIONS,
    );
    for (const [edgeId, to] of [
        ['EXC-010A', 'broker_working'],
        ['EXC-010B', 'consumed'],
    ] as const) {
        registerEdge(
            kind,
            edgeId,
            'unknown',
            to,
            RESOLVER,
            N,
            ['MANUAL_FINAL_EVIDENCE_APPLIED'],
            NONE,
        );
    }
    registerEdge(
        kind,
        'EXC-010C',
        'unknown',
        'released',
        RESOLVER,
        N,
        ['MANUAL_FINAL_EVIDENCE_APPLIED', 'MANUAL_BREAK_GLASS_RELINQUISHED'],
        NONE,
        {
            variants: [
                {
                    reasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
                    companions: BREAK_GLASS_COMPANIONS,
                },
            ],
            authorizationKindsByReason: {
                MANUAL_BREAK_GLASS_RELINQUISHED: [
                    'BreakGlassAuthorization',
                ],
            },
        },
    );
}

// RuntimeEpoch never inherits write authority.  A fresh epoch must reconcile
// into observe_only before it may be explicitly armed.
registerEdge(
    'runtime_epoch',
    'RTE-001',
    '__create__',
    'starting',
    LIFECYCLE,
    N,
    ['RUNTIME_EPOCH_CREATED'],
    NONE,
);
registerEdge(
    'runtime_epoch',
    'RTE-002',
    'starting',
    'fenced',
    LIFECYCLE,
    N,
    ['RUNTIME_SINGLE_WRITER_FENCE_ACQUIRED'],
    NONE,
);
for (const [edgeId, from] of [
    ['RTE-003A', 'starting'],
    ['RTE-003B', 'fenced'],
] as const) {
    registerEdge(
        'runtime_epoch',
        edgeId,
        from,
        'failed_stop',
        LIFECYCLE,
        N,
        ['RUNTIME_STARTUP_FAIL_CLOSED'],
        NONE,
    );
}
registerEdge(
    'runtime_epoch',
    'RTE-004',
    'fenced',
    'reconciling',
    RECONCILER,
    N,
    ['RUNTIME_RECONCILIATION_STARTED'],
    NONE,
);
registerEdge(
    'runtime_epoch',
    'RTE-005',
    'reconciling',
    'observe_only',
    RECONCILER,
    N,
    ['RUNTIME_RECONCILED_OBSERVE_ONLY'],
    NONE,
);
registerEdge(
    'runtime_epoch',
    'RTE-006',
    'observe_only',
    'ready_unarmed',
    EVALUATOR,
    N,
    ['RUNTIME_READY_REARM_REQUIRED'],
    NONE,
);
registerEdge(
    'runtime_epoch',
    'RTE-007',
    'ready_unarmed',
    'write_armed',
    USER,
    N,
    ['USER_WRITE_MASTER_ARMED'],
    NONE,
    { requiredAuthorizationKinds: ['UserArmAuthorization'] },
);
registerEdge(
    'runtime_epoch',
    'RTE-008',
    'write_armed',
    'ready_unarmed',
    ['interactive_user', 'runtime_evaluator'],
    N,
    ['USER_WRITE_MASTER_DISARMED', 'POLICY_PAUSE_AUTOMATION'],
    NONE,
);
for (const [edgeId, from] of [
    ['RTE-009A', 'ready_unarmed'],
    ['RTE-009B', 'write_armed'],
] as const) {
    registerEdge(
        'runtime_epoch',
        edgeId,
        from,
        'observe_only',
        EVALUATOR,
        N,
        ['RUNTIME_READINESS_REVOKED'],
        NONE,
    );
}
for (const [edgeId, from] of [
    ['RTE-010A', 'observe_only'],
    ['RTE-010B', 'ready_unarmed'],
    ['RTE-010C', 'write_armed'],
] as const) {
    registerEdge(
        'runtime_epoch',
        edgeId,
        from,
        'reconciling',
        RECONCILER,
        N,
        ['RUNTIME_RECONCILIATION_REQUIRED'],
        NONE,
    );
}
for (const [edgeId, from] of [
    ['RTE-011A', 'starting'],
    ['RTE-011B', 'fenced'],
    ['RTE-011C', 'reconciling'],
    ['RTE-011D', 'observe_only'],
    ['RTE-011E', 'ready_unarmed'],
    ['RTE-011F', 'write_armed'],
] as const) {
    registerEdge(
        'runtime_epoch',
        edgeId,
        from,
        'quiescing',
        LIFECYCLE,
        N,
        ['RUNTIME_QUIESCE_REQUESTED'],
        NONE,
    );
}
registerEdge(
    'runtime_epoch',
    'RTE-012',
    'quiescing',
    'stopped',
    LIFECYCLE,
    N,
    ['RUNTIME_GRACEFUL_STOP_COMPLETE'],
    NONE,
);
registerEdge(
    'runtime_epoch',
    'RTE-013A',
    'quiescing',
    'observe_only',
    LIFECYCLE,
    N,
    ['RUNTIME_QUIESCE_BLOCKED_OBLIGATION'],
    NONE,
);
registerEdge(
    'runtime_epoch',
    'RTE-013B',
    'quiescing',
    'reconciling',
    LIFECYCLE,
    N,
    ['RUNTIME_RECONCILIATION_REQUIRED'],
    NONE,
);
for (const [edgeId, from] of [
    ['RTE-014A', 'fenced'],
    ['RTE-014B', 'reconciling'],
    ['RTE-014C', 'observe_only'],
    ['RTE-014D', 'ready_unarmed'],
    ['RTE-014E', 'write_armed'],
    ['RTE-014F', 'quiescing'],
] as const) {
    registerEdge(
        'runtime_epoch',
        edgeId,
        from,
        'superseded',
        LIFECYCLE,
        N,
        ['RUNTIME_API_GENERATION_SUPERSEDED'],
        NONE,
    );
}
for (const [edgeId, from] of [
    ['RTE-015A', 'starting'],
    ['RTE-015B', 'fenced'],
    ['RTE-015C', 'reconciling'],
    ['RTE-015D', 'observe_only'],
    ['RTE-015E', 'ready_unarmed'],
    ['RTE-015F', 'write_armed'],
    ['RTE-015G', 'quiescing'],
] as const) {
    registerEdge(
        'runtime_epoch',
        edgeId,
        from,
        'failed_stop',
        LIFECYCLE,
        N,
        ['RUNTIME_SENDER_FAIL_STOP'],
        NONE,
    );
}
const FORCED_STOP_COMPANIONS: readonly AtomicCompanionKind[] = [
    'RuntimeEpoch.failed_stop',
    'ForcedStopReleasedEntities',
    'ResolutionCase.relinquished_unknown',
    'RelinquishedUnknownExposure.open',
    'BurnedDispatchNonce',
    'BreakGlassAuthorization',
    'AuditSnapshot',
];
registerEdge(
    'runtime_epoch',
    'RTE-016',
    'quiescing',
    'failed_stop',
    LIFECYCLE,
    N,
    ['RUNTIME_BREAK_GLASS_FORCED_STOP'],
    FORCED_STOP_COMPANIONS,
    { requiredAuthorizationKinds: ['BreakGlassAuthorization'] },
);

// DurableDispatchBlocker is a database fact, not an OS/process lease.
registerEdge(
    'durable_dispatch_blocker',
    'DDB-001',
    '__create__',
    'open',
    DISPATCHER,
    DISPATCH_PROVENANCE,
    ['DURABLE_DISPATCH_BLOCKER_OPENED'],
    ['Activation.dispatching', 'OrderIntent.dispatching', 'DurableDispatchBlocker.open'],
    { requiresTrustedWallTime: true },
);
registerEdge(
    'durable_dispatch_blocker',
    'DDB-002',
    'open',
    'cleared_acknowledged',
    BROKER_OR_RECONCILER,
    N,
    ['DURABLE_DISPATCH_BLOCKER_CLEARED_ACK'],
    [
        'BrokerOrder.current_projection',
        'DurableDispatchBlocker.cleared_acknowledged',
    ],
);
registerEdge(
    'durable_dispatch_blocker',
    'DDB-003',
    'open',
    'cleared_terminal',
    RECONCILER,
    N,
    ['DURABLE_DISPATCH_BLOCKER_CLEARED_TERMINAL'],
    [
        'OperationSpecificTerminalOutcome',
        'BrokerOrder.current_projection',
        'ReservationClaimSettlement',
        'DurableDispatchBlocker.cleared_terminal',
    ],
);
registerEdge(
    'durable_dispatch_blocker',
    'DDB-004',
    'open',
    'cleared_unknown_durable',
    RECONCILER,
    N,
    ['DURABLE_DISPATCH_BLOCKER_CLEARED_UNKNOWN'],
    [
        'OrderIntent.unknown',
        'DurableDispatchBlocker.cleared_unknown_durable',
        'SafetyBlocker.open',
    ],
);
registerEdge(
    'durable_dispatch_blocker',
    'DDB-005',
    'open',
    'cleared_reconciling_durable',
    RECONCILER,
    N,
    ['DURABLE_DISPATCH_BLOCKER_CLEARED_RECONCILING'],
    [
        'OrderIntent.reconciling',
        'DurableDispatchBlocker.cleared_reconciling_durable',
    ],
);

const RESOLUTION_CLOSED_COMPANIONS: readonly AtomicCompanionKind[] = [
    'ImmutableResolutionEvidence',
    'DerivedLedgerReprojection',
    'SafetyBlocker.resolved',
];
const RESOLUTION_OPEN_COMPANIONS: readonly AtomicCompanionKind[] = [
    'ResolutionCase.open',
    'SafetyBlocker.open',
];

registerEdge(
    'resolution_case',
    'RC-001',
    '__create__',
    'open',
    RESOLVER,
    N,
    ['RESOLUTION_CASE_OPENED'],
    RESOLUTION_OPEN_COMPANIONS,
);
registerEdge(
    'resolution_case',
    'RC-002',
    'open',
    'evidence_collecting',
    RESOLVER,
    N,
    ['MANUAL_RECONCILIATION_STARTED'],
    NONE,
);
registerEdge(
    'resolution_case',
    'RC-003',
    'evidence_collecting',
    'decision_required',
    RESOLVER,
    N,
    ['RESOLUTION_CASE_DECISION_REQUIRED'],
    NONE,
);
for (const [edgeId, from] of [
    ['RC-004A', 'open'],
    ['RC-004B', 'evidence_collecting'],
    ['RC-004C', 'decision_required'],
] as const) {
    registerEdge(
        'resolution_case',
        edgeId,
        from,
        'resolved_by_final_evidence',
        RESOLVER,
        N,
        ['RESOLUTION_CASE_RESOLVED_FINAL_EVIDENCE'],
        RESOLUTION_CLOSED_COMPANIONS,
    );
}
registerEdge(
    'resolution_case',
    'RC-005',
    'decision_required',
    'resolved_by_reconfirmation',
    RESOLVER,
    N,
    ['RESOLUTION_CASE_RESOLVED_RECONFIRMED'],
    NONE,
    { requiredAuthorizationKinds: ['UserRearmAuthorization'] },
);
registerEdge(
    'resolution_case',
    'RC-006',
    'decision_required',
    'relinquished_unknown',
    RESOLVER,
    N,
    ['MANUAL_BREAK_GLASS_RELINQUISHED'],
    BREAK_GLASS_COMPANIONS,
    { requiredAuthorizationKinds: ['BreakGlassAuthorization'] },
);

registerEdge(
    'safety_blocker',
    'SB-001',
    '__create__',
    'open',
    RESOLVER,
    N,
    ['SAFETY_BLOCKER_OPENED', 'RELINQUISHED_UNKNOWN_EXPOSURE_OPENED'],
    RESOLUTION_OPEN_COMPANIONS,
);
registerEdge(
    'safety_blocker',
    'SB-002',
    'open',
    'resolved',
    RESOLVER,
    N,
    ['SAFETY_BLOCKER_RESOLVED', 'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED'],
    RESOLUTION_CLOSED_COMPANIONS,
);
registerEdge(
    'safety_blocker',
    'SB-003',
    'open',
    'superseded_by_stricter_blocker',
    RESOLVER,
    N,
    ['SAFETY_BLOCKER_OPENED'],
    ['SafetyBlocker.open'],
);

function validateBuiltEdgeRegistry(
    definitions: readonly StateEdgeDefinition[],
): void {
    const brokerAuthorityEdges = new Set([
        'activation:ACT-007',
        'order_intent:INT-002',
        'durable_dispatch_blocker:DDB-001',
    ]);
    for (const edge of definitions) {
        const key = edgeRegistryKey(edge.entityKind, edge.edgeId);
        if (
            edge.from !== '__create__' &&
            (STATE_CLASSIFICATION[edge.entityKind].terminal as readonly string[]).includes(
                edge.from,
            )
        ) {
            throw new Error(`terminal state has an outgoing edge: ${key}`);
        }
        if (edge.to === 'manual_intervention' && edge.entityKind !== 'strategy') {
            throw new Error(`manual_intervention is Strategy-only: ${key}`);
        }
        const hasBrokerAuthority = edge.brokerWriteProvenance.some(
            (value) => value !== 'none',
        );
        if (hasBrokerAuthority !== brokerAuthorityEdges.has(key)) {
            throw new Error(`invalid broker authority metadata: ${key}`);
        }
        for (const reasonCode of edge.reasonCodes) {
            const evidence = edge.evidenceClassesByReason[reasonCode];
            const required =
                SMART_ORDER_REASON_REGISTRY[reasonCode].requiredEvidenceClass;
            if (
                !evidence ||
                evidence.length !== 1 ||
                evidence[0] !== required
            ) {
                throw new Error(
                    `reason/evidence registry mismatch: ${key}:${reasonCode}`,
                );
            }
        }
        const variantKeys = new Set<string>();
        for (const variant of edge.atomicCompanionVariants) {
            if (
                variant.reasonCode &&
                !edge.reasonCodes.includes(variant.reasonCode)
            ) {
                throw new Error(
                    `companion variant has an invalid reason: ${key}`,
                );
            }
            const variantKey = `${variant.reasonCode ?? '*'}:${variant.ownerKind ?? '*'}`;
            if (variantKeys.has(variantKey)) {
                throw new Error(`duplicate companion variant: ${key}:${variantKey}`);
            }
            variantKeys.add(variantKey);
        }
        for (const reasonCode of Object.keys(
            edge.authorizationKindsByReason,
        ) as ReasonCode[]) {
            if (!edge.reasonCodes.includes(reasonCode)) {
                throw new Error(
                    `authorization variant has an invalid reason: ${key}:${reasonCode}`,
                );
            }
        }
    }
}

const BUILT_EDGE_DEFINITIONS = Object.freeze([...EDGE_BUILDERS.values()]);
validateBuiltEdgeRegistry(BUILT_EDGE_DEFINITIONS);

export const SMART_ORDER_EDGE_REGISTRY = BUILT_EDGE_DEFINITIONS;

export function getStateEdgeDefinition<Kind extends EntityKind>(
    entityKind: Kind,
    edgeId: string,
): StateEdgeDefinition<Kind> | undefined {
    return EDGE_BUILDERS.get(edgeRegistryKey(entityKind, edgeId)) as
        | StateEdgeDefinition<Kind>
        | undefined;
}

export const SMART_ORDER_REASON_SCHEMA_VERSION =
    'smart-order-reasons/2026-08-11.4' as const;

export type SmartOrderStateMachineErrorCode =
    | 'invalid_transition_request'
    | 'edge_not_allowlisted'
    | 'state_revision_conflict'
    | 'terminal_entity_closed'
    | 'actor_not_allowed'
    | 'provenance_not_allowed'
    | 'reason_not_allowed'
    | 'evidence_missing_or_mismatch'
    | 'authorization_missing'
    | 'atomic_companion_mismatch'
    | 'lineage_mismatch'
    | 'untrusted_wall_time'
    | 'intent_owner_mismatch'
    | 'intent_outcome_invalid'
    | 'runtime_epoch_invariant'
    | 'entity_invariant_violation'
    | 'resolution_matrix_rejected'
    | 'immutable_definition_violation'
    | 'control_revision_conflict';

export class SmartOrderStateMachineError extends Error {
    readonly code: SmartOrderStateMachineErrorCode;
    readonly rejectionReasonCode:
        | 'STATE_TRANSITION_NOT_ALLOWLISTED'
        | 'STATE_REVISION_CONFLICT';

    constructor(code: SmartOrderStateMachineErrorCode, message: string) {
        super(message);
        this.name = 'SmartOrderStateMachineError';
        this.code = code;
        this.rejectionReasonCode =
            code === 'state_revision_conflict' ||
            code === 'control_revision_conflict'
                ? 'STATE_REVISION_CONFLICT'
                : 'STATE_TRANSITION_NOT_ALLOWLISTED';
    }
}

export type ObservedWallTimeSource =
    | 'broker_event'
    | 'trusted_market_calendar'
    | 'runtime_monotonic_bridge'
    | 'interactive_user_action'
    | 'repository_reconciliation'
    | 'lifecycle_clock'
    | 'gate_probe_clock';

export interface TransitionEvidence {
    readonly evidenceId: string;
    readonly evidenceHash: string;
    readonly evidenceClass: EvidenceClass;
    readonly brokerOrderQuantity?: Readonly<{
        schemaVersion: typeof BROKER_ORDER_QUANTITY_EVIDENCE_SCHEMA_VERSION;
        brokerOrderId: string;
        fixedAccountOpaqueRef: string;
        tradeDate: string;
        contractKey: string;
        side: 'Buy' | 'Sell';
        brokerCorrelationHash: string;
        quantityShares: bigint;
        filledShares: bigint;
        remainingShares: bigint;
        outcome: 'accepted' | 'part_filled' | 'filled';
        finality: 'current' | 'unique_final';
    }>;
}

export interface AuthorizationEvidence {
    readonly authorizationId: string;
    readonly authorizationHash: string;
    readonly kind: AuthorizationEvidenceKind;
    readonly burnedNonce?: string;
    readonly burnedNonces?: readonly Readonly<{
        nonce: string;
        revision: number;
    }>[];
    readonly secondConfirmationHash?: string;
}

export interface AtomicCompanionProof {
    readonly companionKind: AtomicCompanionKind;
    readonly recordId: string;
    readonly recordHash: string;
    readonly lineageId: string;
    readonly lineageGeneration: number;
    readonly scopeId: string;
    readonly transactionId: string;
    readonly reasonCode: ReasonCode;
    readonly ownerKind: CompanionOwnerKind;
}

export interface ResolutionCaseLink {
    readonly resolutionCaseId: string;
    readonly caseRevision: number;
    readonly safetyBlockerId: string;
    readonly openingReasonCode: ReasonCode;
    readonly state: ResolutionCaseState;
    readonly scopeSha256: `sha256:${string}`;
    readonly targetSideEffectSha256: `sha256:${string}`;
    readonly evidenceSnapshotSha256: `sha256:${string}`;
    readonly evidenceHash: string;
}

export interface StrategyDefinitionSeal
    extends ImmutableStrategyDefinitionBinding {
    readonly strategyId: string;
    readonly immutableDefinitionRecordId: string;
}

export interface EntryProtectionAtomicBinding {
    readonly strategyId: string;
    readonly fixedAccountOpaqueRef: string;
    readonly contractKey: string;
    readonly entryIntentId: string;
    readonly commitmentId: string;
    readonly obligationId: string;
    readonly reservationId: string | 'policy_not_required';
    readonly entryIntentOwner: IntentOwner;
}

export interface ExitProtectionAtomicBinding {
    readonly strategyId: string;
    readonly fixedAccountOpaqueRef: string;
    readonly contractKey: string;
    readonly positionLineageId: string;
    readonly protectionGroupId: string;
    readonly remainderGeneration: number;
    readonly activationId: string;
    readonly winnerLegId: string;
    readonly suppressedSetId: string;
    readonly suppressedLegIds: readonly string[];
    readonly exitClaimId: string;
    readonly exitIntentId: string;
    readonly exitIntentOwner: IntentOwner;
    readonly obligationId: string;
}

export interface DispatchAtomicBinding {
    readonly activationId: string;
    readonly intentId: string;
    readonly intentOperation: IntentOperation;
    readonly durableDispatchBlockerId: string;
    readonly dispatchAttemptNonce: string;
    readonly senderFence: string;
    readonly runtimeEpochId: string;
    readonly intendedProvenance: Exclude<BrokerWriteProvenance, 'none'>;
}

export interface ControlReservationAtomicBinding {
    readonly operation: 'update' | 'cancel';
    readonly targetBrokerOrderId: string;
    readonly controlIntentId: string;
    readonly targetReservationId: string;
    readonly expectedControlRevision: number;
    readonly nextControlRevision: number;
}

export interface RuntimeStopProof {
    readonly ephemeralProcessLeaseCount: number;
    readonly openDurableDispatchBlockerCount: number;
    readonly requiredDrainPassed: boolean;
    readonly durableSnapshotHash: string;
    readonly databaseCommitReliablyAvailable: boolean;
    readonly senderAuthorityEverAcquired: boolean;
    readonly durableSideEffectHistoryExists: boolean;
    readonly durableObligationHistoryExists: boolean;
}

export type EntityQuantityProjection =
    | Readonly<{
          entityKind: 'broker_order';
          quantityShares: bigint;
          filledShares: bigint;
          remainingShares: bigint;
      }>
    | Readonly<{
          entityKind: 'pending_protection_commitment';
          cumulativeFilledShares: bigint;
          openPotentialShares: bigint;
          terminalUnfilledShares: bigint;
          materializedFilledShares: bigint;
          unmaterializedConfirmedFillShares: bigint;
      }>
    | Readonly<{
          entityKind: 'protection_obligation';
          filledShares: bigint;
          confirmedExitedShares: bigint;
          protectedShares: bigint | 'unknown';
          runtimeTrackedUnprotectedRemainder: bigint | 'unknown';
      }>
    | Readonly<{
          entityKind: 'entry_exposure_reservation';
          reservedRemainingShares: bigint;
          consumedShares: bigint;
          releasedShares: bigint;
      }>
    | Readonly<{
          entityKind: 'exit_claim' | 'external_sell_claim';
          activeShares: bigint;
          consumedShares: bigint;
          releasedShares: bigint;
      }>;

export interface StateTransitionRequest {
    readonly transitionRequestId: string;
    readonly requestPayloadHash: string;
    readonly targetSideEffectSha256?: `sha256:${string}`;
    readonly effectProjectionSha256?: `sha256:${string}`;
    readonly edgeId: string;
    readonly expectedRevision: number;
    readonly actorKind: ActorKind;
    readonly brokerWriteProvenance: BrokerWriteProvenance;
    readonly reasonCode: ReasonCode;
    readonly evidence: readonly TransitionEvidence[];
    readonly authorizationEvidence: readonly AuthorizationEvidence[];
    readonly observedWallTime: string;
    readonly observedWallTimeSource: ObservedWallTimeSource;
    readonly wallTimeTrustStatus: WallTimeTrustStatus;
    readonly monotonicLocalSequence: number;
    readonly committedAt: string;
    readonly runtimeEpochId: string;
    readonly apiGeneration?: string;
    readonly scopeId: string;
    readonly atomicTransactionId: string;
    readonly atomicCompanionProofs: readonly AtomicCompanionProof[];
    readonly companionOwnerKind?: CompanionOwnerKind;
    readonly resolutionCaseLink?: ResolutionCaseLink;
    readonly strategyDefinitionSeal?: StrategyDefinitionSeal;
    readonly entryProtectionBinding?: EntryProtectionAtomicBinding;
    readonly exitProtectionBinding?: ExitProtectionAtomicBinding;
    readonly dispatchBinding?: DispatchAtomicBinding;
    readonly controlReservationBinding?: ControlReservationAtomicBinding;
    readonly preparedIntentId?: string;
    readonly correlatedBrokerOrderId?: string;
    readonly reservationClaimSettlementId?: string;
    readonly terminalOutcome?: OrderIntentTerminalOutcome;
    readonly runtimeStopProof?: RuntimeStopProof;
    readonly manualResolutionDecision?: Readonly<VerifiedManualResolutionDecision>;
    readonly blockingStateResolutionDecision?: Readonly<VerifiedBlockingStateResolutionDecision>;
    readonly nextQuantityProjection?: EntityQuantityProjection;
    readonly auditSnapshotHash?: string;
}

export interface StateTransitionJournalRecord<Kind extends EntityKind> {
    readonly registryVersion: typeof SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION;
    readonly implementationVersion: typeof SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION;
    readonly reviewedArtifactSha256: typeof SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256;
    readonly reasonSchemaVersion: typeof SMART_ORDER_REASON_SCHEMA_VERSION;
    readonly transitionRequestId: string;
    readonly requestPayloadHash: string;
    readonly targetSideEffectSha256?: `sha256:${string}`;
    readonly effectProjectionSha256?: `sha256:${string}`;
    readonly edgeId: string;
    readonly entityKind: Kind;
    readonly entityId: string;
    readonly lineageId: string;
    readonly lineageGeneration: number;
    readonly fromState: EntityStateByKind[Kind] | '__create__';
    readonly toState: EntityStateByKind[Kind];
    readonly fromRevision: number;
    readonly toRevision: number;
    readonly reasonCode: ReasonCode;
    readonly evidence: readonly TransitionEvidence[];
    readonly actorKind: ActorKind;
    readonly authorizationEvidence: readonly AuthorizationEvidence[];
    readonly brokerWriteProvenance: BrokerWriteProvenance;
    readonly observedWallTime: string;
    readonly observedWallTimeSource: ObservedWallTimeSource;
    readonly wallTimeTrustStatus: WallTimeTrustStatus;
    readonly monotonicLocalSequence: number;
    readonly committedAt: string;
    readonly runtimeEpochId: string;
    readonly scopeId: string;
    readonly atomicTransactionId: string;
    readonly atomicCompanionProofs: readonly AtomicCompanionProof[];
    readonly resolvedCompanionOwnerKind: CompanionOwnerKind;
}

export interface StateTransitionResult<Kind extends EntityKind> {
    readonly entity: EntityByKind<Kind>;
    readonly journal: StateTransitionJournalRecord<Kind>;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PREFIXED_SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function fail(
    code: SmartOrderStateMachineErrorCode,
    message: string,
): never {
    throw new SmartOrderStateMachineError(code, message);
}

function requireOpaque(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
        fail('invalid_transition_request', `${label} must be non-empty`);
    }
}

function requireSha256(value: string, label: string): void {
    if (!SHA256_PATTERN.test(value)) {
        fail(
            'invalid_transition_request',
            `${label} must be a lowercase SHA-256 hex digest`,
        );
    }
}

function requirePrefixedSha256(
    value: string,
    label: string,
): asserts value is `sha256:${string}` {
    if (!PREFIXED_SHA256_PATTERN.test(value)) {
        fail(
            'invalid_transition_request',
            `${label} must be a canonical sha256: digest`,
        );
    }
}

function sha256Hex(value: `sha256:${string}`): string {
    return value.slice('sha256:'.length);
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(
            'invalid_transition_request',
            `${label} must be a non-negative safe integer`,
        );
    }
}

function requireIsoInstant(value: string, label: string): void {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
        fail('invalid_transition_request', `${label} must be canonical ISO-8601`);
    }
}

function cloneAndFreeze<Value>(value: Value): Value {
    if (Array.isArray(value)) {
        return Object.freeze(value.map((item) => cloneAndFreeze(item))) as Value;
    }
    if (value && typeof value === 'object') {
        const clone: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            clone[key] = cloneAndFreeze(item);
        }
        return Object.freeze(clone) as Value;
    }
    return value;
}

export function actorForIntentOwner(owner: IntentOwner): ActorKind {
    switch (owner.kind) {
        case 'strategy_activation':
            return 'runtime_evaluator';
        case 'manual_confirmation':
            return 'interactive_user';
        case 'gate_probe_run':
            return 'gate_runner';
        case 'lifecycle_resolution':
            return 'resolution_service';
    }
}

export function provenanceForIntentOwner(
    owner: IntentOwner,
): Exclude<BrokerWriteProvenance, 'none'> {
    switch (owner.kind) {
        case 'strategy_activation':
            return 'automation';
        case 'manual_confirmation':
        case 'lifecycle_resolution':
            return 'manual_user_confirmed';
        case 'gate_probe_run':
            return 'gate_probe';
    }
}

function ownerKindForIntent(intent: OrderIntent): CompanionOwnerKind {
    if (intent.operation === 'update') return 'update';
    if (intent.operation === 'cancel') return 'cancel';
    switch (intent.purpose) {
        case 'entry':
            return 'entry';
        case 'exit':
            return 'exit';
        case 'unprotected_place':
            return 'unprotected_place';
        case 'control_update':
        case 'control_cancel':
            fail(
                'intent_owner_mismatch',
                `place intent cannot use purpose ${intent.purpose}`,
            );
    }
}

function ownerKindForActivation(activation: Activation): CompanionOwnerKind {
    switch (activation.intentPurpose) {
        case 'entry':
            return 'entry';
        case 'exit':
            return 'exit';
        case 'unprotected_place':
            return 'unprotected_place';
    }
}

function intrinsicCompanionOwnerKind(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
): CompanionOwnerKind | undefined {
    if (entity.entityKind === 'order_intent' && edge.edgeId === 'INT-001') {
        return ownerKindForIntent(entity);
    }
    if (entity.entityKind === 'activation' && edge.edgeId === 'ACT-005') {
        return ownerKindForActivation(entity);
    }
    return undefined;
}

function resolveCompanionOwnerKind(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    requestedOwnerKind: CompanionOwnerKind | undefined,
): CompanionOwnerKind {
    const intrinsic = intrinsicCompanionOwnerKind(entity, edge);
    if (intrinsic) {
        if (requestedOwnerKind && requestedOwnerKind !== intrinsic) {
            fail(
                'atomic_companion_mismatch',
                `companion owner ${requestedOwnerKind} conflicts with intrinsic ${intrinsic}`,
            );
        }
        return intrinsic;
    }
    if (requestedOwnerKind && requestedOwnerKind !== 'default') {
        fail(
            'atomic_companion_mismatch',
            `edge ${edge.edgeId} does not accept owner variant ${requestedOwnerKind}`,
        );
    }
    return 'default';
}

function resolveAtomicCompanionKinds(
    edge: StateEdgeDefinition,
    reasonCode: ReasonCode,
    ownerKind: CompanionOwnerKind,
): readonly AtomicCompanionKind[] {
    const reasonOrWildcardVariants = edge.atomicCompanionVariants.filter(
        (variant) =>
            variant.reasonCode === undefined || variant.reasonCode === reasonCode,
    );
    const ownerSpecific = reasonOrWildcardVariants.some(
        (variant) => variant.ownerKind !== undefined,
    );
    const candidates = reasonOrWildcardVariants.filter(
        (variant) =>
            variant.ownerKind === undefined || variant.ownerKind === ownerKind,
    );
    if (ownerSpecific && ownerKind === 'default') {
        fail(
            'atomic_companion_mismatch',
            `edge ${edge.edgeId} requires an owner-specific companion variant`,
        );
    }
    if (reasonOrWildcardVariants.length > 0 && candidates.length === 0) {
        fail(
            'atomic_companion_mismatch',
            `edge ${edge.edgeId} has no companion variant for ${reasonCode}/${ownerKind}`,
        );
    }
    if (candidates.length === 0) return edge.atomicCompanions;
    candidates.sort((left, right) => {
        const leftSpecificity =
            Number(left.reasonCode !== undefined) +
            Number(left.ownerKind !== undefined);
        const rightSpecificity =
            Number(right.reasonCode !== undefined) +
            Number(right.ownerKind !== undefined);
        return rightSpecificity - leftSpecificity;
    });
    const selected = candidates[0];
    if (!selected) return edge.atomicCompanions;
    const next = candidates[1];
    if (
        next &&
        Number(selected.reasonCode !== undefined) +
            Number(selected.ownerKind !== undefined) ===
            Number(next.reasonCode !== undefined) +
                Number(next.ownerKind !== undefined)
    ) {
        fail(
            'atomic_companion_mismatch',
            `edge ${edge.edgeId} has ambiguous companion variants`,
        );
    }
    return selected.companions;
}

function transitionContractBinding(
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
    entity?: SmartOrderStateEntity,
): ResolutionStateTransitionBinding {
    return {
        kind: 'state_transition',
        entityKind: edge.entityKind,
        entityId: entity?.entityId ?? '__resolution_contract__',
        lineageId: entity?.lineageId ?? '__resolution_contract__',
        lineageGeneration: entity?.lineageGeneration ?? 0,
        expectedRevision: request.expectedRevision,
        effectProjectionSha256:
            request.effectProjectionSha256 ??
            (`sha256:${'0'.repeat(64)}` as const),
        edgeId: edge.edgeId,
        fromState: edge.from,
        toState: edge.to,
        transitionReasonCode: request.reasonCode,
    };
}

function expectedResolutionOperation(
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): VerifiedManualResolutionDecision['operation'] | undefined {
    return manualResolutionOperationForTransition(
        transitionContractBinding(edge, request),
    );
}

function resolutionDecisionCompanionKinds(
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): readonly AtomicCompanionKind[] {
    const decision = request.manualResolutionDecision;
    if (!decision || !expectedResolutionOperation(edge, request)) return [];
    const companions: AtomicCompanionKind[] = [];
    for (const companion of decision.atomicCompanions) {
        switch (companion) {
            case 'resolution_case_terminal':
                companions.push(
                    decision.destination === 'resolution_case_relinquished_unknown'
                        ? 'ResolutionCase.relinquished_unknown'
                        : 'ResolutionCase.terminal',
                );
                break;
            case 'fresh_confirmation_snapshot':
                companions.push('ConfirmationSnapshot');
                break;
            case 'reservation_claim_obligation_settlement':
                companions.push('ReservationClaimSettlement');
                break;
            case 'terminal_evidence_correction':
                companions.push(
                    'ImmutableResolutionEvidence',
                    'DerivedLedgerReprojection',
                );
                break;
            case 'safety_blocker_open':
            case 'relinquished_unknown_exposure_open':
                if (decision.operation === 'break_glass_relinquish') {
                    companions.push('RelinquishedUnknownExposure.open');
                }
                break;
            case 'burned_authorization_nonce':
                companions.push('BurnedDispatchNonce');
                break;
            case 'break_glass_audit_snapshot':
                companions.push('AuditSnapshot');
                break;
            case 'strategy_cancel_requested':
            case 'copy_to_new_draft_created':
            case 'runtime_observe_only_blocker_open':
                break;
        }
    }
    return Object.freeze([...new Set(companions)]);
}

function validateRequestEnvelope(request: StateTransitionRequest): void {
    requireOpaque(request.transitionRequestId, 'transitionRequestId');
    requireSha256(request.requestPayloadHash, 'requestPayloadHash');
    if (request.targetSideEffectSha256 !== undefined) {
        requirePrefixedSha256(
            request.targetSideEffectSha256,
            'targetSideEffectSha256',
        );
    }
    if (request.effectProjectionSha256 !== undefined) {
        requirePrefixedSha256(
            request.effectProjectionSha256,
            'effectProjectionSha256',
        );
    }
    requireOpaque(request.edgeId, 'edgeId');
    requireNonNegativeSafeInteger(request.expectedRevision, 'expectedRevision');
    requireIsoInstant(request.observedWallTime, 'observedWallTime');
    requireIsoInstant(request.committedAt, 'committedAt');
    requireNonNegativeSafeInteger(
        request.monotonicLocalSequence,
        'monotonicLocalSequence',
    );
    requireOpaque(request.runtimeEpochId, 'runtimeEpochId');
    if (request.apiGeneration !== undefined) {
        requireOpaque(request.apiGeneration, 'apiGeneration');
    }
    requireOpaque(request.scopeId, 'scopeId');
    requireOpaque(request.atomicTransactionId, 'atomicTransactionId');
    const evidenceIds = new Set<string>();
    for (const evidence of request.evidence) {
        requireOpaque(evidence.evidenceId, 'evidenceId');
        requireSha256(evidence.evidenceHash, 'evidenceHash');
        if (evidenceIds.has(evidence.evidenceId)) {
            fail(
                'evidence_missing_or_mismatch',
                `duplicate evidence ID ${evidence.evidenceId}`,
            );
        }
        evidenceIds.add(evidence.evidenceId);
        const quantity = evidence.brokerOrderQuantity;
        if (quantity) {
            if (
                evidence.evidenceClass !==
                    'BrokerDealOrderPositionEvidence' ||
                quantity.schemaVersion !==
                    BROKER_ORDER_QUANTITY_EVIDENCE_SCHEMA_VERSION ||
                !['accepted', 'part_filled', 'filled'].includes(
                    quantity.outcome,
                ) ||
                !['current', 'unique_final'].includes(quantity.finality)
            ) {
                fail(
                    'evidence_missing_or_mismatch',
                    'broker quantity binding has a non-canonical class, schema, outcome, or finality',
                );
            }
            for (const [label, value] of [
                ['brokerOrderId', quantity.brokerOrderId],
                ['fixedAccountOpaqueRef', quantity.fixedAccountOpaqueRef],
                ['tradeDate', quantity.tradeDate],
                ['contractKey', quantity.contractKey],
            ] as const) {
                requireOpaque(value, `broker quantity evidence ${label}`);
            }
            requireSha256(
                quantity.brokerCorrelationHash,
                'broker quantity evidence brokerCorrelationHash',
            );
            for (const [label, value] of [
                ['quantityShares', quantity.quantityShares],
                ['filledShares', quantity.filledShares],
                ['remainingShares', quantity.remainingShares],
            ] as const) {
                requireNonNegativeShares(
                    value,
                    `broker quantity evidence ${label}`,
                );
            }
            if (
                quantity.quantityShares === 0n ||
                quantity.quantityShares !==
                    quantity.filledShares + quantity.remainingShares
            ) {
                fail(
                    'evidence_missing_or_mismatch',
                    'broker quantity evidence must be positive and balanced',
                );
            }
        }
    }
    const authorizationIds = new Set<string>();
    for (const authorization of request.authorizationEvidence) {
        requireOpaque(authorization.authorizationId, 'authorizationId');
        requireSha256(authorization.authorizationHash, 'authorizationHash');
        if (authorizationIds.has(authorization.authorizationId)) {
            fail(
                'authorization_missing',
                `duplicate authorization ID ${authorization.authorizationId}`,
            );
        }
        authorizationIds.add(authorization.authorizationId);
        if (authorization.burnedNonces) {
            const nonces = new Set<string>();
            for (const item of authorization.burnedNonces) {
                requireOpaque(item.nonce, 'authorization burned nonce');
                requireNonNegativeSafeInteger(
                    item.revision,
                    'authorization burned nonce revision',
                );
                if (nonces.has(item.nonce)) {
                    fail(
                        'authorization_missing',
                        'authorization cannot consume the same nonce twice',
                    );
                }
                nonces.add(item.nonce);
            }
        }
    }
}

function validateEdgeMetadata(
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): void {
    if (!edge.allowedActorKinds.includes(request.actorKind)) {
        fail(
            'actor_not_allowed',
            `${request.actorKind} cannot write ${edge.entityKind}:${edge.edgeId}`,
        );
    }
    if (!edge.brokerWriteProvenance.includes(request.brokerWriteProvenance)) {
        fail(
            'provenance_not_allowed',
            `${request.brokerWriteProvenance} cannot write ${edge.entityKind}:${edge.edgeId}`,
        );
    }
    if (!edge.reasonCodes.includes(request.reasonCode)) {
        fail(
            'reason_not_allowed',
            `${request.reasonCode} is not allowed on ${edge.entityKind}:${edge.edgeId}`,
        );
    }
    const requiredEvidenceClasses =
        edge.evidenceClassesByReason[request.reasonCode];
    if (!requiredEvidenceClasses) {
        fail(
            'evidence_missing_or_mismatch',
            `edge ${edge.edgeId} does not bind evidence for ${request.reasonCode}`,
        );
    }
    const suppliedClasses = new Set(
        request.evidence.map((item) => item.evidenceClass),
    );
    for (const requiredClass of requiredEvidenceClasses) {
        if (!suppliedClasses.has(requiredClass)) {
            fail(
                'evidence_missing_or_mismatch',
                `${edge.edgeId}/${request.reasonCode} requires ${requiredClass}`,
            );
        }
    }
    for (const suppliedClass of suppliedClasses) {
        if (!requiredEvidenceClasses.includes(suppliedClass)) {
            fail(
                'evidence_missing_or_mismatch',
                `${suppliedClass} is not allowlisted for ${edge.edgeId}/${request.reasonCode}`,
            );
        }
    }
    const requiredAuthorizations = new Set([
        ...edge.requiredAuthorizationKinds,
        ...(edge.authorizationKindsByReason[request.reasonCode] ?? []),
    ]);
    const suppliedAuthorizations = new Set(
        request.authorizationEvidence.map((item) => item.kind),
    );
    for (const required of requiredAuthorizations) {
        if (!suppliedAuthorizations.has(required)) {
            fail(
                'authorization_missing',
                `${edge.edgeId}/${request.reasonCode} requires ${required}`,
            );
        }
    }
    if (
        edge.requiresTrustedWallTime &&
        request.wallTimeTrustStatus !== 'trusted'
    ) {
        fail(
            'untrusted_wall_time',
            `${edge.edgeId} requires trusted wall time`,
        );
    }
}

function requireResolutionCaseLink(
    request: StateTransitionRequest,
): ResolutionCaseLink {
    const link = request.resolutionCaseLink;
    if (!link) {
        fail(
            'lineage_mismatch',
            `${request.edgeId} requires a typed ResolutionCase link`,
        );
    }
    requireOpaque(link.resolutionCaseId, 'resolutionCaseId');
    requireOpaque(link.safetyBlockerId, 'safetyBlockerId');
    requirePrefixedSha256(link.scopeSha256, 'resolutionCase scopeSha256');
    requirePrefixedSha256(
        link.targetSideEffectSha256,
        'resolutionCase targetSideEffectSha256',
    );
    requirePrefixedSha256(
        link.evidenceSnapshotSha256,
        'resolutionCase evidenceSnapshotSha256',
    );
    requireSha256(link.evidenceHash, 'resolutionCase evidenceHash');
    if (link.evidenceHash !== sha256Hex(link.evidenceSnapshotSha256)) {
        fail(
            'evidence_missing_or_mismatch',
            'ResolutionCase evidence hash and canonical evidence snapshot differ',
        );
    }
    return link;
}

function breakGlassAuthorization(
    request: StateTransitionRequest,
): AuthorizationEvidence | undefined {
    return request.authorizationEvidence.find(
        (item) => item.kind === 'BreakGlassAuthorization',
    );
}

function validateBreakGlassBinding(request: StateTransitionRequest): void {
    const authorization = breakGlassAuthorization(request);
    if (!authorization) {
        fail('authorization_missing', 'break-glass authorization is missing');
    }
    if (!authorization.burnedNonces || authorization.burnedNonces.length !== 2) {
        fail(
            'authorization_missing',
            'break-glass requires exactly two independently consumed nonces',
        );
    }
    for (const item of authorization.burnedNonces) {
        requireOpaque(item.nonce, 'burned nonce');
        requireNonNegativeSafeInteger(item.revision, 'burned nonce revision');
    }
    requireSha256(
        authorization.secondConfirmationHash ?? '',
        'secondConfirmationHash',
    );
    requireSha256(request.auditSnapshotHash ?? '', 'auditSnapshotHash');
    const link = requireResolutionCaseLink(request);
    if (link.state !== 'relinquished_unknown') {
        fail(
            'resolution_matrix_rejected',
            'break-glass requires ResolutionCase.relinquished_unknown',
        );
    }
}

function validateEntryProtectionBinding(
    entity: SmartOrderStateEntity,
    request: StateTransitionRequest,
): EntryProtectionAtomicBinding {
    const binding = request.entryProtectionBinding;
    if (!binding) {
        fail(
            'atomic_companion_mismatch',
            `${request.edgeId} requires an entry protection binding`,
        );
    }
    for (const [label, value] of [
        ['strategyId', binding.strategyId],
        ['fixedAccountOpaqueRef', binding.fixedAccountOpaqueRef],
        ['contractKey', binding.contractKey],
        ['entryIntentId', binding.entryIntentId],
        ['commitmentId', binding.commitmentId],
        ['obligationId', binding.obligationId],
        ['reservationId', binding.reservationId],
    ] as const) {
        requireOpaque(value, label);
    }
    validateIntentOwnerFields(binding.entryIntentOwner);
    if (
        (binding.entryIntentOwner.kind === 'strategy_activation' ||
            binding.entryIntentOwner.kind === 'lifecycle_resolution') &&
        binding.entryIntentOwner.strategyId !== binding.strategyId
    ) {
        fail(
            'lineage_mismatch',
            'entry protection Strategy does not match its intent owner',
        );
    }
    const expectedActor = actorForIntentOwner(binding.entryIntentOwner);
    if (request.actorKind !== expectedActor) {
        fail(
            'intent_owner_mismatch',
            `${request.actorKind} does not own entry preparation for ${binding.entryIntentOwner.kind}`,
        );
    }
    if (
        entity.entityKind === 'order_intent' &&
        (entity.intentId !== binding.entryIntentId ||
            !intentOwnersEqual(entity.owner, binding.entryIntentOwner))
    ) {
        fail('lineage_mismatch', 'entry OrderIntent binding does not match entity');
    }
    if (
        entity.entityKind === 'activation' &&
        (entity.strategyId !== binding.strategyId ||
            (entity.primaryPlaceIntentId !== undefined &&
                entity.primaryPlaceIntentId !== binding.entryIntentId) ||
            !intentOwnersEqual(
                entity.dispatchOwner,
                binding.entryIntentOwner,
            ))
    ) {
        fail('lineage_mismatch', 'entry Activation intent lineage does not match');
    }
    if (
        entity.entityKind === 'pending_protection_commitment' &&
        (entity.strategyId !== binding.strategyId ||
            entity.entryIntentId !== binding.entryIntentId ||
            entity.commitmentId !== binding.commitmentId ||
            entity.obligationId !== binding.obligationId ||
            !intentOwnersEqual(
                entity.entryIntentOwner,
                binding.entryIntentOwner,
            ))
    ) {
        fail('lineage_mismatch', 'PendingProtectionCommitment binding mismatch');
    }
    if (
        entity.entityKind === 'protection_obligation' &&
        (entity.strategyId !== binding.strategyId ||
            entity.fixedAccountOpaqueRef !== binding.fixedAccountOpaqueRef ||
            entity.contractKey !== binding.contractKey ||
            entity.entryIntentId !== binding.entryIntentId ||
            entity.commitmentId !== binding.commitmentId ||
            entity.obligationId !== binding.obligationId ||
            !intentOwnersEqual(
                entity.entryIntentOwner,
                binding.entryIntentOwner,
            ))
    ) {
        fail('lineage_mismatch', 'ProtectionObligation binding mismatch');
    }
    if (
        entity.entityKind === 'entry_exposure_reservation' &&
        (entity.fixedAccountOpaqueRef !== binding.fixedAccountOpaqueRef ||
            entity.contractKey !== binding.contractKey ||
            entity.ownerIntentId !== binding.entryIntentId ||
            entity.reservationId !== binding.reservationId ||
            !intentOwnersEqual(
                entity.entryIntentOwner,
                binding.entryIntentOwner,
            ))
    ) {
        fail('lineage_mismatch', 'EntryExposureReservation binding mismatch');
    }
    return binding;
}

function validateExitProtectionBinding(
    entity: SmartOrderStateEntity,
    request: StateTransitionRequest,
): ExitProtectionAtomicBinding {
    const binding = request.exitProtectionBinding;
    if (!binding) {
        fail(
            'atomic_companion_mismatch',
            `${request.edgeId} requires an exit protection binding`,
        );
    }
    for (const [label, value] of [
        ['strategyId', binding.strategyId],
        ['fixedAccountOpaqueRef', binding.fixedAccountOpaqueRef],
        ['contractKey', binding.contractKey],
        ['positionLineageId', binding.positionLineageId],
        ['protectionGroupId', binding.protectionGroupId],
        ['activationId', binding.activationId],
        ['winnerLegId', binding.winnerLegId],
        ['suppressedSetId', binding.suppressedSetId],
        ['exitClaimId', binding.exitClaimId],
        ['exitIntentId', binding.exitIntentId],
        ['obligationId', binding.obligationId],
    ] as const) {
        requireOpaque(value, label);
    }
    validateIntentOwnerFields(binding.exitIntentOwner);
    if (
        (binding.exitIntentOwner.kind === 'strategy_activation' ||
            binding.exitIntentOwner.kind === 'lifecycle_resolution') &&
        binding.exitIntentOwner.strategyId !== binding.strategyId
    ) {
        fail(
            'lineage_mismatch',
            'exit protection Strategy does not match its intent owner',
        );
    }
    if (request.actorKind !== actorForIntentOwner(binding.exitIntentOwner)) {
        fail(
            'intent_owner_mismatch',
            `${request.actorKind} does not own exit preparation for ${binding.exitIntentOwner.kind}`,
        );
    }
    requireNonNegativeSafeInteger(
        binding.remainderGeneration,
        'remainderGeneration',
    );
    if (binding.suppressedLegIds.length === 0) {
        fail(
            'atomic_companion_mismatch',
            'OCO selection must durably record suppressed leg evaluations',
        );
    }
    const legIds = new Set([binding.winnerLegId]);
    for (const legId of binding.suppressedLegIds) {
        requireOpaque(legId, 'suppressedLegId');
        if (legIds.has(legId)) {
            fail(
                'atomic_companion_mismatch',
                'winner and suppressed leg IDs must be unique',
            );
        }
        legIds.add(legId);
    }
    if (
        entity.entityKind === 'activation' &&
        (entity.strategyId !== binding.strategyId ||
            entity.activationId !== binding.activationId ||
            (entity.primaryPlaceIntentId !== undefined &&
                entity.primaryPlaceIntentId !== binding.exitIntentId) ||
            !intentOwnersEqual(
                entity.dispatchOwner,
                binding.exitIntentOwner,
            ))
    ) {
        fail('lineage_mismatch', 'exit Activation binding mismatch');
    }
    if (
        entity.entityKind === 'order_intent' &&
        (entity.intentId !== binding.exitIntentId ||
            !intentOwnersEqual(entity.owner, binding.exitIntentOwner))
    ) {
        fail('lineage_mismatch', 'exit OrderIntent binding mismatch');
    }
    if (
        entity.entityKind === 'exit_claim' &&
        (entity.strategyId !== binding.strategyId ||
            entity.fixedAccountOpaqueRef !== binding.fixedAccountOpaqueRef ||
            entity.contractKey !== binding.contractKey ||
            entity.positionLineageId !== binding.positionLineageId ||
            entity.exitClaimId !== binding.exitClaimId ||
            entity.obligationId !== binding.obligationId ||
            entity.remainderGeneration !== binding.remainderGeneration ||
            (binding.exitIntentOwner.kind === 'strategy_activation' &&
                entity.strategyId !== binding.exitIntentOwner.strategyId))
    ) {
        fail('lineage_mismatch', 'ExitClaim OCO binding mismatch');
    }
    if (
        entity.entityKind === 'protection_obligation' &&
        (entity.strategyId !== binding.strategyId ||
            entity.fixedAccountOpaqueRef !== binding.fixedAccountOpaqueRef ||
            entity.contractKey !== binding.contractKey ||
            entity.obligationId !== binding.obligationId ||
            (binding.exitIntentOwner.kind === 'strategy_activation' &&
                (entity.strategyId !== binding.exitIntentOwner.strategyId ||
                    binding.activationId !==
                        binding.exitIntentOwner.activationId)))
    ) {
        fail('lineage_mismatch', 'ProtectionObligation OCO binding mismatch');
    }
    return binding;
}

function validateDispatchBinding(
    entity: SmartOrderStateEntity,
    request: StateTransitionRequest,
): DispatchAtomicBinding {
    const binding = request.dispatchBinding;
    if (!binding) {
        fail(
            'atomic_companion_mismatch',
            `${request.edgeId} requires a dispatch binding`,
        );
    }
    for (const [label, value] of [
        ['activationId', binding.activationId],
        ['intentId', binding.intentId],
        ['durableDispatchBlockerId', binding.durableDispatchBlockerId],
        ['dispatchAttemptNonce', binding.dispatchAttemptNonce],
        ['senderFence', binding.senderFence],
        ['dispatch runtimeEpochId', binding.runtimeEpochId],
    ] as const) {
        requireOpaque(value, label);
    }
    if (
        request.runtimeEpochId !== binding.runtimeEpochId ||
        request.brokerWriteProvenance !== binding.intendedProvenance
    ) {
        fail('lineage_mismatch', 'dispatch epoch/provenance binding mismatch');
    }
    if (
        entity.entityKind === 'activation' &&
        (entity.activationId !== binding.activationId ||
            entity.primaryPlaceIntentId !== binding.intentId ||
            entity.runtimeEpochId !== binding.runtimeEpochId ||
            entity.intendedProvenance !== binding.intendedProvenance)
    ) {
        fail('lineage_mismatch', 'Activation dispatch binding mismatch');
    }
    if (
        entity.entityKind === 'order_intent' &&
        (entity.intentId !== binding.intentId ||
            entity.operation !== binding.intentOperation ||
            entity.intendedProvenance !== binding.intendedProvenance)
    ) {
        fail('lineage_mismatch', 'OrderIntent dispatch binding mismatch');
    }
    if (
        entity.entityKind === 'durable_dispatch_blocker' &&
        (entity.entityId !== binding.durableDispatchBlockerId ||
            entity.intentId !== binding.intentId ||
            entity.intentOperation !== binding.intentOperation ||
            entity.dispatchAttemptNonce !== binding.dispatchAttemptNonce ||
            entity.runtimeEpochId !== binding.runtimeEpochId ||
            entity.senderFence !== binding.senderFence ||
            entity.intentProvenance !== binding.intendedProvenance)
    ) {
        fail('lineage_mismatch', 'DurableDispatchBlocker binding mismatch');
    }
    return binding;
}

function validateControlReservationBinding(
    entity: SmartOrderStateEntity,
    request: StateTransitionRequest,
): ControlReservationAtomicBinding {
    const binding = request.controlReservationBinding;
    if (!binding) {
        fail(
            'control_revision_conflict',
            `${request.edgeId} requires a control reservation binding`,
        );
    }
    requireOpaque(binding.targetBrokerOrderId, 'targetBrokerOrderId');
    requireOpaque(binding.controlIntentId, 'controlIntentId');
    requireOpaque(binding.targetReservationId, 'targetReservationId');
    requireNonNegativeSafeInteger(
        binding.expectedControlRevision,
        'expectedControlRevision',
    );
    requireNonNegativeSafeInteger(
        binding.nextControlRevision,
        'nextControlRevision',
    );
    if (binding.nextControlRevision !== binding.expectedControlRevision + 1) {
        fail(
            'control_revision_conflict',
            'controlRevision must increase by exactly one',
        );
    }
    const expectedReason =
        binding.operation === 'update'
            ? 'BROKER_UPDATE_TARGET_RESERVED'
            : 'BROKER_CANCEL_TARGET_RESERVED';
    if (
        request.reasonCode !== 'INTENT_PREPARED_DURABLE' &&
        request.reasonCode !== expectedReason
    ) {
        fail(
            'control_revision_conflict',
            'control operation and reservation reason do not match',
        );
    }
    if (
        entity.entityKind === 'broker_order' &&
        (entity.brokerOrderId !== binding.targetBrokerOrderId ||
            entity.controlRevision !== binding.expectedControlRevision)
    ) {
        fail('control_revision_conflict', 'BrokerOrder controlRevision is stale');
    }
    if (entity.entityKind === 'order_intent') {
        if (
            entity.intentId !== binding.controlIntentId ||
            entity.operation !== binding.operation ||
            !entity.target ||
            entity.target.targetBrokerOrderId !== binding.targetBrokerOrderId ||
            entity.target.targetRevision !== binding.nextControlRevision
        ) {
            fail('control_revision_conflict', 'control OrderIntent target mismatch');
        }
    }
    return binding;
}

const BROKER_ORDER_PART_FILL_EDGES = new Set([
    'BRO-004A',
    'BRO-004B',
    'BRO-004C',
    'BRO-004D',
    'BRO-004E',
]);

const BROKER_ORDER_FULL_FILL_EDGES = new Set([
    'BRO-005A',
    'BRO-005B',
    'BRO-005C',
    'BRO-005D',
    'BRO-005E',
]);

function validateBrokerOrderQuantityTransition(
    entity: BrokerOrder,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): void {
    const isPartFill = BROKER_ORDER_PART_FILL_EDGES.has(edge.edgeId);
    const isFullFill = BROKER_ORDER_FULL_FILL_EDGES.has(edge.edgeId);
    if (!isPartFill && !isFullFill) return;

    const projection = request.nextQuantityProjection;
    if (!projection || projection.entityKind !== 'broker_order') {
        fail(
            'entity_invariant_violation',
            `${edge.edgeId} requires a canonical BrokerOrder quantity projection`,
        );
    }
    const brokerEvidence = request.evidence.filter(
        (item) => item.evidenceClass === 'BrokerDealOrderPositionEvidence',
    );
    if (
        brokerEvidence.length !== 1 ||
        brokerEvidence[0]?.brokerOrderQuantity === undefined
    ) {
        fail(
            'evidence_missing_or_mismatch',
            `${edge.edgeId} requires exactly one canonical broker quantity evidence record`,
        );
    }
    const evidence = brokerEvidence[0]!;
    const binding = evidence.brokerOrderQuantity!;
    for (const [label, value] of [
        ['quantityShares', binding.quantityShares],
        ['filledShares', binding.filledShares],
        ['remainingShares', binding.remainingShares],
    ] as const) {
        requireNonNegativeShares(value, `broker quantity evidence ${label}`);
    }
    if (
        binding.schemaVersion !== BROKER_ORDER_QUANTITY_EVIDENCE_SCHEMA_VERSION ||
        binding.brokerOrderId !== entity.brokerOrderId ||
        binding.fixedAccountOpaqueRef !== entity.fixedAccountOpaqueRef ||
        binding.tradeDate !== entity.tradeDate ||
        binding.contractKey !== entity.contractKey ||
        binding.side !== entity.side ||
        binding.brokerCorrelationHash !== entity.brokerCorrelationHash ||
        binding.quantityShares !== entity.quantityShares ||
        binding.quantityShares !== projection.quantityShares ||
        binding.filledShares !== projection.filledShares ||
        binding.remainingShares !== projection.remainingShares
    ) {
        fail(
            'evidence_missing_or_mismatch',
            `${edge.edgeId} broker quantity evidence does not match the durable order or projection`,
        );
    }
    if (
        projection.quantityShares <= 0n ||
        projection.quantityShares !==
            projection.filledShares + projection.remainingShares ||
        projection.filledShares < entity.filledShares
    ) {
        fail(
            'entity_invariant_violation',
            `${edge.edgeId} quantity projection is non-positive, unbalanced, or non-monotonic`,
        );
    }
    if (isFullFill) {
        if (
            binding.outcome !== 'filled' ||
            binding.finality !== 'unique_final' ||
            projection.filledShares !== projection.quantityShares ||
            projection.remainingShares !== 0n
        ) {
            fail(
                'evidence_missing_or_mismatch',
                `${edge.edgeId} requires unique-final full-fill evidence with zero remaining shares`,
            );
        }
        return;
    }
    if (
        binding.outcome !== 'part_filled' ||
        binding.finality !== 'current' ||
        (edge.edgeId !== 'BRO-004E' &&
            projection.filledShares <= entity.filledShares) ||
        projection.filledShares === 0n ||
        projection.filledShares >= projection.quantityShares ||
        projection.remainingShares <= 0n
    ) {
        fail(
            'evidence_missing_or_mismatch',
            `${edge.edgeId} requires a monotonic canonical current part-fill projection`,
        );
    }
}

function expectedCompanionRecordId(
    companionKind: AtomicCompanionKind,
    entity: SmartOrderStateEntity,
    request: StateTransitionRequest,
): string | undefined {
    const entry = request.entryProtectionBinding;
    const exit = request.exitProtectionBinding;
    const dispatch = request.dispatchBinding;
    const control = request.controlReservationBinding;
    const resolution = request.resolutionCaseLink;
    switch (companionKind) {
        case 'ImmutableStrategyDefinition':
            return request.strategyDefinitionSeal?.immutableDefinitionRecordId;
        case 'ConfirmationSnapshot': {
            const sealed =
                request.strategyDefinitionSeal?.confirmationSnapshotHash;
            if (sealed) return sealed;
            const fresh =
                request.manualResolutionDecision?.freshConfirmationSha256;
            return fresh ? sha256Hex(fresh) : undefined;
        }
        case 'UserAuthorizationEvidence':
            return request.authorizationEvidence.find((authorization) =>
                ['UserArmAuthorization', 'UserRearmAuthorization'].includes(
                    authorization.kind,
                ),
            )?.authorizationId;
        case 'ResolutionCase.open':
        case 'ResolutionCase.terminal':
        case 'ResolutionCase.relinquished_unknown':
            return resolution?.resolutionCaseId;
        case 'SafetyBlocker.open':
        case 'SafetyBlocker.resolved':
        case 'RelinquishedUnknownExposure.open':
            return resolution?.safetyBlockerId;
        case 'OrderIntent.prepared':
            if (entry) return entry.entryIntentId;
            if (control) return control.controlIntentId;
            if (
                entity.entityKind === 'activation' &&
                entity.intentPurpose === 'unprotected_place'
            ) {
                return entity.primaryPlaceIntentId ?? request.preparedIntentId;
            }
            if (entity.entityKind === 'order_intent') return entity.intentId;
            return undefined;
        case 'PendingProtectionCommitment.prepared':
            return entry?.commitmentId;
        case 'ProtectionObligation.pending_entry':
            return entry?.obligationId;
        case 'EntryExposureReservation.reserved_or_policy_not_required':
            return entry?.reservationId;
        case 'Activation.single_protection_generation':
            return exit?.activationId;
        case 'ProtectionLegEvaluation.winner':
            return exit?.winnerLegId;
        case 'ProtectionLegEvaluation.suppressed':
            return exit?.suppressedSetId;
        case 'ExitClaim.intent_reserved':
            return exit?.exitClaimId;
        case 'ExitOrderIntent.prepared':
            return exit?.exitIntentId;
        case 'Activation.dispatching':
            return dispatch?.activationId;
        case 'OrderIntent.dispatching':
            return dispatch?.intentId;
        case 'DurableDispatchBlocker.open':
            return dispatch?.durableDispatchBlockerId;
        case 'OrderIntent.reconciling':
        case 'OrderIntent.unknown':
            if (entity.entityKind === 'order_intent') return entity.intentId;
            if (entity.entityKind === 'durable_dispatch_blocker') {
                return entity.intentId;
            }
            return undefined;
        case 'DurableDispatchBlocker.cleared_acknowledged':
        case 'DurableDispatchBlocker.cleared_reconciling_durable':
        case 'DurableDispatchBlocker.cleared_unknown_durable':
        case 'DurableDispatchBlocker.cleared_terminal':
            if (entity.entityKind === 'durable_dispatch_blocker') {
                return entity.entityId;
            }
            if (entity.entityKind === 'order_intent') {
                return entity.durableDispatchBlockerId;
            }
            return undefined;
        case 'BrokerOrder.current_projection':
            return request.correlatedBrokerOrderId;
        case 'OperationSpecificTerminalOutcome':
            return request.terminalOutcome;
        case 'ReservationClaimSettlement':
            return request.reservationClaimSettlementId;
        case 'BrokerOrder.controlRevision_incremented':
            return control?.targetBrokerOrderId;
        case 'TargetReservation':
            return control?.targetReservationId;
        case 'BurnedDispatchNonce':
            return breakGlassAuthorization(request)?.authorizationId ??
                request.authorizationEvidence.find((item) =>
                    ['UserRearmAuthorization', 'BreakGlassAuthorization'].includes(
                        item.kind,
                    ),
                )?.authorizationId;
        case 'BreakGlassAuthorization':
            return breakGlassAuthorization(request)?.authorizationId;
        case 'RuntimeEpoch.failed_stop':
            return entity.entityKind === 'runtime_epoch'
                ? entity.runtimeEpochId
                : undefined;
        default:
            return undefined;
    }
}

function validateAtomicCompanionProofs(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
    ownerKind: CompanionOwnerKind,
): void {
    const expectedKinds = Object.freeze([
        ...new Set([
            ...resolveAtomicCompanionKinds(edge, request.reasonCode, ownerKind),
            ...resolutionDecisionCompanionKinds(edge, request),
        ]),
    ]);
    if (expectedKinds.includes('PendingProtectionCommitment.prepared')) {
        validateEntryProtectionBinding(entity, request);
    }
    if (expectedKinds.includes('Activation.single_protection_generation')) {
        validateExitProtectionBinding(entity, request);
    }
    if (expectedKinds.includes('Activation.dispatching')) {
        validateDispatchBinding(entity, request);
    }
    if (expectedKinds.includes('BrokerOrder.controlRevision_incremented')) {
        validateControlReservationBinding(entity, request);
    }
    if (expectedKinds.includes('BrokerOrder.current_projection')) {
        requireOpaque(
            request.correlatedBrokerOrderId ?? '',
            'correlatedBrokerOrderId',
        );
        if (
            entity.entityKind === 'order_intent' &&
            entity.operation !== 'place' &&
            request.correlatedBrokerOrderId !==
                entity.target?.targetBrokerOrderId
        ) {
            fail(
                'lineage_mismatch',
                'control intent BrokerOrder projection does not match its immutable target',
            );
        }
        if (
            entity.entityKind === 'order_intent' &&
            entity.operation === 'place' &&
            entity.createdBrokerOrderId !== undefined &&
            request.correlatedBrokerOrderId !== entity.createdBrokerOrderId
        ) {
            fail(
                'lineage_mismatch',
                'place intent cannot change its created BrokerOrder correlation',
            );
        }
    }
    if (expectedKinds.includes('ReservationClaimSettlement')) {
        requireOpaque(
            request.reservationClaimSettlementId ?? '',
            'reservationClaimSettlementId',
        );
    }
    if (
        expectedKinds.includes('OrderIntent.prepared') &&
        ownerKind === 'unprotected_place'
    ) {
        requireOpaque(request.preparedIntentId ?? '', 'preparedIntentId');
    }
    if (
        expectedKinds.some((kind) =>
            [
                'ResolutionCase.open',
                'ResolutionCase.terminal',
                'ResolutionCase.relinquished_unknown',
                'SafetyBlocker.open',
                'SafetyBlocker.resolved',
            ].includes(kind),
        )
    ) {
        requireResolutionCaseLink(request);
    }
    if (
        expectedKinds.includes('RelinquishedUnknownExposure.open') ||
        expectedKinds.includes('RuntimeEpoch.failed_stop')
    ) {
        validateBreakGlassBinding(request);
    }
    if (request.atomicCompanionProofs.length !== expectedKinds.length) {
        fail(
            'atomic_companion_mismatch',
            `${edge.edgeId} requires exactly ${expectedKinds.length} atomic companions`,
        );
    }
    const expected = new Set(expectedKinds);
    const seen = new Set<AtomicCompanionKind>();
    for (const proof of request.atomicCompanionProofs) {
        if (!expected.has(proof.companionKind) || seen.has(proof.companionKind)) {
            fail(
                'atomic_companion_mismatch',
                `${proof.companionKind} is missing, extra, or duplicated on ${edge.edgeId}`,
            );
        }
        seen.add(proof.companionKind);
        requireOpaque(proof.recordId, 'atomic companion recordId');
        requireSha256(proof.recordHash, 'atomic companion recordHash');
        const successorCompanionBinding =
            proof.companionKind === 'SafetyBlocker.open' &&
            edge.edgeId === 'SB-003'
                ? request.blockingStateResolutionDecision
                      ?.safetyBlockerResolutionBinding?.successor
                : undefined;
        if (
            proof.companionKind === 'SafetyBlocker.open' &&
            edge.edgeId === 'SB-003' &&
            !successorCompanionBinding
        ) {
            fail(
                'atomic_companion_mismatch',
                'SB-003 successor companion lacks an opaque canonical binding',
            );
        }
        if (
            proof.lineageId !==
                (successorCompanionBinding?.lineageId ?? entity.lineageId) ||
            proof.lineageGeneration !==
                (successorCompanionBinding?.lineageGeneration ??
                    entity.lineageGeneration) ||
            proof.scopeId !==
                (successorCompanionBinding?.scope.scopeId ??
                    request.scopeId) ||
            proof.transactionId !== request.atomicTransactionId ||
            proof.reasonCode !== request.reasonCode ||
            proof.ownerKind !== ownerKind
        ) {
            fail(
                'atomic_companion_mismatch',
                `${proof.companionKind} is not bound to the expected lineage/scope/transaction/reason/owner`,
            );
        }
        const expectedRecordId = expectedCompanionRecordId(
            proof.companionKind,
            entity,
            request,
        );
        if (expectedRecordId && proof.recordId !== expectedRecordId) {
            fail(
                'atomic_companion_mismatch',
                `${proof.companionKind} record ID does not match typed binding`,
            );
        }
        if (
            proof.companionKind === 'AuditSnapshot' &&
            proof.recordHash !== request.auditSnapshotHash
        ) {
            fail(
                'atomic_companion_mismatch',
                'AuditSnapshot hash does not match break-glass request',
            );
        }
        if (
            proof.companionKind === 'ImmutableStrategyDefinition' &&
            proof.recordHash !==
                request.strategyDefinitionSeal?.strategyDefinitionHash
        ) {
            fail(
                'immutable_definition_violation',
                'ImmutableStrategyDefinition proof hash mismatch',
            );
        }
        if (proof.companionKind === 'ConfirmationSnapshot') {
            const expectedConfirmationHash =
                edge.edgeId === 'STR-001'
                    ? request.strategyDefinitionSeal?.confirmationSnapshotHash
                    : edge.edgeId === 'STR-010'
                      ? request.manualResolutionDecision
                            ?.freshConfirmationSha256
                          ? sha256Hex(
                                request.manualResolutionDecision
                                    .freshConfirmationSha256,
                            )
                          : undefined
                      : undefined;
            if (
                !expectedConfirmationHash ||
                proof.recordHash !== expectedConfirmationHash
            ) {
                fail(
                    'immutable_definition_violation',
                    'ConfirmationSnapshot proof hash mismatch',
                );
            }
        }
        if (proof.companionKind === 'UserAuthorizationEvidence') {
            const authorization = request.authorizationEvidence.find((item) =>
                ['UserArmAuthorization', 'UserRearmAuthorization'].includes(
                    item.kind,
                ),
            );
            const confirmationEvidence = request.evidence.find(
                (item) => item.evidenceClass === 'UserAuthorizationEvidence',
            );
            const boundId =
                authorization?.authorizationId ?? confirmationEvidence?.evidenceId;
            const boundHash =
                authorization?.authorizationHash ?? confirmationEvidence?.evidenceHash;
            if (proof.recordId !== boundId || proof.recordHash !== boundHash) {
                fail(
                    'authorization_missing',
                    'UserAuthorizationEvidence companion is not bound to transition authorization',
                );
            }
        }
        if (proof.companionKind === 'BreakGlassAuthorization') {
            const authorization = breakGlassAuthorization(request);
            if (
                proof.recordId !== authorization?.authorizationId ||
                proof.recordHash !== authorization.authorizationHash
            ) {
                fail(
                    'authorization_missing',
                    'BreakGlassAuthorization companion hash mismatch',
                );
            }
        }
        if (proof.companionKind === 'BurnedDispatchNonce') {
            const authorization = request.authorizationEvidence.find((item) =>
                ['UserRearmAuthorization', 'BreakGlassAuthorization'].includes(
                    item.kind,
                ),
            );
            if (
                !authorization ||
                proof.recordId !== authorization.authorizationId ||
                proof.recordHash !== authorization.authorizationHash
            ) {
                fail(
                    'authorization_missing',
                    'burned authorization nonce set is not bound to the verified authorization',
                );
            }
        }
        if (
            [
                'ResolutionCase.open',
                'ResolutionCase.terminal',
                'ResolutionCase.relinquished_unknown',
                'SafetyBlocker.open',
                'SafetyBlocker.resolved',
            ].includes(proof.companionKind) &&
            proof.recordHash !==
                (proof.companionKind === 'SafetyBlocker.open' &&
                edge.edgeId === 'SB-003'
                    ? successorCompanionBinding?.bindingSha256
                        ? sha256Hex(successorCompanionBinding.bindingSha256)
                        : undefined
                    : request.resolutionCaseLink?.evidenceHash)
        ) {
            fail(
                'atomic_companion_mismatch',
                `${proof.companionKind} is not bound to resolution evidence hash`,
            );
        }
    }
}

const RESOLUTION_LINKED_BLOCKING_STATES: Readonly<
    Partial<Record<EntityKind, readonly string[]>>
> = Object.freeze({
    strategy: ['manual_intervention'],
    activation: ['unknown'],
    order_intent: ['reconciling', 'unknown'],
    broker_order: ['unknown'],
    pending_protection_commitment: ['unknown'],
    protection_obligation: ['reconciling', 'safety_blocked'],
    entry_exposure_reservation: ['unknown'],
    exit_claim: ['unknown'],
    external_sell_claim: ['unknown'],
});

function isResolutionLinkedBlockingState(
    entityKind: EntityKind,
    state: string,
): boolean {
    return Boolean(
        RESOLUTION_LINKED_BLOCKING_STATES[entityKind]?.includes(state),
    );
}

function isResolutionCaseTerminal(state: ResolutionCaseState): boolean {
    return [
        'resolved_by_final_evidence',
        'resolved_by_reconfirmation',
        'relinquished_unknown',
    ].includes(state);
}

function validateResolutionCaseTransitionLink(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): ResolutionCaseLink | undefined {
    if (edge.edgeId === 'RTE-016') {
        const link = requireResolutionCaseLink(request);
        if (link.state !== 'relinquished_unknown') {
            fail(
                'resolution_matrix_rejected',
                'RTE-016 requires ResolutionCase.relinquished_unknown',
            );
        }
        return link;
    }
    if (
        entity.entityKind === 'resolution_case' ||
        entity.entityKind === 'safety_blocker'
    ) {
        return request.resolutionCaseLink;
    }
    const fromBlocking =
        edge.from !== '__create__' &&
        isResolutionLinkedBlockingState(edge.entityKind, edge.from);
    const toBlocking = isResolutionLinkedBlockingState(
        edge.entityKind,
        edge.to,
    );
    if (!fromBlocking && !toBlocking) {
        if (request.resolutionCaseLink) {
            fail(
                'lineage_mismatch',
                `${edge.edgeId} does not accept an unrelated ResolutionCase link`,
            );
        }
        return undefined;
    }
    const link = requireResolutionCaseLink(request);
    if (entity.resolutionCaseId && entity.resolutionCaseId !== link.resolutionCaseId) {
        fail(
            'lineage_mismatch',
            'transition cannot switch to another ResolutionCase lineage',
        );
    }
    if (!entity.resolutionCaseId && link.openingReasonCode !== request.reasonCode) {
        fail(
            'reason_not_allowed',
            'new ResolutionCase opening reason must equal the blocking transition reason',
        );
    }
    if (
        entity.entityKind === 'strategy' &&
        entity.state === 'manual_intervention' &&
        entity.manualResolutionReasonCode !== link.openingReasonCode
    ) {
        fail(
            'lineage_mismatch',
            'manual Strategy cannot change its ResolutionCase opening reason',
        );
    }
    if (edge.edgeId === 'STR-012D') {
        // Validity expiry retains the existing case exactly as-is. It is not a
        // resolution exit and therefore neither opens nor terminalizes the case.
        return link;
    }
    if (toBlocking) {
        if (isResolutionCaseTerminal(link.state)) {
            fail(
                'resolution_matrix_rejected',
                'blocking entity cannot reference a terminal ResolutionCase',
            );
        }
        if (
            request.reasonCode === 'MANUAL_RECONCILIATION_STARTED' &&
            link.state !== 'evidence_collecting'
        ) {
            fail(
                'resolution_matrix_rejected',
                'manual reconciliation must reference evidence_collecting',
            );
        }
    } else {
        const blockingOperation = expectedBlockingStateResolutionOperation(
            entity,
            edge,
            request,
        );
        const keepBlocked =
            blockingOperation === 'apply_canonical_projection_keep_blocked';
        if (keepBlocked && isResolutionCaseTerminal(link.state)) {
            fail(
                'resolution_matrix_rejected',
                'canonical current projection must keep its ResolutionCase and SafetyBlocker open',
            );
        }
        if (!keepBlocked && !isResolutionCaseTerminal(link.state)) {
            fail(
                'resolution_matrix_rejected',
                'a blocking entity can exit only with a terminal ResolutionCase',
            );
        }
        if (
            request.reasonCode === 'MANUAL_BREAK_GLASS_RELINQUISHED' &&
            link.state !== 'relinquished_unknown'
        ) {
            fail(
                'resolution_matrix_rejected',
                'break-glass exit requires relinquished_unknown',
            );
        }
        if (
            request.reasonCode !== 'MANUAL_BREAK_GLASS_RELINQUISHED' &&
            link.state === 'relinquished_unknown'
        ) {
            fail(
                'resolution_matrix_rejected',
                'normal evidence resolution cannot masquerade as relinquishment',
            );
        }
    }
    return link;
}

const TERMINAL_OUTCOMES_BY_OPERATION = Object.freeze({
    place: [
        'place_filled',
        'place_cancelled',
        'place_inactive',
        'place_rejected',
        'place_zero_fill',
        'place_cancelled_proven_unsent',
        'place_relinquished_unknown',
    ],
    update: [
        'update_applied',
        'update_rejected',
        'target_already_terminal',
        'update_cancelled_proven_unsent',
        'update_stale_target_prebyte',
        'update_relinquished_unknown',
    ],
    cancel: [
        'cancel_applied',
        'cancel_rejected',
        'target_already_terminal',
        'cancel_cancelled_proven_unsent',
        'cancel_stale_target_prebyte',
        'cancel_relinquished_unknown',
    ],
} satisfies Record<IntentOperation, readonly OrderIntentTerminalOutcome[]>);

function validateOrderIntentTerminalOutcome(
    intent: OrderIntent,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): void {
    if (edge.to !== 'terminal') {
        if (request.terminalOutcome !== undefined) {
            fail(
                'intent_outcome_invalid',
                'terminal outcome is forbidden on a non-terminal edge',
            );
        }
        return;
    }
    const outcome = request.terminalOutcome;
    if (
        !outcome ||
        !(TERMINAL_OUTCOMES_BY_OPERATION[
            intent.operation
        ] as readonly OrderIntentTerminalOutcome[]).includes(outcome)
    ) {
        fail(
            'intent_outcome_invalid',
            `${String(outcome)} is invalid for ${intent.operation}`,
        );
    }
    const cancelledProvenUnsent = `${intent.operation}_cancelled_proven_unsent`;
    const staleTarget = `${intent.operation}_stale_target_prebyte`;
    const relinquished = `${intent.operation}_relinquished_unknown`;
    if (edge.edgeId === 'INT-003A' && outcome !== cancelledProvenUnsent) {
        fail(
            'intent_outcome_invalid',
            'proven-unsent edge requires operation-specific cancelled outcome',
        );
    }
    if (
        edge.edgeId === 'INT-003B' &&
        (intent.operation === 'place' || outcome !== staleTarget)
    ) {
        fail(
            'intent_outcome_invalid',
            'stale-target pre-byte edge is update/cancel only',
        );
    }
    const isBreakGlass =
        request.reasonCode === 'MANUAL_BREAK_GLASS_RELINQUISHED';
    if (
        ['INT-011', 'INT-014'].includes(edge.edgeId) &&
        isBreakGlass &&
        outcome !== relinquished
    ) {
        fail(
            'intent_outcome_invalid',
            'break-glass requires operation-specific relinquished_unknown outcome',
        );
    }
    if (!isBreakGlass && outcome === relinquished) {
        fail(
            'intent_outcome_invalid',
            'relinquished_unknown requires break-glass reason and authorization',
        );
    }
    if (
        !['INT-003A', 'INT-003B'].includes(edge.edgeId) &&
        (outcome === cancelledProvenUnsent || outcome === staleTarget)
    ) {
        fail(
            'intent_outcome_invalid',
            'local/no-effect outcome is not broker final evidence',
        );
    }
}

function validateIntentShape(intent: OrderIntent): void {
    if (intent.intendedProvenance !== provenanceForIntentOwner(intent.owner)) {
        fail(
            'intent_owner_mismatch',
            'OrderIntent owner and intended provenance do not match',
        );
    }
    if (intent.operation === 'place') {
        if (
            intent.target ||
            !['entry', 'exit', 'unprotected_place'].includes(intent.purpose)
        ) {
            fail(
                'intent_owner_mismatch',
                'place intent cannot carry a control target/purpose',
            );
        }
    } else {
        const expectedPurpose =
            intent.operation === 'update' ? 'control_update' : 'control_cancel';
        if (!intent.target || intent.purpose !== expectedPurpose) {
            fail(
                'intent_owner_mismatch',
                `${intent.operation} intent requires typed target and ${expectedPurpose}`,
            );
        }
        requireOpaque(intent.target.targetBrokerOrderId, 'targetBrokerOrderId');
        requireOpaque(intent.target.fixedAccountOpaqueRef, 'target account');
        requireOpaque(intent.target.tradeDate, 'target tradeDate');
        requireOpaque(intent.target.contractKey, 'target contractKey');
        requireSha256(
            intent.target.brokerIdentifiersHash,
            'brokerIdentifiersHash',
        );
        requireNonNegativeSafeInteger(
            intent.target.targetRevision,
            'targetRevision',
        );
        if (intent.target.expectedRemainingShares < 0n) {
            fail(
                'entity_invariant_violation',
                'expectedRemainingShares cannot be negative',
            );
        }
    }
    if (
        intent.createdBrokerOrderId !== undefined &&
        intent.operation !== 'place'
    ) {
        fail(
            'intent_owner_mismatch',
            'only place intent may own createdBrokerOrderId',
        );
    }
    if (
        intent.createdBrokerOrderId !== undefined &&
        ['prepared', 'dispatching'].includes(intent.state)
    ) {
        fail(
            'entity_invariant_violation',
            'place BrokerOrder correlation cannot exist before durable acknowledgement/finality',
        );
    }
    if (intent.state === 'terminal') {
        if (
            !intent.terminalOutcome ||
            !(TERMINAL_OUTCOMES_BY_OPERATION[
                intent.operation
            ] as readonly OrderIntentTerminalOutcome[]).includes(
                intent.terminalOutcome,
            )
        ) {
            fail(
                'intent_outcome_invalid',
                'terminal OrderIntent requires an operation-specific outcome',
            );
        }
    } else if (intent.terminalOutcome !== undefined) {
        fail(
            'intent_outcome_invalid',
            'non-terminal OrderIntent cannot carry terminal outcome',
        );
    }
}

function validateIntentOwnerFields(owner: IntentOwner): void {
    switch (owner.kind) {
        case 'strategy_activation':
            requireOpaque(owner.strategyId, 'owner.strategyId');
            requireOpaque(owner.activationId, 'owner.activationId');
            return;
        case 'manual_confirmation':
            requireOpaque(owner.routeId, 'owner.routeId');
            requireOpaque(owner.confirmationId, 'owner.confirmationId');
            return;
        case 'gate_probe_run':
            requireOpaque(owner.probeRunId, 'owner.probeRunId');
            requireOpaque(owner.operationNonce, 'owner.operationNonce');
            return;
        case 'lifecycle_resolution':
            requireOpaque(owner.strategyId, 'owner.strategyId');
            requireOpaque(owner.resolutionCaseId, 'owner.resolutionCaseId');
            requireOpaque(owner.confirmationId, 'owner.confirmationId');
            return;
    }
}

function intentOwnersEqual(left: IntentOwner, right: IntentOwner): boolean {
    if (left.kind !== right.kind) return false;
    switch (left.kind) {
        case 'strategy_activation':
            return (
                right.kind === left.kind &&
                left.strategyId === right.strategyId &&
                left.activationId === right.activationId
            );
        case 'manual_confirmation':
            return (
                right.kind === left.kind &&
                left.routeId === right.routeId &&
                left.confirmationId === right.confirmationId
            );
        case 'gate_probe_run':
            return (
                right.kind === left.kind &&
                left.probeRunId === right.probeRunId &&
                left.operationNonce === right.operationNonce
            );
        case 'lifecycle_resolution':
            return (
                right.kind === left.kind &&
                left.strategyId === right.strategyId &&
                left.resolutionCaseId === right.resolutionCaseId &&
                left.confirmationId === right.confirmationId
            );
    }
}

function requireNonNegativeShares(value: bigint, label: string): void {
    if (value < 0n) {
        fail('entity_invariant_violation', `${label} cannot be negative`);
    }
}

function validatePrimaryEntityId(entity: SmartOrderStateEntity): void {
    const primaryId = (() => {
        switch (entity.entityKind) {
            case 'strategy':
                return entity.strategyId;
            case 'activation':
                return entity.activationId;
            case 'order_intent':
                return entity.intentId;
            case 'broker_order':
                return entity.brokerOrderId;
            case 'pending_protection_commitment':
                return entity.commitmentId;
            case 'protection_obligation':
                return entity.obligationId;
            case 'entry_exposure_reservation':
                return entity.reservationId;
            case 'exit_claim':
            case 'external_sell_claim':
                return entity.exitClaimId;
            case 'runtime_epoch':
                return entity.runtimeEpochId;
            case 'durable_dispatch_blocker':
                return entity.entityId;
            case 'safety_blocker':
                return entity.blockerId;
            case 'resolution_case':
                return entity.resolutionCaseId;
        }
    })();
    if (primaryId !== entity.entityId) {
        fail(
            'lineage_mismatch',
            `${entity.entityKind} primary ID does not equal entityId`,
        );
    }
}

function validateEntityInvariants(entity: SmartOrderStateEntity): void {
    requireOpaque(entity.entityId, 'entityId');
    requireOpaque(entity.lineageId, 'lineageId');
    requireNonNegativeSafeInteger(
        entity.lineageGeneration,
        'lineageGeneration',
    );
    if (!Number.isSafeInteger(entity.revision) || entity.revision < 1) {
        fail('entity_invariant_violation', 'revision must be a positive integer');
    }
    if (entity.resolutionCaseId !== undefined) {
        requireOpaque(entity.resolutionCaseId, 'entity.resolutionCaseId');
    }
    validatePrimaryEntityId(entity);
    switch (entity.entityKind) {
        case 'strategy': {
            requireOpaque(entity.runtimeEpochId, 'strategy.runtimeEpochId');
            requireNonNegativeSafeInteger(
                entity.armGeneration,
                'strategy.armGeneration',
            );
            if (entity.definitionStatus === 'draft') {
                if (!['draft', 'cancelled'].includes(entity.state)) {
                    fail(
                        'immutable_definition_violation',
                        'unsealed Strategy may only be draft or discarded-cancelled',
                    );
                }
                requireSha256(entity.draftPayloadHash, 'draftPayloadHash');
            } else {
                requireSha256(
                    entity.strategyDefinitionHash,
                    'strategyDefinitionHash',
                );
                requireSha256(
                    entity.confirmationSnapshotHash,
                    'confirmationSnapshotHash',
                );
                requireOpaque(
                    entity.fixedAccountOpaqueRef,
                    'fixedAccountOpaqueRef',
                );
                requireOpaque(
                    entity.identityGroupOpaqueRef,
                    'identityGroupOpaqueRef',
                );
            }
            return;
        }
        case 'activation':
            requireOpaque(entity.runtimeEpochId, 'activation.runtimeEpochId');
            requireOpaque(entity.strategyId, 'activation.strategyId');
            requireSha256(
                entity.strategyDefinitionHash,
                'activation.strategyDefinitionHash',
            );
            requireSha256(entity.logicalKeyHash, 'activation.logicalKeyHash');
            validateIntentOwnerFields(entity.dispatchOwner);
            if (
                entity.intendedProvenance !==
                provenanceForIntentOwner(entity.dispatchOwner)
            ) {
                fail(
                    'intent_owner_mismatch',
                    'Activation dispatch owner/provenance mismatch',
                );
            }
            if (entity.dispatchOwner.kind === 'strategy_activation') {
                if (
                    entity.dispatchOwner.strategyId !== entity.strategyId ||
                    entity.dispatchOwner.activationId !== entity.activationId
                ) {
                    fail(
                        'lineage_mismatch',
                        'Activation strategy owner lineage mismatch',
                    );
                }
            }
            if (entity.winnerLegId && entity.intentPurpose !== 'exit') {
                fail(
                    'entity_invariant_violation',
                    'only exit protection Activation can carry winnerLegId',
                );
            }
            return;
        case 'order_intent':
            requireSha256(entity.payloadHash, 'OrderIntent.payloadHash');
            validateIntentOwnerFields(entity.owner);
            validateIntentShape(entity);
            return;
        case 'broker_order': {
            requireOpaque(entity.intentId, 'BrokerOrder.intentId');
            requireOpaque(
                entity.fixedAccountOpaqueRef,
                'BrokerOrder.fixedAccountOpaqueRef',
            );
            requireOpaque(entity.tradeDate, 'BrokerOrder.tradeDate');
            requireOpaque(entity.contractKey, 'BrokerOrder.contractKey');
            requireSha256(
                entity.brokerCorrelationHash,
                'BrokerOrder.brokerCorrelationHash',
            );
            requireNonNegativeSafeInteger(
                entity.controlRevision,
                'BrokerOrder.controlRevision',
            );
            for (const [label, value] of [
                ['quantityShares', entity.quantityShares],
                ['filledShares', entity.filledShares],
                ['remainingShares', entity.remainingShares],
            ] as const) {
                requireNonNegativeShares(value, `BrokerOrder.${label}`);
            }
            if (entity.quantityShares === 0n) {
                fail(
                    'entity_invariant_violation',
                    'BrokerOrder.quantityShares must be greater than zero',
                );
            }
            if (
                entity.quantityShares !==
                entity.filledShares + entity.remainingShares
            ) {
                fail(
                    'entity_invariant_violation',
                    'BrokerOrder quantity projection does not balance',
                );
            }
            if (
                ['pending_submit', 'pre_submitted', 'submitted'].includes(
                    entity.state,
                ) &&
                (entity.filledShares !== 0n ||
                    entity.remainingShares !== entity.quantityShares)
            ) {
                fail(
                    'entity_invariant_violation',
                    'accepted BrokerOrder state cannot contain confirmed fills',
                );
            }
            if (
                entity.state === 'part_filled' &&
                (entity.filledShares === 0n || entity.remainingShares === 0n)
            ) {
                fail(
                    'entity_invariant_violation',
                    'part_filled BrokerOrder requires positive filled and remaining shares',
                );
            }
            if (
                entity.state === 'filled' &&
                (entity.filledShares !== entity.quantityShares ||
                    entity.remainingShares !== 0n)
            ) {
                fail(
                    'entity_invariant_violation',
                    'filled BrokerOrder requires full positive quantity and zero remaining shares',
                );
            }
            return;
        }
        case 'pending_protection_commitment': {
            requireOpaque(entity.strategyId, 'commitment.strategyId');
            requireOpaque(entity.entryIntentId, 'commitment.entryIntentId');
            requireOpaque(entity.obligationId, 'commitment.obligationId');
            validateIntentOwnerFields(entity.entryIntentOwner);
            if (
                (entity.entryIntentOwner.kind === 'strategy_activation' ||
                    entity.entryIntentOwner.kind === 'lifecycle_resolution') &&
                entity.entryIntentOwner.strategyId !== entity.strategyId
            ) {
                fail(
                    'lineage_mismatch',
                    'commitment Strategy lineage does not match its entry intent owner',
                );
            }
            for (const [label, value] of [
                ['requestedShares', entity.requestedShares],
                ['cumulativeFilledShares', entity.cumulativeFilledShares],
                ['openPotentialShares', entity.openPotentialShares],
                ['terminalUnfilledShares', entity.terminalUnfilledShares],
                ['materializedFilledShares', entity.materializedFilledShares],
                [
                    'unmaterializedConfirmedFillShares',
                    entity.unmaterializedConfirmedFillShares,
                ],
            ] as const) {
                requireNonNegativeShares(value, label);
            }
            if (
                entity.requestedShares !==
                    entity.cumulativeFilledShares +
                        entity.openPotentialShares +
                        entity.terminalUnfilledShares ||
                entity.cumulativeFilledShares !==
                    entity.materializedFilledShares +
                        entity.unmaterializedConfirmedFillShares
            ) {
                fail(
                    'entity_invariant_violation',
                    'entry commitment quantity equations do not balance',
                );
            }
            if (
                entity.state === 'zero_fill_terminal' &&
                (entity.cumulativeFilledShares !== 0n ||
                    entity.openPotentialShares !== 0n ||
                    entity.terminalUnfilledShares !== entity.requestedShares)
            ) {
                fail(
                    'entity_invariant_violation',
                    'zero_fill_terminal does not satisfy true zero-fill equation',
                );
            }
            if (
                entity.state === 'materialized' &&
                (entity.unmaterializedConfirmedFillShares !== 0n ||
                    entity.openPotentialShares !== 0n)
            ) {
                fail(
                    'entity_invariant_violation',
                    'materialized commitment still has unresolved fill potential',
                );
            }
            return;
        }
        case 'protection_obligation': {
            requireOpaque(entity.strategyId, 'obligation.strategyId');
            requireOpaque(entity.commitmentId, 'obligation.commitmentId');
            requireOpaque(entity.entryIntentId, 'obligation.entryIntentId');
            requireOpaque(
                entity.fixedAccountOpaqueRef,
                'obligation.fixedAccountOpaqueRef',
            );
            requireOpaque(entity.contractKey, 'obligation.contractKey');
            validateIntentOwnerFields(entity.entryIntentOwner);
            if (
                (entity.entryIntentOwner.kind === 'strategy_activation' ||
                    entity.entryIntentOwner.kind === 'lifecycle_resolution') &&
                entity.entryIntentOwner.strategyId !== entity.strategyId
            ) {
                fail(
                    'lineage_mismatch',
                    'obligation Strategy lineage does not match its entry intent owner',
                );
            }
            for (const [label, value] of [
                ['filledShares', entity.filledShares],
                ['confirmedExitedShares', entity.confirmedExitedShares],
            ] as const) {
                requireNonNegativeShares(value, label);
            }
            const protectionUnknown = entity.protectedShares === 'unknown';
            const remainderUnknown =
                entity.runtimeTrackedUnprotectedRemainder === 'unknown';
            if (protectionUnknown !== remainderUnknown) {
                fail(
                    'entity_invariant_violation',
                    'protected and unprotected projections must become unknown together',
                );
            }
            if (!protectionUnknown && !remainderUnknown) {
                requireNonNegativeShares(entity.protectedShares, 'protectedShares');
                requireNonNegativeShares(
                    entity.runtimeTrackedUnprotectedRemainder,
                    'runtimeTrackedUnprotectedRemainder',
                );
                if (
                    entity.filledShares !==
                    entity.confirmedExitedShares +
                        entity.protectedShares +
                        entity.runtimeTrackedUnprotectedRemainder
                ) {
                    fail(
                        'entity_invariant_violation',
                        'protection obligation quantity projection does not balance',
                    );
                }
            }
            if (
                entity.state === 'fulfilled' &&
                (entity.filledShares !== entity.confirmedExitedShares ||
                    entity.protectedShares !== 0n ||
                    entity.runtimeTrackedUnprotectedRemainder !== 0n)
            ) {
                fail(
                    'entity_invariant_violation',
                    'fulfilled obligation still has protected or unprotected shares',
                );
            }
            if (
                entity.state === 'zero_fill_terminal' &&
                (entity.filledShares !== 0n ||
                    entity.confirmedExitedShares !== 0n ||
                    entity.protectedShares !== 0n ||
                    entity.runtimeTrackedUnprotectedRemainder !== 0n)
            ) {
                fail(
                    'entity_invariant_violation',
                    'zero-fill obligation must prove every exposure projection is zero',
                );
            }
            return;
        }
        case 'entry_exposure_reservation':
            requireOpaque(
                entity.ownerIntentId,
                'reservation.ownerIntentId',
            );
            requireOpaque(
                entity.fixedAccountOpaqueRef,
                'reservation.fixedAccountOpaqueRef',
            );
            requireOpaque(entity.contractKey, 'reservation.contractKey');
            validateIntentOwnerFields(entity.entryIntentOwner);
            for (const [label, value] of [
                ['worstCaseReservedShares', entity.worstCaseReservedShares],
                ['reservedRemainingShares', entity.reservedRemainingShares],
                ['consumedShares', entity.consumedShares],
                ['releasedShares', entity.releasedShares],
            ] as const) {
                requireNonNegativeShares(value, label);
            }
            if (
                entity.worstCaseReservedShares !==
                entity.reservedRemainingShares +
                    entity.consumedShares +
                    entity.releasedShares
            ) {
                fail(
                    'entity_invariant_violation',
                    'reservation shares do not balance',
                );
            }
            if (
                ['consumed', 'released'].includes(entity.state) &&
                entity.reservedRemainingShares !== 0n
            ) {
                fail(
                    'entity_invariant_violation',
                    'terminal reservation has remaining reserved shares',
                );
            }
            if (
                entity.state === 'consumed' &&
                (entity.consumedShares !== entity.worstCaseReservedShares ||
                    entity.releasedShares !== 0n)
            ) {
                fail(
                    'entity_invariant_violation',
                    'consumed reservation must be fully converted to actual risk',
                );
            }
            return;
        case 'exit_claim':
        case 'external_sell_claim':
            requireOpaque(
                entity.fixedAccountOpaqueRef,
                'ExitClaim.fixedAccountOpaqueRef',
            );
            requireOpaque(entity.contractKey, 'ExitClaim.contractKey');
            requireOpaque(
                entity.positionLineageId,
                'ExitClaim.positionLineageId',
            );
            if (entity.entityKind === 'exit_claim') {
                if (entity.origin !== 'runtime') {
                    fail(
                        'lineage_mismatch',
                        'runtime ExitClaim has an invalid origin discriminator',
                    );
                }
                requireOpaque(entity.strategyId, 'ExitClaim.strategyId');
                requireOpaque(entity.obligationId, 'ExitClaim.obligationId');
            } else {
                if (entity.origin !== 'external') {
                    fail(
                        'lineage_mismatch',
                        'ExternalSellClaim has an invalid origin discriminator',
                    );
                }
                requireOpaque(
                    entity.brokerOrderId,
                    'ExternalSellClaim.brokerOrderId',
                );
            }
            requireNonNegativeSafeInteger(
                entity.remainderGeneration,
                'ExitClaim.remainderGeneration',
            );
            for (const [label, value] of [
                ['reservedShares', entity.reservedShares],
                ['activeShares', entity.activeShares],
                ['consumedShares', entity.consumedShares],
                ['releasedShares', entity.releasedShares],
            ] as const) {
                requireNonNegativeShares(value, label);
            }
            if (
                entity.reservedShares !==
                entity.activeShares +
                    entity.consumedShares +
                    entity.releasedShares
            ) {
                fail(
                    'entity_invariant_violation',
                    'exit claim generation shares do not balance',
                );
            }
            if (
                ['consumed', 'released'].includes(entity.state) &&
                entity.activeShares !== 0n
            ) {
                fail(
                    'entity_invariant_violation',
                    'terminal exit claim still has active shares',
                );
            }
            if (
                entity.state === 'consumed' &&
                (entity.consumedShares !== entity.reservedShares ||
                    entity.releasedShares !== 0n)
            ) {
                fail(
                    'entity_invariant_violation',
                    'consumed exit claim must settle all reserved shares as consumed',
                );
            }
            return;
        case 'runtime_epoch':
            for (const [label, value] of [
                ['processInstanceId', entity.processInstanceId],
                ['senderFence', entity.senderFence],
                ['apiGeneration', entity.apiGeneration],
                ['modeMarkerRevision', entity.modeMarkerRevision],
                ['manifestRevision', entity.manifestRevision],
            ] as const) {
                requireOpaque(value, label);
            }
            if (
                ['starting', 'fenced'].includes(entity.state) &&
                entity.fullReconciliationCompletedInEpoch
            ) {
                fail(
                    'runtime_epoch_invariant',
                    'starting/fenced epoch cannot inherit reconciliation completion',
                );
            }
            if (
                entity.state === 'observe_only' &&
                !entity.fullReconciliationCompletedInEpoch
            ) {
                fail(
                    'runtime_epoch_invariant',
                    'observe_only requires full reconciliation in the same epoch',
                );
            }
            return;
        case 'durable_dispatch_blocker':
            if (!['place', 'update', 'cancel'].includes(entity.intentOperation)) {
                fail(
                    'entity_invariant_violation',
                    'DurableDispatchBlocker has an invalid intent operation',
                );
            }
            for (const [label, value] of [
                ['intentId', entity.intentId],
                ['dispatchAttemptNonce', entity.dispatchAttemptNonce],
                ['runtimeEpochId', entity.runtimeEpochId],
                ['senderFence', entity.senderFence],
                ['apiGeneration', entity.apiGeneration],
                ['modeMarkerRevision', entity.modeMarkerRevision],
                ['accountOpaqueRef', entity.accountOpaqueRef],
            ] as const) {
                requireOpaque(value, label);
            }
            return;
        case 'safety_blocker':
            requireOpaque(entity.scopeId, 'SafetyBlocker.scopeId');
            if (
                (entity.blockerKind === 'unknown_broker_side_effect' ||
                    entity.blockerKind ===
                        'relinquished_unknown_exposure') &&
                (entity.worstCasePositionDeltaShares === undefined ||
                    entity.possiblyWorkingShares === undefined)
            ) {
                fail(
                    'entity_invariant_violation',
                    'unknown exposure SafetyBlocker requires both durable effect bounds',
                );
            }
            if (
                !Array.isArray(entity.scopeMemberSha256) ||
                entity.scopeMemberSha256.length === 0
            ) {
                fail(
                    'entity_invariant_violation',
                    'SafetyBlocker requires durable canonical scope members',
                );
            }
            for (const [index, member] of
                entity.scopeMemberSha256.entries()) {
                requirePrefixedSha256(
                    member,
                    `SafetyBlocker.scopeMemberSha256[${index}]`,
                );
            }
            if (
                new Set(entity.scopeMemberSha256).size !==
                    entity.scopeMemberSha256.length ||
                entity.scopeMemberSha256.some(
                    (member, index) =>
                        index > 0 &&
                        entity.scopeMemberSha256[index - 1]! >= member,
                )
            ) {
                fail(
                    'entity_invariant_violation',
                    'SafetyBlocker scope members must be unique and canonically sorted',
                );
            }
            requireOpaque(
                entity.resolutionCaseId,
                'SafetyBlocker.resolutionCaseId',
            );
            if (entity.worstCasePositionDeltaShares !== undefined) {
                requireNonNegativeShares(
                    entity.worstCasePositionDeltaShares,
                    'worstCasePositionDeltaShares',
                );
            }
            if (entity.possiblyWorkingShares !== undefined) {
                requireNonNegativeShares(
                    entity.possiblyWorkingShares,
                    'possiblyWorkingShares',
                );
            }
            return;
        case 'resolution_case':
            requireOpaque(entity.scopeId, 'ResolutionCase.scopeId');
            return;
    }
}

function expectedBlockingStateResolutionOperation(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): BlockingStateResolutionOperation | undefined {
    const classified = blockingResolutionOperationForTransition(
        transitionContractBinding(edge, request, entity),
    );
    if (classified) return classified;
    const fromBlocking =
        edge.from !== '__create__' &&
        isResolutionLinkedBlockingState(edge.entityKind, edge.from);
    const toBlocking = isResolutionLinkedBlockingState(edge.entityKind, edge.to);
    if (!fromBlocking || toBlocking || edge.edgeId === 'STR-012D') {
        return undefined;
    }
    if (expectedResolutionOperation(edge, request)) {
        return undefined;
    }
    fail(
        'resolution_matrix_rejected',
        `${entity.entityKind}:${edge.edgeId} has no opaque blocking-state resolution contract`,
    );
}

function validateResolutionDecisionContractCoverage(): void {
    const specialDecisionEdges = new Set([
        'RC-004A',
        'RC-004B',
        'RC-004C',
        'RC-005',
        'RC-006',
        'SB-002',
        'SB-003',
        'RTE-016',
    ]);
    for (const edge of BUILT_EDGE_DEFINITIONS) {
        for (const reasonCode of edge.reasonCodes) {
            const binding: ResolutionStateTransitionBinding = {
                kind: 'state_transition',
                entityKind: edge.entityKind,
                entityId: '__registry_contract_audit__',
                lineageId: '__registry_contract_audit__',
                lineageGeneration: 0,
                expectedRevision: edge.from === '__create__' ? 0 : 1,
                effectProjectionSha256: `sha256:${'0'.repeat(64)}`,
                edgeId: edge.edgeId,
                fromState: edge.from,
                toState: edge.to,
                transitionReasonCode: reasonCode,
            };
            const manual = manualResolutionOperationForTransition(binding);
            const blocking = blockingResolutionOperationForTransition(binding);
            if (manual && blocking) {
                throw new Error(
                    `ambiguous resolution decision contract: ${edge.entityKind}:${edge.edgeId}:${reasonCode}`,
                );
            }
            const exitsResolutionLinkedBlockingState =
                edge.from !== '__create__' &&
                isResolutionLinkedBlockingState(edge.entityKind, edge.from) &&
                !isResolutionLinkedBlockingState(edge.entityKind, edge.to) &&
                edge.edgeId !== 'STR-012D';
            if (
                (exitsResolutionLinkedBlockingState ||
                    specialDecisionEdges.has(edge.edgeId)) &&
                !manual &&
                !blocking
            ) {
                throw new Error(
                    `missing opaque resolution decision contract: ${edge.entityKind}:${edge.edgeId}:${reasonCode}`,
                );
            }
        }
    }
}

validateResolutionDecisionContractCoverage();

function resolutionTransitionBindingMatches(
    decision:
        | Readonly<VerifiedManualResolutionDecision>
        | Readonly<VerifiedBlockingStateResolutionDecision>,
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): boolean {
    const binding =
        'executionBoundary' in decision
            ? decision.executionBoundary
            : decision.transitionBinding;
    return (
        binding.kind === 'state_transition' &&
        binding.entityKind === entity.entityKind &&
        binding.entityId === entity.entityId &&
        binding.lineageId === entity.lineageId &&
        binding.lineageGeneration === entity.lineageGeneration &&
        binding.expectedRevision === request.expectedRevision &&
        binding.effectProjectionSha256 === request.effectProjectionSha256 &&
        binding.edgeId === edge.edgeId &&
        binding.fromState === edge.from &&
        binding.toState === edge.to &&
        binding.transitionReasonCode === request.reasonCode
    );
}

function manualDecisionDestinationMatches(
    edge: StateEdgeDefinition,
    decision: Readonly<VerifiedManualResolutionDecision>,
): boolean {
    switch (decision.operation) {
        case 'break_glass_relinquish':
            return decision.destination === 'resolution_case_relinquished_unknown';
        case 'reconfirm_and_pause':
            return (
                decision.destination === 'paused' &&
                ['STR-010', 'RC-005'].includes(edge.edgeId)
            );
        case 'apply_unique_final_evidence':
            if (decision.destination === 'terminal_entity_unchanged') {
                return ['RC-004A', 'RC-004B', 'RC-004C'].includes(edge.edgeId);
            }
            return decision.destination === 'paused';
        case 'cancel_strategy':
        case 'copy_to_new_draft':
        case 'repair_gate_observe_only':
        case 'remain_open':
            return false;
    }
}

function validateVerifiedManualResolutionTransition(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
    resolutionLink: ResolutionCaseLink | undefined,
): void {
    const expectedOperation = expectedResolutionOperation(edge, request);
    if (!expectedOperation) {
        if (request.manualResolutionDecision !== undefined) {
            fail(
                'resolution_matrix_rejected',
                'verified manual resolution authority is not allowed on this transition',
            );
        }
        return;
    }
    const decision = request.manualResolutionDecision;
    if (
        !decision ||
        !resolutionLink ||
        !isVerifiedManualResolutionDecision(decision) ||
        decision.executionBoundary.kind !== 'state_transition'
    ) {
        fail(
            'resolution_matrix_rejected',
            'manual resolution transition requires a current verifier-issued opaque decision',
        );
    }
    const expectedCaseState =
        expectedOperation === 'break_glass_relinquish'
            ? 'relinquished_unknown'
            : expectedOperation === 'reconfirm_and_pause'
              ? 'resolved_by_reconfirmation'
              : 'resolved_by_final_evidence';
    if (
        decision.operation !== expectedOperation ||
        decision.reasonCode !== resolutionLink.openingReasonCode ||
        decision.row.reasonCode !== resolutionLink.openingReasonCode ||
        decision.resolutionCaseId !== resolutionLink.resolutionCaseId ||
        decision.caseRevision !== resolutionLink.caseRevision ||
        decision.scopeSha256 !== resolutionLink.scopeSha256 ||
        decision.targetSideEffectSha256 !==
            resolutionLink.targetSideEffectSha256 ||
        decision.evidenceSnapshotSha256 !==
            resolutionLink.evidenceSnapshotSha256 ||
        !request.targetSideEffectSha256 ||
        decision.targetSideEffectSha256 !== request.targetSideEffectSha256 ||
        decision.runtimeEpochId !== request.runtimeEpochId ||
        !request.apiGeneration ||
        decision.apiGeneration !== request.apiGeneration ||
        decision.authorizedAtEpochMs !== Date.parse(request.observedWallTime) ||
        resolutionLink.state !== expectedCaseState ||
        decision.oldIntentDisposition !== 'never_resend' ||
        !resolutionTransitionBindingMatches(decision, entity, edge, request) ||
        !manualDecisionDestinationMatches(edge, decision)
    ) {
        fail(
            'resolution_matrix_rejected',
            'manual resolution decision does not match transition target, case, runtime, time, or operation',
        );
    }
    const authorizationKind =
        expectedOperation === 'break_glass_relinquish'
            ? 'BreakGlassAuthorization'
            : expectedOperation === 'reconfirm_and_pause'
              ? 'UserRearmAuthorization'
              : undefined;
    if (authorizationKind) {
        const authorization = request.authorizationEvidence.find(
            (item) => item.kind === authorizationKind,
        );
        const expectedNonces = decision.atomicConsume;
        if (
            !authorization ||
            !decision.authorizationSha256 ||
            authorization.authorizationHash !==
                sha256Hex(decision.authorizationSha256) ||
            !authorization.burnedNonces ||
            authorization.burnedNonces.length !== expectedNonces.length ||
            authorization.burnedNonces.some(
                (item, index) =>
                    item.nonce !== expectedNonces[index]?.nonce ||
                    item.revision !== expectedNonces[index]?.revision,
            ) ||
            decision.confirmationSteps.length !== expectedNonces.length
        ) {
            fail(
                'authorization_missing',
                'manual resolution authorization is not bound to the exact consumed nonce set',
            );
        }
        if (
            expectedOperation === 'break_glass_relinquish' &&
            authorization.secondConfirmationHash !==
                sha256Hex(
                    decision.confirmationSteps[1]!.userConfirmationSha256,
                )
        ) {
            fail(
                'authorization_missing',
                'break-glass second confirmation is not bound to the opaque decision',
            );
        }
    } else if (
        decision.authorizationSha256 !== undefined ||
        decision.atomicConsume.length !== 0 ||
        decision.confirmationSteps.length !== 0
    ) {
        fail(
            'resolution_matrix_rejected',
            'unique final evidence transition cannot consume unrelated user authorization',
        );
    }
}

function validateVerifiedBlockingStateResolutionTransition(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
    resolutionLink: ResolutionCaseLink | undefined,
): void {
    const expectedOperation = expectedBlockingStateResolutionOperation(
        entity,
        edge,
        request,
    );
    if (!expectedOperation) {
        if (request.blockingStateResolutionDecision !== undefined) {
            fail(
                'resolution_matrix_rejected',
                'opaque blocking-state resolution authority is not allowed on this transition',
            );
        }
        return;
    }
    const decision = request.blockingStateResolutionDecision;
    if (
        !decision ||
        !resolutionLink ||
        !isVerifiedBlockingStateResolutionDecision(decision)
    ) {
        fail(
            'resolution_matrix_rejected',
            'blocking-state exit requires a current verifier-issued opaque decision',
        );
    }
    const nonTerminalCaseState = !isResolutionCaseTerminal(
        resolutionLink.state,
    );
    const resolutionCaseStateMatches =
        expectedOperation === 'apply_canonical_projection_keep_blocked'
            ? nonTerminalCaseState
            : expectedOperation === 'resolve_safety_blocker' &&
                request.reasonCode ===
                    'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED'
              ? resolutionLink.state === 'relinquished_unknown'
              : expectedOperation === 'supersede_safety_blocker'
                ? nonTerminalCaseState
                : resolutionLink.state === 'resolved_by_final_evidence';
    const blockerIdentityMatches =
        entity.entityKind !== 'safety_blocker'
            ? true
            : expectedOperation === 'supersede_safety_blocker'
              ? resolutionLink.safetyBlockerId !== entity.blockerId
              : resolutionLink.safetyBlockerId === entity.blockerId;
    if (
        entity.entityKind === 'safety_blocker' &&
        (expectedOperation === 'resolve_safety_blocker' ||
            expectedOperation === 'supersede_safety_blocker')
    ) {
        validateSafetyBlockerResolutionBinding(
            entity,
            expectedOperation,
            decision,
            resolutionLink,
        );
    }
    if (
        decision.operation !== expectedOperation ||
        decision.reasonCode !== resolutionLink.openingReasonCode ||
        decision.resolutionCaseId !== resolutionLink.resolutionCaseId ||
        decision.caseRevision !== resolutionLink.caseRevision ||
        decision.scopeSha256 !== resolutionLink.scopeSha256 ||
        decision.targetSideEffectSha256 !==
            resolutionLink.targetSideEffectSha256 ||
        decision.evidenceSnapshotSha256 !==
            resolutionLink.evidenceSnapshotSha256 ||
        !request.targetSideEffectSha256 ||
        decision.targetSideEffectSha256 !== request.targetSideEffectSha256 ||
        decision.runtimeEpochId !== request.runtimeEpochId ||
        !request.apiGeneration ||
        decision.apiGeneration !== request.apiGeneration ||
        decision.authorizedAtEpochMs !== Date.parse(request.observedWallTime) ||
        !resolutionCaseStateMatches ||
        !blockerIdentityMatches ||
        decision.oldIntentDisposition !== 'never_resend' ||
        (expectedOperation === 'apply_unique_final_evidence' &&
            !decision.uniqueFinalEvidenceSha256) ||
        !resolutionTransitionBindingMatches(decision, entity, edge, request)
    ) {
        fail(
            'resolution_matrix_rejected',
            'blocking-state resolution decision does not match edge, case, evidence, target, or runtime',
        );
    }
}

function safetyBlockerQuantityText(value: bigint | undefined): string | undefined {
    return value === undefined ? undefined : value.toString(10);
}

function isStrictSafetyBlockerScopeSuperset(
    predecessor: SafetyBlockerResolutionBinding['scope'],
    successor: SafetyBlockerResolutionBinding['scope'],
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

function validateSafetyBlockerResolutionBinding(
    entity: SafetyBlocker,
    operation: Extract<
        BlockingStateResolutionOperation,
        'resolve_safety_blocker' | 'supersede_safety_blocker'
    >,
    decision: Readonly<VerifiedBlockingStateResolutionDecision>,
    resolutionLink: ResolutionCaseLink,
): void {
    const binding = decision.safetyBlockerResolutionBinding;
    if (
        !binding ||
        binding.blockerId !== entity.blockerId ||
        binding.blockerKind !== entity.blockerKind ||
        binding.resolutionCaseId !== entity.resolutionCaseId ||
        binding.lineageId !== entity.lineageId ||
        binding.lineageGeneration !== entity.lineageGeneration ||
        binding.scope.scopeId !== entity.scopeId ||
        binding.scope.memberSha256.length !==
            entity.scopeMemberSha256.length ||
        binding.scope.memberSha256.some(
            (member, index) =>
                member !== entity.scopeMemberSha256[index],
        ) ||
        binding.worstCasePositionDeltaShares !==
            safetyBlockerQuantityText(entity.worstCasePositionDeltaShares) ||
        binding.possiblyWorkingShares !==
            safetyBlockerQuantityText(entity.possiblyWorkingShares)
    ) {
        fail(
            'resolution_matrix_rejected',
            'SafetyBlocker verifier binding does not match the durable blocker kind, scope, bounds, or lineage',
        );
    }
    if (operation === 'resolve_safety_blocker') {
        if (
            binding.successor !== undefined ||
            resolutionLink.safetyBlockerId !== entity.blockerId
        ) {
            fail(
                'resolution_matrix_rejected',
                'SB-002 cannot switch blocker identity or carry a successor',
            );
        }
        if (
            binding.resolutionPath ===
                'gate_approved_zero_exposure_bounds' &&
            (entity.blockerKind !== 'relinquished_unknown_exposure' ||
                entity.worstCasePositionDeltaShares !== 0n ||
                entity.possiblyWorkingShares !== 0n ||
                !binding.gateApprovedZeroBoundsEvidenceSha256 ||
                !decision.evidenceClasses.includes(
                    'gate_approved_zero_exposure_bounds',
                ))
        ) {
            fail(
                'resolution_matrix_rejected',
                'Gate-approved SafetyBlocker resolution requires explicit zero bounds and opaque Gate evidence',
            );
        }
        if (
            (entity.blockerKind === 'unknown_broker_side_effect' ||
                entity.blockerKind === 'relinquished_unknown_exposure') &&
            binding.resolutionPath !==
                'gate_approved_zero_exposure_bounds' &&
            (!decision.uniqueFinalEvidenceSha256 ||
                binding.resolutionPath !==
                    'canonical_unique_final_current_exposure' ||
                !decision.evidenceClasses.includes(
                    'broker_position_and_working_set',
                ) ||
                !decision.evidenceClasses.includes(
                    'full_external_working_set',
                ))
        ) {
            fail(
                'resolution_matrix_rejected',
                'unknown exposure SafetyBlocker requires unique final broker evidence and current position/working-set evidence',
            );
        }
        return;
    }

    const successor = binding.successor;
    if (
        binding.resolutionPath !== 'supersede_strict_scope' ||
        !successor ||
        successor.blockerId !== resolutionLink.safetyBlockerId ||
        successor.blockerId === entity.blockerId ||
        successor.blockerKind !== entity.blockerKind ||
        successor.resolutionCaseId !== entity.resolutionCaseId ||
        successor.predecessorBlockerId !== entity.blockerId ||
        successor.predecessorLineageId !== entity.lineageId ||
        successor.lineageId === entity.lineageId ||
        successor.lineageGeneration !== entity.lineageGeneration + 1 ||
        ((entity.blockerKind === 'unknown_broker_side_effect' ||
            entity.blockerKind === 'relinquished_unknown_exposure') &&
            (successor.worstCasePositionDeltaShares === undefined ||
                successor.possiblyWorkingShares === undefined ||
                BigInt(successor.worstCasePositionDeltaShares) <
                    entity.worstCasePositionDeltaShares! ||
                BigInt(successor.possiblyWorkingShares) <
                    entity.possiblyWorkingShares!)) ||
        !isStrictSafetyBlockerScopeSuperset(binding.scope, successor.scope)
    ) {
        fail(
            'resolution_matrix_rejected',
            'SB-003 requires a lineage-connected successor with non-decreasing unknown-effect bounds and a canonical strict-superset scope',
        );
    }
}

function validateManualStrategyPausedExit(
    strategy: SealedStrategy,
    request: StateTransitionRequest,
    resolutionLink: ResolutionCaseLink,
): void {
    const openingReason = strategy.manualResolutionReasonCode;
    const decision = request.manualResolutionDecision;
    if (
        !openingReason ||
        !decision ||
        !isVerifiedManualResolutionDecision(decision)
    ) {
        fail(
            'resolution_matrix_rejected',
            'manual Strategy exit requires a verifier-issued opaque resolution decision',
        );
    }
    if (
        decision.reasonCode !== openingReason ||
        decision.resolutionCaseId !== resolutionLink.resolutionCaseId ||
        decision.caseRevision !== resolutionLink.caseRevision ||
        decision.scopeSha256 !== resolutionLink.scopeSha256 ||
        decision.evidenceSnapshotSha256 !==
            resolutionLink.evidenceSnapshotSha256 ||
        decision.destination !== 'paused' ||
        decision.row.rearmPolicy === 'never' ||
        !decision.freshConfirmationSha256 ||
        decision.freshConfirmationSha256 ===
            `sha256:${strategy.confirmationSnapshotHash}` ||
        decision.atomicConsume.length !== 1
    ) {
        fail(
            'resolution_matrix_rejected',
            'manual Strategy exit does not match its canonical verified resolution authority',
        );
    }
    requirePrefixedSha256(
        decision.freshConfirmationSha256,
        'manual resolution freshConfirmationSha256',
    );
    if (resolutionLink.state !== 'resolved_by_reconfirmation') {
        fail(
            'resolution_matrix_rejected',
            'STR-010 requires ResolutionCase.resolved_by_reconfirmation',
        );
    }
}

function isCanonicalManualInterventionReason(
    reasonCode: ReasonCode,
): reasonCode is ManualInterventionReasonCode {
    return (MANUAL_INTERVENTION_REASON_CODES as readonly string[]).includes(
        reasonCode,
    );
}

function hasAuthorizationKind(
    request: StateTransitionRequest,
    kind: AuthorizationEvidenceKind,
): boolean {
    return request.authorizationEvidence.some((item) => item.kind === kind);
}

function validateEntitySpecificTransition(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
    resolutionLink: ResolutionCaseLink | undefined,
): void {
    validateVerifiedManualResolutionTransition(
        entity,
        edge,
        request,
        resolutionLink,
    );
    validateVerifiedBlockingStateResolutionTransition(
        entity,
        edge,
        request,
        resolutionLink,
    );
    if (entity.entityKind === 'strategy') {
        if (edge.edgeId === 'STR-001') {
            const seal = request.strategyDefinitionSeal;
            if (
                entity.definitionStatus !== 'draft' ||
                !seal ||
                seal.strategyId !== entity.strategyId ||
                seal.intendedProvenance !== 'automation'
            ) {
                fail(
                    'immutable_definition_violation',
                    'STR-001 requires a matching immutable Strategy definition seal',
                );
            }
            requireSha256(seal.strategyDefinitionHash, 'strategyDefinitionHash');
            requireSha256(
                seal.confirmationSnapshotHash,
                'confirmationSnapshotHash',
            );
            requireOpaque(
                seal.immutableDefinitionRecordId,
                'immutableDefinitionRecordId',
            );
            requireOpaque(seal.fixedAccountOpaqueRef, 'fixedAccountOpaqueRef');
            requireOpaque(
                seal.identityGroupOpaqueRef,
                'identityGroupOpaqueRef',
            );
        } else if (
            entity.definitionStatus === 'draft' &&
            edge.edgeId !== 'STR-002'
        ) {
            fail(
                'immutable_definition_violation',
                'draft Strategy only accepts STR-001 or STR-002',
            );
        }
        if (edge.to === 'manual_intervention') {
            if (
                !isCanonicalManualInterventionReason(request.reasonCode) ||
                !resolutionLink
            ) {
                fail(
                    'resolution_matrix_rejected',
                    'manual_intervention requires a frozen resolution family and open case',
                );
            }
        }
        if (edge.edgeId === 'STR-010') {
            if (entity.definitionStatus !== 'sealed' || !resolutionLink) {
                fail(
                    'resolution_matrix_rejected',
                    'STR-010 requires a sealed Strategy and terminal case',
                );
            }
            validateManualStrategyPausedExit(entity, request, resolutionLink);
        }
    }
    if (entity.entityKind === 'activation') {
        if (
            edge.edgeId === 'ACT-007' &&
            request.brokerWriteProvenance !==
                provenanceForIntentOwner(entity.dispatchOwner)
        ) {
            fail(
                'intent_owner_mismatch',
                'Activation dispatch provenance does not match typed owner',
            );
        }
    }
    if (entity.entityKind === 'broker_order') {
        validateBrokerOrderQuantityTransition(entity, edge, request);
    }
    if (entity.entityKind === 'order_intent') {
        validateOrderIntentTerminalOutcome(entity, edge, request);
        if (
            edge.edgeId === 'INT-001' &&
            request.actorKind !== actorForIntentOwner(entity.owner)
        ) {
            fail(
                'intent_owner_mismatch',
                'INT-001 writer does not match typed owner',
            );
        }
        if (
            edge.edgeId === 'INT-001' &&
            entity.owner.kind === 'lifecycle_resolution' &&
            !hasAuthorizationKind(request, 'UserRearmAuthorization')
        ) {
            fail(
                'authorization_missing',
                'lifecycle resolution intent requires fresh UserRearmAuthorization',
            );
        }
        if (edge.edgeId === 'INT-002') {
            if (
                request.brokerWriteProvenance !==
                provenanceForIntentOwner(entity.owner)
            ) {
                fail(
                    'intent_owner_mismatch',
                    'INT-002 provenance does not match typed owner',
                );
            }
            if (
                entity.dispatchAttemptNonce ||
                entity.durableDispatchBlockerId ||
                entity.senderFence ||
                entity.runtimeEpochId
            ) {
                fail(
                    'state_revision_conflict',
                    'OrderIntent already consumed its single dispatch authority',
                );
            }
        }
    } else if (entity.entityKind === 'durable_dispatch_blocker') {
        if (edge.edgeId === 'DDB-003') {
            const outcome = request.terminalOutcome;
            const locallyResolved =
                outcome ===
                    `${entity.intentOperation}_cancelled_proven_unsent` ||
                outcome === `${entity.intentOperation}_stale_target_prebyte` ||
                outcome === `${entity.intentOperation}_relinquished_unknown`;
            if (
                !outcome ||
                !(TERMINAL_OUTCOMES_BY_OPERATION[
                    entity.intentOperation
                ] as readonly OrderIntentTerminalOutcome[]).includes(outcome) ||
                locallyResolved
            ) {
                fail(
                    'intent_outcome_invalid',
                    'DDB-003 requires broker-final evidence for its bound intent operation',
                );
            }
        } else if (request.terminalOutcome !== undefined) {
            fail(
                'intent_outcome_invalid',
                'terminalOutcome belongs only to an OrderIntent terminal edge or DDB-003',
            );
        }
    } else if (request.terminalOutcome !== undefined) {
        fail(
            'intent_outcome_invalid',
            'terminalOutcome belongs only to an OrderIntent terminal edge',
        );
    }
    if (
        entity.entityKind === 'pending_protection_commitment' &&
        edge.edgeId === 'PPC-001' &&
        (entity.cumulativeFilledShares !== 0n ||
            entity.materializedFilledShares !== 0n ||
            entity.unmaterializedConfirmedFillShares !== 0n ||
            entity.terminalUnfilledShares !== 0n ||
            entity.openPotentialShares !== entity.requestedShares)
    ) {
        fail(
            'entity_invariant_violation',
            'PPC-001 must start with zero fills and all requested shares potential',
        );
    }
    if (
        entity.entityKind === 'protection_obligation' &&
        edge.edgeId === 'POB-001' &&
        (entity.filledShares !== 0n ||
            entity.confirmedExitedShares !== 0n ||
            entity.protectedShares !== 0n ||
            entity.runtimeTrackedUnprotectedRemainder !== 0n)
    ) {
        fail(
            'entity_invariant_violation',
            'POB-001 must start with zero entry/protection quantities',
        );
    }
    if (
        entity.entityKind === 'entry_exposure_reservation' &&
        edge.edgeId === 'EER-001' &&
        (entity.consumedShares !== 0n ||
            entity.releasedShares !== 0n ||
            entity.reservedRemainingShares !== entity.worstCaseReservedShares)
    ) {
        fail(
            'entity_invariant_violation',
            'EER-001 must reserve the full immutable worst-case amount',
        );
    }
    if (entity.entityKind === 'resolution_case') {
        const link = request.resolutionCaseLink;
        if (
            !link ||
            link.resolutionCaseId !== entity.resolutionCaseId ||
            link.openingReasonCode !== entity.openingReasonCode ||
            link.state !== edge.to ||
            request.scopeId !== entity.scopeId
        ) {
            fail(
                'lineage_mismatch',
                'ResolutionCase transition link must describe the same case/scope/next state',
            );
        }
    }
    if (entity.entityKind === 'safety_blocker') {
        const link = request.resolutionCaseLink;
        const blockerIdentityMatches =
            edge.edgeId === 'SB-003'
                ? Boolean(
                      link?.safetyBlockerId &&
                          link.safetyBlockerId !== entity.blockerId,
                  )
                : link?.safetyBlockerId === entity.blockerId;
        if (
            !link ||
            !blockerIdentityMatches ||
            link.resolutionCaseId !== entity.resolutionCaseId ||
            request.scopeId !== entity.scopeId
        ) {
            fail(
                'lineage_mismatch',
                'SafetyBlocker transition link must describe the same blocker/case/scope',
            );
        }
        if (edge.edgeId === 'SB-001' && link.state !== 'open') {
            fail('lineage_mismatch', 'SB-001 requires an open ResolutionCase link');
        }
        if (edge.edgeId === 'SB-002' && !isResolutionCaseTerminal(link.state)) {
            fail(
                'resolution_matrix_rejected',
                'SafetyBlocker may resolve only with a terminal ResolutionCase',
            );
        }
        if (edge.edgeId === 'SB-003' && isResolutionCaseTerminal(link.state)) {
            fail(
                'resolution_matrix_rejected',
                'SB-003 must preserve the open ResolutionCase while linking a distinct successor blocker',
            );
        }
    }
}

function validateRuntimeEpochTransition(
    epoch: RuntimeEpoch,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): void {
    if (edge.edgeId === 'RTE-005' && request.evidence.length !== 1) {
        fail(
            'runtime_epoch_invariant',
            'RTE-005 requires one bounded full-reconciliation evidence snapshot',
        );
    }
    if (edge.edgeId === 'RTE-013A' && !epoch.fullReconciliationCompletedInEpoch) {
        fail(
            'runtime_epoch_invariant',
            'quiescing cannot fall back to observe_only before full reconciliation',
        );
    }
    if (edge.edgeId === 'RTE-012') {
        const proof = request.runtimeStopProof;
        if (!proof) {
            fail(
                'runtime_epoch_invariant',
                'graceful stop requires typed drain proof',
            );
        }
        requireNonNegativeSafeInteger(
            proof.ephemeralProcessLeaseCount,
            'ephemeralProcessLeaseCount',
        );
        requireNonNegativeSafeInteger(
            proof.openDurableDispatchBlockerCount,
            'openDurableDispatchBlockerCount',
        );
        requireSha256(proof.durableSnapshotHash, 'durableSnapshotHash');
        const neverAuthorizedAndNoHistory =
            !proof.senderAuthorityEverAcquired &&
            !proof.durableSideEffectHistoryExists &&
            !proof.durableObligationHistoryExists;
        if (
            proof.ephemeralProcessLeaseCount !== 0 ||
            proof.openDurableDispatchBlockerCount !== 0 ||
            !proof.requiredDrainPassed ||
            !proof.databaseCommitReliablyAvailable ||
            (!epoch.fullReconciliationCompletedInEpoch &&
                !neverAuthorizedAndNoHistory)
        ) {
            fail(
                'runtime_epoch_invariant',
                'graceful stop drain/reconciliation invariant is not satisfied',
            );
        }
    }
    if (
        edge.edgeId.startsWith('RTE-015') ||
        edge.edgeId === 'RTE-016'
    ) {
        if (!request.runtimeStopProof?.databaseCommitReliablyAvailable) {
            fail(
                'runtime_epoch_invariant',
                'durable failed_stop may be asserted only while database commit is reliable',
            );
        }
    }
}

const QUANTITY_PROJECTION_ALLOWED_EDGES = new Set([
    'BRO-004A',
    'BRO-004B',
    'BRO-004C',
    'BRO-004D',
    'BRO-004E',
    'BRO-005A',
    'BRO-005B',
    'BRO-005C',
    'BRO-005D',
    'BRO-005E',
    'PPC-003',
    'PPC-005A',
    'PPC-005B',
    'PPC-006',
    'PPC-007A',
    'PPC-007B',
    'PPC-008A',
    'PPC-008B',
    'PPC-008C',
    'PPC-009A',
    'PPC-009B',
    'PPC-009C',
    'PPC-010A',
    'PPC-010B',
    'PPC-010C',
    'PPC-011',
    'POB-002',
    'POB-003A',
    'POB-003B',
    'POB-003C',
    'POB-003D',
    'POB-003E',
    'POB-004',
    'POB-005',
    'POB-008A',
    'POB-008B',
    'POB-008C',
    'POB-009',
    'POB-010A',
    'POB-010B',
    'POB-010C',
    'POB-011A',
    'POB-011B',
    'POB-011C',
    'POB-011D',
    'POB-011E',
    'POB-011F',
    'POB-012A',
    'POB-012B',
    'POB-012C',
    'POB-012D',
    'POB-012E',
    'POB-012F',
    'POB-013A',
    'POB-013B',
    'POB-013C',
    'POB-013D',
    'POB-013E',
    'POB-013F',
    'POB-014',
    'EER-002',
    'EER-003A',
    'EER-003B',
    'EER-004A',
    'EER-004B',
    'EER-005A',
    'EER-005B',
    'EER-006A',
    'EER-006B',
    'EER-006C',
    'EXC-003',
    'EXC-004',
    'EXC-005',
    'EXC-006',
    'EXC-007A',
    'EXC-007B',
    'EXC-008',
    'EXC-009',
    'EXC-010A',
    'EXC-010B',
    'EXC-010C',
]);

const QUANTITY_PROJECTION_REQUIRED_EDGES = new Set([
    'BRO-004A',
    'BRO-004B',
    'BRO-004C',
    'BRO-004D',
    'BRO-004E',
    'BRO-005A',
    'BRO-005B',
    'BRO-005C',
    'BRO-005D',
    'BRO-005E',
    'PPC-003',
    'PPC-005A',
    'PPC-005B',
    'PPC-006',
    'PPC-007A',
    'PPC-007B',
    'PPC-008A',
    'PPC-008B',
    'PPC-008C',
    'PPC-010A',
    'PPC-010B',
    'PPC-010C',
    'POB-002',
    'POB-004',
    'POB-005',
    'POB-008A',
    'POB-008B',
    'POB-008C',
    'POB-009',
    'POB-010A',
    'POB-010B',
    'POB-010C',
    'POB-012A',
    'POB-012B',
    'POB-012C',
    'POB-012D',
    'POB-012E',
    'POB-012F',
    'POB-013A',
    'POB-013B',
    'POB-013C',
    'POB-013D',
    'POB-013E',
    'POB-013F',
    'EER-002',
    'EER-003A',
    'EER-003B',
    'EER-004A',
    'EER-004B',
    'EER-006A',
    'EER-006B',
    'EER-006C',
    'EXC-004',
    'EXC-006',
    'EXC-008',
    'EXC-009',
    'EXC-010A',
    'EXC-010B',
    'EXC-010C',
]);

function validateQuantityProjection(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): void {
    const projection = request.nextQuantityProjection;
    if (QUANTITY_PROJECTION_REQUIRED_EDGES.has(edge.edgeId) && !projection) {
        fail(
            'entity_invariant_violation',
            `${edge.edgeId} requires an explicit next quantity projection`,
        );
    }
    if (!projection) return;
    if (!QUANTITY_PROJECTION_ALLOWED_EDGES.has(edge.edgeId)) {
        fail(
            'entity_invariant_violation',
            `${edge.edgeId} cannot mutate quantity projection`,
        );
    }
    if (projection.entityKind !== entity.entityKind) {
        fail(
            'lineage_mismatch',
            'quantity projection entity kind does not match transition entity',
        );
    }
}

function applyQuantityProjection(
    entity: SmartOrderStateEntity,
    request: StateTransitionRequest,
): SmartOrderStateEntity {
    const projection = request.nextQuantityProjection;
    if (!projection) return entity;
    switch (projection.entityKind) {
        case 'broker_order':
            return {
                ...(entity as BrokerOrder),
                quantityShares: projection.quantityShares,
                filledShares: projection.filledShares,
                remainingShares: projection.remainingShares,
            };
        case 'pending_protection_commitment':
            return {
                ...(entity as PendingProtectionCommitment),
                cumulativeFilledShares: projection.cumulativeFilledShares,
                openPotentialShares: projection.openPotentialShares,
                terminalUnfilledShares: projection.terminalUnfilledShares,
                materializedFilledShares: projection.materializedFilledShares,
                unmaterializedConfirmedFillShares:
                    projection.unmaterializedConfirmedFillShares,
            };
        case 'protection_obligation':
            return {
                ...(entity as ProtectionObligation),
                filledShares: projection.filledShares,
                confirmedExitedShares: projection.confirmedExitedShares,
                protectedShares: projection.protectedShares,
                runtimeTrackedUnprotectedRemainder:
                    projection.runtimeTrackedUnprotectedRemainder,
            };
        case 'entry_exposure_reservation':
            return {
                ...(entity as EntryExposureReservation),
                reservedRemainingShares: projection.reservedRemainingShares,
                consumedShares: projection.consumedShares,
                releasedShares: projection.releasedShares,
            };
        case 'exit_claim':
        case 'external_sell_claim':
            return {
                ...(entity as ExitClaim | ExternalSellClaim),
                activeShares: projection.activeShares,
                consumedShares: projection.consumedShares,
                releasedShares: projection.releasedShares,
            };
    }
}

function applyTransitionProjection(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
    resolutionLink: ResolutionCaseLink | undefined,
): SmartOrderStateEntity {
    const quantityProjected = applyQuantityProjection(entity, request);
    const common = {
        ...quantityProjected,
        state: edge.to,
        revision: entity.revision + 1,
        ...(resolutionLink
            ? { resolutionCaseId: resolutionLink.resolutionCaseId }
            : {}),
    };
    if (entity.entityKind === 'strategy') {
        if (edge.edgeId === 'STR-001') {
            const seal = request.strategyDefinitionSeal!;
            const draftEntity = entity as DraftStrategy;
            const { draftPayloadHash: _discardedDraftHash, ...draft } =
                draftEntity;
            return {
                ...draft,
                state: 'observing',
                revision: entity.revision + 1,
                definitionStatus: 'sealed',
                strategyDefinitionHash: seal.strategyDefinitionHash,
                confirmationSnapshotHash: seal.confirmationSnapshotHash,
                fixedAccountOpaqueRef: seal.fixedAccountOpaqueRef,
                identityGroupOpaqueRef: seal.identityGroupOpaqueRef,
                intendedProvenance: seal.intendedProvenance,
            } as SealedStrategy;
        }
        if (edge.to === 'manual_intervention') {
            return {
                ...common,
                manualResolutionReasonCode: request.reasonCode,
            } as SealedStrategy;
        }
        return common as Strategy;
    }
    if (entity.entityKind === 'activation' && edge.edgeId === 'ACT-005') {
        if (entity.intentPurpose === 'entry') {
            return {
                ...common,
                primaryPlaceIntentId:
                    request.entryProtectionBinding!.entryIntentId,
            } as Activation;
        }
        if (entity.intentPurpose === 'exit') {
            return {
                ...common,
                primaryPlaceIntentId:
                    request.exitProtectionBinding!.exitIntentId,
                winnerLegId: request.exitProtectionBinding!.winnerLegId,
            } as Activation;
        }
        return {
            ...common,
            primaryPlaceIntentId: request.preparedIntentId,
        } as Activation;
    }
    if (entity.entityKind === 'order_intent') {
        if (edge.edgeId === 'INT-002') {
            const dispatch = request.dispatchBinding!;
            return {
                ...common,
                dispatchAttemptNonce: dispatch.dispatchAttemptNonce,
                durableDispatchBlockerId: dispatch.durableDispatchBlockerId,
                runtimeEpochId: dispatch.runtimeEpochId,
                senderFence: dispatch.senderFence,
            } as OrderIntent;
        }
        const brokerCorrelationEdge = [
            'INT-004',
            'INT-007',
            'INT-009',
            'INT-011',
            'INT-014',
        ].includes(edge.edgeId);
        const createdBrokerOrderProjection =
            brokerCorrelationEdge && entity.operation === 'place'
                ? { createdBrokerOrderId: request.correlatedBrokerOrderId! }
                : {};
        if (edge.to === 'terminal') {
            return {
                ...common,
                ...createdBrokerOrderProjection,
                terminalOutcome: request.terminalOutcome,
            } as OrderIntent;
        }
        return {
            ...common,
            ...createdBrokerOrderProjection,
        } as OrderIntent;
    }
    if (
        entity.entityKind === 'broker_order' &&
        edge.edgeId.startsWith('BRO-010')
    ) {
        return {
            ...common,
            controlRevision:
                request.controlReservationBinding!.nextControlRevision,
        } as BrokerOrder;
    }
    if (entity.entityKind === 'runtime_epoch' && edge.edgeId === 'RTE-005') {
        return {
            ...common,
            fullReconciliationCompletedInEpoch: true,
        } as RuntimeEpoch;
    }
    return common as SmartOrderStateEntity;
}

function makeJournal<Kind extends EntityKind>(
    entity: EntityByKind<Kind>,
    edge: StateEdgeDefinition<Kind>,
    request: StateTransitionRequest,
    fromState: EntityStateByKind[Kind] | '__create__',
    fromRevision: number,
    ownerKind: CompanionOwnerKind,
): StateTransitionJournalRecord<Kind> {
    return cloneAndFreeze({
        registryVersion: SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION,
        implementationVersion: SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION,
        reviewedArtifactSha256:
            SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256,
        reasonSchemaVersion: SMART_ORDER_REASON_SCHEMA_VERSION,
        transitionRequestId: request.transitionRequestId,
        requestPayloadHash: request.requestPayloadHash,
        ...(request.targetSideEffectSha256
            ? { targetSideEffectSha256: request.targetSideEffectSha256 }
            : {}),
        ...(request.effectProjectionSha256
            ? { effectProjectionSha256: request.effectProjectionSha256 }
            : {}),
        edgeId: edge.edgeId,
        entityKind: entity.entityKind,
        entityId: entity.entityId,
        lineageId: entity.lineageId,
        lineageGeneration: entity.lineageGeneration,
        fromState,
        toState: edge.to,
        fromRevision,
        toRevision: entity.revision,
        reasonCode: request.reasonCode,
        evidence: request.evidence,
        actorKind: request.actorKind,
        authorizationEvidence: request.authorizationEvidence,
        brokerWriteProvenance: request.brokerWriteProvenance,
        observedWallTime: request.observedWallTime,
        observedWallTimeSource: request.observedWallTimeSource,
        wallTimeTrustStatus: request.wallTimeTrustStatus,
        monotonicLocalSequence: request.monotonicLocalSequence,
        committedAt: request.committedAt,
        runtimeEpochId: request.runtimeEpochId,
        scopeId: request.scopeId,
        atomicTransactionId: request.atomicTransactionId,
        atomicCompanionProofs: request.atomicCompanionProofs,
        resolvedCompanionOwnerKind: ownerKind,
    });
}

export type NewDraftStrategy = Omit<
    DraftStrategy,
    'state' | 'revision' | 'definitionStatus'
>;

export function createDraftStrategy(input: NewDraftStrategy): DraftStrategy {
    const draft = cloneAndFreeze({
        ...input,
        state: 'draft' as const,
        revision: 1,
        definitionStatus: 'draft' as const,
    });
    if (draft.resolutionCaseId !== undefined) {
        fail(
            'lineage_mismatch',
            'new draft Strategy cannot inherit a ResolutionCase',
        );
    }
    validateEntityInvariants(draft);
    return draft;
}

function consumeResolutionDecisionForTransition(
    entity: SmartOrderStateEntity,
    edge: StateEdgeDefinition,
    request: StateTransitionRequest,
): void {
    if (expectedResolutionOperation(edge, request)) {
        if (
            !request.manualResolutionDecision ||
            !consumeVerifiedManualResolutionDecision(
                request.manualResolutionDecision,
            )
        ) {
            fail(
                'resolution_matrix_rejected',
                'manual resolution decision was already consumed or became stale',
            );
        }
        return;
    }
    const blockingOperation = expectedBlockingStateResolutionOperation(
        entity,
        edge,
        request,
    );
    if (
        blockingOperation &&
        (!request.blockingStateResolutionDecision ||
            !consumeVerifiedBlockingStateResolutionDecision(
                request.blockingStateResolutionDecision,
            ))
    ) {
        fail(
            'resolution_matrix_rejected',
            'blocking-state resolution decision was already consumed or became stale',
        );
    }
}

export function createStateEntity<Kind extends EntityKind>(
    input: NewEntityByKind<Kind> & {
        readonly entityKind: Kind;
        readonly entityId: string;
        readonly lineageId: string;
        readonly lineageGeneration: number;
    },
    request: StateTransitionRequest,
): StateTransitionResult<Kind> {
    validateRequestEnvelope(request);
    const inputBase = input as unknown as {
        readonly entityKind: Kind;
        readonly entityId: string;
        readonly lineageId: string;
        readonly lineageGeneration: number;
    };
    if (request.expectedRevision !== 0) {
        fail(
            'state_revision_conflict',
            'create edge requires expectedRevision = 0',
        );
    }
    const edge = getStateEdgeDefinition(inputBase.entityKind, request.edgeId);
    if (!edge || edge.from !== '__create__') {
        fail(
            'edge_not_allowlisted',
            `${inputBase.entityKind}:${request.edgeId} is not an allowlisted create edge`,
        );
    }
    validateEdgeMetadata(edge, request);
    const candidate = {
        ...(input as object),
        state: edge.to,
        revision: 1,
    } as EntityByKind<Kind>;
    const resolutionLink = validateResolutionCaseTransitionLink(
        candidate,
        edge,
        request,
    );
    validateEntitySpecificTransition(candidate, edge, request, resolutionLink);
    validateQuantityProjection(candidate, edge, request);
    const ownerKind = resolveCompanionOwnerKind(
        candidate,
        edge,
        request.companionOwnerKind,
    );
    validateAtomicCompanionProofs(candidate, edge, request, ownerKind);
    if ((candidate as SmartOrderStateEntity).entityKind === 'runtime_epoch') {
        validateRuntimeEpochTransition(
            candidate as EntityByKind<Kind> & RuntimeEpoch,
            edge,
            request,
        );
    }
    validateEntityInvariants(candidate);
    consumeResolutionDecisionForTransition(candidate, edge, request);
    const immutableEntity = cloneAndFreeze(candidate);
    return cloneAndFreeze({
        entity: immutableEntity,
        journal: makeJournal(
            immutableEntity,
            edge,
            request,
            '__create__',
            0,
            ownerKind,
        ),
    });
}

export function transitionStateEntity<Kind extends EntityKind>(
    current: EntityByKind<Kind>,
    request: StateTransitionRequest,
): StateTransitionResult<Kind> {
    validateRequestEnvelope(request);
    validateEntityInvariants(current);
    if (
        (
            STATE_CLASSIFICATION[current.entityKind]
                .terminal as readonly string[]
        ).includes(current.state)
    ) {
        fail(
            'terminal_entity_closed',
            `${current.entityKind}:${current.entityId} is terminal and cannot transition`,
        );
    }
    if (request.expectedRevision !== current.revision) {
        fail(
            'state_revision_conflict',
            `expected revision ${request.expectedRevision}, current ${current.revision}`,
        );
    }
    const edge = getStateEdgeDefinition(current.entityKind, request.edgeId);
    if (!edge || edge.from === '__create__' || edge.from !== current.state) {
        fail(
            'edge_not_allowlisted',
            `${current.entityKind}:${current.state}:${request.edgeId} is not allowlisted`,
        );
    }
    validateEdgeMetadata(edge, request);
    const resolutionLink = validateResolutionCaseTransitionLink(
        current,
        edge,
        request,
    );
    validateEntitySpecificTransition(current, edge, request, resolutionLink);
    validateQuantityProjection(current, edge, request);
    const ownerKind = resolveCompanionOwnerKind(
        current,
        edge,
        request.companionOwnerKind,
    );
    validateAtomicCompanionProofs(current, edge, request, ownerKind);
    if (current.entityKind === 'runtime_epoch') {
        validateRuntimeEpochTransition(current as RuntimeEpoch, edge, request);
    }
    const candidate = applyTransitionProjection(
        current,
        edge,
        request,
        resolutionLink,
    ) as EntityByKind<Kind>;
    validateEntityInvariants(candidate);
    consumeResolutionDecisionForTransition(current, edge, request);
    const immutableEntity = cloneAndFreeze(candidate);
    return cloneAndFreeze({
        entity: immutableEntity,
        journal: makeJournal(
            immutableEntity,
            edge,
            request,
            current.state as EntityStateByKind[Kind],
            current.revision,
            ownerKind,
        ),
    });
}
