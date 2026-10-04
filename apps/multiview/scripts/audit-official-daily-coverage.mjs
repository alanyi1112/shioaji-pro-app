#!/usr/bin/env node
/** Read-only per-symbol D1 reconciliation; never updates continuity receipts. */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { parseTwseOfficialCalendar, parseTpexOfficialCalendar, buildOfficialMarketCalendarSnapshot } from '../../../scripts/smart-order-runtime/official-market-calendar-core.mjs';
import { resolveOfficialCompletedSession } from '../worker/official-trading-session.ts';

const dbPath = process.argv[2];
const fromArg = process.argv[3];
if (!dbPath || process.argv.length > 4 || fromArg && !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) throw new Error('請指定本機 D1 SQLite 檔案路徑及可選起日 YYYY-MM-DD；本工具只讀取資料。');

async function officialJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`calendar_source_http_${response.status}`);
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('calendar_source_too_large');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

async function officialSessions(year) {
  const [twse, tpex] = await Promise.all([
    officialJson(`https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=${year - 1911}`),
    officialJson(`https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=${year}`),
  ]);
  const snapshot = buildOfficialMarketCalendarSnapshot({
    twse: parseTwseOfficialCalendar(twse, year),
    tpex: parseTpexOfficialCalendar(tpex, year),
    fetchedAtEpochMs: Date.now(),
  });
  return { version: snapshot.calendarVersion, dates: snapshot.days.filter((day) => day.TSE === 'scheduled_trading').map((day) => day.tradeDate) };
}

const now = new Date();
const expected = await resolveOfficialCompletedSession(now);
if (!expected.expectedSession || expected.status !== 'verified') throw new Error(`calendar_authority_unavailable:${expected.reasonCode}`);
const scopeStart = fromArg || `${expected.expectedSession.slice(0, 7)}-01`;
if (scopeStart > expected.expectedSession || Number(expected.expectedSession.slice(0, 4)) - Number(scopeStart.slice(0, 4)) > 2) throw new Error('稽核日期範圍無效或過長');
const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
try {
  const symbols = db.prepare(`SELECT DISTINCT UPPER(symbol) AS symbol FROM user_instruments
    WHERE enabled=1 AND (UPPER(symbol) LIKE '%.TW' OR UPPER(symbol) LIKE '%.TWO') ORDER BY symbol`).all().map((row) => row.symbol);
  const rows = db.prepare(`SELECT symbol, date(datetime(time,'unixepoch','+8 hours')) AS session_date
    FROM candle_history WHERE provider='yfinance' AND interval='1d' ORDER BY symbol,time`).all();
  const states = db.prepare(`SELECT symbol,continuity_status,continuity_through,missing_session_count,
    continuity_reason_code,continuity_checked_at FROM candle_history_state
    WHERE provider='yfinance' AND interval='1d'`).all();
  const datesBySymbol = new Map();
  for (const row of rows) {
    if (!datesBySymbol.has(row.symbol)) datesBySymbol.set(row.symbol, new Set());
    datesBySymbol.get(row.symbol).add(row.session_date);
  }
  const stateBySymbol = new Map(states.map((row) => [row.symbol, row]));
  const years = [];
  for (let year = Number(scopeStart.slice(0, 4)); year <= Number(expected.expectedSession.slice(0, 4)); year++) years.push(await officialSessions(year));
  const sessions = years.flatMap((entry) => entry.dates).filter((date) => date >= scopeStart && date <= expected.expectedSession);
  const items = symbols.map((symbol) => {
    const dates = [...datesBySymbol.get(symbol) || []].sort();
    const state = stateBySymbol.get(symbol);
    const first = dates[0] || null;
    const last = dates.at(-1) || null;
    const candidateMissing = first ? sessions.filter((date) => date >= first && !datesBySymbol.get(symbol).has(date)) : [];
    const status = state?.continuity_status || 'unknown';
    const verifiedLatest = Boolean(last && last >= expected.expectedSession && status === 'complete'
      && state.continuity_through >= expected.expectedSession && !Number(state.missing_session_count));
    return {
      symbol, first, last, rowCount: dates.length, latestRowPresent: datesBySymbol.get(symbol)?.has(expected.expectedSession) || false,
      candidateMissing, continuityStatus: status, continuityThrough: state?.continuity_through || null,
      confirmedMissingCount: Number(state?.missing_session_count || 0), reasonCode: state?.continuity_reason_code || null,
      lastChecked: state?.continuity_checked_at || null, verifiedLatest,
    };
  });
  console.log(JSON.stringify({ checkedAt: now.toISOString(), scopeStart, expectedSession: expected.expectedSession,
    officialCalendarVersions: years.map((entry) => entry.version), symbolCount: items.length,
    latestRowPresent: items.filter((item) => item.latestRowPresent).length,
    verifiedLatest: items.filter((item) => item.verifiedLatest).length,
    candidateMissingSymbols: items.filter((item) => item.candidateMissing.length).length, items }, null, 2));
} finally { db.close(); }
