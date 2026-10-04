import { describe, expect, it, vi } from 'vitest';
import {
    openIntradayStockSelectionWindow,
    resolveIntradayStockSelectionUrl,
} from './intraday-stock-selection-window';

describe('盤中選股獨立工作區視窗', () => {
    it('只解析固定 loopback 5173 的專用 layout URL', () => {
        expect(resolveIntradayStockSelectionUrl('http://localhost:5173')).toBe(
            'http://localhost:5173/?layout=intraday-stock-selection',
        );
        expect(resolveIntradayStockSelectionUrl('https://hosted.example')).toBe(
            'http://127.0.0.1:5173/?layout=intraday-stock-selection',
        );
    });

    it('同步呼叫 window.open 並使用 noopener', () => {
        const target = { open: vi.fn(() => ({}) as Window) };
        expect(
            openIntradayStockSelectionWindow(
                target,
                'http://127.0.0.1:5173',
            ),
        ).toEqual({});
        expect(target.open).toHaveBeenCalledWith(
            'http://127.0.0.1:5173/?layout=intraday-stock-selection',
            '_blank',
            'noopener',
        );
    });
});
