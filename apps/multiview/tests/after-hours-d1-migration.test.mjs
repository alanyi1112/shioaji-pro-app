import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  TABLE_ALLOWLIST,
  applyMigrations,
  assertAllowlistSchema,
  personalStateHash,
  seedLiveDatabase,
  stageExport,
  validateExportSql,
} from "../scripts/after-hours-d1-migration.mjs";

const runSql = (dbPath, sql) => execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim();
const runSqlInput = (dbPath, sql) => execFileSync("sqlite3", [dbPath], { encoding: "utf8", input: sql }).trim();

function workspace() {
  const directory = mkdtempSync(resolve(tmpdir(), "multiview-after-hours-test-"));
  chmodSync(directory, 0o700);
  return directory;
}

test("data-only export 只接受固定 table allowlist", () => {
  assert.deepEqual(validateExportSql("BEGIN; INSERT INTO `candle_history` VALUES (1); COMMIT;"), ["candle_history"]);
  assert.throws(() => validateExportSql("INSERT INTO user_tabs VALUES (1);"), /unknown_export_table/);
  assert.throws(() => validateExportSql("CREATE TABLE candle_history(x); INSERT INTO candle_history VALUES (1);"), /schema_statement_forbidden/);
  assert.equal(TABLE_ALLOWLIST.length, 12);
});

test("staging 套用 26 個 migration 並拒絕 schema drift", () => {
  const directory = workspace();
  const liveDbPath = resolve(directory, "live.sqlite");
  const stagingDbPath = resolve(directory, "staging.sqlite");
  const exportPath = resolve(directory, "export.sql");
  assert.equal(applyMigrations(liveDbPath), 26);
  assert.match(runSql(liveDbPath, "SELECT group_concat(name, ',') FROM pragma_table_info('tdcc_continuous_symbols');"), /official_plan_through/);
  assert.match(runSql(liveDbPath, "SELECT group_concat(name, ',') FROM pragma_table_info('tdcc_continuous_symbols');"), /coverage_verified_at/);
  assert.match(runSql(liveDbPath, "SELECT group_concat(name, ',') FROM pragma_index_list('tdcc_continuous_symbols');"), /tdcc_continuous_symbols_handoff_idx/);
  assert.match(runSql(liveDbPath, "SELECT group_concat(name, ',') FROM pragma_table_info('tdcc_backfill_dispatches');"), /deployment_target/);
  writeFileSync(exportPath, [
    "BEGIN TRANSACTION;",
    "INSERT INTO instrument_catalog (symbol,exchange,localized_name,english_name,aliases_json,normalized_search,market,group_name,quote_type,provider,source,active,source_updated_at,updated_at) VALUES ('TEST.TW','TWSE','測試','Test','[]','test','台股','測試','','yfinance','test',1,'2026-08-06','2026-08-06');",
    "COMMIT;",
  ].join("\n"), { mode: 0o600 });
  const result = stageExport({ exportPath, stagingDbPath, liveDbPath });
  assert.equal(result.migrationCount, 26);
  assert.equal(result.integrity, "ok");
  assert.equal(result.tables.instrument_catalog.rowCount, 1);
  assert.doesNotThrow(() => assertAllowlistSchema(stagingDbPath, liveDbPath));
});

test("原子 seed 保留個人清單 hash 並產生去識別化報告", () => {
  const directory = workspace();
  const liveDbPath = resolve(directory, "live.sqlite");
  const stagingDbPath = resolve(directory, "staging.sqlite");
  applyMigrations(liveDbPath);
  applyMigrations(stagingDbPath);
  runSql(liveDbPath, "INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('private-user','tab-1','個人',1,1,0,'');");
  runSql(stagingDbPath, "INSERT INTO taiwan_stock_chip_daily (symbol,session_date,exchange,provenance_json,completeness_json) VALUES ('2330.TW','2026-08-06','TWSE','{}','{}');");
  const before = personalStateHash(liveDbPath);
  const result = seedLiveDatabase({ stagingDbPath, liveDbPath, stateDir: directory });
  assert.deepEqual(personalStateHash(liveDbPath), before);
  assert.equal(runSql(liveDbPath, "SELECT COUNT(*) FROM taiwan_stock_chip_daily;"), "1");
  assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
  const reportText = readFileSync(result.reportPath, "utf8");
  assert.doesNotMatch(reportText, /private-user|2330\.TW|INSERT INTO/i);
  assert.equal(JSON.parse(reportText).result, "completed");
});

test("0024 additive upgrade 保留既有 TDCC 與個人資料，journal 只登錄一次", () => {
  const directory = workspace();
  const databasePath = resolve(directory, "before-0024.sqlite");
  const migrationDirectory = resolve(import.meta.dirname, "../drizzle");
  const migrations = readdirSync(migrationDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const migration24Index = migrations.indexOf("0024_gifted_thunderbolt_ross.sql");
  assert.ok(migration24Index > 0);
  for (const file of migrations.slice(0, migration24Index)) {
    runSqlInput(databasePath, readFileSync(resolve(migrationDirectory, file), "utf8").replaceAll("--> statement-breakpoint", "\n"));
  }
  runSql(databasePath, "INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES ('private-user','tab-1','個人',1,1,0,'');");
  runSql(databasePath, "INSERT INTO user_instruments (user_id,item_id,tab_id,sort_order,symbol,name,provider,tab_label,group_name,market,enabled) VALUES ('private-user','item-1','tab-1',1,'3008.TW','大立光','yfinance','個人','個人','TW',1);");
  runSql(databasePath, "INSERT INTO tdcc_continuous_symbols (symbol,source,active,status,expected_weeks,completed_weeks,first_seen_at,last_seen_at) VALUES ('3008.TW','user',1,'completed',53,53,'2026-07-31','2026-08-21');");
  const personalBefore = personalStateHash(databasePath);
  runSqlInput(databasePath, readFileSync(resolve(migrationDirectory, migrations[migration24Index]), "utf8").replaceAll("--> statement-breakpoint", "\n"));
  assert.deepEqual(personalStateHash(databasePath), personalBefore);
  assert.equal(runSql(databasePath, "SELECT expected_weeks || ':' || completed_weeks FROM tdcc_continuous_symbols WHERE symbol='3008.TW';"), "53:53");
  assert.equal(runSql(databasePath, "SELECT official_plan_through IS NULL AND coverage_verified_at IS NULL FROM tdcc_continuous_symbols WHERE symbol='3008.TW';"), "1");
  const journal = JSON.parse(readFileSync(resolve(migrationDirectory, "meta/_journal.json"), "utf8"));
  assert.equal(journal.entries.filter((entry) => entry.tag === "0024_gifted_thunderbolt_ross").length, 1);
});
