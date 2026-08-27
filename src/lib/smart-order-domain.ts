import type {
    CommonLot,
    ContractUnit,
    Share,
} from './smart-order-domain-money';
import {
    commonLots,
    contractUnit,
    decimalString,
    SmartOrderMoneyError,
    shareValue,
    shares,
    sharesFromCommonLots,
} from './smart-order-domain-money';
import type {
    CanonicalContractKey,
    DomainId,
} from './smart-order-domain-types';
import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';

export type {
    CanonicalContractKey,
    DomainId,
} from './smart-order-domain-types';

export const SMART_ORDER_STRATEGY_SCHEMA_VERSION =
    'realtimestock.smart-order-strategy/v1' as const;
export const SMART_ORDER_CONFIRMATION_SCHEMA_VERSION =
    'realtimestock.smart-order-confirmation/v1' as const;
export const SMART_ORDER_DECISION_TABLE_VERSION = '2026-08-11.2' as const;

export type CanonicalValue =
    | null
    | boolean
    | string
    | number
    | readonly CanonicalValue[]
    | CanonicalObject;
export interface CanonicalObject {
    readonly [key: string]: CanonicalValue;
}

export type StrategyKind =
    | 'quick'
    | 'good_till'
    | 'multi_condition'
    | 'parent_child'
    | 'stop_take'
    | 'trailing_exit'
    | 'scheduled_quantity';

export const SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS = {
    quick: 'realtimestock.smart-order-strategy-payload/quick/v1',
    good_till: 'realtimestock.smart-order-strategy-payload/good-till/v1',
    multi_condition:
        'realtimestock.smart-order-strategy-payload/multi-condition/v1',
    parent_child:
        'realtimestock.smart-order-strategy-payload/parent-child/v1',
    stop_take: 'realtimestock.smart-order-strategy-payload/stop-take/v1',
    trailing_exit:
        'realtimestock.smart-order-strategy-payload/trailing-exit/v1',
    scheduled_quantity:
        'realtimestock.smart-order-strategy-payload/scheduled-quantity/v1',
} as const satisfies Readonly<Record<StrategyKind, string>>;

export type QuoteConditionField =
    | 'last_price'
    | 'bid_price'
    | 'ask_price'
    | 'up_amount'
    | 'down_amount'
    | 'up_percent'
    | 'down_percent'
    | 'tick_quantity'
    | 'total_quantity';

export type CanonicalQuoteCondition = Readonly<{
    field: QuoteConditionField;
    comparator: 'gte' | 'lte';
    threshold: string;
    mappingRevision: string;
}>;

export type CanonicalValidityWindow = Readonly<{
    startDate: string;
    endDate: string;
    calendarVersion: string;
}>;

export type CanonicalOrderSpecification = Readonly<{
    contractKey: CanonicalContractKey;
    side: 'Buy' | 'Sell';
    orderCond: 'Cash';
    orderLot: 'Common';
    baseShares: string;
    commonLots: string;
    contractUnit: string;
    priceType: 'LMT' | 'MKT';
    limitPrice: string | null;
    timeInForce: 'ROD' | 'IOC';
    policyRevision: string;
}>;

export type CanonicalDistanceDefinition =
    | Readonly<{ kind: 'absolute'; value: string }>
    | Readonly<{ kind: 'pct_bps'; pctBps: number }>
    | Readonly<{
          kind: 'fixed_atr';
          atr: string;
          multiplier: string;
          atrSnapshotRevision: string;
      }>;

export type QuickStrategyParameters = Readonly<{
    payloadSchemaVersion: (typeof SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS)['quick'];
    monitorContractKey: CanonicalContractKey;
    condition: CanonicalQuoteCondition;
    order: CanonicalOrderSpecification;
    validity: CanonicalValidityWindow;
    activationPolicy: 'require_rearm' | 'immediate_if_true';
}>;

export type GoodTillStrategyParameters = Readonly<{
    payloadSchemaVersion: (typeof SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS)['good_till'];
    monitorContractKey: CanonicalContractKey;
    condition: CanonicalQuoteCondition;
    order: CanonicalOrderSpecification;
    validity: CanonicalValidityWindow;
    activationPolicy: 'require_rearm' | 'immediate_if_true';
    targetBaseShares: string;
    perOrderMaxBaseShares: string;
}>;

export type MultiConditionStrategyParameters = Readonly<{
    payloadSchemaVersion: (typeof SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS)['multi_condition'];
    conditions: readonly Readonly<{
        monitorContractKey: CanonicalContractKey;
        condition: CanonicalQuoteCondition;
    }>[];
    operator: 'AND' | 'OR';
    order: CanonicalOrderSpecification;
    validity: CanonicalValidityWindow;
    activationPolicy: 'require_rearm' | 'immediate_if_true';
}>;

export type ParentChildStrategyParameters = Readonly<{
    payloadSchemaVersion: (typeof SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS)['parent_child'];
    parent: Readonly<{
        monitorContractKey: CanonicalContractKey;
        condition: CanonicalQuoteCondition;
        order: CanonicalOrderSpecification;
    }>;
    child: Readonly<{
        monitorContractKey: CanonicalContractKey;
        condition: CanonicalQuoteCondition;
        order: CanonicalOrderSpecification;
        cutoffTime: string;
    }>;
    parentValidity: CanonicalValidityWindow;
    activationPolicy: 'require_rearm' | 'immediate_if_true';
}>;

export type StopTakeStrategyParameters = Readonly<{
    payloadSchemaVersion: (typeof SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS)['stop_take'];
    positionContractKey: CanonicalContractKey;
    monitorContractKey: CanonicalContractKey;
    positionEvidenceRevision: string;
    basisPrice: string;
    basisSource: 'broker_average_cost' | 'user_specified';
    legs: readonly Readonly<{
        legId: string;
        type: 'stop' | 'take';
        distance: CanonicalDistanceDefinition;
        triggerPrice: string;
        triggerTicks: string;
    }>[];
    order: CanonicalOrderSpecification;
    validity: CanonicalValidityWindow;
    activationPolicy: 'require_rearm' | 'immediate_if_true';
}>;

export type TrailingExitStrategyParameters = Readonly<{
    payloadSchemaVersion: (typeof SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS)['trailing_exit'];
    positionContractKey: CanonicalContractKey;
    monitorContractKey: CanonicalContractKey;
    positionEvidenceRevision: string;
    positionCost: string;
    activationPrice: string;
    retracement: CanonicalDistanceDefinition;
    fixedStopPrice: string | null;
    order: CanonicalOrderSpecification;
    validity: CanonicalValidityWindow;
    activationPolicy: 'require_rearm' | 'immediate_if_true';
}>;

export type ScheduledQuantityStrategyParameters = Readonly<{
    payloadSchemaVersion: (typeof SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS)['scheduled_quantity'];
    mode: 'timed' | 'quantity';
    order: CanonicalOrderSpecification;
    validity: CanonicalValidityWindow;
    targetBaseShares: string;
    startTime: string;
    endTime: string | null;
    intervalSeconds: number;
    perOrderBaseShares: string | null;
    algorithmStatus: 'disabled_unverified';
}>;

export interface StrategyPayloadByKind {
    readonly quick: QuickStrategyParameters;
    readonly good_till: GoodTillStrategyParameters;
    readonly multi_condition: MultiConditionStrategyParameters;
    readonly parent_child: ParentChildStrategyParameters;
    readonly stop_take: StopTakeStrategyParameters;
    readonly trailing_exit: TrailingExitStrategyParameters;
    readonly scheduled_quantity: ScheduledQuantityStrategyParameters;
}

interface StrategyDefinitionBase<
    Kind extends StrategyKind,
    Parameters extends StrategyPayloadByKind[Kind],
> {
    readonly schemaVersion: typeof SMART_ORDER_STRATEGY_SCHEMA_VERSION;
    readonly decisionTableVersion: string;
    readonly kind: Kind;
    readonly parameters: Parameters;
}

export type StrategyDefinition = {
    readonly [Kind in StrategyKind]: StrategyDefinitionBase<
        Kind,
        StrategyPayloadByKind[Kind]
    >;
}[StrategyKind];

export type StrategyId = DomainId<'StrategyId'>;
export type ActivationId = DomainId<'ActivationId'>;
export type OrderIntentId = DomainId<'OrderIntentId'>;
export type BrokerOrderId = DomainId<'BrokerOrderId'>;
export type ProtectionCommitmentId = DomainId<'ProtectionCommitmentId'>;
export type ProtectionObligationId = DomainId<'ProtectionObligationId'>;
export type EntryExposureReservationId = DomainId<'EntryExposureReservationId'>;
export type ExitClaimId = DomainId<'ExitClaimId'>;
export type RuntimeEpochId = DomainId<'RuntimeEpochId'>;
export type FixedAccountRef = DomainId<'FixedAccountRef'>;
export type ClientRequestId = DomainId<'ClientRequestId'>;
export type PayloadHash = `sha256:${string}` & DomainId<'PayloadHash'>;

export function domainId<Name extends string>(
    value: string,
    label: Name,
): DomainId<Name> {
    if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ) {
        throw new SmartOrderDomainError(
            'invalid_identifier',
            `${label} is not a canonical domain identifier`,
        );
    }
    return value as DomainId<Name>;
}

export function clientRequestId(value: string): ClientRequestId {
    if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(value)
    ) {
        throw new SmartOrderDomainError(
            'invalid_client_request_id',
            'client request ID must be 16-128 URL-safe characters',
        );
    }
    return value as ClientRequestId;
}

export function fixedAccountRef(value: string): FixedAccountRef {
    return domainId(value, 'FixedAccountRef');
}

export function canonicalContractKey(value: string): CanonicalContractKey {
    if (
        typeof value !== 'string' ||
        !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value)
    ) {
        throw new SmartOrderDomainError(
            'invalid_identifier',
            'CanonicalContractKey is not a supported TSE/OTC STK key',
        );
    }
    return value as CanonicalContractKey;
}

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
    | 'filled'
    | 'cancelled'
    | 'failed'
    | 'missed'
    | 'unknown';

export type ProtectionLegEvaluationState =
    | 'candidate'
    | 'winner'
    | 'suppressed';

export type OrderIntentState =
    | 'prepared'
    | 'dispatching'
    | 'acknowledged'
    | 'reconciling'
    | 'terminal'
    | 'unknown';

export type BrokerOrderState =
    | 'pending_submit'
    | 'pre_submitted'
    | 'submitted'
    | 'part_filled'
    | 'filled'
    | 'cancelled'
    | 'inactive'
    | 'failed'
    | 'unknown';

export const SMART_ORDER_TRANSITION_REASON_SCHEMA_VERSION =
    'smart-order-transition-reasons/2026-08-11.1' as const;

