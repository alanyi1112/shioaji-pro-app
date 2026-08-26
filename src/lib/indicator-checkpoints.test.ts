import { describe, expect, it, vi } from 'vitest';
import {
    atr,
    ema,
    macd,
    wilderRsiSeries,
} from './indicators';
import { IndicatorCheckpointCache } from './indicator-checkpoints';
import type { Candle } from './types/market';

const bars = (count: number, start = 1_700_000_000): Candle[] =>
    Array.from({ length: count }, (_, index) => {
        const close = 100 + index * 0.37 + Math.sin(index / 3) * 2;
        return {
            time: start + index * 60,
            open: close - 0.4,
            high: close + 1.2,
            low: close - 1.1,
            close,
            volume: 1000 + index * 13,
            turnoverTwd: null,
        };
    });

describe('IndicatorCheckpointCache', () => {
    const cases: {
        type: string;
        params: Record<string, number>;
        compute: (
            rows: Candle[],
            params: Record<string, number>,
        ) => Record<string, { time: number; value?: number }[]>;
    }[] = [
        {
            type: 'ema',
            params: { period: 12 },
            compute: (rows: Candle[], params: Record<string, number>) => ({
                line: ema(rows, params.period!),
            }),
        },
        {
            type: 'macd',
            params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
            compute: (rows: Candle[], params: Record<string, number>) =>
                macd(
                    rows,
                    params.fastPeriod!,
                    params.slowPeriod!,
                    params.signalPeriod!,
                ),
        },
        {
            type: 'rsi',
            params: { shortPeriod: 5, longPeriod: 10 },
            compute: (rows: Candle[], params: Record<string, number>) => ({
                short: wilderRsiSeries(rows, params.shortPeriod!),
                long: wilderRsiSeries(rows, params.longPeriod!),
            }),
        },
        {
            type: 'atr',
            params: { period: 14 },
            compute: (rows: Candle[], params: Record<string, number>) => ({
                line: atr(rows, params.period!),
            }),
        },
    ];

    for (const testCase of cases) {
        it(`${testCase.type} current-bar checkpoint 與 full recompute 逐點一致`, () => {
            const cache = new IndicatorCheckpointCache();
            const initial = bars(80);
            expect(
                cache.compute(
                    'instance',
                    testCase.type,
                    initial,
                    testCase.params,
                    testCase.compute,
                ),
            ).toEqual(testCase.compute(initial, testCase.params));

            const updated = initial.map((bar) => ({ ...bar }));
            const tail = updated[updated.length - 1]!;
            tail.close += 4.25;
            tail.high = Math.max(tail.high, tail.close + 0.5);
            tail.low -= 0.75;
            expect(
                cache.compute(
                    'instance',
                    testCase.type,
                    updated,
                    testCase.params,
                    testCase.compute,
                ),
            ).toEqual(testCase.compute(updated, testCase.params));
        });
    }

    it('相同 prefix 的連續 tick 只建立一次 checkpoint', () => {
        const cache = new IndicatorCheckpointCache();
        const compute = vi.fn(
            (rows: Candle[], params: Record<string, number>) => ({
                line: ema(rows, params.period!),
            }),
        );
        const initial = bars(50);
        cache.compute('ema-1', 'ema', initial, { period: 12 }, compute);
        for (let index = 0; index < 20; index++) {
            const updated = initial.map((bar) => ({ ...bar }));
            updated[updated.length - 1]!.close += index;
            cache.compute('ema-1', 'ema', updated, { period: 12 }, compute);
        }
        expect(compute).toHaveBeenCalledOnce();
    });

    it('history prepend 會重建受影響 checkpoint 並保持 parity', () => {
        const cache = new IndicatorCheckpointCache();
        const current = bars(60);
        const compute = (rows: Candle[], params: Record<string, number>) =>
            macd(
                rows,
                params.fastPeriod!,
                params.slowPeriod!,
                params.signalPeriod!,
            );
        const params = { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };
        cache.compute('macd-1', 'macd', current, params, compute);
        const older = bars(20, current[0]!.time - 20 * 60);
        const prepended = [...older, ...current];
        expect(
            cache.compute('macd-1', 'macd', prepended, params, compute),
        ).toEqual(compute(prepended, params));
    });
});
