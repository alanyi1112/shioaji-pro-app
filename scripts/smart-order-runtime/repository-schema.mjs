export const SMART_ORDER_REPOSITORY_SCHEMA_VERSION = 22;
export const SMART_ORDER_REPOSITORY_SCHEMA_ID =
    'smart-order-sqlite/2026-08-21.22';

export const SMART_ORDER_STRATEGY_STATES = Object.freeze([
    'draft',
    'observing',
    'monitoring',
    'paused',
    'recovery',
    'manual_intervention',
    'cancel_pending',
    'expired_with_obligation',
    'completed',
    'cancelled',
    'expired',
]);

const SMART_ORDER_STRATEGY_STATE_SQL =
    SMART_ORDER_STRATEGY_STATES.map((state) => `'${state}'`).join(', ');

export const SMART_ORDER_JOURNAL_ENTITY_KINDS = Object.freeze([
    'strategy',
    'activation',
    'order_intent',
    'broker_order',
    'broker_event',
    'broker_correlation',
    'pending_protection_commitment',
    'protection_obligation',
    'entry_exposure_reservation',
    'protected_entry_fill',
    'exit_claim',
    'protection_group',
    'protection_remainder_generation',
    'protection_leg_evaluation',
    'observation',
    'resolution_case',
    'safety_blocker',
    'runtime_epoch',
    'gate_manifest',
    'authority_consumption',
    'request_replay',
    'risk_policy',
    'canonical_confirmation',
]);

const SMART_ORDER_JOURNAL_ENTITY_KIND_SQL =
    SMART_ORDER_JOURNAL_ENTITY_KINDS.map((kind) => `'${kind}'`).join(', ');

