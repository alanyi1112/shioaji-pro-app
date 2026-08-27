import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
    currentSmartOrderQuickFieldMapping,
} from './quick-field-mapping.mjs';

export const SMART_ORDER_QUICK_FIELD_NORMALIZER_SCHEMA_VERSION =
    'smart-order-quick-field-normalizer/2026-08-21.1';

export const SMART_ORDER_QUICK_FIELD_IDS = Object.freeze([
    'last_price',
    'bid_price',
    'ask_price',
    'up_amount',
    'down_amount',
    'up_percent',
    'down_percent',
    'tick_quantity',
    'total_quantity',
]);

const CONTRACT_PATTERN = /^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const trustedAcceptedNormalizations = new WeakSet();

function snapshotOwnDataRecord(value, keys) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        return undefined;
    }
    let descriptors;
    try {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return undefined;
        }
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return undefined;
    }
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== expected.length ||
        !actual.sort().every((key, index) => key === expected[index])
    ) {
        return undefined;
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
            return undefined;
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function snapshotStringArray(value) {
    if (!Array.isArray(value) || utilTypes.isProxy(value)) return undefined;
    let descriptors;
    try {
        if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return undefined;
    }
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 10) {
        return undefined;
    }
    const expected = [
        ...Array.from({ length }, (_, index) => String(index)),
        'length',
    ].sort();
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== expected.length ||
        !actual.sort().every((key, index) => key === expected[index])
    ) {
        return undefined;
    }
    const snapshot = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set') ||
            typeof descriptor.value !== 'string'
        ) {
            return undefined;
        }
        snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
}

function canonicalDecimal(value) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 80 ||
        !DECIMAL_PATTERN.test(value)
    ) {
        return null;
    }
    let sign = '';
    let digits = value;
    if (digits.startsWith('-')) {
        sign = '-';
        digits = digits.slice(1);
    }
    let [integer, fraction = ''] = digits.split('.');
    fraction = fraction.replace(/0+$/, '');
    const normalized = fraction.length > 0 ? `${integer}.${fraction}` : integer;
    return normalized === '0' ? '0' : `${sign}${normalized}`;
}

function positiveDecimal(value) {
    const normalized = canonicalDecimal(value);
    return normalized !== null && normalized !== '0' && !normalized.startsWith('-')
        ? normalized
        : null;
}

function signedDirection(value) {
    const normalized = canonicalDecimal(value);
    if (normalized === null) return null;
    return Object.freeze({
        direction:
            normalized === '0'
                ? 'flat'
                : normalized.startsWith('-')
                  ? 'down'
                  : 'up',
        magnitude:
            normalized.startsWith('-') ? normalized.slice(1) : normalized,
    });
}

function percentageDirectionFromBasisPoints(value) {
    if (!Number.isSafeInteger(value)) return null;
    const direction = value === 0 ? 'flat' : value < 0 ? 'down' : 'up';
    const magnitudeBasisPoints = Math.abs(value);
    const integer = Math.floor(magnitudeBasisPoints / 100);
    const fraction = String(magnitudeBasisPoints % 100).padStart(2, '0').replace(/0+$/, '');
    return Object.freeze({
        direction,
        magnitude: fraction.length > 0 ? `${integer}.${fraction}` : String(integer),
    });
}

function compareCanonicalNonNegativeDecimals(left, right) {
    const [leftInteger, leftFraction = ''] = left.split('.');
    const [rightInteger, rightFraction = ''] = right.split('.');
    if (leftInteger.length !== rightInteger.length) {
        return leftInteger.length < rightInteger.length ? -1 : 1;
    }
    if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
    const scale = Math.max(leftFraction.length, rightFraction.length);
    const scaledLeft = leftFraction.padEnd(scale, '0');
    const scaledRight = rightFraction.padEnd(scale, '0');
    return scaledLeft === scaledRight ? 0 : scaledLeft < scaledRight ? -1 : 1;
}

