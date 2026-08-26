import {
  FINMIND_SAFE_HOURLY_BUDGET,
  PE_RIVER_MAX_HISTORY_TARGETS,
  buildProvisionalPeRiverCandidates,
  discoverPeRiverTargets,
  fetchFinMindPeHistory,
  fetchOfficialPeDailySnapshot,
  fetchOfficialPeDailySnapshotBundle,
  peRiverProviderAttemptDiagnostic,
  provisionalPeRiverDateRange,
  reconcileProvisionalPeRiverRow,
  reserveFinMindBudget,
  verifyProviderOverlap,
  type OfficialPeGap,
} from "./pe-river-data-pipeline.ts";
import {
  PE_RIVER_LOOKBACK_YEARS,
  PE_RIVER_MINIMUM_SAMPLES,
  ingestProvisionalPeRiverRows,
  peRiverCoverageState,
  peRiverUpsertStatement,
  peRiverRetryAfter,
  queuePeRiverBackfill,
  readPeRiverRows,
  safePeRiverBackfillError,
  type PeRiverExchange,
} from "./taiwan-stock-pe-river.ts";

const RUN_ID = /^[a-zA-Z0-9:_-]{3,160}$/;

type ProviderAttempt = {
  attemptedAt: string;
  status: "success" | "pending" | "failed";
  reasonCode: string;
  sourceDate: string | null;
  diagnostic: ReturnType<typeof peRiverProviderAttemptDiagnostic>;
};

function targetRange(now: Date) {
  const end = now.toISOString().slice(0, 10);
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - PE_RIVER_LOOKBACK_YEARS);
  return { start: startDate.toISOString().slice(0, 10), end };
}

async function promotePendingPeRiverHistory(input: { db: D1Database; symbol: string; officialRow: Awaited<ReturnType<typeof fetchOfficialPeDailySnapshot>>[number]; now: Date }) {
  const existing = await readPeRiverRows(input.db, input.symbol);
  const pending = existing.filter((row) => row.provider === "finmind" && row.validationStatus === "finmind_pending_verification");
  if (!pending.length) return { promoted: 0, validationStatus: null };
  const verification = verifyProviderOverlap(pending, [input.officialRow]);
  if (verification.status !== "finmind_overlap_verified") return { promoted: 0, validationStatus: verification.status };
  const nowText = input.now.toISOString();
  const updated = await input.db.prepare(`UPDATE taiwan_stock_pe_valuation_daily SET validation_status='finmind_overlap_verified',official_overlap_date=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=? AND provider='finmind' AND validation_status='finmind_pending_verification'`).bind(verification.overlapDate, input.officialRow.exchange, input.symbol).run();
  const promoted = Number(updated.meta?.changes || 0);
  const verifiedRows = (await readPeRiverRows(input.db, input.symbol)).filter((row) => !["finmind_pending_verification", "source_mismatch"].includes(String(row.validationStatus || "official_verified")));
  const coverageStart = verifiedRows[0]?.sessionDate || null;
  const coverageEnd = verifiedRows.at(-1)?.sessionDate || null;
  const available = verifiedRows.length >= 252;
  await input.db.prepare(`UPDATE taiwan_stock_pe_fetch_state SET coverage_start=?,coverage_end=?,source_date=?,provider_verified_at=?,lane='latest',status=?,reason_code=?,last_success_at=?,last_attempt_at=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=?`).bind(coverageStart, coverageEnd, coverageEnd, nowText, available ? "available" : "partial", "finmind_overlap_verified", nowText, nowText, input.officialRow.exchange, input.symbol).run();
  await input.db.prepare(`UPDATE taiwan_stock_pe_backfill_job SET status=?,reason_code=?,provider_verified_at=?,last_success_at=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=? AND status<>'running'`).bind(available ? "complete" : "partial", available ? "available" : "insufficient_history", nowText, nowText, input.officialRow.exchange, input.symbol).run();
  return { promoted, validationStatus: verification.status, overlapDate: verification.overlapDate };
}

