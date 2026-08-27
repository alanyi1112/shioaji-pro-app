export type OrderTicketProtectionDistanceKind = 'price' | 'percent' | 'atr';
export type OrderTicketCanonicalCategory = 'stock' | 'etf';

interface DecimalParts {
    readonly coefficient: number;
    readonly scale: number;
}

export interface OrderTicketProtectionPricePreview {
    readonly theoreticalPrice: string;
    readonly legalTickPrice: string;
    readonly tickSize: string;
    readonly comparator: '>=' | '<=';
}

const MAX_SCALE = 6;
const MAX_INTEGER_DIGITS = 8;

function pow10(exponent: number) {
    return 10 ** exponent;
}

function normalize(parts: DecimalParts): DecimalParts | null {
    let { coefficient, scale } = parts;
    if (!Number.isSafeInteger(coefficient) || coefficient < 0) return null;
    while (scale > 0 && coefficient % 10 === 0) {
        coefficient /= 10;
        scale -= 1;
    }
    const integerDigits = Math.max(1, String(coefficient).length - scale);
    return integerDigits <= MAX_INTEGER_DIGITS && scale <= MAX_SCALE
        ? { coefficient, scale }
        : null;
}

function parseDecimal(value: string): DecimalParts | null {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
    const [integer = '', fraction = ''] = value.split('.');
    if (fraction.length > MAX_SCALE) return null;
    const coefficient = Number(`${integer}${fraction}`);
    return normalize({ coefficient, scale: fraction.length });
}

