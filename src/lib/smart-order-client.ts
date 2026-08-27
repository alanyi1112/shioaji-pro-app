import type { BrowserSmartOrderCanonicalDraft } from './smart-order-browser-draft';
import { SMART_ORDER_BROWSER_GATEWAY_AVAILABLE } from './smart-order-browser-gateway-mode';

export const SMART_ORDER_BROWSER_CLIENT_SCHEMA_VERSION =
    'smart-order-browser-client/2026-08-11.3';

const GATEWAY_PREFIX = '/__smart-orders';
const CSRF_ROUTE = '/v1/csrf-token';
const CSRF_HEADER = 'X-RealTimeStock-CSRF-Token';
const CSRF_SCHEMA_VERSION = 'smart-order-browser-csrf/2026-08-11.1';
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OPERATION_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNRESOLVED_OPERATION_CODES = new Set([
    'operation_outcome_unknown',
    'operation_reserved',
    'operation_result_persistence_failed',
]);

export type SmartOrderStrategyKind =
    | 'quick'
    | 'good_till'
    | 'multi_condition'
    | 'parent_child'
    | 'stop_take'
    | 'trailing_exit'
    | 'scheduled_quantity';

export const DEFAULT_SMART_ORDER_STRATEGY_KIND: SmartOrderStrategyKind =
    'trailing_exit';

export type SmartOrderCanonicalDraft = BrowserSmartOrderCanonicalDraft;

export type SmartOrderStrategyState =
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

export interface SmartOrderActivityComponentSummary {
    readonly state: string | null;
    readonly count: number;
}

export interface SmartOrderFormalProtectionRational {
    readonly numeratorMinorUnits: string;
    readonly denominator: string;
}

export interface SmartOrderFormalProtectionView {
    readonly schemaVersion: 'smart-order-formal-protection-view/2026-08-13.1';
    readonly state: 'formal' | 'pending_saved_high';
    readonly cumulativeFilledShares: number;
    readonly asOfEpochMs: number;
    readonly estimatedBasis: SmartOrderFormalProtectionRational;
    readonly formalBasis: SmartOrderFormalProtectionRational;
    readonly legs: readonly Readonly<{
        readonly type:
            | 'stop'
            | 'take'
            | 'trailing_activation'
            | 'trailing_retracement'
            | 'fixed_stop';
        readonly comparator: 'lte' | 'gte';
        readonly triggerState: 'formal' | 'pending_saved_high';
        readonly triggerBasis: 'weighted_average_fill' | 'durable_saved_high';
        readonly estimatedTriggerPrice: SmartOrderFormalProtectionRational | null;
        readonly formalTriggerPrice: SmartOrderFormalProtectionRational | null;
        readonly differsFromEstimate: boolean | null;
    }>[];
    readonly accountIdentifiersExposed: false;
    readonly entityIdentifiersExposed: false;
}

export interface SmartOrderActiveActivitySnapshot {
    readonly schemaVersion: 'smart-order-active-activity/2026-08-13.3';
    readonly displayState: string;
    readonly activations: SmartOrderActivityComponentSummary;
    readonly intents: SmartOrderActivityComponentSummary;
    readonly brokerOrders: SmartOrderActivityComponentSummary;
    readonly protectionCommitments: SmartOrderActivityComponentSummary;
    readonly protectionObligations: SmartOrderActivityComponentSummary;
    readonly entryExposureReservations: SmartOrderActivityComponentSummary;
    readonly exitClaims: SmartOrderActivityComponentSummary;
    readonly resolutionCases: SmartOrderActivityComponentSummary;
    readonly safetyBlockers: SmartOrderActivityComponentSummary;
    readonly formalProtection: SmartOrderFormalProtectionView | null;
    readonly hasRuntimeTrackedUnprotectedRemainder: boolean;
    readonly runtimeTrackedUnprotectedRemainder: Readonly<{
        readonly state: 'none' | 'last_known';
        readonly lastKnownShares: number;
        readonly asOfEpochMs: number | null;
        readonly current: false;
    }>;
    readonly hasUnknownExitClaim: boolean;
    readonly accountIdentifiersExposed: false;
    readonly entityIdentifiersExposed: false;
}

export interface SmartOrderStrategySnapshot {
    readonly strategyId: string;
    readonly strategyKind: SmartOrderStrategyKind;
    readonly state: SmartOrderStrategyState;
    readonly definitionHash: string;
    readonly accountBound: boolean;
    readonly maskedAccountLabel?: string | null;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly terminalAtEpochMs?: number;
    readonly revision: number;
    readonly definition?: Readonly<Record<string, unknown>>;
    readonly activity?: SmartOrderActiveActivitySnapshot;
    readonly blockers?: readonly string[];
    readonly replayed?: boolean;
}

export interface SmartOrderCanonicalConfirmationView {
    readonly schemaVersion: 'smart-order-canonical-confirmation/2026-08-20.1';
    readonly state: 'previewed' | 'accepted';
    readonly snapshotHash: string;
    readonly strategyId: string;
    readonly strategyKind:
        | 'quick'
        | 'parent_child'
        | 'stop_take'
        | 'trailing_exit';
    readonly strategyRevision: number;
    readonly resolvedDefinitionHash: string;
    readonly fixedAccountLabel: string;
    readonly contract: Readonly<{
        contractKey: string;
        category: '股票' | 'ETF';
        contractUnit: number;
        referenceMinorUnits: number;
        limitUpMinorUnits: number;
        limitDownMinorUnits: number;
        updateDate: string;
        contractRevision: string;
        corporateActionRevision: string;
    }>;
    readonly childContract?: SmartOrderCanonicalConfirmationView['contract'];
    readonly position:
        | Readonly<{
              quantityShares: number;
              availableShares: number;
              averageCostState: 'available' | 'unavailable';
              basisSource: 'broker_average_cost' | 'user_specified';
              basisPriceMinorUnits: number;
              asOfEpochMs: number;
          }>
        | Readonly<{
              quantityShares: number;
              availableShares: number;
              asOfEpochMs: number;
          }>
        | null;
    readonly riskRevision: number;
    readonly modeGeneration: string;
    readonly runtimeRevision: number;
    readonly validUntilEpochMs: number;
    readonly warnings: readonly string[];
    readonly brokerWriteAttempted: false;
    readonly brokerWriteAuthority: false;
    readonly accountIdentifiersExposed: false;
    readonly strategy?: SmartOrderStrategySnapshot;
}

export type SmartOrderProtectedEntryDistance =
    | Readonly<{ kind: 'absolute'; value: string }>
    | Readonly<{ kind: 'pct_bps'; pctBps: number }>
    | Readonly<{ kind: 'fixed_atr'; multiplier: string }>;

export interface SmartOrderProtectedEntryConfirmationRequest {
    readonly schemaVersion: 'smart-order-protected-entry-confirmation-request/2026-08-20.1';
    readonly accountBrokerRef: string;
    readonly accountIdRef: string;
    readonly commonLots: number;
    readonly contractKey: string;
    readonly entryOrder: Readonly<{
        priceType: 'LMT';
        limitPrice: string;
        timeInForce: 'ROD' | 'IOC';
    }>;
    readonly protection: Readonly<{
        family: 'fixed' | 'trailing';
        legs: readonly Readonly<{
            comparator: 'lte' | 'gte';
            distance: SmartOrderProtectedEntryDistance;
            execution: Readonly<{
                priceType: 'LMT' | 'MKT';
                limitPrice: string | null;
                timeInForce: 'ROD' | 'IOC';
            }>;
            legId: string;
            type:
                | 'stop'
                | 'take'
                | 'trailing_activation'
                | 'trailing_retracement'
                | 'fixed_stop';
        }>[];
    }>;
}

export interface SmartOrderProtectedEntryConfirmationView {
    readonly schemaVersion: 'smart-order-protected-entry-confirmation/2026-08-20.1';
    readonly state: 'previewed' | 'accepted';
    readonly snapshotHash: string;
    readonly confirmationId: string;
    readonly strategyKind: 'stop_take' | 'trailing_exit';
    readonly fixedAccountLabel: string;
    readonly simulation: true;
    readonly contract: Readonly<{
        contractKey: string;
        category: '股票' | 'ETF';
        contractUnit: number;
        updateDate: string;
        contractRevision: string;
        corporateActionRevision: string;
    }>;
    readonly entryOrder: Readonly<{
        side: 'Buy';
        orderCond: 'Cash';
        orderLot: 'Common';
        baseShares: number;
        commonLots: number;
        priceType: 'LMT';
        limitPrice: string;
        timeInForce: 'ROD' | 'IOC';
    }>;
    readonly protection: SmartOrderProtectedEntryConfirmationRequest['protection'];
    readonly fixedAtrSnapshot: null;
    readonly previewBasis: Readonly<{
        source: 'entry_limit_estimate';
        priceDecimal: string;
        formalSource: 'entry_weighted_average_fill';
    }>;
    readonly riskRevision: number;
    readonly riskPolicyRevision: string;
    readonly modeGeneration: string;
    readonly runtimeRevision: number;
    readonly accountReconciliationAsOfEpochMs: number;
    readonly validUntilEpochMs: number;
    readonly warnings: readonly string[];
    readonly durablePreparationState: 'none' | 'prepared';
    readonly brokerWriteAttempted: false;
    readonly brokerWriteAuthority: false;
    readonly accountIdentifiersExposed: false;
    readonly entityIdentifiersExposed: false;
}

export interface SmartOrderBrokerCancellationRequest {
    readonly brokerAuthorityGranted: false;
    readonly brokerWriteAttempted: false;
    readonly cancelIntentState: 'prepared';
    readonly dispatchAllowed: false;
    readonly replayed: boolean;
    readonly strategyId: string;
    readonly strategyRevision: number;
    readonly targetState: 'pre_submitted' | 'submitted' | 'part_filled';
    readonly userConfirmationConsumed: true;
}

export interface SmartOrderBrokerQuantityReductionRequest {
    readonly brokerAuthorityGranted: false;
    readonly brokerWriteAttempted: false;
    readonly dispatchAllowed: false;
    readonly quantityShares: number;
    readonly replayed: boolean;
    readonly strategyId: string;
    readonly strategyRevision: number;
    readonly targetState: 'pre_submitted' | 'submitted' | 'part_filled';
    readonly updateIntentState: 'prepared';
    readonly userConfirmationConsumed: true;
}

export interface SmartOrderPreparedIntentDrainResult {
    readonly strategyId: string;
    readonly strategyState: 'cancel_pending' | 'cancelled';
    readonly strategyRevision: number;
    readonly preparedIntentState: 'cancelled_proven_unsent';
    readonly activationState: 'cancelled';
    readonly reservationReleased: boolean;
    readonly protectionReleased: boolean;
    readonly exitClaimReleased: boolean;
    readonly rearmSuperseded: boolean;
    readonly userAuthorityConsumed: true;
    readonly brokerWriteAttempted: false;
    readonly brokerAuthorityGranted: false;
}

export interface SmartOrderProtectionRelinquishmentChallenge {
    readonly challengeId: string;
    readonly strategyId: string;
    readonly strategyRevision: number;
    readonly handoffSnapshotHash: string;
    readonly unmonitoredAuditHash: string;
    readonly obligationCount: number;
    readonly commitmentCount: number;
    readonly reservationCount: number;
    readonly exitClaimCount: number;
    readonly sideEffectIntentCount: number;
    readonly brokerOrderCount: number;
    readonly relinquished: false;
    readonly brokerWriteAttempted: false;
    readonly brokerOutcomeInferred: false;
    readonly replayed: boolean;
}

export interface SmartOrderProtectionRelinquishmentResult {
    readonly strategyId: string;
    readonly strategyState: SmartOrderStrategyState;
    readonly strategyRevision: number;
    readonly obligationCount: number;
    readonly commitmentCount: number;
    readonly reservationCount: number;
    readonly exitClaimCount: number;
    readonly sideEffectIntentCount: number;
    readonly brokerOrderCount: number;
    readonly safetyBlockerCount: number;
    readonly authorizationConsumed: true;
    readonly relinquished: true;
    readonly unmonitored: true;
    readonly brokerOutcomeInferred: false;
    readonly originalIntentRedispatchAllowed: false;
    readonly brokerWriteAttempted: false;
    readonly replayed: boolean;
}

export type SmartOrderManualResolutionOperation =
    | 'apply_unique_final_evidence'
    | 'reconfirm_and_pause'
    | 'cancel_strategy'
    | 'copy_to_new_draft'
    | 'repair_gate_observe_only'
    | 'break_glass_relinquish'
    | 'remain_open';

export interface SmartOrderManualResolutionCase {
    readonly resolutionKey: string;
    readonly reasonCode: string;
    readonly caseRevision: number;
    readonly state: string;
    readonly requiredEvidence: readonly string[];
    readonly allowedOperations: readonly SmartOrderManualResolutionOperation[];
    readonly executableOperations: readonly SmartOrderManualResolutionOperation[];
    readonly uniqueFinalReady: boolean;
    readonly uniqueFinalEvidenceHash?: string;
    readonly breakGlassAllowed: boolean;
    readonly oldIntentDisposition: 'never_resend';
    readonly updatedAtEpochMs: number;
    readonly accountIdentifiersExposed: false;
    readonly entityIdentifiersExposed: false;
    readonly brokerWriteAuthority: false;
}

export interface SmartOrderManualResolutionList {
    readonly strategyId: string;
    readonly strategyRevision: number;
    readonly strategyState: SmartOrderStrategyState;
    readonly cases: readonly SmartOrderManualResolutionCase[];
    readonly genericResumeAllowed: false;
    readonly brokerWriteAuthority: false;
}

export interface SmartOrderManualResolutionResult {
    readonly strategyId: string;
    readonly strategyState: 'paused';
    readonly strategyRevision: number;
    readonly resolutionState: 'resolved';
    readonly resolutionRevision: number;
    readonly uniqueFinalEvidenceHash: string;
    readonly originalIntentState: 'terminal';
    readonly originalIntentRedispatchAllowed: false;
    readonly safetyBlockerCount: number;
    readonly rearmSupersededCount: number;
    readonly brokerWriteAttempted: false;
    readonly brokerAuthorityGranted: false;
}

export interface SmartOrderGateStatus {
    readonly present: boolean;
    readonly state: 'eligible' | 'observe_only';
    readonly blocker: string;
    readonly validUntilEpochMs?: number;
    readonly featureGates: Readonly<Record<SmartOrderStrategyKind, boolean>>;
    readonly authoritativeForDispatch: false;
}

export interface SmartOrderReadinessSnapshot {
    readonly ready: false;
    readonly writeMaster: 'disabled';
    readonly runtime: Readonly<{
        mode: 'simulation';
        role: 'primary' | 'secondary_readonly' | 'unknown';
        state: string;
        repositoryReady: boolean;
        dispatchAllowedByRepository: boolean;
    }>;
    readonly quote: Readonly<{
        state: 'fresh' | 'stale' | 'unverified';
        asOfExchangeTime: string | null;
        authoritativeForActivation: boolean;
    }>;
    readonly lifecycle: Readonly<{
        readonly state: 'verified_repository_projection' | 'unverified';
        readonly reconciliation: string;
        readonly blockerCount: number | null;
        readonly productionReadonlyBlockerCount: number | null;
        readonly gracefulStopBlockerCount: number | null;
        readonly uninstallBlockerCount: number | null;
        readonly productionReadonlyDrainAllowed: boolean;
        readonly gracefulStopAllowed: boolean;
        readonly uninstallAllowed: boolean;
        readonly drainItems: readonly Readonly<{
            readonly kind: string;
            readonly count: number;
            readonly disposition: string;
        }>[];
        readonly drainRecords: readonly Readonly<{
            readonly ordinal: number;
            readonly kind: string;
            readonly state: string;
            readonly quantityShares: number | null;
            readonly quantityState:
                | 'not_applicable'
                | 'exact'
                | 'conservative_maximum';
            readonly disposition: string;
        }>[];
        readonly drainRecordsTruncated: boolean;
        readonly runtimeTrackedUnprotectedRemainder: Readonly<{
            readonly state: 'known' | 'unknown';
            readonly shares: number | null;
            readonly conservativeMaximumShares: number | null;
            readonly currentAccountReconciliationRequired: boolean;
        }>;
        readonly accountIdentifiersExposed: false;
        readonly entityIdentifiersExposed: false;
    }>;
    readonly gates: Readonly<{
        automation: SmartOrderGateStatus;
        manual_user_confirmed: SmartOrderGateStatus;
        gate_probe: SmartOrderGateStatus;
    }>;
    readonly blockers: readonly string[];
}

