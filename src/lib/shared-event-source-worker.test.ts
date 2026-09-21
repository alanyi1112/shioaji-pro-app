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
afterEach(() => vi.unstubAllGlobals());
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
