import { beforeEach, describe, expect, it } from 'vitest';
import {
    domainId,
    stableSerializeCanonical,
    type CanonicalObject,
} from './smart-order-domain';
import { decimalString } from './smart-order-domain-money';
import {
    SMART_ORDER_ACTIVATION_TEST_ONLY,
    advanceEdgeActivationTracker,
    compareDeterministicActivationIdentity,
    createEdgeActivationTracker,
    deriveEdgeTrackerActivationConfirmationHash,
    deriveEdgeActivationIdentity,
    deriveScheduleSlotActivationIdentity,
    isTrustedEdgeTrackerRepositoryHeadEvidence,
    restoreEdgeActivationTracker,
    type EdgeActivationTracker,
    type EdgeTrackerRestoreExpectation,
    type EdgeTrackerInput,
    type StrategyActivationIdentity,
} from './smart-order-activation-domain';
import {
    SMART_ORDER_OBSERVATION_TEST_ONLY,
    SMART_ORDER_GROUP_EVALUATION_CURSOR_HASH_DOMAIN,
    SMART_ORDER_QUOTE_TIME_EVIDENCE_TTL_MS,
    compareGroupEvaluationCursors,
    deriveGroupEvaluationCursor,
    deriveQuoteConditionDefinitionHash,
    deriveQuoteConditionGroupDefinitionHash,
    restoreGroupEvaluationCursor,
    smartOrderSha256HexSync,
    verifyAndConditionEvaluation,
    verifyOrConditionEvaluation,
    verifyQuoteComparatorEvaluation,
    type EligibleQuoteObservation,
    type QuoteComparatorEvaluationEvidence,
    type QuoteConditionEvaluationEvidence,
    type QuoteConditionDefinitionEvidence,
    type QuoteGroupEvaluationEvidence,
    type GroupEvaluationContinuityEvidence,
    type QuoteTimeEvidence,
} from './smart-order-observation-domain';

const NOW = 1_800_000_010_000;
const TRADE_DATE = '2027-01-15';
const CONTRACT = 'TSE:STK:2330';
const EPOCH = 'stream-epoch-1';
const RECORD_KEY = 'edge-tracker-1';
const CONFIRMATION_HASH = `sha256:${'b'.repeat(64)}` as const;
const REPOSITORY_OWNER_ID = 'smart-order-repository-1';

const identity: StrategyActivationIdentity = {
    strategyId: domainId('strategy-1', 'StrategyId'),
    strategyDefinitionHash: `sha256:${'a'.repeat(64)}`,
};

function observationTestIssuer() {
    if (!SMART_ORDER_OBSERVATION_TEST_ONLY) {
        throw new Error('test-only quote evidence issuer is unavailable');
    }
    return SMART_ORDER_OBSERVATION_TEST_ONLY;
}

function activationTestIssuer() {
    if (!SMART_ORDER_ACTIVATION_TEST_ONLY) {
        throw new Error('test-only persistence issuer is unavailable');
    }
    return SMART_ORDER_ACTIVATION_TEST_ONLY;
}

const quoteIssuer = observationTestIssuer();
const persistenceIssuer = activationTestIssuer();

beforeEach(() => {
    quoteIssuer.resetQuoteObservationHeads();
    quoteIssuer.resetConditionDefinitionHeads();
    persistenceIssuer.resetEdgeTrackerRepositoryHeads();
});

function conditionDefinition(
    conditionId: string,
    overrides: Partial<{
        strategyId: string;
        repositoryOwnerId: string;
        repositoryRevision: number;
        strategyDefinitionHash: `sha256:${string}`;
        confirmationHash: `sha256:${string}`;
        armGeneration: number;
        contractKey: string;
        field: 'last_price' | 'bid_price' | 'ask_price';
        comparator: 'gte' | 'lte';
        threshold: ReturnType<typeof decimalString>;
        mappingRevision: string;
        conditionDefinitionHash: `sha256:${string}`;
    }> = {},
): QuoteConditionDefinitionEvidence {
    const { conditionDefinitionHash, ...canonicalOverrides } = overrides;
    const canonical = {
        conditionId,
        strategyId: identity.strategyId,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        repositoryRevision: 1,
        strategyDefinitionHash: identity.strategyDefinitionHash,
        confirmationHash: CONFIRMATION_HASH,
        armGeneration: 2,
        contractKey: CONTRACT,
        field: 'last_price' as const,
        comparator: 'gte' as const,
        threshold: decimalString('100'),
        mappingRevision: 'mapping-v1',
        ...canonicalOverrides,
    };
    return quoteIssuer.issueConditionDefinitionEvidence({
        ...canonical,
        conditionDefinitionHash:
            conditionDefinitionHash ??
            deriveQuoteConditionDefinitionHash(canonical),
    });
}

const MAIN_CONDITION_DEFINITION_HASH =
    deriveQuoteConditionDefinitionHash({
        conditionId: 'condition-main',
        strategyId: identity.strategyId,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        repositoryRevision: 1,
        strategyDefinitionHash: identity.strategyDefinitionHash,
        confirmationHash: CONFIRMATION_HASH,
        armGeneration: 2,
        contractKey: CONTRACT,
        field: 'last_price',
        comparator: 'gte',
        threshold: decimalString('100'),
        mappingRevision: 'mapping-v1',
    });

function time(nowMs = NOW): QuoteTimeEvidence {
    return quoteIssuer.issueTimeEvidence(nowMs);
}

type ObservationOptions = Readonly<{
    epoch?: string;
    tradeDate?: string;
    observationId?: string;
    value?: string;
    exchangeTimeMs?: number;
    receiveTimeMs?: number;
    qualifyNowMs?: number;
    field?: 'last_price' | 'bid_price' | 'ask_price';
    streamGeneration?: number;
}>;

function observation(
    sequence: number,
    options: ObservationOptions = {},
): EligibleQuoteObservation {
    const epoch = options.epoch ?? EPOCH;
    const tradeDate = options.tradeDate ?? TRADE_DATE;
    const qualifyNowMs = options.qualifyNowMs ?? NOW;
    const field = options.field ?? 'last_price';
    const lineageEvidence = quoteIssuer.issueQuoteStreamLineageEvidence({
        contractKey: CONTRACT,
        field,
        tradeDate,
        streamEpoch: epoch,
        streamGeneration:
            options.streamGeneration ?? (epoch === EPOCH ? 1 : 2),
    });
    const result = quoteIssuer.qualifyQuoteObservation(
        {
            observationId: options.observationId ?? `obs-${sequence}`,
            contractKey: CONTRACT,
            field,
            value: options.value ?? '99',
            tradeDate,
            exchangeTimeMs:
                options.exchangeTimeMs ?? NOW - 1_000 + sequence,
            receiveTimeMs: options.receiveTimeMs ?? NOW - 500 + sequence,
            streamEpoch: epoch,
            sequence,
            delivery: 'subscription',
            mappingVerified: true,
            simtrade: false,
            intradayOdd: false,
        },
        {
            lineageEvidence,
            timeEvidence: time(qualifyNowMs),
        },
    );
    if (!result.eligible) throw new Error(`fixture rejected: ${result.reason}`);
    return result.observation;
}

