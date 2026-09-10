import type { ContractBase } from './types/contract';
import type { SseTick } from './types/market';
import type { HistoryTicks } from './types/tick';

export const TICK_TAPE_MAX_ROWS = 120;
export const LARGE_TRADE_MAX_ROWS = 500;
export const LARGE_TRADE_SAMPLE_SIZE = 120;
export const LARGE_TRADE_WARMUP_SIZE = 30;
export const LARGE_TRADE_MINIMUM_TWD = 400_000;
export const LARGE_TRADE_RULE_VERSION = 'tw-large-trade/2026-09-10.1';

const MAX_SEEN_KEYS = 2_000;
const DATE_PATTERN = /^(\d{4})[-/](\d{2})[-/](\d{2})$/u;
const TIME_PATTERN = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/u;

export type TickTapeSource = 'history' | 'live';
export type LargeTradeEligibilityReason =
    | 'eligible'
    | 'unsupported_contract'
    | 'invalid_price'
    | 'invalid_volume'
    | 'odd_lot'
    | 'simtrade'
    | 'outside_continuous_session';

export interface TickTapeEventInput {
    contract: ContractBase;
    generation: number;
    source: TickTapeSource;
    date: string;
    time: string;
    close: number | string;
    volume: number;
    tickType: number;
    intradayOdd?: boolean;
    simtrade?: boolean;
}

export interface NormalizedTickTapeEvent {
    tradeKey: string;
    contractKey: string;
    generation: number;
    source: TickTapeSource;
    tradeDate: string;
    time: string;
    close: number;
    volume: number;
    tickType: number;
    intradayOdd: boolean;
    simtrade: boolean;
}

export interface TickTapeRow extends NormalizedTickTapeEvent {
    tradeAmountTwd: number;
    thresholdAtDetection: number | null;
    isLarge: boolean;
    eligibilityReason: LargeTradeEligibilityReason;
    ruleVersion: typeof LARGE_TRADE_RULE_VERSION;
}

export interface TickTapeLargeTradeState {
    contractKey: string;
    generation: number;
    tradeDate: string | null;
    rows: TickTapeRow[];
    largeRows: TickTapeRow[];
    sampleAmounts: number[];
    seenKeys: string[];
    currentThresholdTwd: number | null;
}

function contractKey(contract: ContractBase): string {
    return [
        String(contract.security_type ?? '').toUpperCase(),
        String(contract.exchange ?? '').toUpperCase(),
        contract.code.toUpperCase(),
    ].join(':');
}

export function normalizeTickTapeDate(value: string): string | null {
    const match = value.trim().match(DATE_PATTERN);
    if (!match) return null;
    const [, year, month, day] = match;
    const candidate = `${year}-${month}-${day}`;
    const date = new Date(`${candidate}T00:00:00Z`);
    return Number.isNaN(date.getTime())
        || date.toISOString().slice(0, 10) !== candidate
        ? null
        : candidate;
}

export function normalizeTickTapeTime(value: string): string | null {
    const match = value.trim().match(TIME_PATTERN);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3]);
    if (hour > 23 || minute > 59 || second > 59) return null;
    const fraction = (match[4] ?? '').padEnd(6, '0').slice(0, 6);
    return `${match[1]}:${match[2]}:${match[3]}.${fraction}`;
}

function priceKey(value: number): string {
    return value.toFixed(6).replace(/\.?0+$/u, '');
}

export function normalizeTickTapeEvent(
    input: TickTapeEventInput,
): NormalizedTickTapeEvent | null {
    const tradeDate = normalizeTickTapeDate(input.date);
    const time = normalizeTickTapeTime(input.time);
    if (!tradeDate || !time || !Number.isInteger(input.generation) || input.generation < 1) {
        return null;
    }
    const close = Number(input.close);
    const volume = Number(input.volume);
    const key = contractKey(input.contract);
    const tickType = Number.isInteger(input.tickType) ? input.tickType : 0;
    return {
        tradeKey: [key, tradeDate, time, priceKey(close), String(volume), String(tickType)].join('|'),
        contractKey: key,
        generation: input.generation,
        source: input.source,
        tradeDate,
        time,
        close,
        volume,
        tickType,
        intradayOdd: input.intradayOdd === true,
        simtrade: input.simtrade === true,
    };
}

export function largeTradeEligibility(
    event: NormalizedTickTapeEvent,
): LargeTradeEligibilityReason {
    const [securityType, exchange] = event.contractKey.split(':');
    if (securityType !== 'STK' || !['TSE', 'OTC'].includes(exchange ?? '')) {
        return 'unsupported_contract';
    }
    if (!Number.isFinite(event.close) || event.close <= 0) return 'invalid_price';
    if (!Number.isFinite(event.volume) || event.volume <= 0) return 'invalid_volume';
    if (event.intradayOdd) return 'odd_lot';
    if (event.simtrade) return 'simtrade';
    if (event.time <= '09:00:00.000000' || event.time >= '13:25:00.000000') {
        return 'outside_continuous_session';
    }
    return 'eligible';
}

export function nearestRankP70(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(sorted.length * 0.7) - 1);
    return sorted[index] ?? null;
}

