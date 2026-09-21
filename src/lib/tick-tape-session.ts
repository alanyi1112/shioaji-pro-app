import type { ContractBase } from './types/contract';
import { largeTradeEligibility, normalizeTickTapeEvent, type TickTapeEventInput, type TickTapeRow } from './tick-tape-large-trade';

export const TAPE_INPUT_LIMIT = 500_000;
export interface LargeTradeSettings {
    amount: number;
    lots: number;
    sampleSize: number;
    percentile: number;
    warmup: number;
    operator: 'AND' | 'OR';
}
export const DEFAULT_LARGE_TRADE_SETTINGS: Readonly<LargeTradeSettings> = Object.freeze({
    amount: 1_000_000, lots: 10, sampleSize: 120, percentile: 80, warmup: 30, operator: 'AND',
});
export function validateLargeTradeSettings(s: LargeTradeSettings): string | null {
    if (!Number.isFinite(s.amount) || s.amount <= 0 || s.amount > 1e12) return '單筆成交金額須大於 0 且不超過 1 兆元';
    if (!Number.isFinite(s.lots) || s.lots <= 0 || s.lots > 1e7) return '單筆成交張數須大於 0 且不超過 1,000 萬張';
    if (!Number.isInteger(s.sampleSize) || s.sampleSize < 1 || s.sampleSize > 2000) return '取樣筆數須為 1–2,000 的整數';
    if (!Number.isInteger(s.warmup) || s.warmup < 1 || s.warmup > s.sampleSize) return '暖機筆數須為正整數，且不得大於取樣筆數';
    if (!Number.isFinite(s.percentile) || s.percentile < 1 || s.percentile > 100) return '百分位數須介於 1–100';
    if (s.operator !== 'AND' && s.operator !== 'OR') return '條件組合須為且或或';
    return null;
}
const SETTINGS_KEY = 'rts.tick-tape.settings.v1';
export function readLargeTradeSettings(): LargeTradeSettings {
    try {
        const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
        if (parsed && !validateLargeTradeSettings(parsed)) return parsed;
    } catch { /* Invalid old preferences never replace defaults. */ }
    return { ...DEFAULT_LARGE_TRADE_SETTINGS };
}
export function saveLargeTradeSettings(s: LargeTradeSettings) {
    const error = validateLargeTradeSettings(s);
    if (error) throw new Error(error);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    window.dispatchEvent(new Event(SETTINGS_KEY));
}
export function onLargeTradeSettings(listener: () => void) {
    const storage = (event: StorageEvent) => { if (event.key === SETTINGS_KEY || event.key === null) listener(); };
    window.addEventListener('storage', storage);
    window.addEventListener(SETTINGS_KEY, listener);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener(SETTINGS_KEY, listener); };
}

