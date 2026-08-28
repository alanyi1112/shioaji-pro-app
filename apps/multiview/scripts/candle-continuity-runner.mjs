import { seedTaiwanOfficialMonths } from "./candle-continuity-official-seed.mjs";

const siteUrl = String(process.env.SITE_URL || "").replace(/\/$/, "");
const deploymentTarget = String(process.env.DEPLOYMENT_TARGET || "");
const auditSecret = String(process.env.CANDLE_CONTINUITY_AUDIT_SECRET || "");
const sitesBypassToken = String(process.env.SITES_BYPASS_TOKEN || "");
const cloudflareClientId = String(process.env.CLOUDFLARE_ACCESS_CLIENT_ID || "");
const cloudflareClientSecret = String(process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET || "");
const trigger = process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : "workflow_dispatch";
const prefix = deploymentTarget === "sites" ? "sites" : "cloudflare";
const runId = String(process.env.RUN_ID || `${prefix}-gha-${process.env.GITHUB_RUN_ID || "local"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`);
const commitSha = String(process.env.GITHUB_SHA || "");
const maximumTicks = 60;
const deadline = Date.now() + 15 * 60 * 1000;

if (!siteUrl || !["sites", "cloudflare"].includes(deploymentTarget) || !auditSecret) throw new Error("protected_configuration_missing");
if (deploymentTarget === "sites" && !sitesBypassToken) throw new Error("sites_bypass_missing");
if (deploymentTarget === "cloudflare" && (!cloudflareClientId || !cloudflareClientSecret)) throw new Error("cloudflare_access_missing");
if (!new RegExp(`^${prefix}-`).test(runId)) throw new Error("run_id_target_mismatch");

const accessHeaders = deploymentTarget === "sites"
  ? { "OAI-Sites-Authorization": `Bearer ${sitesBypassToken}` }
  : { "CF-Access-Client-Id": cloudflareClientId, "CF-Access-Client-Secret": cloudflareClientSecret };
const protectedHeaders = {
  ...accessHeaders,
  "X-MultiChart-Pipeline-Authorization": `Bearer ${auditSecret}`,
  "Content-Type": "application/json",
};

