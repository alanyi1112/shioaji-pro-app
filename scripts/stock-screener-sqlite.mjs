/** Operator-only SQLite adapter. SQL writes are restricted to the seven additive tables. */
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, realpathSync } from 'node:fs';

const TABLES = new Set(['screener_universe', 'screener_daily_volume', 'screener_daily_ohlcv', 'screener_tdcc_weekly', 'screener_runs', 'screener_snapshots', 'screener_snapshot_rows']);
class Statement {
    constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
    bind(...args) { this.args = args; return this; }
    async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
    async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
    async run() { return this.db.prepare(this.sql).run(...this.args); }
}
export class ScreenerSqlite {
    constructor(file) {
        if (!file.startsWith('/') || lstatSync(file).isSymbolicLink() || realpathSync(file) !== file) throw new Error('invalid_database_path');
        this.database = new DatabaseSync(file, { timeout: 5000 });
        this.database.exec('PRAGMA foreign_keys=ON');
        this.queue = Promise.resolve();
        const names = new Set(this.database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
        if ([...TABLES].some(table => !names.has(table))) { this.database.close(); throw new Error('schema_pending'); }
    }
    prepare(sql) {
        const write = sql.match(/^(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/i);
        if (sql.includes(';') || (!/^SELECT\s/i.test(sql) && (!write || !TABLES.has(write[1])))) throw new Error('screener_sql_scope_denied');
        return new Statement(this.database, sql);
    }
    batch(statements) {
        const run = async () => {
            this.database.exec('BEGIN IMMEDIATE');
            try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec('COMMIT'); return results; }
            catch (error) { this.database.exec('ROLLBACK'); throw error; }
        };
        const result = this.queue.then(run, run); this.queue = result.catch(() => {}); return result;
    }
    close() { this.database.close(); }
}
