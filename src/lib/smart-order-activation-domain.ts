import {
    domainId,
    stableSerializeCanonical,
    type ActivationId,
    type CanonicalObject,
    type StrategyId,
} from './smart-order-domain';
import {
    compareGroupEvaluationCursors,
    deriveGroupEvaluationCursor,
    isQuoteObservationCurrent,
    isQuoteConditionEvaluationCurrent,
    isTrustedGroupEvaluationContinuityEvidence,
    isTrustedQuoteConditionEvaluationEvidence,
    restoreGroupEvaluationCursor,
    smartOrderSha256HexSync,
    type GroupEvaluationContinuityEvidence,
    type GroupEvaluationCursor,
    type QuoteConditionEvaluationEvidence,
} from './smart-order-observation-domain';
import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';

export const SMART_ORDER_ACTIVATION_ID_DOMAIN =
    'realtimestock.smart-order.activation/v1\n' as const;
export const SMART_ORDER_ACTIVATION_CONFIRMATION_HASH_DOMAIN =
    'realtimestock.smart-order.activation-confirmation/v1\n' as const;

export type ActivationPolicy = 'require_rearm' | 'immediate_if_true';
export type ConditionSemantics = 'level' | 'crossing';

export type StrategyActivationIdentity = Readonly<{
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
}>;

export type EdgeActivationLogicalKey = Readonly<{
    armGeneration: number;
    tradeDate: string;
    edgeGeneration: number;
}>;

export type ScheduleSlotLogicalKey = Readonly<{
    tradeDate: string;
    scheduleRuleRevision: string;
    slotIndex: number;
    nominalSlotTime: string;
}>;

export type EdgeActivationKeyMaterial = Readonly<{
    schema: 'activation/v1';
    strategyId: string;
    strategyDefinitionHash: string;
    activationKind: 'edge';
    logicalKey: EdgeActivationLogicalKey;
}>;

export type ScheduleSlotActivationKeyMaterial = Readonly<{
    schema: 'activation/v1';
    strategyId: string;
    strategyDefinitionHash: string;
    activationKind: 'schedule_slot';
    logicalKey: ScheduleSlotLogicalKey;
}>;

export type DeterministicActivationIdentity<
    Material extends
        | EdgeActivationKeyMaterial
        | ScheduleSlotActivationKeyMaterial,
> = Readonly<{
    activationId: ActivationId;
    canonicalKey: string;
    keyMaterial: Material;
}>;

export type ActivationIdentityComparison =
    | 'same_logical_activation'
    | 'different_activation'
    | 'ACTIVATION_ID_CONFLICT';

declare const edgeTrackerBrand: unique symbol;
declare const edgeTrackerPersistenceAttestationBrand: unique symbol;
declare const edgeTrackerArmEvidenceBrand: unique symbol;
declare const edgeTrackerRepositoryHeadEvidenceBrand: unique symbol;

export type EdgeTrackerPhase =
    | 'awaiting_initial_observation'
    | 'waiting_for_false'
    | 'ready_after_false'
    | 'true_latched';

export type EdgeActivationTracker = Readonly<{
    recordKey: string;
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    activationDefinitionHash: `sha256:${string}`;
    activationConfirmationHash: `sha256:${string}`;
    tradeDate: string;
    armGeneration: number;
    edgeGeneration: number;
    activationPolicy: ActivationPolicy;
    semantics: ConditionSemantics;
    phase: EdgeTrackerPhase;
    lastEvaluationCursor: GroupEvaluationCursor | null;
    lastTruth: boolean | null;
    readonly [edgeTrackerBrand]: 'trusted_edge_tracker';
}>;

export type EdgeTrackerArmEvidence = Readonly<{
    recordKey: string;
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    activationDefinitionHash: `sha256:${string}`;
    activationConfirmationHash: `sha256:${string}`;
    tradeDate: string;
    armGeneration: number;
    activationPolicy: ActivationPolicy;
    semantics: ConditionSemantics;
    readonly [edgeTrackerArmEvidenceBrand]: 'trusted_edge_tracker_arm';
}>;

export type EdgeTrackerInput = Readonly<{
    evaluationEvidence: QuoteConditionEvaluationEvidence;
    continuityEvidence: GroupEvaluationContinuityEvidence;
}>;

export type EdgeTrackerPersistenceAttestation = Readonly<{
    schemaVersion: 'realtimestock.edge-tracker-persistence-attestation/v1';
    repositoryRevision: number;
    recordKey: string;
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    activationDefinitionHash: `sha256:${string}`;
    activationConfirmationHash: `sha256:${string}`;
    canonicalPayload: string;
    payloadHash: `sha256:${string}`;
    readonly [edgeTrackerPersistenceAttestationBrand]: 'trusted_tracker_persistence';
}>;

export type EdgeTrackerRestoreExpectation = Readonly<{
    repositoryRevision: number;
    recordKey: string;
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    activationDefinitionHash: `sha256:${string}`;
    activationConfirmationHash: `sha256:${string}`;
    canonicalPayload: string;
    payloadHash: `sha256:${string}`;
    readonly [edgeTrackerRepositoryHeadEvidenceBrand]: 'trusted_repository_head';
}>;

export type EdgeTrackerActivationConfirmationHashInput = Readonly<{
    recordKey: string;
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    activationDefinitionHash: `sha256:${string}`;
    tradeDate: string;
    armGeneration: number;
    activationPolicy: ActivationPolicy;
    semantics: ConditionSemantics;
}>;

