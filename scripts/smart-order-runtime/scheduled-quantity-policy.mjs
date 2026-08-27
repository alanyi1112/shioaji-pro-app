export const SMART_ORDER_SCHEDULED_QUANTITY_POLICY_SCHEMA_VERSION =
    'smart-order-scheduled-quantity-policy/2026-08-21.1';

export const SMART_ORDER_SCHEDULED_QUANTITY_DECISION_TABLE_VERSION =
    'official-smart-order-decision-tables/2026-08-11.2';

const TIMED_DECISION = Object.freeze({
    mode: 'timed',
    state: 'disabled_unverified',
    blocker: 'timed_split_algorithm_unverified',
    slotsProduced: false,
    brokerIntentAllowed: false,
});

const QUANTITY_DECISION = Object.freeze({
    mode: 'quantity',
    state: 'disabled_unverified',
    blocker: 'quantity_remainder_algorithm_unverified',
    slotsProduced: false,
    brokerIntentAllowed: false,
});

export const SMART_ORDER_SCHEDULED_QUANTITY_POLICY = Object.freeze({
    schemaVersion: SMART_ORDER_SCHEDULED_QUANTITY_POLICY_SCHEMA_VERSION,
    decisionTableVersion:
        SMART_ORDER_SCHEDULED_QUANTITY_DECISION_TABLE_VERSION,
    scope: Object.freeze({
        singleContractOnly: true,
        sameTradingDateOnly: true,
    }),
    execution: Object.freeze({
        previousWorkingOrUnknownMayOverlap: false,
        missedSlotCatchUpAllowed: false,
        closeRemainderMarketOrderAllowed: false,
        nextTradingDateCarryAllowed: false,
    }),
    modes: Object.freeze({
        timed: TIMED_DECISION,
        quantity: QUANTITY_DECISION,
    }),
    confirmationAllowed: false,
    activationAllowed: false,
    quoteDemandAllowed: false,
    brokerWriteAuthority: false,
    writeMasterAuthority: false,
});

export function scheduledQuantityModeDecision(mode) {
    if (mode === 'timed') return TIMED_DECISION;
    if (mode === 'quantity') return QUANTITY_DECISION;
    throw new TypeError('scheduled quantity mode is unsupported');
}
