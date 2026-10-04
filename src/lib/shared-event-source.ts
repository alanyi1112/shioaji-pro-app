/** EventSource-compatible page endpoint; reconnect policy remains owned by stream.ts. */
export interface SharedStreamDiagnostics {
    capturedAt: number;
    transport: 'shared-worker';
    sourceCreated: number;
    sourceClosed: number;
    channels: {
        path: string;
        portCount: number;
        readyState: number;
        createdAt: number;
        openedAt: number | null;
        erroredAt: number | null;
        lastEventAt: number;
        watchdogRestarts: number;
        acceptanceInterrupts: number;
        acceptanceInterrupted: boolean;
        silentDrillStartedAt: number | null;
        silentDrillAttempts: number;
        silentDrillSuppressedEvents: number;
        eventCounts: Record<string, number>;
        watch: {
            code: string;
            until: number;
            ticks: { receivedAt: number; code: string; date: string; time: string; close: string; volume: number; tickType: number | null }[];
        } | null;
    }[];
}
export interface StreamSource {
    onopen: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onreconnecting?: ((event: Event) => void) | null;
    addEventListener(type: string, listener: EventListener): void;
    close(): void;
    getDiagnostics?(): Promise<SharedStreamDiagnostics | null>;
    watchTicks?(code: string): Promise<boolean>;
    interruptForAcceptance?(simulation: boolean): Promise<boolean>;
    silenceForWatchdogAcceptance?(simulation: boolean): Promise<boolean>;
}
export function createStreamSource(url: string): StreamSource {
    if (typeof SharedWorker === 'undefined' || typeof location === 'undefined'
        || new URL(url, location.href).origin !== location.origin) return new EventSource(url);
    let worker: SharedWorker;
    try { worker = new SharedWorker(new URL('./shared-event-source-worker.ts', import.meta.url), { type: 'module', name: 'realtimestock-market-stream-v3' }); }
    catch { return new EventSource(url); }
    const target = new EventTarget();
    let closed = false;
    let nextRequestId = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
    const request = (action: 'diagnostics' | 'diagnostics-watch' | 'acceptance-interrupt' | 'acceptance-silence', code?: string, simulation?: boolean): Promise<unknown> => {
        if (closed) return Promise.resolve(null);
        const requestId = ++nextRequestId;
        return new Promise((resolve) => {
            const timer = setTimeout(() => { pending.delete(requestId); resolve(null); }, 1500);
            pending.set(requestId, { resolve, timer });
            worker.port.postMessage({ action, requestId, code, simulation });
        });
    };
    const source: StreamSource = {
        onopen: null, onerror: null,
        onreconnecting: null,
        addEventListener: (type, listener) => target.addEventListener(type, listener),
        getDiagnostics: () => request('diagnostics') as Promise<SharedStreamDiagnostics | null>,
        watchTicks: async (code) => (await request('diagnostics-watch', code)) === true,
        interruptForAcceptance: async (simulation) => (await request('acceptance-interrupt', undefined, simulation)) === true,
        silenceForWatchdogAcceptance: async (simulation) => (await request('acceptance-silence', undefined, simulation)) === true,
        close: () => {
            if (closed) return;
            closed = true;
            for (const { resolve, timer } of pending.values()) { clearTimeout(timer); resolve(null); }
            pending.clear();
            window.removeEventListener('pagehide', source.close);
            worker.port.postMessage({ action: 'close' }); worker.port.close();
        },
    };
    worker.port.onmessage = ({ data }) => {
        if (closed) return;
        if (data.type === 'diagnostics' || data.type === 'diagnostics-watch-ack' || data.type === 'acceptance-interrupt-ack' || data.type === 'acceptance-silence-ack') {
            const entry = pending.get(data.requestId);
            if (entry) {
                clearTimeout(entry.timer);
                pending.delete(data.requestId);
                entry.resolve(data.type === 'diagnostics' ? data.snapshot : data.type === 'diagnostics-watch-ack' ? true : data.accepted === true);
            }
            return;
        }
        if (data.type === 'open') source.onopen?.(new Event('open'));
        else if (data.type === 'error') source.onerror?.(new Event('error'));
        else if (data.type === 'reconnecting') source.onreconnecting?.(new CustomEvent('reconnecting', { detail: data.reason }));
        else target.dispatchEvent(new MessageEvent(data.type, { data: data.data }));
    };
    worker.onerror = () => { if (!closed) source.onerror?.(new Event('error')); };
    window.addEventListener('pagehide', source.close);
    worker.port.start();
    worker.port.postMessage({ action: 'open', url: new URL(url, location.href).href });
    return source;
}