export const SMART_ORDER_SCHEMA_SQL = String.raw`
CREATE TABLE IF NOT EXISTS repository_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS runtime_epochs (
    runtime_epoch_id TEXT PRIMARY KEY NOT NULL,
    api_generation TEXT NOT NULL,
    sender_fence TEXT NOT NULL,
    lease_evidence_hash TEXT NOT NULL,
    reconciliation_evidence_hash TEXT,
    state TEXT NOT NULL CHECK (state IN (
        'starting', 'observe_only', 'reconciling', 'ready', 'quiescing',
        'stopped', 'forced_stopped'
    )),
    started_at_epoch_ms INTEGER NOT NULL,
    stopped_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS strategies (
    strategy_id TEXT PRIMARY KEY NOT NULL,
    strategy_kind TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (${SMART_ORDER_STRATEGY_STATE_SQL})),
    definition_hash TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    confirmation_snapshot_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS activations (
    activation_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    logical_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'candidate', 'triggered', 'prepared', 'dispatching', 'working',
        'part_filled', 'filled', 'cancelled', 'failed', 'missed', 'unknown'
    )),
    generation INTEGER NOT NULL CHECK (generation >= 0),
    evidence_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE(strategy_id, logical_key, generation)
) STRICT;

CREATE TABLE IF NOT EXISTS order_intents (
    intent_id TEXT PRIMARY KEY NOT NULL,
    activation_id TEXT REFERENCES activations(activation_id),
    strategy_id TEXT REFERENCES strategies(strategy_id),
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('place', 'update', 'cancel')),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN (
        'activation', 'manual_request', 'gate_probe', 'lifecycle'
    )),
    state TEXT NOT NULL CHECK (state IN (
        'prepared', 'dispatching', 'acknowledged', 'reconciling',
        'unknown', 'terminal', 'cancelled_proven_unsent'
    )),
    terminal_outcome TEXT,
    payload_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
    target_broker_order_id TEXT,
    target_control_revision INTEGER,
    runtime_epoch_id TEXT REFERENCES runtime_epochs(runtime_epoch_id),
    dispatch_attempt_nonce TEXT,
    sender_fence TEXT,
    api_generation TEXT,
    mode_revision TEXT,
    risk_revision TEXT,
    account_revision TEXT,
    target_revision TEXT,
    adapter_authority_granted INTEGER NOT NULL DEFAULT 0
        CHECK (adapter_authority_granted IN (0, 1)),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE(owner_kind, client_request_id, payload_hash)
) STRICT;

CREATE TABLE IF NOT EXISTS broker_orders (
    broker_order_id TEXT PRIMARY KEY NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    state TEXT NOT NULL CHECK (state IN (
        'pending_submit', 'pre_submitted', 'submitted', 'part_filled',
        'filled', 'cancelled', 'failed', 'inactive', 'unknown'
    )),
    control_revision INTEGER NOT NULL CHECK (control_revision >= 0),
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares >= 0),
    filled_shares INTEGER NOT NULL CHECK (filled_shares >= 0),
    remaining_shares INTEGER NOT NULL CHECK (remaining_shares >= 0),
    evidence_hash TEXT NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS broker_correlations (
    correlation_id TEXT PRIMARY KEY NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    broker_order_id TEXT REFERENCES broker_orders(broker_order_id),
    canonical_key_hash TEXT NOT NULL UNIQUE,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
    trade_id TEXT,
    order_id TEXT,
    deal_id TEXT,
    seqno TEXT,
    ordno TEXT,
    exchange_sequence TEXT,
    custom_field TEXT,
    evidence_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS broker_correlation_identifiers (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
    identifier_kind TEXT NOT NULL CHECK (identifier_kind IN (
        'tradeId', 'orderId', 'dealId', 'seqno', 'ordno', 'exchangeSequence'
    )),
    identifier_value TEXT NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    correlation_id TEXT NOT NULL REFERENCES broker_correlations(correlation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    PRIMARY KEY(
        account_broker_ref, account_id_ref, trade_date, contract_key, side,
        identifier_kind, identifier_value
    )
) STRICT;

CREATE TABLE IF NOT EXISTS broker_event_records (
    broker_event_key_hash TEXT PRIMARY KEY NOT NULL,
    broker_order_correlation_key_hash TEXT NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    mapping_revision TEXT NOT NULL,
    api_generation TEXT NOT NULL,
    event_kind TEXT NOT NULL CHECK (event_kind IN ('order', 'deal')),
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
    trade_id TEXT NOT NULL,
    order_id TEXT,
    deal_id TEXT,
    seqno TEXT NOT NULL,
    ordno TEXT NOT NULL,
    exchange_sequence TEXT,
    custom_field TEXT,
    operation_type TEXT,
    operation_code TEXT,
    operation_message TEXT,
    status TEXT NOT NULL,
    order_condition TEXT NOT NULL,
    order_lot TEXT NOT NULL,
    price_type TEXT NOT NULL,
    time_in_force TEXT NOT NULL,
    order_quantity INTEGER NOT NULL CHECK (order_quantity > 0),
    cumulative_deal_quantity INTEGER NOT NULL CHECK (cumulative_deal_quantity >= 0),
    cumulative_cancel_quantity INTEGER NOT NULL CHECK (cumulative_cancel_quantity >= 0),
    remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
    event_deal_quantity INTEGER NOT NULL CHECK (event_deal_quantity >= 0),
    quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('Share', 'CommonLot')),
    price_decimal TEXT,
    exchange_epoch_ms INTEGER NOT NULL CHECK (exchange_epoch_ms >= 0),
    broker_epoch_ms INTEGER CHECK (broker_epoch_ms >= 0),
    receive_epoch_ms INTEGER NOT NULL CHECK (receive_epoch_ms >= 0),
    evidence_hash TEXT NOT NULL,
    payload_hash TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS broker_event_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    broker_order_correlation_key_hash TEXT NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    status TEXT NOT NULL,
    order_quantity INTEGER NOT NULL CHECK (order_quantity > 0),
    cumulative_deal_quantity INTEGER NOT NULL CHECK (cumulative_deal_quantity >= 0),
    cumulative_cancel_quantity INTEGER NOT NULL CHECK (cumulative_cancel_quantity >= 0),
    remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
    quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('Share', 'CommonLot')),
    exchange_epoch_ms INTEGER NOT NULL CHECK (exchange_epoch_ms >= 0),
    broker_event_key_hash TEXT NOT NULL REFERENCES broker_event_records(broker_event_key_hash),
    evidence_hash TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(
        account_broker_ref, account_id_ref, trade_date,
        broker_order_correlation_key_hash
    )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_broker_event_records_intent
    ON broker_event_records(intent_id, event_kind, exchange_epoch_ms);
CREATE INDEX IF NOT EXISTS idx_broker_event_records_deal
    ON broker_event_records(
        account_broker_ref, account_id_ref, trade_date, deal_id
    ) WHERE deal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS intent_rearm_authorizations (
    rearm_authorization_id TEXT PRIMARY KEY NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    sender_fence TEXT NOT NULL,
    api_generation TEXT NOT NULL,
    rearm_request_id TEXT NOT NULL UNIQUE,
    authorized_intent_revision INTEGER NOT NULL
        CHECK (authorized_intent_revision >= 1),
    confirmation_snapshot_hash TEXT NOT NULL,
    risk_revision TEXT NOT NULL,
    reconciliation_evidence_hash TEXT NOT NULL,
    user_rearm_evidence_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'consumed', 'superseded')),
    authorized_at_epoch_ms INTEGER NOT NULL,
    consumed_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE(intent_id, runtime_epoch_id)
) STRICT;

CREATE TABLE IF NOT EXISTS pending_protection_commitments (
    commitment_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    entry_intent_id TEXT REFERENCES order_intents(intent_id),
    state TEXT NOT NULL,
    committed_shares INTEGER NOT NULL CHECK (committed_shares >= 0),
    materialized_shares INTEGER NOT NULL CHECK (materialized_shares >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS protection_obligations (
    obligation_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    commitment_id TEXT REFERENCES pending_protection_commitments(commitment_id),
    state TEXT NOT NULL,
    position_lineage_id TEXT NOT NULL,
    filled_shares INTEGER NOT NULL CHECK (filled_shares >= 0),
    confirmed_exited_shares INTEGER NOT NULL CHECK (confirmed_exited_shares >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS entry_exposure_reservations (
    reservation_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    intent_id TEXT REFERENCES order_intents(intent_id),
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'reserved', 'partially_consumed', 'unknown', 'consumed', 'released'
    )),
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares >= 0),
    notional_minor_units INTEGER NOT NULL CHECK (notional_minor_units >= 0),
    cash_minor_units INTEGER NOT NULL CHECK (cash_minor_units >= 0),
    position_shares INTEGER NOT NULL CHECK (position_shares >= 0),
    order_count INTEGER NOT NULL CHECK (order_count >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS exposure_identity_arbiter_heads (
    identity_group_id TEXT PRIMARY KEY NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    observed_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    reserved_dimensions_json TEXT NOT NULL,
    baseline_quantity_shares INTEGER NOT NULL CHECK (baseline_quantity_shares >= 0),
    baseline_notional_minor_units INTEGER NOT NULL CHECK (baseline_notional_minor_units >= 0),
    baseline_cash_minor_units INTEGER NOT NULL CHECK (baseline_cash_minor_units >= 0),
    baseline_position_shares INTEGER NOT NULL CHECK (baseline_position_shares >= 0),
    baseline_order_count INTEGER NOT NULL CHECK (baseline_order_count >= 0),
    limit_quantity_shares INTEGER CHECK (limit_quantity_shares >= 0),
    limit_notional_minor_units INTEGER CHECK (limit_notional_minor_units >= 0),
    limit_cash_minor_units INTEGER CHECK (limit_cash_minor_units >= 0),
    limit_position_shares INTEGER CHECK (limit_position_shares >= 0),
    limit_order_count INTEGER CHECK (limit_order_count >= 0),
    daily_loss_limit_minor_units INTEGER NOT NULL
        CHECK (daily_loss_limit_minor_units >= 0),
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (valid_until_epoch_ms > observed_at_epoch_ms)
) STRICT;

CREATE TABLE IF NOT EXISTS exposure_account_arbiter_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL
        REFERENCES exposure_identity_arbiter_heads(identity_group_id),
    policy_revision TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    observed_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    reserved_dimensions_json TEXT NOT NULL,
    baseline_quantity_shares INTEGER NOT NULL CHECK (baseline_quantity_shares >= 0),
    baseline_notional_minor_units INTEGER NOT NULL CHECK (baseline_notional_minor_units >= 0),
    baseline_cash_minor_units INTEGER NOT NULL CHECK (baseline_cash_minor_units >= 0),
    baseline_position_shares INTEGER NOT NULL CHECK (baseline_position_shares >= 0),
    baseline_order_count INTEGER NOT NULL CHECK (baseline_order_count >= 0),
    limit_quantity_shares INTEGER CHECK (limit_quantity_shares >= 0),
    limit_notional_minor_units INTEGER CHECK (limit_notional_minor_units >= 0),
    limit_cash_minor_units INTEGER CHECK (limit_cash_minor_units >= 0),
    limit_position_shares INTEGER CHECK (limit_position_shares >= 0),
    limit_order_count INTEGER CHECK (limit_order_count >= 0),
    daily_loss_limit_minor_units INTEGER NOT NULL
        CHECK (daily_loss_limit_minor_units >= 0),
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref),
    CHECK (valid_until_epoch_ms > observed_at_epoch_ms)
) STRICT;

CREATE TABLE IF NOT EXISTS runtime_risk_policies (
    singleton_id TEXT PRIMARY KEY NOT NULL CHECK (singleton_id='current'),
    policy_revision TEXT NOT NULL UNIQUE,
    policy_hash TEXT NOT NULL,
    execution_policy_hash TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    api_generation TEXT NOT NULL,
    published_at_epoch_ms INTEGER NOT NULL CHECK (published_at_epoch_ms >= 0),
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS external_sell_visibility_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    position_revision TEXT NOT NULL,
    position_shares INTEGER NOT NULL CHECK (position_shares >= 0),
    working_set_hash TEXT NOT NULL,
    collection_complete INTEGER NOT NULL CHECK (collection_complete=1),
    observed_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date, contract_key),
    CHECK (valid_until_epoch_ms > observed_at_epoch_ms)
) STRICT;

CREATE TABLE IF NOT EXISTS exit_claims (
    exit_claim_id TEXT PRIMARY KEY NOT NULL,
    obligation_id TEXT REFERENCES protection_obligations(obligation_id),
    intent_id TEXT REFERENCES order_intents(intent_id),
    external_lineage INTEGER NOT NULL CHECK (external_lineage IN (0, 1)),
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    position_lineage_id TEXT NOT NULL,
    remainder_generation INTEGER NOT NULL CHECK (remainder_generation >= 0),
    allocation_start_share INTEGER NOT NULL CHECK (allocation_start_share >= 0),
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares > 0),
    state TEXT NOT NULL CHECK (state IN (
        'monitoring_reserved', 'intent_reserved', 'broker_working',
        'consumed', 'released', 'unknown'
    )),
    evidence_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (external_lineage=0 AND obligation_id IS NOT NULL) OR
        (external_lineage=1 AND obligation_id IS NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS protection_groups (
    protection_group_id TEXT PRIMARY KEY NOT NULL,
    obligation_id TEXT NOT NULL UNIQUE
        REFERENCES protection_obligations(obligation_id) ON DELETE CASCADE,
    exit_claim_id TEXT NOT NULL UNIQUE
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'monitoring', 'winner_selected', 'broker_working',
        'rearm_required', 'fulfilled', 'unknown'
    )),
    current_generation INTEGER NOT NULL CHECK (current_generation >= 0),
    plan_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS existing_position_protection_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    obligation_id TEXT NOT NULL UNIQUE
        REFERENCES protection_obligations(obligation_id) ON DELETE CASCADE,
    exit_claim_id TEXT NOT NULL UNIQUE
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    trade_date TEXT NOT NULL,
    protection_plan_json TEXT NOT NULL,
    protection_plan_hash TEXT NOT NULL,
    formal_protection_json TEXT NOT NULL,
    formal_protection_hash TEXT NOT NULL,
    reconciliation_evidence_hash TEXT NOT NULL,
    reconciliation_as_of_epoch_ms INTEGER NOT NULL
        CHECK (reconciliation_as_of_epoch_ms >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS protection_remainder_generations (
    protection_group_id TEXT NOT NULL
        REFERENCES protection_groups(protection_group_id) ON DELETE CASCADE,
    remainder_generation INTEGER NOT NULL CHECK (remainder_generation >= 0),
    exit_claim_id TEXT NOT NULL
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'monitoring', 'winner_selected', 'broker_working',
        'rearm_required', 'terminal', 'unknown'
    )),
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares > 0),
    winner_leg_id TEXT,
    winner_activation_id TEXT REFERENCES activations(activation_id),
    winner_intent_id TEXT REFERENCES order_intents(intent_id),
    evidence_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(protection_group_id, remainder_generation),
    UNIQUE(exit_claim_id, remainder_generation),
    CHECK (
        state='unknown' OR
        (state IN ('monitoring','rearm_required') AND
            winner_leg_id IS NULL AND winner_activation_id IS NULL AND
            winner_intent_id IS NULL) OR
        (state IN ('winner_selected','broker_working','terminal') AND
            winner_leg_id IS NOT NULL AND winner_activation_id IS NOT NULL AND
            winner_intent_id IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS protection_leg_evaluations (
    protection_group_id TEXT NOT NULL,
    remainder_generation INTEGER NOT NULL,
    leg_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('winner','suppressed')),
    active_dispatch_slot INTEGER CHECK (active_dispatch_slot=1),
    activation_id TEXT REFERENCES activations(activation_id),
    intent_id TEXT REFERENCES order_intents(intent_id),
    evidence_hash TEXT NOT NULL,
    broker_authority INTEGER NOT NULL DEFAULT 0
        CHECK (broker_authority=0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(protection_group_id, remainder_generation, leg_id),
    FOREIGN KEY(protection_group_id, remainder_generation)
        REFERENCES protection_remainder_generations(
            protection_group_id, remainder_generation
        ) ON DELETE CASCADE,
    CHECK (
        (state='winner' AND active_dispatch_slot=1 AND
            activation_id IS NOT NULL AND intent_id IS NOT NULL) OR
        (state='suppressed' AND active_dispatch_slot IS NULL AND
            activation_id IS NULL AND intent_id IS NULL)
    )
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_protection_leg_active_dispatch
    ON protection_leg_evaluations(
        protection_group_id, remainder_generation, active_dispatch_slot
    ) WHERE active_dispatch_slot=1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_protection_leg_winner_intent
    ON protection_leg_evaluations(intent_id) WHERE intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS exit_claim_visibility_bindings (
    exit_claim_id TEXT PRIMARY KEY NOT NULL
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    position_revision TEXT NOT NULL,
    position_shares INTEGER NOT NULL CHECK (position_shares >= 0),
    working_set_hash TEXT NOT NULL,
    binding_kind TEXT NOT NULL CHECK (binding_kind IN (
        'external_projection', 'internal_prepared'
    )),
    visibility_head_revision INTEGER NOT NULL
        CHECK (visibility_head_revision >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS account_reconciliation_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    source_revision TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    event_stream_watermark_hash TEXT NOT NULL,
    exposure_baseline_quantity_shares INTEGER NOT NULL
        CHECK (exposure_baseline_quantity_shares >= 0),
    exposure_baseline_notional_minor_units INTEGER NOT NULL
        CHECK (exposure_baseline_notional_minor_units >= 0),
    exposure_baseline_cash_minor_units INTEGER NOT NULL
        CHECK (exposure_baseline_cash_minor_units >= 0),
    exposure_baseline_position_shares INTEGER NOT NULL
        CHECK (exposure_baseline_position_shares >= 0),
    exposure_baseline_order_count INTEGER NOT NULL
        CHECK (exposure_baseline_order_count >= 0),
    exposure_baseline_valuation_complete INTEGER NOT NULL
        CHECK (exposure_baseline_valuation_complete IN (0, 1)),
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date)
) STRICT;

CREATE TABLE IF NOT EXISTS account_reconciliation_positions (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    account_head_revision INTEGER NOT NULL CHECK (account_head_revision >= 0),
    source_revision TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    position_lineage_id TEXT NOT NULL,
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares > 0),
    available_shares INTEGER NOT NULL CHECK (
        available_shares >= 0 AND available_shares <= quantity_shares
    ),
    average_cost_state TEXT NOT NULL CHECK (
        average_cost_state IN ('available', 'unavailable')
    ),
    average_price_minor_units INTEGER,
    average_cost_reason TEXT,
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    valid_until_epoch_ms INTEGER NOT NULL CHECK (
        valid_until_epoch_ms > as_of_epoch_ms
    ),
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date, contract_key),
    CHECK (
        (average_cost_state='available' AND
            average_price_minor_units IS NOT NULL AND
            average_price_minor_units > 0 AND average_cost_reason IS NULL) OR
        (average_cost_state='unavailable' AND
            average_price_minor_units IS NULL AND
            average_cost_reason IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS canonical_confirmation_snapshots (
    confirmation_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    state TEXT NOT NULL CHECK (state IN ('previewed', 'accepted', 'superseded')),
    snapshot_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    strategy_revision INTEGER NOT NULL CHECK (strategy_revision >= 0),
    definition_hash TEXT NOT NULL,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    account_head_revision INTEGER NOT NULL CHECK (account_head_revision >= 0),
    position_lineage_id TEXT NOT NULL,
    position_evidence_hash TEXT NOT NULL,
    contract_evidence_hash TEXT NOT NULL,
    contract_revision TEXT NOT NULL,
    corporate_action_revision TEXT NOT NULL,
    gate_manifest_revision TEXT NOT NULL,
    gate_manifest_hash TEXT NOT NULL,
    risk_revision TEXT NOT NULL,
    risk_hash TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    sender_fence TEXT NOT NULL,
    api_generation TEXT NOT NULL,
    runtime_revision INTEGER NOT NULL CHECK (runtime_revision >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    accepted_at_epoch_ms INTEGER,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (state='previewed' AND accepted_at_epoch_ms IS NULL) OR
        (state='accepted' AND accepted_at_epoch_ms IS NOT NULL) OR
        state='superseded'
    )
) STRICT;
CREATE INDEX IF NOT EXISTS idx_canonical_confirmation_strategy
    ON canonical_confirmation_snapshots(strategy_id, state, updated_at_epoch_ms);

CREATE TABLE IF NOT EXISTS canonical_pnl_deals (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    realized_minor_units INTEGER NOT NULL,
    fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
    transaction_tax_minor_units INTEGER NOT NULL
        CHECK (transaction_tax_minor_units >= 0),
    source_snapshot_hash TEXT NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date, deal_id)
) STRICT;

CREATE TABLE IF NOT EXISTS canonical_pnl_account_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_definition_hash TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    api_generation TEXT NOT NULL,
    account_set_revision TEXT NOT NULL,
    deal_ledger_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    event_stream_watermark_hash TEXT NOT NULL,
    realized_minor_units INTEGER NOT NULL,
    unrealized_minor_units INTEGER NOT NULL,
    fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
    transaction_tax_minor_units INTEGER NOT NULL
        CHECK (transaction_tax_minor_units >= 0),
    net_minor_units INTEGER NOT NULL,
    complete_components INTEGER NOT NULL CHECK (complete_components=1),
    includes_pre_runtime_activity INTEGER NOT NULL
        CHECK (includes_pre_runtime_activity=1),
    includes_external_client_activity INTEGER NOT NULL
        CHECK (includes_external_client_activity=1),
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    valid_until_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date),
    CHECK (valid_until_epoch_ms = as_of_epoch_ms + 5000)
) STRICT;

CREATE TABLE IF NOT EXISTS canonical_pnl_identity_heads (
    identity_group_id TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_definition_hash TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    api_generation TEXT NOT NULL,
    account_set_revision TEXT NOT NULL,
    account_set_hash TEXT NOT NULL,
    expected_account_count INTEGER NOT NULL CHECK (expected_account_count >= 1),
    observed_account_count INTEGER NOT NULL,
    deal_ledger_hash TEXT NOT NULL,
    source_evidence_hash TEXT NOT NULL,
    event_stream_watermark_hash TEXT NOT NULL,
    realized_minor_units INTEGER NOT NULL,
    unrealized_minor_units INTEGER NOT NULL,
    fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
    transaction_tax_minor_units INTEGER NOT NULL
        CHECK (transaction_tax_minor_units >= 0),
    net_minor_units INTEGER NOT NULL,
    all_accounts_reconciled INTEGER NOT NULL
        CHECK (all_accounts_reconciled=1),
    identity_mapping_ready INTEGER NOT NULL
        CHECK (identity_mapping_ready=1),
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    valid_until_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(identity_group_id, trade_date),
    CHECK (observed_account_count = expected_account_count),
    CHECK (valid_until_epoch_ms = as_of_epoch_ms + 5000)
) STRICT;

CREATE TABLE IF NOT EXISTS protected_entry_fill_heads (
    intent_id TEXT PRIMARY KEY NOT NULL REFERENCES order_intents(intent_id),
    commitment_id TEXT NOT NULL UNIQUE
        REFERENCES pending_protection_commitments(commitment_id),
    obligation_id TEXT NOT NULL UNIQUE
        REFERENCES protection_obligations(obligation_id),
    exit_claim_id TEXT REFERENCES exit_claims(exit_claim_id),
    protection_plan_hash TEXT NOT NULL,
    atr_snapshot_hash TEXT,
    formal_protection_json TEXT,
    formal_protection_hash TEXT,
    cumulative_filled_shares INTEGER NOT NULL
        CHECK (cumulative_filled_shares >= 0),
    remaining_entry_shares INTEGER NOT NULL
        CHECK (remaining_entry_shares >= 0),
    fill_notional_minor_units INTEGER NOT NULL
        CHECK (fill_notional_minor_units >= 0),
    weighted_average_numerator_minor_units INTEGER NOT NULL
        CHECK (weighted_average_numerator_minor_units >= 0),
    weighted_average_denominator_shares INTEGER NOT NULL
        CHECK (weighted_average_denominator_shares >= 0),
    position_lineage_id TEXT NOT NULL,
    position_quantity_shares INTEGER NOT NULL
        CHECK (position_quantity_shares >= 0),
    deal_set_hash TEXT NOT NULL,
    reconciliation_snapshot_hash TEXT NOT NULL,
    reconciliation_evidence_hash TEXT NOT NULL,
    reconciliation_source_revision TEXT NOT NULL,
    reconciliation_as_of_epoch_ms INTEGER NOT NULL
        CHECK (reconciliation_as_of_epoch_ms >= 0),
    state TEXT NOT NULL CHECK (state IN ('partial', 'final', 'zero_fill')),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (formal_protection_json IS NULL AND formal_protection_hash IS NULL) OR
        (formal_protection_json IS NOT NULL AND formal_protection_hash IS NOT NULL)
    )
) STRICT;
CREATE TRIGGER IF NOT EXISTS trg_protected_entry_fill_formal_pair_insert
BEFORE INSERT ON protected_entry_fill_heads
WHEN (NEW.formal_protection_json IS NULL) !=
     (NEW.formal_protection_hash IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'formal protection projection must be paired');
END;
CREATE TRIGGER IF NOT EXISTS trg_protected_entry_fill_formal_pair_update
BEFORE UPDATE OF formal_protection_json, formal_protection_hash
ON protected_entry_fill_heads
WHEN (NEW.formal_protection_json IS NULL) !=
     (NEW.formal_protection_hash IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'formal protection projection must be paired');
END;

CREATE TABLE IF NOT EXISTS observations (
    observation_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    contract_key TEXT NOT NULL,
    field_name TEXT NOT NULL,
    value_decimal TEXT NOT NULL,
    exchange_epoch_ms INTEGER,
    broker_epoch_ms INTEGER,
    receive_epoch_ms INTEGER NOT NULL,
    local_sequence INTEGER NOT NULL CHECK (local_sequence >= 0),
    api_generation TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    UNIQUE(strategy_id, contract_key, field_name, api_generation, local_sequence)
) STRICT;

CREATE TABLE IF NOT EXISTS protection_trigger_heads (
    protection_group_id TEXT NOT NULL,
    remainder_generation INTEGER NOT NULL CHECK (remainder_generation >= 0),
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    family TEXT NOT NULL CHECK (family IN ('fixed','trailing')),
    state TEXT NOT NULL CHECK (state IN (
        'monitoring','pending_activation','active','triggered'
    )),
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (
        last_receive_epoch_ms >= last_exchange_epoch_ms
    ),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_price_decimal TEXT NOT NULL,
    saved_high_decimal TEXT,
    saved_high_observation_id TEXT REFERENCES observations(observation_id),
    retracement_trigger_decimal TEXT,
    triggered_leg_id TEXT,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(protection_group_id, remainder_generation),
    FOREIGN KEY(protection_group_id, remainder_generation)
        REFERENCES protection_remainder_generations(
            protection_group_id, remainder_generation
        ) ON DELETE CASCADE,
    CHECK (
        (family='fixed' AND state IN ('monitoring','triggered') AND
            saved_high_decimal IS NULL AND saved_high_observation_id IS NULL AND
            retracement_trigger_decimal IS NULL) OR
        (family='trailing' AND state='pending_activation' AND
            saved_high_decimal IS NULL AND saved_high_observation_id IS NULL AND
            retracement_trigger_decimal IS NULL) OR
        (family='trailing' AND state='active' AND
            saved_high_decimal IS NOT NULL AND saved_high_observation_id IS NOT NULL AND
            retracement_trigger_decimal IS NOT NULL) OR
        (family='trailing' AND state='triggered' AND (
            (saved_high_decimal IS NULL AND saved_high_observation_id IS NULL AND
                retracement_trigger_decimal IS NULL) OR
            (saved_high_decimal IS NOT NULL AND saved_high_observation_id IS NOT NULL AND
                retracement_trigger_decimal IS NOT NULL)
        ))
    ),
    CHECK (
        (state='triggered' AND triggered_leg_id IS NOT NULL) OR
        (state<>'triggered' AND triggered_leg_id IS NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS quick_condition_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'waiting_for_false','ready_after_false','true_latched','triggered'
    )),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN (
        'require_rearm','immediate_if_true'
    )),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (
        last_receive_epoch_ms >= last_exchange_epoch_ms
    ),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (state='triggered' AND activation_id IS NOT NULL) OR
        (state<>'triggered' AND activation_id IS NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS good_till_progress_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    target_shares INTEGER NOT NULL CHECK (target_shares > 0),
    confirmed_filled_shares INTEGER NOT NULL
        CHECK (confirmed_filled_shares >= 0 AND confirmed_filled_shares <= target_shares),
    remaining_target_shares INTEGER NOT NULL
        CHECK (remaining_target_shares = target_shares - confirmed_filled_shares),
    daily_state TEXT NOT NULL CHECK (daily_state IN (
        'waiting','intent_prepared','working','terminal_consumed',
        'unknown_blocked','completed'
    )),
    active_trade_date TEXT,
    active_activation_id TEXT REFERENCES activations(activation_id),
    active_intent_id TEXT REFERENCES order_intents(intent_id),
    active_accounted_filled_shares INTEGER NOT NULL
        CHECK (active_accounted_filled_shares >= 0),
    last_reconciliation_hash TEXT,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (daily_state IN ('waiting','completed') AND active_activation_id IS NULL
            AND active_intent_id IS NULL AND active_accounted_filled_shares=0) OR
        (daily_state NOT IN ('waiting','completed') AND active_trade_date IS NOT NULL
            AND active_activation_id IS NOT NULL AND active_intent_id IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS good_till_condition_heads (
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    trade_date TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'waiting_for_false','ready_after_false','true_latched','triggered'
    )),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN (
        'require_rearm','immediate_if_true'
    )),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (
        last_receive_epoch_ms >= last_exchange_epoch_ms
    ),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(strategy_id, trade_date),
    CHECK (
        (state='triggered' AND activation_id IS NOT NULL) OR
        (state<>'triggered' AND activation_id IS NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS multi_condition_group_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'waiting_for_false','ready_after_false','true_latched','triggered'
    )),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN (
        'require_rearm','immediate_if_true'
    )),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    operator TEXT NOT NULL CHECK (operator IN ('AND','OR')),
    condition_count INTEGER NOT NULL CHECK (condition_count BETWEEN 1 AND 7),
    definition_hash TEXT NOT NULL,
    last_trade_date TEXT,
    last_stream_epoch TEXT,
    last_evaluation_hash TEXT,
    last_condition_true INTEGER CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (state='triggered' AND activation_id IS NOT NULL) OR
        (state<>'triggered' AND activation_id IS NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS multi_condition_leg_heads (
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    condition_index INTEGER NOT NULL CHECK (condition_index BETWEEN 0 AND 6),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    monitor_contract_key TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (
        last_receive_epoch_ms >= last_exchange_epoch_ms
    ),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(strategy_id, condition_index)
) STRICT;

CREATE TABLE IF NOT EXISTS parent_child_progress_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'waiting_parent','parent_intent_prepared','parent_working',
        'child_monitoring','child_intent_prepared','child_working',
        'completed','expired','expired_with_obligation','manual_intervention'
    )),
    parent_activation_trade_date TEXT,
    parent_activation_id TEXT REFERENCES activations(activation_id),
    parent_intent_id TEXT REFERENCES order_intents(intent_id),
    parent_settlement_hash TEXT,
    child_activation_trade_date TEXT,
    child_quantity_shares INTEGER CHECK (child_quantity_shares > 0),
    child_position_lineage_id TEXT,
    child_obligation_id TEXT REFERENCES protection_obligations(obligation_id),
    child_exit_claim_id TEXT REFERENCES exit_claims(exit_claim_id),
    child_protection_group_id TEXT REFERENCES protection_groups(protection_group_id),
    child_activation_id TEXT REFERENCES activations(activation_id),
    child_intent_id TEXT REFERENCES order_intents(intent_id),
    child_settlement_hash TEXT,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (state IN ('waiting_parent','expired') AND parent_activation_trade_date IS NULL
            AND parent_activation_id IS NULL AND parent_intent_id IS NULL
            AND child_activation_trade_date IS NULL
            AND child_quantity_shares IS NULL
            AND child_position_lineage_id IS NULL
            AND child_obligation_id IS NULL AND child_exit_claim_id IS NULL
            AND child_protection_group_id IS NULL
            AND child_activation_id IS NULL AND child_intent_id IS NULL) OR
        (state IN ('parent_intent_prepared','parent_working')
            AND parent_activation_trade_date IS NOT NULL
            AND parent_activation_id IS NOT NULL AND parent_intent_id IS NOT NULL
            AND child_activation_trade_date IS NULL
            AND child_quantity_shares IS NULL
            AND child_position_lineage_id IS NULL
            AND child_obligation_id IS NULL AND child_exit_claim_id IS NULL
            AND child_protection_group_id IS NULL
            AND child_activation_id IS NULL AND child_intent_id IS NULL) OR
        (state IN ('child_monitoring','child_intent_prepared','child_working','completed','expired_with_obligation')
            AND parent_activation_trade_date IS NOT NULL
            AND parent_activation_id IS NOT NULL AND parent_intent_id IS NOT NULL
            AND parent_settlement_hash IS NOT NULL
            AND child_activation_trade_date IS NOT NULL
            AND child_quantity_shares IS NOT NULL
            AND child_position_lineage_id IS NOT NULL
            AND child_obligation_id IS NOT NULL AND child_exit_claim_id IS NOT NULL
            AND child_protection_group_id IS NOT NULL
            AND (state IN ('child_monitoring','expired_with_obligation') OR
                (child_activation_id IS NOT NULL AND child_intent_id IS NOT NULL))) OR
        state='manual_intervention'
    )
) STRICT;

CREATE TABLE IF NOT EXISTS parent_child_condition_heads (
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    leg_kind TEXT NOT NULL CHECK (leg_kind IN ('parent','child')),
    state TEXT NOT NULL CHECK (state IN (
        'waiting_for_false','ready_after_false','true_latched','triggered'
    )),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN (
        'require_rearm','immediate_if_true'
    )),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (
        last_receive_epoch_ms >= last_exchange_epoch_ms
    ),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(strategy_id, leg_kind),
    CHECK (
        (state='triggered' AND activation_id IS NOT NULL) OR
        (state<>'triggered' AND activation_id IS NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS resolution_cases (
    resolution_case_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT REFERENCES strategies(strategy_id),
    reason_code TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    evidence_snapshot_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS safety_blockers (
    blocker_id TEXT PRIMARY KEY NOT NULL,
    resolution_case_id TEXT REFERENCES resolution_cases(resolution_case_id),
    scope_hash TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
    created_at_epoch_ms INTEGER NOT NULL,
    resolved_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS relinquished_unknown_exposures (
    exposure_id TEXT PRIMARY KEY NOT NULL,
    blocker_id TEXT NOT NULL UNIQUE REFERENCES safety_blockers(blocker_id),
    resolution_case_id TEXT NOT NULL REFERENCES resolution_cases(resolution_case_id),
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('place','update','cancel')),
    intent_lineage_json TEXT NOT NULL,
    intent_lineage_hash TEXT NOT NULL,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy','Sell')),
    position_lineage_id TEXT NOT NULL,
    scope_members_json TEXT NOT NULL,
    scope_members_hash TEXT NOT NULL,
    worst_case_position_delta_shares INTEGER NOT NULL
        CHECK (worst_case_position_delta_shares >= 0),
    possibly_working_shares INTEGER NOT NULL
        CHECK (possibly_working_shares >= 0),
    pnl_uncertainty INTEGER NOT NULL CHECK (pnl_uncertainty=1),
    claim_uncertainty_count INTEGER NOT NULL
        CHECK (claim_uncertainty_count >= 0),
    evidence_snapshot_hash TEXT NOT NULL,
    first_confirmation_hash TEXT NOT NULL,
    second_confirmation_hash TEXT NOT NULL,
    actor_kind TEXT NOT NULL CHECK (actor_kind='interactive_user'),
    created_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS event_journal (
    journal_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    entity_kind TEXT NOT NULL CHECK (
        entity_kind IN (${SMART_ORDER_JOURNAL_ENTITY_KIND_SQL})
    ),
    entity_id TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    exchange_epoch_ms INTEGER,
    broker_epoch_ms INTEGER,
    receive_epoch_ms INTEGER NOT NULL,
    local_monotonic_sequence INTEGER NOT NULL CHECK (local_monotonic_sequence >= 0),
    entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
    payload_hash TEXT NOT NULL,
    summary_code TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS gate_manifests (
    manifest_id TEXT PRIMARY KEY NOT NULL,
    manifest_revision TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL UNIQUE,
    schema_version TEXT NOT NULL,
    provenance TEXT NOT NULL CHECK (provenance IN (
        'manual_user_confirmed', 'automation', 'gate_probe'
    )),
    manifest_json TEXT NOT NULL,
    fingerprints_sha256 TEXT NOT NULL,
    evidence_catalog_sha256 TEXT NOT NULL,
    feature_gates_sha256 TEXT NOT NULL,
    product_boundary_consent_version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('observe_only', 'eligible', 'invalidated')),
    valid_until_epoch_ms INTEGER NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    invalidated_at_epoch_ms INTEGER,
    invalidation_reason TEXT,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS authority_consumptions (
    authority_kind TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    authority_payload_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    consumed_by TEXT NOT NULL,
    runtime_epoch_id TEXT REFERENCES runtime_epochs(runtime_epoch_id),
    consumed_at_epoch_ms INTEGER NOT NULL,
    PRIMARY KEY(authority_kind, authority_id)
) STRICT;

CREATE TABLE IF NOT EXISTS request_replays (
    request_id TEXT PRIMARY KEY NOT NULL,
    operation_kind TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    result_hash TEXT,
    result_status INTEGER,
    result_json TEXT,
    state TEXT NOT NULL CHECK (
        state IN ('reserved', 'completed', 'failed', 'outcome_unknown')
    ),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    CHECK (
        (state='reserved' AND result_hash IS NULL AND result_status IS NULL
            AND result_json IS NULL) OR
        (state='completed' AND result_hash IS NOT NULL AND result_status=200
            AND result_json IS NOT NULL) OR
        (state='failed' AND result_hash IS NOT NULL
            AND result_status BETWEEN 400 AND 599 AND result_json IS NOT NULL) OR
        (state='outcome_unknown' AND result_status IS NULL AND result_json IS NULL)
    ),
    UNIQUE(operation_kind, payload_hash, request_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_intents_state ON order_intents(state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_single_ready_sender
    ON runtime_epochs((1)) WHERE state='ready';
CREATE INDEX IF NOT EXISTS idx_broker_orders_state ON broker_orders(state);
CREATE INDEX IF NOT EXISTS idx_broker_correlation_identifiers_intent
    ON broker_correlation_identifiers(intent_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_intent_rearm_current
    ON intent_rearm_authorizations(
        runtime_epoch_id, sender_fence, api_generation, state, intent_id
    );
CREATE INDEX IF NOT EXISTS idx_obligations_state ON protection_obligations(state);
CREATE INDEX IF NOT EXISTS idx_reservations_state ON entry_exposure_reservations(state);
CREATE INDEX IF NOT EXISTS idx_exit_claims_scope
    ON exit_claims(account_broker_ref, account_id_ref, contract_key, state);
CREATE INDEX IF NOT EXISTS idx_journal_entity
    ON event_journal(entity_kind, entity_id, journal_sequence);
CREATE INDEX IF NOT EXISTS idx_gate_manifests_current
    ON gate_manifests(provenance, state, valid_until_epoch_ms);
CREATE INDEX IF NOT EXISTS idx_authority_consumptions_scope
    ON authority_consumptions(scope_hash, consumed_at_epoch_ms);
`;

