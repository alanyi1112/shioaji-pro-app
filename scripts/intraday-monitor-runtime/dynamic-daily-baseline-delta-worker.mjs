import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { baselineCalendar, verifyDirect160HistoricalSymbol } from './direct-160-baseline.mjs';
import { dynamicDailySymbolBaselineCohortHash } from './dynamic-daily-baseline-resolver.mjs';
import { validateDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { checkDynamicBaselineDeltaProgress, isIssuedDynamicBaselineDeltaBudget,
    DYNAMIC_BASELINE_DELTA_BUDGET_SCHEMA } from './dynamic-baseline-delta-budget.mjs';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';
import { DYNAMIC_DAILY_SESSION_PROOF_SCHEMA } from './dynamic-daily-session-proof.mjs';

export const DYNAMIC_DAILY_DELTA_RUN_SCHEMA = 'intraday-monitor-daily-baseline-delta-run/1';
const MAX_REQUEST_MS = 20_000;
const MAX_SYMBOLS = 160;

function hash(body) {
    return createHash('sha256').update(canonicalJson(body, { maximumBytes: 1024 * 1024 })).digest('hex');
}

function safeReason(error) {
    const raw = String(error?.code ?? error?.message ?? 'baseline_source_failed');
    return /^[a-z0-9_]{1,64}$/.test(raw) ? raw : 'baseline_source_failed';
}

async function writeExclusiveJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const raw = `${canonicalJson(value, { maximumBytes: 1024 * 1024 })}\n`;
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
        try { await handle.writeFile(raw); await handle.sync(); }
        finally { await handle.close(); }
        try { await link(temporary, file); }
        catch (error) {
            if (error?.code !== 'EEXIST' || await readFile(file, 'utf8') !== raw) throw error;
        }
    } finally { await unlink(temporary).catch(() => {}); }
    return file;
}

async function callBounded(provider, request, remainingMs) {
    const controller = new AbortController();
    const timeoutMs = Math.min(MAX_REQUEST_MS, remainingMs);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('baseline_deadline_exceeded');
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => provider(Object.freeze({ ...request,
                signal: controller.signal }))),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error('baseline_provider_timeout'));
                }, timeoutMs);
                timer.unref?.();
            }),
        ]);
    } finally { if (timer) clearTimeout(timer); }
}

