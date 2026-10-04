/** 收盤後選股 v7 技術訊號純函式；不得在此模組抓來源、寫 DB 或觸發交易。 */
import { bollinger, macd, rsi, stoch, type IndicatorPoint } from './indicators.ts';
import { combineVerdicts, hundredths, type Verdict } from './stock-screener-domain.ts';
import { canonicalOhlcvCandles } from './stock-screener-v4.ts';
import { canonicalVolumeShares, SCREENER_OHLCV_V4_MAPPING_VERSION, type CanonicalOhlcv } from './stock-screener-ohlcv.ts';
import {
    DEFAULT_CRITERIA_V6, effectiveCriteriaV6, validateCriteriaV6,
    type CriteriaV6, type InstitutionalOutcomesV6, type ScreenerInputV6, type ScreenerPreferenceV6,
    type ScreenerSortV6,
} from './stock-screener-v6.ts';

export const SCREENER_V7_VERSION = 7 as const;
export const SCREENER_V7_SCHEMA_VERSION = 7 as const;
export const SCREENER_V7_FORMULA_VERSION = 'after-market-v7-boll-rsi-kd-macd-1' as const;

export type BollPositionMode = 'upper-outside' | 'lower-outside' | 'middle-near';
export type MiddleTrend = 'any' | 'rising' | 'falling';
export type OscillatorCrossMode = 'high-death-cross' | 'low-golden-cross';
export type MacdSignalMode = 'approach-zero-below' | 'approach-zero-above' | 'cross-zero-up' | 'cross-zero-down'
    | 'below-zero-golden-cross' | 'below-zero-death-cross' | 'above-zero-golden-cross'
    | 'above-zero-death-cross' | 'any-golden-cross' | 'any-death-cross';

export interface VolumeConfirmationCriteria {
    enabled: boolean;
    baselineDays: number;
    ratio: string;
    minimumAverageVolumeEnabled: boolean;
    minimumAverageVolumeLots: string;
}
export interface BollPositionCriteria {
    enabled: boolean;
    mode: BollPositionMode;
    tolerancePercent: string;
    middleTrend: MiddleTrend;
    volumeConfirmation: VolumeConfirmationCriteria;
}
export interface OscillatorCrossCriteria {
    enabled: boolean;
    mode: OscillatorCrossMode;
    highThreshold: string;
    lowThreshold: string;
    volumeConfirmation: VolumeConfirmationCriteria;
}
export interface MacdSignalCriteria {
    enabled: boolean;
    mode: MacdSignalMode;
    approachThresholdPct: string;
    volumeConfirmation: VolumeConfirmationCriteria;
}
export interface CriteriaV7 extends CriteriaV6 {
    bollPosition: BollPositionCriteria;
    rsiCross: OscillatorCrossCriteria;
    kdCross: OscillatorCrossCriteria;
    macdSignal: MacdSignalCriteria;
}

const volumeDefaults = (): VolumeConfirmationCriteria => ({
    enabled: false, baselineDays: 20, ratio: '1.2', minimumAverageVolumeEnabled: false, minimumAverageVolumeLots: '1000',
});
export const DEFAULT_CRITERIA_V7: CriteriaV7 = {
    ...DEFAULT_CRITERIA_V6,
    volume: { ...DEFAULT_CRITERIA_V6.volume, turnover: { ...DEFAULT_CRITERIA_V6.volume.turnover } },
    holder: { ...DEFAULT_CRITERIA_V6.holder, turnover: { ...DEFAULT_CRITERIA_V6.holder.turnover } },
    fractal: { ...DEFAULT_CRITERIA_V6.fractal }, bollReversal: { ...DEFAULT_CRITERIA_V6.bollReversal },
    ma: { ...DEFAULT_CRITERIA_V6.ma }, divergence: { ...DEFAULT_CRITERIA_V6.divergence },
    largeHolderTrend: { ...DEFAULT_CRITERIA_V6.largeHolderTrend },
    largeHolderConcentration: { ...DEFAULT_CRITERIA_V6.largeHolderConcentration },
    retailHolderDecline: { ...DEFAULT_CRITERIA_V6.retailHolderDecline },
    trustOwnership: { ...DEFAULT_CRITERIA_V6.trustOwnership }, priceMargin: { ...DEFAULT_CRITERIA_V6.priceMargin },
    shortMarginRatio: { ...DEFAULT_CRITERIA_V6.shortMarginRatio }, closeHigh: { ...DEFAULT_CRITERIA_V6.closeHigh },
    closeSmaBreakout: { ...DEFAULT_CRITERIA_V6.closeSmaBreakout },
    foreignReversal: { ...DEFAULT_CRITERIA_V6.foreignReversal }, trustReversal: { ...DEFAULT_CRITERIA_V6.trustReversal },
    bollPosition: { enabled: false, mode: 'upper-outside', tolerancePercent: '10', middleTrend: 'any', volumeConfirmation: volumeDefaults() },
    rsiCross: { enabled: false, mode: 'low-golden-cross', highThreshold: '80', lowThreshold: '20', volumeConfirmation: volumeDefaults() },
    kdCross: { enabled: false, mode: 'low-golden-cross', highThreshold: '80', lowThreshold: '20', volumeConfirmation: volumeDefaults() },
    macdSignal: { enabled: false, mode: 'approach-zero-below', approachThresholdPct: '0.25', volumeConfirmation: volumeDefaults() },
};

