/** 原 3 次正式嘗試已因本機預算錯配耗盡時，由操作者明確啟動一次有界補件。 */
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readDailyMinuteVolumeMode, runDailyMinuteVolumePostclose }
    from './daily-minute-volume-postclose.mjs';
import { resolvePostcloseBaselineCalendar } from './postclose-daily-baseline.mjs';
import { ScreenerSqlite } from '../stock-screener-sqlite.mjs';

const dateInTaipei = now => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei',
    year:'numeric', month:'2-digit', day:'2-digit' }).format(now);

async function recover({ root, sourceTradeDate,
    now = () => new Date(), fetchImpl = fetch,
    resolveCalendar = resolvePostcloseBaselineCalendar,
    run = runDailyMinuteVolumePostclose,
    databaseFactory = file => new ScreenerSqlite(file), repairEarlyWake = false } = {}) {
    const started = now();
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(sourceTradeDate ?? '') ||
        sourceTradeDate !== dateInTaipei(started) ||
        started.getTime() < Date.parse(`${sourceTradeDate}T13:35:00+08:00`) ||
        started.getTime() >= Date.parse(`${sourceTradeDate}T20:00:00+08:00`)) {
        throw new Error('daily_collection_recovery_window_invalid');
    }
    const mode = await readDailyMinuteVolumeMode(root);
    if (mode.mode !== 'daily' || mode.limits.maxAttempts !== 3) {
        throw new Error('daily_collection_recovery_mode_invalid');
    }
    try {
        await lstat(path.join(root,'direct-160-live','registry','active.lock'));
        throw new Error('daily_collection_recovery_active_owner');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const directory = path.join(root,'IntradayMonitor','daily-minute-volume-collection',sourceTradeDate);
    const receipts = [];
    for (let attempt=1;attempt<=(repairEarlyWake ? 4 : 3);attempt+=1) {
        const receipt = JSON.parse(await readFile(path.join(directory,
            `attempt-0${attempt}-receipt.json`),'utf8'));
        if (receipt.schemaVersion !== 'intraday-minute-volume-collection/2' ||
            receipt.sourceDate !== sourceTradeDate || receipt.attempt !== attempt ||
            receipt.outcome !== 'partial' || receipt.waitingCount < 1 ||
            receipt.conflictCount !== 0 || !Array.isArray(receipt.results) ||
            receipt.results.length !== 160 ||
            receipt.readyCount + receipt.waitingCount + receipt.conflictCount !== 160) {
            throw new Error('daily_collection_recovery_receipt_invalid');
        }
        receipts.push(receipt);
    }
    const prior = receipts.at(-1);
    if (receipts[2].stoppedReason !== 'broker_budget_or_rate_denied' ||
        (repairEarlyWake && (prior.waitingCount > 10 ||
            prior.results.filter(row => row.state === 'waiting').some(row =>
                row.reason !== 'daily_collection_cooldown_clock_not_advanced'))) ||
        started.getTime() < Date.parse(prior.completedAt) + mode.limits.cooldownMs ||
        receipts.some(receipt => receipt.targetDate !== receipts[2].targetDate ||
            receipt.calendarVersion !== receipts[2].calendarVersion ||
            receipt.sourceVersion !== receipts[2].sourceVersion ||
            receipt.connectionGeneration !== receipts[2].connectionGeneration)) {
        throw new Error('daily_collection_recovery_receipt_invalid');
    }
    const db=databaseFactory(mode.screenerDatabasePath);
    try {
        const policy=JSON.parse((await db.prepare(`SELECT checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first())?.checkpoint ?? 'null');
        if (policy?.version !== 4 || policy.consumerObservationMode !== 'daily-baseline-allocation-v1' ||
            policy.budgetPolicy?.quoteReserveBytes < 300*1024**2) {
            throw new Error('daily_collection_recovery_policy_invalid');
        }
        const active=await db.prepare(`SELECT COUNT(*) n FROM broker_bandwidth_reservations
            WHERE status IN ('reserved','dispatched')`).first();
        if (active?.n !== 0) throw new Error('daily_collection_recovery_active_reservation');
    } finally { db.close(); }
    const generation=(await readFile(path.join(root,'runtime-api-generation'),'utf8')).trim();
    if (generation !== receipts[2].connectionGeneration ||
        (await readFile(path.join(root,'runtime-mode'),'utf8')).trim() !== 'simulation') {
        throw new Error('daily_collection_recovery_generation_changed');
    }
    const calendar=await resolveCalendar({ now:started, fetchImpl, sourceTradeDate });
    if (calendar.targetTradeDate !== receipts[2].targetDate ||
        calendar.calendarSourceVersion !== receipts[2].calendarVersion) {
        throw new Error('daily_collection_recovery_calendar_changed');
    }
    // 原模式檔與舊收據都不修改；新 claim/receipt 由原 collector 以 wx 保存。
    const recoveredMode={ ...mode, limits:{ ...mode.limits,
        maxAttempts:repairEarlyWake ? 5 : 4,
        maxRequests:Math.min(mode.limits.maxRequests,repairEarlyWake ? 20 : 120),
        deadlineTime:'20:00:00' } };
    return run({ root, mode:recoveredMode, sourceTradeDate, calendar,
        connectionGeneration:generation, attempt:repairEarlyWake ? 5 : 4,
        now:()=>new Date().toISOString(), fetchImpl });
}

export const recoverDailyMinuteVolumeAfterBudgetCorrection = options =>
    recover({ ...options, repairEarlyWake:false });

/** 僅修復第 4 次收據所列的短暫提早喚醒；保留原 4 次與 15 分鐘冷卻。 */
export const recoverDailyMinuteVolumeAfterEarlyWake = options =>
    recover({ ...options, repairEarlyWake:true });
