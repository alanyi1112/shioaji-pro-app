/** 週資料條件不以未選用的日量／技術更新狀態阻擋；成交值附加條件仍需要日資料。 */
export function screenerRequiresDailyData(criteria: Record<string, unknown>) {
    return Object.entries(criteria).some(([key, value]) => {
        if (!value || typeof value !== 'object' || !('enabled' in value) || !value.enabled) return false;
        if (['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline'].includes(key)) return false;
        if (key === 'holder') return 'turnover' in value && !!value.turnover && typeof value.turnover === 'object'
            && 'enabled' in value.turnover && value.turnover.enabled === true;
        return true;
    });
}
