import type { TickTapeRow } from './tick-tape-large-trade';

export interface MoneyFlowPoint {
    minute: string;
    minuteIndex: number;
    overallNetTwd: number;
    largeNetTwd: number;
    nonLargeNetTwd: number;
}

export interface UnknownDirectionTrade {
    tradeDate: string;
    time: string;
    close: number;
    volume: number;
    tickType: number;
    tradeAmountTwd: number;
    source: 'history' | 'live';
}

export interface MoneyFlowSnapshot {
    revision: number;
    overallNetTwd: number;
    largeNetTwd: number;
    nonLargeNetTwd: number;
    unknownDirectionAmountTwd: number;
    unknownDirectionCount: number;
    unknownTrades: readonly UnknownDirectionTrade[];
    points: readonly MoneyFlowPoint[];
}

type MoneyFlowInput = Pick<
    TickTapeRow,
    | 'contractKey'
    | 'tradeDate'
    | 'time'
    | 'source'
    | 'close'
    | 'volume'
    | 'tickType'
    | 'intradayOdd'
    | 'simtrade'
    | 'tradeAmountTwd'
    | 'isLarge'
>;

interface MutableMoneyFlowPoint extends MoneyFlowPoint {}

export const EMPTY_MONEY_FLOW_SNAPSHOT: MoneyFlowSnapshot = Object.freeze({
    revision: 0,
    overallNetTwd: 0,
    largeNetTwd: 0,
    nonLargeNetTwd: 0,
    unknownDirectionAmountTwd: 0,
    unknownDirectionCount: 0,
    unknownTrades: Object.freeze([]),
    points: Object.freeze([]),
});

function eligible(input: MoneyFlowInput): boolean {
    const [securityType, exchange] = input.contractKey.split(':');
    return securityType === 'STK'
        && (exchange === 'TSE' || exchange === 'OTC')
        && Number.isFinite(input.close)
        && input.close > 0
        && Number.isFinite(input.volume)
        && input.volume > 0
        && Number.isSafeInteger(input.tradeAmountTwd)
        && input.tradeAmountTwd > 0
        && input.intradayOdd !== true
        && input.simtrade !== true
        && input.time >= '09:00:00.000000'
        && input.time < '14:00:00.000000';
}

function minuteOf(time: string): { minute: string; minuteIndex: number } | null {
    const minute = time.slice(0, 5);
    const [hourText, minuteText] = minute.split(':');
    const hour = Number(hourText);
    const minuteNumber = Number(minuteText);
    if (!Number.isInteger(hour) || !Number.isInteger(minuteNumber)
        || hour < 0 || hour > 23 || minuteNumber < 0 || minuteNumber > 59) return null;
    return { minute, minuteIndex: hour * 60 + minuteNumber };
}

function safeAdd(left: number, right: number): number {
    const value = left + right;
    if (!Number.isSafeInteger(value)) throw new RangeError('資金流向累計金額超出安全整數範圍');
    return value;
}

export class MoneyFlowAccumulator {
    private static readonly UNKNOWN_TRADE_LIMIT = 100;
    private points: MutableMoneyFlowPoint[] = [];
    private overallNetTwd = 0;
    private largeNetTwd = 0;
    private unknownDirectionAmountTwd = 0;
    private unknownDirectionCount = 0;
    private unknownTrades: UnknownDirectionTrade[] = [];
    private revision = 0;
    private cached: MoneyFlowSnapshot = EMPTY_MONEY_FLOW_SNAPSHOT;

    append(input: MoneyFlowInput): boolean {
        if (!eligible(input)) return false;
        const minute = minuteOf(input.time);
        if (!minute) return false;
        const last = this.points.at(-1);
        if (last && minute.minuteIndex < last.minuteIndex) {
            throw new Error('資金流向成交必須依時間排序後再累計');
        }

        const sign = input.tickType === 1 ? 1 : input.tickType === 2 ? -1 : 0;
        const signedAmount = input.tradeAmountTwd * sign;
        if (!Number.isSafeInteger(signedAmount)) {
            throw new RangeError('資金流向成交金額超出安全整數範圍');
        }
        // Calculate the whole transition before mutating state so an overflow
        // cannot leave the accumulator with a partially applied trade.
        const nextOverall = safeAdd(this.overallNetTwd, signedAmount);
        const nextLarge = input.isLarge
            ? safeAdd(this.largeNetTwd, signedAmount)
            : this.largeNetTwd;
        const nextUnknownAmount = sign === 0
            ? safeAdd(this.unknownDirectionAmountTwd, input.tradeAmountTwd)
            : this.unknownDirectionAmountTwd;
        const nextUnknownCount = sign === 0
            ? safeAdd(this.unknownDirectionCount, 1)
            : this.unknownDirectionCount;
        const point: MutableMoneyFlowPoint = {
            ...minute,
            overallNetTwd: nextOverall,
            largeNetTwd: nextLarge,
            nonLargeNetTwd: safeAdd(nextOverall, -nextLarge),
        };
        this.overallNetTwd = nextOverall;
        this.largeNetTwd = nextLarge;
        this.unknownDirectionAmountTwd = nextUnknownAmount;
        this.unknownDirectionCount = nextUnknownCount;
        if (sign === 0) {
            this.unknownTrades.push({
                tradeDate: input.tradeDate, time: input.time, close: input.close,
                volume: input.volume, tickType: input.tickType,
                tradeAmountTwd: input.tradeAmountTwd, source: input.source,
            });
            if (this.unknownTrades.length > MoneyFlowAccumulator.UNKNOWN_TRADE_LIMIT) this.unknownTrades.shift();
        }
        if (last?.minuteIndex === minute.minuteIndex) this.points[this.points.length - 1] = point;
        else this.points.push(point);
        this.revision += 1;
        return true;
    }

    snapshot(): MoneyFlowSnapshot {
        if (this.cached.revision === this.revision) return this.cached;
        this.cached = {
            revision: this.revision,
            overallNetTwd: this.overallNetTwd,
            largeNetTwd: this.largeNetTwd,
            nonLargeNetTwd: safeAdd(this.overallNetTwd, -this.largeNetTwd),
            unknownDirectionAmountTwd: this.unknownDirectionAmountTwd,
            unknownDirectionCount: this.unknownDirectionCount,
            unknownTrades: this.unknownTrades.map(trade => ({ ...trade })),
            points: this.points.map((point) => ({ ...point })),
        };
        return this.cached;
    }
}
