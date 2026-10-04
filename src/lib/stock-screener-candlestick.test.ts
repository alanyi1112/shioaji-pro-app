import { describe, expect, it } from 'vitest';
import { buildCandlestickHistory, evaluateCandlestickReversal, combineCandlestickUniverse, validateCandlestickHistory, type CandlestickOutcome } from './stock-screener-candlestick.ts';
import { DEFAULT_CANDLESTICK_REVERSAL, CANDLESTICK_PATTERNS, candlestickCriteriaFingerprint, validateCandlestickReversal,
    migrateCriteriaV8ToV9, migratePreferenceV8ToV9, validateCriteriaV9, candlestickRequiredHistory, isV9Preference,
    type CandlestickReversalCriteria } from './stock-screener-v9.ts';
import { CANDLESTICK_CATALOG, PIERCING_TAIWAN_STUDY } from './stock-screener-candlestick-catalog.ts';
import { DEFAULT_CRITERIA_V7 } from './stock-screener-v7.ts';
import { migrateCriteriaV7ToV8 } from './stock-screener-v8.ts';
import type { CanonicalOhlcv } from './stock-screener-ohlcv.ts';

// 僅公式 fixture；日期陣列代表已驗證 grid 輸入，不冒充官方／實盤證據。
const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
const bar = (o: string | number, c: string | number, h = Math.max(Number(o), Number(c)) + 1, l = Math.min(Number(o), Number(c)) - 1): CanonicalOhlcv =>
    ({ sessionDate: '', open: String(o), close: String(c), high: String(h), low: String(l), volumeShares: '1000000' });
const prior = (bullish = true) => Array.from({ length: 5 }, (_, i) => { const close = bullish ? 140 - 10 * i : 60 + 10 * i; return bar(close - 1, close); });
const piercing = (close = '90.000001') => [...prior(), bar(100, 80, 101, 79), bar(80, close, 100, 78)];
const morning = (close = '90.000001') => [...prior(), bar(100, 80, 101, 79), bar(75, 75, 77, 73), bar(78, close, Number(close) + 1, 77)];
const soldiers = () => [...prior(), bar(80, 90, 91, 79), bar(85, 95, 96, 84), bar(90, 100, 101, 89)];
const engulf = () => [...prior(false), bar(100, 110, 115, 95), bar(111, 99, 112, 98)];
const crows = () => [...prior(false), bar('99.5', '89', 100, 88), bar(95, 84, 96, 83), bar(90, 79, 91, 78)];
const criteria = (patch: Partial<CandlestickReversalCriteria> = {}): CandlestickReversalCriteria =>
    ({ ...structuredClone(DEFAULT_CANDLESTICK_REVERSAL), enabled: true, bodyReferenceDays: 5, ...patch });
const history = async (rows: CanonicalOhlcv[], incomparableSessions: string[] = []) => {
    const sessions = days.slice(0, rows.length);
    return buildCandlestickHistory(rows.map((b, i) => ({ ...b, sessionDate: sessions[i]! })), sessions,
        { mappingVersion: 'fixture-full-ohlcv-v1', calendarHash: 'a'.repeat(64), sourceHashes: ['b'.repeat(64)], completedThrough: sessions.at(-1)!, incomparableSessions });
};
const evaluate = async (rows: CanonicalOhlcv[], pattern: typeof CANDLESTICK_PATTERNS[number], patch: Partial<CandlestickReversalCriteria> = {}) =>
    evaluateCandlestickReversal(await history(rows), criteria({ patterns: [pattern], ...patch }));

