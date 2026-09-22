import type { CriteriaV6 } from './stock-screener-v6';

export const STOCK_SCREENER_CONDITION_GROUPS = [
    { id: 'basic', label: '基本條件' },
    { id: 'technical', label: '技術型態' },
    { id: 'chip', label: '籌碼／價量' },
] as const;

export type StockScreenerConditionGroupId = typeof STOCK_SCREENER_CONDITION_GROUPS[number]['id'];

export const STOCK_SCREENER_CONDITIONS = [
    { id: 'volume', group: 'basic', label: '成交量 ≥ 前一交易日' },
    { id: 'holder', group: 'basic', label: '千張大戶' },
    { id: 'fractal', group: 'technical', label: 'K 棒分型' },
    { id: 'bollReversal', group: 'technical', label: '布林通道反轉 K' },
    { id: 'ma', group: 'technical', label: '均線糾結與交叉' },
    { id: 'divergence', group: 'technical', label: '價與指標背離' },
    { id: 'closeHigh', group: 'technical', label: '收盤價創近期新高' },
    { id: 'closeSmaBreakout', group: 'technical', label: '收盤價向上突破 SMA' },
    { id: 'largeHolderTrend', group: 'chip', label: '千張大戶比例區間且連續上升' },
    { id: 'largeHolderConcentration', group: 'chip', label: '千張大戶人數下降且持股股數增加' },
    { id: 'retailHolderDecline', group: 'chip', label: '10 張以下散戶持股比例下降' },
    { id: 'trustOwnership', group: 'chip', label: '投信累計買超占已發行普通股數' },
    { id: 'priceMargin', group: 'chip', label: '股價上漲且融資餘額下降或持平' },
    { id: 'shortMarginRatio', group: 'chip', label: '券資比達門檻' },
    { id: 'foreignReversal', group: 'chip', label: '外資連賣後轉買＋爆量換手' },
    { id: 'trustReversal', group: 'chip', label: '投信連賣後轉買＋爆量換手' },
] as const satisfies readonly { id: Exclude<keyof CriteriaV6, 'mode'>; group: StockScreenerConditionGroupId; label: string }[];

export type StockScreenerConditionId = typeof STOCK_SCREENER_CONDITIONS[number]['id'];

const holderModes = {
    'weekly-increase': '單週增加',
    'decrease-to-increase': '由減轉增',
    'increase-to-decrease': '由增轉減',
} as const;
const fractalAlgorithms = { 'raw-three': '原始三 K', 'chan-containment': '纏論包含', any: '任一算法' } as const;
const fractalDirections = { bottom: '底分型', top: '頂分型', any: '任一方向' } as const;
const bollModes = { 'lower-bullish': '下軌陽 K＋下影', 'upper-bearish': '上軌陰 K＋上影', any: '任一型態' } as const;
const maModes = {
    'bullish-preparation': '多頭準備突破', 'golden-cross': '黃金交叉',
    'bearish-preparation': '空頭準備跌破', 'death-cross': '死亡交叉',
    'any-bullish': '任一多頭訊號', 'any-bearish': '任一空頭訊號',
} as const;
const divergenceSources = {
    obv: 'OBV', rsi5: 'RSI5', rsi10: 'RSI10', 'kd-k': 'KD-K',
    'macd-line': 'MACD line', 'macd-histogram': 'MACD 能量柱',
} as const;
const divergenceDirections = { bullish: '底背離', bearish: '頂背離', any: '任一方向' } as const;

export function isStockScreenerConditionEnabled(criteria: CriteriaV6, id: StockScreenerConditionId): boolean {
    return criteria[id].enabled;
}

