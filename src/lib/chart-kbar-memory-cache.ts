import type { Candle } from './types/market';

const MAX_ENTRIES = 12;

type CacheEntry = Readonly<{
    bars: readonly Candle[];
    usedAt: number;
}>;

const cache = new Map<string, CacheEntry>();

function cloneBars(bars: readonly Candle[]): Candle[] {
    return bars.map((bar) => ({ ...bar }));
}

function evictLeastRecentlyUsed() {
    if (cache.size <= MAX_ENTRIES) return;
    const oldest = [...cache.entries()].sort(
        (left, right) => left[1].usedAt - right[1].usedAt,
    )[0]?.[0];
    if (oldest) cache.delete(oldest);
}

/**
 * Keeps the most recently rendered canonical 1-minute rows for fast symbol
 * switching. Callers still refresh from Shioaji, so this cache is only the
 * immediate visual hand-off and never becomes the final data authority.
 */
export function rememberChartKbars(key: string, bars: readonly Candle[]) {
    if (bars.length === 0) return;
    cache.set(key, { bars: cloneBars(bars), usedAt: Date.now() });
    evictLeastRecentlyUsed();
}

export function recallChartKbars(key: string): Candle[] | null {
    const hit = cache.get(key);
    if (!hit) return null;
    cache.set(key, { ...hit, usedAt: Date.now() });
    return cloneBars(hit.bars);
}

export function resetChartKbarMemoryCacheForTests() {
    cache.clear();
}
