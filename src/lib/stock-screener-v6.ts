/** 收盤後選股 v6 法人連賣轉買純函式；不得在此模組抓來源、寫 DB 或觸發交易。 */
import { combineVerdicts, hundredths, type Verdict } from './stock-screener-domain.ts';
import { canonicalPriceUnits, canonicalVolumeShares } from './stock-screener-ohlcv.ts';
import {
    DEFAULT_CRITERIA_V5, effectiveCriteriaV5, validateCriteriaV5,
    type ChipOutcomesV5, type CriteriaV5, type ScreenerInputV5, type ScreenerPreferenceV5,
} from './stock-screener-v5.ts';

export const SCREENER_V6_VERSION = 6 as const;
export const SCREENER_V6_SCHEMA_VERSION = 6 as const;
export const SCREENER_V6_FORMULA_VERSION = 'after-market-v6-institutional-reversal-1' as const;
export const SCREENER_INSTITUTIONAL_MAPPING_VERSION = 'official-market-institutional-v2' as const;

export interface ReversalPriceVolumeCriteria {
    sellStreakDays: number;
    todayNetBuyMinimumLots: string;
    minimumTurnoverPct: string;
    comparisonDays: number;
    turnoverMultiple: string;
    maPeriod: number;
    liquidityDays: number;
    minimumAverageVolumeLots: string;
}

export interface ForeignReversalCriteria extends ReversalPriceVolumeCriteria { enabled: boolean }
export interface TrustReversalCriteria extends ReversalPriceVolumeCriteria {
    enabled: boolean;
    minimumRecoveryPct: string;
    minimumParticipationPct: string;
    maximumParticipationPct: string;
}

export interface CriteriaV6 extends CriteriaV5 {
    foreignReversal: ForeignReversalCriteria;
    trustReversal: TrustReversalCriteria;
}

const COMMON_DEFAULTS: ReversalPriceVolumeCriteria = {
    sellStreakDays: 3,
    todayNetBuyMinimumLots: '1000',
    minimumTurnoverPct: '2',
    comparisonDays: 5,
    turnoverMultiple: '2',
    maPeriod: 5,
    liquidityDays: 20,
    minimumAverageVolumeLots: '1000',
};

export const DEFAULT_CRITERIA_V6: CriteriaV6 = {
    ...DEFAULT_CRITERIA_V5,
    volume: { ...DEFAULT_CRITERIA_V5.volume, turnover: { ...DEFAULT_CRITERIA_V5.volume.turnover } },
    holder: { ...DEFAULT_CRITERIA_V5.holder, turnover: { ...DEFAULT_CRITERIA_V5.holder.turnover } },
    fractal: { ...DEFAULT_CRITERIA_V5.fractal }, bollReversal: { ...DEFAULT_CRITERIA_V5.bollReversal },
    ma: { ...DEFAULT_CRITERIA_V5.ma }, divergence: { ...DEFAULT_CRITERIA_V5.divergence },
    largeHolderTrend: { ...DEFAULT_CRITERIA_V5.largeHolderTrend },
    largeHolderConcentration: { ...DEFAULT_CRITERIA_V5.largeHolderConcentration },
    retailHolderDecline: { ...DEFAULT_CRITERIA_V5.retailHolderDecline },
    trustOwnership: { ...DEFAULT_CRITERIA_V5.trustOwnership }, priceMargin: { ...DEFAULT_CRITERIA_V5.priceMargin },
    shortMarginRatio: { ...DEFAULT_CRITERIA_V5.shortMarginRatio }, closeHigh: { ...DEFAULT_CRITERIA_V5.closeHigh },
    closeSmaBreakout: { ...DEFAULT_CRITERIA_V5.closeSmaBreakout },
    foreignReversal: { enabled: false, ...COMMON_DEFAULTS },
    trustReversal: {
        enabled: false, ...COMMON_DEFAULTS, todayNetBuyMinimumLots: '500',
        minimumRecoveryPct: '50', minimumParticipationPct: '1', maximumParticipationPct: '15',
    },
};

