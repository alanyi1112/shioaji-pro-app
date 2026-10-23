import { assertNoSpecialMarketClosure, specialMarketClosureDecision } from './special-market-closures.mjs';
import { mkdir, open, readFile, stat, statfs } from 'node:fs/promises';
import { statfsSync } from 'node:fs';
import path from 'node:path';

import { createDailyMinuteVolumeProductSink } from './daily-minute-volume-product-sink.mjs';
import { createIntradayMonitorKbarStreamAdapter,
    issueIntradayMonitorKbarSessionCloseAuthority } from './kbar-stream-adapter.mjs';
import { createBoundedKbarTransport } from './bounded-kbar-transport.mjs';
import { createDirect160GapBootstrapWorker } from './direct-160-gap-bootstrap.mjs';
import { DYNAMIC_DAILY_STORAGE } from './dynamic-daily-storage.mjs';
import { claimDynamicDailyRun, resolveDynamicDailySharedRegistryDirectory }
    from './dynamic-daily-run-registry.mjs';

export const DAILY_MINUTE_VOLUME_RUNNER_SCHEMA = 'intraday-monitor-daily-runner/1';
const generationPattern = /^simulation:[A-Za-z0-9_-]{16,100}$/;
const BACKPRESSURE_WINDOW_MS = 60_000;
const BACKPRESSURE_BURST_EVENTS = 3;
const BACKPRESSURE_HARD_MULTIPLIER = 5;

async function exclusiveJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
}

