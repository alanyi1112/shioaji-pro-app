// src/lib/indicators.ts — pure indicator computations on candles.
// Rendering/registry lives in indicator-defs.ts; this file is math only.
// Points may carry value: undefined to encode a gap (whitespace data).

import type { Candle } from './types/market';

export interface IndicatorPoint {
    time: number;
    value?: number;
}

export const REFERENCE_FORMULA_VERSION = 'multichart-ecae7ca-v1';

export function roundReference(value: number): number {
    return Number(value.toFixed(6));
}

export function boundedInteger(
    value: number,
    minimum: number,
    maximum: number,
    label: string,
): number {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`${label}:out-of-range`);
    }
    return value;
}

export function chronologicalCandles(bars: Candle[]): Candle[] {
    return bars
        .filter(
            (bar) =>
                Number.isFinite(bar.time) &&
                Number.isFinite(bar.open) &&
                Number.isFinite(bar.high) &&
                Number.isFinite(bar.low) &&
                Number.isFinite(bar.close) &&
                Number.isFinite(bar.volume),
        )
        .slice()
        .sort((left, right) => left.time - right.time);
}

const tp = (b: Candle) => (b.high + b.low + b.close) / 3;

function referenceSmaValues(values: number[], period: number): (number | undefined)[] {
    boundedInteger(period, 1, 500, 'period');
    let sum = 0;
    return values.map((value, index) => {
        sum += value;
        if (index >= period) sum -= values[index - period]!;
        return index + 1 < period ? undefined : roundReference(sum / period);
    });
}

export function referenceSma(
    bars: Candle[],
    period: number,
    source: 'close' | 'volume' = 'close',
): IndicatorPoint[] {
    const rows = chronologicalCandles(bars);
    const values = referenceSmaValues(
        rows.map((bar) => bar[source]),
        period,
    );
    return rows.map((bar, index) => ({ time: bar.time, value: values[index] }));
}

export function sma(bars: Candle[], period: number): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
        sum += bars[i]!.close;
        if (i >= period) sum -= bars[i - period]!.close;
        if (i >= period - 1) {
            out.push({ time: bars[i]!.time, value: sum / period });
        }
    }
    return out;
}

// EMA seeded with the SMA of the first `period` closes (standard seeding)
export function ema(bars: Candle[], period: number): IndicatorPoint[] {
    return emaOf(
        bars.map((b) => ({ time: b.time, value: b.close })),
        period,
    );
}

function emaOf(points: IndicatorPoint[], period: number): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    const k = 2 / (period + 1);
    let prev: number | null = null;
    let seedSum = 0;
    let seedCount = 0;
    for (const p of points) {
        if (p.value === undefined) continue;
        if (prev === null) {
            seedSum += p.value;
            seedCount += 1;
            if (seedCount === period) {
                prev = seedSum / period;
                out.push({ time: p.time, value: prev });
            }
            continue;
        }
        prev = p.value * k + prev * (1 - k);
        out.push({ time: p.time, value: prev });
    }
    return out;
}

export function wma(bars: Candle[], period: number): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    const denom = (period * (period + 1)) / 2;
    for (let i = period - 1; i < bars.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += bars[i - j]!.close * (period - j);
        }
        out.push({ time: bars[i]!.time, value: sum / denom });
    }
    return out;
}

export function bollinger(
    bars: Candle[],
    period = 20,
    mult = 2,
): { mid: IndicatorPoint[]; upper: IndicatorPoint[]; lower: IndicatorPoint[] } {
    boundedInteger(period, 2, 200, 'boll-period');
    if (!Number.isFinite(mult) || mult < 0.5 || mult > 5) {
        throw new RangeError('boll-mult:out-of-range');
    }
    const rows = chronologicalCandles(bars);
    const mid: IndicatorPoint[] = [];
    const upper: IndicatorPoint[] = [];
    const lower: IndicatorPoint[] = [];
    let sum = 0;
    let sqSum = 0;
    for (let i = 0; i < rows.length; i++) {
        const c = rows[i]!.close;
        sum += c;
        sqSum += c * c;
        if (i >= period) {
            const o = rows[i - period]!.close;
            sum -= o;
            sqSum -= o * o;
        }
        const time = rows[i]!.time;
        if (i >= period - 1) {
            const mean = sum / period;
            const sd = Math.sqrt(Math.max(0, sqSum / period - mean * mean));
            mid.push({ time, value: roundReference(mean) });
            upper.push({ time, value: roundReference(mean + mult * sd) });
            lower.push({ time, value: roundReference(mean - mult * sd) });
        } else {
            mid.push({ time });
            upper.push({ time });
            lower.push({ time });
        }
    }
    return { mid, upper, lower };
}

