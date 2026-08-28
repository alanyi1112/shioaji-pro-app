import assert from "node:assert/strict";
import test from "node:test";
import {
  CANDLE_CONTINUITY_AUDIT_BATCH_LIMIT,
  planCandleContinuityAuditBatch,
  runCandleContinuityAuditBatch,
  summarizeCandleContinuityAcceptance,
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

test("正式驗收摘要只公開有界日期、continuity、cache 與核對 scope", () => {
  const summary = summarizeCandleContinuityAcceptance({
    candles: [
      { time: Date.parse("2026-07-31T01:00:00Z") / 1000, open: 1, high: 2, low: 1, close: 2, volume: 10 },
      { time: Date.parse("2026-08-03T01:00:00Z") / 1000, open: 2, high: 3, low: 2, close: 3, volume: 20 },
      { time: Date.parse("2026-08-17T01:00:00Z") / 1000, open: 3, high: 4, low: 3, close: 4, volume: 30 },
    ],
    dataWindow: { cache: { state: "hit", store: "d1", continuity: { status: "complete", missingSessionCount: 0, verifiedThrough: "2026-08-17" } } },
    quote: { verification: { status: "verified", scope: "ohlcv" } },
  }, { from: "2026-08-01", through: "2026-08-16" });
  assert.deepEqual(summary, {
    candleCount: 3,
    firstSessionDate: "2026-07-31",
    lastSessionDate: "2026-08-17",
    windowSessionDates: ["2026-08-03"],
    uniqueSessionDates: 3,
    cacheState: "hit",
    cacheStore: "d1",
    continuityStatus: "complete",
    missingSessionCount: 0,
    verifiedThrough: "2026-08-17",
    verificationStatus: "verified",
    verificationScope: "ohlcv",
  });
  assert.equal("candles" in summary, false);
  assert.equal("open" in summary, false);
});
