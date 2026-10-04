import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { decideLateBootPremarketCatchup, taipeiPremarketInstant } from './late-boot-policy.mjs';
import { appendIntradayMonitorOperationalEvent } from './operational-event-log.mjs';
import { claimPremarketCaptureStart, readPremarketCaptureStartClaim } from './premarket-capture-start-claim.mjs';
import { inspectIntradayMonitorPremarketDailySession,
    prepareIntradayMonitorPremarketDailySession,
    resolveIntradayMonitorDailyBaselinePath } from './premarket-daily-session.mjs';
import { buildPremarketCaptureArgs, inspectPremarketGates, noCurrentSessionData,
    resolvePremarketOrchestratorPaths, runChild } from './premarket-orchestrator.mjs';
import { resolveIntradayMonitorPremarketTradingDay } from './trading-calendar-authority.mjs';

export const LATE_BOOT_CATCHUP_SCHEMA = 'intraday-monitor-late-boot-catchup/1';
export const LATE_BOOT_LAUNCH_AGENT_LABEL =
    'com.alanyi.realtimestock.intraday-premarket-late-boot';
const SLEEP_MS = 5_000;
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const defaultRoot = () => process.env.REALTIME_STOCK_APP_SUPPORT ??
    path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock');
const exists = async (file) => stat(file).then(() => true).catch(() => false);
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const readJsonOrNull = async (file) => readJson(file).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
});
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function createExclusiveJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    return file;
}

function latePaths(root, tradeDate) {
    const base = resolvePremarketOrchestratorPaths(root);
    return { ...base,
        claimPath: path.join(base.claimsDirectory, `${tradeDate}-late-boot.json`),
        preparedPath: path.join(base.receiptsDirectory, `${tradeDate}-late-boot-prepared.json`),
        resultDirectory: path.join(base.receiptsDirectory, `${tradeDate}-late-boot-results`) };
}

function effectiveConfigForDay(config, root, authority) {
    return { ...config, tradeDate: authority.tradeDate,
        baselinePath: resolveIntradayMonitorDailyBaselinePath(root, authority),
        outputPath: path.join(root, 'direct-160-live', `capture-${authority.tradeDate}.json`),
        chartEvidencePath: path.join(root, 'direct-160-live',
            `passive-chart-freshness-${authority.tradeDate}.json`),
        officialTradingDates: [authority.tradeDate] };
}

function runtimeOnlyNotReady(gates) {
    if (!gates?.checks) return false;
    const runtimeKeys = new Set(['simulation', 'apiGeneration', 'businessSession',
        'snapshot2330', 'web', 'multiView']);
    return Object.entries(gates.checks).every(([key, value]) =>
        value === true || runtimeKeys.has(key));
}

async function appendLateResult(paths, value) {
    await mkdir(paths.resultDirectory, { recursive: true, mode: 0o700 });
    return createExclusiveJson(path.join(paths.resultDirectory,
        `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`), value);
}

