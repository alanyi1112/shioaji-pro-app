import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from './types/market';
import {
    recallChartKbars,
    rememberChartKbars,
    resetChartKbarMemoryCacheForTests,
} from './chart-kbar-memory-cache';

function candle(time: number, close = 100): Candle {
    return {
        time,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
        turnoverTwd: close,
    };
}

describe('chart K 線記憶體快取', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetChartKbarMemoryCacheForTests();
    });

    it('切回同一商品時提供獨立副本，避免畫面先被清空', () => {
        const source = [candle(1, 100), candle(2, 101)];
        rememberChartKbars('STK:TSE:2330:1440', source);

        source[0]!.close = 999;
        const first = recallChartKbars('STK:TSE:2330:1440');
        expect(first?.map((bar) => bar.close)).toEqual([100, 101]);

        first![0]!.close = 888;
        expect(
            recallChartKbars('STK:TSE:2330:1440')?.map((bar) => bar.close),
        ).toEqual([100, 101]);
    });

    it('只保留最近 12 個商品時框，避免大型日 K 長時間無界增長', () => {
        let now = 1;
        vi.spyOn(Date, 'now').mockImplementation(() => now++);
        for (let index = 0; index < 13; index += 1) {
            rememberChartKbars(`key-${index}`, [candle(index)]);
        }

        expect(recallChartKbars('key-0')).toBeNull();
        expect(recallChartKbars('key-12')).toHaveLength(1);
    });
});
