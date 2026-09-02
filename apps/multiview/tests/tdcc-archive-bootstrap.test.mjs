import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyDrizzleSql, SqliteD1 } from './helpers/sqlite-d1.mjs';
import {
  ensureArchiveUniverse,
  finalizeTdccArchiveRun,
  rollbackTdccArchiveReceipt,
  startTdccArchiveRun,
  tdccStoredDistributionMaterialHash,
  tdccArchiveStatus,
  TDCC_ARCHIVE_RUN_ID,
} from '../worker/tdcc-archive-bootstrap.ts';
import {
  TDCC_ARCHIVE_COMMIT,
  TDCC_ARCHIVE_MANIFEST,
  TDCC_ARCHIVE_MANIFEST_VERSION,
  TDCC_ARCHIVE_NORMALIZATION_VERSION,
  TDCC_ARCHIVE_VALIDATOR_VERSION,
} from '../../../src/lib/tdcc-archive-validator.ts';
import { ingestTdccDistributionSnapshot } from '../worker/taiwan-stock-chip-service.ts';

const migration = await readFile(new URL('../drizzle/0030_tdcc_verified_archive_bootstrap.sql', import.meta.url), 'utf8');
const levels = Array.from({ length: 15 }, (_, index) => ({ level: index + 1, range: `L${index + 1}`, holders: 1, shares: 100, ratioPercent: 6.66 }));
const adjustment = { level: 16, range: 'adjustment', holders: 0, shares: 0, ratioPercent: 0 };
const total = { level: 17, range: 'total', holders: 15, shares: 1500, ratioPercent: 100 };

function database() {
  const db = new SqliteD1();
  db.exec(`CREATE TABLE taiwan_stock_shareholder_distribution (
    symbol TEXT NOT NULL,data_date TEXT NOT NULL,levels_json TEXT NOT NULL,adjustment_json TEXT NOT NULL,total_json TEXT NOT NULL,
    provider TEXT NOT NULL,frequency TEXT NOT NULL DEFAULT 'weekly',source_fetched_at TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(symbol,data_date));
    CREATE TABLE tdcc_continuous_items (
      symbol TEXT NOT NULL,data_date TEXT NOT NULL,status TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 100,attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,lease_expires_at TEXT,next_retry_at TEXT,error_code TEXT,completed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(symbol,data_date));
    CREATE TABLE taiwan_stock_chip_fetch_state (
      symbol TEXT NOT NULL,dataset TEXT NOT NULL,coverage_start TEXT,coverage_end TEXT,source_date TEXT,status TEXT NOT NULL,reason_code TEXT,
      last_success_at TEXT,last_attempt_at TEXT,retry_after TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(symbol,dataset));
    CREATE TABLE screener_universe (
      revision TEXT NOT NULL,symbol TEXT NOT NULL,market TEXT NOT NULL,data_date TEXT NOT NULL,payload TEXT NOT NULL,
      PRIMARY KEY(revision,symbol));`);
  applyDrizzleSql(db, migration);
  return db;
}