export interface SmartOrderRiskLimitVector {
    readonly quantityShares: number | null;
    readonly notionalMinorUnits: number | null;
    readonly cashMinorUnits: number | null;
    readonly positionShares: number | null;
    readonly orderCount: number | null;
}

export interface SmartOrderRuntimeRiskPolicyEditorInput {
    readonly schemaVersion: 'smart-order-runtime-risk-policy-editor/2026-08-14.1';
    readonly buyFeeBps: number;
    readonly minimumBuyFeeMinorUnits: number;
    readonly cashBufferMinorUnits: number;
    readonly accountLimits: SmartOrderRiskLimitVector;
    readonly identityLimits: SmartOrderRiskLimitVector;
    readonly accountDailyLossLimitMinorUnits: number;
    readonly identityDailyLossLimitMinorUnits: number;
}

export interface SmartOrderRuntimeRiskPolicyView {
    readonly schemaVersion: 'smart-order-runtime-risk-policy-view/2026-08-14.1';
    readonly state: 'missing' | 'reconciliation_required' | 'current';
    readonly revision: number | null;
    readonly policyHash: string | null;
    readonly policy: Readonly<{
        readonly schemaVersion: 'smart-order-runtime-risk-policy/2026-08-14.1';
        readonly revision: number;
        readonly policyRevision: string;
        readonly executionPolicy: Readonly<{
            readonly schemaVersion: 'smart-order-protected-entry-risk-policy/2026-08-13.1';
            readonly policyRevision: string;
            readonly buyFeeBps: number;
            readonly minimumBuyFeeMinorUnits: number;
            readonly cashBufferMinorUnits: number;
        }>;
        readonly reservedDimensions: readonly (keyof SmartOrderRiskLimitVector)[];
        readonly accountLimits: SmartOrderRiskLimitVector;
        readonly identityLimits: SmartOrderRiskLimitVector;
        readonly accountDailyLossLimitMinorUnits: number;
        readonly identityDailyLossLimitMinorUnits: number;
    }> | null;
    readonly exposureHeadsCurrent: boolean;
    readonly publishedAtEpochMs?: number;
    readonly brokerWriteAuthority: false;
    readonly accountIdentifiersExposed: false;
    readonly identityIdentifiersExposed: false;
}

export type SmartOrderKillSwitchName =
    | 'pause_new_exposure'
    | 'pause_automation'
    | 'emergency_block_all_writes';

export type SmartOrderKillSwitchReasonCode =
    | 'automation_pause'
    | 'automation_pause_released'
    | 'emergency_after_linearization'
    | 'exposure_pause_released'
    | 'operator_emergency'
    | 'operator_pause'
    | 'operator_release';

export interface SmartOrderKillSwitchView {
    readonly schemaVersion: 'smart-order-kill-switch-arbiter/2026-08-12.1';
    readonly arbiterRevision: number;
    readonly switches: Readonly<
        Record<
            SmartOrderKillSwitchName,
            Readonly<{
                enabled: boolean;
                revision: number;
                updatedAtEpochMs: number;
                reasonCode: string;
            }>
        >
    >;
    readonly enabled: readonly SmartOrderKillSwitchName[];
    readonly denyUnionActive: boolean;
    readonly changed?: boolean;
    readonly replayed?: boolean;
    readonly brokerWriteAuthority: false;
    readonly accountIdentifiersExposed: false;
    readonly identityIdentifiersExposed: false;
}

interface MutationResponse<T> {
    readonly result: T;
    readonly resultHash: string;
    readonly brokerWriteAttempted: false;
}

const SMART_ORDER_STRATEGY_KINDS = Object.freeze([
    'quick',
    'good_till',
    'multi_condition',
    'parent_child',
    'stop_take',
    'trailing_exit',
    'scheduled_quantity',
] as const satisfies readonly SmartOrderStrategyKind[]);

const SMART_ORDER_STRATEGY_STATES = Object.freeze([
    'draft',
    'observing',
    'monitoring',
    'paused',
    'recovery',
    'manual_intervention',
    'cancel_pending',
    'expired_with_obligation',
    'completed',
    'cancelled',
    'expired',
] as const satisfies readonly SmartOrderStrategyState[]);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BOUNDED_TOKEN_PATTERN = /^[^\u0000-\u001f\u007f]{1,240}$/;
const CANONICAL_CONTRACT_PATTERN =
    /^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LIFECYCLE_DRAIN_DISPOSITION_BY_KIND = Object.freeze({
    account_reconciliation: 'complete_current_account_reconciliation',
    strategy: 'pause_or_cancel_strategy',
    activation: 'cancel_strategy_or_complete_activation',
    prepared_intent: 'cancel_proven_unsent_intent_and_release',
    side_effect_intent: 'reconcile_intent_before_stop',
    broker_order: 'cancel_working_order_or_reconcile',
    protection_commitment: 'prove_zero_fill_or_release_pre_dispatch',
    protection_obligation:
        'prove_zero_fill_confirmed_exit_or_break_glass',
    entry_exposure_reservation: 'release_proven_unsent_or_reconcile',
    exit_claim: 'reconcile_or_release_claim',
    manual_resolution: 'complete_reason_specific_resolution',
    safety_blocker: 'resolve_or_supersede_blocker',
} as const);
const LIFECYCLE_DRAIN_STATES_BY_KIND = Object.freeze({
    account_reconciliation: ['missing_or_stale'],
    strategy: [
        'draft',
        'observing',
        'monitoring',
        'paused',
        'recovery',
        'manual_intervention',
        'cancel_pending',
        'expired_with_obligation',
    ],
    activation: [
        'candidate',
        'triggered',
        'prepared',
        'dispatching',
        'working',
        'part_filled',
        'unknown',
    ],
    prepared_intent: ['prepared'],
    side_effect_intent: [
        'prepared_authority_granted',
        'dispatching',
        'acknowledged',
        'reconciling',
        'unknown',
    ],
    broker_order: [
        'pending_submit',
        'pre_submitted',
        'submitted',
        'part_filled',
        'unknown',
    ],
    protection_commitment: ['pending_entry_fill', 'unknown'],
    protection_obligation: ['pending_entry_fill', 'monitoring', 'unknown'],
    entry_exposure_reservation: ['reserved', 'dispatching', 'working', 'unknown'],
    exit_claim: [
        'monitoring_reserved',
        'intent_reserved',
        'broker_working',
        'unknown',
    ],
    manual_resolution: ['open'],
    safety_blocker: ['open'],
} as const);
const LIFECYCLE_DRAIN_QUANTITY_STATES_BY_KIND = Object.freeze({
    account_reconciliation: ['not_applicable'],
    strategy: ['not_applicable'],
    activation: ['not_applicable'],
    prepared_intent: ['not_applicable'],
    side_effect_intent: ['not_applicable'],
    broker_order: ['conservative_maximum'],
    protection_commitment: ['conservative_maximum'],
    protection_obligation: ['exact', 'conservative_maximum'],
    entry_exposure_reservation: ['exact'],
    exit_claim: ['exact'],
    manual_resolution: ['not_applicable'],
    safety_blocker: ['not_applicable'],
} as const);

function invalidRuntimeResponse(code: string): never {
    throw new SmartOrderLocalApiError(502, code);
}

function exactObject(
    value: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype
    ) {
        return null;
    }
    const keys = Object.keys(value).sort();
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
        requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
        keys.some((key) => !allowed.has(key))
    ) {
        return null;
    }
    return value as Record<string, unknown>;
}

function isBoundedToken(value: unknown, maximumLength = 240): value is string {
    return (
        typeof value === 'string' &&
        value.length <= maximumLength &&
        BOUNDED_TOKEN_PATTERN.test(value) &&
        value.trim() === value
    );
}

