import type { CanonicalContractKey } from './smart-order-domain-types';
import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';
import {
    compareDecimal,
    decimalString,
    SmartOrderMoneyError,
    type DecimalString,
} from './smart-order-domain-money';

/**
 * Immutable Wilder ATR primitives used by smart-order confirmations.
 *
 * All trust-bearing inputs are repository attestations whose object identity is
 * registered in module-private verifier state. Merely reproducing their fields
 * does not confer trust.
 *
 * This file is a pure domain implementation, not a production source adapter
 * and not runtime-ready on its own. Production repository, calendar/session
 * and monotonic-clock adapters remain a separate runtime-integration task and
 * must fail closed until they can mint equivalent capabilities inside their
 * trusted persistence boundary.
 */

export const FIXED_WILDER_ATR_SNAPSHOT_SCHEMA_VERSION =
    'realtimestock.fixed-wilder-atr-snapshot/v2' as const;
export const WILDER_ATR_ALGORITHM_VERSION =
    'realtimestock.wilder-atr/v2-scale18-half-up-per-step' as const;
export const ATR_SOURCE_PAYLOAD_SCHEMA_VERSION =
    'realtimestock.atr-completed-candles/v2' as const;
export const ATR_SOURCE_ENVELOPE_SCHEMA_VERSION =
    'realtimestock.atr-source-envelope/v1' as const;
export const ATR_CANONICAL_SEED_ORIGIN_SCHEMA_VERSION =
    'realtimestock.atr-canonical-sma-seed/v1' as const;
export const ATR_REPOSITORY_ATTESTATION_SCHEMA_VERSION =
    'realtimestock.atr-repository-attestation/v1' as const;
export const ATR_REVISION_EVIDENCE_SCHEMA_VERSION =
    'realtimestock.atr-revision-evidence/v1' as const;
export const ATR_RUNTIME_CONTEXT_EVIDENCE_SCHEMA_VERSION =
    'realtimestock.atr-runtime-context-evidence/v1' as const;
export const ATR_REVISION_EVIDENCE_TTL_MS = 5_000 as const;
export const DEFAULT_WILDER_ATR_PERIOD = 14 as const;
export const DEFAULT_WILDER_ATR_TIMEFRAME = '1D' as const;

const CALCULATION_SCALE = 18;
const CALCULATION_FACTOR = 10n ** BigInt(CALCULATION_SCALE);
const MAX_PERIOD = 1_024;
const MAX_CANDLES = 4_096;

const trustedFixedAtrSnapshots = new WeakSet<object>();
const trustedAtrRepositoryAttestations = new WeakSet<object>();
const trustedAtrRevisionEvidence = new WeakSet<object>();
const trustedAtrRuntimeContextEvidence = new WeakSet<object>();
const consumedAtrRuntimeContextEvidence = new WeakSet<object>();
const currentAtrHeadsByScope = new Map<string, AtrVerifierHead>();
const retiredAtrHeadValuesByScope = new Map<string, AtrRetiredHeadValues>();
const latestAtrRuntimeMonotonicByScope = new Map<string, bigint>();

declare const atrRepositoryAttestationBrand: unique symbol;
declare const atrRevisionEvidenceBrand: unique symbol;
declare const atrRuntimeContextEvidenceBrand: unique symbol;

export type SmartOrderAtrErrorCode =
    | 'invalid_input'
    | 'invalid_timeframe'
    | 'invalid_period'
    | 'invalid_candle'
    | 'incomplete_candle'
    | 'insufficient_completed_candles'
    | 'non_contiguous_candles'
    | 'source_incomplete'
    | 'source_integrity_mismatch'
    | 'source_attestation_untrusted'
    | 'revision_evidence_untrusted'
    | 'runtime_context_untrusted'
    | 'calendar_session_mismatch'
    | 'seed_origin_mismatch'
    | 'hash_unavailable'
    | 'snapshot_integrity_mismatch'
    | 'snapshot_untrusted'
    | 'snapshot_invalidated';

export class SmartOrderAtrError extends Error {
    readonly code: SmartOrderAtrErrorCode;

    constructor(code: SmartOrderAtrErrorCode, message: string) {
        super(message);
        this.name = 'SmartOrderAtrError';
        this.code = code;
    }
}

export type AtrTimeframe = '1D';
export type AtrAdjustmentBasis =
    | 'unadjusted'
    | 'split_adjusted'
    | 'total_return_adjusted';
export type AtrBusinessSessionState = 'open' | 'closed';

export interface CompletedAtrCandle {
    readonly tradingDate: string;
    /** Provider-attested predecessor; avoids guessing weekends or holidays. */
    readonly previousTradingDate: string | null;
    readonly sourceSequence: number;
    readonly completed: true;
    readonly open: DecimalString;
    readonly high: DecimalString;
    readonly low: DecimalString;
    readonly close: DecimalString;
}

/**
 * Canonical repository envelope. The trusted calendar/session resolver places
 * the expected last completed 1D K date in this envelope; the ATR domain never
 * derives it from weekdays or the workstation clock.
 */
export interface AtrSourceEnvelope {
    readonly schemaVersion: typeof ATR_SOURCE_ENVELOPE_SCHEMA_VERSION;
    readonly attestationRevision: string;
    readonly repositoryRevision: string;
    readonly sourceId: string;
    readonly sourceRevision: string;
    readonly contractKey: CanonicalContractKey;
    readonly adjustmentBasis: AtrAdjustmentBasis;
    readonly decisionTradingDate: string;
    readonly expectedAsOfTradingDate: string;
    readonly calendarVersion: string;
    readonly calendarSourceRevision: string;
    readonly businessSessionState: AtrBusinessSessionState;
    readonly businessSessionSourceId: string;
    readonly businessSessionSourceRevision: string;
    readonly calendarSessionEvidenceHash: `sha256:${string}`;
    /** Canonical pre-ATR confirmation context; never includes this snapshot. */
    readonly confirmationContextHash: `sha256:${string}`;
}

/**
 * Versioned, repository-attested origin for the initial Wilder SMA seed.
 * The first candle is the previous-close anchor and candle[period] is the last
 * true-range sample included in the seed. This makes truncated-history choices
 * explicit and hash-bound instead of silently depending on the requested page.
 */
export interface AtrCanonicalSeedOrigin {
    readonly schemaVersion: typeof ATR_CANONICAL_SEED_ORIGIN_SCHEMA_VERSION;
    readonly kind: 'canonical_sma_seed';
    readonly originRevision: string;
    readonly anchorTradingDate: string;
    readonly seedEndTradingDate: string;
}

export interface AtrSourceIntegrity {
    readonly schemaVersion: typeof ATR_SOURCE_PAYLOAD_SCHEMA_VERSION;
    readonly canonicalCandlesHash: `sha256:${string}`;
    readonly coverageStartTradingDate: string;
    readonly coverageEndTradingDate: string;
    readonly completedCandleCount: number;
    readonly completeness: 'complete';
}

export interface TrustedAtrRepositoryAttestation {
    readonly schemaVersion: typeof ATR_REPOSITORY_ATTESTATION_SCHEMA_VERSION;
    readonly attestationRevision: string;
    readonly timeframe: AtrTimeframe;
    readonly period: number;
    readonly sourceEnvelope: AtrSourceEnvelope;
    readonly seedOrigin: AtrCanonicalSeedOrigin;
    readonly expectedCanonicalCandlesHash: `sha256:${string}`;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
    readonly [atrRepositoryAttestationBrand]: 'TrustedAtrRepositoryAttestation';
}

export type AtrRevisionEvidencePurpose = 'restore' | 'reuse';

export interface TrustedAtrRevisionEvidence {
    readonly schemaVersion: typeof ATR_REVISION_EVIDENCE_SCHEMA_VERSION;
    readonly purpose: AtrRevisionEvidencePurpose;
    readonly evidenceRevision: string;
    readonly headSequence: number;
    readonly attestationRevision: string;
    readonly expectedSnapshotHash: `sha256:${string}`;
    readonly repositoryHeadRevision: string;
    readonly calendarSourceRevision: string;
    readonly businessSessionSourceRevision: string;
    readonly runtimeEpochId: string;
    readonly runtimeGeneration: number;
    readonly confirmationContextHash: `sha256:${string}`;
    readonly observedAtMonotonicNs: bigint;
    readonly validUntilMonotonicNs: bigint;
    readonly sourceEnvelope: AtrSourceEnvelope;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
    readonly [atrRevisionEvidenceBrand]: 'TrustedAtrRevisionEvidence';
}

/**
 * One-shot evidence produced from the runtime's current monotonic clock and
 * current persistence heads. Validation consumes object identity so a caller
 * cannot pair a previously observed "now" with revision evidence forever.
 */
export interface TrustedAtrRuntimeContextEvidence {
    readonly schemaVersion: typeof ATR_RUNTIME_CONTEXT_EVIDENCE_SCHEMA_VERSION;
    readonly contractKey: CanonicalContractKey;
    readonly adjustmentBasis: AtrAdjustmentBasis;
    readonly headSequence: number;
    readonly repositoryHeadRevision: string;
    readonly sourceRevision: string;
    readonly sourceId: string;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
    readonly calendarSourceRevision: string;
    readonly calendarVersion: string;
    readonly businessSessionSourceRevision: string;
    readonly businessSessionSourceId: string;
    readonly businessSessionState: AtrBusinessSessionState;
    readonly calendarSessionEvidenceHash: `sha256:${string}`;
    readonly attestationRevision: string;
    readonly runtimeEpochId: string;
    readonly runtimeGeneration: number;
    readonly confirmationContextHash: `sha256:${string}`;
    readonly currentMonotonicNs: bigint;
    readonly [atrRuntimeContextEvidenceBrand]: 'TrustedAtrRuntimeContextEvidence';
}