test('固定商品宇宙沿用官方發行人市場歸屬並只由官方目錄補 ETF', async () => {
  const db = database();
  const rows = Array.from({ length: 1800 }, (_, index) => {
    const market = index < 1000 ? 'TWSE' : 'TPEx';
    const code = String(index < 1000 ? index + 1000 : index + 2000);
    const suffix = market === 'TWSE' ? 'TW' : 'TWO';
    const payload = JSON.stringify({ stock: { kind: 'ordinary', listingDate: '2000-01-01' } }).replaceAll("'", "''");
    return `('revision-1','${code}.${suffix}','${market}','2026-09-01','${payload}')`;
  });
  db.exec(`INSERT INTO screener_universe (revision,symbol,market,data_date,payload) VALUES ${rows.join(',')}`);
  const twse = Array.from({ length: 800 }, (_, index) => ({ Date: '1150901', Code: index < 100 ? `00${String(index + 50).padStart(2, '0')}` : `9${String(index).padStart(3, '0')}` }));
  const tpex = Array.from({ length: 500 }, (_, index) => ({ Date: '1150901', SecuritiesCompanyCode: index < 50 ? `006${String(index + 50).padStart(2, '0')}B` : `8${String(index).padStart(3, '0')}` }));
  const fetcher = async (url) => new Response(JSON.stringify(String(url).includes('twse') ? twse : tpex), {
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(await ensureArchiveUniverse(db, fetcher), 1950);
  const etfs = await db.prepare("SELECT symbol,exchange,quote_type FROM tdcc_archive_symbol_universe WHERE stock_code IN ('0050','00679B') ORDER BY symbol").all();
  assert.deepEqual(etfs.results.map(row => ({ ...row })), [
      { symbol: '0050.TW', exchange: 'TWSE', quote_type: 'ETF' },
      { symbol: '00679B.TWO', exchange: 'TPEx', quote_type: 'ETF' },
    ]);
  db.close();
});

async function seedPreparedRun(db, { conflict = false, semanticExisting = false } = {}) {
  const owner = 'test-owner-0001';
  await db.prepare(`INSERT INTO tdcc_archive_runs
    (run_id,manifest_version,commit_sha,validator_version,scope,status,target_periods,heartbeat_at,started_at,lease_owner,lease_expires_at)
    VALUES (?,?,?,?, 'full-market','prepared',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,datetime('now','+10 minutes'))`)
    .bind(TDCC_ARCHIVE_RUN_ID, TDCC_ARCHIVE_MANIFEST_VERSION, TDCC_ARCHIVE_COMMIT, TDCC_ARCHIVE_VALIDATOR_VERSION, TDCC_ARCHIVE_MANIFEST.length, owner).run();
  for (const [index, entry] of TDCC_ARCHIVE_MANIFEST.entries()) {
    const id = `${TDCC_ARCHIVE_MANIFEST_VERSION}:${entry.date}`;
    const symbol = `${String(index + 1).padStart(4, '0')}.TW`;
    await db.prepare(`INSERT INTO tdcc_archive_period_receipts
      (receipt_id,run_id,manifest_version,commit_sha,validator_version,normalization_version,data_date,source_url,byte_length,payload_sha256,row_count,symbol_count,staged_symbol_count,material_hash,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared')`)
      .bind(id, TDCC_ARCHIVE_RUN_ID, TDCC_ARCHIVE_MANIFEST_VERSION, TDCC_ARCHIVE_COMMIT, TDCC_ARCHIVE_VALIDATOR_VERSION, TDCC_ARCHIVE_NORMALIZATION_VERSION, entry.date, entry.url, entry.bytes, entry.sha256, 17, 1, 1, `period-${index}`).run();
    await db.prepare(`INSERT INTO tdcc_archive_staging
      (receipt_id,data_date,symbol,levels_json,adjustment_json,total_json,material_hash,source_fetched_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id, entry.date, symbol, JSON.stringify(levels), JSON.stringify(adjustment), JSON.stringify(total), `row-${index}`, '2026-09-02T00:00:00.000Z').run();
    await db.prepare("INSERT INTO tdcc_continuous_items (symbol,data_date,status) VALUES (?,?,'queued')").bind(symbol, entry.date).run();
    if (conflict && index === 0) {
      await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
        (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
        VALUES (?,?,?,?,'{"different":true}','tdcc','weekly','2026-09-01T00:00:00.000Z')`)
        .bind(symbol, entry.date, JSON.stringify(levels), JSON.stringify(adjustment)).run();
    } else if (semanticExisting && index === 0) {
      await db.prepare("UPDATE tdcc_archive_staging SET material_hash=? WHERE receipt_id=?")
        .bind(await tdccStoredDistributionMaterialHash(JSON.stringify(levels), JSON.stringify(total)), id).run();
      const officialLabels = levels.map(item => ({ ...item, range: `official-${item.level}` }));
      await db.prepare(`INSERT INTO taiwan_stock_shareholder_distribution
        (symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at)
        VALUES (?,?,?,?,?,'tdcc','weekly','2026-09-01T00:00:00.000Z')`)
        .bind(symbol, entry.date, JSON.stringify(officialLabels), JSON.stringify({ ...adjustment, range: '官方差異', holders: 99 }), JSON.stringify({ ...total, range: '官方合計' })).run();
    }
  }
  return owner;
}

test('18 期 staging 通過後才 period-atomic insert-only finalize，receipt/provenance/ledger 守恆', async () => {
  const db = database();
  const owner = await seedPreparedRun(db);
  await assert.rejects(finalizeTdccArchiveRun(db, 'competing-owner-0002'), /archive_lease_conflict/);
  const result = await finalizeTdccArchiveRun(db, owner);
  assert.equal(result.target, 18);
  assert.equal(result.processed, 18);
  assert.equal(result.remaining, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.complete, true);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM taiwan_stock_shareholder_distribution').first('count'), 18);
  const resumed = await startTdccArchiveRun(db, 'restart-owner-0003');
  assert.equal(resumed.complete, true);
  assert.equal(resumed.remaining, 0);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM tdcc_distribution_row_provenance WHERE transport='verified-archive' AND validation_status='verified'").first('count'), 18);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM tdcc_continuous_items WHERE status='completed'").first('count'), 18);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM tdcc_archive_staging').first('count'), 0);

  const rollback = await rollbackTdccArchiveReceipt(db, `${TDCC_ARCHIVE_MANIFEST_VERSION}:${TDCC_ARCHIVE_MANIFEST[0].date}`, true);
  assert.deepEqual(rollback, { dryRun: true, receiptId: `${TDCC_ARCHIVE_MANIFEST_VERSION}:${TDCC_ARCHIVE_MANIFEST[0].date}`, rowCount: 1 });
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM taiwan_stock_shareholder_distribution').first('count'), 18);
  db.close();
});

