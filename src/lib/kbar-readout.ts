import type { SecurityType } from './types/contract';
import type { Candle } from './types/market';
import type { PriceDirection } from './price-direction';
import { priceDirection } from './price-direction';

const TAIPEI_OFFSET_SECONDS = 8 * 60 * 60;

function pad(value: number, size = 2): string {
    return String(value).padStart(size, '0');
}

function wallClockParts(time: number) {
    const date = new Date(time * 1000);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
    };
}

export function wallClockDateKey(time: number): string {
    const p = wallClockParts(time);
    return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function hhmm(time: number): string {
    const p = wallClockParts(time);
    return `${pad(p.hour)}:${pad(p.minute)}`;
}

function hhmmss(time: number): string {
    const p = wallClockParts(time);
    return `${hhmm(time)}:${pad(p.second)}`;
}

function mmdd(time: number): string {
    const p = wallClockParts(time);
    return `${pad(p.month)}/${pad(p.day)}`;
}

function yyyymmdd(time: number): string {
    const p = wallClockParts(time);
    return `${pad(p.year, 4)}/${pad(p.month)}/${pad(p.day)}`;
}

export interface KbarIntervalLabel {
    short: string;
    full: string;
}

// Candle timestamps are deliberately encoded as UTC-shaped Taiwan wall-clock
// seconds by wallClockToUtc().  Always use UTC getters here so a viewer's local
// timezone cannot shift the displayed market time.
export function formatKbarInterval(
    startTime: number,
    minutes: number,
): KbarIntervalLabel {
    if (!Number.isFinite(startTime) || !Number.isFinite(minutes) || minutes <= 0) {
        return { short: '—', full: '—' };
    }
    if (minutes >= 1440) {
        const date = yyyymmdd(startTime);
        return { short: date, full: `${date}（1D）` };
    }
    const endTime = startTime + minutes * 60 - 1;
    const sameDate = wallClockDateKey(startTime) === wallClockDateKey(endTime);
    const short =
        minutes === 1
            ? `${hhmmss(startTime)}–${hhmmss(endTime)}`
            : sameDate
              ? `${hhmm(startTime)}–${hhmm(endTime)}`
              : `${mmdd(startTime)} ${hhmm(startTime)}–${mmdd(endTime)} ${hhmm(endTime)}`;
    return {
        short,
        full: `${yyyymmdd(startTime)} ${hhmmss(startTime)}–${yyyymmdd(endTime)} ${hhmmss(endTime)}`,
    };
}

export function buildCandleTimeIndex(bars: readonly Candle[]): Map<number, Candle> {
    return new Map(bars.map((bar) => [bar.time, bar]));
}

export function resolveReadoutCandle(
    bars: readonly Candle[],
    index: ReadonlyMap<number, Candle>,
    selectedTime: number | null,
): Candle | null {
    if (selectedTime !== null) {
        const selected = index.get(selectedTime);
        if (selected) return selected;
    }
    return bars[bars.length - 1] ?? null;
}

export function formatKbarVolume(volume: number): string {
    if (!Number.isFinite(volume)) return '—';
    return Math.max(0, Math.round(volume)).toLocaleString('en-US');
}

export interface KbarReadoutField {
    key: 'open' | 'high' | 'low' | 'close' | 'volume';
    label: '開' | '高' | '低' | '收' | '最新' | '量';
    value: string;
    rawValue?: number;
    tone: PriceDirection | 'neutral';
}

export interface KbarReadoutDisplay {
    interval: string;
    fullInterval: string;
    fields: KbarReadoutField[];
}

export function buildKbarReadoutDisplay(
    candle: Candle | null,
    minutes: number,
    forming: boolean,
    priceFormatter: (value: number) => string,
    reference?: number,
): KbarReadoutDisplay {
    if (!candle) {
        return {
            interval: '—',
            fullInterval: '—',
            fields: [
                { key: 'open', label: '開', value: '—', tone: 'flat' },
                { key: 'high', label: '高', value: '—', tone: 'flat' },
                { key: 'low', label: '低', value: '—', tone: 'flat' },
                { key: 'close', label: '收', value: '—', tone: 'flat' },
                { key: 'volume', label: '量', value: '—', tone: 'neutral' },
            ],
        };
    }
    const interval = formatKbarInterval(candle.time, minutes);
    return {
        interval: interval.short,
        fullInterval: interval.full,
        fields: [
            priceReadoutField('open', '開', candle.open, priceFormatter, reference),
            priceReadoutField('high', '高', candle.high, priceFormatter, reference),
            priceReadoutField('low', '低', candle.low, priceFormatter, reference),
            {
                key: 'close',
                label: forming ? '最新' : '收',
                value: priceFormatter(candle.close),
                rawValue: candle.close,
                tone: priceDirection(candle.close, reference),
            },
            {
                key: 'volume',
                label: '量',
                value: formatKbarVolume(candle.volume),
                rawValue: candle.volume,
                tone: 'neutral',
            },
        ],
    };
}

function priceReadoutField(
    key: 'open' | 'high' | 'low',
    label: '開' | '高' | '低',
    rawValue: number,
    formatter: (value: number) => string,
    reference?: number,
): KbarReadoutField {
    return {
        key,
        label,
        value: formatter(rawValue),
        rawValue,
        tone: priceDirection(rawValue, reference),
    };
}

export function resolveReadoutReference({
    candle,
    reference,
    securityType,
    forming,
    nowWallClockSeconds = taipeiWallClockNowSeconds(),
}: {
    candle: Candle | null;
    reference: number | undefined;
    securityType: SecurityType;
    forming: boolean;
    nowWallClockSeconds?: number;
}): number | undefined {
    if (
        !candle ||
        reference === undefined ||
        !Number.isFinite(reference) ||
        reference <= 0
    ) {
        return undefined;
    }
    if (
        securityType === 'STK' ||
        securityType === 'IND' ||
        securityType === 'WRT'
    ) {
        return wallClockDateKey(candle.time) ===
            wallClockDateKey(nowWallClockSeconds)
            ? reference
            : undefined;
    }
    if (securityType === 'FUT' || securityType === 'OPT') {
        return forming ? reference : undefined;
    }
    return undefined;
}

// Convert real epoch milliseconds to the UTC-shaped Taiwan wall-clock seconds
// used by chart candles. Taiwan is UTC+8 and has no daylight-saving changes.
export function taipeiWallClockNowSeconds(nowMs = Date.now()): number {
    return Math.floor(nowMs / 1000) + TAIPEI_OFFSET_SECONDS;
}

export function formingDeadline(
    barTime: number,
    minutes: number,
    securityType: SecurityType,
): number | null {
    if (minutes < 1440) return barTime + minutes * 60;
    if (
        securityType === 'STK' ||
        securityType === 'IND' ||
        securityType === 'WRT'
    ) {
        return barTime + 13 * 60 * 60 + 30 * 60;
    }
    return null;
}

export function isReadoutBarForming({
    barTime,
    formingBarTime,
    minutes,
    securityType,
    nowWallClockSeconds,
}: {
    barTime: number;
    formingBarTime: number | null;
    minutes: number;
    securityType: SecurityType;
    nowWallClockSeconds: number;
}): boolean {
    if (barTime !== formingBarTime) return false;
    const deadline = formingDeadline(barTime, minutes, securityType);
    return deadline !== null && nowWallClockSeconds < deadline;
}

export interface DayBoundary {
    previousTime: number;
    nextTime: number;
}

export function selectDayBoundaries(
    bars: readonly Candle[],
    minutes: number,
): DayBoundary[] {
    if (minutes >= 1440) return [];
    const out: DayBoundary[] = [];
    for (let i = 1; i < bars.length; i++) {
        const previous = bars[i - 1]!;
        const next = bars[i]!;
        if (wallClockDateKey(previous.time) !== wallClockDateKey(next.time)) {
            out.push({ previousTime: previous.time, nextTime: next.time });
        }
    }
    return out;
}
