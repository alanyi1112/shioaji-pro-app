import { describe, expect, it } from 'vitest';
import { bollinger } from './indicators';
import {
    combineCriteriaV3, compareTechnicalRows, criteriaFingerprintV3, DEFAULT_CRITERIA_V3,
    evaluateBollReversal, evaluateChanFractal, evaluateFractalCriteria, evaluateRawFractal, isV3Cursor, isV3Preference,
    normalizeChanContainment, SCREENER_V3_FORMULA_VERSION, technicalEvidenceHash,
    validateCanonicalOhlc, validateCanonicalOhlcSeries, validateCriteriaV3,
    validateScreenerV3Metadata, validateScreenerV3Progress,
    type CanonicalOhlc, type CriteriaV3, type ScreenerV3Metadata, type ScreenerV3Progress,
    type TechnicalSortableRow,
} from './stock-screener-technical-patterns';

const dates = (count: number, start = Date.UTC(2026, 0, 1)) => Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10));
const bar = (sessionDate: string, high: string, low: string, open = low, close = high): CanonicalOhlc =>
    ({ sessionDate, open, high, low, close });
const flatSeries = (sessions: string[], close = '10'): CanonicalOhlc[] => sessions.map((sessionDate) =>
    ({ sessionDate, open: close, high: '11', low: '9', close }));

describe('選股 v3 canonical OHLC', () => {
    it('只接受正值、有限六位小數與完整 high/low 邊界', () => {
        expect(validateCanonicalOhlc({ sessionDate: '2026-08-31', open: '10.25', high: '11', low: '9.5', close: '10.5' })).toBe(true);
        for (const patch of [
            { open: '0' }, { high: 'NaN' }, { close: '1e2' }, { low: '9.1234567' },
            { high: '10', open: '11' }, { low: '10.6', close: '10.5' }, { sessionDate: '2026-02-30' },
            { high: '9999999999' },
        ]) expect(validateCanonicalOhlc({ sessionDate: '2026-08-31', open: '10', high: '11', low: '9', close: '10.5', ...patch })).toBe(false);
    });

    it('拒絕日期重複、倒序與任一非法 K 棒', () => {
        const source = flatSeries(['2026-08-28', '2026-08-31']);
        expect(validateCanonicalOhlcSeries(source)).toBe(true);
        expect(validateCanonicalOhlcSeries([source[0]!, source[0]!])).toBe(false);
        expect(validateCanonicalOhlcSeries([...source].reverse())).toBe(false);
        expect(validateCanonicalOhlcSeries([{ ...source[0]!, low: '0' }])).toBe(false);
    });
});

