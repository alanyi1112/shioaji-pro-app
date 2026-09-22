import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../lib/types/contract';

const mocks = vi.hoisted(() => ({
    fetchWatchlists: vi.fn(),
    resolveContract: vi.fn(),
    subscribeContractQuotes: vi.fn(),
    fetchSnapshots: vi.fn(),
    primeContract: vi.fn(),
    syncWatchlist: vi.fn(),
    notify: vi.fn(),
    invalidationListeners: new Set<(event: { listName: string }) => void>(),
    businessSessionSnapshot: { status: 'idle', checkedAt: null },
}));

vi.mock('../lib/shioaji', () => ({
    createWatchlist: vi.fn(),
    deleteWatchlist: vi.fn(),
    fetchSnapshots: mocks.fetchSnapshots,
    fetchWatchlists: mocks.fetchWatchlists,
    addWatchlistContracts: vi.fn(),
    removeWatchlistContracts: vi.fn(),
    renameWatchlist: vi.fn(),
    resolveContract: mocks.resolveContract,
    subscribeContractQuotes: mocks.subscribeContractQuotes,
    syncWatchlist: mocks.syncWatchlist,
}));
vi.mock('../lib/contracts-cache', () => ({
    ensureContract: mocks.resolveContract,
    primeContract: mocks.primeContract,
    refreshCachedContracts: vi.fn(),
}));
vi.mock('../lib/stream', () => ({
    onContractEvent: () => () => undefined,
    registerCodeAlias: vi.fn(),
}));
vi.mock('../lib/trade', () => ({ notify: mocks.notify }));
vi.mock('../lib/runtime-mode', () => ({ getRuntimeMode: () => 'unknown' }));
vi.mock('../lib/business-session-monitor', () => ({
    getBusinessSessionSnapshot: () => mocks.businessSessionSnapshot,
    subscribeBusinessSession: () => () => undefined,
}));
vi.mock('../lib/watchlist-invalidation', () => ({
    onWatchlistInvalidation: (
        listener: (event: { listName: string }) => void,
    ) => {
        mocks.invalidationListeners.add(listener);
        return () => mocks.invalidationListeners.delete(listener);
    },
}));

const { useWatchlist } = await import('./use-watchlist');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const contract: ContractInfo = {
    exchange: 'TSE',
    code: '2330',
    security_type: 'STK',
    target_code: null,
    name: '台積電',
    currency: 'TWD',
    limit_up: 1_100,
    limit_down: 900,
    reference: 1_000,
    day_trade: 'Yes',
    update_date: '2026-09-14',
    category: '24',
    margin_trading_balance: 0,
    short_selling_balance: 0,
};

