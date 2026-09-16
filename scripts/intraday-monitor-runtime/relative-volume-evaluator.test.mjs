import { describe, expect, it } from 'vitest';
import {
    INTRADAY_RELATIVE_VOLUME_FORMULA_VERSION,
    createIntradayRelativeVolumeTriggerLedger,
    evaluateIntradayRelativeVolume,
} from './relative-volume-evaluator.mjs';
import { isIntradayMonitorTriggerEvent } from '../../src/lib/intraday-relative-volume-monitor-domain.ts';

function input(overrides = {}) {
    return {
        admitted: true,
        tradeDate: '2026-09-04',
        baselineTradeDate: '2026-09-03',
        canonicalSymbol: '2330.TW',
        exchange: 'TSE',
        minuteKey: '10:05',
        configRevision: 7,
        threshold: '1.5',
        currentCumulativeVolume: 1_500,
        previousCumulativeVolume: 1_000,
        todayCompleteness: 'complete',
        baselineCompleteness: 'complete',
        calendarCurrent: true,
        sessionCurrent: true,
        generationCurrent: true,
        continuityComplete: true,
        unit: 'common_lot',
        sourceVersion: 'shioaji-tick-stk/1',
        observationMode: 'live',
        revisionFirstComparable: false,
        createdAt: '2026-09-04T10:06:00+08:00',
        ...overrides,
    };
}

describe('exact intraday relative-volume evaluation', () => {
    it('compares integer cumulative volumes against decimal hundredths without ratio rounding', () => {
        expect(evaluateIntradayRelativeVolume(input())).toMatchObject({
            classification: 'matched',
            exactComparison: {
                leftScaledCurrent: '150000',
                rightThresholdTimesPrevious: '150000',
                threshold: '1.5',
            },
            formulaVersion: INTRADAY_RELATIVE_VOLUME_FORMULA_VERSION,
        });
        expect(
            evaluateIntradayRelativeVolume(
                input({ currentCumulativeVolume: 1_499 }),
            ).classification,
        ).toBe('not_matched');
        expect(
            evaluateIntradayRelativeVolume(
                input({
                    threshold: '1.01',
                    currentCumulativeVolume: 101,
                    previousCumulativeVolume: 100,
                }),
            ).classification,
        ).toBe('matched');
    });

    it('uses BigInt-scaled comparison for safe-integer volumes near the numeric limit', () => {
        const previous = Number.MAX_SAFE_INTEGER - 10;
        const current = previous;
        const result = evaluateIntradayRelativeVolume(
            input({
                threshold: '1',
                currentCumulativeVolume: current,
                previousCumulativeVolume: previous,
            }),
        );
        expect(result.classification).toBe('matched');
        expect(result.exactComparison.leftScaledCurrent).toBe(
            (BigInt(current) * 100n).toString(),
        );
    });

    it.each([
        ['not admitted', { admitted: false }, 'not_admitted'],
        ['calendar', { calendarCurrent: false }, 'calendar_unverified'],
        ['session', { sessionCurrent: false }, 'session_unverified'],
        ['generation', { generationCurrent: false }, 'stale_generation'],
        ['continuity', { continuityComplete: false }, 'continuity_unproven'],
        [
            'today completeness',
            { todayCompleteness: 'incomplete' },
            'today_minute_incomplete',
        ],
        [
            'baseline completeness',
            { baselineCompleteness: 'missing' },
            'baseline_incomplete',
        ],
        [
            'zero denominator',
            { previousCumulativeVolume: 0 },
            'zero_denominator',
        ],
    ])('returns unknown for %s', (_label, overrides, reason) => {
        expect(evaluateIntradayRelativeVolume(input(overrides))).toMatchObject({
            classification: 'unknown',
            comparable: false,
            matched: false,
            reason,
        });
    });

    it('rejects noncanonical, negative, nonfinite, and unknown-unit inputs', () => {
        for (const overrides of [
            { threshold: '1.001' },
            { currentCumulativeVolume: -1 },
            { currentCumulativeVolume: Number.NaN },
            { unit: 'share' },
            { minuteKey: '08:59' },
        ]) {
            expect(evaluateIntradayRelativeVolume(input(overrides))).toMatchObject({
                classification: 'unknown',
                reason: 'evaluation_input_invalid',
            });
        }
    });
});

