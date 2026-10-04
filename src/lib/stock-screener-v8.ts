/** 布林三階段：背景建置固定指標；查詢只讀凍結統計，不抓來源或觸發交易。 */
import { combineVerdicts, type Verdict, type ScreenerMarket } from './stock-screener-domain.ts';
import { validateCanonicalOhlcv, canonicalVolumeShares, type CanonicalOhlcv } from './stock-screener-ohlcv.ts';
import { technicalEvidenceHash } from './stock-screener-technical-patterns.ts';
import { DEFAULT_CRITERIA_V7, validateCriteriaV7, isV7Preference,
    type CriteriaV7, type ScreenerPreferenceV7 } from './stock-screener-v7.ts';

export const SCREENER_V8_VERSION = 8 as const;
export const SCREENER_V8_SCHEMA_VERSION = 8 as const;
export const SCREENER_V8_FORMULA_VERSION = 'bollinger-squeeze-stages-v1' as const;
export const SCREENER_V8_MAPPING_VERSION = 'official-daily-ohlcv-turnover-v1' as const;
export const BOLLINGER_SOURCE_POLICY_VERSION = 'bollinger-source-selection-v1' as const;
export type BollingerMappingVersion = typeof SCREENER_V8_MAPPING_VERSION | `${typeof BOLLINGER_SOURCE_POLICY_VERSION}:${string}`;
export const validBollingerMapping = (v: unknown): v is BollingerMappingVersion => v === SCREENER_V8_MAPPING_VERSION
    || typeof v === 'string' && /^bollinger-source-selection-v1:[a-f0-9]{64}$/.test(v);
export const BOLLINGER_HISTORY_CAPABILITY = 'bollinger-history-v1' as const;
export const BOLLINGER_STAGES = ['compressing', 'preparing', 'breakout'] as const;
export type BollingerStage = typeof BOLLINGER_STAGES[number] | 'notMatched' | 'unknown';
export interface BollingerSqueezeCriteria {
    enabled: boolean;
    stages: Array<typeof BOLLINGER_STAGES[number]>;
    lookbackDays: number;
    percentile: number;
    minimumPrice: number;
    minimumAverageTurnoverNtd: string;
    turnoverDays: number;
    fastMaDays: number;
    slowMaDays: number;
    trendLag: number;
    momentumDays: number;
    bbwLag: number;
    bbwShortDays: number;
    bbwLongDays: number;
    bMinimum: number;
    preparingThreshold: number;
    volumeShortDays: number;
    volumeLongDays: number;
    contractionRatio: string;
    setupDays: number;
    breakoutVolumeDays: number;
    breakoutVolumeRatio: string;
}
export const DEFAULT_BOLLINGER_SQUEEZE: BollingerSqueezeCriteria = {
    enabled: false, stages: [...BOLLINGER_STAGES], lookbackDays: 120, percentile: 20,
    minimumPrice: 20, minimumAverageTurnoverNtd: '50000000', turnoverDays: 20,
    fastMaDays: 20, slowMaDays: 60, trendLag: 5, momentumDays: 70,
    bbwLag: 5, bbwShortDays: 5, bbwLongDays: 20, bMinimum: 0.60, preparingThreshold: 0.85,
    volumeShortDays: 5, volumeLongDays: 20, contractionRatio: '1', setupDays: 5,
    breakoutVolumeDays: 20, breakoutVolumeRatio: '1.3',
};
export interface CriteriaV8 extends CriteriaV7 { bollSqueezeStages: BollingerSqueezeCriteria }
const integer = (n: unknown, min = 1, max = 250): n is number => typeof n === 'number'
    && Number.isInteger(n) && n >= min && n <= max;
const bounded = (n: unknown, min: number, max: number): n is number => typeof n === 'number'
    && Number.isFinite(n) && n >= min && n <= max;
const decimal = (s: unknown): s is string => typeof s === 'string'
    && /^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/.test(s) && Number(s) > 0 && Number(s) <= 10;
const canonicalAmount = (s: unknown): bigint | null => typeof s === 'string'
    && /^(?:0|[1-9]\d{0,24})$/.test(s) ? BigInt(s) : null;
