/** 五種 K 線反轉的 v9 契約。純函式：不讀來源、不寫偏好／每日 profile。 */
import { hundredths } from './stock-screener-domain.ts';
import { DEFAULT_CRITERIA_V7, effectiveCriteriaV7 } from './stock-screener-v7.ts';
import { DEFAULT_BOLLINGER_SQUEEZE, validateCriteriaV8, type CriteriaV8, type ScreenerPreferenceV8 } from './stock-screener-v8.ts';

export const SCREENER_V9_VERSION = 9 as const;
export const CANDLESTICK_FORMULA_VERSION = 'candlestick-reversal-v1' as const;
export const CANDLESTICK_HISTORY_CAPABILITY = 'candlestick-ohlcv-history-v1' as const;
export const CANDLESTICK_PATTERNS = ['three-white-soldiers', 'bearish-engulfing', 'morning-star', 'three-black-crows', 'piercing'] as const;
export type CandlestickPattern = typeof CANDLESTICK_PATTERNS[number];
export interface CandlestickReversalCriteria {
    enabled: boolean;
    patterns: CandlestickPattern[];
    mode: 'pattern-complete' | 'next-session-breakout';
    trendDays: number;
    minTrendChangePct: string;
    longBodyMinPct: string;
    bodyReferenceDays: number;
    longBodyMedianRatio: string;
    smallBodyMaxPct: string;
    nearExtremeMaxPct: string;
    morningRecoveryPct: string;
    includeMorningDoji: boolean;
    morningGapMode: 'strict-body-gap' | 'no-gap-required';
    firstCrowOpenWithinPriorBody: boolean;
    piercingRecoveryPct: string;
    piercingOpenMode: 'research-close' | 'below-prior-low';
    piercingRequireLongFirstBody: boolean;
    volume: { enabled: boolean; baselineDays: number; ratio: string; minimumAverageVolumeEnabled: boolean; minimumAverageVolumeLots: string };
    position: { enabled: boolean; baselineDays: number; tolerancePct: string };
}
export const DEFAULT_CANDLESTICK_REVERSAL: CandlestickReversalCriteria = {
    enabled: false, patterns: [...CANDLESTICK_PATTERNS], mode: 'pattern-complete',
    trendDays: 5, minTrendChangePct: '0', longBodyMinPct: '60', bodyReferenceDays: 20,
    longBodyMedianRatio: '1', smallBodyMaxPct: '30', nearExtremeMaxPct: '20',
    morningRecoveryPct: '50', includeMorningDoji: true, morningGapMode: 'strict-body-gap',
    firstCrowOpenWithinPriorBody: true, piercingRecoveryPct: '50', piercingOpenMode: 'research-close',
    piercingRequireLongFirstBody: false,
    volume: { enabled: false, baselineDays: 20, ratio: '1.2', minimumAverageVolumeEnabled: false, minimumAverageVolumeLots: '1000' },
    position: { enabled: false, baselineDays: 20, tolerancePct: '2' },
};
const exact = (v: unknown, keys: readonly string[]): boolean => !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).sort().join() === [...keys].sort().join();
const decimal = (v: string, min: number, max: number) => hundredths(v, Math.ceil(max)) !== null && Number(v) >= min && Number(v) <= max;
const days = (n: number, min = 5) => Number.isInteger(n) && n >= min && n <= 60;
export function validateCandlestickReversal(c: CandlestickReversalCriteria): boolean {
    return exact(c, Object.keys(DEFAULT_CANDLESTICK_REVERSAL)) && typeof c.enabled === 'boolean'
        && Array.isArray(c.patterns) && c.patterns.length <= 5 && (!c.enabled || c.patterns.length > 0)
        && new Set(c.patterns).size === c.patterns.length && c.patterns.every(p => CANDLESTICK_PATTERNS.includes(p))
        && ['pattern-complete', 'next-session-breakout'].includes(c.mode) && days(c.trendDays, 3)
        && decimal(c.minTrendChangePct, 0, 20) && decimal(c.longBodyMinPct, 50, 90)
        && days(c.bodyReferenceDays) && decimal(c.longBodyMedianRatio, .5, 3)
        && decimal(c.smallBodyMaxPct, 0, 40) && Number(c.smallBodyMaxPct) < Number(c.longBodyMinPct)
        && decimal(c.nearExtremeMaxPct, 0, 30) && decimal(c.morningRecoveryPct, 50, 100)
        && typeof c.includeMorningDoji === 'boolean' && ['strict-body-gap', 'no-gap-required'].includes(c.morningGapMode)
        && typeof c.firstCrowOpenWithinPriorBody === 'boolean' && decimal(c.piercingRecoveryPct, 50, 99.99)
        && ['research-close', 'below-prior-low'].includes(c.piercingOpenMode) && typeof c.piercingRequireLongFirstBody === 'boolean'
        && exact(c.volume, Object.keys(DEFAULT_CANDLESTICK_REVERSAL.volume)) && typeof c.volume.enabled === 'boolean'
        && days(c.volume.baselineDays) && decimal(c.volume.ratio, 1, 10) && typeof c.volume.minimumAverageVolumeEnabled === 'boolean'
        && typeof c.volume.minimumAverageVolumeLots === 'string' && /^(?:0|[1-9]\d{0,9})$/.test(c.volume.minimumAverageVolumeLots)
        && exact(c.position, Object.keys(DEFAULT_CANDLESTICK_REVERSAL.position)) && typeof c.position.enabled === 'boolean'
        && days(c.position.baselineDays) && decimal(c.position.tolerancePct, .1, 10);
}
export interface CriteriaV9 extends CriteriaV8 { candlestickReversal: CandlestickReversalCriteria }
export interface PreferenceV9 extends Omit<ScreenerPreferenceV8, 'version' | 'query'> {
    version: 9; query: Omit<ScreenerPreferenceV8['query'], 'criteria'> & { criteria: CriteriaV9 };
}
export function validateCriteriaV9(c: CriteriaV9): boolean {
    if (!exact(c, [...Object.keys(DEFAULT_CRITERIA_V7), 'bollSqueezeStages', 'candlestickReversal'])
        || !validateCandlestickReversal(c.candlestickReversal)) return false;
    const { candlestickReversal, ...legacy } = c;
    // 只啟用 v9 合法，但仍逐欄驗證舊參數，不放寬舊分支。
    return validateCriteriaV8(candlestickReversal.enabled
        ? { ...legacy, bollSqueezeStages: { ...legacy.bollSqueezeStages, enabled: true } } : legacy);
}
const oldSorts = ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak', 'confirmationDate', 'algorithm', 'direction',
    'outsideDistance', 'maSpread', 'pivotDate', 'priceDifference', 'largeHolderRatio', 'trustOwnershipPct', 'shortMarginRatio',
    'closeHighDays', 'smaPeriod', 'foreignTodayNetBuy', 'trustTodayNetBuy', 'trustRecoveryPct', 'trustParticipationPct',
    'bollDistance', 'rsiFast', 'kdFast', 'macdDif', 'volumeRatio'];
