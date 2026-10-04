import { describe, expect, it } from 'vitest';
import { chartWallClockToTaipeiInstant, wallClockToUtc } from './kbars';

describe('圖表時間與來源時間', () => {
    it('將供台灣盤中座標使用的 UTC 壁鐘時間還原為真實來源瞬間', () => {
        const chartTime = wallClockToUtc('2026-10-02T09:19:00');
        expect(new Date(chartTime * 1_000).toISOString()).toBe('2026-10-02T09:19:00.000Z');
        expect(new Date(chartWallClockToTaipeiInstant(chartTime) * 1_000).toISOString())
            .toBe('2026-10-02T01:19:00.000Z');
    });
});