// VWAP resets at each trading day boundary
export function vwap(bars: Candle[]): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    let pv = 0;
    let vol = 0;
    let day = -1;
    for (const b of bars) {
        const d = Math.floor(b.time / 86400);
        if (d !== day) {
            day = d;
            pv = 0;
            vol = 0;
        }
        pv += tp(b) * b.volume;
        vol += b.volume;
        if (vol > 0) out.push({ time: b.time, value: pv / vol });
    }
    return out;
}

// Parabolic SAR (Wilder)
export function sar(bars: Candle[], step = 0.02, max = 0.2): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    if (bars.length < 2) return out;
    let rising = bars[1]!.close >= bars[0]!.close;
    let cur = rising ? bars[0]!.low : bars[0]!.high;
    let ep = rising ? bars[0]!.high : bars[0]!.low;
    let af = step;
    for (let i = 1; i < bars.length; i++) {
        const b = bars[i]!;
        cur = cur + af * (ep - cur);
        if (rising) {
            cur = Math.min(cur, bars[i - 1]!.low, bars[i - 2]?.low ?? Infinity);
            if (b.low < cur) {
                rising = false;
                cur = ep;
                ep = b.low;
                af = step;
            } else if (b.high > ep) {
                ep = b.high;
                af = Math.min(max, af + step);
            }
        } else {
            cur = Math.max(
                cur,
                bars[i - 1]!.high,
                bars[i - 2]?.high ?? -Infinity,
            );
            if (b.high > cur) {
                rising = true;
                cur = ep;
                ep = b.high;
                af = step;
            } else if (b.low < ep) {
                ep = b.low;
                af = Math.min(max, af + step);
            }
        }
        out.push({ time: b.time, value: cur });
    }
    return out;
}

export function donchian(
    bars: Candle[],
    period = 20,
): { upper: IndicatorPoint[]; mid: IndicatorPoint[]; lower: IndicatorPoint[] } {
    const upper: IndicatorPoint[] = [];
    const mid: IndicatorPoint[] = [];
    const lower: IndicatorPoint[] = [];
    for (let i = period - 1; i < bars.length; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            hi = Math.max(hi, bars[j]!.high);
            lo = Math.min(lo, bars[j]!.low);
        }
        const t = bars[i]!.time;
        upper.push({ time: t, value: hi });
        lower.push({ time: t, value: lo });
        mid.push({ time: t, value: (hi + lo) / 2 });
    }
    return { upper, mid, lower };
}

// true range series (index-aligned with bars, first bar = high-low)
function trueRanges(bars: Candle[]): number[] {
    const tr: number[] = [];
    for (let i = 0; i < bars.length; i++) {
        const b = bars[i]!;
        if (i === 0) {
            tr.push(b.high - b.low);
            continue;
        }
        const pc = bars[i - 1]!.close;
        tr.push(
            Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)),
        );
    }
    return tr;
}

// Wilder smoothing (RMA)
function rma(values: number[], period: number): (number | undefined)[] {
    const out: (number | undefined)[] = [];
    let prev: number | null = null;
    let seed = 0;
    for (let i = 0; i < values.length; i++) {
        if (prev === null) {
            seed += values[i]!;
            if (i === period - 1) {
                prev = seed / period;
                out.push(prev);
            } else {
                out.push(undefined);
            }
            continue;
        }
        prev = (prev * (period - 1) + values[i]!) / period;
        out.push(prev);
    }
    return out;
}

export function atr(bars: Candle[], period = 14): IndicatorPoint[] {
    boundedInteger(period, 2, 100, 'atr-period');
    const rows = chronologicalCandles(bars);
    const smoothed = rma(trueRanges(rows), period);
    const out: IndicatorPoint[] = [];
    for (let i = 0; i < rows.length; i++) {
        const v = smoothed[i];
        out.push({
            time: rows[i]!.time,
            ...(v === undefined ? {} : { value: roundReference(v) }),
        });
    }
    return out;
}

