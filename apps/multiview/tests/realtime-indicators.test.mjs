import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { computeIndicators } from "../worker/indicators.ts";

const source = await readFile(new URL("../public/static/realtime-indicators.js", import.meta.url), "utf8");
const sandbox = { globalThis: undefined, Object, Number, Math };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const api = sandbox.QuoteChartRealtimeIndicators;

const rows = Array.from({ length: 140 }, (_, index) => ({
  time: 1_700_000_000 + index * 86_400,
  open: 100 + index * 0.2,
  high: 102 + index * 0.2,
  low: 99 + index * 0.2,
  close: 101 + index * 0.2 + Math.sin(index / 3),
  volume: 1_000 + index * 17,
}));

test("即時 full-state 重算與 Worker 固定公式一致", () => {
  const browser = api.compute(rows, {}, { volumeAvailable: true });
  const worker = computeIndicators(rows);
  for (const path of [
    ["moving_average", "ma120"], ["bollinger", "upper"], ["kd", "k"], ["macd", "histogram"],
    ["rsi", "short"], ["rsi", "long"], ["atr"], ["volume_moving_average", "ma20"],
  ]) {
    const read = (root) => path.reduce((value, key) => value[key], root);
    assert.deepEqual(JSON.parse(JSON.stringify(read(browser))), JSON.parse(JSON.stringify(read(worker))), path.join("."));
  }
});

test("IND 無成交量時不產生 volume 與 Volume MA", () => {
  const result = api.compute(rows, {}, { volumeAvailable: false });
  assert.deepEqual(Array.from(result.volume), []);
  assert.deepEqual(Array.from(result.volume_moving_average.ma20), []);
  assert.ok(result.moving_average.ma20.length > 0);
});

test("latest-wins scheduler 僅交付最後 generation", () => {
  const timers = new Map(); let nextId = 0; const delivered = [];
  const scheduler = api.createLatestWinsScheduler({
    setTimeoutImpl(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeoutImpl(id) { timers.delete(id); },
  });
  scheduler.request("old", rows.slice(0, 20), {}, {}, (_, key) => delivered.push(key));
  scheduler.request("new", rows, {}, {}, (_, key) => delivered.push(key));
  for (const callback of timers.values()) callback();
  assert.deepEqual(delivered, ["new"]);
});
