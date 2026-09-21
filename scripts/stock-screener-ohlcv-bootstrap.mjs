/** 全市場 OHLC 準備器；一個 target 固定為 market + official session。 */
import { createHash } from 'node:crypto';
import { parseHistoricalOhlcvReport, parseHistoricalOhlcvV4Report } from '../apps/multiview/worker/stock-screener-sources.ts';
import { ohlcvUpsertStatement, ohlcvV4UpsertStatement } from '../apps/multiview/worker/stock-screener-ohlcv-repository.ts';
import { boundedOfficialText } from './stock-screener-periods.mjs';

export const OHLCV_WINDOW = 60;
export const OHLCV_PROGRESS_VERSION = 3;
export const OHLCV_V4_WINDOW = 130;
export const OHLCV_V4_PROGRESS_VERSION = 4;
export const OHLCV_V4_CAPABILITY = 'ohlcv-v4';
const markets = ['TWSE', 'TPEx'];
const stamp = () => new Date().toISOString();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function ohlcvHistoryUrl(market, date) {
    if (!markets.includes(market) || !isoDate(date)) throw new Error('invalid_ohlcv_target');
    return market === 'TWSE'
        ? `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date.replaceAll('-', '')}&type=ALLBUT0999&response=json`
        : `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${date.replaceAll('-', '%2F')}&id=&response=json`;
}

export function buildOhlcvTargets(universe, sessions) {
    if (!Array.isArray(universe) || !Array.isArray(sessions) || sessions.length !== OHLCV_WINDOW
        || new Set(sessions).size !== sessions.length
        || sessions.some((date, index) => !isoDate(date) || index > 0 && date <= sessions[index - 1])
        || universe.some((stock) => !stock || !markets.includes(stock.market) || !/^[1-9]\d{3}\.(?:TW|TWO)$/.test(stock.symbol)
            || stock.listingDate && !isoDate(stock.listingDate))) throw new Error('invalid_ohlcv_plan');
    const targets = [];
    for (const sessionDate of sessions) for (const market of markets) {
        const symbols = universe.filter((stock) => stock.market === market && (!stock.listingDate || stock.listingDate <= sessionDate))
            .map((stock) => stock.symbol).sort();
        if (!symbols.length) throw new Error('invalid_ohlcv_plan');
        targets.push({ key: `${market}|${sessionDate}`, market, sessionDate, symbols,
            expectedHash: sha256(symbols.join('\n')), universeEligible: symbols.length });
    }
    return targets;
}

export function selectOhlcvSessions(officialCommonSessions, through, receipts = []) {
    if (!Array.isArray(officialCommonSessions) || !isoDate(through)
        || !Array.isArray(receipts)
        || new Set(officialCommonSessions).size !== officialCommonSessions.length
        || officialCommonSessions.some((date, index) => !isoDate(date) || index > 0 && date <= officialCommonSessions[index - 1])) throw new Error('invalid_ohlcv_calendar');
    // Annual/planned calendars cannot foresee typhoon closures. Exclude a past
    // date only after BOTH official market reports independently confirm the
    // exact no-trade response pair; one-sided emptiness or schema/date drift
    // remains a failed target and never silently changes the calendar.
    const failures = new Map(receipts.filter((row) => row?.status === 'failed' && isoDate(row.sessionDate))
        .map((row) => [`${row.market}|${row.sessionDate}`, row.reason]));
    const confirmedClosed = new Set(officialCommonSessions.filter((date) => date < through
        && failures.get(`TWSE|${date}`) === 'invalid_report_date'
        && failures.get(`TPEx|${date}`) === 'empty_report'));
    const sessions = officialCommonSessions.filter((date) => date <= through && !confirmedClosed.has(date)).slice(-OHLCV_WINDOW);
    if (sessions.length !== OHLCV_WINDOW || sessions.at(-1) !== through) throw new Error('calendar_coverage_pending');
    return sessions;
}

