import { describe, expect, it, vi } from 'vitest';
import { createScreenerChartSelection, type ChartTarget } from './screener-chart-selection';
import type { ContractInfo } from './types/contract';
import type { UniverseStock } from './stock-screener-domain';

const stock: UniverseStock = { code: '3008', symbol: '3008.TW', name: '大立光', kind: 'ordinary', market: 'TWSE' };
const contract = { code: stock.code, name: stock.name, exchange: 'TSE', security_type: 'STK' } as ContractInfo;
const quote = { code: stock.code, close: 2500 } as import('./types/market').Snapshot;
describe('選股只連動指定 K 線', () => {
    it('只 commit 指定未鎖定圖；不呼叫任何交易或個人清單操作', async () => {
        const commit = vi.fn();
        const controller = createScreenerChartSelection(() => [{ id: 'chart-1', type: 'chart', pin: null }, { id: 'ticket', type: 'ticket', pin: null }], async () => contract, async () => quote, commit);
        await expect(controller.pick(stock, 'ticket')).rejects.toThrow('未鎖定');
        await expect(controller.pick(stock, 'chart-1')).resolves.toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith('chart-1', expect.objectContaining({ contract, snapshot: quote, generation: 2 }));
    });
    it('A→B、目標鎖定／移除／改選與全域商品選擇均讓舊解析失效', async () => {
        let targets: ChartTarget[] = [{ id: 'c', type: 'chart', pin: null }];
        const pending: ((contract: ContractInfo) => void)[] = [];
        const commit = vi.fn();
        const controller = createScreenerChartSelection(() => targets, () => new Promise((resolve) => pending.push(resolve)), async () => quote, commit);
        const a = controller.pick(stock, 'c');
        const b = controller.pick(stock, 'c');
        pending[1]!(contract); await b;
        pending[0]!(contract); expect(await a).toBe(false);
        expect(commit).toHaveBeenCalledTimes(1);
        for (const action of ['pin', 'remove', 'cancel']) {
            targets = [{ id: 'c', type: 'chart', pin: null }];
            const next = controller.pick(stock, 'c');
            if (action === 'pin') targets = [{ id: 'c', type: 'chart', pin: '2330' }];
            else if (action === 'remove') targets = [];
            else controller.cancel();
            pending.at(-1)!(contract);
            expect(await next).toBe(false);
        }
        expect(commit).toHaveBeenCalledTimes(1);
    });
    it('解析失敗與轉市場不符保留原圖', async () => {
        const targets = () => [{ id: 'c', type: 'chart', pin: null }];
        const commit = vi.fn();
        await expect(createScreenerChartSelection(targets, async () => { throw new Error(); }, async () => quote, commit).pick(stock, 'c')).rejects.toThrow('無法解析');
        await expect(createScreenerChartSelection(targets, async () => ({ ...contract, exchange: 'OTC' }), async () => quote, commit).pick(stock, 'c')).rejects.toThrow('市場不一致');
        expect(commit).not.toHaveBeenCalled();
    });
    it('Snapshot 失敗仍原子切換 K 線 contract，並明示盤後報價不可用', async () => {
        const commit = vi.fn();
        const controller = createScreenerChartSelection(() => [{ id: 'c', type: 'chart', pin: null }], async () => contract,
            async () => { throw new Error('offline'); }, commit);
        await expect(controller.pick(stock, 'c')).resolves.toBe(true);
        expect(commit).toHaveBeenCalledWith('c', expect.objectContaining({ contract, snapshot: undefined,
            snapshotError: '盤後行情 Snapshot 暫時不可用' }));
    });
    it('Snapshot 載入期間快速連點或目標鎖定，過時 generation 不得 commit', async () => {
        let targets: ChartTarget[] = [{ id: 'c', type: 'chart', pin: null }];
        const pendingQuotes: ((value: import('./types/market').Snapshot) => void)[] = [];
        const commit = vi.fn();
        const controller = createScreenerChartSelection(() => targets, async () => contract,
            () => new Promise((resolve) => pendingQuotes.push(resolve)), commit);
        const a = controller.pick(stock, 'c');
        await Promise.resolve();
        const b = controller.pick(stock, 'c');
        await Promise.resolve();
        pendingQuotes[1]!(quote);
        expect(await b).toBe(true);
        pendingQuotes[0]!(quote);
        expect(await a).toBe(false);
        expect(commit).toHaveBeenCalledTimes(1);

        const locked = controller.pick(stock, 'c');
        await Promise.resolve();
        targets = [{ id: 'c', type: 'chart', pin: '2330' }];
        pendingQuotes[2]!(quote);
        expect(await locked).toBe(false);
        expect(commit).toHaveBeenCalledTimes(1);
    });
    it('使用者改選左側商品後，已接受但尚未完成的指定圖表請求不得回寫', async () => {
        const pendingContracts: ((value: ContractInfo) => void)[] = [];
        const commit = vi.fn();
        let ownsTarget = true;
        const controller = createScreenerChartSelection(
            () => [{ id: 'c', type: 'chart', pin: null }],
            () => new Promise((resolve) => pendingContracts.push(resolve)),
            async () => quote,
            commit,
        );
        const request = controller.pick(stock, 'c', () => ownsTarget);
        ownsTarget = false;
        pendingContracts[0]!(contract);
        await expect(request).resolves.toBe(false);
        expect(commit).not.toHaveBeenCalled();
    });
});
