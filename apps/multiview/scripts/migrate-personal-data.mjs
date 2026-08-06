#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TAB_FIELDS = ["id", "label", "sort_order", "enabled", "is_default", "source_tab_id"];
const INSTRUMENT_FIELDS = ["item_id", "symbol", "name", "provider", "tab_id", "tab_label", "group_name", "market", "enabled", "sort_order", "added_at", "date_status", "date_source", "recommender"];

function parseArguments(argv) {
  const result = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") result.apply = true;
    else if (["--snapshot", "--mapping", "--target-db", "--target-user"].includes(value)) result[value.slice(2)] = argv[++index];
    else throw new Error("invalid_arguments");
  }
  return result;
}

function canonicalRows(rows) {
  return [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid_mapping");
  return email;
}

function normalizedLocalUserId(value = "local-sites-user") {
  const userId = String(value || "").trim().toLowerCase();
  if (!/^local-[a-z0-9-]{3,64}$/.test(userId)) throw new Error("invalid_local_user");
  return userId;
}

function projectRow(row, fields, userId) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid_snapshot");
  const projected = { user_id: userId };
  for (const field of fields) projected[field] = row[field] ?? null;
  return projected;
}

export function planPersonalDataMigration(snapshot, mappings) {
  const tabs = Array.isArray(snapshot?.userTabs) ? snapshot.userTabs : null;
  const instruments = Array.isArray(snapshot?.userInstruments) ? snapshot.userInstruments : null;
  if (!tabs || !instruments || !Array.isArray(mappings) || !mappings.length) throw new Error("mapping_required");
  const mapping = new Map();
  for (const item of mappings) {
    const sourceUserId = String(item?.sourceUserId || "").trim();
    if (!sourceUserId || mapping.has(sourceUserId)) throw new Error("invalid_mapping");
    mapping.set(sourceUserId, normalizedEmail(item?.targetEmail));
  }
  const sourceUserIds = new Set([...tabs, ...instruments].map((row) => String(row?.user_id || "").trim()).filter(Boolean));
  if (!sourceUserIds.size || [...sourceUserIds].some((userId) => !mapping.has(userId))) throw new Error("mapping_required");
  if ([...mapping.keys()].some((userId) => !sourceUserIds.has(userId))) throw new Error("invalid_mapping");

  const plannedTabs = canonicalRows(tabs.map((row) => projectRow(row, TAB_FIELDS, mapping.get(String(row.user_id).trim()))));
  const plannedInstruments = canonicalRows(instruments.map((row) => projectRow(row, INSTRUMENT_FIELDS, mapping.get(String(row.user_id).trim()))));
  const sourceCanonical = canonicalRows([
    ...tabs.map((row) => projectRow(row, TAB_FIELDS, "source-user")),
    ...instruments.map((row) => projectRow(row, INSTRUMENT_FIELDS, "source-user")),
  ]);
  const targetCanonical = canonicalRows([...plannedTabs, ...plannedInstruments]);
  return {
    tabs: plannedTabs,
    instruments: plannedInstruments,
    summary: {
      mode: "dry-run",
      mappingCount: mapping.size,
      rowCount: { tabs: plannedTabs.length, instruments: plannedInstruments.length, total: targetCanonical.length },
      sourceHash: digest(sourceCanonical),
      targetHash: digest(targetCanonical),
      sampleKeyHashes: targetCanonical.slice(0, 3).map((row) => digest(row).slice(0, 16)),
    },
  };
}

