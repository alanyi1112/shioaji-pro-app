/** 收盤後選股 v5 籌碼與收盤價純函式；不得在此模組抓來源、寫 DB 或觸發交易。 */
import { combineVerdicts, hundredths, type Verdict } from './stock-screener-domain.ts';
import {
    DEFAULT_CRITERIA_V4, criteriaFingerprintV4, effectiveCriteriaV4, validateCriteriaV4,
    type CriteriaV4, type ScreenerInputV4, type ScreenerPreferenceV4,
} from './stock-screener-v4.ts';
import { canonicalPriceUnits } from './stock-screener-ohlcv.ts';

export const SCREENER_V5_VERSION = 5 as const;
export const SCREENER_V5_SCHEMA_VERSION = 5 as const;
export const SCREENER_V5_FORMULA_VERSION = 'after-market-v5-chip-price-1' as const;
export const SCREENER_CHIP_MAPPING_VERSION = 'official-market-chip-v1' as const;

export type V5Reason = 'none' | 'history_gap' | 'incomplete_tdcc' | 'missing_source_row'
    | 'insufficient_history' | 'issued_shares_invalid' | 'non_adjacent_sessions'
    | 'indicator_warmup' | 'invalid_ratio' | 'invalid_balance' | 'mixed_session_dates';

export interface LargeHolderTrendCriteria {
    enabled: boolean; minimumRatioPct: string; maximumRatioPct: string; weeks: number; minimumIncreasePp: string;
}
export interface WeeksCriteria { enabled: boolean; weeks: number }
export interface TrustOwnershipCriteria { enabled: boolean; days: number; minimumPct: string }
export interface PriceMarginCriteria { enabled: boolean; days: number }
export interface RatioCriteria { enabled: boolean; minimumPct: string }
export interface DaysCriteria { enabled: boolean; days: number }
export interface SmaBreakoutCriteria { enabled: boolean; period: 5 | 10 | 20 | 60 }

export interface CriteriaV5 extends CriteriaV4 {
    largeHolderTrend: LargeHolderTrendCriteria;
    largeHolderConcentration: WeeksCriteria;
    retailHolderDecline: WeeksCriteria;
    trustOwnership: TrustOwnershipCriteria;
    priceMargin: PriceMarginCriteria;
    shortMarginRatio: RatioCriteria;
    closeHigh: DaysCriteria;
    closeSmaBreakout: SmaBreakoutCriteria;
}

export const DEFAULT_CRITERIA_V5: CriteriaV5 = {
    ...DEFAULT_CRITERIA_V4,
    volume: { ...DEFAULT_CRITERIA_V4.volume, turnover: { ...DEFAULT_CRITERIA_V4.volume.turnover } },
    holder: { ...DEFAULT_CRITERIA_V4.holder, turnover: { ...DEFAULT_CRITERIA_V4.holder.turnover } },
    fractal: { ...DEFAULT_CRITERIA_V4.fractal }, bollReversal: { ...DEFAULT_CRITERIA_V4.bollReversal },
    ma: { ...DEFAULT_CRITERIA_V4.ma }, divergence: { ...DEFAULT_CRITERIA_V4.divergence },
    largeHolderTrend: { enabled: false, minimumRatioPct: '0', maximumRatioPct: '100', weeks: 3, minimumIncreasePp: '0' },
    largeHolderConcentration: { enabled: false, weeks: 3 },
    retailHolderDecline: { enabled: false, weeks: 3 },
    trustOwnership: { enabled: false, days: 5, minimumPct: '0.1' },
    priceMargin: { enabled: false, days: 5 },
    shortMarginRatio: { enabled: false, minimumPct: '30' },
    closeHigh: { enabled: false, days: 20 },
    closeSmaBreakout: { enabled: false, period: 20 },
};

export const LONG_TERM_LAYOUT_PRESET: CriteriaV5 = {
    ...DEFAULT_CRITERIA_V5,
    volume: { ...DEFAULT_CRITERIA_V5.volume, enabled: false },
    holder: { ...DEFAULT_CRITERIA_V5.holder, enabled: false },
    largeHolderTrend: { ...DEFAULT_CRITERIA_V5.largeHolderTrend, enabled: true, weeks: 3 },
    retailHolderDecline: { ...DEFAULT_CRITERIA_V5.retailHolderDecline, enabled: true, weeks: 3 },
    priceMargin: { ...DEFAULT_CRITERIA_V5.priceMargin, enabled: true },
};

