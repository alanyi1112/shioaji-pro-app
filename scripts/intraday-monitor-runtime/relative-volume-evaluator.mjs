import { createHash } from 'node:crypto';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const INTRADAY_RELATIVE_VOLUME_FORMULA_VERSION =
    'intraday-relative-volume-formula/1';
export const INTRADAY_RELATIVE_VOLUME_EVALUATION_SCHEMA =
    'intraday-relative-volume-evaluation/1';
export const INTRADAY_MONITOR_TRIGGER_SCHEMA = 'intraday-monitor-trigger/1';

const INPUT_KEYS = Object.freeze([
    'admitted',
    'tradeDate',
    'baselineTradeDate',
    'canonicalSymbol',
    'exchange',
    'minuteKey',
    'configRevision',
    'threshold',
    'currentCumulativeVolume',
    'previousCumulativeVolume',
    'todayCompleteness',
    'baselineCompleteness',
    'calendarCurrent',
    'sessionCurrent',
    'generationCurrent',
    'continuityComplete',
    'unit',
    'sourceVersion',
    'observationMode',
    'revisionFirstComparable',
    'createdAt',
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE = /^(?:09:[0-5]\d|1[0-2]:[0-5]\d|13:(?:[0-2]\d|30))$/;
const SYMBOL = /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function exactSnapshot(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('relative-volume input schema is invalid');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (actual.some((key) => typeof key !== 'string')) {
        throw new TypeError('relative-volume symbol properties are forbidden');
    }
    actual.sort();
    if (
        actual.length !== expected.length ||
        !actual.every((key, index) => key === expected[index])
    ) {
        throw new TypeError('relative-volume input schema is invalid');
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError('relative-volume input must use data properties');
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function parseThreshold(value) {
    if (
        typeof value !== 'string' ||
        !/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(value)
    ) {
        return undefined;
    }
    const [whole, fraction = ''] = value.split('.');
    const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (hundredths < 100 || hundredths > 10_000) return undefined;
    const canonicalFraction = String(hundredths % 100)
        .padStart(2, '0')
        .replace(/0+$/, '');
    return Object.freeze({
        decimal: canonicalFraction
            ? `${Math.floor(hundredths / 100)}.${canonicalFraction}`
            : String(Math.floor(hundredths / 100)),
        hundredths,
    });
}

function invalid(reason = 'evaluation_input_invalid') {
    return deepFreeze({
        schemaVersion: INTRADAY_RELATIVE_VOLUME_EVALUATION_SCHEMA,
        classification: 'unknown',
        reason,
        comparable: false,
        matched: false,
        exactComparison: null,
        formulaVersion: INTRADAY_RELATIVE_VOLUME_FORMULA_VERSION,
    });
}

function normalize(value) {
    const input = exactSnapshot(value, INPUT_KEYS);
    const threshold = parseThreshold(input.threshold);
    if (
        typeof input.admitted !== 'boolean' ||
        typeof input.calendarCurrent !== 'boolean' ||
        typeof input.sessionCurrent !== 'boolean' ||
        typeof input.generationCurrent !== 'boolean' ||
        typeof input.continuityComplete !== 'boolean' ||
        !DATE.test(input.tradeDate) ||
        !DATE.test(input.baselineTradeDate) ||
        input.tradeDate <= input.baselineTradeDate ||
        !SYMBOL.test(input.canonicalSymbol) ||
        !['TSE', 'OTC'].includes(input.exchange) ||
        !MINUTE.test(input.minuteKey) ||
        !Number.isSafeInteger(input.configRevision) ||
        input.configRevision < 0 ||
        !threshold ||
        !safeCount(input.currentCumulativeVolume) ||
        !safeCount(input.previousCumulativeVolume) ||
        !['complete', 'incomplete', 'missing'].includes(
            input.todayCompleteness,
        ) ||
        !['complete', 'incomplete', 'missing'].includes(
            input.baselineCompleteness,
        ) ||
        input.unit !== 'common_lot' ||
        typeof input.sourceVersion !== 'string' ||
        input.sourceVersion.length < 1 ||
        input.sourceVersion.length > 256 ||
        !['live', 'historical'].includes(input.observationMode) ||
        typeof input.revisionFirstComparable !== 'boolean' ||
        typeof input.createdAt !== 'string' ||
        !INSTANT.test(input.createdAt) ||
        !Number.isFinite(Date.parse(input.createdAt))
    ) {
        throw new TypeError('relative-volume input is invalid');
    }
    return Object.freeze({ ...input, threshold });
}

function unknownReason(input) {
    if (!input.admitted) return 'not_admitted';
    if (!input.calendarCurrent) return 'calendar_unverified';
    if (!input.sessionCurrent) return 'session_unverified';
    if (!input.generationCurrent) return 'stale_generation';
    if (!input.continuityComplete) return 'continuity_unproven';
    if (input.todayCompleteness !== 'complete') return 'today_minute_incomplete';
    if (input.baselineCompleteness !== 'complete') {
        return 'baseline_incomplete';
    }
    if (input.previousCumulativeVolume === 0) return 'zero_denominator';
    return undefined;
}

export function evaluateIntradayRelativeVolume(value) {
    let input;
    try {
        input = normalize(value);
    } catch {
        return invalid();
    }
    const reason = unknownReason(input);
    if (reason) return invalid(reason);
    const left = BigInt(input.currentCumulativeVolume) * 100n;
    const right =
        BigInt(input.threshold.hundredths) *
        BigInt(input.previousCumulativeVolume);
    const matched = left >= right;
    return deepFreeze({
        schemaVersion: INTRADAY_RELATIVE_VOLUME_EVALUATION_SCHEMA,
        classification: matched ? 'matched' : 'not_matched',
        reason: 'none',
        comparable: true,
        matched,
        exactComparison: {
            leftScaledCurrent: left.toString(),
            rightThresholdTimesPrevious: right.toString(),
            scale: 100,
            threshold: input.threshold.decimal,
            currentCumulativeVolume: input.currentCumulativeVolume,
            previousCumulativeVolume: input.previousCumulativeVolume,
        },
        formulaVersion: INTRADAY_RELATIVE_VOLUME_FORMULA_VERSION,
    });
}

function triggerSeed(input, kind) {
    return {
        schemaVersion: INTRADAY_MONITOR_TRIGGER_SCHEMA,
        kind,
        tradeDate: input.tradeDate,
        baselineTradeDate: input.baselineTradeDate,
        canonicalSymbol: input.canonicalSymbol,
        exchange: input.exchange,
        minuteKey: input.minuteKey,
        configRevision: input.configRevision,
        threshold: input.threshold.decimal,
        currentCumulativeVolume: input.currentCumulativeVolume,
        previousCumulativeVolume: input.previousCumulativeVolume,
        unit: 'common_lot',
        sourceVersion: input.sourceVersion,
        formulaVersion: INTRADAY_RELATIVE_VOLUME_FORMULA_VERSION,
        completeness: 'complete',
        createdAt: input.createdAt,
    };
}

function createEvent(input, kind) {
    const seed = triggerSeed(input, kind);
    const digest = createHash('sha256').update(canonicalJson(seed)).digest('hex');
    const event = {
        ...seed,
        eventId: `ivm_${digest}`,
        eventHash: createHash('sha256')
            .update(canonicalJson({ ...seed, eventId: `ivm_${digest}` }))
            .digest('hex'),
    };
    return deepFreeze(event);
}

export function createIntradayRelativeVolumeTriggerLedger() {
    const states = new Map();
    const events = new Map();

    function evaluate(value) {
        let input;
        try {
            input = normalize(value);
        } catch {
            return deepFreeze({
                ...invalid(),
                triggerEvent: null,
                notificationEligible: false,
                newlyCreated: false,
            });
        }
        const result = evaluateIntradayRelativeVolume(value);
        const latchKey = JSON.stringify([
            input.tradeDate,
            input.canonicalSymbol,
            input.configRevision,
        ]);
        const prior = states.get(latchKey);
        const existing = events.get(latchKey);
        if (existing) {
            return deepFreeze({
                ...result,
                triggerEvent: existing,
                notificationEligible: false,
                newlyCreated: false,
            });
        }
        if (result.classification !== 'matched') {
            states.set(latchKey, result.classification);
            return deepFreeze({
                ...result,
                triggerEvent: null,
                notificationEligible: false,
                newlyCreated: false,
            });
        }
        const liveCross =
            input.observationMode === 'live' &&
            input.revisionFirstComparable === false &&
            prior === 'not_matched';
        const kind = liveCross ? 'live' : 'historical';
        const event = createEvent(input, kind);
        events.set(latchKey, event);
        states.set(latchKey, 'matched');
        return deepFreeze({
            ...result,
            triggerEvent: event,
            notificationEligible: liveCross,
            newlyCreated: true,
        });
    }

    function getEvents() {
        return deepFreeze(
            [...events.values()].sort((left, right) =>
                left.eventId.localeCompare(right.eventId),
            ),
        );
    }

    function summarize(values) {
        if (!Array.isArray(values)) {
            throw new TypeError('evaluation batch must be an array');
        }
        const results = values.map((value) => evaluate(value));
        const matched = results.filter(
            (result) => result.classification === 'matched',
        ).length;
        const notMatched = results.filter(
            (result) => result.classification === 'not_matched',
        ).length;
        const unknown = results.length - matched - notMatched;
        return deepFreeze({
            admitted: results.length,
            matched,
            notMatched,
            unknown,
            conserved: matched + notMatched + unknown === results.length,
            results,
        });
    }

    return Object.freeze({ evaluate, getEvents, summarize });
}