export type EdgeTrackerResult =
    | Readonly<{
          outcome: 'no_activation';
          reason:
              | 'condition_false'
              | 'waiting_for_false'
              | 'already_true';
          tracker: EdgeActivationTracker;
      }>
    | Readonly<{
          outcome: 'activation';
          reason:
              | 'CONDITION_EDGE_FALSE_TO_TRUE'
              | 'CONDITION_IMMEDIATE_CONFIRMED';
          tracker: EdgeActivationTracker;
          logicalKey: EdgeActivationLogicalKey;
          triggeringObservationIds: readonly string[];
      }>
    | Readonly<{
          outcome: 'observation_rejected';
          reason:
              | 'untrusted_observation'
              | 'untrusted_condition_evaluation'
              | 'expired_condition_evaluation'
              | 'untrusted_continuity_evidence'
              | 'continuity_evidence_mismatch'
              | 'condition_definition_mismatch'
              | 'stale'
              | 'wrong_trade_date'
              | 'duplicate'
              | 'out_of_order';
          tracker: EdgeActivationTracker;
      }>
    | Readonly<{
          outcome: 'recovery_required';
          reason:
              | 'QUOTE_GAP_CROSSING_UNKNOWN'
              | 'QUOTE_OBSERVATION_CONFLICT';
          tracker: EdgeActivationTracker;
      }>;

const trustedEdgeTrackers = new WeakSet<object>();
const trustedPersistenceAttestations = new WeakSet<object>();
const consumedPersistenceAttestations = new WeakSet<object>();
const trustedArmEvidence = new WeakSet<object>();
const consumedArmEvidence = new WeakSet<object>();
const trustedRepositoryHeadEvidence = new WeakSet<object>();
const currentRepositoryHeadByRecordKey = new Map<
    string,
    EdgeTrackerRestoreExpectation
>();
const repositoryHeadTrackerState = new WeakMap<
    object,
    Omit<EdgeActivationTracker, typeof edgeTrackerBrand>
>();

function isCanonicalId(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    );
}

function isSha256(value: unknown): value is `sha256:${string}` {
    return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
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

function isGeneration(value: unknown, allowZero: boolean): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= (allowZero ? 0 : 1)
    );
}

/**
 * Binds the one-use activation confirmation to its exact policy, semantics,
 * base confirmation, and canonical condition/group definition hash.
 */
export function deriveEdgeTrackerActivationConfirmationHash(
    input: EdgeTrackerActivationConfirmationHashInput,
): `sha256:${string}` {
    if (
        !isCanonicalId(input.recordKey) ||
        !isCanonicalId(input.strategyId) ||
        !isSha256(input.strategyDefinitionHash) ||
        !isSha256(input.confirmationHash) ||
        !isSha256(input.activationDefinitionHash) ||
        !isTradeDate(input.tradeDate) ||
        !isGeneration(input.armGeneration, true) ||
        !isActivationPolicy(input.activationPolicy) ||
        !isConditionSemantics(input.semantics)
    ) {
        throw new TypeError(
            'edge tracker activation confirmation input is not canonical',
        );
    }
    const canonical = `${SMART_ORDER_ACTIVATION_CONFIRMATION_HASH_DOMAIN}${stableSerializeCanonical(
        {
            activationDefinitionHash: input.activationDefinitionHash,
            activationPolicy: input.activationPolicy,
            armGeneration: input.armGeneration,
            confirmationHash: input.confirmationHash,
            recordKey: input.recordKey,
            semantics: input.semantics,
            strategyDefinitionHash: input.strategyDefinitionHash,
            strategyId: input.strategyId,
            tradeDate: input.tradeDate,
        },
    )}`;
    return `sha256:${smartOrderSha256HexSync(canonical)}`;
}

function assertStrategyIdentity(identity: StrategyActivationIdentity): void {
    if (
        !isCanonicalId(identity.strategyId) ||
        !/^sha256:[0-9a-f]{64}$/.test(identity.strategyDefinitionHash)
    ) {
        throw new TypeError('strategy activation identity is not canonical');
    }
}

function encodeBase32Lower(bytes: Uint8Array): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let buffer = 0;
    let bits = 0;
    let encoded = '';
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            encoded += alphabet[(buffer >>> bits) & 31];
        }
        buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
    if (bits > 0) encoded += alphabet[(buffer << (5 - bits)) & 31];
    return encoded;
}

function asCanonicalObject(
    material:
        | EdgeActivationKeyMaterial
        | ScheduleSlotActivationKeyMaterial,
): CanonicalObject {
    return material as unknown as CanonicalObject;
}

async function deriveActivationIdentity<
    Material extends
        | EdgeActivationKeyMaterial
        | ScheduleSlotActivationKeyMaterial,
>(material: Material): Promise<DeterministicActivationIdentity<Material>> {
    const canonicalKey = `${SMART_ORDER_ACTIVATION_ID_DOMAIN}${stableSerializeCanonical(
        asCanonicalObject(material),
    )}`;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('SHA-256 is unavailable in this Runtime');
    const digest = new Uint8Array(
        await subtle.digest('SHA-256', new TextEncoder().encode(canonicalKey)),
    );
    const activationId = domainId(
        encodeBase32Lower(digest),
        'ActivationId',
    );
    return Object.freeze({ activationId, canonicalKey, keyMaterial: material });
}

function frozenEdgeKey(input: EdgeActivationLogicalKey): EdgeActivationLogicalKey {
    return Object.freeze({ ...input });
}

function frozenScheduleKey(
    input: ScheduleSlotLogicalKey,
): ScheduleSlotLogicalKey {
    return Object.freeze({ ...input });
}

export function buildEdgeActivationKeyMaterial(input: {
    readonly identity: StrategyActivationIdentity;
    readonly armGeneration: number;
    readonly tradeDate: string;
    readonly edgeGeneration: number;
}): EdgeActivationKeyMaterial {
    assertStrategyIdentity(input.identity);
    if (
        !isGeneration(input.armGeneration, true) ||
        !isTradeDate(input.tradeDate) ||
        !isGeneration(input.edgeGeneration, false)
    ) {
        throw new TypeError('edge activation logical key is not canonical');
    }
    return Object.freeze({
        schema: 'activation/v1' as const,
        strategyId: input.identity.strategyId,
        strategyDefinitionHash: input.identity.strategyDefinitionHash,
        activationKind: 'edge' as const,
        logicalKey: frozenEdgeKey({
            armGeneration: input.armGeneration,
            tradeDate: input.tradeDate,
            edgeGeneration: input.edgeGeneration,
        }),
    });
}