async function reconcileOfficialPeRiverLatest(input: { db: D1Database; officialRow: Awaited<ReturnType<typeof fetchOfficialPeDailySnapshot>>[number]; now: Date }) {
  const existing = await readPeRiverRows(input.db, input.officialRow.symbol);
  const provisional = existing.find((row) => row.sessionDate === input.officialRow.sessionDate && row.validationStatus === "finmind_provisional_latest");
  const reconciliation = provisional ? reconcileProvisionalPeRiverRow(provisional, input.officialRow) : null;
  const combined = [...existing.filter((row) => row.sessionDate !== input.officialRow.sessionDate), input.officialRow].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const coverage = peRiverCoverageState(combined);
  const nowText = input.now.toISOString();
  const mismatch = reconciliation?.status === "source_mismatch";
  const provisionalStatus = mismatch ? "source_mismatch" : coverage.provisional.length ? "pending" : null;
  const status = coverage.validSamples >= PE_RIVER_MINIMUM_SAMPLES ? "available" : "partial";
  const reasonCode = mismatch ? "source_mismatch" : coverage.provisional.length ? "official_not_published" : status === "available" ? "available" : "insufficient_history";
  await input.db.batch([
    peRiverUpsertStatement(input.db, input.officialRow),
    input.db.prepare(`INSERT INTO taiwan_stock_pe_fetch_state (exchange,symbol,coverage_start,coverage_end,source_date,latest_source_date,verified_end,display_end,official_source_date,provisional_dates_json,provisional_status,provisional_quarantined,mismatch_date,mismatch_pe_difference,mismatch_close_difference,provider_verified_at,lane,status,reason_code,last_success_at,last_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'latest',?,?,?,?) ON CONFLICT(exchange,symbol) DO UPDATE SET coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,source_date=excluded.source_date,latest_source_date=CASE WHEN taiwan_stock_pe_fetch_state.latest_source_date IS NULL OR excluded.latest_source_date>taiwan_stock_pe_fetch_state.latest_source_date THEN excluded.latest_source_date ELSE taiwan_stock_pe_fetch_state.latest_source_date END,verified_end=excluded.verified_end,display_end=excluded.display_end,official_source_date=CASE WHEN taiwan_stock_pe_fetch_state.official_source_date IS NULL OR excluded.official_source_date>taiwan_stock_pe_fetch_state.official_source_date THEN excluded.official_source_date ELSE taiwan_stock_pe_fetch_state.official_source_date END,provisional_dates_json=excluded.provisional_dates_json,provisional_status=CASE WHEN taiwan_stock_pe_fetch_state.provisional_quarantined=1 THEN 'source_mismatch' ELSE excluded.provisional_status END,provisional_quarantined=MAX(taiwan_stock_pe_fetch_state.provisional_quarantined,excluded.provisional_quarantined),mismatch_date=COALESCE(excluded.mismatch_date,taiwan_stock_pe_fetch_state.mismatch_date),mismatch_pe_difference=COALESCE(excluded.mismatch_pe_difference,taiwan_stock_pe_fetch_state.mismatch_pe_difference),mismatch_close_difference=COALESCE(excluded.mismatch_close_difference,taiwan_stock_pe_fetch_state.mismatch_close_difference),provider_verified_at=excluded.provider_verified_at,lane='latest',status=excluded.status,reason_code=CASE WHEN taiwan_stock_pe_fetch_state.provisional_quarantined=1 OR excluded.provisional_quarantined=1 THEN 'source_mismatch' ELSE excluded.reason_code END,last_success_at=excluded.last_success_at,last_attempt_at=excluded.last_attempt_at,updated_at=CURRENT_TIMESTAMP`).bind(input.officialRow.exchange, input.officialRow.symbol, coverage.coverageStart, coverage.verifiedEnd, coverage.verifiedEnd, input.officialRow.sessionDate, coverage.verifiedEnd, coverage.displayEnd, input.officialRow.sessionDate, JSON.stringify(coverage.provisional.map((row) => row.sessionDate)), provisionalStatus, mismatch ? 1 : 0, mismatch ? input.officialRow.sessionDate : null, mismatch ? reconciliation.peDifference : null, mismatch ? reconciliation.closeDifference : null, nowText, status, reasonCode, nowText, nowText),
  ]);
  return { status: reconciliation?.status || "official_verified", mismatch, ...coverage };
}