export function planLocalPersonalDataMigration(snapshot, targetUserId = "local-sites-user") {
  const tabs = Array.isArray(snapshot?.userTabs) ? snapshot.userTabs : null;
  const instruments = Array.isArray(snapshot?.userInstruments) ? snapshot.userInstruments : null;
  if (!tabs || !instruments) throw new Error("invalid_snapshot");
  const sourceUserIds = new Set([...tabs, ...instruments]
    .map((row) => String(row?.user_id || "").trim())
    .filter(Boolean));
  if (sourceUserIds.size !== 1) throw new Error("single_user_snapshot_required");
  const opaqueUserId = normalizedLocalUserId(targetUserId);
  const plannedTabs = canonicalRows(tabs.map((row) => projectRow(row, TAB_FIELDS, opaqueUserId)));
  const plannedInstruments = canonicalRows(instruments.map((row) => projectRow(row, INSTRUMENT_FIELDS, opaqueUserId)));
  const sourceCanonical = canonicalRows([
    ...tabs.map((row) => projectRow(row, TAB_FIELDS, "source-user")),
    ...instruments.map((row) => projectRow(row, INSTRUMENT_FIELDS, "source-user")),
  ]);
  const targetCanonical = canonicalRows([...plannedTabs, ...plannedInstruments]);
  return {
    tabs: plannedTabs,
    instruments: plannedInstruments,
    summary: {
      mode: "dry-run-local",
      targetIdentity: "opaque-local-user",
      rowCount: { tabs: plannedTabs.length, instruments: plannedInstruments.length, total: targetCanonical.length },
      sourceHash: digest(sourceCanonical),
      targetHash: digest(targetCanonical),
      sampleKeyHashes: targetCanonical.slice(0, 3).map((row) => digest(row).slice(0, 16)),
    },
  };
}

function insertStatement(table, fields, conflictFields) {
  const columns = ["user_id", ...fields];
  const updates = fields.map((field) => `${field}=excluded.${field}`).join(",");
  return `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(${conflictFields.join(",")}) DO UPDATE SET ${updates},updated_at=CURRENT_TIMESTAMP`;
}

async function d1Query({ accountId, databaseId, token }, sql, params) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  if (!response.ok) throw new Error("d1_request_failed");
  const payload = await response.json();
  if (payload?.success !== true || !Array.isArray(payload?.result)) throw new Error("d1_request_failed");
  return payload.result[0]?.results || [];
}

function rowValues(row, fields) {
  return [row.user_id, ...fields.map((field) => row[field])];
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_snapshot");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function localInsertStatement(table, fields, conflictFields, row) {
  const columns = ["user_id", ...fields];
  const values = columns.map((field) => sqlLiteral(row[field]));
  const updates = fields.map((field) => `${field}=excluded.${field}`).join(",");
  return `INSERT INTO ${table} (${columns.join(",")}) VALUES (${values.join(",")}) ON CONFLICT(${conflictFields.join(",")}) DO UPDATE SET ${updates},updated_at=CURRENT_TIMESTAMP;`;
}

