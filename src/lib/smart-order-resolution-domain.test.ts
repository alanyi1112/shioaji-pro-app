import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_MANUAL_RESOLUTION_POLICY,
    SMART_ORDER_MANUAL_RESOLUTION_POLICY_SCHEMA_VERSION,
} from '../../scripts/smart-order-runtime/manual-resolution-policy.mjs';
import {
    MANUAL_INTERVENTION_REASON_CODES,
    MANUAL_RESOLUTION_MATRIX,
    SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION,
    SMART_ORDER_RESOLUTION_TEST_ONLY,
    SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION,
    consumeVerifiedManualResolutionDecision,
    consumeVerifiedBlockingStateResolutionDecision,
    evaluateBlockingStateResolution,
    evaluateManualResolution as evaluateManualResolutionDomain,
    getBlockingResolutionRequiredEvidence,
    getSafetyBlockerResolutionRequiredEvidence,
    isSafetyBlockerReasonAllowed,
    isVerifiedBlockingStateResolutionDecision,
    isVerifiedManualResolutionDecision,
    type ManualResolutionOperation,
    type ManualInterventionReasonCode,
    type ManualResolutionMatrixRow,
    type BlockingResolutionReasonCode,
    type ResolutionExecutionBoundary,
    type ResolutionEvidenceClass,
    type SafetyBlockerResolutionBinding,
    type SafetyBlockerResolutionKind,
    type VerifiedResolutionEvidenceSet,
    type VerifiedResolutionRuntimeContext,
} from './smart-order-resolution-domain';

if (!SMART_ORDER_RESOLUTION_TEST_ONLY) {
    throw new Error('smart-order resolution test issuer surface is unavailable');
}

const {
    issueAuthorization,
    issueBreakGlassAuthorization,
    issueBreakGlassStepOne,
    issueBreakGlassStepTwo,
    issueEvidence,
    issueEvidenceSet,
    issueRuntimeContext,
    issueSafetyBlockerSuccessor,
} = SMART_ORDER_RESOLUTION_TEST_ONLY;

const SCOPE = `sha256:${'a'.repeat(64)}` as const;
const EVIDENCE = `sha256:${'b'.repeat(64)}` as const;
const TARGET = `sha256:${'c'.repeat(64)}` as const;
const FRESH_CONFIRMATION = `sha256:${'d'.repeat(64)}` as const;
const USER_CONFIRMATION_ONE = `sha256:${'e'.repeat(64)}` as const;
const USER_CONFIRMATION_TWO = `sha256:${'f'.repeat(64)}` as const;
const FINAL_EVIDENCE_CLASSES = new Set<ResolutionEvidenceClass>([
    'broker_full_orders_trades_deals',
    'canonical_broker_correlation',
]);

type ExpectedManualResolutionPolicy = Omit<
    ManualResolutionMatrixRow,
    'reasonCode'
>;

