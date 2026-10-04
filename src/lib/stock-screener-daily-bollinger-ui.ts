import { DEFAULT_CRITERIA_V7 } from './stock-screener-v7';
import { disableAllStockScreenerConditions } from './stock-screener-condition-ui';
import { BOLLINGER_STAGES, DEFAULT_BOLLINGER_SQUEEZE, type CriteriaV8 } from './stock-screener-v8';
import type { BollingerDailyProfileView } from './stock-screener-bollinger-api';

/** 每日草稿不讀取手動查詢草稿；不得在初始化時寫入正式設定。 */
export function dailyBollingerCriteria(profile: BollingerDailyProfileView | null): CriteriaV8 {
    const criteria = profile ? structuredClone(profile.criteria) : {
        ...disableAllStockScreenerConditions(structuredClone(DEFAULT_CRITERIA_V7)),
        bollSqueezeStages: { ...structuredClone(DEFAULT_BOLLINGER_SQUEEZE), enabled: true, stages: [...BOLLINGER_STAGES] },
    };
    criteria.bollSqueezeStages.enabled = true;
    return criteria;
}

export function dailyBollingerSaveError(status: number, reason?: string): string {
    if (status === 409) return '每日設定已被其他視窗更新，請重新載入後確認；未覆寫原設定。';
    if (status === 403) return '每日設定儲存遭本機安全檢查拒絕；請從本機選股頁操作，原設定未變。';
    if (reason === 'invalid_daily_profile' || reason === 'invalid_json' || reason === 'invalid_query') return '每日設定格式或參數無效；請檢查至少選一階段與數值範圍，原設定未變。';
    if (status === 503) return '每日設定服務尚未就緒；請稍後重試，原設定未變。';
    if (status === 413) return '每日設定內容超過大小限制，原設定未變。';
    return `每日設定儲存失敗（HTTP ${status}）；原設定未變。`;
}
