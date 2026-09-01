/** 收盤後選股 v3 技術型態純函式；不得在此模組抓行情、寫 D1 或觸發交易。 */
import { bollinger, REFERENCE_FORMULA_VERSION } from './indicators.ts';
import {
    combineVerdicts, DEFAULT_CRITERIA, hundredths, isIsoDate,
    turnoverWanToNtd, validateCriteria,
    type Counts, type Criteria, type Provenance, type ScreenerAnchors,
    type ScreenerInput, type UniverseStock, type Verdict,
} from './stock-screener-domain.ts';
import type { Candle } from './types/market.ts';
import {
    canonicalPriceUnits as priceUnits, SCREENER_OHLC_MAPPING_VERSION, SCREENER_PRICE_BASIS,
    validateCanonicalOhlc, validateCanonicalOhlcSeries,
    type CanonicalOhlc, type SourcedOhlc,
} from './stock-screener-ohlcv.ts';

export {
    SCREENER_OHLC_MAPPING_VERSION, SCREENER_PRICE_BASIS,
    validateCanonicalOhlc, validateCanonicalOhlcSeries,
} from './stock-screener-ohlcv.ts';
export type { CanonicalOhlc, SourcedOhlc } from './stock-screener-ohlcv.ts';

export const SCREENER_V3_VERSION = 3 as const;
export const SCREENER_V3_SCHEMA_VERSION = 3 as const;
export const SCREENER_V3_FORMULA_VERSION = `after-market-v3-technical-${REFERENCE_FORMULA_VERSION}` as const;

export type FractalAlgorithm = 'raw-three' | 'chan-containment' | 'any';
export type FractalDirection = 'bottom' | 'top' | 'any';
export type BollReversalMode = 'lower-bullish' | 'upper-bearish' | 'any';
export type TechnicalUnknownReason =
    | 'missing_ohlcv' | 'invalid_ohlcv' | 'insufficient_history'
    | 'non_adjacent_sessions' | 'containment_direction_unknown';
export type TechnicalReason = 'none' | TechnicalUnknownReason;
export type TechnicalSort = 'confirmationDate' | 'algorithm' | 'direction' | 'outsideDistance';
export const TECHNICAL_UNKNOWN_REASONS = [
    'missing_ohlcv', 'invalid_ohlcv', 'insufficient_history',
    'non_adjacent_sessions', 'containment_direction_unknown',
] as const satisfies readonly TechnicalUnknownReason[];

export interface FractalCriteria {
    enabled: boolean;
    algorithm: FractalAlgorithm;
    direction: FractalDirection;
}
export interface BollReversalCriteria {
    enabled: boolean;
    mode: BollReversalMode;
}
export interface CriteriaV3 extends Criteria {
    fractal: FractalCriteria;
    bollReversal: BollReversalCriteria;
}
export const DEFAULT_CRITERIA_V3: CriteriaV3 = {
    ...DEFAULT_CRITERIA,
    volume: { ...DEFAULT_CRITERIA.volume, turnover: { ...DEFAULT_CRITERIA.volume.turnover } },
    holder: { ...DEFAULT_CRITERIA.holder, turnover: { ...DEFAULT_CRITERIA.holder.turnover } },
    fractal: { enabled: false, algorithm: 'any', direction: 'any' },
    bollReversal: { enabled: false, mode: 'any' },
};

