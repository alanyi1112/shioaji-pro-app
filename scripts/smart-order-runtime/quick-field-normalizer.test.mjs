import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_QUICK_FIELD_IDS,
    isTrustedSmartOrderQuickFieldNormalization,
    normalizeSmartOrderQuickFieldEvent,
} from './quick-field-normalizer.mjs';

const EXCHANGE_MS = Date.UTC(2026, 7, 13, 1, 1, 2, 123);

function tick(overrides = {}) {
    return {
        eventKind: 'tick',
        code: '2330',
        date: '2026/08/13',
        time: '09:01:02.123456',
        close: '1200.00',
        volume: 3,
        totalVolume: 1234,
        priceChange: '5.00',
        percentChange: 42,
        simtrade: false,
        intradayOdd: false,
        ...overrides,
    };
}

function bidask(overrides = {}) {
    return {
        eventKind: 'bidask',
        code: '2330',
        date: '2026/08/13',
        time: '09:01:02.123456',
        bidPrices: ['1199', '1198'],
        askPrices: ['1200', '1201'],
        simtrade: false,
        intradayOdd: false,
        ...overrides,
    };
}

function input(event, overrides = {}) {
    return {
        contractKey: 'TSE:STK:2330',
        event,
        receiveTimeMs: EXCHANGE_MS + 20,
        sequence: 7,
        streamEpoch: 'quote-epoch-1',
        ...overrides,
    };
}

