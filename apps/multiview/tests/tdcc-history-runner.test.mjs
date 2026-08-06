import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createTdccHistorySession,
  normalizeHistoryTable,
  parseTdccHistoryForm,
  parseTdccHistoryResult,
  parseRunnerArgs,
  safeChipWarmReason,
  safeContinuousRunnerError,
  selectOfficialDates,
  symbolsFromSetup,
  TDCC_LISTING_METADATA,
  verifyCurrentOfficialSymbols,
} from "../scripts/tdcc-history-backfill.mjs";

const runnerSource = await readFile(new URL("../scripts/tdcc-history-backfill.mjs", import.meta.url), "utf8");

const historyFormHtml = (token = "token-1") => `
  <form><input name="SYNCHRONIZER_TOKEN" value="${token}">
  <select id="scaDate"><option value="20260709">20260709</option><option value="20260703">20260703</option></select></form>`;

const historyResultHtml = (code = "2330", token = "token-2") => {
  const rows = Array.from({ length: 17 }, (_, index) => {
    const level = index + 1;
    const label = level <= 15 ? `${level}-${level + 1}` : level === 16 ? "差異調整" : "合計";
    return `<tr><td>${level}</td><td>${label}</td><td>${level === 17 ? 16 : 1}</td><td>${level === 17 ? 1500 : level === 16 ? 0 : 100}</td><td>${level === 17 ? "100.00" : level === 16 ? "0.00" : "1.00"}</td></tr>`;
  }).join("");
  return `${historyFormHtml(token)}<p>證券代號：${code}<br>證券名稱：測試</p><div class="table-frame securities-overview"><table><tbody>${rows}</tbody></table></div>`;
};

test("runner 從設定檔只選取已啟用台股並保留 ETF", () => {
  const setup = `| 頁籤 | 名稱 | 類型 | 代號 | A | B | 啟用 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 台股 | 台積電 | 股票 | 2330.TW | | | yes |\n| 台股 | 群益台灣精選高息 | ETF | 00919.TW | | | yes |\n| 台股 | 關閉 | 股票 | 2317.TW | | | no |\n| 美股 | Apple | 股票 | AAPL | | | yes |`;
  assert.deepEqual(symbolsFromSetup(setup), ["2330.TW", "00919.TW"]);
});

test("runner 依官方選單日期排序、篩選並限制週數", () => {
  assert.deepEqual(selectOfficialDates(["20260709", "20260626", "bad", "20260703"], { maxWeeks: 2 }), ["2026-07-03", "2026-07-09"]);
  assert.deepEqual(selectOfficialDates(["20260709", "20260626", "20260703"], { startDate: "2026-07-01" }), ["2026-07-03", "2026-07-09"]);
});

test("TDCC 公開表單解析 token、日期與 17 列歷史結果", () => {
  assert.deepEqual(parseTdccHistoryForm(historyFormHtml()), { token: "token-1", dates: ["20260709", "20260703"] });
  const rows = parseTdccHistoryResult({ html: historyResultHtml(), symbol: "2330.TW", dataDate: "2026-07-09" });
  assert.equal(rows.length, 17);
  assert.equal(rows[0]["證券代號"], "2330");
  assert.equal(rows[0]["資料日期"], "20260709");
  const notPublished = `${historyFormHtml()}<div class="securities-overview"><table><tr><td colspan="5">查無此資料</td></tr></table></div>`;
  assert.equal(parseTdccHistoryResult({ html: notPublished, symbol: "009821.TW", dataDate: "2025-07-18" }), null);
  assert.throws(() => parseTdccHistoryResult({ html: historyResultHtml("0050"), symbol: "2330.TW", dataDate: "2026-07-09" }), /candidate_mismatch/);
  assert.throws(() => parseTdccHistoryForm("Access Denied"), /captcha_or_blocked/);
});

test("TDCC HTTP session 保留 cookie、更新 synchronizer token 並送出公開表單", async () => {
  const calls = [];
  const fetchImpl = async (_url, init = {}) => {
    calls.push(init);
    return calls.length === 1
      ? new Response(historyFormHtml(), { status: 200, headers: { "set-cookie": "sid=abc; Path=/; HttpOnly" } })
      : new Response(historyResultHtml(), { status: 200 });
  };
  const session = createTdccHistorySession(fetchImpl);
  assert.deepEqual(await session.refresh(), ["20260709", "20260703"]);
  const rows = await session.query("2330.TW", "2026-07-09");
  assert.equal(rows.length, 17);
  assert.match(String(calls[1].headers.cookie), /sid=abc/);
  assert.match(String(calls[1].body), /stockNo=2330/);
  assert.match(String(calls[1].body), /SYNCHRONIZER_TOKEN=token-1/);
});