export async function deriveEdgeActivationIdentity(input: {
    readonly identity: StrategyActivationIdentity;
    readonly armGeneration: number;
    readonly tradeDate: string;
    readonly edgeGeneration: number;
}): Promise<DeterministicActivationIdentity<EdgeActivationKeyMaterial>> {
    return deriveActivationIdentity(buildEdgeActivationKeyMaterial(input));
}

export function buildScheduleSlotActivationKeyMaterial(input: {
    readonly identity: StrategyActivationIdentity;
    readonly tradeDate: string;
    readonly scheduleRuleRevision: string;
    readonly slotIndex: number;
    readonly nominalSlotTime: string;
}): ScheduleSlotActivationKeyMaterial {
    assertStrategyIdentity(input.identity);
    if (
        !isTradeDate(input.tradeDate) ||
        !isCanonicalId(input.scheduleRuleRevision) ||
        !isGeneration(input.slotIndex, true) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(
            input.nominalSlotTime,
        )
    ) {
        throw new TypeError('schedule-slot activation logical key is not canonical');
    }
    return Object.freeze({
        schema: 'activation/v1' as const,
        strategyId: input.identity.strategyId,
        strategyDefinitionHash: input.identity.strategyDefinitionHash,
        activationKind: 'schedule_slot' as const,
        logicalKey: frozenScheduleKey({
            tradeDate: input.tradeDate,
            scheduleRuleRevision: input.scheduleRuleRevision,
            slotIndex: input.slotIndex,
            nominalSlotTime: input.nominalSlotTime,
        }),
    });
}

export async function deriveScheduleSlotActivationIdentity(input: {
    readonly identity: StrategyActivationIdentity;
    readonly tradeDate: string;
    readonly scheduleRuleRevision: string;
    readonly slotIndex: number;
    readonly nominalSlotTime: string;
}): Promise<
    DeterministicActivationIdentity<ScheduleSlotActivationKeyMaterial>
> {
    return deriveActivationIdentity(
        buildScheduleSlotActivationKeyMaterial(input),
    );
}

export function compareDeterministicActivationIdentity(
    existing: Readonly<{ activationId: string; canonicalKey: string }>,
    candidate: Readonly<{ activationId: string; canonicalKey: string }>,
): ActivationIdentityComparison {
    if (
        !/^[a-z2-7]{52}$/.test(existing?.activationId) ||
        !/^[a-z2-7]{52}$/.test(candidate?.activationId) ||
        typeof existing.canonicalKey !== 'string' ||
        typeof candidate.canonicalKey !== 'string'
    ) {
        throw new TypeError('activation identity comparison input is invalid');
    }
    if (existing.activationId !== candidate.activationId) {
        return 'different_activation';
    }
    return existing.canonicalKey === candidate.canonicalKey
        ? 'same_logical_activation'
        : 'ACTIVATION_ID_CONFLICT';
}

function freezeTracker(
    tracker: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
): EdgeActivationTracker {
    const frozen = Object.freeze({ ...tracker }) as EdgeActivationTracker;
    trustedEdgeTrackers.add(frozen);
    return frozen;
}

function isActivationPolicy(value: unknown): value is ActivationPolicy {
    return value === 'require_rearm' || value === 'immediate_if_true';
}

function isConditionSemantics(value: unknown): value is ConditionSemantics {
    return value === 'level' || value === 'crossing';
}

function isEdgeTrackerPhase(value: unknown): value is EdgeTrackerPhase {
    return (
        value === 'awaiting_initial_observation' ||
        value === 'waiting_for_false' ||
        value === 'ready_after_false' ||
        value === 'true_latched'
    );
}

