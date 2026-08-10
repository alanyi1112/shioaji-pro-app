import { describe, expect, it } from 'vitest';
import { scannerItemToSnapshot } from './quote-selection';
import type { ScannerItem } from './types/market';

const scannerItem: ScannerItem = {
    code: '2103',
    name: '台橡',
    date: '2026-08-10',
    close: 27.5,
    open: 25,
    high: 27.5,
    low: 25,
    change_price: 2.5,
    change_type: 1,
    average_price: 26.4,
    price_range: 2.5,
    rank_value: 10,
    total_volume: 24611,
    total_amount: 660000000,
    volume_ratio: 2,
    yesterday_volume: 12000,
    tick_type: 1,
    buy_price: 27.5,
    sell_price: 0,
};

describe('非自選報價選取 snapshot', () => {
    it('保留排行榜點擊當下的最新價、漲跌與市場', () => {
        const snapshot = scannerItemToSnapshot(scannerItem, 'TSE');

        expect(snapshot).toMatchObject({
            code: '2103',
            exchange: 'TSE',
            close: 27.5,
            change_price: 2.5,
            change_rate: 10,
            total_volume: 24611,
        });
    });

    it('參考價無效時不補造漲跌幅', () => {
        const snapshot = scannerItemToSnapshot(
            { ...scannerItem, close: 2.5, change_price: 2.5 },
            'OTC',
        );

        expect(snapshot.exchange).toBe('OTC');
        expect(snapshot.change_rate).toBe(0);
    });
});
