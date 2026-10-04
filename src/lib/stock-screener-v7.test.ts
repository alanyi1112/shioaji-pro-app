import { describe, expect, it } from 'vitest';
import type { CanonicalOhlcv } from './stock-screener-ohlcv';
import { DEFAULT_CRITERIA_V6 } from './stock-screener-v6';
import { decodeScreenerResponse, screenerSearchV7 } from './stock-screener-api';
import {
    DEFAULT_CRITERIA_V7, SCREENER_V7_FORMULA_VERSION, buildTechnicalSnapshotEvidenceV7,
    combineCriteriaV7, criteriaFingerprintV7, effectiveCriteriaV7, evaluateBollPosition, evaluateKdCross, evaluateMacdSignal,
    evaluateRsiCross, evaluateVolumeConfirmation, isV7Preference, migrateCriteriaV6ToV7,
    validateCriteriaV7, type TechnicalSnapshotEvidenceV7,
} from './stock-screener-v7';

const volume = { enabled: false, baselineDays: 20, ratio: '1.2', minimumAverageVolumeEnabled: false,
    minimumAverageVolumeLots: '1000' };
const point = (sessionDate: string, overrides: Partial<TechnicalSnapshotEvidenceV7['points'][number]> = {}) => ({
    sessionDate, close: 100, volumeShares: '100000',
    boll: { upper: 110, middle: 100, lower: 90 }, rsi: { fast: 20, slow: 20 },
    kd: { fast: 20, slow: 20 }, macd: { dif: -1, dea: -1 }, ...overrides,
});
const feature = (points: TechnicalSnapshotEvidenceV7['points'], volumes = Array.from({ length: 61 }, (_, index) => ({
    sessionDate: `2026-01-${String(index + 1).padStart(2, '0')}`, volumeShares: index === 60 ? '120000' : '100000',
}))): TechnicalSnapshotEvidenceV7 => ({ sessions: points.map((row) => row.sessionDate), points, volumeHistory: volumes,
    readinessReason: 'none', missingSessions: [],
    through: points.at(-1)?.sessionDate ?? '', formulaVersion: SCREENER_V7_FORMULA_VERSION,
    sourceMappingVersion: 'official-daily-ohlcv-v2', evidenceHash: 'a'.repeat(64) });

