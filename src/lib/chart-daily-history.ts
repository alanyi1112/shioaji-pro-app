import type { ContractInfo } from './types/contract';
import type { Candle } from './types/market';
import { requireCandleTimeline } from './candle-series-integrity';

export function chartDailyHistorySymbol(contract: ContractInfo): string | null {
    if (contract.security_type !== 'STK' || !/^\d{4,6}[A-Z]?$/.test(contract.code)) return null;
    if (contract.exchange === 'TSE') return `${contract.code}.TW`;
    if (contract.exchange === 'OTC') return `${contract.code}.TWO`;
    return null;
}

/** 只讀本機日線服務；這裡沒有 Shioaji 或分鐘 K 的備援路徑。 */
export async function fetchChartDailyHistory(symbol: string, signal: AbortSignal): Promise<Candle[]> {
    const response = await fetch(`/api/chart-daily-history/v1?symbol=${symbol}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw Error('daily_history_unavailable');
    const value = await response.json();
    if (value.ok !== true || value.symbol !== symbol || value.interval !== '1d' || value.brokerRequests !== 0
        || value.volumeContract?.canonicalVolumeUnit !== 'common_lot'
        || !Array.isArray(value.candles) || value.candles.length > 500) throw Error('daily_history_invalid');
    const rows: Candle[] = value.candles.filter((row: Candle) => {
        if (!Number.isSafeInteger(row.time)) throw Error('daily_history_invalid');
        // The provider's standard TW daily candle is stamped Taipei 09:00.
        // Persisted intraday quote snapshots can share its date, but are not
        // extra trading sessions and must never participate in SMA240.
        return row.time % 86400 === 3600;
    }).map((row: Candle) => {
        if (![row.time, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite)
            || row.time <= 0 || row.open <= 0 || row.low <= 0 || row.close <= 0 || row.volume < 0
            || row.high < Math.max(row.open, row.close, row.low) || row.low > Math.min(row.open, row.close)) throw Error('daily_history_invalid');
        // MultiView uses real UTC instants (Taipei 09:00); the main chart uses wall-clock UTC daily buckets.
        const time = Math.floor((row.time + 8 * 3600) / 86400) * 86400;
        return { time, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, turnoverTwd: null };
    });
    requireCandleTimeline(rows);
    return rows;
}

/** 保留券商近期 K 棒／即時尾端；歷史日線不得混入原始分鐘資料或盤中監控。 */
export function prependChartDailyHistory(history: readonly Candle[], recent: readonly Candle[]): Candle[] {
    if (history.length === 0 || recent.length === 0) return [...recent];
    const byTime = new Map(recent.map(row => [row.time, row]));
    const last = recent.at(-1)!.time;
    const overlap = history.filter(row => byTime.has(row.time) && row.time < last);
    if (overlap.length < 3 || overlap.some(row => Math.abs(row.close - byTime.get(row.time)!.close) > Math.max(0.005, row.close * 0.00001)))
        throw Error('daily_history_price_basis_mismatch');
    const rows = [...history.filter(row => row.time < recent[0]!.time), ...recent];
    requireCandleTimeline(rows);
    return rows;
}
