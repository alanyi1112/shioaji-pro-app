import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cancelSmartOrderStrategy,
    copySmartOrderStrategyToDraft,
    createSmartOrderDraft,
    DEFAULT_SMART_ORDER_STRATEGY_KIND,
    drainSmartOrderPreparedIntent,
    fetchSmartOrderKillSwitch,
    fetchSmartOrderRuntimeRiskPolicy,
    fetchSmartOrderReadiness,
    fetchSmartOrderStrategy,
    fetchSmartOrderStrategies,
    pauseSmartOrderStrategy,
    previewSmartOrderCanonicalConfirmation,
    previewSmartOrderProtectedEntryConfirmation,
    prepareSmartOrderProtectionRelinquishment,
    publishSmartOrderRuntimeRiskPolicy,
    mutateSmartOrderKillSwitch,
    requestSmartOrderBrokerCancellation,
    requestSmartOrderBrokerQuantityReduction,
    acceptSmartOrderProtectedEntryConfirmation,
    acceptSmartOrderCanonicalConfirmation,
    commitSmartOrderProtectionRelinquishment,
    fetchSmartOrderManualResolutions,
    applySmartOrderUniqueFinalResolution,
    resumeSmartOrderStrategy,
    type SmartOrderCanonicalDraft,
    SmartOrderLogicalOperationRegistry,
    SmartOrderLocalApiError,
    submitManualStockBrokerWrite,
    updateSmartOrderDraft,
    type SmartOrderProtectedEntryConfirmationRequest,
} from './smart-order-client';

const CSRF_TOKEN = 'c'.repeat(43);
const CSRF_ROUTE = '/__smart-orders/v1/csrf-token';
const CSRF_HEADER = 'X-RealTimeStock-CSRF-Token';

afterEach(() => {
    vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

function csrfResponse(): Response {
    return jsonResponse({
        schemaVersion: 'smart-order-browser-csrf/2026-08-11.1',
        csrfToken: CSRF_TOKEN,
        expiresAtEpochMs: 1_786_382_120_000,
        sessionBound: true,
        singleUse: true,
    });
}

function mutationFetchMock(
    handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
    return vi.fn(async (url: string, init?: RequestInit) => {
        if (url === CSRF_ROUTE) {
            expect(init).toMatchObject({
                method: 'GET',
                credentials: 'same-origin',
                redirect: 'error',
            });
            return csrfResponse();
        }
        expect(url).not.toContain(CSRF_TOKEN);
        expect(init?.headers).toMatchObject({
            'Content-Type': 'application/json',
            [CSRF_HEADER]: CSRF_TOKEN,
        });
        expect(String(init?.body)).not.toContain(CSRF_TOKEN);
        return handler(url, init);
    });
}

function trailingExitDraft(): SmartOrderCanonicalDraft {
    return {
        schemaVersion: 'realtimestock.smart-order-strategy/v1',
        decisionTableVersion: '2026-08-11.2',
        kind: 'trailing_exit',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/trailing-exit/v1',
            positionContractKey: 'TSE:STK:2330' as never,
            monitorContractKey: 'TSE:STK:2330' as never,
            positionEvidenceRevision: 'position-1',
            positionCost: '100',
            activationPrice: '105',
            retracement: { kind: 'pct_bps', pctBps: 500 },
            fixedStopPrice: '95',
            order: {
                contractKey: 'TSE:STK:2330' as never,
                side: 'Sell',
                orderCond: 'Cash',
                orderLot: 'Common',
                baseShares: '1000',
                commonLots: '1',
                contractUnit: '1000',
                priceType: 'LMT',
                limitPrice: '100',
                timeInForce: 'ROD',
                policyRevision: 'order-policy-1',
            },
            validity: {
                startDate: '2026-08-11',
                endDate: '2026-08-11',
                calendarVersion: 'tw-calendar-1',
            },
            activationPolicy: 'require_rearm',
        },
    };
}

function featureGates(value = false) {
    return {
        quick: value,
        good_till: value,
        multi_condition: value,
        parent_child: value,
        stop_take: value,
        trailing_exit: value,
        scheduled_quantity: value,
    };
}

function runtimeRiskPolicyEditor() {
    return {
        schemaVersion:
            'smart-order-runtime-risk-policy-editor/2026-08-14.1' as const,
        buyFeeBps: 15,
        minimumBuyFeeMinorUnits: 2000,
        cashBufferMinorUnits: 10000,
        accountLimits: {
            quantityShares: 50_000,
            notionalMinorUnits: 50_000_000,
            cashMinorUnits: 55_000_000,
            positionShares: 40_000,
            orderCount: 20,
        },
        identityLimits: {
            quantityShares: 100_000,
            notionalMinorUnits: 100_000_000,
            cashMinorUnits: 110_000_000,
            positionShares: 80_000,
            orderCount: 40,
        },
        accountDailyLossLimitMinorUnits: 1_000_000,
        identityDailyLossLimitMinorUnits: 2_000_000,
    };
}

function runtimeRiskPolicyView(state: 'current' | 'reconciliation_required') {
    const editor = runtimeRiskPolicyEditor();
    return {
        schemaVersion:
            'smart-order-runtime-risk-policy-view/2026-08-14.1',
        state,
        revision: 0,
        policyHash: `sha256:${'a'.repeat(64)}`,
        policy: {
            schemaVersion: 'smart-order-runtime-risk-policy/2026-08-14.1',
            revision: 0,
            policyRevision: 'runtime-risk-policy:0',
            executionPolicy: {
                schemaVersion:
                    'smart-order-protected-entry-risk-policy/2026-08-13.1',
                policyRevision: 'runtime-risk-policy:0',
                buyFeeBps: editor.buyFeeBps,
                minimumBuyFeeMinorUnits:
                    editor.minimumBuyFeeMinorUnits,
                cashBufferMinorUnits: editor.cashBufferMinorUnits,
            },
            reservedDimensions: [
                'quantityShares',
                'notionalMinorUnits',
                'cashMinorUnits',
                'positionShares',
                'orderCount',
            ],
            accountLimits: editor.accountLimits,
            identityLimits: editor.identityLimits,
            accountDailyLossLimitMinorUnits:
                editor.accountDailyLossLimitMinorUnits,
            identityDailyLossLimitMinorUnits:
                editor.identityDailyLossLimitMinorUnits,
        },
        exposureHeadsCurrent: state === 'current',
        publishedAtEpochMs: 1_786_380_000_100,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        identityIdentifiersExposed: false,
    };
}

function protectedEntryConfirmationRequest(): SmartOrderProtectedEntryConfirmationRequest {
    return {
        schemaVersion:
            'smart-order-protected-entry-confirmation-request/2026-08-20.1',
        accountBrokerRef: 'broker-A',
        accountIdRef: 'account-A',
        commonLots: 1,
        contractKey: 'TSE:STK:2330',
        entryOrder: {
            priceType: 'LMT',
            limitPrice: '100',
            timeInForce: 'ROD',
        },
        protection: {
            family: 'fixed',
            legs: [
                {
                    comparator: 'lte',
                    distance: { kind: 'pct_bps', pctBps: 300 },
                    execution: {
                        priceType: 'LMT',
                        limitPrice: '95',
                        timeInForce: 'ROD',
                    },
                    legId: 'stop',
                    type: 'stop',
                },
            ],
        },
    };
}

function protectedEntryConfirmationView(
    confirmationId: string,
    state: 'previewed' | 'accepted',
    snapshotHash = `sha256:${'9'.repeat(64)}`,
) {
    return {
        schemaVersion:
            'smart-order-protected-entry-confirmation/2026-08-20.1',
        state,
        snapshotHash,
        confirmationId,
        strategyKind: 'stop_take',
        fixedAccountLabel: '固定股票帳號（Runtime 已驗證）',
        simulation: true,
        contract: {
            contractKey: 'TSE:STK:2330',
            category: '股票',
            contractUnit: 1_000,
            updateDate: '2026-08-20',
            contractRevision: `sha256:${'7'.repeat(64)}`,
            corporateActionRevision: `sha256:${'8'.repeat(64)}`,
        },
        entryOrder: {
            side: 'Buy',
            orderCond: 'Cash',
            orderLot: 'Common',
            baseShares: 1_000,
            commonLots: 1,
            priceType: 'LMT',
            limitPrice: '100',
            timeInForce: 'ROD',
        },
        protection: protectedEntryConfirmationRequest().protection,
        fixedAtrSnapshot: null,
        previewBasis: {
            source: 'entry_limit_estimate',
            priceDecimal: '100',
            formalSource: 'entry_weighted_average_fill',
        },
        riskRevision: 1,
        riskPolicyRevision: 'runtime-risk-policy:1',
        modeGeneration: 'generation-1',
        runtimeRevision: 1,
        accountReconciliationAsOfEpochMs: 1_786_377_600_100,
        validUntilEpochMs: 1_786_377_605_000,
        warnings: [
            'local_runtime_not_broker_cloud',
            'entry_not_sent_until_durable_dispatch_gates',
            'restart_requires_reconciliation_and_user_rearm',
            'broker_write_not_authorized',
        ],
        durablePreparationState: state === 'accepted' ? 'prepared' : 'none',
        brokerWriteAttempted: false,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        entityIdentifiersExposed: false,
    };
}

function canonicalConfirmationView(
    state: 'previewed' | 'accepted',
    snapshotHash = `sha256:${'4'.repeat(64)}`,
) {
    return {
        schemaVersion: 'smart-order-canonical-confirmation/2026-08-20.1',
        state,
        snapshotHash,
        strategyId: 'strategy-existing-position',
        strategyKind: 'stop_take',
        strategyRevision: 1,
        resolvedDefinitionHash: `sha256:${'3'.repeat(64)}`,
        fixedAccountLabel: '固定股票帳號（Runtime 已驗證）',
        contract: {
            contractKey: 'TSE:STK:2330',
            category: '股票',
            contractUnit: 1_000,
            referenceMinorUnits: 10_000,
            limitUpMinorUnits: 11_000,
            limitDownMinorUnits: 9_000,
            updateDate: '2026-08-20',
            contractRevision: `sha256:${'5'.repeat(64)}`,
            corporateActionRevision: `sha256:${'6'.repeat(64)}`,
        },
        position: {
            quantityShares: 1_000,
            availableShares: 1_000,
            averageCostState: 'available',
            basisSource: 'broker_average_cost',
            basisPriceMinorUnits: 10_000,
            asOfEpochMs: 1_786_377_600_100,
        },
        riskRevision: 1,
        modeGeneration: 'generation-1',
        runtimeRevision: 1,
        validUntilEpochMs: 1_786_377_605_000,
        warnings: [
            'local_runtime_not_broker_cloud',
            'restart_requires_reconciliation_and_user_rearm',
            'broker_write_not_authorized',
        ],
        brokerWriteAttempted: false,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        ...(state === 'accepted'
            ? {
                  strategy: {
                      strategyId: 'strategy-existing-position',
                      strategyKind: 'stop_take',
                      state: 'draft',
                      definitionHash: `sha256:${'3'.repeat(64)}`,
                      accountBound: true,
                      createdAtEpochMs: 1_786_377_600_000,
                      updatedAtEpochMs: 1_786_377_600_200,
                      revision: 2,
                  },
              }
            : {}),
    };
}

function killSwitchView(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 'smart-order-kill-switch-arbiter/2026-08-12.1',
        arbiterRevision: 0,
        switches: {
            pause_new_exposure: {
                enabled: false,
                revision: 0,
                updatedAtEpochMs: 0,
                reasonCode: 'initial_disabled',
            },
            pause_automation: {
                enabled: false,
                revision: 0,
                updatedAtEpochMs: 0,
                reasonCode: 'initial_disabled',
            },
            emergency_block_all_writes: {
                enabled: false,
                revision: 0,
                updatedAtEpochMs: 0,
                reasonCode: 'initial_disabled',
            },
        },
        enabled: [],
        denyUnionActive: false,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        identityIdentifiersExposed: false,
        ...overrides,
    };
}

