/** 收盤後選股 v4 均線與背離純函式；不得在此模組抓行情、寫 DB 或觸發交易。 */
import { macd, obv, referenceSma, rsi, stoch, REFERENCE_FORMULA_VERSION, type IndicatorPoint } from './indicators.ts';
import { combineVerdicts, effectiveCriteria, hasAlignedSessionEvidence, hundredths, turnoverWanToNtd, validateCriteria,
    type Counts, type ScreenerAnchors, type UniverseStock, type Verdict } from './stock-screener-domain.ts';
import {
    SCREENER_OHLCV_V4_MAPPING_VERSION, canonicalPriceUnits, canonicalVolumeShares,
    validateCanonicalOhlcvSeries, type CanonicalOhlcv,
} from './stock-screener-ohlcv.ts';
import {
    DEFAULT_CRITERIA_V3, technicalEvidenceHash, type CriteriaV3, type ScreenerInputV3, type ScreenerTechnicalAnchors,
    type TechnicalOutcome, type TechnicalReason,
} from './stock-screener-technical-patterns.ts';
import type { Candle } from './types/market.ts';

export const SCREENER_V4_VERSION = 4 as const;
export const SCREENER_V4_SCHEMA_VERSION = 4 as const;
export const SCREENER_V4_FORMULA_VERSION = `after-market-v4-ma-divergence-${REFERENCE_FORMULA_VERSION}` as const;
export const SCREENER_V4_OHLCV_WINDOW = 130 as const;
export const MA_FEATURE_DAYS = 11 as const;

export type MaMode = 'bullish-preparation' | 'golden-cross' | 'bearish-preparation' | 'death-cross' | 'any-bullish' | 'any-bearish';
export type DivergenceSource = 'obv' | 'rsi5' | 'rsi10' | 'kd-k' | 'macd-line' | 'macd-histogram';
export type DivergenceDirection = 'bullish' | 'bearish' | 'any';
export type V4UnknownReason = TechnicalReason | 'missing_volume' | 'invalid_volume' | 'indicator_warmup' | 'pivot_unconfirmed';

export interface MaCriteria {
    enabled: boolean;
    mode: MaMode;
    compressionDays: number;
    maxSpreadPct: string;
}
export interface DivergenceCriteria {
    enabled: boolean;
    source: DivergenceSource;
    direction: DivergenceDirection;
    requireZeroReset: boolean;
}
export interface CriteriaV4 extends CriteriaV3 {
    ma: MaCriteria;
    divergence: DivergenceCriteria;
}
export const DEFAULT_CRITERIA_V4: CriteriaV4 = {
    ...DEFAULT_CRITERIA_V3,
    volume: { ...DEFAULT_CRITERIA_V3.volume, turnover: { ...DEFAULT_CRITERIA_V3.volume.turnover } },
    holder: { ...DEFAULT_CRITERIA_V3.holder, turnover: { ...DEFAULT_CRITERIA_V3.holder.turnover } },
    fractal: { ...DEFAULT_CRITERIA_V3.fractal },
    bollReversal: { ...DEFAULT_CRITERIA_V3.bollReversal },
    ma: { enabled: false, mode: 'any-bullish', compressionDays: 3, maxSpreadPct: '1' },
    divergence: { enabled: false, source: 'macd-histogram', direction: 'any', requireZeroReset: false },
};

