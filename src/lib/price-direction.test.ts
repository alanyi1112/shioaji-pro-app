import { describe, expect, it } from 'vitest';
import { priceDirection } from './price-direction';

describe('priceDirection', () => {
    it('以有效參考價判斷上漲、下跌與平盤', () => {
        expect(priceDirection(199, 193)).toBe('up');
        expect(priceDirection(188.5, 193)).toBe('down');
        expect(priceDirection(193, 193)).toBe('flat');
    });

    it.each([
        undefined,
        null,
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ])('reference=%s 時保守回傳 flat', (reference) => {
        expect(priceDirection(199, reference)).toBe('flat');
    });

    it.each([
        undefined,
        null,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ])('value=%s 時保守回傳 flat', (value) => {
        expect(priceDirection(value, 193)).toBe('flat');
    });
});
