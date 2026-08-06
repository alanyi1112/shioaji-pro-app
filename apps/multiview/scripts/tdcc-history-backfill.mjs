#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseTdccSnapshot } from "../worker/taiwan-stock-chip.ts";

export const TDCC_HISTORY_URL = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock";
export const TDCC_LATEST_OPEN_DATA_URL = "https://openapi.tdcc.com.tw/v1/opendata/1-5";
export const TDCC_LISTING_METADATA = Object.freeze({
  "009816.TW": { listingDate: "2026-02-03", sourceUrl: "https://www.twse.com.tw/zh/ETFortune/etfInfo/009816" },
  "009819.TW": { listingDate: "2026-04-23", sourceUrl: "https://www.twse.com.tw/staticFiles/news/news/tsecnews/8a8216d69d2e8217019daf567620022f.pdf" },
});
export const DEFAULT_SITE_URL = "https://quote-chart-multiview.alanyi1112.chatgpt.site";
const SYMBOL_PATTERN = /^[0-9A-Z]{4,8}\.(TW|TWO)$/;
const CONTINUOUS_SAFE_ERRORS = new Set(["captcha_or_blocked", "candidate_mismatch", "history_automation_not_permitted", "invalid_response", "provider_unavailable", "rate_limited", "timeout"]);

export function safeContinuousRunnerError(value) {
  const raw = String(value instanceof Error ? value.message : value || "invalid_response");
  if (CONTINUOUS_SAFE_ERRORS.has(raw)) return raw;
  if (/429|rate.?limit/i.test(raw)) return "rate_limited";
  if (/timeout|abort/i.test(raw)) return "timeout";
  if (/captcha|blocked|forbidden|403/i.test(raw)) return "captcha_or_blocked";
  if (/candidate/i.test(raw)) return "candidate_mismatch";
  if (/retryable_5\d\d|provider|control_plane_5\d\d/i.test(raw)) return "provider_unavailable";
  return "invalid_response";
}

export function parseRunnerArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (const argument of argv) {
    if (!argument.startsWith("--")) throw new Error(`未知參數：${argument}`);
    const [key, ...rest] = argument.slice(2).split("=");
    if (rest.length) values.set(key, rest.join("="));
    else flags.add(key);
  }
  const delayMs = Number(values.get("delay-ms") || 1200);
  const maxRetries = Number(values.get("max-retries") || 3);
  const maxWeeks = values.has("max-weeks") ? Number(values.get("max-weeks")) : null;
  const claimLimit = Number(values.get("claim-limit") || 2);
  const chipWarmLimit = Number(values.get("chip-warm-limit") || 40);
  const maxRunMs = Number(values.get("max-run-ms") || 20 * 60 * 1000);
  if (!Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 30000) throw new Error("delay-ms 必須介於 1000 到 30000");
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 5) throw new Error("max-retries 必須介於 1 到 5");
  if (maxWeeks !== null && (!Number.isInteger(maxWeeks) || maxWeeks < 1 || maxWeeks > 60)) throw new Error("max-weeks 必須介於 1 到 60");
  if (!Number.isInteger(claimLimit) || claimLimit < 1 || claimLimit > 4) throw new Error("claim-limit 必須介於 1 到 4");
  if (!Number.isInteger(chipWarmLimit) || chipWarmLimit < 1 || chipWarmLimit > 40) throw new Error("chip-warm-limit 必須介於 1 到 40");
  if (!Number.isInteger(maxRunMs) || maxRunMs < 60000 || maxRunMs > 30 * 60 * 1000) throw new Error("max-run-ms 必須介於 60000 到 1800000");
  const dryRun = flags.has("dry-run");
  const snapshotOutput = values.get("snapshot-output") || null;
  if (snapshotOutput && !dryRun) throw new Error("snapshot-output 只能搭配 dry-run 使用");
  return {
    symbols: values.get("symbols")?.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) || null,
    setupPath: values.get("setup") || "public/data/stock_setup.md",
    siteUrl: (values.get("site-url") || DEFAULT_SITE_URL).replace(/\/$/, ""),
    jobId: values.get("job-id") || `tdcc-local-${new Date().toISOString().slice(0, 10)}`,
    checkpointPath: values.get("checkpoint") || ".tdcc-backfill/checkpoint.json",
    startDate: values.get("start-date") || null,
    endDate: values.get("end-date") || null,
    delayMs,
    maxRetries,
    maxWeeks,
    claimLimit,
    chipWarmLimit,
    maxRunMs,
    continuous: flags.has("continuous"),
    historyOnly: flags.has("history-only"),
    trigger: values.get("trigger") === "schedule" ? "schedule" : "workflow_dispatch",
    runId: values.get("run-id") || `gha-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`,
    headful: flags.has("headful"),
    dryRun,
    snapshotOutput,
  };
}

