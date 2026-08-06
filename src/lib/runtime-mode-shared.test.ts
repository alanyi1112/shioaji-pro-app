import { describe, expect, it } from 'vitest';
import {
    TRADING_WRITE_PATHS,
    isTradingWriteRequest,
    normalizeRuntimeMode,
} from './runtime-mode-shared';

describe('runtime mode', () => {
    it('只接受已知的安全模式名稱', () => {
        expect(normalizeRuntimeMode('simulation')).toBe('simulation');
        expect(normalizeRuntimeMode('production-readonly')).toBe(
            'production-readonly',
        );
        expect(normalizeRuntimeMode('production')).toBe('unknown');
        expect(normalizeRuntimeMode(undefined)).toBe('unknown');
    });

    it('阻擋所有已知交易寫入路徑', () => {
        expect(TRADING_WRITE_PATHS.size).toBe(6);
        for (const pathname of TRADING_WRITE_PATHS) {
            expect(isTradingWriteRequest(pathname, 'POST')).toBe(true);
        }
    });

    it('允許委託與組合委託查詢', () => {
        expect(isTradingWriteRequest('/api/v1/order/trades', 'POST')).toBe(
            false,
        );
        expect(
            isTradingWriteRequest('/api/v1/order/combotrades', 'POST'),
        ).toBe(false);
    });

    it('不把唯讀 GET 視為交易寫入', () => {
        expect(isTradingWriteRequest('/api/v1/order/place_order', 'GET')).toBe(
            false,
        );
    });
});