export interface NormalizedChanBar {
    high: string;
    low: string;
    rawFrom: string;
    rawTo: string;
    rawDates: string[];
}
export interface FractalEvidence {
    algorithm: Exclude<FractalAlgorithm, 'any'>;
    direction: Exclude<FractalDirection, 'any'>;
    centerDate: string;
    confirmationDate: string;
    bars: Array<Pick<CanonicalOhlc, 'sessionDate' | 'high' | 'low'>>;
    normalizedBars?: NormalizedChanBar[];
}
export interface BollBandEvidence {
    sessionDate: string;
    open: string;
    high: string;
    low: string;
    close: string;
    upper: number;
    middle: number;
    lower: number;
}
export interface BollReversalEvidence {
    mode: Exclude<BollReversalMode, 'any'>;
    previous: BollBandEvidence;
    current: BollBandEvidence;
    lowerShadow: boolean;
    upperShadow: boolean;
    outsideDistance: number;
}
export interface TechnicalOutcome<E> {
    verdict: Verdict;
    reason: TechnicalReason;
    evidence?: E;
}
export interface TechnicalSnapshotEvidence {
    rawBottom: TechnicalOutcome<FractalEvidence>;
    rawTop: TechnicalOutcome<FractalEvidence>;
    chanBottom: TechnicalOutcome<FractalEvidence>;
    chanTop: TechnicalOutcome<FractalEvidence>;
    lowerBullish: TechnicalOutcome<BollReversalEvidence>;
    upperBearish: TechnicalOutcome<BollReversalEvidence>;
    evidenceHash: string;
}
export interface ScreenerInputV3 extends ScreenerInput {
    technical: TechnicalSnapshotEvidence;
}
export interface ScreenerTechnicalAnchors {
    sessions: string[];
    through: string;
}
export interface ScreenerV3Progress {
    version: 3;
    target: number;
    processed: number;
    remaining: number;
    failed: number;
    overdue: number;
    cursor: string | null;
    markets: Record<UniverseStock['market'], { target: number; processed: number; failed: number }>;
}
export interface ScreenerV3Metadata {
    version: 3;
    schemaVersion: 3;
    formulaVersion: typeof SCREENER_V3_FORMULA_VERSION;
    anchors: ScreenerAnchors;
    technicalAnchors: ScreenerTechnicalAnchors;
    baseSnapshotId: string;
    receiptsHash: string;
    universeRevision: string;
    total: number;
    validThrough: string;
    sourceReview: 'verified';
    progress: ScreenerV3Progress;
    counts: ScreenerV3Counts;
}
export interface ScreenerV3Counts extends Omit<Counts, 'missingByCondition'> {
    missingByCondition: Counts['missingByCondition'] & {
        fractal: number;
        'boll-reversal': number;
    };
}
export interface ScreenerCursorV3 {
    version: 3;
    snapshotId: string;
    offset: number;
    fingerprint: string;
}
export interface ScreenerPreferenceV3 {
    version: 3;
    query: {
        criteria: CriteriaV3;
        sort: TechnicalSort | 'code' | 'volumeMultiple' | 'turnover' | 'holderChange' | 'holderStreak';
        direction: 'asc' | 'desc';
        resultState: Verdict;
    };
}
export type ScreenerQueryV3 = ScreenerPreferenceV3['query'] & {
    version: 3;
    limit: number;
    cursor?: ScreenerCursorV3;
};
export interface ScreenerResultV3 extends UniverseStock {
    verdict: Verdict;
    technical: {
        fractal: TechnicalOutcome<FractalEvidence> | null;
        bollReversal: TechnicalOutcome<BollReversalEvidence> | null;
    };
}
export interface ScreenerResponseV3 {
    version: 3;
    state: 'ready' | 'partial' | 'pending' | 'stale' | 'unavailable';
    reason: string;
    snapshotId: string | null;
    universeRevision: string | null;
    formulaVersion: typeof SCREENER_V3_FORMULA_VERSION;
    criteriaFingerprint: string | null;
    expectedSessionDate: string | null;
    createdAt: string | null;
    anchors: ScreenerAnchors;
    technicalAnchors: ScreenerTechnicalAnchors | null;
    counts: ScreenerV3Counts | null;
    byMarket: Record<UniverseStock['market'], ScreenerV3Counts> | null;
    preparation: ScreenerV3Progress | null;
    rows: ScreenerResultV3[];
    nextCursor: string | null;
}

const priceNumber = (value: string): number => Number(priceUnits(value)) / 1_000_000;

