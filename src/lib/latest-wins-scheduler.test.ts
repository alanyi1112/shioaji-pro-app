import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatestWinsScheduler } from './latest-wins-scheduler';

describe('LatestWinsScheduler', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('快速 tick 每圖最多保留一個 job，並執行最後一次內容', () => {
        vi.useFakeTimers();
        const scheduler = new LatestWinsScheduler(120);
        const calls: number[] = [];
        for (let tick = 0; tick < 100; tick++) {
            scheduler.schedule(() => calls.push(tick));
            expect(vi.getTimerCount()).toBe(1);
        }
        expect(scheduler.hasPendingJob()).toBe(true);
        vi.advanceTimersByTime(119);
        expect(calls).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(calls).toEqual([99]);
        expect(scheduler.hasPendingJob()).toBe(false);
    });

    it('generation 失效時取消 pending job', () => {
        vi.useFakeTimers();
        const scheduler = new LatestWinsScheduler(500);
        const job = vi.fn();
        scheduler.schedule(job);
        scheduler.invalidate();
        vi.advanceTimersByTime(500);
        expect(job).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('拒絕超過 500ms 的排程上限', () => {
        expect(() => new LatestWinsScheduler(501)).toThrow(RangeError);
    });
});
