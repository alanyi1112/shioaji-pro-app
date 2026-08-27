import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
    canonicalGoodTillPlaceRequest,
    canonicalParentChildPlaceRequest,
    canonicalProtectedEntryPlaceRequest,
    canonicalProtectiveExitPlaceRequest,
    createProductionNodeSafeSmartOrderBrokerAdapter,
} from './node-safe-broker-adapter.mjs';
import { createSmartOrderResourceCoordinator } from './resource-coordinator.mjs';
import { buildSmartOrderProtectiveBrokerIntentPayload } from './broker-execution-policy.mjs';
import {
    SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
    SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
    canonicalProtectedEntryPlan,
} from './protected-entry-contract.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function protectedEntryPayload() {
    const plan = {
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_PLAN_SCHEMA_VERSION,
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        confirmationSnapshotHash: DIGEST,
        contractKey: 'TSE:2330:STK:Common',
        contractPricePolicy: {
            categoryCode: '24',
            limitDownMinorUnits: 9000,
            limitUpMinorUnits: 11000,
        },
        modeRevision: 'simulation-generation/1',
        riskRevision: 'risk-policy/1',
        riskPolicy: {
            schemaVersion:
                SMART_ORDER_PROTECTED_ENTRY_RISK_POLICY_SCHEMA_VERSION,
            policyRevision: 'risk-policy/1',
            buyFeeBps: 1,
            minimumBuyFeeMinorUnits: 0,
            cashBufferMinorUnits: 0,
        },
        basis: {
            source: 'entry_weighted_average_fill',
            previewPrice: '100',
        },
        entryOrder: {
            side: 'Buy',
            orderCond: 'Cash',
            orderLot: 'Common',
            baseShares: 1_000,
            commonLots: 1,
            contractUnit: 1_000,
            priceType: 'LMT',
            timeInForce: 'ROD',
            limitPrice: '100',
        },
        fixedAtrSnapshot: null,
        protection: {
            family: 'fixed',
            legs: [
                {
                    legId: 'stop-leg',
                    type: 'stop',
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                    execution: {
                        priceType: 'MKT',
                        timeInForce: 'IOC',
                        limitPrice: null,
                    },
                },
            ],
        },
    };
    const canonical = canonicalProtectedEntryPlan(plan);
    return {
        schemaVersion: SMART_ORDER_PROTECTED_ENTRY_INTENT_SCHEMA_VERSION,
        confirmationSnapshotHash: DIGEST,
        entryOrder: plan.entryOrder,
        protectionPlan: plan,
        protectionPlanSha256: canonical.planSha256,
    };
}