function gateStatus() {
    return {
        present: false,
        state: 'observe_only',
        blocker: 'gate_manifest_missing_or_invalid',
        featureGates: featureGates(),
        authoritativeForDispatch: false,
    };
}

function readinessResponse() {
    return {
        ready: false,
        writeMaster: 'disabled',
        runtime: {
            mode: 'simulation',
            role: 'primary',
            state: 'observe_only',
            repositoryReady: true,
            dispatchAllowedByRepository: false,
        },
        quote: {
            state: 'unverified',
            asOfExchangeTime: null,
            authoritativeForActivation: false,
        },
        lifecycle: {
            schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.4',
            state: 'verified_repository_projection',
            writeMaster: 'disabled',
            reconciliation: 'required_before_any_write_or_drain',
            activeObligationCount: 1,
            blockerCount: 2,
            productionReadonlyBlockerCount: 2,
            gracefulStopBlockerCount: 2,
            uninstallBlockerCount: 2,
            productionReadonlyDrainAllowed: false,
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            drainItems: [
                {
                    kind: 'account_reconciliation',
                    count: 1,
                    disposition: 'complete_current_account_reconciliation',
                },
                {
                    kind: 'strategy',
                    count: 0,
                    disposition: 'pause_or_cancel_strategy',
                },
                {
                    kind: 'activation',
                    count: 0,
                    disposition: 'cancel_strategy_or_complete_activation',
                },
                {
                    kind: 'prepared_intent',
                    count: 0,
                    disposition: 'cancel_proven_unsent_intent_and_release',
                },
                {
                    kind: 'side_effect_intent',
                    count: 0,
                    disposition: 'reconcile_intent_before_stop',
                },
                {
                    kind: 'broker_order',
                    count: 0,
                    disposition: 'cancel_working_order_or_reconcile',
                },
                {
                    kind: 'protection_commitment',
                    count: 0,
                    disposition: 'prove_zero_fill_or_release_pre_dispatch',
                },
                {
                    kind: 'protection_obligation',
                    count: 1,
                    disposition:
                        'prove_zero_fill_confirmed_exit_or_break_glass',
                },
                {
                    kind: 'entry_exposure_reservation',
                    count: 0,
                    disposition: 'release_proven_unsent_or_reconcile',
                },
                {
                    kind: 'exit_claim',
                    count: 0,
                    disposition: 'reconcile_or_release_claim',
                },
                {
                    kind: 'manual_resolution',
                    count: 0,
                    disposition: 'complete_reason_specific_resolution',
                },
                {
                    kind: 'safety_blocker',
                    count: 0,
                    disposition: 'resolve_or_supersede_blocker',
                },
            ],
            drainRecords: [
                {
                    ordinal: 1,
                    kind: 'account_reconciliation',
                    state: 'missing_or_stale',
                    quantityShares: null,
                    quantityState: 'not_applicable',
                    disposition: 'complete_current_account_reconciliation',
                },
                {
                    ordinal: 2,
                    kind: 'protection_obligation',
                    state: 'monitoring',
                    quantityShares: 1000,
                    quantityState: 'conservative_maximum',
                    disposition:
                        'prove_zero_fill_confirmed_exit_or_break_glass',
                },
            ],
            drainRecordsTruncated: false,
            runtimeTrackedUnprotectedRemainder: {
                state: 'unknown',
                shares: null,
                conservativeMaximumShares: 1000,
                currentAccountReconciliationRequired: true,
            },
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            strategyDefinitionsExposed: false,
        },
        gates: {
            automation: gateStatus(),
            manual_user_confirmed: gateStatus(),
            gate_probe: gateStatus(),
        },
        blockers: [
            'current_gate_evidence_revalidation_required',
            'write_master_disabled',
        ],
    };
}

