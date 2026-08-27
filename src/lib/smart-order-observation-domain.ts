import {
    stableSerializeCanonical,
    type CanonicalObject,
} from './smart-order-domain';
import {
    compareDecimal,
    decimalString,
    type DecimalString,
} from './smart-order-domain-money';
import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';

/** The product safety policy is fixed; production callers cannot override it. */
export const SMART_ORDER_AND_COHERENCE_WINDOW_MS = 3_000 as const;
export const SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS = 3_000 as const;
export const SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION =
    'realtimestock.smart-order-quote-freshness/v1-3000ms' as const;
export const SMART_ORDER_QUOTE_TIME_EVIDENCE_TTL_MS = 1_000 as const;
export const SMART_ORDER_QUOTE_QUANTITY_MAX = '9007199254740991' as const;
export const SMART_ORDER_CONDITION_VERIFIER_VERSION =
    'realtimestock.smart-order-condition-verifier/v1' as const;
export const SMART_ORDER_CONDITION_DEFINITION_HASH_DOMAIN =
    'realtimestock.smart-order-condition-definition/v1\n' as const;
export const SMART_ORDER_CONDITION_GROUP_HASH_DOMAIN =
    'realtimestock.smart-order-condition-group/v1\n' as const;
export const SMART_ORDER_GROUP_EVALUATION_CURSOR_SCHEMA =
    'realtimestock.group-evaluation-cursor/v1' as const;
export const SMART_ORDER_GROUP_EVALUATION_CURSOR_HASH_DOMAIN =
    'realtimestock.group-evaluation-cursor/v1\n' as const;

function rotateRight(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

export function smartOrderSha256HexSync(value: string): string {
    const constants = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const source = new TextEncoder().encode(value);
    const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
    const bytes = new Uint8Array(paddedLength);
    bytes.set(source);
    bytes[source.length] = 0x80;
    let bitLength = BigInt(source.length) * 8n;
    for (let index = 0; index < 8; index += 1) {
        bytes[paddedLength - 1 - index] = Number(bitLength & 0xffn);
        bitLength >>= 8n;
    }
    const state = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
            const cursor = offset + index * 4;
            words[index] =
                ((bytes[cursor]! << 24) |
                    (bytes[cursor + 1]! << 16) |
                    (bytes[cursor + 2]! << 8) |
                    bytes[cursor + 3]!) >>>
                0;
        }
        for (let index = 16; index < 64; index += 1) {
            const s0 =
                rotateRight(words[index - 15]!, 7) ^
                rotateRight(words[index - 15]!, 18) ^
                (words[index - 15]! >>> 3);
            const s1 =
                rotateRight(words[index - 2]!, 17) ^
                rotateRight(words[index - 2]!, 19) ^
                (words[index - 2]! >>> 10);
            words[index] =
                (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
        }
        let a = state[0]!;
        let b = state[1]!;
        let c = state[2]!;
        let d = state[3]!;
        let e = state[4]!;
        let f = state[5]!;
        let g = state[6]!;
        let h = state[7]!;
        for (let index = 0; index < 64; index += 1) {
            const sum1 =
                rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temporary1 =
                (h + sum1 + choice + constants[index]! + words[index]!) >>> 0;
            const sum0 =
                rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }
        state[0] = (state[0]! + a) >>> 0;
        state[1] = (state[1]! + b) >>> 0;
        state[2] = (state[2]! + c) >>> 0;
        state[3] = (state[3]! + d) >>> 0;
        state[4] = (state[4]! + e) >>> 0;
        state[5] = (state[5]! + f) >>> 0;
        state[6] = (state[6]! + g) >>> 0;
        state[7] = (state[7]! + h) >>> 0;
    }
    return [...state]
        .map((word) => word.toString(16).padStart(8, '0'))
        .join('');
}

export const SMART_ORDER_QUOTE_FIELDS = [
    'last_price',
    'bid_price',
    'ask_price',
    'up_amount',
    'down_amount',
    'up_percent',
    'down_percent',
    'tick_quantity',
    'total_quantity',
] as const;
export type SmartOrderQuoteField = (typeof SMART_ORDER_QUOTE_FIELDS)[number];

declare const quoteTimeEvidenceBrand: unique symbol;
declare const eligibleObservationBrand: unique symbol;
declare const quoteCursorBrand: unique symbol;
declare const continuityEvidenceBrand: unique symbol;
declare const quoteStreamLineageEvidenceBrand: unique symbol;
declare const conditionEvaluationEvidenceBrand: unique symbol;
declare const conditionDefinitionEvidenceBrand: unique symbol;
declare const conditionGroupDefinitionEvidenceBrand: unique symbol;
declare const groupEvaluationContinuityEvidenceBrand: unique symbol;

export type QuoteTimeEvidence = Readonly<{
    nowMs: number;
    clockGeneration: string;
    issuedMonotonicMs: number;
    expiresMonotonicMs: number;
    policyVersion: typeof SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION;
    readonly [quoteTimeEvidenceBrand]: 'trusted_quote_time';
}>;

export type QuoteObservationCandidate = Readonly<{
    observationId: unknown;
    contractKey: unknown;
    field: unknown;
    value: unknown;
    tradeDate: unknown;
    exchangeTimeMs: unknown;
    /** Runtime receive time, never an exchange/browser timestamp. */
    receiveTimeMs: unknown;
    streamEpoch: unknown;
    sequence?: unknown;
    delivery: unknown;
    mappingVerified: unknown;
    simtrade: unknown;
    intradayOdd: unknown;
}>;

export type QuoteObservationCursor = Readonly<{
    headRevision: number;
    observationId: string;
    contractKey: string;
    field: SmartOrderQuoteField;
    tradeDate: string;
    streamEpoch: string;
    exchangeTimeMs: number;
    receiveTimeMs: number;
    sequence: number | null;
    value: DecimalString;
    readonly [quoteCursorBrand]: 'canonical_quote_cursor';
}>;

export type EligibleQuoteObservation = QuoteObservationCursor &
    Readonly<{
        freshUntilMs: number;
        freshnessPolicyVersion: typeof SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION;
        delivery: 'subscription';
        mappingVerified: true;
        simtrade: false;
        intradayOdd: false;
        readonly [eligibleObservationBrand]: 'trusted_eligible_observation';
    }>;

export type ProtectiveTriggerObservationProjection = Readonly<{
    eligible: boolean;
    reason:
        | 'eligible_last_trade'
        | 'untrusted_observation'
        | 'inactive_observation'
        | 'stale_observation'
        | 'field_not_last_trade';
    field: SmartOrderQuoteField | null;
    value: DecimalString | null;
    lastEligibleTimeMs: number | null;
    brokerWriteAuthority: false;
}>;

export type QuoteObservationRejectionReason =
    | 'invalid_observation'
    | 'invalid_value'
    | 'wrong_contract'
    | 'field_not_allowed'
    | 'mapping_unverified'
    | 'non_subscription'
    | 'wrong_trade_date'
    | 'wrong_stream_epoch'
    | 'simtrade'
    | 'intraday_odd'
    | 'future_timestamp'
    | 'stale'
    | 'sequence_missing_after_cursor'
    | 'duplicate'
    | 'conflicting_replay'
    | 'out_of_order'
    | 'untrusted_time_evidence'
    | 'untrusted_stream_lineage';

export type QuoteObservationQualification =
    | Readonly<{
          eligible: true;
          observation: EligibleQuoteObservation;
          cursor: QuoteObservationCursor;
      }>
    | Readonly<{
          eligible: false;
          reason: QuoteObservationRejectionReason;
          recoveryRequired: boolean;
      }>;

export type QuoteStreamLineageEvidence = Readonly<{
    contractKey: string;
    field: SmartOrderQuoteField;
    tradeDate: string;
    streamEpoch: string;
    streamGeneration: number;
    previousTradeDate: string | null;
    previousStreamEpoch: string | null;
    previousStreamGeneration: number | null;
    readonly [quoteStreamLineageEvidenceBrand]: 'trusted_quote_stream_lineage';
}>;

export type QuoteQualificationContext = Readonly<{
    lineageEvidence: QuoteStreamLineageEvidence;
    timeEvidence: QuoteTimeEvidence;
}>;

export type ObservationOrder =
    | 'after'
    | 'duplicate'
    | 'conflicting_replay'
    | 'out_of_order';

export type QuoteComparator = 'gte' | 'lte';

export type QuoteConditionDefinitionHashInput = Readonly<{
    conditionId: string;
    strategyId: string;
    repositoryOwnerId: string;
    repositoryRevision: number;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    contractKey: string;
    field: SmartOrderQuoteField;
    comparator: QuoteComparator;
    threshold: DecimalString;
    mappingRevision: string;
}>;

export type QuoteConditionGroupDefinitionHashInput = Readonly<{
    groupId: string;
    strategyId: string;
    repositoryOwnerId: string;
    repositoryRevision: number;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    groupRevision: number;
    operator: 'and' | 'or';
    conditionDefinitionHashes: readonly `sha256:${string}`[];
}>;

export type QuoteConditionDefinitionEvidence = Readonly<{
    conditionId: string;
    strategyId: string;
    repositoryOwnerId: string;
    repositoryRevision: number;
    conditionDefinitionHash: `sha256:${string}`;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    contractKey: string;
    field: SmartOrderQuoteField;
    comparator: QuoteComparator;
    threshold: DecimalString;
    mappingRevision: string;
    readonly [conditionDefinitionEvidenceBrand]: 'trusted_condition_definition';
}>;

export type QuoteConditionGroupDefinitionEvidence = Readonly<{
    groupId: string;
    strategyId: string;
    repositoryOwnerId: string;
    repositoryRevision: number;
    groupDefinitionHash: `sha256:${string}`;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    groupRevision: number;
    operator: 'and' | 'or';
    conditions: readonly QuoteConditionDefinitionEvidence[];
    conditionIds: readonly string[];
    conditionDefinitionHashes: readonly `sha256:${string}`[];
    readonly [conditionGroupDefinitionEvidenceBrand]: 'trusted_condition_group_definition';
}>;

export type ConditionObservation = Readonly<{
    conditionId: string;
    truth: boolean;
    observation: EligibleQuoteObservation;
}>;

export type AndEvaluation =
    | Readonly<{
          satisfied: true;
          conditionIds: readonly string[];
          observationIds: readonly string[];
          tradeDate: string;
          streamEpoch: string;
      }>
    | Readonly<{
          satisfied: false;
          reason:
              | 'empty_conditions'
              | 'duplicate_condition_id'
              | 'invalid_condition_truth'
              | 'untrusted_time_evidence'
              | 'untrusted_observation'
              | 'stale'
              | 'different_trade_date'
              | 'different_stream_epoch'
              | 'coherence_exceeded'
              | 'condition_false';
          conditionIds: readonly string[];
      }>;

export type OrEdgeEvaluation =
    | Readonly<{
          triggered: true;
          winnerConditionId: string;
          conditionIds: readonly string[];
          observationIds: readonly string[];
          tradeDate: string;
          streamEpoch: string;
      }>
    | Readonly<{
          triggered: false;
          reason:
              | 'empty_conditions'
              | 'duplicate_condition_id'
              | 'invalid_condition_truth'
              | 'untrusted_evaluation'
              | 'different_group_definition'
              | 'untrusted_time_evidence'
              | 'untrusted_observation'
              | 'different_trade_date'
              | 'different_stream_epoch'
              | 'no_fresh_false_to_true_edge';
      }>;

export type QuoteGapReason =
    | 'disconnect'
    | 'sleep'
    | 'event_loop_pause'
    | 'clock_jump'
    | 'coordinator_gap';

export type QuoteContinuityEvidence = Readonly<{
    continuity: 'initial' | 'continuous' | 'gap';
    reason:
        | 'initial'
        | 'contiguous'
        | 'epoch_changed'
        | 'sequence_gap'
        | 'time_gap'
        | 'scope_changed'
        | QuoteGapReason;
    previousObservationId: string | null;
    currentObservationId: string;
    contractKey: string;
    field: SmartOrderQuoteField;
    fromStreamEpoch: string | null;
    toStreamEpoch: string;
    readonly [continuityEvidenceBrand]: 'trusted_quote_continuity';
}>;

type QuoteConditionEvaluationEvidenceBase = Readonly<{
    verifierVersion: typeof SMART_ORDER_CONDITION_VERIFIER_VERSION;
    evaluationId: string;
    truth: boolean;
    observation: EligibleQuoteObservation;
    observations: readonly EligibleQuoteObservation[];
    conditionIds: readonly string[];
    observationIds: readonly string[];
    tradeDate: string;
    streamEpoch: string;
    timeEvidence: QuoteTimeEvidence;
    readonly [conditionEvaluationEvidenceBrand]: 'trusted_condition_evaluation';
}>;

