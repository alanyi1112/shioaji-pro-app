import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../lib/types/contract';
import type { Account } from '../lib/types/portfolio';

const mocks = vi.hoisted(() => ({
    live: false,
    placeStockOrder: vi.fn(),
    previewProtectedEntry: vi.fn(),
    acceptProtectedEntry: vi.fn(),
    selectedStock: {
        account_type: 'S',
        broker_id: 'MASKED',
        account_id: 'MASKED',
        person_id: 'MASKED',
        username: 'MASKED',
        signed: true,
    } as Account | null,
}));

vi.mock('../hooks/use-stream', () => ({
    useQuote: () => undefined,
    useTradingLive: () => mocks.live,
}));
vi.mock('../lib/account-store', () => ({
    accountFor: () => undefined,
    useAccounts: () => ({
        accounts: [{
            account_type: 'S',
            broker_id: 'MASKED',
            account_id: 'MASKED',
            person_id: 'MASKED',
            username: 'MASKED',
            signed: true,
        }],
        selectedStock: mocks.selectedStock,
        selectedFutures: null,
        loaded: true,
    }),
}));
vi.mock('../lib/price-sync', () => ({ usePickedPrice: () => null }));
vi.mock('../lib/privacy', () => ({
    maskAccountId: (value: string) => value,
    maskName: (value: string) => value,
    usePrivacyMode: () => false,
}));
vi.mock('../lib/shioaji', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/shioaji')>()),
    placeStockOrder: mocks.placeStockOrder,
    placeFuturesOrder: vi.fn(),
}));
vi.mock('../lib/smart-order-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/smart-order-client')>()),
    previewSmartOrderProtectedEntryConfirmation:
        mocks.previewProtectedEntry,
    acceptSmartOrderProtectedEntryConfirmation:
        mocks.acceptProtectedEntry,
}));

const { OrderTicket } = await import('./order-ticket');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function contract(securityType: 'STK' | 'FUT'): ContractInfo {
    return {
        exchange: securityType === 'STK' ? 'TSE' : 'TAIFEX',
        code: securityType === 'STK' ? '2330' : 'TXF',
        security_type: securityType,
        target_code: null,
        name: securityType === 'STK' ? '台積電' : '臺股期貨',
        currency: 'TWD',
        limit_up: 1_100,
        limit_down: 900,
        reference: 1_000,
        day_trade: 'Yes',
        update_date: '2026-08-11',
        category: securityType === 'STK' ? '24' : '期貨',
        margin_trading_balance: 0,
        short_selling_balance: 0,
    };
}

function protectedEntryView(state: 'previewed' | 'accepted') {
    return {
        schemaVersion:
            'smart-order-protected-entry-confirmation/2026-08-20.1',
        state,
        snapshotHash: `sha256:${'9'.repeat(64)}`,
        confirmationId: '123e4567-e89b-42d3-a456-426614174501',
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
            limitPrice: '1000',
            timeInForce: 'ROD',
        },
        protection: {
            family: 'fixed',
            legs: [
                {
                    comparator: 'lte',
                    distance: { kind: 'absolute', value: '10' },
                    execution: {
                        priceType: 'LMT',
                        limitPrice: '1000',
                        timeInForce: 'ROD',
                    },
                    legId: 'stop',
                    type: 'stop',
                },
            ],
        },
        fixedAtrSnapshot: null,
        previewBasis: {
            source: 'entry_limit_estimate',
            priceDecimal: '1000',
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
    } as const;
}