function sqlite(dbPath, args, input) {
  const result = spawnSync("sqlite3", [...args, dbPath], {
    input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("local_migration_failed");
  return String(result.stdout || "");
}

function readLocalRows(dbPath, table, fields, targetUserId) {
  const sql = `SELECT user_id,${fields.join(",")} FROM ${table} WHERE user_id=${sqlLiteral(targetUserId)} ORDER BY ${table === "user_tabs" ? "id" : "symbol,tab_id"};`;
  const output = sqlite(dbPath, ["-json"], sql).trim();
  return output ? JSON.parse(output) : [];
}

export function applyLocalPersonalDataMigration(plan, targetDb) {
  if (!isAbsolute(targetDb || "")) throw new Error("target_configuration_required");
  const dbPath = resolve(targetDb);
  const targetUserIds = new Set([...plan.tabs, ...plan.instruments].map((row) => row.user_id));
  if (targetUserIds.size !== 1) throw new Error("single_user_snapshot_required");
  const targetUserId = normalizedLocalUserId([...targetUserIds][0]);
  const statements = [
    "PRAGMA foreign_keys=ON;",
    "BEGIN IMMEDIATE;",
    ...plan.tabs.map((row) => localInsertStatement("user_tabs", TAB_FIELDS, ["user_id", "id"], row)),
    ...plan.instruments.map((row) => localInsertStatement("user_instruments", INSTRUMENT_FIELDS, ["user_id", "symbol", "tab_id"], row)),
    "COMMIT;",
  ];
  sqlite(dbPath, [], statements.join("\n"));
  const actualTabs = canonicalRows(readLocalRows(dbPath, "user_tabs", TAB_FIELDS, targetUserId)
    .map((row) => projectRow(row, TAB_FIELDS, row.user_id)));
  const actualInstruments = canonicalRows(readLocalRows(dbPath, "user_instruments", INSTRUMENT_FIELDS, targetUserId)
    .map((row) => projectRow(row, INSTRUMENT_FIELDS, row.user_id)));
  const expected = canonicalRows([...plan.tabs, ...plan.instruments]);
  const actual = canonicalRows([...actualTabs, ...actualInstruments]);
  if (digest(expected) !== digest(actual)) throw new Error("verification_failed");
  const integrity = sqlite(dbPath, [], "PRAGMA integrity_check;").trim();
  if (integrity !== "ok") throw new Error("verification_failed");
  return {
    rowCount: actual.length,
    hash: digest(actual),
    integrity,
    sampleKeyHashes: actual.slice(0, 3).map((row) => digest(row).slice(0, 16)),
  };
}

async function verifyAppliedRows(config, plan) {
  const actualTabs = [];
  const actualInstruments = [];
  for (const row of plan.tabs) {
    const rows = await d1Query(config, `SELECT user_id,${TAB_FIELDS.join(",")} FROM user_tabs WHERE user_id=? AND id=?`, [row.user_id, row.id]);
    if (rows.length !== 1) throw new Error("verification_failed");
    actualTabs.push(projectRow(rows[0], TAB_FIELDS, rows[0].user_id));
  }
  for (const row of plan.instruments) {
    const rows = await d1Query(config, `SELECT user_id,${INSTRUMENT_FIELDS.join(",")} FROM user_instruments WHERE user_id=? AND symbol=? AND tab_id=?`, [row.user_id, row.symbol, row.tab_id]);
    if (rows.length !== 1) throw new Error("verification_failed");
    actualInstruments.push(projectRow(rows[0], INSTRUMENT_FIELDS, rows[0].user_id));
  }
  const expected = canonicalRows([...plan.tabs, ...plan.instruments]);
  const actual = canonicalRows([...actualTabs, ...actualInstruments]);
  if (digest(expected) !== digest(actual)) throw new Error("verification_failed");
  return { rowCount: actual.length, hash: digest(actual), sampleKeyHashes: actual.slice(0, 3).map((row) => digest(row).slice(0, 16)) };
}

export async function applyPersonalDataMigration(plan, config) {
  if (!config?.accountId || !config?.databaseId || !config?.token) throw new Error("target_configuration_required");
  const tabSql = insertStatement("user_tabs", TAB_FIELDS, ["user_id", "id"]);
  const instrumentSql = insertStatement("user_instruments", INSTRUMENT_FIELDS, ["user_id", "symbol", "tab_id"]);
  for (const row of plan.tabs) await d1Query(config, tabSql, rowValues(row, TAB_FIELDS));
  for (const row of plan.instruments) await d1Query(config, instrumentSql, rowValues(row, INSTRUMENT_FIELDS));
  return verifyAppliedRows(config, plan);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.snapshot) throw new Error("mapping_required");
  const snapshot = await readFile(args.snapshot, "utf8").then(JSON.parse);
  const localMode = Boolean(args["target-db"]);
  const mappings = args.mapping ? await readFile(args.mapping, "utf8").then(JSON.parse) : null;
  const plan = localMode
    ? planLocalPersonalDataMigration(snapshot, args["target-user"])
    : planPersonalDataMigration(snapshot, mappings);
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(plan.summary)}\n`);
    return;
  }
  if (localMode) {
    const verification = applyLocalPersonalDataMigration(plan, args["target-db"]);
    process.stdout.write(`${JSON.stringify({ ...plan.summary, mode: "apply-local", verification })}\n`);
    return;
  }
  const verification = await applyPersonalDataMigration(plan, {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
  process.stdout.write(`${JSON.stringify({ ...plan.summary, mode: "apply", verification })}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    const safeReason = ["mapping_required", "invalid_mapping", "invalid_snapshot", "invalid_arguments", "invalid_local_user", "single_user_snapshot_required", "target_configuration_required", "local_migration_failed", "d1_request_failed", "verification_failed"].includes(error?.message) ? error.message : "migration_failed";
    process.stderr.write(`${safeReason}\n`);
    process.exitCode = 1;
  });
}
