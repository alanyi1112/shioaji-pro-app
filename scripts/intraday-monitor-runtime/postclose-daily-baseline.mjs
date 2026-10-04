import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES,
    buildOfficialMarketCalendarSnapshot,
    parseTpexOfficialCalendar,
    parseTwseOfficialCalendar,
} from '../smart-order-runtime/official-market-calendar-core.mjs';
import { TWSE_OFFICIAL_OPENAPI_URL, normalizeTwseOpenApiCalendar }
    from './trading-calendar-authority.mjs';
import { validateTieredCohortManifest } from './tiered-capacity-stage-artifacts.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';
import { resolveIntradayMonitorDailyBaselinePath } from './premarket-daily-session.mjs';
import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';
import { createBaselineBandwidthBudget,
    readVerifiedBaselineBandwidthSamples } from './baseline-bandwidth-budget.mjs';
import { runPostcloseTailRecovery } from './postclose-tail-recovery.mjs';

export const POSTCLOSE_DAILY_BASELINE_SCHEMA = 'intraday-monitor-postclose-daily-baseline/1';
export const POSTCLOSE_DAILY_BASELINE_LABEL = 'com.alanyi.realtimestock.intraday-postclose-baseline';
export const POSTCLOSE_DAILY_BASELINE_RETRY_LABEL =
    'com.alanyi.realtimestock.intraday-postclose-baseline-retry';
export const BASELINE_DISK_RESERVE_BYTES = 8 * 1024 ** 3;
export const POSTCLOSE_MAX_ATTEMPTS = 3;
const RETRYABLE_FAILURES = new Set([
    'provider_bandwidth_reserve_insufficient', // 舊版 2026-09-23 收據
    'provider_bandwidth_budget_insufficient',
    'provider_bandwidth_budget_insufficient_at_start',
    'provider_bandwidth_budget_insufficient_during_capture',
    'source_unavailable', 'source_invalid_json', 'fetch_failed',
    'calendar_authority_unavailable', 'business_session_unavailable',
    'baseline_collect_failed', 'baseline_build_failed',
]);
const REPO_DIRECTORY = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

function appSupportRoot() {
    return process.env.REALTIME_STOCK_APP_SUPPORT ??
        path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock');
}

function localDate(now) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
}

function safeReason(error) {
    return String(error?.message ?? error ?? 'postclose_baseline_failed')
        .replace(/[^A-Za-z0-9:._-]/g, '_').slice(0, 128);
}

export function resolvePostcloseDailyBaselinePaths(root = appSupportRoot(), tradeDate, attempt = 1) {
    if (!path.isAbsolute(root) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !Number.isInteger(attempt) || attempt < 1 || attempt > POSTCLOSE_MAX_ATTEMPTS) {
        throw new TypeError('postclose baseline path identity is invalid');
    }
    const directory = path.join(root, 'IntradayMonitor', 'postclose-baseline');
    const suffix = attempt === 1 ? '' : `-attempt-${String(attempt).padStart(2, '0')}`;
    return Object.freeze({
        directory,
        configPath: path.join(root, 'IntradayMonitor', 'premarket', 'config.json'),
        claimPath: path.join(directory, 'claims', `${tradeDate}${suffix}.json`),
        receiptPath: path.join(directory, 'receipts', `${tradeDate}${suffix}.json`),
        budgetPath: path.join(directory, 'budgets', `${tradeDate}${suffix}.json`),
        sourceDirectory: path.join(root, 'intraday-baselines',
            attempt === 1 ? `${tradeDate}-direct160-source` :
                `${tradeDate}-direct160-attempt-${String(attempt).padStart(2, '0')}-source`),
        plistPath: path.join(os.homedir(), 'Library', 'LaunchAgents',
            `${POSTCLOSE_DAILY_BASELINE_LABEL}.plist`),
        retryPlistPath: path.join(os.homedir(), 'Library', 'LaunchAgents',
            `${POSTCLOSE_DAILY_BASELINE_RETRY_LABEL}.plist`),
    });
}

