import { assertNoSpecialMarketClosure } from './special-market-closures.mjs';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { baselineCalendar } from './direct-160-baseline.mjs';
import { createDailyMinuteVolumeCandidate, DAILY_KBAR_TIMESTAMP_ENCODING,
    verifyDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';

export const DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA = 'intraday-minute-volume-collection/2';
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const safe = value => Number.isSafeInteger(value) && value >= 0;
const reason = error => /^[a-z0-9_]{1,80}$/.test(error?.message ?? '') ? error.message :
    'daily_minute_volume_source_failed';

async function exclusiveJson(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
}
async function optionalJson(file) {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
function validateEntry(entry) {
    const contract = entry?.contractIdentity;
    const suffix = contract?.exchange === 'TSE' ? 'TW' : 'TWO';
    return contract?.security_type === 'STK' && contract.region === 'TW' &&
        ['TSE', 'OTC'].includes(contract.exchange) &&
        /^\d{4,6}[A-Z]?$/.test(contract.code) && contract.target_code === null &&
        entry.canonicalSymbol === `${contract.code}.${suffix}`;
}

// The admission port is the shared, persistent broker quota authority. This worker cannot
// self-authorize HTTP requests or synthesize provider usage/reset evidence.
export function createDailyMinuteVolumeCollector({ apiPort, admission, repository,
    now = () => new Date().toISOString(), readCachedContract = async () => null,
    writeCachedContract = async () => {},
    onReceipt = async () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (![apiPort?.fetchContract, apiPort?.fetchKbars, admission?.reserve,
        admission?.start, admission?.settle, repository?.latestForSymbolDate,
        repository?.putManifest, repository?.currentRevision, repository?.hasConflict,
        now, readCachedContract, writeCachedContract, onReceipt, wait]
        .every(value => typeof value === 'function')) {
        throw new TypeError('daily_minute_volume_collector_port_invalid');
    }

    async function request(kind, entry, generation, tradeDate, deadlineAt, limits, counters, closureContext) {
        assertNoSpecialMarketClosure({ ...closureContext, now: new Date(now()) });
        if (Date.parse(now()) >= Date.parse(deadlineAt)) throw new Error('daily_collection_deadline_exceeded');
        if (counters.requests >= limits.maxRequests) throw new Error('daily_collection_request_limit');
        const cacheKey = `monitor-minute-v2:${tradeDate}:${entry.canonicalSymbol}:${kind}`;
        let reservation;
        for (;;) {
            assertNoSpecialMarketClosure({ ...closureContext, now: new Date(now()) });
            reservation = await admission.reserve({ cacheKey, generation });
            if (reservation?.allowed === true && reservation.reservationId) break;
            const waitingUntil = Date.parse(reservation?.nextAttemptAt ?? '');
            const current = Date.parse(now());
            if (reservation?.reason !== 'broker_rate_limited' ||
                !Number.isFinite(waitingUntil) || waitingUntil <= current ||
                waitingUntil >= Date.parse(deadlineAt) ||
                counters.rateWaits >= limits.maxRequests) {
                throw new Error(reservation?.reason ?? 'broker_budget_pending');
            }
            counters.rateWaits += 1;
            counters.rateWaitMs += waitingUntil - current;
            await wait(waitingUntil - current);
            // setTimeout may resume a millisecond before an ISO deadline. Retry
            // that small remainder, but never spin on an injected/stuck clock.
            let observed = Date.parse(now());
            for (let correction = 0; observed < waitingUntil && correction < 3; correction += 1) {
                if (observed <= current || waitingUntil - observed > 1_000) {
                    throw new Error('daily_collection_cooldown_clock_not_advanced');
                }
                const previous = observed;
                await wait(waitingUntil - observed);
                observed = Date.parse(now());
                if (observed <= previous) {
                    throw new Error('daily_collection_cooldown_clock_not_advanced');
                }
            }
            if (observed < waitingUntil) throw new Error('daily_collection_cooldown_clock_not_advanced');
        }
        let requested = 0, responseBytes = null;
        try {
            assertNoSpecialMarketClosure({ ...closureContext, now: new Date(now()) });
            await admission.start({ reservationId: reservation.reservationId });
            assertNoSpecialMarketClosure({ ...closureContext, now: new Date(now()) });
            requested = 1;
            counters.requests += 1;
            const controller = new AbortController();
            const timeout = Math.min(limits.requestTimeoutMs,
                Date.parse(deadlineAt) - Date.parse(now()));
            if (timeout < 1) throw new Error('daily_collection_deadline_exceeded');
            let timer;
            try {
                const input = { canonicalSymbol: entry.canonicalSymbol,
                    exchange: entry.contractIdentity.exchange,
                    code: entry.contractIdentity.code, tradeDate, signal: controller.signal };
                // AbortSignal alone is insufficient if an injected/local transport ignores it.
                const answer = await Promise.race([
                    kind === 'contract' ? apiPort.fetchContract(input) : apiPort.fetchKbars(input),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            controller.abort();
                            reject(new Error('daily_collection_request_timeout'));
                        }, timeout);
                    }),
                ]);
                if (answer?.value === undefined || !safe(answer.responseBytes) ||
                    answer.responseBytes > limits.maxResponseBytes) {
                    throw new Error('daily_collection_response_invalid');
                }
                responseBytes = answer.responseBytes;
                counters.responseBytes += responseBytes;
                return answer.value;
            } finally { clearTimeout(timer); }
        } finally {
            await admission.settle({ reservationId: reservation.reservationId,
                requested, responseBytes });
        }
    }

    async function collect({ root, entries, calendar, sourceVersion, connectionGeneration,
        limits, attempt = 1, finalVolumeAuthorities = new Map() } = {}) {
        if (!path.isAbsolute(root ?? '') || !Array.isArray(entries) || entries.length < 1 ||
            entries.length > 160 || entries.some(entry => !validateEntry(entry)) ||
            new Set(entries.map(entry => entry.canonicalSymbol)).size !== entries.length ||
            !iso(now()) || !iso(limits?.deadlineAt) ||
            !Number.isSafeInteger(limits?.maxRequests) || limits.maxRequests < 1 ||
            !Number.isSafeInteger(limits?.maxResponseBytes) || limits.maxResponseBytes < 1 ||
            !Number.isSafeInteger(limits?.requestTimeoutMs) || limits.requestTimeoutMs < 1 ||
            !Number.isSafeInteger(limits?.maxAttempts) || limits.maxAttempts < 1 ||
            !Number.isSafeInteger(limits?.cooldownMs) || limits.cooldownMs < 0 ||
            !Number.isSafeInteger(attempt) || attempt < 1 || attempt > limits.maxAttempts ||
            typeof sourceVersion !== 'string' || sourceVersion.length < 1 ||
            !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(connectionGeneration ?? '') ||
            !(finalVolumeAuthorities instanceof Map)) {
            throw new TypeError('daily_minute_volume_collection_input_invalid');
        }
        const sourceDate = calendar?.previousTradeDate;
        const targetDate = calendar?.targetTradeDate;
        const closureContext = { root, dates: [sourceDate, targetDate] };
        assertNoSpecialMarketClosure({ ...closureContext, now: new Date(now()) });
        const verifiedCalendar = baselineCalendar(calendar?.twse, calendar?.tpex,
            sourceDate, targetDate, calendar?.fetchedAtEpochMs);
        if (verifiedCalendar.sourceVersion !== calendar?.sourceVersion ||
            Date.parse(now()) < Date.parse(`${sourceDate}T13:34:30+08:00`) ||
            Date.parse(now()) >= Date.parse(`${targetDate}T09:01:00+08:00`)) {
            throw new Error('daily_collection_calendar_or_time_invalid');
        }
        const directory = path.join(root, 'IntradayMonitor', 'daily-minute-volume-collection', sourceDate);
        const prefix = `attempt-${String(attempt).padStart(2, '0')}`;
        const receiptPath = path.join(directory, `${prefix}-receipt.json`);
        const completed = await optionalJson(receiptPath);
        if (completed) {
            if (completed.schemaVersion !== DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA ||
                completed.sourceDate !== sourceDate || completed.targetDate !== targetDate ||
                completed.attempt !== attempt ||
                completed.sourceVersion !== sourceVersion ||
                completed.calendarVersion !== verifiedCalendar.sourceVersion ||
                completed.connectionGeneration !== connectionGeneration ||
                completed.results?.length !== entries.length ||
                completed.results.some((row, index) => row.symbol !== entries[index].canonicalSymbol)) {
                throw new Error('daily_collection_receipt_identity_conflict');
            }
            return { ...completed, alreadyPresent: true };
        }
        const prior = attempt > 1 ? await optionalJson(path.join(directory,
            `attempt-${String(attempt - 1).padStart(2, '0')}-receipt.json`)) : null;
        if (attempt > 1 && (!prior || prior.outcome === 'complete' ||
            Date.parse(now()) < Date.parse(prior.completedAt) + limits.cooldownMs)) {
            throw new Error('daily_collection_retry_not_due');
        }
        const claimPath = path.join(directory, `${prefix}-claim.json`);
        const claim = { schemaVersion: DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA,
            sourceDate, targetDate, attempt, claimId: randomUUID(), claimedAt: now(),
            ownerPid: process.pid,
            connectionGeneration, calendarVersion: verifiedCalendar.sourceVersion,
            requestedSymbols: entries.map(entry => entry.canonicalSymbol),
            simulation: true, brokerWriteAuthority: false, notificationAuthority: false };
        await exclusiveJson(claimPath, claim);
        const counters = { requests: 0, responseBytes: 0, rateWaits: 0, rateWaitMs: 0 };
        const results = [];
        let stoppedReason = null;
        try {
            for (const entry of entries) {
                const symbol = entry.canonicalSymbol;
                const exchange = entry.contractIdentity.exchange;
                if (repository.hasConflict(symbol, sourceDate)) {
                    results.push({ symbol, state: 'conflict', reason: 'baseline_source_conflict' });
                    continue;
                }
                const existing = repository.latestForSymbolDate(symbol, exchange, sourceDate, targetDate);
                if (existing) {
                    if (existing.sourceVersion !== sourceVersion ||
                        existing.calendarReference?.sourceVersion !== verifiedCalendar.sourceVersion) {
                        results.push({ symbol, state: 'conflict',
                            reason: 'cached_baseline_authority_changed' });
                    } else {
                        results.push({ symbol, state: 'ready', source: 'cached_manifest',
                            manifestId: existing.manifestId });
                    }
                    continue;
                }
                if (stoppedReason) {
                    results.push({ symbol, state: 'waiting', reason: stoppedReason });
                    continue;
                }
                try {
                    const cached = await readCachedContract({ entry, sourceDate,
                        sourceVersion, connectionGeneration });
                    const reusable = cached?.identityVerified === true &&
                        cached.tradeDate === sourceDate && cached.sourceVersion === sourceVersion &&
                        cached.connectionGeneration === connectionGeneration &&
                        cached.value?.code === entry.contractIdentity.code &&
                        cached.value?.exchange === exchange &&
                        cached.value?.security_type === 'STK' &&
                        cached.value?.region === 'TW' &&
                        cached.value?.unit === 1000 &&
                        cached.value?.trading_suspended === false &&
                        cached.value?.update_date === sourceDate;
                    const contract = reusable ? cached.value :
                        await request('contract', entry, connectionGeneration, sourceDate,
                            limits.deadlineAt, limits, counters, closureContext);
                    if (!reusable) await writeCachedContract({ entry, tradeDate: sourceDate,
                        sourceVersion, connectionGeneration, value: contract });
                    const bars = await request('kbars', entry, connectionGeneration, sourceDate,
                        limits.deadlineAt, limits, counters, closureContext);
                    const candidate = createDailyMinuteVolumeCandidate({ entry, contract,
                        kbars: bars, tradeDate: sourceDate, sourceVersion,
                        timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING });
                    const authority = { officialTradingDay: true, identityVerified: true,
                        instrumentStatus: 'normal', calendarVerified: true,
                        symbol, exchange, securityType: 'STK', tradeDate: sourceDate,
                        previousApplicableTradeDate: sourceDate, targetTradeDate: targetDate,
                        timeZone: 'Asia/Taipei',
                        calendarSource: 'TWSE and TPEx official annual calendars',
                        calendarSourceVersion: verifiedCalendar.sourceVersion };
                    const validation = verifyDailyMinuteVolumeBaseline({ candidate, authority,
                        finalVolumeAuthority: finalVolumeAuthorities.get(symbol) ?? null, now: now() });
                    if (!validation.ok) throw new Error(validation.reasonCodes[0]);
                    const saved = repository.putManifest(validation.manifest,
                        repository.currentRevision());
                    results.push({ symbol, state: 'ready', source: 'single_kbar',
                        manifestId: saved.manifestId,
                        closeTotalCheck: validation.manifest.validationChecks.closeTotalCheck });
                } catch (error) {
                    const failure = reason(error);
                    results.push({ symbol, state: 'waiting', reason: failure });
                    if (/^(?:broker_|daily_collection_deadline|daily_collection_request_limit)/.test(failure)) {
                        stoppedReason = failure;
                    }
                }
            }
        } finally {
            const receipt = { schemaVersion: DAILY_MINUTE_VOLUME_COLLECTION_SCHEMA,
                sourceDate, targetDate, attempt, claimId: claim.claimId,
                connectionGeneration, sourceVersion,
                calendarVersion: verifiedCalendar.sourceVersion,
                completedAt: now(), outcome: results.every(row => row.state === 'ready') ?
                    'complete' : 'partial', readyCount: results.filter(row => row.state === 'ready').length,
                waitingCount: results.filter(row => row.state === 'waiting').length,
                conflictCount: results.filter(row => row.state === 'conflict').length,
                requests: counters.requests, responseBytes: counters.responseBytes,
                rateWaits: counters.rateWaits, rateWaitMs: counters.rateWaitMs,
                stoppedReason, results,
                brokerWriteAuthority: false, notificationAuthority: false,
                liveCaptureAcceptance: false };
            await exclusiveJson(receiptPath, receipt);
            await onReceipt(receipt);
        }
        return optionalJson(receiptPath);
    }
    return Object.freeze({ collect });
}