interface AtrVerifierHead {
    readonly scopeKey: string;
    readonly contractKey: CanonicalContractKey;
    readonly adjustmentBasis: AtrAdjustmentBasis;
    readonly headSequence: number;
    readonly expectedSnapshotHash: `sha256:${string}`;
    readonly repositoryHeadRevision: string;
    readonly sourceRevision: string;
    readonly sourceId: string;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
    readonly calendarSourceRevision: string;
    readonly calendarVersion: string;
    readonly businessSessionSourceRevision: string;
    readonly businessSessionSourceId: string;
    readonly businessSessionState: AtrBusinessSessionState;
    readonly calendarSessionEvidenceHash: `sha256:${string}`;
    readonly attestationRevision: string;
    readonly runtimeEpochId: string;
    readonly runtimeGeneration: number;
    readonly confirmationContextHash: `sha256:${string}`;
    readonly observedAtMonotonicNs: bigint;
    readonly validUntilMonotonicNs: bigint;
}

interface AtrRetiredHeadValues {
    readonly expectedSnapshotHash: Set<string>;
    readonly adjustmentBasis: Set<string>;
    readonly repositoryHeadRevision: Set<string>;
    readonly sourceRevision: Set<string>;
    readonly sourceId: Set<string>;
    readonly contractRevision: Set<string>;
    readonly corporateActionRevision: Set<string>;
    readonly calendarSourceRevision: Set<string>;
    readonly calendarVersion: Set<string>;
    readonly businessSessionSourceRevision: Set<string>;
    readonly businessSessionSourceId: Set<string>;
    readonly businessSessionState: Set<string>;
    readonly calendarSessionEvidenceHash: Set<string>;
    readonly attestationRevision: Set<string>;
    readonly runtimeEpochId: Set<string>;
}

export interface CreateFixedWilderAtrSnapshotInput {
    readonly timeframe: AtrTimeframe;
    readonly period: number;
    readonly candles: readonly CompletedAtrCandle[];
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
    readonly sourceEnvelope: AtrSourceEnvelope;
    readonly seedOrigin: AtrCanonicalSeedOrigin;
    readonly sourceIntegrity: AtrSourceIntegrity;
    readonly sourceAttestation: TrustedAtrRepositoryAttestation;
}

export interface FixedWilderAtrSnapshot {
    readonly schemaVersion: typeof FIXED_WILDER_ATR_SNAPSHOT_SCHEMA_VERSION;
    readonly attestationRevision: string;
    readonly confirmationContextHash: `sha256:${string}`;
    readonly contractKey: CanonicalContractKey;
    readonly adjustmentBasis: AtrAdjustmentBasis;
    readonly timeframe: AtrTimeframe;
    readonly period: number;
    readonly algorithmVersion: typeof WILDER_ATR_ALGORITHM_VERSION;
    readonly value: DecimalString;
    readonly asOfTradingDate: string;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
    readonly sourceEnvelope: AtrSourceEnvelope;
    readonly seedOrigin: AtrCanonicalSeedOrigin;
    readonly sourceIntegrity: AtrSourceIntegrity;
    readonly snapshotHash: `sha256:${string}`;
}

export type FixedAtrSnapshotValidity =
    | Readonly<{ valid: true }>
    | Readonly<{
          valid: false;
          reason:
              | 'snapshot_untrusted'
              | 'revision_evidence_untrusted'
              | 'runtime_context_untrusted'
              | 'revision_evidence_expired'
              | 'snapshot_hash_changed'
              | 'attestation_revision_changed'
              | 'runtime_epoch_changed'
              | 'runtime_generation_changed'
              | 'confirmation_context_changed'
              | 'contract_key_changed'
              | 'adjustment_basis_changed'
              | 'source_revision_changed'
              | 'repository_revision_changed'
              | 'calendar_revision_changed'
              | 'business_session_revision_changed'
              | 'expected_as_of_changed'
              | 'contract_revision_changed'
              | 'corporate_action_revision_changed';
      }>;

export type FixedAtrReuseReason = 'runtime_restart' | 'partial_fill';

function fail(code: SmartOrderAtrErrorCode, message: string): never {
    throw new SmartOrderAtrError(code, message);
}

function exactRecord(
    value: unknown,
    label: string,
    keys: readonly string[],
): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fail('invalid_input', `${label} must be a plain record`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return fail('invalid_input', `${label} must be a plain record`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        return fail('invalid_input', `${label} cannot contain symbol keys`);
    }
    const expected = [...keys].sort();
    const actual = Object.getOwnPropertyNames(value).sort();
    if (
        expected.length !== actual.length ||
        expected.some((key, index) => actual[index] !== key)
    ) {
        return fail('invalid_input', `${label} has missing or unknown fields`);
    }
    for (const key of actual) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            return fail(
                'invalid_input',
                `${label}.${key} must be an enumerable data field`,
            );
        }
    }
    return value as Record<string, unknown>;
}

function canonicalToken(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
    ) {
        return fail('invalid_input', `${label} must be canonical`);
    }
    return value;
}

function canonicalContractKeyValue(value: unknown): CanonicalContractKey {
    if (
        typeof value !== 'string' ||
        !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value)
    ) {
        return fail(
            'invalid_input',
            'contractKey must be a canonical TSE/OTC stock key',
        );
    }
    return value as CanonicalContractKey;
}

function canonicalHash(value: unknown, label: string): `sha256:${string}` {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
        return fail(
            'source_integrity_mismatch',
            `${label} must be a lowercase SHA-256 digest`,
        );
    }
    return value as `sha256:${string}`;
}

function canonicalMonotonicNs(value: unknown, label: string): bigint {
    if (typeof value !== 'bigint' || value < 0n || value > 2n ** 63n - 1n) {
        return fail(
            'revision_evidence_untrusted',
            `${label} must be a non-negative signed-64-bit bigint`,
        );
    }
    return value;
}

function canonicalRuntimeGeneration(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        return fail(
            'revision_evidence_untrusted',
            'runtimeGeneration must be a non-negative safe integer',
        );
    }
    return value as number;
}

function canonicalHeadSequence(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        return fail(
            'revision_evidence_untrusted',
            'headSequence must be a positive safe integer',
        );
    }
    return value as number;
}

function atrVerifierScopeKey(
    contractKey: CanonicalContractKey,
): string {
    // The authoritative repository/source/contract/corporate-action/calendar/
    // session head is shared across confirmation attempts for one contract.
    // A confirmation hash is snapshot-specific evidence, never a namespace in
    // which an older authority head can remain current.
    return JSON.stringify([contractKey]);
}

function emptyRetiredAtrHeadValues(): AtrRetiredHeadValues {
    return {
        expectedSnapshotHash: new Set<string>(),
        adjustmentBasis: new Set<string>(),
        repositoryHeadRevision: new Set<string>(),
        sourceRevision: new Set<string>(),
        sourceId: new Set<string>(),
        contractRevision: new Set<string>(),
        corporateActionRevision: new Set<string>(),
        calendarSourceRevision: new Set<string>(),
        calendarVersion: new Set<string>(),
        businessSessionSourceRevision: new Set<string>(),
        businessSessionSourceId: new Set<string>(),
        businessSessionState: new Set<string>(),
        calendarSessionEvidenceHash: new Set<string>(),
        attestationRevision: new Set<string>(),
        runtimeEpochId: new Set<string>(),
    };
}

function currentHeadFromEvidence(
    evidence: TrustedAtrRevisionEvidence,
): AtrVerifierHead {
    const contractKey = evidence.sourceEnvelope.contractKey;
    return Object.freeze({
        scopeKey: atrVerifierScopeKey(contractKey),
        contractKey,
        adjustmentBasis: evidence.sourceEnvelope.adjustmentBasis,
        headSequence: evidence.headSequence,
        expectedSnapshotHash: evidence.expectedSnapshotHash,
        repositoryHeadRevision: evidence.repositoryHeadRevision,
        sourceRevision: evidence.sourceEnvelope.sourceRevision,
        sourceId: evidence.sourceEnvelope.sourceId,
        contractRevision: evidence.contractRevision,
        corporateActionRevision: evidence.corporateActionRevision,
        calendarSourceRevision: evidence.calendarSourceRevision,
        calendarVersion: evidence.sourceEnvelope.calendarVersion,
        businessSessionSourceRevision:
            evidence.businessSessionSourceRevision,
        businessSessionSourceId:
            evidence.sourceEnvelope.businessSessionSourceId,
        businessSessionState: evidence.sourceEnvelope.businessSessionState,
        calendarSessionEvidenceHash:
            evidence.sourceEnvelope.calendarSessionEvidenceHash,
        attestationRevision: evidence.attestationRevision,
        runtimeEpochId: evidence.runtimeEpochId,
        runtimeGeneration: evidence.runtimeGeneration,
        confirmationContextHash: evidence.confirmationContextHash,
        observedAtMonotonicNs: evidence.observedAtMonotonicNs,
        validUntilMonotonicNs: evidence.validUntilMonotonicNs,
    });
}

const ATR_HEAD_VALUE_KEYS = [
    'expectedSnapshotHash',
    'adjustmentBasis',
    'repositoryHeadRevision',
    'sourceRevision',
    'sourceId',
    'contractRevision',
    'corporateActionRevision',
    'calendarSourceRevision',
    'calendarVersion',
    'businessSessionSourceRevision',
    'businessSessionSourceId',
    'businessSessionState',
    'calendarSessionEvidenceHash',
    'attestationRevision',
] as const;

function headsHaveSamePayload(
    left: AtrVerifierHead,
    right: AtrVerifierHead,
): boolean {
    return (
        left.contractKey === right.contractKey &&
        left.adjustmentBasis === right.adjustmentBasis &&
        left.runtimeEpochId === right.runtimeEpochId &&
        left.runtimeGeneration === right.runtimeGeneration &&
        left.confirmationContextHash === right.confirmationContextHash &&
        left.observedAtMonotonicNs === right.observedAtMonotonicNs &&
        left.validUntilMonotonicNs === right.validUntilMonotonicNs &&
        ATR_HEAD_VALUE_KEYS.every((key) => left[key] === right[key])
    );
}