export const SMART_ORDER_SCHEMA_V1_TO_V2_SQL = String.raw`
DROP TABLE IF EXISTS gate_manifests;
CREATE TABLE gate_manifests (
    manifest_id TEXT PRIMARY KEY NOT NULL,
    manifest_revision TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL UNIQUE,
    schema_version TEXT NOT NULL,
    provenance TEXT NOT NULL CHECK (provenance IN (
        'manual_user_confirmed', 'automation', 'gate_probe'
    )),
    manifest_json TEXT NOT NULL,
    fingerprints_sha256 TEXT NOT NULL,
    evidence_catalog_sha256 TEXT NOT NULL,
    feature_gates_sha256 TEXT NOT NULL,
    product_boundary_consent_version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('observe_only', 'eligible', 'invalidated')),
    valid_until_epoch_ms INTEGER NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    invalidated_at_epoch_ms INTEGER,
    invalidation_reason TEXT,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
CREATE TABLE IF NOT EXISTS authority_consumptions (
    authority_kind TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    authority_payload_hash TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    consumed_by TEXT NOT NULL,
    runtime_epoch_id TEXT REFERENCES runtime_epochs(runtime_epoch_id),
    consumed_at_epoch_ms INTEGER NOT NULL,
    PRIMARY KEY(authority_kind, authority_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_gate_manifests_current
    ON gate_manifests(provenance, state, valid_until_epoch_ms);
CREATE INDEX IF NOT EXISTS idx_authority_consumptions_scope
    ON authority_consumptions(scope_hash, consumed_at_epoch_ms);
`;

