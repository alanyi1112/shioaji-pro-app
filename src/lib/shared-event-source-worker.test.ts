import { afterEach, expect, it, vi } from 'vitest';
class Source {
    static OPEN = 1;
    static instances: Source[] = [];
    readyState = 0;
    onopen = () => {}; onerror = () => {};
    listeners = new Map<string, (event: { data: string }) => void>();
    close = vi.fn();
    constructor(readonly url: string) { Source.instances.push(this); }
    addEventListener(type: string, callback: (event: { data: string }) => void) { this.listeners.set(type, callback); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('多視窗共用一條 SSE，關閉其中一頁不斷線，最後一頁離開才關閉', async () => {
    vi.resetModules(); Source.instances = [];
    const scope = { location: new URL('http://localhost:5173/worker'), onconnect: null as unknown as (event: unknown) => void };
    vi.stubGlobal('self', scope); vi.stubGlobal('EventSource', Source);
    await import('./shared-event-source-worker');
    const port = () => ({ onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() });
    const a = port(), b = port();
    for (const p of [a, b]) { scope.onconnect({ ports: [p] }); p.onmessage({ data: { action: 'open', url: '/api/v1/stream/data' } }); }
    expect(Source.instances).toHaveLength(1);
    const s = Source.instances[0]!;
    s.onopen(); s.listeners.get('tick_stk')!({ data: '{"volume":1}' });
    expect(a.postMessage).toHaveBeenLastCalledWith({ type: 'tick_stk', data: '{"volume":1}' });
    expect(b.postMessage).toHaveBeenLastCalledWith({ type: 'tick_stk', data: '{"volume":1}' });
    a.onmessage({ data: { action: 'close' } }); expect(s.close).not.toHaveBeenCalled();
    a.postMessage.mockClear(); s.listeners.get('heartbeat')!({ data: '{}' });
    expect(a.postMessage).not.toHaveBeenCalled();
    expect(b.postMessage).toHaveBeenLastCalledWith({ type: 'heartbeat', data: '{}' });
    b.onmessage({ data: { action: 'close' } }); expect(s.close).toHaveBeenCalledOnce();
});
it('拒絕外部與非行情 URL，不建立網路連線', async () => {
    vi.resetModules(); Source.instances = [];
    const scope = { location: new URL('http://localhost:5173/worker'), onconnect: null as unknown as (event: unknown) => void };
    vi.stubGlobal('self', scope); vi.stubGlobal('EventSource', Source);
    await import('./shared-event-source-worker');
    for (const url of ['https://example.com/api/v1/stream/data', '/api/v1/orders']) {
        const p = { onmessage: null as unknown as (event: unknown) => void, start() {} };
        scope.onconnect({ ports: [p] }); p.onmessage({ data: { action: 'open', url } });
    }
    expect(Source.instances).toHaveLength(0);
});
it('既有 port 可唯讀擷取跨視窗 refcount、事件計數及最後 listener 關閉收據', async () => {
    vi.resetModules(); Source.instances = [];
    const scope = { location: new URL('http://localhost:5173/worker'), onconnect: null as unknown as (event: unknown) => void };
    vi.stubGlobal('self', scope); vi.stubGlobal('EventSource', Source);
    await import('./shared-event-source-worker');
    const port = () => ({ onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() });
    const a = port(), b = port();
    for (const p of [a, b]) { scope.onconnect({ ports: [p] }); p.onmessage({ data: { action: 'open', url: '/api/v1/stream/data' } }); }
    const snapshot = (p: typeof a, id: number) => {
        p.onmessage({ data: { action: 'diagnostics', requestId: id } });
        return p.postMessage.mock.lastCall?.[0].snapshot;
    };
    expect(snapshot(a, 1)).toMatchObject({ sourceCreated: 1, sourceClosed: 0, channels: [{ path: '/api/v1/stream/data', portCount: 2 }] });
    expect(Source.instances).toHaveLength(1); // query never opens a second transport
    const source = Source.instances[0]!;
    source.listeners.get('tick_stk')!({ data: '{"code":"2449","volume":1}' });
    expect(snapshot(b, 2).channels[0].eventCounts.tick_stk).toBe(1);
    a.onmessage({ data: { action: 'close' } });
    expect(snapshot(b, 3).channels[0].portCount).toBe(1);
    expect(source.close).not.toHaveBeenCalled();
    b.onmessage({ data: { action: 'close' } });
    expect(source.close).toHaveBeenCalledOnce();
    const c = port();
    scope.onconnect({ ports: [c] }); c.onmessage({ data: { action: 'open', url: '/api/v1/stream/data' } });
    expect(snapshot(c, 4)).toMatchObject({ sourceCreated: 2, sourceClosed: 1, channels: [{ portCount: 1 }] });
});
it('指定商品診斷只保留有界成交欄位，停止後不再解析，無額外訂閱', async () => {
    vi.resetModules(); Source.instances = [];
    const scope = { location: new URL('http://localhost:5173/worker'), onconnect: null as unknown as (event: unknown) => void };
    vi.stubGlobal('self', scope); vi.stubGlobal('EventSource', Source);
    await import('./shared-event-source-worker');
    const p = { onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() };
    scope.onconnect({ ports: [p] }); p.onmessage({ data: { action: 'open', url: '/api/v1/stream/data' } });
    p.onmessage({ data: { action: 'diagnostics-watch', requestId: 1, code: '2449' } });
    expect(p.postMessage).toHaveBeenLastCalledWith({ type: 'diagnostics-watch-ack', requestId: 1 });
    const source = Source.instances[0]!;
    for (let i = 0; i < 40; i++) source.listeners.get('tick_stk')!({ data: JSON.stringify({ code: '2449', date: '2026-10-01', time: `09:00:${i}`, close: '300', volume: 1, tick_type: 0, token: 'never-expose' }) });
    source.listeners.get('tick_stk')!({ data: '{"code":"2330","volume":2}' });
    p.onmessage({ data: { action: 'diagnostics', requestId: 2 } });
    const watch = p.postMessage.mock.lastCall?.[0].snapshot.channels[0].watch;
    expect(watch.ticks).toHaveLength(32);
    expect(watch.ticks[0]).toMatchObject({ code: '2449', time: '09:00:8', tickType: 0 });
    expect(JSON.stringify(watch)).not.toContain('never-expose');
    p.onmessage({ data: { action: 'diagnostics-watch', requestId: 3, code: '' } });
    p.onmessage({ data: { action: 'diagnostics', requestId: 4 } });
    expect(p.postMessage.mock.lastCall?.[0].snapshot.channels[0].watch).toBeNull();
    expect(Source.instances).toHaveLength(1);
});
it('心跳靜止逾一分鐘才依序更換唯一 SSE，保留跨視窗 port 與 refcount', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    vi.resetModules(); Source.instances = [];
    const scope = { location: new URL('http://localhost:5173/worker'), onconnect: null as unknown as (event: unknown) => void };
    vi.stubGlobal('self', scope); vi.stubGlobal('EventSource', Source);
    await import('./shared-event-source-worker');
    const port = () => ({ onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() });
    const a = port(), b = port();
    for (const p of [a, b]) { scope.onconnect({ ports: [p] }); p.onmessage({ data: { action: 'open', url: '/api/v1/stream/data' } }); }
    const first = Source.instances[0]!;
    first.readyState = Source.OPEN; first.onopen();
    await vi.advanceTimersByTimeAsync(50_000);
    first.listeners.get('heartbeat')!({ data: '{}' });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(Source.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(first.close).toHaveBeenCalledOnce();
    expect(Source.instances).toHaveLength(2);
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'reconnecting', reason: 'heartbeat_stale' });
    expect(b.postMessage).toHaveBeenCalledWith({ type: 'reconnecting', reason: 'heartbeat_stale' });
    const second = Source.instances[1]!;
    second.readyState = Source.OPEN; second.onopen();
    b.onmessage({ data: { action: 'diagnostics', requestId: 1 } });
    expect(b.postMessage.mock.lastCall?.[0].snapshot).toMatchObject({
        sourceCreated: 2, sourceClosed: 1,
        channels: [{ portCount: 2, watchdogRestarts: 1 }],
    });
    a.onmessage({ data: { action: 'close' } });
    expect(second.close).not.toHaveBeenCalled();
    b.onmessage({ data: { action: 'close' } });
    expect(second.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});

it('本機模擬驗收中斷只關閉既有成交 SSE，保留 ports 並在 15 秒後自動接回', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T03:30:00Z'));
    vi.resetModules(); Source.instances = [];
    const scope = { location: new URL('http://localhost:5173/worker'), onconnect: null as unknown as (event: unknown) => void };
    vi.stubGlobal('self', scope); vi.stubGlobal('EventSource', Source);
    await import('./shared-event-source-worker');
    const port = () => ({ onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() });
    const a = port(), b = port();
    for (const p of [a, b]) { scope.onconnect({ ports: [p] }); p.onmessage({ data: { action: 'open', url: '/api/v1/stream/data' } }); }
    const first = Source.instances[0]!;
    first.readyState = Source.OPEN; first.onopen();
    a.onmessage({ data: { action: 'acceptance-interrupt', requestId: 1, simulation: false } });
    expect(a.postMessage).toHaveBeenLastCalledWith({ type: 'acceptance-interrupt-ack', requestId: 1, accepted: false });
    expect(first.close).not.toHaveBeenCalled();
    a.onmessage({ data: { action: 'acceptance-interrupt', requestId: 2, simulation: true } });
    expect(first.close).toHaveBeenCalledOnce();
    expect(Source.instances).toHaveLength(1);
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'reconnecting', reason: 'acceptance_interrupt' });
    expect(b.postMessage).toHaveBeenCalledWith({ type: 'reconnecting', reason: 'acceptance_interrupt' });
    expect(a.postMessage).toHaveBeenLastCalledWith({ type: 'acceptance-interrupt-ack', requestId: 2, accepted: true });
    b.onmessage({ data: { action: 'diagnostics', requestId: 3 } });
    expect(b.postMessage.mock.lastCall?.[0].snapshot.channels[0]).toMatchObject({ portCount: 2, acceptanceInterrupted: true, acceptanceInterrupts: 1 });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(Source.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(Source.instances).toHaveLength(2);
    const second = Source.instances[1]!;
    second.readyState = Source.OPEN; second.onopen();
    b.onmessage({ data: { action: 'diagnostics', requestId: 4 } });
    expect(b.postMessage.mock.lastCall?.[0].snapshot).toMatchObject({ sourceCreated: 2, sourceClosed: 1, channels: [{ portCount: 2, acceptanceInterrupted: false }] });
    a.onmessage({ data: { action: 'close' } });
    b.onmessage({ data: { action: 'close' } });
    expect(vi.getTimerCount()).toBe(0);
});

