import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createPremarketScheduleReceipt } from './premarket-schedule.mjs';
import { claimPremarketCaptureStart } from './premarket-capture-start-claim.mjs';
import { appendIntradayMonitorOperationalEvent } from './operational-event-log.mjs';
import { recordIntradayMonitorLocalIncident } from './local-incident-alert.mjs';
import { inspectDirect160ProductSinkInputs, readDirect160ProductRuntimeState } from './direct-160-product-runtime.mjs';
import { IntradayMonitorConfigRepository } from './config-repository.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';
import {
    inspectIntradayMonitorPremarketDailySession,
    prepareIntradayMonitorPremarketDailySession,
    resolveIntradayMonitorDailyBaselinePath,
} from './premarket-daily-session.mjs';
import { resolveIntradayMonitorPremarketTradingDay } from './trading-calendar-authority.mjs';

export const PREMARKET_ORCHESTRATOR_SCHEMA = 'intraday-monitor-premarket-orchestrator/1';
export const PREMARKET_ORCHESTRATOR_LABEL = 'com.alanyi.realtimestock.intraday-premarket';
const STEPS = new Set(['08:20', '08:35', '08:45', '08:50']);

function appSupportRoot() {
    return process.env.REALTIME_STOCK_APP_SUPPORT ??
        path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock');
}

export function resolvePremarketOrchestratorPaths(root = appSupportRoot()) {
    const directory = path.join(root, 'IntradayMonitor', 'premarket');
    return Object.freeze({ directory, configPath: path.join(directory, 'config.json'),
        claimsDirectory: path.join(directory, 'claims'), logPath: path.join(directory, 'events.jsonl'),
        receiptsDirectory: path.join(directory, 'receipts'),
        generationAnchorPath: path.join(directory, 'generation-anchor.json'),
        plistPath: path.join(os.homedir(), 'Library', 'LaunchAgents', `${PREMARKET_ORCHESTRATOR_LABEL}.plist`) });
}

export async function claimPremarketStep(paths, tradeDate, step, schedulerId) {
    await mkdir(paths.claimsDirectory, { recursive: true, mode: 0o700 });
    const claimPath = path.join(paths.claimsDirectory, `${tradeDate}-${step.replace(':', '')}.json`);
    const handle = await open(claimPath, 'wx', 0o600).catch((error) => {
        if (error?.code === 'EEXIST') throw new Error('premarket_step_already_claimed');
        throw error;
    });
    const claim = { schemaVersion: PREMARKET_ORCHESTRATOR_SCHEMA, runId: `${tradeDate}-${step}`,
        schedulerId, tradeDate, step, claimedAt: new Date().toISOString() };
    try { await handle.writeFile(`${JSON.stringify(claim)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    return { ...claim, claimPath };
}

async function persistPremarketRunReceipt(paths, value) {
    await mkdir(paths.receiptsDirectory, { recursive: true, mode: 0o700 });
    const target = path.join(paths.receiptsDirectory,
        `${value.localDate}-${value.step.replace(':', '')}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    return target;
}

async function fetchProbe(url, init = {}) {
    const started = Date.now();
    try {
        const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5_000) });
        const text = await response.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch {}
        return { ok: response.ok, status: response.status, body, latencyMs: Date.now() - started };
    } catch (error) { return { ok: false, status: null,
        error: String(error?.message ?? 'probe_failed').slice(0, 128), latencyMs: Date.now() - started }; }
}

async function readText(file) {
    try { return (await readFile(file, 'utf8')).trim(); } catch { return null; }
}

async function inspectArtifactSet(config, root) {
    let resolvedConfig = config;
    let runtimeBundle = null;
    if (config.artifactBundleHash) {
        runtimeBundle = await resolveIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: root,
            bundleHash: config.artifactBundleHash,
        });
        if (!runtimeBundle.valid) {
            return { ready: false, files: [], exactCohort: false, baseline: false,
                runtimeBundle, reason: 'artifact_bundle_invalid' };
        }
        resolvedConfig = { ...config,
            manifestPath: runtimeBundle.files.cohort,
            planPath: runtimeBundle.files.plan,
            baselinePath: runtimeBundle.files.baseline ?? config.baselinePath,
            prerequisitePath: runtimeBundle.files.baseline_prerequisite ??
                runtimeBundle.files.prerequisite };
    }
    const keys = ['manifestPath', 'planPath', 'baselinePath', 'prerequisitePath', 'configDatabasePath'];
    const files = await Promise.all(keys.map(async (key) => ({ key, path: resolvedConfig[key], exists: Boolean(resolvedConfig[key]) &&
        await stat(resolvedConfig[key]).then((value) => value.isFile()).catch(() => false) })));
    if (!files.every((file) => file.exists)) return { ready: false, files, exactCohort: false, baseline: false };
    try {
        const [manifest, plan, baseline, prerequisite] = await Promise.all(
            ['manifestPath', 'planPath', 'baselinePath', 'prerequisitePath']
                .map((key) => readFile(resolvedConfig[key], 'utf8').then(JSON.parse)));
        const symbols = manifest.cohort?.map((item) => item.canonicalSymbol) ?? [];
        return { ready: manifest.stage === 160 && symbols.length === 160 && new Set(symbols).size === 160 &&
                plan.stage === 160 && plan.manifestHash === manifest.manifestHash &&
                baseline.manifestHash === manifest.manifestHash && baseline.calendar?.targetTradeDate === config.tradeDate &&
                baseline.manifests?.length === 160 && prerequisite.assessment?.liveStage160Eligible === true &&
                prerequisite.review?.decision === 'GO',
            files, exactCohort: symbols.length === 160 && new Set(symbols).size === 160,
            cohortSymbols: symbols,
            baseline: baseline.manifests?.length === 160 && baseline.calendar?.targetTradeDate === config.tradeDate,
            manifestHash: manifest.manifestHash, baselineHash: baseline.baselineHash,
            runtimeBundle, resolvedConfig };
    } catch { return { ready: false, files, exactCohort: false, baseline: false }; }
}

