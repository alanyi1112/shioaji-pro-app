import { describe, expect, it } from 'vitest';
import { SCREENER_OHLCV_V4_MAPPING_VERSION, validateCanonicalOhlcv, type CanonicalOhlcv } from './stock-screener-ohlcv';
import {
    DEFAULT_CRITERIA_V4, buildDivergenceMatrix, buildMaFeatures, combineCriteriaV4,
    criteriaFingerprintV4, effectiveCriteriaV4, evaluateMaCriteria, selectStoredDivergence,
    validateCriteriaV4, type MaFeatureEvidence,
} from './stock-screener-v4';

const date = (index: number) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
const bar = (index: number, patch: Partial<CanonicalOhlcv> = {}): CanonicalOhlcv => ({
    sessionDate: date(index), open: '100', high: '106', low: '94', close: '100', volumeShares: '1000', ...patch,
});

const maPoint = (index: number, sma5: number, sma10: number, sma20: number, close = '100') => ({
    sessionDate: date(index), close, sma5, sma10, sma20,
    spreadPct: ((Math.max(sma5, sma10, sma20) - Math.min(sma5, sma10, sma20)) / sma20) * 100,
    gap: sma5 - sma20,
});

describe('選股 v4 OHLCV 與均線契約', () => {
    it('成交量只接受非負整數股數', () => {
        expect(validateCanonicalOhlcv(bar(0))).toBe(true);
        expect(validateCanonicalOhlcv(bar(0, { volumeShares: '0' }))).toBe(true);
        expect(validateCanonicalOhlcv(bar(0, { volumeShares: '1,000' }))).toBe(false);
        expect(validateCanonicalOhlcv(bar(0, { volumeShares: '-1' }))).toBe(false);
        expect(validateCanonicalOhlcv(bar(0, { volumeShares: '1.5' }))).toBe(false);
    });

    it('SMA feature 保留未四捨五入 spread 並只保存最新 11 日', () => {
        const bars = Array.from({ length: 40 }, (_, index) => bar(index, { close: index === 39 ? '100.1' : '100' }));
        const outcome = buildMaFeatures(bars);
        expect(outcome.verdict).toBe('pass');
        expect(outcome.evidence?.points).toHaveLength(11);
        expect(outcome.evidence?.points.at(-1)?.sessionDate).toBe(date(39));
        expect(outcome.evidence?.points.at(-1)?.spreadPct).toBeGreaterThan(0);
    });

    it('糾結門檻採含邊界，任一日超過就 fail', () => {
        const points = [maPoint(0, 100, 100.5, 100), maPoint(1, 100, 101, 100), maPoint(2, 100, 100.5, 100)];
        const features = { verdict: 'pass', reason: 'none', evidence: { points } } as const;
        expect(evaluateMaCriteria(features, { enabled: true, mode: 'bullish-preparation', compressionDays: 3, maxSpreadPct: '1' }).verdict).toBe('fail');
        const over = { ...features, evidence: { points: points.map((point, index) => index === 1 ? { ...point, spreadPct: 1.000001 } : point) } };
        expect(evaluateMaCriteria(over, { enabled: true, mode: 'bullish-preparation', compressionDays: 3, maxSpreadPct: '1' }).verdict).toBe('fail');
    });

    it('黃金交叉要求 P 小於等於且 D 嚴格大於，碰線不算交叉', () => {
        const prefix = Array.from({ length: 3 }, (_, index) => maPoint(index, 99.8, 99.9, 100));
        const crossed: MaFeatureEvidence = { points: [...prefix, maPoint(3, 99.9, 100, 100), maPoint(4, 100.1, 100, 100)] };
        const criteria = { enabled: true, mode: 'golden-cross', compressionDays: 3, maxSpreadPct: '1' } as const;
        expect(evaluateMaCriteria({ verdict: 'pass', reason: 'none', evidence: crossed }, criteria).verdict).toBe('pass');
        const touching: MaFeatureEvidence = { points: [...prefix, maPoint(3, 99.9, 100, 100), maPoint(4, 100, 100, 100)] };
        expect(evaluateMaCriteria({ verdict: 'pass', reason: 'none', evidence: touching }, criteria).verdict).toBe('fail');
    });

    it('最大 10 日且結束於 P 的糾結需要 11 個 feature points', () => {
        const points = Array.from({ length: 11 }, (_, index) => maPoint(index, index === 10 ? 100.1 : 99.9, 100, 100));
        expect(evaluateMaCriteria({ verdict: 'pass', reason: 'none', evidence: { points } },
            { enabled: true, mode: 'golden-cross', compressionDays: 10, maxSpreadPct: '1' }).verdict).toBe('pass');
        expect(() => evaluateMaCriteria({ verdict: 'pass', reason: 'none', evidence: { points } },
            { enabled: true, mode: 'golden-cross', compressionDays: 11, maxSpreadPct: '1' })).toThrow('invalid_ma_criteria');
    });
});