test('manifest 任一期尚未 prepared 時不開始正式寫入', async () => {
  const db = database();
  const owner = await seedPreparedRun(db);
  await db.prepare('DELETE FROM tdcc_archive_period_receipts WHERE data_date=?').bind(TDCC_ARCHIVE_MANIFEST.at(-1).date).run();
  await assert.rejects(finalizeTdccArchiveRun(db, owner), /archive_manifest_not_prepared/);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM taiwan_stock_shareholder_distribution').first('count'), 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM tdcc_distribution_row_provenance').first('count'), 0);
  db.close();
});

test('既有官方列只有級距文案或 adjustment 表示差異時視為 canonical matched-existing', async () => {
  const db = database();
  const owner = await seedPreparedRun(db, { semanticExisting: true });
  const result = await finalizeTdccArchiveRun(db, owner);
  assert.equal(result.complete, true);
  assert.equal(await db.prepare("SELECT matched_rows FROM tdcc_archive_period_receipts WHERE data_date=?").bind(TDCC_ARCHIVE_MANIFEST[0].date).first('matched_rows'), 1);
  assert.match(await db.prepare("SELECT levels_json FROM taiwan_stock_shareholder_distribution WHERE data_date=?").bind(TDCC_ARCHIVE_MANIFEST[0].date).first('levels_json'), /official-1/);
  db.close();
});

test('既有官方 material 不同時整期阻擋且不覆蓋最後 verified row', async () => {
  const db = database();
  const owner = await seedPreparedRun(db, { conflict: true });
  await assert.rejects(finalizeTdccArchiveRun(db, owner), /archive_source_mismatch/);
  const status = await tdccArchiveStatus(db);
  assert.equal(status.status, 'blocked');
  assert.equal(status.failed, 1);
  assert.equal(await db.prepare("SELECT total_json FROM taiwan_stock_shareholder_distribution WHERE data_date=?").bind(TDCC_ARCHIVE_MANIFEST[0].date).first('total_json'), '{"different":true}');
  assert.equal(await db.prepare("SELECT status FROM tdcc_archive_period_receipts WHERE data_date=?").bind(TDCC_ARCHIVE_MANIFEST[0].date).first('status'), 'source-mismatch');
  db.close();
});

function officialPayload(date, changed = false) {
  const compact = date.replaceAll('-', '');
  const rows = Array.from({ length: 15 }, (_, index) => ({
    '\uFEFF資料日期': compact,
    證券代號: '0001',
    持股分級: String(index + 1),
    人數: '1',
    股數: String(100 + (changed && index === 0 ? 1 : 0)),
    占集保庫存數比例: '6.66',
  }));
  rows.push({ '\uFEFF資料日期': compact, 證券代號: '0001', 持股分級: '16', 人數: '0', 股數: '0', 占集保庫存數比例: '0.10' });
  rows.push({ '\uFEFF資料日期': compact, 證券代號: '0001', 持股分級: '17', 人數: '15', 股數: changed ? '1501' : '1500', 占集保庫存數比例: '100.00' });
  return rows;
}

test('官方後續資料 canonical 相同只提升確認，不同則保留 archive row 並隔離衝突', async () => {
  const db = database();
  const owner = await seedPreparedRun(db);
  await finalizeTdccArchiveRun(db, owner);
  const date = TDCC_ARCHIVE_MANIFEST[0].date;
  const before = await db.prepare("SELECT levels_json,total_json FROM taiwan_stock_shareholder_distribution WHERE symbol='0001.TW' AND data_date=?").bind(date).first();

  await ingestTdccDistributionSnapshot({
    env: { DB: db },
    payload: officialPayload(date),
    eligibleSymbols: new Set(['0001.TW']),
    fetchedAt: '2026-09-02T01:00:00.000Z',
    transport: 'official-openapi',
  });
  const confirmed = await db.prepare("SELECT transport,validation_status,official_confirmed_at FROM tdcc_distribution_row_provenance WHERE symbol='0001.TW' AND data_date=?").bind(date).first();
  assert.equal(confirmed.transport, 'verified-archive');
  assert.equal(confirmed.validation_status, 'official-confirmed');
  assert.ok(confirmed.official_confirmed_at);
  assert.deepEqual(await db.prepare("SELECT levels_json,total_json FROM taiwan_stock_shareholder_distribution WHERE symbol='0001.TW' AND data_date=?").bind(date).first(), before);

  await ingestTdccDistributionSnapshot({
    env: { DB: db },
    payload: officialPayload(date, true),
    eligibleSymbols: new Set(['0001.TW']),
    fetchedAt: '2026-09-02T02:00:00.000Z',
    transport: 'official-openapi',
  });
  assert.equal(await db.prepare("SELECT validation_status FROM tdcc_distribution_row_provenance WHERE symbol='0001.TW' AND data_date=?").bind(date).first('validation_status'), 'source-mismatch');
  assert.equal(await db.prepare("SELECT status || ':' || error_code AS value FROM tdcc_continuous_items WHERE symbol='0001.TW' AND data_date=?").bind(date).first('value'), 'queued:source_mismatch');
  assert.deepEqual(await db.prepare("SELECT levels_json,total_json FROM taiwan_stock_shareholder_distribution WHERE symbol='0001.TW' AND data_date=?").bind(date).first(), before);
  db.close();
});