export const BOLL_POSITION_MODES: readonly BollPositionMode[] = ['upper-outside', 'lower-outside', 'middle-near'];
export const MIDDLE_TRENDS: readonly MiddleTrend[] = ['any', 'rising', 'falling'];
export const OSCILLATOR_CROSS_MODES: readonly OscillatorCrossMode[] = ['high-death-cross', 'low-golden-cross'];
export const MACD_SIGNAL_MODES: readonly MacdSignalMode[] = ['approach-zero-below', 'approach-zero-above', 'cross-zero-up',
    'cross-zero-down', 'below-zero-golden-cross', 'below-zero-death-cross', 'above-zero-golden-cross',
    'above-zero-death-cross', 'any-golden-cross', 'any-death-cross'];

const integerLots = (value: string): bigint | null => typeof value === 'string' && /^(?:0|[1-9]\d{0,9})$/.test(value)
    ? BigInt(value) : null;
const validVolume = (value: VolumeConfirmationCriteria) => !!value && typeof value.enabled === 'boolean'
    && Number.isInteger(value.baselineDays) && value.baselineDays >= 5 && value.baselineDays <= 60
    && hundredths(value.ratio, 10) !== null && Number(value.ratio) >= 1
    && typeof value.minimumAverageVolumeEnabled === 'boolean'
    && integerLots(value.minimumAverageVolumeLots) !== null;
const validOscillator = (value: OscillatorCrossCriteria) => !!value && typeof value.enabled === 'boolean'
    && OSCILLATOR_CROSS_MODES.includes(value.mode)
    && hundredths(value.highThreshold, 95) !== null && Number(value.highThreshold) >= 50
    && hundredths(value.lowThreshold, 50) !== null && Number(value.lowThreshold) >= 5
    && Number(value.lowThreshold) < Number(value.highThreshold) && validVolume(value.volumeConfirmation);
const v6Enabled = (criteria: CriteriaV6) => [criteria.volume, criteria.holder, criteria.fractal, criteria.bollReversal,
    criteria.ma, criteria.divergence, criteria.largeHolderTrend, criteria.largeHolderConcentration, criteria.retailHolderDecline,
    criteria.trustOwnership, criteria.priceMargin, criteria.shortMarginRatio, criteria.closeHigh, criteria.closeSmaBreakout,
    criteria.foreignReversal, criteria.trustReversal].some((row) => row.enabled);

export function validateCriteriaV7(criteria: CriteriaV7): boolean {
    if (!criteria || !criteria.bollPosition || !criteria.rsiCross || !criteria.kdCross || !criteria.macdSignal) return false;
    const base = v6Enabled(criteria) ? criteria : { ...criteria, foreignReversal: { ...criteria.foreignReversal, enabled: true } };
    return validateCriteriaV6(base)
        && typeof criteria.bollPosition.enabled === 'boolean' && BOLL_POSITION_MODES.includes(criteria.bollPosition.mode)
        && hundredths(criteria.bollPosition.tolerancePercent, 25) !== null && Number(criteria.bollPosition.tolerancePercent) >= 1
        && MIDDLE_TRENDS.includes(criteria.bollPosition.middleTrend) && validVolume(criteria.bollPosition.volumeConfirmation)
        && validOscillator(criteria.rsiCross) && validOscillator(criteria.kdCross)
        && typeof criteria.macdSignal.enabled === 'boolean' && MACD_SIGNAL_MODES.includes(criteria.macdSignal.mode)
        && hundredths(criteria.macdSignal.approachThresholdPct, 5) !== null
        && Number(criteria.macdSignal.approachThresholdPct) >= 0.01 && validVolume(criteria.macdSignal.volumeConfirmation)
        && (v6Enabled(criteria) || criteria.bollPosition.enabled || criteria.rsiCross.enabled
            || criteria.kdCross.enabled || criteria.macdSignal.enabled);
}

