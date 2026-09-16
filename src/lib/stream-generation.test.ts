import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./runtime', () => ({ getApiBase: () => '' }));
vi.mock('./api', () => ({ apiPost: vi.fn(async () => ({ success: true })) }));
class Source {
    static instances: Source[] = [];
    listeners = new Map<string, (event: { data: string }) => void>();
    onopen = () => {}; onerror = () => {}; close = vi.fn();
    constructor(readonly url: string) { Source.instances.push(this); }
    addEventListener(name: string, fn: (event: { data: string }) => void) { this.listeners.set(name, fn); }
    tick() { this.listeners.get('tick_stk')?.({ data: JSON.stringify({ code: '2330', date: '2026-09-11', time: '10:00:00', close: '100', volume: 10, total_volume: 10, tick_type: 1 }) }); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('重連後舊 SSE 的成交、heartbeat 與 error 不得污染新連線', async () => {
    vi.useFakeTimers(); vi.stubGlobal('EventSource', Source); vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const stream = await import('./stream'); const listener = vi.fn(); const off = stream.onAnyTick(listener);
    stream.ensureStream(); const old = Source.instances[0]!; old.onopen(); old.tick(); expect(listener).toHaveBeenCalledTimes(1);
    old.onerror(); await vi.advanceTimersByTimeAsync(1000);
    const current = Source.instances.filter(s => s.url.endsWith('/stream/data')).at(-1)!; current.onopen();
    old.tick(); old.onerror(); old.listeners.get('heartbeat')?.({ data: '{}' });
    expect(listener).toHaveBeenCalledTimes(1); expect(stream.getStreamStatus()).toBe('live'); expect(current.close).not.toHaveBeenCalled();
    current.tick(); expect(listener).toHaveBeenCalledTimes(2); off();
});
