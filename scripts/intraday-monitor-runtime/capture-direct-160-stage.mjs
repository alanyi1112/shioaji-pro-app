import { readFile, mkdir, stat, statfs } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { DIRECT_160_STORAGE, writeDirect160Artifact } from './direct-160-storage.mjs';
import { createDirect160StageComponents, runDirect160DeterministicReplay,
    buildDirect160TieredSessionEvidence, validateDirect160LiveInputs } from './direct-160-live-stage.mjs';
import { claimDirect160Run } from './direct-160-run-registry.mjs';
import { issueIntradayMonitorKbarSessionCloseAuthority } from './kbar-stream-adapter.mjs';
import { IntradayMonitorConfigRepository } from './config-repository.mjs';
import { createDirect160ProductSink } from './direct-160-product-runtime.mjs';
import { validatePassiveChartFreshnessEvidence } from './passive-chart-freshness-evidence.mjs';
import { resolveIntradayMonitorCapturePaths } from './kbar-capture-outcome-writer.mjs';
import { createBoundedKbarRecoveryAuthority } from './first-minute-canary.mjs';
import { createDirect160GapBootstrapWorker } from './direct-160-gap-bootstrap.mjs';
import { appendIntradayMonitorOperationalEvent } from './operational-event-log.mjs';

export const DIRECT_160_CAPTURE_SCHEMA = 'intraday-monitor-direct-160-capture/1';
export const DIRECT_160_CAPTURE_FAILURE_SCHEMA = 'intraday-monitor-direct-160-capture-failure/1';

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function absolute(name) {
    const value = argument(name);
    if (!value || !path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
    return value;
}

function previousMinuteKey(value) {
    if (!/^\d{2}:\d{2}$/.test(value ?? '')) return null;
    const [hour, minute] = value.split(':').map(Number);
    const total = hour * 60 + minute - 1;
    if (total < 9 * 60 + 1 || total > 13 * 60 + 29) return null;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function json(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}

export function inspectDirect160StageStart({ tradeDate, nowEpochMs, mode, durationMs = null } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') || !Number.isSafeInteger(nowEpochMs) ||
        !['full-session', 'partial-rehearsal'].includes(mode)) return { allowed: false, reason: 'invalid_start_input' };
    if (mode === 'full-session') {
        const earliest = Date.parse(`${tradeDate}T08:50:00+08:00`);
        const latest = Date.parse(`${tradeDate}T09:00:30+08:00`);
        if (nowEpochMs < earliest) return { allowed: false, reason: 'capture_start_too_early' };
        if (nowEpochMs > latest) return { allowed: false, reason: 'full_session_start_missed' };
        return { allowed: true, reason: null,
            endEpochMs: Date.parse(`${tradeDate}T13:34:30+08:00`) };
    }
    if (!Number.isSafeInteger(durationMs) || durationMs < 120_000 || durationMs > 900_000) {
        return { allowed: false, reason: 'invalid_rehearsal_duration' };
    }
    const earliest = Date.parse(`${tradeDate}T09:01:00+08:00`);
    const latest = Date.parse(`${tradeDate}T13:30:30+08:00`);
    if (nowEpochMs < earliest) return { allowed: false, reason: 'regular_session_not_started' };
    if (nowEpochMs + durationMs > latest) return { allowed: false, reason: 'rehearsal_would_cross_close' };
    return { allowed: true, reason: null, endEpochMs: nowEpochMs + durationMs };
}

export function validateFreshSimulationGeneration({ value, modifiedAtEpochMs, tradeDate, nowEpochMs,
    anchoredGeneration = null, anchoredAtEpochMs = null } = {}) {
    return Boolean(typeof value === 'string' && /^simulation:[A-Za-z0-9_-]{16,100}$/.test(value) &&
        /^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') && Number.isSafeInteger(modifiedAtEpochMs) &&
        modifiedAtEpochMs <= nowEpochMs && (anchoredGeneration === null ||
            (anchoredGeneration === value && Number.isSafeInteger(anchoredAtEpochMs) &&
                anchoredAtEpochMs >= Date.parse(`${tradeDate}T08:20:00+08:00`) &&
                anchoredAtEpochMs <= Date.parse(`${tradeDate}T08:35:00+08:00`))));
}

async function runtimeProbe(fetchImpl = fetch) {
    const request = async (url, init = {}) => {
        const startedAtEpochMs = Date.now();
        try {
            const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5_000) });
            const body = await response.json().catch(() => null);
            return { ok: response.ok, status: response.status, body,
                latencyMs: Math.max(0, Date.now() - startedAtEpochMs) };
        } catch { return { ok: false, status: null, body: null,
            latencyMs: Math.max(0, Date.now() - startedAtEpochMs) }; }
    };
    const [info, health, snapshot, web, multiView, monitorStatus] = await Promise.all([
        request('http://127.0.0.1:8080/api/v1/info'),
        request('http://127.0.0.1:8080/api/v1/health'),
        request('http://127.0.0.1:8080/api/v1/data/snapshots', { method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ contracts: [{ security_type: 'STK', region: 'TW', exchange: 'TSE',
                code: '2330', target_code: null }] }) }),
        request('http://127.0.0.1:5173/'),
        request('http://127.0.0.1:5174/'),
        request('http://127.0.0.1:5173/api/intraday-monitor/v1/status'),
    ]);
    const probe = (value) => ({ ok: value.ok, status: value.status, latencyMs: value.latencyMs });
    return { simulation: info.ok && info.body?.simulation === true,
        businessSession: health.ok && health.body?.status === 'healthy',
        snapshot2330: snapshot.ok && Array.isArray(snapshot.body) && snapshot.body.length === 1,
        web: web.ok, multiView: multiView.ok,
        probes: { info: probe(info), health: probe(health), snapshot2330: probe(snapshot),
            web: probe(web), multiView: probe(multiView), monitorStatus: probe(monitorStatus) },
        monitorStatus: monitorStatus.body };
}