export function migrateCriteriaV8ToV9(c: CriteriaV8): CriteriaV9 {
    if (!validateCriteriaV8(c)) throw new Error('invalid_v8_criteria');
    return { ...structuredClone(c), candlestickReversal: structuredClone(DEFAULT_CANDLESTICK_REVERSAL) };
}
export function migratePreferenceV8ToV9(v: unknown): PreferenceV9 | null {
    const p = v as ScreenerPreferenceV8 | null;
    if (!exact(p, ['version', 'query']) || p?.version !== 8 || !exact(p.query, ['criteria', 'sort', 'direction', 'resultState'])
        || !validateCriteriaV8(p.query.criteria) || !oldSorts.includes(p.query.sort)
        || !['asc', 'desc'].includes(p.query.direction) || !['pass', 'fail', 'unknown'].includes(p.query.resultState)) return null;
    return { ...structuredClone(p), version: 9, query: { ...p.query, criteria: migrateCriteriaV8ToV9(p.query.criteria) } };
}
/** 只保留啟用且適用的參數；停用草稿不改查詢 identity／暖機需求。 */
export function activeCandlestickCriteria(c: CandlestickReversalCriteria): Record<string, unknown> {
    if (!validateCandlestickReversal(c)) throw new Error('invalid_candlestick_criteria');
    if (!c.enabled) return { enabled: false };
    const patterns = CANDLESTICK_PATTERNS.filter(p => c.patterns.includes(p));
    const long = patterns.some(p => ['three-white-soldiers', 'morning-star', 'three-black-crows'].includes(p))
        || patterns.includes('piercing') && c.piercingRequireLongFirstBody;
    return { enabled: true, patterns, mode: c.mode, trendDays: c.trendDays, minTrendChangePct: c.minTrendChangePct,
        ...(long ? { longBodyMinPct: c.longBodyMinPct, bodyReferenceDays: c.bodyReferenceDays, longBodyMedianRatio: c.longBodyMedianRatio } : {}),
        ...(patterns.some(p => ['three-white-soldiers', 'three-black-crows'].includes(p)) ? { nearExtremeMaxPct: c.nearExtremeMaxPct } : {}),
        ...(patterns.includes('morning-star') ? { smallBodyMaxPct: c.smallBodyMaxPct, morningRecoveryPct: c.morningRecoveryPct,
            includeMorningDoji: c.includeMorningDoji, morningGapMode: c.morningGapMode } : {}),
        ...(patterns.includes('three-black-crows') ? { firstCrowOpenWithinPriorBody: c.firstCrowOpenWithinPriorBody } : {}),
        ...(patterns.includes('piercing') ? { piercingRecoveryPct: c.piercingRecoveryPct, piercingOpenMode: c.piercingOpenMode,
            piercingRequireLongFirstBody: c.piercingRequireLongFirstBody } : {}),
        volume: c.volume.enabled ? { ...c.volume, minimumAverageVolumeLots: c.volume.minimumAverageVolumeEnabled
            ? c.volume.minimumAverageVolumeLots : null } : { enabled: false },
        position: c.position.enabled ? c.position : { enabled: false } };
}
export const candlestickCriteriaFingerprint = (c: CandlestickReversalCriteria) => JSON.stringify(activeCandlestickCriteria(c));
export function candlestickRequiredHistory(c: CandlestickReversalCriteria): number {
    if (!validateCandlestickReversal(c)) throw new Error('invalid_candlestick_criteria');
    if (!c.enabled) return 0;
    return Math.max(...c.patterns.map(pattern => {
        const bars = ['piercing', 'bearish-engulfing'].includes(pattern) ? 2 : 3;
        const needsLong = !['piercing', 'bearish-engulfing'].includes(pattern) || pattern === 'piercing' && c.piercingRequireLongFirstBody;
        return Math.max(c.trendDays, needsLong ? c.bodyReferenceDays : 0, c.position.enabled ? c.position.baselineDays : 0)
            + bars + (c.mode === 'next-session-breakout' ? 1 : 0);
    }), c.volume.enabled ? c.volume.baselineDays + 1 : 0);
}
export function isV9Preference(value: unknown): value is PreferenceV9 {
    const p = value as PreferenceV9 | null;
    return exact(p, ['version', 'query']) && p?.version === 9 && exact(p.query, ['criteria', 'sort', 'direction', 'resultState'])
        && validateCriteriaV9(p.query.criteria) && oldSorts.includes(p.query.sort)
        && ['asc', 'desc'].includes(p.query.direction) && ['pass', 'fail', 'unknown'].includes(p.query.resultState);
}
export function activeCriteriaV9(c: CriteriaV9) {
    if (!validateCriteriaV9(c)) throw new Error('invalid_v9_criteria');
    const { candlestickReversal, bollSqueezeStages, ...legacy } = c;
    return { ...effectiveCriteriaV7(legacy), bollSqueezeStages: bollSqueezeStages.enabled
        ? { ...bollSqueezeStages, stages: [...bollSqueezeStages.stages].sort() } : { ...DEFAULT_BOLLINGER_SQUEEZE, enabled: false },
        candlestickReversal: activeCandlestickCriteria(candlestickReversal) };
}