export interface TdccChipWeek {
    date: string;
    largeHolders: string | null;
    largeShares: string | null;
    largeRatioPct: string | null;
    retailRatioPct: string | null;
    receiptId: string | null;
}
export interface DailyChipPoint {
    sessionDate: string;
    investmentTrustNetShares: string | null;
    marginTodayBalanceLots: string | null;
    shortTodayBalanceLots: string | null;
    institutionalReceiptId: string | null;
    marginReceiptId: string | null;
}
export interface ClosePoint { sessionDate: string; close: string }
export interface IssuedSharesEvidence {
    shares: string | null; asOfDate: string | null; sourceUrl: string | null; payloadHash: string | null;
    normalizationVersion: string | null;
}
export interface ChipSnapshotEvidenceV5 {
    dailySessions: string[];
    tdccWeeks: TdccChipWeek[];
    daily: DailyChipPoint[];
    closes: ClosePoint[];
    issuedCommonShares: IssuedSharesEvidence;
    dailyThrough: string;
    weeklyThrough: string | null;
    mappingVersion: typeof SCREENER_CHIP_MAPPING_VERSION;
    evidenceHash: string;
}
export interface ScreenerInputV5 extends ScreenerInputV4 { chipV5: ChipSnapshotEvidenceV5 }

export interface ConditionOutcome<E = Record<string, unknown>> {
    verdict: Verdict; reason: V5Reason; evidence?: E;
}
export type ChipConditionKey = 'largeHolderTrend' | 'largeHolderConcentration' | 'retailHolderDecline'
    | 'trustOwnership' | 'priceMargin' | 'shortMarginRatio' | 'closeHigh' | 'closeSmaBreakout';
export type ChipOutcomesV5 = Record<ChipConditionKey, ConditionOutcome>;

const unsigned = (value: string | null): bigint | null => value !== null && /^(?:0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
const signed = (value: string | null): bigint | null => value !== null && /^-?(?:0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
const unknown = (reason: V5Reason): ConditionOutcome => ({ verdict: 'unknown', reason });
const result = (pass: boolean, evidence: Record<string, unknown>): ConditionOutcome => ({ verdict: pass ? 'pass' : 'fail', reason: 'none', evidence });
const iso = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));

function adjacentTail<T extends { sessionDate: string }>(rows: readonly T[], sessions: readonly string[], count: number): T[] | null {
    if (count < 1 || sessions.length < count) return null;
    const expected = sessions.slice(-count);
    const map = new Map(rows.map((row) => [row.sessionDate, row]));
    const selected = expected.map((date) => map.get(date));
    return selected.every(Boolean) ? selected as T[] : null;
}

function tdccTail(feature: ChipSnapshotEvidenceV5, transitions: number): TdccChipWeek[] | null {
    const points = feature.tdccWeeks.slice(-transitions - 1);
    if (points.length !== transitions + 1 || points.some((point, index) => !iso(point.date)
        || index > 0 && point.date <= points[index - 1]!.date)) return null;
    return points;
}

export function evaluateLargeHolderTrend(feature: ChipSnapshotEvidenceV5, criteria: LargeHolderTrendCriteria): ConditionOutcome {
    const points = tdccTail(feature, criteria.weeks);
    if (!points) return unknown('history_gap');
    const ratios = points.map((point) => point.largeRatioPct === null ? null : hundredths(point.largeRatioPct));
    if (ratios.some((value) => value === null)) return unknown('incomplete_tdcc');
    const latest = ratios.at(-1)! as bigint, minimum = hundredths(criteria.minimumRatioPct), maximum = hundredths(criteria.maximumRatioPct);
    const delta = hundredths(criteria.minimumIncreasePp);
    if (minimum === null || maximum === null || delta === null) return unknown('invalid_ratio');
    const changes = ratios.slice(1).map((value, index) => (value as bigint) - (ratios[index] as bigint));
    return result(latest >= minimum && latest <= maximum && changes.every((value) => value > delta), {
        weeks: points.map((point, index) => ({ date: point.date, ratioPct: point.largeRatioPct, changePp: index ? Number(changes[index - 1]) / 100 : null,
            receiptId: point.receiptId })), minimumRatioPct: criteria.minimumRatioPct, maximumRatioPct: criteria.maximumRatioPct,
        minimumIncreasePp: criteria.minimumIncreasePp, level: 15,
    });
}

