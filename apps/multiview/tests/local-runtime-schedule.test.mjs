import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { liveDataStatus } from "../../../scripts/multiview-live-status.mjs";

const runtime = await readFile(new URL("../../../scripts/realtimestock-runtime", import.meta.url), "utf8");
const state = await readFile(new URL("../../../scripts/multiview-state", import.meta.url), "utf8");

test("launchd 星期編號符合真實台北日曆：平日 daily、週六日 TDCC", () => {
  // launchd.plist(5): 0 and 7 are Sunday; 1 is Monday.
  const calendar = variable => {
    const start = runtime.indexOf(`cat > "${'${' + variable + '}'}"`);
    const block = runtime.slice(start, runtime.indexOf("\nEOF", start));
    return [...block.matchAll(/<key>Weekday<\/key><integer>(\d)<\/integer>/g)].map(match => Number(match[1]) % 7);
  };
  const daily = calendar("MULTIVIEW_DAILY_PLIST");
  const weekly = calendar("MULTIVIEW_TDCC_PLIST");
  assert.equal(daily.length, 5);
  assert.equal(weekly.length, 2);
  for (let day = 14; day <= 20; day++) {
    const date = new Date(`2026-09-${day}T16:45:00+08:00`);
    const weekday = date.getUTCDay();
    assert.equal(daily.includes(weekday), weekday >= 1 && weekday <= 5, `daily 9/${day}`);
    assert.equal(weekly.includes(weekday), weekday === 0 || weekday === 6, `TDCC 9/${day}`);
  }
});

test("靜態盤後 seed report 不再被標示為目前 pipeline 完成", () => {
  assert.match(state, /after_hours_source=seed_snapshot/);
  assert.match(state, /after_hours_\$\{group\}=seed_/);
  assert.match(runtime, /scripts\/multiview-live-status\.mjs/);
  assert.equal(liveDataStatus({ ok: true }).multiview_after_hours_source, "live_health");
  assert.equal(liveDataStatus({ ok: true }).multiview_after_hours, "verification_required");
});


test("daily runner 接上有界日 K 維護，失敗保留其他資料工作", () => {
  const daily = runtime.slice(runtime.indexOf("service_multiview_daily_pipeline()"), runtime.indexOf("service_multiview_tdcc_pipeline()"));
  assert.match(daily, /local-candle-continuity\.mjs/);
  assert.match(daily, /日 K 稽核未完成/);
  assert.match(daily, /pe-river-continuous-backfill\.mjs/);
});
