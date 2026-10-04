export const INTRADAY_MONITOR_INVALIDATION_CHANNEL =
    'sj-intraday-monitor-config-invalidation-v1';

export interface IntradayMonitorConfigInvalidation {
    version: 1;
    type: 'intraday-monitor-config-invalidated';
    revision: number;
    sourceClientId: string;
    emittedAt: number;
}

function isInvalidation(value: unknown): value is IntradayMonitorConfigInvalidation {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<IntradayMonitorConfigInvalidation>;
    return candidate.version === 1
        && candidate.type === 'intraday-monitor-config-invalidated'
        && Number.isSafeInteger(candidate.revision)
        && Number(candidate.revision) >= 0
        && typeof candidate.sourceClientId === 'string'
        && /^[A-Za-z0-9_-]{16,128}$/.test(candidate.sourceClientId)
        && typeof candidate.emittedAt === 'number'
        && Number.isFinite(candidate.emittedAt);
}

export function emitIntradayMonitorConfigInvalidation(
    revision: number,
    sourceClientId: string,
) {
    const detail: IntradayMonitorConfigInvalidation = {
        version: 1,
        type: 'intraday-monitor-config-invalidated',
        revision,
        sourceClientId,
        emittedAt: Date.now(),
    };
    window.dispatchEvent(new CustomEvent(INTRADAY_MONITOR_INVALIDATION_CHANNEL, { detail }));
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(INTRADAY_MONITOR_INVALIDATION_CHANNEL);
    channel.postMessage(detail);
    channel.close();
}

export function onIntradayMonitorConfigInvalidation(
    listener: (event: IntradayMonitorConfigInvalidation) => void,
) {
    const localListener = (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (isInvalidation(detail)) listener(detail);
    };
    window.addEventListener(INTRADAY_MONITOR_INVALIDATION_CHANNEL, localListener);
    const channel = typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(INTRADAY_MONITOR_INVALIDATION_CHANNEL);
    const channelListener = (event: MessageEvent<unknown>) => {
        if (isInvalidation(event.data)) listener(event.data);
    };
    channel?.addEventListener('message', channelListener);
    return () => {
        window.removeEventListener(INTRADAY_MONITOR_INVALIDATION_CHANNEL, localListener);
        channel?.removeEventListener('message', channelListener);
        channel?.close();
    };
}