const cloneVolume = (value: VolumeConfirmationCriteria): VolumeConfirmationCriteria => ({ ...value });
const effectiveVolume = (value: VolumeConfirmationCriteria): VolumeConfirmationCriteria => !value.enabled
    ? volumeDefaults()
    : { ...cloneVolume(value), minimumAverageVolumeLots: value.minimumAverageVolumeEnabled
        ? value.minimumAverageVolumeLots : volumeDefaults().minimumAverageVolumeLots };
export function effectiveCriteriaV7(criteria: CriteriaV7): CriteriaV7 {
    const base = effectiveCriteriaV6(criteria);
    const bollPosition = !criteria.bollPosition.enabled
        ? { ...DEFAULT_CRITERIA_V7.bollPosition, volumeConfirmation: volumeDefaults() }
        : { ...criteria.bollPosition,
            tolerancePercent: criteria.bollPosition.mode === 'middle-near'
                ? criteria.bollPosition.tolerancePercent : DEFAULT_CRITERIA_V7.bollPosition.tolerancePercent,
            middleTrend: criteria.bollPosition.mode === 'middle-near'
                ? criteria.bollPosition.middleTrend : DEFAULT_CRITERIA_V7.bollPosition.middleTrend,
            volumeConfirmation: effectiveVolume(criteria.bollPosition.volumeConfirmation) };
    const oscillator = (value: OscillatorCrossCriteria, defaults: OscillatorCrossCriteria): OscillatorCrossCriteria => !value.enabled
        ? { ...defaults, volumeConfirmation: volumeDefaults() }
        : { ...value,
            highThreshold: value.mode === 'high-death-cross' ? value.highThreshold : defaults.highThreshold,
            lowThreshold: value.mode === 'low-golden-cross' ? value.lowThreshold : defaults.lowThreshold,
            volumeConfirmation: effectiveVolume(value.volumeConfirmation) };
    const macdSignal = !criteria.macdSignal.enabled
        ? { ...DEFAULT_CRITERIA_V7.macdSignal, volumeConfirmation: volumeDefaults() }
        : { ...criteria.macdSignal,
            approachThresholdPct: criteria.macdSignal.mode.startsWith('approach-zero-')
                ? criteria.macdSignal.approachThresholdPct : DEFAULT_CRITERIA_V7.macdSignal.approachThresholdPct,
            volumeConfirmation: effectiveVolume(criteria.macdSignal.volumeConfirmation) };
    return {
        ...base,
        bollPosition,
        rsiCross: oscillator(criteria.rsiCross, DEFAULT_CRITERIA_V7.rsiCross),
        kdCross: oscillator(criteria.kdCross, DEFAULT_CRITERIA_V7.kdCross),
        macdSignal,
    };
}

const volumeFingerprint = (value: VolumeConfirmationCriteria) => value.enabled
    ? `volume:${value.baselineDays}:${value.ratio}:${value.minimumAverageVolumeEnabled ? value.minimumAverageVolumeLots : 'floor-off'}`
    : 'volume:off';
const branchFingerprint = (name: string, value: BollPositionCriteria | OscillatorCrossCriteria | MacdSignalCriteria) => {
    if (!value.enabled) return `${name}:off`;
    const fields: string[] = [`mode=${value.mode}`];
    if (name === 'bollPosition' && value.mode === 'middle-near') {
        const boll = value as BollPositionCriteria;
        fields.push(`tolerancePercent=${boll.tolerancePercent}`, `middleTrend=${boll.middleTrend}`);
    }
    if ((name === 'rsiCross' || name === 'kdCross')) {
        const oscillator = value as OscillatorCrossCriteria;
        fields.push(value.mode === 'high-death-cross' ? `highThreshold=${oscillator.highThreshold}` : `lowThreshold=${oscillator.lowThreshold}`);
    }
    if (name === 'macdSignal' && value.mode.startsWith('approach-zero-')) {
        fields.push(`approachThresholdPct=${(value as MacdSignalCriteria).approachThresholdPct}`);
    }
    fields.push(volumeFingerprint(value.volumeConfirmation));
    return `${name}:${fields.join(',')}`;
};

