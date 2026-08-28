const REQUIRED_DATES = [
  "2026-07-31",
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-17",
];

const siteUrl = String(process.env.SITE_URL || "").replace(/\/$/, "");
const target = String(process.env.DEPLOYMENT_TARGET || "");
const auditSecret = String(process.env.CANDLE_CONTINUITY_AUDIT_SECRET || "");
const sitesBypassToken = String(process.env.SITES_BYPASS_TOKEN || "");
const cloudflareClientId = String(process.env.CLOUDFLARE_ACCESS_CLIENT_ID || "");
const cloudflareClientSecret = String(process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET || "");

if (!siteUrl || !["sites", "cloudflare"].includes(target) || !auditSecret) {
  throw new Error("protected_configuration_missing");
}
if (target === "sites" && !sitesBypassToken) throw new Error("sites_bypass_missing");
if (target === "cloudflare" && (!cloudflareClientId || !cloudflareClientSecret)) {
  throw new Error("cloudflare_access_missing");
}

const accessHeaders = target === "sites"
  ? { "OAI-Sites-Authorization": `Bearer ${sitesBypassToken}` }
  : {
      "CF-Access-Client-Id": cloudflareClientId,
      "CF-Access-Client-Secret": cloudflareClientSecret,
    };

async function requestJson(path, init = {}) {
  const response = await fetch(`${siteUrl}${path}`, {
    ...init,
    headers: { ...accessHeaders, ...(init.headers || {}) },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("invalid_payload");
  return payload;
}

async function auditLargan() {
  let last = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await requestJson("/api/internal/candle-continuity-audit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auditSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cursor: "3007.TW", limit: 1, acceptance: true }),
    });
    const item = Array.isArray(response.items) ? response.items[0] : null;
    if (!response.ok || item?.symbol !== "3008.TW") throw new Error("audit_contract_failed");
    last = item;
    if (item.status === "complete" && Number(item.missingSessionCount) === 0 && response.acceptance?.symbol === "3008.TW") {
      return { item, acceptance: response.acceptance };
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`audit_incomplete_${String(last?.reasonCode || last?.status || "unknown")}`);
}

function assertCandleEvidence(evidence, displayCount) {
  if (Number(evidence?.candleCount) < displayCount) throw new Error(`candle_count_${Number(evidence?.candleCount) || 0}`);
  if (JSON.stringify(evidence?.windowSessionDates) !== JSON.stringify(REQUIRED_DATES)) throw new Error("largan_date_gap");
  if (Number(evidence?.uniqueSessionDates) !== Number(evidence?.candleCount)) throw new Error("duplicate_candle_date");
  if (evidence?.continuityStatus !== "complete" || Number(evidence?.missingSessionCount) !== 0) {
    throw new Error("continuity_not_complete");
  }
  if (evidence?.verificationStatus !== "verified" || !["close", "ohlcv"].includes(evidence?.verificationScope)) {
    throw new Error("verification_scope_failed");
  }
  return {
    count: evidence.candleCount,
    first: evidence.firstSessionDate,
    last: evidence.lastSessionDate,
    cacheState: String(evidence.cacheState || "none"),
    cacheStore: String(evidence.cacheStore || "none"),
    verificationScope: evidence.verificationScope,
  };
}

const audit = await auditLargan();
const summary160 = assertCandleEvidence(audit.acceptance.display160.first, 160);
const reused160 = assertCandleEvidence(audit.acceptance.display160.repeat, 160);
const summary320 = assertCandleEvidence(audit.acceptance.display320.first, 320);
const reused320 = assertCandleEvidence(audit.acceptance.display320.repeat, 320);
if (reused160.cacheState !== "hit" || reused320.cacheState !== "hit") throw new Error("cache_not_reused");

const health = await requestJson("/api/health");
const expectedHealthTarget = target === "sites" ? "codex-sites" : "cloudflare";
if (health.ok !== true || health.deploymentTarget !== expectedHealthTarget) throw new Error("health_target_failed");
const healthItem = Array.isArray(health?.dailyCandleContinuity?.items)
  ? health.dailyCandleContinuity.items.find((item) => item.symbol === "3008.TW")
  : null;
if (healthItem?.continuityStatus !== "complete" || Number(healthItem?.missingSessionCount) !== 0) {
  throw new Error("health_continuity_failed");
}

console.log([
  `daily-candle-acceptance target=${target}`,
  `symbol=3008.TW`,
  `audit=${audit.item.status}`,
  `missing=${audit.item.missingSessionCount}`,
  `verifiedThrough=${audit.item.verifiedThrough}`,
  `dates=${REQUIRED_DATES.length}`,
  `range160=${summary160.first}:${summary160.last}:${summary160.count}`,
  `cache160=${reused160.cacheState}/${reused160.cacheStore}`,
  `range320=${summary320.first}:${summary320.last}:${summary320.count}`,
  `cache320=${reused320.cacheState}/${reused320.cacheStore}`,
  `verification=${reused320.verificationScope}`,
  `health=${healthItem.continuityStatus}`,
].join(" "));
