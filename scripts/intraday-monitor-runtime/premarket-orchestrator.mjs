import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createPremarketScheduleReceipt } from './premarket-schedule.mjs';
import { appendIntradayMonitorOperationalEvent } from './operational-event-log.mjs';
import { readDirect160ProductRuntimeState } from './direct-160-product-runtime.mjs';

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

async function inspectArtifactSet(config) {
    const keys = ['manifestPath', 'planPath', 'baselinePath', 'prerequisitePath', 'configDatabasePath'];
    const files = await Promise.all(keys.map(async (key) => ({ key, path: config[key], exists: Boolean(config[key]) &&
        await stat(config[key]).then((value) => value.isFile()).catch(() => false) })));
    if (!files.every((file) => file.exists)) return { ready: false, files, exactCohort: false, baseline: false };
    try {
        const [manifest, plan, baseline, prerequisite] = await Promise.all(
            ['manifestPath', 'planPath', 'baselinePath', 'prerequisitePath']
                .map((key) => readFile(config[key], 'utf8').then(JSON.parse)));
        const symbols = manifest.cohort?.map((item) => item.canonicalSymbol) ?? [];
        return { ready: manifest.stage === 160 && symbols.length === 160 && new Set(symbols).size === 160 &&
                plan.stage === 160 && plan.manifestHash === manifest.manifestHash &&
                baseline.manifestHash === manifest.manifestHash && baseline.calendar?.targetTradeDate === config.tradeDate &&
                baseline.manifests?.length === 160 && prerequisite.assessment?.liveStage160Eligible === true &&
                prerequisite.review?.decision === 'GO',
            files, exactCohort: symbols.length === 160 && new Set(symbols).size === 160,
            baseline: baseline.manifests?.length === 160 && baseline.calendar?.targetTradeDate === config.tradeDate,
            manifestHash: manifest.manifestHash, baselineHash: baseline.baselineHash };
    } catch { return { ready: false, files, exactCohort: false, baseline: false }; }
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
        inspectArtifactSet(config),
        statfs(root).then((value) => value.bavail * value.bsize).catch(() => null),
        readFile(paths.generationAnchorPath, 'utf8').then(JSON.parse).catch(() => null),
    ]);
    const checks = { simulation: info.ok && info.body?.simulation === true && mode === 'simulation',
        apiGeneration: typeof generation === 'string' && /^simulation:[A-Za-z0-9_-]{16,100}$/.test(generation),
        businessSession: health.ok && health.body?.status === 'healthy',
        snapshot2330: snapshot.ok && Array.isArray(snapshot.body) && snapshot.body.length === 1,
        web: web.ok, multiView: multiView.ok && multiView.body?.ok === true,
        artifacts: artifacts.ready, exactCohort: artifacts.exactCohort, baseline: artifacts.baseline,
        disk: Number.isSafeInteger(disk) && disk >= (config.minimumAvailableDiskBytes ?? 8 * 1024 ** 3),
        generationStable: !requireStableGeneration || anchor?.generation === generation,
        brokerWriteBlockade: true };
    return Object.freeze({ ready: Object.values(checks).every(Boolean), checks, probes: { info, health,
        snapshot2330: snapshot, web, multiView }, mode, generation, artifacts,
        availableDiskBytes: disk, generationAnchor: anchor,
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

function runChild(command, args, options = {}) {
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

export async function runPremarketStep({ step, dryRun = false, now = new Date(),
    root = appSupportRoot(), repoDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..') } = {}) {
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
    if (localDate !== config.tradeDate || !config.officialTradingDates.includes(localDate)) {
        const result = { executed: false, reason: 'not_configured_trading_date', step, localDate };
        await appendIntradayMonitorOperationalEvent(paths.logPath, {
            at: now.toISOString(), event: 'scheduler_nontrading_noop', component: 'scheduler',
            tradeDate: localDate, details: result,
        });
        return result;
    }
    const schedulerId = PREMARKET_ORCHESTRATOR_LABEL;
    const claim = dryRun ? null : await claimPremarketStep(paths, config.tradeDate, step, schedulerId);
    const receipt = createPremarketScheduleReceipt({ requestedTradeDate: config.tradeDate,
        requestedLocalTime: step, schedulerId, computedFireAt: `${config.tradeDate}T${step}:00+08:00`,
        readBackAt: now.toISOString(), officialTradingDates: config.officialTradingDates,
        runClaim: claim });
    if (receipt.consistency.status !== 'ready') throw new Error(receipt.consistency.reasons.join(','));
    if (dryRun) return { executed: false, reason: 'dry_run', step, receipt };
    const startedAt = new Date().toISOString();
    let outcome;
    if (step === '08:20') {
        outcome = await ensurePremarketSimulationWarmup({ config, root, repoDirectory, paths });
    } else if (step === '08:35' || step === '08:45') {
        const gates = await inspectPremarketGates(config, root, { requireStableGeneration: true });
        outcome = { gates, coldStartRisk: step === '08:45' && !gates.ready };
        if (!gates.ready) throw new Error(`premarket_${step.replace(':', '')}_gate_failed`);
    } else {
        const gates = await inspectPremarketGates(config, root, { requireStableGeneration: true });
        if (!gates.ready) throw new Error('premarket_0850_gate_failed');
        const approvedActiveLimit = resolvePremarketApprovedActiveLimit(config, gates.artifacts.manifestHash);
        const captureArgs = ['--execute', `--manifest=${config.manifestPath}`, `--plan=${config.planPath}`,
            `--baseline=${config.baselinePath}`, `--prerequisite=${config.prerequisitePath}`,
            `--trade-date=${config.tradeDate}`, '--mode=full-session', `--output=${config.outputPath}`,
            `--registry-directory=${config.registryDirectory}`, `--generation-file=${config.generationPath}`,
            `--generation-anchor=${paths.generationAnchorPath}`,
            '--product-mode', `--config-database=${config.configDatabasePath}`,
            `--evidence-database=${config.evidenceDatabasePath}`, `--product-state=${config.productStatePath}`,
            `--chart-evidence=${config.chartEvidencePath}`, `--event-log=${paths.logPath}`,
            `--approved-active-limit=${approvedActiveLimit}`];
        const capture = await runChild(process.execPath,
            [path.join(repoDirectory, 'scripts/intraday-monitor-runtime/capture-direct-160-stage.mjs'), ...captureArgs],
            { cwd: repoDirectory });
        outcome = { gates, capture };
        if (capture.exitCode !== 0) throw new Error('direct_160_capture_failed');
    }
    const result = { schemaVersion: PREMARKET_ORCHESTRATOR_SCHEMA, executed: true, step,
        tradeDate: config.tradeDate, startedAt, endedAt: new Date().toISOString(), claim, receipt,
        outcome, brokerWriteAuthority: false };
    await appendIntradayMonitorOperationalEvent(paths.logPath, {
        event: 'premarket_step_complete', component: 'scheduler', tradeDate: config.tradeDate,
        severity: step === '08:50' ? 'milestone' : 'info',
        details: { step, startedAt, endedAt: result.endedAt, claim: claim.runId,
            generation: outcome.gates?.generation ?? null,
            gatesReady: outcome.gates?.ready ?? null,
            captureExitCode: outcome.capture?.exitCode ?? null },
    });
    return result;
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
    }
    console.log(JSON.stringify(await runPremarketStep({ step,
        dryRun: process.argv.includes('--dry-run') }), null, 2));
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
        process.stderr.write(`${error.message}\n`); process.exitCode = 1;
    });
}
