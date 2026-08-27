import { describe, expect, it } from 'vitest';
import { orderPriceTypeLabel } from './order-price-type-label';

describe('order price type display labels', () => {
    it.each([
        ['LMT', '限價單'],
        ['MKT', '市價單'],
        ['MKP', '範圍市價'],
    ] as const)('keeps %s canonical while displaying %s', (value, label) => {
        expect(orderPriceTypeLabel(value)).toBe(label);
    });
});
