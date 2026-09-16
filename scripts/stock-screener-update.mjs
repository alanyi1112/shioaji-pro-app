#!/usr/bin/env node
/** Local operator; only additive screener tables. No service, broker or long-history writes. */
import { pathToFileURL } from 'node:url';
import { collectScreenerData, readLocalScreenerHolders } from '../apps/multiview/worker/stock-screener-collector.ts';
import { parseDailyVolumes, parseHolderBatch } from '../apps/multiview/worker/stock-screener-sources.ts';
import { publishCollectedScreener } from '../apps/multiview/worker/stock-screener-publisher.ts';
import { readScreenerSnapshot } from '../apps/multiview/worker/stock-screener-repository.ts';
import { ScreenerSqlite } from './stock-screener-sqlite.mjs';
import { boundedOfficialText, discoverScreenerPeriods, hashText, screenerTdccSession } from './stock-screener-periods.mjs';
import { preparePinnedTdccBootstrap } from './stock-screener-tdcc-bootstrap.mjs';
import { prepareScreenerOhlcv, prepareScreenerOhlcvV4, pruneScreenerOhlcv, pruneScreenerOhlcvV4,
    selectOhlcvSessions, selectOhlcvV4Sessions } from './stock-screener-ohlcv-bootstrap.mjs';
import { publishPreparedScreenerV3 } from '../apps/multiview/worker/stock-screener-v3-publisher.ts';
import { publishPreparedScreenerV4 } from '../apps/multiview/worker/stock-screener-v4-publisher.ts';
import { updateScreenerChip } from './stock-screener-chip-update.mjs';
import { screenerIdleGate } from './screener-idle-gate.mjs';
import { consumeInvalidSessionRecovery } from './screener-session-recovery.mjs';
import {
    normalizeScreenerSessionReadiness, parseScreenerSessionReadiness, publicationProbeDecision,
    recordScreenerPublicationProbe, resolveScreenerSessionTarget, screenerReadinessReason,
    SCREENER_POST_CLOSE_PROBE_MINUTES, SCREENER_SESSION_READINESS_ID,
} from '../src/lib/stock-screener-session-readiness.ts';

const NORMALIZATION = 'screener-official-v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();
const safeError = error => /^(source_\w+|archive_\w+|invalid_\w+|incomplete_tdcc|rate_limited|lease_busy|lease_lost|run_deadline|snapshot_\w+|calendar_\w+|schema_pending)$/.test(error?.message) ? error.message
    : error?.errcode === 5 ? 'source_local_database_busy'
    : error?.name === 'TypeError' && error?.message === 'fetch failed' ? 'source_network_failed'
    : error?.name === 'TimeoutError' ? 'source_timeout' : 'update_failed';
const holderSql = "INSERT INTO screener_tdcc_weekly (symbol,data_date,payload,validation) VALUES (?,?,?,'full-17') ON CONFLICT(data_date,symbol) DO UPDATE SET payload=excluded.payload,validation=excluded.validation WHERE json_extract(excluded.payload,'$.provenance.fetchedAt') >= json_extract(screener_tdcc_weekly.payload,'$.provenance.fetchedAt')";
export const archiveHolderSql = "INSERT INTO screener_tdcc_weekly (symbol,data_date,payload,validation) VALUES (?,?,?,'full-17') ON CONFLICT(data_date,symbol) DO NOTHING";
export const dailySql = "INSERT INTO screener_daily_volume (symbol,data_date,payload) VALUES (?,?,?) ON CONFLICT(data_date,symbol) DO UPDATE SET payload=excluded.payload WHERE json_extract(excluded.payload,'$.provenance.fetchedAt') >= json_extract(screener_daily_volume.payload,'$.provenance.fetchedAt') AND (json_extract(excluded.payload,'$.turnoverNtd') IS NOT NULL OR json_extract(screener_daily_volume.payload,'$.turnoverNtd') IS NULL)";
const runSql = "INSERT INTO screener_runs (id,scope,status,checkpoint,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at";
const provenance = (source, sourceUrl, result) => ({ source, sourceUrl, fetchedAt: result.fetchedAt, payloadHash: result.hash, normalizationVersion: NORMALIZATION });
const DAILY_REPORT_MINIMUM = { TWSE: 800, TPEx: 500 };

/** Deterministic screener-only history plan. The bulk latest week is not queried here. */
export function planScreenerHistory(universe, historyWeeks, knownKeys = new Set(), checkedKeys = new Set()) {
    if (!Array.isArray(universe) || !Array.isArray(historyWeeks) || historyWeeks.length < 2 || historyWeeks.length > 6
        || historyWeeks.some((date,index)=>!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || index>0 && date<=historyWeeks[index-1])) throw new Error('invalid_history_plan');
    const eligible = (stock,date) => !stock.listingDate || stock.listingDate <= date;
    const targets = historyWeeks.flatMap(date => universe.filter(stock=>eligible(stock,date)).map(stock=>({symbol:stock.symbol,date})));
    const work = historyWeeks.slice(0,-1).reverse().flatMap(date => universe.filter(stock=>eligible(stock,date))
        .filter(stock=>!knownKeys.has(`${date}|${stock.symbol}`) && !checkedKeys.has(`${date}|${stock.symbol}`))
        .map(stock=>({stock,date,key:`${date}|${stock.symbol}`})));
    return { targets, work, target: targets.length, processed: targets.filter(item=>knownKeys.has(`${item.date}|${item.symbol}`) || checkedKeys.has(`${item.date}|${item.symbol}`)).length };
}