function isEpoch(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRevision(value: unknown): value is number {
    return isEpoch(value);
}

function freezeJsonValue(
    value: unknown,
    budget: { nodes: number },
    depth = 0,
): unknown {
    budget.nodes += 1;
    if (budget.nodes > 4_096 || depth > 32) {
        return invalidRuntimeResponse('invalid_strategy_definition');
    }
    if (
        value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    ) {
        return value;
    }
    if (typeof value === 'string') {
        if (value.length > 4_096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
            return invalidRuntimeResponse('invalid_strategy_definition');
        }
        return value;
    }
    if (Array.isArray(value)) {
        if (value.length > 256) {
            return invalidRuntimeResponse('invalid_strategy_definition');
        }
        for (let index = 0; index < value.length; index += 1) {
            value[index] = freezeJsonValue(value[index], budget, depth + 1);
        }
        return Object.freeze(value);
    }
    if (
        value === null ||
        typeof value !== 'object' ||
        Object.getPrototypeOf(value) !== Object.prototype
    ) {
        return invalidRuntimeResponse('invalid_strategy_definition');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
        keys.length > 128 ||
        keys.some(
            (key) =>
                key === '__proto__' ||
                key === 'prototype' ||
                key === 'constructor' ||
                !isBoundedToken(key, 128),
        )
    ) {
        return invalidRuntimeResponse('invalid_strategy_definition');
    }
    for (const key of keys) {
        record[key] = freezeJsonValue(record[key], budget, depth + 1);
    }
    return Object.freeze(record);
}

function strategyKind(value: unknown): SmartOrderStrategyKind | null {
    return typeof value === 'string' &&
        SMART_ORDER_STRATEGY_KINDS.includes(value as SmartOrderStrategyKind)
        ? (value as SmartOrderStrategyKind)
        : null;
}

function strategyState(value: unknown): SmartOrderStrategyState | null {
    return typeof value === 'string' &&
        SMART_ORDER_STRATEGY_STATES.includes(value as SmartOrderStrategyState)
        ? (value as SmartOrderStrategyState)
        : null;
}

function parseActivityComponent(
    value: unknown,
): SmartOrderActivityComponentSummary | null {
    const record = exactObject(value, ['count', 'state']);
    if (
        !record ||
        !isRevision(record.count) ||
        (record.state !== null && !isBoundedToken(record.state, 80))
    ) {
        return null;
    }
    return Object.freeze({
        state: record.state as string | null,
        count: record.count,
    });
}

function parseFormalProtectionRational(
    value: unknown,
): SmartOrderFormalProtectionRational | null {
    const record = exactObject(value, ['denominator', 'numeratorMinorUnits']);
    if (
        !record ||
        typeof record.numeratorMinorUnits !== 'string' ||
        typeof record.denominator !== 'string' ||
        !/^[1-9]\d*$/.test(record.numeratorMinorUnits) ||
        !/^[1-9]\d*$/.test(record.denominator) ||
        record.numeratorMinorUnits.length > 32 ||
        record.denominator.length > 32 ||
        !Number.isSafeInteger(Number(record.numeratorMinorUnits)) ||
        !Number.isSafeInteger(Number(record.denominator))
    ) {
        return null;
    }
    return Object.freeze({
        numeratorMinorUnits: record.numeratorMinorUnits,
        denominator: record.denominator,
    });
}

function parseFormalProtectionView(
    value: unknown,
): SmartOrderFormalProtectionView | null {
    if (value === null) return null;
    const record = exactObject(value, [
        'accountIdentifiersExposed',
        'asOfEpochMs',
        'cumulativeFilledShares',
        'entityIdentifiersExposed',
        'estimatedBasis',
        'formalBasis',
        'legs',
        'schemaVersion',
        'state',
    ]);
    const estimatedBasis = parseFormalProtectionRational(record?.estimatedBasis);
    const formalBasis = parseFormalProtectionRational(record?.formalBasis);
    if (
        !record ||
        record.schemaVersion !==
            'smart-order-formal-protection-view/2026-08-13.1' ||
        (record.state !== 'formal' && record.state !== 'pending_saved_high') ||
        !isRevision(record.cumulativeFilledShares) ||
        record.cumulativeFilledShares < 1 ||
        !isEpoch(record.asOfEpochMs) ||
        !estimatedBasis ||
        !formalBasis ||
        !Array.isArray(record.legs) ||
        record.legs.length < 1 ||
        record.legs.length > 3 ||
        record.accountIdentifiersExposed !== false ||
        record.entityIdentifiersExposed !== false
    ) {
        return null;
    }
    const allowedTypes = new Set([
        'stop',
        'take',
        'trailing_activation',
        'trailing_retracement',
        'fixed_stop',
    ]);
    const legs = record.legs.map((value) => {
        const leg = exactObject(value, [
            'comparator',
            'differsFromEstimate',
            'estimatedTriggerPrice',
            'formalTriggerPrice',
            'triggerBasis',
            'triggerState',
            'type',
        ]);
        if (
            !leg ||
            !allowedTypes.has(String(leg.type)) ||
            (leg.comparator !== 'lte' && leg.comparator !== 'gte') ||
            (leg.triggerState !== 'formal' &&
                leg.triggerState !== 'pending_saved_high') ||
            (leg.triggerBasis !== 'weighted_average_fill' &&
                leg.triggerBasis !== 'durable_saved_high')
        ) {
            return null;
        }
        const estimatedTriggerPrice =
            leg.estimatedTriggerPrice === null
                ? null
                : parseFormalProtectionRational(leg.estimatedTriggerPrice);
        const formalTriggerPrice =
            leg.formalTriggerPrice === null
                ? null
                : parseFormalProtectionRational(leg.formalTriggerPrice);
        const pending = leg.triggerState === 'pending_saved_high';
        if (
            (pending &&
                (leg.triggerBasis !== 'durable_saved_high' ||
                    estimatedTriggerPrice !== null ||
                    formalTriggerPrice !== null ||
                    leg.differsFromEstimate !== null)) ||
            (!pending &&
                (leg.triggerBasis !== 'weighted_average_fill' ||
                    !estimatedTriggerPrice ||
                    !formalTriggerPrice ||
                    typeof leg.differsFromEstimate !== 'boolean'))
        ) {
            return null;
        }
        return Object.freeze({
            type: leg.type as SmartOrderFormalProtectionView['legs'][number]['type'],
            comparator: leg.comparator,
            triggerState: leg.triggerState,
            triggerBasis: leg.triggerBasis,
            estimatedTriggerPrice,
            formalTriggerPrice,
            differsFromEstimate: leg.differsFromEstimate,
        }) as SmartOrderFormalProtectionView['legs'][number];
    });
    if (
        legs.some((leg) => leg === null) ||
        new Set(legs.map((leg) => leg?.type)).size !== legs.length ||
        (record.state === 'pending_saved_high') !==
            legs.some((leg) => leg?.triggerState === 'pending_saved_high')
    ) {
        return null;
    }
    return Object.freeze({
        schemaVersion: record.schemaVersion,
        state: record.state,
        cumulativeFilledShares: record.cumulativeFilledShares,
        asOfEpochMs: record.asOfEpochMs,
        estimatedBasis,
        formalBasis,
        legs: Object.freeze(
            legs as SmartOrderFormalProtectionView['legs'][number][],
        ),
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
    });
}

function parseActiveActivity(
    value: unknown,
): SmartOrderActiveActivitySnapshot | null {
    const record = exactObject(value, [
        'accountIdentifiersExposed',
        'activations',
        'brokerOrders',
        'displayState',
        'entityIdentifiersExposed',
        'entryExposureReservations',
        'exitClaims',
        'formalProtection',
        'hasRuntimeTrackedUnprotectedRemainder',
        'hasUnknownExitClaim',
        'intents',
        'protectionCommitments',
        'protectionObligations',
        'runtimeTrackedUnprotectedRemainder',
        'resolutionCases',
        'safetyBlockers',
        'schemaVersion',
    ]);
    if (
        !record ||
        record.schemaVersion !==
            'smart-order-active-activity/2026-08-13.3' ||
        !isBoundedToken(record.displayState, 80) ||
        record.accountIdentifiersExposed !== false ||
        record.entityIdentifiersExposed !== false ||
        typeof record.hasRuntimeTrackedUnprotectedRemainder !== 'boolean' ||
        typeof record.hasUnknownExitClaim !== 'boolean'
    ) {
        return null;
    }
    const unprotected = exactObject(record.runtimeTrackedUnprotectedRemainder, [
        'asOfEpochMs',
        'current',
        'lastKnownShares',
        'state',
    ]);
    if (
        !unprotected ||
        (unprotected.state !== 'none' &&
            unprotected.state !== 'last_known') ||
        !isEpoch(unprotected.lastKnownShares) ||
        (unprotected.asOfEpochMs !== null &&
            !isEpoch(unprotected.asOfEpochMs)) ||
        unprotected.current !== false ||
        (unprotected.state === 'none' &&
            (unprotected.lastKnownShares !== 0 ||
                unprotected.asOfEpochMs !== null)) ||
        (unprotected.state === 'last_known' &&
            (unprotected.lastKnownShares === 0 ||
                unprotected.asOfEpochMs === null)) ||
        record.hasRuntimeTrackedUnprotectedRemainder !==
            (unprotected.lastKnownShares > 0)
    ) {
        return null;
    }
    const activations = parseActivityComponent(record.activations);
    const intents = parseActivityComponent(record.intents);
    const brokerOrders = parseActivityComponent(record.brokerOrders);
    const protectionCommitments = parseActivityComponent(
        record.protectionCommitments,
    );
    const protectionObligations = parseActivityComponent(
        record.protectionObligations,
    );
    const entryExposureReservations = parseActivityComponent(
        record.entryExposureReservations,
    );
    const exitClaims = parseActivityComponent(record.exitClaims);
    const resolutionCases = parseActivityComponent(record.resolutionCases);
    const safetyBlockers = parseActivityComponent(record.safetyBlockers);
    const formalProtection = parseFormalProtectionView(record.formalProtection);
    if (
        !activations ||
        !intents ||
        !brokerOrders ||
        !protectionCommitments ||
        !protectionObligations ||
        !entryExposureReservations ||
        !exitClaims ||
        !resolutionCases ||
        !safetyBlockers ||
        (record.formalProtection !== null && !formalProtection)
    ) {
        return null;
    }
    return Object.freeze({
        schemaVersion: record.schemaVersion,
        displayState: record.displayState,
        activations,
        intents,
        brokerOrders,
        protectionCommitments,
        protectionObligations,
        entryExposureReservations,
        exitClaims,
        resolutionCases,
        safetyBlockers,
        formalProtection,
        hasRuntimeTrackedUnprotectedRemainder:
            record.hasRuntimeTrackedUnprotectedRemainder,
        runtimeTrackedUnprotectedRemainder: Object.freeze({
            state: unprotected.state,
            lastKnownShares: unprotected.lastKnownShares,
            asOfEpochMs: unprotected.asOfEpochMs,
            current: false,
        }),
        hasUnknownExitClaim: record.hasUnknownExitClaim,
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
    });
}

function parseStrategySnapshot(
    value: unknown,
    errorCode = 'invalid_strategy_result',
): SmartOrderStrategySnapshot {
    const record = exactObject(
        value,
        [
            'accountBound',
            'createdAtEpochMs',
            'definitionHash',
            'revision',
            'state',
            'strategyId',
            'strategyKind',
            'updatedAtEpochMs',
        ],
        [
            'activity',
            'blockers',
            'definition',
            'maskedAccountLabel',
            'replayed',
            'terminalAtEpochMs',
        ],
    );
    const kind = strategyKind(record?.strategyKind);
    const state = strategyState(record?.state);
    if (
        !record ||
        !isBoundedToken(record.strategyId) ||
        !kind ||
        !state ||
        typeof record.definitionHash !== 'string' ||
        !SHA256_PATTERN.test(record.definitionHash) ||
        typeof record.accountBound !== 'boolean' ||
        (record.maskedAccountLabel !== undefined &&
            record.maskedAccountLabel !== null &&
            (!isBoundedToken(record.maskedAccountLabel, 80) ||
                !record.maskedAccountLabel.startsWith('固定帳號'))) ||
        (record.accountBound === false &&
            record.maskedAccountLabel !== undefined &&
            record.maskedAccountLabel !== null) ||
        !isEpoch(record.createdAtEpochMs) ||
        !isEpoch(record.updatedAtEpochMs) ||
        record.updatedAtEpochMs < record.createdAtEpochMs ||
        !isRevision(record.revision) ||
        (record.terminalAtEpochMs !== undefined &&
            (!isEpoch(record.terminalAtEpochMs) ||
                record.terminalAtEpochMs < record.createdAtEpochMs ||
                record.terminalAtEpochMs > record.updatedAtEpochMs)) ||
        (record.replayed !== undefined && typeof record.replayed !== 'boolean') ||
        (record.blockers !== undefined &&
            (!Array.isArray(record.blockers) ||
                record.blockers.length > 64 ||
                record.blockers.some((item) => !isBoundedToken(item, 160)))) ||
        (record.definition !== undefined &&
            (record.definition === null ||
                typeof record.definition !== 'object' ||
                Array.isArray(record.definition)))
    ) {
        return invalidRuntimeResponse(errorCode);
    }
    let activity: SmartOrderActiveActivitySnapshot | undefined;
    if (record.activity !== undefined) {
        const parsedActivity = parseActiveActivity(record.activity);
        if (!parsedActivity) return invalidRuntimeResponse(errorCode);
        activity = parsedActivity;
    }
    const definition =
        record.definition === undefined
            ? undefined
            : (freezeJsonValue(record.definition, { nodes: 0 }) as Readonly<
                  Record<string, unknown>
              >);
    const blockers =
        record.blockers === undefined
            ? undefined
            : Object.freeze([...(record.blockers as string[])]);
    return Object.freeze({
        strategyId: record.strategyId,
        strategyKind: kind,
        state,
        definitionHash: record.definitionHash,
        accountBound: record.accountBound,
        ...(record.maskedAccountLabel === undefined
            ? {}
            : {
                  maskedAccountLabel: record.maskedAccountLabel as
                      | string
                      | null,
              }),
        createdAtEpochMs: record.createdAtEpochMs,
        updatedAtEpochMs: record.updatedAtEpochMs,
        ...(record.terminalAtEpochMs === undefined
            ? {}
            : { terminalAtEpochMs: record.terminalAtEpochMs }),
        revision: record.revision,
        ...(activity === undefined ? {} : { activity }),
        ...(definition === undefined ? {} : { definition }),
        ...(blockers === undefined ? {} : { blockers }),
        ...(record.replayed === undefined
            ? {}
            : { replayed: record.replayed }),
    });
}

function parseMutationResponse(
    value: unknown,
    errorCode: string,
): MutationResponse<SmartOrderStrategySnapshot> {
    const record = exactObject(value, [
        'brokerWriteAttempted',
        'result',
        'resultHash',
    ]);
    if (
        !record ||
        record.brokerWriteAttempted !== false ||
        typeof record.resultHash !== 'string' ||
        !SHA256_PATTERN.test(record.resultHash)
    ) {
        return invalidRuntimeResponse(errorCode);
    }
    return Object.freeze({
        result: parseStrategySnapshot(record.result, errorCode),
        resultHash: record.resultHash,
        brokerWriteAttempted: false,
    });
}

function parseMutationResponseRaw(
    value: unknown,
    errorCode: string,
): Readonly<{
    result: unknown;
    resultHash: string;
    brokerWriteAttempted: false;
}> {
    const record = exactObject(value, [
        'brokerWriteAttempted',
        'result',
        'resultHash',
    ]);
    if (
        !record ||
        record.brokerWriteAttempted !== false ||
        typeof record.resultHash !== 'string' ||
        !SHA256_PATTERN.test(record.resultHash)
    ) {
        return invalidRuntimeResponse(errorCode);
    }
    return Object.freeze({
        result: record.result,
        resultHash: record.resultHash,
        brokerWriteAttempted: false,
    });
}

function parseFeatureGates(
    value: unknown,
    errorCode: string,
): Readonly<Record<SmartOrderStrategyKind, boolean>> {
    const record = exactObject(value, SMART_ORDER_STRATEGY_KINDS);
    if (
        !record ||
        SMART_ORDER_STRATEGY_KINDS.some(
            (kind) => typeof record[kind] !== 'boolean',
        )
    ) {
        return invalidRuntimeResponse(errorCode);
    }
    return Object.freeze(
        Object.fromEntries(
            SMART_ORDER_STRATEGY_KINDS.map((kind) => [kind, record[kind]]),
        ) as Record<SmartOrderStrategyKind, boolean>,
    );
}

function parseGateStatus(value: unknown): SmartOrderGateStatus {
    const record = exactObject(
        value,
        [
            'authoritativeForDispatch',
            'blocker',
            'featureGates',
            'present',
            'state',
        ],
        ['validUntilEpochMs'],
    );
    if (
        !record ||
        typeof record.present !== 'boolean' ||
        (record.state !== 'eligible' && record.state !== 'observe_only') ||
        !isBoundedToken(record.blocker, 160) ||
        record.authoritativeForDispatch !== false ||
        (record.validUntilEpochMs !== undefined &&
            !isEpoch(record.validUntilEpochMs))
    ) {
        return invalidRuntimeResponse('invalid_readiness_response');
    }
    return Object.freeze({
        present: record.present,
        state: record.state,
        blocker: record.blocker,
        ...(record.validUntilEpochMs === undefined
            ? {}
            : { validUntilEpochMs: record.validUntilEpochMs }),
        featureGates: parseFeatureGates(
            record.featureGates,
            'invalid_readiness_response',
        ),
        authoritativeForDispatch: false,
    });
}

function parseReadinessResponse(value: unknown): SmartOrderReadinessSnapshot {
    const record = exactObject(value, [
        'blockers',
        'gates',
        'lifecycle',
        'quote',
        'ready',
        'runtime',
        'writeMaster',
    ]);
    const runtime = exactObject(record?.runtime, [
        'dispatchAllowedByRepository',
        'mode',
        'repositoryReady',
        'role',
        'state',
    ]);
    const quote = exactObject(record?.quote, [
        'asOfExchangeTime',
        'authoritativeForActivation',
        'state',
    ]);
    const gates = exactObject(record?.gates, [
        'automation',
        'gate_probe',
        'manual_user_confirmed',
    ]);
    const lifecycle = exactObject(record?.lifecycle, [
        'accountIdentifiersExposed',
        'activeObligationCount',
        'blockerCount',
        'drainItems',
        'drainRecords',
        'drainRecordsTruncated',
        'entityIdentifiersExposed',
        'gracefulStopAllowed',
        'gracefulStopBlockerCount',
        'productionReadonlyBlockerCount',
        'productionReadonlyDrainAllowed',
        'reconciliation',
        'runtimeTrackedUnprotectedRemainder',
        'schemaVersion',
        'state',
        'strategyDefinitionsExposed',
        'uninstallAllowed',
        'uninstallBlockerCount',
        'writeMaster',
    ]);
    const lifecycleRemainder = exactObject(
        lifecycle?.runtimeTrackedUnprotectedRemainder,
        [
            'conservativeMaximumShares',
            'currentAccountReconciliationRequired',
            'shares',
            'state',
        ],
    );
    const nullableCount = (candidate: unknown) =>
        candidate === null || isEpoch(candidate);
    const lifecycleItems = Array.isArray(lifecycle?.drainItems)
        ? lifecycle.drainItems.map((value) =>
              exactObject(value, ['count', 'disposition', 'kind']),
          )
        : null;
    const lifecycleRecords = Array.isArray(lifecycle?.drainRecords)
        ? lifecycle.drainRecords.map((value) =>
              exactObject(value, [
                  'disposition',
                  'kind',
                  'ordinal',
                  'quantityShares',
                  'quantityState',
                  'state',
              ]),
          )
        : null;
    const lifecycleItemCount = lifecycleItems?.reduce(
        (total, item) => total + (isEpoch(item?.count) ? item.count : 0),
        0,
    );
    const lifecycleVerified =
        lifecycle?.schemaVersion ===
            'smart-order-lifecycle-audit/2026-08-12.4' &&
        lifecycle.state === 'verified_repository_projection';
    const lifecycleUnavailable =
        lifecycle?.schemaVersion === 'smart-order-lifecycle-audit/unavailable' &&
        lifecycle.state === 'unverified' &&
        lifecycle.reconciliation === 'required_before_any_write_or_drain' &&
        lifecycle.activeObligationCount === null &&
        lifecycle.blockerCount === null &&
        lifecycle.productionReadonlyBlockerCount === null &&
        lifecycle.gracefulStopBlockerCount === null &&
        lifecycle.uninstallBlockerCount === null &&
        lifecycle.productionReadonlyDrainAllowed === false &&
        lifecycle.gracefulStopAllowed === false &&
        lifecycle.uninstallAllowed === false &&
        lifecycleItems?.length === 0 &&
        lifecycleRecords?.length === 0 &&
        lifecycle.drainRecordsTruncated === true &&
        lifecycleRemainder?.state === 'unknown' &&
        lifecycleRemainder.shares === null &&
        lifecycleRemainder.conservativeMaximumShares === null &&
        lifecycleRemainder.currentAccountReconciliationRequired === true;
    if (
        !record ||
        record.ready !== false ||
        record.writeMaster !== 'disabled' ||
        !runtime ||
        runtime.mode !== 'simulation' ||
        !['primary', 'secondary_readonly', 'unknown'].includes(
            String(runtime.role),
        ) ||
        !isBoundedToken(runtime.state, 64) ||
        typeof runtime.repositoryReady !== 'boolean' ||
        typeof runtime.dispatchAllowedByRepository !== 'boolean' ||
        !quote ||
        !['fresh', 'stale', 'unverified'].includes(String(quote.state)) ||
        (quote.state === 'unverified'
            ? quote.asOfExchangeTime !== null
            : typeof quote.asOfExchangeTime !== 'string' ||
              !isBoundedToken(quote.asOfExchangeTime, 80) ||
              (() => {
                  try {
                      return (
                          new Date(quote.asOfExchangeTime).toISOString() !==
                          quote.asOfExchangeTime
                      );
                  } catch {
                      return true;
                  }
              })()) ||
        quote.authoritativeForActivation !== false ||
        !gates ||
        !lifecycle ||
        (!lifecycleVerified && !lifecycleUnavailable) ||
        lifecycle.writeMaster !== 'disabled' ||
        !isBoundedToken(lifecycle.reconciliation, 80) ||
        !nullableCount(lifecycle.blockerCount) ||
        !nullableCount(lifecycle.productionReadonlyBlockerCount) ||
        !nullableCount(lifecycle.gracefulStopBlockerCount) ||
        !nullableCount(lifecycle.uninstallBlockerCount) ||
        typeof lifecycle.productionReadonlyDrainAllowed !== 'boolean' ||
        typeof lifecycle.gracefulStopAllowed !== 'boolean' ||
        typeof lifecycle.uninstallAllowed !== 'boolean' ||
        lifecycle.accountIdentifiersExposed !== false ||
        lifecycle.entityIdentifiersExposed !== false ||
        lifecycle.strategyDefinitionsExposed !== false ||
        !lifecycleRemainder ||
        !['known', 'unknown'].includes(String(lifecycleRemainder.state)) ||
        !nullableCount(lifecycleRemainder.shares) ||
        !nullableCount(lifecycleRemainder.conservativeMaximumShares) ||
        typeof lifecycleRemainder.currentAccountReconciliationRequired !==
            'boolean' ||
        !lifecycleItems ||
        lifecycleItems.length > 16 ||
        lifecycleItems.some(
            (item) =>
                !item ||
                typeof item.kind !== 'string' ||
                !Object.prototype.hasOwnProperty.call(
                    LIFECYCLE_DRAIN_DISPOSITION_BY_KIND,
                    item.kind,
                ) ||
                !isEpoch(item.count) ||
                item.disposition !==
                    LIFECYCLE_DRAIN_DISPOSITION_BY_KIND[
                        item.kind as keyof typeof LIFECYCLE_DRAIN_DISPOSITION_BY_KIND
                    ],
        ) ||
        new Set(lifecycleItems.map((item) => item!.kind)).size !==
            lifecycleItems.length ||
        (lifecycleVerified &&
            (lifecycleItems.length !==
                Object.keys(LIFECYCLE_DRAIN_DISPOSITION_BY_KIND).length ||
                Object.keys(LIFECYCLE_DRAIN_DISPOSITION_BY_KIND).some(
                    (kind) =>
                        !lifecycleItems.some((item) => item!.kind === kind),
                ) ||
                !Number.isSafeInteger(lifecycleItemCount) ||
                lifecycleItemCount !== lifecycle.gracefulStopBlockerCount)) ||
        !lifecycleRecords ||
        lifecycleRecords.length > 100 ||
        typeof lifecycle.drainRecordsTruncated !== 'boolean' ||
        lifecycleRecords.some((item, index) => {
            if (
                !item ||
                item.ordinal !== index + 1 ||
                typeof item.kind !== 'string' ||
                !Object.prototype.hasOwnProperty.call(
                    LIFECYCLE_DRAIN_DISPOSITION_BY_KIND,
                    item.kind,
                )
            ) {
                return true;
            }
            const kind = item.kind as keyof typeof LIFECYCLE_DRAIN_DISPOSITION_BY_KIND;
            const quantityState = item.quantityState as string;
            return (
                !LIFECYCLE_DRAIN_STATES_BY_KIND[kind].includes(
                    item.state as never,
                ) ||
                !LIFECYCLE_DRAIN_QUANTITY_STATES_BY_KIND[kind].includes(
                    quantityState as never,
                ) ||
                item.disposition !==
                    LIFECYCLE_DRAIN_DISPOSITION_BY_KIND[kind] ||
                (quantityState === 'not_applicable'
                    ? item.quantityShares !== null
                    : !isEpoch(item.quantityShares))
            );
        }) ||
        (!lifecycle.drainRecordsTruncated &&
            lifecycle.gracefulStopBlockerCount !== null &&
            lifecycleRecords.length !==
                lifecycle.gracefulStopBlockerCount) ||
        (lifecycleVerified &&
            (!isEpoch(lifecycle.activeObligationCount) ||
                !isEpoch(lifecycle.blockerCount) ||
                !isEpoch(lifecycle.productionReadonlyBlockerCount) ||
                !isEpoch(lifecycle.gracefulStopBlockerCount) ||
                !isEpoch(lifecycle.uninstallBlockerCount))) ||
        !Array.isArray(record.blockers) ||
        record.blockers.length > 64 ||
        record.blockers.some((item) => !isBoundedToken(item, 160))
    ) {
        return invalidRuntimeResponse('invalid_readiness_response');
    }
    return Object.freeze({
        ready: false,
        writeMaster: 'disabled',
        runtime: Object.freeze({
            mode: 'simulation',
            role: runtime.role as 'primary' | 'secondary_readonly' | 'unknown',
            state: runtime.state,
            repositoryReady: runtime.repositoryReady,
            dispatchAllowedByRepository: runtime.dispatchAllowedByRepository,
        }),
        quote: Object.freeze({
            state: quote.state as 'fresh' | 'stale' | 'unverified',
            asOfExchangeTime: quote.asOfExchangeTime as string | null,
            authoritativeForActivation: quote.authoritativeForActivation,
        }),
        lifecycle: Object.freeze({
            state: lifecycle.state as
                | 'verified_repository_projection'
                | 'unverified',
            reconciliation: lifecycle.reconciliation as string,
            blockerCount: lifecycle.blockerCount as number | null,
            productionReadonlyBlockerCount:
                lifecycle.productionReadonlyBlockerCount as number | null,
            gracefulStopBlockerCount:
                lifecycle.gracefulStopBlockerCount as number | null,
            uninstallBlockerCount:
                lifecycle.uninstallBlockerCount as number | null,
            productionReadonlyDrainAllowed:
                lifecycle.productionReadonlyDrainAllowed,
            gracefulStopAllowed: lifecycle.gracefulStopAllowed,
            uninstallAllowed: lifecycle.uninstallAllowed,
            drainItems: Object.freeze(
                lifecycleItems.map((item) =>
                    Object.freeze({
                        kind: item!.kind as string,
                        count: item!.count as number,
                        disposition: item!.disposition as string,
                    }),
                ),
            ),
            drainRecords: Object.freeze(
                lifecycleRecords.map((item) =>
                    Object.freeze({
                        ordinal: item!.ordinal as number,
                        kind: item!.kind as string,
                        state: item!.state as string,
                        quantityShares: item!.quantityShares as number | null,
                        quantityState: item!.quantityState as
                            | 'not_applicable'
                            | 'exact'
                            | 'conservative_maximum',
                        disposition: item!.disposition as string,
                    }),
                ),
            ),
            drainRecordsTruncated: lifecycle.drainRecordsTruncated,
            runtimeTrackedUnprotectedRemainder: Object.freeze({
                state: lifecycleRemainder.state as 'known' | 'unknown',
                shares: lifecycleRemainder.shares as number | null,
                conservativeMaximumShares:
                    lifecycleRemainder.conservativeMaximumShares as
                        | number
                        | null,
                currentAccountReconciliationRequired:
                    lifecycleRemainder.currentAccountReconciliationRequired,
            }),
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        }),
        gates: Object.freeze({
            automation: parseGateStatus(gates.automation),
            manual_user_confirmed: parseGateStatus(
                gates.manual_user_confirmed,
            ),
            gate_probe: parseGateStatus(gates.gate_probe),
        }),
        blockers: Object.freeze([...(record.blockers as string[])]),
    });
}

function parseStrategyListResponse(
    value: unknown,
): readonly SmartOrderStrategySnapshot[] {
    const record = exactObject(value, [
        'accountIdentifiersExposed',
        'source',
        'strategies',
    ]);
    if (
        !record ||
        record.source !== 'runtime_snapshot' ||
        record.accountIdentifiersExposed !== false ||
        !Array.isArray(record.strategies) ||
        record.strategies.length > 100
    ) {
        return invalidRuntimeResponse('invalid_strategy_list_response');
    }
    const strategies = record.strategies.map((candidate) =>
        parseStrategySnapshot(candidate, 'invalid_strategy_list_response'),
    );
    if (new Set(strategies.map((strategy) => strategy.strategyId)).size !== strategies.length) {
        return invalidRuntimeResponse('invalid_strategy_list_response');
    }
    return Object.freeze(strategies);
}

const SMART_ORDER_RISK_DIMENSIONS = Object.freeze([
    'quantityShares',
    'notionalMinorUnits',
    'cashMinorUnits',
    'positionShares',
    'orderCount',
] as const satisfies readonly (keyof SmartOrderRiskLimitVector)[]);

function parseRiskLimitVector(
    value: unknown,
): SmartOrderRiskLimitVector | null {
    const record = exactObject(value, SMART_ORDER_RISK_DIMENSIONS);
    if (
        !record ||
        SMART_ORDER_RISK_DIMENSIONS.some(
            (dimension) =>
                record[dimension] !== null && !isEpoch(record[dimension]),
        )
    ) {
        return null;
    }
    return Object.freeze(
        Object.fromEntries(
            SMART_ORDER_RISK_DIMENSIONS.map((dimension) => [
                dimension,
                record[dimension] as number | null,
            ]),
        ),
    ) as unknown as SmartOrderRiskLimitVector;
}

function parseRuntimeRiskPolicyView(
    value: unknown,
): SmartOrderRuntimeRiskPolicyView {
    const record = exactObject(
        value,
        [
            'accountIdentifiersExposed',
            'brokerWriteAuthority',
            'exposureHeadsCurrent',
            'identityIdentifiersExposed',
            'policy',
            'policyHash',
            'revision',
            'schemaVersion',
            'state',
        ],
        [
            'dispatchAllowed',
            'publishedAtEpochMs',
            'replayed',
            'runtimeRevision',
            'runtimeState',
        ],
    );
    if (
        !record ||
        record.schemaVersion !==
            'smart-order-runtime-risk-policy-view/2026-08-14.1' ||
        !['missing', 'reconciliation_required', 'current'].includes(
            String(record.state),
        ) ||
        record.brokerWriteAuthority !== false ||
        record.accountIdentifiersExposed !== false ||
        record.identityIdentifiersExposed !== false ||
        typeof record.exposureHeadsCurrent !== 'boolean'
    ) {
        return invalidRuntimeResponse('invalid_risk_policy_response');
    }
    if (record.state === 'missing') {
        if (
            record.revision !== null ||
            record.policyHash !== null ||
            record.policy !== null ||
            record.exposureHeadsCurrent !== false
        ) {
            return invalidRuntimeResponse('invalid_risk_policy_response');
        }
        return Object.freeze({
            schemaVersion:
                'smart-order-runtime-risk-policy-view/2026-08-14.1',
            state: 'missing',
            revision: null,
            policyHash: null,
            policy: null,
            exposureHeadsCurrent: false,
            brokerWriteAuthority: false,
            accountIdentifiersExposed: false,
            identityIdentifiersExposed: false,
        });
    }
    const policy = exactObject(record.policy, [
        'accountDailyLossLimitMinorUnits',
        'accountLimits',
        'executionPolicy',
        'identityDailyLossLimitMinorUnits',
        'identityLimits',
        'policyRevision',
        'reservedDimensions',
        'revision',
        'schemaVersion',
    ]);
    const execution = exactObject(policy?.executionPolicy, [
        'buyFeeBps',
        'cashBufferMinorUnits',
        'minimumBuyFeeMinorUnits',
        'policyRevision',
        'schemaVersion',
    ]);
    const accountLimits = parseRiskLimitVector(policy?.accountLimits);
    const identityLimits = parseRiskLimitVector(policy?.identityLimits);
    if (
        !policy ||
        !execution ||
        policy.schemaVersion !==
            'smart-order-runtime-risk-policy/2026-08-14.1' ||
        execution.schemaVersion !==
            'smart-order-protected-entry-risk-policy/2026-08-13.1' ||
        !isRevision(record.revision) ||
        policy.revision !== record.revision ||
        !isBoundedToken(policy.policyRevision) ||
        execution.policyRevision !== policy.policyRevision ||
        !SHA256_PATTERN.test(String(record.policyHash)) ||
        !isEpoch(record.publishedAtEpochMs) ||
        !isEpoch(execution.buyFeeBps) ||
        (execution.buyFeeBps as number) > 10_000 ||
        !isEpoch(execution.minimumBuyFeeMinorUnits) ||
        !isEpoch(execution.cashBufferMinorUnits) ||
        !isEpoch(policy.accountDailyLossLimitMinorUnits) ||
        !isEpoch(policy.identityDailyLossLimitMinorUnits) ||
        !accountLimits ||
        !identityLimits ||
        !Array.isArray(policy.reservedDimensions) ||
        policy.reservedDimensions.length === 0 ||
        policy.reservedDimensions.some(
            (dimension) =>
                !SMART_ORDER_RISK_DIMENSIONS.includes(
                    dimension as keyof SmartOrderRiskLimitVector,
                ),
        ) ||
        new Set(policy.reservedDimensions).size !==
            policy.reservedDimensions.length
    ) {
        return invalidRuntimeResponse('invalid_risk_policy_response');
    }
    if (
        (record.state === 'current') !==
        (record.exposureHeadsCurrent === true)
    ) {
        return invalidRuntimeResponse('invalid_risk_policy_response');
    }
    return Object.freeze({
        schemaVersion: 'smart-order-runtime-risk-policy-view/2026-08-14.1',
        state: record.state as 'current' | 'reconciliation_required',
        revision: record.revision as number,
        policyHash: record.policyHash as string,
        policy: Object.freeze({
            schemaVersion:
                'smart-order-runtime-risk-policy/2026-08-14.1',
            revision: policy.revision as number,
            policyRevision: policy.policyRevision as string,
            executionPolicy: Object.freeze({
                schemaVersion:
                    'smart-order-protected-entry-risk-policy/2026-08-13.1',
                policyRevision: execution.policyRevision as string,
                buyFeeBps: execution.buyFeeBps as number,
                minimumBuyFeeMinorUnits:
                    execution.minimumBuyFeeMinorUnits as number,
                cashBufferMinorUnits:
                    execution.cashBufferMinorUnits as number,
            }),
            reservedDimensions: Object.freeze([
                ...(policy.reservedDimensions as (keyof SmartOrderRiskLimitVector)[]),
            ]),
            accountLimits,
            identityLimits,
            accountDailyLossLimitMinorUnits:
                policy.accountDailyLossLimitMinorUnits as number,
            identityDailyLossLimitMinorUnits:
                policy.identityDailyLossLimitMinorUnits as number,
        }),
        exposureHeadsCurrent: record.exposureHeadsCurrent,
        publishedAtEpochMs: record.publishedAtEpochMs as number,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        identityIdentifiersExposed: false,
    });
}

const SMART_ORDER_KILL_SWITCH_NAMES = Object.freeze([
    'pause_new_exposure',
    'pause_automation',
    'emergency_block_all_writes',
] as const satisfies readonly SmartOrderKillSwitchName[]);

function parseKillSwitchView(value: unknown): SmartOrderKillSwitchView {
    const record = exactObject(
        value,
        [
            'accountIdentifiersExposed',
            'arbiterRevision',
            'brokerWriteAuthority',
            'denyUnionActive',
            'enabled',
            'identityIdentifiersExposed',
            'schemaVersion',
            'switches',
        ],
        ['changed', 'replayed'],
    );
    const switches = exactObject(record?.switches, SMART_ORDER_KILL_SWITCH_NAMES);
    if (
        !record ||
        !switches ||
        record.schemaVersion !==
            'smart-order-kill-switch-arbiter/2026-08-12.1' ||
        !isRevision(record.arbiterRevision) ||
        typeof record.denyUnionActive !== 'boolean' ||
        record.brokerWriteAuthority !== false ||
        record.accountIdentifiersExposed !== false ||
        record.identityIdentifiersExposed !== false ||
        !Array.isArray(record.enabled) ||
        record.enabled.some(
            (name) =>
                !SMART_ORDER_KILL_SWITCH_NAMES.includes(
                    name as SmartOrderKillSwitchName,
                ),
        ) ||
        new Set(record.enabled).size !== record.enabled.length ||
        (record.changed !== undefined &&
            typeof record.changed !== 'boolean') ||
        (record.replayed !== undefined &&
            typeof record.replayed !== 'boolean')
    ) {
        return invalidRuntimeResponse('invalid_kill_switch_response');
    }
    const parsedSwitches = Object.fromEntries(
        SMART_ORDER_KILL_SWITCH_NAMES.map((name) => {
            const candidate = exactObject(switches[name], [
                'enabled',
                'reasonCode',
                'revision',
                'updatedAtEpochMs',
            ]);
            if (
                !candidate ||
                typeof candidate.enabled !== 'boolean' ||
                !isRevision(candidate.revision) ||
                (candidate.revision as number) >
                    (record.arbiterRevision as number) ||
                !isEpoch(candidate.updatedAtEpochMs) ||
                !isBoundedToken(candidate.reasonCode)
            ) {
                return invalidRuntimeResponse(
                    'invalid_kill_switch_response',
                );
            }
            return [
                name,
                Object.freeze({
                    enabled: candidate.enabled,
                    revision: candidate.revision as number,
                    updatedAtEpochMs: candidate.updatedAtEpochMs as number,
                    reasonCode: candidate.reasonCode as string,
                }),
            ];
        }),
    ) as Record<SmartOrderKillSwitchName, Readonly<{
        enabled: boolean;
        revision: number;
        updatedAtEpochMs: number;
        reasonCode: string;
    }>>;
    const expectedEnabled = SMART_ORDER_KILL_SWITCH_NAMES.filter(
        (name) => parsedSwitches[name].enabled,
    );
    if (
        JSON.stringify(record.enabled) !== JSON.stringify(expectedEnabled) ||
        record.denyUnionActive !== (expectedEnabled.length > 0)
    ) {
        return invalidRuntimeResponse('invalid_kill_switch_response');
    }
    return Object.freeze({
        schemaVersion: 'smart-order-kill-switch-arbiter/2026-08-12.1',
        arbiterRevision: record.arbiterRevision as number,
        switches: Object.freeze(parsedSwitches),
        enabled: Object.freeze([...expectedEnabled]),
        denyUnionActive: record.denyUnionActive,
        ...(record.changed === undefined
            ? {}
            : { changed: record.changed as boolean }),
        ...(record.replayed === undefined
            ? {}
            : { replayed: record.replayed as boolean }),
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        identityIdentifiersExposed: false,
    });
}

function parseStrategyGetResponse(
    value: unknown,
    expectedStrategyId: string,
): SmartOrderStrategySnapshot {
    const record = exactObject(value, [
        'accountIdentifiersExposed',
        'source',
        'strategy',
    ]);
    if (
        !record ||
        record.source !== 'runtime_snapshot' ||
        record.accountIdentifiersExposed !== false
    ) {
        return invalidRuntimeResponse('invalid_strategy_result');
    }
    const strategy = parseStrategySnapshot(record.strategy);
    if (strategy.strategyId !== expectedStrategyId) {
        return invalidRuntimeResponse('invalid_strategy_result');
    }
    return strategy;
}

function requireStrategyId(value: string): string {
    if (!isBoundedToken(value)) {
        throw new SmartOrderLocalApiError(422, 'strategy_id_invalid');
    }
    return value;
}

function requireExpectedRevision(value: number): number {
    if (!isRevision(value)) {
        throw new SmartOrderLocalApiError(422, 'expected_revision_invalid');
    }
    return value;
}

export class SmartOrderLocalApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly operationId?: string;
    readonly resultHash?: string;
    readonly latestStrategySnapshot?: SmartOrderStrategySnapshot;

    constructor(
        status: number,
        code: string,
        context: Readonly<{
            operationId?: string;
            resultHash?: string;
            latestStrategySnapshot?: SmartOrderStrategySnapshot;
        }> = {},
    ) {
        super(
            code === 'broker_write_gate_closed'
                ? 'SmartOrder 交易寫入 Gate 尚未完成；本次委託未送出，請使用券商官方管道人工處置'
                : `smart-order local API rejected the request: ${code}`,
        );
        this.name = 'SmartOrderLocalApiError';
        this.status = status;
        this.code = code;
        this.operationId = context.operationId;
        this.resultHash = context.resultHash;
        this.latestStrategySnapshot = context.latestStrategySnapshot;
    }
}

