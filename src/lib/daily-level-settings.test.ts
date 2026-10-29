import { describe, expect, it, vi } from 'vitest';
import { normalizeIndicatorInstances, DEF_BY_TYPE, commitIndicatorDraft, updateInstances, newInstance, getInstancesSnapshot } from './indicator-defs';
import { DAILY_LEVEL_TYPE, dailyLevelDemand } from './daily-indicator-levels';
import { createIndicatorSeriesRenderer } from './chart-indicators';
import { getChartColors } from './theme-store';
describe('日線價位設定相容性', () => {
    const d = { id: 'daily', type: DAILY_LEVEL_TYPE, params: { period: 30, mult: 2.5, autoscale: 1 }, colors: {}, styles: { ma120: { visible: false, color: '#123456', width: 3, lineStyle: 'dotted' } } };
    it('單例正規化保留舊MA／BOLL及八項樣式，非法參數不崩潰', () => {
        const old = { id: 'old', type: 'boll', params: { period: 40, mult: 3 }, colors: {} };
        const v = normalizeIndicatorInstances([old, d, { ...d, id: 'duplicate' }]);
        expect(v).toHaveLength(2); expect(v[0]!.params.period).toBe(40);
        expect(v[1]!.styles!.ma120!.visible).toBe(false); expect(v[1]!.styles!.ma120!.lineStyle).toBe('dotted');
        expect(v[1]!.params).not.toHaveProperty('autoscale');
        expect(dailyLevelDemand(v[1])).toBe(60);
        const bad = normalizeIndicatorInstances([{ ...d, params: { period: 20, mult: 1.1 } }])[0]!;
        expect(bad.params.mult).toBe(2); expect(() => dailyLevelDemand(bad)).not.toThrow();
    });
    it('新type是primitive，因此既有series回測consumer跳過；草稿未commit不影響原設定', () => {
        expect(DEF_BY_TYPE.get(DAILY_LEVEL_TYPE)!.kind).toBe('primitive');
        const original = normalizeIndicatorInstances([d]);
        const draft = { ...original[0]!, params: { ...original[0]!.params, period: 50 } };
        expect(original[0]!.params.period).toBe(30);
        expect(commitIndicatorDraft(original, draft, false).instances[0]!.params.period).toBe(50);
    });
    it('實際共用回測renderer忽略日線primitive，只計算既有SMA且不新增日線consumer', () => {
        const previous = getInstancesSnapshot();
        try {
            updateInstances(() => [newInstance(DAILY_LEVEL_TYPE), newInstance('sma')]);
            const setData = vi.fn(), removeSeries = vi.fn();
            const addSeries = vi.fn(() => ({ setData }));
            const chart = { addSeries, removeSeries, panes: () => [{}] };
            const renderer = createIndicatorSeriesRenderer(chart as never, 5, getChartColors({ mode: 'dark', convention: 'tw', fontScale: 1 }));
            renderer.update(Array.from({ length: 20 }, (_, i) => ({ time: i + 1, open: 100, high: 100, low: 100, close: 100, volume: 1, turnoverTwd: null })));
            expect(renderer.legend).toHaveLength(1);
            expect(addSeries).toHaveBeenCalledOnce(); expect(setData).toHaveBeenCalledOnce();
            renderer.destroy(); expect(removeSeries).toHaveBeenCalledOnce();
        } finally { updateInstances(() => previous); }
    });
});