async function readSseReplayFrame({ tradeDate, cursor = null, fetchImpl = fetch } = {}) {
    const target = new URL('http://127.0.0.1:5173/api/intraday-monitor/v1/events');
    target.searchParams.set('tradeDate', tradeDate);
    target.searchParams.set('limit', '100');
    const response = await fetchImpl(target, { method: 'GET', redirect: 'error',
        headers: { accept: 'text/event-stream', ...(cursor ? { 'last-event-id': cursor } : {}) },
        signal: AbortSignal.timeout(8_000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('local_event_stream_invalid');
    }
    const reader = response.body.getReader();
    let pending = '';
    try {
        while (Buffer.byteLength(pending) <= 512 * 1024) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += new TextDecoder().decode(value).replaceAll('\r', '');
            const boundary = pending.indexOf('\n\n');
            if (boundary < 0) continue;
            const lines = pending.slice(0, boundary).split('\n');
            const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
            const id = lines.find((line) => line.startsWith('id:'))?.slice(3).trim() ?? null;
            const data = lines.filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart()).join('\n');
            if (event !== 'replay' || !id || !data) throw new Error('local_event_replay_invalid');
            return { id, body: JSON.parse(data) };
        }
        throw new Error('local_event_replay_missing');
    } finally {
        await reader.cancel().catch(() => {});
    }
}

async function probeLocalEventStreamReconnect({ tradeDate, fetchImpl = fetch } = {}) {
    const first = await readSseReplayFrame({ tradeDate, fetchImpl });
    const second = await readSseReplayFrame({ tradeDate, cursor: first.id, fetchImpl });
    const firstIds = new Set((first.body?.items ?? []).map((item) => item.eventId));
    const duplicateIds = (second.body?.items ?? []).filter((item) => firstIds.has(item.eventId));
    const notificationViolation = [...(first.body?.items ?? []), ...(second.body?.items ?? [])]
        .some((item) => item.notificationAuthority !== false) ||
        first.body?.replayNotificationAuthority !== false || second.body?.replayNotificationAuthority !== false;
    const recovered = Boolean(first.body?.generation && first.body.generation === second.body?.generation &&
        second.id && duplicateIds.length === 0 && !notificationViolation);
    return { attempted: true, recovered, serverGeneration: first.body?.generation ?? null,
        cursorBefore: first.id, cursorAfter: second.id,
        replayedEventCount: (first.body?.items?.length ?? 0) + (second.body?.items?.length ?? 0),
        duplicateNotificationCount: duplicateIds.length + (notificationViolation ? 1 : 0) };
}

