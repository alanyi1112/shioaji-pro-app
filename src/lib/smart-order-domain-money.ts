/**
 * Smart-order monetary primitives.
 *
 * These helpers intentionally do not accept JavaScript `number` values for
 * prices. Trading thresholds remain decimal strings and bigint tick counts all
 * the way through the domain layer.
 */

declare const decimalStringBrand: unique symbol;
declare const tickCountBrand: unique symbol;
declare const shareBrand: unique symbol;
declare const commonLotBrand: unique symbol;
declare const contractUnitBrand: unique symbol;

export type DecimalString = string & {
    readonly [decimalStringBrand]: 'DecimalString';
};
export type TickCount = bigint & { readonly [tickCountBrand]: 'TickCount' };
export type Share = bigint & { readonly [shareBrand]: 'Share' };
export type CommonLot = bigint & { readonly [commonLotBrand]: 'CommonLot' };
export type ContractUnit = bigint & {
    readonly [contractUnitBrand]: 'ContractUnit';
};

export type SmartOrderMoneyErrorCode =
    | 'invalid_decimal'
    | 'decimal_overflow'
    | 'invalid_integer_unit'
    | 'invalid_contract_unit'
    | 'fractional_common_lot'
    | 'invalid_tick_size'
    | 'invalid_pct_bps'
    | 'invalid_distance'
    | 'non_positive_trigger';

export class SmartOrderMoneyError extends Error {
    readonly code: SmartOrderMoneyErrorCode;

    constructor(code: SmartOrderMoneyErrorCode, message: string) {
        super(message);
        this.name = 'SmartOrderMoneyError';
        this.code = code;
    }
}

const MAX_INTEGER_DIGITS = 18;
const MAX_DECIMAL_SCALE = 18;
const MAX_RAW_DECIMAL_LENGTH = 80;

interface DecimalParts {
    coefficient: bigint;
    scale: number;
}

function fail(
    code: SmartOrderMoneyErrorCode,
    message: string,
): never {
    throw new SmartOrderMoneyError(code, message);
}

function tenTo(exponent: number): bigint {
    if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 40) {
        return fail('decimal_overflow', 'decimal scale exceeds domain bounds');
    }
    return 10n ** BigInt(exponent);
}

function normalizeParts(parts: DecimalParts): DecimalParts {
    let { coefficient, scale } = parts;
    if (coefficient < 0n) {
        return fail('invalid_decimal', 'negative decimals are not supported');
    }
    while (scale > 0 && coefficient % 10n === 0n) {
        coefficient /= 10n;
        scale -= 1;
    }
    const digits = coefficient === 0n ? 1 : coefficient.toString().length;
    const integerDigits = Math.max(1, digits - scale);
    if (integerDigits > MAX_INTEGER_DIGITS || scale > MAX_DECIMAL_SCALE) {
        return fail('decimal_overflow', 'decimal exceeds domain bounds');
    }
    return { coefficient, scale };
}

function parseDecimal(value: DecimalString | string): DecimalParts {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_RAW_DECIMAL_LENGTH ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    ) {
        return fail(
            'invalid_decimal',
            'decimal must be an unsigned base-10 string without exponent notation',
        );
    }

    const [integerPart = '', fractionalPart = ''] = value.split('.');
    return normalizeParts({
        coefficient: BigInt(`${integerPart}${fractionalPart}`),
        scale: fractionalPart.length,
    });
}

function formatDecimal(parts: DecimalParts): DecimalString {
    const normalized = normalizeParts(parts);
    const raw = normalized.coefficient.toString();
    if (normalized.scale === 0) return raw as DecimalString;
    const padded = raw.padStart(normalized.scale + 1, '0');
    const splitAt = padded.length - normalized.scale;
    return `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}` as DecimalString;
}

function alignDecimals(
    left: DecimalParts,
    right: DecimalParts,
): readonly [bigint, bigint, number] {
    const scale = Math.max(left.scale, right.scale);
    return [
        left.coefficient * tenTo(scale - left.scale),
        right.coefficient * tenTo(scale - right.scale),
        scale,
    ];
}

