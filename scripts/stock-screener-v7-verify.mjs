#!/usr/bin/env node
/** 只讀驗證已發布 v7 snapshot；不得抓 provider、建立 DDL、啟動行情或變更清單。 */
import { pathToFileURL } from 'node:url';
import { ScreenerSqlite } from './stock-screener-sqlite.mjs';
import { handleStockScreener } from '../apps/multiview/worker/stock-screener-route.ts';
import { screenerSearchV7 } from '../src/lib/stock-screener-api.ts';
import { disableAllStockScreenerConditions } from '../src/lib/stock-screener-condition-ui.ts';
import { DEFAULT_CRITERIA_V7 } from '../src/lib/stock-screener-v7.ts';

const modes = [
  ['bollPosition', 'upper-outside'], ['bollPosition', 'lower-outside'], ['bollPosition', 'middle-near'],
  ['rsiCross', 'high-death-cross'], ['rsiCross', 'low-golden-cross'],
  ['kdCross', 'high-death-cross'], ['kdCross', 'low-golden-cross'],
  ['macdSignal', 'approach-zero-below'], ['macdSignal', 'approach-zero-above'],
  ['macdSignal', 'cross-zero-up'], ['macdSignal', 'cross-zero-down'],
  ['macdSignal', 'below-zero-golden-cross'], ['macdSignal', 'below-zero-death-cross'],
  ['macdSignal', 'above-zero-golden-cross'], ['macdSignal', 'above-zero-death-cross'],
  ['macdSignal', 'any-golden-cross'], ['macdSignal', 'any-death-cross'],
];

const clone = (value) => structuredClone(value);
const baseCriteria = () => disableAllStockScreenerConditions(clone(DEFAULT_CRITERIA_V7));
const tableCounts = async (db) => Object.fromEntries(await Promise.all([
  'user_tabs', 'user_instruments', 'screener_chip_receipts', 'screener_tdcc_weekly', 'screener_snapshots',
].map(async (table) => [table, Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n)])));

async function request(db, criteria, resultState = 'pass', cursor) {
  const search = screenerSearchV7({ criteria, sort: 'code', direction: 'asc', resultState, ...(cursor ? { cursor } : {}) });
  const response = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${search}`),
    { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date());
  const body = await response.json();
  if (!response.ok || body.version !== 7) throw new Error('v7_query_failed');
  return body;
}

export async function verifyStockScreenerV7(db) {
  const beforeChanges = Number((await db.prepare('SELECT total_changes() AS n').first()).n);
  const beforeTables = await tableCounts(db);
  const results = [];
  for (const [branch, mode] of modes) {
    const criteria = baseCriteria();
    criteria[branch].enabled = true;
    criteria[branch].mode = mode;
    const body = await request(db, criteria);
    const counts = body.counts;
    if (!counts || counts.matched + counts.notMatched + counts.unknown !== counts.total) throw new Error('v7_conservation_failed');
    results.push({ branch, mode, state: body.state, total: counts.total, pass: counts.matched,
      fail: counts.notMatched, unknown: counts.unknown, representative: body.rows[0]?.symbol ?? null,
      evidenceHash: body.rows[0]?.technicalV7?.evidenceHash ?? null });
  }

  const paginationCriteria = baseCriteria();
  paginationCriteria.bollPosition.enabled = true;
  paginationCriteria.bollPosition.mode = 'upper-outside';
  const symbols = [], pageSizes = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const body = await request(db, paginationCriteria, 'pass', cursor);
    pageSizes.push(body.rows.length);
    symbols.push(...body.rows.map((row) => row.symbol));
    cursor = body.nextCursor ?? undefined;
    if (!cursor) {
      if (symbols.length !== body.counts.matched || new Set(symbols).size !== symbols.length) throw new Error('v7_pagination_failed');
      break;
    }
    if (page === 99) throw new Error('v7_pagination_limit');
  }

  const volumeCriteria = baseCriteria();
  volumeCriteria.bollPosition.enabled = true;
  volumeCriteria.bollPosition.mode = 'upper-outside';
  volumeCriteria.bollPosition.volumeConfirmation.enabled = true;
  volumeCriteria.bollPosition.volumeConfirmation.ratio = '1';
  const volume = await request(db, volumeCriteria);
  const representative = volume.rows[0]?.technicalV7?.outcomes?.bollPosition?.volumeConfirmation ?? null;
  if (representative && (representative.baselineDates.includes(representative.sessionDate)
    || representative.baselineDates.length !== volumeCriteria.bollPosition.volumeConfirmation.baselineDays)) {
    throw new Error('v7_volume_baseline_failed');
  }

  const afterChanges = Number((await db.prepare('SELECT total_changes() AS n').first()).n);
  const afterTables = await tableCounts(db);
  if (afterChanges !== beforeChanges || JSON.stringify(afterTables) !== JSON.stringify(beforeTables)) throw new Error('v7_read_side_effect');
  const uiCandidate = symbols[100] ?? null;
  const uiCandidatePersonalRows = uiCandidate
    ? Number((await db.prepare('SELECT COUNT(*) AS n FROM user_instruments WHERE symbol=? AND enabled=1').bind(uiCandidate).first()).n)
    : null;
  if (uiCandidate && uiCandidatePersonalRows !== 0) throw new Error('v7_ui_candidate_is_personal');
  const first = await request(db, paginationCriteria);
  return { version: 7, snapshotId: first.snapshotId, effectiveSessionDate: first.effectiveSessionDate,
    formulaVersion: first.formulaVersion, sourceMappingVersion: first.sourceMappingVersion,
    technicalCoverage: first.technicalCoverage, modes: results,
    pagination: { mode: 'upper-outside', pages: pageSizes.length, pageSizes, uniqueRows: symbols.length,
      candidateBeyondTop100: uiCandidate, candidatePersonalRows: uiCandidatePersonalRows },
    volumeBaseline: representative ? { sessionDate: representative.sessionDate,
      baselineDates: representative.baselineDates, ratio: representative.ratio,
      averageVolumeShares: representative.averageVolumeShares } : { representative: null, pass: volume.counts?.matched ?? 0 },
    sideEffects: { totalChanges: afterChanges - beforeChanges, before: beforeTables, after: afterTables } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.slice(2);
  const database = arg.find((value) => value.startsWith('--database='))?.slice(11);
  if (!database || arg.length !== 1 || !database.startsWith('/')) throw new Error('使用方式：--database=/absolute/local.sqlite');
  const db = new ScreenerSqlite(database);
  try { console.log(JSON.stringify(await verifyStockScreenerV7(db), null, 2)); }
  catch (error) { console.error(JSON.stringify({ state: 'failed', reason: error instanceof Error ? error.message : 'unknown' })); process.exitCode = 1; }
  finally { db.close(); }
}