describe('原始三 K 與纏論包含關係', () => {
    it('原始三 K 使用嚴格高低點、中心日與右棒確認日', () => {
        const sessions = dates(3);
        const bottom = [bar(sessions[0]!, '12', '10'), bar(sessions[1]!, '11', '8'), bar(sessions[2]!, '13', '9')];
        expect(evaluateRawFractal(bottom, sessions, 'bottom')).toMatchObject({ verdict: 'pass', evidence: { direction: 'bottom', centerDate: sessions[1], confirmationDate: sessions[2] } });
        expect(evaluateRawFractal(bottom, sessions, 'top').verdict).toBe('fail');
        expect(evaluateRawFractal(bottom, sessions, 'any').verdict).toBe('pass');
        const top = [bar(sessions[0]!, '12', '8'), bar(sessions[1]!, '14', '10'), bar(sessions[2]!, '13', '9')];
        expect(evaluateRawFractal(top, sessions, 'top').verdict).toBe('pass');
        expect(evaluateRawFractal([{ ...bottom[0]!, high: '11', close: '11' }, bottom[1]!, bottom[2]!], sessions, 'bottom').verdict).toBe('fail');
    });

    it('缺左右棒、非官方相鄰 session 與未完成右棒皆 fail closed', () => {
        const sessions = dates(3);
        expect(evaluateRawFractal([], sessions.slice(0, 2), 'bottom').reason).toBe('insufficient_history');
        expect(evaluateRawFractal(flatSeries(sessions).slice(1), sessions, 'bottom').reason).toBe('missing_ohlcv');
        expect(evaluateRawFractal(flatSeries(sessions).slice(0, 2), sessions, 'bottom').reason).toBe('missing_ohlcv');
        expect(evaluateRawFractal(flatSeries(sessions), [sessions[0]!, sessions[2]!, sessions[1]!], 'bottom').reason).toBe('non_adjacent_sessions');
    });

    it('纏論向上／向下包含公式保留所有原始日期映射', () => {
        const sessions = dates(4);
        const upward = [
            bar(sessions[0]!, '10', '5'), bar(sessions[1]!, '12', '7'),
            bar(sessions[2]!, '13', '6'), bar(sessions[3]!, '11', '4'),
        ];
        const normalized = normalizeChanContainment(upward);
        expect(normalized.reason).toBe('none');
        expect(normalized.bars).toEqual([
            { high: '10', low: '5', rawFrom: sessions[0], rawTo: sessions[0], rawDates: [sessions[0]] },
            { high: '13', low: '7', rawFrom: sessions[1], rawTo: sessions[2], rawDates: [sessions[1], sessions[2]] },
            { high: '11', low: '4', rawFrom: sessions[3], rawTo: sessions[3], rawDates: [sessions[3]] },
        ]);
        expect(evaluateChanFractal(upward, sessions, 'top')).toMatchObject({ verdict: 'pass', evidence: { algorithm: 'chan-containment', centerDate: sessions[2], confirmationDate: sessions[3] } });

        const downward = [bar(sessions[0]!, '15', '10'), bar(sessions[1]!, '13', '8'), bar(sessions[2]!, '14', '7')];
        expect(normalizeChanContainment(downward).bars[1]).toMatchObject({ high: '13', low: '7', rawDates: [sessions[1], sessions[2]] });
    });

    it('方向無法唯一決定、連續包含後不足三根與缺 session 均為可稽核 unknown', () => {
        const sessions = dates(4);
        expect(normalizeChanContainment([bar(sessions[0]!, '12', '8'), bar(sessions[1]!, '11', '9')]).reason).toBe('containment_direction_unknown');
        const onlyTwo = [bar(sessions[0]!, '10', '5'), bar(sessions[1]!, '12', '7'), bar(sessions[2]!, '13', '6'), bar(sessions[3]!, '14', '6')];
        expect(evaluateChanFractal(onlyTwo, sessions, 'any').reason).toBe('insufficient_history');
        expect(evaluateChanFractal(onlyTwo.slice(0, 3), sessions, 'any').reason).toBe('missing_ohlcv');
        expect(normalizeChanContainment(onlyTwo)).toEqual(normalizeChanContainment(onlyTwo));

        const sixtySessions = dates(60);
        const sixtyBars = [bar(sixtySessions[0]!, '10', '5'), bar(sixtySessions[1]!, '12', '7'),
            ...sixtySessions.slice(2).map((date, index) => bar(date, String(13 + index), '6'))];
        expect(evaluateChanFractal(sixtyBars, sixtySessions, 'any').reason).toBe('insufficient_history');
    });

    it('algorithm any 採三態 OR：任一 pass 即 pass，fail 加 unknown 保持 unknown', () => {
        const sessions = dates(3);
        const bottom = [bar(sessions[0]!, '12', '10'), bar(sessions[1]!, '11', '8'), bar(sessions[2]!, '13', '9')];
        expect(evaluateFractalCriteria(bottom, sessions, { enabled: true, algorithm: 'any', direction: 'bottom' }).verdict).toBe('pass');
        const ambiguous = [bar(sessions[0]!, '12', '8'), bar(sessions[1]!, '11', '9'), bar(sessions[2]!, '13', '10')];
        expect(evaluateFractalCriteria(ambiguous, sessions, { enabled: true, algorithm: 'any', direction: 'any' })).toMatchObject({ verdict: 'unknown', reason: 'containment_direction_unknown' });
    });
});

