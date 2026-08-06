// src/lib/chart-indicators.ts — 把使用者目前的指標設定（與主圖同一份
// sj-pro-indicators-v3）渲染到任意 lightweight-charts 實例上。
// 回測面板的進出場 K 線用它取得與主圖一致的指標畫面；呼叫端整個
// chart 重建時序列一起銷毀，不需要個別清理。

import {
    AreaSeries,
    HistogramSeries,
    LineSeries,
    LineStyle,
    LineType,
    type IChartApi,
    type ISeriesApi,
    type SeriesDataItemTypeMap,
    type UTCTimestamp,
} from 'lightweight-charts';
import {
    colorWithOpacity,
    DEF_BY_TYPE,
    instanceLabel,
    getInstancesSnapshot,
    outputStyle,
} from './indicator-defs';
import type { IndicatorPoint } from './indicators';
import type { ChartColors } from './theme-store';
import type { Candle } from './types/market';

export interface IndicatorLegendItem {
    label: string; // e.g. "MA(20)"
    color: string;
    pane: number; // 0 = 主圖
}

export interface StableIndicatorRenderer {
    readonly legend: readonly IndicatorLegendItem[];
    update(bars: Candle[]): void;
    destroy(): void;
}

export function createIndicatorSeriesRenderer(
    chart: IChartApi,
    tfMinutes: number,
    colors: ChartColors,
): StableIndicatorRenderer {
    const legend: IndicatorLegendItem[] = [];
    const created: ISeriesApi<'Line' | 'Histogram' | 'Area'>[] = [];
    const runtimes: {
        inst: (typeof instances)[number];
        def: Extract<(typeof DEF_BY_TYPE extends Map<string, infer D> ? D : never), { kind: 'series' }>;
        outputs: Map<
            string,
            {
                series: ISeriesApi<'Line' | 'Histogram' | 'Area'>;
                plot: string;
                color: string;
                signed?: boolean;
            }
        >;
    }[] = [];
    const instances = getInstancesSnapshot();
    const toLineData = (pts: IndicatorPoint[]) =>
        pts.map((p) =>
            p.value === undefined
                ? { time: p.time as UTCTimestamp }
                : { time: p.time as UTCTimestamp, value: p.value },
        ) as SeriesDataItemTypeMap['Line'][];

    let paneIdx = 1;
    for (const inst of instances) {
        const def = DEF_BY_TYPE.get(inst.type);
        if (!def || def.kind !== 'series') continue;
        if (inst.hidden) continue;
        if (inst.visibleTf && !inst.visibleTf.includes(tfMinutes)) continue;
        const pane = def.render.pane === 'dedicated' ? paneIdx++ : 0;
        const outputRuntimes = new Map<
            string,
            {
                series: ISeriesApi<'Line' | 'Histogram' | 'Area'>;
                plot: string;
                color: string;
                signed?: boolean;
            }
        >();
        let firstSeries: ISeriesApi<'Line' | 'Histogram' | 'Area'> | null =
            null;
        const priceFormatOpt =
            inst.precision !== undefined
                ? {
                      priceFormat: {
                          type: 'price' as const,
                          precision: inst.precision,
                          minMove: Math.pow(10, -inst.precision),
                      },
                  }
                : {};
        const quiet = { priceLineVisible: false, lastValueVisible: false };
        const renderTargetOpt = def.render.priceScaleId
            ? { priceScaleId: def.render.priceScaleId }
            : {};
        for (const o of def.outputs) {
            const st = outputStyle(inst, def, o.key);
            if (!st.visible) continue;
            const color = colorWithOpacity(st.color, st.opacity);
            let s: ISeriesApi<'Line' | 'Histogram' | 'Area'>;
            if (st.plot === 'histogram') {
                s = chart.addSeries(
                    HistogramSeries,
                    { color, ...quiet, ...renderTargetOpt, ...priceFormatOpt },
                    pane,
                );
            } else if (st.plot === 'area') {
                s = chart.addSeries(
                    AreaSeries,
                    {
                        lineColor: color,
                        lineWidth: st.width,
                        topColor: colorWithOpacity(
                            st.color,
                            Math.min(st.opacity, 28),
                        ),
                        bottomColor: 'rgba(0, 0, 0, 0)',
                        crosshairMarkerVisible: false,
                        ...renderTargetOpt,
                        ...quiet,
                        ...priceFormatOpt,
                    },
                    pane,
                );
            } else {
                s = chart.addSeries(
                    LineSeries,
                    {
                        color,
                        lineWidth: st.width,
                        lineStyle:
                            o.kind === 'dashed'
                                ? LineStyle.Dashed
                                : LineStyle.Solid,
                        lineType:
                            st.plot === 'step'
                                ? LineType.WithSteps
                                : LineType.Simple,
                        crosshairMarkerVisible: false,
                        ...renderTargetOpt,
                        ...(st.plot === 'circles'
                            ? {
                                  lineVisible: false,
                                  pointMarkersVisible: true,
                                  pointMarkersRadius: 1.5,
                              }
                            : {}),
                        ...quiet,
                        ...priceFormatOpt,
                    },
                    pane,
                );
            }
            created.push(s);
            outputRuntimes.set(o.key, {
                series: s,
                plot: st.plot,
                color,
                signed: o.signed,
            });
            firstSeries ??= s;
        }
        if (firstSeries) {
            legend.push({
                label: instanceLabel(inst),
                color: outputStyle(inst, def, def.outputs[0]!.key).color,
                pane,
            });
            if (pane > 0 && def.levels) {
                for (const lv of def.levels) {
                    firstSeries.createPriceLine({
                        price: lv,
                        color: colors.grid,
                        lineWidth: 1,
                        lineStyle: LineStyle.Dotted,
                        axisLabelVisible: false,
                        title: '',
                    });
                }
            }
            // 副圖 pane 給個合理的初始高度
            if (pane > 0) {
                try {
                    chart.panes()[pane]?.setHeight(70);
                } catch {
                    // pane API 差異不致命
                }
            }
        }
        runtimes.push({ inst, def, outputs: outputRuntimes });
    }
    return {
        legend,
        update(bars) {
            for (const runtime of runtimes) {
                const params = Object.fromEntries(
                    runtime.def.params.map((param) => [
                        param.key,
                        runtime.inst.params[param.key] ?? param.def,
                    ]),
                );
                let output: Record<string, IndicatorPoint[]>;
                try {
                    output = runtime.def.compute(bars, params);
                } catch {
                    continue;
                }
                for (const [key, seriesRuntime] of runtime.outputs) {
                    const points = output[key];
                    if (!points) continue;
                    if (seriesRuntime.plot === 'histogram') {
                        seriesRuntime.series.setData(
                            points
                                .filter((point) => point.value !== undefined)
                                .map((point) => ({
                                    time: point.time as UTCTimestamp,
                                    value: point.value!,
                                    color: seriesRuntime.signed
                                        ? point.value! >= 0
                                            ? colors.upVol
                                            : colors.downVol
                                        : seriesRuntime.color,
                                })) as SeriesDataItemTypeMap['Histogram'][],
                        );
                    } else {
                        seriesRuntime.series.setData(toLineData(points));
                    }
                }
            }
        },
        destroy() {
            for (const series of created.reverse()) {
                try {
                    chart.removeSeries(series);
                } catch {
                    // chart may already have been destroyed by its owner
                }
            }
            try {
                for (let index = chart.panes().length - 1; index >= 1; index--) {
                    chart.removePane(index);
                }
            } catch {
                // pane API differences are non-fatal
            }
        },
    };
}

// 相容既有一次性呼叫端；需要重複更新時改用上方 stable renderer handle。
export function renderIndicatorSeries(
    chart: IChartApi,
    bars: Candle[],
    tfMinutes: number,
    colors: ChartColors,
): IndicatorLegendItem[] {
    if (bars.length === 0) return [];
    const renderer = createIndicatorSeriesRenderer(chart, tfMinutes, colors);
    renderer.update(bars);
    return [...renderer.legend];
}