export function keltner(
    bars: Candle[],
    emaPeriod = 20,
    atrPeriod = 10,
    mult = 2,
): { mid: IndicatorPoint[]; upper: IndicatorPoint[]; lower: IndicatorPoint[] } {
    const midLine = ema(bars, emaPeriod);
    const atrLine = atr(bars, atrPeriod);
    const atrAt = new Map(atrLine.map((p) => [p.time, p.value!]));
    const mid: IndicatorPoint[] = [];
    const upper: IndicatorPoint[] = [];
    const lower: IndicatorPoint[] = [];
    for (const p of midLine) {
        const a = atrAt.get(p.time);
        if (a === undefined || p.value === undefined) continue;
        mid.push(p);
        upper.push({ time: p.time, value: p.value + mult * a });
        lower.push({ time: p.time, value: p.value - mult * a });
    }
    return { mid, upper, lower };
}

// SuperTrend — two series (up-trend line below price / down-trend line above)
// with whitespace gaps so the inactive side isn't drawn
export function supertrend(
    bars: Candle[],
    period = 10,
    mult = 3,
): { up: IndicatorPoint[]; down: IndicatorPoint[] } {
    const atrLine = rma(trueRanges(bars), period);
    const up: IndicatorPoint[] = [];
    const down: IndicatorPoint[] = [];
    let prevUpper = NaN;
    let prevLower = NaN;
    let trendUp = true;
    let prevClose = NaN;
    for (let i = 0; i < bars.length; i++) {
        const b = bars[i]!;
        const a = atrLine[i];
        if (a === undefined) {
            up.push({ time: b.time });
            down.push({ time: b.time });
            prevClose = b.close;
            continue;
        }
        const mid = (b.high + b.low) / 2;
        let upper = mid + mult * a;
        let lower = mid - mult * a;
        // band ratchet
        if (!Number.isNaN(prevUpper) && (upper > prevUpper || prevClose > prevUpper)) {
            upper = Math.min(upper, prevUpper);
        }
        if (!Number.isNaN(prevLower) && (lower < prevLower || prevClose < prevLower)) {
            lower = Math.max(lower, prevLower);
        }
        if (trendUp && b.close < lower) trendUp = false;
        else if (!trendUp && b.close > upper) trendUp = true;
        up.push(trendUp ? { time: b.time, value: lower } : { time: b.time });
        down.push(trendUp ? { time: b.time } : { time: b.time, value: upper });
        prevUpper = upper;
        prevLower = lower;
        prevClose = b.close;
    }
    return { up, down };
}

// ---- oscillators（副圖）----

export function wilderRsiSeries(bars: Candle[], period = 14): IndicatorPoint[] {
    boundedInteger(period, 2, 100, 'rsi-period');
    const rows = chronologicalCandles(bars);
    let averageGain: number | null = null;
    let averageLoss: number | null = null;
    const gains: number[] = [];
    const losses: number[] = [];
    return rows.map((bar, index) => {
        if (index === 0) return { time: bar.time };
        const change = bar.close - rows[index - 1]!.close;
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);
        gains.push(gain);
        losses.push(loss);
        if (index < period) return { time: bar.time };
        if (averageGain === null || averageLoss === null) {
            averageGain =
                gains.slice(0, period).reduce((sum, item) => sum + item, 0) /
                period;
            averageLoss =
                losses.slice(0, period).reduce((sum, item) => sum + item, 0) /
                period;
        } else {
            averageGain =
                (averageGain * (period - 1) + gain) / period;
            averageLoss =
                (averageLoss * (period - 1) + loss) / period;
        }
        const value =
            averageGain === 0 && averageLoss === 0
                ? 50
                : averageLoss === 0
                  ? 100
                  : 100 - 100 / (1 + averageGain / averageLoss);
        return { time: bar.time, value: roundReference(value) };
    });
}

export function rsi(bars: Candle[], period = 14): IndicatorPoint[] {
    return wilderRsiSeries(bars, period);
}