describe('canonical BOLL(20,2) 首次穿越', () => {
    it('恰好 21 期判定下軌陽 K 下影，且 bands 與 canonical 函式 exact parity', () => {
        const sessions = dates(21);
        const bars = flatSeries(sessions);
        bars[20] = { sessionDate: sessions[20]!, open: '8', high: '9.2', low: '7', close: '9' };
        const result = evaluateBollReversal(bars, sessions, 'lower-bullish');
        expect(result).toMatchObject({ verdict: 'pass', evidence: { mode: 'lower-bullish', lowerShadow: true, previous: { lower: 10, middle: 10, upper: 10 } } });
        const reference = bollinger(bars.map((row) => ({ time: Date.parse(`${row.sessionDate}T00:00:00Z`) / 1000,
            open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: 0, turnoverTwd: null })), 20, 2);
        expect(result.evidence?.current).toMatchObject({ upper: reference.upper[20]?.value, middle: reference.mid[20]?.value, lower: reference.lower[20]?.value });
        expect(evaluateBollReversal(bars.slice(1), sessions, 'lower-bullish').reason).toBe('missing_ohlcv');
        expect(evaluateBollReversal(bars.slice(0, 20), sessions.slice(0, 20), 'lower-bullish').reason).toBe('insufficient_history');
    });

    it('判定上軌陰 K 上影；碰軌、十字、零影線與前日已在外都不通過', () => {
        const sessions = dates(21);
        const upper = flatSeries(sessions);
        upper[20] = { sessionDate: sessions[20]!, open: '12', high: '13', low: '10.8', close: '11' };
        expect(evaluateBollReversal(upper, sessions, 'upper-bearish')).toMatchObject({ verdict: 'pass', evidence: { mode: 'upper-bearish', upperShadow: true } });
        expect(evaluateBollReversal(upper, sessions, 'any').verdict).toBe('pass');
        const doji = upper.map((row) => ({ ...row })); doji[20] = { ...doji[20]!, open: '11' };
        expect(evaluateBollReversal(doji, sessions, 'upper-bearish').verdict).toBe('fail');
        const noShadow = upper.map((row) => ({ ...row })); noShadow[20] = { ...noShadow[20]!, high: '12' };
        expect(evaluateBollReversal(noShadow, sessions, 'upper-bearish').verdict).toBe('fail');
        const priorOutside = upper.map((row) => ({ ...row })); priorOutside[19] = { ...priorOutside[19]!, open: '12', high: '13', low: '11', close: '12' };
        expect(evaluateBollReversal(priorOutside, sessions, 'upper-bearish').verdict).toBe('fail');
        const onBand = flatSeries(sessions);
        expect(evaluateBollReversal(onBand, sessions, 'any').verdict).toBe('fail');
    });
});

