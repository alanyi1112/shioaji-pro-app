import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA_V7 } from './stock-screener-v7.ts';
import {
    BOLLINGER_STAGES, DEFAULT_BOLLINGER_SQUEEZE, bollingerCriteriaFingerprint, bollingerRequiredHistory,
    buildBollingerFrozenFeatures, classifyBollingerStages, countBollingerStages, evaluateBollingerSetup,
    evaluateBollingerStages, migrateCriteriaV7ToV8, migratePreferenceV7ToV8, type7Quantile,
    validateBollingerSqueeze, validateCriteriaV8, type BollingerSqueezeCriteria, type TurnoverOhlcv,
} from './stock-screener-v8.ts';

// 隔離公式 fixture，不是官方交易日或實盤發布證據。
const sessions = (length = 160) => Array.from({ length }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10));
const bars = (length = 160): TurnoverOhlcv[] => sessions(length).map((sessionDate, i) => {
    const close = (100 + i * .04 + Math.sin(i * .7) * (i < 120 ? 3 : 3 * Math.exp(-(i - 120) / 12))).toFixed(6);
    return { sessionDate, open: close, close, high: close, low: close,
        volumeShares: i > 145 ? '600000' : '1000000', turnoverNtd: '100000000' };
});
const criteria = (patch: Partial<BollingerSqueezeCriteria> = {}): BollingerSqueezeCriteria => ({
    ...structuredClone(DEFAULT_BOLLINGER_SQUEEZE), enabled: true, ...patch,
});
const feature = (rows = bars()) => buildBollingerFrozenFeatures(rows, sessions(rows.length));

describe('布林三階段 v8 設定與版本隔離', () => {
    it('145 日暖機與近期 setup，預設準備窗口另保留 160 日', () => {
        expect(bollingerRequiredHistory(criteria())).toBe(145);
        expect(bollingerRequiredHistory(criteria({ lookbackDays: 250, setupDays: 20 }))).toBe(290);
    });
    it('保留 v7 草稿、排序及數值；新分支關閉且不共享 mutable 物件', () => {
        const old = structuredClone(DEFAULT_CRITERIA_V7);
        const next = migrateCriteriaV7ToV8(old);
        expect(next.bollSqueezeStages.enabled).toBe(false);
        expect(next.bollSqueezeStages.stages).toEqual([...BOLLINGER_STAGES]);
        next.volume.threshold = '9';
        expect(old.volume.threshold).toBe('3');
        const saved = { version: 7, query: { criteria: old, sort: 'volumeRatio', direction: 'desc', resultState: 'unknown' } };
        expect(migratePreferenceV7ToV8(saved)?.query.sort).toBe('volumeRatio');
        expect(migratePreferenceV7ToV8({ ...saved, unknown: true })).toBe(null);
    });
    it('只開新分支合法，非法舊欄位仍拒絕', () => {
        const c = migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7);
        for (const value of Object.values(c)) if (value && typeof value === 'object' && 'enabled' in value) value.enabled = false;
        c.bollSqueezeStages.enabled = true;
        expect(validateCriteriaV8(c)).toBe(true);
        c.kdCross.lowThreshold = '90';
        expect(validateCriteriaV8(c)).toBe(false);
        expect(validateCriteriaV8({ ...c, volume: null } as never)).toBe(false);
    });
    it.each([
        { lookbackDays: 59 }, { lookbackDays: 251 }, { percentile: NaN }, { percentile: 51 },
        { setupDays: 21 }, { stages: [] }, { stages: ['breakout', 'breakout'] },
        { bMinimum: .9, preparingThreshold: .8 }, { bbwShortDays: 20 }, { volumeShortDays: 20 },
        { contractionRatio: 'Infinity' }, { breakoutVolumeRatio: '1e3' },
        { minimumAverageTurnoverNtd: '-1' }, { slowMaDays: 251 }, { fastMaDays: 20.5 },
    ])('非法參數拒絕且不建立查詢 fingerprint：%j', patch => {
        const c = criteria(patch as Partial<BollingerSqueezeCriteria>);
        expect(validateBollingerSqueeze(c)).toBe(false);
        expect(() => bollingerCriteriaFingerprint(c)).toThrow('invalid_bollinger_criteria');
    });
    it('設定與階段納入 fingerprint，階段次序不影響結果', () => {
        expect(bollingerCriteriaFingerprint(criteria())).toBe(bollingerCriteriaFingerprint(criteria({ stages: ['breakout', 'preparing', 'compressing'] })));
        expect(bollingerCriteriaFingerprint(criteria())).not.toBe(bollingerCriteriaFingerprint(criteria({ breakoutVolumeRatio: '1.5' })));
        expect(bollingerCriteriaFingerprint(criteria())).not.toBe(bollingerCriteriaFingerprint(criteria({ stages: ['breakout'] })));
    });
});

