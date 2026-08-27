import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
    createCanonicalSmartOrderBrokerEventLedger,
    normalizeCanonicalSmartOrderBrokerEvent,
    revalidateNormalizedCanonicalSmartOrderBrokerEvent,
} from './broker-event-normalizer.mjs';

function orderEvent(overrides = {}) {
    return {
        schemaVersion: SMART_ORDER_BROKER_EVENT_CANDIDATE_SCHEMA_VERSION,
        mappingRevision: 'gate-0-correlation-mapping/fixture-1',
        apiGeneration: 'api-generation-1',
        eventKind: 'order',
        account: {
            brokerId: 'broker-A',
            accountId: 'account-A',
            accountType: 'S',
        },
        tradeDate: '2026-08-11',
        contractKey: 'TSE:2330:STK:Common',
        side: 'Buy',
        identifiers: {
            tradeId: 'trade-1',
            orderId: 'order-1',
            dealId: null,
            seqno: 'seq-1',
            ordno: 'ord-1',
            exchangeSequence: null,
            customField: 'A1B2C3',
        },
        operation: { type: 'New', code: '00', message: null },
        status: 'Submitted',
        orderClass: {
            orderCondition: 'Cash',
            orderLot: 'Common',
            priceType: 'LMT',
            timeInForce: 'ROD',
        },
        quantities: {
            order: 1,
            cumulativeDeal: 0,
            cumulativeCancel: 0,
            remaining: 1,
            eventDeal: 0,
            unit: 'CommonLot',
        },
        price: '100',
        timestamps: {
            exchangeEpochMs: 1_786_377_600_100,
            brokerEpochMs: 1_786_377_600_105,
            receiveEpochMs: 1_786_377_600_110,
        },
        ...overrides,
    };
}

function dealEvent(overrides = {}) {
    const base = orderEvent();
    return {
        ...base,
        eventKind: 'deal',
        identifiers: {
            ...base.identifiers,
            orderId: null,
            dealId: 'deal-1',
            exchangeSequence: 'exchange-deal-1',
        },
        operation: { type: null, code: null, message: null },
        status: 'PartFilled',
        quantities: {
            order: 1_000,
            cumulativeDeal: 200,
            cumulativeCancel: 0,
            remaining: 800,
            eventDeal: 200,
            unit: 'Share',
        },
        ...overrides,
    };
}