describe('v3 criteria、版本、hash 與排序', () => {
    const technicalOnly: CriteriaV3 = {
        ...DEFAULT_CRITERIA_V3,
        volume: { ...DEFAULT_CRITERIA_V3.volume, enabled: false },
        holder: { ...DEFAULT_CRITERIA_V3.holder, enabled: false },
        fractal: { enabled: true, algorithm: 'any', direction: 'any' },
    };

    it('四分支外層 all/any 守恆，停用分支不要求資料', () => {
        expect(validateCriteriaV3(technicalOnly)).toBe(true);
        expect(combineCriteriaV3(technicalOnly, { fractal: 'pass' })).toBe('pass');
        expect(() => combineCriteriaV3(technicalOnly, {})).toThrow('missing_enabled_branch');
        const all = { ...DEFAULT_CRITERIA_V3, fractal: { enabled: true, algorithm: 'any' as const, direction: 'any' as const }, bollReversal: { enabled: true, mode: 'any' as const } };
        expect(combineCriteriaV3(all, { volume: 'pass', holder: 'pass', fractal: 'unknown', bollReversal: 'pass' })).toBe('unknown');
        expect(combineCriteriaV3({ ...all, mode: 'any' }, { volume: 'fail', holder: 'unknown', fractal: 'pass', bollReversal: 'fail' })).toBe('pass');
        expect(validateCriteriaV3({ ...technicalOnly, fractal: { ...technicalOnly.fractal, enabled: false } })).toBe(false);
    });

    it('v3 fingerprint 綁定算法、方向、BOLL mode 且不與 v2 混用', () => {
        const base = criteriaFingerprintV3(technicalOnly);
        expect(base.startsWith('3|')).toBe(true);
        expect(criteriaFingerprintV3({ ...technicalOnly, fractal: { ...technicalOnly.fractal, algorithm: 'raw-three' } })).not.toBe(base);
        expect(criteriaFingerprintV3({ ...technicalOnly, fractal: { ...technicalOnly.fractal, direction: 'top' } })).not.toBe(base);
        expect(criteriaFingerprintV3({ ...technicalOnly, bollReversal: { enabled: true, mode: 'upper-bearish' } })).not.toBe(base);
        const cursor = { version: 3 as const, snapshotId: '12345678-1234-1234-1234-123456789012', offset: 0, fingerprint: base };
        expect(isV3Cursor(cursor)).toBe(true);
        expect(isV3Cursor({ ...cursor, version: 2 })).toBe(false);
        expect(isV3Preference({ version: 3, query: { criteria: technicalOnly, sort: 'algorithm', direction: 'asc', resultState: 'pass' } })).toBe(true);
        expect(isV3Preference({ version: 2, query: { criteria: technicalOnly, sort: 'algorithm', direction: 'asc', resultState: 'pass' } })).toBe(false);
    });

    it('evidence hash 不受 object key order 影響，任何證據變更都會改 hash', async () => {
        const first = await technicalEvidenceHash({ b: 2, a: { y: 2, x: 1 } });
        expect(await technicalEvidenceHash({ a: { x: 1, y: 2 }, b: 2 })).toBe(first);
        expect(await technicalEvidenceHash({ a: { x: 1, y: 3 }, b: 2 })).not.toBe(first);
        expect(first).toMatch(/^[a-f0-9]{64}$/);
    });

    it('確認日、算法、方向、通道外距離排序 deterministic，unknown 永遠置底且代碼 tiebreak', () => {
        const rows: TechnicalSortableRow[] = [
            { code: '3008', verdict: 'pass', fractal: { algorithm: 'raw-three', direction: 'top', centerDate: '2026-08-28', confirmationDate: '2026-08-31', bars: [] } },
            { code: '2330', verdict: 'pass', fractal: { algorithm: 'raw-three', direction: 'top', centerDate: '2026-08-28', confirmationDate: '2026-08-31', bars: [] } },
            { code: '1101', verdict: 'unknown' },
        ];
        expect([...rows].sort((a, b) => compareTechnicalRows('confirmationDate', 'desc', a, b)).map((row) => row.code)).toEqual(['2330', '3008', '1101']);
        expect([...rows].sort((a, b) => compareTechnicalRows('algorithm', 'asc', a, b)).at(-1)?.code).toBe('1101');
        const directional: TechnicalSortableRow[] = [
            { code: '3008', verdict: 'pass', fractal: { algorithm: 'chan-containment', direction: 'top', centerDate: '2026-08-28', confirmationDate: '2026-08-31', bars: [] } },
            { code: '2330', verdict: 'pass', fractal: { algorithm: 'raw-three', direction: 'bottom', centerDate: '2026-08-28', confirmationDate: '2026-08-31', bars: [] } },
        ];
        expect([...directional].sort((a, b) => compareTechnicalRows('algorithm', 'asc', a, b)).map((row) => row.code)).toEqual(['2330', '3008']);
        expect([...directional].sort((a, b) => compareTechnicalRows('direction', 'desc', a, b)).map((row) => row.code)).toEqual(['3008', '2330']);
        const outside: TechnicalSortableRow[] = [
            { code: '2330', verdict: 'pass', boll: { mode: 'lower-bullish', previous: {} as never, current: {} as never, lowerShadow: true, upperShadow: false, outsideDistance: 0.5 } },
            { code: '3008', verdict: 'pass', boll: { mode: 'upper-bearish', previous: {} as never, current: {} as never, lowerShadow: false, upperShadow: true, outsideDistance: 1.25 } },
        ];
        expect([...outside].sort((a, b) => compareTechnicalRows('outsideDistance', 'desc', a, b)).map((row) => row.code)).toEqual(['3008', '2330']);
    });

    it('progress、metadata 與 v3 schema 守恆，v1/v2 fixture 不可冒充', () => {
        const progress: ScreenerV3Progress = { version: 3, target: 120, processed: 120, remaining: 0, failed: 0, overdue: 0, cursor: null,
            markets: { TWSE: { target: 60, processed: 60, failed: 0 }, TPEx: { target: 60, processed: 60, failed: 0 } } };
        expect(validateScreenerV3Progress(progress)).toBe(true);
        expect(validateScreenerV3Progress({ ...progress, remaining: 1 })).toBe(false);
        const sessions = dates(60);
        const metadata: ScreenerV3Metadata = { version: 3, schemaVersion: 3, formulaVersion: SCREENER_V3_FORMULA_VERSION,
            anchors: { daily: null, weekly: null, weeklyPeriods: [] }, technicalAnchors: { sessions, through: sessions.at(-1)! },
            baseSnapshotId: '12345678-1234-1234-1234-123456789012', receiptsHash: 'a'.repeat(64),
            universeRevision: 'fixture', total: 1, validThrough: '2026-09-02T10:00:00Z', sourceReview: 'verified', progress,
            counts: { total: 1, evaluated: 0, matched: 0, notMatched: 0, unknown: 1,
                missingByCondition: { 'volume-multiple': 0, 'large-holder-weekly-pp': 0, fractal: 1, 'boll-reversal': 1 } } };
        expect(validateScreenerV3Metadata(metadata)).toBe(true);
        expect(validateScreenerV3Metadata({ ...metadata, version: 2 } as unknown as ScreenerV3Metadata)).toBe(false);
        expect(validateScreenerV3Metadata({ ...metadata, schemaVersion: 2 } as unknown as ScreenerV3Metadata)).toBe(false);
    });
});
