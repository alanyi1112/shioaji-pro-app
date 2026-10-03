import { parseTdccSnapshot, type DistributionRow } from "./taiwan-stock-chip.ts";

export const TDCC_LATEST_SOURCES = Object.freeze({
  csv: "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5",
  openapi: "https://openapi.tdcc.com.tw/v1/opendata/1-5",
});

type SourceName = keyof typeof TDCC_LATEST_SOURCES;
type Candidate = { source: SourceName; payload: Record<string, string>[]; rows: DistributionRow[]; dataDate: string };

function taipeiDate(now: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function csvCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (!cell || quoted) quoted = !quoted;
      else throw new Error("invalid_response");
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("invalid_response");
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export function parseTdccLatestCsv(text: string): Record<string, string>[] {
  const [header, ...rows] = csvCells(text.replace(/^\uFEFF/, ""));
  const expected = ["資料日期", "證券代號", "持股分級", "人數", "股數", "占集保庫存數比例%"];
  if (!header || header.length !== expected.length || header.some((name, index) => name.trim() !== expected[index])) throw new Error("invalid_response");
  if (rows.length < 1000 || rows.length > 250000 || rows.length % 17 !== 0) throw new Error("invalid_response");
  return rows.map((cells) => {
    if (cells.length !== expected.length) throw new Error("invalid_response");
    return Object.fromEntries(expected.map((name, index) => [name, cells[index]]));
  });
}

function candidate(source: SourceName, payload: unknown, eligibleSymbols: ReadonlySet<string>, now: Date): Candidate {
  if (!Array.isArray(payload) || payload.length < 1000 || payload.length > 250000 || payload.length % 17 !== 0) throw new Error("invalid_response");
  const dates = new Set<string>();
  for (const item of payload) {
    if (!item || typeof item !== "object") throw new Error("invalid_response");
    const record = item as Record<string, unknown>;
    const date = String(record["資料日期"] ?? record["\uFEFF資料日期"] ?? "").trim();
    if (!/^\d{8}$/.test(date)) throw new Error("invalid_response");
    dates.add(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`);
  }
  if (dates.size !== 1) throw new Error("invalid_response");
  const dataDate = [...dates][0];
  if (Number.isNaN(Date.parse(`${dataDate}T00:00:00Z`)) || dataDate > taipeiDate(now)) throw new Error("invalid_response");
  const rows = parseTdccSnapshot(payload, eligibleSymbols, now.toISOString());
  if (rows.length !== eligibleSymbols.size || rows.some((row) => row.dataDate !== dataDate)) throw new Error("invalid_response");
  return { source, payload: payload as Record<string, string>[], rows, dataDate };
}

async function fetchCandidate(source: SourceName, eligibleSymbols: ReadonlySet<string>, fetchImpl: typeof fetch, now: Date, timeoutMs: number): Promise<Candidate> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(TDCC_LATEST_SOURCES[source], {
      signal: controller.signal,
      headers: { accept: source === "csv" ? "text/csv" : "application/json" },
    });
    if (response.status === 429) throw new Error("rate_limited");
    if (!response.ok) throw new Error("provider_unavailable");
    const maxBytes = source === "csv" ? 8_000_000 : 24_000_000;
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) throw new Error("invalid_response");
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("invalid_response");
    return candidate(source, source === "csv" ? parseTdccLatestCsv(raw) : JSON.parse(raw), eligibleSymbols, now);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("timeout");
    throw error;
  } finally { clearTimeout(timeout); }
}

function material(rows: DistributionRow[]) {
  const values = (level: DistributionRow["total"]) => [level.level, level.holders, level.shares, level.ratioPercent];
  return JSON.stringify(rows.map((row) => [row.symbol, row.levels.map(values), values(row.adjustment), values(row.total)]));
}

export async function fetchTdccLatestOfficial(input: {
  eligibleSymbols: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
}) {
  if (!input.eligibleSymbols.size) throw new Error("invalid_response");
  const now = input.now ?? new Date();
  const outcomes = await Promise.allSettled((["csv", "openapi"] as const).map((source) =>
    fetchCandidate(source, input.eligibleSymbols, input.fetchImpl ?? fetch, now, input.timeoutMs ?? 30_000)));
  const candidates = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
  const failures = Object.fromEntries(outcomes.flatMap((outcome, index) => outcome.status === "rejected"
    ? [[(["csv", "openapi"] as const)[index], outcome.reason instanceof Error ? outcome.reason.message : "invalid_response"]]
    : []));
  if (!candidates.length) {
    const reasons = Object.values(failures);
    throw new Error(reasons.includes("rate_limited") ? "rate_limited" : reasons.includes("invalid_response") ? "invalid_response" : reasons.includes("timeout") ? "timeout" : "provider_unavailable");
  }
  const [first, second] = candidates;
  if (second && first.dataDate === second.dataDate && material(first.rows) !== material(second.rows)) throw new Error("source_conflict");
  const selected = second && second.dataDate > first.dataDate ? second : first;
  return { ...selected, observedDates: Object.fromEntries(candidates.map((item) => [item.source, item.dataDate])), failures };
}