export function resolveHistoricalBaselinePaths(root = appSupportRoot(), tradeDate, attempt = 1) {
    if (!path.isAbsolute(root) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !Number.isInteger(attempt) || attempt < 1 || attempt > POSTCLOSE_MAX_ATTEMPTS) {
        throw new TypeError('historical baseline path identity is invalid');
    }
    const directory = path.join(root, 'IntradayMonitor', 'historical-baseline-backfill');
    const suffix = `-attempt-${String(attempt).padStart(2, '0')}`;
    return Object.freeze({
        directory,
        configPath: path.join(root, 'IntradayMonitor', 'premarket', 'config.json'),
        claimPath: path.join(directory, 'claims', `${tradeDate}${suffix}.json`),
        receiptPath: path.join(directory, 'receipts', `${tradeDate}${suffix}.json`),
        budgetPath: path.join(directory, 'budgets', `${tradeDate}${suffix}.json`),
        sourceDirectory: path.join(root, 'intraday-baselines',
            `${tradeDate}-historical-backfill${suffix}-source`),
    });
}

export async function inspectPostcloseDailyBaseline({ root = appSupportRoot(),
    tradeDate = localDate(new Date()), historical = false } = {}) {
    const readOptional = async (file) => {
        try { return JSON.parse(await readFile(file, 'utf8')); }
        catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    };
    const attempts = await Promise.all(Array.from({ length: POSTCLOSE_MAX_ATTEMPTS },
        async (_, index) => {
            const paths = historical ? resolveHistoricalBaselinePaths(root, tradeDate, index + 1) :
                resolvePostcloseDailyBaselinePaths(root, tradeDate, index + 1);
            const [claim, receipt] = await Promise.all([
                readOptional(paths.claimPath), readOptional(paths.receiptPath),
            ]);
            return { attempt: index + 1, claim, receipt,
                claimPath: paths.claimPath, receiptPath: paths.receiptPath };
        }));
    const latest = [...attempts].reverse().find((item) => item.claim || item.receipt) ?? attempts[0];
    const { claim, receipt } = latest;
    return Object.freeze({ tradeDate, historical, claim, receipt,
        state: receipt?.outcome ?? (claim ? 'claimed_without_receipt' : 'not_claimed'),
        attempt: latest.attempt, attempts, claimPath: latest.claimPath,
        receiptPath: latest.receiptPath });
}

async function fetchJson(url, fetchImpl, init = {}) {
    const response = await fetchImpl(url, {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000), ...init,
    });
    if (!response?.ok || response.status !== 200) throw new Error('source_unavailable');
    try { return await response.json(); }
    catch { throw new Error('source_invalid_json'); }
}

async function fetchAnnualCalendar(year, fetchImpl, at) {
    const [twse, tpex] = await Promise.all([
        (async () => {
            try {
                const primary = normalizeTwseOpenApiCalendar(
                    await fetchJson(TWSE_OFFICIAL_OPENAPI_URL, fetchImpl,
                        { headers: { accept: 'application/json' } }), year);
                parseTwseOfficialCalendar(primary, year);
                return primary;
            } catch {
                const alternate = await fetchJson(
                    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.TSE.annualUrl(year), fetchImpl,
                    { headers: { accept: 'application/json' } });
                parseTwseOfficialCalendar(alternate, year);
                return alternate;
            }
        })(),
        fetchJson(SMART_ORDER_OFFICIAL_MARKET_CALENDAR_SOURCES.OTC.annualUrl(year), fetchImpl,
            { headers: { accept: 'application/json' } }),
    ]);
    const snapshot = buildOfficialMarketCalendarSnapshot({
        twse: parseTwseOfficialCalendar(twse, year),
        tpex: parseTpexOfficialCalendar(tpex, year),
        fetchedAtEpochMs: at,
    });
    return { year, twse, tpex, snapshot };
}

