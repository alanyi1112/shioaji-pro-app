import { isIsoDate, type Verdict } from './stock-screener-domain';
import { evaluateCandlestickReversal, validateCandlestickHistory } from './stock-screener-candlestick';
import { CANDLESTICK_CATALOG_VERSION } from './stock-screener-candlestick-catalog';
import { CANDLESTICK_FORMULA_VERSION, CANDLESTICK_HISTORY_CAPABILITY, isV9Preference, validateCriteriaV9, type CriteriaV9, type PreferenceV9 } from './stock-screener-v9';
import type { CandlestickResultRow } from './stock-screener-candlestick-query';
import { technicalEvidenceHash } from './stock-screener-technical-patterns';
export const CANDLESTICK_PREFS = 'sj-pro-stock-screener-v9';
export type CandlestickUIQuery = PreferenceV9['query'];
export type CandlestickCounts = Record<'total' | Verdict, number>;
export interface CandlestickResponse {
    version: 9; state: 'ready' | 'pending' | 'stale' | 'unavailable'; reason: string;
    snapshotId: string | null; canUseResults: boolean; effectiveSessionDate: string | null; expectedSessionDate: string | null;
    formulaVersion: string; capability: string; catalogVersion: string; rows: CandlestickResultRow[]; nextCursor: string | null;
    counts: CandlestickCounts | null; byMarket?: Record<'TWSE' | 'TPEx', CandlestickCounts>; sourceMappingVersion?: string;
    calendarHash?: string; sourceHashes?: string[]; rowsHash?: string; universeHash?: string; criteriaFingerprint?: string;
    sourceEvidence?: unknown; preparation?: { reason?: string }; legacyJoin?: { reason: string }; bollingerJoin?: { reason: string };
}
export function loadCandlestickPreference(storage: Pick<Storage, 'getItem'>): CandlestickUIQuery | null {
    try { const p = JSON.parse(storage.getItem(CANDLESTICK_PREFS) ?? 'null'); return isV9Preference(p) ? structuredClone(p.query) : null; }
    catch { return null; }
}
export function candlestickSearch(query: CandlestickUIQuery, cursor?: string, snapshotId?: string): string {
    if (!validateCriteriaV9(query.criteria) || !query.criteria.candlestickReversal.enabled) throw new Error('invalid_v9_query');
    const p = new URLSearchParams({ version: '9', criteria: JSON.stringify(query.criteria), sort: 'code', direction: query.direction,
        resultState: query.resultState, limit: '50' });
    if (cursor) p.set('cursor', cursor); if (snapshotId) p.set('snapshotId', snapshotId); return p.toString();
}
const validCounts = (c: CandlestickCounts) => !!c && ['total', 'pass', 'fail', 'unknown'].every(k => Number.isSafeInteger(c[k as keyof typeof c]) && c[k as keyof typeof c] >= 0)
    && c.total === c.pass + c.fail + c.unknown;
export async function decodeCandlestickResponse(value: unknown, criteria?: CriteriaV9): Promise<CandlestickResponse> {
    const r = value as CandlestickResponse, hex = /^[a-f0-9]{64}$/;
    if (!r || r.version !== 9 || r.formulaVersion !== CANDLESTICK_FORMULA_VERSION || r.capability !== CANDLESTICK_HISTORY_CAPABILITY
        || r.catalogVersion !== CANDLESTICK_CATALOG_VERSION || !['ready', 'pending', 'stale', 'unavailable'].includes(r.state)
        || typeof r.reason !== 'string' || typeof r.canUseResults !== 'boolean' || !Array.isArray(r.rows) || r.rows.length > 50
        || r.nextCursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(r.nextCursor)
        || r.state !== 'ready' && r.canUseResults) throw new Error('五型態回應版本或資料狀態無效');
    if (r.state === 'pending' || r.state === 'unavailable') {
        if (r.rows.length || r.canUseResults || r.snapshotId !== null) throw new Error('五型態待準備回應無效');
        return r;
    }
    if (!r.snapshotId || !/^[a-f0-9-]{36}$/.test(r.snapshotId) || !isIsoDate(r.effectiveSessionDate) || !isIsoDate(r.expectedSessionDate)
        || !hex.test(r.calendarHash ?? '') || !hex.test(r.rowsHash ?? '') || !hex.test(r.universeHash ?? '')
        || typeof r.sourceMappingVersion !== 'string' || !Array.isArray(r.sourceHashes) || !r.sourceHashes.length || r.sourceHashes.some(h => !hex.test(h))
        || new Set(r.rows.map(row => row.symbol)).size !== r.rows.length) throw new Error('五型態來源證據無效');
    if (r.counts && (!validCounts(r.counts) || !r.byMarket || !validCounts(r.byMarket.TWSE) || !validCounts(r.byMarket.TPEx)
        || ['total', 'pass', 'fail', 'unknown'].some(k => r.counts![k as keyof CandlestickCounts] !== r.byMarket!.TWSE[k as keyof CandlestickCounts] + r.byMarket!.TPEx[k as keyof CandlestickCounts])))
        throw new Error('五型態母體計數不一致');
    if (criteria && !r.counts) throw new Error('五型態查詢缺少守恆計數');
    for (const row of r.rows) {
        if (row.ordinary !== true || !['TWSE', 'TPEx'].includes(row.market) || row.symbol !== `${row.code}.${row.market === 'TWSE' ? 'TW' : 'TWO'}`
            || !row.name || !['pass', 'fail', 'unknown'].includes(row.verdict) || row.history?.through !== r.effectiveSessionDate
            || row.history.calendarHash !== r.calendarHash || row.history.mappingVersion !== r.sourceMappingVersion
            || JSON.stringify(row.history.sourceHashes) !== JSON.stringify(r.sourceHashes)) throw new Error('五型態逐股證據無效');
        await validateCandlestickHistory(row.history);
        if (criteria && await technicalEvidenceHash(await evaluateCandlestickReversal(row.history, criteria.candlestickReversal)) !== await technicalEvidenceHash(row.outcome))
            throw new Error('五型態精確比較證據不一致');
    }
    return r;
}