function exchangeTimestamp(date, time) {
    if (typeof date !== 'string' || typeof time !== 'string') return null;
    const dateMatch = /^(\d{4})([/-])(\d{2})\2(\d{2})$/.exec(date);
    const timeMatch = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(time);
    if (!dateMatch || !timeMatch) return null;
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[3]);
    const day = Number(dateMatch[4]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const second = Number(timeMatch[3]);
    const millisecond = Number((timeMatch[4] ?? '').padEnd(3, '0').slice(0, 3));
    if (hour > 23 || minute > 59 || second > 59) return null;
    const utcEpochMs =
        Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
        8 * 60 * 60 * 1000;
    const taipei = new Date(utcEpochMs + 8 * 60 * 60 * 1000);
    if (
        taipei.getUTCFullYear() !== year ||
        taipei.getUTCMonth() !== month - 1 ||
        taipei.getUTCDate() !== day ||
        taipei.getUTCHours() !== hour ||
        taipei.getUTCMinutes() !== minute ||
        taipei.getUTCSeconds() !== second
    ) {
        return null;
    }
    return Object.freeze({
        exchangeTimeMs: utcEpochMs,
        tradeDate: `${dateMatch[1]}-${dateMatch[3]}-${dateMatch[4]}`,
    });
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function projection(field, value, sourceKind, sourceField) {
    const mapping = currentSmartOrderQuickFieldMapping(field);
    if (
        !mapping ||
        mapping.sourceKind !== sourceKind ||
        mapping.sourceField !== sourceField
    ) {
        throw new TypeError('quick field projection is not in the current mapping');
    }
    const protectiveTriggerCandidate = field === 'last_price';
    return Object.freeze({
        field,
        value,
        sourceKind,
        sourceField,
        localUnit: mapping.localUnit,
        mappingState: 'verified_current',
        mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        mappingDefinitionSha256:
            SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
        protectiveTriggerCandidate,
        protectiveTriggerRequiresCurrentFreshness:
            protectiveTriggerCandidate,
        protectiveTriggerAuthority: false,
        conditionEligibilityAuthority: false,
    });
}

function disabledField(field, reason) {
    const mapping = currentSmartOrderQuickFieldMapping(field);
    if (!mapping) {
        throw new TypeError('disabled quick field is not in the current mapping');
    }
    return Object.freeze({
        field,
        reason,
        localUnit: mapping.localUnit,
        mappingState: 'verified_current',
        mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        mappingDefinitionSha256:
            SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
        protectiveTriggerAuthority: false,
        conditionEligibilityAuthority: false,
    });
}

function rejected(reason) {
    return Object.freeze({
        schemaVersion: SMART_ORDER_QUICK_FIELD_NORMALIZER_SCHEMA_VERSION,
        accepted: false,
        reason,
        projections: Object.freeze([]),
        disabledFields: Object.freeze([]),
        mappingVerified: false,
        mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        mappingDefinitionSha256:
            SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
        runtimeReadinessContribution: false,
        brokerWriteAuthority: false,
    });
}

/**
 * Normalizes a transport-owned projection of one Shioaji Tick/BidAsk event.
 * The mapping definition is immutable and code-owned.  A normalized result is
 * still not a quote/trigger authority: only the private production transport
 * coordinator can combine it with a current subscription lineage and
 * freshness head.
 */
export function normalizeSmartOrderQuickFieldEvent(input) {
    const request = snapshotOwnDataRecord(input, [
        'contractKey',
        'event',
        'receiveTimeMs',
        'sequence',
        'streamEpoch',
    ]);
    if (
        !request ||
        typeof request.contractKey !== 'string' ||
        !CONTRACT_PATTERN.test(request.contractKey) ||
        typeof request.streamEpoch !== 'string' ||
        !TOKEN_PATTERN.test(request.streamEpoch) ||
        !Number.isSafeInteger(request.sequence) ||
        request.sequence < 0 ||
        !Number.isSafeInteger(request.receiveTimeMs) ||
        request.receiveTimeMs < 0
    ) {
        return rejected('input_schema_invalid');
    }

    if (utilTypes.isProxy(request.event)) return rejected('event_schema_invalid');
    const eventKind =
        request.event && typeof request.event === 'object'
            ? Object.getOwnPropertyDescriptor(request.event, 'eventKind')?.value
            : undefined;
    const event =
        eventKind === 'tick'
            ? snapshotOwnDataRecord(request.event, [
                  'close',
                  'code',
                  'date',
                  'eventKind',
                  'intradayOdd',
                  'percentChange',
                  'priceChange',
                  'simtrade',
                  'time',
                  'totalVolume',
                  'volume',
              ])
            : eventKind === 'bidask'
              ? snapshotOwnDataRecord(request.event, [
                    'askPrices',
                    'bidPrices',
                    'code',
                    'date',
                    'eventKind',
                    'intradayOdd',
                    'simtrade',
                    'time',
                ])
              : undefined;
    if (!event) return rejected('event_schema_invalid');
    if (
        typeof event.code !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(event.code) ||
        typeof event.simtrade !== 'boolean' ||
        typeof event.intradayOdd !== 'boolean'
    ) {
        return rejected('event_schema_invalid');
    }
    if (!request.contractKey.endsWith(`:${event.code}`)) {
        return rejected('contract_mismatch');
    }
    const timestamp = exchangeTimestamp(event.date, event.time);
    if (!timestamp || request.receiveTimeMs < timestamp.exchangeTimeMs) {
        return rejected('event_time_invalid');
    }
    if (event.simtrade) return rejected('simtrade');
    if (event.intradayOdd) return rejected('intraday_odd');

    const projections = [];
    const disabledFields = [];
    if (event.eventKind === 'tick') {
        if (
            !Number.isSafeInteger(event.volume) ||
            event.volume <= 0 ||
            !Number.isSafeInteger(event.totalVolume) ||
            event.totalVolume < event.volume
        ) {
            return rejected('tick_quantity_invalid');
        }
        const lastPrice = positiveDecimal(event.close);
        if (!lastPrice) {
            return rejected('tick_value_invalid');
        }
        projections.push(projection('last_price', lastPrice, 'tick', 'close'));
        projections.push(
            projection('tick_quantity', String(event.volume), 'tick', 'volume'),
            projection(
                'total_quantity',
                String(event.totalVolume),
                'tick',
                'total_volume',
            ),
        );
        const priceDirection = signedDirection(event.priceChange);
        const percentDirection = percentageDirectionFromBasisPoints(
            event.percentChange,
        );
        if (
            priceDirection &&
            percentDirection &&
            priceDirection.direction !== percentDirection.direction
        ) {
            return rejected('tick_direction_conflict');
        }
        const directionalProjections = [];
        for (const [direction, suffix, sourceField] of [
            [priceDirection, 'amount', 'price_chg'],
            [percentDirection, 'percent', 'pct_chg'],
        ]) {
            const upField = `up_${suffix}`;
            const downField = `down_${suffix}`;
            if (!direction) {
                disabledFields.push(
                    disabledField(upField, 'source_missing_or_invalid'),
                    disabledField(downField, 'source_missing_or_invalid'),
                );
            } else {
                directionalProjections.push(
                    projection(
                        upField,
                        direction.direction === 'up' ? direction.magnitude : '0',
                        'tick',
                        sourceField,
                    ),
                    projection(
                        downField,
                        direction.direction === 'down' ? direction.magnitude : '0',
                        'tick',
                        sourceField,
                    ),
                );
            }
        }
        projections.splice(1, 0, ...directionalProjections);
    } else {
        const bidPrices = snapshotStringArray(event.bidPrices);
        const askPrices = snapshotStringArray(event.askPrices);
        if (!bidPrices || !askPrices) return rejected('book_schema_invalid');
        const bid = bidPrices.length > 0 ? positiveDecimal(bidPrices[0]) : null;
        const ask = askPrices.length > 0 ? positiveDecimal(askPrices[0]) : null;
        if (bid) projections.push(projection('bid_price', bid, 'bidask', 'bid_price[0]'));
        else disabledFields.push(disabledField('bid_price', 'book_side_empty'));
        if (ask) projections.push(projection('ask_price', ask, 'bidask', 'ask_price[0]'));
        else disabledFields.push(disabledField('ask_price', 'book_side_empty'));
        if (projections.length === 0) return rejected('book_empty');
        if (bid && ask && compareCanonicalNonNegativeDecimals(bid, ask) > 0) {
            return rejected('crossed_book');
        }
    }

    const immutableProjections = Object.freeze(projections);
    const immutableDisabledFields = Object.freeze(disabledFields);
    const eventFingerprintSha256 = sha256(
        `${SMART_ORDER_QUICK_FIELD_NORMALIZER_SCHEMA_VERSION}\n${canonicalJson({
            contractKey: request.contractKey,
            eventKind: event.eventKind,
            exchangeTimeMs: timestamp.exchangeTimeMs,
            disabledFields: immutableDisabledFields,
            projections: immutableProjections,
            receiveTimeMs: request.receiveTimeMs,
            sequence: request.sequence,
            streamEpoch: request.streamEpoch,
            tradeDate: timestamp.tradeDate,
        })}`,
    );
    const result = Object.freeze({
        schemaVersion: SMART_ORDER_QUICK_FIELD_NORMALIZER_SCHEMA_VERSION,
        accepted: true,
        reason: null,
        contractKey: request.contractKey,
        eventKind: event.eventKind,
        tradeDate: timestamp.tradeDate,
        exchangeTimeMs: timestamp.exchangeTimeMs,
        receiveTimeMs: request.receiveTimeMs,
        streamEpoch: request.streamEpoch,
        sequence: request.sequence,
        eventFingerprintSha256,
        projections: immutableProjections,
        disabledFields: immutableDisabledFields,
        protectiveTriggerPolicy:
            'current_fresh_normal_lot_last_trade_only',
        mappingVerified: true,
        mappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        mappingDefinitionSha256:
            SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
        runtimeReadinessContribution: false,
        brokerWriteAuthority: false,
    });
    trustedAcceptedNormalizations.add(result);
    return result;
}

export function isTrustedSmartOrderQuickFieldNormalization(value) {
    try {
        return (
            !!value &&
            typeof value === 'object' &&
            !utilTypes.isProxy(value) &&
            Object.isFrozen(value) &&
            trustedAcceptedNormalizations.has(value) &&
            value.accepted === true &&
            value.mappingVerified === true &&
            value.mappingRevision === SMART_ORDER_QUICK_FIELD_MAPPING_REVISION &&
            value.mappingDefinitionSha256 ===
                SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256
        );
    } catch {
        return false;
    }
}
