import { apiPostBounded, BoundedApiError } from './api';
import type { ContractBase } from './types/contract';
import type { Snapshot } from './types/market';
import type { HistoryTicks } from './types/tick';
import type { TickTapeEventInput } from './tick-tape-large-trade';
import { TAPE_INPUT_LIMIT, tapeKey } from './tick-tape-session';
import { verifyTickTapeSource, type TapeSourceEvidence } from './tick-tape-source-verification';

export const TAPE_SOURCE_LIMITATION = '部分資料：來源完整性尚未核實';
export interface TapeCache {
    key: string;
    revision: string;
    updatedAt: number;
    fetchedAt: number;
    count: number;
    chunks: number;
    coverage: string;
    format: 2;
    range: { first: string | null; last: string | null };
    verifiedThrough: string | null;
    gaps: string[];
    evidence: TapeSourceEvidence;
}
export interface SessionHistoryResult {
    fromCache?: boolean;
    inputs: TickTapeEventInput[];
    fetchedAt: number;
    metadata: TapeCache;
}
const CHUNK_SIZE = 2000;
const HISTORY_BUDGET_AUDIT_LIMIT = 100;
const DB_NAME = 'rts.tick-tape.v1';
function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('metadata', { keyPath: 'key' }); req.result.createObjectStore('chunks'); req.result.createObjectStore('budget'); };
        req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('成交快取正在其他視窗升級，請稍後重試'));
    });
}
function request<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function completed(tx: IDBTransaction) {
    return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('成交快取寫入失敗')); });
}
export async function readTapeCache(key: string): Promise<{ metadata: TapeCache; inputs: TickTapeEventInput[] } | null> {
    const db = await openDb();
    try {
        const tx = db.transaction(['metadata', 'chunks'], 'readonly');
        const done = completed(tx);
        const metadata = await request<TapeCache | undefined>(tx.objectStore('metadata').get(key));
        if (!metadata || metadata.format !== 2 || !metadata.evidence) { await done; return null; }
        const chunks = await Promise.all(Array.from({ length: metadata.chunks }, (_, index) => request<TickTapeEventInput[] | undefined>(tx.objectStore('chunks').get(`${key}|${index}`))));
        await done;
        if (chunks.some(chunk => !chunk)) throw new Error('成交快取分塊缺漏');
        const inputs = chunks.flat() as TickTapeEventInput[];
        if (inputs.length !== metadata.count) throw new Error('成交快取筆數不一致');
        return { metadata, inputs };
    } finally { db.close(); }
}
export async function writeTapeCache(key: string, inputs: TickTapeEventInput[], fetchedAt: number, evidence?: TapeSourceEvidence) {
    if (inputs.length > TAPE_INPUT_LIMIT) throw new Error('成交快取超過 500,000 筆預算');
    const estimate = await navigator.storage?.estimate();
    if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < 128 * 1024 * 1024) throw new Error('成交快取空間不足，未覆蓋既有資料');
    const fallbackEvidence: TapeSourceEvidence = evidence ?? {
        state: 'partial', coverage: TAPE_SOURCE_LIMITATION, verifiedThrough: null,
        gaps: ['source_evidence_unavailable'], allDayCount: inputs.length, rangeCount: 0,
        regularCount: inputs.length, postSessionCount: 0,
        regularVolume: inputs.reduce((sum, input) => sum + input.volume, 0), postSessionVolume: 0,
        snapshotTotalVolume: null,
    };
    const db = await openDb();
    try {
        const tx = db.transaction(['metadata', 'chunks'], 'readwrite');
        const done = completed(tx);
        const chunks = Math.ceil(inputs.length / CHUNK_SIZE);
        const metadata: TapeCache = {
            key, revision: crypto.randomUUID(), updatedAt: Date.now(), fetchedAt, count: inputs.length, chunks,
            coverage: fallbackEvidence.coverage, format: 2,
            range: { first: inputs[0] ? `${inputs[0].date}T${inputs[0].time}` : null, last: inputs.at(-1) ? `${inputs.at(-1)!.date}T${inputs.at(-1)!.time}` : null },
            verifiedThrough: fallbackEvidence.verifiedThrough, gaps: fallbackEvidence.gaps, evidence: fallbackEvidence,
        };
        try {
            const range = IDBKeyRange.bound(`${key}|`, `${key}|\uffff`);
            tx.objectStore('chunks').delete(range);
            for (let index = 0; index < chunks; index++) tx.objectStore('chunks').put(inputs.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), `${key}|${index}`);
            tx.objectStore('metadata').put(metadata);
            const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
            const cursor = tx.objectStore('metadata').openCursor();
            cursor.onsuccess = () => {
                const entry = cursor.result;
                if (!entry) return;
                const oldKey = String(entry.primaryKey);
                const day = oldKey.split('|').at(-1) ?? '';
                if (oldKey !== key && /^\d{4}-\d{2}-\d{2}$/u.test(day) && day < cutoff) {
                    entry.delete();
                    tx.objectStore('chunks').delete(IDBKeyRange.bound(`${oldKey}|`, `${oldKey}|\uffff`));
                }
                entry.continue();
            };
            await done;
        } catch (error) {
            try { tx.abort(); } catch { /* Already aborted by IndexedDB. */ }
            await done.catch(() => undefined);
            throw error;
        }
        return metadata;
    } finally { db.close(); }
}
type HistoryRequestReason = 'initial' | 'live_gap' | 'reconnect_gap';
interface HistoryBudgetEvent {
    at: number;
    queryType: 'AllDay' | 'RangeTime';
    reason: HistoryRequestReason;
}
interface HistoryBudget {
    count: number;
    last: number;
    events?: HistoryBudgetEvent[];
}
interface HistoryFailureCooldown {
    failures: number;
    until: number;
    updatedAt: number;
    reason: string;
}
const cooldownKey = (key: string) => `cooldown:${key}`;
async function readFailureCooldown(key: string): Promise<HistoryFailureCooldown | null> {
    const db = await openDb();
    try {
        const tx = db.transaction('budget', 'readonly');
        const done = completed(tx);
        const value = await request<HistoryFailureCooldown | undefined>(tx.objectStore('budget').get(cooldownKey(key)));
        await done;
        return value ?? null;
    } finally { db.close(); }
}
async function writeFailureCooldown(key: string, error: unknown) {
    const prior = await readFailureCooldown(key);
    const failures = Math.min(10, (prior?.failures ?? 0) + 1);
    const retryAfter = error instanceof BoundedApiError ? error.retryAfterMs : null;
    const delay = Math.max(retryAfter ?? 0, Math.min(15 * 60_000, 30_000 * (2 ** (failures - 1))));
    const db = await openDb();
    try {
        const tx = db.transaction('budget', 'readwrite');
        const done = completed(tx);
        tx.objectStore('budget').put({
            failures,
            until: Date.now() + delay,
            updatedAt: Date.now(),
            reason: error instanceof BoundedApiError ? `http_${error.status}` : 'request_failed',
        } satisfies HistoryFailureCooldown, cooldownKey(key));
        await done;
    } finally { db.close(); }
}
async function clearFailureCooldown(key: string) {
    const db = await openDb();
    try {
        const tx = db.transaction('budget', 'readwrite');
        const done = completed(tx);
        tx.objectStore('budget').delete(cooldownKey(key));
        await done;
    } finally { db.close(); }
}
async function chargeHistoryBudget(queryType: 'AllDay' | 'RangeTime', reason: HistoryRequestReason, deadline = Date.now() + 10_000): Promise<void> {
    if (Date.now() >= deadline) throw new Error('歷史查詢排隊逾時，保留現有資料');
    const db = await openDb();
    try {
        const tx = db.transaction('budget', 'readwrite');
        const done = completed(tx);
        const store = tx.objectStore('budget');
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
        const budget = (await request<HistoryBudget | undefined>(store.get(date))) ?? { count: 0, last: 0 };
        const delay = 1500 - (Date.now() - budget.last);
        if (delay > 0) {
            await done;
            await new Promise<void>(resolve => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now()))));
            return chargeHistoryBudget(queryType, reason, deadline);
        }
        const at = Date.now();
        store.put({
            count: budget.count + 1,
            last: at,
            events: [...(budget.events ?? []), { at, queryType, reason }].slice(-HISTORY_BUDGET_AUDIT_LIMIT),
        } satisfies HistoryBudget, date);
        await done;
    } finally { db.close(); }
}
const contractPayload = (contract: ContractBase) => ({
    security_type: contract.security_type, exchange: contract.exchange, code: contract.code,
    region: contract.region ?? 'TW', target_code: contract.target_code || null,
});
async function fetchHistory(contract: ContractBase, date: string, queryType: 'AllDay' | 'RangeTime', reason: HistoryRequestReason) {
    await chargeHistoryBudget(queryType, reason);
    return apiPostBounded<HistoryTicks>('/api/v1/data/ticks', {
        contract: contractPayload(contract), date, query_type: queryType,
        ...(queryType === 'RangeTime' ? { time_start: '09:00:00', time_end: '13:59:59' } : {}),
    }, 48 * 1024 * 1024, 15_000);
}
const pending = new Map<string, Promise<SessionHistoryResult>>();
export function fetchSessionHistory(contract: ContractBase, date: string, force = false, reason: HistoryRequestReason = 'initial'): Promise<SessionHistoryResult> {
    const key = `${tapeKey(contract)}|${date}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const startedAt = Date.now();
    const run = async () => {
        const cached = await readTapeCache(key);
        if (cached && ((!force && Date.now() - cached.metadata.fetchedAt < 60_000) || cached.metadata.fetchedAt >= startedAt)) {
            return { inputs: cached.inputs, fetchedAt: cached.metadata.fetchedAt, metadata: cached.metadata, fromCache: true };
        }
        const cooldown = await readFailureCooldown(key);
        if (cooldown && cooldown.until > Date.now()) {
            throw new Error(`歷史成交來源冷卻中，${new Date(cooldown.until).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })} 後再試`);
        }
        try {
            const allDay = await fetchHistory(contract, date, 'AllDay', reason);
            const range = await fetchHistory(contract, date, 'RangeTime', reason);
            const checkSnapshot = async () => {
                const snapshots = await apiPostBounded<Snapshot[]>('/api/v1/data/snapshots', {
                    contracts: [contractPayload(contract)],
                }, 512 * 1024, 10_000);
                const snapshot = snapshots.find(item => item.code === contract.code);
                return verifyTickTapeSource({ contract, date, allDay, range,
                    snapshotTotalVolume: Number.isFinite(snapshot?.total_volume) ? snapshot!.total_volume : null, generation: 1 });
            };
            let verified = await checkSnapshot();
            const snapshotChecks = [verified.evidence.snapshotTotalVolume];
            if (verified.evidence.gaps.length === 1 && verified.evidence.gaps[0] === 'history_exceeds_snapshot') {
                // Snapshot can briefly lag a later RangeTime response. Recheck
                // this small payload once, never repeat the two history queries.
                await new Promise<void>(resolve => setTimeout(resolve, 1500));
                verified = await checkSnapshot();
                snapshotChecks.push(verified.evidence.snapshotTotalVolume);
            }
            verified.evidence.snapshotChecks = snapshotChecks;
            const fetchedAt = Date.now();
            const metadata = await writeTapeCache(key, verified.inputs, fetchedAt, verified.evidence);
            await clearFailureCooldown(key);
            return { inputs: verified.inputs, fetchedAt, metadata };
        } catch (error) {
            await writeFailureCooldown(key, error).catch(() => undefined);
            throw error;
        }
    };
    const promise = (navigator.locks
        ? navigator.locks.request(`rts.tape.history.${key}`, { signal: AbortSignal.timeout(45_000) }, run)
        : Promise.reject(new Error('此瀏覽器不支援跨視窗查詢協調')))
        .then(result => result)
        .finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
}