async function applyOfficialPeRiverGap(input: { db: D1Database; gap: OfficialPeGap; now: Date }) {
  const existing = await readPeRiverRows(input.db, input.gap.symbol);
  const provisional = existing.find((row) => row.sessionDate === input.gap.sessionDate && row.validationStatus === "finmind_provisional_latest");
  const nowText = input.now.toISOString();
  const combined = existing.filter((row) => row.sessionDate !== input.gap.sessionDate);
  const coverage = peRiverCoverageState(combined);
  const status = coverage.validSamples >= PE_RIVER_MINIMUM_SAMPLES ? "available" : "partial";
  const statements = [];
  if (provisional) statements.push(peRiverUpsertStatement(input.db, { ...provisional, source: input.gap.source, provider: input.gap.source, validationStatus: "official_gap", officialOverlapDate: input.gap.sessionDate, provisionalCreatedAt: null, sourceDate: input.gap.sessionDate, fetchedAt: nowText }));
  statements.push(input.db.prepare(`INSERT INTO taiwan_stock_pe_fetch_state (exchange,symbol,coverage_start,coverage_end,source_date,latest_source_date,verified_end,display_end,official_source_date,provisional_dates_json,provisional_status,lane,status,reason_code,last_success_at,last_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,'[]',NULL,'latest',?,'official_gap',?,?) ON CONFLICT(exchange,symbol) DO UPDATE SET coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,source_date=excluded.source_date,latest_source_date=CASE WHEN taiwan_stock_pe_fetch_state.latest_source_date IS NULL OR excluded.latest_source_date>taiwan_stock_pe_fetch_state.latest_source_date THEN excluded.latest_source_date ELSE taiwan_stock_pe_fetch_state.latest_source_date END,verified_end=excluded.verified_end,display_end=excluded.display_end,official_source_date=CASE WHEN taiwan_stock_pe_fetch_state.official_source_date IS NULL OR excluded.official_source_date>taiwan_stock_pe_fetch_state.official_source_date THEN excluded.official_source_date ELSE taiwan_stock_pe_fetch_state.official_source_date END,provisional_dates_json='[]',provisional_status=NULL,lane='latest',status=excluded.status,reason_code='official_gap',last_success_at=excluded.last_success_at,last_attempt_at=excluded.last_attempt_at,updated_at=CURRENT_TIMESTAMP`).bind(input.gap.exchange, input.gap.symbol, coverage.coverageStart, coverage.verifiedEnd, coverage.verifiedEnd, input.gap.sessionDate, coverage.verifiedEnd, coverage.displayEnd, input.gap.sessionDate, status, nowText, nowText));
  await input.db.batch(statements);
  return { status: "official_gap" as const, removedProvisional: Boolean(provisional), ...coverage };
}

