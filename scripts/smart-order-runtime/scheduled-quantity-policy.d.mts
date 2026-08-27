export type SmartOrderScheduledQuantityMode = 'timed' | 'quantity';

export type SmartOrderScheduledQuantityModeDecision = Readonly<{
    mode: SmartOrderScheduledQuantityMode;
    state: 'disabled_unverified';
    blocker:
        | 'timed_split_algorithm_unverified'
        | 'quantity_remainder_algorithm_unverified';
    slotsProduced: false;
    brokerIntentAllowed: false;
}>;

export const SMART_ORDER_SCHEDULED_QUANTITY_POLICY_SCHEMA_VERSION:
    'smart-order-scheduled-quantity-policy/2026-08-21.1';

export const SMART_ORDER_SCHEDULED_QUANTITY_DECISION_TABLE_VERSION:
    'official-smart-order-decision-tables/2026-08-11.2';

export const SMART_ORDER_SCHEDULED_QUANTITY_POLICY: Readonly<{
    schemaVersion: typeof SMART_ORDER_SCHEDULED_QUANTITY_POLICY_SCHEMA_VERSION;
    decisionTableVersion: typeof SMART_ORDER_SCHEDULED_QUANTITY_DECISION_TABLE_VERSION;
    scope: Readonly<{
        singleContractOnly: true;
        sameTradingDateOnly: true;
    }>;
    execution: Readonly<{
        previousWorkingOrUnknownMayOverlap: false;
        missedSlotCatchUpAllowed: false;
        closeRemainderMarketOrderAllowed: false;
        nextTradingDateCarryAllowed: false;
    }>;
    modes: Readonly<{
        timed: SmartOrderScheduledQuantityModeDecision;
        quantity: SmartOrderScheduledQuantityModeDecision;
    }>;
    confirmationAllowed: false;
    activationAllowed: false;
    quoteDemandAllowed: false;
    brokerWriteAuthority: false;
    writeMasterAuthority: false;
}>;

export function scheduledQuantityModeDecision(
    mode: SmartOrderScheduledQuantityMode,
): SmartOrderScheduledQuantityModeDecision;