export interface InstitutionalDailyPointV6 {
    sessionDate: string;
    foreignNetShares: string | null;
    investmentTrustNetShares: string | null;
    close: string | null;
    volumeShares: string | null;
    institutionalReceiptId: string | null;
    institutionalMappingVersion: string | null;
}

export interface InstitutionalSnapshotEvidenceV6 {
    dailySessions: string[];
    daily: InstitutionalDailyPointV6[];
    issuedCommonShares: {
        shares: string | null;
        asOfDate: string | null;
        sourceUrl: string | null;
        payloadHash: string | null;
        normalizationVersion: string | null;
    };
    dailyThrough: string;
    mappingVersion: typeof SCREENER_INSTITUTIONAL_MAPPING_VERSION;
    evidenceHash: string;
}

export interface ScreenerInputV6 extends ScreenerInputV5 { institutionalV6: InstitutionalSnapshotEvidenceV6 }

export type V6Reason = 'none' | 'non_adjacent_sessions' | 'missing_source_row' | 'insufficient_history'
    | 'issued_shares_invalid' | 'invalid_ratio' | 'invalid_volume' | 'invalid_close' | 'mapping_unverified'
    | 'mixed_session_dates';

export type InstitutionalCheckKey = 'sellStreak' | 'todayNetBuy' | 'minimumTurnover' | 'turnoverMultiple'
    | 'closeAboveMa' | 'volumeAboveAverage' | 'minimumLiquidity' | 'recovery' | 'participation';
export interface InstitutionalCheck {
    verdict: Verdict;
    reason: V6Reason;
    actual?: string | number;
    threshold?: string | number;
    dates?: string[];
}
export interface InstitutionalReversalEvidence {
    today: { sessionDate: string; netShares: string | null; close: string | null; volumeShares: string | null };
    priorNetRows: { sessionDate: string; netShares: string | null; receiptId: string | null }[];
    comparisonDates: string[];
    liquidityDates: string[];
    issuedCommonShares: string | null;
    checks: Record<InstitutionalCheckKey, InstitutionalCheck>;
    metrics: {
        turnoverPct: number | null;
        averageTurnoverPct: number | null;
        turnoverMultiple: number | null;
        ma: number | null;
        averageVolumeShares: number | null;
        averageLiquidityShares: number | null;
        recoveryPct: number | null;
        participationPct: number | null;
    };
    formulaVersion: typeof SCREENER_V6_FORMULA_VERSION;
    mappingVersion: typeof SCREENER_INSTITUTIONAL_MAPPING_VERSION;
}
export interface InstitutionalReversalOutcome {
    verdict: Verdict;
    reason: V6Reason;
    evidence: InstitutionalReversalEvidence;
}
export interface InstitutionalOutcomesV6 {
    foreignReversal: InstitutionalReversalOutcome;
    trustReversal: InstitutionalReversalOutcome;
}

const integerLots = (value: string): bigint | null => typeof value === 'string' && /^(?:0|[1-9]\d{0,7})$/.test(value)
    ? BigInt(value) : null;
