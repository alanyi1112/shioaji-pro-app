import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    BROKER_ORDER_QUANTITY_EVIDENCE_SCHEMA_VERSION,
    SMART_ORDER_EDGE_REGISTRY,
    SMART_ORDER_REASON_REGISTRY,
    SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION,
    SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256,
    SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION,
    SmartOrderStateMachineError,
    createDraftStrategy,
    createStateEntity,
    getStateEdgeDefinition,
    isBlockingState,
    isTerminalState,
    transitionStateEntity,
    type Activation,
    type AtomicCompanionKind,
    type AtomicCompanionProof,
    type AuthorizationEvidence,
    type BrokerOrder,
    type CompanionOwnerKind,
    type EntityKind,
    type EntryExposureReservation,
    type EntryProtectionAtomicBinding,
    type ExitClaim,
    type ExitProtectionAtomicBinding,
    type ExternalSellClaim,
    type IntentOwner,
    type NewEntityByKind,
    type OrderIntent,
    type PendingProtectionCommitment,
    type ProtectionObligation,
    type ReasonCode,
    type ResolutionCaseLink,
    type RuntimeEpoch,
    type SafetyBlocker,
    type StateEdgeDefinition,
    type TransitionEvidence,
    type StateTransitionRequest,
} from './smart-order-state-machine';
import {
    SMART_ORDER_RESOLUTION_TEST_ONLY,
    SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION,
    evaluateBlockingStateResolution,
    evaluateManualResolution,
    getBlockingResolutionRequiredEvidence,
    getSafetyBlockerResolutionRequiredEvidence,
    type BlockingResolutionReasonCode,
    type ResolutionEvidenceClass,
    type ResolutionStateTransitionBinding,
    type SafetyBlockerResolutionBinding,
} from './smart-order-resolution-domain';

if (!SMART_ORDER_RESOLUTION_TEST_ONLY) {
    throw new Error('smart-order resolution test issuer surface is unavailable');
}

const {
    issueAuthorization: issueResolutionAuthorizationForTest,
    issueEvidence: issueResolutionEvidenceForTest,
    issueEvidenceSet: issueResolutionEvidenceSetForTest,
    issueRuntimeContext: issueResolutionRuntimeContextForTest,
    issueSafetyBlockerSuccessor:
        issueSafetyBlockerSuccessorForTest,
    issueBreakGlassAuthorization: issueBreakGlassAuthorizationForTest,
    issueBreakGlassStepOne: issueBreakGlassStepOneForTest,
    issueBreakGlassStepTwo: issueBreakGlassStepTwoForTest,
} = SMART_ORDER_RESOLUTION_TEST_ONLY;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-11T01:02:03.000Z';
const COMMITTED = '2026-08-11T01:02:04.000Z';
const RESOLUTION_SCOPE = `sha256:${'e'.repeat(64)}` as const;
const RESOLUTION_TARGET = `sha256:${HASH_A}` as const;
const RESOLUTION_EFFECT = `sha256:${HASH_B}` as const;
const BLOCKER_SCOPE_MEMBER_A = `sha256:${'1'.repeat(64)}` as const;
const BLOCKER_SCOPE_MEMBER_B = `sha256:${'2'.repeat(64)}` as const;
const BLOCKER_SCOPE_MEMBER_C = `sha256:${'3'.repeat(64)}` as const;

function expectMachineError(
    action: () => unknown,
    code: SmartOrderStateMachineError['code'],
): void {
    try {
        action();
        throw new Error('expected SmartOrderStateMachineError');
    } catch (error) {
        expect(error).toBeInstanceOf(SmartOrderStateMachineError);
        expect((error as SmartOrderStateMachineError).code).toBe(code);
    }
}

function edge(entityKind: EntityKind, edgeId: string): StateEdgeDefinition {
    const definition = getStateEdgeDefinition(entityKind, edgeId);
    if (!definition) throw new Error(`missing edge ${entityKind}:${edgeId}`);
    return definition;
}

function transitionBoundary(
    entityKind: EntityKind,
    entityId: string,
    edgeId: string,
    transitionReasonCode: ReasonCode,
    lineageGeneration = 0,
    expectedRevision = 1,
    lineageId = entityId,
): ResolutionStateTransitionBinding {
    const definition = edge(entityKind, edgeId);
    return {
        kind: 'state_transition',
        entityKind,
        entityId,
        lineageId,
        lineageGeneration,
        expectedRevision,
        effectProjectionSha256: RESOLUTION_EFFECT,
        edgeId,
        fromState: definition.from,
        toState: definition.to,
        transitionReasonCode,
    };
}

function requestFor(
    entityKind: EntityKind,
    edgeId: string,
    overrides: Partial<StateTransitionRequest> = {},
): StateTransitionRequest {
    const definition = edge(entityKind, edgeId);
    const defaultReasonCode = definition.reasonCodes[0];
    const defaultActorKind = definition.allowedActorKinds[0];
    const defaultProvenance = definition.brokerWriteProvenance[0];
    if (!defaultReasonCode || !defaultActorKind || !defaultProvenance) {
        throw new Error(`incomplete edge metadata for ${entityKind}:${edgeId}`);
    }
    const reasonCode = overrides.reasonCode ?? defaultReasonCode;
    const evidenceClass = definition.evidenceClassesByReason[reasonCode]?.[0];
    if (!evidenceClass) throw new Error(`missing evidence class for ${edgeId}`);
    return {
        transitionRequestId: `request-${entityKind}-${edgeId}`,
        requestPayloadHash: HASH_A,
        edgeId,
        expectedRevision: definition.from === '__create__' ? 0 : 1,
        actorKind: defaultActorKind,
        brokerWriteProvenance: defaultProvenance,
        reasonCode,
        evidence: [
            {
                evidenceId: `evidence-${edgeId}`,
                evidenceHash: HASH_B,
                evidenceClass,
            },
        ],
        authorizationEvidence: [],
        observedWallTime: NOW,
        observedWallTimeSource: 'repository_reconciliation',
        wallTimeTrustStatus: 'trusted',
        monotonicLocalSequence: 1,
        committedAt: COMMITTED,
        runtimeEpochId: 'epoch-1',
        apiGeneration: 'api-generation-1',
        scopeId: 'scope-1',
        atomicTransactionId: `tx-${edgeId}`,
        atomicCompanionProofs: [],
        effectProjectionSha256: RESOLUTION_EFFECT,
        ...overrides,
    };
}

function brokerQuantityEvidence(
    order: Pick<
        BrokerOrder,
        | 'brokerOrderId'
        | 'fixedAccountOpaqueRef'
        | 'tradeDate'
        | 'contractKey'
        | 'side'
        | 'brokerCorrelationHash'
    >,
    projection: Readonly<{
        quantityShares: bigint;
        filledShares: bigint;
        remainingShares: bigint;
    }>,
    outcome: 'accepted' | 'part_filled' | 'filled',
    finality: 'current' | 'unique_final',
    evidenceId: string,
): TransitionEvidence {
    return {
        evidenceId,
        evidenceHash: HASH_B,
        evidenceClass: 'BrokerDealOrderPositionEvidence',
        brokerOrderQuantity: {
            schemaVersion: BROKER_ORDER_QUANTITY_EVIDENCE_SCHEMA_VERSION,
            brokerOrderId: order.brokerOrderId,
            fixedAccountOpaqueRef: order.fixedAccountOpaqueRef,
            tradeDate: order.tradeDate,
            contractKey: order.contractKey,
            side: order.side,
            brokerCorrelationHash: order.brokerCorrelationHash,
            ...projection,
            outcome,
            finality,
        },
    };
}

function proof(
    kind: AtomicCompanionKind,
    request: StateTransitionRequest,
    entity: { lineageId: string; lineageGeneration: number },
    recordId: string,
    recordHash = HASH_C,
    ownerKind: CompanionOwnerKind = 'default',
    scopeId = request.scopeId,
): AtomicCompanionProof {
    return {
        companionKind: kind,
        recordId,
        recordHash,
        lineageId: entity.lineageId,
        lineageGeneration: entity.lineageGeneration,
        scopeId,
        transactionId: request.atomicTransactionId,
        reasonCode: request.reasonCode,
        ownerKind,
    };
}

const STRATEGY_OWNER: IntentOwner = {
    kind: 'strategy_activation',
    strategyId: 'strategy-1',
    activationId: 'activation-1',
};

function activationInput(
    overrides: Partial<NewEntityByKind<'activation'>> = {},
): NewEntityByKind<'activation'> {
    return {
        entityKind: 'activation',
        entityId: 'activation-1',
        lineageId: 'strategy-1/activation-1',
        lineageGeneration: 0,
        activationId: 'activation-1',
        runtimeEpochId: 'epoch-1',
        strategyId: 'strategy-1',
        strategyDefinitionHash: HASH_A,
        activationKind: 'edge',
        logicalKeyHash: HASH_B,
        intentPurpose: 'unprotected_place',
        dispatchOwner: STRATEGY_OWNER,
        intendedProvenance: 'automation',
        ...overrides,
    };
}

function intentInput(
    overrides: Partial<NewEntityByKind<'order_intent'>> = {},
): NewEntityByKind<'order_intent'> {
    return {
        entityKind: 'order_intent',
        entityId: 'intent-1',
        lineageId: 'strategy-1/activation-1/intent-1',
        lineageGeneration: 0,
        intentId: 'intent-1',
        operation: 'place',
        owner: STRATEGY_OWNER,
        purpose: 'unprotected_place',
        payloadHash: HASH_A,
        intendedProvenance: 'automation',
        ...overrides,
    };
}

function runtimeEpochInput(
    overrides: Partial<NewEntityByKind<'runtime_epoch'>> = {},
): NewEntityByKind<'runtime_epoch'> {
    return {
        entityKind: 'runtime_epoch',
        entityId: 'epoch-1',
        lineageId: 'runtime/epoch-1',
        lineageGeneration: 0,
        runtimeEpochId: 'epoch-1',
        processInstanceId: 'process-1',
        senderFence: 'sender-fence-1',
        apiGeneration: 'api-generation-1',
        modeMarkerRevision: 'mode-r1',
        manifestRevision: 'manifest-r1',
        fullReconciliationCompletedInEpoch: false,
        ...overrides,
    };
}

function resolutionLink(
    openingReasonCode: ReasonCode,
    state: ResolutionCaseLink['state'] = 'open',
    evidenceSnapshotSha256: `sha256:${string}` = `sha256:${HASH_B}`,
    scopeSha256: `sha256:${string}` = RESOLUTION_SCOPE,
): ResolutionCaseLink {
    return {
        resolutionCaseId: 'resolution-1',
        caseRevision: 1,
        safetyBlockerId: 'blocker-1',
        openingReasonCode,
        state,
        scopeSha256,
        targetSideEffectSha256: RESOLUTION_TARGET,
        evidenceSnapshotSha256,
        evidenceHash: evidenceSnapshotSha256.slice('sha256:'.length),
    };
}

async function canonicalResolutionEvidenceSet(
    reasonCode: BlockingResolutionReasonCode,
    resolutionCaseId = 'resolution-1',
    withUniqueFinal = false,
    extraEvidence: readonly ResolutionEvidenceClass[] = [],
    evidenceSha256ByClass: Readonly<
        Partial<Record<ResolutionEvidenceClass, `sha256:${string}`>>
    > = {},
) {
    const requiredEvidence = [
        ...new Set([
            ...getBlockingResolutionRequiredEvidence(reasonCode),
            ...extraEvidence,
        ]),
    ];
    if (requiredEvidence.length === 0) {
        throw new Error(`missing resolution evidence policy ${reasonCode}`);
    }
    const context = issueResolutionRuntimeContextForTest({
        reasonCode,
        resolutionCaseId,
        caseRevision: 1,
        scopeSha256: RESOLUTION_SCOPE,
        targetSideEffectSha256: RESOLUTION_TARGET,
        runtimeEpochId: 'epoch-1',
        apiGeneration: 'api-generation-1',
        nowEpochMs: Date.parse(NOW),
    });
    let finalAssigned = false;
    const evidence = requiredEvidence.map(
        (evidenceClass: ResolutionEvidenceClass, index) => {
            const isFinal =
                withUniqueFinal &&
                !finalAssigned &&
                ['broker_full_orders_trades_deals', 'canonical_broker_correlation'].includes(
                    evidenceClass,
                );
            if (isFinal) finalAssigned = true;
            return issueResolutionEvidenceForTest({
                context,
                evidenceClass,
                evidenceSha256:
                    evidenceSha256ByClass[evidenceClass] ??
                    `sha256:${String(index + 1).padStart(64, '0')}`,
                revision: `${reasonCode}-${evidenceClass}-${index}`,
                ...(isFinal ? { finality: 'unique_broker_terminal' as const } : {}),
            });
        },
    );
    const evidenceSet = await issueResolutionEvidenceSetForTest({
        context,
        evidence,
    });
    return { context, evidenceSet };
}

function blockerResolutionBinding(input: {
    blocker: SafetyBlocker;
    resolutionPath: SafetyBlockerResolutionBinding['resolutionPath'];
    successor?: SafetyBlockerResolutionBinding['successor'];
    gateApprovedZeroBoundsEvidenceSha256?: `sha256:${string}`;
}): SafetyBlockerResolutionBinding {
    return {
        policyVersion:
            SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION,
        blockerId: input.blocker.blockerId,
        blockerKind: input.blocker.blockerKind,
        resolutionCaseId: input.blocker.resolutionCaseId,
        lineageId: input.blocker.lineageId,
        lineageGeneration: input.blocker.lineageGeneration,
        scope: {
            scopeId: input.blocker.scopeId,
            memberSha256: input.blocker.scopeMemberSha256,
        },
        ...(input.blocker.worstCasePositionDeltaShares !== undefined
            ? {
                  worstCasePositionDeltaShares:
                      input.blocker.worstCasePositionDeltaShares.toString(),
              }
            : {}),
        ...(input.blocker.possiblyWorkingShares !== undefined
            ? {
                  possiblyWorkingShares:
                      input.blocker.possiblyWorkingShares.toString(),
              }
            : {}),
        resolutionPath: input.resolutionPath,
        ...(input.successor ? { successor: input.successor } : {}),
        ...(input.gateApprovedZeroBoundsEvidenceSha256
            ? {
                  gateApprovedZeroBoundsEvidenceSha256:
                      input.gateApprovedZeroBoundsEvidenceSha256,
              }
            : {}),
    };
}