export function planOhlcvBootstrap(universe, sessions, receipts = [], coverageByTarget) {
    const targets = buildOhlcvTargets(universe, sessions);
    if (!Array.isArray(receipts)) throw new Error('invalid_ohlcv_receipts');
    const byKey = new Map(receipts.map((receipt) => [`${receipt.market}|${receipt.sessionDate}`, receipt]));
    const complete = (target) => {
        const receipt = byKey.get(target.key);
        if (receipt?.status !== 'collected' || receipt.complete !== true) return false;
        if (!coverageByTarget) return receipt.expectedHash === target.expectedHash && receipt.universeEligible === target.universeEligible;
        // Universe metadata, removals and renames do not invalidate an official
        // market/session receipt. Re-open only when a currently eligible symbol
        // is not covered by a canonical row or an explicit invalid/missing outcome.
        const coverage = coverageByTarget.get(target.key);
        return coverage instanceof Set && target.symbols.every((symbol) => coverage.has(symbol));
    };
    const failed = (target) => {
        const receipt = byKey.get(target.key);
        return receipt?.status === 'failed' && receipt.expectedHash === target.expectedHash;
    };
    const processed = targets.filter(complete).length;
    const work = targets.filter((target) => !complete(target)).sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || a.market.localeCompare(b.market));
    return { targets, work, target: targets.length, processed, remaining: targets.length - processed,
        failed: targets.filter(failed).length, cursor: work[0]?.key ?? null, receipts: byKey };
}

export function buildOhlcvProgress(plan, validThrough, now = Date.now()) {
    if (!plan || !Number.isInteger(plan.target) || !Number.isInteger(plan.processed) || plan.processed < 0 || plan.processed > plan.target
        || !Number.isInteger(plan.failed) || plan.failed < 0 || plan.failed > plan.remaining
        || !Number.isFinite(Date.parse(validThrough))) throw new Error('invalid_ohlcv_progress');
    const rows = Object.fromEntries(markets.map((market) => {
        const marketTargets = plan.targets.filter((target) => target.market === market);
        const pending = new Set(plan.work.filter((target) => target.market === market).map((target) => target.key));
        return [market, { target: marketTargets.length, processed: marketTargets.length - pending.size,
            failed: plan.work.filter((target) => target.market === market).filter((target) => {
                const receipt = plan.receipts?.get?.(target.key); return receipt?.status === 'failed' && receipt.expectedHash === target.expectedHash;
            }).length }];
    }));
    return { version: OHLCV_PROGRESS_VERSION, target: plan.target, processed: plan.processed,
        remaining: plan.target - plan.processed, failed: plan.failed,
        overdue: plan.target > plan.processed && now > Date.parse(validThrough) ? plan.target - plan.processed : 0,
        cursor: plan.cursor, markets: rows };
}

const parseReceiptRows = (rows) => rows.flatMap((row) => {
    try { return [{ ...JSON.parse(row.checkpoint), status: row.status }]; } catch { return []; }
});
const runSql = "INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES (?,'screener-ohlcv-period',?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at";
const progressSql = "INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES ('screener-ohlcv-progress','screener-ohlcv-progress',?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at";

function buildCoverage(rows, receipts) {
    const coverage = new Map();
    const add = (key, symbol) => {
        const values = coverage.get(key) ?? new Set();
        values.add(symbol);
        coverage.set(key, values);
    };
    for (const row of rows) add(`${row.market}|${row.data_date}`, row.symbol);
    for (const receipt of receipts) for (const symbol of [...(receipt.invalidSymbols ?? []), ...(receipt.missingSymbols ?? [])]) {
        add(`${receipt.market}|${receipt.sessionDate}`, symbol);
    }
    return coverage;
}

