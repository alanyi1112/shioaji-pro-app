import type { ContractBase } from './types/contract';
import type { HistoryTicks } from './types/tick';
import { allSessionEligible, orderTapeInputs } from './tick-tape-session';
import { historyTickTapeInputs, normalizeTickTapeDate, normalizeTickTapeTime, type TickTapeEventInput } from './tick-tape-large-trade';

export type TapeCoverageState = 'loading' | 'verified' | 'partial' | 'failed' | 'confirmed_empty';

export interface TapeSourceEvidence {
    snapshotChecks?: Array<number | null>;
    state: Exclude<TapeCoverageState, 'loading' | 'failed'>;
    coverage: string;
    verifiedThrough: string | null;
    gaps: string[];
    allDayCount: number;
    rangeCount: number;
    regularCount: number;
    postSessionCount: number;
    regularVolume: number;
    postSessionVolume: number;
    snapshotTotalVolume: number | null;
    commonPrefixCount?: number;
    regularAuthority?: 'equal' | 'range_tail';
}

export interface VerifiedTickTapeSource {
    inputs: TickTapeEventInput[];
    evidence: TapeSourceEvidence;
}

const columns: (keyof HistoryTicks)[] = ['datetime', 'close', 'volume', 'bid_price', 'bid_volume', 'ask_price', 'ask_volume', 'tick_type'];

function validShape(history: HistoryTicks): boolean {
    if (!Array.isArray(history.datetime)) return false;
    return columns.every(column => Array.isArray(history[column]) && history[column]!.length === history.datetime.length);
}

function rowIdentity(history: HistoryTicks, index: number): string {
    return JSON.stringify(columns.map(column => history[column]![index]));
}

function inRegularDisplaySession(datetime: string): boolean {
    const time = datetime.trim().split(/[T ]/u, 2)[1] ?? '';
    return time >= '09:00:00' && time < '14:00:00';
}

function validRow(history: HistoryTicks, index: number, date: string): boolean {
    const [rowDate = '', rowTime = ''] = history.datetime[index]!.trim().split(/[T ]/u, 2);
    return normalizeTickTapeDate(rowDate) === date
        && normalizeTickTapeTime(rowTime) !== null
        && Number.isFinite(history.close[index]) && history.close[index]! > 0
        && Number.isFinite(history.volume[index]) && history.volume[index]! > 0
        && Number.isInteger(history.tick_type[index]);
}

function historySubset(history: HistoryTicks, indexes: number[]): HistoryTicks {
    return {
        datetime: indexes.map(index => history.datetime[index]!),
        close: indexes.map(index => history.close[index]!),
        volume: indexes.map(index => history.volume[index]!),
        bid_price: indexes.map(index => history.bid_price[index]!),
        bid_volume: indexes.map(index => history.bid_volume[index]!),
        ask_price: indexes.map(index => history.ask_price[index]!),
        ask_volume: indexes.map(index => history.ask_volume[index]!),
        tick_type: indexes.map(index => history.tick_type[index]!),
        ...(history.intraday_odd ? { intraday_odd: indexes.map(index => history.intraday_odd![index]!) } : {}),
        ...(history.simtrade ? { simtrade: indexes.map(index => history.simtrade![index]!) } : {}),
    };
}

function chronologically(history: HistoryTicks): HistoryTicks {
    return historySubset(history, history.datetime.map((_, index) => index).sort((left, right) =>
        history.datetime[left]!.localeCompare(history.datetime[right]!)));
}

