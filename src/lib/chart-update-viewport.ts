import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { HmrChartViewport } from './hmr-view-state';

/** Offsets anchor to a real candle, so prepended history cannot shift the view. */
export function captureChartViewport(identity: string, chart: IChartApi, series: ISeriesApi<'Candlestick'>, bars: readonly { time: number }[]): HmrChartViewport | null {
    const range = chart.timeScale().getVisibleLogicalRange();
    const anchor = bars.at(-1);
    if (!range || !anchor) return null;
    const scale = series.priceScale();
    const priceRange = scale.getVisibleRange();
    return { identity, anchorTime: anchor.time, from: range.from - (bars.length - 1), to: range.to - (bars.length - 1),
        autoScale: scale.options().autoScale, ...(priceRange ? { priceRange } : {}),
        paneHeights: chart.panes().map(pane => pane.getHeight()) };
}
export function restoreChartViewport(saved: HmrChartViewport, identity: string, chart: IChartApi, series: ISeriesApi<'Candlestick'>, bars: readonly { time: number }[]) {
    if (saved.identity !== identity || !bars.length) return false;
    const anchor = bars.findIndex(bar => bar.time === saved.anchorTime);
    if (anchor < 0) return false;
    chart.timeScale().setVisibleLogicalRange({ from: anchor + saved.from, to: anchor + saved.to });
    const scale = series.priceScale();
    if (!saved.autoScale && saved.priceRange) scale.setVisibleRange(saved.priceRange);
    scale.applyOptions({ autoScale: saved.autoScale });
    saved.paneHeights.forEach((height, index) => chart.panes()[index]?.setHeight(height));
    return true;
}