export const SMART_ORDER_SCHEMA_V2_TO_V3_SQL = String.raw`
DROP INDEX IF EXISTS idx_exit_claims_scope;
ALTER TABLE exit_claims RENAME TO exit_claims_v2;
CREATE TABLE exit_claims (
    exit_claim_id TEXT PRIMARY KEY NOT NULL,
    obligation_id TEXT REFERENCES protection_obligations(obligation_id),
    intent_id TEXT REFERENCES order_intents(intent_id),
    external_lineage INTEGER NOT NULL CHECK (external_lineage IN (0, 1)),
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    position_lineage_id TEXT NOT NULL,
    remainder_generation INTEGER NOT NULL CHECK (remainder_generation >= 0),
    allocation_start_share INTEGER NOT NULL CHECK (allocation_start_share >= 0),
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares > 0),
    state TEXT NOT NULL CHECK (state IN (
        'monitoring_reserved', 'intent_reserved', 'broker_working',
        'consumed', 'released', 'unknown'
    )),
    evidence_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (external_lineage=0 AND obligation_id IS NOT NULL) OR
        (external_lineage=1 AND obligation_id IS NULL)
    )
) STRICT;
INSERT INTO exit_claims SELECT * FROM exit_claims_v2;
DROP TABLE exit_claims_v2;
CREATE INDEX idx_exit_claims_scope
    ON exit_claims(account_broker_ref, account_id_ref, contract_key, state);

DROP INDEX IF EXISTS idx_journal_entity;
ALTER TABLE event_journal RENAME TO event_journal_v2;
CREATE TABLE event_journal (
    journal_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    entity_kind TEXT NOT NULL CHECK (
        entity_kind IN (${SMART_ORDER_JOURNAL_ENTITY_KIND_SQL})
    ),
    entity_id TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    exchange_epoch_ms INTEGER,
    broker_epoch_ms INTEGER,
    receive_epoch_ms INTEGER NOT NULL,
    local_monotonic_sequence INTEGER NOT NULL CHECK (local_monotonic_sequence >= 0),
    entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
    payload_hash TEXT NOT NULL,
    summary_code TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL
) STRICT;
INSERT INTO event_journal(
    journal_sequence, event_id, entity_kind, entity_id, reason_code,
    exchange_epoch_ms, broker_epoch_ms, receive_epoch_ms,
    local_monotonic_sequence, entity_revision, payload_hash,
    summary_code, created_at_epoch_ms
)
SELECT journal_sequence, event_id,
       CASE lower(entity_kind)
           WHEN 'strategy' THEN 'strategy'
           WHEN 'activation' THEN 'activation'
           WHEN 'orderintent' THEN 'order_intent'
           WHEN 'order_intent' THEN 'order_intent'
           WHEN 'brokerorder' THEN 'broker_order'
           WHEN 'broker_order' THEN 'broker_order'
           WHEN 'brokercorrelation' THEN 'broker_correlation'
           WHEN 'broker_correlation' THEN 'broker_correlation'
           WHEN 'pendingprotectioncommitment' THEN 'pending_protection_commitment'
           WHEN 'pending_protection_commitment' THEN 'pending_protection_commitment'
           WHEN 'protectionobligation' THEN 'protection_obligation'
           WHEN 'protection_obligation' THEN 'protection_obligation'
           WHEN 'entryexposurereservation' THEN 'entry_exposure_reservation'
           WHEN 'entry_exposure_reservation' THEN 'entry_exposure_reservation'
           WHEN 'exitclaim' THEN 'exit_claim'
           WHEN 'exit_claim' THEN 'exit_claim'
           WHEN 'observation' THEN 'observation'
           WHEN 'resolutioncase' THEN 'resolution_case'
           WHEN 'resolution_case' THEN 'resolution_case'
           WHEN 'safetyblocker' THEN 'safety_blocker'
           WHEN 'safety_blocker' THEN 'safety_blocker'
           WHEN 'runtimeepoch' THEN 'runtime_epoch'
           WHEN 'runtime_epoch' THEN 'runtime_epoch'
           WHEN 'gate_manifest' THEN 'gate_manifest'
           WHEN 'authority_consumption' THEN 'authority_consumption'
           WHEN 'request_replay' THEN 'request_replay'
           ELSE entity_kind
       END,
       entity_id, reason_code, exchange_epoch_ms, broker_epoch_ms,
       receive_epoch_ms, local_monotonic_sequence, entity_revision,
       payload_hash, summary_code, created_at_epoch_ms
  FROM event_journal_v2;
DROP TABLE event_journal_v2;
CREATE INDEX idx_journal_entity
    ON event_journal(entity_kind, entity_id, journal_sequence);
`;

