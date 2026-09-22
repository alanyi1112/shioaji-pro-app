import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA_V5, LONG_TERM_LAYOUT_PRESET } from './stock-screener-v5';
import { migrateCriteriaV5ToV6 } from './stock-screener-v6';
import {
    STOCK_SCREENER_CONDITIONS, STOCK_SCREENER_CONDITION_GROUPS,
    disableAllStockScreenerConditions, enabledStockScreenerConditions,
    firstEnabledStockScreenerCondition, setStockScreenerConditionEnabled,
    stockScreenerConditionGroup, stockScreenerConditionSummary,
} from './stock-screener-condition-ui';

describe('stock screener condition UI model', () => {
    it('固定涵蓋 16 個條件與三個群組', () => {
        expect(STOCK_SCREENER_CONDITIONS.map(({ id }) => id)).toEqual([
            'volume', 'holder', 'fractal', 'bollReversal', 'ma', 'divergence', 'closeHigh', 'closeSmaBreakout',
            'largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership', 'priceMargin', 'shortMarginRatio',
            'foreignReversal', 'trustReversal',
        ]);
        expect(STOCK_SCREENER_CONDITION_GROUPS.map(({ id }) => id)).toEqual(['basic', 'technical', 'chip']);
        expect(new Set(STOCK_SCREENER_CONDITIONS.map(({ id }) => id)).size).toBe(16);
    });

    it('選擇第一個啟用條件，全部停用時回到成交量', () => {
        expect(firstEnabledStockScreenerCondition(migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5))).toBe('volume');
        expect(firstEnabledStockScreenerCondition(migrateCriteriaV5ToV6(LONG_TERM_LAYOUT_PRESET))).toBe('largeHolderTrend');
        expect(firstEnabledStockScreenerCondition(disableAllStockScreenerConditions(migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5)))).toBe('volume');
        expect(stockScreenerConditionGroup('largeHolderTrend')).toBe('chip');
    });

    it('摘要只讀取目前參數', () => {
        const criteria = {
            ...migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5),
            volume: { ...DEFAULT_CRITERIA_V5.volume, threshold: '4.25', turnover: { enabled: true, minimumWan: '888' } },
            divergence: { ...DEFAULT_CRITERIA_V5.divergence, source: 'kd-k' as const, direction: 'bullish' as const },
        };
        expect(stockScreenerConditionSummary(criteria, 'volume')).toBe('4.25 倍 · 成交值 888 萬');
        expect(stockScreenerConditionSummary(criteria, 'divergence')).toBe('KD-K · 底背離');
        expect(criteria.volume.threshold).toBe('4.25');
    });

    it('全部取消保留每個參數與子設定且不修改輸入', () => {
        const original = {
            ...migrateCriteriaV5ToV6(LONG_TERM_LAYOUT_PRESET),
            volume: { ...LONG_TERM_LAYOUT_PRESET.volume, enabled: true, threshold: '6', turnover: { enabled: true, minimumWan: '321' } },
            divergence: { ...LONG_TERM_LAYOUT_PRESET.divergence, enabled: true, requireZeroReset: true },
        };
        const cleared = disableAllStockScreenerConditions(original);
        expect(enabledStockScreenerConditions(cleared)).toHaveLength(0);
        expect(cleared.volume).toMatchObject({ enabled: false, threshold: '6', turnover: { enabled: true, minimumWan: '321' } });
        expect(cleared.divergence).toMatchObject({ enabled: false, requireZeroReset: true });
        expect(original.volume.enabled).toBe(true);
        expect(original.divergence.enabled).toBe(true);
        expect(cleared.volume).not.toBe(original.volume);
        expect(cleared.volume.turnover).not.toBe(original.volume.turnover);
    });

    it('單一 enabled 更新不會改寫其他參數', () => {
        const criteria = migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5);
        const updated = setStockScreenerConditionEnabled(criteria, 'divergence', true);
        expect(updated.divergence).toEqual({ ...DEFAULT_CRITERIA_V5.divergence, enabled: true });
        expect(updated.volume).toBe(criteria.volume);
        expect(DEFAULT_CRITERIA_V5.divergence.enabled).toBe(false);
    });

    it('法人條件位於籌碼價量且全部取消保留參數', () => {
        let criteria = migrateCriteriaV5ToV6(DEFAULT_CRITERIA_V5);
        criteria = setStockScreenerConditionEnabled(criteria, 'foreignReversal', true);
        criteria = setStockScreenerConditionEnabled(criteria, 'trustReversal', true);
        expect(stockScreenerConditionGroup('foreignReversal')).toBe('chip');
        expect(stockScreenerConditionSummary(criteria, 'trustReversal')).toContain('回補 ≥ 50%');
        const cleared = disableAllStockScreenerConditions(criteria);
        expect(cleared.foreignReversal.enabled).toBe(false);
        expect(cleared.foreignReversal.todayNetBuyMinimumLots).toBe('1000');
        expect(cleared.trustReversal.todayNetBuyMinimumLots).toBe('500');
    });
});
