import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanupExpiredCandleCache, readCandleCacheMaintenance } from "../worker/cache-maintenance.ts";
import { meterD1Database, recordCacheEvent, recordRuntimeInvocation, resetRuntimeUsageForTest, runtimeUsageSummary } from "../worker/runtime-usage.ts";
import { applyDrizzleSql, SqliteD1 } from "./helpers/sqlite-d1.mjs";

const cacheMigration = await readFile(new URL("../drizzle/0001_add_candle_cache.sql", import.meta.url), "utf8");
const retentionMigration = await readFile(new URL("../drizzle/0019_acoustic_swordsman.sql", import.meta.url), "utf8");

test("cache retention migration 建立 expiry index 並以 40 rows 上限清理及保存 remaining", async (t) => {
  const raw = new SqliteD1();
  t.after(() => raw.close());
  applyDrizzleSql(raw, cacheMigration);
  applyDrizzleSql(raw, retentionMigration);
  const now = new Date("2026-07-30T00:00:00.000Z");
  const epoch = Math.floor(now.getTime() / 1000);
  for (let index = 0; index < 45; index += 1) {
    await raw.prepare("INSERT INTO candle_cache (cache_key,payload,expires_at) VALUES (?,?,?)").bind(`expired-${index}`, "{}", epoch - index - 1).run();
  }
  await raw.prepare("INSERT INTO candle_cache (cache_key,payload,expires_at) VALUES (?,?,?)").bind("fresh", "{}", epoch + 3600).run();

  const first = await cleanupExpiredCandleCache(raw, now, 999);
  assert.deepEqual(first, { status: "healthy", lastRunAt: now.toISOString(), deletedRows: 40, remainingRows: 5, reasonCode: null });
  const second = await cleanupExpiredCandleCache(raw, new Date(now.getTime() + 1000));
  assert.equal(second.deletedRows, 5);
  assert.equal(second.remainingRows, 0);
  assert.equal(raw.database.prepare("SELECT COUNT(*) AS rows FROM candle_cache").get().rows, 1);
  assert.equal((await readCandleCacheMaintenance(raw)).status, "healthy");
  assert.equal(raw.database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='candle_cache_expires_at_idx'").get().name, "candle_cache_expires_at_idx");
});

test("runtime health 摘要只回報 isolate 計數，不包含 SQL、參數或個人資料", async (t) => {
  resetRuntimeUsageForTest();
  const raw = new SqliteD1();
  t.after(() => raw.close());
  raw.exec("CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const db = meterD1Database(raw);
  recordRuntimeInvocation("request");
  recordRuntimeInvocation("scheduled");
  recordCacheEvent("miss");
  recordCacheEvent("write_failure");
  await db.prepare("INSERT INTO sample (id,value) VALUES (?,?)").bind("private@example.invalid", "[REDACTED_SECRET]").run();
  await db.prepare("SELECT value FROM sample WHERE id=?").bind("private@example.invalid").first();

  const summary = runtimeUsageSummary();
  assert.equal(summary.requests, 1);
  assert.equal(summary.scheduledInvocations, 1);
  assert.equal(summary.d1.queries, 1);
  assert.equal(summary.d1.writes, 1);
  assert.deepEqual(summary.cache, { hits: 0, misses: 1, stale: 0, readFailures: 0, writeFailures: 1 });
  assert.equal(JSON.stringify(summary).includes("private@example.invalid"), false);
  assert.equal(JSON.stringify(summary).includes("REDACTED_SECRET"), false);
});

test("cache cleanup failure 只回傳安全 reason，不拋出上游或 D1 原始錯誤", async () => {
  const failed = await cleanupExpiredCandleCache({ prepare() { throw new Error("credential=do-not-leak"); } }, new Date("2026-07-30T00:00:00.000Z"));
  assert.deepEqual(failed, { status: "degraded", lastRunAt: "2026-07-30T00:00:00.000Z", deletedRows: 0, remainingRows: null, reasonCode: "cache_cleanup_failed" });
  assert.equal(JSON.stringify(failed).includes("do-not-leak"), false);
});
