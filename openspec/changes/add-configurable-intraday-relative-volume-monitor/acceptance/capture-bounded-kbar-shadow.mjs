import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createBoundedKbarTransport } from '../../../../scripts/intraday-monitor-runtime/bounded-kbar-transport.mjs';
import { createIntradayMonitorKbarShadowSession } from '../../../../scripts/intraday-monitor-runtime/kbar-shadow-session-recorder.mjs';
import { writeExclusiveJsonAtomically,
    writeIntradayMonitorKbarCaptureFailure } from '../../../../scripts/intraday-monitor-runtime/kbar-capture-outcome-writer.mjs';
import { INTRADAY_MONITOR_CLOSE_FINALIZATION_TIME,
    INTRADAY_MONITOR_DELAYED_CLOSE_MINUTE,
    INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE,
    issueIntradayMonitorKbarSessionCloseAuthority } from '../../../../scripts/intraday-monitor-runtime/kbar-stream-adapter.mjs';
import { validateIntradayMonitorPilotCohortReceiptManifest } from '../../../../scripts/intraday-monitor-runtime/pilot-cohort-receipts.mjs';

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function inspectBoundedKbarCaptureStart(tradeDate, nowEpochMs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') || !Number.isSafeInteger(nowEpochMs)) {
        return { allowed: false, reason: 'invalid_start_input' };
    }
    const earliest = Date.parse(`${tradeDate}T08:50:00+08:00`);
    const latest = Date.parse(`${tradeDate}T09:00:30+08:00`);
    if (nowEpochMs < earliest) return { allowed: false, reason: 'capture_start_too_early' };
    if (nowEpochMs > latest) return { allowed: false, reason: 'full_session_start_missed' };
    return { allowed: true, reason: 'none',
        normalCloseMinute: INTRADAY_MONITOR_NORMAL_CLOSE_MINUTE,
        delayedCloseMinute: INTRADAY_MONITOR_DELAYED_CLOSE_MINUTE,
        closeFinalizationTime: INTRADAY_MONITOR_CLOSE_FINALIZATION_TIME,
        closeEpochMs: Date.parse(`${tradeDate}T${INTRADAY_MONITOR_CLOSE_FINALIZATION_TIME}+08:00`) };
}

export function inspectBoundedKbarRehearsalStart(tradeDate, nowEpochMs, durationMs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') || !Number.isSafeInteger(nowEpochMs) ||
        !Number.isSafeInteger(durationMs) || durationMs < 120_000 || durationMs > 900_000) {
        return { allowed: false, reason: 'invalid_rehearsal_input' };
    }
    const earliest = Date.parse(`${tradeDate}T09:01:00+08:00`);
    const latestEnd = Date.parse(`${tradeDate}T13:30:30+08:00`);
    if (nowEpochMs < earliest) return { allowed: false, reason: 'regular_session_not_started' };
    if (nowEpochMs + durationMs > latestEnd) return { allowed: false, reason: 'rehearsal_would_cross_close' };
    return { allowed: true, reason: 'none', closeEpochMs: nowEpochMs + durationMs };
}

function percentile(values, ratio) {
    if (values.length === 0) return null;
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

function resourceSnapshot() {
    const memory = process.memoryUsage();
    return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, externalBytes: memory.external };
}

async function snapshotAvailabilityProbe(contract) {
    const startedAt = Date.now();
    try {
        const response = await fetch('http://127.0.0.1:8080/api/v1/data/snapshots', {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ contracts: [{ security_type: 'STK', region: 'TW', exchange: contract.exchange,
                code: contract.code, target_code: null }] }),
            redirect: 'error',
            signal: AbortSignal.timeout(8_000),
        });
        const body = await response.json().catch(() => null);
        return { available: response.ok && Array.isArray(body) && body.length === 1,
            httpStatus: response.status, latencyMs: Date.now() - startedAt };
    } catch {
        return { available: false, httpStatus: null, latencyMs: Date.now() - startedAt };
    }
}