export function criteriaFingerprintV7(criteria: CriteriaV7): string {
    if (!validateCriteriaV7(criteria)) throw new Error('invalid_criteria');
    const value = effectiveCriteriaV7(criteria);
    const base = v6Enabled(value) ? JSON.stringify(Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['bollPosition', 'rsiCross', 'kdCross', 'macdSignal'].includes(key)))) : 'v6:off';
    return [SCREENER_V7_VERSION, base, branchFingerprint('bollPosition', value.bollPosition),
        branchFingerprint('rsiCross', value.rsiCross), branchFingerprint('kdCross', value.kdCross),
        branchFingerprint('macdSignal', value.macdSignal)].join('|');
}

export type V7Reason = 'none' | 'missing_ohlcv' | 'invalid_ohlcv' | 'non_adjacent_sessions'
    | 'indicator_warmup' | 'zero_bollinger_width' | 'missing_volume' | 'invalid_volume' | 'zero_volume_baseline';
export interface TechnicalPointV7 {
    sessionDate: string;
    close: number;
    volumeShares: string;
    boll: { upper: number; middle: number; lower: number } | null;
    rsi: { fast: number; slow: number } | null;
    kd: { fast: number; slow: number } | null;
    macd: { dif: number; dea: number } | null;
}
export interface TechnicalSnapshotEvidenceV7 {
    sessions: string[];
    points: TechnicalPointV7[];
    volumeHistory: Array<{ sessionDate: string; volumeShares: string }>;
    readinessReason: Extract<V7Reason, 'none' | 'invalid_ohlcv' | 'non_adjacent_sessions'>;
    missingSessions: string[];
    through: string;
    formulaVersion: typeof SCREENER_V7_FORMULA_VERSION;
    sourceMappingVersion: typeof SCREENER_OHLCV_V4_MAPPING_VERSION;
    evidenceHash: string;
}
export interface ScreenerInputV7 extends ScreenerInputV6 {
    technicalV7: TechnicalSnapshotEvidenceV7;
}
export interface SignalCheck { verdict: Verdict; reason: V7Reason; actual?: unknown; threshold?: unknown }
export interface VolumeConfirmationEvidence {
    enabled: boolean;
    sessionDate: string | null;
    baselineDates: string[];
    currentVolumeShares: string | null;
    averageVolumeShares: number | null;
    ratio: number | null;
    minimumAverageVolumeShares: string | null;
    verdict: Verdict;
    reason: V7Reason;
}
export interface SignalOutcomeV7<E = Record<string, unknown>> {
    verdict: Verdict;
    reason: V7Reason;
    signal: SignalCheck;
    volumeConfirmation: VolumeConfirmationEvidence;
    evidence?: E;
    formulaVersion: typeof SCREENER_V7_FORMULA_VERSION;
}
export interface TechnicalOutcomesV7 {
    bollPosition: SignalOutcomeV7;
    rsiCross: SignalOutcomeV7;
    kdCross: SignalOutcomeV7;
    macdSignal: SignalOutcomeV7;
}

const mapPoints = (points: readonly IndicatorPoint[]) => new Map(points.flatMap((point) =>
    point.value === undefined || !Number.isFinite(point.value) ? [] : [[point.time, point.value] as const]));
const timeOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

