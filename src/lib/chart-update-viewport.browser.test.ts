import { expect, it } from 'vitest';
import { CandlestickSeries, LineSeries, createChart, type UTCTimestamp } from 'lightweight-charts';
import { captureChartViewport, restoreChartViewport } from './chart-update-viewport';
import { updateInteractionIdle } from './app-update-client';

it('重新建立圖表後恢復同商品週期的捲動、縮放、價格範圍及分區高度，補入前綴不位移', async () => {
    const host = document.createElement('div'); document.body.append(host);
    let chart = createChart(host, {width:800,height:450});
    let series = chart.addSeries(CandlestickSeries);
    const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bars = Array.from({length:100},(_,i)=>({time:(1700000000+i*60) as UTCTimestamp,open:100+i,high:103+i,low:98+i,close:101+i}));
    try {
        series.setData(bars); chart.addSeries(LineSeries, {}, 1).setData(bars.map(b => ({time:b.time,value:b.close})));
        chart.panes()[0]!.setHeight(300); chart.panes()[1]!.setHeight(100);
        chart.timeScale().setVisibleLogicalRange({from:20,to:65});
        series.priceScale().setVisibleRange({from:110,to:180}); series.priceScale().applyOptions({autoScale:false});
        await paint();
        const saved = captureChartViewport('STK|TSE|2330|5',chart,series,bars)!;
        const prefix = Array.from({length:10},(_,i)=>({...bars[0]!,time:(1700000000+(i-10)*60) as UTCTimestamp}));
        chart.remove(); chart = createChart(host, {width:800,height:450}); series = chart.addSeries(CandlestickSeries);
        series.setData([...prefix,...bars]); chart.addSeries(LineSeries, {}, 1).setData(bars.map(b => ({time:b.time,value:b.close})));
        chart.panes()[0]!.setHeight(100); chart.panes()[1]!.setHeight(300); await paint();
        expect(restoreChartViewport(saved,'STK|TSE|2330|5',chart,series,[...prefix,...bars])).toBe(true);
        await paint();
        const range=chart.timeScale().getVisibleLogicalRange()!;
        expect(range.from).toBeCloseTo(30); expect(range.to).toBeCloseTo(75);
        expect(series.priceScale().options().autoScale).toBe(false);
        saved.paneHeights.forEach((height,i)=>expect(Math.abs(chart.panes()[i]!.getHeight()-height)).toBeLessThanOrEqual(2));
        expect(series.priceScale().getVisibleRange()!.from).toBeCloseTo(110);
        expect(restoreChartViewport(saved,'STK|TSE|2454|5',chart,series,bars)).toBe(false);
        expect(restoreChartViewport(saved,'STK|TSE|2330|1',chart,series,bars)).toBe(false);
        expect(restoreChartViewport(saved,'STK|TSE|2330|5',chart,series,bars.slice(0,30))).toBe(false);
    } finally { chart.remove(); host.remove(); }
});
it('輸入、對話框、選單與拖曳期間延後更新', () => {
    const input=document.createElement('input'), dialog=document.createElement('div');document.body.append(input,dialog);
    try {
        input.focus(); expect(updateInteractionIdle(document,false)).toBe(false);input.blur();
        dialog.setAttribute('role','dialog'); expect(updateInteractionIdle(document,false)).toBe(false);
        dialog.setAttribute('role','listbox'); expect(updateInteractionIdle(document,false)).toBe(false);
        dialog.removeAttribute('role');expect(updateInteractionIdle(document,true)).toBe(false);
        expect(updateInteractionIdle(document,false)).toBe(true);
    } finally {input.remove();dialog.remove();}
});