function windowForSessions(bars: readonly CanonicalOhlc[], sessions: readonly string[], count: number): TechnicalOutcome<CanonicalOhlc[]> {
    if (!Number.isInteger(count) || count < 1 || sessions.some((date) => !isIsoDate(date))
        || new Set(sessions).size !== sessions.length
        || sessions.some((date, index) => index > 0 && date <= sessions[index - 1]!)) return { verdict: 'unknown', reason: 'non_adjacent_sessions' };
    if (sessions.length < count) return { verdict: 'unknown', reason: 'insufficient_history' };
    if (bars.length && !validateCanonicalOhlcSeries(bars)) return { verdict: 'unknown', reason: 'invalid_ohlcv' };
    const expected = sessions.slice(-count);
    const byDate = new Map(bars.map((bar) => [bar.sessionDate, bar]));
    const selected = expected.map((date) => byDate.get(date));
    if (selected.some((bar) => !bar)) return { verdict: 'unknown', reason: 'missing_ohlcv' };
    return { verdict: 'pass', reason: 'none', evidence: selected as CanonicalOhlc[] };
}

const relation = (left: Pick<CanonicalOhlc, 'high' | 'low'>, middle: Pick<CanonicalOhlc, 'high' | 'low'>,
    right: Pick<CanonicalOhlc, 'high' | 'low'>, direction: Exclude<FractalDirection, 'any'>) => {
    const ah = priceUnits(left.high)!, al = priceUnits(left.low)!;
    const bh = priceUnits(middle.high)!, bl = priceUnits(middle.low)!;
    const ch = priceUnits(right.high)!, cl = priceUnits(right.low)!;
    return direction === 'top'
        ? bh > ah && bh > ch && bl > al && bl > cl
        : bl < al && bl < cl && bh < ah && bh < ch;
};

function chooseDirectional<E extends { direction: Exclude<FractalDirection, 'any'> }>(
    requested: FractalDirection, bottom: TechnicalOutcome<E>, top: TechnicalOutcome<E>,
): TechnicalOutcome<E> {
    if (requested === 'bottom') return bottom;
    if (requested === 'top') return top;
    const verdict = combineVerdicts([bottom.verdict, top.verdict], 'any');
    const chosen = bottom.verdict === 'pass' ? bottom : top.verdict === 'pass' ? top : undefined;
    const reason = verdict === 'unknown' ? (bottom.verdict === 'unknown' ? bottom.reason : top.reason) : 'none';
    return { verdict, reason, ...(chosen?.evidence ? { evidence: chosen.evidence } : {}) };
}

export function evaluateRawFractal(
    bars: readonly CanonicalOhlc[], sessions: readonly string[], direction: FractalDirection,
): TechnicalOutcome<FractalEvidence> {
    if (!['bottom', 'top', 'any'].includes(direction)) throw new Error('invalid_fractal_direction');
    const selected = windowForSessions(bars, sessions, 3);
    if (!selected.evidence) return { verdict: 'unknown', reason: selected.reason };
    const [left, center, right] = selected.evidence;
    const one = (value: Exclude<FractalDirection, 'any'>): TechnicalOutcome<FractalEvidence> => ({
        verdict: relation(left!, center!, right!, value) ? 'pass' : 'fail', reason: 'none',
        evidence: { algorithm: 'raw-three', direction: value, centerDate: center!.sessionDate,
            confirmationDate: right!.sessionDate, bars: selected.evidence!.map(({ sessionDate, high, low }) => ({ sessionDate, high, low })) },
    });
    return chooseDirectional(direction, one('bottom'), one('top'));
}

const contains = (a: Pick<CanonicalOhlc, 'high' | 'low'>, b: Pick<CanonicalOhlc, 'high' | 'low'>) => {
    const ah = priceUnits(a.high)!, al = priceUnits(a.low)!, bh = priceUnits(b.high)!, bl = priceUnits(b.low)!;
    return (ah >= bh && al <= bl) || (bh >= ah && bl <= al);
};

