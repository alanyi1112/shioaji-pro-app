#!/usr/bin/env node
/** 只續跑已發布 v2 母體所需的全市場 OHLC；不碰服務、TDCC、交易或行情連線。 */
import { pathToFileURL } from 'node:url';
import { ScreenerSqlite } from './stock-screener-sqlite.mjs';
import { prepareScreenerOhlcv, pruneScreenerOhlcv, selectOhlcvSessions } from './stock-screener-ohlcv-bootstrap.mjs';
import { readScreenerSnapshot } from '../apps/multiview/worker/stock-screener-repository.ts';
import { publishPreparedScreenerV3 } from '../apps/multiview/worker/stock-screener-v3-publisher.ts';

export async function resumeScreenerOhlcv(db, { limit = 120, pauseMs = 2000, log = () => {} } = {}) {
    const base = await readScreenerSnapshot(db, undefined, 2);
    if (!base || base.metadata.version !== 2 || !base.metadata.anchors?.daily?.current) throw new Error('v2_snapshot_pending');
    const calendarRow = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-period-evidence' AND status='verified'").first();
    if (!calendarRow) throw new Error('calendar_coverage_pending');
    const calendar = JSON.parse(calendarRow.checkpoint);
    const receiptRows = (await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE scope='screener-ohlcv-period'").all()).results ?? [];
    const receipts = receiptRows.flatMap((row) => { try { return [{ ...JSON.parse(row.checkpoint), status: row.status }]; } catch { return []; } });
    const sessions = selectOhlcvSessions(calendar.sessions, base.metadata.anchors.daily.current, receipts);
    const result = await prepareScreenerOhlcv(db, { universe: base.inputs, sessions,
        universeRevision: base.metadata.universeRevision, validThrough: base.metadata.validThrough,
        limit, pauseMs, log });
    const snapshot = result.state === 'complete' ? await publishPreparedScreenerV3(db) : { state: 'pending', reason: 'ohlcv_bootstrap_pending' };
    if (result.state === 'complete') await pruneScreenerOhlcv(db, sessions);
    return { ...result, technicalSnapshot: snapshot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2), database = args.find((arg) => arg.startsWith('--database='))?.slice(11);
    const limit = Number(args.find((arg) => arg.startsWith('--limit='))?.slice(8) ?? 120);
    const pauseMs = Number(args.find((arg) => arg.startsWith('--pause-ms='))?.slice(11) ?? 2000);
    if (!database || args.some((arg) => !/^(?:--database=\/.+|--limit=\d+|--pause-ms=\d+)$/.test(arg)))
        throw new Error('使用方式：--database=/absolute/local.sqlite [--limit=120] [--pause-ms=2000]');
    let db;
    try {
        db = new ScreenerSqlite(database);
        const result = await resumeScreenerOhlcv(db, { limit, pauseMs, log: (value) => console.log(JSON.stringify(value)) });
        console.log(JSON.stringify(result));
        if (result.state !== 'complete') process.exitCode = 2;
    } catch (error) {
        console.error(JSON.stringify({ state: 'pending', reason: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'ohlcv_resume_failed' }));
        process.exitCode = 1;
    } finally { db?.close(); }
}