export function configuredCohortMatches(configuredSymbols, manifestSymbols) {
    return Array.isArray(configuredSymbols) && Array.isArray(manifestSymbols) &&
        manifestSymbols.length === 160 && configuredSymbols.length >= 160 &&
        manifestSymbols.every((symbol, index) => symbol === configuredSymbols[index]);
}

function inspectConfiguredCohort(databasePath, manifestSymbols) {
    let database = null;
    try {
        database = new DatabaseSync(databasePath, { readOnly: true });
        const symbols = database.prepare(
            'SELECT code, exchange FROM intraday_monitor_config_items WHERE enabled = 1 ORDER BY position',
        ).all().map((item) => `${item.code}.${item.exchange === 'TSE' ? 'TW' : 'TWO'}`);
        return { matches: configuredCohortMatches(symbols, manifestSymbols), enabled: symbols.length,
            reason: 'checked' };
    } catch { return { matches: false, enabled: null, reason: 'config_unavailable' }; }
    finally { database?.close(); }
}

async function inspectProductSinkReadiness(config, root, artifacts) {
    if (!artifacts.ready) return { ready: false, reason: 'artifact_bundle_invalid' };
    let repository = null;
    try {
        const resolved = artifacts.resolvedConfig;
        const [manifest, baseline] = await Promise.all([
            readFile(resolved.manifestPath, 'utf8').then(JSON.parse),
            readFile(resolved.baselinePath, 'utf8').then(JSON.parse),
        ]);
        repository = new IntradayMonitorConfigRepository(resolved.configDatabasePath);
        const savedConfig = repository.read();
        const approval = new IntradayMonitorSessionStateRepository(root).readApproval();
        return inspectDirect160ProductSinkInputs({ manifest, baseline, config: savedConfig,
            tradeDate: config.tradeDate, approvedActiveLimit: approval?.approvedActiveLimit ?? 160,
            capacityApproval: approval, requireCurrentSessionAuthority: true,
            sessionCurrent: true, statePath: resolved.productStatePath });
    } catch {
        return { ready: false, reason: 'product_sink_preflight_unavailable' };
    } finally { repository?.close(); }
}

export async function inspectPremarketGates(config, root = appSupportRoot(),
    { requireStableGeneration = false } = {}) {
    const paths = resolvePremarketOrchestratorPaths(root);
    const [info, health, snapshot, web, multiView, mode, generation, artifacts, disk, anchor] = await Promise.all([
        fetchProbe('http://127.0.0.1:8080/api/v1/info'),
        fetchProbe('http://127.0.0.1:8080/api/v1/health'),
        fetchProbe('http://127.0.0.1:8080/api/v1/data/snapshots', { method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contracts: [{ security_type: 'STK', region: 'TW', exchange: 'TSE',
                code: '2330', target_code: null }] }) }),
        fetchProbe('http://127.0.0.1:5173/'), fetchProbe('http://127.0.0.1:5174/api/health'),
        readText(path.join(root, 'runtime-mode')), readText(path.join(root, 'runtime-api-generation')),
        inspectArtifactSet(config, root),
        statfs(root).then((value) => value.bavail * value.bsize).catch(() => null),
        readFile(paths.generationAnchorPath, 'utf8').then(JSON.parse).catch(() => null),
    ]);
    const configuredCohort = inspectConfiguredCohort(
        artifacts.resolvedConfig?.configDatabasePath ?? config.configDatabasePath,
        artifacts.cohortSymbols,
    );
    const productSinkPreflight = await inspectProductSinkReadiness(config, root, artifacts);
    const checks = { simulation: info.ok && info.body?.simulation === true && mode === 'simulation',
        apiGeneration: typeof generation === 'string' && /^simulation:[A-Za-z0-9_-]{16,100}$/.test(generation),
        businessSession: health.ok && health.body?.status === 'healthy',
        snapshot2330: snapshot.ok && Array.isArray(snapshot.body) && snapshot.body.length === 1,
        web: web.ok, multiView: multiView.ok && multiView.body?.ok === true,
        artifacts: artifacts.ready, exactCohort: artifacts.exactCohort, baseline: artifacts.baseline,
        configuredCohort: configuredCohort.matches,
        productSink: productSinkPreflight.ready,
        disk: Number.isSafeInteger(disk) && disk >= (config.minimumAvailableDiskBytes ?? 8 * 1024 ** 3),
        generationStable: !requireStableGeneration || anchor?.generation === generation,
        brokerWriteBlockade: true };
    return Object.freeze({ ready: Object.values(checks).every(Boolean), checks, probes: { info, health,
        snapshot2330: snapshot, web, multiView }, mode, generation, artifacts,
        availableDiskBytes: disk, generationAnchor: anchor, configuredCohort, productSinkPreflight,
        observedAt: new Date().toISOString(), brokerWriteAuthority: false });
}

