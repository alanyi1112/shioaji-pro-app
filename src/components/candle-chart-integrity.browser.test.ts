import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { ContractInfo } from '../lib/types/contract';
import type { KBars } from '../lib/types/market';
import type { QuoteState, StreamStatus } from '../lib/stream';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { dateStrOffset } from '../lib/utils/kbars';
import { resetChartKbarMemoryCacheForTests, rememberChartKbars, recallChartKbars } from '../lib/chart-kbar-memory-cache';
import { CandleChart } from './candle-chart';
import { darkTwClass } from '../theme.css';

const fixture = vi.hoisted(() => ({
    quote: undefined as QuoteState | undefined,
    listeners: new Set<() => void>(),
    status: 'live' as StreamStatus,
    statusListeners: new Set<() => void>(),
    fetchKbars: vi.fn(),
    chart: null as IChartApi | null,
    candles: null as ISeriesApi<'Candlestick'> | null,
}));
vi.mock('lightweight-charts', async (original) => {
    const actual = await original<typeof import('lightweight-charts')>();
    return { ...actual, createChart: (...args: Parameters<typeof actual.createChart>) => {
        const chart = actual.createChart(...args); fixture.chart = chart;
        const add = chart.addSeries.bind(chart);
        chart.addSeries = ((...seriesArgs: Parameters<typeof chart.addSeries>) => {
            const series = add(...seriesArgs);
            if (seriesArgs[0] === actual.CandlestickSeries) fixture.candles = series as ISeriesApi<'Candlestick'>;
            return series;
        }) as typeof chart.addSeries;
        return chart;
    } };
});
vi.mock('../hooks/use-stream', () => ({
    useQuote: () => useSyncExternalStore(
        (listener) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); },
        () => fixture.quote,
    ),
    useTradingLive: () => false,
    useStreamStatus: () => useSyncExternalStore(
        listener => { fixture.statusListeners.add(listener); return () => fixture.statusListeners.delete(listener); },
        () => fixture.status,
    ),
}));
vi.mock('../lib/shioaji', () => ({
    fetchKbars: fixture.fetchKbars,
    fetchInfo: vi.fn(async () => ({ simulation: true })),
    fetchAccounts: vi.fn(async () => []),
    cancelFuturesOrder: vi.fn(), cancelOrder: vi.fn(),
    updateFuturesOrderPrice: vi.fn(), updateOrderPrice: vi.fn(),
}));
vi.mock('../lib/trade', () => ({ notify: vi.fn(), placeQuickOrder: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const contract: ContractInfo = {
    code: '3090', name: '隔離測試', security_type: 'STK', region: 'TW', exchange: 'TSE',
    target_code: null, currency: 'TWD', reference: 10, limit_up: 11, limit_down: 9,
    day_trade: 'Yes', update_date: '2026-10-05', category: '', margin_trading_balance: 0, short_selling_balance: 0,
};
const initialBars = (): KBars => ({
    datetime: ['2026-10-05T09:00:00'], Open: [10], High: [10], Low: [10], Close: [10], Volume: [100], Amount: [1_000_000],
});

describe('CandleChart 真正 Chromium／合成來源隔離驗收（非 live）', () => {
    let root: Root;
    let host: HTMLDivElement;
    const diagnostic = () => host.querySelector<HTMLElement>('[data-chart-diagnostic-schema]')!.dataset;
    const settle = () => act(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const waitTail = async (volume: number) => {
        await expect.poll(() => Number(diagnostic().chartTailVolume)).toBe(volume);
    };
    const switchTo = async (label: string) => {
        await act(async () => {
            [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click();
        });
        await expect.poll(() => diagnostic().chartTimeframeMinutes).toBe(label === '1D' ? '1440' : label.slice(0, -1));
        await expect.poll(() => /載入\s+(?:1m|5m|15m|60m|1D)\s+K 線…/.test(host.textContent ?? '')).toBe(false);
        await settle();
    };
    const emit = async (minute: number, total: number, seq: number) => {
        await act(async () => {
            fixture.quote = { seq, flashSeq: seq, lastDir: 0, tick: {
                code: '3090', date: '2026-10-05', time: `09:${String(minute).padStart(2, '0')}:10`,
                open: '10', high: '10', low: '10', close: '10', volume: total === 103 ? 3 : 1,
                total_volume: total, amount: total === 103 ? '30000' : '10000', total_amount: String(total * 10000),
                tick_type: 1, simtrade: false,
            } };
            fixture.listeners.forEach(listener => listener());
        });
    };
    const connection = async (status: StreamStatus) => act(async () => {
        fixture.status = status;
        fixture.statusListeners.forEach(listener => listener());
    });
    beforeEach(async () => {
        await page.viewport(1100, 760);
        localStorage.clear(); resetChartKbarMemoryCacheForTests(); fixture.quote = undefined; fixture.status = 'live';
        fixture.fetchKbars.mockReset().mockResolvedValue(initialBars());
        // Any unexpected HTTP path fails locally; this harness never touches broker/runtime.
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('isolated_network_disabled'));
        host = document.createElement('div'); host.className = darkTwClass;
        host.style.cssText = 'width:960px;height:600px;display:flex;flex-direction:column;background:#0f141c;color:#cbd5e1';
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root.render(createElement(CandleChart, { contract })));
        await waitTail(100);
        await settle();
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        fixture.listeners.clear(); fixture.statusListeners.clear(); vi.restoreAllMocks(); document.body.replaceChildren();
    });
    it('同分鐘只加一次、拒絕重播與舊分鐘，跨三個分鐘後切週期不崩潰', async () => {
        await switchTo('1m');
        await emit(0, 103, 1);
        expect(Number(diagnostic().chartTailVolume)).toBe(103);
        expect(Number(diagnostic().chartRawTailVolume)).toBe(103);
        expect(Number(diagnostic().chartTailTurnover)).toBe(1_030_000);
        await emit(0, 103, 1); // replay
        expect(Number(diagnostic().chartTailVolume)).toBe(103);
        for (let minute = 1; minute <= 3; minute++) await emit(minute, 103 + minute, minute + 1);
        expect(Number(diagnostic().chartCandleCount)).toBe(4);
        expect(Number(diagnostic().chartRawCount)).toBe(4);
        expect(Number(diagnostic().chartTailVolume)).toBe(1);
        await emit(1, 200, 99); // older minute cannot consume a new cumulative total
        expect(Number(diagnostic().chartCandleCount)).toBe(4);
        expect(Number(diagnostic().chartTailVolume)).toBe(1);
        expect(host.querySelectorAll('canvas').length).toBeGreaterThan(0);
        expect([...host.querySelectorAll('canvas')].some(canvas => canvas.getBoundingClientRect().height > 100)).toBe(true);
        // Frozen REST fixture includes the same four accepted minute totals.
        fixture.quote = undefined;
        fixture.fetchKbars.mockResolvedValue({
            datetime: [0, 1, 2, 3].map(m => `2026-10-05T09:0${m}:00`),
            Open: [10,10,10,10], High: [10,10,10,10], Low: [10,10,10,10], Close: [10,10,10,10],
            Volume: [103,1,1,1], Amount: [1030000,10000,10000,10000],
        });
        for (const label of ['5m','1m','1D','1m']) await switchTo(label);
        expect(Number(diagnostic().chartCandleCount)).toBe(4);
        expect(host.querySelector('[role="alert"]')).toBeNull();
        await act(async () => {
            console.info('隔離 Chromium 圖表截圖', await page.screenshot({
                path: `__screenshots__/candle-chart-integrity.browser.test.ts/passing-fixture-${Date.now()}.png`,
                element: host,
            }));
        });
    });
    it('污染 cache 僅目前 key miss，沿用一次 bootstrap，合法其他 key 不受影響', async () => {
        const bars = [{ time: 60, open: 10, high: 10, low: 10, close: 10, volume: 100, turnoverTwd: 1000000 }];
        rememberChartKbars('other-product', bars);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        rememberChartKbars('STK|TW|TSE|3090||1', [...bars, {...bars[0]!}]);
        expect(recallChartKbars('STK|TW|TSE|3090||1')).toBeNull();
        expect(recallChartKbars('other-product')).toEqual(bars);
        const calls = fixture.fetchKbars.mock.calls.length;
        await switchTo('1m'); await waitTail(100);
        expect(fixture.fetchKbars.mock.calls.slice(calls).filter(args => args[2] === dateStrOffset(0))).toHaveLength(1);
        expect(warn).toHaveBeenCalled();
    });
    it('history prepend 保留 live tail、後續增量更新新 tail，平移不改 barSpacing', async () => {
        await switchTo('1m'); await emit(0, 103, 1); await emit(1, 104, 2);
        const older: KBars = {
            datetime: Array.from({length: 60}, (_, i) => `2026-10-02T10:${String(i).padStart(2,'0')}:00`),
            Open: Array(60).fill(9), High: Array(60).fill(9), Low: Array(60).fill(9), Close: Array(60).fill(9),
            Volume: Array(60).fill(1), Amount: Array(60).fill(9000),
        };
        fixture.fetchKbars.mockResolvedValue(older);
        const scale = fixture.chart!.timeScale();
        const spacing = scale.options().barSpacing;
        await act(async () => { scale.scrollToPosition(20, false); });
        await settle();
        await expect.poll(() => Number(diagnostic().chartCandleCount)).toBe(62);
        await emit(1, 105, 3);
        expect(Number(diagnostic().chartTailVolume)).toBe(2);
        expect(Number(diagnostic().chartRawTailVolume)).toBe(2);
        expect(Number(diagnostic().chartTailTurnover)).toBe(20000);
        expect(Number(diagnostic().chartCandleCount)).toBe(62);
        expect(scale.options().barSpacing).toBe(spacing);
        expect(diagnostic().chartTimelineState).toBe('valid');
    });
    it('舊 generation 延遲回應不能覆蓋已切換商品的系列', async () => {
        await emit(0, 103, 1);
        expect(diagnostic().chartLastAcceptedTrade).toBeDefined();
        let resolveOld!: (bars: KBars) => void;
        fixture.fetchKbars.mockImplementationOnce(() => new Promise<KBars>(resolve => { resolveOld = resolve; }));
        await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '1m')!.click());
        expect(diagnostic().chartLastAcceptedTrade).toBeUndefined();
        const other = {...contract, code:'2449', name:'另一隔離商品'};
        fixture.fetchKbars.mockResolvedValue({...initialBars(), Close:[20], Open:[20], High:[20], Low:[20], Volume:[7], Amount:[140000]});
        await act(async () => root.render(createElement(CandleChart, {contract:other})));
        await waitTail(7);
        await act(async () => resolveOld(initialBars()));
        expect(diagnostic().chartCode).toBe('2449');
        expect(diagnostic().chartLastAcceptedTrade).toBeUndefined();
        expect(Number(diagnostic().chartTailVolume)).toBe(7);
        expect(Number(diagnostic().chartTailTurnover)).toBe(140000);
    });
    it('真實 series 提交失敗後只回復一次同 generation 系列，保留局部可操作 UI', async () => {
        await switchTo('1m'); await emit(0, 103, 1);
        const previous = fixture.candles!.data().map(row => ({...row}));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const setData = vi.spyOn(fixture.candles!, 'setData').mockImplementationOnce(() => { throw new Error('isolated-setData-failure'); });
        fixture.fetchKbars.mockResolvedValue({...initialBars(), datetime:['2026-10-02T09:00:00']});
        await act(async () => fixture.chart!.timeScale().scrollToPosition(20, false));
        await settle();
        await expect.poll(() => host.querySelector('[role="alert"]')?.textContent).toContain('isolated-setData-failure');
        expect(setData).toHaveBeenCalledTimes(2); // one submission and one rollback
        expect(fixture.candles!.data()).toEqual(previous);
        expect(Number(diagnostic().chartTailVolume)).toBe(103);
        expect(warn).toHaveBeenCalled();
        setData.mockRestore();
        fixture.fetchKbars.mockResolvedValue(initialBars());
        await switchTo('5m');
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    it('不合法 bootstrap 留在局部 alert，其他按鈕可操作、沒有無限 fetch', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const invalid = initialBars(); invalid.datetime[0] = 'invalid-date';
        fixture.fetchKbars.mockResolvedValue(invalid);
        const calls = fixture.fetchKbars.mock.calls.length;
        await switchTo('1m');
        await expect.poll(() => host.querySelector('[role="alert"]')?.textContent).toContain('失敗');
        expect(fixture.fetchKbars.mock.calls.length - calls).toBe(1);
        fixture.fetchKbars.mockResolvedValue(initialBars());
        await switchTo('5m'); await waitTail(100);
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    it('近期先顯示，較早歷史失敗保留 live tail，手動重試可恢復', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        let progress!: (bars: KBars) => void;
        let rejectOlder!: (error: Error) => void;
        fixture.fetchKbars.mockImplementationOnce((_c, _start, _end, _signal, options) => {
            progress = options.onProgress;
            return new Promise<KBars>((_resolve, reject) => { rejectOlder = reject; });
        });
        await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '1m')!.click());
        await act(async () => progress(initialBars()));
        await waitTail(100);
        expect(host.textContent).not.toContain('載入 1m K 線');
        await emit(0, 103, 1); await emit(1, 104, 2);
        const olderAndRecent: KBars = {
            datetime: ['2026-10-02T09:00:00', '2026-10-05T09:00:00'],
            Open:[9,10],High:[9,10],Low:[9,10],Close:[9,10],Volume:[1,100],Amount:[9000,1000000],
        };
        await act(async () => progress(olderAndRecent));
        expect(Number(diagnostic().chartCandleCount)).toBe(3);
        expect(Number(diagnostic().chartRawCount)).toBe(3);
        expect(Number(diagnostic().chartTailVolume)).toBe(1);
        await emit(1, 105, 3);
        expect(Number(diagnostic().chartTailVolume)).toBe(2);
        expect(Number(diagnostic().chartRawTailVolume)).toBe(2);
        const before = fixture.candles!.data().map(row => ({...row}));
        await act(async () => rejectOlder(new Error('isolated-older-history-timeout')));
        await expect.poll(() => host.querySelector('[role="alert"]')?.textContent).toContain('isolated-older-history-timeout');
        expect(fixture.candles!.data()).toEqual(before);
        fixture.quote = undefined;
        fixture.fetchKbars.mockResolvedValue(initialBars());
        await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '重新載入 K 線')!.click());
        await expect.poll(() => host.querySelector('[role="alert"]')).toBeNull();
        await waitTail(100);
        expect(diagnostic().chartTimelineState).toBe('valid');
    });
    it('切換商品後，舊近期進度及延遲終局都不能覆蓋新商品', async () => {
        let progress!: (bars: KBars) => void;
        let resolveOld!: (bars: KBars) => void;
        fixture.fetchKbars.mockImplementationOnce((_c, _start, _end, _signal, options) => {
            progress = options.onProgress;
            return new Promise<KBars>(resolve => { resolveOld = resolve; });
        });
        await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '1m')!.click());
        await act(async () => progress(initialBars()));
        await waitTail(100);
        fixture.fetchKbars.mockResolvedValue({...initialBars(), Volume:[7]});
        await act(async () => root.render(createElement(CandleChart, {contract:{...contract,code:'2449'}})));
        await waitTail(7);
        await act(async () => { progress(initialBars()); resolveOld(initialBars()); });
        expect(diagnostic().chartCode).toBe('2449');
        expect(Number(diagnostic().chartTailVolume)).toBe(7);
    });
    it('三商品五週期連續往返30組，都使用目前商品資料且沒有殘留舊商品', async () => {
        const price = (code: string) => code === '3090' ? 10 : code === '2449' ? 20 : 30;
        fixture.fetchKbars.mockImplementation(async (c: ContractInfo) => ({
            datetime: ['09:00','09:01','09:06','09:16','10:01'].map(t => `2026-10-05T${t}:00`),
            Open:Array(5).fill(price(c.code)),High:Array(5).fill(price(c.code)),Low:Array(5).fill(price(c.code)),Close:Array(5).fill(price(c.code)),
            Volume:Array(5).fill(10),Amount:Array(5).fill(price(c.code)*10000),
        }));
        for (const codes of [['2449','2330','3090'],['3090','2330','2449']]) {
            for (const code of codes) {
                await act(async () => root.render(createElement(CandleChart, {contract:{...contract,code}})));
                for (const label of ['1m','5m','15m','60m','1D']) {
                    await switchTo(label);
                    expect(diagnostic().chartCode).toBe(code);
                    expect(Number(diagnostic().chartTailClose)).toBe(price(code));
                    expect(Number(diagnostic().chartRawCount)).toBe(5);
                    expect(Number(diagnostic().chartCandleCount)).toBeGreaterThan(0);
                    expect(diagnostic().chartTimelineState).toBe('valid');
                    expect(host.querySelector('[role="alert"]')).toBeNull();
                }
            }
        }
    });
    it('載入失敗後斷線重連會自動恢復目前商品，心跳不反覆查詢', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await connection('down');
        fixture.fetchKbars.mockRejectedValueOnce(new Error('isolated-network-down'));
        await switchTo('1m');
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('isolated-network-down');
        fixture.fetchKbars.mockResolvedValue({...initialBars(), Close:[20],Open:[20],High:[20],Low:[20]});
        const calls = fixture.fetchKbars.mock.calls.length;
        await connection('connecting'); await connection('live');
        await expect.poll(() => Number(diagnostic().chartTailClose)).toBe(20);
        await expect.poll(() => host.querySelector('[role="alert"]')).toBeNull();
        expect(fixture.fetchKbars.mock.calls.length-calls).toBe(2); // main history + reference authority
        const recoveredCalls = fixture.fetchKbars.mock.calls.length;
        for (let i=0;i<3;i++) await connection('live');
        expect(fixture.fetchKbars).toHaveBeenCalledTimes(recoveredCalls);
        expect(diagnostic().chartCode).toBe('3090');
        expect(diagnostic().chartTimelineState).toBe('valid');
    });
    it('重連時取消尚未逾時的舊需求，重連前的late response不能覆蓋新資料', async () => {
        let oldProgress!: (bars: KBars) => void;
        let resolveOld!: (bars: KBars) => void;
        let oldSignal!: AbortSignal;
        fixture.fetchKbars.mockImplementationOnce((_c,_s,_e,signal,options) => {
            oldSignal=signal;oldProgress=options.onProgress;
            return new Promise<KBars>(resolve=>{resolveOld=resolve;});
        });
        await act(async () => [...host.querySelectorAll('button')].find(b=>b.textContent==='1m')!.click());
        await connection('down');
        fixture.fetchKbars.mockResolvedValue({...initialBars(),Volume:[7]});
        await connection('connecting');await connection('live');
        await waitTail(7);expect(oldSignal.aborted).toBe(true);
        await act(async()=>{oldProgress(initialBars());resolveOld(initialBars());});
        expect(Number(diagnostic().chartTailVolume)).toBe(7);
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    it('重連後來源仍失敗只嘗試一次，保留K棒與可操作重試入口', async () => {
        vi.spyOn(console,'warn').mockImplementation(()=>{});
        await connection('down');
        fixture.fetchKbars.mockRejectedValue(new Error('isolated-still-unavailable'));
        const calls = fixture.fetchKbars.mock.calls.length;
        await connection('live');
        await expect.poll(()=>host.querySelector('[role="alert"]')?.textContent).toContain('isolated-still-unavailable');
        expect(Number(diagnostic().chartCandleCount)).toBeGreaterThan(0);
        expect(fixture.fetchKbars.mock.calls.length-calls).toBe(2);
        const failedCalls=fixture.fetchKbars.mock.calls.length;
        for(let i=0;i<3;i++) await connection('live');
        await settle();expect(fixture.fetchKbars).toHaveBeenCalledTimes(failedCalls);
        expect([...host.querySelectorAll('button')].some(b=>b.textContent==='重新載入 K 線')).toBe(true);
    });
});