const iso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** 包含最早 setup 的 BOLL 暖機，不能只加回看天數而漏掉前 19 日。 */
export function bollingerRequiredHistory(c: BollingerSqueezeCriteria): number {
    const setupHistory = Math.max(20 + c.lookbackDays, 19 + c.bbwLongDays, 20 + c.bbwLag,
        c.slowMaDays + c.trendLag, c.fastMaDays, c.momentumDays + 1,
        c.turnoverDays, c.volumeLongDays) + c.setupDays;
    return Math.max(setupHistory, c.breakoutVolumeDays + 1);
}
export function validateBollingerSqueeze(c: BollingerSqueezeCriteria): boolean {
    if (typeof BigInt !== 'function') return false;
    if (!c || Object.keys(c).sort().join() !== Object.keys(DEFAULT_BOLLINGER_SQUEEZE).sort().join()
        || typeof c.enabled !== 'boolean' || !Array.isArray(c.stages) || !c.stages.length
        || new Set(c.stages).size !== c.stages.length || c.stages.some(s => !BOLLINGER_STAGES.includes(s))) return false;
    return integer(c.lookbackDays, 60, 250) && bounded(c.percentile, 5, 50)
        && bounded(c.minimumPrice, 0.01, 1_000_000) && canonicalAmount(c.minimumAverageTurnoverNtd) !== null
        && BigInt(c.minimumAverageTurnoverNtd) <= BigInt('1000000000000')
        && [c.turnoverDays, c.fastMaDays, c.slowMaDays, c.momentumDays, c.bbwShortDays,
            c.bbwLongDays, c.volumeShortDays, c.volumeLongDays, c.breakoutVolumeDays].every(n => integer(n))
        && [c.trendLag, c.bbwLag, c.setupDays].every(n => integer(n, 1, 20))
        && c.fastMaDays < c.slowMaDays && c.bbwShortDays < c.bbwLongDays
        && c.volumeShortDays < c.volumeLongDays && bounded(c.bMinimum, 0, 1)
        && bounded(c.preparingThreshold, 0, 1) && c.bMinimum < c.preparingThreshold
        && decimal(c.contractionRatio) && decimal(c.breakoutVolumeRatio)
        && bollingerRequiredHistory(c) <= 400;
}
export function migrateCriteriaV7ToV8(criteria: CriteriaV7): CriteriaV8 {
    return { ...structuredClone(criteria), bollSqueezeStages: structuredClone(DEFAULT_BOLLINGER_SQUEEZE) };
}
export function validateCriteriaV8(criteria: CriteriaV8): boolean {
    if (!criteria || !validateBollingerSqueeze(criteria.bollSqueezeStages)
        || Object.keys(criteria).sort().join() !== [...Object.keys(DEFAULT_CRITERIA_V7), 'bollSqueezeStages'].sort().join()) return false;
    const { bollSqueezeStages, ...legacy } = criteria;
    // 驗證舊欄位但允許只開新策略，不放寬任何既有門檻。
    try {
        return validateCriteriaV7(legacy) || bollSqueezeStages.enabled && validateCriteriaV7({ ...legacy,
            bollPosition: { ...legacy.bollPosition, enabled: true } });
    } catch { return false; }
}
export interface ScreenerPreferenceV8 extends Omit<ScreenerPreferenceV7, 'version' | 'query'> {
    version: 8;
    query: Omit<ScreenerPreferenceV7['query'], 'criteria'> & { criteria: CriteriaV8 };
}
export function migratePreferenceV7ToV8(value: unknown): ScreenerPreferenceV8 | null {
    return isV7Preference(value) ? { version: 8, query: { ...structuredClone(value.query),
        criteria: migrateCriteriaV7ToV8(value.query.criteria) } } : null;
}
export function bollingerCriteriaFingerprint(c: BollingerSqueezeCriteria): string {
    if (!validateBollingerSqueeze(c)) throw new Error('invalid_bollinger_criteria');
    return JSON.stringify(Object.fromEntries(Object.keys(DEFAULT_BOLLINGER_SQUEEZE).map(key => [key,
        key === 'stages' ? [...c.stages].sort() : c[key as keyof BollingerSqueezeCriteria]])));
}