export function assertSmartOrderBrowserGatewayAvailable(): void {
    if (!SMART_ORDER_BROWSER_GATEWAY_AVAILABLE) {
        throw new SmartOrderLocalApiError(
            503,
            'smart_order_local_gateway_unavailable',
        );
    }
}

export type SmartOrderStockWriteRouteId =
    | 'STK-MAN-PLACE-TICKET'
    | 'STK-MAN-PLACE-CHART'
    | 'STK-MAN-PLACE-FLASH'
    | 'STK-MAN-PLACE-FLASH-FLAT'
    | 'STK-MAN-PLACE-POSITION-CLOSE'
    | 'STK-MAN-PLACE-POSITION-REVERSE'
    | 'STK-MAN-PLACE-GRID-ONCE'
    | 'STK-AUTO-PLACE-GRID-FOLLOW'
    | 'STK-MAN-UPDATE-ORDER-PRICE'
    | 'STK-MAN-UPDATE-ORDER-QTY'
    | 'STK-MAN-UPDATE-CHART-DRAG'
    | 'STK-MAN-CANCEL-ORDER-TABLE'
    | 'STK-MAN-CANCEL-CHART'
    | 'STK-MAN-CANCEL-FLASH-PRICE'
    | 'STK-MAN-CANCEL-FLASH-SYMBOL'
    | 'STK-MAN-CANCEL-GRID-ALL'
    | 'STK-MAN-CANCEL-HOTKEY-ALL'
    | 'STK-AUTO-CANCEL-GRID-FOLLOW';

