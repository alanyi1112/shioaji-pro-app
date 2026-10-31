import type { DailyLevelSnapshot } from './daily-indicator-levels';
import { adjacentMarketDate, marketCalendarDay, taipeiCalendarDate, type MarketCalendar, type CalendarMarket } from './market-calendar';
import { wallClockDateKey } from './kbar-readout';
import { realCalendarDate } from './market-calendar';
import type { ProductSupportResistanceState } from './support-resistance-state';
import type { Candle } from './types/market';

export type PreviousClose = Readonly<{
    key: string; tradeDate: string | null; previousDate: string | null;
    close: number | null; generation: number; receivedAt: number | null;
    source: 'shioaji-canonical-unadjusted-v1'; calendarVersion: string | null; reason: string | null;
}>;
export type SupportReferenceClose = Readonly<{ key: string; referenceDate: string | null; close: number | null;
    mode: 'automatic' | 'pinned' | null; source: 'support-resistance-reference-close-v1'; reason: string | null }>;
export type LastDailyChartClose = Readonly<{ key: string; date: string | null; close: number | null;
    source: 'last-daily-chart-close-v1'; reason: string | null }>;
export type KeyPricePercentContext = { baseline: PreviousClose | SupportReferenceClose | LastDailyChartClose;
    up: string; down: string; neutral: string; prefix?: string };
/** The displayed daily series tail, independent of Fibonacci anchors and viewport. */
export function resolveLastDailyChartClose({key,identity,expectedIdentity,minutes,bars,available}:
    {key:string;identity:string;expectedIdentity:string;minutes:number;bars:readonly Candle[];available:boolean}):LastDailyChartClose {
    const tail=bars.at(-1), date=tail ? sourceDate(tail.time) : null;
    const valid=!!key && identity===expectedIdentity && minutes===1440 && available && date!==null &&
        !!tail && Number.isFinite(tail.close) && tail.close>0;
    return {key,date:valid?date:null,close:valid?tail!.close:null,source:'last-daily-chart-close-v1',
        reason:valid?null:'日K最後一根K棒收盤價尚未確認'};
}
/** The accepted reference candle owns the denominator for all three support tools. */
export function resolveSupportReferenceClose(key: string, state: ProductSupportResistanceState | null): SupportReferenceClose {
    const r = state?.reference;
    const valid = !!key && state?.key === key && r?.status === 'completed' && realCalendarDate(r.date) && Number.isFinite(r.close) && r.close > 0;
    return { key, referenceDate: state?.key === key ? r?.date ?? null : null, close: valid ? r!.close : null,
        mode: state?.key === key ? r?.mode ?? null : null, source: 'support-resistance-reference-close-v1',
        reason: valid ? null : '參考K棒收盤價尚未確認或不是有效正數' };
}
const sourceDate = (seconds: number) => Number.isFinite(seconds) && Math.abs(seconds) < 8.64e12 ? wallClockDateKey(seconds) : null;
/** Only accepted chart history/trades and the existing local calendar projection are inputs. */
export function resolvePreviousClose({ key, snapshot, calendar, market, now = new Date(), minimumGeneration = 0 }:
    { key: string; snapshot: DailyLevelSnapshot; calendar: MarketCalendar | null; market: string;
        now?: Date; minimumGeneration?: number }): PreviousClose {
    const tail = snapshot.bars.at(-1);
    const tradeDate = tail ? sourceDate(tail.time) : null;
    const base: PreviousClose = { key, tradeDate, previousDate: null, close: null, generation: snapshot.generation,
        receivedAt: snapshot.receivedAt, source: 'shioaji-canonical-unadjusted-v1', calendarVersion: calendar?.version ?? null, reason: null };
    const unknown = (reason: string, previousDate: string | null = null) => ({ ...base, previousDate, reason });
    if (snapshot.key !== key || !key.endsWith('|shioaji-canonical-unadjusted-v1') || !Number.isSafeInteger(snapshot.generation) || snapshot.generation < minimumGeneration)
        return unknown('商品／價格基準或世代不符');
    if (!Number.isFinite(+now) || !tradeDate || snapshot.asOf === null || sourceDate(snapshot.asOf) !== tradeDate || snapshot.receivedAt === null || !Number.isFinite(snapshot.receivedAt) || snapshot.receivedAt < snapshot.asOf ||
        snapshot.receivedAt > (+now / 1000 + 8 * 3600 + 60) || snapshot.knownGap || snapshot.state !== 'ready')
        return unknown('日K來源尚未確認或已過期');
    if (!calendar || !['TSE', 'OTC'].includes(market)) return unknown('本機交易日曆／市場未確認');
    const m = market as CalendarMarket;
    if (marketCalendarDay(calendar, tradeDate, m, now).state !== 'scheduled') return unknown('行情交易日未確認');
    const today = taipeiCalendarDate(now);
    if (tradeDate > today) return unknown('來源日期在未來');
    // A weekend keeps the last confirmed market day; a missing subsequent trading session does not.
    for (let at = Date.parse(tradeDate) + 86400000, end = Date.parse(today); at <= end; at += 86400000) {
        const day = new Date(at).toISOString().slice(0, 10), state = marketCalendarDay(calendar, day, m, now).state;
        if (state !== 'closed') return unknown('最新交易日來源尚未確認');
    }
    const previous = adjacentMarketDate(calendar, tradeDate, 'previous', [m], now).date;
    if (!previous) return unknown('前一交易日未確認');
    const rows = snapshot.bars.filter(b => sourceDate(b.time) === previous);
    if (rows.length !== 1) return unknown('前一交易日日K缺少或重複', previous);
    const close = rows[0]!.close;
    if (!Number.isFinite(close) || close <= 0) return unknown('昨收不是有效正數', previous);
    return { ...base, previousDate: previous, close };
}

export function keyPricePercent(price: number, context: KeyPricePercentContext) {
    const prefix=context.prefix===undefined?'較昨收 ':context.prefix?context.prefix+' ':'';
    const close = context.baseline.close;
    const value = close !== null && close > 0 && Number.isFinite(price) && Number.isFinite(close)
        ? (price / close - 1) * 100 : null;
    if (value === null || !Number.isFinite(value)) return { text: prefix+'—', color: context.neutral, value: null };
    const rounded = Number(value.toFixed(2));
    return { text: `${prefix}${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(2)}%`,
        color: rounded > 0 ? context.up : rounded < 0 ? context.down : context.neutral, value };
}

let calendarRead: Promise<MarketCalendar | null> | undefined;
/** Existing local metadata only; never refreshes or downloads an upstream calendar. */
export function readKeyPriceCalendar(): Promise<MarketCalendar | null> {
    return calendarRead ??= fetch('/api/market-calendar/v1/projection', { cache: 'no-store' })
        .then(async r => { if (!r.ok) return null; const body = await r.json(); return body.ok === true ? body.calendar ?? null : null; })
        .catch(() => null);
}
