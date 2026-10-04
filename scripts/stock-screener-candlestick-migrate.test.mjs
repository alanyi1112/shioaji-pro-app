import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = join(import.meta.dirname, 'stock-screener-candlestick-migrate.mjs');
test('additive 0040：先備份、保留原值、idempotent、不覆寫備份', () => {
  const dir = mkdtempSync(join(tmpdir(), 'candlestick-migration-')), file = join(dir, 'test.sqlite'), backup = join(dir, 'before.sqlite');
  try {
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE d1_migrations(name text); INSERT INTO d1_migrations VALUES('0039_broker_bandwidth_reservations.sql'); CREATE TABLE old_head(value text); INSERT INTO old_head VALUES('original');"); db.close();
    const run = target => spawnSync(process.execPath, [script, `--database=${file}`, `--backup=${target}`], { encoding: 'utf8' });
    assert.equal(run(backup).status, 0); assert(existsSync(backup)); assert.equal(statSync(backup).mode & 0o777, 0o600);
    const b = new DatabaseSync(backup, { readOnly: true }), after = new DatabaseSync(file, { readOnly: true });
    assert.equal(b.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(b.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'screener_candlestick_%'").get().n, 0);
    assert.equal(after.prepare('SELECT value FROM old_head').get().value, 'original');
    assert.equal(after.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'screener_candlestick_%'").get().n, 5);
    b.close(); after.close();
    assert.notEqual(run(backup).status, 0); const unused = join(dir, 'unused.sqlite');
    assert.equal(run(unused).status, 0); assert(!existsSync(unused));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
