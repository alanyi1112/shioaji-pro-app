import {
    stableSerializeCanonical,
    type CanonicalObject,
} from './smart-order-domain';
import { types as utilTypes } from 'node:util';
import { SMART_ORDER_DOMAIN_TEST_MODE } from './smart-order-domain-test-mode';
import {
    isQuoteObservationCurrent,
    isTrustedQuoteContinuityEvidence,
    restoreQuoteObservationCursor,
    smartOrderSha256HexSync,
    type EligibleQuoteObservation,
    type QuoteContinuityEvidence,
    type QuoteObservationCursor,
} from './smart-order-observation-domain';

export const SMART_ORDER_TRAILING_GAP_POLICY_VERSION =
    'realtimestock.smart-order-trailing-gap-policy/v1' as const;
export const SMART_ORDER_TRAILING_UI_CONTINUITY_EVIDENCE_SCHEMA_VERSION =
    'realtimestock.smart-order-trailing-ui-continuity-evidence/v1' as const;
export const SMART_ORDER_TRAILING_GAP_DECISION_SCHEMA_VERSION =
    'realtimestock.smart-order-trailing-gap-decision/v1' as const;
export const SMART_ORDER_TRAILING_HISTORICAL_AUDIT_SCHEMA_VERSION =
    'realtimestock.smart-order-trailing-historical-audit/v1' as const;

type Sha256 = `sha256:${string}`;

export const SMART_ORDER_TRAILING_GAP_KINDS = Object.freeze([
    'sse_disconnect',
    'sleep',
    'event_loop_pause',
    'clock_jump',
    'api_generation_change',
    'stream_epoch_change',
    'sequence_gap',
    'freshness_gap',
    'ui_disconnect',
] as const);

export type SmartOrderTrailingGapKind =
    (typeof SMART_ORDER_TRAILING_GAP_KINDS)[number];

export type SmartOrderTrailingObservationBinding = Readonly<{
    strategyId: string;
    strategyDefinitionHash: Sha256;
    confirmationHash: Sha256;
    armGeneration: number;
    strategyRevision: number;
    runtimeEpochId: string;
    tradeDate: string;
    contractKey: string;
    field: 'last_price';
    streamEpoch: string;
    lastObservationId: string;
    lastObservationHeadRevision: number;
    lastObservationSequence: number;
    extremeRevision: number;
    savedExtremeSha256: Sha256;
}>;

export type SmartOrderTrailingGapSignal = Readonly<{
    signalId: string;
    signalSha256: Sha256;
    sessionPhase: 'trading_session';
    gapKind: SmartOrderTrailingGapKind;
    runtimeEpochId: string;
    streamEpoch: string;
    detectedAtReceiveTimeMs: number;
}>;

declare const uiContinuityEvidenceBrand: unique symbol;

export type SmartOrderTrailingUiContinuityEvidence = Readonly<{
    schemaVersion: typeof SMART_ORDER_TRAILING_UI_CONTINUITY_EVIDENCE_SCHEMA_VERSION;
    policyVersion: typeof SMART_ORDER_TRAILING_GAP_POLICY_VERSION;
    evidenceId: string;
    verifierRevision: number;
    bindingSha256: Sha256;
    gapSignalSha256: Sha256;
    quoteContinuitySha256: Sha256;
    previousObservationId: string;
    currentObservationId: string;
    fromSequence: number;
    toSequence: number;
    streamEpoch: string;
    tradeDate: string;
    scope: 'preserve_existing_extreme_only';
    historicalTicksUsed: false;
    canResetExtreme: false;
    canUnlockManualIntervention: false;
    grantsBrokerWriteAuthority: false;
    readonly [uiContinuityEvidenceBrand]: 'verifier_issued_ui_continuity';
}>;

