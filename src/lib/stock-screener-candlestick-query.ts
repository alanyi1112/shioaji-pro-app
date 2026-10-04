/** v9 全母體唯讀判定／游標。所有 I/O 在呼叫端；不得抓行情或保存設定。 */
import { combineVerdicts, isIsoDate, type ScreenerMarket, type Verdict } from './stock-screener-domain.ts';
import { evaluateCandlestickReversal, type CandlestickHistory, type CandlestickOutcome } from './stock-screener-candlestick.ts';
import { activeCriteriaV9, validateCriteriaV9, type CriteriaV9 } from './stock-screener-v9.ts';
import { technicalEvidenceHash } from './stock-screener-technical-patterns.ts';

export interface CandlestickFrozenStock { symbol: string; code: string; name: string; market: ScreenerMarket; ordinary: true; history: CandlestickHistory }
export interface CandlestickSnapshot { id: string; through: string; universeRevision: string; universeHash: string; rowsHash: string; rows: CandlestickFrozenStock[] }
export interface CandlestickReadQuery { criteria: CriteriaV9; direction: 'asc' | 'desc'; resultState: Verdict; limit: number; cursor?: string }
export interface CandlestickResultRow extends CandlestickFrozenStock {
    verdict: Verdict; outcome: CandlestickOutcome; legacyEvidence: unknown; bollingerEvidence: unknown;
}
const encode = (s: string) => btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (s: string) => atob(s.replaceAll('-', '+').replaceAll('_', '/'));
export async function queryCandlestickSnapshot(snapshot: CandlestickSnapshot, query: CandlestickReadQuery, combination?: {
    fingerprint: string; legacy?: Record<string, { verdict: Verdict; evidence: unknown }>;
    bollinger?: Record<string, { verdict: Verdict; evidence: unknown }>;
}) {
    if (!validateCriteriaV9(query.criteria) || !query.criteria.candlestickReversal.enabled
        || !['asc', 'desc'].includes(query.direction) || !['pass', 'fail', 'unknown'].includes(query.resultState)
        || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error('invalid_v9_query');
    if (!isIsoDate(snapshot.through) || !snapshot.universeRevision || !/^[a-f0-9]{64}$/.test(snapshot.universeHash)
        || !/^[a-f0-9]{64}$/.test(snapshot.rowsHash) || await technicalEvidenceHash(snapshot.rows) !== snapshot.rowsHash
        || !snapshot.rows.length || snapshot.rows.length > 10000 || new Set(snapshot.rows.map(r => r.symbol)).size !== snapshot.rows.length
        || snapshot.rows.some(r => r.history.through !== snapshot.through || r.ordinary !== true
            || !['TWSE', 'TPEx'].includes(r.market) || r.symbol !== `${r.code}.${r.market === 'TWSE' ? 'TW' : 'TWO'}`)) throw new Error('invalid_v9_snapshot');
    const fingerprint = await technicalEvidenceHash({ criteria: activeCriteriaV9(query.criteria), direction: query.direction,
        resultState: query.resultState, limit: query.limit, combination: combination?.fingerprint ?? null });
    const identity = await technicalEvidenceHash({ id: snapshot.id, through: snapshot.through, universe: snapshot.universeHash,
        rowsHash: snapshot.rowsHash, fingerprint });
    let offset = 0;
    if (query.cursor) {
        try {
            if (!/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor)) throw new Error();
            const c = JSON.parse(decode(query.cursor));
            if (Object.keys(c).sort().join() !== 'identity,offset' || c.identity !== identity || !Number.isSafeInteger(c.offset)
                || c.offset < 1 || c.offset % query.limit !== 0) throw new Error();
            offset = c.offset;
        } catch { throw new Error('invalid_v9_cursor'); }
    }
    const rows: CandlestickResultRow[] = [];
    const counts = { total: snapshot.rows.length, pass: 0, fail: 0, unknown: 0 };
    const byMarket = { TWSE: { total: 0, pass: 0, fail: 0, unknown: 0 }, TPEx: { total: 0, pass: 0, fail: 0, unknown: 0 } };
    for (const stock of snapshot.rows) {
        const outcome = await evaluateCandlestickReversal(stock.history, query.criteria.candlestickReversal);
        const legacy = combination?.legacy?.[stock.symbol], boll = combination?.bollinger?.[stock.symbol];
        const verdict = combineVerdicts([outcome.verdict, ...(combination?.legacy ? [legacy?.verdict ?? 'unknown'] : []),
            ...(combination?.bollinger ? [boll?.verdict ?? 'unknown'] : [])], query.criteria.mode);
        counts[verdict]++; byMarket[stock.market].total++; byMarket[stock.market][verdict]++;
        // 全部必要暖機原值隨結果保存；只回傳日期／斜率無法獨立重算前期趨勢。
        rows.push({ ...stock, verdict, outcome, legacyEvidence: legacy?.evidence ?? null, bollingerEvidence: boll?.evidence ?? null });
    }
    const filtered = rows.filter(r => r.verdict === query.resultState).sort((a, b) => {
        const order = a.code < b.code ? -1 : a.code > b.code ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
        return query.direction === 'asc' ? order : -order;
    });
    if (offset > filtered.length) throw new Error('invalid_v9_cursor');
    return { criteriaFingerprint: fingerprint, counts, byMarket, filteredCount: filtered.length,
        rows: filtered.slice(offset, offset + query.limit), nextCursor: offset + query.limit < filtered.length
            ? encode(JSON.stringify({ identity, offset: offset + query.limit })) : null };
}