export async function resolvePostcloseBaselineCalendar({ now, fetchImpl = fetch,
    sourceTradeDate = localDate(now) } = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
        throw new TypeError('postclose baseline time is invalid');
    }
    const tradeDate = sourceTradeDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) ||
        !Number.isFinite(Date.parse(`${tradeDate}T13:35:00+08:00`))) {
        throw new TypeError('postclose baseline trade date is invalid');
    }
    if (now.valueOf() < Date.parse(`${tradeDate}T13:35:00+08:00`)) {
        throw new Error('postclose_baseline_window_not_open');
    }
    const year = Number(tradeDate.slice(0, 4));
    const current = await fetchAnnualCalendar(year, fetchImpl, now.valueOf());
    const currentDay = current.snapshot.days.find((day) => day.tradeDate === tradeDate);
    if (currentDay?.TSE !== 'scheduled_trading' || currentDay?.OTC !== 'scheduled_trading') {
        throw new Error('official_non_trading_date');
    }
    let target = current.snapshot.days.find((day) => day.tradeDate > tradeDate &&
        day.TSE === 'scheduled_trading' && day.OTC === 'scheduled_trading');
    let nextYear = null;
    if (!target) {
        nextYear = await fetchAnnualCalendar(year + 1, fetchImpl, now.valueOf());
        target = nextYear.snapshot.days.find((day) =>
            day.TSE === 'scheduled_trading' && day.OTC === 'scheduled_trading');
    }
    if (!target) throw new Error('next_trade_date_unavailable');
    if (target.tradeDate.slice(0, 4) !== tradeDate.slice(0, 4)) {
        // 現有 baseline bundle calendar schema 只包含單一年度；不得猜測跨年來源。
        throw new Error('cross_year_baseline_calendar_unsupported');
    }
    return Object.freeze({ tradeDate, targetTradeDate: target.tradeDate,
        twse: current.twse, tpex: current.tpex,
        calendarSourceVersion: current.snapshot.calendarVersion,
        nextYearSourceVersion: nextYear?.snapshot.calendarVersion ?? null });
}

async function apiPreflight(root, fetchImpl) {
    const [mode, info, health, snapshot, usage, disk] = await Promise.all([
        readFile(path.join(root, 'runtime-mode'), 'utf8').then((value) => value.trim()),
        fetchJson('http://127.0.0.1:8080/api/v1/info', fetchImpl),
        fetchJson('http://127.0.0.1:8080/api/v1/health', fetchImpl),
        fetchJson('http://127.0.0.1:8080/api/v1/data/snapshots', fetchImpl, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contracts: [{ security_type: 'STK', region: 'TW',
                exchange: 'TSE', code: '2330', target_code: null }] }),
        }),
        fetchJson('http://127.0.0.1:8080/api/v1/auth/usage', fetchImpl),
        statfs(root).then((value) => value.bavail * value.bsize),
    ]);
    if (mode !== 'simulation' || info?.simulation !== true) throw new Error('simulation_required');
    if (health?.status !== 'healthy' || !Array.isArray(snapshot) || snapshot.length !== 1) {
        throw new Error('business_session_unavailable');
    }
    if (!Number.isSafeInteger(disk) || disk < BASELINE_DISK_RESERVE_BYTES) {
        const error = new Error('disk_reserve_insufficient');
        error.resourceEvidence = { remainingBytes: usage?.remaining_bytes ?? null,
            availableDiskBytes: disk, minimumDiskBytes: BASELINE_DISK_RESERVE_BYTES };
        throw error;
    }
    return Object.freeze({ usage, remainingBytes: usage?.remaining_bytes ?? null,
        availableDiskBytes: disk,
        apiVersion: info.version });
}

async function runChild(command, args, { timeoutMs, cwd = REPO_DIRECTORY } = {}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        const stdout = createHash('sha256');
        const stderr = createHash('sha256');
        let stdoutBytes = 0;
        let stderrBytes = 0;
        child.stdout.on('data', (chunk) => { stdout.update(chunk); stdoutBytes += chunk.length; });
        child.stderr.on('data', (chunk) => { stderr.update(chunk); stderrBytes += chunk.length; });
        const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
        timer.unref?.();
        let settled = false;
        const finish = (exitCode, error = null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ exitCode, error, stdoutSha256: stdout.digest('hex'),
                stderrSha256: stderr.digest('hex'), stdoutBytes, stderrBytes });
        };
        child.once('error', (error) => finish(null, safeReason(error)));
        child.once('exit', (code) => finish(code));
    });
}

async function writeExclusiveJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
}