export function normalizeChanContainment(bars: readonly CanonicalOhlc[]): { bars: NormalizedChanBar[]; reason: TechnicalReason } {
    if (!validateCanonicalOhlcSeries(bars)) return { bars: [], reason: 'invalid_ohlcv' };
    const output: NormalizedChanBar[] = [];
    let trend: 'up' | 'down' | null = null;
    for (const raw of bars) {
        const current: NormalizedChanBar = { high: raw.high, low: raw.low, rawFrom: raw.sessionDate, rawTo: raw.sessionDate, rawDates: [raw.sessionDate] };
        const previous = output.at(-1);
        if (!previous) { output.push(current); continue; }
        if (!contains(previous, current)) {
            const ph = priceUnits(previous.high)!, pl = priceUnits(previous.low)!;
            const ch = priceUnits(current.high)!, cl = priceUnits(current.low)!;
            if (ch > ph && cl > pl) trend = 'up';
            else if (ch < ph && cl < pl) trend = 'down';
            else return { bars: [], reason: 'containment_direction_unknown' };
            output.push(current);
            continue;
        }
        if (!trend) return { bars: [], reason: 'containment_direction_unknown' };
        previous.high = trend === 'up'
            ? (priceUnits(previous.high)! >= priceUnits(current.high)! ? previous.high : current.high)
            : (priceUnits(previous.high)! <= priceUnits(current.high)! ? previous.high : current.high);
        previous.low = trend === 'up'
            ? (priceUnits(previous.low)! >= priceUnits(current.low)! ? previous.low : current.low)
            : (priceUnits(previous.low)! <= priceUnits(current.low)! ? previous.low : current.low);
        previous.rawTo = raw.sessionDate;
        previous.rawDates.push(raw.sessionDate);
    }
    return { bars: output, reason: 'none' };
}

export function evaluateChanFractal(
    bars: readonly CanonicalOhlc[], sessions: readonly string[], direction: FractalDirection,
): TechnicalOutcome<FractalEvidence> {
    if (!['bottom', 'top', 'any'].includes(direction)) throw new Error('invalid_fractal_direction');
    const selected = windowForSessions(bars, sessions, Math.min(60, sessions.length));
    if (!selected.evidence) return { verdict: 'unknown', reason: selected.reason };
    const normalized = normalizeChanContainment(selected.evidence);
    if (normalized.reason !== 'none') return { verdict: 'unknown', reason: normalized.reason };
    if (normalized.bars.length < 3) return { verdict: 'unknown', reason: 'insufficient_history' };
    const last = normalized.bars.slice(-3);
    if (last[2]!.rawTo !== sessions.at(-1)) return { verdict: 'unknown', reason: 'missing_ohlcv' };
    const one = (value: Exclude<FractalDirection, 'any'>): TechnicalOutcome<FractalEvidence> => ({
        verdict: relation(last[0]!, last[1]!, last[2]!, value) ? 'pass' : 'fail', reason: 'none',
        evidence: { algorithm: 'chan-containment', direction: value, centerDate: last[1]!.rawTo,
            confirmationDate: last[2]!.rawTo,
            bars: last.map((bar) => ({ sessionDate: bar.rawTo, high: bar.high, low: bar.low })),
            normalizedBars: last.map((bar) => ({ ...bar, rawDates: [...bar.rawDates] })) },
    });
    return chooseDirectional(direction, one('bottom'), one('top'));
}

export function evaluateFractalCriteria(
    bars: readonly CanonicalOhlc[], sessions: readonly string[], criteria: FractalCriteria,
): TechnicalOutcome<FractalEvidence> {
    if (!criteria || !['raw-three', 'chan-containment', 'any'].includes(criteria.algorithm)
        || !['bottom', 'top', 'any'].includes(criteria.direction)) throw new Error('invalid_fractal_criteria');
    const raw = evaluateRawFractal(bars, sessions, criteria.direction);
    const chan = evaluateChanFractal(bars, sessions, criteria.direction);
    if (criteria.algorithm === 'raw-three') return raw;
    if (criteria.algorithm === 'chan-containment') return chan;
    const verdict = combineVerdicts([raw.verdict, chan.verdict], 'any');
    const chosen = raw.verdict === 'pass' ? raw : chan.verdict === 'pass' ? chan : undefined;
    const reason = verdict === 'unknown' ? (raw.verdict === 'unknown' ? raw.reason : chan.reason) : 'none';
    return { verdict, reason, ...(chosen?.evidence ? { evidence: chosen.evidence } : {}) };
}

const toCandle = (bar: CanonicalOhlc): Candle => ({
    time: Date.parse(`${bar.sessionDate}T00:00:00Z`) / 1000,
    open: priceNumber(bar.open), high: priceNumber(bar.high), low: priceNumber(bar.low), close: priceNumber(bar.close),
    volume: 0, turnoverTwd: null,
});

