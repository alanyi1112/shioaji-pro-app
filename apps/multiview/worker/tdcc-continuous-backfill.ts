import { runD1Batch } from "./d1-batch.ts";

export const TDCC_CONTINUOUS_CONTRACT = Object.freeze({
  provider: "tdcc",
  dataset: "shareholder-distribution",
  latestOpenDataUrl: "https://openapi.tdcc.com.tw/v1/opendata/1-5",
  historyPortalUrl: "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock",
  scheduler: "sites-worker-orchestrator",
  scheduleUtc: "30 14 * * 6,0",
  checkFrequency: "weekly-with-next-day-retry",
  dataFrequency: "weekly",
  minimumDelayMs: 1000,
  requestTimeoutMs: 30000,
  maximumRetries: 3,
  leaseSeconds: 900,
  maximumClaimSymbols: 4,
  maximumWeeksPerClaim: 12,
  minimumHistoryWeeks: 51,
  maximumRunMs: 20 * 60 * 1000,
  historyAutomation: "explicit-user-enabled-visible-form",
});

export const TDCC_CONTINUOUS_STATES = ["observed", "queued", "running", "partial", "completed", "blocked", "failed", "inactive"] as const;
export type TdccContinuousState = typeof TDCC_CONTINUOUS_STATES[number];
export const TDCC_CONTINUOUS_SAFE_ERRORS = [
  "captcha_or_blocked",
  "candidate_mismatch",
  "d1_unavailable",
  "history_automation_not_permitted",
  "invalid_response",
  "provider_unavailable",
  "rate_limited",
  "scheduler_stale",
  "tick_limit_exceeded",
  "timeout",
] as const;
export type TdccContinuousError = typeof TDCC_CONTINUOUS_SAFE_ERRORS[number];

const SYMBOL = /^[0-9A-Z]{4,8}\.(TW|TWO)$/;
const OWNER = /^[a-zA-Z0-9._:-]{1,96}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const safeErrors = new Set<string>(TDCC_CONTINUOUS_SAFE_ERRORS);

export type TdccContinuousTarget = {
  symbol: string;
  source: "setup" | "user" | "official-new-listing";
  catalogRevision?: string;
};

type TdccCoverageRow = {
  coverage_start?: string | null;
  coverage_end?: string | null;
  saved_weeks?: number | null;
  last_success_at?: string | null;
};

type TdccCountRow = { rows?: number | null };
type TdccQueueProbeRow = { runnable?: number | null; overdue?: number | null; oldest_queued_at?: string | null };

type TdccContinuousSymbolRow = {
  symbol?: string | null;
  source?: string | null;
  catalog_revision?: string | null;
  active?: number | boolean | null;
  status?: TdccContinuousState | null;
  target_start?: string | null;
  target_end?: string | null;
  expected_weeks?: number | null;
  completed_weeks?: number | null;
  failed_weeks?: number | null;
  missing_dates_json?: string | null;
  checkpoint_date?: string | null;
  latest_snapshot_date?: string | null;
  official_plan_through?: string | null;
  coverage_verified_at?: string | null;
  history_success_at?: string | null;
  next_retry_at?: string | null;
  last_error_code?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
};

type TdccSavedDateRow = { data_date?: string | null };
type TdccItemRow = { data_date?: string | null; status?: string | null; error_code?: string | null };
type TdccContinuousRunRow = {
  run_id?: string | null;
  trigger?: string | null;
  status?: string | null;
  heartbeat_at?: string | null;
  latest_data_date?: string | null;
  error_code?: string | null;
  next_retry_at?: string | null;
};
type TdccSuccessfulRunRow = { completed_at?: string | null; heartbeat_at?: string | null };
type TdccHealthCountsRow = {
  targets?: number | null;
  queued?: number | null;
  running?: number | null;
  completed?: number | null;
  blocked?: number | null;
  missing_targets?: number | null;
  reconciliation_required?: number | null;
  handoff_overdue?: number | null;
  latest_data_date?: string | null;
};

function iso(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_response");
  return date.toISOString();
}