export function simulationApiWarmupReady(gates) {
    return gates?.checks?.simulation === true &&
        gates?.checks?.apiGeneration === true &&
        gates?.checks?.businessSession === true &&
        gates?.checks?.snapshot2330 === true;
}

export function resolvePremarketApprovedActiveLimit(config, manifestHash,
    readState = readDirect160ProductRuntimeState) {
    const state = typeof readState === 'function' ? readState(config?.productStatePath) : null;
    return state?.phase === 'complete_go' && state.evaluationState === 'go' &&
        state.approvedActiveLimit === 160 && state.manifestHash === manifestHash ? 160 : 20;
}

function warmupGateEvidence(gates) {
    return {
        simulation: gates?.checks?.simulation === true,
        apiGeneration: gates?.checks?.apiGeneration === true,
        businessSession: gates?.checks?.businessSession === true,
        snapshot2330: gates?.checks?.snapshot2330 === true,
        infoStatus: gates?.probes?.info?.status ?? null,
        healthStatus: gates?.probes?.health?.status ?? null,
        snapshotStatus: gates?.probes?.snapshot2330?.status ?? null,
        observedAt: gates?.observedAt ?? null,
    };
}

export async function noCurrentSessionData(config, tradeDate) {
    const output = config.outputPath;
    if (!path.isAbsolute(output ?? '') || await stat(output).then(() => true).catch(() => false)) {
        return false;
    }
    const productPath = config.productStatePath;
    if (!path.isAbsolute(productPath ?? '')) return false;
    let product;
    try { product = JSON.parse(await readFile(productPath, 'utf8')); }
    catch (error) { if (error?.code !== 'ENOENT') return false; }
    if (product?.tradeDate === tradeDate &&
        (product.persistedObservationCount !== 0 || product.persistedTriggerCount !== 0 ||
            product.controlPlaneSubscriptionRequested === true ||
            !Array.isArray(product.items) || product.items.some((item) =>
                item.subscriptionState !== 'none' || item.firstEventAt !== null))) {
        return false;
    }
    const evidencePath = config.evidenceDatabasePath;
    if (!path.isAbsolute(evidencePath ?? '')) return false;
    if (!await stat(evidencePath).then((value) => value.isFile()).catch(() => false)) return true;
    let database = null;
    try {
        database = new DatabaseSync(evidencePath, { readOnly: true });
        const observations = database.prepare(
            'SELECT COUNT(*) AS count FROM intraday_monitor_observations WHERE trade_date = ?',
        ).get(tradeDate).count;
        const triggers = database.prepare(
            'SELECT COUNT(*) AS count FROM intraday_monitor_triggers WHERE trade_date = ?',
        ).get(tradeDate).count;
        return observations === 0 && triggers === 0;
    } catch { return false; }
    finally { database?.close(); }
}

function unstartedGenerationSession(session) {
    return ['waiting_baseline', 'starting'].includes(session?.phase) &&
        session.controlPlane?.requested === false && session.controlPlane?.accepted === false &&
        Array.isArray(session.itemStates) && session.itemStates.length === 160 &&
        session.itemStates.every((item) => item.subscriptionState === 'none' &&
            item.firstKbarAt === null &&
            ['waiting_baseline', 'awaiting_first_kbar'].includes(item.state));
}

