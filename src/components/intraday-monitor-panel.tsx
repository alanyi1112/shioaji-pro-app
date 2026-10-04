import { useEffect, useMemo, useRef, useState } from 'react';
import {
    acquireIntradayMonitorLease,
    IntradayMonitorApiError,
    intradayMonitorEventsUrl,
    readIntradayMonitorConfig,
    readIntradayMonitorDailyStatus,
    readIntradayMonitorPostcloseRecovery,
    readIntradayMonitorDiagnostics,
    readIntradayMonitorResultsPage,
    readIntradayMonitorStatus,
    releaseIntradayMonitorLease,
    replaceIntradayMonitorConfig,
    renewIntradayMonitorLease,
    taipeiTradeDate,
    type IntradayMonitorConfigView,
    type IntradayMonitorDailyStatusView,
    type IntradayMonitorPostcloseRecoveryView,
    type IntradayMonitorDiagnosticsView,
    type IntradayMonitorLeaseView,
    type IntradayMonitorStatusView,
    type IntradayMonitorTriggerView,
} from '../lib/intraday-monitor-api';
import {
    canonicalIntradayThreshold,
    canonicalMonitorKey,
    cloneIntradayMonitorConfig,
    loadSavedAfterMarketScreenerSelection,
    moveIntradayMonitorDraftItem,
    parseIntradayMonitorTokens,
    removeIntradayMonitorDraftItem,
    resolveIntradayMonitorImport,
    updateIntradayMonitorDraftItem,
    type IntradayMonitorImportCandidate,
    type IntradayMonitorImportReport,
} from '../lib/intraday-monitor-config-draft';
import {
    emitIntradayMonitorConfigInvalidation,
    onIntradayMonitorConfigInvalidation,
} from '../lib/intraday-monitor-invalidation';
import {
    emptyIntradayMonitorResultMessage,
    itemStateLabels,
    latestRatio,
    overallMonitorLabel,
    reasonLabels,
    sortIntradayMonitorResults,
    triggerRatio,
    type IntradayMonitorConnectionState,
    type IntradayMonitorResultSort,
} from '../lib/intraday-monitor-view-model';
import type { IntradayMonitorWatchlistResult } from '../lib/intraday-monitor-watchlist';
import {
    createIntradayNotificationAcknowledgements,
    hasValidIntradayNotificationLease,
    intradayNotificationText,
    isNewLiveNotificationEvent,
    playIntradayNotificationSound,
} from '../lib/intraday-monitor-notifications';
import {
    searchIntradayMonitorInstruments,
    type IntradayMonitorInstrumentSuggestion,
} from '../lib/intraday-monitor-instrument-search';
import {
    readMultiViewMonitorImportLists,
    type MultiViewMonitorImportList,
} from '../lib/intraday-monitor-multiview-watchlists';
import { fetchContractInfo, resolveContract } from '../lib/shioaji';
import type { ServerWatchlist } from '../lib/shioaji';
import type { UniverseStock } from '../lib/stock-screener-domain';
import * as styles from './intraday-monitor-panel.css';

type View = 'results' | 'monitor';

export interface IntradayMonitorPanelProps {
    targets: { id: string; label: string }[];
    onPick: (stock: UniverseStock, targetId: string) => Promise<boolean>;
    onOpenChart: () => Promise<string | undefined> | string | undefined;
    onTargetChange: () => void;
    onAddToWatchlist: (stock: UniverseStock) => Promise<IntradayMonitorWatchlistResult>;
    watchlists?: ServerWatchlist[];
}

type AddState = {
    status: 'pending' | 'added' | 'already_present' | 'error';
    message: string;
};

type SystemNotificationPermission = NotificationPermission | 'unsupported';