export const SMART_ORDER_SCHEMA_V3_TO_V4_SQL = String.raw`
ALTER TABLE request_replays RENAME TO request_replays_v3;
CREATE TABLE request_replays (
    request_id TEXT PRIMARY KEY NOT NULL,
    operation_kind TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    result_hash TEXT,
    result_status INTEGER,
    result_json TEXT,
    state TEXT NOT NULL CHECK (
        state IN ('reserved', 'completed', 'failed', 'outcome_unknown')
    ),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    CHECK (
        (state='reserved' AND result_hash IS NULL AND result_status IS NULL
            AND result_json IS NULL) OR
        (state='completed' AND result_hash IS NOT NULL AND result_status=200
            AND result_json IS NOT NULL) OR
        (state='failed' AND result_hash IS NOT NULL
            AND result_status BETWEEN 400 AND 599 AND result_json IS NOT NULL) OR
        (state='outcome_unknown' AND result_status IS NULL AND result_json IS NULL)
    ),
    UNIQUE(operation_kind, payload_hash, request_id)
) STRICT;
INSERT INTO request_replays(
    request_id, operation_kind, payload_hash, result_hash,
    result_status, result_json, state,
    created_at_epoch_ms, updated_at_epoch_ms
)
SELECT request_id, operation_kind, payload_hash, result_hash,
       NULL, NULL,
       CASE
           WHEN state='reserved' THEN 'reserved'
           ELSE 'outcome_unknown'
       END,
       created_at_epoch_ms, updated_at_epoch_ms
  FROM request_replays_v3;
DROP TABLE request_replays_v3;
`;

export const SMART_ORDER_SCHEMA_V4_TO_V5_SQL = String.raw`
CREATE TABLE strategies_v5 (
    strategy_id TEXT PRIMARY KEY NOT NULL,
    strategy_kind TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (${SMART_ORDER_STRATEGY_STATE_SQL})),
    definition_hash TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    confirmation_snapshot_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
INSERT INTO strategies_v5(
    strategy_id, strategy_kind, state, definition_hash, definition_json,
    account_broker_ref, account_id_ref, identity_group_id,
    confirmation_snapshot_hash, created_at_epoch_ms, updated_at_epoch_ms,
    terminal_at_epoch_ms, revision
)
SELECT strategy_id, strategy_kind,
       CASE state
           WHEN 'armed' THEN 'recovery'
           WHEN 'triggered' THEN 'recovery'
           WHEN 'failed' THEN 'manual_intervention'
           ELSE state
       END,
       definition_hash, definition_json, account_broker_ref, account_id_ref,
       identity_group_id, confirmation_snapshot_hash, created_at_epoch_ms,
       updated_at_epoch_ms,
       CASE WHEN state='failed' THEN NULL ELSE terminal_at_epoch_ms END,
       revision
  FROM strategies;
DROP TABLE strategies;
ALTER TABLE strategies_v5 RENAME TO strategies;
`;

export const SMART_ORDER_SCHEMA_V5_TO_V6_SQL = String.raw`
CREATE TABLE broker_correlation_identifiers (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
    identifier_kind TEXT NOT NULL CHECK (identifier_kind IN (
        'tradeId', 'orderId', 'dealId', 'seqno', 'ordno', 'exchangeSequence'
    )),
    identifier_value TEXT NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    correlation_id TEXT NOT NULL REFERENCES broker_correlations(correlation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    PRIMARY KEY(
        account_broker_ref, account_id_ref, trade_date, contract_key, side,
        identifier_kind, identifier_value
    )
) STRICT;
INSERT INTO broker_correlation_identifiers(
    account_broker_ref, account_id_ref, trade_date, contract_key, side,
    identifier_kind, identifier_value, intent_id, correlation_id,
    created_at_epoch_ms
)
SELECT account_broker_ref, account_id_ref, trade_date, contract_key, side,
       identifier_kind, identifier_value, MIN(intent_id), MIN(correlation_id),
       MIN(created_at_epoch_ms)
  FROM (
        SELECT account_broker_ref, account_id_ref, trade_date, contract_key,
               side, 'tradeId' AS identifier_kind, trade_id AS identifier_value,
               intent_id, correlation_id, created_at_epoch_ms
          FROM broker_correlations WHERE trade_id IS NOT NULL
        UNION ALL
        SELECT account_broker_ref, account_id_ref, trade_date, contract_key,
               side, 'orderId', order_id, intent_id, correlation_id,
               created_at_epoch_ms
          FROM broker_correlations WHERE order_id IS NOT NULL
        UNION ALL
        SELECT account_broker_ref, account_id_ref, trade_date, contract_key,
               side, 'dealId', deal_id, intent_id, correlation_id,
               created_at_epoch_ms
          FROM broker_correlations WHERE deal_id IS NOT NULL
        UNION ALL
        SELECT account_broker_ref, account_id_ref, trade_date, contract_key,
               side, 'seqno', seqno, intent_id, correlation_id,
               created_at_epoch_ms
          FROM broker_correlations WHERE seqno IS NOT NULL
        UNION ALL
        SELECT account_broker_ref, account_id_ref, trade_date, contract_key,
               side, 'ordno', ordno, intent_id, correlation_id,
               created_at_epoch_ms
          FROM broker_correlations WHERE ordno IS NOT NULL
        UNION ALL
        SELECT account_broker_ref, account_id_ref, trade_date, contract_key,
               side, 'exchangeSequence', exchange_sequence, intent_id,
               correlation_id, created_at_epoch_ms
          FROM broker_correlations WHERE exchange_sequence IS NOT NULL
       )
 GROUP BY account_broker_ref, account_id_ref, trade_date, contract_key, side,
          identifier_kind, identifier_value;
CREATE INDEX idx_broker_correlation_identifiers_intent
    ON broker_correlation_identifiers(intent_id, correlation_id);

CREATE TABLE intent_rearm_authorizations (
    rearm_authorization_id TEXT PRIMARY KEY NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    sender_fence TEXT NOT NULL,
    api_generation TEXT NOT NULL,
    rearm_request_id TEXT NOT NULL UNIQUE,
    authorized_intent_revision INTEGER NOT NULL
        CHECK (authorized_intent_revision >= 1),
    confirmation_snapshot_hash TEXT NOT NULL,
    risk_revision TEXT NOT NULL,
    reconciliation_evidence_hash TEXT NOT NULL,
    user_rearm_evidence_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'consumed', 'superseded')),
    authorized_at_epoch_ms INTEGER NOT NULL,
    consumed_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE(intent_id, runtime_epoch_id)
) STRICT;
CREATE INDEX idx_intent_rearm_current
    ON intent_rearm_authorizations(
        runtime_epoch_id, sender_fence, api_generation, state, intent_id
    );
`;

export const SMART_ORDER_SCHEMA_V6_TO_V7_SQL = String.raw`
CREATE TABLE exposure_identity_arbiter_heads (
    identity_group_id TEXT PRIMARY KEY NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    observed_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    reserved_dimensions_json TEXT NOT NULL,
    baseline_quantity_shares INTEGER NOT NULL CHECK (baseline_quantity_shares >= 0),
    baseline_notional_minor_units INTEGER NOT NULL CHECK (baseline_notional_minor_units >= 0),
    baseline_cash_minor_units INTEGER NOT NULL CHECK (baseline_cash_minor_units >= 0),
    baseline_position_shares INTEGER NOT NULL CHECK (baseline_position_shares >= 0),
    baseline_order_count INTEGER NOT NULL CHECK (baseline_order_count >= 0),
    limit_quantity_shares INTEGER CHECK (limit_quantity_shares >= 0),
    limit_notional_minor_units INTEGER CHECK (limit_notional_minor_units >= 0),
    limit_cash_minor_units INTEGER CHECK (limit_cash_minor_units >= 0),
    limit_position_shares INTEGER CHECK (limit_position_shares >= 0),
    limit_order_count INTEGER CHECK (limit_order_count >= 0),
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (valid_until_epoch_ms > observed_at_epoch_ms)
) STRICT;
CREATE TABLE exposure_account_arbiter_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL
        REFERENCES exposure_identity_arbiter_heads(identity_group_id),
    policy_revision TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    observed_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    reserved_dimensions_json TEXT NOT NULL,
    baseline_quantity_shares INTEGER NOT NULL CHECK (baseline_quantity_shares >= 0),
    baseline_notional_minor_units INTEGER NOT NULL CHECK (baseline_notional_minor_units >= 0),
    baseline_cash_minor_units INTEGER NOT NULL CHECK (baseline_cash_minor_units >= 0),
    baseline_position_shares INTEGER NOT NULL CHECK (baseline_position_shares >= 0),
    baseline_order_count INTEGER NOT NULL CHECK (baseline_order_count >= 0),
    limit_quantity_shares INTEGER CHECK (limit_quantity_shares >= 0),
    limit_notional_minor_units INTEGER CHECK (limit_notional_minor_units >= 0),
    limit_cash_minor_units INTEGER CHECK (limit_cash_minor_units >= 0),
    limit_position_shares INTEGER CHECK (limit_position_shares >= 0),
    limit_order_count INTEGER CHECK (limit_order_count >= 0),
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref),
    CHECK (valid_until_epoch_ms > observed_at_epoch_ms)
) STRICT;
CREATE INDEX idx_exposure_account_identity
    ON exposure_account_arbiter_heads(identity_group_id);
`;