export function buildHistoryProgress(plan, failed, validThrough, now = Date.now()) {
    if (!plan || !Number.isInteger(plan.target) || !Number.isInteger(plan.processed) || plan.processed < 0 || plan.processed > plan.target
        || !Number.isInteger(failed) || failed < 0 || !Number.isFinite(Date.parse(validThrough))) throw new Error('invalid_history_progress');
    const remaining = plan.target - plan.processed;
    return { version: 2, target: plan.target, processed: plan.processed, remaining, failed,
        overdue: remaining > 0 && now > Date.parse(validThrough) ? remaining : 0,
        cursor: plan.work?.[0]?.key ?? null };
}

/** Keep the v2 six-period TDCC window plus immutable published snapshot anchors, never arbitrary long history. */
export async function pruneScreenerInputs(db, periods, revision, batch = statements => db.batch(statements)) {
    const days = new Set(periods.sessions.filter(date => date <= periods.through).slice(-2));
    const weeks = new Set(periods.weeks.filter(date => date <= periods.through).slice(-6));
    const revisions = new Set([revision]);
    for (const row of (await db.prepare("SELECT metadata FROM screener_snapshots WHERE status='published'").all()).results) {
        const metadata = JSON.parse(row.metadata); revisions.add(metadata.universeRevision);
        for (const date of Object.values(metadata.anchors.daily ?? {})) days.add(date);
        for (const date of Object.values(metadata.anchors.weekly ?? {})) weeks.add(date);
        for (const date of metadata.anchors.weeklyPeriods ?? []) weeks.add(date);
    }
    if (days.size < 2 || weeks.size < 2 || !revision) throw new Error('invalid_retention_anchors');
    const placeholders = values => [...values].map(() => '?').join(',');
    await batch([
        db.prepare(`DELETE FROM screener_daily_volume WHERE data_date NOT IN (${placeholders(days)})`).bind(...days),
        db.prepare(`DELETE FROM screener_tdcc_weekly WHERE data_date NOT IN (${placeholders(weeks)})`).bind(...weeks),
        db.prepare(`DELETE FROM screener_universe WHERE revision NOT IN (${placeholders(revisions)})`).bind(...revisions),
        db.prepare(`DELETE FROM screener_runs WHERE scope='screener-tdcc-bootstrap' AND json_extract(checkpoint,'$.date') NOT IN (${placeholders(weeks)})`).bind(...weeks),
        db.prepare(`DELETE FROM screener_runs WHERE scope='screener-source-period' AND json_extract(checkpoint,'$.date') NOT IN (${placeholders(new Set([...days,...weeks]))})`).bind(...new Set([...days,...weeks])),
    ]);
}

export function parseDailyReport(payload, market, date, source) {
    if (String(payload?.stat).toLowerCase() !== 'ok' || payload.date !== date.replaceAll('-', '') || !Array.isArray(payload.tables)) throw new Error('invalid_report_date');
    const codeField = market === 'TWSE' ? '證券代號' : '代號';
    // TPEx labels the canonical TWD amount column with its unit, while TWSE
    // uses the shorter label. Keep the allowlist market-specific and exact so
    // a new or ambiguous amount column still fails closed.
    const turnoverField = market === 'TWSE' ? '成交金額' : '成交金額(元)';
    const tables = payload.tables.filter(table => Array.isArray(table.fields) && table.fields.includes(codeField)
        && table.fields.includes('成交股數') && table.fields.includes(turnoverField));
    if (tables.length !== (market === 'TWSE' ? 1 : 2)) throw new Error('invalid_report_schema');
    const rows = tables.flatMap(table => {
        if (!Array.isArray(table.data)) throw new Error('invalid_report_schema');
        const codeIndex = table.fields.indexOf(codeField), sharesIndex = table.fields.indexOf('成交股數'), turnoverIndex = table.fields.indexOf(turnoverField);
        return table.data.map(row => {
            if (!Array.isArray(row) || row.length !== table.fields.length) throw new Error('invalid_report_schema');
            return { Date: date, [market === 'TWSE' ? 'Code' : 'SecuritiesCompanyCode']: row[codeIndex],
                [market === 'TWSE' ? 'TradeVolume' : 'TradingShares']: String(row[sharesIndex]).replaceAll(',', ''),
                [market === 'TWSE' ? 'TradeValue' : 'TransactionAmount']: String(row[turnoverIndex]).replaceAll(',', '') };
        });
    });
    return parseDailyVolumes(rows, market, source);
}