export type QuoteComparatorEvaluationEvidence =
    QuoteConditionEvaluationEvidenceBase &
        Readonly<{
            evaluationKind: 'comparator';
            definition: QuoteConditionDefinitionEvidence;
            conditionDefinitionHash: `sha256:${string}`;
            strategyId: string;
            strategyDefinitionHash: `sha256:${string}`;
            confirmationHash: `sha256:${string}`;
            armGeneration: number;
            field: SmartOrderQuoteField;
            comparator: QuoteComparator;
            threshold: DecimalString;
            mappingRevision: string;
        }>;

export type QuoteGroupEvaluationEvidence =
    QuoteConditionEvaluationEvidenceBase &
        Readonly<{
            evaluationKind: 'and' | 'or';
            definition: QuoteConditionGroupDefinitionEvidence;
            groupDefinitionHash: `sha256:${string}`;
            strategyId: string;
            strategyDefinitionHash: `sha256:${string}`;
            confirmationHash: `sha256:${string}`;
            armGeneration: number;
            groupRevision: number;
            components: readonly QuoteComparatorEvaluationEvidence[];
        }>;

export type QuoteConditionEvaluationEvidence =
    | QuoteComparatorEvaluationEvidence
    | QuoteGroupEvaluationEvidence;

export type GroupEvaluationLegCursor = Readonly<{
    conditionId: string;
    conditionDefinitionHash: `sha256:${string}`;
    truth: boolean;
    cursor: QuoteObservationCursor;
}>;

/**
 * Complete, versioned evaluation state.  It deliberately has no "primary"
 * cursor: every condition leg participates in replay/order decisions.
 */
export type GroupEvaluationCursor = Readonly<{
    schemaVersion: typeof SMART_ORDER_GROUP_EVALUATION_CURSOR_SCHEMA;
    evaluationId: string;
    operator: 'single' | 'and' | 'or';
    evaluationDefinitionHash: `sha256:${string}`;
    strategyId: string;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    groupRevision: number | null;
    truth: boolean;
    tradeDate: string;
    streamEpoch: string;
    legs: readonly GroupEvaluationLegCursor[];
    vectorHash: `sha256:${string}`;
}>;

export type GroupEvaluationCursorOrder = ObservationOrder;

export type GroupEvaluationLegContinuity = Readonly<{
    conditionId: string;
    previousObservationId: string | null;
    currentObservationId: string;
    fromStreamEpoch: string | null;
    toStreamEpoch: string;
    continuity: 'initial' | 'stationary' | 'continuous' | 'gap';
    reason:
        | 'initial'
        | 'no_progress'
        | 'contiguous'
        | 'epoch_changed'
        | 'sequence_gap'
        | 'time_gap'
        | 'conflicting_replay'
        | 'out_of_order'
        | QuoteGapReason;
}>;

export type GroupEvaluationContinuityEvidence = Readonly<{
    schemaVersion: 'realtimestock.group-evaluation-continuity/v1';
    evaluationId: string;
    operator: 'single' | 'and' | 'or';
    previousVectorHash: `sha256:${string}` | null;
    currentVectorHash: `sha256:${string}`;
    evaluationDefinitionHash: `sha256:${string}`;
    strategyId: string;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    groupRevision: number | null;
    tradeDate: string;
    fromStreamEpoch: string | null;
    toStreamEpoch: string;
    continuity: 'initial' | 'stationary' | 'continuous' | 'gap';
    legs: readonly GroupEvaluationLegContinuity[];
    readonly [groupEvaluationContinuityEvidenceBrand]: 'trusted_group_evaluation_continuity';
}>;

type QuoteTimeAuthorityState = {
    clockGeneration: string;
    monotonicNowMs: number;
};

const testTimeAuthorityState: QuoteTimeAuthorityState = {
    clockGeneration: 'vitest-clock-generation-1',
    monotonicNowMs: 0,
};
const trustedTimeEvidence = new WeakMap<object, QuoteTimeAuthorityState>();
const trustedEligibleObservations = new WeakSet<object>();
const trustedContinuityEvidence = new WeakSet<object>();
const trustedContinuityLineages = new WeakMap<
    object,
    QuoteStreamLineageEvidence
>();
const trustedStreamLineageEvidence = new WeakSet<object>();
const trustedConditionEvaluations = new WeakSet<object>();
const trustedConditionDefinitions = new WeakSet<object>();
const trustedConditionGroupDefinitions = new WeakSet<object>();
const trustedGroupEvaluationContinuityEvidence = new WeakSet<object>();
const groupContinuityCurrentEvaluation = new WeakMap<
    object,
    QuoteConditionEvaluationEvidence
>();
const trustedObservationCursors = new WeakMap<object, QuoteObservationCursor>();
const trustedObservationLineages = new WeakMap<
    object,
    QuoteStreamLineageEvidence
>();
const currentConditionDefinitions = new Map<
    string,
    QuoteConditionDefinitionEvidence
>();
const currentConditionGroupDefinitions = new Map<
    string,
    QuoteConditionGroupDefinitionEvidence
>();
const currentQuoteCursorByScope = new Map<string, QuoteObservationCursor>();
const currentStreamLineageByContractField = new Map<
    string,
    QuoteStreamLineageEvidence
>();

function reject(
    reason: QuoteObservationRejectionReason,
): QuoteObservationQualification {
    return Object.freeze({
        eligible: false as const,
        reason,
        recoveryRequired: reason === 'conflicting_replay',
    });
}

function isSafeTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalId(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    );
}

