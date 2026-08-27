import { describe, expect, it } from 'vitest';
import {
    parentChildBrokerTerminalIsExactFullFill,
    parentChildChildWindowClosed,
    parentChildIntentDispatchWindowOpen,
    parentChildParentWindowClosed,
} from './parent-child-policy.mjs';

describe('parent-child production policy', () => {
    it('keeps the final parent day open through 13:30 and closes it afterwards', () => {
        expect(
            parentChildParentWindowClosed({
                parentEndDate: '2026-08-21',
                tradeDate: '2026-08-21',
                wallTime: '13:30:00',
            }),
        ).toBe(false);
        expect(
            parentChildParentWindowClosed({
                parentEndDate: '2026-08-21',
                tradeDate: '2026-08-21',
                wallTime: '13:30:01',
            }),
        ).toBe(true);
        expect(
            parentChildParentWindowClosed({
                parentEndDate: '2026-08-21',
                tradeDate: '2026-08-22',
                wallTime: '09:00:00',
            }),
        ).toBe(true);
    });

    it('ends child monitoring after its cutoff or on any different trade date', () => {
        expect(
            parentChildChildWindowClosed({
                activationTradeDate: '2026-08-21',
                cutoffTime: '13:30:00',
                tradeDate: '2026-08-21',
                wallTime: '13:30:00',
            }),
        ).toBe(false);
        expect(
            parentChildChildWindowClosed({
                activationTradeDate: '2026-08-21',
                cutoffTime: '13:30:00',
                tradeDate: '2026-08-21',
                wallTime: '13:30:01',
            }),
        ).toBe(true);
        expect(
            parentChildChildWindowClosed({
                activationTradeDate: '2026-08-21',
                cutoffTime: '13:30:00',
                tradeDate: '2026-08-22',
                wallTime: '09:00:00',
            }),
        ).toBe(true);
    });

    it('accepts only an exact broker-confirmed full fill', () => {
        const exact = {
            brokerStatus: 'Filled',
            cancelledShares: 0,
            expectedOrderShares: 1_000,
            filledShares: 1_000,
            orderShares: 1_000,
            remainingShares: 0,
        };
        expect(parentChildBrokerTerminalIsExactFullFill(exact)).toBe(true);
        expect(
            parentChildBrokerTerminalIsExactFullFill({
                ...exact,
                brokerStatus: 'Submitted',
            }),
        ).toBe(false);
        expect(
            parentChildBrokerTerminalIsExactFullFill({
                ...exact,
                filledShares: 500,
                remainingShares: 500,
            }),
        ).toBe(false);
        expect(
            parentChildBrokerTerminalIsExactFullFill({
                ...exact,
                cancelledShares: 500,
                filledShares: 500,
            }),
        ).toBe(false);
        expect(
            parentChildBrokerTerminalIsExactFullFill({
                ...exact,
                expectedOrderShares: 500,
            }),
        ).toBe(false);
    });

    it('closes both dispatch crash windows when trusted time crosses the leg deadline', () => {
        const parent = {
            activationTradeDate: '2026-08-21',
            childCutoffTime: '13:30:00',
            leg: 'parent',
            parentStartDate: '2026-08-11',
            parentEndDate: '2026-08-21',
            tradeDate: '2026-08-21',
        };
        expect(
            parentChildIntentDispatchWindowOpen({
                ...parent,
                wallTime: '13:30:00',
            }),
        ).toBe(true);
        expect(
            parentChildIntentDispatchWindowOpen({
                ...parent,
                wallTime: '13:30:01',
            }),
        ).toBe(false);

        const child = {
            ...parent,
            leg: 'child',
            tradeDate: '2026-08-21',
        };
        expect(
            parentChildIntentDispatchWindowOpen({
                ...child,
                wallTime: '13:30:00',
            }),
        ).toBe(true);
        expect(
            parentChildIntentDispatchWindowOpen({
                ...child,
                wallTime: '13:30:01',
            }),
        ).toBe(false);
        expect(
            parentChildIntentDispatchWindowOpen({
                ...child,
                tradeDate: '2026-08-22',
                wallTime: '09:00:00',
            }),
        ).toBe(false);
    });
});