describe('stock screener v7 criteria', () => {
    it('v6 遷移後新條件預設關閉且舊值不變', () => {
        const migrated = migrateCriteriaV6ToV7({ ...DEFAULT_CRITERIA_V6, volume: { ...DEFAULT_CRITERIA_V6.volume, enabled: true } });
        expect(migrated.volume).toEqual({ ...DEFAULT_CRITERIA_V6.volume, enabled: true });
        expect([migrated.bollPosition.enabled, migrated.rsiCross.enabled, migrated.kdCross.enabled, migrated.macdSignal.enabled])
            .toEqual([false, false, false, false]);
        expect(validateCriteriaV7(migrated)).toBe(true);
    });

    it('只啟用 v7 分支仍合法，未知欄位與非法門檻 fail closed', () => {
        const criteria = migrateCriteriaV6ToV7(DEFAULT_CRITERIA_V6);
        criteria.bollPosition.enabled = true;
        expect(validateCriteriaV7(criteria)).toBe(true);
        const preference = { version: 7 as const, query: { criteria, sort: 'code' as const, direction: 'asc' as const, resultState: 'pass' as const } };
        expect(isV7Preference(preference)).toBe(true);
        expect(isV7Preference({ ...preference, extra: true })).toBe(false);
        expect(validateCriteriaV7({ ...criteria, rsiCross: { ...criteria.rsiCross, lowThreshold: '80' } })).toBe(false);
        expect(validateCriteriaV7({ ...criteria, macdSignal: { ...criteria.macdSignal, approachThresholdPct: '0.001' } })).toBe(false);
    });

    it('停用或模式不適用的隱藏欄位不改 fingerprint', () => {
        const left = migrateCriteriaV6ToV7(DEFAULT_CRITERIA_V6);
        left.bollPosition.enabled = true;
        const right = structuredClone(left);
        right.rsiCross.highThreshold = '90';
        right.bollPosition.tolerancePercent = '25';
        expect(criteriaFingerprintV7(right)).toBe(criteriaFingerprintV7(left));
        right.bollPosition.mode = 'middle-near';
        expect(criteriaFingerprintV7(right)).not.toBe(criteriaFingerprintV7(left));
    });

    it('effective criteria 決定性移除停用與模式不適用的草稿值', () => {
        const criteria = migrateCriteriaV6ToV7(DEFAULT_CRITERIA_V6);
        criteria.bollPosition.enabled = true;
        criteria.bollPosition.tolerancePercent = '25';
        criteria.bollPosition.middleTrend = 'falling';
        criteria.bollPosition.volumeConfirmation.ratio = '9';
        criteria.rsiCross.highThreshold = '90';
        const effective = effectiveCriteriaV7(criteria);
        expect(effective.bollPosition.tolerancePercent).toBe('10');
        expect(effective.bollPosition.middleTrend).toBe('any');
        expect(effective.bollPosition.volumeConfirmation.ratio).toBe('1.2');
        expect(effective.rsiCross).toEqual(DEFAULT_CRITERIA_V7.rsiCross);
    });

    it('v7 query 序列化完整巢狀量能且離線 response 可安全解碼', () => {
        const criteria = migrateCriteriaV6ToV7(DEFAULT_CRITERIA_V6);
        criteria.macdSignal.enabled = true;
        criteria.macdSignal.volumeConfirmation.enabled = true;
        const search = screenerSearchV7({ criteria, sort: 'macdDif', direction: 'desc', resultState: 'pass' });
        expect(search).toContain('version=7');
        expect(search).toContain('macdSignalVolumeBaselineDays=20');
        expect(search).toContain('macdSignalVolumeRatio=1.2');
        expect(decodeScreenerResponse({ version: 7, state: 'unavailable', reason: 'local_data_service_unavailable',
            snapshotId: null, universeRevision: null, formulaVersion: SCREENER_V7_FORMULA_VERSION,
            sourceMappingVersion: 'official-daily-ohlcv-v2', criteriaFingerprint: null, expectedSessionDate: null,
            effectiveSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
            technicalAnchors: null, counts: null, byMarket: null, preparation: null, chipCoverage: null,
            institutionalCoverage: null, technicalCoverage: null, rows: [], nextCursor: null })).toMatchObject({ version: 7, state: 'unavailable' });
    });
});

