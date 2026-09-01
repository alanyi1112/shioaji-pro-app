/** Worker 與前端共用的零依賴 canonical OHLC 契約。 */
export const SCREENER_OHLC_MAPPING_VERSION = 'official-daily-ohlcv-v1' as const;
export const SCREENER_PRICE_BASIS = 'official-unadjusted-after-market-twd' as const;

export interface OhlcProvenance {
    source: string;
    sourceUrl: string;
    fetchedAt: string;
    payloadHash: string;
    normalizationVersion: string;
}

/** 價格保留官方十進位字串；最多六位小數，避免先經 IEEE-754 才驗證。 */
export interface CanonicalOhlc {
    sessionDate: string;
    open: string;
    high: string;
    low: string;
    close: string;
}
export interface SourcedOhlc extends CanonicalOhlc {
    symbol: string;
    market: 'TWSE' | 'TPEx';
    currency: 'TWD';
    priceBasis: typeof SCREENER_PRICE_BASIS;
    mappingVersion: typeof SCREENER_OHLC_MAPPING_VERSION;
    provenance: OhlcProvenance;
}

const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export const canonicalPriceUnits = (value: unknown): bigint | null => {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value)) return null;
    const [whole = '0', fraction = ''] = value.split('.');
    const scaled = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, '0'));
    return scaled > BigInt(0) && scaled <= BigInt(Number.MAX_SAFE_INTEGER) ? scaled : null;
};

export function validateCanonicalOhlc(bar: CanonicalOhlc): boolean {
    if (!bar || !isoDate(bar.sessionDate)) return false;
    const open = canonicalPriceUnits(bar.open), high = canonicalPriceUnits(bar.high);
    const low = canonicalPriceUnits(bar.low), close = canonicalPriceUnits(bar.close);
    return open !== null && high !== null && low !== null && close !== null
        && high >= open && high >= close && high >= low && low <= open && low <= close;
}

export function validateCanonicalOhlcSeries(bars: readonly CanonicalOhlc[]): boolean {
    return Array.isArray(bars) && bars.length > 0 && bars.every(validateCanonicalOhlc)
        && new Set(bars.map((bar) => bar.sessionDate)).size === bars.length
        && bars.every((bar, index) => index === 0 || bar.sessionDate > bars[index - 1]!.sessionDate);
}
