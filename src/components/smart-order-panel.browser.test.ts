import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../lib/types/contract';
import type { Account } from '../lib/types/portfolio';
import { SmartOrderPanel } from './smart-order-panel';
import { SmartOrderRiskPolicyEditor } from './smart-order-risk-policy-editor';

const accountMocks = vi.hoisted(() => ({
    selectedStock: {
        account_type: 'S',
        broker_id: 'broker-A',
        account_id: 'account-A',
        person_id: 'MASKED',
        username: 'MASKED',
        signed: true,
    } as Account | null,
}));

vi.mock('../lib/account-store', () => ({
    useAccounts: () => ({
        accounts: accountMocks.selectedStock
            ? [accountMocks.selectedStock]
            : [],
        selectedStock: accountMocks.selectedStock,
        selectedFutures: null,
        loaded: true,
    }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const FEATURE_GATES = Object.freeze({
    quick: false,
    good_till: false,
    multi_condition: false,
    parent_child: false,
    stop_take: false,
    trailing_exit: false,
    scheduled_quantity: false,
});

function readinessResponse(
    featureGates: Readonly<Record<string, boolean>> = FEATURE_GATES,
    automationState: 'eligible' | 'observe_only' = 'observe_only',
    options: Readonly<{
        runtimeState?: string;
        quoteState?: 'fresh' | 'stale' | 'unverified';
        quoteAsOf?: string | null;
        blockers?: readonly string[];
    }> = {},
) {
    const gateStatus = {
        present: automationState === 'eligible',
        state: automationState,
        blocker:
            automationState === 'eligible'
                ? 'current_verifier_revalidation_required'
                : 'gate_manifest_missing_or_invalid',
        featureGates,
        authoritativeForDispatch: false,
    };
    return {
        ready: false,
        writeMaster: 'disabled',
        runtime: {
            mode: 'simulation',
            role: 'primary',
            state: options.runtimeState ?? 'observe_only',
            repositoryReady: true,
            dispatchAllowedByRepository: false,
        },
        quote: {
            state: options.quoteState ?? 'unverified',
            asOfExchangeTime: options.quoteAsOf ?? null,
            authoritativeForActivation: false,
        },
        lifecycle: {
            schemaVersion: 'smart-order-lifecycle-audit/2026-08-12.4',
            state: 'verified_repository_projection',
            writeMaster: 'disabled',
            reconciliation: 'required_before_any_write_or_drain',
            activeObligationCount: 1,
            blockerCount: 3,
            productionReadonlyBlockerCount: 3,
            gracefulStopBlockerCount: 3,
            uninstallBlockerCount: 3,
            productionReadonlyDrainAllowed: false,
            gracefulStopAllowed: false,
            uninstallAllowed: false,
            drainItems: [
                {
                    kind: 'account_reconciliation',
                    count: 0,
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
                    count: 1,
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
                    count: 1,
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
                    kind: 'broker_order',
                    state: 'submitted',
                    quantityShares: 500,
                    quantityState: 'conservative_maximum',
                    disposition: 'cancel_working_order_or_reconcile',
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
                {
                    ordinal: 3,
                    kind: 'exit_claim',
                    state: 'monitoring_reserved',
                    quantityShares: 250,
                    quantityState: 'exact',
                    disposition: 'reconcile_or_release_claim',
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
            automation: gateStatus,
            manual_user_confirmed: {
                ...gateStatus,
                present: false,
                state: 'observe_only',
                blocker: 'gate_manifest_missing_or_invalid',
                featureGates: FEATURE_GATES,
            },
            gate_probe: {
                ...gateStatus,
                present: false,
                state: 'observe_only',
                blocker: 'gate_manifest_missing_or_invalid',
                featureGates: FEATURE_GATES,
            },
        },
        blockers:
            options.blockers ??
            [
                automationState === 'eligible'
                    ? 'write_master_disabled'
                    : 'gate_manifest_missing',
            ],
    };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function jsonError(status: number, code: string): Response {
    return new Response(JSON.stringify({ code }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function historyResponse(history: readonly unknown[] = []): Response {
    return jsonResponse({
        schemaVersion: 'smart-order-history-projection/2026-08-12.2',
        history,
        source: 'runtime_repository',
        accountIdentifiersExposed: false,
        journalPayloadExposed: false,
    });
}

function csrfResponse(): Response {
    return jsonResponse({
        csrfToken: 'a'.repeat(43),
        expiresAtEpochMs: Date.now() + 60_000,
        schemaVersion: 'smart-order-browser-csrf/2026-08-11.1',
        sessionBound: true,
        singleUse: true,
    });
}

function runtimeRiskPolicyView(
    state: 'current' | 'reconciliation_required' = 'current',
) {
    const policyRevision =
        'smart-order-runtime-risk-policy/2026-08-14.1:0';
    return {
        schemaVersion:
            'smart-order-runtime-risk-policy-view/2026-08-14.1',
        state,
        revision: 0,
        policyHash: `sha256:${'e'.repeat(64)}`,
        policy: {
            schemaVersion: 'smart-order-runtime-risk-policy/2026-08-14.1',
            revision: 0,
            policyRevision,
            executionPolicy: {
                schemaVersion:
                    'smart-order-protected-entry-risk-policy/2026-08-13.1',
                policyRevision,
                buyFeeBps: 15,
                minimumBuyFeeMinorUnits: 2000,
                cashBufferMinorUnits: 10000,
            },
            reservedDimensions: [
                'quantityShares',
                'notionalMinorUnits',
                'cashMinorUnits',
                'positionShares',
                'orderCount',
            ],
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
        },
        exposureHeadsCurrent: state === 'current',
        publishedAtEpochMs: 1_786_380_000_100,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        identityIdentifiersExposed: false,
    };
}

function canonicalQuickDraft() {
    return {
        schemaVersion: 'realtimestock.smart-order-strategy/v1',
        decisionTableVersion: '2026-08-11.2',
        kind: 'quick',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/quick/v1',
            monitorContractKey: 'TSE:STK:2330',
            condition: {
                field: 'last_price',
                comparator: 'gte',
                threshold: '100',
                mappingRevision: 'quote-mapping-1',
            },
            order: {
                contractKey: 'TSE:STK:2330',
                side: 'Buy',
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
    } as const;
}

function canonicalMultiConditionDraft() {
    const quick = canonicalQuickDraft();
    return {
        ...quick,
        kind: 'multi_condition',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/multi-condition/v1',
            conditions: [
                {
                    monitorContractKey: 'TSE:STK:2330',
                    condition: { ...quick.parameters.condition },
                },
            ],
            operator: 'AND',
            order: { ...quick.parameters.order },
            validity: { ...quick.parameters.validity },
            activationPolicy: 'require_rearm',
        },
    } as const;
}

function canonicalParentChildDraft() {
    const quick = canonicalQuickDraft();
    return {
        ...quick,
        kind: 'parent_child',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/parent-child/v1',
            parent: {
                monitorContractKey: 'TSE:STK:2330',
                condition: { ...quick.parameters.condition },
                order: { ...quick.parameters.order },
            },
            child: {
                monitorContractKey: 'TSE:STK:2303',
                condition: { ...quick.parameters.condition },
                order: {
                    ...quick.parameters.order,
                    contractKey: 'TSE:STK:2303',
                    side: 'Sell',
                    baseShares: '500',
                    commonLots: '1',
                    contractUnit: '500',
                },
                cutoffTime: '13:30:00',
            },
            parentValidity: { ...quick.parameters.validity },
            activationPolicy: 'require_rearm',
        },
    } as const;
}

function canonicalStopTakeDraft() {
    const quick = canonicalQuickDraft();
    return {
        ...quick,
        kind: 'stop_take',
        parameters: {
            payloadSchemaVersion:
                'realtimestock.smart-order-strategy-payload/stop-take/v1',
            positionContractKey: 'TSE:STK:2330',
            monitorContractKey: 'TSE:STK:2330',
            positionEvidenceRevision: 'position-1',
            basisPrice: '100',
            basisSource: 'broker_average_cost',
            legs: [
                {
                    legId: 'stop-leg',
                    type: 'stop',
                    distance: {
                        kind: 'fixed_atr',
                        atr: '9',
                        multiplier: '2',
                        atrSnapshotRevision: 'caller-placeholder',
                    },
                    triggerPrice: '82',
                    triggerTicks: '164',
                },
                {
                    legId: 'take-leg',
                    type: 'take',
                    distance: {
                        kind: 'fixed_atr',
                        atr: '9',
                        multiplier: '2',
                        atrSnapshotRevision: 'caller-placeholder',
                    },
                    triggerPrice: '118',
                    triggerTicks: '236',
                },
            ],
            order: { ...quick.parameters.order, side: 'Sell' },
            validity: quick.parameters.validity,
            activationPolicy: 'require_rearm',
        },
    } as const;
}

function canonicalQuickConfirmation(
    state: 'previewed' | 'accepted',
    strategy?: Readonly<Record<string, unknown>>,
    strategyId = 'draft-canonical',
    strategyRevision = 3,
) {
    return {
        schemaVersion: 'smart-order-canonical-confirmation/2026-08-20.1',
        state,
        snapshotHash: `sha256:${'4'.repeat(64)}`,
        strategyId,
        strategyKind: 'quick',
        strategyRevision,
        resolvedDefinitionHash: `sha256:${'2'.repeat(64)}`,
        fixedAccountLabel: 'S／已遮罩',
        contract: {
            contractKey: 'TSE:STK:2330',
            category: '股票',
            contractUnit: 1000,
            referenceMinorUnits: 10000,
            limitUpMinorUnits: 11000,
            limitDownMinorUnits: 9000,
            updateDate: '2026-08-11',
            contractRevision: `sha256:${'5'.repeat(64)}`,
            corporateActionRevision: `sha256:${'6'.repeat(64)}`,
        },
        position: null,
        riskRevision: 1,
        modeGeneration: 'api-generation-browser-quick',
        runtimeRevision: 1,
        validUntilEpochMs: Date.now() + 30_000,
        warnings: [
            'local_runtime_not_broker_cloud',
            'restart_requires_reconciliation_and_user_rearm',
            'broker_write_not_authorized',
        ],
        brokerWriteAttempted: false,
        brokerWriteAuthority: false,
        accountIdentifiersExposed: false,
        ...(strategy ? { strategy } : {}),
    };
}

function canonicalParentChildConfirmation(
    state: 'previewed' | 'accepted',
    strategy?: Readonly<Record<string, unknown>>,
) {
    const base = canonicalQuickConfirmation(
        state,
        strategy,
        'draft-parent-child',
        3,
    );
    return {
        ...base,
        strategyKind: 'parent_child',
        position: {
            quantityShares: 700,
            availableShares: 500,
            asOfEpochMs: Date.now(),
        },
        childContract: {
            ...base.contract,
            contractKey: 'TSE:STK:2303',
            contractUnit: 500,
            contractRevision: `sha256:${'7'.repeat(64)}`,
            corporateActionRevision: `sha256:${'8'.repeat(64)}`,
        },
        warnings: [
            'parent_and_child_contracts_are_distinct',
            'child_requires_parent_broker_confirmed_full_fill',
            'child_is_same_trade_date_only',
            'broker_write_not_authorized',
        ],
    };
}

async function settleEffects(): Promise<void> {
    await act(async () => {
        await new Promise<void>((resolve) =>
            window.requestAnimationFrame(() => resolve()),
        );
    });
}

describe('smart-order panel browser interaction', () => {
    let root: Root | null = null;

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
        vi.restoreAllMocks();
        window.localStorage.clear();
        document.body.replaceChildren();
    });

    it('publishes a Runtime-owned RiskPolicy without reading or writing browser storage', async () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem');
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        let publishedBody: Record<string, unknown> | null = null;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
            if (pathname.endsWith('/v1/risk/policy')) {
                if (init?.method === 'PUT') {
                    publishedBody = JSON.parse(String(init.body)) as Record<
                        string,
                        unknown
                    >;
                    return jsonResponse({
                        result: runtimeRiskPolicyView(
                            'reconciliation_required',
                        ),
                        resultHash: `sha256:${'f'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                return jsonResponse(runtimeRiskPolicyView());
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderRiskPolicyEditor));
        });
        await settleEffects();
        expect(host.textContent).toContain('Runtime RiskPolicy（current）');
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '發布並重新對帳')
                ?.click(),
        );
        await settleEffects();

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(publishedBody).toMatchObject({
            expectedRevision: 0,
            policy: {
                schemaVersion:
                    'smart-order-runtime-risk-policy-editor/2026-08-14.1',
                accountDailyLossLimitMinorUnits: 1_000_000,
                identityDailyLossLimitMinorUnits: 2_000_000,
            },
        });
        expect(JSON.stringify(publishedBody)).not.toMatch(
            /accountId|accountBroker|identityGroup|brokerWrite/i,
        );
        expect(host.textContent).toContain(
            'Runtime RiskPolicy（reconciliation_required）',
        );
        expect(getItem).not.toHaveBeenCalled();
        expect(setItem).not.toHaveBeenCalled();
    });

    it('opens a body-level selector, defaults to trailing exit and keeps locked strategies disabled', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/risk/policy')) {
                return jsonResponse({
                    schemaVersion:
                        'smart-order-runtime-risk-policy-view/2026-08-14.1',
                    state: 'missing',
                    revision: null,
                    policyHash: null,
                    policy: null,
                    exposureHeadsCurrent: false,
                    brokerWriteAuthority: false,
                    accountIdentifiersExposed: false,
                    identityIdentifiersExposed: false,
                });
            }
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        expect(host.textContent).toContain('本機監控・非券商雲端');
        expect(host.textContent).toContain('實盤不可把它當成唯一保護');
        const reduceOnlyBoundary = host.querySelector(
            '[aria-label="本地 reduce-only 與外部交易限制"]',
        );
        expect(reduceOnlyBoundary?.textContent).toContain(
            '本地 reduce-only 非券商原子保證',
        );
        expect(reduceOnlyBoundary?.textContent).toContain('其他 client');
        expect(reduceOnlyBoundary?.textContent).toContain('停送並轉人工');
        expect(reduceOnlyBoundary?.textContent).toContain('TOCTOU');
        expect(host.textContent).toContain('SIM · observe_only');
        expect(host.textContent).toContain('行情 freshness');
        expect(host.textContent).toContain('unverified');
        expect(host.textContent).toContain('RealTimeStock 股票本機上限');
        expect(host.textContent).toContain('大戶投券商雲端上限');
        expect(host.textContent).toContain('本機不會讀取、占用或同步該額度');
        const addButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '新增智慧單',
        );
        expect(addButton?.disabled).toBe(false);

        addButton?.focus();
        await act(async () => addButton?.click());
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog).not.toBeNull();
        await settleEffects();
        expect(dialog?.textContent).toContain('選擇智慧單類型');
        expect(dialog?.getAttribute('aria-modal')).toBe('true');
        expect(dialog?.getAttribute('aria-labelledby')).toBe(
            'smart-order-kind-heading',
        );
        expect(dialog?.getAttribute('aria-describedby')).toBe(
            'smart-order-dialog-description',
        );
        expect(dialog?.querySelectorAll('input[type="radio"]')).toHaveLength(7);
        const trailing = dialog?.querySelector<HTMLInputElement>(
            'input[value="trailing_exit"]',
        );
        expect(trailing?.checked).toBe(true);
        expect(document.activeElement).toBe(trailing);
        expect(dialog?.textContent).toContain('預設為「移動出場單」');
        expect(dialog?.querySelectorAll('small')).toHaveLength(7);
        const nextButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === '下一步',
        );
        expect(nextButton?.disabled).toBe(true);

        const dialogButtons = [
            ...(dialog?.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
            ) ?? []),
        ];
        const cancelButton = dialogButtons.find(
            (button) => button.textContent === '取消',
        );
        const firstRadio = dialog?.querySelector<HTMLInputElement>(
            'input[type="radio"]',
        );
        cancelButton?.focus();
        await act(async () =>
            document.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Tab',
                    bubbles: true,
                }),
            ),
        );
        expect(document.activeElement).toBe(firstRadio);
        firstRadio?.focus();
        await act(async () =>
            document.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Tab',
                    shiftKey: true,
                    bubbles: true,
                }),
            ),
        );
        expect(document.activeElement).toBe(cancelButton);

        const quick = dialog?.querySelector<HTMLInputElement>(
            'input[value="quick"]',
        );
        await act(async () => quick?.click());
        expect(quick?.checked).toBe(true);
        expect(nextButton?.disabled).toBe(true);

        await act(async () =>
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            ),
        );
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        await settleEffects();
        expect(document.activeElement).toBe(addButton);

        await act(async () => addButton?.click());
        const visibleCancel = [
            ...document.body.querySelectorAll<HTMLButtonElement>(
                '[role="dialog"] button',
            ),
        ].find((button) => button.textContent === '取消');
        await act(async () => visibleCancel?.click());
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();

        await act(async () => addButton?.click());
        expect(
            document.body.querySelector<HTMLInputElement>(
                'input[value="trailing_exit"]',
            )?.checked,
        ).toBe(true);
        const backdrop = document.body.querySelector<HTMLElement>(
            '[role="dialog"]',
        )?.parentElement;
        await act(async () =>
            backdrop?.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true }),
            ),
        );
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    it('keeps both scheduled quantity modes disabled even if browser readiness claims the feature is enabled', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(
                        readinessResponse(
                            {
                                ...FEATURE_GATES,
                                scheduled_quantity: true,
                            },
                            'eligible',
                        ),
                    );
                }
                if (pathname.endsWith('/v1/history')) return historyResponse();
                if (pathname.endsWith('/v1/risk/policy')) {
                    return jsonResponse(runtimeRiskPolicyView());
                }
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: [],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                throw new Error(
                    `unexpected ${init?.method ?? 'GET'} request ${pathname}`,
                );
            });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        const addButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '新增智慧單',
        );
        await act(async () => addButton?.click());
        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        const scheduled = dialog?.querySelector<HTMLInputElement>(
            'input[value="scheduled_quantity"]',
        );
        await act(async () => scheduled?.click());

        const status = dialog?.querySelector<HTMLElement>(
            '[aria-label="定時定量算法未證實"]',
        );
        expect(status?.textContent).toContain('timed_split_algorithm_unverified');
        expect(status?.textContent).toContain(
            'quantity_remainder_algorithm_unverified',
        );
        expect(status?.textContent).toContain('不產生 slot');
        expect(status?.textContent).toContain('不補送 missed slot');
        expect(status?.textContent).toContain('不建立 broker intent');
        const nextButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === '下一步',
        );
        expect(nextButton?.disabled).toBe(true);
        expect(nextButton?.title).toBe('定時與定量算法尚未證實');
        expect(
            fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
        ).toHaveLength(0);
    });

    it('supports ARIA tab relationships and keyboard navigation', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            async (input, init) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
                throw new Error(`unexpected request ${pathname}`);
            },
        );

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        const tablist = host.querySelector<HTMLElement>('[role="tablist"]');
        const monitoring = host.querySelector<HTMLButtonElement>(
            '#smart-order-tab-monitoring',
        );
        expect(tablist?.getAttribute('aria-label')).toBe('智慧單狀態');
        expect(monitoring?.getAttribute('aria-selected')).toBe('true');
        expect(monitoring?.getAttribute('aria-controls')).toBe(
            'smart-order-tabpanel-monitoring',
        );
        expect(
            host.querySelector('#smart-order-tabpanel-monitoring')?.getAttribute(
                'aria-labelledby',
            ),
        ).toBe('smart-order-tab-monitoring');

        monitoring?.focus();
        await act(async () =>
            monitoring?.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'End',
                    bubbles: true,
                }),
            ),
        );
        const history = host.querySelector<HTMLButtonElement>(
            '#smart-order-tab-history',
        );
        expect(history?.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(history);
        expect(host.querySelector('#smart-order-tabpanel-history')).not.toBeNull();

        await act(async () =>
            history?.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Home',
                    bubbles: true,
                }),
            ),
        );
        expect(monitoring?.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(monitoring);
    });

    it('copies a terminal strategy into a draft without changing its type', async () => {
        let copied = false;
        const source = {
            strategyId: 'source-1',
            strategyKind: 'trailing_exit',
            state: 'completed',
            definitionHash: `sha256:${'a'.repeat(64)}`,
            accountBound: true,
            createdAtEpochMs: 1,
            updatedAtEpochMs: 2,
            terminalAtEpochMs: 2,
            revision: 4,
        } as const;
        const draft = {
            strategyId: 'copy-1',
            strategyKind: 'trailing_exit',
            state: 'draft',
            definitionHash: `sha256:${'b'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 3,
            updatedAtEpochMs: 3,
            revision: 0,
        } as const;
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(readinessResponse());
                }
                if (
                    pathname.endsWith('/v1/strategies/source-1/copy') &&
                    init?.method === 'POST'
                ) {
                    const body = JSON.parse(String(init.body)) as Record<
                        string,
                        unknown
                    >;
                    expect(body.expectedRevision).toBe(4);
                    expect(body).not.toHaveProperty('provenance');
                    copied = true;
                    return jsonResponse({
                        result: draft,
                        resultHash: `sha256:${'c'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
                if (pathname.endsWith('/v1/history')) {
                    return historyResponse([
                        {
                            type: 'strategy',
                            strategyId: source.strategyId,
                            strategyKind: source.strategyKind,
                            state: source.state,
                            maskedAccountLabel: '固定帳號 ····5431',
                            reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                            revision: source.revision,
                            createdAtEpochMs: source.createdAtEpochMs,
                            updatedAtEpochMs: source.updatedAtEpochMs,
                            terminalAtEpochMs: source.terminalAtEpochMs,
                            exchangeEpochMs: null,
                            brokerEpochMs: 2,
                            receiveEpochMs: 2,
                        },
                    ]);
                }
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: copied ? [source, draft] : [source],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                throw new Error(`unexpected request ${pathname}`);
            });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        const historyTab = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '歷程',
        );
        await act(async () => historyTab?.click());
        expect(host.textContent).toContain(
            'reason STRATEGY_TERMINAL_IMPORTED',
        );
        expect(host.textContent).toContain('固定帳號 ····5431');
        expect(host.textContent).toContain('通知與本機顯示不是 broker 證據');
        const copyButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '複製為草稿',
        );
        expect(copyButton).toBeDefined();
        await act(async () => copyButton?.click());
        await settleEffects();

        expect(copied).toBe(true);
        expect(host.textContent).toContain('移動出場單');
        expect(host.textContent).toContain('草稿');
        expect(fetchMock).toHaveBeenCalledWith(
            '/__smart-orders/v1/strategies/source-1/copy',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('shows legacy trading triggers as manual rebuild only', async () => {
        window.localStorage.setItem(
            'sj-pro-triggers',
            JSON.stringify([
                {
                    id: 'legacy-stop',
                    code: '2330',
                    condition: 'below',
                    price: 900,
                    action: 'Sell',
                    quantity: 1,
                    kind: 'stop',
                },
                {
                    id: 'legacy-alert',
                    code: '2330',
                    condition: 'above',
                    price: 1000,
                    action: 'Sell',
                    quantity: 1,
                    kind: 'alert',
                },
            ]),
        );
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        expect(host.textContent).toContain('1 筆舊版停損／停利觸價資料');
        expect(host.textContent).toContain('不會自動匯入或啟用');
        expect(host.textContent).toContain('1 筆舊版純警示');
        expect(host.textContent).toContain('舊版記憶體括號單無法');
    });

    it('reopens the Runtime draft with its saved type and contract unchanged', async () => {
        const draftSummary = {
            strategyId: 'draft-quick',
            strategyKind: 'quick',
            state: 'draft',
            definitionHash: `sha256:${'f'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 11,
            revision: 2,
        } as const;
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(readinessResponse());
                }
                if (
                    pathname.endsWith('/v1/strategies/draft-quick') &&
                    (init?.method ?? 'GET') === 'GET'
                ) {
                    return jsonResponse({
                        strategy: {
                            ...draftSummary,
                            definition: {
                                workspaceContractKey: 'TSE:STK:2330',
                            },
                        },
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                if (pathname.endsWith('/v1/history')) return historyResponse();
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: [draftSummary],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                throw new Error(`unexpected request ${pathname}`);
            });

        const initialContract = {
            exchange: 'TSE',
            security_type: 'STK',
            code: '2330',
            name: '台積電',
        } as ContractInfo;
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(SmartOrderPanel, { contract: initialContract }),
            );
        });
        await settleEffects();

        const processingTab = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '處理中',
        );
        await act(async () => processingTab?.click());
        const reopenButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '繼續設定',
        );
        expect(reopenButton).toBeDefined();
        await act(async () => reopenButton?.click());
        await settleEffects();

        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('快速單草稿');
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="canonical contract"]',
            )?.value,
        ).toBe('TSE:STK:2330');
        expect(dialog?.textContent).toContain(
            'Runtime 尚未提供完整 versioned canonical draft',
        );

        const changedWorkspaceContract = {
            ...initialContract,
            exchange: 'OTC',
            code: '6488',
            name: '環球晶',
        } as ContractInfo;
        await act(async () => {
            root?.render(
                createElement(SmartOrderPanel, {
                    contract: changedWorkspaceContract,
                }),
            );
        });

        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="canonical contract"]',
            )?.value,
        ).toBe('TSE:STK:2330');
        expect(fetchMock).toHaveBeenCalledWith(
            '/__smart-orders/v1/strategies/draft-quick',
            expect.objectContaining({ method: 'GET' }),
        );
        expect(
            fetchMock.mock.calls.some(
                ([, init]) => init?.method === 'POST' || init?.method === 'PUT',
            ),
        ).toBe(false);
    });

    it('creates a draft on the type step and freezes the supported workspace contract', async () => {
        const enabledGates = Object.freeze({
            ...FEATURE_GATES,
            trailing_exit: true,
        });
        let created = false;
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(
                        readinessResponse(enabledGates, 'eligible'),
                    );
                }
                if (
                    pathname.endsWith('/v1/strategies') &&
                    init?.method === 'POST'
                ) {
                    const body = JSON.parse(String(init.body)) as Record<
                        string,
                        unknown
                    >;
                    expect(body).toMatchObject({
                        strategyKind: 'trailing_exit',
                        workspaceContractKey: 'TSE:STK:2330',
                    });
                    expect(body).not.toHaveProperty('provenance');
                    created = true;
                    return jsonResponse({
                        result: {
                            strategyId: 'draft-2330',
                            strategyKind: 'trailing_exit',
                            state: 'draft',
                            definitionHash: `sha256:${'d'.repeat(64)}`,
                            accountBound: false,
                            createdAtEpochMs: 4,
                            updatedAtEpochMs: 4,
                            revision: 0,
                        },
                        resultHash: `sha256:${'e'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
                if (pathname.endsWith('/v1/history')) return historyResponse();
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: [],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                throw new Error(`unexpected request ${pathname}`);
            });

        const contract = {
            exchange: 'TSE',
            security_type: 'STK',
            code: '2330',
            name: '台積電',
        } as ContractInfo;
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract }));
        });
        await settleEffects();

        const addButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '新增智慧單',
        );
        await act(async () => addButton?.click());
        const nextButton = [
            ...document.body.querySelectorAll<HTMLButtonElement>(
                '[role="dialog"] button',
            ),
        ].find((button) => button.textContent === '下一步');
        expect(nextButton?.disabled).toBe(false);
        await act(async () => nextButton?.click());
        await settleEffects();
        expect(
            document.body.querySelector<HTMLInputElement>(
                'input[aria-label="canonical contract"]',
            )?.value,
        ).toBe('TSE:STK:2330');
        expect(created).toBe(true);

        const linkedContract = {
            ...contract,
            exchange: 'OTC',
            code: '6488',
            name: '環球晶',
        } as ContractInfo;
        await act(async () => {
            root?.render(
                createElement(SmartOrderPanel, { contract: linkedContract }),
            );
        });
        expect(
            document.body.querySelector<HTMLInputElement>(
                'input[aria-label="canonical contract"]',
            )?.value,
        ).toBe('TSE:STK:2330');
        expect(document.body.textContent).toContain(
            'Runtime 尚未提供完整 versioned canonical draft',
        );
        expect(fetchMock).toHaveBeenCalledWith(
            '/__smart-orders/v1/strategies',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('keeps history cards visible but marks them as a stale snapshot after refresh fails', async () => {
        let historyFails = false;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) {
                if (historyFails) {
                    return jsonError(503, 'history_temporarily_unavailable');
                }
                return historyResponse([
                    {
                        type: 'strategy',
                        strategyId: 'history-stale-1',
                        strategyKind: 'quick',
                        state: 'completed',
                        maskedAccountLabel: '固定帳號 ····5431',
                        reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
                        revision: 2,
                        createdAtEpochMs: 1,
                        updatedAtEpochMs: 2,
                        terminalAtEpochMs: 2,
                        exchangeEpochMs: 2,
                        brokerEpochMs: 2,
                        receiveEpochMs: 2,
                    },
                ]);
            }
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        const historyTab = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '歷程',
        );
        await act(async () => historyTab?.click());
        expect(host.textContent).toContain('reason STRATEGY_TERMINAL_IMPORTED');
        expect(host.textContent).toContain('最後成功讀取：');

        historyFails = true;
        const refreshButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '重新整理歷程',
        );
        await act(async () => refreshButton?.click());
        await settleEffects();

        expect(host.textContent).toContain('reason STRATEGY_TERMINAL_IMPORTED');
        expect(host.textContent).toContain('目前顯示舊快照');
        expect(host.textContent).toContain('歷程更新失敗');
        expect(host.textContent).toContain('目前保留最後成功於');
        expect(host.textContent).toContain('請勿把舊快照');
    });

    it('renders the bounded long-history projection without collapsing terminal evidence', async () => {
        const history = Array.from({ length: 100 }, (_, index) => ({
            type: 'strategy' as const,
            strategyId: `history-${index}`,
            strategyKind: 'quick' as const,
            state: 'completed' as const,
            maskedAccountLabel: '固定帳號 ····5431',
            reasonCode: 'STRATEGY_TERMINAL_IMPORTED',
            revision: index + 1,
            createdAtEpochMs: index + 1,
            updatedAtEpochMs: index + 2,
            terminalAtEpochMs: index + 2,
            exchangeEpochMs: null,
            brokerEpochMs: index + 2,
            receiveEpochMs: index + 2,
        }));
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse(history);
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>('#smart-order-tab-history')
                ?.click(),
        );

        expect(host.querySelectorAll('article')).toHaveLength(100);
        expect(host.textContent).toContain('reason STRATEGY_TERMINAL_IMPORTED');
        expect(host.textContent).toContain('固定帳號 ····5431');
    });

    it('announces offline, recovery and stale-quote readiness without unlocking creation', async () => {
        let readinessCalls = 0;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                readinessCalls += 1;
                if (readinessCalls === 1) throw new TypeError('offline');
                return jsonResponse(
                    readinessResponse(FEATURE_GATES, 'observe_only', {
                        runtimeState: 'recovery',
                        quoteState: 'stale',
                        quoteAsOf: '2026-08-12T01:00:00.000Z',
                        blockers: ['reconciliation_required'],
                    }),
                );
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        const offlineRuntimeStatus = host.querySelector<HTMLElement>(
            '[role="status"][aria-label="智慧下單 Runtime 狀態"]',
        );
        expect(offlineRuntimeStatus?.textContent).toContain('offline');
        expect(offlineRuntimeStatus?.getAttribute('aria-live')).toBe('polite');

        await act(async () => root?.unmount());
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        const runtimeStatus = host.querySelector<HTMLElement>(
            '[role="status"][aria-label="智慧下單 Runtime 狀態"]',
        );
        expect(runtimeStatus?.textContent).toContain('SIM · recovery');
        expect(runtimeStatus?.textContent).toContain('stale');
        expect(runtimeStatus?.textContent).toContain(
            '2026-08-12T01:00:00.000Z',
        );
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '新增智慧單')
                ?.click(),
        );
        const next = [...document.body.querySelectorAll('button')].find(
            (button) => button.textContent === '下一步',
        );
        expect(next?.disabled).toBe(true);
    });

    it('shows redacted per-kind lifecycle drain blockers without offering a generic release action', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected route: ${pathname}`);
        });
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel));
        });
        await settleEffects();

        const summary = host.querySelector(
            '[aria-label="智慧下單停止與卸載阻擋摘要"]',
        );
        expect(summary?.textContent).toContain('未終結券商委託 × 1');
        expect(summary?.textContent).toContain('保護義務 × 1');
        expect(summary?.textContent).toContain('出場 claim × 1');
        expect(summary?.textContent).toContain('#1 未終結券商委託');
        expect(summary?.textContent).toContain('已委託／未全成 · 最多 500 Share（保守上限）');
        expect(summary?.textContent).toContain('#2 保護義務');
        expect(summary?.textContent).toContain('監控中 · 最多 1000 Share（保守上限）');
        expect(summary?.textContent).toContain('#3 出場 claim');
        expect(summary?.textContent).toContain('監控保留 · 250 Share（精確）');
        expect(summary?.textContent).toContain('Runtime 未受保護量：未知');
        expect(summary?.textContent).toContain(
            '請在對應策略卡分別執行取消策略、取消券商委託、本機取消未送出意圖或二次確認人工relinquish',
        );
        expect(summary?.textContent).not.toMatch(/account|broker_ref|strategy_id/i);
        expect(
            [...summary!.querySelectorAll('button')].map(
                (button) => button.textContent,
            ),
        ).toEqual([]);
    });

    it('keeps a truncated drain projection blocked and visibly warns about hidden records', async () => {
        const projection = readinessResponse();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse({
                    ...projection,
                    lifecycle: {
                        ...projection.lifecycle,
                        gracefulStopBlockerCount: 101,
                        blockerCount: 101,
                        uninstallBlockerCount: 101,
                        drainItems: projection.lifecycle.drainItems.map((item) =>
                            item.kind === 'strategy'
                                ? { ...item, count: 101 }
                                : item.kind === 'broker_order' ||
                                    item.kind === 'protection_obligation' ||
                                    item.kind === 'exit_claim'
                                  ? { ...item, count: 0 }
                                  : item,
                        ),
                        drainRecords: Array.from(
                            { length: 100 },
                            (_value, index) => ({
                                ordinal: index + 1,
                                kind: 'strategy',
                                state: 'monitoring',
                                quantityShares: null,
                                quantityState: 'not_applicable',
                                disposition: 'pause_or_cancel_strategy',
                            }),
                        ),
                        drainRecordsTruncated: true,
                    },
                });
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected route: ${pathname}`);
        });
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel));
        });
        await settleEffects();

        const summary = host.querySelector(
            '[aria-label="智慧下單停止與卸載阻擋摘要"]',
        );
        expect(summary?.textContent).toContain('101 項阻擋');
        expect(summary?.textContent).toContain('策略 × 101');
        expect(summary?.textContent).toContain('逐項清單已達 100 筆上限');
        expect(summary?.textContent).toContain(
            '停止、rollback 與 uninstall 仍維持拒絕',
        );
        expect(summary?.querySelectorAll('[aria-label="逐項停止阻擋清單"] li')).toHaveLength(100);
        expect(summary?.querySelectorAll('button')).toHaveLength(0);
    });

    it('shows the four canonical draft steps and saves only the Runtime draft', async () => {
        const definition = canonicalQuickDraft();
        const immediateConfirmation = vi
            .spyOn(window, 'confirm')
            .mockReturnValue(true);
        const draftSummary = {
            strategyId: 'draft-canonical',
            strategyKind: 'quick',
            state: 'draft',
            definitionHash: `sha256:${'1'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 11,
            revision: 2,
        } as const;
        let savedDraft: unknown = null;
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(readinessResponse());
                }
                if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
                if (pathname.endsWith('/v1/history')) return historyResponse();
                if (
                    pathname.endsWith(
                        '/v1/strategies/draft-canonical/confirmation-preview',
                    ) &&
                    init?.method === 'POST'
                ) {
                    const body = JSON.parse(String(init.body)) as Record<
                        string,
                        unknown
                    >;
                    expect(body.basisSelection).toBeNull();
                    expect(body.accountBrokerRef).toBe('broker-A');
                    expect(body.accountIdRef).toBe('account-A');
                    return jsonResponse({
                        result: canonicalQuickConfirmation('previewed'),
                        resultHash: `sha256:${'7'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (
                    pathname.endsWith(
                        '/v1/strategies/draft-canonical/confirmation-accept',
                    ) &&
                    init?.method === 'POST'
                ) {
                    return jsonResponse({
                        result: canonicalQuickConfirmation('accepted', {
                            ...draftSummary,
                            state: 'paused',
                            accountBound: true,
                            maskedAccountLabel: '固定帳號（已遮罩）',
                            definition: savedDraft,
                            definitionHash: `sha256:${'2'.repeat(64)}`,
                            updatedAtEpochMs: 13,
                            revision: 4,
                        }),
                        resultHash: `sha256:${'8'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (
                    pathname.endsWith('/v1/strategies/draft-canonical') &&
                    (init?.method ?? 'GET') === 'GET'
                ) {
                    return jsonResponse({
                        strategy: { ...draftSummary, definition },
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                if (
                    pathname.endsWith('/v1/strategies/draft-canonical') &&
                    init?.method === 'PUT'
                ) {
                    const body = JSON.parse(String(init.body)) as {
                        expectedRevision: number;
                        draft: unknown;
                    };
                    expect(body.expectedRevision).toBe(2);
                    savedDraft = body.draft;
                    return jsonResponse({
                        result: {
                            ...draftSummary,
                            definition: body.draft,
                            definitionHash: `sha256:${'2'.repeat(64)}`,
                            updatedAtEpochMs: 12,
                            revision: 3,
                        },
                        resultHash: `sha256:${'3'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: [draftSummary],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                throw new Error(`unexpected request ${pathname}`);
            });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();

        const processingTab = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '處理中',
        );
        await act(async () => processingTab?.click());
        const reopenButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '繼續設定',
        );
        await act(async () => reopenButton?.click());
        await settleEffects();

        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('類型');
        expect(dialog?.textContent).toContain('條件');
        expect(dialog?.textContent).toContain('委託');
        expect(dialog?.textContent).toContain('確認');
        expect(
            dialog?.querySelector<HTMLInputElement>('input[aria-label="固定帳號"]')
                ?.value,
        ).toBe('待 Runtime canonical confirmation 固定');
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="canonical contract"]',
            )?.value,
        ).toBe('TSE:STK:2330');
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="order condition"]',
            )?.value,
        ).toBe('Cash');
        expect(
            dialog?.querySelector<HTMLInputElement>('input[aria-label="order lot"]')
                ?.value,
        ).toBe('Common');
        expect(
            dialog?.querySelector<HTMLSelectElement>(
                'select[aria-label="觸發來源欄位"]',
            )?.value,
        ).toBe('last_price');
        expect(
            dialog?.querySelectorAll(
                'select[aria-label="觸發來源欄位"] option',
            ),
        ).toHaveLength(9);
        expect(
            dialog?.querySelector<HTMLSelectElement>(
                'select[aria-label="activation policy"]',
            )?.value,
        ).toBe('require_rearm');
        const activationPolicy = dialog?.querySelector<HTMLSelectElement>(
            'select[aria-label="activation policy"]',
        );
        await act(async () => {
            if (!activationPolicy) return;
            const setter = Object.getOwnPropertyDescriptor(
                HTMLSelectElement.prototype,
                'value',
            )?.set;
            setter?.call(activationPolicy, 'immediate_if_true');
            activationPolicy.dispatchEvent(
                new Event('change', { bubbles: true }),
            );
        });
        expect(activationPolicy?.value).toBe('immediate_if_true');

        const returnToList = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === '返回清單',
        );
        expect(returnToList).toBeDefined();

        const conditionNext = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === '下一步',
        );
        await act(async () => conditionNext?.click());
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="委託張數 CommonLot"]',
            )?.value,
        ).toBe('1');
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="委託股數 Share"]',
            )?.value,
        ).toBe('1000');
        expect(
            dialog?.querySelector<HTMLSelectElement>(
                'select[aria-label="broker price type"]',
            )?.disabled,
        ).toBe(true);

        const orderNext = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === '下一步',
        );
        await act(async () => orderNext?.click());
        await settleEffects();
        expect(immediateConfirmation).toHaveBeenCalledTimes(1);
        expect(dialog?.textContent).toContain('Runtime canonical confirmation');
        expect(dialog?.textContent).toContain('Cash/Common');
        expect(dialog?.textContent).toContain('1 CommonLot = 1000 Share');
        expect(dialog?.textContent).toContain('LMT/ROD @ 100');
        expect(dialog?.textContent).toContain(
            '只保存 versioned canonical draft',
        );

        const saveButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) =>
                button.textContent === '接受 Runtime canonical confirmation',
        );
        await act(async () => saveButton?.click());
        await settleEffects();
        await settleEffects();

        expect(savedDraft).toEqual({
            ...definition,
            parameters: {
                ...definition.parameters,
                activationPolicy: 'immediate_if_true',
            },
        });
        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).endsWith(
                    '/v1/strategies/draft-canonical/confirmation-accept',
                ),
            ),
        ).toBe(true);
        expect(
            [...document.body.querySelectorAll('[role="alert"]')]
                .map((element) => element.textContent)
                .join('\n'),
        ).not.toContain('invalid_canonical_confirmation_response');
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).includes(':8080'),
            ),
        ).toBe(false);
    });

    it('confirms a distinct-contract parent-child draft and shows the child reduce-only basis', async () => {
        const definition = canonicalParentChildDraft();
        const draftSummary = {
            strategyId: 'draft-parent-child',
            strategyKind: 'parent_child',
            state: 'draft',
            definitionHash: `sha256:${'1'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 11,
            revision: 2,
        } as const;
        let accepted = false;
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(readinessResponse());
                }
                if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
                if (pathname.endsWith('/v1/history')) return historyResponse();
                if (
                    pathname.endsWith(
                        '/v1/strategies/draft-parent-child/confirmation-preview',
                    )
                ) {
                    const body = JSON.parse(String(init?.body)) as Record<
                        string,
                        unknown
                    >;
                    expect(body.basisSelection).toBeNull();
                    return jsonResponse({
                        result: canonicalParentChildConfirmation('previewed'),
                        resultHash: `sha256:${'7'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (
                    pathname.endsWith(
                        '/v1/strategies/draft-parent-child/confirmation-accept',
                    )
                ) {
                    accepted = true;
                    return jsonResponse({
                        result: canonicalParentChildConfirmation('accepted', {
                            ...draftSummary,
                            state: 'paused',
                            accountBound: true,
                            maskedAccountLabel: '固定帳號（已遮罩）',
                            definition,
                            definitionHash: `sha256:${'2'.repeat(64)}`,
                            updatedAtEpochMs: 13,
                            revision: 4,
                        }),
                        resultHash: `sha256:${'8'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (
                    pathname.endsWith('/v1/strategies/draft-parent-child') &&
                    init?.method === 'PUT'
                ) {
                    const body = JSON.parse(String(init.body)) as {
                        draft: unknown;
                    };
                    return jsonResponse({
                        result: {
                            ...draftSummary,
                            definition: body.draft,
                            definitionHash: `sha256:${'2'.repeat(64)}`,
                            updatedAtEpochMs: 12,
                            revision: 3,
                        },
                        resultHash: `sha256:${'3'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                if (
                    pathname.endsWith('/v1/strategies/draft-parent-child') &&
                    (init?.method ?? 'GET') === 'GET'
                ) {
                    return jsonResponse({
                        strategy: { ...draftSummary, definition },
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: [draftSummary],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                throw new Error(`unexpected request ${pathname}`);
            });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '處理中')
                ?.click();
        });
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '繼續設定')
                ?.click();
        });
        await settleEffects();
        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        for (let index = 0; index < 3; index += 1) {
            await act(async () => {
                [...(dialog?.querySelectorAll('button') ?? [])]
                    .find((button) => button.textContent === '下一步')
                    ?.click();
            });
            await settleEffects();
        }
        await settleEffects();
        expect(dialog?.textContent).toContain(
            'TSE:STK:2330 → TSE:STK:2303；各自監控同一委託商品',
        );
        expect(dialog?.textContent).toContain(
            '子單商品目前可用現股；不得使用母單成交量跨商品推導',
        );
        expect(dialog?.textContent).toContain('700 Share／可用 500 Share');
        const acceptButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) =>
                button.textContent === '接受 Runtime canonical confirmation',
        );
        await act(async () => acceptButton?.click());
        await settleEffects();
        await settleEffects();
        expect(accepted).toBe(true);
        expect(
            fetchMock.mock.calls.some(([input]) =>
                String(input).includes(':8080'),
            ),
        ).toBe(false);
    });

    it('shows high-visibility manual guidance when a parent-child flow can no longer advance safely', async () => {
        const emptyComponent = { state: null, count: 0 };
        const strategy = {
            strategyId: 'parent-child-manual-guidance',
            strategyKind: 'parent_child',
            state: 'manual_intervention',
            definitionHash: `sha256:${'9'.repeat(64)}`,
            accountBound: true,
            maskedAccountLabel: '固定帳號（已遮罩）',
            createdAtEpochMs: 10,
            updatedAtEpochMs: 12,
            revision: 4,
            activity: {
                schemaVersion: 'smart-order-active-activity/2026-08-13.3',
                displayState: 'manual_intervention',
                activations: { state: 'part_filled', count: 1 },
                intents: { state: 'terminal', count: 1 },
                brokerOrders: { state: 'part_filled', count: 1 },
                protectionCommitments: emptyComponent,
                protectionObligations: emptyComponent,
                entryExposureReservations: emptyComponent,
                exitClaims: emptyComponent,
                resolutionCases: { state: 'open', count: 1 },
                safetyBlockers: { state: 'open', count: 1 },
                formalProtection: null,
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
            },
        };
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/risk/policy')) {
                return jsonResponse({
                    schemaVersion:
                        'smart-order-runtime-risk-policy-view/2026-08-14.1',
                    state: 'missing',
                    revision: null,
                    policyHash: null,
                    policy: null,
                    exposureHeadsCurrent: false,
                    brokerWriteAuthority: false,
                    accountIdentifiersExposed: false,
                    identityIdentifiersExposed: false,
                });
            }
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [strategy],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            if (
                pathname.endsWith(
                    '/v1/strategies/parent-child-manual-guidance/resolutions',
                )
            ) {
                return jsonResponse({
                    schemaVersion:
                        'smart-order-manual-resolution-list/2026-08-20.1',
                    policySchemaVersion:
                        'smart-order-manual-resolution/2026-08-11.6',
                    strategyId: 'parent-child-manual-guidance',
                    strategyRevision: 4,
                    strategyState: 'manual_intervention',
                    cases: [],
                    genericResumeAllowed: false,
                    brokerWriteAuthority: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '處理中')
                ?.click();
        });

        const guidance = host.querySelector(
            '[aria-label="母子單自動推進已停止"]',
        );
        expect(guidance?.textContent).toContain('母子單自動推進已停止');
        expect(guidance?.textContent).toContain('已成交現股不由此子單保護');
        expect(guidance?.textContent).toContain('請另建新策略');
        expect(guidance?.textContent).toContain('不會跨日或自動重送原子單');
    });

    it('edits one to seven multi-product conditions without contacting the broker API', async () => {
        const definition = canonicalMultiConditionDraft();
        const draftSummary = {
            strategyId: 'draft-multi-condition',
            strategyKind: 'multi_condition',
            state: 'draft',
            definitionHash: `sha256:${'1'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 11,
            revision: 2,
        } as const;
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (input) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(readinessResponse());
                }
                if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
                if (pathname.endsWith('/v1/history')) return historyResponse();
                if (pathname.endsWith('/v1/risk/policy')) {
                    return jsonResponse({
                        schemaVersion:
                            'smart-order-runtime-risk-policy-view/2026-08-14.1',
                        state: 'missing',
                        revision: null,
                        policyHash: null,
                        policy: null,
                        updatedAtEpochMs: null,
                        brokerWriteAuthority: false,
                        accountIdentifiersExposed: false,
                    });
                }
                if (pathname.endsWith('/v1/strategies/draft-multi-condition')) {
                    return jsonResponse({
                        strategy: { ...draftSummary, definition },
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: [draftSummary],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                throw new Error(`unexpected request ${pathname}`);
            });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '處理中')
                ?.click();
        });
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '繼續設定')
                ?.click();
        });
        await settleEffects();

        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.querySelectorAll('input[aria-label$="監控商品"]')).toHaveLength(1);
        const operator = dialog?.querySelector<HTMLSelectElement>(
            'select[aria-label="多條件組合"]',
        );
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLSelectElement.prototype,
                'value',
            )?.set;
            setter?.call(operator, 'OR');
            operator?.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(operator?.value).toBe('OR');
        const addCondition = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === '新增條件',
        );
        for (let index = 1; index < 7; index += 1) {
            await act(async () => addCondition?.click());
        }
        expect(dialog?.querySelectorAll('input[aria-label$="監控商品"]')).toHaveLength(7);
        expect(addCondition?.disabled).toBe(true);
        expect(dialog?.textContent).toContain('任一缺失會讓整體不ready');
        expect(
            fetchMock.mock.calls.some(([input]) => String(input).includes(':8080')),
        ).toBe(false);
    });

    it('keeps fixed ATR value and revision Runtime-owned in an existing-position stop/take draft', async () => {
        const definition = canonicalStopTakeDraft();
        const draftSummary = {
            strategyId: 'existing-stop-take-draft',
            strategyKind: 'stop_take',
            state: 'draft',
            definitionHash: `sha256:${'1'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 11,
            revision: 1,
        } as const;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/risk/policy')) {
                return jsonResponse({
                    schemaVersion:
                        'smart-order-runtime-risk-policy-view/2026-08-14.1',
                    state: 'missing',
                    revision: null,
                    policyHash: null,
                    policy: null,
                    exposureHeadsCurrent: false,
                    brokerWriteAuthority: false,
                    accountIdentifiersExposed: false,
                    identityIdentifiersExposed: false,
                });
            }
            if (
                pathname.endsWith('/v1/strategies/existing-stop-take-draft')
            ) {
                return jsonResponse({
                    strategy: { ...draftSummary, definition },
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [draftSummary],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '處理中')
                ?.click(),
        );
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '繼續設定')
                ?.click(),
        );
        await settleEffects();

        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain(
            'Runtime 在確認時，以已完成日 K 的 Wilder ATR(14) 取得',
        );
        expect(
            dialog?.querySelector('input[aria-label="停損固定 ATR 值"]'),
        ).toBeNull();
        expect(
            dialog?.querySelector(
                'input[aria-label="停損ATR snapshot revision"]',
            ),
        ).toBeNull();
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="停損ATR 倍數"]',
            )?.value,
        ).toBe('2');
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="停利ATR 倍數"]',
            )?.value,
        ).toBe('2');
    });

    it('invalidates a reviewed draft after an editable canonical field changes', async () => {
        const definition = canonicalQuickDraft();
        const draftSummary = {
            strategyId: 'draft-review',
            strategyKind: 'quick',
            state: 'draft',
            definitionHash: `sha256:${'7'.repeat(64)}`,
            accountBound: false,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 11,
            revision: 2,
        } as const;
        let currentRevision = 2;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (
                pathname.endsWith(
                    '/v1/strategies/draft-review/confirmation-preview',
                ) &&
                init?.method === 'POST'
            ) {
                return jsonResponse({
                    result: canonicalQuickConfirmation(
                        'previewed',
                        undefined,
                        'draft-review',
                        currentRevision,
                    ),
                    resultHash: `sha256:${'8'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }
            if (
                pathname.endsWith('/v1/strategies/draft-review') &&
                init?.method === 'PUT'
            ) {
                const body = JSON.parse(String(init.body)) as {
                    draft: unknown;
                };
                currentRevision += 1;
                return jsonResponse({
                    result: {
                        ...draftSummary,
                        definition: body.draft,
                        definitionHash: `sha256:${'2'.repeat(64)}`,
                        updatedAtEpochMs: 12,
                        revision: currentRevision,
                    },
                    resultHash: `sha256:${'3'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }
            if (
                pathname.endsWith('/v1/strategies/draft-review') &&
                (init?.method ?? 'GET') === 'GET'
            ) {
                return jsonResponse({
                    strategy: { ...draftSummary, definition },
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [draftSummary],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>('#smart-order-tab-processing')
                ?.click(),
        );
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '繼續設定')
                ?.click(),
        );
        await settleEffects();

        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        await act(async () =>
            [...(dialog?.querySelectorAll('button') ?? [])]
                .find((button) => button.textContent === '下一步')
                ?.click(),
        );
        await settleEffects();
        await act(async () =>
            [...(dialog?.querySelectorAll('button') ?? [])]
                .find((button) => button.textContent === '下一步')
                ?.click(),
        );
        await settleEffects();
        expect(dialog?.textContent).toContain('Runtime canonical confirmation');
        const reviewedSave = [...(dialog?.querySelectorAll('button') ?? [])].find(
            (button) =>
                button.textContent === '接受 Runtime canonical confirmation',
        );
        expect(reviewedSave?.disabled).toBe(false);

        await act(async () =>
            [...(dialog?.querySelectorAll('button') ?? [])]
                .find((button) => button.textContent === '上一步')
                ?.click(),
        );
        const lots = dialog?.querySelector<HTMLInputElement>(
            'input[aria-label="委託張數 CommonLot"]',
        );
        expect(lots).not.toBeNull();
        await act(async () => {
            if (!lots) return;
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            )?.set;
            setter?.call(lots, '2');
            lots.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(dialog?.textContent).toContain('先前的草稿確認摘要已失效');
        expect(
            dialog?.querySelector<HTMLInputElement>(
                'input[aria-label="委託股數 Share"]',
            )?.value,
        ).toBe('2000');

        await act(async () =>
            [...(dialog?.querySelectorAll('button') ?? [])]
                .find((button) => button.textContent === '下一步')
                ?.click(),
        );
        await settleEffects();
        expect(dialog?.textContent).not.toContain(
            '先前的草稿確認摘要已失效',
        );
        expect(
            [...(dialog?.querySelectorAll('button') ?? [])].find(
                (button) =>
                    button.textContent ===
                    '接受 Runtime canonical confirmation',
            )?.disabled,
        ).toBe(false);
    });

    it('uses the Runtime nested activity projection for processing state details', async () => {
        const emptyComponent = { state: null, count: 0 };
        const strategy = {
            strategyId: 'strategy-unknown',
            strategyKind: 'quick',
            state: 'monitoring',
            definitionHash: `sha256:${'4'.repeat(64)}`,
            accountBound: true,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 12,
            revision: 1,
            activity: {
                schemaVersion: 'smart-order-active-activity/2026-08-13.3',
                displayState: 'unknown',
                activations: { state: 'dispatching', count: 1 },
                intents: { state: 'unknown', count: 1 },
                brokerOrders: { state: 'submitted', count: 1 },
                protectionCommitments: emptyComponent,
                protectionObligations: {
                    state: 'partially_exited',
                    count: 1,
                },
                entryExposureReservations: {
                    state: 'unknown',
                    count: 1,
                },
                exitClaims: emptyComponent,
                resolutionCases: emptyComponent,
                safetyBlockers: emptyComponent,
                formalProtection: {
                    schemaVersion:
                        'smart-order-formal-protection-view/2026-08-13.1',
                    state: 'pending_saved_high',
                    cumulativeFilledShares: 200,
                    asOfEpochMs: 1_786_377_600_250,
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
                            type: 'trailing_activation',
                            comparator: 'gte',
                            triggerState: 'formal',
                            triggerBasis: 'weighted_average_fill',
                            estimatedTriggerPrice: {
                                numeratorMinorUnits: '10300',
                                denominator: '1',
                            },
                            formalTriggerPrice: {
                                numeratorMinorUnits: '10403',
                                denominator: '1',
                            },
                            differsFromEstimate: true,
                        },
                        {
                            type: 'trailing_retracement',
                            comparator: 'lte',
                            triggerState: 'pending_saved_high',
                            triggerBasis: 'durable_saved_high',
                            estimatedTriggerPrice: null,
                            formalTriggerPrice: null,
                            differsFromEstimate: null,
                        },
                    ],
                    accountIdentifiersExposed: false,
                    entityIdentifiersExposed: false,
                },
                hasRuntimeTrackedUnprotectedRemainder: true,
                runtimeTrackedUnprotectedRemainder: {
                    state: 'last_known',
                    lastKnownShares: 750,
                    asOfEpochMs: 1_786_377_600_250,
                    current: false,
                },
                hasUnknownExitClaim: false,
                accountIdentifiersExposed: false,
                entityIdentifiersExposed: false,
            },
        };
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [strategy],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        const processingTab = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '處理中',
        );
        await act(async () => processingTab?.click());

        expect(host.textContent).toContain('結果未知');
        expect(host.textContent).toContain('策略外層：監控中');
        expect(host.textContent).toContain('Intent');
        expect(host.textContent).toContain('Broker');
        expect(host.textContent).toContain('已委託・未成交 × 1');
        expect(host.textContent).toContain('部分出場 × 1');
        expect(host.textContent).toContain('目前未受保護量：未知');
        expect(host.textContent).toContain('最後已知 750 股');
        expect(host.textContent).toContain('as-of');
        expect(host.textContent).toContain('券商官方委託與部位人工核對');
        expect(host.textContent).toContain('正式保護 · 實際成交 200 股');
        expect(host.textContent).toContain('估算基準 100 → 正式成交均價 101');
        expect(host.textContent).toContain('估算 103 → 正式 104.03');
        expect(host.textContent).toContain('已依成交均價重算');
        expect(host.textContent).toContain('正式觸發價待 Runtime 持久化 saved high');
        expect(
            [...host.querySelectorAll('button')].some(
                (button) => button.textContent === '準備取消券商委託',
            ),
        ).toBe(true);
        expect(
            [...host.querySelectorAll('button')].some(
                (button) => button.textContent === '取消策略',
            ),
        ).toBe(true);
        expect(host.querySelector('[aria-label="正式保護投影"]')).not.toBeNull();
        expect(
            host.querySelector('[aria-label="未受保護數量目前未知"]'),
        ).not.toBeNull();
        expect(host.textContent).not.toContain('account-A');
        expect(host.textContent).not.toContain('intent-1');
    });

    it('shows the reason-specific manual matrix and applies unique final evidence without a broker route', async () => {
        const emptyComponent = { state: null, count: 0 };
        const strategy = {
            strategyId: 'strategy-manual-final',
            strategyKind: 'quick',
            state: 'manual_intervention',
            definitionHash: `sha256:${'5'.repeat(64)}`,
            accountBound: true,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 12,
            revision: 4,
            activity: {
                schemaVersion: 'smart-order-active-activity/2026-08-13.3',
                displayState: 'manual_intervention',
                activations: { state: 'unknown', count: 1 },
                intents: { state: 'unknown', count: 1 },
                brokerOrders: { state: 'filled', count: 1 },
                protectionCommitments: emptyComponent,
                protectionObligations: emptyComponent,
                entryExposureReservations: emptyComponent,
                exitClaims: emptyComponent,
                resolutionCases: { state: 'open', count: 1 },
                safetyBlockers: { state: 'open', count: 1 },
                formalProtection: null,
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
            },
        };
        const resolutionKey = `sha256:${'1'.repeat(64)}`;
        const mutationCalls: Array<{
            pathname: string;
            body: Record<string, unknown>;
        }> = [];
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
                if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
                if (pathname.endsWith('/v1/readiness')) {
                    return jsonResponse(readinessResponse());
                }
                if (pathname.endsWith('/v1/history')) return historyResponse();
                if (pathname.endsWith('/v1/risk/policy')) {
                    return jsonResponse({
                        schemaVersion:
                            'smart-order-runtime-risk-policy-view/2026-08-14.1',
                        state: 'missing',
                        revision: null,
                        policyHash: null,
                        policy: null,
                        exposureHeadsCurrent: false,
                        brokerWriteAuthority: false,
                        accountIdentifiersExposed: false,
                        identityIdentifiersExposed: false,
                    });
                }
                if (pathname.endsWith('/v1/strategies')) {
                    return jsonResponse({
                        strategies: [strategy],
                        source: 'runtime_snapshot',
                        accountIdentifiersExposed: false,
                    });
                }
                if (
                    pathname.endsWith(
                        '/v1/strategies/strategy-manual-final/resolutions',
                    )
                ) {
                    return jsonResponse({
                        schemaVersion:
                            'smart-order-manual-resolution-list/2026-08-20.1',
                        policySchemaVersion:
                            'smart-order-manual-resolution/2026-08-11.6',
                        strategyId: 'strategy-manual-final',
                        strategyRevision: 4,
                        strategyState: 'manual_intervention',
                        cases: [
                            {
                                resolutionKey,
                                reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                                caseRevision: 0,
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
                                updatedAtEpochMs: 1_786_380_000_100,
                                accountIdentifiersExposed: false,
                                entityIdentifiersExposed: false,
                                brokerWriteAuthority: false,
                            },
                        ],
                        genericResumeAllowed: false,
                        brokerWriteAuthority: false,
                    });
                }
                if (
                    pathname.endsWith(
                        '/v1/strategies/strategy-manual-final/resolve-final',
                    )
                ) {
                    mutationCalls.push({
                        pathname,
                        body: JSON.parse(String(init?.body)) as Record<
                            string,
                            unknown
                        >,
                    });
                    return jsonResponse({
                        result: {
                            schemaVersion:
                                'smart-order-manual-resolution-result/2026-08-20.1',
                            strategyId: 'strategy-manual-final',
                            strategyState: 'paused',
                            strategyRevision: 5,
                            resolutionState: 'resolved',
                            resolutionRevision: 1,
                            uniqueFinalEvidenceHash: `sha256:${'3'.repeat(64)}`,
                            originalIntentState: 'terminal',
                            originalIntentRedispatchAllowed: false,
                            safetyBlockerCount: 1,
                            rearmSupersededCount: 0,
                            brokerWriteAttempted: false,
                            brokerAuthorityGranted: false,
                        },
                        resultHash: `sha256:${'4'.repeat(64)}`,
                        brokerWriteAttempted: false,
                    });
                }
                throw new Error(`unexpected request ${pathname}`);
            },
        );

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await settleEffects();
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '處理中')
                ?.click(),
        );

        expect(host.textContent).toContain('BROKER_OUTCOME_UNKNOWN');
        expect(host.textContent).toContain(
            'broker_full_orders_trades_deals',
        );
        expect(host.textContent).toContain('generic resume 永久禁止');
        expect(host.textContent).toContain('原 intent 永不重送');
        expect(
            [...host.querySelectorAll('button')].find(
                (button) => button.textContent === '複製為草稿',
            )?.disabled,
        ).toBe(true);
        const applyButton = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '套用唯一 final evidence',
        );
        expect(applyButton).not.toBeUndefined();
        await act(async () => applyButton?.click());
        await settleEffects();
        await settleEffects();

        expect(window.confirm).toHaveBeenCalledTimes(1);
        expect(mutationCalls).toHaveLength(1);
        expect(mutationCalls[0]).toMatchObject({
            pathname:
                '/__smart-orders/v1/strategies/strategy-manual-final/resolve-final',
            body: {
                expectedRevision: 4,
                resolutionKey,
                userAcknowledgedFinalEvidence: true,
            },
        });
        expect(mutationCalls[0]?.body.operationId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });

    it('keeps local prepared drain and two-confirmation relinquishment as separate zero-broker actions', async () => {
        const emptyComponent = { state: null, count: 0 };
        const activity = {
            schemaVersion: 'smart-order-active-activity/2026-08-13.3',
            displayState: 'manual_intervention',
            activations: emptyComponent,
            intents: { state: 'unknown', count: 1 },
            brokerOrders: { state: 'submitted', count: 1 },
            protectionCommitments: emptyComponent,
            protectionObligations: { state: 'safety_blocked', count: 1 },
            entryExposureReservations: emptyComponent,
            exitClaims: { state: 'unknown', count: 1 },
            resolutionCases: { state: 'open', count: 1 },
            safetyBlockers: emptyComponent,
            formalProtection: null,
            hasRuntimeTrackedUnprotectedRemainder: true,
            runtimeTrackedUnprotectedRemainder: {
                state: 'last_known',
                lastKnownShares: 200,
                asOfEpochMs: 1_786_377_600_250,
                current: false,
            },
            hasUnknownExitClaim: true,
            accountIdentifiersExposed: false,
            entityIdentifiersExposed: false,
        };
        const strategies = [
            {
                strategyId: 'strategy-local-drain',
                strategyKind: 'quick',
                state: 'cancel_pending',
                definitionHash: `sha256:${'6'.repeat(64)}`,
                accountBound: true,
                createdAtEpochMs: 10,
                updatedAtEpochMs: 12,
                revision: 1,
                activity: {
                    ...activity,
                    displayState: 'prepared',
                    intents: { state: 'prepared', count: 1 },
                    brokerOrders: emptyComponent,
                    protectionObligations: emptyComponent,
                    exitClaims: emptyComponent,
                    resolutionCases: emptyComponent,
                    hasRuntimeTrackedUnprotectedRemainder: false,
                    runtimeTrackedUnprotectedRemainder: {
                        state: 'none',
                        lastKnownShares: 0,
                        asOfEpochMs: null,
                        current: false,
                    },
                    hasUnknownExitClaim: false,
                },
            },
            {
                strategyId: 'strategy-relinquish',
                strategyKind: 'trailing_exit',
                state: 'manual_intervention',
                definitionHash: `sha256:${'7'.repeat(64)}`,
                accountBound: true,
                createdAtEpochMs: 10,
                updatedAtEpochMs: 12,
                revision: 3,
                activity,
            },
        ];
        const mutationPaths: string[] = [];
        let prepareOperationId: string | null = null;
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            async (input, init) => {
                const pathname = new URL(String(input), window.location.origin)
                    .pathname;
            if (pathname.endsWith('/v1/csrf-token')) return csrfResponse();
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies,
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            if (
                pathname.endsWith(
                    '/v1/strategies/strategy-relinquish/resolutions',
                )
            ) {
                return jsonResponse({
                    schemaVersion:
                        'smart-order-manual-resolution-list/2026-08-20.1',
                    policySchemaVersion:
                        'smart-order-manual-resolution/2026-08-11.6',
                    strategyId: 'strategy-relinquish',
                    strategyRevision: 3,
                    strategyState: 'manual_intervention',
                    cases: [
                        {
                            resolutionKey: `sha256:${'e'.repeat(64)}`,
                            reasonCode: 'PROTECTION_UNPROTECTED_REMAINDER',
                            caseRevision: 0,
                            state: 'open',
                            requiredEvidence: [
                                'broker_position_and_working_set',
                                'protection_obligation_and_exit_claim',
                            ],
                            allowedOperations: [
                                'break_glass_relinquish',
                                'remain_open',
                            ],
                            executableOperations: [
                                'break_glass_relinquish',
                                'remain_open',
                            ],
                            uniqueFinalReady: false,
                            breakGlassAllowed: true,
                            oldIntentDisposition: 'never_resend',
                            updatedAtEpochMs: 1_786_377_600_250,
                            accountIdentifiersExposed: false,
                            entityIdentifiersExposed: false,
                            brokerWriteAuthority: false,
                        },
                    ],
                    genericResumeAllowed: false,
                    brokerWriteAuthority: false,
                });
            }
            if (pathname.endsWith('/v1/risk/policy')) {
                return jsonResponse({
                    schemaVersion:
                        'smart-order-runtime-risk-policy-view/2026-08-14.1',
                    state: 'missing',
                    revision: null,
                    policyHash: null,
                    policy: null,
                    exposureHeadsCurrent: false,
                    brokerWriteAuthority: false,
                    accountIdentifiersExposed: false,
                    identityIdentifiersExposed: false,
                });
            }
            mutationPaths.push(pathname);
            if (pathname.endsWith('/drain-prepared')) {
                return jsonResponse({
                    result: {
                        schemaVersion:
                            'smart-order-prepared-intent-drain-result/2026-08-13.1',
                        strategyId: 'strategy-local-drain',
                        strategyState: 'cancelled',
                        strategyRevision: 2,
                        preparedIntentState: 'cancelled_proven_unsent',
                        activationState: 'cancelled',
                        reservationReleased: true,
                        protectionReleased: false,
                        exitClaimReleased: false,
                        rearmSuperseded: false,
                        userAuthorityConsumed: true,
                        brokerWriteAttempted: false,
                        brokerAuthorityGranted: false,
                        replayed: false,
                    },
                    resultHash: `sha256:${'8'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }
            if (pathname.endsWith('/relinquish-protection-prepare')) {
                const requestBody = JSON.parse(String(init?.body)) as {
                    operationId: string;
                };
                prepareOperationId = requestBody.operationId;
                return jsonResponse({
                    result: {
                        schemaVersion:
                            'smart-order-protection-relinquishment-challenge/2026-08-13.1',
                        challengeId: requestBody.operationId,
                        challengeEvidenceHash: `sha256:${'9'.repeat(64)}`,
                        strategyId: 'strategy-relinquish',
                        strategyRevision: 3,
                        handoffSnapshotHash: `sha256:${'a'.repeat(64)}`,
                        unmonitoredAuditHash: `sha256:${'b'.repeat(64)}`,
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
                    resultHash: `sha256:${'c'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }
            if (pathname.endsWith('/relinquish-protection-commit')) {
                return jsonResponse({
                    result: {
                        schemaVersion:
                            'smart-order-protection-relinquishment-result/2026-08-13.1',
                        strategyId: 'strategy-relinquish',
                        strategyState: 'manual_intervention',
                        strategyRevision: 3,
                        handoffSnapshotHash: `sha256:${'a'.repeat(64)}`,
                        unmonitoredAuditHash: `sha256:${'b'.repeat(64)}`,
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
                    resultHash: `sha256:${'d'.repeat(64)}`,
                    brokerWriteAttempted: false,
                });
            }
                throw new Error(`unexpected request ${pathname}`);
            },
        );

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '處理中')
                ?.click(),
        );
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find(
                    (button) =>
                        button.textContent === '本機取消未送出意圖',
                )
                ?.click(),
        );
        await settleEffects();
        const firstRelinquish = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '準備人工接手保護',
        );
        await act(async () => firstRelinquish?.click());
        await settleEffects();
        expect(typeof prepareOperationId).toBe('string');
        expect(host.textContent).toContain('第二次確認人工接手');
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find(
                    (button) => button.textContent === '第二次確認人工接手',
                )
                ?.click(),
        );
        await settleEffects();
        expect(mutationPaths).toEqual([
            '/__smart-orders/v1/strategies/strategy-local-drain/drain-prepared',
            '/__smart-orders/v1/strategies/strategy-relinquish/relinquish-protection-prepare',
            '/__smart-orders/v1/strategies/strategy-relinquish/relinquish-protection-commit',
        ]);
        expect(window.confirm).toHaveBeenCalledTimes(3);
    });

    it('downgrades a retained zero-remainder monitoring snapshot to current unknown when Runtime goes offline', async () => {
        const emptyComponent = { state: null, count: 0 };
        const strategy = {
            strategyId: 'strategy-stale-monitoring',
            strategyKind: 'quick',
            state: 'monitoring',
            definitionHash: `sha256:${'5'.repeat(64)}`,
            accountBound: true,
            createdAtEpochMs: 10,
            updatedAtEpochMs: 1_786_377_600_250,
            revision: 2,
            activity: {
                schemaVersion: 'smart-order-active-activity/2026-08-13.3',
                displayState: 'monitoring',
                activations: emptyComponent,
                intents: emptyComponent,
                brokerOrders: emptyComponent,
                protectionCommitments: emptyComponent,
                protectionObligations: { state: 'monitoring', count: 1 },
                entryExposureReservations: emptyComponent,
                exitClaims: { state: 'monitoring_reserved', count: 1 },
                resolutionCases: emptyComponent,
                safetyBlockers: emptyComponent,
                formalProtection: null,
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
            },
        };
        let offline = false;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            if (offline) throw new TypeError('runtime offline');
            const pathname = new URL(String(input), window.location.origin)
                .pathname;
            if (pathname.endsWith('/v1/readiness')) {
                return jsonResponse(readinessResponse());
            }
            if (pathname.endsWith('/v1/history')) return historyResponse();
            if (pathname.endsWith('/v1/strategies')) {
                return jsonResponse({
                    strategies: [strategy],
                    source: 'runtime_snapshot',
                    accountIdentifiersExposed: false,
                });
            }
            throw new Error(`unexpected request ${pathname}`);
        });

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(SmartOrderPanel, { contract: null }));
        });
        await settleEffects();
        expect(host.textContent).toContain('監控中');

        offline = true;
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>('#smart-order-tab-history')
                ?.click(),
        );
        await act(async () =>
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '重新整理歷程')
                ?.click(),
        );
        await settleEffects();
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>('#smart-order-tab-processing')
                ?.click(),
        );

        const stale = host.querySelector('[aria-label="策略目前狀態未知"]');
        expect(stale).not.toBeNull();
        expect(stale?.textContent).toContain('目前 Runtime 狀態：未知');
        expect(stale?.textContent).toContain('最後成功快照：監控中');
        expect(stale?.textContent).toContain('last-known');
        expect(stale?.textContent).toContain('0');
        expect(host.textContent).toContain('結果未知');
        expect(
            host.querySelector('[aria-label="正式保護投影目前未知"]'),
        ).not.toBeNull();
        expect(
            host.querySelector(
                '[aria-label="Runtime 最後成功快照處理狀態，非 current"]',
            )?.textContent,
        ).toContain('最後成功快照，非 current');
    });
});