export function largeTradeThresholdTwd(
    price: number,
    previousAmounts: number[],
): number {
    const fixedFloor = Math.max(
        LARGE_TRADE_MINIMUM_TWD,
        Math.round(price * 5 * 1_000),
    );
    if (previousAmounts.length < LARGE_TRADE_WARMUP_SIZE) return fixedFloor;
    return Math.max(fixedFloor, nearestRankP70(previousAmounts) ?? fixedFloor);
}

export function createTickTapeLargeTradeState(
    contract: ContractBase,
    generation: number,
): TickTapeLargeTradeState {
    return {
        contractKey: contractKey(contract),
        generation,
        tradeDate: null,
        rows: [],
        largeRows: [],
        sampleAmounts: [],
        seenKeys: [],
        currentThresholdTwd: null,
    };
}

function resetStateFor(
    state: TickTapeLargeTradeState,
    event: NormalizedTickTapeEvent,
): TickTapeLargeTradeState {
    return {
        contractKey: state.contractKey,
        generation: event.generation,
        tradeDate: event.tradeDate,
        rows: [],
        largeRows: [],
        sampleAmounts: [],
        seenKeys: [],
        currentThresholdTwd: null,
    };
}

export function ingestTickTapeEvent(
    state: TickTapeLargeTradeState,
    input: TickTapeEventInput,
): TickTapeLargeTradeState {
    const event = normalizeTickTapeEvent(input);
    if (!event || event.contractKey !== state.contractKey) return state;
    if (event.generation < state.generation) return state;

    let current = state;
    if (event.generation > state.generation) {
        current = resetStateFor(state, event);
    } else if (state.tradeDate && event.tradeDate < state.tradeDate) {
        return state;
    } else if (state.tradeDate && event.tradeDate > state.tradeDate) {
        current = resetStateFor(state, event);
    }
    if (current.seenKeys.includes(event.tradeKey)) return current;

    const eligibilityReason = largeTradeEligibility(event);
    const tradeAmountTwd = Number.isFinite(event.close) && Number.isFinite(event.volume)
        ? Math.round(event.close * event.volume * 1_000)
        : 0;
    const thresholdAtDetection = eligibilityReason === 'eligible'
        ? largeTradeThresholdTwd(event.close, current.sampleAmounts)
        : null;
    const isLarge = thresholdAtDetection !== null
        && tradeAmountTwd >= thresholdAtDetection;
    const row: TickTapeRow = {
        ...event,
        tradeAmountTwd,
        thresholdAtDetection,
        isLarge,
        eligibilityReason,
        ruleVersion: LARGE_TRADE_RULE_VERSION,
    };
    const rows = [row, ...current.rows].slice(0, TICK_TAPE_MAX_ROWS);
    const largeRows = isLarge
        ? [row, ...current.largeRows].slice(0, LARGE_TRADE_MAX_ROWS)
        : current.largeRows;
    const sampleAmounts = eligibilityReason === 'eligible'
        ? [...current.sampleAmounts, tradeAmountTwd].slice(-LARGE_TRADE_SAMPLE_SIZE)
        : current.sampleAmounts;
    const seenKeys = [...current.seenKeys, event.tradeKey].slice(-MAX_SEEN_KEYS);
    return {
        ...current,
        tradeDate: current.tradeDate ?? event.tradeDate,
        rows,
        largeRows,
        sampleAmounts,
        seenKeys,
        currentThresholdTwd: thresholdAtDetection ?? current.currentThresholdTwd,
    };
}

export function replayTickTapeEvents(
    contract: ContractBase,
    generation: number,
    inputs: TickTapeEventInput[],
): TickTapeLargeTradeState {
    return [...inputs]
        .sort((left, right) =>
            left.date.localeCompare(right.date)
            || left.time.localeCompare(right.time)
            || (left.source === right.source ? 0 : left.source === 'history' ? -1 : 1))
        .reduce(
            (state, input) => ingestTickTapeEvent(state, input),
            createTickTapeLargeTradeState(contract, generation),
        );
}

export function historyTickTapeInputs(
    contract: ContractBase,
    history: HistoryTicks,
    generation: number,
): TickTapeEventInput[] {
    const inputs: TickTapeEventInput[] = [];
    for (let index = 0; index < history.datetime.length; index += 1) {
        const datetime = history.datetime[index]?.trim();
        if (!datetime) continue;
        const [date = '', time = ''] = datetime.split(/[T ]/u, 2);
        inputs.push({
            contract,
            generation,
            source: 'history',
            date,
            time,
            close: history.close[index] ?? Number.NaN,
            volume: history.volume[index] ?? Number.NaN,
            tickType: history.tick_type[index] ?? 0,
        });
    }
    return inputs;
}

export function liveTickTapeInput(
    contract: ContractBase,
    tick: SseTick,
    generation: number,
): TickTapeEventInput {
    return {
        contract,
        generation,
        source: 'live',
        date: tick.date,
        time: tick.time,
        close: tick.close,
        volume: tick.volume,
        tickType: tick.tick_type,
        intradayOdd: tick.intraday_odd,
        simtrade: tick.simtrade,
    };
}