function tracker(
    overrides: Partial<
        Pick<
            EdgeActivationTracker,
            | 'activationPolicy'
            | 'semantics'
            | 'armGeneration'
            | 'recordKey'
            | 'strategyDefinitionHash'
            | 'confirmationHash'
            | 'activationDefinitionHash'
            | 'activationConfirmationHash'
        >
    > = {},
): EdgeActivationTracker {
    const { activationConfirmationHash, ...armOverrides } = overrides;
    const canonicalArm = {
        recordKey: RECORD_KEY,
        strategyId: identity.strategyId,
        strategyDefinitionHash: identity.strategyDefinitionHash,
        confirmationHash: CONFIRMATION_HASH,
        activationDefinitionHash: MAIN_CONDITION_DEFINITION_HASH,
        tradeDate: TRADE_DATE,
        armGeneration: 2,
        activationPolicy: 'require_rearm' as const,
        semantics: 'level' as const,
        ...armOverrides,
    };
    const armEvidence = persistenceIssuer.issueEdgeTrackerArmEvidence({
        ...canonicalArm,
        activationConfirmationHash:
            activationConfirmationHash ??
            deriveEdgeTrackerActivationConfirmationHash(canonicalArm),
    });
    return createEdgeActivationTracker(armEvidence);
}

function restoreExpectation(
    state: EdgeActivationTracker,
    repositoryRevision: number,
    payloadHash: `sha256:${string}`,
    overrides: Partial<EdgeTrackerRestoreExpectation> = {},
): EdgeTrackerRestoreExpectation {
    return persistenceIssuer.issueEdgeTrackerRepositoryHeadEvidence({
        repositoryRevision,
        tracker: state,
        recordKey: state.recordKey,
        strategyId: state.strategyId,
        strategyDefinitionHash: state.strategyDefinitionHash,
        confirmationHash: state.confirmationHash,
        activationDefinitionHash: state.activationDefinitionHash,
        activationConfirmationHash: state.activationConfirmationHash,
        payloadHash,
        ...overrides,
    });
}

function comparatorEvidence(
    current: EligibleQuoteObservation,
    truth: boolean,
    evidenceTime = time(),
    conditionId = 'condition-main',
): QuoteComparatorEvaluationEvidence {
    const definition = conditionDefinition(conditionId, {
        field: current.field as 'last_price' | 'bid_price' | 'ask_price',
    });
    const evaluation = verifyQuoteComparatorEvaluation({
        definition,
        observation: current,
        timeEvidence: evidenceTime,
    });
    if (evaluation.truth !== truth) {
        throw new Error('comparator fixture truth does not match observation');
    }
    return evaluation;
}

function inputFor(
    state: EdgeActivationTracker,
    current: EligibleQuoteObservation,
    truth: boolean,
    options: Readonly<{
        nowMs?: number;
        detectedGap?:
            | 'disconnect'
            | 'sleep'
            | 'event_loop_pause'
            | 'clock_jump'
            | 'coordinator_gap';
        evaluationEvidence?: QuoteConditionEvaluationEvidence;
    }> = {},
): EdgeTrackerInput {
    const evaluationEvidence =
        options.evaluationEvidence ??
        comparatorEvidence(current, truth, time(options.nowMs ?? NOW));
    const continuityInput =
        options.detectedGap === undefined
            ? {
                  previousCursor: state.lastEvaluationCursor,
                  currentEvaluation: evaluationEvidence,
              }
            : {
                  previousCursor: state.lastEvaluationCursor,
                  currentEvaluation: evaluationEvidence,
                  detectedGap: options.detectedGap,
              };
    return {
        evaluationEvidence,
        continuityEvidence:
            quoteIssuer.issueGroupEvaluationContinuityEvidence(continuityInput),
    };
}

function advance(
    state: EdgeActivationTracker,
    sequence: number,
    truth: boolean,
    options: ObservationOptions &
        Readonly<{
            nowMs?: number;
            detectedGap?:
                | 'disconnect'
                | 'sleep'
                | 'event_loop_pause'
                | 'clock_jump'
                | 'coordinator_gap';
        }> = {},
) {
    const current = observation(sequence, {
        ...options,
        value: options.value ?? (truth ? '101' : '99'),
    });
    return advanceEdgeActivationTracker(
        state,
        inputFor(state, current, truth, options),
    );
}

function verifiedAndEvidence(
    primary: EligibleQuoteObservation,
    sibling: EligibleQuoteObservation,
    truth: boolean,
): QuoteConditionEvaluationEvidence {
    const evidenceTime = time();
    const primaryEvidence = comparatorEvidence(
        primary,
        truth,
        evidenceTime,
        'condition-a',
    );
    const siblingEvidence = comparatorEvidence(
        sibling,
        truth,
        evidenceTime,
        'condition-b',
    );
    const primaryDefinition = primaryEvidence.definition;
    const siblingDefinition = siblingEvidence.definition;
    const groupHashInput = {
        groupId: 'and-group-1',
        strategyId: identity.strategyId,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        repositoryRevision: 1,
        strategyDefinitionHash: identity.strategyDefinitionHash,
        confirmationHash: CONFIRMATION_HASH,
        armGeneration: 2,
        groupRevision: 1,
        operator: 'and' as const,
        conditionDefinitionHashes: [
            siblingDefinition.conditionDefinitionHash,
            primaryDefinition.conditionDefinitionHash,
        ],
    };
    const groupDefinition = quoteIssuer.issueConditionGroupDefinitionEvidence({
        ...groupHashInput,
        groupDefinitionHash:
            deriveQuoteConditionGroupDefinitionHash(groupHashInput),
        conditions: [siblingDefinition, primaryDefinition],
    });
    return verifyAndConditionEvaluation({
        definition: groupDefinition,
        evaluations: [siblingEvidence, primaryEvidence],
        timeEvidence: evidenceTime,
    });
}

function verifiedVectorGroupEvidence(input: Readonly<{
    operator: 'and' | 'or';
    first: EligibleQuoteObservation;
    firstTruth: boolean;
    second: EligibleQuoteObservation;
    secondTruth: boolean;
}>): QuoteGroupEvaluationEvidence {
    const evidenceTime = time();
    const firstEvidence = comparatorEvidence(
        input.first,
        input.firstTruth,
        evidenceTime,
        'vector-condition-a',
    );
    const secondEvidence = comparatorEvidence(
        input.second,
        input.secondTruth,
        evidenceTime,
        'vector-condition-b',
    );
    const groupHashInput = {
        groupId: `vector-${input.operator}-group`,
        strategyId: identity.strategyId,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        repositoryRevision: 1,
        strategyDefinitionHash: identity.strategyDefinitionHash,
        confirmationHash: CONFIRMATION_HASH,
        armGeneration: 2,
        groupRevision: 1,
        operator: input.operator,
        conditionDefinitionHashes: [
            secondEvidence.conditionDefinitionHash,
            firstEvidence.conditionDefinitionHash,
        ],
    };
    const definition = quoteIssuer.issueConditionGroupDefinitionEvidence({
        ...groupHashInput,
        groupDefinitionHash:
            deriveQuoteConditionGroupDefinitionHash(groupHashInput),
        conditions: [secondEvidence.definition, firstEvidence.definition],
    });
    const verifierInput = {
        definition,
        evaluations: [secondEvidence, firstEvidence],
        timeEvidence: evidenceTime,
    };
    return input.operator === 'and'
        ? verifyAndConditionEvaluation(verifierInput)
        : verifyOrConditionEvaluation(verifierInput);
}

