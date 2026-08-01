// src/hooks/use-watchlist.ts — fully server-backed watchlists (CRUD works
// on shioaji server ≥1.5.3). Every list is editable; edits sync via PUT.
// First run migrates the old local list / creates a default one.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ensureContract,
    primeContract,
    refreshCachedContracts,
} from '../lib/contracts-cache';
import {
    createWatchlist,
    deleteWatchlist,
    fetchSnapshots,
    fetchWatchlists,
    addWatchlistContracts,
    removeWatchlistContracts,
    renameWatchlist,
    resolveContract as resolveContractV2,
    subscribeContractQuotes,
    syncWatchlist,
    type ServerWatchlist,
} from '../lib/shioaji';
import { onContractEvent, registerCodeAlias } from '../lib/stream';
import { notify } from '../lib/trade';
import type { ContractInfo, SecurityType } from '../lib/types/contract';
import type { Snapshot } from '../lib/types/market';

export interface WatchItem {
    contract: ContractInfo;
    snapshot?: Snapshot;
}

export interface WatchlistServiceIssue {
    kind: 'session-unavailable' | 'unavailable';
    title: string;
    detail: string;
}

const DEFAULT_LIST_NAME = '我的自選';
const DEFAULT_SYMBOLS: { code: string; type: SecurityType }[] = [
    { code: '2330', type: 'STK' },
    { code: '2317', type: 'STK' },
    { code: '2454', type: 'STK' },
    { code: '2603', type: 'STK' },
    { code: '0050', type: 'STK' },
    { code: 'TXFR1', type: 'FUT' },
];

const LEGACY_KEY = 'sj-pro-watchlist';
const ACTIVE_KEY = 'sj-pro-active-watchlist';

function isSessionUnavailable(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.message.includes('SessionNotEstablished')
    );
}

function isSimulationSessionUnavailable(error: unknown): boolean {
    return (
        isSessionUnavailable(error) &&
        error instanceof Error &&
        error.message.includes('/paper/')
    );
}

function serviceIssueFor(error: unknown): WatchlistServiceIssue {
    if (isSimulationSessionUnavailable(error)) {
        return {
            kind: 'session-unavailable',
            title: '模擬服務離線／非服務時間',
            detail: '目前無法建立 Shioaji 模擬 session；行情、自選與交易功能暫不可用。模擬服務時間為週一至週五 08:00–20:00。',
        };
    }
    return {
        kind: 'unavailable',
        title: '交易服務暫時無法使用',
        detail: '已進入離線工作區；行情、自選與交易功能暫不可用，請稍後重新檢查。',
    };
}

async function resolveContract(
    code: string,
    type?: SecurityType | null,
): Promise<ContractInfo> {
    if (type) return resolveContractV2(code, type);
    return ensureContract(code);
}

