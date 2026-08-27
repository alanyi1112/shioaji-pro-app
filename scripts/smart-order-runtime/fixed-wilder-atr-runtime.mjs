import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_RUNTIME_FIXED_ATR_SCHEMA_VERSION =
    'smart-order-runtime-fixed-wilder-atr/2026-08-21.1';
export const SMART_ORDER_RUNTIME_FIXED_ATR_ALGORITHM_VERSION =
    'realtimestock.wilder-atr/v2-scale18-half-up-per-step';

const SCALE = 18;
const FACTOR = 10n ** BigInt(SCALE);
const PERIOD = 14;
const MAX_REQUESTED_RANGE_DAYS = 30;
const MAX_AS_OF_STALENESS_DAYS = 7;
const DATE_TIME =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function invalid(message) {
    throw new TypeError(`Runtime fixed ATR source is invalid: ${message}`);
}

function ownData(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        invalid(`${label} must be a non-Proxy data object`);
    }
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        invalid(`${label} descriptors are unavailable`);
    }
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== keys.length ||
        !keys.every((key) => {
            const descriptor = descriptors[key];
            return (
                descriptor?.enumerable === true &&
                Object.hasOwn(descriptor, 'value')
            );
        })
    ) {
        invalid(`${label} does not match its exact schema`);
    }
    return Object.freeze(
        Object.fromEntries(keys.map((key) => [key, descriptors[key].value])),
    );
}

function token(value, label, maximum = 240) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        invalid(`${label} must be a bounded token`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !SHA256.test(value)) {
        invalid(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function tradingDate(value, label) {
    if (typeof value !== 'string' || !DATE.test(value)) {
        invalid(`${label} must be YYYY-MM-DD`);
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.toISOString().slice(0, 10) !== value) {
        invalid(`${label} is not a calendar date`);
    }
    return value;
}

function tradingDateEpoch(value, label) {
    tradingDate(value, label);
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

function scaledDecimal(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        invalid(`${label} must be a positive finite number`);
    }
    const decimal = String(value);
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimal)) {
        invalid(`${label} is not a canonical decimal number`);
    }
    const [whole, fraction = ''] = decimal.split('.');
    if (fraction.length > SCALE) {
        invalid(`${label} exceeds the ATR decimal scale`);
    }
    return (
        BigInt(whole) * FACTOR +
        BigInt(fraction.padEnd(SCALE, '0'))
    );
}

