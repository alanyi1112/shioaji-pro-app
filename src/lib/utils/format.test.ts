import { describe, expect, it } from 'vitest';
import type { TickSizeContract } from './ticksize';
import {
    fmtContractPrice,
    fmtContractPriceChange,
    fmtContractSigned,
} from './format';
import { isTaiwanEtf, taiwanQuoteDigitsFor } from './ticksize';

function stock(
    code: string,
    category = '24',
    exchange: 'TSE' | 'OTC' = 'TSE',
): TickSizeContract {
    return {
        code,
        category,
        exchange,
        security_type: 'STK',
        target_code: null,
    };
}

describe('台股 contract-aware 報價格式', () => {
    it.each([
        [9.99, '9.99'],
        [10, '10.00'],
        [49.95, '49.95'],
        [50, '50.0'],
        [99.9, '99.9'],
        [100, '100.0'],
        [499.5, '499.5'],
        [500, '500'],
        [999, '999'],
        [1000, '1,000'],
        [2535, '2,535'],
    ])('普通股票 %s 顯示為 %s', (value, expected) => {
        expect(fmtContractPrice(stock('2330'), value)).toBe(expected);
    });

    it('ETF 在 50 元以上仍保留兩位小數', () => {
        const etf = stock('0050', '00');
        expect(fmtContractPrice(etf, 49.99)).toBe('49.99');
        expect(fmtContractPrice(etf, 50)).toBe('50.00');
        expect(fmtContractPrice(etf, 52.3)).toBe('52.30');
    });

    it('canonical category 可辨識上櫃及英文字尾 ETF', () => {
        expect(isTaiwanEtf(stock('00679B', '00', 'OTC'))).toBe(true);
        expect(isTaiwanEtf(stock('00981A', '00'))).toBe(true);
        expect(fmtContractPrice(stock('00981A', '00'), 28.5)).toBe('28.50');
    });

    it('已知非 ETF category 優先於代號 fallback', () => {
        const knownStock = stock('00999', '24');
        expect(isTaiwanEtf(knownStock)).toBe(false);
        expect(taiwanQuoteDigitsFor(knownStock, 52.3)).toBe(1);
        expect(fmtContractPrice(knownStock, 52.3)).toBe('52.3');
    });

    it('category 缺失時才以代號安全 fallback', () => {
        const fallback = stock('00981A', '');
        expect(isTaiwanEtf(fallback)).toBe(true);
        expect(fmtContractPrice(fallback, 28.5)).toBe('28.50');
    });

    it('漲跌價差使用昨收級距且正值保留正號', () => {
        const ordinary = stock('2301');
        expect(fmtContractPriceChange(ordinary, 24.5, 247)).toBe('24.5');
        expect(fmtContractSigned(ordinary, 24.5, 247)).toBe('+24.5');
        expect(fmtContractSigned(ordinary, -24.5, 247)).toBe('-24.5');

        const etf = stock('0050', '00');
        expect(fmtContractSigned(etf, 1.4, 102.85)).toBe('+1.40');
    });

    it('非台股 STK 沿用既有通用格式', () => {
        const us: TickSizeContract = {
            code: 'AAPL',
            exchange: null,
            security_type: 'STK',
            target_code: null,
        };
        expect(fmtContractPrice(us, 195.5)).toBe('195.50');
        expect(fmtContractSigned(us, 1.4, 194.1)).toBe('+1.40');
    });

    it('非法值顯示破折號', () => {
        expect(fmtContractPrice(stock('2330'), Number.NaN)).toBe('—');
        expect(fmtContractSigned(stock('2330'), Number.POSITIVE_INFINITY, 100)).toBe('—');
    });
});
