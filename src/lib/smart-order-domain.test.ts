import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_CONFIRMATION_SCHEMA_VERSION,
    SMART_ORDER_DOMAIN_TEST_ONLY,
    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS,
    SMART_ORDER_STRATEGY_SCHEMA_VERSION,
    SmartOrderDomainError,
    canonicalContractKey,
    classifyAutomationIntent,
    classifyRequestReplay,
    clientRequestId,
    createCanonicalConfirmation,
    domainId,
    fixedAccountRef,
    hashCanonicalPayload,
    isActivationTerminal,
    isBrokerOrderTerminal,
    isOrderIntentTerminal,
    isPendingProtectionCommitmentTerminal,
    isProtectionLegEvaluationTerminal,
    isProtectionObligationTerminal,
    isRuntimeEpochTerminal,
    isStrategyTerminal,
    isUnknownOutcome,
    parseStrategyDefinition,
    stableSerializeCanonical,
    transitionActivation,
    transitionBrokerOrder,
    transitionEntryExposureReservation,
    transitionExitClaim,
    transitionExternalSellClaim,
    transitionOrderIntent,
    transitionPendingProtectionCommitment,
    transitionProtectionLegEvaluation,
    transitionProtectionObligation,
    transitionRuntimeEpoch,
    transitionStrategy,
    validateCanonicalConfirmation,
    type Activation,
    type AutomationIntentCandidate,
    type AutomationClassificationContext,
    type BrokerLongPositionEvidenceInput,
    type CanonicalContractMetadataInput,
    type CanonicalOrderSpecification,
    type CanonicalConfirmationSnapshot,
    type CanonicalValue,
    type EntryExposureReservation,
    type ExitClaim,
    type ExternalSellClaim,
    type PendingProtectionCommitment,
    type ProtectionObligation,
    type ProtectionLegEvaluation,
    type Strategy,
    type StrategyDefinition,
    type StrategyKind,
    type StrategyPayloadByKind,
    type RuntimeEpoch,
} from './smart-order-domain';
import {
    commonLots,
    contractUnit,
    shares,
} from './smart-order-domain-money';

function expectDomainError(
    action: () => unknown,
    code: SmartOrderDomainError['code'],
): void {
    try {
        action();
        throw new Error('expected SmartOrderDomainError');
    } catch (error) {
        expect(error).toBeInstanceOf(SmartOrderDomainError);
        expect((error as SmartOrderDomainError).code).toBe(code);
    }
}

const strategyId = domainId('strategy-1', 'StrategyId');
const activationId = domainId('activation-1', 'ActivationId');
const accountRef = fixedAccountRef('fixed-account-ref-1');
const contract2330 = canonicalContractKey('TSE:STK:2330');
const contract2303 = canonicalContractKey('TSE:STK:2303');
function requireTestOnlyIssuer() {
    if (!SMART_ORDER_DOMAIN_TEST_ONLY) {
        throw new Error('smart-order domain test-only issuer is unavailable');
    }
    return SMART_ORDER_DOMAIN_TEST_ONLY;
}
const testOnly = requireTestOnlyIssuer();

function orderSpecification(
    overrides: Partial<CanonicalOrderSpecification> = {},
): CanonicalOrderSpecification {
    return {
        contractKey: contract2330,
        side: 'Buy',
        orderCond: 'Cash',
        orderLot: 'Common',
        baseShares: '1000',
        commonLots: '1',
        contractUnit: '1000',
        priceType: 'LMT',
        limitPrice: '100',
        timeInForce: 'ROD',
        policyRevision: 'order-policy-1',
        ...overrides,
    };
}

const quoteCondition = () => ({
    field: 'last_price' as const,
    comparator: 'gte' as const,
    threshold: '100',
    mappingRevision: 'quote-mapping-1',
});

const validity = () => ({
    startDate: '2026-08-11',
    endDate: '2026-08-11',
    calendarVersion: 'tw-calendar-1',
});

