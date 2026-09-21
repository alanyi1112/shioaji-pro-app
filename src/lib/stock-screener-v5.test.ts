import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CRITERIA_V5, LONG_TERM_LAYOUT_PRESET, combineCriteriaV5, criteriaFingerprintV5,
    evaluateChipCriteria, evaluateCloseHigh, evaluateCloseSmaBreakout, evaluateLargeHolderConcentration,
    evaluateLargeHolderTrend, evaluatePriceMargin, evaluateRetailHolderDecline, evaluateShortMarginRatio,
    evaluateTrustOwnership, migrateCriteriaV4ToV5, validateCriteriaV5, type ChipSnapshotEvidenceV5,
    isV5Preference,
} from './stock-screener-v5';
import { DEFAULT_CRITERIA_V4 } from './stock-screener-v4';

const sessions = Array.from({ length: 65 }, (_, index) => `2026-07-${String(index + 1).padStart(2, '0')}`);
const feature = (): ChipSnapshotEvidenceV5 => ({
    dailySessions: sessions,
    tdccWeeks: [
        { date: '2026-08-21', largeHolders: '20', largeShares: '1000', largeRatioPct: '40', retailRatioPct: '10', receiptId: 'a' },
        { date: '2026-08-28', largeHolders: '19', largeShares: '1100', largeRatioPct: '41', retailRatioPct: '9', receiptId: 'b' },
        { date: '2026-09-04', largeHolders: '18', largeShares: '1200', largeRatioPct: '42', retailRatioPct: '8', receiptId: 'c' },
        { date: '2026-09-11', largeHolders: '17', largeShares: '1300', largeRatioPct: '43', retailRatioPct: '7', receiptId: 'd' },
    ],
    daily: sessions.map((sessionDate, index) => ({ sessionDate, investmentTrustNetShares: index >= 60 ? '1000' : '0',
        marginTodayBalanceLots: String(200 - index), shortTodayBalanceLots: '20', institutionalReceiptId: `i-${index}`, marginReceiptId: `m-${index}` })),
    closes: sessions.map((sessionDate, index) => ({ sessionDate, close: String(index + 1) })),
    issuedCommonShares: { shares: '100000', asOfDate: '2026-07-01', sourceUrl: 'official', payloadHash: 'a'.repeat(64), normalizationVersion: 'v1' },
    dailyThrough: sessions.at(-1)!, weeklyThrough: '2026-09-11', mappingVersion: 'official-market-chip-v1', evidenceHash: 'b'.repeat(64),
});