export const SMART_ORDER_SCHEMA_V7_TO_V8_SQL = String.raw`
CREATE TABLE external_sell_visibility_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    position_revision TEXT NOT NULL,
    position_shares INTEGER NOT NULL CHECK (position_shares >= 0),
    working_set_hash TEXT NOT NULL,
    collection_complete INTEGER NOT NULL CHECK (collection_complete=1),
    observed_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date, contract_key),
    CHECK (valid_until_epoch_ms > observed_at_epoch_ms)
) STRICT;
CREATE TABLE exit_claim_visibility_bindings (
    exit_claim_id TEXT PRIMARY KEY NOT NULL
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence >= 1),
    source_evidence_hash TEXT NOT NULL,
    position_revision TEXT NOT NULL,
    position_shares INTEGER NOT NULL CHECK (position_shares >= 0),
    working_set_hash TEXT NOT NULL,
    binding_kind TEXT NOT NULL CHECK (binding_kind IN (
        'external_projection', 'internal_prepared'
    )),
    visibility_head_revision INTEGER NOT NULL
        CHECK (visibility_head_revision >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
CREATE INDEX idx_external_sell_visibility_bindings_scope
    ON exit_claim_visibility_bindings(
        account_broker_ref, account_id_ref, trade_date, contract_key,
        source_sequence, binding_kind
    );
`;

export const SMART_ORDER_SCHEMA_V8_TO_V9_SQL = String.raw`
CREATE TABLE broker_event_records (
    broker_event_key_hash TEXT PRIMARY KEY NOT NULL,
    broker_order_correlation_key_hash TEXT NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    mapping_revision TEXT NOT NULL,
    api_generation TEXT NOT NULL,
    event_kind TEXT NOT NULL CHECK (event_kind IN ('order', 'deal')),
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy', 'Sell')),
    trade_id TEXT NOT NULL,
    order_id TEXT,
    deal_id TEXT,
    seqno TEXT NOT NULL,
    ordno TEXT NOT NULL,
    exchange_sequence TEXT,
    custom_field TEXT,
    operation_type TEXT,
    operation_code TEXT,
    operation_message TEXT,
    status TEXT NOT NULL,
    order_condition TEXT NOT NULL,
    order_lot TEXT NOT NULL,
    price_type TEXT NOT NULL,
    time_in_force TEXT NOT NULL,
    order_quantity INTEGER NOT NULL CHECK (order_quantity > 0),
    cumulative_deal_quantity INTEGER NOT NULL CHECK (cumulative_deal_quantity >= 0),
    cumulative_cancel_quantity INTEGER NOT NULL CHECK (cumulative_cancel_quantity >= 0),
    remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
    event_deal_quantity INTEGER NOT NULL CHECK (event_deal_quantity >= 0),
    quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('Share', 'CommonLot')),
    price_decimal TEXT,
    exchange_epoch_ms INTEGER NOT NULL CHECK (exchange_epoch_ms >= 0),
    broker_epoch_ms INTEGER CHECK (broker_epoch_ms >= 0),
    receive_epoch_ms INTEGER NOT NULL CHECK (receive_epoch_ms >= 0),
    evidence_hash TEXT NOT NULL,
    payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE broker_event_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    broker_order_correlation_key_hash TEXT NOT NULL,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    status TEXT NOT NULL,
    order_quantity INTEGER NOT NULL CHECK (order_quantity > 0),
    cumulative_deal_quantity INTEGER NOT NULL CHECK (cumulative_deal_quantity >= 0),
    cumulative_cancel_quantity INTEGER NOT NULL CHECK (cumulative_cancel_quantity >= 0),
    remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
    quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('Share', 'CommonLot')),
    exchange_epoch_ms INTEGER NOT NULL CHECK (exchange_epoch_ms >= 0),
    broker_event_key_hash TEXT NOT NULL REFERENCES broker_event_records(broker_event_key_hash),
    evidence_hash TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(
        account_broker_ref, account_id_ref, trade_date,
        broker_order_correlation_key_hash
    )
) STRICT;
CREATE INDEX idx_broker_event_records_intent
    ON broker_event_records(intent_id, event_kind, exchange_epoch_ms);
CREATE INDEX idx_broker_event_records_deal
    ON broker_event_records(
        account_broker_ref, account_id_ref, trade_date, deal_id
    ) WHERE deal_id IS NOT NULL;
CREATE TABLE account_reconciliation_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    source_revision TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    event_stream_watermark_hash TEXT NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date)
) STRICT;
CREATE TABLE protected_entry_fill_heads (
    intent_id TEXT PRIMARY KEY NOT NULL REFERENCES order_intents(intent_id),
    commitment_id TEXT NOT NULL UNIQUE
        REFERENCES pending_protection_commitments(commitment_id),
    obligation_id TEXT NOT NULL UNIQUE
        REFERENCES protection_obligations(obligation_id),
    exit_claim_id TEXT REFERENCES exit_claims(exit_claim_id),
    protection_plan_hash TEXT NOT NULL,
    atr_snapshot_hash TEXT,
    cumulative_filled_shares INTEGER NOT NULL
        CHECK (cumulative_filled_shares >= 0),
    remaining_entry_shares INTEGER NOT NULL
        CHECK (remaining_entry_shares >= 0),
    fill_notional_minor_units INTEGER NOT NULL
        CHECK (fill_notional_minor_units >= 0),
    weighted_average_numerator_minor_units INTEGER NOT NULL
        CHECK (weighted_average_numerator_minor_units >= 0),
    weighted_average_denominator_shares INTEGER NOT NULL
        CHECK (weighted_average_denominator_shares >= 0),
    position_lineage_id TEXT NOT NULL,
    position_quantity_shares INTEGER NOT NULL
        CHECK (position_quantity_shares >= 0),
    deal_set_hash TEXT NOT NULL,
    reconciliation_snapshot_hash TEXT NOT NULL,
    reconciliation_evidence_hash TEXT NOT NULL,
    reconciliation_source_revision TEXT NOT NULL,
    reconciliation_as_of_epoch_ms INTEGER NOT NULL
        CHECK (reconciliation_as_of_epoch_ms >= 0),
    state TEXT NOT NULL CHECK (state IN ('partial', 'final', 'zero_fill')),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V9_TO_V10_SQL = String.raw`
ALTER TABLE protected_entry_fill_heads
    ADD COLUMN formal_protection_json TEXT;
ALTER TABLE protected_entry_fill_heads
    ADD COLUMN formal_protection_hash TEXT;
CREATE TRIGGER trg_protected_entry_fill_formal_pair_insert
BEFORE INSERT ON protected_entry_fill_heads
WHEN (NEW.formal_protection_json IS NULL) !=
     (NEW.formal_protection_hash IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'formal protection projection must be paired');
END;
CREATE TRIGGER trg_protected_entry_fill_formal_pair_update
BEFORE UPDATE OF formal_protection_json, formal_protection_hash
ON protected_entry_fill_heads
WHEN (NEW.formal_protection_json IS NULL) !=
     (NEW.formal_protection_hash IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'formal protection projection must be paired');