export type SmartOrderManualStockBrokerWriteRequest = Readonly<{
    schemaVersion: 'smart-order-manual-broker-write-request/2026-08-14.1';
    operation: 'place' | 'update_price' | 'update_quantity' | 'cancel';
    brokerPath:
        | '/api/v1/order/place_order'
        | '/api/v1/order/update_price'
        | '/api/v1/order/update_qty'
        | '/api/v1/order/cancel_order';
    payload: unknown;
}>;

export function submitManualStockBrokerWrite(
    routeId: SmartOrderStockWriteRouteId,
    manualRequest: SmartOrderManualStockBrokerWriteRequest,
): Promise<never> {
    return request<never>(`/v1/trading-write/${routeId}`, {
        method: 'POST',
        body: {
            operationId: crypto.randomUUID(),
            request: manualRequest,
        },
    });
}

export class SmartOrderLogicalOperationRegistry {
    readonly #operations = new Map<
        string,
        Readonly<{ fingerprint: string; operationId: string }>
    >();

    operationIdFor(slot: string, fingerprint: string): string {
        if (!slot || !fingerprint) {
            throw new TypeError('logical mutation slot and fingerprint are required');
        }
        const current = this.#operations.get(slot);
        if (current?.fingerprint === fingerprint) return current.operationId;
        const operationId = crypto.randomUUID();
        this.#operations.set(slot, { fingerprint, operationId });
        return operationId;
    }

    settle(slot: string, failure?: unknown): void {
        if (
            failure === undefined ||
            (failure instanceof SmartOrderLocalApiError &&
                failure.resultHash !== undefined &&
                !UNRESOLVED_OPERATION_CODES.has(failure.code))
        ) {
            this.#operations.delete(slot);
        }
    }
}

async function readJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        throw new SmartOrderLocalApiError(response.status, 'invalid_response');
    }
    return response.json();
}