function resourceSnapshot() {
    const value = process.memoryUsage();
    return { rssBytes: value.rss, heapUsedBytes: value.heapUsed };
}

async function availableDiskBytes(outputPath) {
    const value = await statfs(path.dirname(outputPath));
    const bytes = value.bavail * value.bsize;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('REFUSED: available_disk_unknown');
    return bytes;
}

function databaseWorkingBytes(databasePath) {
    if (!databasePath) return 0;
    return [databasePath, `${databasePath}-wal`].reduce((total, candidate) => {
        try { return total + statSync(candidate).size; }
        catch (error) {
            if (error?.code === 'ENOENT') return total;
            throw error;
        }
    }, 0);
}

async function waitUntil(endEpochMs, interrupted, observe, checkpoint = null) {
    let checkpointCompleted = false;
    while (!interrupted()) {
        const currentEpochMs = Date.now();
        if (!checkpointCompleted && checkpoint && currentEpochMs >= checkpoint.atEpochMs) {
            checkpointCompleted = true;
            await checkpoint.onReached(new Date(currentEpochMs).toISOString());
        }
        const remaining = endEpochMs - currentEpochMs;
        if (remaining <= 0) break;
        const untilCheckpoint = !checkpointCompleted && checkpoint
            ? Math.max(0, checkpoint.atEpochMs - currentEpochMs) : 30_000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, remaining, untilCheckpoint)));
        observe();
    }
}

export async function writeDirect160CaptureFailure({ outputPath, tradeDate, mode, error,
    failedAt = new Date().toISOString() } = {}) {
    const paths = resolveIntradayMonitorCapturePaths(outputPath);
    const failure = { schemaVersion: DIRECT_160_CAPTURE_FAILURE_SCHEMA,
        failedAt, tradeDate, captureMode: mode,
        error: { name: String(error?.name ?? 'Error').slice(0, 64),
            message: String(error?.message ?? 'capture failed').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 256) },
        output: { capturePath: paths.capturePath, failurePath: paths.failurePath,
            mainEvidenceCreated: false },
        mainEvidenceCreated: false, notificationEligible: false, brokerWriteAuthority: false,
        productionAuthority: false, serviceLifecycleAuthority: false };
    await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    await writeDirect160Artifact(paths.failurePath, failure, 'session');
    return Object.freeze(failure);
}