describe('smart-order state registry', () => {
    it('binds the hardened implementation to the exact reviewed artifact and expands every grouped edge', () => {
        expect(SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION).toBe(
            'smart-order-state-transitions/2026-08-11.4',
        );
        expect(SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION).toBe(
            'smart-order-state-machine-implementation/2026-08-12.9',
        );
        const reviewedArtifact = readFileSync(
            new URL(
                '../../openspec/changes/add-durable-smart-order-panel-and-protective-exits/smart-order-state-transition-tables.md',
                import.meta.url,
            ),
        );
        expect(createHash('sha256').update(reviewedArtifact).digest('hex')).toBe(
            SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256,
        );
        const expected: Record<EntityKind, readonly string[]> = {
            strategy: [
                'STR-001', 'STR-002', 'STR-003', 'STR-004',
                'STR-005A', 'STR-005B', 'STR-005C', 'STR-006', 'STR-007',
                'STR-008', 'STR-009A', 'STR-009B', 'STR-009C', 'STR-009D',
                'STR-009E', 'STR-009F', 'STR-010', 'STR-011A', 'STR-011B',
                'STR-011C', 'STR-011D', 'STR-012A', 'STR-012B', 'STR-012C',
                'STR-012D', 'STR-012E', 'STR-013', 'STR-014', 'STR-015A',
                'STR-015B', 'STR-016A', 'STR-016B',
            ],
            activation: [
                'ACT-001', 'ACT-002', 'ACT-003', 'ACT-004', 'ACT-005',
                'ACT-006', 'ACT-007', 'ACT-008', 'ACT-009', 'ACT-010A',
                'ACT-010B', 'ACT-010C', 'ACT-011A', 'ACT-011B', 'ACT-011C',
                'ACT-012A', 'ACT-012B', 'ACT-012C', 'ACT-013A', 'ACT-013B',
                'ACT-013C', 'ACT-014A', 'ACT-014B', 'ACT-014C', 'ACT-015A',
                'ACT-015B', 'ACT-015C', 'ACT-015D', 'ACT-015E',
            ],
            order_intent: [
                'INT-001', 'INT-002', 'INT-003A', 'INT-003B', 'INT-004',
                'INT-005A', 'INT-005B', 'INT-006', 'INT-007', 'INT-008A',
                'INT-008B', 'INT-009', 'INT-010', 'INT-011', 'INT-012',
                'INT-013', 'INT-014',
            ],
            broker_order: [
                'BRO-001A', 'BRO-001B', 'BRO-002A', 'BRO-002B', 'BRO-002C',
                'BRO-003A', 'BRO-003B', 'BRO-003C', 'BRO-003D', 'BRO-004A',
                'BRO-004B', 'BRO-004C', 'BRO-004D', 'BRO-004E', 'BRO-005A',
                'BRO-005B', 'BRO-005C', 'BRO-005D', 'BRO-005E', 'BRO-006A',
                'BRO-006B', 'BRO-006C', 'BRO-006D', 'BRO-006E', 'BRO-007A',
                'BRO-007B', 'BRO-007C', 'BRO-007D', 'BRO-007E', 'BRO-008A',
                'BRO-008B', 'BRO-008C', 'BRO-008D', 'BRO-008E', 'BRO-009A',
                'BRO-009B', 'BRO-009C', 'BRO-009D', 'BRO-010A', 'BRO-010B',
                'BRO-010C', 'BRO-010D',
            ],
            pending_protection_commitment: [
                'PPC-001', 'PPC-002', 'PPC-003', 'PPC-004', 'PPC-005A',
                'PPC-005B', 'PPC-006', 'PPC-007A', 'PPC-007B', 'PPC-008A',
                'PPC-008B', 'PPC-008C', 'PPC-009A', 'PPC-009B', 'PPC-009C',
                'PPC-010A', 'PPC-010B', 'PPC-010C', 'PPC-011',
            ],
            protection_obligation: [
                'POB-001', 'POB-002', 'POB-003A', 'POB-003B', 'POB-003C',
                'POB-003D', 'POB-003E', 'POB-004', 'POB-005', 'POB-006',
                'POB-007', 'POB-008A', 'POB-008B', 'POB-008C', 'POB-009',
                'POB-010A', 'POB-010B', 'POB-010C', 'POB-011A', 'POB-011B',
                'POB-011C', 'POB-011D', 'POB-011E', 'POB-011F', 'POB-012A',
                'POB-012B', 'POB-012C', 'POB-012D', 'POB-012E', 'POB-012F',
                'POB-013A', 'POB-013B', 'POB-013C', 'POB-013D', 'POB-013E',
                'POB-013F', 'POB-014',
            ],
            entry_exposure_reservation: [
                'EER-001', 'EER-002', 'EER-003A', 'EER-003B', 'EER-004A',
                'EER-004B', 'EER-005A', 'EER-005B', 'EER-006A', 'EER-006B',
                'EER-006C',
            ],
            exit_claim: [
                'EXC-001', 'EXC-003', 'EXC-004', 'EXC-005', 'EXC-006',
                'EXC-007A', 'EXC-007B', 'EXC-008', 'EXC-009', 'EXC-010A',
                'EXC-010B', 'EXC-010C',
            ],
            external_sell_claim: [
                'EXC-002', 'EXC-007B', 'EXC-008', 'EXC-009', 'EXC-010A',
                'EXC-010B', 'EXC-010C',
            ],
            runtime_epoch: [
                'RTE-001', 'RTE-002', 'RTE-003A', 'RTE-003B', 'RTE-004',
                'RTE-005', 'RTE-006', 'RTE-007', 'RTE-008', 'RTE-009A',
                'RTE-009B', 'RTE-010A', 'RTE-010B', 'RTE-010C', 'RTE-011A',
                'RTE-011B', 'RTE-011C', 'RTE-011D', 'RTE-011E', 'RTE-011F',
                'RTE-012', 'RTE-013A', 'RTE-013B', 'RTE-014A', 'RTE-014B',
                'RTE-014C', 'RTE-014D', 'RTE-014E', 'RTE-014F', 'RTE-015A',
                'RTE-015B', 'RTE-015C', 'RTE-015D', 'RTE-015E', 'RTE-015F',
                'RTE-015G', 'RTE-016',
            ],
            durable_dispatch_blocker: [
                'DDB-001', 'DDB-002', 'DDB-003', 'DDB-004', 'DDB-005',
            ],
            resolution_case: [
                'RC-001', 'RC-002', 'RC-003', 'RC-004A', 'RC-004B',
                'RC-004C', 'RC-005', 'RC-006',
            ],
            safety_blocker: ['SB-001', 'SB-002', 'SB-003'],
        };
        for (const [kind, expectedIds] of Object.entries(expected) as [
            EntityKind,
            readonly string[],
        ][]) {
            expect(
                SMART_ORDER_EDGE_REGISTRY.filter(
                    (definition) => definition.entityKind === kind,
                )
                    .map((definition) => definition.edgeId)
                    .sort(),
            ).toEqual([...expectedIds].sort());
        }
        for (const definition of SMART_ORDER_EDGE_REGISTRY) {
            expect(definition.registryVersion).toBe(
                SMART_ORDER_STATE_TRANSITION_REGISTRY_VERSION,
            );
            expect(definition.implementationVersion).toBe(
                SMART_ORDER_STATE_MACHINE_IMPLEMENTATION_VERSION,
            );
            expect(definition.reviewedArtifactSha256).toBe(
                SMART_ORDER_STATE_TRANSITION_ARTIFACT_SHA256,
            );
        }
    });

    it('deep-freezes reason-specific authorization allowlists', () => {
        const definition = edge('activation', 'ACT-015E');
        const kinds =
            definition.authorizationKindsByReason
                .MANUAL_BREAK_GLASS_RELINQUISHED;
        expect(Object.isFrozen(definition.authorizationKindsByReason)).toBe(
            true,
        );
        expect(Object.isFrozen(kinds)).toBe(true);
        expect(kinds).toEqual(['BreakGlassAuthorization']);
    });

    it('requires both effect bounds when SB-001 creates an unknown-exposure blocker', () => {
        const assertCreationRejected = (
            blocker: Omit<SafetyBlocker, 'state' | 'revision'>,
        ) => {
            const link = {
                ...resolutionLink('BROKER_OUTCOME_UNKNOWN', 'open'),
                resolutionCaseId: blocker.resolutionCaseId,
                safetyBlockerId: blocker.blockerId,
            };
            const request = requestFor('safety_blocker', 'SB-001', {
                expectedRevision: 0,
                resolutionCaseLink: link,
            });
            expectMachineError(
                () =>
                    createStateEntity(blocker, {
                        ...request,
                        atomicCompanionProofs: [
                            proof(
                                'ResolutionCase.open',
                                request,
                                blocker,
                                link.resolutionCaseId,
                                link.evidenceHash,
                            ),
                            proof(
                                'SafetyBlocker.open',
                                request,
                                blocker,
                                blocker.blockerId,
                                link.evidenceHash,
                            ),
                        ],
                    }),
                'entity_invariant_violation',
            );
        };
        assertCreationRejected({
            entityKind: 'safety_blocker',
            entityId: 'blocker-missing-worst-case-bound',
            lineageId: 'case-missing-worst-case-bound/blocker',
            lineageGeneration: 0,
            blockerId: 'blocker-missing-worst-case-bound',
            blockerKind: 'unknown_broker_side_effect',
            scopeId: 'scope-1',
            scopeMemberSha256: [BLOCKER_SCOPE_MEMBER_A],
            resolutionCaseId: 'case-missing-worst-case-bound',
            possiblyWorkingShares: 100n,
        });
        assertCreationRejected({
            entityKind: 'safety_blocker',
            entityId: 'blocker-missing-possibly-working-bound',
            lineageId: 'case-missing-possibly-working-bound/blocker',
            lineageGeneration: 0,
            blockerId: 'blocker-missing-possibly-working-bound',
            blockerKind: 'relinquished_unknown_exposure',
            scopeId: 'scope-1',
            scopeMemberSha256: [BLOCKER_SCOPE_MEMBER_A],
            resolutionCaseId: 'case-missing-possibly-working-bound',
            worstCasePositionDeltaShares: 100n,
        });
    });

    it('binds each reason to exact evidence metadata and confines broker authority', () => {
        const authorityEdges: string[] = [];
        for (const definition of SMART_ORDER_EDGE_REGISTRY) {
            for (const reasonCode of definition.reasonCodes) {
                expect(definition.evidenceClassesByReason[reasonCode]).toEqual([
                    SMART_ORDER_REASON_REGISTRY[reasonCode].requiredEvidenceClass,
                ]);
            }
            if (
                definition.brokerWriteProvenance.some(
                    (provenance) => provenance !== 'none',
                )
            ) {
                authorityEdges.push(`${definition.entityKind}:${definition.edgeId}`);
            }
            if (definition.to === 'manual_intervention') {
                expect(definition.entityKind).toBe('strategy');
            }
        }
        expect(authorityEdges.sort()).toEqual([
            'activation:ACT-007',
            'durable_dispatch_blocker:DDB-001',
            'order_intent:INT-002',
        ]);
    });

    it('classifies unknown/blocking and terminal states without reopening them', () => {
        expect(isBlockingState('order_intent', 'unknown')).toBe(true);
        expect(isBlockingState('protection_obligation', 'safety_blocked')).toBe(
            true,
        );
        expect(isTerminalState('broker_order', 'filled')).toBe(true);
        expect(isTerminalState('runtime_epoch', 'failed_stop')).toBe(true);
    });
});