/** Codes registered by the versioned OpenSpec transition baseline. */
export const SMART_ORDER_TRANSITION_REASONS = [
    'ACKNOWLEDGED_RECONCILIATION_REQUIRED',
    'ACTIVATION_ARMED',
    'ACTIVATION_CANCELLED_BEFORE_TRIGGER',
    'ACTIVATION_ID_CONFLICT',
    'ACTIVATION_VALIDATION_FAILED_PRE_DISPATCH',
    'BROKER_ACCOUNT_MISMATCH',
    'BROKER_ACK_DURABLE',
    'BROKER_CANCELLED_CONFIRMED',
    'BROKER_CORRELATION_AMBIGUOUS',
    'BROKER_FAILED_CONFIRMED',
    'BROKER_FINAL_EVIDENCE_APPLIED',
    'BROKER_FINAL_EVIDENCE_CONFLICT',
    'BROKER_FULL_FILL_CONFIRMED',
    'BROKER_INACTIVE_CONFIRMED',
    'BROKER_ORDER_WORKING_CONFIRMED',
    'BROKER_OUTCOME_UNKNOWN',
    'BROKER_PART_FILL_CONFIRMED',
    'BROKER_PENDING_SUBMIT_OBSERVED',
    'BROKER_PRE_SUBMITTED_OBSERVED',
    'BROKER_RECONCILIATION_EVIDENCE_APPLIED',
    'BROKER_REJECTED_CONFIRMED',
    'BROKER_RESPONSE_LOST_RECONCILE',
    'BROKER_STATE_UNKNOWN',
    'BROKER_SUBMITTED_OBSERVED',
    'BROKER_TARGET_REVISION_CHANGED',
    'BROKER_WORKING_EVIDENCE_APPLIED',
    'CALENDAR_OR_TRUSTED_TIME_UNKNOWN',
    'CONDITION_EDGE_FALSE_TO_TRUE',
    'CONDITION_IMMEDIATE_CONFIRMED',
    'DB_COMMIT_FAILED',
    'DB_INTEGRITY_FAILED',
    'DISPATCH_FENCE_COMMITTED',
    'ENTRY_ACKNOWLEDGED_WAITING_FILL',
    'ENTRY_ADDITIONAL_FILL_MATERIALIZED',
    'ENTRY_DISPATCH_FENCE_COMMITTED',
    'ENTRY_EXPOSURE_RESERVED',
    'ENTRY_FILL_CONFIRMED_MATERIALIZING',
    'ENTRY_FINAL_QUANTITY_MATERIALIZED',
    'ENTRY_RESERVATION_FULLY_CONSUMED',
    'ENTRY_RESERVATION_PARTIALLY_CONSUMED',
    'ENTRY_RESERVATION_RELEASED',
    'ENTRY_RESERVATION_UNKNOWN',
    'ENTRY_RESULT_UNKNOWN',
    'ENTRY_ZERO_FILL_TERMINAL',
    'EXIT_BROKER_WORKING_CONFIRMED',
    'EXIT_CLAIM_BROKER_WORKING',
    'EXIT_CLAIM_CONSUMED_CONFIRMED',
    'EXIT_CLAIM_MONITORING_RESERVED',
    'EXIT_CLAIM_RELEASED_AFTER_TERMINAL',
    'EXIT_CLAIM_RELEASED_UNUSED',
    'EXIT_CLAIM_UNKNOWN',
    'EXIT_INTENT_CANCELLED_PROVEN_UNSENT',
    'EXIT_PART_FILL_CONFIRMED',
    'EXPIRY_DRAIN_COMPLETE',
    'EXTERNAL_POSITION_DRIFT',
    'EXTERNAL_SELL_CLAIM_DISCOVERED',
    'EXTERNAL_WORKING_SET_INCOMPLETE',
    'GATE_MANIFEST_INVALID',
    'IDENTITY_MAPPING_CONFLICT',
    'INTENT_CANCELLED_PROVEN_UNSENT',
    'INTENT_PREPARED_DURABLE',
    'MANUAL_BREAK_GLASS_RELINQUISHED',
    'MANUAL_FINAL_EVIDENCE_APPLIED',
    'MANUAL_RECONCILIATION_STARTED',
    'MANUAL_RESOLUTION_RECONFIRMED',
    'MODE_GENERATION_CHANGED',
    'OCO_SIBLING_SUPPRESSED',
    'OCO_WINNER_SELECTED',
    'POLICY_PAUSE_AUTOMATION',
    'POSITION_OR_UNIT_UNKNOWN',
    'PROTECTION_CLAIM_CREATED_FROM_FILL',
    'PROTECTION_FULLY_EXITED_CONFIRMED',
    'PROTECTION_MONITORING_REVISION_UPDATED',
    'PROTECTION_OBLIGATION_CREATED',
    'PROTECTION_PLAN_CANCELLED_PROVEN_UNSENT',
    'PROTECTION_PLAN_PREPARED_DURABLE',
    'PROTECTION_RECONCILIATION_EVIDENCE_APPLIED',
    'PROTECTION_RECONCILIATION_REQUIRED',
    'PROTECTION_REMAINDER_REARM_REQUIRED',
    'PROTECTION_UNPROTECTED_REMAINDER',
    'QUOTE_GAP_CROSSING_UNKNOWN',
    'READINESS_LOST_RECONCILIATION_REQUIRED',
    'RECOVERY_RECONCILED_REARM_REQUIRED',
    'REQUEST_REPLAY_PAYLOAD_MISMATCH',
    'RISK_POLICY_BLOCKED',
    'RUNTIME_API_GENERATION_SUPERSEDED',
    'RUNTIME_EPOCH_CREATED',
    'RUNTIME_GRACEFUL_STOP_COMPLETE',
    'RUNTIME_QUIESCE_BLOCKED_OBLIGATION',
    'RUNTIME_QUIESCE_REQUESTED',
    'RUNTIME_READINESS_REVOKED',
    'RUNTIME_READY_REARM_REQUIRED',
    'RUNTIME_RECONCILED_OBSERVE_ONLY',
    'RUNTIME_RECONCILIATION_REQUIRED',
    'RUNTIME_RECONCILIATION_STARTED',
    'RUNTIME_SENDER_FAIL_STOP',
    'RUNTIME_SINGLE_WRITER_FENCE_ACQUIRED',
    'RUNTIME_STARTUP_FAIL_CLOSED',
    'SCHEDULE_SLOT_BLOCKED_BY_PRIOR',
    'SCHEDULE_SLOT_MISSED_NOT_READY',
    'SENDER_FENCE_LOST',
    'SIMULATION_ATTESTATION_FAILED',
    'STATE_REVISION_CONFLICT',
    'STATE_TRANSITION_NOT_ALLOWLISTED',
    'STRATEGY_CANCEL_DRAIN_COMPLETE',
    'STRATEGY_TARGET_COMPLETED',
    'TRAILING_GAP_EXTREME_UNKNOWN',
    'USER_CANCEL_STRATEGY_REQUESTED',
    'USER_CONFIRMATION_ACCEPTED',
    'USER_DRAFT_DISCARDED',
    'USER_PAUSE_REQUESTED',
    'USER_RESUME_AND_ARM_CONFIRMED',
    'USER_WRITE_MASTER_ARMED',
    'USER_WRITE_MASTER_DISARMED',
    'VALIDITY_ENDED_NO_OBLIGATION',
    'VALIDITY_ENDED_WITH_OBLIGATION',
    'WORKING_SELL_SET_CHANGED',
] as const;
export type SmartOrderTransitionReason =
    (typeof SMART_ORDER_TRANSITION_REASONS)[number];

export interface TransitionJournalEntry<State extends string> {
    readonly from: State;
    readonly to: State;
    readonly reasonCode: SmartOrderTransitionReason;
    readonly reasonSchemaVersion: typeof SMART_ORDER_TRANSITION_REASON_SCHEMA_VERSION;
    readonly fromRevision: number;
    readonly toRevision: number;
}

interface OptimisticRecord<State extends string> {
    readonly state: State;
    readonly revision: number;
    readonly lastTransition?: TransitionJournalEntry<State>;
}

export interface Strategy extends OptimisticRecord<StrategyState> {
    readonly id: StrategyId;
    readonly definition: StrategyDefinition;
    readonly lineage: Readonly<{
        rootStrategyId: StrategyId;
        copiedFromStrategyId?: StrategyId;
    }>;
    readonly confirmationHash?: PayloadHash;
}

export interface Activation extends OptimisticRecord<ActivationState> {
    readonly id: ActivationId;
    readonly lineage: Readonly<{
        strategyId: StrategyId;
        deterministicActivationKey: string;
    }>;
    /** Present only for a single OCO remainder-generation Activation. */
    readonly protectionSelection?: Readonly<{
        protectionGroupId: string;
        remainderGeneration: number;
        winnerLegId: string;
    }>;
}

/** OCO loser legs are child evaluations, never dispatch-capable Activations. */
export interface ProtectionLegEvaluation
    extends OptimisticRecord<ProtectionLegEvaluationState> {
    readonly id: string;
    readonly activationId: ActivationId;
    readonly protectionGroupId: string;
    readonly remainderGeneration: number;
    readonly legId: string;
}

export interface OrderIntent extends OptimisticRecord<OrderIntentState> {
    readonly id: OrderIntentId;
    readonly lineage: Readonly<{
        strategyId: StrategyId;
        activationId: ActivationId;
        previousIntentId?: OrderIntentId;
    }>;
    readonly sideEffect: 'place' | 'update' | 'cancel';
    readonly clientRequestId: ClientRequestId;
    readonly payloadHash: PayloadHash;
}

export interface BrokerOrder extends OptimisticRecord<BrokerOrderState> {
    readonly id: BrokerOrderId;
    readonly lineage: Readonly<{
        strategyId: StrategyId;
        activationId: ActivationId;
        orderIntentId: OrderIntentId;
    }>;
    readonly fixedAccountRef: FixedAccountRef;
    readonly contractKey: CanonicalContractKey;
    readonly remainingShares: Share;
}

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

export interface PendingProtectionCommitment
    extends OptimisticRecord<PendingProtectionCommitmentState> {
    readonly id: ProtectionCommitmentId;
    readonly lineage: Readonly<{
        strategyId: StrategyId;
        entryIntentId: OrderIntentId;
    }>;
    readonly promisedShares: Share;
}

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

export interface ProtectionObligation
    extends OptimisticRecord<ProtectionObligationState> {
    readonly id: ProtectionObligationId;
    readonly lineage: Readonly<{
        strategyId: StrategyId;
        commitmentId: ProtectionCommitmentId;
    }>;
    readonly filledShares: Share;
    readonly confirmedExitedShares: Share;
    readonly activelyCoveredShares: Share;
}

export type EntryExposureReservationState =
    | 'reserved'
    | 'partially_consumed'
    | 'consumed'
    | 'released'
    | 'unknown';

export interface EntryExposureReservation
    extends OptimisticRecord<EntryExposureReservationState> {
    readonly id: EntryExposureReservationId;
    readonly lineage: Readonly<{
        strategyId: StrategyId;
        orderIntentId: OrderIntentId;
    }>;
    readonly reservedShares: Share;
    readonly policyRevision: number;
}

export type ExitClaimState =
    | 'monitoring_reserved'
    | 'intent_reserved'
    | 'broker_working'
    | 'consumed'
    | 'released'
    | 'unknown';

