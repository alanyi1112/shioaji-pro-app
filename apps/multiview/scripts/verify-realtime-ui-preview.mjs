import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 4191;
const origin = `http://localhost:${port}`;
const preview = spawn("npm", ["run", "dev", "--", "--host", "localhost", "--port", String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, ENABLE_REALTIME_LOCAL_TEST: "true" },
  stdio: ["ignore", "ignore", "ignore"],
});

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPreview() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/config`);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await wait(250);
  }
  throw new Error("realtime_ui_preview_start_timeout");
}

let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector(".chart-panel", { timeout: 30_000 });
  await page.waitForFunction(() => window.__quoteChartDebug?.panelViewState?.().some((panel) => panel.loaded), null, { timeout: 30_000 });

  const labels = await page.locator(".chart-panel").first().locator(".interval-select option").allTextContents();
  if (!labels.includes("分時") || labels.some((label) => /即時.*1分|1分.*即時/.test(label))) {
    throw new Error("realtime_ui_interval_contract_failed");
  }

  for (const count of [1, 2, 3, 4, 6, 8]) {
    await page.locator("#chart-count").selectOption(String(count));
    await page.waitForFunction((expected) => document.querySelectorAll(".chart-panel").length === expected, count);
  }

  const firstSymbol = await page.locator(".chart-panel .symbol-select").first().inputValue();
  await page.locator(".chart-panel .symbol-select").nth(1).selectOption(firstSymbol);
  await page.locator(".chart-panel .interval-select").nth(0).selectOption("intraday");
  await page.locator(".chart-panel .interval-select").nth(1).selectOption("intraday");
  await page.waitForFunction(() => document.querySelectorAll(".chart-panel.is-intraday").length >= 2);
  await page.waitForFunction(() => window.__quoteChartDebug?.matrix?.().realtimeConnectionCount === 1);

  const matrix = await page.evaluate(() => ({
    matrix: window.__quoteChartDebug.matrix(),
    panels: window.__quoteChartDebug.panelViewState(),
  }));
  if (matrix.matrix.chartCount !== 8 || matrix.matrix.realtimeConnectionCount !== 1) {
    throw new Error("realtime_ui_page_scoped_connection_failed");
  }
  if (matrix.panels.filter((panel) => panel.intraday).length < 2 || matrix.panels[0].symbol !== matrix.panels[1].symbol) {
    throw new Error("realtime_ui_repeated_symbol_failed");
  }

  const popupPromise = page.waitForEvent("popup", { timeout: 10_000 });
  await page.locator(".chart-panel").first().dblclick({ position: { x: 280, y: 180 } });
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.waitForSelector(".chart-panel", { timeout: 30_000 });
  const popupState = await popup.evaluate(() => window.__quoteChartDebug?.matrix?.());
  if (!popupState?.singleChartView || popupState.chartCount !== 1) {
    throw new Error("realtime_ui_single_chart_failed");
  }
  await popup.close();

  if (consoleErrors.length) throw new Error("realtime_ui_console_error");
  console.log("realtime-ui-preview: 1/2/3/4/6/8 panels, repeated symbol, intraday and single-chart passed");
} finally {
  try { await browser?.close(); } catch {}
  preview.kill("SIGTERM");
}