function rehashEvaluationCursorJson(
    cursor: Record<string, unknown>,
): Record<string, unknown> {
    const { vectorHash: _discarded, ...material } = cursor;
    return {
        ...material,
        vectorHash: `sha256:${smartOrderSha256HexSync(
            SMART_ORDER_GROUP_EVALUATION_CURSOR_HASH_DOMAIN +
                stableSerializeCanonical(material as CanonicalObject),
        )}`,
    };
}

describe('activation policy and verifier-bound edge reducer', () => {
    it('require_rearm waits for false, emits one edge, and rearms deterministically', () => {
        const initialTrue = advance(tracker(), 1, true);
        expect(initialTrue).toMatchObject({
            outcome: 'no_activation',
            reason: 'waiting_for_false',
            tracker: { phase: 'waiting_for_false', edgeGeneration: 0 },
        });
        const stillTrue = advance(initialTrue.tracker, 2, true);
        expect(stillTrue).toMatchObject({
            outcome: 'no_activation',
            reason: 'waiting_for_false',
        });
        const falseResult = advance(stillTrue.tracker, 3, false);
        expect(falseResult).toMatchObject({
            outcome: 'no_activation',
            reason: 'condition_false',
            tracker: { phase: 'ready_after_false' },
        });
        const edgeObservation = observation(4, { value: '101' });
        const firstEdge = advanceEdgeActivationTracker(
            falseResult.tracker,
            inputFor(falseResult.tracker, edgeObservation, true),
        );
        expect(firstEdge).toMatchObject({
            outcome: 'activation',
            reason: 'CONDITION_EDGE_FALSE_TO_TRUE',
            tracker: { phase: 'true_latched', edgeGeneration: 1 },
            logicalKey: {
                armGeneration: 2,
                tradeDate: TRADE_DATE,
                edgeGeneration: 1,
            },
            triggeringObservationIds: ['obs-4'],
        });
        expect(Object.isFrozen(firstEdge)).toBe(true);
        if (firstEdge.outcome !== 'activation') throw new Error('edge required');
        expect(Object.isFrozen(firstEdge.tracker)).toBe(true);
        expect(Object.isFrozen(firstEdge.logicalKey)).toBe(true);
        expect(Object.isFrozen(firstEdge.triggeringObservationIds)).toBe(true);

        const replay = advanceEdgeActivationTracker(
            firstEdge.tracker,
            inputFor(firstEdge.tracker, edgeObservation, true),
        );
        expect(replay).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'duplicate',
            tracker: { edgeGeneration: 1 },
        });
        const laterTrue = advance(replay.tracker, 5, true);
        expect(laterTrue).toMatchObject({
            outcome: 'no_activation',
            reason: 'already_true',
            tracker: { edgeGeneration: 1 },
        });
        const rearmed = advance(laterTrue.tracker, 6, false);
        const secondEdge = advance(rearmed.tracker, 7, true);
        expect(secondEdge).toMatchObject({
            outcome: 'activation',
            tracker: { edgeGeneration: 2 },
            logicalKey: { edgeGeneration: 2 },
        });
    });

    it('immediate_if_true emits exactly one explicitly-confirmed initial activation', () => {
        const immediate = advance(
            tracker({ activationPolicy: 'immediate_if_true' }),
            1,
            true,
        );
        expect(immediate).toMatchObject({
            outcome: 'activation',
            reason: 'CONDITION_IMMEDIATE_CONFIRMED',
            tracker: { phase: 'true_latched', edgeGeneration: 1 },
        });
        expect(advance(immediate.tracker, 2, true)).toMatchObject({
            outcome: 'no_activation',
            reason: 'already_true',
            tracker: { edgeGeneration: 1 },
        });
    });

    it('derives multi-observation audit IDs only from verifier-issued AND evidence', () => {
        const primary = observation(2, {
            observationId: 'obs-a',
            value: '101',
        });
        const sibling = observation(3, {
            observationId: 'obs-b',
            value: '101',
            field: 'bid_price',
        });
        const evaluationEvidence = verifiedAndEvidence(
            primary,
            sibling,
            true,
        );
        if (evaluationEvidence.evaluationKind === 'comparator') {
            throw new Error('AND fixture must produce group evidence');
        }
        const armed = tracker({
            activationDefinitionHash:
                evaluationEvidence.groupDefinitionHash,
            activationPolicy: 'immediate_if_true',
        });
        const result = advanceEdgeActivationTracker(
            armed,
            inputFor(armed, evaluationEvidence.observation, true, {
                evaluationEvidence,
            }),
        );
        if (result.outcome !== 'activation') {
            throw new Error(`AND fixture rejected: ${result.reason}`);
        }
        expect(result).toMatchObject({
            outcome: 'activation',
            triggeringObservationIds: ['obs-a', 'obs-b'],
        });
    });

    it('rejects caller-reported truth/IDs and cloned verifier evidence', () => {
        const state = tracker();
        const current = observation(1);
        const valid = inputFor(state, current, false);
        expect(() =>
            advanceEdgeActivationTracker(state, {
                ...valid,
                conditionTrue: true,
                triggeringObservationIds: ['forged-observation'],
            } as unknown as EdgeTrackerInput),
        ).toThrow(
            'caller-supplied condition truth or observation evidence is forbidden',
        );
        expect(
            advanceEdgeActivationTracker(state, {
                ...valid,
                evaluationEvidence: Object.freeze({
                    ...valid.evaluationEvidence,
                    truth: true,
                }) as QuoteConditionEvaluationEvidence,
            }),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'untrusted_condition_evaluation',
        });
    });

    it('rejects trusted evaluations from another definition or confirmation', () => {
        const state = tracker({ activationPolicy: 'immediate_if_true' });
        const current = observation(1, { value: '101' });
        const wrongDefinition = conditionDefinition('condition-main', {
            mappingRevision: 'mapping-v2',
            repositoryRevision: 2,
        });
        const wrongDefinitionEvaluation = verifyQuoteComparatorEvaluation({
            definition: wrongDefinition,
            observation: current,
            timeEvidence: time(),
        });
        expect(
            advanceEdgeActivationTracker(
                state,
                inputFor(state, current, true, {
                    evaluationEvidence: wrongDefinitionEvaluation,
                }),
            ),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'condition_definition_mismatch',
        });

        const otherStrategyDefinition = conditionDefinition(
            'condition-main',
            { strategyId: 'strategy-2' },
        );
        const otherStrategyEvaluation = verifyQuoteComparatorEvaluation({
            definition: otherStrategyDefinition,
            observation: current,
            timeEvidence: time(),
        });
        expect(
            advanceEdgeActivationTracker(
                state,
                inputFor(state, current, true, {
                    evaluationEvidence: otherStrategyEvaluation,
                }),
            ),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'condition_definition_mismatch',
        });

        const wrongConfirmation = conditionDefinition('condition-main', {
            confirmationHash: `sha256:${'8'.repeat(64)}`,
            repositoryRevision: 3,
        });
        const wrongConfirmationEvaluation = verifyQuoteComparatorEvaluation({
            definition: wrongConfirmation,
            observation: current,
            timeEvidence: time(),
        });
        expect(
            advanceEdgeActivationTracker(
                state,
                inputFor(state, current, true, {
                    evaluationEvidence: wrongConfirmationEvaluation,
                }),
            ),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'condition_definition_mismatch',
        });
    });

    it('allows a fresh breached level after an epoch gap but keeps crossing recovery sticky until a new arm generation', () => {
        const levelFalse = advance(tracker({ semantics: 'level' }), 1, false);
        expect(
            advance(levelFalse.tracker, 2, true, {
                epoch: 'stream-epoch-2',
            }),
        ).toMatchObject({
            outcome: 'activation',
            reason: 'CONDITION_EDGE_FALSE_TO_TRUE',
        });

        quoteIssuer.resetQuoteObservationHeads();
        const crossingFalse = advance(
            tracker({ semantics: 'crossing' }),
            1,
            false,
        );
        const unknownCrossing = advance(crossingFalse.tracker, 2, true, {
            epoch: 'stream-epoch-2',
        });
        expect(unknownCrossing).toEqual({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
            tracker: crossingFalse.tracker,
        });

        const freshFalse = advance(unknownCrossing.tracker, 3, false, {
            epoch: 'stream-epoch-2',
        });
        expect(freshFalse).toEqual({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
            tracker: crossingFalse.tracker,
        });
        const freshTrue = advance(unknownCrossing.tracker, 4, true, {
            epoch: 'stream-epoch-2',
        });
        expect(freshTrue).toEqual({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
            tracker: crossingFalse.tracker,
        });

        const repeatedObservation = observation(5, {
            epoch: 'stream-epoch-2',
            value: '101',
        });
        const repeatedInput = inputFor(
            crossingFalse.tracker,
            repeatedObservation,
            true,
        );
        const repeatedFirst = advanceEdgeActivationTracker(
            crossingFalse.tracker,
            repeatedInput,
        );
        const repeatedReplay = advanceEdgeActivationTracker(
            crossingFalse.tracker,
            repeatedInput,
        );
        expect(repeatedFirst).toEqual({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
            tracker: crossingFalse.tracker,
        });
        expect(repeatedReplay).toEqual(repeatedFirst);
        expect(repeatedFirst.tracker).toBe(crossingFalse.tracker);

        const rearmDefinition = conditionDefinition('condition-main', {
            repositoryRevision: 2,
            armGeneration: 3,
        });
        const rearmed = tracker({
            armGeneration: 3,
            semantics: 'crossing',
            activationDefinitionHash:
                rearmDefinition.conditionDefinitionHash,
        });
        expect(rearmed.activationConfirmationHash).not.toBe(
            crossingFalse.tracker.activationConfirmationHash,
        );
        const rearmFalseObservation = observation(6, {
            epoch: 'stream-epoch-2',
            value: '99',
        });
        const rearmFalseEvaluation = verifyQuoteComparatorEvaluation({
            definition: rearmDefinition,
            observation: rearmFalseObservation,
            timeEvidence: time(),
        });
        const explicitlyRearmedFalse = advanceEdgeActivationTracker(
            rearmed,
            inputFor(rearmed, rearmFalseObservation, false, {
                evaluationEvidence: rearmFalseEvaluation,
            }),
        );
        expect(explicitlyRearmedFalse).toMatchObject({
            outcome: 'no_activation',
            reason: 'condition_false',
            tracker: {
                armGeneration: 3,
                phase: 'ready_after_false',
            },
        });
        const rearmTrueObservation = observation(7, {
            epoch: 'stream-epoch-2',
            value: '101',
        });
        const rearmTrueEvaluation = verifyQuoteComparatorEvaluation({
            definition: rearmDefinition,
            observation: rearmTrueObservation,
            timeEvidence: time(),
        });
        expect(
            advanceEdgeActivationTracker(
                explicitlyRearmedFalse.tracker,
                inputFor(
                    explicitlyRearmedFalse.tracker,
                    rearmTrueObservation,
                    true,
                    { evaluationEvidence: rearmTrueEvaluation },
                ),
            ),
        ).toMatchObject({
            outcome: 'activation',
            reason: 'CONDITION_EDGE_FALSE_TO_TRUE',
            tracker: { armGeneration: 3, edgeGeneration: 1 },
        });
    });

    it('rejects crossing gaps before false handling in waiting and latched phases', () => {
        const waiting = advance(
            tracker({ semantics: 'crossing' }),
            1,
            true,
        );
        expect(waiting.tracker.phase).toBe('waiting_for_false');
        const waitingGapFalse = advance(waiting.tracker, 2, false, {
            epoch: 'stream-epoch-2',
        });
        expect(waitingGapFalse).toEqual({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
            tracker: waiting.tracker,
        });

        quoteIssuer.resetQuoteObservationHeads();
        const latched = advance(
            tracker({
                semantics: 'crossing',
                activationPolicy: 'immediate_if_true',
            }),
            1,
            true,
        );
        if (latched.outcome !== 'activation') {
            throw new Error('latched fixture must activate');
        }
        const latchedGapFalse = advance(latched.tracker, 2, false, {
            epoch: 'stream-epoch-2',
        });
        expect(latchedGapFalse).toEqual({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
            tracker: latched.tracker,
        });
    });

    it('turns explicit and same-epoch sequence gaps into crossing recovery', () => {
        const explicitSeed = advance(
            tracker({ semantics: 'crossing' }),
            1,
            false,
        );
        expect(
            advance(explicitSeed.tracker, 2, true, {
                detectedGap: 'disconnect',
            }),
        ).toMatchObject({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
        });
        quoteIssuer.resetQuoteObservationHeads();
        const sequenceSeed = advance(
            tracker({ semantics: 'crossing' }),
            1,
            false,
        );
        expect(advance(sequenceSeed.tracker, 5, true)).toMatchObject({
            outcome: 'recovery_required',
            reason: 'QUOTE_GAP_CROSSING_UNKNOWN',
        });
    });

    it('requires explicit recovery for conflicting same-ID or same-sequence replay', () => {
        const seeded = advance(tracker(), 1, false).tracker;
        quoteIssuer.resetQuoteObservationHeads();
        const conflict = observation(1, {
            observationId: 'obs-conflict',
            value: '101',
        });
        expect(
            advanceEdgeActivationTracker(
                seeded,
                inputFor(seeded, conflict, true),
            ),
        ).toEqual({
            outcome: 'recovery_required',
            reason: 'QUOTE_OBSERVATION_CONFLICT',
            tracker: seeded,
        });
    });

    it('does not advance on cross-date, duplicate, or reordered observations', () => {
        const initial = observation(10, { value: '99' });
        const initialTracker = tracker();
        const initialInput = inputFor(initialTracker, initial, false);
        const seeded = advanceEdgeActivationTracker(
            initialTracker,
            initialInput,
        ).tracker;
        const duplicateInput = {
            evaluationEvidence: initialInput.evaluationEvidence,
            continuityEvidence: quoteIssuer.issueGroupEvaluationContinuityEvidence({
                previousCursor: seeded.lastEvaluationCursor,
                currentEvaluation: initialInput.evaluationEvidence,
            }),
        };
        expect(
            advanceEdgeActivationTracker(seeded, duplicateInput),
        ).toEqual({
            outcome: 'observation_rejected',
            reason: 'duplicate',
            tracker: seeded,
        });
        quoteIssuer.resetQuoteObservationHeads();
        const reordered = observation(9, { value: '101' });
        expect(
            advanceEdgeActivationTracker(
                seeded,
                inputFor(seeded, reordered, true),
            ),
        ).toEqual({
            outcome: 'observation_rejected',
            reason: 'out_of_order',
            tracker: seeded,
        });
        quoteIssuer.resetQuoteObservationHeads();
        const wrongDate = observation(11, {
            tradeDate: '2027-01-14',
            value: '101',
        });
        expect(
            advanceEdgeActivationTracker(
                seeded,
                inputFor(seeded, wrongDate, true),
            ),
        ).toEqual({
            outcome: 'observation_rejected',
            reason: 'wrong_trade_date',
            tracker: seeded,
        });
    });

    it('rejects forged and mismatched continuity evidence', () => {
        const state = tracker();
        const current = observation(1);
        const valid = inputFor(state, current, false);
        expect(
            advanceEdgeActivationTracker(state, {
                ...valid,
                continuityEvidence: Object.freeze({
                    ...valid.continuityEvidence,
                }) as GroupEvaluationContinuityEvidence,
            }),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'untrusted_continuity_evidence',
        });
        const another = observation(2, { field: 'bid_price' });
        const anotherEvaluation = comparatorEvidence(
            another,
            false,
            time(),
            'condition-other',
        );
        const mismatched = quoteIssuer.issueGroupEvaluationContinuityEvidence({
            previousCursor: state.lastEvaluationCursor,
            currentEvaluation: anotherEvaluation,
        });
        expect(
            advanceEdgeActivationTracker(state, {
                ...valid,
                continuityEvidence: mismatched,
            }),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'continuity_evidence_mismatch',
        });
    });

    it('rejects an otherwise-fresh evaluation after its quote scope head advances', () => {
        const state = tracker();
        const first = observation(1, { value: '99' });
        const firstInput = inputFor(state, first, false);
        observation(2, { value: '101' });
        expect(advanceEdgeActivationTracker(state, firstInput)).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'expired_condition_evaluation',
        });
    });

    it('cannot activate a new immediate tracker with an evaluation from a retired epoch', () => {
        const oldTracker = tracker({
            activationPolicy: 'immediate_if_true',
        });
        const oldObservation = observation(1, { value: '101' });
        const oldInput = inputFor(oldTracker, oldObservation, true);
        observation(1, {
            epoch: 'stream-epoch-2',
            streamGeneration: 2,
            observationId: 'obs-new-epoch',
            value: '101',
        });
        const newTracker = tracker({
            activationPolicy: 'immediate_if_true',
        });
        expect(
            advanceEdgeActivationTracker(newTracker, oldInput),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'expired_condition_evaluation',
            tracker: { phase: 'awaiting_initial_observation' },
        });
    });

    it('expires verifier evidence by monotonic time and current generation', () => {
        const state = tracker();
        const current = observation(1);
        const expiredInput = inputFor(state, current, false);
        const beforeExpiry = quoteIssuer.readTimeAuthorityState();
        quoteIssuer.advanceTimeAuthority(
            beforeExpiry.monotonicNowMs +
                SMART_ORDER_QUOTE_TIME_EVIDENCE_TTL_MS +
                1,
        );
        expect(
            advanceEdgeActivationTracker(state, expiredInput),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'expired_condition_evaluation',
        });

        const generationInput = inputFor(state, current, false);
        const beforeRotation = quoteIssuer.readTimeAuthorityState();
        quoteIssuer.rotateTimeGeneration(
            'activation-test-clock-generation-2',
            beforeRotation.monotonicNowMs + 1,
        );
        expect(
            advanceEdgeActivationTracker(state, generationInput),
        ).toMatchObject({
            outcome: 'observation_rejected',
            reason: 'expired_condition_evaluation',
        });
    });

    it('accepts a complete AND vector when only a non-primary sibling advances', () => {
        const first = observation(1, {
            observationId: 'vector-a-1',
            value: '99',
        });
        const second = observation(1, {
            observationId: 'vector-b-1',
            field: 'bid_price',
            value: '99',
        });
        const initialEvaluation = verifiedVectorGroupEvidence({
            operator: 'and',
            first,
            firstTruth: false,
            second,
            secondTruth: false,
        });
        const initialTracker = tracker({
            activationDefinitionHash: initialEvaluation.groupDefinitionHash,
        });
        const seeded = advanceEdgeActivationTracker(
            initialTracker,
            inputFor(initialTracker, initialEvaluation.observation, false, {
                evaluationEvidence: initialEvaluation,
            }),
        ).tracker;
        const secondAdvanced = observation(2, {
            observationId: 'vector-b-2',
            field: 'bid_price',
            value: '99',
        });
        const nextEvaluation = verifiedVectorGroupEvidence({
            operator: 'and',
            first,
            firstTruth: false,
            second: secondAdvanced,
            secondTruth: false,
        });
        const result = advanceEdgeActivationTracker(
            seeded,
            inputFor(seeded, nextEvaluation.observation, false, {
                evaluationEvidence: nextEvaluation,
            }),
        );
        expect(result).toMatchObject({
            outcome: 'no_activation',
            reason: 'condition_false',
        });
        expect(
            result.tracker.lastEvaluationCursor?.legs.map((leg) => [
                leg.conditionId,
                leg.cursor.observationId,
            ]),
        ).toEqual([
            ['vector-condition-a', 'vector-a-1'],
            ['vector-condition-b', 'vector-b-2'],
        ]);
    });

    it('derives AND and OR edge IDs from every false-to-true vector leg', () => {
        const first = observation(1, {
            observationId: 'and-a-false',
            value: '99',
        });
        const second = observation(1, {
            observationId: 'and-b-true',
            field: 'bid_price',
            value: '101',
        });
        const initialAnd = verifiedVectorGroupEvidence({
            operator: 'and',
            first,
            firstTruth: false,
            second,
            secondTruth: true,
        });
        const andTracker = tracker({
            activationDefinitionHash: initialAnd.groupDefinitionHash,
        });
        const andReady = advanceEdgeActivationTracker(
            andTracker,
            inputFor(andTracker, initialAnd.observation, false, {
                evaluationEvidence: initialAnd,
            }),
        ).tracker;
        const firstTrue = observation(2, {
            observationId: 'and-a-true',
            value: '101',
        });
        const currentAnd = verifiedVectorGroupEvidence({
            operator: 'and',
            first: firstTrue,
            firstTruth: true,
            second,
            secondTruth: true,
        });
        expect(
            advanceEdgeActivationTracker(
                andReady,
                inputFor(andReady, currentAnd.observation, true, {
                    evaluationEvidence: currentAnd,
                }),
            ),
        ).toMatchObject({
            outcome: 'activation',
            triggeringObservationIds: ['and-a-true'],
        });

        quoteIssuer.resetQuoteObservationHeads();
        quoteIssuer.resetConditionDefinitionHeads();
        const orFirst = observation(1, {
            observationId: 'or-a-false',
            value: '99',
        });
        const orSecond = observation(1, {
            observationId: 'or-b-false',
            field: 'bid_price',
            value: '99',
        });
        const initialOr = verifiedVectorGroupEvidence({
            operator: 'or',
            first: orFirst,
            firstTruth: false,
            second: orSecond,
            secondTruth: false,
        });
        const orTracker = tracker({
            activationDefinitionHash: initialOr.groupDefinitionHash,
        });
        const orReady = advanceEdgeActivationTracker(
            orTracker,
            inputFor(orTracker, initialOr.observation, false, {
                evaluationEvidence: initialOr,
            }),
        ).tracker;
        const orFirstTrue = observation(2, {
            observationId: 'or-z-true',
            value: '101',
        });
        const orSecondTrue = observation(2, {
            observationId: 'or-a-true',
            field: 'bid_price',
            value: '101',
        });
        const currentOr = verifiedVectorGroupEvidence({
            operator: 'or',
            first: orFirstTrue,
            firstTruth: true,
            second: orSecondTrue,
            secondTruth: true,
        });
        expect(
            advanceEdgeActivationTracker(
                orReady,
                inputFor(orReady, currentOr.observation, true, {
                    evaluationEvidence: currentOr,
                }),
            ),
        ).toMatchObject({
            outcome: 'activation',
            triggeringObservationIds: ['or-a-true', 'or-z-true'],
        });
    });

    it('rejects a vector when one leg advances but another leg rolls back', () => {
        const first = observation(1, {
            observationId: 'rollback-a-1',
            value: '99',
        });
        const second = observation(1, {
            observationId: 'rollback-b-1',
            field: 'bid_price',
            value: '99',
        });
        const evaluation = verifiedVectorGroupEvidence({
            operator: 'and',
            first,
            firstTruth: false,
            second,
            secondTruth: false,
        });
        const base = JSON.parse(
            JSON.stringify(deriveGroupEvaluationCursor(evaluation)),
        ) as Record<string, unknown>;
        const previousJson = JSON.parse(JSON.stringify(base)) as Record<
            string,
            unknown
        >;
        const previousLegs = previousJson.legs as Record<string, unknown>[];
        const previousSecondCursor = previousLegs[1]!.cursor as Record<
            string,
            unknown
        >;
        previousLegs[1] = {
            ...previousLegs[1],
            cursor: {
                ...previousSecondCursor,
                headRevision: 2,
                observationId: 'rollback-b-2',
                sequence: 2,
                exchangeTimeMs:
                    (previousSecondCursor.exchangeTimeMs as number) + 1,
                receiveTimeMs:
                    (previousSecondCursor.receiveTimeMs as number) + 1,
            },
        };
        const currentJson = JSON.parse(JSON.stringify(base)) as Record<
            string,
            unknown
        >;
        const currentLegs = currentJson.legs as Record<string, unknown>[];
        const currentFirstCursor = currentLegs[0]!.cursor as Record<
            string,
            unknown
        >;
        currentLegs[0] = {
            ...currentLegs[0],
            cursor: {
                ...currentFirstCursor,
                headRevision: 2,
                observationId: 'rollback-a-2',
                sequence: 2,
                exchangeTimeMs:
                    (currentFirstCursor.exchangeTimeMs as number) + 1,
                receiveTimeMs:
                    (currentFirstCursor.receiveTimeMs as number) + 1,
            },
        };
        const previous = restoreGroupEvaluationCursor(
            rehashEvaluationCursorJson(previousJson),
        );
        const current = restoreGroupEvaluationCursor(
            rehashEvaluationCursorJson(currentJson),
        );
        expect(compareGroupEvaluationCursors(previous, current)).toBe(
            'out_of_order',
        );
    });
});

