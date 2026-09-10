import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContractInfo } from '../lib/types/contract';
import { TickTape } from './tick-tape';
import { Watchlist } from './watchlist';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const stock: ContractInfo = {
    region: 'TW', exchange: 'TSE', code: '2330', security_type: 'STK', target_code: null,
    name: '台積電', currency: 'TWD', limit_up: 0, limit_down: 0, reference: 100,
    day_trade: '', update_date: '2026-09-10', category: '', margin_trading_balance: 0,
    short_selling_balance: 0,
};

type WatchlistTestOptions = Partial<Pick<
    ComponentProps<typeof Watchlist>,
    'onAdd' | 'searchProductsForInput' | 'searchTaiwanForInput'
>>;
type ProductSearch = NonNullable<ComponentProps<typeof Watchlist>['searchProductsForInput']>;
type TaiwanSearch = NonNullable<ComponentProps<typeof Watchlist>['searchTaiwanForInput']>;

const emptyProductSearch: ProductSearch = async () => [];
const emptyTaiwanSearch: TaiwanSearch = async () => ({ items: [], warnings: [] });

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitForSearch() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 180));
        await Promise.resolve();
    });
}

describe('自選清單模糊搜尋與成交明細大單頁籤', () => {
    let root: Root | null = null;

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
        document.body.replaceChildren();
        localStorage.clear();
    });

    async function renderWatchlist(options: WatchlistTestOptions = {}) {
        const onAdd = options.onAdd ?? vi.fn(async () => undefined);
        const searchProductsForInput = options.searchProductsForInput ?? emptyProductSearch;
        const searchTaiwanForInput = options.searchTaiwanForInput ?? emptyTaiwanSearch;
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root?.render(createElement(Watchlist, {
            items: [], selectedCode: null, onSelect: vi.fn(), onAdd,
            onRemove: vi.fn(), onReorder: vi.fn(), serverLists: [], activeListId: '',
            onSelectList: vi.fn(), onCreateList: vi.fn(), onRenameList: vi.fn(async () => true),
            onDeleteList: vi.fn(), loading: false, searchProductsForInput, searchTaiwanForInput,
        })));
        return { host, onAdd };
    }

    it('可用漏字的股名搜尋，以鍵盤明確選取後才提交 canonical 代號', async () => {
        const searchTaiwanForInput = vi.fn<TaiwanSearch>(async () => ({
            items: [
                { code: '3441', symbol: '3441.TWO', name: '聯一光', exchange: 'OTC', market: 'TPEx', score: 500, matchedBy: 'fuzzy' },
                { code: '3019', symbol: '3019.TW', name: '亞光', exchange: 'TSE', market: 'TWSE', score: 400, matchedBy: 'fuzzy' },
            ],
            warnings: [],
        }));
        const { host, onAdd } = await renderWatchlist({ searchTaiwanForInput });
        const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
        await act(async () => setInputValue(input, '聯光'));
        await waitForSearch();

        expect(host.textContent).toContain('3441');
        expect(host.textContent).toContain('聯一光');
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onAdd).not.toHaveBeenCalled();
        expect(host.textContent).toContain('請先從搜尋結果選擇一個商品');

        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onAdd).toHaveBeenCalledWith('3441', 'STK');
    });

    it('MultiView 離線時保留本機候選並清楚顯示降級狀態', async () => {
        const searchTaiwanForInput = vi.fn<TaiwanSearch>(async () => { throw new Error('offline'); });
        const searchProductsForInput = vi.fn<ProductSearch>(async () => [
            { code: '8027', name: '鈦昇', security_type: 'STK', exchange: 'OTC', detail: '股票' },
        ]);
        const { host } = await renderWatchlist({ searchTaiwanForInput, searchProductsForInput });
        const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
        await act(async () => setInputValue(input, '鈦昇'));
        await waitForSearch();
        expect(host.textContent).toContain('部分股名來源離線');
        expect(host.textContent).toContain('8027');
        expect(host.textContent).toContain('鈦昇');
    });

    it('搜尋來源全數失敗與 canonical 驗證失敗分別顯示錯誤', async () => {
        const searchTaiwanForInput = vi.fn<TaiwanSearch>(async () => { throw new Error('offline'); });
        const searchProductsForInput = vi.fn<ProductSearch>(async () => { throw new Error('offline'); });
        const { host } = await renderWatchlist({ searchTaiwanForInput, searchProductsForInput });
        const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
        await act(async () => setInputValue(input, '台積電'));
        await waitForSearch();
        expect(host.textContent).toContain('搜尋服務暫時無法使用');
        await act(async () => root?.unmount());
        root = null;
        document.body.replaceChildren();

        const onAdd = vi.fn(async () => { throw new Error('invalid contract'); });
        const taiwanResult = vi.fn<TaiwanSearch>(async () => ({
            items: [
                { code: '2330', symbol: '2330.TW', name: '台積電', exchange: 'TSE', market: 'TWSE', score: 800, matchedBy: 'localized-exact' },
            ],
            warnings: [],
        }));
        const second = await renderWatchlist({ onAdd, searchTaiwanForInput: taiwanResult });
        const secondInput = second.host.querySelector<HTMLInputElement>('[role="combobox"]')!;
        await act(async () => setInputValue(secondInput, '台積電'));
        await waitForSearch();
        const candidate = second.host.querySelector<HTMLButtonElement>('[role="option"]')!;
        await act(async () => candidate.click());
        expect(second.host.textContent).toContain('商品驗證失敗，未加入自選清單');
    });

    it('較舊查詢晚到不會覆寫最新股名結果', async () => {
        let resolveOld: ((value: { items: never[]; warnings: string[] }) => void) | null = null;
        const searchTaiwanForInput = vi.fn<TaiwanSearch>((query: string) => {
            if (query === '舊查詢') {
                return new Promise<{ items: never[]; warnings: string[] }>((resolve) => {
                    resolveOld = resolve;
                });
            }
            return Promise.resolve({
                items: [{ code: '8027', symbol: '8027.TWO', name: '鈦昇', exchange: 'OTC' as const, market: 'TPEx' as const, score: 700, matchedBy: 'localized-exact' }],
                warnings: [],
            });
        });
        const { host } = await renderWatchlist({ searchTaiwanForInput });
        const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
        await act(async () => setInputValue(input, '舊查詢'));
        await waitForSearch();
        await act(async () => setInputValue(input, '鈦昇'));
        await waitForSearch();
        expect(host.textContent).toContain('8027');
        await act(async () => resolveOld?.({ items: [], warnings: [] }));
        expect(host.textContent).toContain('8027');
        expect(host.textContent).not.toContain('找不到符合的商品');
    });

    it('明確期貨查詢沿用本機商品流程且不呼叫台股目錄', async () => {
        const onAdd = vi.fn(async () => undefined);
        const searchTaiwanForInput = vi.fn<TaiwanSearch>(async () => ({ items: [], warnings: [] }));
        const searchProductsForInput = vi.fn<ProductSearch>(async () => [
            { code: 'CDFR1', name: '台積電期近月', security_type: 'FUT' as const, exchange: 'TAIFEX', detail: '個股期 · 近月' },
        ]);
        const { host } = await renderWatchlist({ onAdd, searchTaiwanForInput, searchProductsForInput });
        const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
        await act(async () => setInputValue(input, '台積電期'));
        await waitForSearch();
        expect(searchTaiwanForInput).not.toHaveBeenCalled();
        const candidate = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')]
            .find((button) => button.textContent?.includes('CDFR1'))!;
        await act(async () => candidate.click());
        expect(onAdd).toHaveBeenCalledWith('CDFR1', 'FUT');
    });

    it('大單頁籤沿用成交列並顯示當下門檻，不建立第二個 tick listener', async () => {
        const datetime = Array.from({ length: 31 }, (_, index) =>
            `2026-09-10 10:00:${String(index).padStart(2, '0')}`,
        );
        const historyLoader = vi.fn(async () => ({
            datetime,
            close: Array(31).fill(100),
            volume: [...Array(30).fill(4), 5],
            bid_price: [], bid_volume: [], ask_price: [], ask_volume: [],
            tick_type: Array(31).fill(1),
        }));
        const tickSubscriber = vi.fn((_listener) => () => undefined);
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(TickTape, { contract: stock, historyLoader, tickSubscriber }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(tickSubscriber).toHaveBeenCalledOnce();
        const largeTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
            .find((button) => button.textContent?.includes('大單'))!;
        expect(largeTab.textContent).toContain('大單 1');
        await act(async () => largeTab.click());
        expect(host.textContent).toContain('大單條件：單筆成交金額 ≥ 50 萬元');
        expect(host.textContent).toContain('門檻＝40 萬元、5 張價值、近 120 筆 P70 三者取高');
        expect(host.textContent).not.toContain('大戶');
        expect(host.textContent).not.toContain('大單成交篩選，並非交易者身分判定');
        expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
        expect(tickSubscriber).toHaveBeenCalledOnce();
    });

    it('大單頁籤在暖機且尚無大單時顯示進度與空狀態', async () => {
        const historyLoader = vi.fn(async () => ({
            datetime: ['2026-09-10 10:00:01'],
            close: [100],
            volume: [1],
            bid_price: [], bid_volume: [], ask_price: [], ask_volume: [],
            tick_type: [1],
        }));
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(TickTape, {
                contract: stock,
                historyLoader,
                tickSubscriber: () => () => undefined,
            }));
            await Promise.resolve();
            await Promise.resolve();
        });
        const largeTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
            .find((button) => button.textContent?.includes('大單'))!;
        await act(async () => largeTab.click());
        expect(host.textContent).toContain('動態門檻暖機中 1/30');
        expect(host.textContent).toContain('目前尚無符合條件的大單');
    });
});