describe('canonical smart-order broker event normalization', () => {
    it('lets the ledger consume only the exact issued normalized snapshot', () => {
        const normalized = normalizeCanonicalSmartOrderBrokerEvent(
            orderEvent(),
        );
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        expect(ledger.acceptNormalized(normalized)).toMatchObject({
            state: 'accepted',
            event: normalized,
        });
        expect(() =>
            ledger.acceptNormalized(structuredClone(normalized)),
        ).toThrow('normalized broker event authority is invalid');
    });

    it('revalidates a worker-cloned canonical projection and rejects derived digest drift', () => {
        const normalized = normalizeCanonicalSmartOrderBrokerEvent(orderEvent());
        expect(
            revalidateNormalizedCanonicalSmartOrderBrokerEvent(
                structuredClone(normalized),
            ),
        ).toEqual(normalized);
        expect(() =>
            revalidateNormalizedCanonicalSmartOrderBrokerEvent({
                ...structuredClone(normalized),
                payloadSha256: `sha256:${'f'.repeat(64)}`,
            }),
        ).toThrow('derived fields');
    });

    it('preserves the complete fixed-account order evidence without raw payload', () => {
        const event = normalizeCanonicalSmartOrderBrokerEvent(orderEvent());
        expect(event).toMatchObject({
            eventKind: 'order',
            account: {
                brokerId: 'broker-A',
                accountId: 'account-A',
                accountType: 'S',
            },
            tradeDate: '2026-08-11',
            contractKey: 'TSE:2330:STK:Common',
            identifiers: {
                tradeId: 'trade-1',
                orderId: 'order-1',
                seqno: 'seq-1',
                ordno: 'ord-1',
                exchangeSequence: null,
                customField: 'A1B2C3',
            },
            status: 'Submitted',
            quantities: { remaining: 1, unit: 'CommonLot' },
        });
        expect(event.payloadSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(event.brokerEventKeySha256).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(event.brokerEventEvidenceSha256).toMatch(
            /^sha256:[a-f0-9]{64}$/,
        );
        expect(event.brokerOrderCorrelationKeySha256).toMatch(
            /^sha256:[a-f0-9]{64}$/,
        );
        expect(Object.isFrozen(event.identifiers)).toBe(true);
        expect(event).not.toHaveProperty('raw');
    });

    it('preserves deal quantity, deal id, status and all three time sources', () => {
        expect(normalizeCanonicalSmartOrderBrokerEvent(dealEvent())).toMatchObject({
            eventKind: 'deal',
            identifiers: { dealId: 'deal-1' },
            status: 'PartFilled',
            quantities: {
                order: 1_000,
                cumulativeDeal: 200,
                remaining: 800,
                eventDeal: 200,
                unit: 'Share',
            },
            timestamps: {
                exchangeEpochMs: 1_786_377_600_100,
                brokerEpochMs: 1_786_377_600_105,
                receiveEpochMs: 1_786_377_600_110,
            },
        });
    });

    it('represents identifiers absent from official callbacks as null without inventing them', () => {
        expect(
            normalizeCanonicalSmartOrderBrokerEvent(orderEvent()).identifiers,
        ).toMatchObject({ dealId: null, exchangeSequence: null });
        expect(
            normalizeCanonicalSmartOrderBrokerEvent(
                dealEvent({
                    identifiers: {
                        ...dealEvent().identifiers,
                        orderId: null,
                        dealId: null,
                    },
                }),
            ).identifiers,
        ).toMatchObject({ orderId: null, dealId: null });
    });

    it('preserves a terminal cancellation quantity without treating it as a fill', () => {
        expect(
            normalizeCanonicalSmartOrderBrokerEvent(
                orderEvent({
                    status: 'Cancelled',
                    quantities: {
                        order: 1_000,
                        cumulativeDeal: 200,
                        cumulativeCancel: 800,
                        remaining: 0,
                        eventDeal: 0,
                        unit: 'Share',
                    },
                }),
            ),
        ).toMatchObject({
            status: 'Cancelled',
            quantities: {
                order: 1_000,
                cumulativeDeal: 200,
                cumulativeCancel: 800,
                remaining: 0,
                eventDeal: 0,
                unit: 'Share',
            },
        });
    });

    it.each(['', 'A', 'A1B2C3', null])(
        'preserves a valid optional custom_field value %j',
        (customField) => {
            expect(
                normalizeCanonicalSmartOrderBrokerEvent(
                    orderEvent({
                        identifiers: {
                            ...orderEvent().identifiers,
                            customField,
                        },
                    }),
                ).identifiers.customField,
            ).toBe(customField);
        },
    );

    it.each([
        ['missing account', { account: undefined }, 'account schema'],
        [
            'missing trade date',
            { tradeDate: undefined },
            'Asia/Taipei calendar date',
        ],
        ['futures account', { account: { brokerId: 'b', accountId: 'a', accountType: 'F' } }, 'stock account'],
        ['invalid date', { tradeDate: '2026-02-30' }, 'real Gregorian'],
        [
            'trade date inconsistent with the exchange timestamp',
            { tradeDate: '2026-08-12' },
            'match the exchange timestamp in Asia/Taipei',
        ],
        ['unknown status', { status: 'Unknown' }, 'status is unknown'],
        ['binary price', { price: '100.00' }, 'canonical decimal'],
        [
            'quantity mismatch',
            {
                quantities: {
                    order: 10,
                    cumulativeDeal: 2,
                    cumulativeCancel: 0,
                    remaining: 9,
                    eventDeal: 0,
                    unit: 'Share',
                },
            },
            'cumulative quantities',
        ],
        [
            'invalid custom field',
            {
                identifiers: {
                    ...orderEvent().identifiers,
                    customField: 'TOO-LONG',
                },
            },
            'at most six alphanumeric',
        ],
        [
            'custom field punctuation',
            {
                identifiers: {
                    ...orderEvent().identifiers,
                    customField: 'A-1',
                },
            },
            'at most six alphanumeric',
        ],
        [
            'future exchange timestamp',
            {
                timestamps: {
                    exchangeEpochMs: 1_786_377_600_120,
                    brokerEpochMs: 1_786_377_600_105,
                    receiveEpochMs: 1_786_377_600_110,
                },
            },
            'timestamp order',
        ],
        [
            'future broker timestamp',
            {
                timestamps: {
                    exchangeEpochMs: 1_786_377_600_100,
                    brokerEpochMs: 1_786_377_600_120,
                    receiveEpochMs: 1_786_377_600_110,
                },
            },
            'timestamp order',
        ],
        [
            'filled with remaining quantity',
            {
                status: 'Filled',
                quantities: {
                    order: 10,
                    cumulativeDeal: 9,
                    cumulativeCancel: 0,
                    remaining: 1,
                    eventDeal: 0,
                    unit: 'Share',
                },
            },
            'filled broker event quantity',
        ],
        [
            'part-filled without cumulative deal',
            {
                status: 'PartFilled',
                quantities: {
                    order: 10,
                    cumulativeDeal: 0,
                    cumulativeCancel: 0,
                    remaining: 10,
                    eventDeal: 0,
                    unit: 'Share',
                },
            },
            'part-filled broker event quantity',
        ],
        [
            'cancelled with a remaining quantity',
            {
                status: 'Cancelled',
                quantities: {
                    order: 10,
                    cumulativeDeal: 2,
                    cumulativeCancel: 3,
                    remaining: 5,
                    eventDeal: 0,
                    unit: 'Share',
                },
            },
            'cancelled broker event quantity',
        ],
    ])('rejects %s instead of filling missing evidence', (_name, override, message) => {
        expect(() => normalizeCanonicalSmartOrderBrokerEvent(orderEvent(override))).toThrow(
            message,
        );
    });

    it('rejects a deal quantity projected under a non-deal status', () => {
        expect(() =>
            normalizeCanonicalSmartOrderBrokerEvent(
                dealEvent({ status: 'Submitted' }),
            ),
        ).toThrow('deal event status is inconsistent');
    });

    it('deduplicates exact events but accepts later status events for the same order', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        const submitted = orderEvent({
            quantities: {
                order: 2,
                cumulativeDeal: 0,
                cumulativeCancel: 0,
                remaining: 2,
                eventDeal: 0,
                unit: 'CommonLot',
            },
        });
        expect(ledger.accept(submitted).state).toBe('accepted');
        expect(ledger.accept(submitted).state).toBe('duplicate');
        expect(
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-2',
                    },
                    status: 'PartFilled',
                    quantities: {
                        order: 2,
                        cumulativeDeal: 1,
                        cumulativeCancel: 0,
                        remaining: 1,
                        eventDeal: 0,
                        unit: 'CommonLot',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ).state,
        ).toBe('accepted');
        expect(ledger.size).toBe(2);
    });

    it('rejects immutable orderId drift within one order lineage', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        ledger.accept(orderEvent());
        expect(() =>
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        orderId: 'order-changed',
                        exchangeSequence: 'exchange-orderId-changed',
                    },
                    status: 'PartFilled',
                    quantities: {
                        order: 10,
                        cumulativeDeal: 2,
                        cumulativeCancel: 0,
                        remaining: 8,
                        eventDeal: 0,
                        unit: 'Share',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ),
        ).toThrow('orderId changed within one broker order lineage');
        expect(ledger.size).toBe(1);
    });

    it('allows an optional order identifier to become known without changing it later', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        expect(
            ledger.accept(
                dealEvent({
                    identifiers: {
                        ...dealEvent().identifiers,
                        orderId: null,
                    },
                }),
            ).state,
        ).toBe('accepted');
        expect(
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-order-after-deal',
                    },
                    status: 'Filled',
                    quantities: {
                        order: 1_000,
                        cumulativeDeal: 1_000,
                        cumulativeCancel: 0,
                        remaining: 0,
                        eventDeal: 0,
                        unit: 'Share',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ).state,
        ).toBe('accepted');
    });

    it('deduplicates a re-delivered broker event with a later local receive time', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        const first = ledger.accept(orderEvent());
        const duplicate = ledger.accept(
            orderEvent({
                timestamps: {
                    ...orderEvent().timestamps,
                    receiveEpochMs: 1_786_377_600_210,
                },
            }),
        );
        expect(duplicate.state).toBe('duplicate');
        expect(duplicate.event.brokerEventEvidenceSha256).toBe(
            first.event.brokerEventEvidenceSha256,
        );
        expect(duplicate.event.payloadSha256).not.toBe(
            first.event.payloadSha256,
        );
        expect(duplicate.event.timestamps.receiveEpochMs).toBe(
            1_786_377_600_210,
        );
        expect(ledger.size).toBe(1);
    });

    it('requires every accepted deal quantity to equal its cumulative head delta', () => {
        const missingEarlierDeal = createCanonicalSmartOrderBrokerEventLedger();
        expect(() =>
            missingEarlierDeal.accept(
                dealEvent({
                    quantities: {
                        ...dealEvent().quantities,
                        cumulativeDeal: 300,
                        remaining: 700,
                    },
                }),
            ),
        ).toThrow('cumulative deal delta');

        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        ledger.accept(dealEvent());
        expect(
            ledger.accept(
                dealEvent({
                    identifiers: {
                        ...dealEvent().identifiers,
                        dealId: 'deal-2',
                        exchangeSequence: 'exchange-deal-2',
                    },
                    status: 'Filled',
                    quantities: {
                        order: 1_000,
                        cumulativeDeal: 1_000,
                        cumulativeCancel: 0,
                        remaining: 0,
                        eventDeal: 800,
                        unit: 'Share',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ).state,
        ).toBe('accepted');

        const inconsistent = createCanonicalSmartOrderBrokerEventLedger();
        inconsistent.accept(dealEvent());
        expect(() =>
            inconsistent.accept(
                dealEvent({
                    identifiers: {
                        ...dealEvent().identifiers,
                        dealId: 'deal-3',
                        exchangeSequence: 'exchange-deal-3',
                    },
                    quantities: {
                        order: 1_000,
                        cumulativeDeal: 300,
                        cumulativeCancel: 0,
                        remaining: 700,
                        eventDeal: 200,
                        unit: 'Share',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ),
        ).toThrow('cumulative deal delta');
    });

    it('correlates an official-shape deal before its order event without regressing the fill head', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        const deal = ledger.accept(
            dealEvent({
                identifiers: {
                    ...dealEvent().identifiers,
                    orderId: null,
                    dealId: null,
                    ordno: 'ORD01001',
                },
                quantities: {
                    order: 2,
                    cumulativeDeal: 1,
                    cumulativeCancel: 0,
                    remaining: 1,
                    eventDeal: 1,
                    unit: 'CommonLot',
                },
            }),
        );
        const order = ledger.accept(
            orderEvent({
                identifiers: {
                    ...orderEvent().identifiers,
                    orderId: 'trade-1',
                    ordno: 'ORD01',
                },
                quantities: {
                    order: 2,
                    cumulativeDeal: 0,
                    cumulativeCancel: 0,
                    remaining: 2,
                    eventDeal: 0,
                    unit: 'CommonLot',
                },
                timestamps: {
                    exchangeEpochMs: 1_786_377_600_050,
                    brokerEpochMs: 1_786_377_600_055,
                    receiveEpochMs: 1_786_377_600_200,
                },
            }),
        );
        expect(order.state).toBe('stale');
        expect(order.event.brokerOrderCorrelationKeySha256).toBe(
            deal.event.brokerOrderCorrelationKeySha256,
        );
        expect(ledger.size).toBe(1);
    });

    it('rejects a same-key broker evidence drift even with a later receive time', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        ledger.accept(orderEvent());
        expect(() =>
            ledger.accept(
                orderEvent({
                    operation: {
                        ...orderEvent().operation,
                        message: 'changed broker evidence',
                    },
                    timestamps: {
                        ...orderEvent().timestamps,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ),
        ).toThrow('broker event key has conflicting evidence');
    });

    it('does not advance the order head for reordered older evidence', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        const head = orderEvent({
            identifiers: {
                ...orderEvent().identifiers,
                exchangeSequence: 'exchange-current-part-fill',
            },
            status: 'PartFilled',
            quantities: {
                order: 10,
                cumulativeDeal: 2,
                cumulativeCancel: 0,
                remaining: 8,
                eventDeal: 0,
                unit: 'Share',
            },
            timestamps: {
                exchangeEpochMs: 1_786_377_600_200,
                brokerEpochMs: 1_786_377_600_205,
                receiveEpochMs: 1_786_377_600_210,
            },
        });
        expect(ledger.accept(head).state).toBe('accepted');
        expect(
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-late-submitted',
                    },
                    quantities: {
                        order: 10,
                        cumulativeDeal: 0,
                        cumulativeCancel: 0,
                        remaining: 10,
                        eventDeal: 0,
                        unit: 'Share',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_150,
                        brokerEpochMs: 1_786_377_600_155,
                        receiveEpochMs: 1_786_377_600_250,
                    },
                }),
            ).state,
        ).toBe('stale');
        expect(ledger.size).toBe(1);

        expect(
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-current-fill',
                    },
                    status: 'Filled',
                    quantities: {
                        order: 10,
                        cumulativeDeal: 10,
                        cumulativeCancel: 0,
                        remaining: 0,
                        eventDeal: 0,
                        unit: 'Share',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_300,
                        brokerEpochMs: 1_786_377_600_305,
                        receiveEpochMs: 1_786_377_600_310,
                    },
                }),
            ).state,
        ).toBe('accepted');
        expect(ledger.size).toBe(2);
    });

    it('rejects same-time conflicts, quantity lineage drift and terminal changes', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        const submitted = orderEvent();
        ledger.accept(submitted);
        expect(() =>
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-same-time-conflict',
                    },
                    status: 'PreSubmitted',
                }),
            ),
        ).toThrow('same-time evidence');
        expect(() =>
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-quantity-drift',
                    },
                    quantities: {
                        order: 2,
                        cumulativeDeal: 0,
                        cumulativeCancel: 0,
                        remaining: 2,
                        eventDeal: 0,
                        unit: 'CommonLot',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ),
        ).toThrow('quantity lineage changed');

        const terminalLedger = createCanonicalSmartOrderBrokerEventLedger();
        terminalLedger.accept(
            orderEvent({
                status: 'Filled',
                quantities: {
                    order: 1,
                    cumulativeDeal: 1,
                    cumulativeCancel: 0,
                    remaining: 0,
                    eventDeal: 0,
                    unit: 'CommonLot',
                },
            }),
        );
        expect(() =>
            terminalLedger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-terminal-change',
                    },
                    status: 'Cancelled',
                    quantities: {
                        order: 1,
                        cumulativeDeal: 0,
                        cumulativeCancel: 1,
                        remaining: 0,
                        eventDeal: 0,
                        unit: 'CommonLot',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_200,
                        brokerEpochMs: 1_786_377_600_205,
                        receiveEpochMs: 1_786_377_600_210,
                    },
                }),
            ),
        ).toThrow('terminal broker order evidence cannot change');
    });

    it('checks global event identifiers before classifying an event as stale', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        ledger.accept(
            orderEvent({
                identifiers: {
                    ...orderEvent().identifiers,
                    exchangeSequence: 'exchange-current-head',
                },
                status: 'PartFilled',
                quantities: {
                    order: 10,
                    cumulativeDeal: 2,
                    cumulativeCancel: 0,
                    remaining: 8,
                    eventDeal: 0,
                    unit: 'Share',
                },
                timestamps: {
                    exchangeEpochMs: 1_786_377_600_200,
                    brokerEpochMs: 1_786_377_600_205,
                    receiveEpochMs: 1_786_377_600_210,
                },
            }),
        );
        ledger.accept(
            orderEvent({
                contractKey: 'TSE:2317:STK:Common',
                identifiers: {
                    tradeId: 'trade-2',
                    orderId: 'order-2',
                    dealId: null,
                    seqno: 'seq-2',
                    ordno: 'ord-2',
                    exchangeSequence: 'exchange-other-order',
                    customField: 'D4E5F6',
                },
            }),
        );

        expect(() =>
            ledger.accept(
                orderEvent({
                    identifiers: {
                        ...orderEvent().identifiers,
                        exchangeSequence: 'exchange-other-order',
                    },
                    timestamps: {
                        exchangeEpochMs: 1_786_377_600_150,
                        brokerEpochMs: 1_786_377_600_155,
                        receiveEpochMs: 1_786_377_600_250,
                    },
                }),
            ),
        ).toThrow('exchangeSequence has conflicting broker events');
    });

    it('rejects same-date short identifier and event-sequence collisions', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        ledger.accept(orderEvent());
        expect(() =>
            ledger.accept(
                orderEvent({
                    contractKey: 'TSE:2317:STK:Common',
                    identifiers: {
                        ...orderEvent().identifiers,
                        orderId: 'other-order',
                        tradeId: 'other-trade',
                        exchangeSequence: 'other-exchange',
                    },
                }),
            ),
        ).toThrow('seqno collides');

        const dealLedger = createCanonicalSmartOrderBrokerEventLedger();
        dealLedger.accept(dealEvent());
        expect(() =>
            dealLedger.accept(
                dealEvent({
                    contractKey: 'TSE:2317:STK:Common',
                    identifiers: {
                        ...dealEvent().identifiers,
                        tradeId: 'other-trade',
                        orderId: null,
                        dealId: 'other-deal',
                        seqno: 'other-seqno',
                        ordno: 'other-ordno',
                    },
                }),
            ),
        ).toThrow('exchangeSequence has conflicting');
    });

    it('separates identical short identifiers on the next Asia/Taipei trade date', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        const first = ledger.accept(orderEvent());
        const nextDay = ledger.accept(
            orderEvent({
                tradeDate: '2026-08-12',
                timestamps: {
                    exchangeEpochMs: 1_786_464_000_100,
                    brokerEpochMs: 1_786_464_000_105,
                    receiveEpochMs: 1_786_464_000_110,
                },
            }),
        );
        expect(nextDay.state).toBe('accepted');
        expect(nextDay.event.brokerOrderCorrelationKeySha256).not.toBe(
            first.event.brokerOrderCorrelationKeySha256,
        );
        expect(ledger.size).toBe(2);
    });

    it('never uses custom_field as the sole broker identity', () => {
        const ledger = createCanonicalSmartOrderBrokerEventLedger();
        ledger.accept(orderEvent());
        expect(
            ledger.accept(
                orderEvent({
                    identifiers: {
                        tradeId: 'trade-2',
                        orderId: 'order-2',
                        dealId: null,
                        seqno: 'seq-2',
                        ordno: 'ord-2',
                        exchangeSequence: 'exchange-2',
                        customField: 'A1B2C3',
                    },
                }),
            ).state,
        ).toBe('accepted');
    });

    it('snapshots own data properties once and rejects accessors or proxies', () => {
        let topLevelAccessorReads = 0;
        const topLevelAccessor = orderEvent();
        Object.defineProperty(topLevelAccessor, 'account', {
            enumerable: true,
            get() {
                topLevelAccessorReads += 1;
                return orderEvent().account;
            },
        });
        expect(() =>
            normalizeCanonicalSmartOrderBrokerEvent(topLevelAccessor),
        ).toThrow('candidate schema is invalid');
        expect(topLevelAccessorReads).toBe(0);

        let nestedAccessorReads = 0;
        const nestedAccessor = orderEvent();
        Object.defineProperty(nestedAccessor.identifiers, 'orderId', {
            enumerable: true,
            get() {
                nestedAccessorReads += 1;
                return 'forged-order';
            },
        });
        expect(() =>
            normalizeCanonicalSmartOrderBrokerEvent(nestedAccessor),
        ).toThrow('identifier schema is invalid');
        expect(nestedAccessorReads).toBe(0);

        let proxyOwnKeyReads = 0;
        const proxy = new Proxy(orderEvent(), {
            ownKeys(target) {
                proxyOwnKeyReads += 1;
                return Reflect.ownKeys(target);
            },
        });
        expect(() => normalizeCanonicalSmartOrderBrokerEvent(proxy)).toThrow(
            'candidate schema is invalid',
        );
        expect(proxyOwnKeyReads).toBe(0);
    });
});