describe('選股 v4 price pivot 與背離契約', () => {
    const bullishBars = () => Array.from({ length: 40 }, (_, index) => {
        const close = index % 3 === 0 ? '100.3' : index % 3 === 1 ? '100.1' : '100.2';
        const patch: Partial<CanonicalOhlcv> = { close, volumeShares: String(1000 + index * 10) };
        if (index === 8) patch.low = '90';
        if (index === 37) patch.low = '88';
        return bar(index, patch);
    });

    it('OBV 使用官方股數並以最新已確認 price pivot pair 判定', () => {
        const matrix = buildDivergenceMatrix(bullishBars());
        const outcome = selectStoredDivergence(matrix, { enabled: true, source: 'obv', direction: 'bullish', requireZeroReset: false });
        expect(outcome.evidence?.sourceMappingVersion).toBe(SCREENER_OHLCV_V4_MAPPING_VERSION);
        expect(outcome.evidence?.volumeUnit).toBe('shares');
        expect(outcome.evidence?.first.sessionDate).toBe(date(8));
        expect(outcome.evidence?.second.sessionDate).toBe(date(37));
        expect(outcome.evidence?.distanceSessions).toBe(29);
        expect(outcome.evidence?.priceDifferencePct).toBeGreaterThanOrEqual(1);
    });

    it('第二低點只有左側資料時回 pivot_unconfirmed', () => {
        const bars = Array.from({ length: 40 }, (_, index) => bar(index, { low: index === 8 ? '90' : index === 39 ? '88' : '94' }));
        const outcome = selectStoredDivergence(buildDivergenceMatrix(bars),
            { enabled: true, source: 'rsi5', direction: 'bullish', requireZeroReset: false });
        expect(outcome).toMatchObject({ verdict: 'unknown', reason: 'pivot_unconfirmed' });
    });

    it('相等 low 不構成嚴格 pivot，非法成交量整體 fail closed', () => {
        const equal = bullishBars();
        equal[7] = { ...equal[7]!, low: '90' };
        const outcome = selectStoredDivergence(buildDivergenceMatrix(equal),
            { enabled: true, source: 'obv', direction: 'bullish', requireZeroReset: false });
        expect(outcome.verdict).not.toBe('pass');
        const invalid = bullishBars();
        invalid[10] = { ...invalid[10]!, volumeShares: '1,000' };
        expect(selectStoredDivergence(buildDivergenceMatrix(invalid),
            { enabled: true, source: 'obv', direction: 'bullish', requireZeroReset: false })).toMatchObject({ verdict: 'unknown', reason: 'invalid_ohlcv' });
    });

    it('pivot pair 接受 5／30 日、3 日新鮮度與恰好 1% 價差邊界，超界不採用', () => {
        const make = (length: number, first: number, second: number) => Array.from({ length }, (_, index) => bar(index, {
            open: '110', high: '115', low: index === first ? '100' : index === second ? '99' : '105', close: '110',
            volumeShares: String(1000 + index),
        }));
        for (const [length, first, second, expectedDistance] of [[40, 32, 37, 5], [40, 7, 37, 30], [40, 31, 36, 5]] as const) {
            const outcome = selectStoredDivergence(buildDivergenceMatrix(make(length, first, second)),
                { enabled: true, source: 'rsi5', direction: 'bullish', requireZeroReset: false });
            expect(outcome.evidence?.distanceSessions).toBe(expectedDistance);
            expect(outcome.evidence?.priceDifferencePct).toBe(1);
            expect(outcome.evidence?.second.sessionDate).toBe(date(second));
        }
        const tooFar = selectStoredDivergence(buildDivergenceMatrix(make(40, 6, 37)),
            { enabled: true, source: 'rsi5', direction: 'bullish', requireZeroReset: false });
        expect(tooFar.evidence).toBeUndefined();
    });

    it('指標在已確認 pivot 尚未暖機時回 indicator_warmup', () => {
        const bars = Array.from({ length: 35 }, (_, index) => bar(index, {
            open: '110', high: '115', low: index === 2 ? '100' : index === 32 ? '98' : '105', close: '110',
        }));
        expect(selectStoredDivergence(buildDivergenceMatrix(bars),
            { enabled: true, source: 'macd-line', direction: 'bullish', requireZeroReset: false }))
            .toMatchObject({ verdict: 'unknown', reason: 'indicator_warmup' });
    });
});

