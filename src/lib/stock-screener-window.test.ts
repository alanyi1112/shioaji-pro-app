import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UniverseStock } from './stock-screener-domain';
import {
    createSourceWindowId,
    openStockScreenerLayoutWindow,
    openStockScreenerWindow,
    parseScreenerBridgeMessage,
    resolveStockScreenerLayoutUrl,
    resolveStockScreenerUrl,
    startScreenerBridgeClient,
    startScreenerBridgeHost,
    type ScreenerChannelFactory,
} from './stock-screener-window';

class FakeBus {
    private channels = new Map<string, Set<FakeChannel>>();
    factory: ScreenerChannelFactory = (name) => {
        const channel = new FakeChannel(name, this);
        const bucket = this.channels.get(name) ?? new Set<FakeChannel>();
        bucket.add(channel); this.channels.set(name, bucket);
        return channel;
    };
    send(sender: FakeChannel, name: string, data: unknown) {
        for (const channel of this.channels.get(name) ?? []) {
            if (channel !== sender) channel.receive(data);
        }
    }
    remove(channel: FakeChannel, name: string) { this.channels.get(name)?.delete(channel); }
}
class FakeChannel {
    private listeners = new Set<(event: MessageEvent<unknown>) => void>();
    constructor(private name: string, private bus: FakeBus) {}
    postMessage(data: unknown) { this.bus.send(this, this.name, data); }
    addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) { this.listeners.add(listener); }
    removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) { this.listeners.delete(listener); }
    close() { this.bus.remove(this, this.name); }
    receive(data: unknown) { for (const listener of this.listeners) listener({ data } as MessageEvent<unknown>); }
}

const stock: UniverseStock = {
    code: '3008', symbol: '3008.TW', name: '大立光', market: 'TWSE', kind: 'ordinary',
};

afterEach(() => vi.useRealTimers());

describe('選股新分頁 URL 與 bridge', () => {
    it('從版面選單開啟完整交易工作區，而非單獨選股根頁面', () => {
        expect(resolveStockScreenerLayoutUrl('https://evil.example')).toBe(
            'http://127.0.0.1:5173/?layout=stock-screener',
        );
        const open = vi.fn(() => null);
        openStockScreenerLayoutWindow(
            { open } as Pick<Window, 'open'>,
            'http://localhost:5173',
        );
        expect(open).toHaveBeenCalledWith(
            'http://localhost:5173/?layout=stock-screener',
            '_blank',
            'noopener',
        );
    });

    it('只接受 loopback 5173，並隔離 opener 後開啟具來源識別的新分頁', () => {
        expect(resolveStockScreenerUrl('source-a', 'https://evil.example')).toBe('http://127.0.0.1:5173/?popout=screener&sourceWindowId=source-a');
        const open = vi.fn(() => null);
        openStockScreenerWindow('source-a', { open } as Pick<Window, 'open'>, 'http://localhost:5173');
        expect(open).toHaveBeenCalledWith('http://localhost:5173/?popout=screener&sourceWindowId=source-a', '_blank', 'noopener');
        expect(createSourceWindowId({ randomUUID: () => 'source-a' })).toBe('source-a');
    });

    it('拒絕錯版、壞 payload 與不完整股票', () => {
        expect(parseScreenerBridgeMessage({ version: 2, sourceWindowId: 'a', type: 'client-ready' })).toBeNull();
        expect(parseScreenerBridgeMessage({ version: 1, sourceWindowId: 'a', type: 'pick-request', requestId: '1', targetRevision: '1', targetId: 'c', stock: { code: '3008' } })).toBeNull();
        expect(parseScreenerBridgeMessage({ version: 1, sourceWindowId: 'a', type: 'client-ready' })).toMatchObject({ type: 'client-ready' });
    });

    it('只讓來源 id 相符的 client 取得目標及更新圖表', async () => {
        const bus = new FakeBus();
        const pickA = vi.fn(async () => true);
        const pickB = vi.fn(async () => true);
        const closeA = startScreenerBridgeHost({ sourceWindowId: 'a', getTargets: () => [{ id: 'chart-a', label: 'A' }], pick: pickA, openChart: () => 'new-a', channelFactory: bus.factory });
        const closeB = startScreenerBridgeHost({ sourceWindowId: 'b', getTargets: () => [{ id: 'chart-b', label: 'B' }], pick: pickB, openChart: () => 'new-b', channelFactory: bus.factory });
        let stateA = { connected: false, targets: [] as { id: string; label: string }[], targetRevision: '' };
        const clientA = startScreenerBridgeClient({ sourceWindowId: 'a', onState: (state) => { stateA = state; }, channelFactory: bus.factory });
        expect(stateA.connected).toBe(true);
        expect(stateA.targets.map((target) => target.id)).toEqual(['chart-a']);
        await expect(clientA.pick(stock, 'chart-a')).resolves.toBe(true);
        expect(pickA).toHaveBeenCalledWith(stock, 'chart-a', expect.any(Function));
        expect(pickB).not.toHaveBeenCalled();
        await expect(clientA.openChart()).resolves.toBe('new-a');
        clientA.close(); closeA(); closeB();
    });

    it('目標 revision 過時時拒絕，來源失聯後 fail closed', async () => {
        vi.useFakeTimers();
        const bus = new FakeBus();
        let targets = [{ id: 'chart-a', label: 'A' }];
        const pick = vi.fn(async () => true);
        const closeHost = startScreenerBridgeHost({ sourceWindowId: 'a', getTargets: () => targets, pick, openChart: () => undefined, channelFactory: bus.factory, heartbeatMs: 100 });
        let state = { connected: false, targets: [] as { id: string; label: string }[], targetRevision: '' };
        const client = startScreenerBridgeClient({ sourceWindowId: 'a', onState: (next) => { state = next; }, channelFactory: bus.factory, timeoutMs: 300 });
        expect(state.connected).toBe(true);
        targets = [];
        await expect(client.pick(stock, 'chart-a')).rejects.toThrow('圖表清單已更新');
        expect(pick).not.toHaveBeenCalled();
        closeHost();
        await vi.advanceTimersByTimeAsync(700);
        expect(state.connected).toBe(false);
        await expect(client.pick(stock, 'chart-a')).rejects.toThrow('尚未連接');
        client.close();
    });

    it('全域商品版本變更後，已接受的舊請求失去指定圖表 ownership', async () => {
        const bus = new FakeBus();
        let contextRevision = 1;
        let finish: (() => void) | undefined;
        const pick = vi.fn(async (
            _stock: UniverseStock,
            _targetId: string,
            stillOwnsTarget: () => boolean = () => true,
        ) => {
            await new Promise<void>((resolve) => { finish = resolve; });
            return stillOwnsTarget();
        });
        const closeHost = startScreenerBridgeHost({
            sourceWindowId: 'a',
            getTargets: () => [{ id: 'chart-a', label: 'K 線圖 1' }],
            getContextRevision: () => contextRevision,
            pick,
            openChart: () => undefined,
            channelFactory: bus.factory,
        });
        const client = startScreenerBridgeClient({
            sourceWindowId: 'a',
            onState: () => undefined,
            channelFactory: bus.factory,
        });
        const request = client.pick(stock, 'chart-a');
        contextRevision += 1;
        finish?.();
        await expect(request).rejects.toThrow('圖表選擇已取消');
        client.close();
        closeHost();
    });
});
