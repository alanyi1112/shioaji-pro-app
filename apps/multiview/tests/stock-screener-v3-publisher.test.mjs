import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SqliteD1, applyDrizzleSql } from './helpers/sqlite-d1.mjs';
import { buildOhlcvTargets } from '../../../scripts/stock-screener-ohlcv-bootstrap.mjs';
import { publishScreenerSnapshot } from '../worker/stock-screener-repository.ts';
import { publishPreparedScreenerV3 } from '../worker/stock-screener-v3-publisher.ts';
import { readScreenerV3Snapshot } from '../worker/stock-screener-v3-repository.ts';
import { handleStockScreener } from '../worker/stock-screener-route.ts';

const migrations = await Promise.all(['0027_pale_randall_flagg.sql', '0028_early_sir_ram.sql', '0029_plain_strong_guy.sql']
  .map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const setup = () => { const db = new SqliteD1(); migrations.forEach((migration) => applyDrizzleSql(db, migration)); return db; };
const sessions = Array.from({ length: 60 }, (_, index) => new Date(Date.UTC(2026, 5, 1) + index * 86400000).toISOString().slice(0, 10));
const inputs = [
  { code: '1101', symbol: '1101.TW', name: '台泥', market: 'TWSE', kind: 'ordinary', listingDate: sessions[0], currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
  { code: '5483', symbol: '5483.TWO', name: '中美晶', market: 'TPEx', kind: 'ordinary', listingDate: sessions[0], currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
  { code: '4768', symbol: '4768.TWO', name: '晶呈科技', market: 'TPEx', kind: 'ordinary', listingDate: sessions.at(-2), currentVolume: null, previousVolume: null, currentHolder: null, previousHolder: null },
];
const metadata = { version: 2, schemaVersion: 2, formulaVersion: 'after-market-v2', sourceReview: 'verified',
  anchors: { daily: { previous: sessions.at(-2), current: sessions.at(-1) }, weekly: null, weeklyPeriods: [] }, universeRevision: 'r1', total: inputs.length,
  validThrough: '2099-01-01T00:00:00Z', expectedSessionDate: sessions.at(-1) };

async function seedPrepared(db) {
  const baseId = await publishScreenerSnapshot(db, metadata, inputs);
  for (const stock of inputs) for (let index = 0; index < sessions.length; index++) {
    if (stock.listingDate > sessions[index]) continue;
    let open = '10', high = '11', low = '9', close = '10';
    if (stock.code === '1101' && index === 57) { open = '10'; high = '12'; low = '10'; close = '12'; }
    if (stock.code === '1101' && index === 58) { open = '8'; high = '11'; low = '8'; close = '11'; }
    if (stock.code === '1101' && index === 59) { open = '9'; high = '13'; low = '9'; close = '13'; }
    await db.prepare("INSERT INTO screener_daily_ohlcv(symbol,data_date,market,open,high,low,close,currency,price_basis,mapping_version,source_url,payload_hash,fetched_at,validation) VALUES(?,?,?,?,?,?,?,'TWD','official-unadjusted-after-market-twd','official-daily-ohlcv-v1','https://www.twse.com.tw/fixture',?,'2026-09-01T00:00:00Z','canonical-complete-v1')")
      .bind(stock.symbol, sessions[index], stock.market, open, high, low, close, 'a'.repeat(64)).run();
  }
  const targets = buildOhlcvTargets(inputs, sessions);
  for (const target of targets) {
    const receipt = { version: 1, market: target.market, sessionDate: target.sessionDate, status: 'collected', complete: true,
      universeRevision: 'r1', expectedHash: target.expectedHash, universeEligible: target.universeEligible,
      valid: target.universeEligible, invalid: 0, missing: 0, payloadHash: 'b'.repeat(64) };
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'screener-ohlcv-period','collected',?,'2026-09-01T00:00:00Z')")
      .bind(`screener-ohlcv:${target.market}:${target.sessionDate}`, JSON.stringify(receipt)).run();
  }
  const progress = { version: 3, target: 120, processed: 120, remaining: 0, failed: 0, overdue: 0, cursor: null,
    markets: { TWSE: { target: 60, processed: 60, failed: 0 }, TPEx: { target: 60, processed: 60, failed: 0 } },
    sessions, through: sessions.at(-1), universeRevision: 'r1' };
  await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-ohlcv-progress','screener-ohlcv-progress','complete',?,'2026-09-01T00:00:00Z')")
    .bind(JSON.stringify(progress)).run();
  return baseId;
}

test('全市場 receipts 與 row 守恆後原子發布 v3；新股不足期保存 row-level unknown', async () => {
  const db = setup();
  try {
    const baseId = await seedPrepared(db);
    const result = await publishPreparedScreenerV3(db, new Date('2026-09-01T01:00:00Z'));
    assert.equal(result.state, 'published');
    const snapshot = await readScreenerV3Snapshot(db);
    assert.equal(snapshot.metadata.baseSnapshotId, baseId);
    assert.equal(snapshot.inputs.length, 3);
    assert.equal(snapshot.inputs.find((row) => row.code === '1101').technical.rawBottom.verdict, 'pass');
    const newStock = snapshot.inputs.find((row) => row.code === '4768');
    assert.equal(newStock.technical.rawBottom.reason, 'insufficient_history');
    assert.equal(newStock.technical.lowerBullish.reason, 'insufficient_history');
    assert.match(newStock.technical.evidenceHash, /^[a-f0-9]{64}$/);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshots WHERE schema_version=2").first()).n, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshots WHERE schema_version=3 AND status='published'").first()).n, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshot_rows WHERE snapshot_id=?").bind(result.snapshotId).first()).n, 3);
    assert.equal((await publishPreparedScreenerV3(db)).state, 'unchanged');
    assert.equal((await db.prepare('PRAGMA integrity_check').first()).integrity_check, 'ok');
  } finally { db.close(); }
});