export async function recoverMissingPremarketSession({ root, config, authority, step,
    now = new Date(), inspectGates = inspectPremarketGates,
    prepareDailySession = prepareIntradayMonitorPremarketDailySession,
    readNoCurrentData = noCurrentSessionData } = {}) {
    if (!['08:35', '08:45'].includes(step) || !authority?.current ||
        authority.isTradingDate !== true || !authority.previousTradeDate) {
        return Object.freeze({ recovered: false, reason: 'rollover_recovery_not_authorized' });
    }
    const paths = resolvePremarketOrchestratorPaths(root);
    const originalPath = path.join(paths.receiptsDirectory, `${authority.tradeDate}-0820.json`);
    const originalText = await readFile(originalPath, 'utf8').catch(() => null);
    let original = null;
    try { original = originalText && JSON.parse(originalText); } catch {}
    if (original?.localDate !== authority.tradeDate || original.step !== '08:20' ||
        original.rolloverOutcome !== 'failed' ||
        original.reason !== 'calendar_authority_unavailable' || original.sessionId !== null ||
        await stat(path.join(paths.claimsDirectory, `${authority.tradeDate}-0820.json`))
            .then(() => true).catch(() => false) ||
        new IntradayMonitorSessionStateRepository(root).readSession(authority.tradeDate) ||
        !await readNoCurrentData(config, authority.tradeDate)) {
        return Object.freeze({ recovered: false, reason: 'rollover_recovery_not_authorized' });
    }
    const gates = await inspectGates(config, root);
    if (!gates.ready || !simulationApiWarmupReady(gates)) {
        return Object.freeze({ recovered: false, reason: 'rollover_recovery_gate_failed' });
    }
    const originalReceiptSha256 = `sha256:${createHash('sha256').update(originalText).digest('hex')}`;
    const anchor = { generation: gates.generation, anchoredAt: new Date().toISOString(),
        tradeDate: authority.tradeDate, rolloverRecoveryStep: step, originalReceiptSha256 };
    const temporary = `${paths.generationAnchorPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(anchor)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, paths.generationAnchorPath);
    const prepared = await prepareDailySession({ appSupportRoot: root, config, authority,
        connectionGeneration: gates.generation, now,
        schedulerReceipt: { step, recoveryOf: '08:20', originalReceiptSha256,
            scheduledSuccess: false, authority, gateObservedAt: gates.observedAt } });
    if (!prepared.baselineCurrent || prepared.session?.phase !== 'starting') {
        throw new Error('rollover_recovery_baseline_invalid');
    }
    return Object.freeze({ recovered: true, originalReceiptSha256,
        sessionId: prepared.session.sessionId, scheduled0820Success: false });
}

export async function recoverUnstartedPremarketGeneration({ root, config, authority,
    step, gates, daily, now = new Date(), readNoCurrentData = noCurrentSessionData } = {}) {
    if (!['08:35', '08:45'].includes(step) || !daily?.session ||
        !authority?.current || authority.tradeDate !== daily.session.tradeDate ||
        authority.previousTradeDate !== daily.session.previousTradeDate ||
        daily.session.configRevision !== daily.savedConfig?.revision ||
        !unstartedGenerationSession(daily.session) ||
        gates?.checks?.generationStable !== false ||
        Object.entries(gates.checks).some(([key, value]) => key !== 'generationStable' && value !== true) ||
        !await readNoCurrentData(config, authority.tradeDate)) {
        return Object.freeze({ recovered: false, reason: 'generation_recovery_not_authorized' });
    }
    const paths = resolvePremarketOrchestratorPaths(root);
    const writeAnchor = async (transitionId) => {
        const nextAnchor = { generation: gates.generation, anchoredAt: now.toISOString(),
            tradeDate: authority.tradeDate, recoveryTransitionId: transitionId };
        const temporary = `${paths.generationAnchorPath}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(nextAnchor)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, paths.generationAnchorPath);
    };
    if (daily.ready && daily.session.connectionGeneration === gates.generation &&
        gates.generationAnchor?.generation !== gates.generation) {
        const currentSession = new IntradayMonitorSessionStateRepository(root)
            .readSession(authority.tradeDate);
        if (!currentSession || currentSession.sessionIdentityHash !== daily.session.sessionIdentityHash ||
            !unstartedGenerationSession(currentSession)) {
            return Object.freeze({ recovered: false, reason: 'generation_recovery_data_activity_present' });
        }
        const transitionId = daily.session.generationRecoveryIds?.at(-1);
        const transitionPath = transitionId ? path.join(
            new IntradayMonitorSessionStateRepository(root).paths.generationTransitionsDirectory,
            authority.tradeDate, `${transitionId}.json`) : null;
        const transition = transitionPath ? await readFile(transitionPath, 'utf8')
            .then(JSON.parse).catch(() => null) : null;
        if (transition?.transitionId !== transitionId ||
            transition.sessionId !== daily.session.sessionId ||
            transition.newGeneration !== gates.generation ||
            transition.nextSessionIdentityHash !== daily.session.sessionIdentityHash ||
            transition.previousGeneration !== gates.generationAnchor?.generation) {
            return Object.freeze({ recovered: false, reason: 'generation_recovery_receipt_invalid' });
        }
        await writeAnchor(transitionId);
        return Object.freeze({ recovered: true, anchorFinalized: true, transitionId,
            sessionIdentityHash: daily.session.sessionIdentityHash });
    }
    if (
        daily?.reasons?.length !== 1 || daily.reasons[0] !== 'generation_mismatch' ||
        gates?.generation === daily.session.connectionGeneration ||
        gates?.generationAnchor?.generation !== daily.session.connectionGeneration) {
        return Object.freeze({ recovered: false, reason: 'generation_recovery_not_authorized' });
    }
    const repository = new IntradayMonitorSessionStateRepository(root);
    const evidence = {
        apiSimulation: gates.checks.simulation,
        businessSession: gates.checks.businessSession,
        snapshot2330: gates.checks.snapshot2330,
        calendarVerified: authority.current && authority.isTradingDate === true,
        artifactVerified: gates.checks.artifacts && gates.checks.exactCohort && gates.checks.baseline,
        configRevisionVerified: daily.session.configRevision === daily.savedConfig?.revision,
        noCurrentResults: true,
        priorAnchorGeneration: gates.generationAnchor.generation,
        recoveryStep: step,
    };
    const recovered = repository.rebindUnstartedSessionGeneration({
        tradeDate: authority.tradeDate,
        expectedSessionIdentityHash: daily.session.sessionIdentityHash,
        newGeneration: gates.generation, schedulerStep: step,
        observedAt: now.toISOString(), evidence,
    });
    await writeAnchor(recovered.transition.transitionId);
    return Object.freeze({ recovered: true, transitionId: recovered.transition.transitionId,
        sessionIdentityHash: recovered.session.sessionIdentityHash });
}

