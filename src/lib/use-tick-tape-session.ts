import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContractBase } from './types/contract';
import type { SseTick } from './types/market';
import type { HistoryTicks } from './types/tick';
import { getStreamStatus, onAnyTick, subscribeStatusStore } from './stream';
import { historyTickTapeInputs, liveTickTapeInput, type TickTapeEventInput } from './tick-tape-large-trade';
import { allSessionEligible, mergeTapeInputs, mergeTapeInputsAsync, onLargeTradeSettings, readLargeTradeSettings, replaySessionTape, SessionTapeClassifier, tapeKey, TAPE_INPUT_LIMIT } from './tick-tape-session';
import { fetchSessionHistory, readTapeCache, TAPE_SOURCE_LIMITATION, writeTapeCache } from './tick-tape-repository';
import { inspectTapeContinuity, type TapeCoverageState, type TapeSourceEvidence } from './tick-tape-source-verification';

export function taipeiDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); }
export function useTickTapeSession(contractInput: ContractBase, historyLoader?: (contract: ContractBase, count: number) => Promise<HistoryTicks>, tickSubscriber = onAnyTick) {
    // Contract catalog refreshes (including SSE reconnect) replace object
    // identities; they must not reset the same symbol's session or recovery.
    const contract = useMemo(() => ({
        code: contractInput.code, security_type: contractInput.security_type,
        exchange: contractInput.exchange, region: contractInput.region,
        target_code: contractInput.target_code,
    }), [contractInput.code, contractInput.security_type, contractInput.exchange, contractInput.region, contractInput.target_code]);
    const model = useRef(new SessionTapeClassifier(readLargeTradeSettings()));
    const [, update] = useState(0);
    const [status, setStatus] = useState('載入歷史成交…');
    const [coverageState, setCoverageState] = useState<TapeCoverageState>('loading');
    const [recomputing, setRecomputing] = useState(false);
    useEffect(() => {
        let active = true;
        let inputs: TickTapeEventInput[] = [];
        let date = taipeiDate();
        let generation = 1;
        let fetchedAt = 0;
        let sourceEvidence: TapeSourceEvidence | undefined;
        const seenLive = new Set<string>();
        let reconnectPending = !historyLoader;
        let lastRecoveryAt = 0;
        let pendingRecoveryReason: 'live_gap' | 'reconnect_gap' | null = null;
        let scheduledRecoveryReason: 'live_gap' | 'reconnect_gap' | null = null;
        let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
        let loading = false;
        let needsSave = false;
        let saving = false;
        let controller = new AbortController();
        const key = () => `${tapeKey(contract)}|${date}`;
        const publish = () => { if (active) update(value => value + 1); };
        const fail = (error: unknown) => {
            if (!active) return;
            setCoverageState(inputs.length ? 'partial' : 'failed');
            setStatus(`${inputs.length ? '部分資料／補齊失敗' : '載入失敗'}：${error instanceof Error ? error.message : '無法讀取成交資料'}`);
        };
        const publishCoverage = () => {
            if (!active) return;
            if (!historyLoader && (getStreamStatus() !== 'live' || reconnectPending)) {
                setCoverageState('partial');
                setStatus(reconnectPending && getStreamStatus() === 'live'
                    ? '部分資料：行情已重連，等待下一筆成交核對'
                    : '部分資料：行情斷線，已載入紀錄仍可查閱');
                return;
            }
            if (sourceEvidence?.state === 'confirmed_empty' && inputs.length === 0) {
                setCoverageState('confirmed_empty'); setStatus(sourceEvidence.coverage); return;
            }
            const continuity = inspectTapeContinuity(inputs);
            const bridgedSnapshot = sourceEvidence?.snapshotTotalVolume !== null
                && sourceEvidence?.snapshotTotalVolume !== undefined
                && continuity.cumulative >= sourceEvidence.snapshotTotalVolume;
            const bridgedRangeTail = sourceEvidence?.gaps.length === 1
                && sourceEvidence.gaps[0] === 'snapshot_behind_range_tail'
                && inputs.some(input => input.source === 'live'
                    && (input.sourceCumulativeVolume ?? -1) >= sourceEvidence!.regularVolume);
            if (sourceEvidence && ((sourceEvidence.state === 'verified' && continuity.continuous)
                || (sourceEvidence && sourceEvidence.gaps.every(gap => gap === 'snapshot_ahead_of_history') && continuity.continuous && bridgedSnapshot)
                || (bridgedRangeTail && continuity.continuous))) {
                setCoverageState('verified');
                setStatus(sourceEvidence.state === 'verified'
                    ? sourceEvidence.coverage
                    : `已核實至 ${continuity.through?.split('T')[1] ?? '最新成交'}：歷史與即時累計成交量連續`);
                return;
            }
            setCoverageState('partial');
            setStatus(sourceEvidence?.coverage ?? TAPE_SOURCE_LIMITATION);
        };
        model.current = new SessionTapeClassifier(readLargeTradeSettings());
        publish();
        const rebuild = async () => {
            controller.abort();
            controller = new AbortController();
            const signal = controller.signal;
            const snapshot = inputs;
            const count = snapshot.length;
            if (active) setRecomputing(true);
            try {
                const next = await replaySessionTape(snapshot.slice(), readLargeTradeSettings(), signal);
                if (!active || signal.aborted) return;
                // New live trades received while replay yielded use the same new rules.
                for (let index = count; index < inputs.length; index++) next.append(inputs[index]!);
                model.current = next;
                publish();
            } catch (error) { if (!signal.aborted) fail(error); }
            finally { if (active && !signal.aborted) setRecomputing(false); }
        };
        const mergeCurrent = async (history: TickTapeEventInput[], expectedGeneration: number) => {
            for (let attempt = 0; attempt < 3; attempt++) {
                const current = inputs;
                const merged = await mergeTapeInputsAsync(history, current);
                if (!active || expectedGeneration !== generation) return null;
                if (current === inputs) return merged;
            }
            throw new Error('成交持續亂序，保留目前資料並等待補齊');
        };
        const load = async (force = false, reason: 'initial' | 'live_gap' | 'reconnect_gap' = 'initial') => {
            if (loading) {
                if (force && reason !== 'initial') pendingRecoveryReason ??= reason;
                return;
            }
            loading = true;
            const loadGeneration = generation;
            const loadDate = date;
            setStatus(inputs.length ? '部分資料：正在補齊歷史成交…' : '載入歷史成交…');
            setCoverageState(inputs.length ? 'partial' : 'loading');
            try {
                if (!historyLoader && !inputs.length) {
                    const cached = await readTapeCache(key());
                    if (!active || loadGeneration !== generation) return;
                    if (cached) {
                        const merged = await mergeCurrent(cached.inputs, loadGeneration);
                        if (!merged) return;
                        inputs = merged; fetchedAt = cached.metadata.fetchedAt; sourceEvidence = cached.metadata.evidence; await rebuild(); publishCoverage();
                    }
                }
                const result = historyLoader
                    ? { inputs: historyTickTapeInputs(contract, await historyLoader(contract, TAPE_INPUT_LIMIT), generation), fetchedAt: Date.now() }
                    : await fetchSessionHistory(contract, loadDate, force, reason);
                if (!active || loadGeneration !== generation) return;
                // Injected futures loader retains its existing next-trading-date behavior.
                if (contract.security_type !== 'STK' && result.inputs.length) date = result.inputs.at(-1)!.date;
                const merged = await mergeCurrent(result.inputs.map(input => ({ ...input, generation })), loadGeneration);
                if (!merged) return;
                inputs = merged;
                for (const input of inputs) if (input.sourceSequence) seenLive.add(input.sourceSequence);
                fetchedAt = result.fetchedAt;
                if (!('fromCache' in result) || result.fromCache !== true) reconnectPending = false;
                if ('metadata' in result) sourceEvidence = result.metadata.evidence;
                needsSave = true;
                await rebuild();
                if (active && loadGeneration === generation) {
                    if (historyLoader && result.inputs.length === 0) {
                        setCoverageState('partial');
                        setStatus('部分資料：歷史來源空白，尚未確認當日無成交');
                    } else publishCoverage();
                    if (inspectTapeContinuity(inputs).continuous) {
                        scheduledRecoveryReason = null;
                        if (recoveryTimer) clearTimeout(recoveryTimer);
                        recoveryTimer = null;
                    }
                }
            } catch (error) { if (loadGeneration === generation) fail(error); }
            finally {
                loading = false;
                const queuedRecovery = pendingRecoveryReason;
                pendingRecoveryReason = null;
                if (active && loadGeneration !== generation) void load();
                else if (active && queuedRecovery && !inspectTapeContinuity(inputs).continuous) requestRecovery(queuedRecovery);
            }
        };
        const requestRecovery = (reason: 'live_gap' | 'reconnect_gap') => {
            if (!active || inspectTapeContinuity(inputs).continuous) return;
            if (loading) {
                pendingRecoveryReason ??= reason;
                return;
            }
            const delay = Math.max(0, 60_000 - (Date.now() - lastRecoveryAt));
            if (delay > 0) {
                scheduledRecoveryReason ??= reason;
                if (!recoveryTimer) {
                    recoveryTimer = setTimeout(() => {
                        recoveryTimer = null;
                        const scheduled = scheduledRecoveryReason;
                        scheduledRecoveryReason = null;
                        if (scheduled && !inspectTapeContinuity(inputs).continuous) requestRecovery(scheduled);
                    }, delay);
                }
                return;
            }
            lastRecoveryAt = Date.now();
            void load(true, reason);
        };
        const off = tickSubscriber(tick => {
            if (!active || tick.code !== contract.code) return;
            const input = liveTickTapeInput(contract, tick, generation);
            if (!allSessionEligible(input)) return;
            if (input.date < date) return;
            if (input.date > date) {
                void persist();
                generation++; date = input.date; input.generation = generation;
                inputs = []; fetchedAt = 0; seenLive.clear(); controller.abort();
                sourceEvidence = undefined; reconnectPending = false; lastRecoveryAt = 0;
                model.current = new SessionTapeClassifier(readLargeTradeSettings());
                setStatus('部分資料：新交易日，等待歷史補齊');
                if (!loading) void load();
            }
            if (input.sourceSequence && seenLive.has(input.sourceSequence)) return;
            if (input.sourceSequence) seenLive.add(input.sourceSequence);
            if (inputs.length >= TAPE_INPUT_LIMIT) { fail(new Error('成交超過 500,000 筆預算；既有資料保留')); return; }
            const last = inputs.at(-1);
            const lastCumulative = last?.sourceCumulativeVolume;
            const hasGap = Number.isFinite(lastCumulative) && Number.isFinite(input.sourceCumulativeVolume)
                && input.sourceCumulativeVolume !== lastCumulative! + input.volume;
            inputs.push(input); needsSave = true;
            if (last && input.time < last.time) { inputs = mergeTapeInputs([], inputs); void rebuild(); }
            else {
                model.current.append(input);
                publish();
            }
            const wasReconnectPending = reconnectPending;
            reconnectPending = false;
            if (hasGap) {
                setCoverageState('partial');
                setStatus('部分資料：即時累計成交量出現缺口，正在執行一次有界補齊…');
                requestRecovery(wasReconnectPending ? 'reconnect_gap' : 'live_gap');
            } else publishCoverage();
        });
        const offSettings = onLargeTradeSettings(() => { void rebuild(); });
        let previousStatus = getStreamStatus();
        const offStatus = historyLoader ? () => undefined : subscribeStatusStore(() => {
            const next = getStreamStatus();
            if (next !== 'live') {
                reconnectPending = true;
                setCoverageState('partial');
                setStatus('部分資料：行情斷線，已載入紀錄仍可查閱');
            } else if (previousStatus !== 'live' && inputs.length) {
                setCoverageState('partial');
                setStatus('部分資料：行情已重連，等待下一筆成交核對');
            }
            previousStatus = next;
        });
        const persist = async () => {
            if (historyLoader || !needsSave || saving || !inputs.length) return;
            saving = true; needsSave = false;
            const saveKey = key(); const snapshot = inputs.slice(); const savedFetch = fetchedAt;
            try {
                await navigator.locks.request(`rts.tape.history.${saveKey}`, async () => {
                    const existing = await readTapeCache(saveKey);
                    const merged = await mergeTapeInputsAsync(existing?.inputs ?? [], snapshot);
                    await writeTapeCache(saveKey, merged, Math.max(savedFetch, existing?.metadata.fetchedAt ?? 0), sourceEvidence ?? existing?.metadata.evidence);
                });
            } catch (error) { fail(error); }
            finally { saving = false; }
        };
        const timer = setInterval(() => { void persist(); }, 10_000);
        void load();
        return () => { active = false; controller.abort(); off(); offSettings(); offStatus(); clearInterval(timer); if (recoveryTimer) clearTimeout(recoveryTimer); void persist(); };
    }, [contract, historyLoader, tickSubscriber]);
    return { result: model.current.result, status, coverageState, recomputing };
}