test('部分市場 receipt、staging row 缺漏與 CAS 競爭不得發布 complete v3', async () => {
  const db = setup();
  try {
    await seedPrepared(db);
    await db.prepare("UPDATE screener_runs SET status='failed',checkpoint=? WHERE id=?")
      .bind(JSON.stringify({ version: 1, market: 'TPEx', sessionDate: sessions.at(-1), status: 'failed', complete: false,
        universeRevision: 'r1', expectedHash: buildOhlcvTargets(inputs, sessions).at(-1).expectedHash, universeEligible: 1 }), `screener-ohlcv:TPEx:${sessions.at(-1)}`).run();
    assert.partialDeepStrictEqual(await publishPreparedScreenerV3(db), { state: 'pending', reason: 'universe_coverage_pending' });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshots WHERE schema_version=3").first()).n, 0);
  } finally { db.close(); }
});

test('v2 與 v3 各自保留兩版，v2 publisher 不會誤刪 v3', async () => {
  const db = setup();
  try {
    await seedPrepared(db);
    await publishPreparedScreenerV3(db, new Date('2026-09-01T01:00:00Z'));
    for (let index = 0; index < 3; index++) {
      await publishScreenerSnapshot(db, metadata, inputs, new Date(`2026-09-01T0${index + 2}:00:00Z`));
      assert.equal((await publishPreparedScreenerV3(db, new Date(`2026-09-01T0${index + 5}:00:00Z`))).state, 'published');
    }
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshots WHERE schema_version=2 AND status='published'").first()).n, 2);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM screener_snapshots WHERE schema_version=3 AND status='published'").first()).n, 2);
  } finally { db.close(); }
});

test('v3 GET 固定 snapshot／criteria，回傳分型證據、unknown 與穩定 cursor，且不寫 D1', async () => {
  const db = setup();
  try {
    await seedPrepared(db);
    await publishPreparedScreenerV3(db, new Date('2026-09-01T01:00:00Z'));
    const before = (await db.prepare('SELECT total_changes() AS n').first()).n;
    const query = 'version=3&volume=false&holder=false&fractal=true&fractalAlgorithm=raw-three&fractalDirection=bottom&bollReversal=false&sort=confirmationDate&direction=desc&resultState=pass&limit=1';
    const res = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${query}`), { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2026-09-01T01:01:00Z'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.version, 3);
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].code, '1101');
    assert.equal(body.rows[0].technical.fractal.verdict, 'pass');
    assert.equal(body.rows[0].technical.fractal.evidence.centerDate, sessions.at(-2));
    assert.equal(body.rows[0].technical.fractal.evidence.confirmationDate, sessions.at(-1));
    assert.equal(body.technicalAnchors.sessions.length, 60);
    assert.equal(body.counts.matched + body.counts.notMatched + body.counts.unknown, body.counts.total);
    assert.equal((await db.prepare('SELECT total_changes() AS n').first()).n, before);

    const unknownRes = await handleStockScreener(new Request(`http://localhost/api/stock-screener/results?${query.replace('resultState=pass', 'resultState=unknown')}`), { DB: db, DEPLOYMENT_TARGET: 'local' });
    const unknown = await unknownRes.json();
    assert.equal(unknown.rows[0].code, '4768');
    assert.equal(unknown.rows[0].technical.fractal.reason, 'insufficient_history');
  } finally { db.close(); }
});

