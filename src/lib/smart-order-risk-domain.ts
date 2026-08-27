import { type Share, shareValue, shares } from './smart-order-domain-money';
import type { TaipeiTradeDate } from './smart-order-domain-calendar';
import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';

export const SMART_ORDER_RISK_DOMAIN_SCHEMA_VERSION =
    'smart-order-risk-domain/2026-08-11.3' as const;
export const SMART_ORDER_PNL_POLICY_SCHEMA_VERSION =
    'smart-order-pnl-policy/2026-08-11.3' as const;
export const SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION =
    'smart-order-gate-manifest/2026-08-11.3' as const;
export const SMART_ORDER_MAX_EXPOSURE_VALUE =
    9_223_372_036_854_775_807n as const;

export type BrokerWriteProvenance =
    | 'manual_user_confirmed'
    | 'automation'
    | 'gate_probe';
export type PnlComponent =
    | 'realized'
    | 'unrealized'
    | 'fee'
    | 'transaction_tax';

declare const identityGroupIdBrand: unique symbol;
declare const reservationIdBrand: unique symbol;
declare const exitClaimIdBrand: unique symbol;

export type IdentityGroupId = `hmac-sha256:${string}` & {
    readonly [identityGroupIdBrand]: 'IdentityGroupId';
};
export type EntryExposureReservationId = string & {
    readonly [reservationIdBrand]: 'EntryExposureReservationId';
};
export type ExitClaimId = string & {
    readonly [exitClaimIdBrand]: 'ExitClaimId';
};

export type SmartOrderRiskDomainErrorCode =
    | 'invalid_schema'
    | 'invalid_token'
    | 'invalid_digest'
    | 'invalid_epoch'
    | 'invalid_pnl_policy'
    | 'untrusted_pnl_evidence'
    | 'invalid_identity_key'
    | 'untrusted_identity_evidence'
    | 'invalid_gate_manifest'
    | 'untrusted_gate_manifest'
    | 'untrusted_dispatch_authority'
    | 'invalid_order_matrix'
    | 'invalid_exposure'
    | 'untrusted_exposure'
    | 'invalid_claim_projection'
    | 'invalid_protection_coverage';

export class SmartOrderRiskDomainError extends Error {
    readonly code: SmartOrderRiskDomainErrorCode;

    constructor(code: SmartOrderRiskDomainErrorCode, message: string) {
        super(message);
        this.name = 'SmartOrderRiskDomainError';
        this.code = code;
    }
}

function fail(code: SmartOrderRiskDomainErrorCode, message: string): never {
    throw new SmartOrderRiskDomainError(code, message);
}

function token(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 180 ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        return fail('invalid_token', `${label} must be a bounded token`);
    }
    return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
        return fail('invalid_digest', `${label} must be a SHA-256 digest`);
    }
    return value as `sha256:${string}`;
}

function epoch(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        return fail('invalid_epoch', `${label} must be a safe epoch value`);
    }
    return value;
}

function isSmartOrderDomainTestBuild(): boolean {
    return SMART_ORDER_DOMAIN_TEST_MODE;
}

function requireTestIssuer(): void {
    if (!isSmartOrderDomainTestBuild()) {
        return fail('invalid_schema', 'test-only evidence issuer is unavailable');
    }
}

export const SMART_ORDER_RISK_TIME_TTL_MS = 1_000 as const;

export interface VerifiedRiskEvaluationTime {
    readonly source: 'runtime_trusted_clock';
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly clockRevision: string;
    readonly nowEpochMs: number;
    readonly issuedAtMonotonicMs: number;
    readonly validUntilMonotonicMs: number;
}

const verifiedRiskEvaluationTimes = new WeakSet<object>();

function monotonicNowMs(): number {
    const value = globalThis.performance?.now();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return fail('invalid_epoch', 'monotonic clock is unavailable');
    }
    return value;
}

function issueRiskEvaluationTimeForTest(input: {
    runtimeEpochId: string;
    apiGeneration: string;
    clockRevision: string;
    nowEpochMs: number;
}): VerifiedRiskEvaluationTime {
    requireTestIssuer();
    const issuedAtMonotonicMs = monotonicNowMs();
    const evidence = Object.freeze({
        source: 'runtime_trusted_clock' as const,
        runtimeEpochId: token(input.runtimeEpochId, 'runtimeEpochId'),
        apiGeneration: token(input.apiGeneration, 'apiGeneration'),
        clockRevision: token(input.clockRevision, 'clockRevision'),
        nowEpochMs: epoch(input.nowEpochMs, 'nowEpochMs'),
        issuedAtMonotonicMs,
        validUntilMonotonicMs:
            issuedAtMonotonicMs + SMART_ORDER_RISK_TIME_TTL_MS,
    });
    verifiedRiskEvaluationTimes.add(evidence);
    return evidence;
}

function currentRiskTime(
    evidence: VerifiedRiskEvaluationTime,
): number | undefined {
    if (
        !verifiedRiskEvaluationTimes.has(evidence) ||
        evidence.source !== 'runtime_trusted_clock' ||
        monotonicNowMs() > evidence.validUntilMonotonicMs
    ) {
        return undefined;
    }
    return evidence.nowEpochMs;
}