describe('v9 參數／遷移與統計隔離', () => {
    it('保留 v8 設定／排序，新分支關閉、五型態全選、不共用物件', () => {
        const old = migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7), next = migrateCriteriaV8ToV9(old);
        expect(next.candlestickReversal.enabled).toBe(false); expect(next.candlestickReversal.patterns).toEqual([...CANDLESTICK_PATTERNS]);
        next.volume.threshold = '9'; expect(old.volume.threshold).toBe('3');
        const p = { version: 8, query: { criteria: old, sort: 'volumeRatio', direction: 'desc', resultState: 'unknown' } };
        expect(migratePreferenceV8ToV9(p)?.query.sort).toBe('volumeRatio');
        expect(migratePreferenceV8ToV9({ ...p, version: 10 })).toBeNull();
        expect(migratePreferenceV8ToV9({ ...p, extra: true })).toBeNull();
        expect(p.version).toBe(8);
    });
    it('只開反轉合法，非法舊條件仍拒絕', () => {
        const c = migrateCriteriaV8ToV9(migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7));
        for (const v of Object.values(c)) if (v && typeof v === 'object' && 'enabled' in v) v.enabled = false;
        c.candlestickReversal.enabled = true; expect(validateCriteriaV9(c)).toBe(true);
        c.kdCross.lowThreshold = '90'; expect(validateCriteriaV9(c)).toBe(false);
    });
    it('v9 偏好驗證 fail closed，不修改原值；只選兩棒時不要求停用的長實體／位置窗', () => {
        const p = migratePreferenceV8ToV9({ version: 8, query: { criteria: migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7), sort: 'code', direction: 'asc', resultState: 'pass' } })!;
        expect(isV9Preference(p)).toBe(true);
        const bad = structuredClone(p); bad.query.criteria.candlestickReversal.piercingRecoveryPct = '100';
        expect(isV9Preference(bad)).toBe(false); expect(p.query.criteria.candlestickReversal.piercingRecoveryPct).toBe('50');
        expect(candlestickRequiredHistory(criteria({ patterns: ['piercing'], bodyReferenceDays: 60 }))).toBe(7);
        expect(candlestickRequiredHistory(criteria({ patterns: ['morning-star'], bodyReferenceDays: 60, mode: 'next-session-breakout' }))).toBe(64);
        expect(candlestickRequiredHistory({ ...criteria(), enabled: false })).toBe(0);
    });
    it.each([{ patterns: [] }, { patterns: ['piercing', 'piercing'] }, { patterns: ['bull-engulf'] },
        { morningRecoveryPct: '49.99' }, { morningRecoveryPct: '100.01' }, { piercingRecoveryPct: '100' },
        { piercingRecoveryPct: '50.001' }, { piercingOpenMode: 'any' }, { trendDays: 2 }, { trendDays: 61 },
        { longBodyMedianRatio: 'Infinity' }, { enabled: 'true' }, { piercingRequireLongFirstBody: 1 },
        { position: null }, { volume: null }, { extra: true }])('拒絕非法參數 %j', patch => {
        expect(validateCandlestickReversal(criteria(patch as never))).toBe(false);
    });
    it('fingerprint 忽略停用／不適用參數與子型態順序', () => {
        const c = criteria({ patterns: ['piercing'] }), fingerprint = candlestickCriteriaFingerprint(c);
        expect(candlestickCriteriaFingerprint({ ...c, bodyReferenceDays: 60, morningRecoveryPct: '99' })).toBe(fingerprint);
        expect(candlestickCriteriaFingerprint({ ...c, piercingRequireLongFirstBody: true })).not.toBe(fingerprint);
        expect(candlestickCriteriaFingerprint(criteria())).toBe(candlestickCriteriaFingerprint(criteria({ patterns: [...CANDLESTICK_PATTERNS].reverse() })));
        expect(candlestickCriteriaFingerprint({ ...c, enabled: false })).toBe(candlestickCriteriaFingerprint({ ...c, enabled: false, piercingRecoveryPct: '90' }));
    });
    it('統計數值／metric 分離，不將十字子型或小樣本當本功能勝率', () => {
        expect(Object.values(CANDLESTICK_CATALOG).map(v => v.reversalPct)).toEqual([82, 79, 78, 76, 78, 64]);
        expect(CANDLESTICK_CATALOG['three-black-crows'].reversalRank).toBe(7);
        expect(CANDLESTICK_CATALOG['three-black-crows'].overallPerformanceRank).toBe(3);
        expect(PIERCING_TAIWAN_STUDY).toMatchObject({ meanTradeProfitAfterCostPct: 13.25, profitableTradesPct: 90.91, trades: 11 });
    });
});