export async function refreshPeRiverOfficialLatest(input: { db: D1Database; runId: string; fetchImpl?: typeof fetch; now?: Date; provisionalEnabled?: boolean }) {
  if (!RUN_ID.test(input.runId)) throw new Error("invalid_payload");
  const now = input.now || new Date();
  const nowText = now.toISOString();
  const targets = await discoverPeRiverTargets(input.db);
  const snapshots = new Map<PeRiverExchange, Awaited<ReturnType<typeof fetchOfficialPeDailySnapshot>>>();
  const gaps = new Map<PeRiverExchange, OfficialPeGap[]>();
  const failures: Record<string, string> = {};
  const attempts = {} as Record<PeRiverExchange, ProviderAttempt>;
  for (const exchange of ["TWSE", "TPEx"] as const) {
    try {
      const bundle = await fetchOfficialPeDailySnapshotBundle(exchange, input.fetchImpl || fetch);
      snapshots.set(exchange, bundle.rows);
      gaps.set(exchange, bundle.gaps);
      attempts[exchange] = { attemptedAt: nowText, status: "success", reasonCode: "available", sourceDate: null, diagnostic: bundle.diagnostic || null };
    }
    catch (error) {
      const reasonCode = safePeRiverBackfillError(error);
      failures[exchange] = reasonCode;
      snapshots.set(exchange, []);
      gaps.set(exchange, []);
      attempts[exchange] = { attemptedAt: nowText, status: reasonCode === "official_not_published" ? "pending" : "failed", reasonCode, sourceDate: null, diagnostic: peRiverProviderAttemptDiagnostic(error) };
    }
  }
  const accepted = [];
  let promoted = 0;
  for (const target of targets) {
    const row = snapshots.get(target.exchange)?.find((value) => value.symbol === target.symbol);
    if (!row) {
      const gap = gaps.get(target.exchange)?.find((value) => value.symbol === target.symbol);
      if (gap) await applyOfficialPeRiverGap({ db: input.db, gap, now });
      continue;
    }
    const promotion = await promotePendingPeRiverHistory({ db: input.db, symbol: target.symbol, officialRow: row, now });
    promoted += promotion.promoted;
    await reconcileOfficialPeRiverLatest({ db: input.db, officialRow: row, now });
    accepted.push(row);
  }
  const sourceDate = (rows: typeof accepted) => rows.reduce((latest, row) => row.sessionDate > latest ? row.sessionDate : latest, "") || null;
  const twseSourceDate = sourceDate(snapshots.get("TWSE") || []);
  const tpexSourceDate = sourceDate(snapshots.get("TPEx") || []);
  attempts.TWSE.sourceDate = twseSourceDate;
  attempts.TPEx.sourceDate = tpexSourceDate;
  let provisionalAccepted = 0;
  const provisional: Array<{ symbol: string; status: string; dates: string[] }> = [];
  if (input.provisionalEnabled) {
    for (const target of targets) {
      const officialSourceDate = target.exchange === "TWSE" ? twseSourceDate : tpexSourceDate;
      if (!officialSourceDate) continue;
      const state = await input.db.prepare(`SELECT provisional_quarantined,display_end,provisional_status,provisional_dates_json FROM taiwan_stock_pe_fetch_state WHERE exchange=? AND symbol=?`).bind(target.exchange, target.symbol).first<{ provisional_quarantined?: number | null; display_end?: string | null; provisional_status?: string | null; provisional_dates_json?: string | null }>();
      const range = provisionalPeRiverDateRange(officialSourceDate, now);
      if (range.status === "provisional_capped") {
        await input.db.prepare(`UPDATE taiwan_stock_pe_fetch_state SET provisional_status='provisional_capped',reason_code='provisional_capped',last_attempt_at=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=? AND provisional_quarantined=0`).bind(now.toISOString(), target.exchange, target.symbol).run();
        provisional.push({ symbol: target.symbol, status: range.status, dates: [] });
        continue;
      }
      if (range.status !== "ready" || !range.startDate) continue;
      if (state?.display_end && state.display_end >= range.endDate && ["pending", "provisional_capped"].includes(String(state.provisional_status || ""))) {
        let dates: string[] = [];
        try { dates = JSON.parse(state.provisional_dates_json || "[]"); } catch {}
        provisional.push({ symbol: target.symbol, status: "deduped", dates });
        continue;
      }
      const budget = await reserveFinMindBudget(input.db, 2, now);
      if (!budget.reserved) {
        await input.db.prepare(`UPDATE taiwan_stock_pe_fetch_state SET provisional_status='rate_limit_waiting',reason_code='rate_limit_waiting',retry_after=?,last_attempt_at=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=?`).bind(budget.windowEnd, now.toISOString(), target.exchange, target.symbol).run();
        provisional.push({ symbol: target.symbol, status: "rate_limit_waiting", dates: [] });
        break;
      }
      try {
        const history = await fetchFinMindPeHistory({ symbol: target.symbol, startDate: range.startDate, endDate: range.endDate, fetchImpl: input.fetchImpl || fetch });
        const candidate = buildProvisionalPeRiverCandidates({ historyRows: history.rows, officialSourceDate, now, enabled: true, quarantined: Boolean(state?.provisional_quarantined) });
        if (candidate.rows.length) {
          const ingested = await ingestProvisionalPeRiverRows({ db: input.db, symbol: target.symbol, rows: candidate.rows, officialSourceDate, status: candidate.capped ? "provisional_capped" : "pending", now });
          provisionalAccepted += ingested.accepted;
        }
        provisional.push({ symbol: target.symbol, status: candidate.status, dates: candidate.rows.map((row) => row.sessionDate) });
      } catch (error) {
        const reasonCode = safePeRiverBackfillError(error);
        await input.db.prepare(`UPDATE taiwan_stock_pe_fetch_state SET provisional_status=?,reason_code=?,last_attempt_at=?,updated_at=CURRENT_TIMESTAMP WHERE exchange=? AND symbol=?`).bind(reasonCode, reasonCode, now.toISOString(), target.exchange, target.symbol).run();
        provisional.push({ symbol: target.symbol, status: reasonCode, dates: [] });
      }
    }
  }
  const completed = await completePeRiverLatestLane({ db: input.db, runId: input.runId, twseSourceDate, tpexSourceDate, attempts, now });
  return { ...completed, accepted: accepted.length, promoted, provisionalAccepted, provisional, failures, attempts, rows: accepted.map((row) => ({ symbol: row.symbol, exchange: row.exchange, sessionDate: row.sessionDate, officialClose: row.officialClose, officialPeRatio: row.officialPeRatio, validationStatus: row.validationStatus, source: row.source, provider: row.provider, sourceDate: row.sourceDate })) };
}

