import { describe, expect, it, vi } from 'vitest';
import type { PaneAttachedParameter, Time } from 'lightweight-charts';
import { PivotPrimitive } from './pivot-primitive';
import type { PivotReferenceDay } from './traditional-pivot';
import { buildSupportResistanceProjection } from './support-resistance';

const reference: PivotReferenceDay = {
    date: '2026-08-05',
    high: 110,
    low: 90,
    close: 100,
    firstTime: 1,
    lastTime: 2,
    status: 'completed',
    applicationDate: '2026-08-06',
    applicationStartTime: 3,
    levels: { p: 100, r1: 110, r2: 120, r3: 130, s1: 90, s2: 80, s3: 70 },
};

describe('PivotPrimitive', () => {
    it('從適用交易日第一根 K 棒向右畫七線與標籤，不建立假未來時間', () => {
        const moveTo = vi.fn();
        const lineTo = vi.fn();
        const stroke = vi.fn();
        const setLineDash = vi.fn();
        const fillText = vi.fn();
        const primitive = new PivotPrimitive({
            priceToCoordinate: (price: number) => 200 - price,
        } as never);
        primitive.attached({
            chart: {
                timeScale: () => ({
                    timeToCoordinate: (time: number) =>
                        time === reference.firstTime ? 20 : null,
                }),
            },
            requestUpdate: vi.fn(),
        } as unknown as PaneAttachedParameter<Time>);
        primitive.setData(reference);
        const renderer = primitive.paneViews()[0]!.renderer() as {
            draw: (target: unknown) => void;
        };
        renderer.draw({
            useBitmapCoordinateSpace: (callback: (scope: unknown) => void) =>
                callback({
                    context: {
                        save: vi.fn(),
                        restore: vi.fn(),
                        beginPath: vi.fn(),
                        moveTo,
                        lineTo,
                        stroke,
                        setLineDash,
                        fillText,
                        fillStyle: '',
                        strokeStyle: '',
                        lineWidth: 1,
                        font: '',
                        textBaseline: '',
                    },
                    bitmapSize: { width: 500, height: 300 },
                    horizontalPixelRatio: 2,
                    verticalPixelRatio: 2,
                }),
        });
        expect(stroke.mock.calls.length).toBeGreaterThanOrEqual(7);
        expect(fillText).toHaveBeenCalledTimes(7);
        expect(moveTo.mock.calls.filter((call) => call[0] === 40)).toHaveLength(7);
        expect(setLineDash).toHaveBeenCalledWith([12, 8]);
        expect(setLineDash).toHaveBeenCalledWith([4, 8]);
    });

    it('reference candle 不在分鐘資料窗時從 plot 左側開始', () => {
        const moveTo = vi.fn();
        const primitive = new PivotPrimitive({
            priceToCoordinate: (price: number) => 200 - price,
        } as never);
        primitive.attached({
            chart: {
                timeScale: () => ({ timeToCoordinate: () => null }),
            },
            requestUpdate: vi.fn(),
        } as unknown as PaneAttachedParameter<Time>);
        primitive.setData(reference, undefined, undefined, (value) => value.toFixed(2));
        const renderer = primitive.paneViews()[0]!.renderer() as {
            draw: (target: unknown) => void;
        };
        renderer.draw({
            useBitmapCoordinateSpace: (callback: (scope: unknown) => void) =>
                callback({
                    context: {
                        save: vi.fn(),
                        restore: vi.fn(),
                        beginPath: vi.fn(),
                        moveTo,
                        lineTo: vi.fn(),
                        stroke: vi.fn(),
                        setLineDash: vi.fn(),
                        fillText: vi.fn(),
                        fillStyle: '',
                        strokeStyle: '',
                        lineWidth: 1,
                        font: '',
                        textBaseline: '',
                    },
                    bitmapSize: { width: 500, height: 300 },
                    horizontalPixelRatio: 1,
                    verticalPixelRatio: 1,
                }),
        });
        expect(moveTo.mock.calls.filter((call) => call[0] === 0)).toHaveLength(7);
    });

    it('由直接選取的 reference K 棒位置開始向右畫線', () => {
        const moveTo = vi.fn();
        const timeToCoordinate = vi.fn((time: number) => time === 42 ? 25 : null);
        const primitive = new PivotPrimitive({
            priceToCoordinate: (price: number) => 200 - price,
        } as never);
        primitive.attached({
            chart: { timeScale: () => ({ timeToCoordinate }) },
            requestUpdate: vi.fn(),
        } as unknown as PaneAttachedParameter<Time>);
        const selected = {
            date: reference.date, high: reference.high, low: reference.low,
            close: reference.close, firstTime: 1, lastTime: 2,
            status: 'completed' as const, mode: 'pinned' as const,
        };
        primitive.setProjections(
            selected,
            [buildSupportResistanceProjection('pivot-point', selected)],
            String,
            {},
            42,
        );
        const renderer = primitive.paneViews()[0]!.renderer() as {
            draw: (target: unknown) => void;
        };
        renderer.draw({
            useBitmapCoordinateSpace: (callback: (scope: unknown) => void) => callback({
                context: {
                    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo,
                    lineTo: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
                    fillText: vi.fn(), fillStyle: '', strokeStyle: '', lineWidth: 1,
                    font: '', textBaseline: '',
                },
                bitmapSize: { width: 500, height: 300 },
                horizontalPixelRatio: 2,
                verticalPixelRatio: 1,
            }),
        });
        expect(timeToCoordinate).toHaveBeenCalledWith(42);
        expect(moveTo.mock.calls.filter((call) => call[0] === 50)).toHaveLength(7);
    });

    it('autoscale helper 包含七線完整範圍並可安全清空', () => {
        const primitive = new PivotPrimitive(null);
        primitive.setData(reference);
        expect(primitive.autoscaleInfo()).toEqual({
            priceRange: { minValue: 70, maxValue: 130 },
        });
        primitive.setData(null);
        expect(primitive.autoscaleInfo()).toBeNull();
    });

    it('共同配置十五線、公式前綴、相近價 connector 與 enabled-only autoscale', () => {
        const fillText = vi.fn();
        const lineTo = vi.fn();
        const primitive = new PivotPrimitive({
            priceToCoordinate: (price: number) => 200 - price,
        } as never);
        primitive.attached({
            chart: { timeScale: () => ({ timeToCoordinate: () => null }) },
            requestUpdate: vi.fn(),
        } as unknown as PaneAttachedParameter<Time>);
        const shared = {
            date: reference.date, high: reference.high, low: reference.low,
            close: reference.close, firstTime: reference.firstTime,
            lastTime: reference.lastTime, status: 'completed' as const,
            mode: 'automatic' as const,
        };
        primitive.setProjections(shared, [
            buildSupportResistanceProjection('pivot-point', shared),
            buildSupportResistanceProjection('three-level-price', shared),
            buildSupportResistanceProjection('cdp', shared),
        ], (value) => value.toFixed(2));
        const renderer = primitive.paneViews()[0]!.renderer() as { draw: (target: unknown) => void };
        renderer.draw({ useBitmapCoordinateSpace: (callback: (scope: unknown) => void) => callback({
            context: { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo, stroke: vi.fn(), setLineDash: vi.fn(), fillText, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '' },
            bitmapSize: { width: 500, height: 300 }, horizontalPixelRatio: 1, verticalPixelRatio: 1,
        }) });
        expect(fillText).toHaveBeenCalledTimes(15);
        expect(fillText.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
            'PP P 100.00', '三關 中 100.00', 'CDP CDP 100.00',
        ]));
        expect(lineTo.mock.calls.length).toBeGreaterThan(15);
        expect(primitive.autoscaleInfo()).toEqual({ priceRange: { minValue: 70, maxValue: 130 } });

        primitive.setProjections(shared, [buildSupportResistanceProjection('three-level-price', shared)]);
        expect(primitive.autoscaleInfo()).toEqual({ priceRange: { minValue: 82.36, maxValue: 117.64 } });
        primitive.setProjections(null, []);
        expect(primitive.autoscaleInfo()).toBeNull();
        primitive.detached();
    });

    it('uses formula-level color, width and line style for lines, labels and connectors', () => {
        const setLineDash = vi.fn();
        const lineWidths: number[] = [];
        const strokeStyles: string[] = [];
        const fillStyles: string[] = [];
        const context = {
            save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
            lineTo: vi.fn(), stroke: vi.fn(), setLineDash, fillText: vi.fn(),
            font: '', textBaseline: '',
            set lineWidth(value: number) { lineWidths.push(value); },
            set strokeStyle(value: string) { strokeStyles.push(value); },
            set fillStyle(value: string) { fillStyles.push(value); },
        };
        const primitive = new PivotPrimitive({
            priceToCoordinate: (price: number) => 200 - price,
        } as never);
        primitive.attached({
            chart: { timeScale: () => ({ timeToCoordinate: () => null }) },
            requestUpdate: vi.fn(),
        } as unknown as PaneAttachedParameter<Time>);
        const shared = {
            date: reference.date, high: reference.high, low: reference.low,
            close: reference.close, firstTime: reference.firstTime,
            lastTime: reference.lastTime, status: 'completed' as const,
            mode: 'automatic' as const,
        };
        primitive.setProjections(
            shared,
            [buildSupportResistanceProjection('cdp', shared)],
            String,
            { cdp: { color: '#123456', width: 3, lineStyle: 'dashed' } },
        );
        const renderer = primitive.paneViews()[0]!.renderer() as { draw: (target: unknown) => void };
        renderer.draw({
            useBitmapCoordinateSpace: (callback: (scope: unknown) => void) => callback({
                context,
                bitmapSize: { width: 500, height: 300 },
                horizontalPixelRatio: 1,
                verticalPixelRatio: 1,
            }),
        });
        expect(setLineDash).toHaveBeenCalledWith([7, 4]);
        expect(lineWidths).toContain(3);
        expect(strokeStyles.every((color) => color === '#123456')).toBe(true);
        expect(fillStyles).toEqual(Array(5).fill('#123456'));
    });
});