function scaledToDecimal(value) {
    if (value <= 0n) invalid('Wilder ATR must remain positive');
    const whole = value / FACTOR;
    const fraction = (value % FACTOR)
        .toString()
        .padStart(SCALE, '0')
        .replace(/0+$/, '');
    return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

function roundedDivideHalfUp(numerator, denominator) {
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function canonicalKbars(response) {
    const record = ownData(
        response,
        ['Amount', 'Close', 'High', 'Low', 'Open', 'Volume', 'datetime'],
        'Kbars response',
    );
    const columns = [
        record.datetime,
        record.Open,
        record.High,
        record.Low,
        record.Close,
        record.Volume,
        record.Amount,
    ];
    if (
        columns.some(
            (column) =>
                !Array.isArray(column) || utilTypes.isProxy(column),
        )
    ) {
        invalid('Kbars columns must be non-Proxy arrays');
    }
    const length = record.datetime.length;
    if (
        length < PERIOD + 1 ||
        length > 100_000 ||
        columns.some((column) => column.length !== length)
    ) {
        invalid('Kbars columns have invalid or inconsistent lengths');
    }
    return record;
}

function dailyCandles(response, decisionTradingDate) {
    const bars = canonicalKbars(response);
    const byDate = new Map();
    let previousTimestamp = '';
    for (let index = 0; index < bars.datetime.length; index += 1) {
        const timestamp = bars.datetime[index];
        if (typeof timestamp !== 'string') {
            invalid(`Kbars.datetime[${index}] must be a timestamp`);
        }
        const match = DATE_TIME.exec(timestamp);
        if (!match || timestamp <= previousTimestamp) {
            invalid('Kbars timestamps must be strictly increasing Taiwan wall time');
        }
        previousTimestamp = timestamp;
        const date = timestamp.slice(0, 10);
        tradingDate(date, `Kbars.datetime[${index}] date`);
        if (date >= decisionTradingDate) continue;
        const open = scaledDecimal(bars.Open[index], `Kbars.Open[${index}]`);
        const high = scaledDecimal(bars.High[index], `Kbars.High[${index}]`);
        const low = scaledDecimal(bars.Low[index], `Kbars.Low[${index}]`);
        const close = scaledDecimal(bars.Close[index], `Kbars.Close[${index}]`);
        if (high < open || high < close || low > open || low > close || low > high) {
            invalid(`Kbars price ordering is invalid at index ${index}`);
        }
        const current = byDate.get(date);
        if (!current) {
            byDate.set(date, { date, open, high, low, close });
        } else {
            current.high = current.high > high ? current.high : high;
            current.low = current.low < low ? current.low : low;
            current.close = close;
        }
    }
    const candles = [...byDate.values()];
    if (candles.length < PERIOD + 1) {
        invalid('Wilder ATR(14) requires an anchor plus 14 completed daily candles');
    }
    return candles;
}

function trueRange(candle, previousClose) {
    const absolute = (left, right) => (left >= right ? left - right : right - left);
    return [
        candle.high - candle.low,
        absolute(candle.high, previousClose),
        absolute(candle.low, previousClose),
    ].reduce((maximum, candidate) =>
        candidate > maximum ? candidate : maximum,
    0n);
}

function wilderAtr(candles) {
    const ranges = [];
    for (let index = 1; index < candles.length; index += 1) {
        ranges.push(trueRange(candles[index], candles[index - 1].close));
    }
    const denominator = BigInt(PERIOD);
    let atr = roundedDivideHalfUp(
        ranges.slice(0, PERIOD).reduce((sum, range) => sum + range, 0n),
        denominator,
    );
    for (const range of ranges.slice(PERIOD)) {
        atr = roundedDivideHalfUp(
            atr * BigInt(PERIOD - 1) + range,
            denominator,
        );
    }
    return scaledToDecimal(atr);
}

export function createRuntimeFixedWilderAtrSnapshot(input) {
    const record = ownData(
        input,
        [
            'contractKey',
            'contractRevision',
            'corporateActionRevision',
            'decisionTradingDate',
            'requestedEndDate',
            'requestedStartDate',
            'response',
            'strategyDefinitionHash',
        ],
        'fixed ATR input',
    );
    const decisionTradingDate = tradingDate(
        record.decisionTradingDate,
        'decisionTradingDate',
    );
    const requestedStartDate = tradingDate(
        record.requestedStartDate,
        'requestedStartDate',
    );
    const requestedEndDate = tradingDate(
        record.requestedEndDate,
        'requestedEndDate',
    );
    if (
        requestedStartDate >= requestedEndDate ||
        requestedEndDate >= decisionTradingDate ||
        (tradingDateEpoch(requestedEndDate, 'requestedEndDate') -
            tradingDateEpoch(requestedStartDate, 'requestedStartDate')) /
            86_400_000 >
            MAX_REQUESTED_RANGE_DAYS
    ) {
        invalid(
            'requested Kbar range must precede the decision trading date and remain within the official 30-day limit',
        );
    }
    const candles = dailyCandles(record.response, decisionTradingDate);
    const asOfTradingDate = candles.at(-1).date;
    const asOfStalenessDays =
        (tradingDateEpoch(decisionTradingDate, 'decisionTradingDate') -
            tradingDateEpoch(asOfTradingDate, 'asOfTradingDate')) /
        86_400_000;
    if (
        asOfTradingDate > requestedEndDate ||
        asOfStalenessDays < 1 ||
        asOfStalenessDays > MAX_AS_OF_STALENESS_DAYS
    ) {
        invalid(
            'latest completed Kbar is outside the bounded pre-decision freshness window',
        );
    }
    const canonicalCandles = candles.map((candle) => ({
        tradingDate: candle.date,
        open: scaledToDecimal(candle.open),
        high: scaledToDecimal(candle.high),
        low: scaledToDecimal(candle.low),
        close: scaledToDecimal(candle.close),
    }));
    const payload = Object.freeze({
        schemaVersion: SMART_ORDER_RUNTIME_FIXED_ATR_SCHEMA_VERSION,
        timeframe: '1D',
        period: PERIOD,
        algorithmVersion: SMART_ORDER_RUNTIME_FIXED_ATR_ALGORITHM_VERSION,
        value: wilderAtr(candles),
        asOfTradingDate,
        contractKey: token(record.contractKey, 'contractKey'),
        contractRevision: digest(record.contractRevision, 'contractRevision'),
        corporateActionRevision: digest(
            record.corporateActionRevision,
            'corporateActionRevision',
        ),
        strategyDefinitionHash: digest(
            record.strategyDefinitionHash,
            'strategyDefinitionHash',
        ),
        source: Object.freeze({
            sourceId: 'shioaji:/api/v1/data/kbars',
            requestedStartDate,
            requestedEndDate,
            coverageStartTradingDate: candles[0].date,
            coverageEndTradingDate: candles.at(-1).date,
            completedCandleCount: candles.length,
            // The native Kbars endpoint returns a bounded historical response,
            // not a signed exchange calendar.  Preserve that exact authority
            // level instead of claiming that every official session in the
            // requested calendar range was present.
            completeness: 'bounded_native_kbars_response',
            canonicalCandlesSha256: `sha256:${createHash('sha256')
                .update(canonicalJson(canonicalCandles))
                .digest('hex')}`,
        }),
    });
    return Object.freeze({
        ...payload,
        snapshotSha256: `sha256:${createHash('sha256')
            .update(canonicalJson(payload))
            .digest('hex')}`,
    });
}
