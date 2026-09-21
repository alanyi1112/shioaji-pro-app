/** EventSource-compatible page endpoint; reconnect policy remains owned by stream.ts. */
export interface StreamSource {
    onopen: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    addEventListener(type: string, listener: EventListener): void;
    close(): void;
}
export function createStreamSource(url: string): StreamSource {
    if (typeof SharedWorker === 'undefined' || typeof location === 'undefined'
        || new URL(url, location.href).origin !== location.origin) return new EventSource(url);
    let worker: SharedWorker;
    try { worker = new SharedWorker(new URL('./shared-event-source-worker.ts', import.meta.url), { type: 'module', name: 'realtimestock-market-stream-v1' }); }
    catch { return new EventSource(url); }
    const target = new EventTarget();
    let closed = false;
    const source: StreamSource = {
        onopen: null, onerror: null,
        addEventListener: (type, listener) => target.addEventListener(type, listener),
        close: () => {
            if (closed) return;
            closed = true;
            window.removeEventListener('pagehide', source.close);
            worker.port.postMessage({ action: 'close' }); worker.port.close();
        },
    };
    worker.port.onmessage = ({ data }) => {
        if (closed) return;
        if (data.type === 'open') source.onopen?.(new Event('open'));
        else if (data.type === 'error') source.onerror?.(new Event('error'));
        else target.dispatchEvent(new MessageEvent(data.type, { data: data.data }));
    };
    worker.onerror = () => { if (!closed) source.onerror?.(new Event('error')); };
    window.addEventListener('pagehide', source.close);
    worker.port.start();
    worker.port.postMessage({ action: 'open', url: new URL(url, location.href).href });
    return source;
}
