import { describe, expect, it, vi } from 'vitest';
import type { ServerWatchlist } from './shioaji';
import type { UniverseStock } from './stock-screener-domain';
import type { ContractInfo } from './types/contract';
import {
    addStockToIntradayMonitorWatchlist,
    INTRADAY_MONITOR_LIST_NAME,
    type IntradayMonitorWatchlistDependencies,
} from './intraday-monitor-watchlist';

const stock: UniverseStock = {
    code: '2454', symbol: '2454.TW', name: '聯發科', market: 'TWSE', kind: 'ordinary',
};
const contract = {
    code: '2454', name: '聯發科', exchange: 'TSE', security_type: 'STK', target_code: null,
} as ContractInfo;
const wireContract = { code: '2454', exchange: 'TSE', security_type: 'STK' as const };

function fixture(initial: ServerWatchlist[] = []) {
    let lists = structuredClone(initial);
    const deps: IntradayMonitorWatchlistDependencies = {
        resolveContract: vi.fn(async () => contract),
        fetchWatchlists: vi.fn(async () => structuredClone(lists)),
        createWatchlist: vi.fn(async (name: string, contracts: ContractInfo[]) => {
            const created: ServerWatchlist = {
                id: 'intraday-list', name,
                contracts: contracts.map((item) => ({
                    code: item.code,
                    exchange: item.exchange ?? '',
                    security_type: item.security_type,
                })),
            };
            lists.push(created);
            return structuredClone(created);
        }),
        addWatchlistContracts: vi.fn(async (id: string, contracts: ContractInfo[]) => {
            const target = lists.find((list) => list.id === id)!;
            target.contracts.push(...contracts.map((item) => ({
                code: item.code,
                exchange: item.exchange ?? '',
                security_type: item.security_type,
            })));
            return structuredClone(target);
        }),
        invalidate: vi.fn(),
    };
    return { deps, lists: () => lists };
}

describe('盤中選股指定清單寫入', () => {
    it('不存在時建立精確名稱清單並帶入商品，不改動其他清單', async () => {
        const active: ServerWatchlist = { id: 'active', name: '我的自選', contracts: [] };
        const { deps, lists } = fixture([active]);
        await expect(addStockToIntradayMonitorWatchlist(stock, deps)).resolves.toEqual({
            status: 'added', listId: 'intraday-list',
        });
        expect(deps.createWatchlist).toHaveBeenCalledWith(INTRADAY_MONITOR_LIST_NAME, [contract]);
        expect(deps.addWatchlistContracts).not.toHaveBeenCalled();
        expect(lists().find((list) => list.id === 'active')).toEqual(active);
        expect(lists().find((list) => list.name === '選股')).toBeUndefined();
        expect(deps.invalidate).toHaveBeenCalledWith(INTRADAY_MONITOR_LIST_NAME);
    });

    it('只加入一次，NFKC 名稱相符時回傳 already_present', async () => {
        const { deps, lists } = fixture([{ id: 'target', name: ' 盤中選股 ', contracts: [] }]);
        await expect(addStockToIntradayMonitorWatchlist(stock, deps)).resolves.toMatchObject({ status: 'added' });
        await expect(addStockToIntradayMonitorWatchlist(stock, deps)).resolves.toMatchObject({ status: 'already_present' });
        expect(deps.addWatchlistContracts).toHaveBeenCalledTimes(1);
        expect(lists()[0]!.contracts).toEqual([wireContract]);
    });

    it('mutation 回應不明時只重讀對帳，不自動重送', async () => {
        const confirmed = fixture([{ id: 'target', name: '盤中選股', contracts: [] }]);
        vi.mocked(confirmed.deps.addWatchlistContracts).mockImplementationOnce(async () => {
            confirmed.lists()[0]!.contracts.push(wireContract);
            throw new Error('network lost after commit');
        });
        await expect(addStockToIntradayMonitorWatchlist(stock, confirmed.deps)).resolves.toMatchObject({ status: 'added' });
        expect(confirmed.deps.addWatchlistContracts).toHaveBeenCalledTimes(1);

        const unknown = fixture([{ id: 'target', name: '盤中選股', contracts: [] }]);
        vi.mocked(unknown.deps.addWatchlistContracts).mockRejectedValueOnce(new Error('timeout'));
        await expect(addStockToIntradayMonitorWatchlist(stock, unknown.deps)).rejects.toThrow('結果不明');
        expect(unknown.deps.addWatchlistContracts).toHaveBeenCalledTimes(1);
        expect(unknown.deps.invalidate).not.toHaveBeenCalled();
    });

    it('同名不唯一、非 STK／錯誤市場與未確認結果都 fail closed', async () => {
        const duplicate = fixture([
            { id: 'a', name: '盤中選股', contracts: [] },
            { id: 'b', name: '盤中選股', contracts: [] },
        ]);
        await expect(addStockToIntradayMonitorWatchlist(stock, duplicate.deps)).rejects.toThrow('多個同名');

        const mismatch = fixture([]);
        vi.mocked(mismatch.deps.resolveContract).mockResolvedValue({ ...contract, exchange: 'OTC' });
        await expect(addStockToIntradayMonitorWatchlist(stock, mismatch.deps)).rejects.toThrow('市場或種類不一致');

        const unconfirmed = fixture([{ id: 'target', name: '盤中選股', contracts: [] }]);
        vi.mocked(unconfirmed.deps.addWatchlistContracts).mockResolvedValue({
            id: 'target', name: '盤中選股', contracts: [wireContract],
        });
        await expect(addStockToIntradayMonitorWatchlist(stock, unconfirmed.deps)).rejects.toThrow('尚未確認');
    });
});
