#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseTdccSnapshot } from "../worker/taiwan-stock-chip.ts";

const SYMBOL = /^[0-9A-Z]{4,8}\.(TW|TWO)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASONS = new Set(["published", "pre_listing", "not_published"]);
const MARKET_STATE_SYMBOL = "__MARKET__:tdcc-1-5-v3";

export function parseRecoveryArgs(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--") || !argument.includes("=")) throw new Error(`未知參數：${argument}`);
    const [key, ...rest] = argument.slice(2).split("=");
    values.set(key, rest.join("="));
  }
  const minimumWeeks = Number(values.get("minimum-weeks") || 51);
  if (!values.get("snapshot") || !values.get("output-sql")) throw new Error("必須提供 snapshot 與 output-sql");
  if (!Number.isInteger(minimumWeeks) || minimumWeeks < 2 || minimumWeeks > 60) throw new Error("minimum-weeks 必須介於 2 到 60");
  return { snapshotPath: values.get("snapshot"), outputSqlPath: values.get("output-sql"), minimumWeeks };
}

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlNullable = (value) => value === null || value === undefined ? "NULL" : sqlText(value);
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

export function validateTdccHistorySnapshot(snapshot, { minimumWeeks = 51 } = {}) {
  if (!snapshot || snapshot.version !== 1 || snapshot.source !== "tdcc-official-history-query") throw new Error("invalid_snapshot");
  const symbols = Array.isArray(snapshot.targetSymbols) ? snapshot.targetSymbols.map(String) : [];
  const dates = Array.isArray(snapshot.officialDates) ? snapshot.officialDates.map(String) : [];
  if (!symbols.length || symbols.length > 64 || symbols.some((symbol) => !SYMBOL.test(symbol)) || new Set(symbols).size !== symbols.length) throw new Error("invalid_symbols");
  if (dates.length < minimumWeeks || dates.length > 60 || dates.some((date) => !DATE.test(date)) || new Set(dates).size !== dates.length || JSON.stringify(dates) !== JSON.stringify([...dates].sort())) throw new Error("invalid_dates");
  if (!snapshot.weeks || typeof snapshot.weeks !== "object" || Array.isArray(snapshot.weeks)) throw new Error("invalid_weeks");

  const distributionRows = [];
  const itemRows = [];
  const publishedBySymbol = new Map(symbols.map((symbol) => [symbol, 0]));
  for (const dataDate of dates) {
    const week = snapshot.weeks[dataDate];
    if (!week || !Array.isArray(week.statuses) || !Array.isArray(week.rows)) throw new Error("incomplete_snapshot");
    const statuses = new Map();
    for (const item of week.statuses) {
      const symbol = String(item?.symbol || "");
      const reason = String(item?.reason || "");
      if (!symbols.includes(symbol) || !REASONS.has(reason) || statuses.has(symbol)) throw new Error("invalid_statuses");
      statuses.set(symbol, reason);
    }
    if (statuses.size !== symbols.length) throw new Error("incomplete_statuses");
    const published = new Set([...statuses].filter(([, reason]) => reason === "published").map(([symbol]) => symbol));
    const parsed = published.size ? parseTdccSnapshot(week.rows, published, snapshot.updatedAt || undefined) : [];
    if (parsed.length !== published.size || parsed.some((row) => row.dataDate !== dataDate || !published.has(row.symbol))) throw new Error("invalid_rows");
    const parsedSymbols = new Set(parsed.map((row) => row.symbol));
    if ([...published].some((symbol) => !parsedSymbols.has(symbol)) || week.rows.length !== published.size * 17) throw new Error("invalid_rows");
    for (const row of parsed) {
      distributionRows.push(row);
      publishedBySymbol.set(row.symbol, Number(publishedBySymbol.get(row.symbol) || 0) + 1);
    }
    for (const symbol of symbols) {
      const reason = statuses.get(symbol);
      itemRows.push({ symbol, dataDate, errorCode: reason === "published" ? null : reason });
    }
  }
  if ([...publishedBySymbol.values()].some((count) => count < 1)) throw new Error("symbol_without_published_history");
  const canonical = JSON.stringify({ symbols, dates, distributionRows, itemRows });
  return {
    symbols,
    dates,
    distributionRows,
    itemRows,
    publishedBySymbol: Object.fromEntries(publishedBySymbol),
    digest: createHash("sha256").update(canonical).digest("hex"),
  };
}

function distributionSql(rows, fetchedAt) {
  return chunks(rows, 20).map((batch) => `INSERT INTO taiwan_stock_shareholder_distribution (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at) VALUES\n${batch.map((row) => `(${[
    row.symbol,
    row.dataDate,
    JSON.stringify(row.levels),
    JSON.stringify(row.adjustment),
    JSON.stringify(row.total),
    "tdcc",
    "weekly",
    fetchedAt,
  ].map(sqlText).join(",")})`).join(",\n")}\nON CONFLICT(symbol,data_date) DO UPDATE SET levels_json=excluded.levels_json,adjustment_json=excluded.adjustment_json,total_json=excluded.total_json,provider=excluded.provider,frequency=excluded.frequency,source_fetched_at=excluded.source_fetched_at,updated_at=CURRENT_TIMESTAMP WHERE taiwan_stock_shareholder_distribution.levels_json IS NOT excluded.levels_json OR taiwan_stock_shareholder_distribution.adjustment_json IS NOT excluded.adjustment_json OR taiwan_stock_shareholder_distribution.total_json IS NOT excluded.total_json OR taiwan_stock_shareholder_distribution.provider IS NOT excluded.provider OR taiwan_stock_shareholder_distribution.frequency IS NOT excluded.frequency;`);
}

