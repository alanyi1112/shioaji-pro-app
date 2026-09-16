import { validateTdcc, type HolderPoint, type UniverseStock } from "../../../src/lib/stock-screener-domain.ts";
import { technicalEvidenceHash } from "../../../src/lib/stock-screener-technical-patterns.ts";
import { SCREENER_CHIP_MAPPING_VERSION, SCREENER_V5_FORMULA_VERSION,
  type ClosePoint, type DailyChipPoint, type ScreenerInputV5, type TdccChipWeek } from "../../../src/lib/stock-screener-v5.ts";
import type { ScreenerDatabase } from "./stock-screener-repository.ts";
import { readScreenerV4Snapshot } from "./stock-screener-v4-repository.ts";
import { publishScreenerV5Snapshot, readScreenerV5Snapshot, type ScreenerV5Metadata } from "./stock-screener-v5-repository.ts";

type ChipRow = { symbol: string; session_date: string; investment_trust_net_shares: string | null;
  margin_today_balance_lots: string | null; short_today_balance_lots: string | null;
  institutional_receipt_id: string | null; margin_receipt_id: string | null };
type OhlcvRow = { symbol: string; data_date: string; close: string };
type TdccRow = { symbol: string; data_date: string; payload: string };

async function readPaged<T>(db: ScreenerDatabase, sql: string, bindings: Array<string | number | null>) {
  const result: T[] = [];
  for (let offset = 0; ; offset += 5000) {
    const page = (await db.prepare(`${sql} LIMIT 5000 OFFSET ?`).bind(...bindings, offset).all<T>()).results ?? [];
    result.push(...page);
    if (page.length < 5000) return result;
  }
}

const ratioSum = (bands: HolderPoint["bands"], levels: number[]) => {
  const selected = bands.filter((band) => levels.includes(band.level));
  if (selected.length !== levels.length) return null;
  const sum = selected.reduce((total, band) => total + Math.round(Number(band.ratio) * 100), 0);
  return Number.isSafeInteger(sum) ? `${Math.trunc(sum / 100)}${sum % 100 ? `.${String(sum % 100).padStart(2, "0").replace(/0$/, "")}` : ""}` : null;
};

function tdccFeature(row: TdccRow, receiptId: string | null): TdccChipWeek | null {
  try {
    const point = JSON.parse(row.payload) as HolderPoint;
    if (validateTdcc(point) !== "none" || point.date !== row.data_date) return null;
    const large = point.bands.find((band) => band.level === 15);
    if (!large) return null;
    return { date: point.date, largeHolders: large.holders, largeShares: large.shares,
      largeRatioPct: large.ratio, retailRatioPct: ratioSum(point.bands, [1, 2, 3]), receiptId };
  } catch { return null; }
}