export function stockScreenerConditionSummary(criteria: CriteriaV6, id: StockScreenerConditionId): string {
    switch (id) {
        case 'volume': return `${criteria.volume.threshold} 倍${criteria.volume.turnover.enabled ? ` · 成交值 ${criteria.volume.turnover.minimumWan} 萬` : ''}`;
        case 'holder': return `${holderModes[criteria.holder.mode]}${criteria.holder.mode === 'weekly-increase' ? '' : ` ${criteria.holder.streakWeeks} 週`} · ${criteria.holder.threshold} 百分點${criteria.holder.turnover.enabled ? ` · 成交值 ${criteria.holder.turnover.minimumWan} 萬` : ''}`;
        case 'fractal': return `${fractalAlgorithms[criteria.fractal.algorithm]} · ${fractalDirections[criteria.fractal.direction]}`;
        case 'bollReversal': return bollModes[criteria.bollReversal.mode];
        case 'ma': return `${maModes[criteria.ma.mode]} · ${criteria.ma.compressionDays} 日 · ${criteria.ma.maxSpreadPct}%`;
        case 'divergence': return `${divergenceSources[criteria.divergence.source]} · ${divergenceDirections[criteria.divergence.direction]}${criteria.divergence.source === 'macd-histogram' && criteria.divergence.requireZeroReset ? ' · 零軸重置' : ''}`;
        case 'closeHigh': return `近 ${criteria.closeHigh.days} 日`;
        case 'closeSmaBreakout': return `SMA${criteria.closeSmaBreakout.period}`;
        case 'largeHolderTrend': return `${criteria.largeHolderTrend.minimumRatioPct}–${criteria.largeHolderTrend.maximumRatioPct}% · ${criteria.largeHolderTrend.weeks} 週`;
        case 'largeHolderConcentration': return `連續 ${criteria.largeHolderConcentration.weeks} 週`;
        case 'retailHolderDecline': return `連續 ${criteria.retailHolderDecline.weeks} 週`;
        case 'trustOwnership': return `${criteria.trustOwnership.days} 日 · ${criteria.trustOwnership.minimumPct}%`;
        case 'priceMargin': return `比較 ${criteria.priceMargin.days} 日前`;
        case 'shortMarginRatio': return `至少 ${criteria.shortMarginRatio.minimumPct}%`;
        case 'foreignReversal': return `前 ${criteria.foreignReversal.sellStreakDays} 日連賣 · 今日 > ${criteria.foreignReversal.todayNetBuyMinimumLots} 張 · 週轉 > ${criteria.foreignReversal.turnoverMultiple}×`;
        case 'trustReversal': return `前 ${criteria.trustReversal.sellStreakDays} 日連賣 · 今日 > ${criteria.trustReversal.todayNetBuyMinimumLots} 張 · 回補 ≥ ${criteria.trustReversal.minimumRecoveryPct}%`;
    }
}

export function firstEnabledStockScreenerCondition(criteria: CriteriaV6): StockScreenerConditionId {
    return STOCK_SCREENER_CONDITIONS.find(({ id }) => isStockScreenerConditionEnabled(criteria, id))?.id ?? 'volume';
}

export function stockScreenerConditionGroup(id: StockScreenerConditionId): StockScreenerConditionGroupId {
    return STOCK_SCREENER_CONDITIONS.find((condition) => condition.id === id)!.group;
}

export function enabledStockScreenerConditions(criteria: CriteriaV6) {
    return STOCK_SCREENER_CONDITIONS.filter(({ id }) => isStockScreenerConditionEnabled(criteria, id));
}

export function setStockScreenerConditionEnabled(criteria: CriteriaV6, id: StockScreenerConditionId, enabled: boolean): CriteriaV6 {
    return { ...criteria, [id]: { ...criteria[id], enabled } } as CriteriaV6;
}

export function disableAllStockScreenerConditions(criteria: CriteriaV6): CriteriaV6 {
    return {
        ...criteria,
        volume: { ...criteria.volume, enabled: false, turnover: { ...criteria.volume.turnover } },
        holder: { ...criteria.holder, enabled: false, turnover: { ...criteria.holder.turnover } },
        fractal: { ...criteria.fractal, enabled: false },
        bollReversal: { ...criteria.bollReversal, enabled: false },
        ma: { ...criteria.ma, enabled: false },
        divergence: { ...criteria.divergence, enabled: false },
        closeHigh: { ...criteria.closeHigh, enabled: false },
        closeSmaBreakout: { ...criteria.closeSmaBreakout, enabled: false },
        largeHolderTrend: { ...criteria.largeHolderTrend, enabled: false },
        largeHolderConcentration: { ...criteria.largeHolderConcentration, enabled: false },
        retailHolderDecline: { ...criteria.retailHolderDecline, enabled: false },
        trustOwnership: { ...criteria.trustOwnership, enabled: false },
        priceMargin: { ...criteria.priceMargin, enabled: false },
        shortMarginRatio: { ...criteria.shortMarginRatio, enabled: false },
        foreignReversal: { ...criteria.foreignReversal, enabled: false },
        trustReversal: { ...criteria.trustReversal, enabled: false },
    };
}