describe('stock screener v5 chip formulas', () => {
    it('uses fixed TDCC levels and every adjacent transition', () => {
        expect(evaluateLargeHolderTrend(feature(), { enabled: true, minimumRatioPct: '40', maximumRatioPct: '45', weeks: 3, minimumIncreasePp: '0.5' }).verdict).toBe('pass');
        expect(evaluateLargeHolderConcentration(feature(), { enabled: true, weeks: 3 }).verdict).toBe('pass');
        expect(evaluateRetailHolderDecline(feature(), { enabled: true, weeks: 3 }).verdict).toBe('pass');
        const broken = feature(); broken.tdccWeeks[2]!.largeShares = null;
        expect(evaluateLargeHolderConcentration(broken, { enabled: true, weeks: 3 }).reason).toBe('incomplete_tdcc');
    });

    it('rejects missing or stale weeks instead of treating them as consecutive', () => {
        const broken = feature();
        broken.tdccPeriods = broken.tdccWeeks.map((point) => point.date);
        broken.tdccWeeks[1]!.date = '2026-08-22';
        expect(evaluateLargeHolderConcentration(broken, { enabled: true, weeks: 3 }).verdict).toBe('unknown');
        delete broken.tdccPeriods;
        expect(evaluateRetailHolderDecline(broken, { enabled: true, weeks: 3 }).verdict).toBe('unknown');
        const stale = feature(); stale.weeklyThrough = '2026-09-18';
        expect(evaluateLargeHolderTrend(stale, { ...DEFAULT_CRITERIA_V5.largeHolderTrend, enabled: true }).verdict).toBe('unknown');
    });

    it('calculates signed trust flow against immutable issued shares', () => {
        const outcome = evaluateTrustOwnership(feature(), { enabled: true, days: 5, minimumPct: '4.99' });
        expect(outcome.verdict).toBe('pass');
        const sold = feature(); sold.daily.at(-1)!.investmentTrustNetShares = '-10000';
        expect(evaluateTrustOwnership(sold, { enabled: true, days: 5, minimumPct: '0.01' }).verdict).toBe('fail');
        sold.issuedCommonShares.shares = '0';
        expect(evaluateTrustOwnership(sold, { enabled: true, days: 5, minimumPct: '0.01' }).reason).toBe('issued_shares_invalid');
    });

    it('compares aligned price and margin endpoints and rejects zero denominator', () => {
        expect(evaluatePriceMargin(feature(), { enabled: true, days: 5 }).verdict).toBe('pass');
        expect(evaluateShortMarginRatio(feature(), { enabled: true, minimumPct: '10' }).verdict).toBe('pass');
        const zero = feature(); zero.daily.at(-1)!.marginTodayBalanceLots = '0';
        expect(evaluateShortMarginRatio(zero, { enabled: true, minimumPct: '1' }).reason).toBe('invalid_balance');
    });

    it('uses close-only high and close crossing the same SMA period', () => {
        expect(evaluateCloseHigh(feature(), { enabled: true, days: 20 }).verdict).toBe('pass');
        const crossing = feature();
        crossing.closes = crossing.closes.map((row, index) => ({ ...row, close: index === 63 ? '1' : index === 64 ? '100' : '50' }));
        expect(evaluateCloseSmaBreakout(crossing, { enabled: true, period: 20 }).verdict).toBe('pass');
    });

    it('validates, fingerprints and combines new conditions with three-state semantics', () => {
        const criteria = migrateCriteriaV4ToV5(DEFAULT_CRITERIA_V4);
        criteria.volume.enabled = false; criteria.holder.enabled = false;
        criteria.largeHolderTrend.enabled = true;
        expect(validateCriteriaV5(criteria)).toBe(true);
        expect(criteriaFingerprintV5(criteria)).toContain('largeHolderTrend:');
        const outcomes = evaluateChipCriteria(feature(), criteria);
        expect(combineCriteriaV5(criteria, {}, outcomes)).toBe('pass');
        criteria.mode = 'all'; criteria.trustOwnership.enabled = true;
        const unknown = feature(); unknown.issuedCommonShares.shares = null;
        expect(combineCriteriaV5(criteria, {}, evaluateChipCriteria(unknown, criteria))).toBe('unknown');
    });

    it('keeps the long-term preset as an inspectable draft value', () => {
        expect(LONG_TERM_LAYOUT_PRESET.largeHolderTrend.enabled).toBe(true);
        expect(LONG_TERM_LAYOUT_PRESET.retailHolderDecline.enabled).toBe(true);
        expect(LONG_TERM_LAYOUT_PRESET.priceMargin.enabled).toBe(true);
        expect(LONG_TERM_LAYOUT_PRESET.mode).toBe('all');
    });

    it('rejects unknown preference fields and unsupported sorts', () => {
        const criteria = migrateCriteriaV4ToV5(DEFAULT_CRITERIA_V4);
        const preference = { version: 5, query: { criteria, sort: 'code', direction: 'asc', resultState: 'pass' } };
        expect(isV5Preference(preference)).toBe(true);
        expect(isV5Preference({ ...preference, future: true })).toBe(false);
        expect(isV5Preference({ ...preference, query: { ...preference.query, sort: 'future-sort' } })).toBe(false);
        expect(isV5Preference({ ...preference, query: { ...preference.query,
            criteria: { ...criteria, trustOwnership: { ...criteria.trustOwnership, future: true } } } })).toBe(false);
    });
});
