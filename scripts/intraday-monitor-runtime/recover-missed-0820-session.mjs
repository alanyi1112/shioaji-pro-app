import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectPremarketGates, resolvePremarketOrchestratorPaths } from './premarket-orchestrator.mjs';
import {
    prepareIntradayMonitorPremarketDailySession,
    resolveIntradayMonitorDailyBaselinePath,
} from './premarket-daily-session.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';
import { resolveIntradayMonitorPremarketTradingDay } from './trading-calendar-authority.mjs';

const root = process.env.REALTIME_STOCK_APP_SUPPORT ??
    path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock');
const paths = resolvePremarketOrchestratorPaths(root);
const now = new Date();
const tradeDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const exists = async (file) => stat(file).then(() => true).catch(() => false);

if (process.argv.length !== 2) throw new Error('this recovery takes no arguments');
const originalPath = path.join(paths.receiptsDirectory, `${tradeDate}-0820.json`);
const originalText = await readFile(originalPath, 'utf8');
const original = JSON.parse(originalText);
if (original.rolloverOutcome !== 'failed' || original.reason !== 'calendar_authority_unavailable' ||
    original.sessionId !== null || original.localDate !== tradeDate) {
    throw new Error('original_0820_failure_not_eligible');
}
const authority = await resolveIntradayMonitorPremarketTradingDay({ now, root });
if (!authority.current || authority.isTradingDate !== true || authority.tradeDate !== tradeDate) {
    throw new Error('calendar_authority_unavailable');
}
const repository = new IntradayMonitorSessionStateRepository(root);
if (repository.readSession(tradeDate)) throw new Error('current_session_already_exists');
const config = await readJson(paths.configPath);
const dailyBaselinePath = resolveIntradayMonitorDailyBaselinePath(root, authority);
const baseline = await readJson(dailyBaselinePath);
if (baseline.calendar?.previousTradeDate !== authority.previousTradeDate ||
    baseline.calendar?.targetTradeDate !== tradeDate || baseline.manifests?.length !== 160) {
    throw new Error('daily_baseline_not_current');
}
const effectiveConfig = { ...config, tradeDate, baselinePath: dailyBaselinePath };
const gates = await inspectPremarketGates(effectiveConfig, root);
if (!gates.ready || !gates.checks.configuredCohort || !gates.checks.baseline ||
    gates.checks.simulation !== true || gates.checks.businessSession !== true ||
    gates.checks.snapshot2330 !== true) {
    throw new Error(`premarket_recovery_gate_failed:${JSON.stringify(gates.checks)}`);
}
const todayCapture = path.join(root, 'direct-160-live', `capture-${tradeDate}.json`);
if (await exists(todayCapture)) throw new Error('today_capture_already_exists');
const oldAnchorText = await readFile(paths.generationAnchorPath, 'utf8');
const oldAnchor = JSON.parse(oldAnchorText);
const recoveryPath = path.join(paths.receiptsDirectory, `${tradeDate}-0820-manual-recovery.json`);
const claimPath = path.join(paths.claimsDirectory, `${tradeDate}-0820-manual-recovery.json`);
const recoveryId = `manual-recovery-${tradeDate}-${randomUUID()}`;
const claim = { schemaVersion: 'intraday-monitor-manual-0820-recovery/1', recoveryId,
    tradeDate, claimedAt: now.toISOString(), originalReceiptPath: originalPath,
    originalReceiptSha256: digest(originalText), scheduledSuccess: false,
    brokerWriteAuthority: false, productionAuthority: false };
const handle = await open(claimPath, 'wx', 0o600);
try { await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`); await handle.sync(); }
finally { await handle.close(); }
let session = null;
let error = null;
try {
    const prepared = await prepareIntradayMonitorPremarketDailySession({
        appSupportRoot: root, config: effectiveConfig, authority,
        connectionGeneration: gates.generation,
        schedulerReceipt: { ...claim, authority, gateObservedAt: gates.observedAt,
            baselineHash: baseline.baselineHash }, now,
    });
    session = prepared.session;
    if (!prepared.baselineCurrent || session.phase !== 'starting') {
        throw new Error('manual_session_not_starting');
    }
    const anchor = { generation: gates.generation, anchoredAt: new Date().toISOString(),
        tradeDate, manualRecoveryId: recoveryId, priorAnchorSha256: digest(oldAnchorText) };
    const temporary = `${paths.generationAnchorPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(anchor)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, paths.generationAnchorPath);
} catch (caught) {
    error = String(caught?.message ?? caught).slice(0, 256);
}
const receipt = { schemaVersion: 'intraday-monitor-manual-0820-recovery/1', recoveryId,
    tradeDate, originalReceiptPath: originalPath, originalReceiptSha256: digest(originalText),
    claimPath, startedAt: now.toISOString(), endedAt: new Date().toISOString(),
    outcome: error ? 'failed' : 'session_created', reason: error,
    sessionId: session?.sessionId ?? null, sessionIdentityHash: session?.sessionIdentityHash ?? null,
    authority, baselinePath: dailyBaselinePath, baselineHash: baseline.baselineHash,
    previousAnchorSha256: digest(oldAnchorText), currentGenerationObservedAt: gates.observedAt,
    scheduledSuccess: false, brokerWriteAuthority: false, productionAuthority: false };
const receiptHandle = await open(recoveryPath, 'wx', 0o600);
try { await receiptHandle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`); await receiptHandle.sync(); }
finally { await receiptHandle.close(); }
console.log(JSON.stringify({ outcome: receipt.outcome, reason: receipt.reason,
    tradeDate, sessionId: receipt.sessionId, recoveryPath }));
if (error) process.exitCode = 1;