export interface TurnoverOhlcv extends CanonicalOhlcv { turnoverNtd: string | null }
export interface BollingerPoint {
    sessionDate: string;
    close: number | null;
    volumeShares: string | null;
    turnoverNtd: string | null;
    boll: { upper: number; middle: number; lower: number; bbw: number | null; b: number | null } | null;
}
interface NumericPrefix { sums: number[]; counts: number[] }
interface ExactPrefix { sums: string[]; counts: number[] }
export interface BollingerFrozenFeatures {
    version: 8;
    formulaVersion: typeof SCREENER_V8_FORMULA_VERSION;
    sourceMappingVersion: BollingerMappingVersion;
    capability: typeof BOLLINGER_HISTORY_CAPABILITY;
    through: string;
    sessions: string[];
    points: BollingerPoint[];
    close: NumericPrefix;
    bbw: NumericPrefix;
    volume: ExactPrefix;
    turnover: ExactPrefix;
    evidenceHash: string;
    sourceHashes: string[];
}
const numericPrefix = (values: Array<number | null>): NumericPrefix => {
    const p: NumericPrefix = { sums: [0], counts: [0] };
    for (const v of values) { p.sums.push(p.sums.at(-1)! + (v ?? 0)); p.counts.push(p.counts.at(-1)! + (v === null ? 0 : 1)); }
    return p;
};
const exactPrefix = (values: Array<string | null>): ExactPrefix => {
    const p: ExactPrefix = { sums: ['0'], counts: [0] };
    for (const v of values) { p.sums.push((BigInt(p.sums.at(-1)!) + BigInt(v ?? '0')).toString()); p.counts.push(p.counts.at(-1)! + (v === null ? 0 : 1)); }
    return p;
};

/** 僅由背景 publisher 呼叫；以官方 session grid 對齊，缺日不壓縮序列。 */
export async function buildBollingerFrozenFeatures(bars: readonly TurnoverOhlcv[], sessions: readonly string[], sourceHashes: string[] = [],
    sourceMappingVersion: BollingerMappingVersion = SCREENER_V8_MAPPING_VERSION): Promise<BollingerFrozenFeatures> {
    if (!Array.isArray(bars) || !Array.isArray(sessions) || !sessions.length || sessions.length > 400
        || sessions.some((d, i) => !iso(d) || i > 0 && d <= sessions[i - 1]!)
        || new Set(bars.map(b => b.sessionDate)).size !== bars.length
        || bars.some(b => !sessions.includes(b.sessionDate)) || !validBollingerMapping(sourceMappingVersion)
        || sourceHashes.some(h => !/^[a-f0-9]{64}$/.test(h))) throw new Error('invalid_bollinger_history');
    const byDate = new Map(bars.map(b => [b.sessionDate, b]));
    const points: BollingerPoint[] = [];
    for (const sessionDate of sessions) {
        const bar = byDate.get(sessionDate), valid = !!bar && validateCanonicalOhlcv(bar);
        const point: BollingerPoint = { sessionDate, close: valid ? Number(bar.close) : null,
            volumeShares: valid ? bar.volumeShares : null,
            turnoverNtd: valid && canonicalAmount(bar.turnoverNtd) !== null ? bar.turnoverNtd : null, boll: null };
        points.push(point);
        const closes = points.slice(-20).map(p => p.close);
        if (closes.length === 20 && closes.every((v): v is number => v !== null)) {
            const middle = closes.reduce((a, b) => a + b, 0) / 20;
            const sd = Math.sqrt(closes.reduce((sum, c) => sum + (c - middle) ** 2, 0) / 20);
            const upper = middle + 2 * sd, lower = middle - 2 * sd, width = upper - lower;
            point.boll = { upper, middle, lower, bbw: width > 0 && middle > 0 ? width / middle : null,
                b: width > 0 ? (point.close! - lower) / width : null };
        }
    }
    const value = { version: 8 as const, formulaVersion: SCREENER_V8_FORMULA_VERSION,
        sourceMappingVersion, capability: BOLLINGER_HISTORY_CAPABILITY,
        through: sessions.at(-1)!, sessions: [...sessions], points,
        close: numericPrefix(points.map(p => p.close)), bbw: numericPrefix(points.map(p => p.boll?.bbw ?? null)),
        volume: exactPrefix(points.map(p => p.volumeShares)), turnover: exactPrefix(points.map(p => p.turnoverNtd)),
        sourceHashes: [...sourceHashes].sort() };
    return { ...value, evidenceHash: await technicalEvidenceHash(value) };
}

