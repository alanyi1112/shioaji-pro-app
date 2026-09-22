import type { UniverseStock } from './stock-screener-domain';
import {
    addStockToMultiViewScreenerList,
    type ScreenerMultiViewListResult,
} from './stock-screener-multiview-list';
import {
    addStockToScreenerWatchlist,
    type ScreenerWatchlistResult,
} from './stock-screener-watchlist';

export type ScreenerListDestinationResult<T> =
    | { status: 'added' | 'already_present'; result: T }
    | { status: 'error'; message: string };

export type ScreenerListSyncResult = {
    status: 'complete' | 'partial' | 'failed';
    shioaji: ScreenerListDestinationResult<ScreenerWatchlistResult>;
    multiview: ScreenerListDestinationResult<ScreenerMultiViewListResult>;
    message: string;
};

export type ScreenerListSyncDependencies = {
    addShioaji: (stock: UniverseStock) => Promise<ScreenerWatchlistResult>;
    addMultiView: (stock: UniverseStock) => Promise<ScreenerMultiViewListResult>;
};

const defaultDependencies: ScreenerListSyncDependencies = {
    addShioaji: addStockToScreenerWatchlist,
    addMultiView: addStockToMultiViewScreenerList,
};

function failureMessage(cause: unknown, fallback: string) {
    return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function destination<T>(
    outcome: PromiseSettledResult<T>,
    fallback: string,
): ScreenerListDestinationResult<T> {
    if (outcome.status === 'rejected') return { status: 'error', message: failureMessage(outcome.reason, fallback) };
    const result = outcome.value as T & { status: 'added' | 'already_present' };
    return { status: result.status, result };
}

export function stockScreenerListSyncMessage(
    shioaji: ScreenerListSyncResult['shioaji'],
    multiview: ScreenerListSyncResult['multiview'],
) {
    if (shioaji.status === 'error') {
        if (multiview.status === 'error') {
            return `加入兩邊清單失敗：Shioaji ${shioaji.message}；MultiView ${multiview.message}。可重試`;
        }
        return `MultiView「選股篩選」已完成；Shioaji「選股」未完成：${shioaji.message}。可重試`;
    }
    if (multiview.status === 'error') {
        return `Shioaji「選股」已完成；MultiView「選股篩選」未完成：${multiview.message}。可重試`;
    }
    return shioaji.status === 'already_present' && multiview.status === 'already_present'
        ? '兩邊原已存在'
        : '已加入 Shioaji「選股」與 MultiView「選股篩選」';
}

export async function addStockToScreenerLists(
    stock: UniverseStock,
    dependencies: ScreenerListSyncDependencies = defaultDependencies,
): Promise<ScreenerListSyncResult> {
    const [shioajiOutcome, multiviewOutcome] = await Promise.allSettled([
        dependencies.addShioaji(stock),
        dependencies.addMultiView(stock),
    ]);
    const shioaji = destination(shioajiOutcome, '加入 Shioaji「選股」失敗');
    const multiview = destination(multiviewOutcome, '加入 MultiView「選股篩選」失敗');
    const successes = Number(shioaji.status !== 'error') + Number(multiview.status !== 'error');
    return {
        status: successes === 2 ? 'complete' : successes === 1 ? 'partial' : 'failed',
        shioaji,
        multiview,
        message: stockScreenerListSyncMessage(shioaji, multiview),
    };
}
