export const SMART_ORDER_MANUAL_RESOLUTION_POLICY_SCHEMA_VERSION =
    'smart-order-manual-resolution/2026-08-11.6';

const rows = [
    ['BROKER_OUTCOME_UNKNOWN', ['broker_full_orders_trades_deals', 'broker_position_and_working_set', 'canonical_broker_correlation'], ['apply_unique_final_evidence', 'break_glass_relinquish', 'remain_open'], true],
    ['BROKER_CORRELATION_AMBIGUOUS', ['broker_full_orders_trades_deals', 'broker_position_and_working_set', 'canonical_broker_correlation'], ['apply_unique_final_evidence', 'break_glass_relinquish', 'remain_open'], true],
    ['BROKER_ACCOUNT_MISMATCH', ['fixed_account_subscription', 'broker_full_orders_trades_deals', 'canonical_broker_correlation'], ['apply_unique_final_evidence', 'remain_open'], false],
    ['BROKER_FINAL_EVIDENCE_CONFLICT', ['immutable_evidence_hashes', 'broker_full_orders_trades_deals', 'broker_position_and_working_set'], ['apply_unique_final_evidence', 'remain_open'], false],
    ['ACTIVATION_ID_CONFLICT', ['immutable_evidence_hashes', 'activation_key_and_unique_index_audit', 'canonical_broker_correlation', 'broker_position_and_working_set'], ['apply_unique_final_evidence', 'remain_open'], false],
    ['ENTRY_RESULT_UNKNOWN', ['broker_full_orders_trades_deals', 'broker_position_and_working_set', 'canonical_broker_correlation', 'entry_cumulative_fill_projection'], ['apply_unique_final_evidence', 'break_glass_relinquish', 'remain_open'], true],
    ['EXIT_CLAIM_UNKNOWN', ['broker_full_orders_trades_deals', 'broker_position_and_working_set', 'canonical_broker_correlation', 'exit_claim_remainder_projection'], ['apply_unique_final_evidence', 'break_glass_relinquish', 'remain_open'], true],
    ['EXTERNAL_POSITION_DRIFT', ['full_position_unit_reconciliation', 'full_external_working_set', 'fresh_confirmation_snapshot'], ['reconfirm_and_pause', 'cancel_strategy', 'copy_to_new_draft', 'remain_open'], false],
    ['QUOTE_GAP_CROSSING_UNKNOWN', ['eligible_observation_gap_evidence'], ['reconfirm_and_pause', 'cancel_strategy', 'copy_to_new_draft', 'remain_open'], false],
    ['TRAILING_GAP_EXTREME_UNKNOWN', ['eligible_observation_gap_evidence', 'broker_position_and_working_set'], ['cancel_strategy', 'copy_to_new_draft', 'break_glass_relinquish', 'remain_open'], true],
    ['POSITION_OR_UNIT_UNKNOWN', ['full_position_unit_reconciliation', 'broker_position_and_working_set', 'new_runtime_epoch_reconciliation'], ['repair_gate_observe_only', 'remain_open'], false],
    ['PROTECTION_UNPROTECTED_REMAINDER', ['current_protection_remainder_snapshot', 'full_position_unit_reconciliation', 'full_external_working_set'], ['reconfirm_and_pause', 'break_glass_relinquish', 'remain_open'], true],
    ['DB_INTEGRITY_FAILED', ['verified_database_restore_integrity', 'single_writer_fence_evidence', 'broker_full_orders_trades_deals', 'broker_position_and_working_set'], ['repair_gate_observe_only', 'remain_open'], false],
    ['IDENTITY_MAPPING_CONFLICT', ['identity_mapping_and_key_audit', 'broker_position_and_working_set'], ['repair_gate_observe_only', 'remain_open'], false],
];

export const SMART_ORDER_MANUAL_RESOLUTION_POLICY = Object.freeze(
    rows.map(([reasonCode, requiredEvidence, allowedOperations, breakGlassAllowed]) =>
        Object.freeze({
            reasonCode,
            requiredEvidence: Object.freeze(requiredEvidence),
            allowedOperations: Object.freeze(allowedOperations),
            breakGlassAllowed,
            oldIntentDisposition: 'never_resend',
        }),
    ),
);

const rowsByReason = new Map(
    SMART_ORDER_MANUAL_RESOLUTION_POLICY.map((row) => [row.reasonCode, row]),
);

export function smartOrderManualResolutionPolicyRow(reasonCode) {
    return rowsByReason.get(reasonCode);
}