describe('persistent tracker attestation boundary', () => {
    it('keeps each repository record head strictly monotonic', async () => {
        const state = advance(tracker(), 1, false).tracker;
        const persisted = JSON.parse(JSON.stringify(state));
        const revision20 =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                persisted,
                20,
            );
        const head20 = restoreExpectation(
            state,
            20,
            revision20.payloadHash,
        );
        expect(
            restoreExpectation(state, 20, revision20.payloadHash),
        ).toBe(head20);
        const nextState = advance(state, 2, true).tracker;
        const conflictingRevision20 =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                JSON.parse(JSON.stringify(nextState)),
                20,
            );
        expect(() =>
            restoreExpectation(
                nextState,
                20,
                conflictingRevision20.payloadHash,
            ),
        ).toThrow('conflicting payload hash');
        const revision19 =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                persisted,
                19,
            );
        expect(() =>
            restoreExpectation(state, 19, revision19.payloadHash),
        ).toThrow('revision cannot move backwards');
        expect(isTrustedEdgeTrackerRepositoryHeadEvidence(head20)).toBe(true);

        const staleRevision21 =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                persisted,
                21,
            );
        expect(() =>
            restoreExpectation(state, 21, staleRevision21.payloadHash),
        ).toThrow('transition is not reducer-reachable');

        const revision21 =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                JSON.parse(JSON.stringify(nextState)),
                21,
            );
        expect(() =>
            restoreExpectation(
                JSON.parse(JSON.stringify(nextState)) as EdgeActivationTracker,
                21,
                revision21.payloadHash,
            ),
        ).toThrow('transition is not reducer-reachable');
        const head21 = restoreExpectation(
            nextState,
            21,
            revision21.payloadHash,
        );
        expect(isTrustedEdgeTrackerRepositoryHeadEvidence(head20)).toBe(false);
        expect(isTrustedEdgeTrackerRepositoryHeadEvidence(head21)).toBe(true);
    });

    it('rejects higher-revision cursor rollback and edge-generation laundering', async () => {
        const ready = advance(tracker(), 1, false).tracker;
        const activated = advance(ready, 2, true).tracker;
        const readyRevision =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                JSON.parse(JSON.stringify(ready)),
                30,
            );
        restoreExpectation(ready, 30, readyRevision.payloadHash);
        const activatedRevision =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                JSON.parse(JSON.stringify(activated)),
                31,
            );
        restoreExpectation(activated, 31, activatedRevision.payloadHash);

        const rolledBackCursor =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                JSON.parse(JSON.stringify(ready)),
                32,
            );
        expect(() =>
            restoreExpectation(ready, 32, rolledBackCursor.payloadHash),
        ).toThrow('transition is not reducer-reachable');

        const rearmed = advance(activated, 3, false).tracker;
        const regressedCursorHead = JSON.parse(
            JSON.stringify(rearmed),
        ) as Record<string, unknown>;
        const evaluationCursor = regressedCursorHead.lastEvaluationCursor as Record<
            string,
            unknown
        >;
        const legs = evaluationCursor.legs as Record<string, unknown>[];
        legs[0] = {
            ...legs[0],
            cursor: {
                ...(legs[0]!.cursor as Record<string, unknown>),
                headRevision: 1,
            },
        };
        const { vectorHash: _staleVectorHash, ...regressedVectorMaterial } =
            evaluationCursor;
        evaluationCursor.vectorHash = `sha256:${smartOrderSha256HexSync(
            SMART_ORDER_GROUP_EVALUATION_CURSOR_HASH_DOMAIN +
                stableSerializeCanonical(
                    regressedVectorMaterial as never,
                ),
        )}`;
        const regressedCursorAttestation =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                regressedCursorHead,
                32,
            );
        expect(() =>
            restoreExpectation(
                regressedCursorHead as EdgeActivationTracker,
                32,
                regressedCursorAttestation.payloadHash,
            ),
        ).toThrow('transition is not reducer-reachable');

        const regressedEdgeGeneration = {
            ...JSON.parse(JSON.stringify(rearmed)),
            edgeGeneration: 0,
        };
        const regressedEdgeAttestation =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                regressedEdgeGeneration,
                32,
            );
        expect(() =>
            restoreExpectation(
                regressedEdgeGeneration as EdgeActivationTracker,
                32,
                regressedEdgeAttestation.payloadHash,
            ),
        ).toThrow('transition is not reducer-reachable');

        const laterTrue = advance(activated, 4, true).tracker;
        const jumpedEdgeGeneration = {
            ...JSON.parse(JSON.stringify(laterTrue)),
            edgeGeneration: 2,
        };
        const jumpedEdgeAttestation =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                jumpedEdgeGeneration,
                32,
            );
        expect(() =>
            restoreExpectation(
                jumpedEdgeGeneration as EdgeActivationTracker,
                32,
                jumpedEdgeAttestation.payloadHash,
            ),
        ).toThrow('transition is not reducer-reachable');
    });

    it('requires a one-use confirmed arm evidence, including immediate policy', () => {
        const canonicalArm = {
            recordKey: 'immediate-tracker',
            strategyId: identity.strategyId,
            strategyDefinitionHash: identity.strategyDefinitionHash,
            confirmationHash: CONFIRMATION_HASH,
            activationDefinitionHash: MAIN_CONDITION_DEFINITION_HASH,
            tradeDate: TRADE_DATE,
            armGeneration: 2,
            activationPolicy: 'immediate_if_true' as const,
            semantics: 'level' as const,
        };
        const evidence = persistenceIssuer.issueEdgeTrackerArmEvidence({
            ...canonicalArm,
            activationConfirmationHash:
                deriveEdgeTrackerActivationConfirmationHash(canonicalArm),
        });
        expect(() =>
            persistenceIssuer.issueEdgeTrackerArmEvidence({
                ...canonicalArm,
                activationPolicy: 'require_rearm',
                activationConfirmationHash:
                    evidence.activationConfirmationHash,
            }),
        ).toThrow('activation confirmation hash mismatch');
        expect(() =>
            persistenceIssuer.issueEdgeTrackerArmEvidence({
                ...canonicalArm,
                activationDefinitionHash: `sha256:${'7'.repeat(64)}`,
                activationConfirmationHash:
                    evidence.activationConfirmationHash,
            }),
        ).toThrow('activation confirmation hash mismatch');
        expect(() =>
            createEdgeActivationTracker(Object.freeze({ ...evidence })),
        ).toThrow('edge tracker arm evidence is untrusted');
        expect(createEdgeActivationTracker(evidence)).toMatchObject({
            activationPolicy: 'immediate_if_true',
            confirmationHash: CONFIRMATION_HASH,
            strategyDefinitionHash: identity.strategyDefinitionHash,
            edgeGeneration: 0,
        });
        expect(() => createEdgeActivationTracker(evidence)).toThrow(
            'edge tracker arm evidence is untrusted',
        );
    });

    it('requires a revision/hash-bound repository attestation to restore JSON', async () => {
        const persistedState = advance(tracker(), 1, false).tracker;
        const persistedJson = JSON.parse(JSON.stringify(persistedState));
        await expect(
            (
                restoreEdgeActivationTracker as unknown as (
                    value: unknown,
                ) => Promise<EdgeActivationTracker>
            )(persistedJson),
        ).rejects.toThrow('edge tracker persistence attestation is untrusted');

        const attestation =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                persistedJson,
                7,
            );
        expect(attestation).toMatchObject({
            repositoryRevision: 7,
            payloadHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
        const restored = await restoreEdgeActivationTracker(
            persistedJson,
            attestation,
            restoreExpectation(persistedState, 7, attestation.payloadHash),
        );
        expect(restored).toEqual(persistedState);
        expect(Object.isFrozen(restored)).toBe(true);
        expect(Object.isFrozen(restored.lastEvaluationCursor)).toBe(true);
        expect(Object.isFrozen(restored.lastEvaluationCursor?.legs)).toBe(true);
        expect(
            Object.isFrozen(restored.lastEvaluationCursor?.legs[0]?.cursor),
        ).toBe(true);
        expect(advance(restored, 2, true)).toMatchObject({
            outcome: 'activation',
            logicalKey: { edgeGeneration: 1 },
        });
        await expect(
            restoreEdgeActivationTracker(
                persistedJson,
                attestation,
                restoreExpectation(persistedState, 7, attestation.payloadHash),
            ),
        ).rejects.toThrow('edge tracker persistence attestation is untrusted');
    });

    it('rejects shape-valid ready/generation forgery under a real attestation', async () => {
        const ready = advance(tracker(), 1, false).tracker;
        const activated = advance(ready, 2, true).tracker;
        const persisted = JSON.parse(JSON.stringify(activated)) as Record<
            string,
            unknown
        >;
        const attestation =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                persisted,
                8,
            );
        await expect(
            restoreEdgeActivationTracker(
                {
                    ...persisted,
                    phase: 'ready_after_false',
                    lastTruth: false,
                    edgeGeneration: 999,
                },
                attestation,
                restoreExpectation(activated, 8, attestation.payloadHash),
            ),
        ).rejects.toThrow('edge tracker invariants are invalid');
        await expect(
            restoreEdgeActivationTracker(
                persisted,
                attestation,
                restoreExpectation(activated, 8, attestation.payloadHash),
            ),
        ).resolves.toEqual(activated);
    });

    it('rejects a valid old revision, wrong owner, or wrong definition expectation', async () => {
        const state = advance(tracker(), 1, false).tracker;
        const persisted = JSON.parse(JSON.stringify(state));
        const currentState = advance(state, 2, true).tracker;
        const currentPersisted = JSON.parse(JSON.stringify(currentState));
        const oldRevision =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                persisted,
                10,
            );
        const currentRevision =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                currentPersisted,
                11,
            );
        const staleHead = restoreExpectation(
            state,
            10,
            oldRevision.payloadHash,
        );
        const currentHead = restoreExpectation(
            currentState,
            11,
            currentRevision.payloadHash,
        );
        await expect(
            restoreEdgeActivationTracker(
                persisted,
                oldRevision,
                staleHead,
            ),
        ).rejects.toThrow('repository head is untrusted or stale');
        await expect(
            restoreEdgeActivationTracker(
                persisted,
                oldRevision,
                currentHead,
            ),
        ).rejects.toThrow('edge tracker persistence attestation mismatch');

        expect(() =>
            restoreExpectation(state, 10, oldRevision.payloadHash, {
                    recordKey: 'another-record',
                    strategyId: domainId('strategy-2', 'StrategyId'),
                }),
        ).toThrow('repository head is not canonical');

        persistenceIssuer.resetEdgeTrackerRepositoryHeads();
        expect(() =>
            restoreExpectation(state, 10, oldRevision.payloadHash, {
                    strategyDefinitionHash: `sha256:${'9'.repeat(64)}`,
                }),
        ).toThrow('repository head is not canonical');
    });

    it('independently recomputes the current row payload hash', async () => {
        const state = advance(tracker(), 1, false).tracker;
        const persisted = JSON.parse(JSON.stringify(state));
        const attestation =
            await persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                persisted,
                12,
            );
        expect(attestation.payloadHash).not.toBe(`sha256:${'0'.repeat(64)}`);
        expect(() =>
            restoreExpectation(
                state,
                12,
                `sha256:${'0'.repeat(64)}`,
            ),
        ).toThrow('repository head is not canonical');
    });

    it('rejects impossible persisted invariants and untrusted structural trackers', async () => {
        const canonical = advance(tracker(), 1, false).tracker;
        const persisted = JSON.parse(JSON.stringify(canonical)) as Record<
            string,
            unknown
        >;
        await expect(
            persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                {
                    ...persisted,
                    phase: 'true_latched',
                    lastTruth: false,
                },
                9,
            ),
        ).rejects.toThrow('edge tracker invariants are invalid');
        await expect(
            persistenceIssuer.issueEdgeTrackerPersistenceAttestation(
                {
                    ...persisted,
                    activationPolicy: 'immediate_if_true',
                },
                9,
            ),
        ).rejects.toThrow('edge tracker invariants are invalid');

        const structuralClone = Object.freeze({ ...canonical });
        const current = observation(2, { value: '101' });
        expect(() =>
            advanceEdgeActivationTracker(
                structuralClone,
                inputFor(canonical, current, true),
            ),
        ).toThrow('edge tracker is untrusted; restore it first');
    });
});