async function acquireMutationCsrfToken(): Promise<string> {
    assertSmartOrderBrowserGatewayAvailable();
    const response = await fetch(`${GATEWAY_PREFIX}${CSRF_ROUTE}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
    });
    const payload = (await readJson(response)) as Record<string, unknown>;
    if (!response.ok) {
        throw new SmartOrderLocalApiError(
            response.status,
            typeof payload?.code === 'string'
                ? payload.code
                : 'csrf_session_unavailable',
        );
    }
    const expectedKeys = [
        'csrfToken',
        'expiresAtEpochMs',
        'schemaVersion',
        'sessionBound',
        'singleUse',
    ];
    const actualKeys = Object.keys(payload).sort();
    if (
        actualKeys.length !== expectedKeys.length ||
        actualKeys.some((key, index) => key !== expectedKeys[index]) ||
        payload.schemaVersion !== CSRF_SCHEMA_VERSION ||
        typeof payload.csrfToken !== 'string' ||
        !CSRF_TOKEN_PATTERN.test(payload.csrfToken) ||
        !Number.isSafeInteger(payload.expiresAtEpochMs) ||
        (payload.expiresAtEpochMs as number) < 0 ||
        payload.sessionBound !== true ||
        payload.singleUse !== true
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_csrf_response');
    }
    return payload.csrfToken;
}

async function request<T>(
    pathname: string,
    init?: Readonly<{ method?: 'POST' | 'PUT'; body?: unknown }>,
): Promise<T> {
    assertSmartOrderBrowserGatewayAvailable();
    const serializedBody =
        init?.body === undefined ? undefined : JSON.stringify(init.body);
    const logicalOperationId =
        init?.body &&
        typeof init.body === 'object' &&
        !Array.isArray(init.body) &&
        typeof (init.body as { operationId?: unknown }).operationId === 'string'
            ? (init.body as { operationId: string }).operationId
            : undefined;
    const attempts = serializedBody === undefined ? 1 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        let mutationInit:
            | Readonly<{ headers: Record<string, string>; body: string }>
            | undefined;
        if (serializedBody !== undefined) {
            const csrfToken = await acquireMutationCsrfToken();
            mutationInit = {
                headers: {
                    'Content-Type': 'application/json',
                    [CSRF_HEADER]: csrfToken,
                },
                body: serializedBody,
            };
        }
        let response: Response;
        try {
            response = await fetch(`${GATEWAY_PREFIX}${pathname}`, {
                method: init?.method ?? 'GET',
                ...(mutationInit ?? {}),
                cache: 'no-store',
                credentials: 'same-origin',
                redirect: 'error',
            });
        } catch {
            if (attempt + 1 < attempts) continue;
            throw new SmartOrderLocalApiError(
                503,
                'mutation_transport_ambiguous',
                { operationId: logicalOperationId },
            );
        }
        let payload: { code?: unknown };
        try {
            payload = (await readJson(response)) as { code?: unknown };
        } catch (error) {
            if (attempt + 1 < attempts) continue;
            if (error instanceof SmartOrderLocalApiError) {
                throw new SmartOrderLocalApiError(error.status, error.code, {
                    operationId: logicalOperationId,
                });
            }
            throw error;
        }
        if (response.ok) return payload as T;
        const code =
            typeof payload?.code === 'string' ? payload.code : 'request_failed';
        if (
            attempt + 1 < attempts &&
            response.status >= 500 &&
            code !== 'mutation_service_not_wired'
        ) {
            continue;
        }
        const resultHash =
            typeof (payload as { resultHash?: unknown }).resultHash === 'string' &&
            /^sha256:[0-9a-f]{64}$/.test(
                (payload as { resultHash: string }).resultHash,
            )
                ? (payload as { resultHash: string }).resultHash
                : undefined;
        let latestStrategySnapshot: SmartOrderStrategySnapshot | undefined;
        if (code === 'stale_revision') {
            try {
                latestStrategySnapshot = parseStrategySnapshot(
                    (payload as { latestSnapshot?: unknown }).latestSnapshot,
                    'invalid_strategy_result',
                );
            } catch {
                throw new SmartOrderLocalApiError(
                    502,
                    'invalid_strategy_result',
                    { operationId: logicalOperationId, resultHash },
                );
            }
        }
        throw new SmartOrderLocalApiError(response.status, code, {
            operationId: logicalOperationId,
            resultHash,
            latestStrategySnapshot,
        });
    }
    throw new SmartOrderLocalApiError(503, 'mutation_transport_ambiguous', {
        operationId: logicalOperationId,
    });
}

function mutationOperationId(candidate?: string): string {
    const value = candidate ?? crypto.randomUUID();
    if (!OPERATION_ID_PATTERN.test(value)) {
        throw new SmartOrderLocalApiError(422, 'operation_id_invalid');
    }
    return value;
}

function parseCanonicalConfirmationView(
    value: unknown,
): SmartOrderCanonicalConfirmationView {
    const record = exactObject(
        value,
        [
            'accountIdentifiersExposed',
            'brokerWriteAttempted',
            'brokerWriteAuthority',
            'contract',
            'fixedAccountLabel',
            'modeGeneration',
            'position',
            'resolvedDefinitionHash',
            'riskRevision',
            'runtimeRevision',
            'schemaVersion',
            'snapshotHash',
            'state',
            'strategyId',
            'strategyKind',
            'strategyRevision',
            'validUntilEpochMs',
            'warnings',
        ],
        ['childContract', 'strategy'],
    );
    const contractKeys = [
        'category', 'contractKey', 'contractRevision', 'contractUnit',
        'corporateActionRevision', 'limitDownMinorUnits', 'limitUpMinorUnits',
        'referenceMinorUnits', 'updateDate',
    ];
    const contract = exactObject(record?.contract, contractKeys);
    const childContract =
        record?.childContract === undefined
            ? undefined
            : exactObject(record.childContract, contractKeys);
    const isParentChild = record?.strategyKind === 'parent_child';
    const position =
        record?.position === null
            ? null
            : exactObject(
                  record?.position,
                  isParentChild
                      ? ['asOfEpochMs', 'availableShares', 'quantityShares']
                      : [
                            'asOfEpochMs', 'availableShares',
                            'averageCostState', 'basisPriceMinorUnits',
                            'basisSource', 'quantityShares',
                        ],
              );
    const standardWarnings = [
        'local_runtime_not_broker_cloud',
        'restart_requires_reconciliation_and_user_rearm',
        'broker_write_not_authorized',
    ];
    const parentChildWarnings = [
        'parent_and_child_contracts_are_distinct',
        'child_requires_parent_broker_confirmed_full_fill',
        'child_is_same_trade_date_only',
        'broker_write_not_authorized',
    ];
    const warnings = isParentChild ? parentChildWarnings : standardWarnings;
    const validContract = (candidate: ReturnType<typeof exactObject>) =>
        candidate !== null &&
        typeof candidate.contractKey === 'string' &&
        /^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
            candidate.contractKey,
        ) &&
        ['股票', 'ETF'].includes(String(candidate.category)) &&
        isEpoch(candidate.contractUnit) &&
        Number(candidate.contractUnit) >= 1 &&
        isEpoch(candidate.referenceMinorUnits) &&
        isEpoch(candidate.limitUpMinorUnits) &&
        isEpoch(candidate.limitDownMinorUnits) &&
        SHA256_PATTERN.test(String(candidate.contractRevision)) &&
        SHA256_PATTERN.test(String(candidate.corporateActionRevision)) &&
        typeof candidate.updateDate === 'string';
    if (
        !record ||
        !contract ||
        !validContract(contract) ||
        (isParentChild
            ? !validContract(childContract ?? null)
            : childContract !== undefined) ||
        (record.strategyKind !== 'quick' && !position) ||
        record.schemaVersion !==
            'smart-order-canonical-confirmation/2026-08-20.1' ||
        !['previewed', 'accepted'].includes(String(record.state)) ||
        !['quick', 'parent_child', 'stop_take', 'trailing_exit'].includes(
            String(record.strategyKind),
        ) ||
        !SHA256_PATTERN.test(String(record.snapshotHash)) ||
        !SHA256_PATTERN.test(String(record.resolvedDefinitionHash)) ||
        typeof record.fixedAccountLabel !== 'string' ||
        record.fixedAccountLabel.length < 1 ||
        !isRevision(record.strategyRevision) ||
        !isRevision(record.riskRevision) ||
        !isRevision(record.runtimeRevision) ||
        !isEpoch(record.validUntilEpochMs) ||
        typeof record.modeGeneration !== 'string' ||
        record.brokerWriteAttempted !== false ||
        record.brokerWriteAuthority !== false ||
        record.accountIdentifiersExposed !== false ||
        JSON.stringify(record.warnings) !== JSON.stringify(warnings) ||
        (position !== null &&
            (!isEpoch(position.quantityShares) ||
                Number(position.quantityShares) < 1 ||
                !isEpoch(position.availableShares) ||
                Number(position.availableShares) >
                    Number(position.quantityShares) ||
                (!isParentChild &&
                    (!['available', 'unavailable'].includes(
                        String(position.averageCostState),
                    ) ||
                        !['broker_average_cost', 'user_specified'].includes(
                            String(position.basisSource),
                        ) ||
                        !isEpoch(position.basisPriceMinorUnits) ||
                        Number(position.basisPriceMinorUnits) < 1)) ||
                !isEpoch(position.asOfEpochMs))) ||
        (record.state === 'accepted' && record.strategy === undefined) ||
        (record.state === 'previewed' && record.strategy !== undefined)
    ) {
        return invalidRuntimeResponse(
            'invalid_canonical_confirmation_response',
        );
    }
    const strategy =
        record.strategy === undefined
            ? undefined
            : parseStrategySnapshot(
                  record.strategy,
                  'invalid_canonical_confirmation_response',
              );
    return Object.freeze({
        schemaVersion:
            'smart-order-canonical-confirmation/2026-08-20.1',
        state: record.state as 'previewed' | 'accepted',
        snapshotHash: record.snapshotHash as string,
        strategyId: record.strategyId as string,
        strategyKind: record.strategyKind as
            | 'quick'
            | 'parent_child'
            | 'stop_take'
            | 'trailing_exit',
        strategyRevision: record.strategyRevision as number,
        resolvedDefinitionHash: record.resolvedDefinitionHash as string,
        fixedAccountLabel: record.fixedAccountLabel as string,
        contract: Object.freeze({
            contractKey: contract.contractKey as string,
            category: contract.category as '股票' | 'ETF',
            contractUnit: contract.contractUnit as number,
            referenceMinorUnits: contract.referenceMinorUnits as number,
            limitUpMinorUnits: contract.limitUpMinorUnits as number,
            limitDownMinorUnits: contract.limitDownMinorUnits as number,
            updateDate: contract.updateDate as string,
            contractRevision: contract.contractRevision as string,
            corporateActionRevision:
                contract.corporateActionRevision as string,
        }),
        ...(childContract
            ? {
                  childContract: Object.freeze({
                      contractKey: childContract.contractKey as string,
                      category: childContract.category as '股票' | 'ETF',
                      contractUnit: childContract.contractUnit as number,
                      referenceMinorUnits:
                          childContract.referenceMinorUnits as number,
                      limitUpMinorUnits:
                          childContract.limitUpMinorUnits as number,
                      limitDownMinorUnits:
                          childContract.limitDownMinorUnits as number,
                      updateDate: childContract.updateDate as string,
                      contractRevision:
                          childContract.contractRevision as string,
                      corporateActionRevision:
                          childContract.corporateActionRevision as string,
                  }),
              }
            : {}),
        position:
            position === null
                ? null
                : isParentChild
                  ? Object.freeze({
                        quantityShares: position.quantityShares as number,
                        availableShares: position.availableShares as number,
                        asOfEpochMs: position.asOfEpochMs as number,
                    })
                  : Object.freeze({
                      quantityShares: position.quantityShares as number,
                      availableShares: position.availableShares as number,
                      averageCostState: position.averageCostState as
                          | 'available'
                          | 'unavailable',
                      basisSource: position.basisSource as
                          | 'broker_average_cost'
                          | 'user_specified',
                      basisPriceMinorUnits:
                          position.basisPriceMinorUnits as number,
                      asOfEpochMs: position.asOfEpochMs as number,
                    }),
        riskRevision: record.riskRevision as number,
        modeGeneration: record.modeGeneration as string,
        runtimeRevision: record.runtimeRevision as number,
        validUntilEpochMs: record.validUntilEpochMs as number,
        warnings: Object.freeze([...warnings]),
        brokerWriteAttempted: false,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        ...(strategy ? { strategy } : {}),
    });
}

function parseProtectedEntryDistance(
    value: unknown,
): SmartOrderProtectedEntryDistance | null {
    const absolute = exactObject(value, ['kind', 'value']);
    if (
        absolute?.kind === 'absolute' &&
        typeof absolute.value === 'string' &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(absolute.value) &&
        absolute.value !== '0'
    ) {
        return Object.freeze({ kind: 'absolute', value: absolute.value });
    }
    const percentage = exactObject(value, ['kind', 'pctBps']);
    if (
        percentage?.kind === 'pct_bps' &&
        Number.isSafeInteger(percentage.pctBps) &&
        Number(percentage.pctBps) >= 1 &&
        Number(percentage.pctBps) <= 9_999
    ) {
        return Object.freeze({
            kind: 'pct_bps',
            pctBps: percentage.pctBps as number,
        });
    }
    const atr = exactObject(value, ['kind', 'multiplier']);
    if (
        atr?.kind === 'fixed_atr' &&
        typeof atr.multiplier === 'string' &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(atr.multiplier) &&
        atr.multiplier !== '0'
    ) {
        return Object.freeze({
            kind: 'fixed_atr',
            multiplier: atr.multiplier,
        });
    }
    return null;
}

function parseProtectedEntryProtection(
    value: unknown,
): SmartOrderProtectedEntryConfirmationRequest['protection'] | null {
    const record = exactObject(value, ['family', 'legs']);
    if (
        !record ||
        (record.family !== 'fixed' && record.family !== 'trailing') ||
        !Array.isArray(record.legs) ||
        record.legs.length < 1 ||
        record.legs.length > 3
    ) {
        return null;
    }
    const legs = record.legs.map((candidate) => {
        const leg = exactObject(candidate, [
            'comparator',
            'distance',
            'execution',
            'legId',
            'type',
        ]);
        const execution = exactObject(leg?.execution, [
            'limitPrice',
            'priceType',
            'timeInForce',
        ]);
        const distance = parseProtectedEntryDistance(leg?.distance);
        if (
            !leg ||
            !execution ||
            !distance ||
            !['lte', 'gte'].includes(String(leg.comparator)) ||
            !isBoundedToken(leg.legId, 128) ||
            ![
                'stop',
                'take',
                'trailing_activation',
                'trailing_retracement',
                'fixed_stop',
            ].includes(String(leg.type)) ||
            !['LMT', 'MKT'].includes(String(execution.priceType)) ||
            !['ROD', 'IOC'].includes(String(execution.timeInForce)) ||
            (execution.priceType === 'LMT'
                ? typeof execution.limitPrice !== 'string'
                : execution.limitPrice !== null)
        ) {
            return null;
        }
        return Object.freeze({
            comparator: leg.comparator as 'lte' | 'gte',
            distance,
            execution: Object.freeze({
                priceType: execution.priceType as 'LMT' | 'MKT',
                limitPrice: execution.limitPrice as string | null,
                timeInForce: execution.timeInForce as 'ROD' | 'IOC',
            }),
            legId: leg.legId as string,
            type: leg.type as
                | 'stop'
                | 'take'
                | 'trailing_activation'
                | 'trailing_retracement'
                | 'fixed_stop',
        });
    });
    if (legs.some((leg) => leg === null)) return null;
    return Object.freeze({
        family: record.family,
        legs: Object.freeze(
            legs as NonNullable<
                SmartOrderProtectedEntryConfirmationRequest['protection']
            >['legs'][number][],
        ),
    }) as SmartOrderProtectedEntryConfirmationRequest['protection'];
}

function parseProtectedEntryConfirmationView(
    value: unknown,
): SmartOrderProtectedEntryConfirmationView {
    const record = exactObject(value, [
        'accountIdentifiersExposed',
        'accountReconciliationAsOfEpochMs',
        'brokerWriteAttempted',
        'brokerWriteAuthority',
        'confirmationId',
        'contract',
        'durablePreparationState',
        'entityIdentifiersExposed',
        'entryOrder',
        'fixedAccountLabel',
        'fixedAtrSnapshot',
        'modeGeneration',
        'previewBasis',
        'protection',
        'riskPolicyRevision',
        'riskRevision',
        'runtimeRevision',
        'schemaVersion',
        'simulation',
        'snapshotHash',
        'state',
        'strategyKind',
        'validUntilEpochMs',
        'warnings',
    ]);
    const contract = exactObject(record?.contract, [
        'category',
        'contractKey',
        'contractRevision',
        'contractUnit',
        'corporateActionRevision',
        'updateDate',
    ]);
    const entryOrder = exactObject(record?.entryOrder, [
        'baseShares',
        'commonLots',
        'limitPrice',
        'orderCond',
        'orderLot',
        'priceType',
        'side',
        'timeInForce',
    ]);
    const previewBasis = exactObject(record?.previewBasis, [
        'formalSource',
        'priceDecimal',
        'source',
    ]);
    const protection = parseProtectedEntryProtection(record?.protection);
    const warnings = [
        'local_runtime_not_broker_cloud',
        'entry_not_sent_until_durable_dispatch_gates',
        'restart_requires_reconciliation_and_user_rearm',
        'broker_write_not_authorized',
    ] as const;
    if (
        !record ||
        !contract ||
        !entryOrder ||
        !previewBasis ||
        !protection ||
        record.schemaVersion !==
            'smart-order-protected-entry-confirmation/2026-08-20.1' ||
        !['previewed', 'accepted'].includes(String(record.state)) ||
        !['stop_take', 'trailing_exit'].includes(String(record.strategyKind)) ||
        !OPERATION_ID_PATTERN.test(String(record.confirmationId)) ||
        !SHA256_PATTERN.test(String(record.snapshotHash)) ||
        record.simulation !== true ||
        record.fixedAtrSnapshot !== null ||
        !isBoundedToken(record.fixedAccountLabel, 120) ||
        !isRevision(record.riskRevision) ||
        !isBoundedToken(record.riskPolicyRevision, 240) ||
        !isBoundedToken(record.modeGeneration, 240) ||
        !isRevision(record.runtimeRevision) ||
        !isEpoch(record.accountReconciliationAsOfEpochMs) ||
        !isEpoch(record.validUntilEpochMs) ||
        JSON.stringify(record.warnings) !== JSON.stringify(warnings) ||
        record.durablePreparationState !==
            (record.state === 'accepted' ? 'prepared' : 'none') ||
        record.brokerWriteAttempted !== false ||
        record.brokerWriteAuthority !== false ||
        record.accountIdentifiersExposed !== false ||
        record.entityIdentifiersExposed !== false ||
        !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(
            String(contract.contractKey),
        ) ||
        !['股票', 'ETF'].includes(String(contract.category)) ||
        !isEpoch(contract.contractUnit) ||
        Number(contract.contractUnit) < 1 ||
        !SHA256_PATTERN.test(String(contract.contractRevision)) ||
        !SHA256_PATTERN.test(String(contract.corporateActionRevision)) ||
        typeof contract.updateDate !== 'string' ||
        entryOrder.side !== 'Buy' ||
        entryOrder.orderCond !== 'Cash' ||
        entryOrder.orderLot !== 'Common' ||
        entryOrder.priceType !== 'LMT' ||
        !['ROD', 'IOC'].includes(String(entryOrder.timeInForce)) ||
        typeof entryOrder.limitPrice !== 'string' ||
        !isEpoch(entryOrder.baseShares) ||
        Number(entryOrder.baseShares) < 1 ||
        !isEpoch(entryOrder.commonLots) ||
        Number(entryOrder.commonLots) < 1 ||
        Number(entryOrder.baseShares) !==
            Number(entryOrder.commonLots) * Number(contract.contractUnit) ||
        previewBasis.source !== 'entry_limit_estimate' ||
        previewBasis.formalSource !== 'entry_weighted_average_fill' ||
        previewBasis.priceDecimal !== entryOrder.limitPrice
    ) {
        return invalidRuntimeResponse(
            'invalid_protected_entry_confirmation_response',
        );
    }
    return Object.freeze({
        schemaVersion:
            'smart-order-protected-entry-confirmation/2026-08-20.1',
        state: record.state as 'previewed' | 'accepted',
        snapshotHash: record.snapshotHash as string,
        confirmationId: record.confirmationId as string,
        strategyKind: record.strategyKind as 'stop_take' | 'trailing_exit',
        fixedAccountLabel: record.fixedAccountLabel as string,
        simulation: true,
        contract: Object.freeze({
            contractKey: contract.contractKey as string,
            category: contract.category as '股票' | 'ETF',
            contractUnit: contract.contractUnit as number,
            updateDate: contract.updateDate as string,
            contractRevision: contract.contractRevision as string,
            corporateActionRevision:
                contract.corporateActionRevision as string,
        }),
        entryOrder: Object.freeze({
            side: 'Buy',
            orderCond: 'Cash',
            orderLot: 'Common',
            baseShares: entryOrder.baseShares as number,
            commonLots: entryOrder.commonLots as number,
            priceType: 'LMT',
            limitPrice: entryOrder.limitPrice as string,
            timeInForce: entryOrder.timeInForce as 'ROD' | 'IOC',
        }),
        protection,
        fixedAtrSnapshot: null,
        previewBasis: Object.freeze({
            source: 'entry_limit_estimate',
            priceDecimal: previewBasis.priceDecimal as string,
            formalSource: 'entry_weighted_average_fill',
        }),
        riskRevision: record.riskRevision as number,
        riskPolicyRevision: record.riskPolicyRevision as string,
        modeGeneration: record.modeGeneration as string,
        runtimeRevision: record.runtimeRevision as number,
        accountReconciliationAsOfEpochMs:
            record.accountReconciliationAsOfEpochMs as number,
        validUntilEpochMs: record.validUntilEpochMs as number,
        warnings,
        durablePreparationState: record.durablePreparationState as
            | 'none'
            | 'prepared',
        brokerWriteAttempted: false,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
    });
}

export async function updateSmartOrderDraft(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly draft: SmartOrderCanonicalDraft;
    readonly operationId?: string;
}): Promise<SmartOrderStrategySnapshot> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponse(
        await request<unknown>(`/v1/strategies/${encodeURIComponent(strategyId)}`, {
        method: 'PUT',
        body: {
            operationId,
            expectedRevision,
            draft: input.draft,
        },
        }),
        'invalid_draft_update_result',
    );
    if (
        response.result.strategyId !== strategyId ||
        response.result.state !== 'draft' ||
        response.result.strategyKind !== input.draft.kind ||
        response.result.revision !== expectedRevision + 1
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_draft_update_result');
    }
    return response.result;
}

export type SmartOrderCanonicalConfirmationBasis =
    | Readonly<{ source: 'broker_average_cost' }>
    | Readonly<{
          source: 'user_specified';
          priceDecimal: string;
      }>;

export async function previewSmartOrderCanonicalConfirmation(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly accountBrokerRef: string;
    readonly accountIdRef: string;
    readonly basisSelection: SmartOrderCanonicalConfirmationBasis | null;
    readonly operationId?: string;
}): Promise<SmartOrderCanonicalConfirmationView> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(
                strategyId,
            )}/confirmation-preview`,
            {
                method: 'POST',
                body: {
                    accountBrokerRef: input.accountBrokerRef,
                    accountIdRef: input.accountIdRef,
                    basisSelection: input.basisSelection,
                    confirmationId: operationId,
                    expectedRevision,
                    operationId,
                },
            },
        ),
        'invalid_canonical_confirmation_response',
    );
    const result = parseCanonicalConfirmationView(response.result);
    if (
        result.state !== 'previewed' ||
        result.strategyId !== strategyId ||
        result.strategyRevision !== expectedRevision
    ) {
        throw new SmartOrderLocalApiError(
            502,
            'invalid_canonical_confirmation_response',
        );
    }
    return result;
}