export async function runPostcloseDailyBaseline({ now = new Date(), root = appSupportRoot(),
    fetchImpl = fetch, execute = runChild, calendarResolver = resolvePostcloseBaselineCalendar,
    preflight = apiPreflight, sampleReader = readVerifiedBaselineBandwidthSamples,
    budgetBuilder = createBaselineBandwidthBudget, trigger = 'manual',
    historicalTradeDate = null } = {}) {
    const historical = historicalTradeDate !== null;
    const tradeDate = historical ? historicalTradeDate : localDate(now);
    if (historical) {
        const ageDays = (Date.parse(`${localDate(now)}T00:00:00Z`) -
            Date.parse(`${tradeDate}T00:00:00Z`)) / 86_400_000;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || !Number.isInteger(ageDays) ||
            ageDays < 1 || ageDays > 30) {
            return Object.freeze({ executed: false, reason: 'historical_date_out_of_bounds', tradeDate });
        }
    }
    if (now.valueOf() < Date.parse(`${tradeDate}T13:35:00+08:00`)) {
        return Object.freeze({ executed: false, reason: 'postclose_baseline_window_not_open', tradeDate });
    }
    const history = await inspectPostcloseDailyBaseline({ root, tradeDate, historical });
    if (history.attempts.some((item) => item.receipt && !item.claim)) {
        return Object.freeze({ executed: false, reason: 'receipt_without_claim', tradeDate });
    }
    if (history.receipt && ['verified', 'already_verified'].includes(history.receipt.outcome)) {
        let tailRecovery = null;
        if (!historical) {
            try {
                const config = JSON.parse(await readFile(resolvePostcloseDailyBaselinePaths(root,
                    tradeDate, history.attempt).configPath, 'utf8'));
                const bundle = await resolveIntradayMonitorRuntimeArtifactBundle({ appSupportRoot: root,
                    bundleHash: config.artifactBundleHash });
                if (bundle.valid) {
                    const session = new IntradayMonitorSessionStateRepository(root).readSession(tradeDate);
                    const previousBaselinePath = session?.previousTradeDate
                        ? resolveIntradayMonitorDailyBaselinePath(root, {
                            tradeDate, previousTradeDate: session.previousTradeDate }) : null;
                    const recovery = await runPostcloseTailRecovery({ root, tradeDate,
                        manifestPath: bundle.files.cohort, planPath: bundle.files.plan,
                        previousBaselinePath, receipt: history.receipt });
                    tailRecovery = { state: recovery.state,
                        classification: recovery.classification?.classification ?? null,
                        resultPath: recovery.resultPath ?? null };
                }
            } catch (error) {
                tailRecovery = { state: 'failed', reason: safeReason(error) };
            }
        }
        return Object.freeze({ executed: false, reason: 'already_verified', tradeDate,
            receipt: history.receipt, tailRecovery });
    }
    if (history.claim && !history.receipt) {
        return Object.freeze({ executed: false, reason: 'claim_without_receipt', tradeDate });
    }
    let attempt = 1;
    if (history.receipt) {
        if (history.receipt.outcome !== 'failed' ||
            !RETRYABLE_FAILURES.has(history.receipt.reason)) {
            return Object.freeze({ executed: false, reason: 'retry_not_authorized', tradeDate,
                receipt: history.receipt });
        }
        attempt = history.attempt + 1;
        if (attempt > POSTCLOSE_MAX_ATTEMPTS) {
            return Object.freeze({ executed: false, reason: 'attempt_limit_reached', tradeDate,
                receipt: history.receipt });
        }
        const retryTime = attempt === 2 ? '14:15:00' : '14:55:00';
        if (!historical && now.valueOf() < Date.parse(`${tradeDate}T${retryTime}+08:00`)) {
            return Object.freeze({ executed: false, reason: 'retry_window_not_open', tradeDate,
                receipt: history.receipt });
        }
    }
    const paths = historical ? resolveHistoricalBaselinePaths(root, tradeDate, attempt) :
        resolvePostcloseDailyBaselinePaths(root, tradeDate, attempt);
    let claim;
    try {
        claim = { schemaVersion: POSTCLOSE_DAILY_BASELINE_SCHEMA, tradeDate, attempt,
            trigger: historical ? 'historical_backfill_manual' : trigger,
            historicalBackfill: historical,
            claimedAt: now.toISOString(), brokerWriteAuthority: false,
            productionAuthority: false, serviceLifecycleAuthority: false };
        await writeExclusiveJson(paths.claimPath, claim);
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const receipt = await readFile(paths.receiptPath, 'utf8').then(JSON.parse).catch(() => null);
        return Object.freeze({ executed: false,
            reason: receipt ? 'already_completed_or_failed' : 'claim_without_receipt',
            tradeDate, receipt });
    }
    const startedAt = new Date().toISOString();
    let result = null;
    let baselinePath = null;
    let verificationPath = null;
    let calendarEvidence = null;
    let budgetEvidence = null;
    let cohortPath = null;
    let planPath = null;
    try {
        const calendar = await calendarResolver({ now, fetchImpl,
            sourceTradeDate: tradeDate });
        if (calendar.tradeDate !== tradeDate) throw new Error('calendar_authority_unavailable');
        if (historical && calendar.targetTradeDate <= localDate(now)) {
            throw new Error('historical_target_date_not_future');
        }
        calendarEvidence = { tradeDate: calendar.tradeDate,
            targetTradeDate: calendar.targetTradeDate,
            sourceVersion: calendar.calendarSourceVersion };
        const config = JSON.parse(await readFile(paths.configPath, 'utf8'));
        const bundle = await resolveIntradayMonitorRuntimeArtifactBundle({ appSupportRoot: root,
            bundleHash: config.artifactBundleHash });
        if (!bundle.valid) throw new Error('artifact_bundle_invalid');
        cohortPath = bundle.files.cohort;
        planPath = bundle.files.plan;
        const manifest = JSON.parse(await readFile(bundle.files.cohort, 'utf8'));
        if (!validateTieredCohortManifest(manifest).valid || manifest.stage !== 160) {
            throw new Error('cohort_invalid');
        }
        const approval = new IntradayMonitorSessionStateRepository(root).readApproval();
        if (approval?.decision !== 'go' || approval.approvedActiveLimit !== 160 ||
            approval.artifactBundleHash !== bundle.bundleHash) {
            throw new Error('capacity_approval_missing');
        }
        const resources = await preflight(root, fetchImpl);
        baselinePath = resolveIntradayMonitorDailyBaselinePath(root, {
            tradeDate: calendar.targetTradeDate, previousTradeDate: tradeDate,
        });
        const baselineExists = await readFile(baselinePath, 'utf8')
            .then((raw) => ({ exists: true, raw }))
            .catch((error) => {
                if (error?.code === 'ENOENT') return { exists: false, raw: null };
                throw error;
            });
        if (baselineExists.exists) {
            let existing;
            try { existing = JSON.parse(baselineExists.raw); }
            catch { throw new Error('existing_baseline_invalid'); }
            if (!validateDirect160BaselineSet(existing, manifest, calendar.targetTradeDate) ||
                existing.calendar.sourceVersion !== calendar.calendarSourceVersion) {
                throw new Error('existing_baseline_invalid');
            }
            result = { outcome: 'already_verified', baselineHash: existing.baselineHash,
                targetTradeDate: calendar.targetTradeDate, calendarSourceVersion: calendar.calendarSourceVersion,
                resources };
        } else {
            const samples = await sampleReader({ root, manifest, tradeDate });
            const budget = budgetBuilder({ usage: resources.usage, samples,
                manifestHash: manifest.manifestHash, tradeDate, attempt,
                observedAt: new Date().toISOString() });
            await writeExclusiveJson(paths.budgetPath, budget);
            budgetEvidence = { budgetPath: paths.budgetPath,
                budgetSha256: createHash('sha256').update(`${JSON.stringify(budget, null, 2)}\n`).digest('hex'),
                requiredStartBytes: budget.requiredStartBytes,
                reserveBytes: budget.reserveBytes, forecastBytes: budget.forecastBytes,
                remainingBytes: budget.providerRemainingBytes,
                sampleDates: budget.samples.map((sample) => sample.tradeDate),
                sampleEvidence: budget.samples.map((sample) => ({
                    tradeDate: sample.tradeDate, consumedBytes: sample.consumedBytes,
                    sourceSha256: sample.sourceSha256 ?? null,
                    usageStartSha256: sample.usageStartSha256 ?? null,
                    usageEndSha256: sample.usageEndSha256 ?? null,
                    verificationSha256: sample.verificationSha256,
                    baselineSha256: sample.baselineSha256,
                })),
                ready: budget.ready };
            if (!budget.ready) {
                const error = new Error(budget.blocker);
                error.resourceEvidence = budgetEvidence;
                throw error;
            }
            const collector = await execute(process.env.REALTIME_STOCK_PYTHON ?? '/opt/homebrew/bin/python3',
                [path.join(REPO_DIRECTORY, 'scripts/intraday-monitor-runtime/collect-direct-160-baseline.py'),
                    '--execute', ...(historical ? ['--historical-backfill'] : []),
                    `--manifest=${bundle.files.cohort}`, `--date=${tradeDate}`,
                    `--output=${paths.sourceDirectory}`, `--budget=${paths.budgetPath}`],
                { timeoutMs: 31 * 60_000 });
            if (collector.exitCode !== 0) {
                const failure = await readFile(path.join(paths.sourceDirectory, 'failure.json'), 'utf8')
                    .then(JSON.parse).catch(() => null);
                const reason = failure?.reason;
                throw new Error(reason === 'provider_bandwidth_budget_insufficient_at_start' ||
                    reason === 'provider_bandwidth_budget_insufficient_during_capture' ?
                    reason : 'baseline_collect_failed');
            }
            await writeExclusiveJson(path.join(paths.sourceDirectory, 'twse-calendar.json'), calendar.twse);
            await writeExclusiveJson(path.join(paths.sourceDirectory, 'tpex-calendar.json'), calendar.tpex);
            await mkdir(path.dirname(path.dirname(baselinePath)), { recursive: true, mode: 0o700 });
            const stagingDirectory = path.join(path.dirname(path.dirname(baselinePath)),
                `${tradeDate}-for-${calendar.targetTradeDate}-${historical ? 'historical-backfill-' : ''}attempt-${String(attempt).padStart(2, '0')}-verified`);
            verificationPath = path.join(stagingDirectory, 'verification.json');
            const builder = await execute(process.execPath,
                [path.join(REPO_DIRECTORY, 'scripts/intraday-monitor-runtime/build-direct-160-baseline.mjs'),
                    '--execute', `--source=${paths.sourceDirectory}`,
                    `--output=${stagingDirectory}`, `--manifest=${bundle.files.cohort}`,
                    `--target-date=${calendar.targetTradeDate}`], { timeoutMs: 120_000 });
            if (builder.exitCode !== 0) throw new Error('baseline_build_failed');
            const verified = JSON.parse(await readFile(path.join(stagingDirectory,
                'baseline-set.json'), 'utf8'));
            if (!validateDirect160BaselineSet(verified, manifest, calendar.targetTradeDate) ||
                verified.calendar.sourceVersion !== calendar.calendarSourceVersion) {
                throw new Error('baseline_verification_failed');
            }
            if (await stat(path.dirname(baselinePath)).then(() => true).catch(() => false)) {
                throw new Error('existing_baseline_output_conflict');
            }
            await rename(stagingDirectory, path.dirname(baselinePath));
            verificationPath = path.join(path.dirname(baselinePath), 'verification.json');
            result = { outcome: 'verified', baselineHash: verified.baselineHash,
                targetTradeDate: calendar.targetTradeDate, calendarSourceVersion: calendar.calendarSourceVersion,
                resources, collector, builder };
        }
    } catch (error) {
        result = { outcome: 'failed', reason: safeReason(error),
            resourceEvidence: error?.resourceEvidence ?? null };
    }
    const receipt = { schemaVersion: POSTCLOSE_DAILY_BASELINE_SCHEMA, tradeDate,
        attempt, trigger: historical ? 'historical_backfill_manual' : trigger,
        historicalBackfill: historical,
        scheduledRunAttribution: historical ? 'not_applicable' : trigger,
        startedAt, endedAt: new Date().toISOString(), claim, baselinePath,
        calendarEvidence, budgetEvidence,
        sourceDirectory: paths.sourceDirectory,
        verificationPath,
        ...result,
        brokerWriteAuthority: false, productionAuthority: false, serviceLifecycleAuthority: false };
    await writeExclusiveJson(paths.receiptPath, receipt);
    let tailRecovery = null;
    if (!historical && ['verified', 'already_verified'].includes(receipt.outcome) && cohortPath) {
        try {
            const session = new IntradayMonitorSessionStateRepository(root).readSession(tradeDate);
            const previousBaselinePath = session?.previousTradeDate
                ? resolveIntradayMonitorDailyBaselinePath(root, {
                    tradeDate, previousTradeDate: session.previousTradeDate }) : null;
            const recovery = await runPostcloseTailRecovery({ root, tradeDate,
                manifestPath: cohortPath, planPath, previousBaselinePath, receipt });
            tailRecovery = { state: recovery.state,
                classification: recovery.classification?.classification ?? null,
                resultPath: recovery.resultPath ?? null };
        } catch (error) {
            tailRecovery = { state: 'failed', reason: safeReason(error) };
        }
        const triggerReceiptPath = path.join(paths.directory, 'tail-recovery-triggers',
            `${tradeDate}-attempt-${String(attempt).padStart(2, '0')}.json`);
        try {
            await writeExclusiveJson(triggerReceiptPath, {
                schemaVersion: 'intraday-monitor-postclose-tail-recovery-trigger/1',
                tradeDate, attempt, baselineReceiptPath: paths.receiptPath,
                baselineOutcome: receipt.outcome, recovery: tailRecovery,
                recordedAt: new Date().toISOString(), notificationAuthority: false,
                brokerWriteAuthority: false, productionAuthority: false,
            });
        } catch (error) {
            if (error?.code !== 'EEXIST') tailRecovery = { ...tailRecovery,
                triggerReceiptError: safeReason(error) };
        }
    }
    return Object.freeze({ executed: result.outcome === 'verified' ||
        result.outcome === 'already_verified', tradeDate, receipt, tailRecovery });
}