export async function runDirect160Capture({ manifest, plan, baseline, prerequisite, tradeDate, mode,
    durationMs, outputPath, registryDirectory, generationPath, nowEpochMs = Date.now(),
    generationAnchorPath = null, eventLogPath = null, fetchImpl = fetch, productRuntime = null } = {}) {
    const logEvent = async (event, details = {}, options = {}) => {
        if (!eventLogPath) return null;
        return appendIntradayMonitorOperationalEvent(eventLogPath, { event,
            component: 'capture', tradeDate, details, ...options });
    };
    const window = inspectDirect160StageStart({ tradeDate, nowEpochMs, mode, durationMs });
    if (!window.allowed) throw new Error(`REFUSED: ${window.reason}`);
    const validation = validateDirect160LiveInputs({ manifest, plan, baseline, tradeDate });
    if (!validation.valid || prerequisite?.assessment?.valid !== true ||
        prerequisite.assessment.liveStage160Eligible !== true || prerequisite.review?.decision !== 'GO' ||
        prerequisite.review?.reviewerSignoff !== true) throw new Error('REFUSED: direct_160_prerequisite_invalid');
    const generationValue = (await readFile(generationPath, 'utf8')).trim();
    const generationStat = await stat(generationPath);
    const generationAnchor = generationAnchorPath
        ? JSON.parse(await readFile(generationAnchorPath, 'utf8')) : null;
    if (!validateFreshSimulationGeneration({ value: generationValue,
        modifiedAtEpochMs: Math.trunc(generationStat.mtimeMs), tradeDate, nowEpochMs,
        anchoredGeneration: generationAnchor?.generation ?? null,
        anchoredAtEpochMs: generationAnchor ? Date.parse(generationAnchor.anchoredAt) : null })) {
        throw new Error('REFUSED: fresh_simulation_generation_required');
    }
    const before = await runtimeProbe(fetchImpl);
    if (!before.simulation || !before.businessSession || !before.snapshot2330 || !before.web || !before.multiView) {
        throw new Error('REFUSED: runtime_business_readiness_failed');
    }
    await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    const diskBefore = await availableDiskBytes(outputPath);
    if (diskBefore < plan.budgets.minimumAvailableDiskBytes) {
        throw new Error('REFUSED: direct_160_disk_reserve_not_ready');
    }
    const registry = await claimDirect160Run({ directory: registryDirectory,
        connectionGeneration: generationValue, manifestHash: manifest.manifestHash,
        tradeDate, claimedAt: new Date(nowEpochMs).toISOString() });
    const startedAt = new Date(nowEpochMs).toISOString();
    await logEvent('capture_started', { mode, runId: registry.runId ?? null,
        generation: generationValue, cohortSize: 160 }, { severity: 'milestone' });
    const resourceBefore = resourceSnapshot();
    const databaseBytesBefore = databaseWorkingBytes(productRuntime?.evidenceDatabasePath);
    let maximumDatabaseBytes = databaseBytesBefore;
    const cpuBefore = process.cpuUsage();
    let maximumRssBytes = resourceBefore.rssBytes;
    let maximumHeapUsedBytes = resourceBefore.heapUsedBytes;
    let interrupted = false;
    let maximumEventToSealLatencyMs = 0;
    const interrupt = () => { interrupted = true; };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    let productSink = null;
    let components = null;
    let startReceipt = null;
    let stopReceipt = null;
    let productRuntimeProbe = null;
    let firstMinuteCanary = null;
    let recoveryReceipt = null;
    let gapBootstrap = null;
    const delayedBootstrapRequests = new Map();
    const bootstrapRequestedSymbols = new Set();
    let delayedBootstrapTimer = null;
    let delayedBootstrapChain = Promise.resolve();
    const runDelayedBootstrapBatch = async (requests) => {
        if (!productSink || requests.length === 0) return;
        const groups = new Map();
        for (const request of requests) {
            const key = `${request.endMinute}|${request.overlapMinute}`;
            const group = groups.get(key) ?? [];
            group.push(request);
            groups.set(key, group);
        }
        const worker = createDirect160GapBootstrapWorker({ fetchImpl,
            now: () => new Date().toISOString() });
        for (const group of groups.values()) {
            const liveOverlapBySymbol = new Map(group.map((request) => [
                request.contract.canonicalSymbol,
                [{ minuteKey: request.overlapMinute, volumeCommonLot: request.volumeCommonLot }],
            ]));
            try {
                const repaired = await worker.run({ contracts: group.map((request) => request.contract),
                    tradeDate, endMinute: group[0].endMinute, overlapMinute: group[0].overlapMinute,
                    liveGeneration: generationValue, liveOverlapBySymbol });
                const installed = productSink.installBootstrapGaps(repaired.receipts);
                const failedSymbols = repaired.results.map((result, index) => result?.ok
                    ? null : group[index].contract.canonicalSymbol).filter(Boolean);
                if (failedSymbols.length > 0) {
                    productSink.failBootstrapPrefixes(failedSymbols, 'bootstrap_prefix_validation_failed');
                }
                gapBootstrap = {
                    requested: (gapBootstrap?.requested ?? 0) + repaired.requested,
                    completed: (gapBootstrap?.completed ?? 0) + repaired.completed,
                    degraded: (gapBootstrap?.degraded ?? 0) + repaired.degraded,
                    installed: (gapBootstrap?.installed ?? 0) + installed.installed,
                    receiptHashes: [...(gapBootstrap?.receiptHashes ?? []),
                        ...repaired.receipts.map((receipt) => receipt.receiptHash)],
                    trigger: 'first_live_kbar_gap', notificationAuthority: false,
                };
                await logEvent('bootstrap_complete', gapBootstrap,
                    repaired.degraded > 0 ? { severity: 'incident', alertEligible: true } : {});
            } catch (error) {
                const symbols = group.map((request) => request.contract.canonicalSymbol);
                productSink.failBootstrapPrefixes(symbols, 'bootstrap_prefix_request_failed');
                gapBootstrap = { requested: (gapBootstrap?.requested ?? 0) + group.length,
                    completed: gapBootstrap?.completed ?? 0,
                    degraded: (gapBootstrap?.degraded ?? 0) + group.length,
                    installed: gapBootstrap?.installed ?? 0,
                    receiptHashes: gapBootstrap?.receiptHashes ?? [],
                    trigger: 'first_live_kbar_gap',
                    error: String(error?.message ?? 'gap_bootstrap_failed').slice(0, 128),
                    notificationAuthority: false };
                await logEvent('bootstrap_failed', gapBootstrap,
                    { severity: 'incident', alertEligible: true });
            }
        }
    };
    const dispatchDelayedBootstrap = () => {
        if (delayedBootstrapTimer) clearTimeout(delayedBootstrapTimer);
        delayedBootstrapTimer = null;
        const requests = [...delayedBootstrapRequests.values()];
        delayedBootstrapRequests.clear();
        if (requests.length === 0) return;
        delayedBootstrapChain = delayedBootstrapChain.then(() => runDelayedBootstrapBatch(requests));
    };
    const queueDelayedBootstrap = (event, result, contract) => {
        if (!productSink || result?.accepted !== true || result.reason !== 'forming' ||
            !Number.isSafeInteger(event?.volume) || event.volume < 0) return;
        const overlapMinute = event.time?.slice(0, 5);
        const endMinute = previousMinuteKey(overlapMinute);
        if (!contract || !endMinute || bootstrapRequestedSymbols.has(contract.canonicalSymbol)) return;
        bootstrapRequestedSymbols.add(contract.canonicalSymbol);
        productSink.requireBootstrapPrefixes([{ canonicalSymbol: contract.canonicalSymbol, endMinute }]);
        delayedBootstrapRequests.set(contract.canonicalSymbol, { contract, endMinute, overlapMinute,
            volumeCommonLot: event.volume });
        if (!delayedBootstrapTimer) delayedBootstrapTimer = setTimeout(dispatchDelayedBootstrap, 250);
    };
    try {
        if (productRuntime) {
            if (mode !== 'full-session') throw new Error('REFUSED: product_runtime_requires_full_session');
            productSink = createDirect160ProductSink({ manifest, baseline, config: productRuntime.config,
                tradeDate, connectionGeneration: generationValue,
                evidenceDatabasePath: productRuntime.evidenceDatabasePath,
                statePath: productRuntime.statePath, approvedActiveLimit: productRuntime.approvedActiveLimit ?? 20,
                now: () => new Date().toISOString() });
            productSink.installBaselines();
        }
        components = createDirect160StageComponents({ manifest, plan, baseline, tradeDate,
            connectionGeneration: generationValue, fetchImpl, now: () => new Date().toISOString(),
            onObservation: productSink ? productSink.persistObservation : null,
            onKbarResult: ({ event, result, processingLatencyMs }) => {
                if (result?.accepted === true) {
                    maximumEventToSealLatencyMs = Math.max(maximumEventToSealLatencyMs, processingLatencyMs);
                    const contract = components?.contracts.find((item) => item.code === event.code);
                    queueDelayedBootstrap(event, result, contract);
                    if (contract) productSink?.recordFirstKbarEvidence({
                        canonicalSymbol: contract.canonicalSymbol,
                        minuteKey: event.time?.slice(0, 5),
                        receivedAt: event.receivedTime,
                    });
                }
            } });
        startReceipt = await components.transport.start({ contracts: components.contracts,
            connectionGeneration: generationValue });
        await logEvent('subscription_requested', { cohortSize: startReceipt.cohortSize,
            cohortHash: startReceipt.cohortHash, subscribeAccepted: startReceipt.subscribeAccepted,
            generation: generationValue });
        if (productSink) {
            productRuntimeProbe = await runtimeProbe(fetchImpl);
            if (productRuntimeProbe.monitorStatus?.capacity?.evaluationStageTarget !== 160 ||
                productRuntimeProbe.monitorStatus?.capacity?.controlPlaneSubscriptionRequested !== true) {
                throw new Error('REFUSED: product_runtime_api_not_ready');
            }
        }
        await waitUntil(window.endEpochMs, () => interrupted, () => {
            const current = resourceSnapshot();
            maximumRssBytes = Math.max(maximumRssBytes, current.rssBytes);
            maximumHeapUsedBytes = Math.max(maximumHeapUsedBytes, current.heapUsedBytes);
            maximumDatabaseBytes = Math.max(maximumDatabaseBytes,
                databaseWorkingBytes(productRuntime?.evidenceDatabasePath));
        }, productSink ? {
            atEpochMs: Date.parse(`${tradeDate}T09:02:15+08:00`),
            onReached: async (evaluatedAt) => {
                const transportStatus = components.transport.status();
                firstMinuteCanary = productSink.runFirstMinuteCanary(evaluatedAt,
                    transportStatus.phase === 'running' ? 'connected' : 'disconnected');
                await logEvent('first_minute_canary', {
                    evaluatedAt, receivedCount: firstMinuteCanary.receivedCount,
                    missingCount: firstMinuteCanary.missingCount,
                    missing: firstMinuteCanary.missing,
                    liveAvailabilityComplete: firstMinuteCanary.liveAvailabilityComplete,
                    immutable: true,
                }, firstMinuteCanary.liveAvailabilityComplete
                    ? { severity: 'milestone' }
                    : { severity: 'incident', alertEligible: true });
                if (!firstMinuteCanary.liveAvailabilityComplete) {
                    await logEvent('bootstrap_awaiting_first_live_kbar', {
                        missingCount: firstMinuteCanary.missingCount,
                        reason: 'gap_end_and_live_overlap_not_yet_known',
                        notificationAuthority: false,
                    });
                    const authority = createBoundedKbarRecoveryAuthority({ tradeDate,
                        connectionGeneration: generationValue, cohortHash: startReceipt.cohortHash });
                    const recovery = authority.issue({ missingCount: Math.max(1,
                        firstMinuteCanary.missingCount) });
                    recoveryReceipt = recovery.allowed
                        ? await components.transport.recover({ connectionGeneration: generationValue,
                            requestedCohortHash: startReceipt.cohortHash })
                        : recovery;
                    await logEvent('bounded_recovery_complete', {
                        allowed: recovery.allowed, recovered: recoveryReceipt?.recovered ?? null,
                        missingCount: firstMinuteCanary.missingCount,
                    }, recoveryReceipt?.recovered === true ? {} :
                        { severity: 'incident', alertEligible: true });
                }
            },
        } : null);
        if (delayedBootstrapTimer) dispatchDelayedBootstrap();
        await delayedBootstrapChain;
        if (!interrupted && mode === 'full-session') {
            const observedAtEpochMs = Date.now();
            components.session.sealSessionClose(issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate,
                observedAtEpochMs, timeZone: 'Asia/Taipei' }, observedAtEpochMs));
        } else {
            components.session.sealSessionClose({ mode, interrupted });
        }
    } catch (error) {
        if (delayedBootstrapTimer) {
            clearTimeout(delayedBootstrapTimer);
            delayedBootstrapTimer = null;
        }
        productSink?.fail('capture_failed');
        throw error;
    } finally {
        stopReceipt = await components?.transport.stop().catch(() => ({ stopped: false,
            unsubscribeAccepted: false, providerReleaseProven: false }));
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        await registry.release();
    }
    try {
    const endedAt = new Date().toISOString();
    const after = await runtimeProbe(fetchImpl);
    let passiveChartEvidence = null;
    let localEventReconnect = null;
    if (productSink) {
        passiveChartEvidence = await json(productRuntime.chartEvidencePath);
        const chartValidation = validatePassiveChartFreshnessEvidence(passiveChartEvidence);
        if (!chartValidation.ready || passiveChartEvidence.tradeDate !== tradeDate) {
            throw new Error('REFUSED: same_day_passive_chart_evidence_required');
        }
        localEventReconnect = await probeLocalEventStreamReconnect({ tradeDate, fetchImpl });
        if (!localEventReconnect.recovered) {
            throw new Error('REFUSED: local_event_stream_reconnect_failed');
        }
    }
    const diskAfter = await availableDiskBytes(outputPath);
    const session = components.session.evidence({ endedAt });
    const elapsedMs = Math.max(1, Date.parse(endedAt) - nowEpochMs);
    const cpu = process.cpuUsage(cpuBefore);
    maximumDatabaseBytes = Math.max(maximumDatabaseBytes,
        databaseWorkingBytes(productRuntime?.evidenceDatabasePath));
    const resources = { cpuBasisPoints: Math.round(((cpu.user + cpu.system) / (elapsedMs * 1000)) * 10_000),
        maxRssBytes: maximumRssBytes,
        databaseGrowthBytes: Math.max(0, maximumDatabaseBytes - databaseBytesBefore),
        minimumAvailableDiskBytes: Math.min(diskBefore, diskAfter),
        maxEventToSealLatencyMs: maximumEventToSealLatencyMs,
        maxChartFreshnessMs: passiveChartEvidence ? Math.max(
            passiveChartEvidence.firstObservation.freshnessMs,
            passiveChartEvidence.secondObservation.freshnessMs,
        ) : Math.max(before.probes.web.latencyMs, before.probes.multiView.latencyMs,
            after.probes.web.latencyMs, after.probes.multiView.latencyMs) };
    let replay = null;
    let tieredSession = null;
    if (mode === 'full-session' && session.assessment.fullSession) {
        replay = runDirect160DeterministicReplay({ session, baseline, manifest });
        tieredSession = buildDirect160TieredSessionEvidence({ plan, manifest, baseline, session,
            replay, transport: { startReceipt, stopReceipt }, resources,
            assurances: { reconnectVerified: productSink ? localEventReconnect.recovered :
                before.businessSession && after.businessSession,
                existingFeaturesHealthy: before.web && before.multiView && after.web && after.multiView &&
                    (!productSink || Boolean(passiveChartEvidence)) } });
    }
    let productRuntimeState = null;
    if (productSink) productRuntimeState = tieredSession
        ? productSink.finishPendingReview() : productSink.fail('full_session_incomplete');
    const liveAvailabilityComplete = productSink ? firstMinuteCanary?.liveAvailabilityComplete === true : null;
    const result = { schemaVersion: DIRECT_160_CAPTURE_SCHEMA, evidenceClass: 'live_bounded_stage',
        captureMode: mode, tradeDate, startedAt, endedAt, interrupted,
        manifestHash: manifest.manifestHash, planHash: plan.planHash, baselineHash: baseline.baselineHash,
        connectionGeneration: generationValue, session, replay, tieredSession,
        transport: { startReceipt, stopReceipt, status: components.transport.status(),
            providerPhysicalUsage: null, providerReleaseProven: null },
        resources: { ...resources, maximumHeapUsedBytes }, runtime: { before, after,
            productRuntimeProbe,
            firstMinuteCanary,
            recoveryReceipt,
            gapBootstrap,
            localEventReconnect,
            passiveChartEvidenceHash: passiveChartEvidence?.evidenceHash ?? null,
            freshSimulationGeneration: true, generationModifiedAt: new Date(generationStat.mtimeMs).toISOString(),
            chartFreshnessMeasurement: passiveChartEvidence ? 'same_day_passive_dom_visual_commit' :
                'bounded_existing_service_response_latency' },
        productRuntime: productRuntimeState ? { phase: productRuntimeState.phase,
            evaluationState: productRuntimeState.evaluationState,
            approvedActiveLimit: productRuntimeState.approvedActiveLimit,
            persistedObservationCount: productRuntimeState.persistedObservationCount,
            persistedTriggerCount: productRuntimeState.persistedTriggerCount,
            notificationAuthority: productRuntimeState.notificationAuthority,
            liveAvailabilityComplete: productRuntimeState.liveAvailabilityComplete } : null,
        operations: { notificationDispatches: 0, brokerWrites: 0, productionTransitions: 0,
            serviceLifecycleMutations: 0, activeLimitMutations: 0 },
        assessment: { formalAcceptanceEvidence: mode === 'full-session' && Boolean(tieredSession) &&
                liveAvailabilityComplete === true,
            readyForBundle: Boolean(tieredSession) && liveAvailabilityComplete === true,
            dataContinuityComplete: Boolean(tieredSession), liveAvailabilityComplete,
            providerCapacityProven: false } };
    await writeDirect160Artifact(outputPath, result, 'capture');
    await logEvent('capture_close_sealed', {
        outputPath, formalAcceptanceEvidence: result.assessment.formalAcceptanceEvidence,
        dataContinuityComplete: result.assessment.dataContinuityComplete,
        liveAvailabilityComplete: result.assessment.liveAvailabilityComplete,
        observedSymbols: result.session.symbols.filter((item) => item.minuteCount > 0).length,
    }, { severity: result.assessment.formalAcceptanceEvidence ? 'milestone' : 'incident',
        alertEligible: !result.assessment.formalAcceptanceEvidence });
    return result;
    } catch (error) {
        productSink?.fail('evidence_finalization_failed');
        throw error;
    }
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('--execute required');
    const manifestPath = absolute('manifest');
    const planPath = absolute('plan');
    const baselinePath = absolute('baseline');
    const prerequisitePath = absolute('prerequisite');
    const outputPath = absolute('output');
    const generationPath = absolute('generation-file');
    const generationAnchorPath = argument('generation-anchor') ? absolute('generation-anchor') : null;
    const eventLogPath = argument('event-log') ? absolute('event-log') : null;
    const registryDirectory = absolute('registry-directory');
    const tradeDate = argument('trade-date');
    const mode = argument('mode') ?? 'full-session';
    const durationMs = Number(argument('duration-ms') ?? 180_000);
    const productMode = process.argv.includes('--product-mode');
    let productRuntime = null;
    if (productMode) {
        const configDatabasePath = absolute('config-database');
        const evidenceDatabasePath = absolute('evidence-database');
        const statePath = absolute('product-state');
        const chartEvidencePath = absolute('chart-evidence');
        const repository = new IntradayMonitorConfigRepository(configDatabasePath);
        try { productRuntime = { config: repository.read(), evidenceDatabasePath, statePath,
            chartEvidencePath,
            approvedActiveLimit: Number(argument('approved-active-limit') ?? 20) }; }
        finally { repository.close(); }
    }
    const [manifest, plan, baseline, prerequisite] = await Promise.all([
        json(manifestPath), json(planPath), json(baselinePath), json(prerequisitePath),
    ]);
    try {
        const result = await runDirect160Capture({ manifest, plan, baseline, prerequisite, tradeDate,
            mode, durationMs, outputPath, registryDirectory, generationPath, generationAnchorPath,
            eventLogPath, productRuntime });
        const paths = resolveIntradayMonitorCapturePaths(outputPath);
        process.stdout.write(`${JSON.stringify({ created: true, outputPath: paths.capturePath,
            failurePath: paths.failurePath,
            formalAcceptanceEvidence: result.assessment.formalAcceptanceEvidence,
            observedSymbols: result.session.symbols.filter((item) => item.minuteCount > 0).length,
            providerPhysicalUsage: null, providerReleaseProven: null }, null, 2)}\n`);
    } catch (error) {
        const failure = await writeDirect160CaptureFailure({ outputPath, tradeDate, mode, error }).catch(() => null);
        if (eventLogPath) await appendIntradayMonitorOperationalEvent(eventLogPath, {
            event: 'capture_failure_sidecar', component: 'capture', tradeDate,
            severity: 'incident', alertEligible: true,
            details: { failurePath: failure?.output?.failurePath ?? `${outputPath}.failure.json`,
                error: String(error?.message ?? 'capture_failed').slice(0, 256) },
        }).catch(() => {});
        if (failure) process.stderr.write(`${JSON.stringify({ created: false,
            outputPath: failure.output.capturePath, failurePath: failure.output.failurePath })}\n`);
        throw error;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