describe('刺透精確收盤與開盤邊界', () => {
    it.each([['89.999999', 'fail'], ['90', 'fail'], ['90.000001', 'pass'], ['100', 'fail'], ['100.000001', 'fail']])('close=%s → %s', async (close, verdict) => {
        const rows = piercing(close); rows.at(-1)!.high = '101';
        expect((await evaluate(rows, 'piercing')).verdict).toBe(verdict);
    });
    it('high 過中點不足；陰陽反例不通過', async () => {
        expect((await evaluate(piercing('89'), 'piercing')).verdict).toBe('fail');
        const r = piercing(); r[5] = bar(80, 100); expect((await evaluate(r, 'piercing')).verdict).toBe('fail');
        r[5] = bar(100, 80); r[6] = bar(95, 91); expect((await evaluate(r, 'piercing')).verdict).toBe('fail');
    });
    it('預設容許 openB=closeA；嚴格跳空 openB=lowA 不算', async () => {
        expect((await evaluate(piercing(), 'piercing')).verdict).toBe('pass');
        const rows = piercing(); rows[6]!.open = '79';
        expect((await evaluate(rows, 'piercing', { piercingOpenMode: 'below-prior-low' })).verdict).toBe('fail');
        rows[6]!.open = '78.999999'; expect((await evaluate(rows, 'piercing', { piercingOpenMode: 'below-prior-low' })).verdict).toBe('pass');
    });
    it('回補可調，長首棒預設不要求中位數暖機', async () => {
        expect((await evaluate(piercing(), 'piercing', { bodyReferenceDays: 60 })).verdict).toBe('pass');
        expect((await evaluate(piercing(), 'piercing', { bodyReferenceDays: 60, piercingRequireLongFirstBody: true })).verdict).toBe('unknown');
        expect((await evaluate(piercing('99'), 'piercing', { piercingRecoveryPct: '95' })).verdict).toBe('fail');
        expect((await evaluate(piercing('99.000001'), 'piercing', { piercingRecoveryPct: '95' })).verdict).toBe('pass');
    });
});
describe('晨星、紅三兵、烏鴉與吞噬', () => {
    it.each([['89.999999', 'fail'], ['90', 'fail'], ['90.000001', 'pass']])('晨星中點 %s → %s', async (close, verdict) => {
        const r = await evaluate(morning(close), 'morning-star'); expect(r.verdict).toBe(verdict);
        expect(r.matches[0]!.subtype).toBe('morning-doji-star');
    });
    it('晨星十字不能改標一般晨星；跳空變體有明確差別', async () => {
        expect((await evaluate(morning(), 'morning-star', { includeMorningDoji: false })).verdict).toBe('fail');
        const rows = morning(); rows[6] = bar(80, 80, 82, 78); rows[7] = bar(80, 95, 96, 79);
        expect((await evaluate(rows, 'morning-star')).verdict).toBe('fail');
        expect((await evaluate(rows, 'morning-star', { morningGapMode: 'no-gap-required' })).verdict).toBe('pass');
        expect((await evaluate(morning('100'), 'morning-star', { morningRecoveryPct: '100' })).verdict).toBe('fail');
        expect((await evaluate(morning('100.000001'), 'morning-star', { morningRecoveryPct: '100' })).verdict).toBe('pass');
    });
    it('紅陽按 open/close，不以昨收；實體內開盤、長實體／短上影', async () => {
        expect((await evaluate(soldiers(), 'three-white-soldiers')).verdict).toBe('pass'); // 首陽 close90 < 昨收100
        const r = soldiers(); r[6]!.open = '90'; expect((await evaluate(r, 'three-white-soldiers')).verdict).toBe('fail');
        r[6]!.open = '85'; r[7]!.high = '120'; expect((await evaluate(r, 'three-white-soldiers')).verdict).toBe('fail');
    });
    it('看跌吞噬只吞實體，不要求吞影線／長實體暖機；端點相等失敗', async () => {
        expect((await evaluate(engulf(), 'bearish-engulfing', { bodyReferenceDays: 60 })).verdict).toBe('pass');
        const r = engulf(); r[6]!.open = '110'; expect((await evaluate(r, 'bearish-engulfing')).verdict).toBe('fail');
        r[6]!.open = '111'; r[6]!.close = '100'; expect((await evaluate(r, 'bearish-engulfing')).verdict).toBe('fail');
    });
    it('烏鴉首根額外條件可關閉；低點／收低／下影／實體開盤均必要', async () => {
        expect((await evaluate(crows(), 'three-black-crows')).verdict).toBe('pass');
        const r = crows(); r[5]!.open = '99'; expect((await evaluate(r, 'three-black-crows')).verdict).toBe('fail');
        expect((await evaluate(r, 'three-black-crows', { firstCrowOpenWithinPriorBody: false })).verdict).toBe('pass');
        r[5]!.open = '99.5'; r[6]!.low = '88'; // 非法 OHLC 必須 unknown，不能偷偷畫棒
        expect((await evaluate(r, 'three-black-crows')).verdict).toBe('unknown');
    });
    it('烏鴉逐棒低點須嚴格降低，開盤碰前棒實體端點與過長下影皆 fail', async () => {
        const r = crows(); r[5]!.low = '83'; r[6]!.low = '83';
        const unchangedLow = await evaluate(r, 'three-black-crows');
        expect(unchangedLow.matches[0]!.checks.find(c => c.key === 'progression')!.verdict).toBe('fail');
        const boundary = crows(); boundary[6]!.open = '99.5'; boundary[6]!.high = '100';
        expect((await evaluate(boundary, 'three-black-crows')).matches[0]!.checks.find(c => c.key === 'open-inside-body')!.verdict).toBe('fail');
        const shadow = crows(); shadow[7]!.low = '60';
        expect((await evaluate(shadow, 'three-black-crows')).matches[0]!.checks.find(c => c.key === 'near-extreme')!.verdict).toBe('fail');
    });
    it('趨勢排除型態、嚴格方向／變化，不允許平盤', async () => {
        const r = piercing(); for (let i = 0; i < 5; i++) r[i] = bar(99, 100);
        expect((await evaluate(r, 'piercing')).verdict).toBe('fail');
        expect((await evaluate(piercing(), 'piercing', { minTrendChangePct: '20' })).verdict).toBe('pass');
        const c = piercing(); c.splice(0, 5, ...prior(false)); expect((await evaluate(c, 'piercing')).verdict).toBe('fail');
    });
    it('OLS 與首末變化方向矛盾 fail；非十字小實體明列一般晨星', async () => {
        const r = piercing(); [100, 200, 90, 80, 110].forEach((close, i) => { r[i] = bar(close - 1, close); });
        const outcome = await evaluate(r, 'piercing'); const check = outcome.matches[0]!.checks.find(c => c.key === 'prior-trend')!;
        expect(BigInt(check.operands!.olsNumerator!)).toBeLessThan(0n); expect(check.verdict).toBe('fail');
        const m = morning(); m[6]!.close = '75.1';
        expect((await evaluate(m, 'morning-star')).matches[0]!.subtype).toBe('morning-star');
    });
});
describe('凍結能力、缺口、固定日期及三態組合', () => {
    it.each(['pass', 'fail', 'unknown'] as const)('外層完整三態表第一項 %s', left => {
        for (const right of ['pass', 'fail', 'unknown'] as const) {
            const rows = [{ symbol: '2408.TW', outcome: { verdict: left } as CandlestickOutcome, legacyVerdicts: [right] }];
            const all = left === 'fail' || right === 'fail' ? 'fail' : left === 'pass' && right === 'pass' ? 'pass' : 'unknown';
            const any = left === 'pass' || right === 'pass' ? 'pass' : left === 'fail' && right === 'fail' ? 'fail' : 'unknown';
            expect(combineCandlestickUniverse(rows, 'all').rows[0]!.verdict).toBe(all);
            expect(combineCandlestickUniverse(rows, 'any').rows[0]!.verdict).toBe(any);
        }
    });
    it('完整 OHLC 深凍結；clone 改動／close-only／未完成當日拒絕', async () => {
        const h = await history(piercing()); expect(Object.isFrozen(h.points[0]!.bar)).toBe(true);
        const clone = structuredClone(h); clone.points[0]!.bar!.close = '140.5';
        await expect(validateCandlestickHistory(clone)).rejects.toThrow('invalid_candlestick_hash');
        await expect(validateCandlestickHistory({ ...h, version: 8 } as never)).rejects.toThrow('invalid_candlestick_capability');
        await expect(buildCandlestickHistory([], days, { mappingVersion: 'test', calendarHash: 'a'.repeat(64), sourceHashes: ['b'.repeat(64)], completedThrough: days[7]! })).rejects.toThrow('invalid_candlestick_history');
    });
    it('缺官方 session 不壓縮、重複拒絕；零振幅 shape fail、零中位數 unknown', async () => {
        const h = await history(piercing()), rows = h.points.flatMap(p => p.bar ? [p.bar] : []).filter((_, i) => i !== 3);
        const gap = await buildCandlestickHistory(rows, h.sessions, h);
        expect((await evaluateCandlestickReversal(gap, criteria({ patterns: ['piercing'] }))).verdict).toBe('unknown');
        await expect(buildCandlestickHistory([...rows, rows[0]!], h.sessions, h)).rejects.toThrow();
        const r = piercing(); r[6] = bar(80, 80, 80, 80); expect((await evaluate(r, 'piercing')).verdict).toBe('fail');
        const s = soldiers(); for (let i = 0; i < 5; i++) s[i]!.open = s[i]!.close;
        expect((await evaluate(s, 'three-white-soldiers')).verdict).toBe('unknown');
    });
    it('官方 grid 跳週末／臨時休市；D 是唯一收盤突破確認，不用 high 或碰線', async () => {
        const r = piercing(); r.push(bar(90, 101, 102, 89));
        expect((await evaluate(r, 'piercing', { mode: 'next-session-breakout' })).verdict).toBe('fail');
        r[7]!.close = '101.000001'; expect((await evaluate(r, 'piercing', { mode: 'next-session-breakout' })).verdict).toBe('pass');
        const result = await evaluate(r, 'piercing', { mode: 'next-session-breakout' });
        expect(result.matches[0]!.formationDates).toEqual(['2026-09-29', '2026-09-30']);
        expect(result.matches[0]!.confirmationDate).toBe('2026-10-01');
    });
    it('看空次日確認也以 close 嚴格跌破最低 low，不以 low／等於當 pass', async () => {
        const r = engulf(); r.push(bar(105, 95, 106, 94));
        expect((await evaluate(r, 'bearish-engulfing', { mode: 'next-session-breakout' })).verdict).toBe('fail');
        r[7]!.close = '94.999999'; expect((await evaluate(r, 'bearish-engulfing', { mode: 'next-session-breakout' })).verdict).toBe('pass');
    });
    it('量能基準不含 D，關閉忽略；零均量 unknown，門檻相等通過', async () => {
        const c = criteria().volume, r = piercing(); r[6]!.volumeShares = '1200000';
        const result = await evaluate(r, 'piercing', { volume: { ...c, enabled: true, baselineDays: 5 } });
        expect(result.verdict).toBe('pass'); expect(result.matches[0]!.checks.find(c => c.key === 'volume')!.dates).not.toContain(days[6]);
        r[6]!.volumeShares = '1199999'; expect((await evaluate(r, 'piercing', { volume: { ...c, enabled: true, baselineDays: 5 } })).verdict).toBe('fail');
        for (let i = 0; i < 6; i++) r[i]!.volumeShares = '0';
        expect((await evaluate(r, 'piercing', { volume: { ...c, enabled: true, baselineDays: 5 } })).verdict).toBe('unknown');
        expect((await evaluate(r, 'piercing')).verdict).toBe('pass');
    });
    it('量能與最低均量都是型態內 AND，均量門檻以股數精確相乘', async () => {
        const c = { ...criteria().volume, enabled: true, baselineDays: 5, ratio: '1', minimumAverageVolumeEnabled: true, minimumAverageVolumeLots: '1000' };
        expect((await evaluate(piercing(), 'piercing', { volume: c })).verdict).toBe('pass');
        expect((await evaluate(piercing(), 'piercing', { volume: { ...c, minimumAverageVolumeLots: '1001' } })).verdict).toBe('fail');
        const r = piercing('90'); r[6]!.volumeShares = '20000000';
        expect((await evaluate(r, 'piercing', { volume: c })).verdict).toBe('fail');
    });
    it('位置排除型態；已知除權息不可比較窗保留 unknown', async () => {
        const result = await evaluate(piercing(), 'piercing', { position: { enabled: true, baselineDays: 5, tolerancePct: '2' } });
        expect(result.verdict).toBe('fail'); expect(result.matches[0]!.checks.find(c => c.key === 'position')!.dates).toEqual(days.slice(0, 5));
        const h = await history(piercing(), [days[5]!]);
        expect((await evaluateCandlestickReversal(h, criteria({ patterns: ['piercing'] }))).verdict).toBe('unknown');
    });
    it('子型態 OR、外層 all/any、每商品一列與守恆，未知理由不丟失', async () => {
        const outcome = await evaluateCandlestickReversal(await history(piercing()), criteria({ patterns: ['piercing', 'morning-star'], bodyReferenceDays: 60 }));
        expect(outcome.verdict).toBe('pass'); expect(outcome.hits.map(m => m.pattern)).toEqual(['piercing']);
        expect(outcome.matches.find(m => m.pattern === 'morning-star')!.reasons).toContain('insufficient_history');
        const rows = [{ symbol: '2408.TW', outcome, legacyVerdicts: ['fail' as const] }];
        expect(combineCandlestickUniverse(rows, 'all').counts).toEqual({ total: 1, pass: 0, fail: 1, unknown: 0 });
        expect(combineCandlestickUniverse(rows, 'any').counts).toEqual({ total: 1, pass: 1, fail: 0, unknown: 0 });
        expect(() => combineCandlestickUniverse([...rows, ...rows], 'all')).toThrow('invalid_universe');
    });
    it('關閉量能不要求 volume；啟用缺股數回 unknown，無浮點 volume overflow', async () => {
        const rows = piercing().map((b, i) => ({ ...b, sessionDate: days[i]!, volumeShares: null }));
        const h = await buildCandlestickHistory(rows, days.slice(0, 7), { mappingVersion: 'test', calendarHash: 'a'.repeat(64), sourceHashes: ['b'.repeat(64)], completedThrough: days[6]! });
        expect((await evaluateCandlestickReversal(h, criteria({ patterns: ['piercing'] }))).verdict).toBe('pass');
        expect((await evaluateCandlestickReversal(h, criteria({ patterns: ['piercing'], volume: { ...criteria().volume, enabled: true, baselineDays: 5 } }))).verdict).toBe('unknown');
        const huge = piercing().map(b => ({ ...b, volumeShares: '10000000000000000000' }));
        huge[6]!.volumeShares = '12000000000000000000';
        expect((await evaluate(huge, 'piercing', { volume: { ...criteria().volume, enabled: true, baselineDays: 5 } })).verdict).toBe('pass');
    });
});