export interface ExitClaim extends OptimisticRecord<ExitClaimState> {
    readonly id: ExitClaimId;
    readonly claimKind: 'runtime';
    readonly lineage: Readonly<{
        strategyId: StrategyId;
        obligationId: ProtectionObligationId;
        protectionGroupId: string;
        remainderGeneration: number;
    }>;
    readonly fixedAccountRef: FixedAccountRef;
    readonly contractKey: CanonicalContractKey;
    readonly claimedShares: Share;
}

export interface ExternalSellClaim
    extends OptimisticRecord<
        'broker_working' | 'consumed' | 'released' | 'unknown'
    > {
    readonly id: ExitClaimId;
    readonly claimKind: 'external_sell';
    readonly lineage: Readonly<{
        brokerEvidenceKey: string;
        brokerOrderRevision: string;
    }>;
    readonly fixedAccountRef: FixedAccountRef;
    readonly contractKey: CanonicalContractKey;
    readonly claimedShares: Share;
}

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

export interface RuntimeEpoch extends OptimisticRecord<RuntimeEpochState> {
    readonly id: RuntimeEpochId;
    readonly senderEpoch: string;
    readonly apiGeneration: string;
    readonly quoteStreamEpoch: string;
    readonly simulationAttested: boolean;
}

export type SmartOrderDomainErrorCode =
    | 'invalid_identifier'
    | 'invalid_client_request_id'
    | 'invalid_strategy_definition'
    | 'invalid_revision'
    | 'revision_conflict'
    | 'invalid_transition_reason'
    | 'transition_not_allowed'
    | 'legacy_transition_authority_unavailable'
    | 'invalid_confirmation_snapshot'
    | 'non_canonical_value'
    | 'canonical_cycle'
    | 'hash_unavailable';

export class SmartOrderDomainError extends Error {
    readonly code: SmartOrderDomainErrorCode;

    constructor(code: SmartOrderDomainErrorCode, message: string) {
        super(message);
        this.name = 'SmartOrderDomainError';
        this.code = code;
    }
}

type StrictUnknownRecord = Record<string, unknown>;

function invalidStrategy(message: string): never {
    throw new SmartOrderDomainError('invalid_strategy_definition', message);
}

function strictRecord(
    value: unknown,
    label: string,
    expectedKeys: readonly string[],
): StrictUnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return invalidStrategy(`${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return invalidStrategy(`${label} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        return invalidStrategy(`${label} cannot contain symbol fields`);
    }
    const keys = Object.getOwnPropertyNames(value).sort();
    const expected = [...expectedKeys].sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index])
    ) {
        return invalidStrategy(
            `${label} must contain exactly: ${expected.join(', ')}`,
        );
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
            return invalidStrategy(
                `${label}.${key} must be an enumerable data field`,
            );
        }
    }
    return value as StrictUnknownRecord;
}

function strictArray(
    value: unknown,
    label: string,
    minimumLength: number,
    maximumLength: number,
): readonly unknown[] {
    if (!Array.isArray(value)) {
        return invalidStrategy(`${label} must be an array`);
    }
    if (value.length < minimumLength || value.length > maximumLength) {
        return invalidStrategy(
            `${label} must contain ${minimumLength}-${maximumLength} entries`,
        );
    }
    const keys = Object.getOwnPropertyNames(value).filter(
        (key) => key !== 'length',
    );
    if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
    ) {
        return invalidStrategy(`${label} must be dense and have no extra fields`);
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
            return invalidStrategy(
                `${label}[${key}] must be an enumerable data field`,
            );
        }
    }
    return value;
}

function strictEnum<Value extends string>(
    value: unknown,
    allowed: readonly Value[],
    label: string,
): Value {
    if (typeof value !== 'string' || !allowed.includes(value as Value)) {
        return invalidStrategy(`${label} is outside the versioned schema`);
    }
    return value as Value;
}

function strictRevision(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
    ) {
        return invalidStrategy(`${label} must be a canonical revision`);
    }
    return value;
}

function strictPositiveIntegerText(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        value.length > 19 ||
        !/^[1-9]\d*$/.test(value) ||
        BigInt(value) > 9_223_372_036_854_775_807n
    ) {
        return invalidStrategy(`${label} must be a positive integer string`);
    }
    return value;
}

function strictCanonicalDecimal(
    value: unknown,
    label: string,
    positive = false,
): string {
    if (typeof value !== 'string') {
        return invalidStrategy(`${label} must be a canonical decimal string`);
    }
    try {
        const canonical = decimalString(value);
        if (canonical !== value || (positive && canonical === '0')) {
            return invalidStrategy(
                `${label} must be a ${positive ? 'positive ' : ''}canonical decimal string`,
            );
        }
    } catch (error) {
        if (!(error instanceof SmartOrderMoneyError)) throw error;
        return invalidStrategy(`${label} must be a canonical decimal string`);
    }
    return value;
}

function strictContractKey(
    value: unknown,
    label: string,
): CanonicalContractKey {
    if (typeof value !== 'string') {
        return invalidStrategy(`${label} must be a canonical contract key`);
    }
    try {
        return canonicalContractKey(value);
    } catch (error) {
        if (!(error instanceof SmartOrderDomainError)) throw error;
        return invalidStrategy(`${label} must be a canonical contract key`);
    }
}

function validateQuantityTuple(
    baseSharesText: unknown,
    commonLotsText: unknown,
    contractUnitText: unknown,
    label: string,
): Readonly<{
    baseShares: string;
    commonLots: string;
    contractUnit: string;
}> {
    const baseShares = strictPositiveIntegerText(
        baseSharesText,
        `${label}.baseShares`,
    );
    const commonLotsTextValue = strictPositiveIntegerText(
        commonLotsText,
        `${label}.commonLots`,
    );
    const contractUnitTextValue = strictPositiveIntegerText(
        contractUnitText,
        `${label}.contractUnit`,
    );
    try {
        const converted = sharesFromCommonLots(
            commonLots(commonLotsTextValue),
            contractUnit(contractUnitTextValue),
        );
        if (shareValue(converted) !== shareValue(shares(baseShares))) {
            return invalidStrategy(
                `${label} must satisfy baseShares = commonLots * contractUnit`,
            );
        }
    } catch (error) {
        if (!(error instanceof SmartOrderMoneyError)) throw error;
        return invalidStrategy(`${label} contains an invalid quantity tuple`);
    }
    return {
        baseShares,
        commonLots: commonLotsTextValue,
        contractUnit: contractUnitTextValue,
    };
}

function parseQuoteCondition(
    value: unknown,
    label: string,
): CanonicalQuoteCondition {
    const record = strictRecord(value, label, [
        'field',
        'comparator',
        'threshold',
        'mappingRevision',
    ]);
    strictEnum(
        record.field,
        [
            'last_price',
            'bid_price',
            'ask_price',
            'up_amount',
            'down_amount',
            'up_percent',
            'down_percent',
            'tick_quantity',
            'total_quantity',
        ] as const,
        `${label}.field`,
    );
    strictEnum(record.comparator, ['gte', 'lte'] as const, `${label}.comparator`);
    strictCanonicalDecimal(record.threshold, `${label}.threshold`);
    strictRevision(record.mappingRevision, `${label}.mappingRevision`);
    return record as CanonicalQuoteCondition;
}

function parseValidityWindow(
    value: unknown,
    label: string,
): CanonicalValidityWindow {
    const record = strictRecord(value, label, [
        'startDate',
        'endDate',
        'calendarVersion',
    ]);
    for (const field of ['startDate', 'endDate'] as const) {
        if (
            typeof record[field] !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(record[field])
        ) {
            return invalidStrategy(`${label}.${field} must be an ISO date`);
        }
    }
    strictRevision(record.calendarVersion, `${label}.calendarVersion`);
    return record as CanonicalValidityWindow;
}

function parseOrderSpecification(
    value: unknown,
    label: string,
): CanonicalOrderSpecification {
    const record = strictRecord(value, label, [
        'contractKey',
        'side',
        'orderCond',
        'orderLot',
        'baseShares',
        'commonLots',
        'contractUnit',
        'priceType',
        'limitPrice',
        'timeInForce',
        'policyRevision',
    ]);
    strictContractKey(record.contractKey, `${label}.contractKey`);
    strictEnum(record.side, ['Buy', 'Sell'] as const, `${label}.side`);
    strictEnum(record.orderCond, ['Cash'] as const, `${label}.orderCond`);
    strictEnum(record.orderLot, ['Common'] as const, `${label}.orderLot`);
    validateQuantityTuple(
        record.baseShares,
        record.commonLots,
        record.contractUnit,
        label,
    );
    const priceType = strictEnum(
        record.priceType,
        ['LMT', 'MKT'] as const,
        `${label}.priceType`,
    );
    if (priceType === 'LMT') {
        strictCanonicalDecimal(record.limitPrice, `${label}.limitPrice`, true);
    } else if (record.limitPrice !== null) {
        return invalidStrategy(`${label}.limitPrice must be null for MKT`);
    }
    strictEnum(
        record.timeInForce,
        ['ROD', 'IOC'] as const,
        `${label}.timeInForce`,
    );
    strictRevision(record.policyRevision, `${label}.policyRevision`);
    return record as CanonicalOrderSpecification;
}

function parseDistanceDefinition(
    value: unknown,
    label: string,
): CanonicalDistanceDefinition {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return invalidStrategy(`${label} must be a distance object`);
    }
    const kind = (value as StrictUnknownRecord).kind;
    if (kind === 'absolute') {
        const record = strictRecord(value, label, ['kind', 'value']);
        strictCanonicalDecimal(record.value, `${label}.value`, true);
        return record as CanonicalDistanceDefinition;
    }
    if (kind === 'pct_bps') {
        const record = strictRecord(value, label, ['kind', 'pctBps']);
        if (
            !Number.isSafeInteger(record.pctBps) ||
            (record.pctBps as number) < 1 ||
            (record.pctBps as number) > 9_999
        ) {
            return invalidStrategy(`${label}.pctBps must be 1-9999`);
        }
        return record as CanonicalDistanceDefinition;
    }
    if (kind === 'fixed_atr') {
        const record = strictRecord(value, label, [
            'kind',
            'atr',
            'multiplier',
            'atrSnapshotRevision',
        ]);
        strictCanonicalDecimal(record.atr, `${label}.atr`, true);
        strictCanonicalDecimal(record.multiplier, `${label}.multiplier`, true);
        strictRevision(
            record.atrSnapshotRevision,
            `${label}.atrSnapshotRevision`,
        );
        return record as CanonicalDistanceDefinition;
    }
    return invalidStrategy(`${label}.kind is outside the versioned schema`);
}

