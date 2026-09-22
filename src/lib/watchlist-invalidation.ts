export const WATCHLIST_INVALIDATION_CHANNEL = 'sj-watchlist-invalidation-v1';

export interface WatchlistInvalidation {
    version: 1;
    type: 'watchlist-invalidated';
    listName: string;
    emittedAt: number;
}

function isInvalidation(value: unknown): value is WatchlistInvalidation {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<WatchlistInvalidation>;
    return candidate.version === 1
        && candidate.type === 'watchlist-invalidated'
        && typeof candidate.listName === 'string'
        && candidate.listName.length > 0
        && typeof candidate.emittedAt === 'number'
        && Number.isFinite(candidate.emittedAt);
}

export function emitWatchlistInvalidation(listName: string) {
    const detail: WatchlistInvalidation = {
        version: 1,
        type: 'watchlist-invalidated',
        listName,
        emittedAt: Date.now(),
    };
    window.dispatchEvent(new CustomEvent(WATCHLIST_INVALIDATION_CHANNEL, { detail }));
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(WATCHLIST_INVALIDATION_CHANNEL);
    channel.postMessage(detail);
    channel.close();
}

export function onWatchlistInvalidation(
    listener: (event: WatchlistInvalidation) => void,
) {
    const localListener = (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (isInvalidation(detail)) listener(detail);
    };
    window.addEventListener(WATCHLIST_INVALIDATION_CHANNEL, localListener);

    const channel = typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(WATCHLIST_INVALIDATION_CHANNEL);
    const channelListener = (event: MessageEvent<unknown>) => {
        if (isInvalidation(event.data)) listener(event.data);
    };
    channel?.addEventListener('message', channelListener);

    return () => {
        window.removeEventListener(WATCHLIST_INVALIDATION_CHANNEL, localListener);
        channel?.removeEventListener('message', channelListener);
        channel?.close();
    };
}
