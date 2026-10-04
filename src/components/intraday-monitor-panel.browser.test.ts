import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { taipeiTradeDate } from '../lib/intraday-monitor-api';
import { darkTwClass } from '../theme.css';
import {
    IntradayMonitorPanel,
    type IntradayMonitorPanelProps,
} from './intraday-monitor-panel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    closed = false;
    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
    }
    emit(type: 'replay' | 'trigger', data: unknown, lastEventId = '') {
        const event = new MessageEvent(type, { data: JSON.stringify(data) });
        Object.defineProperty(event, 'lastEventId', { value: lastEventId });
        this.listeners.get(type)?.(event);
    }
    close() { this.closed = true; }
}

function response(body: unknown) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

function errorResponse(status: number, body: unknown) {
    return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);
}

function currentStatusMetadata(tradeDate = '2026-09-04', baselineComplete = 0) {
    return {
        approval: { approvedActiveLimit: 160, stage: 160, decision: 'go',
            reviewerType: 'codex_delegated', reviewedAt: '2026-09-16T14:00:00+08:00',
            evidenceTradeDate: '2026-09-16', historical: true },
        session: { authorityTradeDate: tradeDate, sessionTradeDate: tradeDate, phase: 'running',
            current: true, configRevision: 1, savedConfigRevision: 1,
            startedAt: `${tradeDate}T08:50:00+08:00`, updatedAt: `${tradeDate}T10:11:00+08:00`,
            staleReason: null, controlPlaneRequested: true, controlPlaneAccepted: true,
            firstKbarAt: `${tradeDate}T09:01:01+08:00` },
        baselineSummary: { complete: baselineComplete, missing: 0, stale: 0, unknown: 0,
            tradeDates: baselineComplete ? ['2026-09-03'] : [] },
        freshness: { evidenceAt: `${tradeDate}T10:11:00+08:00`, ageMs: 0,
            budgetMs: 120_000, fresh: true },
    };
}

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function trigger(eventId: string, code: string, minuteKey: string, triggerValue: number, currentValue: number, notificationAuthority = false, tradeDate = '2026-09-04') {
    return {
        eventId, eventHash: 'a'.repeat(64), kind: 'live', tradeDate, baselineTradeDate: '2026-09-03',
        canonicalSymbol: `${code}.TW`, exchange: 'TSE', minuteKey, configRevision: 1, threshold: '1.5',
        currentCumulativeVolume: triggerValue, previousCumulativeVolume: 100, unit: 'common_lot', sourceVersion: 'shioaji/1.7.1',
        formulaVersion: 'intraday-relative-volume/1', completeness: 'complete', createdAt: `${tradeDate}T${minuteKey}:00+08:00`,
        currentEvidence: { minuteKey: '10:10', currentCumulativeVolume: currentValue, previousCumulativeVolume: 100, unit: 'common_lot', completeness: 'complete', sourceVersion: 'shioaji/1.7.1', baselineProvenance: 'observed', updatedAt: `${tradeDate}T10:11:00+08:00` },
        notificationAuthority,
    };
}

function panelProps(
    overrides: Partial<IntradayMonitorPanelProps> = {},
): IntradayMonitorPanelProps {
    return {
        targets: [{ id: 'chart-1', label: 'K 線圖 1' }],
        onPick: vi.fn(async () => true),
        onOpenChart: vi.fn(() => 'chart-2'),
        onTargetChange: vi.fn(),
        onAddToWatchlist: vi.fn(async () => ({ status: 'added' as const, listId: 'intraday-list' })),
        ...overrides,
    };
}

function activeFetch(initialItems: ReturnType<typeof trigger>[] = []) {
    const today = taipeiTradeDate();
    const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
    return vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/status')) return response({
            state: 'active', reason: 'none', generation: 'generation_test_1234567890', configRevision: 1,
            ...currentStatusMetadata(today, 1),
            lease: { activeLeaseCount: 1, sessionState: 'active', acceptingEvents: true },
            capacity: { configured: 1, eligible: 1, pilotCohort: 1, dataActive: 1, active: 1, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: 11, confirmedOtherPhysicalUsage: 10, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 149, gate0EvidenceCurrent: true, globalOwnershipComplete: true },
            itemStatuses: [], observedAt: `${today}T10:11:00+08:00`,
        });
        if (url.endsWith('/config')) return response({ config: { revision: 1, globalThreshold: '1.5', items: [] } });
        if (url.includes('/results?')) return response({ generation: 'generation_test_1234567890', repositoryRevision: initialItems.length, items: initialItems, cursor: 'cursor_notification_identity_1234', nextCursor: null });
        if (url.endsWith('/diagnostics')) return response({ state: 'active', reason: 'none', ownershipRevision: 1, evidenceRevision: 1, baseline: { complete: true, tradeDate: '2026-09-03', sourceVersion: 'fixture/1', itemCount: 1 }, completedMinute: { tradeDate: today, minuteKey: '10:10', evidenceAt: `${today}T10:11:00+08:00` } });
        if (url.endsWith('/leases/acquire')) return response({ lease: { leaseId: 'lease_notification_identity_1234', clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: new Date().toISOString(), expiresAt: leaseExpiresAt } });
        if (url.endsWith('/leases/release')) return response({ ok: true });
        if (/\/api\/v1\/data\/contracts\/\d+/.test(url)) return Promise.reject(new Error('fixture deliberately omits display names'));
        throw new Error(`unexpected ${url}`);
    });
}

class FakeNotification {
    static permission: NotificationPermission = 'granted';
    static instances: FakeNotification[] = [];
    static requestPermission = vi.fn(async () => FakeNotification.permission);
    constructor(readonly title: string, readonly options?: NotificationOptions) {
        FakeNotification.instances.push(this);
    }
}

