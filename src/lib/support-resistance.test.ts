import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/support-resistance-formulas-v1.json';
import {
    CDP_VERSION,
    SUPPORT_RESISTANCE_CONTRACT_VERSION,
    THREE_LEVEL_PRICE_VERSION,
    buildSupportResistanceProjection,
    cdpWilder,
    resolveAutomaticSupportResistanceReference,
    resolveCompletedSupportResistanceReferenceForTime,
    supportResistanceProjectionStartTime,
    threeLevelPrice,
    supportResistanceSelectionAllowed,
    type ReferenceOhlc,
} from './support-resistance';
import { traditionalPivot } from './traditional-pivot';
import type { Candle } from './types/market';

const candle = (
    iso: string,
    high: number,
    low: number,
    close: number,
): Candle => ({
    time: Date.parse(iso) / 1000,
    open: close,
    high,
    low,
    close,
    volume: 1,
});

describe('support/resistance formula contract', () => {
    it('uses the versioned shared OHLC fixture at six-decimal parity', () => {
        expect(fixture.fixtureVersion).toBe('support-resistance-formulas-v1');
        expect(fixture.formulaVersions).toEqual({
            pivotPoint: 'traditional-pivot-tw-v1',
            threeLevelPrice: THREE_LEVEL_PRICE_VERSION,
            cdp: CDP_VERSION,
        });
        for (const testCase of fixture.cases) {
            const raw = testCase.input;
            const input: ReferenceOhlc = {
                high: raw.high === 'Infinity' ? Infinity : raw.high,
                low: raw.low,
                close: raw.close,
            } as ReferenceOhlc;
            if ('invalid' in testCase) {
                expect(() => traditionalPivot(input.high, input.low, input.close)).toThrow(RangeError);
                expect(() => threeLevelPrice(input)).toThrow(RangeError);
                expect(() => cdpWilder(input)).toThrow(RangeError);
            } else {
                expect(traditionalPivot(input.high, input.low, input.close)).toEqual(testCase.pivotPoint);
                expect(threeLevelPrice(input)).toEqual(testCase.threeLevelPrice);
                expect(cdpWilder(input)).toEqual(testCase.cdp);
            }
        }
    });

    it('adapts Pivot, three-level price and CDP to one fixed-order level-set contract', () => {
        const reference = {
            date: '2026-08-07', high: 110, low: 90, close: 100,
            firstTime: 1, lastTime: 2, status: 'completed' as const, mode: 'automatic' as const,
        };
        const pivot = buildSupportResistanceProjection('pivot-point', reference);
        const three = buildSupportResistanceProjection('three-level-price', reference);
        const cdp = buildSupportResistanceProjection('cdp', reference);
        expect(pivot.contractVersion).toBe(SUPPORT_RESISTANCE_CONTRACT_VERSION);
        expect(pivot.levels.map((item) => item.id)).toEqual(['r3', 'r2', 'r1', 'p', 's1', 's2', 's3']);
        expect(three.levels.map((item) => item.id)).toEqual(['up', 'mid', 'down']);
        expect(cdp.levels.map((item) => item.id)).toEqual(['ah', 'nh', 'cdp', 'nl', 'al']);
        expect(cdp.levels.map((item) => item.price)).toEqual([120, 110, 100, 90, 80]);
    });
});

