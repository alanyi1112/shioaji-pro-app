import { effectiveCriteria, type Counts, type Criteria, type HolderMode, type ReasonCode, type ScreenerAnchors, type ScreenerMarket, type UniverseStock, type Verdict } from './stock-screener-domain.ts';
import type {
    CriteriaV3, ScreenerTechnicalAnchors, ScreenerV3Counts, ScreenerV3Progress,
    TechnicalOutcome, FractalEvidence, BollReversalEvidence, TechnicalSort,
} from './stock-screener-technical-patterns';
import { DIVERGENCE_SOURCES, effectiveCriteriaV4, MA_MODES, SCREENER_V4_FORMULA_VERSION,
    V4_UNKNOWN_REASONS, validateScreenerV4Progress, type CriteriaV4, type DivergenceEvidence, type MaSignalEvidence,
    type ScreenerV4Counts, type ScreenerV4Progress, type V4Outcome } from './stock-screener-v4.ts';
import { SCREENER_OHLCV_V4_MAPPING_VERSION } from './stock-screener-ohlcv.ts';
import { effectiveCriteriaV5, SCREENER_CHIP_MAPPING_VERSION, SCREENER_V5_FORMULA_VERSION,
    type ChipOutcomesV5, type CriteriaV5 } from './stock-screener-v5.ts';