describe('typed transition enforcement', () => {
    it('fails closed on malformed protection lineage, account, contract, and origin fields', () => {
        const commitment: PendingProtectionCommitment = {
            entityKind: 'pending_protection_commitment',
            entityId: 'commitment-malformed',
            lineageId: 'strategy-1/commitment-malformed',
            lineageGeneration: 0,
            state: 'prepared',
            revision: 1,
            commitmentId: 'commitment-malformed',
            strategyId: '',
            entryIntentId: 'entry-intent-malformed',
            entryIntentOwner: STRATEGY_OWNER,
            obligationId: 'obligation-malformed',
            requestedShares: 1000n,
            cumulativeFilledShares: 0n,
            openPotentialShares: 1000n,
            terminalUnfilledShares: 0n,
            materializedFilledShares: 0n,
            unmaterializedConfirmedFillShares: 0n,
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    commitment,
                    requestFor(
                        'pending_protection_commitment',
                        'PPC-003',
                    ),
                ),
            'invalid_transition_request',
        );

        const obligation: ProtectionObligation = {
            entityKind: 'protection_obligation',
            entityId: 'obligation-malformed',
            lineageId: 'strategy-2/obligation-malformed',
            lineageGeneration: 0,
            state: 'pending_entry',
            revision: 1,
            obligationId: 'obligation-malformed',
            strategyId: 'strategy-2',
            commitmentId: 'commitment-malformed',
            entryIntentId: 'entry-intent-malformed',
            entryIntentOwner: STRATEGY_OWNER,
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            filledShares: 0n,
            confirmedExitedShares: 0n,
            protectedShares: 0n,
            runtimeTrackedUnprotectedRemainder: 0n,
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    obligation,
                    requestFor('protection_obligation', 'POB-004'),
                ),
            'lineage_mismatch',
        );

        const reservation: EntryExposureReservation = {
            entityKind: 'entry_exposure_reservation',
            entityId: 'reservation-malformed',
            lineageId: 'entry-intent-malformed/reservation-malformed',
            lineageGeneration: 0,
            state: 'reserved',
            revision: 1,
            reservationId: 'reservation-malformed',
            ownerIntentId: '',
            entryIntentOwner: STRATEGY_OWNER,
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            worstCaseReservedShares: 1000n,
            reservedRemainingShares: 1000n,
            consumedShares: 0n,
            releasedShares: 0n,
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    reservation,
                    requestFor('entry_exposure_reservation', 'EER-004A'),
                ),
            'invalid_transition_request',
        );

        const claim: ExitClaim = {
            entityKind: 'exit_claim',
            entityId: 'claim-malformed',
            lineageId: 'obligation-1/claim-malformed',
            lineageGeneration: 0,
            state: 'monitoring_reserved',
            revision: 1,
            exitClaimId: 'claim-malformed',
            origin: 'runtime',
            strategyId: 'strategy-1',
            obligationId: 'obligation-1',
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            positionLineageId: '',
            remainderGeneration: 0,
            reservedShares: 0n,
            activeShares: 0n,
            consumedShares: 0n,
            releasedShares: 0n,
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    claim,
                    requestFor('exit_claim', 'EXC-004'),
                ),
            'invalid_transition_request',
        );

        const external = {
            entityKind: 'external_sell_claim',
            entityId: 'external-claim-malformed',
            lineageId: 'position-1/external-claim-malformed',
            lineageGeneration: 0,
            origin: 'runtime',
            exitClaimId: 'external-claim-malformed',
            brokerOrderId: 'broker-order-1',
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            positionLineageId: 'position-1',
            remainderGeneration: 0,
            reservedShares: 1000n,
            activeShares: 1000n,
            consumedShares: 0n,
            releasedShares: 0n,
        } as unknown as Omit<ExternalSellClaim, 'state' | 'revision'>;
        expectMachineError(
            () =>
                createStateEntity(
                    external,
                    requestFor('external_sell_claim', 'EXC-002'),
                ),
            'lineage_mismatch',
        );
    });

    it('never classifies an unknown protection projection as true zero-fill terminal', () => {
        const obligation: ProtectionObligation = {
            entityKind: 'protection_obligation',
            entityId: 'obligation-zero-fill-unknown',
            lineageId: 'strategy-1/obligation-zero-fill-unknown',
            lineageGeneration: 0,
            state: 'pending_entry',
            revision: 1,
            obligationId: 'obligation-zero-fill-unknown',
            strategyId: 'strategy-1',
            commitmentId: 'commitment-zero-fill-unknown',
            entryIntentId: 'entry-intent-zero-fill-unknown',
            entryIntentOwner: STRATEGY_OWNER,
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            filledShares: 0n,
            confirmedExitedShares: 0n,
            protectedShares: 'unknown',
            runtimeTrackedUnprotectedRemainder: 'unknown',
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    obligation,
                    requestFor('protection_obligation', 'POB-004'),
                ),
            'entity_invariant_violation',
        );
    });

    it('rejects a valid adjacency paired with the wrong reason, actor, or evidence', () => {
        const activation = createStateEntity(
            activationInput(),
            requestFor('activation', 'ACT-001'),
        ).entity;
        const wrongReason = {
            ...requestFor('activation', 'ACT-002', {
                expectedRevision: activation.revision,
            }),
            expectedRevision: activation.revision,
            reasonCode: 'BROKER_FULL_FILL_CONFIRMED',
        } as StateTransitionRequest;
        expectMachineError(
            () => transitionStateEntity(activation, wrongReason),
            'reason_not_allowed',
        );
        const wrongActor = requestFor('activation', 'ACT-002', {
            expectedRevision: activation.revision,
            actorKind: 'interactive_user',
        });
        expectMachineError(
            () => transitionStateEntity(activation, wrongActor),
            'actor_not_allowed',
        );
        const wrongEvidence = requestFor('activation', 'ACT-002', {
            expectedRevision: activation.revision,
            evidence: [
                {
                    evidenceId: 'wrong-evidence',
                    evidenceHash: HASH_A,
                    evidenceClass: 'BrokerDealOrderPositionEvidence',
                },
            ],
        });
        expectMachineError(
            () => transitionStateEntity(activation, wrongEvidence),
            'evidence_missing_or_mismatch',
        );
    });

    it('uses optimistic revision and permanently closes terminal entity lineage', () => {
        const activation = createStateEntity(
            activationInput(),
            requestFor('activation', 'ACT-001'),
        ).entity;
        expectMachineError(
            () =>
                transitionStateEntity(
                    activation,
                    requestFor('activation', 'ACT-004', {
                        expectedRevision: 99,
                    }),
                ),
            'state_revision_conflict',
        );
        const cancelled = transitionStateEntity(
            activation,
            requestFor('activation', 'ACT-004', {
                expectedRevision: activation.revision,
            }),
        ).entity;
        expectMachineError(
            () =>
                transitionStateEntity(
                    cancelled,
                    requestFor('activation', 'ACT-001', {
                        expectedRevision: cancelled.revision,
                    }),
                ),
            'terminal_entity_closed',
        );
    });

    it('seals draft Strategy atomically and refuses missing/mismatched companions', () => {
        const draft = createDraftStrategy({
            entityKind: 'strategy',
            entityId: 'strategy-1',
            lineageId: 'strategy-1',
            lineageGeneration: 0,
            strategyId: 'strategy-1',
            runtimeEpochId: 'epoch-1',
            armGeneration: 0,
            draftPayloadHash: HASH_C,
        });
        const seal = {
            strategyId: 'strategy-1',
            immutableDefinitionRecordId: 'immutable-definition-1',
            strategyDefinitionHash: HASH_A,
            confirmationSnapshotHash: HASH_B,
            fixedAccountOpaqueRef: 'account-opaque-1',
            identityGroupOpaqueRef: 'identity-opaque-1',
            intendedProvenance: 'automation' as const,
        };
        const base = requestFor('strategy', 'STR-001', {
            expectedRevision: draft.revision,
            strategyDefinitionSeal: seal,
        });
        expectMachineError(
            () => transitionStateEntity(draft, base),
            'atomic_companion_mismatch',
        );
        const sealed = transitionStateEntity(draft, {
            ...base,
            atomicCompanionProofs: [
                proof(
                    'ImmutableStrategyDefinition',
                    base,
                    draft,
                    seal.immutableDefinitionRecordId,
                    seal.strategyDefinitionHash,
                ),
                proof(
                    'ConfirmationSnapshot',
                    base,
                    draft,
                    seal.confirmationSnapshotHash,
                    seal.confirmationSnapshotHash,
                ),
                proof(
                    'UserAuthorizationEvidence',
                    base,
                    draft,
                    'evidence-STR-001',
                    HASH_B,
                ),
            ],
        }).entity;
        expect(sealed.state).toBe('observing');
        expect(sealed.definitionStatus).toBe('sealed');
        expect(Object.isFrozen(sealed)).toBe(true);
        if (sealed.definitionStatus === 'sealed') {
            expect(sealed.strategyDefinitionHash).toBe(HASH_A);
        }
    });

    it('allows manual_intervention to exit only through verifier-issued resolution authority', async () => {
        const draft = createDraftStrategy({
            entityKind: 'strategy', entityId: 'strategy-1', lineageId: 'strategy-1',
            lineageGeneration: 0, strategyId: 'strategy-1', runtimeEpochId: 'epoch-1',
            armGeneration: 0, draftPayloadHash: HASH_C,
        });
        const seal = {
            strategyId: 'strategy-1', immutableDefinitionRecordId: 'definition-1',
            strategyDefinitionHash: HASH_A, confirmationSnapshotHash: HASH_B,
            fixedAccountOpaqueRef: 'account-1', identityGroupOpaqueRef: 'identity-1',
            intendedProvenance: 'automation' as const,
        };
        const sealRequest = requestFor('strategy', 'STR-001', {
            expectedRevision: 1,
            strategyDefinitionSeal: seal,
        });
        const observing = transitionStateEntity(draft, {
            ...sealRequest,
            atomicCompanionProofs: [
                proof('ImmutableStrategyDefinition', sealRequest, draft, 'definition-1', HASH_A),
                proof('ConfirmationSnapshot', sealRequest, draft, HASH_B, HASH_B),
                proof(
                    'UserAuthorizationEvidence',
                    sealRequest,
                    draft,
                    'evidence-STR-001',
                    HASH_B,
                ),
            ],
        }).entity;
        const openingReason = 'EXTERNAL_POSITION_DRIFT' as const;
        const { context, evidenceSet } =
            await canonicalResolutionEvidenceSet(openingReason);
        const linkOpen = resolutionLink(
            openingReason,
            'open',
            evidenceSet.evidenceSnapshotSha256,
        );
        const manualRequest = requestFor('strategy', 'STR-009A', {
            expectedRevision: observing.revision,
            reasonCode: openingReason,
            resolutionCaseLink: linkOpen,
        });
        const manual = transitionStateEntity(observing, {
            ...manualRequest,
            atomicCompanionProofs: [
                proof(
                    'ResolutionCase.open',
                    manualRequest,
                    observing,
                    'resolution-1',
                    linkOpen.evidenceHash,
                ),
                proof(
                    'SafetyBlocker.open',
                    manualRequest,
                    observing,
                    'blocker-1',
                    linkOpen.evidenceHash,
                ),
            ],
        }).entity;
        const expiry = transitionStateEntity(
            manual,
            requestFor('strategy', 'STR-012D', {
                expectedRevision: manual.revision,
                resolutionCaseLink: linkOpen,
            }),
        ).entity;
        expect(expiry.state).toBe('expired_with_obligation');
        expect(expiry.resolutionCaseId).toBe('resolution-1');
        expect(expiry.manualResolutionReasonCode).toBe(
            openingReason,
        );
        const verifiedAuthorization =
            await issueResolutionAuthorizationForTest({
                kind: 'user_rearm',
                context,
                evidenceSet,
                freshConfirmationSha256: `sha256:${HASH_C}`,
                step: {
                    stepId: 'resolution-step-1',
                    confirmationLineageId: 'resolution-confirmation-1',
                    nonce: 'resolution-nonce-1',
                    nonceRevision: 1,
                    userConfirmationSha256: `sha256:${HASH_A}`,
                },
            });
        const decision = evaluateManualResolution({
            context,
            operation: 'reconfirm_and_pause',
            evidenceSet,
            authorization: verifiedAuthorization,
            executionBoundary: transitionBoundary(
                'strategy',
                manual.entityId,
                'STR-010',
                'MANUAL_RESOLUTION_RECONFIRMED',
                manual.lineageGeneration,
                manual.revision,
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const linkResolved = resolutionLink(
            openingReason,
            'resolved_by_reconfirmation',
            evidenceSet.evidenceSnapshotSha256,
        );
        const rearm: AuthorizationEvidence = {
            authorizationId: 'user-rearm-1',
            authorizationHash: decision.authorizationSha256!.slice(
                'sha256:'.length,
            ),
            kind: 'UserRearmAuthorization',
            burnedNonces: decision.atomicConsume,
        };
        const exitBase = requestFor('strategy', 'STR-010', {
            expectedRevision: manual.revision,
            resolutionCaseLink: linkResolved,
            authorizationEvidence: [rearm],
            reservationClaimSettlementId: 'settlement-1',
            targetSideEffectSha256: RESOLUTION_TARGET,
        });
        expectMachineError(
            () => transitionStateEntity(manual, exitBase),
            'resolution_matrix_rejected',
        );
        expectMachineError(
            () =>
                transitionStateEntity(manual, {
                    ...exitBase,
                    manualResolutionDecision: { ...decision },
                }),
            'resolution_matrix_rejected',
        );
        const exitRequest = { ...exitBase, manualResolutionDecision: decision };
        const paused = transitionStateEntity(manual, {
            ...exitRequest,
            atomicCompanionProofs: [
                proof(
                    'ResolutionCase.terminal',
                    exitRequest,
                    manual,
                    'resolution-1',
                    linkResolved.evidenceHash,
                ),
                proof('ConfirmationSnapshot', exitRequest, manual, HASH_C),
                proof(
                    'UserAuthorizationEvidence',
                    exitRequest,
                    manual,
                    'user-rearm-1',
                    rearm.authorizationHash,
                ),
                proof(
                    'ReservationClaimSettlement',
                    exitRequest,
                    manual,
                    'settlement-1',
                ),
                proof(
                    'BurnedDispatchNonce',
                    exitRequest,
                    manual,
                    'user-rearm-1',
                    rearm.authorizationHash,
                ),
            ],
        }).entity;
        expect(paused.state).toBe('paused');
        expect(paused.manualResolutionReasonCode).toBe(openingReason);
    });

    it('never re-arms a trailing-gap extreme on the old Strategy lineage', async () => {
        const openingReason = 'TRAILING_GAP_EXTREME_UNKNOWN' as const;
        const { context, evidenceSet } = await canonicalResolutionEvidenceSet(
            openingReason,
            'trailing-resolution-1',
        );
        const lifecycleAuthorization =
            await issueResolutionAuthorizationForTest({
                kind: 'lifecycle',
                context,
                evidenceSet,
                step: {
                    stepId: 'trailing-copy-step-1',
                    confirmationLineageId: 'trailing-copy-lineage-1',
                    nonce: 'trailing-copy-nonce-1',
                    nonceRevision: 1,
                    userConfirmationSha256: `sha256:${HASH_A}`,
                },
            });
        const decision = evaluateManualResolution({
            context,
            operation: 'copy_to_new_draft',
            evidenceSet,
            authorization: lifecycleAuthorization,
            executionBoundary: {
                kind: 'resolution_service',
                operation: 'copy_to_new_draft',
                resolutionCaseId: context.resolutionCaseId,
                caseRevision: context.caseRevision,
                sourceEntityKind: 'strategy',
                sourceEntityId: 'trailing-strategy-1',
                sourceEntityExpectedRevision: 4,
                serviceRequestSha256: `sha256:${HASH_C}`,
            },
        });
        if (!decision.allowed) throw new Error(decision.reason);
        expect(decision.row.rearmPolicy).toBe('never');
        expect(decision.operation).toBe('copy_to_new_draft');

        const manual = {
            entityKind: 'strategy',
            entityId: 'trailing-strategy-1',
            lineageId: 'trailing-strategy-1',
            lineageGeneration: 0,
            state: 'manual_intervention',
            revision: 4,
            resolutionCaseId: 'trailing-resolution-1',
            strategyId: 'trailing-strategy-1',
            runtimeEpochId: 'epoch-1',
            armGeneration: 1,
            manualResolutionReasonCode: openingReason,
            definitionStatus: 'sealed',
            strategyDefinitionHash: HASH_A,
            confirmationSnapshotHash: HASH_B,
            fixedAccountOpaqueRef: 'account-1',
            identityGroupOpaqueRef: 'identity-1',
            intendedProvenance: 'automation',
        } as const;
        expectMachineError(
            () =>
                transitionStateEntity(
                    manual,
                    requestFor('strategy', 'STR-010', {
                        expectedRevision: manual.revision,
                        resolutionCaseLink: {
                            ...resolutionLink(
                                openingReason,
                                'resolved_by_reconfirmation',
                                evidenceSet.evidenceSnapshotSha256,
                            ),
                            resolutionCaseId: 'trailing-resolution-1',
                        },
                        authorizationEvidence: [
                            {
                                authorizationId: 'trailing-user-rearm-1',
                                authorizationHash: HASH_A,
                                kind: 'UserRearmAuthorization',
                            },
                        ],
                        manualResolutionDecision: decision,
                    }),
                ),
            'resolution_matrix_rejected',
        );
    });

    it('uses reason-exact companions and consumes a quote-gap resolution once', async () => {
        const openingReason = 'QUOTE_GAP_CROSSING_UNKNOWN' as const;
        const { context, evidenceSet } =
            await canonicalResolutionEvidenceSet(
                openingReason,
                'resolution-quote-gap-1',
            );
        const verifiedAuthorization =
            await issueResolutionAuthorizationForTest({
                kind: 'user_rearm',
                context,
                evidenceSet,
                freshConfirmationSha256: `sha256:${HASH_C}`,
                step: {
                    stepId: 'quote-gap-step-1',
                    confirmationLineageId: 'quote-gap-confirmation-1',
                    nonce: 'quote-gap-nonce-1',
                    nonceRevision: 1,
                    userConfirmationSha256: `sha256:${HASH_A}`,
                },
            });
        const decision = evaluateManualResolution({
            context,
            operation: 'reconfirm_and_pause',
            evidenceSet,
            authorization: verifiedAuthorization,
            executionBoundary: transitionBoundary(
                'strategy',
                'strategy-quote-gap',
                'STR-010',
                'MANUAL_RESOLUTION_RECONFIRMED',
                0,
                4,
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        expect(decision.atomicCompanions).not.toContain(
            'reservation_claim_obligation_settlement',
        );
        const manual = {
            entityKind: 'strategy',
            entityId: 'strategy-quote-gap',
            lineageId: 'strategy-quote-gap',
            lineageGeneration: 0,
            state: 'manual_intervention',
            revision: 4,
            resolutionCaseId: 'resolution-quote-gap-1',
            strategyId: 'strategy-quote-gap',
            runtimeEpochId: 'epoch-1',
            armGeneration: 1,
            manualResolutionReasonCode: openingReason,
            definitionStatus: 'sealed',
            strategyDefinitionHash: HASH_A,
            confirmationSnapshotHash: HASH_B,
            fixedAccountOpaqueRef: 'account-1',
            identityGroupOpaqueRef: 'identity-1',
            intendedProvenance: 'automation',
        } as const;
        const link = {
            ...resolutionLink(
                openingReason,
                'resolved_by_reconfirmation',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: 'resolution-quote-gap-1',
        };
        const rearm: AuthorizationEvidence = {
            authorizationId: 'quote-gap-user-rearm-1',
            authorizationHash: decision.authorizationSha256!.slice(
                'sha256:'.length,
            ),
            kind: 'UserRearmAuthorization',
            burnedNonces: decision.atomicConsume,
        };
        const base = requestFor('strategy', 'STR-010', {
            expectedRevision: manual.revision,
            resolutionCaseLink: link,
            authorizationEvidence: [rearm],
            manualResolutionDecision: decision,
            targetSideEffectSha256: RESOLUTION_TARGET,
        });
        const request = {
            ...base,
            atomicCompanionProofs: [
                proof(
                    'ResolutionCase.terminal',
                    base,
                    manual,
                    'resolution-quote-gap-1',
                    link.evidenceHash,
                ),
                proof('ConfirmationSnapshot', base, manual, HASH_C),
                proof(
                    'UserAuthorizationEvidence',
                    base,
                    manual,
                    rearm.authorizationId,
                    rearm.authorizationHash,
                ),
                proof(
                    'BurnedDispatchNonce',
                    base,
                    manual,
                    rearm.authorizationId,
                    rearm.authorizationHash,
                ),
            ],
        };
        expect(transitionStateEntity(manual, request).entity.state).toBe('paused');
        expectMachineError(
            () => transitionStateEntity(manual, request),
            'resolution_matrix_rejected',
        );
    });

    it('requires the same opaque unique-final decision on non-Strategy manual edges', async () => {
        const openingReason = 'ENTRY_RESULT_UNKNOWN' as const;
        const { context, evidenceSet } = await canonicalResolutionEvidenceSet(
            openingReason,
            'resolution-final-1',
            true,
        );
        const decision = evaluateManualResolution({
            context,
            operation: 'apply_unique_final_evidence',
            evidenceSet,
            executionBoundary: transitionBoundary(
                'activation',
                'activation-unknown-1',
                'ACT-015D',
                'MANUAL_FINAL_EVIDENCE_APPLIED',
                0,
                3,
                'strategy-1/activation-unknown-1',
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const activation = {
            entityKind: 'activation',
            entityId: 'activation-unknown-1',
            lineageId: 'strategy-1/activation-unknown-1',
            lineageGeneration: 0,
            state: 'unknown',
            revision: 3,
            resolutionCaseId: 'resolution-final-1',
            activationId: 'activation-unknown-1',
            runtimeEpochId: 'epoch-1',
            strategyId: 'strategy-1',
            strategyDefinitionHash: HASH_A,
            activationKind: 'edge',
            logicalKeyHash: HASH_B,
            intentPurpose: 'unprotected_place',
            dispatchOwner: {
                kind: 'strategy_activation',
                strategyId: 'strategy-1',
                activationId: 'activation-unknown-1',
            },
            intendedProvenance: 'automation',
        } as const;
        const link = {
            ...resolutionLink(
                openingReason,
                'resolved_by_final_evidence',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: 'resolution-final-1',
        };
        const base = requestFor('activation', 'ACT-015D', {
            expectedRevision: activation.revision,
            reasonCode: 'MANUAL_FINAL_EVIDENCE_APPLIED',
            resolutionCaseLink: link,
            reservationClaimSettlementId: 'final-settlement-1',
            targetSideEffectSha256: RESOLUTION_TARGET,
        });
        expectMachineError(
            () => transitionStateEntity(activation, base),
            'resolution_matrix_rejected',
        );
        const authorized = { ...base, manualResolutionDecision: decision };
        expect(
            transitionStateEntity(activation, {
                ...authorized,
                atomicCompanionProofs: [
                    proof(
                        'ResolutionCase.terminal',
                        authorized,
                        activation,
                        'resolution-final-1',
                        link.evidenceHash,
                    ),
                    proof(
                        'ReservationClaimSettlement',
                        authorized,
                        activation,
                        'final-settlement-1',
                    ),
                ],
            }).entity.state,
        ).toBe('cancelled');
    });

    it('rejects plain break-glass strings and accepts only the opaque two-step decision', async () => {
        const openingReason = 'BROKER_OUTCOME_UNKNOWN' as const;
        const { context: contextOne, evidenceSet } =
            await canonicalResolutionEvidenceSet(
                openingReason,
                'resolution-break-glass-1',
            );
        const stepOne = await issueBreakGlassStepOneForTest({
            context: contextOne,
            evidenceSet,
            step: {
                stepId: 'state-break-glass-step-1',
                confirmationLineageId: 'state-break-glass-lineage-1',
                nonce: 'state-break-glass-nonce-1',
                nonceRevision: 1,
                userConfirmationSha256: `sha256:${HASH_B}`,
            },
        });
        const contextTwo = issueResolutionRuntimeContextForTest({
            reasonCode: openingReason,
            resolutionCaseId: 'resolution-break-glass-1',
            caseRevision: 1,
            scopeSha256: RESOLUTION_SCOPE,
            targetSideEffectSha256: RESOLUTION_TARGET,
            runtimeEpochId: 'epoch-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: Date.parse(NOW) + 1,
        });
        const stepTwo = await issueBreakGlassStepTwoForTest({
            context: contextTwo,
            evidenceSet,
            stepOne,
            step: {
                stepId: 'state-break-glass-step-2',
                confirmationLineageId: 'state-break-glass-lineage-1',
                nonce: 'state-break-glass-nonce-2',
                nonceRevision: 2,
                userConfirmationSha256: `sha256:${HASH_C}`,
            },
        });
        const verifiedAuthorization =
            await issueBreakGlassAuthorizationForTest({
                context: contextTwo,
                evidenceSet,
                stepOne,
                stepTwo,
            });
        const decision = evaluateManualResolution({
            context: contextTwo,
            operation: 'break_glass_relinquish',
            evidenceSet,
            authorization: verifiedAuthorization,
            executionBoundary: transitionBoundary(
                'activation',
                'activation-break-glass-1',
                'ACT-015E',
                'MANUAL_BREAK_GLASS_RELINQUISHED',
                0,
                3,
                'strategy-1/activation-break-glass-1',
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const activation = {
            entityKind: 'activation',
            entityId: 'activation-break-glass-1',
            lineageId: 'strategy-1/activation-break-glass-1',
            lineageGeneration: 0,
            state: 'unknown',
            revision: 3,
            resolutionCaseId: 'resolution-break-glass-1',
            activationId: 'activation-break-glass-1',
            runtimeEpochId: 'epoch-1',
            strategyId: 'strategy-1',
            strategyDefinitionHash: HASH_A,
            activationKind: 'edge',
            logicalKeyHash: HASH_B,
            intentPurpose: 'unprotected_place',
            dispatchOwner: {
                kind: 'strategy_activation',
                strategyId: 'strategy-1',
                activationId: 'activation-break-glass-1',
            },
            intendedProvenance: 'automation',
        } as const;
        const link = {
            ...resolutionLink(
                openingReason,
                'relinquished_unknown',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: 'resolution-break-glass-1',
        };
        const authorization: AuthorizationEvidence = {
            authorizationId: 'state-break-glass-authorization-1',
            authorizationHash: decision.authorizationSha256!.slice(
                'sha256:'.length,
            ),
            kind: 'BreakGlassAuthorization',
            burnedNonces: decision.atomicConsume,
            secondConfirmationHash:
                decision.confirmationSteps[1]!.userConfirmationSha256.slice(
                    'sha256:'.length,
                ),
        };
        const base = requestFor('activation', 'ACT-015E', {
            expectedRevision: activation.revision,
            reasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
            resolutionCaseLink: link,
            authorizationEvidence: [authorization],
            reservationClaimSettlementId: 'break-glass-settlement-1',
            auditSnapshotHash: HASH_C,
            observedWallTime: new Date(Date.parse(NOW) + 1).toISOString(),
            targetSideEffectSha256: RESOLUTION_TARGET,
        });
        expectMachineError(
            () => transitionStateEntity(activation, base),
            'resolution_matrix_rejected',
        );
        const authorized = { ...base, manualResolutionDecision: decision };
        const companionData = [
            ['ReleasedOrFailedLocalEntities', 'released-entities-1', HASH_C],
            ['ResolutionCase.relinquished_unknown', 'resolution-break-glass-1', link.evidenceHash],
            ['RelinquishedUnknownExposure.open', 'blocker-1', HASH_C],
            ['BurnedDispatchNonce', authorization.authorizationId, authorization.authorizationHash],
            ['BreakGlassAuthorization', authorization.authorizationId, authorization.authorizationHash],
            ['AuditSnapshot', 'break-glass-audit-1', HASH_C],
            ['ReservationClaimSettlement', 'break-glass-settlement-1', HASH_C],
        ] as const;
        expect(
            transitionStateEntity(activation, {
                ...authorized,
                atomicCompanionProofs: companionData.map(([kind, id, hash]) =>
                    proof(kind, authorized, activation, id, hash),
                ),
            }).entity.state,
        ).toBe('failed');
    });

    it('keeps the case blocked for a canonical current BrokerOrder projection and journals a distinct target hash', async () => {
        const openingReason = 'BROKER_STATE_UNKNOWN' as const;
        const resolutionCaseId = 'resolution-broker-current-1';
        const { context, evidenceSet } = await canonicalResolutionEvidenceSet(
            openingReason,
            resolutionCaseId,
            true,
        );
        const brokerOrder: BrokerOrder = {
            entityKind: 'broker_order',
            entityId: 'broker-order-current-1',
            lineageId: 'intent-current-1/broker-order-current-1',
            lineageGeneration: 0,
            state: 'unknown',
            revision: 4,
            resolutionCaseId,
            brokerOrderId: 'broker-order-current-1',
            intentId: 'intent-current-1',
            fixedAccountOpaqueRef: 'account-1',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330',
            side: 'Buy',
            brokerCorrelationHash: HASH_A,
            controlRevision: 0,
            quantityShares: 100n,
            filledShares: 0n,
            remainingShares: 100n,
        };
        const decision = evaluateBlockingStateResolution({
            context,
            operation: 'apply_canonical_projection_keep_blocked',
            evidenceSet,
            transitionBinding: transitionBoundary(
                'broker_order',
                brokerOrder.entityId,
                'BRO-004E',
                'BROKER_RECONCILIATION_EVIDENCE_APPLIED',
                brokerOrder.lineageGeneration,
                brokerOrder.revision,
                brokerOrder.lineageId,
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const link = {
            ...resolutionLink(
                openingReason,
                'evidence_collecting',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId,
        };
        const partFillProjection = {
            entityKind: 'broker_order' as const,
            quantityShares: 100n,
            filledShares: 40n,
            remainingShares: 60n,
        };
        const base = requestFor('broker_order', 'BRO-004E', {
            expectedRevision: brokerOrder.revision,
            requestPayloadHash: HASH_C,
            resolutionCaseLink: link,
            targetSideEffectSha256: RESOLUTION_TARGET,
            blockingStateResolutionDecision: decision,
            evidence: [
                brokerQuantityEvidence(
                    brokerOrder,
                    partFillProjection,
                    'part_filled',
                    'current',
                    'evidence-broker-current-quantity',
                ),
            ],
            nextQuantityProjection: partFillProjection,
        });
        expectMachineError(
            () =>
                transitionStateEntity(brokerOrder, {
                    ...base,
                    targetSideEffectSha256: `sha256:${HASH_B}`,
                }),
            'resolution_matrix_rejected',
        );
        expectMachineError(
            () =>
                transitionStateEntity(brokerOrder, {
                    ...base,
                    effectProjectionSha256: `sha256:${HASH_C}`,
                }),
            'resolution_matrix_rejected',
        );
        expectMachineError(
            () =>
                transitionStateEntity(brokerOrder, {
                    ...base,
                    blockingStateResolutionDecision: { ...decision },
                }),
            'resolution_matrix_rejected',
        );
        const result = transitionStateEntity(brokerOrder, base);
        expect(result.entity.state).toBe('part_filled');
        expect(result.entity.resolutionCaseId).toBe(resolutionCaseId);
        expect(result.journal.requestPayloadHash).toBe(HASH_C);
        expect(result.journal.targetSideEffectSha256).toBe(RESOLUTION_TARGET);
        expect(result.journal.effectProjectionSha256).toBe(RESOLUTION_EFFECT);
        expectMachineError(
            () => transitionStateEntity(brokerOrder, base),
            'resolution_matrix_rejected',
        );
    });

    it('requires opaque canonical-final and unique-final decisions on their exact entity revision and lineage', async () => {
        const reservationCaseId = 'resolution-reservation-final-1';
        const reservationEvidence = await canonicalResolutionEvidenceSet(
            'ENTRY_RESERVATION_UNKNOWN',
            reservationCaseId,
        );
        const reservation = {
            entityKind: 'entry_exposure_reservation',
            entityId: 'reservation-final-1',
            lineageId: 'intent-entry-1/reservation-final-1',
            lineageGeneration: 0,
            state: 'unknown',
            revision: 3,
            resolutionCaseId: reservationCaseId,
            reservationId: 'reservation-final-1',
            ownerIntentId: 'intent-entry-1',
            entryIntentOwner: STRATEGY_OWNER,
            fixedAccountOpaqueRef: 'account-1',
            contractKey: 'TSE:2330',
            worstCaseReservedShares: 100n,
            reservedRemainingShares: 100n,
            consumedShares: 0n,
            releasedShares: 0n,
        } as const;
        const reservationDecision = evaluateBlockingStateResolution({
            context: reservationEvidence.context,
            operation: 'apply_canonical_resolution_final',
            evidenceSet: reservationEvidence.evidenceSet,
            transitionBinding: transitionBoundary(
                'entry_exposure_reservation',
                reservation.entityId,
                'EER-006A',
                'MANUAL_FINAL_EVIDENCE_APPLIED',
                reservation.lineageGeneration,
                reservation.revision,
                reservation.lineageId,
            ),
        });
        if (!reservationDecision.allowed) {
            throw new Error(reservationDecision.reason);
        }
        const reservationLink = {
            ...resolutionLink(
                'ENTRY_RESERVATION_UNKNOWN',
                'resolved_by_final_evidence',
                reservationEvidence.evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: reservationCaseId,
        };
        const reservationRequest = requestFor(
            'entry_exposure_reservation',
            'EER-006A',
            {
                expectedRevision: reservation.revision,
                resolutionCaseLink: reservationLink,
                targetSideEffectSha256: RESOLUTION_TARGET,
                blockingStateResolutionDecision: reservationDecision,
                nextQuantityProjection: {
                    entityKind: 'entry_exposure_reservation',
                    reservedRemainingShares: 60n,
                    consumedShares: 40n,
                    releasedShares: 0n,
                },
            },
        );
        expect(
            transitionStateEntity(reservation, reservationRequest).entity.state,
        ).toBe('partially_consumed');

        const brokerCaseId = 'resolution-broker-final-1';
        const brokerEvidence = await canonicalResolutionEvidenceSet(
            'BROKER_STATE_UNKNOWN',
            brokerCaseId,
            true,
        );
        const brokerOrder: BrokerOrder = {
            entityKind: 'broker_order',
            entityId: 'broker-order-final-1',
            lineageId: 'intent-final-1/broker-order-final-1',
            lineageGeneration: 0,
            state: 'unknown',
            revision: 6,
            resolutionCaseId: brokerCaseId,
            brokerOrderId: 'broker-order-final-1',
            intentId: 'intent-final-1',
            fixedAccountOpaqueRef: 'account-1',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330',
            side: 'Buy',
            brokerCorrelationHash: HASH_B,
            controlRevision: 0,
            quantityShares: 100n,
            filledShares: 0n,
            remainingShares: 100n,
        };
        const brokerDecision = evaluateBlockingStateResolution({
            context: brokerEvidence.context,
            operation: 'apply_unique_final_evidence',
            evidenceSet: brokerEvidence.evidenceSet,
            transitionBinding: transitionBoundary(
                'broker_order',
                brokerOrder.entityId,
                'BRO-005E',
                'BROKER_RECONCILIATION_EVIDENCE_APPLIED',
                brokerOrder.lineageGeneration,
                brokerOrder.revision,
                brokerOrder.lineageId,
            ),
        });
        if (!brokerDecision.allowed) throw new Error(brokerDecision.reason);
        const brokerLink = {
            ...resolutionLink(
                'BROKER_STATE_UNKNOWN',
                'resolved_by_final_evidence',
                brokerEvidence.evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: brokerCaseId,
        };
        const fullFillProjection = {
            entityKind: 'broker_order' as const,
            quantityShares: 100n,
            filledShares: 100n,
            remainingShares: 0n,
        };
        const brokerRequest = requestFor('broker_order', 'BRO-005E', {
            expectedRevision: brokerOrder.revision,
            resolutionCaseLink: brokerLink,
            targetSideEffectSha256: RESOLUTION_TARGET,
            blockingStateResolutionDecision: brokerDecision,
            evidence: [
                brokerQuantityEvidence(
                    brokerOrder,
                    fullFillProjection,
                    'filled',
                    'unique_final',
                    'evidence-broker-final-quantity',
                ),
            ],
            nextQuantityProjection: fullFillProjection,
        });
        expectMachineError(
            () =>
                transitionStateEntity(
                    { ...brokerOrder, lineageId: 'other-lineage' },
                    brokerRequest,
                ),
            'resolution_matrix_rejected',
        );
        expectMachineError(
            () =>
                transitionStateEntity(
                    { ...brokerOrder, revision: brokerOrder.revision + 1 },
                    { ...brokerRequest, expectedRevision: brokerOrder.revision + 1 },
                ),
            'resolution_matrix_rejected',
        );
        expect(transitionStateEntity(brokerOrder, brokerRequest).entity.state).toBe(
            'filled',
        );
    });

    it('requires exact opaque decisions for SafetyBlocker resolution and stricter-successor supersession', async () => {
        const resolvedCaseId = 'resolution-blocker-resolved-1';
        const resolvedEvidence = await canonicalResolutionEvidenceSet(
            'BROKER_OUTCOME_UNKNOWN',
            resolvedCaseId,
            true,
            ['full_external_working_set'],
        );
        const blocker: SafetyBlocker = {
            entityKind: 'safety_blocker',
            entityId: 'blocker-resolved-1',
            lineageId: 'resolution-blocker-resolved-1/blocker-resolved-1',
            lineageGeneration: 0,
            state: 'open',
            revision: 2,
            blockerId: 'blocker-resolved-1',
            blockerKind: 'unknown_broker_side_effect',
            scopeId: 'scope-1',
            scopeMemberSha256: [BLOCKER_SCOPE_MEMBER_A],
            resolutionCaseId: resolvedCaseId,
            worstCasePositionDeltaShares: 100n,
            possiblyWorkingShares: 100n,
        };
        const resolveDecision = evaluateBlockingStateResolution({
            context: resolvedEvidence.context,
            operation: 'resolve_safety_blocker',
            evidenceSet: resolvedEvidence.evidenceSet,
            transitionBinding: transitionBoundary(
                'safety_blocker',
                blocker.entityId,
                'SB-002',
                'SAFETY_BLOCKER_RESOLVED',
                blocker.lineageGeneration,
                blocker.revision,
                blocker.lineageId,
            ),
            safetyBlockerResolutionBinding: blockerResolutionBinding({
                blocker,
                resolutionPath:
                    'canonical_unique_final_current_exposure',
            }),
        });
        if (!resolveDecision.allowed) throw new Error(resolveDecision.reason);
        const resolvedLink = {
            ...resolutionLink(
                'BROKER_OUTCOME_UNKNOWN',
                'resolved_by_final_evidence',
                resolvedEvidence.evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: resolvedCaseId,
            safetyBlockerId: blocker.blockerId,
        };
        const resolveRequest = requestFor('safety_blocker', 'SB-002', {
            expectedRevision: blocker.revision,
            resolutionCaseLink: resolvedLink,
            targetSideEffectSha256: RESOLUTION_TARGET,
            blockingStateResolutionDecision: resolveDecision,
        });
        expectMachineError(
            () =>
                transitionStateEntity(
                    {
                        ...blocker,
                        blockerKind: 'position_or_unit_conflict',
                    },
                    resolveRequest,
                ),
            'resolution_matrix_rejected',
        );
        for (const [mismatchedEntity, mismatchedRequest] of [
            [
                {
                    ...blocker,
                    entityId: 'blocker-resolved-target-b',
                    blockerId: 'blocker-resolved-target-b',
                },
                {
                    ...resolveRequest,
                    resolutionCaseLink: {
                        ...resolvedLink,
                        safetyBlockerId: 'blocker-resolved-target-b',
                    },
                },
            ],
            [
                {
                    ...blocker,
                    lineageId: 'resolution-blocker-resolved-1/lineage-b',
                },
                resolveRequest,
            ],
            [{ ...blocker, lineageGeneration: 1 }, resolveRequest],
        ] as const) {
            expectMachineError(
                () =>
                    transitionStateEntity(
                        mismatchedEntity,
                        mismatchedRequest,
                    ),
                'resolution_matrix_rejected',
            );
        }
        expectMachineError(
            () => transitionStateEntity(blocker, resolveRequest),
            'atomic_companion_mismatch',
        );
        expect(
            transitionStateEntity(blocker, {
                ...resolveRequest,
                atomicCompanionProofs: [
                    proof(
                        'ImmutableResolutionEvidence',
                        resolveRequest,
                        blocker,
                        'immutable-resolution-evidence-1',
                    ),
                    proof(
                        'DerivedLedgerReprojection',
                        resolveRequest,
                        blocker,
                        'ledger-reprojection-1',
                    ),
                    proof(
                        'SafetyBlocker.resolved',
                        resolveRequest,
                        blocker,
                        blocker.blockerId,
                        resolvedLink.evidenceHash,
                    ),
                ],
            }).entity.state,
        ).toBe('resolved');

        const supersededCaseId = 'resolution-blocker-superseded-1';
        const oldBlocker: SafetyBlocker = {
            ...blocker,
            entityId: 'blocker-superseded-1',
            lineageId: 'resolution-blocker-superseded-1/blocker-superseded-1',
            blockerId: 'blocker-superseded-1',
            blockerKind: 'position_or_unit_conflict',
            resolutionCaseId: supersededCaseId,
            scopeMemberSha256: [
                BLOCKER_SCOPE_MEMBER_A,
                BLOCKER_SCOPE_MEMBER_B,
            ],
        };
        const successorId = 'blocker-stricter-successor-1';
        const successor = await issueSafetyBlockerSuccessorForTest({
            blockerId: successorId,
            blockerKind: oldBlocker.blockerKind,
            resolutionCaseId: supersededCaseId,
            predecessorBlockerId: oldBlocker.blockerId,
            predecessorLineageId: oldBlocker.lineageId,
            lineageId:
                'resolution-blocker-superseded-1/blocker-stricter-successor-1',
            lineageGeneration: oldBlocker.lineageGeneration + 1,
            scope: {
                scopeId: 'scope-1-stricter',
                memberSha256: [
                    BLOCKER_SCOPE_MEMBER_A,
                    BLOCKER_SCOPE_MEMBER_B,
                    BLOCKER_SCOPE_MEMBER_C,
                ],
            },
        });
        const supersededEvidence = await canonicalResolutionEvidenceSet(
            'POSITION_OR_UNIT_UNKNOWN',
            supersededCaseId,
            false,
            getSafetyBlockerResolutionRequiredEvidence(
                'position_or_unit_conflict',
                'supersede_strict_scope',
            ),
            {
                canonical_safety_blocker_successor_binding:
                    successor.bindingSha256,
            },
        );
        const supersedeDecision = evaluateBlockingStateResolution({
            context: supersededEvidence.context,
            operation: 'supersede_safety_blocker',
            evidenceSet: supersededEvidence.evidenceSet,
            transitionBinding: transitionBoundary(
                'safety_blocker',
                oldBlocker.entityId,
                'SB-003',
                'SAFETY_BLOCKER_OPENED',
                oldBlocker.lineageGeneration,
                oldBlocker.revision,
                oldBlocker.lineageId,
            ),
            safetyBlockerResolutionBinding: blockerResolutionBinding({
                blocker: oldBlocker,
                resolutionPath: 'supersede_strict_scope',
                successor,
            }),
        });
        if (!supersedeDecision.allowed) {
            throw new Error(supersedeDecision.reason);
        }
        const supersedeLink = {
            ...resolutionLink(
                'POSITION_OR_UNIT_UNKNOWN',
                'evidence_collecting',
                supersededEvidence.evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: supersededCaseId,
            safetyBlockerId: successorId,
        };
        const supersedeRequest = requestFor('safety_blocker', 'SB-003', {
            expectedRevision: oldBlocker.revision,
            resolutionCaseLink: supersedeLink,
            targetSideEffectSha256: RESOLUTION_TARGET,
            blockingStateResolutionDecision: supersedeDecision,
        });
        for (const mismatchedEntity of [
            {
                ...oldBlocker,
                entityId: 'blocker-superseded-target-b',
                blockerId: 'blocker-superseded-target-b',
            },
            {
                ...oldBlocker,
                lineageId:
                    'resolution-blocker-superseded-1/lineage-b',
            },
            { ...oldBlocker, lineageGeneration: 1 },
        ]) {
            expectMachineError(
                () =>
                    transitionStateEntity(
                        mismatchedEntity,
                        supersedeRequest,
                    ),
                'resolution_matrix_rejected',
            );
        }
        expectMachineError(
            () =>
                transitionStateEntity(oldBlocker, {
                    ...supersedeRequest,
                    resolutionCaseLink: {
                        ...supersedeLink,
                        safetyBlockerId: oldBlocker.blockerId,
                    },
                }),
            'resolution_matrix_rejected',
        );
        expectMachineError(
            () =>
                transitionStateEntity(
                    { ...oldBlocker, scopeId: 'scope-not-in-decision' },
                    supersedeRequest,
                ),
            'resolution_matrix_rejected',
        );
        expectMachineError(
            () =>
                transitionStateEntity(oldBlocker, {
                    ...supersedeRequest,
                    blockingStateResolutionDecision: {
                        ...supersedeDecision,
                        safetyBlockerResolutionBinding: {
                            ...supersedeDecision.safetyBlockerResolutionBinding!,
                            successor: {
                                ...supersedeDecision
                                    .safetyBlockerResolutionBinding!.successor!,
                                predecessorBlockerId: 'unrelated-blocker',
                            },
                        },
                    },
                }),
            'resolution_matrix_rejected',
        );
        expectMachineError(
            () =>
                transitionStateEntity(oldBlocker, {
                    ...supersedeRequest,
                    atomicCompanionProofs: [
                        proof(
                            'SafetyBlocker.open',
                            supersedeRequest,
                            oldBlocker,
                            successorId,
                            successor.bindingSha256.slice(
                                'sha256:'.length,
                            ),
                        ),
                    ],
                }),
            'atomic_companion_mismatch',
        );
        expectMachineError(
            () =>
                transitionStateEntity(oldBlocker, {
                    ...supersedeRequest,
                    atomicCompanionProofs: [
                        proof(
                            'SafetyBlocker.open',
                            supersedeRequest,
                            successor,
                            successorId,
                            supersedeLink.evidenceHash,
                            'default',
                            successor.scope.scopeId,
                        ),
                    ],
                }),
            'atomic_companion_mismatch',
        );
        expect(
            transitionStateEntity(oldBlocker, {
                ...supersedeRequest,
                atomicCompanionProofs: [
                    proof(
                        'SafetyBlocker.open',
                        supersedeRequest,
                        successor,
                        successorId,
                        successor.bindingSha256.slice('sha256:'.length),
                        'default',
                        successor.scope.scopeId,
                    ),
                ],
            }).entity.state,
        ).toBe('superseded_by_stricter_blocker');
    });

    it('rejects an SB-003 decision whose claimed predecessor scope is smaller than the durable blocker scope', async () => {
        const caseId = 'resolution-blocker-shrunk-scope-attack';
        const blocker: SafetyBlocker = {
            entityKind: 'safety_blocker',
            entityId: 'blocker-shrunk-scope-attack',
            lineageId:
                'resolution-blocker-shrunk-scope-attack/predecessor',
            lineageGeneration: 0,
            state: 'open',
            revision: 2,
            blockerId: 'blocker-shrunk-scope-attack',
            blockerKind: 'position_or_unit_conflict',
            scopeId: 'scope-shrunk-attack',
            scopeMemberSha256: [
                BLOCKER_SCOPE_MEMBER_A,
                BLOCKER_SCOPE_MEMBER_B,
            ],
            resolutionCaseId: caseId,
        };
        const successor = await issueSafetyBlockerSuccessorForTest({
            blockerId: 'blocker-shrunk-scope-successor',
            blockerKind: blocker.blockerKind,
            resolutionCaseId: caseId,
            predecessorBlockerId: blocker.blockerId,
            predecessorLineageId: blocker.lineageId,
            lineageId:
                'resolution-blocker-shrunk-scope-attack/successor',
            lineageGeneration: 1,
            scope: {
                scopeId: 'scope-shrunk-attack-successor',
                memberSha256: [
                    BLOCKER_SCOPE_MEMBER_A,
                    BLOCKER_SCOPE_MEMBER_B,
                ],
            },
        });
        const evidence = await canonicalResolutionEvidenceSet(
            'POSITION_OR_UNIT_UNKNOWN',
            caseId,
            false,
            getSafetyBlockerResolutionRequiredEvidence(
                blocker.blockerKind,
                'supersede_strict_scope',
            ),
            {
                canonical_safety_blocker_successor_binding:
                    successor.bindingSha256,
            },
        );
        const decision = evaluateBlockingStateResolution({
            context: evidence.context,
            operation: 'supersede_safety_blocker',
            evidenceSet: evidence.evidenceSet,
            transitionBinding: transitionBoundary(
                'safety_blocker',
                blocker.entityId,
                'SB-003',
                'SAFETY_BLOCKER_OPENED',
                blocker.lineageGeneration,
                blocker.revision,
                blocker.lineageId,
            ),
            safetyBlockerResolutionBinding: {
                ...blockerResolutionBinding({
                    blocker,
                    resolutionPath: 'supersede_strict_scope',
                    successor,
                }),
                scope: {
                    scopeId: blocker.scopeId,
                    memberSha256: [BLOCKER_SCOPE_MEMBER_A],
                },
            },
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const link = {
            ...resolutionLink(
                'POSITION_OR_UNIT_UNKNOWN',
                'evidence_collecting',
                evidence.evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: caseId,
            safetyBlockerId: successor.blockerId,
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    blocker,
                    requestFor('safety_blocker', 'SB-003', {
                        expectedRevision: blocker.revision,
                        resolutionCaseLink: link,
                        targetSideEffectSha256: RESOLUTION_TARGET,
                        blockingStateResolutionDecision: decision,
                    }),
                ),
            'resolution_matrix_rejected',
        );
    });

    it('accepts relinquished unknown exposure only through explicit opaque Gate-approved zero bounds', async () => {
        const caseId = 'resolution-blocker-gate-zero-1';
        const gateEvidence = await canonicalResolutionEvidenceSet(
            'BROKER_OUTCOME_UNKNOWN',
            caseId,
            false,
            getSafetyBlockerResolutionRequiredEvidence(
                'relinquished_unknown_exposure',
                'gate_approved_zero_exposure_bounds',
            ),
        );
        const gateProof = gateEvidence.evidenceSet.evidence.find(
            (item) =>
                item.evidenceClass ===
                'gate_approved_zero_exposure_bounds',
        );
        if (!gateProof) throw new Error('missing Gate zero-bounds proof');
        const blocker: SafetyBlocker = {
            entityKind: 'safety_blocker',
            entityId: 'blocker-gate-zero-1',
            lineageId: 'resolution-blocker-gate-zero-1/blocker-gate-zero-1',
            lineageGeneration: 0,
            state: 'open',
            revision: 2,
            blockerId: 'blocker-gate-zero-1',
            blockerKind: 'relinquished_unknown_exposure',
            scopeId: 'scope-1',
            scopeMemberSha256: [BLOCKER_SCOPE_MEMBER_A],
            resolutionCaseId: caseId,
            worstCasePositionDeltaShares: 0n,
            possiblyWorkingShares: 0n,
        };
        const decision = evaluateBlockingStateResolution({
            context: gateEvidence.context,
            operation: 'resolve_safety_blocker',
            evidenceSet: gateEvidence.evidenceSet,
            transitionBinding: transitionBoundary(
                'safety_blocker',
                blocker.entityId,
                'SB-002',
                'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED',
                blocker.lineageGeneration,
                blocker.revision,
                blocker.lineageId,
            ),
            safetyBlockerResolutionBinding: blockerResolutionBinding({
                blocker,
                resolutionPath: 'gate_approved_zero_exposure_bounds',
                gateApprovedZeroBoundsEvidenceSha256:
                    gateProof.evidenceSha256,
            }),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const link = {
            ...resolutionLink(
                'BROKER_OUTCOME_UNKNOWN',
                'relinquished_unknown',
                gateEvidence.evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId: caseId,
            safetyBlockerId: blocker.blockerId,
        };
        const request = requestFor('safety_blocker', 'SB-002', {
            expectedRevision: blocker.revision,
            reasonCode: 'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED',
            resolutionCaseLink: link,
            targetSideEffectSha256: RESOLUTION_TARGET,
            blockingStateResolutionDecision: decision,
        });
        expectMachineError(
            () =>
                transitionStateEntity(
                    { ...blocker, possiblyWorkingShares: 1n },
                    request,
                ),
            'resolution_matrix_rejected',
        );
        expect(
            transitionStateEntity(blocker, {
                ...request,
                atomicCompanionProofs: [
                    proof(
                        'ImmutableResolutionEvidence',
                        request,
                        blocker,
                        'immutable-gate-zero-evidence-1',
                    ),
                    proof(
                        'DerivedLedgerReprojection',
                        request,
                        blocker,
                        'gate-zero-ledger-reprojection-1',
                    ),
                    proof(
                        'SafetyBlocker.resolved',
                        request,
                        blocker,
                        blocker.blockerId,
                        link.evidenceHash,
                    ),
                ],
            }).entity.state,
        ).toBe('resolved');
    });

    it('makes RTE-016 reachable only through an exact one-shot opaque break-glass decision', async () => {
        const openingReason = 'BROKER_OUTCOME_UNKNOWN' as const;
        const resolutionCaseId = 'resolution-forced-stop-1';
        const { context: contextOne, evidenceSet } =
            await canonicalResolutionEvidenceSet(
                openingReason,
                resolutionCaseId,
            );
        const stepOne = await issueBreakGlassStepOneForTest({
            context: contextOne,
            evidenceSet,
            step: {
                stepId: 'forced-stop-step-1',
                confirmationLineageId: 'forced-stop-confirmation-lineage-1',
                nonce: 'forced-stop-nonce-1',
                nonceRevision: 1,
                userConfirmationSha256: `sha256:${HASH_B}`,
            },
        });
        const contextTwo = issueResolutionRuntimeContextForTest({
            reasonCode: openingReason,
            resolutionCaseId,
            caseRevision: 1,
            scopeSha256: RESOLUTION_SCOPE,
            targetSideEffectSha256: RESOLUTION_TARGET,
            runtimeEpochId: 'epoch-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: Date.parse(NOW) + 1,
        });
        const stepTwo = await issueBreakGlassStepTwoForTest({
            context: contextTwo,
            evidenceSet,
            stepOne,
            step: {
                stepId: 'forced-stop-step-2',
                confirmationLineageId: 'forced-stop-confirmation-lineage-1',
                nonce: 'forced-stop-nonce-2',
                nonceRevision: 2,
                userConfirmationSha256: `sha256:${HASH_C}`,
            },
        });
        const verifiedAuthorization =
            await issueBreakGlassAuthorizationForTest({
                context: contextTwo,
                evidenceSet,
                stepOne,
                stepTwo,
            });
        const epoch: RuntimeEpoch = {
            ...runtimeEpochInput(),
            state: 'quiescing',
            revision: 7,
        };
        const decision = evaluateManualResolution({
            context: contextTwo,
            operation: 'break_glass_relinquish',
            evidenceSet,
            authorization: verifiedAuthorization,
            executionBoundary: transitionBoundary(
                'runtime_epoch',
                epoch.entityId,
                'RTE-016',
                'RUNTIME_BREAK_GLASS_FORCED_STOP',
                epoch.lineageGeneration,
                epoch.revision,
                epoch.lineageId,
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const link = {
            ...resolutionLink(
                openingReason,
                'relinquished_unknown',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId,
        };
        const authorization: AuthorizationEvidence = {
            authorizationId: 'forced-stop-authorization-1',
            authorizationHash: decision.authorizationSha256!.slice(
                'sha256:'.length,
            ),
            kind: 'BreakGlassAuthorization',
            burnedNonces: decision.atomicConsume,
            secondConfirmationHash:
                decision.confirmationSteps[1]!.userConfirmationSha256.slice(
                    'sha256:'.length,
                ),
        };
        const base = requestFor('runtime_epoch', 'RTE-016', {
            expectedRevision: epoch.revision,
            observedWallTime: new Date(Date.parse(NOW) + 1).toISOString(),
            resolutionCaseLink: link,
            authorizationEvidence: [authorization],
            reservationClaimSettlementId: 'forced-stop-settlement-1',
            auditSnapshotHash: HASH_C,
            targetSideEffectSha256: RESOLUTION_TARGET,
            runtimeStopProof: {
                ephemeralProcessLeaseCount: 0,
                openDurableDispatchBlockerCount: 0,
                requiredDrainPassed: false,
                durableSnapshotHash: HASH_B,
                databaseCommitReliablyAvailable: true,
                senderAuthorityEverAcquired: true,
                durableSideEffectHistoryExists: true,
                durableObligationHistoryExists: true,
            },
        });
        expectMachineError(
            () => transitionStateEntity(epoch, base),
            'resolution_matrix_rejected',
        );
        const authorized = { ...base, manualResolutionDecision: decision };
        const companions = [
            ['RuntimeEpoch.failed_stop', epoch.runtimeEpochId, HASH_B],
            ['ForcedStopReleasedEntities', 'forced-stop-released-set-1', HASH_B],
            [
                'ResolutionCase.relinquished_unknown',
                resolutionCaseId,
                link.evidenceHash,
            ],
            ['RelinquishedUnknownExposure.open', link.safetyBlockerId, link.evidenceHash],
            ['BurnedDispatchNonce', authorization.authorizationId, authorization.authorizationHash],
            ['BreakGlassAuthorization', authorization.authorizationId, authorization.authorizationHash],
            ['AuditSnapshot', 'forced-stop-audit-1', HASH_C],
            ['ReservationClaimSettlement', 'forced-stop-settlement-1', HASH_B],
        ] as const;
        const request = {
            ...authorized,
            atomicCompanionProofs: companions.map(([kind, id, hash]) =>
                proof(kind, authorized, epoch, id, hash),
            ),
        };
        expect(transitionStateEntity(epoch, request).entity.state).toBe(
            'failed_stop',
        );
        expectMachineError(
            () => transitionStateEntity(epoch, request),
            'resolution_matrix_rejected',
        );
    });

    it('enforces typed OrderIntent owner/provenance and single dispatch fencing', () => {
        const prepared = createStateEntity(
            intentInput(),
            requestFor('order_intent', 'INT-001', {
                companionOwnerKind: 'unprotected_place',
            }),
        ).entity;
        const binding = {
            activationId: 'activation-1',
            intentId: 'intent-1',
            intentOperation: 'place' as const,
            durableDispatchBlockerId: 'dispatch-blocker-1',
            dispatchAttemptNonce: 'nonce-1',
            senderFence: 'sender-fence-1',
            runtimeEpochId: 'epoch-1',
            intendedProvenance: 'automation' as const,
        };
        const wrong = requestFor('order_intent', 'INT-002', {
            expectedRevision: prepared.revision,
            brokerWriteProvenance: 'manual_user_confirmed',
            dispatchBinding: { ...binding, intendedProvenance: 'manual_user_confirmed' },
        });
        expectMachineError(
            () => transitionStateEntity(prepared, wrong),
            'intent_owner_mismatch',
        );
        const dispatch = requestFor('order_intent', 'INT-002', {
            expectedRevision: prepared.revision,
            brokerWriteProvenance: 'automation',
            dispatchBinding: binding,
        });
        const dispatching = transitionStateEntity(prepared, {
            ...dispatch,
            atomicCompanionProofs: [
                proof('Activation.dispatching', dispatch, prepared, 'activation-1'),
                proof('OrderIntent.dispatching', dispatch, prepared, 'intent-1'),
                proof('DurableDispatchBlocker.open', dispatch, prepared, 'dispatch-blocker-1'),
            ],
        }).entity;
        expect(dispatching.dispatchAttemptNonce).toBe('nonce-1');
        expect(dispatching.durableDispatchBlockerId).toBe('dispatch-blocker-1');
        expect(dispatching.runtimeEpochId).toBe('epoch-1');
    });

    it('rejects accepted zero-deal BrokerOrder evidence even when reason, class, outcome, and finality claim full fill', () => {
        const brokerInput: NewEntityByKind<'broker_order'> = {
            entityKind: 'broker_order',
            entityId: 'broker-accepted-zero-deal',
            lineageId: 'intent-accepted-zero-deal/broker-accepted-zero-deal',
            lineageGeneration: 0,
            brokerOrderId: 'broker-accepted-zero-deal',
            intentId: 'intent-accepted-zero-deal',
            fixedAccountOpaqueRef: 'account-ref-accepted-zero-deal',
            tradeDate: '2026-08-11',
            contractKey: 'TSE:STK:2330',
            side: 'Buy',
            brokerCorrelationHash: HASH_A,
            controlRevision: 0,
            quantityShares: 100n,
            filledShares: 0n,
            remainingShares: 100n,
        };
        const submitted = createStateEntity(
            brokerInput,
            requestFor('broker_order', 'BRO-003A'),
        ).entity;
        const acceptedZeroDealProjection = {
            entityKind: 'broker_order' as const,
            quantityShares: 100n,
            filledShares: 0n,
            remainingShares: 100n,
        };
        const forgedFullFill = requestFor('broker_order', 'BRO-005C', {
            expectedRevision: submitted.revision,
            evidence: [
                brokerQuantityEvidence(
                    submitted,
                    acceptedZeroDealProjection,
                    'filled',
                    'unique_final',
                    'evidence-forged-zero-deal-full-fill',
                ),
            ],
            nextQuantityProjection: acceptedZeroDealProjection,
        });
        expectMachineError(
            () => transitionStateEntity(submitted, forgedFullFill),
            'evidence_missing_or_mismatch',
        );
        const positiveFullFillProjection = {
            entityKind: 'broker_order' as const,
            quantityShares: 100n,
            filledShares: 100n,
            remainingShares: 0n,
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    submitted,
                    requestFor('broker_order', 'BRO-005C', {
                        expectedRevision: submitted.revision,
                        nextQuantityProjection: positiveFullFillProjection,
                    }),
                ),
            'evidence_missing_or_mismatch',
        );
        const canonicalFullFillEvidence = brokerQuantityEvidence(
            submitted,
            positiveFullFillProjection,
            'filled',
            'unique_final',
            'evidence-canonical-full-fill',
        );
        expectMachineError(
            () =>
                transitionStateEntity(
                    submitted,
                    requestFor('broker_order', 'BRO-005C', {
                        expectedRevision: submitted.revision,
                        evidence: [
                            canonicalFullFillEvidence,
                            {
                                evidenceId: 'evidence-duplicate-full-fill',
                                evidenceHash: HASH_C,
                                evidenceClass:
                                    'BrokerDealOrderPositionEvidence',
                            },
                        ],
                        nextQuantityProjection: positiveFullFillProjection,
                    }),
                ),
            'evidence_missing_or_mismatch',
        );
        expectMachineError(
            () =>
                transitionStateEntity(
                    submitted,
                    requestFor('broker_order', 'BRO-005C', {
                        expectedRevision: submitted.revision,
                        evidence: [
                            brokerQuantityEvidence(
                                submitted,
                                {
                                    quantityShares: 100n,
                                    filledShares: 99n,
                                    remainingShares: 1n,
                                },
                                'filled',
                                'unique_final',
                                'evidence-inconsistent-full-fill',
                            ),
                        ],
                        nextQuantityProjection: positiveFullFillProjection,
                    }),
                ),
            'evidence_missing_or_mismatch',
        );
        expectMachineError(
            () =>
                createStateEntity(
                    {
                        ...brokerInput,
                        entityId: 'broker-zero-quantity',
                        brokerOrderId: 'broker-zero-quantity',
                        lineageId: 'intent-zero-quantity/broker-zero-quantity',
                        intentId: 'intent-zero-quantity',
                        quantityShares: 0n,
                        filledShares: 0n,
                        remainingShares: 0n,
                    },
                    requestFor('broker_order', 'BRO-003A'),
                ),
            'entity_invariant_violation',
        );
        expect(submitted.state).toBe('submitted');
        expect(submitted).toMatchObject({
            quantityShares: 100n,
            filledShares: 0n,
            remainingShares: 100n,
        });
    });

    it.each([
        ['pre_submitted', 'BRO-005B', 0n, 100n],
        ['submitted', 'BRO-005C', 0n, 100n],
        ['part_filled', 'BRO-005D', 40n, 60n],
    ] as const)(
        'requires matching unique-final positive quantity evidence for %s -> filled',
        (state, edgeId, priorFilledShares, priorRemainingShares) => {
            const brokerOrder: BrokerOrder = {
                entityKind: 'broker_order',
                entityId: `broker-positive-${state}`,
                lineageId: `intent-positive-${state}/broker-positive-${state}`,
                lineageGeneration: 0,
                state,
                revision: 3,
                brokerOrderId: `broker-positive-${state}`,
                intentId: `intent-positive-${state}`,
                fixedAccountOpaqueRef: 'account-ref-positive',
                tradeDate: '2026-08-11',
                contractKey: 'TSE:STK:2330',
                side: 'Buy',
                brokerCorrelationHash: HASH_A,
                controlRevision: 0,
                quantityShares: 100n,
                filledShares: priorFilledShares,
                remainingShares: priorRemainingShares,
            };
            const fullFillProjection = {
                entityKind: 'broker_order' as const,
                quantityShares: 100n,
                filledShares: 100n,
                remainingShares: 0n,
            };
            const request = requestFor('broker_order', edgeId, {
                expectedRevision: brokerOrder.revision,
                evidence: [
                    brokerQuantityEvidence(
                        brokerOrder,
                        fullFillProjection,
                        'filled',
                        'unique_final',
                        `evidence-positive-${state}-full-fill`,
                    ),
                ],
                nextQuantityProjection: fullFillProjection,
            });
            const result = transitionStateEntity(brokerOrder, request);
            expect(result.entity).toMatchObject({
                state: 'filled',
                quantityShares: 100n,
                filledShares: 100n,
                remainingShares: 0n,
            });
            expect(result.journal.evidence[0]?.brokerOrderQuantity).toMatchObject({
                schemaVersion: BROKER_ORDER_QUANTITY_EVIDENCE_SCHEMA_VERSION,
                outcome: 'filled',
                finality: 'unique_final',
                quantityShares: 100n,
                filledShares: 100n,
                remainingShares: 0n,
            });
        },
    );

    it('closes a uniquely resolved unknown OrderIntent and never resends the old intent', async () => {
        const openingReason = 'BROKER_OUTCOME_UNKNOWN' as const;
        const resolutionCaseId = 'resolution-old-intent-never-resend';
        const { context, evidenceSet } = await canonicalResolutionEvidenceSet(
            openingReason,
            resolutionCaseId,
            true,
        );
        const intent: OrderIntent = {
            entityKind: 'order_intent',
            entityId: 'intent-old-never-resend',
            lineageId: 'strategy-1/activation-1/intent-old-never-resend',
            lineageGeneration: 0,
            state: 'unknown',
            revision: 3,
            resolutionCaseId,
            intentId: 'intent-old-never-resend',
            operation: 'place',
            owner: STRATEGY_OWNER,
            purpose: 'unprotected_place',
            payloadHash: HASH_A,
            intendedProvenance: 'automation',
            dispatchAttemptNonce: 'old-intent-dispatch-nonce',
            durableDispatchBlockerId: 'old-intent-dispatch-blocker',
            runtimeEpochId: 'epoch-1',
            senderFence: 'sender-fence-1',
        };
        const decision = evaluateManualResolution({
            context,
            operation: 'apply_unique_final_evidence',
            evidenceSet,
            executionBoundary: transitionBoundary(
                'order_intent',
                intent.entityId,
                'INT-014',
                'MANUAL_FINAL_EVIDENCE_APPLIED',
                intent.lineageGeneration,
                intent.revision,
                intent.lineageId,
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        expect(decision.oldIntentDisposition).toBe('never_resend');
        const link = {
            ...resolutionLink(
                openingReason,
                'resolved_by_final_evidence',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId,
        };
        const base = requestFor('order_intent', 'INT-014', {
            expectedRevision: intent.revision,
            reasonCode: 'MANUAL_FINAL_EVIDENCE_APPLIED',
            resolutionCaseLink: link,
            terminalOutcome: 'place_cancelled',
            correlatedBrokerOrderId: 'broker-old-intent-final',
            reservationClaimSettlementId: 'old-intent-final-settlement',
            targetSideEffectSha256: RESOLUTION_TARGET,
            manualResolutionDecision: decision,
        });
        const terminal = transitionStateEntity(intent, {
            ...base,
            atomicCompanionProofs: [
                proof(
                    'OperationSpecificTerminalOutcome',
                    base,
                    intent,
                    'place_cancelled',
                ),
                proof(
                    'BrokerOrder.current_projection',
                    base,
                    intent,
                    'broker-old-intent-final',
                ),
                proof(
                    'ReservationClaimSettlement',
                    base,
                    intent,
                    'old-intent-final-settlement',
                ),
                proof(
                    'ResolutionCase.terminal',
                    base,
                    intent,
                    resolutionCaseId,
                    link.evidenceHash,
                ),
            ],
        }).entity;
        expect(terminal).toMatchObject({
            state: 'terminal',
            terminalOutcome: 'place_cancelled',
            createdBrokerOrderId: 'broker-old-intent-final',
        });
        expectMachineError(
            () =>
                transitionStateEntity(
                    terminal,
                    requestFor('order_intent', 'INT-002', {
                        expectedRevision: terminal.revision,
                    }),
                ),
            'terminal_entity_closed',
        );
    });

    it('settles an unknown ExitClaim only from unique final evidence without reopening its generation', async () => {
        const openingReason = 'EXIT_CLAIM_UNKNOWN' as const;
        const resolutionCaseId = 'resolution-exit-claim-final';
        const { context, evidenceSet } = await canonicalResolutionEvidenceSet(
            openingReason,
            resolutionCaseId,
            true,
        );
        const claim: ExitClaim = {
            entityKind: 'exit_claim',
            entityId: 'exit-claim-manual-final',
            lineageId: 'obligation-1/exit-claim-manual-final',
            lineageGeneration: 0,
            state: 'unknown',
            revision: 3,
            resolutionCaseId,
            exitClaimId: 'exit-claim-manual-final',
            origin: 'runtime',
            strategyId: 'strategy-1',
            obligationId: 'obligation-1',
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            positionLineageId: 'position-lineage-1',
            remainderGeneration: 7,
            reservedShares: 1000n,
            activeShares: 1000n,
            consumedShares: 0n,
            releasedShares: 0n,
        };
        const decision = evaluateManualResolution({
            context,
            operation: 'apply_unique_final_evidence',
            evidenceSet,
            executionBoundary: transitionBoundary(
                'exit_claim',
                claim.entityId,
                'EXC-010B',
                'MANUAL_FINAL_EVIDENCE_APPLIED',
                claim.lineageGeneration,
                claim.revision,
                claim.lineageId,
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const link = {
            ...resolutionLink(
                openingReason,
                'resolved_by_final_evidence',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId,
        };
        const base = requestFor('exit_claim', 'EXC-010B', {
            expectedRevision: claim.revision,
            resolutionCaseLink: link,
            reservationClaimSettlementId: 'exit-claim-final-settlement',
            targetSideEffectSha256: RESOLUTION_TARGET,
            manualResolutionDecision: decision,
            nextQuantityProjection: {
                entityKind: 'exit_claim',
                activeShares: 0n,
                consumedShares: 1000n,
                releasedShares: 0n,
            },
        });
        const consumed = transitionStateEntity(claim, {
            ...base,
            atomicCompanionProofs: [
                proof(
                    'ResolutionCase.terminal',
                    base,
                    claim,
                    resolutionCaseId,
                    link.evidenceHash,
                ),
                proof(
                    'ReservationClaimSettlement',
                    base,
                    claim,
                    'exit-claim-final-settlement',
                ),
            ],
        }).entity;
        expect(consumed).toMatchObject({
            state: 'consumed',
            remainderGeneration: 7,
            activeShares: 0n,
            consumedShares: 1000n,
            releasedShares: 0n,
        });
    });

    it('keeps the unprotected obligation quantity explicit when break-glass relinquishes local ownership', async () => {
        const openingReason = 'PROTECTION_UNPROTECTED_REMAINDER' as const;
        const resolutionCaseId = 'resolution-obligation-break-glass';
        const { context: contextOne, evidenceSet } =
            await canonicalResolutionEvidenceSet(
                openingReason,
                resolutionCaseId,
            );
        const stepOne = await issueBreakGlassStepOneForTest({
            context: contextOne,
            evidenceSet,
            step: {
                stepId: 'obligation-break-glass-step-1',
                confirmationLineageId: 'obligation-break-glass-lineage',
                nonce: 'obligation-break-glass-nonce-1',
                nonceRevision: 1,
                userConfirmationSha256: `sha256:${HASH_B}`,
            },
        });
        const contextTwo = issueResolutionRuntimeContextForTest({
            reasonCode: openingReason,
            resolutionCaseId,
            caseRevision: 1,
            scopeSha256: RESOLUTION_SCOPE,
            targetSideEffectSha256: RESOLUTION_TARGET,
            runtimeEpochId: 'epoch-1',
            apiGeneration: 'api-generation-1',
            nowEpochMs: Date.parse(NOW) + 1,
        });
        const stepTwo = await issueBreakGlassStepTwoForTest({
            context: contextTwo,
            evidenceSet,
            stepOne,
            step: {
                stepId: 'obligation-break-glass-step-2',
                confirmationLineageId: 'obligation-break-glass-lineage',
                nonce: 'obligation-break-glass-nonce-2',
                nonceRevision: 2,
                userConfirmationSha256: `sha256:${HASH_C}`,
            },
        });
        const verifiedAuthorization =
            await issueBreakGlassAuthorizationForTest({
                context: contextTwo,
                evidenceSet,
                stepOne,
                stepTwo,
            });
        const obligation: ProtectionObligation = {
            entityKind: 'protection_obligation',
            entityId: 'obligation-break-glass',
            lineageId: 'strategy-1/obligation-break-glass',
            lineageGeneration: 0,
            state: 'safety_blocked',
            revision: 3,
            resolutionCaseId,
            obligationId: 'obligation-break-glass',
            strategyId: 'strategy-1',
            commitmentId: 'commitment-break-glass',
            entryIntentId: 'entry-intent-break-glass',
            entryIntentOwner: STRATEGY_OWNER,
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            filledShares: 1000n,
            confirmedExitedShares: 0n,
            protectedShares: 0n,
            runtimeTrackedUnprotectedRemainder: 1000n,
        };
        const decision = evaluateManualResolution({
            context: contextTwo,
            operation: 'break_glass_relinquish',
            evidenceSet,
            authorization: verifiedAuthorization,
            executionBoundary: transitionBoundary(
                'protection_obligation',
                obligation.entityId,
                'POB-014',
                'MANUAL_BREAK_GLASS_RELINQUISHED',
                obligation.lineageGeneration,
                obligation.revision,
                obligation.lineageId,
            ),
        });
        if (!decision.allowed) throw new Error(decision.reason);
        const link = {
            ...resolutionLink(
                openingReason,
                'relinquished_unknown',
                evidenceSet.evidenceSnapshotSha256,
            ),
            resolutionCaseId,
        };
        const authorization: AuthorizationEvidence = {
            authorizationId: 'obligation-break-glass-authorization',
            authorizationHash: decision.authorizationSha256!.slice(
                'sha256:'.length,
            ),
            kind: 'BreakGlassAuthorization',
            burnedNonces: decision.atomicConsume,
            secondConfirmationHash:
                decision.confirmationSteps[1]!.userConfirmationSha256.slice(
                    'sha256:'.length,
                ),
        };
        const base = requestFor('protection_obligation', 'POB-014', {
            expectedRevision: obligation.revision,
            reasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
            resolutionCaseLink: link,
            authorizationEvidence: [authorization],
            reservationClaimSettlementId: 'obligation-break-glass-settlement',
            auditSnapshotHash: HASH_C,
            observedWallTime: new Date(Date.parse(NOW) + 1).toISOString(),
            targetSideEffectSha256: RESOLUTION_TARGET,
            manualResolutionDecision: decision,
        });
        const companionData = [
            ['ReleasedOrFailedLocalEntities', 'obligation-local-release', HASH_C],
            [
                'ResolutionCase.relinquished_unknown',
                resolutionCaseId,
                link.evidenceHash,
            ],
            [
                'RelinquishedUnknownExposure.open',
                link.safetyBlockerId,
                link.evidenceHash,
            ],
            [
                'BurnedDispatchNonce',
                authorization.authorizationId,
                authorization.authorizationHash,
            ],
            [
                'BreakGlassAuthorization',
                authorization.authorizationId,
                authorization.authorizationHash,
            ],
            ['AuditSnapshot', 'obligation-break-glass-audit', HASH_C],
            [
                'ReservationClaimSettlement',
                'obligation-break-glass-settlement',
                HASH_C,
            ],
        ] as const;
        const released = transitionStateEntity(obligation, {
            ...base,
            atomicCompanionProofs: companionData.map(([kind, id, hash]) =>
                proof(kind, base, obligation, id, hash),
            ),
        }).entity;
        expect(released).toMatchObject({
            state: 'released_manual',
            filledShares: 1000n,
            confirmedExitedShares: 0n,
            protectedShares: 0n,
            runtimeTrackedUnprotectedRemainder: 1000n,
        });
    });

    it('rejects operation-mismatched terminal outcomes', () => {
        const prepared = createStateEntity(
            intentInput(),
            requestFor('order_intent', 'INT-001', {
                companionOwnerKind: 'unprotected_place',
            }),
        ).entity;
        expectMachineError(
            () =>
                transitionStateEntity(
                    prepared,
                    requestFor('order_intent', 'INT-003A', {
                        expectedRevision: prepared.revision,
                        terminalOutcome: 'update_cancelled_proven_unsent',
                    }),
                ),
            'intent_outcome_invalid',
        );
        const terminal = transitionStateEntity(
            prepared,
            requestFor('order_intent', 'INT-003A', {
                expectedRevision: prepared.revision,
                terminalOutcome: 'place_cancelled_proven_unsent',
            }),
        ).entity;
        expect(terminal.state).toBe('terminal');
        expect(terminal.terminalOutcome).toBe('place_cancelled_proven_unsent');
    });

    it('increments BrokerOrder controlRevision only with a typed CAS binding', () => {
        const brokerInput: NewEntityByKind<'broker_order'> = {
            entityKind: 'broker_order', entityId: 'broker-1', lineageId: 'intent-1/broker-1',
            lineageGeneration: 0, brokerOrderId: 'broker-1', intentId: 'intent-1',
            fixedAccountOpaqueRef: 'account-1', tradeDate: '2026-08-11',
            contractKey: 'TSE:STK:2330', side: 'Buy', brokerCorrelationHash: HASH_A,
            controlRevision: 0, quantityShares: 100n, filledShares: 0n,
            remainingShares: 100n,
        };
        const broker = createStateEntity(
            brokerInput,
            requestFor('broker_order', 'BRO-003A'),
        ).entity;
        const binding = {
            operation: 'cancel' as const,
            targetBrokerOrderId: 'broker-1',
            controlIntentId: 'cancel-intent-1',
            targetReservationId: 'target-reservation-1',
            expectedControlRevision: 0,
            nextControlRevision: 1,
        };
        const reserve = requestFor('broker_order', 'BRO-010C', {
            expectedRevision: broker.revision,
            reasonCode: 'BROKER_CANCEL_TARGET_RESERVED',
            controlReservationBinding: binding,
        });
        const reserved = transitionStateEntity(broker, {
            ...reserve,
            atomicCompanionProofs: [
                proof('BrokerOrder.controlRevision_incremented', reserve, broker, 'broker-1'),
                proof('OrderIntent.prepared', reserve, broker, 'cancel-intent-1'),
                proof('TargetReservation', reserve, broker, 'target-reservation-1'),
            ],
        }).entity;
        expect(reserved.state).toBe('submitted');
        expect(reserved.revision).toBe(2);
        expect(reserved.controlRevision).toBe(1);
        expectMachineError(
            () =>
                transitionStateEntity(reserved, {
                    ...reserve,
                    expectedRevision: reserved.revision,
                }),
            'control_revision_conflict',
        );
    });

    it('enforces entry protection quantity equations and owner-matched atomic prepare', () => {
        const binding: EntryProtectionAtomicBinding = {
            strategyId: 'strategy-1',
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            entryIntentId: 'entry-intent-1',
            commitmentId: 'commitment-1',
            obligationId: 'obligation-1',
            reservationId: 'reservation-1',
            entryIntentOwner: STRATEGY_OWNER,
        };
        const commitmentInput: NewEntityByKind<'pending_protection_commitment'> = {
            entityKind: 'pending_protection_commitment', entityId: 'commitment-1',
            lineageId: 'strategy-1/entry-1', lineageGeneration: 0,
            commitmentId: 'commitment-1', strategyId: 'strategy-1',
            entryIntentId: 'entry-intent-1', entryIntentOwner: STRATEGY_OWNER,
            obligationId: 'obligation-1', requestedShares: 1000n,
            cumulativeFilledShares: 0n, openPotentialShares: 1000n,
            terminalUnfilledShares: 0n, materializedFilledShares: 0n,
            unmaterializedConfirmedFillShares: 0n,
        };
        const create = requestFor(
            'pending_protection_commitment',
            'PPC-001',
            { entryProtectionBinding: binding },
        );
        const commitment = createStateEntity(commitmentInput, {
            ...create,
            atomicCompanionProofs: [
                proof('OrderIntent.prepared', create, commitmentInput, 'entry-intent-1'),
                proof('PendingProtectionCommitment.prepared', create, commitmentInput, 'commitment-1'),
                proof('ProtectionObligation.pending_entry', create, commitmentInput, 'obligation-1'),
                proof('EntryExposureReservation.reserved_or_policy_not_required', create, commitmentInput, 'reservation-1'),
            ],
        }).entity;
        expect(commitment.state).toBe('prepared');
        const wrongOwnerBinding: EntryProtectionAtomicBinding = {
            ...binding,
            entryIntentOwner: {
                ...STRATEGY_OWNER,
                activationId: 'activation-other',
            },
        };
        expectMachineError(
            () =>
                createStateEntity(commitmentInput, {
                    ...create,
                    transitionRequestId: 'request-wrong-entry-owner',
                    entryProtectionBinding: wrongOwnerBinding,
                    atomicCompanionProofs: [
                        proof(
                            'OrderIntent.prepared',
                            create,
                            commitmentInput,
                            'entry-intent-1',
                            HASH_C,
                            'entry',
                        ),
                        proof(
                            'PendingProtectionCommitment.prepared',
                            create,
                            commitmentInput,
                            'commitment-1',
                            HASH_C,
                            'entry',
                        ),
                        proof(
                            'ProtectionObligation.pending_entry',
                            create,
                            commitmentInput,
                            'obligation-1',
                            HASH_C,
                            'entry',
                        ),
                        proof(
                            'EntryExposureReservation.reserved_or_policy_not_required',
                            create,
                            commitmentInput,
                            'reservation-1',
                            HASH_C,
                            'entry',
                        ),
                    ],
                }),
            'lineage_mismatch',
        );
        const crossAccountObligation: NewEntityByKind<'protection_obligation'> = {
            entityKind: 'protection_obligation',
            entityId: 'obligation-1',
            lineageId: 'strategy-1/entry-1',
            lineageGeneration: 0,
            obligationId: 'obligation-1',
            strategyId: 'strategy-1',
            commitmentId: 'commitment-1',
            entryIntentId: 'entry-intent-1',
            entryIntentOwner: STRATEGY_OWNER,
            fixedAccountOpaqueRef: 'account-ref-other',
            contractKey: 'TSE:STK:2330',
            filledShares: 0n,
            confirmedExitedShares: 0n,
            protectedShares: 0n,
            runtimeTrackedUnprotectedRemainder: 0n,
        };
        expectMachineError(
            () =>
                createStateEntity(
                    crossAccountObligation,
                    requestFor('protection_obligation', 'POB-001', {
                        entryProtectionBinding: binding,
                    }),
                ),
            'lineage_mismatch',
        );
        expectMachineError(
            () =>
                createStateEntity(
                    { ...commitmentInput, openPotentialShares: 999n },
                    {
                        ...create,
                        transitionRequestId: 'request-bad-quantity',
                        atomicCompanionProofs: [
                            proof('OrderIntent.prepared', create, commitmentInput, 'entry-intent-1'),
                            proof('PendingProtectionCommitment.prepared', create, commitmentInput, 'commitment-1'),
                            proof('ProtectionObligation.pending_entry', create, commitmentInput, 'obligation-1'),
                            proof('EntryExposureReservation.reserved_or_policy_not_required', create, commitmentInput, 'reservation-1'),
                        ],
                    },
                ),
            'entity_invariant_violation',
        );
        const release = requestFor(
            'pending_protection_commitment',
            'PPC-003',
            { expectedRevision: commitment.revision },
        );
        expectMachineError(
            () => transitionStateEntity(commitment, release),
            'entity_invariant_violation',
        );
        const released = transitionStateEntity(commitment, {
            ...release,
            nextQuantityProjection: {
                entityKind: 'pending_protection_commitment',
                cumulativeFilledShares: 0n,
                openPotentialShares: 0n,
                terminalUnfilledShares: 1000n,
                materializedFilledShares: 0n,
                unmaterializedConfirmedFillShares: 0n,
            },
        }).entity;
        expect(released.state).toBe('released_pre_dispatch');
        expect(released.openPotentialShares).toBe(0n);
    });

    it('binds an exit preparation to the exact intent owner lineage', () => {
        const armed = createStateEntity(
            activationInput({ intentPurpose: 'exit' }),
            requestFor('activation', 'ACT-001'),
        ).entity;
        const triggered = transitionStateEntity(
            armed,
            requestFor('activation', 'ACT-002', {
                expectedRevision: armed.revision,
            }),
        ).entity;
        const binding: ExitProtectionAtomicBinding = {
            strategyId: 'strategy-1',
            fixedAccountOpaqueRef: 'account-ref-1',
            contractKey: 'TSE:STK:2330',
            positionLineageId: 'position-lineage-1',
            protectionGroupId: 'protection-group-1',
            remainderGeneration: 0,
            activationId: triggered.activationId,
            winnerLegId: 'stop-leg',
            suppressedSetId: 'suppressed-set-1',
            suppressedLegIds: ['take-leg'],
            exitClaimId: 'exit-claim-1',
            exitIntentId: 'exit-intent-1',
            exitIntentOwner: STRATEGY_OWNER,
            obligationId: 'obligation-1',
        };
        const prepare = requestFor('activation', 'ACT-005', {
            expectedRevision: triggered.revision,
            exitProtectionBinding: binding,
        });
        const companions = [
            proof(
                'Activation.single_protection_generation',
                prepare,
                triggered,
                binding.activationId,
                HASH_C,
                'exit',
            ),
            proof(
                'ProtectionLegEvaluation.winner',
                prepare,
                triggered,
                binding.winnerLegId,
                HASH_C,
                'exit',
            ),
            proof(
                'ProtectionLegEvaluation.suppressed',
                prepare,
                triggered,
                binding.suppressedSetId,
                HASH_C,
                'exit',
            ),
            proof(
                'ExitClaim.intent_reserved',
                prepare,
                triggered,
                binding.exitClaimId,
                HASH_C,
                'exit',
            ),
            proof(
                'ExitOrderIntent.prepared',
                prepare,
                triggered,
                binding.exitIntentId,
                HASH_C,
                'exit',
            ),
        ];
        expect(
            transitionStateEntity(triggered, {
                ...prepare,
                atomicCompanionProofs: companions,
            }).entity,
        ).toMatchObject({
            state: 'prepared',
            primaryPlaceIntentId: 'exit-intent-1',
            winnerLegId: 'stop-leg',
        });

        expectMachineError(
            () =>
                transitionStateEntity(triggered, {
                    ...prepare,
                    transitionRequestId: 'request-wrong-exit-owner',
                    exitProtectionBinding: {
                        ...binding,
                        exitIntentOwner: {
                            ...STRATEGY_OWNER,
                            activationId: 'activation-other',
                        },
                    },
                    atomicCompanionProofs: companions,
                }),
            'lineage_mismatch',
        );

        const crossAccountObligation: ProtectionObligation = {
            entityKind: 'protection_obligation',
            entityId: 'obligation-1',
            lineageId: 'strategy-1/obligation-1',
            lineageGeneration: 0,
            state: 'monitoring',
            revision: 1,
            obligationId: 'obligation-1',
            strategyId: 'strategy-1',
            commitmentId: 'commitment-1',
            entryIntentId: 'entry-intent-1',
            entryIntentOwner: STRATEGY_OWNER,
            fixedAccountOpaqueRef: 'account-ref-other',
            contractKey: 'TSE:STK:2330',
            filledShares: 1000n,
            confirmedExitedShares: 0n,
            protectedShares: 1000n,
            runtimeTrackedUnprotectedRemainder: 0n,
        };
        expectMachineError(
            () =>
                transitionStateEntity(
                    crossAccountObligation,
                    requestFor('protection_obligation', 'POB-006', {
                        exitProtectionBinding: binding,
                    }),
                ),
            'lineage_mismatch',
        );
    });

    it('requires same-lineage companion proofs, not merely the right companion names', () => {
        const activation = createStateEntity(
            activationInput({
                intentPurpose: 'unprotected_place',
            }),
            requestFor('activation', 'ACT-001'),
        ).entity;
        const prepare = requestFor('activation', 'ACT-002', {
            expectedRevision: activation.revision,
        });
        const triggered = transitionStateEntity(activation, prepare).entity;
        const act005 = requestFor('activation', 'ACT-005', {
            expectedRevision: triggered.revision,
            companionOwnerKind: 'unprotected_place',
            preparedIntentId: 'intent-1',
        });
        const wrongProof = {
            ...proof(
                'OrderIntent.prepared',
                act005,
                triggered,
                'intent-1',
                HASH_A,
                'unprotected_place',
            ),
            lineageId: 'another-lineage',
        };
        expectMachineError(
            () =>
                transitionStateEntity(triggered, {
                    ...act005,
                    atomicCompanionProofs: [wrongProof],
                }),
            'atomic_companion_mismatch',
        );
    });

    it('binds DurableDispatchBlocker clearance to the same operation and final evidence', () => {
        const blockerInput: NewEntityByKind<'durable_dispatch_blocker'> = {
            entityKind: 'durable_dispatch_blocker',
            entityId: 'dispatch-blocker-1',
            lineageId: 'strategy-1/intent-1',
            lineageGeneration: 0,
            intentId: 'intent-1',
            intentOperation: 'place',
            dispatchAttemptNonce: 'nonce-1',
            runtimeEpochId: 'epoch-1',
            senderFence: 'sender-fence-1',
            apiGeneration: 'api-generation-1',
            modeMarkerRevision: 'mode-revision-1',
            accountOpaqueRef: 'account-1',
            intentProvenance: 'automation',
        };
        const dispatchBinding = {
            activationId: 'activation-1',
            intentId: 'intent-1',
            intentOperation: 'place' as const,
            durableDispatchBlockerId: 'dispatch-blocker-1',
            dispatchAttemptNonce: 'nonce-1',
            senderFence: 'sender-fence-1',
            runtimeEpochId: 'epoch-1',
            intendedProvenance: 'automation' as const,
        };
        const openRequest = requestFor(
            'durable_dispatch_blocker',
            'DDB-001',
            {
                brokerWriteProvenance: 'automation',
                dispatchBinding,
            },
        );
        const open = createStateEntity(blockerInput, {
            ...openRequest,
            atomicCompanionProofs: [
                proof(
                    'Activation.dispatching',
                    openRequest,
                    blockerInput,
                    'activation-1',
                ),
                proof(
                    'OrderIntent.dispatching',
                    openRequest,
                    blockerInput,
                    'intent-1',
                ),
                proof(
                    'DurableDispatchBlocker.open',
                    openRequest,
                    blockerInput,
                    'dispatch-blocker-1',
                ),
            ],
        }).entity;
        const terminalRequest = requestFor(
            'durable_dispatch_blocker',
            'DDB-003',
            {
                expectedRevision: open.revision,
                terminalOutcome: 'place_cancelled_proven_unsent',
                correlatedBrokerOrderId: 'broker-1',
                reservationClaimSettlementId: 'settlement-1',
            },
        );
        expectMachineError(
            () => transitionStateEntity(open, terminalRequest),
            'intent_outcome_invalid',
        );
        const finalRequest = {
            ...terminalRequest,
            terminalOutcome: 'place_filled' as const,
        };
        const cleared = transitionStateEntity(open, {
            ...finalRequest,
            atomicCompanionProofs: [
                proof(
                    'OperationSpecificTerminalOutcome',
                    finalRequest,
                    open,
                    'place_filled',
                ),
                proof(
                    'BrokerOrder.current_projection',
                    finalRequest,
                    open,
                    'broker-1',
                ),
                proof(
                    'ReservationClaimSettlement',
                    finalRequest,
                    open,
                    'settlement-1',
                ),
                proof(
                    'DurableDispatchBlocker.cleared_terminal',
                    finalRequest,
                    open,
                    'dispatch-blocker-1',
                ),
            ],
        }).entity;
        expect(cleared.state).toBe('cleared_terminal');
    });
});

describe('RuntimeEpoch safety lifecycle', () => {
    it('requires same-epoch full reconciliation before observe_only', () => {
        const starting = createStateEntity(
            runtimeEpochInput(),
            requestFor('runtime_epoch', 'RTE-001'),
        ).entity;
        const fenced = transitionStateEntity(
            starting,
            requestFor('runtime_epoch', 'RTE-002', {
                expectedRevision: starting.revision,
            }),
        ).entity;
        const reconciling = transitionStateEntity(
            fenced,
            requestFor('runtime_epoch', 'RTE-004', {
                expectedRevision: fenced.revision,
            }),
        ).entity;
        const observeOnly = transitionStateEntity(
            reconciling,
            requestFor('runtime_epoch', 'RTE-005', {
                expectedRevision: reconciling.revision,
            }),
        ).entity;
        expect(observeOnly.state).toBe('observe_only');
        expect(observeOnly.fullReconciliationCompletedInEpoch).toBe(true);
    });

    it('rejects quiescing to observe_only when the epoch never reconciled', () => {
        const starting = createStateEntity(
            runtimeEpochInput(),
            requestFor('runtime_epoch', 'RTE-001'),
        ).entity;
        const quiescing = transitionStateEntity(
            starting,
            requestFor('runtime_epoch', 'RTE-011A', {
                expectedRevision: starting.revision,
            }),
        ).entity;
        expectMachineError(
            () =>
                transitionStateEntity(
                    quiescing,
                    requestFor('runtime_epoch', 'RTE-013A', {
                        expectedRevision: quiescing.revision,
                    }),
                ),
            'runtime_epoch_invariant',
        );
    });

    it('allows graceful stop without reconciliation only when authority and history never existed', () => {
        const starting = createStateEntity(
            runtimeEpochInput(),
            requestFor('runtime_epoch', 'RTE-001'),
        ).entity;
        const quiescing = transitionStateEntity(
            starting,
            requestFor('runtime_epoch', 'RTE-011A', {
                expectedRevision: starting.revision,
            }),
        ).entity;
        const stopProof = {
            ephemeralProcessLeaseCount: 0,
            openDurableDispatchBlockerCount: 0,
            requiredDrainPassed: true,
            durableSnapshotHash: HASH_A,
            databaseCommitReliablyAvailable: true,
            senderAuthorityEverAcquired: false,
            durableSideEffectHistoryExists: false,
            durableObligationHistoryExists: false,
        };
        const stopped = transitionStateEntity(
            quiescing,
            requestFor('runtime_epoch', 'RTE-012', {
                expectedRevision: quiescing.revision,
                runtimeStopProof: stopProof,
            }),
        ).entity;
        expect(stopped.state).toBe('stopped');
    });
});