export async function acceptSmartOrderCanonicalConfirmation(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly accountBrokerRef: string;
    readonly accountIdRef: string;
    readonly basisSelection: SmartOrderCanonicalConfirmationBasis | null;
    readonly confirmationId: string;
    readonly snapshotHash: string;
    readonly userAcknowledged: true;
    readonly operationId?: string;
}): Promise<SmartOrderCanonicalConfirmationView> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const confirmationId = mutationOperationId(input.confirmationId);
    const operationId = mutationOperationId(input.operationId);
    if (operationId === confirmationId || !SHA256_PATTERN.test(input.snapshotHash)) {
        throw new SmartOrderLocalApiError(
            422,
            'canonical_confirmation_accept_invalid',
        );
    }
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(
                strategyId,
            )}/confirmation-accept`,
            {
                method: 'POST',
                body: {
                    accountBrokerRef: input.accountBrokerRef,
                    accountIdRef: input.accountIdRef,
                    basisSelection: input.basisSelection,
                    confirmationId,
                    expectedRevision,
                    operationId,
                    snapshotHash: input.snapshotHash,
                    userAcknowledged: true,
                },
            },
        ),
        'invalid_canonical_confirmation_response',
    );
    const result = parseCanonicalConfirmationView(response.result);
    if (
        result.state !== 'accepted' ||
        result.strategyId !== strategyId ||
        result.strategyRevision !== expectedRevision ||
        result.snapshotHash !== input.snapshotHash ||
        result.strategy?.revision !== expectedRevision + 1
    ) {
        throw new SmartOrderLocalApiError(
            502,
            'invalid_canonical_confirmation_response',
        );
    }
    return result;
}

export async function previewSmartOrderProtectedEntryConfirmation(input: {
    readonly confirmationRequest: SmartOrderProtectedEntryConfirmationRequest;
    readonly operationId?: string;
}): Promise<SmartOrderProtectedEntryConfirmationView> {
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>('/v1/protected-entry/confirmation-preview', {
            method: 'POST',
            body: {
                confirmationId: operationId,
                confirmationRequest: input.confirmationRequest,
                operationId,
            },
        }),
        'invalid_protected_entry_confirmation_response',
    );
    const result = parseProtectedEntryConfirmationView(response.result);
    if (
        result.state !== 'previewed' ||
        result.confirmationId !== operationId ||
        result.durablePreparationState !== 'none'
    ) {
        throw new SmartOrderLocalApiError(
            502,
            'invalid_protected_entry_confirmation_response',
        );
    }
    return result;
}

export async function acceptSmartOrderProtectedEntryConfirmation(input: {
    readonly confirmationRequest: SmartOrderProtectedEntryConfirmationRequest;
    readonly confirmationId: string;
    readonly snapshotHash: string;
    readonly userAcknowledged: true;
    readonly operationId?: string;
}): Promise<SmartOrderProtectedEntryConfirmationView> {
    const confirmationId = mutationOperationId(input.confirmationId);
    const operationId = mutationOperationId(input.operationId);
    if (
        confirmationId === operationId ||
        !SHA256_PATTERN.test(input.snapshotHash)
    ) {
        throw new SmartOrderLocalApiError(
            422,
            'protected_entry_confirmation_accept_invalid',
        );
    }
    const response = parseMutationResponseRaw(
        await request<unknown>('/v1/protected-entry/confirmation-accept', {
            method: 'POST',
            body: {
                confirmationId,
                confirmationRequest: input.confirmationRequest,
                operationId,
                snapshotHash: input.snapshotHash,
                userAcknowledged: true,
            },
        }),
        'invalid_protected_entry_confirmation_response',
    );
    const result = parseProtectedEntryConfirmationView(response.result);
    if (
        result.state !== 'accepted' ||
        result.confirmationId !== confirmationId ||
        result.snapshotHash !== input.snapshotHash ||
        result.durablePreparationState !== 'prepared'
    ) {
        throw new SmartOrderLocalApiError(
            502,
            'invalid_protected_entry_confirmation_response',
        );
    }
    return result;
}

export async function fetchSmartOrderReadiness(): Promise<SmartOrderReadinessSnapshot> {
    return parseReadinessResponse(await request<unknown>('/v1/readiness'));
}

export async function fetchSmartOrderRuntimeRiskPolicy(): Promise<SmartOrderRuntimeRiskPolicyView> {
    return parseRuntimeRiskPolicyView(
        await request<unknown>('/v1/risk/policy'),
    );
}

export async function publishSmartOrderRuntimeRiskPolicy(input: {
    readonly expectedRevision: number | null;
    readonly policy: SmartOrderRuntimeRiskPolicyEditorInput;
    readonly operationId?: string;
}): Promise<SmartOrderRuntimeRiskPolicyView> {
    if (
        input.expectedRevision !== null &&
        !isRevision(input.expectedRevision)
    ) {
        throw new SmartOrderLocalApiError(422, 'expected_revision_invalid');
    }
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>('/v1/risk/policy', {
            method: 'PUT',
            body: {
                operationId,
                expectedRevision: input.expectedRevision,
                policy: input.policy,
            },
        }),
        'invalid_risk_policy_response',
    );
    return parseRuntimeRiskPolicyView(response.result);
}

export async function fetchSmartOrderKillSwitch(): Promise<SmartOrderKillSwitchView> {
    return parseKillSwitchView(
        await request<unknown>('/v1/risk/kill-switch'),
    );
}

export async function mutateSmartOrderKillSwitch(input: {
    readonly switchName: SmartOrderKillSwitchName;
    readonly enabled: boolean;
    readonly expectedArbiterRevision: number;
    readonly reasonCode: SmartOrderKillSwitchReasonCode;
    readonly operationId?: string;
}): Promise<SmartOrderKillSwitchView> {
    const expectedArbiterRevision = requireExpectedRevision(
        input.expectedArbiterRevision,
    );
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>('/v1/risk/kill-switch', {
            method: 'PUT',
            body: {
                enabled: input.enabled,
                expectedArbiterRevision,
                operationId,
                reasonCode: input.reasonCode,
                switchName: input.switchName,
            },
        }),
        'invalid_kill_switch_response',
    );
    return parseKillSwitchView(response.result);
}

export async function fetchSmartOrderStrategies(): Promise<
    readonly SmartOrderStrategySnapshot[]
> {
    return parseStrategyListResponse(await request<unknown>('/v1/strategies'));
}

export async function fetchSmartOrderStrategy(
    strategyId: string,
): Promise<SmartOrderStrategySnapshot> {
    const expectedStrategyId = requireStrategyId(strategyId);
    return parseStrategyGetResponse(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(expectedStrategyId)}`,
        ),
        expectedStrategyId,
    );
}

const SMART_ORDER_MANUAL_RESOLUTION_OPERATIONS = new Set<
    SmartOrderManualResolutionOperation
>([
    'apply_unique_final_evidence',
    'reconfirm_and_pause',
    'cancel_strategy',
    'copy_to_new_draft',
    'repair_gate_observe_only',
    'break_glass_relinquish',
    'remain_open',
]);

function parseManualResolutionOperations(
    value: unknown,
): readonly SmartOrderManualResolutionOperation[] | null {
    if (
        !Array.isArray(value) ||
        value.length > SMART_ORDER_MANUAL_RESOLUTION_OPERATIONS.size ||
        new Set(value).size !== value.length ||
        value.some(
            (item) =>
                typeof item !== 'string' ||
                !SMART_ORDER_MANUAL_RESOLUTION_OPERATIONS.has(
                    item as SmartOrderManualResolutionOperation,
                ),
        )
    ) {
        return null;
    }
    return Object.freeze([
        ...(value as SmartOrderManualResolutionOperation[]),
    ]);
}

function parseManualResolutionList(
    value: unknown,
    expectedStrategyId: string,
): SmartOrderManualResolutionList {
    const record = exactObject(value, [
        'brokerWriteAuthority',
        'cases',
        'genericResumeAllowed',
        'policySchemaVersion',
        'schemaVersion',
        'strategyId',
        'strategyRevision',
        'strategyState',
    ]);
    const state = strategyState(record?.strategyState);
    if (
        !record ||
        record.schemaVersion !==
            'smart-order-manual-resolution-list/2026-08-20.1' ||
        record.policySchemaVersion !==
            'smart-order-manual-resolution/2026-08-11.6' ||
        record.strategyId !== expectedStrategyId ||
        !isRevision(record.strategyRevision) ||
        !state ||
        !Array.isArray(record.cases) ||
        record.cases.length > 32 ||
        record.genericResumeAllowed !== false ||
        record.brokerWriteAuthority !== false
    ) {
        return invalidRuntimeResponse('invalid_manual_resolution_list');
    }
    const cases = record.cases.map((value) => {
        const candidate = exactObject(
            value,
            [
                'accountIdentifiersExposed',
                'allowedOperations',
                'breakGlassAllowed',
                'brokerWriteAuthority',
                'caseRevision',
                'entityIdentifiersExposed',
                'executableOperations',
                'oldIntentDisposition',
                'reasonCode',
                'requiredEvidence',
                'resolutionKey',
                'state',
                'uniqueFinalReady',
                'updatedAtEpochMs',
            ],
            ['uniqueFinalEvidenceHash'],
        );
        const allowedOperations = parseManualResolutionOperations(
            candidate?.allowedOperations,
        );
        const executableOperations = parseManualResolutionOperations(
            candidate?.executableOperations,
        );
        if (
            !candidate ||
            !SHA256_PATTERN.test(String(candidate.resolutionKey)) ||
            !isBoundedToken(candidate.reasonCode) ||
            !isRevision(candidate.caseRevision) ||
            !isBoundedToken(candidate.state) ||
            !Array.isArray(candidate.requiredEvidence) ||
            candidate.requiredEvidence.length > 16 ||
            new Set(candidate.requiredEvidence).size !==
                candidate.requiredEvidence.length ||
            candidate.requiredEvidence.some(
                (item) => !isBoundedToken(item),
            ) ||
            !allowedOperations ||
            !executableOperations ||
            executableOperations.some(
                (operation) => !allowedOperations.includes(operation),
            ) ||
            typeof candidate.uniqueFinalReady !== 'boolean' ||
            (candidate.uniqueFinalReady !==
                executableOperations.includes(
                    'apply_unique_final_evidence',
                )) ||
            (candidate.uniqueFinalReady
                ? !SHA256_PATTERN.test(
                      String(candidate.uniqueFinalEvidenceHash),
                  )
                : candidate.uniqueFinalEvidenceHash !== undefined) ||
            typeof candidate.breakGlassAllowed !== 'boolean' ||
            candidate.oldIntentDisposition !== 'never_resend' ||
            !isEpoch(candidate.updatedAtEpochMs) ||
            candidate.accountIdentifiersExposed !== false ||
            candidate.entityIdentifiersExposed !== false ||
            candidate.brokerWriteAuthority !== false
        ) {
            return invalidRuntimeResponse(
                'invalid_manual_resolution_list',
            );
        }
        return Object.freeze({
            resolutionKey: candidate.resolutionKey as string,
            reasonCode: candidate.reasonCode as string,
            caseRevision: candidate.caseRevision as number,
            state: candidate.state as string,
            requiredEvidence: Object.freeze([
                ...(candidate.requiredEvidence as string[]),
            ]),
            allowedOperations,
            executableOperations,
            uniqueFinalReady: candidate.uniqueFinalReady as boolean,
            ...(candidate.uniqueFinalEvidenceHash === undefined
                ? {}
                : {
                      uniqueFinalEvidenceHash:
                          candidate.uniqueFinalEvidenceHash as string,
                  }),
            breakGlassAllowed: candidate.breakGlassAllowed as boolean,
            oldIntentDisposition: 'never_resend' as const,
            updatedAtEpochMs: candidate.updatedAtEpochMs as number,
            accountIdentifiersExposed: false as const,
            entityIdentifiersExposed: false as const,
            brokerWriteAuthority: false as const,
        });
    });
    return Object.freeze({
        strategyId: expectedStrategyId,
        strategyRevision: record.strategyRevision as number,
        strategyState: state,
        cases: Object.freeze(cases),
        genericResumeAllowed: false,
        brokerWriteAuthority: false,
    });
}

export async function fetchSmartOrderManualResolutions(
    strategyId: string,
): Promise<SmartOrderManualResolutionList> {
    const expectedStrategyId = requireStrategyId(strategyId);
    return parseManualResolutionList(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(expectedStrategyId)}/resolutions`,
        ),
        expectedStrategyId,
    );
}

export async function applySmartOrderUniqueFinalResolution(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly resolutionKey: string;
    readonly operationId?: string;
}): Promise<SmartOrderManualResolutionResult> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    if (!SHA256_PATTERN.test(input.resolutionKey)) {
        throw new SmartOrderLocalApiError(422, 'resolution_key_invalid');
    }
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/resolve-final`,
            {
                method: 'POST',
                body: {
                    expectedRevision,
                    operationId,
                    resolutionKey: input.resolutionKey,
                    userAcknowledgedFinalEvidence: true,
                },
            },
        ),
        'invalid_manual_resolution_result',
    );
    const result = exactObject(response.result, [
        'brokerAuthorityGranted',
        'brokerWriteAttempted',
        'originalIntentRedispatchAllowed',
        'originalIntentState',
        'rearmSupersededCount',
        'resolutionRevision',
        'resolutionState',
        'safetyBlockerCount',
        'schemaVersion',
        'strategyId',
        'strategyRevision',
        'strategyState',
        'uniqueFinalEvidenceHash',
    ]);
    if (
        !result ||
        result.schemaVersion !==
            'smart-order-manual-resolution-result/2026-08-20.1' ||
        result.strategyId !== strategyId ||
        result.strategyState !== 'paused' ||
        result.strategyRevision !== expectedRevision + 1 ||
        result.resolutionState !== 'resolved' ||
        !isRevision(result.resolutionRevision) ||
        !SHA256_PATTERN.test(String(result.uniqueFinalEvidenceHash)) ||
        result.originalIntentState !== 'terminal' ||
        result.originalIntentRedispatchAllowed !== false ||
        !Number.isSafeInteger(result.safetyBlockerCount) ||
        Number(result.safetyBlockerCount) < 0 ||
        !Number.isSafeInteger(result.rearmSupersededCount) ||
        Number(result.rearmSupersededCount) < 0 ||
        result.brokerWriteAttempted !== false ||
        result.brokerAuthorityGranted !== false
    ) {
        throw new SmartOrderLocalApiError(
            502,
            'invalid_manual_resolution_result',
        );
    }
    return Object.freeze({
        strategyId,
        strategyState: 'paused',
        strategyRevision: result.strategyRevision as number,
        resolutionState: 'resolved',
        resolutionRevision: result.resolutionRevision as number,
        uniqueFinalEvidenceHash: result.uniqueFinalEvidenceHash as string,
        originalIntentState: 'terminal',
        originalIntentRedispatchAllowed: false,
        safetyBlockerCount: result.safetyBlockerCount as number,
        rearmSupersededCount: result.rearmSupersededCount as number,
        brokerWriteAttempted: false,
        brokerAuthorityGranted: false,
    });
}