const signed = (value: string | null): bigint | null => value !== null && /^-?(?:0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
const unsigned = (value: string | null): bigint | null => value !== null && /^(?:0|[1-9]\d*)$/.test(value) ? BigInt(value) : null;
const safeNumber = (numerator: bigint, denominator: bigint, scale = 1): number | null => {
    if (denominator === BigInt(0)) return null;
    const value = Number(numerator) / Number(denominator) * scale;
    return Number.isFinite(value) ? value : null;
};
const check = (pass: boolean, actual?: string | number, threshold?: string | number, dates?: string[]): InstitutionalCheck => ({
    verdict: pass ? 'pass' : 'fail', reason: 'none', actual, threshold, dates,
});
const missingCheck = (reason: V6Reason, dates?: string[]): InstitutionalCheck => ({ verdict: 'unknown', reason, dates });

const v5ConditionEnabled = (criteria: CriteriaV5) => [criteria.volume, criteria.holder, criteria.fractal, criteria.bollReversal,
    criteria.ma, criteria.divergence, criteria.largeHolderTrend, criteria.largeHolderConcentration, criteria.retailHolderDecline,
    criteria.trustOwnership, criteria.priceMargin, criteria.shortMarginRatio, criteria.closeHigh, criteria.closeSmaBreakout]
    .some((row) => row.enabled);

const commonValid = (criteria: ReversalPriceVolumeCriteria) => Number.isInteger(criteria.sellStreakDays)
    && criteria.sellStreakDays >= 1 && criteria.sellStreakDays <= 10
    && integerLots(criteria.todayNetBuyMinimumLots) !== null
    && integerLots(criteria.todayNetBuyMinimumLots)! > BigInt(0)
    && hundredths(criteria.minimumTurnoverPct, 1000) !== null
    && Number(criteria.minimumTurnoverPct) > 0
    && Number.isInteger(criteria.comparisonDays) && criteria.comparisonDays >= 2 && criteria.comparisonDays <= 20
    && hundredths(criteria.turnoverMultiple, 100) !== null && Number(criteria.turnoverMultiple) > 0
    && Number.isInteger(criteria.maPeriod) && criteria.maPeriod >= 2 && criteria.maPeriod <= 60
    && Number.isInteger(criteria.liquidityDays) && criteria.liquidityDays >= 5 && criteria.liquidityDays <= 60
    && integerLots(criteria.minimumAverageVolumeLots) !== null;

export function validateCriteriaV6(criteria: CriteriaV6): boolean {
    if (!criteria || !criteria.foreignReversal || !criteria.trustReversal
        || typeof criteria.foreignReversal.enabled !== 'boolean' || typeof criteria.trustReversal.enabled !== 'boolean') return false;
    const base = v5ConditionEnabled(criteria) ? criteria : { ...criteria, volume: { ...criteria.volume, enabled: true } };
    const minParticipation = hundredths(criteria.trustReversal.minimumParticipationPct);
    const maxParticipation = hundredths(criteria.trustReversal.maximumParticipationPct);
    return validateCriteriaV5(base) && commonValid(criteria.foreignReversal) && commonValid(criteria.trustReversal)
        && hundredths(criteria.trustReversal.minimumRecoveryPct, 10000) !== null
        && minParticipation !== null && maxParticipation !== null && minParticipation < maxParticipation
        && (v5ConditionEnabled(criteria) || criteria.foreignReversal.enabled || criteria.trustReversal.enabled);
}

export function effectiveCriteriaV6(criteria: CriteriaV6): CriteriaV6 {
    const base = effectiveCriteriaV5(criteria);
    return {
        ...base,
        foreignReversal: { ...criteria.foreignReversal },
        trustReversal: { ...criteria.trustReversal },
    };
}

const reversalFingerprint = (name: string, value: ForeignReversalCriteria | TrustReversalCriteria) => {
    if (!value.enabled) return `${name}:off`;
    return `${name}:${Object.entries(value).filter(([key]) => key !== 'enabled').map(([key, item]) => `${key}=${item}`).join(',')}`;
};

export function criteriaFingerprintV6(criteria: CriteriaV6): string {
    if (!validateCriteriaV6(criteria)) throw new Error('invalid_criteria');
    const value = effectiveCriteriaV6(criteria);
    const base = v5ConditionEnabled(value)
        ? [value.mode, ...Object.entries(value).filter(([key]) => !['mode', 'foreignReversal', 'trustReversal'].includes(key))
            .map(([key, item]) => `${key}:${JSON.stringify(item)}`)].join('|') : 'v5:off';
    return [SCREENER_V6_VERSION, base, reversalFingerprint('foreignReversal', value.foreignReversal),
        reversalFingerprint('trustReversal', value.trustReversal)].join('|');
}

const expectedRows = (feature: InstitutionalSnapshotEvidenceV6, count: number): { rows: InstitutionalDailyPointV6[] | null; reason: V6Reason } => {
    if (feature.mappingVersion !== SCREENER_INSTITUTIONAL_MAPPING_VERSION) return { rows: null, reason: 'mapping_unverified' };
    if (feature.dailyThrough !== feature.dailySessions.at(-1)) return { rows: null, reason: 'mixed_session_dates' };
    if (feature.dailySessions.length < count) return { rows: null, reason: 'insufficient_history' };
    if (new Set(feature.dailySessions).size !== feature.dailySessions.length
        || feature.dailySessions.some((date, index) => index > 0 && date <= feature.dailySessions[index - 1]!)) {
        return { rows: null, reason: 'non_adjacent_sessions' };
    }
    const dates = feature.dailySessions.slice(-count);
    const map = new Map(feature.daily.map((row) => [row.sessionDate, row]));
    const rows = dates.map((date) => map.get(date));
    return rows.every(Boolean) ? { rows: rows as InstitutionalDailyPointV6[], reason: 'none' }
        : { rows: null, reason: 'missing_source_row' };
};

function emptyEvidence(feature: InstitutionalSnapshotEvidenceV6): InstitutionalReversalEvidence {
    const latest = feature.dailySessions.at(-1) ?? feature.dailyThrough;
    const row = feature.daily.find((point) => point.sessionDate === latest);
    const unknown = missingCheck('insufficient_history');
    return {
        today: { sessionDate: latest, netShares: null, close: row?.close ?? null, volumeShares: row?.volumeShares ?? null },
        priorNetRows: [], comparisonDates: [], liquidityDates: [], issuedCommonShares: feature.issuedCommonShares.shares,
        checks: { sellStreak: unknown, todayNetBuy: unknown, minimumTurnover: unknown, turnoverMultiple: unknown,
            closeAboveMa: unknown, volumeAboveAverage: unknown, minimumLiquidity: unknown, recovery: unknown, participation: unknown },
        metrics: { turnoverPct: null, averageTurnoverPct: null, turnoverMultiple: null, ma: null,
            averageVolumeShares: null, averageLiquidityShares: null, recoveryPct: null, participationPct: null },
        formulaVersion: SCREENER_V6_FORMULA_VERSION, mappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION,
    };
}

function evaluateReversal(feature: InstitutionalSnapshotEvidenceV6, criteria: ForeignReversalCriteria | TrustReversalCriteria,
    investor: 'foreign' | 'trust'): InstitutionalReversalOutcome {
    const required = Math.max(criteria.sellStreakDays + 1, criteria.comparisonDays + 1, criteria.maPeriod, criteria.liquidityDays + 1);
    const expected = expectedRows(feature, required), rows = expected.rows;
    if (!rows) {
        const evidence = emptyEvidence(feature);
        for (const key of Object.keys(evidence.checks) as InstitutionalCheckKey[]) evidence.checks[key] = missingCheck(expected.reason);
        return { verdict: 'unknown', reason: expected.reason, evidence };
    }
    const today = rows.at(-1)!;
    const mappingVerified = rows.every((row) => row.institutionalMappingVersion === SCREENER_INSTITUTIONAL_MAPPING_VERSION
        && row.institutionalReceiptId);
    const evidence = emptyEvidence(feature);
    const net = (row: InstitutionalDailyPointV6) => signed(investor === 'foreign' ? row.foreignNetShares : row.investmentTrustNetShares);
    evidence.today = { sessionDate: today.sessionDate,
        netShares: investor === 'foreign' ? today.foreignNetShares : today.investmentTrustNetShares,
        close: today.close, volumeShares: today.volumeShares };
    const prior = rows.slice(-criteria.sellStreakDays - 1, -1);
    evidence.priorNetRows = prior.map((row) => ({ sessionDate: row.sessionDate,
        netShares: investor === 'foreign' ? row.foreignNetShares : row.investmentTrustNetShares,
        receiptId: row.institutionalReceiptId }));
    const comparison = rows.slice(-criteria.comparisonDays - 1, -1);
    const maRows = rows.slice(-criteria.maPeriod);
    const liquidity = rows.slice(-criteria.liquidityDays - 1, -1);
    evidence.comparisonDates = comparison.map((row) => row.sessionDate);
    evidence.liquidityDates = liquidity.map((row) => row.sessionDate);
    if (!mappingVerified) {
        for (const key of Object.keys(evidence.checks) as InstitutionalCheckKey[]) evidence.checks[key] = missingCheck('mapping_unverified');
        return { verdict: 'unknown', reason: 'mapping_unverified', evidence };
    }
    const todayNet = net(today), priorNets = prior.map(net);
    if (todayNet === null || priorNets.some((value) => value === null)) {
        evidence.checks.sellStreak = missingCheck('missing_source_row', prior.map((row) => row.sessionDate));
        evidence.checks.todayNetBuy = missingCheck('missing_source_row', [today.sessionDate]);
        return { verdict: 'unknown', reason: 'missing_source_row', evidence };
    }
    evidence.checks.sellStreak = check(priorNets.every((value) => value! < BigInt(0)),
        priorNets.map(String).join(','), '<0 daily', prior.map((row) => row.sessionDate));
    const minimumNet = integerLots(criteria.todayNetBuyMinimumLots)! * BigInt(1000);
    evidence.checks.todayNetBuy = check(todayNet > minimumNet, todayNet.toString(), `>${minimumNet}`, [today.sessionDate]);

    const shares = unsigned(feature.issuedCommonShares.shares);
    evidence.issuedCommonShares = feature.issuedCommonShares.shares;
    if (shares === null || shares === BigInt(0) || !feature.issuedCommonShares.asOfDate
        || feature.issuedCommonShares.asOfDate > feature.dailyThrough) {
        for (const key of ['minimumTurnover', 'turnoverMultiple'] as const) evidence.checks[key] = missingCheck('issued_shares_invalid');
        return { verdict: 'unknown', reason: 'issued_shares_invalid', evidence };
    }
    const todayVolume = today.volumeShares === null ? null : canonicalVolumeShares(today.volumeShares);
    const comparisonVolumes = comparison.map((row) => row.volumeShares === null ? null : canonicalVolumeShares(row.volumeShares));
    const liquidityVolumes = liquidity.map((row) => row.volumeShares === null ? null : canonicalVolumeShares(row.volumeShares));
    if (todayVolume === null || todayVolume === BigInt(0) || comparisonVolumes.some((value) => value === null)
        || liquidityVolumes.some((value) => value === null)) {
        for (const key of ['minimumTurnover', 'turnoverMultiple', 'volumeAboveAverage', 'minimumLiquidity', 'participation'] as const) {
            evidence.checks[key] = missingCheck('invalid_volume');
        }
        return { verdict: 'unknown', reason: 'invalid_volume', evidence };
    }
    const closeValues = maRows.map((row) => row.close === null ? null : canonicalPriceUnits(row.close));
    if (closeValues.some((value) => value === null)) {
        evidence.checks.closeAboveMa = missingCheck('invalid_close');
        return { verdict: 'unknown', reason: 'invalid_close', evidence };
    }
    const comparisonSum = comparisonVolumes.reduce<bigint>((sum, value) => sum + value!, BigInt(0));
    const liquiditySum = liquidityVolumes.reduce<bigint>((sum, value) => sum + value!, BigInt(0));
    const closeSum = closeValues.reduce<bigint>((sum, value) => sum + value!, BigInt(0));
    const todayClose = closeValues.at(-1)! as bigint;
    const minimumTurnover = hundredths(criteria.minimumTurnoverPct, 1000)!;
    const multiple = hundredths(criteria.turnoverMultiple, 100)!;
    const minimumLiquidityShares = integerLots(criteria.minimumAverageVolumeLots)! * BigInt(1000);
    evidence.metrics.turnoverPct = safeNumber(todayVolume, shares, 100);
    evidence.metrics.averageTurnoverPct = safeNumber(comparisonSum, shares * BigInt(criteria.comparisonDays), 100);
    evidence.metrics.turnoverMultiple = safeNumber(todayVolume * BigInt(criteria.comparisonDays), comparisonSum);
    evidence.metrics.ma = safeNumber(closeSum, BigInt(criteria.maPeriod), 1 / 1_000_000);
    evidence.metrics.averageVolumeShares = safeNumber(comparisonSum, BigInt(criteria.comparisonDays));
    evidence.metrics.averageLiquidityShares = safeNumber(liquiditySum, BigInt(criteria.liquidityDays));
    evidence.checks.minimumTurnover = check(todayVolume * BigInt(10000) > minimumTurnover * shares,
        evidence.metrics.turnoverPct ?? '', `>${criteria.minimumTurnoverPct}%`, [today.sessionDate]);
    evidence.checks.turnoverMultiple = check(todayVolume * BigInt(criteria.comparisonDays) * BigInt(100) > comparisonSum * multiple,
        evidence.metrics.turnoverMultiple ?? '', `>${criteria.turnoverMultiple}x`, comparison.map((row) => row.sessionDate));
    evidence.checks.closeAboveMa = check(todayClose * BigInt(criteria.maPeriod) > closeSum,
        Number(todayClose) / 1_000_000, `>MA${criteria.maPeriod}`, maRows.map((row) => row.sessionDate));
    evidence.checks.volumeAboveAverage = check(todayVolume * BigInt(criteria.comparisonDays) > comparisonSum,
        todayVolume.toString(), `>avg(${criteria.comparisonDays})`, comparison.map((row) => row.sessionDate));
    evidence.checks.minimumLiquidity = check(liquiditySum >= minimumLiquidityShares * BigInt(criteria.liquidityDays),
        evidence.metrics.averageLiquidityShares ?? '', `>=${minimumLiquidityShares}`, liquidity.map((row) => row.sessionDate));
    evidence.checks.recovery = check(true);
    evidence.checks.participation = check(true);
    if (investor === 'trust') {
        const trust = criteria as TrustReversalCriteria;
        const priorSell = -priorNets.reduce<bigint>((sum, value) => sum + value!, BigInt(0));
        const recovery = hundredths(trust.minimumRecoveryPct, 10000)!;
        const minimumParticipation = hundredths(trust.minimumParticipationPct)!;
        const maximumParticipation = hundredths(trust.maximumParticipationPct)!;
        evidence.metrics.recoveryPct = safeNumber(todayNet, priorSell, 100);
        evidence.metrics.participationPct = safeNumber(todayNet, todayVolume, 100);
        evidence.checks.recovery = check(todayNet * BigInt(10000) >= priorSell * recovery,
            evidence.metrics.recoveryPct ?? '', `>=${trust.minimumRecoveryPct}%`, [today.sessionDate, ...prior.map((row) => row.sessionDate)]);
        evidence.checks.participation = check(todayNet * BigInt(10000) > todayVolume * minimumParticipation
            && todayNet * BigInt(10000) < todayVolume * maximumParticipation,
        evidence.metrics.participationPct ?? '', `>${trust.minimumParticipationPct}% and <${trust.maximumParticipationPct}%`, [today.sessionDate]);
    }
    const checks = Object.values(evidence.checks);
    const unknownCheck = checks.find((item) => item.verdict === 'unknown');
    if (unknownCheck) return { verdict: 'unknown', reason: unknownCheck.reason, evidence };
    return { verdict: checks.every((item) => item.verdict === 'pass') ? 'pass' : 'fail', reason: 'none', evidence };
}

export const evaluateForeignReversal = (feature: InstitutionalSnapshotEvidenceV6, criteria: ForeignReversalCriteria) =>
    evaluateReversal(feature, criteria, 'foreign');
export const evaluateTrustReversal = (feature: InstitutionalSnapshotEvidenceV6, criteria: TrustReversalCriteria) =>
    evaluateReversal(feature, criteria, 'trust');
export const evaluateInstitutionalCriteriaV6 = (feature: InstitutionalSnapshotEvidenceV6, criteria: CriteriaV6): InstitutionalOutcomesV6 => ({
    foreignReversal: evaluateForeignReversal(feature, criteria.foreignReversal),
    trustReversal: evaluateTrustReversal(feature, criteria.trustReversal),
});

const legacyKeys = ['volume', 'holder', 'fractal', 'bollReversal', 'ma', 'divergence'] as const;
const chipKeys = ['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership',
    'priceMargin', 'shortMarginRatio', 'closeHigh', 'closeSmaBreakout'] as const;
export function combineCriteriaV6(criteria: CriteriaV6,
    legacy: Partial<Record<typeof legacyKeys[number], Verdict>>, chip: ChipOutcomesV5,
    institutional: InstitutionalOutcomesV6): Verdict {
    if (!validateCriteriaV6(criteria)) throw new Error('invalid_criteria');
    const verdicts: Verdict[] = [];
    for (const key of legacyKeys) if (criteria[key].enabled) {
        if (!legacy[key]) throw new Error('missing_enabled_branch');
        verdicts.push(legacy[key]!);
    }
    for (const key of chipKeys) if (criteria[key].enabled) verdicts.push(chip[key].verdict);
    if (criteria.foreignReversal.enabled) verdicts.push(institutional.foreignReversal.verdict);
    if (criteria.trustReversal.enabled) verdicts.push(institutional.trustReversal.verdict);
    return combineVerdicts(verdicts, criteria.mode);
}

export type ScreenerSortV6 = import('./stock-screener-api.ts').ScreenerSortV5
    | 'foreignTodayNetBuy' | 'trustTodayNetBuy' | 'trustRecoveryPct' | 'trustParticipationPct';
export interface ScreenerPreferenceV6 extends Omit<ScreenerPreferenceV5, 'version' | 'query'> {
    version: 6;
    query: { criteria: CriteriaV6; sort: ScreenerSortV6; direction: 'asc' | 'desc'; resultState: Verdict };
}
const exactKeys = (value: unknown, keys: readonly string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).sort().join() === [...keys].sort().join();
const commonKeys = ['enabled', 'sellStreakDays', 'todayNetBuyMinimumLots', 'minimumTurnoverPct', 'comparisonDays',
    'turnoverMultiple', 'maPeriod', 'liquidityDays', 'minimumAverageVolumeLots'];
const v6Sorts: readonly ScreenerSortV6[] = ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak',
    'confirmationDate', 'algorithm', 'direction', 'outsideDistance', 'maSpread', 'pivotDate', 'priceDifference',
    'largeHolderRatio', 'trustOwnershipPct', 'shortMarginRatio', 'closeHighDays', 'smaPeriod',
    'foreignTodayNetBuy', 'trustTodayNetBuy', 'trustRecoveryPct', 'trustParticipationPct'];

