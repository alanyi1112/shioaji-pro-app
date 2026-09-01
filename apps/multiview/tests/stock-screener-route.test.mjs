import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SqliteD1, applyDrizzleSql } from "./helpers/sqlite-d1.mjs";
import { handleStockScreener } from "../worker/stock-screener-route.ts";
import { publishScreenerSnapshot, readScreenerSnapshot } from "../worker/stock-screener-repository.ts";

const migrations = await Promise.all(["0027_pale_randall_flagg.sql","0028_early_sir_ram.sql"].map(name=>readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")));
const pair = { current: "2026-08-28", previous: "2026-08-27" };
const provenance = { source: "TWSE", sourceUrl: "https://example.invalid", fetchedAt: "2026-08-31T10:00:00Z", payloadHash: "fixture", normalizationVersion: "1" };
const metadata = { version: 2, schemaVersion: 2, formulaVersion: "after-market-v2", sourceReview: "verified", anchors: { daily: pair, weekly: null, weeklyPeriods: [] }, universeRevision: "fixture", total: 105, validThrough: "2026-09-01T10:00:00Z" };
const inputs = Array.from({ length: 105 }, (_, index) => {
  const code = String(1000 + index);
  const point = { date: pair.current, shares: "3000", unit: "shares", basis: "fixture", market: "TWSE", provenance };
  return { code, symbol: `${code}.TW`, name: `測試 ${code}`, market: "TWSE", kind: "ordinary", currentVolume: point, previousVolume: { ...point, date: pair.previous, shares: "1000" }, currentHolder: null, previousHolder: null };
});
function holderPoint(ratio,date) {
  const scaled=Math.round(Number(ratio)*100);
  return {date,provenance,bands:Array.from({length:17},(_,i)=>{const level=i+1;return {level,
    shares:String(level===1?10000-scaled:level===15?scaled:level===17?10000:0),
    holders:String(level===1||level===15?1:level===17?2:0),
    ratio:level===15?ratio:level===1?((10000-scaled)/100).toFixed(2):level===17?'100.00':'0.00'};})};
}
const url = "http://127.0.0.1:5174/api/stock-screener/results?holder=false";
const call = (db, input = url) => handleStockScreener(new Request(input), { DB: db, DEPLOYMENT_TARGET: "local" }, new Date("2026-08-31T12:00:00Z"));
async function database() { const db = new SqliteD1(); for (const migration of migrations) applyDrizzleSql(db, migration); return db; }

test("staging schema、FK、索引、交易回滾與只保留兩版", async () => {
  const db = await database();
  try {
    const first = await publishScreenerSnapshot(db, metadata, inputs, new Date("2026-08-31T01:00:00Z"));
    assert.equal((await db.prepare("SELECT schema_version FROM screener_snapshots WHERE id=?").bind(first).first()).schema_version,2);
    const second = await publishScreenerSnapshot(db, metadata, inputs, new Date("2026-08-31T02:00:00Z"));
    const third = await publishScreenerSnapshot(db, metadata, inputs, new Date("2026-08-31T03:00:00Z"));
    assert.equal(await readScreenerSnapshot(db, first), null);
    assert.ok(await readScreenerSnapshot(db, second));
    assert.equal((await readScreenerSnapshot(db)).id, third);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshot_rows").first()).n, 210);
    assert.equal((await db.prepare("PRAGMA integrity_check").first()).integrity_check, "ok");
    assert.match(JSON.stringify(await db.prepare("EXPLAIN QUERY PLAN SELECT id FROM screener_snapshots WHERE status = 'published' ORDER BY created_at DESC LIMIT 1").all()), /screener_snapshots_published_idx/);
    await assert.rejects(db.batch([db.prepare("DELETE FROM screener_snapshot_rows WHERE snapshot_id = ?").bind(second), db.prepare("INSERT INTO missing_table VALUES (1)") ]));
    assert.equal((await readScreenerSnapshot(db, second)).inputs.length, 105);
  } finally { db.close(); }
});
test("稀疏／舊期更新不得覆蓋已驗證版本，GET 沒有 provider 或 DDL", async () => {
  const db = await database();
  try {
    await publishScreenerSnapshot(db, metadata, inputs);
    await assert.rejects(publishScreenerSnapshot(db, metadata, inputs.map((row, i) => i === 0 ? { ...row, previousVolume: null } : row)), /snapshot_sparse_regression/);
    await assert.rejects(publishScreenerSnapshot(db, { ...metadata, anchors: { daily: null, weekly: null, weeklyPeriods: [] } }, inputs), /snapshot_regression/);
    const before = (await db.prepare("SELECT total_changes() AS n").first()).n;
    const saved = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("provider must not be called"); };
    try { for (let i = 0; i < 3; i++) assert.equal((await call(db)).status, 200); }
    finally { globalThis.fetch = saved; }
    assert.equal((await db.prepare("SELECT total_changes() AS n").first()).n, before);
  } finally { db.close(); }
});
test("105 筆穩定分頁、快照條件綁定、未知原因與停用條件獨立就緒", async () => {
  const db = await database();
  try {
    await publishScreenerSnapshot(db, metadata, inputs);
    const first = await (await call(db)).json();
    assert.equal(first.state, "ready");
    assert.equal(first.counts.matched, 105);
    assert.equal(first.universeRevision, 'fixture');
    assert.equal(first.formulaVersion, 'after-market-v2');
    assert.equal(typeof first.criteriaFingerprint, 'string');
    const second = await (await call(db, `${url}&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    const third = await (await call(db, `${url}&cursor=${encodeURIComponent(second.nextCursor)}`)).json();
    const codes = [...first.rows, ...second.rows, ...third.rows].map((row) => row.code);
    assert.equal(new Set(codes).size, 105);
    assert.equal(third.nextCursor, null);
    assert.equal((await call(db, `${url}&sort=holderChange&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
    const unknown = await (await call(db, url.replace("holder=false", "resultState=unknown"))).json();
    assert.equal(unknown.counts.unknown, 105);
    assert.equal(unknown.rows[0].holder.reason, "history_pending");
    await db.prepare("DELETE FROM screener_snapshots WHERE id = ?").bind(first.snapshotId).run();
    assert.equal((await call(db, `${url}&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 409);
  } finally { db.close(); }
});
test("schema pending、離線、hosted 與未知 API schema fail closed", async () => {
  const db = new SqliteD1();
  try {
    assert.equal((await (await call(db)).json()).reason, "schema_pending");
    assert.equal((await call(undefined)).status, 503);
    assert.equal((await handleStockScreener(new Request(url), { DB: db, DEPLOYMENT_TARGET: "cloudflare" })).status, 404);
    assert.equal((await handleStockScreener(new Request(url, { method: "POST" }), { DB: db, DEPLOYMENT_TARGET: "local" })).status, 405);
    for (const extra of ["&version=1", "&limit=101", "&volumeThreshold=3.001", "&holderStreakWeeks=5", "&volumeTurnoverMinimumWan=-1", "&limit=0", "&volume=false", "&sort=unknown", "&url=http://evil", "&mode=all&mode=any"]) assert.equal((await call(db, url + extra)).status, 400);
  } finally { db.close(); }
});

test('v2 成交值、四週反轉證據與排序使用精確 snapshot，不重解釋 v1',async()=>{
  const db=await database();
  try {
    const weeks=['2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-08-28'];
    const row={...inputs[0],currentVolume:{...inputs[0].currentVolume,turnoverNtd:'12345600',turnoverCurrency:'TWD',turnoverField:'TradeValue',turnoverBasis:'fixture',turnoverMappingVersion:'official-daily-trade-value-v1'},
      holderSeries:['60.00','59.99','59.98','59.97','59.96','60.16'].map((ratio,i)=>holderPoint(ratio,weeks[i])),
      previousHolder:holderPoint('59.96',weeks[4]),currentHolder:holderPoint('60.16',weeks[5])};
    const row2={...inputs[1],currentVolume:{...row.currentVolume,turnoverNtd:'12345601'},previousVolume:inputs[1].previousVolume,
      holderSeries:row.holderSeries,previousHolder:row.previousHolder,currentHolder:row.currentHolder};
    await publishScreenerSnapshot(db,{...metadata,total:2,anchors:{daily:pair,weekly:{previous:weeks[4],current:weeks[5]},weeklyPeriods:weeks}},[row,row2]);
    const holderUrl=`${url.replace('holder=false','volume=false&holder=true')}&holderMode=decrease-to-increase&holderStreakWeeks=4&holderThreshold=0.2&holderTurnover=true&holderTurnoverMinimumWan=1234.56&sort=holderChange`;
    const result=await (await call(db,holderUrl)).json();
    assert.equal(result.version,2); assert.equal(result.formulaVersion,'after-market-v2'); assert.equal(result.counts.matched,2);
    assert.equal(result.rows[0].holder.streakWeeks,4); assert.equal(result.rows[0].holder.series.length,6);
    assert.equal(result.rows[0].holder.changePp,0.2); assert.equal(result.rows[0].holder.turnover.wan,'1234.56');
    assert.equal((await call(db,holderUrl.replace('1234.56','1234.57'))).status,200);
    assert.equal((await (await call(db,holderUrl.replace('1234.56','1234.57'))).json()).counts.notMatched,2);
    const turnover=await (await call(db,holderUrl.replace('sort=holderChange','sort=turnover&direction=desc'))).json();
    assert.deepEqual(turnover.rows.map(item=>item.code),['1001','1000']);
    const streak=await (await call(db,holderUrl.replace('sort=holderChange','sort=holderStreak&direction=desc'))).json();
    assert.deepEqual(streak.rows.map(item=>item.code),['1000','1001']);
  } finally {db.close();}
});

test('v2 route 對最新 v1 snapshot 回 version pending，不用新條件重算',async()=>{
  const db=await database();
  try {
    await db.prepare("INSERT INTO screener_snapshots(id,created_at,status,metadata,schema_version) VALUES('legacy','2026-08-31T00:00:00Z','published',?,1)").bind(JSON.stringify({...metadata,total:1,version:1,schemaVersion:undefined,formulaVersion:undefined})).run();
    await db.prepare("INSERT INTO screener_snapshot_rows(snapshot_id,symbol,payload) VALUES('legacy',?,?)").bind(inputs[0].symbol,JSON.stringify(inputs[0])).run();
    const result=await (await call(db)).json(); assert.equal(result.version,2); assert.equal(result.reason,'snapshot_version_pending');
  } finally {db.close();}
});

test("精確分數排序不使用浮點顯示值；未知永遠置底且代碼穩定排序", async () => {
  const db = await database();
  try {
    const rows = inputs.slice(0,3).map((row, index) => ({ ...row,
      currentVolume: index === 2 ? null : { ...row.currentVolume, shares: index === 0 ? "9007199254740992" : "9007199254740993" },
      previousVolume: { ...row.previousVolume, shares: "1" },
    }));
    await publishScreenerSnapshot(db, { ...metadata, total: 3 }, rows);
    const sorted = await (await call(db, `${url}&sort=volumeMultiple&direction=desc`)).json();
    assert.deepEqual(sorted.rows.map(row=>row.code), ["1001","1000"]);
    const unknown = await (await call(db, url.replace("holder=false", "resultState=unknown") + "&sort=volumeMultiple&direction=desc")).json();
    assert.deepEqual(unknown.rows.map(row=>row.code), ["1001","1000","1002"]);
    const code = await (await call(db, `${url}&sort=code&direction=desc`)).json();
    assert.deepEqual(code.rows.map(row=>row.code), ["1001","1000"]);
  } finally { db.close(); }
});

test("翻頁跨同日修訂固定原快照，第三版淘汰後409，不混入新版或漏列", async () => {
  const db = await database();
  try {
    const firstId = await publishScreenerSnapshot(db, metadata, inputs);
    const first = await (await call(db)).json();
    await publishScreenerSnapshot(db, metadata, inputs.map(row=>({ ...row, name: `修訂${row.name}` })));
    const second = await (await call(db, `${url}&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    assert.equal(second.snapshotId, firstId);
    assert.ok(second.rows.every(row=>!row.name.startsWith("修訂")));
    for (const changed of ["&volumeThreshold=4", "&direction=desc", "&limit=25", "&resultState=fail"]) assert.equal((await call(db, `${url}${changed}&cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400);
    await publishScreenerSnapshot(db, metadata, inputs);
    assert.equal((await call(db, `${url}&cursor=${encodeURIComponent(second.nextCursor)}`)).status, 409);
    const noQuotes = { DB: db, DEPLOYMENT_TARGET: "local" };
    const stale = await (await handleStockScreener(new Request(url), noQuotes, new Date("2026-09-02T00:00:00Z"))).json();
    assert.equal(stale.state,"stale");
  } finally { db.close(); }
});

test("併行快照發布只有一個CAS成功，不遺留staging或破壞保留版本", async () => {
  const db = await database();
  try {
    await publishScreenerSnapshot(db, metadata, inputs);
    const results = await Promise.allSettled([publishScreenerSnapshot(db, metadata, inputs), publishScreenerSnapshot(db, metadata, inputs)]);
    assert.equal(results.filter(result=>result.status === "fulfilled").length, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshots WHERE status='staging'").first()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshots WHERE status='published'").first()).n, 2);
  } finally { db.close(); }
});

test('官方下一交易日可發布已解釋缺期，不混用舊日期；同一期稀疏修訂仍拒絕',async()=>{
  const db=await database();
  try {
    const old=await publishScreenerSnapshot(db,metadata,inputs);
    const nextPair={current:'2026-08-31',previous:'2026-08-28'};
    const next=inputs.map((row,i)=>({...row,currentVolume:i?{...row.currentVolume,date:nextPair.current}:null,previousVolume:row.currentVolume}));
    await publishScreenerSnapshot(db,{...metadata,anchors:{daily:nextPair,weekly:null,weeklyPeriods:[]}},next);
    const result=await (await call(db)).json();
    assert.equal(result.state,'partial');assert.equal(result.counts.unknown,1);
    assert.equal((await readScreenerSnapshot(db,old)).inputs[0].currentVolume.date,pair.current);
    assert.equal((await readScreenerSnapshot(db)).inputs[0].currentVolume,null);
  } finally {db.close();}
});
test('預期日已完成但來源只到較早共同日，不可將保留快照標為最新',async()=>{
  const db=await database();
  try {
    await publishScreenerSnapshot(db,{...metadata,expectedSessionDate:'2026-08-31'},inputs);
    const result=await (await call(db)).json();
    assert.equal(result.state,'pending');assert.equal(result.reason,'source_not_published');
    assert.equal(result.anchors.daily.current,'2026-08-28');
  }finally{db.close();}
});
