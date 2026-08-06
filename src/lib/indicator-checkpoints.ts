import {
    chronologicalCandles,
    roundReference,
    type IndicatorPoint,
} from './indicators';
import type { Candle } from './types/market';

export type IndicatorOutput = Record<string, IndicatorPoint[]>;
export type FullIndicatorCompute = (
    bars: Candle[],
    params: Record<string, number>,
) => IndicatorOutput;

interface EmaState {
    period: number;
    seedSum: number;
    seedCount: number;
    current: number | null;
}

interface WilderState {
    period: number;
    count: number;
    seedA: number;
    seedB: number;
    averageA: number | null;
    averageB: number | null;
    previousClose: number | null;
}

interface MacdState {
    fast: EmaState;
    slow: EmaState;
    signal: EmaState;
}

type CheckpointState =
    | { type: 'ema'; ema: EmaState }
    | { type: 'macd'; macd: MacdState }
    | { type: 'rsi'; short: WilderState; long: WilderState }
    | { type: 'atr'; atr: WilderState };

interface CheckpointEntry {
    prefixSignature: string;
    prefixOutput: IndicatorOutput;
    state: CheckpointState;
}

function createEmaState(period: number): EmaState {
    return { period, seedSum: 0, seedCount: 0, current: null };
}

function stepEma(state: EmaState, value: number): number | undefined {
    if (state.current === null) {
        state.seedSum += value;
        state.seedCount += 1;
        if (state.seedCount < state.period) return undefined;
        state.current = state.seedSum / state.period;
        return state.current;
    }
    const alpha = 2 / (state.period + 1);
    state.current = value * alpha + state.current * (1 - alpha);
    return state.current;
}

function createWilderState(period: number): WilderState {
    return {
        period,
        count: 0,
        seedA: 0,
        seedB: 0,
        averageA: null,
        averageB: null,
        previousClose: null,
    };
}

function stepRsi(state: WilderState, bar: Candle): number | undefined {
    if (state.previousClose === null) {
        state.previousClose = bar.close;
        return undefined;
    }
    const change = bar.close - state.previousClose;
    state.previousClose = bar.close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    state.count += 1;
    if (state.averageA === null || state.averageB === null) {
        state.seedA += gain;
        state.seedB += loss;
        if (state.count < state.period) return undefined;
        state.averageA = state.seedA / state.period;
        state.averageB = state.seedB / state.period;
    } else {
        state.averageA =
            (state.averageA * (state.period - 1) + gain) / state.period;
        state.averageB =
            (state.averageB * (state.period - 1) + loss) / state.period;
    }
    if (state.averageA === 0 && state.averageB === 0) return 50;
    if (state.averageB === 0) return 100;
    return 100 - 100 / (1 + state.averageA / state.averageB);
}

function stepAtr(state: WilderState, bar: Candle): number | undefined {
    const trueRange =
        state.previousClose === null
            ? bar.high - bar.low
            : Math.max(
                  bar.high - bar.low,
                  Math.abs(bar.high - state.previousClose),
                  Math.abs(bar.low - state.previousClose),
              );
    state.previousClose = bar.close;
    state.count += 1;
    if (state.averageA === null) {
        state.seedA += trueRange;
        if (state.count < state.period) return undefined;
        state.averageA = state.seedA / state.period;
    } else {
        state.averageA =
            (state.averageA * (state.period - 1) + trueRange) / state.period;
    }
    return state.averageA;
}

function prefixSignature(bars: Candle[]): string {
    const first = bars[0];
    const last = bars[bars.length - 1];
    return bars.length === 0
        ? 'empty'
        : [
              bars.length,
              first?.time,
              last?.time,
              last?.open,
              last?.high,
              last?.low,
              last?.close,
              last?.volume,
          ].join('|');
}