export function buildPostcloseBaselineLaunchAgentPlist(scriptPath) {
    if (!path.isAbsolute(scriptPath ?? '')) throw new TypeError('postclose script path is invalid');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${POSTCLOSE_DAILY_BASELINE_LABEL}</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${scriptPath}</string><string>--scheduled</string></array><key>StartCalendarInterval</key><dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>35</integer></dict><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
}

export function buildPostcloseBaselineRetryLaunchAgentPlist(scriptPath) {
    if (!path.isAbsolute(scriptPath ?? '')) throw new TypeError('postclose script path is invalid');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${POSTCLOSE_DAILY_BASELINE_RETRY_LABEL}</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${scriptPath}</string><string>--scheduled</string></array><key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>15</integer></dict><dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>55</integer></dict></array><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
}

export async function installPostcloseBaselineRetryLaunchAgent({ root = appSupportRoot(),
    scriptPath = path.join(REPO_DIRECTORY,
        'scripts/intraday-monitor-runtime/postclose-daily-baseline.mjs'),
    execute = runChild } = {}) {
    const paths = resolvePostcloseDailyBaselinePaths(root, localDate(new Date()));
    const expected = buildPostcloseBaselineRetryLaunchAgentPlist(scriptPath);
    const existing = await readFile(paths.retryPlistPath, 'utf8').catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
    });
    if (existing !== null && existing !== expected) {
        throw new Error('postclose_retry_launchagent_config_conflict');
    }
    const identity = `gui/${process.getuid()}/${POSTCLOSE_DAILY_BASELINE_RETRY_LABEL}`;
    const probe = await execute('/bin/launchctl', ['print', identity], { timeoutMs: 10_000 });
    if (probe.exitCode === 0) {
        if (existing === null) throw new Error('postclose_retry_launchagent_loaded_without_plist');
        return { installed: true, alreadyLoaded: true, plistPath: paths.retryPlistPath };
    }
    if (existing === null) {
        await mkdir(path.dirname(paths.retryPlistPath), { recursive: true, mode: 0o700 });
        await writeFile(paths.retryPlistPath, expected, { mode: 0o600, flag: 'wx' });
    }
    const loaded = await execute('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`,
        paths.retryPlistPath], { timeoutMs: 10_000 });
    if (loaded.exitCode !== 0) throw new Error('postclose_retry_launchagent_bootstrap_failed');
    const verified = await execute('/bin/launchctl', ['print', identity], { timeoutMs: 10_000 });
    if (verified.exitCode !== 0) throw new Error('postclose_retry_launchagent_readback_failed');
    return { installed: true, alreadyLoaded: false, plistPath: paths.retryPlistPath };
}