it('本機模擬靜默演練保持 EventSource OPEN，滿 60 秒由原 watchdog 自行替換單一來源', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T03:40:00Z'));
    vi.resetModules(); Source.instances = [];
    const scope = { location: new URL('http://localhost:5173/worker'), onconnect: null as unknown as (event: unknown) => void };
    vi.stubGlobal('self', scope); vi.stubGlobal('EventSource', Source);
    await import('./shared-event-source-worker');
    const port = () => ({ onmessage: null as unknown as (event: unknown) => void, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() });
    const a = port(), b = port();
    for (const p of [a, b]) { scope.onconnect({ ports: [p] }); p.onmessage({ data: { action: 'open', url: '/api/v1/stream/data' } }); }
    const first = Source.instances[0]!;
    first.readyState = Source.OPEN; first.onopen();
    a.onmessage({ data: { action: 'acceptance-silence', requestId: 1, simulation: false } });
    expect(a.postMessage).toHaveBeenLastCalledWith({ type: 'acceptance-silence-ack', requestId: 1, accepted: false });
    a.onmessage({ data: { action: 'acceptance-silence', requestId: 2, simulation: true } });
    expect(a.postMessage).toHaveBeenLastCalledWith({ type: 'acceptance-silence-ack', requestId: 2, accepted: true });
    a.postMessage.mockClear(); b.postMessage.mockClear();
    await vi.advanceTimersByTimeAsync(20_000);
    first.listeners.get('heartbeat')!({ data: '{}' });
    first.listeners.get('tick_stk')!({ data: '{"code":"2330","volume":1}' });
    expect(first.readyState).toBe(Source.OPEN);
    expect(first.close).not.toHaveBeenCalled();
    expect(a.postMessage).not.toHaveBeenCalled();
    expect(b.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(39_999);
    expect(Source.instances).toHaveLength(1);
    b.onmessage({ data: { action: 'diagnostics', requestId: 3 } });
    expect(b.postMessage.mock.lastCall?.[0].snapshot.channels[0]).toMatchObject({
        portCount: 2, readyState: Source.OPEN, watchdogRestarts: 0,
        silentDrillAttempts: 1, silentDrillSuppressedEvents: 2,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(first.close).toHaveBeenCalledOnce();
    expect(Source.instances).toHaveLength(2);
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'reconnecting', reason: 'heartbeat_stale' });
    const second = Source.instances[1]!;
    second.readyState = Source.OPEN; second.onopen();
    second.listeners.get('tick_stk')!({ data: '{"code":"2330","volume":2}' });
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'tick_stk', data: '{"code":"2330","volume":2}' });
    b.onmessage({ data: { action: 'diagnostics', requestId: 4 } });
    expect(b.postMessage.mock.lastCall?.[0].snapshot).toMatchObject({
        sourceCreated: 2, sourceClosed: 1,
        channels: [{ portCount: 2, watchdogRestarts: 1, silentDrillStartedAt: null }],
    });
    a.onmessage({ data: { action: 'close' } });
    b.onmessage({ data: { action: 'close' } });
    expect(vi.getTimerCount()).toBe(0);
});
