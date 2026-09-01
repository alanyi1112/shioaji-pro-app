import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// 選股底稿與個人清單／長歷史佇列完全隔離。
export const screenerUniverse = sqliteTable("screener_universe", {
  revision: text("revision").notNull(), symbol: text("symbol").notNull(),
  market: text("market", { enum: ["TWSE", "TPEx"] }).notNull(),
  dataDate: text("data_date").notNull(), payload: text("payload").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.symbol] })]);

export const screenerDailyVolume = sqliteTable("screener_daily_volume", {
  symbol: text("symbol").notNull(), dataDate: text("data_date").notNull(),
  payload: text("payload").notNull(),
}, (table) => [primaryKey({ columns: [table.dataDate, table.symbol] })]);

export const screenerTdccWeekly = sqliteTable("screener_tdcc_weekly", {
  symbol: text("symbol").notNull(), dataDate: text("data_date").notNull(),
  payload: text("payload").notNull(), validation: text("validation").notNull(),
}, (table) => [primaryKey({ columns: [table.dataDate, table.symbol] })]);

export const screenerRuns = sqliteTable("screener_runs", {
  id: text("id").primaryKey(), scope: text("scope").notNull(),
  status: text("status").notNull(), checkpoint: text("checkpoint").notNull(),
  leaseUntil: text("lease_until"), updatedAt: text("updated_at").notNull(),
}, (table) => [index("screener_runs_scope_status_idx").on(table.scope, table.status)]);

export const screenerSnapshots = sqliteTable("screener_snapshots", {
  id: text("id").primaryKey(), createdAt: text("created_at").notNull(),
  status: text("status", { enum: ["staging", "published"] }).notNull(),
  metadata: text("metadata").notNull(), schemaVersion: integer("schema_version").notNull().default(1),
}, (table) => [index("screener_snapshots_published_idx").on(table.status, table.createdAt)]);

export const screenerSnapshotRows = sqliteTable("screener_snapshot_rows", {
  snapshotId: text("snapshot_id").notNull().references(() => screenerSnapshots.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(), payload: text("payload").notNull(),
}, (table) => [primaryKey({ columns: [table.snapshotId, table.symbol] })]);

export const userTabs = sqliteTable("user_tabs", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(1),
  enabled: integer("enabled").notNull().default(1),
  isDefault: integer("is_default").notNull().default(0),
  sourceTabId: text("source_tab_id").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.userId, table.id] })]);

export const userInstruments = sqliteTable("user_instruments", {
  userId: text("user_id").notNull(),
  itemId: text("item_id"),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  tabId: text("tab_id").notNull().default(""),
  tabLabel: text("tab_label").notNull(),
  groupName: text("group_name").notNull(),
  market: text("market").notNull(),
  enabled: integer("enabled").notNull().default(1),
  sortOrder: integer("sort_order"),
  addedAt: text("added_at"),
  dateStatus: text("date_status").notNull().default("legacy_unknown"),
  dateSource: text("date_source"),
  recommender: text("recommender").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.symbol, table.tabId] }),
  uniqueIndex("user_instruments_user_item_idx").on(table.userId, table.itemId),
]);

export const candleCache = sqliteTable("candle_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("candle_cache_expires_at_idx").on(table.expiresAt)]);

export const cacheMaintenanceState = sqliteTable("cache_maintenance_state", {
  maintenanceKey: text("maintenance_key").primaryKey(),
  lastRunAt: text("last_run_at"),
  deletedRows: integer("deleted_rows").notNull().default(0),
  remainingRows: integer("remaining_rows").notNull().default(0),
  status: text("status").notNull().default("not_run"),
  reasonCode: text("reason_code"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const runtimeMetadata = sqliteTable("runtime_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accessUsers = sqliteTable("access_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("access_users_email_idx").on(table.email),
  index("access_users_role_status_idx").on(table.role, table.status),
]);

export const accessAuditLog = sqliteTable("access_audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  targetUserId: text("target_user_id"),
  action: text("action").notNull(),
  result: text("result").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("access_audit_log_created_idx").on(table.createdAt),
  index("access_audit_log_actor_idx").on(table.actorUserId, table.createdAt),
]);

export const candleHistory = sqliteTable("candle_history", {
  provider: text("provider").notNull(),
  symbol: text("symbol").notNull(),
  interval: text("interval").notNull(),
  time: integer("time").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull().default(0),
  quoteTime: integer("quote_time"),
  source: text("source").notNull(),
  sourceUpdatedAt: text("source_updated_at"),
  marketSession: text("market_session"),
  sourceTimeZone: text("source_time_zone"),
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.provider, table.symbol, table.interval, table.time] }),
  index("candle_history_lookup_idx").on(table.provider, table.symbol, table.interval, table.time),
]);