export async function installPostcloseBaselineLaunchAgent({ root = appSupportRoot(),
    scriptPath = path.join(REPO_DIRECTORY,
        'scripts/intraday-monitor-runtime/postclose-daily-baseline.mjs'),
    execute = runChild } = {}) {
    const paths = resolvePostcloseDailyBaselinePaths(root, localDate(new Date()));
    const expected = buildPostcloseBaselineLaunchAgentPlist(scriptPath);
    const existing = await readFile(paths.plistPath, 'utf8').catch(() => null);
    if (existing !== null && existing !== expected) {
        throw new Error('postclose_launchagent_config_conflict');
    }
    const probe = await execute('/bin/launchctl', ['print',
        `gui/${process.getuid()}/${POSTCLOSE_DAILY_BASELINE_LABEL}`], { timeoutMs: 10_000 });
    if (probe.exitCode === 0) {
        if (existing === null) throw new Error('postclose_launchagent_loaded_without_plist');
        return { installed: true, alreadyLoaded: true, plistPath: paths.plistPath };
    }
    if (existing === null) {
        await mkdir(path.dirname(paths.plistPath), { recursive: true, mode: 0o700 });
        await writeFile(paths.plistPath, expected, { mode: 0o600, flag: 'wx' });
    }
    const loaded = await execute('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`,
        paths.plistPath], { timeoutMs: 10_000 });
    if (loaded.exitCode !== 0) throw new Error('postclose_launchagent_bootstrap_failed');
    const verified = await execute('/bin/launchctl', ['print',
        `gui/${process.getuid()}/${POSTCLOSE_DAILY_BASELINE_LABEL}`], { timeoutMs: 10_000 });
    if (verified.exitCode !== 0) throw new Error('postclose_launchagent_readback_failed');
    return { installed: true, alreadyLoaded: false, plistPath: paths.plistPath };
}