function itemSql(rows, completedAt) {
  return chunks(rows, 50).map((batch) => `INSERT INTO tdcc_continuous_items (symbol,data_date,status,priority,attempts,error_code,completed_at) VALUES\n${batch.map((row) => `(${sqlText(row.symbol)},${sqlText(row.dataDate)},'completed',100,1,${sqlNullable(row.errorCode)},${sqlText(completedAt)})`).join(",\n")}\nON CONFLICT(symbol,data_date) DO UPDATE SET status='completed',error_code=excluded.error_code,completed_at=COALESCE(tdcc_continuous_items.completed_at,excluded.completed_at),lease_owner=NULL,lease_expires_at=NULL,next_retry_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE tdcc_continuous_items.status IS NOT 'completed' OR tdcc_continuous_items.error_code IS NOT excluded.error_code OR tdcc_continuous_items.completed_at IS NULL OR tdcc_continuous_items.lease_owner IS NOT NULL OR tdcc_continuous_items.lease_expires_at IS NOT NULL OR tdcc_continuous_items.next_retry_at IS NOT NULL;`);
}

export function buildTdccHistoryRecoverySql(validated, { completedAt = new Date().toISOString() } = {}) {
  const start = validated.dates[0];
  const end = validated.dates.at(-1);
  const statements = [
    "-- TDCC 公開市場資料復原；不包含使用者、登入或個人清單資料。",
    `-- snapshot_sha256=${validated.digest} symbols=${validated.symbols.length} weeks=${validated.dates.length} rows=${validated.distributionRows.length}`,
    ...distributionSql(validated.distributionRows, completedAt),
    ...itemSql(validated.itemRows, completedAt),
  ];
  for (const symbol of validated.symbols) {
    statements.push(`UPDATE tdcc_continuous_symbols SET status='completed',target_start=${sqlText(start)},target_end=${sqlText(end)},expected_weeks=${validated.dates.length},completed_weeks=${validated.dates.length},failed_weeks=0,missing_dates_json='[]',checkpoint_date=${sqlText(end)},history_success_at=COALESCE(history_success_at,${sqlText(completedAt)}),next_retry_at=NULL,last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE symbol=${sqlText(symbol)} AND active=1 AND (status IS NOT 'completed' OR target_start IS NOT ${sqlText(start)} OR target_end IS NOT ${sqlText(end)} OR expected_weeks IS NOT ${validated.dates.length} OR completed_weeks IS NOT ${validated.dates.length} OR failed_weeks IS NOT 0 OR missing_dates_json IS NOT '[]' OR checkpoint_date IS NOT ${sqlText(end)} OR history_success_at IS NULL OR next_retry_at IS NOT NULL OR last_error_code IS NOT NULL OR lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL);`);
  }
  statements.push(`INSERT INTO taiwan_stock_chip_fetch_state (symbol,dataset,coverage_start,coverage_end,source_date,status,reason_code,last_success_at,last_attempt_at,retry_after) VALUES (${sqlText(MARKET_STATE_SYMBOL)},'shareholder-distribution',${sqlText(start)},${sqlText(end)},${sqlText(end)},'available','available',${sqlText(completedAt)},${sqlText(completedAt)},NULL) ON CONFLICT(symbol,dataset) DO UPDATE SET coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,source_date=excluded.source_date,status='available',reason_code='available',last_success_at=COALESCE(taiwan_stock_chip_fetch_state.last_success_at,excluded.last_success_at),last_attempt_at=COALESCE(taiwan_stock_chip_fetch_state.last_attempt_at,excluded.last_attempt_at),retry_after=NULL,updated_at=CURRENT_TIMESTAMP WHERE taiwan_stock_chip_fetch_state.coverage_start IS NOT excluded.coverage_start OR taiwan_stock_chip_fetch_state.coverage_end IS NOT excluded.coverage_end OR taiwan_stock_chip_fetch_state.source_date IS NOT excluded.source_date OR taiwan_stock_chip_fetch_state.status IS NOT 'available' OR taiwan_stock_chip_fetch_state.reason_code IS NOT 'available' OR taiwan_stock_chip_fetch_state.last_success_at IS NULL OR taiwan_stock_chip_fetch_state.last_attempt_at IS NULL OR taiwan_stock_chip_fetch_state.retry_after IS NOT NULL;`);
  return `${statements.join("\n\n")}\n`;
}

export async function prepareTdccHistoryRecovery(options) {
  const snapshot = JSON.parse(await readFile(options.snapshotPath, "utf8"));
  const validated = validateTdccHistorySnapshot(snapshot, { minimumWeeks: options.minimumWeeks });
  const sql = buildTdccHistoryRecoverySql(validated);
  await writeFile(options.outputSqlPath, sql, { mode: 0o600 });
  await chmod(options.outputSqlPath, 0o600);
  return {
    snapshotDigest: validated.digest,
    symbols: validated.symbols.length,
    weeks: validated.dates.length,
    distributionRows: validated.distributionRows.length,
    stateRows: validated.itemRows.length,
    sqlDigest: createHash("sha256").update(sql).digest("hex"),
  };
}

async function main() {
  const result = await prepareTdccHistoryRecovery(parseRecoveryArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ event: "tdcc-history-recovery-prepared", ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: "failed", error: error instanceof Error ? error.message : "failed" })}\n`);
    process.exitCode = 1;
  });
}
