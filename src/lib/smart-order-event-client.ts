import { assertSmartOrderBrowserGatewayAvailable } from './smart-order-client';

const SMART_ORDER_EVENT_ROUTE = '/__smart-orders/v1/events';
const SMART_ORDER_EVENT_SCHEMA_VERSION =
    'smart-order-event-projection/2026-08-11.1';
const TOKEN_PATTERN = /^[^\u0000-\u001f\u007f]{1,160}$/;

export interface SmartOrderRuntimeEvent {
    readonly sequence: number;
    readonly entityKind: string;
    readonly reasonCode: string;
    readonly revision: number;
    readonly summaryCode: string;
    readonly exchangeEpochMs: number | null;
    readonly brokerEpochMs: number | null;
    readonly receiveEpochMs: number;
}

export type SmartOrderEventCursorStatus =
    | 'initialized'
    | 'current'
    | 'gap';

export interface SmartOrderEventCursor {
    readonly schemaVersion: typeof SMART_ORDER_EVENT_SCHEMA_VERSION;
    readonly cursorStatus: SmartOrderEventCursorStatus;
    readonly nextSequence: number;
    readonly highWaterSequence: number;
}

export interface SmartOrderEventSubscriptionHandlers {
    readonly onRuntimeEvent: (event: SmartOrderRuntimeEvent) => void;
    readonly onCursor?: (cursor: SmartOrderEventCursor) => void;
    readonly onGap: (cursor: SmartOrderEventCursor) => void;
    readonly onTransportError?: () => void;
}

interface EventSourceMessageLike {
    readonly data: string;
    readonly lastEventId: string;
}

interface EventSourceLike {
    addEventListener(
        type: string,
        listener: (event: EventSourceMessageLike) => void,
    ): void;
    close(): void;
    setErrorHandler(listener: () => void): void;
}

export type SmartOrderEventSourceFactory = (
    url: string,
) => EventSourceLike;

function exactObject(
    value: unknown,
    keys: readonly string[],
): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    if (
        actual.length !== expected.length ||
        actual.some((key, index) => key !== expected[index])
    ) {
        return null;
    }
    return record;
}

function safeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function token(value: unknown): value is string {
    return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function parseJson(value: string): unknown {
    if (value.length === 0 || value.length > 16_384) {
        throw new TypeError('smart-order event data is invalid');
    }
    try {
        return JSON.parse(value);
    } catch {
        throw new TypeError('smart-order event data is invalid');
    }
}

export function parseSmartOrderRuntimeEvent(
    message: EventSourceMessageLike,
): SmartOrderRuntimeEvent {
    const record = exactObject(parseJson(message.data), [
        'brokerEpochMs',
        'entityKind',
        'exchangeEpochMs',
        'reasonCode',
        'receiveEpochMs',
        'revision',
        'sequence',
        'summaryCode',
    ]);
    if (
        !record ||
        !safeInteger(record.sequence) ||
        record.sequence < 1 ||
        message.lastEventId !== String(record.sequence) ||
        !token(record.entityKind) ||
        !token(record.reasonCode) ||
        !token(record.summaryCode) ||
        !safeInteger(record.revision) ||
        !safeInteger(record.receiveEpochMs) ||
        (record.exchangeEpochMs !== null &&
            (!safeInteger(record.exchangeEpochMs) ||
                record.exchangeEpochMs > record.receiveEpochMs)) ||
        (record.brokerEpochMs !== null &&
            (!safeInteger(record.brokerEpochMs) ||
                record.brokerEpochMs > record.receiveEpochMs))
    ) {
        throw new TypeError('smart-order event payload is invalid');
    }
    return Object.freeze({
        sequence: record.sequence,
        entityKind: record.entityKind,
        reasonCode: record.reasonCode,
        revision: record.revision,
        summaryCode: record.summaryCode,
        exchangeEpochMs: record.exchangeEpochMs as number | null,
        brokerEpochMs: record.brokerEpochMs as number | null,
        receiveEpochMs: record.receiveEpochMs,
    });
}

export function parseSmartOrderEventCursor(
    message: EventSourceMessageLike,
): SmartOrderEventCursor {
    const record = exactObject(parseJson(message.data), [
        'cursorStatus',
        'highWaterSequence',
        'nextSequence',
        'schemaVersion',
    ]);
    if (
        !record ||
        record.schemaVersion !== SMART_ORDER_EVENT_SCHEMA_VERSION ||
        !['initialized', 'current', 'gap'].includes(
            String(record.cursorStatus),
        ) ||
        !safeInteger(record.nextSequence) ||
        !safeInteger(record.highWaterSequence) ||
        record.highWaterSequence < record.nextSequence ||
        message.lastEventId !== String(record.nextSequence)
    ) {
        throw new TypeError('smart-order event cursor is invalid');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_EVENT_SCHEMA_VERSION,
        cursorStatus: record.cursorStatus as SmartOrderEventCursorStatus,
        nextSequence: record.nextSequence,
        highWaterSequence: record.highWaterSequence,
    });
}

function browserEventSource(url: string): EventSourceLike {
    const source = new EventSource(url, { withCredentials: true });
    return {
        addEventListener(type, listener) {
            source.addEventListener(type, (event) => {
                const message = event as MessageEvent<string>;
                listener({
                    data: message.data,
                    lastEventId: message.lastEventId,
                });
            });
        },
        close() {
            source.close();
        },
        setErrorHandler(listener) {
            source.onerror = () => listener();
        },
    };
}

export function subscribeSmartOrderRuntimeEvents(
    handlers: SmartOrderEventSubscriptionHandlers,
    eventSourceFactory: SmartOrderEventSourceFactory = browserEventSource,
): () => void {
    assertSmartOrderBrowserGatewayAvailable();
    const source = eventSourceFactory(SMART_ORDER_EVENT_ROUTE);
    let closed = false;
    let lastSequence: number | null = null;
    const failClosed = () => {
        if (!closed) handlers.onTransportError?.();
    };
    source.addEventListener('smart-order', (message) => {
        if (closed) return;
        try {
            const event = parseSmartOrderRuntimeEvent(message);
            if (
                lastSequence !== null &&
                event.sequence !== lastSequence + 1
            ) {
                failClosed();
                return;
            }
            lastSequence = event.sequence;
            handlers.onRuntimeEvent(event);
        } catch {
            failClosed();
        }
    });
    for (const type of ['cursor', 'heartbeat', 'gap'] as const) {
        source.addEventListener(type, (message) => {
            if (closed) return;
            try {
                const cursor = parseSmartOrderEventCursor(message);
                if (
                    lastSequence !== null &&
                    cursor.nextSequence < lastSequence
                ) {
                    failClosed();
                    return;
                }
                lastSequence = cursor.nextSequence;
                if (type === 'gap') handlers.onGap(cursor);
                else handlers.onCursor?.(cursor);
            } catch {
                failClosed();
            }
        });
    }
    source.setErrorHandler(failClosed);
    return () => {
        if (closed) return;
        closed = true;
        source.close();
    };
}
