#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, "..");
const REPO_DIR = resolve(APP_DIR, "../..");
const DEFAULT_STATE_DIR = resolve(process.env.HOME || "", "Library/Application Support/RealTimeStock/MultiView");

export const TABLE_GROUPS = Object.freeze({
  market: ["instrument_catalog", "candle_history", "candle_history_state"],
  chip: ["taiwan_stock_chip_daily", "taiwan_stock_chip_fetch_state"],
  tdcc: ["taiwan_stock_shareholder_distribution", "tdcc_shareholder_backfill_week", "tdcc_continuous_symbols", "tdcc_continuous_items"],
  pe: ["taiwan_stock_pe_valuation_daily", "taiwan_stock_pe_fetch_state", "taiwan_stock_pe_control"],
});

export const TABLE_ALLOWLIST = Object.freeze(Object.values(TABLE_GROUPS).flat());
const TABLE_SET = new Set(TABLE_ALLOWLIST);
const FORBIDDEN_NAME = /(?:^|_)(?:user|access|audit|email|secret|credential|password|token|account|ca|order|trade)(?:_|$)/i;
const DATE_COLUMNS = Object.freeze({
  instrument_catalog: "source_updated_at",
  candle_history: "time",
  candle_history_state: "coverage_end",
  taiwan_stock_chip_daily: "session_date",
  taiwan_stock_chip_fetch_state: "source_date",
  taiwan_stock_shareholder_distribution: "data_date",
  tdcc_shareholder_backfill_week: "data_date",
  tdcc_continuous_symbols: "latest_snapshot_date",
  tdcc_continuous_items: "data_date",
  taiwan_stock_pe_valuation_daily: "session_date",
  taiwan_stock_pe_fetch_state: "source_date",
  taiwan_stock_pe_control: "latest_twse_source_date",
});

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const quoteLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function sqlite(dbPath, sql, { json = false, input } = {}) {
  const args = json ? ["-json", dbPath, sql] : [dbPath, sql];
  return execFileSync("sqlite3", args, {
    encoding: "utf8",
    input,
    maxBuffer: 1024 * 1024 * 32,
  }).trim();
}

function sqliteInput(dbPath, input) {
  execFileSync("sqlite3", [dbPath], { input, stdio: ["pipe", "ignore", "pipe"], maxBuffer: 1024 * 1024 * 32 });
}

export function assertSafeDirectory(pathname) {
  const directory = resolve(pathname);
  if (directory === REPO_DIR || directory.startsWith(`${REPO_DIR}/`)) throw new Error("repo_output_forbidden");
  const mode = statSync(directory).mode & 0o777;
  if (mode !== 0o700) throw new Error("migration_directory_must_be_0700");
  return directory;
}

export function validateExportSql(sql) {
  const tables = [...sql.matchAll(/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"]?([a-zA-Z0-9_]+)[`"]?/gi)].map((match) => match[1]);
  if (!tables.length) throw new Error("export_contains_no_rows");
  const unknown = [...new Set(tables.filter((table) => !TABLE_SET.has(table)))];
  if (unknown.length) throw new Error("unknown_export_table");
  if (/\b(?:CREATE|ALTER|DROP|ATTACH|DETACH)\b/i.test(sql)) throw new Error("export_schema_statement_forbidden");
  return Object.freeze([...new Set(tables)].sort());
}

function tableInfo(dbPath, table) {
  return JSON.parse(sqlite(dbPath, `PRAGMA table_info(${quoteIdentifier(table)});`, { json: true }) || "[]");
}

export function assertAllowlistSchema(dbPath, referenceDbPath = dbPath) {
  for (const table of TABLE_ALLOWLIST) {
    const actual = tableInfo(dbPath, table);
    const expected = tableInfo(referenceDbPath, table);
    if (!actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`schema_drift:${table}`);
    for (const column of actual) {
      if (FORBIDDEN_NAME.test(String(column.name))) throw new Error(`forbidden_column:${table}`);
    }
  }
}

function primaryKeyColumns(dbPath, table) {
  return tableInfo(dbPath, table).filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
}

function tableColumns(dbPath, table) {
  return tableInfo(dbPath, table).map((column) => column.name);
}

function tableHash(dbPath, table) {
  const order = primaryKeyColumns(dbPath, table).map(quoteIdentifier).join(", ") || "rowid";
  const query = `SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${order}`;
  return sqlite(dbPath, `SELECT lower(hex(sha3_query(${quoteLiteral(query)},256)));`);
}