function buildCheckpoint(
    type: string,
    prefix: Candle[],
    params: Record<string, number>,
): CheckpointState | null {
    if (type === 'ema') {
        const state = createEmaState(params.period!);
        for (const bar of prefix) stepEma(state, bar.close);
        return { type, ema: state };
    }
    if (type === 'macd') {
        const state: MacdState = {
            fast: createEmaState(params.fastPeriod!),
            slow: createEmaState(params.slowPeriod!),
            signal: createEmaState(params.signalPeriod!),
        };
        for (const bar of prefix) {
            const fast = stepEma(state.fast, bar.close);
            const slow = stepEma(state.slow, bar.close);
            stepEma(
                state.signal,
                fast === undefined || slow === undefined ? 0 : fast - slow,
            );
        }
        return { type, macd: state };
    }
    if (type === 'rsi') {
        const short = createWilderState(params.shortPeriod!);
        const long = createWilderState(params.longPeriod!);
        for (const bar of prefix) {
            stepRsi(short, bar);
            stepRsi(long, bar);
        }
        return { type, short, long };
    }
    if (type === 'atr') {
        const atrState = createWilderState(params.period!);
        for (const bar of prefix) stepAtr(atrState, bar);
        return { type, atr: atrState };
    }
    return null;
}

function appendPoint(
    output: IndicatorPoint[],
    time: number,
    value: number | undefined,
    fullLength: boolean,
    shouldRound = true,
) {
    if (value !== undefined) {
        output.push({
            time,
            value: shouldRound ? roundReference(value) : value,
        });
    } else if (fullLength) {
        output.push({ time });
    }
}

function appendTail(
    prefixOutput: IndicatorOutput,
    state: CheckpointState,
    tail: Candle,
): IndicatorOutput {
    const output = Object.fromEntries(
        Object.entries(prefixOutput).map(([key, points]) => [
            key,
            points.map((point) => ({ ...point })),
        ]),
    );
    if (state.type === 'ema') {
        appendPoint(
            output.line ?? (output.line = []),
            tail.time,
            stepEma(state.ema, tail.close),
            false,
            false,
        );
    } else if (state.type === 'macd') {
        const fast = stepEma(state.macd.fast, tail.close);
        const slow = stepEma(state.macd.slow, tail.close);
        const line =
            fast === undefined || slow === undefined ? undefined : fast - slow;
        const signalValue = stepEma(state.macd.signal, line ?? 0);
        appendPoint(output.macd ?? (output.macd = []), tail.time, line, true);
        appendPoint(
            output.signal ?? (output.signal = []),
            tail.time,
            line === undefined ? undefined : signalValue,
            true,
        );
        appendPoint(
            output.hist ?? (output.hist = []),
            tail.time,
            line === undefined || signalValue === undefined
                ? undefined
                : line - signalValue,
            true,
        );
    } else if (state.type === 'rsi') {
        appendPoint(
            output.short ?? (output.short = []),
            tail.time,
            stepRsi(state.short, tail),
            true,
        );
        appendPoint(
            output.long ?? (output.long = []),
            tail.time,
            stepRsi(state.long, tail),
            true,
        );
    } else {
        appendPoint(
            output.line ?? (output.line = []),
            tail.time,
            stepAtr(state.atr, tail),
            true,
        );
    }
    return output;
}

function cloneCheckpointState(state: CheckpointState): CheckpointState {
    return JSON.parse(JSON.stringify(state)) as CheckpointState;
}

export class IndicatorCheckpointCache {
    private readonly entries = new Map<string, CheckpointEntry>();

    clear() {
        this.entries.clear();
    }

    compute(
        key: string,
        type: string,
        bars: Candle[],
        params: Record<string, number>,
        fullCompute: FullIndicatorCompute,
    ): IndicatorOutput {
        if (!['ema', 'macd', 'rsi', 'atr'].includes(type)) {
            return fullCompute(bars, params);
        }
        const rows = chronologicalCandles(bars);
        if (rows.length === 0) return fullCompute(rows, params);
        const prefix = rows.slice(0, -1);
        const signature = `${JSON.stringify(params)}|${prefixSignature(prefix)}`;
        let entry = this.entries.get(key);
        if (!entry || entry.prefixSignature !== signature) {
            const state = buildCheckpoint(type, prefix, params);
            if (!state) return fullCompute(rows, params);
            entry = {
                prefixSignature: signature,
                prefixOutput: fullCompute(prefix, params),
                state,
            };
            this.entries.set(key, entry);
        }
        return appendTail(
            entry.prefixOutput,
            cloneCheckpointState(entry.state),
            rows[rows.length - 1]!,
        );
    }
}
