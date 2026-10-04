/** 精確 K 線反轉核心：BigInt／整數交叉相乘，不以顏色、影線或浮點誤差判定。 */
import { combineVerdicts, hundredths, isIsoDate, type Verdict } from './stock-screener-domain.ts';
import { canonicalPriceUnits, canonicalVolumeShares, validateCanonicalOhlc, SCREENER_PRICE_BASIS, type CanonicalOhlc } from './stock-screener-ohlcv.ts';
import { technicalEvidenceHash } from './stock-screener-technical-patterns.ts';
import { CANDLESTICK_FORMULA_VERSION, CANDLESTICK_HISTORY_CAPABILITY, CANDLESTICK_PATTERNS,
    validateCandlestickReversal, type CandlestickPattern, type CandlestickReversalCriteria } from './stock-screener-v9.ts';

export type CandlestickBar = CanonicalOhlc & { volumeShares: string | null };
export interface CandlestickHistory {
    version: 9; formulaVersion: typeof CANDLESTICK_FORMULA_VERSION; capability: typeof CANDLESTICK_HISTORY_CAPABILITY;
    priceBasis: typeof SCREENER_PRICE_BASIS; mappingVersion: string; calendarHash: string; sourceHashes: string[];
    through: string; completedThrough: string; sessions: string[];
    points: { sessionDate: string; bar: CandlestickBar | null; reason: string | null }[];
    /** 已知除權息／基礎不相容日，不擅自還原價格。 */
    incomparableSessions: string[]; evidenceHash: string;
}
export async function buildCandlestickHistory(bars: readonly CandlestickBar[], sessions: readonly string[], provenance: {
    mappingVersion: string; calendarHash: string; sourceHashes: string[]; completedThrough: string;
    incomparableSessions?: string[];
}): Promise<CandlestickHistory> {
    const hex = /^[a-f0-9]{64}$/;
    if (!sessions.length || sessions.length > 64 || sessions.some((d, i) => !isIsoDate(d) || i > 0 && d <= sessions[i - 1]!)
        || bars.length > sessions.length || new Set(bars.map(b => b.sessionDate)).size !== bars.length
        || bars.some(b => !sessions.includes(b.sessionDate)) || !provenance.mappingVersion
        || !hex.test(provenance.calendarHash) || !provenance.sourceHashes.length || provenance.sourceHashes.some(h => !hex.test(h))
        || !isIsoDate(provenance.completedThrough) || provenance.completedThrough < sessions.at(-1)!
        || provenance.incomparableSessions?.some(d => !sessions.includes(d))) throw new Error('invalid_candlestick_history');
    const map = new Map(bars.map(b => [b.sessionDate, b]));
    const value: Omit<CandlestickHistory, 'evidenceHash'> = {
        version: 9, formulaVersion: CANDLESTICK_FORMULA_VERSION, capability: CANDLESTICK_HISTORY_CAPABILITY,
        priceBasis: SCREENER_PRICE_BASIS, mappingVersion: provenance.mappingVersion, calendarHash: provenance.calendarHash,
        completedThrough: provenance.completedThrough, sourceHashes: [...new Set(provenance.sourceHashes)].sort(),
        through: sessions.at(-1)!, sessions: [...sessions], incomparableSessions: [...new Set(provenance.incomparableSessions ?? [])].sort(),
        points: sessions.map(sessionDate => { const b = map.get(sessionDate); return { sessionDate,
            bar: b && validateCanonicalOhlc(b) ? { sessionDate: b.sessionDate, open: b.open, high: b.high, low: b.low, close: b.close,
                volumeShares: canonicalVolumeShares(b.volumeShares) === null ? null : b.volumeShares } : null,
            reason: !b ? 'missing_session' : !validateCanonicalOhlc(b) ? 'invalid_ohlcv'
                : canonicalVolumeShares(b.volumeShares) === null ? 'missing_volume' : null }; }),
    };
    return deepFreeze({ ...value, evidenceHash: await technicalEvidenceHash(value) });
}
function deepFreeze<T>(v: T): T {
    if (v && typeof v === 'object') { for (const child of Object.values(v)) deepFreeze(child); Object.freeze(v); }
    return v;
}
const verified = new WeakSet<object>();
/** 同一 immutable 物件可重用；clone／資料變動重新驗 hash，不接受 close-only v8。 */
export async function validateCandlestickHistory(h: CandlestickHistory): Promise<void> {
    if (h && verified.has(h)) return;
    if (!h || h.version !== 9 || h.formulaVersion !== CANDLESTICK_FORMULA_VERSION || h.capability !== CANDLESTICK_HISTORY_CAPABILITY
        || h.priceBasis !== SCREENER_PRICE_BASIS || !Array.isArray(h.sessions) || !Array.isArray(h.points)
        || h.through !== h.sessions.at(-1) || !Array.isArray(h.incomparableSessions)
        || h.points.length !== h.sessions.length || h.points.some((p, i) => !p || p.sessionDate !== h.sessions[i]
            || p.bar !== null && (!validateCanonicalOhlc(p.bar) || p.bar.sessionDate !== p.sessionDate
                || p.bar.volumeShares !== null && canonicalVolumeShares(p.bar.volumeShares) === null))) throw new Error('invalid_candlestick_capability');
    const { evidenceHash, ...body } = h;
    if (await technicalEvidenceHash(body) !== evidenceHash) throw new Error('invalid_candlestick_hash');
    // 重建驗證 provenance/grid；缺口理由須與資料對應，原 hash 包含完整理由。
    await buildCandlestickHistory(h.points.flatMap(p => p.bar ? [p.bar] : []), h.sessions, h);
    deepFreeze(h); verified.add(h);
}
type Candle = { date: string; o: bigint; h: bigint; l: bigint; c: bigint; body: bigint; range: bigint; lo: bigint; hi: bigint; volume: bigint | null };
const candle = (b: CandlestickBar): Candle => {
    const o = canonicalPriceUnits(b.open)!, h = canonicalPriceUnits(b.high)!, l = canonicalPriceUnits(b.low)!, c = canonicalPriceUnits(b.close)!;
    return { date: b.sessionDate, o, h, l, c, lo: o < c ? o : c, hi: o > c ? o : c,
        body: o < c ? c - o : o - c, range: h - l, volume: canonicalVolumeShares(b.volumeShares) };
};
const abs = (v: bigint) => v < BigInt(0) ? -v : v;
export interface CandlestickCheck { key: string; verdict: Verdict; reason: string; dates: string[]; operands?: Record<string, string> }
export interface CandlestickMatch {
    pattern: CandlestickPattern; subtype: CandlestickPattern | 'morning-doji-star'; direction: 'bullish' | 'bearish';
    verdict: Verdict; reasons: string[]; mode: CandlestickReversalCriteria['mode']; formationDates: string[]; confirmationDate: string | null;
    bars: CandlestickBar[]; checks: CandlestickCheck[];
}
export interface CandlestickOutcome { verdict: Verdict; matches: CandlestickMatch[]; hits: CandlestickMatch[]; historyHash: string; formulaVersion: typeof CANDLESTICK_FORMULA_VERSION }

