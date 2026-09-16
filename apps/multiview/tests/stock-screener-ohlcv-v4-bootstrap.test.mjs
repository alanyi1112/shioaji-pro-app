import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";
import {
  OHLCV_V4_CAPABILITY, buildOhlcvV4Progress, buildOhlcvV4Targets, planOhlcvV4Bootstrap,
  prepareScreenerOhlcvV4, pruneScreenerOhlcvV4, selectOhlcvV4Sessions,
} from "../../../scripts/stock-screener-ohlcv-bootstrap.mjs";

const directory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all(["0027_pale_randall_flagg.sql", "0028_early_sir_ram.sql", "0029_plain_strong_guy.sql", "0031_screener_ohlcv_v4.sql"]
  .map((name) => readFile(new URL(name, directory), "utf8")));
const setup = () => { const db = new SqliteD1(); migrations.forEach((sql) => applyDrizzleSql(db, sql)); return db; };
const sessions = Array.from({ length: 130 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
const universe = [
  { code: "1101", symbol: "1101.TW", name: "台泥", market: "TWSE", kind: "ordinary", listingDate: sessions[0] },
  { code: "7855", symbol: "7855.TW", name: "新上市", market: "TWSE", kind: "ordinary", listingDate: sessions.at(-2) },
  { code: "4768", symbol: "4768.TWO", name: "晶呈科技", market: "TPEx", kind: "ordinary", listingDate: sessions[0] },
];
const fields = {
  TWSE: ["證券代號", "證券名稱", "成交股數", "開盤價", "最高價", "最低價", "收盤價"],
  TPEx: ["代號", "名稱", "成交股數", "開盤", "最高", "最低", "收盤"],
};
const payload = (market, date, patch = {}) => {
  const rows = market === "TWSE"
    ? [["1101", "台泥", "1,000", "10", "11", "9", "10.5"], ["7855", "新上市", "0", "20", "21", "19", "20.5"]]
    : [["4768", "晶呈科技", "2,000", "30", "31", "29", "30.5"]];
  const table = { fields: patch.missingVolume ? fields[market].filter((field) => field !== "成交股數") : fields[market], data: rows };
  return { stat: market === "TWSE" ? "OK" : "ok", date: (patch.actualDate ?? date).replaceAll("-", ""),
    tables: market === "TWSE" ? [table] : [table, { fields: table.fields, data: [] }] };
};
const marketDate = (url) => {
  const parsed = new URL(url), market = parsed.hostname.includes("twse") ? "TWSE" : "TPEx";
  const raw = parsed.searchParams.get("date"), date = raw.includes("/") ? raw.replaceAll("/", "-") : `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  return { market, date };
};
const fetcher = (patches = {}) => async (url) => {
  const target = marketDate(url), patch = patches[`${target.market}|${target.date}`] ?? {};
  if (patch.status) return new Response(patch.body ?? "", { status: patch.status, headers: patch.headers });
  return Response.json(payload(target.market, target.date, patch));
};

test("v4 固定 130 sessions／260 targets，舊 OHLC receipt 不得算完成", () => {
  assert.deepEqual(selectOhlcvV4Sessions([...sessions, "2027-01-01"], sessions.at(-1)), sessions);
  const targets = buildOhlcvV4Targets(universe, sessions);
  assert.equal(targets.length, 260);
  assert.ok(targets.every((target) => target.dataCapability === OHLCV_V4_CAPABILITY && target.sourceMappingVersion === "official-daily-ohlcv-v2"));
  const legacy = targets.map((target) => ({ ...target, dataCapability: undefined, sourceMappingVersion: "official-daily-ohlcv-v1", status: "collected", complete: true }));
  assert.equal(planOhlcvV4Bootstrap(universe, sessions, legacy).processed, 0);
  const current = targets.map((target) => ({ ...target, status: "collected", complete: true }));
  const plan = planOhlcvV4Bootstrap(universe, sessions, current);
  assert.deepEqual({ target: plan.target, processed: plan.processed, remaining: plan.remaining, failed: plan.failed },
    { target: 260, processed: 260, remaining: 0, failed: 0 });
  assert.deepEqual(buildOhlcvV4Progress(plan, "2099-01-01T00:00:00Z").markets,
    { TWSE: { target: 130, processed: 130, failed: 0 }, TPEx: { target: 130, processed: 130, failed: 0 } });
});

test("v4 bounded operator 依 capability checkpoint 續跑到完整 260 targets", async () => {
  const db = setup(); let calls = 0;
  const official = fetcher(), counted = async (...args) => { calls++; return official(...args); };
  try {
    const first = await prepareScreenerOhlcvV4(db, { universe, sessions, universeRevision: "r4", validThrough: "2099-01-01T00:00:00Z", limit: 2, pauseMs: 0, fetcher: counted });
    assert.deepEqual({ processed: first.progress.processed, remaining: first.progress.remaining }, { processed: 2, remaining: 258 });
    const second = await prepareScreenerOhlcvV4(db, { universe, sessions, universeRevision: "r4", validThrough: "2099-01-01T00:00:00Z", limit: 260, pauseMs: 0, fetcher: counted });
    assert.equal(second.state, "complete");
    assert.deepEqual({ target: second.progress.target, processed: second.progress.processed, remaining: second.progress.remaining,
      failed: second.progress.failed, overdue: second.progress.overdue }, { target: 260, processed: 260, remaining: 0, failed: 0, overdue: 0 });
    assert.equal(calls, 260);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_runs WHERE scope='screener-ohlcv-v4-period' AND status='collected'").first()).n, 260);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_daily_ohlcv WHERE validation='canonical-complete-v2'").first()).n, 262);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_daily_ohlcv WHERE symbol='7855.TW'").first()).n, 2);
  } finally { db.close(); }
});

test("v4 schema drift 記 failed；429 保存 nextEligibleAt 且不製造 failed receipt", async () => {
  const latest = sessions.at(-1);
  const driftDb = setup();
  try {
    const result = await prepareScreenerOhlcvV4(driftDb, { universe, sessions, universeRevision: "r4", validThrough: "2099-01-01T00:00:00Z",
      limit: 1, pauseMs: 0, fetcher: fetcher({ [`TPEx|${latest}`]: { missingVolume: true } }) });
    assert.equal(result.progress.failed, 1);
    assert.equal(result.progress.remaining, 260);
  } finally { driftDb.close(); }
  const limitedDb = setup();
  try {
    await assert.rejects(prepareScreenerOhlcvV4(limitedDb, { universe, sessions, universeRevision: "r4", validThrough: "2099-01-01T00:00:00Z",
      limit: 1, pauseMs: 0, clock: () => Date.parse("2026-09-02T10:00:00Z"),
      fetcher: fetcher({ [`TPEx|${latest}`]: { status: 429, headers: { "retry-after": "120" } } }) }), /rate_limited/);
    const progress = await limitedDb.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-ohlcv-v4-progress'").first();
    assert.equal(progress.status, "running");
    assert.equal(JSON.parse(progress.checkpoint).nextEligibleAt, "2026-09-02T10:02:00.000Z");
    assert.equal((await limitedDb.prepare("SELECT count(*) AS n FROM screener_runs WHERE scope='screener-ohlcv-v4-period'").first()).n, 0);
    let calls = 0;
    const cooldown = await prepareScreenerOhlcvV4(limitedDb, { universe, sessions, universeRevision: "r4",
      validThrough: "2099-01-01T00:00:00Z", limit: 1, pauseMs: 0,
      clock: () => Date.parse("2026-09-02T10:01:59Z"), fetcher: async () => { calls++; return Response.json({}); } });
    assert.deepEqual({ state: cooldown.state, requested: cooldown.requested, reason: cooldown.reason,
      nextEligibleAt: cooldown.nextEligibleAt, calls }, { state: "pending", requested: 0, reason: "source_cooldown",
      nextEligibleAt: "2026-09-02T10:02:00.000Z", calls: 0 });
  } finally { limitedDb.close(); }
});

test("v4 retention 只刪 130 日外 OHLCV 並保留 v3 snapshot anchor", async () => {
  const db = setup();
  const insert = (value) => db.prepare("INSERT INTO screener_daily_ohlcv(symbol,data_date,market,open,high,low,close,volume_shares,volume_unit,volume_field,volume_mapping_version,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation) VALUES('1101.TW',?,'TWSE','10','11','9','10','1000','shares','成交股數','official-daily-ohlcv-v2','TWD','official-unadjusted-after-market-twd','official-daily-ohlcv-v2','https://www.twse.com.tw/x',?,'2026-09-01','canonical-complete-v2')").bind(value, "a".repeat(64)).run();
  try {
    await insert("2025-01-01"); await insert("2025-12-31"); await insert(sessions[0]);
    await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES('v3','2026-09-01','published',?,3)")
      .bind(JSON.stringify({ technicalAnchors: { sessions: ["2025-12-31"] } })).run();
    const kept = await pruneScreenerOhlcvV4(db, sessions);
    assert.ok(kept.includes("2025-12-31"));
    assert.deepEqual((await db.prepare("SELECT data_date FROM screener_daily_ohlcv ORDER BY data_date").all()).results.map((row) => row.data_date), ["2025-12-31", sessions[0]]);
  } finally { db.close(); }
});
