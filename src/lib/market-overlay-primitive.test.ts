import { describe, expect, it, vi } from 'vitest';
import type { PaneAttachedParameter, Time } from 'lightweight-charts';
import { MarketOverlayPrimitive } from './market-overlay-primitive';

function draw(primitive: MarketOverlayPrimitive) {
    const fillRect = vi.fn();
    const context = {
        save: vi.fn(),
        restore: vi.fn(),
        fillRect,
        fillStyle: '',
    };
    const renderer = primitive.paneViews()[0]!.renderer() as {
        draw: (target: unknown) => void;
    };
    renderer.draw({
        useBitmapCoordinateSpace: (callback: (scope: unknown) => void) =>
            callback({
                context,
                bitmapSize: { width: 400, height: 200 },
                mediaSize: { width: 200, height: 100 },
                horizontalPixelRatio: 2,
                verticalPixelRatio: 2,
            }),
    });
    return fillRect;
}

describe('MarketOverlayPrimitive', () => {
    it('以最新 time／price coordinate 畫 FVG、profile 與三條 level', () => {
        const requestUpdate = vi.fn();
        const chart = {
            timeScale: () => ({
                timeToCoordinate: (time: number) => time * 10,
            }),
        };
        const priceSeries = {
            priceToCoordinate: (price: number) => 100 - price,
        };
        const primitive = new MarketOverlayPrimitive(priceSeries as never);
        primitive.attached({
            chart,
            requestUpdate,
        } as unknown as PaneAttachedParameter<Time>);
        primitive.setData(
            [
                {
                    id: 'fvg',
                    direction: 'bullish',
                    startTime: 1,
                    endTime: 3,
                    lower: 10,
                    upper: 12,
                    fullyMitigated: false,
                },
            ],
            [{ time: 3, direction: 'bullish', price: 12 }],
            {
                anchors: { startTime: 1, endTime: 3 },
                bins: [
                    { index: 0, lower: 10, upper: 11, volume: 100 },
                    { index: 1, lower: 11, upper: 12, volume: 200 },
                ],
                totalVolume: 300,
                poc: 11.5,
                vah: 12,
                val: 10,
            },
        );
        expect(requestUpdate).toHaveBeenCalledOnce();
        expect(draw(primitive).mock.calls.length).toBeGreaterThanOrEqual(7);
        primitive.detached();
        expect(draw(primitive)).not.toHaveBeenCalled();
    });

    it('不提供 hitTest 或 autoscaleInfo，避免攔截圖表互動與價格軸', () => {
        const primitive = new MarketOverlayPrimitive(null);
        expect('hitTest' in primitive).toBe(false);
        expect('autoscaleInfo' in primitive).toBe(false);
    });
});