describe('production Node-safe broker adapter admission', () => {
    it.each([
        ['parent', 'Buy', 'TSE:2330:STK:Common', 1_000, 1_000, 'ROD'],
        ['child', 'Sell', 'TSE:2303:STK:Common', 500, 500, 'IOC'],
    ])(
        'maps a canonical parent-child %s leg to its own fixed-account contract',
        (leg, side, contractKey, baseShares, contractUnit, timeInForce) => {
            const payload = {
                activationTradeDate: '2026-08-11',
                childPositionLineageId:
                    leg === 'child' ? 'position-child-2303' : null,
                conditionEvidenceHash: DIGEST,
                confirmationSnapshotHash: DIGEST,
                leg,
                order: {
                    baseShares,
                    commonLots: 1,
                    contractKey,
                    contractUnit,
                    limitPrice: leg === 'parent' ? '100' : '95',
                    orderCond: 'Cash',
                    orderLot: 'Common',
                    policyRevision: 'risk-policy/1',
                    priceType: 'LMT',
                    side,
                    timeInForce,
                },
                parentSettlementHash: leg === 'child' ? DIGEST : null,
                schemaVersion: 'smart-order-parent-child-intent/2026-08-21.1',
                strategyId: 'parent-child-adapter-test',
            };
            expect(
                canonicalParentChildPlaceRequest({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey,
                    payload,
                    side,
                }),
            ).toMatchObject({
                brokerAuthority: false,
                automaticRetryAllowed: false,
                contractKey,
                contractUnit,
                expectedShares: baseShares,
                expectedSide: side,
                request: {
                    path: '/api/v1/order/place_order',
                    body: {
                        stock_order: {
                            action: side,
                            order_cond: 'Cash',
                            order_lot: 'Common',
                            order_type: timeInForce,
                            quantity: 1,
                        },
                    },
                },
            });
        },
    );

    it('rejects cross-leg scope and quantity confusion before broker transport', () => {
        const payload = {
            activationTradeDate: '2026-08-11',
            childPositionLineageId: 'position-child-2303',
            conditionEvidenceHash: DIGEST,
            confirmationSnapshotHash: DIGEST,
            leg: 'child',
            order: {
                baseShares: 500,
                commonLots: 1,
                contractKey: 'TSE:2303:STK:Common',
                contractUnit: 500,
                limitPrice: '95',
                orderCond: 'Cash',
                orderLot: 'Common',
                policyRevision: 'risk-policy/1',
                priceType: 'LMT',
                side: 'Sell',
                timeInForce: 'ROD',
            },
            parentSettlementHash: DIGEST,
            schemaVersion: 'smart-order-parent-child-intent/2026-08-21.1',
            strategyId: 'parent-child-adapter-test',
        };
        expect(() =>
            canonicalParentChildPlaceRequest({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                payload,
                side: 'Sell',
            }),
        ).toThrow('parent-child place envelope is inconsistent');
        expect(() =>
            canonicalParentChildPlaceRequest({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: payload.order.contractKey,
                payload: {
                    ...payload,
                    order: { ...payload.order, baseShares: 600 },
                },
                side: 'Sell',
            }),
        ).toThrow('parent-child place envelope is inconsistent');
    });

    it.each(['ROD', 'IOC'])(
        'maps a canonical good-till %s daily intent without retry authority',
        (timeInForce) => {
            const payload = {
                activationTradeDate: '2026-08-11',
                conditionEvidenceHash: DIGEST,
                confirmationSnapshotHash: DIGEST,
                order: {
                    baseShares: 1_000,
                    commonLots: 2,
                    contractKey: 'TSE:2330:STK:Common',
                    contractUnit: 500,
                    limitPrice: '100',
                    orderCond: 'Cash',
                    orderLot: 'Common',
                    policyRevision: 'risk-policy/1',
                    priceType: 'LMT',
                    side: 'Buy',
                    timeInForce,
                },
                progress: {
                    targetShares: 3_000,
                    confirmedFilledSharesBefore: 1_000,
                    remainingTargetSharesAfter: 1_000,
                },
                schemaVersion: 'smart-order-good-till-intent/2026-08-21.1',
                strategyId: 'good-till-adapter-test',
            };
            expect(
                canonicalGoodTillPlaceRequest({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:2330:STK:Common',
                    payload,
                    side: 'Buy',
                }),
            ).toMatchObject({
                brokerAuthority: false,
                automaticRetryAllowed: false,
                expectedShares: 1_000,
                contractUnit: 500,
                request: {
                    path: '/api/v1/order/place_order',
                    body: {
                        stock_order: {
                            action: 'Buy',
                            order_type: timeInForce,
                            price_type: 'LMT',
                            price: 100,
                            quantity: 2,
                        },
                    },
                },
            });
            expect(() =>
                canonicalGoodTillPlaceRequest({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:2330:STK:Common',
                    payload: {
                        ...payload,
                        progress: {
                            ...payload.progress,
                            remainingTargetSharesAfter: 999,
                        },
                    },
                    side: 'Buy',
                }),
            ).toThrow('good-till place envelope is inconsistent');
        },
    );

    it('builds place_order only from the canonical full fixed-account plan', () => {
        expect(
            canonicalProtectedEntryPlaceRequest({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                payload: protectedEntryPayload(),
                side: 'Buy',
            }),
        ).toEqual({
            brokerAuthority: false,
            contractKey: 'TSE:2330:STK:Common',
            contractUnit: 1_000,
            expectedShares: 1_000,
            fixedAccount: {
                brokerId: 'broker-A',
                accountId: 'account-A',
                accountType: 'S',
            },
            request: {
                path: '/api/v1/order/place_order',
                body: {
                    contract: {
                        exchange: 'TSE',
                        code: '2330',
                        region: 'TW',
                        security_type: 'STK',
                        target_code: null,
                    },
                    stock_order: {
                        account: {
                            broker_id: 'broker-A',
                            account_id: 'account-A',
                            account_type: 'S',
                        },
                        action: 'Buy',
                        order_cond: 'Cash',
                        order_lot: 'Common',
                        order_type: 'ROD',
                        price: 100,
                        price_type: 'LMT',
                        quantity: 1,
                    },
                },
            },
        });
    });

    it.each([
        ['LMT', 'ROD', '95', 95],
        ['LMT', 'IOC', '95', 95],
        ['MKT', 'IOC', null, 0],
    ])(
        'maps the durable protective %s/%s execution to an exact fixed-account Sell',
        (priceType, timeInForce, limitPrice, brokerPrice) => {
            const entryPayload = protectedEntryPayload();
            const plan = {
                ...entryPayload.protectionPlan,
                entryOrder: {
                    ...entryPayload.protectionPlan.entryOrder,
                    baseShares: 1_000,
                    commonLots: 2,
                    contractUnit: 500,
                },
                protection: {
                    ...entryPayload.protectionPlan.protection,
                    legs: [
                        {
                            ...entryPayload.protectionPlan.protection.legs[0],
                            execution: {
                                priceType,
                                timeInForce,
                                limitPrice,
                            },
                        },
                    ],
                },
            };
            const payload = buildSmartOrderProtectiveBrokerIntentPayload({
                legId: 'stop-leg',
                protectionPlan: plan,
                quantityShares: 1_000,
                triggerPolicyHash: DIGEST,
            }).payload;
            expect(
                canonicalProtectiveExitPlaceRequest({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    contractKey: 'TSE:2330:STK:Common',
                    payload,
                    side: 'Sell',
                }),
            ).toMatchObject({
                brokerAuthority: false,
                contractUnit: 500,
                expectedShares: 1_000,
                automaticRetryAllowed: false,
                request: {
                    path: '/api/v1/order/place_order',
                    body: {
                        stock_order: {
                            action: 'Sell',
                            order_cond: 'Cash',
                            order_lot: 'Common',
                            order_type: timeInForce,
                            price: brokerPrice,
                            price_type: priceType,
                            quantity: 2,
                        },
                    },
                },
            });
        },
    );

    it('rejects the legacy quantity-only exit before broker transport is reachable', () => {
        expect(() =>
            canonicalProtectiveExitPlaceRequest({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                payload: {
                    schemaVersion:
                        'smart-order-protective-broker-intent/2026-08-12.1',
                    quantityShares: 1_000,
                },
                side: 'Sell',
            }),
        ).toThrow('payload is invalid');

        const entryPayload = protectedEntryPayload();
        const partial = buildSmartOrderProtectiveBrokerIntentPayload({
            legId: 'stop-leg',
            protectionPlan: entryPayload.protectionPlan,
            quantityShares: 500,
            triggerPolicyHash: DIGEST,
        }).payload;
        expect(() =>
            canonicalProtectiveExitPlaceRequest({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                contractKey: 'TSE:2330:STK:Common',
                payload: partial,
                side: 'Sell',
            }),
        ).toThrow('CommonLot quantity is invalid');
    });

    it('is structurally present but Gate 0 closed without a module-issued contract capability', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const resourceCoordinator = createSmartOrderResourceCoordinator();
        const adapter = createProductionNodeSafeSmartOrderBrokerAdapter({
            appSupportRoot: '/private/tmp/unused-smart-order-root',
            expectedApiGeneration: 'simulation-generation/1',
            leaseDirectory: '/private/tmp/unused-smart-order-lease',
            resourceCoordinator,
            contractCapability: Object.freeze({ eligible: true }),
        });
        expect(adapter).toMatchObject({
            enabled: false,
            gateClosed: true,
            schemaVersion:
                'smart-order-node-safe-broker-adapter/2026-08-20.1',
        });
        await expect(
            adapter.preflight({ brokerWriteAllowed: false }),
        ).rejects.toThrow('Gate 0 broker contract capability is unavailable');
        await expect(adapter.execute(Object.freeze({}))).rejects.toThrow(
            'Gate 0 broker contract capability is unavailable',
        );
        expect(fetchSpy).not.toHaveBeenCalled();
        resourceCoordinator.close();
        fetchSpy.mockRestore();
    });

    it('exports only the production predicate and no capability issuer', async () => {
        const authority = await import('./broker-contract-verifier-authority.mjs');
        expect(Object.keys(authority)).toEqual([
            'isIssuedCurrentSmartOrderBrokerContractCapability',
        ]);
        expect(
            authority.isIssuedCurrentSmartOrderBrokerContractCapability(
                Object.freeze({ eligible: true }),
            ),
        ).toBe(false);
        const source = await readFile(
            new URL('./broker-contract-verifier-authority.mjs', import.meta.url),
            'utf8',
        );
        expect(source).not.toMatch(/export\s+function\s+issue/i);
    });
});