describe('automatic Asia/Taipei reference resolver', () => {
    const previous = [
        candle('2026-08-07T01:00:00Z', 100, 90, 95),
        candle('2026-08-07T05:30:00Z', 110, 92, 105),
    ];
    const today = [
        candle('2026-08-10T01:00:00Z', 120, 100, 110),
        candle('2026-08-10T05:30:00Z', 125, 105, 122),
    ];
    const resolve = (overrides: Partial<Parameters<typeof resolveAutomaticSupportResistanceReference>[0]> = {}) =>
        resolveAutomaticSupportResistanceReference({
            rows: [...previous, ...today], securityType: 'STK',
            now: Date.parse('2026-08-10T04:00:00Z'),
            currentDayLoadState: 'success', sourceAvailable: true, ...overrides,
        });

    it('uses the previous complete day intraday and current day only after 13:35 with proven data', () => {
        expect(resolve()).toMatchObject({ status: 'available', reference: { date: '2026-08-07' } });
        expect(resolve({ now: Date.parse('2026-08-10T05:35:00Z') })).toMatchObject({ status: 'available', reference: { date: '2026-08-10', status: 'completed' } });
    });

    it('handles pre-open, weekend, holiday, make-up trading day and reverse row order from actual dates', () => {
        expect(resolve({ rows: previous, now: Date.parse('2026-08-10T00:00:00Z') })).toMatchObject({ status: 'available', reference: { date: '2026-08-07' } });
        expect(resolve({ rows: previous, now: Date.parse('2026-08-09T04:00:00Z') })).toMatchObject({ status: 'available', reference: { date: '2026-08-07' } });
        const makeUp = [candle('2026-08-08T01:00:00Z', 118, 100, 115)];
        expect(resolve({ rows: [...makeUp, ...previous].reverse(), now: Date.parse('2026-08-09T04:00:00Z') })).toMatchObject({ status: 'available', reference: { date: '2026-08-08' } });
    });

    it('fails closed on load/source/invalid-current-day and never manufactures quote or zero OHLC', () => {
        const afterClose = Date.parse('2026-08-10T05:35:00Z');
        expect(resolve({ now: afterClose, currentDayLoadState: 'failed' })).toMatchObject({ status: 'available', reference: { date: '2026-08-07' } });
        expect(resolve({ now: afterClose, sourceAvailable: false })).toMatchObject({ status: 'available', reference: { date: '2026-08-07' } });
        const invalidToday = candle('2026-08-10T05:30:00Z', 100, 120, 110);
        expect(resolve({ rows: [...previous, invalidToday], now: afterClose })).toMatchObject({ status: 'available', reference: { date: '2026-08-07' } });
        expect(resolve({ rows: today, now: Date.parse('2026-08-10T04:00:00Z') })).toEqual({ status: 'unavailable', reason: 'no-completed-trading-day' });
        expect(resolve({ rows: [], now: afterClose, currentDayLoadState: 'failed' })).toEqual({ status: 'unavailable', reason: 'no-completed-trading-day' });
    });

    it('pins historical completed bars but rejects today while forming', () => {
        const base = {
            rows: [...previous, ...today], securityType: 'STK' as const,
            now: Date.parse('2026-08-10T04:00:00Z'),
            currentDayLoadState: 'success' as const, sourceAvailable: true,
        };
        expect(resolveCompletedSupportResistanceReferenceForTime(base, previous[0]!.time)).toMatchObject({ date: '2026-08-07', mode: 'pinned' });
        expect(resolveCompletedSupportResistanceReferenceForTime(base, today[0]!.time)).toBeNull();
        expect(resolveCompletedSupportResistanceReferenceForTime({ ...base, now: Date.parse('2026-08-10T05:35:00Z') }, today[0]!.time)).toMatchObject({ date: '2026-08-10', mode: 'pinned' });
    });

    it('uses the selected daily candle timestamp on 1D and the first intraday bar on minute charts', () => {
        const firstTime = Date.parse('2026-08-07T01:00:00Z') / 1000;
        expect(supportResistanceProjectionStartTime(firstTime, 1440)).toBe(
            Date.parse('2026-08-07T00:00:00Z') / 1000,
        );
        for (const timeframe of [1, 5, 15, 60]) {
            expect(supportResistanceProjectionStartTime(firstTime, timeframe)).toBe(firstTime);
        }
    });
});

describe('support/resistance interaction safety', () => {
    it('lets enabled formulas consume direct K-bar selection only in 1D observe mode', () => {
        expect(supportResistanceSelectionAllowed('observe', 1440, true)).toBe(true);
        expect(supportResistanceSelectionAllowed('observe', 5, true)).toBe(false);
        expect(supportResistanceSelectionAllowed('observe', 1440, false)).toBe(false);
        for (const mode of ['buy', 'sell', 'stop', 'take', 'alert'] as const) {
            expect(supportResistanceSelectionAllowed(mode, 1440, true)).toBe(false);
        }
    });
});
