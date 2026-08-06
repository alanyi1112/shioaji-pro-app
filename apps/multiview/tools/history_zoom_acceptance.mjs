import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

async function setChartCount(page, count) {
  await page.evaluate((nextCount) => {
    const select = document.querySelector("#chart-count");
    select.value = String(nextCount);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, count);
  await page.waitForTimeout(750);
}

async function waitForLoadedPanel(page) {
  await page.waitForFunction(() => {
    const panel = window.__quoteChartDebug?.panelViewState?.()?.[0];
    const alignment = window.__quoteChartDebug?.measurePaneAlignment?.()?.[0];
    const range = panel?.visibleLogicalRange;
    return Number(panel?.candleCount || 0) > 0
      && Number.isFinite(Number(range?.from))
      && Number.isFinite(Number(range?.to))
      && Boolean(alignment?.pass && alignment?.rightGapPass);
  }, { timeout: 20000 });
}

async function wheelMainChart(page, deltaY, turns = 8) {
  const surface = page.locator(".chart-panel:not(.is-focus-hidden) .chart-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("chart surface is not visible");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.42);
  for (let index = 0; index < turns; index += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(60);
  }
}

async function firstPanelReport(page) {
  return page.evaluate(() => window.__quoteChartDebug?.measurePaneAlignment?.()?.[0] || {});
}

async function firstPanelViewState(page) {
  return page.evaluate(() => window.__quoteChartDebug?.panelViewState?.()?.[0] || {});
}

function nearlyEqual(left, right, tolerance = 0.05) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function shiftedLogicalRangeNearlyEqual(before, after, shift, tolerance = 0.1) {
  return nearlyEqual(Number(before?.from) + shift, Number(after?.from), tolerance)
    && nearlyEqual(Number(before?.to) + shift, Number(after?.to), tolerance);
}

function pointSeries(candles, offset = 0) {
  return candles.map((row) => ({ time: row.time, value: row.close + offset }));
}

function mockCandlePayload(url) {
  const displayCount = Math.max(1, Math.min(Number(url.searchParams.get("display_count") || 160), 1600));
  const symbol = url.searchParams.get("symbol") || "SAMPLE";
  const interval = url.searchParams.get("interval") || "1d";
  const end = 1731628800;
  const candles = Array.from({ length: displayCount }, (_, index) => {
    const close = 100 + index * 0.1 + Math.sin(index / 8);
    return { time: end - (displayCount - 1 - index) * 86400, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1000 + index };
  });
  const points = pointSeries(candles);
  return {
    symbol,
    interval,
    candles,
    quoteTime: candles.at(-1)?.time,
    quote: { kind: "session-close", sessionDate: "2026-07-18", sourceProvider: "acceptance-fixture", sourceQuoteTime: candles.at(-1)?.time, sourceTimeZone: "Asia/Taipei", marketSession: "closed", marketPhase: "closed", freshness: "fresh", verification: { status: "unverified", provider: null, reason: "provider_not_configured" }, dataQuality: { ignoredSessionDates: [] } },
    dataQuality: { ignoredSessionDates: [] },
    marketSession: "closed",
    indicators: {
      volume: candles.map((row) => ({ time: row.time, value: row.volume, color: "#dc2626" })),
      moving_average: { ma5: points, ma10: points, ma20: points, ma60: points, ma120: points },
      bollinger: { upper: pointSeries(candles, 2), middle: points, lower: pointSeries(candles, -2) },
      rsi: candles.map((row) => ({ time: row.time, value: 50 })),
      kd: { k: candles.map((row) => ({ time: row.time, value: 55 })), d: candles.map((row) => ({ time: row.time, value: 45 })) },
      macd: { line: points, signal: points, histogram: candles.map((row) => ({ time: row.time, value: 0 })) },
      atr: candles.map((row) => ({ time: row.time, value: 1 })),
      fvg: [], volume_profile: [], poc: null, vah: null, val: null,
    },
    dataWindow: { rawCandles: displayCount + 120, displayCandles: displayCount, requestedDisplayCandles: displayCount, hasMoreBefore: displayCount < 1600, warmupCandles: 120, availableWarmupCandles: 120, insufficientWarmup: false, warmupStatus: "sufficient", displayFrom: candles[0]?.time, displayTo: candles.at(-1)?.time, cache: { store: "d1", state: displayCount > 160 ? "hit" : "backfilled", source: "acceptance-fixture", historyStore: "candle_history", persistent: true, rows: displayCount + 120 } },
  };
}

export async function installMockCandleRoutes(page) {
  await page.route("**/api/candles**", async (route) => {
    const url = new URL(route.request().url());
    if (Number(url.searchParams.get("display_count") || 160) > 160) await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockCandlePayload(url)) });
  });
  await page.route("**/api/stream**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "data: {\"type\":\"status\",\"message\":\"acceptance fixture\"}\n\n" });
  });
}