function parseEdgeActivationTracker(
    value: unknown,
): Omit<EdgeActivationTracker, typeof edgeTrackerBrand> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('edge tracker must be a canonical record');
    }
    const record = value as Record<string, unknown>;
    const expected = [
        'recordKey',
        'strategyId',
        'strategyDefinitionHash',
        'confirmationHash',
        'activationDefinitionHash',
        'activationConfirmationHash',
        'tradeDate',
        'armGeneration',
        'edgeGeneration',
        'activationPolicy',
        'semantics',
        'phase',
        'lastEvaluationCursor',
        'lastTruth',
    ].sort();
    const actual = Object.keys(record).sort();
    if (
        expected.length !== actual.length ||
        expected.some((key, index) => actual[index] !== key) ||
        !isCanonicalId(record.recordKey) ||
        !isCanonicalId(record.strategyId) ||
        !isSha256(record.strategyDefinitionHash) ||
        !isSha256(record.confirmationHash) ||
        !isSha256(record.activationDefinitionHash) ||
        !isSha256(record.activationConfirmationHash) ||
        !isTradeDate(record.tradeDate) ||
        !isGeneration(record.armGeneration, true) ||
        !isGeneration(record.edgeGeneration, true) ||
        !isActivationPolicy(record.activationPolicy) ||
        !isConditionSemantics(record.semantics) ||
        !isEdgeTrackerPhase(record.phase) ||
        (record.lastTruth !== null && typeof record.lastTruth !== 'boolean')
    ) {
        throw new TypeError('edge tracker is not canonical');
    }
    const lastEvaluationCursor =
        record.lastEvaluationCursor === null
            ? null
            : restoreGroupEvaluationCursor(record.lastEvaluationCursor);
    const lastTruth = record.lastTruth as boolean | null;
    const activationConfirmationHash =
        deriveEdgeTrackerActivationConfirmationHash({
            recordKey: record.recordKey,
            strategyId: record.strategyId as StrategyId,
            strategyDefinitionHash: record.strategyDefinitionHash,
            confirmationHash: record.confirmationHash,
            activationDefinitionHash: record.activationDefinitionHash,
            tradeDate: record.tradeDate,
            armGeneration: record.armGeneration,
            activationPolicy: record.activationPolicy,
            semantics: record.semantics,
        });
    if (
        activationConfirmationHash !== record.activationConfirmationHash ||
        (record.phase === 'awaiting_initial_observation' &&
            (lastEvaluationCursor !== null ||
                lastTruth !== null ||
                record.edgeGeneration !== 0)) ||
        (record.phase === 'waiting_for_false' &&
            (record.activationPolicy !== 'require_rearm' ||
                lastEvaluationCursor === null ||
                lastTruth !== true ||
                record.edgeGeneration !== 0)) ||
        (record.phase === 'ready_after_false' &&
            (lastEvaluationCursor === null || lastTruth !== false)) ||
        (record.phase === 'true_latched' &&
            (lastEvaluationCursor === null ||
                lastTruth !== true ||
                (record.edgeGeneration as number) < 1)) ||
        (lastEvaluationCursor !== null &&
            (lastEvaluationCursor.tradeDate !== record.tradeDate ||
                lastEvaluationCursor.strategyId !== record.strategyId ||
                lastEvaluationCursor.strategyDefinitionHash !==
                    record.strategyDefinitionHash ||
                lastEvaluationCursor.confirmationHash !==
                    record.confirmationHash ||
                lastEvaluationCursor.armGeneration !== record.armGeneration ||
                lastEvaluationCursor.evaluationDefinitionHash !==
                    record.activationDefinitionHash ||
                lastEvaluationCursor.truth !== lastTruth))
    ) {
        throw new TypeError('edge tracker invariants are invalid');
    }
    return {
        recordKey: record.recordKey,
        strategyId: record.strategyId as StrategyId,
        strategyDefinitionHash: record.strategyDefinitionHash,
        confirmationHash: record.confirmationHash,
        activationDefinitionHash: record.activationDefinitionHash,
        activationConfirmationHash,
        tradeDate: record.tradeDate,
        armGeneration: record.armGeneration,
        edgeGeneration: record.edgeGeneration,
        activationPolicy: record.activationPolicy,
        semantics: record.semantics,
        phase: record.phase,
        lastEvaluationCursor,
        lastTruth,
    };
}

function canonicalTrackerPayload(
    tracker: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
): string {
    return stableSerializeCanonical(
        tracker as unknown as CanonicalObject,
    );
}

