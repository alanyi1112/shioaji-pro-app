import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockScreenerPanel } from './stock-screener-panel';
import type { ScreenerResponse } from '../lib/stock-screener-api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// UI fixtures only; these are deliberately not official stock evidence.
const ready: ScreenerResponse = {
    version: 2, state: 'ready', reason: 'none', snapshotId: 'fixture', createdAt: '2026-08-31T10:00:00Z',
    universeRevision: 'fixture', formulaVersion: 'after-market-v2', criteriaFingerprint: 'fixture', expectedSessionDate: '2026-08-28',
    anchors: { daily: { current: '2026-08-28', previous: '2026-08-27' }, weekly: { current: '2026-08-28', previous: '2026-08-21' }, weeklyPeriods: ['2026-08-21','2026-08-28'] },
    counts: { total: 1, evaluated: 1, matched: 1, notMatched: 0, unknown: 0, missingByCondition: { 'volume-multiple': 0, 'large-holder-weekly-pp': 0 } },
    byMarket: null, nextCursor: null,
    rows: [{ code: '3008', symbol: '3008.TW', market: 'TWSE', kind: 'ordinary', name: '測試商品', verdict: 'pass', sources: ['測試 fixture'],
        volume: { current: '300000', previous: '100000', multiple: 3, reason: 'none', turnover: { ntd: '12345600', wan: '1234.56', date: '2026-08-28', signalVerdict: 'pass', verdict: 'pass', reason: 'none' } },
        holder: { mode: 'weekly-increase', current: '60.2', previous: '60', changePp: 0.2, reason: 'none', streakWeeks: 0, changesPp: [0.2],
            series: [{date:'2026-08-21',ratio:'60'},{date:'2026-08-28',ratio:'60.2'}], turnover: { ntd: '12345600', wan: '1234.56', date: '2026-08-28', signalVerdict: 'pass', verdict: 'pass', reason: 'none' } } }],
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
});
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)!;
async function mount(targets = [{ id: 'chart-a', label: '圖表 A' }], initialStatus?: Promise<Response>) {
    document.documentElement.style.fontSize = '24px';
    const host = document.createElement('div');
    host.style.cssText = 'width:320px;height:550px;display:flex;flex-direction:column;font-size:24px';
    document.body.append(host); root = createRoot(host);
    const onPick = vi.fn(async () => true), onOpenChart = vi.fn(() => 'new-chart'), onTargetChange = vi.fn();
    const fetcher = vi.fn(async (url: string) => url.endsWith('/status') && initialStatus ? initialStatus : Response.json(ready)); vi.stubGlobal('fetch', fetcher);
    await act(async () => root?.render(createElement(StockScreenerPanel, { targets, onPick, onOpenChart, onTargetChange })));
    return { host, onPick, onOpenChart, onTargetChange, fetcher };
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
        expect(host.textContent).toContain('100,000 股 → 300,000 股');
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
    it('v1 偏好安全遷移，四週反轉及兩個成交值分別送出 v2 query', async () => {
        localStorage.setItem('sj-pro-stock-screener-v1', JSON.stringify({ version: 1, query: { criteria: { mode: 'all', volume: { enabled: true, threshold: '4' }, holder: { enabled: true, threshold: '0.3' } }, sort: 'code', direction: 'asc', resultState: 'pass' } }));
        const { host, fetcher } = await mount();
        expect(host.querySelector<HTMLInputElement>('[aria-label="成交量倍數"]')!.value).toBe('4');
        expect(host.querySelector<HTMLInputElement>('[aria-label="大戶週增百分點"]')!.value).toBe('0.3');
        expect(JSON.parse(localStorage.getItem('sj-pro-stock-screener-v2')!).version).toBe(2);
        const mode = host.querySelector<HTMLSelectElement>('[aria-label="大戶持股模式"]')!;
        await act(async () => { mode.value = 'decrease-to-increase'; mode.dispatchEvent(new Event('change', { bubbles: true })); });
        const weeks = host.querySelector<HTMLInputElement>('[aria-label="反轉前連續週數"]')!;
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(weeks, '4'); weeks.dispatchEvent(new Event('input', { bubbles: true })); });
        for (const checkbox of host.querySelectorAll<HTMLInputElement>('input[type=checkbox][aria-label]')) await act(async () => checkbox.click());
        await act(async () => button(host, '開始篩選').click());
        const request = String(fetcher.mock.calls.at(-1)?.[0]);
        expect(request).toContain('version=2'); expect(request).toContain('holderMode=decrease-to-increase');
        expect(request).toContain('holderStreakWeeks=4'); expect(request).toContain('volumeTurnover=true'); expect(request).toContain('holderTurnover=true');
    });
    it('離線明確保留舊結果，不偽裝無符合', async () => {
        const { host, fetcher } = await mount();
        await act(async () => button(host, '開始篩選').click());
        fetcher.mockRejectedValueOnce(new Error('offline'));
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('offline');
        expect(host.textContent).toContain('3008 測試商品');
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
        }
        fetcher.mockResolvedValueOnce(Response.json({ reason: 'snapshot_expired' }, { status: 409 }));
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('快照已更新，請重新開始篩選');
    });
});
