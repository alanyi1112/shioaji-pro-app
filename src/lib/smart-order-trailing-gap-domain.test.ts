import { beforeEach, describe, expect, it } from 'vitest';
import {
    SMART_ORDER_OBSERVATION_TEST_ONLY,
    type EligibleQuoteObservation,
    type QuoteContinuityEvidence,
    type QuoteObservationCandidate,
    type QuoteObservationCursor,
} from './smart-order-observation-domain';
import {
    SMART_ORDER_TRAILING_GAP_KINDS,
    SMART_ORDER_TRAILING_GAP_TEST_ONLY,
    createSmartOrderTrailingHistoricalAudit,
    evaluateSmartOrderTrailingObservationGap,
    isVerifierIssuedTrailingUiContinuityEvidence,
    type SmartOrderTrailingGapSignal,
    type SmartOrderTrailingObservationBinding,
    type SmartOrderTrailingUiContinuityEvidence,
} from './smart-order-trailing-gap-domain';

const NOW = 1_800_000_010_000;
const TRADE_DATE = '2027-01-15';
const CONTRACT = 'TSE:STK:2330';
const STREAM_EPOCH = 'stream-epoch-1';
const RUNTIME_EPOCH = 'runtime-epoch-1';
const HASH_A = `sha256:${'a'.repeat(64)}` as const;
const HASH_B = `sha256:${'b'.repeat(64)}` as const;
const HASH_C = `sha256:${'c'.repeat(64)}` as const;
const HASH_D = `sha256:${'d'.repeat(64)}` as const;

function quoteIssuer() {
    if (!SMART_ORDER_OBSERVATION_TEST_ONLY) {
        throw new Error('quote test-only issuer is unavailable');
    }
    return SMART_ORDER_OBSERVATION_TEST_ONLY;
}

function trailingIssuer() {
    if (!SMART_ORDER_TRAILING_GAP_TEST_ONLY) {
        throw new Error('trailing gap test-only issuer is unavailable');
    }
    return SMART_ORDER_TRAILING_GAP_TEST_ONLY;
}

const quotes = quoteIssuer();
const trailing = trailingIssuer();

beforeEach(() => {
    quotes.resetQuoteObservationHeads();
});

function binding(
    current: QuoteObservationCursor,
    overrides: Partial<SmartOrderTrailingObservationBinding> = {},
): SmartOrderTrailingObservationBinding {
    if (current.sequence === null) {
        throw new Error('binding fixture requires sequence evidence');
    }
    return {
        strategyId: 'trailing-strategy-1',
        strategyDefinitionHash: HASH_A,
        confirmationHash: HASH_B,
        armGeneration: 2,
        strategyRevision: 7,
        runtimeEpochId: RUNTIME_EPOCH,
        tradeDate: TRADE_DATE,
        contractKey: CONTRACT,
        field: 'last_price',
        streamEpoch: STREAM_EPOCH,
        lastObservationId: current.observationId,
        lastObservationHeadRevision: current.headRevision,
        lastObservationSequence: current.sequence,
        extremeRevision: 4,
        savedExtremeSha256: HASH_C,
        ...overrides,
    };
}

function signal(
    overrides: Partial<SmartOrderTrailingGapSignal> = {},
): SmartOrderTrailingGapSignal {
    return {
        signalId: 'ui-disconnect-signal-1',
        signalSha256: HASH_D,
        sessionPhase: 'trading_session',
        gapKind: 'ui_disconnect',
        runtimeEpochId: RUNTIME_EPOCH,
        streamEpoch: STREAM_EPOCH,
        detectedAtReceiveTimeMs: NOW - 15,
        ...overrides,
    };
}

function candidate(
    observationId: string,
    sequence: number | null,
    exchangeTimeMs: number,
    receiveTimeMs: number,
): QuoteObservationCandidate {
    return {
        observationId,
        contractKey: CONTRACT,
        field: 'last_price',
        value: '110',
        tradeDate: TRADE_DATE,
        exchangeTimeMs,
        receiveTimeMs,
        streamEpoch: STREAM_EPOCH,
        sequence,
        delivery: 'subscription',
        mappingVerified: true,
        simtrade: false,
        intradayOdd: false,
    };
}