async function sha256Hex(value: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('SHA-256 is unavailable in this Runtime');
    const digest = new Uint8Array(
        await subtle.digest('SHA-256', new TextEncoder().encode(value)),
    );
    return [...digest]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function persistenceHashMaterial(
    tracker: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
    repositoryRevision: number,
    canonicalPayload: string,
): string {
    return `realtimestock.edge-tracker-persistence/v1\n${stableSerializeCanonical(
        {
            repositoryRevision,
            recordKey: tracker.recordKey,
            strategyId: tracker.strategyId,
            strategyDefinitionHash: tracker.strategyDefinitionHash,
            confirmationHash: tracker.confirmationHash,
            activationDefinitionHash: tracker.activationDefinitionHash,
            activationConfirmationHash:
                tracker.activationConfirmationHash,
            canonicalPayload,
        },
    )}`;
}

function issueEdgeTrackerArmEvidence(input: Readonly<{
    recordKey: string;
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    activationDefinitionHash: `sha256:${string}`;
    activationConfirmationHash: `sha256:${string}`;
    tradeDate: string;
    armGeneration: number;
    activationPolicy: ActivationPolicy;
    semantics: ConditionSemantics;
}>): EdgeTrackerArmEvidence {
    if (
        !isCanonicalId(input.recordKey) ||
        !isCanonicalId(input.strategyId) ||
        !isSha256(input.strategyDefinitionHash) ||
        !isSha256(input.confirmationHash) ||
        !isSha256(input.activationDefinitionHash) ||
        !isSha256(input.activationConfirmationHash) ||
        !isTradeDate(input.tradeDate) ||
        !isGeneration(input.armGeneration, true) ||
        !isActivationPolicy(input.activationPolicy) ||
        !isConditionSemantics(input.semantics)
    ) {
        throw new TypeError('edge tracker arm evidence is not canonical');
    }
    const activationConfirmationHash =
        deriveEdgeTrackerActivationConfirmationHash(input);
    if (activationConfirmationHash !== input.activationConfirmationHash) {
        throw new TypeError('edge tracker activation confirmation hash mismatch');
    }
    const evidence = Object.freeze({
        ...input,
        activationConfirmationHash,
    }) as EdgeTrackerArmEvidence;
    trustedArmEvidence.add(evidence);
    return evidence;
}

export function isTrustedEdgeTrackerArmEvidence(
    value: unknown,
): value is EdgeTrackerArmEvidence {
    return (
        !!value &&
        typeof value === 'object' &&
        Object.isFrozen(value) &&
        trustedArmEvidence.has(value) &&
        !consumedArmEvidence.has(value)
    );
}

function sameRepositoryTrackerBinding(
    previous: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
    current: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
): boolean {
    return (
        current.recordKey === previous.recordKey &&
        current.strategyId === previous.strategyId &&
        current.strategyDefinitionHash === previous.strategyDefinitionHash &&
        current.confirmationHash === previous.confirmationHash &&
        current.activationDefinitionHash === previous.activationDefinitionHash &&
        current.activationConfirmationHash ===
            previous.activationConfirmationHash &&
        current.tradeDate === previous.tradeDate &&
        current.armGeneration === previous.armGeneration &&
        current.activationPolicy === previous.activationPolicy &&
        current.semantics === previous.semantics
    );
}

function repositoryEvaluationCursorAdvanced(
    previous: GroupEvaluationCursor | null,
    current: GroupEvaluationCursor | null,
): boolean {
    if (previous === null) return current !== null;
    if (current === null) return false;
    return compareGroupEvaluationCursors(previous, current) === 'after';
}

function expectedNextPhase(
    previous: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
    nextTruth: boolean,
): EdgeTrackerPhase {
    if (!nextTruth) return 'ready_after_false';
    if (previous.phase === 'awaiting_initial_observation') {
        return previous.activationPolicy === 'immediate_if_true'
            ? 'true_latched'
            : 'waiting_for_false';
    }
    if (previous.phase === 'waiting_for_false') return 'waiting_for_false';
    if (previous.phase === 'ready_after_false') return 'true_latched';
    return 'true_latched';
}

/** Accept only a single reducer-reachable semantic step at a newer row head. */
function isAllowedRepositoryTrackerTransition(
    previous: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
    current: Omit<EdgeActivationTracker, typeof edgeTrackerBrand>,
): boolean {
    if (
        !sameRepositoryTrackerBinding(previous, current) ||
        current.lastTruth === null ||
        !repositoryEvaluationCursorAdvanced(
            previous.lastEvaluationCursor,
            current.lastEvaluationCursor,
        ) ||
        current.phase !== expectedNextPhase(previous, current.lastTruth)
    ) {
        return false;
    }
    const expectedEdgeIncrement =
        current.phase === 'true_latched' &&
        previous.phase !== 'true_latched'
            ? 1
            : 0;
    return (
        current.edgeGeneration ===
        previous.edgeGeneration + expectedEdgeIncrement
    );
}

function issueEdgeTrackerRepositoryHeadEvidence(input: Readonly<{
    repositoryRevision: number;
    tracker: unknown;
    recordKey: string;
    strategyId: StrategyId;
    strategyDefinitionHash: `sha256:${string}`;
    confirmationHash: `sha256:${string}`;
    activationDefinitionHash: `sha256:${string}`;
    activationConfirmationHash: `sha256:${string}`;
    payloadHash: `sha256:${string}`;
}>): EdgeTrackerRestoreExpectation {
    const isTrustedRuntimeTracker =
        !!input.tracker &&
        typeof input.tracker === 'object' &&
        Object.isFrozen(input.tracker) &&
        trustedEdgeTrackers.has(input.tracker);
    const parsed = parseEdgeActivationTracker(input.tracker);
    const canonicalPayload = canonicalTrackerPayload(parsed);
    const expectedPayloadHash = `sha256:${smartOrderSha256HexSync(
        persistenceHashMaterial(
            parsed,
            input.repositoryRevision,
            canonicalPayload,
        ),
    )}` as const;
    if (
        !isGeneration(input.repositoryRevision, false) ||
        !isCanonicalId(input.recordKey) ||
        !isCanonicalId(input.strategyId) ||
        !isSha256(input.strategyDefinitionHash) ||
        !isSha256(input.confirmationHash) ||
        !isSha256(input.activationDefinitionHash) ||
        !isSha256(input.activationConfirmationHash) ||
        !isSha256(input.payloadHash) ||
        input.payloadHash !== expectedPayloadHash ||
        input.recordKey !== parsed.recordKey ||
        input.strategyId !== parsed.strategyId ||
        input.strategyDefinitionHash !== parsed.strategyDefinitionHash ||
        input.confirmationHash !== parsed.confirmationHash ||
        input.activationDefinitionHash !== parsed.activationDefinitionHash ||
        input.activationConfirmationHash !==
            parsed.activationConfirmationHash
    ) {
        throw new TypeError('edge tracker repository head is not canonical');
    }
    const current = currentRepositoryHeadByRecordKey.get(input.recordKey);
    if (current) {
        if (input.repositoryRevision < current.repositoryRevision) {
            throw new TypeError(
                'edge tracker repository revision cannot move backwards',
            );
        }
        const sameImmutableBinding =
            input.strategyId === current.strategyId &&
            input.strategyDefinitionHash === current.strategyDefinitionHash &&
            input.confirmationHash === current.confirmationHash &&
            input.activationDefinitionHash ===
                current.activationDefinitionHash &&
            input.activationConfirmationHash ===
                current.activationConfirmationHash;
        if (!sameImmutableBinding) {
            throw new TypeError(
                'edge tracker repository record owner cannot change',
            );
        }
        if (input.repositoryRevision === current.repositoryRevision) {
            if (
                input.payloadHash === current.payloadHash &&
                canonicalPayload === current.canonicalPayload
            ) {
                return current;
            }
            throw new TypeError(
                'edge tracker repository revision has conflicting payload hash',
            );
        }
        const currentState = repositoryHeadTrackerState.get(current);
        if (
            !currentState ||
            !isTrustedRuntimeTracker ||
            canonicalPayload === current.canonicalPayload ||
            !isAllowedRepositoryTrackerTransition(currentState, parsed)
        ) {
            throw new TypeError(
                'edge tracker repository transition is not reducer-reachable',
            );
        }
    }
    const evidence = Object.freeze({
        repositoryRevision: input.repositoryRevision,
        recordKey: parsed.recordKey,
        strategyId: parsed.strategyId,
        strategyDefinitionHash: parsed.strategyDefinitionHash,
        confirmationHash: parsed.confirmationHash,
        activationDefinitionHash: parsed.activationDefinitionHash,
        activationConfirmationHash: parsed.activationConfirmationHash,
        canonicalPayload,
        payloadHash: expectedPayloadHash,
    }) as EdgeTrackerRestoreExpectation;
    trustedRepositoryHeadEvidence.add(evidence);
    repositoryHeadTrackerState.set(evidence, parsed);
    currentRepositoryHeadByRecordKey.set(input.recordKey, evidence);
    return evidence;
}

function resetEdgeTrackerRepositoryHeads(): void {
    currentRepositoryHeadByRecordKey.clear();
}

export function isTrustedEdgeTrackerRepositoryHeadEvidence(
    value: unknown,
): value is EdgeTrackerRestoreExpectation {
    return (
        !!value &&
        typeof value === 'object' &&
        Object.isFrozen(value) &&
        trustedRepositoryHeadEvidence.has(value) &&
        repositoryHeadTrackerState.has(value) &&
        currentRepositoryHeadByRecordKey.get(
            (value as EdgeTrackerRestoreExpectation).recordKey,
        ) === value
    );
}

async function issueEdgeTrackerPersistenceAttestation(
    value: unknown,
    repositoryRevision: number,
): Promise<EdgeTrackerPersistenceAttestation> {
    if (!isGeneration(repositoryRevision, false)) {
        throw new TypeError('repository revision is not canonical');
    }
    const parsed = parseEdgeActivationTracker(value);
    const canonicalPayload = canonicalTrackerPayload(parsed);
    const payloadHash = `sha256:${await sha256Hex(
        persistenceHashMaterial(parsed, repositoryRevision, canonicalPayload),
    )}` as const;
    const attestation = Object.freeze({
        schemaVersion:
            'realtimestock.edge-tracker-persistence-attestation/v1' as const,
        repositoryRevision,
        recordKey: parsed.recordKey,
        strategyId: parsed.strategyId,
        strategyDefinitionHash: parsed.strategyDefinitionHash,
        confirmationHash: parsed.confirmationHash,
        activationDefinitionHash: parsed.activationDefinitionHash,
        activationConfirmationHash: parsed.activationConfirmationHash,
        canonicalPayload,
        payloadHash,
    }) as EdgeTrackerPersistenceAttestation;
    trustedPersistenceAttestations.add(attestation);
    return attestation;
}

export function isTrustedEdgeTrackerPersistenceAttestation(
    value: unknown,
): value is EdgeTrackerPersistenceAttestation {
    return (
        !!value &&
        typeof value === 'object' &&
        Object.isFrozen(value) &&
        trustedPersistenceAttestations.has(value) &&
        !consumedPersistenceAttestations.has(value)
    );
}

export async function restoreEdgeActivationTracker(
    value: unknown,
    attestation: EdgeTrackerPersistenceAttestation,
    expected: EdgeTrackerRestoreExpectation,
): Promise<EdgeActivationTracker> {
    if (!isTrustedEdgeTrackerPersistenceAttestation(attestation)) {
        throw new TypeError('edge tracker persistence attestation is untrusted');
    }
    if (!isTrustedEdgeTrackerRepositoryHeadEvidence(expected)) {
        throw new TypeError('edge tracker repository head is untrusted or stale');
    }
    const expectedState = repositoryHeadTrackerState.get(expected);
    if (!expectedState) {
        throw new TypeError('edge tracker repository head is untrusted or stale');
    }
    const parsed = parseEdgeActivationTracker(value);
    const canonicalPayload = canonicalTrackerPayload(parsed);
    const recomputedHash = `sha256:${await sha256Hex(
        persistenceHashMaterial(
            parsed,
            expected.repositoryRevision,
            canonicalPayload,
        ),
    )}`;
    if (
        !isGeneration(expected.repositoryRevision, false) ||
        !isCanonicalId(expected.recordKey) ||
        !isCanonicalId(expected.strategyId) ||
        !isSha256(expected.strategyDefinitionHash) ||
        !isSha256(expected.confirmationHash) ||
        !isSha256(expected.activationDefinitionHash) ||
        !isSha256(expected.activationConfirmationHash) ||
        typeof expected.canonicalPayload !== 'string' ||
        !isSha256(expected.payloadHash) ||
        attestation.schemaVersion !==
            'realtimestock.edge-tracker-persistence-attestation/v1' ||
        attestation.repositoryRevision !== expected.repositoryRevision ||
        attestation.recordKey !== expected.recordKey ||
        attestation.strategyId !== expected.strategyId ||
        attestation.strategyDefinitionHash !==
            expected.strategyDefinitionHash ||
        attestation.confirmationHash !== expected.confirmationHash ||
        attestation.activationDefinitionHash !==
            expected.activationDefinitionHash ||
        attestation.activationConfirmationHash !==
            expected.activationConfirmationHash ||
        parsed.recordKey !== expected.recordKey ||
        parsed.strategyId !== expected.strategyId ||
        parsed.strategyDefinitionHash !== expected.strategyDefinitionHash ||
        parsed.confirmationHash !== expected.confirmationHash ||
        parsed.activationDefinitionHash !== expected.activationDefinitionHash ||
        parsed.activationConfirmationHash !==
            expected.activationConfirmationHash ||
        !isSha256(attestation.payloadHash) ||
        attestation.payloadHash !== recomputedHash ||
        expected.payloadHash !== recomputedHash ||
        attestation.canonicalPayload !== canonicalPayload ||
        expected.canonicalPayload !== canonicalPayload ||
        canonicalTrackerPayload(expectedState) !== canonicalPayload
    ) {
        throw new TypeError('edge tracker persistence attestation mismatch');
    }
    consumedPersistenceAttestations.add(attestation);
    return freezeTracker(parsed);
}

export function createEdgeActivationTracker(
    armEvidence: EdgeTrackerArmEvidence,
): EdgeActivationTracker {
    if (!isTrustedEdgeTrackerArmEvidence(armEvidence)) {
        throw new TypeError('edge tracker arm evidence is untrusted');
    }
    consumedArmEvidence.add(armEvidence);
    return freezeTracker(
        parseEdgeActivationTracker({
            recordKey: armEvidence.recordKey,
            strategyId: armEvidence.strategyId,
            strategyDefinitionHash: armEvidence.strategyDefinitionHash,
            confirmationHash: armEvidence.confirmationHash,
            activationDefinitionHash: armEvidence.activationDefinitionHash,
            activationConfirmationHash:
                armEvidence.activationConfirmationHash,
            tradeDate: armEvidence.tradeDate,
            armGeneration: armEvidence.armGeneration,
            edgeGeneration: 0,
            activationPolicy: armEvidence.activationPolicy,
            semantics: armEvidence.semantics,
            phase: 'awaiting_initial_observation',
            lastEvaluationCursor: null,
            lastTruth: null,
        }),
    );
}

function withLatest(
    tracker: EdgeActivationTracker,
    input: EdgeTrackerInput,
    phase: EdgeTrackerPhase,
    edgeGeneration = tracker.edgeGeneration,
): EdgeActivationTracker {
    const current = deriveGroupEvaluationCursor(input.evaluationEvidence);
    return freezeTracker({
        recordKey: tracker.recordKey,
        strategyId: tracker.strategyId,
        strategyDefinitionHash: tracker.strategyDefinitionHash,
        confirmationHash: tracker.confirmationHash,
        activationDefinitionHash: tracker.activationDefinitionHash,
        activationConfirmationHash: tracker.activationConfirmationHash,
        tradeDate: tracker.tradeDate,
        armGeneration: tracker.armGeneration,
        edgeGeneration,
        activationPolicy: tracker.activationPolicy,
        semantics: tracker.semantics,
        phase,
        lastEvaluationCursor: current,
        lastTruth: current.truth,
    });
}

function edgeObservationIds(
    previous: GroupEvaluationCursor | null,
    current: GroupEvaluationCursor,
    immediate: boolean,
): readonly string[] {
    const previousLegs = new Map(
        previous?.legs.map((leg) => [leg.conditionId, leg]) ?? [],
    );
    const ids = current.legs
        .filter((leg) => {
            if (!leg.truth) return false;
            if (immediate || previous === null) return true;
            return previousLegs.get(leg.conditionId)?.truth === false;
        })
        .map((leg) => leg.cursor.observationId);
    if (ids.length === 0 || ids.some((id) => !isCanonicalId(id))) {
        throw new TypeError('complete evaluation vector has no canonical edge IDs');
    }
    return Object.freeze([...new Set(ids)].sort());
}

function evaluationDefinitionHash(
    evidence: QuoteConditionEvaluationEvidence,
): `sha256:${string}` {
    return evidence.evaluationKind === 'comparator'
        ? evidence.conditionDefinitionHash
        : evidence.groupDefinitionHash;
}

function activationResult(
    tracker: EdgeActivationTracker,
    input: EdgeTrackerInput,
    reason:
        | 'CONDITION_EDGE_FALSE_TO_TRUE'
        | 'CONDITION_IMMEDIATE_CONFIRMED',
): EdgeTrackerResult {
    const edgeGeneration = tracker.edgeGeneration + 1;
    const current = deriveGroupEvaluationCursor(input.evaluationEvidence);
    if (!Number.isSafeInteger(edgeGeneration)) {
        throw new TypeError('edge generation overflow');
    }
    return Object.freeze({
        outcome: 'activation' as const,
        reason,
        tracker: withLatest(tracker, input, 'true_latched', edgeGeneration),
        logicalKey: frozenEdgeKey({
            armGeneration: tracker.armGeneration,
            tradeDate: tracker.tradeDate,
            edgeGeneration,
        }),
        triggeringObservationIds: edgeObservationIds(
            tracker.lastEvaluationCursor,
            current,
            reason === 'CONDITION_IMMEDIATE_CONFIRMED',
        ),
    });
}

function continuityMatches(
    evidence: GroupEvaluationContinuityEvidence,
    previous: GroupEvaluationCursor | null,
    current: GroupEvaluationCursor,
): boolean {
    return (
        evidence.previousVectorHash === (previous?.vectorHash ?? null) &&
        evidence.currentVectorHash === current.vectorHash &&
        evidence.evaluationId === current.evaluationId &&
        evidence.operator === current.operator &&
        evidence.evaluationDefinitionHash ===
            current.evaluationDefinitionHash &&
        evidence.strategyId === current.strategyId &&
        evidence.strategyDefinitionHash === current.strategyDefinitionHash &&
        evidence.confirmationHash === current.confirmationHash &&
        evidence.armGeneration === current.armGeneration &&
        evidence.groupRevision === current.groupRevision &&
        evidence.tradeDate === current.tradeDate &&
        evidence.fromStreamEpoch === (previous?.streamEpoch ?? null) &&
        evidence.toStreamEpoch === current.streamEpoch &&
        evidence.legs.length === current.legs.length &&
        evidence.legs.every((leg, index) => {
            const currentLeg = current.legs[index]!;
            const previousLeg = previous?.legs[index] ?? null;
            return (
                leg.conditionId === currentLeg.conditionId &&
                leg.previousObservationId ===
                    (previousLeg?.cursor.observationId ?? null) &&
                leg.currentObservationId ===
                    currentLeg.cursor.observationId &&
                leg.fromStreamEpoch ===
                    (previousLeg?.cursor.streamEpoch ?? null) &&
                leg.toStreamEpoch === currentLeg.cursor.streamEpoch
            );
        }) &&
        (previous === null
            ? evidence.continuity === 'initial'
            : evidence.continuity !== 'initial')
    );
}

function rejected(
    tracker: EdgeActivationTracker,
    reason: Extract<EdgeTrackerResult, { outcome: 'observation_rejected' }>['reason'],
): EdgeTrackerResult {
    return Object.freeze({ outcome: 'observation_rejected' as const, reason, tracker });
}

export function advanceEdgeActivationTracker(
    tracker: EdgeActivationTracker,
    input: EdgeTrackerInput,
): EdgeTrackerResult {
    if (!trustedEdgeTrackers.has(tracker) || !Object.isFrozen(tracker)) {
        throw new TypeError('edge tracker is untrusted; restore it first');
    }
    const inputRecord = input as unknown as Record<string, unknown>;
    if (
        'conditionTrue' in inputRecord ||
        'triggeringObservationIds' in inputRecord ||
        'observation' in inputRecord ||
        'timeEvidence' in inputRecord
    ) {
        throw new TypeError(
            'caller-supplied condition truth or observation evidence is forbidden',
        );
    }
    if (
        !isTrustedQuoteConditionEvaluationEvidence(input.evaluationEvidence)
    ) {
        return rejected(tracker, 'untrusted_condition_evaluation');
    }
    if (
        !isQuoteConditionEvaluationCurrent(input.evaluationEvidence) ||
        !isQuoteObservationCurrent(input.evaluationEvidence.observation)
    ) {
        return rejected(tracker, 'expired_condition_evaluation');
    }
    if (
        input.evaluationEvidence.strategyId !== tracker.strategyId ||
        input.evaluationEvidence.strategyDefinitionHash !==
            tracker.strategyDefinitionHash ||
        input.evaluationEvidence.confirmationHash !== tracker.confirmationHash ||
        input.evaluationEvidence.armGeneration !== tracker.armGeneration ||
        evaluationDefinitionHash(input.evaluationEvidence) !==
            tracker.activationDefinitionHash
    ) {
        return rejected(tracker, 'condition_definition_mismatch');
    }
    const current = deriveGroupEvaluationCursor(input.evaluationEvidence);
    const conditionTrue = current.truth;
    if (!isTrustedGroupEvaluationContinuityEvidence(input.continuityEvidence)) {
        return rejected(tracker, 'untrusted_continuity_evidence');
    }
    if (
        !continuityMatches(
            input.continuityEvidence,
            tracker.lastEvaluationCursor,
            current,
        )
    ) {
        return rejected(tracker, 'continuity_evidence_mismatch');
    }
    if (current.tradeDate !== tracker.tradeDate) {
        return rejected(tracker, 'wrong_trade_date');
    }

    const hasGap = input.continuityEvidence.continuity === 'gap';
    if (
        tracker.semantics === 'crossing' &&
        tracker.lastEvaluationCursor !== null &&
        hasGap
    ) {
        return Object.freeze({
            outcome: 'recovery_required' as const,
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN' as const,
            tracker,
        });
    }

    if (tracker.lastEvaluationCursor) {
        const isTrustedEpochTransition =
            tracker.lastEvaluationCursor.streamEpoch !==
                current.streamEpoch &&
            input.continuityEvidence.continuity === 'gap' &&
            input.continuityEvidence.legs.every(
                (leg) => leg.continuity === 'gap',
            );
        if (!isTrustedEpochTransition) {
            const order = compareGroupEvaluationCursors(
                tracker.lastEvaluationCursor,
                current,
            );
            if (order === 'conflicting_replay') {
                return Object.freeze({
                    outcome: 'recovery_required' as const,
                    reason: 'QUOTE_OBSERVATION_CONFLICT' as const,
                    tracker,
                });
            }
            if (order !== 'after') return rejected(tracker, order);
        }
    }

    if (!conditionTrue) {
        return Object.freeze({
            outcome: 'no_activation' as const,
            reason: 'condition_false' as const,
            tracker: withLatest(tracker, input, 'ready_after_false'),
        });
    }
    if (tracker.phase === 'awaiting_initial_observation') {
        if (tracker.activationPolicy === 'immediate_if_true') {
            return activationResult(
                tracker,
                input,
                'CONDITION_IMMEDIATE_CONFIRMED',
            );
        }
        return Object.freeze({
            outcome: 'no_activation' as const,
            reason: 'waiting_for_false' as const,
            tracker: withLatest(tracker, input, 'waiting_for_false'),
        });
    }
    if (tracker.phase === 'waiting_for_false') {
        return Object.freeze({
            outcome: 'no_activation' as const,
            reason: 'waiting_for_false' as const,
            tracker: withLatest(tracker, input, 'waiting_for_false'),
        });
    }
    if (tracker.phase === 'true_latched') {
        return Object.freeze({
            outcome: 'no_activation' as const,
            reason: 'already_true' as const,
            tracker: withLatest(tracker, input, 'true_latched'),
        });
    }
    return activationResult(
        tracker,
        input,
        'CONDITION_EDGE_FALSE_TO_TRUE',
    );
}

export type SmartOrderActivationTestOnlyIssuer = Readonly<{
    issueEdgeTrackerArmEvidence: typeof issueEdgeTrackerArmEvidence;
    issueEdgeTrackerRepositoryHeadEvidence: typeof issueEdgeTrackerRepositoryHeadEvidence;
    issueEdgeTrackerPersistenceAttestation: typeof issueEdgeTrackerPersistenceAttestation;
    resetEdgeTrackerRepositoryHeads: typeof resetEdgeTrackerRepositoryHeads;
}>;

export const SMART_ORDER_ACTIVATION_TEST_ONLY:
    | SmartOrderActivationTestOnlyIssuer
    | undefined =
    SMART_ORDER_DOMAIN_TEST_MODE
        ? Object.freeze({
              issueEdgeTrackerArmEvidence,
              issueEdgeTrackerRepositoryHeadEvidence,
              issueEdgeTrackerPersistenceAttestation,
              resetEdgeTrackerRepositoryHeads,
          })
        : undefined;
