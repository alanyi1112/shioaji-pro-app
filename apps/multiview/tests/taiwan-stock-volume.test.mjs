import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  hasCurrentTaiwanStockVolumeContract,
  normalizeTaiwanStockCandleRows,
  normalizeTaiwanStockVolume,
  taiwanStockVolumeContract,
} from "../worker/taiwan-stock-volume.ts";

const fixture = JSON.parse(await readFile(new URL("../../../test-fixtures/chart-day-volume-parity.json", import.meta.url), "utf8"));
const browserContractSource = await readFile(new URL("../public/static/chart-volume-contract.js", import.meta.url), "utf8");
const chartPayloadSource = await readFile(new URL("../public/static/chart-payload.js", import.meta.url), "utf8");
const realtimeChartsSource = await readFile(new URL("../public/static/realtime-charts.js", import.meta.url), "utf8");
const realtimeIndicatorsSource = await readFile(new URL("../public/static/realtime-indicators.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const coordinatorSource = await readFile(new URL("../public/static/realtime-coordinator.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("../public/static/index.html", import.meta.url), "utf8");
const sandbox = { globalThis: undefined, JSON, Number, Set, Map, Object, Intl, Date };
sandbox.globalThis = sandbox;
vm.runInNewContext(browserContractSource, sandbox);
vm.runInNewContext(chartPayloadSource, sandbox);
vm.runInNewContext(realtimeChartsSource, sandbox);
vm.runInNewContext(realtimeIndicatorsSource, sandbox);

function candle(datetime, volume) {
  return { time: Date.parse(`${datetime}+08:00`) / 1000, open: 100, high: 102, low: 99, close: 101, volume };
}

test("共享 fixture 的 Shioaji lot identity 與 Yahoo／TWSE share-to-lot 保留小數張", () => {
  for (const row of fixture.volumeNormalization) {
    assert.equal(normalizeTaiwanStockVolume(row.sourceValue, row.provider), row.expectedCommonLot);
  }
  assert.throws(() => normalizeTaiwanStockVolume(1, "unknown-provider"), /provider_unknown/);
  assert.throws(() => normalizeTaiwanStockVolume(-1, "yahoo-chart"), /volume_invalid/);
});

test("Shioaji Kbars volume 採 identity", () => {
  const sourceRows = [candle("2026-08-20T09:00:00", 12_345)];
  const shioaji = normalizeTaiwanStockCandleRows(sourceRows, "shioaji-kbars");
  assert.equal(shioaji.rows[0].volume, 12_345);
  assert.equal(shioaji.contract.sourceVolumeUnit, "common_lot");
});

test("current contract 接受單一可信 provider，拒絕舊 schema、偽造 unit 與 replay fingerprint", () => {
  const current = taiwanStockVolumeContract("yahoo-chart");
  assert.equal(hasCurrentTaiwanStockVolumeContract(current), true);
  assert.equal(hasCurrentTaiwanStockVolumeContract({ ...current, normalizationRevision: "taiwan-stock-common-lot/0" }), false);
  assert.equal(hasCurrentTaiwanStockVolumeContract({ ...current, sourceVolumeUnit: "common_lot" }), false);
  assert.equal(hasCurrentTaiwanStockVolumeContract({ ...current, sourceFingerprint: taiwanStockVolumeContract("shioaji").sourceFingerprint }), false);
  assert.equal(hasCurrentTaiwanStockVolumeContract({ ...current, provider: "unknown-provider" }), false);
});

test("browser payload gate 接受 current common_lot，拒絕舊 schema、偽造與缺少 metadata", () => {
  const contract = sandbox.QuoteChartVolumeContract.contractForProvider("yahoo-chart");
  const payload = {
    symbol: "2330.TW",
    candles: [{ time: 1, open: 10, high: 12, low: 9, close: 11, volume: 12.345 }],
    indicators: { volume: [{ time: 1, value: 12.345 }] },
    volumeContract: contract,
  };
  assert.equal(sandbox.QuoteChartPayload.preparePayload(payload).candles[0].volume, 12.345);
  for (const invalid of [
    { ...payload, volumeContract: undefined },
    { ...payload, volumeContract: { ...contract, normalizationRevision: "taiwan-stock-common-lot/0" } },
    { ...payload, volumeContract: { ...contract, sourceVolumeUnit: "common_lot" } },
    { ...payload, volumeContract: { ...contract, sourceFingerprint: "replayed" } },
  ]) {
    assert.throws(() => sandbox.QuoteChartPayload.preparePayload(invalid), (error) => error.code === "invalid-chart-payload");
  }
});

test("Shioaji Kbars 日聚合、Tick cursor、indicators 與 payload gate 共用同一 common_lot", () => {
  const points = fixture.shioajiDailyAggregation.candles.map((row) => ({
    ...row,
    time: Date.parse(`${row.datetime}+08:00`) / 1000,
    sourceTime: Date.parse(`${row.datetime}+08:00`),
    continuity: "complete",
  }));
  const accumulator = sandbox.QuoteChartRealtimeCharts.createDailyKlineAccumulator({ identity: "2330.TW|1d|9" });
  accumulator.bootstrap(points);
  const latest = accumulator.snapshot().candles.at(-1);
  const snapshot = {
    canonicalSymbol: "2330.TW", securityType: "STK", sessionDate: latest.sessionDate,
    sourceTime: "2026-08-21T09:01:01+08:00", receivedTime: "2026-08-21T09:01:01.1+08:00",
    open: 106, high: 109, low: 105, close: 108, averagePrice: 107,
    tickVolume: 2, totalVolume: 6, sequence: 2, provider: "shioaji", continuity: "complete",
  };
  assert.equal(accumulator.append(snapshot), true);
  const candles = Array.from(accumulator.snapshot().candles, (row) => ({ ...row }));
  const indicators = sandbox.QuoteChartRealtimeIndicators.compute(candles);
  const volumeContract = sandbox.QuoteChartVolumeContract.contractForProvider("shioaji");
  const prepared = sandbox.QuoteChartPayload.preparePayload({ symbol: "2330.TW", candles, indicators, volumeContract });
  assert.equal(prepared.candles.at(-1).volume, 6);
  assert.equal(prepared.indicators.volume.at(-1).value, 6);
  assert.equal(prepared.volumeContract.canonicalVolumeUnit, "common_lot");
});

test("production wiring 使用有界日 Kbars、generation guard、強制模式 fail-closed 與完整 fallback payload", () => {
  assert.match(coordinatorSource, /"1d": 365/);
  assert.match(coordinatorSource, /size > 100_000/);
  assert.match(coordinatorSource, /kbarInflight\.has\(key\)/);
  assert.match(appSource, /streamLoadToken !== loadToken/);
  assert.match(appSource, /createDailyKlineAccumulator\(\{ identity: `\$\{symbol\}\|1d\|\$\{streamLoadToken\}` \}\)/);
  assert.match(appSource, /state\.sourceMode === "shioaji"[\s\S]*?shioajiOnlyDisplay/);
  assert.match(appSource, /const fallbackPayload = \{\s*\.\.\.canonicalPayload,[\s\S]*?candles: \(canonicalPayload\.candles \|\| \[\]\)\.map/s);
  assert.match(appSource, /applyPayload\(fallbackPayload\)/);
  assert.match(appSource, /status\.classList\.toggle\("is-visible", shioajiOnlyDisplay\);\s*if \(shioajiOnlyDisplay && latestRealtimeSnapshot\) \{\s*applyRealtimeState\(\{ state: realtimeDisplayState \}\);/s);
  assert.match(appSource, /applyPayload\(payload, \{ preserveVisibleLogicalRange, oldCandleCount \}\);\s*if \(realtimeDisplayState === "live"\) \{\s*status\.textContent = `\$\{symbolSelect\.value\} \/ 日 已載入 Shioaji`;\s*status\.classList\.remove\("is-visible"\);\s*\} else if \(realtimeDisplayState === "degraded"\) \{\s*status\.textContent = "即時連線不穩，顯示最後可用行情";\s*status\.classList\.add\("is-visible"\);/s);
  assert.match(appSource, /if \(!latestRealtimeSnapshot && lastPayload\?\.quote\?\.realtimeState === "closed"\) \{\s*status\.classList\.remove\("is-visible"\);\s*return;/s);
  assert.ok(indexHtml.indexOf("chart-volume-contract.js") < indexHtml.indexOf("chart-payload.js"));
});
