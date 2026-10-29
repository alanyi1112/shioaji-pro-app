import { describe, expect, it, vi } from 'vitest';
import { PivotPrimitive } from './pivot-primitive';
import { computeDailyLevels } from './daily-indicator-levels';
import { buildSupportResistanceProjection } from './support-resistance';
import { layoutPriceLabels } from './price-label-layout';
describe('日線與壓撐共同renderer', () => {
    it('23條線共同避碰、不同名稱均有標籤、實價座標與高DPI可驗', () => {
        const fillText = vi.fn(), moveTo = vi.fn(), stroke = vi.fn();
        const p = new PivotPrimitive({ priceToCoordinate: (price: number) => 160 - price / 2 } as never);
        p.attached({ chart: { timeScale: () => ({ timeToCoordinate: () => 20 }) }, requestUpdate: vi.fn() } as never);
        const reference = { date: '2026-10-29', high: 110, low: 90, close: 100, firstTime: 1, lastTime: 2, status: 'completed' as const, mode: 'automatic' as const };
        p.setProjections(reference, (['pivot-point', 'three-level-price', 'cdp'] as const).map(id => buildSupportResistanceProjection(id, reference)));
        const inst = { id: 'D', type: 'daily-indicator-levels', params: {}, colors: {} };
        const s = { key: 'A', bars: Array.from({ length: 120 }, (_, i) => ({ time: i * 86400, open: i + 1, high: i + 1, low: i + 1, close: i + 1, volume: 0, turnoverTwd: null })), phase: 'forming' as const, state: 'ready' as const, asOf: 1, receivedAt: 1, generation: 1 };
        const levels = computeDailyLevels(s, inst); // 20MA/BOLL中軌同價，所以共有22個位置／23個名稱
        p.setDailyLevels(levels);
        const render = p.paneViews()[0]!.renderer()!;
        render.draw({ useBitmapCoordinateSpace: (fn: (scope: unknown) => void) => fn({ context: { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo, lineTo: vi.fn(), stroke, setLineDash: vi.fn(), fillText }, bitmapSize: { width: 1000, height: 600 }, horizontalPixelRatio: 2, verticalPixelRatio: 2 }) } as never);
        expect(fillText).toHaveBeenCalledTimes(22);
        expect(fillText.mock.calls.some(x => String(x[0]).includes('日20MA／日BOLL中軌'))).toBe(true);
        expect(fillText.mock.calls.some(x => String(x[0]).startsWith('PP '))).toBe(true);
        const ys = fillText.mock.calls.map(x => x[2] as number).sort((a, b) => a - b);
        expect(ys.every((y, i) => y >= 12 && y <= 588 && (!i || y - ys[i - 1]! >= 24))).toBe(true);
        expect(moveTo.mock.calls.some(([x, y]) => x === 0 && y === Math.round((160 - 118 / 2) * 2))).toBe(true);
        p.setDailyLevels([]); expect(p.dailyLevels).toHaveLength(0); expect(p.autoscaleInfo()!.priceRange.maxValue).toBe(130);
    });
    it('矮面板以有界欄位避碰，不改真實價格座標', () => {
        const result = layoutPriceLabels(Array.from({ length: 23 }, () => 100), 200);
        expect(result.some(x => x.column === 1)).toBe(true);
        expect(result.every(x => x.y >= 6 && x.y <= 194)).toBe(true);
        for (const c of [0, 1]) {
            const ys = result.filter(x => x.column === c).map(x => x.y);
            expect(ys.every((y, i) => !i || y - ys[i - 1]! >= 12)).toBe(true);
        }
    });
    it('只繪製原價格視窗內的線與標籤，縮放後依新可見範圍重算且不夾邊', () => {
        let middle = 100;
        const fillText = vi.fn(), moveTo = vi.fn();
        const p = new PivotPrimitive({ priceToCoordinate: (price: number) => 150 + (price - middle) * 20 } as never);
        p.attached({ chart: { timeScale: () => ({ timeToCoordinate: () => null }) }, requestUpdate: vi.fn() } as never);
        const inst = { id: 'D', type: 'daily-indicator-levels', params: {}, colors: {} };
        const s = { key: 'A', bars: Array.from({ length: 120 }, (_, i) => ({ time: i * 86400, open: 100, high: 100, low: 100, close: 100, volume: 1, turnoverTwd: null })), phase: 'closed' as const, state: 'ready' as const, asOf: 1, receivedAt: 1, generation: 1 };
        const levels = computeDailyLevels(s, inst).slice(0, 3);
        [90, 100, 110].forEach((v, i) => { levels[i]!.value = v; }); p.setDailyLevels(levels);
        const draw = () => p.paneViews()[0]!.renderer()!.draw({ useBitmapCoordinateSpace: (fn: (scope: unknown) => void) => fn({ context: { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo, lineTo: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), fillText }, bitmapSize: { width: 500, height: 300 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 }) } as never);
        draw(); expect(fillText.mock.calls.map(x => x[0])).toEqual(['日10MA 100']); expect(moveTo).toHaveBeenCalledWith(0, 150);
        expect(p.autoscaleInfo()).toBeNull();
        fillText.mockClear(); moveTo.mockClear(); middle = 110; draw();
        expect(fillText.mock.calls.map(x => x[0])).toEqual(['日20MA 110']); expect(moveTo).toHaveBeenCalledWith(0, 150);
        expect(p.autoscaleInfo()).toBeNull();
    });
});
