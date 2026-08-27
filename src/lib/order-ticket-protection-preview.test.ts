import { describe, expect, it } from 'vitest';
import { calculateOrderTicketProtectionPrice } from './order-ticket-protection-preview';

const common = {
    basis: '100',
    atrValue: '2',
    category: 'stock' as const,
    limitDown: '50',
    limitUp: '150',
};

describe('order ticket protection price preview', () => {
    it('uses exact integer bps for fixed stop and take without float drift', () => {
        expect(
            calculateOrderTicketProtectionPrice({
                ...common,
                distanceKind: 'percent',
                distanceValue: '3',
                operation: 'subtract',
            }),
        ).toMatchObject({
            theoreticalPrice: '97',
            legalTickPrice: '97',
            tickSize: '0.1',
            comparator: '<=',
        });
        expect(
            calculateOrderTicketProtectionPrice({
                ...common,
                distanceKind: 'percent',
                distanceValue: '3',
                operation: 'add',
            }),
        ).toMatchObject({
            theoreticalPrice: '103',
            legalTickPrice: '103',
            tickSize: '0.5',
            comparator: '>=',
        });
    });

    it('rounds stock and ETF prices directionally using the supplied category only', () => {
        const stop = calculateOrderTicketProtectionPrice({
            ...common,
            basis: '50',
            limitDown: '40',
            distanceKind: 'price',
            distanceValue: '0.023',
            operation: 'subtract',
        });
        const etfStop = calculateOrderTicketProtectionPrice({
            ...common,
            basis: '50',
            limitDown: '40',
            category: 'etf',
            distanceKind: 'price',
            distanceValue: '0.023',
            operation: 'subtract',
        });
        expect(stop).toMatchObject({
            theoreticalPrice: '49.977',
            legalTickPrice: '50',
            tickSize: '0.1',
        });
        expect(etfStop).toMatchObject({
            theoreticalPrice: '49.977',
            legalTickPrice: '49.98',
            tickSize: '0.01',
        });
    });

    it('uses exact ATR multiplication and rejects invalid bps or limits', () => {
        expect(
            calculateOrderTicketProtectionPrice({
                ...common,
                distanceKind: 'atr',
                distanceValue: '2',
                operation: 'subtract',
            }),
        ).toMatchObject({ theoreticalPrice: '96', legalTickPrice: '96' });
        expect(
            calculateOrderTicketProtectionPrice({
                ...common,
                distanceKind: 'percent',
                distanceValue: '0.001',
                operation: 'subtract',
            }),
        ).toBeNull();
        expect(
            calculateOrderTicketProtectionPrice({
                ...common,
                limitDown: '99',
                distanceKind: 'price',
                distanceValue: '2',
                operation: 'subtract',
            }),
        ).toBeNull();
    });
});
