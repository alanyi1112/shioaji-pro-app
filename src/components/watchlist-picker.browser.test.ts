import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { WatchlistPicker } from './watchlist-picker';
import { darkTwClass } from '../theme.css';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; host?.remove(); vi.restoreAllMocks(); });
async function mount() {
    const selected = vi.fn(), opened = vi.spyOn(window, 'open').mockReturnValue(null);
    host = document.createElement('div'); document.body.append(host); document.documentElement.classList.add(darkTwClass);
    root = createRoot(host);
    await act(async () => root!.render(createElement(WatchlistPicker, {
        activeId: 'one', onSelect: selected,
        lists: [{ id: 'one', name: '原清單', contracts: [] }, { id: 'two', name: 'ETF觀察', contracts: [] }, { id: 'three', name: '第三份', contracts: [] }],
    })));
    await act(async () => host.querySelector('button')!.click());
    return { selected, opened, option: (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(e => e.textContent?.startsWith(name))! };
}
async function leftClick(option: HTMLElement, detail = 1) {
    await act(async () => {
        option.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerType: 'mouse', bubbles: true }));
        option.focus();
        option.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerType: 'mouse', bubbles: true }));
        option.dispatchEvent(new MouseEvent('click', { button: 0, detail, bubbles: true }));
    });
}
const finishSingle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
it('左鍵單擊只在原分頁切換清單', async () => {
    const f = await mount(); await leftClick(f.option('ETF觀察')); expect(f.selected).not.toHaveBeenCalled();
    await finishSingle(); expect(f.selected).toHaveBeenCalledExactlyOnceWith('two'); expect(f.opened).not.toHaveBeenCalled(); expect(document.querySelector('[role="listbox"]')).toBeNull();
});
it('左鍵雙擊只開一個新分頁，原分頁不先切換', async () => {
    const f = await mount(); const option = f.option('ETF觀察'); await leftClick(option); await leftClick(option, 2); await finishSingle();
    expect(f.selected).not.toHaveBeenCalled(); expect(f.opened).toHaveBeenCalledTimes(1);
    const [href, target, features] = f.opened.mock.calls[0]!; expect(new URL(href as string).searchParams.get('watchlist')).toBe('two');
    expect(target).toBe('_blank'); expect(features).toBe('noopener');
});
it('不同清單的連續左鍵不誤判雙擊，取消過時的單擊', async () => {
    const f = await mount(); await leftClick(f.option('ETF觀察')); await leftClick(f.option('第三份')); await finishSingle();
    expect(f.opened).not.toHaveBeenCalled(); expect(f.selected).toHaveBeenCalledExactlyOnceWith('three');
});
it('點選其他位置取消尚未執行的單擊', async () => {
    const f = await mount(); await leftClick(f.option('ETF觀察'));
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await finishSingle(); expect(f.selected).not.toHaveBeenCalled();
    await act(async () => host.querySelector('button')!.click()); await act(async () => f.option('ETF觀察').click());
    expect(f.selected).toHaveBeenCalledExactlyOnceWith('two');
});
it('右鍵不觸發切換或開啟分頁', async () => {
    const f = await mount(), option = f.option('ETF觀察');
    await act(async () => {
        option.dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true }));
        option.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true }));
        option.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }));
    });
    await finishSingle(); expect(f.selected).not.toHaveBeenCalled(); expect(f.opened).not.toHaveBeenCalled();
});
it('鍵盤焦點離開選單與觸發鈕時關閉選單', async () => {
    await mount();
    await act(async () => host.querySelector('button')!.focus());
    const outside = document.createElement('button'); document.body.append(outside);
    try { await act(async () => outside.focus()); expect(document.querySelector('[role="listbox"]')).toBeNull(); }
    finally { outside.remove(); }
});
it('支援鍵盤選取與Escape關閉，Escape不傳給交易快捷鍵', async () => {
    const f = await mount(); await act(async () => userEvent.keyboard('{End}'));
    expect(document.activeElement?.textContent).toContain('第三份'); await act(async () => userEvent.keyboard('{Enter}'));
    expect(f.selected).toHaveBeenCalledExactlyOnceWith('three');
    await act(async () => host.querySelector('button')!.click());
    const outsideEscape = vi.fn(); document.addEventListener('keydown', outsideEscape);
    try { await act(async () => userEvent.keyboard('{Escape}')); expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(outsideEscape).not.toHaveBeenCalled(); }
    finally { document.removeEventListener('keydown', outsideEscape); }
});