describe('quick-order nine-field fail-closed normalizer', () => {
    it('normalizes an up Tick and projects the opposite direction as canonical zero', () => {
        const result = normalizeSmartOrderQuickFieldEvent(input(tick()));
        expect(result).toMatchObject({
            accepted: true,
            eventKind: 'tick',
            tradeDate: '2026-08-13',
            exchangeTimeMs: EXCHANGE_MS,
            mappingVerified: true,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(result.projections).toEqual([
            expect.objectContaining({ field: 'last_price', value: '1200', sourceField: 'close' }),
            expect.objectContaining({ field: 'up_amount', value: '5', sourceField: 'price_chg' }),
            expect.objectContaining({ field: 'down_amount', value: '0', sourceField: 'price_chg' }),
            expect.objectContaining({ field: 'up_percent', value: '0.42', sourceField: 'pct_chg' }),
            expect.objectContaining({ field: 'down_percent', value: '0', sourceField: 'pct_chg' }),
            expect.objectContaining({ field: 'tick_quantity', value: '3', sourceField: 'volume' }),
            expect.objectContaining({ field: 'total_quantity', value: '1234', sourceField: 'total_volume' }),
        ]);
        expect(result.projections.every((entry) => entry.mappingState === 'verified_current')).toBe(true);
        expect(
            result.projections.find((entry) => entry.field === 'last_price'),
        ).toMatchObject({
            protectiveTriggerCandidate: true,
            protectiveTriggerRequiresCurrentFreshness: true,
            protectiveTriggerAuthority: false,
        });
        expect(
            result.projections
                .filter((entry) => entry.field !== 'last_price')
                .every((entry) => entry.protectiveTriggerCandidate === false),
        ).toBe(true);
        expect(result.eventFingerprintSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.projections)).toBe(true);
    });

    it('accepts the production Shioaji dashed trade date and canonicalizes it', () => {
        const result = normalizeSmartOrderQuickFieldEvent(
            input(tick({ date: '2026-08-13' })),
        );
        expect(result).toMatchObject({
            accepted: true,
            tradeDate: '2026-08-13',
            exchangeTimeMs: EXCHANGE_MS,
        });
    });

    it('normalizes down change and percentage as positive magnitudes', () => {
        const result = normalizeSmartOrderQuickFieldEvent(
            input(tick({ priceChange: '-5.50', percentChange: -46 })),
        );
        expect(result.projections.map(({ field, value }) => [field, value])).toContainEqual([
            'down_amount',
            '5.5',
        ]);
        expect(result.projections.map(({ field, value }) => [field, value])).toContainEqual([
            'down_percent',
            '0.46',
        ]);
        expect(result.projections.map(({ field, value }) => [field, value])).toEqual(
            expect.arrayContaining([
                ['up_amount', '0'],
                ['up_percent', '0'],
            ]),
        );
    });

    it('projects all four direction fields as canonical zero on a valid flat Tick', () => {
        const result = normalizeSmartOrderQuickFieldEvent(
            input(tick({ priceChange: '0', percentChange: 0 })),
        );
        expect(result.projections.map(({ field, value }) => [field, value])).toEqual(
            expect.arrayContaining([
                ['up_amount', '0'],
                ['down_amount', '0'],
                ['up_percent', '0'],
                ['down_percent', '0'],
            ]),
        );
        expect(result.disabledFields).toEqual([]);
    });

    it('normalizes only best bid and ask from BidAsk', () => {
        const result = normalizeSmartOrderQuickFieldEvent(input(bidask()));
        expect(result.projections).toEqual([
            expect.objectContaining({ field: 'bid_price', value: '1199' }),
            expect.objectContaining({ field: 'ask_price', value: '1200' }),
        ]);
        expect(
            result.projections.every(
                (entry) =>
                    entry.protectiveTriggerCandidate === false &&
                    entry.protectiveTriggerAuthority === false,
            ),
        ).toBe(true);
    });

    it('keeps valid last-price and quantity fields while disabling missing direction sources individually', () => {
        const result = normalizeSmartOrderQuickFieldEvent(
            input(tick({ priceChange: undefined, percentChange: undefined })),
        );
        expect(result).toMatchObject({
            accepted: true,
            mappingVerified: true,
            protectiveTriggerPolicy:
                'current_fresh_normal_lot_last_trade_only',
        });
        expect(result.projections.map(({ field }) => field)).toEqual([
            'last_price',
            'tick_quantity',
            'total_quantity',
        ]);
        expect(result.disabledFields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'up_amount',
                    reason: 'source_missing_or_invalid',
                }),
                expect.objectContaining({
                    field: 'down_percent',
                    reason: 'source_missing_or_invalid',
                }),
            ]),
        );
    });

    it('disables only the missing price-change or percentage source', () => {
        const missingPercent = normalizeSmartOrderQuickFieldEvent(
            input(tick({ percentChange: undefined }), { sequence: 11 }),
        );
        expect(missingPercent.projections).toContainEqual(
            expect.objectContaining({ field: 'up_amount', value: '5' }),
        );
        expect(
            missingPercent.projections.some(({ field }) =>
                field.endsWith('_percent'),
            ),
        ).toBe(false);
        expect(missingPercent.disabledFields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'up_percent',
                    reason: 'source_missing_or_invalid',
                }),
                expect.objectContaining({
                    field: 'down_percent',
                    reason: 'source_missing_or_invalid',
                }),
            ]),
        );

        const missingAmount = normalizeSmartOrderQuickFieldEvent(
            input(tick({ priceChange: undefined }), { sequence: 12 }),
        );
        expect(missingAmount.projections).toContainEqual(
            expect.objectContaining({ field: 'up_percent', value: '0.42' }),
        );
        expect(
            missingAmount.projections.some(({ field }) =>
                field.endsWith('_amount'),
            ),
        ).toBe(false);
        expect(missingAmount.disabledFields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'up_amount',
                    reason: 'source_missing_or_invalid',
                }),
                expect.objectContaining({
                    field: 'down_amount',
                    reason: 'source_missing_or_invalid',
                }),
            ]),
        );
    });

    it('covers the exact nine official UI field IDs without inventing another field', () => {
        const up = normalizeSmartOrderQuickFieldEvent(input(tick())).projections;
        const down = normalizeSmartOrderQuickFieldEvent(
            input(tick({ priceChange: '-5', percentChange: -42 }), { sequence: 8 }),
        ).projections;
        const book = normalizeSmartOrderQuickFieldEvent(
            input(bidask(), { sequence: 9 }),
        ).projections;
        expect(
            [...new Set([...up, ...down, ...book].map((entry) => entry.field))].sort(),
        ).toEqual([...SMART_ORDER_QUICK_FIELD_IDS].sort());
    });

    it.each([
        ['simtrade', tick({ simtrade: true }), 'simtrade'],
        ['intraday odd tick', tick({ intradayOdd: true }), 'intraday_odd'],
        ['intraday odd book', bidask({ intradayOdd: true }), 'intraday_odd'],
        ['zero-volume trial tick', tick({ volume: 0 }), 'tick_quantity_invalid'],
    ])('rejects %s before producing any field', (_label, event, reason) => {
        expect(normalizeSmartOrderQuickFieldEvent(input(event))).toEqual(
            expect.objectContaining({ accepted: false, reason, projections: [] }),
        );
    });

    it.each([
        [tick({ priceChange: '-5', percentChange: 42 }), 'tick_direction_conflict'],
        [tick({ totalVolume: 2 }), 'tick_quantity_invalid'],
        [tick({ close: 'NaN' }), 'tick_value_invalid'],
        [tick({ close: '1'.repeat(81) }), 'tick_value_invalid'],
        [bidask({ bidPrices: ['1201'], askPrices: ['1200'] }), 'crossed_book'],
        [bidask({ bidPrices: [], askPrices: [] }), 'book_empty'],
    ])('rejects contradictory or invalid market projection', (event, reason) => {
        expect(normalizeSmartOrderQuickFieldEvent(input(event))).toEqual(
            expect.objectContaining({ accepted: false, reason }),
        );
    });

    it('rejects contract, calendar, time-order, and event schema mismatches', () => {
        expect(
            normalizeSmartOrderQuickFieldEvent(
                input(tick(), { contractKey: 'OTC:STK:2317' }),
            ).reason,
        ).toBe('contract_mismatch');
        expect(
            normalizeSmartOrderQuickFieldEvent(input(tick({ date: '2026/02/30' }))).reason,
        ).toBe('event_time_invalid');
        expect(
            normalizeSmartOrderQuickFieldEvent(
                input(tick(), { receiveTimeMs: EXCHANGE_MS - 1 }),
            ).reason,
        ).toBe('event_time_invalid');
        expect(
            normalizeSmartOrderQuickFieldEvent(input({ ...tick(), extra: true })).reason,
        ).toBe('event_schema_invalid');
    });

    it('converts official integer pct_chg basis points and brands only the exact result', () => {
        const result = normalizeSmartOrderQuickFieldEvent(
            input(tick({ percentChange: 33 })),
        );
        expect(result.projections).toContainEqual(
            expect.objectContaining({
                field: 'up_percent',
                localUnit: 'percent_decimal',
                sourceField: 'pct_chg',
                value: '0.33',
            }),
        );
        expect(isTrustedSmartOrderQuickFieldNormalization(result)).toBe(true);
        expect(
            isTrustedSmartOrderQuickFieldNormalization({ ...result }),
        ).toBe(false);

        const wrongUnit = normalizeSmartOrderQuickFieldEvent(
            input(tick({ percentChange: '0.33' }), { sequence: 10 }),
        );
        expect(wrongUnit.accepted).toBe(true);
        expect(wrongUnit.projections.some(({ field }) => field === 'up_percent')).toBe(false);
        expect(wrongUnit.disabledFields).toContainEqual(
            expect.objectContaining({
                field: 'up_percent',
                reason: 'source_missing_or_invalid',
            }),
        );
    });

    it('does not execute accessors and rejects Proxy input at every boundary', () => {
        let eventReads = 0;
        const accessorEvent = tick();
        Object.defineProperty(accessorEvent, 'close', {
            enumerable: true,
            get() {
                eventReads += 1;
                return '1200';
            },
        });
        expect(normalizeSmartOrderQuickFieldEvent(input(accessorEvent)).reason).toBe(
            'event_schema_invalid',
        );
        expect(eventReads).toBe(0);

        let rootReads = 0;
        const rootProxy = new Proxy(input(tick()), {
            get() {
                rootReads += 1;
                return undefined;
            },
        });
        expect(normalizeSmartOrderQuickFieldEvent(rootProxy).reason).toBe(
            'input_schema_invalid',
        );
        expect(rootReads).toBe(0);

        let arrayReads = 0;
        const arrayProxy = new Proxy(['1199'], {
            get() {
                arrayReads += 1;
                return undefined;
            },
        });
        expect(
            normalizeSmartOrderQuickFieldEvent(
                input(bidask({ bidPrices: arrayProxy })),
            ).reason,
        ).toBe('book_schema_invalid');
        expect(arrayReads).toBe(0);
    });

    it('domain-separates the fingerprint by stream, sequence, time, and field values', () => {
        const baseline = normalizeSmartOrderQuickFieldEvent(input(tick()));
        const variants = [
            normalizeSmartOrderQuickFieldEvent(input(tick(), { sequence: 8 })),
            normalizeSmartOrderQuickFieldEvent(
                input(tick(), { streamEpoch: 'quote-epoch-2' }),
            ),
            normalizeSmartOrderQuickFieldEvent(
                input(tick({ close: '1201' })),
            ),
        ];
        expect(
            new Set([baseline, ...variants].map((entry) => entry.eventFingerprintSha256)).size,
        ).toBe(4);
    });
});
