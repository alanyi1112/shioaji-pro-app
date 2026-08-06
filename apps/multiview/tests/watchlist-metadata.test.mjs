import assert from "node:assert/strict";
import test from "node:test";
import { SqliteD1 } from "./helpers/sqlite-d1.mjs";
import {
  ensureWatchlistMetadataColumns,
  normalizeRecommender,
  taipeiCalendarDate,
} from "../worker/watchlist-metadata.ts";

test("台北伺服器日期以 Asia/Taipei 日界線判定", () => {
  assert.equal(taipeiCalendarDate("2026-07-22T15:59:59.000Z"), "2026-07-22");
  assert.equal(taipeiCalendarDate("2026-07-22T16:00:00.000Z"), "2026-07-23");
});

test("推薦人正規化長度並拒絕控制字元", () => {
  assert.equal(normalizeRecommender("  王小明   老師  "), "王小明 老師");
  assert.equal(normalizeRecommender(""), "");
  assert.throws(() => normalizeRecommender("甲".repeat(81)), /recommender_too_long/);
  assert.throws(() => normalizeRecommender("王小明\n老師"), /recommender_control_character/);
});

test("舊清單 migration 建 stable itemId，但不偽造加入日期", async () => {
  const db = new SqliteD1();
  try {
    db.exec("CREATE TABLE user_instruments (user_id TEXT NOT NULL,symbol TEXT NOT NULL,name TEXT NOT NULL,provider TEXT NOT NULL,tab_id TEXT NOT NULL DEFAULT '',tab_label TEXT NOT NULL,group_name TEXT NOT NULL,market TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,sort_order INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,symbol,tab_id))");
    db.exec("INSERT INTO user_instruments (user_id,symbol,name,provider,tab_label,group_name,market) VALUES ('u','2330.TW','台積電','yfinance','台股','個股','台灣股市')");
    await ensureWatchlistMetadataColumns(db);
    await ensureWatchlistMetadataColumns(db);
    const item = db.database.prepare("SELECT item_id,added_at,date_status,date_source,recommender FROM user_instruments").get();
    assert.match(item.item_id, /^[0-9a-f]{32}$/);
    assert.equal(item.added_at, null);
    assert.equal(item.date_status, "legacy_unknown");
    assert.equal(item.date_source, null);
    assert.equal(item.recommender, "");
  } finally {
    db.close();
  }
});