export function macd(
    bars: Candle[],
    fast = 12,
    slow = 26,
    signalPeriod = 9,
): { macd: IndicatorPoint[]; signal: IndicatorPoint[]; hist: IndicatorPoint[] } {
    boundedInteger(fast, 2, 200, 'macd-fast');
    boundedInteger(slow, 3, 200, 'macd-slow');
    boundedInteger(signalPeriod, 2, 100, 'macd-signal');
    if (fast >= slow) throw new RangeError('macd-period-order');
    const rows = chronologicalCandles(bars);
    const closes = rows.map((bar) => bar.close);
    const emaValues = (values: number[], period: number): (number | undefined)[] => {
        const alpha = 2 / (period + 1);
        let current: number | null = null;
        return values.map((value, index) => {
            if (index + 1 < period) return undefined;
            if (current === null) {
                current =
                    values
                        .slice(index + 1 - period, index + 1)
                        .reduce((sum, item) => sum + item, 0) / period;
            } else {
                current = value * alpha + current * (1 - alpha);
            }
            return current;
        });
    };
    const fastValues = emaValues(closes, fast);
    const slowValues = emaValues(closes, slow);
    const macdValues = rows.map((_, index) => {
        const fastValue = fastValues[index];
        const slowValue = slowValues[index];
        return fastValue === undefined || slowValue === undefined
            ? undefined
            : fastValue - slowValue;
    });
    const signalValues = emaValues(
        macdValues.map((value) => value ?? 0),
        signalPeriod,
    );
    const macdLine: IndicatorPoint[] = [];
    const signal: IndicatorPoint[] = [];
    const hist: IndicatorPoint[] = [];
    rows.forEach((bar, index) => {
        const lineValue = macdValues[index];
        const signalValue = signalValues[index];
        macdLine.push({
            time: bar.time,
            ...(lineValue === undefined
                ? {}
                : { value: roundReference(lineValue) }),
        });
        signal.push({
            time: bar.time,
            ...(lineValue === undefined || signalValue === undefined
                ? {}
                : { value: roundReference(signalValue) }),
        });
        hist.push({
            time: bar.time,
            ...(lineValue === undefined || signalValue === undefined
                ? {}
                : { value: roundReference(lineValue - signalValue) }),
        });
    });
    return { macd: macdLine, signal, hist };
}

// KD（Stochastic）參考契約：K、D 由 50 開始做 9/3/3 遞迴平滑。
export function stoch(
    bars: Candle[],
    kPeriod = 9,
    kSmooth = 3,
    dPeriod = 3,
): { k: IndicatorPoint[]; d: IndicatorPoint[] } {
    boundedInteger(kPeriod, 2, 100, 'kd-period');
    boundedInteger(kSmooth, 1, 20, 'kd-rsv-weight');
    boundedInteger(dPeriod, 1, 20, 'kd-k-weight');
    const rows = chronologicalCandles(bars);
    const k: IndicatorPoint[] = [];
    const d: IndicatorPoint[] = [];
    let currentK = 50;
    let currentD = 50;
    for (let i = 0; i < rows.length; i++) {
        if (i < kPeriod - 1) {
            k.push({ time: rows[i]!.time });
            d.push({ time: rows[i]!.time });
            continue;
        }
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            hi = Math.max(hi, rows[j]!.high);
            lo = Math.min(lo, rows[j]!.low);
        }
        const range = hi - lo;
        const rsv = range === 0 ? 50 : ((rows[i]!.close - lo) / range) * 100;
        currentK = (currentK * (kSmooth - 1) + rsv) / kSmooth;
        currentD = (currentD * (dPeriod - 1) + currentK) / dPeriod;
        k.push({ time: rows[i]!.time, value: roundReference(currentK) });
        d.push({ time: rows[i]!.time, value: roundReference(currentD) });
    }
    return { k, d };
}

function smaOf(points: IndicatorPoint[], period: number): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    let sum = 0;
    const vals: number[] = [];
    for (const p of points) {
        if (p.value === undefined) continue;
        vals.push(p.value);
        sum += p.value;
        if (vals.length > period) sum -= vals[vals.length - period - 1]!;
        if (vals.length >= period) {
            out.push({ time: p.time, value: sum / period });
        }
    }
    return out;
}

export function stochRsi(
    bars: Candle[],
    rsiPeriod = 14,
    stochPeriod = 14,
    kSmooth = 3,
    dSmooth = 3,
): { k: IndicatorPoint[]; d: IndicatorPoint[] } {
    const r = wilderRsiSeries(bars, rsiPeriod).filter(
        (point): point is IndicatorPoint & { value: number } =>
            point.value !== undefined,
    );
    const raw: IndicatorPoint[] = [];
    for (let i = stochPeriod - 1; i < r.length; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - stochPeriod + 1; j <= i; j++) {
            hi = Math.max(hi, r[j]!.value!);
            lo = Math.min(lo, r[j]!.value!);
        }
        const range = hi - lo;
        raw.push({
            time: r[i]!.time,
            value: range === 0 ? 50 : ((r[i]!.value! - lo) / range) * 100,
        });
    }
    const k = smaOf(raw, kSmooth);
    const d = smaOf(k, dSmooth);
    return { k, d };
}