// Decimal input is reduced to cents before multiplication. Taiwan stock prices
// have no sub-cent tick; cent arithmetic keeps exact equal-threshold decisions.
export function tradeAmountTwd(price: number, lots: number) {
    return Math.round(price * 100) * lots * 10;
}
export interface SessionTapeRow extends TickTapeRow {
    dynamicThreshold: number | null;
    conditions: { amount: boolean; lots: boolean; dynamic: boolean | null };
    configRevision: string;
}
export interface SessionTapeResult {
    rows: SessionTapeRow[]; // chronological; UI indexes in reverse without copying
    largeIndices: number[];
    sampleCount: number;
    configRevision: string;
}
export function tapeKey(contract: ContractBase) {
    return `${contract.security_type}:${contract.exchange}:${contract.code}`;
}
export function allSessionEligible(input: TickTapeEventInput) {
    const e = normalizeTickTapeEvent(input);
    if (!e || !Number.isFinite(e.close) || e.close <= 0 || !Number.isFinite(e.volume) || e.volume <= 0 || e.simtrade || e.intradayOdd) return false;
    // Includes delayed closing auctions; the 14:00 fixed-price session is excluded.
    return input.contract.security_type !== 'STK' || (e.time >= '09:00:00.000000' && e.time < '14:00:00.000000');
}
export function orderTapeInputs(inputs: TickTapeEventInput[]) {
    return inputs.filter(allSessionEligible).sort((a, b) =>
        a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
// An overlap consumes occurrences, never a Set: two identical provider trades
// remain two trades. Without provider sequence IDs this is a best-effort union,
// not proof of continuity (the repository always exposes that limitation).
export function mergeTapeInputs(history: TickTapeEventInput[], live: TickTapeEventInput[]) {
    const available = new Map<string, number>();
    const seenSequences = new Set<string>();
    for (const input of history) {
        const key = normalizeTickTapeEvent(input)?.tradeKey;
        if (input.sourceSequence) seenSequences.add(input.sourceSequence);
        else if (key) available.set(key, (available.get(key) ?? 0) + 1);
    }
    const merged = [...history];
    for (const input of live) {
        const key = normalizeTickTapeEvent(input)?.tradeKey;
        if (!key) continue;
        if (input.sourceSequence) {
            if (seenSequences.has(input.sourceSequence)) continue;
            seenSequences.add(input.sourceSequence);
            merged.push(input);
            continue;
        }
        const count = available.get(key) ?? 0;
        if (count) available.set(key, count - 1);
        else merged.push(input);
    }
    if (merged.length > TAPE_INPUT_LIMIT) throw new Error('成交超過 500,000 筆處理預算，既有資料保留，完整性待補齊');
    return orderTapeInputs(merged);
}
function lowerBound(values: number[], value: number) {
    let low = 0; let high = values.length;
    while (low < high) { const mid = (low + high) >>> 1; if (values[mid]! < value) low = mid + 1; else high = mid; }
    return low;
}
export class SessionTapeClassifier {
    readonly result: SessionTapeResult;
    private queue: number[] = [];
    private sorted: number[] = [];
    private head = 0;
    private occurrences = new Map<string, number>();
    constructor(readonly settings: LargeTradeSettings) {
        const error = validateLargeTradeSettings(settings);
        if (error) throw new Error(error);
        this.result = { rows: [], largeIndices: [], sampleCount: 0, configRevision: JSON.stringify(settings) };
    }
    append(input: TickTapeEventInput) {
        if (!allSessionEligible(input)) return;
        if (this.result.rows.length >= TAPE_INPUT_LIMIT) throw new Error('成交超過 500,000 筆處理預算');
        const event = normalizeTickTapeEvent(input)!;
        const reason = largeTradeEligibility(event);
        const amount = tradeAmountTwd(event.close, event.volume);
        const dynamic = this.sorted.length >= this.settings.warmup
            ? this.sorted[Math.ceil(this.sorted.length * this.settings.percentile / 100) - 1]! : null;
        const conditions = { amount: amount >= this.settings.amount, lots: event.volume >= this.settings.lots, dynamic: dynamic === null ? null : amount >= dynamic };
        const tests = [conditions.amount, conditions.lots, ...(conditions.dynamic === null ? [] : [conditions.dynamic])];
        const isLarge = reason === 'eligible' && (this.settings.operator === 'AND' ? tests.every(Boolean) : tests.some(Boolean));
        const occurrence = (this.occurrences.get(event.tradeKey) ?? 0) + 1;
        this.occurrences.set(event.tradeKey, occurrence);
        const index = this.result.rows.length;
        this.result.rows.push({ ...event, tradeKey: `${event.tradeKey}#${occurrence}`, tradeAmountTwd: amount,
            thresholdAtDetection: dynamic, dynamicThreshold: dynamic, conditions, isLarge, eligibilityReason: reason,
            ruleVersion: 'tw-large-trade/2026-09-11.2', configRevision: this.result.configRevision });
        if (isLarge) this.result.largeIndices.push(index);
        if (reason === 'eligible') {
            if (this.queue.length === this.settings.sampleSize) {
                const old = this.queue[this.head]!;
                this.sorted.splice(lowerBound(this.sorted, old), 1);
                this.queue[this.head] = amount;
                this.head = (this.head + 1) % this.settings.sampleSize;
            } else this.queue.push(amount);
            this.sorted.splice(lowerBound(this.sorted, amount), 0, amount);
            this.result.sampleCount = this.sorted.length;
        }
    }
}
export async function replaySessionTape(inputs: TickTapeEventInput[], settings: LargeTradeSettings, signal: AbortSignal) {
    if (inputs.length > TAPE_INPUT_LIMIT) throw new Error('成交超過 500,000 筆處理預算');
    const classifier = new SessionTapeClassifier(settings);
    for (let index = 0; index < inputs.length; index++) {
        if (signal.aborted) throw new DOMException('重算已取消', 'AbortError');
        classifier.append(inputs[index]!);
        if (index % 1000 === 999) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (signal.aborted) throw new DOMException('重算已取消', 'AbortError');
    return classifier;
}

// Cache reconciliation can span a full day. Yield during identity work so a
// large cache save cannot monopolize the UI thread every persistence interval.
export async function mergeTapeInputsAsync(history: TickTapeEventInput[], live: TickTapeEventInput[]) {
    const available = new Map<string, number>();
    const seenSequences = new Set<string>();
    const merged: TickTapeEventInput[] = [];
    for (let index = 0; index < history.length; index++) {
        const input = history[index]!;
        const key = normalizeTickTapeEvent(input)?.tradeKey;
        if (key && allSessionEligible(input)) {
            if (input.sourceSequence) seenSequences.add(input.sourceSequence);
            else available.set(key, (available.get(key) ?? 0) + 1);
            merged.push(input);
        }
        if (index % 1000 === 999) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    for (let index = 0; index < live.length; index++) {
        const input = live[index]!;
        const key = normalizeTickTapeEvent(input)?.tradeKey;
        if (key && allSessionEligible(input)) {
            if (input.sourceSequence) {
                if (!seenSequences.has(input.sourceSequence)) { seenSequences.add(input.sourceSequence); merged.push(input); }
            } else {
                const count = available.get(key) ?? 0;
                if (count) available.set(key, count - 1);
                else merged.push(input);
            }
        }
        if (merged.length > TAPE_INPUT_LIMIT) throw new Error('成交超過 500,000 筆處理預算，既有資料保留');
        if (index % 1000 === 999) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return merged.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
