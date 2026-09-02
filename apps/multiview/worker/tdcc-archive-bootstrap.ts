import {
  compareCanonicalTdccRows,
  fetchTdccArchiveCsv,
  TDCC_ARCHIVE_COMMIT,
  TDCC_ARCHIVE_MANIFEST,
  TDCC_ARCHIVE_MANIFEST_VERSION,
  TDCC_ARCHIVE_NORMALIZATION_VERSION,
  TDCC_ARCHIVE_VALIDATOR_VERSION,
  tdccArchiveSha256,
  type TdccArchiveManifestEntry,
} from "../../../src/lib/tdcc-archive-validator.ts";
import { runD1Batch } from "./d1-batch.ts";
import { parseTdccSnapshot, type DistributionRow } from "./taiwan-stock-chip.ts";
import { mergeUniverses, parseUniverse, SCREENER_SOURCES } from "./stock-screener-sources.ts";

export const TDCC_ARCHIVE_RUN_ID = `${TDCC_ARCHIVE_MANIFEST_VERSION}:full-market`;
export const TDCC_ARCHIVE_SCOPE = "full-market";
const OFFICIAL_LATEST_URL = "https://openapi.tdcc.com.tw/v1/opendata/1-5";
const TWSE_CATALOG_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TPEX_CATALOG_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes";
const LEASE_SECONDS = 180;

type ReceiptRow = {
  receipt_id: string;
  data_date: string;
  status: string;
  staged_symbol_count: number;
  material_hash: string;
  normalization_version?: string;
};

function isoNow() {
  return new Date().toISOString();
}

export function assertTdccArchiveRequestContract(manifestVersion: unknown, scope: unknown) {
  if (manifestVersion !== TDCC_ARCHIVE_MANIFEST_VERSION || scope !== TDCC_ARCHIVE_SCOPE) {
    throw new Error("archive_request_contract_mismatch");
  }
}

function receiptId(date: string) {
  return `${TDCC_ARCHIVE_MANIFEST_VERSION}:${date}`;
}

function entryForDate(date: string): TdccArchiveManifestEntry {
  const entry = TDCC_ARCHIVE_MANIFEST.find(candidate => candidate.date === date);
  if (!entry) throw new Error("archive_period_not_allowed");
  return entry;
}

async function sha256Text(text: string) {
  return tdccArchiveSha256(new TextEncoder().encode(text));
}

function canonicalMaterial(levelsValue: unknown, totalValue: unknown) {
  if (!Array.isArray(levelsValue) || levelsValue.length !== 15 || !totalValue || typeof totalValue !== "object") throw new Error("archive_invalid_stored_material");
  const level = (value: unknown, expected: number) => {
    if (!value || typeof value !== "object") throw new Error("archive_invalid_stored_material");
    const row = value as Record<string, unknown>;
    const holders = Number(row.holders);
    const shares = Number(row.shares);
    const ratioPercent = Number(row.ratioPercent);
    if (Number(row.level) !== expected || !Number.isSafeInteger(holders) || !Number.isSafeInteger(shares) || !Number.isFinite(ratioPercent)) throw new Error("archive_invalid_stored_material");
    return { level: expected, holders, shares, ratioPercent };
  };
  const levels = levelsValue.map((value, index) => level(value, index + 1));
  const total = level(totalValue, 17);
  const holders = levels.reduce((sum, item) => sum + item.holders, 0);
  const shares = levels.reduce((sum, item) => sum + item.shares, 0);
  const ratioPercent = levels.reduce((sum, item) => sum + item.ratioPercent, 0);
  return JSON.stringify({
    levels,
    adjustment: {
      level: 16,
      holders: total.holders - holders,
      shares: total.shares - shares,
      ratioPercent: Number((total.ratioPercent - ratioPercent).toFixed(8)),
    },
    total,
  });
}

function materialJson(row: DistributionRow) {
  return canonicalMaterial(row.levels, row.total);
}

export async function tdccDistributionMaterialHash(row: DistributionRow) {
  return sha256Text(materialJson(row));
}

export async function tdccStoredDistributionMaterialHash(levelsJson: string, totalJson: string) {
  try {
    return sha256Text(canonicalMaterial(JSON.parse(levelsJson), JSON.parse(totalJson)));
  } catch {
    throw new Error("archive_invalid_stored_material");
  }
}