function advanceAtrVerifierHead(evidence: TrustedAtrRevisionEvidence): void {
    const next = currentHeadFromEvidence(evidence);
    const current = currentAtrHeadsByScope.get(next.scopeKey);
    if (!current) {
        currentAtrHeadsByScope.set(next.scopeKey, next);
        retiredAtrHeadValuesByScope.set(
            next.scopeKey,
            emptyRetiredAtrHeadValues(),
        );
        return;
    }
    if (next.headSequence === current.headSequence) {
        if (!headsHaveSamePayload(current, next)) {
            return fail(
                'revision_evidence_untrusted',
                'same ATR head sequence cannot describe different current heads',
            );
        }
        return;
    }
    if (
        next.headSequence !== current.headSequence + 1 ||
        next.observedAtMonotonicNs <= current.observedAtMonotonicNs ||
        (next.runtimeEpochId === current.runtimeEpochId
            ? next.runtimeGeneration < current.runtimeGeneration
            : next.runtimeGeneration <= current.runtimeGeneration)
    ) {
        return fail(
            'revision_evidence_untrusted',
            'ATR verifier head must advance adjacent sequence, monotonic time and runtime generation',
        );
    }
    const retired = retiredAtrHeadValuesByScope.get(next.scopeKey);
    if (!retired) {
        return fail(
            'revision_evidence_untrusted',
            'ATR verifier retired-head registry is unavailable',
        );
    }
    if (
        next.runtimeEpochId !== current.runtimeEpochId &&
        retired.runtimeEpochId.has(next.runtimeEpochId)
    ) {
        return fail(
            'revision_evidence_untrusted',
            'a retired ATR runtime epoch cannot become current again',
        );
    }
    for (const key of ATR_HEAD_VALUE_KEYS) {
        if (next[key] === current[key]) continue;
        if (retired[key].has(next[key])) {
            return fail(
                'revision_evidence_untrusted',
                `retired ATR ${key} cannot become current again`,
            );
        }
    }
    if (next.runtimeEpochId !== current.runtimeEpochId) {
        retired.runtimeEpochId.add(current.runtimeEpochId);
    }
    for (const key of ATR_HEAD_VALUE_KEYS) {
        if (next[key] !== current[key]) retired[key].add(current[key]);
    }
    currentAtrHeadsByScope.set(next.scopeKey, next);
}

function currentAtrHeadDriftReason(
    evidence: TrustedAtrRevisionEvidence,
): FixedAtrSnapshotValidity {
    const candidate = currentHeadFromEvidence(evidence);
    const current = currentAtrHeadsByScope.get(candidate.scopeKey);
    if (!current) {
        return { valid: false, reason: 'revision_evidence_untrusted' };
    }
    if (candidate.adjustmentBasis !== current.adjustmentBasis) {
        return { valid: false, reason: 'adjustment_basis_changed' };
    }
    if (candidate.repositoryHeadRevision !== current.repositoryHeadRevision) {
        return { valid: false, reason: 'repository_revision_changed' };
    }
    if (candidate.sourceRevision !== current.sourceRevision) {
        return { valid: false, reason: 'source_revision_changed' };
    }
    if (candidate.sourceId !== current.sourceId) {
        return { valid: false, reason: 'source_revision_changed' };
    }
    if (candidate.contractRevision !== current.contractRevision) {
        return { valid: false, reason: 'contract_revision_changed' };
    }
    if (
        candidate.corporateActionRevision !==
        current.corporateActionRevision
    ) {
        return { valid: false, reason: 'corporate_action_revision_changed' };
    }
    if (candidate.calendarSourceRevision !== current.calendarSourceRevision) {
        return { valid: false, reason: 'calendar_revision_changed' };
    }
    if (
        candidate.calendarVersion !== current.calendarVersion ||
        candidate.calendarSessionEvidenceHash !==
            current.calendarSessionEvidenceHash
    ) {
        return { valid: false, reason: 'calendar_revision_changed' };
    }
    if (
        candidate.businessSessionSourceRevision !==
        current.businessSessionSourceRevision
    ) {
        return {
            valid: false,
            reason: 'business_session_revision_changed',
        };
    }
    if (
        candidate.businessSessionSourceId !==
            current.businessSessionSourceId ||
        candidate.businessSessionState !== current.businessSessionState
    ) {
        return {
            valid: false,
            reason: 'business_session_revision_changed',
        };
    }
    if (candidate.attestationRevision !== current.attestationRevision) {
        return { valid: false, reason: 'attestation_revision_changed' };
    }
    if (candidate.runtimeEpochId !== current.runtimeEpochId) {
        return { valid: false, reason: 'runtime_epoch_changed' };
    }
    if (candidate.runtimeGeneration !== current.runtimeGeneration) {
        return { valid: false, reason: 'runtime_generation_changed' };
    }
    if (
        candidate.confirmationContextHash !==
        current.confirmationContextHash
    ) {
        return { valid: false, reason: 'confirmation_context_changed' };
    }
    if (
        candidate.headSequence !== current.headSequence ||
        candidate.expectedSnapshotHash !== current.expectedSnapshotHash ||
        candidate.observedAtMonotonicNs !== current.observedAtMonotonicNs ||
        candidate.validUntilMonotonicNs !== current.validUntilMonotonicNs
    ) {
        return { valid: false, reason: 'revision_evidence_untrusted' };
    }
    return { valid: true };
}

function resetAtrVerifier(): void {
    currentAtrHeadsByScope.clear();
    retiredAtrHeadValuesByScope.clear();
    latestAtrRuntimeMonotonicByScope.clear();
}