async function requestJson(path, init = {}) {
  const response = await fetch(`${siteUrl}${path}`, {
    ...init,
    headers: { ...accessHeaders, ...(init.headers || {}) },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "rate_limited" : `http_${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("invalid_response");
  return payload;
}

function validateSummary(payload) {
  const summary = payload?.summary;
  const counts = summary?.counts;
  if (payload?.ok !== true || typeof payload?.done !== "boolean" || !summary || typeof summary !== "object" || !counts || typeof counts !== "object") throw new Error("invalid_response");
  if (summary.runId !== runId || summary.deploymentTarget !== deploymentTarget || summary.trigger !== trigger) throw new Error("target_mismatch");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(summary.expectedSession || ""))) throw new Error("invalid_response");
  if (!["running", "retry_waiting", "completed", "failed"].includes(summary.status)) throw new Error("invalid_response");
  for (const key of ["target", "processed", "remaining", "complete", "partial", "unknown", "failed", "overdue"]) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0) throw new Error("invalid_response");
  }
  return summary;
}

function safeLine(summary, tick) {
  const counts = summary.counts;
  const reason = ["audit_failed", "audit_request_budget", "d1_unavailable", "invalid_response", "provider_unavailable", "rate_limited", "reference_not_published", "storage_unavailable", "tick_limit_exceeded", "timeout"].includes(summary.reasonCode) ? summary.reasonCode : "none";
  return `candle-continuity tick=${tick} target=${summary.deploymentTarget} run=${summary.runId} session=${summary.expectedSession} status=${summary.status} processed=${counts.processed} remaining=${counts.remaining} complete=${counts.complete} partial=${counts.partial} unknown=${counts.unknown} failed=${counts.failed} overdue=${counts.overdue} reason=${reason}`;
}

async function orchestrator(action, reasonCode, extra = {}) {
  return requestJson("/api/internal/candle-continuity-audit", {
    method: "POST",
    headers: protectedHeaders,
    body: JSON.stringify({ action, runId, trigger, owner: `${runId.slice(0, 100)}:gha`, ...extra, ...(reasonCode ? { reasonCode } : {}) }),
  });
}

const seededSymbols = new Set();
const retryableOfficialReasons = new Set(["audit_request_budget", "provider_unavailable", "rate_limited", "reference_not_published", "timeout"]);

async function seedRetryableOfficialItem(payload) {
  const item = payload?.item || (Array.isArray(payload?.items) ? payload.items[0] : null);
  const symbol = String(item?.symbol || "").trim().toUpperCase();
  const retryable = !item?.reasonCode || retryableOfficialReasons.has(String(item.reasonCode));
  if (!/^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(symbol) || !retryable || seededSymbols.has(symbol)) return false;
  await seedTaiwanOfficialMonths({ symbol, requestJson: (path, init) => requestJson(path, { ...init, headers: protectedHeaders }) });
  seededSymbols.add(symbol);
  console.log(`candle-continuity official-seed target=${deploymentTarget} status=complete months=18`);
  return true;
}

function safeFailure(error) {
  const raw = String(error instanceof Error ? error.message : error || "");
  if (/429|rate.?limit/.test(raw)) return "rate_limited";
  if (/timeout|abort/.test(raw)) return "timeout";
  if (/invalid|mismatch/.test(raw)) return "invalid_response";
  return "provider_unavailable";
}

let cleanup = true;
let summary;
try {
  const started = await orchestrator("orchestrator-start");
  summary = validateSummary(started);
  console.log(safeLine(summary, "start"));
  let done = started.done;
  for (let tick = 1; !done && tick <= maximumTicks && Date.now() < deadline; tick += 1) {
    const peeked = await orchestrator("orchestrator-peek");
    validateSummary(peeked);
    const seededBeforeTick = await seedRetryableOfficialItem(peeked);
    const response = await orchestrator("orchestrator-tick", undefined, { preferPersisted: seededBeforeTick });
    summary = validateSummary(response);
    console.log(safeLine(summary, tick));
    const seeded = seededBeforeTick || await seedRetryableOfficialItem(response);
    done = response.done;
    const auditedItem = Array.isArray(response.items) && response.items.length > 0;
    if (!done) await new Promise((resolve) => setTimeout(resolve, summary.status === "retry_waiting" && !seeded && !auditedItem ? 60_000 : 250));
  }
  if (!done) throw new Error("tick_limit_exceeded");
  if (summary.status !== "completed" || summary.counts.remaining !== 0 || summary.counts.failed !== 0 || summary.counts.overdue !== 0) throw new Error("invalid_response");

  const health = await requestJson("/api/health");
  const automation = health?.continuityAudit?.automation;
  const expectedTarget = deploymentTarget === "sites" ? "codex-sites" : "cloudflare";
  if (health?.ok !== true || health?.deploymentTarget !== expectedTarget || automation?.latestRun?.runId !== runId || automation?.latestRun?.deploymentTarget !== deploymentTarget || automation?.latestRun?.expectedSession !== summary.expectedSession || automation?.latestRun?.status !== "completed") throw new Error("health_contract_failed");
  if (commitSha && (health?.commitSha !== commitSha || automation?.latestRun?.commitSha !== commitSha)) throw new Error("commit_sha_mismatch");
  if (Number(automation?.latestRun?.counts?.remaining) !== 0 || Number(automation?.latestRun?.counts?.failed) !== 0 || Number(automation?.latestRun?.counts?.overdue) !== 0) throw new Error("health_sla_failed");
  cleanup = false;
  console.log(`candle-continuity-health target=${deploymentTarget} run=${runId} session=${summary.expectedSession} commit=${commitSha || "unknown"} status=healthy`);
} catch (error) {
  const reason = safeFailure(error);
  if (cleanup) {
    try {
      const failed = await orchestrator("orchestrator-fail", reason);
      const failedSummary = validateSummary(failed);
      console.log(safeLine(failedSummary, "cleanup"));
    } catch {
      console.log(`candle-continuity tick=cleanup target=${deploymentTarget} run=${runId} status=cleanup_failed reason=${reason}`);
    }
  }
  throw new Error(reason);
}