export type SmartOrderTrailingGapDecision = Readonly<{
    schemaVersion: typeof SMART_ORDER_TRAILING_GAP_DECISION_SCHEMA_VERSION;
    policyVersion: typeof SMART_ORDER_TRAILING_GAP_POLICY_VERSION;
    classification:
        | 'verified_ui_disconnect_continuity'
        | 'manual_intervention_required';
    decisionCode:
        | 'ui_disconnect_verified_no_observation_gap'
        | 'trading_session_observation_gap'
        | 'ui_disconnect_continuity_unproven'
        | 'ui_disconnect_evidence_untrusted'
        | 'ui_disconnect_evidence_replayed'
        | 'ui_disconnect_evidence_superseded'
        | 'ui_disconnect_lineage_mismatch'
        | 'invalid_policy_input';
    bindingSha256: Sha256 | null;
    gapSignalSha256: Sha256 | null;
    strategyAction:
        | 'retain_existing_trailing_state'
        | 'enter_manual_intervention';
    transitionReasonCode: 'TRAILING_GAP_EXTREME_UNKNOWN' | null;
    extremeAction: 'preserve_existing' | 'freeze_for_audit';
    historicalTicksUse: 'audit_only';
    historicalTicksCanUnlock: false;
    historicalTicksCanResetExtreme: false;
    automaticUnlockAllowed: false;
    automaticRearmAllowed: false;
    dispatchAllowed: false;
    grantsBrokerWriteAuthority: false;
}>;

export type SmartOrderTrailingHistoricalAudit = Readonly<{
    schemaVersion: typeof SMART_ORDER_TRAILING_HISTORICAL_AUDIT_SCHEMA_VERSION;
    policyVersion: typeof SMART_ORDER_TRAILING_GAP_POLICY_VERSION;
    auditId: string;
    bindingSha256: Sha256;
    historicalEvidenceSha256: Sha256;
    rangeStartReceiveTimeMs: number;
    rangeEndReceiveTimeMs: number;
    use: 'audit_only';
    strategyStateMutationAllowed: false;
    extremeMutationAllowed: false;
    automaticUnlockAllowed: false;
    automaticRearmAllowed: false;
    grantsBrokerWriteAuthority: false;
}>;

const BINDING_KEYS = Object.freeze([
    'strategyId',
    'strategyDefinitionHash',
    'confirmationHash',
    'armGeneration',
    'strategyRevision',
    'runtimeEpochId',
    'tradeDate',
    'contractKey',
    'field',
    'streamEpoch',
    'lastObservationId',
    'lastObservationHeadRevision',
    'lastObservationSequence',
    'extremeRevision',
    'savedExtremeSha256',
] as const);
const GAP_SIGNAL_KEYS = Object.freeze([
    'signalId',
    'signalSha256',
    'sessionPhase',
    'gapKind',
    'runtimeEpochId',
    'streamEpoch',
    'detectedAtReceiveTimeMs',
] as const);
const EVALUATION_KEYS = Object.freeze([
    'binding',
    'gapSignal',
    'uiDisconnectEvidence',
] as const);
const UI_EVIDENCE_ISSUER_KEYS = Object.freeze([
    'binding',
    'gapSignal',
    'continuityEvidence',
    'previousCursor',
    'currentObservation',
    'verifierRevision',
] as const);
const HISTORICAL_AUDIT_KEYS = Object.freeze([
    'binding',
    'historicalEvidenceSha256',
    'rangeStartReceiveTimeMs',
    'rangeEndReceiveTimeMs',
] as const);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const TRADE_DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const GAP_KIND_SET = new Set<SmartOrderTrailingGapKind>(
    SMART_ORDER_TRAILING_GAP_KINDS,
);

const issuedUiContinuityEvidence = new WeakSet<object>();
const consumedUiContinuityEvidence = new WeakSet<object>();
const currentObservationByUiContinuityEvidence = new WeakMap<
    object,
    EligibleQuoteObservation
>();
const currentUiContinuityEvidenceByScope = new Map<
    string,
    SmartOrderTrailingUiContinuityEvidence
>();

function snapshotExactDataProperties<
    Keys extends readonly string[],