export async function startPeRiverContinuousRun(input: {
  db: D1Database;
  runId: string;
  trigger: "schedule" | "workflow_dispatch";
  now?: Date;
}) {
  if (!RUN_ID.test(input.runId) || !["schedule", "workflow_dispatch"].includes(input.trigger)) throw new Error("invalid_payload");
  const now = input.now || new Date();
  const nowText = now.toISOString();
  const targets = await discoverPeRiverTargets(input.db);
  const range = targetRange(now);
  for (const target of targets) await queuePeRiverBackfill(input.db, { symbol: target.symbol, targetStart: range.start, targetEnd: range.end });
  await input.db.prepare(`INSERT INTO taiwan_stock_pe_control (control_key,scheduler_heartbeat_at,budget_limit) VALUES ('global',?,?) ON CONFLICT(control_key) DO UPDATE SET scheduler_heartbeat_at=excluded.scheduler_heartbeat_at,budget_limit=excluded.budget_limit,updated_at=CURRENT_TIMESTAMP`).bind(nowText, FINMIND_SAFE_HOURLY_BUDGET).run();

  const candidates = await input.db.prepare(`SELECT job_id,exchange,symbol,target_start,target_end,attempt,retry_after FROM taiwan_stock_pe_backfill_job WHERE status IN ('queued','retry_waiting','running') AND (retry_after IS NULL OR retry_after<=?) AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY updated_at,symbol LIMIT ?`).bind(nowText, nowText, PE_RIVER_MAX_HISTORY_TARGETS).all<{ job_id: string; exchange: string; symbol: string; target_start: string; target_end: string; attempt: number; retry_after: string | null }>();
  const budget = candidates.results.length ? await reserveFinMindBudget(input.db, candidates.results.length * 2, now) : { reserved: true, used: 0, limit: FINMIND_SAFE_HOURLY_BUDGET, windowStart: null, windowEnd: null, reasonCode: null };
  const history = [];
  if (budget.reserved) {
    const leaseExpiresAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
    for (const candidate of candidates.results) {
      const claimed = await input.db.prepare(`UPDATE taiwan_stock_pe_backfill_job SET status='running',reason_code='running',lane='history',attempt=attempt+1,lease_owner=?,lease_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status IN ('queued','retry_waiting','running') AND (lease_expires_at IS NULL OR lease_expires_at<=?)`).bind(input.runId, leaseExpiresAt, candidate.job_id, nowText).run();
      if (Number(claimed.meta?.changes || 0) > 0) {
        const checkpoints = await input.db.prepare(`SELECT target_month,dataset_status_json,ingest_cursor,attempts FROM taiwan_stock_pe_backfill_month WHERE job_id=? AND status<>'complete' ORDER BY target_month`).bind(candidate.job_id).all<{ target_month: string; dataset_status_json: string; ingest_cursor: number; attempts: number }>();
        const months = checkpoints.results.map((row) => row.target_month);
        await input.db.prepare(`UPDATE taiwan_stock_pe_backfill_month SET status='running',attempts=attempts+1,lease_owner=?,lease_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status<>'complete'`).bind(input.runId, leaseExpiresAt, candidate.job_id).run();
        history.push({ jobId: candidate.job_id, exchange: candidate.exchange as PeRiverExchange, symbol: candidate.symbol, startDate: candidate.target_start, endDate: candidate.target_end, months, checkpoints: checkpoints.results.map((row) => ({ month: row.target_month, datasetStatus: JSON.parse(row.dataset_status_json || "{}"), ingestCursor: Number(row.ingest_cursor || 0), attempt: Number(row.attempts || 0) + 1 })), attempt: Number(candidate.attempt || 0) + 1, leaseOwner: input.runId, leaseExpiresAt });
      }
    }
  } else if (candidates.results.length) {
    await input.db.prepare(`UPDATE taiwan_stock_pe_backfill_job SET status='retry_waiting',reason_code='rate_limit_waiting',retry_after=?,updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued','retry_waiting')`).bind(budget.windowEnd).run();
  }
  return {
    runId: input.runId,
    trigger: input.trigger,
    order: ["latest", "history"] as const,
    latest: targets.map((target) => ({ ...target, lane: "latest" as const })),
    history,
    historyLimit: PE_RIVER_MAX_HISTORY_TARGETS,
    budget,
    heartbeatAt: nowText,
  };
}

