import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtime = await readFile(new URL("../../../scripts/realtimestock-runtime", import.meta.url), "utf8");
const state = await readFile(new URL("../../../scripts/multiview-state", import.meta.url), "utf8");

test("本機 TDCC LaunchAgent 使用週六主同步與週日隔日重試", () => {
  assert.match(runtime, /<key>Weekday<\/key><integer>7<\/integer><key>Hour<\/key><integer>22<\/integer><key>Minute<\/key><integer>30<\/integer>/);
  assert.match(runtime, /<key>Weekday<\/key><integer>1<\/integer><key>Hour<\/key><integer>22<\/integer><key>Minute<\/key><integer>30<\/integer>/);
});

test("靜態盤後 seed report 不再被標示為目前 pipeline 完成", () => {
  assert.match(state, /after_hours_source=seed_snapshot/);
  assert.match(state, /after_hours_\$\{group\}=seed_/);
  assert.match(runtime, /multiview_after_hours_source=/);
});