export async function buildTechnicalSnapshotEvidenceV7(
    bars: readonly CanonicalOhlcv[], sessions: readonly string[],
    hash: (value: unknown) => Promise<string>,
): Promise<TechnicalSnapshotEvidenceV7> {
    const candles = canonicalOhlcvCandles(bars);
    const available = new Set(bars.map((bar) => bar.sessionDate));
    const missingSessions = sessions.filter((date) => !available.has(date));
    const readinessReason: TechnicalSnapshotEvidenceV7['readinessReason'] = !candles
        ? 'invalid_ohlcv' : missingSessions.length ? 'non_adjacent_sessions' : 'none';
    const validContinuity = readinessReason === 'none';
    const boll = candles ? bollinger(candles, 20, 2) : { upper: [], mid: [], lower: [] };
    const rsiFast = candles ? rsi(candles, 5) : [], rsiSlow = candles ? rsi(candles, 10) : [];
    const kd = candles ? stoch(candles, 9, 3, 3) : { k: [], d: [] };
    const macdRows = candles ? macd(candles, 12, 26, 9) : { macd: [], signal: [], hist: [] };
    const maps = { upper: mapPoints(boll.upper), middle: mapPoints(boll.mid), lower: mapPoints(boll.lower),
        rsiFast: mapPoints(rsiFast), rsiSlow: mapPoints(rsiSlow), kdFast: mapPoints(kd.k), kdSlow: mapPoints(kd.d),
        dif: mapPoints(macdRows.macd), dea: mapPoints(macdRows.signal) };
    const pointRows = validContinuity ? bars.slice(-3).map((bar) => {
        const time = timeOf(bar.sessionDate);
        const triplet = (a: Map<number, number>, b: Map<number, number>, c?: Map<number, number>) => {
            const x = a.get(time), y = b.get(time), z = c?.get(time);
            return x === undefined || y === undefined || c && z === undefined ? null : [x, y, z] as const;
        };
        const bands = triplet(maps.upper, maps.middle, maps.lower);
        const rsiPair = triplet(maps.rsiFast, maps.rsiSlow);
        const kdPair = triplet(maps.kdFast, maps.kdSlow);
        const macdPair = triplet(maps.dif, maps.dea);
        return { sessionDate: bar.sessionDate, close: Number(bar.close), volumeShares: bar.volumeShares,
            boll: bands ? { upper: bands[0], middle: bands[1], lower: bands[2]! } : null,
            rsi: rsiPair ? { fast: rsiPair[0], slow: rsiPair[1] } : null,
            kd: kdPair ? { fast: kdPair[0], slow: kdPair[1] } : null,
            macd: macdPair ? { dif: macdPair[0], dea: macdPair[1] } : null };
    }) : [];
    const bare = { sessions: [...sessions], points: pointRows,
        volumeHistory: validContinuity ? bars.slice(-61).map((bar) => ({ sessionDate: bar.sessionDate, volumeShares: bar.volumeShares })) : [],
        readinessReason, missingSessions,
        through: sessions.at(-1) ?? '', formulaVersion: SCREENER_V7_FORMULA_VERSION,
        sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION };
    return { ...bare, evidenceHash: await hash(bare) };
}

const unknownVolume = (reason: V7Reason): VolumeConfirmationEvidence => ({ enabled: true, sessionDate: null,
    baselineDates: [], currentVolumeShares: null, averageVolumeShares: null, ratio: null,
    minimumAverageVolumeShares: null, verdict: 'unknown', reason });
export function evaluateVolumeConfirmation(feature: TechnicalSnapshotEvidenceV7,
    criteria: VolumeConfirmationCriteria): VolumeConfirmationEvidence {
    if (!criteria.enabled) return { ...unknownVolume('none'), enabled: false, verdict: 'pass' };
    if (feature.readinessReason !== 'none') return unknownVolume(feature.readinessReason);
    const required = criteria.baselineDays + 1;
    const rows = feature.volumeHistory.slice(-required);
    if (rows.length !== required) return unknownVolume('missing_volume');
    const expectedDates = feature.sessions.slice(-required);
    if (expectedDates.length !== required || rows.some((row, index) => row.sessionDate !== expectedDates[index])) {
        return unknownVolume('non_adjacent_sessions');
    }
    const values = rows.map((row) => canonicalVolumeShares(row.volumeShares));
    if (values.some((value) => value === null)) return unknownVolume('invalid_volume');
    const current = values.at(-1)!, baseline = values.slice(0, -1) as bigint[];
    const sum = baseline.reduce((total, value) => total + value, BigInt(0));
    if (sum === BigInt(0)) return unknownVolume('zero_volume_baseline');
    const ratio = hundredths(criteria.ratio, 10)!;
    const ratioPass = current! * BigInt(criteria.baselineDays) * BigInt(100) >= sum * ratio;
    const floor = integerLots(criteria.minimumAverageVolumeLots)! * BigInt(1000);
    const floorPass = !criteria.minimumAverageVolumeEnabled || sum >= floor * BigInt(criteria.baselineDays);
    return { enabled: true, sessionDate: rows.at(-1)!.sessionDate, baselineDates: rows.slice(0, -1).map((row) => row.sessionDate),
        currentVolumeShares: current!.toString(), averageVolumeShares: Number(sum) / criteria.baselineDays,
        ratio: Number(current! * BigInt(criteria.baselineDays)) / Number(sum),
        minimumAverageVolumeShares: criteria.minimumAverageVolumeEnabled ? floor.toString() : null,
        verdict: ratioPass && floorPass ? 'pass' : 'fail', reason: 'none' };
}