async function supportedTaiwanSymbols(db: D1Database) {
  const result = await db.prepare(`SELECT symbol FROM tdcc_archive_symbol_universe
    WHERE manifest_version=? ORDER BY symbol`).bind(TDCC_ARCHIVE_MANIFEST_VERSION).all<{ symbol: string }>();
  return new Set(result.results.map(row => String(row.symbol).trim().toUpperCase()));
}

async function fetchOfficialCatalogPayload(url: string, minimumRows: number, fetcher: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher(url, { signal: controller.signal, redirect: "manual", headers: { accept: "application/json", "accept-language": "zh-TW,zh;q=0.9", "user-agent": "Mozilla/5.0 CodexSites MultiChart" } });
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("archive_catalog_redirect");
    if (!response.ok) throw new Error(`archive_catalog_http_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length < minimumRows || payload.length > 10000) throw new Error("archive_catalog_invalid");
    return payload as Record<string, unknown>[];
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("archive_catalog_timeout");
    if (error instanceof Error && /^archive_catalog_/.test(error.message)) throw error;
    throw new Error("archive_catalog_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureArchiveUniverse(db: D1Database, fetcher: typeof fetch = fetch) {
  let existing: { count: number; equities: number; etfs: number } | null;
  try {
    existing = await db.prepare(`SELECT COUNT(*) AS count,
    SUM(CASE WHEN quote_type='EQUITY' THEN 1 ELSE 0 END) AS equities,
    SUM(CASE WHEN quote_type='ETF' THEN 1 ELSE 0 END) AS etfs
    FROM tdcc_archive_symbol_universe WHERE manifest_version=?`)
      .bind(TDCC_ARCHIVE_MANIFEST_VERSION).first<{ count: number; equities: number; etfs: number }>();
  } catch {
    throw new Error("archive_universe_schema_invalid");
  }
  if (Number(existing?.equities || 0) >= 1500 && Number(existing?.etfs || 0) >= 100) return Number(existing?.count || 0);
  const [twseIssuers, tpexIssuers, twse, tpex] = await Promise.all([
    fetchOfficialCatalogPayload(SCREENER_SOURCES.TWSE.universe, 800, fetcher),
    fetchOfficialCatalogPayload(SCREENER_SOURCES.TPEx.universe, 500, fetcher),
    fetchOfficialCatalogPayload(TWSE_CATALOG_URL, 800, fetcher),
    fetchOfficialCatalogPayload(TPEX_CATALOG_URL, 500, fetcher),
  ]);
  let ordinary;
  try {
    ordinary = mergeUniverses(parseUniverse(twseIssuers, "TWSE"), parseUniverse(tpexIssuers, "TPEx"));
  } catch {
    throw new Error("archive_universe_invalid");
  }
  if (ordinary.stocks.length < 1500) throw new Error("archive_universe_not_ready");
  const ordinaryCodes = new Set<string>();
  for (const stock of ordinary.stocks) {
    if (ordinaryCodes.has(stock.code)) throw new Error("archive_universe_invalid");
    ordinaryCodes.add(stock.code);
  }
  const etfs = new Map<string, { symbol: string; code: string; exchange: "TWSE" | "TPEx"; source: string; sourceDate: string; sourceUrl: string }>();
  const catalogDate = (value: unknown) => {
    const match = /^(\d{3})(\d{2})(\d{2})$/.exec(String(value || ""));
    if (!match) throw new Error("archive_catalog_invalid");
    return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
  };
  const appendEtfs = (payload: Record<string, unknown>[], exchange: "TWSE" | "TPEx", sourceUrl: string) => {
    for (const item of payload) {
      const code = String(exchange === "TWSE" ? item.Code ?? "" : item.SecuritiesCompanyCode ?? "").trim().toUpperCase();
      if (!/^00[0-9A-Z]{2,6}$/.test(code)) continue;
      const symbol = `${code}.${exchange === "TWSE" ? "TW" : "TWO"}`;
      if (ordinaryCodes.has(code) || etfs.has(code)) throw new Error("archive_universe_invalid");
      etfs.set(code, { symbol, code, exchange, source: `${exchange.toLowerCase()}-official-catalog`, sourceDate: catalogDate(item.Date), sourceUrl });
    }
  };
  appendEtfs(twse, "TWSE", TWSE_CATALOG_URL);
  appendEtfs(tpex, "TPEx", TPEX_CATALOG_URL);
  if (etfs.size < 100) throw new Error("archive_catalog_invalid");
  const ordinaryRows = ordinary.stocks.map(stock => ({
    symbol: stock.symbol, code: stock.code, exchange: stock.market, quoteType: "EQUITY",
    listingDate: stock.listingDate || null, source: "official-issuer-directory",
    sourceDate: stock.market === "TWSE" ? ordinary.dates.TWSE : ordinary.dates.TPEx,
    sourceUrl: stock.market === "TWSE" ? SCREENER_SOURCES.TWSE.universe : SCREENER_SOURCES.TPEx.universe,
  }));
  const allRows = [...ordinaryRows, ...[...etfs.values()].map(row => ({ ...row, quoteType: "ETF", listingDate: null }))];
  const statements = [db.prepare("DELETE FROM tdcc_archive_symbol_universe WHERE manifest_version=?").bind(TDCC_ARCHIVE_MANIFEST_VERSION)];
  const universeRowsPerStatement = 250;
  const groups = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const key = [row.exchange, row.quoteType, row.source, row.sourceUrl].join("|");
    const rows = groups.get(key) || [];
    rows.push(row);
    groups.set(key, rows);
  }
  for (const rows of groups.values()) {
    const first = rows[0];
    for (let index = 0; index < rows.length; index += universeRowsPerStatement) {
      const chunk = rows.slice(index, index + universeRowsPerStatement)
        .map(row => ({ symbol: row.symbol, code: row.code, listingDate: row.listingDate, sourceDate: row.sourceDate }));
      statements.push(db.prepare(`INSERT INTO tdcc_archive_symbol_universe
        (manifest_version,symbol,stock_code,exchange,quote_type,listing_date,source,source_date,source_url)
        SELECT ?,json_extract(value,'$.symbol'),json_extract(value,'$.code'),?,?,json_extract(value,'$.listingDate'),?,
          json_extract(value,'$.sourceDate'),? FROM json_each(?)`)
        .bind(TDCC_ARCHIVE_MANIFEST_VERSION, first.exchange, first.quoteType, first.source, first.sourceUrl, JSON.stringify(chunk)));
    }
  }
  if (statements.length > 40) throw new Error("archive_universe_invalid");
  try {
    await db.batch(statements);
  } catch {
    throw new Error("archive_universe_write_failed");
  }
  const completed = await db.prepare("SELECT COUNT(*) AS count FROM tdcc_archive_symbol_universe WHERE manifest_version=?")
    .bind(TDCC_ARCHIVE_MANIFEST_VERSION).first<{ count: number }>();
  const count = Number(completed?.count || 0);
  if (count < 1800) throw new Error("archive_universe_not_ready");
  return count;
}

async function officialLatestRows(fetcher: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher(OFFICIAL_LATEST_URL, { signal: controller.signal, headers: { accept: "application/json" }, redirect: "manual" });
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("archive_official_anchor_redirect");
    if (!response.ok) throw new Error(`archive_official_anchor_http_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("archive_official_anchor_invalid");
    return payload as Record<string, unknown>[];
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("archive_official_anchor_timeout");
    if (error instanceof Error && /^archive_official_anchor_/.test(error.message)) throw error;
    throw new Error("archive_official_anchor_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function acquireRunLease(db: D1Database, owner: string) {
  const result = await db.prepare(`UPDATE tdcc_archive_runs
    SET lease_owner=?,lease_expires_at=datetime('now',? || ' seconds'),heartbeat_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE run_id=? AND status NOT IN ('complete','blocked')
      AND (lease_owner IS NULL OR lease_owner=? OR lease_expires_at<=CURRENT_TIMESTAMP)`)
    .bind(owner, String(LEASE_SECONDS), TDCC_ARCHIVE_RUN_ID, owner).run();
  if (Number(result.meta?.changes || 0) !== 1) throw new Error("archive_lease_conflict");
}

async function assertRunLease(db: D1Database, owner: string) {
  const row = await db.prepare(`SELECT run_id FROM tdcc_archive_runs
    WHERE run_id=? AND lease_owner=? AND lease_expires_at>CURRENT_TIMESTAMP`)
    .bind(TDCC_ARCHIVE_RUN_ID, owner).first<{ run_id: string }>();
  if (!row) throw new Error("archive_lease_conflict");
}

export async function startTdccArchiveRun(db: D1Database, owner: string, fetcher: typeof fetch = fetch) {
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(owner)) throw new Error("archive_invalid_owner");
  const now = isoNow();
  await db.prepare(`INSERT INTO tdcc_archive_runs
    (run_id,manifest_version,commit_sha,validator_version,scope,status,target_periods,processed_periods,failed_periods,overdue_periods,heartbeat_at,started_at)
    VALUES (?,?,?,?, 'full-market','preparing',?,0,0,0,?,?)
    ON CONFLICT(run_id) DO UPDATE SET
      status=CASE WHEN tdcc_archive_runs.status='blocked' AND tdcc_archive_runs.last_error_code='archive_source_mismatch' THEN 'preparing' ELSE tdcc_archive_runs.status END,
      failed_periods=CASE WHEN tdcc_archive_runs.status='blocked' AND tdcc_archive_runs.last_error_code='archive_source_mismatch' THEN 0 ELSE tdcc_archive_runs.failed_periods END,
      last_error_code=CASE WHEN tdcc_archive_runs.status='blocked' AND tdcc_archive_runs.last_error_code='archive_source_mismatch' THEN NULL ELSE tdcc_archive_runs.last_error_code END,
      heartbeat_at=excluded.heartbeat_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(TDCC_ARCHIVE_RUN_ID, TDCC_ARCHIVE_MANIFEST_VERSION, TDCC_ARCHIVE_COMMIT, TDCC_ARCHIVE_VALIDATOR_VERSION, TDCC_ARCHIVE_MANIFEST.length, now, now).run();
  const current = await db.prepare("SELECT status FROM tdcc_archive_runs WHERE run_id=?")
    .bind(TDCC_ARCHIVE_RUN_ID).first<{ status: string }>();
  if (current?.status !== "complete") {
    await acquireRunLease(db, owner);
    try {
      await ensureArchiveUniverse(db, fetcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : "archive_failed";
      const reason = /^archive_[a-z0-9_]+$/.test(message) ? message : "archive_failed";
      await db.prepare("UPDATE tdcc_archive_runs SET status='failed',last_error_code=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND lease_owner=?")
        .bind(reason, TDCC_ARCHIVE_RUN_ID, owner).run();
      throw error;
    }
  }
  return tdccArchiveStatus(db);
}

export async function prepareTdccArchivePeriod(input: {
  db: D1Database;
  owner: string;
  date: string;
  fetcher?: typeof fetch;
}) {
  const { db, owner } = input;
  const fetcher = input.fetcher ?? fetch;
  await assertRunLease(db, owner);
  await ensureArchiveUniverse(db, fetcher);
  const entry = entryForDate(input.date);
  const id = receiptId(entry.date);
  const existing = await db.prepare("SELECT receipt_id,data_date,status,staged_symbol_count,material_hash,normalization_version FROM tdcc_archive_period_receipts WHERE receipt_id=?")
    .bind(id).first<ReceiptRow>();
  if (existing && existing.normalization_version === TDCC_ARCHIVE_NORMALIZATION_VERSION && ["prepared", "verified", "matched-existing"].includes(existing.status)) return existing;

  const snapshot = await fetchTdccArchiveCsv(entry, fetcher);
  let officialAnchorHash: string | null = null;
  if (entry === TDCC_ARCHIVE_MANIFEST.at(-1)) {
    const official = await officialLatestRows(fetcher);
    compareCanonicalTdccRows(snapshot.rows, official);
    officialAnchorHash = await sha256Text(JSON.stringify(official.map(row => Object.values(row)).sort()));
  }
  const eligibleSymbols = await supportedTaiwanSymbols(db);
  const fetchedAt = isoNow();
  let rows: DistributionRow[];
  try {
    rows = parseTdccSnapshot(snapshot.rows, eligibleSymbols, fetchedAt);
  } catch {
    throw new Error("archive_normalization_invalid");
  }
  if (!rows.length) throw new Error("archive_empty_supported_universe");
  const staged = [];
  for (const row of rows) staged.push({ row, materialHash: await tdccDistributionMaterialHash(row) });
  const periodMaterialHash = await sha256Text(staged.map(item => `${item.row.symbol}|${item.materialHash}`).sort().join("\n"));

  await db.prepare(`INSERT INTO tdcc_archive_period_receipts
    (receipt_id,run_id,manifest_version,commit_sha,validator_version,normalization_version,data_date,source_url,byte_length,payload_sha256,row_count,symbol_count,staged_symbol_count,material_hash,official_anchor_hash,status,last_error_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'staging',NULL)
    ON CONFLICT(receipt_id) DO UPDATE SET run_id=excluded.run_id,byte_length=excluded.byte_length,payload_sha256=excluded.payload_sha256,row_count=excluded.row_count,symbol_count=excluded.symbol_count,staged_symbol_count=excluded.staged_symbol_count,material_hash=excluded.material_hash,official_anchor_hash=excluded.official_anchor_hash,status='staging',last_error_code=NULL,updated_at=CURRENT_TIMESTAMP`)
    .bind(id, TDCC_ARCHIVE_RUN_ID, TDCC_ARCHIVE_MANIFEST_VERSION, TDCC_ARCHIVE_COMMIT, TDCC_ARCHIVE_VALIDATOR_VERSION, TDCC_ARCHIVE_NORMALIZATION_VERSION, entry.date, entry.url, entry.bytes, entry.sha256, snapshot.rowCount, snapshot.symbolCount, staged.length, periodMaterialHash, officialAnchorHash).run();
  await db.prepare("DELETE FROM tdcc_archive_staging WHERE receipt_id=?").bind(id).run();
  await runD1Batch(db, staged.map(({ row, materialHash }) => db.prepare(`INSERT INTO tdcc_archive_staging
    (receipt_id,data_date,symbol,levels_json,adjustment_json,total_json,material_hash,source_fetched_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id, entry.date, row.symbol, JSON.stringify(row.levels), JSON.stringify(row.adjustment), JSON.stringify(row.total), materialHash, fetchedAt)));
  const readback = await db.prepare(`SELECT COUNT(*) AS rows,COUNT(DISTINCT symbol) AS symbols
    FROM tdcc_archive_staging WHERE receipt_id=? AND data_date=?`).bind(id, entry.date).first<{ rows: number; symbols: number }>();
  if (Number(readback?.rows || 0) !== staged.length || Number(readback?.symbols || 0) !== staged.length) {
    await db.prepare("UPDATE tdcc_archive_period_receipts SET status='failed',last_error_code='archive_staging_readback_mismatch',updated_at=CURRENT_TIMESTAMP WHERE receipt_id=?").bind(id).run();
    throw new Error("archive_staging_readback_mismatch");
  }
  await db.batch([
    db.prepare("UPDATE tdcc_archive_period_receipts SET status='prepared',updated_at=CURRENT_TIMESTAMP WHERE receipt_id=? AND status='staging'").bind(id),
    db.prepare("UPDATE tdcc_archive_runs SET status='prepared',heartbeat_at=CURRENT_TIMESTAMP,lease_expires_at=datetime('now',? || ' seconds'),updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND lease_owner=?").bind(String(LEASE_SECONDS), TDCC_ARCHIVE_RUN_ID, owner),
  ]);
  return db.prepare("SELECT receipt_id,data_date,status,staged_symbol_count,material_hash FROM tdcc_archive_period_receipts WHERE receipt_id=?").bind(id).first<ReceiptRow>();
}