END;
`;

export const SMART_ORDER_SCHEMA_V10_TO_V11_SQL = String.raw`
CREATE TABLE relinquished_unknown_exposures (
    exposure_id TEXT PRIMARY KEY NOT NULL,
    blocker_id TEXT NOT NULL UNIQUE REFERENCES safety_blockers(blocker_id),
    resolution_case_id TEXT NOT NULL REFERENCES resolution_cases(resolution_case_id),
    operation_kind TEXT NOT NULL CHECK (operation_kind IN ('place','update','cancel')),
    intent_lineage_json TEXT NOT NULL,
    intent_lineage_hash TEXT NOT NULL,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Buy','Sell')),
    position_lineage_id TEXT NOT NULL,
    scope_members_json TEXT NOT NULL,
    scope_members_hash TEXT NOT NULL,
    worst_case_position_delta_shares INTEGER NOT NULL
        CHECK (worst_case_position_delta_shares >= 0),
    possibly_working_shares INTEGER NOT NULL
        CHECK (possibly_working_shares >= 0),
    pnl_uncertainty INTEGER NOT NULL CHECK (pnl_uncertainty=1),
    claim_uncertainty_count INTEGER NOT NULL
        CHECK (claim_uncertainty_count >= 0),
    evidence_snapshot_hash TEXT NOT NULL,
    first_confirmation_hash TEXT NOT NULL,
    second_confirmation_hash TEXT NOT NULL,
    actor_kind TEXT NOT NULL CHECK (actor_kind='interactive_user'),
    created_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V11_TO_V12_SQL = String.raw`
CREATE TABLE canonical_pnl_deals (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    realized_minor_units INTEGER NOT NULL,
    fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
    transaction_tax_minor_units INTEGER NOT NULL CHECK (transaction_tax_minor_units >= 0),
    source_snapshot_hash TEXT NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date, deal_id)
) STRICT;
CREATE TABLE canonical_pnl_account_heads (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_definition_hash TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    api_generation TEXT NOT NULL,
    account_set_revision TEXT NOT NULL,
    deal_ledger_hash TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    event_stream_watermark_hash TEXT NOT NULL,
    realized_minor_units INTEGER NOT NULL,
    unrealized_minor_units INTEGER NOT NULL,
    fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
    transaction_tax_minor_units INTEGER NOT NULL CHECK (transaction_tax_minor_units >= 0),
    net_minor_units INTEGER NOT NULL,
    complete_components INTEGER NOT NULL CHECK (complete_components=1),
    includes_pre_runtime_activity INTEGER NOT NULL CHECK (includes_pre_runtime_activity=1),
    includes_external_client_activity INTEGER NOT NULL CHECK (includes_external_client_activity=1),
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    valid_until_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date),
    CHECK (valid_until_epoch_ms = as_of_epoch_ms + 5000)
) STRICT;
CREATE TABLE canonical_pnl_identity_heads (
    identity_group_id TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_definition_hash TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    api_generation TEXT NOT NULL,
    account_set_revision TEXT NOT NULL,
    account_set_hash TEXT NOT NULL,
    expected_account_count INTEGER NOT NULL CHECK (expected_account_count >= 1),
    observed_account_count INTEGER NOT NULL,
    deal_ledger_hash TEXT NOT NULL,
    source_evidence_hash TEXT NOT NULL,
    event_stream_watermark_hash TEXT NOT NULL,
    realized_minor_units INTEGER NOT NULL,
    unrealized_minor_units INTEGER NOT NULL,
    fee_minor_units INTEGER NOT NULL CHECK (fee_minor_units >= 0),
    transaction_tax_minor_units INTEGER NOT NULL CHECK (transaction_tax_minor_units >= 0),
    net_minor_units INTEGER NOT NULL,
    all_accounts_reconciled INTEGER NOT NULL CHECK (all_accounts_reconciled=1),
    identity_mapping_ready INTEGER NOT NULL CHECK (identity_mapping_ready=1),
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    valid_until_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(identity_group_id, trade_date),
    CHECK (observed_account_count = expected_account_count),
    CHECK (valid_until_epoch_ms = as_of_epoch_ms + 5000)
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V12_TO_V13_SQL = String.raw`
CREATE TABLE runtime_risk_policies (
    singleton_id TEXT PRIMARY KEY NOT NULL CHECK (singleton_id='current'),
    policy_revision TEXT NOT NULL UNIQUE,
    policy_hash TEXT NOT NULL,
    execution_policy_hash TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    api_generation TEXT NOT NULL,
    published_at_epoch_ms INTEGER NOT NULL CHECK (published_at_epoch_ms >= 0),
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
ALTER TABLE account_reconciliation_heads
    ADD COLUMN exposure_baseline_quantity_shares INTEGER NOT NULL DEFAULT 0
        CHECK (exposure_baseline_quantity_shares >= 0);
ALTER TABLE account_reconciliation_heads
    ADD COLUMN exposure_baseline_notional_minor_units INTEGER NOT NULL DEFAULT 0
        CHECK (exposure_baseline_notional_minor_units >= 0);
ALTER TABLE account_reconciliation_heads
    ADD COLUMN exposure_baseline_cash_minor_units INTEGER NOT NULL DEFAULT 0
        CHECK (exposure_baseline_cash_minor_units >= 0);
ALTER TABLE account_reconciliation_heads
    ADD COLUMN exposure_baseline_position_shares INTEGER NOT NULL DEFAULT 0
        CHECK (exposure_baseline_position_shares >= 0);
ALTER TABLE account_reconciliation_heads
    ADD COLUMN exposure_baseline_order_count INTEGER NOT NULL DEFAULT 0
        CHECK (exposure_baseline_order_count >= 0);
ALTER TABLE account_reconciliation_heads
    ADD COLUMN exposure_baseline_valuation_complete INTEGER NOT NULL DEFAULT 0
        CHECK (exposure_baseline_valuation_complete IN (0, 1));
DELETE FROM exposure_account_arbiter_heads;
DELETE FROM exposure_identity_arbiter_heads;
`;

export const SMART_ORDER_SCHEMA_V13_TO_V14_SQL = String.raw`
CREATE TABLE entry_exposure_reservations_v14 (
    reservation_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    intent_id TEXT REFERENCES order_intents(intent_id),
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    identity_group_id TEXT NOT NULL,
    policy_revision TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'reserved', 'partially_consumed', 'unknown', 'consumed', 'released'
    )),
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares >= 0),
    notional_minor_units INTEGER NOT NULL CHECK (notional_minor_units >= 0),
    cash_minor_units INTEGER NOT NULL CHECK (cash_minor_units >= 0),
    position_shares INTEGER NOT NULL CHECK (position_shares >= 0),
    order_count INTEGER NOT NULL CHECK (order_count >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
INSERT INTO entry_exposure_reservations_v14(
    reservation_id, strategy_id, intent_id, account_broker_ref,
    account_id_ref, identity_group_id, policy_revision, policy_hash,
    state, quantity_shares, notional_minor_units, cash_minor_units,
    position_shares, order_count, created_at_epoch_ms,
    updated_at_epoch_ms, terminal_at_epoch_ms, revision
)
SELECT reservation_id, strategy_id, intent_id, account_broker_ref,
       account_id_ref, identity_group_id, policy_revision, policy_hash,
       CASE state
           WHEN 'dispatching' THEN 'reserved'
           WHEN 'working' THEN 'partially_consumed'
           ELSE state
       END,
       quantity_shares, notional_minor_units, cash_minor_units,
       position_shares, order_count, created_at_epoch_ms,
       updated_at_epoch_ms, terminal_at_epoch_ms, revision
  FROM entry_exposure_reservations;
DROP TABLE entry_exposure_reservations;
ALTER TABLE entry_exposure_reservations_v14
    RENAME TO entry_exposure_reservations;
`;

export const SMART_ORDER_SCHEMA_V14_TO_V15_SQL = String.raw`
CREATE TABLE protection_groups (
    protection_group_id TEXT PRIMARY KEY NOT NULL,
    obligation_id TEXT NOT NULL UNIQUE
        REFERENCES protection_obligations(obligation_id) ON DELETE CASCADE,
    exit_claim_id TEXT NOT NULL UNIQUE
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'monitoring', 'winner_selected', 'broker_working',
        'rearm_required', 'fulfilled', 'unknown'
    )),
    current_generation INTEGER NOT NULL CHECK (current_generation >= 0),
    plan_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
CREATE TABLE protection_remainder_generations (
    protection_group_id TEXT NOT NULL
        REFERENCES protection_groups(protection_group_id) ON DELETE CASCADE,
    remainder_generation INTEGER NOT NULL CHECK (remainder_generation >= 0),
    exit_claim_id TEXT NOT NULL
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'monitoring', 'winner_selected', 'broker_working',
        'rearm_required', 'terminal', 'unknown'
    )),
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares > 0),
    winner_leg_id TEXT,
    winner_activation_id TEXT REFERENCES activations(activation_id),
    winner_intent_id TEXT REFERENCES order_intents(intent_id),
    evidence_hash TEXT NOT NULL,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    terminal_at_epoch_ms INTEGER,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(protection_group_id, remainder_generation),
    UNIQUE(exit_claim_id, remainder_generation),
    CHECK (
        state='unknown' OR
        (state IN ('monitoring','rearm_required') AND
            winner_leg_id IS NULL AND winner_activation_id IS NULL AND
            winner_intent_id IS NULL) OR
        (state IN ('winner_selected','broker_working','terminal') AND
            winner_leg_id IS NOT NULL AND winner_activation_id IS NOT NULL AND
            winner_intent_id IS NOT NULL)
    )
) STRICT;
CREATE TABLE protection_leg_evaluations (
    protection_group_id TEXT NOT NULL,
    remainder_generation INTEGER NOT NULL,
    leg_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('winner','suppressed')),
    active_dispatch_slot INTEGER CHECK (active_dispatch_slot=1),
    activation_id TEXT REFERENCES activations(activation_id),
    intent_id TEXT REFERENCES order_intents(intent_id),
    evidence_hash TEXT NOT NULL,
    broker_authority INTEGER NOT NULL DEFAULT 0 CHECK (broker_authority=0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(protection_group_id, remainder_generation, leg_id),
    FOREIGN KEY(protection_group_id, remainder_generation)
        REFERENCES protection_remainder_generations(
            protection_group_id, remainder_generation
        ) ON DELETE CASCADE,
    CHECK (
        (state='winner' AND active_dispatch_slot=1 AND
            activation_id IS NOT NULL AND intent_id IS NOT NULL) OR
        (state='suppressed' AND active_dispatch_slot IS NULL AND
            activation_id IS NULL AND intent_id IS NULL)
    )
) STRICT;
CREATE UNIQUE INDEX idx_protection_leg_active_dispatch
    ON protection_leg_evaluations(
        protection_group_id, remainder_generation, active_dispatch_slot
    ) WHERE active_dispatch_slot=1;
CREATE UNIQUE INDEX idx_protection_leg_winner_intent
    ON protection_leg_evaluations(intent_id) WHERE intent_id IS NOT NULL;
`;

export const SMART_ORDER_SCHEMA_V15_TO_V16_SQL = String.raw`
CREATE TABLE IF NOT EXISTS account_reconciliation_positions (
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    account_head_revision INTEGER NOT NULL CHECK (account_head_revision >= 0),
    source_revision TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    position_lineage_id TEXT NOT NULL,
    quantity_shares INTEGER NOT NULL CHECK (quantity_shares > 0),
    available_shares INTEGER NOT NULL CHECK (
        available_shares >= 0 AND available_shares <= quantity_shares
    ),
    average_cost_state TEXT NOT NULL CHECK (
        average_cost_state IN ('available', 'unavailable')
    ),
    average_price_minor_units INTEGER,
    average_cost_reason TEXT,
    as_of_epoch_ms INTEGER NOT NULL CHECK (as_of_epoch_ms >= 0),
    valid_until_epoch_ms INTEGER NOT NULL CHECK (
        valid_until_epoch_ms > as_of_epoch_ms
    ),
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(account_broker_ref, account_id_ref, trade_date, contract_key),
    CHECK (
        (average_cost_state='available' AND
            average_price_minor_units IS NOT NULL AND
            average_price_minor_units > 0 AND average_cost_reason IS NULL) OR
        (average_cost_state='unavailable' AND
            average_price_minor_units IS NULL AND
            average_cost_reason IS NOT NULL)
    )
) STRICT;
CREATE TABLE IF NOT EXISTS canonical_confirmation_snapshots (
    confirmation_id TEXT PRIMARY KEY NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    state TEXT NOT NULL CHECK (state IN ('previewed', 'accepted', 'superseded')),
    snapshot_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    strategy_revision INTEGER NOT NULL CHECK (strategy_revision >= 0),
    definition_hash TEXT NOT NULL,
    account_broker_ref TEXT NOT NULL,
    account_id_ref TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    account_head_revision INTEGER NOT NULL CHECK (account_head_revision >= 0),
    position_lineage_id TEXT NOT NULL,
    position_evidence_hash TEXT NOT NULL,
    contract_evidence_hash TEXT NOT NULL,
    contract_revision TEXT NOT NULL,
    corporate_action_revision TEXT NOT NULL,
    gate_manifest_revision TEXT NOT NULL,
    gate_manifest_hash TEXT NOT NULL,
    risk_revision TEXT NOT NULL,
    risk_hash TEXT NOT NULL,
    runtime_epoch_id TEXT NOT NULL REFERENCES runtime_epochs(runtime_epoch_id),
    sender_fence TEXT NOT NULL,
    api_generation TEXT NOT NULL,
    runtime_revision INTEGER NOT NULL CHECK (runtime_revision >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    valid_until_epoch_ms INTEGER NOT NULL,
    accepted_at_epoch_ms INTEGER,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (state='previewed' AND accepted_at_epoch_ms IS NULL) OR
        (state='accepted' AND accepted_at_epoch_ms IS NOT NULL) OR
        state='superseded'
    )
) STRICT;
CREATE INDEX IF NOT EXISTS idx_canonical_confirmation_strategy
    ON canonical_confirmation_snapshots(strategy_id, state, updated_at_epoch_ms);