export function type7Quantile(values: readonly number[], percentile: number): number | null {
    if (!values.length || !bounded(percentile, 0, 100) || values.some(n => !Number.isFinite(n))) return null;
    const sorted = [...values].sort((a, b) => a - b), h = (sorted.length - 1) * percentile / 100;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}
const range = (f: BollingerFrozenFeatures, end: number, days: number) => end >= days - 1 && end < f.sessions.length
    ? f.sessions.slice(end - days + 1, end + 1) : [];
const average = (p: NumericPrefix, end: number, days: number): number | null => end >= days - 1
    && p.counts[end + 1]! - p.counts[end + 1 - days]! === days
    ? (p.sums[end + 1]! - p.sums[end + 1 - days]!) / days : null;
const exactSum = (p: ExactPrefix, end: number, days: number): bigint | null => end >= days - 1
    && p.counts[end + 1]! - p.counts[end + 1 - days]! === days
    ? BigInt(p.sums[end + 1]!) - BigInt(p.sums[end + 1 - days]!) : null;
const scaled = (s: string) => { const [whole, fraction = ''] = s.split('.'); return BigInt(whole!) * BigInt('1000000') + BigInt(fraction.padEnd(6, '0')); };
export type BollingerReason = 'none' | 'missing_ohlcv' | 'missing_turnover' | 'missing_volume'
    | 'indicator_warmup' | 'zero_bollinger_width' | 'history_pending';
export interface BollingerCheck {
    verdict: Verdict;
    reason: BollingerReason;
    actual: unknown;
    threshold: unknown;
    dates: string[];
}
const check = (pass: boolean | null, actual: unknown, threshold: unknown, dates: string[], reason: BollingerReason): BollingerCheck =>
    ({ verdict: pass === null ? 'unknown' : pass ? 'pass' : 'fail', reason: pass === null ? reason : 'none', actual, threshold, dates });
const verdict = (checks: Record<string, BollingerCheck>): Verdict => combineVerdicts(Object.values(checks).map(c => c.verdict), 'all');