describe('deterministic activation identity', () => {
    it('matches the versioned SHA-256/base32 edge golden vector', async () => {
        const result = await deriveEdgeActivationIdentity({
            identity,
            armGeneration: 2,
            tradeDate: TRADE_DATE,
            edgeGeneration: 4,
        });
        expect(result.activationId).toMatch(/^[a-z2-7]{52}$/);
        expect(result.canonicalKey).toBe(
            `realtimestock.smart-order.activation/v1\n` +
                `{"activationKind":"edge","logicalKey":{"armGeneration":2,"edgeGeneration":4,"tradeDate":"2027-01-15"},"schema":"activation/v1","strategyDefinitionHash":"sha256:${'a'.repeat(64)}","strategyId":"strategy-1"}`,
        );
        expect(result.activationId).toBe(
            'fetfoucphwgdw3r6w3iw5ksb7hubzddc7n3p6vfgc75ngh6lfnaq',
        );
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.keyMaterial)).toBe(true);
        expect(Object.isFrozen(result.keyMaterial.logicalKey)).toBe(true);
    });

    it('reuses one edge ID across duplicate callbacks and changes only for logical generations', async () => {
        const input = {
            identity,
            armGeneration: 2,
            tradeDate: TRADE_DATE,
            edgeGeneration: 1,
        } as const;
        const [first, replay] = await Promise.all([
            deriveEdgeActivationIdentity(input),
            deriveEdgeActivationIdentity({ ...input }),
        ]);
        const nextEdge = await deriveEdgeActivationIdentity({
            ...input,
            edgeGeneration: 2,
        });
        const nextArm = await deriveEdgeActivationIdentity({
            ...input,
            armGeneration: 3,
        });
        expect(first.activationId).toBe(replay.activationId);
        expect(nextEdge.activationId).not.toBe(first.activationId);
        expect(nextArm.activationId).not.toBe(first.activationId);
        expect(compareDeterministicActivationIdentity(first, replay)).toBe(
            'same_logical_activation',
        );
        expect(compareDeterministicActivationIdentity(first, nextEdge)).toBe(
            'different_activation',
        );
        expect(
            compareDeterministicActivationIdentity(first, {
                activationId: first.activationId,
                canonicalKey: `${first.canonicalKey}:conflict`,
            }),
        ).toBe('ACTIVATION_ID_CONFLICT');
    });

    it('binds IDs to the immutable strategy definition hash', async () => {
        const first = await deriveEdgeActivationIdentity({
            identity,
            armGeneration: 1,
            tradeDate: TRADE_DATE,
            edgeGeneration: 1,
        });
        const changedDefinition = await deriveEdgeActivationIdentity({
            identity: {
                ...identity,
                strategyDefinitionHash: `sha256:${'b'.repeat(64)}`,
            },
            armGeneration: 1,
            tradeDate: TRADE_DATE,
            edgeGeneration: 1,
        });
        expect(changedDefinition.activationId).not.toBe(first.activationId);
    });

    it('derives one collision-safe schedule-slot ID per canonical slot', async () => {
        const nominalSlot = {
            identity,
            tradeDate: TRADE_DATE,
            scheduleRuleRevision: 'schedule-rule-7',
            slotIndex: 3,
            nominalSlotTime: '10:30:00',
        } as const;
        const missed = await deriveScheduleSlotActivationIdentity(nominalSlot);
        const triggered = await deriveScheduleSlotActivationIdentity({
            ...nominalSlot,
        });
        const nextSlot = await deriveScheduleSlotActivationIdentity({
            ...nominalSlot,
            slotIndex: 4,
        });
        const nextRule = await deriveScheduleSlotActivationIdentity({
            ...nominalSlot,
            scheduleRuleRevision: 'schedule-rule-8',
        });
        expect(missed.activationId).toBe(triggered.activationId);
        expect(nextSlot.activationId).not.toBe(missed.activationId);
        expect(nextRule.activationId).not.toBe(missed.activationId);
        expect(missed.keyMaterial.logicalKey).toEqual({
            tradeDate: TRADE_DATE,
            scheduleRuleRevision: 'schedule-rule-7',
            slotIndex: 3,
            nominalSlotTime: '10:30:00',
        });
        expect(missed.canonicalKey).not.toContain('callback');
        expect(missed.canonicalKey).not.toContain('missed');
    });

    it('rejects noncanonical counters, time, definition hashes, and ID comparisons', async () => {
        await expect(
            deriveEdgeActivationIdentity({
                identity,
                armGeneration: 0,
                tradeDate: TRADE_DATE,
                edgeGeneration: 0,
            }),
        ).rejects.toThrow('edge activation logical key is not canonical');
        await expect(
            deriveScheduleSlotActivationIdentity({
                identity,
                tradeDate: TRADE_DATE,
                scheduleRuleRevision: 'schedule-rule-1',
                slotIndex: 0,
                nominalSlotTime: '9:00',
            }),
        ).rejects.toThrow(
            'schedule-slot activation logical key is not canonical',
        );
        await expect(
            deriveEdgeActivationIdentity({
                identity: {
                    ...identity,
                    strategyDefinitionHash: 'sha256:not-a-digest',
                },
                armGeneration: 0,
                tradeDate: TRADE_DATE,
                edgeGeneration: 1,
            }),
        ).rejects.toThrow('strategy activation identity is not canonical');
        expect(() =>
            compareDeterministicActivationIdentity(
                { activationId: 'not-base32', canonicalKey: 'a' },
                { activationId: 'not-base32', canonicalKey: 'a' },
            ),
        ).toThrow('activation identity comparison input is invalid');
    });
});
