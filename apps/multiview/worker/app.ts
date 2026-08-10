import { acquireCandleHistory, mergeCandleHistory, type HistoryCandle } from "./candle-history";
import { runD1Batch } from "./d1-batch.ts";
import { candlePayloadFromRows, fetchCandles, providerForCandleSymbol } from "./market-data";
import {
  indicatorParameterSignature,
  indicatorParametersFromSearchParams,
  type Candle,
  type IndicatorParameters,
} from "./indicators";
import { normalizePivotMode, pivotReferenceInterval, type PivotMode } from "./pivot-points";
import {
  inferredExchange,
  LOCALIZED_INSTRUMENT_SEED,
  mergeCandidates,
  normalizeSearchText,
  normalizeSymbol,
  scoreCatalogEntry,
  seedForSymbol,
  toCandidate,
  type CatalogEntry,
  type InstrumentCandidate,
} from "./instrument-catalog";
import { isEligibleTaiwanEquity, isEligibleWatchlistTaiwanEquity } from "./taiwan-stock-chip";
import { handleTaiwanStockChipRequest, ingestTdccDistributionSnapshot, prewarmTaiwanStockChipSymbol } from "./taiwan-stock-chip-service";
import {
  completeTdccBackfillWeek,
  failTdccBackfillWeek,
  markTdccBackfillWeekRunning,
  readTdccHistoryBackfillDefinition,
  readTdccHistoryBackfillStatus,
  safeTdccBackfillError,
  startTdccHistoryBackfill,
} from "./tdcc-history-backfill";
import {
  TDCC_CONTINUOUS_CONTRACT,
  claimTdccContinuousSymbols,
  completeTdccContinuousWeek,
  failTdccContinuousWork,
  finishTdccContinuousRun,
  heartbeatTdccContinuousLease,
  heartbeatTdccContinuousRun,
  planTdccContinuousDates,
  queueTdccContinuousSymbolBackfill,
  readTdccContinuousHealth,
  readTdccContinuousSymbolStatus,
  recordTdccLatestSnapshot,
  releaseTdccContinuousSymbol,
  safeTdccContinuousError,
  startTdccContinuousRun,
  syncTdccContinuousTargets,
  upsertTdccContinuousTarget,
  type TdccContinuousTarget,
} from "./tdcc-continuous-backfill";
import {
  WATCHLIST_CHIP_PREWARM_CONTRACT,
  WATCHLIST_CHIP_ATTEMPT_COOLDOWN_MS,
  discoverWatchlistChipWarmTargets,
  readWatchlistChipPrewarmHealth,
} from "./watchlist-chip-prewarming";
import {
  CHIP_BACKFILL_ORCHESTRATOR_CONTRACT,
  advanceChipBackfillOrchestratorRun,
  failChipBackfillOrchestratorRun,
  readChipBackfillOrchestratorHealth,
  readChipBackfillOrchestratorRun,
  safeChipBackfillWorkflowSummary,
  startChipBackfillOrchestratorRun,
  type ChipBackfillTrigger,
  type ChipBackfillScope,
} from "./chip-backfill-orchestrator";
import { dispatchTdccContinuousWorkflow } from "./tdcc-workflow-dispatch";
import { buildPeRiverResponse, ingestNormalizedPeRiverMonth, peRiverHealth } from "./taiwan-stock-pe-river";
import {
  completePeRiverHistoryTarget,
  completePeRiverLatestLane,
  failPeRiverHistoryTarget,
  readPeRiverContinuousHealth,
  refreshPeRiverOfficialLatest,
  startPeRiverContinuousRun,
} from "./pe-river-continuous-backfill";
import { dispatchPeRiverWorkflowIfStale } from "./pe-river-workflow-dispatch";
import { ensurePeRiverPipelineColumns } from "./pe-river-schema";
import {
  ensureWatchlistMetadataColumns,
  newWatchlistItemId,
  normalizeRecommender,
  taipeiCalendarDate,
} from "./watchlist-metadata";
import {
  personalTabKey,
  resolveEffectiveTabs,
  sourceSystemTabId,
  systemTabKey,
  type ManagedTab,
  type UserTabRow,
} from "./personal-tabs";
import {
  authenticationFailure,
  deploymentTargetForRequest,
  hasTrustedPrincipal,
  requestPrincipal,
  requestUserId,
} from "./request-principal";
import {
  AccessControlError,
  createAccessUser,
  deleteAccessUser,
  listAccessAudit,
  listAccessUsers,
  requireOwnerPrincipal,
  updateAccessUser,
} from "./access-control";
import { readCandleCacheMaintenance } from "./cache-maintenance";
import { recordCacheEvent, runtimeUsageSummary } from "./runtime-usage";
import { localShioajiAdapterHealth } from "./local-shioaji-adapter";
import { notifyRealtimeWatchlistSymbols, readRealtimeHealth, realtimeViewerCapability, type RealtimeEnv } from "./realtime-routing";

type ImagesBinding = {
  input(stream: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
    };
  };
};
export type Env = RealtimeEnv & { ASSETS: Fetcher; DB?: D1Database; IMAGES?: ImagesBinding; APP_COMMIT_SHA?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ACCESS_OWNER_EMAIL?: string; MASSIVE_API_KEY?: string; TPEX_MIRROR_INGEST_SECRET?: string; TDCC_HISTORY_INGEST_SECRET?: string; TDCC_CONTINUOUS_BACKFILL_SECRET?: string; TDCC_HISTORY_AUTOMATION_ENABLED?: string; GITHUB_WORKFLOW_DISPATCH_TOKEN?: string; FINMIND_API_TOKEN?: string; PE_RIVER_INGEST_SECRET?: string; PE_RIVER_BACKFILL_SECRET?: string; PE_RIVER_ACCESS_MODE?: string; PE_RIVER_COMMERCIAL_USE?: string; PE_RIVER_PROVISIONAL_LATEST_ENABLED?: string; SHIOAJI_API_TARGET?: string; MULTIVIEW_STATE_DIR?: string; MULTIVIEW_SCHEMA_REVISION?: string; REALTIME_STOCK_WEB_URL?: string; LOCAL_PIPELINE_SECRET?: string };
type Instrument = {
  symbol: string;
  name: string;
  provider: string;
  tab: string;
  tabId?: string;
  group: string;
  market: string;
  enabled: boolean;
  defaultOrder: number | null;
  itemId?: string | null;
  addedAt?: string | null;
  dateStatus?: "known" | "legacy_unknown";
  dateSource?: "server" | null;
  recommender?: string;
};
type MarketTab = { tabKey?: string; id: string; label: string; displayLabel: string; sortOrder: number; enabled: boolean; isDefault?: boolean; source: string; sourceTabId?: string; defaultSymbols: string[]; overrideRowId?: string; hasOverride?: boolean };
type ReorderScope = "system" | "personal";
type ReorderItemIdentity = { symbol: string; tabId: string };
type ReorderRequest = { tabId: string; tabLabel: string; scope: ReorderScope; items: ReorderItemIdentity[]; revision: number };
type AppExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type JsonObject = Record<string, unknown>;
type UserInstrumentRow = {
  item_id?: string | null;
  symbol: string;
  name: string;
  provider: string;
  tab_id?: string | null;
  tab_label: string;
  group_name: string;
  market: string;
  enabled: number;
  sort_order?: number | null;
  added_at?: string | null;
  date_status?: string | null;
  date_source?: string | null;
  recommender?: string | null;
};
type CatalogDbRow = {
  symbol?: unknown; exchange?: unknown; localized_name?: unknown; english_name?: unknown; aliases_json?: unknown;
  market?: unknown; group_name?: unknown; quote_type?: unknown; provider?: unknown; source?: unknown;
  source_updated_at?: unknown; active?: unknown;
};
type OfficialCatalogRow = {
  Code?: unknown; code?: unknown; Name?: unknown; localizedName?: unknown;
  SecuritiesCompanyCode?: unknown; CompanyName?: unknown; quoteType?: unknown;
  englishName?: unknown; aliases?: unknown; symbol?: unknown; longname?: unknown;
  shortname?: unknown; exchange?: unknown; exchDisp?: unknown; typeDisp?: unknown;
};
type CandlePayloadResult = ReturnType<typeof candlePayloadFromRows> & {
  realtimeDailyHistory?: Candle[];
  realtimeCanonicalHandoff?: { sessionDate: string | null; verificationStatus: string };
};
type QuoteState = CandlePayloadResult["quote"];
type CandleCacheRow = { payload?: string | null; expires_at?: number | null };
type CatalogSourceTotalRow = { source?: string | null; rows?: number | null; source_updated_at?: string | null };
type SymbolRow = { symbol: string };
type TaiwanMarketRow = Record<string, unknown>;
type TwseMiTable = { fields?: unknown; data?: unknown };
type TwseMiIndexPayload = { stat?: unknown; date?: unknown; tables?: TwseMiTable[] };
type TpexMarketPayload = { tables?: Array<{ date?: unknown; fields?: unknown; data?: unknown }> };
type TwseMisPayload = { msgArray?: Array<Record<string, unknown>> };
type TpexMirrorRow = { payload?: string | null; source_fetched_at?: string | null };
type MassiveApiRow = Record<string, unknown>;
type MassivePayload = { reason?: string; results?: MassiveApiRow[]; [key: string]: unknown };
type SaveInstrumentInput = { symbol?: unknown; name?: unknown; provider?: unknown; tabId?: unknown; tab?: unknown; group?: unknown; market?: unknown; enabled?: unknown; defaultOrder?: unknown; recommender?: unknown };
type ChipHealthRow = { dataset: string; coverage_start?: string | null; coverage_end?: string | null; source_date?: string | null; status?: string | null; reason_code?: string | null; last_success_at?: string | null; last_attempt_at?: string | null };
type ChipBackfillStateRow = ChipHealthRow & { symbol?: string | null; retry_after?: string | null };
type ExistingWatchlistRow = { item_id?: string | null; recommender?: string | null };

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export const INTERVALS = ["1d", "1wk", "1mo"];
export const LOCAL_INTERVALS = ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"];
const intervalsForRequest = (request: Request) =>
  deploymentTargetForRequest(request) === "local" ? LOCAL_INTERVALS : INTERVALS;
const TAB_IDS: Record<string, string> = { "台股": "taiwan-stocks", "美股": "us-stocks", "匯率債券": "fx-bonds", "期貨期指": "index-futures" };
const TAB_MARKETS: Record<string, string> = { "台股": "台灣股市", "美股": "美股", "匯率債券": "匯率債券", "期貨期指": "美國指數期貨", "其他": "其他" };
const CANDLE_CACHE_CONTRACT_VERSION = "quote-state-v17-support-resistance-source-interval";
const databaseReady = new WeakMap<object, Promise<void>>();
const migrationManagedDatabases = new WeakSet<object>();
const MANUAL_CHIP_BACKFILL_DATASETS = ["institutional-flow", "foreign-holding", "margin-short", "securities-lending", "shareholder-distribution"] as const;
const MANUAL_CHIP_BACKFILL_COOLDOWN_MS = 60 * 1000;

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const internalAuthorization = (request: Request) => request.headers.get("x-multichart-pipeline-authorization") || request.headers.get("authorization");
const userId = (request: Request) => requestUserId(request) || "";
const identifiedUserId = (request: Request) => requestUserId(request);

async function ingestPeRiverMonth(request: Request, env: Env) {
  const local = ["localhost", "127.0.0.1", "::1"].includes(new URL(request.url).hostname);
  if (!env.DB || (!local && !env.PE_RIVER_INGEST_SECRET)) return json({ ok: false, reasonCode: "blocked" }, 503);
  const identified = local
    || hasTrustedPrincipal(request)
    || /^Bearer\s+\S+$/.test(request.headers.get("OAI-Sites-Authorization") || "")
    || Boolean(request.headers.get("x-dispatched-app")?.trim());
  const authorized = local
    ? env.LOCAL_PIPELINE_SECRET
      ? internalAuthorization(request) === `Bearer ${env.LOCAL_PIPELINE_SECRET}`
      : request.headers.get("x-pe-river-local-test") === "1"
    : internalAuthorization(request) === `Bearer ${env.PE_RIVER_INGEST_SECRET}`;
  if (!identified || !authorized) return json({ ok: false, reasonCode: "unauthorized" }, 401);
  await ensureDb(env.DB);
  let body: { symbol?: string; month?: string; rows?: unknown };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 200_000) return json({ ok: false, reasonCode: "invalid_payload" }, 413);
    body = JSON.parse(raw);
  }
  catch { return json({ ok: false, reasonCode: "invalid_payload" }, 400); }
  try {
    const result = await ingestNormalizedPeRiverMonth({ db: env.DB, symbol: body.symbol || "", month: body.month || "", rows: body.rows });
    return json({ ok: true, ...result });
  } catch {
    return json({ ok: false, reasonCode: "invalid_payload" }, 400);
  }
}

async function peRiverContinuousBackfill(request: Request, env: Env) {
  const local = ["localhost", "127.0.0.1", "::1"].includes(new URL(request.url).hostname);
  if (!env.DB || (!local && !env.PE_RIVER_BACKFILL_SECRET)) return json({ ok: false, reasonCode: "blocked" }, 503);
  const identified = local
    || hasTrustedPrincipal(request)
    || /^Bearer\s+\S+$/.test(request.headers.get("OAI-Sites-Authorization") || "")
    || Boolean(request.headers.get("x-dispatched-app")?.trim());
  const authorized = local
    ? env.LOCAL_PIPELINE_SECRET
      ? internalAuthorization(request) === `Bearer ${env.LOCAL_PIPELINE_SECRET}`
      : request.headers.get("x-pe-river-local-test") === "1"
    : internalAuthorization(request) === `Bearer ${env.PE_RIVER_BACKFILL_SECRET}`;
  if (!identified || !authorized) return json({ ok: false, reasonCode: "unauthorized" }, 401);
  const accessMode = String(env.PE_RIVER_ACCESS_MODE || "custom").toLowerCase();
  if (!["private", "custom", "owner-only"].includes(accessMode) || String(env.PE_RIVER_COMMERCIAL_USE || "false").toLowerCase() === "true") return json({ ok: false, reasonCode: "license_review_required" }, 412);
  await ensureDb(env.DB);
  if (request.method === "GET") return json({ ok: true, ...(await readPeRiverContinuousHealth(env.DB)) });
  let body: JsonObject;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 64_000) return json({ ok: false, reasonCode: "invalid_payload" }, 413);
    body = jsonObject(JSON.parse(raw));
  }
  catch { return json({ ok: false, reasonCode: "invalid_payload" }, 400); }
  try {
    if (body.action === "start") return json({ ok: true, ...(await startPeRiverContinuousRun({ db: env.DB, runId: String(body.runId || ""), trigger: body.trigger === "schedule" ? "schedule" : "workflow_dispatch" })) });
    if (body.action === "latest-refresh") return json({ ok: true, ...(await refreshPeRiverOfficialLatest({ db: env.DB, runId: String(body.runId || ""), provisionalEnabled: String(env.PE_RIVER_PROVISIONAL_LATEST_ENABLED || "false").toLowerCase() === "true" })) });
    if (body.action === "latest-complete") return json({ ok: true, ...(await completePeRiverLatestLane({ db: env.DB, runId: String(body.runId || ""), twseSourceDate: typeof body.twseSourceDate === "string" ? body.twseSourceDate : null, tpexSourceDate: typeof body.tpexSourceDate === "string" ? body.tpexSourceDate : null })) });
    if (body.action === "history-complete") return json({ ok: true, ...(await completePeRiverHistoryTarget({ db: env.DB, runId: String(body.runId || ""), jobId: String(body.jobId || ""), symbol: String(body.symbol || ""), validationStatus: String(body.validationStatus || ""), overlapDate: typeof body.overlapDate === "string" ? body.overlapDate : null })) });
    if (body.action === "history-failed") return json({ ok: true, ...(await failPeRiverHistoryTarget({ db: env.DB, runId: String(body.runId || ""), jobId: String(body.jobId || ""), error: String(body.reasonCode || "invalid_payload"), attempt: Number(body.attempt || 1), retryAfter: typeof body.retryAfter === "string" ? body.retryAfter : null })) });
    return json({ ok: false, reasonCode: "invalid_payload" }, 400);
  } catch (error) {
    const reasonCode = String(error instanceof Error ? error.message : "invalid_payload");
    return json({ ok: false, reasonCode: ["invalid_payload", "lease_conflict", "license_review_required"].includes(reasonCode) ? reasonCode : "invalid_payload" }, reasonCode === "lease_conflict" ? 409 : 400);
  }
}

async function setupText(request: Request, env: Env) {
  const url = new URL("/data/stock_setup.md", request.url);
  const response = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
  return response.text();
}

function parseSetup(text: string): Instrument[] {
  return text.split("\n").flatMap((line) => {
    if (!line.startsWith("|") || line.includes("---") || line.includes("頁籤 |")) return [];
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 7 || !cells[3]) return [];
    const [tab, group, order, symbol, name, provider, enabled] = cells;
    return [{ symbol: symbol.toUpperCase(), name, provider, tab, group, market: TAB_MARKETS[tab] ?? tab, enabled: !["no", "false", "0"].includes(enabled.toLowerCase()), defaultOrder: order ? Number(order) : null }];
  });
}

function systemTabs(instruments: Instrument[]): MarketTab[] {
  return Object.keys(TAB_IDS).map((label, index) => ({ id: TAB_IDS[label], label, displayLabel: label, sortOrder: index + 1, enabled: true, isDefault: index === 0, source: "system", defaultSymbols: instruments.filter((item) => item.tab === label && item.enabled && item.defaultOrder !== null).sort((a, b) => (a.defaultOrder ?? 999) - (b.defaultOrder ?? 999)).map((item) => item.symbol) }));
}

