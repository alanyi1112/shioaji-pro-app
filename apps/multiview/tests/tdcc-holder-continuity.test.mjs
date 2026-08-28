import assert from "node:assert/strict";
import test from "node:test";

import {
  projectTdccContinuousEvidence,
} from "../worker/tdcc-continuous-backfill.ts";
import {
  AEMC_SAVED_DATES,
  LARGAN_MISSING_DATES,
  LARGAN_SAVED_DATES,
  OFFICIAL_TDCC_DATES,
  savedDateRows,
} from "./fixtures/tdcc-holder-continuity.mjs";

test("53 筆資料仍不能掩蓋兩個中間官方缺週", () => {
  const result = projectTdccContinuousEvidence({
    officialDates: OFFICIAL_TDCC_DATES,
    savedRows: savedDateRows(LARGAN_SAVED_DATES),
    itemRows: [],
    latestDataDate: "2026-08-21",
    existingStatus: "completed",
  });
  assert.equal(result.savedWeeks, 53);
  assert.equal(result.expectedWeeks, 51);
  assert.equal(result.completedWeeks, 49);
  assert.deepEqual(result.missingDates, LARGAN_MISSING_DATES);
  assert.equal(result.status, "partial");
  assert.equal(result.officialPlanThrough, "2026-08-21");
});

test("新商品只有最新一週時保持 queued 並建立 50 個缺週", () => {
  const result = projectTdccContinuousEvidence({
    officialDates: OFFICIAL_TDCC_DATES,
    savedRows: savedDateRows(AEMC_SAVED_DATES),
    itemRows: [],
    latestDataDate: "2026-08-21",
    existingStatus: "queued",
  });
  assert.equal(result.savedWeeks, 1);
  assert.equal(result.completedWeeks, 1);
  assert.equal(result.missingDates.length, 50);
  assert.equal(result.status, "queued");
});

test("published、pre_listing 與 not_published 全部 resolved 後才 completed", () => {
  const published = OFFICIAL_TDCC_DATES.slice(0, 49);
  const itemRows = [
    { data_date: OFFICIAL_TDCC_DATES[49], status: "completed", error_code: "pre_listing" },
    { data_date: OFFICIAL_TDCC_DATES[50], status: "completed", error_code: "not_published" },
  ];
  const result = projectTdccContinuousEvidence({
    officialDates: OFFICIAL_TDCC_DATES,
    savedRows: savedDateRows(published),
    itemRows,
    latestDataDate: "2026-08-21",
  });
  assert.equal(result.completedWeeks, 51);
  assert.deepEqual(result.missingDates, []);
  assert.equal(result.status, "completed");
});

test("最新快照晚於已規劃日期時不能維持 completed", () => {
  const planned = OFFICIAL_TDCC_DATES.slice(1);
  const result = projectTdccContinuousEvidence({
    officialDates: planned,
    savedRows: savedDateRows(planned),
    latestDataDate: "2026-08-21",
    existingStatus: "completed",
    minimumHistoryWeeks: 50,
  });
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.status, "partial");
});

test("failed 與 blocked 日期保持 missing 並分開計數", () => {
  const result = projectTdccContinuousEvidence({
    officialDates: OFFICIAL_TDCC_DATES,
    savedRows: savedDateRows(OFFICIAL_TDCC_DATES.slice(2)),
    itemRows: [
      { data_date: "2026-08-21", status: "failed", error_code: "timeout" },
      { data_date: "2026-08-14", status: "blocked", error_code: "captcha_or_blocked" },
    ],
    latestDataDate: "2026-08-21",
  });
  assert.equal(result.failedWeeks, 2);
  assert.deepEqual(result.missingDates, ["2026-08-14", "2026-08-21"]);
  assert.equal(result.status, "partial");
});
