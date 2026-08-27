import { types as utilTypes } from 'node:util';

export const SMART_ORDER_CANONICAL_STOCK_UNIT_CONTRACT_SCHEMA_VERSION =
    'smart-order-canonical-stock-unit-contract/2026-08-22.1';
export const SMART_ORDER_CANONICAL_CONTRACT_UPDATE_MAX_AGE_DAYS = 14;

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function dataProperties(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} must be a non-Proxy object`);
    }
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} could not be inspected safely`);
    }
    return Object.freeze(
        Object.fromEntries(
            keys.map((key) => {
                const descriptor = descriptors[key];
                if (
                    !descriptor?.enumerable ||
                    !Object.hasOwn(descriptor, 'value')
                ) {
                    throw new TypeError(
                        `${label}.${key} must be an own data property`,
                    );
                }
                return [key, descriptor.value];
            }),
        ),
    );
}

function token(value, label, maximum = 64) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function minorUnits(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must be a finite amount`);
    }
    const projected = Math.round(value * 100);
    if (
        !Number.isSafeInteger(projected) ||
        projected < 0 ||
        Math.abs(projected / 100 - value) > 1e-9
    ) {
        throw new TypeError(`${label} cannot be represented in minor units`);
    }
    return projected;
}

function tradingDate(value, label) {
    const candidate = token(value, label, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
        throw new TypeError(`${label} must be YYYY-MM-DD`);
    }
    const [year, month, day] = candidate.split('-').map(Number);
    if (
        new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !==
        candidate
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return candidate;
}

function nonnegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function positiveInteger(value, label) {
    const current = nonnegativeInteger(value, label);
    if (current < 1) {
        throw new TypeError(`${label} must be positive`);
    }
    return current;
}

export function parseSmartOrderCanonicalStockContractMetadata(
    response,
    { requestedCode, expectedExchange = null },
) {
    const code = token(requestedCode, 'contract requested code', 32);
    if (
        expectedExchange !== null &&
        !['TSE', 'OTC'].includes(expectedExchange)
    ) {
        throw new TypeError('contract expected exchange is invalid');
    }
    const row = dataProperties(
        response,
        [
            'category',
            'code',
            'exchange',
            'limit_down',
            'limit_up',
            'reference',
            'security_type',
            'unit',
            'update_date',
        ],
        'contract response',
    );
    if (
        row.code !== code ||
        !['TSE', 'OTC'].includes(row.exchange) ||
        (expectedExchange !== null && row.exchange !== expectedExchange) ||
        row.security_type !== 'STK' ||
        !Number.isSafeInteger(row.unit) ||
        row.unit < 1 ||
        !/^\d{2}$/.test(row.category)
    ) {
        throw new Error(
            'contract response does not match the requested stock contract',
        );
    }
    const referenceMinorUnits = minorUnits(
        row.reference,
        'contract.reference',
    );
    const limitUpMinorUnits = minorUnits(row.limit_up, 'contract.limit_up');
    const limitDownMinorUnits = minorUnits(
        row.limit_down,
        'contract.limit_down',
    );
    if (
        referenceMinorUnits < 1 ||
        limitDownMinorUnits < 1 ||
        limitUpMinorUnits < referenceMinorUnits ||
        limitDownMinorUnits > referenceMinorUnits
    ) {
        throw new Error('contract price limits are inconsistent');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_CANONICAL_STOCK_UNIT_CONTRACT_SCHEMA_VERSION,
        categoryCode: row.category,
        code,
        contractKey: `${row.exchange}:${code}:STK:Common`,
        contractUnit: row.unit,
        exchange: row.exchange,
        limitDownMinorUnits,
        limitUpMinorUnits,
        referenceMinorUnits,
        securityType: 'STK',
        updateDate: tradingDate(row.update_date, 'contract.update_date'),
    });
}

export function smartOrderCommonLotsToShares(commonLots, contractUnit) {
    const lots = nonnegativeInteger(commonLots, 'CommonLot quantity');
    const unit = positiveInteger(contractUnit, 'contract unit');
    const shares = BigInt(lots) * BigInt(unit);
    if (shares > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('CommonLot quantity exceeds Share bounds');
    }
    return Number(shares);
}

export function smartOrderSharesToCommonLots(quantityShares, contractUnit) {
    const shares = nonnegativeInteger(quantityShares, 'Share quantity');
    const unit = positiveInteger(contractUnit, 'contract unit');
    if (shares % unit !== 0) {
        throw new Error(
            'Share quantity is not exactly divisible by the canonical contract unit',
        );
    }
    return shares / unit;
}

export function assertSmartOrderCanonicalContractUpdateDateCurrent(
    metadata,
    nowEpochMs,
) {
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        throw new TypeError('contract current time is invalid');
    }
    const currentDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(nowEpochMs));
    const updateDate = tradingDate(
        metadata?.updateDate,
        'contract metadata updateDate',
    );
    const ageDays =
        (Date.parse(`${currentDate}T00:00:00.000Z`) -
            Date.parse(`${updateDate}T00:00:00.000Z`)) /
        86_400_000;
    if (
        !Number.isSafeInteger(ageDays) ||
        ageDays < 0 ||
        ageDays > SMART_ORDER_CANONICAL_CONTRACT_UPDATE_MAX_AGE_DAYS
    ) {
        throw new Error('canonical contract update date is stale or future');
    }
    return true;
}
