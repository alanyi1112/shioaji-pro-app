import { describe, expect, it } from 'vitest';
import {
    buildPivotReferenceDays,
    completedPivotForTime,
    latestCompletedPivot,
    pivotSupportReason,
    taipeiTradingDate,
    traditionalPivot,
} from './traditional-pivot';
import type { Candle } from './types/market';

const row = (
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
    volume: 100,
});

describe('Traditional Pivot', () => {
    it('輸出 P、R1～R3、S1～S3 六位小數契約', () => {
        expect(traditionalPivot(110, 90, 100)).toEqual({
            p: 100,
            r1: 110,
            r2: 120,
            r3: 130,
            s1: 90,
            s2: 80,
            s3: 70,
        });
        expect(traditionalPivot(10, 10, 10)).toEqual({
            p: 10,
            r1: 10,
            r2: 10,
            r3: 10,
            s1: 10,
            s2: 10,
            s3: 10,
        });
        expect(() => traditionalPivot(9, 10, 9.5)).toThrow(RangeError);
        expect(() => traditionalPivot(10, 9, 20)).toThrow(RangeError);
    });

    it('依 Asia/Taipei 日期分組，只有已有下一交易日期者 completed', () => {
        expect(taipeiTradingDate(Date.parse('2026-08-05T16:30:00Z') / 1000)).toBe(
            '2026-08-06',
        );
        const rows = [
            row('2026-08-03T01:00:00Z', 100, 95, 98),
            row('2026-08-03T05:30:00Z', 105, 96, 103),
            row('2026-08-05T01:00:00Z', 110, 102, 109),
            row('2026-08-06T01:00:00Z', 112, 108, 111),
        ];
        const days = buildPivotReferenceDays(rows.reverse());
        expect(days.map((day) => [day.date, day.status])).toEqual([
            ['2026-08-03', 'completed'],
            ['2026-08-05', 'completed'],
            ['2026-08-06', 'provisional'],
        ]);
        expect(days[0]).toMatchObject({
            high: 105,
            low: 95,
            close: 103,
            applicationDate: '2026-08-05',
        });
        expect(latestCompletedPivot(days)?.date).toBe('2026-08-05');
        expect(
            completedPivotForTime(
                days,
                Date.parse('2026-08-03T03:00:00Z') / 1000,
            )?.date,
        ).toBe('2026-08-03');
        expect(
            completedPivotForTime(
                days,
                Date.parse('2026-08-06T03:00:00Z') / 1000,
            ),
        ).toBeNull();
    });

    it('FUT／OPT 明確停用，STK／IND／WRT 僅限既定時框', () => {
        expect(pivotSupportReason('FUT', 1)).toContain('尚未支援');
        expect(pivotSupportReason('OPT', 60)).toContain('尚未支援');
        expect(pivotSupportReason('STK', 30)).toContain('只支援');
        for (const type of ['STK', 'IND', 'WRT'] as const) {
            expect(pivotSupportReason(type, 1440)).toBeNull();
        }
    });
});
