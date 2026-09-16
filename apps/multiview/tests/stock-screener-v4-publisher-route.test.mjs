import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { buildOhlcvTargets, buildOhlcvV4Targets } from '../../../scripts/stock-screener-ohlcv-bootstrap.mjs';
import { publishScreenerSnapshot } from '../worker/stock-screener-repository.ts';
import { publishPreparedScreenerV3 } from '../worker/stock-screener-v3-publisher.ts';
import { publishPreparedScreenerV4 } from '../worker/stock-screener-v4-publisher.ts';
import { readScreenerV4Snapshot } from '../worker/stock-screener-v4-repository.ts';
import { handleStockScreener } from '../worker/stock-screener-route.ts';

const migrations = await Promise.all(['0027_pale_randall_flagg.sql', '0028_early_sir_ram.sql', '0029_plain_strong_guy.sql',
  '0031_screener_ohlcv_v4.sql']
  .map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const setup = () => { const db = new SqliteD1(); migrations.forEach((migration) => applyDrizzleSql(db, migration)); return db; };
const sessions = Array.from({ length: 130 }, (_, index) => new Date(Date.UTC(2026, 3, 26) + index * 86400000).toISOString().slice(0, 10));
const v3Sessions = sessions.slice(-60);
const inputs = [
  { code: '1101', symbol: '1101.TW', name: '台泥', market: 'TWSE', kind: 'ordinary', listingDate: sessions[0], currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
  { code: '5483', symbol: '5483.TWO', name: '中美晶', market: 'TPEx', kind: 'ordinary', listingDate: sessions[0], currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
  { code: '7855', symbol: '7855.TW', name: '新股', market: 'TWSE', kind: 'ordinary', listingDate: sessions.at(-2), currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
];
const metadata = { version: 2, schemaVersion: 2, formulaVersion: 'after-market-v2', sourceReview: 'verified',
  anchors: { daily: { previous: sessions.at(-2), current: sessions.at(-1) }, weekly: null, weeklyPeriods: [] },
  universeRevision: 'r4', total: inputs.length, validThrough: '2099-01-01T00:00:00Z', expectedSessionDate: sessions.at(-1) };

async function seed(db) {
  await publishScreenerSnapshot(db, metadata, inputs);
  for (const stock of inputs) for (const sessionDate of sessions) {
    if (stock.listingDate > sessionDate) continue;
    await db.prepare("INSERT INTO screener_daily_ohlcv(symbol,data_date,market,open,high,low,close,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation,volume_shares,volume_unit,volume_field,volume_mapping_version) VALUES(?,?,?,?,?,?,?,'TWD','official-unadjusted-after-market-twd','official-daily-ohlcv-v2','https://example.invalid',?,'2026-09-02T00:00:00Z','canonical-complete-v2',?,'shares','成交股數','official-daily-ohlcv-v2')")
      .bind(stock.symbol, sessionDate, stock.market, '100', '102', '98', '100', 'a'.repeat(64), '1000').run();
  }
  for (const target of buildOhlcvTargets(inputs, v3Sessions)) {
    const receipt = { version: 1, market: target.market, sessionDate: target.sessionDate, status: 'collected', complete: true,
      universeRevision: 'r4', expectedHash: target.expectedHash, universeEligible: target.universeEligible,
      valid: target.universeEligible, invalid: 0, missing: 0, payloadHash: 'b'.repeat(64) };
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-ohlcv-period','collected',?,'2026-09-02T00:00:00Z')")
      .bind(`screener-ohlcv:${target.market}:${target.sessionDate}`, JSON.stringify(receipt)).run();
  }
  const v3Progress = { version: 3, target: 120, processed: 120, remaining: 0, failed: 0, overdue: 0, cursor: null,
    markets: { TWSE: { target: 60, processed: 60, failed: 0 }, TPEx: { target: 60, processed: 60, failed: 0 } },
    sessions: v3Sessions, through: sessions.at(-1), universeRevision: 'r4' };
  await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-ohlcv-progress','screener-ohlcv-progress','complete',?,'2026-09-02T00:00:00Z')")
    .bind(JSON.stringify(v3Progress)).run();
  const v3 = await publishPreparedScreenerV3(db, new Date('2026-09-02T01:00:00Z'));
  assert.equal(v3.state, 'published');
  for (const target of buildOhlcvV4Targets(inputs, sessions)) {
    const receipt = { version: 2, dataCapability: 'ohlcv-v4', sourceMappingVersion: 'official-daily-ohlcv-v2',
      market: target.market, sessionDate: target.sessionDate, status: 'collected', complete: true,
      universeRevision: 'r4', expectedHash: target.expectedHash, universeEligible: target.universeEligible,
      valid: target.universeEligible, invalid: 0, missing: 0, payloadHash: 'c'.repeat(64), invalidSymbols: [], missingSymbols: [] };
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-ohlcv-v4-period','collected',?,'2026-09-02T00:00:00Z')")
      .bind(`screener-ohlcv-v4:${target.market}:${target.sessionDate}`, JSON.stringify(receipt)).run();
  }
  const v4Progress = { version: 4, dataCapability: 'ohlcv-v4', target: 260, processed: 260, remaining: 0, failed: 0, overdue: 0, cursor: null,
    markets: { TWSE: { target: 130, processed: 130, failed: 0 }, TPEx: { target: 130, processed: 130, failed: 0 } },
    sessions, through: sessions.at(-1), universeRevision: 'r4' };
  await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-ohlcv-v4-progress','screener-ohlcv-v4-progress','complete',?,'2026-09-02T00:00:00Z')")
    .bind(JSON.stringify(v4Progress)).run();
}

test('完整 130 日 OHLCV 與 260 receipts 才原子發布 v4，並保存 compact hash', async () => {
  const db = setup();
  try {
    await seed(db);
    const result = await publishPreparedScreenerV4(db, new Date('2026-09-02T02:00:00Z'));
    assert.equal(result.state, 'published');
    const snapshot = await readScreenerV4Snapshot(db);
    assert.equal(snapshot.inputs.length, 3);
    assert.equal(snapshot.metadata.technicalAnchors.sessions.length, 130);
    assert.equal(snapshot.metadata.sourceMappingVersion, 'official-daily-ohlcv-v2');
    assert.equal(snapshot.inputs[0].technicalV4.ma.evidence.points.length, 11);
    assert.match(snapshot.inputs[0].technicalV4.evidenceHash, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.inputs[2].technicalV4.ma.reason, 'insufficient_history');
    assert.equal((await publishPreparedScreenerV4(db)).state, 'unchanged');
    assert.equal((await db.prepare('PRAGMA integrity_check').first()).integrity_check, 'ok');
  } finally { db.close(); }
});

test('v4 GET 僅讀 immutable features，維持守恆、穩定 cursor 並拒絕惡意參數', async () => {
  const db = setup();
  try {
    await seed(db); await publishPreparedScreenerV4(db, new Date('2026-09-02T02:00:00Z'));
    const before = (await db.prepare('SELECT total_changes() AS n').first()).n;
    const query = 'version=4&volume=false&holder=false&fractal=false&bollReversal=false&ma=true&maMode=bullish-preparation&compressionDays=3&maxSpreadPct=1&divergence=false&sort=code&direction=asc&resultState=fail&limit=1';
    const first = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}`), { DB: db, DEPLOYMENT_TARGET: 'local' });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.version, 4); assert.equal(body.rows.length, 1); assert.equal(body.technicalAnchors.sessions.length, 130);
    assert.equal(body.counts.matched + body.counts.notMatched + body.counts.unknown, body.counts.total);
    assert.equal(body.rows[0].technicalV4.ma.verdict, 'fail');
    const second = await (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}&cursor=${encodeURIComponent(body.nextCursor)}`), { DB: db, DEPLOYMENT_TARGET: 'local' })).json();
    assert.equal(new Set([...body.rows, ...second.rows].map((row) => row.code)).size, 2);
    assert.equal((await db.prepare('SELECT total_changes() AS n').first()).n, before);
    const next=new Date(Date.parse(`${sessions.at(-1)}T00:00:00Z`)+86400000).toISOString().slice(0,10);
    const readiness={version:1,expectedSessionDate:next,effectiveSessionDate:sessions.at(-1),phase:'awaiting-publication',attempts:1,
      nextAttemptAt:'2026-09-03T06:20:00Z',updatedAt:'2026-09-03T06:00:00Z',markets:{
        TWSE:{status:'pending',reportDate:sessions.at(-1),hash:null,total:null,invalid:null,reason:'source_not_published',checkedAt:'2026-09-03T06:00:00Z'},
        TPEx:{status:'complete',reportDate:next,hash:'b'.repeat(64),total:700,invalid:0,reason:null,checkedAt:'2026-09-03T06:00:00Z'}}};
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-session-readiness','screener-session-readiness','awaiting-publication',?,?)")
      .bind(JSON.stringify(readiness),readiness.updatedAt).run();
    const stale=await (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}`),{DB:db,DEPLOYMENT_TARGET:'local'})).json();
    assert.equal(stale.state,'pending');assert.equal(stale.reason,'awaiting_twse');assert.equal(stale.expectedSessionDate,next);
    assert.equal(stale.effectiveSessionDate,sessions.at(-1));assert.deepEqual(stale.rows,[]);
    for (const extra of ['&maMode=evil', '&compressionDays=11', '&maxSpreadPct=5.01', '&divergenceSource=evil', '&requireZeroReset=yes', '&url=http://evil']) {
      assert.equal((await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}${extra}`), { DB: db, DEPLOYMENT_TARGET: 'local' })).status, 400);
    }
  } finally { db.close(); }
});

test('新條件全關投影 v3；任一新條件開啟但 v4 未 ready 時 rows 為空', async () => {
  const db = setup();
  try {
    await seed(db);
    const projected = await (await handleStockScreener(new Request('http://127.0.0.1/api/stock-screener/status?version=4'), { DB: db, DEPLOYMENT_TARGET: 'local' })).json();
    assert.equal(projected.version, 3);
    const pending = await (await handleStockScreener(new Request('http://127.0.0.1/api/stock-screener/results?version=4&volume=false&holder=false&ma=true&divergence=false'), { DB: db, DEPLOYMENT_TARGET: 'local' })).json();
    assert.equal(pending.version, 4); assert.equal(pending.state, 'pending'); assert.equal(pending.reason, 'v4_preparation_pending'); assert.deepEqual(pending.rows, []);
  } finally { db.close(); }
});
