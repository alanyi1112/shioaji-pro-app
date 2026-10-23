import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { MarketCalendarMenu } from './special-market-closures-settings';
import { themeClasses } from '../theme.css';
import '../index.css';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const artifacts = '../../outputs/acceptance/calendar-ui-20261023';
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let before: { width: number; height: number; htmlClass: string; style: string | null };
afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host?.remove(); root = null; host = null; vi.unstubAllGlobals();
    if (before) {
        document.documentElement.className = before.htmlClass;
        if (before.style === null) document.documentElement.removeAttribute('style');
        else document.documentElement.setAttribute('style', before.style);
        await page.viewport(before.width, before.height);
    }
});
async function mount(width = 1280, height = 800, scale = 1, long = false, theme = 'dark-tw') {
    before = { width: innerWidth, height: innerHeight, htmlClass: document.documentElement.className, style: document.documentElement.getAttribute('style') };
    await page.viewport(width, height);
    document.documentElement.className = themeClasses[theme]!;
    document.documentElement.style.fontSize = `${16 * scale}px`;
    document.documentElement.style.colorScheme = theme.startsWith('light') ? 'light' : 'dark';
    const requests: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        requests.push(url);
        if (url === '/api/market-calendar/v1/special-closures' && !init?.method) return Response.json({ closures: {
            revision: 2, today: '2026-10-23', entries: long ? Array.from({ length: 12 }, (_, i) => ({
                date: `2026-11-${String(i + 1).padStart(2, '0')}`, reason: '颱風休市依公告核對。'.repeat(12),
                markets: ['TSE', 'OTC'], revision: i + 1,
            })) : [],
        } });
        if (url === '/api/market-calendar/v1/checks') return Response.json({ check: {
            status: 'partial', reason: 'fixture_missing_not_confirmed', calendarVersion: 'fixture-version-'.repeat(20),
            observedAt: '2026-10-23T09:00:00Z', externalRequests: 0, changedDb: false,
            missing: Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`), excluded: [], conflicts: [],
        } });
        throw Error('Unexpected request in isolated calendar UI');
    });
    vi.stubGlobal('fetch', fetcher);
    host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;padding:16px;'; document.body.append(host);
    root = createRoot(host);
    const outside = vi.fn();
    await act(async () => root?.render(createElement('div', null,
        createElement(MarketCalendarMenu),
        createElement('button', { style: { position: 'fixed', left: 2, bottom: 2, fontSize: 12 }, onClick: outside }, '外側操作'))));
    await act(async () => { await page.getByRole('button', { name: '交易日曆', exact: true }).click(); });
    return { requests, fetcher, outside };
}
const dialog = () => host!.querySelector<HTMLElement>('[role="dialog"]')!;
function geometry() {
    const d = dialog(); const r = d.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(15); expect(r.right).toBeLessThanOrEqual(innerWidth - 15);
    expect(r.top).toBeGreaterThanOrEqual(15); expect(r.bottom).toBeLessThanOrEqual(innerHeight - 15);
    expect(d.scrollWidth).toBeLessThanOrEqual(d.clientWidth + 1);
    for (const e of d.querySelectorAll<HTMLElement>('section,p,li,label,button,select,output,details,dl,dd')) {
        expect(e.scrollWidth, `horizontal overflow: ${e.tagName} ${e.textContent?.slice(0, 30)}`).toBeLessThanOrEqual(e.clientWidth + 1);
    }
    const scrollers = [...d.querySelectorAll<HTMLElement>('*')].filter(e =>
        ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1);
    expect(scrollers.length).toBeLessThanOrEqual(1);
    const close = d.querySelector<HTMLButtonElement>('[aria-label="關閉交易日曆"]')!;
    const cr = close.getBoundingClientRect();
    expect(document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2)?.closest('button')).toBe(close);
    expect(parseFloat(getComputedStyle(d.querySelector('h2')!).fontSize)).toBeGreaterThan(parseFloat(getComputedStyle(d.querySelector('p')!).fontSize));
    return scrollers[0];
}

test('初始精簡畫面、切頁與鍵盤關閉不新增請求，關閉後焦點返回', async () => {
    const { requests } = await mount(); geometry(); expect(requests).toEqual([]);
    const limit = dialog().querySelector('details')!; expect(limit.open).toBe(false);
    await page.screenshot({ path: `${artifacts}/calendar-ui-initial.png` });
    const tab = dialog().querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
    tab.focus(); await act(async () => userEvent.keyboard('{ArrowRight}'));
    await expect.element(page.getByRole('tab', { name: '資料檢查' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement?.textContent).toBe('資料檢查'); expect(requests).toEqual([]);
    await act(async () => userEvent.keyboard('{Escape}'));
    expect(host!.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('交易日曆');
});

test.each([
    [1280, 800, 1], [900, 600, 1.3], [856, 1128, 1.3], [390, 640, 1.3], [320, 480, 1.3], [1024, 360, 1.3],
])('長內容 %sx%s 字級%s：雙頁無橫溢，僅內容捲動且末端可達', async (width, height, scale) => {
    const { requests } = await mount(width, height, scale, true);
    await act(async () => { await page.getByRole('button', { name: '讀取特殊休市設定' }).click(); });
    let scroll = geometry(); expect(requests.length).toBe(1); expect(scroll).toBeDefined();
    await act(async () => { scroll!.scrollTop = scroll!.scrollHeight; });
    const details = dialog().querySelector('details')!;
    await act(async () => { details.open = true; scroll!.scrollTop = scroll!.scrollHeight; });
    geometry();
    const last = details.querySelector('li:last-child')!.getBoundingClientRect();
    expect(last.bottom).toBeLessThanOrEqual(scroll!.getBoundingClientRect().bottom + 1);
    const lastRevoke = [...dialog().querySelectorAll<HTMLButtonElement>('button[aria-label^="選擇撤銷"]')].at(-1)!;
    await act(async () => lastRevoke.click());
    expect(scroll!.scrollTop).toBe(0);
    await expect.element(page.getByRole('button', { name: '確認撤銷／更正休市日' })).toBeDisabled();
    if (width === 1280) await page.screenshot({ path: `${artifacts}/calendar-ui-desktop-form.png` });
    await act(async () => { await page.getByRole('tab', { name: '資料檢查', exact: true }).click(); });
    expect(requests.length).toBe(1);
    await act(async () => { await page.getByRole('button', { name: '唯讀檢查現有資料' }).click(); });
    const result = dialog().querySelector('output')!;
    await act(async () => { result.querySelector('details')!.open = true; });
    scroll = geometry();
    if (scroll) await act(async () => { scroll!.scrollTop = scroll!.scrollHeight; });
    geometry(); expect(requests.length).toBe(2);
    if (width === 390) {
        scroll!.scrollTop = 0;
        await page.screenshot({ path: `${artifacts}/calendar-ui-narrow-large.png` });
    }
});

test.each(['dark-tw', 'light-tw'])('%s 正常表單與關閉鈕；外側點擊一次關閉並執行原目標', async theme => {
    const { requests, outside } = await mount(1280, 900, 1, false, theme);
    await act(async () => { await page.getByRole('button', { name: '讀取特殊休市設定' }).click(); });
    geometry(); await page.screenshot({ path: `${artifacts}/calendar-ui-${theme === 'light-tw' ? 'light' : 'desktop'}.png` });
    if (theme === 'dark-tw') await page.screenshot({ element: dialog(), path: `${artifacts}/calendar-ui-dark-panel.png` });
    await act(async () => { await page.getByRole('button', { name: '關閉交易日曆' }).click(); });
    expect(host!.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement?.textContent).toBe('交易日曆');
    await act(async () => { await page.getByRole('button', { name: '交易日曆', exact: true }).click(); });
    await act(async () => { await page.getByRole('button', { name: '外側操作' }).click(); });
    expect(host!.querySelector('[role="dialog"]')).toBeNull(); expect(outside).toHaveBeenCalledTimes(1); expect(requests.length).toBe(1);
});
