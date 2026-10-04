/** v9 讀取只驗證凍結能力，絕不建立 schema 或觸發下載。 */
import type { ScreenerDatabase } from './stock-screener-repository.ts';
import type { CandlestickSnapshot, CandlestickFrozenStock } from '../../../src/lib/stock-screener-candlestick-query.ts';
import { validateCandlestickHistory } from '../../../src/lib/stock-screener-candlestick.ts';
import { CANDLESTICK_FORMULA_VERSION, CANDLESTICK_HISTORY_CAPABILITY } from '../../../src/lib/stock-screener-v9.ts';
import { SCREENER_PRICE_BASIS } from '../../../src/lib/stock-screener-ohlcv.ts';
import { technicalEvidenceHash, technicalEvidenceCanonicalJson } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { validBollingerSourceEvidence, type BollingerSourceEvidence } from '../../../src/lib/stock-screener-source-evidence.ts';
import { isIsoDate } from '../../../src/lib/stock-screener-domain.ts';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export interface CandlestickMetadata {
  version: 9; formulaVersion: typeof CANDLESTICK_FORMULA_VERSION; capability: typeof CANDLESTICK_HISTORY_CAPABILITY;
  priceBasis: typeof SCREENER_PRICE_BASIS; sourceMappingVersion: string; calendarHash: string;
  sourceEvidence: BollingerSourceEvidence; sourceHashes: string[]; effectiveSessionDate: string;
  universeRevision: string; universeHash: string; historySessions: string[]; rowsHash: string; total: number; validThrough: string;
}
export const candlestickRowsHash = (rows: readonly CandlestickFrozenStock[]) => {
  const h = createHash('sha256').update('[');
  rows.forEach((r, i) => { if (i) h.update(','); h.update(technicalEvidenceCanonicalJson(r)); });
  return h.update(']').digest('hex');
};
export async function candlestickSchemaReady(db: ScreenerDatabase) {
  const tables = (await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN
    ('screener_candlestick_publications','screener_candlestick_rows','screener_candlestick_head','screener_candlestick_receipts','screener_candlestick_state')`)
    .all<{ name: string }>()).results ?? [];
  return tables.length === 5;
}
export async function validateCandlestickPublication(metadata: CandlestickMetadata, rows: CandlestickFrozenStock[]) {
  const m = metadata, hex = /^[a-f0-9]{64}$/;
  if (m?.version !== 9 || m.formulaVersion !== CANDLESTICK_FORMULA_VERSION || m.capability !== CANDLESTICK_HISTORY_CAPABILITY
    || m.priceBasis !== SCREENER_PRICE_BASIS || !hex.test(m.calendarHash) || !hex.test(m.universeHash)
    || !isIsoDate(m.effectiveSessionDate) || !Number.isFinite(Date.parse(m.validThrough))
    || !Array.isArray(m.historySessions) || m.historySessions.length < 1 || m.historySessions.length > 64
    || m.historySessions.at(-1) !== m.effectiveSessionDate || m.total !== rows.length || !rows.length || rows.length > 10000
    || new Set(rows.map(r => r.symbol)).size !== rows.length
    || !validBollingerSourceEvidence(m.sourceEvidence, m.sourceMappingVersion, m.historySessions)
    || m.sourceEvidence.manifest.universeRevision !== m.universeRevision || m.sourceEvidence.manifest.universeHash !== m.universeHash
    || await technicalEvidenceHash(m.sourceEvidence.manifest) !== m.sourceEvidence.manifestHash) throw new Error('invalid_v9_publication');
  for (const s of m.sourceEvidence.selections) {
    const { manifestHash, ...body } = s;
    if (await technicalEvidenceHash(body) !== manifestHash) throw new Error('invalid_v9_source_manifest');
  }
  const sourceHashes = [...new Set(m.sourceEvidence.selections.map(s => s.payloadHash))].sort();
  if (JSON.stringify(sourceHashes) !== JSON.stringify(m.sourceHashes)) throw new Error('invalid_v9_source_manifest');
  for (const r of rows) {
    if (r.ordinary !== true || !['TWSE', 'TPEx'].includes(r.market) || r.symbol !== `${r.code}.${r.market === 'TWSE' ? 'TW' : 'TWO'}`
      || typeof r.name !== 'string' || !r.name || r.history.through !== m.effectiveSessionDate
      || r.history.completedThrough !== m.effectiveSessionDate || r.history.mappingVersion !== m.sourceMappingVersion
      || r.history.calendarHash !== m.calendarHash || JSON.stringify(r.history.sessions) !== JSON.stringify(m.historySessions)
      || JSON.stringify(r.history.sourceHashes) !== JSON.stringify(sourceHashes)) throw new Error('invalid_v9_publication');
    await validateCandlestickHistory(r.history);
  }
  if (candlestickRowsHash(rows) !== m.rowsHash) throw new Error('invalid_v9_rows_hash');
}
export async function readCandlestickPublication(db: ScreenerDatabase, id?: string, staging = false): Promise<(CandlestickSnapshot & {
  metadata: CandlestickMetadata; createdAt: string;
}) | null> {
  if (!await candlestickSchemaReady(db)) return null;
  const first = await db.prepare(`SELECT id,metadata,created_at FROM screener_candlestick_publications WHERE status='${staging && id ? 'staging' : 'published'}'
    AND id=${id ? '?' : "(SELECT snapshot_id FROM screener_candlestick_head WHERE name='v9')"}`)
    .bind(...(id ? [id] : [])).first<{ id: string; metadata: string; created_at: string }>();
  if (!first) return null;
  const metadata = JSON.parse(first.metadata) as CandlestickMetadata;
  if (!Number.isSafeInteger(metadata.total) || metadata.total < 1 || metadata.total > 10000) throw new Error('invalid_v9_publication');
  const rows: CandlestickFrozenStock[] = []; let after = '', bytes = 0;
  for (let page = 0; page <= 200; page++) {
    const records = (await db.prepare(`SELECT symbol,payload FROM screener_candlestick_rows
      WHERE snapshot_id=? AND symbol>? ORDER BY symbol LIMIT 50`).bind(first.id, after)
      .all<{ symbol: string; payload: string }>()).results ?? [];
    for (const record of records) {
      const size = Buffer.byteLength(record.payload); bytes += size;
      if (size > 128 * 1024 || bytes > 128 * 1024 * 1024 || record.symbol <= after || rows.length >= metadata.total)
        throw new Error('v9_read_budget');
      const row = JSON.parse(record.payload) as CandlestickFrozenStock;
      if (record.symbol !== row.symbol) throw new Error('invalid_v9_publication');
      rows.push(row); after = row.symbol;
    }
    if (records.length < 50) break;
  }
  await validateCandlestickPublication(metadata, rows);
  return { id: first.id, createdAt: first.created_at, metadata, rows, through: metadata.effectiveSessionDate,
    universeRevision: metadata.universeRevision, universeHash: metadata.universeHash, rowsHash: metadata.rowsHash };
}
