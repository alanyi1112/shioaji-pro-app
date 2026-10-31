import type { Candle } from './types/market';
import type { ContractInfo } from './types/contract';
import type { DailyLevelSnapshot } from './daily-indicator-levels';
import { aggregate, kbarsToCandles, kbarsToTaiwanStockCandles } from './utils/kbars';
import { taipeiWallClockNowSeconds, wallClockDateKey } from './kbar-readout';
import { requireCandleTimeline } from './candle-series-integrity';
import { fetchKbars } from './shioaji';

export function dailyProductKey(c: Pick<ContractInfo, 'security_type' | 'region' | 'exchange' | 'code' | 'target_code'>) {
    return [c.security_type, c.region ?? '', c.exchange ?? '', c.code, c.target_code ?? '', 'shioaji-canonical-unadjusted-v1'].join('|');
}
export function emptyDailySnapshot(key: string): DailyLevelSnapshot {
    return { key, bars: [], phase: 'unknown', state: 'idle', asOf: null, receivedAt: null, generation: 0 };
}
type Entry = {
    snapshot: DailyLevelSnapshot;
    consumers: Map<symbol, { need: number; notify: (s: DailyLevelSnapshot) => void }>;
    observers: Map<symbol, (s: DailyLevelSnapshot) => void>;
    controller?: AbortController;
    pending?: Promise<void>;
    external: Set<Promise<unknown>>;
    oldest?: string;
    today?: string;
    rawTail: number | null;
    historyReceived: number | null;
    lastSequence?: number;
    requests: number;
    canonicalBytes: number;
    loadDurationMs: number;
};
type Loader = (c: ContractInfo, start: string, end: string, signal: AbortSignal) => Promise<Candle[]>;
const stock = (c: ContractInfo) => ['STK', 'IND', 'WRT'].includes(c.security_type ?? '') &&
    (c.region === 'TW' || ['TSE', 'OTC', 'OES'].includes(c.exchange ?? ''));
