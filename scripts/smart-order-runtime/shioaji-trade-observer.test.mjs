import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
    mapShioajiStockBrokerEvent,
} from './shioaji-broker-event-mapper.mjs';
import { createSmartOrderQuoteSubscriptionCoordinator } from './quote-subscription-coordinator.mjs';
import {
    isVerifiedSmartOrderCanonicalContractEvidence,
    startSmartOrderShioajiTradeObserver,
} from './shioaji-trade-observer.mjs';
import { SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY } from './shioaji-trade-observer-runtime-authority.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './canonical-pnl-policy.mjs';
import { createSmartOrderResourceCoordinator } from './resource-coordinator.mjs';

const BASE = 'http://127.0.0.1:8080';
const account = Object.freeze({
    broker_id: 'broker-A',
    account_id: 'account-A',
    account_type: 'S',
    person_id: 'broker-authenticated-person',
    signed: true,
});
const resourceCoordinators = new Set();
let resourceMonotonicMs = 0;
let observerOptionsSequence = 0;

afterEach(() => {
    for (const coordinator of resourceCoordinators) coordinator.close();
    resourceCoordinators.clear();
});

function jsonResponse(url, value, status = 200) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return {
        url,
        redirected: false,
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        async arrayBuffer() {
            return bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            );
        },
    };
}

function sseResponse(url, payload) {
    const block =
        payload === undefined
            ? null
            : new TextEncoder().encode(
                  `event: order_event\ndata: ${JSON.stringify(payload)}\n\n`,
              );
    return {
        url,
        redirected: false,
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
            start(controller) {
                if (block) controller.enqueue(block);
                controller.close();
            },
        }),
    };
}

function openSseResponse(url, events = []) {
    let controller;
    const response = {
        url,
        redirected: false,
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
            start(candidate) {
                controller = candidate;
                for (const event of events) {
                    candidate.enqueue(
                        new TextEncoder().encode(
                            `event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`,
                        ),
                    );
                }
            },
        }),
    };
    return Object.freeze({
        response,
        push(event) {
            controller.enqueue(
                new TextEncoder().encode(
                    `event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`,
                ),
            );
        },
        close() {
            controller.close();
        },
    });
}

function abortableEmptySseResponse(url, signal) {
    return {
        url,
        redirected: false,
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
            start(controller) {
                if (signal?.aborted) {
                    controller.close();
                    return;
                }
                signal?.addEventListener(
                    'abort',
                    () => controller.close(),
                    { once: true },
                );
            },
        }),
    };
}

function currentResourceCoordinator() {
    let usage = 0;
    return Object.freeze({
        reserveSubscriptionDemand(demand) {
            usage += demand.units;
            let released = false;
            return Object.freeze({
                allowed: true,
                demandId: demand.demandId,
                countingDimension: demand.countingDimension,
                units: demand.units,
                projectedUsageUnits: usage,
                brokerAuthority: false,
                release() {
                    if (released) return;
                    released = true;
                    usage -= demand.units;
                },
            });
        },
        status() {
            return Object.freeze({
                subscriptionEvidenceCurrent: true,
                subscriptionCountingDimension:
                    'same_login_quote_subscriptions',
                closed: false,
                brokerAuthority: false,
                writeMasterAuthority: false,
            });
        },
    });
}

function refreshedTrade(overrides = {}) {
    const trade = {
        contract: {
            code: '2330',
            exchange: 'TSE',
            security_type: 'STK',
        },
        order: {
            account: {
                broker_id: account.broker_id,
                account_id: account.account_id,
                account_type: account.account_type,
            },
            action: 'Buy',
            custom_field: 'SO001',
            id: 'trade-1',
            order_cond: 'Cash',
            order_lot: 'Common',
            order_type: 'ROD',
            ordno: 'ORD001',
            price: 100,
            price_type: 'LMT',
            quantity: 1,
            seqno: 'SEQ001',
        },
        status: {
            cancel_quantity: 0,
            deal_quantity: 0,
            deals: [],
            id: 'order-1',
            order_quantity: 1,
            status: 'Submitted',
        },
    };
    return {
        ...trade,
        ...overrides,
        order: { ...trade.order, ...overrides.order },
        status: { ...trade.status, ...overrides.status },
    };
}

function rawOrderEvent() {
    return {
        state: 'StockOrder',
        data: {
            StockOrder: {
                operation: {
                    op_type: 'New',
                    op_code: '00',
                    op_msg: '',
                },
                order: {
                    account: {
                        broker_id: account.broker_id,
                        account_id: account.account_id,
                        account_type: account.account_type,
                    },
                    id: 'trade-1',
                    seqno: 'SEQ001',
                },
                status: { exchange_ts: 1_786_550_400.1 },
                contract: { code: '2330' },
            },
        },
    };
}

function rawDealEvent() {
    return {
        state: 'StockDeal',
        data: {
            StockDeal: {
                account_id: account.account_id,
                action: 'Buy',
                broker_id: account.broker_id,
                code: '2330',
                custom_field: 'SO001',
                exchange_seq: 'EXCHANGE-1',
                ordno: 'ORD001-D',
                order_cond: 'Cash',
                order_lot: 'Common',
                price: 101,
                quantity: 1,
                seqno: 'SEQ001',
                trade_id: 'trade-1',
                ts: 1_786_550_400.2,
            },
        },
    };
}

function runtimeController({ gateState = 'eligible' } = {}) {
    return {
        acceptAuthenticatedIdentityEvidence: vi.fn(() => ({
            state: 'authenticated',
        })),
        gateManifestStatus: vi.fn(async () => ({
            present: true,
            state: gateState,
            manifestRevision: 'manifest-r1',
            manifestSha256: `sha256:${'a'.repeat(64)}`,
            accountReconciliationCapabilitySha256: `sha256:${'b'.repeat(64)}`,
            accountReconciliationCapabilityVerified: true,
            mappingRevision: SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
            pnlPolicyDefinitionSha256:
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
            validUntilEpochMs: 1_786_550_500_000,
        })),
        recordCanonicalBrokerEvent: vi.fn(async ({ event }) => ({
            state: 'accepted',
            brokerEventKeySha256: event.brokerEventKeySha256,
        })),
        recordQuickQuoteObservation: vi.fn(async () => ({
            state: 'observed',
            observedStrategyCount: 0,
            triggeredStrategyCount: 0,
            brokerWriteAuthority: false,
        })),
        recordProtectiveQuoteObservation: vi.fn(async () => ({
            state: 'observed',
            observedGroupCount: 0,
            preparedWinnerCount: 0,
            brokerWriteAuthority: false,
        })),
        recordAccountReconciliation: vi.fn(async () => ({
            state: 'recorded',
            protectedEntryMaterializationIntentIds: [],
            brokerWriteAuthority: false,
        })),
        completeBrokerObservationReconciliation: vi.fn(() => ({
            state: 'reconciling',
            dispatchAllowed: false,
            brokerWriteAuthority: false,
        })),
        materializeProtectedEntryFill: vi.fn(async () => ({
            state: 'waiting_entry_fill',
            brokerWriteAuthority: false,
        })),
        invalidateAuthenticatedIdentityEvidence: vi.fn(),
    };
}

