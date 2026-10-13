import { describe, expect, it } from 'vitest';
import { LONG_SCREENER_QUERY_TIMEOUT_MS, screenerQueryHttpError } from './stock-screener-query-status';

describe('選股查詢錯誤與資料日期分開', () => {
    it.each(['bollinger', 'candlestick'] as const)('%s 逾時不是日期過期', family => {
        const message = screenerQueryHttpError(family, 503, { reason: 'query_timeout' });
        expect(message).toContain('查詢逾時');
        expect(message).toContain('不代表資料日期過期');
    });
    it.each([
        ['response_too_large', '安全大小'], ['invalid_service_response', '格式無效'],
        ['local_data_service_unavailable', '無法連線'], ['history_pending', '歷史資料尚未備齊'],
        ['source_attempts_exhausted', '重試已耗盡'], ['invalid_query', '參數無效'],
    ])('%s 映射具體原因', (reason, text) => expect(screenerQueryHttpError('bollinger', 503, { reason })).toContain(text));
    it('409 提示重查；未知原因不外洩原文', () => {
        expect(screenerQueryHttpError('candlestick', 409, {})).toContain('快照或分頁設定已更新');
        for (const value of [null, { reason: '<script>private detail</script>' }, { reason: 'unknown_secret_value' }, { reason: ['query_timeout'] }]) {
            expect(screenerQueryHttpError('bollinger', 503, value)).toBe('布林查詢失敗（HTTP 503），資料日期尚未確認');
        }
        expect(screenerQueryHttpError('bollinger', 503, { reason: 'toString' })).toContain('HTTP 503');
    });
    it('前端有界期限保留代理收尾餘裕', () => expect(LONG_SCREENER_QUERY_TIMEOUT_MS).toBe(25000));
});