function isSha256(value: unknown): value is `sha256:${string}` {
    return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isPositiveRevision(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isGeneration(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalContract(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value)
    );
}

function isQuoteField(value: unknown): value is SmartOrderQuoteField {
    return (
        typeof value === 'string' &&
        (SMART_ORDER_QUOTE_FIELDS as readonly string[]).includes(value)
    );
}

function isQuoteGapReason(value: unknown): value is QuoteGapReason {
    return (
        value === 'disconnect' ||
        value === 'sleep' ||
        value === 'event_loop_pause' ||
        value === 'clock_jump' ||
        value === 'coordinator_gap'
    );
}

function isTradeDate(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

function normalizedDecimal(value: unknown): DecimalString | null {
    if (typeof value !== 'string') return null;
    try {
        return decimalString(value);
    } catch {
        return null;
    }
}

function quoteConditionDefinitionHashMaterial(
    input: QuoteConditionDefinitionHashInput,
): CanonicalObject {
    const threshold = normalizedDecimal(input.threshold);
    if (
        !isCanonicalId(input.conditionId) ||
        !isCanonicalId(input.strategyId) ||
        !isCanonicalId(input.repositoryOwnerId) ||
        !isPositiveRevision(input.repositoryRevision) ||
        !isSha256(input.strategyDefinitionHash) ||
        !isSha256(input.confirmationHash) ||
        !isGeneration(input.armGeneration) ||
        !isCanonicalContract(input.contractKey) ||
        !isQuoteField(input.field) ||
        (input.comparator !== 'gte' && input.comparator !== 'lte') ||
        threshold === null ||
        threshold !== input.threshold ||
        !isCanonicalId(input.mappingRevision)
    ) {
        throw new TypeError('condition definition hash input is not canonical');
    }
    return {
        armGeneration: input.armGeneration,
        comparator: input.comparator,
        conditionId: input.conditionId,
        confirmationHash: input.confirmationHash,
        contractKey: input.contractKey,
        field: input.field,
        mappingRevision: input.mappingRevision,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryRevision: input.repositoryRevision,
        strategyDefinitionHash: input.strategyDefinitionHash,
        strategyId: input.strategyId,
        threshold,
    };
}

/**
 * Recomputes the condition-definition digest from the complete immutable
 * verifier input.  A repository-provided digest is only an expected value.
 */
export function deriveQuoteConditionDefinitionHash(
    input: QuoteConditionDefinitionHashInput,
): `sha256:${string}` {
    const canonical = `${SMART_ORDER_CONDITION_DEFINITION_HASH_DOMAIN}${stableSerializeCanonical(
        quoteConditionDefinitionHashMaterial(input),
    )}`;
    return `sha256:${smartOrderSha256HexSync(canonical)}`;
}

function quoteConditionGroupDefinitionHashMaterial(
    input: QuoteConditionGroupDefinitionHashInput,
): CanonicalObject {
    if (
        !isCanonicalId(input.groupId) ||
        !isCanonicalId(input.strategyId) ||
        !isCanonicalId(input.repositoryOwnerId) ||
        !isPositiveRevision(input.repositoryRevision) ||
        !isSha256(input.strategyDefinitionHash) ||
        !isSha256(input.confirmationHash) ||
        !isGeneration(input.armGeneration) ||
        !isPositiveRevision(input.groupRevision) ||
        (input.operator !== 'and' && input.operator !== 'or') ||
        input.conditionDefinitionHashes.length < 1 ||
        input.conditionDefinitionHashes.length > 7 ||
        input.conditionDefinitionHashes.some((hash) => !isSha256(hash)) ||
        new Set(input.conditionDefinitionHashes).size !==
            input.conditionDefinitionHashes.length
    ) {
        throw new TypeError(
            'condition group definition hash input is not canonical',
        );
    }
    return {
        armGeneration: input.armGeneration,
        conditionDefinitionHashes: Object.freeze(
            [...input.conditionDefinitionHashes].sort(),
        ),
        confirmationHash: input.confirmationHash,
        groupId: input.groupId,
        groupRevision: input.groupRevision,
        operator: input.operator,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryRevision: input.repositoryRevision,
        strategyDefinitionHash: input.strategyDefinitionHash,
        strategyId: input.strategyId,
    };
}

/** Hashes the complete, deterministically sorted condition set for a group. */
export function deriveQuoteConditionGroupDefinitionHash(
    input: QuoteConditionGroupDefinitionHashInput,
): `sha256:${string}` {
    const canonical = `${SMART_ORDER_CONDITION_GROUP_HASH_DOMAIN}${stableSerializeCanonical(
        quoteConditionGroupDefinitionHashMaterial(input),
    )}`;
    return `sha256:${smartOrderSha256HexSync(canonical)}`;
}

function conditionDefinitionHashMatches(
    definition: QuoteConditionDefinitionEvidence,
): boolean {
    try {
        return (
            deriveQuoteConditionDefinitionHash(definition) ===
            definition.conditionDefinitionHash
        );
    } catch {
        return false;
    }
}

function conditionGroupDefinitionHashMatches(
    definition: QuoteConditionGroupDefinitionEvidence,
): boolean {
    try {
        return (
            deriveQuoteConditionGroupDefinitionHash({
                groupId: definition.groupId,
                strategyId: definition.strategyId,
                repositoryOwnerId: definition.repositoryOwnerId,
                repositoryRevision: definition.repositoryRevision,
                strategyDefinitionHash: definition.strategyDefinitionHash,
                confirmationHash: definition.confirmationHash,
                armGeneration: definition.armGeneration,
                groupRevision: definition.groupRevision,
                operator: definition.operator,
                conditionDefinitionHashes:
                    definition.conditionDefinitionHashes,
            }) === definition.groupDefinitionHash
        );
    } catch {
        return false;
    }
}

function quoteCursorScope(input: Readonly<{
    contractKey: string;
    field: SmartOrderQuoteField;
    streamEpoch: string;
}>): string {
    return `${input.contractKey}|${input.field}|${input.streamEpoch}`;
}

function quoteContractFieldScope(input: Readonly<{
    contractKey: string;
    field: SmartOrderQuoteField;
}>): string {
    return `${input.contractKey}|${input.field}`;
}

function issueQuoteStreamLineageEvidence(input: Readonly<{
    contractKey: string;
    field: SmartOrderQuoteField;
    tradeDate: string;
    streamEpoch: string;
    streamGeneration: number;
}>): QuoteStreamLineageEvidence {
    if (
        !isCanonicalContract(input.contractKey) ||
        !isQuoteField(input.field) ||
        !isTradeDate(input.tradeDate) ||
        !isCanonicalId(input.streamEpoch) ||
        !isPositiveRevision(input.streamGeneration)
    ) {
        throw new TypeError('quote stream lineage is not canonical');
    }
    const authorityKey = quoteContractFieldScope(input);
    const current = currentStreamLineageByContractField.get(authorityKey);
    if (current) {
        if (input.streamGeneration < current.streamGeneration) {
            throw new TypeError('quote stream generation cannot move backwards');
        }
        if (input.streamGeneration === current.streamGeneration) {
            if (
                input.tradeDate === current.tradeDate &&
                input.streamEpoch === current.streamEpoch
            ) {
                return current;
            }
            throw new TypeError(
                'quote stream generation has conflicting lineage',
            );
        }
        if (input.streamGeneration !== current.streamGeneration + 1) {
            throw new TypeError('quote stream generation must advance by one');
        }
        if (
            input.tradeDate < current.tradeDate ||
            input.streamEpoch === current.streamEpoch
        ) {
            throw new TypeError('quote stream lineage cannot move backwards');
        }
    }
    const evidence = Object.freeze({
        contractKey: input.contractKey,
        field: input.field,
        tradeDate: input.tradeDate,
        streamEpoch: input.streamEpoch,
        streamGeneration: input.streamGeneration,
        previousTradeDate: current?.tradeDate ?? null,
        previousStreamEpoch: current?.streamEpoch ?? null,
        previousStreamGeneration: current?.streamGeneration ?? null,
    }) as QuoteStreamLineageEvidence;
    trustedStreamLineageEvidence.add(evidence);
    if (current) {
        currentQuoteCursorByScope.delete(quoteCursorScope(current));
    }
    currentStreamLineageByContractField.set(authorityKey, evidence);
    return evidence;
}

export function isTrustedQuoteStreamLineageEvidence(
    value: unknown,
): value is QuoteStreamLineageEvidence {
    if (
        !value ||
        typeof value !== 'object' ||
        !Object.isFrozen(value) ||
        !trustedStreamLineageEvidence.has(value)
    ) {
        return false;
    }
    const evidence = value as QuoteStreamLineageEvidence;
    return (
        currentStreamLineageByContractField.get(
            quoteContractFieldScope(evidence),
        ) === evidence
    );
}

function isValueValidForField(
    field: SmartOrderQuoteField,
    value: DecimalString,
): boolean {
    const zero = decimalString('0');
    if (
        field === 'last_price' ||
        field === 'bid_price' ||
        field === 'ask_price'
    ) {
        return compareDecimal(value, zero) > 0;
    }
    if (field === 'tick_quantity' || field === 'total_quantity') {
        return (
            /^(?:0|[1-9]\d*)$/.test(value) &&
            compareDecimal(
                value,
                decimalString(SMART_ORDER_QUOTE_QUANTITY_MAX),
            ) <= 0
        );
    }
    return compareDecimal(value, zero) >= 0;
}

export function isTrustedQuoteTimeEvidence(
    value: unknown,
): value is QuoteTimeEvidence {
    if (!value || typeof value !== 'object' || !Object.isFrozen(value)) {
        return false;
    }
    const authority = trustedTimeEvidence.get(value);
    if (!authority) return false;
    const evidence = value as Partial<QuoteTimeEvidence>;
    return (
        evidence.policyVersion === SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION &&
        evidence.clockGeneration === authority.clockGeneration &&
        isSafeTimestamp(evidence.issuedMonotonicMs) &&
        isSafeTimestamp(evidence.expiresMonotonicMs) &&
        authority.monotonicNowMs >= evidence.issuedMonotonicMs &&
        authority.monotonicNowMs <= evidence.expiresMonotonicMs
    );
}

function effectiveQuoteNowMs(evidence: QuoteTimeEvidence): number | null {
    if (!isTrustedQuoteTimeEvidence(evidence)) return null;
    const authority = trustedTimeEvidence.get(evidence);
    if (!authority) return null;
    const effectiveNowMs =
        evidence.nowMs +
        (authority.monotonicNowMs - evidence.issuedMonotonicMs);
    return Number.isSafeInteger(effectiveNowMs) ? effectiveNowMs : null;
}

export function isTrustedEligibleQuoteObservation(
    value: unknown,
): value is EligibleQuoteObservation {
    return (
        !!value &&
        typeof value === 'object' &&
        Object.isFrozen(value) &&
        trustedEligibleObservations.has(value)
    );
}

/**
 * Historical attestation is not enough to drive an order.  The observation
 * must still be the module-owned head for its exact contract/field/epoch.
 */
export function isQuoteObservationCurrent(
    value: unknown,
): value is EligibleQuoteObservation {
    if (!isTrustedEligibleQuoteObservation(value)) return false;
    const cursor = trustedObservationCursors.get(value);
    const lineage = trustedObservationLineages.get(value);
    return (
        cursor !== undefined &&
        lineage !== undefined &&
        isTrustedQuoteStreamLineageEvidence(lineage) &&
        lineage.contractKey === value.contractKey &&
        lineage.field === value.field &&
        lineage.tradeDate === value.tradeDate &&
        lineage.streamEpoch === value.streamEpoch &&
        currentQuoteCursorByScope.get(quoteCursorScope(value)) === cursor
    );
}

/**
 * Fixed stop/take and trailing-extreme policies may only consume the current,
 * fresh, normal-lot last trade. Bid/ask observations remain display-only and
 * cannot become a protective trigger by crossing a level on their own.
 */
export function projectProtectiveTriggerObservation(
    observation: unknown,
    timeEvidence: QuoteTimeEvidence,
): ProtectiveTriggerObservationProjection {
    if (!isTrustedEligibleQuoteObservation(observation)) {
        return Object.freeze({
            eligible: false,
            reason: 'untrusted_observation',
            field: null,
            value: null,
            lastEligibleTimeMs: null,
            brokerWriteAuthority: false,
        });
    }
    if (!isQuoteObservationCurrent(observation as unknown)) {
        return Object.freeze({
            eligible: false,
            reason: 'inactive_observation',
            field: observation.field,
            value: null,
            lastEligibleTimeMs: observation.exchangeTimeMs,
            brokerWriteAuthority: false,
        });
    }
    if (!isObservationFresh(observation, timeEvidence)) {
        return Object.freeze({
            eligible: false,
            reason: 'stale_observation',
            field: observation.field,
            value: null,
            lastEligibleTimeMs: observation.exchangeTimeMs,
            brokerWriteAuthority: false,
        });
    }
    if (observation.field !== 'last_price') {
        return Object.freeze({
            eligible: false,
            reason: 'field_not_last_trade',
            field: observation.field,
            value: null,
            lastEligibleTimeMs: null,
            brokerWriteAuthority: false,
        });
    }
    return Object.freeze({
        eligible: true,
        reason: 'eligible_last_trade',
        field: observation.field,
        value: observation.value,
        lastEligibleTimeMs: observation.exchangeTimeMs,
        brokerWriteAuthority: false,
    });
}

export function isTrustedQuoteContinuityEvidence(
    value: unknown,
): value is QuoteContinuityEvidence {
    if (
        !value ||
        typeof value !== 'object' ||
        !Object.isFrozen(value) ||
        !trustedContinuityEvidence.has(value)
    ) {
        return false;
    }
    const lineage = trustedContinuityLineages.get(value);
    return (
        lineage !== undefined &&
        isTrustedQuoteStreamLineageEvidence(lineage) &&
        lineage.contractKey === (value as QuoteContinuityEvidence).contractKey &&
        lineage.field === (value as QuoteContinuityEvidence).field &&
        lineage.streamEpoch ===
            (value as QuoteContinuityEvidence).toStreamEpoch
    );
}

function conditionDefinitionAuthorityKey(
    definition: Pick<
        QuoteConditionDefinitionEvidence,
        | 'strategyDefinitionHash'
        | 'strategyId'
        | 'conditionId'
    >,
): string {
    return `${definition.strategyId}|${definition.conditionId}`;
}

function conditionGroupDefinitionAuthorityKey(
    definition: Pick<
        QuoteConditionGroupDefinitionEvidence,
        | 'strategyDefinitionHash'
        | 'strategyId'
        | 'groupId'
    >,
): string {
    return `${definition.strategyId}|${definition.groupId}`;
}

export function isTrustedQuoteConditionDefinitionEvidence(
    value: unknown,
): value is QuoteConditionDefinitionEvidence {
    if (
        !value ||
        typeof value !== 'object' ||
        !Object.isFrozen(value) ||
        !trustedConditionDefinitions.has(value)
    ) {
        return false;
    }
    const definition = value as QuoteConditionDefinitionEvidence;
    return (
        currentConditionDefinitions.get(
            conditionDefinitionAuthorityKey(definition),
        ) === definition &&
        isCanonicalId(definition.conditionId) &&
        isCanonicalId(definition.strategyId) &&
        isCanonicalId(definition.repositoryOwnerId) &&
        isPositiveRevision(definition.repositoryRevision) &&
        isSha256(definition.conditionDefinitionHash) &&
        isSha256(definition.strategyDefinitionHash) &&
        isSha256(definition.confirmationHash) &&
        isGeneration(definition.armGeneration) &&
        isCanonicalContract(definition.contractKey) &&
        isQuoteField(definition.field) &&
        (definition.comparator === 'gte' || definition.comparator === 'lte') &&
        normalizedDecimal(definition.threshold) === definition.threshold &&
        isCanonicalId(definition.mappingRevision) &&
        conditionDefinitionHashMatches(definition)
    );
}

export function isTrustedQuoteConditionGroupDefinitionEvidence(
    value: unknown,
): value is QuoteConditionGroupDefinitionEvidence {
    if (
        !value ||
        typeof value !== 'object' ||
        !Object.isFrozen(value) ||
        !trustedConditionGroupDefinitions.has(value)
    ) {
        return false;
    }
    const definition = value as QuoteConditionGroupDefinitionEvidence;
    const conditionIds = definition.conditions.map(
        ({ conditionId }) => conditionId,
    );
    const definitionHashes = definition.conditions.map(
        ({ conditionDefinitionHash }) => conditionDefinitionHash,
    );
    return (
        currentConditionGroupDefinitions.get(
            conditionGroupDefinitionAuthorityKey(definition),
        ) === definition &&
        isCanonicalId(definition.groupId) &&
        isCanonicalId(definition.strategyId) &&
        isCanonicalId(definition.repositoryOwnerId) &&
        isPositiveRevision(definition.repositoryRevision) &&
        isSha256(definition.groupDefinitionHash) &&
        isSha256(definition.strategyDefinitionHash) &&
        isSha256(definition.confirmationHash) &&
        isGeneration(definition.armGeneration) &&
        isPositiveRevision(definition.groupRevision) &&
        (definition.operator === 'and' || definition.operator === 'or') &&
        Object.isFrozen(definition.conditions) &&
        Object.isFrozen(definition.conditionIds) &&
        Object.isFrozen(definition.conditionDefinitionHashes) &&
        definition.conditions.length >= 1 &&
        definition.conditions.length <= 7 &&
        definition.conditions.every(
            (condition) =>
                isTrustedQuoteConditionDefinitionEvidence(condition) &&
                condition.strategyId === definition.strategyId &&
                condition.repositoryOwnerId ===
                    definition.repositoryOwnerId &&
                condition.repositoryRevision ===
                    definition.repositoryRevision &&
                condition.strategyDefinitionHash ===
                    definition.strategyDefinitionHash &&
                condition.confirmationHash === definition.confirmationHash &&
                condition.armGeneration === definition.armGeneration,
        ) &&
        new Set(conditionIds).size === conditionIds.length &&
        new Set(definitionHashes).size === definitionHashes.length &&
        conditionIds.every(
            (conditionId, index) =>
                conditionId === definition.conditionIds[index],
        ) &&
        definitionHashes.every(
            (definitionHash, index) =>
                definitionHash ===
                definition.conditionDefinitionHashes[index],
        ) &&
        conditionGroupDefinitionHashMatches(definition)
    );
}

export function isTrustedQuoteConditionEvaluationEvidence(
    value: unknown,
): value is QuoteConditionEvaluationEvidence {
    if (
        !value ||
        typeof value !== 'object' ||
        !Object.isFrozen(value) ||
        !trustedConditionEvaluations.has(value)
    ) {
        return false;
    }
    const evidence = value as QuoteConditionEvaluationEvidence;
    const canonicalObservationIds = [
        ...new Set(
            evidence.observations.map(
                ({ observationId }) => observationId,
            ),
        ),
    ].sort();
    return (
        evidence.verifierVersion === SMART_ORDER_CONDITION_VERIFIER_VERSION &&
        (evidence.evaluationKind === 'comparator' ||
            evidence.evaluationKind === 'and' ||
            evidence.evaluationKind === 'or') &&
        isCanonicalId(evidence.evaluationId) &&
        typeof evidence.truth === 'boolean' &&
        Object.isFrozen(evidence.observations) &&
        Object.isFrozen(evidence.conditionIds) &&
        Object.isFrozen(evidence.observationIds) &&
        Object.isFrozen(evidence.timeEvidence) &&
        trustedTimeEvidence.has(evidence.timeEvidence) &&
        isTrustedEligibleQuoteObservation(evidence.observation) &&
        evidence.observations.length > 0 &&
        evidence.observations.every(
            (observation) =>
                isTrustedEligibleQuoteObservation(observation) &&
                observation.tradeDate === evidence.tradeDate &&
                observation.streamEpoch === evidence.streamEpoch,
        ) &&
        evidence.observations.includes(evidence.observation) &&
        evidence.conditionIds.length > 0 &&
        evidence.conditionIds.every(isCanonicalId) &&
        new Set(evidence.conditionIds).size === evidence.conditionIds.length &&
        canonicalObservationIds.length === evidence.observationIds.length &&
        canonicalObservationIds.every(
            (observationId, index) =>
                observationId === evidence.observationIds[index],
        ) &&
        (evidence.evaluationKind === 'comparator'
            ? isTrustedQuoteConditionDefinitionEvidence(evidence.definition) &&
              evidence.conditionDefinitionHash ===
                  evidence.definition.conditionDefinitionHash &&
              evidence.strategyId === evidence.definition.strategyId &&
              evidence.strategyDefinitionHash ===
                  evidence.definition.strategyDefinitionHash &&
              evidence.confirmationHash ===
                  evidence.definition.confirmationHash &&
              evidence.armGeneration === evidence.definition.armGeneration &&
              evidence.field === evidence.definition.field &&
              evidence.comparator === evidence.definition.comparator &&
              evidence.threshold === evidence.definition.threshold &&
              evidence.mappingRevision ===
                  evidence.definition.mappingRevision &&
              evidence.observation.contractKey ===
                  evidence.definition.contractKey &&
              evidence.observation.field === evidence.definition.field &&
              evidence.observations.length === 1 &&
              evidence.observations[0] === evidence.observation &&
              evidence.conditionIds.length === 1 &&
              evidence.conditionIds[0] === evidence.definition.conditionId
            : isTrustedQuoteConditionGroupDefinitionEvidence(
                  evidence.definition,
              ) &&
              evidence.definition.operator === evidence.evaluationKind &&
              evidence.groupDefinitionHash ===
                  evidence.definition.groupDefinitionHash &&
              evidence.strategyId === evidence.definition.strategyId &&
              evidence.strategyDefinitionHash ===
                  evidence.definition.strategyDefinitionHash &&
              evidence.confirmationHash ===
                  evidence.definition.confirmationHash &&
              evidence.armGeneration === evidence.definition.armGeneration &&
              evidence.groupRevision === evidence.definition.groupRevision &&
              Object.isFrozen(evidence.components) &&
              evidence.components.length ===
                  evidence.definition.conditions.length &&
              evidence.components.every(
                  (component, index) =>
                      isTrustedQuoteConditionEvaluationEvidence(component) &&
                      component.evaluationKind === 'comparator' &&
                      component.definition ===
                          evidence.definition.conditions[index],
              ) &&
              evidence.conditionIds.every(
                  (conditionId, index) =>
                      conditionId === evidence.definition.conditionIds[index],
              ))
    );
}

function issueTimeEvidence(nowMs: number): QuoteTimeEvidence {
    if (!isSafeTimestamp(nowMs)) throw new TypeError('quote time is invalid');
    const expiresMonotonicMs =
        testTimeAuthorityState.monotonicNowMs +
        SMART_ORDER_QUOTE_TIME_EVIDENCE_TTL_MS;
    if (!Number.isSafeInteger(expiresMonotonicMs)) {
        throw new TypeError('quote time evidence expiry overflow');
    }
    const evidence = Object.freeze({
        nowMs,
        clockGeneration: testTimeAuthorityState.clockGeneration,
        issuedMonotonicMs: testTimeAuthorityState.monotonicNowMs,
        expiresMonotonicMs,
        policyVersion: SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION,
    }) as QuoteTimeEvidence;
    trustedTimeEvidence.set(evidence, testTimeAuthorityState);
    return evidence;
}

function advanceTimeAuthority(monotonicNowMs: number): void {
    if (
        !isSafeTimestamp(monotonicNowMs) ||
        monotonicNowMs < testTimeAuthorityState.monotonicNowMs
    ) {
        throw new TypeError('monotonic quote time cannot move backwards');
    }
    testTimeAuthorityState.monotonicNowMs = monotonicNowMs;
}

function rotateTimeGeneration(
    clockGeneration: string,
    monotonicNowMs: number,
): void {
    if (
        !isCanonicalId(clockGeneration) ||
        clockGeneration === testTimeAuthorityState.clockGeneration ||
        !isSafeTimestamp(monotonicNowMs) ||
        monotonicNowMs < testTimeAuthorityState.monotonicNowMs
    ) {
        throw new TypeError('quote time generation rotation is invalid');
    }
    testTimeAuthorityState.clockGeneration = clockGeneration;
    testTimeAuthorityState.monotonicNowMs = monotonicNowMs;
}

function readTimeAuthorityState(): Readonly<QuoteTimeAuthorityState> {
    return Object.freeze({ ...testTimeAuthorityState });
}

function resetQuoteObservationHeads(): void {
    currentQuoteCursorByScope.clear();
    currentStreamLineageByContractField.clear();
}

function resetConditionDefinitionHeads(): void {
    currentConditionDefinitions.clear();
    currentConditionGroupDefinitions.clear();
}

function readQuoteObservationHead(input: Readonly<{
    contractKey: string;
    field: SmartOrderQuoteField;
    streamEpoch: string;
}>): QuoteObservationCursor | null {
    if (
        !isCanonicalContract(input.contractKey) ||
        !isQuoteField(input.field) ||
        !isCanonicalId(input.streamEpoch)
    ) {
        throw new TypeError('quote observation head scope is not canonical');
    }
    return currentQuoteCursorByScope.get(quoteCursorScope(input)) ?? null;
}

function issueConditionDefinitionEvidence(input: Readonly<{
    conditionId: string;
    strategyId: string;
    repositoryOwnerId: string;
    repositoryRevision: number;
    conditionDefinitionHash: `sha256:${string}`;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    contractKey: string;
    field: SmartOrderQuoteField;
    comparator: QuoteComparator;
    threshold: DecimalString;
    mappingRevision: string;
}>): QuoteConditionDefinitionEvidence {
    const threshold = normalizedDecimal(input.threshold);
    if (
        !isCanonicalId(input.conditionId) ||
        !isCanonicalId(input.strategyId) ||
        !isCanonicalId(input.repositoryOwnerId) ||
        !isPositiveRevision(input.repositoryRevision) ||
        !isSha256(input.conditionDefinitionHash) ||
        !isSha256(input.strategyDefinitionHash) ||
        !isSha256(input.confirmationHash) ||
        !isGeneration(input.armGeneration) ||
        !isCanonicalContract(input.contractKey) ||
        !isQuoteField(input.field) ||
        (input.comparator !== 'gte' && input.comparator !== 'lte') ||
        threshold === null ||
        threshold !== input.threshold ||
        !isCanonicalId(input.mappingRevision)
    ) {
        throw new TypeError('condition definition is not canonical');
    }
    const conditionDefinitionHash = deriveQuoteConditionDefinitionHash({
        conditionId: input.conditionId,
        strategyId: input.strategyId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryRevision: input.repositoryRevision,
        strategyDefinitionHash: input.strategyDefinitionHash,
        confirmationHash: input.confirmationHash,
        armGeneration: input.armGeneration,
        contractKey: input.contractKey,
        field: input.field,
        comparator: input.comparator,
        threshold,
        mappingRevision: input.mappingRevision,
    });
    if (conditionDefinitionHash !== input.conditionDefinitionHash) {
        throw new TypeError('condition definition hash mismatch');
    }
    const authorityKey = conditionDefinitionAuthorityKey(input);
    const current = currentConditionDefinitions.get(authorityKey);
    if (current) {
        if (input.repositoryOwnerId !== current.repositoryOwnerId) {
            throw new TypeError('condition definition repository owner cannot change');
        }
        if (input.repositoryRevision < current.repositoryRevision) {
            throw new TypeError('condition definition repository revision cannot move backwards');
        }
        if (input.armGeneration < current.armGeneration) {
            throw new TypeError('condition definition arm generation cannot move backwards');
        }
        if (input.repositoryRevision === current.repositoryRevision) {
            if (
                input.armGeneration === current.armGeneration &&
                conditionDefinitionHash === current.conditionDefinitionHash
            ) {
                return current;
            }
            throw new TypeError(
                'condition definition repository revision has conflicting definition',
            );
        }
    }
    const evidence = Object.freeze({
        conditionId: input.conditionId,
        strategyId: input.strategyId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryRevision: input.repositoryRevision,
        conditionDefinitionHash,
        strategyDefinitionHash: input.strategyDefinitionHash,
        confirmationHash: input.confirmationHash,
        armGeneration: input.armGeneration,
        contractKey: input.contractKey,
        field: input.field,
        comparator: input.comparator,
        threshold,
        mappingRevision: input.mappingRevision,
    }) as QuoteConditionDefinitionEvidence;
    trustedConditionDefinitions.add(evidence);
    currentConditionDefinitions.set(authorityKey, evidence);
    return evidence;
}

function issueConditionGroupDefinitionEvidence(input: Readonly<{
    groupId: string;
    strategyId: string;
    repositoryOwnerId: string;
    repositoryRevision: number;
    groupDefinitionHash: `sha256:${string}`;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    armGeneration: number;
    groupRevision: number;
    operator: 'and' | 'or';
    conditions: readonly QuoteConditionDefinitionEvidence[];
}>): QuoteConditionGroupDefinitionEvidence {
    if (
        !isCanonicalId(input.groupId) ||
        !isCanonicalId(input.strategyId) ||
        !isCanonicalId(input.repositoryOwnerId) ||
        !isPositiveRevision(input.repositoryRevision) ||
        !isSha256(input.groupDefinitionHash) ||
        !isSha256(input.strategyDefinitionHash) ||
        !isSha256(input.confirmationHash) ||
        !isGeneration(input.armGeneration) ||
        !isPositiveRevision(input.groupRevision) ||
        (input.operator !== 'and' && input.operator !== 'or') ||
        input.conditions.length < 1 ||
        input.conditions.length > 7 ||
        input.conditions.some(
            (condition) =>
                !isTrustedQuoteConditionDefinitionEvidence(condition) ||
                condition.strategyId !== input.strategyId ||
                condition.repositoryOwnerId !== input.repositoryOwnerId ||
                condition.repositoryRevision !== input.repositoryRevision ||
                condition.strategyDefinitionHash !==
                    input.strategyDefinitionHash ||
                condition.confirmationHash !== input.confirmationHash ||
                condition.armGeneration !== input.armGeneration,
        )
    ) {
        throw new TypeError('condition group definition is not canonical');
    }
    const conditions = Object.freeze(
        [...input.conditions].sort((left, right) =>
            left.conditionId.localeCompare(right.conditionId),
        ),
    );
    const conditionIds = Object.freeze(
        conditions.map(({ conditionId }) => conditionId),
    );
    const conditionDefinitionHashes = Object.freeze(
        conditions.map(
            ({ conditionDefinitionHash }) => conditionDefinitionHash,
        ),
    );
    if (
        new Set(conditionIds).size !== conditionIds.length ||
        new Set(conditionDefinitionHashes).size !==
            conditionDefinitionHashes.length
    ) {
        throw new TypeError('condition group definition is not canonical');
    }
    const groupDefinitionHash = deriveQuoteConditionGroupDefinitionHash({
        groupId: input.groupId,
        strategyId: input.strategyId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryRevision: input.repositoryRevision,
        strategyDefinitionHash: input.strategyDefinitionHash,
        confirmationHash: input.confirmationHash,
        armGeneration: input.armGeneration,
        groupRevision: input.groupRevision,
        operator: input.operator,
        conditionDefinitionHashes,
    });
    if (groupDefinitionHash !== input.groupDefinitionHash) {
        throw new TypeError('condition group definition hash mismatch');
    }
    const authorityKey = conditionGroupDefinitionAuthorityKey(input);
    const current = currentConditionGroupDefinitions.get(authorityKey);
    if (current) {
        if (input.repositoryOwnerId !== current.repositoryOwnerId) {
            throw new TypeError('condition group repository owner cannot change');
        }
        if (input.repositoryRevision < current.repositoryRevision) {
            throw new TypeError('condition group repository revision cannot move backwards');
        }
        if (input.armGeneration < current.armGeneration) {
            throw new TypeError('condition group arm generation cannot move backwards');
        }
        if (input.groupRevision < current.groupRevision) {
            throw new TypeError('condition group source revision cannot move backwards');
        }
        if (input.repositoryRevision === current.repositoryRevision) {
            if (
                input.armGeneration === current.armGeneration &&
                input.groupRevision === current.groupRevision &&
                groupDefinitionHash === current.groupDefinitionHash
            ) {
                return current;
            }
            throw new TypeError('condition group repository revision has conflicting definition');
        }
    }
    const evidence = Object.freeze({
        groupId: input.groupId,
        strategyId: input.strategyId,
        repositoryOwnerId: input.repositoryOwnerId,
        repositoryRevision: input.repositoryRevision,
        groupDefinitionHash,
        strategyDefinitionHash: input.strategyDefinitionHash,
        confirmationHash: input.confirmationHash,
        armGeneration: input.armGeneration,
        groupRevision: input.groupRevision,
        operator: input.operator,
        conditions,
        conditionIds,
        conditionDefinitionHashes,
    }) as QuoteConditionGroupDefinitionEvidence;
    trustedConditionGroupDefinitions.add(evidence);
    currentConditionGroupDefinitions.set(authorityKey, evidence);
    return evidence;
}

function validateCursorShape(value: unknown): Omit<QuoteObservationCursor, typeof quoteCursorBrand> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('quote cursor must be a canonical record');
    }
    const record = value as Record<string, unknown>;
    const expected = [
        'headRevision',
        'observationId',
        'contractKey',
        'field',
        'tradeDate',
        'streamEpoch',
        'exchangeTimeMs',
        'receiveTimeMs',
        'sequence',
        'value',
    ].sort();
    const actual = Object.keys(record).sort();
    if (
        expected.length !== actual.length ||
        expected.some((key, index) => actual[index] !== key) ||
        !isPositiveRevision(record.headRevision) ||
        !isCanonicalId(record.observationId) ||
        !isCanonicalContract(record.contractKey) ||
        !isQuoteField(record.field) ||
        !isTradeDate(record.tradeDate) ||
        !isCanonicalId(record.streamEpoch) ||
        !isSafeTimestamp(record.exchangeTimeMs) ||
        !isSafeTimestamp(record.receiveTimeMs) ||
        (record.sequence !== null &&
            (!Number.isSafeInteger(record.sequence) ||
                (record.sequence as number) < 0))
    ) {
        throw new TypeError('quote cursor is not canonical');
    }
    const valueDecimal = normalizedDecimal(record.value);
    if (
        valueDecimal === null ||
        valueDecimal !== record.value ||
        !isValueValidForField(record.field, valueDecimal)
    ) {
        throw new TypeError('quote cursor value is not canonical');
    }
    return {
        headRevision: record.headRevision,
        observationId: record.observationId,
        contractKey: record.contractKey,
        field: record.field,
        tradeDate: record.tradeDate,
        streamEpoch: record.streamEpoch,
        exchangeTimeMs: record.exchangeTimeMs,
        receiveTimeMs: record.receiveTimeMs,
        sequence: record.sequence as number | null,
        value: valueDecimal,
    };
}