export function isV6Preference(value: unknown): value is ScreenerPreferenceV6 {
    const row = value as Partial<ScreenerPreferenceV6> | null;
    const query = row?.query, criteria = query?.criteria;
    return !!row && row.version === 6 && exactKeys(row, ['version', 'query']) && !!query
        && exactKeys(query, ['criteria', 'sort', 'direction', 'resultState']) && !!criteria
        && exactKeys(criteria, [...Object.keys(DEFAULT_CRITERIA_V5), 'foreignReversal', 'trustReversal'])
        && exactKeys(criteria.foreignReversal, commonKeys)
        && exactKeys(criteria.trustReversal, [...commonKeys, 'minimumRecoveryPct', 'minimumParticipationPct', 'maximumParticipationPct'])
        && validateCriteriaV6(criteria) && v6Sorts.includes(query.sort as ScreenerSortV6)
        && ['asc', 'desc'].includes(String(query.direction)) && ['pass', 'fail', 'unknown'].includes(String(query.resultState));
}

export function migrateCriteriaV5ToV6(criteria: CriteriaV5): CriteriaV6 {
    return {
        ...criteria,
        volume: { ...criteria.volume, turnover: { ...criteria.volume.turnover } },
        holder: { ...criteria.holder, turnover: { ...criteria.holder.turnover } },
        fractal: { ...criteria.fractal }, bollReversal: { ...criteria.bollReversal }, ma: { ...criteria.ma },
        divergence: { ...criteria.divergence }, largeHolderTrend: { ...criteria.largeHolderTrend },
        largeHolderConcentration: { ...criteria.largeHolderConcentration }, retailHolderDecline: { ...criteria.retailHolderDecline },
        trustOwnership: { ...criteria.trustOwnership }, priceMargin: { ...criteria.priceMargin },
        shortMarginRatio: { ...criteria.shortMarginRatio }, closeHigh: { ...criteria.closeHigh },
        closeSmaBreakout: { ...criteria.closeSmaBreakout },
        foreignReversal: { ...DEFAULT_CRITERIA_V6.foreignReversal }, trustReversal: { ...DEFAULT_CRITERIA_V6.trustReversal },
    };
}
