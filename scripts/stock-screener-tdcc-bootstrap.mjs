/**
 * One-time, operator-only TDCC history bootstrap.
 *
 * The transport mirror is pinned to an immutable Git commit and raw-byte hash.
 * It is never enabled by schedule, environment variable, query parameter or UI.
 */
import { createHash } from 'node:crypto';
import { validateTdcc } from '../src/lib/stock-screener-domain.ts';
import { fetchScreenerSource, parseHolderBatch, SCREENER_SOURCES } from '../apps/multiview/worker/stock-screener-sources.ts';

export const TDCC_ARCHIVE_COMMIT = '17944774a7a37c8ef52a7ca919817fe6f949891c';
const ARCHIVE_BASE = `https://raw.githubusercontent.com/wirelessr/tdcc-opendata-archive/${TDCC_ARCHIVE_COMMIT}/snapshots/2026`;
export const PINNED_TDCC_BOOTSTRAP = Object.freeze([
  { date: '2026-07-24', bytes: 2341148, sha256: '91867bb70afebf5a6b7c3eb7cab86928875bf854a79f6d6dcc4496729d8b0a54' },
  { date: '2026-07-31', bytes: 2344332, sha256: '7ad5886e994418975b72e100be97d8782e8ed320e5428fc253d5817e886aaf44' },
  { date: '2026-08-07', bytes: 2347711, sha256: 'c7cb74ae2e093ac145bfb9d5b2b153069b7f1e1f5e9603f8dec882d72ccc9ad6' },
  { date: '2026-08-14', bytes: 2348999, sha256: '6098051708b362ac0215606174d539c40cac91902467b83f4c9da471a19adf8c' },
  { date: '2026-08-21', bytes: 2352208, sha256: '4582e2ed52cc4fd48c4f7f6f858291f2c2937fbfa3084c3d44dc58f202eaeaa1' },
  { date: '2026-08-28', bytes: 2359165, sha256: '95960f0f828ade074a2e817ce42202488fd3e53522e07b8b8656ff0f469b3dd1' },
].map(entry => Object.freeze({ ...entry, url: `${ARCHIVE_BASE}/${entry.date}.csv` })));

const HEADERS = ['資料日期', '證券代號', '持股分級', '人數', '股數', '占集保庫存數比例%'];
const NORMALIZATION = 'screener-official-v1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalRow = row => HEADERS.map(header => {
  const entry = Object.entries(row).find(([key]) => key.replace(/^\uFEFF/, '').trim() === header);
  if (!entry) throw new Error('archive_official_anchor_invalid');
  return String(entry[1] ?? '').trim();
}).join('|');

export function parsePinnedTdccCsv(bytes, entry, { minimumRows = 30000, minimumSymbols = 3000 } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error('archive_hash_mismatch');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('archive_invalid_utf8'); }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length < minimumRows + 1 || lines.length > 100001 || lines.some(line => line === '')) throw new Error('archive_invalid_row_count');
  const headers = lines.shift().replace(/^\uFEFF/, '').split(',').map(value => value.trim());
  if (headers.length !== HEADERS.length || headers.some((value, index) => value !== HEADERS[index])) throw new Error('archive_invalid_headers');
  const rows = [];
  const byCode = new Map();
  const expectedDate = entry.date.replaceAll('-', '');
  for (const line of lines) {
    const cells = line.split(',');
    if (cells.length !== HEADERS.length) throw new Error('archive_invalid_csv');
    const row = Object.fromEntries(HEADERS.map((header, index) => [header, cells[index].trim()]));
    const code = row['證券代號'];
    const level = Number(row['持股分級']);
    if (row['資料日期'] !== expectedDate || !/^[0-9A-Z]{4,12}$/.test(code) || !Number.isInteger(level) || level < 1 || level > 17) throw new Error('archive_invalid_row');
    const key = `${code}|${level}`;
    if (byCode.has(key)) throw new Error('archive_duplicate_level');
    byCode.set(key, true);
    rows.push(row);
  }
  const grouped = new Map();
  for (const row of rows) {
    const code = row['證券代號'];
    const bands = grouped.get(code) ?? [];
    bands.push({ level: Number(row['持股分級']), holders: row['人數'], shares: row['股數'], ratio: row['占集保庫存數比例%'] });
    grouped.set(code, bands);
  }
  if (grouped.size < minimumSymbols) throw new Error('archive_invalid_symbol_count');
  const validationProvenance = { source: 'TDCC', sourceUrl: entry.url, fetchedAt: '1970-01-01T00:00:00.000Z', payloadHash: entry.sha256, normalizationVersion: NORMALIZATION };
  for (const bands of grouped.values()) if (validateTdcc({ date: entry.date, bands, provenance: validationProvenance }) !== 'none') throw new Error('archive_invalid_tdcc');
  return { ...entry, rows, rowCount: rows.length, symbolCount: grouped.size };
}