export function restoreQuoteObservationCursor(
    value: unknown,
): QuoteObservationCursor {
    return Object.freeze(validateCursorShape(value)) as QuoteObservationCursor;
}

function cursorOf(observation: EligibleQuoteObservation): QuoteObservationCursor {
    return restoreQuoteObservationCursor({
        headRevision: observation.headRevision,
        observationId: observation.observationId,
        contractKey: observation.contractKey,
        field: observation.field,
        tradeDate: observation.tradeDate,
        streamEpoch: observation.streamEpoch,
        exchangeTimeMs: observation.exchangeTimeMs,
        receiveTimeMs: observation.receiveTimeMs,
        sequence: observation.sequence,
        value: observation.value,
    });
}

function sameCursorPayload(
    left: QuoteObservationCursor,
    right: QuoteObservationCursor,
): boolean {
    return (
        left.contractKey === right.contractKey &&
        left.field === right.field &&
        left.tradeDate === right.tradeDate &&
        left.streamEpoch === right.streamEpoch &&
        left.exchangeTimeMs === right.exchangeTimeMs &&
        left.receiveTimeMs === right.receiveTimeMs &&
        left.sequence === right.sequence &&
        left.value === right.value
    );
}

export function compareQuoteObservationOrder(
    previous: QuoteObservationCursor,
    current: QuoteObservationCursor,
): ObservationOrder {
    if (
        previous.contractKey !== current.contractKey ||
        previous.field !== current.field
    ) {
        return 'conflicting_replay';
    }
    if (
        previous.tradeDate !== current.tradeDate ||
        previous.streamEpoch !== current.streamEpoch
    ) {
        return 'out_of_order';
    }
    if (previous.observationId === current.observationId) {
        return sameCursorPayload(previous, current)
            ? 'duplicate'
            : 'conflicting_replay';
    }
    if (previous.sequence !== null && current.sequence === null) {
        return 'out_of_order';
    }
    if (previous.sequence !== null && current.sequence !== null) {
        if (current.sequence < previous.sequence) return 'out_of_order';
        if (current.sequence === previous.sequence) {
            return sameCursorPayload(previous, current)
                ? 'duplicate'
                : 'conflicting_replay';
        }
    }
    if (
        current.exchangeTimeMs < previous.exchangeTimeMs ||
        current.receiveTimeMs < previous.receiveTimeMs
    ) {
        return 'out_of_order';
    }
    if (
        previous.sequence === null &&
        current.sequence === null &&
        current.exchangeTimeMs === previous.exchangeTimeMs
    ) {
        return sameCursorPayload(previous, current)
            ? 'duplicate'
            : 'conflicting_replay';
    }
    return 'after';
}