function realDate(value: unknown) {
  const text = String(value || "");
  if (!ISO_DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function normalizedSymbol(value: unknown) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("invalid_response");
  return symbol;
}

export function safeTdccContinuousError(value: unknown): TdccContinuousError {
  const raw = String(value instanceof Error ? value.message : value || "invalid_response");
  if (safeErrors.has(raw)) return raw as TdccContinuousError;
  if (/429|rate.?limit/i.test(raw)) return "rate_limited";
  if (/timeout|abort/i.test(raw)) return "timeout";
  if (/captcha|blocked|forbidden|403/i.test(raw)) return "captcha_or_blocked";
  if (/candidate/i.test(raw)) return "candidate_mismatch";
  return "invalid_response";
}

export function validateContinuousTargets(input: TdccContinuousTarget[]) {
  if (!Array.isArray(input) || input.length > 5000) throw new Error("invalid_response");
  const deduped = new Map<string, TdccContinuousTarget>();
  for (const item of input) {
    const symbol = normalizedSymbol(item?.symbol);
    if (!item || !["setup", "user", "official-new-listing"].includes(item.source)) throw new Error("invalid_response");
    const previous = deduped.get(symbol);
    if (!previous || previous.source !== "setup") deduped.set(symbol, { symbol, source: item.source, catalogRevision: String(item.catalogRevision || "") });
  }
  return [...deduped.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

const verifiedDistributionPredicate = `(p.symbol IS NULL
  OR (p.transport IN ('official-openapi','official-history','legacy-verified') AND p.validation_status IN ('verified','official-confirmed','legacy-compatible'))
  OR (p.transport='verified-archive' AND p.validation_status IN ('verified','official-confirmed') AND r.status IN ('verified','matched-existing')))`;

async function verifiedSavedDates(db: D1Database, symbol: string) {
  return db.prepare(`SELECT d.data_date FROM taiwan_stock_shareholder_distribution d
    LEFT JOIN tdcc_distribution_row_provenance p ON p.symbol=d.symbol AND p.data_date=d.data_date
    LEFT JOIN tdcc_archive_period_receipts r ON r.receipt_id=p.receipt_id
    WHERE d.symbol=? AND ${verifiedDistributionPredicate} ORDER BY d.data_date`).bind(symbol).all<TdccSavedDateRow>();
}

async function coverageFor(db: D1Database, symbol: string) {
  return db.prepare(`SELECT MIN(d.data_date) AS coverage_start,MAX(d.data_date) AS coverage_end,COUNT(DISTINCT d.data_date) AS saved_weeks,MAX(d.source_fetched_at) AS last_success_at
    FROM taiwan_stock_shareholder_distribution d
    LEFT JOIN tdcc_distribution_row_provenance p ON p.symbol=d.symbol AND p.data_date=d.data_date
    LEFT JOIN tdcc_archive_period_receipts r ON r.receipt_id=p.receipt_id
    WHERE d.symbol=? AND ${verifiedDistributionPredicate}`)
    .bind(symbol).first<TdccCoverageRow>();
}

async function saveTdccContinuousTarget(input: {
  db: D1Database;
  target: TdccContinuousTarget;
  catalogRevision: string;
  now: string;
}) {
  const coverage = await coverageFor(input.db, input.target.symbol);
  const saved = Number(coverage?.saved_weeks || 0);
  const existing = await input.db.prepare("SELECT * FROM tdcc_continuous_symbols WHERE symbol=?")
    .bind(input.target.symbol).first<TdccContinuousSymbolRow>();
  const projection = existing ? await projectTdccContinuousLedger(input.db, input.target.symbol, existing) : null;
  const hasVerifiedPlan = Boolean(existing?.official_plan_through && realDate(existing.official_plan_through));
  const expectedWeeks = projection?.expectedWeeks ?? (hasVerifiedPlan ? Number(existing?.expected_weeks || 0) : 0);
  const completedWeeks = projection?.completedWeeks ?? (hasVerifiedPlan ? Number(existing?.completed_weeks || 0) : 0);
  const failedWeeks = projection?.failedWeeks ?? (hasVerifiedPlan ? Number(existing?.failed_weeks || 0) : 0);
  const missingDates = projection?.missingDates ?? (hasVerifiedPlan ? parseJsonArray(existing?.missing_dates_json) : []);
  const status = projection?.status
    ?? (["blocked", "running"].includes(String(existing?.status || ""))
      ? existing?.status as TdccContinuousState
      : saved > 0 ? "partial" : "queued");
  await input.db.prepare(`INSERT INTO tdcc_continuous_symbols
    (symbol,source,catalog_revision,active,status,target_start,target_end,expected_weeks,completed_weeks,failed_weeks,missing_dates_json,checkpoint_date,latest_snapshot_date,official_plan_through,coverage_verified_at,history_success_at,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET
      source=CASE WHEN tdcc_continuous_symbols.source='setup' AND excluded.source='user' THEN tdcc_continuous_symbols.source ELSE excluded.source END,
      catalog_revision=CASE WHEN excluded.catalog_revision='' THEN tdcc_continuous_symbols.catalog_revision ELSE excluded.catalog_revision END,
      active=1,status=excluded.status,
      target_start=excluded.target_start,target_end=excluded.target_end,
      expected_weeks=excluded.expected_weeks,completed_weeks=excluded.completed_weeks,failed_weeks=excluded.failed_weeks,
      missing_dates_json=excluded.missing_dates_json,checkpoint_date=excluded.checkpoint_date,
      latest_snapshot_date=COALESCE(excluded.latest_snapshot_date,tdcc_continuous_symbols.latest_snapshot_date),
      official_plan_through=excluded.official_plan_through,coverage_verified_at=excluded.coverage_verified_at,
      history_success_at=COALESCE(excluded.history_success_at,tdcc_continuous_symbols.history_success_at),last_seen_at=excluded.last_seen_at,updated_at=CURRENT_TIMESTAMP`).bind(
    input.target.symbol, input.target.source, input.target.catalogRevision || input.catalogRevision, 1, status,
    projection?.targetStart || existing?.target_start || null, projection?.targetEnd || existing?.target_end || null,
    expectedWeeks, completedWeeks, failedWeeks, JSON.stringify(missingDates), projection?.checkpoint || existing?.checkpoint_date || null,
    existing?.latest_snapshot_date || coverage?.coverage_end || null, projection?.officialPlanThrough || existing?.official_plan_through || null,
    projection ? input.now : existing?.coverage_verified_at || null, coverage?.last_success_at || existing?.history_success_at || null,
    existing?.first_seen_at || input.now, input.now,
  ).run();
}

export async function upsertTdccContinuousTarget(input: {
  db: D1Database;
  target: TdccContinuousTarget;
  catalogRevision?: string;
  now?: Date | string;
}) {
  const target = validateContinuousTargets([input.target])[0];
  const now = iso(input.now);
  await saveTdccContinuousTarget({ db: input.db, target, catalogRevision: String(input.catalogRevision || ""), now });
  await reconcileTdccContinuousTargetFromKnownPlan({ db: input.db, symbol: target.symbol, now });
  return readTdccContinuousSymbolStatus(input.db, target.symbol);
}

export async function reconcileTdccContinuousTargetFromKnownPlan(input: {
  db: D1Database;
  symbol: string;
  now?: Date | string;
}) {
  const symbol = normalizedSymbol(input.symbol);
  const now = iso(input.now);
  const target = await input.db.prepare("SELECT * FROM tdcc_continuous_symbols WHERE symbol=? AND active=1")
    .bind(symbol).first<TdccContinuousSymbolRow>();
  if (!target || ["running", "blocked"].includes(String(target.status || ""))) return readTdccContinuousSymbolStatus(input.db, symbol);
  const known = await input.db.prepare(`SELECT data_date FROM tdcc_continuous_items
    GROUP BY data_date ORDER BY data_date DESC LIMIT ?`).bind(TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks)
    .all<{ data_date: string }>();
  const officialDates = known.results.map(row => String(row.data_date || "")).filter(realDate).sort();
  if (officialDates.length < TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks) return readTdccContinuousSymbolStatus(input.db, symbol);
  const [savedResult, universe] = await Promise.all([
    verifiedSavedDates(input.db, symbol),
    input.db.prepare("SELECT listing_date FROM tdcc_archive_symbol_universe WHERE symbol=? ORDER BY manifest_version DESC LIMIT 1")
      .bind(symbol).first<{ listing_date: string | null }>(),
  ]);
  const saved = new Set(savedResult.results.map(row => String(row.data_date || "")).filter(realDate));
  const listingDate = realDate(universe?.listing_date) ? String(universe?.listing_date) : null;
  const statements = officialDates.map((date) => {
    const preListing = Boolean(listingDate && date < listingDate);
    const completed = saved.has(date) || preListing;
    return input.db.prepare(`INSERT INTO tdcc_continuous_items
      (symbol,data_date,status,priority,completed_at,error_code,lease_owner,lease_expires_at,next_retry_at)
      VALUES (?,?,?,100,?,?,NULL,NULL,NULL)
      ON CONFLICT(symbol,data_date) DO UPDATE SET
        status=CASE WHEN tdcc_continuous_items.status IN ('running','blocked') THEN tdcc_continuous_items.status ELSE excluded.status END,
        completed_at=CASE WHEN tdcc_continuous_items.status IN ('running','blocked') THEN tdcc_continuous_items.completed_at ELSE excluded.completed_at END,
        error_code=CASE WHEN tdcc_continuous_items.status IN ('running','blocked') THEN tdcc_continuous_items.error_code ELSE excluded.error_code END,
        lease_owner=CASE WHEN tdcc_continuous_items.status IN ('running','blocked') THEN tdcc_continuous_items.lease_owner ELSE NULL END,
        lease_expires_at=CASE WHEN tdcc_continuous_items.status IN ('running','blocked') THEN tdcc_continuous_items.lease_expires_at ELSE NULL END,
        next_retry_at=CASE WHEN tdcc_continuous_items.status IN ('running','blocked') THEN tdcc_continuous_items.next_retry_at ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP`)
      .bind(symbol, date, completed ? "completed" : "queued", completed ? now : null, preListing ? "pre_listing" : null);
  });
  await runD1Batch(input.db, statements);
  const itemResult = await input.db.prepare("SELECT data_date,status,error_code FROM tdcc_continuous_items WHERE symbol=? ORDER BY data_date")
    .bind(symbol).all<TdccItemRow>();
  const projection = projectTdccContinuousEvidence({
    officialDates,
    savedRows: savedResult.results,
    itemRows: itemResult.results,
    latestDataDate: target.latest_snapshot_date,
    existingStatus: target.status,
  });
  await input.db.prepare(`UPDATE tdcc_continuous_symbols SET
    status=?,target_start=?,target_end=?,expected_weeks=?,completed_weeks=?,failed_weeks=?,missing_dates_json=?,checkpoint_date=?,official_plan_through=?,coverage_verified_at=?,last_error_code=NULL,next_retry_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE symbol=? AND active=1 AND status NOT IN ('running','blocked')`).bind(
    projection.status, projection.targetStart, projection.targetEnd, projection.expectedWeeks, projection.completedWeeks,
    projection.failedWeeks, JSON.stringify(projection.missingDates), projection.checkpoint, projection.officialPlanThrough, now, symbol,
  ).run();
  return readTdccContinuousSymbolStatus(input.db, symbol);
}

export async function queueTdccContinuousSymbolBackfill(input: {
  db: D1Database;
  symbol: string;
  now?: Date | string;
}) {
  const symbol = normalizedSymbol(input.symbol);
  const row = await input.db.prepare("SELECT * FROM tdcc_continuous_symbols WHERE symbol=?").bind(symbol).first<TdccContinuousSymbolRow>();
  if (!row || !Boolean(row.active)) return { status: "not_target", backfill: await readTdccContinuousSymbolStatus(input.db, symbol) };
  const current = String(row.status || "");
  if (current === "blocked") return { status: "blocked", backfill: toSymbolStatus(row) };
  if (current === "running") return { status: "already-running", backfill: toSymbolStatus(row) };
  if (current === "queued") return { status: "queued", backfill: toSymbolStatus(row) };
  if (current === "completed" && Number(row.completed_weeks || 0) >= Number(row.expected_weeks || 0) && Number(row.expected_weeks || 0) >= TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks) {
    return { status: "completed", backfill: toSymbolStatus(row) };
  }
  const now = iso(input.now);
  await input.db.prepare(`UPDATE tdcc_continuous_symbols SET status='queued',last_error_code=NULL,next_retry_at=NULL,
    lease_owner=NULL,lease_expires_at=NULL,last_seen_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE symbol=? AND active=1 AND status NOT IN ('blocked','running','queued')`).bind(now, symbol).run();
  return { status: "queued", backfill: await readTdccContinuousSymbolStatus(input.db, symbol) };
}

export function resolvedTdccContinuousDates(
  savedRows: Array<{ data_date?: unknown }>,
  itemRows: Array<{ data_date?: unknown; status?: unknown; error_code?: unknown }>,
) {
  const saved = new Set(savedRows.map((row) => String(row.data_date || "")).filter(realDate));
  const gaps = new Set(itemRows
    .filter((row) => row.status === "completed" && ["not_published", "pre_listing"].includes(String(row.error_code || "")))
    .map((row) => String(row.data_date || ""))
    .filter(realDate));
  return { saved, gaps, completed: new Set([...saved, ...gaps]) };
}

export function projectTdccContinuousEvidence(input: {
  officialDates: unknown[];
  savedRows?: Array<{ data_date?: unknown }>;
  itemRows?: Array<{ data_date?: unknown; status?: unknown; error_code?: unknown }>;
  latestDataDate?: unknown;
  existingStatus?: unknown;
  minimumHistoryWeeks?: unknown;
}) {
  const officialDates = [...new Set((input.officialDates || []).map(String))].filter(realDate).sort();
  if (!officialDates.length || officialDates.length > 60) throw new Error("invalid_response");
  const savedRows = Array.isArray(input.savedRows) ? input.savedRows : [];
  const itemRows = Array.isArray(input.itemRows) ? input.itemRows : [];
  const savedAll = new Set(savedRows.map((row) => String(row.data_date || "")).filter(realDate));
  const { completed } = resolvedTdccContinuousDates(savedRows, itemRows);
  const official = new Set(officialDates);
  const resolved = new Set([...completed].filter((date) => official.has(date)));
  const failed = new Set(itemRows
    .filter((row) => ["failed", "blocked"].includes(String(row.status || "")))
    .map((row) => String(row.data_date || ""))
    .filter((date) => official.has(date)));
  const missingDates = officialDates.filter((date) => !resolved.has(date));
  const officialPlanThrough = officialDates.at(-1) || null;
  const latestDataDate = realDate(input.latestDataDate) ? String(input.latestDataDate) : null;
  const reconciliationRequired = Boolean(latestDataDate && (!officialPlanThrough || officialPlanThrough < latestDataDate));
  const minimumHistoryWeeks = Math.max(1, Number(input.minimumHistoryWeeks || TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks));
  const completedWeeks = resolved.size;
  const existingStatus = String(input.existingStatus || "");
  let status: TdccContinuousState;
  if (["blocked", "running"].includes(existingStatus)) status = existingStatus as TdccContinuousState;
  else if (officialDates.length >= minimumHistoryWeeks
    && completedWeeks === officialDates.length
    && missingDates.length === 0
    && !reconciliationRequired) status = "completed";
  else if (existingStatus === "queued" || completedWeeks === 0) status = "queued";
  else status = "partial";
  const savedDates = [...savedAll].sort();
  const resolvedDates = [...resolved].sort();
  return {
    status,
    expectedWeeks: officialDates.length,
    completedWeeks,
    failedWeeks: failed.size,
    savedWeeks: savedAll.size,
    missingDates,
    targetStart: officialDates[0] || null,
    targetEnd: officialPlanThrough,
    officialPlanThrough,
    checkpoint: resolvedDates.at(-1) || null,
    coverageStart: savedDates[0] || null,
    coverageEnd: savedDates.at(-1) || null,
    reconciliationRequired,
  };
}

async function projectTdccContinuousLedger(db: D1Database, symbol: string, row: TdccContinuousSymbolRow) {
  const [savedResult, itemResult] = await Promise.all([
    verifiedSavedDates(db, symbol),
    db.prepare("SELECT data_date,status,error_code FROM tdcc_continuous_items WHERE symbol=? ORDER BY data_date").bind(symbol).all<TdccItemRow>(),
  ]);
  const itemRows = itemResult.results || [];
  const officialDates = [...new Set(itemRows.map((item) => String(item.data_date || "")).filter(realDate))].sort();
  if (!officialDates.length) return null;
  return projectTdccContinuousEvidence({
    officialDates,
    savedRows: savedResult.results || [],
    itemRows,
    latestDataDate: row.latest_snapshot_date,
    existingStatus: row.status,
  });
}

export function tdccContinuousTargetSyncState(input: {
  existingStatus?: unknown;
  expectedWeeks?: unknown;
  completedWeeks?: unknown;
  missingDates?: unknown[];
  minimumHistoryWeeks?: unknown;
}): TdccContinuousState {
  const existingStatus = String(input.existingStatus || "");
  if (existingStatus === "blocked" || existingStatus === "running") return existingStatus;
  const expectedWeeks = Math.max(0, Number(input.expectedWeeks || 0));
  const completedWeeks = Math.max(0, Number(input.completedWeeks || 0));
  const minimumHistoryWeeks = Math.max(1, Number(input.minimumHistoryWeeks || TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks));
  const missingDates = Array.isArray(input.missingDates) ? input.missingDates.filter((date) => realDate(date)) : [];
  if (expectedWeeks >= minimumHistoryWeeks && completedWeeks >= expectedWeeks && missingDates.length === 0) return "completed";
  if (existingStatus === "queued") return "queued";
  if (completedWeeks > 0) return "partial";
  return "queued";
}

export async function syncTdccContinuousTargets(input: {
  db: D1Database;
  targets: TdccContinuousTarget[];
  observedCatalogSymbols?: string[];
  catalogRevision?: string;
  now?: Date | string;
}) {
  const now = iso(input.now);
  const targets = validateContinuousTargets(input.targets);
  const observed = [...new Set((input.observedCatalogSymbols || []).map(normalizedSymbol))].sort();
  const revision = String(input.catalogRevision || "");
  const count = await input.db.prepare("SELECT COUNT(*) AS rows FROM tdcc_continuous_symbols WHERE official_baseline=1 OR source='official-new-listing'").first<TdccCountRow>();
  const initializing = Number(count?.rows || 0) === 0;

  if (initializing && observed.length) {
    const baseline = observed.map((symbol) => input.db.prepare(`INSERT INTO tdcc_continuous_symbols
      (symbol,source,official_baseline,catalog_revision,active,status,first_seen_at,last_seen_at)
      VALUES (?, 'catalog-baseline', 1, ?, 0, 'observed', ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET official_baseline=1,catalog_revision=excluded.catalog_revision,last_seen_at=excluded.last_seen_at,updated_at=CURRENT_TIMESTAMP`).bind(symbol, revision, now, now));
    await runD1Batch(input.db, baseline);
  } else if (!initializing && observed.length) {
    await input.db.prepare("UPDATE tdcc_continuous_symbols SET active=0,status='inactive',lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE source='official-new-listing'").run();
    const discovered = observed.map((symbol) => input.db.prepare(`INSERT INTO tdcc_continuous_symbols
      (symbol,source,official_baseline,catalog_revision,active,status,first_seen_at,last_seen_at)
      VALUES (?, 'official-new-listing', 0, ?, 1, 'queued', ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        source=CASE WHEN tdcc_continuous_symbols.official_baseline=1 THEN tdcc_continuous_symbols.source ELSE 'official-new-listing' END,
        catalog_revision=excluded.catalog_revision,
        active=CASE WHEN tdcc_continuous_symbols.official_baseline=1 THEN 0 ELSE 1 END,
        status=CASE WHEN tdcc_continuous_symbols.official_baseline=1 THEN 'inactive' WHEN tdcc_continuous_symbols.status IN ('blocked','running','partial','completed') THEN tdcc_continuous_symbols.status ELSE 'queued' END,
        last_seen_at=excluded.last_seen_at,updated_at=CURRENT_TIMESTAMP`).bind(symbol, revision, now, now));
    await runD1Batch(input.db, discovered);
  }

  await input.db.prepare("UPDATE tdcc_continuous_symbols SET active=0,updated_at=CURRENT_TIMESTAMP WHERE source IN ('setup','user')").run();
  for (const target of targets) {
    await saveTdccContinuousTarget({ db: input.db, target, catalogRevision: revision, now });
  }
  await input.db.prepare("UPDATE tdcc_continuous_symbols SET status='inactive',lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE active=0 AND source IN ('setup','user')").run();
  return readTdccContinuousHealth(input.db, new Date(now));
}

export async function claimTdccContinuousSymbols(input: { db: D1Database; owner: string; limit?: number; leaseSeconds?: number; now?: Date | string }) {
  if (!OWNER.test(input.owner)) throw new Error("invalid_response");
  const limit = Math.max(1, Math.min(Number(input.limit || 1), TDCC_CONTINUOUS_CONTRACT.maximumClaimSymbols));
  const now = iso(input.now);
  const lease = new Date(new Date(now).getTime() + Math.max(60, Math.min(Number(input.leaseSeconds || TDCC_CONTINUOUS_CONTRACT.leaseSeconds), 3600)) * 1000).toISOString();
  const result = await input.db.prepare(`UPDATE tdcc_continuous_symbols SET status='running',lease_owner=?,lease_expires_at=?,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE symbol IN (
      SELECT symbol FROM tdcc_continuous_symbols
      WHERE active=1 AND (status IN ('queued','partial','failed') OR (status='running' AND lease_expires_at<=?))
        AND (next_retry_at IS NULL OR next_retry_at<=?)
        AND (lease_expires_at IS NULL OR lease_expires_at<=?)
      ORDER BY CASE source WHEN 'official-new-listing' THEN 0 ELSE 1 END, first_seen_at, symbol LIMIT ?
    ) RETURNING *`).bind(input.owner, lease, now, now, now, limit).all<TdccContinuousSymbolRow>();
  return (result.results || []).map(toSymbolStatus);
}

export async function probeTdccContinuousQueue(input: { db: D1Database; now?: Date | string; handoffSeconds?: number }) {
  const now = iso(input.now);
  const handoffSeconds = Math.max(60, Math.min(Number(input.handoffSeconds || 300), 3600));
  const overdueBefore = new Date(Date.parse(now) - handoffSeconds * 1000).toISOString();
  const row = await input.db.prepare(`SELECT
    COUNT(CASE WHEN active=1 AND status IN ('queued','partial','failed')
      AND (next_retry_at IS NULL OR next_retry_at<=?) AND (lease_expires_at IS NULL OR lease_expires_at<=?) THEN 1 END) AS runnable,
    COUNT(CASE WHEN active=1 AND status IN ('queued','partial','failed') AND first_seen_at<=?
      AND (next_retry_at IS NULL OR next_retry_at<=?) AND (lease_expires_at IS NULL OR lease_expires_at<=?) THEN 1 END) AS overdue,
    MIN(CASE WHEN active=1 AND status IN ('queued','partial','failed') THEN first_seen_at END) AS oldest_queued_at
    FROM tdcc_continuous_symbols`).bind(now, now, overdueBefore, now, now).first<TdccQueueProbeRow>();
  const runnableTargets = Number(row?.runnable || 0);
  return {
    checkedAt: now,
    handoffSeconds,
    runnableTargets,
    overdueTargets: Number(row?.overdue || 0),
    oldestQueuedAt: row?.oldest_queued_at || null,
    shouldRun: runnableTargets > 0,
  };
}

export async function heartbeatTdccContinuousLease(input: { db: D1Database; owner: string; symbols: string[]; leaseSeconds?: number; now?: Date | string }) {
  if (!OWNER.test(input.owner)) throw new Error("invalid_response");
  const symbols = [...new Set(input.symbols.map(normalizedSymbol))];
  if (!symbols.length || symbols.length > TDCC_CONTINUOUS_CONTRACT.maximumClaimSymbols) throw new Error("invalid_response");
  const now = iso(input.now);
  const lease = new Date(new Date(now).getTime() + Math.max(60, Math.min(Number(input.leaseSeconds || TDCC_CONTINUOUS_CONTRACT.leaseSeconds), 3600)) * 1000).toISOString();
  await input.db.batch(symbols.flatMap((symbol) => [
    input.db.prepare("UPDATE tdcc_continuous_symbols SET lease_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND lease_owner=? AND status='running'").bind(lease, symbol, input.owner),
    input.db.prepare("UPDATE tdcc_continuous_items SET lease_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND lease_owner=? AND status='queued'").bind(lease, symbol, input.owner),
  ]));
  return { owner: input.owner, symbols, leaseExpiresAt: lease };
}

export async function planTdccContinuousDates(input: { db: D1Database; symbol: string; owner: string; officialDates: string[]; preListingDates?: string[]; now?: Date | string }) {
  const symbol = normalizedSymbol(input.symbol);
  if (!OWNER.test(input.owner)) throw new Error("invalid_response");
  const dates = [...new Set(input.officialDates.map(String))].sort();
  if (!dates.length || dates.length > 60 || dates.some((date) => !realDate(date))) throw new Error("invalid_response");
  const preListing = new Set((input.preListingDates || []).map(String));
  if ([...preListing].some((date) => !dates.includes(date))) throw new Error("invalid_response");
  const claimed = await input.db.prepare("SELECT * FROM tdcc_continuous_symbols WHERE symbol=? AND lease_owner=? AND status='running'").bind(symbol, input.owner).first<TdccContinuousSymbolRow>();
  if (!claimed) throw new Error("invalid_response");
  const [savedResult, itemResult] = await Promise.all([
    verifiedSavedDates(input.db, symbol),
    input.db.prepare("SELECT data_date,status,error_code FROM tdcc_continuous_items WHERE symbol=? ORDER BY data_date").bind(symbol).all<TdccItemRow>(),
  ]);
  const { saved, completed } = resolvedTdccContinuousDates(savedResult.results || [], itemResult.results || []);
  // 上市前週次仍屬於完整官方日期計畫的一部分，但只能以 pre_listing
  // 缺值完成，不能排除後讓新上市商品永遠低於最低歷史週數而反覆 claim。
  const expected = dates;
  const now = iso(input.now);
  const leaseExpiresAt = String(claimed.lease_expires_at || "");
  const statements = expected.map((date) => {
    const hasSaved = saved.has(date);
    const preListingGap = preListing.has(date);
    const complete = preListingGap || completed.has(date);
    return input.db.prepare(`INSERT INTO tdcc_continuous_items (symbol,data_date,status,priority,lease_owner,lease_expires_at,completed_at,error_code)
      VALUES (?,?,?,100,?,?,?,?) ON CONFLICT(symbol,data_date) DO UPDATE SET
        status=excluded.status,
        lease_owner=CASE WHEN excluded.status='completed' THEN NULL ELSE excluded.lease_owner END,
        lease_expires_at=CASE WHEN excluded.status='completed' THEN NULL ELSE excluded.lease_expires_at END,
        completed_at=CASE WHEN excluded.status='completed' THEN COALESCE(tdcc_continuous_items.completed_at,excluded.completed_at) ELSE NULL END,
        error_code=CASE WHEN excluded.error_code='pre_listing' THEN 'pre_listing' WHEN ?=1 THEN NULL WHEN tdcc_continuous_items.status='completed' AND tdcc_continuous_items.error_code IN ('not_published','pre_listing') THEN tdcc_continuous_items.error_code ELSE NULL END,
        next_retry_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE tdcc_continuous_items.status IS NOT excluded.status
        OR tdcc_continuous_items.lease_owner IS NOT CASE WHEN excluded.status='completed' THEN NULL ELSE excluded.lease_owner END
        OR tdcc_continuous_items.lease_expires_at IS NOT CASE WHEN excluded.status='completed' THEN NULL ELSE excluded.lease_expires_at END
        OR (excluded.status='completed' AND tdcc_continuous_items.completed_at IS NULL)
        OR (excluded.status!='completed' AND tdcc_continuous_items.completed_at IS NOT NULL)
        OR tdcc_continuous_items.error_code IS NOT CASE WHEN excluded.error_code='pre_listing' THEN 'pre_listing' WHEN ?=1 THEN NULL WHEN tdcc_continuous_items.status='completed' AND tdcc_continuous_items.error_code IN ('not_published','pre_listing') THEN tdcc_continuous_items.error_code ELSE NULL END
        OR tdcc_continuous_items.next_retry_at IS NOT NULL`)
      .bind(symbol, date, complete ? "completed" : "queued", complete ? null : input.owner, complete ? null : leaseExpiresAt, complete ? now : null, preListingGap ? "pre_listing" : null, hasSaved ? 1 : 0, hasSaved ? 1 : 0);
  });
  await runD1Batch(input.db, statements);
  const refreshedItems = await input.db.prepare("SELECT data_date,status,error_code FROM tdcc_continuous_items WHERE symbol=? ORDER BY data_date").bind(symbol).all<TdccItemRow>();
  const projection = projectTdccContinuousEvidence({
    officialDates: expected,
    savedRows: savedResult.results || [],
    itemRows: refreshedItems.results || [],
    latestDataDate: claimed.latest_snapshot_date,
    existingStatus: claimed.status,
  });
  const fullyVerified = projection.missingDates.length === 0
    && projection.expectedWeeks >= TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks
    && !projection.reconciliationRequired;
  const status = fullyVerified ? "completed" : projection.missingDates.length ? "running" : "partial";
  await input.db.prepare(`UPDATE tdcc_continuous_symbols SET target_start=?,target_end=?,expected_weeks=?,completed_weeks=?,failed_weeks=?,
    missing_dates_json=?,checkpoint_date=?,official_plan_through=?,coverage_verified_at=?,status=?,last_error_code=NULL,next_retry_at=NULL,last_seen_at=?,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND lease_owner=?`).bind(
    projection.targetStart, projection.targetEnd, projection.expectedWeeks, projection.completedWeeks, projection.failedWeeks,
    JSON.stringify(projection.missingDates), projection.checkpoint, projection.officialPlanThrough, now,
    status, now, symbol, input.owner,
  ).run();
  if (!projection.missingDates.length) await releaseTdccContinuousSymbol({ db: input.db, symbol, owner: input.owner, status: fullyVerified ? "completed" : "partial", now });
  return {
    symbol,
    officialDates: dates,
    preListingDates: [...preListing].sort(),
    missingDates: projection.missingDates,
    expectedWeeks: projection.expectedWeeks,
    completedWeeks: projection.completedWeeks,
    failedWeeks: projection.failedWeeks,
    officialPlanThrough: projection.officialPlanThrough,
    coverageVerifiedAt: now,
    reconciliationRequired: projection.reconciliationRequired,
  };
}

export async function completeTdccContinuousWeek(input: { db: D1Database; symbol: string; dataDate: string; owner: string; gapReason?: "not_published" | "pre_listing"; now?: Date | string }) {
  const symbol = normalizedSymbol(input.symbol);
  if (!realDate(input.dataDate) || !OWNER.test(input.owner)) throw new Error("invalid_response");
  const now = iso(input.now);
  const gapReason = input.gapReason || null;
  await input.db.prepare("UPDATE tdcc_continuous_items SET status='completed',attempts=attempts+1,error_code=?,lease_owner=NULL,lease_expires_at=NULL,next_retry_at=NULL,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND data_date=? AND lease_owner=?")
    .bind(gapReason, now, symbol, input.dataDate, input.owner).run();
  const row = await input.db.prepare("SELECT * FROM tdcc_continuous_symbols WHERE symbol=? AND lease_owner=? AND status='running'").bind(symbol, input.owner).first<TdccContinuousSymbolRow>();
  if (!row) throw new Error("invalid_response");
  const projection = await projectTdccContinuousLedger(input.db, symbol, row);
  if (!projection) throw new Error("invalid_response");
  const fullyVerified = projection.missingDates.length === 0
    && projection.expectedWeeks >= TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks
    && !projection.reconciliationRequired;
  await input.db.prepare(`UPDATE tdcc_continuous_symbols SET expected_weeks=?,completed_weeks=?,failed_weeks=?,missing_dates_json=?,
    target_start=?,target_end=?,checkpoint_date=?,official_plan_through=?,coverage_verified_at=?,
    history_success_at=CASE WHEN ? IS NULL THEN ? ELSE history_success_at END,last_error_code=NULL,
    status=?,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND lease_owner=?`).bind(
    projection.expectedWeeks, projection.completedWeeks, projection.failedWeeks, JSON.stringify(projection.missingDates),
    projection.targetStart, projection.targetEnd, projection.checkpoint, projection.officialPlanThrough, now,
    gapReason, now, fullyVerified ? "completed" : "running", symbol, input.owner,
  ).run();
  if (fullyVerified) await releaseTdccContinuousSymbol({ db: input.db, symbol, owner: input.owner, status: "completed", now });
  return readTdccContinuousSymbolStatus(input.db, symbol);
}

export async function failTdccContinuousWork(input: { db: D1Database; symbol: string; owner: string; dataDate?: string; reason: unknown; retryable?: boolean; now?: Date | string }) {
  const symbol = normalizedSymbol(input.symbol);
  if (!OWNER.test(input.owner) || (input.dataDate && !realDate(input.dataDate))) throw new Error("invalid_response");
  const code = safeTdccContinuousError(input.reason);
  const blocked = ["captcha_or_blocked", "candidate_mismatch", "history_automation_not_permitted", "invalid_response"].includes(code) && !input.retryable;
  const now = iso(input.now);
  const nextRetryAt = blocked ? null : new Date(new Date(now).getTime() + 6 * 3600000).toISOString();
  if (input.dataDate) await input.db.prepare("UPDATE tdcc_continuous_items SET status=?,attempts=attempts+1,error_code=?,next_retry_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND data_date=?")
    .bind(blocked ? "blocked" : "failed", code, nextRetryAt, symbol, input.dataDate).run();
  await releaseTdccContinuousSymbol({ db: input.db, symbol, owner: input.owner, status: blocked ? "blocked" : "partial", errorCode: code, nextRetryAt, now });
  return readTdccContinuousSymbolStatus(input.db, symbol);
}

export async function releaseTdccContinuousSymbol(input: { db: D1Database; symbol: string; owner: string; status: "completed" | "partial" | "blocked"; errorCode?: string | null; nextRetryAt?: string | null; now?: Date | string }) {
  const symbol = normalizedSymbol(input.symbol);
  if (!OWNER.test(input.owner)) throw new Error("invalid_response");
  const error = input.errorCode ? safeTdccContinuousError(input.errorCode) : null;
  await input.db.batch([
    input.db.prepare("UPDATE tdcc_continuous_symbols SET status=?,last_error_code=?,next_retry_at=?,lease_owner=NULL,lease_expires_at=NULL,last_seen_at=?,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND lease_owner=?")
      .bind(input.status, error, input.nextRetryAt || null, iso(input.now), symbol, input.owner),
    input.db.prepare("UPDATE tdcc_continuous_items SET lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND lease_owner=? AND status!='completed'").bind(symbol, input.owner),
  ]);
}

export async function startTdccContinuousRun(input: { db: D1Database; runId: string; trigger: "schedule" | "workflow_dispatch"; now?: Date | string }) {
  if (!OWNER.test(input.runId) || !["schedule", "workflow_dispatch"].includes(input.trigger)) throw new Error("invalid_response");
  const now = iso(input.now);
  await input.db.prepare(`INSERT INTO tdcc_continuous_runs (run_id,trigger,status,heartbeat_at,started_at)
    VALUES (?,?,'running',?,?) ON CONFLICT(run_id) DO UPDATE SET status='running',heartbeat_at=excluded.heartbeat_at,error_code=NULL,updated_at=CURRENT_TIMESTAMP`).bind(input.runId, input.trigger, now, now).run();
  return { runId: input.runId, trigger: input.trigger, status: "running", heartbeatAt: now };
}

export async function heartbeatTdccContinuousRun(input: { db: D1Database; runId: string; latestDataDate?: string | null; now?: Date | string }) {
  if (!OWNER.test(input.runId) || (input.latestDataDate && !realDate(input.latestDataDate))) throw new Error("invalid_response");
  const now = iso(input.now);
  await input.db.prepare(`UPDATE tdcc_continuous_runs SET heartbeat_at=?,latest_data_date=COALESCE(?,latest_data_date),
    target_count=(SELECT COUNT(*) FROM tdcc_continuous_symbols WHERE active=1),
    queued_count=(SELECT COUNT(*) FROM tdcc_continuous_symbols WHERE active=1 AND status IN ('queued','partial','failed')),
    claimed_count=(SELECT COUNT(*) FROM tdcc_continuous_symbols WHERE active=1 AND status='running'),
    completed_count=(SELECT COUNT(*) FROM tdcc_continuous_symbols WHERE active=1 AND status='completed'),
    blocked_count=(SELECT COUNT(*) FROM tdcc_continuous_symbols WHERE active=1 AND status='blocked'),updated_at=CURRENT_TIMESTAMP WHERE run_id=?`).bind(now, input.latestDataDate || null, input.runId).run();
}

export async function finishTdccContinuousRun(input: { db: D1Database; runId: string; reason?: unknown; now?: Date | string }) {
  if (!OWNER.test(input.runId)) throw new Error("invalid_response");
  const now = iso(input.now);
  const code = input.reason ? safeTdccContinuousError(input.reason) : null;
  const nextRetryAt = code && !["captcha_or_blocked", "candidate_mismatch", "history_automation_not_permitted", "invalid_response"].includes(code)
    ? new Date(new Date(now).getTime() + 6 * 3600000).toISOString() : null;
  await input.db.prepare("UPDATE tdcc_continuous_runs SET status=?,error_code=?,next_retry_at=?,heartbeat_at=?,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=?")
    .bind(code ? "failed" : "completed", code, nextRetryAt, now, now, input.runId).run();
}

export async function recordTdccLatestSnapshot(input: { db: D1Database; dataDate: string; symbols: string[]; runId?: string; now?: Date | string }) {
  if (!realDate(input.dataDate)) throw new Error("invalid_response");
  const symbols = [...new Set(input.symbols.map(normalizedSymbol))];
  const now = iso(input.now);
  if (symbols.length) await runD1Batch(input.db, symbols.map((symbol) => input.db.prepare(`UPDATE tdcc_continuous_symbols SET
    status=CASE
      WHEN status IN ('running','blocked','inactive') THEN status
      WHEN (latest_snapshot_date IS NULL OR latest_snapshot_date<?) AND (official_plan_through IS NULL OR official_plan_through<?)
        THEN CASE WHEN completed_weeks>0 OR EXISTS (SELECT 1 FROM taiwan_stock_shareholder_distribution d WHERE d.symbol=tdcc_continuous_symbols.symbol LIMIT 1) THEN 'partial' ELSE 'queued' END
      ELSE status END,
    latest_snapshot_date=CASE WHEN latest_snapshot_date IS NULL OR latest_snapshot_date<? THEN ? ELSE latest_snapshot_date END,
    last_seen_at=?,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND active=1`).bind(
    input.dataDate, input.dataDate, input.dataDate, input.dataDate, now, symbol,
  )));
  if (input.runId) await heartbeatTdccContinuousRun({ db: input.db, runId: input.runId, latestDataDate: input.dataDate, now });
  return { dataDate: input.dataDate, symbols: symbols.length };
}

function parseJsonArray(value: unknown) {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

function toSymbolStatus(row: TdccContinuousSymbolRow) {
  const missingDates = parseJsonArray(row?.missing_dates_json);
  const candidateStatus = row?.status;
  const status: TdccContinuousState = candidateStatus && TDCC_CONTINUOUS_STATES.includes(candidateStatus)
    ? candidateStatus
    : "failed";
  const queuedSince = ["queued", "partial", "failed"].includes(status) ? row?.first_seen_at || null : null;
  const queuedAt = Date.parse(String(queuedSince || ""));
  const handoffOverdue = ["queued", "partial", "failed"].includes(status)
    && Number.isFinite(queuedAt) && Date.now() - queuedAt >= 5 * 60 * 1000
    && (!row?.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.now());
  const handoffStatus = status === "running" ? "running"
    : status === "completed" ? "completed"
      : status === "blocked" ? "degraded"
        : ["queued", "partial", "failed"].includes(status) ? "pending" : "idle";
  return {
    symbol: String(row?.symbol || ""), source: String(row?.source || ""), catalogRevision: String(row?.catalog_revision || ""),
    active: Boolean(row?.active), status,
    targetStart: row?.target_start || null, targetEnd: row?.target_end || null,
    expectedWeeks: Number(row?.expected_weeks || 0), completedWeeks: Number(row?.completed_weeks || 0), failedWeeks: Number(row?.failed_weeks || 0),
    missingWeeks: missingDates.length, missingDates: missingDates.slice(0, 12), checkpoint: row?.checkpoint_date || null,
    latestSnapshotDate: row?.latest_snapshot_date || null, officialPlanThrough: row?.official_plan_through || null,
    coverageVerifiedAt: row?.coverage_verified_at || null, lastSuccessAt: row?.history_success_at || null,
    nextRetryAt: row?.next_retry_at || null, lastErrorCode: row?.last_error_code || null,
    leaseExpiresAt: row?.lease_expires_at || null, firstSeenAt: row?.first_seen_at || null, queuedSince,
    handoff: { status: handoffStatus, overdue: handoffOverdue, queuedSince, leaseExpiresAt: row?.lease_expires_at || null },
    updatedAt: row?.updated_at || null,
  };
}

export async function readTdccContinuousSymbolStatus(db: D1Database | undefined, symbol: string) {
  const normalized = normalizedSymbol(symbol);
  const idle = {
    symbol: normalized, source: "", catalogRevision: "", active: false, status: "idle" as const,
    targetStart: null, targetEnd: null, expectedWeeks: 0, completedWeeks: 0, failedWeeks: 0,
    missingWeeks: 0, missingDates: [] as string[], checkpoint: null, latestSnapshotDate: null,
    officialPlanThrough: null, coverageVerifiedAt: null, lastSuccessAt: null, nextRetryAt: null,
    lastErrorCode: null, leaseExpiresAt: null, firstSeenAt: null, queuedSince: null,
    handoff: { status: "idle" as const, overdue: false, queuedSince: null, leaseExpiresAt: null }, updatedAt: null,
  };
  if (!db) return idle;
  const row = await db.prepare("SELECT * FROM tdcc_continuous_symbols WHERE symbol=?").bind(normalized).first<TdccContinuousSymbolRow>();
  if (!row) return idle;
  return toSymbolStatus(row);
}

export async function readTdccContinuousHealth(db: D1Database | undefined, now = new Date()) {
  const unavailable = { configured: false, status: "unavailable", scheduler: TDCC_CONTINUOUS_CONTRACT.scheduler, lastRunId: null, lastRunTrigger: null, lastRunStatus: null, lastHeartbeatAt: null, latestDataDate: null, targetSymbols: 0, queuedSymbols: 0, runningSymbols: 0, completedSymbols: 0, blockedSymbols: 0, missingTargetSymbols: 0, reconciliationRequiredSymbols: 0, handoffOverdueSymbols: 0, lastErrorCode: "d1_unavailable" };
  if (!db) return unavailable;
  try {
    const run = await db.prepare("SELECT * FROM tdcc_continuous_runs ORDER BY updated_at DESC LIMIT 1").first<TdccContinuousRunRow>();
    const successfulRun = await db.prepare("SELECT completed_at,heartbeat_at FROM tdcc_continuous_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1").first<TdccSuccessfulRunRow>();
    const handoffCutoff = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const counts = await db.prepare(`SELECT
      COUNT(CASE WHEN active=1 THEN 1 END) AS targets,
      COUNT(CASE WHEN active=1 AND status IN ('queued','partial','failed') THEN 1 END) AS queued,
      COUNT(CASE WHEN active=1 AND status='running' THEN 1 END) AS running,
      COUNT(CASE WHEN active=1 AND status='completed' THEN 1 END) AS completed,
      COUNT(CASE WHEN active=1 AND status='blocked' THEN 1 END) AS blocked,
      COUNT(CASE WHEN active=1 AND (expected_weeks>completed_weeks OR missing_dates_json!='[]') THEN 1 END) AS missing_targets,
      COUNT(CASE WHEN active=1 AND latest_snapshot_date IS NOT NULL AND (official_plan_through IS NULL OR official_plan_through<latest_snapshot_date) THEN 1 END) AS reconciliation_required,
      COUNT(CASE WHEN active=1 AND status IN ('queued','partial','failed') AND first_seen_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) THEN 1 END) AS handoff_overdue,
      MAX(CASE WHEN active=1 THEN latest_snapshot_date END) AS latest_data_date FROM tdcc_continuous_symbols`).bind(handoffCutoff, now.toISOString()).first<TdccHealthCountsRow>();
    const heartbeat = run?.heartbeat_at || null;
    const stale = heartbeat ? now.getTime() - Date.parse(heartbeat) > 36 * 3600000 : true;
    const degraded = Number(counts?.missing_targets || 0) > 0 || Number(counts?.reconciliation_required || 0) > 0 || Number(counts?.handoff_overdue || 0) > 0;
    return {
      configured: true,
      status: stale ? "scheduler_stale" : run?.status === "failed" ? "failed" : degraded ? "degraded" : "healthy",
      scheduler: TDCC_CONTINUOUS_CONTRACT.scheduler,
      lastRunId: run?.run_id || null,
      lastRunTrigger: run?.trigger || null,
      lastRunStatus: run?.status || null,
      lastHeartbeatAt: heartbeat,
      lastSuccessfulRunAt: successfulRun?.completed_at || successfulRun?.heartbeat_at || null,
      latestDataDate: counts?.latest_data_date || run?.latest_data_date || null,
      targetSymbols: Number(counts?.targets || 0), queuedSymbols: Number(counts?.queued || 0), runningSymbols: Number(counts?.running || 0), completedSymbols: Number(counts?.completed || 0), blockedSymbols: Number(counts?.blocked || 0),
      missingTargetSymbols: Number(counts?.missing_targets || 0), reconciliationRequiredSymbols: Number(counts?.reconciliation_required || 0), handoffOverdueSymbols: Number(counts?.handoff_overdue || 0),
      lastErrorCode: stale ? "scheduler_stale" : run?.error_code || null,
      nextRetryAt: run?.next_retry_at || null,
    };
  } catch {
    return unavailable;
  }
}