export function evaluateBollingerSetup(f: BollingerFrozenFeatures, c: BollingerSqueezeCriteria, t: number, ordinary = true) {
    const p = f.points[t], boll = p?.boll;
    const fast = average(f.close, t, c.fastMaDays), slow = average(f.close, t, c.slowMaDays), pastSlow = average(f.close, t - c.trendLag, c.slowMaDays);
    const momentumClose = f.points[t - c.momentumDays]?.close ?? null;
    const momentum = p?.close != null && momentumClose !== null ? p.close / momentumClose - 1 : null;
    const amount = exactSum(f.turnover, t, c.turnoverDays);
    const gate: Record<string, BollingerCheck> = {
        ordinary: check(ordinary, ordinary, true, [], 'none'),
        price: check(p?.close == null ? null : p.close >= c.minimumPrice, p?.close ?? null, c.minimumPrice, range(f, t, 1), 'missing_ohlcv'),
        liquidity: check(amount === null ? null : amount >= BigInt(c.minimumAverageTurnoverNtd) * BigInt(c.turnoverDays),
            amount === null ? null : { sumTwd: amount.toString(), days: c.turnoverDays }, c.minimumAverageTurnoverNtd, range(f, t, c.turnoverDays), 'missing_turnover'),
        aboveFastMa: check(p?.close == null || fast === null ? null : p.close > fast, { close: p?.close ?? null, ma: fast }, c.fastMaDays, range(f, t, c.fastMaDays), 'missing_ohlcv'),
        maStructure: check(fast === null || slow === null ? null : fast > slow, { fast, slow }, [c.fastMaDays, c.slowMaDays], range(f, t, c.slowMaDays), 'missing_ohlcv'),
        maSlope: check(slow === null || pastSlow === null ? null : slow >= pastSlow, { current: slow, previous: pastSlow }, c.trendLag,
            range(f, t, c.slowMaDays + c.trendLag), 'missing_ohlcv'),
        momentum: check(momentum === null ? null : momentum > 0, momentum, 0, range(f, t, c.momentumDays + 1), 'missing_ohlcv'),
    };
    const prior = t < 0 ? [] : f.points.slice(Math.max(0, t - c.lookbackDays), t).map(p => p.boll?.bbw ?? null);
    const q = t >= c.lookbackDays && prior.length === c.lookbackDays && prior.every((v): v is number => v !== null)
        ? type7Quantile(prior, c.percentile) : null;
    const bbw = boll?.bbw ?? null, b = boll?.b ?? null, previous = f.points[t - c.bbwLag]?.boll?.bbw ?? null;
    const short = average(f.bbw, t, c.bbwShortDays), long = average(f.bbw, t, c.bbwLongDays);
    const vs = exactSum(f.volume, t, c.volumeShortDays), vl = exactSum(f.volume, t, c.volumeLongDays);
    const compression: Record<string, BollingerCheck> = {
        relativeBandwidth: check(bbw === null || q === null ? null : bbw <= q, { bbw, quantile: q, algorithm: 'type-7', prior }, c.percentile,
            range(f, t - 1, c.lookbackDays), boll && bbw === null ? 'zero_bollinger_width' : 'indicator_warmup'),
        shrinking: check(bbw === null || previous === null ? null : bbw < previous, { current: bbw, previous }, c.bbwLag, range(f, t, c.bbwLag + 1), 'indicator_warmup'),
        bandwidthMeans: check(short === null || long === null ? null : short < long, { short, long }, [c.bbwShortDays, c.bbwLongDays], range(f, t, c.bbwLongDays), 'indicator_warmup'),
        bandPosition: check(b === null ? null : b >= c.bMinimum && b <= 1, b, [c.bMinimum, 1], range(f, t, 1), boll ? 'zero_bollinger_width' : 'indicator_warmup'),
        contraction: check(vs === null || vl === null ? null : vs * BigInt(c.volumeLongDays) * BigInt('1000000') < vl * BigInt(c.volumeShortDays) * scaled(c.contractionRatio),
            { shortSum: vs?.toString() ?? null, shortDays: c.volumeShortDays, longSum: vl?.toString() ?? null, longDays: c.volumeLongDays },
            c.contractionRatio, range(f, t, c.volumeLongDays), 'missing_volume'),
    };
    return { date: p?.sessionDate ?? null, gate, compression, gateVerdict: verdict(gate),
        verdict: combineVerdicts([verdict(gate), verdict(compression)], 'all'), b, bbw, quantile: q };
}
export interface BollingerOutcome {
    stage: BollingerStage;
    branchVerdict: Verdict;
    compressing: Verdict;
    preparing: Verdict;
    breakout: Verdict;
    date: string;
    previousDate: string | null;
    formulaVersion: typeof SCREENER_V8_FORMULA_VERSION;
    sourceMappingVersion: BollingerMappingVersion;
    criteriaFingerprint: string;
    sourceEvidenceHash: string;
    setup: ReturnType<typeof evaluateBollingerSetup>;
    recentSetups: Array<ReturnType<typeof evaluateBollingerSetup>>;
    latestSetupDate: string | null;
    latestSetupHash: string | null;
    breakoutChecks: Record<string, BollingerCheck>;
}
export function classifyBollingerStages(breakout: Verdict, preparing: Verdict, compressing: Verdict): BollingerStage {
    for (const [stage, v] of [['breakout', breakout], ['preparing', preparing], ['compressing', compressing]] as const) {
        if (v === 'unknown') return 'unknown';
        if (v === 'pass') return stage;
    }
    return 'notMatched';
}
/** 查詢路徑可呼叫：使用已存 BOLL／prefix，只做有界條件判定與 evidence hash。 */
export async function evaluateBollingerStages(f: BollingerFrozenFeatures, c: BollingerSqueezeCriteria, ordinary = true): Promise<BollingerOutcome> {
    if (!validateBollingerSqueeze(c)) throw new Error('invalid_bollinger_criteria');
    if (f.version !== 8 || f.formulaVersion !== SCREENER_V8_FORMULA_VERSION || !validBollingerMapping(f.sourceMappingVersion)
        || f.capability !== BOLLINGER_HISTORY_CAPABILITY || f.sessions.at(-1) !== f.through || !/^[a-f0-9]{64}$/.test(f.evidenceHash)) throw new Error('invalid_bollinger_snapshot');
    const t = f.points.length - 1, setup = evaluateBollingerSetup(f, c, t, ordinary);
    const recentSetups = Array.from({ length: c.setupDays }, (_, i) => evaluateBollingerSetup(f, c, t - 1 - i, ordinary));
    const latest = recentSetups.find(s => s.verdict === 'pass');
    const recent = combineVerdicts(recentSetups.map(s => s.verdict), 'any');
    const p = f.points[t], previous = f.points[t - 1];
    const volume = p?.volumeShares == null ? null : canonicalVolumeShares(p.volumeShares);
    const sum = exactSum(f.volume, t - 1, c.breakoutVolumeDays);
    const breakoutChecks: Record<string, BollingerCheck> = {
        firstUpperCross: check(p?.close == null || !p.boll || previous?.close == null || !previous.boll ? null
            : p.close > p.boll.upper && previous.close <= previous.boll.upper,
            { current: p ?? null, previous: previous ?? null }, 'close_D > upper_D && close_P <= upper_P', range(f, t, 2), 'missing_ohlcv'),
        recentSetup: { verdict: recent, reason: recent === 'unknown' ? 'history_pending' : 'none',
            actual: recentSetups.map(s => ({ date: s.date, verdict: s.verdict })), threshold: c.setupDays, dates: range(f, t - 1, c.setupDays) },
        expansion: check(volume === null || sum === null ? null : volume * BigInt(c.breakoutVolumeDays) * BigInt('1000000') > sum * scaled(c.breakoutVolumeRatio),
            { currentShares: volume?.toString() ?? null, baselineSumShares: sum?.toString() ?? null, baselineDays: c.breakoutVolumeDays },
            c.breakoutVolumeRatio, range(f, t - 1, c.breakoutVolumeDays), 'missing_volume'),
    };
    const breakout = combineVerdicts([setup.gateVerdict, verdict(breakoutChecks)], 'all');
    const preparing = combineVerdicts([setup.verdict, setup.b === null ? 'unknown' : setup.b >= c.preparingThreshold ? 'pass' : 'fail'], 'all');
    const stage = classifyBollingerStages(breakout, preparing, setup.verdict);
    const criteriaFingerprint = bollingerCriteriaFingerprint(c);
    return { stage, branchVerdict: stage === 'unknown' ? 'unknown' : stage === 'notMatched' ? 'fail' : c.stages.includes(stage) ? 'pass' : 'fail',
        compressing: setup.verdict, preparing, breakout, date: f.through, previousDate: previous?.sessionDate ?? null,
        formulaVersion: SCREENER_V8_FORMULA_VERSION, sourceMappingVersion: f.sourceMappingVersion,
        criteriaFingerprint, sourceEvidenceHash: f.evidenceHash, setup, recentSetups,
        latestSetupDate: latest?.date ?? null, latestSetupHash: latest ? await technicalEvidenceHash({ criteriaFingerprint, setup: latest }) : null,
        breakoutChecks };
}
export function countBollingerStages(rows: Array<{ market: ScreenerMarket; stage: BollingerStage }>) {
    const empty = () => ({ total: 0, breakout: 0, preparing: 0, compressing: 0, notMatched: 0, unknown: 0 });
    const total = empty(), markets = { TWSE: empty(), TPEx: empty() };
    for (const row of rows) { total.total++; total[row.stage]++; markets[row.market].total++; markets[row.market][row.stage]++; }
    return { total, markets };
}