function canonicalTradingDate(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        return fail('invalid_candle', `${label} must be YYYY-MM-DD`);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return fail('invalid_candle', `${label} must be YYYY-MM-DD`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthLengths = [
        31,
        leap ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ] as const;
    if (
        !Number.isSafeInteger(year) ||
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > (monthLengths[month - 1] ?? 0)
    ) {
        return fail('invalid_candle', `${label} is not a valid calendar date`);
    }
    return value;
}

function canonicalPrice(value: unknown, label: string): DecimalString {
    if (typeof value !== 'string') {
        return fail('invalid_candle', `${label} must be a decimal string`);
    }
    try {
        const canonical = decimalString(value);
        if (
            canonical !== value ||
            compareDecimal(canonical, decimalString('0')) <= 0
        ) {
            return fail(
                'invalid_candle',
                `${label} must be a positive canonical decimal string`,
            );
        }
        return canonical;
    } catch (error) {
        if (!(error instanceof SmartOrderMoneyError)) throw error;
        return fail('invalid_candle', `${label} must be a valid decimal string`);
    }
}

function validateTimeframe(value: unknown): AtrTimeframe {
    if (value !== '1D') {
        return fail(
            'invalid_timeframe',
            'fixed Wilder ATR v2 requires 1D candles',
        );
    }
    return value;
}

function validatePeriod(value: unknown): number {
    if (
        !Number.isSafeInteger(value) ||
        (value as number) < 1 ||
        (value as number) > MAX_PERIOD
    ) {
        return fail(
            'invalid_period',
            `period must be an integer from 1-${MAX_PERIOD}`,
        );
    }
    return value as number;
}

function normalizeAdjustmentBasis(value: unknown): AtrAdjustmentBasis {
    if (
        value !== 'unadjusted' &&
        value !== 'split_adjusted' &&
        value !== 'total_return_adjusted'
    ) {
        return fail('invalid_input', 'adjustmentBasis is unsupported');
    }
    return value;
}

function normalizeSourceEnvelope(value: unknown): AtrSourceEnvelope {
    const record = exactRecord(value, 'sourceEnvelope', [
        'schemaVersion',
        'attestationRevision',
        'repositoryRevision',
        'sourceId',
        'sourceRevision',
        'contractKey',
        'adjustmentBasis',
        'decisionTradingDate',
        'expectedAsOfTradingDate',
        'calendarVersion',
        'calendarSourceRevision',
        'businessSessionState',
        'businessSessionSourceId',
        'businessSessionSourceRevision',
        'calendarSessionEvidenceHash',
        'confirmationContextHash',
    ]);
    if (record.schemaVersion !== ATR_SOURCE_ENVELOPE_SCHEMA_VERSION) {
        return fail('source_incomplete', 'ATR source envelope is unsupported');
    }
    if (
        record.businessSessionState !== 'open' &&
        record.businessSessionState !== 'closed'
    ) {
        return fail(
            'calendar_session_mismatch',
            'ATR source requires a trusted open or closed business session',
        );
    }
    const decisionTradingDate = canonicalTradingDate(
        record.decisionTradingDate,
        'sourceEnvelope.decisionTradingDate',
    );
    const expectedAsOfTradingDate = canonicalTradingDate(
        record.expectedAsOfTradingDate,
        'sourceEnvelope.expectedAsOfTradingDate',
    );
    if (
        expectedAsOfTradingDate > decisionTradingDate ||
        (record.businessSessionState === 'open' &&
            expectedAsOfTradingDate >= decisionTradingDate)
    ) {
        return fail(
            'calendar_session_mismatch',
            'expectedAsOfTradingDate contradicts the trusted business session',
        );
    }
    return Object.freeze({
        schemaVersion: ATR_SOURCE_ENVELOPE_SCHEMA_VERSION,
        attestationRevision: canonicalToken(
            record.attestationRevision,
            'sourceEnvelope.attestationRevision',
        ),
        repositoryRevision: canonicalToken(
            record.repositoryRevision,
            'sourceEnvelope.repositoryRevision',
        ),
        sourceId: canonicalToken(record.sourceId, 'sourceEnvelope.sourceId'),
        sourceRevision: canonicalToken(
            record.sourceRevision,
            'sourceEnvelope.sourceRevision',
        ),
        contractKey: canonicalContractKeyValue(record.contractKey),
        adjustmentBasis: normalizeAdjustmentBasis(record.adjustmentBasis),
        decisionTradingDate,
        expectedAsOfTradingDate,
        calendarVersion: canonicalToken(
            record.calendarVersion,
            'sourceEnvelope.calendarVersion',
        ),
        calendarSourceRevision: canonicalToken(
            record.calendarSourceRevision,
            'sourceEnvelope.calendarSourceRevision',
        ),
        businessSessionState: record.businessSessionState,
        businessSessionSourceId: canonicalToken(
            record.businessSessionSourceId,
            'sourceEnvelope.businessSessionSourceId',
        ),
        businessSessionSourceRevision: canonicalToken(
            record.businessSessionSourceRevision,
            'sourceEnvelope.businessSessionSourceRevision',
        ),
        calendarSessionEvidenceHash: canonicalHash(
            record.calendarSessionEvidenceHash,
            'sourceEnvelope.calendarSessionEvidenceHash',
        ),
        confirmationContextHash: canonicalHash(
            record.confirmationContextHash,
            'sourceEnvelope.confirmationContextHash',
        ),
    });
}

function canonicalSourceEnvelopePayload(envelope: AtrSourceEnvelope): string {
    return JSON.stringify({
        schemaVersion: envelope.schemaVersion,
        attestationRevision: envelope.attestationRevision,
        repositoryRevision: envelope.repositoryRevision,
        sourceId: envelope.sourceId,
        sourceRevision: envelope.sourceRevision,
        contractKey: envelope.contractKey,
        adjustmentBasis: envelope.adjustmentBasis,
        decisionTradingDate: envelope.decisionTradingDate,
        expectedAsOfTradingDate: envelope.expectedAsOfTradingDate,
        calendarVersion: envelope.calendarVersion,
        calendarSourceRevision: envelope.calendarSourceRevision,
        businessSessionState: envelope.businessSessionState,
        businessSessionSourceId: envelope.businessSessionSourceId,
        businessSessionSourceRevision: envelope.businessSessionSourceRevision,
        calendarSessionEvidenceHash: envelope.calendarSessionEvidenceHash,
        confirmationContextHash: envelope.confirmationContextHash,
    });
}

function normalizeSeedOrigin(value: unknown): AtrCanonicalSeedOrigin {
    const record = exactRecord(value, 'seedOrigin', [
        'schemaVersion',
        'kind',
        'originRevision',
        'anchorTradingDate',
        'seedEndTradingDate',
    ]);
    if (
        record.schemaVersion !== ATR_CANONICAL_SEED_ORIGIN_SCHEMA_VERSION ||
        record.kind !== 'canonical_sma_seed'
    ) {
        return fail(
            'seed_origin_mismatch',
            'ATR seed origin schema or algorithm is unsupported',
        );
    }
    const anchorTradingDate = canonicalTradingDate(
        record.anchorTradingDate,
        'seedOrigin.anchorTradingDate',
    );
    const seedEndTradingDate = canonicalTradingDate(
        record.seedEndTradingDate,
        'seedOrigin.seedEndTradingDate',
    );
    if (seedEndTradingDate <= anchorTradingDate) {
        return fail(
            'seed_origin_mismatch',
            'seed origin must end after its prior-close anchor',
        );
    }
    return Object.freeze({
        schemaVersion: ATR_CANONICAL_SEED_ORIGIN_SCHEMA_VERSION,
        kind: 'canonical_sma_seed' as const,
        originRevision: canonicalToken(
            record.originRevision,
            'seedOrigin.originRevision',
        ),
        anchorTradingDate,
        seedEndTradingDate,
    });
}

function canonicalSeedOriginPayload(origin: AtrCanonicalSeedOrigin): string {
    return JSON.stringify({
        schemaVersion: origin.schemaVersion,
        kind: origin.kind,
        originRevision: origin.originRevision,
        anchorTradingDate: origin.anchorTradingDate,
        seedEndTradingDate: origin.seedEndTradingDate,
    });
}

function normalizeCandle(value: unknown, index: number): CompletedAtrCandle {
    const label = `candles[${index}]`;
    const record = exactRecord(value, label, [
        'tradingDate',
        'previousTradingDate',
        'sourceSequence',
        'completed',
        'open',
        'high',
        'low',
        'close',
    ]);
    if (record.completed !== true) {
        return fail('incomplete_candle', `${label} is not a completed K candle`);
    }
    if (
        !Number.isSafeInteger(record.sourceSequence) ||
        (record.sourceSequence as number) < 0
    ) {
        return fail('invalid_candle', `${label}.sourceSequence is invalid`);
    }
    const tradingDate = canonicalTradingDate(
        record.tradingDate,
        `${label}.tradingDate`,
    );
    const previousTradingDate =
        record.previousTradingDate === null
            ? null
            : canonicalTradingDate(
                  record.previousTradingDate,
                  `${label}.previousTradingDate`,
              );
    const open = canonicalPrice(record.open, `${label}.open`);
    const high = canonicalPrice(record.high, `${label}.high`);
    const low = canonicalPrice(record.low, `${label}.low`);
    const close = canonicalPrice(record.close, `${label}.close`);
    if (
        compareDecimal(high, low) < 0 ||
        compareDecimal(open, low) < 0 ||
        compareDecimal(open, high) > 0 ||
        compareDecimal(close, low) < 0 ||
        compareDecimal(close, high) > 0
    ) {
        return fail('invalid_candle', `${label} has inconsistent OHLC values`);
    }
    return Object.freeze({
        tradingDate,
        previousTradingDate,
        sourceSequence: record.sourceSequence as number,
        completed: true as const,
        open,
        high,
        low,
        close,
    });
}

function normalizeCandleArray(value: unknown): readonly CompletedAtrCandle[] {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > MAX_CANDLES
    ) {
        return fail(
            'invalid_input',
            `candles must contain 1-${MAX_CANDLES} entries`,
        );
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        return fail('invalid_input', 'candles cannot contain symbol keys');
    }
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
            return fail('invalid_input', 'candles must be a dense array');
        }
    }
    const extraKeys = Object.getOwnPropertyNames(value).filter(
        (key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key),
    );
    if (extraKeys.length > 0) {
        return fail('invalid_input', 'candles cannot contain extra fields');
    }
    return Object.freeze(
        value.map((entry, index) => normalizeCandle(entry, index)),
    );
}

function validateContinuity(candles: readonly CompletedAtrCandle[]): void {
    for (let index = 1; index < candles.length; index += 1) {
        const previous = candles[index - 1];
        const current = candles[index];
        if (
            !previous ||
            !current ||
            current.previousTradingDate !== previous.tradingDate ||
            current.tradingDate <= previous.tradingDate ||
            current.sourceSequence !== previous.sourceSequence + 1
        ) {
            return fail(
                'non_contiguous_candles',
                `candles are not provider-attested contiguous at index ${index}`,
            );
        }
    }
}

function validateSeedOriginAgainstCandles(
    origin: AtrCanonicalSeedOrigin,
    candles: readonly CompletedAtrCandle[],
    period: number,
): void {
    if (candles.length < period + 1) {
        return fail(
            'insufficient_completed_candles',
            `Wilder ATR(${period}) requires a prior-close anchor plus ${period} completed candles`,
        );
    }
    const first = candles[0];
    const seedEnd = candles[period];
    if (
        !first ||
        !seedEnd ||
        origin.anchorTradingDate !== first.tradingDate ||
        origin.seedEndTradingDate !== seedEnd.tradingDate
    ) {
        return fail(
            'seed_origin_mismatch',
            'repository-attested seed origin does not match the candle window',
        );
    }
}

function canonicalCandlePayload(input: {
    timeframe: AtrTimeframe;
    period: number;
    sourceEnvelope: AtrSourceEnvelope;
    seedOrigin: AtrCanonicalSeedOrigin;
    candles: readonly CompletedAtrCandle[];
}): string {
    return JSON.stringify({
        schemaVersion: ATR_SOURCE_PAYLOAD_SCHEMA_VERSION,
        timeframe: input.timeframe,
        period: input.period,
        sourceEnvelope: JSON.parse(
            canonicalSourceEnvelopePayload(input.sourceEnvelope),
        ) as unknown,
        seedOrigin: JSON.parse(
            canonicalSeedOriginPayload(input.seedOrigin),
        ) as unknown,
        candles: input.candles.map((candle) => ({
            tradingDate: candle.tradingDate,
            previousTradingDate: candle.previousTradingDate,
            sourceSequence: candle.sourceSequence,
            completed: candle.completed,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
        })),
    });
}

async function sha256(value: string): Promise<`sha256:${string}`> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        return fail('hash_unavailable', 'SHA-256 is unavailable in this Runtime');
    }
    const digest = new Uint8Array(
        await subtle.digest('SHA-256', new TextEncoder().encode(value)),
    );
    const hex = Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
    return `sha256:${hex}`;
}

export async function hashCanonicalAtrCandles(input: {
    readonly timeframe: AtrTimeframe;
    readonly period: number;
    readonly sourceEnvelope: AtrSourceEnvelope;
    readonly seedOrigin: AtrCanonicalSeedOrigin;
    readonly candles: readonly CompletedAtrCandle[];
}): Promise<`sha256:${string}`> {
    const record = exactRecord(input, 'ATR candle hash input', [
        'timeframe',
        'period',
        'sourceEnvelope',
        'seedOrigin',
        'candles',
    ]);
    const timeframe = validateTimeframe(record.timeframe);
    const period = validatePeriod(record.period);
    const sourceEnvelope = normalizeSourceEnvelope(record.sourceEnvelope);
    const seedOrigin = normalizeSeedOrigin(record.seedOrigin);
    const candles = normalizeCandleArray(record.candles);
    validateContinuity(candles);
    validateSeedOriginAgainstCandles(seedOrigin, candles, period);
    const last = candles.at(-1);
    if (!last || last.tradingDate !== sourceEnvelope.expectedAsOfTradingDate) {
        return fail(
            'calendar_session_mismatch',
            'completed candle coverage does not end at trusted expectedAsOfTradingDate',
        );
    }
    return sha256(
        canonicalCandlePayload({
            timeframe,
            period,
            sourceEnvelope,
            seedOrigin,
            candles,
        }),
    );
}

