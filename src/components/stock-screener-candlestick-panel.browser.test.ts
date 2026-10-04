import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { StockScreenerPanel } from './stock-screener-panel';
import { StockScreenerCandlestickResults } from './stock-screener-candlestick-results';
import { candlestickUIFixture } from '../lib/stock-screener-candlestick-ui.fixture';
import { CANDLESTICK_PREFS, decodeCandlestickResponse } from '../lib/stock-screener-candlestick-api';
import { CANDLESTICK_PATTERNS } from '../lib/stock-screener-v9';
import { themeClasses, vars } from '../theme.css';
import '../index.css';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// 隔離 fixture 網路与清單 callbacks；不是 live 行情／雙清單操作證據。
const { query, response } = await candlestickUIFixture();
const legacy = { version: 7, state: 'pending', reason: 'v7_preparation_pending', snapshotId: null, universeRevision: null,
    formulaVersion: 'after-market-v7-boll-rsi-kd-macd-1', sourceMappingVersion: 'official-daily-ohlcv-v2', criteriaFingerprint: null,
    expectedSessionDate: null, effectiveSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
    technicalAnchors: null, counts: null, byMarket: null, preparation: null, chipCoverage: null, institutionalCoverage: null,
    technicalCoverage: null, rows: [], nextCursor: null };
