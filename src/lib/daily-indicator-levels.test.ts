import { describe, expect, it } from 'vitest';
import { bollinger, referenceSma } from './indicators';
import { computeDailyLevels, dailyLevelDemand, dailyLevelParams, groupDailyLevels, type DailyLevelSnapshot } from './daily-indicator-levels';
import type { IndicatorInstance } from './indicator-defs';
const inst: IndicatorInstance = { id: 'daily', type: 'daily-indicator-levels', params: { period: 20, mult: 2 }, colors: {} };
const snapshot = (n: number): DailyLevelSnapshot => ({ key: 'A', bars: Array.from({ length: n }, (_, i) => ({ time: (19000 + i) * 86400, open: i + 100, high: i + 100, low: i + 100, close: i + 100, volume: 1, turnoverTwd: null })), phase: 'forming', state: 'ready', asOf: 1, receivedAt: 1, generation: 1 });
describe('最新日線價位', () => {
    it('五種均線依交易日窗口，BOLL母體標準差與1D公式相同', () => {
        const s = snapshot(120), values = computeDailyLevels(s, inst);
        for (const n of [5, 10, 20, 60, 120]) {
            const value = values.find(x => x.key === `ma${n}`)!.value;
            expect(value).toBe(219 - (n - 1) / 2);
            expect(value).toBe(referenceSma([...s.bars], n).at(-1)!.value);
        }
        const bands = bollinger([...s.bars], 20, 2);
        for (const k of ['upper', 'mid', 'lower'] as const) expect(values.find(x => x.key === k)!.value).toBe(bands[k].at(-1)!.value);
        expect(values.find(x => x.key === 'upper')!.value).toBeCloseTo(209.5 + 2 * Math.sqrt(399 / 12), 5);
        expect(values.find(x => x.key === 'mid')!.value).toBe(values.find(x => x.key === 'ma20')!.value);
    });
    it('forming 108→110改同一日，5MA 104→104.4', () => {
        const s = snapshot(5); s.bars.forEach((b, i) => Object.assign(b, { open: 100 + i * 2, close: 100 + i * 2, low: 100, high: 110 }));
        expect(computeDailyLevels(s, inst)[0]!.value).toBe(104);
        s.bars.at(-1)!.close = 110;
        expect(computeDailyLevels(s, inst)[0]!.value).toBe(104.4);
        expect(s.bars).toHaveLength(5);
    });
    it('40日逐項不足，錯商品／缺日／非法OHLC不可湊數', () => {
        const s = snapshot(40), v = computeDailyLevels(s, inst);
        expect(v.filter(x => x.status === 'insufficient').map(x => x.key)).toEqual(['ma60', 'ma120']);
        for (const x of [ { ...s, knownGap: true }, { ...s, key: 'B' }, { ...s, bars: [{ ...s.bars[0]!, close: NaN }] } ])
            expect(computeDailyLevels(x, inst, 'A').every(v => v.value === null && v.status === 'unavailable')).toBe(true);
    });
    it('零標準差合併全部同價名稱，單項取消保留其他身分', () => {
        const s = snapshot(120); s.bars.forEach(b => Object.assign(b, { open: 100, high: 100, low: 100, close: 100 }));
        const levels = computeDailyLevels(s, inst), grouped = groupDailyLevels(levels);
        expect(grouped).toHaveLength(1); expect(grouped[0]!.keys).toHaveLength(8);
        levels[0]!.style.visible = false;
        expect(groupDailyLevels(levels)[0]!.keys).toHaveLength(7);
        levels[1]!.value = 100.000001;
        expect(groupDailyLevels(levels)).toHaveLength(2);
    });
    it('依開啟項目需求載入，參數非法拒絕，stale保留值', () => {
        expect(dailyLevelDemand(inst)).toBe(120);
        const styles = Object.fromEntries(computeDailyLevels(snapshot(40), inst).map(x => [x.key, { visible: false }]));
        expect(dailyLevelDemand({ ...inst, styles })).toBe(0);
        expect(dailyLevelDemand({ ...inst, styles: { ...styles, ma5: { visible: true } } })).toBe(5);
        expect(() => dailyLevelParams({ params: { period: 1 } })).toThrow();
        expect(() => dailyLevelParams({ params: { mult: 1.1 } })).toThrow();
        expect(computeDailyLevels({ ...snapshot(120), state: 'stale' }, inst).every(x => x.value !== null && x.status === 'stale')).toBe(true);
    });
});
