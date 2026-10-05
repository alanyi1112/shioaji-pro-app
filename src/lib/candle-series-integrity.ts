import type { Candle } from './types/market';

export type CandleTimelineIssue = Readonly<{
    reason: 'invalid_time' | 'duplicate_time' | 'unordered_time';
    index: number;
    time: number;
    previousTime?: number;
}>;

/** Never sort/merge snapshots here: conflicting OHLCV must not be invented. */
export function candleTimelineIssue(bars: readonly Candle[]): CandleTimelineIssue | null {
    for (let index = 0; index < bars.length; index++) {
        const time = bars[index]!.time;
        const previousTime = bars[index - 1]?.time;
        if (!Number.isFinite(time) || !Number.isInteger(time)) {
            return { reason: 'invalid_time', index, time };
        }
        if (previousTime !== undefined && time <= previousTime) {
            return { reason: time === previousTime ? 'duplicate_time' : 'unordered_time', index, time, previousTime };
        }
    }
    return null;
}

export function requireCandleTimeline(bars: readonly Candle[]): void {
    const issue = candleTimelineIssue(bars);
    if (issue) throw new Error(`candle_timeline:${issue.reason}:index=${issue.index}:time=${issue.time}:previous=${issue.previousTime ?? 'none'}`);
}

/** One submission, at most one rollback; never performs network retries. */
export function commitCandleSeries(
    bars: readonly Candle[],
    commit: (bars: readonly Candle[]) => void,
    previous: readonly Candle[],
    onFailure: (error: unknown) => void,
): boolean {
    try {
        requireCandleTimeline(bars);
    } catch (error) {
        onFailure(error);
        return false;
    }
    try {
        commit(bars);
        return true;
    } catch (error) {
        try {
            requireCandleTimeline(previous);
            commit(previous);
        } catch {
            // The original error remains the diagnostic authority.
        }
        onFailure(error);
        return false;
    }
}
