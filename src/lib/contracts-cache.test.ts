import { expect, it, vi } from 'vitest';
import type { ContractInfo } from './types/contract';

const mock = vi.hoisted(() => ({ subscribe: vi.fn(), resolve: vi.fn(), registerAlias: vi.fn() }));
vi.mock('./shioaji', () => ({ subscribeQuote: mock.subscribe, resolveContract: mock.resolve }));
vi.mock('./stream', () => ({ registerCodeAlias: mock.registerAlias }));

const settleSubscriptions = () => new Promise<void>(resolve => setTimeout(resolve, 0));

it('Tick 訂閱失敗但 BidAsk 成功時，下次只重試 Tick，不重送已成功類型', async () => {
    vi.resetModules();
    mock.subscribe.mockReset();
    let tickAttempt = 0;
    mock.subscribe.mockImplementation(async (_contract: ContractInfo, type: string) => {
        if (type === 'Tick' && tickAttempt++ === 0) throw new Error('upstream unavailable');
        return { success: true };
    });
    const cache = await import('./contracts-cache');
    const contract = { code: '2449', security_type: 'STK', exchange: 'TSE', target_code: null } as ContractInfo;
    cache.primeContract(contract);
    await cache.ensureContract('2449');
    await settleSubscriptions();
    expect(mock.subscribe.mock.calls.map(call => call[1])).toEqual(['Tick', 'BidAsk']);
    await cache.ensureContract('2449');
    await settleSubscriptions();
    expect(mock.subscribe.mock.calls.map(call => call[1])).toEqual(['Tick', 'BidAsk', 'Tick']);
    await cache.ensureContract('2449');
    await settleSubscriptions();
    expect(mock.subscribe).toHaveBeenCalledTimes(3);
});

it('指數只訂閱 Quote，已確認後不重送', async () => {
    vi.resetModules();
    mock.subscribe.mockReset().mockResolvedValue({ success: true });
    const cache = await import('./contracts-cache');
    const contract = { code: 'IX0001', security_type: 'IND', exchange: 'TSE', target_code: null } as ContractInfo;
    cache.primeContract(contract);
    await cache.ensureContract('IX0001');
    await settleSubscriptions();
    await cache.ensureContract('IX0001');
    expect(mock.subscribe.mock.calls.map(call => call[1])).toEqual(['Quote']);
});
