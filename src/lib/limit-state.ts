export type QuoteLimitState = 'up' | 'down';

export interface QuoteLimitStateInput {
    price: number | undefined | null;
    limitUp: number | undefined | null;
    limitDown: number | undefined | null;
    isIndex?: boolean;
}

function validPositivePrice(value: number | undefined | null): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Determines whether the price currently shown by a quote component is at a
 * contract's authoritative daily limit. Missing values deliberately fail
 * closed; percentage moves must never be used as a substitute.
 */
export function quoteLimitState({
    price,
    limitUp,
    limitDown,
    isIndex = false,
}: QuoteLimitStateInput): QuoteLimitState | null {
    if (isIndex || !validPositivePrice(price)) return null;
    if (validPositivePrice(limitUp) && price >= limitUp) return 'up';
    if (validPositivePrice(limitDown) && price <= limitDown) return 'down';
    return null;
}