test('v3 尚未發布時，非技術 status 投影最新 v2；v2 cursor 不得重解釋', async () => {
  const db = setup();
  try {
    await seedPrepared(db);
    const status = await handleStockScreener(new Request('http://127.0.0.1/api/stock-screener/status?version=3'), { DB: db, DEPLOYMENT_TARGET: 'local' });
    const body = await status.json();
    assert.equal(body.state, 'partial');
    assert.equal(body.reason, 'none');
    assert.equal(body.snapshotId !== null, true);
    assert.equal(body.technicalAnchors, null);
    const oldCursor = btoa(JSON.stringify({ id: crypto.randomUUID(), offset: 0, fingerprint: 'old' }));
    const invalid = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?version=3&cursor=${encodeURIComponent(oldCursor)}`), { DB: db, DEPLOYMENT_TARGET: 'local' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).reason, 'invalid_cursor');
  } finally { db.close(); }
});

test('mixed-session 拒絕發布；純量查詢改投影最新 v2，技術查詢等待當期 v3', async () => {
  const db = setup();
  try {
    await seedPrepared(db);
    assert.equal((await publishPreparedScreenerV3(db)).state, 'published');
    const next = new Date(Date.parse(`${sessions.at(-1)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await publishScreenerSnapshot(db, { ...metadata,
      anchors: { ...metadata.anchors, daily: { previous: sessions.at(-1), current: next } },
      expectedSessionDate: next }, inputs, new Date('2026-09-02T01:00:00Z'));
    assert.partialDeepStrictEqual(await publishPreparedScreenerV3(db), { state: 'pending', reason: 'mixed_session_dates' });

    const baseQuery = 'version=3&volume=true&holder=false&fractal=false&bollReversal=false&resultState=unknown&sort=code&direction=asc&limit=10';
    const base = await (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${baseQuery}`),
      { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2026-09-02T01:01:00Z'))).json();
    assert.equal(base.expectedSessionDate, next);
    assert.equal(base.technicalAnchors, null);
    assert.equal(base.rows.length, 3);

    const technical = await (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${baseQuery.replace('fractal=false', 'fractal=true')}`),
      { DB: db, DEPLOYMENT_TARGET: 'local' }, new Date('2026-09-02T01:01:00Z'))).json();
    assert.equal(technical.state, 'pending');
    assert.equal(technical.reason, 'mixed_session_dates');
    assert.deepEqual(technical.rows, []);
    const readiness={version:1,expectedSessionDate:next,effectiveSessionDate:sessions.at(-1),phase:'awaiting-publication',attempts:1,
      nextAttemptAt:'2026-09-02T02:00:00Z',updatedAt:'2026-09-02T01:00:00Z',markets:{
        TWSE:{status:'complete',reportDate:next,hash:'a'.repeat(64),total:1000,invalid:0,reason:null,checkedAt:'2026-09-02T01:00:00Z'},
        TPEx:{status:'pending',reportDate:sessions.at(-1),hash:null,total:null,invalid:null,reason:'source_not_published',checkedAt:'2026-09-02T01:00:00Z'}}};
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES('screener-session-readiness','screener-session-readiness','awaiting-publication',?,?)")
      .bind(JSON.stringify(readiness),readiness.updatedAt).run();
    const waiting=await (await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?${baseQuery.replace('fractal=false','fractal=true')}`),
      {DB:db,DEPLOYMENT_TARGET:'local'},new Date('2026-09-02T01:02:00Z'))).json();
    assert.equal(waiting.reason,'awaiting_tpex');
    assert.equal(waiting.sessionReadiness.markets.TWSE.status,'complete');
    assert.deepEqual(waiting.rows,[]);
  } finally { db.close(); }
});


test('OHLC 升級 v2 後分型及布林仍可判定且不重新下載', async () => {
  const db = setup();
  try {
    await seedPrepared(db);
    const first = await publishPreparedScreenerV3(db);
    assert.equal(first.state, 'published');
    await db.prepare("UPDATE screener_daily_ohlcv SET validation='canonical-complete-v2',mapping_version='official-daily-ohlcv-v2'").run();
    // 模擬舊讀取契約快照；base 與來源收據均未變。
    const old = await readScreenerV3Snapshot(db);
    old.metadata.receiptsHash = '0'.repeat(64);
    await db.prepare('UPDATE screener_snapshots SET metadata=? WHERE id=?').bind(JSON.stringify(old.metadata), old.id).run();
    const repaired = await publishPreparedScreenerV3(db);
    assert.equal(repaired.state, 'published');
    const snapshot = await readScreenerV3Snapshot(db);
    const row = snapshot.inputs.find(row => row.code === '1101');
    assert.equal(row.technical.rawBottom.verdict, 'pass');
    assert.notEqual(row.technical.lowerBullish.verdict, 'unknown');
    assert.equal((await publishPreparedScreenerV3(db)).state, 'unchanged');
  } finally { db.close(); }
});
