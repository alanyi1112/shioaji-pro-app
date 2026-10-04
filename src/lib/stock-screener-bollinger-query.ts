/** 已凍結底稿的有界唯讀查詢；沒有 fetch、DB writer 或指標 builder。 */
import { technicalEvidenceHash } from './stock-screener-technical-patterns.ts';
import { BOLLINGER_HISTORY_CAPABILITY, SCREENER_V8_FORMULA_VERSION,
    bollingerRequiredHistory, bollingerCriteriaFingerprint, countBollingerStages, evaluateBollingerStages,
    validateBollingerSqueeze, validBollingerMapping, type BollingerFrozenFeatures, type BollingerOutcome,
    type BollingerSqueezeCriteria } from './stock-screener-v8.ts';
import { validBollingerDate } from './stock-screener-bollinger-source.ts';
import type { ScreenerMarket } from './stock-screener-domain.ts';
import { combineVerdicts, type Verdict } from './stock-screener-domain.ts';

export interface BollingerFrozenStock {
    symbol: string; code: string; name: string; market: ScreenerMarket; ordinary: boolean; features: BollingerFrozenFeatures;
}
export interface BollingerQuerySnapshot {
    id: string; universeRevision: string; effectiveSessionDate: string; historySessions: string[];
    rows: BollingerFrozenStock[];
}
export type BollingerSortKey = 'code' | 'bbw' | 'percentilePosition' | 'b' | 'breakoutVolumeRatio' | 'momentum';
export interface BollingerReadQuery {
    criteria: BollingerSqueezeCriteria;
    sort: { key: BollingerSortKey; direction: 'asc' | 'desc' };
    state: 'matched' | 'unknown' | 'notMatched' | 'all';
    limit: number; cursor?: string;
    stage?: 'all' | BollingerOutcome['stage'];
    combination?: { mode: 'all' | 'any'; fingerprint: string;
        rows: Record<string, { verdict: Verdict; evidence: unknown }> };
}
type Ratio = { numerator: bigint; denominator: bigint };
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const validNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integerString = (s: unknown): s is string => typeof s === 'string' && /^(?:0|[1-9]\d{0,28})$/.test(s);
// 只辨識本次讀取已完整驗證且深度凍結的物件；不是 snapshot／日期快取。
// 新 DB 讀取／clone 一律重新驗證，不能沿用已變更或失效資料的憑證。
const sealedFeatures = new WeakSet<object>();
function freezeEvidence(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const item of Object.values(value)) freezeEvidence(item);
    Object.freeze(value);
}
export async function validateAndSealBollingerFrozenFeatures(f: BollingerFrozenFeatures): Promise<boolean> {
    if (!await validateBollingerFrozenFeatures(f)) return false;
    freezeEvidence(f);
    sealedFeatures.add(f);
    return true;
}

/** 結構／hash驗證不重新計算 BOLL，不以短窗或被壓縮日期序列冒充合法底稿。 */
export async function validateBollingerFrozenFeatures(f: BollingerFrozenFeatures): Promise<boolean> {
    if (f && sealedFeatures.has(f)) return true;
    if (!f || f.version !== 8 || f.formulaVersion !== SCREENER_V8_FORMULA_VERSION
        || !validBollingerMapping(f.sourceMappingVersion) || f.capability !== BOLLINGER_HISTORY_CAPABILITY
        || !Array.isArray(f.sessions) || !f.sessions.length || f.sessions.length > 400 || f.sessions.at(-1) !== f.through
        || f.sessions.some((d, i) => !validBollingerDate(d) || i > 0 && d <= f.sessions[i - 1]!)
        || !Array.isArray(f.sourceHashes) || f.sourceHashes.length > 800 || f.sourceHashes.some(h => !/^[a-f0-9]{64}$/.test(h))
        || !Array.isArray(f.points) || f.points.length !== f.sessions.length || !/^[a-f0-9]{64}$/.test(f.evidenceHash)) return false;
    if (f.points.some((p, i) => !p || p.sessionDate !== f.sessions[i]
        || p.close !== null && (!validNumber(p.close) || p.close <= 0)
        || p.volumeShares !== null && !integerString(p.volumeShares) || p.turnoverNtd !== null && !integerString(p.turnoverNtd)
        || p.boll !== null && (!validNumber(p.boll?.upper) || !validNumber(p.boll.middle) || !validNumber(p.boll.lower)
            || p.boll.upper < p.boll.middle || p.boll.middle < p.boll.lower
            || p.boll.bbw !== null && (!validNumber(p.boll.bbw) || p.boll.bbw < 0)
            || p.boll.b !== null && !validNumber(p.boll.b)))) return false;
    for (const key of ['close', 'bbw', 'volume', 'turnover'] as const) {
        const p = f[key], exact = key === 'volume' || key === 'turnover';
        if (!p || !Array.isArray(p.sums) || !Array.isArray(p.counts) || p.sums.length !== f.sessions.length + 1
            || p.counts.length !== p.sums.length || p.counts[0] !== 0 || p.sums[0] !== (exact ? '0' : 0)
            || p.counts.some((v, i) => !Number.isInteger(v) || v < 0 || v > i
                || i > 0 && ![0, 1].includes(v - p.counts[i - 1]!))
            || p.sums.some(v => exact ? !integerString(v) : !validNumber(v) || v < 0)) return false;
    }
    const { evidenceHash, ...value } = f;
    return await technicalEvidenceHash(value) === evidenceHash;
}
const rational = (n: unknown, d: unknown): Ratio | null => integerString(n) && integerString(d) && BigInt(d) > BigInt(0)
    ? { numerator: BigInt(n), denominator: BigInt(d) } : null;
