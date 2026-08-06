#!/usr/bin/env node

import {
  PE_RIVER_MAX_HISTORY_TARGETS,
  fetchFinMindPeHistory,
  fetchOfficialPeDailySnapshot,
  verifyProviderOverlap,
} from "../worker/pe-river-data-pipeline.ts";

const DEFAULT_SITE_URL = "https://quote-chart-multiview.alanyi1112.chatgpt.site";
const PROTECTED_POST_TIMEOUT_MS = 90_000;
const SAFE_REASONS = new Set(["rate_limit_waiting", "provider_unavailable", "schema_mismatch", "source_mismatch", "official_not_published", "invalid_payload", "not_eligible"]);

export function parsePeRiverRunnerArgs(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--") || !argument.includes("=")) throw new Error("invalid_payload");
    const [key, ...rest] = argument.slice(2).split("=");
    values.set(key, rest.join("="));
  }
  return {
    siteUrl: String(values.get("site-url") || DEFAULT_SITE_URL).replace(/\/$/, ""),
    trigger: values.get("trigger") === "schedule" ? "schedule" : "workflow_dispatch",
    runId: values.get("run-id") || `pe-river-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`,
  };
}

export function safePeRiverRunnerError(value) {
  const message = String(value instanceof Error ? value.message : value || "invalid_payload");
  if (SAFE_REASONS.has(message)) return message;
  if (/402|429|rate.?limit/i.test(message)) return "rate_limit_waiting";
  if (/timeout|fetch|network|5\d\d/i.test(message)) return "provider_unavailable";
  if (/schema|payload/i.test(message)) return "schema_mismatch";
  return "invalid_payload";
}

function isLoopbackSite(siteUrl) {
  const url = new URL(siteUrl);
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

function protectedHeaders(secretName, siteUrl) {
  const secret = process.env[secretName]?.trim();
  const sitesToken = process.env.SITES_BYPASS_TOKEN?.trim();
  const accessClientId = process.env.CLOUDFLARE_ACCESS_CLIENT_ID?.trim();
  const accessClientSecret = process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET?.trim();
  if (!secret) throw new Error("invalid_payload");
  if (isLoopbackSite(siteUrl)) return { "content-type": "application/json", "X-MultiChart-Pipeline-Authorization": `Bearer ${secret}` };
  if (!sitesToken && (!accessClientId || !accessClientSecret)) throw new Error("invalid_payload");
  return {
    "content-type": "application/json",
    ...(sitesToken
      ? { authorization: `Bearer ${secret}`, "OAI-Sites-Authorization": `Bearer ${sitesToken}` }
      : {
          "X-MultiChart-Pipeline-Authorization": `Bearer ${secret}`,
          "CF-Access-Client-Id": accessClientId,
          "CF-Access-Client-Secret": accessClientSecret,
        }),
  };
}

async function postJson(url, headers, body, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(PROTECTED_POST_TIMEOUT_MS) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.reasonCode || `provider_unavailable`);
  return payload;
}

function groupByMonth(rows) {
  const groups = new Map();
  for (const row of rows) {
    const month = row.sessionDate.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(row);
  }
  return groups;
}

const sourceDate = (rows) => rows.reduce((latest, row) => row.sessionDate > latest ? row.sessionDate : latest, "") || null;

function ingestRow(row) {
  return {
    sessionDate: row.sessionDate,
    officialClose: row.officialClose,
    officialPeRatio: row.officialPeRatio,
    fiscalYear: row.fiscalYear,
    fiscalQuarter: row.fiscalQuarter,
    source: row.source,
    provider: row.provider,
    validationStatus: row.validationStatus,
    officialOverlapDate: row.officialOverlapDate,
    sourceDate: row.sourceDate,
  };
}