export function evaluateBollReversal(
    bars: readonly CanonicalOhlc[], sessions: readonly string[], mode: BollReversalMode,
): TechnicalOutcome<BollReversalEvidence> {
    if (!['lower-bullish', 'upper-bearish', 'any'].includes(mode)) throw new Error('invalid_boll_mode');
    const selected = windowForSessions(bars, sessions, 21);
    if (!selected.evidence) return { verdict: 'unknown', reason: selected.reason };
    const source = selected.evidence;
    const bands = bollinger(source.map(toCandle), 20, 2);
    const evidence = (index: 19 | 20): BollBandEvidence => ({
        ...source[index]!, upper: bands.upper[index]!.value!, middle: bands.mid[index]!.value!, lower: bands.lower[index]!.value!,
    });
    const previous = evidence(19), current = evidence(20);
    const pClose = priceNumber(previous.close), dOpen = priceNumber(current.open), dHigh = priceNumber(current.high);
    const dLow = priceNumber(current.low), dClose = priceNumber(current.close);
    const priorInside = previous.lower <= pClose && pClose <= previous.upper;
    const lowerShadow = dLow < dOpen, upperShadow = dHigh > dOpen;
    const one = (value: Exclude<BollReversalMode, 'any'>): TechnicalOutcome<BollReversalEvidence> => {
        const pass = value === 'lower-bullish'
            ? priorInside && dClose < current.lower && dClose > dOpen && lowerShadow
            : priorInside && dClose > current.upper && dClose < dOpen && upperShadow;
        const outsideDistance = value === 'lower-bullish' ? Math.max(0, current.lower - dClose) : Math.max(0, dClose - current.upper);
        return { verdict: pass ? 'pass' : 'fail', reason: 'none', evidence: {
            mode: value, previous, current, lowerShadow, upperShadow,
            outsideDistance: Number(outsideDistance.toFixed(6)),
        } };
    };
    const lower = one('lower-bullish'), upper = one('upper-bearish');
    if (mode !== 'any') return mode === 'lower-bullish' ? lower : upper;
    const verdict = combineVerdicts([lower.verdict, upper.verdict], 'any');
    const chosen = lower.verdict === 'pass' ? lower : upper.verdict === 'pass' ? upper : undefined;
    return { verdict, reason: 'none', ...(chosen?.evidence ? { evidence: chosen.evidence } : {}) };
}

export function validateCriteriaV3(criteria: CriteriaV3): boolean {
    if (!criteria?.fractal || !criteria.bollReversal
        || typeof criteria.fractal.enabled !== 'boolean' || typeof criteria.bollReversal.enabled !== 'boolean'
        || !['raw-three', 'chan-containment', 'any'].includes(criteria.fractal.algorithm)
        || !['bottom', 'top', 'any'].includes(criteria.fractal.direction)
        || !['lower-bullish', 'upper-bearish', 'any'].includes(criteria.bollReversal.mode)) return false;
    const base = !criteria.volume.enabled && !criteria.holder.enabled
        ? { ...criteria, volume: { ...criteria.volume, enabled: true } }
        : criteria;
    return validateCriteria(base)
        && [criteria.volume.enabled, criteria.holder.enabled, criteria.fractal.enabled, criteria.bollReversal.enabled].some(Boolean);
}

export function criteriaFingerprintV3(criteria: CriteriaV3): string {
    if (!validateCriteriaV3(criteria)) throw new Error('invalid_criteria');
    const volume = criteria.volume.enabled ? `v:on:${hundredths(criteria.volume.threshold, 1000)}:${criteria.volume.turnover.enabled ? turnoverWanToNtd(criteria.volume.turnover.minimumWan) : 'toff'}` : 'v:off';
    const holder = criteria.holder.enabled ? `h:on:${criteria.holder.mode}:${criteria.holder.streakWeeks}:${hundredths(criteria.holder.threshold)}:${criteria.holder.turnover.enabled ? turnoverWanToNtd(criteria.holder.turnover.minimumWan) : 'toff'}` : 'h:off';
    return [SCREENER_V3_VERSION, criteria.mode, volume, holder,
        criteria.fractal.enabled ? `f:${criteria.fractal.algorithm}:${criteria.fractal.direction}` : 'f:off',
        criteria.bollReversal.enabled ? `b:${criteria.bollReversal.mode}` : 'b:off'].join('|');
}