function qualifyQuoteObservation(
    candidate: QuoteObservationCandidate,
    context: QuoteQualificationContext,
): QuoteObservationQualification {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        throw new TypeError('quote qualification context is not canonical');
    }
    const expectedContextKeys = [
        'lineageEvidence',
        'timeEvidence',
    ].sort();
    const actualContextKeys = Object.keys(context).sort();
    if (
        actualContextKeys.length !== expectedContextKeys.length ||
        expectedContextKeys.some(
            (key, index) => actualContextKeys[index] !== key,
        )
    ) {
        throw new TypeError('quote qualification context is not canonical');
    }
    if (!isTrustedQuoteTimeEvidence(context?.timeEvidence)) {
        return reject('untrusted_time_evidence');
    }
    if (!isTrustedQuoteStreamLineageEvidence(context.lineageEvidence)) {
        return reject('untrusted_stream_lineage');
    }
    if (
        !isCanonicalId(candidate.observationId) ||
        !isCanonicalContract(candidate.contractKey) ||
        !isCanonicalId(candidate.field) ||
        !isTradeDate(candidate.tradeDate) ||
        !isSafeTimestamp(candidate.exchangeTimeMs) ||
        !isSafeTimestamp(candidate.receiveTimeMs) ||
        !isCanonicalId(candidate.streamEpoch) ||
        (candidate.sequence !== undefined &&
            candidate.sequence !== null &&
            (!Number.isSafeInteger(candidate.sequence) ||
                (candidate.sequence as number) < 0)) ||
        typeof candidate.simtrade !== 'boolean' ||
        typeof candidate.intradayOdd !== 'boolean'
    ) {
        return reject('invalid_observation');
    }
    const value = normalizedDecimal(candidate.value);
    if (value === null) return reject('invalid_value');
    if (candidate.contractKey !== context.lineageEvidence.contractKey) {
        return reject('wrong_contract');
    }
    if (!isQuoteField(candidate.field)) {
        return reject('field_not_allowed');
    }
    if (candidate.field !== context.lineageEvidence.field) {
        return reject('untrusted_stream_lineage');
    }
    if (!isValueValidForField(candidate.field, value)) {
        return reject('invalid_value');
    }
    if (candidate.mappingVerified !== true) return reject('mapping_unverified');
    if (candidate.delivery !== 'subscription') return reject('non_subscription');
    if (candidate.tradeDate !== context.lineageEvidence.tradeDate) {
        return reject('wrong_trade_date');
    }
    if (candidate.streamEpoch !== context.lineageEvidence.streamEpoch) {
        return reject('wrong_stream_epoch');
    }
    if (candidate.simtrade) return reject('simtrade');
    if (candidate.intradayOdd) return reject('intraday_odd');
    const scope = quoteCursorScope({
        contractKey: candidate.contractKey,
        field: candidate.field,
        streamEpoch: candidate.streamEpoch,
    });
    const previousCursor = currentQuoteCursorByScope.get(scope) ?? null;
    const nowMs = effectiveQuoteNowMs(context.timeEvidence);
    if (nowMs === null) return reject('untrusted_time_evidence');
    if (candidate.exchangeTimeMs > nowMs || candidate.receiveTimeMs > nowMs) {
        return reject('future_timestamp');
    }
    if (
        nowMs - candidate.exchangeTimeMs > SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS ||
        nowMs - candidate.receiveTimeMs > SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS
    ) {
        return reject('stale');
    }
    const sequence =
        candidate.sequence === undefined || candidate.sequence === null
            ? null
            : (candidate.sequence as number);
    if (
        previousCursor &&
        previousCursor.sequence !== null &&
        sequence === null
    ) {
        return reject('sequence_missing_after_cursor');
    }
    const freshUntilMs = Math.min(
        candidate.exchangeTimeMs + SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS,
        candidate.receiveTimeMs + SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS,
    );
    if (!Number.isSafeInteger(freshUntilMs)) return reject('invalid_observation');
    const headRevision = (previousCursor?.headRevision ?? 0) + 1;
    if (!isPositiveRevision(headRevision)) return reject('invalid_observation');
    const observation = Object.freeze({
        headRevision,
        observationId: candidate.observationId,
        contractKey: candidate.contractKey,
        field: candidate.field,
        value,
        tradeDate: candidate.tradeDate,
        exchangeTimeMs: candidate.exchangeTimeMs,
        receiveTimeMs: candidate.receiveTimeMs,
        streamEpoch: candidate.streamEpoch,
        sequence,
        freshUntilMs,
        freshnessPolicyVersion: SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION,
        delivery: 'subscription' as const,
        mappingVerified: true as const,
        simtrade: false as const,
        intradayOdd: false as const,
    }) as EligibleQuoteObservation;
    const cursor = cursorOf(observation);
    if (previousCursor) {
        const order = compareQuoteObservationOrder(previousCursor, cursor);
        if (order !== 'after') return reject(order);
    }
    if ((currentQuoteCursorByScope.get(scope) ?? null) !== previousCursor) {
        return reject('out_of_order');
    }
    currentQuoteCursorByScope.set(scope, cursor);
    trustedEligibleObservations.add(observation);
    trustedObservationCursors.set(observation, cursor);
    trustedObservationLineages.set(observation, context.lineageEvidence);
    return Object.freeze({ eligible: true as const, observation, cursor });
}

export function isObservationFresh(
    observation: EligibleQuoteObservation,
    timeEvidence: QuoteTimeEvidence,
): boolean {
    if (
        !isTrustedEligibleQuoteObservation(observation) ||
        !isTrustedQuoteTimeEvidence(timeEvidence)
    ) {
        return false;
    }
    const nowMs = effectiveQuoteNowMs(timeEvidence);
    if (nowMs === null) return false;
    return (
        nowMs >= observation.exchangeTimeMs &&
        nowMs >= observation.receiveTimeMs &&
        nowMs <= observation.freshUntilMs
    );
}

export function evaluateQuoteLevel(
    observation: EligibleQuoteObservation,
    comparator: QuoteComparator,
    threshold: DecimalString,
): boolean {
    if (!isQuoteObservationCurrent(observation)) {
        throw new TypeError('quote observation is untrusted or superseded');
    }
    if (comparator !== 'gte' && comparator !== 'lte') {
        throw new TypeError('quote comparator is invalid');
    }
    const comparison = compareDecimal(observation.value, threshold);
    return comparator === 'gte' ? comparison >= 0 : comparison <= 0;
}

function duplicateConditionIds(
    conditions: readonly Readonly<{ conditionId: string }>[],
): boolean {
    const ids = conditions.map(({ conditionId }) => conditionId);
    return ids.some((id) => !isCanonicalId(id)) || new Set(ids).size !== ids.length;
}

function span(values: readonly number[]): number {
    return Math.max(...values) - Math.min(...values);
}

