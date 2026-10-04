import { expect, it } from 'vitest';
import { candlestickSearch, decodeCandlestickResponse, loadCandlestickPreference } from './stock-screener-candlestick-api';
import { DEFAULT_CRITERIA_V7 } from './stock-screener-v7';
import { migrateCriteriaV7ToV8 } from './stock-screener-v8';
import { migrateCriteriaV8ToV9, CANDLESTICK_FORMULA_VERSION, CANDLESTICK_HISTORY_CAPABILITY } from './stock-screener-v9';
import { CANDLESTICK_CATALOG_VERSION } from './stock-screener-candlestick-catalog';
const c = migrateCriteriaV8ToV9(migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7));
c.candlestickReversal.enabled = true;
const q = { criteria: c, sort: 'volumeMultiple' as const, direction: 'asc' as const, resultState: 'pass' as const };
const pending = { version: 9, state: 'pending', reason: 'v9_schema_pending', canUseResults: false, snapshotId: null,
    formulaVersion: CANDLESTICK_FORMULA_VERSION, capability: CANDLESTICK_HISTORY_CAPABILITY, catalogVersion: CANDLESTICK_CATALOG_VERSION,
    rows: [], counts: null, nextCursor: null };
it('新偏好精確驗證／clone，非法或未知版本原文不覆寫', () => {
    const raw = JSON.stringify({ version: 9, query: q });
    const loaded = loadCandlestickPreference({ getItem: () => raw });
    expect(loaded).toEqual(q); expect(loaded?.criteria).not.toBe(c);
    for (const p of [{ version: 10, query: q }, { version: 9, query: { ...q, criteria: { ...c, unexpected: true } } }, 'invalid']) {
        expect(loadCandlestickPreference({ getItem: () => JSON.stringify(p) })).toBeNull();
    }
});
it('v9 query 固定股票代碼排序、上限50、保留 cursor 與 snapshot pin，不修改草稿', () => {
    const before = JSON.stringify(q), p = new URLSearchParams(candlestickSearch(q, 'cursor', 'snapshot'));
    expect(p.get('sort')).toBe('code'); expect(p.get('limit')).toBe('50'); expect(p.get('snapshotId')).toBe('snapshot');
    expect(JSON.stringify(q)).toBe(before);
});
it('pending 保留狀態且不可操作，拒絕未知能力或待準備假結果', async () => {
    expect(await decodeCandlestickResponse(pending)).toEqual(pending);
    for (const patch of [{ capability: 'close-only' }, { canUseResults: true }, { snapshotId: 'fake' }, { rows: [{}] }]) {
        await expect(decodeCandlestickResponse({ ...pending, ...patch })).rejects.toThrow();
    }
});