export function bollingerSortMetric(o: BollingerOutcome, key: BollingerSortKey): number | Ratio | null {
    if (typeof BigInt !== 'function') return null;
    if (key === 'bbw') return o.setup.bbw;
    if (key === 'b') return o.setup.b;
    if (key === 'momentum') return validNumber(o.setup.gate.momentum?.actual) ? o.setup.gate.momentum.actual : null;
    if (key === 'breakoutVolumeRatio') {
        const a = o.breakoutChecks.expansion?.actual as { currentShares: string | null; baselineSumShares: string | null; baselineDays: number };
        if (!a || !Number.isSafeInteger(a.baselineDays) || a.baselineDays < 1) return null;
        const r = rational(a.currentShares, a.baselineSumShares);
        return r ? { numerator: r.numerator * BigInt(a.baselineDays), denominator: r.denominator } : null;
    }
    if (key === 'percentilePosition') {
        const a = o.setup.compression.relativeBandwidth?.actual as { bbw: number | null; prior: Array<number | null> };
        if (!a || !validNumber(a.bbw) || !Array.isArray(a.prior) || !a.prior.length || a.prior.some(p => !validNumber(p))) return null;
        // 經驗累積位置：前N日BBW中<=當日的比例，不是跨股票排名。
        return { numerator: BigInt(a.prior.filter(p => p! <= a.bbw!).length), denominator: BigInt(a.prior.length) };
    }
    return null;
}
const compareMetric = (a: number | Ratio, b: number | Ratio) => typeof a === 'number' && typeof b === 'number'
    ? a < b ? -1 : a > b ? 1 : 0
    : typeof a === 'object' && typeof b === 'object'
        ? a.numerator * b.denominator < b.numerator * a.denominator ? -1
            : a.numerator * b.denominator > b.numerator * a.denominator ? 1 : 0 : 0;