/** One bounded run. UI/GET never calls this function. */
export async function prepareScreenerOhlcv(db, {
    universe, sessions, universeRevision, validThrough, limit = 8, fetcher = fetch,
    pauseMs = 1200, clock = Date.now, guard = async () => {}, log = () => {}, batchSize = 50,
} = {}) {
    if (!db || !universeRevision || !Number.isInteger(limit) || limit < 1 || limit > 120
        || !Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 10000
        || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('invalid_ohlcv_options');
    try { await db.prepare('SELECT 1 FROM screener_daily_ohlcv LIMIT 1').first(); }
    catch (error) { if (/no such table.*screener_daily_ohlcv/.test(String(error))) throw new Error('schema_pending'); throw error; }
    const existingRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-period'").all()).results ?? [];
    const receipts = parseReceiptRows(existingRows);
    const rowCoverage = (await db.prepare(`SELECT symbol,data_date,market FROM screener_daily_ohlcv WHERE data_date IN (${sessions.map(() => '?').join(',')}) AND validation IN ('canonical-complete-v1','canonical-complete-v2')`).bind(...sessions).all()).results ?? [];
    let coverage = buildCoverage(rowCoverage, receipts);
    let plan = planOhlcvBootstrap(universe, sessions, receipts, coverage);
    let requested = 0;
    for (const target of plan.work) {
        if (requested >= limit) break;
        await guard();
        if (requested > 0 && pauseMs) await sleep(pauseMs);
        const url = ohlcvHistoryUrl(target.market, target.sessionDate);
        requested++;
        try {
            const result = await boundedOfficialText(url, fetcher);
            await guard();
            const provenance = { source: target.market, sourceUrl: url, fetchedAt: result.fetchedAt,
                payloadHash: result.hash, normalizationVersion: 'official-daily-ohlcv-v1' };
            const parsed = parseHistoricalOhlcvReport(JSON.parse(result.text), target.market, target.sessionDate, provenance, universe);
            const valid = [...parsed.points.values()];
            for (let offset = 0; offset < valid.length; offset += batchSize) {
                await guard();
                await db.batch(valid.slice(offset, offset + batchSize).map((point) => ohlcvUpsertStatement(db, point)));
            }
            const invalidSymbols = [...parsed.invalid.keys()].sort();
            const missingSymbols = [...parsed.universeMissing].sort();
            const receipt = { version: 1, market: target.market, sessionDate: target.sessionDate, status: 'collected', complete: true,
                universeRevision, expectedHash: target.expectedHash, universeEligible: target.universeEligible,
                valid: valid.length, invalid: invalidSymbols.length, missing: missingSymbols.length,
                invalidSymbols, missingSymbols, payloadHash: result.hash, mapping: parsed.mapping };
            if (receipt.valid + receipt.invalid + receipt.missing !== receipt.universeEligible) throw new Error('invalid_ohlcv_receipt');
            await guard();
            await db.prepare(runSql).bind(`screener-ohlcv:${target.market}:${target.sessionDate}`, 'collected', JSON.stringify(receipt), stamp()).run();
            log({ event: 'ohlcv-period', market: target.market, date: target.sessionDate, valid: receipt.valid, invalid: receipt.invalid, missing: receipt.missing });
        } catch (error) {
            const interruptedReason = error?.errcode === 5 || error?.code === 'SQLITE_BUSY'
                ? 'source_local_database_busy' : error?.message;
            if (/^(?:rate_limited|source_(?:blocked|timeout|http_\d{3}|too_large|local_database_busy))$/.test(interruptedReason ?? '')) {
                // A transport interruption must still expose durable progress. Completed
                // receipts remain resumable and no failed target is fabricated for a
                // request whose authoritative body was unavailable.
                const interruptedRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-period'").all()).results ?? [];
                const interruptedReceipts = parseReceiptRows(interruptedRows);
                const interruptedPlan = planOhlcvBootstrap(universe, sessions, interruptedReceipts, coverage);
                interruptedPlan.receipts = new Map(interruptedReceipts.map((receipt) => [`${receipt.market}|${receipt.sessionDate}`, receipt]));
                const interruptedProgress = buildOhlcvProgress(interruptedPlan, validThrough, clock());
                await guard();
                await db.prepare(progressSql).bind('running', JSON.stringify({ ...interruptedProgress, sessions,
                    through: sessions.at(-1), universeRevision, interruption: error.message }), stamp()).run();
                throw error;
            }
            const receipt = { version: 1, market: target.market, sessionDate: target.sessionDate, status: 'failed', complete: false,
                universeRevision, expectedHash: target.expectedHash, universeEligible: target.universeEligible,
                reason: /^(?:invalid_report_(?:date|schema|universe)|empty_report|invalid_source_date|invalid_ohlcv_receipt)$/.test(error?.message ?? '') ? error.message : 'ohlcv_target_failed' };
            await guard();
            await db.prepare(runSql).bind(`screener-ohlcv:${target.market}:${target.sessionDate}`, 'failed', JSON.stringify(receipt), stamp()).run();
            log({ event: 'ohlcv-period-failed', market: target.market, date: target.sessionDate, reason: receipt.reason });
        }
    }
    const afterRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-period'").all()).results ?? [];
    const afterReceipts = parseReceiptRows(afterRows);
    const afterCoverageRows = (await db.prepare(`SELECT symbol,data_date,market FROM screener_daily_ohlcv WHERE data_date IN (${sessions.map(() => '?').join(',')}) AND validation IN ('canonical-complete-v1','canonical-complete-v2')`).bind(...sessions).all()).results ?? [];
    coverage = buildCoverage(afterCoverageRows, afterReceipts);
    plan = planOhlcvBootstrap(universe, sessions, afterReceipts, coverage);
    plan.receipts = new Map(afterReceipts.map((receipt) => [`${receipt.market}|${receipt.sessionDate}`, receipt]));
    const progress = buildOhlcvProgress(plan, validThrough, clock());
    await guard();
    await db.prepare(progressSql).bind(progress.remaining ? 'running' : 'complete', JSON.stringify({ ...progress, sessions,
        through: sessions.at(-1), universeRevision }), stamp()).run();
    return { state: progress.remaining ? 'pending' : 'complete', requested, progress };
}

/** Retain the latest 60 sessions plus dates referenced by the newest two v3 snapshots. */
export async function pruneScreenerOhlcv(db, sessions) {
    if (!Array.isArray(sessions) || sessions.length !== OHLCV_WINDOW || sessions.some((date) => !isoDate(date))) throw new Error('invalid_ohlcv_retention');
    const keep = new Set(sessions);
    const snapshots = (await db.prepare("SELECT metadata FROM screener_snapshots WHERE status='published' AND schema_version=3 ORDER BY created_at DESC,id DESC LIMIT 2").all()).results ?? [];
    for (const row of snapshots) {
        let metadata;
        try { metadata = JSON.parse(row.metadata); } catch { throw new Error('invalid_snapshot_metadata'); }
        for (const date of metadata?.technicalAnchors?.sessions ?? []) {
            if (!isoDate(date)) throw new Error('invalid_snapshot_metadata');
            keep.add(date);
        }
    }
    const values = [...keep].sort();
    await db.prepare(`DELETE FROM screener_daily_ohlcv WHERE validation='canonical-complete-v1' AND data_date NOT IN (${values.map(() => '?').join(',')})`).bind(...values).run();
    return values;
}

const v4Key = (market, sessionDate) => `${OHLCV_V4_CAPABILITY}|${market}|${sessionDate}`;

export function selectOhlcvV4Sessions(officialCommonSessions, through, receipts = []) {
    if (!Array.isArray(officialCommonSessions) || !isoDate(through) || !Array.isArray(receipts)
        || new Set(officialCommonSessions).size !== officialCommonSessions.length
        || officialCommonSessions.some((date, index) => !isoDate(date) || index > 0 && date <= officialCommonSessions[index - 1]))
        throw new Error('invalid_ohlcv_calendar');
    const failures = new Map(receipts.filter((row) => row?.dataCapability === OHLCV_V4_CAPABILITY
        && row?.status === 'failed' && isoDate(row.sessionDate)).map((row) => [`${row.market}|${row.sessionDate}`, row.reason]));
    const confirmedClosed = new Set(officialCommonSessions.filter((date) => date < through
        && failures.get(`TWSE|${date}`) === 'invalid_report_date'
        && failures.get(`TPEx|${date}`) === 'empty_report'));
    const sessions = officialCommonSessions.filter((date) => date <= through && !confirmedClosed.has(date)).slice(-OHLCV_V4_WINDOW);
    if (sessions.length !== OHLCV_V4_WINDOW || sessions.at(-1) !== through) throw new Error('calendar_coverage_pending');
    return sessions;
}

export function buildOhlcvV4Targets(universe, sessions) {
    if (!Array.isArray(universe) || !Array.isArray(sessions) || sessions.length !== OHLCV_V4_WINDOW
        || new Set(sessions).size !== sessions.length
        || sessions.some((date, index) => !isoDate(date) || index > 0 && date <= sessions[index - 1])
        || universe.some((stock) => !stock || !markets.includes(stock.market) || !/^[1-9]\d{3}\.(?:TW|TWO)$/.test(stock.symbol)
            || stock.listingDate && !isoDate(stock.listingDate))) throw new Error('invalid_ohlcv_v4_plan');
    const targets = [];
    for (const sessionDate of sessions) for (const market of markets) {
        const symbols = universe.filter((stock) => stock.market === market && (!stock.listingDate || stock.listingDate <= sessionDate))
            .map((stock) => stock.symbol).sort();
        if (!symbols.length) throw new Error('invalid_ohlcv_v4_plan');
        targets.push({ key: v4Key(market, sessionDate), dataCapability: OHLCV_V4_CAPABILITY,
            sourceMappingVersion: 'official-daily-ohlcv-v2', market, sessionDate, symbols,
            expectedHash: sha256(symbols.join('\n')), universeEligible: symbols.length });
    }
    return targets;
}

export function planOhlcvV4Bootstrap(universe, sessions, receipts = [], coverageByTarget) {
    const targets = buildOhlcvV4Targets(universe, sessions);
    if (!Array.isArray(receipts)) throw new Error('invalid_ohlcv_v4_receipts');
    const byKey = new Map(receipts.filter((receipt) => receipt?.dataCapability === OHLCV_V4_CAPABILITY)
        .map((receipt) => [v4Key(receipt.market, receipt.sessionDate), receipt]));
    const complete = (target) => {
        const receipt = byKey.get(target.key);
        if (receipt?.status !== 'collected' || receipt.complete !== true
            || receipt.sourceMappingVersion !== target.sourceMappingVersion) return false;
        if (!coverageByTarget) return receipt.expectedHash === target.expectedHash && receipt.universeEligible === target.universeEligible;
        const coverage = coverageByTarget.get(target.key);
        return coverage instanceof Set && target.symbols.every((symbol) => coverage.has(symbol));
    };
    const failed = (target) => {
        const receipt = byKey.get(target.key);
        return receipt?.status === 'failed' && receipt.expectedHash === target.expectedHash;
    };
    const processed = targets.filter(complete).length;
    const work = targets.filter((target) => !complete(target))
        .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || a.market.localeCompare(b.market));
    return { targets, work, target: targets.length, processed, remaining: targets.length - processed,
        failed: targets.filter(failed).length, cursor: work[0]?.key ?? null, receipts: byKey };
}

