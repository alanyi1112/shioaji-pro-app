import type { Counts, Criteria, HolderMode, ReasonCode, ScreenerAnchors, ScreenerMarket, UniverseStock, Verdict } from './stock-screener-domain';

export type ScreenerSort = 'code' | 'volumeMultiple' | 'turnover' | 'holderChange' | 'holderStreak';
export type ScreenerState = 'ready' | 'partial' | 'pending' | 'stale' | 'unavailable';
export interface TurnoverEvidence {
    ntd: string | null;
    wan: string | null;
    date: string | null;
    signalVerdict: Verdict | null;
    verdict: Verdict | null;
    reason: ReasonCode | null;
}
export interface ScreenerResultRow extends UniverseStock {
    verdict: Verdict;
    volume: { current: string | null; previous: string | null; multiple: number | null; reason: ReasonCode | null; turnover: TurnoverEvidence };
    holder: { mode: HolderMode; current: string | null; previous: string | null; changePp: number | null; reason: ReasonCode | null;
        streakWeeks: number | null; changesPp: number[]; series: { date: string; ratio: string }[]; turnover: TurnoverEvidence };
    sources: string[];
}
export interface ScreenerResponse {
    version: 2;
    state: ScreenerState;
    reason: string;
    snapshotId: string | null;
    universeRevision: string | null;
    formulaVersion: 'after-market-v2';
    criteriaFingerprint: string | null;
    expectedSessionDate: string | null;
    createdAt: string | null;
    anchors: ScreenerAnchors;
    counts: Counts | null;
    byMarket: Record<ScreenerMarket, Counts> | null;
    rows: ScreenerResultRow[];
    nextCursor: string | null;
}
export interface ScreenerQuery {
    criteria: Criteria;
    sort: ScreenerSort;
    direction: 'asc' | 'desc';
    resultState: Verdict;
    cursor?: string;
}
export function screenerSearch(query: ScreenerQuery): string {
    const { criteria } = query;
    const params = new URLSearchParams({
        version: '2', mode: criteria.mode, volume: String(criteria.volume.enabled), volumeThreshold: criteria.volume.threshold,
        volumeTurnover: String(criteria.volume.turnover.enabled), volumeTurnoverMinimumWan: criteria.volume.turnover.minimumWan,
        holder: String(criteria.holder.enabled), holderThreshold: criteria.holder.threshold, holderMode: criteria.holder.mode,
        holderStreakWeeks: String(criteria.holder.streakWeeks), holderTurnover: String(criteria.holder.turnover.enabled),
        holderTurnoverMinimumWan: criteria.holder.turnover.minimumWan,
        sort: query.sort, direction: query.direction, resultState: query.resultState, limit: '50',
    });
    if (query.cursor) params.set('cursor', query.cursor);
    return params.toString();
}

const formatWan = (ntd: string | null): string | null => {
    if (ntd === null || !/^(?:0|[1-9]\d*)$/.test(ntd)) return null;
    const amount = BigInt(ntd), whole = amount / BigInt(10000);
    const fraction = String(amount % BigInt(10000)).padStart(4, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
};
export const turnoverEvidence = (ntd: string | null, date: string | null, signalVerdict: Verdict | null,
    verdict: Verdict | null, reason: ReasonCode | null): TurnoverEvidence => ({ ntd, wan: formatWan(ntd), date, signalVerdict, verdict, reason });