function formatDecimal(parts: DecimalParts): string | null {
    const normalized = normalize(parts);
    if (!normalized) return null;
    const raw = String(normalized.coefficient);
    if (normalized.scale === 0) return raw;
    const padded = raw.padStart(normalized.scale + 1, '0');
    const splitAt = padded.length - normalized.scale;
    return `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
}

function align(left: DecimalParts, right: DecimalParts) {
    const scale = Math.max(left.scale, right.scale);
    const leftValue = left.coefficient * pow10(scale - left.scale);
    const rightValue = right.coefficient * pow10(scale - right.scale);
    return Number.isSafeInteger(leftValue) && Number.isSafeInteger(rightValue)
        ? { leftValue, rightValue, scale }
        : null;
}

function compare(left: DecimalParts, right: DecimalParts) {
    const aligned = align(left, right);
    if (!aligned) return null;
    return aligned.leftValue < aligned.rightValue
        ? -1
        : aligned.leftValue > aligned.rightValue
          ? 1
          : 0;
}

function addOrSubtract(
    left: DecimalParts,
    right: DecimalParts,
    operation: 'add' | 'subtract',
) {
    const aligned = align(left, right);
    if (!aligned) return null;
    const coefficient =
        operation === 'add'
            ? aligned.leftValue + aligned.rightValue
            : aligned.leftValue - aligned.rightValue;
    if (coefficient <= 0) return null;
    return normalize({ coefficient, scale: aligned.scale });
}

function multiply(left: DecimalParts, right: DecimalParts) {
    const coefficient = left.coefficient * right.coefficient;
    return normalize({ coefficient, scale: left.scale + right.scale });
}

function percentageDistance(basis: DecimalParts, value: string) {
    const percent = parseDecimal(value);
    if (!percent || percent.scale > 2) return null;
    const bps = percent.coefficient * pow10(2 - percent.scale);
    if (!Number.isSafeInteger(bps) || bps < 1 || bps > 9_999) return null;
    const coefficient = basis.coefficient * bps;
    return normalize({ coefficient, scale: basis.scale + 4 });
}

function tickSize(category: OrderTicketCanonicalCategory, price: DecimalParts) {
    const boundaries =
        category === 'etf'
            ? ([['50', '0.01'], [null, '0.05']] as const)
            : ([
                  ['10', '0.01'],
                  ['50', '0.05'],
                  ['100', '0.1'],
                  ['500', '0.5'],
                  ['1000', '1'],
                  [null, '5'],
              ] as const);
    for (const [upperExclusive, tick] of boundaries) {
        const upper = upperExclusive === null ? null : parseDecimal(upperExclusive);
        const comparison = upper ? compare(price, upper) : -1;
        if (comparison === null) return null;
        if (upper === null || comparison === -1) return parseDecimal(tick);
    }
    return null;
}

function roundDirectionally(
    category: OrderTicketCanonicalCategory,
    theoretical: DecimalParts,
    direction: 'up' | 'down',
) {
    let candidate = theoretical;
    let finalTick: DecimalParts | null = null;
    let alignedOnTick = false;
    for (let index = 0; index < 3; index += 1) {
        finalTick = tickSize(category, candidate);
        if (!finalTick) return null;
        const aligned = align(theoretical, finalTick);
        if (!aligned || aligned.rightValue <= 0) return null;
        const quotient = aligned.leftValue / aligned.rightValue;
        const ticks = direction === 'up' ? Math.ceil(quotient) : Math.floor(quotient);
        const coefficient = ticks * aligned.rightValue;
        const nextCandidate = normalize({ coefficient, scale: aligned.scale });
        if (!nextCandidate) return null;
        candidate = nextCandidate;
        const candidateTick = tickSize(category, candidate);
        if (!candidateTick) return null;
        const candidateAligned = align(candidate, candidateTick);
        if (
            candidateAligned &&
            candidateAligned.rightValue > 0 &&
            candidateAligned.leftValue % candidateAligned.rightValue === 0
        ) {
            finalTick = candidateTick;
            alignedOnTick = true;
            break;
        }
    }
    return finalTick && alignedOnTick ? { candidate, tick: finalTick } : null;
}

export function calculateOrderTicketProtectionPrice(input: {
    readonly basis: string;
    readonly distanceKind: OrderTicketProtectionDistanceKind;
    readonly distanceValue: string;
    readonly atrValue: string;
    readonly operation: 'add' | 'subtract';
    readonly category: OrderTicketCanonicalCategory;
    readonly limitDown: string;
    readonly limitUp: string;
}): OrderTicketProtectionPricePreview | null {
    const basis = parseDecimal(input.basis);
    const distanceValue = parseDecimal(input.distanceValue);
    const limitDown = parseDecimal(input.limitDown);
    const limitUp = parseDecimal(input.limitUp);
    if (!basis || !distanceValue || !limitDown || !limitUp || basis.coefficient === 0) {
        return null;
    }

    let distance: DecimalParts | null;
    if (input.distanceKind === 'price') {
        distance = distanceValue.coefficient > 0 ? distanceValue : null;
    } else if (input.distanceKind === 'percent') {
        distance = percentageDistance(basis, input.distanceValue);
    } else {
        const atr = parseDecimal(input.atrValue);
        const maxMultiplier = parseDecimal('100');
        const multiplierComparison = maxMultiplier
            ? compare(distanceValue, maxMultiplier)
            : null;
        distance =
            atr &&
            atr.coefficient > 0 &&
            multiplierComparison !== null &&
            multiplierComparison <= 0
                ? multiply(atr, distanceValue)
                : null;
    }
    if (!distance) return null;

    const theoretical = addOrSubtract(basis, distance, input.operation);
    if (!theoretical) return null;
    const rounded = roundDirectionally(
        input.category,
        theoretical,
        input.operation === 'subtract' ? 'up' : 'down',
    );
    if (!rounded) return null;
    const belowLimit = compare(rounded.candidate, limitDown);
    const aboveLimit = compare(rounded.candidate, limitUp);
    if (belowLimit === null || aboveLimit === null || belowLimit < 0 || aboveLimit > 0) {
        return null;
    }

    const theoreticalPrice = formatDecimal(theoretical);
    const legalTickPrice = formatDecimal(rounded.candidate);
    const canonicalTick = formatDecimal(rounded.tick);
    if (!theoreticalPrice || !legalTickPrice || !canonicalTick) return null;
    return Object.freeze({
        theoreticalPrice,
        legalTickPrice,
        tickSize: canonicalTick,
        comparator: input.operation === 'subtract' ? '<=' : '>=',
    });
}