function evaluatePattern(history: CandlestickHistory, c: CandlestickReversalCriteria, pattern: CandlestickPattern): CandlestickMatch {
    const bullish = !['bearish-engulfing', 'three-black-crows'].includes(pattern), length = ['piercing', 'bearish-engulfing'].includes(pattern) ? 2 : 3;
    const end = history.sessions.length - 1 - (c.mode === 'next-session-breakout' ? 1 : 0), start = end - length + 1;
    const checks: CandlestickCheck[] = [], used = new Set<number>();
    const add = (key: string, result: boolean | null, reason: string, dates: string[] = [], operands?: Record<string, string>) => {
        checks.push({ key, verdict: result === null ? 'unknown' : result ? 'pass' : 'fail', reason: result === true ? 'none' : reason, dates, ...(operands ? { operands } : {}) });
    };
    const window = (key: string, from: number, to: number): Candle[] | null => {
        if (from < 0 || to < from || to >= history.points.length) { add(key, null, 'insufficient_history'); return null; }
        const points = history.points.slice(from, to + 1); for (let i = from; i <= to; i++) used.add(i);
        const gap = points.find(p => !p.bar);
        if (gap) { add(key, null, gap.reason ?? 'missing_session', points.map(p => p.sessionDate)); return null; }
        return points.map(p => candle(p.bar!));
    };
    const bars = window('pattern-window', start, end), trend = window('prior-trend', start - c.trendDays, start - 1);
    const result: CandlestickMatch = { pattern, subtype: pattern, direction: bullish ? 'bullish' : 'bearish',
        verdict: 'unknown', reasons: [], mode: c.mode, formationDates: history.sessions.slice(Math.max(0, start), end + 1),
        confirmationDate: c.mode === 'next-session-breakout' ? history.through : null,
        bars: bars ? history.points.slice(start, end + 1).map(p => p.bar!) : [], checks };
    if (trend) {
        const n = BigInt(trend.length), sumX = n * (n - BigInt(1)) / BigInt(2), sumY = trend.reduce((s, b) => s + b.c, BigInt(0));
        const sumXY = trend.reduce((s, b, i) => s + BigInt(i) * b.c, BigInt(0)), slope = n * sumXY - sumX * sumY;
        const change = trend.at(-1)!.c - trend[0]!.c, signed = bullish ? -change : change, threshold = hundredths(c.minTrendChangePct)!;
        add('prior-trend', (bullish ? slope < BigInt(0) : slope > BigInt(0)) && signed * BigInt(10000) > trend[0]!.c * threshold,
            'trend_not_confirmed', trend.map(b => b.date), { olsNumerator: String(slope), firstCloseUnits: String(trend[0]!.c), lastCloseUnits: String(trend.at(-1)!.c), thresholdHundredthsPct: String(threshold) });
    }
    const needsLong = !['bearish-engulfing', 'piercing'].includes(pattern) || pattern === 'piercing' && c.piercingRequireLongFirstBody;
    const reference = needsLong ? window('body-reference', start - c.bodyReferenceDays, start - 1) : null;
    let medianTwice: bigint | null = null;
    if (reference) {
        const sorted = reference.map(b => b.body).sort((a, b) => a < b ? -1 : a > b ? 1 : 0), mid = Math.floor(sorted.length / 2);
        medianTwice = sorted.length % 2 ? sorted[mid]! * BigInt(2) : sorted[mid - 1]! + sorted[mid]!;
        if (medianTwice === BigInt(0)) { add('body-reference', null, 'zero_body_median', reference.map(b => b.date)); medianTwice = null; }
    }
    const long = (b: Candle) => {
        add('long-body-range', b.range > BigInt(0) && b.body * BigInt(10000) >= b.range * hundredths(c.longBodyMinPct)!, 'short_body', [b.date]);
        if (medianTwice !== null) add('long-body-median', b.body * BigInt(200) >= medianTwice * hundredths(c.longBodyMedianRatio)!, 'below_body_median', [b.date, ...reference!.map(b => b.date)],
            { bodyUnits: String(b.body), medianTwiceUnits: String(medianTwice), ratioHundredths: String(hundredths(c.longBodyMedianRatio)) });
    };
    const inside = (open: bigint, prev: Candle) => open > prev.lo && open < prev.hi;
    if (bars) {
        const a = bars[0]!, b = bars[1]!, d = bars[2];
        add('nonzero-range', bars.every(b => b.range > BigInt(0)), 'zero_range', bars.map(b => b.date));
        if (pattern === 'three-white-soldiers' || pattern === 'three-black-crows') {
            bars.forEach(long);
            add('candle-direction', bars.every(b => bullish ? b.c > b.o : b.c < b.o), 'wrong_candle_direction');
            add('progression', bars.slice(1).every((b, i) => bullish ? b.c > bars[i]!.c : b.c < bars[i]!.c && b.l < bars[i]!.l), 'no_progression');
            add('open-inside-body', bars.slice(1).every((b, i) => inside(b.o, bars[i]!)), 'open_not_inside_body');
            add('near-extreme', bars.every(b => b.range > BigInt(0) && (bullish ? b.h - b.c : b.c - b.l) * BigInt(10000) <= b.range * hundredths(c.nearExtremeMaxPct)!), 'long_shadow');
            if (!bullish && c.firstCrowOpenWithinPriorBody) {
                const prev = window('first-crow-reference', start - 1, start - 1);
                if (prev) add('first-crow-open', inside(a.o, prev[0]!), 'first_open_not_inside_body', [prev[0]!.date, a.date]);
            }
        } else if (pattern === 'bearish-engulfing') {
            add('candle-direction', a.c > a.o && b.c < b.o, 'wrong_candle_direction');
            add('body-engulf', b.o > a.c && b.c < a.o, 'body_not_strictly_engulfed', [a.date, b.date],
                { openAUnits: String(a.o), closeAUnits: String(a.c), openBUnits: String(b.o), closeBUnits: String(b.c) });
        } else if (pattern === 'morning-star') {
            long(a); long(d!);
            add('candle-direction', a.c < a.o && d!.c > d!.o, 'wrong_candle_direction');
            add('small-middle', b.range > BigInt(0) && b.body * BigInt(10000) <= b.range * hundredths(c.smallBodyMaxPct)!, 'large_middle_body');
            if (b.o === b.c) { result.subtype = 'morning-doji-star'; add('doji-enabled', c.includeMorningDoji, 'morning_doji_disabled'); }
            add('recovery', (d!.c - a.c) * BigInt(10000) > (a.o - a.c) * hundredths(c.morningRecoveryPct)!, 'recovery_not_strictly_above', [a.date, d!.date],
                { closeUnits: String(d!.c), openAUnits: String(a.o), closeAUnits: String(a.c), recoveryHundredthsPct: String(hundredths(c.morningRecoveryPct)) });
            if (c.morningGapMode === 'strict-body-gap') add('body-gaps', b.hi < a.lo && d!.lo > b.hi, 'body_gap_missing', bars.map(b => b.date));
        } else {
            if (c.piercingRequireLongFirstBody) long(a);
            add('candle-direction', a.c < a.o && b.c > b.o, 'wrong_candle_direction');
            add('piercing-open', b.o <= a.c && (c.piercingOpenMode !== 'below-prior-low' || b.o < a.l), 'piercing_open_not_allowed', [a.date, b.date]);
            add('piercing-upper-bound', b.c < a.o, 'piercing_close_at_or_above_prior_open');
            add('recovery', (b.c - a.c) * BigInt(10000) > (a.o - a.c) * hundredths(c.piercingRecoveryPct)!, 'recovery_not_strictly_above', [a.date, b.date],
                { closeUnits: String(b.c), openAUnits: String(a.o), closeAUnits: String(a.c), recoveryHundredthsPct: String(hundredths(c.piercingRecoveryPct)) });
        }
        if (c.mode === 'next-session-breakout') {
            const confirmation = window('confirmation-window', end + 1, end + 1);
            if (confirmation) {
                const bound = bars.reduce((x, b) => bullish ? b.h > x ? b.h : x : b.l < x ? b.l : x, bullish ? a.h : a.l);
                add('close-breakout', bullish ? confirmation[0]!.c > bound : confirmation[0]!.c < bound, 'no_close_breakout', [confirmation[0]!.date],
                    { closeUnits: String(confirmation[0]!.c), boundUnits: String(bound) });
            }
        }
        if (c.position.enabled) {
            const prior = window('position-reference', start - c.position.baselineDays, start - 1);
            if (prior) {
                const bound = prior.reduce((x, b) => bullish ? b.l < x ? b.l : x : b.h > x ? b.h : x, bullish ? prior[0]!.l : prior[0]!.h);
                const extreme = bars.reduce((x, b) => bullish ? b.l < x ? b.l : x : b.h > x ? b.h : x, bullish ? a.l : a.h);
                add('position', abs(extreme - bound) * BigInt(10000) <= bound * hundredths(c.position.tolerancePct)!, 'outside_reference_position', prior.map(b => b.date),
                    { patternExtremeUnits: String(extreme), referenceUnits: String(bound) });
            }
        }
    }
    if (c.volume.enabled) {
        const idx = history.points.length - 1, latest = window('volume-current', idx, idx), prior = window('volume-reference', idx - c.volume.baselineDays, idx - 1);
        if (latest && prior && (latest[0]!.volume === null || prior.some(b => b.volume === null))) add('volume', null, 'missing_volume', [...prior.map(b => b.date), latest[0]!.date]);
        else if (latest && prior) {
            const total = prior.reduce((n, b) => n + b.volume!, BigInt(0)), n = BigInt(prior.length);
            add('volume', total === BigInt(0) ? null : latest[0]!.volume! * n * BigInt(100) >= total * hundredths(c.volume.ratio)!, total === BigInt(0) ? 'zero_volume_average' : 'below_volume_ratio', prior.map(b => b.date),
                { currentShares: String(latest[0]!.volume), priorSharesSum: String(total), days: String(n) });
            if (c.volume.minimumAverageVolumeEnabled) add('volume-liquidity', total >= n * BigInt(c.volume.minimumAverageVolumeLots) * BigInt(1000), 'below_average_liquidity');
        }
    }
    // 不能只看各個離散參考窗；除權息位於型態與趨勢之間也使比較無效。
    const firstUsed = Math.min(...used), lastUsed = Math.max(...used);
    const incomparable = history.sessions.slice(firstUsed, lastUsed + 1).filter(d => history.incomparableSessions.includes(d));
    if (incomparable.length) add('price-basis', null, 'incomparable_price_window', incomparable);
    result.verdict = combineVerdicts(checks.map(x => x.verdict), 'all');
    // 無法比較的除權息窗口不能因其他 shape fail 冒稱已知不符。
    if (incomparable.length) result.verdict = 'unknown';
    result.reasons = [...new Set(checks.filter(x => x.verdict !== 'pass').map(x => x.reason))];
    return result;
}
export async function evaluateCandlestickReversal(history: CandlestickHistory, criteria: CandlestickReversalCriteria): Promise<CandlestickOutcome> {
    if (!validateCandlestickReversal(criteria) || !criteria.enabled) throw new Error('invalid_candlestick_criteria');
    await validateCandlestickHistory(history);
    const matches = CANDLESTICK_PATTERNS.filter(p => criteria.patterns.includes(p)).map(p => evaluatePattern(history, criteria, p));
    return { verdict: combineVerdicts(matches.map(m => m.verdict), 'any'), matches, hits: matches.filter(m => m.verdict === 'pass'),
        historyHash: history.evidenceHash, formulaVersion: CANDLESTICK_FORMULA_VERSION };
}
/** 外層 all／any 使用同一三態規則；一個商品只有一列，保留全部命中證據。 */
export function combineCandlestickUniverse(rows: { symbol: string; outcome: CandlestickOutcome; legacyVerdicts: Verdict[] }[], mode: 'all' | 'any') {
    if (!['all', 'any'].includes(mode) || new Set(rows.map(r => r.symbol)).size !== rows.length) throw new Error('invalid_universe');
    const results = rows.map(r => ({ ...r, verdict: combineVerdicts([...r.legacyVerdicts, r.outcome.verdict], mode) }));
    const counts = { total: results.length, pass: 0, fail: 0, unknown: 0 };
    for (const r of results) counts[r.verdict]++;
    return { rows: results, counts };
}
