import type { KBars } from './types/market';

const DAY_MS = 86_400_000;
export const MAX_KBAR_CHUNK_DAYS = 30;
// 圖表既有MAX_HISTORY_DAYS=1095，含首尾共1096個日曆日。
export const MAX_KBAR_RANGE_DAYS = 1096;
export type KbarDateRange = Readonly<{ start: string; end: string }>;

function dayNumber(value: string): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error('kbar_range:invalid_date');
    }
    const epoch = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
        throw new Error('kbar_range:invalid_date');
    }
    return epoch / DAY_MS;
}

export function splitKbarDateRange(start: string, end: string): KbarDateRange[] {
    const first = dayNumber(start);
    const last = dayNumber(end);
    if (last < first) throw new Error('kbar_range:reversed');
    if (last - first + 1 > MAX_KBAR_RANGE_DAYS) {
        throw new Error('kbar_range:too_large');
    }
    const date = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
    const ranges: KbarDateRange[] = [];
    for (let day = first; day <= last; day += MAX_KBAR_CHUNK_DAYS) {
        ranges.push({ start: date(day), end: date(Math.min(last, day + MAX_KBAR_CHUNK_DAYS - 1)) });
    }
    return ranges;
}

function sourceWallTime(value: string): number {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
        throw new Error('kbar_data:invalid_time');
    }
    const day = dayNumber(value.slice(0, 10));
    const hour = Number(value.slice(11, 13));
    const minute = Number(value.slice(14, 16));
    const second = Number(value.slice(17, 19));
    if (hour > 23 || minute > 59 || second > 59) throw new Error('kbar_data:invalid_time');
    const qualified = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
    if (!Number.isFinite(Date.parse(qualified))) throw new Error('kbar_data:invalid_time');
    // 與原圖表一致使用來源wall-clock，不以觀看者時區重解釋。
    return day * 86400 + hour * 3600 + minute * 60 + second;
}

export function validateKbarChunk(data: KBars, range: KbarDateRange,
    enforceCalendarRange: boolean, previousTime = -Infinity): number {
    const fields = ['Open', 'High', 'Low', 'Close', 'Volume'] as const;
    if (!data || !Array.isArray(data.datetime) ||
        fields.some(key => !Array.isArray(data[key]) || data[key].length !== data.datetime.length) ||
        data.Amount !== undefined && (!Array.isArray(data.Amount) || data.Amount.length !== data.datetime.length)) {
        throw new Error('kbar_data:unaligned_columns');
    }
    let previous = previousTime;
    for (let i = 0; i < data.datetime.length; i++) {
        const time = sourceWallTime(data.datetime[i]!);
        if (time <= previous) throw new Error(i === 0 && Number.isFinite(previousTime)
            ? 'kbar_data:cross_chunk_time_conflict' : 'kbar_data:unordered_or_duplicate_time');
        previous = time;
        const date = data.datetime[i]!.slice(0, 10);
        if (enforceCalendarRange && (date < range.start || date > range.end)) {
            throw new Error('kbar_data:outside_requested_dates');
        }
        if (fields.some(key => !Number.isFinite(data[key][i]))) throw new Error('kbar_data:nonfinite_number');
        const open = data.Open[i]!, high = data.High[i]!, low = data.Low[i]!, close = data.Close[i]!;
        if (low > high || open < low || open > high || close < low || close > high) {
            throw new Error('kbar_data:invalid_ohlc');
        }
        if (!Number.isSafeInteger(data.Volume[i]) || data.Volume[i]! < 0) {
            throw new Error('kbar_data:invalid_volume');
        }
    }
    return previous;
}

export function mergeKbarChunks(parts: readonly { range: KbarDateRange; data: KBars }[],
    enforceCalendarRange: boolean): KBars {
    const merged: KBars = { datetime: [], Open: [], High: [], Low: [], Close: [], Volume: [] };
    const hasAmount = parts.some(part => part.data?.Amount !== undefined);
    if (hasAmount) merged.Amount = [];
    let previous = -Infinity;
    for (const part of parts) {
        validateKbarChunk(part.data, part.range, enforceCalendarRange);
        const k = part.data;
        for (let i = 0; i < k.datetime.length; i++) {
            const time = sourceWallTime(k.datetime[i]!);
            if (time <= previous) throw new Error('kbar_data:cross_chunk_time_conflict');
            previous = time;
            merged.datetime.push(k.datetime[i]!);
            for (const field of ['Open', 'High', 'Low', 'Close', 'Volume'] as const) {
                merged[field].push(k[field][i]!);
            }
            if (hasAmount) merged.Amount!.push(k.Amount === undefined ? null : k.Amount[i]);
        }
    }
    // 單段保留原payload identity；驗證也不排序或改寫來源。
    return parts.length === 1 ? parts[0]!.data : merged;
}
