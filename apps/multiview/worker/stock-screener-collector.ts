/** 本機底稿收集；不發布結果、不寫個人清單／TDCC 長歷史佇列、不呼叫券商。 */
import { isIsoDate, validateTdcc, type HolderPoint, type Provenance, type UniverseStock } from "../../../src/lib/stock-screener-domain.ts";
import type { ScreenerDatabase, ScreenerStatement } from "./stock-screener-repository.ts";
import { fetchScreenerSource, mergeUniverses, parseDailyVolumes, parseHolderBatch, parseUniverse, SCREENER_SOURCES, ScreenerSourceError } from "./stock-screener-sources.ts";

export type ScreenerScope = "screener-daily" | "screener-weekly";
type Receipt = { hash: string; date: string; offset: number; total: number; invalid: number; complete: boolean; invalidSymbols?: Record<string, string> };
type Checkpoint = { version: 1; day: string; attempts: number; nextAttemptAt: string; receipts: Record<string, Receipt>; reason: string };
type Run = { status: string; checkpoint: string };
const LEASE_ID = "screener-collector-lease";
const MAX_RUN_MS = 15 * 60 * 1000;
const BATCH = 50;
const NORMALIZATION = "screener-official-v1";
const inflight = new Map<string, ReturnType<typeof fetchScreenerSource>>();
const fetchFlights = new WeakMap<typeof fetch, Map<string, ReturnType<typeof fetchScreenerSource>>>();

/** A separate map per injected transport keeps tests and independent environments isolated. */
function source(url: string, fetcher: typeof fetch) {
  let flights = fetcher === fetch ? inflight : fetchFlights.get(fetcher);
  if (!flights) { flights = new Map(); fetchFlights.set(fetcher, flights); }
  const existing = flights.get(url);
  if (existing) return existing;
  const promise = fetchScreenerSource(url, fetcher).finally(() => flights!.delete(url));
  flights.set(url, promise);
  return promise;
}
const taipeiDate = (now: number) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const iso = (now: number) => new Date(now).toISOString();
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("");
const safeReason = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return /^(source_(?:http_\d{3}|timeout|too_large|not_allowed)|invalid_\w+|mixed_source_dates|duplicate_security|market_transfer_unresolved|universe_date_mismatch|lease_lost|run_deadline|source_not_closed|source_future_date)$/.test(message) ? message : "collection_failed";
};

/** Reuse only full, exact-number, official local rows; never invent missing bands. */
export async function readLocalScreenerHolders(db: ScreenerDatabase, universe: UniverseStock[], dates: string[]) {
  if (!dates.length || dates.length > 6 || dates.some(day => !isIsoDate(day))) throw new Error("invalid_reuse_dates");
  const allowed = new Set(universe.map(stock => stock.symbol));
  let rows: { symbol: string; data_date: string; levels_json: string; adjustment_json: string; total_json: string; provider: string; frequency: string; source_fetched_at: string }[];
  try {
    rows = (await db.prepare(`SELECT symbol,data_date,levels_json,adjustment_json,total_json,provider,frequency,source_fetched_at FROM taiwan_stock_shareholder_distribution WHERE data_date IN (${dates.map(() => "?").join(",")}) AND provider = 'tdcc' AND frequency = 'weekly'`).bind(...dates).all<typeof rows[number]>()).results ?? [];
  } catch (error) {
    if (/no such table.*taiwan_stock_shareholder_distribution/.test(String(error))) return [];
    throw error;
  }
  const result: { symbol: string; point: HolderPoint }[] = [];
  for (const row of rows) {
    if (!allowed.has(row.symbol) || !Number.isFinite(Date.parse(row.source_fetched_at))) continue;
    try {
      const original = [...JSON.parse(row.levels_json), JSON.parse(row.adjustment_json), JSON.parse(row.total_json)];
      // Existing tables use JSON numbers. Refuse precision loss rather than repairing it.
      if (original.some(b => !b || !Number.isSafeInteger(b.holders) || !Number.isSafeInteger(b.shares))) continue;
      const bands = original.map(b => ({ level: b.level, holders: String(b.holders), shares: String(b.shares), ratio: String(b.ratioPercent) }));
      const point: HolderPoint = { date: row.data_date, bands, provenance: { source: "TDCC", sourceUrl: "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock", fetchedAt: row.source_fetched_at,
        payloadHash: await digest(JSON.stringify({ date: row.data_date, bands })), normalizationVersion: NORMALIZATION } };
      if (validateTdcc(point) === "none") result.push({ symbol: row.symbol, point });
    } catch { /* Invalid rows remain missing for this symbol only. */ }
  }
  return result;
}