export function useWatchlist() {
    const [items, setItems] = useState<WatchItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [initialLoading, setInitialLoading] = useState(true);
    const [serviceIssue, setServiceIssue] =
        useState<WatchlistServiceIssue | null>(null);
    const [serviceRetrying, setServiceRetrying] = useState(false);
    const [serverLists, setServerLists] = useState<ServerWatchlist[]>([]);
    const [activeListId, setActiveListId] = useState<string>('');
    const subscribed = useRef(new Set<string>());
    const initStarted = useRef(false);
    const loadSeq = useRef(0);
    const activeIdRef = useRef('');
    activeIdRef.current = activeListId;

    const subscribeContract = useCallback(async (contract: ContractInfo) => {
        if (contract.target_code) {
            registerCodeAlias(contract.target_code, contract.code);
        }
        primeContract(contract);
        if (!subscribed.current.has(contract.code)) {
            subscribed.current.add(contract.code);
            await subscribeContractQuotes(contract);
        }
    }, []);

    const attachSnapshots = useCallback((contracts: ContractInfo[]) => {
        if (contracts.length === 0) return;
        fetchSnapshots(contracts)
            .then((snaps) => {
                const byCode = new Map(snaps.map((s) => [s.code, s]));
                setItems((prev) =>
                    prev.map((i) => {
                        const snap =
                            byCode.get(i.contract.code) ??
                            (i.contract.target_code
                                ? byCode.get(i.contract.target_code)
                                : undefined);
                        return snap ? { ...i, snapshot: snap } : i;
                    }),
                );
            })
            .catch(() => undefined);
    }, []);

    const refreshLists = useCallback(async (): Promise<ServerWatchlist[]> => {
        const lists = await fetchWatchlists();
        setServerLists(lists);
        return lists;
    }, []);

    // push the current items to the server (PUT replaces all contracts)
    const persistItems = useCallback(
        (next: WatchItem[]) => {
            const id = activeIdRef.current;
            if (!id) return;
            syncWatchlist(
                id,
                next.map((i) => i.contract),
            )
                .then(() => refreshLists())
                .catch(() =>
                    notify({
                        kind: 'err',
                        title: '自選清單同步失敗',
                        body: '與伺服器同步時發生錯誤',
                    }),
                );
        },
        [refreshLists],
    );

    const loadList = useCallback(
        async (list: ServerWatchlist) => {
            const seq = ++loadSeq.current;
            setLoading(true);
            setItems([]);
            const results = await Promise.allSettled(
                list.contracts.map((c) =>
                    resolveContract(c.code, c.security_type),
                ),
            );
            if (loadSeq.current !== seq) return;
            const contracts = results
                .filter(
                    (r): r is PromiseFulfilledResult<ContractInfo> =>
                        r.status === 'fulfilled',
                )
                .map((r) => r.value);
            const migrated =
                results.every((result) => result.status === 'fulfilled') &&
                contracts.some(
                    (contract, index) =>
                        contract.code !== list.contracts[index]?.code,
                );
            await Promise.allSettled(contracts.map(subscribeContract));
            if (loadSeq.current !== seq) return;
            setItems(contracts.map((c) => ({ contract: c })));
            attachSnapshots(contracts);
            if (migrated) {
                await syncWatchlist(list.id, contracts);
                await refreshLists();
            }
            setLoading(false);
        },
        [subscribeContract, attachSnapshots, refreshLists],
    );

    const setActiveList = useCallback(
        (listId: string, listsOverride?: ServerWatchlist[]) => {
            const list = (listsOverride ?? serverLists).find(
                (l) => l.id === listId,
            );
            if (!list) return;
            setActiveListId(listId);
            localStorage.setItem(ACTIVE_KEY, listId);
            void loadList(list);
        },
        [serverLists, loadList],
    );

    const addSymbol = useCallback(
        async (
            code: string,
            type?: SecurityType,
            resolved?: ContractInfo,
        ) => {
            const contract = resolved ?? (await resolveContract(code, type));
            if (resolved) primeContract(resolved);
            if (items.some((i) => i.contract.code === contract.code)) {
                return contract;
            }
            await subscribeContract(contract);
            const id = activeIdRef.current;
            if (id) {
                await addWatchlistContracts(id, [contract]);
                await refreshLists();
            }
            setItems((prev) => [...prev, { contract }]);
            attachSnapshots([contract]);
            return contract;
        },
        [
            items,
            subscribeContract,
            attachSnapshots,
            refreshLists,
        ],
    );

    const removeSymbol = useCallback(
        async (code: string) => {
            const item = items.find((i) => i.contract.code === code);
            if (!item) return;
            const id = activeIdRef.current;
            if (id) {
                await removeWatchlistContracts(id, [item.contract]);
                await refreshLists();
            }
            setItems((prev) =>
                prev.filter((i) => i.contract.code !== code),
            );
        },
        [items, refreshLists],
    );

    // drag-to-reorder: move `fromCode` to the position of `toCode`
    const reorderSymbol = useCallback(
        (fromCode: string, toCode: string) => {
            setItems((prev) => {
                const fromIdx = prev.findIndex(
                    (i) => i.contract.code === fromCode,
                );
                const toIdx = prev.findIndex(
                    (i) => i.contract.code === toCode,
                );
                if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) {
                    return prev;
                }
                const next = [...prev];
                const [moved] = next.splice(fromIdx, 1);
                next.splice(toIdx, 0, moved!);
                persistItems(next);
                return next;
            });
        },
        [persistItems],
    );

    const createList = useCallback(
        async (name: string) => {
            const wl = await createWatchlist(name, []);
            const lists = await refreshLists();
            setActiveList(wl.id, lists);
            notify({
                kind: 'ok',
                title: '已建立清單',
                body: `「${name}」已建立並切換`,
            });
        },
        [refreshLists, setActiveList],
    );

    // rename = recreate + delete on the server (no rename endpoint), so the
    // active id changes; items stay as-is because the contracts are identical.
    // Returns false when rejected (duplicate name) so the UI can stay in edit.
    const renameCurrentList = useCallback(
        async (name: string): Promise<boolean> => {
            const id = activeIdRef.current;
            const list = serverLists.find((l) => l.id === id);
            const trimmed = name.trim();
            if (!id || !list || !trimmed) return false;
            if (trimmed === list.name) return true;
            if (serverLists.some((l) => l.id !== id && l.name === trimmed)) {
                notify({
                    kind: 'err',
                    title: '清單名稱重複',
                    body: `已有名為「${trimmed}」的清單`,
                });
                return false;
            }
            try {
                const created = await renameWatchlist(list, trimmed);
                // update the ref eagerly — a persistItems fired before the
                // re-render must not PUT against the deleted old id
                activeIdRef.current = created.id;
                setActiveListId(created.id);
                localStorage.setItem(ACTIVE_KEY, created.id);
                await refreshLists();
                notify({
                    kind: 'ok',
                    title: '已重新命名',
                    body: `「${list.name}」→「${trimmed}」`,
                });
                return true;
            } catch {
                await refreshLists().catch(() => undefined);
                notify({
                    kind: 'err',
                    title: '重新命名失敗',
                    body: '與伺服器同步時發生錯誤',
                });
                return false;
            }
        },
        [serverLists, refreshLists],
    );

    const deleteCurrentList = useCallback(async () => {
        const id = activeIdRef.current;
        const list = serverLists.find((l) => l.id === id);
        if (!id || !list) return;
        await deleteWatchlist(id);
        const lists = await refreshLists();
        notify({
            kind: 'ok',
            title: '已刪除清單',
            body: `「${list.name}」已刪除`,
        });
        const fallback = lists[0];
        if (fallback) {
            setActiveList(fallback.id, lists);
        } else {
            setItems([]);
            setActiveListId('');
        }
    }, [serverLists, refreshLists, setActiveList]);

    const initialize = useCallback(
        async (retryWarmup: boolean) => {
            let lists: ServerWatchlist[] = [];
            let lastErr: unknown = null;
            const attempts = retryWarmup ? 10 : 1;
            for (let attempt = 0; attempt < attempts; attempt++) {
                try {
                    lists = await refreshLists();
                    lastErr = null;
                    break;
                } catch (error) {
                    lastErr = error;
                    // A paper session outside service hours will not recover
                    // during boot. Enter the workspace immediately instead of
                    // making the user wait through the warm-up backoff.
                    if (
                        isSessionUnavailable(error) ||
                        attempt === attempts - 1
                    ) {
                        break;
                    }
                    await new Promise((resolve) =>
                        setTimeout(resolve, 1500 + attempt * 1000),
                    );
                }
            }
            if (lastErr) throw lastErr;
            if (lists.length === 0) {
                // first run — migrate the old local list or use defaults
                let seed = DEFAULT_SYMBOLS as {
                    code: string;
                    type: SecurityType | null;
                }[];
                try {
                    const raw = localStorage.getItem(LEGACY_KEY);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            seed = parsed;
                        }
                    }
                } catch {
                    // defaults
                }
                const resolved = await Promise.allSettled(
                    seed.map((symbol) =>
                        resolveContract(
                            symbol.code,
                            symbol.type ?? undefined,
                        ),
                    ),
                );
                const contracts = resolved
                    .filter(
                        (
                            result,
                        ): result is PromiseFulfilledResult<ContractInfo> =>
                            result.status === 'fulfilled',
                    )
                    .map((result) => result.value);
                await createWatchlist(DEFAULT_LIST_NAME, contracts);
                lists = await refreshLists();
            }
            const saved = localStorage.getItem(ACTIVE_KEY);
            const target =
                lists.find((list) => list.id === saved) ??
                lists.find((list) => list.name === DEFAULT_LIST_NAME) ??
                lists[0];
            if (target) {
                setActiveListId(target.id);
                localStorage.setItem(ACTIVE_KEY, target.id);
                await loadList(target);
            } else {
                setLoading(false);
            }
        },
        [loadList, refreshLists],
    );

    const retryService = useCallback(async () => {
        if (serviceRetrying) return;
        setServiceRetrying(true);
        try {
            await initialize(false);
            setServiceIssue(null);
            notify({
                kind: 'ok',
                title: '模擬服務已恢復',
                body: '自選清單與即時服務已重新連線',
            });
        } catch (error) {
            setLoading(false);
            setServiceIssue(serviceIssueFor(error));
        } finally {
            setServiceRetrying(false);
        }
    }, [initialize, serviceRetrying]);

    // boot: load lists; migrate legacy local list / create default if empty.
    // The first fetch can race a server that is still warming up after an
    // app update/restart. SessionNotEstablished is different: it indicates
    // the simulation session is unavailable, so the workspace degrades fast.
    useEffect(() => {
        if (initStarted.current) return;
        initStarted.current = true;
        void initialize(true)
            .then(() => setServiceIssue(null))
            .catch((error) => {
                setLoading(false);
                setServiceIssue(serviceIssueFor(error));
            })
            .finally(() => setInitialLoading(false));
    }, [initialize]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let pendingType: SecurityType | null | undefined;
        const off = onContractEvent((event) => {
            if (!event.base_changed && !event.info_changed) return;
            const eventType = event.security_type as SecurityType | null;
            if (!timer) {
                pendingType = eventType;
            } else if (pendingType !== eventType) {
                pendingType = null;
            }
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                const list = serverLists.find(
                    (candidate) => candidate.id === activeIdRef.current,
                );
                void refreshCachedContracts(pendingType ?? undefined);
                if (list) void loadList(list);
                timer = null;
                pendingType = undefined;
            }, 250);
        });
        return () => {
            off();
            if (timer) clearTimeout(timer);
        };
    }, [serverLists, loadList]);

    return {
        items,
        loading,
        initialLoading,
        serviceIssue,
        serviceRetrying,
        retryService,
        addSymbol,
        removeSymbol,
        reorderSymbol,
        serverLists,
        activeListId,
        setActiveList,
        createList,
        renameCurrentList,
        deleteCurrentList,
    };
}