describe('固定 BOLL 與相對帶寬', () => {
    it('母體標準差、不做顯示 rounding、Type-7 保留 ties', async () => {
        const rows = bars(20).map((b, i) => ({ ...b, open: String(i + 1), close: String(i + 1), high: String(i + 1), low: String(i + 1) }));
        const f = await feature(rows), b = f.points[19]!.boll!;
        expect(b.middle).toBe(10.5);
        expect(b.upper).toBeCloseTo(10.5 + 2 * Math.sqrt(33.25), 12);
        expect(b.upper).not.toBe(Number(b.upper.toFixed(6)));
        expect(type7Quantile([1, 1, 1, 5], 50)).toBe(1);
        expect(type7Quantile([1, 2, 3, 4], 20)).toBeCloseTo(1.6, 12);
        expect(type7Quantile([NaN], 20)).toBe(null);
    });
    it('當日帶寬不參與自身 quantile；日期窗排除 D', async () => {
        const f = await feature(), t = 159, s = evaluateBollingerSetup(f, criteria(), t);
        const prior = f.points.slice(39, 159).map(p => p.boll!.bbw!);
        expect(s.quantile).toBe(type7Quantile(prior, 20));
        expect(s.compression.relativeBandwidth!.dates).toEqual(f.sessions.slice(39, 159));
        expect(s.compression.relativeBandwidth!.dates).not.toContain(f.through);
    });
    it('缺日不剔除、零寬度不算壓縮，不補造成交金額', async () => {
        const rows = bars(), days = sessions();
        const gap = await buildBollingerFrozenFeatures(rows.filter((_, i) => i !== 80), days);
        expect(gap.points[80]!.close).toBe(null);
        expect(evaluateBollingerSetup(gap, criteria(), 159).compression.relativeBandwidth!.verdict).toBe('unknown');
        const flat = await feature(rows.map(b => ({ ...b, close: '100', open: '100', high: '100', low: '100' })));
        expect(flat.points[159]!.boll!.bbw).toBe(null);
        expect(evaluateBollingerSetup(flat, criteria(), 159).compression.bandPosition!.reason).toBe('zero_bollinger_width');
        const missing = await feature(rows.map(b => ({ ...b, turnoverNtd: null })));
        expect(evaluateBollingerSetup(missing, criteria(), 159).gate.liquidity!.verdict).toBe('unknown');
    });
    it('歷史 setup 加入未來資料不變', async () => {
        const f = await feature(), short = await feature(bars(156));
        expect(evaluateBollingerSetup(f, criteria(), 155)).toEqual(evaluateBollingerSetup(short, criteria(), 155));
    });
    it('拒絕重複、亂序官方 session 與資料窗外日期', async () => {
        await expect(buildBollingerFrozenFeatures([...bars(), bars()[0]!], sessions())).rejects.toThrow('invalid_bollinger_history');
        await expect(buildBollingerFrozenFeatures(bars(), sessions().reverse())).rejects.toThrow('invalid_bollinger_history');
        await expect(buildBollingerFrozenFeatures(bars(), sessions(159))).rejects.toThrow('invalid_bollinger_history');
    });
});