function dateExpression(table) {
  const column = quoteIdentifier(DATE_COLUMNS[table]);
  return ["candle_history", "candle_history_state"].includes(table)
    ? `datetime(${column}, 'unixepoch')`
    : column;
}

export function databaseSummary(dbPath) {
  const tables = {};
  for (const table of TABLE_ALLOWLIST) {
    const symbolColumn = tableInfo(dbPath, table).some((column) => column.name === "symbol");
    const date = dateExpression(table);
    const [row] = JSON.parse(sqlite(dbPath, `SELECT COUNT(*) AS rowCount, ${symbolColumn ? "COUNT(DISTINCT symbol)" : "0"} AS symbolCount, MIN(${date}) AS minDate, MAX(${date}) AS maxDate FROM ${quoteIdentifier(table)};`, { json: true }) || "[]");
    tables[table] = {
      rowCount: Number(row?.rowCount || 0),
      symbolCount: Number(row?.symbolCount || 0),
      minDate: row?.minDate || null,
      maxDate: row?.maxDate || null,
      materialHash: tableHash(dbPath, table),
    };
  }
  const groups = Object.fromEntries(Object.entries(TABLE_GROUPS).map(([group, names]) => {
    const rows = names.reduce((sum, name) => sum + tables[name].rowCount, 0);
    const dataTables = names.filter((name) => !name.endsWith("_state") && !name.endsWith("_control") && name !== "tdcc_shareholder_backfill_week");
    const completed = dataTables.some((name) => tables[name].rowCount > 0);
    return [group, { status: completed ? "completed" : "pending", processed: rows, remaining: completed ? 0 : 1, reasonCode: completed ? "none" : "coverage_missing" }];
  }));
  return { tables, groups };
}

export function personalStateHash(dbPath) {
  const names = ["user_tabs", "user_instruments"];
  const material = names.map((table) => ({ table, rows: Number(sqlite(dbPath, `SELECT COUNT(*) FROM ${quoteIdentifier(table)};`) || 0), hash: tableHash(dbPath, table) }));
  return {
    rowCount: material.reduce((sum, item) => sum + item.rows, 0),
    materialHash: createHash("sha256").update(JSON.stringify(material)).digest("hex"),
  };
}

export function applyMigrations(stagingDbPath) {
  const migrationDir = resolve(APP_DIR, "drizzle");
  const files = readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = readFileSync(resolve(migrationDir, file), "utf8").replaceAll("--> statement-breakpoint", "\n");
    sqliteInput(stagingDbPath, sql);
  }
  return files.length;
}

export function stageExport({ exportPath, stagingDbPath, liveDbPath }) {
  assertSafeDirectory(dirname(stagingDbPath));
  const sql = readFileSync(exportPath, "utf8");
  const exportedTables = validateExportSql(sql);
  const migrationCount = applyMigrations(stagingDbPath);
  chmodSync(stagingDbPath, 0o600);
  sqliteInput(stagingDbPath, sql);
  chmodSync(stagingDbPath, 0o600);
  assertAllowlistSchema(stagingDbPath, liveDbPath);
  const integrity = sqlite(stagingDbPath, "PRAGMA integrity_check;");
  if (integrity !== "ok") throw new Error("staging_integrity_failed");
  return { exportedTables, migrationCount, integrity, ...databaseSummary(stagingDbPath) };
}

function mergeStatement(liveDbPath, table) {
  const columns = tableColumns(liveDbPath, table);
  const primary = primaryKeyColumns(liveDbPath, table);
  if (!primary.length) throw new Error(`primary_key_missing:${table}`);
  const quoted = columns.map(quoteIdentifier).join(", ");
  const updateColumns = columns.filter((column) => !primary.includes(column));
  const update = updateColumns.map((column) => `${quoteIdentifier(column)}=excluded.${quoteIdentifier(column)}`).join(", ");
  const freshness = columns.includes("updated_at")
    ? ` WHERE excluded."updated_at" >= ${quoteIdentifier(table)}."updated_at"`
    : "";
  return `INSERT INTO main.${quoteIdentifier(table)} (${quoted}) SELECT ${quoted} FROM staging.${quoteIdentifier(table)} WHERE true ON CONFLICT (${primary.map(quoteIdentifier).join(", ")}) DO UPDATE SET ${update}${freshness};`;
}