export function cci(bars: Candle[], period = 20): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    for (let i = period - 1; i < bars.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += tp(bars[j]!);
        const mean = sum / period;
        let dev = 0;
        for (let j = i - period + 1; j <= i; j++) {
            dev += Math.abs(tp(bars[j]!) - mean);
        }
        const md = dev / period;
        out.push({
            time: bars[i]!.time,
            value: md === 0 ? 0 : (tp(bars[i]!) - mean) / (0.015 * md),
        });
    }
    return out;
}

export function obv(bars: Candle[]): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    let acc = 0;
    for (let i = 0; i < bars.length; i++) {
        if (i > 0) {
            const chg = bars[i]!.close - bars[i - 1]!.close;
            if (chg > 0) acc += bars[i]!.volume;
            else if (chg < 0) acc -= bars[i]!.volume;
        }
        out.push({ time: bars[i]!.time, value: acc });
    }
    return out;
}

export function mfi(bars: Candle[], period = 14): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    const pos: number[] = [];
    const neg: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const cur = tp(bars[i]!);
        const prev = tp(bars[i - 1]!);
        const flow = cur * bars[i]!.volume;
        pos.push(cur > prev ? flow : 0);
        neg.push(cur < prev ? flow : 0);
        if (pos.length > period) {
            pos.shift();
            neg.shift();
        }
        if (pos.length === period) {
            const p = pos.reduce((a, b) => a + b, 0);
            const n = neg.reduce((a, b) => a + b, 0);
            out.push({
                time: bars[i]!.time,
                value: n === 0 ? 100 : 100 - 100 / (1 + p / n),
            });
        }
    }
    return out;
}

export function willr(bars: Candle[], period = 14): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    for (let i = period - 1; i < bars.length; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            hi = Math.max(hi, bars[j]!.high);
            lo = Math.min(lo, bars[j]!.low);
        }
        const range = hi - lo;
        out.push({
            time: bars[i]!.time,
            value: range === 0 ? -50 : ((hi - bars[i]!.close) / range) * -100,
        });
    }
    return out;
}

export function dmi(
    bars: Candle[],
    period = 14,
    adxPeriod = 14,
): { plus: IndicatorPoint[]; minus: IndicatorPoint[]; adx: IndicatorPoint[] } {
    const plusDM: number[] = [];
    const minusDM: number[] = [];
    const tr: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const upMove = bars[i]!.high - bars[i - 1]!.high;
        const downMove = bars[i - 1]!.low - bars[i]!.low;
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        const pc = bars[i - 1]!.close;
        tr.push(
            Math.max(
                bars[i]!.high - bars[i]!.low,
                Math.abs(bars[i]!.high - pc),
                Math.abs(bars[i]!.low - pc),
            ),
        );
    }
    const sTR = rma(tr, period);
    const sPlus = rma(plusDM, period);
    const sMinus = rma(minusDM, period);
    const plus: IndicatorPoint[] = [];
    const minus: IndicatorPoint[] = [];
    const dx: IndicatorPoint[] = [];
    for (let i = 0; i < tr.length; i++) {
        const t = sTR[i];
        const p = sPlus[i];
        const m = sMinus[i];
        if (t === undefined || p === undefined || m === undefined || t === 0) {
            continue;
        }
        const time = bars[i + 1]!.time;
        const pdi = (p / t) * 100;
        const mdi = (m / t) * 100;
        plus.push({ time, value: pdi });
        minus.push({ time, value: mdi });
        const sum = pdi + mdi;
        dx.push({ time, value: sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100 });
    }
    // ADX = RMA of DX
    const adxVals = rma(
        dx.map((p) => p.value!),
        adxPeriod,
    );
    const adx: IndicatorPoint[] = [];
    for (let i = 0; i < dx.length; i++) {
        const v = adxVals[i];
        if (v !== undefined) adx.push({ time: dx[i]!.time, value: v });
    }
    return { plus, minus, adx };
}

export function roc(bars: Candle[], period = 12): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    for (let i = period; i < bars.length; i++) {
        const base = bars[i - period]!.close;
        if (base === 0) continue;
        out.push({
            time: bars[i]!.time,
            value: ((bars[i]!.close - base) / base) * 100,
        });
    }
    return out;
}

// 乖離率 BIAS = (close - MA) / MA × 100
export function bias(bars: Candle[], period = 20): IndicatorPoint[] {
    const ma = sma(bars, period);
    const out: IndicatorPoint[] = [];
    const maAt = new Map(ma.map((p) => [p.time, p.value!]));
    for (const b of bars) {
        const m = maAt.get(b.time);
        if (m === undefined || m === 0) continue;
        out.push({ time: b.time, value: ((b.close - m) / m) * 100 });
    }
    return out;
}