export interface MaPointEvidence {
    sessionDate: string;
    close: string;
    sma5: number;
    sma10: number;
    sma20: number;
    spreadPct: number;
    gap: number;
}
export interface MaFeatureEvidence {
    points: MaPointEvidence[];
}
export interface MaSignalEvidence {
    mode: Exclude<MaMode, 'any-bullish' | 'any-bearish'>;
    previous: MaPointEvidence;
    current: MaPointEvidence;
    compressionEnd: string;
    compressionWindow: MaPointEvidence[];
}
export interface PivotEvidence {
    sessionDate: string;
    confirmationDate: string;
    price: string;
    indicator: number;
}
export interface DivergenceEvidence {
    source: DivergenceSource;
    direction: Exclude<DivergenceDirection, 'any'>;
    first: PivotEvidence;
    second: PivotEvidence;
    distanceSessions: number;
    priceDifferencePct: number;
    zeroResetRequired: boolean;
    zeroResetMet: boolean | null;
    volumeUnit?: 'shares';
    sourceMappingVersion: typeof SCREENER_OHLCV_V4_MAPPING_VERSION;
}
export type V4Outcome<E> = Omit<TechnicalOutcome<E>, 'reason'> & { reason: V4UnknownReason };
export interface DivergenceMatrix {
    [source: string]: {
        bullish: V4Outcome<DivergenceEvidence>;
        bearish: V4Outcome<DivergenceEvidence>;
        bullishZeroReset: V4Outcome<DivergenceEvidence>;
        bearishZeroReset: V4Outcome<DivergenceEvidence>;
    };
}
export interface TechnicalSnapshotEvidenceV4 {
    ma: V4Outcome<MaFeatureEvidence>;
    divergence: DivergenceMatrix;
    evidenceHash: string;
}
export interface ScreenerInputV4 extends ScreenerInputV3 {
    technicalV4: TechnicalSnapshotEvidenceV4;
}
export interface ScreenerV4Progress {
    version: 4;
    target: number;
    processed: number;
    remaining: number;
    failed: number;
    overdue: number;
    cursor: string | null;
    markets: Record<UniverseStock['market'], { target: number; processed: number; failed: number }>;
}
export interface ScreenerV4Counts extends Omit<Counts, 'missingByCondition'> {
    missingByCondition: Counts['missingByCondition'] & {
        fractal: number;
        'boll-reversal': number;
        ma: number;
        divergence: number;
    };
}
export interface ScreenerV4Metadata {
    sessionAlignmentVersion?: 'official-sessions-v1';
    version: 4;
    schemaVersion: 4;
    formulaVersion: typeof SCREENER_V4_FORMULA_VERSION;
    sourceMappingVersion: typeof SCREENER_OHLCV_V4_MAPPING_VERSION;
    anchors: ScreenerAnchors;
    technicalAnchors: ScreenerTechnicalAnchors;
    baseSnapshotId: string;
    receiptsHash: string;
    universeRevision: string;
    total: number;
    validThrough: string;
    sourceReview: 'verified';
    progress: ScreenerV4Progress;
    counts: ScreenerV4Counts;
    expectedSessionDate: string;
    effectiveSessionDate: string;
}
export interface ScreenerCursorV4 {
    version: 4;
    snapshotId: string;
    offset: number;
    fingerprint: string;
}
export interface ScreenerPreferenceV4 {
    version: 4;
    query: {
        criteria: CriteriaV4;
        sort: 'code' | 'volumeMultiple' | 'turnover' | 'holderChange' | 'holderStreak' | 'confirmationDate' | 'algorithm'
            | 'direction' | 'outsideDistance' | 'maSpread' | 'pivotDate' | 'priceDifference';
        direction: 'asc' | 'desc';
        resultState: Verdict;
    };
}

export const MA_MODES: readonly MaMode[] = ['bullish-preparation', 'golden-cross', 'bearish-preparation', 'death-cross', 'any-bullish', 'any-bearish'];
export const DIVERGENCE_SOURCES: readonly DivergenceSource[] = ['obv', 'rsi5', 'rsi10', 'kd-k', 'macd-line', 'macd-histogram'];
export const DIVERGENCE_DIRECTIONS: readonly DivergenceDirection[] = ['bullish', 'bearish', 'any'];
export const V4_UNKNOWN_REASONS: readonly V4UnknownReason[] = [
    'none', 'missing_ohlcv', 'invalid_ohlcv', 'insufficient_history', 'non_adjacent_sessions',
    'containment_direction_unknown', 'missing_volume', 'invalid_volume', 'indicator_warmup', 'pivot_unconfirmed',
];