function parseStrategyParameters(
    kind: StrategyKind,
    value: unknown,
): StrategyPayloadByKind[StrategyKind] {
    const payloadLabel = `${kind} parameters`;
    const requirePayloadVersion = (
        record: StrictUnknownRecord,
        expected: string,
    ): void => {
        if (record.payloadSchemaVersion !== expected) {
            invalidStrategy(
                `${payloadLabel}.payloadSchemaVersion is not ${expected}`,
            );
        }
    };
    const parseActivationPolicy = (record: StrictUnknownRecord): void => {
        strictEnum(
            record.activationPolicy,
            ['require_rearm', 'immediate_if_true'] as const,
            `${payloadLabel}.activationPolicy`,
        );
    };

    switch (kind) {
        case 'quick': {
            const record = strictRecord(value, payloadLabel, [
                'payloadSchemaVersion',
                'monitorContractKey',
                'condition',
                'order',
                'validity',
                'activationPolicy',
            ]);
            requirePayloadVersion(
                record,
                SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.quick,
            );
            const monitor = strictContractKey(
                record.monitorContractKey,
                `${payloadLabel}.monitorContractKey`,
            );
            parseQuoteCondition(record.condition, `${payloadLabel}.condition`);
            const order = parseOrderSpecification(
                record.order,
                `${payloadLabel}.order`,
            );
            if (monitor !== order.contractKey) {
                invalidStrategy('quick monitor and order contract must match');
            }
            parseValidityWindow(record.validity, `${payloadLabel}.validity`);
            parseActivationPolicy(record);
            return record as QuickStrategyParameters;
        }
        case 'good_till': {
            const record = strictRecord(value, payloadLabel, [
                'payloadSchemaVersion',
                'monitorContractKey',
                'condition',
                'order',
                'validity',
                'activationPolicy',
                'targetBaseShares',
                'perOrderMaxBaseShares',
            ]);
            requirePayloadVersion(
                record,
                SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.good_till,
            );
            strictContractKey(
                record.monitorContractKey,
                `${payloadLabel}.monitorContractKey`,
            );
            parseQuoteCondition(record.condition, `${payloadLabel}.condition`);
            parseOrderSpecification(record.order, `${payloadLabel}.order`);
            parseValidityWindow(record.validity, `${payloadLabel}.validity`);
            parseActivationPolicy(record);
            const target = strictPositiveIntegerText(
                record.targetBaseShares,
                `${payloadLabel}.targetBaseShares`,
            );
            const perOrder = strictPositiveIntegerText(
                record.perOrderMaxBaseShares,
                `${payloadLabel}.perOrderMaxBaseShares`,
            );
            if (BigInt(perOrder) > BigInt(target)) {
                invalidStrategy('good_till per-order maximum exceeds target');
            }
            return record as GoodTillStrategyParameters;
        }
        case 'multi_condition': {
            const record = strictRecord(value, payloadLabel, [
                'payloadSchemaVersion',
                'conditions',
                'operator',
                'order',
                'validity',
                'activationPolicy',
            ]);
            requirePayloadVersion(
                record,
                SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.multi_condition,
            );
            strictArray(record.conditions, `${payloadLabel}.conditions`, 1, 7).forEach(
                (entry, index) => {
                    const conditionLeg = strictRecord(
                        entry,
                        `${payloadLabel}.conditions[${index}]`,
                        ['monitorContractKey', 'condition'],
                    );
                    strictContractKey(
                        conditionLeg.monitorContractKey,
                        `${payloadLabel}.conditions[${index}].monitorContractKey`,
                    );
                    parseQuoteCondition(
                        conditionLeg.condition,
                        `${payloadLabel}.conditions[${index}].condition`,
                    );
                },
            );
            strictEnum(record.operator, ['AND', 'OR'] as const, `${payloadLabel}.operator`);
            parseOrderSpecification(record.order, `${payloadLabel}.order`);
            parseValidityWindow(record.validity, `${payloadLabel}.validity`);
            parseActivationPolicy(record);
            return record as MultiConditionStrategyParameters;
        }
        case 'parent_child': {
            const record = strictRecord(value, payloadLabel, [
                'payloadSchemaVersion',
                'parent',
                'child',
                'parentValidity',
                'activationPolicy',
            ]);
            requirePayloadVersion(
                record,
                SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.parent_child,
            );
            const parseLeg = (
                legValue: unknown,
                legName: 'parent' | 'child',
            ): CanonicalOrderSpecification => {
                const keys =
                    legName === 'parent'
                        ? ['monitorContractKey', 'condition', 'order']
                        : [
                              'monitorContractKey',
                              'condition',
                              'order',
                              'cutoffTime',
                          ];
                const leg = strictRecord(
                    legValue,
                    `${payloadLabel}.${legName}`,
                    keys,
                );
                const monitor = strictContractKey(
                    leg.monitorContractKey,
                    `${payloadLabel}.${legName}.monitorContractKey`,
                );
                parseQuoteCondition(
                    leg.condition,
                    `${payloadLabel}.${legName}.condition`,
                );
                const order = parseOrderSpecification(
                    leg.order,
                    `${payloadLabel}.${legName}.order`,
                );
                if (monitor !== order.contractKey) {
                    invalidStrategy(
                        `${legName} monitor and order contract must match`,
                    );
                }
                if (legName === 'child') {
                    if (
                        typeof leg.cutoffTime !== 'string' ||
                        !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(
                            leg.cutoffTime,
                        )
                    ) {
                        invalidStrategy('child.cutoffTime must be HH:mm:ss');
                    }
                }
                return order;
            };
            const parentOrder = parseLeg(record.parent, 'parent');
            const childOrder = parseLeg(record.child, 'child');
            if (parentOrder.side !== 'Buy' || childOrder.side !== 'Sell') {
                invalidStrategy('parent_child v1 requires Buy parent and Sell child');
            }
            parseValidityWindow(
                record.parentValidity,
                `${payloadLabel}.parentValidity`,
            );
            parseActivationPolicy(record);
            return record as ParentChildStrategyParameters;
        }
        case 'stop_take': {
            const record = strictRecord(value, payloadLabel, [
                'payloadSchemaVersion',
                'positionContractKey',
                'monitorContractKey',
                'positionEvidenceRevision',
                'basisPrice',
                'basisSource',
                'legs',
                'order',
                'validity',
                'activationPolicy',
            ]);
            requirePayloadVersion(
                record,
                SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.stop_take,
            );
            const positionContract = strictContractKey(
                record.positionContractKey,
                `${payloadLabel}.positionContractKey`,
            );
            const monitorContract = strictContractKey(
                record.monitorContractKey,
                `${payloadLabel}.monitorContractKey`,
            );
            strictRevision(
                record.positionEvidenceRevision,
                `${payloadLabel}.positionEvidenceRevision`,
            );
            strictCanonicalDecimal(record.basisPrice, `${payloadLabel}.basisPrice`, true);
            strictEnum(
                record.basisSource,
                ['broker_average_cost', 'user_specified'] as const,
                `${payloadLabel}.basisSource`,
            );
            const legTypes = new Set<string>();
            const legIds = new Set<string>();
            strictArray(record.legs, `${payloadLabel}.legs`, 1, 2).forEach(
                (entry, index) => {
                    const leg = strictRecord(
                        entry,
                        `${payloadLabel}.legs[${index}]`,
                        [
                            'legId',
                            'type',
                            'distance',
                            'triggerPrice',
                            'triggerTicks',
                        ],
                    );
                    const legId = strictRevision(
                        leg.legId,
                        `${payloadLabel}.legs[${index}].legId`,
                    );
                    if (legIds.has(legId)) {
                        invalidStrategy('stop_take legs must have unique legId values');
                    }
                    legIds.add(legId);
                    const legType = strictEnum(
                        leg.type,
                        ['stop', 'take'] as const,
                        `${payloadLabel}.legs[${index}].type`,
                    );
                    if (legTypes.has(legType)) {
                        invalidStrategy('stop_take legs must have unique types');
                    }
                    legTypes.add(legType);
                    parseDistanceDefinition(
                        leg.distance,
                        `${payloadLabel}.legs[${index}].distance`,
                    );
                    strictCanonicalDecimal(
                        leg.triggerPrice,
                        `${payloadLabel}.legs[${index}].triggerPrice`,
                        true,
                    );
                    strictPositiveIntegerText(
                        leg.triggerTicks,
                        `${payloadLabel}.legs[${index}].triggerTicks`,
                    );
                },
            );
            const order = parseOrderSpecification(record.order, `${payloadLabel}.order`);
            if (
                positionContract !== monitorContract ||
                positionContract !== order.contractKey ||
                order.side !== 'Sell'
            ) {
                invalidStrategy(
                    'stop_take v1 requires one position/monitor/order contract and Sell',
                );
            }
            parseValidityWindow(record.validity, `${payloadLabel}.validity`);
            parseActivationPolicy(record);
            return record as StopTakeStrategyParameters;
        }
        case 'trailing_exit': {
            const record = strictRecord(value, payloadLabel, [
                'payloadSchemaVersion',
                'positionContractKey',
                'monitorContractKey',
                'positionEvidenceRevision',
                'positionCost',
                'activationPrice',
                'retracement',
                'fixedStopPrice',
                'order',
                'validity',
                'activationPolicy',
            ]);
            requirePayloadVersion(
                record,
                SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.trailing_exit,
            );
            const positionContract = strictContractKey(
                record.positionContractKey,
                `${payloadLabel}.positionContractKey`,
            );
            const monitorContract = strictContractKey(
                record.monitorContractKey,
                `${payloadLabel}.monitorContractKey`,
            );
            strictRevision(
                record.positionEvidenceRevision,
                `${payloadLabel}.positionEvidenceRevision`,
            );
            strictCanonicalDecimal(record.positionCost, `${payloadLabel}.positionCost`, true);
            strictCanonicalDecimal(
                record.activationPrice,
                `${payloadLabel}.activationPrice`,
                true,
            );
            parseDistanceDefinition(record.retracement, `${payloadLabel}.retracement`);
            if (record.fixedStopPrice !== null) {
                strictCanonicalDecimal(
                    record.fixedStopPrice,
                    `${payloadLabel}.fixedStopPrice`,
                    true,
                );
            }
            const order = parseOrderSpecification(record.order, `${payloadLabel}.order`);
            if (
                positionContract !== monitorContract ||
                positionContract !== order.contractKey ||
                order.side !== 'Sell'
            ) {
                invalidStrategy(
                    'trailing_exit v1 requires one position/monitor/order contract and Sell',
                );
            }
            parseValidityWindow(record.validity, `${payloadLabel}.validity`);
            parseActivationPolicy(record);
            return record as TrailingExitStrategyParameters;
        }
        case 'scheduled_quantity': {
            const record = strictRecord(value, payloadLabel, [
                'payloadSchemaVersion',
                'mode',
                'order',
                'validity',
                'targetBaseShares',
                'startTime',
                'endTime',
                'intervalSeconds',
                'perOrderBaseShares',
                'algorithmStatus',
            ]);
            requirePayloadVersion(
                record,
                SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.scheduled_quantity,
            );
            strictEnum(record.mode, ['timed', 'quantity'] as const, `${payloadLabel}.mode`);
            parseOrderSpecification(record.order, `${payloadLabel}.order`);
            const scheduledValidity = parseValidityWindow(
                record.validity,
                `${payloadLabel}.validity`,
            );
            if (scheduledValidity.startDate !== scheduledValidity.endDate) {
                invalidStrategy(
                    'scheduled_quantity is limited to one trading date',
                );
            }
            strictPositiveIntegerText(
                record.targetBaseShares,
                `${payloadLabel}.targetBaseShares`,
            );
            for (const field of ['startTime', 'endTime'] as const) {
                const fieldValue = record[field];
                if (
                    fieldValue !== null &&
                    (typeof fieldValue !== 'string' ||
                        !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(
                            fieldValue,
                        ))
                ) {
                    invalidStrategy(`${payloadLabel}.${field} must be HH:mm:ss or null`);
                }
            }
            if (
                typeof record.startTime !== 'string' ||
                !Number.isSafeInteger(record.intervalSeconds) ||
                (record.intervalSeconds as number) <= 0
            ) {
                invalidStrategy(
                    `${payloadLabel} requires startTime and a positive intervalSeconds`,
                );
            }
            if (record.perOrderBaseShares !== null) {
                strictPositiveIntegerText(
                    record.perOrderBaseShares,
                    `${payloadLabel}.perOrderBaseShares`,
                );
            }
            if (
                (record.mode === 'timed' &&
                    (record.endTime === null ||
                        record.perOrderBaseShares !== null)) ||
                (record.mode === 'quantity' &&
                    (record.endTime !== null ||
                        record.perOrderBaseShares === null))
            ) {
                invalidStrategy(
                    'scheduled_quantity mode fields do not match the approved disabled decision table',
                );
            }
            strictEnum(
                record.algorithmStatus,
                ['disabled_unverified'] as const,
                `${payloadLabel}.algorithmStatus`,
            );
            return record as ScheduledQuantityStrategyParameters;
        }
    }
}

