/** 全市場 OHLC 準備器；一個 target 固定為 market + official session。 */
import { createHash } from 'node:crypto';
import { parseHistoricalOhlcvReport } from '../apps/multiview/worker/stock-screener-sources.ts';
import { ohlcvUpsertStatement } from '../apps/multiview/worker/stock-screener-ohlcv-repository.ts';
import { boundedOfficialText } from './stock-screener-periods.mjs';

export const OHLCV_WINDOW = 60;
export const OHLCV_PROGRESS_VERSION = 3;
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

export function planOhlcvBootstrap(universe, sessions, receipts = []) {
    const targets = buildOhlcvTargets(universe, sessions);
    if (!Array.isArray(receipts)) throw new Error('invalid_ohlcv_receipts');
    const byKey = new Map(receipts.map((receipt) => [`${receipt.market}|${receipt.sessionDate}`, receipt]));
    const complete = (target) => {
        const receipt = byKey.get(target.key);
        return receipt?.status === 'collected' && receipt.complete === true
            && receipt.expectedHash === target.expectedHash && receipt.universeEligible === target.universeEligible;
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
    let plan = planOhlcvBootstrap(universe, sessions, receipts);
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
            if (/^(?:rate_limited|source_(?:blocked|timeout|http_\d{3}|too_large))$/.test(error?.message ?? '')) {
                // A transport interruption must still expose durable progress. Completed
                // receipts remain resumable and no failed target is fabricated for a
                // request whose authoritative body was unavailable.
                const interruptedRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-period'").all()).results ?? [];
                const interruptedReceipts = parseReceiptRows(interruptedRows);
                const interruptedPlan = planOhlcvBootstrap(universe, sessions, interruptedReceipts);
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
    plan = planOhlcvBootstrap(universe, sessions, afterReceipts);
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
    await db.prepare(`DELETE FROM screener_daily_ohlcv WHERE data_date NOT IN (${values.map(() => '?').join(',')})`).bind(...values).run();
    return values;
}