export function combineCriteriaV3(
    criteria: CriteriaV3,
    branches: { volume?: Verdict; holder?: Verdict; fractal?: Verdict; bollReversal?: Verdict },
): Verdict {
    if (!validateCriteriaV3(criteria)) throw new Error('invalid_criteria');
    const values: Verdict[] = [];
    for (const [enabled, key] of [[criteria.volume.enabled, 'volume'], [criteria.holder.enabled, 'holder'],
        [criteria.fractal.enabled, 'fractal'], [criteria.bollReversal.enabled, 'bollReversal']] as const) {
        if (!enabled) continue;
        const value = branches[key];
        if (!value) throw new Error('missing_enabled_branch');
        values.push(value);
    }
    return combineVerdicts(values, criteria.mode);
}

function orStoredOutcomes<E>(values: readonly TechnicalOutcome<E>[]): TechnicalOutcome<E> {
    const verdict = combineVerdicts(values.map((value) => value.verdict), 'any');
    const chosen = values.find((value) => value.verdict === 'pass');
    const unknownValue = values.find((value) => value.verdict === 'unknown');
    return { verdict, reason: verdict === 'unknown' ? unknownValue!.reason : 'none',
        ...(chosen?.evidence ? { evidence: chosen.evidence } : {}) };
}

export function selectStoredFractal(evidence: TechnicalSnapshotEvidence, criteria: FractalCriteria): TechnicalOutcome<FractalEvidence> {
    if (!evidence || !criteria || !['raw-three', 'chan-containment', 'any'].includes(criteria.algorithm)
        || !['bottom', 'top', 'any'].includes(criteria.direction)) throw new Error('invalid_fractal_criteria');
    const direction = (algorithm: Exclude<FractalAlgorithm, 'any'>) => {
        const bottom = algorithm === 'raw-three' ? evidence.rawBottom : evidence.chanBottom;
        const top = algorithm === 'raw-three' ? evidence.rawTop : evidence.chanTop;
        return criteria.direction === 'bottom' ? bottom : criteria.direction === 'top' ? top : orStoredOutcomes([bottom, top]);
    };
    const raw = direction('raw-three'), chan = direction('chan-containment');
    return criteria.algorithm === 'raw-three' ? raw : criteria.algorithm === 'chan-containment' ? chan : orStoredOutcomes([raw, chan]);
}

export function selectStoredBoll(evidence: TechnicalSnapshotEvidence, criteria: BollReversalCriteria): TechnicalOutcome<BollReversalEvidence> {
    if (!evidence || !criteria || !['lower-bullish', 'upper-bearish', 'any'].includes(criteria.mode)) throw new Error('invalid_boll_mode');
    return criteria.mode === 'lower-bullish' ? evidence.lowerBullish
        : criteria.mode === 'upper-bearish' ? evidence.upperBearish
        : orStoredOutcomes([evidence.lowerBullish, evidence.upperBearish]);
}

function stableJson(value: unknown): string {
    if (value === undefined) return 'null';
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
    return JSON.stringify(value);
}

