import { describe, expect, it, vi } from 'vitest';
import { candleTimelineIssue, commitCandleSeries } from './candle-series-integrity';
import type { Candle } from './types/market';

const bar = (time: number): Candle => ({ time, open: 10, high: 11, low: 9, close: 10, volume: 3, turnoverTwd: 30_000 });

describe('Candle 提交完整性（隔離測試）', () => {
    it.each([
        [[bar(60), bar(60)], 'duplicate_time'],
        [[bar(120), bar(60)], 'unordered_time'],
        [[bar(NaN)], 'invalid_time'],
        [[bar(Infinity)], 'invalid_time'],
        [[bar(60.5)], 'invalid_time'],
    ] as const)('拒絕不合法時間而不呼叫圖表或合併數值：%s', (bars, reason) => {
        const commit = vi.fn(); const fail = vi.fn();
        expect(candleTimelineIssue(bars)?.reason).toBe(reason);
        expect(commitCandleSeries(bars, commit, [bar(0)], fail)).toBe(false);
        expect(commit).not.toHaveBeenCalled();
        expect(fail).toHaveBeenCalledOnce();
    });

    it('合法系列精確提交且不改來源數值', () => {
        const bars = [bar(60), bar(120)]; const before = structuredClone(bars);
        const commit = vi.fn(); const fail = vi.fn();
        expect(commitCandleSeries(bars, commit, [], fail)).toBe(true);
        expect(commit).toHaveBeenCalledWith(bars);
        expect(bars).toEqual(before);
        expect(fail).not.toHaveBeenCalled();
    });

    it('圖表例外僅回復一次最後有效系列，例外不外洩', () => {
        const previous = [bar(60)]; const fail = vi.fn();
        const commit = vi.fn().mockImplementationOnce(() => { throw new Error('series-failed'); });
        expect(commitCandleSeries([bar(120)], commit, previous, fail)).toBe(false);
        expect(commit).toHaveBeenCalledTimes(2);
        expect(commit).toHaveBeenLastCalledWith(previous);
        expect(fail).toHaveBeenCalledOnce();
    });

    it('回復也失敗時不再重試且保留原錯誤', () => {
        const error = new Error('original'); const fail = vi.fn();
        const commit = vi.fn(() => { throw error; });
        expect(commitCandleSeries([bar(120)], commit, [bar(60)], fail)).toBe(false);
        expect(commit).toHaveBeenCalledTimes(2);
        expect(fail).toHaveBeenCalledWith(error);
    });
});
