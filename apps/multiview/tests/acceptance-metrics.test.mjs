import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/acceptance-metrics.js", import.meta.url), "utf8");

function harness({ now = 250, heap } = {}) {
  let clockReads = 0;
  const sandbox = {
    globalThis: undefined,
    performance: {
      now: () => clockReads++ === 0 ? 0 : now,
      ...(heap === undefined ? {} : { memory: { usedJSHeapSize: heap } }),
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

test("驗收快照只公開固定去識別化 schema", () => {
  const sandbox = harness();
  sandbox.QuoteChartAcceptance.setGauge("panelCount", 8);
  sandbox.QuoteChartAcceptance.setGauge("sseOpenCount", 1);
  sandbox.QuoteChartAcceptance.setGauge("activeDemandCount", 7);
  sandbox.QuoteChartAcceptance.increment("subscribeCount", 7);
  sandbox.QuoteChartAcceptance.increment("requestCount", 12);

  const snapshot = sandbox.__MULTIVIEW_ACCEPTANCE__;
  assert.deepEqual(Object.keys(snapshot), [
    "version",
    "panelCount",
    "sseOpenCount",
    "activeDemandCount",
    "subscribeCount",
    "unsubscribeCount",
    "requestCount",
    "indicatorFullRecomputeCount",
    "renderCount",
    "longTaskCount",
    "durationMs",
    "heapStatus",
    "heapUsedBytes",
    "reasonCode",
  ]);
  assert.equal(snapshot.panelCount, 8);
  assert.equal(snapshot.activeDemandCount, 7);
  assert.equal(snapshot.heapStatus, "unsupported");
  assert.equal(snapshot.heapUsedBytes, null);
  assert.equal(Object.prototype.propertyIsEnumerable.call(sandbox, "__MULTIVIEW_ACCEPTANCE__"), false);
  assert.equal(JSON.stringify(snapshot).match(/symbol|quote|account|credential|token|secret/gi), null);
});

test("未列名欄位與敏感 reason code 均 fail closed", () => {
  const sandbox = harness({ heap: 123456 });
  assert.throws(() => sandbox.QuoteChartAcceptance.setGauge("symbol", 2330), /not_allowed/);
  assert.throws(() => sandbox.QuoteChartAcceptance.increment("account", 1), /not_allowed/);
  sandbox.QuoteChartAcceptance.setReason("2330.TW/account-token");
  const snapshot = sandbox.QuoteChartAcceptance.snapshot();
  assert.equal(snapshot.reasonCode, "invalid_reason_code");
  assert.equal(snapshot.heapStatus, "available");
  assert.equal(snapshot.heapUsedBytes, 123456);
  assert.ok(Object.isFrozen(snapshot));
});

test("計數與 duration 均有上限", () => {
  const sandbox = harness({ now: 9_000_000 });
  sandbox.QuoteChartAcceptance.increment("renderCount", Number.MAX_SAFE_INTEGER);
  const snapshot = sandbox.QuoteChartAcceptance.snapshot();
  assert.equal(snapshot.renderCount, 1_000_000_000);
  assert.equal(snapshot.durationMs, 3_600_000);
});

test("browser tool 可從隱藏 output 讀取同一份安全 schema", () => {
  const appended = [];
  const output = { hidden: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const sandbox = {
    globalThis: undefined,
    performance: { now: () => 0 },
    document: {
      createElement: () => output,
      documentElement: { appendChild(node) { appended.push(node); } },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  sandbox.QuoteChartAcceptance.setGauge("panelCount", 6);
  assert.equal(appended.length, 1);
  assert.equal(output.hidden, true);
  assert.equal(JSON.parse(output.textContent).panelCount, 6);
  assert.equal(output.attributes["data-schema-version"], "1");
});
