import { describe, expect, it } from 'vitest';
import {
    SmartOrderCalendarError,
    taipeiTradeDateFromEpochMilliseconds,
} from './smart-order-domain-calendar';
import {
    SMART_ORDER_TAIWAN_TICK_TABLE_REVISION,
    SmartOrderContractPriceError,
    canonicalTaiwanTickSize,
    isCanonicalTaiwanTickPrice,
    roundCanonicalTaiwanPrice,
    type CanonicalTaiwanSecurityCategory,
} from './smart-order-contract-price-domain';
import {
    SmartOrderMoneyError,
    commonLotValue,
    commonLots,
    commonLotsFromSharesExact,
    contractUnit,
    decimalString,
    shareValue,
    shares,
    sharesFromCommonLots,
} from './smart-order-domain-money';

function expectMoneyError(
    action: () => unknown,
    code: SmartOrderMoneyError['code'],
): void {
    try {
        action();
        throw new Error('expected SmartOrderMoneyError');
    } catch (error) {
        expect(error).toBeInstanceOf(SmartOrderMoneyError);
        expect((error as SmartOrderMoneyError).code).toBe(code);
    }
}

function expectCalendarError(
    action: () => unknown,
    code: SmartOrderCalendarError['code'],
): void {
    try {
        action();
        throw new Error('expected SmartOrderCalendarError');
    } catch (error) {
        expect(error).toBeInstanceOf(SmartOrderCalendarError);
        expect((error as SmartOrderCalendarError).code).toBe(code);
    }
}

describe('canonical TW stock and ETF tick tables', () => {
    const stockCases = [
        ['0.01', '0.01'],
        ['9.99', '0.01'],
        ['10', '0.05'],
        ['49.95', '0.05'],
        ['50', '0.1'],
        ['99.9', '0.1'],
        ['100', '0.5'],
        ['499.5', '0.5'],
        ['500', '1'],
        ['999', '1'],
        ['1000', '5'],
        ['1005', '5'],
    ] as const;

    const etfCases = [
        ['0.01', '0.01'],
        ['9.99', '0.01'],
        ['10', '0.01'],
        ['49.99', '0.01'],
        ['50', '0.05'],
        ['99.95', '0.05'],
        ['100', '0.05'],
        ['499.95', '0.05'],
        ['500', '0.05'],
        ['999.95', '0.05'],
        ['1000', '0.05'],
        ['1000.05', '0.05'],
    ] as const;

    it.each([
        ['stock', stockCases],
        ['etf', etfCases],
    ] as const)(
        'uses the exact %s table at 10/50/100/500/1000 boundaries',
        (category, cases) => {
            for (const [price, expectedTick] of cases) {
                expect(
                    canonicalTaiwanTickSize({
                        category,
                        price: decimalString(price),
                    }),
                    `${category} @ ${price}`,
                ).toBe(expectedTick);
            }
        },
    );

    it.each([
        ['stock', '9.999', '9.99', '10'],
        ['stock', '10.001', '10', '10.05'],
        ['stock', '49.99', '49.95', '50'],
        ['stock', '99.99', '99.9', '100'],
        ['stock', '499.9', '499.5', '500'],
        ['stock', '999.9', '999', '1000'],
        ['etf', '9.999', '9.99', '10'],
        ['etf', '49.999', '49.99', '50'],
        ['etf', '99.999', '99.95', '100'],
        ['etf', '499.999', '499.95', '500'],
        ['etf', '999.999', '999.95', '1000'],
    ] as const)(
        '%s directional rounding of %s is down=%s and up=%s',
        (category, theoreticalPrice, down, up) => {
            const downResult = roundCanonicalTaiwanPrice({
                category,
                theoreticalPrice: decimalString(theoreticalPrice),
                rounding: 'down',
            });
            const upResult = roundCanonicalTaiwanPrice({
                category,
                theoreticalPrice: decimalString(theoreticalPrice),
                rounding: 'up',
            });

            expect(downResult.roundedPrice).toBe(down);
            expect(upResult.roundedPrice).toBe(up);
            expect(downResult.tableRevision).toBe(
                SMART_ORDER_TAIWAN_TICK_TABLE_REVISION,
            );
            expect(
                isCanonicalTaiwanTickPrice({
                    category,
                    price: downResult.roundedPrice,
                }),
            ).toBe(true);
            expect(
                isCanonicalTaiwanTickPrice({
                    category,
                    price: upResult.roundedPrice,
                }),
            ).toBe(true);
            expect(downResult.tickSize).toBe(
                canonicalTaiwanTickSize({
                    category,
                    price: downResult.roundedPrice,
                }),
            );
            expect(upResult.tickSize).toBe(
                canonicalTaiwanTickSize({
                    category,
                    price: upResult.roundedPrice,
                }),
            );
        },
    );

    it('round-trips a generated legal grid without binary floating-point', () => {
        const grids: readonly (readonly [
            CanonicalTaiwanSecurityCategory,
            string,
            bigint,
            bigint,
            bigint,
        ])[] = [
            ['stock', '0.01', 1n, 999n, 37n],
            ['stock', '0.05', 200n, 999n, 31n],
            ['stock', '0.1', 500n, 999n, 29n],
            ['stock', '0.5', 200n, 999n, 23n],
            ['stock', '1', 500n, 999n, 19n],
            ['stock', '5', 200n, 260n, 7n],
            ['etf', '0.01', 1n, 4999n, 137n],
            ['etf', '0.05', 1000n, 20200n, 521n],
        ];

        for (const [category, tickText, first, last, step] of grids) {
            for (let ticks = first; ticks <= last; ticks += step) {
                const coefficient = BigInt(tickText.replace('.', ''));
                const scale = tickText.includes('.')
                    ? tickText.length - tickText.indexOf('.') - 1
                    : 0;
                const raw = (ticks * coefficient)
                    .toString()
                    .padStart(scale + 1, '0');
                const priceText =
                    scale === 0
                        ? raw
                        : `${raw.slice(0, -scale)}.${raw.slice(-scale)}`;
                const price = decimalString(priceText);

                expect(
                    canonicalTaiwanTickSize({ category, price }),
                    `${category} @ ${price}`,
                ).toBe(tickText);
                expect(isCanonicalTaiwanTickPrice({ category, price })).toBe(
                    true,
                );
                expect(
                    roundCanonicalTaiwanPrice({
                        category,
                        theoreticalPrice: price,
                        rounding: 'down',
                    }).roundedPrice,
                ).toBe(price);
                expect(
                    roundCanonicalTaiwanPrice({
                        category,
                        theoreticalPrice: price,
                        rounding: 'up',
                    }).roundedPrice,
                ).toBe(price);
            }
        }
    });

    it('takes only canonical category, never a security-code prefix', () => {
        expect(
            canonicalTaiwanTickSize({
                category: 'etf',
                price: decimalString('100'),
            }),
        ).toBe('0.05');
        expect(
            canonicalTaiwanTickSize({
                category: 'stock',
                price: decimalString('100'),
            }),
        ).toBe('0.5');
        expect(() =>
            canonicalTaiwanTickSize({
                category: '00999-prefix-guess' as never,
                price: decimalString('100'),
            }),
        ).toThrowError(
            expect.objectContaining<Partial<SmartOrderContractPriceError>>({
                code: 'unsupported_contract_category',
            }),
        );
    });
});