export function runChild(command, args, options = {}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { ...options,
            stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'] });
        const output = { stdout: createHash('sha256'), stderr: createHash('sha256'),
            stdoutBytes: 0, stderrBytes: 0 };
        child.stdout?.on('data', (chunk) => { output.stdout.update(chunk); output.stdoutBytes += chunk.length; });
        child.stderr?.on('data', (chunk) => { output.stderr.update(chunk); output.stderrBytes += chunk.length; });
        const summary = () => ({ stdoutHash: `sha256:${output.stdout.digest('hex')}`,
            stderrHash: `sha256:${output.stderr.digest('hex')}`,
            stdoutBytes: output.stdoutBytes, stderrBytes: output.stderrBytes, rawOutputSaved: false });
        let settled = false;
        const finish = (value) => { if (!settled) { settled = true; resolve({ ...value, ...summary() }); } };
        child.once('error', (error) => finish({ exitCode: null, error: error.message }));
        child.once('exit', (code, signal) => finish({ exitCode: code, signal }));
    });
}

export async function ensurePremarketSimulationWarmup({ config, root = appSupportRoot(),
    repoDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
    paths = resolvePremarketOrchestratorPaths(root), inspectGates = inspectPremarketGates,
    runRuntime = runChild, appendEvent = appendIntradayMonitorOperationalEvent } = {}) {
    if (!config || typeof inspectGates !== 'function' || typeof runRuntime !== 'function' ||
        typeof appendEvent !== 'function') throw new TypeError('premarket warmup input is invalid');
    let gates = await inspectGates(config, root);
    let serviceLifecycleMutations = 0;
    if (!simulationApiWarmupReady(gates)) {
        await appendEvent(paths.logPath, {
            event: 'premarket_0820_api_repair_requested', component: 'service', severity: 'incident',
            alertEligible: true, tradeDate: config.tradeDate, details: warmupGateEvidence(gates),
        });
        const runtime = config.runtimePath ?? path.join(repoDirectory, 'scripts', 'realtimestock-runtime');
        const switched = await runRuntime(runtime, ['simulation'], { cwd: repoDirectory });
        serviceLifecycleMutations = 1;
        if (switched.exitCode !== 0) {
            await appendEvent(paths.logPath, {
                event: 'premarket_0820_api_repair_failed', component: 'service', severity: 'incident',
                alertEligible: true, tradeDate: config.tradeDate,
                details: { ...warmupGateEvidence(gates), runtime: switched },
            });
            throw new Error('simulation_service_start_failed');
        }
        gates = await inspectGates(config, root);
    }
    if (!simulationApiWarmupReady(gates)) {
        await appendEvent(paths.logPath, {
            event: 'premarket_0820_api_warmup_failed', component: 'service', severity: 'incident',
            alertEligible: true, tradeDate: config.tradeDate, details: warmupGateEvidence(gates),
        });
        throw new Error('premarket_0820_api_warmup_failed');
    }
    await mkdir(path.dirname(paths.generationAnchorPath), { recursive: true, mode: 0o700 });
    await writeFile(paths.generationAnchorPath, `${JSON.stringify({ generation: gates.generation,
        anchoredAt: new Date().toISOString(), tradeDate: config.tradeDate })}\n`, { mode: 0o600 });
    return { gates, serviceLifecycleMutations };
}

export function buildPremarketCaptureArgs({ resolved, effectiveConfig, authority,
    paths, approvedActiveLimit, root } = {}) {
    return ['--execute', `--manifest=${resolved.manifestPath}`,
        `--plan=${resolved.planPath}`, `--baseline=${resolved.baselinePath}`,
        `--prerequisite=${resolved.prerequisitePath}`,
        `--trade-date=${authority.tradeDate}`, '--mode=full-session',
        `--output=${effectiveConfig.outputPath}`,
        `--registry-directory=${effectiveConfig.registryDirectory}`,
        `--generation-file=${effectiveConfig.generationPath}`,
        `--generation-anchor=${paths.generationAnchorPath}`,
        '--product-mode', `--app-support-root=${root}`,
        `--config-database=${effectiveConfig.configDatabasePath}`,
        `--evidence-database=${effectiveConfig.evidenceDatabasePath}`,
        `--product-state=${effectiveConfig.productStatePath}`,
        `--chart-evidence=${effectiveConfig.chartEvidencePath}`,
        `--event-log=${paths.logPath}`,
        `--approved-active-limit=${approvedActiveLimit}`];
}

