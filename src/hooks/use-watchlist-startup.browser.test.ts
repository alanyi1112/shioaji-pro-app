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
    syncWatchlist: vi.fn(),
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
vi.mock('../lib/trade', () => ({ notify: vi.fn() }));
vi.mock('../lib/runtime-mode', () => ({ getRuntimeMode: () => 'unknown' }));
vi.mock('../lib/business-session-monitor', () => ({
    getBusinessSessionSnapshot: () => mocks.businessSessionSnapshot,
    subscribeBusinessSession: () => () => undefined,
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

function Harness({ metadataOnly }: { metadataOnly: boolean }) {
    const state = useWatchlist(metadataOnly ? {
        hydrateActiveList: false,
        subscribeActiveListQuotes: false,
    } : undefined);
    return createElement('output', {
        'data-testid': 'watchlist-state',
        'data-initial-loading': String(state.initialLoading),
        'data-item-count': String(state.items.length),
        'data-list-count': String(state.serverLists.length),
    });
}

describe('專用選股 workspace 的 watchlist 啟動模式', () => {
    let root: Root | null = null;

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
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
        mocks.fetchSnapshots.mockResolvedValue([]);
    });

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
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
});