describe('order-ticket price type labels', () => {
    let root: Root | null = null;

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
        document.body.replaceChildren();
        mocks.live = false;
        mocks.placeStockOrder.mockReset();
        mocks.previewProtectedEntry.mockReset();
        mocks.acceptProtectedEntry.mockReset();
        mocks.previewProtectedEntry.mockResolvedValue(
            protectedEntryView('previewed'),
        );
        mocks.acceptProtectedEntry.mockResolvedValue(
            protectedEntryView('accepted'),
        );
        mocks.selectedStock = {
            account_type: 'S',
            broker_id: 'MASKED',
            account_id: 'MASKED',
            person_id: 'MASKED',
            username: 'MASKED',
            signed: true,
        };
    });

    it.each([
        ['STK', ['限價單', '市價單']],
        ['FUT', ['限價單', '市價單', '範圍市價']],
    ] as const)('renders canonical %s choices with Chinese labels', async (
        securityType,
        labels,
    ) => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: contract(securityType),
                    onPlaced: vi.fn(),
                }),
            );
        });

        const buttons = [...host.querySelectorAll('button')];
        for (const label of labels) {
            expect(
                buttons.some((button) => button.textContent === label),
            ).toBe(true);
        }
        expect(
            buttons.some((button) => ['LMT', 'MKT', 'MKP'].includes(
                button.textContent ?? '',
            )),
        ).toBe(false);

        const legacyBracket = buttons.find(
            (button) => button.textContent === '已停用：請用智慧下單',
        );
        expect(legacyBracket).toBeDefined();
        expect(legacyBracket?.disabled).toBe(true);
        expect(legacyBracket?.title).toContain('已停用');
        expect(host.textContent).toContain(
            '此下單面板不會建立停損／停利保護',
        );
        expect(host.textContent).not.toContain('成交後自動掛保護');
    });

    it('renders fixed/trailing protection settings and routes protected entry only to Runtime', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: contract('STK'),
                    onPlaced: vi.fn(),
                }),
            );
        });

        expect(host.textContent).toContain('自動保護（Runtime）');
        expect(host.textContent).toContain('本機監控・非券商雲端');
        const addProtection = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '加入保護',
        );
        expect(addProtection?.disabled).toBe(false);
        await act(async () => addProtection?.click());

        expect(host.textContent).toContain('固定保護');
        expect(host.textContent).toContain('移動出場');
        expect(host.textContent).toContain('理論');
        expect(host.textContent).toContain('合法 tick');
        expect(host.textContent).toContain('觸發 <=');
        expect(host.textContent).toContain('觸發 >=');
        expect(host.textContent).toContain('正式值依 broker 成交均價重算');
        expect(host.textContent).toContain('browser 不會直送 broker');
        const submit = [...host.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('建立 Runtime canonical confirmation'),
        );
        expect(submit?.disabled).toBe(true);
        expect(mocks.placeStockOrder).not.toHaveBeenCalled();
    });

    it('supports keyboard focus and ARIA relationships for fixed/trailing tabs', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: contract('STK'),
                    onPlaced: vi.fn(),
                }),
            );
        });
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '加入保護')
                ?.click();
        });
        const [fixed, trailing] = [...host.querySelectorAll<HTMLButtonElement>(
            '[role="tab"]',
        )];
        if (!fixed || !trailing) throw new Error('protection tabs were not rendered');
        expect(fixed.textContent).toBe('固定保護');
        expect(trailing.textContent).toBe('移動出場');
        expect(fixed.getAttribute('aria-selected')).toBe('true');
        expect(fixed.tabIndex).toBe(0);
        expect(trailing.tabIndex).toBe(-1);

        fixed.focus();
        await act(async () => {
            fixed.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                }),
            );
        });
        expect(document.activeElement).toBe(trailing);
        expect(trailing.getAttribute('aria-selected')).toBe('true');
        const panel = host.querySelector('[role="tabpanel"]');
        expect(panel?.id).toBe(trailing.getAttribute('aria-controls'));
        expect(panel?.getAttribute('aria-labelledby')).toBe(trailing.id);
        expect(host.textContent).toContain('啟動門檻');
        expect(host.textContent).toContain('回撤距離');
        expect(host.textContent).toContain('saved high');
        expect(host.textContent).toContain('不以 entry basis 冒充');
        expect(
            host.querySelector('select[aria-label="啟動門檻距離模式"]'),
        ).not.toBeNull();
        expect(
            host.querySelector('select[aria-label="回撤距離模式"]'),
        ).not.toBeNull();
        const fixedStop = [...host.querySelectorAll('label')].find((label) =>
            label.textContent?.includes('另設固定停損'),
        )?.querySelector('input');
        await act(async () => fixedStop?.click());
        expect(host.querySelector('input[aria-label="固定停損保護值"]')).not.toBeNull();
    });

    it('keeps a long validation error visible and the primary action outside the scroll region', async () => {
        const host = document.createElement('div');
        host.style.width = '260px';
        host.style.height = '360px';
        host.style.overflow = 'hidden';
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: contract('STK'),
                    onPlaced: vi.fn(),
                }),
            );
        });
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '加入保護')
                ?.click();
        });
        const stop = host.querySelector(
            'input[aria-label="停損保護值"]',
        ) as HTMLInputElement;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            )?.set;
            setter?.call(stop, '123456789012345678901234567890');
            stop.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const error = host.querySelector('[role="alert"]');
        expect(error?.textContent).toContain('保護輸入無效');
        const settings = host.querySelector('[role="tabpanel"]')?.parentElement;
        const submit = [...host.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('建立 Runtime canonical confirmation'),
        );
        expect(settings?.contains(submit ?? null)).toBe(false);
        expect(submit?.disabled).toBe(true);
        const ticket = host.firstElementChild as HTMLElement;
        expect(getComputedStyle(ticket).overflowY).toBe('auto');
        expect(getComputedStyle(settings as HTMLElement).overflowY).toBe('auto');
        expect(getComputedStyle(submit as HTMLElement).position).toBe('sticky');
        expect(submit?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            ticket.getBoundingClientRect().bottom + 1,
        );
    });

    it('supports price, percentage and ATR controls with visible validation', async () => {
        mocks.live = true;
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: contract('STK'),
                    onPlaced: vi.fn(),
                }),
            );
        });
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '加入保護')
                ?.click();
        });
        const mode = host.querySelector(
            'select[aria-label="保護距離模式"]',
        ) as HTMLSelectElement;
        expect([...mode.options].map((option) => option.textContent)).toEqual([
            '價位',
            '百分比',
            'ATR',
        ]);
        await act(async () => {
            mode.value = 'atr';
            mode.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(host.querySelector('input[aria-label="固定 ATR 預覽值"]')).not.toBeNull();
        expect(host.textContent).toContain('上一完成交易日快照');
        const submit = [...host.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('建立 Runtime canonical confirmation'),
        );
        await act(async () => submit?.click());
        expect(host.textContent).toContain('Runtime 尚無可信固定快照');
        expect(mocks.previewProtectedEntry).not.toHaveBeenCalled();
        expect(mocks.acceptProtectedEntry).not.toHaveBeenCalled();
        expect(mocks.placeStockOrder).not.toHaveBeenCalled();

        const stop = host.querySelector(
            'input[aria-label="停損保護值"]',
        ) as HTMLInputElement;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            )?.set;
            setter?.call(stop, 'NaN');
            stop.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(host.textContent).toContain('保護輸入無效');
    });

    it('shows an explicit unsupported reason for futures rather than a protection control', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: contract('FUT'),
                    onPlaced: vi.fn(),
                }),
            );
        });
        expect(host.textContent).toContain('不支援：只支援 TSE／OTC 現股股票與 ETF');
        const addProtection = [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '加入保護',
        );
        expect(addProtection?.disabled).toBe(true);
    });

    it('shows protection as eligible for a canonical OTC Cash Common ETF', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: {
                        ...contract('STK'),
                        exchange: 'OTC',
                        code: '00679B',
                        name: '元大美債20年',
                        category: '00',
                    },
                    onPlaced: vi.fn(),
                }),
            );
        });
        expect(host.textContent).toContain(
            '自動保護適用：TSE／OTC・Cash・Common・現股多單',
        );
        expect(
            [...host.querySelectorAll('button')].find(
                (button) => button.textContent === '加入保護',
            )?.disabled,
        ).toBe(false);
    });

    it('disables automatic protection for sell, odd-lot and missing fixed-account scopes', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const render = () =>
            createElement(OrderTicket, {
                contract: contract('STK'),
                onPlaced: vi.fn(),
            });
        await act(async () => root?.render(render()));

        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '賣出 Sell')
                ?.click();
        });
        expect(host.textContent).toContain(
            '不支援：第一階段只支援現股多單買進',
        );

        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '買進 Buy')
                ?.click();
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '零股')
                ?.click();
        });
        expect(host.textContent).toContain(
            '不支援：第一階段只支援整股 Common',
        );

        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '整股')
                ?.click();
        });
        mocks.selectedStock = null;
        await act(async () => root?.render(render()));
        expect(host.textContent).toContain(
            '不支援：尚未取得已簽署的固定股票帳號',
        );
        expect(mocks.placeStockOrder).not.toHaveBeenCalled();
    });

    it('fails closed when the contract category is not a canonical Shioaji category', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const ambiguous = { ...contract('STK'), category: 'ETF' };
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: ambiguous,
                    onPlaced: vi.fn(),
                }),
            );
        });
        expect(host.textContent).toContain(
            '不支援：canonical contract 價格／分類資料不完整',
        );
        expect(
            [...host.querySelectorAll('button')].find(
                (button) => button.textContent === '加入保護',
            )?.disabled,
        ).toBe(true);
    });

    it('clears protection atomically across eligible symbol changes and never calls the browser broker path', async () => {
        mocks.live = true;
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const render = (value: ContractInfo) =>
            createElement(OrderTicket, { contract: value, onPlaced: vi.fn() });
        await act(async () => root?.render(render(contract('STK'))));
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '加入保護')
                ?.click();
        });
        expect(host.textContent).toContain('已選擇保護');

        await act(async () => {
            root?.render(
                render({ ...contract('STK'), code: '2454', name: '聯發科' }),
            );
        });
        expect(host.textContent).not.toContain('已選擇保護');
        expect(host.textContent).toContain('加入保護');
        expect(mocks.placeStockOrder).not.toHaveBeenCalled();
    });

    it('previews and atomically prepares a live protected entry without calling the browser broker path', async () => {
        mocks.live = true;
        const onPlaced = vi.fn();
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(OrderTicket, {
                    contract: contract('STK'),
                    onPlaced,
                }),
            );
        });
        const priceInput = [...host.querySelectorAll<HTMLInputElement>(
            'input[inputmode="decimal"]',
        )].find((input) => !input.getAttribute('aria-label'));
        if (!priceInput) throw new Error('price input was not rendered');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            )?.set;
            setter?.call(priceInput, '1000');
            priceInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((button) => button.textContent === '加入保護')
                ?.click();
        });
        const preview = [...host.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('建立 Runtime canonical confirmation'),
        );
        expect(preview?.disabled).toBe(false);
        await act(async () => preview?.click());
        expect(mocks.previewProtectedEntry).toHaveBeenCalledTimes(1);
        expect(mocks.previewProtectedEntry).toHaveBeenCalledWith({
            confirmationRequest: expect.objectContaining({
                schemaVersion:
                    'smart-order-protected-entry-confirmation-request/2026-08-20.1',
                accountBrokerRef: 'MASKED',
                accountIdRef: 'MASKED',
                commonLots: 1,
                contractKey: 'TSE:STK:2330',
                entryOrder: {
                    priceType: 'LMT',
                    limitPrice: '1000',
                    timeInForce: 'ROD',
                },
            }),
        });
        expect(host.textContent).toContain('Runtime canonical confirmation：');
        expect(host.textContent).toContain('固定股票帳號（Runtime 已驗證）');
        expect(host.textContent).toContain('不授予 browser 或 broker write authority');

        const accept = [...host.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('確認並原子保存含保護 entry'),
        );
        await act(async () => accept?.click());
        expect(mocks.acceptProtectedEntry).toHaveBeenCalledTimes(1);
        expect(mocks.acceptProtectedEntry).toHaveBeenCalledWith({
            confirmationRequest: expect.any(Object),
            confirmationId: '123e4567-e89b-42d3-a456-426614174501',
            snapshotHash: `sha256:${'9'.repeat(64)}`,
            userAcknowledged: true,
        });
        expect(onPlaced).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain('含保護計畫已保存');
        expect(mocks.placeStockOrder).not.toHaveBeenCalled();
    });
});
