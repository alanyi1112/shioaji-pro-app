import { describe, expect, it } from 'vitest';
import {
    detectFairValueGaps,
    fixedRangeVolumeProfile,
    normalizeFixedRange,
} from './market-overlays';
import type { Candle } from './types/market';

const candle = (
    time: number,
    low: number,
    high: number,
    close = (low + high) / 2,
    volume = 100,
): Candle => ({ time, open: close, high, low, close, volume });

describe('Fair Value Gap', () => {
    it('偵測 bullish／bearish 三根缺口並限制 marker／active zone 數量', () => {
        const bullish = [
            candle(1, 8, 10),
            candle(2, 10, 12),
            candle(3, 11, 13),
        ];
        expect(detectFairValueGaps(bullish)).toMatchObject({
            markers: [{ time: 3, direction: 'bullish', price: 11 }],
            zones: [
                {
                    direction: 'bullish',
                    lower: 10,
                    upper: 11,
                    fullyMitigated: false,
                },
            ],
        });
        const bearish = [
            candle(1, 10, 12),
            candle(2, 8, 10),
            candle(3, 7, 9),
        ];
        expect(detectFairValueGaps(bearish).zones[0]).toMatchObject({
            direction: 'bearish',
            lower: 9,
            upper: 10,
        });
    });

    it('部分穿越不縮邊界，觸及遠端邊界才完全填補並停止延伸', () => {
        const base = [
            candle(1, 8, 10),
            candle(2, 10, 12),
            candle(3, 11, 13),
            candle(4, 10.5, 12),
        ];
        const partial = detectFairValueGaps(base);
        expect(partial.zones[0]).toMatchObject({ lower: 10, upper: 11 });
        const filled = detectFairValueGaps([...base, candle(5, 9.8, 11)]);
        expect(filled.zones).toHaveLength(0);
    });
});

describe('固定區間 K 線 Volume Profile', () => {
    it('反向 anchor 正規化、兩端納入並輸出 24 bins／POC／70% VA', () => {
        const rows = [
            candle(1, 10, 12, 11, 100),
            candle(2, 11, 13, 12, 300),
            candle(3, 12, 14, 13, 200),
            candle(4, 30, 40, 35, 9999),
        ];
        const anchors = normalizeFixedRange(3, 1);
        const profile = fixedRangeVolumeProfile(rows, anchors)!;
        expect(profile.anchors).toEqual({ startTime: 1, endTime: 3 });
        expect(profile.bins).toHaveLength(24);
        expect(profile.totalVolume).toBe(600);
        expect(profile.poc).toBeGreaterThanOrEqual(11);
        expect(profile.poc).toBeLessThanOrEqual(13);
        expect(profile.val).toBeLessThanOrEqual(profile.poc);
        expect(profile.vah).toBeGreaterThanOrEqual(profile.poc);
    });

    it('flat range 只使用一個有效 bin，區間外更新不改變統計母體', () => {
        const rows = [
            candle(1, 10, 10, 10, 100),
            candle(2, 10, 10, 10, 250),
        ];
        const anchors = { startTime: 1, endTime: 2 };
        const first = fixedRangeVolumeProfile(rows, anchors)!;
        expect(first.bins.filter((bin) => bin.volume > 0)).toEqual([
            { index: 0, lower: 10, upper: 10, volume: 350 },
        ]);
        expect(
            fixedRangeVolumeProfile(
                [...rows, candle(3, 100, 120, 110, 9999)],
                anchors,
            ),
        ).toEqual(first);
    });

    it('無資料與非法參數安全拒絕', () => {
        expect(
            fixedRangeVolumeProfile([], { startTime: 1, endTime: 2 }),
        ).toBeNull();
        expect(() =>
            fixedRangeVolumeProfile(
                [candle(1, 1, 2)],
                { startTime: 1, endTime: 1 },
                0,
            ),
        ).toThrow(RangeError);
    });
});
