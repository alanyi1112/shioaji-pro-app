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
  anchors: { daily: null, weekly: null, weeklyPeriods: [] }, universeRevision: 'r1', total: inputs.length,
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
    await assert.rejects(publishPreparedScreenerV3(db), /incomplete_ohlcv_receipts/);
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

test('v3 尚未發布時保留 preparation progress，v2 cursor 不得重解釋', async () => {
  const db = setup();
  try {
    await seedPrepared(db);
    const status = await handleStockScreener(new Request('http://127.0.0.1/api/stock-screener/status?version=3'), { DB: db, DEPLOYMENT_TARGET: 'local' });
    const body = await status.json();
    assert.equal(body.state, 'pending');
    assert.equal(body.reason, 'v3_preparation_pending');
    assert.deepEqual({ target: body.preparation.target, processed: body.preparation.processed, remaining: body.preparation.remaining }, { target: 120, processed: 120, remaining: 0 });
    const oldCursor = btoa(JSON.stringify({ id: crypto.randomUUID(), offset: 0, fingerprint: 'old' }));
    const invalid = await handleStockScreener(new Request(`http://127.0.0.1/api/stock-screener/results?version=3&cursor=${encodeURIComponent(oldCursor)}`), { DB: db, DEPLOYMENT_TARGET: 'local' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).reason, 'invalid_cursor');
  } finally { db.close(); }
});
