import { beforeEach, describe, expect, it } from 'vitest';
import { decimalString } from './smart-order-domain-money';
import {
    SMART_ORDER_AND_COHERENCE_WINDOW_MS,
    SMART_ORDER_CONDITION_VERIFIER_VERSION,
    SMART_ORDER_OBSERVATION_TEST_ONLY,
    SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION,
    SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS,
    SMART_ORDER_QUOTE_QUANTITY_MAX,
    SMART_ORDER_QUOTE_TIME_EVIDENCE_TTL_MS,
    compareQuoteObservationOrder,
    deriveQuoteConditionDefinitionHash,
    deriveQuoteConditionGroupDefinitionHash,
    evaluateAndConditions,
    evaluateOrEdges,
    evaluateQuoteLevel,
    isTrustedEligibleQuoteObservation,
    isQuoteConditionEvaluationCurrent,
    isQuoteObservationCurrent,
    isTrustedQuoteConditionEvaluationEvidence,
    isTrustedQuoteConditionDefinitionEvidence,
    isTrustedQuoteConditionGroupDefinitionEvidence,
    isTrustedQuoteContinuityEvidence,
    isTrustedQuoteTimeEvidence,
    restoreQuoteObservationCursor,
    projectProtectiveTriggerObservation,
    smartOrderSha256HexSync,
    verifyAndConditionEvaluation,
    verifyOrConditionEvaluation,
    verifyQuoteComparatorEvaluation,
    type EligibleQuoteObservation,
    type QuoteObservationCandidate,
    type QuoteConditionDefinitionEvidence,
    type QuoteConditionGroupDefinitionEvidence,
    type QuoteQualificationContext,
    type QuoteTimeEvidence,
} from './smart-order-observation-domain';

const NOW = 1_800_000_010_000;
const TRADE_DATE = '2027-01-15';
const CONTRACT = 'TSE:STK:2330';
const FIELD = 'last_price';
const EPOCH = 'stream-epoch-1';
const STRATEGY_DEFINITION_HASH = `sha256:${'d'.repeat(64)}` as const;
const CONFIRMATION_HASH = `sha256:${'e'.repeat(64)}` as const;
const TAMPERED_HASH = `sha256:${'0'.repeat(64)}` as const;
const REPOSITORY_OWNER_ID = 'smart-order-repository-1';

function testIssuer() {
    if (!SMART_ORDER_OBSERVATION_TEST_ONLY) {
        throw new Error('test-only quote evidence issuer is unavailable');
    }
    return SMART_ORDER_OBSERVATION_TEST_ONLY;
}

const issuer = testIssuer();
let fixtureSequence = 0;

beforeEach(() => {
    issuer.resetQuoteObservationHeads();
    issuer.resetConditionDefinitionHeads();
    fixtureSequence = 0;
});

function time(nowMs = NOW): QuoteTimeEvidence {
    return issuer.issueTimeEvidence(nowMs);
}

function definition(
    conditionId: string,
    overrides: Partial<{
        conditionDefinitionHash: `sha256:${string}`;
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
    }> = {},
): QuoteConditionDefinitionEvidence {
    const { conditionDefinitionHash, ...canonicalOverrides } = overrides;
    const canonical = {
        conditionId,
        strategyId: 'strategy-1',
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        repositoryRevision: 1,
        strategyDefinitionHash: STRATEGY_DEFINITION_HASH,
        confirmationHash: CONFIRMATION_HASH,
        armGeneration: 2,
        contractKey: CONTRACT,
        field: FIELD,
        comparator: 'gte',
        threshold: decimalString('100'),
        mappingRevision: 'mapping-v1',
        ...canonicalOverrides,
    } as const;
    return issuer.issueConditionDefinitionEvidence({
        ...canonical,
        conditionDefinitionHash:
            conditionDefinitionHash ??
            deriveQuoteConditionDefinitionHash(canonical),
    });
}

function defineGroup(input: Readonly<{
    groupId: string;
    groupRevision: number;
    operator: 'and' | 'or';
    conditions: readonly QuoteConditionDefinitionEvidence[];
    groupDefinitionHash?: `sha256:${string}`;
    repositoryOwnerId?: string;
    repositoryRevision?: number;
    armGeneration?: number;
}>): QuoteConditionGroupDefinitionEvidence {
    const canonical = {
        groupId: input.groupId,
        strategyId: 'strategy-1',
        repositoryOwnerId:
            input.repositoryOwnerId ?? REPOSITORY_OWNER_ID,
        repositoryRevision: input.repositoryRevision ?? 1,
        strategyDefinitionHash: STRATEGY_DEFINITION_HASH,
        confirmationHash: CONFIRMATION_HASH,
        armGeneration: input.armGeneration ?? 2,
        groupRevision: input.groupRevision,
        operator: input.operator,
        conditionDefinitionHashes: input.conditions.map(
            ({ conditionDefinitionHash }) => conditionDefinitionHash,
        ),
    } as const;
    return issuer.issueConditionGroupDefinitionEvidence({
        ...canonical,
        groupDefinitionHash:
            input.groupDefinitionHash ??
            deriveQuoteConditionGroupDefinitionHash(canonical),
        conditions: input.conditions,
    });
}

