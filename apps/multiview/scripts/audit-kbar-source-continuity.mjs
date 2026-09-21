#!/usr/bin/env node

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = option("base-url", "http://127.0.0.1:5174").replace(/\/$/, "");
const date = option("date", new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date()));
const symbols = option("symbols", "00918.TW,2330.TW,6146.TWO")
  .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
const intervals = ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"];
const minuteContracts = {
  "1m": { seconds: 60, first: "09:00", last: "13:29", rows: 270 },
  "5m": { seconds: 300, first: "09:00", last: "13:25", rows: 54 },
  "15m": { seconds: 900, first: "09:00", last: "13:15", rows: 18 },
  "1h": { seconds: 3600, first: "09:00", last: "13:00", rows: 5 },
};

function taipeiDateTime(seconds) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(seconds * 1000)).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

async function jsonRequest(path, init) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(payload?.reasonCode || payload?.error || `http_${response.status}`));
  return payload;
}

function summarizeRows(rows, continuity) {
  return {
    rows: rows.length,
    first: rows[0]?.time ? taipeiDateTime(Number(rows[0].time)) : null,
    last: rows.at(-1)?.time ? taipeiDateTime(Number(rows.at(-1).time)) : null,
    continuity: continuity?.status || "unknown",
    reasonCode: continuity?.reasonCode || null,
    missingSessionDates: continuity?.missingSessionDates || [],
    missingBoundaryIntervals: continuity?.missingBoundaryIntervals || [],
  };
}

function aggregateMinuteRows(rows, interval) {
  const seconds = minuteContracts[interval].seconds;
  return [...new Map(rows.map((row) => [Math.floor(row.time / seconds) * seconds, row])).keys()]
    .sort((left, right) => left - right)
    .map((time) => ({ time }));
}

function localContinuity(rows, interval) {
  const contract = minuteContracts[interval];
  if (!rows.length) return { status: "unknown", reasonCode: "source_not_returned" };
  const first = taipeiDateTime(rows[0].time).slice(-5);
  const last = taipeiDateTime(rows.at(-1).time).slice(-5);
  const complete = first === contract.first && last === contract.last && rows.length === contract.rows;
  return {
    status: complete ? "complete" : "partial",
    reasonCode: complete ? null : first !== contract.first || last !== contract.last
      ? "intraday_boundary_gap" : "intraday_sparse_or_no_trade",
    expected: contract,
    actual: { first, last, rows: rows.length },
  };
}

async function auditYahoo(symbol) {
  const result = {};
  for (const interval of intervals) {
    try {
      const payload = await jsonRequest(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&display_count=1600`);
      result[interval] = summarizeRows(payload.candles || [], payload.dataQuality?.continuity || payload.dataWindow?.continuity);
      result[interval].sourceProvider = payload.quote?.sourceProvider || null;
    } catch (error) {
      result[interval] = { error: String(error?.message || error) };
    }
  }
  return result;
}

async function auditShioaji(symbol) {
  const code = symbol.split(".")[0];
  const contract = await jsonRequest(`/local-shioaji/api/v1/data/contracts/${encodeURIComponent(code)}?region=TW`);
  const payload = await jsonRequest("/local-shioaji/api/v1/data/kbars", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contract: {
        security_type: contract.security_type,
        region: "TW",
        exchange: contract.exchange,
        code: String(contract.code),
        target_code: contract.target_code || null,
      },
      start: date,
      end: date,
    }),
  });
  const raw = Array.isArray(payload?.datetime) ? payload.datetime : [];
  const canonical = raw.flatMap((value) => {
    const sourceTime = Date.parse(`${String(value).replace(" ", "T")}+08:00`);
    return Number.isFinite(sourceTime) ? [{ time: Math.floor(sourceTime / 1000) - 60, sourceTime }] : [];
  }).sort((left, right) => left.time - right.time);
  const result = {};
  for (const interval of Object.keys(minuteContracts)) {
    const rows = interval === "1m" ? canonical : aggregateMinuteRows(canonical, interval);
    result[interval] = {
      ...summarizeRows(rows, localContinuity(rows, interval)),
      ...localContinuity(rows, interval),
      sourceProvider: "shioaji-kbars",
      rawFirst: raw[0] || null,
      rawLast: raw.at(-1) || null,
    };
  }
  const daily = canonical.length ? [{ time: Date.parse(`${date}T00:00:00+08:00`) / 1000 }] : [];
  result["1d"] = { ...summarizeRows(daily, { status: daily.length ? "complete" : "unknown" }), sourceProvider: "shioaji-kbars" };
  result["1wk"] = { rows: null, continuity: "not_applicable", reasonCode: "canonical_daily_base_required", sourceProvider: null };
  result["1mo"] = { rows: null, continuity: "not_applicable", reasonCode: "canonical_daily_base_required", sourceProvider: null };
  return result;
}

const report = {
  schemaVersion: "multiview-kbar-source-continuity-audit/1",
  generatedAt: new Date().toISOString(),
  baseUrl,
  date,
  symbols: [],
};

for (const symbol of symbols) {
  const yahoo = await auditYahoo(symbol);
  let shioaji;
  try {
    shioaji = await auditShioaji(symbol);
  } catch (error) {
    shioaji = { error: String(error?.message || error) };
  }
  const automatic = Object.fromEntries(intervals.map((interval) => {
    const local = shioaji?.[interval];
    const selected = local?.continuity === "complete" ? local : yahoo[interval];
    return [interval, {
      selectedSource: selected?.sourceProvider || null,
      continuity: selected?.continuity || "unknown",
      reasonCode: selected?.reasonCode || null,
    }];
  }));
  report.symbols.push({ symbol, yahoo, shioaji, automatic });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
