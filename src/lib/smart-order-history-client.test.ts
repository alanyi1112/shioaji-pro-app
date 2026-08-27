import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    fetchSmartOrderHistory,
    SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
} from './smart-order-history-client';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

const item = Object.freeze({
    type: 'strategy',
    strategyId: 'strategy-1',
    strategyKind: 'trailing_exit',
    state: 'completed',
    maskedAccountLabel: '固定帳號 ····5431',
    reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
    revision: 4,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 3,
    terminalAtEpochMs: 3,
    exchangeEpochMs: null,
    brokerEpochMs: 2,
    receiveEpochMs: 3,
});

describe('smart-order history browser client', () => {
    it('reads the bounded redacted Runtime projection through same origin', async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse({
                schemaVersion: SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                history: [item],
                source: 'runtime_repository',
                accountIdentifiersExposed: false,
                journalPayloadExposed: false,
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchSmartOrderHistory()).resolves.toEqual([item]);
        expect(fetchMock).toHaveBeenCalledWith(
            '/__smart-orders/v1/history',
            expect.objectContaining({
                method: 'GET',
                credentials: 'same-origin',
                redirect: 'error',
            }),
        );
    });

    it('rejects account, payload or unknown projection fields', async () => {
        for (const leaked of [
            { ...item, accountId: 'must-not-leak' },
            { ...item, payload: { secret: true } },
            { ...item, definitionHash: `sha256:${'a'.repeat(64)}` },
        ]) {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    jsonResponse({
                        schemaVersion:
                            SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                        history: [leaked],
                        source: 'runtime_repository',
                        accountIdentifiersExposed: false,
                        journalPayloadExposed: false,
                    }),
                ),
            );
            await expect(fetchSmartOrderHistory()).rejects.toMatchObject({
                code: 'invalid_history_result',
            });
        }
    });

    it('rejects non-terminal, oversized and malformed history responses', async () => {
        const invalidPayloads = [
            {
                schemaVersion: SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                history: [{ ...item, state: 'monitoring' }],
                source: 'runtime_repository',
                accountIdentifiersExposed: false,
                journalPayloadExposed: false,
            },
            {
                schemaVersion: SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                history: Array.from({ length: 101 }, () => item),
                source: 'runtime_repository',
                accountIdentifiersExposed: false,
                journalPayloadExposed: false,
            },
            {
                schemaVersion: SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                history: [item],
                source: 'runtime_repository',
                accountIdentifiersExposed: true,
                journalPayloadExposed: false,
            },
            {
                schemaVersion: SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                history: [
                    {
                        ...item,
                        reasonCode: 'STRATEGY_CANCELLED_WITHOUT_SIDE_EFFECTS',
                        state: 'completed',
                    },
                ],
                source: 'runtime_repository',
                accountIdentifiersExposed: false,
                journalPayloadExposed: false,
            },
            {
                schemaVersion: SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                history: [{ ...item, brokerEpochMs: item.receiveEpochMs + 1 }],
                source: 'runtime_repository',
                accountIdentifiersExposed: false,
                journalPayloadExposed: false,
            },
            {
                schemaVersion: SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION,
                history: [
                    {
                        ...item,
                        exchangeEpochMs: 2,
                        brokerEpochMs: 1,
                    },
                ],
                source: 'runtime_repository',
                accountIdentifiersExposed: false,
                journalPayloadExposed: false,
            },
        ];

        for (const payload of invalidPayloads) {
            vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)));
            await expect(fetchSmartOrderHistory()).rejects.toMatchObject({
                code: 'invalid_history_result',
            });
        }
    });
});
