/** 收盤後選股的純計算契約；不讀取行情、不訂閱、不觸發交易。 */
export const SCREENER_VERSION = 2 as const;
export type ScreenerMarket = 'TWSE' | 'TPEx';
export type ConditionId = 'volume-multiple' | 'large-holder-weekly-pp';
export type Verdict = 'pass' | 'fail' | 'unknown';
export type HolderMode = 'weekly-increase' | 'decrease-to-increase' | 'increase-to-decrease';
export type ReasonCode =
    | 'none' | 'period_pending' | 'missing_current' | 'missing_previous'
    | 'date_mismatch' | 'incompatible_source' | 'invalid_volume'
    | 'zero_previous_volume' | 'incomplete_tdcc' | 'invalid_tdcc'
    | 'missing_turnover' | 'invalid_turnover' | 'history_pending';
export interface TurnoverCriteria { enabled: boolean; minimumWan: string }
export interface Criteria {
    mode: 'all' | 'any';
    volume: { enabled: boolean; threshold: string; turnover: TurnoverCriteria };
    holder: { enabled: boolean; threshold: string; mode: HolderMode; streakWeeks: number; turnover: TurnoverCriteria };
}
export const DEFAULT_CRITERIA: Criteria = {
    mode: 'all',
    volume: { enabled: true, threshold: '3', turnover: { enabled: false, minimumWan: '1000' } },
    holder: { enabled: true, threshold: '0.2', mode: 'weekly-increase', streakWeeks: 1, turnover: { enabled: false, minimumWan: '1000' } },
};
export interface Provenance {
    source: string;
    sourceUrl: string;
    fetchedAt: string;
    payloadHash: string;
    normalizationVersion: string;
}
export interface UniverseStock {
    symbol: string;
    code: string;
    name: string;
    market: ScreenerMarket;
    kind: 'ordinary';
    listingDate?: string;
    classificationVersion?: string;
}
export interface VolumePoint {
    date: string;
    shares: string | null;
    market: ScreenerMarket;
    unit: 'shares';
    basis: string;
    /** Canonical non-negative integer New Taiwan dollars. Optional only for v1 rows. */
    turnoverNtd?: string | null;
    turnoverCurrency?: 'TWD';
    turnoverField?: 'TradeValue' | 'TransactionAmount' | '成交金額';
    turnoverBasis?: string;
    turnoverMappingVersion?: string;
    provenance: Provenance;
}
export interface TdccBand {
    level: number;
    holders: string;
    shares: string;
    ratio: string;
}
export interface HolderPoint {
    date: string;
    bands: TdccBand[];
    provenance: Provenance;
}
export interface PeriodPair { current: string; previous: string }
export interface ScreenerAnchors {
    daily: PeriodPair | null;
    weekly: PeriodPair | null;
    /** Ascending official TDCC periods available to the immutable v2 snapshot. */
    weeklyPeriods?: string[];
}
export interface ScreenerInput extends UniverseStock {
    currentVolume: VolumePoint | null;
    previousVolume: VolumePoint | null;
    currentHolder: HolderPoint | null;
    previousHolder: HolderPoint | null;
    /** Ascending validated points. v1 rows omit this and use current/previous. */
    holderSeries?: HolderPoint[];
}
export interface ConditionResult {
    verdict: Verdict;
    reason: ReasonCode;
    signal?: { verdict: Verdict; reason: ReasonCode };
    turnover?: { verdict: Verdict; reason: ReasonCode; minimumNtd: string | null };
    changesPpHundredths?: string[];
    streakWeeks?: number;
}
export interface ScreenerRow extends ScreenerInput {
    verdict: Verdict;
    volume: ConditionResult | null;
    holder: ConditionResult | null;
}
export interface Counts {
    total: number; evaluated: number; matched: number; notMatched: number; unknown: number;
    missingByCondition: Record<ConditionId, number>;
}

