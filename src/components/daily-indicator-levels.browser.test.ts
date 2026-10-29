import { act, createElement, useSyncExternalStore, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { ContractInfo } from '../lib/types/contract';
import type { KBars } from '../lib/types/market';
import type { QuoteState } from '../lib/stream';
import type { IChartApi, ISeriesApi, MouseEventParams } from 'lightweight-charts';
import type { Trade } from '../lib/types/order';
import { CandleChart } from './candle-chart';
import { IndicatorSettingsModal } from './indicator-dialog';
import { DAILY_LEVEL_TYPE } from '../lib/daily-indicator-levels';
import { dailyIndicatorAuthority } from '../lib/daily-indicator-authority';
import { getInstancesSnapshot, newInstance, updateInstances } from '../lib/indicator-defs';
import { darkTwClass, themeClasses } from '../theme.css';
import { setThemeSettings } from '../lib/theme-store';
import { resetChartKbarMemoryCacheForTests } from '../lib/chart-kbar-memory-cache';
import { kbarsToTaiwanStockCandles, dateStrOffset } from '../lib/utils/kbars';
const fixture = vi.hoisted(() => ({ historyDays: 200, quote: undefined as QuoteState | undefined, listeners: new Set<() => void>(), fetchKbars: vi.fn(), order: vi.fn(), modify: vi.fn(), alert: vi.fn(), click: null as ((p: MouseEventParams) => void) | null, chart: null as IChartApi | null, candles: null as ISeriesApi<'Candlestick'> | null }));
vi.mock('lightweight-charts', async original => {
    const actual = await original<typeof import('lightweight-charts')>();
    return { ...actual, createChart: (...args: Parameters<typeof actual.createChart>) => {
        const chart = actual.createChart(...args); fixture.chart = chart; const add = chart.addSeries.bind(chart);
        const subscribe = chart.subscribeClick.bind(chart);
        chart.subscribeClick = fn => { fixture.click = fn; subscribe(fn); };
        chart.addSeries = ((...sa: Parameters<typeof chart.addSeries>) => { const series = add(...sa); if (sa[0] === actual.CandlestickSeries) fixture.candles = series as ISeriesApi<'Candlestick'>; return series; }) as typeof chart.addSeries;
        return chart;
    } };
});
vi.mock('../hooks/use-stream', () => ({ useQuote: () => useSyncExternalStore(fn => { fixture.listeners.add(fn); return () => fixture.listeners.delete(fn); }, () => fixture.quote), useTradingLive: () => false, useStreamStatus: () => 'offline' }));
vi.mock('../lib/shioaji', () => ({ fetchKbars: fixture.fetchKbars, fetchInfo: vi.fn(async () => ({ simulation: true })), fetchAccounts: vi.fn(async () => []), cancelFuturesOrder: vi.fn(), cancelOrder: vi.fn(), updateFuturesOrderPrice: vi.fn(), updateOrderPrice: fixture.modify }));
vi.mock('../lib/trade', () => ({ notify: vi.fn(), placeQuickOrder: fixture.order }));
vi.mock('../lib/trigger-engine', () => ({ LEGACY_TRADING_TRIGGER_DISABLED_MESSAGE: 'fixture_disabled', useTriggers: () => [], addTrigger: fixture.alert, removeTrigger: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const contract = { code: '2330', name: '隔離合成來源', security_type: 'STK', region: 'TW', exchange: 'TSE', target_code: null, currency: 'TWD', reference: 219, limit_up: 240, limit_down: 190, day_trade: 'Yes', update_date: '2026-10-29', category: '', margin_trading_balance: 0, short_selling_balance: 0 } as ContractInfo;
function data(start: string, end: string): KBars {
    const bars: KBars = { datetime: [], Open: [], High: [], Low: [], Close: [], Volume: [] };
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    for (let i = 0; i < fixture.historyDays; i++) {
        const date = new Date(Date.parse(today + 'T00:00:00Z') - (fixture.historyDays - 1 - i) * 86400000).toISOString().slice(0, 10);
        if (date < start || date > end) continue;
        const close = 100 + i / 10; bars.datetime.push(date + 'T13:30:00');
        bars.Open.push(close); bars.High.push(close); bars.Low.push(close); bars.Close.push(close); bars.Volume.push(1);
    }
    return bars;
}
describe('日線價位：Chromium隔離合成來源（非live）', () => {
    let root: Root, host: HTMLDivElement;
    beforeEach(async () => {
        await page.viewport(1100, 800); localStorage.clear(); dailyIndicatorAuthority.resetForTests(); resetChartKbarMemoryCacheForTests();
        setThemeSettings({ mode: 'dark', convention: 'tw' });
        fixture.historyDays = 200; fixture.quote = undefined; fixture.fetchKbars.mockReset().mockImplementation(async (_c, start, end) => data(start, end));
        fixture.order.mockReset().mockResolvedValue({ status: { status: 'Submitted' } }); fixture.modify.mockReset().mockResolvedValue(undefined); fixture.alert.mockReset(); fixture.click = null;
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('isolated_no_business_requests'));
        updateInstances(() => [newInstance(DAILY_LEVEL_TYPE)]);
        host = document.createElement('div'); host.className = darkTwClass; host.style.cssText = 'width:1000px;height:680px;display:flex;flex-direction:column';
        document.body.append(host); root = createRoot(host);
    });
    afterEach(async () => { await act(async () => root.unmount()); dailyIndicatorAuthority.resetForTests(); fixture.listeners.clear(); vi.restoreAllMocks(); document.body.replaceChildren(); });
    const settle = () => act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    const waitReady = async () => {
        await act(async () => { await expect.poll(() => dailyIndicatorAuthority.snapshot(contract).state).toBe('ready'); });
        await expect.poll(() => host.querySelector('[data-daily-level="ma120"]')?.getAttribute('data-status')).toBe('available');
        await settle();
    };
    const prices = () => [...host.querySelectorAll<HTMLElement>('[data-daily-level]')].map(e => [e.dataset.dailyLevel, e.dataset.price]);
    it('不先開1D即取得日線、四分鐘圖同值，真canvas畫出日線標籤且不重抓長歷史', async () => {
        const draw = vi.spyOn(CanvasRenderingContext2D.prototype, 'fillText');
        await act(async () => root.render(createElement(CandleChart, { contract })));
        await waitReady();
        const before = prices(); expect(before).toHaveLength(8);
        const longRequests = fixture.fetchKbars.mock.calls.filter(([, start, end]) => Date.parse(end) - Date.parse(start) > 20 * 86400000).length;
        for (const label of ['1m', '15m', '60m', '5m']) {
            await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click(); });
            await settle(); expect(prices()).toEqual(before);
        }
        // The regular 60m chart has its own normal history request; the daily authority must retain its cache.
        expect(fixture.fetchKbars.mock.calls.filter(([, start, end]) => Date.parse(end) - Date.parse(start) > 70 * 86400000)).toHaveLength(0);
        expect(longRequests).toBeGreaterThan(0);
        expect(draw.mock.calls.some(([text]) => String(text).startsWith('日5MA'))).toBe(true);
        for (const [, p] of before) expect(Number.isFinite(fixture.candles!.priceToCoordinate(Number(p)))).toBe(true);
        console.log('DAILY_LEVEL_FIXTURE', JSON.stringify({ prices: before, requests: fixture.fetchKbars.mock.calls.length, screenshot: await page.screenshot({ path: 'daily-levels-isolated-dark.png' }) }));
    });
    it('1D相同快照數值一致，游標不改參考；明亮窄面板仍可讀', async () => {
        await act(async () => root.render(createElement(CandleChart, { contract }))); await waitReady();
        const before = prices();
        await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '1D')!.click(); });
        await settle(); expect(prices()).toEqual(before);
        host.className = themeClasses['light-tw']!; host.style.width = '360px'; await act(async () => setThemeSettings({ mode: 'light' })); await page.viewport(500, 800); await settle();
        const summary = host.querySelector('summary')!; await act(async () => { summary.click(); });
        expect(host.textContent).toContain('來源更新'); expect(host.textContent).toContain('日120MA');
        console.log('DAILY_LEVEL_LIGHT_FIXTURE', await page.screenshot({ path: 'daily-levels-isolated-light-360.png' }));
    });
    it('八項設定、StrictMode事件、參數驗證及取消保持原設定', async () => {
        let draft = newInstance(DAILY_LEVEL_TYPE), committed = 0;
        const render = () => root.render(createElement(StrictMode, null, createElement(IndicatorSettingsModal, { inst: draft, timeframes: [], onPatch: p => { draft = { ...draft, ...p }; render(); }, onCommit: () => { committed++; }, onCancel: () => {}, onRemove: () => {} })));
        await act(async () => render());
        expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(8);
        await act(async () => host.querySelector<HTMLInputElement>('[aria-label="顯示日120MA"]')!.click());
        expect(draft.styles?.ma120?.visible).toBe(false);
        await act(async () => { await page.getByLabelText('日線布林期數', { exact: true }).fill('1'); });
        expect(host.querySelector<HTMLButtonElement>('button:last-child')!.disabled).toBe(true);
        await act(async () => { await page.getByLabelText('日線布林期數', { exact: true }).fill('30'); });
        await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '確定')!.click());
        expect(committed).toBe(1); expect(getInstancesSnapshot()[0]!.styles?.ma120?.visible).not.toBe(false);
    });
    it('40日資料逐項顯示不足，不補零或靜默消失', async () => {
        fixture.historyDays = 40;
        await act(async () => root.render(createElement(CandleChart, { contract })));
        await act(async () => { await expect.poll(() => dailyIndicatorAuthority.snapshot(contract).state).toBe('ready'); });
        expect(host.querySelector('[data-daily-level="ma120"]')?.getAttribute('data-status')).toBe('insufficient');
        expect(host.querySelector('[data-daily-level="ma20"]')?.getAttribute('data-status')).toBe('available');
        expect(host.textContent).toContain('需120日／已有40日');
    });
    it('開關八項日線價位保持K線座標、面板及X軸，舊autoscale設定也不能擴張Y軸', async () => {
        updateInstances(items => items.map(i => ({ ...i, hidden: true })));
        await act(async () => root.render(createElement(CandleChart, { contract })));
        await expect.poll(() => fixture.candles!.data().length).toBeGreaterThan(0); await settle();
        const chart = fixture.chart!, candles = fixture.candles!;
        const original = { y1: candles.priceToCoordinate(119), y2: candles.priceToCoordinate(120), view: chart.timeScale().getVisibleLogicalRange(), height: host.getBoundingClientRect().height };
        const fit = vi.spyOn(chart.timeScale(), 'fitContent');
        await act(async () => updateInstances(items => items.map(i => ({ ...i, hidden: false, params: { ...i.params, autoscale: 1 } })))); await waitReady();
        expect(candles.options().autoscaleInfoProvider).toBeUndefined();
        expect(candles.priceToCoordinate(119)).toBe(original.y1); expect(candles.priceToCoordinate(120)).toBe(original.y2);
        expect(host.getBoundingClientRect().height).toBe(original.height);
        expect(chart.timeScale().getVisibleLogicalRange()).toEqual(original.view);
        await act(async () => updateInstances(items => items.map(i => ({ ...i, hidden: true })))); await settle();
        expect(candles.priceToCoordinate(119)).toBe(original.y1); expect(candles.priceToCoordinate(120)).toBe(original.y2);
        expect(fit).not.toHaveBeenCalled(); expect(chart.timeScale().getVisibleLogicalRange()).toEqual(original.view);
    });
    it('既有來源刷新失敗保留同商品舊值，換股不帶入A價位', async () => {
        dailyIndicatorAuthority.publish(contract, kbarsToTaiwanStockCandles(data(dateStrOffset(240), dateStrOffset(0))), dateStrOffset(0), dateStrOffset(240));
        const previous = dailyIndicatorAuthority.snapshot(contract).asOf;
        fixture.fetchKbars.mockRejectedValue(Error('fixture_source_unavailable'));
        await act(async () => root.render(createElement(CandleChart, { contract })));
        await act(async () => { await expect.poll(() => dailyIndicatorAuthority.snapshot(contract).state).toBe('stale'); });
        expect(dailyIndicatorAuthority.snapshot(contract).asOf).toBe(previous);
        expect(host.textContent).toContain('舊值');
        await act(async () => root.render(createElement(CandleChart, { contract: { ...contract, code: '3008' } })));
        await settle(); expect(host.querySelector('[data-daily-level="ma5"]')?.getAttribute('data-price')).toBe('');
    });
    it('日線顯示不觸發交易；既有點價、警示及拖單只抵達隔離mock接點', async () => {
        const trade = { contract, order: { id: 'fixture-order', seqno: '', ordno: '', action: 'Buy', price: 115, quantity: 1 }, status: { id: 'fixture-order', status: 'Submitted', status_code: '', order_quantity: 1, deal_quantity: 0, cancel_quantity: 0, modified_price: 0, msg: '', deals: [] } } as Trade;
        await act(async () => root.render(createElement(CandleChart, { contract, trades: [trade] }))); await waitReady();
        const summary = host.querySelector('summary')!;
        await act(async () => { summary.click(); summary.click(); }); await settle();
        expect(fixture.order).not.toHaveBeenCalled(); expect(fixture.modify).not.toHaveBeenCalled(); expect(fixture.alert).not.toHaveBeenCalled();
        const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
        const clickPrice = async () => act(async () => fixture.click!({ point: { x: 100, y: 100 }, time: fixture.candles!.data().at(-1)!.time, seriesData: new Map() } as MouseEventParams));
        await act(async () => button('點價買').click()); await clickPrice();
        expect(fixture.order).toHaveBeenCalledOnce(); expect(fixture.order.mock.calls[0]![1]).toBe('Buy');
        // No quote exists in this fixture: alert mode must report missing price, never submit a trade.
        await act(async () => button('警示').click()); await clickPrice();
        expect(fixture.order).toHaveBeenCalledOnce(); expect(fixture.alert).not.toHaveBeenCalled();
        const plot = host.querySelector<HTMLElement>('[data-fibonacci-panel-instance]')!;
        const y = fixture.candles!.priceToCoordinate(115)!;
        const movedY = fixture.candles!.priceToCoordinate(116)!;
        const top = plot.getBoundingClientRect().top;
        await act(async () => {
            plot.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientY: top + y, bubbles: true }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: top + movedY, bubbles: true }));
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
        expect(fixture.modify).toHaveBeenCalledOnce(); expect(fixture.modify.mock.calls[0]![0]).toBe('fixture-order');
        expect(fixture.modify.mock.calls[0]![3]).toBe('STK-MAN-UPDATE-CHART-DRAG');
        expect(fixture.order).toHaveBeenCalledOnce();
    });
});