const payloadReportDate = payload => typeof payload?.date === 'string' && /^\d{8}$/.test(payload.date)
    ? `${payload.date.slice(0, 4)}-${payload.date.slice(4, 6)}-${payload.date.slice(6)}` : null;

/** A current candidate can legitimately still return an older/empty report while the official file is being published. */
export function parseCandidateDailyReport(payload, market, date, source) {
    const reportDate = payloadReportDate(payload);
    if (String(payload?.stat).toLowerCase() !== 'ok' || reportDate !== date) {
        const error = new Error('source_not_published');
        error.reportDate = reportDate;
        throw error;
    }
    return parseDailyReport(payload, market, date, source);
}

const readinessOutcome = error => {
    const reason = safeError(error);
    if (reason === 'source_not_published') return { status: 'pending', reportDate: error?.reportDate ?? null, reason };
    if (reason === 'source_blocked') return { status: 'blocked', reason };
    if (reason === 'rate_limited' || reason === 'source_http_429') return { status: 'rate-limited', reason };
    return { status: 'invalid', reason };
};

async function readPeriodReceipt(db, market, date) {
    const row = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id=? AND scope='screener-source-period'")
        .bind(`screener-period:${market}:${date}`).first();
    if (!row || row.status !== 'collected') return null;
    try {
        const receipt = JSON.parse(row.checkpoint);
        return receipt?.complete && receipt.source === market && receipt.date === date ? receipt : null;
    } catch { return null; }
}

/** Collect only missing official daily periods. Candidate failures are evidence, not permission to mix sessions. */
export async function collectOfficialDailyPeriods(db, { sessions, expectedSessionDate, universe, fetcher, batch, log = () => {} }) {
    const index = sessions.indexOf(expectedSessionDate);
    if (index < 1) throw new Error('calendar_coverage_pending');
    const required = sessions.slice(index - 1, index + 1);
    const candidateOutcomes = {};
    let retryAfterMs = 0;
    for (const date of required) {
        const markets = ['TWSE', 'TPEx'];
        const existing = Object.fromEntries(await Promise.all(markets.map(async market => [market, await readPeriodReceipt(db, market, date)])));
        for (const market of markets) {
            const allowedCount = universe.filter(stock => stock.market === market).length;
            const receipt = existing[market];
            if (receipt && (receipt.total < DAILY_REPORT_MINIMUM[market]
                || receipt.total < Math.ceil(allowedCount * 0.95))) existing[market] = null;
        }
        const missing = markets.filter(market => !existing[market]);
        const fetched = await Promise.allSettled(missing.map(async market => {
            const url = market === 'TWSE'
                ? `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date.replaceAll('-', '')}&type=ALLBUT0999&response=json`
                : `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${date.replaceAll('-', '%2F')}&id=&response=json`;
            const result = await boundedOfficialText(url, fetcher);
            let payload;
            try { payload = JSON.parse(result.text); } catch { throw new Error('invalid_report_json'); }
            const parsed = date === expectedSessionDate
                ? parseCandidateDailyReport(payload, market, date, provenance(market, url, result))
                : parseDailyReport(payload, market, date, provenance(market, url, result));
            const allowed = new Set(universe.filter(stock => stock.market === market).map(stock => stock.symbol));
            const points = [...parsed.points].filter(([symbol]) => allowed.has(symbol));
            const covered = points.length + [...parsed.invalid].filter(([symbol]) => allowed.has(symbol)).length;
            if (covered < DAILY_REPORT_MINIMUM[market] || covered < Math.ceil(allowed.size * 0.95)) throw new Error('invalid_universe_coverage');
            return { market, date, result, parsed, points };
        }));
        for (let offset = 0; offset < fetched.length; offset++) {
            const market = missing[offset];
            const outcome = fetched[offset];
            if (outcome.status === 'rejected') {
                if (date !== expectedSessionDate) throw outcome.reason;
                retryAfterMs = Math.max(retryAfterMs, Number(outcome.reason?.retryAfterMs) || 0);
                const classified = readinessOutcome(outcome.reason);
                if (classified.status === 'invalid' && /^(?:source_timeout|source_network_failed|source_http_\d{3})$/.test(classified.reason)) {
                    throw outcome.reason;
                }
                candidateOutcomes[market] = classified;
                continue;
            }
            const { result, parsed, points } = outcome.value;
            for (let row = 0; row < points.length; row += 50) {
                await batch(points.slice(row, row + 50).map(([symbol, point]) => db.prepare(dailySql).bind(symbol, date, JSON.stringify(point))));
            }
            const receipt = { source: market, date, complete: true, total: points.length, invalid: parsed.invalid.size, hash: result.hash };
            await batch([db.prepare(runSql).bind(`screener-period:${market}:${date}`, 'screener-source-period', 'collected', JSON.stringify(receipt), stamp())]);
            existing[market] = receipt;
            log({ event: 'daily-period', market, date, processed: points.length, invalid: parsed.invalid.size });
        }
        if (date === expectedSessionDate) for (const market of markets) {
            const receipt = existing[market];
            if (receipt) candidateOutcomes[market] = { status: 'complete', reportDate: date, hash: receipt.hash,
                total: receipt.total, invalid: receipt.invalid, reason: null };
            else candidateOutcomes[market] ??= { status: 'pending', reportDate: null, reason: 'source_not_published' };
        }
    }
    return { outcomes: candidateOutcomes, retryAfterMs };
}

