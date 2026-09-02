/**
 * One-time, operator-only TDCC history bootstrap.
 *
 * The transport mirror is pinned to an immutable Git commit and raw-byte hash.
 * It is never enabled by schedule, environment variable, query parameter or UI.
 */
import { createHash } from 'node:crypto';
import {
  canonicalTdccArchiveRow,
  fetchTdccArchiveCsv,
  parseTdccArchiveCsvWithDigest,
  TDCC_ARCHIVE_COMMIT,
  TDCC_ARCHIVE_MANIFEST,
  TDCC_ARCHIVE_NORMALIZATION_VERSION,
} from '../src/lib/tdcc-archive-validator.ts';
import { fetchScreenerSource, parseHolderBatch, SCREENER_SOURCES } from '../apps/multiview/worker/stock-screener-sources.ts';

export { TDCC_ARCHIVE_COMMIT };
export const PINNED_TDCC_BOOTSTRAP = Object.freeze(TDCC_ARCHIVE_MANIFEST.slice(-6));

const NORMALIZATION = TDCC_ARCHIVE_NORMALIZATION_VERSION;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function parsePinnedTdccCsv(bytes, entry, { minimumRows = 30000, minimumSymbols = 3000 } = {}) {
  return parseTdccArchiveCsvWithDigest(bytes, entry, sha256(bytes), {
    minimumRows,
    minimumSymbols,
    requireAllowlisted: !minimumRows || minimumRows >= 30000,
  });
}

export async function fetchPinnedTdccCsv(entry, fetcher = fetch, timeoutMs = 30000) {
  if (!PINNED_TDCC_BOOTSTRAP.includes(entry)) throw new Error('archive_source_not_allowed');
  return fetchTdccArchiveCsv(entry, fetcher, timeoutMs);
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
  const archiveRows = latest.rows.map(canonicalTdccArchiveRow).sort();
  const officialRows = officialResult.payload.map(canonicalTdccArchiveRow).sort();
  if (archiveRows.length !== officialRows.length || archiveRows.some((row, index) => row !== officialRows[index])) throw new Error('archive_official_anchor_mismatch');
  return { commit: TDCC_ARCHIVE_COMMIT, fetchedAt, snapshots: parsed,
    latestAnchor: { date: latest.date, compared: officialRows.length, sourceUrl: SCREENER_SOURCES.tdcc, payloadHash: officialResult.payloadHash } };
}