export function verifyTickTapeSource(args: {
    contract: ContractBase;
    date: string;
    allDay: HistoryTicks;
    range: HistoryTicks;
    snapshotTotalVolume: number | null;
    generation: number;
}): VerifiedTickTapeSource {
    const { contract, date, allDay, range, snapshotTotalVolume, generation } = args;
    if (!validShape(allDay) || !validShape(range)) throw new Error('歷史成交欄位或筆數不一致');
    if (allDay.datetime.length > 500_000 || range.datetime.length > 500_000) throw new Error('歷史成交超過 500,000 筆預算');
    const wrongDate = [...allDay.datetime, ...range.datetime].some(value => !value.startsWith(`${date}T`) && !value.startsWith(`${date} `));
    if (wrongDate) throw new Error('歷史成交回應交易日不符');
    const allRowsValid = allDay.datetime.every((_, index) => validRow(allDay, index, date))
        && range.datetime.every((_, index) => validRow(range, index, date));

    const regularIndexes: number[] = [];
    const postIndexes: number[] = [];
    for (let index = 0; index < allDay.datetime.length; index++) {
        if (inRegularDisplaySession(allDay.datetime[index]!)) regularIndexes.push(index);
        else postIndexes.push(index);
    }
    regularIndexes.sort((left, right) => allDay.datetime[left]!.localeCompare(allDay.datetime[right]!));
    const regular = historySubset(allDay, regularIndexes);
    const orderedRange = chronologically(range);
    let commonPrefixCount = 0;
    const maximumPrefix = Math.min(regular.datetime.length, orderedRange.datetime.length);
    while (commonPrefixCount < maximumPrefix
        && rowIdentity(regular, commonPrefixCount) === rowIdentity(orderedRange, commonPrefixCount)) commonPrefixCount++;
    // AllDay is requested first and RangeTime second. During a live session the
    // latter may therefore contain a strictly newer tail, but neither source
    // may omit or rewrite any row in their shared prefix.
    const rangeMatches = commonPrefixCount === regular.datetime.length
        && orderedRange.datetime.length >= regular.datetime.length
        && (regular.datetime.length > 0 || orderedRange.datetime.length === 0);
    const authoritativeRegular = rangeMatches && orderedRange.datetime.length > regular.datetime.length
        ? orderedRange
        : regular;
    const regularAuthority: TapeSourceEvidence['regularAuthority'] = rangeMatches && orderedRange.datetime.length > regular.datetime.length
        ? 'range_tail'
        : 'equal';
    const regularVolume = authoritativeRegular.volume.reduce((sum, value) => sum + value, 0);
    const postSessionVolume = postIndexes.reduce((sum, index) => sum + allDay.volume[index]!, 0);
    const allDayVolume = regularVolume + postSessionVolume;
    const snapshotValid = snapshotTotalVolume !== null && Number.isFinite(snapshotTotalVolume) && snapshotTotalVolume >= 0;
    const volumeMatches = snapshotValid && snapshotTotalVolume === allDayVolume;
    const gaps: string[] = [];
    if (!rangeMatches) gaps.push('all_day_range_mismatch');
    if (!allRowsValid) gaps.push('invalid_history_row');
    if (!snapshotValid) gaps.push('snapshot_total_unavailable');
    else if (!volumeMatches) {
        const snapshotMatchesEarlierAllDay = rangeMatches && regularAuthority === 'range_tail'
            && snapshotTotalVolume === regular.volume.reduce((sum, value) => sum + value, 0) + postSessionVolume;
        gaps.push(snapshotMatchesEarlierAllDay ? 'snapshot_behind_range_tail'
            : snapshotTotalVolume! > allDayVolume ? 'snapshot_ahead_of_history' : 'history_exceeds_snapshot');
    }

    const inputs = orderTapeInputs(historyTickTapeInputs(contract, authoritativeRegular, generation, rangeMatches && allRowsValid));
    const verifiedThrough = rangeMatches && allRowsValid && inputs.length
        ? `${inputs.at(-1)!.date}T${inputs.at(-1)!.time}`
        : null;
    const confirmedEmpty = allDay.datetime.length === 0 && range.datetime.length === 0 && snapshotTotalVolume === 0;
    const state: TapeSourceEvidence['state'] = confirmedEmpty
        ? 'confirmed_empty'
        : gaps.length === 0 ? 'verified' : 'partial';
    const coverage = state === 'confirmed_empty'
        ? '已由 AllDay、RangeTime 與 Snapshot 確認當日無成交'
        : state === 'verified'
            ? regularAuthority === 'equal'
                ? `已核實完整：AllDay／RangeTime ${inputs.length.toLocaleString('en-US')} 筆一致，成交量與 Snapshot 守恆`
                : `已核實完整：AllDay／RangeTime 共同前綴 ${commonPrefixCount.toLocaleString('en-US')} 筆一致，RangeTime 較新尾端補至 ${inputs.length.toLocaleString('en-US')} 筆，成交量與 Snapshot 守恆`
            : `部分資料：${gaps.join('、') || '來源完整性待核實'}`;
    return {
        inputs,
        evidence: {
            state, coverage, verifiedThrough, gaps,
            allDayCount: allDay.datetime.length,
            rangeCount: range.datetime.length,
            regularCount: inputs.length,
            postSessionCount: postIndexes.length,
            regularVolume, postSessionVolume,
            snapshotTotalVolume: snapshotValid ? snapshotTotalVolume : null,
            commonPrefixCount,
            regularAuthority,
        },
    };
}

export function inspectTapeContinuity(inputs: TickTapeEventInput[]) {
    const ordered = orderTapeInputs(inputs);
    let cumulative = 0;
    for (const input of ordered) {
        if (!Number.isFinite(input.sourceCumulativeVolume) || input.sourceCumulativeVolume! <= 0) {
            return { continuous: false, through: null as string | null, cumulative, reason: 'missing_source_cumulative_volume' };
        }
        cumulative += input.volume;
        if (input.sourceCumulativeVolume !== cumulative) {
            return { continuous: false, through: null as string | null, cumulative, reason: 'source_cumulative_volume_gap' };
        }
    }
    return { continuous: true, through: ordered.length ? `${ordered.at(-1)!.date}T${ordered.at(-1)!.time}` : null, cumulative, reason: null };
}