export const candleHistoryState = sqliteTable("candle_history_state", {
  provider: text("provider").notNull(),
  symbol: text("symbol").notNull(),
  interval: text("interval").notNull(),
  fullWindowComplete: integer("full_window_complete").notNull().default(0),
  coverageStart: integer("coverage_start"),
  coverageEnd: integer("coverage_end"),
  availableRows: integer("available_rows").notNull().default(0),
  status: text("status").notNull().default("unknown"),
  reasonCode: text("reason_code"),
  lastFullFetchAt: text("last_full_fetch_at"),
  lastTailFetchAt: text("last_tail_fetch_at"),
  continuityStatus: text("continuity_status").notNull().default("unknown"),
  continuityFrom: text("continuity_from"),
  continuityThrough: text("continuity_through"),
  continuityCheckedAt: text("continuity_checked_at"),
  missingSessionCount: integer("missing_session_count").notNull().default(0),
  missingSessionDatesJson: text("missing_session_dates_json").notNull().default("[]"),
  excludedSessionDatesJson: text("excluded_session_dates_json").notNull().default("[]"),
  continuityReasonCode: text("continuity_reason_code"),
  retryAfter: text("retry_after"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.provider, table.symbol, table.interval] }),
  index("candle_history_state_retry_idx").on(table.status, table.retryAfter),
]);

