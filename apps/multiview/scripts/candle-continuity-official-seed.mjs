export function recentOfficialMonths(count = 18, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }).reverse();
}

async function officialPayload(symbol, month, fetchImpl = fetch) {
  const code = symbol.split(".")[0];
  const url = symbol.endsWith(".TWO")
    ? `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${encodeURIComponent(code)}&date=${month.replace("-", "/")}/01&id=&response=json`
    : `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${month.replace("-", "")}01&stockNo=${encodeURIComponent(code)}&response=json`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 CodexSites MultiChart" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) return response.json();
    if (attempt || (response.status !== 429 && response.status < 500)) {
      throw new Error(response.status === 429 ? "rate_limited" : "provider_unavailable");
    }
  }
  throw new Error("provider_unavailable");
}

export async function seedTaiwanOfficialMonths({ symbol, requestJson, fetchImpl = fetch, months = recentOfficialMonths() }) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const uniqueMonths = [...new Set(months)];
  if (!/^\d{4,8}\.(?:TW|TWO)$/.test(normalizedSymbol) || uniqueMonths.length < 1 || uniqueMonths.length > 18) {
    throw new Error("official_seed_invalid");
  }
  const entries = [];
  for (let index = 0; index < uniqueMonths.length; index += 2) {
    const fetched = await Promise.all(uniqueMonths.slice(index, index + 2).map(async (month) => ({
      month,
      payload: await officialPayload(normalizedSymbol, month, fetchImpl),
    })));
    entries.push(...fetched);
  }
  let cached = 0;
  for (let index = 0; index < entries.length; index += 6) {
    const batch = entries.slice(index, index + 6);
    const finalize = index + batch.length >= entries.length;
    const response = await requestJson("/api/internal/candle-continuity-audit", {
      method: "POST",
      body: JSON.stringify({ action: "acceptance-cache-official-months", symbol: normalizedSymbol, months: batch, finalize }),
    });
    if (response.ok !== true || response.symbol !== normalizedSymbol || Number(response.cached) !== batch.length) {
      throw new Error("official_seed_failed");
    }
    cached += batch.length;
  }
  return { symbol: normalizedSymbol, cached };
}