describe('immutable relative-volume trigger ledger', () => {
    it('creates one live event only on a verified not-matched to matched crossing', () => {
        const ledger = createIntradayRelativeVolumeTriggerLedger();
        expect(
            ledger.evaluate(
                input({
                    minuteKey: '10:04',
                    currentCumulativeVolume: 1_499,
                    createdAt: '2026-09-04T10:05:00+08:00',
                }),
            ).triggerEvent,
        ).toBeNull();
        const crossed = ledger.evaluate(input());
        expect(crossed).toMatchObject({
            classification: 'matched',
            newlyCreated: true,
            notificationEligible: true,
            triggerEvent: {
                kind: 'live',
                minuteKey: '10:05',
                threshold: '1.5',
                currentCumulativeVolume: 1_500,
                previousCumulativeVolume: 1_000,
                completeness: 'complete',
            },
        });
        expect(Object.isFrozen(crossed.triggerEvent)).toBe(true);
        expect(crossed.triggerEvent.eventId).toMatch(/^ivm_[a-f0-9]{64}$/);
        expect(crossed.triggerEvent.eventHash).toMatch(/^[a-f0-9]{64}$/);
        expect(isIntradayMonitorTriggerEvent(crossed.triggerEvent)).toBe(true);
    });

    it('retains the same event after ratio drops and on duplicate replay', () => {
        const ledger = createIntradayRelativeVolumeTriggerLedger();
        ledger.evaluate(
            input({ minuteKey: '10:04', currentCumulativeVolume: 1_400 }),
        );
        const first = ledger.evaluate(input()).triggerEvent;
        const dropped = ledger.evaluate(
            input({
                minuteKey: '10:06',
                currentCumulativeVolume: 1_300,
                createdAt: '2026-09-04T10:07:00+08:00',
            }),
        );
        const replay = ledger.evaluate(input());

        expect(dropped.triggerEvent).toBe(first);
        expect(replay.triggerEvent).toBe(first);
        expect(dropped.newlyCreated).toBe(false);
        expect(replay.notificationEligible).toBe(false);
        expect(ledger.getEvents()).toEqual([first]);
    });

    it('marks first comparable match after a revision change or historical replay as historical', () => {
        const revisionLedger = createIntradayRelativeVolumeTriggerLedger();
        const revised = revisionLedger.evaluate(
            input({ configRevision: 8, revisionFirstComparable: true }),
        );
        expect(revised).toMatchObject({
            notificationEligible: false,
            triggerEvent: { kind: 'historical', configRevision: 8 },
        });

        const historicalLedger = createIntradayRelativeVolumeTriggerLedger();
        historicalLedger.evaluate(
            input({
                observationMode: 'historical',
                minuteKey: '10:04',
                currentCumulativeVolume: 1_400,
            }),
        );
        const historical = historicalLedger.evaluate(
            input({ observationMode: 'historical' }),
        );
        expect(historical).toMatchObject({
            notificationEligible: false,
            triggerEvent: { kind: 'historical' },
        });
    });

    it('namespaces latches by trade date, symbol, and config revision', () => {
        const ledger = createIntradayRelativeVolumeTriggerLedger();
        ledger.evaluate(
            input({ minuteKey: '10:04', currentCumulativeVolume: 1_400 }),
        );
        const dayOne = ledger.evaluate(input()).triggerEvent;
        ledger.evaluate(
            input({
                tradeDate: '2026-09-05',
                baselineTradeDate: '2026-09-04',
                minuteKey: '10:04',
                currentCumulativeVolume: 1_400,
                createdAt: '2026-09-05T10:05:00+08:00',
            }),
        );
        const dayTwo = ledger.evaluate(
            input({
                tradeDate: '2026-09-05',
                baselineTradeDate: '2026-09-04',
                createdAt: '2026-09-05T10:06:00+08:00',
            }),
        ).triggerEvent;
        expect(dayTwo.eventId).not.toBe(dayOne.eventId);
        expect(ledger.getEvents()).toHaveLength(2);
    });

    it('conserves matched, not-matched, and unknown across the admitted batch', () => {
        const ledger = createIntradayRelativeVolumeTriggerLedger();
        const summary = ledger.summarize([
            input({ canonicalSymbol: '2330.TW' }),
            input({
                canonicalSymbol: '2454.TW',
                currentCumulativeVolume: 1_499,
            }),
            input({
                canonicalSymbol: '6488.TWO',
                exchange: 'OTC',
                previousCumulativeVolume: 0,
            }),
        ]);
        expect(summary).toMatchObject({
            admitted: 3,
            matched: 1,
            notMatched: 1,
            unknown: 1,
            conserved: true,
        });
    });
});