`;

export const SMART_ORDER_SCHEMA_V16_TO_V17_SQL = String.raw`
CREATE TABLE IF NOT EXISTS protection_trigger_heads (
    protection_group_id TEXT NOT NULL,
    remainder_generation INTEGER NOT NULL CHECK (remainder_generation >= 0),
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id),
    family TEXT NOT NULL CHECK (family IN ('fixed','trailing')),
    state TEXT NOT NULL CHECK (state IN (
        'monitoring','pending_activation','active','triggered'
    )),
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (
        last_receive_epoch_ms >= last_exchange_epoch_ms
    ),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_price_decimal TEXT NOT NULL,
    saved_high_decimal TEXT,
    saved_high_observation_id TEXT REFERENCES observations(observation_id),
    retracement_trigger_decimal TEXT,
    triggered_leg_id TEXT,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(protection_group_id, remainder_generation),
    FOREIGN KEY(protection_group_id, remainder_generation)
        REFERENCES protection_remainder_generations(
            protection_group_id, remainder_generation
        ) ON DELETE CASCADE,
    CHECK (
        (family='fixed' AND state IN ('monitoring','triggered') AND
            saved_high_decimal IS NULL AND saved_high_observation_id IS NULL AND
            retracement_trigger_decimal IS NULL) OR
        (family='trailing' AND state='pending_activation' AND
            saved_high_decimal IS NULL AND saved_high_observation_id IS NULL AND
            retracement_trigger_decimal IS NULL) OR
        (family='trailing' AND state='active' AND
            saved_high_decimal IS NOT NULL AND saved_high_observation_id IS NOT NULL AND
            retracement_trigger_decimal IS NOT NULL) OR
        (family='trailing' AND state='triggered' AND (
            (saved_high_decimal IS NULL AND saved_high_observation_id IS NULL AND
                retracement_trigger_decimal IS NULL) OR
            (saved_high_decimal IS NOT NULL AND saved_high_observation_id IS NOT NULL AND
                retracement_trigger_decimal IS NOT NULL)
        ))
    ),
    CHECK (
        (state='triggered' AND triggered_leg_id IS NOT NULL) OR
        (state<>'triggered' AND triggered_leg_id IS NULL)
    )
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V17_TO_V18_SQL = String.raw`
CREATE TABLE IF NOT EXISTS quick_condition_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'waiting_for_false','ready_after_false','true_latched','triggered'
    )),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN (
        'require_rearm','immediate_if_true'
    )),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (
        last_receive_epoch_ms >= last_exchange_epoch_ms
    ),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (state='triggered' AND activation_id IS NOT NULL) OR
        (state<>'triggered' AND activation_id IS NULL)
    )
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V18_TO_V19_SQL = String.raw`
CREATE TABLE IF NOT EXISTS existing_position_protection_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    obligation_id TEXT NOT NULL UNIQUE
        REFERENCES protection_obligations(obligation_id) ON DELETE CASCADE,
    exit_claim_id TEXT NOT NULL UNIQUE
        REFERENCES exit_claims(exit_claim_id) ON DELETE CASCADE,
    trade_date TEXT NOT NULL,
    protection_plan_json TEXT NOT NULL,
    protection_plan_hash TEXT NOT NULL,
    formal_protection_json TEXT NOT NULL,
    formal_protection_hash TEXT NOT NULL,
    reconciliation_evidence_hash TEXT NOT NULL,
    reconciliation_as_of_epoch_ms INTEGER NOT NULL
        CHECK (reconciliation_as_of_epoch_ms >= 0),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V19_TO_V20_SQL = String.raw`
CREATE TABLE IF NOT EXISTS good_till_progress_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id)
        ON DELETE CASCADE,
    target_shares INTEGER NOT NULL CHECK (target_shares > 0),
    confirmed_filled_shares INTEGER NOT NULL
        CHECK (confirmed_filled_shares >= 0 AND confirmed_filled_shares <= target_shares),
    remaining_target_shares INTEGER NOT NULL
        CHECK (remaining_target_shares = target_shares - confirmed_filled_shares),
    daily_state TEXT NOT NULL CHECK (daily_state IN (
        'waiting','intent_prepared','working','terminal_consumed',
        'unknown_blocked','completed'
    )),
    active_trade_date TEXT,
    active_activation_id TEXT REFERENCES activations(activation_id),
    active_intent_id TEXT REFERENCES order_intents(intent_id),
    active_accounted_filled_shares INTEGER NOT NULL
        CHECK (active_accounted_filled_shares >= 0),
    last_reconciliation_hash TEXT,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (
        (daily_state IN ('waiting','completed') AND active_activation_id IS NULL
            AND active_intent_id IS NULL AND active_accounted_filled_shares=0) OR
        (daily_state NOT IN ('waiting','completed') AND active_trade_date IS NOT NULL
            AND active_activation_id IS NOT NULL AND active_intent_id IS NOT NULL)
    )
) STRICT;
CREATE TABLE IF NOT EXISTS good_till_condition_heads (
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    trade_date TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'waiting_for_false','ready_after_false','true_latched','triggered'
    )),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN (
        'require_rearm','immediate_if_true'
    )),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (last_receive_epoch_ms >= last_exchange_epoch_ms),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(strategy_id, trade_date),
    CHECK ((state='triggered' AND activation_id IS NOT NULL) OR
           (state<>'triggered' AND activation_id IS NULL))
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V20_TO_V21_SQL = String.raw`
CREATE TABLE IF NOT EXISTS multi_condition_group_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('waiting_for_false','ready_after_false','true_latched','triggered')),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN ('require_rearm','immediate_if_true')),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    operator TEXT NOT NULL CHECK (operator IN ('AND','OR')),
    condition_count INTEGER NOT NULL CHECK (condition_count BETWEEN 1 AND 7),
    definition_hash TEXT NOT NULL,
    last_trade_date TEXT,
    last_stream_epoch TEXT,
    last_evaluation_hash TEXT,
    last_condition_true INTEGER CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK ((state='triggered' AND activation_id IS NOT NULL) OR
           (state<>'triggered' AND activation_id IS NULL))
) STRICT;
CREATE TABLE IF NOT EXISTS multi_condition_leg_heads (
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    condition_index INTEGER NOT NULL CHECK (condition_index BETWEEN 0 AND 6),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    monitor_contract_key TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (last_receive_epoch_ms >= last_exchange_epoch_ms),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(strategy_id, condition_index)
) STRICT;
`;

export const SMART_ORDER_SCHEMA_V21_TO_V22_SQL = String.raw`
CREATE TABLE IF NOT EXISTS parent_child_progress_heads (
    strategy_id TEXT PRIMARY KEY NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('waiting_parent','parent_intent_prepared','parent_working','child_monitoring','child_intent_prepared','child_working','completed','expired','expired_with_obligation','manual_intervention')),
    parent_activation_trade_date TEXT,
    parent_activation_id TEXT REFERENCES activations(activation_id),
    parent_intent_id TEXT REFERENCES order_intents(intent_id),
    parent_settlement_hash TEXT,
    child_activation_trade_date TEXT,
    child_quantity_shares INTEGER CHECK (child_quantity_shares > 0),
    child_position_lineage_id TEXT,
    child_obligation_id TEXT REFERENCES protection_obligations(obligation_id),
    child_exit_claim_id TEXT REFERENCES exit_claims(exit_claim_id),
    child_protection_group_id TEXT REFERENCES protection_groups(protection_group_id),
    child_activation_id TEXT REFERENCES activations(activation_id),
    child_intent_id TEXT REFERENCES order_intents(intent_id),
    child_settlement_hash TEXT,
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK ((state IN ('waiting_parent','expired') AND parent_activation_trade_date IS NULL AND parent_activation_id IS NULL AND parent_intent_id IS NULL AND child_activation_trade_date IS NULL AND child_quantity_shares IS NULL AND child_position_lineage_id IS NULL AND child_obligation_id IS NULL AND child_exit_claim_id IS NULL AND child_protection_group_id IS NULL AND child_activation_id IS NULL AND child_intent_id IS NULL) OR (state IN ('parent_intent_prepared','parent_working') AND parent_activation_trade_date IS NOT NULL AND parent_activation_id IS NOT NULL AND parent_intent_id IS NOT NULL AND child_activation_trade_date IS NULL AND child_quantity_shares IS NULL AND child_position_lineage_id IS NULL AND child_obligation_id IS NULL AND child_exit_claim_id IS NULL AND child_protection_group_id IS NULL AND child_activation_id IS NULL AND child_intent_id IS NULL) OR (state IN ('child_monitoring','child_intent_prepared','child_working','completed','expired_with_obligation') AND parent_activation_trade_date IS NOT NULL AND parent_activation_id IS NOT NULL AND parent_intent_id IS NOT NULL AND parent_settlement_hash IS NOT NULL AND child_activation_trade_date IS NOT NULL AND child_quantity_shares IS NOT NULL AND child_position_lineage_id IS NOT NULL AND child_obligation_id IS NOT NULL AND child_exit_claim_id IS NOT NULL AND child_protection_group_id IS NOT NULL AND (state IN ('child_monitoring','expired_with_obligation') OR (child_activation_id IS NOT NULL AND child_intent_id IS NOT NULL))) OR state='manual_intervention')
) STRICT;
CREATE TABLE IF NOT EXISTS parent_child_condition_heads (
    strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
    leg_kind TEXT NOT NULL CHECK (leg_kind IN ('parent','child')),
    state TEXT NOT NULL CHECK (state IN ('waiting_for_false','ready_after_false','true_latched','triggered')),
    activation_policy TEXT NOT NULL CHECK (activation_policy IN ('require_rearm','immediate_if_true')),
    arm_strategy_revision INTEGER NOT NULL CHECK (arm_strategy_revision >= 0),
    trade_date TEXT NOT NULL,
    stream_epoch TEXT NOT NULL,
    field_name TEXT NOT NULL,
    comparator TEXT NOT NULL CHECK (comparator IN ('gte','lte')),
    threshold_decimal TEXT NOT NULL,
    local_unit TEXT NOT NULL,
    mapping_revision TEXT NOT NULL,
    mapping_definition_hash TEXT NOT NULL,
    last_observation_id TEXT NOT NULL REFERENCES observations(observation_id),
    last_exchange_epoch_ms INTEGER NOT NULL CHECK (last_exchange_epoch_ms >= 0),
    last_receive_epoch_ms INTEGER NOT NULL CHECK (last_receive_epoch_ms >= last_exchange_epoch_ms),
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    last_value_decimal TEXT NOT NULL,
    last_condition_true INTEGER NOT NULL CHECK (last_condition_true IN (0,1)),
    activation_id TEXT REFERENCES activations(activation_id),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY(strategy_id, leg_kind),
    CHECK ((state='triggered' AND activation_id IS NOT NULL) OR (state<>'triggered' AND activation_id IS NULL))
) STRICT;
`;

export const REQUIRED_SMART_ORDER_TABLES = Object.freeze([
    'repository_meta',
    'runtime_epochs',
    'strategies',
    'activations',
    'order_intents',
    'broker_orders',
    'broker_correlations',
    'broker_correlation_identifiers',
    'broker_event_records',
    'broker_event_heads',
    'intent_rearm_authorizations',
    'pending_protection_commitments',
    'protection_obligations',
    'entry_exposure_reservations',
    'runtime_risk_policies',
    'exposure_identity_arbiter_heads',
    'exposure_account_arbiter_heads',
    'external_sell_visibility_heads',
    'account_reconciliation_heads',
    'account_reconciliation_positions',
    'canonical_confirmation_snapshots',
    'canonical_pnl_deals',
    'canonical_pnl_account_heads',
    'canonical_pnl_identity_heads',
    'exit_claims',
    'protection_groups',
    'existing_position_protection_heads',
    'protection_remainder_generations',
    'protection_leg_evaluations',
    'exit_claim_visibility_bindings',
    'protected_entry_fill_heads',
    'observations',
    'protection_trigger_heads',
    'quick_condition_heads',
    'good_till_progress_heads',
    'good_till_condition_heads',
    'multi_condition_group_heads',
    'multi_condition_leg_heads',
    'parent_child_progress_heads',
    'parent_child_condition_heads',
    'resolution_cases',
    'safety_blockers',
    'relinquished_unknown_exposures',
    'event_journal',
    'gate_manifests',
    'authority_consumptions',
    'request_replays',
]);