export async function runLateBootPremarketCatchup({ root = defaultRoot(),
    repoDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
    clock = () => new Date(), resolveTradingDay = resolveIntradayMonitorPremarketTradingDay,
    inspectGates = inspectPremarketGates, inspectDailySession = inspectIntradayMonitorPremarketDailySession,
    prepareDailySession = prepareIntradayMonitorPremarketDailySession,
    readNoCurrentData = noCurrentSessionData, runCapture = runChild,
    sleep = wait } = {}) {
    const enteredAt = clock();
    const entered = taipeiPremarketInstant(enteredAt);
    const paths = latePaths(root, entered.localDate);
    if (entered.seconds < 8 * 3_600 + 20 * 60 || entered.seconds >= 8 * 3_600 + 59 * 60) {
        const reason = entered.seconds < 8 * 3_600 + 20 * 60
            ? 'before_premarket_window' : 'late_boot_deadline_passed';
        await appendLateResult(paths, { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
            tradeDate: entered.localDate, enteredAt: enteredAt.toISOString(),
            outcome: 'no_op', reason, brokerWriteAuthority: false });
        return { executed: false, reason, ...entered };
    }
    let config;
    try { config = await readJson(paths.configPath); }
    catch {
        await appendLateResult(paths, { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
            tradeDate: entered.localDate, enteredAt: enteredAt.toISOString(),
            outcome: 'failed', reason: 'premarket_config_unavailable',
            brokerWriteAuthority: false });
        return { executed: false, reason: 'premarket_config_unavailable' };
    }
    let lastReason = 'runtime_not_ready';
    let lastGateEvidence = null;
    while (taipeiPremarketInstant(clock()).seconds < 8 * 3_600 + 59 * 60) {
        const now = clock();
        if (taipeiPremarketInstant(now).seconds < 8 * 3_600 + 22 * 60) {
            await sleep(SLEEP_MS);
            continue;
        }
        const authority = await resolveTradingDay({ now, root }).catch(() => null);
        const effectiveConfig = authority?.current && authority.previousTradeDate
            ? effectiveConfigForDay(config, root, authority) : null;
        const [scheduled0820, scheduled0850, captureClaim] = await Promise.all([
            readJsonOrNull(path.join(paths.receiptsDirectory, `${entered.localDate}-0820.json`)),
            readJsonOrNull(path.join(paths.receiptsDirectory, `${entered.localDate}-0850.json`)),
            readPremarketCaptureStartClaim(root, entered.localDate),
        ]);
        const baselineCurrent = Boolean(effectiveConfig &&
            await exists(effectiveConfig.baselinePath));
        const decision = decideLateBootPremarketCatchup({ now, authority, baselineCurrent,
            scheduled0820, scheduled0850, captureStarted: Boolean(captureClaim) });
        if (!decision.eligible) {
            await appendLateResult(paths, { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
                tradeDate: entered.localDate, enteredAt: enteredAt.toISOString(),
                outcome: ['before_premarket_window', 'official_non_trading_date',
                    'capture_already_started'].includes(decision.reason) ? 'no_op' : 'failed',
                reason: decision.reason, authority,
                brokerWriteAuthority: false });
            return { executed: false, reason: decision.reason, ...decision };
        }
        if (await exists(path.join(paths.claimsDirectory, `${entered.localDate}-0820.json`)) &&
            scheduled0820 === null) {
            lastReason = 'scheduled_0820_in_progress';
            await sleep(SLEEP_MS);
            continue;
        }
        if (decision.nextAction === 'prepare_and_capture' &&
            await exists(path.join(paths.claimsDirectory, `${entered.localDate}-0850.json`)) &&
            scheduled0850 === null) {
            lastReason = 'scheduled_0850_in_progress';
            await sleep(SLEEP_MS);
            continue;
        }
        const gates = await inspectGates(effectiveConfig, root);
        lastGateEvidence = gates.checks ?? null;
        if (!gates.ready) {
            lastReason = gates.mode && gates.mode !== 'simulation' ? 'simulation_mode_required' :
                gates.checks?.baseline === false ? 'baseline_missing' :
                'late_boot_gate_not_ready';
            if (lastReason === 'simulation_mode_required') break;
            if (runtimeOnlyNotReady(gates)) { await sleep(SLEEP_MS); continue; }
            break;
        }
        if (taipeiPremarketInstant(clock()).seconds >= 8 * 3_600 + 59 * 60) {
            lastReason = 'late_boot_deadline_passed'; break;
        }
        let daily = await inspectDailySession({ appSupportRoot: root, config: effectiveConfig,
            authority, connectionGeneration: gates.generation, now });
        if (daily.session && !daily.ready) { lastReason = daily.reason; break; }
        if (!daily.session && daily.reason !== 'current_session_missing') {
            lastReason = daily.reason; break;
        }
        if (!await readNoCurrentData(effectiveConfig, entered.localDate)) {
            lastReason = 'today_data_activity_present'; break;
        }
        if (daily.session && decision.nextAction === 'prepare_session') {
            await appendLateResult(paths, { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
                tradeDate: entered.localDate, enteredAt: enteredAt.toISOString(),
                outcome: 'no_op', reason: 'current_session_already_prepared',
                sessionId: daily.session.sessionId, brokerWriteAuthority: false });
            return { executed: false, reason: 'current_session_already_prepared',
                tradeDate: entered.localDate, sessionId: daily.session.sessionId };
        }
        const lateBootId = `late-boot-${entered.localDate}-${randomUUID()}`;
        const claim = { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA, lateBootId,
            tradeDate: entered.localDate, enteredAt: enteredAt.toISOString(),
            claimedAt: clock().toISOString(), source: 'startup_catchup',
            scheduled0820Present: decision.scheduled0820Present,
            scheduled0820Success: decision.scheduled0820Success,
            scheduled0850Present: decision.scheduled0850Present,
            brokerWriteAuthority: false, productionAuthority: false };
        try { await createExclusiveJson(paths.claimPath, claim); }
        catch (error) {
            if (error?.code === 'EEXIST') {
                await appendLateResult(paths, { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
                    tradeDate: entered.localDate, enteredAt: enteredAt.toISOString(),
                    outcome: 'no_op', reason: 'late_boot_already_claimed',
                    brokerWriteAuthority: false });
                return { executed: false, reason: 'late_boot_already_claimed' };
            }
            throw error;
        }
        try {
            let anchorAt = null;
            let previousAnchorSha256 = null;
            if (!daily.session) {
                const prepared = await prepareDailySession({ appSupportRoot: root,
                    config: effectiveConfig, authority,
                    connectionGeneration: gates.generation, now,
                    schedulerReceipt: { source: 'late_boot', lateBootId,
                        scheduled0820Success: false, authority, gateObservedAt: gates.observedAt } });
                if (!prepared.baselineCurrent || prepared.session?.phase !== 'starting') {
                    throw new Error('late_boot_baseline_invalid');
                }
                daily = await inspectDailySession({ appSupportRoot: root,
                    config: effectiveConfig, authority,
                    connectionGeneration: gates.generation, now });
                if (!daily.ready) throw new Error(daily.reason);
                anchorAt = clock().toISOString();
                const previousAnchor = await readFile(paths.generationAnchorPath, 'utf8').catch(() => null);
                previousAnchorSha256 = previousAnchor === null ? null : digest(previousAnchor);
            } else if (gates.generationAnchor?.generation !== gates.generation) {
                throw new Error('generation_mismatch');
            }
            const baseline = await readJson(effectiveConfig.baselinePath);
            const preparedReceipt = { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
                lateBootId, tradeDate: entered.localDate, source: 'late_boot',
                enteredAt: enteredAt.toISOString(), preparedAt: clock().toISOString(),
                anchoredAt: anchorAt, sessionId: daily.session.sessionId,
                sessionIdentityHash: daily.session.sessionIdentityHash,
                generation: gates.generation, baselineHash: baseline.baselineHash,
                baselinePath: effectiveConfig.baselinePath, authority,
                scheduled0820Present: decision.scheduled0820Present,
                scheduled0820Success: decision.scheduled0820Success,
                scheduled0850Present: decision.scheduled0850Present,
                previousAnchorSha256, coldStartRisk: true,
                gates: gates.checks, brokerWriteAuthority: false,
                productionAuthority: false };
            await createExclusiveJson(paths.preparedPath, preparedReceipt);
            if (anchorAt) {
                const anchor = { generation: gates.generation, anchoredAt: anchorAt,
                    tradeDate: entered.localDate, lateBootId,
                    preparedReceiptSha256: digest(await readFile(paths.preparedPath, 'utf8')) };
                const temporary = `${paths.generationAnchorPath}.${process.pid}.${randomUUID()}.tmp`;
                await writeFile(temporary, `${JSON.stringify(anchor)}\n`, { mode: 0o600, flag: 'wx' });
                await rename(temporary, paths.generationAnchorPath);
            }
            if (decision.nextAction === 'prepare_session') {
                await appendLateResult(paths, { ...preparedReceipt, outcome: 'session_prepared',
                    completedAt: clock().toISOString() });
                return { executed: true, outcome: 'session_prepared',
                    tradeDate: entered.localDate, sessionId: daily.session.sessionId };
            }
            const refreshedAt = clock();
            if (taipeiPremarketInstant(refreshedAt).seconds >= 8 * 3_600 + 59 * 60) {
                throw new Error('late_boot_deadline_passed');
            }
            const refreshedGates = await inspectGates(effectiveConfig, root,
                { requireStableGeneration: true });
            const refreshedDaily = await inspectDailySession({ appSupportRoot: root,
                config: effectiveConfig, authority,
                connectionGeneration: refreshedGates.generation, now: refreshedAt });
            if (!refreshedGates.ready || !refreshedDaily.ready ||
                !await readNoCurrentData(effectiveConfig, entered.localDate)) {
                throw new Error('late_boot_capture_gate_failed');
            }
            if (taipeiPremarketInstant(clock()).seconds >= 8 * 3_600 + 59 * 60) {
                throw new Error('late_boot_deadline_passed');
            }
            await claimPremarketCaptureStart({ root, tradeDate: entered.localDate,
                source: 'late_boot', sessionId: daily.session.sessionId,
                generation: gates.generation, now: clock() });
            const captureArgs = buildPremarketCaptureArgs({
                resolved: refreshedGates.artifacts.resolvedConfig ?? effectiveConfig,
                effectiveConfig, authority, paths,
                approvedActiveLimit: refreshedDaily.approval.approvedActiveLimit, root });
            const capture = await runCapture(process.execPath,
                [path.join(repoDirectory, 'scripts/intraday-monitor-runtime/capture-direct-160-stage.mjs'),
                    ...captureArgs, '--late-boot-catchup'], { cwd: repoDirectory });
            const outcome = capture.exitCode === 0 ? 'capture_completed' : 'capture_failed';
            await appendLateResult(paths, { ...preparedReceipt, outcome,
                completedAt: clock().toISOString(), capture });
            await appendIntradayMonitorOperationalEvent(paths.logPath, {
                event: `premarket_late_boot_${outcome}`, component: 'scheduler',
                tradeDate: entered.localDate,
                severity: capture.exitCode === 0 ? 'milestone' : 'incident',
                details: { lateBootId, sessionId: daily.session.sessionId,
                    captureExitCode: capture.exitCode, coldStartRisk: true },
            });
            return { executed: true, outcome, tradeDate: entered.localDate,
                sessionId: daily.session.sessionId, captureExitCode: capture.exitCode };
        } catch (error) {
            lastReason = String(error?.message ?? error).slice(0, 128);
            await appendLateResult(paths, { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
                lateBootId, tradeDate: entered.localDate,
                outcome: 'failed', reason: lastReason,
                failedAt: clock().toISOString(), brokerWriteAuthority: false });
            return { executed: false, reason: lastReason, tradeDate: entered.localDate };
        }
    }
    const reason = taipeiPremarketInstant(clock()).seconds >= 8 * 3_600 + 59 * 60
        ? 'late_boot_deadline_passed' : lastReason;
    await appendLateResult(paths, { schemaVersion: LATE_BOOT_CATCHUP_SCHEMA,
        tradeDate: entered.localDate, enteredAt: enteredAt.toISOString(),
        outcome: 'failed', reason, gates: lastGateEvidence,
        failedAt: clock().toISOString(),
        brokerWriteAuthority: false });
    return { executed: false, reason, tradeDate: entered.localDate };
}