export async function technicalEvidenceHash(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface TechnicalSortableRow {
    code: string;
    verdict: Verdict;
    fractal?: FractalEvidence | null;
    boll?: BollReversalEvidence | null;
}
export function compareTechnicalRows(sort: TechnicalSort, direction: 'asc' | 'desc', a: TechnicalSortableRow, b: TechnicalSortableRow): number {
    if (!['asc', 'desc'].includes(direction)) throw new Error('invalid_direction');
    const metric = (row: TechnicalSortableRow): string | number | null => {
        if (row.verdict === 'unknown') return null;
        if (sort === 'confirmationDate') return row.fractal?.confirmationDate ?? row.boll?.current.sessionDate ?? null;
        if (sort === 'algorithm') return row.fractal?.algorithm === 'raw-three' ? 0 : row.fractal?.algorithm === 'chan-containment' ? 1 : null;
        if (sort === 'direction') return row.fractal?.direction === 'bottom' ? 0 : row.fractal?.direction === 'top' ? 1 : row.boll?.mode === 'lower-bullish' ? 2 : row.boll?.mode === 'upper-bearish' ? 3 : null;
        return row.boll?.outsideDistance ?? null;
    };
    const left = metric(a), right = metric(b);
    if (left === null || right === null) return left === right ? a.code.localeCompare(b.code) : left === null ? 1 : -1;
    const cmp = left < right ? -1 : left > right ? 1 : 0;
    return (direction === 'desc' ? -cmp : cmp) || a.code.localeCompare(b.code);
}

export function isV3Cursor(value: unknown): value is ScreenerCursorV3 {
    const row = value as Partial<ScreenerCursorV3> | null;
    return !!row && row.version === 3 && typeof row.snapshotId === 'string' && /^[\w-]{36}$/.test(row.snapshotId)
        && Number.isInteger(row.offset) && row.offset! >= 0 && row.offset! <= 10000
        && typeof row.fingerprint === 'string' && Object.keys(row).sort().join() === 'fingerprint,offset,snapshotId,version';
}

export function isV3Preference(value: unknown): value is ScreenerPreferenceV3 {
    const row = value as Partial<ScreenerPreferenceV3> | null;
    return !!row && row.version === 3 && !!row.query && validateCriteriaV3(row.query.criteria as CriteriaV3)
        && ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak', 'confirmationDate', 'algorithm', 'direction', 'outsideDistance'].includes(row.query.sort!)
        && ['asc', 'desc'].includes(row.query.direction!) && ['pass', 'fail', 'unknown'].includes(row.query.resultState!);
}

export function validateScreenerV3Progress(progress: ScreenerV3Progress): boolean {
    if (!progress || progress.version !== 3 || !Number.isInteger(progress.target) || progress.target < 1
        || !Number.isInteger(progress.processed) || progress.processed < 0 || progress.processed > progress.target
        || progress.remaining !== progress.target - progress.processed
        || !Number.isInteger(progress.failed) || progress.failed < 0 || progress.failed > progress.processed
        || !Number.isInteger(progress.overdue) || progress.overdue < 0 || progress.overdue > progress.remaining
        || !(progress.cursor === null || typeof progress.cursor === 'string')) return false;
    const markets = progress.markets;
    if (!markets || !markets.TWSE || !markets.TPEx) return false;
    const values = [markets.TWSE, markets.TPEx];
    return values.every((row) => Number.isInteger(row.target) && row.target >= 0
        && Number.isInteger(row.processed) && row.processed >= 0 && row.processed <= row.target
        && Number.isInteger(row.failed) && row.failed >= 0 && row.failed <= row.processed)
        && values.reduce((sum, row) => sum + row.target, 0) === progress.target
        && values.reduce((sum, row) => sum + row.processed, 0) === progress.processed;
}

export function validateScreenerV3Metadata(metadata: ScreenerV3Metadata): boolean {
    if (!metadata || metadata.version !== 3 || metadata.schemaVersion !== 3
        || metadata.formulaVersion !== SCREENER_V3_FORMULA_VERSION || metadata.sourceReview !== 'verified'
        || !metadata.universeRevision || !/^[\w-]{36}$/.test(metadata.baseSnapshotId) || !/^[a-f0-9]{64}$/.test(metadata.receiptsHash)
        || !Number.isInteger(metadata.total) || metadata.total < 1
        || !Number.isFinite(Date.parse(metadata.validThrough)) || !validateScreenerV3Progress(metadata.progress)
        || metadata.counts?.total !== metadata.total) return false;
    const sessions = metadata.technicalAnchors?.sessions;
    return Array.isArray(sessions) && sessions.length >= 60 && sessions.length <= 62
        && sessions.every(isIsoDate) && new Set(sessions).size === sessions.length
        && sessions.every((date, index) => index === 0 || date > sessions[index - 1]!)
        && metadata.technicalAnchors.through === sessions.at(-1);
}
