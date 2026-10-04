import { afterEach, expect, it, vi } from 'vitest';
import { createStreamSource } from './shared-event-source';

afterEach(() => vi.unstubAllGlobals());

it('診斷與指定商品觀察沿用既有 SharedWorker port，關閉後不建立額外連線', async () => {
    const port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(), close: vi.fn(), start: vi.fn(),
    };
    const worker = { port, onerror: null as (() => void) | null };
    const Worker = vi.fn(function () { return worker; });
    const browser = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('location', new URL('http://localhost:5173/'));
    vi.stubGlobal('window', browser);
    vi.stubGlobal('SharedWorker', Worker);
    const source = createStreamSource('/api/v1/stream/data');
    expect(Worker).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledWith({ action: 'open', url: 'http://localhost:5173/api/v1/stream/data' });
    const reconnecting = vi.fn();
    source.onreconnecting = reconnecting;
    port.onmessage?.({ data: { type: 'reconnecting', reason: 'heartbeat_stale' } });
    expect(reconnecting).toHaveBeenCalledOnce();
    expect(port.close).not.toHaveBeenCalled();

    const watch = source.watchTicks!('2449');
    const watchRequest = port.postMessage.mock.lastCall?.[0];
    expect(watchRequest).toMatchObject({ action: 'diagnostics-watch', code: '2449' });
    port.onmessage?.({ data: { type: 'diagnostics-watch-ack', requestId: watchRequest.requestId } });
    expect(await watch).toBe(true);

    const snapshot = source.getDiagnostics!();
    const request = port.postMessage.mock.lastCall?.[0];
    expect(request.action).toBe('diagnostics');
    port.onmessage?.({ data: { type: 'diagnostics', requestId: request.requestId, snapshot: {
        capturedAt: 1, transport: 'shared-worker', sourceCreated: 1, sourceClosed: 0, channels: [],
    } } });
    expect(await snapshot).toMatchObject({ transport: 'shared-worker', sourceCreated: 1 });
    expect(Worker).toHaveBeenCalledOnce();
    source.close();
    expect(port.postMessage).toHaveBeenLastCalledWith({ action: 'close' });
    expect(port.close).toHaveBeenCalledOnce();
    expect(await source.getDiagnostics!()).toBeNull();
});
