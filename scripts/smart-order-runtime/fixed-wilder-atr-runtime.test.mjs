import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
    createRuntimeFixedWilderAtrSnapshot,
    SMART_ORDER_RUNTIME_FIXED_ATR_ALGORITHM_VERSION,
} from './fixed-wilder-atr-runtime.mjs';

function kbars({ days = 16, trueRange = 2 } = {}) {
    const rows = [];
    for (let day = 1; day <= days; day += 1) {
        rows.push({
            datetime: `2026-08-${String(day).padStart(2, '0')} 13:30:00`,
            Open: 100,
            High: 100 + trueRange / 2,
            Low: 100 - trueRange / 2,
            Close: 100,
            Volume: 1,
            Amount: 100,
        });
    }
    return Object.fromEntries(
        ['datetime', 'Open', 'High', 'Low', 'Close', 'Volume', 'Amount'].map(
            (key) => [key, rows.map((row) => row[key])],
        ),
    );
}

function input(overrides = {}) {
    return {
        contractKey: 'TSE:2330:STK:Common',
        contractRevision: `sha256:${'1'.repeat(64)}`,
        corporateActionRevision: `sha256:${'2'.repeat(64)}`,
        decisionTradingDate: '2026-08-21',
        requestedEndDate: '2026-08-20',
        requestedStartDate: '2026-07-22',
        response: kbars(),
        strategyDefinitionHash: `sha256:${'3'.repeat(64)}`,
        ...overrides,
    };
}

describe('Runtime fixed Wilder ATR source', () => {
    it('freezes a versioned ATR(14) snapshot from completed daily Kbars', () => {
        const result = createRuntimeFixedWilderAtrSnapshot(input());
        assert.equal(result.value, '2');
        assert.equal(result.asOfTradingDate, '2026-08-16');
        assert.equal(result.period, 14);
        assert.equal(
            result.algorithmVersion,
            SMART_ORDER_RUNTIME_FIXED_ATR_ALGORITHM_VERSION,
        );
        assert.equal(result.source.completedCandleCount, 16);
        assert.equal(
            result.source.completeness,
            'bounded_native_kbars_response',
        );
        assert.match(result.snapshotSha256, /^sha256:[0-9a-f]{64}$/);
        assert.ok(Object.isFrozen(result));
        assert.ok(Object.isFrozen(result.source));
    });

    it('rejects incomplete, current-day, accessor and hostile Proxy sources', () => {
        assert.throws(
            () =>
                createRuntimeFixedWilderAtrSnapshot(
                    input({ response: kbars({ days: 14 }) }),
                ),
            /invalid or inconsistent lengths|anchor plus 14 completed/,
        );
        const current = kbars();
        current.datetime[current.datetime.length - 1] =
            '2026-08-21 09:01:00';
        assert.throws(
            () =>
                createRuntimeFixedWilderAtrSnapshot(
                    input({
                        decisionTradingDate: '2026-07-15',
                        requestedStartDate: '2026-06-14',
                        requestedEndDate: '2026-07-14',
                        response: current,
                    }),
                ),
            /anchor plus 14 completed/,
        );
        assert.throws(
            () =>
                createRuntimeFixedWilderAtrSnapshot(
                    input({ requestedStartDate: '2026-07-01' }),
                ),
            /official 30-day limit/,
        );
        const stale = kbars();
        stale.datetime = stale.datetime.map((value) =>
            value.replace('2026-08-', '2026-07-'),
        );
        assert.throws(
            () =>
                createRuntimeFixedWilderAtrSnapshot(
                    input({ response: stale }),
                ),
            /freshness window/,
        );
        const accessor = input();
        Object.defineProperty(accessor, 'response', {
            enumerable: true,
            get() {
                throw new Error('must not run');
            },
        });
        assert.throws(
            () => createRuntimeFixedWilderAtrSnapshot(accessor),
            /exact schema/,
        );
        assert.throws(
            () =>
                createRuntimeFixedWilderAtrSnapshot(
                    new Proxy(input(), {
                        getOwnPropertyDescriptor() {
                            throw new Error('must not run');
                        },
                    }),
                ),
            /non-Proxy/,
        );
    });
});