const offset = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export class DailyIndicatorAuthority {
    private entries = new Map<string, Entry>();
    constructor(private readonly load: Loader, private readonly now = taipeiWallClockNowSeconds, private readonly timeoutMs = 20_000) {}
    resetForTests() { for (const e of this.entries.values()) e.controller?.abort(); this.entries.clear(); }
    private entry(c: ContractInfo) {
        const key = dailyProductKey(c);
        let e = this.entries.get(key);
        if (!e) {
            // Active consumers are never evicted. Inactive entries have bounded retained history.
            for (const [k, v] of this.entries) if (this.entries.size >= 12 && !v.consumers.size && !v.observers.size && !v.pending) this.entries.delete(k);
            e = { snapshot: emptyDailySnapshot(key), consumers: new Map(), observers: new Map(), external: new Set(), rawTail: null, historyReceived: null, requests: 0, canonicalBytes: 0, loadDurationMs: 0 };
            this.entries.set(key, e);
        }
        return e;
    }
    snapshot(c: ContractInfo) { return this.entry(c).snapshot; }
    diagnostics(c: ContractInfo) {
        const e = this.entry(c);
        return { historyRequests: e.requests, canonicalPayloadBytes: e.canonicalBytes, loadDurationMs: e.loadDurationMs,
            retainedDailyBars: e.snapshot.bars.length, cacheEntries: this.entries.size, consumers: e.consumers.size };
    }
    private bounded<T>(work: Promise<T>, signal: AbortSignal, onTimeout?: () => void): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(Error('daily_history_cancelled')); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); onTimeout?.(); reject(Error('daily_history_request_timeout')); }, this.timeoutMs);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) { abort(); return; }
            work.then(resolve, reject).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', abort); });
        });
    }
    private phase(c: ContractInfo, e: Entry): DailyLevelSnapshot['phase'] {
        const tail = e.snapshot.bars.at(-1);
        if (!tail || !stock(c)) return 'unknown';
        const date = wallClockDateKey(tail.time), today = wallClockDateKey(this.now());
        if (date < today) return e.historyReceived !== null && e.historyReceived >= tail.time + 13 * 3600 + 35 * 60 ? 'closed' : 'unknown';
        if (date !== today) return 'unknown';
        if (this.now() < tail.time + 13 * 3600 + 35 * 60) return 'forming';
        return e.rawTail !== null && e.rawTail >= tail.time + 13 * 3600 + 30 * 60 &&
            e.historyReceived !== null && e.historyReceived >= tail.time + 13 * 3600 + 35 * 60 ? 'closed' : 'unknown';
    }
    private emit(c: ContractInfo, e: Entry, patch: Partial<DailyLevelSnapshot>) {
        e.snapshot = { ...e.snapshot, ...patch, generation: e.snapshot.generation + 1 };
        e.snapshot = { ...e.snapshot, phase: this.phase(c, e) };
        for (const x of e.consumers.values()) x.notify(e.snapshot);
        for (const notify of e.observers.values()) notify(e.snapshot);
    }
    /** Passive reuse: no demand, ensure, fetch, cancellation or source mutation. */
    observe(c: ContractInfo, notify: (s: DailyLevelSnapshot) => void) {
        const e = this.entry(c), token = Symbol();
        e.observers.set(token, notify); notify(e.snapshot);
        return () => { e.observers.delete(token); };
    }
    /** Seed from successful existing chart history, not from the visual stale-while-revalidate cache. */
    publish(c: ContractInfo, raw: readonly Candle[], endDate?: string, startDate?: string): boolean {
        if (!raw.length) return true;
        const e = this.entry(c);
        try {
            requireCandleTimeline([...raw]);
            if (raw.at(-1)!.time > this.now() + 60) throw Error('future_source');
        } catch {
            this.emit(c, e, { state: e.snapshot.bars.length ? 'stale' : 'unavailable', reason: 'daily_invalid_source' });
            return false;
        }
        const incoming = aggregate([...raw], 1440);
        const byTime = new Map(e.snapshot.bars.map(b => [b.time, b]));
        for (const b of incoming) {
            const old = byTime.get(b.time);
            if (old && e.snapshot.asOf !== null && raw.at(-1)!.time < e.snapshot.asOf && b.time === incoming.at(-1)!.time) continue;
            byTime.set(b.time, { ...b });
        }
        const advances = raw.at(-1)!.time >= (e.rawTail ?? -Infinity);
        e.rawTail = Math.max(e.rawTail ?? -Infinity, raw.at(-1)!.time);
        if (advances) e.historyReceived = this.now();
        if (endDate) e.today = endDate;
        if (startDate && (!e.oldest || startDate < e.oldest)) e.oldest = startDate;
        this.emit(c, e, { bars: [...byTime.values()].sort((a, b) => a.time - b.time).slice(-201),
            asOf: Math.max(e.snapshot.asOf ?? -Infinity, raw.at(-1)!.time), receivedAt: advances ? this.now() : e.snapshot.receivedAt, state: e.pending ? 'loading' : 'ready', reason: undefined, knownGap: false });
        return true;
    }
    track(c: ContractInfo, work: Promise<unknown>, signal?: AbortSignal) {
        const e = this.entry(c), generation = e.snapshot.generation; e.external.add(work);
        void work.catch(() => {
            // A chart switch cancels its own read; it is not a failed observation of
            // the already accepted daily history. Genuine refresh failures still stale it.
            if (signal?.aborted) return;
            if (e.snapshot.generation === generation && e.snapshot.bars.length)
                this.emit(c, e, { state: 'stale', reason: 'daily_history_refresh_failed' });
        });
        void work.finally(() => { e.external.delete(work); }).catch(() => {});
    }
    /** Called only after the chart's existing trade/volume cursor accepted the event. */
    trade(c: ContractInfo, time: number, price: number, sequence = 0, volumeDelta = 0) {
        const e = this.entry(c);
        if (!e.snapshot.bars.length || !Number.isFinite(time) || !Number.isFinite(price) || price <= 0 ||
            (e.snapshot.asOf !== null && time < e.snapshot.asOf) ||
            (time === e.snapshot.asOf && sequence <= (e.lastSequence ?? -1))) return;
        const day = Math.floor(time / 86400) * 86400, tail = e.snapshot.bars.at(-1)!;
        if (day < tail.time) return;
        e.lastSequence = sequence;
        const bars = e.snapshot.bars.map(b => ({ ...b }));
        if (day === tail.time) Object.assign(bars[bars.length - 1]!, { close: price, high: Math.max(tail.high, price), low: Math.min(tail.low, price), volume: tail.volume + Math.max(0, volumeDelta) });
        else bars.push({ time: day, open: price, high: price, low: price, close: price, volume: Math.max(0, volumeDelta), turnoverTwd: null });
        // This is a genuine accepted trade, not a synthetic day. Volume isn't used by these formulas.
        const changedDay = day > tail.time;
        this.emit(c, e, { bars: bars.slice(-201), asOf: time, receivedAt: this.now(),
            ...(changedDay ? { state: 'loading' as const, reason: 'new_day_history_pending' } : {}) });
        if (changedDay && e.consumers.size) queueMicrotask(() => this.ensure(c, e));
    }
    subscribe(c: ContractInfo, need: number, notify: (s: DailyLevelSnapshot) => void) {
        const e = this.entry(c), token = Symbol();
        e.consumers.set(token, { need, notify }); notify(e.snapshot);
        queueMicrotask(() => { if (e.consumers.size) this.ensure(c, e); });
        return () => {
            e.consumers.delete(token);
            queueMicrotask(() => { if (!e.consumers.size) e.controller?.abort(); });
        };
    }
    private ensure(c: ContractInfo, e: Entry) {
        if (e.pending) return;
        const need = () => Math.max(0, ...[...e.consumers.values()].map(x => x.need));
        if (!need()) return;
        const today = wallClockDateKey(this.now());
        if (e.snapshot.bars.length >= need() && e.today === today && e.snapshot.state !== 'stale') return;
        if (e.snapshot.state === 'stale' || e.snapshot.state === 'unavailable') return; // no retries on timeframe toggles
        const controller = new AbortController(); e.controller = controller;
        const started = performance.now();
        this.emit(c, e, { state: 'loading' });
        e.pending = (async () => {
            try {
                while (e.external.size) {
                    await this.bounded(Promise.allSettled([...e.external]), controller.signal);
                    if (controller.signal.aborted) return;
                }
                if (controller.signal.aborted) return;
                if (e.snapshot.bars.length >= need() && e.today === today) { this.emit(c, e, { state: 'ready' }); return; }
                let end = e.today === today && e.oldest ? offset(e.oldest, -1) : today;
                const limit = offset(today, -364);
                for (let chunks = 0; chunks < 13 && end >= limit && need(); chunks++) {
                    if (controller.signal.aborted) return;
                    const start = offset(end, -29) < limit ? limit : offset(end, -29);
                    const chunk = new AbortController(), abortChunk = () => chunk.abort();
                    controller.signal.addEventListener('abort', abortChunk, { once: true });
                    let raw: Candle[];
                    try {
                        e.requests++;
                        raw = await this.bounded(this.load(c, start, end, chunk.signal), controller.signal, abortChunk);
                        e.canonicalBytes += new TextEncoder().encode(JSON.stringify(raw)).byteLength;
                    } finally { controller.signal.removeEventListener('abort', abortChunk); }
                    if (controller.signal.aborted) return;
                    if (raw.length && !this.publish(c, raw, today, start)) throw Error('daily_invalid_source');
                    e.oldest = start; e.today = today;
                    if (e.snapshot.bars.length >= need()) break;
                    end = offset(start, -1);
                }
                this.emit(c, e, { state: e.snapshot.bars.length ? 'ready' : 'unavailable', reason: e.snapshot.bars.length ? undefined : 'daily_history_unavailable' });
            } catch {
                if (!controller.signal.aborted) this.emit(c, e, { state: e.snapshot.bars.length ? 'stale' : 'unavailable', reason: 'daily_history_refresh_failed' });
            } finally {
                e.loadDurationMs = Math.round(performance.now() - started);
                e.pending = undefined;
                if (controller.signal.aborted && e.snapshot.state === 'loading') this.emit(c, e, { state: e.snapshot.bars.length ? 'ready' : 'idle' });
                if (controller.signal.aborted && e.consumers.size) queueMicrotask(() => this.ensure(c, e));
            }
        })();
    }
}

export const dailyIndicatorAuthority = new DailyIndicatorAuthority(async (c, start, end, signal) => {
    const k = await fetchKbars(c, start, end, signal);
    return c.security_type === 'STK' && (c.region === 'TW' || ['TSE', 'OTC', 'OES'].includes(c.exchange ?? ''))
        ? kbarsToTaiwanStockCandles(k) : kbarsToCandles(k);
});