export function seedLiveDatabase({ stagingDbPath, liveDbPath, stateDir = DEFAULT_STATE_DIR, reportDir = resolve(stateDir, "reports") }) {
  mkdirSync(reportDir, { recursive: true, mode: 0o700 });
  chmodSync(reportDir, 0o700);
  assertAllowlistSchema(stagingDbPath, liveDbPath);
  const beforePersonal = personalStateHash(liveDbPath);
  const before = databaseSummary(liveDbPath);
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "").replace("Z", "Z");
  const backupDir = resolve(stateDir, "backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = resolve(backupDir, `after-hours-seed-${stamp}.sqlite`);
  sqlite(liveDbPath, `.backup ${quoteLiteral(backupPath)}`);
  chmodSync(backupPath, 0o600);
  if (sqlite(backupPath, "PRAGMA integrity_check;") !== "ok") throw new Error("backup_integrity_failed");

  const transaction = [
    `ATTACH DATABASE ${quoteLiteral(stagingDbPath)} AS staging;`,
    "BEGIN IMMEDIATE;",
    ...TABLE_ALLOWLIST.map((table) => mergeStatement(liveDbPath, table)),
    "COMMIT;",
    "DETACH DATABASE staging;",
  ].join("\n");
  try {
    sqlite(liveDbPath, transaction);
    if (sqlite(liveDbPath, "PRAGMA integrity_check;") !== "ok") throw new Error("post_seed_integrity_failed");
    const afterPersonal = personalStateHash(liveDbPath);
    if (JSON.stringify(beforePersonal) !== JSON.stringify(afterPersonal)) throw new Error("personal_state_changed");
    const after = databaseSummary(liveDbPath);
    const report = {
      version: 1,
      schemaRevision: "0021",
      completedAt: new Date().toISOString(),
      result: "completed",
      reasonCode: "none",
      allowlist: TABLE_ALLOWLIST,
      backupId: basename(backupPath),
      personalState: afterPersonal,
      before,
      staging: databaseSummary(stagingDbPath),
      after,
    };
    const reportPath = resolve(reportDir, `after-hours-seed-${stamp}.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(resolve(reportDir, "after-hours-seed-latest.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return { backupPath, reportPath, report };
  } catch (error) {
    copyFileSync(backupPath, liveDbPath);
    throw error;
  }
}

export function exportRemote({ outputPath, database = "multichart-production" }) {
  assertSafeDirectory(dirname(outputPath));
  const args = ["wrangler", "d1", "export", database, "--remote", "--no-schema", "--skip-confirmation", "--output", outputPath];
  for (const table of TABLE_ALLOWLIST) args.push("--table", table);
  execFileSync("npx", args, { cwd: APP_DIR, stdio: ["ignore", "ignore", "inherit"] });
  chmodSync(outputPath, 0o600);
  const sql = readFileSync(outputPath, "utf8");
  return { exportedTables: validateExportSql(sql), checksum: createHash("sha256").update(sql).digest("hex") };
}

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? resolve(value.slice(prefix.length)) : null;
}

async function main() {
  const command = process.argv[2];
  if (command === "export") {
    const outputPath = option("output");
    if (!outputPath) throw new Error("output_required");
    const result = exportRemote({ outputPath });
    console.log(`export_status=ok\nexported_table_count=${result.exportedTables.length}\nexport_checksum=${result.checksum}`);
    return;
  }
  if (command === "stage") {
    const exportPath = option("export"); const stagingDbPath = option("staging"); const liveDbPath = option("live");
    if (!exportPath || !stagingDbPath || !liveDbPath) throw new Error("stage_paths_required");
    const result = stageExport({ exportPath, stagingDbPath, liveDbPath });
    console.log(`staging_status=ok\nmigration_count=${result.migrationCount}\nexported_table_count=${result.exportedTables.length}`);
    return;
  }
  if (command === "seed") {
    const stagingDbPath = option("staging"); const liveDbPath = option("live");
    if (!stagingDbPath || !liveDbPath) throw new Error("seed_paths_required");
    const result = seedLiveDatabase({ stagingDbPath, liveDbPath });
    console.log(`seed_status=ok\nbackup_id=${basename(result.backupPath)}\nreport_id=${basename(result.reportPath)}`);
    return;
  }
  if (command === "verify") {
    const liveDbPath = option("live");
    if (!liveDbPath) throw new Error("live_path_required");
    assertAllowlistSchema(liveDbPath);
    const summary = databaseSummary(liveDbPath);
    console.log(Object.entries(summary.groups).map(([group, value]) => `${group}=${value.status}:${value.processed}:${value.reasonCode}`).join("\n"));
    return;
  }
  throw new Error("usage: after-hours-d1-migration.mjs <export|stage|seed|verify> --...");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`after_hours_migration_failed=${String(error?.message || error).replace(/[^a-zA-Z0-9_:\-]/g, "_")}`);
    process.exitCode = 1;
  });
}