export function isIsoDate(value: unknown): boolean {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateStock(stock: UniverseStock): boolean {
    return ['TWSE', 'TPEx'].includes(stock.market) && stock.kind === 'ordinary'
        && /^[1-9]\d{3}$/.test(stock.code) && !!stock.name.trim()
        && stock.symbol === `${stock.code}.${stock.market === 'TWSE' ? 'TW' : 'TWO'}`;
}

/** 將有限兩位小數轉成百分之一單位，禁止先四捨五入再比較。 */
export function hundredths(value: string, max = 100): bigint | null {
    if (typeof value !== 'string') return null;
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || value.length > 12) return null;
    const [whole = '0', fraction = ''] = value.split('.');
    const scaled = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
    return scaled <= BigInt(max) * BigInt(100) ? scaled : null;
}

/** Parse a display value in 萬 into canonical integer TWD without IEEE-754 arithmetic. */
export function turnoverWanToNtd(value: string): string | null {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole = '0', fraction = ''] = value.split('.');
    const hundredWan = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
    if (hundredWan < BigInt(1) || hundredWan > BigInt(1_000_000_000)) return null;
    return String(hundredWan * BigInt(100));
}

export function formatTurnoverWan(value: string | null | undefined): string | null {
    const amount = value === undefined || value === null ? null : quantity(value);
    if (amount === null) return null;
    const whole = amount / BigInt(10000);
    const fraction = String(amount % BigInt(10000)).padStart(4, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
}

function signedHundredths(value: string): bigint | null {
    if (typeof value !== 'string') return null;
    const magnitude = hundredths(value.replace(/^-/, ''));
    return magnitude === null ? null : value.startsWith('-') ? -magnitude : magnitude;
}

export function validateCriteria(criteria: Criteria): boolean {
    if (!criteria || !['all', 'any'].includes(criteria.mode)) return false;
    const { volume, holder } = criteria;
    if (!volume || !holder || typeof volume.enabled !== 'boolean' || typeof holder.enabled !== 'boolean') return false;
    if (!volume.enabled && !holder.enabled) return false;
    if (!['weekly-increase', 'decrease-to-increase', 'increase-to-decrease'].includes(holder.mode)
        || !Number.isInteger(holder.streakWeeks) || holder.streakWeeks < 1 || holder.streakWeeks > 4) return false;
    if (![volume.turnover, holder.turnover].every((item) => item && typeof item.enabled === 'boolean'
        && typeof item.minimumWan === 'string' && turnoverWanToNtd(item.minimumWan) !== null)) return false;
    return [[volume, 1000], [holder, 100]].every(([condition, max]) => {
        const item = condition as Criteria['volume'];
        if (typeof item.threshold !== 'string') return false;
        const n = hundredths(item.threshold, max as number);
        return n !== null && n > BigInt(0);
    });
}

export function criteriaFingerprint(criteria: Criteria): string {
    if (!validateCriteria(criteria)) throw new Error('invalid_criteria');
    return [SCREENER_VERSION, criteria.mode,
        criteria.volume.enabled ? `v:${hundredths(criteria.volume.threshold, 1000)}:${criteria.volume.turnover.enabled ? turnoverWanToNtd(criteria.volume.turnover.minimumWan) : 'toff'}` : 'v:off',
        criteria.holder.enabled ? `h:${criteria.holder.mode}:${criteria.holder.streakWeeks}:${hundredths(criteria.holder.threshold)}:${criteria.holder.turnover.enabled ? turnoverWanToNtd(criteria.holder.turnover.minimumWan) : 'toff'}` : 'h:off',
    ].join('|');
}

function quantity(value: string): bigint | null {
    return typeof value === 'string' && /^(?:0|[1-9]\d{0,19})$/.test(value) ? BigInt(value) : null;
}
function signedQuantity(value: string): bigint | null {
    const magnitude = typeof value === 'string' ? quantity(value.replace(/^-/, '')) : null;
    return magnitude === null ? null : value.startsWith('-') ? -magnitude : magnitude;
}
const unknown = (reason: ReasonCode): ConditionResult => ({ verdict: 'unknown', reason });
const comparison = (pass: boolean): ConditionResult => ({ verdict: pass ? 'pass' : 'fail', reason: 'none' });

export function validatePair(pair: PeriodPair): boolean {
    return isIsoDate(pair.current) && isIsoDate(pair.previous) && pair.previous < pair.current;
}

/** 日曆／期別由官方提供，發布集合只代表整期發布，不以個股缺列推算日期。 */
export function selectPeriodPair(
    officialPeriods: readonly string[], publishedBySource: readonly (readonly string[])[], through: string,
): PeriodPair | null {
    if (!isIsoDate(through) || !publishedBySource.length
        || officialPeriods.some((day) => !isIsoDate(day))
        || new Set(officialPeriods).size !== officialPeriods.length
        || publishedBySource.some((days) => days.some((day) => !isIsoDate(day)))) throw new Error('invalid_calendar');
    const periods = [...officialPeriods].sort();
    const current = [...periods].reverse().find((day) => day <= through
        && publishedBySource.every((days) => days.includes(day)));
    if (!current) return null;
    const previous = periods[periods.indexOf(current) - 1];
    if (!previous || !publishedBySource.every((days) => days.includes(previous))) return null;
    return { current, previous };
}

export function evaluateVolume(
    current: VolumePoint | null, previous: VolumePoint | null,
    pair: PeriodPair | null, threshold: string,
): ConditionResult {
    const limit = hundredths(threshold, 1000);
    if (limit === null || limit <= BigInt(0)) throw new Error('invalid_threshold');
    if (!pair) return unknown('period_pending');
    if (!validatePair(pair)) return unknown('date_mismatch');
    if (!current) return unknown('missing_current');
    if (!previous) return unknown('missing_previous');
    if (current.date !== pair.current || previous.date !== pair.previous) return unknown('date_mismatch');
    if (current.unit !== 'shares' || previous.unit !== 'shares' || !current.basis
        || current.basis !== previous.basis || current.market !== previous.market
        || current.provenance.source !== previous.provenance.source
        || current.provenance.normalizationVersion !== previous.provenance.normalizationVersion) {
        return unknown('incompatible_source');
    }
    const a = current.shares === null ? null : quantity(current.shares), b = previous.shares === null ? null : quantity(previous.shares);
    if (a === null || b === null) return unknown('invalid_volume');
    if (b === BigInt(0)) return unknown('zero_previous_volume');
    return comparison(a * BigInt(100) >= b * limit);
}

export function evaluateTurnover(current: VolumePoint | null, pair: PeriodPair | null, criteria: TurnoverCriteria): ConditionResult {
    const minimum = turnoverWanToNtd(criteria.minimumWan);
    if (minimum === null) throw new Error('invalid_turnover_threshold');
    if (!criteria.enabled) return comparison(true);
    if (!pair) return unknown('period_pending');
    if (!current) return unknown('missing_current');
    if (current.date !== pair.current) return unknown('date_mismatch');
    if (current.turnoverNtd === undefined || current.turnoverNtd === null) return unknown('missing_turnover');
    const amount = quantity(current.turnoverNtd);
    if (amount === null || current.turnoverCurrency !== 'TWD' || !current.turnoverField
        || !current.turnoverBasis || !current.turnoverMappingVersion) return unknown('invalid_turnover');
    return comparison(amount >= BigInt(minimum));
}

/** 完整 17 級原值核對；第 16 級為調整股數，第 17 級為合計。 */
export function validateTdcc(point: HolderPoint): ReasonCode {
    if (!isIsoDate(point.date)) return 'date_mismatch';
    if (!Array.isArray(point.bands) || point.bands.some((band) => !band || typeof band !== 'object')
        || point.bands.length !== 17 || new Set(point.bands.map((band) => band.level)).size !== 17
        || point.bands.some((band) => !Number.isInteger(band.level) || band.level < 1 || band.level > 17)) return 'incomplete_tdcc';
    const bands = [...point.bands].sort((a, b) => a.level - b.level);
    if (bands.some((band) => quantity(band.holders) === null || (band.level === 16 ? signedQuantity(band.shares) : quantity(band.shares)) === null
        || (band.level === 16 ? signedHundredths(band.ratio) : hundredths(band.ratio)) === null)) return 'invalid_tdcc';
    const total = bands[16]!, adjustment = signedQuantity(bands[15]!.shares)!;
    const shares = bands.slice(0, 15).reduce((sum, band) => sum + quantity(band.shares)!, BigInt(0));
    const holders = bands.slice(0, 15).reduce((sum, band) => sum + quantity(band.holders)!, BigInt(0));
    const ratios = bands.slice(0, 15).reduce((sum, band) => sum + hundredths(band.ratio)!, BigInt(0));
    const totalShares = quantity(total.shares)!;
    const adjustmentRatio = signedHundredths(bands[15]!.ratio)!;
    const abs = (value: bigint) => value < BigInt(0) ? -value : value;
    if (totalShares <= BigInt(0) || holders !== quantity(total.holders)
        || (shares + adjustment !== totalShares && shares - adjustment !== totalShares)
        || hundredths(total.ratio) !== BigInt(10000)
        || (abs(ratios + adjustmentRatio - BigInt(10000)) > BigInt(16)
            && abs(ratios - adjustmentRatio - BigInt(10000)) > BigInt(16))) return 'invalid_tdcc';
    // Official ratios truncate to two decimals: at most 0.01 pp per band,
    // not a 0.5 pp tolerance that could hide a wrong screening threshold.
    for (const band of bands.slice(0, 15)) {
        const delta = quantity(band.shares)! * BigInt(10000) - hundredths(band.ratio)! * totalShares;
        if ((delta < BigInt(0) ? -delta : delta) > totalShares) return 'invalid_tdcc';
    }
    return 'none';
}

export function evaluateHolder(
    current: HolderPoint | null, previous: HolderPoint | null,
    pair: PeriodPair | null, threshold: string,
): ConditionResult {
    const limit = hundredths(threshold);
    if (limit === null || limit <= BigInt(0)) throw new Error('invalid_threshold');
    if (!pair) return unknown('period_pending');
    if (!validatePair(pair)) return unknown('date_mismatch');
    if (!current) return unknown('missing_current');
    if (!previous) return unknown('missing_previous');
    if (current.date !== pair.current || previous.date !== pair.previous) return unknown('date_mismatch');
    if (current.provenance.source !== previous.provenance.source
        || current.provenance.normalizationVersion !== previous.provenance.normalizationVersion) return unknown('incompatible_source');
    for (const point of [current, previous]) {
        const reason = validateTdcc(point);
        if (reason !== 'none') return unknown(reason);
    }
    const ratio = (point: HolderPoint) => hundredths(point.bands.find((band) => band.level === 15)!.ratio)!;
    return comparison(ratio(current) - ratio(previous) >= limit);
}

const holderRatio = (point: HolderPoint) => hundredths(point.bands.find((band) => band.level === 15)!.ratio)!;

/** Evaluate a v2 holder mode using exact official-period identity, never nearest rows. */
export function evaluateHolderSeries(
    series: readonly HolderPoint[], officialPeriods: readonly string[] | undefined,
    mode: HolderMode, streakWeeks: number, threshold: string,
): ConditionResult {
    const limit = hundredths(threshold);
    if (limit === null || limit <= BigInt(0) || !Number.isInteger(streakWeeks) || streakWeeks < 1 || streakWeeks > 4
        || !['weekly-increase', 'decrease-to-increase', 'increase-to-decrease'].includes(mode)) throw new Error('invalid_threshold');
    const required = mode === 'weekly-increase' ? 2 : streakWeeks + 2;
    if (!officialPeriods || officialPeriods.length < required) return unknown('history_pending');
    const expected = officialPeriods.slice(-required);
    if (expected.some((date) => !isIsoDate(date)) || new Set(expected).size !== expected.length
        || expected.some((date, index) => index > 0 && date <= expected[index - 1]!)) return unknown('date_mismatch');
    const byDate = new Map(series.map((point) => [point.date, point]));
    const points = expected.map((date) => byDate.get(date));
    if (points.some((point) => !point)) return unknown('history_pending');
    const resolved = points as HolderPoint[];
    if (new Set(resolved.map((point) => point.provenance.source)).size !== 1
        || new Set(resolved.map((point) => point.provenance.normalizationVersion)).size !== 1) return unknown('incompatible_source');
    for (const point of resolved) {
        const reason = validateTdcc(point);
        if (reason !== 'none') return unknown(reason);
    }
    const changes = resolved.slice(1).map((point, index) => holderRatio(point) - holderRatio(resolved[index]!));
    const latest = changes.at(-1)!;
    if (mode === 'weekly-increase') return { ...comparison(latest >= limit), changesPpHundredths: changes.map(String), streakWeeks: 0 };
    const before = changes.slice(0, -1);
    const directionPass = mode === 'decrease-to-increase' ? before.every((value) => value < BigInt(0)) : before.every((value) => value > BigInt(0));
    const reversalPass = mode === 'decrease-to-increase' ? latest >= limit : latest <= -limit;
    return { ...comparison(directionPass && reversalPass), changesPpHundredths: changes.map(String), streakWeeks };
}

function withTurnover(signal: ConditionResult, turnover: ConditionResult, minimumNtd: string | null): ConditionResult {
    const verdict = combineVerdicts([signal.verdict, turnover.verdict], 'all');
    const reason = verdict === 'unknown' ? signal.verdict === 'unknown' ? signal.reason : turnover.reason : 'none';
    return { verdict, reason, signal: { verdict: signal.verdict, reason: signal.reason },
        turnover: { verdict: turnover.verdict, reason: turnover.reason, minimumNtd },
        changesPpHundredths: signal.changesPpHundredths, streakWeeks: signal.streakWeeks };
}

export function combineVerdicts(values: Verdict[], mode: Criteria['mode']): Verdict {
    if (!values.length) throw new Error('no_conditions');
    if (mode === 'all') return values.includes('fail') ? 'fail' : values.every((v) => v === 'pass') ? 'pass' : 'unknown';
    return values.includes('pass') ? 'pass' : values.every((v) => v === 'fail') ? 'fail' : 'unknown';
}

export function screenStocks(inputs: ScreenerInput[], anchors: ScreenerAnchors, criteria: Criteria) {
    if (!validateCriteria(criteria)) throw new Error('invalid_criteria');
    if (inputs.some((stock) => !validateStock(stock)) || new Set(inputs.map((row) => row.code)).size !== inputs.length) throw new Error('invalid_universe');
    const emptyCounts = (): Counts => ({ total: 0, evaluated: 0, matched: 0, notMatched: 0, unknown: 0,
        missingByCondition: { 'volume-multiple': 0, 'large-holder-weekly-pp': 0 } });
    const counts = emptyCounts();
    const byMarket: Record<ScreenerMarket, Counts> = { TWSE: emptyCounts(), TPEx: emptyCounts() };
    const rows: ScreenerRow[] = inputs.map((stock) => {
        const volumeSignal = criteria.volume.enabled ? evaluateVolume(stock.currentVolume, stock.previousVolume, anchors.daily, criteria.volume.threshold) : null;
        const volume = volumeSignal ? withTurnover(volumeSignal, evaluateTurnover(stock.currentVolume, anchors.daily, criteria.volume.turnover),
            criteria.volume.turnover.enabled ? turnoverWanToNtd(criteria.volume.turnover.minimumWan) : null) : null;
        const legacySeries = [stock.previousHolder, stock.currentHolder].filter((point): point is HolderPoint => point !== null);
        const series = stock.holderSeries ?? legacySeries;
        const weeklyPeriods = anchors.weeklyPeriods ?? (anchors.weekly ? [anchors.weekly.previous, anchors.weekly.current] : undefined);
        const holderSignal = criteria.holder.enabled ? evaluateHolderSeries(series, weeklyPeriods, criteria.holder.mode, criteria.holder.streakWeeks, criteria.holder.threshold) : null;
        const holder = holderSignal ? withTurnover(holderSignal, evaluateTurnover(stock.currentVolume, anchors.daily, criteria.holder.turnover),
            criteria.holder.turnover.enabled ? turnoverWanToNtd(criteria.holder.turnover.minimumWan) : null) : null;
        if (volume && ((stock.currentVolume && stock.currentVolume.market !== stock.market)
            || (stock.previousVolume && stock.previousVolume.market !== stock.market))) Object.assign(volume, unknown('incompatible_source'));
        const verdict = combineVerdicts([volume, holder].filter((v): v is ConditionResult => v !== null).map((v) => v.verdict), criteria.mode);
        for (const summary of [counts, byMarket[stock.market]]) {
            summary.total++;
            if (verdict === 'unknown') summary.unknown++;
            else { summary.evaluated++; if (verdict === 'pass') summary.matched++; else summary.notMatched++; }
            if (volume?.verdict === 'unknown') summary.missingByCondition['volume-multiple']++;
            if (holder?.verdict === 'unknown') summary.missingByCondition['large-holder-weekly-pp']++;
        }
        return { ...stock, volume, holder, verdict };
    });
    return { rows, counts, byMarket };
}
