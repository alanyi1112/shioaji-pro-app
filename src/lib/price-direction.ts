export type PriceDirection = 'up' | 'down' | 'flat';

function validFiniteNumber(value: number | undefined | null): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Compares a price with an authoritative reference price.
 *
 * Missing/invalid values deliberately degrade to flat: callers must never
 * infer a market direction from a field label or substitute another price.
 */
export function priceDirection(
    value: number | undefined | null,
    reference: number | undefined | null,
): PriceDirection {
    if (
        !validFiniteNumber(value) ||
        !validFiniteNumber(reference) ||
        reference <= 0
    ) {
        return 'flat';
    }
    if (value > reference) return 'up';
    if (value < reference) return 'down';
    return 'flat';
}