function strategyParameters(
    kind: StrategyKind,
): StrategyPayloadByKind[StrategyKind] {
    switch (kind) {
        case 'quick':
            return {
                payloadSchemaVersion:
                    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.quick,
                monitorContractKey: contract2330,
                condition: quoteCondition(),
                order: orderSpecification(),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'good_till':
            return {
                payloadSchemaVersion:
                    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.good_till,
                monitorContractKey: contract2303,
                condition: quoteCondition(),
                order: orderSpecification(),
                validity: validity(),
                activationPolicy: 'require_rearm',
                targetBaseShares: '3000',
                perOrderMaxBaseShares: '1000',
            };
        case 'multi_condition':
            return {
                payloadSchemaVersion:
                    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.multi_condition,
                conditions: [
                    {
                        monitorContractKey: contract2330,
                        condition: quoteCondition(),
                    },
                    {
                        monitorContractKey: contract2303,
                        condition: {
                            ...quoteCondition(),
                            comparator: 'lte',
                        },
                    },
                ],
                operator: 'AND',
                order: orderSpecification(),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'parent_child':
            return {
                payloadSchemaVersion:
                    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.parent_child,
                parent: {
                    monitorContractKey: contract2330,
                    condition: quoteCondition(),
                    order: orderSpecification(),
                },
                child: {
                    monitorContractKey: contract2303,
                    condition: quoteCondition(),
                    order: orderSpecification({
                        contractKey: contract2303,
                        side: 'Sell',
                    }),
                    cutoffTime: '13:30:00',
                },
                parentValidity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'stop_take':
            return {
                payloadSchemaVersion:
                    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.stop_take,
                positionContractKey: contract2330,
                monitorContractKey: contract2330,
                positionEvidenceRevision: 'position-1',
                basisPrice: '100',
                basisSource: 'broker_average_cost',
                legs: [
                    {
                        legId: 'stop-leg',
                        type: 'stop',
                        distance: { kind: 'pct_bps', pctBps: 500 },
                        triggerPrice: '95',
                        triggerTicks: '190',
                    },
                    {
                        legId: 'take-leg',
                        type: 'take',
                        distance: { kind: 'pct_bps', pctBps: 500 },
                        triggerPrice: '105',
                        triggerTicks: '210',
                    },
                ],
                order: orderSpecification({ side: 'Sell' }),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'trailing_exit':
            return {
                payloadSchemaVersion:
                    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.trailing_exit,
                positionContractKey: contract2330,
                monitorContractKey: contract2330,
                positionEvidenceRevision: 'position-1',
                positionCost: '100',
                activationPrice: '105',
                retracement: { kind: 'pct_bps', pctBps: 500 },
                fixedStopPrice: '95',
                order: orderSpecification({ side: 'Sell' }),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'scheduled_quantity':
            return {
                payloadSchemaVersion:
                    SMART_ORDER_STRATEGY_PAYLOAD_SCHEMA_VERSIONS.scheduled_quantity,
                mode: 'timed',
                order: orderSpecification(),
                validity: validity(),
                targetBaseShares: '1000',
                startTime: '09:00:00',
                endTime: '13:30:00',
                intervalSeconds: 1800,
                perOrderBaseShares: null,
                algorithmStatus: 'disabled_unverified',
            };
    }
}

function strategyDefinition(kind: StrategyKind): StrategyDefinition {
    return parseStrategyDefinition({
        schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
        decisionTableVersion: '2026-08-11.2',
        kind,
        parameters: strategyParameters(kind),
    });
}

function draftStrategy(): Strategy {
    return {
        id: strategyId,
        state: 'draft',
        revision: 0,
        definition: strategyDefinition('trailing_exit'),
        lineage: { rootStrategyId: strategyId },
    };
}

describe('smart-order versioned definitions and state machines', () => {
    it('covers the seven versioned discriminated strategy kinds', () => {
        const kinds: StrategyKind[] = [
            'quick',
            'good_till',
            'multi_condition',
            'parent_child',
            'stop_take',
            'trailing_exit',
            'scheduled_quantity',
        ];
        expect(kinds.map(strategyDefinition)).toEqual(
            kinds.map((kind) =>
                expect.objectContaining({
                    schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
                    kind,
                }),
            ),
        );
        const parsed = strategyDefinition('quick');
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.parameters)).toBe(true);
    });

    it('parses only the separate single-day disabled scheduled mode field shapes', () => {
        const timed = strategyParameters(
            'scheduled_quantity',
        ) as StrategyPayloadByKind['scheduled_quantity'];
        const quantity = {
            ...timed,
            mode: 'quantity' as const,
            endTime: null,
            targetBaseShares: '5000',
            perOrderBaseShares: '2000',
        };
        const parseScheduled = (parameters: unknown) =>
            parseStrategyDefinition({
                schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
                decisionTableVersion: '2026-08-11.2',
                kind: 'scheduled_quantity',
                parameters,
            });

        expect(parseScheduled(timed).kind).toBe('scheduled_quantity');
        expect(parseScheduled(quantity).kind).toBe('scheduled_quantity');
        for (const invalid of [
            { ...timed, endTime: null },
            { ...timed, perOrderBaseShares: '1000' },
            { ...quantity, endTime: '13:30:00' },
            { ...quantity, perOrderBaseShares: null },
            {
                ...timed,
                validity: { ...timed.validity, endDate: '2026-08-12' },
            },
        ]) {
            expectDomainError(
                () => parseScheduled(invalid),
                'invalid_strategy_definition',
            );
        }
    });

    it('strictly parses kind-specific payloads and rejects cross-kind, missing or unknown fields', () => {
        expectDomainError(
            () =>
                parseStrategyDefinition({
                    schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
                    decisionTableVersion: '2026-08-11.2',
                    kind: 'quick',
                    parameters: strategyParameters('trailing_exit'),
                }),
            'invalid_strategy_definition',
        );
        const stopTake = strategyParameters(
            'stop_take',
        ) as StrategyPayloadByKind['stop_take'];
        expectDomainError(
            () =>
                parseStrategyDefinition({
                    schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
                    decisionTableVersion: '2026-08-11.2',
                    kind: 'stop_take',
                    parameters: {
                        ...stopTake,
                        legs: [
                            stopTake.legs[0],
                            {
                                ...stopTake.legs[1],
                                legId: stopTake.legs[0]!.legId,
                            },
                        ],
                    },
                }),
            'invalid_strategy_definition',
        );
        const quick = strategyParameters('quick') as StrategyPayloadByKind['quick'];
        const { condition: _missing, ...missingCondition } = quick;
        expectDomainError(
            () =>
                parseStrategyDefinition({
                    schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
                    decisionTableVersion: '2026-08-11.2',
                    kind: 'quick',
                    parameters: missingCondition,
                }),
            'invalid_strategy_definition',
        );
        expectDomainError(
            () =>
                parseStrategyDefinition({
                    schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
                    decisionTableVersion: '2026-08-11.2',
                    kind: 'quick',
                    parameters: {
                        ...quick,
                        condition: {
                            ...quick.condition,
                            browserOverride: true,
                        },
                    },
                }),
            'invalid_strategy_definition',
        );
        expectDomainError(
            () =>
                parseStrategyDefinition({
                    schemaVersion: SMART_ORDER_STRATEGY_SCHEMA_VERSION,
                    decisionTableVersion: '2026-08-11.2',
                    kind: 'quick',
                    parameters: quick,
                    extra: 'not-versioned',
                }),
            'invalid_strategy_definition',
        );
    });

    it('permanently denies the legacy adjacency-only transition authority', () => {
        expectDomainError(
            () =>
                transitionStrategy(draftStrategy(), 'observing', {
                    expectedRevision: 0,
                    reasonCode: 'USER_CONFIRMATION_ACCEPTED',
                }),
            'legacy_transition_authority_unavailable',
        );
        expectDomainError(
            () =>
                transitionOrderIntent({} as never, 'prepared', {
                    expectedRevision: 0,
                    reasonCode: 'INTENT_PREPARED_DURABLE',
                }),
            'legacy_transition_authority_unavailable',
        );
        expectDomainError(
            () =>
                transitionBrokerOrder({} as never, 'submitted', {
                    expectedRevision: 0,
                    reasonCode: 'BROKER_SUBMITTED_OBSERVED',
                }),
            'legacy_transition_authority_unavailable',
        );
        expect(draftStrategy()).toMatchObject({ state: 'draft', revision: 0 });
    });

    it('does not provide a generic resume out of manual intervention', () => {
        const manual: Strategy = {
            ...draftStrategy(),
            state: 'manual_intervention',
            revision: 7,
        };
        expectDomainError(
            () =>
                transitionStrategy(manual, 'monitoring', {
                    expectedRevision: 7,
                    reasonCode: 'MANUAL_RESOLUTION_RECONFIRMED',
                }),
            'legacy_transition_authority_unavailable',
        );
    });

    it('keeps terminal classification readable while legacy transition writes stay unavailable', () => {
        const activation: Activation = {
            id: activationId,
            state: 'unknown',
            revision: 3,
            lineage: {
                strategyId,
                deterministicActivationKey: 'strategy-1:2026-08-11:edge-1',
            },
        };
        expectDomainError(
            () =>
                transitionActivation(activation, 'part_filled', {
                    expectedRevision: 3,
                    reasonCode: 'MANUAL_FINAL_EVIDENCE_APPLIED',
                }),
            'legacy_transition_authority_unavailable',
        );
        expect(isUnknownOutcome('unknown')).toBe(true);
        expect(isActivationTerminal('unknown')).toBe(false);
        expect(isActivationTerminal('filled')).toBe(true);
        expect(isActivationTerminal('missed')).toBe(true);
        const loser: ProtectionLegEvaluation = {
            id: 'leg-evaluation-1',
            activationId,
            protectionGroupId: 'protection-group-1',
            remainderGeneration: 1,
            legId: 'take-leg',
            state: 'candidate',
            revision: 0,
        };
        expectDomainError(
            () =>
                transitionProtectionLegEvaluation(loser, 'suppressed', {
                    expectedRevision: 0,
                    reasonCode: 'OCO_SIBLING_SUPPRESSED',
                }),
            'legacy_transition_authority_unavailable',
        );
        expect(isProtectionLegEvaluationTerminal('suppressed')).toBe(true);
    });

    it('reports terminal semantics separately for every state layer', () => {
        expect(isStrategyTerminal('completed')).toBe(true);
        expect(isStrategyTerminal('expired_with_obligation')).toBe(false);
        expect(isOrderIntentTerminal('terminal')).toBe(true);
        expect(isOrderIntentTerminal('reconciling')).toBe(false);
        expect(isBrokerOrderTerminal('inactive')).toBe(true);
        expect(isBrokerOrderTerminal('part_filled')).toBe(false);
        expect(isPendingProtectionCommitmentTerminal('materialized')).toBe(
            true,
        );
        expect(isProtectionObligationTerminal('safety_blocked')).toBe(false);
        expect(isRuntimeEpochTerminal('superseded')).toBe(true);
    });

    it('does not let arbitrary inputs revive the retired legacy authority', () => {
        expectDomainError(
            () =>
                transitionStrategy(draftStrategy(), 'observing', {
                    expectedRevision: 0,
                    reasonCode: 'arbitrary text' as never,
                }),
            'legacy_transition_authority_unavailable',
        );
    });

    it('does not let recovery auto-arm and keeps RuntimeEpoch terminal one-way', () => {
        expectDomainError(
            () =>
                transitionStrategy(draftStrategy(), 'monitoring', {
                    expectedRevision: 0,
                    reasonCode: 'USER_RESUME_AND_ARM_CONFIRMED',
                }),
            'legacy_transition_authority_unavailable',
        );
        const recovery: Strategy = {
            ...draftStrategy(),
            state: 'recovery',
            revision: 4,
        };
        expectDomainError(
            () =>
                transitionStrategy(recovery, 'monitoring', {
                    expectedRevision: 4,
                    reasonCode: 'RECOVERY_RECONCILED_REARM_REQUIRED',
                }),
            'legacy_transition_authority_unavailable',
        );

        const epochId = domainId('runtime-epoch-1', 'RuntimeEpochId');
        const stopped: RuntimeEpoch = {
            id: epochId,
            state: 'stopped',
            revision: 6,
            senderEpoch: 'sender-1',
            apiGeneration: 'api-1',
            quoteStreamEpoch: 'stream-1',
            simulationAttested: true,
        };
        expectDomainError(
            () =>
                transitionRuntimeEpoch(stopped, 'starting', {
                    expectedRevision: 6,
                    reasonCode: 'RUNTIME_EPOCH_CREATED',
                }),
            'legacy_transition_authority_unavailable',
        );
    });

    it('keeps protection, reservation and claim layers in separate lineages', () => {
        const intentId = domainId('intent-1', 'OrderIntentId');
        const commitmentId = domainId(
            'commitment-1',
            'ProtectionCommitmentId',
        );
        const obligationId = domainId(
            'obligation-1',
            'ProtectionObligationId',
        );
        const reservationId = domainId(
            'reservation-1',
            'EntryExposureReservationId',
        );
        const claimId = domainId('claim-1', 'ExitClaimId');
        const accountRef = domainId('account-ref-1', 'FixedAccountRef');
        const contractKey = domainId(
            'TSE:STK:2330',
            'CanonicalContractKey',
        );

        const commitment: PendingProtectionCommitment = {
            id: commitmentId,
            state: 'prepared',
            revision: 0,
            lineage: { strategyId, entryIntentId: intentId },
            promisedShares: shares(1_000),
        };
        expectDomainError(
            () =>
                transitionPendingProtectionCommitment(
                    commitment,
                    'entry_dispatching',
                    {
                        expectedRevision: 0,
                        reasonCode: 'ENTRY_DISPATCH_FENCE_COMMITTED',
                    },
                ),
            'legacy_transition_authority_unavailable',
        );

        const obligation: ProtectionObligation = {
            id: obligationId,
            state: 'pending_entry',
            revision: 0,
            lineage: { strategyId, commitmentId },
            filledShares: shares(0),
            confirmedExitedShares: shares(0),
            activelyCoveredShares: shares(0),
        };
        expectDomainError(
            () =>
                transitionProtectionObligation(obligation, 'monitoring', {
                    expectedRevision: 0,
                    reasonCode: 'PROTECTION_CLAIM_CREATED_FROM_FILL',
                }),
            'legacy_transition_authority_unavailable',
        );

        const reservation: EntryExposureReservation = {
            id: reservationId,
            state: 'reserved',
            revision: 0,
            lineage: { strategyId, orderIntentId: intentId },
            reservedShares: shares(1_000),
            policyRevision: 3,
        };
        expectDomainError(
            () =>
                transitionEntryExposureReservation(reservation, 'released', {
                    expectedRevision: 0,
                    reasonCode: 'ENTRY_RESERVATION_RELEASED',
                }),
            'legacy_transition_authority_unavailable',
        );

        const claim: ExitClaim = {
            id: claimId,
            claimKind: 'runtime',
            state: 'monitoring_reserved',
            revision: 0,
            lineage: {
                strategyId,
                obligationId,
                protectionGroupId: 'protection-group-1',
                remainderGeneration: 1,
            },
            fixedAccountRef: accountRef,
            contractKey,
            claimedShares: shares(1_000),
        };
        expectDomainError(
            () =>
                transitionExitClaim(claim, 'intent_reserved', {
                    expectedRevision: 0,
                    reasonCode: 'OCO_WINNER_SELECTED',
                }),
            'legacy_transition_authority_unavailable',
        );

        const external: ExternalSellClaim = {
            id: domainId('external-claim-1', 'ExitClaimId'),
            claimKind: 'external_sell',
            state: 'broker_working',
            revision: 0,
            lineage: {
                brokerEvidenceKey: 'evidence-1',
                brokerOrderRevision: 'broker-revision-1',
            },
            fixedAccountRef: accountRef,
            contractKey,
            claimedShares: shares(1_000),
        };
        expectDomainError(
            () =>
                transitionExternalSellClaim(external, 'consumed', {
                    expectedRevision: 0,
                    reasonCode: 'EXIT_CLAIM_CONSUMED_CONFIRMED',
                }),
            'legacy_transition_authority_unavailable',
        );
    });
});

function confirmationSnapshot(): CanonicalConfirmationSnapshot {
    return {
        schemaVersion: SMART_ORDER_CONFIRMATION_SCHEMA_VERSION,
        strategyKind: 'trailing_exit',
        strategyDefinition: strategyDefinition('trailing_exit') as Extract<
            StrategyDefinition,
            { readonly kind: 'trailing_exit' }
        >,
        simulation: true,
        fixedAccountRef: accountRef,
        identityGroupDigest: `sha256:${'a'.repeat(64)}`,
        monitorContractKeys: [contract2330],
        contractKey: contract2330,
        baseShares: '1000',
        commonLots: '1',
        contractUnit: '1000',
        riskRevision: 9,
        contractRevision: 'contract-2026-08-11',
        modeGeneration: 'mode-generation-3',
        runtimeEpochId: domainId('runtime-epoch-4', 'RuntimeEpochId'),
        runtimeEpochRevision: 2,
        localRuntimeDisclosureVersion: 'local-runtime-disclosure-1',
        warningCodes: ['local-runtime-not-cloud', 'restart-requires-rearm'],
    };
}

describe('smart-order canonical confirmation and replay', () => {
    it('stable-serializes key order and hashes the canonical bytes with SHA-256', async () => {
        const left = { b: 2, a: 1 } as const;
        const right = { a: 1, b: 2 } as const;
        expect(stableSerializeCanonical(left)).toBe('{"a":1,"b":2}');
        expect(stableSerializeCanonical(left)).toBe(
            stableSerializeCanonical(right),
        );
        expect(await hashCanonicalPayload(left)).toBe(
            'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
        );
    });

    it('rejects floats, undefined values, custom prototypes and cycles', () => {
        expectDomainError(
            () => stableSerializeCanonical({ price: 1.1 }),
            'non_canonical_value',
        );
        expectDomainError(
            () =>
                stableSerializeCanonical({
                    bad: undefined,
                } as unknown as CanonicalValue),
            'non_canonical_value',
        );
        expectDomainError(
            () =>
                stableSerializeCanonical(
                    new Date() as unknown as CanonicalValue,
                ),
            'non_canonical_value',
        );
        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;
        expectDomainError(
            () => stableSerializeCanonical(cyclic as CanonicalValue),
            'canonical_cycle',
        );
        const sparse = new Array<CanonicalValue>(2);
        expectDomainError(
            () => stableSerializeCanonical(sparse),
            'non_canonical_value',
        );
        const accessor = {} as Record<string, CanonicalValue>;
        Object.defineProperty(accessor, 'value', {
            enumerable: true,
            get: () => 'stateful',
        });
        expectDomainError(
            () => stableSerializeCanonical(accessor),
            'non_canonical_value',
        );
    });

    it('invalidates confirmation after any bound field changes or stored bytes are tampered', async () => {
        const envelope = await createCanonicalConfirmation({
            clientRequestId: clientRequestId('request_20260811_0001'),
            snapshot: confirmationSnapshot(),
        });
        expect(Object.isFrozen(envelope.snapshot)).toBe(true);
        expect(Object.isFrozen(envelope.snapshot.strategyDefinition)).toBe(true);
        await expect(
            validateCanonicalConfirmation(envelope, confirmationSnapshot()),
        ).resolves.toEqual({ valid: true });
        await expect(
            validateCanonicalConfirmation(envelope, {
                ...confirmationSnapshot(),
                riskRevision: 10,
            }),
        ).resolves.toEqual({
            valid: false,
            reason: 'confirmation_fields_changed',
        });
        await expect(
            validateCanonicalConfirmation(
                { ...envelope, serializedPayload: '{}' },
                confirmationSnapshot(),
            ),
        ).resolves.toEqual({
            valid: false,
            reason: 'confirmed_payload_tampered',
        });
        await expect(
            createCanonicalConfirmation({
                clientRequestId: clientRequestId('request_20260811_0003'),
                snapshot: {
                    ...confirmationSnapshot(),
                    runtimeEpochRevision: -1,
                },
            }),
        ).rejects.toMatchObject({ code: 'invalid_confirmation_snapshot' });
    });

    it('rejects incomplete, unknown, cross-kind and inconsistent confirmation fields', async () => {
        const requestId = clientRequestId('request_20260811_0099');
        const rejectSnapshot = async (snapshot: unknown): Promise<void> => {
            await expect(
                createCanonicalConfirmation({
                    clientRequestId: requestId,
                    snapshot: snapshot as CanonicalConfirmationSnapshot,
                }),
            ).rejects.toMatchObject({ code: 'invalid_confirmation_snapshot' });
        };

        await rejectSnapshot({
            ...confirmationSnapshot(),
            contractUnit: '500',
        });
        await rejectSnapshot({
            ...confirmationSnapshot(),
            baseShares: '2000',
        });
        await rejectSnapshot({
            ...confirmationSnapshot(),
            strategyKind: 'quick',
        });
        const { warningCodes: _missing, ...missingWarnings } =
            confirmationSnapshot();
        await rejectSnapshot(missingWarnings);
        await rejectSnapshot({
            ...confirmationSnapshot(),
            browserApproved: true,
        });
    });

    it('permits only same-ID same-payload replay', async () => {
        const requestId = clientRequestId('request_20260811_0002');
        const payloadHash = await hashCanonicalPayload(
            confirmationSnapshot() as unknown as CanonicalValue,
        );
        expect(
            classifyRequestReplay(undefined, {
                clientRequestId: requestId,
                payloadHash,
            }),
        ).toBe('new_request');
        const previous = { clientRequestId: requestId, payloadHash };
        expect(
            classifyRequestReplay(previous, {
                clientRequestId: requestId,
                payloadHash,
            }),
        ).toBe('idempotent_replay');
        expect(
            classifyRequestReplay(previous, {
                clientRequestId: requestId,
                payloadHash: await hashCanonicalPayload({ changed: true }),
            }),
        ).toBe('reject_request_id_payload_mismatch');
    });

    it('rejects short or ambiguous client request IDs', () => {
        expectDomainError(
            () => clientRequestId('short'),
            'invalid_client_request_id',
        );
    });
});

function automationCandidate(
    overrides: Partial<AutomationIntentCandidate> = {},
): AutomationIntentCandidate {
    return {
        fixedAccountRef: accountRef,
        contractKey: contract2330,
        securityType: 'STK',
        exchange: 'TSE',
        instrumentClass: 'stock',
        orderCond: 'Cash',
        orderLot: 'Common',
        side: 'Buy',
        positionEffect: 'open_long',
        dayTradeShort: false,
        requestedShares: shares(1_000),
        requestedCommonLots: commonLots(1),
        contractUnit: contractUnit(1_000),
        contractMetadata: contractMetadata(),
        ...overrides,
    };
}

const automationContext: AutomationClassificationContext = {
    evaluatedAtEpochMs: 1_000_000,
    maximumEvidenceAgeMs: 5_000,
    requiredReconciliationRevision: 'reconciliation-7',
    requiredContractMetadataRevision: 'contract-metadata-7',
};

function contractMetadata(
    overrides: Partial<CanonicalContractMetadataInput> = {},
) {
    return testOnly.issueCanonicalContractMetadata({
        contractKey: contract2330,
        exchange: 'TSE',
        securityType: 'STK',
        category: 'stock',
        contractUnit: contractUnit(1_000),
        metadataRevision: 'contract-metadata-7',
        ...overrides,
    });
}

function brokerEvidence(
    overrides: Partial<BrokerLongPositionEvidenceInput> = {},
) {
    return testOnly.issueBrokerLongPositionEvidence({
        fixedAccountRef: accountRef,
        contractKey: contract2330,
        asOfEpochMs: 999_000,
        reconciliationRevision: 'reconciliation-7',
        reconciled: true,
        completeWorkingSellSet: true,
        positionSide: 'long',
        availableLongShares: shares(2_000),
        positionRevision: 'position-revision-7',
        ...overrides,
    });
}

describe('smart-order automation classifier', () => {
    it('admits only the candidate Cash Common long-entry subset', () => {
        expect(
            classifyAutomationIntent(automationCandidate(), automationContext),
        ).toEqual({
            classification: 'supported',
            automationClass: 'cash_common_long_entry',
            exposure: 'increase_long',
            localReduceOnly: false,
        });
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    instrumentClass: 'etf',
                    contractMetadata: contractMetadata({ category: 'etf' }),
                }),
                automationContext,
            ),
        ).toMatchObject({ classification: 'supported' });
    });

    it('uses the verifier-issued ETF contract unit instead of assuming 1000 Share', () => {
        const etfUnit = contractUnit(500);
        const trustedEtf = automationCandidate({
            instrumentClass: 'etf',
            requestedShares: shares(500),
            requestedCommonLots: commonLots(1),
            contractUnit: etfUnit,
            contractMetadata: contractMetadata({
                category: 'etf',
                contractUnit: etfUnit,
            }),
        });
        expect(
            classifyAutomationIntent(trustedEtf, automationContext),
        ).toMatchObject({
            classification: 'supported',
            automationClass: 'cash_common_long_entry',
        });
        expect(
            classifyAutomationIntent(
                { ...trustedEtf, requestedShares: shares(1_000) },
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'invalid_quantity',
        });
    });

    it('admits a sell only with fresh account-scoped local reduce-only evidence', () => {
        const sell = automationCandidate({
            side: 'Sell',
            positionEffect: 'reduce_long',
            brokerEvidence: brokerEvidence(),
        });
        expect(classifyAutomationIntent(sell, automationContext)).toEqual({
            classification: 'supported',
            automationClass: 'cash_common_local_reduce_only',
            exposure: 'reduce_long',
            localReduceOnly: true,
        });
        expect(
            classifyAutomationIntent(
                { ...sell, brokerEvidence: undefined },
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'reduce_only_evidence_missing',
        });
        expect(
            classifyAutomationIntent({
                ...sell,
                brokerEvidence: brokerEvidence({
                    completeWorkingSellSet: false,
                }),
            }, automationContext),
        ).toEqual({
            classification: 'unsupported',
            reason: 'reduce_only_evidence_stale_or_incomplete',
        });
        expect(
            classifyAutomationIntent({
                ...sell,
                brokerEvidence: brokerEvidence({ contractKey: contract2303 }),
            }, automationContext),
        ).toEqual({
            classification: 'unsupported',
            reason: 'reduce_only_account_or_contract_mismatch',
        });
    });

    it('rejects raw identities, untrusted evidence, stale as-of and revision drift', () => {
        expectDomainError(
            () => canonicalContractKey('not-a-contract'),
            'invalid_identifier',
        );
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    fixedAccountRef: '' as never,
                    contractKey: '' as never,
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'invalid_account_or_contract',
        });
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    contractKey: canonicalContractKey('OTC:STK:6488'),
                    contractMetadata: contractMetadata({
                        contractKey: canonicalContractKey('OTC:STK:6488'),
                        exchange: 'OTC',
                    }),
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'unsupported_exchange',
        });

        const forgedEvidence = {
            source: 'account_scoped_reconciliation',
            fixedAccountRef: accountRef,
            contractKey: contract2330,
            asOfEpochMs: 999_000,
            reconciliationRevision: 'reconciliation-7',
            reconciled: true,
            completeWorkingSellSet: true,
            positionSide: 'long',
            availableLongShares: shares(2_000),
            positionRevision: 'position-revision-7',
        } as unknown as NonNullable<AutomationIntentCandidate['brokerEvidence']>;
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    side: 'Sell',
                    positionEffect: 'reduce_long',
                    brokerEvidence: forgedEvidence,
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'reduce_only_evidence_untrusted',
        });
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    side: 'Sell',
                    positionEffect: 'reduce_long',
                    brokerEvidence: brokerEvidence({ asOfEpochMs: 990_000 }),
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'reduce_only_evidence_stale_or_incomplete',
        });
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    side: 'Sell',
                    positionEffect: 'reduce_long',
                    brokerEvidence: brokerEvidence({
                        reconciliationRevision: 'reconciliation-6',
                    }),
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'reduce_only_evidence_revision_mismatch',
        });
    });

    it('requires trusted canonical contract metadata and exact category, unit and revision binding', () => {
        const forgedMetadata = {
            source: 'canonical_contract_repository',
            contractKey: contract2330,
            exchange: 'TSE',
            securityType: 'STK',
            category: 'stock',
            contractUnit: contractUnit(1),
            metadataRevision: 'contract-metadata-7',
        } as unknown as AutomationIntentCandidate['contractMetadata'];
        expect(
            classifyAutomationIntent(
                automationCandidate({ contractMetadata: forgedMetadata }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'canonical_contract_metadata_missing_or_untrusted',
        });
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    requestedShares: shares(1),
                    requestedCommonLots: commonLots(1),
                    contractUnit: contractUnit(1),
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'canonical_contract_metadata_mismatch',
        });
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    instrumentClass: 'etf',
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'canonical_contract_metadata_mismatch',
        });
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    contractMetadata: contractMetadata({
                        metadataRevision: 'contract-metadata-6',
                    }),
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'canonical_contract_metadata_revision_mismatch',
        });
    });

    it.each([
        [{ orderCond: 'MarginTrading' }, 'unsupported_order_cond'],
        [{ orderLot: 'IntradayOdd' }, 'unsupported_order_lot'],
        [
            { side: 'Sell', positionEffect: 'short', dayTradeShort: true },
            'short_or_unknown_position_effect',
        ],
        [{ securityType: 'FUT' }, 'unsupported_security'],
        [{ exchange: 'OES' }, 'unsupported_exchange'],
        [{ instrumentClass: 'unknown' }, 'unknown_instrument_class'],
        [
            { requestedShares: shares(999) },
            'invalid_quantity',
        ],
    ] as const)(
        'rejects unsupported automation candidate %#',
        (overrides, reason) => {
            expect(
                classifyAutomationIntent(
                    automationCandidate(
                        overrides as Partial<AutomationIntentCandidate>,
                    ),
                    automationContext,
                ),
            ).toEqual({ classification: 'unsupported', reason });
        },
    );

    it('rejects a reduce-only quantity above the latest available long shares', () => {
        expect(
            classifyAutomationIntent(
                automationCandidate({
                    side: 'Sell',
                    positionEffect: 'reduce_long',
                    brokerEvidence: brokerEvidence({
                        availableLongShares: shares(500),
                        positionRevision: 'position-revision-8',
                    }),
                }),
                automationContext,
            ),
        ).toEqual({
            classification: 'unsupported',
            reason: 'reduce_only_quantity_exceeded',
        });
    });
});