export async function queryBollingerSnapshot(snapshot: BollingerQuerySnapshot, query: BollingerReadQuery) {
    if (!validateBollingerSqueeze(query?.criteria) || !query.criteria.enabled
        || !['code', 'bbw', 'percentilePosition', 'b', 'breakoutVolumeRatio', 'momentum'].includes(query.sort?.key)
        || !['asc', 'desc'].includes(query.sort.direction) || !['matched', 'unknown', 'notMatched', 'all'].includes(query.state)
        || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100
        || query.stage !== undefined && !['all', 'breakout', 'preparing', 'compressing', 'unknown', 'notMatched'].includes(query.stage)) throw new Error('invalid_bollinger_query');
    if (!snapshot || !/^[\w-]{36}$/.test(snapshot.id) || !snapshot.universeRevision || !validBollingerDate(snapshot.effectiveSessionDate)
        || !Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length > 10000
        || new Set(snapshot.rows.map(s => s.symbol)).size !== snapshot.rows.length
        || !Array.isArray(snapshot.historySessions) || snapshot.historySessions.at(-1) !== snapshot.effectiveSessionDate
        || snapshot.rows.some(s => !['TWSE', 'TPEx'].includes(s.market) || typeof s.ordinary !== 'boolean' || !s.name
            || !/^[A-Z0-9]{4,12}$/.test(s.code) || s.symbol !== `${s.code}.${s.market === 'TWSE' ? 'TW' : 'TWO'}`
            || s.features.through !== snapshot.effectiveSessionDate || JSON.stringify(s.features.sessions) !== JSON.stringify(snapshot.historySessions)))
        throw new Error('invalid_bollinger_snapshot');
    const requiredDays = Math.max(160, bollingerRequiredHistory(query.criteria));
    if (snapshot.historySessions.length < requiredDays) return { state: 'history_pending' as const, requiredDays,
        availableDays: snapshot.historySessions.length, rows: [], nextCursor: null };
    const hashes: string[] = [];
    for (const row of snapshot.rows) {
        if (!await validateBollingerFrozenFeatures(row.features)) throw new Error('invalid_bollinger_snapshot');
        hashes.push(await technicalEvidenceHash({ symbol: row.symbol, code: row.code, name: row.name,
            market: row.market, ordinary: row.ordinary, featuresHash: row.features.evidenceHash }));
    }
    const fingerprint = await technicalEvidenceHash({ version: 8, snapshotId: snapshot.id,
        universeRevision: snapshot.universeRevision, date: snapshot.effectiveSessionDate,
        sources: hashes.sort(), criteria: bollingerCriteriaFingerprint(query.criteria), sort: query.sort,
        state: query.state, stage: query.stage ?? 'all', limit: query.limit, combination: query.combination ?? null, formulaVersion: SCREENER_V8_FORMULA_VERSION });
    let offset = 0;
    if (query.cursor !== undefined) {
        try {
            if (!/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor)) throw new Error();
            const parsed = JSON.parse(atob(query.cursor.replaceAll('-', '+').replaceAll('_', '/')));
            if (Object.keys(parsed).sort().join() !== 'fingerprint,offset,version' || parsed.version !== 8 || parsed.fingerprint !== fingerprint
                || !Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > snapshot.rows.length || parsed.offset % query.limit !== 0) throw new Error();
            offset = parsed.offset;
        } catch { throw new Error('invalid_bollinger_cursor'); }
    }
    const evaluated: Array<Omit<BollingerFrozenStock, 'features'> & { outcome: BollingerOutcome; verdict: Verdict; legacyEvidence: unknown }> = [];
    for (const row of snapshot.rows) {
        const { features, symbol, code, name, market, ordinary } = row;
        const stock = { symbol, code, name, market, ordinary };
        const outcome = await evaluateBollingerStages(features, query.criteria, row.ordinary);
        const joined = query.combination?.rows[row.symbol];
        evaluated.push({ ...stock, outcome, verdict: query.combination
            ? combineVerdicts([outcome.branchVerdict, joined?.verdict ?? 'unknown'], query.combination.mode) : outcome.branchVerdict,
            legacyEvidence: joined?.evidence ?? null });
    }
    const counts = countBollingerStages(evaluated.map(s => ({ market: s.market, stage: s.outcome.stage })));
    const combinationCounts = { total: evaluated.length, matched: evaluated.filter(r => r.verdict === 'pass').length,
        unknown: evaluated.filter(r => r.verdict === 'unknown').length, notMatched: evaluated.filter(r => r.verdict === 'fail').length };
    const filtered = evaluated.filter(r => (!query.stage || query.stage === 'all' || r.outcome.stage === query.stage)
        && (query.state === 'all' || (query.state === 'matched' ? r.verdict === 'pass'
        : query.state === 'unknown' ? r.verdict === 'unknown' : r.verdict === 'fail')));
    filtered.sort((a, b) => {
        if (query.sort.key === 'code') return (query.sort.direction === 'asc' ? 1 : -1) * textOrder(a.code, b.code) || textOrder(a.symbol, b.symbol);
        const am = bollingerSortMetric(a.outcome, query.sort.key), bm = bollingerSortMetric(b.outcome, query.sort.key);
        // unknown 始終置末，不能在 desc 時被翻到最前面。
        if (am === null || bm === null) return am === null && bm === null ? textOrder(a.symbol, b.symbol) : am === null ? 1 : -1;
        return (query.sort.direction === 'asc' ? 1 : -1) * compareMetric(am, bm) || textOrder(a.symbol, b.symbol);
    });
    if (offset > filtered.length) throw new Error('invalid_bollinger_cursor');
    const nextOffset = offset + query.limit;
    const nextCursor = nextOffset < filtered.length ? btoa(JSON.stringify({ version: 8, fingerprint, offset: nextOffset }))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : null;
    return { state: 'ready' as const, snapshotId: snapshot.id, effectiveSessionDate: snapshot.effectiveSessionDate,
        fingerprint, counts, combinationCounts, filteredCount: filtered.length, rows: filtered.slice(offset, nextOffset), nextCursor };
}