// provider 只能接既有 simulation business session 的唯讀資料 API；本元件不登入、開 SSE 或下單。
export function createDynamicDailyBaselineDeltaWorker({ readUsage, fetchContract,
    fetchKbars, fetchTicks, now = () => new Date().toISOString() } = {}) {
    if (![readUsage, fetchContract, fetchKbars, fetchTicks, now]
        .every((value) => typeof value === 'function')) {
        throw new TypeError('daily_delta_worker_provider_invalid');
    }

    async function run({ root, plan, coverage, calendar, budget,
        sourceVersion, sessionProof } = {}) {
        if (!path.isAbsolute(root ?? '') || !validateDynamicDailyCohortPlan(plan) ||
            coverage?.planHash !== plan.planHash ||
            coverage.tradeDate !== plan.tradeDate ||
            coverage.previousTradeDate !== plan.previousTradeDate ||
            !Array.isArray(coverage.items) || coverage.items.length !== plan.selected.length ||
            calendar?.previousTradeDate !== plan.previousTradeDate ||
            calendar.targetTradeDate !== plan.tradeDate ||
            !plan.calendarSourceVersions.includes(calendar.sourceVersion) ||
            !isIssuedDynamicBaselineDeltaBudget(budget) ||
            budget.schemaVersion !== DYNAMIC_BASELINE_DELTA_BUDGET_SCHEMA ||
            budget.tradeDate !== plan.tradeDate || budget.ready !== true ||
            sessionProof?.schemaVersion !== DYNAMIC_DAILY_SESSION_PROOF_SCHEMA ||
            sessionProof.simulation !== true || sessionProof.businessSessionCurrent !== true ||
            ![plan.previousTradeDate, plan.tradeDate].includes(sessionProof.snapshotTradeDate) ||
            !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(sessionProof.connectionGeneration ?? '') ||
            sessionProof.sourceVersion !== sourceVersion ||
            !Number.isFinite(Date.parse(sessionProof.observedAt ?? '')) ||
            Date.parse(sessionProof.observedAt) >= Date.parse(budget.deadlineAt) ||
            typeof sourceVersion !== 'string' || sourceVersion.length < 1 ||
            sourceVersion.length > 128) {
            throw new TypeError('daily_delta_worker_input_invalid');
        }
        const official = baselineCalendar(calendar.twse, calendar.tpex,
            plan.previousTradeDate, plan.tradeDate, calendar.fetchedAtEpochMs);
        if (official.sourceVersion !== calendar.sourceVersion) {
            throw new TypeError('daily_delta_calendar_source_mismatch');
        }
        const missing = plan.selected.filter((entry, index) =>
            coverage.items[index]?.canonicalSymbol === entry.canonicalSymbol &&
            coverage.items[index].state === 'waiting_baseline' &&
            coverage.items[index].reason === 'baseline_missing');
        if (missing.length < 1 || missing.length > MAX_SYMBOLS ||
            missing.length !== budget.addedSymbolCount) {
            throw new TypeError('daily_delta_worker_missing_set_invalid');
        }
        const checkedAt = now();
        if (!Number.isFinite(Date.parse(checkedAt)) ||
            Date.parse(checkedAt) < Date.parse(`${plan.previousTradeDate}T13:34:30+08:00`) ||
            Date.parse(checkedAt) >= Date.parse(budget.deadlineAt)) {
            throw new Error('baseline_deadline_exceeded');
        }
        const directory = path.join(root, 'IntradayMonitor', 'daily-baseline-delta',
            plan.tradeDate, plan.planHash);
        const claimPath = path.join(directory, 'claim.json');
        const claim = { schemaVersion: DYNAMIC_DAILY_DELTA_RUN_SCHEMA,
            planHash: plan.planHash, tradeDate: plan.tradeDate,
            previousTradeDate: plan.previousTradeDate, configRevision: plan.configRevision,
            claimedAt: checkedAt, requestedSymbols: missing.map((entry) => entry.canonicalSymbol),
            simulation: true, brokerWriteAuthority: false, productionAuthority: false,
            serviceLifecycleAuthority: false, notificationAuthority: false };
        // claim 只能第一次建立；既有 claim（包括沒有 receipt 的中斷）不得重送 provider 請求。
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const claimFile = await open(claimPath, 'wx', 0o600).catch((error) => {
            if (error?.code === 'EEXIST') throw new Error('daily_delta_already_claimed');
            throw error;
        });
        try { await claimFile.writeFile(`${canonicalJson(claim)}\n`); await claimFile.sync(); }
        finally { await claimFile.close(); }

        const results = [];
        let stoppedReason = null;
        const inspectBudget = async (responseBytes = 0) => {
            let usage;
            try { usage = await readUsage(); }
            catch { throw new Error('budget_progress_unverifiable'); }
            const check = checkDynamicBaselineDeltaProgress({ budget, usage,
                observedAt: now(), responseBytes });
            if (!check.allowed) throw new Error(check.reason);
            return check;
        };
        const request = async (provider, entry, kind, ordinal = null) => {
            await inspectBudget();
            const remainingMs = Date.parse(budget.deadlineAt) - Date.parse(now());
            const answer = await callBounded(provider, { tradeDate: plan.previousTradeDate,
                targetTradeDate: plan.tradeDate, canonicalSymbol: entry.canonicalSymbol,
                exchange: entry.exchange, code: entry.canonicalSymbol.split('.')[0],
                kind, ordinal, simulation: true, providerRequestAuthority: true,
                brokerWriteAuthority: false, productionAuthority: false,
                serviceLifecycleAuthority: false }, remainingMs);
            if (!answer || typeof answer !== 'object' ||
                !Number.isSafeInteger(answer.responseBytes) || answer.responseBytes < 0 ||
                answer.value === undefined) throw new Error('baseline_provider_response_invalid');
            await inspectBudget(answer.responseBytes);
            return answer.value;
        };
        try {
            for (const entry of missing) {
                if (stoppedReason) {
                    results.push({ canonicalSymbol: entry.canonicalSymbol, outcome: 'not_attempted',
                        reason: stoppedReason, manifestId: null, sealedAt: null });
                    continue;
                }
                try {
                    const contract = await request(fetchContract, entry, 'contract_info');
                    const first = await request(fetchKbars, entry, 'historical_1m_kbars', 1);
                    const second = await request(fetchKbars, entry, 'historical_1m_kbars', 2);
                    const ticks = await request(fetchTicks, entry, 'regular_session_ticks');
                    const cohortHash = dynamicDailySymbolBaselineCohortHash({
                        tradeDate: plan.tradeDate,
                        previousTradeDate: plan.previousTradeDate,
                        canonicalSymbol: entry.canonicalSymbol, exchange: entry.exchange }).slice(7);
                    const manifest = verifyDirect160HistoricalSymbol({ entry: {
                        canonicalSymbol: entry.canonicalSymbol,
                        contractIdentity: { security_type: 'STK', region: 'TW',
                            exchange: entry.exchange, code: entry.canonicalSymbol.split('.')[0],
                            target_code: null },
                    }, cohortHash, contract, first, second, ticks, calendar,
                    sourceVersion, now: now() });
                    if (!isHistoricalKbarBaselineManifest(manifest)) {
                        throw new Error('baseline_manifest_invalid');
                    }
                    const manifestPath = path.join(directory, 'manifests',
                        `${entry.canonicalSymbol}-${manifest.manifestId.slice(7)}.json`);
                    await writeExclusiveJson(manifestPath, manifest);
                    const sealedAt = now();
                    const sourceReceipt = { schemaVersion: 'intraday-monitor-daily-symbol-baseline-receipt/1',
                        tradeDate: plan.tradeDate, previousTradeDate: plan.previousTradeDate,
                        canonicalSymbol: entry.canonicalSymbol, manifestId: manifest.manifestId,
                        sourceHash: manifest.manifestId, sealedAt,
                        minuteCount: manifest.cumulativeSeries.length,
                        finalVolumeMatched: manifest.finalVolumeReconciliation.matched,
                        notificationAuthority: false, retroactiveAuthority: false };
                    await writeExclusiveJson(path.join(directory, 'symbol-receipts',
                        `${entry.canonicalSymbol}-${hash(sourceReceipt)}.json`),
                    { ...sourceReceipt, receiptHash: hash(sourceReceipt) });
                    results.push({ canonicalSymbol: entry.canonicalSymbol, outcome: 'verified',
                        reason: null, manifestId: manifest.manifestId, sealedAt,
                        sourceHash: manifest.manifestId, manifestPath });
                } catch (error) {
                    const reason = safeReason(error);
                    results.push({ canonicalSymbol: entry.canonicalSymbol, outcome: 'failed',
                        reason, manifestId: null, sealedAt: null });
                    if (reason.startsWith('provider_bandwidth_') ||
                        reason === 'baseline_deadline_exceeded' ||
                        reason === 'budget_progress_unverifiable' ||
                        reason === 'baseline_provider_timeout') stoppedReason = reason;
                }
            }
        } finally {
            const body = { schemaVersion: DYNAMIC_DAILY_DELTA_RUN_SCHEMA,
                tradeDate: plan.tradeDate, previousTradeDate: plan.previousTradeDate,
                planHash: plan.planHash, configRevision: plan.configRevision,
                startedAt: checkedAt, endedAt: now(),
                requestedCount: missing.length,
                verifiedCount: results.filter((item) => item.outcome === 'verified').length,
                outcome: results.length === missing.length &&
                    results.every((item) => item.outcome === 'verified') ? 'verified' : 'failed',
                results, stoppedReason,
                notificationAuthority: false, retroactiveAuthority: false,
                brokerWriteAuthority: false, productionAuthority: false,
                serviceLifecycleAuthority: false };
            await writeExclusiveJson(path.join(directory, 'run-receipt.json'),
                { ...body, receiptHash: hash(body) });
        }
        return Object.freeze({ claimPath, receiptPath: path.join(directory, 'run-receipt.json'),
            results: Object.freeze(results),
            verifiedCount: results.filter((item) => item.outcome === 'verified').length,
            outcome: results.every((item) => item.outcome === 'verified') ? 'verified' : 'failed' });
    }

    return Object.freeze({ run });
}