function candidate(
    overrides: Partial<QuoteObservationCandidate> = {},
): QuoteObservationCandidate {
    const sequence = ++fixtureSequence;
    return {
        observationId: `obs-${sequence}`,
        contractKey: CONTRACT,
        field: FIELD,
        value: '100',
        tradeDate: TRADE_DATE,
        exchangeTimeMs: NOW - 100 + sequence,
        receiveTimeMs: NOW - 50 + sequence,
        streamEpoch: EPOCH,
        sequence,
        delivery: 'subscription',
        mappingVerified: true,
        simtrade: false,
        intradayOdd: false,
        ...overrides,
    };
}

type QuoteContextOverrides = Partial<{
    expectedContractKey: string;
    expectedField:
        | 'last_price'
        | 'bid_price'
        | 'ask_price'
        | 'tick_quantity'
        | 'total_quantity';
    expectedTradeDate: string;
    expectedStreamEpoch: string;
    streamGeneration: number;
    timeEvidence: QuoteTimeEvidence;
}>;

function context(
    overrides: QuoteContextOverrides = {},
): QuoteQualificationContext {
    const expectedContractKey = overrides.expectedContractKey ?? CONTRACT;
    const expectedField = overrides.expectedField ?? FIELD;
    const expectedTradeDate = overrides.expectedTradeDate ?? TRADE_DATE;
    const expectedStreamEpoch = overrides.expectedStreamEpoch ?? EPOCH;
    return {
        lineageEvidence: issuer.issueQuoteStreamLineageEvidence({
            contractKey: expectedContractKey,
            field: expectedField,
            tradeDate: expectedTradeDate,
            streamEpoch: expectedStreamEpoch,
            streamGeneration:
                overrides.streamGeneration ??
                (expectedStreamEpoch === EPOCH ? 1 : 2),
        }),
        timeEvidence: time(),
        ...(overrides.timeEvidence
            ? { timeEvidence: overrides.timeEvidence }
            : {}),
    };
}

function eligible(
    overrides: Partial<QuoteObservationCandidate> = {},
    contextOverrides: QuoteContextOverrides = {},
): EligibleQuoteObservation {
    const field =
        typeof overrides.field === 'string' &&
        [
            'last_price',
            'bid_price',
            'ask_price',
            'tick_quantity',
            'total_quantity',
        ].includes(overrides.field)
            ? (overrides.field as NonNullable<
                  QuoteContextOverrides['expectedField']
              >)
            : FIELD;
    const result = issuer.qualifyQuoteObservation(
        candidate(overrides),
        context({
            expectedContractKey:
                typeof overrides.contractKey === 'string'
                    ? overrides.contractKey
                    : CONTRACT,
            expectedField: field,
            expectedTradeDate:
                typeof overrides.tradeDate === 'string'
                    ? overrides.tradeDate
                    : TRADE_DATE,
            expectedStreamEpoch:
                typeof overrides.streamEpoch === 'string'
                    ? overrides.streamEpoch
                    : EPOCH,
            ...contextOverrides,
        }),
    );
    if (!result.eligible) {
        throw new Error(`expected eligible observation, got ${result.reason}`);
    }
    return result.observation;
}

