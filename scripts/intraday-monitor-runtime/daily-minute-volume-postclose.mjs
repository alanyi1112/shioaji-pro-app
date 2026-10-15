import { lstat, readFile, realpath } from 'node:fs/promises';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { ScreenerSqlite } from '../stock-screener-sqlite.mjs';
import { createScreenerBrokerPorts } from '../stock-screener-broker-ports.mjs';
import { baselineCalendar } from './direct-160-baseline.mjs';
import { createDailyMinuteVolumeCollector } from './daily-minute-volume-collector.mjs';
import { createDailyMinuteVolumeContractCache } from './daily-minute-volume-contract-cache.mjs';
import { DailyMinuteVolumeRepository } from './daily-minute-volume-repository.mjs';
import { reconcileDailyMinuteVolumeTail } from './daily-minute-volume-tail-reconciliation.mjs';
import { createDynamicDailyBaselineApiPort } from './dynamic-daily-baseline-api-port.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';
import { validateTieredCohortManifest } from './tiered-capacity-stage-artifacts.mjs';
import { saveDailyCalendarCache } from './daily-calendar-cache.mjs';

export const DAILY_MINUTE_VOLUME_MODE_SCHEMA = 'intraday-minute-volume-runtime-mode/1';
const filename = 'daily-runtime-mode.json';
const safe = value => Number.isSafeInteger(value) && value > 0;

function validRuntimeLimits(value) {
    if (value === undefined) return true;
    return value && typeof value === 'object' && !Array.isArray(value) &&
        safe(value.maxRssBytes) && value.maxRssBytes <= 8 * 1024 ** 3 &&
        safe(value.minimumFreeDiskBytes) && value.minimumFreeDiskBytes <= 100 * 1024 ** 3 &&
        safe(value.maximumEventProcessingMs) && value.maximumEventProcessingMs <= 20_000 &&
        Number.isSafeInteger(value.diskCheckIntervalMs) &&
        value.diskCheckIntervalMs >= 1_000 && value.diskCheckIntervalMs <= 60_000;
}

function validatedMode(value) {
    if (value?.schemaVersion !== DAILY_MINUTE_VOLUME_MODE_SCHEMA ||
        !['legacy', 'daily'].includes(value.mode) ||
        value.mode === 'daily' && (!path.isAbsolute(value.screenerDatabasePath ?? '') ||
            !safe(value.limits?.maxRequests) || value.limits.maxRequests > 320 ||
            !safe(value.limits?.maxResponseBytes) || value.limits.maxResponseBytes > 2 * 1024 ** 2 ||
            !safe(value.limits?.requestTimeoutMs) || value.limits.requestTimeoutMs > 20_000 ||
            !safe(value.limits?.maxAttempts) || value.limits.maxAttempts > 3 ||
            !Number.isSafeInteger(value.limits?.cooldownMs) ||
            value.limits.cooldownMs < 15 * 60_000 ||
            typeof value.limits?.deadlineTime !== 'string' ||
            !/^1[4-9]:[0-5]\d:00$/.test(value.limits.deadlineTime) ||
            !validRuntimeLimits(value.runtimeLimits))) {
        throw new Error('daily_mode_config_invalid');
    }
    return Object.freeze(value);
}