export function symbolsFromSetup(markdown) {
  const symbols = String(markdown).split("\n").flatMap((line) => {
    if (!line.startsWith("|") || line.includes("---") || line.includes("頁籤 |")) return [];
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const [tab, , , symbol, , , enabled] = cells;
    if (tab !== "台股" || !SYMBOL_PATTERN.test(String(symbol || "").toUpperCase()) || ["no", "false", "0"].includes(String(enabled || "").toLowerCase())) return [];
    return [String(symbol).toUpperCase()];
  });
  return [...new Set(symbols)];
}

export function validateTargetSymbols(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 64) throw new Error("目標證券數必須介於 1 到 64");
  const symbols = input.map((value) => String(value).trim().toUpperCase());
  if (new Set(symbols).size !== symbols.length || symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))) throw new Error("目標證券代號無效或重複");
  return symbols;
}

export async function verifyCurrentOfficialSymbols(symbols, fetchImpl = fetch) {
  const response = await fetchImpl(TDCC_LATEST_OPEN_DATA_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status === 429 ? "rate_limited" : "provider_unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length < 1000) throw new Error("invalid_response");
  const codes = new Set(payload.map((row) => String(row?.["證券代號"] ?? row?.["證券代碼"] ?? "").trim()).filter(Boolean));
  const missing = symbols.filter((symbol) => !codes.has(symbol.replace(/\.(TW|TWO)$/, "")));
  if (missing.length) throw new Error(`官方最新資料找不到目標代號：${missing.join(",")}`);
  return symbols;
}

function numericCell(value, { integer = true, nonNegative = true, emptyAsZero = false } = {}) {
  if (emptyAsZero && String(value ?? "").trim() === "") return 0;
  const number = Number(String(value || "").replaceAll(",", "").trim());
  if (!Number.isFinite(number) || (nonNegative && number < 0) || (integer && !Number.isInteger(number))) throw new Error("invalid_response");
  return number;
}

export function normalizeHistoryTable({ symbol, dataDate, rows }) {
  const code = String(symbol).replace(/\.(TW|TWO)$/, "");
  if (!SYMBOL_PATTERN.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(dataDate) || !Array.isArray(rows) || ![16, 17].includes(rows.length)) throw new Error("invalid_response");
  const normalized = rows.map((cells, index) => {
    const level = index + 1;
    const adjustment = level === 16 && rows.length === 17;
    if (!Array.isArray(cells) || cells.length !== 5 || numericCell(cells[0]) !== level) throw new Error("invalid_response");
    return {
      "資料日期": dataDate.replaceAll("-", ""),
      "證券代號": code,
      "持股分級": String(index + 1),
      "持股數分級": String(cells[1]).replace(/\s+/g, "").trim(),
      "人數": String(numericCell(cells[2], { emptyAsZero: adjustment })),
      "股數": String(numericCell(cells[3], { nonNegative: !adjustment })),
      "占集保庫存數比例%": numericCell(cells[4], { integer: false, nonNegative: !adjustment }).toFixed(2),
    };
  });
  const total = normalized.pop();
  if (!total || !total["持股數分級"].replace(/\s+/g, "").includes("合計")) throw new Error("invalid_response");
  if (rows.length === 17) {
    const adjustment = normalized.at(-1);
    if (!adjustment || adjustment["持股分級"] !== "16" || !adjustment["持股數分級"].includes("差異")) throw new Error("invalid_response");
    return [...normalized, { ...total, "持股分級": "17", "持股數分級": "合計" }];
  }
  const adjustment = {
    "資料日期": dataDate.replaceAll("-", ""),
    "證券代號": code,
    "持股分級": "16",
    "持股數分級": "差異調整",
    "人數": "0",
    "股數": "0",
    "占集保庫存數比例%": "0.00",
  };
  return [...normalized, adjustment, { ...total, "持股分級": "17", "持股數分級": "合計" }];
}

export function selectOfficialDates(values, options = {}) {
  let dates = [...new Set(values.map((value) => String(value).trim()))]
    .filter((value) => /^\d{8}$/.test(value))
    .map((value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`)
    .sort();
  if (options.startDate) dates = dates.filter((date) => date >= options.startDate);
  if (options.endDate) dates = dates.filter((date) => date <= options.endDate);
  if (options.maxWeeks) dates = dates.slice(-options.maxWeeks);
  if (dates.length < 2 || dates.length > 60) throw new Error("官方日期範圍必須介於 2 到 60 週");
  return dates;
}

function distributionDiagnostics(rows) {
  const levels = rows.slice(0, 15);
  const adjustment = rows[15];
  const total = rows[16];
  const sum = (key) => levels.reduce((value, row) => value + Number(row[key]), 0);
  return {
    levelRows: levels.length,
    holders: [sum("人數"), Number(total?.["人數"])],
    shares: [sum("股數") + Number(adjustment?.["股數"]), Number(total?.["股數"])],
    ratio: [Number((sum("占集保庫存數比例%") + Number(adjustment?.["占集保庫存數比例%"])) .toFixed(2)), Number(total?.["占集保庫存數比例%"])],
  };
}

async function loadCheckpoint(filePath, jobId) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (value.version === 1 && value.jobId === jobId && Array.isArray(value.completedDates)) return value;
  } catch {}
  return { version: 1, jobId, completedDates: [], updatedAt: null };
}

async function saveCheckpoint(filePath, checkpoint) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function emptyHistorySnapshot({ jobId, symbols, dates }) {
  return {
    version: 1,
    source: "tdcc-official-history-query",
    jobId,
    targetSymbols: [...symbols].sort(),
    officialDates: [...dates].sort(),
    weeks: {},
    updatedAt: null,
  };
}

async function loadHistorySnapshot(filePath, expected) {
  if (!filePath) return null;
  try {
    const snapshot = JSON.parse(await readFile(filePath, "utf8"));
    const same = snapshot?.version === 1
      && snapshot?.source === "tdcc-official-history-query"
      && snapshot?.jobId === expected.jobId
      && JSON.stringify(snapshot?.targetSymbols) === JSON.stringify([...expected.symbols].sort())
      && JSON.stringify(snapshot?.officialDates) === JSON.stringify([...expected.dates].sort())
      && snapshot?.weeks && typeof snapshot.weeks === "object" && !Array.isArray(snapshot.weeks);
    if (!same) throw new Error("歷史快照與本次 job、商品或官方日期不一致");
    return snapshot;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return emptyHistorySnapshot(expected);
  }
}

async function saveHistorySnapshot(filePath, snapshot) {
  if (!filePath || !snapshot) return null;
  await mkdir(path.dirname(filePath), { recursive: true });
  const value = `${JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() }, null, 2)}\n`;
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, filePath);
  return createHash("sha256").update(value).digest("hex");
}

function isLoopbackSite(siteUrl) {
  const url = new URL(siteUrl);
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

function platformAuthorizationHeaders(siteUrl) {
  if (isLoopbackSite(siteUrl)) return {};
  const sitesToken = process.env.SITES_BYPASS_TOKEN?.trim();
  if (sitesToken) return { "OAI-Sites-Authorization": `Bearer ${sitesToken}` };
  const accessClientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID?.trim();
  const accessClientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET?.trim();
  if (!accessClientId || !accessClientSecret) throw new Error("缺少必要的平台授權 secrets");
  return {
    "CF-Access-Client-Id": accessClientId,
    "CF-Access-Client-Secret": accessClientSecret,
  };
}

function pipelineAuthorizationHeaders(secret) {
  return process.env.SITES_BYPASS_TOKEN?.trim()
    ? { authorization: `Bearer ${secret}` }
    : { "X-MultiChart-Pipeline-Authorization": `Bearer ${secret}` };
}

function apiHeaders(siteUrl) {
  const secret = process.env.TDCC_HISTORY_INGEST_SECRET?.trim();
  if (!secret) throw new Error("缺少 TDCC_HISTORY_INGEST_SECRET");
  return { "content-type": "application/json", ...pipelineAuthorizationHeaders(secret), ...platformAuthorizationHeaders(siteUrl) };
}

function continuousApiHeaders(siteUrl) {
  const secret = process.env.TDCC_CONTINUOUS_BACKFILL_SECRET?.trim();
  if (!secret) throw new Error("缺少必要的背景回補 secrets");
  return {
    "content-type": "application/json",
    ...pipelineAuthorizationHeaders(secret),
    ...platformAuthorizationHeaders(siteUrl),
  };
}

async function continuousRequest(siteUrl, body = null) {
  const response = await fetch(`${siteUrl}/api/internal/tdcc-continuous-backfill`, {
    method: body ? "POST" : "GET",
    headers: continuousApiHeaders(siteUrl),
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `control_plane_${response.status}`);
  return payload;
}

function sitesBypassHeaders(siteUrl) {
  return platformAuthorizationHeaders(siteUrl);
}

export function safeChipWarmReason(value) {
  const raw = String(value instanceof Error ? value.message : value || "provider_unavailable");
  if (/429|rate.?limit/i.test(raw)) return "rate_limited";
  if (/timeout|abort/i.test(raw)) return "timeout";
  if (/invalid|parse|response/i.test(raw)) return "invalid_response";
  return "provider_unavailable";
}

export async function warmWatchlistChipData(options, fetchImpl = fetch) {
  const targetPayload = await continuousRequest(options.siteUrl, { action: "chip-targets", runId: options.runId, limit: options.chipWarmLimit });
  let completedSymbols = 0;
  let failedSymbols = 0;
  for (const target of targetPayload.targets || []) {
    const url = new URL("/api/taiwan-stock-chip", options.siteUrl);
    url.searchParams.set("symbol", target.symbol);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("start", target.start);
    url.searchParams.set("end", target.end);
    url.searchParams.set("datasets", (target.datasets || []).join(","));
    try {
      const response = await fetchImpl(url, { headers: sitesBypassHeaders(options.siteUrl), signal: AbortSignal.timeout(45000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.eligible === false) throw new Error(response.status === 429 ? "rate_limited" : "provider_unavailable");
      const reasons = Object.values(payload?.availability || {}).map((item) => item?.reason).filter(Boolean);
      const rateLimited = reasons.includes("rate_limited");
      completedSymbols += 1;
      process.stdout.write(`${JSON.stringify({ event: "chip-warm-complete", symbol: target.symbol, datasets: target.datasets?.length || 0, rateLimited })}\n`);
      if (rateLimited) break;
    } catch (error) {
      const reason = safeChipWarmReason(error);
      failedSymbols += 1;
      process.stdout.write(`${JSON.stringify({ event: "chip-warm-failed", symbol: target.symbol, reason })}\n`);
      if (reason === "rate_limited") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { requestedSymbols: targetPayload.targets?.length || 0, completedSymbols, failedSymbols, pendingSymbols: targetPayload.pendingSymbols || 0 };
}

async function postBackfill(siteUrl, body) {
  const response = await fetch(`${siteUrl}/api/internal/tdcc-shareholder-backfill`, { method: "POST", headers: apiHeaders(siteUrl), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ingest_${response.status}_${payload.error || "failed"}`);
  return payload;
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function historyResponseReason(response, html) {
  if (response.status === 429) return "rate_limited";
  if (response.status === 403 || /驗證碼|captcha|access denied|request rejected|forbidden/i.test(html)) return "captcha_or_blocked";
  if (!response.ok || response.status >= 500) return "provider_unavailable";
  return null;
}

export function parseTdccHistoryForm(html) {
  const token = String(html || "").match(/name=["']SYNCHRONIZER_TOKEN["'][^>]*value=["']([^"']+)["']/i)?.[1] || "";
  const select = String(html || "").match(/<select\b[^>]*id=["']scaDate["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] || "";
  const dates = [...select.matchAll(/<option\b[^>]*value=["'](\d{8})["']/gi)].map((match) => match[1]);
  if (!token || dates.length < 2) throw new Error(/驗證碼|captcha|access denied|request rejected|forbidden/i.test(String(html || "")) ? "captcha_or_blocked" : "invalid_response");
  return { token, dates: [...new Set(dates)] };
}

export function parseTdccHistoryResult({ html, symbol, dataDate }) {
  const code = symbol.replace(/\.(TW|TWO)$/, "");
  const source = String(html || "");
  if (/驗證碼|captcha|access denied|request rejected|forbidden/i.test(source)) throw new Error("captcha_or_blocked");
  const marker = source.search(/class=["'][^"']*securities-overview/i);
  if (marker < 0) return /查無此資料/.test(source) ? null : (() => { throw new Error("invalid_response"); })();
  const tableStart = source.indexOf("<table", marker);
  const tableEnd = source.indexOf("</table>", tableStart);
  if (tableStart < 0 || tableEnd < 0) throw new Error("invalid_response");
  const table = source.slice(tableStart, tableEnd + 8);
  if (/查無此資料/.test(table)) return null;
  const resultCode = decodeHtmlText(source.slice(Math.max(0, marker - 1600), marker)).match(/證券代號：\s*([0-9A-Z]+)/)?.[1] || "";
  if (resultCode !== code) throw new Error("candidate_mismatch");
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => decodeHtmlText(cell[1])),
  ).filter((cells) => cells.length === 5);
  if (!rows.length) throw new Error("invalid_response");
  return normalizeHistoryTable({ symbol, dataDate, rows });
}

function mergeCookies(current, response) {
  const cookies = new Map(String(current || "").split("; ").filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return [item.slice(0, index), item.slice(index + 1)];
  }));
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of setCookies) {
    const pair = String(value).split(";", 1)[0];
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

export function createTdccHistorySession(fetchImpl = fetch) {
  let token = "";
  let cookie = "";
  let dates = [];
  const headers = { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; TDCC history backfill; +https://www.tdcc.com.tw/)" };
  const refresh = async () => {
    const response = await fetchImpl(TDCC_HISTORY_URL, { headers, signal: AbortSignal.timeout(30000) });
    const html = await response.text();
    const reason = historyResponseReason(response, html);
    if (reason) throw new Error(reason);
    cookie = mergeCookies(cookie, response);
    const form = parseTdccHistoryForm(html);
    token = form.token;
    dates = form.dates;
    return dates;
  };
  const query = async (symbol, dataDate) => {
    if (!token) await refresh();
    const code = symbol.replace(/\.(TW|TWO)$/, "");
    const body = new URLSearchParams({ SYNCHRONIZER_TOKEN: token, SYNCHRONIZER_URI: "/portal/zh/smWeb/qryStock", method: "submit", scaDate: dataDate.replaceAll("-", ""), sqlMethod: "StockNo", stockNo: code, stockName: "" });
    const response = await fetchImpl(TDCC_HISTORY_URL, { method: "POST", headers: { ...headers, "content-type": "application/x-www-form-urlencoded", cookie, referer: TDCC_HISTORY_URL }, body, redirect: "follow", signal: AbortSignal.timeout(30000) });
    const html = await response.text();
    const reason = historyResponseReason(response, html);
    if (reason) throw new Error(reason);
    cookie = mergeCookies(cookie, response);
    const nextToken = html.match(/name=["']SYNCHRONIZER_TOKEN["'][^>]*value=["']([^"']+)["']/i)?.[1];
    if (!nextToken) throw new Error("invalid_response");
    token = nextToken;
    return parseTdccHistoryResult({ html, symbol, dataDate });
  };
  return { refresh, query, dates: () => [...dates] };
}

async function queryWithRetry(session, symbol, dataDate, options) {
  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    const startedAt = Date.now();
    try {
      const rows = await session.query(symbol, dataDate);
      const remaining = options.delayMs - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      return rows;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid_response";
      if (reason === "captcha_or_blocked" || reason === "candidate_mismatch") throw error;
      if (attempt >= options.maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(options.delayMs * (2 ** (attempt - 1)), 10000)));
      await session.refresh();
    }
  }
  throw new Error("retry_exhausted");
}

export async function runBackfill(options) {
  const setupText = options.symbols ? null : await readFile(options.setupPath, "utf8");
  const symbols = validateTargetSymbols(options.symbols || symbolsFromSetup(setupText));
  await verifyCurrentOfficialSymbols(symbols);
  const session = createTdccHistorySession();
  const dateValues = await session.refresh();
    const dates = selectOfficialDates(dateValues, options);
    const checkpoint = await loadCheckpoint(options.checkpointPath, options.jobId);
    const snapshot = await loadHistorySnapshot(options.snapshotOutput, { jobId: options.jobId, symbols, dates });
    if (!options.dryRun) await postBackfill(options.siteUrl, { action: "start", source: "tdcc-official-history-query", jobId: options.jobId, expectedDates: dates, targetSymbols: symbols });
    for (const [dateIndex, dataDate] of dates.entries()) {
      if (checkpoint.completedDates.includes(dataDate) && (!snapshot || snapshot.weeks[dataDate])) continue;
      const rows = [];
      const returnedSymbols = [];
      const statuses = [];
      for (const [symbolIndex, symbol] of symbols.entries()) {
        const preListing = TDCC_LISTING_METADATA[symbol]?.listingDate > dataDate;
        const normalized = preListing ? null : await queryWithRetry(session, symbol, dataDate, options);
        if (normalized) {
          try { parseTdccSnapshot(normalized, new Set([symbol])); }
          catch {
            process.stdout.write(`${JSON.stringify({ event: "validation-failed", dataDate, symbol, diagnostics: distributionDiagnostics(normalized) })}\n`);
            throw new Error("invalid_response");
          }
          rows.push(...normalized); returnedSymbols.push(symbol);
        }
        const reason = preListing ? "pre_listing" : normalized ? "published" : "not_published";
        statuses.push({ symbol, reason });
        process.stdout.write(`${JSON.stringify({ event: "query", dataDate, symbol, found: Boolean(normalized), reason, progress: `${dateIndex + 1}/${dates.length} weeks, ${symbolIndex + 1}/${symbols.length} symbols` })}\n`);
      }
      if (!returnedSymbols.length) throw new Error(`整週查無目標資料：${dataDate}`);
      const validated = parseTdccSnapshot(rows, new Set(returnedSymbols));
      if (validated.length !== returnedSymbols.length || validated.some((row) => row.dataDate !== dataDate)) throw new Error("invalid_response");
      if (!options.dryRun) await postBackfill(options.siteUrl, { action: "ingest-week", source: "tdcc-official-history-query", jobId: options.jobId, dataDate, fetchedAt: new Date().toISOString(), returnedSymbols, rows });
      if (snapshot) {
        snapshot.weeks[dataDate] = { statuses, rows };
        await saveHistorySnapshot(options.snapshotOutput, snapshot);
      }
      if (!checkpoint.completedDates.includes(dataDate)) checkpoint.completedDates.push(dataDate);
      checkpoint.completedDates.sort();
      await saveCheckpoint(options.checkpointPath, checkpoint);
      process.stdout.write(`${JSON.stringify({ event: "week-complete", dataDate, returnedSymbols: returnedSymbols.length, missingSymbols: symbols.length - returnedSymbols.length, rows: rows.length })}\n`);
    }
  const snapshotDigest = snapshot ? await saveHistorySnapshot(options.snapshotOutput, snapshot) : null;
  return { jobId: options.jobId, expectedWeeks: dates.length, completedWeeks: checkpoint.completedDates.filter((date) => dates.includes(date)).length, targetSymbols: symbols.length, dryRun: options.dryRun, snapshotWeeks: snapshot ? Object.keys(snapshot.weeks).length : 0, snapshotDigest };
}

export async function runContinuousBackfill(options) {
  const startedAt = Date.now();
  const control = await continuousRequest(options.siteUrl);
  if (!options.historyOnly) await continuousRequest(options.siteUrl, { action: "start-run", runId: options.runId, trigger: options.trigger });
  let activeSymbol = null;
  try {
    if (!options.historyOnly) {
      const latest = await continuousRequest(options.siteUrl, { action: "refresh-latest", runId: options.runId });
      process.stdout.write(`${JSON.stringify({ event: "latest-refreshed", dataDate: latest.dataDates?.[0] || null, symbols: latest.symbols || 0 })}\n`);
      try {
        const chipWarm = await warmWatchlistChipData(options);
        process.stdout.write(`${JSON.stringify({ event: "chip-warm-summary", ...chipWarm })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ event: "chip-warm-summary", requestedSymbols: 0, completedSymbols: 0, failedSymbols: 1, reason: safeChipWarmReason(error) })}\n`);
      }
    }
    if (!control.historyAutomationEnabled) {
      await continuousRequest(options.siteUrl, { action: "finish-run", runId: options.runId });
      return { runId: options.runId, completedSymbols: 0, completedWeeks: 0, historySkipped: "history_automation_not_permitted" };
    }
    const session = createTdccHistorySession();
    const dateValues = await session.refresh();
    const officialDates = selectOfficialDates(dateValues, { startDate: options.startDate, endDate: options.endDate, maxWeeks: options.maxWeeks || 60 });
    let completedSymbols = 0;
    let completedWeeks = 0;
    while (Date.now() - startedAt < options.maxRunMs - 45000) {
      const claimed = await continuousRequest(options.siteUrl, { action: "claim", runId: options.runId, owner: options.runId, limit: options.claimLimit });
      if (!claimed.claims?.length) break;
      for (const claim of claimed.claims) {
        activeSymbol = claim.symbol;
        const preListingDates = officialDates.filter((date) => TDCC_LISTING_METADATA[claim.symbol]?.listingDate > date);
        const planned = await continuousRequest(options.siteUrl, { action: "plan", runId: options.runId, owner: options.runId, symbol: claim.symbol, officialDates, preListingDates });
        const pending = planned.plan.missingDates.slice(0, 12);
        for (const dataDate of pending) {
          if (Date.now() - startedAt >= options.maxRunMs - 30000) break;
          await continuousRequest(options.siteUrl, { action: "heartbeat", runId: options.runId, owner: options.runId, symbols: [claim.symbol] });
          const rows = await queryWithRetry(session, claim.symbol, dataDate, options);
          if (!rows) {
            await continuousRequest(options.siteUrl, { action: "complete-gap", runId: options.runId, owner: options.runId, symbol: claim.symbol, dataDate, reason: "not_published" });
            completedWeeks += 1;
            process.stdout.write(`${JSON.stringify({ event: "week-gap", symbol: claim.symbol, dataDate, reason: "not_published" })}\n`);
            continue;
          }
          parseTdccSnapshot(rows, new Set([claim.symbol]));
          if (!options.dryRun) await continuousRequest(options.siteUrl, { action: "ingest-week", runId: options.runId, owner: options.runId, symbol: claim.symbol, dataDate, fetchedAt: new Date().toISOString(), rows });
          completedWeeks += 1;
          process.stdout.write(`${JSON.stringify({ event: "week-complete", symbol: claim.symbol, dataDate })}\n`);
        }
        const partial = pending.length < planned.plan.missingDates.length || Date.now() - startedAt >= options.maxRunMs - 30000;
        await continuousRequest(options.siteUrl, { action: "complete-symbol", runId: options.runId, owner: options.runId, symbol: claim.symbol, partial });
        activeSymbol = null;
        completedSymbols += partial ? 0 : 1;
      }
    }
    await continuousRequest(options.siteUrl, { action: "finish-run", runId: options.runId });
    return { runId: options.runId, completedSymbols, completedWeeks };
  } catch (error) {
    const reason = safeContinuousRunnerError(error);
    if (activeSymbol) {
      try { await continuousRequest(options.siteUrl, { action: "fail", runId: options.runId, owner: options.runId, symbol: activeSymbol, reason, retryable: /rate_limited|provider_unavailable|timeout/.test(reason) }); } catch {}
    }
    try { await continuousRequest(options.siteUrl, { action: "finish-run", runId: options.runId, reason }); } catch {}
    throw new Error(reason);
  }
}

async function main() {
  const options = parseRunnerArgs(process.argv.slice(2));
  const result = options.continuous ? await runContinuousBackfill(options) : await runBackfill(options);
  process.stdout.write(`${JSON.stringify({ event: "complete", ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: "failed", error: error instanceof Error ? error.message : "failed" })}\n`);
    process.exitCode = 1;
  });
}