export function evaluateLargeHolderConcentration(feature: ChipSnapshotEvidenceV5, criteria: WeeksCriteria): ConditionOutcome {
    const points = tdccTail(feature, criteria.weeks);
    if (!points) return unknown('history_gap');
    const values = points.map((point) => ({ holders: unsigned(point.largeHolders), shares: unsigned(point.largeShares) }));
    if (values.some((value) => value.holders === null || value.shares === null)) return unknown('incomplete_tdcc');
    const transitions = values.slice(1).map((value, index) => ({
        holdersChange: value.holders! - values[index]!.holders!, sharesChange: value.shares! - values[index]!.shares!,
    }));
    return result(transitions.every((value) => value.holdersChange < 0 && value.sharesChange > 0), {
        level: 15, weeks: points.map((point) => ({ date: point.date, holders: point.largeHolders, shares: point.largeShares,
            receiptId: point.receiptId })),
    });
}

export function evaluateRetailHolderDecline(feature: ChipSnapshotEvidenceV5, criteria: WeeksCriteria): ConditionOutcome {
    const points = tdccTail(feature, criteria.weeks);
    if (!points) return unknown('history_gap');
    const ratios = points.map((point) => point.retailRatioPct === null ? null : hundredths(point.retailRatioPct));
    if (ratios.some((value) => value === null)) return unknown('incomplete_tdcc');
    return result(ratios.slice(1).every((value, index) => (value as bigint) < (ratios[index] as bigint)), {
        levels: [1, 2, 3], label: '10 張以下', weeks: points.map((point) => ({ date: point.date, ratioPct: point.retailRatioPct,
            receiptId: point.receiptId })),
    });
}

export function evaluateTrustOwnership(feature: ChipSnapshotEvidenceV5, criteria: TrustOwnershipCriteria): ConditionOutcome {
    const rows = adjacentTail(feature.daily, feature.dailySessions, criteria.days);
    if (!rows) return unknown('non_adjacent_sessions');
    const values = rows.map((row) => signed(row.investmentTrustNetShares));
    if (values.some((value) => value === null)) return unknown('missing_source_row');
    const shares = unsigned(feature.issuedCommonShares.shares);
    if (shares === null || shares === BigInt(0) || !feature.issuedCommonShares.asOfDate
        || feature.issuedCommonShares.asOfDate > feature.dailyThrough) return unknown('issued_shares_invalid');
    const sum = values.reduce<bigint>((total, value) => total + value!, BigInt(0));
    const threshold = hundredths(criteria.minimumPct, 1000);
    if (threshold === null) return unknown('invalid_ratio');
    const scaledPct = sum * BigInt(10000) / shares;
    return result(sum > BigInt(0) && scaledPct >= threshold, {
        rows: rows.map((row) => ({ date: row.sessionDate, netShares: row.investmentTrustNetShares,
            receiptId: row.institutionalReceiptId })), cumulativeNetShares: sum.toString(), issuedCommonShares: shares.toString(),
        issuedSharesDate: feature.issuedCommonShares.asOfDate, ratioPct: Number(scaledPct) / 100,
        formulaVersion: SCREENER_V5_FORMULA_VERSION,
    });
}

export function evaluatePriceMargin(feature: ChipSnapshotEvidenceV5, criteria: PriceMarginCriteria): ConditionOutcome {
    const count = criteria.days + 1;
    const daily = adjacentTail(feature.daily, feature.dailySessions, count);
    const closes = adjacentTail(feature.closes, feature.dailySessions, count);
    if (!daily || !closes) return unknown('non_adjacent_sessions');
    const startMargin = unsigned(daily[0]!.marginTodayBalanceLots), endMargin = unsigned(daily.at(-1)!.marginTodayBalanceLots);
    const startClose = canonicalPriceUnits(closes[0]!.close), endClose = canonicalPriceUnits(closes.at(-1)!.close);
    if (startMargin === null || endMargin === null) return unknown('invalid_balance');
    if (startClose === null || endClose === null) return unknown('missing_source_row');
    return result(endClose > startClose && endMargin <= startMargin, {
        start: { date: closes[0]!.sessionDate, close: closes[0]!.close, marginLots: startMargin.toString(), receiptId: daily[0]!.marginReceiptId },
        current: { date: closes.at(-1)!.sessionDate, close: closes.at(-1)!.close, marginLots: endMargin.toString(), receiptId: daily.at(-1)!.marginReceiptId },
        marginChangeLots: (endMargin - startMargin).toString(),
    });
}