export async function createSmartOrderDraft(input: {
    readonly strategyKind: SmartOrderStrategyKind;
    readonly workspaceContractKey?: string;
    readonly operationId?: string;
}): Promise<SmartOrderStrategySnapshot> {
    const kind = strategyKind(input.strategyKind);
    if (!kind) {
        throw new SmartOrderLocalApiError(422, 'strategy_kind_invalid');
    }
    if (
        input.workspaceContractKey !== undefined &&
        !CANONICAL_CONTRACT_PATTERN.test(input.workspaceContractKey)
    ) {
        throw new SmartOrderLocalApiError(422, 'workspace_contract_invalid');
    }
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponse(
        await request<unknown>('/v1/strategies', {
            method: 'POST',
            body: {
                operationId,
                strategyKind: kind,
                ...(input.workspaceContractKey
                    ? { workspaceContractKey: input.workspaceContractKey }
                    : {}),
            },
        }),
        'invalid_draft_create_result',
    );
    if (
        response.result.state !== 'draft' ||
        response.result.strategyKind !== kind ||
        response.result.revision !== 0
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_draft_create_result');
    }
    return response.result;
}

export async function copySmartOrderStrategyToDraft(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly expectedStrategyKind: SmartOrderStrategyKind;
    readonly operationId?: string;
}): Promise<SmartOrderStrategySnapshot> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const expectedStrategyKind = strategyKind(input.expectedStrategyKind);
    if (!expectedStrategyKind) {
        throw new SmartOrderLocalApiError(422, 'strategy_kind_invalid');
    }
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponse(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/copy`,
            {
                method: 'POST',
                body: { operationId, expectedRevision },
            },
        ),
        'invalid_copy_result',
    );
    if (
        response.result.state !== 'draft' ||
        response.result.strategyKind !== expectedStrategyKind ||
        response.result.revision !== 0
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_copy_result');
    }
    return response.result;
}

async function mutateSmartOrderStrategyControl(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly action: 'pause' | 'resume' | 'cancel';
    readonly operationId?: string;
}): Promise<SmartOrderStrategySnapshot> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponse(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/${input.action}`,
            {
                method: 'POST',
                body: {
                    operationId,
                    expectedRevision,
                    ...(input.action === 'resume'
                        ? { activationPolicyAcknowledged: true }
                        : {}),
                },
            },
        ),
        'invalid_strategy_control_result',
    );
    if (
        response.result.strategyId !== strategyId ||
        response.result.revision !== expectedRevision + 1 ||
        (input.action === 'pause' && response.result.state !== 'paused') ||
        (input.action === 'cancel' &&
            response.result.state !== 'cancel_pending' &&
            response.result.state !== 'cancelled') ||
        (input.action === 'resume' &&
            response.result.state !== 'observing' &&
            response.result.state !== 'monitoring')
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_strategy_result');
    }
    return response.result;
}

export function pauseSmartOrderStrategy(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly operationId?: string;
}): Promise<SmartOrderStrategySnapshot> {
    return mutateSmartOrderStrategyControl({ ...input, action: 'pause' });
}

export function resumeSmartOrderStrategy(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly operationId?: string;
}): Promise<SmartOrderStrategySnapshot> {
    return mutateSmartOrderStrategyControl({ ...input, action: 'resume' });
}

export function cancelSmartOrderStrategy(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly operationId?: string;
}): Promise<SmartOrderStrategySnapshot> {
    return mutateSmartOrderStrategyControl({ ...input, action: 'cancel' });
}

export async function requestSmartOrderBrokerCancellation(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly operationId?: string;
}): Promise<SmartOrderBrokerCancellationRequest> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/cancel-broker-order`,
            {
                method: 'POST',
                body: {
                    expectedRevision,
                    operationId,
                    userConfirmationAcknowledged: true,
                },
            },
        ),
        'invalid_broker_cancel_result',
    );
    const result = exactObject(response.result, [
        'brokerAuthorityGranted',
        'brokerWriteAttempted',
        'cancelIntentState',
        'dispatchAllowed',
        'replayed',
        'strategyId',
        'strategyRevision',
        'targetState',
        'userConfirmationConsumed',
    ]);
    if (
        !result ||
        result.brokerAuthorityGranted !== false ||
        result.brokerWriteAttempted !== false ||
        result.cancelIntentState !== 'prepared' ||
        result.dispatchAllowed !== false ||
        typeof result.replayed !== 'boolean' ||
        result.strategyId !== strategyId ||
        result.strategyRevision !== expectedRevision ||
        !['pre_submitted', 'submitted', 'part_filled'].includes(
            String(result.targetState),
        ) ||
        result.userConfirmationConsumed !== true
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_broker_cancel_result');
    }
    return Object.freeze({
        brokerAuthorityGranted: false,
        brokerWriteAttempted: false,
        cancelIntentState: 'prepared',
        dispatchAllowed: false,
        replayed: result.replayed as boolean,
        strategyId,
        strategyRevision: expectedRevision,
        targetState: result.targetState as
            | 'pre_submitted'
            | 'submitted'
            | 'part_filled',
        userConfirmationConsumed: true,
    });
}

export async function requestSmartOrderBrokerQuantityReduction(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly quantityShares: number;
    readonly operationId?: string;
}): Promise<SmartOrderBrokerQuantityReductionRequest> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    if (!Number.isSafeInteger(input.quantityShares) || input.quantityShares < 1) {
        throw new TypeError('quantityShares must be a positive safe integer');
    }
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/update-broker-order`,
            {
                method: 'POST',
                body: {
                    expectedRevision,
                    operationId,
                    quantityShares: input.quantityShares,
                    userConfirmationAcknowledged: true,
                },
            },
        ),
        'invalid_broker_update_result',
    );
    const result = exactObject(response.result, [
        'brokerAuthorityGranted',
        'brokerWriteAttempted',
        'dispatchAllowed',
        'quantityShares',
        'replayed',
        'strategyId',
        'strategyRevision',
        'targetState',
        'updateIntentState',
        'userConfirmationConsumed',
    ]);
    if (
        !result ||
        result.brokerAuthorityGranted !== false ||
        result.brokerWriteAttempted !== false ||
        result.dispatchAllowed !== false ||
        result.quantityShares !== input.quantityShares ||
        typeof result.replayed !== 'boolean' ||
        result.strategyId !== strategyId ||
        result.strategyRevision !== expectedRevision ||
        !['pre_submitted', 'submitted', 'part_filled'].includes(
            String(result.targetState),
        ) ||
        result.updateIntentState !== 'prepared' ||
        result.userConfirmationConsumed !== true
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_broker_update_result');
    }
    return Object.freeze({
        brokerAuthorityGranted: false,
        brokerWriteAttempted: false,
        dispatchAllowed: false,
        quantityShares: input.quantityShares,
        replayed: result.replayed as boolean,
        strategyId,
        strategyRevision: expectedRevision,
        targetState: result.targetState as
            | 'pre_submitted'
            | 'submitted'
            | 'part_filled',
        updateIntentState: 'prepared',
        userConfirmationConsumed: true,
    });
}

export async function drainSmartOrderPreparedIntent(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly operationId?: string;
}): Promise<SmartOrderPreparedIntentDrainResult> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/drain-prepared`,
            {
                method: 'POST',
                body: {
                    expectedRevision,
                    operationId,
                    userConfirmationAcknowledged: true,
                },
            },
        ),
        'invalid_prepared_drain_result',
    );
    const result = exactObject(response.result, [
        'activationState',
        'brokerAuthorityGranted',
        'brokerWriteAttempted',
        'exitClaimReleased',
        'preparedIntentState',
        'protectionReleased',
        'rearmSuperseded',
        'replayed',
        'reservationReleased',
        'schemaVersion',
        'strategyId',
        'strategyRevision',
        'strategyState',
        'userAuthorityConsumed',
    ]);
    if (
        !result ||
        result.schemaVersion !==
            'smart-order-prepared-intent-drain-result/2026-08-13.1' ||
        result.strategyId !== strategyId ||
        !['cancel_pending', 'cancelled'].includes(String(result.strategyState)) ||
        !Number.isSafeInteger(result.strategyRevision) ||
        Number(result.strategyRevision) < expectedRevision ||
        result.preparedIntentState !== 'cancelled_proven_unsent' ||
        result.activationState !== 'cancelled' ||
        typeof result.reservationReleased !== 'boolean' ||
        typeof result.protectionReleased !== 'boolean' ||
        typeof result.exitClaimReleased !== 'boolean' ||
        typeof result.rearmSuperseded !== 'boolean' ||
        result.userAuthorityConsumed !== true ||
        result.brokerWriteAttempted !== false ||
        result.brokerAuthorityGranted !== false ||
        typeof result.replayed !== 'boolean'
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_prepared_drain_result');
    }
    return Object.freeze({
        strategyId,
        strategyState: result.strategyState as 'cancel_pending' | 'cancelled',
        strategyRevision: Number(result.strategyRevision),
        preparedIntentState: 'cancelled_proven_unsent',
        activationState: 'cancelled',
        reservationReleased: result.reservationReleased as boolean,
        protectionReleased: result.protectionReleased as boolean,
        exitClaimReleased: result.exitClaimReleased as boolean,
        rearmSuperseded: result.rearmSuperseded as boolean,
        userAuthorityConsumed: true,
        brokerWriteAttempted: false,
        brokerAuthorityGranted: false,
        replayed: result.replayed as boolean,
    });
}

export async function prepareSmartOrderProtectionRelinquishment(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly operationId?: string;
}): Promise<SmartOrderProtectionRelinquishmentChallenge> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const operationId = mutationOperationId(input.operationId);
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/relinquish-protection-prepare`,
            {
                method: 'POST',
                body: {
                    expectedRevision,
                    operationId,
                    operatorAcknowledgedManualHandoff: true,
                },
            },
        ),
        'invalid_relinquishment_challenge',
    );
    const result = exactObject(response.result, [
        'brokerOrderCount',
        'brokerOutcomeInferred',
        'brokerWriteAttempted',
        'challengeEvidenceHash',
        'challengeId',
        'commitmentCount',
        'exitClaimCount',
        'handoffSnapshotHash',
        'obligationCount',
        'relinquished',
        'replayed',
        'reservationCount',
        'schemaVersion',
        'sideEffectIntentCount',
        'strategyId',
        'strategyRevision',
        'unmonitoredAuditHash',
    ]);
    const counts = [
        result?.obligationCount,
        result?.commitmentCount,
        result?.reservationCount,
        result?.exitClaimCount,
        result?.sideEffectIntentCount,
        result?.brokerOrderCount,
    ];
    if (
        !result ||
        result.schemaVersion !==
            'smart-order-protection-relinquishment-challenge/2026-08-13.1' ||
        result.challengeId !== operationId ||
        result.strategyId !== strategyId ||
        result.strategyRevision !== expectedRevision ||
        !SHA256_PATTERN.test(String(result.challengeEvidenceHash)) ||
        !SHA256_PATTERN.test(String(result.handoffSnapshotHash)) ||
        !SHA256_PATTERN.test(String(result.unmonitoredAuditHash)) ||
        counts.some(
            (value) => !Number.isSafeInteger(value) || Number(value) < 0,
        ) ||
        result.obligationCount === 0 ||
        result.relinquished !== false ||
        result.brokerWriteAttempted !== false ||
        result.brokerOutcomeInferred !== false ||
        typeof result.replayed !== 'boolean'
    ) {
        throw new SmartOrderLocalApiError(
            502,
            'invalid_relinquishment_challenge',
        );
    }
    return Object.freeze({
        challengeId: operationId,
        strategyId,
        strategyRevision: expectedRevision,
        handoffSnapshotHash: String(result.handoffSnapshotHash),
        unmonitoredAuditHash: String(result.unmonitoredAuditHash),
        obligationCount: Number(result.obligationCount),
        commitmentCount: Number(result.commitmentCount),
        reservationCount: Number(result.reservationCount),
        exitClaimCount: Number(result.exitClaimCount),
        sideEffectIntentCount: Number(result.sideEffectIntentCount),
        brokerOrderCount: Number(result.brokerOrderCount),
        relinquished: false,
        brokerWriteAttempted: false,
        brokerOutcomeInferred: false,
        replayed: result.replayed as boolean,
    });
}

export async function commitSmartOrderProtectionRelinquishment(input: {
    readonly strategyId: string;
    readonly expectedRevision: number;
    readonly challengeId: string;
    readonly operationId?: string;
}): Promise<SmartOrderProtectionRelinquishmentResult> {
    const strategyId = requireStrategyId(input.strategyId);
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const challengeId = mutationOperationId(input.challengeId);
    const operationId = mutationOperationId(input.operationId);
    if (challengeId === operationId) {
        throw new SmartOrderLocalApiError(422, 'confirmation_not_distinct');
    }
    const response = parseMutationResponseRaw(
        await request<unknown>(
            `/v1/strategies/${encodeURIComponent(strategyId)}/relinquish-protection-commit`,
            {
                method: 'POST',
                body: {
                    challengeId,
                    expectedRevision,
                    operationId,
                    operatorAcknowledgedManualHandoff: true,
                },
            },
        ),
        'invalid_relinquishment_result',
    );
    const result = exactObject(response.result, [
        'authorizationConsumed',
        'brokerOrderCount',
        'brokerOutcomeInferred',
        'brokerWriteAttempted',
        'commitmentCount',
        'exitClaimCount',
        'handoffSnapshotHash',
        'obligationCount',
        'originalIntentRedispatchAllowed',
        'relinquished',
        'replayed',
        'reservationCount',
        'safetyBlockerCount',
        'schemaVersion',
        'sideEffectIntentCount',
        'strategyId',
        'strategyRevision',
        'strategyState',
        'unmonitored',
        'unmonitoredAuditHash',
    ]);
    const state = strategyState(result?.strategyState);
    const counts = [
        result?.obligationCount,
        result?.commitmentCount,
        result?.reservationCount,
        result?.exitClaimCount,
        result?.sideEffectIntentCount,
        result?.brokerOrderCount,
        result?.safetyBlockerCount,
    ];
    if (
        !result ||
        result.schemaVersion !==
            'smart-order-protection-relinquishment-result/2026-08-13.1' ||
        result.strategyId !== strategyId ||
        !state ||
        !Number.isSafeInteger(result.strategyRevision) ||
        Number(result.strategyRevision) < expectedRevision ||
        !SHA256_PATTERN.test(String(result.handoffSnapshotHash)) ||
        !SHA256_PATTERN.test(String(result.unmonitoredAuditHash)) ||
        counts.some(
            (value) => !Number.isSafeInteger(value) || Number(value) < 0,
        ) ||
        result.authorizationConsumed !== true ||
        result.relinquished !== true ||
        result.unmonitored !== true ||
        result.brokerOutcomeInferred !== false ||
        result.originalIntentRedispatchAllowed !== false ||
        result.brokerWriteAttempted !== false ||
        typeof result.replayed !== 'boolean'
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_relinquishment_result');
    }
    return Object.freeze({
        strategyId,
        strategyState: state,
        strategyRevision: Number(result.strategyRevision),
        obligationCount: Number(result.obligationCount),
        commitmentCount: Number(result.commitmentCount),
        reservationCount: Number(result.reservationCount),
        exitClaimCount: Number(result.exitClaimCount),
        sideEffectIntentCount: Number(result.sideEffectIntentCount),
        brokerOrderCount: Number(result.brokerOrderCount),
        safetyBlockerCount: Number(result.safetyBlockerCount),
        authorizationConsumed: true,
        relinquished: true,
        unmonitored: true,
        brokerOutcomeInferred: false,
        originalIntentRedispatchAllowed: false,
        brokerWriteAttempted: false,
        replayed: result.replayed as boolean,
    });
}
