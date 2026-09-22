import { describe, expect, it, vi } from 'vitest';
import type { UniverseStock } from './stock-screener-domain';
import {
    addStockToMultiViewScreenerList,
    ScreenerMultiViewListError,
    STOCK_SCREENER_MULTIVIEW_LIST_ENDPOINT,
} from './stock-screener-multiview-list';

const stock: UniverseStock = { code: '8069', symbol: '8069.TWO', name: '元太', market: 'TPEx', kind: 'ordinary' };

describe('MultiView 選股篩選 client', () => {
    it('只送 canonical symbol 並驗證後端確認結果', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            ok: true, status: 'added', symbol: '8069.TWO', tabId: 'stock-screener-filtered', tabLabel: '選股篩選',
        }), { status: 200 }));
        await expect(addStockToMultiViewScreenerList(stock, fetchImpl as typeof fetch)).resolves.toEqual({
            status: 'added', symbol: '8069.TWO', tabId: 'stock-screener-filtered', tabLabel: '選股篩選',
        });
        expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(STOCK_SCREENER_MULTIVIEW_LIST_ENDPOINT, {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ symbol: '8069.TWO' }),
        });
    });

    it('拒絕 identity 不一致的成功回應', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            ok: true, status: 'added', symbol: '8069.TW', tabId: 'target', tabLabel: '選股篩選',
        }), { status: 200 }));
        await expect(addStockToMultiViewScreenerList(stock, fetchImpl as typeof fetch)).rejects.toMatchObject({
            reason: 'invalid_response', retryable: true,
        });
    });

    it('將安全 reason 轉為可辨識錯誤並保留 retryable', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            ok: false, reason: 'duplicate_target_tabs', retryable: false,
        }), { status: 409 }));
        const promise = addStockToMultiViewScreenerList(stock, fetchImpl as typeof fetch);
        await expect(promise).rejects.toBeInstanceOf(ScreenerMultiViewListError);
        await expect(promise).rejects.toMatchObject({
            message: 'MultiView 存在多個同名「選股篩選」頁籤', reason: 'duplicate_target_tabs', retryable: false,
        });
    });
});
