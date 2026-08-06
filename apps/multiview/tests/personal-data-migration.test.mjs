import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  applyLocalPersonalDataMigration,
  planLocalPersonalDataMigration,
  planPersonalDataMigration,
} from "../scripts/migrate-personal-data.mjs";

const snapshot = {
  userTabs: [{ user_id: "legacy-owner", id: "tab-a", label: "清單", sort_order: 1, enabled: 1, is_default: 1, source_tab_id: "" }],
  userInstruments: [{ user_id: "legacy-owner", item_id: "item-a", symbol: "2330.TW", name: "台積電", provider: "yfinance", tab_id: "tab-a", tab_label: "清單", group_name: "上市股票", market: "台灣股市", enabled: 1, sort_order: 1, added_at: null, date_status: "legacy_unknown", date_source: null, recommender: "" }],
};

test("個人資料遷移預設只建立可重現的 row-count/hash 計畫且不輸出 email", () => {
  const first = planPersonalDataMigration(snapshot, [{ sourceUserId: "legacy-owner", targetEmail: "Owner@Example.Invalid" }]);
  const second = planPersonalDataMigration(snapshot, [{ sourceUserId: "legacy-owner", targetEmail: "owner@example.invalid" }]);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.summary.rowCount, { tabs: 1, instruments: 1, total: 2 });
  assert.equal(first.tabs[0].user_id, "owner@example.invalid");
  assert.equal(JSON.stringify(first.summary).includes("owner@example.invalid"), false);
  assert.match(first.summary.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(first.summary.targetHash, /^[a-f0-9]{64}$/);
});

test("缺少、重複或未涵蓋全部 source user 的 mapping 時停止", () => {
  assert.throws(() => planPersonalDataMigration(snapshot, []), /mapping_required/);
  assert.throws(() => planPersonalDataMigration(snapshot, [{ sourceUserId: "different-user", targetEmail: "owner@example.invalid" }]), /mapping_required/);
  assert.throws(() => planPersonalDataMigration(snapshot, [
    { sourceUserId: "legacy-owner", targetEmail: "owner@example.invalid" },
    { sourceUserId: "legacy-owner", targetEmail: "member@example.invalid" },
  ]), /invalid_mapping/);
});

test("遷移計畫保留 legacy_unknown 與 null added_at，不以執行日偽造加入日期", () => {
  const plan = planPersonalDataMigration(snapshot, [{ sourceUserId: "legacy-owner", targetEmail: "owner@example.invalid" }]);
  assert.equal(plan.instruments[0].added_at, null);
  assert.equal(plan.instruments[0].date_status, "legacy_unknown");
  assert.equal(JSON.stringify(plan.instruments).includes("2026-07-30"), false);
});

test("本機遷移將單一來源使用者映射為 opaque local identity", () => {
  const plan = planLocalPersonalDataMigration(snapshot);
  assert.equal(plan.tabs[0].user_id, "local-sites-user");
  assert.equal(plan.instruments[0].user_id, "local-sites-user");
  assert.equal(plan.summary.targetIdentity, "opaque-local-user");
  assert.equal(JSON.stringify(plan.summary).includes("legacy-owner"), false);
  assert.throws(() => planLocalPersonalDataMigration({
    userTabs: snapshot.userTabs,
    userInstruments: [{ ...snapshot.userInstruments[0], user_id: "another-user" }],
  }), /single_user_snapshot_required/);
});

test("本機遷移以 transaction upsert 並回讀 hash 與 integrity", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "multiview-personal-migration-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = join(directory, "target.sqlite");
  const schema = `
    CREATE TABLE user_tabs (user_id TEXT NOT NULL,id TEXT NOT NULL,label TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,is_default INTEGER NOT NULL DEFAULT 0,source_tab_id TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,id));
    CREATE TABLE user_instruments (user_id TEXT NOT NULL,item_id TEXT,symbol TEXT NOT NULL,name TEXT NOT NULL,provider TEXT NOT NULL,tab_id TEXT NOT NULL DEFAULT '',tab_label TEXT NOT NULL,group_name TEXT NOT NULL,market TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,sort_order INTEGER,added_at TEXT,date_status TEXT NOT NULL DEFAULT 'legacy_unknown',date_source TEXT,recommender TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,symbol,tab_id));
  `;
  assert.equal(spawnSync("sqlite3", [db], { input: schema }).status, 0);
  const plan = planLocalPersonalDataMigration(snapshot);
  const verification = applyLocalPersonalDataMigration(plan, db);
  assert.deepEqual(verification.rowCount, 2);
  assert.equal(verification.integrity, "ok");
  assert.equal(verification.hash, plan.summary.targetHash);
});