function options(overrides = {}) {
    let monotonic = 0;
    const nowMonotonicMs = () => ++monotonic;
    observerOptionsSequence += 1;
    const runtimeControllerValue =
        overrides.runtimeController ?? runtimeController();
    const rawFetchImpl = overrides.fetchImpl ?? vi.fn();
    const fetchImpl = async (url, init) => {
        const pathname = new URL(url).pathname;
        try {
            const response = await rawFetchImpl(url, init);
            if (
                response === undefined &&
                [
                    '/api/v1/stream/data',
                    '/api/v1/stream/data/order_event',
                ].includes(pathname)
            ) {
                return abortableEmptySseResponse(url, init?.signal);
            }
            return response;
        } catch (error) {
            if (
                [
                    '/api/v1/stream/data',
                    '/api/v1/stream/data/order_event',
                ].includes(pathname)
            ) {
                return abortableEmptySseResponse(url, init?.signal);
            }
            throw error;
        }
    };
    const quoteSubscriptionCoordinator =
        overrides.quoteSubscriptionCoordinator ??
        createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'simulation:generation-1',
            connectionId: 'quote-observer-test-awaiting-sse',
            nowMonotonicMs,
            resourceCoordinator: null,
            resourceCountingDimension: null,
        });
    const resourceCoordinator = createSmartOrderResourceCoordinator({
        nowEpochMs: () => 1_786_550_400_500,
        nowMonotonicMs: () => {
            resourceMonotonicMs += 1_001;
            return resourceMonotonicMs;
        },
        scheduleOperationPump(callback) {
            queueMicrotask(callback);
        },
    });
    resourceCoordinators.add(resourceCoordinator);
    SMART_ORDER_SHIOAJI_TRADE_OBSERVER_TEST_ONLY.authorize({
        fetchImpl,
        runtimeController: runtimeControllerValue,
    });
    return {
        apiGeneration: 'simulation:generation-1',
        cancelRetry: overrides.cancelRetry ?? clearTimeout,
        fetchImpl,
        nowEpochMs:
            overrides.nowEpochMs ?? (() => 1_786_550_400_500),
        nowMonotonicMs,
        quoteSubscriptionCoordinator,
        resourceCoordinator,
        reportRuntimeGapLifecycle:
            overrides.reportRuntimeGapLifecycle ?? vi.fn(),
        runtimeController: runtimeControllerValue,
        runtimeEpochId: `runtime-epoch-test-${observerOptionsSequence}`,
        scheduleRetry: overrides.scheduleRetry ?? setTimeout,
    };
}

async function eventually(assertion) {
    let last;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            return assertion();
        } catch (error) {
            last = error;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }
    throw last;
}

