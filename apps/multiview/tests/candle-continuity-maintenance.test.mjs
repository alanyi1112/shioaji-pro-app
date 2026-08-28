import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDLE_CONTINUITY_AUDIT_BATCH_LIMIT,
  planCandleContinuityAuditBatch,
  runCandleContinuityAuditBatch,
} from "../worker/candle-continuity-maintenance.ts";

test("批次稽核只接受啟用台股、去重、排序並限制每輪八檔", () => {
  const planned = planCandleContinuityAuditBatch([
    "3008.tw", "2330.TW", "3008.TW", "AAPL", "8069.TWO", "", ...Array.from({ length: 10 }, (_, index) => `${4000 + index}.TW`),
  ]);
  assert.equal(planned.symbols.length, CANDLE_CONTINUITY_AUDIT_BATCH_LIMIT);
  assert.deepEqual(planned.symbols.slice(0, 3), ["2330.TW", "3008.TW", "4000.TW"]);
  assert.ok(planned.nextCursor);
  assert.ok(planned.remaining > 0);
});

test("cursor 可續跑且不重複前一批 symbol", () => {
  const values = ["2330.TW", "3008.TW", "4000.TW", "8069.TWO"];
  const first = planCandleContinuityAuditBatch(values, { limit: 2 });
  const second = planCandleContinuityAuditBatch(values, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(first.symbols, ["2330.TW", "3008.TW"]);
  assert.deepEqual(second.symbols, ["4000.TW", "8069.TWO"]);
  assert.equal(second.nextCursor, null);
});

test("多商品部分成功與 rate limit 不會遮蔽其他商品結果", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await runCandleContinuityAuditBatch(["2330.TW", "3008.TW", "8069.TWO"], async (symbol) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (symbol === "3008.TW") throw new Error("rate_limited");
    return {
      status: symbol === "2330.TW" ? "complete" : "partial",
      missingSessionCount: symbol === "2330.TW" ? 0 : 1,
      verifiedThrough: "2026-08-28",
      checkedAt: "2026-08-28T08:00:00.000Z",
      reasonCode: null,
    };
  });
  assert.ok(maxActive <= 2);
  assert.deepEqual(results.map((item) => [item.symbol, item.status, item.reasonCode]), [
    ["2330.TW", "complete", null],
    ["3008.TW", "failed", "rate_limited"],
    ["8069.TWO", "partial", null],
  ]);
});