describe('setup 與首次正式突破分開', () => {
    it('壓縮中的上軌附近只列準備，不重複列壓縮', async () => {
        const r = await evaluateBollingerStages(await feature(bars(155)), criteria());
        expect(r.stage).toBe('preparing');
        expect(r.compressing).toBe('pass');
        expect(r.preparing).toBe('pass');
        expect((await evaluateBollingerStages(await feature(bars(155)), criteria({ preparingThreshold: .99 }))).stage).toBe('compressing');
    });
    it('突破日帶寬放大、量放大不要求當日 setup', async () => {
        const rows = bars(); rows[159] = { ...rows[159]!, open: '110', close: '110', high: '110', low: '110', volumeShares: '2000000' };
        const r = await evaluateBollingerStages(await feature(rows), criteria());
        expect(r.stage).toBe('breakout');
        expect(r.compressing).toBe('fail');
        expect(r.latestSetupDate).not.toBe(r.date);
        expect(r.latestSetupHash).toMatch(/^[a-f0-9]{64}$/);
        expect(r.breakoutChecks.expansion!.dates).not.toContain(r.date);
    });
    it('連續上軌外與 setup 有效期外，不重複或使用無期限旗標', async () => {
        const rows = bars();
        rows[158] = { ...rows[158]!, open: '110', close: '110', high: '110', low: '110', volumeShares: '2000000' };
        rows[159] = { ...rows[159]!, open: '115', close: '115', high: '115', low: '115', volumeShares: '2000000' };
        const r = await evaluateBollingerStages(await feature(rows), criteria());
        expect(r.breakoutChecks.firstUpperCross!.verdict).toBe('fail');
        expect(r.breakout).toBe('fail');
        const oneDay = await evaluateBollingerStages(await feature(bars()), criteria({ setupDays: 1 }));
        expect(oneDay.breakoutChecks.recentSetup!.verdict).toBe('fail');
    });
    it('碰軌與恰好等於量門檻不通過；數量超過安全整數仍精確比較', async () => {
        const rows = bars(); rows[159] = { ...rows[159]!, open: '110', close: '110', high: '110', low: '110', volumeShares: '962000' };
        const r = await evaluateBollingerStages(await feature(rows), criteria());
        expect(r.breakoutChecks.expansion!.verdict).toBe('fail'); // 前20日14,800,000股 /20 *1.3
        const f = await feature(rows); f.points[159]!.close = f.points[159]!.boll!.upper;
        expect((await evaluateBollingerStages(f, criteria())).breakoutChecks.firstUpperCross!.verdict).toBe('fail');
        const huge = bars().map(b => ({ ...b, volumeShares: '10000000000000000000' }));
        huge[159] = { ...huge[159]!, volumeShares: '13000000000000000000' };
        expect((await evaluateBollingerStages(await feature(huge), criteria())).breakoutChecks.expansion!.verdict).toBe('fail');
        huge[159]!.volumeShares = '13000000000000000001';
        expect((await evaluateBollingerStages(await feature(huge), criteria())).breakoutChecks.expansion!.verdict).toBe('pass');
    });
    it('非普通股／弱勢共同濾網否決；量縮不繞過策略內 AND', async () => {
        const f = await feature(bars(154));
        expect((await evaluateBollingerStages(f, criteria(), false)).stage).toBe('notMatched');
        const weak = await feature(bars(154).map((b, i) => ({ ...b, close: String(200 - i), open: String(200 - i), high: String(200 - i), low: String(200 - i) })));
        expect((await evaluateBollingerStages(weak, criteria())).stage).toBe('notMatched');
    });
    it('未知較高階不得降級，階段過濾保留原分類與計數', async () => {
        expect(classifyBollingerStages('unknown', 'pass', 'pass')).toBe('unknown');
        expect(classifyBollingerStages('fail', 'pass', 'pass')).toBe('preparing');
        const r = await evaluateBollingerStages(await feature(bars(155)), criteria({ stages: ['breakout'] }));
        expect(r.stage).toBe('preparing'); expect(r.branchVerdict).toBe('fail');
        const counts = countBollingerStages([{ market: 'TWSE', stage: r.stage }, { market: 'TPEx', stage: 'unknown' }, { market: 'TWSE', stage: 'breakout' }]);
        expect(counts.total).toEqual({ total: 3, breakout: 1, preparing: 1, compressing: 0, notMatched: 0, unknown: 1 });
        expect(counts.markets.TPEx.unknown).toBe(1);
    });
    it('舊公式／mapping 不得當 v8，查詢不改凍結底稿', async () => {
        const f = await feature(), before = JSON.stringify(f);
        await evaluateBollingerStages(f, criteria());
        expect(JSON.stringify(f)).toBe(before);
        await expect(evaluateBollingerStages({ ...f, sourceMappingVersion: 'old' } as never, criteria())).rejects.toThrow('invalid_bollinger_snapshot');
    });
});