export async function runPeRiverContinuous(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const controlUrl = `${options.siteUrl}/api/internal/pe-river-continuous-backfill`;
  const ingestUrl = `${options.siteUrl}/api/internal/taiwan-stock-pe-river`;
  const controlHeaders = dependencies.controlHeaders || protectedHeaders("PE_RIVER_BACKFILL_SECRET", options.siteUrl);
  const ingestHeaders = dependencies.ingestHeaders || protectedHeaders("PE_RIVER_INGEST_SECRET", options.siteUrl);
  const start = await postJson(controlUrl, controlHeaders, { action: "start", runId: options.runId, trigger: options.trigger }, fetchImpl);
  if (start.order?.join(",") !== "latest,history" || (start.history || []).length > PE_RIVER_MAX_HISTORY_TARGETS) throw new Error("invalid_payload");

  const latest = await postJson(controlUrl, controlHeaders, { action: "latest-refresh", runId: options.runId }, fetchImpl);
  const snapshots = new Map(["TWSE", "TPEx"].map((exchange) => [exchange, (latest.rows || []).filter((row) => row.exchange === exchange)]));
  let latestAccepted = Number(latest.accepted || 0);
  const provisionalAccepted = Number(latest.provisionalAccepted || 0);
  let fallbackAccepted = 0;
  const active = new Set((start.latest || []).map((target) => target.symbol));
  for (const exchange of ["TWSE", "TPEx"]) {
    if (snapshots.get(exchange)?.length || !latest.failures?.[exchange]) continue;
    try {
      const rows = (await fetchOfficialPeDailySnapshot(exchange, fetchImpl)).filter((row) => active.has(row.symbol));
      snapshots.set(exchange, rows);
      for (const row of rows) await postJson(ingestUrl, ingestHeaders, { symbol: row.symbol, month: row.sessionDate.slice(0, 7), rows: [ingestRow(row)] }, fetchImpl);
      latestAccepted += rows.length;
      fallbackAccepted += rows.length;
      process.stdout.write(`${JSON.stringify({ event: "latest-official-fallback", exchange, accepted: rows.length })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ event: "latest-provider-pending", exchange, reasonCode: safePeRiverRunnerError(error) })}\n`);
    }
  }
  if (fallbackAccepted) await postJson(controlUrl, controlHeaders, { action: "latest-complete", runId: options.runId, twseSourceDate: sourceDate(snapshots.get("TWSE") || []), tpexSourceDate: sourceDate(snapshots.get("TPEx") || []) }, fetchImpl);

  let historyCompleted = 0;
  let historyFailed = 0;
  for (const target of start.history || []) {
    try {
      const fetchHistory = dependencies.fetchHistory || fetchFinMindPeHistory;
      const history = await fetchHistory({ symbol: target.symbol, startDate: target.startDate, endDate: target.endDate, fetchImpl });
      const official = (snapshots.get(target.exchange) || []).filter((row) => row.symbol === target.symbol);
      const verification = verifyProviderOverlap(history.rows, official);
      if (verification.status === "source_mismatch") throw new Error("source_mismatch");
      const verifiedRows = history.rows.map((row) => ({ ...row, validationStatus: verification.status === "finmind_overlap_verified" ? "finmind_overlap_verified" : "finmind_pending_verification", officialOverlapDate: verification.overlapDate || null }));
      const pendingMonths = new Set(Array.isArray(target.months) ? target.months : []);
      for (const [month, rows] of groupByMonth(verifiedRows)) {
        if (pendingMonths.size && !pendingMonths.has(month)) continue;
        await postJson(ingestUrl, ingestHeaders, { symbol: target.symbol, month, rows: rows.map(ingestRow) }, fetchImpl);
      }
      for (const officialRow of official) await postJson(ingestUrl, ingestHeaders, { symbol: target.symbol, month: officialRow.sessionDate.slice(0, 7), rows: [ingestRow(officialRow)] }, fetchImpl);
      await postJson(controlUrl, controlHeaders, { action: "history-complete", runId: options.runId, jobId: target.jobId, symbol: target.symbol, validationStatus: verification.status, overlapDate: verification.overlapDate }, fetchImpl);
      historyCompleted += 1;
      process.stdout.write(`${JSON.stringify({ event: "history-complete", symbol: target.symbol, rows: verifiedRows.length, validationStatus: verification.status })}\n`);
    } catch (error) {
      const reasonCode = safePeRiverRunnerError(error);
      await postJson(controlUrl, controlHeaders, { action: "history-failed", runId: options.runId, jobId: target.jobId, attempt: target.attempt, reasonCode }, fetchImpl).catch(() => {});
      historyFailed += 1;
      process.stdout.write(`${JSON.stringify({ event: "history-failed", symbol: target.symbol, reasonCode })}\n`);
      if (reasonCode === "rate_limit_waiting") break;
    }
  }
  return { runId: options.runId, latestAccepted, provisionalAccepted, fallbackAccepted, historyClaimed: (start.history || []).length, historyCompleted, historyFailed, budget: start.budget };
}

export async function runPeRiverTargets(targets, dependencies = {}) {
  if (!Array.isArray(targets) || !targets.length) throw new Error("invalid_payload");
  const sourcePayloads = new Map();
  let sourceDownloads = 0;
  const fetchHistory = async (input) => {
    const key = `${input.symbol}|${input.startDate}|${input.endDate}`;
    if (!sourcePayloads.has(key)) {
      sourceDownloads += 1;
      const loader = dependencies.fetchHistory || fetchFinMindPeHistory;
      sourcePayloads.set(key, Promise.resolve(loader(input)));
    }
    return sourcePayloads.get(key);
  };
  const summaries = [];
  for (const [index, target] of targets.entries()) {
    const targetId = String(target.targetId || `target-${index + 1}`);
    try {
      const summary = await runPeRiverContinuous(target, {
        ...dependencies,
        fetchHistory,
        controlHeaders: target.controlHeaders || dependencies.controlHeaders,
        ingestHeaders: target.ingestHeaders || dependencies.ingestHeaders,
      });
      summaries.push({ targetId, status: summary.historyFailed ? "partial" : "completed", ...summary });
    } catch (error) {
      summaries.push({ targetId, status: "failed", reasonCode: safePeRiverRunnerError(error) });
    }
  }
  return {
    targetCount: targets.length,
    completedTargets: summaries.filter((item) => item.status === "completed").length,
    partialTargets: summaries.filter((item) => item.status === "partial").length,
    failedTargets: summaries.filter((item) => item.status === "failed").length,
    sourceDownloads,
    targets: summaries,
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runPeRiverContinuous(parsePeRiverRunnerArgs(process.argv.slice(2)))
    .then((summary) => process.stdout.write(`${JSON.stringify({ event: "pe-river-run-complete", ...summary })}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ event: "pe-river-run-failed", reasonCode: safePeRiverRunnerError(error) })}\n`);
      process.exitCode = 1;
    });
}