function quotePair(
    overrides: Readonly<{
        firstSequence?: number | null;
        secondSequence?: number | null;
    }> = {},
): Readonly<{
    previousCursor: QuoteObservationCursor;
    currentObservation: EligibleQuoteObservation;
    continuityEvidence: QuoteContinuityEvidence;
}> {
    const lineageEvidence = quotes.issueQuoteStreamLineageEvidence({
        contractKey: CONTRACT,
        field: 'last_price',
        tradeDate: TRADE_DATE,
        streamEpoch: STREAM_EPOCH,
        streamGeneration: 1,
    });
    const timeEvidence = quotes.issueTimeEvidence(NOW);
    const previous = quotes.qualifyQuoteObservation(
        candidate(
            'observation-before-ui-disconnect',
            overrides.firstSequence === undefined
                ? 40
                : overrides.firstSequence,
            NOW - 30,
            NOW - 20,
        ),
        { lineageEvidence, timeEvidence },
    );
    if (!previous.eligible) throw new Error(previous.reason);
    const current = quotes.qualifyQuoteObservation(
        candidate(
            'observation-after-ui-disconnect',
            overrides.secondSequence === undefined
                ? 41
                : overrides.secondSequence,
            NOW - 10,
            NOW - 5,
        ),
        { lineageEvidence, timeEvidence },
    );
    if (!current.eligible) throw new Error(current.reason);
    return {
        previousCursor: previous.cursor,
        currentObservation: current.observation,
        continuityEvidence: quotes.issueContinuityEvidence({
            previousCursor: previous.cursor,
            currentObservation: current.observation,
        }),
    };
}

function verifiedUiEvidence(
    pair = quotePair(),
    bindingOverrides: Partial<SmartOrderTrailingObservationBinding> = {},
    signalOverrides: Partial<SmartOrderTrailingGapSignal> = {},
): Readonly<{
    binding: SmartOrderTrailingObservationBinding;
    gapSignal: SmartOrderTrailingGapSignal;
    evidence: SmartOrderTrailingUiContinuityEvidence;
}> {
    const currentBinding = binding(
        pair.currentObservation,
        bindingOverrides,
    );
    const gapSignal = signal(signalOverrides);
    return {
        binding: currentBinding,
        gapSignal,
        evidence: trailing.issueVerifiedUiDisconnectContinuity({
            binding: currentBinding,
            gapSignal,
            continuityEvidence: pair.continuityEvidence,
            previousCursor: pair.previousCursor,
            currentObservation: pair.currentObservation,
            verifierRevision: 1,
        }),
    };
}