// A single owner, single bounded SSE and a SQLite-backed sink.  This module does
// not import the shadow recorder, Stage capture, replay or tail-review pipeline.
export function createDailyMinuteVolumeRunner({ appSupportRoot, manifests,
    config, tradeDate, previousTradeDate, connectionGeneration, planHash,
    sessionAuthority, readSuppressedSymbols = () => [], allowMissingBaseline = false,
    fetchImpl = fetch,
    now = () => new Date().toISOString(), nowEpochMs = () => Date.now(),
    transportFactory = createBoundedKbarTransport,
    repairWorkerFactory = createDirect160GapBootstrapWorker,
    diskSpaceProbe = root => { const value = statfsSync(root); return value.bavail * value.bsize; },
    limits = { maxRssBytes: 2 * 1024 ** 3, minimumFreeDiskBytes: 4 * 1024 ** 3,
        maximumEventProcessingMs: 3000 } } = {}) {
    if (!path.isAbsolute(appSupportRoot ?? '') || !generationPattern.test(connectionGeneration ?? '') ||
        !/^[a-f0-9]{64}$/.test(planHash ?? '') ||
        typeof sessionAuthority?.evaluate !== 'function' ||
        typeof sessionAuthority?.markControlPlane !== 'function' ||
        typeof sessionAuthority?.recordFirstKbar !== 'function' ||
        typeof sessionAuthority?.recordObservation !== 'function' ||
        typeof sessionAuthority?.beginClosing !== 'function' ||
        typeof fetchImpl !== 'function' || typeof now !== 'function' ||
        typeof readSuppressedSymbols !== 'function' || typeof allowMissingBaseline !== 'boolean' ||
        typeof nowEpochMs !== 'function' || typeof transportFactory !== 'function' ||
        typeof repairWorkerFactory !== 'function' ||
        typeof diskSpaceProbe !== 'function' ||
        ![limits?.maxRssBytes, limits?.minimumFreeDiskBytes,
            limits?.maximumEventProcessingMs].every(value =>
            Number.isSafeInteger(value) && value > 0) ||
        !Number.isSafeInteger(limits?.diskCheckIntervalMs ?? 30_000) ||
        (limits?.diskCheckIntervalMs ?? 30_000) < 1_000 ||
        (limits?.diskCheckIntervalMs ?? 30_000) > 60_000 ||
        !Number.isSafeInteger(limits?.sourceSilenceMs ?? 180_000) ||
        (limits?.sourceSilenceMs ?? 180_000) < 120_000 ||
        (limits?.sourceSilenceMs ?? 180_000) > 600_000) {
        throw new TypeError('daily_runner_inputs_invalid');
    }
    const closureOptions = () => ({ root: appSupportRoot, dates: [tradeDate, previousTradeDate], now: new Date(now()) });
    const guardedFetch = (url, init) => { assertNoSpecialMarketClosure(closureOptions()); return fetchImpl(url, init); };
    const contracts = config?.items?.filter(item => item.enabled).map(item => item.contract);
    if (!Array.isArray(contracts) || contracts.length < 1 || contracts.length > 160) {
        throw new TypeError('daily_runner_cohort_invalid');
    }
    let phase = 'idle';
    let claim = null, sink = null, adapter = null, transport = null;
    let thresholdRuntime = null, thresholdTimer = null;
    let startReceipt = null, closeReceipt = null, stopReceipt = null;
    let lastSourceEventAt = null, lastAcceptedEventAt = null;
    let sourceEvents = 0, acceptedEvents = 0, maxEventProcessingMs = 0;
    let slowEventCount = 0;
    const recentSlowEvents = [];
    let peakRssBytes = process.memoryUsage().rss;
    let cpuStart = null;
    let resourceFault = null, disconnect = null;
    let resourceFaultObservedAt = null;
    const repairAttempts = new Set();
    const repairPending = new Set();
    const repairQueue = [];
    const repairReceipts = [];
    const repairFailures = [];
    const historicalSymbols = new Set();
    let reconnectPending = null;
    let reconnectReceipt = null;
    const healthIncidents = [];
    let lastHealthReason = null;
    let silenceDetectedAt = null;
    let lastDiskSampleAt = null, lastAvailableDiskBytes = null, diskSamples = 0;
    const summaryPath = path.join(appSupportRoot, 'IntradayMonitor', 'daily-run',
        tradeDate ?? 'invalid', 'summary.json');
    const evidenceDatabasePath = path.join(appSupportRoot, 'IntradayMonitor',
        'intraday-monitor-evidence.sqlite3');

    async function localIdentity() {
        const [mode, generation] = await Promise.all([
            readFile(path.join(appSupportRoot, 'runtime-mode'), 'utf8'),
            readFile(path.join(appSupportRoot, 'runtime-api-generation'), 'utf8'),
        ]);
        if (mode.trim() !== 'simulation' || generation.trim() !== connectionGeneration) {
            throw new Error('daily_runner_simulation_generation_mismatch');
        }
    }

    async function databaseSize() {
        try {
            const main = await stat(evidenceDatabasePath);
            const sidecars = await Promise.all(['-wal', '-shm'].map(suffix =>
                stat(`${evidenceDatabasePath}${suffix}`).then(value => value.size)
                    .catch(error => error?.code === 'ENOENT' ? 0 : null)));
            return sidecars.includes(null) ? null : main.size + sidecars[0] + sidecars[1];
        } catch { return null; }
    }

    function fault(reason) {
        if (!resourceFault) {
            resourceFault = reason;
            resourceFaultObservedAt = now();
        }
    }

    function sampleDisk(at) {
        if (lastDiskSampleAt !== null &&
            at - lastDiskSampleAt < (limits.diskCheckIntervalMs ?? 30_000)) return;
        lastDiskSampleAt = at;
        diskSamples += 1;
        try {
            const available = diskSpaceProbe(appSupportRoot);
            if (!Number.isSafeInteger(available) || available < 0) throw new Error('invalid_disk_space');
            lastAvailableDiskBytes = available;
            if (available < limits.minimumFreeDiskBytes) fault('disk_reserve_insufficient');
        } catch { lastAvailableDiskBytes = null; fault('disk_space_unavailable'); }
    }

    function pumpRepairs() {
        while (phase === 'running' && !resourceFault && repairPending.size < 2 &&
            repairQueue.length > 0) {
            const { contract, event, endMinute, overlapMinute } = repairQueue.shift();
            const pending = (async () => {
                try {
                    const worker = repairWorkerFactory({ fetchImpl: guardedFetch, now, concurrency: 1 });
                    const repaired = await worker.run({ contracts: [contract], tradeDate,
                        endMinute, overlapMinute, liveGeneration: connectionGeneration,
                        liveOverlapBySymbol: new Map([[contract.canonicalSymbol,
                            [{ minuteKey: overlapMinute, volumeCommonLot: event.volume }]]]) });
                    const receipt = repaired.receipts?.[0];
                    if (phase !== 'running' || resourceFault || !receipt ||
                        !(await localIdentity().then(() => true).catch(() => false)) ||
                        sessionAuthority.evaluate()?.current !== true) {
                        throw new Error(repaired.results?.[0]?.reasons?.[0] ?? 'repair_authority_unverified');
                    }
                    const installed = sink.installHistoricalGap(receipt);
                    if (!installed.installed) throw new Error(installed.reason);
                    const restored = adapter.restoreVerifiedGap(receipt, event);
                    if (!restored.accepted) throw new Error(restored.reason);
                    historicalSymbols.add(contract.canonicalSymbol);
                    repairReceipts.push({ canonicalSymbol: contract.canonicalSymbol,
                        receiptHash: receipt.receiptHash, historicalRows: installed.inserted,
                        lastHistoricalMinute: installed.lastHistoricalMinute });
                } catch (error) {
                    repairFailures.push({ canonicalSymbol: contract.canonicalSymbol,
                        reason: String(error?.message ?? 'gap_repair_failed').slice(0, 128) });
                }
            })();
            repairPending.add(pending);
            pending.finally(() => { repairPending.delete(pending); pumpRepairs(); });
        }
    }

    function recordEvent(event) {
        const closure = specialMarketClosureDecision(closureOptions());
        if (!closure.allowed) { fault(closure.reason); return { accepted: false, reason: closure.reason }; }
        sourceEvents += 1;
        lastSourceEventAt = event?.receivedTime ?? now();
        if (resourceFault) return { accepted: false, reason: resourceFault };
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        if (peakRssBytes > limits.maxRssBytes) {
            fault('rss_limit_exceeded');
            return { accepted: false, reason: resourceFault };
        }
        const started = nowEpochMs();
        sampleDisk(started);
        if (resourceFault) return { accepted: false, reason: resourceFault };
        const result = adapter.accept(event);
        const degradedReason = result.reason === 'symbol_degraded' ?
            adapter.status().symbols.find(item => item.canonicalSymbol ===
                contracts.find(contract => contract.code === event.code)?.canonicalSymbol)?.reason : null;
        const repairNeeded = ['kbar_minute_gap', 'historical_prefix_missing'].includes(result.reason) ||
            result.reason === 'symbol_degraded' && degradedReason === 'stream_disconnected';
        if (repairNeeded && phase === 'running' && !repairAttempts.has(event.code) &&
            repairAttempts.size < contracts.length &&
            event.connectionGeneration === connectionGeneration &&
            event.date?.replaceAll('/', '-') === tradeDate &&
            /^\d{2}:\d{2}:\d{2}/.test(event.time ?? '')) {
            const contract = contracts.find(item => item.code === event.code);
            const overlapMinute = event.time.slice(0, 5);
            const end = Number(overlapMinute.slice(0, 2)) * 60 + Number(overlapMinute.slice(3)) - 1;
            const endMinute = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
            if (contract && end >= 9 * 60 + 1 && overlapMinute <= '13:30') {
                repairAttempts.add(event.code);
                repairQueue.push({ contract, event, endMinute, overlapMinute });
                pumpRepairs();
            }
        }
        const processedAt = nowEpochMs();
        const processingMs = Math.max(0, processedAt - started);
        maxEventProcessingMs = Math.max(maxEventProcessingMs, processingMs);
        while (recentSlowEvents.length &&
            processedAt - recentSlowEvents[0] > BACKPRESSURE_WINDOW_MS) {
            recentSlowEvents.shift();
        }
        if (processingMs > limits.maximumEventProcessingMs) {
            slowEventCount += 1;
            recentSlowEvents.push(processedAt);
            // One delayed disk/SQLite call is evidence, not proof that the whole
            // stream is persistently backlogged. A hard stall remains fatal.
            if (processingMs > limits.maximumEventProcessingMs * BACKPRESSURE_HARD_MULTIPLIER ||
                recentSlowEvents.length >= BACKPRESSURE_BURST_EVENTS) {
                fault('event_processing_backpressure');
            }
        }
        if (result.accepted) {
            acceptedEvents += 1; lastAcceptedEventAt = event.receivedTime;
            if (result.reason === 'forming') {
                try { sessionAuthority.recordFirstKbar({
                    canonicalSymbol: result.canonicalSymbol, receivedAt: event.receivedTime }); }
                catch { fault('session_activity_update_failed'); }
            }
        }
        // The current event may already be committed to SQLite. Report its real
        // outcome; the fault gates subsequent events and remains in the receipt.
        return result;
    }

    function scheduleReconnect() {
        if (phase !== 'running' || reconnectPending ||
            typeof transport?.reconnectEndedStream !== 'function') return;
        reconnectPending = (async () => {
            try {
                if (!(await localIdentity().then(() => true).catch(() => false)) ||
                    sessionAuthority.evaluate()?.current !== true) {
                    throw new Error('reconnect_authority_unverified');
                }
                reconnectReceipt = await transport.reconnectEndedStream({
                    connectionGeneration, requestedCohortHash: transport.status().cohortHash });
            } catch (error) {
                reconnectReceipt = { recovered: false,
                    reason: String(error?.message ?? 'reconnect_failed').slice(0, 128) };
            }
        })();
    }

    async function checkHealth() {
        if (!['running', 'closing'].includes(phase)) return { state: 'inactive' };
        const closure = specialMarketClosureDecision(closureOptions());
        if (!closure.allowed) { fault(closure.reason); return {state:'stalled',reason:closure.reason}; }
        const at = nowEpochMs();
        const stream = transport?.status();
        const activeStart = Date.parse(`${tradeDate}T09:00:00+08:00`);
        const auctionStart = Date.parse(`${tradeDate}T13:25:00+08:00`);
        const lastSource = lastSourceEventAt ? Date.parse(lastSourceEventAt) : activeStart;
        let reason = null;
        let fatal = false;
        if (resourceFault) {
            reason = resourceFault;
            fatal = true;
        } else if (stream?.phase === 'failed') {
            reason = reconnectReceipt?.reason ?? disconnect?.reason ?? 'stream_transport_failed';
            fatal = true;
        } else if (stream?.streamActive === false) {
            const disconnectedAt = disconnect?.observedAt ? Date.parse(disconnect.observedAt) : null;
            if (reconnectPending && !reconnectReceipt && disconnectedAt !== null &&
                at - disconnectedAt < 60_000) return { state: 'recovering' };
            reason = reconnectReceipt?.reason ?? disconnect?.reason ?? 'stream_reader_inactive';
            fatal = true;
        } else if (at >= activeStart + (limits.sourceSilenceMs ?? 180_000) &&
            at < auctionStart && at - lastSource > (limits.sourceSilenceMs ?? 180_000)) {
            silenceDetectedAt ??= at;
            fatal = at - silenceDetectedAt >= (limits.sourceSilenceMs ?? 180_000);
            reason = fatal ? 'kbar_source_silent_prolonged' : 'kbar_source_silent';
        } else if (stream?.sourceGapEvents > 0) {
            // Do not reopen a healthy socket or invent affected symbols: a
            // broadcast gap has unknown scope until per-symbol continuity is checked.
            reason = stream.sourceGapInvalid ? 'kbar_source_gap_invalid' : 'kbar_source_gap_reported';
        } else if (sink?.snapshot().comparisonFailure) {
            reason = sink.snapshot().comparisonFailure;
        } else {
            const rejected = adapter?.status().symbols.find(item => item.degraded &&
                !['kbar_minute_gap', 'stream_disconnected', 'historical_prefix_missing'].includes(item.reason));
            if (rejected) reason = rejected.reason;
        }
        if (!reason) {
            lastHealthReason = null;
            silenceDetectedAt = null;
            return { state: 'healthy' };
        }
        if (lastHealthReason !== reason) {
            if (healthIncidents.length >= 8) throw new Error('daily_runner_health_incident_limit');
            const incident = { schemaVersion: 'intraday-monitor-daily-health-incident/1',
                tradeDate, connectionGeneration, planHash, observedAt: new Date(at).toISOString(),
                reason, fatal, lastSourceEventAt, lastAcceptedEventAt,
                sourceEvents, acceptedEvents,
                transport: { phase: stream?.phase ?? 'unknown',
                    streamActive: stream?.streamActive ?? null, bytes: stream?.bytes ?? null,
                    maximumBytes: stream?.maximumBytes ?? null,
                    lastDisconnectReason: stream?.lastDisconnectReason ?? null,
                    recoveryAttempts: stream?.recoveryAttempts ?? null,
                    sourceGapEvents: stream?.sourceGapEvents ?? null,
                    sourceDroppedFrames: stream?.sourceDroppedFrames ?? null,
                    sourceGapSamples: stream?.sourceGapSamples ?? null,
                    affectedSymbols: null },
                brokerWriteAuthority: false, notificationAuthority: false };
            const incidentPath = path.join(path.dirname(summaryPath), 'incidents',
                `${String(healthIncidents.length + 1).padStart(3, '0')}.json`);
            try { await exclusiveJson(incidentPath, incident); }
            catch { throw new Error('daily_runner_health_incident_write_failed'); }
            healthIncidents.push({ ...incident, incidentPath });
            lastHealthReason = reason;
        }
        if (fatal) throw new Error(resourceFault ? 'daily_runner_resource_unrecoverable' :
            'daily_runner_stream_unrecoverable');
        return { state: 'stalled', reason };
    }

    async function start({ latestAllowedAt = `${tradeDate}T09:00:00+08:00` } = {}) {
        assertNoSpecialMarketClosure(closureOptions());
        if (phase !== 'idle') throw new Error('daily_runner_already_used');
        if (!Number.isFinite(Date.parse(latestAllowedAt)) ||
            Date.parse(now()) >= Date.parse(latestAllowedAt) ||
            Date.parse(latestAllowedAt) > Date.parse(`${tradeDate}T12:00:00+08:00`)) {
            throw new Error('daily_runner_start_window_closed');
        }
        await localIdentity();
        let current;
        try { current = sessionAuthority.evaluate(); }
        catch { throw new Error('daily_runner_current_session_unavailable'); }
        if (current?.current !== true || current?.controlPlaneAuthority !== true ||
            current?.dataPlaneAuthority !== true) {
            throw new Error('daily_runner_current_session_unverified');
        }
        const free = await statfs(appSupportRoot).then(value => value.bavail * value.bsize);
        lastAvailableDiskBytes = free;
        lastDiskSampleAt = nowEpochMs();
        diskSamples += 1;
        if (free < limits.minimumFreeDiskBytes) throw new Error('daily_runner_disk_reserve_insufficient');
        claim = await claimDynamicDailyRun({ directory: resolveDynamicDailySharedRegistryDirectory(appSupportRoot),
            connectionGeneration, planHash, tradeDate, claimedAt: now() });
        phase = 'starting';
        cpuStart = process.cpuUsage();
        try {
            thresholdRuntime = sessionAuthority.initializeThresholdRuntime?.({
                ownerId: path.basename(claim.claimPath), ownerPid: process.pid,
                activeSymbols: contracts.map(item => item.canonicalSymbol) }) ?? null;
            sink = createDailyMinuteVolumeProductSink({ manifests, config, tradeDate,
                previousTradeDate, connectionGeneration, evidenceDatabasePath,
                sessionAuthority, thresholdRuntime, readSuppressedSymbols, allowMissingBaseline, now });
            adapter = createIntradayMonitorKbarStreamAdapter({ cohort: contracts, tradeDate,
                connectionGeneration, observationSink: sink.receive, nowEpochMs,
                maximumCohortSize: 160, requireFirstMinute: true });
            let controlPlaneMarked = false;
            transport = transportFactory({ fetchImpl: guardedFetch, now, storageProfile: DYNAMIC_DAILY_STORAGE,
                onEvent: recordEvent,
                onSubscribeAccepted() {
                    const control = sessionAuthority.markControlPlane({ requested: true,
                        accepted: true });
                    if (control?.current !== true) {
                        throw new Error('daily_runner_control_plane_unverified');
                    }
                    controlPlaneMarked = true;
                },
                onDisconnect(value) {
                    disconnect = { reason: value?.reason ?? 'stream_disconnected',
                        observedAt: now() };
                    adapter.markDisconnected({ connectionGeneration: value.connectionGeneration });
                    scheduleReconnect();
                },
                onRecovered(value) {
                    if (value.connectionGeneration === connectionGeneration &&
                        phase === 'running') {
                        adapter.markReconnected({ connectionGeneration });
                        if (disconnect) disconnect.recoveredAt = now();
                    }
                } });
            startReceipt = await transport.start({ contracts, connectionGeneration });
            await localIdentity();
            const control = controlPlaneMarked ? sessionAuthority.evaluate() :
                sessionAuthority.markControlPlane({ requested: true,
                    accepted: startReceipt.subscribeAccepted === true });
            if (control?.current !== true) throw new Error('daily_runner_control_plane_unverified');
            phase = 'running';
            if (thresholdRuntime) {
                // Local SQLite control-plane poll only: no additional HTTP, SSE or subscription.
                thresholdTimer = setInterval(() => {
                    if (['running', 'closing'].includes(phase)) sink.syncThresholds();
                }, 1000);
                thresholdTimer.unref();
            }
            if (disconnect) scheduleReconnect();
            return { ...startReceipt, runtimeMode: 'daily',
                notificationAuthority: false, brokerWriteAuthority: false };
        } catch (error) {
            phase = 'failed';
            clearInterval(thresholdTimer);
            if (transport) {
                const sameGeneration = await localIdentity().then(() => true).catch(() => false);
                await transport.stop({ unsubscribeAllowed: sameGeneration }).catch(() => {});
            }
            try { if (sink) sink.close(); }
            finally { thresholdRuntime?.close(); await claim.release(); }
            throw error;
        }
    }

    function sealClose() {
        if (!['running', 'closing'].includes(phase) || closeReceipt) {
            throw new Error('daily_runner_not_running');
        }
        const at = nowEpochMs();
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({
            tradeDate, observedAtEpochMs: at, timeZone: 'Asia/Taipei' }, at);
        if (authority.issued !== true) throw new Error('daily_runner_close_window_not_reached');
        phase = 'closing';
        closeReceipt = adapter.sealSessionClose(authority);
        return closeReceipt;
    }

    function beginClosing() {
        if (phase !== 'running') throw new Error('daily_runner_not_running');
        const start = Date.parse(`${tradeDate}T13:30:15+08:00`);
        const end = Date.parse(`${tradeDate}T13:34:30+08:00`);
        if (nowEpochMs() < start || nowEpochMs() >= end) {
            throw new Error('daily_runner_closing_window_invalid');
        }
        const authority = sessionAuthority.beginClosing();
        if (authority?.current !== true) throw new Error('daily_runner_closing_authority_unverified');
        phase = 'closing';
        return { closing: true, tradeDate, delayedCloseStillAccepted: true,
            finalSealNotBefore: `${tradeDate}T13:34:30+08:00` };
    }

    async function stop() {
        if (!['running', 'closing'].includes(phase)) {
            return { stopped: false, reason: 'daily_runner_not_running' };
        }
        const closeWasSealed = phase === 'closing';
        phase = 'stopping';
        clearInterval(thresholdTimer);
        for (const item of repairQueue.splice(0)) {
            repairFailures.push({ canonicalSymbol: item.contract.canonicalSymbol,
                reason: 'repair_window_closed' });
        }
        await reconnectPending?.catch(() => {});
        const currentIdentity = await localIdentity().then(() => true).catch(() => false);
        try { stopReceipt = await transport.stop({ unsubscribeAllowed: currentIdentity }); }
        catch (error) { stopReceipt = { stopped: false, reason: error?.message ?? 'transport_stop_failed' }; }
        await Promise.allSettled([...repairPending]);
        let sinkSummary;
        try { sinkSummary = sink.close(); }
        finally { thresholdRuntime?.close(); await claim.release(); }
        const statuses = adapter.status().symbols;
        const bySymbol = new Map(sinkSummary.items.map(item => [item.canonicalSymbol, item]));
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        const cpu = cpuStart ? process.cpuUsage(cpuStart) : null;
        const evidenceDatabaseBytes = await databaseSize();
        const allComplete = statuses.every(item => !item.degraded &&
            !historicalSymbols.has(item.canonicalSymbol) &&
            bySymbol.get(item.canonicalSymbol)?.observationCount === 270);
        phase = closeWasSealed && closeReceipt?.accepted === true && allComplete &&
            stopReceipt?.stopped === true && stopReceipt?.unsubscribeAccepted === true &&
            !resourceFault && !disconnect && healthIncidents.length === 0 &&
            !(transport.status().sourceGapEvents > 0) ? 'ended' : 'partial';
        const receipt = { schemaVersion: DAILY_MINUTE_VOLUME_RUNNER_SCHEMA,
            runtimeMode: 'daily', tradeDate, previousTradeDate, planHash,
            connectionGeneration, completedAt: now(), executionOutcome: phase,
            closeReceipt, startReceipt, stopReceipt,
            lastSourceEventAt, lastAcceptedEventAt, sourceEvents, acceptedEvents,
            resources: { peakRssBytes, maxEventProcessingMs, slowEventCount,
                backpressurePolicy: { softLimitMs: limits.maximumEventProcessingMs,
                    burstEvents: BACKPRESSURE_BURST_EVENTS,
                    windowMs: BACKPRESSURE_WINDOW_MS,
                    hardLimitMs: limits.maximumEventProcessingMs * BACKPRESSURE_HARD_MULTIPLIER },
                resourceFault,
                resourceFaultObservedAt,
                affectedScope: resourceFault ? 'all_active_symbols' : null,
                lastAvailableDiskBytes, lastDiskSampleAt: lastDiskSampleAt === null ? null :
                    new Date(lastDiskSampleAt).toISOString(), diskSamples,
                cpuUserMicroseconds: cpu?.user ?? null,
                cpuSystemMicroseconds: cpu?.system ?? null,
                evidenceDatabaseBytes,
                availableDiskBytes: await statfs(appSupportRoot)
                    .then(value => value.bavail * value.bsize).catch(() => null) },
            stream: { disconnect, reconnectReceipt, transport: transport.status() },
            health: { incidentCount: healthIncidents.length,
                incidents: healthIncidents.map(item => ({ reason: item.reason,
                    observedAt: item.observedAt, fatal: item.fatal,
                    incidentPath: item.incidentPath })) },
            historicalGapRepair: { attempts: repairAttempts.size, completed: repairReceipts.length,
                receipts: repairReceipts, failures: repairFailures,
                notificationAuthority: false },
            thresholdSwitch: sinkSummary.thresholdSwitch ?? null,
            comparisonFailure: sinkSummary.comparisonFailure ?? null,
            liveCoverageBySymbol: statuses.map(item => ({
                canonicalSymbol: item.canonicalSymbol,
                lastMinute: bySymbol.get(item.canonicalSymbol)?.lastMinute ?? null,
                lastComparableMinute: bySymbol.get(item.canonicalSymbol)?.lastComparableMinute ?? null,
                observationCount: bySymbol.get(item.canonicalSymbol)?.observationCount ?? 0,
                state: item.degraded || historicalSymbols.has(item.canonicalSymbol) ? 'partial' :
                    bySymbol.get(item.canonicalSymbol)?.observationCount === 270 ? 'complete' : 'partial',
                reason: item.degraded ? item.reason : historicalSymbols.has(item.canonicalSymbol) ?
                    'historical_prefix_not_live' :
                    resourceFault && bySymbol.get(item.canonicalSymbol)?.observationCount !== 270 ?
                        resourceFault : healthIncidents.length &&
                            bySymbol.get(item.canonicalSymbol)?.observationCount !== 270 ?
                            healthIncidents.at(-1).reason : bySymbol.get(item.canonicalSymbol)?.reason ?? 'unknown',
            })),
            nextBaselineState: 'independent_postclose_pending',
            diagnosticsState: 'not_requested',
            aggregate: sinkSummary.aggregate,
            notificationAuthority: false, brokerWriteAuthority: false,
            productionAuthority: false, serviceLifecycleAuthority: false };
        try {
            await exclusiveJson(summaryPath, receipt);
            return { stopped: true, summaryPath, receipt };
        } catch (error) {
            // SQLite observations and triggers remain committed even if summary export fails.
            const sidecar = path.join(path.dirname(summaryPath), 'summary-write-failed.json');
            await exclusiveJson(sidecar, { schemaVersion: DAILY_MINUTE_VOLUME_RUNNER_SCHEMA,
                tradeDate, reason: error?.code === 'EEXIST' ? 'summary_exists' :
                    'summary_write_failed', observedAt: now(), summaryPath }).catch(() => {});
            return { stopped: true, summaryPath: null, reason: 'summary_write_failed',
                evidenceDatabasePath };
        }
    }

    function status() {
        return { schemaVersion: DAILY_MINUTE_VOLUME_RUNNER_SCHEMA, runtimeMode: 'daily',
            phase, tradeDate, previousTradeDate, planHash, connectionGeneration,
            sourceEvents, acceptedEvents, lastSourceEventAt, lastAcceptedEventAt,
            resourceFault, resourceFaultObservedAt, disconnect,
            reconnectReceipt,
            health: { incidentCount: healthIncidents.length,
                lastReason: healthIncidents.at(-1)?.reason ?? null },
            historicalGapRepair: { attempts: repairAttempts.size,
                completed: repairReceipts.length, failed: repairFailures.length,
                pending: repairPending.size, queued: repairQueue.length },
            lastAvailableDiskBytes, lastDiskSampleAt, diskSamples,
            peakRssBytes, maxEventProcessingMs, slowEventCount,
            sink: sink?.snapshot() ?? null, adapter: adapter?.status() ?? null,
            transport: transport?.status() ?? null,
            brokerWriteAuthority: false, serviceLifecycleAuthority: false };
    }
    return Object.freeze({ start, beginClosing, sealClose, stop, checkHealth, status });
}