export async function runPremarketStep({ step, dryRun = false, now = new Date(),
    root = appSupportRoot(), repoDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
    resolveTradingDay = resolveIntradayMonitorPremarketTradingDay,
    inspectGates = inspectPremarketGates,
    warmup = ensurePremarketSimulationWarmup,
    prepareDailySession = prepareIntradayMonitorPremarketDailySession,
    inspectDailySession = inspectIntradayMonitorPremarketDailySession,
    recoverMissingSession = recoverMissingPremarketSession,
    runCapture = runChild } = {}) {
    if (!STEPS.has(step) || !(now instanceof Date) || !Number.isFinite(now.valueOf())) {
        throw new TypeError('premarket step input is invalid');
    }
    if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Asia/Taipei') {
        throw new Error('system_time_zone_is_not_asia_taipei');
    }
    const paths = resolvePremarketOrchestratorPaths(root);
    const config = JSON.parse(await readFile(paths.configPath, 'utf8'));
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const actualStartedAt = now.toISOString();
    const authority = await resolveTradingDay({ now, root });
    if (!authority?.current || authority.tradeDate !== localDate) {
        const result = { executed: false, reason: 'calendar_authority_unavailable', step, localDate,
            authority };
        if (!dryRun) await persistPremarketRunReceipt(paths, {
            schemaVersion: PREMARKET_ORCHESTRATOR_SCHEMA, localDate, step,
            computedFireAt: `${localDate}T${step}:00+08:00`, actualStartedAt,
            sessionId: null, stepClaim: null, rolloverOutcome: 'failed', reason: result.reason,
            authority, brokerWriteAuthority: false,
        });
        await appendIntradayMonitorOperationalEvent(paths.logPath, {
            at: now.toISOString(), event: 'scheduler_calendar_authority_unavailable', component: 'scheduler',
            severity: 'incident', alertEligible: true,
            tradeDate: localDate, details: result,
        });
        return result;
    }
    if (authority.isTradingDate !== true) {
        const result = { executed: false, reason: 'official_non_trading_date', step, localDate,
            authority };
        if (!dryRun) await persistPremarketRunReceipt(paths, {
            schemaVersion: PREMARKET_ORCHESTRATOR_SCHEMA, localDate, step,
            computedFireAt: `${localDate}T${step}:00+08:00`, actualStartedAt,
            sessionId: null, stepClaim: null, rolloverOutcome: 'non_trading_noop',
            reason: result.reason, authority, brokerWriteAuthority: false,
        });
        await appendIntradayMonitorOperationalEvent(paths.logPath, {
            at: now.toISOString(), event: 'scheduler_nontrading_noop', component: 'scheduler',
            tradeDate: localDate, details: result,
        });
        return result;
    }
    const effectiveConfig = { ...config, tradeDate: authority.tradeDate,
        baselinePath: resolveIntradayMonitorDailyBaselinePath(root, authority),
        outputPath: path.join(root, 'direct-160-live', `capture-${authority.tradeDate}.json`),
        chartEvidencePath: path.join(root, 'direct-160-live',
            `passive-chart-freshness-${authority.tradeDate}.json`),
        officialTradingDates: [authority.tradeDate] };
    const schedulerId = PREMARKET_ORCHESTRATOR_LABEL;
    const claim = dryRun ? null : await claimPremarketStep(paths, authority.tradeDate, step, schedulerId);
    const receipt = createPremarketScheduleReceipt({ requestedTradeDate: authority.tradeDate,
        requestedLocalTime: step, schedulerId, computedFireAt: `${authority.tradeDate}T${step}:00+08:00`,
        readBackAt: now.toISOString(), officialTradingDates: [authority.tradeDate],
        runClaim: claim });
    if (receipt.consistency.status !== 'ready') throw new Error(receipt.consistency.reasons.join(','));
    if (dryRun) return { executed: false, reason: 'dry_run', step, receipt, authority };
    const startedAt = new Date().toISOString();
    let outcome;
    let daily = null;
    try {
        if (step === '08:20') {
            const warmed = await warmup({ config: effectiveConfig, root, repoDirectory, paths,
                inspectGates });
            daily = await prepareDailySession({ appSupportRoot: root, config: effectiveConfig,
                authority, connectionGeneration: warmed.gates.generation,
                schedulerReceipt: receipt, now });
            outcome = { ...warmed, dailySession: daily.session,
                rolloverOutcome: daily.baselineCurrent ? 'session_created' : 'waiting_baseline' };
        } else if (step === '08:35' || step === '08:45') {
            let gates = await inspectGates(effectiveConfig, root, { requireStableGeneration: true });
            daily = await inspectDailySession({ appSupportRoot: root, config: effectiveConfig,
                authority, connectionGeneration: gates.generation, now });
            let rolloverRecovery = null;
            if (!daily.session && daily.reason === 'current_session_missing') {
                rolloverRecovery = await recoverMissingSession({ root, config: effectiveConfig,
                    authority, step, now, inspectGates, prepareDailySession });
                if (rolloverRecovery.recovered) {
                    gates = await inspectGates(effectiveConfig, root,
                        { requireStableGeneration: true });
                    daily = await inspectDailySession({ appSupportRoot: root,
                        config: effectiveConfig, authority,
                        connectionGeneration: gates.generation, now });
                }
            }
            let generationRecovery = null;
            if (gates.checks?.generationStable === false &&
                (!daily.ready && daily.reason === 'generation_mismatch' || daily.ready)) {
                generationRecovery = await recoverUnstartedPremarketGeneration({ root,
                    config: effectiveConfig, authority, step, gates, daily, now });
                if (generationRecovery.recovered) {
                    gates = await inspectGates(effectiveConfig, root, { requireStableGeneration: true });
                    daily = await inspectDailySession({ appSupportRoot: root,
                        config: effectiveConfig, authority,
                        connectionGeneration: gates.generation, now });
                }
            }
            outcome = { gates, dailySession: daily.session,
                generationRecovery, rolloverRecovery,
                rolloverOutcome: rolloverRecovery?.recovered
                    ? 'session_recovered_after_0820_failure' : 'step_complete',
                coldStartRisk: step === '08:45' && (!gates.ready || !daily.ready) };
            if (!daily.ready) throw new Error(daily.reason);
            if (gates.checks?.artifacts === true && gates.configuredCohort?.reason === 'checked' &&
                gates.checks?.configuredCohort === false) throw new Error('configured_cohort_mismatch');
            if (gates.checks?.productSink === false) {
                throw new Error(`product_sink_preflight_${gates.productSinkPreflight?.reason ?? 'invalid'}`);
            }
            if (!gates.ready) throw new Error(`premarket_${step.replace(':', '')}_gate_failed`);
        } else {
            const gates = await inspectGates(effectiveConfig, root, { requireStableGeneration: true });
            daily = await inspectDailySession({ appSupportRoot: root, config: effectiveConfig,
                authority, connectionGeneration: gates.generation, now });
            if (!daily.ready) throw new Error(daily.reason);
            if (gates.checks?.artifacts === true && gates.configuredCohort?.reason === 'checked' &&
                gates.checks?.configuredCohort === false) throw new Error('configured_cohort_mismatch');
            if (gates.checks?.productSink === false) {
                throw new Error(`product_sink_preflight_${gates.productSinkPreflight?.reason ?? 'invalid'}`);
            }
            if (!gates.ready) throw new Error('premarket_0850_gate_failed');
            const resolved = gates.artifacts.resolvedConfig ?? effectiveConfig;
            const approvedActiveLimit = daily.approval.approvedActiveLimit;
            await claimPremarketCaptureStart({ root, tradeDate: authority.tradeDate,
                source: 'scheduled_0850', sessionId: daily.session.sessionId,
                generation: gates.generation, now: new Date() });
            const captureArgs = buildPremarketCaptureArgs({ resolved, effectiveConfig,
                authority, paths, approvedActiveLimit, root });
            const capture = await runCapture(process.execPath,
                [path.join(repoDirectory, 'scripts/intraday-monitor-runtime/capture-direct-160-stage.mjs'), ...captureArgs],
                { cwd: repoDirectory });
            outcome = { gates, dailySession: daily.session, capture };
            if (capture.exitCode !== 0) throw new Error('direct_160_capture_failed');
        }
        const result = { schemaVersion: PREMARKET_ORCHESTRATOR_SCHEMA, executed: true, step,
            tradeDate: authority.tradeDate, startedAt, endedAt: new Date().toISOString(), claim, receipt,
            authority, outcome, brokerWriteAuthority: false };
        await persistPremarketRunReceipt(paths, {
            schemaVersion: PREMARKET_ORCHESTRATOR_SCHEMA, localDate, step,
            computedFireAt: receipt.scheduledForUtc, actualStartedAt: startedAt,
            actualEndedAt: result.endedAt, sessionId: daily?.session?.sessionId ?? null,
            stepClaim: claim.runId, rolloverOutcome: outcome.rolloverOutcome ?? 'step_complete',
            original0820ReceiptSha256: outcome.rolloverRecovery?.originalReceiptSha256 ?? null,
            reason: null, authority, brokerWriteAuthority: false,
        });
        await appendIntradayMonitorOperationalEvent(paths.logPath, {
            event: 'premarket_step_complete', component: 'scheduler', tradeDate: authority.tradeDate,
            severity: step === '08:50' ? 'milestone' : 'info',
            details: { step, startedAt, endedAt: result.endedAt, claim: claim.runId,
                sessionId: daily?.session?.sessionId ?? null,
                generation: outcome.gates?.generation ?? null,
                gatesReady: outcome.gates?.ready ?? null,
                captureExitCode: outcome.capture?.exitCode ?? null },
        });
        return result;
    } catch (error) {
        const reason = String(error?.message ?? 'premarket_step_failed').slice(0, 128);
        await persistPremarketRunReceipt(paths, {
            schemaVersion: PREMARKET_ORCHESTRATOR_SCHEMA, localDate, step,
            computedFireAt: receipt.scheduledForUtc, actualStartedAt: startedAt,
            actualEndedAt: new Date().toISOString(), sessionId: daily?.session?.sessionId ?? null,
            stepClaim: claim.runId, rolloverOutcome: 'failed', reason, authority,
            brokerWriteAuthority: false,
        });
        throw error;
    }
}

