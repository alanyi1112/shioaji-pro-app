import assert from "node:assert/strict";
import test from "node:test";
import { ensureCandleContinuityColumns } from "../worker/candle-continuity-schema.ts";

function schemaDb(initialColumns) {
  const columns = new Set(initialColumns);
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        async all() { return { results: [...columns].map((name) => ({ name })) }; },
        async run() {
          statements.push(sql);
          const match = sql.match(/ADD COLUMN\s+(\w+)/i);
          if (match) columns.add(match[1]);
          return { success: true };
        },
      };
    },
  };
}

test("既有本機 candle_history_state 缺欄位時補齊並只在升級當次撤銷舊 full flag", async () => {
  const db = schemaDb(["provider", "symbol", "interval", "full_window_complete"]);
  const first = await ensureCandleContinuityColumns(db);
  assert.equal(first.upgraded, true);
  assert.equal(db.statements.filter((sql) => /ALTER TABLE/i.test(sql)).length, 8);
  assert.match(db.statements.at(-1), /full_window_complete=0/);
  assert.match(db.statements.at(-1), /continuity_unverified/);

  db.statements.length = 0;
  const second = await ensureCandleContinuityColumns(db);
  assert.equal(second.upgraded, false);
  assert.deepEqual(db.statements, []);
});