async function ensureDb(db?: D1Database) {
  if (!db) return;
  const key = db as object;
  let ready = databaseReady.get(key);
  if (!ready) {
    ready = (async () => {
      if (migrationManagedDatabases.has(key)) {
        const seeded = await db.prepare("SELECT value FROM runtime_metadata WHERE key='localized-catalog-seed'").first<{ value?: string | null }>();
        if (seeded?.value !== "seed-v1") {
          await seedLocalizedCatalog(db);
          await db.prepare("INSERT INTO runtime_metadata (key,value) VALUES ('localized-catalog-seed','seed-v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run();
        }
        return;
      }
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS user_tabs (user_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, source_tab_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_instruments (user_id TEXT NOT NULL, item_id TEXT, symbol TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL, tab_id TEXT NOT NULL DEFAULT '', tab_label TEXT NOT NULL, group_name TEXT NOT NULL, market TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER, added_at TEXT, date_status TEXT NOT NULL DEFAULT 'legacy_unknown', date_source TEXT, recommender TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, symbol, tab_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS candle_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS candle_cache_expires_at_idx ON candle_cache (expires_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cache_maintenance_state (maintenance_key TEXT PRIMARY KEY NOT NULL, last_run_at TEXT, deleted_rows INTEGER NOT NULL DEFAULT 0, remaining_rows INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'not_run', reason_code TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS candle_history (provider TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL, time INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL DEFAULT 0, quote_time INTEGER, source TEXT NOT NULL, source_updated_at TEXT, market_session TEXT, source_time_zone TEXT, fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (provider,symbol,interval,time))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS candle_history_lookup_idx ON candle_history (provider,symbol,interval,time)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS candle_history_state (provider TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL, full_window_complete INTEGER NOT NULL DEFAULT 0, coverage_start INTEGER, coverage_end INTEGER, available_rows INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unknown', reason_code TEXT, last_full_fetch_at TEXT, last_tail_fetch_at TEXT, retry_after TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (provider,symbol,interval))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS candle_history_state_retry_idx ON candle_history_state (status,retry_after)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tpex_market_mirror (session_date TEXT PRIMARY KEY, payload TEXT NOT NULL, source_fetched_at TEXT NOT NULL, ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS instrument_catalog (symbol TEXT NOT NULL, exchange TEXT NOT NULL, localized_name TEXT NOT NULL, english_name TEXT NOT NULL DEFAULT '', aliases_json TEXT NOT NULL DEFAULT '[]', normalized_search TEXT NOT NULL, market TEXT NOT NULL, group_name TEXT NOT NULL, quote_type TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT 'yfinance', source TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, source_updated_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (symbol, exchange))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS instrument_catalog_symbol_idx ON instrument_catalog (symbol)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS instrument_catalog_source_idx ON instrument_catalog (source)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS instrument_catalog_normalized_idx ON instrument_catalog (normalized_search)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_chip_daily (symbol TEXT NOT NULL, session_date TEXT NOT NULL, exchange TEXT NOT NULL, institutional_flow_json TEXT, foreign_holding_json TEXT, margin_short_json TEXT, securities_lending_json TEXT, provenance_json TEXT NOT NULL DEFAULT '{}', completeness_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (symbol, session_date))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS taiwan_stock_chip_daily_symbol_date_idx ON taiwan_stock_chip_daily (symbol, session_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_shareholder_distribution (symbol TEXT NOT NULL, data_date TEXT NOT NULL, levels_json TEXT NOT NULL, adjustment_json TEXT NOT NULL, total_json TEXT NOT NULL, provider TEXT NOT NULL, frequency TEXT NOT NULL DEFAULT 'weekly', source_fetched_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (symbol, data_date))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS taiwan_stock_shareholder_symbol_date_idx ON taiwan_stock_shareholder_distribution (symbol, data_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_chip_fetch_state (symbol TEXT NOT NULL, dataset TEXT NOT NULL, coverage_start TEXT, coverage_end TEXT, source_date TEXT, status TEXT NOT NULL, reason_code TEXT NOT NULL, last_success_at TEXT, last_attempt_at TEXT, retry_after TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (symbol, dataset))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS taiwan_stock_chip_fetch_retry_idx ON taiwan_stock_chip_fetch_state (retry_after)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tdcc_shareholder_backfill_job (job_id TEXT PRIMARY KEY, mode TEXT NOT NULL, target_start TEXT NOT NULL, target_end TEXT NOT NULL, expected_dates_json TEXT NOT NULL, target_symbols_json TEXT NOT NULL DEFAULT '[]', expected_symbols INTEGER NOT NULL DEFAULT 0, expected_weeks INTEGER NOT NULL, completed_weeks INTEGER NOT NULL DEFAULT 0, failed_weeks INTEGER NOT NULL DEFAULT 0, checkpoint_date TEXT, status TEXT NOT NULL, last_error_code TEXT, last_success_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_shareholder_backfill_status_idx ON tdcc_shareholder_backfill_job (status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tdcc_shareholder_backfill_week (job_id TEXT NOT NULL, data_date TEXT NOT NULL, status TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, symbol_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0, completed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (job_id, data_date))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_shareholder_backfill_week_status_idx ON tdcc_shareholder_backfill_week (job_id, status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tdcc_continuous_runs (run_id TEXT PRIMARY KEY, trigger TEXT NOT NULL, status TEXT NOT NULL, latest_data_date TEXT, target_count INTEGER NOT NULL DEFAULT 0, queued_count INTEGER NOT NULL DEFAULT 0, claimed_count INTEGER NOT NULL DEFAULT 0, completed_count INTEGER NOT NULL DEFAULT 0, blocked_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, next_retry_at TEXT, heartbeat_at TEXT, started_at TEXT NOT NULL, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_continuous_runs_status_idx ON tdcc_continuous_runs (status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS chip_backfill_orchestrator_runs (run_id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'combined', trigger TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, expected_session_date TEXT NOT NULL, latest_data_date TEXT, processed_symbols_json TEXT NOT NULL DEFAULT '[]', processed_symbols INTEGER NOT NULL DEFAULT 0, remaining_symbols INTEGER NOT NULL DEFAULT 0, pending_symbols INTEGER NOT NULL DEFAULT 0, last_symbol TEXT, last_reason_code TEXT, heartbeat_at TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS chip_backfill_orchestrator_runs_status_idx ON chip_backfill_orchestrator_runs (status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tdcc_backfill_dispatches (symbol TEXT PRIMARY KEY, status TEXT NOT NULL, requested_at TEXT NOT NULL, cooldown_until TEXT, last_error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_backfill_dispatches_status_idx ON tdcc_backfill_dispatches (status, cooldown_until)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tdcc_continuous_symbols (symbol TEXT PRIMARY KEY, source TEXT NOT NULL, official_baseline INTEGER NOT NULL DEFAULT 0, catalog_revision TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, target_start TEXT, target_end TEXT, expected_weeks INTEGER NOT NULL DEFAULT 0, completed_weeks INTEGER NOT NULL DEFAULT 0, failed_weeks INTEGER NOT NULL DEFAULT 0, missing_dates_json TEXT NOT NULL DEFAULT '[]', checkpoint_date TEXT, latest_snapshot_date TEXT, history_success_at TEXT, next_retry_at TEXT, last_error_code TEXT, lease_owner TEXT, lease_expires_at TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_continuous_symbols_queue_idx ON tdcc_continuous_symbols (active, status, next_retry_at, first_seen_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_continuous_symbols_lease_idx ON tdcc_continuous_symbols (lease_expires_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tdcc_continuous_items (symbol TEXT NOT NULL, data_date TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 100, attempts INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at TEXT, next_retry_at TEXT, error_code TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (symbol, data_date))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_continuous_items_queue_idx ON tdcc_continuous_items (status, next_retry_at, priority, created_at)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS tdcc_continuous_items_lease_idx ON tdcc_continuous_items (lease_expires_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_pe_valuation_daily (exchange TEXT NOT NULL, symbol TEXT NOT NULL, session_date TEXT NOT NULL, official_close REAL NOT NULL, official_pe_ratio REAL NOT NULL, reference_eps REAL NOT NULL, fiscal_year TEXT, fiscal_quarter TEXT, source TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'official', original_source TEXT NOT NULL DEFAULT 'unknown', validation_status TEXT NOT NULL DEFAULT 'official_verified', official_overlap_date TEXT, source_date TEXT NOT NULL, fetched_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (exchange,symbol,session_date))`),
        db.prepare(`CREATE INDEX IF NOT EXISTS taiwan_stock_pe_valuation_lookup_idx ON taiwan_stock_pe_valuation_daily (symbol,session_date)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_pe_fetch_state (exchange TEXT NOT NULL, symbol TEXT NOT NULL, requested_start TEXT, requested_end TEXT, coverage_start TEXT, coverage_end TEXT, source_date TEXT, latest_source_date TEXT, provider_verified_at TEXT, lane TEXT NOT NULL DEFAULT 'history', status TEXT NOT NULL, reason_code TEXT NOT NULL, last_success_at TEXT, last_attempt_at TEXT, retry_after TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (exchange,symbol))`),
        db.prepare(`CREATE INDEX IF NOT EXISTS taiwan_stock_pe_fetch_retry_idx ON taiwan_stock_pe_fetch_state (status,retry_after)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_pe_backfill_job (job_id TEXT PRIMARY KEY, exchange TEXT NOT NULL, symbol TEXT NOT NULL, target_start TEXT NOT NULL, target_end TEXT NOT NULL, status TEXT NOT NULL, reason_code TEXT NOT NULL, lane TEXT NOT NULL DEFAULT 'history', latest_source_date TEXT, provider_verified_at TEXT, total_months INTEGER NOT NULL DEFAULT 0, completed_months INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at TEXT, retry_after TEXT, last_success_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS taiwan_stock_pe_job_symbol_idx ON taiwan_stock_pe_backfill_job (exchange,symbol)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS taiwan_stock_pe_job_queue_idx ON taiwan_stock_pe_backfill_job (status,retry_after,lease_expires_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_pe_backfill_month (job_id TEXT NOT NULL, exchange TEXT NOT NULL, symbol TEXT NOT NULL, target_month TEXT NOT NULL, status TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, dataset_status_json TEXT NOT NULL DEFAULT '{}', ingest_cursor INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at TEXT, retry_after TEXT, error_code TEXT, completed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (exchange,symbol,target_month))`),
        db.prepare(`CREATE INDEX IF NOT EXISTS taiwan_stock_pe_month_queue_idx ON taiwan_stock_pe_backfill_month (status,retry_after,lease_expires_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS taiwan_stock_pe_control (control_key TEXT PRIMARY KEY NOT NULL, scheduler_heartbeat_at TEXT, last_latest_run_at TEXT, last_history_run_at TEXT, latest_twse_source_date TEXT, latest_tpex_source_date TEXT, budget_window_start TEXT, budget_used INTEGER NOT NULL DEFAULT 0, budget_limit INTEGER NOT NULL DEFAULT 240, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
      ]);
      await ensureWatchlistMetadataColumns(db);
      await ensurePeRiverPipelineColumns(db);
      await seedLocalizedCatalog(db);
    })().catch((error) => {
      databaseReady.delete(key);
      throw error;
    });
    databaseReady.set(key, ready);
  }
  await ready;
}

export function markDeployTimeMigrations(db?: D1Database) {
  if (db) migrationManagedDatabases.add(db as object);
}

function normalizedCatalogSearch(item: CatalogEntry) {
  return [item.symbol, item.localizedName, item.englishName, ...item.aliases].map(normalizeSearchText).filter(Boolean).join(" ");
}

function catalogUpsertStatement(db: D1Database, item: CatalogEntry, sourceUpdatedAt: string) {
  return db.prepare(`INSERT INTO instrument_catalog (symbol,exchange,localized_name,english_name,aliases_json,normalized_search,market,group_name,quote_type,provider,source,active,source_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol,exchange) DO UPDATE SET localized_name=excluded.localized_name,english_name=excluded.english_name,aliases_json=excluded.aliases_json,normalized_search=excluded.normalized_search,market=excluded.market,group_name=excluded.group_name,quote_type=excluded.quote_type,provider=excluded.provider,source=excluded.source,active=excluded.active,source_updated_at=excluded.source_updated_at,updated_at=CURRENT_TIMESTAMP`).bind(
    normalizeSymbol(item.symbol), inferredExchange(item.symbol, item.exchange), item.localizedName, item.englishName || "", JSON.stringify(item.aliases || []), normalizedCatalogSearch(item), item.market, item.group, item.quoteType || "", item.provider || "yfinance", item.source, item.active === false ? 0 : 1, sourceUpdatedAt,
  );
}

async function seedLocalizedCatalog(db: D1Database) {
  const sourceUpdatedAt = "seed-v1";
  const statements = LOCALIZED_INSTRUMENT_SEED.map((item) => catalogUpsertStatement(db, item, sourceUpdatedAt));
  await runD1Batch(db, statements);
}

async function personalTabRows(db: D1Database | undefined, uid: string): Promise<UserTabRow[]> {
  if (!db) return [];
  await ensureDb(db);
  const result = await db.prepare("SELECT * FROM user_tabs WHERE user_id = ? ORDER BY sort_order, label").bind(uid).all<UserTabRow>();
  return result.results;
}

function compatiblePersonalTabs(rows: UserTabRow[]): MarketTab[] {
  const systemIds = new Set(Object.values(TAB_IDS));
  return rows.map((row) => {
    const sourceTabId = sourceSystemTabId(row, systemIds);
    return {
      tabKey: sourceTabId ? systemTabKey(sourceTabId) : personalTabKey(row.id),
      id: row.id,
      label: row.label,
      displayLabel: row.label,
      sortOrder: row.sort_order,
      enabled: Boolean(row.enabled),
      isDefault: Boolean(row.is_default),
      source: sourceTabId ? "personal-override" : "personal",
      sourceTabId,
      defaultSymbols: [],
      overrideRowId: row.id,
      hasOverride: Boolean(sourceTabId),
    };
  });
}

async function personalInstruments(db: D1Database | undefined, uid: string): Promise<Instrument[]> {
  if (!db) return [];
  await ensureDb(db);
  const result = await db.prepare("SELECT * FROM user_instruments WHERE user_id = ? ORDER BY COALESCE(sort_order, 999999), symbol").bind(uid).all<UserInstrumentRow>();
  return result.results.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    provider: row.provider,
    tabId: row.tab_id,
    tab: row.tab_label,
    group: row.group_name,
    market: row.market,
    enabled: Boolean(row.enabled),
    defaultOrder: row.sort_order,
    itemId: row.item_id || null,
    addedAt: row.added_at || null,
    dateStatus: row.date_status === "known" ? "known" : "legacy_unknown",
    dateSource: row.date_source === "server" ? "server" : null,
    recommender: row.recommender || "",
  }));
}

async function instrumentPayload(request: Request, env: Env) {
  const base = parseSetup(await setupText(request, env));
  const uid = userId(request);
  const [tabRows, custom] = await Promise.all([personalTabRows(env.DB, uid), personalInstruments(env.DB, uid)]);
  const merged = [...base];
  for (const item of custom) {
    const index = merged.findIndex((candidate) => candidate.symbol === item.symbol && (candidate.tabId ?? "") === (item.tabId ?? ""));
    if (index >= 0) merged[index] = item; else merged.push(item);
  }
  const model = resolveEffectiveTabs(systemTabs(merged), tabRows);
  const systemLabelById = new Map(Object.entries(TAB_IDS).map(([label, id]) => [id, label]));
  for (const tab of model.managedTabs) {
    if (tab.tabKey.startsWith("system:")) {
      const baseLabel = systemLabelById.get(tab.sourceTabId || tab.id) || tab.label;
      tab.defaultSymbols = merged
        .filter((item) => item.enabled && !item.tabId && (item.tab === baseLabel || item.tab === tab.label))
        .sort((a, b) => (a.defaultOrder ?? Number.MAX_SAFE_INTEGER) - (b.defaultOrder ?? Number.MAX_SAFE_INTEGER) || a.symbol.localeCompare(b.symbol))
        .map((item) => item.symbol);
    } else if (tab.source === "personal") tab.defaultSymbols = merged
      .filter((item) => item.enabled && (item.tabId === tab.id || (!item.tabId && item.tab === tab.label)))
      .sort((a, b) => (a.defaultOrder ?? Number.MAX_SAFE_INTEGER) - (b.defaultOrder ?? Number.MAX_SAFE_INTEGER) || a.symbol.localeCompare(b.symbol))
      .map((item) => item.symbol);
  }
  return {
    instruments: merged.filter((item) => item.enabled),
    managedTabs: model.managedTabs,
    marketTabs: model.marketTabs,
    personalTabs: compatiblePersonalTabs(tabRows),
    tabDiagnostics: model.diagnostics.map((item) => ({ code: item.code, tabKey: item.tabKey })),
    setupErrors: [],
    intervals: intervalsForRequest(request),
    personalSync: { configured: Boolean(env.DB), authenticated: true },
  };
}

type SearchWarning = { source: string; message: string };

function rowToCatalogEntry(row: CatalogDbRow): CatalogEntry | null {
  const symbol = normalizeSymbol(row?.symbol);
  const localizedName = String(row?.localized_name || "").trim();
  const exchange = inferredExchange(symbol, row?.exchange);
  if (!symbol || !localizedName || !exchange) return null;
  let aliases: string[] = [];
  try { aliases = Array.isArray(row?.aliases_json) ? row.aliases_json : JSON.parse(String(row?.aliases_json || "[]")); }
  catch { aliases = []; }
  return { symbol, exchange, localizedName, englishName: String(row?.english_name || ""), aliases, market: String(row?.market || ""), group: String(row?.group_name || "商品"), quoteType: String(row?.quote_type || ""), provider: String(row?.provider || "yfinance"), source: String(row?.source || "taiwan-catalog").includes("official") ? "taiwan-catalog" : String(row?.source || "catalog"), sourceUpdatedAt: String(row?.source_updated_at || ""), active: Boolean(row?.active ?? true) };
}

async function readInstrumentCatalog(db?: D1Database) {
  if (!db) return [];
  await ensureDb(db);
  const result = await db.prepare("SELECT * FROM instrument_catalog WHERE active = 1").all<CatalogDbRow>();
  return result.results.map(rowToCatalogEntry).filter((item): item is CatalogEntry => Boolean(item));
}

function localCatalogEntry(item: Instrument): CatalogEntry {
  const localized = seedForSymbol(item.symbol);
  return {
    symbol: item.symbol,
    exchange: inferredExchange(item.symbol, localized?.exchange),
    localizedName: localized?.localizedName || item.name,
    englishName: localized?.englishName || (/^[\x00-\x7F]+$/.test(item.name) ? item.name : ""),
    aliases: [...new Set([...(localized?.aliases || []), item.name])],
    market: localized?.market || item.market,
    group: localized?.group || item.group,
    quoteType: localized?.quoteType || (item.group.includes("ETF") ? "ETF" : "EQUITY"),
    provider: localized?.provider || item.provider,
    source: "local",
    active: item.enabled,
  };
}

function isEligibleWatchlistTaiwanInstrument(item: Instrument, catalogEntry?: CatalogEntry) {
  const localEntry = localCatalogEntry(item);
  return isEligibleWatchlistTaiwanEquity(localEntry, catalogEntry);
}

async function fetchOfficialCatalog(source: "twse" | "tpex") {
  const url = source === "twse" ? "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL" : "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes";
  const response = await fetch(url, { headers: { accept: "application/json", "accept-language": "zh-TW,zh;q=0.9", "user-agent": "Mozilla/5.0 CodexSites MultiChart" } });
  if (!response.ok) throw new Error(`${source}:${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(`${source}:invalid`);
  return payload.flatMap((row): CatalogEntry[] => {
    const code = String(source === "twse" ? row?.Code : row?.SecuritiesCompanyCode || "").trim().toUpperCase();
    const localizedName = String(source === "twse" ? row?.Name : row?.CompanyName || "").trim();
    if (!/^[0-9A-Z]{4,8}$/.test(code) || !localizedName) return [];
    const exchange = source === "twse" ? "TWSE" : "TPEx";
    const quoteType = code.startsWith("00") ? "ETF" : "EQUITY";
    return [{ symbol: `${code}.${source === "twse" ? "TW" : "TWO"}`, exchange, localizedName, englishName: "", aliases: [], market: "台灣股市", group: source === "twse" ? (quoteType === "ETF" ? "上市 ETF" : "上市股票") : (quoteType === "ETF" ? "上櫃 ETF" : "上櫃股票"), quoteType, provider: "yfinance", source, active: true }];
  });
}

function externalCandidate(item: OfficialCatalogRow, query: string): InstrumentCandidate | null {
  const symbol = normalizeSymbol(item?.symbol);
  if (!symbol) return null;
  const localized = seedForSymbol(symbol);
  const englishName = String(item?.longname || item?.shortname || item?.symbol || "").trim();
  const catalog: CatalogEntry = localized || { symbol, exchange: String(item?.exchange || item?.exchDisp || ""), localizedName: "", englishName, aliases: [], provider: "yfinance", source: "yahoo-search", market: String(item?.exchDisp || item?.exchange || "外部市場"), group: String(item?.typeDisp || item?.quoteType || "商品"), quoteType: String(item?.quoteType || ""), active: true };
  const match = scoreCatalogEntry(query, catalog) || (/^[\x00-\x7F]+$/.test(query) ? { score: 400, matchedBy: "external" } : null);
  if (!match) return null;
  return { ...catalog, source: localized ? "localized-seed" : "yahoo-search", englishName: localized?.englishName || englishName, name: localized?.localizedName || englishName || symbol, exchange: inferredExchange(symbol, localized?.exchange || item?.exchange || item?.exchDisp), aliases: localized?.aliases || [], enabled: true, ...match };
}

async function searchInstruments(request: Request, env: Env) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 8), 12));
  if (!query) return { query: "", results: [], warning: "", warnings: [] };
  const warnings: SearchWarning[] = [];
  const candidates: InstrumentCandidate[] = [];
  const base = parseSetup(await setupText(request, env));
  for (const item of base) {
    const candidate = toCandidate(localCatalogEntry(item), query);
    if (candidate) candidates.push({ ...candidate, tab: item.tab, tabId: item.tabId, defaultOrder: item.defaultOrder });
  }

  let catalog: CatalogEntry[] = [];
  try { catalog = await readInstrumentCatalog(env.DB); }
  catch { warnings.push({ source: "d1-catalog", message: "商品目錄暫時不可用" }); }
  for (const item of catalog) {
    const candidate = toCandidate(item, query);
    if (candidate) candidates.push(candidate);
  }

  const hasTaiwanCatalog = catalog.some((item) => item.source === "taiwan-catalog" && /\.(TW|TWO)$/.test(item.symbol));
  const hasStrongKnownMatch = candidates.some((item) => item.score >= 750);
  if (!hasTaiwanCatalog && !hasStrongKnownMatch) {
    const officialResults = await Promise.allSettled([fetchOfficialCatalog("twse"), fetchOfficialCatalog("tpex")]);
    for (const [index, result] of officialResults.entries()) {
      const source = index === 0 ? "twse" : "tpex";
      if (result.status === "rejected") warnings.push({ source, message: `${source === "twse" ? "TWSE" : "TPEx"} 官方商品搜尋暫時不可用` });
      else for (const item of result.value) {
        const candidate = toCandidate(item, query);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  if (/^[\x00-\x7F]+$/.test(query)) {
    try {
      const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${limit}&newsCount=0`, { headers: { "user-agent": "Mozilla/5.0 CodexSites MultiChart", "accept-language": "zh-TW,zh;q=0.9,en;q=0.8" } });
      if (!response.ok) throw new Error();
      const payload = jsonObject(await response.json());
      for (const item of Array.isArray(payload.quotes) ? payload.quotes : []) {
        const quote = jsonObject(item) as OfficialCatalogRow;
        const candidate = externalCandidate(quote, query);
        if (candidate) candidates.push(candidate);
      }
    } catch { warnings.push({ source: "yahoo-search", message: "外部商品搜尋暫時不可用，仍可手動輸入商品設定。" }); }
  }
  const results = mergeCandidates(candidates, limit);
  return { query, results, warning: warnings.map((item) => item.message).join("；"), warnings };
}

function cacheTtl(interval: string) {
  return ["1d", "1wk", "1mo"].includes(interval) ? 300 : 20;
}

function taipeiClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday || "",
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function previousTaiwanWeekday(dateText: string) {
  const date = new Date(`${dateText}T00:00:00Z`);
  do { date.setUTCDate(date.getUTCDate() - 1); } while ([0, 6].includes(date.getUTCDay()));
  return date.toISOString().slice(0, 10);
}

export function stableTaiwanDailyCoverageEnd(now: Date) {
  const clock = taipeiClock(now);
  if (["Sat", "Sun"].includes(clock.weekday)) return previousTaiwanWeekday(clock.date);
  if (clock.minutes < 8 * 60 + 30) return previousTaiwanWeekday(clock.date);
  if (clock.minutes >= 15 * 60) return clock.date;
  return null;
}

function sessionDateForCandle(row: HistoryCandle | undefined) {
  if (!row) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: row.sourceTimeZone || "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(row.time * 1000));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch { return null; }
}

function sessionDateForSourceUpdate(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return sessionDateForCandle({ time: Math.floor(Date.parse(value) / 1000), open: 1, high: 1, low: 1, close: 1, volume: 0, sourceTimeZone: "Asia/Taipei" });
}

function taiwanDailyCoverageComplete(symbol: string, interval: string, rows: HistoryCandle[], now: Date) {
  if (interval !== "1d" || !/\.(TW|TWO)$/i.test(symbol)) return false;
  const expected = stableTaiwanDailyCoverageEnd(now);
  const actual = sessionDateForCandle(rows.at(-1));
  return Boolean(expected && actual && actual >= expected);
}

function marketNumber(value: unknown, allowZero = false) {
  const normalized = String(value ?? "").replaceAll(",", "").replace(/<[^>]+>/g, "").trim();
  if (!normalized || /^(?:-+|N\/?A|NULL)$/i.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : null;
}

function officialCandleTime(sessionDate: string, time = "13:30:00") {
  const parsed = Date.parse(`${sessionDate}T${time}+08:00`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function officialCandleFromMarketRow(symbol: string, row: TaiwanMarketRow, checkedAt: string): HistoryCandle | null {
  const tpex = symbol.toUpperCase().endsWith(".TWO");
  const sessionDate = parseTaiwanSessionDate(row.Date);
  const code = String(tpex ? row.SecuritiesCompanyCode : row.Code || "").trim().toUpperCase();
  if (!sessionDate || code !== symbol.split(".")[0].toUpperCase()) return null;
  const open = marketNumber(tpex ? row.Open : row.OpeningPrice);
  const high = marketNumber(tpex ? row.High : row.HighestPrice);
  const low = marketNumber(tpex ? row.Low : row.LowestPrice);
  const close = marketNumber(tpex ? row.Close : row.ClosingPrice);
  const volume = marketNumber(row.TradeVolume, true);
  const time = officialCandleTime(sessionDate, "09:00:00");
  const quoteTime = officialCandleTime(sessionDate);
  if ([open, high, low, close, volume, time, quoteTime].some((value) => value == null)) return null;
  return {
    time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume!, quoteTime: quoteTime!,
    source: tpex ? "tpex-official" : "twse-official",
    sourceUpdatedAt: checkedAt, marketSession: "closed", sourceTimeZone: "Asia/Taipei",
  };
}

async function fetchTaiwanDailyTail(env: Env, symbol: string, sessionDate: string, now: Date) {
  if (!/\.(TW|TWO)$/i.test(symbol)) return null;
  const code = symbol.split(".")[0];
  const provider: TaiwanProvider = symbol.toUpperCase().endsWith(".TWO") ? "tpex" : "twse";
  const clock = taipeiClock(now);
  const useMis = sessionDate === clock.date && clock.minutes >= 8 * 60 + 30 && clock.minutes < 15 * 60;
  if (useMis) {
    const result = await fetchTwseMisReference(code, sessionDate, provider === "tpex" ? "otc" : "tse");
    return result.referenceSessionDate === sessionDate ? result.candle || null : null;
  }
  let market = await fetchTaiwanMarket(provider, sessionDate);
  if (provider === "tpex" && (market.reason || !market.rows)) market = await readTpexMirror(env, sessionDate) || market;
  const row = market.rows?.find((item) => String(provider === "tpex" ? item.SecuritiesCompanyCode : item.Code) === code);
  const official = row ? officialCandleFromMarketRow(symbol, row, market.checkedAt) : null;
  if (official) return official;
  const fallback = await fetchTwseMisReference(code, sessionDate, provider === "tpex" ? "otc" : "tse");
  return fallback.referenceSessionDate === sessionDate ? fallback.candle || null : null;
}

async function fetchHistoryCandles(env: Env, symbol: string, interval: string, mode: "full" | "tail", now: Date) {
  const fetched = await fetchCandles(symbol, interval, { mode });
  if (interval !== "1d" || !/\.(TW|TWO)$/i.test(symbol)) return fetched;
  const latest = fetched.rows.at(-1);
  const sourceQuoteTime = Number(latest?.quoteTime);
  if (!latest || !Number.isFinite(sourceQuoteTime) || sourceQuoteTime <= latest.time + 12 * 60 * 60) return fetched;
  const latestSessionDate = sessionDateForCandle(latest);
  const sourceSessionDate = sessionDateForSourceUpdate(latest?.sourceUpdatedAt);
  if (!sourceSessionDate || !latestSessionDate || sourceSessionDate <= latestSessionDate) return fetched;
  const officialTail = await fetchTaiwanDailyTail(env, symbol, sourceSessionDate, now);
  if (!officialTail) return fetched;
  return { rows: mergeCandleHistory(fetched.rows, [officialTail]), provider: "yfinance+twse-official-tail-v1" };
}

async function cachedCandlePayload(
  env: Env,
  symbol: string,
  interval: string,
  displayCount: number,
  indicatorParameters: IndicatorParameters,
  pivotMode: PivotMode | null = null,
  realtimeViewerEnabled = false,
) {
  const requestNow = new Date();
  const realtimePeriodBaseEnabled = realtimeViewerEnabled
    && /\.(TW|TWO)$/i.test(symbol)
    && ["1wk", "1mo"].includes(interval);
  const baseKey = `${CANDLE_CACHE_CONTRACT_VERSION}|${symbol.toUpperCase()}|${interval}|${displayCount}|${indicatorParameterSignature(indicatorParameters)}|pivot:${pivotMode ?? "off"}`;
  const key = realtimePeriodBaseEnabled ? `${baseKey}|realtime-base:on` : baseKey;
  const now = Math.floor(Date.now() / 1000);
  let stalePayload: CandlePayloadResult | null = null;
  if (env.DB) {
    try {
      await ensureDb(env.DB);
      const cached = await env.DB.prepare("SELECT payload, expires_at FROM candle_cache WHERE cache_key = ?").bind(key).first<CandleCacheRow>();
      if (cached?.payload) {
        const payload = JSON.parse(cached.payload) as CandlePayloadResult;
        if (Number(cached.expires_at) > now) {
          recordCacheEvent("hit");
          payload.dataWindow = { ...payload.dataWindow, cache: { ...payload.dataWindow.cache, store: "d1", state: "hit", source: payload.quote?.sourceProvider } };
          return payload;
        }
        recordCacheEvent("stale");
        stalePayload = payload;
      } else {
        recordCacheEvent("miss");
      }
    } catch {
      recordCacheEvent("read_failure");
    }
  }
  try {
    const baseProvider = providerForCandleSymbol(symbol);
    const provider = baseProvider === "yfinance" && interval === "1wk"
      ? "yfinance-weekly-from-daily-v1"
      : baseProvider === "yfinance" && interval === "1mo"
        ? "yfinance-monthly-from-daily-v1"
        : baseProvider;
    const history = await acquireCandleHistory({
      db: env.DB,
      provider,
      symbol,
      interval,
      displayCount,
      fetcher: async ({ mode }) => {
        const fetched = await fetchHistoryCandles(env, symbol, interval, mode, requestNow);
        return { rows: fetched.rows, source: fetched.provider };
      },
      coverageComplete: (rows) => taiwanDailyCoverageComplete(symbol, interval, rows, requestNow),
      now: requestNow,
    });
    let pivotReferenceRows: Candle[] = [];
    if (pivotMode === "traditional") {
      const referenceInterval = pivotReferenceInterval(interval);
      if (referenceInterval === interval) {
        pivotReferenceRows = history.rows;
      } else if (referenceInterval === "1d") {
        try {
          const referenceProvider = providerForCandleSymbol(symbol);
          const dailyHistory = await acquireCandleHistory({
            db: env.DB,
            provider: referenceProvider,
            symbol,
            interval: "1d",
            displayCount: 500,
            fetcher: async ({ mode }) => {
              const fetched = await fetchHistoryCandles(env, symbol, "1d", mode, requestNow);
              return { rows: fetched.rows, source: fetched.provider };
            },
            coverageComplete: (rows) => taiwanDailyCoverageComplete(symbol, "1d", rows, requestNow),
            now: requestNow,
          });
          pivotReferenceRows = dailyHistory.rows;
        } catch {
          pivotReferenceRows = [];
        }
      }
    }
    const payload = candlePayloadFromRows(
      symbol,
      interval,
      history.rows,
      history.provider,
      displayCount,
      history.cache,
      history.freshness,
      new Date(),
      indicatorParameters,
      pivotMode,
      pivotReferenceRows,
    );
    if (realtimePeriodBaseEnabled) {
      const dailyHistory = await acquireCandleHistory({
        db: env.DB,
        provider: providerForCandleSymbol(symbol),
        symbol,
        interval: "1d",
        displayCount: 45,
        fetcher: async ({ mode }) => {
        const fetched = await fetchHistoryCandles(env, symbol, "1d", mode, requestNow);
        return { rows: fetched.rows, source: fetched.provider };
      },
      coverageComplete: (rows) => taiwanDailyCoverageComplete(symbol, "1d", rows, requestNow),
      now: requestNow,
      });
      payload.realtimeDailyHistory = dailyHistory.rows.slice(-45);
      const dailyPayload = candlePayloadFromRows(
        symbol, "1d", dailyHistory.rows, dailyHistory.provider, 45, dailyHistory.cache, dailyHistory.freshness,
        new Date(), indicatorParameters, null, [],
      );
      const verifiedDailyQuote = await verifyMarketQuote(env, symbol, "1d", dailyPayload.candles, dailyPayload.quote);
      payload.realtimeCanonicalHandoff = {
        sessionDate: verifiedDailyQuote.sessionDate || null,
        verificationStatus: String(verifiedDailyQuote.verification?.status || "unverified"),
      };
    }
    payload.quote = await verifyMarketQuote(env, symbol, interval, payload.candles, payload.quote);
    if (env.DB) {
      try {
        await env.DB.prepare(`INSERT INTO candle_cache (cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`).bind(key, JSON.stringify(payload), now + cacheTtl(interval)).run();
      } catch {
        recordCacheEvent("write_failure");
        payload.dataWindow = { ...payload.dataWindow, cache: { ...payload.dataWindow.cache, store: "memory", state: "miss", source: payload.quote?.sourceProvider, tailRefresh: "success", reason: "d1_unavailable" } };
      }
    }
    return payload;
  } catch (error) {
    if (!stalePayload) throw error;
    stalePayload.quote = { ...stalePayload.quote, freshness: "stale" };
    stalePayload.dataWindow = { ...stalePayload.dataWindow, cache: { ...stalePayload.dataWindow.cache, store: "d1", state: "stale", source: stalePayload.quote?.sourceProvider, tailRefresh: "failed", reason: "provider_unavailable" } };
    return stalePayload;
  }
}

async function verifyMarketQuote(env: Env, symbol: string, interval: string, candles: Candle[], current: QuoteState) {
  if (interval !== "1d" || !candles.length) return { ...current, verification: { status: "unverified", provider: null, reason: "unsupported_interval" } };
  if (current?.marketPhase === "open") return { ...current, verification: { status: "not_applicable", provider: null, reason: "market_open" } };
  if (current?.kind !== "session-close") return { ...current, verification: { status: "unverified", provider: null, reason: "unsupported_quote_kind" } };
  if (/\.(TW|TWO)$/.test(symbol.toUpperCase())) return verifyTaiwanQuote(env, symbol, candles, current);
  return verifyMassiveQuote(env, symbol, candles, current);
}

type TaiwanProvider = "twse" | "tpex";
type TaiwanMarketSource = TaiwanProvider | "twse-openapi";
type TaiwanMarketResult = { rows?: TaiwanMarketRow[]; reason?: string; checkedAt: string };
type TaiwanSymbolResult = { close?: number; referenceSessionDate?: string; candle?: HistoryCandle; reason?: string; checkedAt: string; provider: string };
const taiwanMarketCache = new Map<string, { expiresAt: number; value: TaiwanMarketResult }>();
const taiwanMarketInflight = new Map<string, Promise<TaiwanMarketResult>>();
const taiwanSymbolCache = new Map<string, { expiresAt: number; value: TaiwanSymbolResult }>();
const taiwanSymbolInflight = new Map<string, Promise<TaiwanSymbolResult>>();

function parseTaiwanSessionDate(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (![7, 8].includes(digits.length)) return null;
  const year = digits.length === 7 ? Number(digits.slice(0, 3)) + 1911 : Number(digits.slice(0, 4));
  const month = Number(digits.slice(digits.length - 4, digits.length - 2));
  const day = Number(digits.slice(-2));
  const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day ? normalized : null;
}

function toTaiwanRocDate(sessionDate: string) {
  const match = sessionDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1]) - 1911}/${match[2]}/${match[3]}` : "";
}

function toTaiwanGregorianDate(sessionDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? sessionDate.replaceAll("-", "") : "";
}

function parseTwseMiIndex(payload: TwseMiIndexPayload, sessionDate: string, checkedAt: string): TaiwanMarketResult {
  const stat = String(payload?.stat || "").trim();
  if (stat !== "OK") {
    const unpublished = /沒有符合條件|大於今日|查無資料|尚無資料/.test(stat);
    return { reason: unpublished ? "reference_not_published" : "invalid_reference_data", checkedAt };
  }
  if (parseTaiwanSessionDate(payload?.date) !== sessionDate || !Array.isArray(payload?.tables)) {
    return { reason: "invalid_reference_data", checkedAt };
  }
  const table = payload.tables.find((candidate) => {
    if (!Array.isArray(candidate?.fields)) return false;
    const fields = candidate.fields.map((field: unknown) => String(field).trim());
    return fields.includes("證券代號") && fields.includes("收盤價");
  });
  if (!table) return { reason: "reference_not_published", checkedAt };
  if (!Array.isArray(table.data)) return { reason: "invalid_reference_data", checkedAt };
  const fields = table.fields.map((field: unknown) => String(field).trim());
  const codeIndex = fields.indexOf("證券代號");
  const volumeIndex = fields.indexOf("成交股數");
  const openIndex = fields.indexOf("開盤價");
  const highIndex = fields.indexOf("最高價");
  const lowIndex = fields.indexOf("最低價");
  const closeIndex = fields.indexOf("收盤價");
  const rows = table.data.flatMap((row: unknown) => {
    if (!Array.isArray(row)) return [];
    const code = String(row[codeIndex] ?? "").trim().toUpperCase();
    if (!/^[0-9A-Z]{4,8}$/.test(code)) return [];
    return [{
      Date: toTaiwanGregorianDate(sessionDate), Code: code,
      TradeVolume: row[volumeIndex], OpeningPrice: row[openIndex], HighestPrice: row[highIndex],
      LowestPrice: row[lowIndex], ClosingPrice: row[closeIndex],
    }];
  });
  return rows.length ? { rows, checkedAt } : { reason: "reference_not_published", checkedAt };
}

function parseComparableTaiwanClose(value: unknown) {
  const raw = String(value ?? "").replaceAll(",", "").trim();
  if (!raw || /^(?:-+|N\/?A|NULL)$/i.test(raw)) return null;
  const close = Number(raw);
  return Number.isFinite(close) && close > 0 ? { close, raw } : null;
}

async function ingestTpexMirror(request: Request, env: Env) {
  if (!env.DB || !env.TPEX_MIRROR_INGEST_SECRET) return json({ ok: false, error: "TPEx 鏡像尚未設定。" }, 503);
  const expected = `Bearer ${env.TPEX_MIRROR_INGEST_SECRET}`;
  if (internalAuthorization(request) !== expected) return json({ ok: false, error: "Unauthorized" }, 401);
  let body: JsonObject;
  try { body = jsonObject(await request.json()); }
  catch { return json({ ok: false, error: "Invalid payload" }, 400); }
  if (body?.source !== "tpex-official-openapi" || !Array.isArray(body?.rows) || body.rows.length < 500 || body.rows.length > 2000) {
    return json({ ok: false, error: "Invalid payload" }, 400);
  }
  const fetchedAt = String(body.fetchedAt || "");
  if (!Number.isFinite(Date.parse(fetchedAt))) return json({ ok: false, error: "Invalid payload" }, 400);
  const dates = new Set<string>();
  const codes = new Set<string>();
  const rows = body.rows.flatMap((value) => {
    const item = jsonObject(value);
    const sessionDate = parseTaiwanSessionDate(item?.Date);
    const code = String(item?.SecuritiesCompanyCode || "").trim();
    const rawClose = String(item?.Close || "").replaceAll(",", "").trim();
    const close = Number(rawClose);
    if (!sessionDate || !/^[0-9A-Z]{4,8}$/.test(code) || codes.has(code) || !Number.isFinite(close)) return [];
    dates.add(sessionDate); codes.add(code);
    return [{ Date: String(item.Date).replace(/\D/g, ""), SecuritiesCompanyCode: code, Close: rawClose }];
  });
  if (rows.length < 500 || dates.size !== 1) return json({ ok: false, error: "Invalid payload" }, 400);
  const sessionDate = [...dates][0];
  const cutoff = new Date(`${sessionDate}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - 45);
  await ensureDb(env.DB);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tpex_market_mirror (session_date,payload,source_fetched_at) VALUES (?,?,?) ON CONFLICT(session_date) DO UPDATE SET payload=excluded.payload,source_fetched_at=excluded.source_fetched_at,ingested_at=CURRENT_TIMESTAMP`).bind(sessionDate, JSON.stringify(rows), fetchedAt),
    env.DB.prepare("DELETE FROM tpex_market_mirror WHERE session_date < ?").bind(cutoff.toISOString().slice(0, 10)),
  ]);
  return json({ ok: true, sessionDate, rows: rows.length, fetchedAt });
}

function authorizedIngest(request: Request, env: Env) {
  return Boolean(env.TPEX_MIRROR_INGEST_SECRET) && internalAuthorization(request) === `Bearer ${env.TPEX_MIRROR_INGEST_SECRET}`;
}

function normalizedOfficialCatalogRow(item: OfficialCatalogRow, source: "twse-official-openapi" | "tpex-official-openapi", fetchedAt: string): CatalogEntry | null {
  const isTwse = source === "twse-official-openapi";
  const code = String(isTwse ? item?.Code || item?.code || "" : item?.SecuritiesCompanyCode || item?.code || "").trim().toUpperCase();
  const localizedName = String(isTwse ? item?.Name || item?.localizedName || "" : item?.CompanyName || item?.localizedName || "").trim();
  if (!/^[0-9A-Z]{4,8}$/.test(code) || !localizedName) return null;
  const exchange = isTwse ? "TWSE" : "TPEx";
  const quoteType = String(item?.quoteType || (code.startsWith("00") ? "ETF" : "EQUITY"));
  return {
    symbol: `${code}.${isTwse ? "TW" : "TWO"}`,
    exchange,
    localizedName,
    englishName: String(item?.englishName || ""),
    aliases: Array.isArray(item?.aliases) ? item.aliases.map(String) : [],
    market: "台灣股市",
    group: isTwse ? (quoteType === "ETF" ? "上市 ETF" : "上市股票") : (quoteType === "ETF" ? "上櫃 ETF" : "上櫃股票"),
    quoteType,
    provider: "yfinance",
    source: isTwse ? "twse-official" : "tpex-official",
    sourceUpdatedAt: fetchedAt,
    active: true,
  };
}

async function instrumentCatalogStatus(env: Env) {
  if (!env.DB) return { configured: false, rows: 0, sources: [] };
  await ensureDb(env.DB);
  const totals = await env.DB.prepare("SELECT source, COUNT(*) AS rows, MAX(source_updated_at) AS source_updated_at FROM instrument_catalog WHERE active = 1 GROUP BY source ORDER BY source").all<CatalogSourceTotalRow>();
  return { configured: true, rows: totals.results.reduce((sum, item) => sum + Number(item.rows || 0), 0), sources: totals.results.map((item) => ({ source: item.source, rows: Number(item.rows || 0), sourceUpdatedAt: item.source_updated_at })) };
}

async function tdccContinuousTargetContext(request: Request, env: Env) {
  const base = parseSetup(await setupText(request, env));
  const catalog = await readInstrumentCatalog(env.DB);
  const catalogBySymbol = new Map(catalog.map((item) => [item.symbol, item]));
  const targets: TdccContinuousTarget[] = base
    .filter((item) => item.enabled && isEligibleWatchlistTaiwanInstrument(item, catalogBySymbol.get(item.symbol)))
    .map((item) => ({ symbol: item.symbol, source: "setup" as const }));
  if (env.DB) {
    const userRows = await env.DB.prepare("SELECT * FROM user_instruments WHERE enabled = 1").all<UserInstrumentRow>();
    for (const row of userRows.results || []) {
      const item: Instrument = { symbol: normalizeSymbol(row.symbol), name: String(row.name || row.symbol), provider: String(row.provider || "yfinance"), tabId: String(row.tab_id || ""), tab: String(row.tab_label || "其他"), group: String(row.group_name || "自訂"), market: String(row.market || "台灣股市"), enabled: true, defaultOrder: row.sort_order == null ? null : Number(row.sort_order) };
      if (isEligibleWatchlistTaiwanInstrument(item, catalogBySymbol.get(item.symbol))) targets.push({ symbol: item.symbol, source: "user" });
    }
  }
  const officialCatalog = catalog.filter((item) => item.active !== false && ["twse-official", "tpex-official", "taiwan-catalog"].some((source) => String(item.source).includes(source)) && isEligibleTaiwanEquity(item));
  const catalogRevision = officialCatalog.map((item) => String(item.sourceUpdatedAt || "")).sort().at(-1) || "";
  for (const target of targets) target.catalogRevision = catalogRevision;
  return { targets, observedCatalogSymbols: officialCatalog.map((item) => item.symbol), catalogRevision };
}

async function refreshTdccContinuousTargets(request: Request, env: Env) {
  if (!env.DB) throw new Error("d1_unavailable");
  const context = await tdccContinuousTargetContext(request, env);
  const health = await syncTdccContinuousTargets({ db: env.DB, ...context });
  return { ...context, health };
}

async function activeTdccContinuousSymbols(db: D1Database) {
  const rows = await db.prepare("SELECT symbol FROM tdcc_continuous_symbols WHERE active = 1 ORDER BY symbol").all<SymbolRow>();
  return (rows.results || []).map((row) => String(row.symbol)).filter(Boolean);
}

async function ingestInstrumentCatalog(request: Request, env: Env) {
  if (!env.DB || !env.TPEX_MIRROR_INGEST_SECRET) return json({ ok: false, error: "商品目錄同步尚未設定。" }, 503);
  if (!authorizedIngest(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
  if (request.method === "GET") return json({ ok: true, ...(await instrumentCatalogStatus(env)) });
  let body: JsonObject;
  try { body = jsonObject(await request.json()); }
  catch { return json({ ok: false, error: "Invalid payload" }, 400); }
  const source = body?.source as "twse-official-openapi" | "tpex-official-openapi";
  const minimumRows = source === "twse-official-openapi" ? 800 : source === "tpex-official-openapi" ? 500 : Number.POSITIVE_INFINITY;
  if (!Array.isArray(body?.rows) || body.rows.length < minimumRows || body.rows.length > 2500) return json({ ok: false, error: "Invalid payload" }, 400);
  const fetchedAt = String(body?.fetchedAt || "");
  if (!Number.isFinite(Date.parse(fetchedAt))) return json({ ok: false, error: "Invalid payload" }, 400);
  const entries = body.rows.map((item) => normalizedOfficialCatalogRow(jsonObject(item) as OfficialCatalogRow, source, fetchedAt));
  if (entries.some((item: CatalogEntry | null) => !item)) return json({ ok: false, error: "Invalid payload" }, 400);
  if (entries.filter((item: CatalogEntry) => /[^\x00-\x7F]/.test(item.localizedName)).length < entries.length * 0.9) return json({ ok: false, error: "Invalid payload" }, 400);
  const unique = new Set(entries.map((item: CatalogEntry) => `${item.symbol}|${item.exchange}`));
  if (unique.size !== entries.length) return json({ ok: false, error: "Invalid payload" }, 400);
  await ensureDb(env.DB);
  const statements = entries.map((item: CatalogEntry) => catalogUpsertStatement(env.DB!, item, fetchedAt));
  await runD1Batch(env.DB, statements);
  const storedSource = source === "twse-official-openapi" ? "twse-official" : "tpex-official";
  await env.DB.prepare("DELETE FROM instrument_catalog WHERE source = ? AND source_updated_at <> ?").bind(storedSource, fetchedAt).run();
  try { await refreshTdccContinuousTargets(request, env); } catch {}
  return json({ ok: true, source, rows: entries.length, fetchedAt, catalog: await instrumentCatalogStatus(env) });
}

async function ingestTdccShareholderDistribution(request: Request, env: Env) {
  if (!env.DB || !env.TPEX_MIRROR_INGEST_SECRET) return json({ ok: false, error: "TDCC 股權分散同步尚未設定。" }, 503);
  if (!authorizedIngest(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
  let body: JsonObject;
  try { body = jsonObject(await request.json()); }
  catch { return json({ ok: false, error: "Invalid payload" }, 400); }
  const fetchedAt = String(body?.fetchedAt || "");
  if (body?.source !== "tdcc-official-openapi-1-5" || !Number.isFinite(Date.parse(fetchedAt)) || !Array.isArray(body?.rows) || body.rows.length < 17 || body.rows.length > 250000 || body.rows.length % 17 !== 0) {
    return json({ ok: false, error: "Invalid payload" }, 400);
  }
  try {
    await ensureDb(env.DB);
    const eligibility = await taiwanChipEligibility(request, env, "");
    const result = await ingestTdccDistributionSnapshot({ env, payload: body.rows, eligibleSymbols: eligibility.eligibleSymbols, fetchedAt });
    return json({ ok: true, source: body.source, fetchedAt, ...result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_response";
    return json({ ok: false, error: ["invalid_response", "d1_unavailable"].includes(reason) ? reason : "invalid_response" }, 400);
  }
}

function authorizedTdccHistoryIngest(request: Request, env: Env) {
  return Boolean(env.TDCC_HISTORY_INGEST_SECRET)
    && internalAuthorization(request) === `Bearer ${env.TDCC_HISTORY_INGEST_SECRET}`;
}

function authorizedTdccContinuous(request: Request, env: Env) {
  return Boolean(env.TDCC_CONTINUOUS_BACKFILL_SECRET)
    && internalAuthorization(request) === `Bearer ${env.TDCC_CONTINUOUS_BACKFILL_SECRET}`;
}

let tdccLatestSnapshotInflight: Promise<unknown[]> | null = null;

async function fetchTdccLatestSnapshot() {
  if (tdccLatestSnapshotInflight) return tdccLatestSnapshotInflight;
  tdccLatestSnapshotInflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TDCC_CONTINUOUS_CONTRACT.requestTimeoutMs);
    try {
      const response = await fetch(TDCC_CONTINUOUS_CONTRACT.latestOpenDataUrl, { signal: controller.signal, headers: { accept: "application/json" } });
      if (response.status === 429) throw new Error("rate_limited");
      if (!response.ok) throw new Error("provider_unavailable");
      const payload = await response.json();
      if (!Array.isArray(payload) || payload.length < 1000 || payload.length > 250000) throw new Error("invalid_response");
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  try {
    return await tdccLatestSnapshotInflight;
  } finally {
    tdccLatestSnapshotInflight = null;
  }
}

function chipBackfillWorkflowResult(orchestrator: unknown, done: boolean) {
  return { done, summary: safeChipBackfillWorkflowSummary(orchestrator), orchestrator };
}

async function finalizeChipBackfillOrchestratorFailure(input: {
  db: D1Database;
  runId: string;
  trigger: ChipBackfillTrigger;
  scope?: ChipBackfillScope;
  reason: unknown;
}) {
  const reason = safeTdccContinuousError(input.reason);
  let orchestrator = await readChipBackfillOrchestratorRun(input.db, input.runId);
  if (!orchestrator) orchestrator = await startChipBackfillOrchestratorRun({ db: input.db, runId: input.runId, trigger: input.trigger, scope: input.scope });
  if (orchestrator?.status === "completed") {
    return { ...chipBackfillWorkflowResult(orchestrator, true), recovery: { status: "not_needed", nextRetryAt: null } };
  }
  if (orchestrator?.status !== "failed") orchestrator = await failChipBackfillOrchestratorRun({ db: input.db, runId: input.runId, reason });

  if (orchestrator?.scope === "daily") {
    return { ...chipBackfillWorkflowResult(orchestrator, false), recovery: { status: "not_needed", nextRetryAt: null } };
  }

  const existingRun = await input.db.prepare("SELECT status,next_retry_at FROM tdcc_continuous_runs WHERE run_id=?").bind(input.runId).first<{ status?: string | null; next_retry_at?: string | null }>();
  if (!existingRun || !["completed", "failed"].includes(String(existingRun.status || ""))) {
    await startTdccContinuousRun({ db: input.db, runId: input.runId, trigger: input.trigger === "workflow_dispatch" ? "workflow_dispatch" : "schedule" });
    await heartbeatTdccContinuousRun({ db: input.db, runId: input.runId });
    await finishTdccContinuousRun({ db: input.db, runId: input.runId, reason });
  }
  const run = await input.db.prepare("SELECT status,next_retry_at FROM tdcc_continuous_runs WHERE run_id=?").bind(input.runId).first<{ status?: string | null; next_retry_at?: string | null }>();
  return {
    ...chipBackfillWorkflowResult(orchestrator, false),
    recovery: {
      status: run?.next_retry_at ? "retry_waiting" : run?.status === "completed" ? "not_needed" : "failed",
      nextRetryAt: run?.next_retry_at || null,
    },
  };
}

async function tdccContinuousBackfill(request: Request, env: Env) {
  if (!env.DB || !env.TDCC_CONTINUOUS_BACKFILL_SECRET) return json({ ok: false, error: "TDCC 背景持續回補尚未設定。" }, 503);
  if (!authorizedTdccContinuous(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
  await ensureDb(env.DB);
  const historyAutomationEnabled = env.TDCC_HISTORY_AUTOMATION_ENABLED === "true";
  if (request.method === "GET") return json({ ok: true, contract: TDCC_CONTINUOUS_CONTRACT, historyAutomationEnabled, orchestrator: await readChipBackfillOrchestratorHealth(env.DB), chipPrewarming: { contract: WATCHLIST_CHIP_PREWARM_CONTRACT, health: await readWatchlistChipPrewarmHealth(env.DB) }, health: await readTdccContinuousHealth(env.DB) });
  let body: JsonObject;
  try { body = jsonObject(await request.json()); }
  catch { return json({ ok: false, error: "Invalid payload" }, 400); }
  const action = String(body?.action || "");
  const runId = String(body?.runId || "");
  const owner = String(body?.owner || runId || "");
  const orchestratorTrigger: ChipBackfillTrigger = body?.trigger === "schedule" ? "schedule" : body?.trigger === "scheduled" ? "scheduled" : "workflow_dispatch";
  const orchestratorScope = String(body?.scope || "combined") as ChipBackfillScope;
  try {
    if (!["combined", "daily", "tdcc-weekly"].includes(orchestratorScope)) throw new Error("invalid_response");
    if (action === "orchestrator-start") {
      const trigger = orchestratorTrigger;
      let orchestrator = await startChipBackfillOrchestratorRun({ db: env.DB, runId, trigger, scope: orchestratorScope });
      if (orchestrator?.status === "completed") return json({ ok: true, ...chipBackfillWorkflowResult(orchestrator, true) });
      if (orchestrator?.scope === "daily") {
        const targets = await discoverWatchlistChipWarmTargets({ db: env.DB, limit: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.batchSize, attemptCooldownMs: WATCHLIST_CHIP_ATTEMPT_COOLDOWN_MS });
        const done = targets.dueSymbols === 0;
        orchestrator = await advanceChipBackfillOrchestratorRun({
          db: env.DB,
          runId,
          phase: "daily",
          remainingSymbols: targets.dueSymbols,
          pendingSymbols: targets.pendingSymbols,
          lastReasonCode: done && targets.pendingSymbols ? "source_not_published" : null,
          done,
        });
        return json({ ok: true, ...chipBackfillWorkflowResult(orchestrator, done), targets: { pendingSymbols: targets.pendingSymbols, dueSymbols: targets.dueSymbols, deferredSymbols: targets.deferredSymbols } });
      }
      if (orchestrator?.phase === "latest") {
        await refreshTdccContinuousTargets(request, env);
        await startTdccContinuousRun({ db: env.DB, runId, trigger: trigger === "workflow_dispatch" ? "workflow_dispatch" : "schedule" });
        const symbols = await activeTdccContinuousSymbols(env.DB);
        if (!symbols.length) throw new Error("invalid_response");
        const payload = await fetchTdccLatestSnapshot();
        const result = await ingestTdccDistributionSnapshot({ env, payload, eligibleSymbols: new Set(symbols), fetchedAt: new Date().toISOString() });
        if (result.dataDates.length !== 1) throw new Error("invalid_response");
        const saved = await env.DB.prepare("SELECT d.symbol FROM taiwan_stock_shareholder_distribution d INNER JOIN tdcc_continuous_symbols s ON s.symbol=d.symbol AND s.active=1 WHERE d.data_date=? ORDER BY d.symbol").bind(result.dataDates[0]).all<SymbolRow>();
        await recordTdccLatestSnapshot({ db: env.DB, runId, dataDate: result.dataDates[0], symbols: (saved.results || []).map((row) => row.symbol) });
        if (orchestrator.scope === "tdcc-weekly") {
          orchestrator = await advanceChipBackfillOrchestratorRun({ db: env.DB, runId, latestDataDate: result.dataDates[0], done: true });
          await finishTdccContinuousRun({ db: env.DB, runId });
          return json({ ok: true, ...chipBackfillWorkflowResult(orchestrator, true) });
        }
        const targets = await discoverWatchlistChipWarmTargets({ db: env.DB, limit: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.batchSize, attemptCooldownMs: WATCHLIST_CHIP_ATTEMPT_COOLDOWN_MS });
        const done = targets.dueSymbols === 0;
        orchestrator = await advanceChipBackfillOrchestratorRun({
          db: env.DB,
          runId,
          phase: "daily",
          latestDataDate: result.dataDates[0],
          remainingSymbols: targets.dueSymbols,
          pendingSymbols: targets.pendingSymbols,
          lastReasonCode: done && targets.pendingSymbols ? "source_not_published" : null,
          done,
        });
        if (done) await finishTdccContinuousRun({ db: env.DB, runId });
        return json({ ok: true, ...chipBackfillWorkflowResult(orchestrator, done), targets: { pendingSymbols: targets.pendingSymbols, dueSymbols: targets.dueSymbols, deferredSymbols: targets.deferredSymbols } });
      }
      return json({ ok: true, ...chipBackfillWorkflowResult(orchestrator, false) });
    }
    if (action === "orchestrator-tick") {
      const current = await readChipBackfillOrchestratorRun(env.DB, runId);
      if (!current) throw new Error("invalid_response");
      if (current.status === "completed") return json({ ok: true, ...chipBackfillWorkflowResult(current, true) });
      if (current.phase !== "daily" || !["daily", "combined"].includes(current.scope)) throw new Error("invalid_response");
      const targets = await discoverWatchlistChipWarmTargets({ db: env.DB, limit: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.batchSize, attemptCooldownMs: WATCHLIST_CHIP_ATTEMPT_COOLDOWN_MS });
      const processed: string[] = [];
      let reason: string | null = null;
      for (const target of targets.targets) {
        const eligibility = await taiwanChipEligibility(request, env, target.symbol);
        const result = await prewarmTaiwanStockChipSymbol({ env, eligibility, datasets: target.datasets });
        processed.push(target.symbol);
        const reasons = Object.values(result.availability || {}).map(String);
        if (reasons.includes("rate_limited")) reason = "rate_limited";
        else if (reasons.some((value) => ["not_published", "partial_data"].includes(value))) reason = "source_not_published";
        else if (result.status !== "completed") reason = "provider_unavailable";
      }
      const remaining = await discoverWatchlistChipWarmTargets({ db: env.DB, limit: CHIP_BACKFILL_ORCHESTRATOR_CONTRACT.batchSize, attemptCooldownMs: WATCHLIST_CHIP_ATTEMPT_COOLDOWN_MS });
      const done = remaining.dueSymbols === 0;
      if (done && !reason && remaining.pendingSymbols) reason = "source_not_published";
      const orchestrator = await advanceChipBackfillOrchestratorRun({
        db: env.DB,
        runId,
        phase: "daily",
        symbols: processed,
        remainingSymbols: remaining.dueSymbols,
        pendingSymbols: remaining.pendingSymbols,
        lastReasonCode: reason,
        done,
      });
      if (current.scope === "combined") {
        await heartbeatTdccContinuousRun({ db: env.DB, runId });
        if (done) await finishTdccContinuousRun({ db: env.DB, runId });
      }
      return json({ ok: true, ...chipBackfillWorkflowResult(orchestrator, done), batch: { processedSymbols: processed, pendingSymbols: remaining.pendingSymbols, dueSymbols: remaining.dueSymbols, deferredSymbols: remaining.deferredSymbols } });
    }
    if (action === "orchestrator-fail") {
      const failure = await finalizeChipBackfillOrchestratorFailure({ db: env.DB, runId, trigger: orchestratorTrigger, scope: orchestratorScope, reason: body?.reason });
      return json({ ok: true, ...failure });
    }
    if (action === "start-run") {
      await refreshTdccContinuousTargets(request, env);
      const run = await startTdccContinuousRun({ db: env.DB, runId, trigger: body?.trigger === "schedule" ? "schedule" : "workflow_dispatch" });
      return json({ ok: true, run, health: await readTdccContinuousHealth(env.DB) });
    }
    if (action === "refresh-latest") {
      await refreshTdccContinuousTargets(request, env);
      const symbols = await activeTdccContinuousSymbols(env.DB);
      if (!symbols.length) throw new Error("invalid_response");
      const payload = await fetchTdccLatestSnapshot();
      const result = await ingestTdccDistributionSnapshot({ env, payload, eligibleSymbols: new Set(symbols), fetchedAt: new Date().toISOString() });
      if (result.dataDates.length !== 1) throw new Error("invalid_response");
      const saved = await env.DB.prepare("SELECT d.symbol FROM taiwan_stock_shareholder_distribution d INNER JOIN tdcc_continuous_symbols s ON s.symbol=d.symbol AND s.active=1 WHERE d.data_date=? ORDER BY d.symbol").bind(result.dataDates[0]).all<SymbolRow>();
      const snapshot = await recordTdccLatestSnapshot({ db: env.DB, runId, dataDate: result.dataDates[0], symbols: (saved.results || []).map((row) => row.symbol) });
      return json({ ok: true, source: "tdcc-official-openapi-1-5", ...result, snapshot, health: await readTdccContinuousHealth(env.DB) });
    }
    if (action === "chip-targets") {
      await refreshTdccContinuousTargets(request, env);
      const targets = await discoverWatchlistChipWarmTargets({ db: env.DB, limit: Number(body?.limit || WATCHLIST_CHIP_PREWARM_CONTRACT.maxTargetsPerRun) });
      await heartbeatTdccContinuousRun({ db: env.DB, runId });
      return json({ ok: true, ...targets, contract: WATCHLIST_CHIP_PREWARM_CONTRACT });
    }
    if (action === "retry-blocked") {
      const reason = String(body?.reason || "");
      const symbols = [...new Set((Array.isArray(body?.symbols) ? body.symbols : []).map((value: unknown) => normalizeSymbol(String(value || ""))))];
      if (!["candidate_mismatch", "invalid_response"].includes(reason) || !symbols.length || symbols.length > 20 || symbols.some((symbol) => !/^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(symbol))) throw new Error("invalid_response");
      await env.DB.batch(symbols.map((symbol) => env.DB!.prepare("UPDATE tdcc_continuous_symbols SET status='queued',last_error_code=NULL,next_retry_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND active=1 AND status='blocked' AND last_error_code=?").bind(symbol, reason)));
      const statuses = await Promise.all(symbols.map((symbol) => readTdccContinuousSymbolStatus(env.DB, symbol)));
      return json({ ok: true, retriedSymbols: statuses.filter((status) => status.status === "queued").map((status) => status.symbol) });
    }
    if (action === "claim") {
      if (!historyAutomationEnabled) throw new Error("history_automation_not_permitted");
      await refreshTdccContinuousTargets(request, env);
      const claims = await claimTdccContinuousSymbols({ db: env.DB, owner, limit: Number(body?.limit || 1) });
      await heartbeatTdccContinuousRun({ db: env.DB, runId });
      return json({ ok: true, claims });
    }
    if (action === "plan") {
      if (!historyAutomationEnabled) throw new Error("history_automation_not_permitted");
      const plan = await planTdccContinuousDates({ db: env.DB, symbol: body?.symbol, owner, officialDates: body?.officialDates, preListingDates: body?.preListingDates });
      return json({ ok: true, plan });
    }
    if (action === "heartbeat") {
      if (!historyAutomationEnabled) throw new Error("history_automation_not_permitted");
      const lease = await heartbeatTdccContinuousLease({ db: env.DB, owner, symbols: body?.symbols });
      await heartbeatTdccContinuousRun({ db: env.DB, runId });
      return json({ ok: true, lease });
    }
    if (action === "ingest-week") {
      if (!historyAutomationEnabled) throw new Error("history_automation_not_permitted");
      const symbol = normalizeSymbol(body?.symbol);
      const dataDate = String(body?.dataDate || "");
      const fetchedAt = String(body?.fetchedAt || "");
      const claimed = await env.DB.prepare("SELECT symbol FROM tdcc_continuous_symbols WHERE symbol=? AND lease_owner=? AND status='running' AND lease_expires_at>CURRENT_TIMESTAMP").bind(symbol, owner).first<SymbolRow>();
      if (!claimed || !Number.isFinite(Date.parse(fetchedAt)) || !Array.isArray(body?.rows) || body.rows.length !== 17) throw new Error("invalid_response");
      const result = await ingestTdccDistributionSnapshot({ env, payload: body.rows, eligibleSymbols: new Set([symbol]), fetchedAt });
      if (result.dataDates.length !== 1 || result.dataDates[0] !== dataDate || result.symbols !== 1) throw new Error("invalid_response");
      const backfill = await completeTdccContinuousWeek({ db: env.DB, symbol, dataDate, owner });
      return json({ ok: true, source: "tdcc-official-history-query", ...result, backfill });
    }
    if (action === "complete-gap") {
      if (!historyAutomationEnabled) throw new Error("history_automation_not_permitted");
      if (body?.reason !== "not_published") throw new Error("invalid_response");
      const backfill = await completeTdccContinuousWeek({ db: env.DB, symbol: body?.symbol, dataDate: body?.dataDate, owner, gapReason: "not_published" });
      return json({ ok: true, reason: "not_published", backfill });
    }
    if (action === "complete-symbol") {
      if (!historyAutomationEnabled) throw new Error("history_automation_not_permitted");
      await releaseTdccContinuousSymbol({ db: env.DB, symbol: body?.symbol, owner, status: body?.partial ? "partial" : "completed" });
      return json({ ok: true, backfill: await readTdccContinuousSymbolStatus(env.DB, body?.symbol) });
    }
    if (action === "fail") {
      const backfill = await failTdccContinuousWork({ db: env.DB, symbol: body?.symbol, dataDate: body?.dataDate, owner, reason: body?.reason, retryable: Boolean(body?.retryable) });
      return json({ ok: true, backfill });
    }
    if (action === "finish-run") {
      await finishTdccContinuousRun({ db: env.DB, runId, reason: body?.reason || undefined });
      return json({ ok: true, health: await readTdccContinuousHealth(env.DB) });
    }
    throw new Error("invalid_response");
  } catch (error) {
    const reason = safeTdccContinuousError(error);
    let failure = {};
    if (runId && action.startsWith("orchestrator-")) try { failure = await finalizeChipBackfillOrchestratorFailure({ db: env.DB, runId, trigger: orchestratorTrigger, scope: orchestratorScope, reason }); } catch {}
    if (runId && action === "refresh-latest") try { await finishTdccContinuousRun({ db: env.DB, runId, reason }); } catch {}
    return json({ ok: false, error: reason, ...failure }, ["provider_unavailable", "rate_limited", "timeout", "tick_limit_exceeded"].includes(reason) ? 503 : 400);
  }
}

async function tdccHistoryBackfill(request: Request, env: Env) {
  if (!env.DB || !env.TDCC_HISTORY_INGEST_SECRET) return json({ ok: false, error: "TDCC 歷史回補尚未設定。" }, 503);
  if (!authorizedTdccHistoryIngest(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);
  await ensureDb(env.DB);
  if (request.method === "GET") return json({ ok: true, backfill: await readTdccHistoryBackfillStatus(env.DB) });
  let body: JsonObject;
  try { body = jsonObject(await request.json()); }
  catch { return json({ ok: false, error: "Invalid payload" }, 400); }
  try {
    if (body?.action === "start") {
      const source = String(body?.source || "");
      const mode = source === "tdcc-official-history-export" ? "official-file-import"
        : source === "tdcc-official-history-query" ? "local-operator-query" : null;
      if (!mode) throw new Error("invalid_response");
      const backfill = await startTdccHistoryBackfill({
        db: env.DB,
        jobId: String(body?.jobId || "tdcc-one-year"),
        expectedDates: body?.expectedDates,
        mode,
        targetSymbols: body?.targetSymbols,
      });
      return json({ ok: true, source, backfill });
    }
    if (body?.action !== "ingest-week" || !["tdcc-official-history-export", "tdcc-official-history-query"].includes(body?.source)) throw new Error("invalid_response");
    const jobId = String(body?.jobId || "");
    const dataDate = String(body?.dataDate || "");
    const fetchedAt = String(body?.fetchedAt || "");
    const definition = await readTdccHistoryBackfillDefinition(env.DB, jobId);
    const expectedSource = definition.mode === "official-file-import" ? "tdcc-official-history-export" : "tdcc-official-history-query";
    if (body.source !== expectedSource || !Number.isFinite(Date.parse(fetchedAt)) || !Array.isArray(body?.rows) || body.rows.length > 250000 || body.rows.length % 17 !== 0) throw new Error("invalid_response");
    const returnedSymbols = Array.isArray(body?.returnedSymbols) ? body.returnedSymbols.map((value: unknown) => String(value || "").trim().toUpperCase()).sort() : [];
    if (definition.mode === "official-file-import") {
      if (body.rows.length < 8500 || returnedSymbols.length) throw new Error("invalid_response");
    } else {
      if (!returnedSymbols.length || new Set(returnedSymbols).size !== returnedSymbols.length || body.rows.length !== returnedSymbols.length * 17) throw new Error("invalid_response");
      if (returnedSymbols.some((symbol: string) => !definition.targetSymbols.includes(symbol))) throw new Error("invalid_response");
    }
    await markTdccBackfillWeekRunning(env.DB, jobId, dataDate);
    const eligibility = await taiwanChipEligibility(request, env, "");
    const eligibleSymbols = definition.mode === "local-operator-query" ? new Set(returnedSymbols) : eligibility.eligibleSymbols;
    if ([...eligibleSymbols].some((symbol) => !eligibility.eligibleSymbols.has(symbol))) throw new Error("invalid_response");
    const result = await ingestTdccDistributionSnapshot({ env, payload: body.rows, eligibleSymbols, fetchedAt });
    if (result.dataDates.length !== 1 || result.dataDates[0] !== dataDate) throw new Error("invalid_response");
    if (definition.mode === "official-file-import" && result.symbols < 500) throw new Error("invalid_response");
    if (definition.mode === "local-operator-query" && result.symbols !== returnedSymbols.length) throw new Error("invalid_response");
    const backfill = await completeTdccBackfillWeek(env.DB, jobId, dataDate, result.rows, result.symbols);
    return json({ ok: true, source: body.source, fetchedAt, ...result, backfill });
  } catch (error) {
    const reason = safeTdccBackfillError(error instanceof Error ? error.message : error);
    const jobId = String(body?.jobId || "");
    const dataDate = String(body?.dataDate || "");
    if (body?.action === "ingest-week" && jobId && dataDate) {
      try { await failTdccBackfillWeek(env.DB, jobId, dataDate, reason); } catch {}
    }
    return json({ ok: false, error: reason }, 400);
  }
}

async function fetchTaiwanMarket(source: TaiwanMarketSource, sessionDate: string): Promise<TaiwanMarketResult> {
  const cacheKey = `${source}|${sessionDate}`;
  const cached = taiwanMarketCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = taiwanMarketInflight.get(cacheKey);
  if (existing) return existing;
  const request = (async () => {
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let value: TaiwanMarketResult;
    try {
      const url = source === "tpex"
        ? `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&o=json&d=${encodeURIComponent(toTaiwanRocDate(sessionDate))}&se=EW&s=0,asc,0`
        : source === "twse"
          ? `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${encodeURIComponent(toTaiwanGregorianDate(sessionDate))}&type=ALLBUT0999&response=json`
          : "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "accept-language": "zh-TW,zh;q=0.9,en;q=0.8", "user-agent": "Mozilla/5.0 CodexSites MultiChart" },
      });
      if (!response.ok) {
        value = { reason: response.status === 429 ? "rate_limited" : "provider_unavailable", checkedAt };
      } else {
        const payload: unknown = await response.json();
        if (source === "tpex") {
          const table = (jsonObject(payload) as TpexMarketPayload).tables?.[0];
          const referenceDate = String(table?.date || "").replaceAll("/", "");
          const fields = Array.isArray(table?.fields) ? table.fields.map((field) => String(field).replace(/<[^>]+>/g, "").trim()) : [];
          const fieldIndex = (name: string, fallback: number) => {
            const index = fields.findIndex((field) => field === name || field.startsWith(name));
            return index >= 0 ? index : fallback;
          };
          const indexes = {
            code: fieldIndex("代號", 0), close: fieldIndex("收盤", 2), open: fieldIndex("開盤", 4),
            high: fieldIndex("最高", 5), low: fieldIndex("最低", 6), volume: fieldIndex("成交股數", 7),
          };
          const rows = Array.isArray(table?.data) ? table.data.flatMap((row) => Array.isArray(row) ? [{
            Date: referenceDate, SecuritiesCompanyCode: row[indexes.code], Close: row[indexes.close],
            Open: row[indexes.open], High: row[indexes.high], Low: row[indexes.low], TradeVolume: row[indexes.volume],
          }] : []) : null;
          value = rows ? (rows.length ? { rows, checkedAt } : { reason: "reference_not_published", checkedAt }) : { reason: "invalid_reference_data", checkedAt };
        } else if (source === "twse") {
          value = parseTwseMiIndex(jsonObject(payload) as TwseMiIndexPayload, sessionDate, checkedAt);
        } else {
          value = Array.isArray(payload)
            ? (payload.length ? { rows: payload, checkedAt } : { reason: "reference_not_published", checkedAt })
            : { reason: "invalid_reference_data", checkedAt };
        }
      }
    } catch {
      value = { reason: "provider_unavailable", checkedAt };
    } finally {
      clearTimeout(timeout);
    }
    taiwanMarketCache.set(cacheKey, { expiresAt: Date.now() + (value.reason ? 30_000 : 300_000), value });
    return value;
  })();
  taiwanMarketInflight.set(cacheKey, request);
  try { return await request; }
  finally { taiwanMarketInflight.delete(cacheKey); }
}

async function readTpexMirror(env: Env, sessionDate: string): Promise<TaiwanMarketResult | null> {
  if (!env.DB) return null;
  try {
    await ensureDb(env.DB);
    const stored = await env.DB.prepare("SELECT payload, source_fetched_at FROM tpex_market_mirror WHERE session_date = ?").bind(sessionDate).first<TpexMirrorRow>();
    if (!stored?.payload) return null;
    const rows: unknown = JSON.parse(stored.payload);
    if (!Array.isArray(rows) || rows.length < 500) return null;
    return { rows: rows as TaiwanMarketRow[], checkedAt: String(stored.source_fetched_at || "") };
  } catch { return null; }
}

async function fetchTwseMisReference(code: string, sessionDate: string, exchange: "tse" | "otc"): Promise<TaiwanSymbolResult> {
  const cacheKey = `twse-mis|${exchange}|${code}|${sessionDate}`;
  const cached = taiwanSymbolCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = taiwanSymbolInflight.get(cacheKey);
  if (existing) return existing;
  const request = (async () => {
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let value: TaiwanSymbolResult;
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exchange}_${encodeURIComponent(code)}.tw&json=1&delay=0`;
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", referer: `https://mis.twse.com.tw/stock/fibest.jsp?stock=${encodeURIComponent(code)}`, "user-agent": "Mozilla/5.0 CodexSites MultiChart" } });
      if (!response.ok) {
        value = { provider: "twse-mis", reason: response.status === 429 ? "rate_limited" : "provider_unavailable", checkedAt };
      } else {
        const payload = jsonObject(await response.json()) as TwseMisPayload;
        const row = payload.msgArray?.find((item) => String(item.c) === code && String(item.ex).toLowerCase() === exchange);
        const dateDigits = String(row?.d || "").replace(/\D/g, "");
        const referenceSessionDate = dateDigits.length === 8 ? `${dateDigits.slice(0, 4)}-${dateDigits.slice(4, 6)}-${dateDigits.slice(6, 8)}` : undefined;
        const parsedClose = parseComparableTaiwanClose(row?.z);
        const open = marketNumber(row?.o);
        const high = marketNumber(row?.h);
        const low = marketNumber(row?.l);
        const lots = marketNumber(row?.v, true);
        const quoteTime = referenceSessionDate ? officialCandleTime(referenceSessionDate, String(row?.t || "13:30:00")) : null;
        const candleTime = referenceSessionDate ? officialCandleTime(referenceSessionDate, "09:00:00") : null;
        const clock = taipeiClock(new Date());
        const duringTrading = !["Sat", "Sun"].includes(clock.weekday) && clock.minutes >= 9 * 60 && clock.minutes <= 13 * 60 + 30;
        const candle = referenceSessionDate && parsedClose && open != null && high != null && low != null && lots != null && quoteTime != null && candleTime != null
          ? {
            time: candleTime, open, high, low, close: parsedClose.close, volume: lots * 1000, quoteTime,
            sourceUpdatedAt: checkedAt,
            source: "twse-mis",
            marketSession: duringTrading ? "open" : "closed",
            sourceTimeZone: "Asia/Taipei",
          } satisfies HistoryCandle
          : undefined;
        value = row && referenceSessionDate && parsedClose
          ? { provider: "twse-mis", close: parsedClose.close, referenceSessionDate, checkedAt, ...(candle ? { candle } : {}) }
          : { provider: "twse-mis", reason: row ? "invalid_reference_data" : "symbol_not_covered", checkedAt };
      }
    } catch {
      value = { provider: "twse-mis", reason: "provider_unavailable", checkedAt };
    } finally {
      clearTimeout(timeout);
    }
    taiwanSymbolCache.set(cacheKey, { expiresAt: Date.now() + (value.reason ? 30_000 : 60_000), value });
    return value;
  })();
  taiwanSymbolInflight.set(cacheKey, request);
  try { return await request; }
  finally { taiwanSymbolInflight.delete(cacheKey); }
}

async function verifyTaiwanQuote(env: Env, symbol: string, candles: Candle[], current: QuoteState) {
  const code = symbol.split(".")[0];
  const provider: TaiwanProvider = symbol.toUpperCase().endsWith(".TWO") ? "tpex" : "twse";
  const base = { provider, referenceSessionDate: null as string | null };
  const primarySessionDate = String(current?.sessionDate || "");
  const primaryClose = Number(candles[candles.length - 1]?.close);
  const primarySource = String((candles[candles.length - 1] as HistoryCandle | undefined)?.source || "");
  if (/^(?:twse|tpex)-official$/i.test(primarySource) && /^\d{4}-\d{2}-\d{2}$/.test(primarySessionDate) && Number.isFinite(primaryClose) && primaryClose > 0) {
    return { ...current, verification: { status: "verified", provider, referenceSessionDate: primarySessionDate, checkedAt: (candles[candles.length - 1] as HistoryCandle).sourceUpdatedAt } };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primarySessionDate) || !Number.isFinite(primaryClose) || primaryClose <= 0) {
    return { ...current, verification: { status: "unverified", ...base, reason: "invalid_reference_data" } };
  }
  let market = await fetchTaiwanMarket(provider, primarySessionDate);
  let verificationProvider: string = provider;
  if (market.reason || !market.rows) {
    if (provider === "tpex") {
      const mirror = await readTpexMirror(env, primarySessionDate);
      if (mirror?.rows) {
        market = mirror;
        verificationProvider = "tpex-mirror";
      } else {
        const fallback = await fetchTwseMisReference(code, primarySessionDate, "otc");
        if (!fallback.reason && Number.isFinite(fallback.close) && fallback.referenceSessionDate) {
          if (fallback.referenceSessionDate < primarySessionDate) return { ...current, verification: { status: "pending", provider: fallback.provider, referenceSessionDate: fallback.referenceSessionDate, reason: "reference_not_published", checkedAt: fallback.checkedAt } };
          if (fallback.referenceSessionDate !== primarySessionDate) return { ...current, verification: { status: "unverified", provider: fallback.provider, referenceSessionDate: fallback.referenceSessionDate, reason: "session_mismatch", checkedAt: fallback.checkedAt } };
          const matches = Math.round(primaryClose * 100) === Math.round(Number(fallback.close) * 100);
          return { ...current, verification: { status: matches ? "verified" : "mismatch", provider: fallback.provider, referenceSessionDate: fallback.referenceSessionDate, checkedAt: fallback.checkedAt, ...(matches ? {} : { reason: "close_mismatch" }) } };
        }
        return { ...current, verification: { status: "unverified", ...base, provider: fallback.provider, reason: fallback.reason || market.reason || "provider_unavailable", checkedAt: fallback.checkedAt } };
      }
    }
    else {
      if (market.reason === "reference_not_published") {
        return { ...current, verification: { status: "pending", ...base, reason: "reference_not_published", checkedAt: market.checkedAt } };
      }
      const fallback = await fetchTwseMisReference(code, primarySessionDate, "tse");
      if (!fallback.reason && Number.isFinite(fallback.close) && fallback.referenceSessionDate) {
        if (fallback.referenceSessionDate < primarySessionDate) return { ...current, verification: { status: "pending", provider: fallback.provider, referenceSessionDate: fallback.referenceSessionDate, reason: "reference_not_published", checkedAt: fallback.checkedAt } };
        if (fallback.referenceSessionDate !== primarySessionDate) return { ...current, verification: { status: "unverified", provider: fallback.provider, referenceSessionDate: fallback.referenceSessionDate, reason: "session_mismatch", checkedAt: fallback.checkedAt } };
        const matches = Math.round(primaryClose * 100) === Math.round(Number(fallback.close) * 100);
        return { ...current, verification: { status: matches ? "verified" : "mismatch", provider: fallback.provider, referenceSessionDate: fallback.referenceSessionDate, checkedAt: fallback.checkedAt, ...(matches ? {} : { reason: "close_mismatch" }) } };
      }
      market = await fetchTaiwanMarket("twse-openapi", primarySessionDate);
      verificationProvider = "twse";
      if (market.reason || !market.rows) {
        const reason = market.reason || fallback.reason || "provider_unavailable";
        const status = reason === "reference_not_published" ? "pending" : "unverified";
        return { ...current, verification: { status, ...base, reason, checkedAt: market.checkedAt } };
      }
    }
  }
  const isTpex = provider === "tpex";
  const marketRows = market.rows;
  if (!marketRows) return { ...current, verification: { status: "unverified", provider: verificationProvider, referenceSessionDate: null, reason: market.reason || "invalid_reference_data", checkedAt: market.checkedAt } };
  const row = marketRows.find((item) => String(isTpex ? item.SecuritiesCompanyCode : item.Code) === code);
  if (!row) return { ...current, verification: { status: "unverified", provider: verificationProvider, referenceSessionDate: null, reason: "symbol_not_covered", checkedAt: market.checkedAt } };
  const referenceSessionDate = parseTaiwanSessionDate(row.Date);
  const parsedReference = parseComparableTaiwanClose(isTpex ? row.Close : row.ClosingPrice);
  if (!referenceSessionDate || !parsedReference) {
    return { ...current, verification: { status: "unverified", provider: verificationProvider, referenceSessionDate, reason: "invalid_reference_data", checkedAt: market.checkedAt } };
  }
  if (referenceSessionDate < primarySessionDate) {
    return { ...current, verification: { status: "pending", provider: verificationProvider, referenceSessionDate, reason: "reference_not_published", checkedAt: market.checkedAt } };
  }
  if (referenceSessionDate !== primarySessionDate) {
    return { ...current, verification: { status: "unverified", provider: verificationProvider, referenceSessionDate, reason: "session_mismatch", checkedAt: market.checkedAt } };
  }
  const decimals = Math.min(6, Math.max(0, parsedReference.raw.split(".")[1]?.length ?? 0));
  const scale = 10 ** decimals;
  const matches = Math.round(primaryClose * scale) === Math.round(parsedReference.close * scale);
  return { ...current, verification: { status: matches ? "verified" : "mismatch", provider: verificationProvider, referenceSessionDate, checkedAt: market.checkedAt, ...(matches ? {} : { reason: "close_mismatch" }) } };
}

const MASSIVE_INDEX_SYMBOLS: Record<string, string> = { "^DJI": "I:DJI", "^IXIC": "I:COMP", "^SOX": "I:SOX", "^GSPC": "I:SPX", "^RUT": "I:RUT" };
const MASSIVE_FUTURES_PRODUCTS: Record<string, string> = { "ES=F": "ES", "NQ=F": "NQ", "YM=F": "YM", "RTY=F": "RTY", "MES=F": "MES", "MNQ=F": "MNQ", "MYM=F": "MYM", "M2K=F": "M2K", "EMD=F": "EMD", "CL=F": "CL", "GC=F": "GC", "HE=F": "HE", "HG=F": "HG", "LE=F": "LE", "NG=F": "NG", "SI=F": "SI", "ZB=F": "ZB", "ZC=F": "ZC", "ZN=F": "ZN", "ZS=F": "ZS", "ZW=F": "ZW" };

type MassiveResult = { close?: number; reason?: string; referenceSessionDate?: string; mismatchReason?: string };

async function verifyMassiveQuote(env: Env, symbol: string, candles: Candle[], current: QuoteState) {
  const normalized = symbol.trim().toUpperCase();
  const supported = normalized in MASSIVE_INDEX_SYMBOLS || normalized.endsWith("=X") || normalized.endsWith("=F") || /^[A-Z][A-Z0-9-]{0,9}$/.test(normalized);
  if (!supported) return { ...current, verification: { status: "unverified", provider: null, reason: "unsupported_symbol" } };
  if (!env.MASSIVE_API_KEY) return { ...current, verification: { status: "unverified", provider: "massive", reason: "provider_not_configured" } };
  const sessionDate = String(current.sessionDate || "");
  const reference = await massiveReference(env, normalized, sessionDate);
  if (reference.reason || !Number.isFinite(reference.close)) return { ...current, verification: { status: "unverified", provider: "massive", reason: reference.reason || "invalid_reference_data", referenceSessionDate: reference.referenceSessionDate || null } };
  const primary = Number(candles[candles.length - 1]?.close);
  const precision = normalized.endsWith("=X") ? 5 : 2;
  const scale = 10 ** precision;
  const matches = Math.round(primary * scale) === Math.round(Number(reference.close) * scale);
  let status = matches ? "verified" : "mismatch";
  const reason = matches ? undefined : (reference.mismatchReason || "close_mismatch");
  if (!matches && ["close_definition_mismatch", "continuous_contract_ambiguous"].includes(String(reason))) status = "unverified";
  return { ...current, verification: { status, provider: "massive", referenceSessionDate: reference.referenceSessionDate || sessionDate, ...(reason ? { reason } : {}) } };
}

async function massiveReference(env: Env, symbol: string, sessionDate: string): Promise<MassiveResult> {
  if (MASSIVE_INDEX_SYMBOLS[symbol]) {
    const ticker = MASSIVE_INDEX_SYMBOLS[symbol];
    const payload = await massiveGet(env, `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${sessionDate}/${sessionDate}`, { adjusted: "true", sort: "asc", limit: "2" }, `index|${ticker}|${sessionDate}`);
    if (payload.reason) return payload;
    const results = payload.results || [];
    return results.length ? { close: Number(results[results.length - 1].c), referenceSessionDate: sessionDate } : { reason: "reference_not_published" };
  }
  if (symbol.endsWith("=X")) {
    const ticker = `C:${symbol.slice(0, -2)}`;
    const payload = await massiveGet(env, `https://api.massive.com/v2/aggs/grouped/locale/global/market/fx/${sessionDate}`, { adjusted: "true" }, `forex|${sessionDate}`);
    if (payload.reason) return payload;
    const row = (payload.results || []).find((item) => String(item.T || item.ticker).toUpperCase() === ticker);
    return row ? { close: Number(row.c ?? row.close), referenceSessionDate: sessionDate, mismatchReason: "close_definition_mismatch" } : { reason: "symbol_not_covered" };
  }
  if (symbol.endsWith("=F")) return massiveFuturesReference(env, MASSIVE_FUTURES_PRODUCTS[symbol], sessionDate);
  const ticker = symbol.replace(/-([A-Z])$/, ".$1");
  const payload = await massiveGet(env, `https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/${sessionDate}`, { adjusted: "true" }, `stocks|${sessionDate}`);
  if (payload.reason) return payload;
  const row = (payload.results || []).find((item) => String(item.T || item.ticker).toUpperCase() === ticker);
  return row ? { close: Number(row.c ?? row.close), referenceSessionDate: sessionDate } : { reason: "symbol_not_covered" };
}

async function massiveFuturesReference(env: Env, productCode: string | undefined, sessionDate: string): Promise<MassiveResult> {
  if (!productCode) return { reason: "unsupported_symbol" };
  const contracts = await massiveGet(env, "https://api.massive.com/futures/v1/contracts", { date: sessionDate, product_code: productCode, "first_trade_date.lte": sessionDate, "last_trade_date.gte": sessionDate, limit: "100", sort: "product_code.asc" }, `futures-contracts|${productCode}|${sessionDate}`);
  if (contracts.reason) return contracts;
  const candidates = (contracts.results || []).filter((item) => item.active !== false && Number(item.days_to_maturity) >= 0).sort((a, b) => Number(a.days_to_maturity) - Number(b.days_to_maturity));
  if (!candidates.length) return { reason: "reference_not_published" };
  const ambiguous = Number(candidates[0].days_to_maturity) <= 8 && candidates.length > 1;
  const selected = ambiguous ? candidates[1] : candidates[0];
  const ticker = String(selected.ticker || "");
  const payload = await massiveGet(env, `https://api.massive.com/futures/v1/aggs/${encodeURIComponent(ticker)}`, { resolution: "1session", window_start: sessionDate, limit: "2" }, `futures-aggs|${ticker}|${sessionDate}`);
  if (payload.reason) return payload;
  const row = (payload.results || []).find((item) => String(item.session_end_date || "") === sessionDate) || (payload.results || [])[0];
  return row ? { close: Number(row.close), referenceSessionDate: String(row.session_end_date || sessionDate), ...(ambiguous ? { mismatchReason: "continuous_contract_ambiguous" } : {}) } : { reason: "reference_not_published" };
}

async function massiveGet(env: Env, endpoint: string, params: Record<string, string>, cacheSuffix: string): Promise<MassivePayload> {
  const cacheKey = `reference|massive|${cacheSuffix}`;
  const now = Math.floor(Date.now() / 1000);
  if (env.DB) {
    try {
      await ensureDb(env.DB);
      const cached = await env.DB.prepare("SELECT payload FROM candle_cache WHERE cache_key = ? AND expires_at > ?").bind(cacheKey, now).first<CandleCacheRow>();
      if (cached?.payload) {
        recordCacheEvent("hit");
        return JSON.parse(cached.payload) as MassivePayload;
      }
      recordCacheEvent("miss");
    } catch {
      recordCacheEvent("read_failure");
    }
  }
  const url = new URL(endpoint); Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  let value: MassivePayload;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${env.MASSIVE_API_KEY}` } });
    const reasons: Record<number, string> = { 401: "invalid_credentials", 403: "not_entitled", 404: "symbol_not_covered", 429: "rate_limited" };
    if (!response.ok) value = { reason: reasons[response.status] || "provider_unavailable" };
    else { const payload: unknown = await response.json(); value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as MassivePayload : { reason: "provider_unavailable" }; }
  } catch { value = { reason: "provider_unavailable" }; }
  if (env.DB) {
    try {
      await env.DB.prepare(`INSERT INTO candle_cache (cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`).bind(cacheKey, JSON.stringify(value), now + (value.reason ? 60 : 21600)).run();
    } catch {
      recordCacheEvent("write_failure");
    }
  }
  return value;
}

async function tabMutationContext(request: Request, env: Env) {
  const uid = userId(request);
  const [baseText, rows] = await Promise.all([setupText(request, env), personalTabRows(env.DB, uid)]);
  const model = resolveEffectiveTabs(systemTabs(parseSetup(baseText)), rows);
  return { uid, rows, model };
}

function tabMutationBlockedResponse(model: ReturnType<typeof resolveEffectiveTabs>) {
  if (!model.blockingDiagnostics.length) return null;
  return json({ ok: false, error: "頁籤資料需要先完成安全修復，這次異動尚未寫入。", reason: "ambiguous_legacy_tab_data" }, 409);
}

function systemOverrideRowId(tab: ManagedTab) {
  return tab.overrideRowId || `tab-override-${crypto.randomUUID()}`;
}

function tabOrderStatement(db: D1Database, uid: string, tab: ManagedTab, sortOrder: number, enabled: boolean, isDefault: boolean, label = tab.label) {
  if (tab.tabKey.startsWith("system:")) {
    return db.prepare(`INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET label=excluded.label,sort_order=excluded.sort_order,enabled=excluded.enabled,is_default=excluded.is_default,source_tab_id=excluded.source_tab_id,updated_at=CURRENT_TIMESTAMP`).bind(
      uid,
      systemOverrideRowId(tab),
      label,
      sortOrder,
      enabled ? 1 : 0,
      isDefault ? 1 : 0,
      tab.sourceTabId || tab.id,
    );
  }
  return db.prepare("UPDATE user_tabs SET label=?, sort_order=?, enabled=?, is_default=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=? AND source_tab_id=''").bind(
    label,
    sortOrder,
    enabled ? 1 : 0,
    isDefault ? 1 : 0,
    uid,
    tab.id,
  );
}

function normalizedVisibleTabStatements(db: D1Database, uid: string, tabs: ManagedTab[], defaultTabKey: string) {
  return [
    db.prepare("UPDATE user_tabs SET is_default=0, updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(uid),
    ...tabs.map((tab, index) => tabOrderStatement(db, uid, tab, index + 1, true, tab.tabKey === defaultTabKey)),
  ];
}

async function parseTabMutationBody(request: Request) {
  try { return jsonObject(await request.json()); }
  catch { return null; }
}

async function reorderTabs(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  await ensureDb(env.DB);
  const body = await parseTabMutationBody(request);
  if (!body) return json({ ok: false, error: "頁籤排序資料格式錯誤。" }, 400);
  const orderedTabKeys = Array.isArray(body.orderedTabKeys) ? body.orderedTabKeys.map((value) => String(value || "")) : [];
  const revision = Number(body.revision);
  if (!Number.isInteger(revision) || revision < 1 || !orderedTabKeys.length) return json({ ok: false, error: "頁籤排序資料格式錯誤。" }, 400);

  const { uid, model } = await tabMutationContext(request, env);
  const blocked = tabMutationBlockedResponse(model);
  if (blocked) return blocked;
  const visibleKeys = model.marketTabs.map((tab) => tab.tabKey);
  const requested = new Set(orderedTabKeys);
  const valid = requested.size === orderedTabKeys.length
    && orderedTabKeys.length === visibleKeys.length
    && visibleKeys.every((key) => requested.has(key));
  if (!valid) return json({ ok: false, error: "頁籤排序必須包含全部顯示中的頁籤，且不可重複。", reason: "invalid_tab_order" }, 400);

  const byKey = new Map(model.marketTabs.map((tab) => [tab.tabKey, tab]));
  const orderedTabs = orderedTabKeys.map((key) => byKey.get(key)).filter((tab): tab is ManagedTab => Boolean(tab));
  const defaultTabKey = model.marketTabs.find((tab) => tab.isDefault)?.tabKey || orderedTabs[0].tabKey;
  await env.DB.batch(normalizedVisibleTabStatements(env.DB, uid, orderedTabs, defaultTabKey));
  return json({ ...(await instrumentPayload(request, env)), ok: true, acceptedRevision: revision });
}

async function changeTabVisibility(request: Request, env: Env, input?: { tabKey: string; enabled: boolean }) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  await ensureDb(env.DB);
  const body = input || await parseTabMutationBody(request);
  if (!body || typeof body.enabled !== "boolean" || !String(body.tabKey || "")) return json({ ok: false, error: "頁籤顯示狀態格式錯誤。" }, 400);
  const tabKey = String(body.tabKey);
  const enabled = body.enabled;
  const { uid, model } = await tabMutationContext(request, env);
  const blocked = tabMutationBlockedResponse(model);
  if (blocked) return blocked;
  const target = model.managedTabs.find((tab) => tab.tabKey === tabKey);
  if (!target) return json({ ok: false, error: "找不到這個頁籤。" }, 404);
  if (target.enabled === enabled) return json({ ok: false, error: enabled ? "頁籤已經顯示。" : "頁籤已經隱藏。", reason: "tab_visibility_unchanged" }, 409);
  if (!enabled && model.marketTabs.length <= 1) return json({ ok: false, error: "至少要保留一個顯示中的頁籤。", reason: "last_visible_tab" }, 400);

  const visibleTabs = enabled
    ? [...model.marketTabs, { ...target, enabled: true }]
    : model.marketTabs.filter((tab) => tab.tabKey !== target.tabKey);
  const previousDefault = model.marketTabs.find((tab) => tab.isDefault)?.tabKey || "";
  const defaultTabKey = previousDefault && visibleTabs.some((tab) => tab.tabKey === previousDefault)
    ? previousDefault
    : visibleTabs[0]?.tabKey || "";
  const statements = normalizedVisibleTabStatements(env.DB, uid, visibleTabs, defaultTabKey);
  if (!enabled) statements.splice(1, 0, tabOrderStatement(env.DB, uid, target, target.sortOrder, false, false));
  await env.DB.batch(statements);
  return json({ ...(await instrumentPayload(request, env)), ok: true });
}

async function saveTab(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  await ensureDb(env.DB);
  const item = await parseTabMutationBody(request);
  if (!item) return json({ ok: false, error: "頁籤資料格式錯誤。" }, 400);
  const label = String(item.label || "").trim();
  if (!label) return json({ ok: false, error: "頁籤名稱不可為空白。" }, 400);
  const { uid, rows, model } = await tabMutationContext(request, env);
  const blocked = tabMutationBlockedResponse(model);
  if (blocked) return blocked;
  const requestedTabKey = String(item.tabKey || "");
  const target = requestedTabKey ? model.managedTabs.find((tab) => tab.tabKey === requestedTabKey) : undefined;
  if (requestedTabKey && !target) return json({ ok: false, error: "找不到這個頁籤。" }, 404);
  const isDefault = item.isDefault === true;
  const statements = [];
  if (isDefault) statements.push(env.DB.prepare("UPDATE user_tabs SET is_default=0, updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(uid));
  if (target) {
    if (target.tabKey.startsWith("system:")) {
      statements.push(tabOrderStatement(env.DB, uid, target, target.sortOrder, target.enabled, isDefault, label));
    } else {
      statements.push(env.DB.prepare("UPDATE user_tabs SET label=?, is_default=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=? AND source_tab_id=''").bind(label, isDefault ? 1 : 0, uid, target.id));
    }
  } else {
    const id = String(item.id || `tab-${crypto.randomUUID()}`);
    if (!id || rows.some((row) => row.id === id) || Object.values(TAB_IDS).includes(id)) return json({ ok: false, error: "頁籤識別碼已存在。" }, 409);
    statements.push(env.DB.prepare("INSERT INTO user_tabs (user_id,id,label,sort_order,enabled,is_default,source_tab_id) VALUES (?,?,?,?,1,?,'')").bind(uid, id, label, model.marketTabs.length + 1, isDefault ? 1 : 0));
  }
  await env.DB.batch(statements);
  return json({ ...(await instrumentPayload(request, env)), ok: true });
}

async function resetSystemTab(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  await ensureDb(env.DB);
  const body = await parseTabMutationBody(request);
  const tabKey = String(body?.tabKey || "");
  const context = await tabMutationContext(request, env);
  const blocked = tabMutationBlockedResponse(context.model);
  if (blocked) return blocked;
  const target = context.model.managedTabs.find((tab) => tab.tabKey === tabKey);
  if (!target || !target.tabKey.startsWith("system:")) return json({ ok: false, error: "只有系統頁籤可以恢復系統預設。" }, 400);
  if (!target.hasOverride) return json({ ok: false, error: "這個頁籤目前就是系統預設。", reason: "system_tab_not_overridden" }, 409);
  await env.DB.prepare("DELETE FROM user_tabs WHERE user_id=? AND (source_tab_id=? OR (source_tab_id='' AND id=?))").bind(context.uid, target.sourceTabId || target.id, target.id).run();
  const refreshed = await tabMutationContext(request, env);
  const defaultTabKey = refreshed.model.marketTabs.find((tab) => tab.isDefault)?.tabKey || refreshed.model.marketTabs[0]?.tabKey || "";
  const existingRows = refreshed.model.marketTabs.filter((tab) => tab.source === "personal" || tab.hasOverride);
  await env.DB.batch([
    env.DB.prepare("UPDATE user_tabs SET is_default=0, updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(refreshed.uid),
    ...existingRows.map((tab) => tabOrderStatement(env.DB!, refreshed.uid, tab, tab.sortOrder, true, tab.tabKey === defaultTabKey)),
  ]);
  return json({ ...(await instrumentPayload(request, env)), ok: true });
}

async function deleteCustomTab(request: Request, env: Env, tabKey: string) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  await ensureDb(env.DB);
  const { uid, model } = await tabMutationContext(request, env);
  const blocked = tabMutationBlockedResponse(model);
  if (blocked) return blocked;
  const target = model.managedTabs.find((tab) => tab.tabKey === tabKey);
  if (!target) return json({ ok: false, error: "找不到這個頁籤。" }, 404);
  if (target.source !== "personal") return json({ ok: false, error: "系統頁籤不能永久刪除。" }, 400);
  if (target.enabled && model.marketTabs.length <= 1) return json({ ok: false, error: "至少要保留一個顯示中的頁籤。", reason: "last_visible_tab" }, 400);
  const remaining = model.marketTabs.filter((tab) => tab.tabKey !== target.tabKey);
  const previousDefault = model.marketTabs.find((tab) => tab.isDefault)?.tabKey || "";
  const defaultTabKey = remaining.some((tab) => tab.tabKey === previousDefault) ? previousDefault : remaining[0]?.tabKey || "";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_instruments WHERE user_id=? AND tab_id=?").bind(uid, target.id),
    env.DB.prepare("DELETE FROM user_tabs WHERE user_id=? AND id=? AND source_tab_id=''").bind(uid, target.id),
    ...normalizedVisibleTabStatements(env.DB, uid, remaining, defaultTabKey),
  ]);
  await syncRealtimeWatchlist(request, env, uid);
  return json({ ...(await instrumentPayload(request, env)), ok: true });
}

function scheduleWatchlistChipPrewarm(request: Request, env: Env, items: SaveInstrumentInput[], context?: AppExecutionContext) {
  if (!context || !env.DB) return;
  const symbols = [...new Set(items
    .filter((item) => item?.enabled !== false)
    .map((item) => normalizeSymbol(String(item?.symbol || "")))
    .filter(Boolean))];
  if (!symbols.length) return;
  context.waitUntil(Promise.all(symbols.map(async (symbol) => {
    try {
      const eligibility = await taiwanChipEligibility(request, env, symbol);
      if (eligibility.eligible) {
        await registerAndWarmTaiwanChipTarget(env, eligibility, true);
      }
    } catch {
      // Durable GitHub scheduler will retry missing or stale datasets.
    }
  })).then(() => undefined));
}

async function registerAndWarmTaiwanChipTarget(
  env: Env,
  eligibility: Awaited<ReturnType<typeof taiwanChipEligibility>>,
  includeDailyPrewarm: boolean,
) {
  if (!env.DB || !eligibility.eligible) return;
  const symbol = eligibility.symbol;
  await upsertTdccContinuousTarget({ db: env.DB, target: { symbol, source: "user" } });
  const jobs: Promise<unknown>[] = [queueTdccContinuousSymbolBackfill({ db: env.DB, symbol })];
  if (includeDailyPrewarm) jobs.push(prewarmTaiwanStockChipSymbol({ env, eligibility }));
  const [queued] = await Promise.allSettled(jobs);
  if (queued.status === "fulfilled" && queued.value.status === "queued") {
    await dispatchTdccContinuousWorkflow({
      db: env.DB,
      symbol,
      token: env.GITHUB_WORKFLOW_DISPATCH_TOKEN,
      deploymentTarget: String(env.DEPLOYMENT_TARGET || "").toLowerCase() === "cloudflare" ? "cloudflare" : "sites",
    });
  }
}

function scheduleMissingTaiwanChipTarget(
  env: Env,
  eligibility: Awaited<ReturnType<typeof taiwanChipEligibility>>,
  context?: AppExecutionContext,
) {
  if (!context || !eligibility.needsTdccRegistration) return;
  context.waitUntil(registerAndWarmTaiwanChipTarget(env, eligibility, false).catch(() => undefined));
}

function validBackfillDate(value: unknown) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

async function requestTaiwanStockChipBackfill(request: Request, env: Env, context?: AppExecutionContext) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  if (!identifiedUserId(request)) return json({ ok: false, error: "請先登入後再要求回補資料。" }, 401);
  let body: JsonObject;
  try { body = jsonObject(await request.json()); }
  catch { return json({ ok: false, error: "回補資料格式錯誤。" }, 400); }
  const symbol = normalizeSymbol(String(body.symbol || ""));
  const datasets = [...new Set((Array.isArray(body.datasets) ? body.datasets : []).map((value) => String(value || "")))];
  const start = String(body.start || "");
  const end = String(body.end || "");
  const maximumRangeMs = WATCHLIST_CHIP_PREWARM_CONTRACT.lookbackDays * 86400000;
  if (
    !symbol
    || !datasets.length
    || datasets.some((dataset) => !MANUAL_CHIP_BACKFILL_DATASETS.includes(dataset as typeof MANUAL_CHIP_BACKFILL_DATASETS[number]))
    || !validBackfillDate(start)
    || !validBackfillDate(end)
    || start > end
    || Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`) > maximumRangeMs
  ) return json({ ok: false, error: "回補商品、資料項目或日期範圍無效。" }, 400);

  await ensureDb(env.DB);
  const eligibility = await taiwanChipEligibility(request, env, symbol);
  if (!eligibility.eligible) return json({ ok: false, error: "此商品不適用台股籌碼回補。" }, 400);

  const dailyRequested = datasets.filter((dataset) => dataset !== "shareholder-distribution");
  const states = dailyRequested.length
    ? (await env.DB.prepare(`SELECT symbol,dataset,coverage_start,coverage_end,source_date,status,reason_code,last_success_at,last_attempt_at,retry_after
        FROM taiwan_stock_chip_fetch_state WHERE symbol=? AND dataset IN (${dailyRequested.map(() => "?").join(",")})`)
      .bind(symbol, ...dailyRequested).all<ChipBackfillStateRow>()).results || []
    : [];
  const stateByDataset = new Map(states.map((row) => [String(row.dataset || ""), row]));
  const now = Date.now();
  const daily = { accepted: [] as string[], complete: [] as string[], cooldown: [] as string[], retryWaiting: [] as string[] };
  for (const dataset of dailyRequested) {
    const state = stateByDataset.get(dataset);
    const retryAfter = Date.parse(String(state?.retry_after || ""));
    const lastAttempt = Date.parse(String(state?.last_attempt_at || ""));
    const lastSuccess = Date.parse(String(state?.last_success_at || ""));
    const complete = state?.status === "available"
      && String(state.coverage_start || "") <= start
      && String(state.coverage_end || "") >= end
      && String(state.source_date || "") >= end
      && Number.isFinite(lastSuccess)
      && now - lastSuccess < WATCHLIST_CHIP_PREWARM_CONTRACT.freshnessMs;
    if (complete) daily.complete.push(dataset);
    else if (Number.isFinite(retryAfter) && retryAfter > now) daily.retryWaiting.push(dataset);
    else if (Number.isFinite(lastAttempt) && now - lastAttempt < MANUAL_CHIP_BACKFILL_COOLDOWN_MS) daily.cooldown.push(dataset);
    else daily.accepted.push(dataset);
  }

  let tdcc: { status: string; backfill?: unknown } | null = null;
  let dispatch: Awaited<ReturnType<typeof dispatchTdccContinuousWorkflow>> | null = null;
  if (datasets.includes("shareholder-distribution")) {
    await upsertTdccContinuousTarget({ db: env.DB, target: { symbol, source: "user" } });
    const current = await readTdccContinuousSymbolStatus(env.DB, symbol);
    const complete = current.status === "completed"
      && Number(current.expectedWeeks || 0) >= TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks
      && Number(current.completedWeeks || 0) >= Number(current.expectedWeeks || 0)
      && (!Array.isArray(current.missingDates) || current.missingDates.length === 0);
    tdcc = complete
      ? { status: "complete", backfill: current }
      : await queueTdccContinuousSymbolBackfill({ db: env.DB, symbol });
    if (tdcc.status === "queued") {
      dispatch = await dispatchTdccContinuousWorkflow({
        db: env.DB,
        symbol,
        token: env.GITHUB_WORKFLOW_DISPATCH_TOKEN,
        deploymentTarget: String(env.DEPLOYMENT_TARGET || "").toLowerCase() === "cloudflare" ? "cloudflare" : "sites",
      });
    } else if (tdcc.status === "already-running") {
      dispatch = { status: "already-running", requestedAt: new Date().toISOString(), cooldownUntil: null };
    }
  }

  if (daily.accepted.length) {
    if (!context) return json({ ok: false, error: "背景回補目前不可用。" }, 503);
    context.waitUntil(prewarmTaiwanStockChipSymbol({ env, eligibility, datasets: daily.accepted }).then(() => undefined).catch(() => undefined));
  }
  const tdccAccepted = tdcc?.status === "queued";
  let status = "complete";
  if (daily.accepted.length) status = "accepted";
  else if (["started", "already-running", "cooldown"].includes(String(dispatch?.status || ""))) status = String(dispatch?.status);
  else if (tdccAccepted) status = "queued";
  else if (tdcc?.status === "already-running") status = "already-running";
  else if (tdcc?.status === "blocked") status = "blocked";
  else if (daily.retryWaiting.length) status = "retry-waiting";
  else if (daily.cooldown.length) status = "cooldown";

  let message = "目前資料已完整，不需回補。";
  if (status === "accepted") message = "日資料回補已開始。";
  else if (status === "started") message = "TDCC 歷史回補已立即啟動。";
  else if (["already-running", "cooldown"].includes(status) && dispatch) message = "TDCC 歷史回補正在執行。";
  else if (status === "queued" && dispatch?.status === "unavailable") message = "TDCC 已排入背景回補；立即啟動服務尚未設定。";
  else if (status === "queued" && dispatch?.status === "failed") message = "TDCC 已排入背景回補；立即啟動失敗，背景排程將接手。";
  else if (status === "queued") message = "TDCC 歷史資料已排入背景回補。";
  else if (status === "blocked") message = "TDCC 來源目前受阻擋，無法由一般操作重試。";
  else if (status === "retry-waiting") message = "來源仍在等待重試，請稍後再試。";
  else if (status === "cooldown") message = "相同商品剛要求過回補，請稍後再試。";
  return json({ ok: true, symbol, status, message, daily, tdcc, dispatch }, daily.accepted.length || tdccAccepted ? 202 : 200);
}

async function saveInstrument(request: Request, env: Env, list?: SaveInstrumentInput[], context?: AppExecutionContext) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  await ensureDb(env.DB);
  const uid = identifiedUserId(request);
  if (!uid) return json({ ok: false, error: "請先登入後再修改清單。" }, 401);
  const items = list ?? [jsonObject(await request.json()) as SaveInstrumentInput];
  const normalizedItems: Array<SaveInstrumentInput & { symbolText: string; recommenderText: string; recommenderProvided: boolean }> = [];
  try {
    for (const item of items) {
      const symbolText = String(item.symbol || "").trim().toUpperCase();
      if (!symbolText) continue;
      const recommenderProvided = Object.prototype.hasOwnProperty.call(item, "recommender");
      normalizedItems.push({
        ...item,
        symbolText,
        recommenderProvided,
        recommenderText: recommenderProvided ? normalizeRecommender(item.recommender) : "",
      });
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ ok: false, error: code === "recommender_too_long" ? "推薦人最多 80 個字。" : "推薦人包含不允許的控制字元。" }, 400);
  }
  for (const item of normalizedItems) {
    const tabId = String(item.tabId || "");
    const existing = await env.DB.prepare("SELECT item_id,recommender FROM user_instruments WHERE user_id = ? AND symbol = ? AND tab_id = ?").bind(uid, item.symbolText, tabId).first<ExistingWatchlistRow>();
    const values = [
      String(item.name || item.symbolText),
      String(item.provider || "yfinance"),
      String(item.tab || "其他"),
      String(item.group || "自訂"),
      String(item.market || item.tab || "其他"),
      item.enabled === false ? 0 : 1,
      item.defaultOrder == null ? null : Number(item.defaultOrder),
    ] as const;
    if (existing) {
      if (item.recommenderProvided) {
        await env.DB.prepare("UPDATE user_instruments SET name=?,provider=?,tab_label=?,group_name=?,market=?,enabled=?,sort_order=?,recommender=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND symbol=? AND tab_id=?")
          .bind(...values, item.recommenderText, uid, item.symbolText, tabId).run();
      } else {
        await env.DB.prepare("UPDATE user_instruments SET name=?,provider=?,tab_label=?,group_name=?,market=?,enabled=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND symbol=? AND tab_id=?")
          .bind(...values, uid, item.symbolText, tabId).run();
      }
    } else {
      await env.DB.prepare("INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order,added_at,date_status,date_source,recommender) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(uid, newWatchlistItemId(), item.symbolText, values[0], values[1], tabId, values[2], values[3], values[4], values[5], values[6], taipeiCalendarDate(), "known", "server", item.recommenderText).run();
    }
  }
  scheduleWatchlistChipPrewarm(request, env, normalizedItems, context);
  const realtime = await syncRealtimeWatchlist(request, env, uid);
  return json({ ...(await instrumentPayload(request, env)), ok: true, realtime });
}

async function syncRealtimeWatchlist(request: Request, env: Env, uid: string) {
  if (!env.DB || !realtimeViewerCapability(request, env)) {
    return notifyRealtimeWatchlistSymbols(request, env, []);
  }
  const rows = await env.DB.prepare("SELECT symbol FROM user_instruments WHERE user_id=? AND enabled=1 ORDER BY symbol").bind(uid).all<SymbolRow>();
  return notifyRealtimeWatchlistSymbols(request, env, rows.results.map((row) => row.symbol));
}

async function updateWatchlistMetadata(request: Request, env: Env, itemId: string) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  const uid = identifiedUserId(request);
  if (!uid) return json({ ok: false, error: "請先登入後再修改清單。" }, 401);
  await ensureDb(env.DB);
  const existing = await env.DB.prepare("SELECT item_id FROM user_instruments WHERE user_id = ? AND item_id = ?").bind(uid, itemId).first<ExistingWatchlistRow>();
  if (!existing) return json({ ok: false, error: "找不到清單項目。" }, 404);
  let body: JsonObject;
  try { body = jsonObject(await request.json()); }
  catch { return json({ ok: false, error: "推薦人資料格式不正確。" }, 400); }
  let recommender: string;
  try { recommender = normalizeRecommender(body.recommender); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ ok: false, error: code === "recommender_too_long" ? "推薦人最多 80 個字。" : "推薦人包含不允許的控制字元。" }, 400);
  }
  await env.DB.prepare("UPDATE user_instruments SET recommender = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND item_id = ?").bind(recommender, uid, itemId).run();
  return json({ ...(await instrumentPayload(request, env)), ok: true, itemId });
}

function parseReorderRequest(value: unknown): ReorderRequest {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const tabId = String(record.tabId || "").trim();
  const tabLabel = String(record.tabLabel || "").trim();
  const scope = record.scope;
  const revision = Number(record.revision);
  if (!tabId || !tabLabel || (scope !== "system" && scope !== "personal")) throw new Error("排序頁籤資料不完整。");
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("排序 revision 無效。");
  if (!Array.isArray(record.items) || record.items.length === 0) throw new Error("排序項目不可為空白。");
  const items = record.items.map((item) => {
    const identity = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { symbol: String(identity.symbol || "").trim().toUpperCase(), tabId: String(identity.tabId || "").trim() };
  });
  if (items.some((item: ReorderItemIdentity) => !item.symbol)) throw new Error("排序項目缺少 symbol。");
  if (new Set(items.map((item: ReorderItemIdentity) => item.symbol)).size !== items.length) throw new Error("排序項目不可重複。");
  return { tabId, tabLabel, scope, items, revision };
}

function mergedSystemInstruments(base: Instrument[], custom: Instrument[]) {
  const merged = [...base];
  for (const item of custom.filter((candidate) => !(candidate.tabId || ""))) {
    const index = merged.findIndex((candidate) => candidate.symbol === item.symbol && candidate.tab === item.tab);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

async function reorderInstruments(request: Request, env: Env) {
  if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
  let reorder: ReorderRequest;
  try { reorder = parseReorderRequest(await request.json()); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "排序資料無效。" }, 400); }

  await ensureDb(env.DB);
  const uid = userId(request);
  const [base, tabRows, custom] = await Promise.all([
    setupText(request, env).then(parseSetup),
    personalTabRows(env.DB, uid),
    personalInstruments(env.DB, uid),
  ]);

  let eligible: Instrument[];
  if (reorder.scope === "system") {
    const effective = resolveEffectiveTabs(systemTabs(mergedSystemInstruments(base, custom)), tabRows)
      .marketTabs.find((tab) => tab.tabKey === systemTabKey(reorder.tabId));
    if (!effective || effective.label !== reorder.tabLabel) return json({ ok: false, error: "系統頁籤身分不符。" }, 400);
    if (reorder.items.some((item) => item.tabId !== "")) return json({ ok: false, error: "排序包含其他頁籤的商品。" }, 400);
    const baseLabel = Object.entries(TAB_IDS).find(([, id]) => id === reorder.tabId)?.[0] || reorder.tabLabel;
    eligible = mergedSystemInstruments(base, custom).filter((item) => item.enabled && !(item.tabId || "") && [baseLabel, reorder.tabLabel].includes(item.tab));
  } else {
    const tab = tabRows.find((candidate) => candidate.id === reorder.tabId && candidate.label === reorder.tabLabel && Boolean(candidate.enabled) && !candidate.source_tab_id);
    if (!tab) return json({ ok: false, error: "找不到指定的個人頁籤。" }, 400);
    if (reorder.items.some((item) => item.tabId !== reorder.tabId)) return json({ ok: false, error: "排序包含其他頁籤的商品。" }, 400);
    const inherited = mergedSystemInstruments(base, custom).filter((item) => item.enabled && !(item.tabId || "") && item.tab === reorder.tabLabel);
    const personal = custom.filter((item) => item.enabled && item.tabId === reorder.tabId);
    const personalBySymbol = new Map(personal.map((item) => [item.symbol, item]));
    eligible = [...inherited.map((item) => personalBySymbol.get(item.symbol) || item), ...personal.filter((item) => !inherited.some((candidate) => candidate.symbol === item.symbol))];
  }

  const eligibleBySymbol = new Map(eligible.map((item) => [item.symbol, item]));
  const submittedSymbols = reorder.items.map((item) => item.symbol);
  if (eligibleBySymbol.size !== submittedSymbols.length || submittedSymbols.some((symbol) => !eligibleBySymbol.has(symbol))) {
    return json({ ok: false, error: "排序項目與目前頁籤內容不一致，請重新整理後再試。" }, 409);
  }

  const statements = submittedSymbols.map((symbol, index) => {
    const item = eligibleBySymbol.get(symbol)!;
    const targetTabId = reorder.scope === "personal" ? reorder.tabId : "";
    return env.DB!.prepare(`INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order,added_at,date_status,date_source,recommender) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,symbol,tab_id) DO UPDATE SET sort_order=excluded.sort_order,updated_at=CURRENT_TIMESTAMP`)
      .bind(uid, newWatchlistItemId(), symbol, item.name, item.provider, targetTabId, reorder.tabLabel, item.group, item.market, 1, index + 1, null, "legacy_unknown", null, "");
  });
  await env.DB.batch(statements);
  return json({ ok: true, tabId: reorder.tabId, tabLabel: reorder.tabLabel, scope: reorder.scope, revision: reorder.revision, order: submittedSymbols });
}

async function streamResponse(request: Request, env: Env) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") || "SAMPLE"; const interval = url.searchParams.get("interval") || "1d";
  if (!intervalsForRequest(request).includes(interval)) return json({ ok: false, reasonCode: "unsupported_interval" }, 400);
  const indicatorParameters = indicatorParametersFromSearchParams(url.searchParams);
  const pivotMode = normalizePivotMode(url.searchParams.get("pivot"));
  const encoder = new TextEncoder(); let cancelled = false; let timer: ReturnType<typeof setTimeout> | null = null; let wake: (() => void) | null = null;
  const waitForNextUpdate = () => new Promise<void>((resolve) => {
    wake = resolve;
    timer = setTimeout(() => { timer = null; wake = null; resolve(); }, 20000);
  });
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: "status", message: `${symbol} / ${interval} Sites 即時資料啟動` });
      while (!cancelled) {
        try { const payload = await cachedCandlePayload(env, symbol, interval, 160, indicatorParameters, pivotMode, realtimeViewerCapability(request, env)); send({ type: "candle", candle: payload.candles[payload.candles.length - 1], quote: payload.quote, indicators: payload.indicators, source: payload.quote.sourceProvider }); }
        catch { send({ type: "status", message: "即時資料暫時不可用，正在重試。" }); }
        if (!cancelled) await waitForNextUpdate();
      }
    }, cancel() { cancelled = true; if (timer) clearTimeout(timer); timer = null; wake?.(); wake = null; },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" } });
}

async function taiwanChipEligibility(request: Request, env: Env, symbol: string) {
  const canonical = normalizeSymbol(symbol);
  const base = parseSetup(await setupText(request, env)).map(localCatalogEntry);
  const catalog = await readInstrumentCatalog(env.DB);
  const uid = identifiedUserId(request);
  const savedRow = canonical && uid && env.DB
    ? await env.DB.prepare("SELECT * FROM user_instruments WHERE user_id = ? AND symbol = ? AND enabled = 1 LIMIT 1").bind(uid, canonical).first<UserInstrumentRow>()
    : null;
  const savedEntry = savedRow ? localCatalogEntry({
    symbol: normalizeSymbol(savedRow.symbol),
    name: String(savedRow.name || savedRow.symbol),
    provider: String(savedRow.provider || "yfinance"),
    tabId: String(savedRow.tab_id || ""),
    tab: String(savedRow.tab_label || "其他"),
    group: String(savedRow.group_name || "自訂"),
    market: String(savedRow.market || "台灣股市"),
    enabled: true,
    defaultOrder: savedRow.sort_order == null ? null : Number(savedRow.sort_order),
  }) : null;
  const merged = new Map([...base, ...catalog, ...(savedEntry ? [savedEntry] : [])].map((item) => [item.symbol, item]));
  const eligibleEntries = [...merged.values()].filter(isEligibleTaiwanEquity);
  const entry = merged.get(canonical);
  const registeredTarget = entry && env.DB
    ? await env.DB.prepare("SELECT symbol FROM tdcc_continuous_symbols WHERE symbol = ? LIMIT 1").bind(canonical).first<{ symbol: string }>()
    : null;
  return {
    eligible: Boolean(entry && isEligibleTaiwanEquity(entry)),
    symbol: canonical,
    exchange: entry?.exchange === "TWSE" || entry?.exchange === "TPEx" ? entry.exchange : "" as const,
    quoteType: entry?.quoteType || "",
    eligibleSymbols: new Set(eligibleEntries.map((item) => item.symbol)),
    needsTdccRegistration: Boolean(savedEntry && entry && isEligibleTaiwanEquity(entry) && !registeredTarget),
  };
}

async function taiwanStockChipHealth(env: Env) {
  const definitions = {
    "institutional-flow": { providers: ["finmind", "twse", "tpex"], frequency: "daily" },
    "foreign-holding": { providers: ["finmind", "tpex"], frequency: "daily" },
    "margin-short": { providers: ["finmind", "twse", "tpex"], frequency: "daily" },
    "securities-lending": { providers: ["finmind"], frequency: "daily" },
    "shareholder-distribution": { providers: ["tdcc"], frequency: "weekly" },
  } as const;
  let rows: ChipHealthRow[] = [];
  if (env.DB) {
    await ensureDb(env.DB);
    rows = (await env.DB.prepare("SELECT dataset, coverage_start, coverage_end, source_date, status, reason_code, last_success_at, last_attempt_at FROM taiwan_stock_chip_fetch_state ORDER BY dataset, last_success_at DESC").all<ChipHealthRow>()).results;
  }
  const datasets = Object.fromEntries(Object.entries(definitions).map(([dataset, definition]) => {
    const states = rows.filter((row) => row.dataset === dataset);
    const coverageStarts = states.map((row) => row.coverage_start).filter(Boolean).sort();
    const coverageEnds = states.map((row) => row.coverage_end).filter(Boolean).sort();
    const latest = [...states].sort((a, b) => String(b.last_success_at || b.last_attempt_at || "").localeCompare(String(a.last_success_at || a.last_attempt_at || "")))[0];
    return [dataset, {
      ...definition,
      configured: true,
      coverage: { start: coverageStarts[0] || null, end: coverageEnds.at(-1) || null },
      sourceDate: latest?.source_date || null,
      lastSuccessAt: latest?.last_success_at || null,
      status: latest?.status || "not_requested",
      reason: latest?.reason_code || null,
    }];
  }));
  return { enabled: true, datasets, backgroundOrchestrator: await readChipBackfillOrchestratorHealth(env.DB), watchlistPrewarming: await readWatchlistChipPrewarmHealth(env.DB), shareholderDistributionBackfill: await readTdccHistoryBackfillStatus(env.DB), shareholderDistributionContinuous: await readTdccContinuousHealth(env.DB), immediateWorkflowDispatchConfigured: Boolean(env.GITHUB_WORKFLOW_DISPATCH_TOKEN), finMindTokenConfigured: Boolean(env.FINMIND_API_TOKEN) };
}

export async function runChipBackfillScheduled(env: Env, scheduledTime: number) {
  if (!env.DB || !env.TDCC_CONTINUOUS_BACKFILL_SECRET) throw new Error("d1_unavailable");
  const runId = `sites-scheduled-${Math.trunc(scheduledTime)}`;
  const headers = { authorization: `Bearer ${env.TDCC_CONTINUOUS_BACKFILL_SECRET}`, "content-type": "application/json" };
  const invoke = async (action: string) => {
    const response = await tdccContinuousBackfill(new Request("https://internal/api/internal/tdcc-continuous-backfill", {
      method: "POST",
      headers,
      body: JSON.stringify({ action, runId, trigger: "scheduled", scope: "daily" }),
    }), env);
    if (!response.ok) throw new Error("provider_unavailable");
    return jsonObject(await response.json());
  };
  const started = await invoke("orchestrator-start");
  if (started.done !== true) await invoke("orchestrator-tick");
}

async function batchCandleResponse(request: Request, env: Env) {
  let body: JsonObject;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return json({ ok: false, reasonCode: "invalid_payload" }, 413);
    body = jsonObject(JSON.parse(raw));
  } catch {
    return json({ ok: false, reasonCode: "invalid_payload" }, 400);
  }
  const requests = Array.isArray(body.requests) ? body.requests : [];
  if (!requests.length || requests.length > 8) return json({ ok: false, reasonCode: "invalid_payload" }, 400);
  const ids = new Set<string>();
  const normalizedRequests: Array<{ id: string; symbol: string; interval: string; indicatorQuery: string; pivot: PivotMode | null }> = [];
  for (const raw of requests) {
    const item = jsonObject(raw);
    const id = String(item.id || "").trim();
    const symbol = normalizeSymbol(item.symbol);
    const interval = String(item.interval || "").trim();
    const indicatorQuery = String(item.indicatorQuery || "");
    if (!intervalsForRequest(request).includes(interval)) return json({ ok: false, reasonCode: "unsupported_interval" }, 400);
    if (!id || ids.has(id) || !symbol || indicatorQuery.length > 512) return json({ ok: false, reasonCode: "invalid_payload" }, 400);
    ids.add(id);
    normalizedRequests.push({ id, symbol, interval, indicatorQuery, pivot: normalizePivotMode(item.pivot) });
  }
  const realtimeViewerEnabled = realtimeViewerCapability(request, env);
  const batchCacheKey = `candle-batch-v1|realtime:${realtimeViewerEnabled ? "owner" : "off"}|${normalizedRequests.map((item) => [item.id, item.symbol, item.interval, item.indicatorQuery, item.pivot ?? "off"].map((value) => encodeURIComponent(value)).join("~")).join("|")}`;
  const now = Math.floor(Date.now() / 1000);
  if (env.DB) {
    try {
      await ensureDb(env.DB);
      const cached = await env.DB.prepare("SELECT payload FROM candle_cache WHERE cache_key = ? AND expires_at > ?").bind(batchCacheKey, now).first<CandleCacheRow>();
      if (cached?.payload) {
        recordCacheEvent("hit");
        return new Response(cached.payload, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      recordCacheEvent("miss");
    } catch {
      recordCacheEvent("read_failure");
    }
  }
  const items = [];
  for (const item of normalizedRequests) {
    try {
      const payload = await cachedCandlePayload(
        env,
        item.symbol,
        item.interval,
        160,
        indicatorParametersFromSearchParams(new URLSearchParams(item.indicatorQuery)),
        item.pivot,
        realtimeViewerEnabled,
      );
      items.push({ id: item.id, ok: true, payload });
    } catch {
      items.push({ id: item.id, ok: false, reasonCode: "provider_unavailable" });
    }
  }
  const responseText = JSON.stringify({ ok: true, items });
  if (env.DB) {
    try {
      const ttl = Math.min(...normalizedRequests.map((item) => cacheTtl(item.interval)), items.some((item) => !item.ok) ? 20 : Number.POSITIVE_INFINITY);
      await env.DB.prepare(`INSERT INTO candle_cache (cache_key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`).bind(batchCacheKey, responseText, now + ttl).run();
    } catch {
      recordCacheEvent("write_failure");
    }
  }
  return new Response(responseText, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function accessAdminResponse(request: Request, env: Env, path: string) {
  if (!env.DB) return json({ ok: false, reasonCode: "access_database_unavailable" }, 503);
  let owner;
  try {
    owner = requireOwnerPrincipal(request);
  } catch (error) {
    const failure = error instanceof AccessControlError ? error : new AccessControlError("owner_required", 403);
    return json({ ok: false, reasonCode: failure.reasonCode }, failure.status);
  }
  try {
    if (path === "/api/admin/access-users" && request.method === "GET") {
      return json({ ok: true, users: await listAccessUsers(env.DB) });
    }
    if (path === "/api/admin/access-audit" && request.method === "GET") {
      return json({ ok: true, entries: await listAccessAudit(env.DB, Number(new URL(request.url).searchParams.get("limit") || 50)) });
    }
    if (path === "/api/admin/access-users" && request.method === "POST") {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 4096) return json({ ok: false, reasonCode: "invalid_payload" }, 413);
      const input = jsonObject(JSON.parse(raw));
      return json({ ok: true, user: await createAccessUser(env.DB, owner, input) }, 201);
    }
    const match = path.match(/^\/api\/admin\/access-users\/([^/]+)$/);
    if (match && request.method === "PATCH") {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 4096) return json({ ok: false, reasonCode: "invalid_payload" }, 413);
      const input = jsonObject(JSON.parse(raw));
      const user = await updateAccessUser(env.DB, owner, decodeURIComponent(match[1]), input);
      return json({ ok: true, user, personalDataTransferred: false });
    }
    if (match && request.method === "DELETE") {
      return json({ ok: true, ...(await deleteAccessUser(env.DB, owner, decodeURIComponent(match[1]))) });
    }
    return json({ ok: false, reasonCode: "not_found" }, 404);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ ok: false, reasonCode: "invalid_payload" }, 400);
    const failure = error instanceof AccessControlError ? error : new AccessControlError("access_write_failed", 503);
    return json({ ok: false, reasonCode: failure.reasonCode }, failure.status);
  }
}

export async function handleAppRequest(request: Request, env: Env, context?: AppExecutionContext): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const personalPath = path === "/api/instruments"
    || path.startsWith("/api/instruments/")
    || path.startsWith("/api/watchlist-items/")
    || path === "/api/taiwan-stock-chip/backfill"
    || path === "/api/tabs"
    || path.startsWith("/api/tabs/")
    || path.startsWith("/api/admin/access-");
  if (personalPath && !identifiedUserId(request)) return authenticationFailure();
  if (path.startsWith("/api/admin/access-")) return accessAdminResponse(request, env, path);
  if (path === "/") {
    const target = new Request(new URL("/static/index.html", request.url));
    const response = env.ASSETS ? await env.ASSETS.fetch(target) : await fetch(target);
    const html = (await response.text()).replaceAll("__SITE_ORIGIN__", url.origin);
    return new Response(html, { status: response.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  }
  if (path === "/api/health") {
    if (env.DB) await ensureDb(env.DB);
    const river = await peRiverHealth(env.DB);
    const deploymentTarget = deploymentTargetForRequest(request);
    return json({ ok: true, app: "報價線圖 multiview", runtime: deploymentTarget === "cloudflare" ? "cloudflare-workers" : deploymentTarget === "local" ? "local-worker" : "codex-sites", deploymentTarget, commitSha: env.APP_COMMIT_SHA || null, language: "zh-TW", maxCharts: 8, providers: ["shioaji-local", "hyperliquid", "yahoo-chart", "sample", "finmind", "twse", "tpex", "tdcc"], persistence: { d1: Boolean(env.DB), stateDirectory: deploymentTarget === "local" ? env.MULTIVIEW_STATE_DIR || null : null, schemaRevision: env.MULTIVIEW_SCHEMA_REVISION || null, candleCache: Boolean(env.DB), candleHistory: Boolean(env.DB), taiwanStockChip: Boolean(env.DB), taiwanStockPeRiver: Boolean(env.DB) }, shioajiAdapter: deploymentTarget === "local" ? localShioajiAdapterHealth() : { configured: false, dataOnly: true }, realtime: await readRealtimeHealth(env), usage: runtimeUsageSummary(), cacheMaintenance: await readCandleCacheMaintenance(env.DB), quoteVerification: { enabled: true, providers: { twse: { enabled: true, configured: true }, tpex: { enabled: true, configured: true }, tpexMirror: { enabled: true, configured: Boolean(env.DB && env.TPEX_MIRROR_INGEST_SECRET) }, massive: { enabled: true, configured: Boolean(env.MASSIVE_API_KEY) } } }, taiwanStockChip: await taiwanStockChipHealth(env), taiwanStockPeRiver: env.DB ? { ...river, continuous: await readPeRiverContinuousHealth(env.DB) } : river });
  }
  if (path === "/api/internal/taiwan-stock-pe-river" && request.method === "POST") return ingestPeRiverMonth(request, env);
  if (path === "/api/internal/pe-river-continuous-backfill" && ["GET", "POST"].includes(request.method)) return peRiverContinuousBackfill(request, env);
  if (path === "/api/internal/tpex-mirror" && request.method === "POST") return ingestTpexMirror(request, env);
  if (path === "/api/internal/instrument-catalog" && ["GET", "POST"].includes(request.method)) return ingestInstrumentCatalog(request, env);
  if (path === "/api/internal/tdcc-shareholder-distribution" && request.method === "POST") return ingestTdccShareholderDistribution(request, env);
  if (path === "/api/internal/tdcc-shareholder-backfill" && ["GET", "POST"].includes(request.method)) return tdccHistoryBackfill(request, env);
  if (path === "/api/internal/tdcc-continuous-backfill" && ["GET", "POST"].includes(request.method)) return tdccContinuousBackfill(request, env);
  if (path === "/api/config") {
    const deploymentTarget = deploymentTargetForRequest(request);
    const principal = requestPrincipal(request);
    const realtimeEnabled = realtimeViewerCapability(request, env);
    return json({ sitesRuntime: deploymentTarget !== "cloudflare", deploymentTarget, userEmail: principal.kind === "user" ? principal.userId : null, accessRole: principal.accessRole || null, canManageAccess: principal.accessRole === "owner", capabilities: { taiwanRealtime: deploymentTarget === "local" ? true : realtimeEnabled, taiwanIntradayTrend: false, taiwanMinuteKline: deploymentTarget === "local" }, sourceModes: deploymentTarget === "local" ? ["auto", "shioaji", "yahoo"] : ["yahoo"], defaultSourceMode: deploymentTarget === "local" ? "auto" : "yahoo", supabaseConfigured: false, supabaseUrl: "", supabaseAnonKey: "", supabaseAuthAvailable: false, supabaseDiagnostic: { available: false, status: deploymentTarget === "cloudflare" ? "replaced_by_cloudflare_access" : deploymentTarget === "local" ? "local_runtime" : "replaced_by_sites_identity", host: "" } });
  }
  if (path === "/api/instruments" && request.method === "GET") {
    const payload = await instrumentPayload(request, env);
    const uid = identifiedUserId(request);
    const realtime = uid ? await syncRealtimeWatchlist(request, env, uid) : { status: "not-authorized", acceptedSymbolCount: 0 };
    return json({ ...payload, realtime });
  }
  if (path === "/api/instrument-search" && request.method === "GET") return json(await searchInstruments(request, env));
  if (path === "/api/taiwan-stock-chip" && request.method === "GET") {
    const eligibility = await taiwanChipEligibility(request, env, url.searchParams.get("symbol") || "");
    scheduleMissingTaiwanChipTarget(env, eligibility, context);
    return handleTaiwanStockChipRequest(request, env, eligibility);
  }
  if (path === "/api/taiwan-stock-chip/backfill" && request.method === "POST") return requestTaiwanStockChipBackfill(request, env, context);
  if (path === "/api/taiwan-stock-pe-river" && request.method === "GET") {
    if (env.DB) await ensureDb(env.DB);
    const payload = await buildPeRiverResponse({ db: env.DB, symbol: url.searchParams.get("symbol") || "", interval: url.searchParams.get("interval") || "1d" });
    if (env.DB && payload.eligibility?.supported && payload.status !== "available") {
      const wake = dispatchPeRiverWorkflowIfStale({ db: env.DB, token: env.GITHUB_WORKFLOW_DISPATCH_TOKEN });
      if (context) context.waitUntil(wake); else await wake;
    }
    return json(payload);
  }
  if (path === "/api/candles/batch" && request.method === "POST") return batchCandleResponse(request, env);
  if (path === "/api/candles" && request.method === "GET") {
    const interval = url.searchParams.get("interval") || "1d";
    if (!intervalsForRequest(request).includes(interval)) return json({ ok: false, reasonCode: "unsupported_interval" }, 400);
    try { return json(await cachedCandlePayload(env, url.searchParams.get("symbol") || "SAMPLE", interval, Number(url.searchParams.get("display_count") || 160), indicatorParametersFromSearchParams(url.searchParams), normalizePivotMode(url.searchParams.get("pivot")), realtimeViewerCapability(request, env))); }
    catch { return json({ symbol: url.searchParams.get("symbol") || "", interval: url.searchParams.get("interval") || "", error: "資料暫時不可用。", candles: [], indicators: {} }, 502); }
  }
  if (path === "/api/stream" && request.method === "GET") return streamResponse(request, env);
  if (path === "/api/debug/echo") return json({ args: Object.fromEntries(url.searchParams) });
  if (path === "/api/tabs/reorder" && request.method === "POST") return reorderTabs(request, env);
  if (path === "/api/tabs/visibility" && request.method === "POST") return changeTabVisibility(request, env);
  if (path === "/api/tabs/reset" && request.method === "POST") return resetSystemTab(request, env);
  if (path === "/api/tabs" && request.method === "POST") return saveTab(request, env);
  const tabMatch = path.match(/^\/api\/tabs\/(.+)$/);
  if (tabMatch && ["PATCH", "DELETE"].includes(request.method)) {
    const value = decodeURIComponent(tabMatch[1]);
    const tabKey = value.startsWith("system:") || value.startsWith("personal:")
      ? value
      : Object.values(TAB_IDS).includes(value) ? systemTabKey(value) : personalTabKey(value);
    if (request.method === "PATCH") return changeTabVisibility(request, env, { tabKey, enabled: false });
    return deleteCustomTab(request, env, tabKey);
  }
  if (path === "/api/instruments" && request.method === "POST") return saveInstrument(request, env, undefined, context);
  if (path === "/api/instruments/reorder" && request.method === "POST") return reorderInstruments(request, env);
  const watchlistMetadataMatch = path.match(/^\/api\/watchlist-items\/([^/]+)\/metadata$/);
  if (watchlistMetadataMatch && request.method === "PATCH") return updateWatchlistMetadata(request, env, decodeURIComponent(watchlistMetadataMatch[1]));
  const instrumentMatch = path.match(/^\/api\/instruments\/(.+)$/);
  if (instrumentMatch && request.method === "DELETE") {
    if (!env.DB) return json({ ok: false, error: "Sites D1 尚未啟用。" }, 503);
    await ensureDb(env.DB);
    const uid = userId(request);
    const symbol = decodeURIComponent(instrumentMatch[1]).toUpperCase();
    const tabId = url.searchParams.get("tabId") || "";
    const tabLabel = url.searchParams.get("tabLabel") || "";
    const systemScope = url.searchParams.get("scope") === "system";
    if (systemScope) {
      const baseLabel = Object.entries(TAB_IDS).find(([, id]) => id === tabId)?.[0] || tabLabel;
      const base = parseSetup(await setupText(request, env)).find((item) => item.symbol === symbol && (!baseLabel || item.tab === baseLabel || item.tab === tabLabel));
      const statements = [env.DB.prepare("DELETE FROM user_instruments WHERE user_id = ? AND symbol = ? AND tab_id IN (?, '')").bind(uid, symbol, tabId)];
      if (base) {
        statements.push(env.DB.prepare(`INSERT INTO user_instruments (user_id,item_id,symbol,name,provider,tab_id,tab_label,group_name,market,enabled,sort_order,added_at,date_status,date_source,recommender) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,symbol,tab_id) DO UPDATE SET name=excluded.name,provider=excluded.provider,tab_label=excluded.tab_label,group_name=excluded.group_name,market=excluded.market,enabled=excluded.enabled,sort_order=excluded.sort_order,updated_at=CURRENT_TIMESTAMP`).bind(uid, newWatchlistItemId(), symbol, base.name, base.provider, "", base.tab, base.group, base.market, 0, base.defaultOrder, null, "legacy_unknown", null, ""));
      }
      await env.DB.batch(statements);
    } else if (tabId) {
      await env.DB.prepare("DELETE FROM user_instruments WHERE user_id = ? AND symbol = ? AND tab_id = ?").bind(uid, symbol, tabId).run();
    } else {
      await env.DB.prepare("DELETE FROM user_instruments WHERE user_id = ? AND symbol = ?").bind(uid, symbol).run();
    }
    await syncRealtimeWatchlist(request, env, uid);
    return json({ ...(await instrumentPayload(request, env)), ok: true });
  }
  return null;
}