describe('trusted quote observation qualification', () => {
    it('matches the standard SHA-256 golden vector used by canonical definitions', () => {
        expect(smartOrderSha256HexSync('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });

    it('uses a test-only issuer and fixed versioned freshness policy', () => {
        expect(SMART_ORDER_QUOTE_FRESHNESS_WINDOW_MS).toBe(3_000);
        expect(SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION).toContain('3000ms');
        expect(isTrustedQuoteTimeEvidence(time())).toBe(true);
        expect(
            isTrustedQuoteTimeEvidence({
                nowMs: NOW,
                policyVersion: SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION,
            }),
        ).toBe(false);
    });

    it('only allows the current fresh normal-lot last trade to drive protective triggers', () => {
        const lastTrade = eligible({ field: 'last_price', value: '99.5' });
        expect(projectProtectiveTriggerObservation(lastTrade, time())).toEqual({
            eligible: true,
            reason: 'eligible_last_trade',
            field: 'last_price',
            value: '99.5',
            lastEligibleTimeMs: lastTrade.exchangeTimeMs,
            brokerWriteAuthority: false,
        });

        const bid = eligible(
            { field: 'bid_price', value: '98.5' },
            { expectedField: 'bid_price' },
        );
        expect(projectProtectiveTriggerObservation(bid, time())).toEqual({
            eligible: false,
            reason: 'field_not_last_trade',
            field: 'bid_price',
            value: null,
            lastEligibleTimeMs: null,
            brokerWriteAuthority: false,
        });
        const ask = eligible(
            { field: 'ask_price', value: '101' },
            { expectedField: 'ask_price' },
        );
        expect(projectProtectiveTriggerObservation(ask, time())).toMatchObject({
            eligible: false,
            reason: 'field_not_last_trade',
            field: 'ask_price',
            brokerWriteAuthority: false,
        });

        expect(
            projectProtectiveTriggerObservation(lastTrade, time(NOW + 3_001)),
        ).toEqual({
            eligible: false,
            reason: 'stale_observation',
            field: 'last_price',
            value: null,
            lastEligibleTimeMs: lastTrade.exchangeTimeMs,
            brokerWriteAuthority: false,
        });

        expect(
            projectProtectiveTriggerObservation(
                Object.freeze({ ...lastTrade }),
                time(),
            ),
        ).toMatchObject({
            eligible: false,
            reason: 'untrusted_observation',
            brokerWriteAuthority: false,
        });
    });

    it('expires trusted time by monotonic progress and invalidates it on generation rotation', () => {
        const expiring = time();
        const beforeExpiry = issuer.readTimeAuthorityState();
        issuer.advanceTimeAuthority(
            beforeExpiry.monotonicNowMs +
                SMART_ORDER_QUOTE_TIME_EVIDENCE_TTL_MS,
        );
        expect(isTrustedQuoteTimeEvidence(expiring)).toBe(true);
        issuer.advanceTimeAuthority(
            beforeExpiry.monotonicNowMs +
                SMART_ORDER_QUOTE_TIME_EVIDENCE_TTL_MS +
                1,
        );
        expect(isTrustedQuoteTimeEvidence(expiring)).toBe(false);

        const oldGeneration = time();
        const beforeRotation = issuer.readTimeAuthorityState();
        issuer.rotateTimeGeneration(
            'vitest-clock-generation-after-rotation',
            beforeRotation.monotonicNowMs + 1,
        );
        expect(isTrustedQuoteTimeEvidence(oldGeneration)).toBe(false);
        expect(isTrustedQuoteTimeEvidence(time())).toBe(true);
    });

    it('normalizes, freezes, brands, and contract/field-binds a live observation', () => {
        const result = issuer.qualifyQuoteObservation(
            candidate({ value: '100.5000' }),
            context(),
        );
        expect(result).toMatchObject({
            eligible: true,
            observation: {
                contractKey: CONTRACT,
                field: FIELD,
                value: '100.5',
                freshUntilMs: NOW - 99 + 3_000,
                freshnessPolicyVersion:
                    SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION,
            },
        });
        if (!result.eligible) throw new Error('fixture must qualify');
        expect(Object.isFrozen(result.observation)).toBe(true);
        expect(Object.isFrozen(result.cursor)).toBe(true);
        expect(isTrustedEligibleQuoteObservation(result.observation)).toBe(true);
        expect(result.cursor).toMatchObject({
            contractKey: CONTRACT,
            field: FIELD,
        });
    });

    it.each([
        ['wrong_contract', { contractKey: 'TSE:STK:2303' }, {}],
        ['field_not_allowed', { field: 'unverified_field' }, {}],
        ['mapping_unverified', { mappingVerified: false }, {}],
        ['non_subscription', { delivery: 'snapshot' }, {}],
        ['wrong_trade_date', { tradeDate: '2027-01-14' }, {}],
        ['wrong_stream_epoch', { streamEpoch: 'stream-epoch-2' }, {}],
        ['simtrade', { simtrade: true }, {}],
        ['intraday_odd', { intradayOdd: true }, {}],
        ['future_timestamp', { receiveTimeMs: NOW + 1 }, {}],
        ['stale', { exchangeTimeMs: NOW - 3_001 }, {}],
    ] as const)('rejects %s without a cursor', (reason, overrides, contextOverrides) => {
        const result = issuer.qualifyQuoteObservation(
            candidate(overrides),
            context(contextOverrides),
        );
        expect(result).toEqual({
            eligible: false,
            reason,
            recoveryRequired: false,
        });
        expect('cursor' in result).toBe(false);
    });

    it.each([
        undefined,
        null,
        '',
        '-1',
        'NaN',
        'Infinity',
        '1e2',
        Number.NaN,
        Number.POSITIVE_INFINITY,
        100,
    ])('rejects illegal quote value %s', (value) => {
        expect(
            issuer.qualifyQuoteObservation(candidate({ value }), context()),
        ).toEqual({
            eligible: false,
            reason: 'invalid_value',
            recoveryRequired: false,
        });
    });

    it.each(['last_price', 'bid_price', 'ask_price'] as const)(
        'rejects missing/non-positive %s values',
        (field) => {
            expect(
                issuer.qualifyQuoteObservation(
                    candidate({ field, value: '0' }),
                    context({ expectedField: field }),
                ),
            ).toMatchObject({ eligible: false, reason: 'invalid_value' });
            expect(
                issuer.qualifyQuoteObservation(
                    candidate({ field, value: '-0.01' }),
                    context({ expectedField: field }),
                ),
            ).toMatchObject({ eligible: false, reason: 'invalid_value' });
        },
    );

    it.each(['tick_quantity', 'total_quantity'] as const)(
        'accepts only bounded nonnegative integer %s values',
        (field) => {
            expect(
                issuer.qualifyQuoteObservation(
                    candidate({ field, value: '0' }),
                    context({ expectedField: field }),
                ).eligible,
            ).toBe(true);
            for (const value of [
                '-1',
                '1.5',
                '0.1',
                '9007199254740992',
            ]) {
                expect(
                    issuer.qualifyQuoteObservation(
                        candidate({ field, value }),
                        context({ expectedField: field }),
                    ),
                ).toMatchObject({ eligible: false, reason: 'invalid_value' });
            }
            expect(
                issuer.qualifyQuoteObservation(
                    candidate({ field, value: SMART_ORDER_QUOTE_QUANTITY_MAX }),
                    context({ expectedField: field }),
                ).eligible,
            ).toBe(true);
        },
    );

    it('accepts the fixed freshness boundary and rejects one millisecond beyond it', () => {
        expect(
            issuer.qualifyQuoteObservation(
                candidate({
                    exchangeTimeMs: NOW - 3_000,
                    receiveTimeMs: NOW - 3_000,
                }),
                context(),
            ).eligible,
        ).toBe(true);
        expect(
            issuer.qualifyQuoteObservation(
                candidate({ exchangeTimeMs: NOW - 3_001 }),
                context(),
            ),
        ).toMatchObject({ eligible: false, reason: 'stale' });
    });

    it('distinguishes an exact replay from conflicting same-ID/sequence evidence', () => {
        const replayCandidate = candidate();
        const first = issuer.qualifyQuoteObservation(replayCandidate, context());
        if (!first.eligible) throw new Error('fixture must qualify');
        expect(first.cursor.headRevision).toBe(1);
        expect(
            issuer.qualifyQuoteObservation(
                replayCandidate,
                context(),
            ),
        ).toMatchObject({
            eligible: false,
            reason: 'duplicate',
            recoveryRequired: false,
        });
        expect(
            issuer.qualifyQuoteObservation(
                {
                    ...replayCandidate,
                    observationId: 'obs-conflict',
                    value: '101',
                },
                context(),
            ),
        ).toEqual({
            eligible: false,
            reason: 'conflicting_replay',
            recoveryRequired: true,
        });
    });

    it('owns a monotonic cursor head and rejects caller cursor self-attestation', () => {
        const first = issuer.qualifyQuoteObservation(candidate(), context());
        const second = issuer.qualifyQuoteObservation(candidate(), context());
        if (!first.eligible || !second.eligible) {
            throw new Error('head fixtures must qualify');
        }
        expect(first.cursor.headRevision).toBe(1);
        expect(second.cursor.headRevision).toBe(2);
        expect(
            issuer.readQuoteObservationHead({
                contractKey: CONTRACT,
                field: FIELD,
                streamEpoch: EPOCH,
            }),
        ).toEqual(second.cursor);
        expect(
            issuer.qualifyQuoteObservation(
                candidate({ sequence: null }),
                context(),
            ),
        ).toMatchObject({
            eligible: false,
            reason: 'sequence_missing_after_cursor',
        });
        expect(() =>
            issuer.qualifyQuoteObservation(
                candidate(),
                {
                    ...context(),
                    previousCursor: first.cursor,
                } as unknown as QuoteQualificationContext,
            ),
        ).toThrow('quote qualification context is not canonical');
        expect(
            issuer.qualifyQuoteObservation(
                {
                    ...candidate(),
                    observationId: first.observation.observationId,
                    sequence: first.observation.sequence,
                    exchangeTimeMs: first.observation.exchangeTimeMs,
                    receiveTimeMs: first.observation.receiveTimeMs,
                    value: first.observation.value,
                },
                context(),
            ),
        ).toMatchObject({ eligible: false, reason: 'out_of_order' });
        expect(
            issuer.readQuoteObservationHead({
                contractKey: CONTRACT,
                field: FIELD,
                streamEpoch: EPOCH,
            }),
        ).toEqual(second.cursor);
    });

    it('atomically retires the old epoch observation, evaluation, and continuity', () => {
        const oldObservation = eligible({
            observationId: 'obs-old-epoch',
            sequence: 1,
        });
        const oldEvaluation = verifyQuoteComparatorEvaluation({
            definition: definition('old-epoch-condition'),
            observation: oldObservation,
            timeEvidence: time(),
        });
        const oldContinuity = issuer.issueContinuityEvidence({
            previousCursor: null,
            currentObservation: oldObservation,
        });
        expect(isQuoteObservationCurrent(oldObservation)).toBe(true);
        expect(isQuoteConditionEvaluationCurrent(oldEvaluation)).toBe(true);
        expect(isTrustedQuoteContinuityEvidence(oldContinuity)).toBe(true);

        issuer.issueQuoteStreamLineageEvidence({
            contractKey: CONTRACT,
            field: FIELD,
            tradeDate: TRADE_DATE,
            streamEpoch: 'stream-epoch-2',
            streamGeneration: 2,
        });
        expect(isQuoteObservationCurrent(oldObservation)).toBe(false);
        expect(isQuoteConditionEvaluationCurrent(oldEvaluation)).toBe(false);
        expect(isTrustedQuoteContinuityEvidence(oldContinuity)).toBe(false);
        expect(() =>
            issuer.issueContinuityEvidence({
                previousCursor: null,
                currentObservation: oldObservation,
            }),
        ).toThrow('inactive');
        expect(() =>
            issuer.issueQuoteStreamLineageEvidence({
                contractKey: CONTRACT,
                field: FIELD,
                tradeDate: TRADE_DATE,
                streamEpoch: 'stream-epoch-conflict',
                streamGeneration: 2,
            }),
        ).toThrow('conflicting lineage');
        expect(() =>
            issuer.issueQuoteStreamLineageEvidence({
                contractKey: CONTRACT,
                field: FIELD,
                tradeDate: TRADE_DATE,
                streamEpoch: EPOCH,
                streamGeneration: 1,
            }),
        ).toThrow('cannot move backwards');
        expect(() =>
            issuer.issueQuoteStreamLineageEvidence({
                contractKey: CONTRACT,
                field: FIELD,
                tradeDate: TRADE_DATE,
                streamEpoch: 'stream-epoch-4',
                streamGeneration: 4,
            }),
        ).toThrow('must advance by one');
    });

    it('rejects cursor comparisons across contract or field scope', () => {
        const last = issuer.qualifyQuoteObservation(candidate(), context());
        const ask = issuer.qualifyQuoteObservation(
            candidate({
                observationId: 'obs-ask',
                field: 'ask_price',
                sequence: 2,
            }),
            context({ expectedField: 'ask_price' }),
        );
        if (!last.eligible || !ask.eligible) {
            throw new Error('cursor fixtures must qualify');
        }
        expect(
            compareQuoteObservationOrder(
                restoreQuoteObservationCursor(last.cursor),
                restoreQuoteObservationCursor(ask.cursor),
            ),
        ).toBe('conflicting_replay');
    });

    it('restores only an exact canonical cursor and freezes the result', () => {
        const qualified = issuer.qualifyQuoteObservation(candidate(), context());
        if (!qualified.eligible) throw new Error('fixture must qualify');
        const restored = restoreQuoteObservationCursor(
            JSON.parse(JSON.stringify(qualified.cursor)),
        );
        expect(restored).toEqual(qualified.cursor);
        expect(Object.isFrozen(restored)).toBe(true);
        expect(() =>
            restoreQuoteObservationCursor({
                ...qualified.cursor,
                unexpected: true,
            }),
        ).toThrow('quote cursor is not canonical');
        expect(() =>
            restoreQuoteObservationCursor({
                ...qualified.cursor,
                value: '0',
            }),
        ).toThrow('quote cursor value is not canonical');
    });

    it('does not mint continuity from an unknown gap reason', () => {
        const current = eligible();
        expect(() =>
            issuer.issueContinuityEvidence({
                previousCursor: null,
                currentObservation: current,
                detectedGap: 'invented_gap',
            } as unknown as Parameters<
                typeof issuer.issueContinuityEvidence
            >[0]),
        ).toThrow('detected quote gap reason is invalid');
    });

    it('rejects a structural observation that never passed the issuer', () => {
        const real = eligible();
        const forged = Object.freeze({ ...real, freshUntilMs: NOW + 1_000_000 });
        expect(isTrustedEligibleQuoteObservation(forged)).toBe(false);
    });

    it('uses exact decimal comparison after attestation', () => {
        const observation = eligible({ value: '100.01' });
        expect(
            evaluateQuoteLevel(observation, 'gte', decimalString('100.01')),
        ).toBe(true);
        expect(
            evaluateQuoteLevel(observation, 'lte', decimalString('100')),
        ).toBe(false);
    });
});

describe('verifier-issued condition evidence', () => {
    it('recomputes condition and full-group hashes instead of trusting caller digests', () => {
        const definitionA = definition('hash-a');
        const definitionB = definition('hash-b', { field: 'bid_price' });
        expect(() =>
            definition('hash-a', {
                threshold: decimalString('101'),
                conditionDefinitionHash:
                    definitionA.conditionDefinitionHash,
            }),
        ).toThrow('condition definition hash mismatch');
        expect(() =>
            definition('hash-a', {
                comparator: 'lte',
                conditionDefinitionHash:
                    definitionA.conditionDefinitionHash,
            }),
        ).toThrow('condition definition hash mismatch');
        expect(() =>
            definition('hash-a', {
                mappingRevision: 'mapping-v2',
                conditionDefinitionHash:
                    definitionA.conditionDefinitionHash,
            }),
        ).toThrow('condition definition hash mismatch');
        expect(() =>
            definition('hash-tampered', {
                conditionDefinitionHash: TAMPERED_HASH,
            }),
        ).toThrow('condition definition hash mismatch');

        const canonicalGroup = defineGroup({
            groupId: 'hash-group',
            groupRevision: 3,
            operator: 'and',
            conditions: [definitionA, definitionB],
        });
        expect(
            deriveQuoteConditionGroupDefinitionHash({
                groupId: canonicalGroup.groupId,
                strategyId: canonicalGroup.strategyId,
                repositoryOwnerId: canonicalGroup.repositoryOwnerId,
                repositoryRevision: canonicalGroup.repositoryRevision,
                strategyDefinitionHash:
                    canonicalGroup.strategyDefinitionHash,
                confirmationHash: canonicalGroup.confirmationHash,
                armGeneration: canonicalGroup.armGeneration,
                groupRevision: canonicalGroup.groupRevision,
                operator: canonicalGroup.operator,
                conditionDefinitionHashes: [
                    definitionB.conditionDefinitionHash,
                    definitionA.conditionDefinitionHash,
                ],
            }),
        ).toBe(canonicalGroup.groupDefinitionHash);
        expect(() =>
            defineGroup({
                groupId: 'hash-group',
                groupRevision: 3,
                operator: 'or',
                conditions: [definitionA, definitionB],
                groupDefinitionHash:
                    canonicalGroup.groupDefinitionHash,
            }),
        ).toThrow('condition group definition hash mismatch');
        expect(() =>
            defineGroup({
                groupId: 'hash-group',
                groupRevision: 4,
                operator: 'and',
                conditions: [definitionA, definitionB],
                groupDefinitionHash:
                    canonicalGroup.groupDefinitionHash,
            }),
        ).toThrow('condition group definition hash mismatch');
        expect(() =>
            defineGroup({
                groupId: 'hash-group',
                groupRevision: 3,
                operator: 'and',
                conditions: [definitionA],
                groupDefinitionHash:
                    canonicalGroup.groupDefinitionHash,
            }),
        ).toThrow('condition group definition hash mismatch');
    });

    it('binds the immutable current definition, mapping and comparator inputs', () => {
        const observation = eligible({ value: '100.01' });
        const expectedDefinition = definition('price-at-least-100');
        const evaluation = verifyQuoteComparatorEvaluation({
            definition: expectedDefinition,
            observation,
            timeEvidence: time(),
        });
        expect(evaluation).toMatchObject({
            verifierVersion: SMART_ORDER_CONDITION_VERIFIER_VERSION,
            evaluationKind: 'comparator',
            evaluationId: 'price-at-least-100',
            truth: true,
            conditionDefinitionHash:
                expectedDefinition.conditionDefinitionHash,
            strategyDefinitionHash: STRATEGY_DEFINITION_HASH,
            confirmationHash: CONFIRMATION_HASH,
            armGeneration: 2,
            field: 'last_price',
            comparator: 'gte',
            threshold: '100',
            mappingRevision: 'mapping-v1',
            observationIds: ['obs-1'],
        });
        expect(Object.isFrozen(evaluation)).toBe(true);
        expect(Object.isFrozen(evaluation.observationIds)).toBe(true);
        expect(isTrustedQuoteConditionEvaluationEvidence(evaluation)).toBe(true);
        expect(
            isTrustedQuoteConditionEvaluationEvidence(
                Object.freeze({ ...evaluation, truth: false }),
            ),
        ).toBe(false);
        expect(() =>
            verifyQuoteComparatorEvaluation({
                definition: Object.freeze({ ...expectedDefinition }),
                observation,
                timeEvidence: time(),
            }),
        ).toThrow('condition definition is untrusted');
        expect(() =>
            verifyQuoteComparatorEvaluation({
                definition: definition('wrong-field', {
                    field: 'bid_price',
                }),
                observation,
                timeEvidence: time(),
            }),
        ).toThrow(
            'quote observation does not match current condition definition',
        );
        const revisedDefinition = definition('price-at-least-100', {
            mappingRevision: 'mapping-v2',
            repositoryRevision: 2,
        });
        expect(isTrustedQuoteConditionDefinitionEvidence(revisedDefinition)).toBe(
            true,
        );
        expect(isTrustedQuoteConditionDefinitionEvidence(expectedDefinition)).toBe(
            false,
        );
        expect(() =>
            verifyQuoteComparatorEvaluation({
                definition: expectedDefinition,
                observation,
                timeEvidence: time(),
            }),
        ).toThrow('condition definition is untrusted');
    });

    it('invalidates a still-fresh evaluation when the module quote head advances', () => {
        const expectedDefinition = definition('current-head-only');
        const firstObservation = eligible({
            observationId: 'obs-current-head-1',
            sequence: 1,
            value: '101',
        });
        const firstEvaluation = verifyQuoteComparatorEvaluation({
            definition: expectedDefinition,
            observation: firstObservation,
            timeEvidence: time(),
        });
        expect(isQuoteConditionEvaluationCurrent(firstEvaluation)).toBe(true);

        eligible({
            observationId: 'obs-current-head-2',
            sequence: 2,
            value: '102',
        });
        expect(isQuoteConditionEvaluationCurrent(firstEvaluation)).toBe(false);
        expect(() =>
            verifyQuoteComparatorEvaluation({
                definition: expectedDefinition,
                observation: firstObservation,
                timeEvidence: time(),
            }),
        ).toThrow('superseded');
    });

    it('enforces owner, repository revision, arm generation, and same-head CAS for definitions', () => {
        const current = definition('authority-condition', {
            repositoryRevision: 2,
        });
        expect(() =>
            definition('authority-condition', {
                repositoryRevision: 1,
            }),
        ).toThrow('repository revision cannot move backwards');
        expect(() =>
            definition('authority-condition', {
                repositoryRevision: 2,
                mappingRevision: 'mapping-conflict',
            }),
        ).toThrow('repository revision has conflicting definition');
        expect(() =>
            definition('authority-condition', {
                repositoryRevision: 3,
                armGeneration: 1,
            }),
        ).toThrow('arm generation cannot move backwards');
        expect(() =>
            definition('authority-condition', {
                repositoryOwnerId: 'another-repository-owner',
                repositoryRevision: 3,
            }),
        ).toThrow('repository owner cannot change');
        expect(isTrustedQuoteConditionDefinitionEvidence(current)).toBe(true);
    });

    it('applies the same monotonic CAS boundary to complete group definitions', () => {
        const currentConditions = [
            definition('group-current-a', { repositoryRevision: 2 }),
            definition('group-current-b', {
                repositoryRevision: 2,
                field: 'bid_price',
            }),
        ];
        const current = defineGroup({
            groupId: 'authority-group',
            groupRevision: 2,
            repositoryRevision: 2,
            operator: 'and',
            conditions: currentConditions,
        });

        const lowerRevisionConditions = [
            definition('group-lower-a', { repositoryRevision: 1 }),
        ];
        expect(() =>
            defineGroup({
                groupId: 'authority-group',
                groupRevision: 1,
                repositoryRevision: 1,
                operator: 'and',
                conditions: lowerRevisionConditions,
            }),
        ).toThrow('repository revision cannot move backwards');

        const conflictingConditions = [
            definition('group-conflict-a', { repositoryRevision: 2 }),
        ];
        expect(() =>
            defineGroup({
                groupId: 'authority-group',
                groupRevision: 2,
                repositoryRevision: 2,
                operator: 'or',
                conditions: conflictingConditions,
            }),
        ).toThrow('repository revision has conflicting definition');

        const otherOwnerConditions = [
            definition('group-other-owner-a', {
                repositoryOwnerId: 'another-repository-owner',
                repositoryRevision: 3,
            }),
        ];
        expect(() =>
            defineGroup({
                groupId: 'authority-group',
                groupRevision: 3,
                repositoryOwnerId: 'another-repository-owner',
                repositoryRevision: 3,
                operator: 'and',
                conditions: otherOwnerConditions,
            }),
        ).toThrow('repository owner cannot change');

        const lowerGenerationConditions = [
            definition('group-lower-arm-a', {
                repositoryRevision: 3,
                armGeneration: 1,
            }),
        ];
        expect(() =>
            defineGroup({
                groupId: 'authority-group',
                groupRevision: 3,
                repositoryRevision: 3,
                armGeneration: 1,
                operator: 'and',
                conditions: lowerGenerationConditions,
            }),
        ).toThrow('arm generation cannot move backwards');
        expect(isTrustedQuoteConditionGroupDefinitionEvidence(current)).toBe(
            true,
        );
    });

    it('derives AND only from the complete expected group definition', () => {
        const evaluationTime = time();
        const definitionA = definition('condition-a');
        const definitionB = definition('condition-b', {
            field: 'bid_price',
        });
        const trueChild = verifyQuoteComparatorEvaluation({
            definition: definitionA,
            observation: eligible({
                observationId: 'obs-condition-a',
                sequence: null,
                value: '101',
            }),
            timeEvidence: evaluationTime,
        });
        const falseChild = verifyQuoteComparatorEvaluation({
            definition: definitionB,
            observation: eligible({
                observationId: 'obs-condition-b',
                field: 'bid_price',
                sequence: null,
                value: '99',
            }),
            timeEvidence: evaluationTime,
        });
        const groupDefinition = defineGroup({
            groupId: 'and-group-1',
            groupRevision: 7,
            operator: 'and',
            conditions: [definitionB, definitionA],
        });
        const andEvidence = verifyAndConditionEvaluation({
            definition: groupDefinition,
            evaluations: [falseChild, trueChild],
            timeEvidence: evaluationTime,
        });
        expect(andEvidence).toMatchObject({
            evaluationKind: 'and',
            truth: false,
            groupDefinitionHash: groupDefinition.groupDefinitionHash,
            groupRevision: 7,
            observation: { observationId: 'obs-condition-b' },
            conditionIds: ['condition-a', 'condition-b'],
            observationIds: ['obs-condition-a', 'obs-condition-b'],
        });
        expect(isTrustedQuoteConditionEvaluationEvidence(andEvidence)).toBe(true);
        expect(() =>
            verifyAndConditionEvaluation({
                definition: groupDefinition,
                evaluations: [trueChild],
                timeEvidence: evaluationTime,
            }),
        ).toThrow('group verifier child evidence is untrusted or stale');
        expect(() =>
            verifyAndConditionEvaluation({
                definition: groupDefinition,
                evaluations: [
                    Object.freeze({ ...trueChild, truth: false }),
                    falseChild,
                ],
                timeEvidence: evaluationTime,
            }),
        ).toThrow('group verifier child evidence is untrusted or stale');

        const replacementDefinition = definition('condition-b', {
            field: 'bid_price',
            mappingRevision: 'mapping-v2',
            repositoryRevision: 2,
        });
        const replacementEvaluation = verifyQuoteComparatorEvaluation({
            definition: replacementDefinition,
            observation: eligible({
                observationId: 'obs-condition-b-replacement',
                field: 'bid_price',
                sequence: null,
                value: '101',
            }),
            timeEvidence: evaluationTime,
        });
        expect(() =>
            verifyAndConditionEvaluation({
                definition: groupDefinition,
                evaluations: [trueChild, replacementEvaluation],
                timeEvidence: evaluationTime,
            }),
        ).toThrow('AND verifier input is not canonical');
    });
});

describe('fixed AND coherence and quality ordering', () => {
    function condition(
        conditionId: string,
        offsetMs: number,
        overrides: Partial<QuoteObservationCandidate> = {},
        contextOverrides: QuoteContextOverrides = {},
    ) {
        return {
            conditionId,
            truth: true,
            observation: eligible(
                {
                    observationId: `obs-${conditionId}`,
                    sequence: null,
                    exchangeTimeMs: NOW - offsetMs,
                    receiveTimeMs: NOW - offsetMs,
                    ...overrides,
                },
                contextOverrides,
            ),
        };
    }

    it('accepts the inclusive 3000ms boundary and exposes no widening parameter', () => {
        const oldest = condition('a', 3_000);
        const newest = condition('b', 0, { field: 'bid_price' });
        const conditions = [newest, oldest];
        expect(evaluateAndConditions(conditions, time())).toMatchObject({
            satisfied: true,
            conditionIds: ['a', 'b'],
        });
        expect(SMART_ORDER_AND_COHERENCE_WINDOW_MS).toBe(3_000);
        expect(evaluateAndConditions.length).toBe(2);

        const invokedWithIgnoredExtraArgument = (
            evaluateAndConditions as unknown as (
                values: typeof conditions,
                now: QuoteTimeEvidence,
                forbiddenOverride: number,
            ) => ReturnType<typeof evaluateAndConditions>
        )(conditions, time(), 60_000);
        expect(invokedWithIgnoredExtraArgument).toMatchObject({ satisfied: true });
    });

    it('does not let condition_false hide a stale leg', () => {
        const stale = condition(
            'stale',
            4_000,
            {},
            { timeEvidence: time(NOW - 4_000) },
        );
        const falseLeg = {
            ...condition('false', 0, { field: 'bid_price' }),
            truth: false,
        };
        expect(evaluateAndConditions([falseLeg, stale], time(NOW))).toMatchObject({
            satisfied: false,
            reason: 'stale',
        });
    });

    it('rejects untrusted observations and time evidence before truth', () => {
        const valid = condition('valid', 0);
        const forgedObservation = Object.freeze({ ...valid.observation });
        expect(
            evaluateAndConditions(
                [{ ...valid, observation: forgedObservation }],
                time(),
            ),
        ).toMatchObject({ satisfied: false, reason: 'untrusted_observation' });
        expect(
            evaluateAndConditions(
                [valid],
                Object.freeze({
                    nowMs: NOW,
                    policyVersion: SMART_ORDER_QUOTE_FRESHNESS_POLICY_VERSION,
                }) as QuoteTimeEvidence,
            ),
        ).toMatchObject({ satisfied: false, reason: 'untrusted_time_evidence' });
    });

    it('rejects cross-date and cross-epoch sets', () => {
        const priorDate = condition(
            'prior-date',
            0,
            {
                tradeDate: '2027-01-14',
                streamEpoch: 'stream-prior-date',
                field: 'last_price',
            },
            {
                expectedTradeDate: '2027-01-14',
                expectedStreamEpoch: 'stream-prior-date',
            },
        );
        const nextEpoch = condition(
            'next-epoch',
            0,
            { streamEpoch: 'stream-epoch-2', field: 'bid_price' },
            { expectedStreamEpoch: 'stream-epoch-2' },
        );
        const current = condition('current', 0, { field: 'ask_price' });
        expect(
            evaluateAndConditions([current, priorDate], time()),
        ).toMatchObject({ satisfied: false, reason: 'different_trade_date' });
        expect(
            evaluateAndConditions([current, nextEpoch], time()),
        ).toMatchObject({ satisfied: false, reason: 'different_stream_epoch' });
    });
});

describe('OR fresh-edge evaluation', () => {
    let definitionA: QuoteConditionDefinitionEvidence;
    let definitionB: QuoteConditionDefinitionEvidence;
    let groupDefinition: QuoteConditionGroupDefinitionEvidence;

    beforeEach(() => {
        definitionA = definition('a');
        definitionB = definition('b', {
            field: 'bid_price',
        });
        groupDefinition = defineGroup({
            groupId: 'or-group-1',
            groupRevision: 8,
            operator: 'or',
            conditions: [definitionA, definitionB],
        });
    });

    function groupEvaluation(
        values: readonly [string, string],
        sequence: number,
    ) {
        const evaluationTime = time();
        const evaluations = [
            verifyQuoteComparatorEvaluation({
                definition: definitionA,
                observation: eligible({
                    observationId: `obs-a-${sequence}`,
                    sequence,
                    value: values[0],
                    exchangeTimeMs: NOW - 100 + sequence,
                    receiveTimeMs: NOW - 50 + sequence,
                }),
                timeEvidence: evaluationTime,
            }),
            verifyQuoteComparatorEvaluation({
                definition: definitionB,
                observation: eligible({
                    observationId: `obs-b-${sequence}`,
                    field: 'bid_price',
                    sequence,
                    value: values[1],
                    exchangeTimeMs: NOW - 100 + sequence,
                    receiveTimeMs: NOW - 50 + sequence,
                }),
                timeEvidence: evaluationTime,
            }),
        ];
        return verifyOrConditionEvaluation({
            definition: groupDefinition,
            evaluations,
            timeEvidence: evaluationTime,
        });
    }

    it('collapses simultaneous verifier-derived false-to-true legs deterministically', () => {
        const previous = groupEvaluation(['99', '99'], 1);
        const current = groupEvaluation(['101', '101'], 2);
        const forward = evaluateOrEdges({
            previousEvaluation: previous,
            currentEvaluation: current,
        });
        const reverseEvidence = verifyOrConditionEvaluation({
            definition: groupDefinition,
            evaluations: [...current.components].reverse(),
            timeEvidence: current.timeEvidence,
        });
        const reverse = evaluateOrEdges({
            previousEvaluation: previous,
            currentEvaluation: reverseEvidence,
        });
        expect(forward).toEqual(reverse);
        expect(forward).toMatchObject({
            triggered: true,
            winnerConditionId: 'a',
            conditionIds: ['a', 'b'],
            observationIds: ['obs-a-2', 'obs-b-2'],
        });
    });

    it('rejects caller-reported previous truth and cloned OR evidence', () => {
        const previous = groupEvaluation(['101', '99'], 3);
        const current = groupEvaluation(['101', '99'], 4);
        expect(
            evaluateOrEdges({
                previousEvaluation: previous,
                currentEvaluation: current,
            }),
        ).toEqual({
            triggered: false,
            reason: 'no_fresh_false_to_true_edge',
        });
        expect(
            evaluateOrEdges({
                previousEvaluation: previous,
                currentEvaluation: Object.freeze({ ...current }),
            }),
        ).toEqual({ triggered: false, reason: 'untrusted_evaluation' });
        expect(
            evaluateOrEdges({
                previousTruth: false,
                currentTruth: true,
            } as unknown as Parameters<typeof evaluateOrEdges>[0]),
        ).toEqual({ triggered: false, reason: 'untrusted_evaluation' });
    });
});

describe('test-runner issuer seam', () => {
    it('receives the centralized compile-time test marker under Vitest', () => {
        expect(SMART_ORDER_OBSERVATION_TEST_ONLY).toBeDefined();
    });
});
