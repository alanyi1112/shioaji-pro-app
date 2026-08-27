import { describe, expect, it } from 'vitest';
import {
    SmartOrderMoneyError,
    calculateLongStopTrigger,
    calculateLongTakeTrigger,
    calculateTrailingActivationTrigger,
    calculateTrailingRetracementTrigger,
    commonLotValue,
    commonLots,
    commonLotsFromSharesExact,
    compareDecimal,
    contractUnit,
    decimalFromIntegerTicks,
    decimalString,
    decimalToIntegerTicks,
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

describe('smart-order exact decimal and units', () => {
    it('canonicalizes decimal strings without accepting exponent or float input', () => {
        expect(decimalString('100.5000')).toBe('100.5');
        expect(decimalString('0.0100')).toBe('0.01');
        expect(compareDecimal(decimalString('1.20'), decimalString('1.2'))).toBe(
            0,
        );
        expectMoneyError(() => decimalString('1e2'), 'invalid_decimal');
        expectMoneyError(() => decimalString('-1'), 'invalid_decimal');
        expectMoneyError(
            () => decimalString('1234567890123456789'),
            'decimal_overflow',
        );
    });

    it('rounds exact decimal values through bigint tick counts', () => {
        const tick = decimalString('0.05');
        const up = decimalToIntegerTicks(decimalString('97.01'), tick, 'up');
        const down = decimalToIntegerTicks(
            decimalString('102.99'),
            tick,
            'down',
        );
        expect(up).toBe(1941n);
        expect(decimalFromIntegerTicks(up, tick)).toBe('97.05');
        expect(decimalFromIntegerTicks(down, tick)).toBe('102.95');
    });

    it('requires an explicit contract unit for exact Share/CommonLot conversion', () => {
        const unit = contractUnit(1_000);
        const shareQuantity = sharesFromCommonLots(commonLots(3), unit);
        expect(shareValue(shareQuantity)).toBe(3_000n);
        expect(
            commonLotValue(commonLotsFromSharesExact(shares(3_000), unit)),
        ).toBe(3n);
        expectMoneyError(
            () => commonLotsFromSharesExact(shares(1_001), unit),
            'fractional_common_lot',
        );
        expectMoneyError(() => contractUnit(0), 'invalid_contract_unit');
        expectMoneyError(
            () => shares(Number.MAX_SAFE_INTEGER + 1),
            'invalid_integer_unit',
        );
    });
});

describe('smart-order canonical protective formulas', () => {
    const basis = decimalString('100');
    const tickSize = decimalString('0.5');

    it('matches the fixed percentage golden vector B=100, p=3%', () => {
        const distance = { kind: 'pct_bps', pctBps: 300 } as const;
        expect(
            calculateLongStopTrigger({ basis, distance, tickSize }),
        ).toMatchObject({
            theoreticalPrice: '97',
            triggerPrice: '97',
            rounding: 'up',
        });
        expect(
            calculateLongTakeTrigger({ basis, distance, tickSize }),
        ).toMatchObject({
            theoreticalPrice: '103',
            triggerPrice: '103',
            rounding: 'down',
        });
    });

    it('matches the fixed ATR golden vector B=100, ATR=2, k=2', () => {
        const distance = {
            kind: 'fixed_atr',
            atr: decimalString('2'),
            multiplier: decimalString('2'),
        } as const;
        expect(
            calculateLongStopTrigger({ basis, distance, tickSize }),
        ).toMatchObject({ theoreticalPrice: '96', triggerPrice: '96' });
        expect(
            calculateLongTakeTrigger({ basis, distance, tickSize }),
        ).toMatchObject({ theoreticalPrice: '104', triggerPrice: '104' });
        expect(
            calculateTrailingActivationTrigger({ basis, distance, tickSize }),
        ).toMatchObject({ theoreticalPrice: '104', triggerPrice: '104' });
    });

    it('supports absolute distance while keeping the broker LMT price separate', () => {
        const distance = {
            kind: 'absolute',
            value: decimalString('3'),
        } as const;
        const stop = calculateLongStopTrigger({ basis, distance, tickSize });
        const take = calculateLongTakeTrigger({ basis, distance, tickSize });
        expect(stop).toMatchObject({
            theoreticalPrice: '97',
            triggerPrice: '97',
        });
        expect(take).toMatchObject({
            theoreticalPrice: '103',
            triggerPrice: '103',
        });
        expect(stop).not.toHaveProperty('brokerLimitPrice');
        expect(take).not.toHaveProperty('brokerLimitPrice');
    });

    it('matches the trailing high=110, retrace=5% golden vector', () => {
        expect(
            calculateTrailingRetracementTrigger({
                savedHigh: decimalString('110'),
                distance: { kind: 'pct_bps', pctBps: 500 },
                tickSize,
            }),
        ).toMatchObject({
            theoreticalPrice: '104.5',
            triggerPrice: '104.5',
            rounding: 'up',
        });
    });

    it('rounds stop/retracement up and take/activation down', () => {
        const distance = { kind: 'pct_bps', pctBps: 299 } as const;
        const fineTick = decimalString('0.05');
        expect(
            calculateLongStopTrigger({
                basis,
                distance,
                tickSize: fineTick,
            }).triggerPrice,
        ).toBe('97.05');
        expect(
            calculateLongTakeTrigger({
                basis,
                distance,
                tickSize: fineTick,
            }).triggerPrice,
        ).toBe('102.95');
        expect(
            calculateTrailingActivationTrigger({
                basis,
                distance,
                tickSize: fineTick,
            }).triggerPrice,
        ).toBe('102.95');
        expect(
            calculateTrailingRetracementTrigger({
                savedHigh: decimalString('110'),
                distance: { kind: 'pct_bps', pctBps: 501 },
                tickSize: fineTick,
            }).triggerPrice,
        ).toBe('104.5');
    });

    it('rejects invalid bps, zero distance, underflow and decimal overflow', () => {
        expectMoneyError(
            () =>
                calculateLongStopTrigger({
                    basis,
                    distance: { kind: 'pct_bps', pctBps: 10_000 },
                    tickSize,
                }),
            'invalid_pct_bps',
        );
        expectMoneyError(
            () =>
                calculateLongStopTrigger({
                    basis,
                    distance: {
                        kind: 'absolute',
                        value: decimalString('0'),
                    },
                    tickSize,
                }),
            'invalid_distance',
        );
        expectMoneyError(
            () =>
                calculateLongStopTrigger({
                    basis,
                    distance: {
                        kind: 'absolute',
                        value: decimalString('100'),
                    },
                    tickSize,
                }),
            'non_positive_trigger',
        );
        expectMoneyError(
            () =>
                calculateLongTakeTrigger({
                    basis: decimalString('999999999999999999'),
                    distance: {
                        kind: 'fixed_atr',
                        atr: decimalString('999999999999999999'),
                        multiplier: decimalString('999999999999999999'),
                    },
                    tickSize,
                }),
            'decimal_overflow',
        );
    });
});
