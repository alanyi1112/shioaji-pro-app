import { technicalEvidenceHash } from "../../../src/lib/stock-screener-technical-patterns.ts";
import {
  SCREENER_INSTITUTIONAL_MAPPING_VERSION, type InstitutionalDailyPointV6, type ScreenerInputV6,
} from "../../../src/lib/stock-screener-v6.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { readScreenerV5Snapshot } from "./stock-screener-v5-repository.ts";
import { publishScreenerV6Snapshot, readScreenerV6Snapshot, type ScreenerV6Metadata } from "./stock-screener-v6-repository.ts";

type Receipt = { id: string; market: "TWSE" | "TPEx"; requested_date: string; source_date: string | null;
  payload_hash: string; row_count: number; universe_target: number; missing_count: number; invalid_count: number;
  verification_status: string | null; mapping_version: string | null };
type Daily = { symbol: string; session_date: string; foreign_net_shares: string | null; investment_trust_net_shares: string | null;
  institutional_receipt_id: string | null; institutional_mapping_version: string | null; close: string | null; volume_shares: string | null };

async function paged<T>(db: ScreenerDatabase, sql: string, bindings: Array<string | number>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 5000) {
    const page = (await db.prepare(`${sql} LIMIT 5000 OFFSET ?`).bind(...bindings, offset).all<T>()).results ?? [];
    rows.push(...page);
    if (page.length < 5000) return rows;
  }
}

export async function publishPreparedScreenerV6(db: ScreenerDatabase, now = new Date()) {
  const base = await readScreenerV5Snapshot(db);
  if (!base) return { state: "pending", reason: "v5_snapshot_pending" } as const;
  const effective = base.metadata.effectiveSessionDate;
  const sessions = base.metadata.dailySessions;
  if (sessions.length < 21 || sessions.at(-1) !== effective) return { state: "pending", reason: "mixed_session_dates" } as const;
  const required = sessions.slice(-21);
  const receipts = await paged<Receipt>(db, `SELECT r.id,r.market,r.requested_date,r.source_date,r.payload_hash,v.row_count,
      v.universe_target,v.missing_count,v.invalid_count,v.status AS verification_status,v.mapping_version
    FROM screener_chip_receipts r LEFT JOIN screener_institutional_mapping_verifications v
      ON v.receipt_id=r.id AND v.mapping_version=?
    WHERE r.dataset='institutional-flow' AND r.requested_date>=? AND r.requested_date<=?
    ORDER BY r.requested_date,r.market,r.id`, [SCREENER_INSTITUTIONAL_MAPPING_VERSION, required[0]!, effective]);
  const verified = receipts.filter((row) => row.verification_status === "verified"
    && row.mapping_version === SCREENER_INSTITUTIONAL_MAPPING_VERSION && row.requested_date === row.source_date
    && Number(row.invalid_count) === 0 && Number(row.row_count) + Number(row.missing_count) === Number(row.universe_target));
  const keys = new Set(verified.map((row) => `${row.requested_date}|${row.market}`));
  const expected = required.flatMap((date) => (["TWSE", "TPEx"] as const).map((market) => `${date}|${market}`));
  const coverage = Object.fromEntries((["TWSE", "TPEx"] as const).map((market) => {
    const marketRows = verified.filter((row) => row.market === market);
    return [market, { targetDates: required.length, verifiedDates: new Set(marketRows.map((row) => row.requested_date)).size,
      targetRows: marketRows.reduce((sum, row) => sum + Number(row.universe_target), 0),
      verifiedRows: marketRows.reduce((sum, row) => sum + Number(row.row_count), 0),
      missingRows: marketRows.reduce((sum, row) => sum + Number(row.missing_count), 0),
      invalidRows: marketRows.reduce((sum, row) => sum + Number(row.invalid_count), 0),
      lastVerifiedSourceDate: marketRows.map((row) => row.source_date).filter(Boolean).sort().at(-1) ?? null }];
  })) as ScreenerV6Metadata["institutionalCoverage"];
  if (expected.some((key) => !keys.has(key))) return { state: "pending", reason: "institutional_v2_history_pending",
    coverage, progress: { target: expected.length, processed: expected.filter((key) => keys.has(key)).length } } as const;
  const daily = await paged<Daily>(db, `SELECT d.symbol,d.session_date,d.foreign_net_shares,d.investment_trust_net_shares,
      d.institutional_receipt_id,d.institutional_mapping_version,o.close,o.volume_shares
    FROM screener_chip_daily d
    LEFT JOIN screener_daily_ohlcv o ON o.symbol=d.symbol AND o.data_date=d.session_date
      AND o.validation='canonical-complete-v2' AND o.volume_unit='shares'
    LEFT JOIN screener_institutional_mapping_verifications v ON v.receipt_id=d.institutional_receipt_id
      AND v.mapping_version=? AND v.status='verified'
    WHERE d.session_date>=? AND d.session_date<=? AND v.receipt_id IS NOT NULL
    ORDER BY d.symbol,d.session_date`, [SCREENER_INSTITUTIONAL_MAPPING_VERSION, required[0]!, effective]);
  const bySymbol = new Map<string, Daily[]>();
  for (const row of daily) { const values = bySymbol.get(row.symbol) ?? []; values.push(row); bySymbol.set(row.symbol, values); }
  const inputs: ScreenerInputV6[] = [];
  for (const input of base.inputs) {
    const points: InstitutionalDailyPointV6[] = (bySymbol.get(input.symbol) ?? []).map((row) => ({
      sessionDate: row.session_date, foreignNetShares: row.foreign_net_shares,
      investmentTrustNetShares: row.investment_trust_net_shares, close: row.close, volumeShares: row.volume_shares,
      institutionalReceiptId: row.institutional_receipt_id, institutionalMappingVersion: row.institutional_mapping_version,
    }));
    const evidence = { dailySessions: required, daily: points, issuedCommonShares: { ...input.chipV5.issuedCommonShares },
      dailyThrough: effective, mappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION };
    inputs.push({ ...input, institutionalV6: { ...evidence, evidenceHash: await technicalEvidenceHash(evidence) } });
  }
  const receiptsHash = await technicalEvidenceHash({ mappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION,
    baseSnapshotId: base.id, receipts: verified.map((row) => ({ id: row.id, hash: row.payload_hash, date: row.source_date,
      market: row.market, rowCount: Number(row.row_count), universeTarget: Number(row.universe_target),
      missingCount: Number(row.missing_count), invalidCount: Number(row.invalid_count) })),
    evidenceHashes: inputs.map((row) => row.institutionalV6.evidenceHash) });
  const previous = await readScreenerV6Snapshot(db);
  if (previous?.metadata.baseSnapshotId === base.id && previous.metadata.receiptsHash === receiptsHash) {
    return { state: "unchanged", snapshotId: previous.id } as const;
  }
  const metadata: ScreenerV6Metadata = { ...base.metadata, version: 6, schemaVersion: 6,
    formulaVersion: "after-market-v6-institutional-reversal-1", sourceMappingVersion: SCREENER_INSTITUTIONAL_MAPPING_VERSION,
    baseSnapshotId: base.id, receiptsHash, institutionalCoverage: coverage };
  const snapshotId = await publishScreenerV6Snapshot(db, metadata, inputs, now);
  return { state: "published", snapshotId, metadata } as const;
}
