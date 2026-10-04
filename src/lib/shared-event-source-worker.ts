// One transport per URL across same-origin windows. No persisted messages.
type TickTrace = { receivedAt: number; code: string; date: string; time: string; close: string; volume: number; tickType: number | null };
type Channel = {
    source: EventSource;
    ports: Set<MessagePort>;
    url: string;
    path: string;
    createdAt: number;
    openedAt: number | null;
    erroredAt: number | null;
    lastEventAt: number;
    watchdogRestarts: number;
    watchdogTimer: ReturnType<typeof setInterval>;
    acceptanceTimer: ReturnType<typeof setTimeout> | null;
    acceptanceInterrupts: number;
    silentDrillTimer: ReturnType<typeof setTimeout> | null;
    silentDrillStartedAt: number | null;
    silentDrillAttempts: number;
    silentDrillSuppressedEvents: number;
    eventCounts: Record<string, number>;
    watch: { code: string; owner: MessagePort; until: number; ticks: TickTrace[] } | null;
};
const channels = new Map<string, Channel>();
const lifecycle = { created: 0, closed: 0 };
const events = ['tick_stk', 'tick_fop', 'bidask_stk', 'bidask_fop', 'quote_idx', 'order_event', 'heartbeat', 'contract_event'];
const HEARTBEAT_STALE_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const ACCEPTANCE_INTERRUPTION_MS = 15_000;
const SILENT_DRILL_FAILSAFE_MS = 75_000;
const scope = self as unknown as { onconnect: (event: MessageEvent) => void; location: Location };

function emit(channel: Channel, type: string, data = '') {
    if (channel.silentDrillTimer) {
        channel.silentDrillSuppressedEvents++;
        return;
    }
    channel.lastEventAt = Date.now();
    channel.eventCounts[type] = (channel.eventCounts[type] ?? 0) + 1;
    const watch = channel.watch;
    if (type === 'tick_stk' && watch) {
        if (watch.until <= Date.now()) channel.watch = null;
        else {
            try {
                const tick = JSON.parse(data) as Record<string, unknown>;
                if (tick.code === watch.code) {
                    watch.ticks.push({
                        receivedAt: Date.now(), code: watch.code,
                        date: String(tick.date ?? ''), time: String(tick.time ?? ''),
                        close: String(tick.close ?? ''), volume: Number(tick.volume ?? 0),
                        tickType: Number.isFinite(Number(tick.tick_type)) ? Number(tick.tick_type) : null,
                    });
                    if (watch.ticks.length > 32) watch.ticks.shift();
                }
            } catch { /* Diagnostics never affect quote forwarding. */ }
        }
    }
    for (const recipient of channel.ports) recipient.postMessage({ type, data });
}

function bindSource(channel: Channel, source: EventSource) {
    source.onopen = () => {
        if (channel.source !== source) return;
        channel.openedAt = Date.now();
        emit(channel, 'open');
    };
    source.onerror = () => {
        if (channel.source !== source) return;
        // A genuine transport error is not the silent-OPEN scenario. End the
        // drill immediately so the normal error/recovery path remains visible.
        if (channel.silentDrillTimer) {
            clearTimeout(channel.silentDrillTimer);
            channel.silentDrillTimer = null;
            channel.silentDrillStartedAt = null;
        }
        channel.erroredAt = Date.now();
        emit(channel, 'error');
    };
    for (const type of events) source.addEventListener(type, event => {
        if (channel.source === source) emit(channel, type, (event as MessageEvent).data);
    });
}

function restartStaleSource(channel: Channel) {
    const idleSince = channel.silentDrillStartedAt ?? channel.lastEventAt;
    if (!channel.ports.size || channel.acceptanceTimer || Date.now() - idleSince < HEARTBEAT_STALE_MS) return;
    if (channel.silentDrillTimer) {
        clearTimeout(channel.silentDrillTimer);
        channel.silentDrillTimer = null;
        channel.silentDrillStartedAt = null;
    }
    channel.source.close();
    lifecycle.closed++;
    channel.erroredAt = Date.now();
    channel.watchdogRestarts++;
    // Keep all existing ports and replace the single underlying transport in sequence.
    for (const recipient of channel.ports) recipient.postMessage({ type: 'reconnecting', reason: 'heartbeat_stale' });
    const source = new EventSource(channel.url);
    channel.source = source;
    channel.createdAt = Date.now();
    channel.openedAt = null;
    channel.lastEventAt = Date.now();
    lifecycle.created++;
    bindSource(channel, source);
}

function silenceForWatchdogAcceptance(channel: Channel) {
    if (channel.path !== '/api/v1/stream/data' || channel.source.readyState !== EventSource.OPEN
        || !channel.ports.size || channel.acceptanceTimer || channel.silentDrillTimer
        || channel.silentDrillAttempts >= 1 || Date.now() - channel.lastEventAt > 10_000) return false;
    channel.silentDrillAttempts++;
    channel.silentDrillStartedAt = Date.now();
    channel.silentDrillSuppressedEvents = 0;
    // If the watchdog does not fire, restore forwarding without ever creating
    // another source. The drill never changes the API or broker session.
    channel.silentDrillTimer = setTimeout(() => {
        channel.silentDrillTimer = null;
        channel.silentDrillStartedAt = null;
    }, SILENT_DRILL_FAILSAFE_MS);
    return true;
}

