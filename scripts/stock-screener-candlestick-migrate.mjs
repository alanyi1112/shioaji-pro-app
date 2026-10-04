/** 只套用 additive 0040；先備份真實本機 SQLite，不更動既有 head/profile 或服務。 */
import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
const args = process.argv.slice(2);
if (args.length !== 2 || !args[0].startsWith('--database=') || !args[1].startsWith('--backup=')) throw new Error('需要明確 --database= 與 --backup= 絕對路徑');
const file = args[0].slice(11), destination = args[1].slice(9);
if (!isAbsolute(file) || !isAbsolute(destination) || !existsSync(file) || existsSync(destination) || file === destination) throw new Error('invalid_migration_paths');
const db = new DatabaseSync(file, { timeout: 5000 });
try {
  if (db.prepare('SELECT name FROM d1_migrations WHERE name=?').get('0040_screener_candlestick_publication.sql')) {
    console.log(JSON.stringify({ state: 'unchanged' }));
  } else {
    if (!db.prepare('SELECT name FROM d1_migrations WHERE name=?').get('0039_broker_bandwidth_reservations.sql')
      || db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'screener_candlestick_%'").get()) throw new Error('migration_precondition_failed');
    await backup(db, destination); chmodSync(destination, 0o600);
    const check = new DatabaseSync(destination, { readOnly: true });
    try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('backup_integrity_failed'); }
    finally { check.close(); }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(resolve(import.meta.dirname, '../apps/multiview/drizzle/0040_screener_candlestick_publication.sql'), 'utf8'));
      db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run('0040_screener_candlestick_publication.sql');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    console.log(JSON.stringify({ state: 'migrated', migration: '0040_screener_candlestick_publication.sql', backup: destination,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check }));
  }
} finally { db.close(); }