async function finalizeReceipt(db: D1Database, receipt: ReceiptRow) {
  if (["verified", "matched-existing"].includes(receipt.status)) return;
  const overlap = await db.prepare(`SELECT s.symbol,s.material_hash,d.levels_json,d.total_json FROM tdcc_archive_staging s
    INNER JOIN taiwan_stock_shareholder_distribution d ON d.symbol=s.symbol AND d.data_date=s.data_date
    WHERE s.receipt_id=? ORDER BY s.symbol`)
    .bind(receipt.receipt_id).all<{ symbol: string; material_hash: string; levels_json: string; total_json: string }>();
  let hasMismatch = false;
  for (const row of overlap.results) {
    try {
      if (await tdccStoredDistributionMaterialHash(row.levels_json, row.total_json) !== row.material_hash) hasMismatch = true;
    } catch {
      hasMismatch = true;
    }
    if (hasMismatch) break;
  }
  if (hasMismatch) {
    await db.batch([
      db.prepare("UPDATE tdcc_archive_period_receipts SET status='source-mismatch',last_error_code='archive_source_mismatch',updated_at=CURRENT_TIMESTAMP WHERE receipt_id=?").bind(receipt.receipt_id),
      db.prepare("UPDATE tdcc_archive_runs SET status='blocked',failed_periods=1,last_error_code='archive_source_mismatch',lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE run_id=?").bind(TDCC_ARCHIVE_RUN_ID),
    ]);
    throw new Error("archive_source_mismatch");
  }
  const matched = overlap.results.length;
  const inserted = Number(receipt.staged_symbol_count) - matched;
  const finalStatus = inserted > 0 ? "verified" : "matched-existing";
  await db.batch([
    db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
      (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at,updated_at)
      SELECT symbol,data_date,levels_json,adjustment_json,total_json,'tdcc','weekly',source_fetched_at,CURRENT_TIMESTAMP
      FROM tdcc_archive_staging WHERE receipt_id=?
      ON CONFLICT(symbol,data_date) DO NOTHING`).bind(receipt.receipt_id),
    db.prepare(`INSERT INTO tdcc_distribution_row_provenance
      (symbol,data_date,transport,validation_status,receipt_id,source_url,payload_sha256,commit_sha,normalization_version,material_hash)
      SELECT s.symbol,s.data_date,'verified-archive','verified',s.receipt_id,r.source_url,r.payload_sha256,r.commit_sha,r.normalization_version,s.material_hash
      FROM tdcc_archive_staging s INNER JOIN tdcc_archive_period_receipts r ON r.receipt_id=s.receipt_id
      LEFT JOIN tdcc_distribution_row_provenance p ON p.symbol=s.symbol AND p.data_date=s.data_date
      WHERE s.receipt_id=? AND p.symbol IS NULL
      ON CONFLICT(symbol,data_date) DO NOTHING`).bind(receipt.receipt_id),
    db.prepare(`UPDATE tdcc_distribution_row_provenance
      SET material_hash=(SELECT s.material_hash FROM tdcc_archive_staging s WHERE s.receipt_id=? AND s.symbol=tdcc_distribution_row_provenance.symbol AND s.data_date=tdcc_distribution_row_provenance.data_date),updated_at=CURRENT_TIMESTAMP
      WHERE material_hash='' AND EXISTS (SELECT 1 FROM tdcc_archive_staging s WHERE s.receipt_id=? AND s.symbol=tdcc_distribution_row_provenance.symbol AND s.data_date=tdcc_distribution_row_provenance.data_date)`)
      .bind(receipt.receipt_id, receipt.receipt_id),
    db.prepare(`UPDATE tdcc_archive_period_receipts SET status=?,inserted_rows=?,matched_rows=?,last_error_code=NULL,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE receipt_id=?`)
      .bind(finalStatus, inserted, matched, receipt.receipt_id),
    db.prepare(`UPDATE tdcc_continuous_items SET status='completed',error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,next_retry_at=NULL,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM tdcc_archive_staging s WHERE s.receipt_id=? AND s.symbol=tdcc_continuous_items.symbol AND s.data_date=tdcc_continuous_items.data_date)`)
      .bind(receipt.receipt_id),
    db.prepare("DELETE FROM tdcc_archive_staging WHERE receipt_id=?").bind(receipt.receipt_id),
  ]);
}

export async function finalizeTdccArchiveRun(db: D1Database, owner: string) {
  await assertRunLease(db, owner);
  const prepared = await db.prepare(`SELECT receipt_id,data_date,status,staged_symbol_count,material_hash,normalization_version
    FROM tdcc_archive_period_receipts WHERE manifest_version=? ORDER BY data_date`)
    .bind(TDCC_ARCHIVE_MANIFEST_VERSION).all<ReceiptRow>();
  if (prepared.results.length !== TDCC_ARCHIVE_MANIFEST.length
    || prepared.results.some(row => !["prepared", "verified", "matched-existing"].includes(row.status))) {
    throw new Error("archive_manifest_not_prepared");
  }
  await db.prepare("UPDATE tdcc_archive_runs SET status='running',heartbeat_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND lease_owner=?")
    .bind(TDCC_ARCHIVE_RUN_ID, owner).run();
  for (const receipt of prepared.results) {
    await assertRunLease(db, owner);
    await finalizeReceipt(db, receipt);
    await db.prepare("UPDATE tdcc_archive_runs SET processed_periods=processed_periods+1,heartbeat_at=CURRENT_TIMESTAMP,lease_expires_at=datetime('now',? || ' seconds'),updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND lease_owner=?")
      .bind(String(LEASE_SECONDS), TDCC_ARCHIVE_RUN_ID, owner).run();
  }
  await db.prepare(`UPDATE tdcc_archive_runs SET status='complete',processed_periods=?,failed_periods=0,overdue_periods=0,last_error_code=NULL,completed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE run_id=?`)
    .bind(TDCC_ARCHIVE_MANIFEST.length, TDCC_ARCHIVE_RUN_ID).run();
  return tdccArchiveStatus(db);
}

export async function rollbackTdccArchiveReceipt(db: D1Database, id: string, dryRun = true) {
  const receipt = await db.prepare("SELECT receipt_id,status FROM tdcc_archive_period_receipts WHERE receipt_id=?")
    .bind(id).first<{ receipt_id: string; status: string }>();
  if (!receipt || !["verified", "matched-existing"].includes(receipt.status)) throw new Error("archive_receipt_not_rollbackable");
  const affected = await db.prepare(`SELECT COUNT(*) AS count FROM tdcc_distribution_row_provenance
    WHERE receipt_id=? AND transport='verified-archive' AND validation_status='verified' AND official_confirmed_at IS NULL`)
    .bind(id).first<{ count: number }>();
  const rowCount = Number(affected?.count || 0);
  if (dryRun) return { dryRun: true, receiptId: id, rowCount };
  await db.batch([
    db.prepare(`DELETE FROM taiwan_stock_shareholder_distribution WHERE EXISTS
      (SELECT 1 FROM tdcc_distribution_row_provenance p WHERE p.receipt_id=? AND p.symbol=taiwan_stock_shareholder_distribution.symbol AND p.data_date=taiwan_stock_shareholder_distribution.data_date AND p.transport='verified-archive' AND p.validation_status='verified' AND p.official_confirmed_at IS NULL)`).bind(id),
    db.prepare("DELETE FROM tdcc_distribution_row_provenance WHERE receipt_id=? AND transport='verified-archive' AND validation_status='verified' AND official_confirmed_at IS NULL").bind(id),
    db.prepare("UPDATE tdcc_archive_period_receipts SET status='rolled-back',updated_at=CURRENT_TIMESTAMP WHERE receipt_id=?").bind(id),
  ]);
  return { dryRun: false, receiptId: id, rowCount };
}

export async function tdccArchiveStatus(db: D1Database) {
  const run = await db.prepare("SELECT * FROM tdcc_archive_runs WHERE run_id=?").bind(TDCC_ARCHIVE_RUN_ID).first<Record<string, unknown>>();
  const receipts = await db.prepare(`SELECT data_date,status,row_count,symbol_count,staged_symbol_count,byte_length,payload_sha256,material_hash,inserted_rows,matched_rows,last_error_code,verified_at
    FROM tdcc_archive_period_receipts WHERE manifest_version=? ORDER BY data_date`).bind(TDCC_ARCHIVE_MANIFEST_VERSION).all<Record<string, unknown>>();
  const complete = receipts.results.filter(row => ["verified", "matched-existing"].includes(String(row.status))).length;
  const failed = receipts.results.filter(row => ["failed", "source-mismatch"].includes(String(row.status))).length;
  return {
    manifestVersion: TDCC_ARCHIVE_MANIFEST_VERSION,
    validatorVersion: TDCC_ARCHIVE_VALIDATOR_VERSION,
    commitSha: TDCC_ARCHIVE_COMMIT,
    target: TDCC_ARCHIVE_MANIFEST.length,
    processed: complete,
    remaining: Math.max(0, TDCC_ARCHIVE_MANIFEST.length - complete),
    failed,
    overdue: Number(run?.overdue_periods || 0),
    complete: complete === TDCC_ARCHIVE_MANIFEST.length && failed === 0,
    status: String(run?.status || "not_started"),
    reasonCode: run?.last_error_code ? String(run.last_error_code) : null,
    receipts: receipts.results,
  };
}
