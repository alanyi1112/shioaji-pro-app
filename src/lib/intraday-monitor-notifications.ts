import type { IntradayMonitorTriggerView } from './intraday-monitor-api';

const ACK_VERSION = 1;
const ACK_PREFIX = 'sj-intraday-monitor-notification-ack-v1';
const MAX_ACKNOWLEDGEMENTS = 2_048;
const MAX_TRADE_DATES = 2;

interface AcknowledgementBucket {
    tradeDate: string;
    eventIds: string[];
}

interface AcknowledgementRecord {
    version: typeof ACK_VERSION;
    buckets: AcknowledgementBucket[];
    updatedAt: string;
}

type ExclusiveRunner = (name: string, task: () => boolean) => Promise<boolean>;

export interface IntradayNotificationAcknowledgementsOptions {
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
    runExclusive?: ExclusiveRunner;
    now?: () => Date;
}

function defaultExclusiveRunner(name: string, task: () => boolean) {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks) return Promise.resolve(task());
    return locks.request(name, { mode: 'exclusive' }, task);
}

function validRecord(value: unknown): value is AcknowledgementRecord {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<AcknowledgementRecord>;
    return record.version === ACK_VERSION
        && Array.isArray(record.buckets)
        && record.buckets.length <= MAX_TRADE_DATES
        && record.buckets.every((bucket) => bucket
            && typeof bucket.tradeDate === 'string'
            && /^\d{4}-\d{2}-\d{2}$/.test(bucket.tradeDate)
            && Array.isArray(bucket.eventIds)
            && bucket.eventIds.length <= MAX_ACKNOWLEDGEMENTS
            && bucket.eventIds.every((eventId) => typeof eventId === 'string' && eventId.length > 0 && eventId.length <= 256))
        && typeof record.updatedAt === 'string';
}

function defaultStorage() {
    try {
        return typeof localStorage === 'undefined' ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

/**
 * Claims a server-issued trigger event ID before any user-visible notification.
 * Storage or schema uncertainty fails closed, because a notification without a
 * durable acknowledgement could be duplicated by another workspace tab.
 */
export function createIntradayNotificationAcknowledgements(
    tradeDate: string,
    options: IntradayNotificationAcknowledgementsOptions = {},
) {
    const storage = options.storage ?? defaultStorage();
    const runExclusive = options.runExclusive ?? defaultExclusiveRunner;
    const now = options.now ?? (() => new Date());
    const key = ACK_PREFIX;
    const lockName = `${key}:lock`;

    return {
        key,
        async claim(eventId: string) {
            if (!storage || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || eventId.length < 1 || eventId.length > 256) {
                return false;
            }
            try {
                return await runExclusive(lockName, () => {
                    const raw = storage.getItem(key);
                    let buckets: AcknowledgementBucket[] = [];
                    if (raw !== null) {
                        const parsed: unknown = JSON.parse(raw);
                        if (!validRecord(parsed)) return false;
                        buckets = parsed.buckets;
                    }
                    const eventIds = buckets.find((bucket) => bucket.tradeDate === tradeDate)?.eventIds ?? [];
                    if (eventIds.includes(eventId)) return false;
                    const nextIds = [...eventIds, eventId].slice(-MAX_ACKNOWLEDGEMENTS);
                    const next: AcknowledgementRecord = {
                        version: ACK_VERSION,
                        buckets: [
                            ...buckets.filter((bucket) => bucket.tradeDate !== tradeDate),
                            { tradeDate, eventIds: nextIds },
                        ].slice(-MAX_TRADE_DATES),
                        updatedAt: now().toISOString(),
                    };
                    storage.setItem(key, JSON.stringify(next));
                    const confirmed: unknown = JSON.parse(storage.getItem(key) ?? 'null');
                    return validRecord(confirmed)
                        && Boolean(confirmed.buckets.find((bucket) => bucket.tradeDate === tradeDate)?.eventIds.includes(eventId));
                });
            } catch {
                return false;
            }
        },
    };
}

export function hasValidIntradayNotificationLease(
    lease: { expiresAt: string } | null,
    now = Date.now(),
) {
    return Boolean(lease && Number.isFinite(Date.parse(lease.expiresAt)) && Date.parse(lease.expiresAt) > now);
}

export function isNewLiveNotificationEvent(event: IntradayMonitorTriggerView) {
    return event.kind === 'live' && event.notificationAuthority === true;
}

export function intradayNotificationText(event: IntradayMonitorTriggerView, name?: string) {
    const code = event.canonicalSymbol.split('.')[0] ?? event.canonicalSymbol;
    const ratio = event.previousCumulativeVolume > 0
        ? (event.currentCumulativeVolume / event.previousCumulativeVolume).toFixed(2)
        : '—';
    return {
        title: `${code}${name ? ` ${name}` : ''} 盤中量比達標`,
        body: `${event.minuteKey} 累積量比 ${ratio}×，門檻 ${event.threshold}×`,
    };
}

export async function playIntradayNotificationSound() {
    const AudioContextConstructor = typeof window === 'undefined'
        ? undefined
        : window.AudioContext;
    if (!AudioContextConstructor) return false;
    try {
        const context = new AudioContextConstructor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, context.currentTime);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.17);
        oscillator.addEventListener('ended', () => void context.close(), { once: true });
        return true;
    } catch {
        return false;
    }
}
