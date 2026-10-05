import { describe, expect, it } from 'vitest';
import { aggregate, chartWallClockToTaipeiInstant, wallClockToUtc } from './kbars';
import type { Candle } from '../types/market';

function candle(time: number): Candle {
    return { time, open: 10, high: 10, low: 10, close: 10, volume: 100, turnoverTwd: 1_000_000 };
}

describe('1 分 K 原始／顯示所有權（合成事件，非 live）', () => {
    it('陣列與每根 Candle 都獨立，顯示更新不污染原始快照', () => {
        const raw = [candle(60), candle(120)];
        const bars = aggregate(raw, 1);
        expect(bars).not.toBe(raw);
        expect(bars).toEqual(raw);
        bars.forEach((bar, i) => expect(bar).not.toBe(raw[i]));
        bars[1]!.close = 12;
        expect(raw[1]!.close).toBe(10);
    });

    it('跨三個分鐘 raw 與 display 各新增一次，不產生重複時間', () => {
        const raw = [candle(60)];
        const bars = aggregate(raw, 1);
        for (const time of [120, 180, 240]) {
            raw.push(candle(time));
            bars.push(candle(time));
        }
        expect(raw.map(b => b.time)).toEqual([60, 120, 180, 240]);
        expect(bars).toEqual(raw);
    });

    it('同分鐘 raw／display 各自套用一次量／值增量，不因別名雙算', () => {
        const raw = [candle(60)];
        const bars = aggregate(raw, 1);
        for (const rows of [raw, bars]) {
            rows[0]!.volume += 3;
            rows[0]!.turnoverTwd = rows[0]!.turnoverTwd! + 30_000;
        }
        expect(raw[0]!.volume).toBe(103);
        expect(bars[0]!.volume).toBe(103);
        expect(raw[0]!.turnoverTwd).toBe(1_030_000);
        expect(bars[0]!.turnoverTwd).toBe(1_030_000);
    });
});

describe('圖表時間與來源時間', () => {
    it('將供台灣盤中座標使用的 UTC 壁鐘時間還原為真實來源瞬間', () => {
        const chartTime = wallClockToUtc('2026-10-02T09:19:00');
        expect(new Date(chartTime * 1_000).toISOString()).toBe('2026-10-02T09:19:00.000Z');
        expect(new Date(chartWallClockToTaipeiInstant(chartTime) * 1_000).toISOString())
            .toBe('2026-10-02T01:19:00.000Z');
    });
});