describe('finite numeric boundaries and exact quantity units', () => {
    it.each(['NaN', 'Infinity'])(
        'rejects the non-finite decimal token %s',
        (value) => {
            expectMoneyError(() => decimalString(value), 'invalid_decimal');
        },
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'rejects non-finite integer quantity %s',
        (value) => {
            expectMoneyError(() => shares(value), 'invalid_integer_unit');
            expectMoneyError(
                () => commonLots(value),
                'invalid_integer_unit',
            );
            expectMoneyError(
                () => contractUnit(value),
                'invalid_integer_unit',
            );
            expectMoneyError(
                () =>
                    canonicalTaiwanTickSize({
                        category: 'stock',
                        price: value as never,
                    }),
                'invalid_decimal',
            );
        },
    );

    it('rejects zero rather than falling back to the smallest price tier', () => {
        expect(() =>
            canonicalTaiwanTickSize({
                category: 'stock',
                price: decimalString('0'),
            }),
        ).toThrowError(
            expect.objectContaining<Partial<SmartOrderContractPriceError>>({
                code: 'non_positive_contract_price',
            }),
        );
    });

    it('persists one CommonLot as exactly 1000 Share and rejects fractions', () => {
        const unit = contractUnit(1_000);
        const oneLotInShares = sharesFromCommonLots(commonLots(1), unit);

        expect(shareValue(oneLotInShares)).toBe(1_000n);
        expect(
            commonLotValue(commonLotsFromSharesExact(shares(1_000), unit)),
        ).toBe(1n);
        expectMoneyError(
            () => commonLotsFromSharesExact(shares(999), unit),
            'fractional_common_lot',
        );
        expectMoneyError(
            () => commonLotsFromSharesExact(shares(1_001), unit),
            'fractional_common_lot',
        );
    });
});

describe('Asia/Taipei date is host-timezone and DST independent', () => {
    it.each([
        ['2026-03-08T15:59:59.999Z', '2026-03-08'],
        ['2026-03-08T16:00:00.000Z', '2026-03-09'],
        ['2026-11-01T15:59:59.999Z', '2026-11-01'],
        ['2026-11-01T16:00:00.000Z', '2026-11-02'],
        ['2026-12-31T15:59:59.999Z', '2026-12-31'],
        ['2026-12-31T16:00:00.000Z', '2027-01-01'],
    ] as const)(
        'maps %s to the fixed UTC+8 Taipei date %s',
        (instant, expectedDate) => {
            expect(
                taipeiTradeDateFromEpochMilliseconds(Date.parse(instant)),
            ).toBe(expectedDate);
        },
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'rejects non-finite epoch milliseconds %s',
        (value) => {
            expectCalendarError(
                () => taipeiTradeDateFromEpochMilliseconds(value),
                'invalid_epoch_milliseconds',
            );
        },
    );
});