function normalizeSourceIntegrity(
    value: unknown,
    candles?: readonly CompletedAtrCandle[],
): AtrSourceIntegrity {
    const record = exactRecord(value, 'sourceIntegrity', [
        'schemaVersion',
        'canonicalCandlesHash',
        'coverageStartTradingDate',
        'coverageEndTradingDate',
        'completedCandleCount',
        'completeness',
    ]);
    if (
        record.schemaVersion !== ATR_SOURCE_PAYLOAD_SCHEMA_VERSION ||
        record.completeness !== 'complete'
    ) {
        return fail(
            'source_incomplete',
            'ATR source must declare the current schema and complete coverage',
        );
    }
    const coverageStartTradingDate = canonicalTradingDate(
        record.coverageStartTradingDate,
        'sourceIntegrity.coverageStartTradingDate',
    );
    const coverageEndTradingDate = canonicalTradingDate(
        record.coverageEndTradingDate,
        'sourceIntegrity.coverageEndTradingDate',
    );
    if (
        !Number.isSafeInteger(record.completedCandleCount) ||
        (record.completedCandleCount as number) < 1 ||
        coverageEndTradingDate < coverageStartTradingDate
    ) {
        return fail(
            'source_integrity_mismatch',
            'ATR source coverage metadata is invalid',
        );
    }
    if (candles) {
        const first = candles[0];
        const last = candles.at(-1);
        if (
            !first ||
            !last ||
            record.completedCandleCount !== candles.length ||
            coverageStartTradingDate !== first.tradingDate ||
            coverageEndTradingDate !== last.tradingDate
        ) {
            return fail(
                'source_integrity_mismatch',
                'ATR source coverage does not match the completed candle set',
            );
        }
    }
    return Object.freeze({
        schemaVersion: ATR_SOURCE_PAYLOAD_SCHEMA_VERSION,
        canonicalCandlesHash: canonicalHash(
            record.canonicalCandlesHash,
            'sourceIntegrity.canonicalCandlesHash',
        ),
        coverageStartTradingDate,
        coverageEndTradingDate,
        completedCandleCount: record.completedCandleCount as number,
        completeness: 'complete' as const,
    });
}

function repositoryAttestationMatches(
    attestation: TrustedAtrRepositoryAttestation,
    input: {
        timeframe: AtrTimeframe;
        period: number;
        sourceEnvelope: AtrSourceEnvelope;
        seedOrigin: AtrCanonicalSeedOrigin;
        canonicalCandlesHash: `sha256:${string}`;
        contractRevision: string;
        corporateActionRevision: string;
    },
): boolean {
    return (
        attestation.attestationRevision ===
            input.sourceEnvelope.attestationRevision &&
        attestation.timeframe === input.timeframe &&
        attestation.period === input.period &&
        canonicalSourceEnvelopePayload(attestation.sourceEnvelope) ===
            canonicalSourceEnvelopePayload(input.sourceEnvelope) &&
        canonicalSeedOriginPayload(attestation.seedOrigin) ===
            canonicalSeedOriginPayload(input.seedOrigin) &&
        attestation.expectedCanonicalCandlesHash ===
            input.canonicalCandlesHash &&
        attestation.contractRevision === input.contractRevision &&
        attestation.corporateActionRevision ===
            input.corporateActionRevision
    );
}

/**
 * Test-only seam for a repository/source-verifier capability. It is unusable
 * in production builds and returned objects are trusted by identity, not shape.
 */
function issueRepositoryAttestation(input: {
    readonly schemaVersion: typeof ATR_REPOSITORY_ATTESTATION_SCHEMA_VERSION;
    readonly attestationRevision: string;
    readonly timeframe: AtrTimeframe;
    readonly period: number;
    readonly sourceEnvelope: AtrSourceEnvelope;
    readonly seedOrigin: AtrCanonicalSeedOrigin;
    readonly expectedCanonicalCandlesHash: `sha256:${string}`;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
}): TrustedAtrRepositoryAttestation {
    const record = exactRecord(input, 'ATR repository attestation input', [
        'schemaVersion',
        'attestationRevision',
        'timeframe',
        'period',
        'sourceEnvelope',
        'seedOrigin',
        'expectedCanonicalCandlesHash',
        'contractRevision',
        'corporateActionRevision',
    ]);
    if (record.schemaVersion !== ATR_REPOSITORY_ATTESTATION_SCHEMA_VERSION) {
        return fail(
            'source_attestation_untrusted',
            'ATR repository attestation schema is unsupported',
        );
    }
    const attestation = Object.freeze({
        schemaVersion: ATR_REPOSITORY_ATTESTATION_SCHEMA_VERSION,
        attestationRevision: canonicalToken(
            record.attestationRevision,
            'attestationRevision',
        ),
        timeframe: validateTimeframe(record.timeframe),
        period: validatePeriod(record.period),
        sourceEnvelope: normalizeSourceEnvelope(record.sourceEnvelope),
        seedOrigin: normalizeSeedOrigin(record.seedOrigin),
        expectedCanonicalCandlesHash: canonicalHash(
            record.expectedCanonicalCandlesHash,
            'expectedCanonicalCandlesHash',
        ),
        contractRevision: canonicalToken(
            record.contractRevision,
            'contractRevision',
        ),
        corporateActionRevision: canonicalToken(
            record.corporateActionRevision,
            'corporateActionRevision',
        ),
    }) as TrustedAtrRepositoryAttestation;
    if (
        attestation.attestationRevision !==
        attestation.sourceEnvelope.attestationRevision
    ) {
        return fail(
            'source_attestation_untrusted',
            'attestationRevision must match the canonical source envelope',
        );
    }
    trustedAtrRepositoryAttestations.add(attestation);
    return attestation;
}

/**
 * Test-only seam for an immutable repository revision lookup. Restore requires
 * this independently loaded expectedSnapshotHash; a hash carried by the
 * persisted payload cannot attest itself.
 */
function issueRevisionEvidence(input: {
    readonly schemaVersion: typeof ATR_REVISION_EVIDENCE_SCHEMA_VERSION;
    readonly purpose: AtrRevisionEvidencePurpose;
    readonly evidenceRevision: string;
    readonly headSequence: number;
    readonly attestationRevision: string;
    readonly expectedSnapshotHash: `sha256:${string}`;
    readonly repositoryHeadRevision: string;
    readonly calendarSourceRevision: string;
    readonly businessSessionSourceRevision: string;
    readonly runtimeEpochId: string;
    readonly runtimeGeneration: number;
    readonly confirmationContextHash: `sha256:${string}`;
    readonly observedAtMonotonicNs: bigint;
    readonly sourceEnvelope: AtrSourceEnvelope;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
}): TrustedAtrRevisionEvidence {
    const record = exactRecord(input, 'ATR revision evidence input', [
        'schemaVersion',
        'purpose',
        'evidenceRevision',
        'headSequence',
        'attestationRevision',
        'expectedSnapshotHash',
        'repositoryHeadRevision',
        'calendarSourceRevision',
        'businessSessionSourceRevision',
        'runtimeEpochId',
        'runtimeGeneration',
        'confirmationContextHash',
        'observedAtMonotonicNs',
        'sourceEnvelope',
        'contractRevision',
        'corporateActionRevision',
    ]);
    if (record.schemaVersion !== ATR_REVISION_EVIDENCE_SCHEMA_VERSION) {
        return fail(
            'revision_evidence_untrusted',
            'ATR revision evidence schema is unsupported',
        );
    }
    if (record.purpose !== 'restore' && record.purpose !== 'reuse') {
        return fail(
            'revision_evidence_untrusted',
            'ATR revision evidence purpose is unsupported',
        );
    }
    const sourceEnvelope = normalizeSourceEnvelope(record.sourceEnvelope);
    const observedAtMonotonicNs = canonicalMonotonicNs(
        record.observedAtMonotonicNs,
        'observedAtMonotonicNs',
    );
    const validUntilMonotonicNs =
        observedAtMonotonicNs +
        BigInt(ATR_REVISION_EVIDENCE_TTL_MS) * 1_000_000n;
    if (validUntilMonotonicNs > 2n ** 63n - 1n) {
        return fail(
            'revision_evidence_untrusted',
            'ATR revision evidence TTL exceeds monotonic clock bounds',
        );
    }
    const evidence = Object.freeze({
        schemaVersion: ATR_REVISION_EVIDENCE_SCHEMA_VERSION,
        purpose: record.purpose,
        evidenceRevision: canonicalToken(
            record.evidenceRevision,
            'evidenceRevision',
        ),
        headSequence: canonicalHeadSequence(record.headSequence),
        attestationRevision: canonicalToken(
            record.attestationRevision,
            'attestationRevision',
        ),
        expectedSnapshotHash: canonicalHash(
            record.expectedSnapshotHash,
            'expectedSnapshotHash',
        ),
        repositoryHeadRevision: canonicalToken(
            record.repositoryHeadRevision,
            'repositoryHeadRevision',
        ),
        calendarSourceRevision: canonicalToken(
            record.calendarSourceRevision,
            'calendarSourceRevision',
        ),
        businessSessionSourceRevision: canonicalToken(
            record.businessSessionSourceRevision,
            'businessSessionSourceRevision',
        ),
        runtimeEpochId: canonicalToken(
            record.runtimeEpochId,
            'runtimeEpochId',
        ),
        runtimeGeneration: canonicalRuntimeGeneration(
            record.runtimeGeneration,
        ),
        confirmationContextHash: canonicalHash(
            record.confirmationContextHash,
            'confirmationContextHash',
        ),
        observedAtMonotonicNs,
        validUntilMonotonicNs,
        sourceEnvelope,
        contractRevision: canonicalToken(
            record.contractRevision,
            'contractRevision',
        ),
        corporateActionRevision: canonicalToken(
            record.corporateActionRevision,
            'corporateActionRevision',
        ),
    }) as TrustedAtrRevisionEvidence;
    if (
        evidence.attestationRevision !== sourceEnvelope.attestationRevision ||
        evidence.repositoryHeadRevision !==
            sourceEnvelope.repositoryRevision ||
        evidence.calendarSourceRevision !==
            sourceEnvelope.calendarSourceRevision ||
        evidence.businessSessionSourceRevision !==
            sourceEnvelope.businessSessionSourceRevision ||
        evidence.confirmationContextHash !==
            sourceEnvelope.confirmationContextHash
    ) {
        return fail(
            'revision_evidence_untrusted',
            'revision evidence does not match its current repository/calendar/session context',
        );
    }
    advanceAtrVerifierHead(evidence);
    trustedAtrRevisionEvidence.add(evidence);
    return evidence;
}