class FakeAudioContext {
    static starts = 0;
    currentTime = 0;
    destination = {};
    createOscillator() {
        return {
            type: 'sine',
            frequency: { setValueAtTime: () => undefined },
            connect: () => undefined,
            start: () => { FakeAudioContext.starts += 1; },
            stop: () => undefined,
            addEventListener: (_type: string, callback: () => void) => queueMicrotask(callback),
        };
    }
    createGain() {
        return {
            gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
            connect: () => undefined,
        };
    }
    close() { return Promise.resolve(); }
}

describe('盤中監控面板', () => {
    let root: Root | null = null;

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
        document.body.replaceChildren();
        FakeEventSource.instances = [];
        FakeNotification.instances = [];
        FakeNotification.permission = 'granted';
        FakeNotification.requestPermission.mockClear();
        FakeAudioContext.starts = 0;
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('每日名單與歷史 Stage 分開呈現，未有盤中證據不稱 data active', async () => {
        const fallback = activeFetch();
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
            if (String(input).endsWith('/daily-status')) return response({ daily: {
                mode: 'daily_plan', effectiveTradeDate: taipeiTradeDate(),
                configRevision: 10, planRevision: 9, configured: 200,
                planned: 160, waitingCapacity: 40, baselineReady: 160,
                subscriptionRequested: 0, dataActive: 0,
                degraded: null,
                pendingRevision: 10, pendingReason: 'revision_unverified',
                evidenceState: 'not_live', notificationAuthority: false,
            } });
            return fallback(input);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID')
            .mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(host.textContent).toContain('每日名單（新流程，與歷史 Stage 分開）');
        expect(host.textContent).toContain('規劃／候補160／40');
        expect(host.textContent).toContain('訂閱／資料 active0／0');
        expect(host.textContent).toContain('降級未證實');
        expect(host.textContent).toContain('待生效 revision10（revision_unverified）');
        expect(host.textContent).toContain('尚未有合法盤中資料');
    });

    it('歷史 160 GO 與今日未啟動分開呈現，保留 baseline unknown 與 reviewer provenance', async () => {
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'feature_off', reason: 'current_session_missing',
                generation: 'generation_truthful_status', configRevision: 8,
                lease: { activeLeaseCount: 0, sessionState: 'idle', acceptingEvents: false },
                capacity: { configured: 200, eligible: 200, admitted: 160, pilotCohort: 20,
                    approvedActiveLimit: 160, evaluationStageTarget: 160, evaluationState: 'go',
                    dataActive: 0, active: 0, waiting: 189, waitingGate: 149,
                    waitingPilotLimit: 40, waitingCapacity: 0, waitingBaseline: 0, degraded: 11,
                    confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null,
                    providerReleaseProven: null, confirmedHeadroom: null,
                    localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 0,
                    gate0EvidenceCurrent: false, globalOwnershipComplete: false,
                    controlPlaneSubscriptionRequested: false, notificationAuthority: false },
                approval: { approvedActiveLimit: 160, stage: 160, decision: 'go',
                    reviewerType: 'codex_delegated', reviewedAt: '2026-09-16T14:13:31+08:00',
                    evidenceTradeDate: '2026-09-16', historical: true },
                session: { authorityTradeDate: '2026-09-22', sessionTradeDate: null, phase: null,
                    current: false, configRevision: null, savedConfigRevision: 8,
                    startedAt: null, updatedAt: null, staleReason: 'current_session_missing',
                    controlPlaneRequested: false, controlPlaneAccepted: false, firstKbarAt: null },
                baselineSummary: { complete: 149, missing: 0, stale: 0, unknown: 51,
                    tradeDates: ['2026-09-15'] },
                freshness: { evidenceAt: '2026-09-16T14:13:31+08:00', ageMs: 518400000,
                    budgetMs: 0, fresh: false },
                itemStatuses: [], observedAt: '2026-09-22T09:40:50+08:00',
            });
            if (url.endsWith('/config')) return response({ config: { revision: 8,
                globalThreshold: '1.5', items: [] } });
            if (url.includes('/results?')) return response({ items: [], authority: 'unverified' });
            if (url.endsWith('/diagnostics')) return response({ state: 'idle',
                reason: 'current_session_missing', ownershipRevision: null, evidenceRevision: 0,
                baseline: { complete: false, tradeDate: null, sourceVersion: null, itemCount: 149 },
                completedMinute: { tradeDate: null, minuteKey: null, evidenceAt: null } });
            if (url.endsWith('/leases/acquire')) return errorResponse(409,
                { reason: 'current_session_missing' });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(host.textContent).toContain('核准上限160');
        expect(host.textContent).toContain('證據日期2026-09-16');
        expect(host.textContent).toContain('審閱來源Codex 代理審閱');
        expect(host.textContent).toContain('session未啟動');
        expect(host.textContent).toContain('訂閱／首筆未接受');
        expect(host.textContent).toContain('等待 pilot limit40');
        expect(host.textContent).toContain('等待基準0');
        expect(host.textContent).toContain('未知 51');
        expect(host.textContent).toContain('今日監控未啟動，沒有可驗證的當日達標結果。');
        expect(host.textContent).not.toContain('監控已啟動，目前沒有達標結果。');
        expect(host.textContent).not.toContain('人工核准');
    });

    it('在 Gate 0 關閉時清楚顯示容量、名單與可連動商品', async () => {
        const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'feature_off', reason: 'gate_evidence_missing',
                generation: 'generation_test_1234567890', configRevision: 0,
                ...currentStatusMetadata('2026-09-04'),
                lease: { activeLeaseCount: 0, sessionState: 'idle', acceptingEvents: false },
                capacity: { configured: 1, eligible: 1, pilotCohort: 1, dataActive: 0, active: 0, waiting: 1, waitingGate: 1, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 0, gate0EvidenceCurrent: false, globalOwnershipComplete: false },
                itemStatuses: [{ canonicalSymbol: '2330.TW', state: 'waiting_gate', reason: 'gate_evidence_missing', source: 'manual', enabled: true, effectiveThreshold: '2', baseline: { state: 'unknown', tradeDate: null, sourceVersion: null }, subscription: { state: 'none', physicalKey: null }, completedMinute: null, currentCumulativeVolume: null, previousCumulativeVolume: null, updatedAt: '2026-09-04T08:00:00.000Z' }],
                observedAt: '2026-09-04T08:00:00.000Z',
            });
            if (url.endsWith('/config')) return response({ config: {
                revision: 0, globalThreshold: '1.5',
                items: [{ contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null }, enabled: true, thresholdOverride: '2', source: 'manual' }],
            } });
            if (url.includes('/results?')) return response({ items: [] });
            if (url.endsWith('/leases/acquire')) return response({ lease: {
                leaseId: 'lease_identity_1234567890', clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: '2026-09-04T08:00:00.000Z', expiresAt: '2026-09-04T08:00:15.000Z',
            } });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            if (url.includes('/api/v1/data/contracts/2330/info')) return response({
                security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null,
                name: '台積電', currency: 'TWD', limit_up: 0, limit_down: 0, reference: 0, day_trade: '', update_date: '', category: '', margin_trading_balance: 0, short_selling_balance: 0,
            });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.style.width = '480px';
        host.style.height = '600px';
        document.body.append(host);
        root = createRoot(host);
        const onPick = vi.fn();
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps({
                onPick: vi.fn(async (stock, targetId) => {
                    onPick(stock, targetId);
                    return true;
                }),
            })));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(host.textContent).toContain('等待 bounded Gate');
        expect(host.textContent).toContain('安全上限維持 0');
        expect(host.textContent).toContain('監控名單 1');
        const capacitySummary = host.querySelector<HTMLElement>('[aria-label="今日監控"]')!;
        const capacityStrip = capacitySummary.querySelector<HTMLElement>('div')!;
        const capacityMetrics = [...capacityStrip.children] as HTMLElement[];
        expect(capacityMetrics).toHaveLength(13);
        expect(host.textContent).toContain('啟動來源未證實');
        const firstKbarMetric = capacityMetrics.find((metric) => metric.title.startsWith('訂閱／首筆：'))!;
        expect(firstKbarMetric.title).toContain('2026-09-04T09:01:01+08:00');
        expect(getComputedStyle(firstKbarMetric.children[1]!).textOverflow).toBe('ellipsis');
        expect(getComputedStyle(capacityMetrics[0]!).display).toBe('flex');
        expect(capacityMetrics[0]!.clientWidth).toBeGreaterThanOrEqual(capacityMetrics[0]!.scrollWidth);
        expect(capacityMetrics[0]!.getBoundingClientRect().width).toBeGreaterThan(capacityMetrics[1]!.getBoundingClientRect().width * 1.8);
        expect(Number.parseFloat(getComputedStyle(capacityMetrics[0]!.children[0]!).fontSize)).toBeGreaterThanOrEqual(11);
        expect(Number.parseFloat(getComputedStyle(capacityMetrics[0]!.children[1]!).fontSize)).toBeGreaterThanOrEqual(11.5);
        expect(Number.parseFloat(getComputedStyle(capacityMetrics[1]!.children[1]!).fontSize)).toBeGreaterThanOrEqual(13);
        expect(capacityMetrics[0]!.getBoundingClientRect().height).toBeLessThanOrEqual(30);
        expect(capacitySummary.getBoundingClientRect().height).toBeLessThanOrEqual(170);
        expect(host.textContent).toContain('provider 證據usage 未知 · other 未知 · ownership 未知 · release 未知 · headroom 未知');
        expect(capacityStrip.scrollWidth).toBeLessThanOrEqual(capacityStrip.clientWidth);
        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('監控名單'))?.click();
        });
        const importTools = [...host.querySelectorAll('details')].find((details) => details.textContent?.includes('新增／匯入商品'));
        expect(importTools?.open).toBe(false);
        const saveButton = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('儲存設定'))!;
        expect(Number.parseFloat(getComputedStyle(saveButton).fontSize)).toBeLessThanOrEqual(11);
        expect(saveButton.getBoundingClientRect().height).toBeLessThanOrEqual(28);
        expect(host.textContent).toContain('2330 · 台積電');
        expect(host.textContent).toContain('等待 bounded Gate · 門檻 2×');
        expect(host.textContent).toContain('原因：Gate 0 證據尚未完整');
        const evidence = host.querySelector<HTMLElement>('[aria-label="2330 監控狀態"]')!;
        expect(evidence.parentElement!.getBoundingClientRect().height).toBeLessThanOrEqual(66);
        expect(getComputedStyle(evidence.parentElement!).gridTemplateColumns.split(' ')).toHaveLength(4);
        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('2330'))?.click();
        });
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
            code: '2330', symbol: '2330.TW', market: 'TWSE', kind: 'ordinary',
        }), 'chart-1');
        expect(FakeEventSource.instances[0]?.url).toContain('/events?');
        expect(host.querySelector('[data-testid="intraday-monitor-panel"]')).not.toBeNull();
    });

    it('匯入只建立草稿，明確儲存遇 revision conflict 時不覆寫', async () => {
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'feature_off', reason: 'gate_evidence_missing',
                generation: 'generation_test_1234567890', configRevision: 0,
                lease: { activeLeaseCount: 0, sessionState: 'idle', acceptingEvents: false },
                capacity: { configured: 0, eligible: 0, pilotCohort: 0, dataActive: 0, active: 0, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 0, gate0EvidenceCurrent: false, globalOwnershipComplete: false },
                itemStatuses: [],
                observedAt: '2026-09-04T08:00:00.000Z',
            });
            if (url.endsWith('/config') && init?.method === 'PUT') {
                return errorResponse(409, { reason: 'revision_conflict', details: { currentRevision: 1 } });
            }
            if (url.endsWith('/config')) return response({ config: { revision: 0, globalThreshold: '1.5', items: [] } });
            if (url.includes('/results?')) return response({ items: [] });
            if (url.endsWith('/leases/acquire')) return response({ lease: {
                leaseId: 'lease_identity_1234567890', clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: '2026-09-04T08:00:00.000Z', expiresAt: '2099-09-04T08:00:15.000Z',
            } });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            if (url.includes('/api/v1/data/contracts/2454/info')) return response({
                security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2454', target_code: null,
                name: '聯發科', currency: 'TWD', limit_up: 0, limit_down: 0, reference: 0, day_trade: '', update_date: '', category: '', margin_trading_balance: 0, short_selling_balance: 0,
            });
            if (url.includes('/api/v1/data/contracts/2454')) return response({
                security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2454', target_code: null,
            });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.style.width = '620px';
        host.style.height = '800px';
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('監控名單'))?.click();
        });
        const input = host.querySelector<HTMLInputElement>('input[aria-label="單筆股票代號或股名"]')!;
        await act(async () => setInputValue(input, '2454'));
        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent === '加入草稿')?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(host.textContent).toContain('接受 1');
        expect(host.textContent).toContain('2454');
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);

        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('儲存設定（1 檔）'))?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
        expect(host.textContent).toContain('設定已被其他分頁更新');
        expect(host.textContent).toContain('重新載入設定');
    });

    it('可用繁中股名模糊搜尋，以鍵盤選定後才加入經 Shioaji 驗證的草稿', async () => {
        const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'feature_off', reason: 'gate_evidence_missing',
                generation: 'generation_test_1234567890', configRevision: 0,
                lease: { activeLeaseCount: 0, sessionState: 'idle', acceptingEvents: false },
                capacity: { configured: 0, eligible: 0, pilotCohort: 0, dataActive: 0, active: 0, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 0, gate0EvidenceCurrent: false, globalOwnershipComplete: false },
                itemStatuses: [], observedAt: '2026-09-04T08:00:00.000Z',
            });
            if (url.endsWith('/config')) return response({ config: { revision: 0, globalThreshold: '1.5', items: [] } });
            if (url.includes('/results?')) return response({ items: [] });
            if (url.endsWith('/leases/acquire')) return response({ lease: {
                leaseId: 'lease_identity_1234567890', clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: '2026-09-04T08:00:00.000Z', expiresAt: '2099-09-04T08:00:15.000Z',
            } });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            if (url.includes('127.0.0.1:5174/api/instrument-search')) return response({
                query: '元太', warnings: [], results: [
                    { symbol: '8069.TWO', localizedName: '元太', name: '元太', quoteType: 'EQUITY', score: 950, matchedBy: 'localized-exact' },
                    { symbol: '1504.TW', localizedName: '東元', name: '東元', quoteType: 'EQUITY', score: 550, matchedBy: 'fuzzy' },
                ],
            });
            if (url.includes('/api/v1/data/contracts/8069/info')) return response({
                security_type: 'STK', region: 'TW', exchange: 'OTC', code: '8069', target_code: null,
                name: '元太', currency: 'TWD', limit_up: 0, limit_down: 0, reference: 0, day_trade: '', update_date: '', category: '', margin_trading_balance: 0, short_selling_balance: 0,
            });
            if (url.includes('/api/v1/data/contracts/8069')) return response({
                security_type: 'STK', region: 'TW', exchange: 'OTC', code: '8069', target_code: null,
            });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.style.width = '620px';
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('監控名單'))?.click());
        const input = host.querySelector<HTMLInputElement>('input[aria-label="單筆股票代號或股名"]')!;
        await act(async () => {
            setInputValue(input, '元太');
            await new Promise((resolve) => setTimeout(resolve, 220));
        });
        expect(host.querySelector('[role="listbox"]')?.textContent).toContain('8069元太上櫃');
        expect(host.querySelector('[role="listbox"]')?.textContent).toContain('1504東元上市');
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(input.value).toBe('8069 元太');
        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent === '加入草稿')?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(host.textContent).toContain('8069 · 元太');
        expect(host.textContent).toContain('上櫃 · manual');
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/data/contracts/8069/info'))).toBe(true);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });

    it('可從 MultiView 我的清單選擇台股頁籤並匯入經 Shioaji 驗證的草稿', async () => {
        const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'feature_off', reason: 'gate_evidence_missing',
                generation: 'generation_test_1234567890', configRevision: 0,
                lease: { activeLeaseCount: 0, sessionState: 'idle', acceptingEvents: false },
                capacity: { configured: 0, eligible: 0, pilotCohort: 0, dataActive: 0, active: 0, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 0, gate0EvidenceCurrent: false, globalOwnershipComplete: false },
                itemStatuses: [], observedAt: '2026-09-04T08:00:00.000Z',
            });
            if (url.endsWith('/config')) return response({ config: { revision: 0, globalThreshold: '1.5', items: [] } });
            if (url.includes('/results?')) return response({ items: [] });
            if (url.endsWith('/leases/acquire')) return response({ lease: {
                leaseId: 'lease_identity_1234567890', clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: '2026-09-04T08:00:00.000Z', expiresAt: '2099-09-04T08:00:15.000Z',
            } });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            if (url.includes('127.0.0.1:5174/api/instruments?mode=read-only')) return response({
                managedTabs: [
                    { tabKey: 'personal:tracking', id: 'tracking', label: '追蹤觀察', displayLabel: '追蹤觀察', enabled: true, defaultSymbols: ['2454.TW', '8069.TWO', 'AAPL'] },
                ],
                instruments: [
                    { symbol: '2454.TW', name: '聯發科', tabId: 'tracking', tab: '追蹤觀察', enabled: true, defaultOrder: 1 },
                    { symbol: '8069.TWO', name: '元太', tabId: 'tracking', tab: '追蹤觀察', enabled: true, defaultOrder: 2 },
                    { symbol: 'AAPL', name: 'Apple', tabId: 'tracking', tab: '追蹤觀察', enabled: true, defaultOrder: 3 },
                ],
            });
            if (url.includes('/api/v1/data/contracts/2454/info')) return response({
                security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2454', target_code: null, name: '聯發科',
            });
            if (url.includes('/api/v1/data/contracts/8069/info')) return response({
                security_type: 'STK', region: 'TW', exchange: 'OTC', code: '8069', target_code: null, name: '元太',
            });
            if (url.includes('/api/v1/data/contracts/2454')) return response({ security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2454', target_code: null });
            if (url.includes('/api/v1/data/contracts/8069')) return response({ security_type: 'STK', region: 'TW', exchange: 'OTC', code: '8069', target_code: null });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.style.width = '620px';
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('監控名單'))?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const select = host.querySelector<HTMLSelectElement>('select[aria-label="選擇 MultiView 我的清單"]')!;
        expect(select.textContent).toContain('追蹤觀察（2 檔台股）');
        await act(async () => {
            select.value = 'personal:tracking';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const field = select.closest('label')!;
        await act(async () => {
            [...field.querySelectorAll('button')].find((button) => button.textContent === '匯入草稿')?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(host.textContent).toContain('接受 2：2454、8069');
        expect(host.textContent).toContain('2454 · 聯發科');
        expect(host.textContent).toContain('8069 · 元太');
        expect(host.textContent).not.toContain('AAPL ·');
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });

    it('顯示可稽核結果、目前量比並提供穩定排序', async () => {
        const rows = [trigger('event_b', '2454', '10:05', 160, 170), trigger('event_a', '2330', '10:06', 210, 220)];
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'active', reason: 'none', generation: 'generation_test_1234567890', configRevision: 1,
                ...currentStatusMetadata('2026-09-04', 2),
                lease: { activeLeaseCount: 1, sessionState: 'active', acceptingEvents: true },
                capacity: { configured: 2, eligible: 2, pilotCohort: 2, dataActive: 2, active: 2, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: 12, confirmedOtherPhysicalUsage: 10, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 148, gate0EvidenceCurrent: true, globalOwnershipComplete: true },
                itemStatuses: [], observedAt: '2026-09-04T10:11:00+08:00',
            });
            if (url.endsWith('/config')) return response({ config: { revision: 1, globalThreshold: '1.5', items: [] } });
            if (url.includes('/results?')) return response({ generation: 'generation_test_1234567890', repositoryRevision: 2, items: rows, cursor: 'cursor_identity_1234567890', nextCursor: null });
            if (url.endsWith('/diagnostics')) return response({ state: 'active', reason: 'none', ownershipRevision: 1, evidenceRevision: 2, baseline: { complete: true, tradeDate: '2026-09-03', sourceVersion: 'shioaji/1.7.1', itemCount: 2 }, completedMinute: { tradeDate: '2026-09-04', minuteKey: '10:10', evidenceAt: '2026-09-04T10:11:00+08:00' } });
            if (url.endsWith('/leases/acquire')) return response({ lease: { leaseId: 'lease_identity_1234567890', clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: '2026-09-04T10:11:00+08:00', expiresAt: '2099-09-04T10:11:15+08:00' } });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.classList.add(darkTwClass);
        document.body.append(host);
        root = createRoot(host);
        const onPick = vi.fn(async () => true);
        const onAddToWatchlist = vi.fn(async () => ({ status: 'added' as const, listId: 'intraday-list' }));
        const onTargetChange = vi.fn();
        const props = panelProps({
            targets: [
                { id: 'chart-1', label: 'K 線圖 1' },
                { id: 'chart-2', label: 'K 線圖 2' },
            ],
            onPick,
            onAddToWatchlist,
            onTargetChange,
        });
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, props));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => FakeEventSource.instances[0]?.onopen?.());
        expect(FakeEventSource.instances[0]?.url).toContain('cursor=cursor_identity_1234567890');
        expect(host.textContent).toContain('監控中');
        expect(host.textContent).toContain('已有結果 2（即時 2／歷史重播 0）');
        expect(host.textContent).toContain('2.20×');
        expect(host.textContent).toContain('觸發 2.10×');
        expect(host.textContent).toContain('2026-09-04／2026-09-03 · 同分鐘 10:06');
        expect(host.textContent).toContain('shioaji/1.7.1');
        expect([...host.querySelectorAll('article')][0]?.textContent).toContain('2454.TW');
        const target = host.querySelector<HTMLSelectElement>('select[aria-label="盤中結果目標 K 線圖"]')!;
        await act(async () => {
            target.value = 'chart-2';
            target.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(onTargetChange).toHaveBeenCalledTimes(1);
        const addButton = host.querySelector<HTMLButtonElement>('button[aria-label*="加入盤中選股清單"]')!;
        await act(async () => {
            addButton.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(onAddToWatchlist).toHaveBeenCalledWith(expect.objectContaining({ code: '2454', symbol: '2454.TW' }));
        expect(onPick).not.toHaveBeenCalled();
        expect(host.textContent).toContain('已加入「盤中選股」清單');

        const resultButton = host.querySelector<HTMLButtonElement>('button[aria-label^="在指定 K 線圖開啟 2454"]')!;
        await act(async () => {
            resultButton.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ code: '2454', market: 'TWSE' }), 'chart-2');
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, { ...props, targets: [] }));
        });
        const callsBeforeMissingTarget = onPick.mock.calls.length;
        await act(async () => {
            resultButton.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(onPick).toHaveBeenCalledTimes(callsBeforeMissingTarget);
        expect(host.textContent).toContain('請選擇、解鎖或新增日 K 圖');
        const sort = host.querySelector<HTMLSelectElement>('select[aria-label="結果排序"]')!;
        await act(async () => { sort.value = 'ratio'; sort.dispatchEvent(new Event('change', { bubbles: true })); });
        expect([...host.querySelectorAll('article')][0]?.textContent).toContain('2330.TW');
    });

    it('大量結果仍保持卡片高度與可捲動，並分開顯示即時和歷史筆數', async () => {
        const today = taipeiTradeDate();
        const rows = Array.from({ length: 97 }, (_, index) => ({
            ...trigger(`event_${index}`, String(1000 + index), '09:01', 160, 170, false, today),
            kind: index < 65 ? 'historical' : 'live',
        }));
        vi.stubGlobal('fetch', activeFetch(rows));
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.style.display = 'flex';
        host.style.width = '480px';
        host.style.height = '640px';
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const list = host.querySelector<HTMLElement>('[role="tabpanel"]')!;
        const cards = [...list.querySelectorAll<HTMLElement>('article')];
        expect(host.textContent).toContain('量比結果 97');
        expect(host.textContent).toContain('已有結果 97（即時 32／歷史重播 65）');
        expect(cards).toHaveLength(97);
        expect(getComputedStyle(cards[0]!).flexShrink).toBe('0');
        expect(cards[0]!.getBoundingClientRect().height).toBeGreaterThan(40);
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    });

    it('收到其他分頁的 revision invalidation 時重新讀取乾淨設定', async () => {
        let configReads = 0;
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'feature_off', reason: 'gate_evidence_missing', generation: 'generation_test_1234567890', configRevision: 0,
                lease: { activeLeaseCount: 0, sessionState: 'idle', acceptingEvents: false },
                capacity: { configured: 0, eligible: 0, pilotCohort: 0, dataActive: 0, active: 0, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 0, gate0EvidenceCurrent: false, globalOwnershipComplete: false },
                itemStatuses: [], observedAt: '2026-09-04T08:00:00Z',
            });
            if (url.endsWith('/config')) {
                configReads += 1;
                return response({ config: { revision: configReads === 1 ? 0 : 1, globalThreshold: configReads === 1 ? '1.5' : '2', items: [] } });
            }
            if (url.includes('/results?')) return response({ items: [], cursor: 'cursor_identity_1234567890' });
            if (url.endsWith('/leases/acquire')) return response({ lease: { leaseId: 'lease_identity_1234567890', clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: '2026-09-04T08:00:00Z', expiresAt: '2099-09-04T08:00:15Z' } });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('監控名單'))?.click());
        expect(host.textContent).toContain('revision 0');
        await act(async () => {
            window.dispatchEvent(new CustomEvent('sj-intraday-monitor-config-invalidation-v1', { detail: {
                version: 1, type: 'intraday-monitor-config-invalidated', revision: 1,
                sourceClientId: 'other_client_identity_1234', emittedAt: Date.now(),
            } }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(configReads).toBe(2);
        expect(host.textContent).toContain('revision 1');
        expect(host.querySelector<HTMLInputElement>('input[aria-label="全域量比門檻"]')?.value).toBe('2');
    });

    it('通知預設關閉，只有有效 lease 的新 live authority event 會通知一次', async () => {
        vi.stubGlobal('fetch', activeFetch());
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.stubGlobal('Notification', FakeNotification);
        vi.stubGlobal('AudioContext', FakeAudioContext);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.classList.add(darkTwClass);
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => FakeEventSource.instances[0]?.onopen?.());

        const actualSoundButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent === '開啟頁內提示音')!;
        const systemButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent === '開啟系統通知')!;
        expect(actualSoundButton.getAttribute('aria-pressed')).toBe('false');
        expect(systemButton.getAttribute('aria-pressed')).toBe('false');

        await act(async () => {
            FakeEventSource.instances[0]?.emit('trigger', trigger('event-off', '2330', '10:05', 180, 190, true, taipeiTradeDate()), 'cursor-off');
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(host.textContent).toContain('2330.TW');
        expect(FakeNotification.instances).toHaveLength(0);
        expect(FakeAudioContext.starts).toBe(0);
        const add = host.querySelector<HTMLButtonElement>('button[aria-label*="2330"][aria-label*="加入盤中選股清單"]')!;
        const beforeHover = getComputedStyle(add);
        const originalHoverStyle = { borderColor: beforeHover.borderColor, backgroundColor: beforeHover.backgroundColor };
        const addLocator = page.getByRole('button', { name: /將 2330 .*加入盤中選股清單/ });
        await addLocator.hover();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(getComputedStyle(add).borderColor).not.toBe(originalHoverStyle.borderColor);
        expect(getComputedStyle(add).backgroundColor).not.toBe(originalHoverStyle.backgroundColor);
        await addLocator.unhover();

        await act(async () => {
            actualSoundButton.click();
            systemButton.click();
            await Promise.resolve();
        });
        expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
        expect(host.textContent).toContain('系統通知：已開啟');

        const live = trigger('event-live-once', '2454', '10:06', 210, 220, true, taipeiTradeDate());
        await act(async () => {
            FakeEventSource.instances[0]?.emit('trigger', live, 'cursor-live');
            FakeEventSource.instances[0]?.emit('trigger', live, 'cursor-live-duplicate');
            FakeEventSource.instances[0]?.emit('trigger', { ...live, configRevision: 2 }, 'cursor-config-change');
            FakeEventSource.instances[0]?.emit('replay', { items: [live] }, 'cursor-replay');
            FakeEventSource.instances[0]?.emit('trigger', { ...live, eventId: 'event-historical', kind: 'historical' }, 'cursor-historical');
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(FakeNotification.instances).toHaveLength(1);
        expect(FakeNotification.instances[0]).toMatchObject({ title: '2454 盤中量比達標' });
        expect(FakeAudioContext.starts).toBe(1);
        expect(host.textContent).toContain('歷史重播（不通知）');
    });

    it('Notification denied/default 不循環要求權限且不阻擋頁內結果', async () => {
        FakeNotification.permission = 'default';
        FakeNotification.requestPermission.mockImplementation(async () => {
            FakeNotification.permission = 'denied';
            return 'denied';
        });
        vi.stubGlobal('fetch', activeFetch());
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.stubGlobal('Notification', FakeNotification);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => FakeEventSource.instances[0]?.onopen?.());
        const systemButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent === '開啟系統通知')!;
        await act(async () => {
            systemButton.click();
            await Promise.resolve();
            systemButton.click();
            await Promise.resolve();
        });
        expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain('權限已拒絕');
        expect(host.textContent).toContain('不會重複要求');

        await act(async () => {
            FakeEventSource.instances[0]?.emit('trigger', trigger('event-denied', '2330', '10:07', 190, 200, true, taipeiTradeDate()));
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(host.textContent).toContain('2330.TW');
        expect(FakeNotification.instances).toHaveLength(0);
    });

    it('兩個 workspace 分頁同收 server event id 時只由一頁建立系統通知', async () => {
        vi.stubGlobal('fetch', activeFetch());
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.stubGlobal('Notification', FakeNotification);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement('div', null,
                createElement(IntradayMonitorPanel, { ...panelProps(), key: 'tab-a' }),
                createElement(IntradayMonitorPanel, { ...panelProps(), key: 'tab-b' }),
            ));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(FakeEventSource.instances).toHaveLength(2);
        await act(async () => {
            FakeEventSource.instances.forEach((source) => source.onopen?.());
            [...host.querySelectorAll<HTMLButtonElement>('button')]
                .filter((button) => button.textContent === '開啟系統通知')
                .forEach((button) => button.click());
            await Promise.resolve();
        });
        const live = trigger('same-server-event', '2330', '10:08', 200, 210, true, taipeiTradeDate());
        await act(async () => {
            FakeEventSource.instances.forEach((source) => source.emit('trigger', live, 'same-cursor'));
            await new Promise((resolve) => setTimeout(resolve, 60));
        });
        expect(FakeNotification.instances).toHaveLength(1);
    });

    it('高頻事件合併為單一 frame，保持焦點且不逐筆洗 live region', async () => {
        vi.stubGlobal('fetch', activeFetch());
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => FakeEventSource.instances[0]?.onopen?.());
        const sort = host.querySelector<HTMLSelectElement>('select[aria-label="結果排序"]');
        expect(sort).toBeNull();
        const liveRegionsBefore = [...host.querySelectorAll('[aria-live]')].map((node) => node.textContent);
        await act(async () => {
            for (let index = 0; index < 75; index += 1) {
                FakeEventSource.instances[0]?.emit('trigger', trigger(`burst-${index}`, '2330', '10:09', 180 + index, 190 + index, true, taipeiTradeDate()));
            }
        });
        expect(frames).toHaveLength(1);
        await act(async () => frames.shift()?.(performance.now()));
        const resultSort = host.querySelector<HTMLSelectElement>('select[aria-label="結果排序"]')!;
        resultSort.focus();
        expect(document.activeElement).toBe(resultSort);
        expect(host.querySelectorAll('article')).toHaveLength(75);
        expect([...host.querySelectorAll('[aria-live]')].map((node) => node.textContent)).toEqual(liveRegionsBefore);
        const firstResult = host.querySelector<HTMLButtonElement>('button[aria-label^="在指定 K 線圖開啟"]')!;
        const addButton = host.querySelector<HTMLButtonElement>('button[aria-label*="加入盤中選股清單"]')!;
        expect(firstResult.tabIndex).toBe(0);
        expect(addButton.tabIndex).toBe(0);
        expect(getComputedStyle(firstResult).touchAction).toBe('manipulation');
        expect(firstResult.closest('article')?.textContent).toContain('即時觸發');
    });

    it('離線 160 檔 UI fixture 可完整呈現、鍵盤聚焦、排序與 K 線連動', async () => {
        const contracts = Array.from({ length: 160 }, (_, index) => ({
            security_type: 'STK' as const,
            region: 'TW' as const,
            exchange: index % 2 ? 'OTC' as const : 'TSE' as const,
            code: String(1001 + index),
            target_code: null,
        }));
        const items = contracts.map((contract) => ({
            contract, enabled: true, thresholdOverride: null, source: 'watchlist' as const,
        }));
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'feature_off', reason: 'gate_evidence_missing',
                generation: 'generation_ui_load_160', configRevision: 3,
                lease: { activeLeaseCount: 0, sessionState: 'idle', acceptingEvents: false },
                capacity: { configured: 160, eligible: 160, pilotCohort: 20, dataActive: 0,
                    approvedActiveLimit: 20, evaluationStageTarget: 160,
                    evaluationState: 'offline_only',
                    active: 0, waiting: 160, waitingGate: 160, waitingPilotLimit: 0,
                    waitingCapacity: 0, waitingBaseline: 0, degraded: 0,
                    confirmedPhysicalUsage: null, confirmedOtherPhysicalUsage: null,
                    localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 0,
                    gate0EvidenceCurrent: false, globalOwnershipComplete: false },
                itemStatuses: [], observedAt: '2026-09-08T12:00:00+08:00',
            });
            if (url.endsWith('/config')) return response({ config: {
                revision: 3, globalThreshold: '2', items,
            } });
            if (url.includes('/results?')) return response({ items: [], cursor: null });
            if (url.endsWith('/diagnostics')) return response({
                state: 'feature_off', reason: 'gate_evidence_missing', ownershipRevision: 0,
                evidenceRevision: 0, baseline: { complete: false, tradeDate: null,
                    sourceVersion: null, itemCount: 0 }, completedMinute: null,
            });
            if (url.endsWith('/leases/acquire')) return response({ lease: {
                leaseId: 'lease_ui_load_identity_160',
                clientId: '123e4567-e89b-42d3-a456-426614174000',
                generation: 'generation_ui_load_160',
                acquiredAt: '2026-09-08T12:00:00+08:00',
                expiresAt: '2099-09-08T12:00:15+08:00',
            } });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            const match = url.match(/\/api\/v1\/data\/contracts\/(\d+)\/info/);
            if (match) {
                const contract = contracts.find((entry) => entry.code === match[1]);
                if (!contract) throw new Error(`unknown fixture contract ${match[1]}`);
                return response({ ...contract, name: `測試股名${contract.code}` });
            }
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        host.style.width = '640px';
        host.style.height = '900px';
        document.body.append(host);
        root = createRoot(host);
        const onPick = vi.fn(async () => true);
        const renderStarted = performance.now();
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps({ onPick })));
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
        const renderLatencyMs = performance.now() - renderStarted;
        await act(async () => {
            [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('監控名單 160'))?.click();
            await new Promise((resolve) => setTimeout(resolve, 25));
        });
        expect(host.querySelectorAll('input[aria-label$=" 個別門檻"]')).toHaveLength(160);
        expect(host.textContent).toContain('容量核准（歷史決策）');
        expect(host.textContent).toContain('核准上限20');
        expect(host.textContent).toContain('審閱來源未證實');
        expect(host.textContent).toContain('今日監控未啟動');
        expect(host.textContent).toContain('provider 證據usage 未知 · other 未知 · ownership 未知 · release 未知 · headroom 未知');
        expect(host.textContent).toContain('1001 · 測試股名1001');
        expect(host.textContent).toContain('1160 · 測試股名1160');

        const lastStock = [...host.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent?.includes('1160 · 測試股名1160'))!;
        lastStock.focus();
        expect(document.activeElement).toBe(lastStock);
        const interactionStarted = performance.now();
        await act(async () => lastStock.click());
        const interactionLatencyMs = performance.now() - interactionStarted;
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
            code: '1160', symbol: '1160.TWO', name: '測試股名1160', market: 'TPEx',
        }), 'chart-1');
        const up = host.querySelector<HTMLButtonElement>('button[aria-label="1160 上移"]')!;
        await act(async () => up.click());
        expect(up).not.toBeDisabled();
        expect(renderLatencyMs).toBeLessThan(10_000);
        expect(interactionLatencyMs).toBeLessThan(1_000);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/info?'))).toHaveLength(160);
    });

    it('lease renew 失敗後暫停並以新 lease 與既有 cursor 恢復 SSE', async () => {
        let acquisitions = 0;
        const currentMetadata = currentStatusMetadata(taipeiTradeDate());
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/status')) return response({
                state: 'idle', reason: 'lease_missing', generation: 'generation_test_1234567890', configRevision: 0,
                ...currentMetadata,
                session: { ...currentMetadata.session, configRevision: 0, savedConfigRevision: 0 },
                lease: { activeLeaseCount: acquisitions, sessionState: acquisitions ? 'active' : 'idle', acceptingEvents: acquisitions > 0 },
                capacity: { configured: 0, eligible: 0, pilotCohort: 0, dataActive: 0, active: 0, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: 0, confirmedOtherPhysicalUsage: 0, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 160, gate0EvidenceCurrent: true, globalOwnershipComplete: true },
                itemStatuses: [], observedAt: new Date().toISOString(),
            });
            if (url.endsWith('/config')) return response({ config: { revision: 0, globalThreshold: '1.5', items: [] } });
            if (url.includes('/results?')) return response({ items: [], cursor: 'cursor_recovery_identity_1234' });
            if (url.endsWith('/leases/acquire')) {
                acquisitions += 1;
                return response({ lease: { leaseId: `lease_identity_${String(acquisitions).padStart(16, '0')}`, clientId: '123e4567-e89b-42d3-a456-426614174000', generation: 'generation_test_1234567890', acquiredAt: new Date().toISOString(), expiresAt: acquisitions === 1 ? new Date(Date.now() + 5_050).toISOString() : '2099-09-04T08:00:15Z' } });
            }
            if (url.endsWith('/leases/renew')) return errorResponse(409, { reason: 'lease_not_current' });
            if (url.endsWith('/leases/release')) return response({ ok: true });
            throw new Error(`unexpected ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('EventSource', FakeEventSource);
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(createElement(IntradayMonitorPanel, panelProps()));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(FakeEventSource.instances).toHaveLength(1);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_300)); });
        expect(acquisitions).toBeGreaterThanOrEqual(2);
        expect(FakeEventSource.instances[0]?.closed).toBe(true);
        expect(FakeEventSource.instances.at(-1)?.url).toContain('cursor=cursor_recovery_identity_1234');
    });
});
