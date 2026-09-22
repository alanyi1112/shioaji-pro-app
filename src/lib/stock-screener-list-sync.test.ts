import { describe, expect, it, vi } from 'vitest';
import type { UniverseStock } from './stock-screener-domain';
import { addStockToScreenerLists, type ScreenerListSyncDependencies } from './stock-screener-list-sync';

const stock: UniverseStock = { code: '2449', symbol: '2449.TW', name: '京元電子', market: 'TWSE', kind: 'ordinary' };

function dependencies(): ScreenerListSyncDependencies {
    return {
        addShioaji: vi.fn(async () => ({ status: 'added' as const, listId: 'shioaji-list' })),
        addMultiView: vi.fn(async () => ({ status: 'added' as const, symbol: stock.symbol, tabId: 'multiview-tab', tabLabel: '選股篩選' })),
    };
}

describe('選股結果雙端清單 orchestration', () => {
    it('兩端獨立執行並在皆確認後完成', async () => {
        const deps = dependencies();
        await expect(addStockToScreenerLists(stock, deps)).resolves.toMatchObject({
            status: 'complete', message: '已加入 Shioaji「選股」與 MultiView「選股篩選」',
            shioaji: { status: 'added' }, multiview: { status: 'added' },
        });
        expect(deps.addShioaji).toHaveBeenCalledExactlyOnceWith(stock);
        expect(deps.addMultiView).toHaveBeenCalledExactlyOnceWith(stock);
    });

    it('兩端原已存在時回覆可辨識成功', async () => {
        const deps = dependencies();
        vi.mocked(deps.addShioaji).mockResolvedValue({ status: 'already_present', listId: 'shioaji-list' });
        vi.mocked(deps.addMultiView).mockResolvedValue({ status: 'already_present', symbol: stock.symbol, tabId: 'multiview-tab', tabLabel: '選股篩選' });
        await expect(addStockToScreenerLists(stock, deps)).resolves.toMatchObject({ status: 'complete', message: '兩邊原已存在' });
    });

    it('任一端失敗保留另一端成功並可冪等重試', async () => {
        const deps = dependencies();
        vi.mocked(deps.addMultiView).mockRejectedValueOnce(new Error('MultiView 離線'));
        const partial = await addStockToScreenerLists(stock, deps);
        expect(partial).toMatchObject({ status: 'partial', shioaji: { status: 'added' }, multiview: { status: 'error' } });
        expect(partial.message).toContain('Shioaji「選股」已完成');
        expect(partial.message).toContain('可重試');
        vi.mocked(deps.addShioaji).mockResolvedValueOnce({ status: 'already_present', listId: 'shioaji-list' });
        await expect(addStockToScreenerLists(stock, deps)).resolves.toMatchObject({ status: 'complete' });
        expect(deps.addShioaji).toHaveBeenCalledTimes(2);
        expect(deps.addMultiView).toHaveBeenCalledTimes(2);
    });

    it('Shioaji 失敗但 MultiView 成功時不補償刪除', async () => {
        const deps = dependencies();
        vi.mocked(deps.addShioaji).mockRejectedValue(new Error('Shioaji 寫入失敗'));
        await expect(addStockToScreenerLists(stock, deps)).resolves.toMatchObject({
            status: 'partial', shioaji: { status: 'error' }, multiview: { status: 'added' },
        });
        expect(deps.addMultiView).toHaveBeenCalledTimes(1);
    });

    it('兩端都失敗時回覆 failed 而非假成功', async () => {
        const deps = dependencies();
        vi.mocked(deps.addShioaji).mockRejectedValue(new Error('Shioaji 離線'));
        vi.mocked(deps.addMultiView).mockRejectedValue(new Error('MultiView 離線'));
        const result = await addStockToScreenerLists(stock, deps);
        expect(result.status).toBe('failed');
        expect(result.message).toContain('加入兩邊清單失敗');
    });
});