describe('smart-order browser client', () => {
    it('sends stock writes only through the route-bound CSRF gateway without client provenance', async () => {
        const fetchMock = mutationFetchMock(async (url, init) => {
            expect(url).toBe(
                '/__smart-orders/v1/trading-write/STK-MAN-PLACE-TICKET',
            );
            const body = JSON.parse(String(init?.body));
            expect(body.operationId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );
            expect(body).not.toHaveProperty('provenance');
            expect(body.request.payload.stock_order).toMatchObject({
                order_lot: 'IntradayOdd',
                price_type: 'MKT',
                order_type: 'FOK',
                daytrade_short: false,
            });
            return jsonResponse(
                {
                    code: 'broker_write_gate_closed',
                    brokerWriteAttempted: false,
                },
                423,
            );
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            submitManualStockBrokerWrite('STK-MAN-PLACE-TICKET', {
                schemaVersion:
                    'smart-order-manual-broker-write-request/2026-08-14.1',
                operation: 'place',
                brokerPath: '/api/v1/order/place_order',
                payload: {
                    contract: {
                        security_type: 'STK',
                        region: 'TW',
                        exchange: 'TSE',
                        code: '2330',
                        target_code: null,
                    },
                    stock_order: {
                        action: 'Sell',
                        price: 0,
                        quantity: 3,
                        price_type: 'MKT',
                        order_type: 'FOK',
                        order_lot: 'IntradayOdd',
                        daytrade_short: false,
                        account: {
                            broker_id: 'TEST',
                            account_id: 'SIMULATION',
                            account_type: 'S',
                        },
                    },
                },
            }),
        ).rejects.toMatchObject({
            status: 423,
            code: 'broker_write_gate_closed',
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('keeps the new-flow default on trailing exit', () => {
        expect(DEFAULT_SMART_ORDER_STRATEGY_KIND).toBe('trailing_exit');
    });

    it('retains one operation id for the same logical action until a canonical outcome settles it', () => {
        const operations = new SmartOrderLogicalOperationRegistry();
        const first = operations.operationIdFor('create', 'payload-a');
        expect(operations.operationIdFor('create', 'payload-a')).toBe(first);

        const changedPayload = operations.operationIdFor('create', 'payload-b');
        expect(changedPayload).not.toBe(first);

        operations.settle('create');
        expect(operations.operationIdFor('create', 'payload-b')).not.toBe(
            changedPayload,
        );
        expect(() => operations.operationIdFor('', 'payload')).toThrow(
            'logical mutation slot and fingerprint are required',
        );
    });

    it('never abandons an ambiguous or outcome-unknown operation id', () => {
        const operations = new SmartOrderLogicalOperationRegistry();
        const unresolvedCodes = [
            'operation_outcome_unknown',
            'operation_reserved',
            'operation_result_persistence_failed',
        ];
        for (const [index, code] of unresolvedCodes.entries()) {
            const slot = `control-${index}`;
            const fingerprint = `payload-${index}`;
            const operationId = operations.operationIdFor(slot, fingerprint);
            operations.settle(
                slot,
                new SmartOrderLocalApiError(409, code, {
                    operationId,
                    resultHash: `sha256:${String(index).repeat(64)}`,
                }),
            );
            expect(operations.operationIdFor(slot, fingerprint)).toBe(
                operationId,
            );
        }

        const ambiguousId = operations.operationIdFor('copy', 'payload-copy');
        operations.settle(
            'copy',
            new SmartOrderLocalApiError(503, 'mutation_transport_ambiguous', {
                operationId: ambiguousId,
            }),
        );
        expect(operations.operationIdFor('copy', 'payload-copy')).toBe(
            ambiguousId,
        );

        const rejectedId = operations.operationIdFor('save', 'payload-save');
        operations.settle(
            'save',
            new SmartOrderLocalApiError(422, 'strategy_payload_invalid', {
                operationId: rejectedId,
                resultHash: `sha256:${'f'.repeat(64)}`,
            }),
        );
        expect(operations.operationIdFor('save', 'payload-save')).not.toBe(
            rejectedId,
        );
    });

    it('reads only through the same-origin smart-order gateway', async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse({
                strategies: [],
                source: 'runtime_snapshot',
                accountIdentifiersExposed: false,
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchSmartOrderStrategies()).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledWith(
            '/__smart-orders/v1/strategies',
            expect.objectContaining({
                method: 'GET',
                credentials: 'same-origin',
                redirect: 'error',
            }),
        );
    });

    it('reads and publishes only the exact Runtime-owned risk policy contract', async () => {
        const current = runtimeRiskPolicyView('current');
        const readFetch = vi.fn(async () => jsonResponse(current));
        vi.stubGlobal('fetch', readFetch);
        await expect(fetchSmartOrderRuntimeRiskPolicy()).resolves.toMatchObject({
            state: 'current',
            revision: 0,
            exposureHeadsCurrent: true,
            brokerWriteAuthority: false,
            accountIdentifiersExposed: false,
            identityIdentifiersExposed: false,
        });
        expect(readFetch).toHaveBeenCalledWith(
            '/__smart-orders/v1/risk/policy',
            expect.objectContaining({ method: 'GET' }),
        );

        const publication = runtimeRiskPolicyView('reconciliation_required');
        const mutationFetch = mutationFetchMock(async (url, init) => {
            expect(url).toBe('/__smart-orders/v1/risk/policy');
            expect(init?.method).toBe('PUT');
            const body = JSON.parse(String(init?.body)) as Record<
                string,
                unknown
            >;
            expect(body).toMatchObject({
                expectedRevision: null,
                operationId: '123e4567-e89b-42d3-a456-426614174202',
                policy: runtimeRiskPolicyEditor(),
            });
            expect(JSON.stringify(body)).not.toMatch(
                /accountId|accountBroker|identityGroup|brokerWrite/i,
            );
            return jsonResponse({
                result: publication,
                resultHash: `sha256:${'b'.repeat(64)}`,
                brokerWriteAttempted: false,
            });
        });
        vi.stubGlobal('fetch', mutationFetch);
        await expect(
            publishSmartOrderRuntimeRiskPolicy({
                expectedRevision: null,
                operationId: '123e4567-e89b-42d3-a456-426614174202',
                policy: runtimeRiskPolicyEditor(),
            }),
        ).resolves.toMatchObject({
            state: 'reconciliation_required',
            exposureHeadsCurrent: false,
            brokerWriteAuthority: false,
        });
    });

    it('rejects identifier leakage or broker authority in a Runtime risk policy response', async () => {
        for (const override of [
            { accountId: 'must-not-enter-browser' },
            { brokerWriteAuthority: true },
        ]) {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    jsonResponse({
                        ...runtimeRiskPolicyView('current'),
                        ...override,
                    }),
                ),
            );
            await expect(fetchSmartOrderRuntimeRiskPolicy()).rejects.toMatchObject({
                status: 502,
                code: 'invalid_risk_policy_response',
            });
        }
    });

    it('reads and replay-protects the exact Runtime kill-switch arbiter contract', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(killSwitchView())),
        );
        await expect(fetchSmartOrderKillSwitch()).resolves.toMatchObject({
            arbiterRevision: 0,
            enabled: [],
            denyUnionActive: false,
            brokerWriteAuthority: false,
        });

        const operationId = '123e4567-e89b-42d3-a456-426614174207';
        const enabled = killSwitchView({
            arbiterRevision: 1,
            switches: {
                ...killSwitchView().switches,
                pause_new_exposure: {
                    enabled: true,
                    revision: 1,
                    updatedAtEpochMs: 1_786_380_000_200,
                    reasonCode: 'operator_pause',
                },
            },
            enabled: ['pause_new_exposure'],
            denyUnionActive: true,
            changed: true,
            replayed: false,
        });
        const mutationFetch = mutationFetchMock(async (url, init) => {
            expect(url).toBe('/__smart-orders/v1/risk/kill-switch');
            expect(init?.method).toBe('PUT');
            expect(JSON.parse(String(init?.body))).toEqual({
                enabled: true,
                expectedArbiterRevision: 0,
                operationId,
                reasonCode: 'operator_pause',
                switchName: 'pause_new_exposure',
            });
            return jsonResponse({
                result: enabled,
                resultHash: `sha256:${'c'.repeat(64)}`,
                brokerWriteAttempted: false,
            });
        });
        vi.stubGlobal('fetch', mutationFetch);
        await expect(
            mutateSmartOrderKillSwitch({
                enabled: true,
                expectedArbiterRevision: 0,
                operationId,
                reasonCode: 'operator_pause',
                switchName: 'pause_new_exposure',
            }),
        ).resolves.toMatchObject({
            arbiterRevision: 1,
            enabled: ['pause_new_exposure'],
            changed: true,
            brokerWriteAuthority: false,
        });
    });

    it('rejects kill-switch identifier leakage, authority, or inconsistent deny-union state', async () => {
        for (const override of [
            { accountId: 'must-not-enter-browser' },
            { brokerWriteAuthority: true },
            { enabled: ['pause_automation'] },
        ]) {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    jsonResponse(killSwitchView(override)),
                ),
            );
            await expect(fetchSmartOrderKillSwitch()).rejects.toMatchObject({
                status: 502,
                code: 'invalid_kill_switch_response',
            });
        }
    });

    it('accepts only the exact fail-closed readiness projection', async () => {
        const payload = readinessResponse();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(payload)));

        const readiness = await fetchSmartOrderReadiness();
        expect(readiness).toMatchObject({
            ready: false,
            writeMaster: 'disabled',
            runtime: { mode: 'simulation', dispatchAllowedByRepository: false },
            quote: { authoritativeForActivation: false },
            lifecycle: {
                blockerCount: 2,
                drainRecords: [
                    { ordinal: 1, kind: 'account_reconciliation' },
                    {
                        ordinal: 2,
                        kind: 'protection_obligation',
                        quantityShares: 1000,
                        quantityState: 'conservative_maximum',
                    },
                ],
                accountIdentifiersExposed: false,
            },
        });
        expect(readiness.lifecycle.drainItems).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'account_reconciliation',
                    count: 1,
                }),
                expect.objectContaining({
                    kind: 'protection_obligation',
                    count: 1,
                }),
            ]),
        );
        expect(Object.isFrozen(readiness)).toBe(true);
        expect(Object.isFrozen(readiness.gates.automation.featureGates)).toBe(
            true,
        );
    });

    it('accepts the exact unavailable lifecycle projection without inventing readiness', async () => {
        const payload = readinessResponse();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    ...payload,
                    runtime: {
                        ...payload.runtime,
                        role: 'unknown',
                        state: 'unavailable',
                        repositoryReady: false,
                    },
                    lifecycle: {
                        schemaVersion: 'smart-order-lifecycle-audit/unavailable',
                        state: 'unverified',
                        writeMaster: 'disabled',
                        reconciliation: 'required_before_any_write_or_drain',
                        activeObligationCount: null,
                        blockerCount: null,
                        productionReadonlyBlockerCount: null,
                        gracefulStopBlockerCount: null,
                        uninstallBlockerCount: null,
                        productionReadonlyDrainAllowed: false,
                        gracefulStopAllowed: false,
                        uninstallAllowed: false,
                        drainItems: [],
                        drainRecords: [],
                        drainRecordsTruncated: true,
                        runtimeTrackedUnprotectedRemainder: {
                            state: 'unknown',
                            shares: null,
                            conservativeMaximumShares: null,
                            currentAccountReconciliationRequired: true,
                        },
                        accountIdentifiersExposed: false,
                        entityIdentifiersExposed: false,
                        strategyDefinitionsExposed: false,
                    },
                }),
            ),
        );

        await expect(fetchSmartOrderReadiness()).resolves.toMatchObject({
            ready: false,
            writeMaster: 'disabled',
            runtime: { role: 'unknown', repositoryReady: false },
            lifecycle: {
                state: 'unverified',
                blockerCount: null,
                drainRecords: [],
                drainRecordsTruncated: true,
                gracefulStopAllowed: false,
                uninstallAllowed: false,
            },
        });
    });

    it('rejects an unavailable lifecycle projection that carries records or drain authority', async () => {
        const payload = readinessResponse();
        const unavailable = {
            schemaVersion: 'smart-order-lifecycle-audit/unavailable',
            state: 'unverified',
            writeMaster: 'disabled',
            reconciliation: 'required_before_any_write_or_drain',
            activeObligationCount: null,
            blockerCount: null,
            productionReadonlyBlockerCount: null,
            gracefulStopBlockerCount: null,
            uninstallBlockerCount: null,
            productionReadonlyDrainAllowed: false,
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            drainItems: [],
            drainRecords: [],
            drainRecordsTruncated: true,
            runtimeTrackedUnprotectedRemainder: {
                state: 'unknown',
                shares: null,
                conservativeMaximumShares: null,
                currentAccountReconciliationRequired: true,
            },
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
            strategyDefinitionsExposed: false,
        };
        for (const lifecycle of [
            { ...unavailable, gracefulStopAllowed: true },
            {
                ...unavailable,
                drainRecords: [readinessResponse().lifecycle.drainRecords[0]],
            },
            {
                ...unavailable,
                runtimeTrackedUnprotectedRemainder: {
                    ...unavailable.runtimeTrackedUnprotectedRemainder,
                    conservativeMaximumShares: 0,
                },
            },
        ]) {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    jsonResponse({ ...payload, lifecycle }),
                ),
            );
            await expect(fetchSmartOrderReadiness()).rejects.toMatchObject({
                code: 'invalid_readiness_response',
            });
        }
    });

    it('rejects readiness that adds a field, changes the write lock, or changes the gate matrix', async () => {
        const candidates = [
            { ...readinessResponse(), ready: true },
            { ...readinessResponse(), capability: 'must-not-enter-browser' },
            {
                ...readinessResponse(),
                lifecycle: {
                    ...readinessResponse().lifecycle,
                    drainItems: [
                        ...readinessResponse().lifecycle.drainItems,
                        {
                            kind: 'broker_order',
                            count: 1,
                            disposition: 'cancel_working_order_or_reconcile',
                            accountId: 'must-not-enter-browser',
                        },
                    ],
                },
            },
            {
                ...readinessResponse(),
                lifecycle: {
                    ...readinessResponse().lifecycle,
                    drainRecords: [
                        {
                            ...readinessResponse().lifecycle.drainRecords[0],
                            accountId: 'must-not-enter-browser',
                        },
                        readinessResponse().lifecycle.drainRecords[1],
                    ],
                },
            },
            {
                ...readinessResponse(),
                lifecycle: {
                    ...readinessResponse().lifecycle,
                    drainRecords: [
                        readinessResponse().lifecycle.drainRecords[0],
                        {
                            ...readinessResponse().lifecycle.drainRecords[1],
                            disposition: 'reconcile_or_release_claim',
                        },
                    ],
                },
            },
            {
                ...readinessResponse(),
                gates: {
                    ...readinessResponse().gates,
                    automation: {
                        ...gateStatus(),
                        featureGates: {
                            ...featureGates(),
                            unknown_strategy: true,
                        },
                    },
                },
            },
            {
                ...readinessResponse(),
                quote: {
                    state: 'fresh',
                    asOfExchangeTime: null,
                    authoritativeForActivation: false,
                },
            },
            {
                ...readinessResponse(),
                quote: {
                    state: 'stale',
                    asOfExchangeTime: '2026-08-21T09:00:00+08:00',
                    authoritativeForActivation: false,
                },
            },
            {
                ...readinessResponse(),
                quote: {
                    state: 'unverified',
                    asOfExchangeTime: '2026-08-21T01:00:00.000Z',
                    authoritativeForActivation: false,
                },
            },
            {
                ...readinessResponse(),
                quote: {
                    state: 'fresh',
                    asOfExchangeTime: '2026-08-21T01:00:00.000Z',
                    authoritativeForActivation: true,
                },
            },
        ];
        for (const candidate of candidates) {
            vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(candidate)));
            await expect(fetchSmartOrderReadiness()).rejects.toMatchObject({
                status: 502,
                code: 'invalid_readiness_response',
            });
        }
    });

    it('rejects duplicate, unknown-state, and extra-field strategy snapshots', async () => {
        const base = {
            strategyId: 'draft_1',
            strategyKind: 'quick',
            state: 'draft',
            definitionHash: `sha256:${'0'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 1,
            updatedAtEpochMs: 1,
            revision: 0,
        };
        const candidates = [
            [base, { ...base }],
            [{ ...base, strategyId: 'unknown-state', state: 'armed' }],
            [{ ...base, strategyId: 'extra', accountId: 'must-not-leak' }],
        ];
        for (const strategies of candidates) {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    jsonResponse({
                        strategies,
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    }),
                ),
            );
            await expect(fetchSmartOrderStrategies()).rejects.toMatchObject({
                status: 502,
                code: 'invalid_strategy_list_response',
            });
        }
    });

    it('accepts only the redacted exact Runtime activity projection', async () => {
        const component = { state: null, count: 0 };
        const activity = {
            schemaVersion: 'smart-order-active-activity/2026-08-13.3',
            displayState: 'unknown',
            activations: { state: 'dispatching', count: 1 },
            intents: { state: 'unknown', count: 1 },
            brokerOrders: component,
            protectionCommitments: component,
            protectionObligations: component,
            entryExposureReservations: { state: 'unknown', count: 1 },
            exitClaims: component,
            resolutionCases: component,
            safetyBlockers: component,
            formalProtection: {
                schemaVersion:
                    'smart-order-formal-protection-view/2026-08-13.1',
                state: 'formal',
                cumulativeFilledShares: 200,
                asOfEpochMs: 3,
                estimatedBasis: {
                    numeratorMinorUnits: '10000',
                    denominator: '1',
                },
                formalBasis: {
                    numeratorMinorUnits: '10100',
                    denominator: '1',
                },
                legs: [
                    {
                        type: 'stop',
                        comparator: 'lte',
                        triggerState: 'formal',
                        triggerBasis: 'weighted_average_fill',
                        estimatedTriggerPrice: {
                            numeratorMinorUnits: '9700',
                            denominator: '1',
                        },
                        formalTriggerPrice: {
                            numeratorMinorUnits: '9797',
                            denominator: '1',
                        },
                        differsFromEstimate: true,
                    },
                ],
                accountIdentifiersExposed: false,
                entityIdentifiersExposed: false,
            },
            hasRuntimeTrackedUnprotectedRemainder: false,
            runtimeTrackedUnprotectedRemainder: {
                state: 'none',
                lastKnownShares: 0,
                asOfEpochMs: null,
                current: false,
            },
            hasUnknownExitClaim: false,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        };
        const strategy = {
            strategyId: 'active_1',
            strategyKind: 'quick',
            state: 'monitoring',
            definitionHash: `sha256:${'0'.repeat(64)}`,
            accountBound: true,
            createdAtEpochMs: 1,
            updatedAtEpochMs: 2,
            revision: 0,
            activity,
        };
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    strategies: [strategy],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                }),
            ),
        );
        await expect(fetchSmartOrderStrategies()).resolves.toEqual([
            expect.objectContaining({
                strategyId: 'active_1',
                activity: expect.objectContaining({
                    displayState: 'unknown',
                    intents: { state: 'unknown', count: 1 },
                    formalProtection: expect.objectContaining({
                        state: 'formal',
                        cumulativeFilledShares: 200,
                    }),
                }),
            }),
        ]);

        for (const invalidActivity of [
            { ...activity, accountId: 'must-not-leak' },
            { ...activity, accountIdentifiersExposed: true },
            { ...activity, intents: { state: 'unknown', count: -1 } },
            { ...activity, entityIdentifiersExposed: true },
            {
                ...activity,
                runtimeTrackedUnprotectedRemainder: {
                    state: 'last_known',
                    lastKnownShares: 0,
                    asOfEpochMs: 2,
                    current: false,
                },
            },
            {
                ...activity,
                hasRuntimeTrackedUnprotectedRemainder: true,
            },
            {
                ...activity,
                formalProtection: {
                    ...activity.formalProtection,
                    accountId: 'must-not-leak',
                },
            },
            {
                ...activity,
                formalProtection: {
                    ...activity.formalProtection,
                    legs: [
                        {
                            ...activity.formalProtection.legs[0],
                            triggerState: 'pending_saved_high',
                        },
                    ],
                },
            },
        ]) {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    jsonResponse({
                        strategies: [{ ...strategy, activity: invalidActivity }],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    }),
                ),
            );
            await expect(fetchSmartOrderStrategies()).rejects.toMatchObject({
                status: 502,
                code: 'invalid_strategy_list_response',
            });
        }
    });

    it('gets one strategy through an encoded same-origin read route', async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse({
                strategy: {
                    strategyId: 'draft_1',
                    strategyKind: 'quick',
                    state: 'draft',
                    definitionHash: `sha256:${'0'.repeat(64)}`,
                    accountBound: false,
                    createdAtEpochMs: 1,
                    updatedAtEpochMs: 1,
                    revision: 0,
                    definition: {
                        kind: 'quick',
                        workspaceContractKey: 'TSE:STK:2330',
                    },
                },
                source: 'runtime_snapshot',
                accountIdentifiersExposed: false,
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchSmartOrderStrategy('draft_1')).resolves.toMatchObject({
            strategyId: 'draft_1',
            strategyKind: 'quick',
            state: 'draft',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            '/__smart-orders/v1/strategies/draft_1',
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('creates a draft with a UUID operation id and no broker provenance', async () => {
        const fetchMock = mutationFetchMock(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            expect(body).toMatchObject({
                strategyKind: 'trailing_exit',
                workspaceContractKey: 'TSE:STK:2330',
            });
            expect(body.operationId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );
            expect(body).not.toHaveProperty('provenance');
            return jsonResponse({
                result: {
                    strategyId: 'draft-1',
                    strategyKind: 'trailing_exit',
                    state: 'draft',
                    definitionHash: `sha256:${'a'.repeat(64)}`,
                    accountBound: false,
                    createdAtEpochMs: 1,
                    updatedAtEpochMs: 1,
                    revision: 0,
                },
                resultHash: `sha256:${'b'.repeat(64)}`,
                brokerWriteAttempted: false,
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            createSmartOrderDraft({
                strategyKind: 'trailing_exit',
                workspaceContractKey: 'TSE:STK:2330',
            }),
        ).resolves.toMatchObject({ strategyId: 'draft-1', state: 'draft' });
        expect(fetchMock).toHaveBeenCalledWith(
            '/__smart-orders/v1/strategies',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json',
                    [CSRF_HEADER]: CSRF_TOKEN,
                }),
            }),
        );
    });

    it('rejects a cross-market workspace contract before any browser request', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            createSmartOrderDraft({
                strategyKind: 'quick',
                workspaceContractKey: 'NASDAQ:STK:AAPL',
            }),
        ).rejects.toMatchObject({
            status: 422,
            code: 'workspace_contract_invalid',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a mutation result that claims a broker write or adds an envelope field', async () => {
        for (const envelopePatch of [
            { brokerWriteAttempted: true },
            { capability: 'must-not-enter-browser' },
        ]) {
            vi.stubGlobal(
                'fetch',
                mutationFetchMock(async () =>
                    jsonResponse({
                        result: {
                            strategyId: 'draft-invalid-envelope',
                            strategyKind: 'quick',
                            state: 'draft',
                            definitionHash: `sha256:${'a'.repeat(64)}`,
                            accountBound: false,
                            createdAtEpochMs: 1,
                            updatedAtEpochMs: 1,
                            revision: 0,
                        },
                        resultHash: `sha256:${'b'.repeat(64)}`,
                        brokerWriteAttempted: false,
                        ...envelopePatch,
                    }),
                ),
            );
            await expect(
                createSmartOrderDraft({ strategyKind: 'quick' }),
            ).rejects.toMatchObject({
                status: 502,
                code: 'invalid_draft_create_result',
            });
        }
    });

    it('reuses the exact operation id and body when a mutation transport result is ambiguous', async () => {
        const mutationBodies: string[] = [];
        let mutationAttempt = 0;
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            if (url === CSRF_ROUTE) return csrfResponse();
            mutationBodies.push(String(init?.body));
            mutationAttempt += 1;
            if (mutationAttempt === 1) {
                throw new TypeError('simulated connection reset after request write');
            }
            return jsonResponse({
                result: {
                    strategyId: 'draft-replayed-1',
                    strategyKind: 'trailing_exit',
                    state: 'draft',
                    definitionHash: `sha256:${'a'.repeat(64)}`,
                    accountBound: false,
                    createdAtEpochMs: 1,
                    updatedAtEpochMs: 1,
                    revision: 0,
                },
                resultHash: `sha256:${'b'.repeat(64)}`,
                brokerWriteAttempted: false,
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            createSmartOrderDraft({ strategyKind: 'trailing_exit' }),
        ).resolves.toMatchObject({ strategyId: 'draft-replayed-1' });
        expect(mutationBodies).toHaveLength(2);
        expect(mutationBodies[1]).toBe(mutationBodies[0]);
        const operationIds = mutationBodies.map(
            (body) => (JSON.parse(body) as { operationId: string }).operationId,
        );
        expect(operationIds[1]).toBe(operationIds[0]);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('lets the caller retain a validated operation id across an explicit retry', async () => {
        const operationId = '123e4567-e89b-42d3-a456-426614174000';
        const bodies: Record<string, unknown>[] = [];
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async (_url, init) => {
                bodies.push(
                    JSON.parse(String(init?.body)) as Record<string, unknown>,
                );
                return jsonResponse({
                    result: {
                        strategyId: 'draft-explicit-operation',
                        strategyKind: 'quick',
                        state: 'draft',
                        definitionHash: `sha256:${'a'.repeat(64)}`,
                        accountBound: false,
                        createdAtEpochMs: 1,
                        updatedAtEpochMs: 1,
                        revision: 0,
                    },
                    resultHash: `sha256:${'b'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }),
        );

        await createSmartOrderDraft({ strategyKind: 'quick', operationId });
        expect(bodies).toEqual([
            expect.objectContaining({ operationId, strategyKind: 'quick' }),
        ]);
        await expect(
            createSmartOrderDraft({
                strategyKind: 'quick',
                operationId: 'not-a-uuid',
            }),
        ).rejects.toMatchObject({
            status: 422,
            code: 'operation_id_invalid',
        });
    });

    it('keeps an explicit logical action id across repeated ambiguous calls', async () => {
        const operationId = '123e4567-e89b-42d3-a456-426614174001';
        const mutationBodies: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                if (url === CSRF_ROUTE) return csrfResponse();
                mutationBodies.push(String(init?.body));
                throw new TypeError('simulated ambiguous transport');
            }),
        );

        for (let attempt = 0; attempt < 2; attempt += 1) {
            await expect(
                createSmartOrderDraft({
                    strategyKind: 'quick',
                    operationId,
                }),
            ).rejects.toMatchObject({
                code: 'mutation_transport_ambiguous',
                operationId,
                resultHash: undefined,
            });
        }
        expect(mutationBodies).toHaveLength(4);
        expect(new Set(mutationBodies).size).toBe(1);
        expect(
            (JSON.parse(mutationBodies[0] ?? '{}') as { operationId: string })
                .operationId,
        ).toBe(operationId);
    });

    it('preserves fail-closed error codes from the local gateway', async () => {
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async () =>
                jsonResponse({ code: 'mutation_service_not_wired' }, 503),
            ),
        );
        await expect(
            createSmartOrderDraft({ strategyKind: 'quick' }),
        ).rejects.toEqual(
            expect.objectContaining<Partial<SmartOrderLocalApiError>>({
                name: 'SmartOrderLocalApiError',
                status: 503,
                code: 'mutation_service_not_wired',
            }),
        );
    });

    it('fails closed before a mutation when the Vite CSRF response is not the exact short-lived contract', async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse({
                schemaVersion: 'smart-order-browser-csrf/2026-08-11.1',
                csrfToken: CSRF_TOKEN,
                expiresAtEpochMs: 1_786_382_120_000,
                sessionBound: true,
                singleUse: true,
                capability: 'must-never-be-accepted',
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            createSmartOrderDraft({ strategyKind: 'quick' }),
        ).rejects.toEqual(
            expect.objectContaining<Partial<SmartOrderLocalApiError>>({
                status: 502,
                code: 'invalid_csrf_response',
            }),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            CSRF_ROUTE,
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('updates a draft only with the versioned discriminated canonical definition and optimistic revision', async () => {
        const draft = trailingExitDraft();
        const fetchMock = mutationFetchMock(async (url, init) => {
            expect(url).toBe('/__smart-orders/v1/strategies/draft-1');
            expect(init?.method).toBe('PUT');
            const body = JSON.parse(String(init?.body)) as Record<
                string,
                unknown
            >;
            expect(Object.keys(body).sort()).toEqual([
                'draft',
                'expectedRevision',
                'operationId',
            ]);
            expect(body.expectedRevision).toBe(3);
            expect(body.draft).toEqual(draft);
            expect(body).not.toHaveProperty('provenance');
            return jsonResponse({
                result: {
                    strategyId: 'draft-1',
                    strategyKind: 'trailing_exit',
                    state: 'draft',
                    definitionHash: `sha256:${'a'.repeat(64)}`,
                    accountBound: false,
                    createdAtEpochMs: 1,
                    updatedAtEpochMs: 2,
                    revision: 4,
                    definition: draft,
                },
                resultHash: `sha256:${'b'.repeat(64)}`,
                brokerWriteAttempted: false,
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            updateSmartOrderDraft({
                strategyId: 'draft-1',
                expectedRevision: 3,
                draft,
            }),
        ).resolves.toMatchObject({
            strategyId: 'draft-1',
            strategyKind: 'trailing_exit',
            state: 'draft',
            revision: 4,
        });
    });

    it('copies through an optimistic-revision route and preserves the strategy kind', async () => {
        const fetchMock = mutationFetchMock(async (url, init) => {
            expect(url).toBe('/__smart-orders/v1/strategies/source-1/copy');
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            expect(body.expectedRevision).toBe(7);
            expect(body.operationId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );
            expect(body).not.toHaveProperty('provenance');
            return jsonResponse({
                result: {
                    strategyId: 'draft-copy-1',
                    strategyKind: 'trailing_exit',
                    state: 'draft',
                    definitionHash: `sha256:${'c'.repeat(64)}`,
                    accountBound: false,
                    createdAtEpochMs: 2,
                    updatedAtEpochMs: 2,
                    revision: 0,
                },
                resultHash: `sha256:${'d'.repeat(64)}`,
                brokerWriteAttempted: false,
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            copySmartOrderStrategyToDraft({
                strategyId: 'source-1',
                expectedRevision: 7,
                expectedStrategyKind: 'trailing_exit',
            }),
        ).resolves.toMatchObject({
            strategyId: 'draft-copy-1',
            strategyKind: 'trailing_exit',
            state: 'draft',
        });
    });

    it('rejects a copy response that silently changes the original type', async () => {
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async () =>
                jsonResponse({
                    result: {
                        strategyId: 'bad-copy',
                        strategyKind: 'quick',
                        state: 'draft',
                        definitionHash: `sha256:${'e'.repeat(64)}`,
                        accountBound: false,
                        createdAtEpochMs: 3,
                        updatedAtEpochMs: 3,
                        revision: 0,
                    },
                    resultHash: `sha256:${'f'.repeat(64)}`,
                    brokerWriteAttempted: false,
                }),
            ),
        );

        await expect(
            copySmartOrderStrategyToDraft({
                strategyId: 'source-1',
                expectedRevision: 7,
                expectedStrategyKind: 'trailing_exit',
            }),
        ).rejects.toEqual(
            expect.objectContaining<Partial<SmartOrderLocalApiError>>({
                code: 'invalid_copy_result',
            }),
        );
    });

    it('keeps pause and cancel as separate revision-bound strategy operations', async () => {
        const calls: string[] = [];
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async (url, init) => {
                calls.push(url);
                const body = JSON.parse(String(init?.body)) as Record<
                    string,
                    unknown
                >;
                expect(body.expectedRevision).toBe(3);
                expect(body.operationId).toMatch(
                    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
                );
                expect(body).not.toHaveProperty('provenance');
                return jsonResponse({
                    result: {
                        strategyId: 'strategy-1',
                        strategyKind: 'quick',
                        state: url.endsWith('/pause') ? 'paused' : 'cancel_pending',
                        definitionHash: `sha256:${'1'.repeat(64)}`,
                        accountBound: true,
                        createdAtEpochMs: 1,
                        updatedAtEpochMs: 2,
                        revision: 4,
                    },
                    resultHash: `sha256:${'2'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }),
        );

        await pauseSmartOrderStrategy({
            strategyId: 'strategy-1',
            expectedRevision: 3,
        });
        await cancelSmartOrderStrategy({
            strategyId: 'strategy-1',
            expectedRevision: 3,
        });
        expect(calls).toEqual([
            '/__smart-orders/v1/strategies/strategy-1/pause',
            '/__smart-orders/v1/strategies/strategy-1/cancel',
        ]);
    });

    it('sends explicit resume acknowledgement and keeps broker cancel/update as separate zero-authority operations', async () => {
        const bodies: Record<string, unknown>[] = [];
        const calls: string[] = [];
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async (url, init) => {
                calls.push(url);
                bodies.push(
                    JSON.parse(String(init?.body)) as Record<string, unknown>,
                );
                if (url.endsWith('/resume')) {
                    return jsonResponse({
                        result: {
                            strategyId: 'strategy-control',
                            strategyKind: 'quick',
                            state: 'monitoring',
                            definitionHash: `sha256:${'1'.repeat(64)}`,
                            accountBound: true,
                            createdAtEpochMs: 1,
                            updatedAtEpochMs: 2,
                            revision: 2,
                        },
                        resultHash: `sha256:${'2'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (url.endsWith('/update-broker-order')) {
                    return jsonResponse({
                        result: {
                            brokerAuthorityGranted: false,
                            brokerWriteAttempted: false,
                            dispatchAllowed: false,
                            quantityShares: 500,
                            replayed: false,
                            strategyId: 'strategy-control',
                            strategyRevision: 1,
                            targetState: 'submitted',
                            updateIntentState: 'prepared',
                            userConfirmationConsumed: true,
                        },
                        resultHash: `sha256:${'4'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                return jsonResponse({
                    result: {
                        brokerAuthorityGranted: false,
                        brokerWriteAttempted: false,
                        cancelIntentState: 'prepared',
                        dispatchAllowed: false,
                        replayed: false,
                        strategyId: 'strategy-control',
                        strategyRevision: 1,
                        targetState: 'submitted',
                        userConfirmationConsumed: true,
                    },
                    resultHash: `sha256:${'3'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }),
        );

        await expect(
            resumeSmartOrderStrategy({
                strategyId: 'strategy-control',
                expectedRevision: 1,
            }),
        ).resolves.toMatchObject({ state: 'monitoring', revision: 2 });
        await expect(
            requestSmartOrderBrokerCancellation({
                strategyId: 'strategy-control',
                expectedRevision: 1,
            }),
        ).resolves.toEqual({
            brokerAuthorityGranted: false,
            brokerWriteAttempted: false,
            cancelIntentState: 'prepared',
            dispatchAllowed: false,
            replayed: false,
            strategyId: 'strategy-control',
            strategyRevision: 1,
            targetState: 'submitted',
            userConfirmationConsumed: true,
        });
        await expect(
            requestSmartOrderBrokerQuantityReduction({
                strategyId: 'strategy-control',
                expectedRevision: 1,
                quantityShares: 500,
            }),
        ).resolves.toEqual({
            brokerAuthorityGranted: false,
            brokerWriteAttempted: false,
            dispatchAllowed: false,
            quantityShares: 500,
            replayed: false,
            strategyId: 'strategy-control',
            strategyRevision: 1,
            targetState: 'submitted',
            updateIntentState: 'prepared',
            userConfirmationConsumed: true,
        });
        expect(calls).toEqual([
            '/__smart-orders/v1/strategies/strategy-control/resume',
            '/__smart-orders/v1/strategies/strategy-control/cancel-broker-order',
            '/__smart-orders/v1/strategies/strategy-control/update-broker-order',
        ]);
        expect(bodies[0]).toMatchObject({
            activationPolicyAcknowledged: true,
            expectedRevision: 1,
        });
        expect(bodies[1]).toMatchObject({
            expectedRevision: 1,
            userConfirmationAcknowledged: true,
        });
        expect(bodies[2]).toMatchObject({
            expectedRevision: 1,
            quantityShares: 500,
            userConfirmationAcknowledged: true,
        });
    });

    it('keeps prepared drain and the two protection relinquishment confirmations as separate typed operations', async () => {
        const calls: string[] = [];
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async (url) => {
                calls.push(url);
                if (url.endsWith('/drain-prepared')) {
                    return jsonResponse({
                        result: {
                            schemaVersion:
                                'smart-order-prepared-intent-drain-result/2026-08-13.1',
                            strategyId: 'strategy-drain',
                            strategyState: 'cancelled',
                            strategyRevision: 2,
                            preparedIntentState: 'cancelled_proven_unsent',
                            activationState: 'cancelled',
                            reservationReleased: true,
                            protectionReleased: true,
                            exitClaimReleased: false,
                            rearmSuperseded: false,
                            userAuthorityConsumed: true,
                            brokerWriteAttempted: false,
                            brokerAuthorityGranted: false,
                            replayed: false,
                        },
                        resultHash: `sha256:${'1'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (url.endsWith('/relinquish-protection-prepare')) {
                    return jsonResponse({
                        result: {
                            schemaVersion:
                                'smart-order-protection-relinquishment-challenge/2026-08-13.1',
                            challengeId:
                                '123e4567-e89b-42d3-a456-426614174101',
                            challengeEvidenceHash: `sha256:${'2'.repeat(64)}`,
                            strategyId: 'strategy-drain',
                            strategyRevision: 2,
                            handoffSnapshotHash: `sha256:${'3'.repeat(64)}`,
                            unmonitoredAuditHash: `sha256:${'4'.repeat(64)}`,
                            obligationCount: 1,
                            commitmentCount: 0,
                            reservationCount: 0,
                            exitClaimCount: 1,
                            sideEffectIntentCount: 1,
                            brokerOrderCount: 1,
                            relinquished: false,
                            brokerWriteAttempted: false,
                            brokerOutcomeInferred: false,
                            replayed: false,
                        },
                        resultHash: `sha256:${'5'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                return jsonResponse({
                    result: {
                        schemaVersion:
                            'smart-order-protection-relinquishment-result/2026-08-13.1',
                        strategyId: 'strategy-drain',
                        strategyState: 'manual_intervention',
                        strategyRevision: 2,
                        handoffSnapshotHash: `sha256:${'3'.repeat(64)}`,
                        unmonitoredAuditHash: `sha256:${'4'.repeat(64)}`,
                        obligationCount: 1,
                        commitmentCount: 0,
                        reservationCount: 0,
                        exitClaimCount: 1,
                        sideEffectIntentCount: 1,
                        brokerOrderCount: 1,
                        safetyBlockerCount: 1,
                        authorizationConsumed: true,
                        relinquished: true,
                        unmonitored: true,
                        brokerOutcomeInferred: false,
                        originalIntentRedispatchAllowed: false,
                        brokerWriteAttempted: false,
                        replayed: false,
                    },
                    resultHash: `sha256:${'6'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }),
        );
        await expect(
            drainSmartOrderPreparedIntent({
                strategyId: 'strategy-drain',
                expectedRevision: 1,
            }),
        ).resolves.toMatchObject({
            strategyState: 'cancelled',
            brokerWriteAttempted: false,
        });
        const challenge =
            await prepareSmartOrderProtectionRelinquishment({
                strategyId: 'strategy-drain',
                expectedRevision: 2,
                operationId: '123e4567-e89b-42d3-a456-426614174101',
            });
        await expect(
            commitSmartOrderProtectionRelinquishment({
                strategyId: 'strategy-drain',
                expectedRevision: 2,
                challengeId: challenge.challengeId,
                operationId: '123e4567-e89b-42d3-a456-426614174102',
            }),
        ).resolves.toMatchObject({
            safetyBlockerCount: 1,
            relinquished: true,
            unmonitored: true,
            originalIntentRedispatchAllowed: false,
            brokerWriteAttempted: false,
        });
        expect(calls).toEqual([
            '/__smart-orders/v1/strategies/strategy-drain/drain-prepared',
            '/__smart-orders/v1/strategies/strategy-drain/relinquish-protection-prepare',
            '/__smart-orders/v1/strategies/strategy-drain/relinquish-protection-commit',
        ]);
    });

    it('exactly parses the redacted reason-specific manual resolution projection', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                expect(url).toBe(
                    '/__smart-orders/v1/strategies/strategy-manual/resolutions',
                );
                return jsonResponse({
                    schemaVersion:
                        'smart-order-manual-resolution-list/2026-08-20.1',
                    policySchemaVersion:
                        'smart-order-manual-resolution/2026-08-11.6',
                    strategyId: 'strategy-manual',
                    strategyRevision: 4,
                    strategyState: 'manual_intervention',
                    cases: [
                        {
                            resolutionKey: `sha256:${'1'.repeat(64)}`,
                            reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                            caseRevision: 2,
                            state: 'open',
                            requiredEvidence: [
                                'broker_full_orders_trades_deals',
                                'broker_position_and_working_set',
                                'canonical_broker_correlation',
                            ],
                            allowedOperations: [
                                'apply_unique_final_evidence',
                                'break_glass_relinquish',
                                'remain_open',
                            ],
                            executableOperations: [
                                'apply_unique_final_evidence',
                                'remain_open',
                            ],
                            uniqueFinalReady: true,
                            uniqueFinalEvidenceHash: `sha256:${'2'.repeat(64)}`,
                            breakGlassAllowed: true,
                            oldIntentDisposition: 'never_resend',
                            updatedAtEpochMs: 1_786_377_600_100,
                            accountIdentifiersExposed: false,
                            entityIdentifiersExposed: false,
                            brokerWriteAuthority: false,
                        },
                    ],
                    genericResumeAllowed: false,
                    brokerWriteAuthority: false,
                });
            }),
        );
        await expect(
            fetchSmartOrderManualResolutions('strategy-manual'),
        ).resolves.toMatchObject({
            strategyState: 'manual_intervention',
            genericResumeAllowed: false,
            brokerWriteAuthority: false,
            cases: [
                {
                    reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                    uniqueFinalReady: true,
                    oldIntentDisposition: 'never_resend',
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                    brokerWriteAuthority: false,
                },
            ],
        });
    });

    it('uses a replay-protected explicit acknowledgement to apply unique final evidence without broker authority', async () => {
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async (url, init) => {
                calls.push({
                    url,
                    body: JSON.parse(String(init?.body)) as Record<
                        string,
                        unknown
                    >,
                });
                return jsonResponse({
                    result: {
                        schemaVersion:
                            'smart-order-manual-resolution-result/2026-08-20.1',
                        strategyId: 'strategy-manual',
                        strategyState: 'paused',
                        strategyRevision: 5,
                        resolutionState: 'resolved',
                        resolutionRevision: 3,
                        uniqueFinalEvidenceHash: `sha256:${'3'.repeat(64)}`,
                        originalIntentState: 'terminal',
                        originalIntentRedispatchAllowed: false,
                        safetyBlockerCount: 1,
                        rearmSupersededCount: 1,
                        brokerWriteAttempted: false,
                        brokerAuthorityGranted: false,
                    },
                    resultHash: `sha256:${'4'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }),
        );
        await expect(
            applySmartOrderUniqueFinalResolution({
                strategyId: 'strategy-manual',
                expectedRevision: 4,
                resolutionKey: `sha256:${'1'.repeat(64)}`,
                operationId: '123e4567-e89b-42d3-a456-426614174401',
            }),
        ).resolves.toMatchObject({
            strategyState: 'paused',
            originalIntentRedispatchAllowed: false,
            brokerWriteAttempted: false,
            brokerAuthorityGranted: false,
        });
        expect(calls).toEqual([
            {
                url: '/__smart-orders/v1/strategies/strategy-manual/resolve-final',
                body: {
                    expectedRevision: 4,
                    operationId:
                        '123e4567-e89b-42d3-a456-426614174401',
                    resolutionKey: `sha256:${'1'.repeat(64)}`,
                    userAcknowledgedFinalEvidence: true,
                },
            },
        ]);
    });

    it('returns the exact latest canonical snapshot with a stale control rejection', async () => {
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async () =>
                jsonResponse(
                    {
                        code: 'stale_revision',
                        resultHash: `sha256:${'3'.repeat(64)}`,
                        brokerWriteAttempted: false,
                        latestSnapshot: {
                            strategyId: 'strategy-stale',
                            strategyKind: 'quick',
                            state: 'paused',
                            definitionHash: `sha256:${'4'.repeat(64)}`,
                            accountBound: true,
                            createdAtEpochMs: 1,
                            updatedAtEpochMs: 3,
                            revision: 5,
                        },
                    },
                    409,
                ),
            ),
        );

        await expect(
            pauseSmartOrderStrategy({
                strategyId: 'strategy-stale',
                expectedRevision: 3,
            }),
        ).rejects.toEqual(
            expect.objectContaining<Partial<SmartOrderLocalApiError>>({
                code: 'stale_revision',
                latestStrategySnapshot: expect.objectContaining({
                    strategyId: 'strategy-stale',
                    state: 'paused',
                    revision: 5,
                }),
            }),
        );
    });

    it('previews and accepts an existing-position canonical confirmation through the authenticated Runtime routes', async () => {
        const confirmationId = '123e4567-e89b-42d3-a456-426614174491';
        const acceptOperationId = '123e4567-e89b-42d3-a456-426614174492';
        const snapshotHash = `sha256:${'4'.repeat(64)}`;
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async (url, init) => {
                const body = JSON.parse(String(init?.body)) as Record<
                    string,
                    unknown
                >;
                calls.push({ url, body });
                return jsonResponse({
                    result: canonicalConfirmationView(
                        url.endsWith('confirmation-accept')
                            ? 'accepted'
                            : 'previewed',
                        snapshotHash,
                    ),
                    resultHash: `sha256:${'7'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }),
        );

        await expect(
            previewSmartOrderCanonicalConfirmation({
                strategyId: 'strategy-existing-position',
                expectedRevision: 1,
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: { source: 'broker_average_cost' },
                operationId: confirmationId,
            }),
        ).resolves.toMatchObject({
            state: 'previewed',
            position: {
                averageCostState: 'available',
                basisSource: 'broker_average_cost',
                basisPriceMinorUnits: 10_000,
            },
            brokerWriteAttempted: false,
            brokerWriteAuthority: false,
        });
        await expect(
            acceptSmartOrderCanonicalConfirmation({
                strategyId: 'strategy-existing-position',
                expectedRevision: 1,
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: { source: 'broker_average_cost' },
                confirmationId,
                snapshotHash,
                userAcknowledged: true,
                operationId: acceptOperationId,
            }),
        ).resolves.toMatchObject({
            state: 'accepted',
            strategy: {
                accountBound: true,
                revision: 2,
                state: 'draft',
            },
            brokerWriteAttempted: false,
            brokerWriteAuthority: false,
        });
        expect(calls).toEqual([
            {
                url: '/__smart-orders/v1/strategies/strategy-existing-position/confirmation-preview',
                body: {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: { source: 'broker_average_cost' },
                    confirmationId,
                    expectedRevision: 1,
                    operationId: confirmationId,
                },
            },
            {
                url: '/__smart-orders/v1/strategies/strategy-existing-position/confirmation-accept',
                body: {
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    basisSelection: { source: 'broker_average_cost' },
                    confirmationId,
                    expectedRevision: 1,
                    operationId: acceptOperationId,
                    snapshotHash,
                    userAcknowledged: true,
                },
            },
        ]);
    });

    it('parses a parent-child confirmation with distinct parent and child contracts', async () => {
        const confirmationId = '123e4567-e89b-42d3-a456-426614174493';
        const parent = canonicalConfirmationView('previewed');
        const view = {
            ...parent,
            strategyId: 'strategy-parent-child',
            strategyKind: 'parent_child',
            position: {
                quantityShares: 700,
                availableShares: 500,
                asOfEpochMs: 1_786_377_600_100,
            },
            childContract: {
                ...parent.contract,
                contractKey: 'TSE:STK:2303',
                contractUnit: 500,
                contractRevision: `sha256:${'8'.repeat(64)}`,
                corporateActionRevision: `sha256:${'9'.repeat(64)}`,
            },
            warnings: [
                'parent_and_child_contracts_are_distinct',
                'child_requires_parent_broker_confirmed_full_fill',
                'child_is_same_trade_date_only',
                'broker_write_not_authorized',
            ],
        };
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(() =>
                jsonResponse({
                    result: view,
                    resultHash: `sha256:${'7'.repeat(64)}`,
                    brokerWriteAttempted: false,
                }),
            ),
        );
        await expect(
            previewSmartOrderCanonicalConfirmation({
                strategyId: 'strategy-parent-child',
                expectedRevision: 1,
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: null,
                operationId: confirmationId,
            }),
        ).resolves.toMatchObject({
            strategyKind: 'parent_child',
            contract: { contractKey: 'TSE:STK:2330', contractUnit: 1_000 },
            childContract: {
                contractKey: 'TSE:STK:2303',
                contractUnit: 500,
            },
            position: { quantityShares: 700, availableShares: 500 },
            brokerWriteAttempted: false,
            brokerWriteAuthority: false,
        });

        vi.stubGlobal(
            'fetch',
            mutationFetchMock(() =>
                jsonResponse({
                    result: { ...view, childContract: undefined },
                    resultHash: `sha256:${'7'.repeat(64)}`,
                    brokerWriteAttempted: false,
                }),
            ),
        );
        await expect(
            previewSmartOrderCanonicalConfirmation({
                strategyId: 'strategy-parent-child',
                expectedRevision: 1,
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                basisSelection: null,
                operationId: '123e4567-e89b-42d3-a456-426614174494',
            }),
        ).rejects.toMatchObject({
            code: 'invalid_canonical_confirmation_response',
        });
    });

    it('previews and accepts a protected entry only through the replay-protected Runtime routes', async () => {
        const request = protectedEntryConfirmationRequest();
        const confirmationId = '123e4567-e89b-42d3-a456-426614174501';
        const acceptOperationId = '123e4567-e89b-42d3-a456-426614174502';
        const snapshotHash = `sha256:${'9'.repeat(64)}`;
        const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async (url, init) => {
                const body = JSON.parse(String(init?.body)) as Record<
                    string,
                    unknown
                >;
                calls.push({ url, body });
                if (url.endsWith('confirmation-preview')) {
                    return jsonResponse({
                        result: protectedEntryConfirmationView(
                            confirmationId,
                            'previewed',
                            snapshotHash,
                        ),
                        resultHash: `sha256:${'5'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                return jsonResponse({
                    result: protectedEntryConfirmationView(
                        confirmationId,
                        'accepted',
                        snapshotHash,
                    ),
                    resultHash: `sha256:${'6'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }),
        );

        await expect(
            previewSmartOrderProtectedEntryConfirmation({
                confirmationRequest: request,
                operationId: confirmationId,
            }),
        ).resolves.toMatchObject({
            state: 'previewed',
            durablePreparationState: 'none',
            brokerWriteAttempted: false,
            brokerWriteAuthority: false,
        });
        await expect(
            acceptSmartOrderProtectedEntryConfirmation({
                confirmationRequest: request,
                confirmationId,
                snapshotHash,
                userAcknowledged: true,
                operationId: acceptOperationId,
            }),
        ).resolves.toMatchObject({
            state: 'accepted',
            durablePreparationState: 'prepared',
            brokerWriteAttempted: false,
            brokerWriteAuthority: false,
        });
        expect(calls).toEqual([
            {
                url: '/__smart-orders/v1/protected-entry/confirmation-preview',
                body: {
                    confirmationId,
                    confirmationRequest: request,
                    operationId: confirmationId,
                },
            },
            {
                url: '/__smart-orders/v1/protected-entry/confirmation-accept',
                body: {
                    confirmationId,
                    confirmationRequest: request,
                    operationId: acceptOperationId,
                    snapshotHash,
                    userAcknowledged: true,
                },
            },
        ]);
    });

    it('rejects a protected-entry response that exposes authority or identifiers', async () => {
        const confirmationId = '123e4567-e89b-42d3-a456-426614174503';
        vi.stubGlobal(
            'fetch',
            mutationFetchMock(async () =>
                jsonResponse({
                    result: {
                        ...protectedEntryConfirmationView(
                            confirmationId,
                            'previewed',
                        ),
                        brokerWriteAuthority: true,
                    },
                    resultHash: `sha256:${'5'.repeat(64)}`,
                    brokerWriteAttempted: false,
                }),
            ),
        );
        await expect(
            previewSmartOrderProtectedEntryConfirmation({
                confirmationRequest: protectedEntryConfirmationRequest(),
                operationId: confirmationId,
            }),
        ).rejects.toMatchObject({
            code: 'invalid_protected_entry_confirmation_response',
        });
    });
});
