import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";
import { ohlcvV4UpsertStatement, validateSourcedOhlcvV4 } from "../worker/stock-screener-ohlcv-repository.ts";

const directory = new URL("../drizzle/", import.meta.url);
const sql = (name) => readFileSync(new URL(name, directory), "utf8").replaceAll("--> statement-breakpoint", "\n");
const point = (patch = {}) => ({
  symbol: "2330.TW", market: "TWSE", sessionDate: "2026-08-31",
  open: "100", high: "105", low: "99", close: "104", volumeShares: "1234567",
  volumeUnit: "shares", volumeField: "成交股數", currency: "TWD",
  priceBasis: "official-unadjusted-after-market-twd", mappingVersion: "official-daily-ohlcv-v2",
  provenance: { source: "TWSE", sourceUrl: "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
    fetchedAt: "2026-09-01T10:00:00Z", payloadHash: "a".repeat(64), normalizationVersion: "official-daily-ohlcv-v2" },
  ...patch,
});

test("0031 additive migration 保留 v1 OHLC 並加入 nullable volume metadata 與 coverage index", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql("0027_pale_randall_flagg.sql"));
    db.exec(sql("0028_early_sir_ram.sql"));
    db.exec(sql("0029_plain_strong_guy.sql"));
    db.exec("INSERT INTO screener_daily_ohlcv(symbol,data_date,market,open,high,low,close,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation) VALUES('1101.TW','2026-08-31','TWSE','10','11','9','10','TWD','official-unadjusted-after-market-twd','official-daily-ohlcv-v1','https://www.twse.com.tw/x','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-09-01T00:00:00Z','canonical-complete-v1')");
    db.exec(sql("0031_screener_ohlcv_v4.sql"));
    const row = db.prepare("SELECT close,volume_shares,validation FROM screener_daily_ohlcv").get();
    assert.deepEqual({ ...row }, { close: "10", volume_shares: null, validation: "canonical-complete-v1" });
    const columns = db.prepare("PRAGMA table_info(screener_daily_ohlcv)").all().map((item) => item.name);
    for (const name of ["volume_shares", "volume_unit", "volume_field", "volume_mapping_version"]) assert.ok(columns.includes(name));
    assert.ok(db.prepare("PRAGMA index_list(screener_daily_ohlcv)").all().some((item) => item.name === "screener_daily_ohlcv_v4_coverage_idx"));
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", directory), "utf8"));
    assert.equal(journal.entries.filter((entry) => entry.tag === "0031_screener_ohlcv_v4").length, 1);
  } finally { db.close(); }
});

test("v4 repository 只保存完整官方整數股數，較舊或稀疏資料不覆蓋", async () => {
  const db = new SqliteD1();
  try {
    applyDrizzleSql(db, await import("node:fs/promises").then(({ readFile }) => readFile(new URL("0027_pale_randall_flagg.sql", directory), "utf8")));
    applyDrizzleSql(db, await import("node:fs/promises").then(({ readFile }) => readFile(new URL("0028_early_sir_ram.sql", directory), "utf8")));
    applyDrizzleSql(db, await import("node:fs/promises").then(({ readFile }) => readFile(new URL("0029_plain_strong_guy.sql", directory), "utf8")));
    applyDrizzleSql(db, await import("node:fs/promises").then(({ readFile }) => readFile(new URL("0031_screener_ohlcv_v4.sql", directory), "utf8")));
    assert.equal(validateSourcedOhlcvV4(point()), true);
    await ohlcvV4UpsertStatement(db, point()).run();
    await ohlcvV4UpsertStatement(db, point({ fetchedAt: undefined, provenance: { ...point().provenance, fetchedAt: "2026-09-01T09:00:00Z" }, volumeShares: "999" })).run();
    const row = await db.prepare("SELECT volume_shares,volume_unit,volume_field,volume_mapping_version,validation FROM screener_daily_ohlcv").first();
    assert.deepEqual({ ...row }, { volume_shares: "1234567", volume_unit: "shares", volume_field: "成交股數",
      volume_mapping_version: "official-daily-ohlcv-v2", validation: "canonical-complete-v2" });
    assert.throws(() => ohlcvV4UpsertStatement(db, point({ volumeShares: "1,000" })), /invalid_ohlcv_v4/);
  } finally { db.close(); }
});
