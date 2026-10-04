import { expect, it, vi } from 'vitest';
import { queryCandlestickSnapshot, type CandlestickSnapshot } from './stock-screener-candlestick-query.ts';
import { buildCandlestickHistory } from './stock-screener-candlestick.ts';
import { DEFAULT_CANDLESTICK_REVERSAL, migrateCriteriaV8ToV9, type CriteriaV9 } from './stock-screener-v9.ts';
import { DEFAULT_CRITERIA_V7 } from './stock-screener-v7.ts';
import { migrateCriteriaV7ToV8 } from './stock-screener-v8.ts';
import { technicalEvidenceHash } from './stock-screener-technical-patterns.ts';
// 隔離唯讀查詢 fixture，不代表真實發布／官方 session 證據。
async function fixture() {
    const dates = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-29', '2026-09-30'];
    const closes = [140, 130, 120, 110, 100, 80, 91];
    const bars = dates.map((sessionDate, i) => ({ sessionDate, open: String(i < 5 ? closes[i]! - 1 : i === 5 ? 100 : 80),
        high: String(i === 5 ? 101 : i === 6 ? 92 : closes[i]! + 1), low: String(i < 5 ? closes[i]! - 2 : 79), close: String(closes[i]), volumeShares: '1000000' }));
    const history = await buildCandlestickHistory(bars, dates, { mappingVersion: 'fixture', calendarHash: 'a'.repeat(64), sourceHashes: ['b'.repeat(64)], completedThrough: dates.at(-1)! });
    const rows = [{ symbol: '1111.TW', code: '1111', name: 'fixture1', market: 'TWSE', ordinary: true, history },
        { symbol: '1111.TWO', code: '1111', name: 'fixture2', market: 'TPEx', ordinary: true, history },
        { symbol: '2222.TW', code: '2222', name: 'fixture3', market: 'TWSE', ordinary: true, history }] as CandlestickSnapshot['rows'];
    const c: CriteriaV9 = migrateCriteriaV8ToV9(migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7));
    for (const v of Object.values(c)) if (v && typeof v === 'object' && 'enabled' in v) v.enabled = false;
    c.candlestickReversal = { ...structuredClone(DEFAULT_CANDLESTICK_REVERSAL), enabled: true, patterns: ['piercing'] };
    return { snapshot: { id: 'fixture-snapshot', through: dates.at(-1)!, universeRevision: 'fixture', universeHash: 'a'.repeat(64), rowsHash: await technicalEvidenceHash(rows), rows },
        query: { criteria: c, direction: 'asc' as const, resultState: 'pass' as const, limit: 1 } };
}
it('穩定同代碼 tie-break、全頁去重、各市場與總母體守恆，不改底稿／草稿', async () => {
    const { snapshot, query } = await fixture(), before = JSON.stringify({ snapshot, query });
    const all = [], first = await queryCandlestickSnapshot(snapshot, query); let page = first;
    all.push(...page.rows.map(r => r.symbol));
    while (page.nextCursor) { page = await queryCandlestickSnapshot(snapshot, { ...query, cursor: page.nextCursor }); all.push(...page.rows.map(r => r.symbol)); }
    expect(all).toEqual(['1111.TW', '1111.TWO', '2222.TW']);
    expect(first.counts).toEqual({ total: 3, pass: 3, fail: 0, unknown: 0 });
    expect(first.byMarket.TWSE.total + first.byMarket.TPEx.total).toBe(first.counts.total);
    expect(JSON.stringify({ snapshot, query })).toBe(before);
});
it('游標綁快照、日期、rowsHash、active 條件／排序／limit／結果／join', async () => {
    const { snapshot, query } = await fixture(), first = await queryCandlestickSnapshot(snapshot, query);
    for (const patch of [{ direction: 'desc' }, { resultState: 'unknown' }, { limit: 2 }, { criteria: { ...query.criteria, candlestickReversal: { ...query.criteria.candlestickReversal, piercingRecoveryPct: '60' } } }]) {
        await expect(queryCandlestickSnapshot(snapshot, { ...query, ...patch, cursor: first.nextCursor! } as never)).rejects.toThrow('invalid_v9_cursor');
    }
    await expect(queryCandlestickSnapshot({ ...snapshot, id: 'new-id' }, { ...query, cursor: first.nextCursor! })).rejects.toThrow('invalid_v9_cursor');
    await expect(queryCandlestickSnapshot(snapshot, { ...query, cursor: first.nextCursor! }, { fingerprint: 'different' })).rejects.toThrow('invalid_v9_cursor');
});
it('舊分支缺檔保留 unknown；OR 可由純價量 pass，AND 不得把缺檔當 fail', async () => {
    const { snapshot, query } = await fixture(), combination = { fingerprint: 'legacy-pending', legacy: {} };
    const and = await queryCandlestickSnapshot(snapshot, { ...query, resultState: 'unknown' }, combination);
    expect(and.counts.unknown).toBe(3);
    const or = await queryCandlestickSnapshot(snapshot, { ...query, criteria: { ...query.criteria, mode: 'any' } }, combination);
    expect(or.counts.pass).toBe(3);
});
it('拒絕改動 rowsHash／跨日資料及非法游標', async () => {
    const { snapshot, query } = await fixture(), clone = structuredClone(snapshot); clone.rows[0]!.name = 'changed';
    await expect(queryCandlestickSnapshot(clone, query)).rejects.toThrow('invalid_v9_snapshot');
    await expect(queryCandlestickSnapshot({ ...snapshot, through: '2026-10-02' }, query)).rejects.toThrow('invalid_v9_snapshot');
    await expect(queryCandlestickSnapshot(snapshot, { ...query, cursor: 'invalid' })).rejects.toThrow('invalid_v9_cursor');
});
it('核心查詢／分頁沒有 fetch，不寫入每日 profile、偏好或清單', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network_forbidden'); });
    try {
        const { snapshot, query } = await fixture(), first = await queryCandlestickSnapshot(snapshot, query);
        await queryCandlestickSnapshot(snapshot, { ...query, cursor: first.nextCursor! });
        expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
});