describe('選股 v4 criteria 與三態', () => {
    it('v3 偏好可升級成新條件預設關閉的合法 v4 criteria', () => {
        expect(validateCriteriaV4(DEFAULT_CRITERIA_V4)).toBe(true);
        expect(DEFAULT_CRITERIA_V4.ma.enabled).toBe(false);
        expect(DEFAULT_CRITERIA_V4.divergence.enabled).toBe(false);
    });

    it('非 histogram 的隱藏 zero-reset 不污染 fingerprint', () => {
        const left = { ...DEFAULT_CRITERIA_V4, divergence: { enabled: true, source: 'rsi5', direction: 'bullish', requireZeroReset: false } } as const;
        const right = { ...left, divergence: { ...left.divergence, requireZeroReset: true } };
        expect(effectiveCriteriaV4(right).divergence.requireZeroReset).toBe(false);
        expect(criteriaFingerprintV4(left)).toBe(criteriaFingerprintV4(right));
    });

    it('外層 all／any 保留 pass fail unknown 真值表', () => {
        const all = { ...DEFAULT_CRITERIA_V4, volume: { ...DEFAULT_CRITERIA_V4.volume, enabled: false },
            holder: { ...DEFAULT_CRITERIA_V4.holder, enabled: false }, ma: { ...DEFAULT_CRITERIA_V4.ma, enabled: true },
            divergence: { ...DEFAULT_CRITERIA_V4.divergence, enabled: true } };
        expect(combineCriteriaV4(all, { ma: 'pass', divergence: 'unknown' })).toBe('unknown');
        expect(combineCriteriaV4({ ...all, mode: 'any' }, { ma: 'pass', divergence: 'unknown' })).toBe('pass');
        expect(combineCriteriaV4({ ...all, mode: 'any' }, { ma: 'fail', divergence: 'unknown' })).toBe('unknown');
    });
});


it('官方交易日缺最新或中間日，不把舊 K 棒壓縮成今天的均線或背離', () => {
    const bars = Array.from({ length: 130 }, (_, index) => bar(index));
    const sessions = bars.map(row => row.sessionDate);
    for (const missing of [129, 125]) {
        const incomplete = bars.filter((_, index) => index !== missing);
        expect(buildMaFeatures(incomplete, sessions)).toEqual({ verdict: 'unknown', reason: 'non_adjacent_sessions' });
        expect(buildDivergenceMatrix(incomplete, sessions).obv!.bullish.reason).toBe('non_adjacent_sessions');
    }
    expect(buildMaFeatures(bars, sessions).verdict).toBe('pass');
    // 遙遠缺日不影響只需最近30日的SMA；仍不能拿來算130日背離。
    const oldGap = bars.slice(1);
    expect(buildMaFeatures(oldGap, sessions).verdict).toBe('pass');
    expect(buildDivergenceMatrix(oldGap, sessions).obv!.bullish.reason).toBe('non_adjacent_sessions');
});