export function evaluateAndConditions(
    conditions: readonly ConditionObservation[],
    timeEvidence: QuoteTimeEvidence,
): AndEvaluation {
    if (conditions.length === 0) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'empty_conditions' as const,
            conditionIds: Object.freeze([] as string[]),
        });
    }
    const conditionIds = Object.freeze(
        conditions.map(({ conditionId }) => conditionId).sort(),
    );
    if (duplicateConditionIds(conditions)) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'duplicate_condition_id' as const,
            conditionIds,
        });
    }
    if (conditions.some(({ truth }) => typeof truth !== 'boolean')) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'invalid_condition_truth' as const,
            conditionIds,
        });
    }
    if (!isTrustedQuoteTimeEvidence(timeEvidence)) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'untrusted_time_evidence' as const,
            conditionIds,
        });
    }
    if (
        conditions.some(
            ({ observation }) =>
                !isQuoteObservationCurrent(observation),
        )
    ) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'untrusted_observation' as const,
            conditionIds,
        });
    }
    if (
        conditions.some(
            ({ observation }) => !isObservationFresh(observation, timeEvidence),
        )
    ) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'stale' as const,
            conditionIds,
        });
    }
    if (new Set(conditions.map(({ observation }) => observation.tradeDate)).size !== 1) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'different_trade_date' as const,
            conditionIds,
        });
    }
    if (
        new Set(conditions.map(({ observation }) => observation.streamEpoch)).size !== 1
    ) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'different_stream_epoch' as const,
            conditionIds,
        });
    }
    if (
        span(conditions.map(({ observation }) => observation.exchangeTimeMs)) >
            SMART_ORDER_AND_COHERENCE_WINDOW_MS ||
        span(conditions.map(({ observation }) => observation.receiveTimeMs)) >
            SMART_ORDER_AND_COHERENCE_WINDOW_MS
    ) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'coherence_exceeded' as const,
            conditionIds,
        });
    }
    if (conditions.some(({ truth }) => !truth)) {
        return Object.freeze({
            satisfied: false as const,
            reason: 'condition_false' as const,
            conditionIds,
        });
    }
    const ordered = [...conditions].sort((left, right) =>
        left.conditionId.localeCompare(right.conditionId),
    );
    return Object.freeze({
        satisfied: true as const,
        conditionIds: Object.freeze(ordered.map(({ conditionId }) => conditionId)),
        observationIds: Object.freeze(
            ordered.map(({ observation }) => observation.observationId),
        ),
        tradeDate: ordered[0]!.observation.tradeDate,
        streamEpoch: ordered[0]!.observation.streamEpoch,
    });
}

function commonEvaluationFields(input: Readonly<{
    evaluationId: string;
    truth: boolean;
    observation: EligibleQuoteObservation;
    observations: readonly EligibleQuoteObservation[];
    conditionIds: readonly string[];
    timeEvidence: QuoteTimeEvidence;
}>): QuoteConditionEvaluationEvidenceBase {
    const observations = Object.freeze([...input.observations]);
    const conditionIds = Object.freeze([...input.conditionIds]);
    const observationIds = Object.freeze(
        [...new Set(observations.map(({ observationId }) => observationId))].sort(),
    );
    if (
        !isCanonicalId(input.evaluationId) ||
        typeof input.truth !== 'boolean' ||
        !isTrustedQuoteTimeEvidence(input.timeEvidence) ||
        !isTrustedEligibleQuoteObservation(input.observation) ||
        observations.length === 0 ||
        observations.some(
            (observation) =>
                !isTrustedEligibleQuoteObservation(observation) ||
                observation.tradeDate !== input.observation.tradeDate ||
                observation.streamEpoch !== input.observation.streamEpoch,
        ) ||
        !observations.includes(input.observation) ||
        conditionIds.length === 0 ||
        conditionIds.some((conditionId) => !isCanonicalId(conditionId)) ||
        new Set(conditionIds).size !== conditionIds.length
    ) {
        throw new TypeError('condition evaluation evidence is not canonical');
    }
    return {
        verifierVersion: SMART_ORDER_CONDITION_VERIFIER_VERSION,
        evaluationId: input.evaluationId,
        truth: input.truth,
        observation: input.observation,
        observations,
        conditionIds,
        observationIds,
        tradeDate: input.observation.tradeDate,
        streamEpoch: input.observation.streamEpoch,
        timeEvidence: input.timeEvidence,
    } as QuoteConditionEvaluationEvidenceBase;
}

function mintComparatorEvaluation(input: Readonly<{
    definition: QuoteConditionDefinitionEvidence;
    observation: EligibleQuoteObservation;
    truth: boolean;
    timeEvidence: QuoteTimeEvidence;
}>): QuoteComparatorEvaluationEvidence {
    const common = commonEvaluationFields({
        evaluationId: input.definition.conditionId,
        truth: input.truth,
        observation: input.observation,
        observations: [input.observation],
        conditionIds: [input.definition.conditionId],
        timeEvidence: input.timeEvidence,
    });
    const evidence = Object.freeze({
        ...common,
        evaluationKind: 'comparator' as const,
        definition: input.definition,
        conditionDefinitionHash: input.definition.conditionDefinitionHash,
        strategyId: input.definition.strategyId,
        strategyDefinitionHash: input.definition.strategyDefinitionHash,
        confirmationHash: input.definition.confirmationHash,
        armGeneration: input.definition.armGeneration,
        field: input.definition.field,
        comparator: input.definition.comparator,
        threshold: input.definition.threshold,
        mappingRevision: input.definition.mappingRevision,
    }) as QuoteComparatorEvaluationEvidence;
    trustedConditionEvaluations.add(evidence);
    return evidence;
}

function orderedGroupComponents(
    definition: QuoteConditionGroupDefinitionEvidence,
    evaluations: readonly QuoteConditionEvaluationEvidence[],
): readonly QuoteComparatorEvaluationEvidence[] {
    if (
        !isTrustedQuoteConditionGroupDefinitionEvidence(definition) ||
        evaluations.length !== definition.conditions.length ||
        evaluations.some(
            (evaluation) =>
                !isQuoteConditionEvaluationCurrent(evaluation) ||
                evaluation.evaluationKind !== 'comparator',
        )
    ) {
        throw new TypeError('group verifier child evidence is untrusted or stale');
    }
    const ordered = [...evaluations].sort((left, right) =>
        left.conditionIds[0]!.localeCompare(right.conditionIds[0]!),
    ) as QuoteComparatorEvaluationEvidence[];
    if (
        ordered.some(
            (evaluation, index) =>
                evaluation.definition !== definition.conditions[index] ||
                evaluation.conditionDefinitionHash !==
                    definition.conditionDefinitionHashes[index] ||
                evaluation.strategyId !== definition.strategyId ||
                evaluation.strategyDefinitionHash !==
                    definition.strategyDefinitionHash ||
                evaluation.confirmationHash !== definition.confirmationHash ||
                evaluation.armGeneration !== definition.armGeneration,
        )
    ) {
        throw new TypeError('group verifier requires the complete expected condition set');
    }
    return Object.freeze(ordered);
}

function mintGroupEvaluation(input: Readonly<{
    evaluationKind: 'and' | 'or';
    definition: QuoteConditionGroupDefinitionEvidence;
    components: readonly QuoteComparatorEvaluationEvidence[];
    truth: boolean;
    observation: EligibleQuoteObservation;
    observations: readonly EligibleQuoteObservation[];
    timeEvidence: QuoteTimeEvidence;
}>): QuoteGroupEvaluationEvidence {
    const common = commonEvaluationFields({
        evaluationId: input.definition.groupDefinitionHash.slice('sha256:'.length),
        truth: input.truth,
        observation: input.observation,
        observations: input.observations,
        conditionIds: input.definition.conditionIds,
        timeEvidence: input.timeEvidence,
    });
    const evidence = Object.freeze({
        ...common,
        evaluationKind: input.evaluationKind,
        definition: input.definition,
        groupDefinitionHash: input.definition.groupDefinitionHash,
        strategyId: input.definition.strategyId,
        strategyDefinitionHash: input.definition.strategyDefinitionHash,
        confirmationHash: input.definition.confirmationHash,
        armGeneration: input.definition.armGeneration,
        groupRevision: input.definition.groupRevision,
        components: Object.freeze([...input.components]),
    }) as QuoteGroupEvaluationEvidence;
    trustedConditionEvaluations.add(evidence);
    return evidence;
}

export function isQuoteConditionEvaluationCurrent(
    evidence: QuoteConditionEvaluationEvidence,
): boolean {
    return (
        isTrustedQuoteConditionEvaluationEvidence(evidence) &&
        evidence.observations.every((observation) =>
            isQuoteObservationCurrent(observation) &&
            isObservationFresh(observation, evidence.timeEvidence),
        ) &&
        (evidence.evaluationKind === 'comparator' ||
            evidence.components.every((component) =>
                isQuoteConditionEvaluationCurrent(component),
            ))
    );
}

function evaluationCursorMaterial(
    cursor: Omit<GroupEvaluationCursor, 'vectorHash'>,
): CanonicalObject {
    return cursor as unknown as CanonicalObject;
}

function evaluationCursorHash(
    cursor: Omit<GroupEvaluationCursor, 'vectorHash'>,
): `sha256:${string}` {
    return `sha256:${smartOrderSha256HexSync(
        SMART_ORDER_GROUP_EVALUATION_CURSOR_HASH_DOMAIN +
            stableSerializeCanonical(evaluationCursorMaterial(cursor)),
    )}`;
}

function freezeEvaluationLeg(
    leg: GroupEvaluationLegCursor,
): GroupEvaluationLegCursor {
    return Object.freeze({
        conditionId: leg.conditionId,
        conditionDefinitionHash: leg.conditionDefinitionHash,
        truth: leg.truth,
        cursor: restoreQuoteObservationCursor(leg.cursor),
    });
}

function cursorTruth(
    operator: GroupEvaluationCursor['operator'],
    legs: readonly GroupEvaluationLegCursor[],
): boolean {
    if (operator === 'single') return legs[0]!.truth;
    if (operator === 'and') return legs.every(({ truth }) => truth);
    return legs.some(({ truth }) => truth);
}

function freezeEvaluationCursor(
    input: Omit<GroupEvaluationCursor, 'vectorHash'>,
): GroupEvaluationCursor {
    const legs = Object.freeze(
        input.legs.map(freezeEvaluationLeg).sort((left, right) =>
            left.conditionId.localeCompare(right.conditionId),
        ),
    );
    const withoutHash = {
        ...input,
        legs,
    } as Omit<GroupEvaluationCursor, 'vectorHash'>;
    return Object.freeze({
        ...withoutHash,
        vectorHash: evaluationCursorHash(withoutHash),
    });
}

/**
 * Derives a complete current evaluation vector.  A group never collapses to
 * its display/primary observation: every condition leg is preserved.
 */
export function deriveGroupEvaluationCursor(
    evidence: QuoteConditionEvaluationEvidence,
): GroupEvaluationCursor {
    if (!isQuoteConditionEvaluationCurrent(evidence)) {
        throw new TypeError('condition evaluation is untrusted, stale, or superseded');
    }
    const components =
        evidence.evaluationKind === 'comparator'
            ? [evidence]
            : evidence.components;
    const legs = components.map((component) =>
        freezeEvaluationLeg({
            conditionId: component.definition.conditionId,
            conditionDefinitionHash: component.conditionDefinitionHash,
            truth: component.truth,
            cursor: cursorOf(component.observation),
        }),
    );
    const operator =
        evidence.evaluationKind === 'comparator'
            ? ('single' as const)
            : evidence.evaluationKind;
    const truth = cursorTruth(operator, legs);
    if (truth !== evidence.truth) {
        throw new TypeError('condition evaluation truth does not match its complete vector');
    }
    return freezeEvaluationCursor({
        schemaVersion: SMART_ORDER_GROUP_EVALUATION_CURSOR_SCHEMA,
        evaluationId: evidence.evaluationId,
        operator,
        evaluationDefinitionHash:
            evidence.evaluationKind === 'comparator'
                ? evidence.conditionDefinitionHash
                : evidence.groupDefinitionHash,
        strategyId: evidence.strategyId,
        strategyDefinitionHash: evidence.strategyDefinitionHash,
        confirmationHash: evidence.confirmationHash,
        armGeneration: evidence.armGeneration,
        groupRevision:
            evidence.evaluationKind === 'comparator'
                ? null
                : evidence.groupRevision,
        truth,
        tradeDate: evidence.tradeDate,
        streamEpoch: evidence.streamEpoch,
        legs,
    });
}

function exactRecordKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
): boolean {
    const actual = Object.keys(value).sort();
    const canonical = [...expected].sort();
    return (
        actual.length === canonical.length &&
        canonical.every((key, index) => actual[index] === key)
    );
}