export async function fetchPinnedTdccCsv(entry, fetcher = fetch, timeoutMs = 30000) {
  if (!PINNED_TDCC_BOOTSTRAP.some(item => item.url === entry.url && item.date === entry.date && item.bytes === entry.bytes && item.sha256 === entry.sha256)) throw new Error('archive_source_not_allowed');
  const controller = new AbortController();
  let timer;
  const work = (async () => {
    const response = await fetcher(entry.url, { signal: controller.signal, redirect: 'error', headers: { 'accept-encoding': 'identity' } });
    if (!response.ok) throw new Error(`archive_http_${response.status}`);
    const declared = Number(response.headers?.get('content-length') ?? entry.bytes);
    if (Number.isFinite(declared) && declared > 4 * 1024 * 1024) throw new Error('archive_too_large');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new Error('archive_too_large');
    return parsePinnedTdccCsv(bytes, entry);
  })();
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('archive_timeout')); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Download and validate every pinned file before returning any writable rows. */
export async function preparePinnedTdccBootstrap(historyWeeks, universe, fetcher = fetch) {
  if (!Array.isArray(historyWeeks) || historyWeeks.length !== PINNED_TDCC_BOOTSTRAP.length
      || historyWeeks.some((date, index) => date !== PINNED_TDCC_BOOTSTRAP[index].date)) throw new Error('archive_period_mismatch');
  const snapshots = [];
  for (const entry of PINNED_TDCC_BOOTSTRAP) snapshots.push(await fetchPinnedTdccCsv(entry, fetcher));
  const fetchedAt = new Date().toISOString();
  const parsed = snapshots.map(snapshot => {
    const eligible = universe.filter(stock => !stock.listingDate || stock.listingDate <= snapshot.date);
    const provenance = { source: 'TDCC', sourceUrl: snapshot.url, fetchedAt, payloadHash: snapshot.sha256, normalizationVersion: NORMALIZATION };
    const result = parseHolderBatch(snapshot.rows, eligible, provenance);
    if (result.date !== snapshot.date || result.invalid.size) throw new Error('archive_invalid_universe_rows');
    return { ...snapshot, eligible, points: result.points, provenance };
  });
  const latest = parsed.at(-1);
  const officialResult = await fetchScreenerSource(SCREENER_SOURCES.tdcc, fetcher);
  if (!Array.isArray(officialResult.payload)) throw new Error('archive_official_anchor_invalid');
  const archiveRows = latest.rows.map(canonicalRow).sort();
  const officialRows = officialResult.payload.map(canonicalRow).sort();
  if (archiveRows.length !== officialRows.length || archiveRows.some((row, index) => row !== officialRows[index])) throw new Error('archive_official_anchor_mismatch');
  return { commit: TDCC_ARCHIVE_COMMIT, fetchedAt, snapshots: parsed,
    latestAnchor: { date: latest.date, compared: officialRows.length, sourceUrl: SCREENER_SOURCES.tdcc, payloadHash: officialResult.payloadHash } };
}
