/**
 * Exact TW stock/ETF tick tables for the smart-order domain.
 *
 * `category` MUST already have been resolved from a trusted, current canonical
 * contract.  This module deliberately accepts no security code, so callers
 * cannot infer ETF status from a prefix.  Prices stay as DecimalString values
 * and tick counts stay bigint throughout the calculation.
 */

import {
    compareDecimal,
    decimalFromIntegerTicks,
    decimalString,
    decimalToIntegerTicks,
    type DecimalString,
    type TickCount,
    type TickRounding,
} from './smart-order-domain-money';

export const SMART_ORDER_TAIWAN_TICK_TABLE_REVISION =
    'smart-order-tw-tick-table/2026-08-11.1' as const;

export type CanonicalTaiwanSecurityCategory = 'stock' | 'etf';

export type SmartOrderContractPriceErrorCode =
    | 'unsupported_contract_category'
    | 'non_positive_contract_price'
    | 'rounded_price_not_on_canonical_tick';

export class SmartOrderContractPriceError extends Error {
    readonly code: SmartOrderContractPriceErrorCode;

    constructor(code: SmartOrderContractPriceErrorCode, message: string) {
        super(message);
        this.name = 'SmartOrderContractPriceError';
        this.code = code;
    }
}

interface TickBand {
    readonly upperExclusive: DecimalString | null;
    readonly tickSize: DecimalString;
}

const ZERO = decimalString('0');

const STOCK_TICK_BANDS: readonly TickBand[] = Object.freeze([
    Object.freeze({
        upperExclusive: decimalString('10'),
        tickSize: decimalString('0.01'),
    }),
    Object.freeze({
        upperExclusive: decimalString('50'),
        tickSize: decimalString('0.05'),
    }),
    Object.freeze({
        upperExclusive: decimalString('100'),
        tickSize: decimalString('0.1'),
    }),
    Object.freeze({
        upperExclusive: decimalString('500'),
        tickSize: decimalString('0.5'),
    }),
    Object.freeze({
        upperExclusive: decimalString('1000'),
        tickSize: decimalString('1'),
    }),
    Object.freeze({
        upperExclusive: null,
        tickSize: decimalString('5'),
    }),
]);

const ETF_TICK_BANDS: readonly TickBand[] = Object.freeze([
    Object.freeze({
        upperExclusive: decimalString('50'),
        tickSize: decimalString('0.01'),
    }),
    Object.freeze({
        upperExclusive: null,
        tickSize: decimalString('0.05'),
    }),
]);

function fail(
    code: SmartOrderContractPriceErrorCode,
    message: string,
): never {
    throw new SmartOrderContractPriceError(code, message);
}

function requireCanonicalCategory(
    value: CanonicalTaiwanSecurityCategory,
): CanonicalTaiwanSecurityCategory {
    if (value !== 'stock' && value !== 'etf') {
        return fail(
            'unsupported_contract_category',
            'contract category must be supplied by the canonical contract repository',
        );
    }
    return value;
}

function requirePositivePrice(price: DecimalString): DecimalString {
    if (compareDecimal(price, ZERO) <= 0) {
        return fail(
            'non_positive_contract_price',
            'contract price must be greater than zero',
        );
    }
    return price;
}

/**
 * Resolves an exact tick size from a trusted stock/ETF category and price.
 * No contract code or display-layer fallback is accepted by this boundary.
 */
export function canonicalTaiwanTickSize(input: {
    readonly category: CanonicalTaiwanSecurityCategory;
    readonly price: DecimalString;
}): DecimalString {
    const category = requireCanonicalCategory(input.category);
    const price = requirePositivePrice(input.price);
    const bands = category === 'stock' ? STOCK_TICK_BANDS : ETF_TICK_BANDS;

    for (const band of bands) {
        if (
            band.upperExclusive === null ||
            compareDecimal(price, band.upperExclusive) < 0
        ) {
            return band.tickSize;
        }
    }

    /* v8 ignore next -- both frozen tables end in an unbounded band. */
    return fail(
        'rounded_price_not_on_canonical_tick',
        'canonical tick table has no terminal band',
    );
}

export function isCanonicalTaiwanTickPrice(input: {
    readonly category: CanonicalTaiwanSecurityCategory;
    readonly price: DecimalString;
}): boolean {
    const tickSize = canonicalTaiwanTickSize(input);
    const ticks = decimalToIntegerTicks(input.price, tickSize, 'down');
    return compareDecimal(
        decimalFromIntegerTicks(ticks, tickSize),
        input.price,
    ) === 0;
}

export interface CanonicalTaiwanRoundedPrice {
    readonly tableRevision: typeof SMART_ORDER_TAIWAN_TICK_TABLE_REVISION;
    readonly category: CanonicalTaiwanSecurityCategory;
    readonly theoreticalPrice: DecimalString;
    readonly tickSize: DecimalString;
    readonly tickCount: TickCount;
    readonly rounding: TickRounding;
    readonly roundedPrice: DecimalString;
}

/** Directionally rounds a theoretical price and verifies the final tier. */
export function roundCanonicalTaiwanPrice(input: {
    readonly category: CanonicalTaiwanSecurityCategory;
    readonly theoreticalPrice: DecimalString;
    readonly rounding: TickRounding;
}): CanonicalTaiwanRoundedPrice {
    const category = requireCanonicalCategory(input.category);
    const theoreticalPrice = requirePositivePrice(input.theoreticalPrice);
    const roundingTickSize = canonicalTaiwanTickSize({
        category,
        price: theoreticalPrice,
    });
    const roundingTickCount = decimalToIntegerTicks(
        theoreticalPrice,
        roundingTickSize,
        input.rounding,
    );
    const roundedPrice = decimalFromIntegerTicks(
        roundingTickCount,
        roundingTickSize,
    );

    if (!isCanonicalTaiwanTickPrice({ category, price: roundedPrice })) {
        return fail(
            'rounded_price_not_on_canonical_tick',
            'directional rounding did not produce a price on the canonical table',
        );
    }

    // Rounding may land exactly on the next tier (for example 49.99 -> 50).
    // Persist the tick/count pair of the final price, not the source tier used
    // to reach that boundary.
    const tickSize = canonicalTaiwanTickSize({
        category,
        price: roundedPrice,
    });
    const tickCount = decimalToIntegerTicks(roundedPrice, tickSize, 'down');

    return Object.freeze({
        tableRevision: SMART_ORDER_TAIWAN_TICK_TABLE_REVISION,
        category,
        theoreticalPrice,
        tickSize,
        tickCount,
        rounding: input.rounding,
        roundedPrice,
    });
}
