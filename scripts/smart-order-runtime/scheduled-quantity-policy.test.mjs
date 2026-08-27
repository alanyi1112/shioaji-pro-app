import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_SCHEDULED_QUANTITY_POLICY,
    scheduledQuantityModeDecision,
} from './scheduled-quantity-policy.mjs';

describe('scheduled quantity disabled policy', () => {
    it('keeps timed and quantity algorithms separately disabled without producing slots', () => {
        expect(scheduledQuantityModeDecision('timed')).toEqual({
            mode: 'timed',
            state: 'disabled_unverified',
            blocker: 'timed_split_algorithm_unverified',
            slotsProduced: false,
            brokerIntentAllowed: false,
        });
        expect(scheduledQuantityModeDecision('quantity')).toEqual({
            mode: 'quantity',
            state: 'disabled_unverified',
            blocker: 'quantity_remainder_algorithm_unverified',
            slotsProduced: false,
            brokerIntentAllowed: false,
        });
        expect(SMART_ORDER_SCHEDULED_QUANTITY_POLICY).toMatchObject({
            scope: {
                singleContractOnly: true,
                sameTradingDateOnly: true,
            },
            execution: {
                previousWorkingOrUnknownMayOverlap: false,
                missedSlotCatchUpAllowed: false,
                closeRemainderMarketOrderAllowed: false,
                nextTradingDateCarryAllowed: false,
            },
            confirmationAllowed: false,
            activationAllowed: false,
            quoteDemandAllowed: false,
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
    });

    it('fails closed for an invented mode', () => {
        expect(() => scheduledQuantityModeDecision('adaptive')).toThrow(
            /unsupported/,
        );
    });
});