async function main() {
    const historicalTradeDate = process.argv.find((arg) =>
        arg.startsWith('--historical-backfill='))?.slice('--historical-backfill='.length);
    if (process.argv.includes('--historical-status')) {
        const tradeDate = process.argv.find((arg) => arg.startsWith('--date='))?.slice(7);
        if (!tradeDate) throw new Error('--date required for historical status');
        process.stdout.write(`${JSON.stringify(await inspectPostcloseDailyBaseline({
            tradeDate, historical: true }))}\n`);
        return;
    }
    if (process.argv.includes('--status')) {
        const tradeDate = process.argv.find((arg) => arg.startsWith('--date='))?.slice(7) ??
            localDate(new Date());
        process.stdout.write(`${JSON.stringify(await inspectPostcloseDailyBaseline({ tradeDate }))}\n`);
        return;
    }
    if (process.argv.includes('--install')) {
        process.stdout.write(`${JSON.stringify(await installPostcloseBaselineLaunchAgent())}\n`);
        return;
    }
    if (process.argv.includes('--install-retries')) {
        process.stdout.write(`${JSON.stringify(await installPostcloseBaselineRetryLaunchAgent())}\n`);
        return;
    }
    if (process.argv.includes('--scheduled') &&
        Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Asia/Taipei') {
        throw new Error('system_time_zone_is_not_asia_taipei');
    }
    const result = await runPostcloseDailyBaseline({
        trigger: process.argv.includes('--scheduled') ? 'scheduled' : 'manual',
        historicalTradeDate: historicalTradeDate ?? null,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.receipt?.outcome === 'failed') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${safeReason(error)}\n`); process.exitCode = 1; });
}