export function buildPremarketLaunchAgentPlist(scriptPath, logPath) {
    if (!path.isAbsolute(scriptPath ?? '') || !path.isAbsolute(logPath ?? '')) {
        throw new TypeError('launchagent paths must be absolute');
    }
    const intervals = [...STEPS].map((step) => {
        const [hour, minute] = step.split(':').map(Number);
        return `<dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`;
    }).join('');
    void logPath;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${PREMARKET_ORCHESTRATOR_LABEL}</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${scriptPath}</string><string>--scheduled</string></array><key>StartCalendarInterval</key><array>${intervals}</array><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
}

export async function installPremarketLaunchAgent({ root = appSupportRoot(),
    scriptPath = new URL(import.meta.url).pathname } = {}) {
    const paths = resolvePremarketOrchestratorPaths(root);
    await mkdir(path.dirname(paths.plistPath), { recursive: true });
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    await writeFile(paths.plistPath, buildPremarketLaunchAgentPlist(scriptPath, paths.logPath), { mode: 0o600 });
    const uid = process.getuid();
    await runChild('/bin/launchctl', ['bootout', `gui/${uid}/${PREMARKET_ORCHESTRATOR_LABEL}`],
        { stdio: 'ignore' });
    const loaded = await runChild('/bin/launchctl', ['bootstrap', `gui/${uid}`, paths.plistPath],
        { stdio: 'ignore' });
    if (loaded.exitCode !== 0) throw new Error('premarket_launchagent_bootstrap_failed');
    return { installed: true, label: PREMARKET_ORCHESTRATOR_LABEL, plistPath: paths.plistPath };
}

