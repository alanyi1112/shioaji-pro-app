import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTdccHistoryRecoverySql,
  parseRecoveryArgs,
  validateTdccHistorySnapshot,
} from "../scripts/tdcc-history-recovery.mjs";

function rawRows(symbol, dataDate) {
  const code = symbol.replace(/\.(TW|TWO)$/, "");
  const rows = Array.from({ length: 15 }, (_, index) => ({
    "資料日期": dataDate.replaceAll("-", ""),
    "證券代號": code,
    "持股分級": String(index + 1),
    "持股數分級": `級距 ${index + 1}`,
    "人數": "1",
    "股數": "100",
    "占集保庫存數比例%": "1.00",
  }));
  rows.push({ "資料日期": dataDate.replaceAll("-", ""), "證券代號": code, "持股分級": "16", "持股數分級": "差異調整", "人數": "0", "股數": "0", "占集保庫存數比例%": "0.00" });
  rows.push({ "資料日期": dataDate.replaceAll("-", ""), "證券代號": code, "持股分級": "17", "持股數分級": "合計", "人數": "15", "股數": "1500", "占集保庫存數比例%": "15.00" });
  return rows;
}

function snapshot() {
  const targetSymbols = ["00919.TW", "2330.TW"];
  const officialDates = ["2026-07-17", "2026-07-24"];
  return {
    version: 1,
    source: "tdcc-official-history-query",
    jobId: "tdcc-test",
    targetSymbols,
    officialDates,
    updatedAt: "2026-08-01T00:00:00.000Z",
    weeks: Object.fromEntries(officialDates.map((date) => [date, {
      statuses: targetSymbols.map((symbol) => ({ symbol, reason: "published" })),
      rows: targetSymbols.flatMap((symbol) => rawRows(symbol, date)),
    }])),
  };
}

test("TDCC 復原參數預設要求至少 51 個官方週", () => {
  const parsed = parseRecoveryArgs(["--snapshot=/tmp/in.json", "--output-sql=/tmp/out.sql"]);
  assert.equal(parsed.minimumWeeks, 51);
  assert.throws(() => parseRecoveryArgs(["--snapshot=/tmp/in.json"]), /output-sql/);
});

test("TDCC 復原快照逐商品逐週驗證 17 列官方分級", () => {
  const validated = validateTdccHistorySnapshot(snapshot(), { minimumWeeks: 2 });
  assert.equal(validated.symbols.length, 2);
  assert.equal(validated.dates.length, 2);
  assert.equal(validated.distributionRows.length, 4);
  assert.equal(validated.itemRows.length, 4);
  assert.match(validated.digest, /^[a-f0-9]{64}$/);

  const incomplete = snapshot();
  incomplete.weeks["2026-07-17"].statuses.pop();
  assert.throws(() => validateTdccHistorySnapshot(incomplete, { minimumWeeks: 2 }), /incomplete_statuses/);
});

test("TDCC 復原 SQL 僅寫公開市場資料與 coverage 狀態，並採 material changed-only upsert", () => {
  const validated = validateTdccHistorySnapshot(snapshot(), { minimumWeeks: 2 });
  const sql = buildTdccHistoryRecoverySql(validated, { completedAt: "2026-08-01T00:00:00.000Z" });
  assert.match(sql, /INSERT INTO taiwan_stock_shareholder_distribution/);
  assert.match(sql, /WHERE taiwan_stock_shareholder_distribution\.levels_json IS NOT excluded\.levels_json/);
  assert.match(sql, /INSERT INTO tdcc_continuous_items/);
  assert.match(sql, /tdcc_continuous_items\.status IS NOT 'completed'/);
  assert.match(sql, /UPDATE tdcc_continuous_symbols SET status='completed'/);
  assert.match(sql, /status IS NOT 'completed' OR target_start IS NOT/);
  assert.match(sql, /__MARKET__:tdcc-1-5-v3/);
  assert.match(sql, /taiwan_stock_chip_fetch_state\.coverage_start IS NOT excluded\.coverage_start/);
  assert.doesNotMatch(sql, /user_|access_allowlist|personal_|email|principal/i);
});

test("TDCC 復原保留上市前與合法查無資料為已處理 gap", () => {
  const value = snapshot();
  value.weeks["2026-07-17"].statuses[0].reason = "pre_listing";
  value.weeks["2026-07-17"].rows = value.weeks["2026-07-17"].rows.slice(17);
  const validated = validateTdccHistorySnapshot(value, { minimumWeeks: 2 });
  const sql = buildTdccHistoryRecoverySql(validated, { completedAt: "2026-08-01T00:00:00.000Z" });
  assert.match(sql, /'pre_listing'/);
  assert.equal(validated.publishedBySymbol["00919.TW"], 1);
});
