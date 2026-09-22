import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA_V5 } from './stock-screener-v5';
import {
    DEFAULT_CRITERIA_V6, SCREENER_INSTITUTIONAL_MAPPING_VERSION, combineCriteriaV6,
    criteriaFingerprintV6, evaluateForeignReversal, evaluateTrustReversal, isV6Preference,
    migrateCriteriaV5ToV6, validateCriteriaV6, type InstitutionalSnapshotEvidenceV6,
} from './stock-screener-v6';

const sessions = Array.from({ length: 25 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);
function feature(): InstitutionalSnapshotEvidenceV6 {
    return {
        dailySessions: sessions,
        daily: sessions.map((sessionDate, index) => ({
            sessionDate,
            foreignNetShares: index >= 21 && index <= 23 ? '-200000' : index === 24 ? '1500000' : '0',
            investmentTrustNetShares: index >= 21 && index <= 23 ? '-200000' : index === 24 ? '600000' : '0',
            close: index === 24 ? '20' : '10', volumeShares: index === 24 ? '5000000' : '1000000',
            institutionalReceiptId: `receipt-${index}`, institutionalMappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION,
        })),
        issuedCommonShares: { shares: '100000000', asOfDate: '2026-08-01', sourceUrl: 'fixture',
            payloadHash: 'a'.repeat(64), normalizationVersion: 'fixture' },
        dailyThrough: sessions.at(-1)!, mappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION, evidenceHash: 'b'.repeat(64),
    };
}

describe('stock screener v6 institutional reversal', () => {
    it('提供可遷移且預設關閉的合法 v6 criteria', () => {
        const criteria = migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5);
        expect(criteria.foreignReversal.enabled).toBe(false);
        expect(criteria.trustReversal.minimumRecoveryPct).toBe('50');
        expect(validateCriteriaV6(criteria)).toBe(true);
        expect(criteriaFingerprintV6(criteria)).toContain('foreignReversal:off');
    });

    it('拒絕成交參與率上下限顛倒與所有條件關閉', () => {
        const bad = migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5);
        bad.trustReversal = { ...bad.trustReversal, enabled: true, minimumParticipationPct: '15', maximumParticipationPct: '1' };
        expect(validateCriteriaV6(bad)).toBe(false);
        const none = migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5);
        for (const value of Object.values(none)) if (value && typeof value === 'object' && 'enabled' in value) value.enabled = false;
        expect(validateCriteriaV6(none)).toBe(false);
    });

    it('外資條件使用 D-3 至 D-1 且平均窗排除今日', () => {
        const outcome = evaluateForeignReversal(feature(), { ...DEFAULT_CRITERIA_V6.foreignReversal, enabled: true });
        expect(outcome.verdict).toBe('pass');
        expect(outcome.evidence.priorNetRows.map((row) => row.sessionDate)).toEqual(sessions.slice(-4, -1));
        expect(outcome.evidence.comparisonDates).toEqual(sessions.slice(-6, -1));
        expect(outcome.evidence.metrics.averageVolumeShares).toBe(1_000_000);
        expect(outcome.evidence.metrics.turnoverMultiple).toBe(5);
        expect(outcome.evidence.metrics.ma).toBe(12);
    });

    it('零買賣超不算連續賣超', () => {
        const value = feature();
        value.daily.at(-2)!.foreignNetShares = '0';
        const outcome = evaluateForeignReversal(value, { ...DEFAULT_CRITERIA_V6.foreignReversal, enabled: true });
        expect(outcome.verdict).toBe('fail');
        expect(outcome.evidence.checks.sellStreak.verdict).toBe('fail');
    });

    it('投信回補 100% 且參與率介於 1% 與 15% 時通過', () => {
        const outcome = evaluateTrustReversal(feature(), { ...DEFAULT_CRITERIA_V6.trustReversal, enabled: true });
        expect(outcome.verdict).toBe('pass');
        expect(outcome.evidence.metrics.recoveryPct).toBe(100);
        expect(outcome.evidence.metrics.participationPct).toBe(12);
        expect(outcome.evidence.checks.participation.verdict).toBe('pass');
    });

    it('成交參與率等於下限時嚴格失敗', () => {
        const value = feature();
        value.daily.at(-1)!.investmentTrustNetShares = '50000';
        const criteria = { ...DEFAULT_CRITERIA_V6.trustReversal, enabled: true, todayNetBuyMinimumLots: '1', minimumRecoveryPct: '1' };
        const outcome = evaluateTrustReversal(value, criteria);
        expect(outcome.evidence.metrics.participationPct).toBe(1);
        expect(outcome.evidence.checks.participation.verdict).toBe('fail');
    });

    it('缺少相鄰日與無效股本都為 unknown', () => {
        const missing = feature();
        missing.daily.splice(-3, 1);
        expect(evaluateForeignReversal(missing, { ...DEFAULT_CRITERIA_V6.foreignReversal, enabled: true }).verdict).toBe('unknown');
        const shares = feature(); shares.issuedCommonShares.shares = null;
        const result = evaluateForeignReversal(shares, { ...DEFAULT_CRITERIA_V6.foreignReversal, enabled: true });
        expect(result.verdict).toBe('unknown');
        expect(result.reason).toBe('issued_shares_invalid');
    });

    it('新條件可單獨參與全域 all/any 組合', () => {
        const criteria = migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5);
        for (const value of Object.values(criteria)) if (value && typeof value === 'object' && 'enabled' in value) value.enabled = false;
        criteria.foreignReversal.enabled = true;
        const pass = evaluateForeignReversal(feature(), criteria.foreignReversal);
        const institutional = { foreignReversal: pass, trustReversal: evaluateTrustReversal(feature(), criteria.trustReversal) };
        const chip = Object.fromEntries(['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership',
            'priceMargin', 'shortMarginRatio', 'closeHigh', 'closeSmaBreakout'].map((key) => [key, { verdict: 'fail', reason: 'none' }])) as never;
        expect(combineCriteriaV6(criteria, {}, chip, institutional)).toBe('pass');
    });

    it('驗證 v6 preference exact keys', () => {
        const criteria = migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5);
        const preference = { version: 6, query: { criteria, sort: 'code', direction: 'asc', resultState: 'pass' } };
        expect(isV6Preference(preference)).toBe(true);
        expect(isV6Preference({ ...preference, extra: true })).toBe(false);
    });
});
