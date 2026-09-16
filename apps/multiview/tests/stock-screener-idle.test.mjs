import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteD1 } from './helpers/sqlite-d1.mjs';
import { screenerIdleGate } from '../../../scripts/screener-idle-gate.mjs';

async function setup() {
  const db = new SqliteD1();
  for (const sql of [
    'CREATE TABLE screener_chip_publication_head(name TEXT,effective_session_date TEXT,universe_revision TEXT,status TEXT)',
    'CREATE TABLE screener_runs(id TEXT,status TEXT,checkpoint TEXT)',
    'CREATE TABLE screener_universe(revision TEXT,data_date TEXT)',
    "INSERT INTO screener_chip_publication_head VALUES('v5','2026-09-18','r','published')",
    "INSERT INTO screener_universe VALUES('r','2026-09-18')",
  ]) await db.prepare(sql).run();
  await db.prepare("INSERT INTO screener_runs VALUES('screener-period-evidence','verified',?)").bind(JSON.stringify({
    sessions: ['2026-09-18', '2026-09-21'], validThrough: '2026-09-21T06:00:00Z',
  })).run();
  await db.prepare("INSERT INTO screener_runs VALUES('screener-history-progress','complete',?)")
    .bind(JSON.stringify({ remaining: 0, failed: 0, overdue: 0 })).run();
  return db;
}

test('完成後跨週末休眠至日曆下一交易日14:00，零寫入', async () => {
  const db = await setup();
  try {
    const before = (await db.prepare('SELECT total_changes() AS n').first()).n;
    assert.equal((await screenerIdleGate(db, new Date('2026-09-19T12:00:00Z'))).nextAttemptAt, '2026-09-21T06:00:00.000Z');
    assert.ok(await screenerIdleGate(db, new Date('2026-09-21T05:59:59Z')));
    assert.equal(await screenerIdleGate(db, new Date('2026-09-21T06:00:00Z')), null);
    assert.equal((await db.prepare('SELECT total_changes() AS n').first()).n, before);
  } finally { db.close(); }
});

test('名冊變更、週資料缺口或日曆失效不誤判完成', async () => {
  for (const sql of [
    "UPDATE screener_universe SET revision='new'",
    "UPDATE screener_runs SET checkpoint='{\"remaining\":1,\"failed\":0,\"overdue\":0}' WHERE id='screener-history-progress'",
    "UPDATE screener_runs SET checkpoint='{}' WHERE id='screener-period-evidence'",
    "UPDATE screener_chip_publication_head SET status='pending'",
  ]) {
    const db = await setup();
    try {
      await db.prepare(sql).run();
      assert.equal(await screenerIdleGate(db, new Date('2026-09-19T12:00:00Z')), null);
    } finally { db.close(); }
  }
});
