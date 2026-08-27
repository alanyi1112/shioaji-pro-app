import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION =
    'smart-order-broker-event-candidate/2026-08-13.1';
export const SMART_ORDER_BROKER_EVENT_SCHEMA_VERSION =
    'smart-order-broker-event/2026-08-13.1';

const EVENT_KINDS = new Set(['order', 'deal']);
const SIDES = new Set(['Buy', 'Sell']);
const QUANTITY_UNITS = new Set(['Share', 'CommonLot']);
const ORDER_STATUSES = new Set([
    'PendingSubmit',
    'PreSubmitted',
    'Submitted',
    'PartFilled',
    'Filled',
    'Cancelled',
    'Inactive',
    'Failed',
]);
const ORDER_CONDITIONS = new Set([
    'Cash',
    'Netting',
    'MarginTrading',
    'ShortSelling',
    'Emerging',
]);
const ORDER_LOTS = new Set([
    'Common',
    'Odd',
    'IntradayOdd',
    'Fixing',
    'BlockTrade',
]);
const PRICE_TYPES = new Set(['LMT', 'MKT', 'MKP']);
const TIME_IN_FORCE = new Set(['ROD', 'IOC', 'FOK']);
const normalizedBrokerEventRecords = new WeakSet();
const NORMALIZED_EVENT_KEYS = Object.freeze([
    'schemaVersion',
    'mappingRevision',
    'apiGeneration',
    'eventKind',
    'account',
    'tradeDate',
    'contractKey',
    'side',
    'identifiers',
    'operation',
    'status',
    'orderClass',
    'quantities',
    'price',
    'timestamps',
    'brokerOrderCorrelationKeySha256',
    'brokerEventKeySha256',
    'brokerEventEvidenceSha256',
    'payloadSha256',
]);

function snapshotExactObject(value, requiredKeys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
        actualKeys.some((key) => typeof key !== 'string') ||
        canonicalJson([...actualKeys].sort()) !==
            canonicalJson([...requiredKeys].sort())
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const snapshot = {};
    for (const key of requiredKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !Object.hasOwn(descriptor, 'value') ||
            descriptor.enumerable !== true
        ) {
            throw new TypeError(`${label} schema is invalid`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function token(value, label, maximumLength = 160) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumLength ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function nullableToken(value, label, maximumLength = 160) {
    return value === null ? null : token(value, label, maximumLength);
}

function canonicalCustomField(value) {
    if (value === null) return null;
    if (
        typeof value !== 'string' ||
        value.length > 6 ||
        !/^[A-Za-z0-9]*$/.test(value)
    ) {
        throw new TypeError(
            'customField must contain at most six alphanumeric characters',
        );
    }
    return value;
}

function safeInteger(value, label, { minimum = 0 } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
    }
    return value;
}

function nullableEpoch(value, label) {
    return value === null ? null : safeInteger(value, label);
}

function taipeiTradeDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new TypeError('tradeDate must be an Asia/Taipei calendar date');
    }
    const [year, month, day] = value.split('-').map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
    ) {
        throw new TypeError('tradeDate must be a real Gregorian date');
    }
    return value;
}