export async function completePeRiverLatestLane(input: { db: D1Database; runId: string; twseSourceDate?: string | null; tpexSourceDate?: string | null; attempts?: Record<PeRiverExchange, ProviderAttempt>; now?: Date }) {
  if (!RUN_ID.test(input.runId)) throw new Error("invalid_payload");
  const nowText = (input.now || new Date()).toISOString();
  const fallbackAttempt = (sourceDate?: string | null): ProviderAttempt => ({ attemptedAt: nowText, status: sourceDate ? "success" : "pending", reasonCode: sourceDate ? "available" : "official_not_published", sourceDate: sourceDate || null, diagnostic: null });
  const twse = input.attempts?.TWSE || fallbackAttempt(input.twseSourceDate);
  const tpex = input.attempts?.TPEx || fallbackAttempt(input.tpexSourceDate);
  await input.db.prepare(`INSERT INTO taiwan_stock_pe_control (control_key,scheduler_heartbeat_at,last_latest_run_at,latest_twse_source_date,latest_tpex_source_date,latest_twse_attempt_at,latest_twse_attempt_status,latest_twse_attempt_reason_code,latest_twse_attempt_detail_json,latest_tpex_attempt_at,latest_tpex_attempt_status,latest_tpex_attempt_reason_code,latest_tpex_attempt_detail_json) VALUES ('global',?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(control_key) DO UPDATE SET scheduler_heartbeat_at=excluded.scheduler_heartbeat_at,last_latest_run_at=excluded.last_latest_run_at,latest_twse_source_date=COALESCE(excluded.latest_twse_source_date,taiwan_stock_pe_control.latest_twse_source_date),latest_tpex_source_date=COALESCE(excluded.latest_tpex_source_date,taiwan_stock_pe_control.latest_tpex_source_date),latest_twse_attempt_at=excluded.latest_twse_attempt_at,latest_twse_attempt_status=excluded.latest_twse_attempt_status,latest_twse_attempt_reason_code=excluded.latest_twse_attempt_reason_code,latest_twse_attempt_detail_json=excluded.latest_twse_attempt_detail_json,latest_tpex_attempt_at=excluded.latest_tpex_attempt_at,latest_tpex_attempt_status=excluded.latest_tpex_attempt_status,latest_tpex_attempt_reason_code=excluded.latest_tpex_attempt_reason_code,latest_tpex_attempt_detail_json=excluded.latest_tpex_attempt_detail_json,updated_at=CURRENT_TIMESTAMP`).bind(nowText, nowText, input.twseSourceDate || null, input.tpexSourceDate || null, twse.attemptedAt, twse.status, twse.reasonCode, JSON.stringify(twse.diagnostic), tpex.attemptedAt, tpex.status, tpex.reasonCode, JSON.stringify(tpex.diagnostic)).run();
  return { status: "complete" as const, heartbeatAt: nowText, twseSourceDate: input.twseSourceDate || null, tpexSourceDate: input.tpexSourceDate || null, attempts: { TWSE: twse, TPEx: tpex } };
}