export function evaluateShortMarginRatio(feature: ChipSnapshotEvidenceV5, criteria: RatioCriteria): ConditionOutcome {
    const row = feature.daily.at(-1);
    if (!row || row.sessionDate !== feature.dailyThrough) return unknown('missing_source_row');
    const margin = unsigned(row.marginTodayBalanceLots), short = unsigned(row.shortTodayBalanceLots);
    if (margin === null || short === null || margin === BigInt(0)) return unknown('invalid_balance');
    const threshold = hundredths(criteria.minimumPct, 1000);
    if (threshold === null) return unknown('invalid_ratio');
    const ratio = short * BigInt(10000) / margin;
    return result(ratio >= threshold, { date: row.sessionDate, shortLots: short.toString(), marginLots: margin.toString(),
        ratioPct: Number(ratio) / 100, receiptId: row.marginReceiptId, formulaVersion: SCREENER_V5_FORMULA_VERSION });
}

export function evaluateCloseHigh(feature: ChipSnapshotEvidenceV5, criteria: DaysCriteria): ConditionOutcome {
    const rows = adjacentTail(feature.closes, feature.dailySessions, criteria.days);
    if (!rows) return unknown('insufficient_history');
    const values = rows.map((row) => canonicalPriceUnits(row.close));
    if (values.some((value) => value === null)) return unknown('missing_source_row');
    const current = values.at(-1)! as bigint;
    let priorIndex = 0;
    for (let index = 1; index < values.length - 1; index++) if ((values[index] as bigint) > (values[priorIndex] as bigint)) priorIndex = index;
    return result(current > (values[priorIndex] as bigint), { lookbackSessions: rows.map((row) => row.sessionDate),
        current: rows.at(-1), priorHighest: rows[priorIndex], priceBasis: 'official-unadjusted-close', formulaVersion: SCREENER_V5_FORMULA_VERSION });
}

export function evaluateCloseSmaBreakout(feature: ChipSnapshotEvidenceV5, criteria: SmaBreakoutCriteria): ConditionOutcome {
    const rows = adjacentTail(feature.closes, feature.dailySessions, criteria.period + 1);
    if (!rows) return unknown('indicator_warmup');
    const values = rows.map((row) => canonicalPriceUnits(row.close));
    if (values.some((value) => value === null)) return unknown('missing_source_row');
    const previousWindow = values.slice(0, criteria.period) as bigint[];
    const currentWindow = values.slice(1) as bigint[];
    const previousSma = previousWindow.reduce((sum, value) => sum + value, BigInt(0)) / BigInt(criteria.period);
    const currentSma = currentWindow.reduce((sum, value) => sum + value, BigInt(0)) / BigInt(criteria.period);
    const previousClose = values.at(-2)! as bigint, currentClose = values.at(-1)! as bigint;
    return result(previousClose <= previousSma && currentClose > currentSma, {
        period: criteria.period,
        previous: { ...rows.at(-2), sma: Number(previousSma) / 1_000_000 },
        current: { ...rows.at(-1), sma: Number(currentSma) / 1_000_000 },
        priceBasis: 'official-unadjusted-close', formulaVersion: SCREENER_V5_FORMULA_VERSION,
    });
}

export function evaluateChipCriteria(feature: ChipSnapshotEvidenceV5, criteria: CriteriaV5): ChipOutcomesV5 {
    return {
        largeHolderTrend: evaluateLargeHolderTrend(feature, criteria.largeHolderTrend),
        largeHolderConcentration: evaluateLargeHolderConcentration(feature, criteria.largeHolderConcentration),
        retailHolderDecline: evaluateRetailHolderDecline(feature, criteria.retailHolderDecline),
        trustOwnership: evaluateTrustOwnership(feature, criteria.trustOwnership),
        priceMargin: evaluatePriceMargin(feature, criteria.priceMargin),
        shortMarginRatio: evaluateShortMarginRatio(feature, criteria.shortMarginRatio),
        closeHigh: evaluateCloseHigh(feature, criteria.closeHigh),
        closeSmaBreakout: evaluateCloseSmaBreakout(feature, criteria.closeSmaBreakout),
    };
}

const legacyEnabled = (criteria: CriteriaV5) => [criteria.volume, criteria.holder, criteria.fractal, criteria.bollReversal,
    criteria.ma, criteria.divergence].some((value) => value.enabled);
const chipKeys: readonly ChipConditionKey[] = ['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline',
    'trustOwnership', 'priceMargin', 'shortMarginRatio', 'closeHigh', 'closeSmaBreakout'];

