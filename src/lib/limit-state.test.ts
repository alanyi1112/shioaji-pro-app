import { describe, expect, it } from 'vitest';
import { quoteLimitState } from './limit-state';

describe('quoteLimitState', () => {
    it('以合法上下限價判定漲停、跌停與一般價', () => {
        expect(
            quoteLimitState({
                price: 271.5,
                limitUp: 271.5,
                limitDown: 222,
            }),
        ).toBe('up');
        expect(
            quoteLimitState({
                price: 222,
                limitUp: 271.5,
                limitDown: 222,
            }),
        ).toBe('down');
        expect(
            quoteLimitState({
                price: 246.5,
                limitUp: 271.5,
                limitDown: 222,
            }),
        ).toBeNull();
    });

    it('容忍資料超界但不依漲跌幅推測', () => {
        expect(
            quoteLimitState({
                price: 272,
                limitUp: 271.5,
                limitDown: 222,
            }),
        ).toBe('up');
        expect(
            quoteLimitState({
                price: 221.5,
                limitUp: 271.5,
                limitDown: 222,
            }),
        ).toBe('down');
        expect(
            quoteLimitState({
                price: 271,
                limitUp: 271.5,
                limitDown: 222,
            }),
        ).toBeNull();
    });

    it('上下限價各自獨立驗證', () => {
        expect(
            quoteLimitState({
                price: 222,
                limitUp: 0,
                limitDown: 222,
            }),
        ).toBe('down');
        expect(
            quoteLimitState({
                price: 271.5,
                limitUp: 271.5,
                limitDown: Number.NaN,
            }),
        ).toBe('up');
    });

    it.each([
        undefined,
        null,
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ])('price=%s 時 fail-closed', (price) => {
        expect(
            quoteLimitState({
                price,
                limitUp: 271.5,
                limitDown: 222,
            }),
        ).toBeNull();
    });

    it('上下限價無效或商品為指數時 fail-closed', () => {
        expect(
            quoteLimitState({
                price: 271.5,
                limitUp: Number.NaN,
                limitDown: 0,
            }),
        ).toBeNull();
        expect(
            quoteLimitState({
                price: 271.5,
                limitUp: 271.5,
                limitDown: 222,
                isIndex: true,
            }),
        ).toBeNull();
    });
});