import { parseScreenerSessionReadiness, type ScreenerSessionReadiness } from './stock-screener-session-readiness.ts';

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
    volume: { current: string | null; previous: string | null; currentDate: string | null; previousDate: string | null;
        multiple: number | null; reason: ReasonCode | null; turnover: TurnoverEvidence };
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
    effectiveSessionDate?: string | null;
    sessionReadiness?: ScreenerSessionReadiness | null;
    createdAt: string | null;
    anchors: ScreenerAnchors;
    counts: Counts | null;
    byMarket: Record<ScreenerMarket, Counts> | null;
    rows: ScreenerResultRow[];
    nextCursor: string | null;
}
export type ScreenerSortV3 = ScreenerSort | TechnicalSort;
export interface ScreenerResultRowV3 extends ScreenerResultRow {
    technical: {
        fractal: TechnicalOutcome<FractalEvidence> | null;
        bollReversal: TechnicalOutcome<BollReversalEvidence> | null;
    };
}
export interface ScreenerResponseV3 {
    version: 3;
    state: ScreenerState;
    reason: string;
    snapshotId: string | null;
    universeRevision: string | null;
    formulaVersion: string;
    criteriaFingerprint: string | null;
    expectedSessionDate: string | null;
    effectiveSessionDate?: string | null;
    sessionReadiness?: ScreenerSessionReadiness | null;
    createdAt: string | null;
    anchors: ScreenerAnchors;
    technicalAnchors: ScreenerTechnicalAnchors | null;
    counts: ScreenerV3Counts | null;
    byMarket: Record<ScreenerMarket, ScreenerV3Counts> | null;
    preparation: ScreenerV3Progress | null;
    rows: ScreenerResultRowV3[];
    nextCursor: string | null;
}
export type ScreenerSortV4 = ScreenerSortV3 | 'maSpread' | 'pivotDate' | 'priceDifference';
export interface ScreenerResultRowV4 extends ScreenerResultRowV3 {
    technicalV4: {
        ma: V4Outcome<MaSignalEvidence> | null;
        divergence: V4Outcome<DivergenceEvidence> | null;
        evidenceHash: string;
    };
}
export interface ScreenerResponseV4 {
    version: 4;
    state: ScreenerState;
    reason: string;
    snapshotId: string | null;
    universeRevision: string | null;
    formulaVersion: string;
    sourceMappingVersion: string;
    criteriaFingerprint: string | null;
    expectedSessionDate: string | null;
    effectiveSessionDate: string | null;
    sessionReadiness?: ScreenerSessionReadiness | null;
    createdAt: string | null;
    anchors: ScreenerAnchors;
    technicalAnchors: ScreenerTechnicalAnchors | null;
    counts: ScreenerV4Counts | null;
    byMarket: Record<ScreenerMarket, ScreenerV4Counts> | null;
    preparation: ScreenerV4Progress | null;
    rows: ScreenerResultRowV4[];
    nextCursor: string | null;
}
export type ScreenerSortV5 = ScreenerSortV4 | 'largeHolderRatio' | 'trustOwnershipPct' | 'shortMarginRatio' | 'closeHighDays' | 'smaPeriod';
export interface ScreenerV5Counts extends Omit<ScreenerV4Counts, 'missingByCondition'> {
    missingByCondition: ScreenerV4Counts['missingByCondition'] & Record<import('./stock-screener-v5.ts').ChipConditionKey, number>;
}
export interface ScreenerResultRowV5 extends ScreenerResultRowV4 {
    chipV5: { outcomes: ChipOutcomesV5; evidenceHash: string; dailyThrough: string; weeklyThrough: string | null };
}
export interface ScreenerResponseV5 extends Omit<ScreenerResponseV4, 'version' | 'rows' | 'sourceMappingVersion' | 'counts' | 'byMarket'> {
    version: 5;
    sourceMappingVersion: typeof SCREENER_CHIP_MAPPING_VERSION;
    formulaVersion: typeof SCREENER_V5_FORMULA_VERSION;
    chipCoverage: { daily: Record<'TWSE' | 'TPEx', { target: number; institutional: number; margin: number }>;
        tdcc: { target: number; covered: number }; issuedShares: { target: number; valid: number; missing: number } } | null;
    rows: ScreenerResultRowV5[];
    counts: ScreenerV5Counts | null;
    byMarket: Record<ScreenerMarket, ScreenerV5Counts> | null;
}
export interface ScreenerQuery {
    criteria: Criteria;
    sort: ScreenerSort;
    direction: 'asc' | 'desc';
    resultState: Verdict;
    cursor?: string;
}
export interface ScreenerQueryV3 {
    criteria: CriteriaV3;
    sort: ScreenerSortV3;
    direction: 'asc' | 'desc';
    resultState: Verdict;
    cursor?: string;
}
export interface ScreenerQueryV4 {
    criteria: CriteriaV4;
    sort: ScreenerSortV4;
    direction: 'asc' | 'desc';
    resultState: Verdict;
    cursor?: string;
}
export interface ScreenerQueryV5 {
    criteria: CriteriaV5;
    sort: ScreenerSortV5;
    direction: 'asc' | 'desc';
    resultState: Verdict;
    cursor?: string;
}
export function screenerSearch(query: ScreenerQuery): string {
    const criteria = effectiveCriteria(query.criteria);
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

export function screenerSearchV3(query: ScreenerQueryV3): string {
    const criteria = effectiveCriteria(query.criteria) as CriteriaV3;
    const params = new URLSearchParams({
        version: '3', mode: criteria.mode, volume: String(criteria.volume.enabled), volumeThreshold: criteria.volume.threshold,
        volumeTurnover: String(criteria.volume.turnover.enabled), volumeTurnoverMinimumWan: criteria.volume.turnover.minimumWan,
        holder: String(criteria.holder.enabled), holderThreshold: criteria.holder.threshold, holderMode: criteria.holder.mode,
        holderStreakWeeks: String(criteria.holder.streakWeeks), holderTurnover: String(criteria.holder.turnover.enabled),
        holderTurnoverMinimumWan: criteria.holder.turnover.minimumWan,
        fractal: String(criteria.fractal.enabled), fractalAlgorithm: criteria.fractal.algorithm, fractalDirection: criteria.fractal.direction,
        bollReversal: String(criteria.bollReversal.enabled), bollMode: criteria.bollReversal.mode,
        sort: query.sort, direction: query.direction, resultState: query.resultState, limit: '50',
    });
    if (query.cursor) params.set('cursor', query.cursor);
    return params.toString();
}

export function screenerSearchV4(query: ScreenerQueryV4): string {
    const criteria = effectiveCriteriaV4(query.criteria);
    const params = new URLSearchParams({
        version: '4', mode: criteria.mode, volume: String(criteria.volume.enabled), volumeThreshold: criteria.volume.threshold,
        volumeTurnover: String(criteria.volume.turnover.enabled), volumeTurnoverMinimumWan: criteria.volume.turnover.minimumWan,
        holder: String(criteria.holder.enabled), holderThreshold: criteria.holder.threshold, holderMode: criteria.holder.mode,
        holderStreakWeeks: String(criteria.holder.streakWeeks), holderTurnover: String(criteria.holder.turnover.enabled),
        holderTurnoverMinimumWan: criteria.holder.turnover.minimumWan,
        fractal: String(criteria.fractal.enabled), fractalAlgorithm: criteria.fractal.algorithm, fractalDirection: criteria.fractal.direction,
        bollReversal: String(criteria.bollReversal.enabled), bollMode: criteria.bollReversal.mode,
        ma: String(criteria.ma.enabled), maMode: criteria.ma.mode, compressionDays: String(criteria.ma.compressionDays),
        maxSpreadPct: criteria.ma.maxSpreadPct, divergence: String(criteria.divergence.enabled),
        divergenceSource: criteria.divergence.source, divergenceDirection: criteria.divergence.direction,
        requireZeroReset: String(criteria.divergence.requireZeroReset),
        sort: query.sort, direction: query.direction, resultState: query.resultState, limit: '50',
    });
    if (query.cursor) params.set('cursor', query.cursor);
    return params.toString();
}

export function screenerSearchV5(query: ScreenerQueryV5): string {
    const criteria = effectiveCriteriaV5(query.criteria);
    const base = new URLSearchParams(screenerSearchV4({ ...query, criteria, sort: query.sort as ScreenerSortV4 }));
    base.set('version', '5');
    const set = (prefix: string, row: object) => Object.entries(row).forEach(([key, value]) =>
        base.set(`${prefix}${key[0]!.toUpperCase()}${key.slice(1)}`, String(value)));
    set('largeHolderTrend', criteria.largeHolderTrend);
    set('largeHolderConcentration', criteria.largeHolderConcentration);
    set('retailHolderDecline', criteria.retailHolderDecline);
    set('trustOwnership', criteria.trustOwnership);
    set('priceMargin', criteria.priceMargin);
    set('shortMarginRatio', criteria.shortMarginRatio);
    set('closeHigh', criteria.closeHigh);
    set('closeSmaBreakout', criteria.closeSmaBreakout);
    base.set('sort', query.sort);
    return base.toString();
}

const formatWan = (ntd: string | null): string | null => {
    if (ntd === null || !/^(?:0|[1-9]\d*)$/.test(ntd)) return null;
    const amount = BigInt(ntd), whole = amount / BigInt(10000);
    const fraction = String(amount % BigInt(10000)).padStart(4, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
};
export const turnoverEvidence = (ntd: string | null, date: string | null, signalVerdict: Verdict | null,
    verdict: Verdict | null, reason: ReasonCode | null): TurnoverEvidence => ({ ntd, wan: formatWan(ntd), date, signalVerdict, verdict, reason });

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const iso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const verdict = (value: unknown): value is Verdict => ['pass', 'fail', 'unknown'].includes(String(value));
function validCounts(value: unknown, version: 3 | 4 | 5): boolean {
    if (!object(value)) return false;
    const total = value.total, evaluated = value.evaluated, matched = value.matched, notMatched = value.notMatched, unknown = value.unknown;
    if (![total, evaluated, matched, notMatched, unknown].every((item) => Number.isInteger(item) && Number(item) >= 0)
        || Number(matched) + Number(notMatched) + Number(unknown) !== Number(total)
        || Number(evaluated) !== Number(matched) + Number(notMatched) || !object(value.missingByCondition)) return false;
    const keys = version === 5 ? ['volume-multiple', 'large-holder-weekly-pp', 'fractal', 'boll-reversal', 'ma', 'divergence',
        'largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership', 'priceMargin',
        'shortMarginRatio', 'closeHigh', 'closeSmaBreakout']
        : version === 4 ? ['volume-multiple', 'large-holder-weekly-pp', 'fractal', 'boll-reversal', 'ma', 'divergence']
        : ['volume-multiple', 'large-holder-weekly-pp', 'fractal', 'boll-reversal'];
    const missing = value.missingByCondition as Record<string, unknown>;
    return keys.every((key) => Number.isInteger(missing[key]) && Number(missing[key]) >= 0);
}
function validOutcome(value: unknown, kind: 'ma' | 'divergence'): boolean {
    if (!object(value) || !verdict(value.verdict) || !V4_UNKNOWN_REASONS.includes(value.reason as never)
        || (value.verdict === 'unknown') !== (value.reason !== 'none')) return false;
    if (value.verdict === 'unknown') return value.evidence === undefined;
    if (value.evidence === undefined) return value.verdict === 'fail';
    if (!object(value.evidence)) return false;
    if (kind === 'ma') {
        const current = value.evidence.current, previous = value.evidence.previous;
        const point = (candidate: unknown) => object(candidate) && iso(candidate.sessionDate)
            && typeof candidate.close === 'string' && /^\d+(?:\.\d+)?$/.test(candidate.close)
            && [candidate.sma5, candidate.sma10, candidate.sma20, candidate.spreadPct, candidate.gap].every(finite);
        return MA_MODES.slice(0, 4).includes(value.evidence.mode as never)
            && object(current) && object(previous) && point(current) && point(previous)
            && String(previous.sessionDate) < String(current.sessionDate) && [current.sma5, current.sma10, current.sma20, current.spreadPct,
                previous.sma5, previous.sma10, previous.sma20, previous.spreadPct].every(finite)
            && Array.isArray(value.evidence.compressionWindow) && value.evidence.compressionWindow.length >= 2
            && value.evidence.compressionWindow.length <= 10 && value.evidence.compressionWindow.every(point)
            && iso(value.evidence.compressionEnd)
            && value.evidence.compressionEnd === value.evidence.compressionWindow.at(-1)?.sessionDate;
    }
    const first = value.evidence.first, second = value.evidence.second;
    return object(first) && object(second) && iso(first.sessionDate) && iso(second.sessionDate)
        && iso(first.confirmationDate) && iso(second.confirmationDate) && first.sessionDate < second.sessionDate
        && first.sessionDate <= first.confirmationDate && second.sessionDate <= second.confirmationDate
        && typeof first.price === 'string' && /^\d+(?:\.\d+)?$/.test(first.price)
        && typeof second.price === 'string' && /^\d+(?:\.\d+)?$/.test(second.price)
        && finite(first.indicator) && finite(second.indicator) && finite(value.evidence.priceDifferencePct)
        && Number(value.evidence.priceDifferencePct) >= 1
        && Number.isInteger(value.evidence.distanceSessions) && Number(value.evidence.distanceSessions) >= 5
        && Number(value.evidence.distanceSessions) <= 30
        && DIVERGENCE_SOURCES.includes(value.evidence.source as never)
        && ['bullish', 'bearish'].includes(String(value.evidence.direction))
        && typeof value.evidence.zeroResetRequired === 'boolean'
        && (value.evidence.zeroResetMet === null || typeof value.evidence.zeroResetMet === 'boolean')
        && value.evidence.sourceMappingVersion === SCREENER_OHLCV_V4_MAPPING_VERSION
        && (value.evidence.source === 'obv' ? value.evidence.volumeUnit === 'shares' : value.evidence.volumeUnit === undefined);
}

/** Browser trust boundary for immutable screener responses. Throws before stale/forged rows reach UI actions. */
export function decodeScreenerResponse(value: unknown): ScreenerResponseV3 | ScreenerResponseV4 | ScreenerResponseV5 {
    if (!object(value) || ![3, 4, 5].includes(Number(value.version))
        || !['ready', 'partial', 'pending', 'stale', 'unavailable'].includes(String(value.state))
        || !Array.isArray(value.rows) || !(value.snapshotId === null || typeof value.snapshotId === 'string')
        || !(value.createdAt === null || Number.isFinite(Date.parse(String(value.createdAt))))) throw new Error('invalid_screener_response');
    const version = value.version as 3 | 4 | 5;
    if (value.sessionReadiness !== undefined && value.sessionReadiness !== null) {
        try { if (!parseScreenerSessionReadiness(value.sessionReadiness)) throw new Error('invalid'); }
        catch { throw new Error('invalid_screener_response'); }
    }
    if (version === 4 && (value.formulaVersion !== SCREENER_V4_FORMULA_VERSION
        || value.sourceMappingVersion !== SCREENER_OHLCV_V4_MAPPING_VERSION
        || !(value.preparation === null || validateScreenerV4Progress(value.preparation as ScreenerV4Progress)))) {
        throw new Error('invalid_screener_response');
    }
    if (version === 5 && (value.formulaVersion !== SCREENER_V5_FORMULA_VERSION
        || value.sourceMappingVersion !== SCREENER_CHIP_MAPPING_VERSION)) throw new Error('invalid_screener_response');
    if (version >= 4 && ['pending', 'unavailable', 'stale'].includes(String(value.state)) && value.rows.length !== 0) {
        throw new Error('invalid_screener_response');
    }
    if (value.counts !== null && !validCounts(value.counts, version)) throw new Error('invalid_screener_response');
    if (value.byMarket !== null && (!object(value.byMarket) || !validCounts(value.byMarket.TWSE, version)
        || !validCounts(value.byMarket.TPEx, version))) throw new Error('invalid_screener_response');
    if (value.technicalAnchors !== null) {
        if (!object(value.technicalAnchors) || !Array.isArray(value.technicalAnchors.sessions)
            || !value.technicalAnchors.sessions.every(iso) || !iso(value.technicalAnchors.through)
            || value.technicalAnchors.through !== value.technicalAnchors.sessions.at(-1)
            || version >= 4 && value.technicalAnchors.sessions.length !== 130) throw new Error('invalid_screener_response');
    }
    for (const candidate of value.rows) {
        if (!object(candidate) || typeof candidate.code !== 'string' || typeof candidate.symbol !== 'string' || !verdict(candidate.verdict)) throw new Error('invalid_screener_response');
        if (version >= 4) {
            if (!object(candidate.technicalV4) || !/^[a-f0-9]{64}$/.test(String(candidate.technicalV4.evidenceHash))
                || !(candidate.technicalV4.ma === null || validOutcome(candidate.technicalV4.ma, 'ma'))
                || !(candidate.technicalV4.divergence === null || validOutcome(candidate.technicalV4.divergence, 'divergence'))) {
                throw new Error('invalid_screener_response');
            }
        }
        if (version === 5 && (!object(candidate.chipV5) || !object(candidate.chipV5.outcomes)
            || !/^[a-f0-9]{64}$/.test(String(candidate.chipV5.evidenceHash)))) throw new Error('invalid_screener_response');
    }
    return value as unknown as ScreenerResponseV3 | ScreenerResponseV4 | ScreenerResponseV5;
}