const unknownSignal = (reason: V7Reason): SignalCheck => ({ verdict: 'unknown', reason });
const complete = <E>(signal: SignalCheck, volume: VolumeConfirmationEvidence, evidence?: E): SignalOutcomeV7<E> => {
    const verdict = combineVerdicts([signal.verdict, volume.verdict], 'all');
    const reason = signal.verdict === 'unknown' ? signal.reason : volume.verdict === 'unknown' ? volume.reason : 'none';
    return { verdict, reason, signal, volumeConfirmation: volume, ...(evidence === undefined ? {} : { evidence }),
        formulaVersion: SCREENER_V7_FORMULA_VERSION };
};
const latest = (feature: TechnicalSnapshotEvidenceV7) => ({ p2: feature.points.at(-3), p: feature.points.at(-2), d: feature.points.at(-1) });

export function evaluateBollPosition(feature: TechnicalSnapshotEvidenceV7, criteria: BollPositionCriteria): SignalOutcomeV7 {
    const volume = evaluateVolumeConfirmation(feature, criteria.volumeConfirmation);
    if (feature.readinessReason !== 'none') return complete(unknownSignal(feature.readinessReason), volume);
    const { p, d } = latest(feature);
    if (!p || !d) return complete(unknownSignal('missing_ohlcv'), volume);
    if (!p.boll || !d.boll) return complete(unknownSignal('indicator_warmup'), volume);
    const width = d.boll.upper - d.boll.lower;
    let pass = false;
    if (criteria.mode === 'upper-outside') pass = d.close > d.boll.upper;
    else if (criteria.mode === 'lower-outside') pass = d.close < d.boll.lower;
    else {
        if (!(width > 0)) return complete(unknownSignal('zero_bollinger_width'), volume);
        const distancePct = Math.abs(d.close - d.boll.middle) / width * 100;
        const direction = criteria.middleTrend === 'any'
            || criteria.middleTrend === 'rising' && d.boll.middle > p.boll.middle
            || criteria.middleTrend === 'falling' && d.boll.middle < p.boll.middle;
        pass = distancePct <= Number(criteria.tolerancePercent) && direction;
    }
    const signal: SignalCheck = { verdict: pass ? 'pass' : 'fail', reason: 'none',
        actual: { close: d.close, previous: p.boll, current: d.boll },
        threshold: criteria.mode === 'middle-near' ? { tolerancePercent: criteria.tolerancePercent, middleTrend: criteria.middleTrend } : criteria.mode };
    return complete(signal, volume, { previous: p, current: d, mode: criteria.mode });
}

function evaluateOscillator(feature: TechnicalSnapshotEvidenceV7, criteria: OscillatorCrossCriteria,
    key: 'rsi' | 'kd'): SignalOutcomeV7 {
    const volume = evaluateVolumeConfirmation(feature, criteria.volumeConfirmation);
    if (feature.readinessReason !== 'none') return complete(unknownSignal(feature.readinessReason), volume);
    const { p, d } = latest(feature), previous = p?.[key], current = d?.[key];
    if (!p || !d) return complete(unknownSignal('missing_ohlcv'), volume);
    if (!previous || !current) return complete(unknownSignal('indicator_warmup'), volume);
    const golden = previous.fast <= previous.slow && current.fast > current.slow;
    const death = previous.fast >= previous.slow && current.fast < current.slow;
    const low = Number(criteria.lowThreshold), high = Number(criteria.highThreshold);
    const lowZone = previous.fast <= low && previous.slow <= low || current.fast <= low && current.slow <= low;
    const highZone = previous.fast >= high && previous.slow >= high || current.fast >= high && current.slow >= high;
    const pass = criteria.mode === 'low-golden-cross' ? golden && lowZone : death && highZone;
    return complete({ verdict: pass ? 'pass' : 'fail', reason: 'none', actual: { previous, current },
        threshold: criteria.mode === 'low-golden-cross' ? low : high }, volume,
    { previous: { sessionDate: p.sessionDate, ...previous }, current: { sessionDate: d.sessionDate, ...current }, mode: criteria.mode });
}
export const evaluateRsiCross = (feature: TechnicalSnapshotEvidenceV7, criteria: OscillatorCrossCriteria) =>
    evaluateOscillator(feature, criteria, 'rsi');
