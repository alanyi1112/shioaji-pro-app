import { DatabaseSync } from "node:sqlite";

class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    const expected = (this.sql.match(/\?/g) || []).length;
    if (args.length !== expected) throw new Error(`D1_BIND_COUNT_MISMATCH expected=${expected} actual=${args.length}`);
    this.args = args;
    return this;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.args);
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.args) };
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.args) || null;
    return column && row ? row[column] : row;
  }
}

export class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.batchQueue = Promise.resolve();
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  batch(statements) {
    const execute = async () => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.database.exec("COMMIT");
        return results;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    };
    const result = this.batchQueue.then(execute, execute);
    this.batchQueue = result.catch(() => {});
    return result;
  }

  exec(sql) {
    this.database.exec(sql);
  }

  close() {
    this.database.close();
  }
}

export function applyDrizzleSql(db, sql) {
  for (const statement of String(sql).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
}