let root: Root | null = null;
const font = document.documentElement.style.fontSize;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); vi.restoreAllMocks();
    document.body.replaceChildren(); document.documentElement.style.fontSize = font;
    for (let version = 1; version <= 9; version++) localStorage.removeItem(`sj-pro-stock-screener-v${version}`); });
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
const click = async (el: HTMLElement) => { expect(el).toBeTruthy(); await act(async () => el.click()); };
async function mount({ enabled = true, state = 'ready', theme = 'dark-tw' } = {}) {
    if (enabled) localStorage.setItem(CANDLESTICK_PREFS, JSON.stringify({ version: 9, query }));
    document.documentElement.style.fontSize = '32px';
    const host = document.createElement('div'); host.className = themeClasses[theme]!;
    host.style.cssText = `width:320px;height:600px;display:flex;background:${vars.color.background};color:${vars.color.foreground};font-family:${vars.font.body}`;
    document.body.append(host); root = createRoot(host);
    const onPick = vi.fn(async () => true), onAddToWatchlist = vi.fn(async () => ({ status: 'complete' as const, message: '隔離 fixture 雙清單',
        shioaji: { status: 'already_present' as const, result: { status: 'already_present' as const, listId: 'fixture' } },
        multiview: { status: 'already_present' as const, result: { status: 'already_present' as const, symbol: '1111.TW', tabId: 'fixture', tabLabel: '選股篩選' } } }));
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = new URL(String(input), location.href); expect(init?.method ?? 'GET').toBe('GET');
        if (u.pathname.endsWith('/daily-profile')) return Response.json({ version: 8, profile: null, sourceRequests: 0 });
        if (u.pathname.endsWith('/status')) return Response.json(legacy);
        if (u.pathname.endsWith('/results') && u.searchParams.get('version') === '9') return Response.json({ ...response, state,
            reason: state === 'stale' ? 'new_session_pending' : 'none', canUseResults: state === 'ready' });
        throw new Error('unexpected_fixture_network');
    }); vi.stubGlobal('fetch', fetcher);
    await act(async () => root?.render(createElement(StockScreenerPanel, { targets: [{ id: 'chart', label: '未鎖定日 K 圖' }],
        onPick, onOpenChart: vi.fn(() => 'chart'), onTargetChange: vi.fn(), onAddToWatchlist })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    return { host, fetcher, onPick, onAddToWatchlist };
}
describe('五型態收合 UI（隔離 fixture，非 live）', () => {
    it('預設新分支停用／五種全選；選取才展開且只有一個設定', async () => {
        const { host, fetcher } = await mount({ enabled: false });
        await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('技術型態'))!);
        await click(host.querySelector<HTMLInputElement>('[aria-label="啟用 K 線反轉型態"]')!);
        expect(host.querySelectorAll('[aria-label="反轉型態複選"] button[aria-pressed="true"]')).toHaveLength(5);
        expect(host.querySelectorAll('fieldset')).toHaveLength(1);
        expect(fetcher.mock.calls.filter(c => String(c[0]).includes('/results'))).toHaveLength(0);
        for (const b of host.querySelectorAll<HTMLButtonElement>('[aria-label="反轉型態複選"] button')) await click(b);
        expect(host.textContent).toContain('請至少選擇一種反轉型態'); expect(button(host, '開始篩選').disabled).toBe(true);
    });
    it('參數／型態／統計可收合且晨星／刺透中點、獲利比例、樣本不混用', async () => {
        const { host } = await mount();
        for (const b of host.querySelectorAll<HTMLButtonElement>('[aria-label="反轉型態複選"] button[aria-pressed="false"]')) await click(b);
        expect(host.querySelector<HTMLInputElement>('[aria-label="晨星首根實體回補比例"]')?.value).toBe('50');
        expect(host.querySelector<HTMLInputElement>('[aria-label="刺透首根實體回補比例"]')?.value).toBe('50');
        const details = [...host.querySelectorAll('details')].filter(d => d.querySelector('summary')?.textContent?.match(/工程預設|型態條件|統計與來源/));
        expect(details).toHaveLength(3); expect(details.every(d => !d.open)).toBe(true);
        expect(host.textContent).toContain('2×第三根收盤 > 首根開盤＋收盤');
        expect(host.textContent).toContain('2×第二根收盤 > 首根開盤＋收盤');
        for (const text of ['13.25%', '90.91%', '僅 11 筆', '反轉率 64%', '反轉率 76%', '綜合表現第 3', '103 種']) expect(host.textContent).toContain(text);
    });
    it('v9 查詢唯讀、結果不自動切圖／加清單、全部取消保留結果與參數，profile 不寫入', async () => {
        const { host, fetcher, onPick, onAddToWatchlist } = await mount();
        await click(button(host, '開始篩選'));
        await vi.waitFor(() => expect(host.textContent).toContain('UI 隔離測試股'));
        expect(onPick).not.toHaveBeenCalled(); expect(onAddToWatchlist).not.toHaveBeenCalled();
        expect(await decodeCandlestickResponse(response, query.criteria)).toEqual(response);
        expect(fetcher.mock.calls.filter(c => String(c[0]).includes('/results'))).toHaveLength(1);
        const before = fetcher.mock.calls.length;
        await click(host.querySelector('[aria-label="K 線反轉結果"] summary')!);
        expect(fetcher.mock.calls).toHaveLength(before);
        await click(host.querySelector<HTMLButtonElement>('[aria-label="在指定 K 線圖開啟 1111 UI 隔離測試股"]')!);
        expect(onPick).toHaveBeenCalledOnce();
        await click(button(host, '加入清單')); expect(onAddToWatchlist).toHaveBeenCalledOnce();
        await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.startsWith('全部取消'))!);
        await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('技術型態'))!);
        expect(host.querySelector<HTMLInputElement>('[aria-label="啟用 K 線反轉型態"]')?.checked).toBe(false);
        expect(host.textContent).toContain('UI 隔離測試股'); expect(host.textContent).toContain('反轉條件尚未套用');
        expect(JSON.parse(localStorage.getItem(CANDLESTICK_PREFS)!).query.criteria.candlestickReversal.piercingRecoveryPct).toBe('50');
    });
    it('stale 主警告保持可見且禁止圖表／清單操作', async () => {
        const { host, onPick, onAddToWatchlist } = await mount({ state: 'stale' }); await click(button(host, '開始篩選'));
        await vi.waitFor(() => expect(host.textContent).toContain('資料已過期'));
        expect(button(host, '加入清單').disabled).toBe(true);
        await click(button(host, '加入清單')); expect(onPick).not.toHaveBeenCalled(); expect(onAddToWatchlist).not.toHaveBeenCalled();
    });
    it.each(['dark-tw', 'dark-intl', 'midnight-tw', 'midnight-intl', 'light-tw', 'light-intl'])('%s：320×600／32px、鍵盤、紅陽文字及 DOM／截圖', async theme => {
        const { host } = await mount({ theme }); await click(button(host, '開始篩選'));
        await vi.waitFor(() => expect(host.textContent).toContain('看多（紅陽）'));
        const panel = host.firstElementChild as HTMLElement;
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
        await click(host.querySelector('[aria-label="K 線反轉結果"] summary')!);
        const luminance = (rgb: number[]) => rgb.map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
            .reduce((sum, v, i) => sum + v * [ .2126, .7152, .0722 ][i]!, 0);
        for (const direction of ['bullish', 'bearish']) {
            const mark = host.querySelector<HTMLElement>(`[data-candlestick-direction="${direction}"]`)!;
            expect(mark).toBeTruthy(); const color = getComputedStyle(mark).color.match(/\d+/g)!.map(Number);
            expect(color[direction === 'bullish' ? 0 : 1]!).toBeGreaterThan(color[direction === 'bullish' ? 1 : 0]!);
            let background: HTMLElement | null = mark;
            while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
            const bg = getComputedStyle(background!).backgroundColor.match(/\d+/g)!.map(Number);
            const [light, dark] = [luminance(color), luminance(bg)].sort((a, b) => b - a);
            expect((light! + .05) / (dark! + .05)).toBeGreaterThanOrEqual(4.5);
        }
        const enable = host.querySelector<HTMLInputElement>('[aria-label="啟用 K 線反轉型態"]')!;
        enable.focus(); await act(async () => userEvent.keyboard(' ')); expect(!!enable.checked).toBe(false);
        await page.screenshot({ path: `candlestick-ui-fixture-${theme}.png` });
    });
    it('非法偏好保留原文、不寫每日設定；合法偏好保留五型態子集合', async () => {
        localStorage.setItem(CANDLESTICK_PREFS, '{invalid'); const { host } = await mount({ enabled: false });
        expect(localStorage.getItem(CANDLESTICK_PREFS)).toBe('{invalid');
        await click([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('技術型態'))!);
        expect(host.querySelector<HTMLInputElement>('[aria-label="啟用 K 線反轉型態"]')?.checked).toBe(false);
        expect(query.criteria.candlestickReversal.patterns).toEqual(['piercing']); expect(CANDLESTICK_PATTERNS).toHaveLength(5);
    });
});