function compareParts(left: DecimalParts, right: DecimalParts): number {
    const [leftValue, rightValue] = alignDecimals(left, right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function addParts(left: DecimalParts, right: DecimalParts): DecimalParts {
    const [leftValue, rightValue, scale] = alignDecimals(left, right);
    return normalizeParts({ coefficient: leftValue + rightValue, scale });
}

function subtractParts(left: DecimalParts, right: DecimalParts): DecimalParts {
    const [leftValue, rightValue, scale] = alignDecimals(left, right);
    if (leftValue <= rightValue) {
        return fail(
            'non_positive_trigger',
            'stop or retracement must remain greater than zero',
        );
    }
    return normalizeParts({ coefficient: leftValue - rightValue, scale });
}

function multiplyParts(left: DecimalParts, right: DecimalParts): DecimalParts {
    return normalizeParts({
        coefficient: left.coefficient * right.coefficient,
        scale: left.scale + right.scale,
    });
}

function multiplyRatio(
    value: DecimalParts,
    numerator: number,
    denominator: number,
): DecimalParts {
    if (
        !Number.isSafeInteger(numerator) ||
        !Number.isSafeInteger(denominator) ||
        numerator < 0 ||
        denominator <= 0
    ) {
        return fail('invalid_distance', 'ratio is outside the domain');
    }
    const denominatorText = denominator.toString();
    if (!/^10+$/.test(denominatorText)) {
        return fail(
            'invalid_distance',
            'canonical ratios require a power-of-ten denominator',
        );
    }
    return normalizeParts({
        coefficient: value.coefficient * BigInt(numerator),
        scale: value.scale + denominatorText.length - 1,
    });
}

export function decimalString(value: string): DecimalString {
    return formatDecimal(parseDecimal(value));
}

export function compareDecimal(
    left: DecimalString,
    right: DecimalString,
): -1 | 0 | 1 {
    return compareParts(parseDecimal(left), parseDecimal(right)) as -1 | 0 | 1;
}

function parseNonNegativeInteger(
    value: bigint | string | number,
    label: string,
): bigint {
    let parsed: bigint;
    if (typeof value === 'bigint') {
        parsed = value;
    } else if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            return fail(
                'invalid_integer_unit',
                `${label} number must be a safe integer`,
            );
        }
        parsed = BigInt(value);
    } else if (/^(?:0|[1-9]\d*)$/.test(value)) {
        parsed = BigInt(value);
    } else {
        return fail(
            'invalid_integer_unit',
            `${label} must be an unsigned integer`,
        );
    }
    if (parsed < 0n) {
        return fail(
            'invalid_integer_unit',
            `${label} must be an unsigned integer`,
        );
    }
    return parsed;
}

export function tickCount(value: bigint | string | number): TickCount {
    return parseNonNegativeInteger(value, 'tick count') as TickCount;
}

export function shares(value: bigint | string | number): Share {
    return parseNonNegativeInteger(value, 'share quantity') as Share;
}

export function commonLots(value: bigint | string | number): CommonLot {
    return parseNonNegativeInteger(value, 'common-lot quantity') as CommonLot;
}

export function contractUnit(value: bigint | string | number): ContractUnit {
    const parsed = parseNonNegativeInteger(value, 'contract unit');
    if (parsed === 0n) {
        return fail('invalid_contract_unit', 'contract unit must be positive');
    }
    return parsed as ContractUnit;
}

export function shareValue(value: Share): bigint {
    return value as bigint;
}

export function commonLotValue(value: CommonLot): bigint {
    return value as bigint;
}

export function contractUnitValue(value: ContractUnit): bigint {
    return value as bigint;
}

export function sharesFromCommonLots(
    quantity: CommonLot,
    unit: ContractUnit,
): Share {
    const lotQuantity = commonLotValue(quantity);
    const unitQuantity = contractUnitValue(unit);
    if (lotQuantity < 0n) {
        return fail(
            'invalid_integer_unit',
            'common-lot quantity must be non-negative',
        );
    }
    if (unitQuantity <= 0n) {
        return fail('invalid_contract_unit', 'contract unit must be positive');
    }
    return (lotQuantity * unitQuantity) as Share;
}

export function commonLotsFromSharesExact(
    quantity: Share,
    unit: ContractUnit,
): CommonLot {
    const shareQuantity = shareValue(quantity);
    const unitQuantity = contractUnitValue(unit);
    if (shareQuantity < 0n) {
        return fail(
            'invalid_integer_unit',
            'share quantity must be non-negative',
        );
    }
    if (unitQuantity <= 0n) {
        return fail('invalid_contract_unit', 'contract unit must be positive');
    }
    if (shareQuantity % unitQuantity !== 0n) {
        return fail(
            'fractional_common_lot',
            'share quantity is not exactly divisible by the canonical contract unit',
        );
    }
    return (shareQuantity / unitQuantity) as CommonLot;
}

export type TickRounding = 'up' | 'down';

function validatedTickParts(tickSize: DecimalString): DecimalParts {
    const parsed = parseDecimal(tickSize);
    if (parsed.coefficient === 0n) {
        return fail('invalid_tick_size', 'tick size must be positive');
    }
    return parsed;
}

export function decimalToIntegerTicks(
    price: DecimalString,
    tickSize: DecimalString,
    rounding: TickRounding,
): TickCount {
    const priceParts = parseDecimal(price);
    const tickParts = validatedTickParts(tickSize);
    const [priceValue, tickValue] = alignDecimals(priceParts, tickParts);
    let ticks = priceValue / tickValue;
    if (rounding === 'up' && priceValue % tickValue !== 0n) ticks += 1n;
    return ticks as TickCount;
}