const priceNumber = (value: string): number => Number(canonicalPriceUnits(value)) / 1_000_000;
const timeOf = (sessionDate: string): number => Date.parse(`${sessionDate}T00:00:00Z`) / 1000;
const finitePointMap = (points: readonly IndicatorPoint[]) => new Map(points.flatMap((point) =>
    point.value === undefined || !Number.isFinite(point.value) ? [] : [[point.time, point.value] as const]));

export function canonicalOhlcvCandles(bars: readonly CanonicalOhlcv[]): Candle[] | null {
    if (!validateCanonicalOhlcvSeries(bars)) return null;
    const rows: Candle[] = [];
    for (const bar of bars) {
        const volume = canonicalVolumeShares(bar.volumeShares);
        if (volume === null || volume > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        rows.push({ time: timeOf(bar.sessionDate), open: priceNumber(bar.open), high: priceNumber(bar.high),
            low: priceNumber(bar.low), close: priceNumber(bar.close), volume: Number(volume), turnoverTwd: null });
    }
    return rows;
}

export function buildMaFeatures(bars: readonly CanonicalOhlcv[], sessions?: readonly string[]): V4Outcome<MaFeatureEvidence> {
    // SMA20 plus the latest eleven feature days requires thirty adjacent sessions.
    if (sessions && sessions.slice(-(20 + MA_FEATURE_DAYS - 1)).some(date => !bars.some(bar => bar.sessionDate === date))) {
        return { verdict: 'unknown', reason: 'non_adjacent_sessions' };
    }
    const candles = canonicalOhlcvCandles(bars);
    if (!candles) return { verdict: 'unknown', reason: 'invalid_ohlcv' };
    if (candles.length < 20) return { verdict: 'unknown', reason: 'insufficient_history' };
    const sma5 = finitePointMap(referenceSma(candles, 5));
    const sma10 = finitePointMap(referenceSma(candles, 10));
    const sma20 = finitePointMap(referenceSma(candles, 20));
    const points = bars.flatMap((bar) => {
        const time = timeOf(bar.sessionDate);
        const a = sma5.get(time), b = sma10.get(time), c = sma20.get(time);
        if (a === undefined || b === undefined || c === undefined || c <= 0) return [];
        return [{ sessionDate: bar.sessionDate, close: bar.close, sma5: a, sma10: b, sma20: c,
            spreadPct: ((Math.max(a, b, c) - Math.min(a, b, c)) / c) * 100, gap: a - c }];
    }).slice(-MA_FEATURE_DAYS);
    return points.length < 2 ? { verdict: 'unknown', reason: 'insufficient_history' }
        : { verdict: 'pass', reason: 'none', evidence: { points } };
}

function selectMaMode(features: MaFeatureEvidence, criteria: MaCriteria, mode: Exclude<MaMode, 'any-bullish' | 'any-bearish'>): V4Outcome<MaSignalEvidence> {
    const points = features.points;
    const current = points.at(-1), previous = points.at(-2);
    const cross = mode === 'golden-cross' || mode === 'death-cross';
    const end = points.length - (cross ? 1 : 0);
    const start = end - criteria.compressionDays;
    if (!current || !previous || start < 0) return { verdict: 'unknown', reason: 'insufficient_history' };
    const compressionWindow = points.slice(start, end);
    const threshold = Number(criteria.maxSpreadPct);
    const compressed = compressionWindow.every((point) => point.spreadPct <= threshold);
    let signal = false;
    if (compressed) {
        const close = priceNumber(current.close);
        if (mode === 'bullish-preparation') signal = current.sma5 <= current.sma20 && current.gap > previous.gap
            && close > Math.max(current.sma5, current.sma10, current.sma20);
        if (mode === 'bearish-preparation') signal = current.sma5 >= current.sma20 && current.gap < previous.gap
            && close < Math.min(current.sma5, current.sma10, current.sma20);
        if (mode === 'golden-cross') signal = previous.sma5 <= previous.sma20 && current.sma5 > current.sma20;
        if (mode === 'death-cross') signal = previous.sma5 >= previous.sma20 && current.sma5 < current.sma20;
    }
    return { verdict: signal ? 'pass' : 'fail', reason: 'none', evidence: {
        mode, previous, current, compressionEnd: points[end - 1]!.sessionDate, compressionWindow,
    } };
}

export function evaluateMaCriteria(features: V4Outcome<MaFeatureEvidence>, criteria: MaCriteria): V4Outcome<MaSignalEvidence> {
    if (!criteria || typeof criteria.enabled !== 'boolean' || !MA_MODES.includes(criteria.mode)
        || !Number.isInteger(criteria.compressionDays) || criteria.compressionDays < 2 || criteria.compressionDays > 10
        || hundredths(criteria.maxSpreadPct, 5) === null || Number(criteria.maxSpreadPct) < 0.1) throw new Error('invalid_ma_criteria');
    if (!features.evidence) return { verdict: 'unknown', reason: features.reason };
    if (criteria.mode === 'any-bullish' || criteria.mode === 'any-bearish') {
        const modes = criteria.mode === 'any-bullish' ? ['bullish-preparation', 'golden-cross'] as const : ['bearish-preparation', 'death-cross'] as const;
        const outcomes = modes.map((mode) => selectMaMode(features.evidence!, criteria, mode));
        const verdict = combineVerdicts(outcomes.map((outcome) => outcome.verdict), 'any');
        const selected = outcomes.find((outcome) => outcome.verdict === 'pass') ?? outcomes.find((outcome) => outcome.verdict === 'unknown') ?? outcomes[0]!;
        return { verdict, reason: verdict === 'unknown' ? selected.reason : 'none', ...(selected.evidence ? { evidence: selected.evidence } : {}) };
    }
    return selectMaMode(features.evidence, criteria, criteria.mode);
}

type Pivot = { index: number; sessionDate: string; confirmationDate: string; price: string };
function strictPivots(bars: readonly CanonicalOhlcv[], direction: Exclude<DivergenceDirection, 'any'>): Pivot[] {
    const result: Pivot[] = [];
    for (let index = 2; index <= bars.length - 3; index++) {
        const values = bars.slice(index - 2, index + 3).map((bar) => canonicalPriceUnits(direction === 'bullish' ? bar.low : bar.high)!);
        const center = values[2]!;
        const strict = direction === 'bullish' ? values.every((value, position) => position === 2 || center < value)
            : values.every((value, position) => position === 2 || center > value);
        if (strict) result.push({ index, sessionDate: bars[index]!.sessionDate,
            confirmationDate: bars[index + 2]!.sessionDate, price: direction === 'bullish' ? bars[index]!.low : bars[index]!.high });
    }
    return result;
}

function hasUnconfirmedPivotCandidate(bars: readonly CanonicalOhlcv[], direction: Exclude<DivergenceDirection, 'any'>): boolean {
    return bars.slice(-2).some((bar, offset) => {
        const index = bars.length - 2 + offset;
        if (index < 2) return false;
        const center = canonicalPriceUnits(direction === 'bullish' ? bar.low : bar.high)!;
        const left = bars.slice(index - 2, index).map((item) => canonicalPriceUnits(direction === 'bullish' ? item.low : item.high)!);
        return direction === 'bullish' ? left.every((value) => center < value) : left.every((value) => center > value);
    });
}

function choosePivotPair(bars: readonly CanonicalOhlcv[], direction: Exclude<DivergenceDirection, 'any'>): [Pivot, Pivot] | null {
    const pivots = strictPivots(bars, direction);
    const candidates: Array<[Pivot, Pivot]> = [];
    for (let secondIndex = pivots.length - 1; secondIndex >= 1; secondIndex--) {
        const second = pivots[secondIndex]!;
        const freshness = bars.length - 1 - second.index;
        if (freshness < 2 || freshness > 3) continue;
        for (let firstIndex = secondIndex - 1; firstIndex >= 0; firstIndex--) {
            const first = pivots[firstIndex]!, distance = second.index - first.index;
            if (distance < 5 || distance > 30) continue;
            const firstPrice = canonicalPriceUnits(first.price)!, secondPrice = canonicalPriceUnits(second.price)!;
            const priceDifferencePct = Number((firstPrice > secondPrice ? firstPrice - secondPrice : secondPrice - firstPrice) * BigInt(10000) / firstPrice) / 100;
            const directional = direction === 'bullish' ? secondPrice < firstPrice : secondPrice > firstPrice;
            if (directional && priceDifferencePct >= 1) candidates.push([first, second]);
        }
    }
    return candidates.sort((left, right) => right[1].index - left[1].index || right[0].index - left[0].index)[0] ?? null;
}

function indicatorSeries(candles: Candle[], source: DivergenceSource): Map<number, number> {
    if (source === 'obv') return finitePointMap(obv(candles));
    if (source === 'rsi5') return finitePointMap(rsi(candles, 5));
    if (source === 'rsi10') return finitePointMap(rsi(candles, 10));
    if (source === 'kd-k') return finitePointMap(stoch(candles, 9, 3, 3).k);
    const value = macd(candles, 12, 26, 9);
    return finitePointMap(source === 'macd-line' ? value.macd : value.hist);
}

function evaluateDivergenceDirection(
    bars: readonly CanonicalOhlcv[], candles: Candle[], source: DivergenceSource,
    direction: Exclude<DivergenceDirection, 'any'>, requireZeroReset: boolean,
): V4Outcome<DivergenceEvidence> {
    const pair = choosePivotPair(bars, direction);
    if (!pair) return hasUnconfirmedPivotCandidate(bars, direction)
        ? { verdict: 'unknown', reason: 'pivot_unconfirmed' } : { verdict: 'fail', reason: 'none' };
    const values = indicatorSeries(candles, source);
    const [first, second] = pair;
    const firstValue = values.get(timeOf(first.sessionDate)), secondValue = values.get(timeOf(second.sessionDate));
    if (firstValue === undefined || secondValue === undefined) return { verdict: 'unknown', reason: 'indicator_warmup' };
    const indicatorDiverges = direction === 'bullish' ? secondValue > firstValue : secondValue < firstValue;
    let zeroResetMet: boolean | null = null;
    let zeroSideMet = true;
    if (source === 'macd-histogram') {
        zeroSideMet = direction === 'bullish' ? firstValue < 0 && secondValue < 0 : firstValue > 0 && secondValue > 0;
        const between = bars.slice(first.index + 1, second.index).map((bar) => values.get(timeOf(bar.sessionDate))).filter((value): value is number => value !== undefined);
        zeroResetMet = direction === 'bullish' ? between.some((value) => value >= 0) : between.some((value) => value <= 0);
    }
    const firstPrice = canonicalPriceUnits(first.price)!, secondPrice = canonicalPriceUnits(second.price)!;
    const difference = Number((firstPrice > secondPrice ? firstPrice - secondPrice : secondPrice - firstPrice) * BigInt(10000) / firstPrice) / 100;
    const evidence: DivergenceEvidence = { source, direction,
        first: { sessionDate: first.sessionDate, confirmationDate: first.confirmationDate, price: first.price, indicator: firstValue },
        second: { sessionDate: second.sessionDate, confirmationDate: second.confirmationDate, price: second.price, indicator: secondValue },
        distanceSessions: second.index - first.index, priceDifferencePct: difference,
        zeroResetRequired: source === 'macd-histogram' && requireZeroReset, zeroResetMet,
        ...(source === 'obv' ? { volumeUnit: 'shares' as const } : {}), sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION };
    const pass = indicatorDiverges && zeroSideMet && (!requireZeroReset || source !== 'macd-histogram' || zeroResetMet === true);
    return { verdict: pass ? 'pass' : 'fail', reason: 'none', evidence };
}

export function buildDivergenceMatrix(bars: readonly CanonicalOhlcv[], sessions?: readonly string[]): DivergenceMatrix {
    const candles = canonicalOhlcvCandles(bars);
    const invalid = (reason: V4UnknownReason): DivergenceMatrix => Object.fromEntries(DIVERGENCE_SOURCES.map((source) => [source, {
        bullish: { verdict: 'unknown', reason }, bearish: { verdict: 'unknown', reason },
        bullishZeroReset: { verdict: 'unknown', reason }, bearishZeroReset: { verdict: 'unknown', reason },
    }])) as DivergenceMatrix;
    if (sessions && sessions.some(date => !bars.some(bar => bar.sessionDate === date))) return invalid('non_adjacent_sessions');
    if (!candles) return invalid('invalid_ohlcv');
    if (bars.length < 35) return invalid('insufficient_history');
    return Object.fromEntries(DIVERGENCE_SOURCES.map((source) => [source, {
        bullish: evaluateDivergenceDirection(bars, candles, source, 'bullish', false),
        bearish: evaluateDivergenceDirection(bars, candles, source, 'bearish', false),
        bullishZeroReset: evaluateDivergenceDirection(bars, candles, source, 'bullish', true),
        bearishZeroReset: evaluateDivergenceDirection(bars, candles, source, 'bearish', true),
    }])) as DivergenceMatrix;
}

export function selectStoredDivergence(matrix: DivergenceMatrix, criteria: DivergenceCriteria): V4Outcome<DivergenceEvidence> {
    if (!criteria || typeof criteria.enabled !== 'boolean' || !DIVERGENCE_SOURCES.includes(criteria.source)
        || !DIVERGENCE_DIRECTIONS.includes(criteria.direction) || typeof criteria.requireZeroReset !== 'boolean') throw new Error('invalid_divergence_criteria');
    const row = matrix?.[criteria.source];
    if (!row) return { verdict: 'unknown', reason: 'missing_ohlcv' };
    const key = (direction: Exclude<DivergenceDirection, 'any'>) => `${direction}${criteria.source === 'macd-histogram' && criteria.requireZeroReset ? 'ZeroReset' : ''}` as keyof typeof row;
    if (criteria.direction !== 'any') return row[key(criteria.direction)];
    const outcomes = [row[key('bullish')], row[key('bearish')]];
    const verdict = combineVerdicts(outcomes.map((outcome) => outcome.verdict), 'any');
    const selected = outcomes.find((outcome) => outcome.verdict === 'pass') ?? outcomes.find((outcome) => outcome.verdict === 'unknown') ?? outcomes[0]!;
    return { verdict, reason: verdict === 'unknown' ? selected.reason : 'none', ...(selected.evidence ? { evidence: selected.evidence } : {}) };
}

export async function buildTechnicalSnapshotEvidenceV4(bars: readonly CanonicalOhlcv[], sessions?: readonly string[]): Promise<TechnicalSnapshotEvidenceV4> {
    const evidence = { ma: buildMaFeatures(bars, sessions), divergence: buildDivergenceMatrix(bars, sessions) };
    return { ...evidence, evidenceHash: await technicalEvidenceHash(evidence) };
}

export function validateCriteriaV4(criteria: CriteriaV4): boolean {
    if (!criteria?.ma || !criteria.divergence || typeof criteria.ma.enabled !== 'boolean' || typeof criteria.divergence.enabled !== 'boolean'
        || !MA_MODES.includes(criteria.ma.mode) || !Number.isInteger(criteria.ma.compressionDays)
        || criteria.ma.compressionDays < 2 || criteria.ma.compressionDays > 10
        || hundredths(criteria.ma.maxSpreadPct, 5) === null || Number(criteria.ma.maxSpreadPct) < 0.1
        || !DIVERGENCE_SOURCES.includes(criteria.divergence.source) || !DIVERGENCE_DIRECTIONS.includes(criteria.divergence.direction)
        || typeof criteria.divergence.requireZeroReset !== 'boolean') return false;
    const base = !criteria.volume.enabled && !criteria.holder.enabled
        ? { ...criteria, volume: { ...criteria.volume, enabled: true } } : criteria;
    const legacyValid = validateCriteria(base) && !!criteria.fractal && !!criteria.bollReversal
        && ['raw-three', 'chan-containment', 'any'].includes(criteria.fractal.algorithm)
        && ['bottom', 'top', 'any'].includes(criteria.fractal.direction)
        && ['lower-bullish', 'upper-bearish', 'any'].includes(criteria.bollReversal.mode);
    return legacyValid && [criteria.volume.enabled, criteria.holder.enabled, criteria.fractal.enabled,
        criteria.bollReversal.enabled, criteria.ma.enabled, criteria.divergence.enabled].some(Boolean);
}

export function effectiveCriteriaV4(criteria: CriteriaV4): CriteriaV4 {
    const base = effectiveCriteria(criteria) as CriteriaV4;
    return { ...base, ma: { ...base.ma }, divergence: { ...base.divergence,
        requireZeroReset: base.divergence.enabled && base.divergence.source === 'macd-histogram' && base.divergence.requireZeroReset } };
}

export function criteriaFingerprintV4(criteria: CriteriaV4): string {
    if (!validateCriteriaV4(criteria)) throw new Error('invalid_criteria');
    const applied = effectiveCriteriaV4(criteria);
    const volume = applied.volume.enabled ? `v:on:${hundredths(applied.volume.threshold, 1000)}:${applied.volume.turnover.enabled ? turnoverWanToNtd(applied.volume.turnover.minimumWan) : 'toff'}` : 'v:off';
    const holder = applied.holder.enabled ? `h:on:${applied.holder.mode}:${applied.holder.streakWeeks}:${hundredths(applied.holder.threshold)}:${applied.holder.turnover.enabled ? turnoverWanToNtd(applied.holder.turnover.minimumWan) : 'toff'}` : 'h:off';
    return [SCREENER_V4_VERSION, applied.mode, volume, holder,
        applied.fractal.enabled ? `f:${applied.fractal.algorithm}:${applied.fractal.direction}` : 'f:off',
        applied.bollReversal.enabled ? `b:${applied.bollReversal.mode}` : 'b:off',
        applied.ma.enabled ? `ma:${applied.ma.mode}:${applied.ma.compressionDays}:${hundredths(applied.ma.maxSpreadPct, 5)}` : 'ma:off',
        applied.divergence.enabled ? `d:${applied.divergence.source}:${applied.divergence.direction}:${applied.divergence.requireZeroReset}` : 'd:off'].join('|');
}

export function combineCriteriaV4(criteria: CriteriaV4, branches: {
    volume?: Verdict; holder?: Verdict; fractal?: Verdict; bollReversal?: Verdict; ma?: Verdict; divergence?: Verdict;
}): Verdict {
    if (!validateCriteriaV4(criteria)) throw new Error('invalid_criteria');
    const values: Verdict[] = [];
    for (const [enabled, key] of [[criteria.volume.enabled, 'volume'], [criteria.holder.enabled, 'holder'],
        [criteria.fractal.enabled, 'fractal'], [criteria.bollReversal.enabled, 'bollReversal'],
        [criteria.ma.enabled, 'ma'], [criteria.divergence.enabled, 'divergence']] as const) {
        if (!enabled) continue;
        const value = branches[key];
        if (!value) throw new Error('missing_enabled_branch');
        values.push(value);
    }
    return combineVerdicts(values, criteria.mode);
}

export function isV4Cursor(value: unknown): value is ScreenerCursorV4 {
    const row = value as Partial<ScreenerCursorV4> | null;
    return !!row && row.version === 4 && typeof row.snapshotId === 'string' && /^[\w-]{36}$/.test(row.snapshotId)
        && Number.isInteger(row.offset) && row.offset! >= 0 && row.offset! <= 10000
        && typeof row.fingerprint === 'string' && Object.keys(row).sort().join() === 'fingerprint,offset,snapshotId,version';
}

export function isV4Preference(value: unknown): value is ScreenerPreferenceV4 {
    const row = value as Partial<ScreenerPreferenceV4> | null;
    return !!row && row.version === 4 && !!row.query && validateCriteriaV4(row.query.criteria as CriteriaV4)
        && ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak', 'confirmationDate', 'algorithm',
            'direction', 'outsideDistance', 'maSpread', 'pivotDate', 'priceDifference'].includes(row.query.sort!)
        && ['asc', 'desc'].includes(row.query.direction!) && ['pass', 'fail', 'unknown'].includes(row.query.resultState!);
}