export function buildOhlcvV4Progress(plan, validThrough, now = Date.now()) {
    if (!plan || !Number.isInteger(plan.target) || !Number.isInteger(plan.processed) || plan.processed < 0 || plan.processed > plan.target
        || !Number.isInteger(plan.failed) || plan.failed < 0 || plan.failed > plan.remaining
        || !Number.isFinite(Date.parse(validThrough))) throw new Error('invalid_ohlcv_v4_progress');
    const rows = Object.fromEntries(markets.map((market) => {
        const marketTargets = plan.targets.filter((target) => target.market === market);
        const pending = new Set(plan.work.filter((target) => target.market === market).map((target) => target.key));
        return [market, { target: marketTargets.length, processed: marketTargets.length - pending.size,
            failed: plan.work.filter((target) => target.market === market).filter((target) => {
                const receipt = plan.receipts?.get?.(target.key); return receipt?.status === 'failed' && receipt.expectedHash === target.expectedHash;
            }).length }];
    }));
    return { version: OHLCV_V4_PROGRESS_VERSION, dataCapability: OHLCV_V4_CAPABILITY,
        target: plan.target, processed: plan.processed, remaining: plan.target - plan.processed, failed: plan.failed,
        overdue: plan.target > plan.processed && now > Date.parse(validThrough) ? plan.target - plan.processed : 0,
        cursor: plan.cursor, markets: rows };
}