function contractFor(code: string, name = code): ContractInfo {
    return { ...contract, code, name };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

let latestState: ReturnType<typeof useWatchlist> | null = null;

function Harness({ metadataOnly }: { metadataOnly: boolean }) {
    const state = useWatchlist(metadataOnly ? {
        hydrateActiveList: false,
        subscribeActiveListQuotes: false,
    } : undefined);
    latestState = state;
    return createElement('output', {
        'data-testid': 'watchlist-state',
        'data-initial-loading': String(state.initialLoading),
        'data-loading': String(state.loading),
        'data-item-count': String(state.items.length),
        'data-list-count': String(state.serverLists.length),
        'data-active-list-id': state.activeListId,
        'data-first-code': state.items[0]?.contract.code ?? '',
    });
}

describe('專用選股 workspace 的 watchlist 啟動模式', () => {
    let root: Root | null = null;

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        mocks.invalidationListeners.clear();
        latestState = null;
        mocks.fetchWatchlists.mockResolvedValue([{
            id: 'watch-1',
            name: '觀察',
            contracts: [{
                security_type: 'STK',
                exchange: 'TSE',
                code: '2330',
            }],
        }]);
        mocks.resolveContract.mockResolvedValue(contract);
        mocks.subscribeContractQuotes.mockResolvedValue([]);
        mocks.fetchSnapshots.mockReturnValue(new Promise(() => undefined));
        mocks.syncWatchlist.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
        latestState = null;
        document.body.replaceChildren();
    });

    async function renderHarness(metadataOnly: boolean) {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(Harness, { metadataOnly }));
        });
        await vi.waitFor(() => {
            expect(host.querySelector('output')?.getAttribute(
                'data-initial-loading',
            )).toBe('false');
        });
        return host.querySelector('output')!;
    }

    it('metadata-only 取得清單但不解析或訂閱作用中清單商品', async () => {
        const output = await renderHarness(true);

        expect(output.getAttribute('data-list-count')).toBe('1');
        expect(output.getAttribute('data-item-count')).toBe('0');
        expect(mocks.fetchWatchlists).toHaveBeenCalledOnce();
        expect(mocks.resolveContract).not.toHaveBeenCalled();
        expect(mocks.subscribeContractQuotes).not.toHaveBeenCalled();
        expect(mocks.fetchSnapshots).not.toHaveBeenCalled();
    });

    it('預設模式仍解析並訂閱作用中清單商品', async () => {
        const output = await renderHarness(false);

        expect(output.getAttribute('data-list-count')).toBe('1');
        expect(output.getAttribute('data-item-count')).toBe('1');
        expect(mocks.resolveContract).toHaveBeenCalledWith('2330', 'STK');
        expect(mocks.subscribeContractQuotes).toHaveBeenCalledWith(contract);
    });

    it('行情訂閱永久 pending 時仍發布清單並結束 loading', async () => {
        mocks.subscribeContractQuotes.mockReturnValue(
            new Promise(() => undefined),
        );

        const output = await renderHarness(false);

        expect(output.getAttribute('data-item-count')).toBe('1');
        expect(output.getAttribute('data-loading')).toBe('false');
        expect(output.getAttribute('data-first-code')).toBe('2330');
    });

    it('pending 訂閱去重，且同一清單刷新時保留既有列', async () => {
        mocks.subscribeContractQuotes.mockReturnValue(
            new Promise(() => undefined),
        );
        const output = await renderHarness(false);
        const nextContract = deferred<ContractInfo>();
        mocks.resolveContract.mockReturnValueOnce(nextContract.promise);

        await act(async () => {
            mocks.invalidationListeners.forEach((listener) =>
                listener({ listName: '觀察' }),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => {
            expect(output.getAttribute('data-loading')).toBe('true');
        });
        expect(output.getAttribute('data-item-count')).toBe('1');
        expect(mocks.subscribeContractQuotes).toHaveBeenCalledOnce();

        await act(async () => {
            nextContract.resolve(contract);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => {
            expect(output.getAttribute('data-loading')).toBe('false');
        });
        expect(mocks.subscribeContractQuotes).toHaveBeenCalledOnce();
    });

    it('訂閱失敗後可由同一清單 reload 再次嘗試', async () => {
        mocks.subscribeContractQuotes
            .mockResolvedValueOnce([
                { status: 'rejected', reason: new Error('subscribe failed') },
            ])
            .mockResolvedValueOnce([
                { status: 'fulfilled', value: { success: true } },
            ]);
        await renderHarness(false);
        await vi.waitFor(() => {
            expect(mocks.subscribeContractQuotes).toHaveBeenCalledOnce();
        });

        await act(async () => {
            mocks.invalidationListeners.forEach((listener) =>
                listener({ listName: '觀察' }),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => {
            expect(mocks.subscribeContractQuotes).toHaveBeenCalledTimes(2);
        });
    });

    it('較舊載入晚完成時不得覆寫新清單或 loading', async () => {
        const lists = [
            {
                id: 'watch-1',
                name: '觀察',
                contracts: [{
                    security_type: 'STK' as const,
                    exchange: 'TSE',
                    code: '2330',
                }],
            },
            {
                id: 'watch-2',
                name: '第二清單',
                contracts: [{
                    security_type: 'STK' as const,
                    exchange: 'TSE',
                    code: '2317',
                }],
            },
        ];
        mocks.fetchWatchlists.mockResolvedValue(lists);
        mocks.resolveContract.mockResolvedValue(contract);
        const output = await renderHarness(false);
        const staleReload = deferred<ContractInfo>();
        mocks.resolveContract.mockImplementation((code: string) => {
            if (code === '2330') return staleReload.promise;
            return Promise.resolve(contractFor('2317', '鴻海'));
        });

        await act(async () => {
            mocks.invalidationListeners.forEach((listener) =>
                listener({ listName: '觀察' }),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => {
            expect(output.getAttribute('data-loading')).toBe('true');
        });

        await act(async () => {
            latestState?.setActiveList('watch-2');
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => {
            expect(output.getAttribute('data-active-list-id')).toBe('watch-2');
            expect(output.getAttribute('data-first-code')).toBe('2317');
            expect(output.getAttribute('data-loading')).toBe('false');
        });

        await act(async () => {
            staleReload.resolve(contract);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(output.getAttribute('data-active-list-id')).toBe('watch-2');
        expect(output.getAttribute('data-first-code')).toBe('2317');
        expect(output.getAttribute('data-loading')).toBe('false');
    });

    it('canonical migration 同步失敗不會移除列或卡住 loading', async () => {
        mocks.resolveContract.mockResolvedValue(
            contractFor('2330-R', '台積電'),
        );
        mocks.syncWatchlist.mockRejectedValue(new Error('sync failed'));

        const output = await renderHarness(false);

        expect(output.getAttribute('data-first-code')).toBe('2330-R');
        expect(output.getAttribute('data-loading')).toBe('false');
        await vi.waitFor(() => {
            expect(mocks.notify).toHaveBeenCalledWith(
                expect.objectContaining({ title: '自選清單同步失敗' }),
            );
        });
    });
});