export async function completePeRiverHistoryTarget(input: { db: D1Database; runId: string; jobId: string; symbol: string; validationStatus: string; overlapDate?: string | null; now?: Date }) {
  if (!RUN_ID.test(input.runId) || !input.jobId.startsWith("pe-river:") || !["finmind_overlap_verified", "official_not_published"].includes(input.validationStatus)) throw new Error("invalid_payload");
  const nowText = (input.now || new Date()).toISOString();
  const rows = await readPeRiverRows(input.db, input.symbol);
  const verified = rows.filter((row) => ["official_verified", "finmind_overlap_verified"].includes(String(row.validationStatus || "official_verified")));
  const coverageStart = verified[0]?.sessionDate || null;
  const coverageEnd = verified.at(-1)?.sessionDate || null;
  const status = verified.length >= 252 ? "available" : "insufficient_history";
  const providerVerifiedAt = input.validationStatus === "finmind_overlap_verified" ? nowText : null;
  const results = await input.db.batch([
    input.db.prepare(`INSERT INTO taiwan_stock_pe_fetch_state (exchange,symbol,coverage_start,coverage_end,source_date,latest_source_date,provider_verified_at,lane,status,reason_code,last_success_at,last_attempt_at) SELECT exchange,symbol,?,?,?,?,?,'history',?,?,?,? FROM taiwan_stock_pe_backfill_job WHERE job_id=? AND lease_owner=? ON CONFLICT(exchange,symbol) DO UPDATE SET coverage_start=excluded.coverage_start,coverage_end=excluded.coverage_end,source_date=excluded.source_date,latest_source_date=CASE WHEN taiwan_stock_pe_fetch_state.latest_source_date IS NULL OR (excluded.latest_source_date IS NOT NULL AND excluded.latest_source_date>taiwan_stock_pe_fetch_state.latest_source_date) THEN excluded.latest_source_date ELSE taiwan_stock_pe_fetch_state.latest_source_date END,provider_verified_at=COALESCE(excluded.provider_verified_at,taiwan_stock_pe_fetch_state.provider_verified_at),lane='history',status=excluded.status,reason_code=excluded.reason_code,last_success_at=excluded.last_success_at,last_attempt_at=excluded.last_attempt_at,updated_at=CURRENT_TIMESTAMP`).bind(coverageStart, coverageEnd, coverageEnd, input.overlapDate || null, providerVerifiedAt, status, input.validationStatus, nowText, nowText, input.jobId, input.runId),
    input.db.prepare(`UPDATE taiwan_stock_pe_control SET scheduler_heartbeat_at=?,last_history_run_at=?,updated_at=CURRENT_TIMESTAMP WHERE control_key='global' AND EXISTS (SELECT 1 FROM taiwan_stock_pe_backfill_job WHERE job_id=? AND lease_owner=?)`).bind(nowText, nowText, input.jobId, input.runId),
    input.db.prepare(`UPDATE taiwan_stock_pe_backfill_job SET status=?,reason_code=?,completed_months=(SELECT COUNT(*) FROM taiwan_stock_pe_backfill_month WHERE job_id=? AND status='complete'),provider_verified_at=?,lease_owner=NULL,lease_expires_at=NULL,retry_after=NULL,last_success_at=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND lease_owner=?`).bind(status === "available" ? "complete" : "partial", status, input.jobId, providerVerifiedAt, nowText, input.jobId, input.runId),
  ]);
  if (Number(results[2]?.meta?.changes || 0) < 1) throw new Error("lease_conflict");
  return { status, validSamples: verified.length, coverageStart, coverageEnd, overlapDate: input.overlapDate || null };
}

export async function failPeRiverHistoryTarget(input: { db: D1Database; runId: string; jobId: string; error: unknown; attempt: number; retryAfter?: string | null; now?: Date }) {
  if (!RUN_ID.test(input.runId) || !input.jobId.startsWith("pe-river:")) throw new Error("invalid_payload");
  const now = input.now || new Date();
  const reasonCode = safePeRiverBackfillError(input.error);
  const retryable = ["retry_waiting", "rate_limit_waiting", "provider_unavailable", "official_not_published"].includes(reasonCode) && input.attempt < 5;
  const retryAfter = retryable ? (input.retryAfter || peRiverRetryAfter(input.attempt, now)) : null;
  await input.db.prepare(`UPDATE taiwan_stock_pe_backfill_job SET status=?,reason_code=?,retry_after=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND lease_owner=?`).bind(retryable ? "retry_waiting" : "blocked", reasonCode, retryAfter, input.jobId, input.runId).run();
  await input.db.prepare(`UPDATE taiwan_stock_pe_backfill_month SET status=?,error_code=?,retry_after=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status<>'complete' AND lease_owner=?`).bind(retryable ? "retry_waiting" : "blocked", reasonCode, retryAfter, input.jobId, input.runId).run();
  return { status: retryable ? "retry_waiting" as const : "blocked" as const, reasonCode, retryAfter };
}

