import { describe, expect, it, vi } from 'vitest';
import {
    parseSmartOrderEventCursor,
    parseSmartOrderRuntimeEvent,
    subscribeSmartOrderRuntimeEvents,
} from './smart-order-event-client';

class FakeEventSource {
    readonly listeners = new Map<
        string,
        ((event: { data: string; lastEventId: string }) => void)[]
    >();
    onerror: (() => void) | null = null;
    closed = false;

    addEventListener(
        type: string,
        listener: (event: { data: string; lastEventId: string }) => void,
    ): void {
        this.listeners.set(type, [
            ...(this.listeners.get(type) ?? []),
            listener,
        ]);
    }

    emit(type: string, data: unknown, lastEventId: string): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener({ data: JSON.stringify(data), lastEventId });
        }
    }

    close(): void {
        this.closed = true;
    }

    setErrorHandler(listener: () => void): void {
        this.onerror = listener;
    }
}

function runtimeEvent(sequence = 1) {
    return {
        sequence,
        entityKind: 'order_intent',
        reasonCode: 'ORDER_INTENT_OUTCOME_UNKNOWN',
        revision: 2,
        summaryCode: 'order_intent_unknown',
        exchangeEpochMs: null,
        brokerEpochMs: 90,
        receiveEpochMs: 100,
    };
}

function cursor(
    cursorStatus: 'initialized' | 'current' | 'gap',
    nextSequence = 0,
) {
    return {
        schemaVersion: 'smart-order-event-projection/2026-08-11.1',
        cursorStatus,
        nextSequence,
        highWaterSequence: nextSequence,
    };
}

describe('smart-order EventSource client', () => {
    it('parses only exact redacted journal events and cursor frames', () => {
        expect(
            parseSmartOrderRuntimeEvent({
                data: JSON.stringify(runtimeEvent()),
                lastEventId: '1',
            }),
        ).toEqual(runtimeEvent());
        expect(
            parseSmartOrderEventCursor({
                data: JSON.stringify(cursor('initialized')),
                lastEventId: '0',
            }),
        ).toEqual(cursor('initialized'));
        for (const invalid of [
            { ...runtimeEvent(), accountId: 'must-not-leak' },
            { ...runtimeEvent(), sequence: 2 },
            { ...runtimeEvent(), receiveEpochMs: 10, brokerEpochMs: 11 },
        ]) {
            expect(() =>
                parseSmartOrderRuntimeEvent({
                    data: JSON.stringify(invalid),
                    lastEventId: '1',
                }),
            ).toThrow();
        }
    });

    it('refreshes only from contiguous Runtime events and reports gap or malformed data', () => {
        const source = new FakeEventSource();
        const onRuntimeEvent = vi.fn();
        const onGap = vi.fn();
        const onTransportError = vi.fn();
        const close = subscribeSmartOrderRuntimeEvents(
            { onRuntimeEvent, onGap, onTransportError },
            (url) => {
                expect(url).toBe('/__smart-orders/v1/events');
                return source;
            },
        );
        source.emit('cursor', cursor('initialized'), '0');
        source.emit('smart-order', runtimeEvent(1), '1');
        source.emit('smart-order', runtimeEvent(3), '3');
        source.emit('gap', cursor('gap', 3), '3');
        expect(onRuntimeEvent).toHaveBeenCalledTimes(1);
        expect(onGap).toHaveBeenCalledTimes(1);
        expect(onTransportError).toHaveBeenCalledTimes(1);
        close();
        expect(source.closed).toBe(true);
        source.emit('smart-order', runtimeEvent(4), '4');
        expect(onRuntimeEvent).toHaveBeenCalledTimes(1);
    });
});
