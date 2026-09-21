import type { ContractBase } from './types/contract';
import type { SseTick } from './types/market';
import type { HistoryTicks } from './types/tick';

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
    sourceSequence?: string;
    sourceCumulativeVolume?: number;
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
    ruleVersion: string;
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

export function historyTickTapeInputs(
    contract: ContractBase,
    history: HistoryTicks,
    generation: number,
    deriveCumulativeSequence = false,
): TickTapeEventInput[] {
    const inputs: TickTapeEventInput[] = [];
    let cumulativeVolume = 0;
    for (let index = 0; index < history.datetime.length; index += 1) {
        const datetime = history.datetime[index]?.trim();
        if (!datetime) continue;
        const [date = '', time = ''] = datetime.split(/[T ]/u, 2);
        const volume = history.volume[index] ?? Number.NaN;
        if (deriveCumulativeSequence && Number.isFinite(volume) && volume > 0) cumulativeVolume += volume;
        inputs.push({
            contract,
            generation,
            source: 'history',
            date,
            time,
            close: history.close[index] ?? Number.NaN,
            volume,
            tickType: history.tick_type[index] ?? 0,
            intradayOdd: history.intraday_odd?.[index],
            simtrade: history.simtrade?.[index],
            sourceCumulativeVolume: deriveCumulativeSequence ? cumulativeVolume : undefined,
            sourceSequence: deriveCumulativeSequence && cumulativeVolume > 0 ? `${date}|regular|${cumulativeVolume}` : undefined,
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
        sourceCumulativeVolume: Number.isFinite(tick.total_volume) && tick.total_volume > 0 ? tick.total_volume : undefined,
        sourceSequence: Number.isFinite(tick.total_volume) && tick.total_volume > 0 ? `${tick.date}|regular|${tick.total_volume}` : undefined,
    };
}