export async function updateScreener(db, { bootstrapWeek = false, bootstrapArchive = false, scheduled = false, limit = 64,
    ohlcvLimit = 8, ohlcvV4Limit = 4, recoverInvalidSession = null, log = () => {}, fetcher = fetch } = {}) {
    if (recoverInvalidSession !== null && (scheduled || bootstrapWeek || bootstrapArchive
        || !/^\d{4}-\d{2}-\d{2}$/.test(recoverInvalidSession)
        || recoverInvalidSession !== new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))) throw new Error('invalid_recovery_options');
    if (!Number.isInteger(limit) || limit < 1 || limit > 512) throw new Error('invalid_limit');
    if (!Number.isInteger(ohlcvLimit) || ohlcvLimit < 1 || ohlcvLimit > 120) throw new Error('invalid_ohlcv_options');
    if (!Number.isInteger(ohlcvV4Limit) || ohlcvV4Limit < 1 || ohlcvV4Limit > 260) throw new Error('invalid_ohlcv_v4_options');
    if (scheduled && !await db.prepare("SELECT id FROM screener_runs WHERE id='screener-enabled' AND status='enabled'").first()) return { state:'skipped', reason:'schedule_disabled' };
    if (scheduled) {
        // Older databases retain the existing maintenance path until migrations exist.
        try { const idle = await screenerIdleGate(db); if (idle) return idle; }
        catch (error) { if (!/no such (table|column)/i.test(String(error))) throw error; }
    }
    const started = Date.now(), deadline = started + 15 * 60000, owner = crypto.randomUUID();
    const day = new Date(started + 8 * 3600000).toISOString().slice(0, 10);
    const taipei = new Date(started + 8 * 3600000);
    if (taipei.getUTCHours() * 60 + taipei.getUTCMinutes() < SCREENER_POST_CLOSE_PROBE_MINUTES) return { state: 'pending', reason: 'source_not_closed' };
    const lease = 'screener-operator-lease';
    await db.prepare("INSERT INTO screener_runs (id,scope,status,checkpoint,lease_until,updated_at) VALUES (?,'screener-operator','running',?,?,?) ON CONFLICT(id) DO UPDATE SET status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until <= ?")
        .bind(lease, owner, new Date(deadline).toISOString(), stamp(), stamp()).run();
    const owned = async id => (await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(id).first())?.checkpoint === owner;
    if (!await owned(lease)) return { state: 'skipped', reason: 'lease_busy' };
    let collectorLocked = false;
    const guard = async () => { if (Date.now() >= deadline) throw new Error('run_deadline'); if (!await owned(lease) || collectorLocked && !await owned('screener-collector-lease')) throw new Error('lease_lost'); };
    const batch = async statements => { await guard(); await db.batch(statements); await guard(); };
    let attempts = 0;
    try {
        // Chip reports have independent windows/backoff; the shared operator lease
        // still serializes this work, but general screener cooldown must not block it.
        if (scheduled) {
            try { log({ event: 'screener-chip-independent', ...await updateScreenerChip(db, { limit: 1, fetcher }) }); }
            catch (error) { log({ event: 'screener-chip-independent', state: 'pending', reason: safeError(error) }); }
            await guard();
        }
        const prior = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-operator-policy'").first();
        if (prior) {
            const policy = JSON.parse(prior.checkpoint);
            attempts = policy.day === day ? policy.attempts : 0;
            if (prior.status === 'blocked') return { state:'pending',reason:'source_blocked' };
            // An explicitly authorized pinned mirror is independent of the blocked
            // per-symbol form. It may bypass that path's cooldown, never its validation.
            if ((Date.parse(policy.nextAttemptAt) > started && !bootstrapArchive && !(bootstrapWeek && prior.status === 'idle')) || attempts >= 3 && !bootstrapArchive) return { state:'skipped',reason:'backoff',nextAttemptAt:policy.nextAttemptAt };
        }
        const periods = await discoverScreenerPeriods(new Date(), fetcher);
        await guard();
        const sessionTarget = resolveScreenerSessionTarget(periods.sessions, started);
        if (!sessionTarget.expectedSessionDate) throw new Error('calendar_coverage_pending');
        const baseBefore = await readScreenerSnapshot(db, undefined, 2);
        const effectiveBefore = baseBefore?.metadata?.anchors?.daily?.current ?? null;
        const readinessRow = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(SCREENER_SESSION_READINESS_ID).first();
        let savedReadiness = null;
        try { savedReadiness = readinessRow ? parseScreenerSessionReadiness(JSON.parse(readinessRow.checkpoint)) : null; } catch { savedReadiness = null; }
        let readiness = normalizeScreenerSessionReadiness(savedReadiness, sessionTarget.expectedSessionDate, effectiveBefore, started);
        if (recoverInvalidSession !== null) {
            await guard();
            readiness = await consumeInvalidSessionRecovery(db, readiness, recoverInvalidSession, started);
            await guard();
        }
        const probeDecision = publicationProbeDecision(readiness, started);
        const probeDaily = sessionTarget.expectedSessionDate > (effectiveBefore ?? '') && probeDecision.allowed;
        if (recoverInvalidSession === null) await batch([db.prepare(runSql).bind(SCREENER_SESSION_READINESS_ID, 'screener-session-readiness', readiness.phase,
            JSON.stringify(readiness), stamp())]);
        for (const scope of ['screener-daily', 'screener-weekly']) {
            if (scope === 'screener-daily' && !probeDaily) continue;
            const result = await collectScreenerData(db, scope, { fetcher, previousWeek: periods.weeks.at(-2) });
            log({ event: scope, ...result });
            await guard();
        }
        await db.prepare("INSERT INTO screener_runs (id,scope,status,checkpoint,lease_until,updated_at) VALUES ('screener-collector-lease','screener-collector','running',?,?,?) ON CONFLICT(id) DO UPDATE SET status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until <= ?")
            .bind(owner, new Date(deadline).toISOString(), stamp(), stamp()).run();
        if (!await owned('screener-collector-lease')) throw new Error('lease_busy');
        collectorLocked = true;
        const run = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id IN ('screener-daily','screener-weekly') AND status='collected' ORDER BY updated_at DESC LIMIT 1").first();
        const revision = run && JSON.parse(run.checkpoint).receipts?.catalog?.hash;
        if (!revision) throw new Error('invalid_catalog');
        const universe = (await db.prepare('SELECT payload FROM screener_universe WHERE revision=? ORDER BY symbol').bind(revision).all()).results.map(row => JSON.parse(row.payload).stock);
        if (probeDaily) {
            const daily = await collectOfficialDailyPeriods(db, { sessions: periods.sessions,
                expectedSessionDate: sessionTarget.expectedSessionDate, universe, fetcher, batch, log });
            readiness = recordScreenerPublicationProbe(readiness, daily.outcomes, started, daily.retryAfterMs);
            await batch([db.prepare(runSql).bind(SCREENER_SESSION_READINESS_ID, 'screener-session-readiness', readiness.phase,
                JSON.stringify(readiness), stamp())]);
        }
        const historyWeeks = periods.weeks.filter(date => date <= periods.through).slice(-6);
        if (historyWeeks.length < 2) throw new Error('calendar_coverage_pending');
        // Local verified history is reused even without explicit historical bootstrap.
        const local = await readLocalScreenerHolders(db, universe, historyWeeks);
        for (let i = 0; i < local.length; i += 50) await batch(local.slice(i, i + 50).map(({ symbol, point }) => db.prepare(holderSql).bind(symbol, point.date, JSON.stringify(point))));
        if (bootstrapArchive) {
            try {
                const archive = await preparePinnedTdccBootstrap(historyWeeks, universe, fetcher);
                await guard();
                for (const snapshot of archive.snapshots) {
                    const values = [...snapshot.points];
                    for (let index = 0; index < values.length; index += 50) await batch(values.slice(index, index + 50)
                        .map(([symbol, point]) => db.prepare(archiveHolderSql).bind(symbol, snapshot.date, JSON.stringify(point))));
                    const missing = snapshot.eligible.filter(stock => !snapshot.points.has(stock.symbol));
                    // The latest full official batch is authoritative evidence that
                    // these symbols have no current row; count them as checked unknown.
                    if (snapshot.date === archive.latestAnchor.date) for (const stock of missing) await batch([
                        db.prepare(runSql).bind(`screener-history:${snapshot.date}:${stock.symbol}`, 'screener-tdcc-bootstrap', 'checked', JSON.stringify({
                            symbol: stock.symbol, date: snapshot.date, reason: 'official_no_data', hash: snapshot.sha256,
                            source: 'TDCC', sourceUrl: archive.latestAnchor.sourceUrl,
                        }), stamp()),
                    ]);
                    await batch([db.prepare(runSql).bind(`screener-bootstrap-archive:${snapshot.date}`, 'screener-tdcc-bootstrap-archive', 'verified', JSON.stringify({
                        version: 1, source: 'TDCC', transport: 'pinned-public-mirror', commit: archive.commit, date: snapshot.date,
                        sourceUrl: snapshot.url, sha256: snapshot.sha256, bytes: snapshot.bytes, rows: snapshot.rowCount,
                        symbols: snapshot.symbolCount, universeEligible: snapshot.eligible.length, universeValid: snapshot.points.size,
                        universeMissing: missing.map(stock => stock.symbol), latestOfficialCompared: snapshot.date === archive.latestAnchor.date ? archive.latestAnchor.compared : null,
                        latestOfficialHash: snapshot.date === archive.latestAnchor.date ? archive.latestAnchor.payloadHash : null,
                    }), stamp())]);
                    log({ event: 'tdcc-archive-period', date: snapshot.date, valid: snapshot.points.size, missing: missing.length, hash: snapshot.sha256 });
                }
            } catch (error) {
                log({ event: 'tdcc-archive-rejected', reason: safeError(error) });
                // No archive rows are written until all six files and the latest
                // official anchor pass. Continue through the official bounded path.
            }
        }
        if (bootstrapWeek || scheduled) {
            // Newest missing dates first. The latest period is collected by the bulk source,
            // while older official periods use the bounded per-symbol history form.
            const existingRows = (await db.prepare(`SELECT symbol,data_date FROM screener_tdcc_weekly WHERE data_date IN (${historyWeeks.map(()=>'?').join(',')}) AND validation='full-17'`).bind(...historyWeeks).all()).results;
            const existing = new Set(existingRows.map(row=>`${row.data_date}|${row.symbol}`));
            const priorOutcomes = (await db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='screener-tdcc-bootstrap' AND status='checked'").all()).results.map(row=>JSON.parse(row.checkpoint));
            const checkedBefore = new Set(priorOutcomes.map(row=>`${row.date}|${row.symbol}`));
            const plan = planScreenerHistory(universe, historyWeeks, existing, checkedBefore);
            if (plan.work.length) {
            const session = screenerTdccSession(fetcher);
            const available = await session.refresh();
            const availableSet = new Set(available);
            if (historyWeeks.some(date => !availableSet.has(date.replaceAll('-', '')))) throw new Error('invalid_week_revision');
            let requested = 0;
            historyLoop: for (const {stock,date} of plan.work) {
                await guard();
                const outcomeId = `screener-history:${date}:${stock.symbol}`;
                if (requested >= limit || Date.now() > deadline - 35000) break historyLoop;
                await pause(1200); requested++;
                let raw;
                try { raw = await session.query(stock.symbol, date); }
                catch (error) {
                    if (!['incomplete_tdcc','invalid_integer_precision'].includes(error.message)) throw error;
                    await batch([db.prepare(runSql).bind(outcomeId,'screener-tdcc-bootstrap','checked',JSON.stringify({symbol:stock.symbol,date,reason:error.message}),stamp())]);
                    // A rejected table can predate session-token normalization; refresh before the next stock.
                    await session.refresh();
                    continue;
                }
                const result = { fetchedAt: stamp(), hash: hashText(JSON.stringify(raw)) };
                let point, reason = 'official_no_data';
                if (raw) {
                    if (raw.some(row => !Number.isSafeInteger(Number(row['股數'])) || !Number.isSafeInteger(Number(row['人數'])))) throw new Error('invalid_integer_precision');
                    const parsed = parseHolderBatch(raw, [stock], provenance('TDCC', 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock', result));
                    point = parsed.points.get(stock.symbol); reason = parsed.invalid.get(stock.symbol) ?? 'none';
                }
                await batch([...(point ? [db.prepare(holderSql).bind(stock.symbol, date, JSON.stringify(point))] : []),
                    db.prepare(runSql).bind(outcomeId, 'screener-tdcc-bootstrap', 'checked', JSON.stringify({ symbol: stock.symbol, date, reason, hash: result.hash }), stamp())]);
                if (requested % 25 === 0) log({ event: 'weekly-progress', requested, limit, date });
            }
            }
        }
        const knownRows = (await db.prepare(`SELECT symbol,data_date FROM screener_tdcc_weekly WHERE data_date IN (${historyWeeks.map(()=>'?').join(',')}) AND validation='full-17'`).bind(...historyWeeks).all()).results;
        const known = new Set(knownRows.map(row => `${row.data_date}|${row.symbol}`));
        const allOutcomes = (await db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='screener-tdcc-bootstrap' AND status='checked'").all()).results.map(row => JSON.parse(row.checkpoint)).filter(row => historyWeeks.includes(row.date));
        const checked = new Set([...known, ...allOutcomes.map(row => `${row.date}|${row.symbol}`)]);
        const plan = planScreenerHistory(universe, historyWeeks, known, new Set(allOutcomes.map(row=>`${row.date}|${row.symbol}`)));
        const target = plan.target;
        const remaining = target - plan.processed;
        const failed = allOutcomes.filter(row=>row.reason && row.reason!=='none' && row.reason!=='official_no_data').length;
        const progress = { ...buildHistoryProgress(plan, failed, periods.validThrough), dates: historyWeeks, universeRevision: revision };
        for (const date of historyWeeks) {
            const eligible = universe.filter(stock=>!stock.listingDate || stock.listingDate<=date);
            const dateRemaining = eligible.filter(stock => !checked.has(`${date}|${stock.symbol}`)).length;
            if (!dateRemaining) await batch([db.prepare(runSql).bind(`screener-period:TDCC:${date}`, 'screener-source-period', 'collected', JSON.stringify({ source: 'TDCC', date, complete: true, total: eligible.length, valid: eligible.filter(stock => known.has(`${date}|${stock.symbol}`)).length }), stamp())]);
        }
        await batch([db.prepare(runSql).bind('screener-history-progress','screener-tdcc-bootstrap-progress',remaining?'running':'complete',JSON.stringify(progress),stamp())]);
        await batch([db.prepare(runSql).bind('screener-period-evidence','screener-calendar','verified',JSON.stringify(periods),stamp())]);
        const sessionPending = readiness.phase !== 'complete'
            || !readiness.effectiveSessionDate || readiness.effectiveSessionDate < readiness.expectedSessionDate;
        if (sessionPending) {
            const reason = screenerReadinessReason(readiness);
            await batch([db.prepare(runSql).bind('screener-operator-policy','screener-operator-policy','idle',JSON.stringify({
                day, attempts: 0, nextAttemptAt: readiness.nextAttemptAt, reason,
            }),stamp())]);
            return { state: 'pending', reason, nextAttemptAt: readiness.nextAttemptAt,
                expectedSessionDate: readiness.expectedSessionDate, effectiveSessionDate: readiness.effectiveSessionDate,
                readiness, weekly: { dates: historyWeeks, target, processed: target - remaining, remaining,
                    valid: known.size, failed: progress.failed, overdue: progress.overdue, cursor: progress.cursor } };
        }
        const publication = await publishCollectedScreener(db, periods);
        // v2 publisher has already proven the newest complete TWSE/TPEx common
        // period. Technical preparation must use that exact D; collector receipt
        // dates can temporarily differ during the after-market publication window.
        const publishedBase = await readScreenerSnapshot(db, undefined, 2);
        const technicalThrough = publishedBase?.metadata?.anchors?.daily?.current;
        if (!technicalThrough || publishedBase.metadata.expectedSessionDate !== technicalThrough) throw new Error('calendar_coverage_pending');
        const technicalReceiptRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-period'").all()).results ?? [];
        const technicalReceipts = technicalReceiptRows.flatMap(row => { try { return [{ ...JSON.parse(row.checkpoint), status: row.status }]; } catch { return []; } });
        const technicalSessions = selectOhlcvSessions(periods.sessions, technicalThrough, technicalReceipts);
        const technical = await prepareScreenerOhlcv(db, { universe, sessions: technicalSessions, universeRevision: revision,
            validThrough: periods.validThrough, limit: ohlcvLimit, fetcher, guard, log });
        const technicalSnapshot = technical.state === 'complete' ? await publishPreparedScreenerV3(db) : { state:'pending', reason:'ohlcv_bootstrap_pending' };
        let technicalV4 = { state: 'pending', reason: 'v3_snapshot_pending' };
        let technicalSnapshotV4 = { state: 'pending', reason: 'ohlcv_v4_bootstrap_pending' };
        if (technical.state === 'complete' && ['published', 'unchanged'].includes(technicalSnapshot.state)) {
            const v4ReceiptRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-v4-period'").all()).results ?? [];
            const v4Receipts = v4ReceiptRows.flatMap(row => { try { return [{ ...JSON.parse(row.checkpoint), status: row.status }]; } catch { return []; } });
            const v4Sessions = selectOhlcvV4Sessions(periods.sessions, technicalThrough, v4Receipts);
            technicalV4 = await prepareScreenerOhlcvV4(db, { universe, sessions: v4Sessions, universeRevision: revision,
                validThrough: periods.validThrough, limit: ohlcvV4Limit, fetcher, guard, log });
            technicalSnapshotV4 = technicalV4.state === 'complete' ? await publishPreparedScreenerV4(db)
                : { state: 'pending', reason: 'ohlcv_v4_bootstrap_pending' };
            if (technicalV4.state === 'complete') await pruneScreenerOhlcvV4(db, v4Sessions);
        }
        let chipSnapshotV5 = { state: 'pending', reason: 'v4_snapshot_pending' };
        if (['published','unchanged'].includes(technicalSnapshotV4.state)) {
            try {
                chipSnapshotV5 = await updateScreenerChip(db, {
                    limit: bootstrapArchive ? 21 : 1,
                    fetcher,
                });
            } catch (error) {
                chipSnapshotV5 = { state: 'pending', reason: /no such (?:table|column).*screener_chip/i.test(String(error))
                    ? 'schema_pending' : safeError(error) };
            }
        }
        if (['published','unchanged'].includes(publication.state)) await pruneScreenerInputs(db, periods, revision, batch);
        if (technical.state === 'complete') await pruneScreenerOhlcv(db, technicalSessions);
        await batch([db.prepare(runSql).bind('screener-operator-policy','screener-operator-policy','idle',JSON.stringify({day,attempts:0,nextAttemptAt:new Date(Date.now()+3600000).toISOString()}),stamp())]);
        return { ...publication, weekly: { dates: historyWeeks, target, processed: target - remaining, remaining,
            valid: known.size, failed: progress.failed, overdue: progress.overdue, cursor: progress.cursor },
            technical, technicalSnapshot, technicalV4, technicalSnapshotV4, chipSnapshotV5 };
    } catch (error) {
        const reason = safeError(error);
        if (await owned(lease)) {
            const nextAttemptAt = new Date(Date.now() + Math.max(15 * 60000 * 2 ** Math.min(attempts,2), error.retryAfterMs ?? 0)).toISOString();
            await db.prepare(runSql).bind('screener-operator-policy','screener-operator-policy',reason==='source_blocked'?'blocked':'retry_pending',JSON.stringify({day,attempts:attempts+1,nextAttemptAt,reason}),stamp()).run();
            return {state:'pending',reason,nextAttemptAt};
        }
        throw error;
    } finally {
        if (collectorLocked) await db.prepare("UPDATE screener_runs SET status='idle',lease_until=NULL WHERE id='screener-collector-lease' AND checkpoint=?").bind(owner).run();
        await db.prepare("UPDATE screener_runs SET status='idle',lease_until=NULL WHERE id=? AND checkpoint=?").bind(lease, owner).run();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2), database = args.find(arg => arg.startsWith('--database='))?.slice(11);
    if (!database || args.some(arg => !/^(?:--database=\/.+|--bootstrap-week|--bootstrap-history|--scheduled|--enable-schedule|--disable-schedule|--limit=\d+|--ohlcv-limit=\d+|--ohlcv-v4-limit=\d+|--recover-invalid-session=\d{4}-\d{2}-\d{2})$/.test(arg))
        || args.includes('--disable-schedule') && args.some(arg=>['--enable-schedule','--scheduled','--bootstrap-week','--bootstrap-history'].includes(arg))) throw new Error('使用方式：--database=/absolute/local.sqlite [--bootstrap-history] [--limit=64] [--ohlcv-limit=8] [--scheduled|--enable-schedule|--disable-schedule]');
    const recoveryArgs = args.filter(arg => arg.startsWith('--recover-invalid-session='));
    if (recoveryArgs.length > 1 || recoveryArgs.length && args.some(arg => ['--enable-schedule','--disable-schedule','--scheduled','--bootstrap-week','--bootstrap-history'].includes(arg))) throw new Error('invalid_recovery_options');
    let db;
    try {
        db = new ScreenerSqlite(database);
        if (args.includes('--disable-schedule')) {
            await db.prepare(runSql).bind('screener-enabled','screener-configuration','disabled',JSON.stringify({version:2,bootstrapHistory:true}),stamp()).run();
            console.log(JSON.stringify({state:'disabled',scope:'screener-only'}));
        } else {
        if (args.includes('--enable-schedule')) {
            const snapshot = await db.prepare("SELECT metadata FROM screener_snapshots WHERE status='published' ORDER BY created_at DESC LIMIT 1").first();
            const metadata = snapshot && JSON.parse(snapshot.metadata);
            if (!metadata?.anchors?.daily || !metadata?.anchors?.weekly || metadata.sourceReview !== 'verified'
                || !(Date.parse(metadata.validThrough) > Date.now())) throw new Error('invalid_bootstrap_not_complete');
            await db.prepare(runSql).bind('screener-enabled','screener-configuration','enabled',JSON.stringify({version:2,bootstrapHistory:true}),stamp()).run();
        }
        const result = await updateScreener(db, { bootstrapWeek: args.includes('--bootstrap-week') || args.includes('--bootstrap-history'), bootstrapArchive: args.includes('--bootstrap-history'), scheduled:args.includes('--scheduled'), recoverInvalidSession: recoveryArgs[0]?.split('=')[1] ?? null, limit: Number(args.find(arg => arg.startsWith('--limit='))?.slice(8) ?? 64), ohlcvLimit: Number(args.find(arg => arg.startsWith('--ohlcv-limit='))?.slice(14) ?? 8), ohlcvV4Limit: Number(args.find(arg => arg.startsWith('--ohlcv-v4-limit='))?.slice(17) ?? 4), log: value => console.log(JSON.stringify(value)) });
        console.log(JSON.stringify(result));
        if (result.state === 'pending') process.exitCode = 2;
        }
    } catch (error) { console.error(JSON.stringify({ state: 'pending', reason: safeError(error) })); process.exitCode = 1; }
    finally { db?.close(); }
}
