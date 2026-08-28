import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TDCC_WORKFLOW_DISPATCH_CONTRACT,
  dispatchTdccContinuousWorkflow,
  readTdccWorkflowDispatch,
} from "../worker/tdcc-workflow-dispatch.ts";
import { applyDrizzleSql, SqliteD1 } from "./helpers/sqlite-d1.mjs";

const migrations = await Promise.all([
  "0003_mute_sprite.sql",
  "0006_thin_mentor.sql",
  "0007_clever_mach_iv.sql",
  "0008_dazzling_rafael_vega.sql",
  "0010_panoramic_silk_fever.sql",
  "0025_sharp_callisto.sql",
].map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")));

function dispatchDb() {
  const db = new SqliteD1();
  for (const migration of migrations) applyDrizzleSql(db, migration);
  return db;
}

test("未設定 workflow dispatch secret 時 fail closed 且 durable queue 可保留", async (t) => {
  const db = dispatchDb();
  t.after(() => db.close());
  const result = await dispatchTdccContinuousWorkflow({ db, symbol: "3481.TW", now: "2026-07-19T09:30:00Z" });
  assert.deepEqual(result, {
    status: "unavailable",
    deploymentTarget: "sites",
    requestedAt: "2026-07-19T09:30:00.000Z",
    cooldownUntil: null,
    errorCode: "dispatch_not_configured",
  });
  const stored = await readTdccWorkflowDispatch(db, "3481.TW");
  assert.equal(stored.status, "unavailable");
  assert.equal(stored.lastErrorCode, "dispatch_not_configured");
  assert.equal(stored.deploymentTarget, "sites");
});

test("立即 dispatch 固定 private repo workflow 與 main ref，冷卻內不重複啟動", async (t) => {
  const db = dispatchDb();
  t.after(() => db.close());
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  const started = await dispatchTdccContinuousWorkflow({ db, symbol: "3481.TW", token: "test-only-token", now: "2026-07-19T09:30:00Z", fetchImpl });
  const repeated = await dispatchTdccContinuousWorkflow({ db, symbol: "3481.TW", token: "test-only-token", now: "2026-07-19T09:30:30Z", fetchImpl });

  assert.equal(started.status, "started");
  assert.equal(repeated.status, "cooldown");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TDCC_WORKFLOW_DISPATCH_CONTRACT.urls.sites);
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: "main" });
  assert.equal(JSON.stringify({ started, repeated }).includes("test-only-token"), false);
});

test("Cloudflare 新商品只 dispatch Cloudflare TDCC workflow", async (t) => {
  const db = dispatchDb();
  t.after(() => db.close());
  const calls = [];
  const result = await dispatchTdccContinuousWorkflow({
    db,
    symbol: "2330.TW",
    token: "test-only-token",
    deploymentTarget: "cloudflare",
    now: "2026-07-19T09:30:00Z",
    fetchImpl: async (url) => { calls.push(String(url)); return new Response(null, { status: 204 }); },
  });
  assert.equal(result.status, "started");
  assert.equal(result.deploymentTarget, "cloudflare");
  assert.equal((await readTdccWorkflowDispatch(db, "2330.TW")).deploymentTarget, "cloudflare");
  assert.deepEqual(calls, [TDCC_WORKFLOW_DISPATCH_CONTRACT.urls.cloudflare]);
});

test("新鮮 runner heartbeat 會去重，GitHub 失敗只保存 allowlist 錯誤碼", async (t) => {
  const db = dispatchDb();
  t.after(() => db.close());
  await db.prepare(`INSERT INTO tdcc_continuous_runs (run_id,trigger,status,heartbeat_at,started_at)
    VALUES ('running-now','workflow_dispatch','running','2026-07-19T09:29:00Z','2026-07-19T09:28:00Z')`).run();
  let calls = 0;
  const alreadyRunning = await dispatchTdccContinuousWorkflow({
    db,
    symbol: "3481.TW",
    token: "test-only-token",
    now: "2026-07-19T09:30:00Z",
    fetchImpl: async () => { calls += 1; return new Response(null, { status: 204 }); },
  });
  assert.equal(alreadyRunning.status, "already-running");
  assert.equal(calls, 0);

  await db.prepare("UPDATE tdcc_continuous_runs SET status='completed' WHERE run_id='running-now'").run();
  const failed = await dispatchTdccContinuousWorkflow({
    db,
    symbol: "2330.TW",
    token: "test-only-token",
    now: "2026-07-19T09:33:00Z",
    fetchImpl: async () => new Response(null, { status: 403 }),
  });
  assert.deepEqual(failed, {
    status: "failed",
    deploymentTarget: "sites",
    requestedAt: "2026-07-19T09:33:00.000Z",
    cooldownUntil: null,
    errorCode: "dispatch_unauthorized",
  });
  assert.equal(JSON.stringify(await readTdccWorkflowDispatch(db, "2330.TW")).includes("test-only-token"), false);
});