/** Restores only a structurally canonical persisted evaluation vector. */
export function restoreGroupEvaluationCursor(
    value: unknown,
): GroupEvaluationCursor {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('group evaluation cursor must be a canonical record');
    }
    const record = value as Record<string, unknown>;
    if (
        !exactRecordKeys(record, [
            'schemaVersion',
            'evaluationId',
            'operator',
            'evaluationDefinitionHash',
            'strategyId',
            'strategyDefinitionHash',
            'confirmationHash',
            'armGeneration',
            'groupRevision',
            'truth',
            'tradeDate',
            'streamEpoch',
            'legs',
            'vectorHash',
        ]) ||
        record.schemaVersion !== SMART_ORDER_GROUP_EVALUATION_CURSOR_SCHEMA ||
        !isCanonicalId(record.evaluationId) ||
        (record.operator !== 'single' &&
            record.operator !== 'and' &&
            record.operator !== 'or') ||
        !isSha256(record.evaluationDefinitionHash) ||
        !isCanonicalId(record.strategyId) ||
        !isSha256(record.strategyDefinitionHash) ||
        !isSha256(record.confirmationHash) ||
        !isGeneration(record.armGeneration) ||
        (record.groupRevision !== null &&
            !isPositiveRevision(record.groupRevision)) ||
        typeof record.truth !== 'boolean' ||
        !isTradeDate(record.tradeDate) ||
        !isCanonicalId(record.streamEpoch) ||
        !Array.isArray(record.legs) ||
        record.legs.length < 1 ||
        record.legs.length > 7 ||
        !isSha256(record.vectorHash)
    ) {
        throw new TypeError('group evaluation cursor is not canonical');
    }
    if (
        (record.operator === 'single') !== (record.groupRevision === null) ||
        (record.operator === 'single' && record.legs.length !== 1)
    ) {
        throw new TypeError('group evaluation cursor operator is inconsistent');
    }
    const legs = record.legs.map((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new TypeError('group evaluation leg cursor is not canonical');
        }
        const leg = candidate as Record<string, unknown>;
        if (
            !exactRecordKeys(leg, [
                'conditionId',
                'conditionDefinitionHash',
                'truth',
                'cursor',
            ]) ||
            !isCanonicalId(leg.conditionId) ||
            !isSha256(leg.conditionDefinitionHash) ||
            typeof leg.truth !== 'boolean'
        ) {
            throw new TypeError('group evaluation leg cursor is not canonical');
        }
        const cursor = restoreQuoteObservationCursor(leg.cursor);
        if (
            cursor.tradeDate !== record.tradeDate ||
            cursor.streamEpoch !== record.streamEpoch
        ) {
            throw new TypeError('group evaluation leg is outside the vector scope');
        }
        return freezeEvaluationLeg({
            conditionId: leg.conditionId,
            conditionDefinitionHash: leg.conditionDefinitionHash,
            truth: leg.truth,
            cursor,
        });
    });
    const conditionIds = legs.map(({ conditionId }) => conditionId);
    if (
        new Set(conditionIds).size !== conditionIds.length ||
        conditionIds.some(
            (conditionId, index) =>
                index > 0 && conditionIds[index - 1]!.localeCompare(conditionId) >= 0,
        )
    ) {
        throw new TypeError('group evaluation leg order is not canonical');
    }
    if (cursorTruth(record.operator, legs) !== record.truth) {
        throw new TypeError('group evaluation vector truth is inconsistent');
    }
    const restored = freezeEvaluationCursor({
        schemaVersion: SMART_ORDER_GROUP_EVALUATION_CURSOR_SCHEMA,
        evaluationId: record.evaluationId,
        operator: record.operator,
        evaluationDefinitionHash: record.evaluationDefinitionHash,
        strategyId: record.strategyId,
        strategyDefinitionHash: record.strategyDefinitionHash,
        confirmationHash: record.confirmationHash,
        armGeneration: record.armGeneration,
        groupRevision: record.groupRevision as number | null,
        truth: record.truth,
        tradeDate: record.tradeDate,
        streamEpoch: record.streamEpoch,
        legs,
    });
    if (restored.vectorHash !== record.vectorHash) {
        throw new TypeError('group evaluation vector hash mismatch');
    }
    return restored;
}

function sameEvaluationCursorBinding(
    previous: GroupEvaluationCursor,
    current: GroupEvaluationCursor,
): boolean {
    return (
        previous.schemaVersion === current.schemaVersion &&
        previous.evaluationId === current.evaluationId &&
        previous.operator === current.operator &&
        previous.evaluationDefinitionHash === current.evaluationDefinitionHash &&
        previous.strategyId === current.strategyId &&
        previous.strategyDefinitionHash === current.strategyDefinitionHash &&
        previous.confirmationHash === current.confirmationHash &&
        previous.armGeneration === current.armGeneration &&
        previous.groupRevision === current.groupRevision &&
        previous.legs.length === current.legs.length &&
        previous.legs.every((leg, index) => {
            const next = current.legs[index]!;
            return (
                leg.conditionId === next.conditionId &&
                leg.conditionDefinitionHash === next.conditionDefinitionHash &&
                leg.cursor.contractKey === next.cursor.contractKey &&
                leg.cursor.field === next.cursor.field
            );
        })
    );
}

export function compareGroupEvaluationCursors(
    previousValue: GroupEvaluationCursor,
    currentValue: GroupEvaluationCursor,
): GroupEvaluationCursorOrder {
    const previous = restoreGroupEvaluationCursor(previousValue);
    const current = restoreGroupEvaluationCursor(currentValue);
    if (!sameEvaluationCursorBinding(previous, current)) {
        return 'conflicting_replay';
    }
    if (previous.tradeDate !== current.tradeDate) return 'out_of_order';
    let advanced = false;
    for (let index = 0; index < previous.legs.length; index += 1) {
        const priorLeg = previous.legs[index]!;
        const nextLeg = current.legs[index]!;
        if (previous.streamEpoch !== current.streamEpoch) {
            if (
                nextLeg.cursor.exchangeTimeMs < priorLeg.cursor.exchangeTimeMs ||
                nextLeg.cursor.receiveTimeMs < priorLeg.cursor.receiveTimeMs
            ) {
                return 'out_of_order';
            }
            advanced = true;
            continue;
        }
        const order = compareQuoteObservationOrder(
            priorLeg.cursor,
            nextLeg.cursor,
        );
        if (order === 'conflicting_replay' || order === 'out_of_order') {
            return order;
        }
        if (order === 'after') advanced = true;
        if (order === 'duplicate' && priorLeg.truth !== nextLeg.truth) {
            return 'conflicting_replay';
        }
    }
    if (!advanced) {
        return previous.vectorHash === current.vectorHash
            ? 'duplicate'
            : 'conflicting_replay';
    }
    return 'after';
}

export function verifyQuoteComparatorEvaluation(input: Readonly<{
    definition: QuoteConditionDefinitionEvidence;
    observation: EligibleQuoteObservation;
    timeEvidence: QuoteTimeEvidence;
}>): QuoteComparatorEvaluationEvidence {
    if (!isTrustedQuoteConditionDefinitionEvidence(input.definition)) {
        throw new TypeError('condition definition is untrusted');
    }
    if (!isTrustedQuoteTimeEvidence(input.timeEvidence)) {
        throw new TypeError('quote time evidence is untrusted or expired');
    }
    if (
        !isQuoteObservationCurrent(input.observation) ||
        !isObservationFresh(input.observation, input.timeEvidence)
    ) {
        throw new TypeError('quote observation is untrusted, superseded, or stale');
    }
    if (
        input.observation.contractKey !== input.definition.contractKey ||
        input.observation.field !== input.definition.field
    ) {
        throw new TypeError('quote observation does not match current condition definition');
    }
    return mintComparatorEvaluation({
        definition: input.definition,
        truth: evaluateQuoteLevel(
            input.observation,
            input.definition.comparator,
            input.definition.threshold,
        ),
        observation: input.observation,
        timeEvidence: input.timeEvidence,
    });
}

export function verifyAndConditionEvaluation(input: Readonly<{
    definition: QuoteConditionGroupDefinitionEvidence;
    evaluations: readonly QuoteConditionEvaluationEvidence[];
    timeEvidence: QuoteTimeEvidence;
}>): QuoteGroupEvaluationEvidence {
    if (
        !isTrustedQuoteConditionGroupDefinitionEvidence(input.definition) ||
        input.definition.operator !== 'and' ||
        !isTrustedQuoteTimeEvidence(input.timeEvidence)
    ) {
        throw new TypeError('AND verifier input is not canonical');
    }
    const ordered = orderedGroupComponents(
        input.definition,
        input.evaluations,
    );
    const primary = [...ordered]
        .sort((left, right) => {
            const receiveOrder =
                right.observation.receiveTimeMs -
                left.observation.receiveTimeMs;
            if (receiveOrder !== 0) return receiveOrder;
            const exchangeOrder =
                right.observation.exchangeTimeMs -
                left.observation.exchangeTimeMs;
            return exchangeOrder !== 0
                ? exchangeOrder
                : left.definition.conditionId.localeCompare(
                      right.definition.conditionId,
                  );
        })[0]!.observation;
    const evaluated = evaluateAndConditions(
        ordered.map((evaluation) => ({
            conditionId: evaluation.conditionIds[0]!,
            truth: evaluation.truth,
            observation: evaluation.observation,
        })),
        input.timeEvidence,
    );
    if (!evaluated.satisfied && evaluated.reason !== 'condition_false') {
        throw new TypeError(`AND evaluation rejected: ${evaluated.reason}`);
    }
    return mintGroupEvaluation({
        evaluationKind: 'and',
        definition: input.definition,
        components: ordered,
        truth: evaluated.satisfied,
        observation: primary,
        observations: ordered.map(({ observation }) => observation),
        timeEvidence: input.timeEvidence,
    });
}

export function verifyOrConditionEvaluation(input: Readonly<{
    definition: QuoteConditionGroupDefinitionEvidence;
    evaluations: readonly QuoteConditionEvaluationEvidence[];
    timeEvidence: QuoteTimeEvidence;
}>): QuoteGroupEvaluationEvidence {
    if (
        !isTrustedQuoteConditionGroupDefinitionEvidence(input.definition) ||
        input.definition.operator !== 'or' ||
        !isTrustedQuoteTimeEvidence(input.timeEvidence)
    ) {
        throw new TypeError('OR verifier input is not canonical');
    }
    const ordered = orderedGroupComponents(
        input.definition,
        input.evaluations,
    );
    const primary =
        ordered.find(({ truth }) => truth)?.observation ??
        ordered[0]!.observation;
    return mintGroupEvaluation({
        evaluationKind: 'or',
        definition: input.definition,
        components: ordered,
        truth: ordered.some(({ truth }) => truth),
        observation: primary,
        observations: ordered.map(({ observation }) => observation),
        timeEvidence: input.timeEvidence,
    });
}

export function evaluateOrEdges(input: Readonly<{
    previousEvaluation: QuoteGroupEvaluationEvidence | null;
    currentEvaluation: QuoteGroupEvaluationEvidence;
}>): OrEdgeEvaluation {
    const current = input.currentEvaluation;
    const previous = input.previousEvaluation;
    if (
        !isQuoteConditionEvaluationCurrent(current) ||
        current.evaluationKind !== 'or' ||
        (previous !== null &&
            (!isTrustedQuoteConditionEvaluationEvidence(previous) ||
                previous.evaluationKind !== 'or'))
    ) {
        return Object.freeze({
            triggered: false as const,
            reason: 'untrusted_evaluation' as const,
        });
    }
    if (previous === null) {
        return Object.freeze({
            triggered: false as const,
            reason: 'no_fresh_false_to_true_edge' as const,
        });
    }
    if (
        previous.groupDefinitionHash !== current.groupDefinitionHash ||
        previous.groupRevision !== current.groupRevision ||
        previous.strategyId !== current.strategyId ||
        previous.strategyDefinitionHash !== current.strategyDefinitionHash ||
        previous.confirmationHash !== current.confirmationHash ||
        previous.armGeneration !== current.armGeneration ||
        previous.conditionIds.length !== current.conditionIds.length ||
        previous.conditionIds.some(
            (conditionId, index) => conditionId !== current.conditionIds[index],
        )
    ) {
        return Object.freeze({
            triggered: false as const,
            reason: 'different_group_definition' as const,
        });
    }
    const previousByConditionId = new Map(
        previous.components.map((component) => [
            component.definition.conditionId,
            component,
        ]),
    );
    const edges = current.components.filter((component) => {
        const prior = previousByConditionId.get(
            component.definition.conditionId,
        );
        return (
            prior?.truth === false &&
            component.truth &&
            prior.conditionDefinitionHash === component.conditionDefinitionHash &&
            compareQuoteObservationOrder(
                cursorOf(prior.observation),
                cursorOf(component.observation),
            ) === 'after'
        );
    });
    if (edges.length === 0) {
        return Object.freeze({
            triggered: false as const,
            reason: 'no_fresh_false_to_true_edge' as const,
        });
    }
    if (new Set(edges.map(({ tradeDate }) => tradeDate)).size !== 1) {
        return Object.freeze({
            triggered: false as const,
            reason: 'different_trade_date' as const,
        });
    }
    if (new Set(edges.map(({ streamEpoch }) => streamEpoch)).size !== 1) {
        return Object.freeze({
            triggered: false as const,
            reason: 'different_stream_epoch' as const,
        });
    }
    return Object.freeze({
        triggered: true as const,
        winnerConditionId: edges[0]!.definition.conditionId,
        conditionIds: Object.freeze(
            edges.map(({ definition }) => definition.conditionId),
        ),
        observationIds: Object.freeze(
            edges.map(({ observation }) => observation.observationId).sort(),
        ),
        tradeDate: edges[0]!.tradeDate,
        streamEpoch: edges[0]!.streamEpoch,
    });
}

