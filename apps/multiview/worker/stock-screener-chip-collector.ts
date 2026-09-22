import type { UniverseStock } from "../../../src/lib/stock-screener-domain.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { SCREENER_V5_RESOURCE_LIMITS } from "./stock-screener-v5-repository.ts";
import { chipDownloadDecision, chipRetryAfter, type ChipRetry } from "./stock-screener-chip-policy.ts";
import { SCREENER_INSTITUTIONAL_MAPPING_VERSION } from "../../../src/lib/stock-screener-v6.ts";
import { chipPayloadHash, parseOfficialChipBatch, screenerChipSourceUrl, type ScreenerChipDataset } from "./stock-screener-chip-sources.ts";

const MAX_BYTES = 25_000_000;
const BATCH = 50;
const iso = (date = new Date()) => date.toISOString();

async function requestPayload(url: string, fetcher: typeof fetch) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20_000);
    try {
      const headers: Record<string, string> = { accept: "application/json", "user-agent": "RealTimeStock/1.0" };
      if (url.startsWith("https://www.tpex.org.tw/")) headers.referer = "https://www.tpex.org.tw/";
      const response = await fetcher(url, { signal: abort.signal, headers });
      if (!response.ok) {
        const header = response.headers.get("retry-after");
        const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 0;
        throw Object.assign(new Error(response.status === 429 ? "rate_limited" : "provider_unavailable"),
          { retryAfterMs: Number.isFinite(delay) ? Math.max(0, delay) : 0 });
      }
      const length = Number(response.headers.get("content-length") || 0);
      if (length > MAX_BYTES) throw new Error("payload_too_large");
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error("payload_too_large");
      try { return JSON.parse(text); } catch { throw new Error("invalid_report_schema"); }
    } catch (error) {
      const lastReason = error instanceof Error && ["rate_limited", "payload_too_large", "invalid_report_schema"].includes(error.message)
        ? error.message : abort.signal.aborted ? "provider_timeout" : "provider_unavailable";
      throw Object.assign(new Error(lastReason), { retryAfterMs: (error as { retryAfterMs?: number })?.retryAfterMs ?? 0 });
    } finally { clearTimeout(timer); }
}

async function readUniverse(db: ScreenerDatabase) {
  const revision = await db.prepare("SELECT revision FROM screener_universe ORDER BY data_date DESC,revision DESC LIMIT 1")
    .first<{ revision: string }>();
  if (!revision) throw new Error("universe_pending");
  const rows = (await db.prepare("SELECT payload FROM screener_universe WHERE revision=? ORDER BY symbol")
    .bind(revision.revision).all<{ payload: string }>()).results ?? [];
  const stocks = rows.map((row) => JSON.parse(row.payload).stock as UniverseStock);
  if (!stocks.length || stocks.some((stock) => !stock.symbol)) throw new Error("invalid_universe");
  return { revision: revision.revision, stocks };
}