function deepFreezeCanonicalTree(value: unknown): void {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
        return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
        deepFreezeCanonicalTree(child);
    }
    Object.freeze(value);
}

function immutableCanonicalClone<Value>(value: Value): Value {
    const clone = JSON.parse(
        stableSerializeCanonical(value as unknown as CanonicalValue),
    ) as Value;
    deepFreezeCanonicalTree(clone);
    return clone;
}

export function parseStrategyDefinition(input: unknown): StrategyDefinition {
    const record = strictRecord(input, 'strategy definition', [
        'schemaVersion',
        'decisionTableVersion',
        'kind',
        'parameters',
    ]);
    if (record.schemaVersion !== SMART_ORDER_STRATEGY_SCHEMA_VERSION) {
        invalidStrategy('strategy schema version is unsupported');
    }
    if (record.decisionTableVersion !== SMART_ORDER_DECISION_TABLE_VERSION) {
        invalidStrategy('strategy decision table version is unsupported');
    }
    const kind = strictEnum(
        record.kind,
        [
            'quick',
            'good_till',
            'multi_condition',
            'parent_child',
            'stop_take',
            'trailing_exit',
            'scheduled_quantity',
        ] as const,
        'strategy kind',
    );
    parseStrategyParameters(kind, record.parameters);
    return immutableCanonicalClone(record) as unknown as StrategyDefinition;
}

const STRATEGY_TRANSITIONS: Readonly<
    Record<StrategyState, readonly StrategyState[]>
> = {
    draft: ['observing', 'cancelled'],
    observing: [
        'monitoring',
        'paused',
        'recovery',
        'manual_intervention',
        'cancel_pending',
        'expired',
    ],
    monitoring: [
        'paused',
        'recovery',
        'manual_intervention',
        'cancel_pending',
        'completed',
        'expired_with_obligation',
    ],
    paused: [
        'monitoring',
        'recovery',
        'manual_intervention',
        'cancel_pending',
        'completed',
        'expired',
        'expired_with_obligation',
    ],
    recovery: [
        'paused',
        'manual_intervention',
        'cancel_pending',
        'expired_with_obligation',
    ],
    // Resolution is deliberately closed until task 1.14 provides a
    // reason-specific manual-intervention resolution matrix.
    manual_intervention: [],
    cancel_pending: [
        'cancelled',
        'manual_intervention',
        'expired_with_obligation',
    ],
    expired_with_obligation: ['expired', 'manual_intervention'],
    completed: [],
    cancelled: [],
    expired: [],
};

const ACTIVATION_TRANSITIONS: Readonly<
    Record<ActivationState, readonly ActivationState[]>
> = {
    armed: ['triggered', 'missed', 'cancelled'],
    triggered: ['prepared', 'failed'],
    prepared: ['dispatching', 'cancelled'],
    dispatching: [
        'working',
        'part_filled',
        'filled',
        'cancelled',
        'failed',
        'unknown',
    ],
    working: ['part_filled', 'filled', 'cancelled', 'failed', 'unknown'],
    part_filled: [
        'part_filled',
        'filled',
        'cancelled',
        'failed',
        'unknown',
    ],
    unknown: ['working', 'part_filled', 'filled', 'cancelled', 'failed'],
    filled: [],
    cancelled: [],
    failed: [],
    missed: [],
};

const PROTECTION_LEG_EVALUATION_TRANSITIONS: Readonly<
    Record<
        ProtectionLegEvaluationState,
        readonly ProtectionLegEvaluationState[]
    >
> = {
    candidate: ['winner', 'suppressed'],
    winner: [],
    suppressed: [],
};

const ORDER_INTENT_TRANSITIONS: Readonly<
    Record<OrderIntentState, readonly OrderIntentState[]>
> = {
    prepared: ['dispatching', 'terminal'],
    dispatching: ['acknowledged', 'reconciling', 'terminal', 'unknown'],
    acknowledged: ['reconciling', 'terminal'],
    reconciling: ['acknowledged', 'terminal', 'unknown'],
    unknown: ['reconciling', 'terminal'],
    terminal: [],
};

const BROKER_ORDER_TRANSITIONS: Readonly<
    Record<BrokerOrderState, readonly BrokerOrderState[]>
> = {
    pending_submit: [
        'pre_submitted',
        'submitted',
        'part_filled',
        'filled',
        'cancelled',
        'inactive',
        'failed',
        'unknown',
    ],
    pre_submitted: [
        'submitted',
        'part_filled',
        'filled',
        'cancelled',
        'inactive',
        'failed',
        'unknown',
    ],
    submitted: [
        'part_filled',
        'filled',
        'cancelled',
        'inactive',
        'failed',
        'unknown',
    ],
    part_filled: [
        'part_filled',
        'filled',
        'cancelled',
        'inactive',
        'failed',
        'unknown',
    ],
    unknown: [
        'pending_submit',
        'pre_submitted',
        'submitted',
        'part_filled',
        'filled',
        'cancelled',
        'inactive',
        'failed',
    ],
    filled: [],
    cancelled: [],
    inactive: [],
    failed: [],
};

const PENDING_PROTECTION_COMMITMENT_TRANSITIONS: Readonly<
    Record<
        PendingProtectionCommitmentState,
        readonly PendingProtectionCommitmentState[]
    >
> = {
    prepared: ['entry_dispatching', 'released_pre_dispatch'],
    entry_dispatching: [
        'waiting_entry_result',
        'materializing',
        'unknown',
    ],
    waiting_entry_result: [
        'materializing',
        'materialized',
        'zero_fill_terminal',
        'unknown',
    ],
    materializing: [
        'materializing',
        'materialized',
        'zero_fill_terminal',
        'unknown',
    ],
    unknown: [
        'materializing',
        'materialized',
        'zero_fill_terminal',
        'released_manual',
    ],
    materialized: [],
    zero_fill_terminal: [],
    released_pre_dispatch: [],
    released_manual: [],
};

const PROTECTION_OBLIGATION_TRANSITIONS: Readonly<
    Record<ProtectionObligationState, readonly ProtectionObligationState[]>
> = {
    pending_entry: [
        'monitoring',
        'reconciling',
        'safety_blocked',
        'zero_fill_terminal',
    ],
    monitoring: [
        'monitoring',
        'exit_dispatching',
        'reconciling',
        'safety_blocked',
    ],
    exit_dispatching: [
        'exit_working',
        'partially_exited',
        'fulfilled',
        'safety_blocked',
    ],
    exit_working: [
        'partially_exited',
        'fulfilled',
        'safety_blocked',
    ],
    partially_exited: [
        'monitoring',
        'fulfilled',
        'safety_blocked',
    ],
    reconciling: [
        'pending_entry',
        'monitoring',
        'exit_working',
        'partially_exited',
        'fulfilled',
        'zero_fill_terminal',
        'safety_blocked',
    ],
    // A ResolutionCase must resolve the associated SafetyBlocker; this entity
    // cannot be resumed directly by a generic transition helper.
    safety_blocked: [],
    fulfilled: [],
    zero_fill_terminal: [],
    released_manual: [],
};

const ENTRY_EXPOSURE_RESERVATION_TRANSITIONS: Readonly<
    Record<
        EntryExposureReservationState,
        readonly EntryExposureReservationState[]
    >
> = {
    reserved: ['partially_consumed', 'consumed', 'released', 'unknown'],
    partially_consumed: [
        'partially_consumed',
        'consumed',
        'released',
        'unknown',
    ],
    unknown: ['partially_consumed', 'consumed', 'released'],
    consumed: [],
    released: [],
};

const EXIT_CLAIM_TRANSITIONS: Readonly<
    Record<ExitClaimState, readonly ExitClaimState[]>
> = {
    monitoring_reserved: ['intent_reserved', 'released'],
    intent_reserved: ['broker_working', 'released', 'unknown'],
    broker_working: ['consumed', 'released', 'unknown'],
    unknown: ['broker_working', 'consumed', 'released'],
    consumed: [],
    released: [],
};

const EXTERNAL_SELL_CLAIM_TRANSITIONS: Readonly<
    Record<
        ExternalSellClaim['state'],
        readonly ExternalSellClaim['state'][]
    >
> = {
    broker_working: ['consumed', 'released', 'unknown'],
    unknown: ['broker_working', 'consumed', 'released'],
    consumed: [],
    released: [],
};

const RUNTIME_EPOCH_TRANSITIONS: Readonly<
    Record<RuntimeEpochState, readonly RuntimeEpochState[]>
> = {
    starting: ['fenced', 'quiescing', 'failed_stop', 'superseded'],
    fenced: [
        'reconciling',
        'quiescing',
        'failed_stop',
        'superseded',
    ],
    reconciling: [
        'observe_only',
        'quiescing',
        'failed_stop',
        'superseded',
    ],
    observe_only: [
        'ready_unarmed',
        'reconciling',
        'quiescing',
        'failed_stop',
        'superseded',
    ],
    ready_unarmed: [
        'write_armed',
        'observe_only',
        'reconciling',
        'quiescing',
        'failed_stop',
        'superseded',
    ],
    write_armed: [
        'ready_unarmed',
        'observe_only',
        'reconciling',
        'quiescing',
        'failed_stop',
        'superseded',
    ],
    quiescing: ['stopped', 'observe_only', 'failed_stop', 'superseded'],
    stopped: [],
    failed_stop: [],
    superseded: [],
};

