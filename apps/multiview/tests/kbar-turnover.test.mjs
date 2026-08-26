import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/kbar-turnover.js", import.meta.url), "utf8");
const sandbox = { globalThis: undefined, Number };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const api = sandbox.QuoteChartKbarTurnover;

test("成交值只接受canonical非負safe integer元值", () => {
  for (const [value, expected] of [
    [0, 0],
    [93_550_000, 93_550_000],
    ["93550000", 93_550_000],
    ["93550000.00", 93_550_000],
    [-1, null],
    [1.1, null],
    [" 1", null],
    ["1e3", null],
    [Number.MAX_SAFE_INTEGER + 1, null],
    [undefined, null],
  ]) assert.equal(api.parseTurnoverTwd(value), expected);
});

test("成交值加總在缺值與safe integer溢位時fail unavailable", () => {
  assert.equal(api.addTurnoverTwd(1_000_000, 2_000_000), 3_000_000);
  assert.equal(api.addTurnoverTwd("1000000", "2000000.00"), 3_000_000);
  assert.equal(api.addTurnoverTwd(null, 2_000_000), null);
  assert.equal(api.addTurnoverTwd(Number.MAX_SAFE_INTEGER, 1), null);
});

test("萬元格式涵蓋一般值、零、小額與unavailable", () => {
  assert.deepEqual({ ...api.formatTurnoverWan(93_550_000) }, { value: "9,355萬", accessibleName: "成交值 9,355萬元" });
  assert.deepEqual({ ...api.formatTurnoverWan(935_500) }, { value: "93.6萬", accessibleName: "成交值 93.6萬元" });
  assert.deepEqual({ ...api.formatTurnoverWan(999) }, { value: "<0.1萬", accessibleName: "成交值小於 0.1萬元" });
  assert.deepEqual({ ...api.formatTurnoverWan(0) }, { value: "0萬", accessibleName: "成交值 0萬元" });
  assert.deepEqual({ ...api.formatTurnoverWan("0.0") }, { value: "0萬", accessibleName: "成交值 0萬元" });
  assert.deepEqual({ ...api.formatTurnoverWan(null) }, { value: "—", accessibleName: "成交值 —" });
});

test("精確成交值claim必須綁定current schema revision", () => {
  assert.equal(api.hasCurrentExactTurnover({ turnoverTwd: 1, turnoverSchemaRevision: api.TURNOVER_SCHEMA_REVISION }), true);
  assert.equal(api.hasCurrentExactTurnover({ turnoverTwd: 1, turnoverSchemaRevision: "multiview-kbar-turnover/0" }), false);
  assert.equal(api.hasCurrentExactTurnover({ turnoverTwd: null, turnoverSchemaRevision: api.TURNOVER_SCHEMA_REVISION }), false);
});
