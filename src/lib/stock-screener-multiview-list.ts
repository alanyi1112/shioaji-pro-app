import type { UniverseStock } from './stock-screener-domain';

export const STOCK_SCREENER_MULTIVIEW_LIST_NAME = '選股篩選';
export const STOCK_SCREENER_MULTIVIEW_LIST_ENDPOINT = '/local-multiview/api/v1/stock-screener-list/items';

export type ScreenerMultiViewListResult = {
    status: 'added' | 'already_present';
    symbol: string;
    tabId: string;
    tabLabel: string;
};

type MultiViewResponse = {
    ok?: unknown;
    status?: unknown;
    symbol?: unknown;
    tabId?: unknown;
    tabLabel?: unknown;
    reason?: unknown;
    retryable?: unknown;
};

const reasonMessages: Record<string, string> = {
    multiview_unavailable: 'MultiView 本機服務無法使用',
    persistence_unavailable: 'MultiView 清單資料庫無法使用',
    catalog_symbol_not_found: 'MultiView 商品目錄找不到此商品',
    catalog_symbol_ambiguous: 'MultiView 商品目錄有重複商品',
    unsupported_instrument: 'MultiView 不支援此商品 identity',
    duplicate_target_tabs: 'MultiView 存在多個同名「選股篩選」頁籤',
    reserved_tab_id_conflict: 'MultiView 的「選股篩選」保留頁籤 identity 已被占用',
    target_tab_changed: 'MultiView 目標頁籤在寫入期間變更',
    write_not_confirmed: 'MultiView 尚未確認商品已加入「選股篩選」',
    invalid_payload: 'MultiView 同步請求格式不正確',
};

export class ScreenerMultiViewListError extends Error {
    readonly reason: string;
    readonly retryable: boolean;

    constructor(reason: string, retryable: boolean) {
        super(reasonMessages[reason] ?? 'MultiView「選股篩選」同步失敗');
        this.name = 'ScreenerMultiViewListError';
        this.reason = reason;
        this.retryable = retryable;
    }
}

export async function addStockToMultiViewScreenerList(
    stock: UniverseStock,
    fetchImpl: typeof fetch = fetch,
): Promise<ScreenerMultiViewListResult> {
    const response = await fetchImpl(STOCK_SCREENER_MULTIVIEW_LIST_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol: stock.symbol }),
    });
    let payload: MultiViewResponse;
    try {
        payload = await response.json() as MultiViewResponse;
    } catch {
        throw new ScreenerMultiViewListError('invalid_response', true);
    }
    if (!response.ok || payload.ok !== true) {
        const reason = typeof payload.reason === 'string' ? payload.reason : 'multiview_rejected';
        throw new ScreenerMultiViewListError(reason, payload.retryable === true || response.status >= 500);
    }
    if (!['added', 'already_present'].includes(String(payload.status))
        || payload.symbol !== stock.symbol
        || typeof payload.tabId !== 'string'
        || payload.tabLabel !== STOCK_SCREENER_MULTIVIEW_LIST_NAME) {
        throw new ScreenerMultiViewListError('invalid_response', true);
    }
    return {
        status: payload.status as ScreenerMultiViewListResult['status'],
        symbol: payload.symbol,
        tabId: payload.tabId,
        tabLabel: payload.tabLabel,
    };
}