const EXPECTED_MANUAL_RESOLUTION_POLICIES = {
    BROKER_OUTCOME_UNKNOWN: {
        requiredEvidence: [
            'broker_full_orders_trades_deals',
            'broker_position_and_working_set',
            'canonical_broker_correlation',
        ],
        allowedOperations: [
            'apply_unique_final_evidence',
            'break_glass_relinquish',
            'remain_open',
        ],
        destinations: [
            'paused',
            'resolution_case_open',
            'resolution_case_relinquished_unknown',
        ],
        rearmPolicy: 'never',
        obligationPolicy: 'settle_from_unique_final_quantities',
        breakGlassAllowed: true,
        oldIntentDisposition: 'never_resend',
    },
    BROKER_CORRELATION_AMBIGUOUS: {
        requiredEvidence: [
            'broker_full_orders_trades_deals',
            'broker_position_and_working_set',
            'canonical_broker_correlation',
        ],
        allowedOperations: [
            'apply_unique_final_evidence',
            'break_glass_relinquish',
            'remain_open',
        ],
        destinations: [
            'paused',
            'resolution_case_open',
            'resolution_case_relinquished_unknown',
        ],
        rearmPolicy: 'never',
        obligationPolicy: 'preserve_unknown_and_block',
        breakGlassAllowed: true,
        oldIntentDisposition: 'never_resend',
    },
    BROKER_ACCOUNT_MISMATCH: {
        requiredEvidence: [
            'fixed_account_subscription',
            'broker_full_orders_trades_deals',
            'canonical_broker_correlation',
        ],
        allowedOperations: ['apply_unique_final_evidence', 'remain_open'],
        destinations: ['paused', 'resolution_case_open'],
        rearmPolicy: 'never',
        obligationPolicy: 'preserve_unknown_and_block',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
    BROKER_FINAL_EVIDENCE_CONFLICT: {
        requiredEvidence: [
            'immutable_evidence_hashes',
            'broker_full_orders_trades_deals',
            'broker_position_and_working_set',
        ],
        allowedOperations: ['apply_unique_final_evidence', 'remain_open'],
        destinations: ['terminal_entity_unchanged', 'resolution_case_open'],
        rearmPolicy: 'never',
        obligationPolicy: 'recompute_after_full_reconciliation',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
    ACTIVATION_ID_CONFLICT: {
        requiredEvidence: [
            'immutable_evidence_hashes',
            'activation_key_and_unique_index_audit',
            'canonical_broker_correlation',
            'broker_position_and_working_set',
        ],
        allowedOperations: ['apply_unique_final_evidence', 'remain_open'],
        destinations: ['terminal_entity_unchanged', 'resolution_case_open'],
        rearmPolicy: 'never',
        obligationPolicy: 'recompute_after_full_reconciliation',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
    ENTRY_RESULT_UNKNOWN: {
        requiredEvidence: [
            'broker_full_orders_trades_deals',
            'broker_position_and_working_set',
            'canonical_broker_correlation',
            'entry_cumulative_fill_projection',
        ],
        allowedOperations: [
            'apply_unique_final_evidence',
            'break_glass_relinquish',
            'remain_open',
        ],
        destinations: [
            'paused',
            'resolution_case_open',
            'resolution_case_relinquished_unknown',
        ],
        rearmPolicy: 'never',
        obligationPolicy: 'settle_from_unique_final_quantities',
        breakGlassAllowed: true,
        oldIntentDisposition: 'never_resend',
    },
    EXIT_CLAIM_UNKNOWN: {
        requiredEvidence: [
            'broker_full_orders_trades_deals',
            'broker_position_and_working_set',
            'canonical_broker_correlation',
            'exit_claim_remainder_projection',
        ],
        allowedOperations: [
            'apply_unique_final_evidence',
            'break_glass_relinquish',
            'remain_open',
        ],
        destinations: [
            'paused',
            'resolution_case_open',
            'resolution_case_relinquished_unknown',
        ],
        rearmPolicy: 'new_remainder_generation_after_reconciliation',
        obligationPolicy: 'rebuild_only_as_new_claim_generation',
        breakGlassAllowed: true,
        oldIntentDisposition: 'never_resend',
    },
    EXTERNAL_POSITION_DRIFT: {
        requiredEvidence: [
            'full_position_unit_reconciliation',
            'full_external_working_set',
            'fresh_confirmation_snapshot',
        ],
        allowedOperations: [
            'reconfirm_and_pause',
            'cancel_strategy',
            'copy_to_new_draft',
            'remain_open',
        ],
        destinations: ['paused', 'cancel_pending', 'resolution_case_open'],
        rearmPolicy: 'new_confirmation_and_user_arm',
        obligationPolicy: 'recompute_after_full_reconciliation',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
    QUOTE_GAP_CROSSING_UNKNOWN: {
        requiredEvidence: ['eligible_observation_gap_evidence'],
        allowedOperations: [
            'reconfirm_and_pause',
            'cancel_strategy',
            'copy_to_new_draft',
            'remain_open',
        ],
        destinations: ['paused', 'cancel_pending', 'resolution_case_open'],
        rearmPolicy: 'new_arm_generation_after_fresh_false',
        obligationPolicy: 'preserve_existing_broker_obligations',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
    TRAILING_GAP_EXTREME_UNKNOWN: {
        requiredEvidence: [
            'eligible_observation_gap_evidence',
            'broker_position_and_working_set',
        ],
        allowedOperations: [
            'cancel_strategy',
            'copy_to_new_draft',
            'break_glass_relinquish',
            'remain_open',
        ],
        destinations: [
            'cancel_pending',
            'resolution_case_open',
            'resolution_case_relinquished_unknown',
        ],
        rearmPolicy: 'never',
        obligationPolicy:
            'release_only_with_durable_unknown_exposure_blocker',
        breakGlassAllowed: true,
        oldIntentDisposition: 'never_resend',
    },
    POSITION_OR_UNIT_UNKNOWN: {
        requiredEvidence: [
            'full_position_unit_reconciliation',
            'broker_position_and_working_set',
            'new_runtime_epoch_reconciliation',
        ],
        allowedOperations: ['repair_gate_observe_only', 'remain_open'],
        destinations: ['observe_only', 'resolution_case_open'],
        rearmPolicy: 'new_runtime_epoch_and_user_arm',
        obligationPolicy: 'preserve_unknown_and_block',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
    PROTECTION_UNPROTECTED_REMAINDER: {
        requiredEvidence: [
            'current_protection_remainder_snapshot',
            'full_position_unit_reconciliation',
            'full_external_working_set',
        ],
        allowedOperations: [
            'reconfirm_and_pause',
            'break_glass_relinquish',
            'remain_open',
        ],
        destinations: [
            'paused',
            'resolution_case_open',
            'resolution_case_relinquished_unknown',
        ],
        rearmPolicy: 'new_remainder_generation_after_reconciliation',
        obligationPolicy: 'rebuild_only_as_new_claim_generation',
        breakGlassAllowed: true,
        oldIntentDisposition: 'never_resend',
    },
    DB_INTEGRITY_FAILED: {
        requiredEvidence: [
            'verified_database_restore_integrity',
            'single_writer_fence_evidence',
            'broker_full_orders_trades_deals',
            'broker_position_and_working_set',
        ],
        allowedOperations: ['repair_gate_observe_only', 'remain_open'],
        destinations: ['observe_only', 'resolution_case_open'],
        rearmPolicy: 'new_runtime_epoch_and_user_arm',
        obligationPolicy: 'recompute_after_full_reconciliation',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
    IDENTITY_MAPPING_CONFLICT: {
        requiredEvidence: [
            'identity_mapping_and_key_audit',
            'broker_position_and_working_set',
        ],
        allowedOperations: ['repair_gate_observe_only', 'remain_open'],
        destinations: ['observe_only', 'resolution_case_open'],
        rearmPolicy: 'new_runtime_epoch_and_user_arm',
        obligationPolicy: 'preserve_unknown_and_block',
        breakGlassAllowed: false,
        oldIntentDisposition: 'never_resend',
    },
} as const satisfies Readonly<
    Record<ManualInterventionReasonCode, ExpectedManualResolutionPolicy>
>;

function defaultExecutionBoundary(
    operation: ManualResolutionOperation,
    context: VerifiedResolutionRuntimeContext,
): ResolutionExecutionBoundary {
    switch (operation) {
        case 'cancel_strategy':
        case 'copy_to_new_draft':
        case 'repair_gate_observe_only':
        case 'remain_open':
            return {
                kind: 'resolution_service',
                operation,
                resolutionCaseId: context.resolutionCaseId,
                caseRevision: context.caseRevision,
                sourceEntityKind:
                    operation === 'repair_gate_observe_only'
                        ? 'runtime_epoch'
                        : operation === 'remain_open'
                          ? 'resolution_case'
                          : 'strategy',
                sourceEntityId: `${operation}-source`,
                sourceEntityExpectedRevision: 1,
                serviceRequestSha256: EVIDENCE,
            };
        case 'reconfirm_and_pause':
            return {
                kind: 'state_transition',
                entityKind: 'strategy',
                entityId: 'strategy-resolution-target',
                lineageId: 'strategy-resolution-target',
                lineageGeneration: 0,
                expectedRevision: 1,
                effectProjectionSha256: EVIDENCE,
                edgeId: 'STR-010',
                fromState: 'manual_intervention',
                toState: 'paused',
                transitionReasonCode: 'MANUAL_RESOLUTION_RECONFIRMED',
            };
        case 'break_glass_relinquish':
            return {
                kind: 'state_transition',
                entityKind: 'activation',
                entityId: 'activation-resolution-target',
                lineageId: 'strategy/activation-resolution-target',
                lineageGeneration: 0,
                expectedRevision: 1,
                effectProjectionSha256: EVIDENCE,
                edgeId: 'ACT-015E',
                fromState: 'unknown',
                toState: 'failed',
                transitionReasonCode: 'MANUAL_BREAK_GLASS_RELINQUISHED',
            };
        case 'apply_unique_final_evidence':
            return {
                kind: 'state_transition',
                entityKind: 'activation',
                entityId: 'activation-resolution-target',
                lineageId: 'strategy/activation-resolution-target',
                lineageGeneration: 0,
                expectedRevision: 1,
                effectProjectionSha256: EVIDENCE,
                edgeId: 'ACT-015D',
                fromState: 'unknown',
                toState: 'cancelled',
                transitionReasonCode: 'MANUAL_FINAL_EVIDENCE_APPLIED',
            };
        case 'generic_resume':
            return {
                kind: 'resolution_service',
                operation: 'remain_open',
                resolutionCaseId: context.resolutionCaseId,
                caseRevision: context.caseRevision,
                sourceEntityKind: 'resolution_case',
                sourceEntityId: 'generic-resume-source',
                sourceEntityExpectedRevision: 1,
                serviceRequestSha256: EVIDENCE,
            };
    }
}

type ManualResolutionInput = Parameters<
    typeof evaluateManualResolutionDomain
>[0];

function evaluateManualResolution(
    input: Omit<ManualResolutionInput, 'executionBoundary'> & {
        executionBoundary?: ResolutionExecutionBoundary;
    },
) {
    return evaluateManualResolutionDomain({
        ...input,
        executionBoundary:
            input.executionBoundary ??
            defaultExecutionBoundary(input.operation, input.context),
    });
}

function runtimeContext(input: {
    reasonCode: BlockingResolutionReasonCode;
    resolutionCaseId: string;
    caseRevision?: number;
    nowEpochMs?: number;
    targetSideEffectSha256?: string;
}): VerifiedResolutionRuntimeContext {
    return issueRuntimeContext({
        reasonCode: input.reasonCode,
        resolutionCaseId: input.resolutionCaseId,
        caseRevision: input.caseRevision ?? 1,
        scopeSha256: SCOPE,
        targetSideEffectSha256: input.targetSideEffectSha256 ?? TARGET,
        runtimeEpochId: 'runtime-epoch-1',
        apiGeneration: 'api-generation-1',
        nowEpochMs: input.nowEpochMs ?? 10_000,
    });
}

function evidenceFor(
    context: VerifiedResolutionRuntimeContext,
    evidenceClass: ResolutionEvidenceClass,
    finality: 'not_final' | 'unique_broker_terminal' = 'not_final',
    evidenceSha256: `sha256:${string}` = EVIDENCE,
) {
    return issueEvidence({
        context,
        evidenceClass,
        evidenceSha256,
        revision: `${context.reasonCode}-${evidenceClass}`,
        finality,
    });
}

async function completeEvidenceSet(
    context: VerifiedResolutionRuntimeContext,
    withUniqueFinal = false,
    extraEvidence: readonly ResolutionEvidenceClass[] = [],
    evidenceSha256ByClass: Readonly<
        Partial<Record<ResolutionEvidenceClass, `sha256:${string}`>>
    > = {},
): Promise<VerifiedResolutionEvidenceSet> {
    const requiredEvidence = [
        ...new Set([
            ...getBlockingResolutionRequiredEvidence(context.reasonCode),
            ...extraEvidence,
        ]),
    ];
    let finalAssigned = false;
    const evidence = requiredEvidence.map((evidenceClass) => {
        const shouldBeFinal =
            withUniqueFinal &&
            !finalAssigned &&
            FINAL_EVIDENCE_CLASSES.has(evidenceClass);
        if (shouldBeFinal) finalAssigned = true;
        return evidenceFor(
            context,
            evidenceClass,
            shouldBeFinal ? 'unique_broker_terminal' : 'not_final',
            evidenceSha256ByClass[evidenceClass] ?? EVIDENCE,
        );
    });
    return issueEvidenceSet({ context, evidence });
}

const SCOPE_MEMBER_A = `sha256:${'1'.repeat(64)}` as const;
const SCOPE_MEMBER_B = `sha256:${'2'.repeat(64)}` as const;

function safetyBlockerBinding(input: {
    context: VerifiedResolutionRuntimeContext;
    blockerId: string;
    blockerKind: SafetyBlockerResolutionKind;
    lineageId: string;
    resolutionPath: SafetyBlockerResolutionBinding['resolutionPath'];
    worstCasePositionDeltaShares?: string;
    possiblyWorkingShares?: string;
    gateApprovedZeroBoundsEvidenceSha256?: `sha256:${string}`;
    successor?: SafetyBlockerResolutionBinding['successor'];
}): SafetyBlockerResolutionBinding {
    return {
        policyVersion:
            SMART_ORDER_SAFETY_BLOCKER_RESOLUTION_POLICY_VERSION,
        blockerId: input.blockerId,
        blockerKind: input.blockerKind,
        resolutionCaseId: input.context.resolutionCaseId,
        lineageId: input.lineageId,
        lineageGeneration: 0,
        scope: {
            scopeId: 'scope-1',
            memberSha256: [SCOPE_MEMBER_A],
        },
        resolutionPath: input.resolutionPath,
        ...(input.worstCasePositionDeltaShares !== undefined
            ? {
                  worstCasePositionDeltaShares:
                      input.worstCasePositionDeltaShares,
              }
            : {}),
        ...(input.possiblyWorkingShares !== undefined
            ? { possiblyWorkingShares: input.possiblyWorkingShares }
            : {}),
        ...(input.gateApprovedZeroBoundsEvidenceSha256
            ? {
                  gateApprovedZeroBoundsEvidenceSha256:
                      input.gateApprovedZeroBoundsEvidenceSha256,
              }
            : {}),
        ...(input.successor ? { successor: input.successor } : {}),
    };
}

async function authorization(input: {
    kind: 'user_rearm' | 'lifecycle';
    context: VerifiedResolutionRuntimeContext;
    evidenceSet: VerifiedResolutionEvidenceSet;
    noncePrefix: string;
}) {
    return issueAuthorization({
        kind: input.kind,
        context: input.context,
        evidenceSet: input.evidenceSet,
        ...(input.kind === 'user_rearm'
            ? { freshConfirmationSha256: FRESH_CONFIRMATION }
            : {}),
        step: {
            stepId: `${input.noncePrefix}-step-1`,
            confirmationLineageId: `${input.noncePrefix}-lineage`,
            nonce: `${input.noncePrefix}-nonce-1`,
            nonceRevision: 1,
            userConfirmationSha256: USER_CONFIRMATION_ONE,
        },
    });
}

describe('versioned manual resolution matrix', () => {
    it('keeps the production service policy exactly aligned with the domain matrix', () => {
        expect(SMART_ORDER_MANUAL_RESOLUTION_POLICY_SCHEMA_VERSION).toBe(
            SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION,
        );
        expect(SMART_ORDER_MANUAL_RESOLUTION_POLICY).toEqual(
            MANUAL_RESOLUTION_MATRIX.map((row) => ({
                reasonCode: row.reasonCode,
                requiredEvidence: row.requiredEvidence,
                allowedOperations: row.allowedOperations,
                breakGlassAllowed: row.breakGlassAllowed,
                oldIntentDisposition: row.oldIntentDisposition,
            })),
        );
    });
    it('pins schema version and every reason policy field exactly', () => {
        expect(SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION).toBe(
            'smart-order-manual-resolution/2026-08-11.6',
        );
        for (const reasonCode of MANUAL_INTERVENTION_REASON_CODES) {
            const actual = MANUAL_RESOLUTION_MATRIX.find(
                (row) => row.reasonCode === reasonCode,
            );
            expect(actual, reasonCode).toBeDefined();
            expect(actual).toEqual({
                reasonCode,
                ...EXPECTED_MANUAL_RESOLUTION_POLICIES[reasonCode],
            });
        }
    });

    it('covers every Strategy manual-intervention reason exactly once', () => {
        expect(MANUAL_RESOLUTION_MATRIX.map((row) => row.reasonCode).sort()).toEqual(
            [...MANUAL_INTERVENTION_REASON_CODES].sort(),
        );
        expect(new Set(MANUAL_RESOLUTION_MATRIX.map((row) => row.reasonCode)).size).toBe(
            MANUAL_INTERVENTION_REASON_CODES.length,
        );
        expect(
            MANUAL_RESOLUTION_MATRIX.every(
                (row) => row.oldIntentDisposition === 'never_resend',
            ),
        ).toBe(true);
    });

    it.each([
        {
            reasonCode: 'BROKER_CORRELATION_AMBIGUOUS' as const,
            operation: 'apply_unique_final_evidence' as const,
            withUniqueFinal: true,
            authorizationKind: undefined,
            destination: 'paused' as const,
            expectedCompanion: 'resolution_case_terminal' as const,
        },
        {
            reasonCode: 'BROKER_FINAL_EVIDENCE_CONFLICT' as const,
            operation: 'apply_unique_final_evidence' as const,
            withUniqueFinal: true,
            authorizationKind: undefined,
            destination: 'terminal_entity_unchanged' as const,
            expectedCompanion: 'terminal_evidence_correction' as const,
        },
        {
            reasonCode: 'ACTIVATION_ID_CONFLICT' as const,
            operation: 'apply_unique_final_evidence' as const,
            withUniqueFinal: true,
            authorizationKind: undefined,
            destination: 'terminal_entity_unchanged' as const,
            expectedCompanion: 'terminal_evidence_correction' as const,
        },
        {
            reasonCode: 'EXIT_CLAIM_UNKNOWN' as const,
            operation: 'apply_unique_final_evidence' as const,
            withUniqueFinal: true,
            authorizationKind: undefined,
            destination: 'paused' as const,
            expectedCompanion:
                'reservation_claim_obligation_settlement' as const,
        },
        {
            reasonCode: 'PROTECTION_UNPROTECTED_REMAINDER' as const,
            operation: 'reconfirm_and_pause' as const,
            withUniqueFinal: false,
            authorizationKind: 'user_rearm' as const,
            destination: 'paused' as const,
            expectedCompanion:
                'reservation_claim_obligation_settlement' as const,
        },
        {
            reasonCode: 'IDENTITY_MAPPING_CONFLICT' as const,
            operation: 'repair_gate_observe_only' as const,
            withUniqueFinal: false,
            authorizationKind: 'lifecycle' as const,
            destination: 'observe_only' as const,
            expectedCompanion: 'runtime_observe_only_blocker_open' as const,
        },
    ])(
        'directly exercises $reasonCode resolution policy',
        async (candidate) => {
            const context = runtimeContext({
                reasonCode: candidate.reasonCode,
                resolutionCaseId: `case-direct-${candidate.reasonCode.toLowerCase()}`,
            });
            const evidenceSet = await completeEvidenceSet(
                context,
                candidate.withUniqueFinal,
            );
            const verifiedAuthorization = candidate.authorizationKind
                ? await authorization({
                      kind: candidate.authorizationKind,
                      context,
                      evidenceSet,
                      noncePrefix: `direct-${candidate.reasonCode.toLowerCase()}`,
                  })
                : undefined;
            const decision = evaluateManualResolution({
                context,
                operation: candidate.operation,
                evidenceSet,
                ...(verifiedAuthorization
                    ? { authorization: verifiedAuthorization }
                    : {}),
            });
            expect(decision).toMatchObject({
                allowed: true,
                decisionSchemaVersion:
                    SMART_ORDER_RESOLUTION_MATRIX_SCHEMA_VERSION,
                reasonCode: candidate.reasonCode,
                operation: candidate.operation,
                destination: candidate.destination,
                oldIntentDisposition: 'never_resend',
                row: EXPECTED_MANUAL_RESOLUTION_POLICIES[
                    candidate.reasonCode
                ],
            });
            if (decision.allowed) {
                expect(decision.atomicCompanions).toContain(
                    candidate.expectedCompanion,
                );
            }
        },
    );

    it('never grants authority to generic resume', async () => {
        const context = runtimeContext({
            reasonCode: 'EXTERNAL_POSITION_DRIFT',
            resolutionCaseId: 'case-generic-resume',
        });
        expect(
            evaluateManualResolution({
                context,
                operation: 'generic_resume',
                evidenceSet: await completeEvidenceSet(context),
            }),
        ).toEqual({ allowed: false, reason: 'generic_resume_forbidden' });
    });

    it('requires a current case-bound complete evidence snapshot', async () => {
        const context = runtimeContext({
            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            resolutionCaseId: 'case-complete-evidence',
        });
        const complete = await completeEvidenceSet(context, true);
        const incomplete = await issueEvidenceSet({
            context,
            evidence: [complete.evidence[0]!],
        });
        expect(
            evaluateManualResolution({
                context,
                operation: 'apply_unique_final_evidence',
                evidenceSet: incomplete,
            }),
        ).toMatchObject({ allowed: false, reason: 'required_evidence_missing' });
        expect(
            evaluateManualResolution({
                context,
                operation: 'apply_unique_final_evidence',
                evidenceSet: { ...complete },
            }),
        ).toEqual({ allowed: false, reason: 'evidence_snapshot_untrusted' });

        runtimeContext({
            reasonCode: context.reasonCode,
            resolutionCaseId: context.resolutionCaseId,
            caseRevision: 2,
            nowEpochMs: 10_001,
        });
        expect(
            evaluateManualResolution({
                context,
                operation: 'apply_unique_final_evidence',
                evidenceSet: complete,
            }),
        ).toEqual({
            allowed: false,
            reason: 'resolution_context_untrusted_or_stale',
        });
    });

    it('accepts only canonical broker evidence as the unique final', async () => {
        const context = runtimeContext({
            reasonCode: 'ENTRY_RESULT_UNKNOWN',
            resolutionCaseId: 'case-final-evidence',
        });
        expect(() =>
            evidenceFor(
                context,
                'full_position_unit_reconciliation',
                'unique_broker_terminal',
            ),
        ).toThrow('canonical broker terminal evidence');

        const noFinal = await completeEvidenceSet(context, false);
        expect(
            evaluateManualResolution({
                context,
                operation: 'apply_unique_final_evidence',
                evidenceSet: noFinal,
            }),
        ).toEqual({ allowed: false, reason: 'unique_final_evidence_missing' });

        const decision = evaluateManualResolution({
            context,
            operation: 'apply_unique_final_evidence',
            evidenceSet: await completeEvidenceSet(context, true),
        });
        expect(decision).toMatchObject({
            allowed: true,
            operation: 'apply_unique_final_evidence',
            resolutionCaseId: context.resolutionCaseId,
            caseRevision: 1,
            targetSideEffectSha256: TARGET,
            oldIntentDisposition: 'never_resend',
            row: { rearmPolicy: 'never' },
        });
        expect(isVerifiedManualResolutionDecision(decision)).toBe(true);
        if (decision.allowed) {
            expect(decision.atomicCompanions).toContain(
                'reservation_claim_obligation_settlement',
            );
        }
        expect(isVerifiedManualResolutionDecision({ ...decision })).toBe(false);
        if (decision.allowed) {
            expect(consumeVerifiedManualResolutionDecision(decision)).toBe(true);
            expect(isVerifiedManualResolutionDecision(decision)).toBe(false);
            expect(consumeVerifiedManualResolutionDecision(decision)).toBe(false);
        }
    });

    it('does not treat accepted zero-deal evidence as filled final evidence', async () => {
        const context = runtimeContext({
            reasonCode: 'ENTRY_RESULT_UNKNOWN',
            resolutionCaseId: 'case-accepted-zero-deal',
        });
        const acceptedWithoutDeals = await completeEvidenceSet(context, false);
        expect(
            evaluateManualResolution({
                context,
                operation: 'apply_unique_final_evidence',
                evidenceSet: acceptedWithoutDeals,
                executionBoundary: {
                    kind: 'state_transition',
                    entityKind: 'activation',
                    entityId: 'activation-accepted-zero-deal',
                    lineageId: 'strategy/activation-accepted-zero-deal',
                    lineageGeneration: 0,
                    expectedRevision: 3,
                    effectProjectionSha256: EVIDENCE,
                    edgeId: 'ACT-015C',
                    fromState: 'unknown',
                    toState: 'filled',
                    transitionReasonCode: 'MANUAL_FINAL_EVIDENCE_APPLIED',
                },
            }),
        ).toEqual({ allowed: false, reason: 'unique_final_evidence_missing' });
    });

    it('binds fresh user confirmation to the current case and evidence snapshot', async () => {
        const context = runtimeContext({
            reasonCode: 'EXTERNAL_POSITION_DRIFT',
            resolutionCaseId: 'case-reconfirm',
        });
        const evidenceSet = await completeEvidenceSet(context);
        expect(
            evaluateManualResolution({
                context,
                operation: 'reconfirm_and_pause',
                evidenceSet,
            }),
        ).toEqual({ allowed: false, reason: 'authorization_untrusted' });
        const verifiedAuthorization = await authorization({
            kind: 'user_rearm',
            context,
            evidenceSet,
            noncePrefix: 'rearm',
        });
        const decision = evaluateManualResolution({
            context,
            operation: 'reconfirm_and_pause',
            evidenceSet,
            authorization: verifiedAuthorization,
        });
        expect(decision).toMatchObject({
            allowed: true,
            destination: 'paused',
            freshConfirmationSha256: FRESH_CONFIRMATION,
            row: { rearmPolicy: 'new_confirmation_and_user_arm' },
            atomicConsume: [{ nonce: 'rearm-nonce-1', revision: 1 }],
        });
        if (decision.allowed) {
            expect(decision.atomicCompanions).toEqual(
                expect.arrayContaining([
                    'resolution_case_terminal',
                    'fresh_confirmation_snapshot',
                    'reservation_claim_obligation_settlement',
                ]),
            );
        }
        expect(
            evaluateManualResolution({
                context,
                operation: 'reconfirm_and_pause',
                evidenceSet,
                authorization: verifiedAuthorization,
            }),
        ).toEqual({ allowed: false, reason: 'authorization_untrusted' });
    });

    it('requires two separately issued, later, independent break-glass confirmations', async () => {
        const contextOne = runtimeContext({
            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            resolutionCaseId: 'case-break-glass',
            nowEpochMs: 10_000,
        });
        const evidenceSet = await completeEvidenceSet(contextOne);
        const stepOne = await issueBreakGlassStepOne({
            context: contextOne,
            evidenceSet,
            step: {
                stepId: 'break-glass-step-1',
                confirmationLineageId: 'break-glass-lineage',
                nonce: 'break-glass-nonce-1',
                nonceRevision: 1,
                userConfirmationSha256: USER_CONFIRMATION_ONE,
            },
        });
        await expect(
            issueBreakGlassStepTwo({
                context: contextOne,
                evidenceSet,
                stepOne,
                step: {
                    stepId: 'break-glass-step-2-too-soon',
                    confirmationLineageId: 'break-glass-lineage',
                    nonce: 'break-glass-nonce-2',
                    nonceRevision: 2,
                    userConfirmationSha256: USER_CONFIRMATION_TWO,
                },
            }),
        ).rejects.toThrow('independently later');

        const contextTwo = runtimeContext({
            reasonCode: contextOne.reasonCode,
            resolutionCaseId: contextOne.resolutionCaseId,
            nowEpochMs: 10_001,
        });
        const stepTwo = await issueBreakGlassStepTwo({
            context: contextTwo,
            evidenceSet,
            stepOne,
            step: {
                stepId: 'break-glass-step-2',
                confirmationLineageId: 'break-glass-lineage',
                nonce: 'break-glass-nonce-2',
                nonceRevision: 2,
                userConfirmationSha256: USER_CONFIRMATION_TWO,
            },
        });
        const verifiedAuthorization = await issueBreakGlassAuthorization({
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
        });
        expect(decision).toMatchObject({
            allowed: true,
            destination: 'resolution_case_relinquished_unknown',
            atomicConsume: [
                { nonce: 'break-glass-nonce-1', revision: 1 },
                { nonce: 'break-glass-nonce-2', revision: 2 },
            ],
        });
        if (decision.allowed) {
            expect(decision.atomicCompanions).toEqual(
                expect.arrayContaining([
                    'resolution_case_terminal',
                    'reservation_claim_obligation_settlement',
                    'safety_blocker_open',
                    'relinquished_unknown_exposure_open',
                    'burned_authorization_nonce',
                    'break_glass_audit_snapshot',
                ]),
            );
        }
        expect(
            evaluateManualResolution({
                context: contextTwo,
                operation: 'break_glass_relinquish',
                evidenceSet,
                authorization: verifiedAuthorization,
            }),
        ).toEqual({ allowed: false, reason: 'authorization_untrusted' });
    });

    it('preserves existing broker obligations for quote-gap draft copying', async () => {
        const context = runtimeContext({
            reasonCode: 'QUOTE_GAP_CROSSING_UNKNOWN',
            resolutionCaseId: 'case-copy-draft',
        });
        const evidenceSet = await completeEvidenceSet(context);
        const verifiedAuthorization = await authorization({
            kind: 'lifecycle',
            context,
            evidenceSet,
            noncePrefix: 'copy-draft',
        });
        const decision = evaluateManualResolution({
            context,
            operation: 'copy_to_new_draft',
            evidenceSet,
            authorization: verifiedAuthorization,
        });
        expect(decision).toMatchObject({
            allowed: true,
            row: {
                rearmPolicy: 'new_arm_generation_after_fresh_false',
                obligationPolicy: 'preserve_existing_broker_obligations',
            },
        });
        if (decision.allowed) {
            expect(decision.atomicCompanions).toContain('copy_to_new_draft_created');
            expect(decision.atomicCompanions).not.toContain(
                'reservation_claim_obligation_settlement',
            );
            expect(decision.atomicCompanions).not.toContain('resolution_case_terminal');
        }
    });

    it('issues cancel, copy, observe-only, and remain-open only as exact service-bound plans', async () => {
        const cases = [
            {
                operation: 'cancel_strategy' as const,
                reasonCode: 'QUOTE_GAP_CROSSING_UNKNOWN' as const,
                sourceEntityKind: 'strategy' as const,
                authorizationKind: 'lifecycle' as const,
            },
            {
                operation: 'copy_to_new_draft' as const,
                reasonCode: 'QUOTE_GAP_CROSSING_UNKNOWN' as const,
                sourceEntityKind: 'strategy' as const,
                authorizationKind: 'lifecycle' as const,
            },
            {
                operation: 'repair_gate_observe_only' as const,
                reasonCode: 'DB_INTEGRITY_FAILED' as const,
                sourceEntityKind: 'runtime_epoch' as const,
                authorizationKind: 'lifecycle' as const,
            },
            {
                operation: 'remain_open' as const,
                reasonCode: 'BROKER_ACCOUNT_MISMATCH' as const,
                sourceEntityKind: 'resolution_case' as const,
            },
        ];
        for (const [index, candidate] of cases.entries()) {
            const context = runtimeContext({
                reasonCode: candidate.reasonCode,
                resolutionCaseId: `case-service-${index}`,
            });
            const evidenceSet = await completeEvidenceSet(context);
            const executionBoundary: ResolutionExecutionBoundary = {
                kind: 'resolution_service',
                operation: candidate.operation,
                resolutionCaseId: context.resolutionCaseId,
                caseRevision: context.caseRevision,
                sourceEntityKind: candidate.sourceEntityKind,
                sourceEntityId: `service-source-${index}`,
                sourceEntityExpectedRevision: 7,
                serviceRequestSha256: EVIDENCE,
            };
            const verifiedAuthorization = candidate.authorizationKind
                ? await authorization({
                      kind: candidate.authorizationKind,
                      context,
                      evidenceSet,
                      noncePrefix: `service-${index}`,
                  })
                : undefined;
            const wrongBoundary = {
                ...executionBoundary,
                sourceEntityKind: 'resolution_case' as const,
            };
            if (candidate.sourceEntityKind !== 'resolution_case') {
                expect(
                    evaluateManualResolutionDomain({
                        context,
                        operation: candidate.operation,
                        evidenceSet,
                        ...(verifiedAuthorization
                            ? { authorization: verifiedAuthorization }
                            : {}),
                        executionBoundary: wrongBoundary,
                    }),
                ).toEqual({
                    allowed: false,
                    reason: 'execution_boundary_mismatch',
                });
            }
            const decision = evaluateManualResolutionDomain({
                context,
                operation: candidate.operation,
                evidenceSet,
                ...(verifiedAuthorization
                    ? { authorization: verifiedAuthorization }
                    : {}),
                executionBoundary,
            });
            expect(decision).toMatchObject({
                allowed: true,
                operation: candidate.operation,
                executionBoundary,
            });
        }
    });

    it('mints canonical current decisions for non-manual opening reasons and prevents cross-outcome issuance', async () => {
        const context = runtimeContext({
            reasonCode: 'BROKER_STATE_UNKNOWN',
            resolutionCaseId: 'case-broker-current-projection',
        });
        const evidenceSet = await completeEvidenceSet(context, true);
        const currentBinding = {
            kind: 'state_transition' as const,
            entityKind: 'broker_order' as const,
            entityId: 'broker-order-current-1',
            lineageId: 'intent-1/broker-order-current-1',
            lineageGeneration: 0,
            expectedRevision: 4,
            effectProjectionSha256: EVIDENCE,
            edgeId: 'BRO-004E',
            fromState: 'unknown',
            toState: 'part_filled',
            transitionReasonCode: 'BROKER_RECONCILIATION_EVIDENCE_APPLIED',
        };
        const decision = evaluateBlockingStateResolution({
            context,
            operation: 'apply_canonical_projection_keep_blocked',
            evidenceSet,
            transitionBinding: currentBinding,
        });
        expect(decision).toMatchObject({
            allowed: true,
            reasonCode: 'BROKER_STATE_UNKNOWN',
            operation: 'apply_canonical_projection_keep_blocked',
            transitionBinding: currentBinding,
        });
        expect(isVerifiedBlockingStateResolutionDecision(decision)).toBe(true);
        expect(isVerifiedBlockingStateResolutionDecision({ ...decision })).toBe(
            false,
        );
        expect(
            evaluateBlockingStateResolution({
                context,
                operation: 'apply_unique_final_evidence',
                evidenceSet,
                transitionBinding: {
                    ...currentBinding,
                    edgeId: 'BRO-005E',
                    toState: 'filled',
                },
            }),
        ).toEqual({
            allowed: false,
            reason: 'decision_already_issued_for_target_revision',
        });
        if (decision.allowed) {
            expect(
                consumeVerifiedBlockingStateResolutionDecision(decision),
            ).toBe(true);
            expect(
                consumeVerifiedBlockingStateResolutionDecision(decision),
            ).toBe(false);
        }
    });

    it('distinguishes canonical-final, unique-final, resolve, and supersede blocker contracts', async () => {
        const cases = [
            {
                reasonCode: 'EXTERNAL_WORKING_SET_INCOMPLETE' as const,
                operation: 'apply_canonical_resolution_final' as const,
                withUniqueFinal: false,
                binding: {
                    entityKind: 'protection_obligation' as const,
                    entityId: 'obligation-final-1',
                    lineageId: 'strategy-1/obligation-final-1',
                    edgeId: 'POB-013A',
                    fromState: 'safety_blocked',
                    toState: 'pending_entry',
                    transitionReasonCode: 'MANUAL_FINAL_EVIDENCE_APPLIED',
                },
            },
            {
                reasonCode: 'BROKER_STATE_UNKNOWN' as const,
                operation: 'apply_unique_final_evidence' as const,
                withUniqueFinal: true,
                binding: {
                    entityKind: 'broker_order' as const,
                    entityId: 'broker-order-final-1',
                    lineageId: 'intent-2/broker-order-final-1',
                    edgeId: 'BRO-005E',
                    fromState: 'unknown',
                    toState: 'filled',
                    transitionReasonCode:
                        'BROKER_RECONCILIATION_EVIDENCE_APPLIED',
                },
            },
            {
                reasonCode: 'BROKER_OUTCOME_UNKNOWN' as const,
                operation: 'resolve_safety_blocker' as const,
                withUniqueFinal: true,
                extraEvidence: ['full_external_working_set'] as const,
                safety: {
                    blockerKind: 'unknown_broker_side_effect' as const,
                    resolutionPath:
                        'canonical_unique_final_current_exposure' as const,
                },
                binding: {
                    entityKind: 'safety_blocker' as const,
                    entityId: 'blocker-resolve-1',
                    lineageId: 'case-blocker-resolve/blocker-resolve-1',
                    edgeId: 'SB-002',
                    fromState: 'open',
                    toState: 'resolved',
                    transitionReasonCode: 'SAFETY_BLOCKER_RESOLVED',
                },
            },
            {
                reasonCode: 'POSITION_OR_UNIT_UNKNOWN' as const,
                operation: 'supersede_safety_blocker' as const,
                withUniqueFinal: false,
                extraEvidence: [
                    'canonical_safety_blocker_successor_binding',
                ] as const,
                safety: {
                    blockerKind: 'position_or_unit_conflict' as const,
                    resolutionPath: 'supersede_strict_scope' as const,
                },
                binding: {
                    entityKind: 'safety_blocker' as const,
                    entityId: 'blocker-supersede-1',
                    lineageId: 'case-blocker-supersede/blocker-supersede-1',
                    edgeId: 'SB-003',
                    fromState: 'open',
                    toState: 'superseded_by_stricter_blocker',
                    transitionReasonCode: 'SAFETY_BLOCKER_OPENED',
                },
            },
        ];
        for (const [index, candidate] of cases.entries()) {
            const context = runtimeContext({
                reasonCode: candidate.reasonCode,
                resolutionCaseId: `case-blocking-family-${index}`,
            });
            const safety =
                'safety' in candidate ? candidate.safety : undefined;
            const successor =
                candidate.operation === 'supersede_safety_blocker' && safety
                    ? await issueSafetyBlockerSuccessor({
                          blockerId: 'blocker-stricter-successor-domain',
                          blockerKind: safety.blockerKind,
                          resolutionCaseId: context.resolutionCaseId,
                          predecessorBlockerId:
                              candidate.binding.entityId,
                          predecessorLineageId:
                              candidate.binding.lineageId,
                          lineageId:
                              'case-blocker-supersede/blocker-stricter-successor-domain',
                          lineageGeneration: 1,
                          scope: {
                              scopeId: 'scope-1-stricter',
                              memberSha256: [
                                  SCOPE_MEMBER_A,
                                  SCOPE_MEMBER_B,
                              ],
                          },
                      })
                    : undefined;
            const evidenceSet = await completeEvidenceSet(
                context,
                candidate.withUniqueFinal,
                'extraEvidence' in candidate
                    ? candidate.extraEvidence
                    : [],
                successor
                    ? {
                          canonical_safety_blocker_successor_binding:
                              successor.bindingSha256,
                      }
                    : {},
            );
            const safetyResolution =
                safety
                    ? safetyBlockerBinding({
                          context,
                          blockerId: candidate.binding.entityId,
                          blockerKind: safety.blockerKind,
                          lineageId: candidate.binding.lineageId,
                          resolutionPath: safety.resolutionPath,
                          ...(([
                              'unknown_broker_side_effect',
                              'relinquished_unknown_exposure',
                          ] as readonly SafetyBlockerResolutionKind[]).includes(
                              safety.blockerKind,
                          )
                              ? {
                                    worstCasePositionDeltaShares: '100',
                                    possiblyWorkingShares: '100',
                                }
                              : {}),
                          ...(successor ? { successor } : {}),
                      })
                    : undefined;
            const decision = evaluateBlockingStateResolution({
                context,
                operation: candidate.operation,
                evidenceSet,
                transitionBinding: {
                    kind: 'state_transition',
                    lineageGeneration: 0,
                    expectedRevision: 2,
                    effectProjectionSha256: EVIDENCE,
                    ...candidate.binding,
                },
                ...(safetyResolution
                    ? {
                          safetyBlockerResolutionBinding:
                              safetyResolution,
                      }
                    : {}),
            });
            expect(decision).toMatchObject({
                allowed: true,
                operation: candidate.operation,
                reasonCode: candidate.reasonCode,
            });
        }
    });

    it('keeps DB and mode-generation blocker policies complete and reason-specific', () => {
        expect(
            getSafetyBlockerResolutionRequiredEvidence(
                'db_integrity_unverified',
                'blocker_kind_policy_evidence',
            ),
        ).toEqual(
            expect.arrayContaining([
                'verified_database_restore_integrity',
                'single_writer_fence_evidence',
                'broker_full_orders_trades_deals',
                'broker_position_and_working_set',
                'full_external_working_set',
            ]),
        );
        expect(
            getSafetyBlockerResolutionRequiredEvidence(
                'mode_generation_conflict',
                'blocker_kind_policy_evidence',
            ),
        ).toEqual(
            expect.arrayContaining([
                'new_runtime_epoch_reconciliation',
                'mode_generation_manifest_reconciliation',
                'single_writer_fence_evidence',
                'fixed_account_subscription',
                'broker_position_and_working_set',
            ]),
        );
        expect(
            isSafetyBlockerReasonAllowed(
                'mode_generation_conflict',
                'MODE_GENERATION_CHANGED',
            ),
        ).toBe(true);
        expect(
            isSafetyBlockerReasonAllowed(
                'mode_generation_conflict',
                'BROKER_STATE_UNKNOWN',
            ),
        ).toBe(false);
    });

    it('binds SB-002 unknown and relinquished exposure to kind-specific finality and current exposure evidence', async () => {
        const unknownContext = runtimeContext({
            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            resolutionCaseId: 'case-sb002-unknown-policy',
        });
        const allNotFinal = await completeEvidenceSet(
            unknownContext,
            false,
            ['full_external_working_set'],
        );
        const unknownBinding = safetyBlockerBinding({
            context: unknownContext,
            blockerId: 'blocker-sb002-unknown-policy',
            blockerKind: 'unknown_broker_side_effect',
            lineageId: 'case-sb002-unknown-policy/blocker',
            resolutionPath: 'canonical_unique_final_current_exposure',
            worstCasePositionDeltaShares: '100',
            possiblyWorkingShares: '100',
        });
        const transitionBinding = {
            kind: 'state_transition' as const,
            entityKind: 'safety_blocker' as const,
            entityId: unknownBinding.blockerId,
            lineageId: unknownBinding.lineageId,
            lineageGeneration: 0,
            expectedRevision: 2,
            effectProjectionSha256: EVIDENCE,
            edgeId: 'SB-002',
            fromState: 'open',
            toState: 'resolved',
            transitionReasonCode: 'SAFETY_BLOCKER_RESOLVED',
        };
        const unknownUniqueFinal = await completeEvidenceSet(
            unknownContext,
            true,
            getSafetyBlockerResolutionRequiredEvidence(
                'unknown_broker_side_effect',
                'canonical_unique_final_current_exposure',
            ),
        );
        for (const mismatchedTransition of [
            { ...transitionBinding, entityId: 'blocker-sb002-target-b' },
            {
                ...transitionBinding,
                lineageId: 'case-sb002-unknown-policy/lineage-b',
            },
            { ...transitionBinding, lineageGeneration: 1 },
        ]) {
            expect(
                evaluateBlockingStateResolution({
                    context: unknownContext,
                    operation: 'resolve_safety_blocker',
                    evidenceSet: unknownUniqueFinal,
                    transitionBinding: mismatchedTransition,
                    safetyBlockerResolutionBinding: unknownBinding,
                }),
            ).toEqual({
                allowed: false,
                reason: 'safety_blocker_policy_mismatch',
            });
        }
        const {
            worstCasePositionDeltaShares: _missingWorstCaseBound,
            ...missingWorstCaseBound
        } = unknownBinding;
        const {
            possiblyWorkingShares: _missingPossiblyWorkingBound,
            ...missingPossiblyWorkingBound
        } = unknownBinding;
        void _missingWorstCaseBound;
        void _missingPossiblyWorkingBound;
        for (const incompleteBinding of [
            missingWorstCaseBound,
            missingPossiblyWorkingBound,
        ]) {
            expect(
                evaluateBlockingStateResolution({
                    context: unknownContext,
                    operation: 'resolve_safety_blocker',
                    evidenceSet: unknownUniqueFinal,
                    transitionBinding,
                    safetyBlockerResolutionBinding: incompleteBinding,
                }),
            ).toEqual({
                allowed: false,
                reason: 'safety_blocker_policy_mismatch',
            });
        }
        expect(
            evaluateBlockingStateResolution({
                context: unknownContext,
                operation: 'resolve_safety_blocker',
                evidenceSet: allNotFinal,
                transitionBinding,
                safetyBlockerResolutionBinding: unknownBinding,
            }),
        ).toEqual({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });

        const relinquishedContext = runtimeContext({
            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            resolutionCaseId: 'case-sb002-relinquished-normal-policy',
        });
        const relinquishedBinding = safetyBlockerBinding({
            context: relinquishedContext,
            blockerId: 'blocker-sb002-relinquished-normal-policy',
            blockerKind: 'relinquished_unknown_exposure',
            lineageId:
                'case-sb002-relinquished-normal-policy/blocker',
            resolutionPath: 'canonical_unique_final_current_exposure',
            worstCasePositionDeltaShares: '100',
            possiblyWorkingShares: '100',
        });
        const relinquishedTransitionBinding = {
            ...transitionBinding,
            entityId: relinquishedBinding.blockerId,
            lineageId: relinquishedBinding.lineageId,
            transitionReasonCode:
                'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED',
        };
        const relinquishedAllNotFinal = await completeEvidenceSet(
            relinquishedContext,
            false,
            getSafetyBlockerResolutionRequiredEvidence(
                'relinquished_unknown_exposure',
                'canonical_unique_final_current_exposure',
            ),
        );
        expect(
            evaluateBlockingStateResolution({
                context: relinquishedContext,
                operation: 'resolve_safety_blocker',
                evidenceSet: relinquishedAllNotFinal,
                transitionBinding: relinquishedTransitionBinding,
                safetyBlockerResolutionBinding: relinquishedBinding,
            }),
        ).toEqual({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });

        const relinquishedUniqueFinal = await completeEvidenceSet(
            relinquishedContext,
            true,
            getSafetyBlockerResolutionRequiredEvidence(
                'relinquished_unknown_exposure',
                'canonical_unique_final_current_exposure',
            ),
        );
        const {
            worstCasePositionDeltaShares: _missingRelinquishedWorst,
            ...missingRelinquishedWorst
        } = relinquishedBinding;
        const {
            possiblyWorkingShares: _missingRelinquishedWorking,
            ...missingRelinquishedWorking
        } = relinquishedBinding;
        void _missingRelinquishedWorst;
        void _missingRelinquishedWorking;
        for (const incompleteBinding of [
            missingRelinquishedWorst,
            missingRelinquishedWorking,
        ]) {
            expect(
                evaluateBlockingStateResolution({
                    context: relinquishedContext,
                    operation: 'resolve_safety_blocker',
                    evidenceSet: relinquishedUniqueFinal,
                    transitionBinding: relinquishedTransitionBinding,
                    safetyBlockerResolutionBinding: incompleteBinding,
                }),
            ).toEqual({
                allowed: false,
                reason: 'safety_blocker_policy_mismatch',
            });
        }
        expect(
            evaluateBlockingStateResolution({
                context: relinquishedContext,
                operation: 'resolve_safety_blocker',
                evidenceSet: relinquishedUniqueFinal,
                transitionBinding: relinquishedTransitionBinding,
                safetyBlockerResolutionBinding: relinquishedBinding,
            }),
        ).toMatchObject({
            allowed: true,
            operation: 'resolve_safety_blocker',
            safetyBlockerResolutionBinding: {
                blockerKind: 'relinquished_unknown_exposure',
                resolutionPath:
                    'canonical_unique_final_current_exposure',
            },
        });

        const wrongReasonContext = runtimeContext({
            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            resolutionCaseId: 'case-sb002-wrong-kind-reason',
        });
        const wrongReasonEvidence = await completeEvidenceSet(
            wrongReasonContext,
            true,
            getSafetyBlockerResolutionRequiredEvidence(
                'position_or_unit_conflict',
                'blocker_kind_policy_evidence',
            ),
        );
        expect(
            evaluateBlockingStateResolution({
                context: wrongReasonContext,
                operation: 'resolve_safety_blocker',
                evidenceSet: wrongReasonEvidence,
                transitionBinding: {
                    ...transitionBinding,
                    entityId: 'blocker-wrong-kind-reason',
                    lineageId: 'case-sb002-wrong-kind-reason/blocker',
                },
                safetyBlockerResolutionBinding: safetyBlockerBinding({
                    context: wrongReasonContext,
                    blockerId: 'blocker-wrong-kind-reason',
                    blockerKind: 'position_or_unit_conflict',
                    lineageId: 'case-sb002-wrong-kind-reason/blocker',
                    resolutionPath: 'blocker_kind_policy_evidence',
                }),
            }),
        ).toEqual({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });

        const gateContext = runtimeContext({
            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            resolutionCaseId: 'case-sb002-gate-zero',
        });
        const gateEvidenceSet = await completeEvidenceSet(gateContext, false, [
            ...getSafetyBlockerResolutionRequiredEvidence(
                'relinquished_unknown_exposure',
                'gate_approved_zero_exposure_bounds',
            ),
        ]);
        const gateEvidence = gateEvidenceSet.evidence.find(
            (item) =>
                item.evidenceClass ===
                'gate_approved_zero_exposure_bounds',
        );
        if (!gateEvidence) throw new Error('missing Gate zero-bounds evidence');
        const gateBlocker = safetyBlockerBinding({
            context: gateContext,
            blockerId: 'blocker-sb002-gate-zero',
            blockerKind: 'relinquished_unknown_exposure',
            lineageId: 'case-sb002-gate-zero/blocker',
            resolutionPath: 'gate_approved_zero_exposure_bounds',
            worstCasePositionDeltaShares: '0',
            possiblyWorkingShares: '0',
            gateApprovedZeroBoundsEvidenceSha256:
                gateEvidence.evidenceSha256,
        });
        expect(
            evaluateBlockingStateResolution({
                context: gateContext,
                operation: 'resolve_safety_blocker',
                evidenceSet: gateEvidenceSet,
                transitionBinding: {
                    ...transitionBinding,
                    entityId: gateBlocker.blockerId,
                    lineageId: gateBlocker.lineageId,
                    transitionReasonCode:
                        'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED',
                },
                safetyBlockerResolutionBinding: {
                    ...gateBlocker,
                    possiblyWorkingShares: '1',
                },
            }),
        ).toEqual({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });
        expect(
            evaluateBlockingStateResolution({
                context: gateContext,
                operation: 'resolve_safety_blocker',
                evidenceSet: gateEvidenceSet,
                transitionBinding: {
                    ...transitionBinding,
                    entityId: gateBlocker.blockerId,
                    lineageId: gateBlocker.lineageId,
                    transitionReasonCode:
                        'RELINQUISHED_UNKNOWN_EXPOSURE_RESOLVED',
                },
                safetyBlockerResolutionBinding: gateBlocker,
            }),
        ).toMatchObject({
            allowed: true,
            operation: 'resolve_safety_blocker',
            safetyBlockerResolutionBinding: {
                blockerKind: 'relinquished_unknown_exposure',
                resolutionPath: 'gate_approved_zero_exposure_bounds',
                gateApprovedZeroBoundsEvidenceSha256:
                    gateEvidence.evidenceSha256,
            },
        });
    });

    it('requires SB-003 successor scope to be a strict superset with connected lineage', async () => {
        const context = runtimeContext({
            reasonCode: 'POSITION_OR_UNIT_UNKNOWN',
            resolutionCaseId: 'case-sb003-strict-scope',
        });
        const transitionBinding = {
            kind: 'state_transition' as const,
            entityKind: 'safety_blocker' as const,
            entityId: 'blocker-sb003-predecessor',
            lineageId: 'case-sb003-strict-scope/predecessor',
            lineageGeneration: 0,
            expectedRevision: 2,
            effectProjectionSha256: EVIDENCE,
            edgeId: 'SB-003',
            fromState: 'open',
            toState: 'superseded_by_stricter_blocker',
            transitionReasonCode: 'SAFETY_BLOCKER_OPENED',
        };
        const validSuccessor = await issueSafetyBlockerSuccessor({
            blockerId: 'blocker-sb003-successor',
            blockerKind: 'position_or_unit_conflict' as const,
            resolutionCaseId: context.resolutionCaseId,
            predecessorBlockerId: transitionBinding.entityId,
            predecessorLineageId: transitionBinding.lineageId,
            lineageId: 'case-sb003-strict-scope/successor',
            lineageGeneration: 1,
            scope: {
                scopeId: 'scope-1-stricter',
                memberSha256: [SCOPE_MEMBER_A, SCOPE_MEMBER_B],
            },
        });
        const evidenceSet = await completeEvidenceSet(
            context,
            false,
            getSafetyBlockerResolutionRequiredEvidence(
                'position_or_unit_conflict',
                'supersede_strict_scope',
            ),
            {
                canonical_safety_blocker_successor_binding:
                    validSuccessor.bindingSha256,
            },
        );
        const base = safetyBlockerBinding({
            context,
            blockerId: transitionBinding.entityId,
            blockerKind: 'position_or_unit_conflict',
            lineageId: transitionBinding.lineageId,
            resolutionPath: 'supersede_strict_scope',
            successor: validSuccessor,
        });
        for (const mismatchedTransition of [
            { ...transitionBinding, entityId: 'blocker-sb003-target-b' },
            {
                ...transitionBinding,
                lineageId: 'case-sb003-strict-scope/lineage-b',
            },
            { ...transitionBinding, lineageGeneration: 1 },
        ]) {
            expect(
                evaluateBlockingStateResolution({
                    context,
                    operation: 'supersede_safety_blocker',
                    evidenceSet,
                    transitionBinding: mismatchedTransition,
                    safetyBlockerResolutionBinding: base,
                }),
            ).toEqual({
                allowed: false,
                reason: 'safety_blocker_policy_mismatch',
            });
        }
        for (const scope of [
            {
                scopeId: 'scope-1',
                memberSha256: [SCOPE_MEMBER_A, SCOPE_MEMBER_B],
            },
            {
                scopeId: 'scope-equal-members',
                memberSha256: [SCOPE_MEMBER_A],
            },
            {
                scopeId: 'scope-disjoint',
                memberSha256: [SCOPE_MEMBER_B],
            },
        ]) {
            const successor = await issueSafetyBlockerSuccessor({
                blockerId: validSuccessor.blockerId,
                blockerKind: validSuccessor.blockerKind,
                resolutionCaseId: validSuccessor.resolutionCaseId,
                predecessorBlockerId:
                    validSuccessor.predecessorBlockerId,
                predecessorLineageId:
                    validSuccessor.predecessorLineageId,
                lineageId: validSuccessor.lineageId,
                lineageGeneration: validSuccessor.lineageGeneration,
                scope,
            });
            expect(
                evaluateBlockingStateResolution({
                    context,
                    operation: 'supersede_safety_blocker',
                    evidenceSet,
                    transitionBinding,
                    safetyBlockerResolutionBinding: {
                        ...base,
                        successor,
                    },
                }),
            ).toEqual({
                allowed: false,
                reason: 'successor_scope_not_strict_superset',
            });
        }
        expect(
            evaluateBlockingStateResolution({
                context,
                operation: 'supersede_safety_blocker',
                evidenceSet,
                transitionBinding,
                safetyBlockerResolutionBinding: {
                    ...base,
                    successor: {
                        ...validSuccessor,
                        blockerId: 'same-hash-different-successor',
                    },
                },
            }),
        ).toEqual({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });
        const unrelatedSuccessor = await issueSafetyBlockerSuccessor({
            blockerId: validSuccessor.blockerId,
            blockerKind: validSuccessor.blockerKind,
            resolutionCaseId: validSuccessor.resolutionCaseId,
            predecessorBlockerId: 'unrelated-blocker',
            predecessorLineageId:
                validSuccessor.predecessorLineageId,
            lineageId: validSuccessor.lineageId,
            lineageGeneration: validSuccessor.lineageGeneration,
            scope: validSuccessor.scope,
        });
        expect(
            evaluateBlockingStateResolution({
                context,
                operation: 'supersede_safety_blocker',
                evidenceSet,
                transitionBinding,
                safetyBlockerResolutionBinding: {
                    ...base,
                    successor: unrelatedSuccessor,
                },
            }),
        ).toEqual({
            allowed: false,
            reason: 'safety_blocker_policy_mismatch',
        });
        expect(
            evaluateBlockingStateResolution({
                context,
                operation: 'supersede_safety_blocker',
                evidenceSet,
                transitionBinding,
                safetyBlockerResolutionBinding: base,
            }),
        ).toMatchObject({
            allowed: true,
            operation: 'supersede_safety_blocker',
            safetyBlockerResolutionBinding: {
                resolutionPath: 'supersede_strict_scope',
                successor: {
                    blockerId: validSuccessor.blockerId,
                    predecessorBlockerId: transitionBinding.entityId,
                    scope: {
                        memberSha256: [SCOPE_MEMBER_A, SCOPE_MEMBER_B],
                    },
                },
            },
        });
    });

    it('requires unknown-exposure SB-003 successors to preserve or increase both effect bounds', async () => {
        for (const [index, blockerKind] of (
            [
                'unknown_broker_side_effect',
                'relinquished_unknown_exposure',
            ] as const
        ).entries()) {
            const context = runtimeContext({
                reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                resolutionCaseId: `case-sb003-successor-bounds-${index}`,
            });
            const blockerId = `blocker-sb003-successor-bounds-${index}`;
            const lineageId = `${context.resolutionCaseId}/predecessor`;
            const transitionBinding = {
                kind: 'state_transition' as const,
                entityKind: 'safety_blocker' as const,
                entityId: blockerId,
                lineageId,
                lineageGeneration: 0,
                expectedRevision: 2,
                effectProjectionSha256: EVIDENCE,
                edgeId: 'SB-003',
                fromState: 'open',
                toState: 'superseded_by_stricter_blocker',
                transitionReasonCode: 'SAFETY_BLOCKER_OPENED',
            };
            const successorInput = {
                blockerId: `${blockerId}-successor`,
                blockerKind,
                resolutionCaseId: context.resolutionCaseId,
                predecessorBlockerId: blockerId,
                predecessorLineageId: lineageId,
                lineageId: `${context.resolutionCaseId}/successor`,
                lineageGeneration: 1,
                scope: {
                    scopeId: `scope-bounds-${index}-stricter`,
                    memberSha256: [SCOPE_MEMBER_A, SCOPE_MEMBER_B],
                },
            } as const;
            const validSuccessor =
                await issueSafetyBlockerSuccessor({
                    ...successorInput,
                    worstCasePositionDeltaShares: '100',
                    possiblyWorkingShares: '80',
                });
            const evidenceSet = await completeEvidenceSet(
                context,
                false,
                getSafetyBlockerResolutionRequiredEvidence(
                    blockerKind,
                    'supersede_strict_scope',
                ),
                {
                    canonical_safety_blocker_successor_binding:
                        validSuccessor.bindingSha256,
                },
            );
            const base = safetyBlockerBinding({
                context,
                blockerId,
                blockerKind,
                lineageId,
                resolutionPath: 'supersede_strict_scope',
                worstCasePositionDeltaShares: '100',
                possiblyWorkingShares: '80',
                successor: validSuccessor,
            });
            const invalidSuccessors = await Promise.all([
                issueSafetyBlockerSuccessor({
                    ...successorInput,
                    possiblyWorkingShares: '80',
                }),
                issueSafetyBlockerSuccessor({
                    ...successorInput,
                    worstCasePositionDeltaShares: '100',
                }),
                issueSafetyBlockerSuccessor({
                    ...successorInput,
                    worstCasePositionDeltaShares: '99',
                    possiblyWorkingShares: '80',
                }),
                issueSafetyBlockerSuccessor({
                    ...successorInput,
                    worstCasePositionDeltaShares: '100',
                    possiblyWorkingShares: '79',
                }),
            ]);
            for (const successor of invalidSuccessors) {
                const matchingEvidenceSet = await completeEvidenceSet(
                    context,
                    false,
                    getSafetyBlockerResolutionRequiredEvidence(
                        blockerKind,
                        'supersede_strict_scope',
                    ),
                    {
                        canonical_safety_blocker_successor_binding:
                            successor.bindingSha256,
                    },
                );
                expect(
                    evaluateBlockingStateResolution({
                        context,
                        operation: 'supersede_safety_blocker',
                        evidenceSet: matchingEvidenceSet,
                        transitionBinding,
                        safetyBlockerResolutionBinding: {
                            ...base,
                            successor,
                        },
                    }),
                ).toEqual({
                    allowed: false,
                    reason: 'safety_blocker_policy_mismatch',
                });
            }
            expect(
                evaluateBlockingStateResolution({
                    context,
                    operation: 'supersede_safety_blocker',
                    evidenceSet,
                    transitionBinding,
                    safetyBlockerResolutionBinding: base,
                }),
            ).toMatchObject({
                allowed: true,
                operation: 'supersede_safety_blocker',
                safetyBlockerResolutionBinding: {
                    successor: {
                        worstCasePositionDeltaShares: '100',
                        possiblyWorkingShares: '80',
                    },
                },
            });
        }
    });

    it('fails closed for malformed or operation-mismatched transition boundaries', async () => {
        const context = runtimeContext({
            reasonCode: 'BROKER_STATE_UNKNOWN',
            resolutionCaseId: 'case-binding-mismatch',
        });
        const evidenceSet = await completeEvidenceSet(context, true);
        const binding = {
            kind: 'state_transition' as const,
            entityKind: 'broker_order' as const,
            entityId: 'broker-binding-mismatch',
            lineageId: 'intent-binding/broker-binding-mismatch',
            lineageGeneration: 0,
            expectedRevision: 1,
            effectProjectionSha256: EVIDENCE,
            edgeId: 'BRO-005E',
            fromState: 'unknown',
            toState: 'filled',
            transitionReasonCode: 'BROKER_RECONCILIATION_EVIDENCE_APPLIED',
        };
        expect(
            evaluateBlockingStateResolution({
                context,
                operation: 'apply_canonical_projection_keep_blocked',
                evidenceSet,
                transitionBinding: binding,
            }),
        ).toEqual({ allowed: false, reason: 'execution_boundary_mismatch' });
        expect(
            evaluateBlockingStateResolution({
                context,
                operation: 'apply_unique_final_evidence',
                evidenceSet,
                transitionBinding: {
                    ...binding,
                    expectedRevision: undefined,
                } as never,
            }),
        ).toEqual({ allowed: false, reason: 'execution_boundary_mismatch' });
    });
});