/** Called only by authenticated local maintenance. Candidate catalogs cannot authorize publication.
 * No new scheduler is installed here. Source/classification/calendar gates remain independent.
 */
export async function collectScreenerData(db: ScreenerDatabase, scope: ScreenerScope,
  options: { fetcher?: typeof fetch; clock?: () => number; previousWeek?: string; minimumUniverseRows?: { TWSE: number; TPEx: number } } = {}) {
  if (!["screener-daily", "screener-weekly"].includes(scope)) throw new Error("invalid_scope");
  if (options.previousWeek !== undefined && !isIsoDate(options.previousWeek)) throw new Error("invalid_reuse_dates");
  const clock = options.clock ?? Date.now, fetcher = options.fetcher ?? fetch;
  const started = clock(), day = taipeiDate(started), owner = crypto.randomUUID();
  const deadline = started + MAX_RUN_MS;
  // A fixed global lock serializes both scopes, so total external concurrency is at most two.
  try {
    await db.prepare("INSERT INTO screener_runs (id,scope,status,checkpoint,lease_until,updated_at) VALUES (?, 'screener-collector', 'running', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until <= ?")
      .bind(LEASE_ID, owner, iso(deadline), iso(started), iso(started)).run();
  } catch (error) {
    if (/no such table.*screener_/.test(String(error))) return { state: "pending", reason: "schema_pending" };
    throw error;
  }
  const owns = async () => (await db.prepare("SELECT checkpoint FROM screener_runs WHERE id = ?").bind(LEASE_ID).first<{ checkpoint: string }>())?.checkpoint === owner;
  if (!await owns()) return { state: "skipped", reason: "lease_busy" };
  let checkpoint: Checkpoint = { version: 1, day, attempts: 0, nextAttemptAt: iso(started), receipts: {}, reason: "none" };
  const guard = "EXISTS (SELECT 1 FROM screener_runs WHERE id = ? AND checkpoint = ? AND status = 'running' AND lease_until > ?)";
  const guardArgs = () => [LEASE_ID, owner, iso(clock())];
  const assertLive = async () => { if (clock() >= deadline) throw new Error("run_deadline"); if (!await owns()) throw new Error("lease_lost"); };
  const save = (status: string) => db.prepare(`INSERT INTO screener_runs (id,scope,status,checkpoint,updated_at) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET status=excluded.status,checkpoint=excluded.checkpoint,updated_at=excluded.updated_at`)
    .bind(scope, scope, status, JSON.stringify(checkpoint), iso(clock()), ...guardArgs());
  const checkpointBatch = async (statements: ScreenerStatement[], status = "running") => {
    await assertLive();
    await db.batch([...statements, save(status)]);
    await assertLive();
  };
  const writeRows = async (key: string, hash: string, date: string, values: [string, unknown][], invalid: number,
    create: (symbol: string, payload: string) => ScreenerStatement, invalidSymbols?: Record<string, string>) => {
    const before = checkpoint.receipts[key];
    const offset = before?.hash === hash && before.date === date && before.total === values.length ? before.offset : 0;
    const receipt: Receipt = { hash, date, offset, total: values.length, invalid, complete: false, ...(invalidSymbols ? { invalidSymbols } : {}) };
    checkpoint.receipts[key] = receipt;
    for (let index = offset; index < values.length; index += BATCH) {
      receipt.offset = Math.min(index + BATCH, values.length);
      try {
        await checkpointBatch(values.slice(index, index + BATCH).map(([symbol, point]) => create(symbol, JSON.stringify(point))));
      } catch (error) { receipt.offset = index; throw error; }
    }
    receipt.complete = true;
    await checkpointBatch([]);
  };
  const getSource = async (url: string) => { await assertLive(); const result = await source(url, fetcher); await assertLive(); return result; };
  const provenance = (provider: string, url: string, result: Awaited<ReturnType<typeof source>>): Provenance => ({ source: provider, sourceUrl: url,
    fetchedAt: result.fetchedAt, payloadHash: result.payloadHash, normalizationVersion: NORMALIZATION });
  const checkDate = (date: string, daily = false) => {
    if (date > day) throw new Error("source_future_date");
    // Conservative ingestion gate, not a claim about publication SLA or trading calendars.
    if (daily && date === day && new Date(started + 8 * 3600000).getUTCHours() < 18) throw new Error("source_not_closed");
  };
  const holderStatement = (symbol: string, payload: string) => db.prepare(`INSERT INTO screener_tdcc_weekly (symbol,data_date,payload,validation) SELECT ?,json_extract(?,'$.date'),?,'full-17' WHERE ${guard} ON CONFLICT(data_date,symbol) DO UPDATE SET payload=excluded.payload,validation=excluded.validation WHERE json_extract(excluded.payload,'$.provenance.fetchedAt') >= json_extract(screener_tdcc_weekly.payload,'$.provenance.fetchedAt')`)
    .bind(symbol, payload, payload, ...guardArgs());
  try {
    const previous = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id = ?").bind(scope).first<Run>();
    if (previous) {
      const parsed = JSON.parse(previous.checkpoint) as Checkpoint;
      if (parsed.version !== 1 || !parsed.receipts) throw new Error("invalid_checkpoint");
      checkpoint = { ...parsed, day, attempts: parsed.day === day ? parsed.attempts : 0 };
      if (Date.parse(parsed.nextAttemptAt) > started) return { state: "skipped", reason: "backoff", nextAttemptAt: parsed.nextAttemptAt };
      if (checkpoint.attempts >= 3) return { state: "skipped", reason: "retry_budget_exhausted" };
    }
    checkpoint.attempts++;
    await checkpointBatch([]);
    const urls = [SCREENER_SOURCES.TWSE.universe, SCREENER_SOURCES.TPEx.universe];
    // Drain both transports even if one fails; releasing the lease early would exceed concurrency.
    const fetched = await Promise.allSettled(urls.map(getSource));
    if (fetched[0].status === "rejected") throw fetched[0].reason;
    if (fetched[1].status === "rejected") throw fetched[1].reason;
    const catalogs = [fetched[0].value, fetched[1].value];
    const universe = mergeUniverses(parseUniverse(catalogs[0].payload, "TWSE"), parseUniverse(catalogs[1].payload, "TPEx"));
    // Real maintenance uses conservative market floors; smaller bounds are only
    // injected alongside small isolated fixtures, never from HTTP or environment.
    const minimum = options.minimumUniverseRows ?? { TWSE: 800, TPEx: 500 };
    for (const market of ["TWSE", "TPEx"] as const) if (universe.stocks.filter(stock => stock.market === market).length < minimum[market]) throw new Error("invalid_universe_coverage");
    checkDate(universe.date);
    const revision = await digest(catalogs.map(catalog => catalog.payloadHash).join("|"));
    // Classification is strict and versioned; publication additionally needs period evidence.
    await writeRows("catalog", revision, universe.date, universe.stocks.map(stock => [stock.symbol, { stock, review: "verified", revision, sourceDate: universe.dates[stock.market],
      provenance: provenance(stock.market, urls[stock.market === "TWSE" ? 0 : 1], catalogs[stock.market === "TWSE" ? 0 : 1]) }]), 0,
    (symbol, payload) => db.prepare(`INSERT INTO screener_universe (revision,symbol,market,data_date,payload) SELECT ?,?,json_extract(?,'$.stock.market'),?,? WHERE ${guard} ON CONFLICT(revision,symbol) DO NOTHING`).bind(revision, symbol, payload, universe.date, payload, ...guardArgs()));

    if (scope === "screener-daily") {
      for (const market of ["TWSE", "TPEx"] as const) {
        const url = SCREENER_SOURCES[market].volume, result = await getSource(url);
        const parsed = parseDailyVolumes(result.payload, market, provenance(market, url, result));
        checkDate(parsed.date, true);
        const symbols = new Set(universe.stocks.filter(stock => stock.market === market).map(stock => stock.symbol));
        await writeRows(market, `${result.payloadHash}:${revision}`, parsed.date, [...parsed.points].filter(([symbol]) => symbols.has(symbol)), parsed.invalid.size,
          (symbol, payload) => db.prepare(`INSERT INTO screener_daily_volume (symbol,data_date,payload) SELECT ?,?,? WHERE ${guard} ON CONFLICT(data_date,symbol) DO UPDATE SET payload=excluded.payload WHERE json_extract(excluded.payload,'$.provenance.fetchedAt') >= json_extract(screener_daily_volume.payload,'$.provenance.fetchedAt') AND (json_extract(excluded.payload,'$.turnoverNtd') IS NOT NULL OR json_extract(screener_daily_volume.payload,'$.turnoverNtd') IS NULL)`)
            .bind(symbol, parsed.date, payload, ...guardArgs()), Object.fromEntries([...parsed.invalid].filter(([symbol]) => symbols.has(symbol))));
      }
    } else {
      const result = await getSource(SCREENER_SOURCES.tdcc);
      const parsed = parseHolderBatch(result.payload, universe.stocks, provenance("TDCC", SCREENER_SOURCES.tdcc, result));
      checkDate(parsed.date);
      await writeRows("TDCC", `${result.payloadHash}:${revision}`, parsed.date, [...parsed.points], parsed.invalid.size, holderStatement, Object.fromEntries(parsed.invalid));
      // Previous date may only come from independently verified official periods, not date arithmetic.
      if (options.previousWeek) {
        if (options.previousWeek >= parsed.date) throw new Error("invalid_reuse_dates");
        const local = await readLocalScreenerHolders(db, universe.stocks, [options.previousWeek]);
        const hash = await digest(JSON.stringify(local));
        await writeRows("TDCC-local", hash, options.previousWeek, local.map(row => [row.symbol, row.point]), 0, holderStatement);
      }
    }
    // Retain whole-source receipts across days; sparse per-symbol rows cannot create periods.
    for (const key of scope === "screener-daily" ? ["TWSE", "TPEx"] : ["TDCC"]) {
      const receipt = checkpoint.receipts[key];
      if (receipt?.complete) await checkpointBatch([db.prepare(`INSERT INTO screener_runs (id,scope,status,checkpoint,updated_at) SELECT ?,'screener-source-period','collected',?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at`)
        .bind(`screener-period:${key}:${receipt.date}`, JSON.stringify({ ...receipt, source: key }), iso(clock()), ...guardArgs())]);
    }
    checkpoint.reason = "period_review_pending";
    checkpoint.attempts = 0;
    checkpoint.nextAttemptAt = iso(started + (scope === "screener-daily" ? 6 : 24) * 3600000);
    await checkpointBatch([], "collected");
    return { state: "collected", reason: checkpoint.reason, receipts: checkpoint.receipts };
  } catch (error) {
    checkpoint.reason = safeReason(error);
    checkpoint.nextAttemptAt = iso(clock() + Math.max(Math.min(60, 15 * 2 ** Math.max(0, checkpoint.attempts - 1)) * 60000,
      error instanceof ScreenerSourceError ? error.retryAfterMs : 0));
    // Fenced save: a timed-out owner cannot overwrite its successor's progress.
    await db.batch([save("retry_pending")]);
    return { state: "pending", reason: checkpoint.reason, nextAttemptAt: checkpoint.nextAttemptAt };
  } finally {
    await db.prepare("UPDATE screener_runs SET status='idle',lease_until=NULL WHERE id=? AND checkpoint=?").bind(LEASE_ID, owner).run();
  }
}