>(
    value: unknown,
    keys: Keys,
    label: string,
): Readonly<Record<Keys[number], unknown>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} schema is invalid`);
    }
    let ownKeys: PropertyKey[];
    let descriptors: PropertyDescriptorMap;
    try {
        if (utilTypes.isProxy(value)) {
            throw new TypeError(`${label} Proxy inputs are forbidden`);
        }
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} schema is invalid`);
    }
    if (
        ownKeys.some((key) => typeof key !== 'string') ||
        ownKeys.length !== keys.length ||
        [...keys].some((key) => !ownKeys.includes(key))
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use own data properties`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot) as Readonly<
        Record<Keys[number], unknown>
    >;
}

function token(value: unknown, label: string): string {
    if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
        throw new TypeError(`${label} must be a bounded canonical token`);
    }
    return value;
}

function sha256(value: unknown, label: string): Sha256 {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
        throw new TypeError(`${label} must be a sha256 digest`);
    }
    return value as Sha256;
}

function positiveSafeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new TypeError(`${label} must be a positive safe integer`);
    }
    return value as number;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value as number;
}

function normalizeBinding(value: unknown): SmartOrderTrailingObservationBinding {
    const input = snapshotExactDataProperties(
        value,
        BINDING_KEYS,
        'trailing observation binding',
    );
    const tradeDate = token(input.tradeDate, 'tradeDate');
    if (!TRADE_DATE_PATTERN.test(tradeDate)) {
        throw new TypeError('tradeDate must use YYYY-MM-DD');
    }
    if (input.field !== 'last_price') {
        throw new TypeError('trailing observation field must be last_price');
    }
    return Object.freeze({
        strategyId: token(input.strategyId, 'strategyId'),
        strategyDefinitionHash: sha256(
            input.strategyDefinitionHash,
            'strategyDefinitionHash',
        ),
        confirmationHash: sha256(input.confirmationHash, 'confirmationHash'),
        armGeneration: positiveSafeInteger(
            input.armGeneration,
            'armGeneration',
        ),
        strategyRevision: positiveSafeInteger(
            input.strategyRevision,
            'strategyRevision',
        ),
        runtimeEpochId: token(input.runtimeEpochId, 'runtimeEpochId'),
        tradeDate,
        contractKey: token(input.contractKey, 'contractKey'),
        field: 'last_price' as const,
        streamEpoch: token(input.streamEpoch, 'streamEpoch'),
        lastObservationId: token(
            input.lastObservationId,
            'lastObservationId',
        ),
        lastObservationHeadRevision: positiveSafeInteger(
            input.lastObservationHeadRevision,
            'lastObservationHeadRevision',
        ),
        lastObservationSequence: nonNegativeSafeInteger(
            input.lastObservationSequence,
            'lastObservationSequence',
        ),
        extremeRevision: positiveSafeInteger(
            input.extremeRevision,
            'extremeRevision',
        ),
        savedExtremeSha256: sha256(
            input.savedExtremeSha256,
            'savedExtremeSha256',
        ),
    });
}

function normalizeGapSignal(value: unknown): SmartOrderTrailingGapSignal {
    const input = snapshotExactDataProperties(
        value,
        GAP_SIGNAL_KEYS,
        'trailing gap signal',
    );
    if (input.sessionPhase !== 'trading_session') {
        throw new TypeError('trailing gap signal must be in trading_session');
    }
    if (
        typeof input.gapKind !== 'string' ||
        !GAP_KIND_SET.has(input.gapKind as SmartOrderTrailingGapKind)
    ) {
        throw new TypeError('trailing gap kind is invalid');
    }
    return Object.freeze({
        signalId: token(input.signalId, 'gap signalId'),
        signalSha256: sha256(input.signalSha256, 'gap signalSha256'),
        sessionPhase: 'trading_session' as const,
        gapKind: input.gapKind as SmartOrderTrailingGapKind,
        runtimeEpochId: token(input.runtimeEpochId, 'gap runtimeEpochId'),
        streamEpoch: token(input.streamEpoch, 'gap streamEpoch'),
        detectedAtReceiveTimeMs: nonNegativeSafeInteger(
            input.detectedAtReceiveTimeMs,
            'gap detectedAtReceiveTimeMs',
        ),
    });
}

function digestCanonical(value: CanonicalObject): Sha256 {
    return `sha256:${smartOrderSha256HexSync(stableSerializeCanonical(value))}`;
}

function bindingDigest(binding: SmartOrderTrailingObservationBinding): Sha256 {
    return digestCanonical(binding as unknown as CanonicalObject);
}

function gapSignalDigest(signal: SmartOrderTrailingGapSignal): Sha256 {
    return digestCanonical(signal as unknown as CanonicalObject);
}

function evidenceScope(
    bindingSha256: Sha256,
    signalSha256: Sha256,
): string {
    return `${bindingSha256}|${signalSha256}`;
}

function manualDecision(
    decisionCode: Exclude<
        SmartOrderTrailingGapDecision['decisionCode'],
        'ui_disconnect_verified_no_observation_gap'
    >,
    bindingSha256: Sha256 | null,
    gapSignalSha256: Sha256 | null,
): SmartOrderTrailingGapDecision {
    return Object.freeze({
        schemaVersion: SMART_ORDER_TRAILING_GAP_DECISION_SCHEMA_VERSION,
        policyVersion: SMART_ORDER_TRAILING_GAP_POLICY_VERSION,
        classification: 'manual_intervention_required' as const,
        decisionCode,
        bindingSha256,
        gapSignalSha256,
        strategyAction: 'enter_manual_intervention' as const,
        transitionReasonCode: 'TRAILING_GAP_EXTREME_UNKNOWN' as const,
        extremeAction: 'freeze_for_audit' as const,
        historicalTicksUse: 'audit_only' as const,
        historicalTicksCanUnlock: false as const,
        historicalTicksCanResetExtreme: false as const,
        automaticUnlockAllowed: false as const,
        automaticRearmAllowed: false as const,
        dispatchAllowed: false as const,
        grantsBrokerWriteAuthority: false as const,
    });
}

function retainedDecision(
    bindingSha256: Sha256,
    gapSignalSha256: Sha256,
): SmartOrderTrailingGapDecision {
    return Object.freeze({
        schemaVersion: SMART_ORDER_TRAILING_GAP_DECISION_SCHEMA_VERSION,
        policyVersion: SMART_ORDER_TRAILING_GAP_POLICY_VERSION,
        classification: 'verified_ui_disconnect_continuity' as const,
        decisionCode: 'ui_disconnect_verified_no_observation_gap' as const,
        bindingSha256,
        gapSignalSha256,
        strategyAction: 'retain_existing_trailing_state' as const,
        transitionReasonCode: null,
        extremeAction: 'preserve_existing' as const,
        historicalTicksUse: 'audit_only' as const,
        historicalTicksCanUnlock: false as const,
        historicalTicksCanResetExtreme: false as const,
        automaticUnlockAllowed: false as const,
        automaticRearmAllowed: false as const,
        dispatchAllowed: false as const,
        grantsBrokerWriteAuthority: false as const,
    });
}

export function isVerifierIssuedTrailingUiContinuityEvidence(
    value: unknown,
): value is SmartOrderTrailingUiContinuityEvidence {
    return Boolean(
        value &&
            typeof value === 'object' &&
            Object.isFrozen(value) &&
            issuedUiContinuityEvidence.has(value),
    );
}

/**
 * Pure policy projection. It never mutates a Strategy or extreme and never
 * grants dispatch/broker authority. Any trading-session observation gap is
 * manual by default. The sole carry-forward exception requires an unconsumed,
 * verifier-issued UI-disconnect continuity object for the exact current
 * Strategy/arm/Runtime/stream/extreme lineage.
 */
export function evaluateSmartOrderTrailingObservationGap(input: unknown): SmartOrderTrailingGapDecision {
    let binding: SmartOrderTrailingObservationBinding;
    let gapSignal: SmartOrderTrailingGapSignal;
    let candidateEvidence: unknown;
    try {
        const snapshot = snapshotExactDataProperties(
            input,
            EVALUATION_KEYS,
            'trailing gap evaluation',
        );
        binding = normalizeBinding(snapshot.binding);
        gapSignal = normalizeGapSignal(snapshot.gapSignal);
        candidateEvidence = snapshot.uiDisconnectEvidence;
    } catch {
        return manualDecision('invalid_policy_input', null, null);
    }

    const bindingSha256 = bindingDigest(binding);
    const signalSha256 = gapSignalDigest(gapSignal);
    if (
        gapSignal.runtimeEpochId !== binding.runtimeEpochId ||
        gapSignal.streamEpoch !== binding.streamEpoch
    ) {
        return manualDecision(
            'ui_disconnect_lineage_mismatch',
            bindingSha256,
            signalSha256,
        );
    }
    if (gapSignal.gapKind !== 'ui_disconnect') {
        return manualDecision(
            'trading_session_observation_gap',
            bindingSha256,
            signalSha256,
        );
    }
    if (candidateEvidence === null) {
        return manualDecision(
            'ui_disconnect_continuity_unproven',
            bindingSha256,
            signalSha256,
        );
    }
    if (!isVerifierIssuedTrailingUiContinuityEvidence(candidateEvidence)) {
        return manualDecision(
            'ui_disconnect_evidence_untrusted',
            bindingSha256,
            signalSha256,
        );
    }
    if (consumedUiContinuityEvidence.has(candidateEvidence)) {
        return manualDecision(
            'ui_disconnect_evidence_replayed',
            bindingSha256,
            signalSha256,
        );
    }
    const scope = evidenceScope(bindingSha256, signalSha256);
    const evidenceObservation =
        currentObservationByUiContinuityEvidence.get(candidateEvidence);
    if (
        currentUiContinuityEvidenceByScope.get(scope) !== candidateEvidence ||
        !evidenceObservation ||
        !isQuoteObservationCurrent(evidenceObservation)
    ) {
        return manualDecision(
            'ui_disconnect_evidence_superseded',
            bindingSha256,
            signalSha256,
        );
    }
    if (
        candidateEvidence.bindingSha256 !== bindingSha256 ||
        candidateEvidence.gapSignalSha256 !== signalSha256 ||
        candidateEvidence.streamEpoch !== binding.streamEpoch ||
        candidateEvidence.tradeDate !== binding.tradeDate ||
        candidateEvidence.currentObservationId !== binding.lastObservationId ||
        candidateEvidence.toSequence !== binding.lastObservationSequence
    ) {
        return manualDecision(
            'ui_disconnect_lineage_mismatch',
            bindingSha256,
            signalSha256,
        );
    }
    consumedUiContinuityEvidence.add(candidateEvidence);
    currentUiContinuityEvidenceByScope.delete(scope);
    return retainedDecision(bindingSha256, signalSha256);
}

/** Historical ticks are deliberately an audit projection only. */
export function createSmartOrderTrailingHistoricalAudit(input: unknown): SmartOrderTrailingHistoricalAudit {
    const snapshot = snapshotExactDataProperties(
        input,
        HISTORICAL_AUDIT_KEYS,
        'trailing historical audit',
    );
    const binding = normalizeBinding(snapshot.binding);
    const bindingSha256 = bindingDigest(binding);
    const historicalEvidenceSha256 = sha256(
        snapshot.historicalEvidenceSha256,
        'historicalEvidenceSha256',
    );
    const rangeStartReceiveTimeMs = nonNegativeSafeInteger(
        snapshot.rangeStartReceiveTimeMs,
        'rangeStartReceiveTimeMs',
    );
    const rangeEndReceiveTimeMs = nonNegativeSafeInteger(
        snapshot.rangeEndReceiveTimeMs,
        'rangeEndReceiveTimeMs',
    );
    if (rangeEndReceiveTimeMs < rangeStartReceiveTimeMs) {
        throw new TypeError('historical audit range cannot move backwards');
    }
    const auditId = digestCanonical({
        schemaVersion: SMART_ORDER_TRAILING_HISTORICAL_AUDIT_SCHEMA_VERSION,
        policyVersion: SMART_ORDER_TRAILING_GAP_POLICY_VERSION,
        bindingSha256,
        historicalEvidenceSha256,
        rangeStartReceiveTimeMs,
        rangeEndReceiveTimeMs,
    });
    return Object.freeze({
        schemaVersion: SMART_ORDER_TRAILING_HISTORICAL_AUDIT_SCHEMA_VERSION,
        policyVersion: SMART_ORDER_TRAILING_GAP_POLICY_VERSION,
        auditId,
        bindingSha256,
        historicalEvidenceSha256,
        rangeStartReceiveTimeMs,
        rangeEndReceiveTimeMs,
        use: 'audit_only' as const,
        strategyStateMutationAllowed: false as const,
        extremeMutationAllowed: false as const,
        automaticUnlockAllowed: false as const,
        automaticRearmAllowed: false as const,
        grantsBrokerWriteAuthority: false as const,
    });
}

function quoteContinuityDigest(
    evidence: QuoteContinuityEvidence,
    previous: QuoteObservationCursor,
    current: EligibleQuoteObservation,
): Sha256 {
    return digestCanonical({
        continuity: evidence.continuity,
        reason: evidence.reason,
        previousObservationId: evidence.previousObservationId,
        currentObservationId: evidence.currentObservationId,
        contractKey: evidence.contractKey,
        field: evidence.field,
        fromStreamEpoch: evidence.fromStreamEpoch,
        toStreamEpoch: evidence.toStreamEpoch,
        previousHeadRevision: previous.headRevision,
        currentHeadRevision: current.headRevision,
        previousSequence: previous.sequence,
        currentSequence: current.sequence,
    });
}

function issueVerifiedUiDisconnectContinuityForTest(
    input: unknown,
): SmartOrderTrailingUiContinuityEvidence {
    const snapshot = snapshotExactDataProperties(
        input,
        UI_EVIDENCE_ISSUER_KEYS,
        'trailing UI continuity verifier input',
    );
    const binding = normalizeBinding(snapshot.binding);
    const gapSignal = normalizeGapSignal(snapshot.gapSignal);
    if (gapSignal.gapKind !== 'ui_disconnect') {
        throw new TypeError('UI continuity evidence requires ui_disconnect');
    }
    if (
        gapSignal.runtimeEpochId !== binding.runtimeEpochId ||
        gapSignal.streamEpoch !== binding.streamEpoch
    ) {
        throw new TypeError('UI continuity evidence lineage mismatch');
    }
    if (!isTrustedQuoteContinuityEvidence(snapshot.continuityEvidence)) {
        throw new TypeError('quote continuity evidence is not verifier-issued');
    }
    if (!isQuoteObservationCurrent(snapshot.currentObservation)) {
        throw new TypeError('current quote observation is not verifier-issued');
    }
    const continuityEvidence = snapshot.continuityEvidence;
    const currentObservation = snapshot.currentObservation;
    const previousCursor = restoreQuoteObservationCursor(
        snapshot.previousCursor,
    );
    const verifierRevision = positiveSafeInteger(
        snapshot.verifierRevision,
        'verifierRevision',
    );
    if (
        continuityEvidence.continuity !== 'continuous' ||
        continuityEvidence.reason !== 'contiguous' ||
        continuityEvidence.previousObservationId !==
            previousCursor.observationId ||
        continuityEvidence.currentObservationId !==
            currentObservation.observationId ||
        continuityEvidence.contractKey !== binding.contractKey ||
        continuityEvidence.field !== 'last_price' ||
        continuityEvidence.fromStreamEpoch !== binding.streamEpoch ||
        continuityEvidence.toStreamEpoch !== binding.streamEpoch ||
        previousCursor.contractKey !== binding.contractKey ||
        previousCursor.field !== 'last_price' ||
        previousCursor.tradeDate !== binding.tradeDate ||
        previousCursor.streamEpoch !== binding.streamEpoch ||
        currentObservation.contractKey !== binding.contractKey ||
        currentObservation.field !== 'last_price' ||
        currentObservation.tradeDate !== binding.tradeDate ||
        currentObservation.streamEpoch !== binding.streamEpoch ||
        currentObservation.observationId !== binding.lastObservationId ||
        currentObservation.headRevision !==
            binding.lastObservationHeadRevision ||
        currentObservation.sequence !== binding.lastObservationSequence ||
        previousCursor.sequence === null ||
        currentObservation.sequence === null ||
        currentObservation.sequence !== previousCursor.sequence + 1 ||
        currentObservation.headRevision !== previousCursor.headRevision + 1 ||
        currentObservation.exchangeTimeMs < previousCursor.exchangeTimeMs ||
        currentObservation.receiveTimeMs < previousCursor.receiveTimeMs ||
        gapSignal.detectedAtReceiveTimeMs < previousCursor.receiveTimeMs ||
        gapSignal.detectedAtReceiveTimeMs > currentObservation.receiveTimeMs
    ) {
        throw new TypeError(
            'UI disconnect cannot prove complete observation continuity',
        );
    }

    const bindingSha256 = bindingDigest(binding);
    const gapSignalSha256 = gapSignalDigest(gapSignal);
    const quoteContinuitySha256 = quoteContinuityDigest(
        continuityEvidence,
        previousCursor,
        currentObservation,
    );
    const evidenceId = digestCanonical({
        schemaVersion:
            SMART_ORDER_TRAILING_UI_CONTINUITY_EVIDENCE_SCHEMA_VERSION,
        policyVersion: SMART_ORDER_TRAILING_GAP_POLICY_VERSION,
        bindingSha256,
        gapSignalSha256,
        quoteContinuitySha256,
        verifierRevision,
    });
    const evidence = Object.freeze({
        schemaVersion:
            SMART_ORDER_TRAILING_UI_CONTINUITY_EVIDENCE_SCHEMA_VERSION,
        policyVersion: SMART_ORDER_TRAILING_GAP_POLICY_VERSION,
        evidenceId,
        verifierRevision,
        bindingSha256,
        gapSignalSha256,
        quoteContinuitySha256,
        previousObservationId: previousCursor.observationId,
        currentObservationId: currentObservation.observationId,
        fromSequence: previousCursor.sequence,
        toSequence: currentObservation.sequence,
        streamEpoch: binding.streamEpoch,
        tradeDate: binding.tradeDate,
        scope: 'preserve_existing_extreme_only' as const,
        historicalTicksUsed: false as const,
        canResetExtreme: false as const,
        canUnlockManualIntervention: false as const,
        grantsBrokerWriteAuthority: false as const,
    }) as SmartOrderTrailingUiContinuityEvidence;
    issuedUiContinuityEvidence.add(evidence);
    currentObservationByUiContinuityEvidence.set(
        evidence,
        currentObservation,
    );
    currentUiContinuityEvidenceByScope.set(
        evidenceScope(bindingSha256, gapSignalSha256),
        evidence,
    );
    return evidence;
}

export type SmartOrderTrailingGapTestOnlyIssuer = Readonly<{
    issueVerifiedUiDisconnectContinuity: typeof issueVerifiedUiDisconnectContinuityForTest;
}>;

/** Production builds expose no generic continuity issuer. */
export const SMART_ORDER_TRAILING_GAP_TEST_ONLY:
    | SmartOrderTrailingGapTestOnlyIssuer
    | undefined = SMART_ORDER_DOMAIN_TEST_MODE
    ? Object.freeze({
          issueVerifiedUiDisconnectContinuity:
              issueVerifiedUiDisconnectContinuityForTest,
      })
    : undefined;