export const evaluateKdCross = (feature: TechnicalSnapshotEvidenceV7, criteria: OscillatorCrossCriteria) =>
    evaluateOscillator(feature, criteria, 'kd');

export function evaluateMacdSignal(feature: TechnicalSnapshotEvidenceV7, criteria: MacdSignalCriteria): SignalOutcomeV7 {
    const volume = evaluateVolumeConfirmation(feature, criteria.volumeConfirmation);
    if (feature.readinessReason !== 'none') return complete(unknownSignal(feature.readinessReason), volume);
    const { p2, p, d } = latest(feature);
    if (!p2 || !p || !d) return complete(unknownSignal('missing_ohlcv'), volume);
    if (!p2.macd || !p.macd || !d.macd) return complete(unknownSignal('indicator_warmup'), volume);
    const a = p2.macd, b = p.macd, c = d.macd;
    const golden = b.dif <= b.dea && c.dif > c.dea, death = b.dif >= b.dea && c.dif < c.dea;
    const below = b.dif < 0 && b.dea < 0 && c.dif < 0 && c.dea < 0;
    const above = b.dif > 0 && b.dea > 0 && c.dif > 0 && c.dea > 0;
    const approachBelow = a.dif < 0 && b.dif < 0 && c.dif < 0 && Math.abs(a.dif) > Math.abs(b.dif)
        && Math.abs(b.dif) > Math.abs(c.dif) && Math.abs(c.dif) / d.close * 100 <= Number(criteria.approachThresholdPct);
    const approachAbove = a.dif > 0 && b.dif > 0 && c.dif > 0 && Math.abs(a.dif) > Math.abs(b.dif)
        && Math.abs(b.dif) > Math.abs(c.dif) && Math.abs(c.dif) / d.close * 100 <= Number(criteria.approachThresholdPct);
    const passByMode: Record<MacdSignalMode, boolean> = {
        'approach-zero-below': approachBelow, 'approach-zero-above': approachAbove,
        'cross-zero-up': b.dif <= 0 && c.dif > 0, 'cross-zero-down': b.dif >= 0 && c.dif < 0,
        'below-zero-golden-cross': below && golden, 'below-zero-death-cross': below && death,
        'above-zero-golden-cross': above && golden, 'above-zero-death-cross': above && death,
        'any-golden-cross': golden, 'any-death-cross': death,
    };
    return complete({ verdict: passByMode[criteria.mode] ? 'pass' : 'fail', reason: 'none', actual: { p2: a, previous: b, current: c },
        threshold: criteria.mode.startsWith('approach-zero-') ? criteria.approachThresholdPct : criteria.mode }, volume,
    { p2: { sessionDate: p2.sessionDate, ...a }, previous: { sessionDate: p.sessionDate, ...b },
        current: { sessionDate: d.sessionDate, close: d.close, ...c }, mode: criteria.mode });
}

export function evaluateTechnicalCriteriaV7(feature: TechnicalSnapshotEvidenceV7, criteria: CriteriaV7): TechnicalOutcomesV7 {
    return { bollPosition: evaluateBollPosition(feature, criteria.bollPosition), rsiCross: evaluateRsiCross(feature, criteria.rsiCross),
        kdCross: evaluateKdCross(feature, criteria.kdCross), macdSignal: evaluateMacdSignal(feature, criteria.macdSignal) };
}

const legacyKeys = ['volume', 'holder', 'fractal', 'bollReversal', 'ma', 'divergence'] as const;
const chipKeys = ['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership',
    'priceMargin', 'shortMarginRatio', 'closeHigh', 'closeSmaBreakout'] as const;
