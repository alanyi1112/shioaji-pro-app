import { describe, expect, it } from 'vitest';
import { projectGoodTillReconciliationSettlement } from './good-till-settlement-policy.mjs';

function settlement(overrides = {}) {
    return {
        brokerStatus: 'Cancelled',
        cancelledShares: 500,
        confirmedFilledSharesBefore: 0,
        filledShares: 500,
        intentState: 'acknowledged',
        orderShares: 1_000,
        remainingShares: 0,
        targetShares: 3_000,
        timeInForce: 'IOC',
        ...overrides,
    };
}

describe('good-till terminal reconciliation policy', () => {
    it.each([
        ['IOC', 'Cancelled', 0, 1_000, 0, 3_000, 'released'],
        ['IOC', 'Cancelled', 500, 500, 500, 2_500, 'consumed'],
        ['ROD', 'Inactive', 0, 1_000, 0, 3_000, 'released'],
        ['ROD', 'Failed', 250, 750, 250, 2_750, 'consumed'],
        ['ROD', 'Filled', 1_000, 0, 1_000, 0, 'consumed'],
    ])(
        '%s %s consumes the day, counts only confirmed fills, and never retries',
        (
            timeInForce,
            brokerStatus,
            filledShares,
            cancelledShares,
            expectedFilled,
            expectedRemaining,
            reservationState,
        ) => {
            const confirmedFilledSharesBefore =
                brokerStatus === 'Filled' ? 2_000 : 0;
            expect(
                projectGoodTillReconciliationSettlement(
                    settlement({
                        brokerStatus,
                        cancelledShares,
                        confirmedFilledSharesBefore,
                        filledShares,
                        timeInForce,
                    }),
                ),
            ).toMatchObject({
                terminal: true,
                dayActivationConsumed: true,
                automaticRetryAllowed: false,
                confirmedFilledShares:
                    confirmedFilledSharesBefore + expectedFilled,
                remainingTargetShares: expectedRemaining,
                reservationState,
            });
        },
    );

    it.each([
        ['PartFilled', 'acknowledged', 'working'],
        ['Submitted', 'unknown', 'unknown_blocked'],
        ['Accepted', 'reconciling', 'unknown_blocked'],
    ])(
        'keeps %s blocking the next day until terminal reconciliation',
        (brokerStatus, intentState, dailyState) => {
            expect(
                projectGoodTillReconciliationSettlement(
                    settlement({
                        brokerStatus,
                        cancelledShares: 0,
                        filledShares: 500,
                        intentState,
                        remainingShares: 500,
                        timeInForce: 'ROD',
                    }),
                ),
            ).toMatchObject({
                terminal: false,
                dailyState,
                dayActivationConsumed: true,
                automaticRetryAllowed: false,
                confirmedFilledShares: 0,
            });
        },
    );

    it('rejects incomplete terminal evidence and hostile structural input', () => {
        expect(() =>
            projectGoodTillReconciliationSettlement(
                settlement({ remainingShares: 1 }),
            ),
        ).toThrow(/quantity|incomplete/);
        expect(() =>
            projectGoodTillReconciliationSettlement(
                new Proxy(settlement(), {}),
            ),
        ).toThrow(/Proxy/);
        const accessor = settlement();
        Object.defineProperty(accessor, 'filledShares', {
            enumerable: true,
            get: () => 500,
        });
        expect(() =>
            projectGoodTillReconciliationSettlement(accessor),
        ).toThrow(/own data/);
    });
});
