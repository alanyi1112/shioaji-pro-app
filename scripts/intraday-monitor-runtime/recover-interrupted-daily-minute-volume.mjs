/** 操作者明確授權的重開機補件；不修改原生排程 claim／receipt。 */
import { readFile, mkdir, open, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readDailyMinuteVolumeMode } from './daily-minute-volume-postclose.mjs';
import { readDailyCalendarCache } from './daily-calendar-cache.mjs';
import { baselineCalendar } from './direct-160-baseline.mjs';
import { resolveIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';
import { validateTieredCohortManifest } from './tiered-capacity-stage-artifacts.mjs';
import { IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';
import { createDynamicDailyBaselineApiPort } from './dynamic-daily-baseline-api-port.mjs';
import { createDailyMinuteVolumeContractCache } from './daily-minute-volume-contract-cache.mjs';
import { createDailyMinuteVolumeCollector } from './daily-minute-volume-collector.mjs';
import { DailyMinuteVolumeRepository } from './daily-minute-volume-repository.mjs';
import { ScreenerSqlite } from '../stock-screener-sqlite.mjs';
import { createScreenerBrokerPorts } from '../stock-screener-broker-ports.mjs';
import { createInterruptionConservativeAdmission } from './interruption-conservative-admission.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const taipeiDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const alive = pid => { try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function absent(file) {
    try { await access(file); throw new Error('interruption_recovery_conflicting_owner_or_receipt'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function immutable(file, value) {
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
}

export function verifyInterruptedCollection({ claim, prior, sourceTradeDate, bootAt,
    ownerAlive, now, cooldownMs }) {
    if (claim?.schemaVersion !== 'intraday-minute-volume-collection/2' ||
        claim.sourceDate !== sourceTradeDate || claim.attempt !== 2 ||
        claim.simulation !== true || claim.brokerWriteAuthority !== false || claim.notificationAuthority !== false ||
        !Number.isFinite(Date.parse(claim.claimedAt)) ||
        !Number.isSafeInteger(claim.ownerPid) || claim.ownerPid < 1 || ownerAlive !== false ||
        !Array.isArray(claim.requestedSymbols) || claim.requestedSymbols.length !== 160 ||
        new Set(claim.requestedSymbols).size !== 160 ||
        !Number.isFinite(Date.parse(bootAt)) || Date.parse(bootAt) <= Date.parse(claim.claimedAt) ||
        Date.parse(bootAt) > now.getTime() ||
        prior?.schemaVersion !== claim.schemaVersion || prior.sourceDate !== sourceTradeDate ||
        prior.attempt !== 1 || prior.outcome !== 'partial' || prior.conflictCount !== 0 ||
        prior.targetDate !== claim.targetDate || prior.calendarVersion !== claim.calendarVersion ||
        prior.connectionGeneration !== claim.connectionGeneration ||
        !Number.isFinite(Date.parse(prior.completedAt)) ||
        now.getTime() < Date.parse(prior.completedAt) + cooldownMs) {
        throw new Error('interruption_recovery_parent_unverified');
    }
}

export async function recoverInterruptedDailyMinuteVolume({ root, sourceTradeDate, bootAt,
    resumeConservative = false,
    now = () => new Date(), onProgress = () => {} } = {}) {
    const started = now();
    if (!path.isAbsolute(root ?? '') || sourceTradeDate !== taipeiDay(started))
        throw new Error('interruption_recovery_window_invalid');
    const mode = await readDailyMinuteVolumeMode(root);
    const deadlineAt = `${sourceTradeDate}T${mode.limits?.deadlineTime}+08:00`;
    if (mode.mode !== 'daily' || started.getTime() < Date.parse(`${sourceTradeDate}T13:35:00+08:00`) ||
        started.getTime() >= Date.parse(deadlineAt)) throw new Error('interruption_recovery_window_invalid');
    const nativeDir = path.join(root, 'IntradayMonitor', 'daily-minute-volume-collection', sourceTradeDate);
    const claimPath = path.join(nativeDir, 'attempt-02-claim.json');
    const priorPath = path.join(nativeDir, 'attempt-01-receipt.json');
    const claimBytes = await readFile(claimPath), priorBytes = await readFile(priorPath);
    const claim = JSON.parse(claimBytes), prior = JSON.parse(priorBytes);
    verifyInterruptedCollection({ claim, prior, sourceTradeDate, bootAt,
        ownerAlive: alive(claim.ownerPid), now: started, cooldownMs: mode.limits.cooldownMs });
    await absent(path.join(nativeDir, 'attempt-02-receipt.json'));
    await absent(path.join(nativeDir, 'attempt-03-claim.json'));
    await absent(path.join(root, 'direct-160-live', 'registry', 'active.lock'));
    const generation = (await readFile(path.join(root, 'runtime-api-generation'), 'utf8')).trim();
    if ((await readFile(path.join(root, 'runtime-mode'), 'utf8')).trim() !== 'simulation')
        throw new Error('interruption_recovery_simulation_required');
    const configured = JSON.parse(await readFile(path.join(root, 'IntradayMonitor', 'premarket', 'config.json')));
    const bundle = await resolveIntradayMonitorRuntimeArtifactBundle({ appSupportRoot: root,
        bundleHash: configured.artifactBundleHash });
    if (!bundle.valid) throw new Error('interruption_recovery_bundle_invalid');
    const cohort = JSON.parse(await readFile(bundle.files.cohort));
    const approval = new IntradayMonitorSessionStateRepository(root).readApproval();
    if (!validateTieredCohortManifest(cohort).valid || cohort.stage !== 160 ||
        approval?.decision !== 'go' || approval.approvedActiveLimit !== 160 ||
        approval.artifactBundleHash !== bundle.bundleHash ||
        cohort.cohort.some((entry, i) => entry.canonicalSymbol !== claim.requestedSymbols[i]))
        throw new Error('interruption_recovery_cohort_invalid');
    const cached = await readDailyCalendarCache({ root, now: started, tradeDate: claim.targetDate });
    if (cached?.value.sourceTradeDate !== sourceTradeDate ||
        cached.value.targetTradeDate !== claim.targetDate || cached.value.calendarVersion !== claim.calendarVersion)
        throw new Error('interruption_recovery_calendar_invalid');
    const calendar = { ...baselineCalendar(cached.value.twse, cached.value.tpex, sourceTradeDate,
        claim.targetDate, Date.parse(cached.value.fetchedAt)), twse: cached.value.twse, tpex: cached.value.tpex };
    // 固定 namespace 以原 claim hash 為鎖：同一中斷不能啟動第二份補件。
    const recoveryRoot = path.join(root, 'IntradayMonitor', 'operator-interruption-recovery', hash(claimBytes));
    await mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
    let db, repository;
    try {
        db = new ScreenerSqlite(mode.screenerDatabasePath);
        const active = await db.prepare("SELECT COUNT(*) n FROM broker_bandwidth_reservations WHERE status IN ('reserved','dispatched')").first();
        const policy = JSON.parse((await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-bollinger-broker-budget-policy'").first())?.checkpoint ?? 'null');
        if (active?.n !== 0 || policy?.version !== 4 || policy.budgetPolicy?.quoteReserveBytes < 300 * 1024 ** 2)
            throw new Error('interruption_recovery_budget_or_owner_invalid');
        repository = new DailyMinuteVolumeRepository(path.join(root, 'IntradayMonitor', 'daily-minute-volume-baselines.sqlite3'));
        const apiPort = createDynamicDailyBaselineApiPort({ now: () => now().toISOString() });
        const ports = createScreenerBrokerPorts({ db, root, now, usageCacheMs: 5000 });
        const safety = await ports.safety(), source = await apiPort.preflight(), usage = await ports.observeUsage();
        if (safety.simulation !== true || safety.generation !== generation || source.simulation !== true ||
            source.sourceVersion !== prior.sourceVersion) throw new Error('interruption_recovery_source_changed');
        const originals = [];
        for (const entry of cohort.cohort) {
            if (repository.hasConflict(entry.canonicalSymbol, sourceTradeDate)) throw new Error('interruption_recovery_manifest_conflict');
            const manifest = repository.latestForSymbolDate(entry.canonicalSymbol, entry.contractIdentity.exchange, sourceTradeDate, claim.targetDate);
            if (manifest) {
                if (manifest.sourceVersion !== source.sourceVersion || manifest.calendarReference?.sourceVersion !== calendar.sourceVersion)
                    throw new Error('interruption_recovery_manifest_identity_changed');
                originals.push({ symbol: entry.canonicalSymbol, exchange: entry.contractIdentity.exchange,
                    hash: hash(JSON.stringify(manifest)) });
            }
        }
        const missing = 160 - originals.length;
        const maxRequests = Math.min(mode.limits.maxRequests, missing * 2);
        if (missing < 1) throw new Error('interruption_recovery_no_work');
        const operatorClaim = {
            schemaVersion: 'daily-minute-volume-interruption-recovery/1', originTrigger: 'operator',
            reason: 'host_reboot_interrupted_native_collection', ownerPid: process.pid,
            startedAt: started.toISOString(), bootAt, parentClaimPath: claimPath, parentClaimHash: hash(claimBytes),
            parentReceiptHash: hash(priorBytes), sourceTradeDate, targetTradeDate: claim.targetDate,
            connectionGeneration: generation, originals, missingCount: missing, maxRequests, deadlineAt,
            usage, quoteReserveBytes: policy.budgetPolicy.quoteReserveBytes,
            brokerWriteAuthority: false, notificationAuthority: false };
        let admission = ports.admission, attempt = 1;
        if (resumeConservative) {
            const saved = JSON.parse(await readFile(path.join(recoveryRoot, 'operator-claim.json')));
            const stopped = JSON.parse(await readFile(path.join(recoveryRoot, 'IntradayMonitor',
                'daily-minute-volume-collection', sourceTradeDate, 'attempt-01-receipt.json')));
            if (saved.parentClaimHash !== hash(claimBytes) || saved.connectionGeneration !== generation ||
                saved.deadlineAt !== deadlineAt || JSON.stringify(saved.originals) !== JSON.stringify(originals) ||
                stopped.outcome !== 'partial' || stopped.requests !== 0 || stopped.stoppedReason !== 'broker_budget_pending')
                throw new Error('interruption_recovery_resume_invalid');
            await absent(path.join(recoveryRoot, 'IntradayMonitor', 'daily-minute-volume-collection', sourceTradeDate, 'attempt-02-claim.json'));
            await immutable(path.join(recoveryRoot, 'operator-conservative-resume-claim.json'), {
                ...operatorClaim, reason: 'same_epoch_usage_carry_without_quota_reset', attempt: 2,
                preservesFirstRecoveryReceipt: true, cooldownUntil: new Date(Date.parse(stopped.completedAt) + mode.limits.cooldownMs).toISOString() });
            admission = await createInterruptionConservativeAdmission({ db, root, recoveryRoot,
                generation, ports, now });
            const due = Date.parse(stopped.completedAt) + mode.limits.cooldownMs;
            while (now().getTime() < due) await new Promise(resolve => setTimeout(resolve, Math.min(60_000, due - now().getTime())));
            attempt = 2;
        } else await immutable(path.join(recoveryRoot, 'operator-claim.json'), operatorClaim);
        onProgress({ phase: 'started', recoveryRoot, readyCount: originals.length, missingCount: missing, maxRequests, deadlineAt });
        const cache = createDailyMinuteVolumeContractCache(root);
        const collector = createDailyMinuteVolumeCollector({ apiPort, admission, repository,
            now: () => now().toISOString(), ...cache });
        const receipt = await collector.collect({ root: recoveryRoot, entries: cohort.cohort,
            calendar, sourceVersion: source.sourceVersion, connectionGeneration: generation, attempt,
            limits: { ...mode.limits, maxRequests, maxAttempts: attempt, deadlineAt } });
        for (const original of originals) {
            if (hash(JSON.stringify(repository.latestForSymbolDate(original.symbol, original.exchange,
                sourceTradeDate, claim.targetDate))) !== original.hash) throw new Error('interruption_recovery_original_changed');
        }
        if (hash(await readFile(claimPath)) !== hash(claimBytes) || hash(await readFile(priorPath)) !== hash(priorBytes))
            throw new Error('interruption_recovery_parent_changed');
        await absent(path.join(nativeDir, 'attempt-02-receipt.json'));
        const manifests = repository.listForTargetTradeDate(claim.targetDate).filter(row => row.tradeDate === sourceTradeDate);
        const final = { schemaVersion: 'daily-minute-volume-interruption-recovery/1', originTrigger: 'operator',
            completedAt: now().toISOString(), sourceTradeDate, targetTradeDate: claim.targetDate,
            outcome: receipt.outcome, readyCount: manifests.length, originalManifestsUnchanged: true,
            originalInterruptedReceiptStillAbsent: true, parentClaimHash: hash(claimBytes),
            requestCount: receipt.requests, responseBytes: receipt.responseBytes,
            collectionReceipt: path.join(recoveryRoot, 'IntradayMonitor', 'daily-minute-volume-collection',
                sourceTradeDate, `attempt-0${attempt}-receipt.json`), brokerWriteAuthority: false, notificationAuthority: false };
        await immutable(path.join(recoveryRoot, attempt === 1 ? 'operator-receipt.json' : 'operator-attempt-02-receipt.json'), final);
        onProgress({ phase: 'finished', recoveryRoot, ...final });
        return final;
    } finally { repository?.close(); db?.close(); }
}