export function buildLateBootLaunchAgentPlist(scriptPath) {
    if (!path.isAbsolute(scriptPath ?? '')) throw new TypeError('absolute late boot script path required');
    const retries = [25, 40, 55, 58].map((minute) =>
        `<dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>${minute}</integer></dict>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LATE_BOOT_LAUNCH_AGENT_LABEL}</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${scriptPath}</string><string>--startup-catchup</string></array><key>RunAtLoad</key><true/><key>StartCalendarInterval</key><array>${retries}</array><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
}

export async function installLateBootLaunchAgent({ scriptPath = new URL(import.meta.url).pathname,
    runLaunchctl = runChild } = {}) {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents',
        `${LATE_BOOT_LAUNCH_AGENT_LABEL}.plist`);
    if (await exists(plistPath)) throw new Error('late_boot_launchagent_already_installed');
    await mkdir(path.dirname(plistPath), { recursive: true });
    const file = await open(plistPath, 'wx', 0o600);
    try { await file.writeFile(buildLateBootLaunchAgentPlist(scriptPath)); await file.sync(); }
    finally { await file.close(); }
    const loaded = await runLaunchctl('/bin/launchctl', ['bootstrap',
        `gui/${process.getuid()}`, plistPath], { stdio: 'ignore' });
    if (loaded.exitCode !== 0) throw new Error('late_boot_launchagent_bootstrap_failed');
    return { installed: true, plistPath, label: LATE_BOOT_LAUNCH_AGENT_LABEL };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    if (process.argv.includes('--startup-catchup')) {
        runLateBootPremarketCatchup().then((result) => console.log(JSON.stringify(result)))
            .catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1; });
    } else if (process.argv.includes('--install')) {
        installLateBootLaunchAgent().then((result) => console.log(JSON.stringify(result)))
            .catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1; });
    } else {
        throw new Error('use --startup-catchup or --install');
    }
}
