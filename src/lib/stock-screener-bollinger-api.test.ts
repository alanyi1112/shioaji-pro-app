import { describe, expect, it } from 'vitest';
import { BOLLINGER_PREFS, bollingerSearch, decodeBollingerResponse, loadBollingerPreference, type BollingerQueryDraft } from './stock-screener-bollinger-api';
import { DEFAULT_CRITERIA_V7 } from './stock-screener-v7';
import { migrateCriteriaV7ToV8, SCREENER_V8_FORMULA_VERSION, SCREENER_V8_MAPPING_VERSION } from './stock-screener-v8';
const criteria = migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7); criteria.bollSqueezeStages.enabled = true;
const query: BollingerQueryDraft = { criteria, sort: 'bbw', direction: 'asc', resultState: 'matched' };
const count = { total: 0, compressing: 0, preparing: 0, breakout: 0, unknown: 0, notMatched: 0 };
const pending = { version: 8, state: 'pending', formulaVersion: SCREENER_V8_FORMULA_VERSION, sourceMappingVersion: SCREENER_V8_MAPPING_VERSION,
    snapshotId: null, expectedSessionDate: '2026-10-02', effectiveSessionDate: null, rows: [], nextCursor: null };
describe('v8 查詢與偏好只讀隔離', () => {
    it('分類切換和 cursor 都可以綁同一 snapshot，沒有每日儲存或來源參數', () => {
        const params = new URLSearchParams(bollingerSearch({ ...query, stage: 'unknown', resultState: 'all' }, undefined, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
        expect(params.get('snapshotId')).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
        expect(params.get('stage')).toBe('unknown'); expect(params.has('cursor')).toBe(false);
        expect(params.has('profileRevision')).toBe(false); expect(params.has('fetch')).toBe(false);
        expect(() => bollingerSearch({ ...query, criteria: { ...criteria, bollSqueezeStages: { ...criteria.bollSqueezeStages, enabled: false } } })).toThrow();
    });
    it('有效 v8 儲存查詢，非法／舊／半份設定拒絕，不修改 storage', () => {
        const storage = (value: unknown) => ({ getItem: (key: string) => key === BOLLINGER_PREFS ? JSON.stringify(value) : null });
        expect(loadBollingerPreference(storage({ version: 8, query }))).toEqual(query);
        expect(loadBollingerPreference(storage({ version: 7, query }))).toBeNull();
        expect(loadBollingerPreference(storage({ version: 8, query: { ...query, stage: 'invented' } }))).toBeNull();
        expect(loadBollingerPreference(storage({ version: 8, query: { ...query, criteria: {} } }))).toBeNull();
    });
    it('pending 不冒充 ready；日期／版本／分類總數與雙市場守恆皆驗證', () => {
        expect(decodeBollingerResponse(pending).state).toBe('pending');
        expect(decodeBollingerResponse({ ...pending, counts: { total: count, markets: { TWSE: count, TPEx: count } } }).counts?.total.total).toBe(0);
        for (const bad of [{ ...pending, expectedSessionDate: '2026-02-30' }, { ...pending, formulaVersion: 'old' },
            { ...pending, state: 'ready' }, { ...pending, canUseResults: true },
            { ...pending, counts: { total: { ...count, total: 1 }, markets: { TWSE: count, TPEx: count } } },
            { ...pending, combinationCounts: { total: 2, matched: 1, notMatched: 0, unknown: 0 } }]) expect(() => decodeBollingerResponse(bad)).toThrow();
    });
});
