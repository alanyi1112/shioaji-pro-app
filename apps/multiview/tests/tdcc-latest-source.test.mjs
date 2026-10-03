import assert from "node:assert/strict";
import test from "node:test";
import { fetchTdccLatestOfficial, parseTdccLatestCsv } from "../worker/tdcc-latest-source.ts";

const header = "資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%";
const codes = ["2449", ...Array.from({ length: 59 }, (_, index) => String(1000 + index))];

function rows(date, ratio = "6.67") {
  return codes.flatMap((code) => Array.from({ length: 17 }, (_, index) => {
    const level = index + 1;
    return {
      資料日期: date,
      證券代號: code,
      持股分級: String(level),
      人數: String(level === 17 ? 15 : level === 16 ? 0 : 1),
      股數: String(level === 17 ? 15000 : level === 16 ? 0 : 1000),
      "占集保庫存數比例%": level === 17 ? "100.00" : level === 16 ? "0" : level === 1 && code === "2449" ? ratio : "6.67",
    };
  }));
}

function csv(data) {
  return `\uFEFF${header}\r\n${data.map((row) => [row.資料日期, `${row.證券代號}  `, row.持股分級, row.人數, row.股數, row["占集保庫存數比例%"]].join(",")).join("\r\n")}\r\n`;
}

function fetchSources(csvResponse, jsonResponse) {
  return async (url) => url.includes("getOD.ashx") ? csvResponse : jsonResponse;
}

const eligibleSymbols = new Set(["2449.TW"]);
const now = new Date("2026-10-03T01:00:00Z");

test("官方 CSV 較新時採 CSV，保留 JSON 實際舊日期", async () => {
  const result = await fetchTdccLatestOfficial({ eligibleSymbols, now, fetchImpl: fetchSources(
    new Response(csv(rows("20261002"))), new Response(JSON.stringify(rows("20260924"))),
  ) });
  assert.equal(result.source, "csv");
  assert.equal(result.dataDate, "2026-10-02");
  assert.deepEqual(result.observedDates, { csv: "2026-10-02", openapi: "2026-09-24" });
  assert.equal(result.rows[0].levels.length, 15);
});

test("OpenAPI 較新時採 JSON；CSV 缺級距時由有效 JSON 備援", async () => {
  const newerJson = new Response(JSON.stringify(rows("20261002")));
  const olderCsv = new Response(csv(rows("20260924")));
  assert.equal((await fetchTdccLatestOfficial({ eligibleSymbols, now, fetchImpl: fetchSources(olderCsv, newerJson) })).source, "openapi");
  const partial = rows("20261002").filter((row) => !(row.證券代號 === "2449" && row.持股分級 === "3"));
  const result = await fetchTdccLatestOfficial({ eligibleSymbols, now, fetchImpl: fetchSources(
    new Response(csv(partial)), new Response(JSON.stringify(rows("20261002"))),
  ) });
  assert.equal(result.source, "openapi");
  assert.equal(result.failures.csv, "invalid_response");
});

test("同日不同持股內容不可靜默擇源", async () => {
  await assert.rejects(fetchTdccLatestOfficial({ eligibleSymbols, now, fetchImpl: fetchSources(
    new Response(csv(rows("20261002", "7.00"))), new Response(JSON.stringify(rows("20261002"))),
  ) }), /source_conflict/);
});

test("兩來源限流不可退回舊快取並冒充更新", async () => {
  await assert.rejects(fetchTdccLatestOfficial({ eligibleSymbols, now, fetchImpl: fetchSources(
    new Response("", { status: 429 }), new Response("", { status: 429 }),
  ) }), /rate_limited/);
});

test("CSV 欄位漂移與不合法引號會被拒絕", () => {
  assert.throws(() => parseTdccLatestCsv("資料日期,證券代號\n20261002,2449"), /invalid_response/);
  assert.throws(() => parseTdccLatestCsv(`${header}\n20261002,\"2449,1,1,1,1`), /invalid_response/);
});