export function validateCriteriaV5(criteria: CriteriaV5): boolean {
    if (!criteria || !criteria.largeHolderTrend || !criteria.largeHolderConcentration || !criteria.retailHolderDecline
        || !criteria.trustOwnership || !criteria.priceMargin || !criteria.shortMarginRatio || !criteria.closeHigh || !criteria.closeSmaBreakout) return false;
    const legacyCandidate = legacyEnabled(criteria) ? criteria : { ...criteria, volume: { ...criteria.volume, enabled: true } };
    if (!validateCriteriaV4(legacyCandidate)) return false;
    const booleans = chipKeys.every((key) => typeof criteria[key].enabled === 'boolean');
    const trendMin = hundredths(criteria.largeHolderTrend.minimumRatioPct), trendMax = hundredths(criteria.largeHolderTrend.maximumRatioPct);
    return booleans && trendMin !== null && trendMax !== null && trendMin <= trendMax
        && hundredths(criteria.largeHolderTrend.minimumIncreasePp) !== null
        && Number.isInteger(criteria.largeHolderTrend.weeks) && criteria.largeHolderTrend.weeks >= 1 && criteria.largeHolderTrend.weeks <= 12
        && [criteria.largeHolderConcentration.weeks, criteria.retailHolderDecline.weeks].every((value) => Number.isInteger(value) && value >= 1 && value <= 12)
        && Number.isInteger(criteria.trustOwnership.days) && criteria.trustOwnership.days >= 5 && criteria.trustOwnership.days <= 10
        && hundredths(criteria.trustOwnership.minimumPct, 1000) !== null
        && Number.isInteger(criteria.priceMargin.days) && criteria.priceMargin.days >= 1 && criteria.priceMargin.days <= 20
        && hundredths(criteria.shortMarginRatio.minimumPct, 1000) !== null && Number(criteria.shortMarginRatio.minimumPct) >= 0.01
        && Number.isInteger(criteria.closeHigh.days) && criteria.closeHigh.days >= 2 && criteria.closeHigh.days <= 120
        && [5, 10, 20, 60].includes(criteria.closeSmaBreakout.period)
        && (legacyEnabled(criteria) || chipKeys.some((key) => criteria[key].enabled));
}

export function effectiveCriteriaV5(criteria: CriteriaV5): CriteriaV5 {
    const legacy = effectiveCriteriaV4(criteria);
    return { ...legacy,
        largeHolderTrend: { ...criteria.largeHolderTrend }, largeHolderConcentration: { ...criteria.largeHolderConcentration },
        retailHolderDecline: { ...criteria.retailHolderDecline }, trustOwnership: { ...criteria.trustOwnership },
        priceMargin: { ...criteria.priceMargin }, shortMarginRatio: { ...criteria.shortMarginRatio },
        closeHigh: { ...criteria.closeHigh }, closeSmaBreakout: { ...criteria.closeSmaBreakout } };
}

export function criteriaFingerprintV5(criteria: CriteriaV5): string {
    if (!validateCriteriaV5(criteria)) throw new Error('invalid_criteria');
    const value = effectiveCriteriaV5(criteria);
    const legacy = legacyEnabled(value) ? criteriaFingerprintV4(value) : 'legacy:off';
    const parts = chipKeys.map((key) => {
        const row = value[key];
        if (!row.enabled) return `${key}:off`;
        return `${key}:${Object.entries(row).filter(([name]) => name !== 'enabled').map(([name, item]) => `${name}=${item}`).join(',')}`;
    });
    return [SCREENER_V5_VERSION, value.mode, legacy, ...parts].join('|');
}

export function combineCriteriaV5(criteria: CriteriaV5, legacy: Partial<Record<'volume' | 'holder' | 'fractal' | 'bollReversal' | 'ma' | 'divergence', Verdict>>,
    chip: ChipOutcomesV5): Verdict {
    if (!validateCriteriaV5(criteria)) throw new Error('invalid_criteria');
    const verdicts: Verdict[] = [];
    for (const key of ['volume', 'holder', 'fractal', 'bollReversal', 'ma', 'divergence'] as const) {
        if (!criteria[key].enabled) continue;
        if (!legacy[key]) throw new Error('missing_enabled_branch');
        verdicts.push(legacy[key]!);
    }
    for (const key of chipKeys) if (criteria[key].enabled) verdicts.push(chip[key].verdict);
    return combineVerdicts(verdicts, criteria.mode);
}