export async function runHistoryZoomAcceptance(page) {
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await setChartCount(page, 1);
  await waitForLoadedPanel(page);
  const before = await firstPanelReport(page);
  let zoomedBefore = await firstPanelViewState(page);
  let zoomedAfter = zoomedBefore;

  for (const deltaY of [900, -900]) {
    await wheelMainChart(page, deltaY);
    zoomedBefore = await firstPanelViewState(page);
    try {
      await page.waitForFunction((initialCount) => Number(window.__quoteChartDebug?.panelViewState?.()?.[0]?.candleCount || 0) > initialCount, before.candleCount, { timeout: 5000 });
      zoomedAfter = await firstPanelViewState(page);
      break;
    } catch {
      // Wheel direction differs across platforms; try the opposite direction.
    }
  }

  await page.waitForFunction(() => {
    const alignment = window.__quoteChartDebug?.measurePaneAlignment?.()?.[0];
    return Boolean(alignment?.pass && alignment?.rightGapPass);
  }, { timeout: 5000 });
  const after = await firstPanelReport(page);
  const beforeCount = Number(before.candleCount || 0);
  const afterCount = Number(after.candleCount || 0);
  const addedCandles = afterCount - beforeCount;
  const trackedAddedCandles = Number(zoomedAfter.candleCount || 0) - Number(zoomedBefore.candleCount || 0);
  const providerBoundary = Boolean(after.dataWindow?.hasMoreBefore === false && afterCount === beforeCount);
  const preserved = addedCandles > 0 && shiftedLogicalRangeNearlyEqual(zoomedBefore.visibleLogicalRange, zoomedAfter.visibleLogicalRange, trackedAddedCandles, 0.2) && nearlyEqual(Number(zoomedBefore.barSpacing), Number(zoomedAfter.barSpacing), 0.1);
  const errors = after.errors || [];
  return {
    before: { candleCount: beforeCount, visibleLogicalRange: zoomedBefore.visibleLogicalRange },
    after: { candleCount: afterCount, visibleLogicalRange: zoomedAfter.visibleLogicalRange, dataWindow: after.dataWindow },
    addedCandles,
    providerBoundary,
    preserved,
    alignmentPass: Boolean(after.pass && after.rightGapPass),
    alignment: { pass: after.pass, rightGapPass: after.rightGapPass, errors },
    selectedSubIndicators: after.selectedSubIndicators || [],
    consoleErrors,
    pass: (addedCandles > 0 ? preserved : providerBoundary)
      && Boolean(after.pass && after.rightGapPass)
      && (after.selectedSubIndicators || []).length > 0
      && errors.length === 0
      && consoleErrors.length === 0,
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.argv.find((value) => /^https?:\/\//.test(value)) || "http://127.0.0.1:3000";
  const mock = process.argv.includes("--mock-candles");
  const sitesBypassToken = process.env.SITES_BYPASS_TOKEN?.trim();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = sitesBypassToken
    ? await browser.newContext({ extraHTTPHeaders: { "OAI-Sites-Authorization": `Bearer ${sitesBypassToken}` } })
    : null;
  const page = context
    ? await context.newPage({ viewport: { width: 1280, height: 900 } })
    : await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    if (mock) await installMockCandleRoutes(page);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const result = await runHistoryZoomAcceptance(page);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.pass) process.exitCode = 1;
  } finally {
    await context?.close();
    await browser.close();
  }
}