function buildV4Coverage(rows, receipts) {
    const coverage = new Map();
    const add = (key, symbol) => { const values = coverage.get(key) ?? new Set(); values.add(symbol); coverage.set(key, values); };
    for (const row of rows) add(v4Key(row.market, row.data_date), row.symbol);
    for (const receipt of receipts.filter((row) => row.dataCapability === OHLCV_V4_CAPABILITY))
        for (const symbol of [...(receipt.invalidSymbols ?? []), ...(receipt.missingSymbols ?? [])]) add(v4Key(receipt.market, receipt.sessionDate), symbol);
    return coverage;
}

const v4RunSql = "INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES (?,'screener-ohlcv-v4-period',?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at";
const v4ProgressSql = "INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES ('screener-ohlcv-v4-progress','screener-ohlcv-v4-progress',?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at";

/** One bounded v4 run. UI/GET never calls this function. */
export async function prepareScreenerOhlcvV4(db, {
    universe, sessions, universeRevision, validThrough, limit = 8, fetcher = fetch,
    pauseMs = 2000, clock = Date.now, guard = async () => {}, log = () => {}, batchSize = 50,
} = {}) {
    if (!db || !universeRevision || !Array.isArray(sessions) || sessions.length !== OHLCV_V4_WINDOW
        || !Number.isInteger(limit) || limit < 1 || limit > 260 || !Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 60000
        || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('invalid_ohlcv_v4_options');
    try { await db.prepare('SELECT volume_shares FROM screener_daily_ohlcv LIMIT 1').first(); }
    catch (error) { if (/no such (?:table|column).*screener_daily_ohlcv|no such column.*volume_shares/.test(String(error))) throw new Error('schema_pending'); throw error; }
    const progressRow = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-ohlcv-v4-progress'").first();
    if (progressRow?.status === 'running') {
        let checkpoint = null;
        try { checkpoint = JSON.parse(progressRow.checkpoint); } catch { /* The planner below replaces corrupt state. */ }
        const samePlan = checkpoint?.version === OHLCV_V4_PROGRESS_VERSION
            && checkpoint?.dataCapability === OHLCV_V4_CAPABILITY
            && checkpoint?.universeRevision === universeRevision
            && Array.isArray(checkpoint?.sessions) && checkpoint.sessions.length === sessions.length
            && checkpoint.sessions.every((date, index) => date === sessions[index]);
        const eligibleAt = Date.parse(checkpoint?.nextEligibleAt ?? '');
        if (samePlan && Number.isFinite(eligibleAt) && clock() < eligibleAt) {
            return { state: 'pending', requested: 0, reason: 'source_cooldown', nextEligibleAt: checkpoint.nextEligibleAt,
                progress: { version: checkpoint.version, dataCapability: checkpoint.dataCapability,
                    target: checkpoint.target, processed: checkpoint.processed, remaining: checkpoint.remaining,
                    failed: checkpoint.failed, overdue: checkpoint.overdue, cursor: checkpoint.cursor, markets: checkpoint.markets } };
        }
    }
    const loadReceipts = async () => parseReceiptRows(((await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-v4-period'").all()).results ?? []));
    let receipts = await loadReceipts();
    const loadCoverage = async () => buildV4Coverage((await db.prepare(`SELECT symbol,data_date,market FROM screener_daily_ohlcv WHERE data_date IN (${sessions.map(() => '?').join(',')}) AND validation='canonical-complete-v2'`).bind(...sessions).all()).results ?? [], receipts);
    let coverage = await loadCoverage(), plan = planOhlcvV4Bootstrap(universe, sessions, receipts, coverage), requested = 0;
    for (const target of plan.work) {
        if (requested >= limit) break;
        await guard();
        if (requested > 0 && pauseMs) await sleep(pauseMs);
        const url = ohlcvHistoryUrl(target.market, target.sessionDate);
        requested++;
        try {
            const result = await boundedOfficialText(url, fetcher, { headers: {
                accept: 'application/json', 'user-agent': 'RealTimeStock/1.0 (local after-market screener)',
            } });
            await guard();
            const provenance = { source: target.market, sourceUrl: url, fetchedAt: result.fetchedAt,
                payloadHash: result.hash, normalizationVersion: 'official-daily-ohlcv-v2' };
            const parsed = parseHistoricalOhlcvV4Report(JSON.parse(result.text), target.market, target.sessionDate, provenance, universe);
            const valid = [...parsed.points.values()];
            for (let offset = 0; offset < valid.length; offset += batchSize) {
                await guard();
                await db.batch(valid.slice(offset, offset + batchSize).map((point) => ohlcvV4UpsertStatement(db, point)));
            }
            const invalidSymbols = [...parsed.invalid.keys()].sort(), missingSymbols = [...parsed.universeMissing].sort();
            const receipt = { version: 2, dataCapability: OHLCV_V4_CAPABILITY, sourceMappingVersion: 'official-daily-ohlcv-v2',
                market: target.market, sessionDate: target.sessionDate, status: 'collected', complete: true,
                universeRevision, expectedHash: target.expectedHash, universeEligible: target.universeEligible,
                valid: valid.length, invalid: invalidSymbols.length, missing: missingSymbols.length,
                invalidSymbols, missingSymbols, payloadHash: result.hash, mapping: parsed.mapping };
            if (receipt.valid + receipt.invalid + receipt.missing !== receipt.universeEligible) throw new Error('invalid_ohlcv_v4_receipt');
            await guard();
            await db.prepare(v4RunSql).bind(`screener-ohlcv-v4:${target.market}:${target.sessionDate}`, 'collected', JSON.stringify(receipt), stamp()).run();
            log({ event: 'ohlcv-v4-period', market: target.market, date: target.sessionDate,
                valid: receipt.valid, invalid: receipt.invalid, missing: receipt.missing });
        } catch (error) {
            const interruptedReason = error?.errcode === 5 || error?.code === 'SQLITE_BUSY'
                ? 'source_local_database_busy' : error?.message;
            if (/^(?:rate_limited|source_(?:blocked|timeout|http_\d{3}|too_large|local_database_busy))$/.test(interruptedReason ?? '')) {
                receipts = await loadReceipts(); coverage = await loadCoverage();
                const interruptedPlan = planOhlcvV4Bootstrap(universe, sessions, receipts, coverage);
                interruptedPlan.receipts = new Map(receipts.map((receipt) => [v4Key(receipt.market, receipt.sessionDate), receipt]));
                const interruptedProgress = buildOhlcvV4Progress(interruptedPlan, validThrough, clock());
                await guard();
                await db.prepare(v4ProgressSql).bind('running', JSON.stringify({ ...interruptedProgress, sessions,
                    through: sessions.at(-1), universeRevision, interruption: interruptedReason,
                    nextEligibleAt: new Date(clock() + Math.max(120000, error.retryAfterMs ?? 0)).toISOString() }), stamp()).run();
                throw error;
            }
            const receipt = { version: 2, dataCapability: OHLCV_V4_CAPABILITY, sourceMappingVersion: 'official-daily-ohlcv-v2',
                market: target.market, sessionDate: target.sessionDate, status: 'failed', complete: false,
                universeRevision, expectedHash: target.expectedHash, universeEligible: target.universeEligible,
                reason: /^(?:invalid_report_(?:date|schema|universe)|empty_report|invalid_source_date|invalid_ohlcv_v4_receipt)$/.test(error?.message ?? '') ? error.message : 'ohlcv_v4_target_failed' };
            await guard();
            await db.prepare(v4RunSql).bind(`screener-ohlcv-v4:${target.market}:${target.sessionDate}`, 'failed', JSON.stringify(receipt), stamp()).run();
            log({ event: 'ohlcv-v4-period-failed', market: target.market, date: target.sessionDate, reason: receipt.reason });
        }
    }
    receipts = await loadReceipts(); coverage = await loadCoverage();
    plan = planOhlcvV4Bootstrap(universe, sessions, receipts, coverage);
    plan.receipts = new Map(receipts.map((receipt) => [v4Key(receipt.market, receipt.sessionDate), receipt]));
    const progress = buildOhlcvV4Progress(plan, validThrough, clock());
    await guard();
    await db.prepare(v4ProgressSql).bind(progress.remaining ? 'running' : 'complete', JSON.stringify({ ...progress, sessions,
        through: sessions.at(-1), universeRevision }), stamp()).run();
    return { state: progress.remaining ? 'pending' : 'complete', requested, progress };
}

/** Retain latest 130 sessions plus dates referenced by newest v3/v4 snapshots. */
export async function pruneScreenerOhlcvV4(db, sessions) {
    if (!Array.isArray(sessions) || sessions.length !== OHLCV_V4_WINDOW || sessions.some((date) => !isoDate(date)))
        throw new Error('invalid_ohlcv_v4_retention');
    const keep = new Set(sessions);
    const snapshots = (await db.prepare("SELECT metadata FROM screener_snapshots WHERE status='published' AND schema_version IN (3,4) ORDER BY created_at DESC,id DESC LIMIT 4").all()).results ?? [];
    for (const row of snapshots) {
        let metadata; try { metadata = JSON.parse(row.metadata); } catch { throw new Error('invalid_snapshot_metadata'); }
        for (const date of metadata?.technicalAnchors?.sessions ?? []) {
            if (!isoDate(date)) throw new Error('invalid_snapshot_metadata');
            keep.add(date);
        }
    }
    const values = [...keep].sort();
    await db.prepare(`DELETE FROM screener_daily_ohlcv WHERE data_date NOT IN (${values.map(() => '?').join(',')})`).bind(...values).run();
    return values;
}