// The 13:35 worker may need more than the old 14:15/14:55 retry window at
// two broker requests per minute. Keep retries inside this same scheduled
// process, bounded by the saved cooldown, attempt count and collection deadline.
export async function runDailyCollectionAttempts({ collect, limits, attempt = 1,
    now = () => new Date().toISOString(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (typeof collect !== 'function' || typeof now !== 'function' || typeof wait !== 'function' ||
        !Number.isSafeInteger(attempt) || attempt < 1 ||
        !Number.isSafeInteger(limits?.maxAttempts) || attempt > limits.maxAttempts ||
        !Number.isSafeInteger(limits?.cooldownMs) || limits.cooldownMs < 0 ||
        !Number.isFinite(Date.parse(limits?.deadlineAt ?? ''))) {
        throw new TypeError('daily_collection_attempts_invalid');
    }
    for (let current = attempt; current <= limits.maxAttempts; current += 1) {
        const receipt = await collect(current);
        if (receipt?.outcome === 'complete' || current === limits.maxAttempts ||
            receipt?.waitingCount === 0) return receipt;
        const due = Date.parse(receipt?.completedAt ?? '') + limits.cooldownMs;
        if (!Number.isFinite(due) || due >= Date.parse(limits.deadlineAt)) return receipt;
        while (Date.parse(now()) < due) {
            const remaining = due - Date.parse(now());
            await wait(Math.min(60_000, remaining));
            if (Date.parse(now()) < due && due - Date.parse(now()) >= remaining)
                throw new Error('daily_collection_cooldown_clock_not_advanced');
        }
        if (Date.parse(now()) >= Date.parse(limits.deadlineAt)) return receipt;
    }
}

// No mode file means the existing scheduled path remains untouched.  An invalid file
// fails closed; it must never silently fall back to the legacy collector.
export async function readDailyMinuteVolumeMode(root) {
    if (!path.isAbsolute(root ?? '')) throw new TypeError('daily_mode_root_invalid');
    const file = path.join(root, 'IntradayMonitor', filename);
    let value;
    try {
        const metadata = await lstat(file);
        if (!metadata.isFile() || metadata.isSymbolicLink() ||
            metadata.uid !== process.getuid() || metadata.mode & 0o077 ||
            metadata.size < 2 || metadata.size > 4096 || await realpath(file) !== file) {
            throw new Error('daily_mode_config_invalid');
        }
        value = JSON.parse(await readFile(file, 'utf8'));
    }
    catch (error) {
        if (error?.code === 'ENOENT') return Object.freeze({ mode: 'legacy', configured: false });
        throw new Error('daily_mode_config_invalid');
    }
    return validatedMode(value);
}

export function readDailyMinuteVolumeModeSync(root) {
    if (!path.isAbsolute(root ?? '')) throw new TypeError('daily_mode_root_invalid');
    const file = path.join(root, 'IntradayMonitor', filename);
    try {
        const metadata = lstatSync(file);
        if (!metadata.isFile() || metadata.isSymbolicLink() ||
            metadata.uid !== process.getuid() || metadata.mode & 0o077 ||
            metadata.size < 2 || metadata.size > 4096 || realpathSync(file) !== file) {
            throw new Error('daily_mode_config_invalid');
        }
        return validatedMode(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
        if (error?.code === 'ENOENT') return Object.freeze({ mode: 'legacy', configured: false });
        throw new Error('daily_mode_config_invalid');
    }
}

// This worker has no Stage capture, tail review, broker login, stream or order port.
// It shares the screener's persisted quota ledger and only asks for a single KBar
// request for each missing/invalidated symbol, plus a contract if no verified cache.
export async function runDailyMinuteVolumePostclose({ root, mode, sourceTradeDate,
    calendar, connectionGeneration, attempt = 1, now = () => new Date().toISOString(),
    fetchImpl = fetch, apiPortFactory = createDynamicDailyBaselineApiPort,
    screenerDbFactory = file => new ScreenerSqlite(file),
    brokerPortsFactory = createScreenerBrokerPorts,
    repositoryFactory = file => new DailyMinuteVolumeRepository(file) } = {}) {
    if (!path.isAbsolute(root ?? '') || mode?.mode !== 'daily' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(sourceTradeDate ?? '') ||
        calendar?.tradeDate !== sourceTradeDate ||
        !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(connectionGeneration ?? '') ||
        typeof now !== 'function' || typeof fetchImpl !== 'function') {
        throw new TypeError('daily_postclose_inputs_invalid');
    }
    const verifiedCalendar = baselineCalendar(calendar.twse, calendar.tpex,
        sourceTradeDate, calendar.targetTradeDate, Date.parse(now()));
    if (verifiedCalendar.sourceVersion !== calendar.calendarSourceVersion) {
        throw new Error('daily_postclose_calendar_conflict');
    }
    // 官方日曆獨立保存；不假造legacy v1 bundle，也不依賴全160採集成功。
    await saveDailyCalendarCache({ root, calendar, fetchedAt: now(), trigger: 'postclose' });
    const configured = JSON.parse(await readFile(path.join(root, 'IntradayMonitor',
        'premarket', 'config.json'), 'utf8'));
    const bundle = await resolveIntradayMonitorRuntimeArtifactBundle({
        appSupportRoot: root, bundleHash: configured.artifactBundleHash });
    if (!bundle.valid) throw new Error('daily_postclose_artifact_invalid');
    const cohort = JSON.parse(await readFile(bundle.files.cohort, 'utf8'));
    if (!validateTieredCohortManifest(cohort).valid || cohort.stage !== 160) {
        throw new Error('daily_postclose_cohort_invalid');
    }
    const approval = new IntradayMonitorSessionStateRepository(root).readApproval();
    if (approval?.decision !== 'go' || approval.approvedActiveLimit !== 160 ||
        approval.artifactBundleHash !== bundle.bundleHash) {
        throw new Error('daily_postclose_capacity_approval_missing');
    }
    const savedGeneration = (await readFile(path.join(root, 'runtime-api-generation'), 'utf8')).trim();
    const savedMode = (await readFile(path.join(root, 'runtime-mode'), 'utf8')).trim();
    if (savedMode !== 'simulation' || savedGeneration !== connectionGeneration) {
        throw new Error('daily_postclose_generation_changed');
    }
    let db, repository;
    try {
        db = screenerDbFactory(mode.screenerDatabasePath);
        repository = repositoryFactory(path.join(root, 'IntradayMonitor',
            'daily-minute-volume-baselines.sqlite3'));
        const apiPort = apiPortFactory({ fetchImpl, now });
        const [source, broker] = await Promise.all([
            apiPort.preflight(),
            Promise.resolve(brokerPortsFactory({ db, fetchImpl, root,
                now: () => new Date(now()), usageCacheMs: 5000 }))
                .then(ports => ports.safety().then(safety => ({ ports, safety }))),
        ]);
        if (source?.simulation !== true || broker.safety?.simulation !== true ||
            broker.safety.generation !== connectionGeneration) {
            throw new Error('daily_postclose_simulation_unverified');
        }
        const contractCache = createDailyMinuteVolumeContractCache(root);
        const collector = createDailyMinuteVolumeCollector({ apiPort,
            admission: broker.ports.admission, repository, now,
            readCachedContract: contractCache.readCachedContract,
            writeCachedContract: contractCache.writeCachedContract });
        const limits = { ...mode.limits,
            deadlineAt: `${sourceTradeDate}T${mode.limits.deadlineTime}+08:00` };
        const receipt = await runDailyCollectionAttempts({ attempt, limits, now,
            collect: currentAttempt => collector.collect({ root, entries: cohort.cohort,
                calendar: { ...verifiedCalendar, twse: calendar.twse, tpex: calendar.tpex },
                sourceVersion: source.sourceVersion, connectionGeneration,
                attempt: currentAttempt, limits }) });
        if (receipt?.outcome !== 'complete') return receipt;
        // The baseline is published independently. Tail diagnostics are local-only
        // and must never turn a complete baseline into a failed collection.
        const tailReconciliation = await reconcileDailyMinuteVolumeTail({ root,
            sourceTradeDate, targetTradeDate: verifiedCalendar.targetTradeDate,
            collectionReceipt: receipt, now }).catch(error => ({
            state: 'diagnostic_failed', reason: String(error?.message ?? 'unknown').slice(0, 128),
        }));
        return { ...receipt, tailReconciliation };
    } finally { repository?.close(); db?.close(); }
}
