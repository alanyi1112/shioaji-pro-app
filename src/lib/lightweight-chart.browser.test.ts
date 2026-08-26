import {
    CandlestickSeries,
    ColorType,
    LineSeries,
    createChart,
    type UTCTimestamp,
} from 'lightweight-charts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    newInstance,
    resetIndicatorStoreForTests,
    updateInstances,
} from './indicator-defs';
import { createIndicatorSeriesRenderer } from './chart-indicators';
import type { Candle } from './types/market';
import { MarketOverlayPrimitive } from './market-overlay-primitive';
import { PivotPrimitive } from './pivot-primitive';
import { DayBoundaryPaneManager } from './day-boundary-primitive';
import { getChartColors } from './theme-store';
import {
    createFibonacciController,
    fibonacciIdentity,
} from './fibonacci-annotations';
import { buildFibonacciOverlayModel } from './fibonacci-overlay';

describe('lightweight-charts browser harness', () => {
    afterEach(() => {
        resetIndicatorStoreForTests();
        localStorage.clear();
        document.body.replaceChildren();
    });

    it('在真實 Chromium 建立、繪製並清理 chart', async () => {
        const host = document.createElement('div');
        host.style.width = '480px';
        host.style.height = '240px';
        document.body.append(host);

        const chart = createChart(host, { width: 480, height: 240 });
        const series = chart.addSeries(LineSeries, {
            color: '#3d8bff',
            priceLineVisible: false,
        });
        series.setData([
            { time: 1 as UTCTimestamp, value: 100 },
            { time: 2 as UTCTimestamp, value: 101 },
            { time: 3 as UTCTimestamp, value: 99 },
        ]);
        chart.timeScale().fitContent();

        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        expect(host.querySelectorAll('canvas').length).toBeGreaterThan(0);
        expect(chart.panes()).toHaveLength(1);

        chart.remove();
        expect(host.querySelectorAll('canvas')).toHaveLength(0);
    });

    it('light／dark theme 都提供獨立亮黃色分日線 token', () => {
        expect(
            getChartColors({ mode: 'dark', convention: 'tw', fontScale: 1 })
                .dayBoundary,
        ).toBe('#facc15');
        expect(
            getChartColors({ mode: 'light', convention: 'tw', fontScale: 1 })
                .dayBoundary,
        ).toBe('#ca8a04');
        expect(
            getChartColors({ mode: 'dark', convention: 'tw', fontScale: 1 })
                .dayBoundary,
        ).not.toBe(
            getChartColors({ mode: 'dark', convention: 'tw', fontScale: 1 })
                .grid,
        );
    });

    for (const chartCount of [1, 2, 4, 8]) {
        it(`${chartCount} 圖亮黃色分日線跨 pane、resize、縮放與 cleanup`, async () => {
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const runtimes = Array.from({ length: chartCount }, (_, index) => {
                const host = document.createElement('div');
                host.style.width = '320px';
                host.style.height = '220px';
                document.body.append(host);
                const chart = createChart(host, {
                    width: 320,
                    height: 220,
                    layout: {
                        background: { type: ColorType.Solid, color: '#111827' },
                        textColor: '#cbd5e1',
                    },
                });
                const candles = chart.addSeries(CandlestickSeries);
                const paneSeries = chart.addSeries(
                    LineSeries,
                    { color: '#38bdf8' },
                    1,
                );
                const first = (1_700_000_000 + index * 10_000) as UTCTimestamp;
                const second = (first + 60) as UTCTimestamp;
                candles.setData([
                    { time: first, open: 100, high: 102, low: 99, close: 101 },
                    { time: second, open: 101, high: 103, low: 100, close: 102 },
                ]);
                paneSeries.setData([
                    { time: first, value: 50 },
                    { time: second, value: 51 },
                ]);
                const manager = new DayBoundaryPaneManager();
                manager.reconcile(
                    chart.panes(),
                    [{ previousTime: first, nextTime: second }],
                    '#facc15',
                );
                chart.timeScale().fitContent();
                return { host, chart, manager };
            });

            await new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                ),
            );
            for (const runtime of runtimes) {
                expect(runtime.manager.size).toBe(2);
                const yellowPixels = [...runtime.host.querySelectorAll('canvas')]
                    .map((canvas) => {
                        const context = canvas.getContext('2d');
                        if (!context) return 0;
                        const pixels = context.getImageData(
                            0,
                            0,
                            canvas.width,
                            canvas.height,
                        ).data;
                        let count = 0;
                        for (let offset = 0; offset < pixels.length; offset += 4) {
                            const red = pixels[offset] ?? 0;
                            const green = pixels[offset + 1] ?? 0;
                            const blue = pixels[offset + 2] ?? 0;
                            if (
                                red >= 80 &&
                                green >= 70 &&
                                blue <= 70 &&
                                red > green &&
                                green > blue * 1.5 &&
                                pixels[offset + 3] === 255
                            ) {
                                count += 1;
                            }
                        }
                        return count;
                    })
                    .reduce((sum, count) => sum + count, 0);
                expect(yellowPixels).toBeGreaterThan(0);
                runtime.chart.resize(360, 240);
                runtime.chart.timeScale().scrollToPosition(1, false);
                runtime.manager.destroy();
                expect(runtime.manager.size).toBe(0);
                runtime.chart.remove();
                expect(runtime.host.querySelectorAll('canvas')).toHaveLength(0);
            }
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();
        });
    }

    for (const chartCount of [1, 2, 4, 8]) {
        it(`${chartCount} 圖 Fibonacci controller／storage／overlay 維持隔離`, async () => {
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const runtimes = Array.from({ length: chartCount }, (_, index) => {
                const host = document.createElement('div');
                host.style.width = '320px';
                host.style.height = '180px';
                document.body.append(host);
                const chart = createChart(host, { width: 320, height: 180 });
                const series = chart.addSeries(CandlestickSeries);
                series.setData([
                    { time: 1 as UTCTimestamp, open: 90, high: 110, low: 85, close: 100 },
                    { time: 2 as UTCTimestamp, open: 100, high: 130, low: 98, close: 125 },
                    { time: 3 as UTCTimestamp, open: 125, high: 128, low: 105, close: 110 },
                ]);
                chart.timeScale().fitContent();
                const identity = fibonacciIdentity({
                    securityType: index % 2 === 0 ? 'STK' : 'IND',
                    exchange: index % 2 === 0 ? 'TSE' : 'TAIFEX',
                    canonicalCode: `FIB${index}`,
                    timeframeMinutes: index % 2 === 0 ? 5 : 60,
                });
                const controller = createFibonacciController({
                    getIdentity: () => identity,
                    storage: localStorage,
                });
                controller.restore();
                controller.arm(index % 2 === 0 ? 'retracement' : 'extension');
                controller.addPoint({ time: 1, price: 100 + index / 10 });
                controller.addPoint({ time: 2, price: 110 + index / 10 });
                if (index % 2 === 1) {
                    controller.addPoint({ time: 3, price: 100 + index / 10 });
                }
                return { host, chart, series, identity, controller };
            });

            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            const models = runtimes.map((runtime) =>
                buildFibonacciOverlayModel(runtime.controller.getSnapshot(), {
                    width: 320,
                    height: 180,
                    rightEdge: 270,
                    coordinates: {
                        timeToCoordinate: (time) =>
                            runtime.chart
                                .timeScale()
                                .timeToCoordinate(time as UTCTimestamp),
                        priceToCoordinate: (price) =>
                            runtime.series.priceToCoordinate(price),
                    },
                    formatPrice: (price) => price.toFixed(2),
                }),
            );
            expect(new Set(runtimes.map(({ identity }) => identity)).size).toBe(
                chartCount,
            );
            expect(localStorage.length).toBe(chartCount);
            expect(models.every((model) => model.lines.length >= 7)).toBe(true);

            for (let tick = 0; tick < 20; tick += 1) {
                runtimes.forEach((runtime) => {
                    runtime.series.update({
                        time: 3 as UTCTimestamp,
                        open: 125,
                        high: 128 + tick / 10,
                        low: 105,
                        close: 110 + tick / 10,
                    });
                    expect(runtime.chart.panes()).toHaveLength(1);
                });
            }
            runtimes.forEach((runtime) => {
                runtime.chart.resize(360, 200);
                runtime.chart.timeScale().scrollToPosition(1, false);
                runtime.controller.clear('all');
                runtime.chart.remove();
                expect(runtime.host.querySelectorAll('canvas')).toHaveLength(0);
            });
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();
        });
    }

    for (const chartCount of [1, 2, 4, 8]) {
        it(`${chartCount} 圖資料 refresh 維持 series／pane identity 且可清理`, async () => {
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const runtimes = Array.from({ length: chartCount }, () => {
                const host = document.createElement('div');
                host.style.width = '320px';
                host.style.height = '180px';
                document.body.append(host);
                const chart = createChart(host, {
                    width: 320,
                    height: 180,
                });
                const series = chart.addSeries(LineSeries, {
                    color: '#3d8bff',
                    priceLineVisible: false,
                });
                const paneSeries = chart.addSeries(
                    LineSeries,
                    { color: '#e0a43c', priceLineVisible: false },
                    1,
                );
                return {
                    host,
                    chart,
                    series,
                    paneSeries,
                    panes: [...chart.panes()],
                };
            });

            for (let tick = 0; tick < 40; tick++) {
                for (const runtime of runtimes) {
                    runtime.series.setData([
                        { time: 1 as UTCTimestamp, value: 100 },
                        { time: 2 as UTCTimestamp, value: 101 + tick / 10 },
                    ]);
                    runtime.paneSeries.setData([
                        { time: 1 as UTCTimestamp, value: 50 },
                        { time: 2 as UTCTimestamp, value: 49 - tick / 10 },
                    ]);
                    expect(runtime.chart.panes()[0]).toBe(runtime.panes[0]);
                    expect(runtime.chart.panes()[1]).toBe(runtime.panes[1]);
                    expect(runtime.chart.panes()).toHaveLength(2);
                }
            }
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
            );
            for (const runtime of runtimes) {
                expect(runtime.host.querySelectorAll('canvas').length).toBeGreaterThan(0);
                runtime.chart.remove();
                expect(runtime.host.querySelectorAll('canvas')).toHaveLength(0);
            }
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();
        });
    }

    it('回測 stable renderer 更新資料時不重建副圖 pane', () => {
        updateInstances(() => [newInstance('atr')]);
        const host = document.createElement('div');
        host.style.width = '480px';
        host.style.height = '260px';
        document.body.append(host);
        const chart = createChart(host, { width: 480, height: 260 });
        const renderer = createIndicatorSeriesRenderer(
            chart,
            1,
            {
                up: '#20c997',
                upVol: '#20c997',
                down: '#ff4055',
                downVol: '#ff4055',
                text: '#8b94a7',
                grid: '#222b37',
                dayBoundary: '#facc15',
                crosshair: '#3d8bff',
                border: '#222b37',
                labelBg: '#181f2a',
            },
        );
        const candles: Candle[] = Array.from({ length: 30 }, (_, index) => ({
            time: 1_700_000_000 + index * 60,
            open: 100 + index,
            high: 102 + index,
            low: 99 + index,
            close: 101 + index,
            volume: 1000 + index,
            turnoverTwd: null,
        }));
        renderer.update(candles);
        const pane = chart.panes()[1];
        const updated = candles.map((bar) => ({ ...bar }));
        updated[updated.length - 1]!.close += 3;
        renderer.update(updated);
        expect(chart.panes()[1]).toBe(pane);
        expect(renderer.legend).toHaveLength(1);
        renderer.destroy();
        expect(chart.panes()).toHaveLength(1);
        chart.remove();
    });

    for (const chartCount of [1, 2, 4, 8]) {
        it(`${chartCount} 圖 FVG／Volume Profile primitive 隔離、resize 與 cleanup`, () => {
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            const runtimes = Array.from({ length: chartCount }, (_, index) => {
                const host = document.createElement('div');
                host.style.width = '300px';
                host.style.height = '180px';
                document.body.append(host);
                const chart = createChart(host, {
                    width: 300,
                    height: 180,
                });
                const candles = chart.addSeries(CandlestickSeries);
                candles.setData([
                    { time: 1 as UTCTimestamp, open: 10, high: 12, low: 9, close: 11 },
                    { time: 2 as UTCTimestamp, open: 11, high: 13, low: 10, close: 12 },
                    { time: 3 as UTCTimestamp, open: 13, high: 15, low: 13, close: 14 },
                ]);
                const primitive = new MarketOverlayPrimitive(candles);
                const pane = chart.panes()[0]!;
                pane.attachPrimitive(primitive);
                primitive.setData(
                    [
                        {
                            id: `zone-${index}`,
                            direction: 'bullish',
                            startTime: 1,
                            endTime: 3,
                            lower: 12,
                            upper: 13,
                            fullyMitigated: false,
                        },
                    ],
                    [{ time: 3, direction: 'bullish', price: 13 }],
                    {
                        anchors: { startTime: 1, endTime: 3 },
                        bins: [
                            { index: 0, lower: 10, upper: 11, volume: 100 },
                        ],
                        totalVolume: 100,
                        poc: 10.5,
                        vah: 11,
                        val: 10,
                    },
                );
                chart.resize(320, 200);
                return { host, chart, pane, primitive };
            });
            for (const runtime of runtimes) {
                expect(runtime.host.querySelectorAll('canvas').length).toBeGreaterThan(0);
                runtime.pane.detachPrimitive(runtime.primitive);
                runtime.chart.remove();
                expect(runtime.host.querySelectorAll('canvas')).toHaveLength(0);
            }
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();
        });
    }

    for (const chartCount of [1, 2, 4, 8]) {
        it(`${chartCount} 圖 Pivot 七線 generation 隔離與 cleanup`, () => {
            const runtimes = Array.from({ length: chartCount }, (_, index) => {
                const host = document.createElement('div');
                host.style.width = '300px';
                host.style.height = '180px';
                document.body.append(host);
                const chart = createChart(host, { width: 300, height: 180 });
                const candles = chart.addSeries(CandlestickSeries);
                candles.setData([
                    { time: 1 as UTCTimestamp, open: 90, high: 110, low: 90, close: 100 },
                    { time: 2 as UTCTimestamp, open: 100, high: 112, low: 98, close: 108 },
                ]);
                const primitive = new PivotPrimitive(candles);
                const pane = chart.panes()[0]!;
                pane.attachPrimitive(primitive);
                primitive.setData({
                    date: `2026-08-0${index + 1}`,
                    high: 110,
                    low: 90,
                    close: 100,
                    firstTime: 1,
                    lastTime: 1,
                    status: 'completed',
                    applicationDate: '2026-08-06',
                    applicationStartTime: 2,
                    levels: {
                        p: 100,
                        r1: 110,
                        r2: 120,
                        r3: 130,
                        s1: 90,
                        s2: 80,
                        s3: 70,
                    },
                });
                return { host, chart, pane, primitive };
            });
            expect(
                new Set(
                    runtimes.map(
                        (runtime) => runtime.primitive.reference?.date,
                    ),
                ).size,
            ).toBe(chartCount);
            for (const runtime of runtimes) {
                runtime.pane.detachPrimitive(runtime.primitive);
                runtime.chart.remove();
                expect(runtime.host.querySelectorAll('canvas')).toHaveLength(0);
            }
        });
    }
});
