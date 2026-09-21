#!/usr/bin/env node
/**
 * 本機唯讀全市場稽核：不抓外部來源、不寫 D1、不管理 runtime。
 * 從 canonical OHLC 重新計算技術證據，再與 immutable snapshot 及 GET 分頁集合比對。
 */
import { pathToFileURL } from 'node:url';
import { ScreenerSqlite } from './stock-screener-sqlite.mjs';
import { buildTechnicalSnapshotEvidence } from '../apps/multiview/worker/stock-screener-v3-publisher.ts';
import { readScreenerV3Snapshot } from '../apps/multiview/worker/stock-screener-v3-repository.ts';
import { handleStockScreener } from '../apps/multiview/worker/stock-screener-route.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
import { hasAlignedSessionEvidence } from '../src/lib/stock-screener-domain.ts';

const modes = [
  { key: 'rawBottom', query: 'fractal=true&fractalAlgorithm=raw-three&fractalDirection=bottom&bollReversal=false' },
  { key: 'rawTop', query: 'fractal=true&fractalAlgorithm=raw-three&fractalDirection=top&bollReversal=false' },
  { key: 'chanBottom', query: 'fractal=true&fractalAlgorithm=chan-containment&fractalDirection=bottom&bollReversal=false' },
  { key: 'chanTop', query: 'fractal=true&fractalAlgorithm=chan-containment&fractalDirection=top&bollReversal=false' },
  { key: 'lowerBullish', query: 'fractal=false&bollReversal=true&bollMode=lower-bullish' },
  { key: 'upperBearish', query: 'fractal=false&bollReversal=true&bollMode=upper-bearish' },
];

async function readAllOhlcv(db, first, last) {
  const rows = [];
  for (let offset = 0; ; offset += 5000) {
    const page = (await db.prepare("SELECT symbol,data_date,open,high,low,close FROM screener_daily_ohlcv WHERE data_date>=? AND data_date<=? AND validation IN ('canonical-complete-v1','canonical-complete-v2') ORDER BY symbol,data_date LIMIT ? OFFSET ?")
      .bind(first, last, 5000, offset).all()).results ?? [];
    rows.push(...page);
    if (page.length < 5000) return rows;
  }
}

async function apiPassSymbols(db, query) {
  const symbols = [];
  let cursor = '';
  do {
    const url = `http://127.0.0.1/api/stock-screener/results?version=3&mode=all&volume=false&holder=false&${query}&sort=code&direction=asc&resultState=pass&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await handleStockScreener(new Request(url), { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date());
    if (!response?.ok) throw new Error(`api_verification_failed_${response?.status ?? 'none'}`);
    const body = await response.json();
    if (!['ready', 'partial'].includes(body.state) || body.expectedSessionDate !== body.technicalAnchors?.through)
      throw new Error(`api_not_current_${body.reason}`);
    symbols.push(...body.rows.map((row) => row.symbol));
    cursor = body.nextCursor ?? '';
  } while (cursor);
  return symbols;
}

export async function verifyStockScreenerV3(db) {
  const snapshot = await readScreenerV3Snapshot(db);
  if (!snapshot) throw new Error('v3_snapshot_missing');
  const { metadata } = snapshot;
  if (!hasAlignedSessionEvidence({ expectedSessionDate: metadata.expectedSessionDate,
    daily: metadata.anchors.daily, technicalThrough: metadata.technicalAnchors.through,
    effectiveSessionDate: metadata.effectiveSessionDate })) throw new Error('mixed_session_dates');
  if (metadata.progress.remaining || metadata.progress.failed || metadata.progress.overdue) throw new Error('progress_incomplete');

  const sessions = metadata.technicalAnchors.sessions;
  const rows = await readAllOhlcv(db, sessions[0], sessions.at(-1));
  const bySymbol = new Map();
  for (const row of rows) {
    const values = bySymbol.get(row.symbol) ?? [];
    values.push({ sessionDate: row.data_date, open: row.open, high: row.high, low: row.low, close: row.close });
    bySymbol.set(row.symbol, values);
  }
  const recomputed = new Map();
  let checkedEvidence = 0;
  for (const input of snapshot.inputs) {
    const eligible = sessions.filter((date) => !input.listingDate || date >= input.listingDate);
    const bars = (bySymbol.get(input.symbol) ?? []).filter((bar) => eligible.includes(bar.sessionDate));
    const technical = await buildTechnicalSnapshotEvidence(bars, eligible);
    const { evidenceHash, ...savedEvidence } = input.technical;
    if (await technicalEvidenceHash(savedEvidence) !== evidenceHash || JSON.stringify(technical) !== JSON.stringify(input.technical))
      throw new Error(`evidence_mismatch_${input.symbol}`);
    recomputed.set(input.symbol, technical);
    checkedEvidence++;
  }

  const passCounts = {};
  for (const mode of modes) {
    const expected = [...recomputed].filter(([, evidence]) => evidence[mode.key].verdict === 'pass').map(([symbol]) => symbol).sort();
    const actual = (await apiPassSymbols(db, mode.query)).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`api_set_mismatch_${mode.key}`);
    passCounts[mode.key] = actual.length;
  }
  return { state: 'verified', snapshotId: snapshot.id, effectiveSessionDate: metadata.effectiveSessionDate,
    universeRevision: metadata.universeRevision, total: metadata.total, checkedEvidence,
    sessions: sessions.length, firstSession: sessions[0], lastSession: sessions.at(-1), passCounts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--database='));
  if (!argument || process.argv.slice(2).some((value) => !value.startsWith('--database=/'))) throw new Error('使用方式：--database=/absolute/local.sqlite');
  const db = new ScreenerSqlite(argument.slice('--database='.length));
  try { console.log(JSON.stringify(await verifyStockScreenerV3(db))); }
  finally { db.close(); }
}
