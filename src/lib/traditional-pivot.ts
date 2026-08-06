import { chronologicalCandles, roundReference } from './indicators';
import type { Candle } from './types/market';
import type { SecurityType } from './types/contract';

export const TRADITIONAL_PIVOT_VERSION = 'traditional-pivot-tw-v1';
export const PIVOT_SECURITY_TYPES = new Set<SecurityType>([
    'STK',
    'IND',
    'WRT',
]);
export const PIVOT_TIMEFRAMES = new Set([1, 5, 15, 60, 1440]);

export interface TraditionalPivotLevels {
    p: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
}

export function traditionalPivot(
    high: number,
    low: number,
    close: number,
): TraditionalPivotLevels {
    if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        high < low ||
        close < low ||
        close > high
    ) {
        throw new RangeError('traditional-pivot:invalid-ohlc');
    }
    const p = (high + low + close) / 3;
    const spread = high - low;
    const r1 = 2 * p - low;
    const s1 = 2 * p - high;
    return {
        p: roundReference(p),
        r1: roundReference(r1),
        r2: roundReference(p + spread),
        r3: roundReference(r1 + spread),
        s1: roundReference(s1),
        s2: roundReference(p - spread),
        s3: roundReference(s1 - spread),
    };
}

const taipeiDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

export function taipeiTradingDate(timestamp: number): string {
    if (!Number.isFinite(timestamp)) {
        throw new RangeError('traditional-pivot:invalid-time');
    }
    const parts = taipeiDateFormatter.formatToParts(new Date(timestamp * 1000));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
}

export interface PivotReferenceDay {
    date: string;
    high: number;
    low: number;
    close: number;
    firstTime: number;
    lastTime: number;
    status: 'completed' | 'provisional';
    applicationDate?: string;
    applicationStartTime?: number;
    levels: TraditionalPivotLevels;
}

export function buildPivotReferenceDays(
    rawOneMinuteRows: Candle[],
): PivotReferenceDay[] {
    const groups = new Map<string, Candle[]>();
    for (const row of chronologicalCandles(rawOneMinuteRows)) {
        const date = taipeiTradingDate(row.time);
        const group = groups.get(date) ?? [];
        group.push(row);
        groups.set(date, group);
    }
    const dates = [...groups.keys()].sort();
    return dates.map((date, index) => {
        const rows = groups.get(date)!;
        const high = Math.max(...rows.map((row) => row.high));
        const low = Math.min(...rows.map((row) => row.low));
        const close = rows[rows.length - 1]!.close;
        const nextDate = dates[index + 1];
        const nextRows = nextDate ? groups.get(nextDate) : undefined;
        return {
            date,
            high: roundReference(high),
            low: roundReference(low),
            close: roundReference(close),
            firstTime: rows[0]!.time,
            lastTime: rows[rows.length - 1]!.time,
            status: nextDate ? 'completed' : 'provisional',
            ...(nextDate
                ? {
                      applicationDate: nextDate,
                      applicationStartTime: nextRows?.[0]?.time,
                  }
                : {}),
            levels: traditionalPivot(high, low, close),
        };
    });
}

export function latestCompletedPivot(
    days: readonly PivotReferenceDay[],
): PivotReferenceDay | null {
    for (let index = days.length - 1; index >= 0; index--) {
        if (days[index]!.status === 'completed') return days[index]!;
    }
    return null;
}

export function completedPivotForTime(
    days: readonly PivotReferenceDay[],
    timestamp: number,
): PivotReferenceDay | null {
    const date = taipeiTradingDate(timestamp);
    return (
        days.find(
            (day) => day.date === date && day.status === 'completed',
        ) ?? null
    );
}

export function pivotSupportReason(
    securityType: SecurityType,
    timeframeMinutes: number,
): string | null {
    if (!PIVOT_SECURITY_TYPES.has(securityType)) {
        return securityType === 'FUT' || securityType === 'OPT'
            ? '第一階段尚未支援 FUT／OPT'
            : '第一階段只支援 STK／IND／WRT';
    }
    if (!PIVOT_TIMEFRAMES.has(timeframeMinutes)) {
        return '只支援 1m／5m／15m／60m／1D';
    }
    return null;
}
