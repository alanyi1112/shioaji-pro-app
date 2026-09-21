import { describe, expect, it, vi } from 'vitest';
import type { UniverseStock } from './stock-screener-domain';
import {
    addStockToScreenerWatchlist,
    STOCK_SCREENER_LIST_NAME,
    type ScreenerWatchlistDependencies,
} from './stock-screener-watchlist';
import type { ServerWatchlist } from './shioaji';
import type { ContractInfo } from './types/contract';

const stock: UniverseStock = {
    code: '3008', symbol: '3008.TW', name: '大立光', market: 'TWSE', kind: 'ordinary',
};
const contract = {
    code: '3008', name: '大立光', exchange: 'TSE', security_type: 'STK',
} as ContractInfo;
const wireContract = { code: '3008', exchange: 'TSE', security_type: 'STK' as const };

function dependencies(initial: ServerWatchlist[] = []) {
    let lists = structuredClone(initial);
    const deps: ScreenerWatchlistDependencies = {
        resolveContract: vi.fn(async () => contract),
        fetchWatchlists: vi.fn(async () => structuredClone(lists)),
        createWatchlist: vi.fn(async (name: string, contracts: ContractInfo[]) => {
            const created: ServerWatchlist = {
                id: 'screener-list', name,
                contracts: contracts.map((item) => ({ code: item.code, exchange: item.exchange ?? '', security_type: item.security_type })),
            };
            lists.push(created);
            return structuredClone(created);
        }),
        addWatchlistContracts: vi.fn(async (id: string, contracts: ContractInfo[]) => {
            const target = lists.find((list) => list.id === id)!;
            target.contracts.push(...contracts.map((item) => ({ code: item.code, exchange: item.exchange ?? '', security_type: item.security_type })));
            return structuredClone(target);
        }),
        invalidate: vi.fn(),
    };
    return { deps, getLists: () => lists };
}

describe('選股指定清單寫入', () => {
    it('不存在時建立「選股」並直接帶入商品，不切換其他清單', async () => {
        const original: ServerWatchlist = { id: 'active', name: '我的自選', contracts: [] };
        const { deps, getLists } = dependencies([original]);
        await expect(addStockToScreenerWatchlist(stock, deps)).resolves.toEqual({ status: 'added', listId: 'screener-list' });
        expect(deps.createWatchlist).toHaveBeenCalledWith(STOCK_SCREENER_LIST_NAME, [contract]);
        expect(deps.addWatchlistContracts).not.toHaveBeenCalled();
        expect(getLists().find((list) => list.id === 'active')).toEqual(original);
        expect(deps.invalidate).toHaveBeenCalledWith(STOCK_SCREENER_LIST_NAME);
    });

    it('既有清單新增一次，已存在時回 already_present', async () => {
        const existing: ServerWatchlist = { id: 'target', name: ' 選股 ', contracts: [] };
        const { deps, getLists } = dependencies([existing]);
        await expect(addStockToScreenerWatchlist(stock, deps)).resolves.toMatchObject({ status: 'added' });
        await expect(addStockToScreenerWatchlist(stock, deps)).resolves.toMatchObject({ status: 'already_present' });
        expect(deps.addWatchlistContracts).toHaveBeenCalledTimes(1);
        expect(getLists()[0]!.contracts).toEqual([wireContract]);
    });

    it('建立競態失敗後重抓唯一同名清單並加入', async () => {
        const { deps, getLists } = dependencies([]);
        vi.mocked(deps.createWatchlist).mockImplementationOnce(async () => {
            getLists().push({ id: 'won-by-other-tab', name: '選股', contracts: [] });
            throw new Error('duplicate');
        });
        await expect(addStockToScreenerWatchlist(stock, deps)).resolves.toEqual({ status: 'added', listId: 'won-by-other-tab' });
        expect(deps.addWatchlistContracts).toHaveBeenCalledWith('won-by-other-tab', [contract]);
    });

    it('同名不唯一、合約不一致及確認失敗均 fail closed', async () => {
        const duplicate = dependencies([
            { id: 'a', name: '選股', contracts: [] },
            { id: 'b', name: '選股', contracts: [] },
        ]);
        await expect(addStockToScreenerWatchlist(stock, duplicate.deps)).rejects.toThrow('多個同名');

        const mismatch = dependencies([]);
        vi.mocked(mismatch.deps.resolveContract).mockResolvedValue({ ...contract, exchange: 'OTC' });
        await expect(addStockToScreenerWatchlist(stock, mismatch.deps)).rejects.toThrow('市場或種類不一致');

        const unconfirmed = dependencies([{ id: 'target', name: '選股', contracts: [] }]);
        vi.mocked(unconfirmed.deps.addWatchlistContracts).mockResolvedValue({ id: 'target', name: '選股', contracts: [wireContract] });
        await expect(addStockToScreenerWatchlist(stock, unconfirmed.deps)).rejects.toThrow('尚未確認');
        expect(unconfirmed.deps.invalidate).not.toHaveBeenCalled();
    });
});