function bytesToHex(value: ArrayBuffer): string {
    return Array.from(new Uint8Array(value), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
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

async function sha256(value: string): Promise<`sha256:${string}`> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return fail('invalid_digest', 'WebCrypto is unavailable');
    const result = await subtle.digest('SHA-256', new TextEncoder().encode(value));
    return `sha256:${bytesToHex(result)}`;
}

// ---------------------------------------------------------------------------
// Canonical PnL policy and verified reconciliation evidence
// ---------------------------------------------------------------------------

export interface PnlComponentSourceInput {
    readonly component: PnlComponent;
    readonly sourceId: string;
    readonly fieldPath: string;
    readonly coverage: 'current_trade_date_full_account_scoped';
}

export interface PnlPolicyInput {
    readonly schemaVersion: typeof SMART_ORDER_PNL_POLICY_SCHEMA_VERSION;
    readonly policyRevision: string;
    readonly tradeDateTimeZone: 'Asia/Taipei';
    readonly aggregation: readonly ['per_account', 'identity_group'];
    readonly freshnessTtlMs: 5_000;
    readonly decimalRounding: 'toward_zero_minor_unit';
    readonly resetGate:
        'official_calendar_business_session_all_accounts_reconciled';
    readonly valuationPriceSource: string;
    readonly componentSources: readonly PnlComponentSourceInput[];
}

export interface CanonicalPnlPolicy extends PnlPolicyInput {
    readonly componentSources: readonly Readonly<PnlComponentSourceInput>[];
}

export interface PnlPolicy extends CanonicalPnlPolicy {
    readonly policyDefinitionSha256: `sha256:${string}`;
}

export interface PnlTotals {
    readonly realizedMinorUnits: bigint;
    readonly unrealizedMinorUnits: bigint;
    readonly feeMinorUnits: bigint;
    readonly transactionTaxMinorUnits: bigint;
    readonly netMinorUnits: bigint;
}

export interface CanonicalPnlDeal {
    readonly dealId: string;
    readonly accountRef: string;
    readonly tradeDate: TaipeiTradeDate;
    readonly realizedMinorUnits: bigint;
    readonly feeMinorUnits: bigint;
    readonly transactionTaxMinorUnits: bigint;
}

export interface PnlReadinessEvidenceInput {
    readonly policyRevision: string;
    readonly policyDefinitionSha256: string;
    readonly tradeDate: TaipeiTradeDate;
    readonly identityGroupId: IdentityGroupId;
    readonly accountSetRevision: string;
    readonly dealLedgerRevision: string;
    readonly sourceIntegritySha256: string;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly asOfEpochMs: number;
    readonly runtimeStartedAtEpochMs: number;
    readonly fullDayAccountScopedCoverage: boolean;
    readonly includesPreRuntimeActivity: boolean;
    readonly includesExternalClientActivity: boolean;
    readonly completeComponents: readonly PnlComponent[];
    readonly allAccountsReconciled: boolean;
    readonly identityMappingReady: boolean;
    readonly totals: PnlTotals;
}

export interface VerifiedPnlReadinessEvidence
    extends PnlReadinessEvidenceInput {}

const verifiedPnlEvidence = new WeakSet<object>();
const verifiedPnlPolicies = new WeakSet<object>();

export type PnlReadinessReason =
    | 'policy_untrusted'
    | 'time_untrusted_or_stale'
    | 'untrusted_evidence'
    | 'stale'
    | 'future_as_of'
    | 'runtime_start_after_evidence'
    | 'trade_date_mismatch'
    | 'policy_revision_mismatch'
    | 'policy_definition_mismatch'
    | 'account_set_revision_mismatch'
    | 'identity_group_mismatch'
    | 'runtime_generation_mismatch'
    | 'full_day_coverage_missing'
    | 'pre_runtime_activity_missing'
    | 'external_activity_missing'
    | 'component_missing'
    | 'account_reconciliation_incomplete'
    | 'identity_mapping_unready';

export type PnlReadiness =
    | Readonly<{ ready: true; ageMs: number; totals: PnlTotals }>
    | Readonly<{
          ready: false;
          reason: PnlReadinessReason;
          missingComponents?: readonly PnlComponent[];
      }>;

const REQUIRED_PNL_COMPONENTS: readonly PnlComponent[] = [
    'realized',
    'unrealized',
    'fee',
    'transaction_tax',
];

function boundedSigned(value: unknown, label: string): bigint {
    if (
        typeof value !== 'bigint' ||
        value < -SMART_ORDER_MAX_EXPOSURE_VALUE ||
        value > SMART_ORDER_MAX_EXPOSURE_VALUE
    ) {
        return fail('invalid_exposure', `${label} is outside signed persistence bounds`);
    }
    return value;
}

function freezePnlTotals(input: PnlTotals): PnlTotals {
    const realizedMinorUnits = boundedSigned(
        input.realizedMinorUnits,
        'realizedMinorUnits',
    );
    const unrealizedMinorUnits = boundedSigned(
        input.unrealizedMinorUnits,
        'unrealizedMinorUnits',
    );
    const feeMinorUnits = boundedSigned(input.feeMinorUnits, 'feeMinorUnits');
    const transactionTaxMinorUnits = boundedSigned(
        input.transactionTaxMinorUnits,
        'transactionTaxMinorUnits',
    );
    if (feeMinorUnits < 0n || transactionTaxMinorUnits < 0n) {
        return fail('invalid_pnl_policy', 'fees and taxes must be non-negative');
    }
    const netMinorUnits = boundedSigned(
        realizedMinorUnits +
            unrealizedMinorUnits -
            feeMinorUnits -
            transactionTaxMinorUnits,
        'netMinorUnits',
    );
    if (netMinorUnits !== input.netMinorUnits) {
        return fail('invalid_pnl_policy', 'PnL net does not match signed components');
    }
    return Object.freeze({
        realizedMinorUnits,
        unrealizedMinorUnits,
        feeMinorUnits,
        transactionTaxMinorUnits,
        netMinorUnits,
    });
}

export function recalculatePnlTotals(input: {
    deals: readonly CanonicalPnlDeal[];
    unrealizedMinorUnits: bigint;
}): PnlTotals {
    const byId = new Map<string, Readonly<CanonicalPnlDeal>>();
    for (const candidate of input.deals) {
        const deal = Object.freeze({
            dealId: token(candidate.dealId, 'dealId'),
            accountRef: token(candidate.accountRef, 'deal.accountRef'),
            tradeDate: candidate.tradeDate,
            realizedMinorUnits: boundedSigned(
                candidate.realizedMinorUnits,
                'deal.realizedMinorUnits',
            ),
            feeMinorUnits: boundedSigned(candidate.feeMinorUnits, 'deal.feeMinorUnits'),
            transactionTaxMinorUnits: boundedSigned(
                candidate.transactionTaxMinorUnits,
                'deal.transactionTaxMinorUnits',
            ),
        });
        if (deal.feeMinorUnits < 0n || deal.transactionTaxMinorUnits < 0n) {
            return fail('invalid_pnl_policy', 'deal fees and taxes must be non-negative');
        }
        const previous = byId.get(deal.dealId);
        if (previous) {
            if (
                previous.accountRef !== deal.accountRef ||
                previous.tradeDate !== deal.tradeDate ||
                previous.realizedMinorUnits !== deal.realizedMinorUnits ||
                previous.feeMinorUnits !== deal.feeMinorUnits ||
                previous.transactionTaxMinorUnits !== deal.transactionTaxMinorUnits
            ) {
                return fail('invalid_pnl_policy', 'duplicate deal ID has conflicting evidence');
            }
            continue;
        }
        byId.set(deal.dealId, deal);
    }
    let realizedMinorUnits = 0n;
    let feeMinorUnits = 0n;
    let transactionTaxMinorUnits = 0n;
    for (const deal of [...byId.values()].sort((left, right) =>
        left.dealId.localeCompare(right.dealId),
    )) {
        realizedMinorUnits = boundedSigned(
            realizedMinorUnits + deal.realizedMinorUnits,
            'realizedMinorUnits',
        );
        feeMinorUnits = boundedSigned(
            feeMinorUnits + deal.feeMinorUnits,
            'feeMinorUnits',
        );
        transactionTaxMinorUnits = boundedSigned(
            transactionTaxMinorUnits + deal.transactionTaxMinorUnits,
            'transactionTaxMinorUnits',
        );
    }
    const unrealizedMinorUnits = boundedSigned(
        input.unrealizedMinorUnits,
        'unrealizedMinorUnits',
    );
    return freezePnlTotals({
        realizedMinorUnits,
        unrealizedMinorUnits,
        feeMinorUnits,
        transactionTaxMinorUnits,
        netMinorUnits:
            realizedMinorUnits +
            unrealizedMinorUnits -
            feeMinorUnits -
            transactionTaxMinorUnits,
    });
}

export function createPnlPolicy(input: PnlPolicyInput): CanonicalPnlPolicy {
    if (input.schemaVersion !== SMART_ORDER_PNL_POLICY_SCHEMA_VERSION) {
        return fail('invalid_schema', 'PnL policy schema is unsupported');
    }
    token(input.policyRevision, 'policyRevision');
    token(input.valuationPriceSource, 'valuationPriceSource');
    if (
        input.tradeDateTimeZone !== 'Asia/Taipei' ||
        input.freshnessTtlMs !== 5_000 ||
        input.decimalRounding !== 'toward_zero_minor_unit' ||
        input.resetGate !==
            'official_calendar_business_session_all_accounts_reconciled' ||
        input.aggregation.length !== 2 ||
        input.aggregation[0] !== 'per_account' ||
        input.aggregation[1] !== 'identity_group'
    ) {
        return fail('invalid_pnl_policy', 'PnL policy safety constants differ');
    }
    const seen = new Set<PnlComponent>();
    const componentSources = input.componentSources.map((source) => {
        if (!REQUIRED_PNL_COMPONENTS.includes(source.component) || seen.has(source.component)) {
            return fail('invalid_pnl_policy', 'PnL components must be complete and unique');
        }
        seen.add(source.component);
        if (source.coverage !== 'current_trade_date_full_account_scoped') {
            return fail('invalid_pnl_policy', 'PnL coverage is insufficient');
        }
        return Object.freeze({
            component: source.component,
            sourceId: token(source.sourceId, 'component.sourceId'),
            fieldPath: token(source.fieldPath, 'component.fieldPath'),
            coverage: source.coverage,
        });
    });
    if (REQUIRED_PNL_COMPONENTS.some((component) => !seen.has(component))) {
        return fail('invalid_pnl_policy', 'required PnL component is missing');
    }
    return Object.freeze({ ...input, componentSources: Object.freeze(componentSources) });
}

async function issueVerifiedPnlPolicyForTest(
    input: PnlPolicyInput,
): Promise<PnlPolicy> {
    requireTestIssuer();
    const canonical = createPnlPolicy(input);
    const policy = Object.freeze({
        ...canonical,
        policyDefinitionSha256: await sha256(stableJson(canonical)),
    });
    verifiedPnlPolicies.add(policy);
    return policy;
}

function issueVerifiedPnlEvidenceForTest(
    input: PnlReadinessEvidenceInput,
): VerifiedPnlReadinessEvidence {
    requireTestIssuer();
    const evidence = Object.freeze({
        ...input,
        policyRevision: token(input.policyRevision, 'pnl.policyRevision'),
        policyDefinitionSha256: digest(
            input.policyDefinitionSha256,
            'pnl.policyDefinitionSha256',
        ),
        accountSetRevision: token(input.accountSetRevision, 'pnl.accountSetRevision'),
        dealLedgerRevision: token(input.dealLedgerRevision, 'pnl.dealLedgerRevision'),
        sourceIntegritySha256: digest(input.sourceIntegritySha256, 'pnl.sourceIntegrity'),
        runtimeEpochId: token(input.runtimeEpochId, 'pnl.runtimeEpochId'),
        apiGeneration: token(input.apiGeneration, 'pnl.apiGeneration'),
        asOfEpochMs: epoch(input.asOfEpochMs, 'pnl.asOfEpochMs'),
        runtimeStartedAtEpochMs: epoch(
            input.runtimeStartedAtEpochMs,
            'pnl.runtimeStartedAtEpochMs',
        ),
        completeComponents: Object.freeze([...input.completeComponents]),
        totals: freezePnlTotals(input.totals),
    });
    verifiedPnlEvidence.add(evidence);
    return evidence;
}

export function evaluatePnlReadiness(input: {
    policy: PnlPolicy;
    evidence: VerifiedPnlReadinessEvidence;
    currentTradeDate: TaipeiTradeDate;
    expectedAccountSetRevision: string;
    expectedIdentityGroupId: IdentityGroupId;
    time: VerifiedRiskEvaluationTime;
}): PnlReadiness {
    if (!verifiedPnlPolicies.has(input.policy)) {
        return Object.freeze({ ready: false, reason: 'policy_untrusted' });
    }
    const now = currentRiskTime(input.time);
    if (now === undefined) {
        return Object.freeze({ ready: false, reason: 'time_untrusted_or_stale' });
    }
    if (!verifiedPnlEvidence.has(input.evidence)) {
        return Object.freeze({ ready: false, reason: 'untrusted_evidence' });
    }
    if (input.evidence.asOfEpochMs > now) {
        return Object.freeze({ ready: false, reason: 'future_as_of' });
    }
    const ageMs = now - input.evidence.asOfEpochMs;
    if (ageMs > input.policy.freshnessTtlMs) {
        return Object.freeze({ ready: false, reason: 'stale' });
    }
    if (input.evidence.runtimeStartedAtEpochMs > input.evidence.asOfEpochMs) {
        return Object.freeze({
            ready: false,
            reason: 'runtime_start_after_evidence',
        });
    }
    if (input.evidence.tradeDate !== input.currentTradeDate) {
        return Object.freeze({ ready: false, reason: 'trade_date_mismatch' });
    }
    if (input.evidence.policyRevision !== input.policy.policyRevision) {
        return Object.freeze({ ready: false, reason: 'policy_revision_mismatch' });
    }
    if (
        input.evidence.policyDefinitionSha256 !==
        input.policy.policyDefinitionSha256
    ) {
        return Object.freeze({ ready: false, reason: 'policy_definition_mismatch' });
    }
    if (input.evidence.accountSetRevision !== token(input.expectedAccountSetRevision, 'expectedAccountSetRevision')) {
        return Object.freeze({ ready: false, reason: 'account_set_revision_mismatch' });
    }
    if (input.evidence.identityGroupId !== input.expectedIdentityGroupId) {
        return Object.freeze({ ready: false, reason: 'identity_group_mismatch' });
    }
    if (
        input.evidence.runtimeEpochId !== input.time.runtimeEpochId ||
        input.evidence.apiGeneration !== input.time.apiGeneration
    ) {
        return Object.freeze({ ready: false, reason: 'runtime_generation_mismatch' });
    }
    if (!input.evidence.fullDayAccountScopedCoverage) {
        return Object.freeze({ ready: false, reason: 'full_day_coverage_missing' });
    }
    if (!input.evidence.includesPreRuntimeActivity) {
        return Object.freeze({ ready: false, reason: 'pre_runtime_activity_missing' });
    }
    if (!input.evidence.includesExternalClientActivity) {
        return Object.freeze({ ready: false, reason: 'external_activity_missing' });
    }
    const complete = new Set(input.evidence.completeComponents);
    const missing = REQUIRED_PNL_COMPONENTS.filter((item) => !complete.has(item));
    if (
        missing.length > 0 ||
        complete.size !== REQUIRED_PNL_COMPONENTS.length ||
        input.evidence.completeComponents.length !==
            REQUIRED_PNL_COMPONENTS.length
    ) {
        return Object.freeze({
            ready: false,
            reason: 'component_missing',
            missingComponents: Object.freeze(missing),
        });
    }
    if (!input.evidence.allAccountsReconciled) {
        return Object.freeze({ ready: false, reason: 'account_reconciliation_incomplete' });
    }
    if (!input.evidence.identityMappingReady) {
        return Object.freeze({ ready: false, reason: 'identity_mapping_unready' });
    }
    return Object.freeze({ ready: true, ageMs, totals: input.evidence.totals });
}

// ---------------------------------------------------------------------------
// Authenticated identity grouping
// ---------------------------------------------------------------------------

export interface VerifiedCanonicalPrincipalEvidence {
    readonly mappingRevision: string;
    readonly authorityRevision: string;
    readonly accountSetSha256: `sha256:${string}`;
    readonly evidenceSha256: `sha256:${string}`;
    readonly conflictState: 'clear' | 'conflict';
}

export interface IdentityKeyHandle {
    readonly keyRevision: string;
    readonly keyFingerprintSha256: `sha256:${string}`;
}

const verifiedPrincipalEvidence = new WeakSet<object>();
const canonicalPrincipalByEvidence = new WeakMap<object, string>();
const verifiedIdentityKeyHandles = new WeakSet<object>();
const identityCryptoKeyByHandle = new WeakMap<object, CryptoKey>();
const latestPrincipalEvidenceByAccountSet = new Map<string, object>();
let latestIdentityKeyHandle: object | undefined;

async function issueVerifiedCanonicalPrincipalForTest(input: {
    canonicalPrincipal: string;
    mappingRevision: string;
    authorityRevision: string;
    accountSetSha256: string;
    conflictState?: 'clear' | 'conflict';
}): Promise<VerifiedCanonicalPrincipalEvidence> {
    requireTestIssuer();
    const canonicalPrincipal = token(input.canonicalPrincipal, 'canonicalPrincipal');
    const publicFields = {
        mappingRevision: token(input.mappingRevision, 'mappingRevision'),
        authorityRevision: token(input.authorityRevision, 'authorityRevision'),
        accountSetSha256: digest(input.accountSetSha256, 'accountSetSha256'),
        conflictState: input.conflictState ?? 'clear',
    } as const;
    const evidence = Object.freeze({
        ...publicFields,
        evidenceSha256: await sha256(
            stableJson({ ...publicFields, canonicalPrincipal }),
        ),
    });
    verifiedPrincipalEvidence.add(evidence);
    canonicalPrincipalByEvidence.set(evidence, canonicalPrincipal);
    latestPrincipalEvidenceByAccountSet.set(evidence.accountSetSha256, evidence);
    return evidence;
}

async function issueIdentityKeyHandleForTest(input: {
    identityKey: Uint8Array;
    keyRevision: string;
}): Promise<IdentityKeyHandle> {
    requireTestIssuer();
    if (!(input.identityKey instanceof Uint8Array) || input.identityKey.byteLength < 32 || input.identityKey.byteLength > 128) {
        return fail('invalid_identity_key', 'identity key must contain 32 to 128 bytes');
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return fail('invalid_identity_key', 'WebCrypto is unavailable');
    const keyBytes = Uint8Array.from(input.identityKey);
    const cryptoKey = await subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const handle = Object.freeze({
        keyRevision: token(input.keyRevision, 'keyRevision'),
        keyFingerprintSha256: await sha256(
            `identity-key-test-fingerprint\n${bytesToHex(keyBytes.buffer)}`,
        ),
    });
    keyBytes.fill(0);
    verifiedIdentityKeyHandles.add(handle);
    identityCryptoKeyByHandle.set(handle, cryptoKey);
    latestIdentityKeyHandle = handle;
    return handle;
}

export async function deriveIdentityGroupId(input: {
    principalEvidence: VerifiedCanonicalPrincipalEvidence;
    identityKeyHandle: IdentityKeyHandle;
}): Promise<IdentityGroupId> {
    if (
        !verifiedPrincipalEvidence.has(input.principalEvidence) ||
        !verifiedIdentityKeyHandles.has(input.identityKeyHandle) ||
        latestPrincipalEvidenceByAccountSet.get(
            input.principalEvidence.accountSetSha256,
        ) !== input.principalEvidence ||
        latestIdentityKeyHandle !== input.identityKeyHandle
    ) {
        return fail('untrusted_identity_evidence', 'identity evidence is not verifier-issued');
    }
    if (input.principalEvidence.conflictState !== 'clear') {
        return fail('untrusted_identity_evidence', 'identity mapping is conflicted');
    }
    const principal = canonicalPrincipalByEvidence.get(input.principalEvidence);
    const key = identityCryptoKeyByHandle.get(input.identityKeyHandle);
    if (!principal || !key) {
        return fail('invalid_identity_key', 'identity evidence key material is unavailable');
    }
    const signature = await globalThis.crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(principal),
    );
    return `hmac-sha256:${bytesToHex(signature)}` as IdentityGroupId;
}

// ---------------------------------------------------------------------------
// Static verified gate manifest plus current, server-derived authority
// ---------------------------------------------------------------------------

interface GateFingerprintSet {
    readonly buildSha256: `sha256:${string}`;
    readonly adapterSha256: `sha256:${string}`;
    readonly shioajiCapabilitySha256: `sha256:${string}`;
    readonly platformSha256: `sha256:${string}`;
    readonly routeCoverageSha256: `sha256:${string}`;
    readonly pnlPolicyRevision: string;
    readonly pnlPolicyDefinitionSha256: `sha256:${string}`;
    readonly orderClassMatrixRevision: string;
    readonly orderClassMatrixSha256: `sha256:${string}`;
}

export type BrokerWriteOperationKind = 'place' | 'update' | 'cancel';

export interface BrokerWriteScopeInput {
    readonly intentId: string;
    readonly accountBrokerRef: string;
    readonly accountIdRef: string;
    readonly routeId: string;
    readonly operationKind: BrokerWriteOperationKind;
    readonly requestPayloadSha256: string;
    readonly strategyId?: string;
    readonly activationId?: string;
    readonly manualRequestId?: string;
}

export interface BrokerWriteScope {
    readonly intentId: string;
    readonly accountBrokerRef: string;
    readonly accountIdRef: string;
    readonly routeId: string;
    readonly operationKind: BrokerWriteOperationKind;
    readonly requestPayloadSha256: `sha256:${string}`;
    readonly strategyId?: string;
    readonly activationId?: string;
    readonly manualRequestId?: string;
}

export interface GateManifestInput extends GateFingerprintSet {
    readonly schemaVersion: typeof SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION;
    readonly provenance: BrokerWriteProvenance;
    readonly manifestRevision: string;
    readonly productBoundaryConsentVersion: string;
    readonly validUntilEpochMs: number;
    readonly requiredEvidenceSha256: readonly string[];
}

export interface VerifiedGateManifest extends GateManifestInput {
    readonly manifestSha256: `sha256:${string}`;
}

export type CurrentDispatchAuthorityInput =
    | (GateFingerprintSet & {
          readonly provenance: 'automation';
          readonly readinessRevision: string;
          readonly currentReadiness: boolean;
          readonly gate1Passed: boolean;
          readonly featureGatePassed: boolean;
          readonly userWriteMasterArmed: boolean;
          readonly strategyArmed: boolean;
          readonly writeScope: BrokerWriteScopeInput;
      })
    | (GateFingerprintSet & {
          readonly provenance: 'manual_user_confirmed';
          readonly readinessRevision: string;
          readonly currentReadiness: boolean;
          readonly routeCoveragePassed: boolean;
          readonly confirmationId: string;
          readonly confirmationRevision: number;
          readonly confirmationState: 'available' | 'consumed' | 'expired';
          readonly writeScope: BrokerWriteScopeInput;
      })
    | (GateFingerprintSet & {
          readonly provenance: 'gate_probe';
          readonly readinessRevision: string;
          readonly currentReadiness: boolean;
          readonly probeManifestPassed: boolean;
          readonly runLineageId: string;
          readonly operationNonce: string;
          readonly nonceRevision: number;
          readonly nonceState: 'available' | 'consumed' | 'expired';
          readonly userOperationAuthorizationValid: boolean;
          readonly writeScope: BrokerWriteScopeInput;
      });

interface DispatchAuthorityTimeBinding {
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly clockRevision: string;
    readonly issuedAtEpochMs: number;
    readonly validUntilEpochMs: number;
}

export type CurrentDispatchAuthority = CurrentDispatchAuthorityInput &
    DispatchAuthorityTimeBinding & { readonly writeScope: BrokerWriteScope };
const verifiedGateManifests = new WeakSet<object>();
const currentDispatchAuthorities = new WeakSet<object>();

function canonicalFingerprints(input: GateFingerprintSet): GateFingerprintSet {
    return Object.freeze({
        buildSha256: digest(input.buildSha256, 'buildSha256'),
        adapterSha256: digest(input.adapterSha256, 'adapterSha256'),
        shioajiCapabilitySha256: digest(
            input.shioajiCapabilitySha256,
            'shioajiCapabilitySha256',
        ),
        platformSha256: digest(input.platformSha256, 'platformSha256'),
        routeCoverageSha256: digest(input.routeCoverageSha256, 'routeCoverageSha256'),
        pnlPolicyRevision: token(input.pnlPolicyRevision, 'pnlPolicyRevision'),
        pnlPolicyDefinitionSha256: digest(
            input.pnlPolicyDefinitionSha256,
            'pnlPolicyDefinitionSha256',
        ),
        orderClassMatrixRevision: token(
            input.orderClassMatrixRevision,
            'orderClassMatrixRevision',
        ),
        orderClassMatrixSha256: digest(
            input.orderClassMatrixSha256,
            'orderClassMatrixSha256',
        ),
    });
}

function canonicalWriteScope(
    input: BrokerWriteScopeInput,
    provenance: BrokerWriteProvenance,
): BrokerWriteScope {
    if (!['place', 'update', 'cancel'].includes(input.operationKind)) {
        return fail('untrusted_dispatch_authority', 'write operation is unknown');
    }
    const common = {
        intentId: token(input.intentId, 'writeScope.intentId'),
        accountBrokerRef: token(
            input.accountBrokerRef,
            'writeScope.accountBrokerRef',
        ),
        accountIdRef: token(input.accountIdRef, 'writeScope.accountIdRef'),
        routeId: token(input.routeId, 'writeScope.routeId'),
        operationKind: input.operationKind,
        requestPayloadSha256: digest(
            input.requestPayloadSha256,
            'writeScope.requestPayloadSha256',
        ),
    };
    if (provenance === 'automation') {
        return Object.freeze({
            ...common,
            strategyId: token(input.strategyId, 'writeScope.strategyId'),
            activationId: token(input.activationId, 'writeScope.activationId'),
        });
    }
    if (provenance === 'manual_user_confirmed') {
        return Object.freeze({
            ...common,
            manualRequestId: token(
                input.manualRequestId,
                'writeScope.manualRequestId',
            ),
        });
    }
    return Object.freeze(common);
}

function writeScopesMatch(left: BrokerWriteScope, right: BrokerWriteScope): boolean {
    return (
        left.intentId === right.intentId &&
        left.accountBrokerRef === right.accountBrokerRef &&
        left.accountIdRef === right.accountIdRef &&
        left.routeId === right.routeId &&
        left.operationKind === right.operationKind &&
        left.requestPayloadSha256 === right.requestPayloadSha256 &&
        left.strategyId === right.strategyId &&
        left.activationId === right.activationId &&
        left.manualRequestId === right.manualRequestId
    );
}

async function issueVerifiedGateManifestForTest(
    input: GateManifestInput,
): Promise<VerifiedGateManifest> {
    requireTestIssuer();
    if (
        input.schemaVersion !== SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION ||
        !['automation', 'manual_user_confirmed', 'gate_probe'].includes(input.provenance)
    ) {
        return fail('invalid_gate_manifest', 'gate manifest type is unsupported');
    }
    const fingerprints = canonicalFingerprints(input);
    const canonical = {
        ...fingerprints,
        schemaVersion: input.schemaVersion,
        provenance: input.provenance,
        manifestRevision: token(input.manifestRevision, 'manifestRevision'),
        productBoundaryConsentVersion: token(
            input.productBoundaryConsentVersion,
            'productBoundaryConsentVersion',
        ),
        validUntilEpochMs: epoch(input.validUntilEpochMs, 'validUntilEpochMs'),
        requiredEvidenceSha256: Object.freeze(
            [...input.requiredEvidenceSha256].map((item, index) =>
                digest(item, `requiredEvidenceSha256[${index}]`),
            ),
        ),
    };
    if (canonical.requiredEvidenceSha256.length === 0) {
        return fail('invalid_gate_manifest', 'required gate evidence is empty');
    }
    const manifest = Object.freeze({
        ...canonical,
        manifestSha256: await sha256(stableJson(canonical)),
    });
    verifiedGateManifests.add(manifest);
    return manifest;
}

function issueCurrentDispatchAuthorityForTest(
    input: CurrentDispatchAuthorityInput,
    time: VerifiedRiskEvaluationTime,
): CurrentDispatchAuthority {
    requireTestIssuer();
    const now = currentRiskTime(time);
    if (now === undefined) {
        return fail(
            'untrusted_dispatch_authority',
            'dispatch authority time is untrusted or stale',
        );
    }
    if (!['automation', 'manual_user_confirmed', 'gate_probe'].includes(input.provenance)) {
        return fail('untrusted_dispatch_authority', 'unknown provenance');
    }
    const common = {
        ...canonicalFingerprints(input),
        provenance: input.provenance,
        readinessRevision: token(input.readinessRevision, 'readinessRevision'),
        currentReadiness: input.currentReadiness,
        runtimeEpochId: time.runtimeEpochId,
        apiGeneration: time.apiGeneration,
        clockRevision: time.clockRevision,
        issuedAtEpochMs: now,
        validUntilEpochMs: now + SMART_ORDER_RISK_TIME_TTL_MS,
        writeScope: canonicalWriteScope(input.writeScope, input.provenance),
    };
    let authority: CurrentDispatchAuthority;
    if (input.provenance === 'automation') {
        authority = Object.freeze({
            ...common,
            provenance: 'automation',
            gate1Passed: input.gate1Passed,
            featureGatePassed: input.featureGatePassed,
            userWriteMasterArmed: input.userWriteMasterArmed,
            strategyArmed: input.strategyArmed,
        });
    } else if (input.provenance === 'manual_user_confirmed') {
        authority = Object.freeze({
            ...common,
            provenance: 'manual_user_confirmed',
            routeCoveragePassed: input.routeCoveragePassed,
            confirmationId: token(input.confirmationId, 'confirmationId'),
            confirmationRevision: epoch(input.confirmationRevision, 'confirmationRevision'),
            confirmationState: input.confirmationState,
        });
    } else {
        authority = Object.freeze({
            ...common,
            provenance: 'gate_probe',
            probeManifestPassed: input.probeManifestPassed,
            runLineageId: token(input.runLineageId, 'runLineageId'),
            operationNonce: token(input.operationNonce, 'operationNonce'),
            nonceRevision: epoch(input.nonceRevision, 'nonceRevision'),
            nonceState: input.nonceState,
            userOperationAuthorizationValid:
                input.userOperationAuthorizationValid,
        });
    }
    currentDispatchAuthorities.add(authority);
    return authority;
}

export type GateManifestBlockReason =
    | 'manifest_untrusted'
    | 'authority_untrusted'
    | 'time_untrusted_or_stale'
    | 'authority_stale_or_generation_mismatch'
    | 'write_scope_mismatch'
    | 'manifest_expired'
    | 'provenance_mismatch'
    | 'fingerprint_mismatch'
    | 'readiness_false'
    | 'gate1_missing'
    | 'feature_gate_missing'
    | 'write_master_disarmed'
    | 'strategy_disarmed'
    | 'manual_route_uncovered'
    | 'manual_confirmation_unavailable'
    | 'probe_manifest_missing'
    | 'probe_nonce_unavailable'
    | 'probe_authorization_invalid';

export type GateManifestDecision =
    | Readonly<{
          allowed: true;
          provenance: BrokerWriteProvenance;
        readinessRevision: string;
          writeScope: BrokerWriteScope;
          atomicConsume?: Readonly<{
              kind: 'manual_confirmation' | 'probe_nonce';
              id: string;
              revision: number;
          }>;
      }>
    | Readonly<{
          allowed: false;
          provenance: BrokerWriteProvenance | 'unknown';
          reasons: readonly GateManifestBlockReason[];
      }>;

function fingerprintsMatch(
    manifest: GateFingerprintSet,
    current: GateFingerprintSet,
): boolean {
    return (
        manifest.buildSha256 === current.buildSha256 &&
        manifest.adapterSha256 === current.adapterSha256 &&
        manifest.shioajiCapabilitySha256 === current.shioajiCapabilitySha256 &&
        manifest.platformSha256 === current.platformSha256 &&
        manifest.routeCoverageSha256 === current.routeCoverageSha256 &&
        manifest.pnlPolicyRevision === current.pnlPolicyRevision &&
        manifest.pnlPolicyDefinitionSha256 ===
            current.pnlPolicyDefinitionSha256 &&
        manifest.orderClassMatrixRevision ===
            current.orderClassMatrixRevision &&
        manifest.orderClassMatrixSha256 === current.orderClassMatrixSha256
    );
}

export function evaluateGateManifest(input: {
    manifest: VerifiedGateManifest;
    authority: CurrentDispatchAuthority;
    time: VerifiedRiskEvaluationTime;
    expectedWriteScope: BrokerWriteScopeInput;
}): GateManifestDecision {
    const reasons: GateManifestBlockReason[] = [];
    const provenance = verifiedGateManifests.has(input.manifest)
        ? input.manifest.provenance
        : 'unknown';
    if (!verifiedGateManifests.has(input.manifest)) reasons.push('manifest_untrusted');
    if (!currentDispatchAuthorities.has(input.authority)) reasons.push('authority_untrusted');
    const now = currentRiskTime(input.time);
    if (now === undefined) reasons.push('time_untrusted_or_stale');
    if (provenance === 'unknown') {
        return Object.freeze({ allowed: false, provenance, reasons: Object.freeze(reasons) });
    }
    if (now !== undefined && now >= input.manifest.validUntilEpochMs) {
        reasons.push('manifest_expired');
    }
    if (
        now === undefined ||
        input.authority.runtimeEpochId !== input.time.runtimeEpochId ||
        input.authority.apiGeneration !== input.time.apiGeneration ||
        input.authority.clockRevision !== input.time.clockRevision ||
        now < input.authority.issuedAtEpochMs ||
        now > input.authority.validUntilEpochMs
    ) {
        reasons.push('authority_stale_or_generation_mismatch');
    }
    if (input.manifest.provenance !== input.authority.provenance) {
        reasons.push('provenance_mismatch');
    }
    if (!fingerprintsMatch(input.manifest, input.authority)) {
        reasons.push('fingerprint_mismatch');
    }
    const expectedWriteScope = canonicalWriteScope(
        input.expectedWriteScope,
        input.manifest.provenance,
    );
    if (!writeScopesMatch(input.authority.writeScope, expectedWriteScope)) {
        reasons.push('write_scope_mismatch');
    }
    if (!input.authority.currentReadiness) reasons.push('readiness_false');
    let atomicConsume:
        | { kind: 'manual_confirmation' | 'probe_nonce'; id: string; revision: number }
        | undefined;
    if (input.authority.provenance === 'automation') {
        if (!input.authority.gate1Passed) reasons.push('gate1_missing');
        if (!input.authority.featureGatePassed) reasons.push('feature_gate_missing');
        if (!input.authority.userWriteMasterArmed) reasons.push('write_master_disarmed');
        if (!input.authority.strategyArmed) reasons.push('strategy_disarmed');
    } else if (input.authority.provenance === 'manual_user_confirmed') {
        if (!input.authority.routeCoveragePassed) reasons.push('manual_route_uncovered');
        if (input.authority.confirmationState !== 'available') {
            reasons.push('manual_confirmation_unavailable');
        } else {
            atomicConsume = {
                kind: 'manual_confirmation',
                id: input.authority.confirmationId,
                revision: input.authority.confirmationRevision,
            };
        }
    } else if (input.authority.provenance === 'gate_probe') {
        if (!input.authority.probeManifestPassed) reasons.push('probe_manifest_missing');
        if (input.authority.nonceState !== 'available') {
            reasons.push('probe_nonce_unavailable');
        } else {
            atomicConsume = {
                kind: 'probe_nonce',
                id: input.authority.operationNonce,
                revision: input.authority.nonceRevision,
            };
        }
        if (!input.authority.userOperationAuthorizationValid) {
            reasons.push('probe_authorization_invalid');
        }
    } else {
        return fail('untrusted_dispatch_authority', 'unknown provenance');
    }
    return reasons.length === 0
        ? Object.freeze({
              allowed: true,
              provenance: input.manifest.provenance,
              readinessRevision: input.authority.readinessRevision,
              writeScope: input.authority.writeScope,
              ...(atomicConsume ? { atomicConsume: Object.freeze(atomicConsume) } : {}),
          })
        : Object.freeze({
              allowed: false,
              provenance: input.manifest.provenance,
              reasons: Object.freeze(reasons),
          });
}

// ---------------------------------------------------------------------------
// Manual/automation order-class matrix
// ---------------------------------------------------------------------------

export type OrderCond = 'Cash' | 'MarginTrading' | 'ShortSelling' | 'Netting';
export type OrderLot = 'Common' | 'IntradayOdd' | 'Odd' | 'Fixing' | 'BlockTrade';
export type StockPriceType = 'LMT' | 'MKT' | 'MKP';
export type StockOrderType = 'ROD' | 'IOC' | 'FOK';
export type StockOrderSide = 'Buy' | 'Sell';

export interface CanonicalOrderClass {
    readonly orderCond: OrderCond;
    readonly orderLot: OrderLot;
    readonly priceType: StockPriceType;
    readonly orderType: StockOrderType;
    readonly side: StockOrderSide;
    readonly daytradeShort: boolean;
}

export interface OrderClassMatrixEntryInput {
    readonly provenance: 'manual_user_confirmed' | 'automation';
    readonly routeId: string;
    readonly orderClass: CanonicalOrderClass;
    readonly enabled: boolean;
    readonly evidenceRevision: string;
}

export interface OrderClassMatrix {
    readonly schemaVersion: typeof SMART_ORDER_RISK_DOMAIN_SCHEMA_VERSION;
    readonly matrixRevision: string;
    readonly routeCoverageSha256: `sha256:${string}`;
    readonly adapterSha256: `sha256:${string}`;
    readonly entries: readonly Readonly<OrderClassMatrixEntryInput>[];
}

export interface VerifiedOrderClassMatrix extends OrderClassMatrix {
    readonly matrixDefinitionSha256: `sha256:${string}`;
}

const ORDER_CONDS = ['Cash', 'MarginTrading', 'ShortSelling', 'Netting'] as const;
const ORDER_LOTS = ['Common', 'IntradayOdd', 'Odd', 'Fixing', 'BlockTrade'] as const;
const PRICE_TYPES = ['LMT', 'MKT', 'MKP'] as const;
const ORDER_TYPES = ['ROD', 'IOC', 'FOK'] as const;
const ORDER_SIDES = ['Buy', 'Sell'] as const;
const verifiedOrderClassMatrices = new WeakSet<object>();

function canonicalOrderClass(input: CanonicalOrderClass): CanonicalOrderClass {
    if (
        !ORDER_CONDS.includes(input.orderCond) ||
        !ORDER_LOTS.includes(input.orderLot) ||
        !PRICE_TYPES.includes(input.priceType) ||
        !ORDER_TYPES.includes(input.orderType) ||
        !ORDER_SIDES.includes(input.side) ||
        typeof input.daytradeShort !== 'boolean'
    ) {
        return fail('invalid_order_matrix', 'order class contains an unknown value');
    }
    return Object.freeze({ ...input });
}

function orderClassKey(orderClass: CanonicalOrderClass): string {
    return [
        orderClass.orderCond,
        orderClass.orderLot,
        orderClass.priceType,
        orderClass.orderType,
        orderClass.side,
        orderClass.daytradeShort ? 'daytrade' : 'regular',
    ].join('|');
}

export function createOrderClassMatrix(input: {
    matrixRevision: string;
    routeCoverageSha256: string;
    adapterSha256: string;
    entries: readonly OrderClassMatrixEntryInput[];
}): OrderClassMatrix {
    const seen = new Set<string>();
    const entries = input.entries.map((entry) => {
        if (
            !['manual_user_confirmed', 'automation'].includes(entry.provenance) ||
            typeof entry.enabled !== 'boolean'
        ) {
            return fail('invalid_order_matrix', 'matrix entry is invalid');
        }
        const orderClass = canonicalOrderClass(entry.orderClass);
        const routeId = token(entry.routeId, 'routeId');
        const key = `${entry.provenance}|${routeId}|${orderClassKey(orderClass)}`;
        if (seen.has(key)) return fail('invalid_order_matrix', 'duplicate matrix entry');
        seen.add(key);
        return Object.freeze({
            provenance: entry.provenance,
            routeId,
            orderClass,
            enabled: entry.enabled,
            evidenceRevision: token(entry.evidenceRevision, 'evidenceRevision'),
        });
    });
    return Object.freeze({
        schemaVersion: SMART_ORDER_RISK_DOMAIN_SCHEMA_VERSION,
        matrixRevision: token(input.matrixRevision, 'matrixRevision'),
        routeCoverageSha256: digest(input.routeCoverageSha256, 'routeCoverageSha256'),
        adapterSha256: digest(input.adapterSha256, 'adapterSha256'),
        entries: Object.freeze(entries),
    });
}

async function issueVerifiedOrderClassMatrixForTest(input: {
    matrixRevision: string;
    routeCoverageSha256: string;
    adapterSha256: string;
    entries: readonly OrderClassMatrixEntryInput[];
}): Promise<VerifiedOrderClassMatrix> {
    requireTestIssuer();
    const canonical = createOrderClassMatrix(input);
    const matrix = Object.freeze({
        ...canonical,
        matrixDefinitionSha256: await sha256(stableJson(canonical)),
    });
    verifiedOrderClassMatrices.add(matrix);
    return matrix;
}

export type OrderClassDecisionReason =
    | 'matrix_untrusted'
    | 'authority_untrusted_or_stale'
    | 'authority_matrix_mismatch'
    | 'probe_route_forbidden'
    | 'route_uncovered'
    | 'class_unverified'
    | 'automation_cash_common_only'
    | 'automation_daytrade_unsupported'
    | 'automation_execution_policy_unverified';

export type OrderClassDecision =
    | Readonly<{ supported: true; entry: Readonly<OrderClassMatrixEntryInput> }>
    | Readonly<{ supported: false; reason: OrderClassDecisionReason }>;

export function evaluateOrderClass(input: {
    matrix: VerifiedOrderClassMatrix;
    authority: CurrentDispatchAuthority;
    time: VerifiedRiskEvaluationTime;
    routeId: string;
    orderClass: CanonicalOrderClass;
}): OrderClassDecision {
    if (!verifiedOrderClassMatrices.has(input.matrix)) {
        return Object.freeze({ supported: false, reason: 'matrix_untrusted' });
    }
    const now = currentRiskTime(input.time);
    if (
        now === undefined ||
        !currentDispatchAuthorities.has(input.authority) ||
        input.authority.runtimeEpochId !== input.time.runtimeEpochId ||
        input.authority.apiGeneration !== input.time.apiGeneration ||
        input.authority.clockRevision !== input.time.clockRevision ||
        now < input.authority.issuedAtEpochMs ||
        now > input.authority.validUntilEpochMs
    ) {
        return Object.freeze({
            supported: false,
            reason: 'authority_untrusted_or_stale',
        });
    }
    if (input.authority.provenance === 'gate_probe') {
        return Object.freeze({ supported: false, reason: 'probe_route_forbidden' });
    }
    if (
        input.matrix.routeCoverageSha256 !== input.authority.routeCoverageSha256 ||
        input.matrix.adapterSha256 !== input.authority.adapterSha256 ||
        input.matrix.matrixRevision !==
            input.authority.orderClassMatrixRevision ||
        input.matrix.matrixDefinitionSha256 !==
            input.authority.orderClassMatrixSha256
    ) {
        return Object.freeze({ supported: false, reason: 'authority_matrix_mismatch' });
    }
    const provenance = input.authority.provenance;
    const routeId = token(input.routeId, 'routeId');
    if (
        input.authority.writeScope.routeId !== routeId ||
        input.authority.writeScope.operationKind !== 'place'
    ) {
        return Object.freeze({ supported: false, reason: 'authority_matrix_mismatch' });
    }
    const orderClass = canonicalOrderClass(input.orderClass);
    const routeEntries = input.matrix.entries.filter(
        (entry) => entry.provenance === provenance && entry.routeId === routeId,
    );
    if (routeEntries.length === 0) return Object.freeze({ supported: false, reason: 'route_uncovered' });
    if (provenance === 'automation') {
        if (orderClass.orderCond !== 'Cash' || orderClass.orderLot !== 'Common') {
            return Object.freeze({ supported: false, reason: 'automation_cash_common_only' });
        }
        if (orderClass.daytradeShort) {
            return Object.freeze({ supported: false, reason: 'automation_daytrade_unsupported' });
        }
        const executionSupported =
            (orderClass.priceType === 'LMT' && ['ROD', 'IOC'].includes(orderClass.orderType)) ||
            (orderClass.priceType === 'MKT' && orderClass.orderType === 'IOC');
        if (!executionSupported) {
            return Object.freeze({ supported: false, reason: 'automation_execution_policy_unverified' });
        }
    }
    const key = orderClassKey(orderClass);
    const match = routeEntries.find(
        (entry) => entry.enabled && orderClassKey(entry.orderClass) === key,
    );
    return match
        ? Object.freeze({ supported: true, entry: match })
        : Object.freeze({ supported: false, reason: 'class_unverified' });
}

// ---------------------------------------------------------------------------
// Worst-case entry exposure reservation
// ---------------------------------------------------------------------------

export type ExposureDimension =
    | 'quantity_shares'
    | 'notional_minor_units'
    | 'cash_minor_units'
    | 'position_shares'
    | 'order_count';

export interface ExposureVector {
    readonly quantityShares: bigint;
    readonly notionalMinorUnits: bigint;
    readonly cashMinorUnits: bigint;
    readonly positionShares: bigint;
    readonly orderCount: bigint;
}

export interface VerifiedWorstCaseExposure {
    readonly vector: ExposureVector;
    readonly orderDefinitionSha256: `sha256:${string}`;
    readonly riskPolicyRevision: string;
    readonly riskPolicyDefinitionSha256: `sha256:${string}`;
}

export interface VerifiedExposureBaseline {
    readonly identityGroupId: IdentityGroupId;
    readonly policyRevision: string;
    readonly policyDefinitionSha256: `sha256:${string}`;
    readonly sourceRevision: string;
    readonly identityExposure: ExposureVector;
    readonly accountExposure: Readonly<Record<string, ExposureVector>>;
}

const verifiedWorstCaseExposures = new WeakSet<object>();
const verifiedExposureBaselines = new WeakSet<object>();
const verifiedExposurePolicies = new WeakSet<object>();
const verifiedEntryExposureReservations = new WeakSet<object>();
const verifiedEntryExposureLedgers = new WeakSet<object>();

export interface ExposureLimitPolicy {
    readonly policyRevision: string;
    readonly policyDefinitionSha256: `sha256:${string}`;
    readonly reservedDimensions: readonly ExposureDimension[];
    readonly noReservableDimensions: boolean;
    readonly perAccountLimits: Readonly<Partial<Record<ExposureDimension, bigint>>>;
    readonly identityGroupLimits: Readonly<Partial<Record<ExposureDimension, bigint>>>;
}

export interface EntryExposureReservation {
    readonly reservationId: EntryExposureReservationId;
    readonly strategyId: string;
    readonly accountRef: string;
    readonly identityGroupId: IdentityGroupId;
    readonly policyRevision: string;
    readonly policyDefinitionSha256: `sha256:${string}`;
    readonly worstCase: ExposureVector;
    readonly orderDefinitionSha256: `sha256:${string}`;
    readonly state:
        | 'reserved'
        | 'dispatching'
        | 'working'
        | 'unknown'
        | 'consumed'
        | 'released';
}

export interface EntryExposureLedger {
    readonly revision: number;
    readonly identityGroupId: IdentityGroupId;
    readonly policyRevision: string;
    readonly policyDefinitionSha256: `sha256:${string}`;
    readonly baseline: VerifiedExposureBaseline;
    readonly reservations: readonly EntryExposureReservation[];
}

export type ExposureReservationDecision =
    | Readonly<{
          allowed: true;
          reservationRequired: boolean;
          nextLedger: EntryExposureLedger;
          accountAggregate: ExposureVector;
          identityAggregate: ExposureVector;
          atomicCommit: Readonly<{
              expectedLedgerRevision: number;
              nextLedgerRevision: number;
              reservationId?: EntryExposureReservationId;
              companions: readonly (
                  | 'order_intent_prepared'
                  | 'entry_exposure_reservation_created'
              )[];
          }>;
      }>
    | Readonly<{
          allowed: false;
          reason:
              | 'stale_revision'
              | 'account_limit_exceeded'
              | 'identity_limit_exceeded';
          exceededDimension?: ExposureDimension;
      }>;

const EXPOSURE_FIELDS: Readonly<Record<ExposureDimension, keyof ExposureVector>> = {
    quantity_shares: 'quantityShares',
    notional_minor_units: 'notionalMinorUnits',
    cash_minor_units: 'cashMinorUnits',
    position_shares: 'positionShares',
    order_count: 'orderCount',
};

const ZERO_EXPOSURE: ExposureVector = Object.freeze({
    quantityShares: 0n,
    notionalMinorUnits: 0n,
    cashMinorUnits: 0n,
    positionShares: 0n,
    orderCount: 0n,
});

function validateExposure(input: ExposureVector): ExposureVector {
    const result = { ...input };
    for (const [key, value] of Object.entries(result)) {
        if (typeof value !== 'bigint' || value < 0n || value > SMART_ORDER_MAX_EXPOSURE_VALUE) {
            return fail('invalid_exposure', `${key} is outside persistence bounds`);
        }
    }
    return Object.freeze(result);
}

function addExposure(left: ExposureVector, right: ExposureVector): ExposureVector {
    return validateExposure({
        quantityShares: left.quantityShares + right.quantityShares,
        notionalMinorUnits: left.notionalMinorUnits + right.notionalMinorUnits,
        cashMinorUnits: left.cashMinorUnits + right.cashMinorUnits,
        positionShares: left.positionShares + right.positionShares,
        orderCount: left.orderCount + right.orderCount,
    });
}

async function issueVerifiedWorstCaseExposureForTest(input: {
    quantityShares: bigint;
    worstPriceMinorPerShare: bigint;
    feeMinorUnits: bigint;
    transactionTaxMinorUnits: bigint;
    orderDefinitionSha256: string;
    policy: ExposureLimitPolicy;
}): Promise<VerifiedWorstCaseExposure> {
    requireTestIssuer();
    if (!verifiedExposurePolicies.has(input.policy)) {
        return fail('untrusted_exposure', 'risk policy is not verifier-issued');
    }
    const quantityShares = validateExposure({
        ...ZERO_EXPOSURE,
        quantityShares: input.quantityShares,
    }).quantityShares;
    const unitPrice = validateExposure({
        ...ZERO_EXPOSURE,
        notionalMinorUnits: input.worstPriceMinorPerShare,
    }).notionalMinorUnits;
    const fee = validateExposure({ ...ZERO_EXPOSURE, cashMinorUnits: input.feeMinorUnits }).cashMinorUnits;
    const tax = validateExposure({ ...ZERO_EXPOSURE, cashMinorUnits: input.transactionTaxMinorUnits }).cashMinorUnits;
    const notionalMinorUnits = quantityShares * unitPrice;
    const cashMinorUnits = notionalMinorUnits + fee + tax;
    const vector = validateExposure({
        quantityShares,
        notionalMinorUnits,
        cashMinorUnits,
        positionShares: quantityShares,
        orderCount: 1n,
    });
    const exposure = Object.freeze({
        vector,
        orderDefinitionSha256: digest(input.orderDefinitionSha256, 'orderDefinitionSha256'),
        riskPolicyRevision: input.policy.policyRevision,
        riskPolicyDefinitionSha256: input.policy.policyDefinitionSha256,
    });
    verifiedWorstCaseExposures.add(exposure);
    return exposure;
}

function issueVerifiedExposureBaselineForTest(input: {
    identityGroupId: IdentityGroupId;
    policy: ExposureLimitPolicy;
    sourceRevision: string;
    identityExposure: ExposureVector;
    accountExposure: Readonly<Record<string, ExposureVector>>;
}): VerifiedExposureBaseline {
    requireTestIssuer();
    if (!verifiedExposurePolicies.has(input.policy)) {
        return fail('untrusted_exposure', 'baseline policy is not verifier-issued');
    }
    const accounts: Record<string, ExposureVector> = {};
    for (const [accountRef, exposure] of Object.entries(input.accountExposure)) {
        accounts[token(accountRef, 'baseline.accountRef')] = validateExposure(exposure);
    }
    const identityExposure = validateExposure(input.identityExposure);
    const accountTotal = Object.values(accounts).reduce(
        (sum, exposure) => addExposure(sum, exposure),
        ZERO_EXPOSURE,
    );
    if (
        Object.keys(EXPOSURE_FIELDS).some((dimension) => {
            const field = EXPOSURE_FIELDS[dimension as ExposureDimension];
            return identityExposure[field] !== accountTotal[field];
        })
    ) {
        return fail(
            'invalid_exposure',
            'identity baseline must equal the complete account exposure aggregate',
        );
    }
    const baseline = Object.freeze({
        identityGroupId: input.identityGroupId,
        policyRevision: input.policy.policyRevision,
        policyDefinitionSha256: input.policy.policyDefinitionSha256,
        sourceRevision: token(input.sourceRevision, 'baseline.sourceRevision'),
        identityExposure,
        accountExposure: Object.freeze(accounts),
    });
    verifiedExposureBaselines.add(baseline);
    return baseline;
}

export function entryExposureReservationId(value: string): EntryExposureReservationId {
    return token(value, 'reservationId') as EntryExposureReservationId;
}

export function createEntryExposureReservation(input: {
    reservationId: EntryExposureReservationId;
    strategyId: string;
    accountRef: string;
    identityGroupId: IdentityGroupId;
    exposure: VerifiedWorstCaseExposure;
}): EntryExposureReservation {
    if (!verifiedWorstCaseExposures.has(input.exposure)) {
        return fail('untrusted_exposure', 'worst-case exposure is not verifier-issued');
    }
    const reservation = Object.freeze({
        reservationId: entryExposureReservationId(input.reservationId),
        strategyId: token(input.strategyId, 'strategyId'),
        accountRef: token(input.accountRef, 'accountRef'),
        identityGroupId: input.identityGroupId,
        policyRevision: input.exposure.riskPolicyRevision,
        policyDefinitionSha256: input.exposure.riskPolicyDefinitionSha256,
        worstCase: input.exposure.vector,
        orderDefinitionSha256: input.exposure.orderDefinitionSha256,
        state: 'reserved',
    });
    verifiedEntryExposureReservations.add(reservation);
    return reservation;
}

function validateExposurePolicy(policy: ExposureLimitPolicy): readonly ExposureDimension[] {
    if (!verifiedExposurePolicies.has(policy)) {
        return fail('untrusted_exposure', 'exposure policy is not verifier-issued');
    }
    token(policy.policyRevision, 'policyRevision');
    digest(policy.policyDefinitionSha256, 'policyDefinitionSha256');
    const dimensions = [...policy.reservedDimensions];
    if (new Set(dimensions).size !== dimensions.length) {
        return fail('invalid_exposure', 'reserved dimensions must be unique');
    }
    if ((dimensions.length === 0) !== policy.noReservableDimensions) {
        return fail('invalid_exposure', 'no-reservation policy declaration is inconsistent');
    }
    for (const dimension of dimensions) {
        if (!(dimension in EXPOSURE_FIELDS)) {
            return fail('invalid_exposure', 'unknown exposure dimension');
        }
        for (const limits of [policy.perAccountLimits, policy.identityGroupLimits]) {
            const limit = limits[dimension];
            if (typeof limit !== 'bigint' || limit < 0n || limit > SMART_ORDER_MAX_EXPOSURE_VALUE) {
                return fail('invalid_exposure', 'each reserved dimension needs bounded dual limits');
            }
        }
    }
    return dimensions;
}

function issueVerifiedExposureLimitPolicyForTest(input: {
    policyRevision: string;
    policyDefinitionSha256: string;
    reservedDimensions: readonly ExposureDimension[];
    noReservableDimensions: boolean;
    perAccountLimits: Readonly<Partial<Record<ExposureDimension, bigint>>>;
    identityGroupLimits: Readonly<Partial<Record<ExposureDimension, bigint>>>;
}): ExposureLimitPolicy {
    requireTestIssuer();
    const policy = Object.freeze({
        policyRevision: token(input.policyRevision, 'policyRevision'),
        policyDefinitionSha256: digest(
            input.policyDefinitionSha256,
            'policyDefinitionSha256',
        ),
        reservedDimensions: Object.freeze([...input.reservedDimensions]),
        noReservableDimensions: input.noReservableDimensions,
        perAccountLimits: Object.freeze({ ...input.perAccountLimits }),
        identityGroupLimits: Object.freeze({ ...input.identityGroupLimits }),
    });
    verifiedExposurePolicies.add(policy);
    validateExposurePolicy(policy);
    return policy;
}

function issueEntryExposureLedger(input: {
    revision: number;
    identityGroupId: IdentityGroupId;
    policy: ExposureLimitPolicy;
    baseline: VerifiedExposureBaseline;
    reservations: readonly EntryExposureReservation[];
}): EntryExposureLedger {
    if (
        !verifiedExposurePolicies.has(input.policy) ||
        !verifiedExposureBaselines.has(input.baseline) ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 0 ||
        input.baseline.identityGroupId !== input.identityGroupId ||
        input.baseline.policyRevision !== input.policy.policyRevision ||
        input.baseline.policyDefinitionSha256 !==
            input.policy.policyDefinitionSha256
    ) {
        return fail('untrusted_exposure', 'entry exposure ledger scope is untrusted');
    }
    const reservationIds = new Set<EntryExposureReservationId>();
    for (const reservation of input.reservations) {
        if (
            !verifiedEntryExposureReservations.has(reservation) ||
            reservation.identityGroupId !== input.identityGroupId ||
            reservation.policyRevision !== input.policy.policyRevision ||
            reservation.policyDefinitionSha256 !==
                input.policy.policyDefinitionSha256 ||
            reservationIds.has(reservation.reservationId)
        ) {
            return fail(
                'untrusted_exposure',
                'entry exposure ledger contains an untrusted reservation',
            );
        }
        reservationIds.add(reservation.reservationId);
    }
    const ledger = Object.freeze({
        revision: input.revision,
        identityGroupId: input.identityGroupId,
        policyRevision: input.policy.policyRevision,
        policyDefinitionSha256: input.policy.policyDefinitionSha256,
        baseline: input.baseline,
        reservations: Object.freeze([...input.reservations]),
    });
    verifiedEntryExposureLedgers.add(ledger);
    return ledger;
}

function issueVerifiedEntryExposureLedgerForTest(input: {
    revision: number;
    identityGroupId: IdentityGroupId;
    policy: ExposureLimitPolicy;
    baseline: VerifiedExposureBaseline;
    reservations: readonly EntryExposureReservation[];
}): EntryExposureLedger {
    requireTestIssuer();
    return issueEntryExposureLedger(input);
}

export function reserveWorstCaseEntry(input: {
    policy: ExposureLimitPolicy;
    ledger: EntryExposureLedger;
    expectedRevision: number;
    reservation: EntryExposureReservation;
}): ExposureReservationDecision {
    if (
        !verifiedEntryExposureLedgers.has(input.ledger) ||
        !verifiedEntryExposureReservations.has(input.reservation)
    ) {
        return fail(
            'untrusted_exposure',
            'ledger or reservation is not verifier-issued',
        );
    }
    const dimensions = validateExposurePolicy(input.policy);
    if (
        !Number.isSafeInteger(input.ledger.revision) ||
        input.ledger.revision < 0 ||
        input.ledger.revision >= Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        input.expectedRevision >= Number.MAX_SAFE_INTEGER
    ) {
        return fail('invalid_exposure', 'ledger revision is invalid');
    }
    if (input.ledger.revision !== input.expectedRevision) {
        return Object.freeze({ allowed: false, reason: 'stale_revision' });
    }
    if (
        input.reservation.state !== 'reserved' ||
        input.reservation.identityGroupId !== input.ledger.identityGroupId ||
        input.ledger.baseline.identityGroupId !== input.ledger.identityGroupId ||
        input.policy.policyRevision !== input.ledger.policyRevision ||
        input.policy.policyDefinitionSha256 !==
            input.ledger.policyDefinitionSha256 ||
        input.reservation.policyRevision !== input.ledger.policyRevision ||
        input.reservation.policyDefinitionSha256 !==
            input.ledger.policyDefinitionSha256 ||
        input.ledger.baseline.policyRevision !== input.ledger.policyRevision ||
        input.ledger.baseline.policyDefinitionSha256 !==
            input.ledger.policyDefinitionSha256
    ) {
        return fail('invalid_exposure', 'reservation scope or policy revision differs');
    }
    if (input.ledger.reservations.some((item) => item.reservationId === input.reservation.reservationId)) {
        return fail('invalid_exposure', 'reservation ID already exists');
    }
    const active = input.ledger.reservations.filter((item) =>
        ['reserved', 'dispatching', 'working', 'unknown'].includes(item.state),
    );
    if (active.some((item) => item.identityGroupId !== input.ledger.identityGroupId)) {
        return fail('invalid_exposure', 'ledger contains another identity group');
    }
    const identityAggregate = addExposure(
        active.reduce((sum, item) => addExposure(sum, item.worstCase), input.ledger.baseline.identityExposure),
        input.reservation.worstCase,
    );
    if (
        !Object.prototype.hasOwnProperty.call(
            input.ledger.baseline.accountExposure,
            input.reservation.accountRef,
        )
    ) {
        return fail(
            'invalid_exposure',
            'reservation account is absent from the complete exposure baseline',
        );
    }
    const accountBase = input.ledger.baseline.accountExposure[
        input.reservation.accountRef
    ]!;
    const accountAggregate = addExposure(
        active
            .filter((item) => item.accountRef === input.reservation.accountRef)
            .reduce((sum, item) => addExposure(sum, item.worstCase), accountBase),
        input.reservation.worstCase,
    );
    for (const dimension of dimensions) {
        const field = EXPOSURE_FIELDS[dimension];
        if (accountAggregate[field] > (input.policy.perAccountLimits[dimension] as bigint)) {
            return Object.freeze({
                allowed: false,
                reason: 'account_limit_exceeded',
                exceededDimension: dimension,
            });
        }
        if (identityAggregate[field] > (input.policy.identityGroupLimits[dimension] as bigint)) {
            return Object.freeze({
                allowed: false,
                reason: 'identity_limit_exceeded',
                exceededDimension: dimension,
            });
        }
    }
    const reservationRequired = dimensions.length > 0;
    return Object.freeze({
        allowed: true,
        reservationRequired,
        accountAggregate,
        identityAggregate,
        atomicCommit: Object.freeze({
            expectedLedgerRevision: input.ledger.revision,
            nextLedgerRevision: input.ledger.revision + 1,
            ...(reservationRequired
                ? { reservationId: input.reservation.reservationId }
                : {}),
            companions: Object.freeze([
                'order_intent_prepared' as const,
                ...(reservationRequired
                    ? (['entry_exposure_reservation_created'] as const)
                    : []),
            ]),
        }),
        nextLedger: issueEntryExposureLedger({
            revision: input.ledger.revision + 1,
            identityGroupId: input.ledger.identityGroupId,
            policy: input.policy,
            baseline: input.ledger.baseline,
            reservations: Object.freeze(
                reservationRequired
                    ? [...input.ledger.reservations, input.reservation]
                    : [...input.ledger.reservations],
            ),
        }),
    });
}

// ---------------------------------------------------------------------------
// Exit claim projection and tracked unprotected remainder
// ---------------------------------------------------------------------------

export type ExitClaimState =
    | 'monitoring_reserved'
    | 'intent_reserved'
    | 'broker_working'
    | 'consumed'
    | 'released'
    | 'unknown';

export interface VerifiedExitClaimScope {
    readonly accountRef: string;
    readonly contractKey: string;
    readonly positionLineageId: string;
    readonly obligationId: string;
    readonly remainderGeneration: number;
    readonly brokerConfirmedAvailableShares: Share;
    readonly reconciliationGeneration: number;
    readonly reconciliationRevision: string;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
}

export interface VerifiedExitClaimEvidence {
    readonly claimId: ExitClaimId;
    readonly kind: 'runtime_readiness' | 'broker_reconciliation';
    readonly representationKind: 'runtime' | 'external';
    readonly accountRef: string;
    readonly contractKey: string;
    readonly positionLineageId: string;
    readonly obligationId: string;
    readonly remainderGeneration: number;
    readonly allocationStartShare: Share;
    readonly quantityShares: Share;
    readonly state: ExitClaimState;
    readonly asOfEpochMs: number;
    readonly validUntilEpochMs: number;
    readonly evidenceRevision: string;
    readonly reconciliationGeneration: number;
    readonly reconciliationRevision: string;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
}

export interface ExitClaimRepresentation {
    readonly claimId: ExitClaimId;
    readonly kind: 'runtime' | 'external';
    readonly accountRef: string;
    readonly contractKey: string;
    readonly positionLineageId: string;
    readonly obligationId: string;
    readonly remainderGeneration: number;
    readonly allocationStartShare: Share;
    readonly quantityShares: Share;
    readonly state: ExitClaimState;
    readonly evidence: VerifiedExitClaimEvidence;
}

const verifiedExitClaimScopes = new WeakSet<object>();
const verifiedExitClaimEvidence = new WeakSet<object>();
const latestExitClaimReconciliationByScope = new Map<
    string,
    Readonly<{
        reconciliationGeneration: number;
        reconciliationRevision: string;
        runtimeEpochId: string;
        apiGeneration: string;
        remainderGeneration: number;
        brokerConfirmedAvailableShares: Share;
    }>
>();

export const SMART_ORDER_EXIT_CLAIM_PROJECTION_TTL_MS = 1_000 as const;

export interface VerifiedExitClaimProjectionContext {
    readonly scopeKey: string;
    readonly reconciliationGeneration: number;
    readonly reconciliationRevision: string;
    readonly runtimeEpochId: string;
    readonly apiGeneration: string;
    readonly remainderGeneration: number;
    readonly brokerConfirmedAvailableShares: Share;
    readonly nowEpochMs: number;
    readonly issuedAtMonotonicMs: number;
    readonly validUntilMonotonicMs: number;
}

const verifiedExitClaimProjectionContexts = new WeakSet<object>();
const consumedExitClaimProjectionContexts = new WeakSet<object>();

export function exitClaimId(value: string): ExitClaimId {
    return token(value, 'exitClaimId') as ExitClaimId;
}

function exitClaimScopeKey(input: {
    accountRef: string;
    contractKey: string;
    positionLineageId: string;
    obligationId: string;
}): string {
    return stableJson({
        accountRef: input.accountRef,
        contractKey: input.contractKey,
        positionLineageId: input.positionLineageId,
        obligationId: input.obligationId,
    });
}

function issueVerifiedExitClaimScopeForTest(input: {
    accountRef: string;
    contractKey: string;
    positionLineageId: string;
    obligationId: string;
    remainderGeneration: number;
    brokerConfirmedAvailableShares: Share;
    reconciliationGeneration: number;
    reconciliationRevision: string;
    time: VerifiedRiskEvaluationTime;
}): VerifiedExitClaimScope {
    requireTestIssuer();
    if (currentRiskTime(input.time) === undefined) {
        return fail('invalid_claim_projection', 'claim scope time is untrusted');
    }
    if (!Number.isSafeInteger(input.remainderGeneration) || input.remainderGeneration < 0) {
        return fail('invalid_claim_projection', 'remainder generation is invalid');
    }
    if (
        !Number.isSafeInteger(input.reconciliationGeneration) ||
        input.reconciliationGeneration < 1
    ) {
        return fail(
            'invalid_claim_projection',
            'reconciliation generation is invalid',
        );
    }
    const scope = Object.freeze({
        accountRef: token(input.accountRef, 'scope.accountRef'),
        contractKey: token(input.contractKey, 'scope.contractKey'),
        positionLineageId: token(input.positionLineageId, 'scope.positionLineageId'),
        obligationId: token(input.obligationId, 'scope.obligationId'),
        remainderGeneration: input.remainderGeneration,
        brokerConfirmedAvailableShares: shares(input.brokerConfirmedAvailableShares),
        reconciliationGeneration: input.reconciliationGeneration,
        reconciliationRevision: token(input.reconciliationRevision, 'reconciliationRevision'),
        runtimeEpochId: input.time.runtimeEpochId,
        apiGeneration: input.time.apiGeneration,
    });
    const scopeKey = exitClaimScopeKey(scope);
    const current = latestExitClaimReconciliationByScope.get(scopeKey);
    if (
        current &&
        (input.reconciliationGeneration < current.reconciliationGeneration ||
            (input.reconciliationGeneration === current.reconciliationGeneration &&
                (scope.reconciliationRevision !== current.reconciliationRevision ||
                    scope.runtimeEpochId !== current.runtimeEpochId ||
                    scope.apiGeneration !== current.apiGeneration ||
                    scope.remainderGeneration !== current.remainderGeneration ||
                    shareValue(scope.brokerConfirmedAvailableShares) !==
                        shareValue(current.brokerConfirmedAvailableShares))))
    ) {
        return fail(
            'invalid_claim_projection',
            'claim scope does not advance the canonical reconciliation head',
        );
    }
    if (!current || input.reconciliationGeneration > current.reconciliationGeneration) {
        latestExitClaimReconciliationByScope.set(
            scopeKey,
            Object.freeze({
                reconciliationGeneration: input.reconciliationGeneration,
                reconciliationRevision: scope.reconciliationRevision,
                runtimeEpochId: scope.runtimeEpochId,
                apiGeneration: scope.apiGeneration,
                remainderGeneration: scope.remainderGeneration,
                brokerConfirmedAvailableShares:
                    scope.brokerConfirmedAvailableShares,
            }),
        );
    }
    verifiedExitClaimScopes.add(scope);
    return scope;
}

function issueVerifiedExitClaimProjectionContextForTest(input: {
    scope: VerifiedExitClaimScope;
    time: VerifiedRiskEvaluationTime;
}): VerifiedExitClaimProjectionContext {
    requireTestIssuer();
    const nowEpochMs = currentRiskTime(input.time);
    if (nowEpochMs === undefined || !verifiedExitClaimScopes.has(input.scope)) {
        return fail(
            'invalid_claim_projection',
            'projection context source is untrusted',
        );
    }
    const scopeKey = exitClaimScopeKey(input.scope);
    const head = latestExitClaimReconciliationByScope.get(scopeKey);
    if (
        !head ||
        head.reconciliationGeneration !==
            input.scope.reconciliationGeneration ||
        head.reconciliationRevision !== input.scope.reconciliationRevision ||
        head.runtimeEpochId !== input.time.runtimeEpochId ||
        head.apiGeneration !== input.time.apiGeneration
        || head.remainderGeneration !== input.scope.remainderGeneration
        || shareValue(head.brokerConfirmedAvailableShares) !==
            shareValue(input.scope.brokerConfirmedAvailableShares)
    ) {
        return fail(
            'invalid_claim_projection',
            'projection context is not bound to the current reconciliation head',
        );
    }
    const issuedAtMonotonicMs = monotonicNowMs();
    const context = Object.freeze({
        scopeKey,
        reconciliationGeneration: head.reconciliationGeneration,
        reconciliationRevision: head.reconciliationRevision,
        runtimeEpochId: head.runtimeEpochId,
        apiGeneration: head.apiGeneration,
        remainderGeneration: head.remainderGeneration,
        brokerConfirmedAvailableShares: head.brokerConfirmedAvailableShares,
        nowEpochMs,
        issuedAtMonotonicMs,
        validUntilMonotonicMs:
            issuedAtMonotonicMs + SMART_ORDER_EXIT_CLAIM_PROJECTION_TTL_MS,
    });
    verifiedExitClaimProjectionContexts.add(context);
    return context;
}

function issueVerifiedExitClaimEvidenceForTest(input: {
    scope: VerifiedExitClaimScope;
    claimId: ExitClaimId;
    kind: 'runtime_readiness' | 'broker_reconciliation';
    representationKind: 'runtime' | 'external';
    allocationStartShare: Share;
    quantityShares: Share;
    state: ExitClaimState;
    asOfEpochMs: number;
    validUntilEpochMs: number;
    evidenceRevision: string;
}): VerifiedExitClaimEvidence {
    requireTestIssuer();
    if (!verifiedExitClaimScopes.has(input.scope)) {
        return fail('invalid_claim_projection', 'claim scope is untrusted');
    }
    const asOfEpochMs = epoch(input.asOfEpochMs, 'claim.asOfEpochMs');
    const validUntilEpochMs = epoch(input.validUntilEpochMs, 'claim.validUntilEpochMs');
    if (validUntilEpochMs <= asOfEpochMs) {
        return fail('invalid_claim_projection', 'claim evidence expiry is invalid');
    }
    const allocationStartShare = shares(input.allocationStartShare);
    const quantityShares = shares(input.quantityShares);
    if (shareValue(quantityShares) <= 0n) {
        return fail(
            'invalid_claim_projection',
            'claim evidence quantity must be positive',
        );
    }
    const evidence = Object.freeze({
        claimId: exitClaimId(input.claimId),
        kind: input.kind,
        representationKind: input.representationKind,
        accountRef: input.scope.accountRef,
        contractKey: input.scope.contractKey,
        positionLineageId: input.scope.positionLineageId,
        obligationId: input.scope.obligationId,
        remainderGeneration: input.scope.remainderGeneration,
        allocationStartShare,
        quantityShares,
        state: input.state,
        asOfEpochMs,
        validUntilEpochMs,
        evidenceRevision: token(input.evidenceRevision, 'claim.evidenceRevision'),
        reconciliationGeneration: input.scope.reconciliationGeneration,
        reconciliationRevision: input.scope.reconciliationRevision,
        runtimeEpochId: input.scope.runtimeEpochId,
        apiGeneration: input.scope.apiGeneration,
    });
    verifiedExitClaimEvidence.add(evidence);
    return evidence;
}

export type ExitClaimProjection =
    | Readonly<{
          valid: true;
          runtimeReservedShares: Share;
          externalReservedShares: Share;
          runtimeActivelyCoveredShares: Share;
          hasUnknown: boolean;
          distinctClaimCount: number;
      }>
    | Readonly<{
          valid: false;
          blocker:
              | 'untrusted_scope'
              | 'scope_mismatch'
              | 'untrusted_or_stale_evidence'
              | 'conflicting_representation'
              | 'overlapping_allocation'
              | 'allocation_exceeds_position';
          hasUnknown: true;
      }>;

function invalidClaimProjection(
    blocker: Extract<ExitClaimProjection, { valid: false }>['blocker'],
): ExitClaimProjection {
    return Object.freeze({ valid: false, blocker, hasUnknown: true });
}

function sameScope(
    scope: VerifiedExitClaimScope,
    representation: ExitClaimRepresentation,
): boolean {
    return (
        representation.accountRef === scope.accountRef &&
        representation.contractKey === scope.contractKey &&
        representation.positionLineageId === scope.positionLineageId &&
        representation.obligationId === scope.obligationId &&
        representation.remainderGeneration === scope.remainderGeneration
    );
}

function evidenceMatchesScope(
    scope: VerifiedExitClaimScope,
    evidence: VerifiedExitClaimEvidence,
): boolean {
    return (
        evidence.accountRef === scope.accountRef &&
        evidence.contractKey === scope.contractKey &&
        evidence.positionLineageId === scope.positionLineageId &&
        evidence.obligationId === scope.obligationId &&
        evidence.remainderGeneration === scope.remainderGeneration &&
        evidence.reconciliationGeneration ===
            scope.reconciliationGeneration &&
        evidence.reconciliationRevision === scope.reconciliationRevision
        && evidence.runtimeEpochId === scope.runtimeEpochId
        && evidence.apiGeneration === scope.apiGeneration
    );
}

export function projectDistinctExitClaims(input: {
    scope: VerifiedExitClaimScope;
    representations: readonly ExitClaimRepresentation[];
    time: VerifiedRiskEvaluationTime;
    context: VerifiedExitClaimProjectionContext;
}): ExitClaimProjection {
    if (!verifiedExitClaimScopes.has(input.scope)) {
        return invalidClaimProjection('untrusted_scope');
    }
    const now = currentRiskTime(input.time);
    const scopeKey = exitClaimScopeKey(input.scope);
    const head = latestExitClaimReconciliationByScope.get(scopeKey);
    if (
        now === undefined ||
        input.scope.runtimeEpochId !== input.time.runtimeEpochId ||
        input.scope.apiGeneration !== input.time.apiGeneration ||
        !verifiedExitClaimProjectionContexts.has(input.context) ||
        consumedExitClaimProjectionContexts.has(input.context) ||
        monotonicNowMs() > input.context.validUntilMonotonicMs ||
        input.context.scopeKey !== scopeKey ||
        input.context.reconciliationGeneration !==
            input.scope.reconciliationGeneration ||
        input.context.reconciliationRevision !==
            input.scope.reconciliationRevision ||
        input.context.runtimeEpochId !== input.time.runtimeEpochId ||
        input.context.apiGeneration !== input.time.apiGeneration ||
        input.context.remainderGeneration !== input.scope.remainderGeneration ||
        shareValue(input.context.brokerConfirmedAvailableShares) !==
            shareValue(input.scope.brokerConfirmedAvailableShares) ||
        input.context.nowEpochMs !== now ||
        !head ||
        head.reconciliationGeneration !==
            input.scope.reconciliationGeneration ||
        head.reconciliationRevision !== input.scope.reconciliationRevision ||
        head.runtimeEpochId !== input.scope.runtimeEpochId ||
        head.apiGeneration !== input.scope.apiGeneration
        || head.remainderGeneration !== input.scope.remainderGeneration
        || shareValue(head.brokerConfirmedAvailableShares) !==
            shareValue(input.scope.brokerConfirmedAvailableShares)
    ) {
        return invalidClaimProjection('untrusted_or_stale_evidence');
    }
    consumedExitClaimProjectionContexts.add(input.context);
    const groups = new Map<ExitClaimId, ExitClaimRepresentation[]>();
    for (const representation of input.representations) {
        if (!sameScope(input.scope, representation)) {
            return invalidClaimProjection('scope_mismatch');
        }
        if (
            !verifiedExitClaimEvidence.has(representation.evidence) ||
            representation.evidence.claimId !== representation.claimId ||
            representation.evidence.representationKind !== representation.kind ||
            representation.evidence.state !== representation.state ||
            shareValue(representation.evidence.allocationStartShare) !==
                shareValue(representation.allocationStartShare) ||
            shareValue(representation.evidence.quantityShares) !==
                shareValue(representation.quantityShares) ||
            !evidenceMatchesScope(input.scope, representation.evidence) ||
            now < representation.evidence.asOfEpochMs ||
            now > representation.evidence.validUntilEpochMs ||
            (representation.state === 'broker_working' &&
                representation.evidence.kind !== 'broker_reconciliation') ||
            (['monitoring_reserved', 'intent_reserved'].includes(representation.state) &&
                representation.evidence.kind !== 'runtime_readiness') ||
            (representation.kind === 'external' &&
                (representation.evidence.kind !== 'broker_reconciliation' ||
                    !['broker_working', 'unknown', 'released', 'consumed'].includes(
                        representation.state,
                    )))
        ) {
            return invalidClaimProjection('untrusted_or_stale_evidence');
        }
        const quantity = shareValue(representation.quantityShares);
        const start = shareValue(representation.allocationStartShare);
        if (quantity <= 0n || start < 0n || start + quantity > shareValue(input.scope.brokerConfirmedAvailableShares)) {
            return invalidClaimProjection('allocation_exceeds_position');
        }
        const list = groups.get(representation.claimId) ?? [];
        list.push(representation);
        groups.set(representation.claimId, list);
    }

    const claimSlices: Array<{
        claimId: ExitClaimId;
        start: bigint;
        end: bigint;
        representation: ExitClaimRepresentation;
    }> = [];
    for (const [claimId, representations] of groups) {
        const first = representations[0]!;
        const start = shareValue(first.allocationStartShare);
        const quantity = shareValue(first.quantityShares);
        if (
            representations.some(
                (item) =>
                    item.kind !== first.kind ||
                    shareValue(item.allocationStartShare) !== start ||
                    shareValue(item.quantityShares) !== quantity,
            ) ||
            new Set(representations.map((item) => item.state)).size !== representations.length ||
            new Set(
                representations
                    .filter((item) => ['released', 'consumed'].includes(item.state))
                    .map((item) => item.state),
            ).size > 1 ||
            (representations.some((item) => ['released', 'consumed'].includes(item.state)) &&
                representations.some((item) =>
                    ['monitoring_reserved', 'intent_reserved', 'broker_working', 'unknown'].includes(item.state),
                ))
        ) {
            return invalidClaimProjection('conflicting_representation');
        }
        claimSlices.push({ claimId, start, end: start + quantity, representation: first });
    }
    claimSlices.sort((left, right) =>
        left.start < right.start ? -1 : left.start > right.start ? 1 : 0,
    );
    for (let index = 1; index < claimSlices.length; index += 1) {
        if (claimSlices[index]!.start < claimSlices[index - 1]!.end) {
            return invalidClaimProjection('overlapping_allocation');
        }
    }

    let runtimeReserved = 0n;
    let externalReserved = 0n;
    let runtimeCovered = 0n;
    let hasUnknown = false;
    for (const [claimId, representations] of groups) {
        const quantity = shareValue(representations[0]!.quantityShares);
        const states = new Set(representations.map((item) => item.state));
        const kind = representations[0]!.kind;
        if (states.has('unknown')) hasUnknown = true;
        if (![...states].some((state) => ['released', 'consumed'].includes(state))) {
            if (kind === 'runtime') runtimeReserved += quantity;
            else externalReserved += quantity;
        }
        if (
            kind === 'runtime' &&
            !states.has('unknown') &&
            [...states].some((state) =>
                ['monitoring_reserved', 'intent_reserved', 'broker_working'].includes(state),
            )
        ) {
            runtimeCovered += quantity;
        }
        void claimId;
    }
    return Object.freeze({
        valid: true,
        runtimeReservedShares: shares(runtimeReserved),
        externalReservedShares: shares(externalReserved),
        runtimeActivelyCoveredShares: shares(runtimeCovered),
        hasUnknown,
        distinctClaimCount: groups.size,
    });
}

export type ProtectionCoverageProjection = Readonly<{
    filledShares: Share;
    confirmedExitedShares: Share;
    activelyCoveredShares: Share | 'unknown';
    runtimeTrackedUnprotectedRemainder: Share | 'unknown';
    overcoverageShares: Share;
    invariantStatus: 'consistent' | 'overcovered' | 'projection_blocked';
    blocker?:
        | Extract<ExitClaimProjection, { valid: false }>['blocker']
        | 'unknown_claim';
}>;

export function calculateRuntimeTrackedUnprotectedRemainder(input: {
    filledShares: Share;
    confirmedExitedShares: Share;
    projection: ExitClaimProjection;
}): ProtectionCoverageProjection {
    const filled = shareValue(input.filledShares);
    const exited = shareValue(input.confirmedExitedShares);
    if (!input.projection.valid) {
        return Object.freeze({
            filledShares: input.filledShares,
            confirmedExitedShares: input.confirmedExitedShares,
            activelyCoveredShares: shares(0),
            runtimeTrackedUnprotectedRemainder: shares(filled > exited ? filled - exited : 0n),
            overcoverageShares: shares(exited > filled ? exited - filled : 0n),
            invariantStatus: 'projection_blocked',
            blocker: input.projection.blocker,
        });
    }
    if (input.projection.hasUnknown) {
        return Object.freeze({
            filledShares: input.filledShares,
            confirmedExitedShares: input.confirmedExitedShares,
            activelyCoveredShares: 'unknown' as const,
            runtimeTrackedUnprotectedRemainder: 'unknown' as const,
            overcoverageShares: shares(0),
            invariantStatus: 'projection_blocked' as const,
            blocker: 'unknown_claim' as const,
        });
    }
    const covered = shareValue(input.projection.runtimeActivelyCoveredShares);
    const raw = filled - exited - covered;
    return Object.freeze({
        filledShares: input.filledShares,
        confirmedExitedShares: input.confirmedExitedShares,
        activelyCoveredShares: input.projection.runtimeActivelyCoveredShares,
        runtimeTrackedUnprotectedRemainder: shares(raw > 0n ? raw : 0n),
        overcoverageShares: shares(raw < 0n ? -raw : 0n),
        invariantStatus: raw < 0n ? 'overcovered' : 'consistent',
    });
}

/** Unit-test-only issuer; every build command defines the marker as false. */
export const SMART_ORDER_RISK_TEST_ONLY =
    isSmartOrderDomainTestBuild()
        ? Object.freeze({
              issueRiskEvaluationTime: issueRiskEvaluationTimeForTest,
              issueVerifiedPnlPolicy: issueVerifiedPnlPolicyForTest,
              issueVerifiedPnlEvidence: issueVerifiedPnlEvidenceForTest,
              issueVerifiedCanonicalPrincipal:
                  issueVerifiedCanonicalPrincipalForTest,
              issueIdentityKeyHandle: issueIdentityKeyHandleForTest,
              issueVerifiedGateManifest: issueVerifiedGateManifestForTest,
              issueCurrentDispatchAuthority:
                  issueCurrentDispatchAuthorityForTest,
              issueVerifiedOrderClassMatrix:
                  issueVerifiedOrderClassMatrixForTest,
              issueVerifiedWorstCaseExposure:
                  issueVerifiedWorstCaseExposureForTest,
              issueVerifiedExposureBaseline:
                  issueVerifiedExposureBaselineForTest,
              issueVerifiedExposureLimitPolicy:
                  issueVerifiedExposureLimitPolicyForTest,
              issueVerifiedEntryExposureLedger:
                  issueVerifiedEntryExposureLedgerForTest,
              issueVerifiedExitClaimScope:
                  issueVerifiedExitClaimScopeForTest,
              issueVerifiedExitClaimProjectionContext:
                  issueVerifiedExitClaimProjectionContextForTest,
              issueVerifiedExitClaimEvidence:
                  issueVerifiedExitClaimEvidenceForTest,
          })
        : undefined;
