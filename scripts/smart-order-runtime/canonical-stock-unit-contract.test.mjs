import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_CANONICAL_CONTRACT_UPDATE_MAX_AGE_DAYS,
    SMART_ORDER_CANONICAL_STOCK_UNIT_CONTRACT_SCHEMA_VERSION,
    assertSmartOrderCanonicalContractUpdateDateCurrent,
    parseSmartOrderCanonicalStockContractMetadata,
    smartOrderCommonLotsToShares,
    smartOrderSharesToCommonLots,
} from './canonical-stock-unit-contract.mjs';

function contract(overrides = {}) {
    return {
        category: '24',
        code: '2330',
        exchange: 'TSE',
        limit_down: 90,
        limit_up: 110,
        reference: 100,
        security_type: 'STK',
        unit: 500,
        update_date: '2026-08-22',
        ...overrides,
    };
}

describe('canonical stock Share/CommonLot contract', () => {
    it('parses versioned stock and ETF metadata without assuming 1000 shares', () => {
        expect(
            parseSmartOrderCanonicalStockContractMetadata(contract(), {
                requestedCode: '2330',
                expectedExchange: 'TSE',
            }),
        ).toEqual({
            schemaVersion:
                SMART_ORDER_CANONICAL_STOCK_UNIT_CONTRACT_SCHEMA_VERSION,
            categoryCode: '24',
            code: '2330',
            contractKey: 'TSE:2330:STK:Common',
            contractUnit: 500,
            exchange: 'TSE',
            limitDownMinorUnits: 9_000,
            limitUpMinorUnits: 11_000,
            referenceMinorUnits: 10_000,
            securityType: 'STK',
            updateDate: '2026-08-22',
        });
        expect(
            parseSmartOrderCanonicalStockContractMetadata(
                contract({ category: '00', code: '0050', unit: 1_000 }),
                { requestedCode: '0050', expectedExchange: 'TSE' },
            ),
        ).toMatchObject({ categoryCode: '00', contractUnit: 1_000 });
    });

    it('performs only exact bounded conversions in both directions', () => {
        expect(smartOrderCommonLotsToShares(2, 500)).toBe(1_000);
        expect(smartOrderSharesToCommonLots(1_000, 500)).toBe(2);
        expect(() => smartOrderSharesToCommonLots(999, 500)).toThrow(
            'not exactly divisible',
        );
        expect(() =>
            smartOrderCommonLotsToShares(Number.MAX_SAFE_INTEGER, 2),
        ).toThrow('exceeds Share bounds');
        for (const invalid of [0, -1, 1.5, Number.NaN]) {
            expect(() => smartOrderCommonLotsToShares(1, invalid)).toThrow();
        }
    });

    it('accepts only a bounded non-future Asia/Taipei contract update date', () => {
        const now = Date.parse('2026-08-22T12:00:00+08:00');
        const current = parseSmartOrderCanonicalStockContractMetadata(
            contract({ update_date: '2026-08-08' }),
            { requestedCode: '2330', expectedExchange: 'TSE' },
        );
        expect(SMART_ORDER_CANONICAL_CONTRACT_UPDATE_MAX_AGE_DAYS).toBe(14);
        expect(
            assertSmartOrderCanonicalContractUpdateDateCurrent(current, now),
        ).toBe(true);
        for (const update_date of ['2026-08-07', '2026-08-23']) {
            const metadata = parseSmartOrderCanonicalStockContractMetadata(
                contract({ update_date }),
                { requestedCode: '2330', expectedExchange: 'TSE' },
            );
            expect(() =>
                assertSmartOrderCanonicalContractUpdateDateCurrent(
                    metadata,
                    now,
                ),
            ).toThrow('stale or future');
        }
    });

    it.each([
        [{ code: '0050' }, 'does not match'],
        [{ exchange: 'OTC' }, 'does not match'],
        [{ security_type: 'FUT' }, 'does not match'],
        [{ category: 'ETF' }, 'does not match'],
        [{ unit: 0 }, 'does not match'],
        [{ unit: 1.5 }, 'does not match'],
        [{ reference: 80 }, 'price limits are inconsistent'],
        [{ update_date: '2026-02-30' }, 'is invalid'],
    ])('fails closed for malformed metadata %j', (overrides, message) => {
        expect(() =>
            parseSmartOrderCanonicalStockContractMetadata(contract(overrides), {
                requestedCode: '2330',
                expectedExchange: 'TSE',
            }),
        ).toThrow(message);
    });

    it('rejects Proxy, accessors and missing required fields before admission', () => {
        expect(() =>
            parseSmartOrderCanonicalStockContractMetadata(
                new Proxy(contract(), {}),
                { requestedCode: '2330', expectedExchange: 'TSE' },
            ),
        ).toThrow('non-Proxy');
        const accessor = contract();
        Object.defineProperty(accessor, 'unit', {
            enumerable: true,
            get() {
                return 500;
            },
        });
        expect(() =>
            parseSmartOrderCanonicalStockContractMetadata(accessor, {
                requestedCode: '2330',
                expectedExchange: 'TSE',
            }),
        ).toThrow('own data property');
        const missing = contract();
        delete missing.update_date;
        expect(() =>
            parseSmartOrderCanonicalStockContractMetadata(missing, {
                requestedCode: '2330',
                expectedExchange: 'TSE',
            }),
        ).toThrow('own data property');
    });
});