/** Authenticated maintenance entrypoint. GET routes never call this function. */
export async function collectScreenerChipSession(db: ScreenerDatabase, sessionDate: string,
  options: { fetcher?: typeof fetch; now?: Date; refreshVerified?: boolean;
    payloads?: Partial<Record<`${"TWSE" | "TPEx"}:${ScreenerChipDataset}`, unknown>> } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw new Error("invalid_session_date");
  const now = options.now ?? new Date(), fetchedAt = iso(now), fetcher = options.fetcher ?? fetch;
  const universe = await readUniverse(db), runId = crypto.randomUUID();
  const outcomes: { market: string; dataset: string; state: string; reason: string | null; nextAttemptAt: string | null }[] = [];
  const targets = (["TWSE", "TPEx"] as const).flatMap((market) => (["institutional-flow", "margin-short"] as const)
    .map((dataset) => ({ market, dataset, key: `${market}:${dataset}` as const,
      url: screenerChipSourceUrl(market, dataset, sessionDate) })));
  await db.prepare(`INSERT INTO screener_chip_runs(id,target_session_date,universe_revision,status,target,processed,failed,overdue,checkpoint,started_at,updated_at)
    VALUES(?,?,?,'running',4,0,0,0,?,?,?)`).bind(runId, sessionDate, universe.revision,
    JSON.stringify({ version: 1, datasets: targets.map((row) => row.key) }), fetchedAt, fetchedAt).run();
  try {
    for (const target of targets) {
      const current = await db.prepare(`SELECT r.id FROM screener_chip_receipts r
        LEFT JOIN screener_institutional_mapping_verifications v ON v.receipt_id=r.id AND v.mapping_version=? AND v.status='verified'
        WHERE r.market=? AND r.dataset=? AND r.requested_date=? AND r.status='verified'
          AND (r.dataset<>'institutional-flow' OR v.receipt_id IS NOT NULL) ORDER BY r.fetched_at DESC LIMIT 1`)
        .bind(SCREENER_INSTITUTIONAL_MAPPING_VERSION, target.market, target.dataset, sessionDate).first<{ id: string }>();
      if (current && !options.refreshVerified) {
        await db.prepare("UPDATE screener_chip_runs SET processed=processed+1,updated_at=? WHERE id=? AND status='running'")
          .bind(fetchedAt, runId).run();
        continue;
      }
      const policyId = `screener-chip-policy:${sessionDate}:${target.key}`;
      const saved = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id=? AND status='waiting'").bind(policyId).first<{ checkpoint: string }>();
      const retry: ChipRetry | null = saved ? JSON.parse(saved.checkpoint) : null;
      const decision = chipDownloadDecision(sessionDate, target.dataset, now, retry);
      if (!decision.allowed) {
        outcomes.push({ ...target, state: "waiting", reason: decision.reason, nextAttemptAt: decision.nextAttemptAt });
        continue;
      }
      const saveRetry = async (policy: ChipRetry) => db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        VALUES(?,'screener-chip-policy','waiting',?,?) ON CONFLICT(id) DO UPDATE SET status='waiting',checkpoint=excluded.checkpoint,lease_until=NULL,updated_at=excluded.updated_at`)
        .bind(policyId, JSON.stringify(policy), fetchedAt).run();
      // Persist before transport so interruption still consumes one bounded attempt.
      const claim = JSON.stringify({ ...chipRetryAfter(sessionDate, now, retry, "request_interrupted"), claimToken: crypto.randomUUID() });
      await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at)
        VALUES(?,'screener-chip-policy','waiting',?,?,?) ON CONFLICT(id) DO UPDATE SET status='waiting',checkpoint=excluded.checkpoint,
        lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until<=?`)
        .bind(policyId, claim, new Date(now.getTime() + 120000).toISOString(), fetchedAt, fetchedAt).run();
      if ((await db.prepare("SELECT checkpoint FROM screener_runs WHERE id=?").bind(policyId).first<{ checkpoint: string }>())?.checkpoint !== claim) {
        outcomes.push({ ...target, state: "waiting", reason: "lease_busy", nextAttemptAt: null });
        continue;
      }
      let hash: string, parsed: ReturnType<typeof parseOfficialChipBatch>;
      try {
        const payload = Object.prototype.hasOwnProperty.call(options.payloads ?? {}, target.key)
          ? options.payloads![target.key] : await requestPayload(target.url, fetcher);
        hash = await chipPayloadHash(payload);
        parsed = parseOfficialChipBatch(payload, target.market, target.dataset, sessionDate, universe.stocks, fetchedAt);
      } catch (error) {
        const reason = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "collector_failed";
        const policy = chipRetryAfter(sessionDate, now, retry, reason, (error as { retryAfterMs?: number })?.retryAfterMs);
        await saveRetry(policy);
        outcomes.push({ ...target, state: "failed", reason, nextAttemptAt: policy.nextAttemptAt });
        await db.prepare("UPDATE screener_chip_runs SET failed=failed+1,last_error_code=?,updated_at=? WHERE id=?")
          .bind(reason, fetchedAt, runId).run();
        continue;
      }
      const existing = await db.prepare(`SELECT r.id,r.status,
          MAX(CASE WHEN v.mapping_version=? AND v.status='verified' THEN 1 ELSE 0 END) AS mapping_verified
        FROM screener_chip_receipts r LEFT JOIN screener_institutional_mapping_verifications v ON v.receipt_id=r.id
        WHERE r.market=? AND r.dataset=? AND r.requested_date=? AND r.payload_hash=? GROUP BY r.id,r.status LIMIT 1`)
        .bind(SCREENER_INSTITUTIONAL_MAPPING_VERSION, target.market, target.dataset, sessionDate, hash)
        .first<{ id: string; status: string; mapping_verified: number }>();
      if (existing?.status === "verified" && (target.dataset !== "institutional-flow" || existing.mapping_verified === 1)) {
        await db.prepare("UPDATE screener_runs SET status='complete',lease_until=NULL WHERE id=?").bind(policyId).run();
        await db.prepare("UPDATE screener_chip_runs SET processed=processed+1,updated_at=? WHERE id=? AND status='running'")
          .bind(fetchedAt, runId).run();
        continue;
      }
      const receiptId = existing?.id ?? crypto.randomUUID();
      if (existing && !(existing.status === "verified" && target.dataset === "institutional-flow")) {
        await db.prepare(`UPDATE screener_chip_receipts SET run_id=?,source_date=?,source_url=?,normalization_version=?,status='staging',
          row_count=?,universe_target=?,missing_count=?,invalid_count=?,reason_code=NULL,fetched_at=?,verified_at=NULL WHERE id=?`)
          .bind(runId, parsed.sourceDate, target.url, parsed.normalizationVersion, parsed.rows.length, parsed.target,
            parsed.missing.length, Object.keys(parsed.invalid).length, fetchedAt, receiptId).run();
      } else if (!existing) {
        await db.prepare(`INSERT INTO screener_chip_receipts(id,run_id,market,dataset,requested_date,source_date,source_url,payload_hash,normalization_version,status,row_count,universe_target,missing_count,invalid_count,reason_code,fetched_at)
          VALUES(?,?,?,?,?,?,?,?,?,'staging',?,?,?,?,NULL,?)`).bind(receiptId, runId, target.market, target.dataset, sessionDate,
          parsed.sourceDate, target.url, hash, parsed.normalizationVersion, parsed.rows.length, parsed.target,
          parsed.missing.length, Object.keys(parsed.invalid).length, fetchedAt).run();
      }
      for (let offset = 0; offset < parsed.rows.length; offset += BATCH) {
        await db.batch(parsed.rows.slice(offset, offset + BATCH).map((row) => target.dataset === "institutional-flow"
          ? db.prepare(`INSERT INTO screener_chip_daily(symbol,session_date,market,foreign_buy_shares,foreign_sell_shares,foreign_net_shares,investment_trust_buy_shares,investment_trust_sell_shares,investment_trust_net_shares,institutional_receipt_id,institutional_mapping_version,institutional_invalid_reason,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_date,symbol) DO UPDATE SET
              foreign_buy_shares=excluded.foreign_buy_shares,foreign_sell_shares=excluded.foreign_sell_shares,
              foreign_net_shares=excluded.foreign_net_shares,
              investment_trust_buy_shares=excluded.investment_trust_buy_shares,investment_trust_sell_shares=excluded.investment_trust_sell_shares,
              investment_trust_net_shares=excluded.investment_trust_net_shares,institutional_receipt_id=excluded.institutional_receipt_id,
              institutional_mapping_version=excluded.institutional_mapping_version,institutional_invalid_reason=NULL,updated_at=excluded.updated_at`)
            .bind(row.symbol, row.sessionDate, row.market, row.foreignBuyShares, row.foreignSellShares, row.foreignNetShares,
              row.investmentTrustBuyShares, row.investmentTrustSellShares, row.investmentTrustNetShares, receiptId,
              SCREENER_INSTITUTIONAL_MAPPING_VERSION, null, fetchedAt)
          : db.prepare(`INSERT INTO screener_chip_daily(symbol,session_date,market,margin_yesterday_balance_lots,margin_today_balance_lots,margin_balance_change_lots,short_yesterday_balance_lots,short_today_balance_lots,short_balance_change_lots,margin_receipt_id,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_date,symbol) DO UPDATE SET
              margin_yesterday_balance_lots=excluded.margin_yesterday_balance_lots,margin_today_balance_lots=excluded.margin_today_balance_lots,
              margin_balance_change_lots=excluded.margin_balance_change_lots,short_yesterday_balance_lots=excluded.short_yesterday_balance_lots,
              short_today_balance_lots=excluded.short_today_balance_lots,short_balance_change_lots=excluded.short_balance_change_lots,
              margin_receipt_id=excluded.margin_receipt_id,updated_at=excluded.updated_at`)
            .bind(row.symbol, row.sessionDate, row.market, row.marginYesterdayBalanceLots, row.marginTodayBalanceLots,
              row.marginBalanceChangeLots, row.shortYesterdayBalanceLots, row.shortTodayBalanceLots,
              row.shortBalanceChangeLots, receiptId, fetchedAt)));
      }
      if (target.dataset === "institutional-flow") {
        const invalidRows = Object.entries(parsed.invalid);
        for (let offset = 0; offset < invalidRows.length; offset += BATCH) await db.batch(invalidRows.slice(offset, offset + BATCH)
          .map(([symbol, reason]) => db.prepare(`INSERT INTO screener_chip_daily
              (symbol,session_date,market,institutional_receipt_id,institutional_mapping_version,institutional_invalid_reason,updated_at)
            VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_date,symbol) DO UPDATE SET
              foreign_buy_shares=NULL,foreign_sell_shares=NULL,foreign_net_shares=NULL,
              investment_trust_buy_shares=NULL,investment_trust_sell_shares=NULL,investment_trust_net_shares=NULL,
              institutional_receipt_id=excluded.institutional_receipt_id,
              institutional_mapping_version=excluded.institutional_mapping_version,
              institutional_invalid_reason=excluded.institutional_invalid_reason,updated_at=excluded.updated_at`)
            .bind(symbol, sessionDate, target.market, receiptId, SCREENER_INSTITUTIONAL_MAPPING_VERSION, reason, fetchedAt)));
      }
      const mappingComplete = Object.keys(parsed.invalid).length === 0
        && parsed.rows.length + parsed.missing.length === parsed.target;
      const verification = target.dataset === "institutional-flow"
        ? db.prepare(`INSERT INTO screener_institutional_mapping_verifications
            (receipt_id,mapping_version,payload_hash,status,row_count,universe_target,missing_count,invalid_count,reason_code,verified_at)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(receipt_id,mapping_version) DO UPDATE SET
            payload_hash=excluded.payload_hash,status=excluded.status,row_count=excluded.row_count,universe_target=excluded.universe_target,
            missing_count=excluded.missing_count,invalid_count=excluded.invalid_count,reason_code=excluded.reason_code,verified_at=excluded.verified_at`)
          .bind(receiptId, SCREENER_INSTITUTIONAL_MAPPING_VERSION, hash, mappingComplete ? "verified" : "invalid",
            parsed.rows.length, parsed.target, parsed.missing.length, Object.keys(parsed.invalid).length,
            mappingComplete ? null : "mapping_coverage_invalid", fetchedAt)
        : db.prepare("SELECT 1");
      await db.batch([
        verification,
        db.prepare("UPDATE screener_runs SET status='complete',lease_until=NULL WHERE id=?").bind(policyId),
        db.prepare("UPDATE screener_chip_receipts SET status='verified',verified_at=? WHERE id=? AND status='staging'").bind(fetchedAt, receiptId),
        db.prepare("UPDATE screener_chip_runs SET processed=processed+1,updated_at=? WHERE id=? AND status='running'").bind(fetchedAt, runId),
      ]);
    }
    if (outcomes.length) {
      await db.prepare("UPDATE screener_chip_runs SET status='pending',checkpoint=?,completed_at=?,updated_at=? WHERE id=?")
        .bind(JSON.stringify({ version: 2, outcomes }), fetchedAt, fetchedAt, runId).run();
      return { state: "pending", runId, sessionDate, outcomes } as const;
    }
    await db.prepare("UPDATE screener_chip_runs SET status='complete',completed_at=?,updated_at=? WHERE id=? AND processed=target AND failed=0")
      .bind(fetchedAt, fetchedAt, runId).run();
    return { state: "complete", runId, sessionDate, universeRevision: universe.revision } as const;
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "collector_failed";
    await db.prepare("UPDATE screener_chip_runs SET status='failed',failed=failed+1,last_error_code=?,completed_at=?,updated_at=? WHERE id=?")
      .bind(reason, fetchedAt, fetchedAt, runId).run();
    return { state: "failed", runId, reason } as const;
  }
}