function currentSystemNotificationPermission(): SystemNotificationPermission {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

const emptyReport = (): IntradayMonitorImportReport => ({ accepted: [], duplicates: [], invalid: [], overLimit: [] });

export function IntradayMonitorPanel({
    targets,
    onPick,
    onOpenChart,
    onTargetChange,
    onAddToWatchlist,
    watchlists = [],
}: IntradayMonitorPanelProps) {
    const [status, setStatus] = useState<IntradayMonitorStatusView | null>(null);
    const [dailyStatus, setDailyStatus] = useState<IntradayMonitorDailyStatusView | null>(null);
    const [postcloseRecovery, setPostcloseRecovery] = useState<IntradayMonitorPostcloseRecoveryView | null>(null);
    const [config, setConfig] = useState<IntradayMonitorConfigView | null>(null);
    const [draft, setDraft] = useState<IntradayMonitorConfigView | null>(null);
    const [results, setResults] = useState<IntradayMonitorTriggerView[]>([]);
    const [diagnostics, setDiagnostics] = useState<IntradayMonitorDiagnosticsView | null>(null);
    const [offline, setOffline] = useState(false);
    const [connection, setConnection] = useState<IntradayMonitorConnectionState>('starting');
    const [lastStreamAt, setLastStreamAt] = useState<string | null>(null);
    const [view, setView] = useState<View>('results');
    const [resultSort, setResultSort] = useState<IntradayMonitorResultSort>('trigger_time');
    const [targetId, setTargetId] = useState('');
    const [selectionMessage, setSelectionMessage] = useState('');
    const [addStates, setAddStates] = useState<Record<string, AddState>>({});
    const [soundEnabled, setSoundEnabled] = useState(false);
    const [systemNotificationEnabled, setSystemNotificationEnabled] = useState(false);
    const [systemNotificationPermission, setSystemNotificationPermission] = useState<SystemNotificationPermission>(currentSystemNotificationPermission);
    const [notificationMessage, setNotificationMessage] = useState('聲音與系統通知預設關閉。');
    const [namesByCode, setNamesByCode] = useState<Record<string, string>>({});
    const [dirty, setDirty] = useState(false);
    const [singleQuery, setSingleQuery] = useState('');
    const [singleSelection, setSingleSelection] = useState<IntradayMonitorInstrumentSuggestion | null>(null);
    const [singleSuggestions, setSingleSuggestions] = useState<IntradayMonitorInstrumentSuggestion[]>([]);
    const [singleSearchState, setSingleSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [singleActiveIndex, setSingleActiveIndex] = useState(0);
    const [batchCodes, setBatchCodes] = useState('');
    const [watchlistId, setWatchlistId] = useState('');
    const [multiViewLists, setMultiViewLists] = useState<MultiViewMonitorImportList[]>([]);
    const [multiViewListId, setMultiViewListId] = useState('');
    const [multiViewListState, setMultiViewListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [multiViewReload, setMultiViewReload] = useState(0);
    const [importReport, setImportReport] = useState<IntradayMonitorImportReport>(emptyReport);
    const [editorMessage, setEditorMessage] = useState('');
    const [importing, setImporting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const leaseRef = useRef<IntradayMonitorLeaseView | null>(null);
    const configRef = useRef<IntradayMonitorConfigView | null>(null);
    const dirtyRef = useRef(false);
    const cursorRef = useRef<string | null>(null);
    const pendingNamesRef = useRef(new Set<string>());
    const nameAttemptsRef = useRef(new Map<string, number>());
    const nameRetryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const mountedRef = useRef(true);
    const pickingGenerationRef = useRef(0);
    const pendingAddsRef = useRef(new Set<string>());
    const soundEnabledRef = useRef(false);
    const systemNotificationEnabledRef = useRef(false);
    const connectionRef = useRef<IntradayMonitorConnectionState>('starting');
    const permissionRequestedRef = useRef(false);
    const namesByCodeRef = useRef<Record<string, string>>({});
    const tradeDate = useMemo(() => taipeiTradeDate(), []);
    const clientId = useMemo(() => crypto.randomUUID(), []);
    const notificationAcknowledgements = useMemo(
        () => createIntradayNotificationAcknowledgements(tradeDate),
        [tradeDate],
    );
    configRef.current = config;
    dirtyRef.current = dirty;
    soundEnabledRef.current = soundEnabled;
    systemNotificationEnabledRef.current = systemNotificationEnabled;
    connectionRef.current = connection;
    namesByCodeRef.current = namesByCode;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            for (const timer of nameRetryTimersRef.current.values()) clearTimeout(timer);
            nameRetryTimersRef.current.clear();
        };
    }, []);

    useEffect(() => {
        let stopped = false;
        const refresh = () => {
            if (Date.now() < Date.parse(`${tradeDate}T13:35:00+08:00`)) return;
            void readIntradayMonitorPostcloseRecovery(tradeDate)
                .then((value) => { if (!stopped) setPostcloseRecovery(value); })
                .catch(() => { if (!stopped) setPostcloseRecovery(null); });
        };
        refresh();
        const timer = window.setInterval(refresh, 60_000);
        return () => { stopped = true; window.clearInterval(timer); };
    }, [tradeDate]);

    const effectiveTarget = targets.some((target) => target.id === targetId)
        ? targetId
        : targets.length === 1
          ? targets[0]!.id
          : '';

    const resultStock = (item: IntradayMonitorTriggerView): UniverseStock => {
        const code = item.canonicalSymbol.split('.')[0] ?? '';
        const suffix = item.exchange === 'TSE' ? 'TW' : 'TWO';
        if (!/^\d{4,6}$/.test(code) || item.canonicalSymbol !== `${code}.${suffix}`) {
            throw new Error('結果商品代碼或市場不一致，未執行操作');
        }
        return {
            code,
            symbol: item.canonicalSymbol,
            name: namesByCode[code] ?? code,
            market: item.exchange === 'TSE' ? 'TWSE' : 'TPEx',
            kind: 'ordinary',
        };
    };

    const pickStock = async (stock: UniverseStock) => {
        if (!effectiveTarget) {
            setSelectionMessage('目前沒有指定未鎖定 K 線圖；請選擇、解鎖或新增日 K 圖。');
            return;
        }
        const ticket = ++pickingGenerationRef.current;
        setSelectionMessage(`正在解析 ${stock.code} 的圖表商品…`);
        try {
            const selected = await onPick(stock, effectiveTarget);
            if (ticket === pickingGenerationRef.current) {
                setSelectionMessage(selected
                    ? `已在指定 K 線圖開啟 ${stock.code} ${stock.name}`
                    : '圖表選擇已取消；原圖表保持不變。');
            }
        } catch (error) {
            if (ticket === pickingGenerationRef.current) {
                setSelectionMessage(error instanceof Error ? error.message : '開啟圖表失敗；原圖表保持不變。');
            }
        }
    };

    const addResultToWatchlist = async (item: IntradayMonitorTriggerView) => {
        const stock = resultStock(item);
        if (pendingAddsRef.current.has(stock.symbol)) return;
        pendingAddsRef.current.add(stock.symbol);
        setAddStates((current) => ({
            ...current,
            [stock.symbol]: { status: 'pending', message: '正在加入「盤中選股」清單…' },
        }));
        try {
            const result = await onAddToWatchlist(stock);
            setAddStates((current) => ({
                ...current,
                [stock.symbol]: {
                    status: result.status,
                    message: result.status === 'already_present'
                        ? '原已在「盤中選股」清單'
                        : '已加入「盤中選股」清單',
                },
            }));
        } catch (error) {
            setAddStates((current) => ({
                ...current,
                [stock.symbol]: {
                    status: 'error',
                    message: error instanceof Error
                        ? error.message
                        : '加入「盤中選股」清單失敗，請稍後再明確重試。',
                },
            }));
        } finally {
            pendingAddsRef.current.delete(stock.symbol);
        }
    };

    useEffect(() => () => {
        pickingGenerationRef.current += 1;
    }, []);

    const toggleSound = () => {
        setSoundEnabled((current) => {
            const next = !current;
            soundEnabledRef.current = next;
            setNotificationMessage(next ? '頁內提示音已開啟。' : '頁內提示音已關閉。');
            return next;
        });
    };

    const toggleSystemNotification = async () => {
        if (systemNotificationEnabledRef.current) {
            systemNotificationEnabledRef.current = false;
            setSystemNotificationEnabled(false);
            setNotificationMessage('系統通知已關閉。');
            return;
        }
        const permission = currentSystemNotificationPermission();
        setSystemNotificationPermission(permission);
        if (permission === 'unsupported') {
            setNotificationMessage('此瀏覽器不支援系統通知；頁內結果仍會更新。');
            return;
        }
        if (permission === 'denied') {
            setNotificationMessage('系統通知權限已被拒絕；請由瀏覽器網站設定調整，本頁不會重複要求。');
            return;
        }
        let resolved: NotificationPermission = permission;
        if (permission === 'default') {
            if (permissionRequestedRef.current) {
                setNotificationMessage('系統通知尚未獲得授權；本頁不會重複要求權限。');
                return;
            }
            permissionRequestedRef.current = true;
            try {
                resolved = await Notification.requestPermission();
            } catch {
                resolved = 'default';
            }
            setSystemNotificationPermission(resolved);
        }
        if (resolved !== 'granted') {
            setNotificationMessage(resolved === 'denied'
                ? '系統通知權限已被拒絕；頁內結果仍會更新，本頁不會重複要求。'
                : '系統通知尚未獲得授權；頁內結果仍會更新，本頁不會重複要求。');
            return;
        }
        systemNotificationEnabledRef.current = true;
        setSystemNotificationEnabled(true);
        setNotificationMessage('系統通知已開啟；只通知有效 lease 收到的全新即時事件。');
    };

    useEffect(() => {
        let stopped = false;
        let renewTimer: ReturnType<typeof setTimeout> | null = null;
        let statusTimer: ReturnType<typeof setInterval> | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let events: EventSource | null = null;
        let reconnectAttempt = 0;
        let resultFrame: number | null = null;
        const pendingResultEvents = new Map<string, IntradayMonitorTriggerView>();
        const updateConnection = (next: IntradayMonitorConnectionState) => {
            connectionRef.current = next;
            setConnection(next);
        };

        const mergeEvents = (incoming: IntradayMonitorTriggerView[]) => {
            setResults((current) => {
                const byId = new Map(current.map((item) => [item.eventId, item]));
                for (const item of incoming) {
                    const previous = byId.get(item.eventId);
                    byId.set(item.eventId, {
                        ...previous,
                        ...item,
                        currentEvidence: item.currentEvidence ?? previous?.currentEvidence ?? null,
                    });
                }
                return [...byId.values()];
            });
        };
        const queueEvents = (incoming: IntradayMonitorTriggerView[]) => {
            for (const item of incoming) pendingResultEvents.set(item.eventId, item);
            if (resultFrame !== null) return;
            resultFrame = window.requestAnimationFrame(() => {
                resultFrame = null;
                const batch = [...pendingResultEvents.values()];
                pendingResultEvents.clear();
                if (!stopped && batch.length > 0) mergeEvents(batch);
            });
        };
        const notifyLiveEvent = async (item: IntradayMonitorTriggerView) => {
            if (item.tradeDate !== tradeDate
                || !isNewLiveNotificationEvent(item)
                || connectionRef.current !== 'connected'
                || !hasValidIntradayNotificationLease(leaseRef.current)) return;
            const wantsSound = soundEnabledRef.current;
            const wantsSystem = systemNotificationEnabledRef.current;
            if (!wantsSound && !wantsSystem) return;
            const claimed = await notificationAcknowledgements.claim(item.eventId);
            if (!claimed || stopped
                || connectionRef.current !== 'connected'
                || !hasValidIntradayNotificationLease(leaseRef.current)) {
                return;
            }
            const { title, body } = intradayNotificationText(
                item,
                namesByCodeRef.current[item.canonicalSymbol.split('.')[0] ?? ''],
            );
            if (wantsSound) void playIntradayNotificationSound();
            if (wantsSystem) {
                const permission = currentSystemNotificationPermission();
                setSystemNotificationPermission(permission);
                if (permission === 'granted') {
                    try {
                        new Notification(title, { body, tag: `intraday-monitor:${item.eventId}`, silent: true });
                    } catch {
                        systemNotificationEnabledRef.current = false;
                        setSystemNotificationEnabled(false);
                        setNotificationMessage('系統通知建立失敗；已安全關閉，頁內結果仍保留。');
                    }
                } else {
                    systemNotificationEnabledRef.current = false;
                    setSystemNotificationEnabled(false);
                    setNotificationMessage('系統通知權限目前不可用；已關閉系統通知，頁內結果仍保留。');
                }
            }
        };
        const mergeConfigRevision = async (revision: number) => {
            if (!configRef.current) return;
            if (configRef.current?.revision === revision) return;
            if (dirtyRef.current) {
                setConflict(true);
                setEditorMessage(`伺服器設定已更新為 revision ${revision}；本頁草稿尚未覆寫，請重新載入。`);
                return;
            }
            try {
                const nextConfig = await readIntradayMonitorConfig();
                if (stopped) return;
                configRef.current = nextConfig;
                setConfig(nextConfig);
                setDraft(cloneIntradayMonitorConfig(nextConfig));
            } catch {
                if (!stopped) setOffline(true);
            }
        };
        const refreshStatus = async () => {
            try {
                const next = await readIntradayMonitorStatus();
                if (!stopped) {
                    setStatus(next);
                    setOffline(false);
                    void mergeConfigRevision(next.configRevision);
                    void readIntradayMonitorDailyStatus()
                        .then((daily) => { if (!stopped) setDailyStatus(daily); })
                        .catch(() => { if (!stopped) setDailyStatus(null); });
                }
                return next;
            } catch {
                if (!stopped) {
                    setOffline(true);
                    updateConnection('paused');
                }
                return null;
            }
        };
        const refreshEvidence = async () => {
            const [page, detail] = await Promise.allSettled([
                readIntradayMonitorResultsPage(tradeDate),
                readIntradayMonitorDiagnostics(),
            ]);
            if (stopped) return;
            if (page.status === 'fulfilled') {
                cursorRef.current = page.value.cursor ?? cursorRef.current;
                mergeEvents(page.value.items);
            }
            if (detail.status === 'fulfilled') setDiagnostics(detail.value);
        };
        const openEvents = (cursor: string | null) => {
            events?.close();
            updateConnection('reconnecting');
            events = new EventSource(intradayMonitorEventsUrl(tradeDate, cursor));
            const rememberCursor = (event: Event) => {
                const nextCursor = (event as MessageEvent<string>).lastEventId;
                if (nextCursor) cursorRef.current = nextCursor;
            };
            events.addEventListener('replay', (event) => {
                rememberCursor(event);
                try {
                    const payload = JSON.parse((event as MessageEvent<string>).data) as { items?: IntradayMonitorTriggerView[] };
                    if (Array.isArray(payload.items)) queueEvents(payload.items);
                } catch {}
            });
            events.addEventListener('trigger', (event) => {
                rememberCursor(event);
                try {
                    const item = JSON.parse((event as MessageEvent<string>).data) as IntradayMonitorTriggerView;
                    if (!hasValidIntradayNotificationLease(leaseRef.current)) return;
                    queueEvents([item]);
                    void notifyLiveEvent(item);
                }
                catch {}
            });
            events.onerror = () => { if (!stopped) updateConnection('reconnecting'); };
            events.onopen = () => {
                if (!stopped) {
                    updateConnection('connected');
                    setLastStreamAt(new Date().toISOString());
                }
            };
        };
        const scheduleRenew = () => {
            if (stopped || !leaseRef.current) return;
            const delay = Math.max(1_000, Date.parse(leaseRef.current.expiresAt) - Date.now() - 5_000);
            renewTimer = setTimeout(async () => {
                try {
                    leaseRef.current = await renewIntradayMonitorLease(leaseRef.current!);
                    reconnectAttempt = 0;
                    scheduleRenew();
                } catch {
                    leaseRef.current = null;
                    events?.close();
                    updateConnection('paused');
                    scheduleRecovery();
                }
            }, delay);
        };
        const scheduleRecovery = () => {
            if (stopped || reconnectTimer) return;
            const delay = Math.min(15_000, 1_000 * 2 ** Math.min(reconnectAttempt, 4));
            reconnectAttempt += 1;
            reconnectTimer = setTimeout(async () => {
                reconnectTimer = null;
                if (stopped) return;
                updateConnection('reconnecting');
                const next = await refreshStatus();
                if (!next) return scheduleRecovery();
                if (!next.session.current) {
                    updateConnection('paused');
                    scheduleRecovery();
                    return;
                }
                try {
                    const lease = await acquireIntradayMonitorLease(clientId, next.generation);
                    if (stopped) {
                        void releaseIntradayMonitorLease(lease).catch(() => undefined);
                        return;
                    }
                    leaseRef.current = lease;
                    reconnectAttempt = 0;
                    openEvents(cursorRef.current);
                    scheduleRenew();
                    void refreshEvidence();
                } catch {
                    updateConnection('paused');
                    scheduleRecovery();
                }
            }, delay);
        };
        const start = async () => {
            const next = await refreshStatus();
            if (!next || stopped) {
                scheduleRecovery();
                return;
            }
            const [nextConfig, initialPage] = await Promise.all([
                readIntradayMonitorConfig(),
                readIntradayMonitorResultsPage(tradeDate),
            ]);
            if (stopped) return;
            configRef.current = nextConfig;
            setConfig(nextConfig);
            cursorRef.current = initialPage.cursor ?? null;
            mergeEvents(initialPage.items);
            void readIntradayMonitorDiagnostics().then((value) => {
                if (!stopped) setDiagnostics(value);
            }).catch(() => undefined);
            if (!next.session.current) {
                updateConnection('paused');
                scheduleRecovery();
                return;
            }
            const lease = await acquireIntradayMonitorLease(clientId, next.generation);
            if (stopped) {
                void releaseIntradayMonitorLease(lease).catch(() => undefined);
                return;
            }
            leaseRef.current = lease;
            scheduleRenew();
            openEvents(cursorRef.current);
            statusTimer = setInterval(() => {
                void refreshStatus().then((latest) => {
                    if (!latest || stopped) return;
                    if (!latest.session.current) {
                        const lease = leaseRef.current;
                        leaseRef.current = null;
                        events?.close();
                        if (lease) void releaseIntradayMonitorLease(lease).catch(() => undefined);
                        updateConnection('paused');
                        scheduleRecovery();
                        void refreshEvidence();
                        return;
                    }
                    if (leaseRef.current && leaseRef.current.generation !== latest.generation) {
                        leaseRef.current = null;
                        events?.close();
                        updateConnection('paused');
                        scheduleRecovery();
                    }
                    void refreshEvidence();
                });
            }, 10_000);
        };
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') {
                void refreshStatus();
                void refreshEvidence();
            }
        };
        window.addEventListener('online', scheduleRecovery);
        document.addEventListener('visibilitychange', refreshWhenVisible);
        void start().catch(() => {
            if (!stopped) {
                setOffline(true);
                updateConnection('paused');
                scheduleRecovery();
            }
        });
        return () => {
            stopped = true;
            if (renewTimer) clearTimeout(renewTimer);
            if (statusTimer) clearInterval(statusTimer);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (resultFrame !== null) window.cancelAnimationFrame(resultFrame);
            window.removeEventListener('online', scheduleRecovery);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
            events?.close();
            const lease = leaseRef.current;
            leaseRef.current = null;
            if (lease) void releaseIntradayMonitorLease(lease).catch(() => undefined);
        };
    }, [clientId, notificationAcknowledgements, tradeDate]);

    useEffect(() => onIntradayMonitorConfigInvalidation((event) => {
        if (event.sourceClientId === clientId || configRef.current?.revision === event.revision) return;
        if (dirtyRef.current) {
            setConflict(true);
            setEditorMessage(`另一個分頁已儲存 revision ${event.revision}；請重新載入後再修改。`);
            return;
        }
        void readIntradayMonitorConfig().then((next) => {
            configRef.current = next;
            setConfig(next);
            setDraft(cloneIntradayMonitorConfig(next));
        }).catch(() => setOffline(true));
    }), [clientId]);

    useEffect(() => {
        if (config && !dirty) setDraft(cloneIntradayMonitorConfig(config));
        // A status refresh must never overwrite an unsaved editor draft.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    useEffect(() => {
        const codes = new Set([
            ...(config?.items.map((item) => item.contract.code) ?? []),
            ...(draft?.items.map((item) => item.contract.code) ?? []),
            ...results.map((item) => item.canonicalSymbol.split('.')[0] ?? ''),
        ]);
        for (const code of codes) {
            if (!code || namesByCode[code] || pendingNamesRef.current.has(code)
                || (nameAttemptsRef.current.get(code) ?? 0) >= 3) continue;
            pendingNamesRef.current.add(code);
            const attempt = (nameAttemptsRef.current.get(code) ?? 0) + 1;
            nameAttemptsRef.current.set(code, attempt);
            void fetchContractInfo(code, 'STK').then((contract) => {
                if (!mountedRef.current || !contract.name.trim()) return;
                nameAttemptsRef.current.delete(code);
                setNamesByCode((current) => ({ ...current, [code]: contract.name.trim() }));
            }).catch(() => {
                if (!mountedRef.current || attempt >= 3) return;
                const timer = setTimeout(() => {
                    nameRetryTimersRef.current.delete(code);
                    pendingNamesRef.current.delete(code);
                    setNamesByCode((current) => ({ ...current }));
                }, 350 * (2 ** (attempt - 1)));
                nameRetryTimersRef.current.set(code, timer);
            }).finally(() => {
                if (!nameRetryTimersRef.current.has(code)) pendingNamesRef.current.delete(code);
            });
        }
    }, [config, draft, namesByCode, results]);

    useEffect(() => {
        const query = singleQuery.trim();
        if (!query || singleSelection) {
            setSingleSuggestions([]);
            setSingleSearchState('idle');
            setSingleActiveIndex(0);
            return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setSingleSearchState('loading');
            void searchIntradayMonitorInstruments(query, { signal: controller.signal })
                .then(({ items }) => {
                    if (controller.signal.aborted) return;
                    setSingleSuggestions(items);
                    setSingleActiveIndex(0);
                    setSingleSearchState('ready');
                })
                .catch(() => {
                    if (controller.signal.aborted) return;
                    setSingleSuggestions([]);
                    setSingleSearchState('error');
                });
        }, 150);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [singleQuery, singleSelection]);

    useEffect(() => {
        if (view !== 'monitor') return;
        const controller = new AbortController();
        setMultiViewListState('loading');
        void readMultiViewMonitorImportLists({ signal: controller.signal })
            .then((lists) => {
                if (controller.signal.aborted) return;
                setMultiViewLists(lists);
                setMultiViewListId((current) => lists.some((list) => list.id === current) ? current : '');
                setMultiViewListState('ready');
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setMultiViewLists([]);
                setMultiViewListId('');
                setMultiViewListState('error');
            });
        return () => controller.abort();
    }, [multiViewReload, view]);

    const chooseSingleSuggestion = (suggestion: IntradayMonitorInstrumentSuggestion) => {
        setSingleSelection(suggestion);
        setSingleQuery(`${suggestion.code} ${suggestion.name}`);
        setSingleSuggestions([]);
        setSingleSearchState('idle');
        setNamesByCode((current) => ({ ...current, [suggestion.code]: suggestion.name }));
    };

    const resolveForDraft = async (code: string) => {
        const contract = await resolveContract(code, 'STK');
        return { ...contract, region: contract.region ?? 'TW' as const };
    };

    const importCandidates = async (candidates: IntradayMonitorImportCandidate[]) => {
        if (!draft || importing || candidates.length === 0) return;
        setImporting(true);
        setEditorMessage('正在驗證匯入商品…');
        try {
            const report = await resolveIntradayMonitorImport(draft.items, candidates, resolveForDraft);
            setImportReport(report);
            if (report.accepted.length > 0) {
                setDraft((current) => current ? { ...current, items: [...current.items, ...report.accepted] } : current);
                setDirty(true);
            }
            setEditorMessage(`已加入草稿 ${report.accepted.length} 檔；仍需按「儲存設定」才會生效。`);
        } catch {
            setEditorMessage('匯入驗證失敗，草稿未變更。');
        } finally {
            setImporting(false);
        }
    };

    const editDraft = (updater: (current: IntradayMonitorConfigView) => IntradayMonitorConfigView) => {
        setDraft((current) => current ? updater(current) : current);
        setDirty(true);
        setConflict(false);
        setEditorMessage('草稿尚未儲存。');
    };

    const saveDraft = async () => {
        if (!draft || saving) return;
        const globalThreshold = canonicalIntradayThreshold(draft.globalThreshold);
        const invalidOverride = draft.items.some((item) =>
            item.thresholdOverride !== null &&
            item.thresholdOverride !== '' &&
            canonicalIntradayThreshold(item.thresholdOverride) === null,
        );
        const items = draft.items.map((item) => ({
            ...item,
            thresholdOverride: item.thresholdOverride === null || item.thresholdOverride === ''
                ? null
                : canonicalIntradayThreshold(item.thresholdOverride),
        }));
        if (!globalThreshold || invalidOverride) {
            setEditorMessage('門檻必須介於 1.00～100.00，最多兩位小數。');
            return;
        }
        setSaving(true);
        setConflict(false);
        try {
            const saved = await replaceIntradayMonitorConfig({
                revision: draft.revision,
                globalThreshold,
                items,
            });
            configRef.current = saved;
            setConfig(saved);
            setDraft(cloneIntradayMonitorConfig(saved));
            setDirty(false);
            setEditorMessage(`已儲存 revision ${saved.revision}，共 ${saved.items.length} 檔。`);
            setStatus((current) => current ? { ...current, configRevision: saved.revision } : current);
            emitIntradayMonitorConfigInvalidation(saved.revision, clientId);
        } catch (error) {
            if (error instanceof IntradayMonitorApiError && error.reason === 'revision_conflict') {
                setConflict(true);
                setEditorMessage('設定已被其他分頁更新；目前草稿未覆寫伺服器資料。請重新載入後再修改。');
            } else {
                setEditorMessage('儲存失敗；目前草稿仍保留，尚未套用。');
            }
        } finally {
            setSaving(false);
        }
    };

    const reloadConfig = async () => {
        try {
            const next = await readIntradayMonitorConfig();
            configRef.current = next;
            setConfig(next);
            setDraft(cloneIntradayMonitorConfig(next));
            setDirty(false);
            setConflict(false);
            setEditorMessage(`已重新載入 revision ${next.revision}。`);
        } catch {
            setEditorMessage('重新載入失敗，請確認本機監控 API。');
        }
    };

    const capacity = status?.capacity;
    const visibleItems = (view === 'monitor' ? draft?.items : config?.items) ?? [];
    const label = overallMonitorLabel(status, offline, connection);
    const sortedResults = useMemo(
        () => sortIntradayMonitorResults(results, resultSort),
        [resultSort, results],
    );
    const liveResultCount = results.filter((item) => item.kind === 'live').length;
    const historicalResultCount = results.length - liveResultCount;
    const statusBySymbol = useMemo(
        () => new Map((status?.itemStatuses ?? []).map((item) => [item.canonicalSymbol, item])),
        [status?.itemStatuses],
    );
    const otherUsage = capacity?.confirmedOtherPhysicalUsage;
    const approval = status?.approval;
    const session = status?.session;
    const baselineSummary = status?.baselineSummary;
    const freshness = status?.freshness;
    const notice = offline
        ? `本機監控 API 離線；${results.length > 0 ? '既有結果僅供歷史檢視，' : ''}不代表目前仍在即時監控。`
        : session && !session.current
          ? `容量核准仍保留為歷史紀錄；今日監控未啟動（${reasonLabels[session.staleReason ?? 'current_session_missing'] ?? session.staleReason ?? 'current_session_missing'}）。`
        : label === '等待 bounded Gate'
          ? '目前仍缺少可驗證的全域 subscription 計數與釋放證據；安全上限維持 0，不會啟動即時監控。'
          : connection === 'paused'
          ? '頁面 lease 已失效或尚未恢復；監控與新結果已暫停，系統會以有界退避重新連線。'
          : connection === 'reconnecting'
            ? 'SSE 或 lease 正在重新連線；既有結果保留，完成恢復前不宣稱即時 ready。'
            : label === '等待首筆行情'
              ? '批次訂閱已接受，正在等待逐檔第一筆合法 KBar；尚未收到行情的商品不會列為 data active。'
            : label === '等待基準'
                ? 'subscription 可用，但上一交易日同分鐘基準尚未完整；不會產生達標事件。'
                : label === '等待容量'
                  ? '共享 subscription 容量不足；等待商品不會輪替監控。'
                  : label === '部分 degraded'
                    ? '部分商品的串流、連續性或 subscription 證據不足；受影響商品不會新增觸發。'
                    : `可用容量 ${capacity?.availableForMonitor ?? 0}，保留 headroom ${capacity?.requiredHeadroom ?? 40}。`;
    const emptyResultMessage = emptyIntradayMonitorResultMessage(status, offline, connection);
    const systemNotificationLabel = systemNotificationPermission === 'unsupported'
        ? '不支援'
        : systemNotificationPermission === 'denied'
          ? '權限已拒絕'
          : systemNotificationPermission === 'default'
            ? '尚未授權'
            : systemNotificationEnabled
              ? '已開啟'
              : '已授權、目前關閉';
    const evaluationStateLabel = ({
        not_scheduled: '未排程',
        offline_only: '僅離線',
        preflight_blocked: 'preflight 阻擋',
        running: '執行中',
        pending_evidence: '等待 evidence',
        ready_for_review: '待人工審查',
        go: 'GO',
        no_go: 'NO-GO',
        rollback: 'rollback',
    } as const)[capacity?.evaluationState ?? 'not_scheduled'];
    const reviewerLabel = approval?.reviewerType === 'human'
        ? '人工簽核'
        : approval?.reviewerType === 'codex_delegated'
          ? 'Codex 代理審閱'
          : approval?.reviewerType === 'system'
            ? '系統判定'
            : '未證實';
    const approvalDecisionLabel = approval?.decision
        ? approval.decision === 'go' ? 'GO' : approval.decision === 'no_go' ? 'NO-GO' : 'rollback'
        : evaluationStateLabel;

    return (
        <div className={styles.root} data-testid='intraday-monitor-panel'>
            <div className={styles.statusSummary} aria-label='盤中監控狀態摘要'>
                <section className={styles.statusGroup} aria-label='容量核准'>
                    <h3 className={styles.statusGroupTitle}>容量核准（歷史決策）</h3>
                    <div className={styles.statusStrip}>
                        {[
                            ['核准上限', String(approval?.approvedActiveLimit ?? capacity?.approvedActiveLimit ?? 20)],
                            ['決策', approvalDecisionLabel],
                            ['證據日期', approval?.evidenceTradeDate ?? '未證實'],
                            ['審閱來源', reviewerLabel],
                            ['provider 證據', [
                                `usage ${capacity?.confirmedPhysicalUsage ?? '未知'}`,
                                `other ${otherUsage ?? '未知'}`,
                                `ownership ${capacity?.globalOwnershipComplete === true ? '已證實' : '未知'}`,
                                `release ${capacity?.providerReleaseProven === true ? '已證實' : '未知'}`,
                                `headroom ${capacity?.confirmedHeadroom ?? '未知'}`,
                            ].join(' · ')],
                            ['要求保留', String(capacity?.requiredHeadroom ?? 40)],
                        ].map(([name, value]) => (
                            <div className={`${styles.metric} ${name === 'provider 證據' ? styles.providerEvidenceMetric : ''}`} key={name} title={`${name}：${value}`}>
                                <span className={styles.metricLabel}>{name}</span>
                                <span className={`${styles.metricValue} ${name === 'provider 證據' ? styles.providerEvidenceMetricValue : ''}`}>{value}</span>
                            </div>
                        ))}
                    </div>
                </section>
                <section className={styles.statusGroup} aria-label='今日監控'>
                    <h3 className={styles.statusGroupTitle}>今日監控（current session）</h3>
                    <div className={styles.statusStrip}>
                        {[
                            ['狀態', label],
                            ['交易日', session?.authorityTradeDate ?? '未證實'],
                            ['session', session?.current ? session.phase ?? 'running' : '未啟動'],
                            ['啟動來源', session?.startupSource === 'late_boot'
                                ? `晚開機接續 · 冷啟動風險${session.scheduled0820Success === false ? ' · 08:20 未完成' : ''}`
                                : session?.startupSource === 'scheduled' ? '固定盤前排程' : '未證實'],
                            ['設定／admitted', `${capacity?.configured ?? visibleItems.length}／${capacity?.admitted ?? Math.min(capacity?.eligible ?? 0, approval?.approvedActiveLimit ?? 20)}`],
                            ['資料 active', String(capacity?.dataActive ?? 0)],
                            ['訂閱／首筆', `${session?.controlPlaneAccepted === true ? '已接受' : '未接受'} · ${session?.firstKbarAt ?? '尚無首筆'}`],
                            ['等待 pilot limit', String(capacity?.waitingPilotLimit ?? 0)],
                            ['等待容量', String(capacity?.waitingCapacity ?? 0)],
                            ['等待基準', String(capacity?.waitingBaseline ?? 0)],
                            ['降級', String(capacity?.degraded ?? 0)],
                            ['基準完整度', `完整 ${baselineSummary?.complete ?? 0} · 缺漏 ${baselineSummary?.missing ?? 0} · stale ${baselineSummary?.stale ?? 0} · 未知 ${baselineSummary?.unknown ?? 0}`],
                            ['evidence', freshness?.fresh ? `fresh · ${freshness.evidenceAt ?? '—'}` : `stale／未證實 · ${freshness?.evidenceAt ?? '—'}`],
                        ].map(([name, value]) => (
                            <div className={`${styles.metric} ${name === '狀態' ? styles.statusMetric : ''} ${name === '基準完整度' || name === 'evidence' ? styles.providerEvidenceMetric : ''}`} key={name} title={`${name}：${value}`}>
                                <span className={styles.metricLabel}>{name}</span>
                                <span className={`${styles.metricValue} ${name === '狀態' ? styles.statusMetricValue : ''} ${name === '基準完整度' || name === 'evidence' ? styles.providerEvidenceMetricValue : ''}`}>{value}</span>
                            </div>
                        ))}
                    </div>
                </section>
                {postcloseRecovery && (
                    <section className={styles.statusGroup} aria-label='盤後尾端資料復原'>
                        <h3 className={styles.statusGroupTitle}>盤後尾端資料（與即時驗收分開）</h3>
                        <div className={styles.statusStrip}>
                            {[
                                ['原始 live 最後分鐘', postcloseRecovery.liveLastMinute ?? '未證實'],
                                ['盤後來源', postcloseRecovery.postcloseDataRecovered
                                    ? `已核實 ${postcloseRecovery.recoveredSymbolCount} 檔 · 來源非即時`
                                    : `未核實 · ${postcloseRecovery.reason ?? '部分商品資料不足'}`],
                                ['正式 live 驗收', postcloseRecovery.originalFormalAcceptanceEvidence === true
                                    ? '通過' : postcloseRecovery.originalFormalAcceptanceEvidence === false
                                      ? '未通過' : '未證實'],
                                ['已補分鐘', postcloseRecovery.postcloseDataRecovered
                                    ? [...new Set(postcloseRecovery.recoveredRows.map((row) => row.minuteKey))].join('、')
                                    : '未證實'],
                            ].map(([name, value]) => (
                                <div className={styles.metric} key={name} title={`${name}：${value}`}>
                                    <span className={styles.metricLabel}>{name}</span>
                                    <span className={styles.metricValue}>{value}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
                {dailyStatus?.mode === 'daily_plan' && (
                    <section className={styles.statusGroup} aria-label='每日監控名單'>
                        <h3 className={styles.statusGroupTitle}>每日名單（新流程，與歷史 Stage 分開）</h3>
                        <div className={styles.statusStrip}>
                            {[
                                ['生效交易日', dailyStatus.effectiveTradeDate ?? '未證實'],
                                ['設定 revision', `${dailyStatus.planRevision ?? '—'}／目前 ${dailyStatus.configRevision}`],
                                ['規劃／候補', `${dailyStatus.planned}／${dailyStatus.waitingCapacity}`],
                                ['基準就緒', `${dailyStatus.baselineReady}／${dailyStatus.planned}`],
                                ['訂閱／資料 active', `${dailyStatus.subscriptionRequested}／${dailyStatus.dataActive}`],
                                ['降級', dailyStatus.degraded === null ? '未證實' : String(dailyStatus.degraded)],
                                ['待生效 revision', dailyStatus.pendingRevision === null ? '無' :
                                    `${dailyStatus.pendingRevision}（${dailyStatus.pendingReason ?? '尚未驗證'}）`],
                                ['資料證據', dailyStatus.evidenceState === 'observed' ? '已觀測' :
                                    '尚未有合法盤中資料'],
                            ].map(([name, value]) => (
                                <div className={styles.metric} key={name} title={`${name}：${value}`}>
                                    <span className={styles.metricLabel}>{name}</span>
                                    <span className={styles.metricValue}>{value}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
            <p className={styles.notice} role='status' aria-live='polite'>
                {notice}
            </p>
            <section className={styles.notificationControls} aria-label='盤中達標通知設定'>
                <div className={styles.notificationButtons}>
                    <button className={styles.notificationButton} type='button' aria-pressed={soundEnabled}
                        onClick={toggleSound}>{soundEnabled ? '關閉頁內提示音' : '開啟頁內提示音'}</button>
                    <button className={styles.notificationButton} type='button' aria-pressed={systemNotificationEnabled}
                        onClick={() => void toggleSystemNotification()}>
                        {systemNotificationEnabled ? '關閉系統通知' : '開啟系統通知'}
                    </button>
                </div>
                <span className={styles.notificationState}>
                    頁內提示音：{soundEnabled ? '已開啟' : '已關閉'}；系統通知：{systemNotificationLabel}
                </span>
                <p className={styles.notificationMessage} role='status' aria-live='polite' aria-atomic='true'>
                    {notificationMessage}
                </p>
            </section>
            <div className={styles.tabs} role='tablist' aria-label='盤中選股內容'>
                <button className={styles.tab} role='tab' aria-selected={view === 'results'} onClick={() => setView('results')}>量比結果 {results.length}</button>
                <button className={styles.tab} role='tab' aria-selected={view === 'monitor'} onClick={() => setView('monitor')}>監控名單 {visibleItems.length}</button>
            </div>
            <div className={styles.list} role='tabpanel'>
                {view === 'results' && results.length > 0 && (
                    <div className={styles.resultControls}>
                        <div className={styles.resultToolbar}>
                            <strong>已有結果 {results.length}（即時 {liveResultCount}／歷史重播 {historicalResultCount}）</strong>
                            <label className={styles.resultSortLabel}>排序
                                <select className={styles.sortSelect} aria-label='結果排序' value={resultSort}
                                    onChange={(event) => setResultSort(event.target.value as IntradayMonitorResultSort)}>
                                    <option value='trigger_time'>觸發時間</option>
                                    <option value='ratio'>目前量比</option>
                                    <option value='code'>股票代碼</option>
                                </select>
                            </label>
                        </div>
                        <div className={styles.chartTargetBar}>
                            <label className={styles.resultSortLabel}>目標 K 線圖
                                <select className={styles.sortSelect} aria-label='盤中結果目標 K 線圖' value={effectiveTarget}
                                    onChange={(event) => {
                                        pickingGenerationRef.current += 1;
                                        onTargetChange();
                                        setTargetId(event.target.value);
                                        setSelectionMessage('');
                                    }}>
                                    <option value=''>請選擇圖表</option>
                                    {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                                </select>
                            </label>
                            <button className={styles.smallButton} type='button' onClick={() => {
                                pickingGenerationRef.current += 1;
                                onTargetChange();
                                void Promise.resolve(onOpenChart()).then(
                                    (id) => {
                                        if (id) {
                                            setTargetId(id);
                                            setSelectionMessage('已新增並指定日 K 圖。');
                                        }
                                    },
                                    (error: unknown) => setSelectionMessage(error instanceof Error ? error.message : '無法新增日 K 圖'),
                                );
                            }}>新增日 K 圖</button>
                        </div>
                        {!targets.length && <p className={styles.editorMessage}>目前沒有未鎖定圖表，請新增日 K 圖，或先解鎖既有圖表。</p>}
                        {selectionMessage && <p className={styles.editorMessage} role='status'>{selectionMessage}</p>}
                    </div>
                )}
                {view === 'results' && sortedResults.map((item) => {
                    const code = item.canonicalSymbol.split('.')[0] ?? '';
                    const current = latestRatio(item);
                    const triggered = triggerRatio(item);
                    const addState = addStates[item.canonicalSymbol];
                    return (
                        <article className={styles.resultCard} key={item.eventId} data-kind={item.kind}>
                            <div className={styles.resultTop}>
                                <button className={styles.resultMain} type='button'
                                    aria-label={`在指定 K 線圖開啟 ${code} ${namesByCode[code] ?? ''}`.trim()}
                                    onClick={() => void pickStock(resultStock(item))}>
                                    <span>
                                        <span className={styles.rowTitle}>{item.canonicalSymbol}{namesByCode[code] ? ` · ${namesByCode[code]}` : ''}</span>
                                        <span className={styles.rowMeta}>{item.exchange === 'TSE' ? '上市' : '上櫃'} · {item.kind === 'live' ? '即時觸發' : '歷史重播（不通知）'}</span>
                                        <span className={styles.rowMeta}>{item.tradeDate}／{item.baselineTradeDate} · 同分鐘 {item.minuteKey}</span>
                                    </span>
                                    <span className={styles.ratioBlock}>
                                        <span className={styles.ratio}>{current ? `${current}×` : '—'}</span>
                                        <span className={styles.rowMeta}>觸發 {triggered ? `${triggered}×` : '不可比較'}</span>
                                    </span>
                                </button>
                                <button className={styles.addButton} type='button'
                                    aria-label={`將 ${code} ${namesByCode[code] ?? ''} 加入盤中選股清單`.trim()}
                                    disabled={addState?.status === 'pending' || addState?.status === 'added' || addState?.status === 'already_present'}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void addResultToWatchlist(item);
                                    }}>
                                    {addState?.status === 'pending'
                                        ? '加入中…'
                                        : addState?.status === 'added' || addState?.status === 'already_present'
                                          ? '已加入'
                                          : '加入清單'}
                                </button>
                            </div>
                            {addState && <p className={addState.status === 'error' ? styles.addError : styles.addStatus}
                                role={addState.status === 'error' ? 'alert' : 'status'} aria-live='polite'>{addState.message}</p>}
                            <details className={styles.evidenceDetails}>
                                <summary className={styles.evidenceSummary}>查看 evidence</summary>
                                <dl className={styles.evidenceGrid}>
                                    {[
                                        ['門檻', `${item.threshold}×`],
                                        ['觸發量', `${item.currentCumulativeVolume.toLocaleString()}／${item.previousCumulativeVolume.toLocaleString()} 張`],
                                        ['目前完成分鐘', item.currentEvidence?.minuteKey ?? '尚無更新'],
                                        ['目前量', item.currentEvidence ? `${item.currentEvidence.currentCumulativeVolume.toLocaleString()}／${item.currentEvidence.previousCumulativeVolume?.toLocaleString() ?? '—'} 張` : '—'],
                                        ['完整度', item.currentEvidence?.completeness ?? item.completeness ?? 'unknown'],
                                        ['來源', item.currentEvidence?.sourceVersion ?? item.sourceVersion ?? 'unknown'],
                                        ['公式', item.formulaVersion ?? 'unknown'],
                                        ['設定 revision', String(item.configRevision ?? '—')],
                                        ['最後更新', item.currentEvidence?.updatedAt ?? item.createdAt ?? '—'],
                                    ].map(([term, value]) => <div className={styles.evidenceEntry} key={term}><dt className={styles.evidenceTerm}>{term}</dt><dd className={styles.evidenceValue}>{value}</dd></div>)}
                                </dl>
                            </details>
                        </article>
                    );
                })}
                {view === 'monitor' && draft && (
                    <section className={styles.editor} aria-label='盤中監控設定編輯器'>
                        <div className={styles.editorHeader}>
                            <strong>設定草稿 · revision {draft.revision}</strong>
                            <span>{draft.items.length}／200 檔</span>
                        </div>
                        <label className={styles.fieldLabel}>
                            全域量比門檻
                            <span className={styles.inlineField}>
                                <input className={styles.input} aria-label='全域量比門檻' inputMode='decimal' value={draft.globalThreshold}
                                    onChange={(event) => editDraft((current) => ({ ...current, globalThreshold: event.target.value }))} />
                                {[1.5, 2, 3].map((threshold) => <button className={styles.smallButton} key={threshold} type='button'
                                    onClick={() => editDraft((current) => ({ ...current, globalThreshold: String(threshold) }))}>{threshold}×</button>)}
                            </span>
                        </label>
                        <details className={styles.importDetails} open={draft.items.length === 0 ? true : undefined}>
                            <summary className={styles.importSummary}>新增／匯入商品</summary>
                            <div className={styles.importGrid}>
                            <label className={`${styles.fieldLabel} ${styles.searchField}`}>單筆搜尋
                                <span className={styles.inlineField}>
                                    <input className={styles.input} role='combobox' aria-label='單筆股票代號或股名'
                                        aria-autocomplete='list' aria-expanded={singleSuggestions.length > 0}
                                        aria-controls='intraday-monitor-instrument-suggestions'
                                        aria-activedescendant={singleSuggestions[singleActiveIndex] ? `intraday-monitor-instrument-${singleSuggestions[singleActiveIndex]!.symbol}` : undefined}
                                        placeholder='例如 2330 或 台積電' value={singleQuery}
                                        onChange={(event) => {
                                            setSingleQuery(event.target.value);
                                            setSingleSelection(null);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'ArrowDown' && singleSuggestions.length > 0) {
                                                event.preventDefault();
                                                setSingleActiveIndex((current) => (current + 1) % singleSuggestions.length);
                                            } else if (event.key === 'ArrowUp' && singleSuggestions.length > 0) {
                                                event.preventDefault();
                                                setSingleActiveIndex((current) => (current - 1 + singleSuggestions.length) % singleSuggestions.length);
                                            } else if (event.key === 'Enter' && singleSuggestions[singleActiveIndex]) {
                                                event.preventDefault();
                                                chooseSingleSuggestion(singleSuggestions[singleActiveIndex]!);
                                            } else if (event.key === 'Escape') {
                                                setSingleSuggestions([]);
                                                setSingleSearchState('idle');
                                            }
                                        }} />
                                    <button className={styles.smallButton} type='button' disabled={importing || (!singleSelection && !/^\s*\d{4,6}[A-Z]?\s*$/iu.test(singleQuery))} onClick={() => {
                                        const code = singleSelection?.code ?? parseIntradayMonitorTokens(singleQuery)[0];
                                        if (code) void importCandidates([{ code, source: 'manual' }]);
                                    }}>加入草稿</button>
                                </span>
                                {singleSuggestions.length > 0 && (
                                    <div className={styles.suggestionBox} id='intraday-monitor-instrument-suggestions' role='listbox' aria-label='股票搜尋候選'>
                                        {singleSuggestions.map((suggestion, index) => (
                                            <button id={`intraday-monitor-instrument-${suggestion.symbol}`} key={suggestion.symbol}
                                                className={styles.suggestionRow} type='button' role='option'
                                                aria-selected={index === singleActiveIndex}
                                                onMouseEnter={() => setSingleActiveIndex(index)}
                                                onClick={() => chooseSingleSuggestion(suggestion)}>
                                                <span className={styles.suggestionCode}>{suggestion.code}</span>
                                                <span className={styles.suggestionName}>{suggestion.name}</span>
                                                <span className={styles.suggestionMarket}>{suggestion.exchange === 'TSE' ? '上市' : '上櫃'}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {singleSearchState === 'loading' && <p className={styles.searchHint} role='status'>正在搜尋股名與代號…</p>}
                                {singleSearchState === 'ready' && singleSuggestions.length === 0 && <p className={styles.searchHint} role='status'>查無相符股票；請調整股名或直接輸入代號。</p>}
                                {singleSearchState === 'error' && <p className={styles.searchHint} role='status'>股名搜尋目前不可用；仍可直接輸入股票代號加入草稿。</p>}
                            </label>
                            <label className={styles.fieldLabel}>批次貼上
                                <textarea className={styles.textarea} aria-label='批次股票代碼' placeholder='可用換行、逗號或空白分隔' value={batchCodes}
                                    onChange={(event) => setBatchCodes(event.target.value)} />
                                <button className={styles.smallButton} type='button' disabled={importing || !batchCodes.trim()} onClick={() => void importCandidates(
                                    parseIntradayMonitorTokens(batchCodes).map((code) => ({ code, source: 'manual' })),
                                )}>解析並加入草稿</button>
                            </label>
                            <label className={styles.fieldLabel}>自選清單
                                <span className={styles.inlineField}>
                                    <select className={styles.input} aria-label='選擇自選清單' value={watchlistId} onChange={(event) => setWatchlistId(event.target.value)}>
                                        <option value=''>選擇清單</option>
                                        {watchlists.map((list) => <option value={list.id} key={list.id}>{list.name}（{list.contracts.length}）</option>)}
                                    </select>
                                    <button className={styles.smallButton} type='button' disabled={importing || !watchlistId} onClick={() => {
                                        const selected = watchlists.find((list) => list.id === watchlistId);
                                        if (selected) void importCandidates(selected.contracts.map((contract) => ({ code: contract.code, source: 'watchlist' })));
                                    }}>匯入草稿</button>
                                </span>
                            </label>
                            <label className={styles.fieldLabel}>MultiView 我的清單
                                <span className={styles.inlineField}>
                                    <select className={styles.input} aria-label='選擇 MultiView 我的清單'
                                        value={multiViewListId} disabled={multiViewListState === 'loading'}
                                        onChange={(event) => setMultiViewListId(event.target.value)}>
                                        <option value=''>{multiViewListState === 'loading' ? '正在讀取清單…' : '選擇清單'}</option>
                                        {multiViewLists.map((list) => (
                                            <option value={list.id} key={list.id}>
                                                {list.name}（{list.items.length} 檔台股）{list.enabled ? '' : '－已隱藏'}
                                            </option>
                                        ))}
                                    </select>
                                    <button className={styles.smallButton} type='button'
                                        disabled={importing || !multiViewListId || multiViewListState !== 'ready'}
                                        onClick={() => {
                                            const selected = multiViewLists.find((list) => list.id === multiViewListId);
                                            if (selected) void importCandidates(selected.items.map((item) => ({ code: item.code, source: 'watchlist' })));
                                        }}>匯入草稿</button>
                                </span>
                                {multiViewListState === 'ready' && multiViewLists.length === 0 && (
                                    <span className={styles.searchHint} role='status'>MultiView 我的清單目前沒有可匯入的台股。</span>
                                )}
                                {multiViewListState === 'error' && (
                                    <span className={styles.searchHint} role='status'>
                                        無法讀取 MultiView 我的清單。
                                        <button className={styles.smallButton} type='button' onClick={() => setMultiViewReload((current) => current + 1)}>重新讀取</button>
                                    </span>
                                )}
                            </label>
                            <div className={styles.fieldLabel}>盤後選股結果
                                <button className={styles.smallButton} type='button' disabled={importing} onClick={() => {
                                    setImporting(true);
                                    setEditorMessage('正在讀取最近儲存的盤後選股條件結果…');
                                    void loadSavedAfterMarketScreenerSelection()
                                        .then((selection) => importCandidates(selection.codes.map((code) => ({ code, source: 'after_market_screener' }))))
                                        .catch(() => setEditorMessage('沒有可匯入的已備齊盤後選股結果。'))
                                        .finally(() => setImporting(false));
                                }}>匯入最近結果至草稿</button>
                            </div>
                            </div>
                        </details>
                        {(importReport.accepted.length + importReport.duplicates.length + importReport.invalid.length + importReport.overLimit.length > 0) && (
                            <div className={styles.importReport} aria-label='匯入分類結果'>
                                {[
                                    ['接受', importReport.accepted.map((item) => item.contract.code)],
                                    ['重複', importReport.duplicates],
                                    ['無效', importReport.invalid],
                                    ['超限', importReport.overLimit],
                                ].map(([name, codes]) => (
                                    <span key={name as string} title={(codes as string[]).join('、')}>
                                        {name as string} {(codes as string[]).length}{(codes as string[]).length > 0 ? `：${(codes as string[]).slice(0, 8).join('、')}${(codes as string[]).length > 8 ? '…' : ''}` : ''}
                                    </span>
                                ))}
                            </div>
                        )}
                        {editorMessage && <p className={conflict ? styles.conflict : styles.editorMessage} role='status'>{editorMessage}</p>}
                        <div className={styles.saveBar}>
                            {conflict && <button className={styles.smallButton} type='button' onClick={() => void reloadConfig()}>重新載入設定</button>}
                            <button className={styles.primaryButton} type='button' disabled={!dirty || saving || importing || conflict || offline} onClick={() => void saveDraft()}>
                                {saving ? '儲存中…' : `儲存設定（${draft.items.length} 檔）`}
                            </button>
                        </div>
                    </section>
                )}
                {view === 'monitor' && visibleItems.map((item, index) => {
                    const key = canonicalMonitorKey(item);
                    const symbol = `${item.contract.code}.${item.contract.exchange === 'TSE' ? 'TW' : 'TWO'}`;
                    const itemStatus = statusBySymbol.get(symbol);
                    const itemRatio = itemStatus?.currentCumulativeVolume === null || itemStatus?.currentCumulativeVolume === undefined
                        ? null
                        : itemStatus.previousCumulativeVolume && itemStatus.previousCumulativeVolume > 0
                          ? (itemStatus.currentCumulativeVolume / itemStatus.previousCumulativeVolume).toFixed(2)
                          : null;
                    const effectiveThreshold = itemStatus?.effectiveThreshold ?? item.thresholdOverride ?? draft?.globalThreshold ?? '1.5';
                    const stateText = itemStatus
                        ? itemStateLabels[itemStatus.state]
                        : dirty ? '草稿未提交' : '狀態尚未取得';
                    return (
                        <div className={styles.editRow} key={key}>
                            <button className={styles.symbolButton} type='button' onClick={() => void pickStock({
                                code: item.contract.code,
                                symbol,
                                name: namesByCode[item.contract.code] ?? item.contract.code,
                                market: item.contract.exchange === 'TSE' ? 'TWSE' : 'TPEx',
                                kind: 'ordinary',
                            })}>
                                <span className={styles.editRowTitle}>{item.contract.code} · {namesByCode[item.contract.code] ?? '股名載入中…'}</span>
                                <span className={styles.editRowMeta}>{item.contract.exchange === 'TSE' ? '上市' : '上櫃'} · {item.source}</span>
                            </button>
                            <label className={styles.toggleLabel}><input type='checkbox' checked={item.enabled}
                                onChange={(event) => editDraft((current) => ({ ...current, items: updateIntradayMonitorDraftItem(current.items, key, { enabled: event.target.checked }) }))} />監控</label>
                            <label className={styles.thresholdLabel}>門檻
                                <input className={styles.thresholdInput} aria-label={`${item.contract.code} 個別門檻`} inputMode='decimal'
                                    placeholder={draft?.globalThreshold ?? '1.5'} value={item.thresholdOverride ?? ''}
                                    onChange={(event) => editDraft((current) => ({ ...current, items: updateIntradayMonitorDraftItem(current.items, key, { thresholdOverride: event.target.value || null }) }))} />
                            </label>
                            <div className={styles.rowActions}>
                                <button type='button' className={styles.iconButton} aria-label={`${item.contract.code} 上移`} disabled={index === 0}
                                    onClick={() => editDraft((current) => ({ ...current, items: moveIntradayMonitorDraftItem(current.items, key, -1) }))}>↑</button>
                                <button type='button' className={styles.iconButton} aria-label={`${item.contract.code} 下移`} disabled={index === visibleItems.length - 1}
                                    onClick={() => editDraft((current) => ({ ...current, items: moveIntradayMonitorDraftItem(current.items, key, 1) }))}>↓</button>
                                <button type='button' className={styles.iconButton} aria-label={`刪除 ${item.contract.code}`}
                                    onClick={() => editDraft((current) => ({ ...current, items: removeIntradayMonitorDraftItem(current.items, key) }))}>刪</button>
                            </div>
                            <div className={styles.itemEvidence} aria-label={`${item.contract.code} 監控狀態`}>
                                <span><b className={styles.itemState}>{stateText}</b> · 門檻 {effectiveThreshold}×</span>
                                <span>基準 {itemStatus?.baseline.tradeDate ?? '—'}／{itemStatus?.baseline.state ?? 'unknown'}</span>
                                <span>訂閱 {itemStatus?.subscription.state ?? 'unknown'}</span>
                                <span>完成分鐘 {itemStatus?.completedMinute ?? diagnostics?.completedMinute?.minuteKey ?? '—'}</span>
                                <span>量比 {itemRatio ? `${itemRatio}×` : '—'}</span>
                                <span>更新 {itemStatus?.updatedAt ?? status?.observedAt ?? '—'}</span>
                                <span>原因：{reasonLabels[itemStatus?.reason ?? 'unavailable'] ?? itemStatus?.reason ?? '尚未取得'}</span>
                            </div>
                        </div>
                    );
                })}
                {((view === 'results' && results.length === 0) || (view === 'monitor' && visibleItems.length === 0)) && (
                    <div className={styles.empty}>{view === 'results' ? emptyResultMessage : offline ? '服務離線；仍可編輯草稿，但需恢復後才能儲存。' : '監控名單尚未設定。'}</div>
                )}
            </div>
            <div className={styles.footer}>
                <span>當日：{tradeDate}</span>
                <span>stream：{connection} · 最後連線 {lastStreamAt ?? '—'}</span>
            </div>
        </div>
    );
}