describe('trailing observation gap fail-closed policy', () => {
    it.each(
        SMART_ORDER_TRAILING_GAP_KINDS.filter(
            (kind) => kind !== 'ui_disconnect',
        ),
    )('forces trading-session %s into manual intervention', (gapKind) => {
        const pair = quotePair();
        const currentBinding = binding(pair.currentObservation);
        const result = evaluateSmartOrderTrailingObservationGap({
            binding: currentBinding,
            gapSignal: signal({ gapKind }),
            uiDisconnectEvidence: null,
        });
        expect(result).toMatchObject({
            classification: 'manual_intervention_required',
            decisionCode: 'trading_session_observation_gap',
            strategyAction: 'enter_manual_intervention',
            transitionReasonCode: 'TRAILING_GAP_EXTREME_UNKNOWN',
            extremeAction: 'freeze_for_audit',
            automaticUnlockAllowed: false,
            automaticRearmAllowed: false,
            dispatchAllowed: false,
            grantsBrokerWriteAuthority: false,
        });
    });

    it('fails an unproven UI disconnect closed', () => {
        const pair = quotePair();
        const result = evaluateSmartOrderTrailingObservationGap({
            binding: binding(pair.currentObservation),
            gapSignal: signal(),
            uiDisconnectEvidence: null,
        });
        expect(result).toMatchObject({
            decisionCode: 'ui_disconnect_continuity_unproven',
            strategyAction: 'enter_manual_intervention',
            transitionReasonCode: 'TRAILING_GAP_EXTREME_UNKNOWN',
        });
    });

    it('carries only the existing extreme for one verifier-issued contiguous UI disconnect', () => {
        const fixture = verifiedUiEvidence();
        expect(isVerifierIssuedTrailingUiContinuityEvidence(fixture.evidence)).toBe(
            true,
        );
        expect(fixture.evidence).toMatchObject({
            fromSequence: 40,
            toSequence: 41,
            scope: 'preserve_existing_extreme_only',
            historicalTicksUsed: false,
            canResetExtreme: false,
            canUnlockManualIntervention: false,
            grantsBrokerWriteAuthority: false,
        });

        const result = evaluateSmartOrderTrailingObservationGap({
            binding: fixture.binding,
            gapSignal: fixture.gapSignal,
            uiDisconnectEvidence: fixture.evidence,
        });
        expect(result).toMatchObject({
            classification: 'verified_ui_disconnect_continuity',
            decisionCode: 'ui_disconnect_verified_no_observation_gap',
            strategyAction: 'retain_existing_trailing_state',
            transitionReasonCode: null,
            extremeAction: 'preserve_existing',
            historicalTicksUse: 'audit_only',
            historicalTicksCanUnlock: false,
            historicalTicksCanResetExtreme: false,
            automaticUnlockAllowed: false,
            automaticRearmAllowed: false,
            dispatchAllowed: false,
            grantsBrokerWriteAuthority: false,
        });
    });

    it('rejects replay and a cloned verifier object', () => {
        const replayFixture = verifiedUiEvidence();
        const input = {
            binding: replayFixture.binding,
            gapSignal: replayFixture.gapSignal,
            uiDisconnectEvidence: replayFixture.evidence,
        };
        expect(
            evaluateSmartOrderTrailingObservationGap(input).decisionCode,
        ).toBe('ui_disconnect_verified_no_observation_gap');
        expect(
            evaluateSmartOrderTrailingObservationGap(input).decisionCode,
        ).toBe('ui_disconnect_evidence_replayed');

        quotes.resetQuoteObservationHeads();
        const cloneFixture = verifiedUiEvidence();
        const clone = { ...cloneFixture.evidence };
        expect(isVerifierIssuedTrailingUiContinuityEvidence(clone)).toBe(false);
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: cloneFixture.binding,
                gapSignal: cloneFixture.gapSignal,
                uiDisconnectEvidence: clone,
            }).decisionCode,
        ).toBe('ui_disconnect_evidence_untrusted');
    });

    it('rejects a continuity proof after the verified quote head is superseded', () => {
        const fixture = verifiedUiEvidence();
        const lineageEvidence = quotes.issueQuoteStreamLineageEvidence({
            contractKey: CONTRACT,
            field: 'last_price',
            tradeDate: TRADE_DATE,
            streamEpoch: STREAM_EPOCH,
            streamGeneration: 1,
        });
        const newer = quotes.qualifyQuoteObservation(
            candidate(
                'observation-after-continuity-proof',
                42,
                NOW - 2,
                NOW - 1,
            ),
            {
                lineageEvidence,
                timeEvidence: quotes.issueTimeEvidence(NOW),
            },
        );
        if (!newer.eligible) throw new Error(newer.reason);
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: fixture.binding,
                gapSignal: fixture.gapSignal,
                uiDisconnectEvidence: fixture.evidence,
            }).decisionCode,
        ).toBe('ui_disconnect_evidence_superseded');
    });

    it('rejects superseded proof, old arm lineage, and a different gap signal', () => {
        const pair = quotePair();
        const first = verifiedUiEvidence(pair);
        const second = verifiedUiEvidence(pair);
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: first.binding,
                gapSignal: first.gapSignal,
                uiDisconnectEvidence: first.evidence,
            }).decisionCode,
        ).toBe('ui_disconnect_evidence_superseded');
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: second.binding,
                gapSignal: second.gapSignal,
                uiDisconnectEvidence: second.evidence,
            }).decisionCode,
        ).toBe('ui_disconnect_verified_no_observation_gap');

        quotes.resetQuoteObservationHeads();
        const oldLineage = verifiedUiEvidence();
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: { ...oldLineage.binding, armGeneration: 3 },
                gapSignal: oldLineage.gapSignal,
                uiDisconnectEvidence: oldLineage.evidence,
            }).strategyAction,
        ).toBe('enter_manual_intervention');

        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: oldLineage.binding,
                gapSignal: {
                    ...oldLineage.gapSignal,
                    signalId: 'ui-disconnect-signal-2',
                },
                uiDisconnectEvidence: oldLineage.evidence,
            }).strategyAction,
        ).toBe('enter_manual_intervention');
    });

    it('does not accept caller booleans, extra unlock flags, accessors, or Proxy reads', () => {
        const pair = quotePair();
        const currentBinding = binding(pair.currentObservation);
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: currentBinding,
                gapSignal: signal(),
                uiDisconnectEvidence: true,
            }).decisionCode,
        ).toBe('ui_disconnect_evidence_untrusted');
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: currentBinding,
                gapSignal: signal(),
                uiDisconnectEvidence: null,
                noGap: true,
            }).decisionCode,
        ).toBe('invalid_policy_input');

        let getterReads = 0;
        const accessorInput = {
            binding: currentBinding,
            gapSignal: signal(),
            uiDisconnectEvidence: null,
        };
        Object.defineProperty(accessorInput, 'uiDisconnectEvidence', {
            enumerable: true,
            configurable: true,
            get() {
                getterReads += 1;
                return { verified: true };
            },
        });
        expect(
            evaluateSmartOrderTrailingObservationGap(accessorInput).decisionCode,
        ).toBe('invalid_policy_input');
        expect(getterReads).toBe(0);

        let propertyReads = 0;
        let descriptorReads = 0;
        const proxiedBinding = new Proxy(currentBinding, {
            get(target, property, receiver) {
                propertyReads += 1;
                return Reflect.get(target, property, receiver);
            },
            ownKeys(target) {
                descriptorReads += 1;
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, property) {
                descriptorReads += 1;
                return Reflect.getOwnPropertyDescriptor(target, property);
            },
        });
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: proxiedBinding,
                gapSignal: signal(),
                uiDisconnectEvidence: null,
            }).decisionCode,
        ).toBe('invalid_policy_input');
        expect(propertyReads).toBe(0);
        expect(descriptorReads).toBe(0);
    });

    it('requires verifier-issued, consecutive current subscription observations', () => {
        const sequenceGap = quotePair({ secondSequence: 42 });
        expect(sequenceGap.continuityEvidence.continuity).toBe('gap');
        expect(() =>
            trailing.issueVerifiedUiDisconnectContinuity({
                binding: binding(sequenceGap.currentObservation),
                gapSignal: signal(),
                continuityEvidence: sequenceGap.continuityEvidence,
                previousCursor: sequenceGap.previousCursor,
                currentObservation: sequenceGap.currentObservation,
                verifierRevision: 1,
            }),
        ).toThrow('cannot prove complete observation continuity');

        quotes.resetQuoteObservationHeads();
        const noSequence = quotePair({
            firstSequence: null,
            secondSequence: null,
        });
        const syntheticBinding = {
            ...binding({ ...noSequence.currentObservation, sequence: 41 }),
            lastObservationId: noSequence.currentObservation.observationId,
            lastObservationHeadRevision:
                noSequence.currentObservation.headRevision,
        };
        expect(() =>
            trailing.issueVerifiedUiDisconnectContinuity({
                binding: syntheticBinding,
                gapSignal: signal(),
                continuityEvidence: noSequence.continuityEvidence,
                previousCursor: noSequence.previousCursor,
                currentObservation: noSequence.currentObservation,
                verifierRevision: 1,
            }),
        ).toThrow('cannot prove complete observation continuity');

        quotes.resetQuoteObservationHeads();
        const clonePair = quotePair();
        expect(() =>
            trailing.issueVerifiedUiDisconnectContinuity({
                binding: binding(clonePair.currentObservation),
                gapSignal: signal(),
                continuityEvidence: { ...clonePair.continuityEvidence },
                previousCursor: clonePair.previousCursor,
                currentObservation: clonePair.currentObservation,
                verifierRevision: 1,
            }),
        ).toThrow('not verifier-issued');
    });

    it('keeps historical ticks audit-only and outside the continuity decision schema', () => {
        const pair = quotePair();
        const currentBinding = binding(pair.currentObservation);
        const audit = createSmartOrderTrailingHistoricalAudit({
            binding: currentBinding,
            historicalEvidenceSha256: HASH_D,
            rangeStartReceiveTimeMs: NOW - 60_000,
            rangeEndReceiveTimeMs: NOW,
        });
        expect(Object.isFrozen(audit)).toBe(true);
        expect(audit).toMatchObject({
            use: 'audit_only',
            strategyStateMutationAllowed: false,
            extremeMutationAllowed: false,
            automaticUnlockAllowed: false,
            automaticRearmAllowed: false,
            grantsBrokerWriteAuthority: false,
        });
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: currentBinding,
                gapSignal: signal(),
                uiDisconnectEvidence: null,
                historicalAudit: audit,
            }).decisionCode,
        ).toBe('invalid_policy_input');
    });

    it('fails invalid session, epoch, and structural inputs closed', () => {
        const pair = quotePair();
        const currentBinding = binding(pair.currentObservation);
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: currentBinding,
                gapSignal: {
                    ...signal(),
                    sessionPhase: 'closed_session',
                },
                uiDisconnectEvidence: null,
            }).decisionCode,
        ).toBe('invalid_policy_input');
        expect(
            evaluateSmartOrderTrailingObservationGap({
                binding: currentBinding,
                gapSignal: signal({ runtimeEpochId: 'old-runtime-epoch' }),
                uiDisconnectEvidence: null,
            }).decisionCode,
        ).toBe('ui_disconnect_lineage_mismatch');
        expect(
            evaluateSmartOrderTrailingObservationGap(null).strategyAction,
        ).toBe('enter_manual_intervention');
    });
});
