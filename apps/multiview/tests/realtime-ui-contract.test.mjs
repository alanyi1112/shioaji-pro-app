import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, html, styles, config, vite] = await Promise.all([
  readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../scripts/cloudflare-config.mjs", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
]);

test("UI contract 只提供日／週／月 K，台股與加權指數可接即時 overlay", () => {
  assert.match(app, /const DEFAULT_INTERVAL = "1d"/);
  assert.match(app, /isTaiwanRealtimeSymbol/);
  assert.match(app, /realtimeEligible[\s\S]{0,180}isTaiwanRealtimeSymbol/);
  assert.match(app, /availableIntervals\([\s\S]{0,120}state\.intervals,[\s\S]{0,80}state\.appConfig\.capabilities\?\.taiwanIntradayTrend/);
  assert.doesNotMatch(app, /\bisTaiwanSymbol\(/);
  assert.doesNotMatch(app, /REALTIME_INTERVALS[^\n]*1m/);
});

test("分時模式停用不相容 K 線工具但不修改使用者偏好", () => {
  assert.match(styles, /\.chart-panel\.is-intraday \.indicator-menu/);
  assert.match(styles, /\.chart-panel\.is-intraday \.fixed-profile-controls/);
  assert.match(styles, /\.chart-panel\.is-intraday \.pivot-point-layer/);
  assert.doesNotMatch(styles, /is-intraday[^}]*localStorage/);
});

test("雙部署 fail closed：Cloudflare 預設關閉，Sites 不配置 realtime binding 或 secret", () => {
  assert.match(config, /SHIOAJI_REALTIME_ENABLED:\s*"false"/);
  assert.match(vite, /ENABLE_REALTIME_LOCAL_TEST/);
  assert.match(vite, /REALTIME_LOCAL_TEST: "true"/);
  assert.doesNotMatch(vite, /SHIOAJI_INGEST_SECRET/);
  assert.match(html, /realtime-coordinator\.js/);
  assert.match(html, /realtime-charts\.js/);
});