export const candleContinuityRuns = sqliteTable("candle_continuity_runs", {
  runId: text("run_id").primaryKey(),
  deploymentTarget: text("deployment_target", { enum: ["sites", "cloudflare", "local"] }).notNull(),
  trigger: text("trigger", { enum: ["schedule", "workflow_dispatch", "local"] }).notNull(),
  commitSha: text("commit_sha"),
  expectedSession: text("expected_session").notNull(),
  slaCheckpoint: text("sla_checkpoint").notNull(),
  status: text("status", { enum: ["running", "retry_waiting", "completed", "failed"] }).notNull().default("running"),
  phase: text("phase", { enum: ["audit", "waiting", "completed", "failed"] }).notNull().default("audit"),
  cursor: integer("cursor").notNull().default(0),
  targetCount: integer("target_count").notNull().default(0),
  processedCount: integer("processed_count").notNull().default(0),
  remainingCount: integer("remaining_count").notNull().default(0),
  completeCount: integer("complete_count").notNull().default(0),
  partialCount: integer("partial_count").notNull().default(0),
  unknownCount: integer("unknown_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  overdueCount: integer("overdue_count").notNull().default(0),
  heartbeatAt: text("heartbeat_at").notNull(),
  reasonCode: text("reason_code"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("candle_continuity_runs_target_recent_idx").on(table.deploymentTarget, table.updatedAt),
  index("candle_continuity_runs_status_idx").on(table.status, table.heartbeatAt),
  check("candle_continuity_runs_target_check", sql`${table.deploymentTarget} in ('sites','cloudflare','local')`),
  check("candle_continuity_runs_trigger_check", sql`${table.trigger} in ('schedule','workflow_dispatch','local')`),
  check("candle_continuity_runs_status_check", sql`${table.status} in ('running','retry_waiting','completed','failed')`),
  check("candle_continuity_runs_phase_check", sql`${table.phase} in ('audit','waiting','completed','failed')`),
]);

export const candleContinuityRunItems = sqliteTable("candle_continuity_run_items", {
  runId: text("run_id").notNull().references(() => candleContinuityRuns.runId, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  ordinal: integer("ordinal").notNull(),
  priority: integer("priority").notNull(),
  status: text("status", { enum: ["queued", "running", "retry_waiting", "fresh", "complete", "partial", "unknown", "failed", "overdue"] }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  retryAfter: text("retry_after"),
  coverageEnd: text("coverage_end"),
  verifiedThrough: text("verified_through"),
  missingSessionCount: integer("missing_session_count").notNull().default(0),
  checkedAt: text("checked_at"),
  reasonCode: text("reason_code"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.runId, table.symbol] }),
  uniqueIndex("candle_continuity_run_items_ordinal_idx").on(table.runId, table.ordinal),
  index("candle_continuity_run_items_queue_idx").on(table.runId, table.status, table.priority, table.ordinal, table.retryAfter, table.leaseExpiresAt),
  index("candle_continuity_run_items_anomaly_idx").on(table.runId, table.status, table.priority, table.symbol),
  check("candle_continuity_run_items_status_check", sql`${table.status} in ('queued','running','retry_waiting','fresh','complete','partial','unknown','failed','overdue')`),
]);

export const instrumentCatalog = sqliteTable("instrument_catalog", {
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull(),
  localizedName: text("localized_name").notNull(),
  englishName: text("english_name").notNull().default(""),
  aliasesJson: text("aliases_json").notNull().default("[]"),
  normalizedSearch: text("normalized_search").notNull(),
  market: text("market").notNull(),
  groupName: text("group_name").notNull(),
  quoteType: text("quote_type").notNull().default(""),
  provider: text("provider").notNull().default("yfinance"),
  source: text("source").notNull(),
  active: integer("active").notNull().default(1),
  sourceUpdatedAt: text("source_updated_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.exchange] }),
  index("instrument_catalog_symbol_idx").on(table.symbol),
  index("instrument_catalog_source_idx").on(table.source),
  index("instrument_catalog_normalized_idx").on(table.normalizedSearch),
]);

export const taiwanStockChipDaily = sqliteTable("taiwan_stock_chip_daily", {
  symbol: text("symbol").notNull(),
  sessionDate: text("session_date").notNull(),
  exchange: text("exchange").notNull(),
  institutionalFlowJson: text("institutional_flow_json"),
  foreignHoldingJson: text("foreign_holding_json"),
  marginShortJson: text("margin_short_json"),
  securitiesLendingJson: text("securities_lending_json"),
  provenanceJson: text("provenance_json").notNull().default("{}"),
  completenessJson: text("completeness_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.sessionDate] }),
  index("taiwan_stock_chip_daily_symbol_date_idx").on(table.symbol, table.sessionDate),
]);

export const taiwanStockShareholderDistribution = sqliteTable("taiwan_stock_shareholder_distribution", {
  symbol: text("symbol").notNull(),
  dataDate: text("data_date").notNull(),
  levelsJson: text("levels_json").notNull(),
  adjustmentJson: text("adjustment_json").notNull(),
  totalJson: text("total_json").notNull(),
  provider: text("provider").notNull(),
  frequency: text("frequency").notNull().default("weekly"),
  sourceFetchedAt: text("source_fetched_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.dataDate] }),
  index("taiwan_stock_shareholder_symbol_date_idx").on(table.symbol, table.dataDate),
]);

export const taiwanStockChipFetchState = sqliteTable("taiwan_stock_chip_fetch_state", {
  symbol: text("symbol").notNull(),
  dataset: text("dataset").notNull(),
  coverageStart: text("coverage_start"),
  coverageEnd: text("coverage_end"),
  sourceDate: text("source_date"),
  status: text("status").notNull(),
  reasonCode: text("reason_code").notNull(),
  lastSuccessAt: text("last_success_at"),
  lastAttemptAt: text("last_attempt_at"),
  retryAfter: text("retry_after"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.dataset] }),
  index("taiwan_stock_chip_fetch_retry_idx").on(table.retryAfter),
]);

export const tdccShareholderBackfillJob = sqliteTable("tdcc_shareholder_backfill_job", {
  jobId: text("job_id").primaryKey(),
  mode: text("mode").notNull(),
  targetStart: text("target_start").notNull(),
  targetEnd: text("target_end").notNull(),
  expectedDatesJson: text("expected_dates_json").notNull(),
  targetSymbolsJson: text("target_symbols_json").notNull().default("[]"),
  expectedSymbols: integer("expected_symbols").notNull().default(0),
  expectedWeeks: integer("expected_weeks").notNull(),
  completedWeeks: integer("completed_weeks").notNull().default(0),
  failedWeeks: integer("failed_weeks").notNull().default(0),
  checkpointDate: text("checkpoint_date"),
  status: text("status").notNull(),
  lastErrorCode: text("last_error_code"),
  lastSuccessAt: text("last_success_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("tdcc_shareholder_backfill_status_idx").on(table.status, table.updatedAt)]);

export const tdccShareholderBackfillWeek = sqliteTable("tdcc_shareholder_backfill_week", {
  jobId: text("job_id").notNull(),
  dataDate: text("data_date").notNull(),
  status: text("status").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  symbolCount: integer("symbol_count").notNull().default(0),
  errorCode: text("error_code"),
  attempts: integer("attempts").notNull().default(0),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.jobId, table.dataDate] }),
  index("tdcc_shareholder_backfill_week_status_idx").on(table.jobId, table.status),
]);

export const tdccContinuousRuns = sqliteTable("tdcc_continuous_runs", {
  runId: text("run_id").primaryKey(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  latestDataDate: text("latest_data_date"),
  targetCount: integer("target_count").notNull().default(0),
  queuedCount: integer("queued_count").notNull().default(0),
  claimedCount: integer("claimed_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  errorCode: text("error_code"),
  nextRetryAt: text("next_retry_at"),
  heartbeatAt: text("heartbeat_at"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("tdcc_continuous_runs_status_idx").on(table.status, table.updatedAt)]);

export const chipBackfillOrchestratorRuns = sqliteTable("chip_backfill_orchestrator_runs", {
  runId: text("run_id").primaryKey(),
  scope: text("scope").notNull().default("combined"),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  expectedSessionDate: text("expected_session_date").notNull(),
  latestDataDate: text("latest_data_date"),
  processedSymbolsJson: text("processed_symbols_json").notNull().default("[]"),
  processedSymbols: integer("processed_symbols").notNull().default(0),
  remainingSymbols: integer("remaining_symbols").notNull().default(0),
  pendingSymbols: integer("pending_symbols").notNull().default(0),
  lastSymbol: text("last_symbol"),
  lastReasonCode: text("last_reason_code"),
  heartbeatAt: text("heartbeat_at").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("chip_backfill_orchestrator_runs_status_idx").on(table.status, table.updatedAt)]);

export const tdccBackfillDispatches = sqliteTable("tdcc_backfill_dispatches", {
  symbol: text("symbol").primaryKey(),
  status: text("status").notNull(),
  deploymentTarget: text("deployment_target").notNull().default("unknown"),
  requestedAt: text("requested_at").notNull(),
  cooldownUntil: text("cooldown_until"),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("tdcc_backfill_dispatches_status_idx").on(table.status, table.cooldownUntil)]);

export const tdccContinuousSymbols = sqliteTable("tdcc_continuous_symbols", {
  symbol: text("symbol").primaryKey(),
  source: text("source").notNull(),
  officialBaseline: integer("official_baseline").notNull().default(0),
  catalogRevision: text("catalog_revision").notNull().default(""),
  active: integer("active").notNull().default(1),
  status: text("status").notNull(),
  targetStart: text("target_start"),
  targetEnd: text("target_end"),
  expectedWeeks: integer("expected_weeks").notNull().default(0),
  completedWeeks: integer("completed_weeks").notNull().default(0),
  failedWeeks: integer("failed_weeks").notNull().default(0),
  missingDatesJson: text("missing_dates_json").notNull().default("[]"),
  checkpointDate: text("checkpoint_date"),
  latestSnapshotDate: text("latest_snapshot_date"),
  officialPlanThrough: text("official_plan_through"),
  coverageVerifiedAt: text("coverage_verified_at"),
  historySuccessAt: text("history_success_at"),
  nextRetryAt: text("next_retry_at"),
  lastErrorCode: text("last_error_code"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("tdcc_continuous_symbols_queue_idx").on(table.active, table.status, table.nextRetryAt, table.firstSeenAt),
  index("tdcc_continuous_symbols_handoff_idx").on(table.active, table.status, table.firstSeenAt, table.leaseExpiresAt),
  index("tdcc_continuous_symbols_lease_idx").on(table.leaseExpiresAt),
]);

export const tdccContinuousItems = sqliteTable("tdcc_continuous_items", {
  symbol: text("symbol").notNull(),
  dataDate: text("data_date").notNull(),
  status: text("status").notNull(),
  priority: integer("priority").notNull().default(100),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  nextRetryAt: text("next_retry_at"),
  errorCode: text("error_code"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.dataDate] }),
  index("tdcc_continuous_items_queue_idx").on(table.status, table.nextRetryAt, table.priority, table.createdAt),
  index("tdcc_continuous_items_lease_idx").on(table.leaseExpiresAt),
]);

export const taiwanStockPeValuationDaily = sqliteTable("taiwan_stock_pe_valuation_daily", {
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  sessionDate: text("session_date").notNull(),
  officialClose: real("official_close").notNull(),
  officialPeRatio: real("official_pe_ratio").notNull(),
  referenceEps: real("reference_eps").notNull(),
  fiscalYear: text("fiscal_year"),
  fiscalQuarter: text("fiscal_quarter"),
  source: text("source").notNull(),
  provider: text("provider").notNull().default("official"),
  originalSource: text("original_source").notNull().default("unknown"),
  validationStatus: text("validation_status").notNull().default("official_verified"),
  officialOverlapDate: text("official_overlap_date"),
  provisionalCreatedAt: text("provisional_created_at"),
  sourceDate: text("source_date").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.exchange, table.symbol, table.sessionDate] }),
  index("taiwan_stock_pe_valuation_lookup_idx").on(table.symbol, table.sessionDate),
]);

export const taiwanStockPeFetchState = sqliteTable("taiwan_stock_pe_fetch_state", {
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  requestedStart: text("requested_start"),
  requestedEnd: text("requested_end"),
  coverageStart: text("coverage_start"),
  coverageEnd: text("coverage_end"),
  sourceDate: text("source_date"),
  latestSourceDate: text("latest_source_date"),
  verifiedEnd: text("verified_end"),
  displayEnd: text("display_end"),
  officialSourceDate: text("official_source_date"),
  provisionalDatesJson: text("provisional_dates_json").notNull().default("[]"),
  provisionalStatus: text("provisional_status"),
  provisionalQuarantined: integer("provisional_quarantined").notNull().default(0),
  mismatchDate: text("mismatch_date"),
  mismatchPeDifference: real("mismatch_pe_difference"),
  mismatchCloseDifference: real("mismatch_close_difference"),
  providerVerifiedAt: text("provider_verified_at"),
  lane: text("lane").notNull().default("history"),
  status: text("status").notNull(),
  reasonCode: text("reason_code").notNull(),
  lastSuccessAt: text("last_success_at"),
  lastAttemptAt: text("last_attempt_at"),
  retryAfter: text("retry_after"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.exchange, table.symbol] }),
  index("taiwan_stock_pe_fetch_retry_idx").on(table.status, table.retryAfter),
]);