export function combineCriteriaV7(criteria: CriteriaV7, legacy: Partial<Record<typeof legacyKeys[number], Verdict>>,
    chip: import('./stock-screener-v5.ts').ChipOutcomesV5, institutional: InstitutionalOutcomesV6,
    technical: TechnicalOutcomesV7): Verdict {
    if (!validateCriteriaV7(criteria)) throw new Error('invalid_criteria');
    const verdicts: Verdict[] = [];
    for (const key of legacyKeys) if (criteria[key].enabled) {
        if (!legacy[key]) throw new Error('missing_enabled_branch');
        verdicts.push(legacy[key]!);
    }
    for (const key of chipKeys) if (criteria[key].enabled) verdicts.push(chip[key].verdict);
    if (criteria.foreignReversal.enabled) verdicts.push(institutional.foreignReversal.verdict);
    if (criteria.trustReversal.enabled) verdicts.push(institutional.trustReversal.verdict);
    for (const key of ['bollPosition', 'rsiCross', 'kdCross', 'macdSignal'] as const) if (criteria[key].enabled) verdicts.push(technical[key].verdict);
    return combineVerdicts(verdicts, criteria.mode);
}

export type ScreenerSortV7 = ScreenerSortV6
    | 'bollDistance' | 'rsiFast' | 'kdFast' | 'macdDif' | 'volumeRatio';
export interface ScreenerPreferenceV7 extends Omit<ScreenerPreferenceV6, 'version' | 'query'> {
    version: 7;
    query: { criteria: CriteriaV7; sort: ScreenerSortV7; direction: 'asc' | 'desc'; resultState: Verdict };
}
const exactKeys = (value: unknown, keys: readonly string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).sort().join() === [...keys].sort().join();
const volumeKeys = ['enabled', 'baselineDays', 'ratio', 'minimumAverageVolumeEnabled', 'minimumAverageVolumeLots'];
const v7Sorts: readonly ScreenerSortV7[] = ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak',
    'confirmationDate', 'algorithm', 'direction', 'outsideDistance', 'maSpread', 'pivotDate', 'priceDifference',
    'largeHolderRatio', 'trustOwnershipPct', 'shortMarginRatio', 'closeHighDays', 'smaPeriod', 'foreignTodayNetBuy',
    'trustTodayNetBuy', 'trustRecoveryPct', 'trustParticipationPct', 'bollDistance', 'rsiFast', 'kdFast', 'macdDif', 'volumeRatio'];
export function isV7Preference(value: unknown): value is ScreenerPreferenceV7 {
    const row = value as Partial<ScreenerPreferenceV7> | null, query = row?.query, criteria = query?.criteria;
    const branch = (candidate: unknown, keys: string[]) => exactKeys(candidate, [...keys, 'volumeConfirmation'])
        && exactKeys((candidate as { volumeConfirmation: unknown }).volumeConfirmation, volumeKeys);
    return !!row && row.version === 7 && exactKeys(row, ['version', 'query']) && !!query
        && exactKeys(query, ['criteria', 'sort', 'direction', 'resultState']) && !!criteria
        && exactKeys(criteria, [...Object.keys(DEFAULT_CRITERIA_V6), 'bollPosition', 'rsiCross', 'kdCross', 'macdSignal'])
        && branch(criteria.bollPosition, ['enabled', 'mode', 'tolerancePercent', 'middleTrend'])
        && branch(criteria.rsiCross, ['enabled', 'mode', 'highThreshold', 'lowThreshold'])
        && branch(criteria.kdCross, ['enabled', 'mode', 'highThreshold', 'lowThreshold'])
        && branch(criteria.macdSignal, ['enabled', 'mode', 'approachThresholdPct'])
        && validateCriteriaV7(criteria) && v7Sorts.includes(query.sort as ScreenerSortV7)
        && ['asc', 'desc'].includes(String(query.direction)) && ['pass', 'fail', 'unknown'].includes(String(query.resultState));
}

export function migrateCriteriaV6ToV7(criteria: CriteriaV6): CriteriaV7 {
    return { ...effectiveCriteriaV6(criteria),
        bollPosition: { ...DEFAULT_CRITERIA_V7.bollPosition, volumeConfirmation: volumeDefaults() },
        rsiCross: { ...DEFAULT_CRITERIA_V7.rsiCross, volumeConfirmation: volumeDefaults() },
        kdCross: { ...DEFAULT_CRITERIA_V7.kdCross, volumeConfirmation: volumeDefaults() },
        macdSignal: { ...DEFAULT_CRITERIA_V7.macdSignal, volumeConfirmation: volumeDefaults() } };
}