function issueGroupEvaluationContinuityEvidence(input: Readonly<{
    previousCursor: GroupEvaluationCursor | null;
    currentEvaluation: QuoteConditionEvaluationEvidence;
    detectedGap?: QuoteGapReason;
}>): GroupEvaluationContinuityEvidence {
    if (!isQuoteConditionEvaluationCurrent(input.currentEvaluation)) {
        throw new TypeError('current group evaluation is untrusted or inactive');
    }
    if (
        input.detectedGap !== undefined &&
        !isQuoteGapReason(input.detectedGap)
    ) {
        throw new TypeError('detected quote gap reason is invalid');
    }
    const previous =
        input.previousCursor === null
            ? null
            : restoreGroupEvaluationCursor(input.previousCursor);
    const current = deriveGroupEvaluationCursor(input.currentEvaluation);
    if (previous !== null && !sameEvaluationCursorBinding(previous, current)) {
        throw new TypeError('group evaluation continuity binding changed');
    }
    const previousByConditionId = new Map(
        previous?.legs.map((leg) => [leg.conditionId, leg]) ?? [],
    );
    const legs = Object.freeze(
        current.legs.map((currentLeg): GroupEvaluationLegContinuity => {
            const prior = previousByConditionId.get(currentLeg.conditionId) ?? null;
            let continuity: GroupEvaluationLegContinuity['continuity'] =
                'continuous';
            let reason: GroupEvaluationLegContinuity['reason'] = 'contiguous';
            if (prior === null) {
                continuity = 'initial';
                reason = 'initial';
            } else if (input.detectedGap !== undefined) {
                continuity = 'gap';
                reason = input.detectedGap;
            } else if (prior.cursor.streamEpoch !== currentLeg.cursor.streamEpoch) {
                if (
                    currentLeg.cursor.exchangeTimeMs < prior.cursor.exchangeTimeMs ||
                    currentLeg.cursor.receiveTimeMs < prior.cursor.receiveTimeMs
                ) {
                    throw new TypeError('group evaluation vector moved backwards across epoch');
                }
                continuity = 'gap';
                reason = 'epoch_changed';
            } else {
                const order = compareQuoteObservationOrder(
                    prior.cursor,
                    currentLeg.cursor,
                );
                if (order === 'conflicting_replay' || order === 'out_of_order') {
                    continuity = 'gap';
                    reason = order;
                } else if (order === 'duplicate') {
                    if (prior.truth !== currentLeg.truth) {
                        throw new TypeError('stationary group evaluation leg changed truth');
                    }
                    continuity = 'stationary';
                    reason = 'no_progress';
                } else if (
                    prior.cursor.sequence !== null &&
                    currentLeg.cursor.sequence !== null &&
                    currentLeg.cursor.sequence > prior.cursor.sequence + 1
                ) {
                    continuity = 'gap';
                    reason = 'sequence_gap';
                } else if (
                    currentLeg.cursor.exchangeTimeMs -
                            prior.cursor.exchangeTimeMs >
                        SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS ||
                    currentLeg.cursor.receiveTimeMs - prior.cursor.receiveTimeMs >
                        SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS
                ) {
                    continuity = 'gap';
                    reason = 'time_gap';
                }
            }
            return Object.freeze({
                conditionId: currentLeg.conditionId,
                previousObservationId: prior?.cursor.observationId ?? null,
                currentObservationId: currentLeg.cursor.observationId,
                fromStreamEpoch: prior?.cursor.streamEpoch ?? null,
                toStreamEpoch: currentLeg.cursor.streamEpoch,
                continuity,
                reason,
            });
        }),
    );
    const continuity: GroupEvaluationContinuityEvidence['continuity'] =
        previous === null
            ? 'initial'
            : legs.some((leg) => leg.continuity === 'gap')
              ? 'gap'
              : legs.every((leg) => leg.continuity === 'stationary')
                ? 'stationary'
                : 'continuous';
    const evidence = Object.freeze({
        schemaVersion:
            'realtimestock.group-evaluation-continuity/v1' as const,
        evaluationId: current.evaluationId,
        operator: current.operator,
        previousVectorHash: previous?.vectorHash ?? null,
        currentVectorHash: current.vectorHash,
        evaluationDefinitionHash: current.evaluationDefinitionHash,
        strategyId: current.strategyId,
        strategyDefinitionHash: current.strategyDefinitionHash,
        confirmationHash: current.confirmationHash,
        armGeneration: current.armGeneration,
        groupRevision: current.groupRevision,
        tradeDate: current.tradeDate,
        fromStreamEpoch: previous?.streamEpoch ?? null,
        toStreamEpoch: current.streamEpoch,
        continuity,
        legs,
    }) as GroupEvaluationContinuityEvidence;
    trustedGroupEvaluationContinuityEvidence.add(evidence);
    groupContinuityCurrentEvaluation.set(evidence, input.currentEvaluation);
    return evidence;
}

export function isTrustedGroupEvaluationContinuityEvidence(
    value: unknown,
): value is GroupEvaluationContinuityEvidence {
    if (
        !value ||
        typeof value !== 'object' ||
        !Object.isFrozen(value) ||
        !trustedGroupEvaluationContinuityEvidence.has(value)
    ) {
        return false;
    }
    const evidence = value as GroupEvaluationContinuityEvidence;
    const evaluation = groupContinuityCurrentEvaluation.get(value);
    if (!evaluation || !isQuoteConditionEvaluationCurrent(evaluation)) {
        return false;
    }
    const current = deriveGroupEvaluationCursor(evaluation);
    return (
        Object.isFrozen(evidence.legs) &&
        evidence.legs.every(Object.isFrozen) &&
        evidence.schemaVersion ===
            'realtimestock.group-evaluation-continuity/v1' &&
        evidence.evaluationId === current.evaluationId &&
        evidence.operator === current.operator &&
        evidence.currentVectorHash === current.vectorHash &&
        evidence.evaluationDefinitionHash ===
            current.evaluationDefinitionHash &&
        evidence.strategyId === current.strategyId &&
        evidence.strategyDefinitionHash === current.strategyDefinitionHash &&
        evidence.confirmationHash === current.confirmationHash &&
        evidence.armGeneration === current.armGeneration &&
        evidence.groupRevision === current.groupRevision &&
        evidence.tradeDate === current.tradeDate &&
        evidence.toStreamEpoch === current.streamEpoch &&
        evidence.legs.length === current.legs.length &&
        evidence.legs.every((leg, index) => {
            const currentLeg = current.legs[index]!;
            return (
                leg.conditionId === currentLeg.conditionId &&
                leg.currentObservationId ===
                    currentLeg.cursor.observationId &&
                leg.toStreamEpoch === currentLeg.cursor.streamEpoch
            );
        })
    );
}

function issueContinuityEvidence(input: Readonly<{
    previousCursor: QuoteObservationCursor | null;
    currentObservation: EligibleQuoteObservation;
    detectedGap?: QuoteGapReason;
}>): QuoteContinuityEvidence {
    if (!isQuoteObservationCurrent(input.currentObservation)) {
        throw new TypeError('current observation is untrusted or inactive');
    }
    if (
        input.detectedGap !== undefined &&
        !isQuoteGapReason(input.detectedGap)
    ) {
        throw new TypeError('detected quote gap reason is invalid');
    }
    const previous =
        input.previousCursor === null
            ? null
            : restoreQuoteObservationCursor(input.previousCursor);
    const current = input.currentObservation;
    let continuity: QuoteContinuityEvidence['continuity'] = 'continuous';
    let reason: QuoteContinuityEvidence['reason'] = 'contiguous';
    if (previous === null) {
        continuity = 'initial';
        reason = 'initial';
    } else if (input.detectedGap) {
        continuity = 'gap';
        reason = input.detectedGap;
    } else if (
        previous.contractKey !== current.contractKey ||
        previous.field !== current.field
    ) {
        continuity = 'gap';
        reason = 'scope_changed';
    } else if (previous.streamEpoch !== current.streamEpoch) {
        continuity = 'gap';
        reason = 'epoch_changed';
    } else if (
        previous.sequence !== null &&
        current.sequence !== null &&
        current.sequence > previous.sequence + 1
    ) {
        continuity = 'gap';
        reason = 'sequence_gap';
    } else if (
        current.exchangeTimeMs - previous.exchangeTimeMs >
            SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS ||
        current.receiveTimeMs - previous.receiveTimeMs >
            SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS
    ) {
        continuity = 'gap';
        reason = 'time_gap';
    }
    const evidence = Object.freeze({
        continuity,
        reason,
        previousObservationId: previous?.observationId ?? null,
        currentObservationId: current.observationId,
        contractKey: current.contractKey,
        field: current.field,
        fromStreamEpoch: previous?.streamEpoch ?? null,
        toStreamEpoch: current.streamEpoch,
    }) as QuoteContinuityEvidence;
    const lineage = trustedObservationLineages.get(current);
    if (!lineage || !isTrustedQuoteStreamLineageEvidence(lineage)) {
        throw new TypeError('current observation lineage is inactive');
    }
    trustedContinuityEvidence.add(evidence);
    trustedContinuityLineages.set(evidence, lineage);
    return evidence;
}

export type SmartOrderObservationTestOnlyIssuer = Readonly<{
    issueTimeEvidence: typeof issueTimeEvidence;
    advanceTimeAuthority: typeof advanceTimeAuthority;
    rotateTimeGeneration: typeof rotateTimeGeneration;
    readTimeAuthorityState: typeof readTimeAuthorityState;
    resetQuoteObservationHeads: typeof resetQuoteObservationHeads;
    resetConditionDefinitionHeads: typeof resetConditionDefinitionHeads;
    readQuoteObservationHead: typeof readQuoteObservationHead;
    issueQuoteStreamLineageEvidence: typeof issueQuoteStreamLineageEvidence;
    qualifyQuoteObservation: typeof qualifyQuoteObservation;
    issueContinuityEvidence: typeof issueContinuityEvidence;
    issueGroupEvaluationContinuityEvidence: typeof issueGroupEvaluationContinuityEvidence;
    issueConditionDefinitionEvidence: typeof issueConditionDefinitionEvidence;
    issueConditionGroupDefinitionEvidence: typeof issueConditionGroupDefinitionEvidence;
}>;

/**
 * Production bundles expose no generic issuer.  The future server-side quote
 * coordinator must own the production attestation path; ordinary callers can
 * only consume and validate evidence.  Vitest receives a scoped issuer.
 */
export const SMART_ORDER_OBSERVATION_TEST_ONLY:
    | SmartOrderObservationTestOnlyIssuer
    | undefined =
    SMART_ORDER_DOMAIN_TEST_MODE
        ? Object.freeze({
              issueTimeEvidence,
              advanceTimeAuthority,
              rotateTimeGeneration,
              readTimeAuthorityState,
              resetQuoteObservationHeads,
              resetConditionDefinitionHeads,
              readQuoteObservationHead,
              issueQuoteStreamLineageEvidence,
              qualifyQuoteObservation,
              issueContinuityEvidence,
              issueGroupEvaluationContinuityEvidence,
              issueConditionDefinitionEvidence,
              issueConditionGroupDefinitionEvidence,
          })
        : undefined;
