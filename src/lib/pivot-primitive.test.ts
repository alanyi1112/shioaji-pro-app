import { describe, expect, it, vi } from 'vitest';
import type { PaneAttachedParameter, Time } from 'lightweight-charts';
import { PivotPrimitive } from './pivot-primitive';
import type { PivotReferenceDay } from './traditional-pivot';

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
        const fillRect = vi.fn();
        const fillText = vi.fn();
        const primitive = new PivotPrimitive({
            priceToCoordinate: (price: number) => 200 - price,
        } as never);
        primitive.attached({
            chart: {
                timeScale: () => ({
                    timeToCoordinate: (time: number) =>
                        time === reference.applicationStartTime ? 20 : null,
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
                        fillRect,
                        fillText,
                        fillStyle: '',
                        font: '',
                        textBaseline: '',
                    },
                    bitmapSize: { width: 500, height: 300 },
                    horizontalPixelRatio: 2,
                    verticalPixelRatio: 2,
                }),
        });
        expect(fillRect).toHaveBeenCalledTimes(7);
        expect(fillText).toHaveBeenCalledTimes(7);
        expect(fillRect.mock.calls.every((call) => call[0] === 40)).toBe(true);
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
});