function interruptForAcceptance(channel: Channel) {
    if (channel.path !== '/api/v1/stream/data' || channel.acceptanceTimer || channel.silentDrillTimer || !channel.ports.size) return false;
    if (channel.source.readyState !== EventSource.OPEN || channel.acceptanceInterrupts >= 3) return false;
    channel.source.close();
    lifecycle.closed++;
    channel.erroredAt = Date.now();
    channel.acceptanceInterrupts++;
    channel.lastEventAt = Date.now();
    for (const recipient of channel.ports) recipient.postMessage({ type: 'reconnecting', reason: 'acceptance_interrupt' });
    channel.acceptanceTimer = setTimeout(() => {
        channel.acceptanceTimer = null;
        if (!channel.ports.size) return;
        const source = new EventSource(channel.url);
        channel.source = source;
        channel.createdAt = Date.now();
        channel.openedAt = null;
        channel.lastEventAt = Date.now();
        lifecycle.created++;
        bindSource(channel, source);
    }, ACCEPTANCE_INTERRUPTION_MS);
    return true;
}

scope.onconnect = (event) => {
    const port = event.ports[0]!;
    let attached: string | null = null;
    const detach = () => {
        const channel = attached ? channels.get(attached) : undefined;
        if (channel) {
            channel.ports.delete(port);
            if (channel.watch?.owner === port) channel.watch = null;
            if (!channel.ports.size) {
                clearInterval(channel.watchdogTimer);
                if (channel.acceptanceTimer) clearTimeout(channel.acceptanceTimer);
                if (channel.silentDrillTimer) clearTimeout(channel.silentDrillTimer);
                channel.source.close();
                channels.delete(attached!);
                lifecycle.closed++;
            }
        }
        attached = null;
    };
    port.onmessage = ({ data }) => {
        if (data?.action === 'close') { detach(); port.close(); return; }
        if (data?.action === 'diagnostics' && attached) {
            port.postMessage({ type: 'diagnostics', requestId: data.requestId, snapshot: {
                capturedAt: Date.now(),
                transport: 'shared-worker',
                sourceCreated: lifecycle.created,
                sourceClosed: lifecycle.closed,
                channels: [...channels.values()].map(channel => ({
                    path: channel.path,
                    portCount: channel.ports.size,
                    readyState: channel.source.readyState,
                    createdAt: channel.createdAt,
                    openedAt: channel.openedAt,
                    erroredAt: channel.erroredAt,
                    lastEventAt: channel.lastEventAt,
                    watchdogRestarts: channel.watchdogRestarts,
                    acceptanceInterrupts: channel.acceptanceInterrupts,
                    acceptanceInterrupted: channel.acceptanceTimer !== null,
                    silentDrillStartedAt: channel.silentDrillStartedAt,
                    silentDrillAttempts: channel.silentDrillAttempts,
                    silentDrillSuppressedEvents: channel.silentDrillSuppressedEvents,
                    eventCounts: { ...channel.eventCounts },
                    watch: channel.watch && channel.watch.until > Date.now()
                        ? { code: channel.watch.code, until: channel.watch.until, ticks: [...channel.watch.ticks] }
                        : null,
                })),
            } });
            return;
        }
        if (data?.action === 'diagnostics-watch' && attached) {
            const channel = channels.get(attached);
            if (!channel || channel.path !== '/api/v1/stream/data') return;
            const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
            if (code && !/^[A-Z0-9]{1,10}$/.test(code)) return;
            channel.watch = code ? { code, owner: port, until: Date.now() + 5 * 60_000, ticks: [] } : null;
            port.postMessage({ type: 'diagnostics-watch-ack', requestId: data.requestId });
            return;
        }
        if (data?.action === 'acceptance-interrupt' && attached) {
            const localDevelopment = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(scope.location.hostname);
            const channel = channels.get(attached);
            const accepted = Boolean(localDevelopment && data.simulation === true && channel && interruptForAcceptance(channel));
            port.postMessage({ type: 'acceptance-interrupt-ack', requestId: data.requestId, accepted });
            return;
        }
        if (data?.action === 'acceptance-silence' && attached) {
            const localDevelopment = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(scope.location.hostname);
            const channel = channels.get(attached);
            const accepted = Boolean(localDevelopment && data.simulation === true && channel && silenceForWatchdogAcceptance(channel));
            port.postMessage({ type: 'acceptance-silence-ack', requestId: data.requestId, accepted });
            return;
        }
        if (data?.action !== 'open' || attached || typeof data.url !== 'string') return;
        const url = new URL(data.url, scope.location.href);
        // Sharing is confined to our existing same-origin quote/contract routes.
        if (url.origin !== scope.location.origin || !['/api/v1/stream/data', '/api/v1/stream/data/contract_event'].includes(url.pathname)) return;
        attached = url.href;
        let channel = channels.get(attached);
        if (!channel) {
            const source = new EventSource(attached);
            channel = { source, ports: new Set(), url: attached, path: url.pathname,
                createdAt: Date.now(), openedAt: null, erroredAt: null,
                lastEventAt: Date.now(), watchdogRestarts: 0,
                acceptanceTimer: null, acceptanceInterrupts: 0,
                silentDrillTimer: null, silentDrillStartedAt: null, silentDrillAttempts: 0, silentDrillSuppressedEvents: 0,
                watchdogTimer: null as unknown as ReturnType<typeof setInterval>,
                eventCounts: {}, watch: null };
            channels.set(attached, channel);
            lifecycle.created++;
            bindSource(channel, source);
            channel.watchdogTimer = setInterval(() => restartStaleSource(channel!), WATCHDOG_INTERVAL_MS);
            (channel.watchdogTimer as unknown as { unref?: () => void }).unref?.();
        }
        channel.ports.add(port);
        if (channel.source.readyState === EventSource.OPEN) port.postMessage({ type: 'open' });
    };
    port.start();
};
export {};
