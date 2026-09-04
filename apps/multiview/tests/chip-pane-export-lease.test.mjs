import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const chipSource = await readFile(new URL("../public/static/chip-panes.js", import.meta.url), "utf8");
const window = { QuoteChartInteractions: {} };
vm.runInNewContext(chipSource, { window, structuredClone, URLSearchParams, Intl, DOMException, Map, Set });
const { createChipPaneExportLease } = window.QuoteChartChipPanes.__test;

function controllerHarness(id, { mounted = false, intersecting = mounted, ready = true } = {}) {
  let chartMounted = mounted;
  let viewportVisible = intersecting;
  let exportReady = ready;
  const pins = new Set();
  const syncCalls = [];
  return {
    id,
    pinForExport(token) {
      pins.add(token);
      chartMounted = true;
    },
    releaseExportPin(token) {
      pins.delete(token);
      if (!pins.size && !viewportVisible) chartMounted = false;
    },
    isMounted() { return chartMounted; },
    setIntersecting(value) {
      viewportVisible = Boolean(value);
      if (viewportVisible) chartMounted = true;
      else if (!pins.size) chartMounted = false;
    },
    setReady(value) { exportReady = Boolean(value); },
    synchronizeExport(state) { syncCalls.push(structuredClone(state)); },
    exportReadiness() {
      return {
        paneId: id,
        mounted: chartMounted,
        canvasCount: chartMounted ? 2 : 0,
        canvasReady: chartMounted && exportReady,
        materialExpected: true,
        selectedSeriesCount: 1,
        renderedSeriesCount: chartMounted && exportReady ? 1 : 0,
        ready: chartMounted && exportReady,
      };
    },
    report() { return { mounted: chartMounted, pinCount: pins.size, syncCalls }; },
  };
}

function deterministicFrames() {
  let clock = 0;
  return {
    now() { return clock; },
    requestFrame(callback) {
      clock += 8;
      queueMicrotask(callback);
      return clock;
    },
  };
}

test("匯出租約掛載離屏 pane、鎖住 observer 卸載並在完成後精確還原", async () => {
  const visible = controllerHarness("institutional-total-flow", { mounted: true, intersecting: true });
  const offscreen = controllerHarness("big-holder", { mounted: false, intersecting: false });
  const otherPanel = controllerHarness("other-panel-pane", { mounted: true, intersecting: true });
  const frames = deterministicFrames();
  let identity = "2330.TW|1d|payload-a";

  const lease = await createChipPaneExportLease({
    controllers: [visible, offscreen],
    expectedIdentity: identity,
    currentIdentity: () => identity,
    range: { from: 10, to: 50 },
    crosshairTime: "2026-09-03",
    axisSafeWidth: 68,
    timeoutMs: 40,
    ...frames,
  });

  assert.deepEqual([...lease.beforeMountedPaneIds], ["institutional-total-flow"]);
  assert.deepEqual([...lease.expectedPaneIds], ["institutional-total-flow", "big-holder"]);
  assert.equal(visible.report().mounted, true);
  assert.equal(offscreen.report().mounted, true);
  assert.equal(otherPanel.report().pinCount, 0);
  assert.equal(lease.readyReport.every((item) => item.ready), true);
  assert.deepEqual(offscreen.report().syncCalls.at(-1), {
    range: { from: 10, to: 50 },
    crosshairTime: "2026-09-03",
    axisSafeWidth: 68,
  });

  offscreen.setIntersecting(false);
  assert.equal(offscreen.report().mounted, true, "export pin 應阻止 observer 在擷取前卸載");
  lease.release();
  lease.release();

  assert.equal(visible.report().mounted, true);
  assert.equal(offscreen.report().mounted, false);
  assert.equal(offscreen.report().pinCount, 0);
  assert.equal(otherPanel.report().mounted, true);
});

test("readiness timeout 與 identity 改變都會釋放暫時掛載且回報缺少 pane", async () => {
  const neverReady = controllerHarness("retail-holder", { mounted: false, intersecting: false, ready: false });
  const timeoutFrames = deterministicFrames();
  await assert.rejects(
    createChipPaneExportLease({
      controllers: [neverReady],
      expectedIdentity: "2454.TW|1d|payload-a",
      currentIdentity: () => "2454.TW|1d|payload-a",
      timeoutMs: 16,
      ...timeoutFrames,
    }),
    /retail-holder/,
  );
  assert.equal(neverReady.report().mounted, false);
  assert.equal(neverReady.report().pinCount, 0);

  const identityPane = controllerHarness("margin", { mounted: false, intersecting: false });
  const identityFrames = deterministicFrames();
  let identity = "2449.TW|1d|payload-a";
  await assert.rejects(
    createChipPaneExportLease({
      controllers: [identityPane],
      expectedIdentity: identity,
      currentIdentity: () => `${identity}-changed`,
      timeoutMs: 40,
      ...identityFrames,
    }),
    /商品或資料狀態已變更/,
  );
  assert.equal(identityPane.report().mounted, false);
});

test("AbortSignal 取消準備時不留下 export pin", async () => {
  const pane = controllerHarness("short", { mounted: false, intersecting: false, ready: false });
  const controller = new AbortController();
  const frames = deterministicFrames();
  controller.abort();
  await assert.rejects(
    createChipPaneExportLease({
      controllers: [pane],
      expectedIdentity: "2454.TW|1d|payload-a",
      currentIdentity: () => "2454.TW|1d|payload-a",
      signal: controller.signal,
      timeoutMs: 40,
      ...frames,
    }),
    { name: "AbortError" },
  );
  assert.equal(pane.report().pinCount, 0);
  assert.equal(pane.report().mounted, false);
});