export const taiwanStockPeBackfillJob = sqliteTable("taiwan_stock_pe_backfill_job", {
  jobId: text("job_id").primaryKey(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  targetStart: text("target_start").notNull(),
  targetEnd: text("target_end").notNull(),
  status: text("status").notNull(),
  reasonCode: text("reason_code").notNull(),
  lane: text("lane").notNull().default("history"),
  latestSourceDate: text("latest_source_date"),
  providerVerifiedAt: text("provider_verified_at"),
  totalMonths: integer("total_months").notNull().default(0),
  completedMonths: integer("completed_months").notNull().default(0),
  attempt: integer("attempt").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  retryAfter: text("retry_after"),
  lastSuccessAt: text("last_success_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("taiwan_stock_pe_job_symbol_idx").on(table.exchange, table.symbol),
  index("taiwan_stock_pe_job_queue_idx").on(table.status, table.retryAfter, table.leaseExpiresAt),
]);

export const taiwanStockPeBackfillMonth = sqliteTable("taiwan_stock_pe_backfill_month", {
  jobId: text("job_id").notNull(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  targetMonth: text("target_month").notNull(),
  status: text("status").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  datasetStatusJson: text("dataset_status_json").notNull().default("{}"),
  ingestCursor: integer("ingest_cursor").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  retryAfter: text("retry_after"),
  errorCode: text("error_code"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.exchange, table.symbol, table.targetMonth] }),
  index("taiwan_stock_pe_month_queue_idx").on(table.status, table.retryAfter, table.leaseExpiresAt),
]);

export const taiwanStockPeControl = sqliteTable("taiwan_stock_pe_control", {
  controlKey: text("control_key").primaryKey().notNull(),
  schedulerHeartbeatAt: text("scheduler_heartbeat_at"),
  lastLatestRunAt: text("last_latest_run_at"),
  lastHistoryRunAt: text("last_history_run_at"),
  latestTwseSourceDate: text("latest_twse_source_date"),
  latestTpexSourceDate: text("latest_tpex_source_date"),
  budgetWindowStart: text("budget_window_start"),
  budgetUsed: integer("budget_used").notNull().default(0),
  budgetLimit: integer("budget_limit").notNull().default(240),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