/**
 * Test-only seam for a one-shot current runtime/clock capability. Production
 * code must issue this from the trusted runtime clock and persistence heads.
 */
function issueRuntimeContextEvidence(input: {
    readonly schemaVersion: typeof ATR_RUNTIME_CONTEXT_EVIDENCE_SCHEMA_VERSION;
    readonly contractKey: CanonicalContractKey;
    readonly adjustmentBasis: AtrAdjustmentBasis;
    readonly headSequence: number;
    readonly repositoryHeadRevision: string;
    readonly sourceRevision: string;
    readonly sourceId: string;
    readonly contractRevision: string;
    readonly corporateActionRevision: string;
    readonly calendarSourceRevision: string;
    readonly calendarVersion: string;
    readonly businessSessionSourceRevision: string;
    readonly businessSessionSourceId: string;
    readonly businessSessionState: AtrBusinessSessionState;
    readonly calendarSessionEvidenceHash: `sha256:${string}`;
    readonly attestationRevision: string;
    readonly runtimeEpochId: string;
    readonly runtimeGeneration: number;
    readonly confirmationContextHash: `sha256:${string}`;
    readonly currentMonotonicNs: bigint;
}): TrustedAtrRuntimeContextEvidence {
    const record = exactRecord(input, 'ATR runtime context evidence input', [
        'schemaVersion',
        'contractKey',
        'adjustmentBasis',
        'headSequence',
        'repositoryHeadRevision',
        'sourceRevision',
        'sourceId',
        'contractRevision',
        'corporateActionRevision',
        'calendarSourceRevision',
        'calendarVersion',
        'businessSessionSourceRevision',
        'businessSessionSourceId',
        'businessSessionState',
        'calendarSessionEvidenceHash',
        'attestationRevision',
        'runtimeEpochId',
        'runtimeGeneration',
        'confirmationContextHash',
        'currentMonotonicNs',
    ]);
    if (
        record.schemaVersion !== ATR_RUNTIME_CONTEXT_EVIDENCE_SCHEMA_VERSION
    ) {
        return fail(
            'runtime_context_untrusted',
            'ATR runtime context evidence schema is unsupported',
        );
    }
    const evidence = Object.freeze({
        schemaVersion: ATR_RUNTIME_CONTEXT_EVIDENCE_SCHEMA_VERSION,
        contractKey: canonicalContractKeyValue(record.contractKey),
        adjustmentBasis: normalizeAdjustmentBasis(record.adjustmentBasis),
        headSequence: canonicalHeadSequence(record.headSequence),
        repositoryHeadRevision: canonicalToken(
            record.repositoryHeadRevision,
            'runtimeContext.repositoryHeadRevision',
        ),
        sourceRevision: canonicalToken(
            record.sourceRevision,
            'runtimeContext.sourceRevision',
        ),
        sourceId: canonicalToken(
            record.sourceId,
            'runtimeContext.sourceId',
        ),
        contractRevision: canonicalToken(
            record.contractRevision,
            'runtimeContext.contractRevision',
        ),
        corporateActionRevision: canonicalToken(
            record.corporateActionRevision,
            'runtimeContext.corporateActionRevision',
        ),
        calendarSourceRevision: canonicalToken(
            record.calendarSourceRevision,
            'runtimeContext.calendarSourceRevision',
        ),
        calendarVersion: canonicalToken(
            record.calendarVersion,
            'runtimeContext.calendarVersion',
        ),
        businessSessionSourceRevision: canonicalToken(
            record.businessSessionSourceRevision,
            'runtimeContext.businessSessionSourceRevision',
        ),
        businessSessionSourceId: canonicalToken(
            record.businessSessionSourceId,
            'runtimeContext.businessSessionSourceId',
        ),
        businessSessionState:
            record.businessSessionState === 'open' ||
            record.businessSessionState === 'closed'
                ? record.businessSessionState
                : fail(
                      'runtime_context_untrusted',
                      'runtimeContext.businessSessionState is unsupported',
                  ),
        calendarSessionEvidenceHash: canonicalHash(
            record.calendarSessionEvidenceHash,
            'runtimeContext.calendarSessionEvidenceHash',
        ),
        attestationRevision: canonicalToken(
            record.attestationRevision,
            'runtimeContext.attestationRevision',
        ),
        runtimeEpochId: canonicalToken(
            record.runtimeEpochId,
            'runtimeContext.runtimeEpochId',
        ),
        runtimeGeneration: canonicalRuntimeGeneration(
            record.runtimeGeneration,
        ),
        confirmationContextHash: canonicalHash(
            record.confirmationContextHash,
            'runtimeContext.confirmationContextHash',
        ),
        currentMonotonicNs: canonicalMonotonicNs(
            record.currentMonotonicNs,
            'runtimeContext.currentMonotonicNs',
        ),
    }) as TrustedAtrRuntimeContextEvidence;
    const scopeKey = atrVerifierScopeKey(evidence.contractKey);
    const current = currentAtrHeadsByScope.get(scopeKey);
    const latestRuntimeMonotonicNs =
        latestAtrRuntimeMonotonicByScope.get(scopeKey);
    if (
        !current ||
        evidence.headSequence !== current.headSequence ||
        evidence.adjustmentBasis !== current.adjustmentBasis ||
        evidence.repositoryHeadRevision !==
            current.repositoryHeadRevision ||
        evidence.sourceRevision !== current.sourceRevision ||
        evidence.sourceId !== current.sourceId ||
        evidence.contractRevision !== current.contractRevision ||
        evidence.corporateActionRevision !==
            current.corporateActionRevision ||
        evidence.calendarSourceRevision !==
            current.calendarSourceRevision ||
        evidence.calendarVersion !== current.calendarVersion ||
        evidence.businessSessionSourceRevision !==
            current.businessSessionSourceRevision ||
        evidence.businessSessionSourceId !==
            current.businessSessionSourceId ||
        evidence.businessSessionState !== current.businessSessionState ||
        evidence.calendarSessionEvidenceHash !==
            current.calendarSessionEvidenceHash ||
        evidence.attestationRevision !== current.attestationRevision ||
        evidence.runtimeEpochId !== current.runtimeEpochId ||
        evidence.runtimeGeneration !== current.runtimeGeneration ||
        evidence.confirmationContextHash !==
            current.confirmationContextHash ||
        evidence.currentMonotonicNs < current.observedAtMonotonicNs ||
        (latestRuntimeMonotonicNs !== undefined &&
            evidence.currentMonotonicNs < latestRuntimeMonotonicNs)
    ) {
        return fail(
            'runtime_context_untrusted',
            'ATR runtime context must bind the verifier current head for its canonical contract scope',
        );
    }
    trustedAtrRuntimeContextEvidence.add(evidence);
    latestAtrRuntimeMonotonicByScope.set(
        scopeKey,
        evidence.currentMonotonicNs,
    );
    return evidence;
}

function decimalToScaled18(value: DecimalString): bigint {
    const [integer = '', fraction = ''] = value.split('.');
    return (
        BigInt(integer) * CALCULATION_FACTOR +
        BigInt(fraction.padEnd(CALCULATION_SCALE, '0'))
    );
}

function scaled18ToDecimal(value: bigint): DecimalString {
    if (value <= 0n) {
        return fail('invalid_candle', 'Wilder ATR must remain positive');
    }
    const integer = value / CALCULATION_FACTOR;
    const fractional = (value % CALCULATION_FACTOR)
        .toString()
        .padStart(CALCULATION_SCALE, '0')
        .replace(/0+$/, '');
    try {
        return decimalString(
            fractional.length === 0
                ? integer.toString()
                : `${integer}.${fractional}`,
        );
    } catch (error) {
        if (!(error instanceof SmartOrderMoneyError)) throw error;
        return fail('invalid_candle', 'Wilder ATR exceeds decimal domain bounds');
    }
}