export function decimalFromIntegerTicks(
    ticks: TickCount,
    tickSize: DecimalString,
): DecimalString {
    const tickParts = validatedTickParts(tickSize);
    if ((ticks as bigint) < 0n) {
        return fail('invalid_integer_unit', 'tick count must be non-negative');
    }
    return formatDecimal({
        coefficient: (ticks as bigint) * tickParts.coefficient,
        scale: tickParts.scale,
    });
}

export type CanonicalDistance =
    | Readonly<{ kind: 'absolute'; value: DecimalString }>
    | Readonly<{ kind: 'pct_bps'; pctBps: number }>
    | Readonly<{
          kind: 'fixed_atr';
          atr: DecimalString;
          multiplier: DecimalString;
      }>;

export interface CanonicalTriggerPrice {
    /** Exact formula result before contract tick rounding. */
    readonly theoreticalPrice: DecimalString;
    /** Directionally rounded trigger only; this is not a broker LMT price. */
    readonly triggerPrice: DecimalString;
    readonly triggerTicks: TickCount;
    readonly rounding: TickRounding;
}

function validatePctBps(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 9_999) {
        return fail(
            'invalid_pct_bps',
            'pctBps must be an integer from 1 through 9999',
        );
    }
    return value;
}

function positiveParts(
    value: DecimalString,
    label: string,
): DecimalParts {
    const parsed = parseDecimal(value);
    if (parsed.coefficient === 0n) {
        return fail('invalid_distance', `${label} must be positive`);
    }
    return parsed;
}

function applyDistance(
    basis: DecimalString,
    distance: CanonicalDistance,
    operation: 'add' | 'subtract',
): DecimalString {
    const basisParts = positiveParts(basis, 'basis');
    let result: DecimalParts;

    switch (distance.kind) {
        case 'absolute': {
            const delta = positiveParts(distance.value, 'absolute distance');
            result =
                operation === 'add'
                    ? addParts(basisParts, delta)
                    : subtractParts(basisParts, delta);
            break;
        }
        case 'pct_bps': {
            const bps = validatePctBps(distance.pctBps);
            result = multiplyRatio(
                basisParts,
                operation === 'add' ? 10_000 + bps : 10_000 - bps,
                10_000,
            );
            break;
        }
        case 'fixed_atr': {
            const atr = positiveParts(distance.atr, 'fixed ATR');
            const multiplier = positiveParts(
                distance.multiplier,
                'ATR multiplier',
            );
            const delta = multiplyParts(atr, multiplier);
            result =
                operation === 'add'
                    ? addParts(basisParts, delta)
                    : subtractParts(basisParts, delta);
            break;
        }
        default:
            return fail('invalid_distance', 'unknown canonical distance kind');
    }

    return formatDecimal(result);
}

function roundedTrigger(
    theoreticalPrice: DecimalString,
    tickSize: DecimalString,
    rounding: TickRounding,
): CanonicalTriggerPrice {
    const ticks = decimalToIntegerTicks(theoreticalPrice, tickSize, rounding);
    const triggerPrice = decimalFromIntegerTicks(ticks, tickSize);
    if (
        compareParts(
            parseDecimal(triggerPrice),
            parseDecimal(decimalString('0')),
        ) <= 0
    ) {
        return fail('non_positive_trigger', 'rounded trigger must be positive');
    }
    return {
        theoreticalPrice,
        triggerPrice,
        triggerTicks: ticks,
        rounding,
    };
}

export function calculateLongStopTrigger(input: {
    basis: DecimalString;
    distance: CanonicalDistance;
    tickSize: DecimalString;
}): CanonicalTriggerPrice {
    return roundedTrigger(
        applyDistance(input.basis, input.distance, 'subtract'),
        input.tickSize,
        'up',
    );
}

export function calculateLongTakeTrigger(input: {
    basis: DecimalString;
    distance: CanonicalDistance;
    tickSize: DecimalString;
}): CanonicalTriggerPrice {
    return roundedTrigger(
        applyDistance(input.basis, input.distance, 'add'),
        input.tickSize,
        'down',
    );
}

export function calculateTrailingActivationTrigger(input: {
    basis: DecimalString;
    distance: CanonicalDistance;
    tickSize: DecimalString;
}): CanonicalTriggerPrice {
    return roundedTrigger(
        applyDistance(input.basis, input.distance, 'add'),
        input.tickSize,
        'down',
    );
}

export function calculateTrailingRetracementTrigger(input: {
    savedHigh: DecimalString;
    distance: CanonicalDistance;
    tickSize: DecimalString;
}): CanonicalTriggerPrice {
    return roundedTrigger(
        applyDistance(input.savedHigh, input.distance, 'subtract'),
        input.tickSize,
        'up',
    );
}