const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function taipeiDateForEpochMs(epochMs) {
    const parts = Object.fromEntries(
        TAIPEI_DATE_FORMATTER.formatToParts(new Date(epochMs)).map((part) => [
            part.type,
            part.value,
        ]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function canonicalDecimal(value, label) {
    if (
        typeof value !== 'string' ||
        !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value)
    ) {
        throw new TypeError(`${label} must be a canonical decimal string`);
    }
    return value;
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function canonicalAccount(value) {
    const account = snapshotExactObject(
        value,
        ['brokerId', 'accountId', 'accountType'],
        'broker event account',
    );
    if (account.accountType !== 'S') {
        throw new TypeError('smart-order broker event must use a stock account');
    }
    return Object.freeze({
        brokerId: token(account.brokerId, 'account.brokerId', 128),
        accountId: token(account.accountId, 'account.accountId', 128),
        accountType: 'S',
    });
}

function canonicalIdentifiers(value, eventKind) {
    const keys = [
        'tradeId',
        'orderId',
        'dealId',
        'seqno',
        'ordno',
        'exchangeSequence',
        'customField',
    ];
    const identifier = snapshotExactObject(
        value,
        keys,
        'broker event identifier',
    );
    const identifiers = {
        tradeId: token(identifier.tradeId, 'identifiers.tradeId'),
        orderId:
            eventKind === 'order'
                ? token(identifier.orderId, 'identifiers.orderId')
                : nullableToken(identifier.orderId, 'identifiers.orderId'),
        dealId: nullableToken(identifier.dealId, 'identifiers.dealId'),
        seqno: token(identifier.seqno, 'identifiers.seqno'),
        ordno: token(identifier.ordno, 'identifiers.ordno'),
        exchangeSequence:
            eventKind === 'deal'
                ? token(
                      identifier.exchangeSequence,
                      'identifiers.exchangeSequence',
                  )
                : nullableToken(
                      identifier.exchangeSequence,
                      'identifiers.exchangeSequence',
                  ),
        customField: canonicalCustomField(identifier.customField),
    };
    return Object.freeze(identifiers);
}

function canonicalOperation(value, eventKind) {
    const operation = snapshotExactObject(
        value,
        ['type', 'code', 'message'],
        'broker event operation',
    );
    if (eventKind === 'deal') {
        if (
            operation.type !== null ||
            operation.code !== null ||
            operation.message !== null
        ) {
            throw new TypeError('deal event operation fields must be null');
        }
        return Object.freeze({ type: null, code: null, message: null });
    }
    return Object.freeze({
        type: token(operation.type, 'operation.type', 64),
        code: token(operation.code, 'operation.code', 64),
        message: nullableToken(operation.message, 'operation.message', 512),
    });
}

function canonicalOrderClass(value) {
    const orderClass = snapshotExactObject(
        value,
        ['orderCondition', 'orderLot', 'priceType', 'timeInForce'],
        'broker event order class',
    );
    if (!ORDER_CONDITIONS.has(orderClass.orderCondition)) {
        throw new TypeError('broker event order condition is unknown');
    }
    if (!ORDER_LOTS.has(orderClass.orderLot)) {
        throw new TypeError('broker event order lot is unknown');
    }
    if (!PRICE_TYPES.has(orderClass.priceType)) {
        throw new TypeError('broker event price type is unknown');
    }
    if (!TIME_IN_FORCE.has(orderClass.timeInForce)) {
        throw new TypeError('broker event time in force is unknown');
    }
    return Object.freeze({
        orderCondition: orderClass.orderCondition,
        orderLot: orderClass.orderLot,
        priceType: orderClass.priceType,
        timeInForce: orderClass.timeInForce,
    });
}

function canonicalQuantities(value, eventKind) {
    const quantity = snapshotExactObject(
        value,
        [
            'order',
            'cumulativeDeal',
            'cumulativeCancel',
            'remaining',
            'eventDeal',
            'unit',
        ],
        'broker event quantity',
    );
    if (!QUANTITY_UNITS.has(quantity.unit)) {
        throw new TypeError('broker event quantity unit is unknown');
    }
    const quantities = {
        order: safeInteger(quantity.order, 'quantities.order', { minimum: 1 }),
        cumulativeDeal: safeInteger(
            quantity.cumulativeDeal,
            'quantities.cumulativeDeal',
        ),
        cumulativeCancel: safeInteger(
            quantity.cumulativeCancel,
            'quantities.cumulativeCancel',
        ),
        remaining: safeInteger(quantity.remaining, 'quantities.remaining'),
        eventDeal: safeInteger(quantity.eventDeal, 'quantities.eventDeal'),
        unit: quantity.unit,
    };
    if (
        quantities.cumulativeDeal +
            quantities.cumulativeCancel +
            quantities.remaining !==
        quantities.order
    ) {
        throw new TypeError('broker event cumulative quantities are inconsistent');
    }
    if (
        (eventKind === 'order' && quantities.eventDeal !== 0) ||
        (eventKind === 'deal' && quantities.eventDeal < 1) ||
        quantities.eventDeal > quantities.cumulativeDeal
    ) {
        throw new TypeError('broker event deal quantity is inconsistent');
    }
    return Object.freeze(quantities);
}

function assertStatusQuantityConsistency(
    status,
    quantities,
    eventKind,
) {
    if (
        status === 'Filled' &&
        (quantities.cumulativeDeal !== quantities.order ||
            quantities.cumulativeCancel !== 0 ||
            quantities.remaining !== 0)
    ) {
        throw new TypeError('filled broker event quantity is inconsistent');
    }
    if (
        status === 'PartFilled' &&
        (quantities.cumulativeDeal < 1 || quantities.remaining < 1)
    ) {
        throw new TypeError(
            'part-filled broker event quantity is inconsistent',
        );
    }
    if (
        status === 'Cancelled' &&
        (quantities.remaining !== 0 ||
            quantities.cumulativeDeal + quantities.cumulativeCancel !==
                quantities.order)
    ) {
        throw new TypeError('cancelled broker event quantity is inconsistent');
    }
    if (
        eventKind === 'deal' &&
        status !== 'PartFilled' &&
        status !== 'Filled'
    ) {
        throw new TypeError('deal event status is inconsistent');
    }
}

function canonicalTimestamps(value) {
    const timestamps = snapshotExactObject(
        value,
        ['exchangeEpochMs', 'brokerEpochMs', 'receiveEpochMs'],
        'broker event timestamp',
    );
    const canonical = {
        exchangeEpochMs: safeInteger(
            timestamps.exchangeEpochMs,
            'timestamps.exchangeEpochMs',
        ),
        brokerEpochMs: nullableEpoch(
            timestamps.brokerEpochMs,
            'timestamps.brokerEpochMs',
        ),
        receiveEpochMs: safeInteger(
            timestamps.receiveEpochMs,
            'timestamps.receiveEpochMs',
        ),
    };
    if (
        canonical.exchangeEpochMs > canonical.receiveEpochMs ||
        (canonical.brokerEpochMs !== null &&
            (canonical.brokerEpochMs > canonical.receiveEpochMs ||
                canonical.exchangeEpochMs > canonical.brokerEpochMs))
    ) {
        throw new TypeError('broker event timestamp order is inconsistent');
    }
    return Object.freeze(canonical);
}

export function normalizeCanonicalSmartOrderBrokerEvent(candidate) {
    const input = snapshotExactObject(
        candidate,
        [
            'schemaVersion',
            'mappingRevision',
            'apiGeneration',
            'eventKind',
            'account',
            'tradeDate',
            'contractKey',
            'side',
            'identifiers',
            'operation',
            'status',
            'orderClass',
            'quantities',
            'price',
            'timestamps',
        ],
        'broker event candidate',
    );
    if (
        input.schemaVersion !==
        SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION
    ) {
        throw new TypeError('broker event candidate schema is stale');
    }
    if (!EVENT_KINDS.has(input.eventKind)) {
        throw new TypeError('broker event kind is unsupported');
    }
    if (!SIDES.has(input.side)) {
        throw new TypeError('broker event side is unknown');
    }
    if (!ORDER_STATUSES.has(input.status)) {
        throw new TypeError('broker event status is unknown');
    }
    const account = canonicalAccount(input.account);
    const identifiers = canonicalIdentifiers(
        input.identifiers,
        input.eventKind,
    );
    const quantities = canonicalQuantities(input.quantities, input.eventKind);
    assertStatusQuantityConsistency(input.status, quantities, input.eventKind);
    const tradeDate = taipeiTradeDate(input.tradeDate);
    const timestamps = canonicalTimestamps(input.timestamps);
    if (taipeiDateForEpochMs(timestamps.exchangeEpochMs) !== tradeDate) {
        throw new TypeError(
            'tradeDate must match the exchange timestamp in Asia/Taipei',
        );
    }
    const content = {
        schemaVersion: SMART_ORDER_BROKER_EVENT_SCHEMA_VERSION,
        mappingRevision: token(input.mappingRevision, 'mappingRevision'),
        apiGeneration: token(input.apiGeneration, 'apiGeneration'),
        eventKind: input.eventKind,
        account,
        tradeDate,
        contractKey: token(input.contractKey, 'contractKey'),
        side: input.side,
        identifiers,
        operation: canonicalOperation(input.operation, input.eventKind),
        status: input.status,
        orderClass: canonicalOrderClass(input.orderClass),
        quantities,
        price:
            input.price === null
                ? null
                : canonicalDecimal(input.price, 'price'),
        timestamps,
    };
    const brokerOrderCorrelation = {
        account,
        tradeDate: content.tradeDate,
        contractKey: content.contractKey,
        side: content.side,
        tradeId: identifiers.tradeId,
        seqno: identifiers.seqno,
    };
    const brokerOrderCorrelationKeySha256 = sha256(
        canonicalJson(brokerOrderCorrelation),
    );
    const brokerEventKeySha256 = sha256(
        canonicalJson({
            brokerOrderCorrelationKeySha256,
            eventKind: content.eventKind,
            dealId: identifiers.dealId,
            exchangeSequence: identifiers.exchangeSequence,
            status: content.status,
            eventDeal: content.quantities.eventDeal,
            exchangeEpochMs: content.timestamps.exchangeEpochMs,
        }),
    );
    const brokerEventEvidenceSha256 = sha256(
        canonicalJson({
            ...content,
            timestamps: {
                exchangeEpochMs: content.timestamps.exchangeEpochMs,
                brokerEpochMs: content.timestamps.brokerEpochMs,
            },
        }),
    );
    const normalized = {
        ...content,
        brokerOrderCorrelationKeySha256,
        brokerEventKeySha256,
        brokerEventEvidenceSha256,
    };
    const event = deepFreeze({
        ...normalized,
        payloadSha256: sha256(canonicalJson(normalized)),
    });
    normalizedBrokerEventRecords.add(event);
    return event;
}

export function isNormalizedCanonicalSmartOrderBrokerEvent(value) {
    return Boolean(
        value &&
            typeof value === 'object' &&
            normalizedBrokerEventRecords.has(value),
    );
}

/**
 * Rebuilds a worker-cloned event from its canonical source projection. The
 * WeakSet authority cannot cross worker_threads, so the repository repeats the
 * complete normalization and compares every derived digest before persisting.
 */
export function revalidateNormalizedCanonicalSmartOrderBrokerEvent(value) {
    const input = snapshotExactObject(
        value,
        NORMALIZED_EVENT_KEYS,
        'normalized broker event',
    );
    const rebuilt = normalizeCanonicalSmartOrderBrokerEvent({
        schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
        mappingRevision: input.mappingRevision,
        apiGeneration: input.apiGeneration,
        eventKind: input.eventKind,
        account: input.account,
        tradeDate: input.tradeDate,
        contractKey: input.contractKey,
        side: input.side,
        identifiers: input.identifiers,
        operation: input.operation,
        status: input.status,
        orderClass: input.orderClass,
        quantities: input.quantities,
        price: input.price,
        timestamps: input.timestamps,
    });
    if (canonicalJson(rebuilt) !== canonicalJson(input)) {
        throw new TypeError(
            'normalized broker event derived fields do not match its canonical source',
        );
    }
    return rebuilt;
}

function scopedIdentifierKey(event, kind, value) {
    return canonicalJson({
        account: event.account,
        tradeDate: event.tradeDate,
        kind,
        value,
    });
}

const ORDER_STATUS_PROGRESS = Object.freeze({
    PendingSubmit: 0,
    PreSubmitted: 1,
    Submitted: 2,
    PartFilled: 3,
    Filled: 4,
    Cancelled: 4,
    Inactive: 4,
    Failed: 4,
});

function compareBrokerOrderProgress(previous, current) {
    if (
        previous.quantities.order !== current.quantities.order ||
        previous.quantities.unit !== current.quantities.unit
    ) {
        throw new Error('broker order quantity lineage changed');
    }
    const projectionChanged =
        current.status !== previous.status ||
        current.quantities.cumulativeDeal !==
            previous.quantities.cumulativeDeal ||
        current.quantities.cumulativeCancel !==
            previous.quantities.cumulativeCancel ||
        current.quantities.remaining !== previous.quantities.remaining;
    if (
        ORDER_STATUS_PROGRESS[previous.status] === 4 &&
        projectionChanged
    ) {
        throw new Error('terminal broker order evidence cannot change');
    }
    const regresses =
        current.quantities.cumulativeDeal <
            previous.quantities.cumulativeDeal ||
        current.quantities.cumulativeCancel <
            previous.quantities.cumulativeCancel ||
        current.quantities.remaining > previous.quantities.remaining ||
        ORDER_STATUS_PROGRESS[current.status] <
            ORDER_STATUS_PROGRESS[previous.status];
    if (
        current.timestamps.exchangeEpochMs ===
            previous.timestamps.exchangeEpochMs &&
        projectionChanged
    ) {
        throw new Error('broker order head has conflicting same-time evidence');
    }
    if (
        current.timestamps.exchangeEpochMs <
            previous.timestamps.exchangeEpochMs ||
        regresses
    ) {
        return 'stale';
    }
    return 'after';
}

function assertDealQuantityDelta(previous, current) {
    if (current.eventKind !== 'deal') return;
    const previousCumulativeDeal =
        previous?.quantities.cumulativeDeal ?? 0;
    if (
        current.quantities.cumulativeDeal - previousCumulativeDeal !==
        current.quantities.eventDeal
    ) {
        throw new Error(
            'deal event quantity does not match the cumulative deal delta',
        );
    }
}

export function createCanonicalSmartOrderBrokerEventLedger() {
    const eventPayloads = new Map();
    const stableOrderIdentifiers = new Map();
    const stableIdentifiersByOrder = new Map();
    const eventIdentifiers = new Map();
    const orderHeads = new Map();
    function acceptNormalized(event) {
        if (
            !event ||
            typeof event !== 'object' ||
            !normalizedBrokerEventRecords.has(event)
        ) {
            throw new TypeError(
                'normalized broker event authority is invalid',
            );
        }
        const existingEvidence = eventPayloads.get(
            event.brokerEventKeySha256,
        );
        if (existingEvidence !== undefined) {
            if (existingEvidence !== event.brokerEventEvidenceSha256) {
                throw new Error('broker event key has conflicting evidence');
            }
            return Object.freeze({ state: 'duplicate', event });
        }
        for (const [kind, value] of [
                ['tradeId', event.identifiers.tradeId],
                ['orderId', event.identifiers.orderId],
                ['seqno', event.identifiers.seqno],
                ['ordno', event.identifiers.ordno],
        ]) {
                if (value === null) continue;
                if (kind === 'orderId') {
                    const existingLineageValue = stableIdentifiersByOrder
                        .get(event.brokerOrderCorrelationKeySha256)
                        ?.get(kind);
                    if (
                        existingLineageValue !== undefined &&
                        existingLineageValue !== value
                    ) {
                        throw new Error(
                            `${kind} changed within one broker order lineage`,
                        );
                    }
                }
                const key = scopedIdentifierKey(event, kind, value);
                const existingCorrelation = stableOrderIdentifiers.get(key);
                if (
                    existingCorrelation !== undefined &&
                    existingCorrelation !==
                        event.brokerOrderCorrelationKeySha256
                ) {
                    throw new Error(
                        `${kind} collides with another same-date broker order`,
                    );
                }
        }
        for (const [kind, value] of [
                ...(event.identifiers.exchangeSequence === null
                    ? []
                    : [[
                          'exchangeSequence',
                          event.identifiers.exchangeSequence,
                      ]]),
                ...(event.identifiers.dealId === null
                    ? []
                    : [['dealId', event.identifiers.dealId]]),
        ]) {
                const key = scopedIdentifierKey(event, kind, value);
                const existingEvent = eventIdentifiers.get(key);
                if (
                    existingEvent !== undefined &&
                    existingEvent !== event.brokerEventKeySha256
                ) {
                    throw new Error(`${kind} has conflicting broker events`);
                }
        }
        const previousHead = orderHeads.get(
            event.brokerOrderCorrelationKeySha256,
        );
        if (previousHead !== undefined) {
            if (compareBrokerOrderProgress(previousHead, event) === 'stale') {
                return Object.freeze({ state: 'stale', event });
            }
        }
        assertDealQuantityDelta(previousHead, event);
        eventPayloads.set(
            event.brokerEventKeySha256,
            event.brokerEventEvidenceSha256,
        );
        const lineageIdentifiers =
            stableIdentifiersByOrder.get(
                event.brokerOrderCorrelationKeySha256,
            ) ?? new Map();
        for (const [kind, value] of [
                ['tradeId', event.identifiers.tradeId],
                ['orderId', event.identifiers.orderId],
                ['seqno', event.identifiers.seqno],
                ['ordno', event.identifiers.ordno],
        ]) {
                if (value === null) continue;
                stableOrderIdentifiers.set(
                    scopedIdentifierKey(event, kind, value),
                    event.brokerOrderCorrelationKeySha256,
                );
                if (kind === 'orderId') {
                    lineageIdentifiers.set(kind, value);
                }
        }
        stableIdentifiersByOrder.set(
            event.brokerOrderCorrelationKeySha256,
            lineageIdentifiers,
        );
        if (event.identifiers.exchangeSequence !== null) {
            eventIdentifiers.set(
                scopedIdentifierKey(
                    event,
                    'exchangeSequence',
                    event.identifiers.exchangeSequence,
                ),
                event.brokerEventKeySha256,
            );
        }
        if (event.identifiers.dealId !== null) {
            eventIdentifiers.set(
                scopedIdentifierKey(
                    event,
                    'dealId',
                    event.identifiers.dealId,
                ),
                event.brokerEventKeySha256,
            );
        }
        orderHeads.set(event.brokerOrderCorrelationKeySha256, event);
        return Object.freeze({ state: 'accepted', event });
    }
    return Object.freeze({
        schemaVersion: 'smart-order-broker-event-ledger/2026-08-13.1',
        accept(candidate) {
            return acceptNormalized(
                normalizeCanonicalSmartOrderBrokerEvent(candidate),
            );
        },
        acceptNormalized(event) {
            return acceptNormalized(event);
        },
        get size() {
            return eventPayloads.size;
        },
    });
}