export interface ScreenerPreferenceV5 extends Omit<ScreenerPreferenceV4, 'version' | 'query'> {
    version: 5;
    query: { criteria: CriteriaV5; sort: string; direction: 'asc' | 'desc'; resultState: Verdict };
}
const exactKeys = (value: unknown, keys: readonly string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).sort().join() === [...keys].sort().join();
const v5Sorts = ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak', 'confirmationDate', 'algorithm',
    'direction', 'outsideDistance', 'maSpread', 'pivotDate', 'priceDifference', 'largeHolderRatio', 'trustOwnershipPct',
    'shortMarginRatio', 'closeHighDays', 'smaPeriod'];
export function isV5Preference(value: unknown): value is ScreenerPreferenceV5 {
    const row = value as Partial<ScreenerPreferenceV5> | null;
    const query = row?.query;
    const criteria = query?.criteria as CriteriaV5 | undefined;
    return !!row && row.version === 5 && exactKeys(row, ['version', 'query'])
        && !!query && exactKeys(query, ['criteria', 'sort', 'direction', 'resultState'])
        && !!criteria && exactKeys(criteria, ['mode', 'volume', 'holder', 'fractal', 'bollReversal', 'ma', 'divergence',
            'largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership', 'priceMargin',
            'shortMarginRatio', 'closeHigh', 'closeSmaBreakout'])
        && exactKeys(criteria.volume, ['enabled', 'threshold', 'turnover'])
        && exactKeys(criteria.volume.turnover, ['enabled', 'minimumWan'])
        && exactKeys(criteria.holder, ['enabled', 'threshold', 'mode', 'streakWeeks', 'turnover'])
        && exactKeys(criteria.holder.turnover, ['enabled', 'minimumWan'])
        && exactKeys(criteria.fractal, ['enabled', 'algorithm', 'direction'])
        && exactKeys(criteria.bollReversal, ['enabled', 'mode'])
        && exactKeys(criteria.ma, ['enabled', 'mode', 'compressionDays', 'maxSpreadPct'])
        && exactKeys(criteria.divergence, ['enabled', 'source', 'direction', 'requireZeroReset'])
        && exactKeys(criteria.largeHolderTrend, ['enabled', 'minimumRatioPct', 'maximumRatioPct', 'weeks', 'minimumIncreasePp'])
        && exactKeys(criteria.largeHolderConcentration, ['enabled', 'weeks'])
        && exactKeys(criteria.retailHolderDecline, ['enabled', 'weeks'])
        && exactKeys(criteria.trustOwnership, ['enabled', 'days', 'minimumPct'])
        && exactKeys(criteria.priceMargin, ['enabled', 'days'])
        && exactKeys(criteria.shortMarginRatio, ['enabled', 'minimumPct'])
        && exactKeys(criteria.closeHigh, ['enabled', 'days'])
        && exactKeys(criteria.closeSmaBreakout, ['enabled', 'period'])
        && validateCriteriaV5(criteria) && v5Sorts.includes(query.sort!) && ['asc', 'desc'].includes(query.direction!)
        && ['pass', 'fail', 'unknown'].includes(query.resultState!);
}

export function migrateCriteriaV4ToV5(criteria: CriteriaV4): CriteriaV5 {
    return { ...criteria, volume: { ...criteria.volume, turnover: { ...criteria.volume.turnover } },
        holder: { ...criteria.holder, turnover: { ...criteria.holder.turnover } }, fractal: { ...criteria.fractal },
        bollReversal: { ...criteria.bollReversal }, ma: { ...criteria.ma }, divergence: { ...criteria.divergence },
        largeHolderTrend: { ...DEFAULT_CRITERIA_V5.largeHolderTrend }, largeHolderConcentration: { ...DEFAULT_CRITERIA_V5.largeHolderConcentration },
        retailHolderDecline: { ...DEFAULT_CRITERIA_V5.retailHolderDecline }, trustOwnership: { ...DEFAULT_CRITERIA_V5.trustOwnership },
        priceMargin: { ...DEFAULT_CRITERIA_V5.priceMargin }, shortMarginRatio: { ...DEFAULT_CRITERIA_V5.shortMarginRatio },
        closeHigh: { ...DEFAULT_CRITERIA_V5.closeHigh }, closeSmaBreakout: { ...DEFAULT_CRITERIA_V5.closeSmaBreakout } };
}
