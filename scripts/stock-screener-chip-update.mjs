#!/usr/bin/env node
/** 本機全市場籌碼維護；只寫 screener_chip_* 與 v5 immutable snapshot，不碰 broker、行情或個人清單。 */
import { pathToFileURL } from 'node:url';
import { ScreenerSqlite } from './stock-screener-sqlite.mjs';
import { readScreenerV4Snapshot } from '../apps/multiview/worker/stock-screener-v4-repository.ts';
import { collectScreenerChipSession } from '../apps/multiview/worker/stock-screener-chip-collector.ts';
import { publishPreparedScreenerV5 } from '../apps/multiview/worker/stock-screener-v5-publisher.ts';
import { chipDownloadDecision } from '../apps/multiview/worker/stock-screener-chip-policy.ts';

export async function updateScreenerChip(db, { limit = 1, publishOnly = false, fetcher = fetch } = {}) {
  const base = await readScreenerV4Snapshot(db);
  if (!base) return { state: 'pending', reason: 'v4_snapshot_pending' };
  const required = base.metadata.technicalAnchors.sessions.slice(-21);
  const receipts = (await db.prepare(`SELECT requested_date,market,dataset,status FROM screener_chip_receipts
    WHERE requested_date>=? AND requested_date<=?`).bind(required[0], required.at(-1)).all()).results ?? [];
  const verified = new Set(receipts.filter(row => row.status === 'verified').map(row => `${row.requested_date}|${row.market}|${row.dataset}`));
  const pending = required.filter(date => ['TWSE','TPEx'].some(market => ['institutional-flow','margin-short']
    .some(dataset => !verified.has(`${date}|${market}|${dataset}`))));
  const collected = [];
  const now = new Date();
  const policies = (await db.prepare("SELECT id,checkpoint FROM screener_runs WHERE scope='screener-chip-policy' AND status='waiting'").all()).results ?? [];
  const retryByKey = new Map(policies.map(row => [row.id, JSON.parse(row.checkpoint)]));
  const waiting = [];
  const due = pending.filter(date => {
    let ready = false;
    for (const market of ['TWSE', 'TPEx']) for (const dataset of ['institutional-flow', 'margin-short']) {
      if (verified.has(`${date}|${market}|${dataset}`)) continue;
      const decision = chipDownloadDecision(date, dataset, now, retryByKey.get(`screener-chip-policy:${date}:${market}:${dataset}`));
      if (decision.allowed) ready = true;
      else waiting.push({ date, market, dataset, ...decision });
    }
    return ready;
  });
  if (!publishOnly && pending.length && !due.length) return { state: 'pending', reason: 'reports_waiting',
    requiredSessions: required.length, remainingSessions: pending.length, collected, waiting };
  // Reserve a slot for the current session; history has its own bounded budget.
  const latest = required.at(-1);
  const work = [...(due.includes(latest) ? [latest] : []), ...due.filter(date => date !== latest).slice(0, limit)];
  if (!publishOnly) for (const date of work) {
    collected.push(await collectScreenerChipSession(db, date, { fetcher }));
    if (pending.length > 1) await new Promise(resolve => setTimeout(resolve, 500));
  }
  const afterRows = (await db.prepare(`SELECT requested_date,market,dataset,status FROM screener_chip_receipts
    WHERE requested_date>=? AND requested_date<=?`).bind(required[0], required.at(-1)).all()).results ?? [];
  const afterVerified = new Set(afterRows.filter(row => row.status === 'verified').map(row => `${row.requested_date}|${row.market}|${row.dataset}`));
  const remaining = required.filter(date => ['TWSE','TPEx'].some(market => ['institutional-flow','margin-short']
    .some(dataset => !afterVerified.has(`${date}|${market}|${dataset}`)))).length;
  const publication = await publishPreparedScreenerV5(db);
  return { state: publication.state, requiredSessions: required.length, remainingSessions: remaining,
    collected, publication };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), database = args.find(arg => arg.startsWith('--database='))?.slice(11);
  const limit = Number(args.find(arg => arg.startsWith('--limit='))?.slice(8) ?? '1');
  if (!database || !Number.isInteger(limit) || limit < 1 || limit > 21
    || args.some(arg => !/^(?:--database=\/.+|--limit=\d+|--publish-only)$/.test(arg))) {
    throw new Error('使用方式：--database=/absolute/local.sqlite [--limit=1..21] [--publish-only]');
  }
  let db;
  try { db = new ScreenerSqlite(database); console.log(JSON.stringify(await updateScreenerChip(db, { limit, publishOnly: args.includes('--publish-only') }))); }
  catch (error) { console.error(JSON.stringify({ state: 'failed', reason: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'chip_update_failed' })); process.exitCode = 1; }
  finally { db?.close(); }
}
