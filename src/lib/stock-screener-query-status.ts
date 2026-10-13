export type ScreenerQueryFamily = 'legacy' | 'bollinger' | 'candlestick';
export const LONG_SCREENER_QUERY_TIMEOUT_MS = 25000;
export const screenerQueryLabel = (family: ScreenerQueryFamily) => family === 'bollinger' ? '布林' : family === 'candlestick' ? '五型態' : '一般選股';

/** 僅映射已知原因，不把任意來源訊息（或秘密值）直接顯示到 UI。 */
export function screenerQueryHttpError(family: ScreenerQueryFamily, status: number, value: unknown): string {
    const label = screenerQueryLabel(family);
    const reason = value && typeof value === 'object' && 'reason' in value ? value.reason : undefined;
    if (status === 409) return `${label}快照或分頁設定已更新，請重新篩選`;
    const messages: Record<string, string> = {
        query_timeout: '查詢逾時；不代表資料日期過期，請稍後重新篩選',
        local_data_service_unavailable: '本機選股資料服務無法連線，請稍後重試',
        response_too_large: '回應超過安全大小限制，請稍後重試',
        invalid_service_response: '本機資料服務回應格式無效，請稍後重試',
        invalid_query: '篩選參數無效，請檢查條件後重新篩選',
        invalid_v9_query: '篩選參數無效，請檢查條件後重新篩選',
        schema_pending: '資料庫尚未準備完成，請等待背景更新',
        v9_schema_pending: '資料庫尚未準備完成，請等待背景更新',
        v8_preparation_pending: '尚未發布布林資料，請等待背景更新',
        v9_preparation_pending: '尚未發布五型態資料，請等待背景更新',
        history_pending: '必要歷史資料尚未備齊，請查看該篩選的資料狀態',
        new_session_pending: '當日資料尚未發布；不以其他篩選的日期代替',
        source_contract_pending: '來源契約尚待驗證，未啟用正式資料準備',
        source_attempts_exhausted: '來源重試已耗盡，須處理來源缺口',
    };
    return typeof reason === 'string' && Object.hasOwn(messages, reason)
        ? `${label}${messages[reason]}` : `${label}查詢失敗（HTTP ${status}），資料日期尚未確認`;
}