export async function publishPreparedScreenerV5(db: ScreenerDatabase, now = new Date()) {
  const base = await readScreenerV4Snapshot(db);
  if (!base) return { state: "pending", reason: "v4_snapshot_pending" } as const;
  const effective = base.metadata.effectiveSessionDate;
  const sessions = base.metadata.technicalAnchors.sessions;
  if (sessions.length !== 130 || sessions.at(-1) !== effective) return { state: "pending", reason: "mixed_session_dates" } as const;
  const requiredDaily = sessions.slice(-21);
  const receipts = await readPaged<Record<string, unknown>>(db,
    `SELECT id,market,dataset,requested_date,source_date,payload_hash,status,row_count,universe_target,missing_count,invalid_count
     FROM screener_chip_receipts WHERE requested_date>=? AND requested_date<=? ORDER BY requested_date,market,dataset,id`,
    [requiredDaily[0], effective]);
  const verified = receipts.filter((row) => row.status === "verified" && row.requested_date === row.source_date
    && Number(row.invalid_count) === 0 && Number(row.row_count) + Number(row.missing_count) === Number(row.universe_target));
  const receiptKeys = new Set(verified.map((row) => `${row.requested_date}|${row.market}|${row.dataset}`));
  const expectedKeys = requiredDaily.flatMap((date) => (["TWSE", "TPEx"] as const).flatMap((market) =>
    (["institutional-flow", "margin-short"] as const).map((dataset) => `${date}|${market}|${dataset}`)));
  if (expectedKeys.some((key) => !receiptKeys.has(key))) return { state: "pending", reason: "chip_history_pending",
    progress: { target: expectedKeys.length, processed: expectedKeys.filter((key) => receiptKeys.has(key)).length } } as const;
  const chipRows = await readPaged<ChipRow>(db,
    `SELECT d.symbol,d.session_date,
     CASE WHEN i.id IS NOT NULL THEN d.investment_trust_net_shares ELSE NULL END AS investment_trust_net_shares,
     CASE WHEN m.id IS NOT NULL THEN d.margin_today_balance_lots ELSE NULL END AS margin_today_balance_lots,
     CASE WHEN m.id IS NOT NULL THEN d.short_today_balance_lots ELSE NULL END AS short_today_balance_lots,
     i.id AS institutional_receipt_id,m.id AS margin_receipt_id
     FROM screener_chip_daily d
     LEFT JOIN screener_chip_receipts i ON i.id=d.institutional_receipt_id AND i.status='verified' AND i.source_date=d.session_date
     LEFT JOIN screener_chip_receipts m ON m.id=d.margin_receipt_id AND m.status='verified' AND m.source_date=d.session_date
     WHERE d.session_date>=? AND d.session_date<=? ORDER BY d.symbol,d.session_date`,
    [requiredDaily[0], effective]);
  const closes = await readPaged<OhlcvRow>(db,
    "SELECT symbol,data_date,close FROM screener_daily_ohlcv WHERE data_date>=? AND data_date<=? AND validation='canonical-complete-v2' ORDER BY symbol,data_date",
    [sessions[0], effective]);
  const candidateDates = (await db.prepare(`SELECT DISTINCT data_date FROM screener_tdcc_weekly
    WHERE validation='full-17' AND data_date<=? ORDER BY data_date DESC LIMIT 13`)
    .bind(effective).all<{ data_date: string }>()).results ?? [];
  if (candidateDates.length < 4) return { state: "pending", reason: "tdcc_universe_coverage_pending" } as const;
  const candidateRows = await readPaged<TdccRow>(db,
    `SELECT symbol,data_date,payload FROM screener_tdcc_weekly WHERE validation='full-17'
     AND data_date>=? AND data_date<=? ORDER BY symbol,data_date`, [candidateDates.at(-1)!.data_date, candidateDates[0]!.data_date]);
  const presentByDate = new Map<string, Set<string>>();
  for (const row of candidateRows) {
    const present = presentByDate.get(row.data_date) ?? new Set<string>();
    present.add(row.symbol); presentByDate.set(row.data_date, present);
  }
  const tdccPeriods = candidateDates.filter(({ data_date }) => base.inputs.every((input) => input.listingDate && input.listingDate > data_date
    || presentByDate.get(data_date)?.has(input.symbol))).map((row) => row.data_date).slice(0, 13).sort();
  if (tdccPeriods.length < 4) return { state: "pending", reason: "tdcc_universe_coverage_pending" } as const;
  const tdccRows = candidateRows.filter((row) => tdccPeriods.includes(row.data_date));
  const provenanceRows = await readPaged<{ symbol: string; data_date: string; receipt_id: string | null }>(db,
    "SELECT symbol,data_date,receipt_id FROM tdcc_distribution_row_provenance WHERE data_date>=? AND data_date<=? ORDER BY symbol,data_date",
    [tdccPeriods[0]!, tdccPeriods.at(-1)!]).catch(() => []);
  const receiptByTdcc = new Map(provenanceRows.map((row) => [`${row.symbol}|${row.data_date}`, row.receipt_id]));
  const universeRows = await readPaged<{ symbol: string; payload: string; issued_common_shares: string | null;
    issued_shares_source_date: string | null; issued_shares_source_url: string | null; issued_shares_payload_hash: string | null;
    issued_shares_normalization_version: string | null }>(db,
    `SELECT symbol,payload,issued_common_shares,issued_shares_source_date,issued_shares_source_url,issued_shares_payload_hash,
     issued_shares_normalization_version FROM screener_universe WHERE revision=? ORDER BY symbol`, [base.metadata.universeRevision]);
  const universeBySymbol = new Map(universeRows.map((row) => [row.symbol, row]));
  const dailyBySymbol = new Map<string, ChipRow[]>(), closeBySymbol = new Map<string, ClosePoint[]>(), tdccBySymbol = new Map<string, TdccChipWeek[]>();
  for (const row of chipRows) { const values = dailyBySymbol.get(row.symbol) ?? []; values.push(row); dailyBySymbol.set(row.symbol, values); }
  for (const row of closes) { const values = closeBySymbol.get(row.symbol) ?? []; values.push({ sessionDate: row.data_date, close: row.close }); closeBySymbol.set(row.symbol, values); }
  for (const row of tdccRows) { if (!tdccPeriods.includes(row.data_date)) continue; const point = tdccFeature(row, receiptByTdcc.get(`${row.symbol}|${row.data_date}`) ?? null);
    if (point) { const values = tdccBySymbol.get(row.symbol) ?? []; values.push(point); tdccBySymbol.set(row.symbol, values); } }
  const inputs: ScreenerInputV5[] = [];
  let issuedValid = 0, tdccCovered = 0;
  for (const input of base.inputs) {
    const universe = universeBySymbol.get(input.symbol);
    const fallback = input as UniverseStock;
    const shares = universe?.issued_common_shares ?? fallback.issuedCommonShares ?? null;
    if (shares && /^[1-9]\d*$/.test(shares)) issuedValid++;
    const weeks = tdccBySymbol.get(input.symbol) ?? [];
    if (weeks.length === tdccPeriods.length) tdccCovered++;
    const daily: DailyChipPoint[] = (dailyBySymbol.get(input.symbol) ?? []).map((row) => ({ sessionDate: row.session_date,
      investmentTrustNetShares: row.investment_trust_net_shares, marginTodayBalanceLots: row.margin_today_balance_lots,
      shortTodayBalanceLots: row.short_today_balance_lots, institutionalReceiptId: row.institutional_receipt_id,
      marginReceiptId: row.margin_receipt_id }));
    const evidence = { dailySessions: sessions, tdccWeeks: weeks, daily, closes: closeBySymbol.get(input.symbol) ?? [],
      issuedCommonShares: { shares, asOfDate: universe?.issued_shares_source_date ?? fallback.issuedSharesSourceDate ?? null,
        sourceUrl: universe?.issued_shares_source_url ?? fallback.issuedSharesSourceUrl ?? null,
        payloadHash: universe?.issued_shares_payload_hash ?? fallback.issuedSharesPayloadHash ?? null,
        normalizationVersion: universe?.issued_shares_normalization_version ?? fallback.issuedSharesNormalizationVersion ?? null },
      dailyThrough: effective, weeklyThrough: tdccPeriods.at(-1) ?? null,
      mappingVersion: SCREENER_CHIP_MAPPING_VERSION };
    inputs.push({ ...input, chipV5: { ...evidence, evidenceHash: await technicalEvidenceHash(evidence) } });
  }
  const receiptsHash = await technicalEvidenceHash(verified.map((row) => ({ id: row.id, hash: row.payload_hash,
    date: row.source_date, market: row.market, dataset: row.dataset })));
  const previous = await readScreenerV5Snapshot(db);
  if (previous?.metadata.baseSnapshotId === base.id && previous.metadata.receiptsHash === receiptsHash) return { state: "unchanged", snapshotId: previous.id } as const;
  const marketTargets = { TWSE: base.inputs.filter((row) => row.market === "TWSE").length,
    TPEx: base.inputs.filter((row) => row.market === "TPEx").length };
  const coverage = { daily: { TWSE: { target: marketTargets.TWSE, institutional: 0, margin: 0 },
      TPEx: { target: marketTargets.TPEx, institutional: 0, margin: 0 } },
    tdcc: { target: inputs.length, covered: tdccCovered },
    issuedShares: { target: inputs.length, valid: issuedValid, missing: inputs.length - issuedValid } };
  for (const market of ["TWSE", "TPEx"] as const) {
    const latest = chipRows.filter((row) => row.session_date === effective && base.inputs.some((input) => input.symbol === row.symbol && input.market === market));
    coverage.daily[market].institutional = latest.filter((row) => row.institutional_receipt_id).length;
    coverage.daily[market].margin = latest.filter((row) => row.margin_receipt_id).length;
  }
  if (issuedValid !== inputs.length) return { state: "pending", reason: "issued_shares_coverage_pending", coverage } as const;
  const metadata: ScreenerV5Metadata = { version: 5, schemaVersion: 5, formulaVersion: SCREENER_V5_FORMULA_VERSION,
    sourceMappingVersion: SCREENER_CHIP_MAPPING_VERSION, baseSnapshotId: base.id, universeRevision: base.metadata.universeRevision,
    effectiveSessionDate: effective, expectedSessionDate: effective, dailyThrough: effective,
    weeklyThrough: tdccPeriods.at(-1) ?? null, dailySessions: sessions, tdccPeriods, receiptsHash,
    total: inputs.length, validThrough: base.metadata.validThrough, anchors: base.metadata.anchors,
    technicalAnchors: base.metadata.technicalAnchors, coverage };
  const snapshotId = await publishScreenerV5Snapshot(db, metadata, inputs, now);
  return { state: "published", snapshotId, metadata } as const;
}