export function validateScreenerV4Progress(progress: ScreenerV4Progress): boolean {
    if (!progress || progress.version !== 4 || !Number.isInteger(progress.target) || progress.target < 1
        || !Number.isInteger(progress.processed) || progress.processed < 0 || progress.processed > progress.target
        || progress.remaining !== progress.target - progress.processed || !Number.isInteger(progress.failed)
        || progress.failed < 0 || progress.failed > progress.remaining || !Number.isInteger(progress.overdue)
        || progress.overdue < 0 || progress.overdue > progress.remaining
        || !(progress.cursor === null || typeof progress.cursor === 'string')) return false;
    const markets = progress.markets;
    if (!markets?.TWSE || !markets.TPEx) return false;
    const values = [markets.TWSE, markets.TPEx];
    return values.every((row) => Number.isInteger(row.target) && row.target >= 0
        && Number.isInteger(row.processed) && row.processed >= 0 && row.processed <= row.target
        && Number.isInteger(row.failed) && row.failed >= 0 && row.failed <= row.target - row.processed)
        && values.reduce((sum, row) => sum + row.target, 0) === progress.target
        && values.reduce((sum, row) => sum + row.processed, 0) === progress.processed;
}

export function validateScreenerV4Metadata(metadata: ScreenerV4Metadata): boolean {
    const sessions = metadata?.technicalAnchors?.sessions;
    return !!metadata && metadata.version === 4 && metadata.schemaVersion === 4
        && (metadata.sessionAlignmentVersion === undefined || metadata.sessionAlignmentVersion === 'official-sessions-v1')
        && metadata.formulaVersion === SCREENER_V4_FORMULA_VERSION
        && metadata.sourceMappingVersion === SCREENER_OHLCV_V4_MAPPING_VERSION && metadata.sourceReview === 'verified'
        && !!metadata.universeRevision && /^[\w-]{36}$/.test(metadata.baseSnapshotId)
        && /^[a-f0-9]{64}$/.test(metadata.receiptsHash) && Number.isInteger(metadata.total) && metadata.total > 0
        && Number.isFinite(Date.parse(metadata.validThrough)) && validateScreenerV4Progress(metadata.progress)
        && metadata.counts?.total === metadata.total && Array.isArray(sessions) && sessions.length === SCREENER_V4_OHLCV_WINDOW
        && sessions.every((date, index) => /^\d{4}-\d{2}-\d{2}$/.test(date) && (index === 0 || date > sessions[index - 1]!))
        && metadata.technicalAnchors.through === sessions.at(-1)
        && hasAlignedSessionEvidence({ expectedSessionDate: metadata.expectedSessionDate, daily: metadata.anchors.daily,
            technicalThrough: metadata.technicalAnchors.through, effectiveSessionDate: metadata.effectiveSessionDate });
}