function roundedDivideHalfUp(numerator: bigint, denominator: bigint): bigint {
    if (numerator < 0n || denominator <= 0n) {
        return fail('invalid_input', 'ATR integer division operands are invalid');
    }
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function absoluteDifference(left: bigint, right: bigint): bigint {
    return left >= right ? left - right : right - left;
}

function trueRange(
    candle: CompletedAtrCandle,
    previousClose: DecimalString,
): bigint {
    const high = decimalToScaled18(candle.high);
    const low = decimalToScaled18(candle.low);
    const previous = decimalToScaled18(previousClose);
    return [
        high - low,
        absoluteDifference(high, previous),
        absoluteDifference(low, previous),
    ].reduce(
        (maximum, candidate) =>
            candidate > maximum ? candidate : maximum,
        0n,
    );
}

function calculateWilderAtr(
    candles: readonly CompletedAtrCandle[],
    period: number,
): DecimalString {
    if (candles.length < period + 1) {
        return fail(
            'insufficient_completed_candles',
            `Wilder ATR(${period}) requires a prior-close anchor plus ${period} completed candles`,
        );
    }
    const ranges: bigint[] = [];
    for (let index = 1; index < candles.length; index += 1) {
        const previous = candles[index - 1];
        const current = candles[index];
        if (!previous || !current) {
            return fail('invalid_input', 'ATR candle window is incomplete');
        }
        ranges.push(trueRange(current, previous.close));
    }
    const denominator = BigInt(period);
    let atr = roundedDivideHalfUp(
        ranges.slice(0, period).reduce((sum, range) => sum + range, 0n),
        denominator,
    );
    for (const range of ranges.slice(period)) {
        atr = roundedDivideHalfUp(
            atr * BigInt(period - 1) + range,
            denominator,
        );
    }
    return scaled18ToDecimal(atr);
}

type FixedWilderAtrSnapshotPayload = Omit<
    FixedWilderAtrSnapshot,
    'snapshotHash'
>;

function canonicalSnapshotPayload(
    snapshot: FixedWilderAtrSnapshotPayload,
): string {
    return JSON.stringify({
        schemaVersion: snapshot.schemaVersion,
        attestationRevision: snapshot.attestationRevision,
        confirmationContextHash: snapshot.confirmationContextHash,
        contractKey: snapshot.contractKey,
        adjustmentBasis: snapshot.adjustmentBasis,
        timeframe: snapshot.timeframe,
        period: snapshot.period,
        algorithmVersion: snapshot.algorithmVersion,
        value: snapshot.value,
        asOfTradingDate: snapshot.asOfTradingDate,
        contractRevision: snapshot.contractRevision,
        corporateActionRevision: snapshot.corporateActionRevision,
        sourceEnvelope: JSON.parse(
            canonicalSourceEnvelopePayload(snapshot.sourceEnvelope),
        ) as unknown,
        seedOrigin: JSON.parse(
            canonicalSeedOriginPayload(snapshot.seedOrigin),
        ) as unknown,
        sourceIntegrity: {
            schemaVersion: snapshot.sourceIntegrity.schemaVersion,
            canonicalCandlesHash:
                snapshot.sourceIntegrity.canonicalCandlesHash,
            coverageStartTradingDate:
                snapshot.sourceIntegrity.coverageStartTradingDate,
            coverageEndTradingDate:
                snapshot.sourceIntegrity.coverageEndTradingDate,
            completedCandleCount:
                snapshot.sourceIntegrity.completedCandleCount,
            completeness: snapshot.sourceIntegrity.completeness,
        },
    });
}

async function freezeTrustedSnapshot(
    payload: FixedWilderAtrSnapshotPayload,
    expectedHash?: unknown,
): Promise<FixedWilderAtrSnapshot> {
    const actualHash = await sha256(canonicalSnapshotPayload(payload));
    if (expectedHash !== undefined && expectedHash !== actualHash) {
        return fail(
            'snapshot_integrity_mismatch',
            'fixed ATR snapshot hash does not match its canonical payload',
        );
    }
    const snapshot = Object.freeze({
        ...payload,
        snapshotHash: actualHash,
    });
    trustedFixedAtrSnapshots.add(snapshot);
    return snapshot;
}

export async function createFixedWilderAtrSnapshot(
    input: CreateFixedWilderAtrSnapshotInput,
): Promise<FixedWilderAtrSnapshot> {
    const record = exactRecord(input, 'ATR snapshot input', [
        'timeframe',
        'period',
        'candles',
        'contractRevision',
        'corporateActionRevision',
        'sourceEnvelope',
        'seedOrigin',
        'sourceIntegrity',
        'sourceAttestation',
    ]);
    if (
        !record.sourceAttestation ||
        typeof record.sourceAttestation !== 'object' ||
        !trustedAtrRepositoryAttestations.has(record.sourceAttestation)
    ) {
        return fail(
            'source_attestation_untrusted',
            'ATR source was not attested by the trusted repository boundary',
        );
    }
    const timeframe = validateTimeframe(record.timeframe);
    const period = validatePeriod(record.period);
    const sourceEnvelope = normalizeSourceEnvelope(record.sourceEnvelope);
    const seedOrigin = normalizeSeedOrigin(record.seedOrigin);
    const candles = normalizeCandleArray(record.candles);
    validateContinuity(candles);
    validateSeedOriginAgainstCandles(seedOrigin, candles, period);
    const last = candles.at(-1);
    if (!last || last.tradingDate !== sourceEnvelope.expectedAsOfTradingDate) {
        return fail(
            'calendar_session_mismatch',
            'completed candle coverage does not end at trusted expectedAsOfTradingDate',
        );
    }
    const contractRevision = canonicalToken(
        record.contractRevision,
        'contractRevision',
    );
    const corporateActionRevision = canonicalToken(
        record.corporateActionRevision,
        'corporateActionRevision',
    );
    const sourceIntegrity = normalizeSourceIntegrity(
        record.sourceIntegrity,
        candles,
    );
    const actualHash = await sha256(
        canonicalCandlePayload({
            timeframe,
            period,
            sourceEnvelope,
            seedOrigin,
            candles,
        }),
    );
    if (actualHash !== sourceIntegrity.canonicalCandlesHash) {
        return fail(
            'source_integrity_mismatch',
            'completed candle payload does not match its source integrity hash',
        );
    }
    const sourceAttestation =
        record.sourceAttestation as TrustedAtrRepositoryAttestation;
    if (
        !repositoryAttestationMatches(sourceAttestation, {
            timeframe,
            period,
            sourceEnvelope,
            seedOrigin,
            canonicalCandlesHash: actualHash,
            contractRevision,
            corporateActionRevision,
        })
    ) {
        return fail(
            'source_attestation_untrusted',
            'ATR repository attestation does not bind this exact source payload',
        );
    }
    const snapshotPayload = Object.freeze({
        schemaVersion: FIXED_WILDER_ATR_SNAPSHOT_SCHEMA_VERSION,
        attestationRevision: sourceAttestation.attestationRevision,
        confirmationContextHash: sourceEnvelope.confirmationContextHash,
        contractKey: sourceEnvelope.contractKey,
        adjustmentBasis: sourceEnvelope.adjustmentBasis,
        timeframe,
        period,
        algorithmVersion: WILDER_ATR_ALGORITHM_VERSION,
        value: calculateWilderAtr(candles, period),
        asOfTradingDate: last.tradingDate,
        contractRevision,
        corporateActionRevision,
        sourceEnvelope,
        seedOrigin,
        sourceIntegrity,
    });
    return freezeTrustedSnapshot(snapshotPayload);
}

function parsePersistedSnapshotPayload(
    value: unknown,
): Readonly<{
    payload: FixedWilderAtrSnapshotPayload;
    snapshotHash: `sha256:${string}`;
}> {
    const record = exactRecord(value, 'fixed ATR snapshot', [
        'schemaVersion',
        'attestationRevision',
        'confirmationContextHash',
        'contractKey',
        'adjustmentBasis',
        'timeframe',
        'period',
        'algorithmVersion',
        'value',
        'asOfTradingDate',
        'contractRevision',
        'corporateActionRevision',
        'sourceEnvelope',
        'seedOrigin',
        'sourceIntegrity',
        'snapshotHash',
    ]);
    if (
        record.schemaVersion !== FIXED_WILDER_ATR_SNAPSHOT_SCHEMA_VERSION ||
        record.algorithmVersion !== WILDER_ATR_ALGORITHM_VERSION
    ) {
        return fail(
            'snapshot_integrity_mismatch',
            'persisted fixed ATR snapshot schema or algorithm is unsupported',
        );
    }
    const contractKey = canonicalContractKeyValue(record.contractKey);
    const attestationRevision = canonicalToken(
        record.attestationRevision,
        'attestationRevision',
    );
    const confirmationContextHash = canonicalHash(
        record.confirmationContextHash,
        'confirmationContextHash',
    );
    const adjustmentBasis = normalizeAdjustmentBasis(record.adjustmentBasis);
    const timeframe = validateTimeframe(record.timeframe);
    const period = validatePeriod(record.period);
    const sourceEnvelope = normalizeSourceEnvelope(record.sourceEnvelope);
    const seedOrigin = normalizeSeedOrigin(record.seedOrigin);
    const sourceIntegrity = normalizeSourceIntegrity(record.sourceIntegrity);
    const asOfTradingDate = canonicalTradingDate(
        record.asOfTradingDate,
        'asOfTradingDate',
    );
    if (
        attestationRevision !== sourceEnvelope.attestationRevision ||
        confirmationContextHash !== sourceEnvelope.confirmationContextHash ||
        contractKey !== sourceEnvelope.contractKey ||
        adjustmentBasis !== sourceEnvelope.adjustmentBasis ||
        sourceEnvelope.expectedAsOfTradingDate !== asOfTradingDate ||
        sourceIntegrity.completedCandleCount < period + 1 ||
        sourceIntegrity.coverageStartTradingDate !==
            seedOrigin.anchorTradingDate ||
        sourceIntegrity.coverageEndTradingDate !== asOfTradingDate ||
        seedOrigin.seedEndTradingDate > asOfTradingDate
    ) {
        return fail(
            'snapshot_integrity_mismatch',
            'persisted fixed ATR snapshot metadata is internally inconsistent',
        );
    }
    return Object.freeze({
        payload: Object.freeze({
            schemaVersion: FIXED_WILDER_ATR_SNAPSHOT_SCHEMA_VERSION,
            attestationRevision,
            confirmationContextHash,
            contractKey,
            adjustmentBasis,
            timeframe,
            period,
            algorithmVersion: WILDER_ATR_ALGORITHM_VERSION,
            value: canonicalPrice(record.value, 'snapshot.value'),
            asOfTradingDate,
            contractRevision: canonicalToken(
                record.contractRevision,
                'contractRevision',
            ),
            corporateActionRevision: canonicalToken(
                record.corporateActionRevision,
                'corporateActionRevision',
            ),
            sourceEnvelope,
            seedOrigin,
            sourceIntegrity,
        }),
        snapshotHash: canonicalHash(record.snapshotHash, 'snapshotHash'),
    });
}

function payloadValidityAgainstEvidence(
    snapshot: FixedWilderAtrSnapshotPayload & {
        readonly snapshotHash: `sha256:${string}`;
    },
    evidence: TrustedAtrRevisionEvidence,
): FixedAtrSnapshotValidity {
    if (snapshot.snapshotHash !== evidence.expectedSnapshotHash) {
        return { valid: false, reason: 'snapshot_hash_changed' };
    }
    if (
        snapshot.attestationRevision !== evidence.attestationRevision ||
        snapshot.sourceEnvelope.attestationRevision !==
            evidence.attestationRevision
    ) {
        return { valid: false, reason: 'attestation_revision_changed' };
    }
    if (
        snapshot.confirmationContextHash !==
            evidence.confirmationContextHash ||
        snapshot.sourceEnvelope.confirmationContextHash !==
            evidence.confirmationContextHash
    ) {
        return { valid: false, reason: 'confirmation_context_changed' };
    }
    if (snapshot.contractKey !== evidence.sourceEnvelope.contractKey) {
        return { valid: false, reason: 'contract_key_changed' };
    }
    if (
        snapshot.adjustmentBasis !== evidence.sourceEnvelope.adjustmentBasis
    ) {
        return { valid: false, reason: 'adjustment_basis_changed' };
    }
    if (
        snapshot.sourceEnvelope.sourceId !== evidence.sourceEnvelope.sourceId ||
        snapshot.sourceEnvelope.sourceRevision !==
            evidence.sourceEnvelope.sourceRevision
    ) {
        return { valid: false, reason: 'source_revision_changed' };
    }
    if (
        snapshot.sourceEnvelope.repositoryRevision !==
        evidence.sourceEnvelope.repositoryRevision
    ) {
        return { valid: false, reason: 'repository_revision_changed' };
    }
    if (
        snapshot.sourceEnvelope.calendarVersion !==
            evidence.sourceEnvelope.calendarVersion ||
        snapshot.sourceEnvelope.calendarSourceRevision !==
            evidence.sourceEnvelope.calendarSourceRevision ||
        snapshot.sourceEnvelope.calendarSessionEvidenceHash !==
            evidence.sourceEnvelope.calendarSessionEvidenceHash
    ) {
        return { valid: false, reason: 'calendar_revision_changed' };
    }
    if (
        snapshot.sourceEnvelope.businessSessionState !==
            evidence.sourceEnvelope.businessSessionState ||
        snapshot.sourceEnvelope.businessSessionSourceId !==
            evidence.sourceEnvelope.businessSessionSourceId ||
        snapshot.sourceEnvelope.businessSessionSourceRevision !==
            evidence.sourceEnvelope.businessSessionSourceRevision
    ) {
        return {
            valid: false,
            reason: 'business_session_revision_changed',
        };
    }
    if (
        snapshot.asOfTradingDate !==
            evidence.sourceEnvelope.expectedAsOfTradingDate ||
        snapshot.sourceEnvelope.decisionTradingDate !==
            evidence.sourceEnvelope.decisionTradingDate
    ) {
        return { valid: false, reason: 'expected_as_of_changed' };
    }
    if (snapshot.contractRevision !== evidence.contractRevision) {
        return { valid: false, reason: 'contract_revision_changed' };
    }
    if (
        snapshot.corporateActionRevision !==
        evidence.corporateActionRevision
    ) {
        return {
            valid: false,
            reason: 'corporate_action_revision_changed',
        };
    }
    return { valid: true };
}

function revisionContextValidity(
    evidence: TrustedAtrRevisionEvidence,
    context: TrustedAtrRuntimeContextEvidence,
    purpose: AtrRevisionEvidencePurpose,
): FixedAtrSnapshotValidity {
    if (
        !evidence ||
        typeof evidence !== 'object' ||
        !trustedAtrRevisionEvidence.has(evidence) ||
        evidence.purpose !== purpose
    ) {
        return { valid: false, reason: 'revision_evidence_untrusted' };
    }
    if (
        !context ||
        typeof context !== 'object' ||
        !trustedAtrRuntimeContextEvidence.has(context) ||
        consumedAtrRuntimeContextEvidence.has(context)
    ) {
        return { valid: false, reason: 'runtime_context_untrusted' };
    }
    const currentHeadValidity = currentAtrHeadDriftReason(evidence);
    if (!currentHeadValidity.valid) return currentHeadValidity;
    if (
        context.contractKey !== evidence.sourceEnvelope.contractKey ||
        context.headSequence !== evidence.headSequence
    ) {
        return { valid: false, reason: 'runtime_context_untrusted' };
    }
    consumedAtrRuntimeContextEvidence.add(context);
    if (
        context.currentMonotonicNs < evidence.observedAtMonotonicNs ||
        context.currentMonotonicNs > evidence.validUntilMonotonicNs
    ) {
        return { valid: false, reason: 'revision_evidence_expired' };
    }
    if (
        context.repositoryHeadRevision !==
        evidence.repositoryHeadRevision
    ) {
        return { valid: false, reason: 'repository_revision_changed' };
    }
    if (
        context.adjustmentBasis !== evidence.sourceEnvelope.adjustmentBasis
    ) {
        return { valid: false, reason: 'adjustment_basis_changed' };
    }
    if (
        context.sourceId !== evidence.sourceEnvelope.sourceId ||
        context.sourceRevision !== evidence.sourceEnvelope.sourceRevision
    ) {
        return { valid: false, reason: 'source_revision_changed' };
    }
    if (context.contractRevision !== evidence.contractRevision) {
        return { valid: false, reason: 'contract_revision_changed' };
    }
    if (
        context.corporateActionRevision !==
        evidence.corporateActionRevision
    ) {
        return {
            valid: false,
            reason: 'corporate_action_revision_changed',
        };
    }
    if (
        context.calendarVersion !== evidence.sourceEnvelope.calendarVersion ||
        context.calendarSessionEvidenceHash !==
            evidence.sourceEnvelope.calendarSessionEvidenceHash ||
        context.calendarSourceRevision !==
        evidence.calendarSourceRevision
    ) {
        return { valid: false, reason: 'calendar_revision_changed' };
    }
    if (
        context.businessSessionSourceId !==
            evidence.sourceEnvelope.businessSessionSourceId ||
        context.businessSessionState !==
            evidence.sourceEnvelope.businessSessionState ||
        context.businessSessionSourceRevision !==
        evidence.businessSessionSourceRevision
    ) {
        return {
            valid: false,
            reason: 'business_session_revision_changed',
        };
    }
    if (context.attestationRevision !== evidence.attestationRevision) {
        return { valid: false, reason: 'attestation_revision_changed' };
    }
    if (context.runtimeEpochId !== evidence.runtimeEpochId) {
        return { valid: false, reason: 'runtime_epoch_changed' };
    }
    if (context.runtimeGeneration !== evidence.runtimeGeneration) {
        return { valid: false, reason: 'runtime_generation_changed' };
    }
    if (
        context.confirmationContextHash !==
        evidence.confirmationContextHash
    ) {
        return { valid: false, reason: 'confirmation_context_changed' };
    }
    return { valid: true };
}

/**
 * Restore accepts no K loader. The persisted payload's embedded hash and the
 * independently loaded immutable repository hash must both match before the
 * restored object obtains trusted identity.
 */
export async function restoreFixedWilderAtrSnapshot(
    value: unknown,
    evidence: TrustedAtrRevisionEvidence,
    context: TrustedAtrRuntimeContextEvidence,
): Promise<FixedWilderAtrSnapshot> {
    const contextValidity = revisionContextValidity(
        evidence,
        context,
        'restore',
    );
    if (!contextValidity.valid) {
        return fail(
            contextValidity.reason === 'revision_evidence_untrusted'
                ? 'revision_evidence_untrusted'
                : contextValidity.reason === 'runtime_context_untrusted'
                  ? 'runtime_context_untrusted'
                  : 'snapshot_invalidated',
            `fixed ATR snapshot cannot be restored: ${contextValidity.reason}`,
        );
    }
    const parsed = parsePersistedSnapshotPayload(value);
    if (
        parsed.snapshotHash !== evidence.expectedSnapshotHash ||
        parsed.snapshotHash !==
            (await sha256(canonicalSnapshotPayload(parsed.payload)))
    ) {
        return fail(
            'snapshot_integrity_mismatch',
            'persisted snapshot hash does not match payload and repository evidence',
        );
    }
    const validity = payloadValidityAgainstEvidence(
        { ...parsed.payload, snapshotHash: parsed.snapshotHash },
        evidence,
    );
    if (!validity.valid) {
        return fail(
            'snapshot_invalidated',
            `fixed ATR snapshot cannot be restored: ${validity.reason}`,
        );
    }
    return freezeTrustedSnapshot(parsed.payload, parsed.snapshotHash);
}

export function validateFixedWilderAtrSnapshot(
    snapshot: FixedWilderAtrSnapshot,
    evidence: TrustedAtrRevisionEvidence,
    context: TrustedAtrRuntimeContextEvidence,
): FixedAtrSnapshotValidity {
    if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        !trustedFixedAtrSnapshots.has(snapshot)
    ) {
        return { valid: false, reason: 'snapshot_untrusted' };
    }
    const contextValidity = revisionContextValidity(
        evidence,
        context,
        'reuse',
    );
    if (!contextValidity.valid) return contextValidity;
    return payloadValidityAgainstEvidence(snapshot, evidence);
}