export async function readPeRiverContinuousHealth(db: D1Database) {
  const control = await db.prepare(`SELECT * FROM taiwan_stock_pe_control WHERE control_key='global'`).first<Record<string, unknown>>();
  const history = await db.prepare(`SELECT COUNT(*) AS target,SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) AS ready,SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS insufficient,SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS missing,SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked,SUM(CASE WHEN status='retry_waiting' THEN 1 ELSE 0 END) AS retry_waiting FROM taiwan_stock_pe_backfill_job`).first<Record<string, number | null>>();
  const latest = await db.prepare(`SELECT SUM(CASE WHEN reason_code='available' AND provisional_status IS NULL THEN 1 ELSE 0 END) AS fresh,SUM(CASE WHEN reason_code='official_not_published' OR provisional_status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN reason_code IN ('retry_waiting','rate_limit_waiting') THEN 1 ELSE 0 END) AS retry,SUM(CASE WHEN reason_code='source_mismatch' OR provisional_quarantined=1 THEN 1 ELSE 0 END) AS mismatch,SUM(CASE WHEN provisional_status='provisional_capped' THEN 1 ELSE 0 END) AS provisional_capped,MAX(latest_source_date) AS source_date,MAX(verified_end) AS verified_end,MAX(display_end) AS display_end,MAX(official_source_date) AS official_source_date FROM taiwan_stock_pe_fetch_state`).first<Record<string, number | string | null>>();
  const diagnostic = (value: unknown) => {
    try { return value ? JSON.parse(String(value)) : null; }
    catch { return null; }
  };
  const attempts = {
    twse: { attemptedAt: control?.latest_twse_attempt_at || null, status: control?.latest_twse_attempt_status || null, reasonCode: control?.latest_twse_attempt_reason_code || null, diagnostic: diagnostic(control?.latest_twse_attempt_detail_json), lastVerifiedSourceDate: control?.latest_twse_source_date || null },
    tpex: { attemptedAt: control?.latest_tpex_attempt_at || null, status: control?.latest_tpex_attempt_status || null, reasonCode: control?.latest_tpex_attempt_reason_code || null, diagnostic: diagnostic(control?.latest_tpex_attempt_detail_json), lastVerifiedSourceDate: control?.latest_tpex_source_date || null },
  };
  return {
    scheduler: { heartbeatAt: control?.scheduler_heartbeat_at || null, lastLatestRunAt: control?.last_latest_run_at || null, lastHistoryRunAt: control?.last_history_run_at || null },
    history: { target: Number(history?.target || 0), ready: Number(history?.ready || 0), insufficient: Number(history?.insufficient || 0), missing: Number(history?.missing || 0), running: Number(history?.running || 0), blocked: Number(history?.blocked || 0), retryWaiting: Number(history?.retry_waiting || 0) },
    latest: { fresh: Number(latest?.fresh || 0), pending: Number(latest?.pending || 0), retry: Number(latest?.retry || 0), mismatch: Number(latest?.mismatch || 0), providerPending: Number(attempts.twse.status === "pending") + Number(attempts.tpex.status === "pending"), providerMismatch: Number(attempts.twse.reasonCode === "schema_mismatch") + Number(attempts.tpex.reasonCode === "schema_mismatch"), provisionalCapped: Number(latest?.provisional_capped || 0), sourceDate: latest?.source_date || null, verifiedEnd: latest?.verified_end || null, displayEnd: latest?.display_end || null, officialSourceDate: latest?.official_source_date || null, twseSourceDate: control?.latest_twse_source_date || null, tpexSourceDate: control?.latest_tpex_source_date || null, attempts },
    budget: { used: Number(control?.budget_used || 0), limit: Number(control?.budget_limit || FINMIND_SAFE_HOURLY_BUDGET), windowStart: control?.budget_window_start || null, windowEnd: control?.budget_window_start ? new Date(new Date(String(control.budget_window_start)).getTime() + 3600000).toISOString() : null },
  };
}