let activeScheduledStep = null;

async function main() {
    const paths = resolvePremarketOrchestratorPaths();
    if (process.argv.includes('--install')) return console.log(JSON.stringify(await installPremarketLaunchAgent()));
    if (process.argv.includes('--remove')) {
        await runChild('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${PREMARKET_ORCHESTRATOR_LABEL}`],
            { stdio: 'ignore' });
        await unlink(paths.plistPath).catch(() => {});
        return console.log(JSON.stringify({ removed: true, label: PREMARKET_ORCHESTRATOR_LABEL }));
    }
    if (process.argv.includes('--status')) {
        const result = await runChild('/bin/launchctl', ['print',
            `gui/${process.getuid()}/${PREMARKET_ORCHESTRATOR_LABEL}`], { stdio: 'ignore' });
        return console.log(JSON.stringify({ loaded: result.exitCode === 0, ...paths }));
    }
    let step = process.argv.find((value) => value.startsWith('--step='))?.slice(7);
    if (process.argv.includes('--scheduled')) {
        const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit',
            minute: '2-digit', hourCycle: 'h23' }).format(new Date());
        step = [...STEPS].find((candidate) => Math.abs(minuteNumber(candidate) - minuteNumber(local)) <= 2);
        activeScheduledStep = step ?? null;
    }
    const result = await runPremarketStep({ step,
        dryRun: process.argv.includes('--dry-run') });
    if (process.argv.includes('--scheduled') && result?.reason === 'calendar_authority_unavailable') {
        await recordIntradayMonitorLocalIncident({ root: appSupportRoot(),
            tradeDate: result.localDate, step, kind: 'premarket_step_failed' }).catch(() => {});
    }
    console.log(JSON.stringify(result, null, 2));
}

function minuteNumber(value) {
    if (!/^\d{2}:\d{2}$/.test(value ?? '')) return Number.NaN;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch(async (error) => {
        const paths = resolvePremarketOrchestratorPaths();
        await appendIntradayMonitorOperationalEvent(paths.logPath, {
            event: 'premarket_failure', component: 'scheduler', severity: 'incident',
            alertEligible: true,
            details: { error: String(error?.message ?? 'premarket_failed').slice(0, 256) },
        }).catch(() => {});
        const step = activeScheduledStep;
        if (process.argv.includes('--scheduled') && step) {
            const tradeDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
                year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            await recordIntradayMonitorLocalIncident({ root: appSupportRoot(), tradeDate, step,
                kind: error?.message === 'direct_160_capture_failed'
                    ? 'direct_160_capture_failed' : 'premarket_step_failed' }).catch(() => {});
        }
        process.stderr.write(`${error.message}\n`); process.exitCode = 1;
    });
}