/**
 * Restart and partial-fill paths can only retain an already-created immutable
 * snapshot. This API accepts neither candles nor a source loader, so it cannot
 * silently refresh ATR while an activation is live.
 */
export function retainFixedWilderAtrSnapshot(
    snapshot: FixedWilderAtrSnapshot,
    input: Readonly<{
        reason: FixedAtrReuseReason;
        evidence: TrustedAtrRevisionEvidence;
        context: TrustedAtrRuntimeContextEvidence;
    }>,
): FixedWilderAtrSnapshot {
    if (input?.reason !== 'runtime_restart' && input?.reason !== 'partial_fill') {
        return fail('invalid_input', 'ATR snapshot reuse reason is invalid');
    }
    const validity = validateFixedWilderAtrSnapshot(
        snapshot,
        input.evidence,
        input.context,
    );
    if (!validity.valid) {
        return fail(
            validity.reason === 'snapshot_untrusted'
                ? 'snapshot_untrusted'
                : validity.reason === 'revision_evidence_untrusted'
                  ? 'revision_evidence_untrusted'
                  : validity.reason === 'runtime_context_untrusted'
                    ? 'runtime_context_untrusted'
                  : 'snapshot_invalidated',
            `fixed ATR snapshot cannot be reused: ${validity.reason}`,
        );
    }
    return snapshot;
}

/**
 * Explicit unit-test support surface. A production library build defines the
 * compile-time test marker as false, making this value statically `undefined`
 * and removing issuer implementations and method names. This pure domain
 * module intentionally depends on neither Vite ImportMeta ambient types nor
 * Node ambient types.
 */
export const SMART_ORDER_ATR_TEST_ONLY =
    SMART_ORDER_DOMAIN_TEST_MODE
        ? Object.freeze({
              issueRepositoryAttestation,
              issueRevisionEvidence,
              issueRuntimeContextEvidence,
              resetAtrVerifier,
          })
        : undefined;