/**
 * @deprecated This compatibility surface is a permanent hard-fail stub.
 * The typed registry in smart-order-state-machine is the sole transition
 * authority; callers cannot obtain authority through adjacency-only inputs.
 */
function transitionRecord<State extends string, RecordType extends OptimisticRecord<State>>(
    _record: RecordType,
    _nextState: State,
    _options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
    _allowlist: Readonly<Record<State, readonly State[]>>,
): RecordType {
    throw new SmartOrderDomainError(
        'legacy_transition_authority_unavailable',
        'legacy adjacency-only transition helpers are permanently disabled; use smart-order-state-machine typed transitions',
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionStrategy(
    record: Strategy,
    nextState: StrategyState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): Strategy {
    return transitionRecord(record, nextState, options, STRATEGY_TRANSITIONS);
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionActivation(
    record: Activation,
    nextState: ActivationState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): Activation {
    return transitionRecord(record, nextState, options, ACTIVATION_TRANSITIONS);
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionProtectionLegEvaluation(
    record: ProtectionLegEvaluation,
    nextState: ProtectionLegEvaluationState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): ProtectionLegEvaluation {
    return transitionRecord(
        record,
        nextState,
        options,
        PROTECTION_LEG_EVALUATION_TRANSITIONS,
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionOrderIntent(
    record: OrderIntent,
    nextState: OrderIntentState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): OrderIntent {
    return transitionRecord(
        record,
        nextState,
        options,
        ORDER_INTENT_TRANSITIONS,
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionBrokerOrder(
    record: BrokerOrder,
    nextState: BrokerOrderState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): BrokerOrder {
    return transitionRecord(
        record,
        nextState,
        options,
        BROKER_ORDER_TRANSITIONS,
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionPendingProtectionCommitment(
    record: PendingProtectionCommitment,
    nextState: PendingProtectionCommitmentState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): PendingProtectionCommitment {
    return transitionRecord(
        record,
        nextState,
        options,
        PENDING_PROTECTION_COMMITMENT_TRANSITIONS,
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionProtectionObligation(
    record: ProtectionObligation,
    nextState: ProtectionObligationState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): ProtectionObligation {
    return transitionRecord(
        record,
        nextState,
        options,
        PROTECTION_OBLIGATION_TRANSITIONS,
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionEntryExposureReservation(
    record: EntryExposureReservation,
    nextState: EntryExposureReservationState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): EntryExposureReservation {
    return transitionRecord(
        record,
        nextState,
        options,
        ENTRY_EXPOSURE_RESERVATION_TRANSITIONS,
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionExitClaim(
    record: ExitClaim,
    nextState: ExitClaimState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): ExitClaim {
    return transitionRecord(record, nextState, options, EXIT_CLAIM_TRANSITIONS);
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionExternalSellClaim(
    record: ExternalSellClaim,
    nextState: ExternalSellClaim['state'],
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): ExternalSellClaim {
    return transitionRecord(
        record,
        nextState,
        options,
        EXTERNAL_SELL_CLAIM_TRANSITIONS,
    );
}

/** @deprecated Permanently unavailable; use transitionStateEntity. */
export function transitionRuntimeEpoch(
    record: RuntimeEpoch,
    nextState: RuntimeEpochState,
    options: Readonly<{
        expectedRevision: number;
        reasonCode: SmartOrderTransitionReason;
    }>,
): RuntimeEpoch {
    return transitionRecord(
        record,
        nextState,
        options,
        RUNTIME_EPOCH_TRANSITIONS,
    );
}

const TERMINAL_STRATEGY_STATES = new Set<StrategyState>([
    'completed',
    'cancelled',
    'expired',
]);
const TERMINAL_ACTIVATION_STATES = new Set<ActivationState>([
    'filled',
    'cancelled',
    'failed',
    'missed',
]);
const TERMINAL_BROKER_ORDER_STATES = new Set<BrokerOrderState>([
    'filled',
    'cancelled',
    'inactive',
    'failed',
]);
const TERMINAL_PENDING_PROTECTION_COMMITMENT_STATES = new Set<PendingProtectionCommitmentState>([
    'materialized',
    'zero_fill_terminal',
    'released_pre_dispatch',
    'released_manual',
]);
const TERMINAL_PROTECTION_OBLIGATION_STATES = new Set<ProtectionObligationState>([
    'fulfilled',
    'zero_fill_terminal',
    'released_manual',
]);
const TERMINAL_ENTRY_EXPOSURE_RESERVATION_STATES = new Set<EntryExposureReservationState>([
    'consumed',
    'released',
]);
const TERMINAL_EXIT_CLAIM_STATES = new Set<ExitClaimState>([
    'consumed',
    'released',
]);
const TERMINAL_RUNTIME_EPOCH_STATES = new Set<RuntimeEpochState>([
    'stopped',
    'failed_stop',
    'superseded',
]);

export const isStrategyTerminal = (state: StrategyState): boolean =>
    TERMINAL_STRATEGY_STATES.has(state);
export const isActivationTerminal = (state: ActivationState): boolean =>
    TERMINAL_ACTIVATION_STATES.has(state);
export const isProtectionLegEvaluationTerminal = (
    state: ProtectionLegEvaluationState,
): boolean => state === 'winner' || state === 'suppressed';
export const isOrderIntentTerminal = (state: OrderIntentState): boolean =>
    state === 'terminal';
export const isBrokerOrderTerminal = (state: BrokerOrderState): boolean =>
    TERMINAL_BROKER_ORDER_STATES.has(state);
export const isPendingProtectionCommitmentTerminal = (
    state: PendingProtectionCommitmentState,
): boolean => TERMINAL_PENDING_PROTECTION_COMMITMENT_STATES.has(state);
export const isProtectionObligationTerminal = (
    state: ProtectionObligationState,
): boolean => TERMINAL_PROTECTION_OBLIGATION_STATES.has(state);
export const isEntryExposureReservationTerminal = (
    state: EntryExposureReservationState,
): boolean => TERMINAL_ENTRY_EXPOSURE_RESERVATION_STATES.has(state);
export const isExitClaimTerminal = (
    state: ExitClaimState | ExternalSellClaim['state'],
): boolean => TERMINAL_EXIT_CLAIM_STATES.has(state as ExitClaimState);
export const isRuntimeEpochTerminal = (state: RuntimeEpochState): boolean =>
    TERMINAL_RUNTIME_EPOCH_STATES.has(state);
export const isUnknownOutcome = (
    state:
        | ActivationState
        | OrderIntentState
        | BrokerOrderState
        | PendingProtectionCommitmentState
        | EntryExposureReservationState
        | ExitClaimState
        | ExternalSellClaim['state'],
): boolean => state === 'unknown';

function canonicalSerialize(
    value: unknown,
    activeObjects: WeakSet<object>,
): string {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
            throw new SmartOrderDomainError(
                'non_canonical_value',
                'canonical numeric metadata must be a safe integer',
            );
        }
        return String(value);
    }
    if (typeof value !== 'object') {
        throw new SmartOrderDomainError(
            'non_canonical_value',
            'canonical payload contains an unsupported value',
        );
    }
    if (activeObjects.has(value)) {
        throw new SmartOrderDomainError(
            'canonical_cycle',
            'canonical payload cannot contain a cycle',
        );
    }
    activeObjects.add(value);
    try {
        if (Array.isArray(value)) {
            const ownKeys = Object.getOwnPropertyNames(value).filter(
                (key) => key !== 'length',
            );
            if (
                ownKeys.length !== value.length ||
                ownKeys.some((key, index) => key !== String(index))
            ) {
                throw new SmartOrderDomainError(
                    'non_canonical_value',
                    'canonical arrays must be dense and cannot have extra fields',
                );
            }
            return `[${ownKeys
                .map((key) => {
                    const descriptor = Object.getOwnPropertyDescriptor(
                        value,
                        key,
                    );
                    if (
                        !descriptor ||
                        !descriptor.enumerable ||
                        !('value' in descriptor)
                    ) {
                        throw new SmartOrderDomainError(
                            'non_canonical_value',
                            'canonical array entries must be enumerable data fields',
                        );
                    }
                    return canonicalSerialize(descriptor.value, activeObjects);
                })
                .join(',')}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new SmartOrderDomainError(
                'non_canonical_value',
                'canonical payload objects must be plain records',
            );
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw new SmartOrderDomainError(
                'non_canonical_value',
                'canonical payload cannot contain symbol keys',
            );
        }
        const record = value as Record<string, unknown>;
        const keys = Object.getOwnPropertyNames(record).sort();
        return `{${keys
            .map((key) => {
                const descriptor = Object.getOwnPropertyDescriptor(record, key);
                if (
                    !descriptor ||
                    !descriptor.enumerable ||
                    !('value' in descriptor)
                ) {
                    throw new SmartOrderDomainError(
                        'non_canonical_value',
                        'canonical payload properties must be enumerable data fields',
                    );
                }
                return `${JSON.stringify(key)}:${canonicalSerialize(
                    descriptor.value,
                    activeObjects,
                )}`;
            })
            .join(',')}}`;
    } finally {
        activeObjects.delete(value);
    }
}

export function stableSerializeCanonical(value: CanonicalValue): string {
    return canonicalSerialize(value, new WeakSet<object>());
}

async function hashCanonicalBytes(serialized: string): Promise<PayloadHash> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new SmartOrderDomainError(
            'hash_unavailable',
            'SHA-256 is unavailable in this Runtime',
        );
    }
    const payload = new TextEncoder().encode(serialized);
    const digest = new Uint8Array(await subtle.digest('SHA-256', payload));
    const hex = Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
    return `sha256:${hex}` as PayloadHash;
}

export async function hashCanonicalPayload(
    value: CanonicalValue,
): Promise<PayloadHash> {
    return hashCanonicalBytes(stableSerializeCanonical(value));
}

type ConfirmationStrategyBinding = {
    readonly [Kind in StrategyKind]: Readonly<{
        strategyKind: Kind;
        strategyDefinition: Extract<StrategyDefinition, { readonly kind: Kind }>;
    }>;
}[StrategyKind];

type CanonicalConfirmationSnapshotBase = Readonly<{
    readonly schemaVersion: typeof SMART_ORDER_CONFIRMATION_SCHEMA_VERSION;
    readonly simulation: true;
    readonly fixedAccountRef: FixedAccountRef;
    readonly identityGroupDigest: string;
    readonly monitorContractKeys: readonly CanonicalContractKey[];
    readonly contractKey: CanonicalContractKey;
    readonly baseShares: string;
    readonly commonLots: string;
    readonly contractUnit: string;
    readonly riskRevision: number;
    readonly contractRevision: string;
    readonly modeGeneration: string;
    readonly runtimeEpochId: RuntimeEpochId;
    readonly runtimeEpochRevision: number;
    readonly localRuntimeDisclosureVersion: string;
    readonly warningCodes: readonly string[];
}>;

export type CanonicalConfirmationSnapshot =
    CanonicalConfirmationSnapshotBase & ConfirmationStrategyBinding;

export interface CanonicalConfirmationEnvelope {
    readonly clientRequestId: ClientRequestId;
    readonly snapshot: CanonicalConfirmationSnapshot;
    readonly serializedPayload: string;
    readonly payloadHash: PayloadHash;
}

function primaryOrderForStrategy(
    definition: StrategyDefinition,
): CanonicalOrderSpecification {
    switch (definition.kind) {
        case 'parent_child':
            return definition.parameters.parent.order;
        case 'quick':
        case 'good_till':
        case 'multi_condition':
        case 'stop_take':
        case 'trailing_exit':
        case 'scheduled_quantity':
            return definition.parameters.order;
    }
}

function monitorContractsForStrategy(
    definition: StrategyDefinition,
): readonly CanonicalContractKey[] {
    switch (definition.kind) {
        case 'quick':
        case 'good_till':
            return [definition.parameters.monitorContractKey];
        case 'multi_condition':
            return definition.parameters.conditions.map(
                (condition) => condition.monitorContractKey,
            );
        case 'parent_child':
            return [
                definition.parameters.parent.monitorContractKey,
                definition.parameters.child.monitorContractKey,
            ];
        case 'stop_take':
        case 'trailing_exit':
            return [definition.parameters.monitorContractKey];
        case 'scheduled_quantity':
            return [definition.parameters.order.contractKey];
    }
}

function validateConfirmationSnapshot(
    snapshot: CanonicalConfirmationSnapshot,
): void {
    try {
        const record = strictRecord(snapshot, 'confirmation snapshot', [
            'schemaVersion',
            'strategyKind',
            'strategyDefinition',
            'simulation',
            'fixedAccountRef',
            'identityGroupDigest',
            'monitorContractKeys',
            'contractKey',
            'baseShares',
            'commonLots',
            'contractUnit',
            'riskRevision',
            'contractRevision',
            'modeGeneration',
            'runtimeEpochId',
            'runtimeEpochRevision',
            'localRuntimeDisclosureVersion',
            'warningCodes',
        ]);
        if (
            record.schemaVersion !== SMART_ORDER_CONFIRMATION_SCHEMA_VERSION ||
            record.simulation !== true
        ) {
            invalidStrategy('confirmation schema or simulation attestation is invalid');
        }
        const definition = parseStrategyDefinition(record.strategyDefinition);
        if (record.strategyKind !== definition.kind) {
            invalidStrategy('confirmation strategy kind does not match its definition');
        }
        fixedAccountRef(record.fixedAccountRef as string);
        canonicalContractKey(record.contractKey as string);
        domainId(record.runtimeEpochId as string, 'RuntimeEpochId');
        if (
            typeof record.identityGroupDigest !== 'string' ||
            !/^sha256:[0-9a-f]{64}$/.test(record.identityGroupDigest)
        ) {
            invalidStrategy(
                'confirmation identityGroupDigest must be a full SHA-256 digest',
            );
        }
        if (
            !Number.isSafeInteger(record.riskRevision) ||
            (record.riskRevision as number) < 0 ||
            !Number.isSafeInteger(record.runtimeEpochRevision) ||
            (record.runtimeEpochRevision as number) < 0
        ) {
            invalidStrategy('confirmation revisions must be non-negative integers');
        }
        strictRevision(record.contractRevision, 'confirmation contractRevision');
        strictRevision(record.modeGeneration, 'confirmation modeGeneration');
        strictRevision(
            record.localRuntimeDisclosureVersion,
            'confirmation localRuntimeDisclosureVersion',
        );
        const warnings = strictArray(
            record.warningCodes,
            'confirmation warningCodes',
            1,
            32,
        ).map((warning, index) =>
            strictRevision(warning, `confirmation warningCodes[${index}]`),
        );
        if (new Set(warnings).size !== warnings.length) {
            invalidStrategy('confirmation warningCodes must be unique');
        }

        const quantity = validateQuantityTuple(
            record.baseShares,
            record.commonLots,
            record.contractUnit,
            'confirmation quantity',
        );
        const primaryOrder = primaryOrderForStrategy(definition);
        if (
            record.contractKey !== primaryOrder.contractKey ||
            quantity.baseShares !== primaryOrder.baseShares ||
            quantity.commonLots !== primaryOrder.commonLots ||
            quantity.contractUnit !== primaryOrder.contractUnit
        ) {
            invalidStrategy(
                'confirmation quantity and contract must match the primary order',
            );
        }

        const expectedMonitors = monitorContractsForStrategy(definition);
        const actualMonitors = strictArray(
            record.monitorContractKeys,
            'confirmation monitorContractKeys',
            1,
            7,
        ).map((contract, index) =>
            strictContractKey(
                contract,
                `confirmation monitorContractKeys[${index}]`,
            ),
        );
        if (
            expectedMonitors.length !== actualMonitors.length ||
            expectedMonitors.some(
                (contract, index) => contract !== actualMonitors[index],
            )
        ) {
            invalidStrategy(
                'confirmation monitor contracts must match the strategy definition',
            );
        }
    } catch (error) {
        if (!(error instanceof SmartOrderDomainError)) throw error;
        throw new SmartOrderDomainError(
            'invalid_confirmation_snapshot',
            `confirmation snapshot rejected: ${error.message}`,
        );
    }
}

export async function createCanonicalConfirmation(input: {
    clientRequestId: ClientRequestId;
    snapshot: CanonicalConfirmationSnapshot;
}): Promise<CanonicalConfirmationEnvelope> {
    clientRequestId(input.clientRequestId);
    validateConfirmationSnapshot(input.snapshot);
    // Clone and freeze before the first await so a caller cannot mutate the
    // confirmed object while SHA-256 is pending.
    const snapshot = immutableCanonicalClone(input.snapshot);
    const serializedPayload = stableSerializeCanonical(
        snapshot as unknown as CanonicalValue,
    );
    return {
        clientRequestId: input.clientRequestId,
        snapshot,
        serializedPayload,
        payloadHash: await hashCanonicalBytes(serializedPayload),
    };
}

export async function validateCanonicalConfirmation(
    envelope: CanonicalConfirmationEnvelope,
    currentSnapshot: CanonicalConfirmationSnapshot,
): Promise<
    | Readonly<{ valid: true }>
    | Readonly<{
          valid: false;
          reason: 'confirmed_payload_tampered' | 'confirmation_fields_changed';
      }>
> {
    clientRequestId(envelope.clientRequestId);
    validateConfirmationSnapshot(envelope.snapshot);
    validateConfirmationSnapshot(currentSnapshot);
    // Capture both byte sequences before the first await. Callers cannot alter
    // either object while SHA-256 is pending and create a TOCTOU hash result.
    const storedSerialized = stableSerializeCanonical(
        envelope.snapshot as unknown as CanonicalValue,
    );
    const currentSerialized = stableSerializeCanonical(
        currentSnapshot as unknown as CanonicalValue,
    );
    const [storedHash, currentHash] = await Promise.all([
        hashCanonicalBytes(storedSerialized),
        hashCanonicalBytes(currentSerialized),
    ]);
    if (
        storedHash !== envelope.payloadHash ||
        storedSerialized !== envelope.serializedPayload
    ) {
        return { valid: false, reason: 'confirmed_payload_tampered' };
    }
    if (currentHash !== envelope.payloadHash) {
        return { valid: false, reason: 'confirmation_fields_changed' };
    }
    return { valid: true };
}

export type RequestReplayDecision =
    | 'new_request'
    | 'idempotent_replay'
    | 'reject_request_id_payload_mismatch';

export function classifyRequestReplay(
    previous:
        | Readonly<{
              clientRequestId: ClientRequestId;
              payloadHash: PayloadHash;
          }>
        | undefined,
    incoming: Readonly<{
        clientRequestId: ClientRequestId;
        payloadHash: PayloadHash;
    }>,
): RequestReplayDecision {
    if (!previous) return 'new_request';
    if (previous.clientRequestId !== incoming.clientRequestId) {
        return 'new_request';
    }
    return previous.payloadHash === incoming.payloadHash
        ? 'idempotent_replay'
        : 'reject_request_id_payload_mismatch';
}

const trustedReconciliationEvidence = new WeakSet<object>();
const trustedCanonicalContractMetadata = new WeakSet<object>();

export interface BrokerLongPositionEvidenceInput {
    readonly fixedAccountRef: FixedAccountRef;
    readonly contractKey: CanonicalContractKey;
    readonly asOfEpochMs: number;
    readonly reconciliationRevision: string;
    readonly reconciled: true;
    readonly completeWorkingSellSet: boolean;
    readonly positionSide: 'long' | 'short' | 'flat' | 'unknown';
    readonly availableLongShares: Share;
    readonly positionRevision: string;
}

export interface BrokerLongPositionEvidence {
    readonly source: 'account_scoped_reconciliation';
    readonly fixedAccountRef: FixedAccountRef;
    readonly contractKey: CanonicalContractKey;
    readonly asOfEpochMs: number;
    readonly reconciliationRevision: string;
    readonly reconciled: true;
    readonly completeWorkingSellSet: boolean;
    readonly positionSide: 'long' | 'short' | 'flat' | 'unknown';
    readonly availableLongShares: Share;
    readonly positionRevision: string;
}

function issueTrustedBrokerLongPositionEvidence(
    input: BrokerLongPositionEvidenceInput,
): BrokerLongPositionEvidence {
    fixedAccountRef(input.fixedAccountRef);
    canonicalContractKey(input.contractKey);
    if (!Number.isSafeInteger(input.asOfEpochMs) || input.asOfEpochMs < 0) {
        throw new SmartOrderDomainError(
            'invalid_revision',
            'reconciliation as-of time must be a non-negative epoch millisecond',
        );
    }
    domainId(input.reconciliationRevision, 'ReconciliationRevision');
    domainId(input.positionRevision, 'PositionRevision');
    if (input.reconciled !== true) {
        throw new SmartOrderDomainError(
            'invalid_revision',
            'trusted reconciliation evidence must be reconciled',
        );
    }
    if (typeof input.completeWorkingSellSet !== 'boolean') {
        throw new SmartOrderDomainError(
            'invalid_revision',
            'working-sell-set completeness must be explicit',
        );
    }
    if (
        input.positionSide !== 'long' &&
        input.positionSide !== 'short' &&
        input.positionSide !== 'flat' &&
        input.positionSide !== 'unknown'
    ) {
        throw new SmartOrderDomainError(
            'invalid_revision',
            'position side is outside the reconciliation schema',
        );
    }
    if (
        typeof input.availableLongShares !== 'bigint' ||
        shareValue(input.availableLongShares) < 0n
    ) {
        throw new SmartOrderDomainError(
            'invalid_revision',
            'available long shares must be non-negative',
        );
    }
    const evidence = Object.freeze({
        ...input,
        source: 'account_scoped_reconciliation' as const,
    });
    trustedReconciliationEvidence.add(evidence);
    return evidence;
}

export interface CanonicalContractMetadataInput {
    readonly contractKey: CanonicalContractKey;
    readonly exchange: 'TSE' | 'OTC';
    readonly securityType: 'STK';
    readonly category: 'stock' | 'etf';
    readonly contractUnit: ContractUnit;
    readonly metadataRevision: string;
}

export interface CanonicalContractMetadata {
    readonly source: 'canonical_contract_repository';
    readonly contractKey: CanonicalContractKey;
    readonly exchange: 'TSE' | 'OTC';
    readonly securityType: 'STK';
    readonly category: 'stock' | 'etf';
    readonly contractUnit: ContractUnit;
    readonly metadataRevision: string;
}

function issueTrustedCanonicalContractMetadata(
    input: CanonicalContractMetadataInput,
): CanonicalContractMetadata {
    canonicalContractKey(input.contractKey);
    const contractExchange = input.contractKey.split(':', 1)[0];
    if (
        (input.exchange !== 'TSE' && input.exchange !== 'OTC') ||
        input.exchange !== contractExchange ||
        input.securityType !== 'STK' ||
        (input.category !== 'stock' && input.category !== 'etf')
    ) {
        throw new SmartOrderDomainError(
            'invalid_identifier',
            'canonical contract metadata is inconsistent with its contract key',
        );
    }
    try {
        contractUnit(input.contractUnit);
    } catch (error) {
        if (!(error instanceof SmartOrderMoneyError)) throw error;
        throw new SmartOrderDomainError(
            'invalid_identifier',
            'canonical contract metadata has an invalid contract unit',
        );
    }
    domainId(input.metadataRevision, 'ContractMetadataRevision');
    const metadata = Object.freeze({
        ...input,
        source: 'canonical_contract_repository' as const,
    });
    trustedCanonicalContractMetadata.add(metadata);
    return metadata;
}

/**
 * Explicit unit-test seam. The real module is always false; only Vitest aliases
 * the import to a separate true module. Raw Node globals and environment
 * variables therefore cannot enable this surface.
 */
export const SMART_ORDER_DOMAIN_TEST_ONLY =
    SMART_ORDER_DOMAIN_TEST_MODE
        ? Object.freeze({
              issueBrokerLongPositionEvidence:
                  issueTrustedBrokerLongPositionEvidence,
              issueCanonicalContractMetadata:
                  issueTrustedCanonicalContractMetadata,
          })
        : undefined;

export interface AutomationIntentCandidate {
    readonly fixedAccountRef: FixedAccountRef;
    readonly contractKey: CanonicalContractKey;
    readonly securityType: string;
    readonly exchange: string;
    readonly instrumentClass: string;
    readonly orderCond: string;
    readonly orderLot: string;
    readonly side: string;
    readonly positionEffect: string;
    readonly dayTradeShort: boolean;
    readonly requestedShares: Share;
    readonly requestedCommonLots: CommonLot;
    readonly contractUnit: ContractUnit;
    readonly contractMetadata: CanonicalContractMetadata;
    readonly brokerEvidence?: BrokerLongPositionEvidence;
}

export interface AutomationClassificationContext {
    /** Trusted evaluation clock captured for this classification. */
    readonly evaluatedAtEpochMs: number;
    /** Versioned freshness policy supplied by the Runtime, not the browser. */
    readonly maximumEvidenceAgeMs: number;
    /** Current account-scoped reconciliation revision required by this decision. */
    readonly requiredReconciliationRevision: string;
    /** Current canonical contract repository revision required by this decision. */
    readonly requiredContractMetadataRevision: string;
}

export type UnsupportedAutomationReason =
    | 'invalid_account_or_contract'
    | 'invalid_evaluation_context'
    | 'unsupported_security'
    | 'unsupported_exchange'
    | 'unknown_instrument_class'
    | 'canonical_contract_metadata_missing_or_untrusted'
    | 'canonical_contract_metadata_revision_mismatch'
    | 'canonical_contract_metadata_mismatch'
    | 'unsupported_order_cond'
    | 'unsupported_order_lot'
    | 'short_or_unknown_position_effect'
    | 'invalid_quantity'
    | 'reduce_only_evidence_missing'
    | 'reduce_only_evidence_untrusted'
    | 'reduce_only_evidence_stale_or_incomplete'
    | 'reduce_only_evidence_revision_mismatch'
    | 'reduce_only_account_or_contract_mismatch'
    | 'reduce_only_quantity_exceeded';

export type AutomationIntentClassification =
    | Readonly<{
          classification: 'supported';
          automationClass:
              | 'cash_common_long_entry'
              | 'cash_common_local_reduce_only';
          exposure: 'increase_long' | 'reduce_long';
          localReduceOnly: boolean;
      }>
    | Readonly<{
          classification: 'unsupported';
          reason: UnsupportedAutomationReason;
      }>;

function unsupported(
    reason: UnsupportedAutomationReason,
): AutomationIntentClassification {
    return { classification: 'unsupported', reason };
}

/**
 * Classifies only automation candidates. It does not inspect, narrow, or
 * rewrite the existing manual-order capability matrix.
 */
export function classifyAutomationIntent(
    candidate: AutomationIntentCandidate,
    context: AutomationClassificationContext,
): AutomationIntentClassification {
    if (
        !candidate ||
        typeof candidate !== 'object' ||
        !context ||
        typeof context !== 'object'
    ) {
        return unsupported('invalid_evaluation_context');
    }
    try {
        fixedAccountRef(candidate.fixedAccountRef);
        canonicalContractKey(candidate.contractKey);
    } catch (error) {
        if (!(error instanceof SmartOrderDomainError)) throw error;
        return unsupported('invalid_account_or_contract');
    }
    if (
        !Number.isSafeInteger(context.evaluatedAtEpochMs) ||
        context.evaluatedAtEpochMs < 0 ||
        !Number.isSafeInteger(context.maximumEvidenceAgeMs) ||
        context.maximumEvidenceAgeMs <= 0
    ) {
        return unsupported('invalid_evaluation_context');
    }
    try {
        domainId(
            context.requiredReconciliationRevision,
            'ReconciliationRevision',
        );
        domainId(
            context.requiredContractMetadataRevision,
            'ContractMetadataRevision',
        );
    } catch (error) {
        if (!(error instanceof SmartOrderDomainError)) throw error;
        return unsupported('invalid_evaluation_context');
    }
    if (candidate.securityType !== 'STK') {
        return unsupported('unsupported_security');
    }
    const contractExchange = candidate.contractKey.split(':', 1)[0];
    if (
        (candidate.exchange !== 'TSE' && candidate.exchange !== 'OTC') ||
        candidate.exchange !== contractExchange
    ) {
        return unsupported('unsupported_exchange');
    }
    if (
        candidate.instrumentClass !== 'stock' &&
        candidate.instrumentClass !== 'etf'
    ) {
        return unsupported('unknown_instrument_class');
    }
    const contractMetadata = candidate.contractMetadata;
    if (
        !contractMetadata ||
        typeof contractMetadata !== 'object' ||
        !trustedCanonicalContractMetadata.has(contractMetadata)
    ) {
        return unsupported('canonical_contract_metadata_missing_or_untrusted');
    }
    if (
        contractMetadata.metadataRevision !==
        context.requiredContractMetadataRevision
    ) {
        return unsupported('canonical_contract_metadata_revision_mismatch');
    }
    if (
        contractMetadata.source !== 'canonical_contract_repository' ||
        contractMetadata.contractKey !== candidate.contractKey ||
        contractMetadata.securityType !== candidate.securityType ||
        contractMetadata.exchange !== candidate.exchange ||
        contractMetadata.category !== candidate.instrumentClass ||
        typeof contractMetadata.contractUnit !== 'bigint' ||
        contractMetadata.contractUnit !== candidate.contractUnit
    ) {
        return unsupported('canonical_contract_metadata_mismatch');
    }
    if (candidate.orderCond !== 'Cash') {
        return unsupported('unsupported_order_cond');
    }
    if (candidate.orderLot !== 'Common') {
        return unsupported('unsupported_order_lot');
    }
    if (
        candidate.dayTradeShort ||
        (candidate.side !== 'Buy' && candidate.side !== 'Sell')
    ) {
        return unsupported('short_or_unknown_position_effect');
    }
    if (
        typeof candidate.requestedShares !== 'bigint' ||
        typeof candidate.requestedCommonLots !== 'bigint' ||
        typeof candidate.contractUnit !== 'bigint'
    ) {
        return unsupported('invalid_quantity');
    }
    let convertedShares: Share;
    try {
        convertedShares = sharesFromCommonLots(
            candidate.requestedCommonLots,
            candidate.contractUnit,
        );
    } catch (error) {
        if (!(error instanceof SmartOrderMoneyError)) throw error;
        return unsupported('invalid_quantity');
    }
    if (
        shareValue(candidate.requestedShares) <= 0n ||
        shareValue(convertedShares) !== shareValue(candidate.requestedShares)
    ) {
        return unsupported('invalid_quantity');
    }

    if (candidate.side === 'Buy') {
        if (candidate.positionEffect !== 'open_long') {
            return unsupported('short_or_unknown_position_effect');
        }
        return {
            classification: 'supported',
            automationClass: 'cash_common_long_entry',
            exposure: 'increase_long',
            localReduceOnly: false,
        };
    }

    if (candidate.positionEffect !== 'reduce_long') {
        return unsupported('short_or_unknown_position_effect');
    }
    const evidence = candidate.brokerEvidence;
    if (!evidence) return unsupported('reduce_only_evidence_missing');
    if (!trustedReconciliationEvidence.has(evidence)) {
        return unsupported('reduce_only_evidence_untrusted');
    }
    if (
        evidence.source !== 'account_scoped_reconciliation' ||
        evidence.reconciled !== true ||
        evidence.completeWorkingSellSet !== true ||
        evidence.positionSide !== 'long' ||
        typeof evidence.availableLongShares !== 'bigint' ||
        !Number.isSafeInteger(evidence.asOfEpochMs) ||
        evidence.asOfEpochMs < 0 ||
        evidence.asOfEpochMs > context.evaluatedAtEpochMs ||
        context.evaluatedAtEpochMs - evidence.asOfEpochMs >
            context.maximumEvidenceAgeMs
    ) {
        return unsupported('reduce_only_evidence_stale_or_incomplete');
    }
    if (
        evidence.reconciliationRevision !==
        context.requiredReconciliationRevision
    ) {
        return unsupported('reduce_only_evidence_revision_mismatch');
    }
    if (
        evidence.fixedAccountRef !== candidate.fixedAccountRef ||
        evidence.contractKey !== candidate.contractKey
    ) {
        return unsupported('reduce_only_account_or_contract_mismatch');
    }
    if (
        shareValue(candidate.requestedShares) >
        shareValue(evidence.availableLongShares)
    ) {
        return unsupported('reduce_only_quantity_exceeded');
    }
    return {
        classification: 'supported',
        automationClass: 'cash_common_local_reduce_only',
        exposure: 'reduce_long',
        localReduceOnly: true,
    };
}