export async function readScreenerChipHealth(db: ScreenerDatabase) {
  const policies = (await db.prepare("SELECT id,checkpoint,updated_at FROM screener_runs WHERE scope='screener-chip-policy' ORDER BY updated_at DESC LIMIT 100")
    .all<Record<string, unknown>>()).results ?? [];
  const run = await db.prepare("SELECT * FROM screener_chip_runs ORDER BY started_at DESC LIMIT 1").first<Record<string, unknown>>();
  const receipts = (await db.prepare(`SELECT market,dataset,
    MIN(CASE WHEN status='verified' THEN source_date END) AS coverage_start,
    MAX(CASE WHEN status='verified' THEN source_date END) AS coverage_end,
    COUNT(CASE WHEN status='verified' THEN 1 END) AS verified_receipts,
    SUM(CASE WHEN status='verified' THEN row_count ELSE 0 END) AS row_count,
    SUM(CASE WHEN status='verified' THEN missing_count ELSE 0 END) AS missing_count,
    SUM(CASE WHEN status='verified' THEN invalid_count ELSE 0 END) AS invalid_count,
    MAX(fetched_at) AS last_attempt_at
    FROM screener_chip_receipts GROUP BY market,dataset ORDER BY market,dataset`).all<Record<string, unknown>>()).results ?? [];
  const recentReceipts = (await db.prepare(`SELECT requested_date,source_date,market,dataset,status,row_count,universe_target,
    missing_count,invalid_count,reason_code,fetched_at,verified_at FROM screener_chip_receipts
    ORDER BY requested_date DESC,market,dataset LIMIT 200`).all<Record<string, unknown>>()).results ?? [];
  const tdcc = await db.prepare("SELECT MAX(data_date) AS latest_date,COUNT(DISTINCT symbol) AS symbols FROM screener_tdcc_weekly WHERE validation='full-17'")
    .first<Record<string, unknown>>();
  const universe = await db.prepare(`SELECT revision,data_date,COUNT(*) AS target,
    SUM(CASE WHEN market='TWSE' THEN 1 ELSE 0 END) AS twse_target,
    SUM(CASE WHEN market='TPEx' THEN 1 ELSE 0 END) AS tpex_target,
    SUM(CASE WHEN issued_common_shares IS NOT NULL THEN 1 ELSE 0 END) AS issued_shares_valid
    FROM screener_universe WHERE revision=(SELECT revision FROM screener_universe ORDER BY data_date DESC,revision DESC LIMIT 1)
    GROUP BY revision,data_date`).first<Record<string, unknown>>();
  const head = await db.prepare("SELECT * FROM screener_chip_publication_head WHERE name='v5'").first<Record<string, unknown>>();
  const institutionalV2 = (await db.prepare(`SELECT r.market,r.requested_date,
    MAX(CASE WHEN v.status='verified' THEN 1 ELSE 0 END) AS verified,
    MAX(CASE WHEN v.status='invalid' THEN 1 ELSE 0 END) AS invalid,
    MAX(v.universe_target) AS target,MAX(v.row_count) AS row_count,MAX(v.missing_count) AS missing_count,
    MAX(v.invalid_count) AS invalid_count,MAX(v.reason_code) AS reason_code,MAX(v.verified_at) AS verified_at
    FROM screener_chip_receipts r LEFT JOIN screener_institutional_mapping_verifications v
      ON v.receipt_id=r.id AND v.mapping_version=?
    WHERE r.dataset='institutional-flow' GROUP BY r.market,r.requested_date ORDER BY r.requested_date DESC,r.market LIMIT 100`)
    .bind(SCREENER_INSTITUTIONAL_MAPPING_VERSION)
    .all<Record<string, unknown>>()).results ?? [];
  const v6Head = await db.prepare("SELECT * FROM screener_chip_publication_head WHERE name='v6'").first<Record<string, unknown>>();
  return { version: 5, resourceLimits: SCREENER_V5_RESOURCE_LIMITS, latestAttempt: run ?? null, universe: universe ?? null, datasets: receipts,
    receipts: recentReceipts, downloadPolicies: policies, tdcc: tdcc ?? null, publicationHead: head ?? null,
    institutionalV2: { mappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION, dates: institutionalV2,
      publicationHead: v6Head ?? null } };
}
