import { seedTaiwanOfficialMonths } from "./candle-continuity-official-seed.mjs";

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
const representativeSymbols = String(process.env.CANDLE_CONTINUITY_REPRESENTATIVE_SYMBOLS || "3008.TW,5483.TWO,0050.TW,4768.TWO")
  .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);

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
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const reason = typeof failure?.reasonCode === "string" ? failure.reasonCode : "unknown";
    throw new Error(`http_${response.status}_${reason}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("invalid_payload");
  return payload;
}

if (representativeSymbols.length !== 4 || !representativeSymbols.includes("3008.TW") || !representativeSymbols.some((symbol) => symbol.endsWith(".TWO"))) {
  throw new Error("representative_symbols_invalid");
}

async function auditRepresentatives() {
  const items = [];
  const acceptance = [];
  for (const symbol of representativeSymbols) {
    let responseAcceptance = null;
    try {
      responseAcceptance = await requestAcceptance(symbol);
    } catch (error) {
      if (!/^http_5\d\d_/.test(String(error instanceof Error ? error.message : error))) throw error;
    }
    if (responseAcceptance) {
      acceptance.push(responseAcceptance);
      items.push(auditItemFromAcceptance(responseAcceptance));
      continue;
    }
    await seedTaiwanOfficialMonths({ symbol, requestJson: protectedRequestJson });
    let last = null;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await requestJson("/api/internal/candle-continuity-audit", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auditSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ symbols: [symbol], limit: 1, acceptancePreparation: true }),
      });
      const responseItems = Array.isArray(response.items) ? response.items : [];
      if (!response.ok || responseItems.length !== 1 || responseItems[0].symbol !== symbol) {
        throw new Error("audit_contract_failed");
      }
      last = responseItems[0];
      if (last.status === "complete" && Number(last.missingSessionCount) === 0) {
        items.push(last);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    if (items.at(-1)?.symbol !== symbol) throw new Error(`audit_incomplete_${String(last?.reasonCode || "unknown")}`);
    responseAcceptance = await requestAcceptance(symbol);
    acceptance.push(responseAcceptance);
  }
  return { items, acceptance };
}

function protectedRequestJson(path, init = {}) {
  return requestJson(path, {
    ...init,
    headers: { Authorization: `Bearer ${auditSecret}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

async function requestAcceptance(symbol) {
  const response = await requestJson("/api/internal/candle-continuity-audit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auditSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbols: [symbol], limit: 1, acceptance: true }),
  });
  const values = Array.isArray(response.acceptance) ? response.acceptance : response.acceptance ? [response.acceptance] : [];
  if (!response.ok || values.length !== 1 || values[0].symbol !== symbol) throw new Error("acceptance_contract_failed");
  return values[0];
}

function auditItemFromAcceptance(acceptance) {
  const evidence = acceptance?.display320?.repeat;
  return {
    symbol: acceptance?.symbol,
    status: evidence?.continuityStatus,
    missingSessionCount: Number(evidence?.missingSessionCount) || 0,
    verifiedThrough: evidence?.verifiedThrough || null,
    checkedAt: evidence?.checkedAt || null,
    reasonCode: evidence?.continuityStatus === "complete" ? null : "continuity_unverified",
  };
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

const audit = await auditRepresentatives();
const evidenceBySymbol = new Map();
for (const acceptance of audit.acceptance) {
  const summary160 = assertCandleEvidence(acceptance.display160.first, 160);
  const reused160 = assertCandleEvidence(acceptance.display160.repeat, 160);
  const summary320 = assertCandleEvidence(acceptance.display320.first, 320);
  const reused320 = assertCandleEvidence(acceptance.display320.repeat, 320);
  if (reused160.cacheState !== "hit" || reused320.cacheState !== "hit") throw new Error(`cache_not_reused_${acceptance.symbol}`);
  evidenceBySymbol.set(acceptance.symbol, { summary160, reused160, summary320, reused320 });
}
const largan = audit.items.find((item) => item.symbol === "3008.TW");
const larganEvidence = evidenceBySymbol.get("3008.TW");

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
  `symbols=${representativeSymbols.join(",")}`,
  `audit=${audit.items.map((item) => `${item.symbol}:${item.status}`).join(",")}`,
  `missing=${audit.items.reduce((sum, item) => sum + Number(item.missingSessionCount || 0), 0)}`,
  `verifiedThrough=${largan?.verifiedThrough}`,
  `dates=${REQUIRED_DATES.length}`,
  `range160=${larganEvidence.summary160.first}:${larganEvidence.summary160.last}:${larganEvidence.summary160.count}`,
  `cache160=${larganEvidence.reused160.cacheState}/${larganEvidence.reused160.cacheStore}`,
  `range320=${larganEvidence.summary320.first}:${larganEvidence.summary320.last}:${larganEvidence.summary320.count}`,
  `cache320=${larganEvidence.reused320.cacheState}/${larganEvidence.reused320.cacheStore}`,
  `verification=${larganEvidence.reused320.verificationScope}`,
  `health=${healthItem.continuityStatus}`,
].join(" "));