describe('stock screener v7 signals', () => {
    it('BOLL 外軌採嚴格比較，中軌附近使用通道寬度與方向', () => {
        const base = feature([point('2026-09-18'), point('2026-09-21'), point('2026-09-22', { close: 110 })]);
        expect(evaluateBollPosition(base, { enabled: true, mode: 'upper-outside', tolerancePercent: '10', middleTrend: 'any', volumeConfirmation: volume }).verdict).toBe('fail');
        base.points[2]!.close = 110.000001;
        expect(evaluateBollPosition(base, { enabled: true, mode: 'upper-outside', tolerancePercent: '10', middleTrend: 'any', volumeConfirmation: volume }).verdict).toBe('pass');
        base.points[1]!.boll!.middle = 99;
        base.points[2]!.close = 101;
        expect(evaluateBollPosition(base, { enabled: true, mode: 'middle-near', tolerancePercent: '5', middleTrend: 'rising', volumeConfirmation: volume }).verdict).toBe('pass');
        base.points[2]!.boll = { upper: 100, middle: 100, lower: 100 };
        expect(evaluateBollPosition(base, { enabled: true, mode: 'middle-near', tolerancePercent: '5', middleTrend: 'any', volumeConfirmation: volume }).reason).toBe('zero_bollinger_width');
        base.points[2]!.boll = { upper: 110, middle: 100, lower: 90 };
        base.points[2]!.close = 90;
        expect(evaluateBollPosition(base, { enabled: true, mode: 'lower-outside', tolerancePercent: '5', middleTrend: 'any', volumeConfirmation: volume }).verdict).toBe('fail');
        base.points[2]!.close = 89.999999;
        expect(evaluateBollPosition(base, { enabled: true, mode: 'lower-outside', tolerancePercent: '5', middleTrend: 'any', volumeConfirmation: volume }).verdict).toBe('pass');
    });

    it('RSI 與 KD 使用 P/D 嚴格交叉，極值區允許出現在 P 或 D', () => {
        const rows = feature([
            point('2026-09-18'),
            point('2026-09-21', { rsi: { fast: 18, slow: 19 }, kd: { fast: 85, slow: 84 } }),
            point('2026-09-22', { rsi: { fast: 21, slow: 20 }, kd: { fast: 79, slow: 80 } }),
        ]);
        expect(evaluateRsiCross(rows, { enabled: true, mode: 'low-golden-cross', highThreshold: '80', lowThreshold: '20', volumeConfirmation: volume }).verdict).toBe('pass');
        expect(evaluateKdCross(rows, { enabled: true, mode: 'high-death-cross', highThreshold: '80', lowThreshold: '20', volumeConfirmation: volume }).verdict).toBe('pass');
        rows.points[2]!.rsi = { fast: 20, slow: 20 };
        expect(evaluateRsiCross(rows, { enabled: true, mode: 'low-golden-cross', highThreshold: '80', lowThreshold: '20', volumeConfirmation: volume }).verdict).toBe('fail');
    });

    it('MACD 區分連續靠近、零軸穿越與軸側交叉', () => {
        const rows = feature([
            point('2026-09-18', { macd: { dif: -0.5, dea: -0.4 } }),
            point('2026-09-21', { macd: { dif: -0.3, dea: -0.2 } }),
            point('2026-09-22', { close: 100, macd: { dif: -0.1, dea: -0.15 } }),
        ]);
        expect(evaluateMacdSignal(rows, { enabled: true, mode: 'approach-zero-below', approachThresholdPct: '0.25', volumeConfirmation: volume }).verdict).toBe('pass');
        expect(evaluateMacdSignal(rows, { enabled: true, mode: 'below-zero-golden-cross', approachThresholdPct: '0.25', volumeConfirmation: volume }).verdict).toBe('pass');
        rows.points[2]!.macd = { dif: 0.01, dea: -0.1 };
        expect(evaluateMacdSignal(rows, { enabled: true, mode: 'cross-zero-up', approachThresholdPct: '0.25', volumeConfirmation: volume }).verdict).toBe('pass');
        expect(evaluateMacdSignal(rows, { enabled: true, mode: 'below-zero-golden-cross', approachThresholdPct: '0.25', volumeConfirmation: volume }).verdict).toBe('fail');
    });

    it('量能基準排除 D，恰等門檻通過並以股為 canonical 單位', () => {
        const volumeRows = [
            ...Array.from({ length: 20 }, (_, index) => ({ sessionDate: `2026-08-${String(index + 1).padStart(2, '0')}`, volumeShares: '1000000' })),
            { sessionDate: '2026-09-22', volumeShares: '1200000' },
        ];
        const rows = feature([point('2026-09-18'), point('2026-09-21'), point('2026-09-22')], volumeRows);
        rows.sessions = volumeRows.map((row) => row.sessionDate);
        const result = evaluateVolumeConfirmation(rows, { enabled: true, baselineDays: 20, ratio: '1.2',
            minimumAverageVolumeEnabled: true, minimumAverageVolumeLots: '1000' });
        expect(result.verdict).toBe('pass');
        expect(result.baselineDates).toHaveLength(20);
        expect(result.baselineDates).not.toContain('2026-09-22');
        expect(result.averageVolumeShares).toBe(1_000_000);
        rows.volumeHistory.at(-1)!.volumeShares = '1199999';
        expect(evaluateVolumeConfirmation(rows, { enabled: true, baselineDays: 20, ratio: '1.2',
            minimumAverageVolumeEnabled: false, minimumAverageVolumeLots: '1000' }).verdict).toBe('fail');
        rows.volumeHistory[0]!.volumeShares = '0';
        rows.volumeHistory.slice(1, 20).forEach((row) => { row.volumeShares = '0'; });
        expect(evaluateVolumeConfirmation(rows, { enabled: true, baselineDays: 20, ratio: '1.2',
            minimumAverageVolumeEnabled: false, minimumAverageVolumeLots: '1000' }).reason).toBe('zero_volume_baseline');
        rows.volumeHistory[0]!.sessionDate = '2025-01-01';
        expect(evaluateVolumeConfirmation(rows, { enabled: true, baselineDays: 20, ratio: '1.2',
            minimumAverageVolumeEnabled: false, minimumAverageVolumeLots: '1000' }).reason).toBe('non_adjacent_sessions');
    });

    it('技術與量能先在分支內 AND，再依外層 all／any 合併三態', () => {
        const criteria = migrateCriteriaV6ToV7(DEFAULT_CRITERIA_V6);
        criteria.volume.enabled = false;
        criteria.holder.enabled = false;
        criteria.rsiCross.enabled = true;
        criteria.macdSignal.enabled = true;
        const outcome = (verdict: 'pass' | 'fail' | 'unknown') => ({ verdict, reason: verdict === 'unknown' ? 'indicator_warmup' as const : 'none' as const,
            signal: { verdict, reason: verdict === 'unknown' ? 'indicator_warmup' as const : 'none' as const },
            volumeConfirmation: { enabled: false, sessionDate: null, baselineDates: [], currentVolumeShares: null,
                averageVolumeShares: null, ratio: null, minimumAverageVolumeShares: null, verdict: 'pass' as const, reason: 'none' as const },
            formulaVersion: SCREENER_V7_FORMULA_VERSION });
        const technical = { bollPosition: outcome('fail'), rsiCross: outcome('unknown'), kdCross: outcome('fail'), macdSignal: outcome('pass') };
        expect(combineCriteriaV7(criteria, {}, {} as never, {} as never, technical)).toBe('unknown');
        criteria.mode = 'any';
        expect(combineCriteriaV7(criteria, {}, {} as never, {} as never, technical)).toBe('pass');
        technical.macdSignal = outcome('fail');
        expect(combineCriteriaV7(criteria, {}, {} as never, {} as never, technical)).toBe('unknown');
    });

    it('以既有 reference 指標建立 D/P/P2 與 61 日量能 evidence', async () => {
        const bars: CanonicalOhlcv[] = Array.from({ length: 70 }, (_, index) => ({
            sessionDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
            open: String(100 + index), high: String(102 + index), low: String(99 + index), close: String(101 + index),
            volumeShares: String(1_000_000 + index),
        }));
        const result = await buildTechnicalSnapshotEvidenceV7(bars, bars.map((bar) => bar.sessionDate), async () => 'b'.repeat(64));
        expect(result.points).toHaveLength(3);
        expect(result.points.at(-1)?.boll).not.toBeNull();
        expect(result.points.at(-1)?.rsi).not.toBeNull();
        expect(result.points.at(-1)?.kd).not.toBeNull();
        expect(result.points.at(-1)?.macd).not.toBeNull();
        expect(result.volumeHistory).toHaveLength(61);
        expect(result.readinessReason).toBe('none');
    });

    it('canonical window 缺交易日或 OHLCV 非法時保留明確 unknown 責任', async () => {
        const bars: CanonicalOhlcv[] = Array.from({ length: 40 }, (_, index) => ({
            sessionDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
            open: '100', high: '102', low: '99', close: '101', volumeShares: '1000000',
        }));
        const sessions = bars.map((bar) => bar.sessionDate);
        const missing = await buildTechnicalSnapshotEvidenceV7(bars.filter((_, index) => index !== 20), sessions, async () => 'c'.repeat(64));
        expect(missing.readinessReason).toBe('non_adjacent_sessions');
        expect(missing.missingSessions).toEqual([sessions[20]]);
        expect(evaluateKdCross(missing, { enabled: true, mode: 'low-golden-cross', highThreshold: '80',
            lowThreshold: '20', volumeConfirmation: volume }).reason).toBe('non_adjacent_sessions');
        const invalid = await buildTechnicalSnapshotEvidenceV7([{ ...bars[0]!, close: '0' }], [bars[0]!.sessionDate], async () => 'd'.repeat(64));
        expect(invalid.readinessReason).toBe('invalid_ohlcv');
        expect(evaluateBollPosition(invalid, { enabled: true, mode: 'upper-outside', tolerancePercent: '10',
            middleTrend: 'any', volumeConfirmation: volume }).reason).toBe('invalid_ohlcv');
    });
});