test("runner 將歷史頁 15 級加合計正規化成官方 17 列語意", () => {
  const rows = Array.from({ length: 15 }, (_, index) => [String(index + 1), `級距 ${index + 1}`, String(index + 10), String((index + 1) * 1000), "1.00"]);
  rows.push(["16", "合計", "999", "999999", "100.00"]);
  const result = normalizeHistoryTable({ symbol: "2330.TW", dataDate: "2026-07-09", rows });
  assert.equal(result.length, 17);
  assert.deepEqual(result[15], { "資料日期": "20260709", "證券代號": "2330", "持股分級": "16", "持股數分級": "差異調整", "人數": "0", "股數": "0", "占集保庫存數比例%": "0.00" });
  assert.equal(result[16]["持股分級"], "17");
  assert.equal(result[16]["持股數分級"], "合計");
  assert.throws(() => normalizeHistoryTable({ symbol: "2330.TW", dataDate: "2026-07-09", rows: rows.slice(0, 15) }), /invalid_response/);
});

test("runner 保留 ETF 歷史頁的差異調整列與負股數", () => {
  const rows = Array.from({ length: 15 }, (_, index) => [String(index + 1), `級距 ${index + 1}`, String(index + 10), String((index + 1) * 1000), "1.00"]);
  rows.push(["16", "差異數調整（說明4）", "", "-31,000", "-0.00"]);
  rows.push(["17", "合 計", "999", "999999", "100.00"]);
  const result = normalizeHistoryTable({ symbol: "00919.TW", dataDate: "2026-07-03", rows });
  assert.deepEqual(result[15], { "資料日期": "20260703", "證券代號": "00919", "持股分級": "16", "持股數分級": "差異數調整（說明4）", "人數": "0", "股數": "-31000", "占集保庫存數比例%": "0.00" });
  assert.equal(result[16]["持股分級"], "17");
});

test("runner 強制至少一秒間隔與有限重試", () => {
  assert.equal(parseRunnerArgs(["--delay-ms=1000", "--max-retries=5"]).delayMs, 1000);
  assert.equal(parseRunnerArgs(["--dry-run", "--snapshot-output=/tmp/tdcc.json"]).snapshotOutput, "/tmp/tdcc.json");
  assert.throws(() => parseRunnerArgs(["--snapshot-output=/tmp/tdcc.json"]), /dry-run/);
  assert.throws(() => parseRunnerArgs(["--delay-ms=999"]), /delay-ms/);
  assert.throws(() => parseRunnerArgs(["--max-retries=6"]), /max-retries/);
});

test("continuous runner 不接受固定 symbol，並限制 claim 與總時間", () => {
  assert.equal(parseRunnerArgs([]).chipWarmLimit, 40);
  const parsed = parseRunnerArgs(["--continuous", "--claim-limit=4", "--chip-warm-limit=40", "--max-run-ms=1200000", "--run-id=gha-123-1", "--trigger=schedule"]);
  assert.equal(parsed.continuous, true);
  assert.equal(parseRunnerArgs(["--history-only"]).historyOnly, true);
  assert.equal(parsed.claimLimit, 4);
  assert.equal(parsed.chipWarmLimit, 40);
  assert.equal(parsed.maxRunMs, 1200000);
  assert.equal(parsed.runId, "gha-123-1");
  assert.equal(parsed.trigger, "schedule");
  assert.doesNotMatch(runnerSource, /if \(partial\) break/);
  assert.throws(() => parseRunnerArgs(["--continuous", "--claim-limit=5"]), /claim-limit/);
  assert.throws(() => parseRunnerArgs(["--continuous", "--chip-warm-limit=41"]), /chip-warm-limit/);
  assert.throws(() => parseRunnerArgs(["--continuous", "--max-run-ms=30000"]), /max-run-ms/);
});

test("continuous runner log error 只保留 allowlist，不外洩秘密或頁面內容", () => {
  assert.equal(safeContinuousRunnerError(new Error("retryable_503 token=secret")), "provider_unavailable");
  assert.equal(safeContinuousRunnerError(new Error("captcha html body")), "captcha_or_blocked");
  assert.equal(safeContinuousRunnerError(new Error("unexpected Authorization Bearer secret")), "invalid_response");
});

test("日籌碼預熱錯誤摘要只輸出 allowlist reason", () => {
  assert.equal(safeChipWarmReason(new Error("HTTP 429 Authorization Bearer hidden")), "rate_limited");
  assert.equal(safeChipWarmReason(new Error("AbortError secret=hidden")), "timeout");
  assert.equal(safeChipWarmReason(new Error("unexpected upstream body token=hidden")), "provider_unavailable");
});

test("runner 先以最新官方 OpenAPI 確認目標代號，舊週才可保留缺值", async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ "證券代號": String(1000 + index) }));
  rows.push({ "證券代號": "2330  " }, { "證券代號": "00981A" });
  const fetchImpl = async () => new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  assert.deepEqual(await verifyCurrentOfficialSymbols(["2330.TW", "00981A.TW"], fetchImpl), ["2330.TW", "00981A.TW"]);
  await assert.rejects(verifyCurrentOfficialSymbols(["MISSING.TW"], fetchImpl), /官方最新資料找不到目標代號/);
});

test("runner 以官方上市日 metadata 保留新 ETF 上市前缺值", () => {
  assert.deepEqual(TDCC_LISTING_METADATA["009816.TW"], { listingDate: "2026-02-03", sourceUrl: "https://www.twse.com.tw/zh/ETFortune/etfInfo/009816" });
  assert.equal(TDCC_LISTING_METADATA["009819.TW"].listingDate, "2026-04-23");
});
