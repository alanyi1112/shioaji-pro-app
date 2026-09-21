import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { StockScreenerPanel } from './stock-screener-panel';
import type { ScreenerResponseV3, ScreenerResponseV4, ScreenerResponseV5 } from '../lib/stock-screener-api';
import { DEFAULT_CRITERIA as DEFAULT_V2 } from '../lib/stock-screener-domain';
import { darkTwClass } from '../theme.css';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// UI fixtures only; these are deliberately not official stock evidence.
const ready: ScreenerResponseV3 = {
    version: 3, state: 'ready', reason: 'none', snapshotId: 'fixture', createdAt: '2026-08-31T10:00:00Z',
    universeRevision: 'fixture', formulaVersion: 'after-market-v3-technical-multichart-ecae7ca-v1', criteriaFingerprint: 'fixture', expectedSessionDate: '2026-08-28',
    anchors: { daily: { current: '2026-08-28', previous: '2026-08-27' }, weekly: { current: '2026-08-28', previous: '2026-08-21' }, weeklyPeriods: ['2026-08-21','2026-08-28'] },
    technicalAnchors: { sessions: Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 5, 30 + i)).toISOString().slice(0, 10)), through: '2026-08-28' },
    preparation: { version: 3, target: 120, processed: 120, remaining: 0, failed: 0, overdue: 0, cursor: null,
        markets: { TWSE: { target: 60, processed: 60, failed: 0 }, TPEx: { target: 60, processed: 60, failed: 0 } } },
    counts: { total: 1, evaluated: 1, matched: 1, notMatched: 0, unknown: 0, missingByCondition: { 'volume-multiple': 0, 'large-holder-weekly-pp': 0, fractal: 0, 'boll-reversal': 0 } },
    byMarket: null, nextCursor: null,
    rows: [{
        code: '3008', symbol: '3008.TW', market: 'TWSE', kind: 'ordinary', name: '測試商品', verdict: 'pass', sources: ['測試 fixture'],
        volume: { current: '300000', previous: '100000', currentDate: '2026-08-28', previousDate: '2026-08-27', multiple: 3, reason: 'none', turnover: { ntd: '12345600', wan: '1234.56', date: '2026-08-28', signalVerdict: 'pass', verdict: 'pass', reason: 'none' } },
        holder: { mode: 'weekly-increase', current: '60.2', previous: '60', changePp: 0.2, reason: 'none', streakWeeks: 0, changesPp: [0.2],
            series: [{ date: '2026-08-21', ratio: '60' }, { date: '2026-08-28', ratio: '60.2' }],
            turnover: { ntd: '12345600', wan: '1234.56', date: '2026-08-28', signalVerdict: 'pass', verdict: 'pass', reason: 'none' } },
        technical: {
            fractal: { verdict: 'pass', reason: 'none', evidence: {
                algorithm: 'chan-containment', direction: 'bottom', centerDate: '2026-08-27', confirmationDate: '2026-08-28',
                bars: [{ sessionDate: '2026-08-26', high: '100', low: '90' }, { sessionDate: '2026-08-27', high: '98', low: '80' }, { sessionDate: '2026-08-28', high: '101', low: '88' }],
                normalizedBars: [
                    { high: '100', low: '90', rawFrom: '2026-08-25', rawTo: '2026-08-26', rawDates: ['2026-08-25', '2026-08-26'] },
                    { high: '98', low: '80', rawFrom: '2026-08-27', rawTo: '2026-08-27', rawDates: ['2026-08-27'] },
                    { high: '101', low: '88', rawFrom: '2026-08-28', rawTo: '2026-08-28', rawDates: ['2026-08-28'] },
                ],
            } },
            bollReversal: { verdict: 'pass', reason: 'none', evidence: {
                mode: 'lower-bullish',
                previous: { sessionDate: '2026-08-27', open: '91', high: '95', low: '90', close: '92', upper: 110, middle: 100, lower: 90 },
                current: { sessionDate: '2026-08-28', open: '86', high: '90', low: '84', close: '88', upper: 109, middle: 99, lower: 89 },
                lowerShadow: true, upperShadow: true, outsideDistance: 1,
            } },
        },
    }],
};
const readyV4: ScreenerResponseV4 = {
    ...ready, version: 4, formulaVersion: 'after-market-v4-ma-divergence-multichart-ecae7ca-v1', sourceMappingVersion: 'official-daily-ohlcv-v2',
    effectiveSessionDate: '2026-08-28', byMarket: null,
    technicalAnchors: { sessions: Array.from({ length: 130 }, (_, i) => new Date(Date.UTC(2026, 3, 21 + i)).toISOString().slice(0, 10)), through: '2026-08-28' },
    preparation: { version: 4, target: 260, processed: 260, remaining: 0, failed: 0, overdue: 0, cursor: null,
        markets: { TWSE: { target: 130, processed: 130, failed: 0 }, TPEx: { target: 130, processed: 130, failed: 0 } } },
    counts: { ...ready.counts!, missingByCondition: { ...ready.counts!.missingByCondition, ma: 0, divergence: 0 } },
    rows: ready.rows.map((row) => ({ ...row, technicalV4: {
        evidenceHash: 'a'.repeat(64),
        ma: { verdict: 'pass', reason: 'none', evidence: {
            mode: 'golden-cross', compressionEnd: '2026-08-27',
            previous: { sessionDate: '2026-08-27', close: '99', sma5: 99, sma10: 99.5, sma20: 100, spreadPct: 1, gap: -1 },
            current: { sessionDate: '2026-08-28', close: '101', sma5: 101, sma10: 100, sma20: 100, spreadPct: 1, gap: 1 },
            compressionWindow: [
                { sessionDate: '2026-08-25', close: '99', sma5: 99, sma10: 99.5, sma20: 100, spreadPct: 1, gap: -1 },
                { sessionDate: '2026-08-26', close: '99', sma5: 99, sma10: 99.5, sma20: 100, spreadPct: 1, gap: -1 },
                { sessionDate: '2026-08-27', close: '99', sma5: 99, sma10: 99.5, sma20: 100, spreadPct: 1, gap: -1 },
            ],
        } },
        divergence: { verdict: 'pass', reason: 'none', evidence: {
            source: 'macd-histogram', direction: 'bullish', distanceSessions: 20, priceDifferencePct: 2,
            first: { sessionDate: '2026-08-05', confirmationDate: '2026-08-07', price: '100', indicator: -2 },
            second: { sessionDate: '2026-08-25', confirmationDate: '2026-08-27', price: '98', indicator: -1 },
            zeroResetRequired: true, zeroResetMet: true, sourceMappingVersion: 'official-daily-ohlcv-v2',
        } },
    } })),
};
const chipOutcome = { verdict: 'pass' as const, reason: 'none' as const, evidence: { dates: ['2026-08-21', '2026-08-28'], value: 'fixture' } };
const readyV5: ScreenerResponseV5 = {
    ...readyV4, version: 5, formulaVersion: 'after-market-v5-chip-price-1', sourceMappingVersion: 'official-market-chip-v1',
    preparation: null, byMarket: null,
    chipCoverage: { daily: { TWSE: { target: 1, institutional: 1, margin: 1 }, TPEx: { target: 0, institutional: 0, margin: 0 } },
        tdcc: { target: 1, covered: 1 }, issuedShares: { target: 1, valid: 1, missing: 0 } },
    counts: { ...readyV4.counts!, missingByCondition: { ...readyV4.counts!.missingByCondition,
        largeHolderTrend: 0, largeHolderConcentration: 0, retailHolderDecline: 0, trustOwnership: 0,
        priceMargin: 0, shortMarginRatio: 0, closeHigh: 0, closeSmaBreakout: 0 } },
    rows: readyV4.rows.map((row) => ({ ...row, chipV5: { evidenceHash: 'b'.repeat(64), dailyThrough: '2026-08-28', weeklyThrough: '2026-08-28', outcomes: {
        largeHolderTrend: chipOutcome, largeHolderConcentration: chipOutcome, retailHolderDecline: chipOutcome,
        trustOwnership: chipOutcome, priceMargin: chipOutcome, shortMarginRatio: chipOutcome,
        closeHigh: chipOutcome, closeSmaBreakout: chipOutcome,
    } } })),
};
let root: Root | null = null;
const originalRootFont = document.documentElement.style.fontSize;
afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.style.fontSize = originalRootFont;
    localStorage.removeItem('sj-pro-stock-screener-v1');
    localStorage.removeItem('sj-pro-stock-screener-v2');
    localStorage.removeItem('sj-pro-stock-screener-v3');
    localStorage.removeItem('sj-pro-stock-screener-v4');
    localStorage.removeItem('sj-pro-stock-screener-v5');
});
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)!;
async function mount(
    targets = [{ id: 'chart-a', label: '圖表 A' }],
    initialStatus?: Promise<Response>,
    snapshotVolumesByCode?: Record<string, { date: string | null; lots: number }>,
) {
    document.documentElement.style.fontSize = '24px';
    const host = document.createElement('div');
    host.classList.add(darkTwClass);
    host.style.cssText = 'width:320px;height:550px;display:flex;flex-direction:column;font-size:24px';
    document.body.append(host); root = createRoot(host);
    const onPick = vi.fn(async () => true), onOpenChart = vi.fn(() => 'new-chart'), onTargetChange = vi.fn();
    const onAddToWatchlist = vi.fn(async () => ({ status: 'added' as const, listId: 'screener-list' }));
    const fetcher = vi.fn(async (url: string) => url.includes('/status?') && initialStatus ? initialStatus
        : Response.json(url.includes('version=5') ? readyV5 : url.includes('version=4') ? readyV4 : ready)); vi.stubGlobal('fetch', fetcher);
    await act(async () => root?.render(createElement(StockScreenerPanel, { targets, onPick, onOpenChart, onTargetChange, onAddToWatchlist, snapshotVolumesByCode })));
    return { host, onPick, onOpenChart, onTargetChange, onAddToWatchlist, fetcher };
}
describe('收盤後選股面板（fixture 驗收）', () => {
    it('兩項預設、手動篩選、原值、指定圖表與窄版內部捲動', async () => {
        const { host, onPick, fetcher } = await mount();
        expect(host.querySelector<HTMLInputElement>('[aria-label="成交量倍數"]')!.value).toBe('3');
        expect(host.querySelector<HTMLInputElement>('[aria-label="大戶週增百分點"]')!.value).toBe('0.2');
        expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not([aria-label])')].every((input) => input.checked)).toBe(true);
        expect([...host.querySelectorAll<HTMLInputElement>('input[type=checkbox][aria-label]')].every((input) => !input.checked)).toBe(true);
        expect(host.textContent).not.toContain('3008 測試商品');
        await act(async () => button(host, '開始篩選').click());
        expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('volumeThreshold=3'), expect.objectContaining({ credentials: 'same-origin' }));
        expect(host.textContent).toContain('P 2026-08-27 100,000 股 → D 2026-08-28 300,000 股');
        expect(host.textContent).toContain('+0.20 百分點');
        const row = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('3008 測試商品'))!;
        await act(async () => row.click());
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ code: '3008' }), 'chart-a');
        const pane = host.querySelector<HTMLElement>('[data-testid="stock-screener-panel"]')!;
        expect(pane.clientHeight).toBeLessThanOrEqual(550);
        expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight);
        expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
        button(host, '開始篩選').focus(); expect(document.activeElement).toBe(button(host, '開始篩選'));
        await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
        expect(host.textContent).toContain('條件尚未套用');
        expect(host.textContent).toContain('已套用：成交量 ≥ 3 倍 且 單週增加 ≥ 0.2 百分點');
        expect(host.textContent).toContain('可判定 1 檔');
    });
    it('沒有圖表不可點列、保留新增日 K 提示與偏好保存失敗', async () => {
        const { host, onPick, onOpenChart } = await mount([]);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('瀏覽器無法保存偏好');
        expect(host.textContent).toContain('目前沒有未鎖定圖表');
        const row = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('3008 測試商品'))!;
        expect(row.disabled).toBe(true);
        await act(async () => row.click()); expect(onPick).not.toHaveBeenCalled();
        await act(async () => button(host, '新增日 K 圖').click()); expect(onOpenChart).toHaveBeenCalledOnce();
    });
    it('多圖不預選、手動目標切換取消舊解析、disabled 條件不能全部關閉', async () => {
        const { host, onTargetChange } = await mount([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
        const target = host.querySelector<HTMLSelectElement>('[aria-label="目標 K 線圖"]')!;
        expect(target.value).toBe('');
        await act(async () => { target.value = 'b'; target.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(onTargetChange).toHaveBeenCalledOnce();
        for (const checkbox of host.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not([aria-label])')) await act(async () => checkbox.click());
        expect(button(host, '開始篩選').disabled).toBe(true);
        expect(host.querySelector('[role=alert]')?.textContent).toContain('至少啟用一項條件');
    });
    it('v1 偏好安全遷移，四週反轉及兩個成交值分別送出 v3 query', async () => {
        localStorage.setItem('sj-pro-stock-screener-v1', JSON.stringify({ version: 1, query: { criteria: { mode: 'all', volume: { enabled: true, threshold: '4' }, holder: { enabled: true, threshold: '0.3' } }, sort: 'code', direction: 'asc', resultState: 'pass' } }));
        const { host, fetcher } = await mount();
        expect(host.querySelector<HTMLInputElement>('[aria-label="成交量倍數"]')!.value).toBe('4');
        expect(host.querySelector<HTMLInputElement>('[aria-label="大戶週增百分點"]')!.value).toBe('0.3');
        expect(JSON.parse(localStorage.getItem('sj-pro-stock-screener-v4')!).version).toBe(4);
        const mode = host.querySelector<HTMLSelectElement>('[aria-label="大戶持股模式"]')!;
        await act(async () => { mode.value = 'decrease-to-increase'; mode.dispatchEvent(new Event('change', { bubbles: true })); });
        const weeks = host.querySelector<HTMLInputElement>('[aria-label="反轉前連續週數"]')!;
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(weeks, '4'); weeks.dispatchEvent(new Event('input', { bubbles: true })); });
        for (const label of ['成交量條件啟用最低成交值', '大戶條件啟用最低成交值'])
            await act(async () => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!.click());
        await act(async () => button(host, '開始篩選').click());
        const request = String(fetcher.mock.calls.at(-1)?.[0]);
        expect(request).toContain('version=3'); expect(request).toContain('holderMode=decrease-to-increase');
        expect(request).toContain('holderStreakWeeks=4'); expect(request).toContain('volumeTurnover=true'); expect(request).toContain('holderTurnover=true');
        expect(request).toContain('fractal=false'); expect(request).toContain('bollReversal=false');
        expect(host.textContent).not.toContain('成交值 D 2026-08-28');
        expect(host.textContent).toContain('成交值 ≥ 1000 萬');
    });
    it('只在同日 Snapshot 已取得時於結果卡顯示換算後的張數差異，不顯示成交值明細', async () => {
        const { host } = await mount(undefined, undefined, {
            3008: { date: '2026-08-28', lots: 285 },
        });
        await act(async () => button(host, '開始篩選').click());
        expect(host.querySelector('[data-screener-volume-difference]')?.textContent)
            .toBe('同日成交量差異：官方盤後 300 張 − Shioaji Snapshot 285 張 = +15 張');
        expect(host.textContent).not.toContain('成交量條件成交值');
        expect(host.textContent).not.toContain('大戶條件成交值');
        expect(host.textContent).not.toContain('共同成交值');
    });
    it('選股 D 與 Snapshot 日期不同時不顯示誤導性的成交量差異', async () => {
        const { host } = await mount(undefined, undefined, {
            3008: { date: '2026-08-27', lots: 100 },
        });
        await act(async () => button(host, '開始篩選').click());
        expect(host.querySelector('[data-screener-volume-difference]')).toBeNull();
    });
    it('父條件關閉時停用成交值子控制，舊偏好 true 也不送出', async () => {
        localStorage.setItem('sj-pro-stock-screener-v3', JSON.stringify({ version: 3, query: {
            sort: 'code', direction: 'asc', resultState: 'pass', criteria: { ...DEFAULT_V2,
                volume: { ...DEFAULT_V2.volume, enabled: false, turnover: { enabled: true, minimumWan: '5000' } },
                fractal: { enabled: true, algorithm: 'raw-three', direction: 'bottom' },
                bollReversal: { enabled: false, mode: 'any' } },
        } }));
        const { host, fetcher } = await mount();
        const child = host.querySelector<HTMLInputElement>('[aria-label="成交量條件啟用最低成交值"]')!;
        expect(child.disabled).toBe(true);
        expect(child.checked).toBe(false);
        await act(async () => button(host, '開始篩選').click());
        expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('volumeTurnover=false');
    });
    it('v2 偏好只遷移一次且技術條件預設關閉；啟用後顯示可稽核證據', async () => {
        localStorage.setItem('sj-pro-stock-screener-v2', JSON.stringify({ version: 2, query: { criteria: DEFAULT_V2, sort: 'holderChange', direction: 'desc', resultState: 'pass' } }));
        const { host, fetcher, onPick } = await mount();
        expect(host.querySelector<HTMLInputElement>('[aria-label="啟用 K 棒分型"]')!.checked).toBe(false);
        expect(host.querySelector<HTMLInputElement>('[aria-label="啟用布林通道反轉 K"]')!.checked).toBe(false);
        expect(JSON.parse(localStorage.getItem('sj-pro-stock-screener-v4')!).query.sort).toBe('holderChange');
        await act(async () => host.querySelector<HTMLInputElement>('[aria-label="啟用 K 棒分型"]')!.click());
        await act(async () => host.querySelector<HTMLInputElement>('[aria-label="啟用布林通道反轉 K"]')!.click());
        await act(async () => button(host, '開始篩選').click());
        const request = String(fetcher.mock.calls.at(-1)?.[0]);
        expect(request).toContain('fractal=true'); expect(request).toContain('bollReversal=true');
        expect(host.textContent).toContain('中心 2026-08-27 · 確認 2026-08-28');
        expect(host.textContent).toContain('下軌陽 K＋下影 · 2026-08-28');
        expect(host.textContent).toContain('技術型態：');
        const row = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('3008 測試商品'))!;
        await act(async () => row.click());
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ symbol: '3008.TW' }), 'chart-a');
    });
    it('離線明確保留舊結果，不偽裝無符合', async () => {
        const { host, fetcher } = await mount();
        await act(async () => button(host, '開始篩選').click());
        fetcher.mockRejectedValueOnce(new Error('offline'));
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('offline');
        expect(host.textContent).toContain('3008 測試商品');
    });
    it('加入清單與結果點選互斥，pending 防重並以後端結果顯示狀態', async () => {
        const { host, onPick, onAddToWatchlist } = await mount();
        await act(async () => button(host, '開始篩選').click());
        const add = button(host, '加入清單');
        await act(async () => add.click());
        expect(onAddToWatchlist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: '3008' }));
        expect(onPick).not.toHaveBeenCalled();
        expect(host.textContent).toContain('已加入「選股」清單');
        expect(button(host, '已加入').disabled).toBe(true);

        const row = host.querySelector<HTMLButtonElement>('[aria-label="在指定 K 線圖開啟 3008 測試商品"]')!;
        await act(async () => row.click());
        expect(onPick).toHaveBeenCalledOnce();
        expect(onAddToWatchlist).toHaveBeenCalledOnce();
    });
    it('加入清單按鈕 hover 時以顏色、邊框與背景 highlight，移開不觸發動作', async () => {
        const { host, onPick, onAddToWatchlist } = await mount();
        await act(async () => button(host, '開始篩選').click());
        const add = button(host, '加入清單');
        const before = getComputedStyle(add);
        const original = {
            color: before.color,
            borderColor: before.borderColor,
            backgroundColor: before.backgroundColor,
        };
        const locator = page.getByRole('button', {
            name: '將 3008 測試商品 加入選股清單',
        });
        await locator.hover();
        await new Promise((resolve) => setTimeout(resolve, 180));
        const hovered = getComputedStyle(add);
        expect(hovered.color).not.toBe(original.color);
        expect(hovered.borderColor).not.toBe(original.borderColor);
        expect(hovered.backgroundColor).not.toBe(original.backgroundColor);
        await locator.unhover();
        await new Promise((resolve) => setTimeout(resolve, 180));
        const restored = getComputedStyle(add);
        expect(restored.color).toBe(original.color);
        expect(restored.borderColor).toBe(original.borderColor);
        expect(restored.backgroundColor).toBe(original.backgroundColor);
        expect(onPick).not.toHaveBeenCalled();
        expect(onAddToWatchlist).not.toHaveBeenCalled();
    });
    it('加入失敗不偽報成功且可重試', async () => {
        const { host, onAddToWatchlist } = await mount();
        onAddToWatchlist.mockRejectedValueOnce(new Error('伺服器拒絕寫入'));
        await act(async () => button(host, '開始篩選').click());
        await act(async () => button(host, '加入清單').click());
        expect(host.querySelector('[role=alert]')?.textContent).toContain('伺服器拒絕寫入');
        expect(button(host, '加入清單').disabled).toBe(false);
    });
    it('加入 pending 期間的快速重按只送出一次 mutation', async () => {
        const { host, onAddToWatchlist } = await mount();
        let resolveAdd: ((value: { status: 'added'; listId: string }) => void) | undefined;
        onAddToWatchlist.mockImplementationOnce(() => new Promise((resolve) => { resolveAdd = resolve; }));
        await act(async () => button(host, '開始篩選').click());
        const add = button(host, '加入清單');
        await act(async () => { add.click(); add.click(); });
        expect(onAddToWatchlist).toHaveBeenCalledOnce();
        expect(button(host, '加入中…').disabled).toBe(true);
        await act(async () => resolveAdd?.({ status: 'added', listId: 'screener-list' }));
        expect(button(host, '已加入').disabled).toBe(true);
    });
    it('較晚的初始 status 不能覆蓋結果，pending／partial／stale 分開顯示', async () => {
        let resolveStatus: (response: Response) => void = () => {};
        const initialStatus = new Promise<Response>((resolve) => { resolveStatus = resolve; });
        const { host, fetcher } = await mount(undefined, initialStatus);
        await act(async () => button(host, '開始篩選').click());
        await act(async () => resolveStatus(Response.json({ ...ready, state: 'pending', rows: [] })));
        expect(host.textContent).toContain('3008 測試商品');
        expect(host.textContent).toContain('資料已備齊');
        for (const [state, message] of [['pending', '等待完整比較資料'], ['partial', '部分商品無法判定'], ['stale', '資料已過期']]) {
            fetcher.mockResolvedValueOnce(Response.json({ ...ready, state }));
            await act(async () => button(host, '開始篩選').click());
            expect(host.textContent).toContain(message);
            if (state === 'stale') {
                expect(host.querySelector<HTMLButtonElement>('[aria-label="在指定 K 線圖開啟 3008 測試商品"]')!.disabled).toBe(true);
                expect(button(host, '加入清單').disabled).toBe(true);
            }
        }
        fetcher.mockResolvedValueOnce(Response.json({ reason: 'snapshot_expired' }, { status: 409 }));
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('快照已更新，請重新開始篩選');
    });
    it('資料日落後時分開顯示 expected／effective 與逐市場狀態，歷史列不可操作',async()=>{
        const pending={...ready,state:'pending' as const,reason:'awaiting_tpex',expectedSessionDate:'2026-08-31',effectiveSessionDate:'2026-08-28',
            sessionReadiness:{version:1 as const,expectedSessionDate:'2026-08-31',effectiveSessionDate:'2026-08-28',phase:'awaiting-publication' as const,attempts:1,
                nextAttemptAt:'2026-08-31T06:20:00.000Z',updatedAt:'2026-08-31T06:00:00.000Z',markets:{
                    TWSE:{status:'complete' as const,reportDate:'2026-08-31',hash:'a'.repeat(64),total:1000,invalid:0,reason:null,checkedAt:'2026-08-31T06:00:00.000Z'},
                    TPEx:{status:'pending' as const,reportDate:'2026-08-28',hash:null,total:null,invalid:null,reason:'source_not_published',checkedAt:'2026-08-31T06:00:00.000Z'},
                }}};
        const {host,fetcher}=await mount();
        fetcher.mockResolvedValueOnce(Response.json(pending));
        await act(async()=>button(host,'開始篩選').click());
        expect(host.textContent).toContain('成交量比較：2026-08-27 → 2026-08-28');
        expect(host.textContent).toContain('有效資料日：2026-08-28');
        expect(host.textContent).toContain('預期資料日：2026-08-31');
        expect(host.textContent).toContain('TWSE：已完成');
        expect(host.textContent).toContain('TPEx：等待發布');
        expect(host.textContent).not.toContain('有效交易日：');
        expect(host.querySelector<HTMLButtonElement>('[aria-label="在指定 K 線圖開啟 3008 測試商品"]')!.disabled).toBe(true);
        expect(button(host,'加入清單').disabled).toBe(true);

        fetcher.mockResolvedValueOnce(Response.json({ ...pending, reason: 'awaiting_twse', sessionReadiness: {
            ...pending.sessionReadiness!, markets: {
                TWSE: { ...pending.sessionReadiness!.markets.TWSE, status: 'pending', reportDate: '2026-08-28', hash: null,
                    total: null, invalid: null, reason: 'source_not_published' },
                TPEx: { ...pending.sessionReadiness!.markets.TPEx, status: 'complete', reportDate: '2026-08-31', hash: 'b'.repeat(64),
                    total: 800, invalid: 0, reason: null },
            },
        } }));
        await act(async()=>button(host,'開始篩選').click());
        expect(host.textContent).toContain('TWSE：等待發布');
        expect(host.textContent).toContain('TPEx：已完成');

        fetcher.mockResolvedValueOnce(Response.json({ ...pending, reason: 'source_not_published', sessionReadiness: {
            ...pending.sessionReadiness!, markets: {
                TWSE: { ...pending.sessionReadiness!.markets.TWSE, status: 'pending', reportDate: '2026-08-28', hash: null,
                    total: null, invalid: null, reason: 'source_not_published' },
                TPEx: { ...pending.sessionReadiness!.markets.TPEx, status: 'pending', reportDate: '2026-08-28', hash: null,
                    total: null, invalid: null, reason: 'source_not_published' },
            },
        } }));
        await act(async()=>button(host,'開始篩選').click());
        expect(host.textContent).toContain('TWSE：等待發布');
        expect(host.textContent).toContain('TPEx：等待發布');
        expect(host.textContent).toContain('等待官方新一期資料');
    });
    it('均線與背離條件送出 v4，保存偏好並呈現 P／D、pivot 與 hash 證據', async () => {
        const { host, fetcher } = await mount();
        await act(async () => host.querySelector<HTMLInputElement>('[aria-label="啟用均線糾結與交叉"]')!.click());
        const mode = host.querySelector<HTMLSelectElement>('[aria-label="均線型態"]')!;
        await act(async () => { mode.value = 'golden-cross'; mode.dispatchEvent(new Event('change', { bubbles: true })); });
        await act(async () => host.querySelector<HTMLInputElement>('[aria-label="啟用價與指標背離"]')!.click());
        await act(async () => host.querySelector<HTMLInputElement>('[aria-label="MACD 能量柱要求中間穿越零軸"]')!.click());
        await act(async () => button(host, '開始篩選').click());
        const request = String(fetcher.mock.calls.at(-1)?.[0]);
        expect(request).toContain('version=4'); expect(request).toContain('maMode=golden-cross');
        expect(request).toContain('compressionDays=3'); expect(request).toContain('maxSpreadPct=1');
        expect(request).toContain('divergenceSource=macd-histogram'); expect(request).toContain('requireZeroReset=true');
        expect(host.textContent).toContain('黃金交叉 · D 2026-08-28');
        expect(host.textContent).toContain('MACD 能量柱 底背離 · 2026-08-05 → 2026-08-25');
        expect(host.textContent).toContain('均線糾結 P／D 證據'); expect(host.textContent).toContain('背離 pivot／指標證據');
        expect(JSON.parse(localStorage.getItem('sj-pro-stock-screener-v4')!).query.criteria.divergence.requireZeroReset).toBe(true);
    });
    it('長線佈局只更新草稿，提交 v5 後呈現籌碼覆蓋與可展開 evidence', async () => {
        const { host, fetcher } = await mount();
        await act(async () => button(host, '套用「長線佈局」草稿').click());
        expect(host.querySelector<HTMLInputElement>('[aria-label="啟用千張大戶比例趨勢"]')!.checked).toBe(true);
        expect(host.querySelector<HTMLInputElement>('[aria-label="啟用十張以下散戶比例下降"]')!.checked).toBe(true);
        expect(host.querySelector<HTMLInputElement>('[aria-label="啟用價漲融資不增"]')!.checked).toBe(true);
        expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/results?'))).toHaveLength(0);
        await act(async () => button(host, '開始篩選').click());
        const request = String(fetcher.mock.calls.at(-1)?.[0]);
        expect(request).toContain('version=5'); expect(request).toContain('largeHolderTrendEnabled=true');
        expect(request).toContain('retailHolderDeclineEnabled=true'); expect(request).toContain('priceMarginEnabled=true');
        expect(host.textContent).toContain('籌碼覆蓋：TDCC 1/1');
        expect(host.textContent).toContain('千張大戶比例趨勢：符合');
        expect(host.textContent).toContain('千張大戶比例趨勢證據');
        expect(JSON.parse(localStorage.getItem('sj-pro-stock-screener-v5')!).version).toBe(5);
        button(host, '開始篩選').focus(); expect(document.activeElement).toBe(button(host, '開始篩選'));
        const pane = host.querySelector<HTMLElement>('[data-testid="stock-screener-panel"]')!;
        expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
    });

    it('停用 v5 條件後將籌碼排序還原為 v3 可用排序', async () => {
        const { host, fetcher } = await mount();
        const sort = host.querySelector<HTMLSelectElement>('[aria-label="選股排序"]')!;
        for (const value of ['largeHolderRatio', 'trustOwnershipPct', 'shortMarginRatio', 'closeHighDays', 'smaPeriod']) {
            await act(async () => { sort.value = value; sort.dispatchEvent(new Event('change', { bubbles: true })); });
            await act(async () => button(host, '開始篩選').click());
            const url = new URL(String(fetcher.mock.calls.at(-1)?.[0]), 'http://localhost');
            expect(url.searchParams.get('version')).toBe('3');
            expect(url.searchParams.get('sort')).toBe('code');
            expect(sort.value).toBe('code');
            expect(host.textContent).not.toContain('條件尚未套用');
        }
    });

    it('完整查詢無命中時顯示空結果，不誤報來源缺漏', async () => {
        const { host, fetcher } = await mount();
        fetcher.mockResolvedValueOnce(Response.json({ ...readyV5, rows: [], counts: {
            ...readyV5.counts, evaluated: 1, matched: 0, notMatched: 1, unknown: 0,
        } }));
        await act(async () => button(host, '套用「長線佈局」草稿').click());
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('此結果種類沒有商品');
        expect(host.textContent).not.toContain('仍有欄位缺漏');
    });
});