async function streamConnectionProbe() {
    try {
        const response = await fetch('http://127.0.0.1:8080/api/v1/stream/status', {
            method: 'GET', headers: { accept: 'application/json' }, redirect: 'error',
            signal: AbortSignal.timeout(8_000),
        });
        const body = await response.json().catch(() => null);
        return { available: response.ok, activeConnections: Number.isSafeInteger(body?.active_connections)
            ? body.active_connections : null };
    } catch {
        return { available: false, activeConnections: null };
    }
}

async function main() {
    const execute = process.argv.includes('--execute');
    const cohortPath = argument('cohort-receipts');
    const tradeDate = argument('trade-date');
    const outputPath = argument('output');
    const captureMode = argument('mode') ?? 'full-session';
    const durationMs = Number(argument('duration-ms') ?? 180_000);
    if (!execute || !cohortPath || !tradeDate || !outputPath ||
        !['full-session', 'partial-rehearsal'].includes(captureMode)) {
        throw new Error('usage: --execute --mode=full-session|partial-rehearsal --cohort-receipts=PATH --trade-date=YYYY-MM-DD --output=PATH [--duration-ms=120000..900000]');
    }
    const startEpochMs = Date.now();
    const window = captureMode === 'full-session'
        ? inspectBoundedKbarCaptureStart(tradeDate, startEpochMs)
        : inspectBoundedKbarRehearsalStart(tradeDate, startEpochMs, durationMs);
    if (!window.allowed) throw new Error(`REFUSED: ${window.reason}`);
    const manifest = JSON.parse(await readFile(cohortPath, 'utf8'));
    if (!validateIntradayMonitorPilotCohortReceiptManifest(manifest).valid || manifest.cohort.length !== 20 ||
        manifest.receipts.some((item) => !/^(?!00)\d{4}$/.test(item.code)) ||
        manifest.receipts.some((item) => item.canonicalSymbol.endsWith('.TWO') ? item.exchange !== 'OTC' : item.exchange !== 'TSE')) {
        throw new Error('REFUSED: exactly 20 verified bounded-KBar-eligible cohort receipts are required');
    }
    const contracts = manifest.receipts.map((item) => ({ securityType: 'STK', region: 'TW', exchange: item.exchange,
        code: item.code, targetCode: null, canonicalSymbol: item.canonicalSymbol }));
    const connectionGeneration = `kbar_${startEpochMs}_${manifest.manifestHash.slice(0, 24)}`;
    const session = createIntradayMonitorKbarShadowSession({ cohort: contracts, tradeDate, connectionGeneration,
        startedAt: new Date(startEpochMs).toISOString() });
    const kbarLatenciesMs = [];
    const transport = createBoundedKbarTransport({ onEvent: (event) => {
        const eventEpochMs = Date.parse(`${tradeDate}T${event.time}+08:00`);
        const receivedEpochMs = Date.parse(event.receivedTime);
        if (Number.isFinite(eventEpochMs) && Number.isFinite(receivedEpochMs) && receivedEpochMs >= eventEpochMs) {
            kbarLatenciesMs.push(receivedEpochMs - eventEpochMs);
        }
        return session.recordKbar(event);
    },
        onDisconnect: ({ connectionGeneration: generation }) => session.markDisconnected({ connectionGeneration: generation }) });
    const resourceBefore = resourceSnapshot();
    const cpuBefore = process.cpuUsage();
    let maxRssBytes = resourceBefore.rssBytes;
    let maxHeapUsedBytes = resourceBefore.heapUsedBytes;
    const streamConnectionsBefore = await streamConnectionProbe();
    const snapshotBefore = await snapshotAvailabilityProbe(contracts[0]);
    let interrupted = false;
    const interrupt = () => { interrupted = true; };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    let startReceipt;
    let stopReceipt;
    try {
        startReceipt = await transport.start({ contracts, connectionGeneration });
        while (!interrupted && Date.now() < window.closeEpochMs) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, window.closeEpochMs - Date.now())));
            const current = resourceSnapshot();
            maxRssBytes = Math.max(maxRssBytes, current.rssBytes);
            maxHeapUsedBytes = Math.max(maxHeapUsedBytes, current.heapUsedBytes);
        }
        if (!interrupted && captureMode === 'full-session') {
            const closeObservedAt = Date.now();
            const closeAuthority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate,
                observedAtEpochMs: closeObservedAt, timeZone: 'Asia/Taipei' }, closeObservedAt);
            session.sealSessionClose(closeAuthority);
        } else {
            session.sealSessionClose({ partialRehearsal: captureMode === 'partial-rehearsal', interrupted });
        }
    } finally {
        stopReceipt = await transport.stop().catch(() => ({ stopped: false, unsubscribeAccepted: false, providerReleaseProven: false }));
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
    }
    const endedAt = new Date().toISOString();
    const resourceAfter = resourceSnapshot();
    const cpu = process.cpuUsage(cpuBefore);
    const elapsedMs = Math.max(1, Date.parse(endedAt) - startEpochMs);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const streamConnectionsAfter = await streamConnectionProbe();
    const snapshotAfter = await snapshotAvailabilityProbe(contracts[0]);
    let sessionEvidence;
    try {
        sessionEvidence = session.evidence({ endedAt });
    } catch (error) {
        await writeIntradayMonitorKbarCaptureFailure({ outputPath, tradeDate, captureMode, failedAt: endedAt,
            stage: 'session_evidence', error, startReceipt, stopReceipt, transportStatus: transport.status(),
            interrupted });
        throw error;
    }
    const result = {
        schemaVersion: 'intraday-monitor-bounded-kbar-capture/1',
        captureMode,
        cohortReceiptManifestHash: manifest.manifestHash,
        session: sessionEvidence,
        transport: { startReceipt, stopReceipt, finalStatus: transport.status() },
        streamConnections: { before: streamConnectionsBefore, after: streamConnectionsAfter,
            provesProviderRelease: false },
        rehearsal: {
            formalAcceptanceEvidence: captureMode === 'full-session' && sessionEvidence.assessment.fullSession,
            baselineEligible: captureMode === 'full-session' && sessionEvidence.assessment.baselineEligible,
            notificationAuthority: false,
            durationMs: elapsedMs,
            kbarLatencyMs: { sampleCount: kbarLatenciesMs.length, p50: percentile(kbarLatenciesMs, 0.5),
                p95: percentile(kbarLatenciesMs, 0.95), max: kbarLatenciesMs.length ? Math.max(...kbarLatenciesMs) : null },
            resources: { cpuBasisPoints: Math.round(((cpu.user + cpu.system) / (elapsedMs * 1000)) * 10_000),
                rssBeforeBytes: resourceBefore.rssBytes, rssAfterBytes: resourceAfter.rssBytes,
                rssDeltaBytes: resourceAfter.rssBytes - resourceBefore.rssBytes, maxRssBytes,
                heapUsedBeforeBytes: resourceBefore.heapUsedBytes, heapUsedAfterBytes: resourceAfter.heapUsedBytes,
                maxHeapUsedBytes, evidenceDatabaseWrites: 0, evidenceDatabaseGrowthBytes: 0 },
            existingSnapshotAvailability: { before: snapshotBefore, after: snapshotAfter,
                provesVisualChartFreshness: false },
        },
        interrupted,
    };
    await writeExclusiveJsonAtomically(outputPath, result);
    process.stdout.write(`${JSON.stringify({ created: true, outputPath, tradeDate, captureMode,
        fullSession: result.session.assessment.fullSession, evidenceHash: result.session.evidenceHash,
        observedKbarSymbols: result.session.symbols.filter((item) => item.minuteCount > 0).length,
        providerPhysicalUsage: null, providerReleaseProven: false }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch(async (error) => {
        const outputPath = argument('output');
        const tradeDate = argument('trade-date');
        const captureMode = argument('mode') ?? 'full-session';
        if (process.argv.includes('--execute') && typeof outputPath === 'string' && outputPath.startsWith('/') &&
            /^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') &&
            ['full-session', 'partial-rehearsal'].includes(captureMode)) {
            await writeIntradayMonitorKbarCaptureFailure({ outputPath, tradeDate, captureMode,
                failedAt: new Date().toISOString(), stage: 'capture_process', error }).catch(() => {});
        }
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