describe('production read-only Shioaji trade observer', () => {
    it('maps official deal-before-order shape without inventing absent broker identifiers', () => {
        const event = mapShioajiStockBrokerEvent({
            account: {
                brokerId: 'broker-A',
                accountId: 'account-A',
                accountType: 'S',
            },
            apiGeneration: 'simulation:generation-1',
            payload: rawDealEvent(),
            receiveEpochMs: 1_786_550_400_500,
            refreshedTrades: [
                refreshedTrade({
                    status: {
                        deal_quantity: 1,
                        order_quantity: 2,
                        status: 'PartFilled',
                    },
                }),
            ],
        });
        expect(event).toMatchObject({
            eventKind: 'deal',
            identifiers: {
                tradeId: 'trade-1',
                orderId: null,
                dealId: null,
                seqno: 'SEQ001',
                ordno: 'ORD001-D',
                exchangeSequence: 'EXCHANGE-1',
            },
            status: 'PartFilled',
            quantities: {
                order: 2,
                cumulativeDeal: 1,
                cumulativeCancel: 0,
                remaining: 1,
                eventDeal: 1,
            },
        });
    });

    it('rejects legacy seq and deal callback lineage drift against the fixed account trade', () => {
        const base = {
            account: {
                brokerId: 'broker-A',
                accountId: 'account-A',
                accountType: 'S',
            },
            apiGeneration: 'simulation:generation-1',
            receiveEpochMs: 1_786_550_400_500,
            refreshedTrades: [
                refreshedTrade({
                    status: {
                        deal_quantity: 1,
                        order_quantity: 1,
                        status: 'Filled',
                    },
                }),
            ],
        };
        const legacy = rawDealEvent();
        legacy.data.StockDeal.seq = legacy.data.StockDeal.exchange_seq;
        delete legacy.data.StockDeal.exchange_seq;
        expect(() =>
            mapShioajiStockBrokerEvent({ ...base, payload: legacy }),
        ).toThrow('exchange_seq');

        for (const [field, value] of [
            ['account_id', 'other-account'],
            ['broker_id', 'other-broker'],
            ['custom_field', 'OTHER1'],
            ['order_cond', 'MarginTrading'],
            ['order_lot', 'Odd'],
        ]) {
            const drifted = rawDealEvent();
            drifted.data.StockDeal[field] = value;
            expect(() =>
                mapShioajiStockBrokerEvent({ ...base, payload: drifted }),
            ).toThrow('lineage');
        }
    });

    it('does not contact 8080 until the current Gate manifest binds the mapper', async () => {
        const fetchImpl = vi.fn();
        const controller = runtimeController({ gateState: 'observe_only' });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({ fetchImpl, runtimeController: controller }),
        );
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(
            controller.invalidateAuthenticatedIdentityEvidence,
        ).toHaveBeenCalledTimes(1);
        expect(observer.status()).toMatchObject({
            state: 'gate_unverified',
            gateVerified: false,
            identityMappingState: 'principal_unavailable_fail_closed',
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        await observer.close();
    });

    it('never upgrades schema-valid read responses without current Gate completeness capability', async () => {
        const controller = runtimeController();
        controller.gateManifestStatus.mockResolvedValue({
            present: true,
            state: 'eligible',
            manifestRevision: 'manifest-r1',
            manifestSha256: `sha256:${'a'.repeat(64)}`,
            accountReconciliationCapabilitySha256: null,
            accountReconciliationCapabilityVerified: false,
            mappingRevision: SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
            pnlPolicyDefinitionSha256:
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
            validUntilEpochMs: 1_786_550_500_000,
        });
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, {
                    name: 'Shioaji',
                    version: '1.7.1',
                    protocols: ['http', 'sse'],
                    simulation: true,
                });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/stream/data') {
                return sseResponse(url, rawOrderEvent());
            }
            throw new Error(`completeness-unverified endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({ fetchImpl, runtimeController: controller }),
        );
        expect(controller.recordAccountReconciliation).not.toHaveBeenCalled();
        expect(observer.status()).toMatchObject({
            reconciliationCoverageCompleteCount: 0,
            reconciliationPersistedCount: 0,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(
            fetchImpl.mock.calls.some(([url]) =>
                new URL(url).pathname ===
                '/api/v1/portfolio/position_unit',
            ),
        ).toBe(false);
        await observer.close();
    });

    it('derives one fixed Wilder ATR snapshot from bounded completed Kbars and binds it to the current contract evidence', async () => {
        const controller = runtimeController();
        controller.gateManifestStatus.mockResolvedValue({
            present: true,
            state: 'eligible',
            manifestRevision: 'manifest-r1',
            manifestSha256: `sha256:${'a'.repeat(64)}`,
            accountReconciliationCapabilitySha256: null,
            accountReconciliationCapabilityVerified: false,
            mappingRevision: SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
            pnlPolicyDefinitionSha256:
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
            validUntilEpochMs: 1_786_550_500_000,
        });
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        const kbars = Object.fromEntries(
            [
                'datetime',
                'Open',
                'High',
                'Low',
                'Close',
                'Volume',
                'Amount',
            ].map((key) => [
                key,
                Array.from({ length: 16 }, (_, index) => {
                    if (key === 'datetime') {
                        const date = new Date(
                            Date.UTC(2026, 7, 26 + index),
                        ).toISOString().slice(0, 10);
                        return `${date} 13:30:00`;
                    }
                    if (key === 'High') return 101;
                    if (key === 'Low') return 99;
                    if (key === 'Volume' || key === 'Amount') return 1;
                    return 100;
                }),
            ]),
        );
        let contractReadCount = 0;
        const fetchImpl = vi.fn(async (url, init = {}) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/data/contracts/2330/info') {
                contractReadCount += 1;
                return jsonResponse(url, {
                    category: '24',
                    code: '2330',
                    exchange: 'TSE',
                    limit_down: 90,
                    limit_up: 110,
                    reference: 100,
                    security_type: 'STK',
                    unit: contractReadCount === 2 ? 500 : 1_000,
                    update_date: '2026-08-11',
                });
            }
            if (pathname === '/api/v1/data/kbars') {
                expect(init.method).toBe('POST');
                expect(JSON.parse(init.body)).toMatchObject({
                    contract: {
                        code: '2330',
                        exchange: 'TSE',
                        security_type: 'STK',
                    },
                    start: '2026-08-12',
                    end: '2026-09-10',
                });
                return jsonResponse(url, kbars);
            }
            throw new Error(`unexpected fixed ATR endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({ fetchImpl, runtimeController: controller }),
        );
        await expect(
            observer.issueCanonicalContractEvidence({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:STK:2330',
                decisionTradingDate: '2026-09-11',
                fixedAtrRequired: true,
                strategyDefinitionHash: `sha256:${'d'.repeat(64)}`,
            }),
        ).rejects.toThrow(
            'canonical contract metadata changed while fixed ATR was read',
        );
        const evidence = await observer.issueCanonicalContractEvidence({
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            contractKey: 'TSE:STK:2330',
            decisionTradingDate: '2026-09-11',
            fixedAtrRequired: true,
            strategyDefinitionHash: `sha256:${'d'.repeat(64)}`,
        });
        expect(evidence).toMatchObject({
            fixedAtrSnapshot: {
                timeframe: '1D',
                period: 14,
                value: '2',
                asOfTradingDate: '2026-09-10',
                strategyDefinitionHash: `sha256:${'d'.repeat(64)}`,
            },
        });
        expect(isVerifiedSmartOrderCanonicalContractEvidence(evidence)).toBe(
            true,
        );
        for (let index = 0; index < 3; index += 1) {
            await expect(
                observer.issueCanonicalContractEvidence({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:STK:2330',
                    decisionTradingDate: '2026-09-11',
                    fixedAtrRequired: true,
                    strategyDefinitionHash: `sha256:${'d'.repeat(64)}`,
                }),
            ).resolves.toMatchObject({
                fixedAtrSnapshot: { value: '2' },
            });
        }
        await expect(
            observer.issueCanonicalContractEvidence({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:STK:2330',
                decisionTradingDate: '2026-09-11',
                fixedAtrRequired: true,
                strategyDefinitionHash: `sha256:${'d'.repeat(64)}`,
            }),
        ).rejects.toThrow('resource blocked');
        expect(
            fetchImpl.mock.calls.filter(
                ([url]) => new URL(url).pathname === '/api/v1/data/kbars',
            ),
        ).toHaveLength(5);
        expect(
            isVerifiedSmartOrderCanonicalContractEvidence({ ...evidence }),
        ).toBe(false);
        stream.close();
        await observer.close();
    });

    it('subscribes the signed fixed account and persists one mapped event through the Runtime controller', async () => {
        const controller = runtimeController();
        const stream = openSseResponse(
            `${BASE}/api/v1/stream/data/order_event`,
            [{ name: 'order_event', data: rawOrderEvent() }],
        );
        const scheduled = [];
        let nowEpochMs = 1_786_550_400_000;
        controller.recordAccountReconciliation.mockResolvedValue({
            state: 'recorded',
            protectedEntryMaterializationIntentIds: ['protected-entry-intent-1'],
            brokerWriteAuthority: false,
        });
        expect(
            mapShioajiStockBrokerEvent({
                account: {
                    brokerId: 'broker-A',
                    accountId: 'account-A',
                    accountType: 'S',
                },
                apiGeneration: 'simulation:generation-1',
                payload: rawOrderEvent(),
                receiveEpochMs: 1_786_550_400_500,
                refreshedTrades: [refreshedTrade()],
            }),
        ).toMatchObject({ eventKind: 'order', status: 'Submitted' });
        const fetchImpl = vi.fn(async (url, init) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, {
                    name: 'Shioaji',
                    version: '1.7.1',
                    protocols: ['http', 'sse'],
                    simulation: true,
                });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data/order_event') {
                expect(init.method).toBe('GET');
                return stream.response;
            }
            if (pathname === '/api/v1/auth/subscribe_trade') {
                expect(JSON.parse(init.body)).toEqual({
                    broker_id: account.broker_id,
                    account_id: account.account_id,
                    account_type: 'S',
                });
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/order/trades') {
                expect(JSON.parse(init.body)).toEqual({
                    broker_id: account.broker_id,
                    account_id: account.account_id,
                    account_type: 'S',
                });
                return jsonResponse(url, [
                    refreshedTrade({
                        order: { action: 'Sell' },
                        status: {
                            deals: [
                                {
                                    fee: 1.25,
                                    realized_pnl: -10.5,
                                    seq: 'DEAL001',
                                    tax: 0.5,
                                },
                            ],
                        },
                    }),
                ]);
            }
            if (pathname === '/api/v1/portfolio/position_unit') {
                expect(JSON.parse(init.body)).toEqual({
                    broker_id: account.broker_id,
                    account_id: account.account_id,
                    account_type: 'S',
                    unit: 'Share',
                });
                return jsonResponse(url, [
                    {
                        id: 1,
                        code: '2330',
                        direction: 'Buy',
                        quantity: 500,
                        price: 100,
                        last_price: 101,
                        pnl: 1_000,
                        yd_quantity: 500,
                    },
                ]);
            }
            if (pathname === '/api/v1/data/contracts/2330/info') {
                return jsonResponse(url, {
                    category: '24',
                    code: '2330',
                    exchange: 'TSE',
                    limit_down: 90,
                    limit_up: 110,
                    reference: 100,
                    security_type: 'STK',
                    unit: 500,
                    update_date: '2026-08-13',
                });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                nowEpochMs: () => (nowEpochMs += 100),
                runtimeController: controller,
                scheduleRetry(callback, delay) {
                    const handle = { callback, delay, unref() {} };
                    scheduled.push(handle);
                    return handle;
                },
                cancelRetry: vi.fn(),
            }),
        );
        expect(controller.recordCanonicalBrokerEvent).not.toHaveBeenCalled();
        stream.push({ name: 'order_event', data: rawOrderEvent() });
        await eventually(() => {
            expect(controller.recordCanonicalBrokerEvent).toHaveBeenCalledTimes(1);
        });
        const event = controller.recordCanonicalBrokerEvent.mock.calls[0][0].event;
        expect(
            controller.acceptAuthenticatedIdentityEvidence,
        ).toHaveBeenCalledTimes(1);
        await eventually(() => {
            expect(controller.recordAccountReconciliation).toHaveBeenCalledTimes(2);
        });
        expect(controller.recordAccountReconciliation).toHaveBeenCalledTimes(2);
        expect(
            controller.recordAccountReconciliation.mock.calls[0][0]
                .brokerObservationEvidenceSha256,
        ).toBeNull();
        expect(
            controller.recordAccountReconciliation.mock.calls[1][0]
                .brokerObservationEvidenceSha256,
        ).toBe(event.brokerEventEvidenceSha256);
        expect(
            controller.completeBrokerObservationReconciliation,
        ).toHaveBeenCalledWith({
            eventEvidenceSha256: event.brokerEventEvidenceSha256,
        });
        expect(controller.materializeProtectedEntryFill).toHaveBeenCalledTimes(2);
        expect(
            controller.materializeProtectedEntryFill.mock.calls[1][0],
        ).toMatchObject({
            intentId: 'protected-entry-intent-1',
            reconciliationResult: {
                coverageComplete: true,
                brokerWriteAuthority: false,
            },
        });
        expect(
            controller.recordAccountReconciliation.mock.calls[1][0].result,
        ).toMatchObject({
            coverageComplete: true,
            dealCount: 1,
            fullDayTotals: {
                realizedMinorUnits: -1_050,
                unrealizedMinorUnits: 100_000,
                feeMinorUnits: 125,
                transactionTaxMinorUnits: 50,
                netMinorUnits: 98_775,
            },
            externalSellClaimCandidates: [
                {
                    contractKey: 'TSE:2330:STK:Common',
                    quantityShares: 500,
                    state: 'broker_working',
                },
            ],
            brokerWriteAuthority: false,
        });
        expect(
            controller.acceptAuthenticatedIdentityEvidence.mock.calls[0][0],
        ).toMatchObject({
            accountScopes: [
                {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                },
            ],
            canonicalPrincipal: 'broker-authenticated-person',
        });
        expect(event).toMatchObject({
            mappingRevision: SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
            apiGeneration: 'simulation:generation-1',
            eventKind: 'order',
            account: {
                brokerId: 'broker-A',
                accountId: 'account-A',
                accountType: 'S',
            },
            tradeDate: '2026-08-13',
            contractKey: 'TSE:2330:STK:Common',
            identifiers: {
                tradeId: 'trade-1',
                orderId: 'order-1',
                seqno: 'SEQ001',
                ordno: 'ORD001',
            },
            status: 'Submitted',
            quantities: {
                order: 1,
                cumulativeDeal: 0,
                remaining: 1,
                unit: 'CommonLot',
            },
        });
        expect(observer.status()).toMatchObject({
            fixedAccountCount: 1,
            acceptedEventCount: 1,
            identityMappingState: 'authenticated',
            reconciliationRequired: false,
            reconciliationCoverageCompleteCount: 1,
            reconciliationPersistedCount: 1,
            runtimeReadinessContribution: true,
            brokerWriteAuthority: false,
        });
        expect(
            new Set(
                fetchImpl.mock.calls.map(([url]) => new URL(url).pathname),
            ),
        ).toEqual(
            new Set([
                '/api/v1/info',
                '/api/v1/auth/accounts',
                '/api/v1/stream/data',
                '/api/v1/stream/data/order_event',
                '/api/v1/auth/subscribe_trade',
                '/api/v1/order/trades',
                '/api/v1/portfolio/position_unit',
                '/api/v1/data/contracts/2330/info',
            ]),
        );
        const periodic = scheduled.find((entry) => entry.delay === 15_000);
        expect(periodic).toBeDefined();
        periodic.callback();
        await eventually(() => {
            expect(controller.recordAccountReconciliation).toHaveBeenCalledTimes(3);
            expect(controller.materializeProtectedEntryFill).toHaveBeenCalledTimes(3);
        });
        expect(
            controller.recordAccountReconciliation.mock.calls[2][0]
                .brokerObservationEvidenceSha256,
        ).toBeNull();
        expect(observer.status()).toMatchObject({
            reconciliationCoverageCompleteCount: 1,
            reconciliationPersistedCount: 1,
            reconciliationFailureCount: 0,
            brokerWriteAuthority: false,
        });
        controller.recordCanonicalBrokerEvent.mockRejectedValueOnce(
            new Error('manual order has no internal correlation'),
        );
        stream.push({ name: 'order_event', data: rawOrderEvent() });
        await eventually(() => {
            expect(controller.recordCanonicalBrokerEvent).toHaveBeenCalledTimes(2);
            expect(controller.recordAccountReconciliation).toHaveBeenCalledTimes(4);
            expect(controller.materializeProtectedEntryFill).toHaveBeenCalledTimes(4);
        });
        expect(
            controller.recordAccountReconciliation.mock.calls[3][0]
                .brokerObservationEvidenceSha256,
        ).toBe(event.brokerEventEvidenceSha256);
        expect(observer.status()).toMatchObject({
            acceptedEventCount: 1,
            unmatchedEventCount: 1,
            reconciliationRequired: false,
            reconciliationCoverageCompleteCount: 1,
            reconciliationPersistedCount: 1,
            reconciliationFailureCount: 0,
            brokerWriteAuthority: false,
        });

        controller.recordCanonicalBrokerEvent.mockRejectedValueOnce(
            new Error('second manual order has no internal correlation'),
        );
        controller.materializeProtectedEntryFill.mockResolvedValueOnce({
            state: 'reconciliation_required',
            automaticRetryAllowed: false,
            brokerWriteAuthority: false,
        });
        stream.push({ name: 'order_event', data: rawOrderEvent() });
        await eventually(() => {
            expect(controller.recordCanonicalBrokerEvent).toHaveBeenCalledTimes(3);
            expect(controller.recordAccountReconciliation).toHaveBeenCalledTimes(5);
            expect(controller.materializeProtectedEntryFill).toHaveBeenCalledTimes(5);
        });
        expect(
            controller.completeBrokerObservationReconciliation,
        ).toHaveBeenCalledTimes(2);
        expect(observer.status()).toMatchObject({
            unmatchedEventCount: 2,
            reconciliationRequired: true,
            reconciliationFailureCount: 1,
            brokerWriteAuthority: false,
        });
        stream.close();
        await observer.close();
    });

    it('resolves a Share position contract directly when no current trade or working order carries exchange lineage', async () => {
        const controller = runtimeController();
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, {
                    name: 'Shioaji',
                    version: '1.7.1',
                    protocols: ['http', 'sse'],
                    simulation: true,
                });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/order/trades') {
                return jsonResponse(url, []);
            }
            if (pathname === '/api/v1/portfolio/position_unit') {
                return jsonResponse(url, [
                    {
                        id: 2,
                        code: '0050',
                        direction: 'Buy',
                        quantity: 1_000,
                        price: 100,
                        last_price: 101,
                        pnl: 1_000,
                        yd_quantity: 1_000,
                    },
                ]);
            }
            if (pathname === '/api/v1/data/contracts/0050/info') {
                return jsonResponse(url, {
                    category: '00',
                    code: '0050',
                    exchange: 'TSE',
                    limit_down: 90,
                    limit_up: 110,
                    reference: 100,
                    security_type: 'STK',
                    unit: 1_000,
                    update_date: '2026-08-13',
                });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                nowEpochMs: () => 1_786_550_499_000,
                runtimeController: controller,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
            }),
        );
        await vi.waitFor(
            () => {
                expect(
                    controller.recordAccountReconciliation,
                ).toHaveBeenCalledTimes(1);
            },
            { timeout: 1_000, interval: 5 },
        );
        expect(
            controller.recordAccountReconciliation.mock.calls[0][0].result,
        ).toMatchObject({
            coverageComplete: true,
            positionCount: 1,
            workingOrderCount: 0,
            brokerWriteAuthority: false,
        });
        expect(
            fetchImpl.mock.calls.some(
                ([url]) =>
                    new URL(url).pathname ===
                    '/api/v1/data/contracts/0050/info',
            ),
        ).toBe(true);
        stream.close();
        await observer.close();
    });

    it.each([
        'Share position',
        'canonical contract metadata',
        'post-metadata delay',
    ])(
        'fails reconciliation closed when the %s source head changes during one account snapshot',
        async (driftKind) => {
        const controller = runtimeController();
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        let positionReadCount = 0;
        let contractReadCount = 0;
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, {
                    name: 'Shioaji',
                    version: '1.7.1',
                    protocols: ['http', 'sse'],
                    simulation: true,
                });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/order/trades') {
                return jsonResponse(url, []);
            }
            if (pathname === '/api/v1/portfolio/position_unit') {
                positionReadCount += 1;
                return jsonResponse(url, [
                    {
                        id: 2,
                        code: '0050',
                        direction: 'Buy',
                        quantity:
                            driftKind === 'Share position' &&
                            positionReadCount === 2
                                ? 500
                                : 1_000,
                        price: 100,
                        last_price: 101,
                        pnl: 1_000,
                        yd_quantity: 1_000,
                    },
                ]);
            }
            if (pathname === '/api/v1/data/contracts/0050/info') {
                contractReadCount += 1;
                return jsonResponse(url, {
                    category: '00',
                    code: '0050',
                    exchange: 'TSE',
                    limit_down: 90,
                    limit_up: 110,
                    reference: 100,
                    security_type: 'STK',
                    unit:
                        driftKind === 'canonical contract metadata' &&
                        contractReadCount === 2
                            ? 500
                            : 1_000,
                    update_date: '2026-08-13',
                });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                nowEpochMs: () =>
                    1_786_550_499_050 +
                    (driftKind === 'post-metadata delay' &&
                    positionReadCount >= 3
                        ? 5_001
                        : 0),
                runtimeController: controller,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
            }),
        );
        await vi.waitFor(
            () => {
                expect(observer.status().reconciliationFailureCount).toBeGreaterThan(0);
            },
            { timeout: 1_000, interval: 5 },
        );
        expect(positionReadCount).toBeGreaterThanOrEqual(2);
        expect(contractReadCount).toBeGreaterThanOrEqual(2);
        expect(controller.recordAccountReconciliation).not.toHaveBeenCalled();
        expect(observer.status()).toMatchObject({
            reconciliationRequired: true,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        stream.close();
        await observer.close();
        },
    );

    it('fails reconciliation closed when Common order and status lot quantities disagree', async () => {
        const controller = runtimeController();
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, {
                    name: 'Shioaji',
                    version: '1.7.1',
                    protocols: ['http', 'sse'],
                    simulation: true,
                });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/order/trades') {
                return jsonResponse(url, [
                    refreshedTrade({
                        order: { action: 'Sell', quantity: 2 },
                        status: { order_quantity: 1 },
                    }),
                ]);
            }
            if (pathname === '/api/v1/portfolio/position_unit') {
                return jsonResponse(url, [
                    {
                        id: 3,
                        code: '2330',
                        direction: 'Buy',
                        quantity: 500,
                        price: 100,
                        last_price: 101,
                        pnl: 500,
                        yd_quantity: 500,
                    },
                ]);
            }
            if (pathname === '/api/v1/data/contracts/2330/info') {
                return jsonResponse(url, {
                    category: '24',
                    code: '2330',
                    exchange: 'TSE',
                    limit_down: 90,
                    limit_up: 110,
                    reference: 100,
                    security_type: 'STK',
                    unit: 500,
                    update_date: '2026-08-13',
                });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                nowEpochMs: () => 1_786_550_499_100,
                runtimeController: controller,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
            }),
        );
        await vi.waitFor(
            () => {
                expect(observer.status().reconciliationFailureCount).toBeGreaterThan(0);
            },
            { timeout: 1_000, interval: 5 },
        );
        expect(controller.recordAccountReconciliation).not.toHaveBeenCalled();
        expect(observer.status()).toMatchObject({
            reconciliationRequired: true,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        stream.close();
        await observer.close();
    });

    it('executes quote subscribe/unsubscribe on the existing login and advances only a non-authoritative freshness head', async () => {
        let monotonic = 100;
        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'simulation:generation-1',
            connectionId: 'quote-before-shared-sse',
            nowMonotonicMs: () => ++monotonic,
            resourceCoordinator: currentResourceCoordinator(),
            resourceCountingDimension: 'same_login_quote_subscriptions',
        });
        const demand = quoteCoordinator.runtime.acquireDemand({
            consumerId: 'runtime:strategy-quote-1',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'tick',
        });
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        const fetchImpl = vi.fn(async (url, init) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (
                pathname === '/api/v1/stream/subscribe' ||
                pathname === '/api/v1/stream/unsubscribe'
            ) {
                expect(JSON.parse(init.body)).toEqual({
                    security_type: 'STK',
                    region: 'TW',
                    exchange: 'TSE',
                    code: '2330',
                    target_code: null,
                    quote_type: 'Tick',
                    intraday_odd: false,
                });
                return jsonResponse(url, { success: true });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const controller = runtimeController();
        const observerOptions = options({
                fetchImpl,
                nowEpochMs: () => Date.UTC(2026, 7, 13, 1, 0, 0, 500),
                quoteSubscriptionCoordinator: quoteCoordinator,
                runtimeController: controller,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
            });
        expect(observerOptions.nowEpochMs()).toBe(
            Date.UTC(2026, 7, 13, 1, 0, 0, 500),
        );
        const observer = await startSmartOrderShioajiTradeObserver(
            observerOptions,
        );
        stream.push({
            name: 'tick_stk',
            data: {
                code: '2330',
                date: '2026-08-13',
                time: '09:00:00.000000',
                close: '100',
                volume: 1,
                total_volume: 1,
                price_chg: '1',
                pct_chg: 100,
                intraday_odd: false,
                simtrade: false,
            },
        });
        await eventually(() => {
            expect(observer.status()).toMatchObject({
                quoteConnectionActive: true,
                quoteConfirmedSubscriptionCount: 1,
                quoteObservationCount: 1,
                normalizedQuoteEventCount: 1,
                normalizedQuoteFieldCount: 7,
                rejectedQuoteEventCount: 0,
                lastQuickFieldRejectionReason: null,
                protectiveTriggerCandidateCount: 1,
                quickFieldMappingState: 'verified_current',
                protectiveTriggerPolicy:
                    'current_fresh_normal_lot_last_trade_only',
                productionQuoteTransportConfigured: true,
                runtimeReadinessContribution: false,
                brokerWriteAuthority: false,
            });
        });
        expect(
            controller.recordProtectiveQuoteObservation,
        ).toHaveBeenCalledTimes(1);
        expect(controller.recordQuickQuoteObservation).toHaveBeenCalledTimes(1);
        expect(
            controller.recordQuickQuoteObservation.mock.calls[0][0]
                .observation,
        ).toMatchObject({
            contractKey: 'TSE:STK:2330',
            eventKind: 'tick',
            quickConditionEligible: true,
            brokerWriteAuthority: false,
        });
        const issuedObservation =
            controller.recordProtectiveQuoteObservation.mock.calls[0][0]
                .observation;
        expect(issuedObservation).toMatchObject({
            contractKey: 'TSE:STK:2330',
            field: 'last_price',
            protectiveTriggerEligible: true,
            value: '100',
        });
        expect(issuedObservation.brokerWriteAuthority).toBe(false);
        expect(
            quoteCoordinator.observer.getSubscriptionStatus({
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'tick',
            }),
        ).toMatchObject({
            current: true,
            protectiveTriggerCurrent: true,
            protectiveTriggerState: 'fresh',
            runtimeReadinessContribution: false,
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(observer.protectiveQuoteStatus()).toEqual({
            state: 'fresh',
            asOfExchangeTime: '2026-08-13T01:00:00.000Z',
            authoritativeForActivation: false,
        });
        monotonic += 3_001;
        expect(
            quoteCoordinator.observer.getSubscriptionStatus({
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'tick',
            }),
        ).toMatchObject({
            current: false,
            protectiveTriggerCurrent: false,
            protectiveTriggerState: 'stale',
            headFresh: false,
            blocker: 'quote_freshness_head_stale',
            conditionEligibilityAuthority: false,
            brokerWriteAuthority: false,
        });
        expect(observer.protectiveQuoteStatus()).toEqual({
            state: 'stale',
            asOfExchangeTime: '2026-08-13T01:00:00.000Z',
            authoritativeForActivation: false,
        });
        await expect(
            observer.releaseRuntimeQuoteDemand(demand),
        ).resolves.toMatchObject({
            allowed: true,
            action: 'unsubscribe_planned',
            brokerWriteAuthority: false,
        });
        expect(
            fetchImpl.mock.calls.filter(
                ([url]) =>
                    new URL(url).pathname === '/api/v1/stream/subscribe',
            ),
        ).toHaveLength(1);
        expect(
            fetchImpl.mock.calls.filter(
                ([url]) =>
                    new URL(url).pathname === '/api/v1/stream/unsubscribe',
            ),
        ).toHaveLength(1);
        expect(
            fetchImpl.mock.calls.some(([url]) =>
                ['/api/v1/data/snapshots', '/api/v1/data/ticks', '/api/v1/data/kbars'].includes(
                    new URL(url).pathname,
                ),
            ),
        ).toBe(false);
        const closePromise = observer.close();
        stream.close();
        await closePromise;
    });

    it('normalizes BidAsk for display fields without creating a protective-trigger candidate', async () => {
        let monotonic = 500;
        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'simulation:generation-1',
            connectionId: 'quote-bidask-before-sse',
            nowMonotonicMs: () => ++monotonic,
            resourceCoordinator: currentResourceCoordinator(),
            resourceCountingDimension: 'same_login_quote_subscriptions',
        });
        quoteCoordinator.runtime.acquireDemand({
            consumerId: 'runtime:bidask-display-only',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'bidask',
        });
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/stream/subscribe') {
                return jsonResponse(url, { success: true });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const controller = runtimeController();
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                nowEpochMs: () => Date.UTC(2026, 7, 13, 1, 0, 1, 500),
                quoteSubscriptionCoordinator: quoteCoordinator,
                runtimeController: controller,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
            }),
        );
        stream.push({
            name: 'bidask_stk',
            data: {
                code: '2330',
                date: '2026/08/13',
                time: '09:00:01.000000',
                bid_price: ['99.5'],
                ask_price: ['100'],
                intraday_odd: false,
                simtrade: false,
            },
        });
        await eventually(() => {
            expect(observer.status()).toMatchObject({
                quoteObservationCount: 1,
                normalizedQuoteEventCount: 1,
                normalizedQuoteFieldCount: 2,
                protectiveTriggerCandidateCount: 0,
                conditionEligibilityAuthority: false,
                brokerWriteAuthority: false,
            });
        });
        expect(controller.recordQuickQuoteObservation).toHaveBeenCalledTimes(1);
        expect(
            controller.recordQuickQuoteObservation.mock.calls[0][0]
                .observation,
        ).toMatchObject({
            contractKey: 'TSE:STK:2330',
            eventKind: 'bidask',
            quickConditionEligible: true,
            protectiveTriggerEligible: false,
            brokerWriteAuthority: false,
        });
        const closePromise = observer.close();
        stream.close();
        await closePromise;
    });

    it('keeps quote demand off the wire when Gate-verified shared resource usage is unavailable', async () => {
        let monotonic = 200;
        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'simulation:generation-1',
            connectionId: 'quote-no-resource-before-sse',
            nowMonotonicMs: () => ++monotonic,
            resourceCoordinator: null,
            resourceCountingDimension: null,
        });
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                quoteSubscriptionCoordinator: quoteCoordinator,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
            }),
        );
        const demand = await observer.acquireRuntimeQuoteDemand({
            consumerId: 'runtime:resource-blocked-strategy',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'bidask',
        });
        expect(demand).toMatchObject({
            handleClass: 'runtime_quote_demand',
            brokerWriteAuthority: false,
        });
        expect(
            quoteCoordinator.observer.getSubscriptionStatus({
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'bidask',
            }),
        ).toMatchObject({
            current: false,
            physicalState: 'resource_blocked',
            resourceBlocker: 'subscription_resource_admission_unavailable',
        });
        expect(
            fetchImpl.mock.calls.some(
                ([url]) =>
                    new URL(url).pathname === '/api/v1/stream/subscribe',
            ),
        ).toBe(false);
        const closePromise = observer.close();
        stream.close();
        await closePromise;
    });

    it('treats a thrown quote subscription transport result as unknown and never auto-retries it', async () => {
        const controller = runtimeController();
        let monotonic = 250;
        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'simulation:generation-1',
            connectionId: 'quote-before-ambiguous-result',
            nowMonotonicMs: () => ++monotonic,
            resourceCoordinator: currentResourceCoordinator(),
            resourceCountingDimension: 'same_login_quote_subscriptions',
        });
        quoteCoordinator.runtime.acquireDemand({
            consumerId: 'runtime:ambiguous-subscribe',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'bidask',
        });
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        const orderStream = openSseResponse(
            `${BASE}/api/v1/stream/data/order_event`,
        );
        let signalQuoteMutationStarted;
        const quoteMutationStarted = new Promise((resolve) => {
            signalQuoteMutationStarted = resolve;
        });
        let rejectQuoteMutation;
        const quoteMutationResult = new Promise((_, reject) => {
            rejectQuoteMutation = reject;
        });
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/stream/data/order_event') {
                return orderStream.response;
            }
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/stream/subscribe') {
                signalQuoteMutationStarted();
                return quoteMutationResult;
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const scheduleRetry = vi.fn(() => ({ unref() {} }));
        const observerPromise = startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                quoteSubscriptionCoordinator: quoteCoordinator,
                runtimeController: controller,
                scheduleRetry,
            }),
        );
        await quoteMutationStarted;
        orderStream.push({
            name: 'order_event',
            data: rawOrderEvent(),
        });
        await eventually(() => {
            expect(controller.recordCanonicalBrokerEvent).not.toHaveBeenCalled();
        });
        rejectQuoteMutation(
            new Error('socket closed after possible request bytes'),
        );
        const observer = await observerPromise;
        expect(observer.status()).toMatchObject({
            state: 'quote_subscription_manual_recovery_required',
            quotePlanFailureCount: 1,
            quoteConfirmedSubscriptionCount: 0,
            subscriptionBarrierOpen: false,
            preSubscriptionEventDiscardCount: 1,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        expect(
            quoteCoordinator.observer.getSubscriptionStatus({
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'bidask',
            }),
        ).toMatchObject({
            current: false,
            physicalState: 'disconnected',
            resourceAdmitted: true,
        });
        expect(
            fetchImpl.mock.calls.filter(
                ([url]) =>
                    new URL(url).pathname === '/api/v1/stream/subscribe',
            ),
        ).toHaveLength(1);
        expect(scheduleRetry).not.toHaveBeenCalled();
        expect(controller.recordCanonicalBrokerEvent).not.toHaveBeenCalled();
        const closePromise = observer.close();
        stream.close();
        orderStream.close();
        await closePromise;
    });

    it('aborts and settles an in-flight quote mutation as unknown before observer close returns', async () => {
        let monotonic = 275;
        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'simulation:generation-1',
            connectionId: 'quote-before-close-race',
            nowMonotonicMs: () => ++monotonic,
            resourceCoordinator: currentResourceCoordinator(),
            resourceCountingDimension: 'same_login_quote_subscriptions',
        });
        const stream = openSseResponse(`${BASE}/api/v1/stream/data`);
        let quoteMutationStarted;
        const started = new Promise((resolve) => {
            quoteMutationStarted = resolve;
        });
        const fetchImpl = vi.fn(async (url, init) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') return stream.response;
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/stream/subscribe') {
                quoteMutationStarted();
                return new Promise((_, reject) => {
                    init.signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('aborted', 'AbortError')),
                        { once: true },
                    );
                });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                quoteSubscriptionCoordinator: quoteCoordinator,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
            }),
        );
        const acquire = observer.acquireRuntimeQuoteDemand({
            consumerId: 'runtime:close-race',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'tick',
        });
        await started;
        const close = observer.close();
        await expect(acquire).resolves.toMatchObject({
            handleClass: 'runtime_quote_demand',
            brokerWriteAuthority: false,
        });
        stream.close();
        await expect(close).resolves.toMatchObject({ state: 'closed' });
        expect(
            quoteCoordinator.observer.getSubscriptionStatus({
                contract: {
                    code: '2330',
                    exchange: 'TSE',
                    securityType: 'STK',
                },
                quoteType: 'tick',
            }),
        ).toMatchObject({
            physicalState: 'subscribe_result_unknown',
            resourceAdmitted: true,
            current: false,
        });
    });

    it('binds every signed stock account only when the broker person is identical', async () => {
        const secondAccount = Object.freeze({
            ...account,
            account_id: 'account-B',
        });
        const fetchForAccounts = (accounts) =>
            vi.fn(async (url, init) => {
                const pathname = new URL(url).pathname;
                if (pathname === '/api/v1/info') {
                    return jsonResponse(url, { simulation: true });
                }
                if (pathname === '/api/v1/auth/accounts') {
                    return jsonResponse(url, accounts);
                }
                if (pathname === '/api/v1/stream/data') {
                    return abortableEmptySseResponse(url, init?.signal);
                }
                if (pathname === '/api/v1/auth/subscribe_trade') {
                    return jsonResponse(url, { success: true });
                }
                throw new Error(`unexpected endpoint ${pathname}`);
            });

        const acceptedController = runtimeController();
        const accepted = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl: fetchForAccounts([account, secondAccount]),
                runtimeController: acceptedController,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
                cancelRetry: vi.fn(),
            }),
        );
        expect(
            acceptedController.acceptAuthenticatedIdentityEvidence,
        ).toHaveBeenCalledTimes(1);
        expect(
            acceptedController.acceptAuthenticatedIdentityEvidence.mock
                .calls[0][0].accountScopes,
        ).toEqual([
            { accountBrokerRef: 'broker-A', accountIdRef: 'account-A' },
            { accountBrokerRef: 'broker-A', accountIdRef: 'account-B' },
        ]);
        expect(accepted.status()).toMatchObject({
            fixedAccountCount: 2,
            identityMappingState: 'authenticated',
            accountIdentifiersExposed: false,
        });
        await accepted.close();

        const conflictedController = runtimeController();
        const conflicted = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl: fetchForAccounts([
                    account,
                    Object.freeze({
                        ...secondAccount,
                        person_id: 'different-broker-person',
                    }),
                ]),
                runtimeController: conflictedController,
                scheduleRetry: vi.fn(() => ({ unref() {} })),
                cancelRetry: vi.fn(),
            }),
        );
        expect(
            conflictedController.acceptAuthenticatedIdentityEvidence,
        ).not.toHaveBeenCalled();
        expect(
            conflictedController.invalidateAuthenticatedIdentityEvidence,
        ).toHaveBeenCalled();
        expect(conflicted.status()).toMatchObject({
            fixedAccountCount: 2,
            identityMappingState: 'principal_unavailable_fail_closed',
            brokerWriteAuthority: false,
        });
        await conflicted.close();
    });

    it('latches a definite subscribe failure without persisting or issuing a write', async () => {
        const controller = runtimeController();
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data') {
                return sseResponse(url, rawOrderEvent());
            }
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: false });
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                runtimeController: controller,
                scheduleRetry: () => ({ unref() {} }),
                cancelRetry: () => {},
            }),
        );
        expect(observer.status()).toMatchObject({
            state: 'transport_failed_reconciliation_required',
            confirmedAccountCount: 0,
            reconciliationRequired: true,
            brokerWriteAuthority: false,
        });
        expect(controller.recordCanonicalBrokerEvent).not.toHaveBeenCalled();
        expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).not.toContain(
            '/api/v1/order/place_order',
        );
        await observer.close();
    });

    it('uses a new connection lineage after disconnect before accepting the next event', async () => {
        const controller = runtimeController();
        const reportRuntimeGapLifecycle = vi.fn();
        let monotonic = 300;
        const quoteCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
            apiGeneration: 'simulation:generation-1',
            connectionId: 'quote-before-reconnect',
            nowMonotonicMs: () => ++monotonic,
            resourceCoordinator: currentResourceCoordinator(),
            resourceCountingDimension: 'same_login_quote_subscriptions',
        });
        quoteCoordinator.runtime.acquireDemand({
            consumerId: 'runtime:reconnect-strategy',
            contract: {
                code: '2330',
                exchange: 'TSE',
                securityType: 'STK',
            },
            quoteType: 'tick',
        });
        let streamCount = 0;
        let currentOrderStream;
        let quoteSubscribeCount = 0;
        const scheduledRetries = [];
        const fetchImpl = vi.fn(async (url) => {
            const pathname = new URL(url).pathname;
            if (pathname === '/api/v1/info') {
                return jsonResponse(url, { simulation: true });
            }
            if (pathname === '/api/v1/auth/accounts') {
                return jsonResponse(url, [account]);
            }
            if (pathname === '/api/v1/stream/data/order_event') {
                streamCount += 1;
                currentOrderStream = openSseResponse(url);
                return currentOrderStream.response;
            }
            if (pathname === '/api/v1/auth/subscribe_trade') {
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/stream/subscribe') {
                quoteSubscribeCount += 1;
                return jsonResponse(url, { success: true });
            }
            if (pathname === '/api/v1/order/trades') {
                return jsonResponse(url, [refreshedTrade()]);
            }
            throw new Error(`unexpected endpoint ${pathname}`);
        });
        const observer = await startSmartOrderShioajiTradeObserver(
            options({
                fetchImpl,
                quoteSubscriptionCoordinator: quoteCoordinator,
                runtimeController: controller,
                reportRuntimeGapLifecycle,
                scheduleRetry(callback, delayMs) {
                    scheduledRetries.push({ callback, delayMs });
                    return { unref() {} };
                },
                cancelRetry: () => {},
            }),
        );
        currentOrderStream.close();
        await eventually(() => {
            expect(
                scheduledRetries.some(({ delayMs }) => delayMs === 1_000),
            ).toBe(true);
        });
        scheduledRetries.find(({ delayMs }) => delayMs === 1_000).callback();
        await eventually(() => {
            expect(streamCount).toBeGreaterThanOrEqual(2);
            expect(quoteSubscribeCount).toBe(2);
        });
        currentOrderStream.push({
            name: 'order_event',
            data: rawOrderEvent(),
        });
        await eventually(() => {
            expect(controller.recordCanonicalBrokerEvent).toHaveBeenCalledTimes(1);
        });
        expect(observer.status()).toMatchObject({
            acceptedEventCount: 1,
            reconciliationRequired: true,
            brokerWriteAuthority: false,
        });
        await eventually(() => {
            expect(
                reportRuntimeGapLifecycle.mock.calls.map(
                    ([event]) => event.phase,
                ),
            ).toEqual(expect.arrayContaining(['disconnect', 'reconnect']));
        });
        const closePromise = observer.close();
        currentOrderStream.close();
        await closePromise;
    });

    it('reports a heartbeat timeout before any reconnect can continue', async () => {
        vi.useFakeTimers();
        try {
            const reportRuntimeGapLifecycle = vi.fn();
            const fetchImpl = vi.fn(async (url) => {
                const pathname = new URL(url).pathname;
                if (pathname === '/api/v1/info') {
                    return jsonResponse(url, { simulation: true });
                }
                if (pathname === '/api/v1/auth/accounts') {
                    return jsonResponse(url, [account]);
                }
                if (pathname === '/api/v1/stream/data') {
                    return {
                        ...sseResponse(url),
                        body: new ReadableStream({ start() {} }),
                    };
                }
                if (pathname === '/api/v1/auth/subscribe_trade') {
                    return jsonResponse(url, { success: true });
                }
                throw new Error(`unexpected endpoint ${pathname}`);
            });
            const observer = await startSmartOrderShioajiTradeObserver(
                options({
                    fetchImpl,
                    reportRuntimeGapLifecycle,
                    scheduleRetry: () => ({ unref() {} }),
                    cancelRetry: () => {},
                }),
            );
            await vi.advanceTimersByTimeAsync(30_000);
            expect(reportRuntimeGapLifecycle).toHaveBeenCalledWith(
                expect.objectContaining({
                    phase: 'heartbeat_timeout',
                    streamId: 'shioaji-trade-sse',
                }),
            );
            await observer.close();
        } finally {
            vi.useRealTimers();
        }
    });
});
