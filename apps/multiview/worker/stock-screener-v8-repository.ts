/** v8 使用獨立發布表；不改寫 v1–v7 snapshots/head。 */
import type { ScreenerDatabase } from './stock-screener-repository.ts';
import { validateCriteriaV8, type CriteriaV8, type BollingerOutcome, BOLLINGER_HISTORY_CAPABILITY,
  SCREENER_V8_FORMULA_VERSION, SCREENER_V8_MAPPING_VERSION, validBollingerMapping, type BollingerMappingVersion } from '../../../src/lib/stock-screener-v8.ts';
import { validBollingerSourceEvidence, type BollingerSourceEvidence } from '../../../src/lib/stock-screener-source-evidence.ts';
import { validateAndSealBollingerFrozenFeatures, type BollingerFrozenStock } from '../../../src/lib/stock-screener-bollinger-query.ts';
import { validBollingerDate, type BollingerReadiness } from '../../../src/lib/stock-screener-bollinger-source.ts';
import { technicalEvidenceHash, technicalEvidenceCanonicalJson } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { assessSourceComparison, BOLLINGER_SOURCE_COMPARISON_POLICY, BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY } from '../../../src/lib/stock-screener-source-comparison.ts';

export interface BollingerDailyProfile { revision: number; enabled: boolean; criteria: CriteriaV8; createdAt: string }
export interface BollingerPublishedStock extends BollingerFrozenStock {
  readiness: Array<{ sessionDate: string; reason: BollingerReadiness }>;
  dailyOutcome: BollingerOutcome;
}
export interface BollingerPublicationMetadata {
  version: 8; capability: typeof BOLLINGER_HISTORY_CAPABILITY;
  formulaVersion: typeof SCREENER_V8_FORMULA_VERSION; sourceMappingVersion: BollingerMappingVersion;
  sourceEvidence?: BollingerSourceEvidence;
  effectiveSessionDate: string; universeRevision: string; universeHash: string; authorityHash: string;
  profileRevision: number; criteriaFingerprint: string; historySessions: string[]; total: number;
  sourceHashes: string[]; rowsHash: string; counts: unknown; validThrough: string;
}
/** 本機 nodejs_compat：逐列核對同一 canonical SHA-256，不配置全市場約 250 MiB 字串及 UTF-8 副本。
 * 列數／列大小仍由讀取端限制；每次查詢重新核對，不能用 snapshot ID 快取略過驗證。
 */
export function bollingerPublicationRowsHash(rows: readonly BollingerPublishedStock[]): string {
  const hash = createHash('sha256');
  hash.update('[');
  for (let i = 0; i < rows.length; i++) {
    if (i) hash.update(',');
    hash.update(technicalEvidenceCanonicalJson(rows[i]), 'utf8');
  }
  return hash.update(']').digest('hex');
}
export async function bollingerPublicationSchemaReady(db: ScreenerDatabase) {
  const names = (await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN
    ('screener_bollinger_profiles','screener_bollinger_publications','screener_bollinger_rows','screener_bollinger_head','screener_bollinger_state')`)
    .all<{ name: string }>()).results ?? [];
  return names.length === 5;
}
export async function readBollingerDailyProfile(db: ScreenerDatabase): Promise<BollingerDailyProfile | null> {
  if (!await bollingerPublicationSchemaReady(db)) return null;
  const row = await db.prepare('SELECT revision,payload,created_at FROM screener_bollinger_profiles ORDER BY revision DESC LIMIT 1')
    .first<{ revision: number; payload: string; created_at: string }>();
  if (!row) return null;
  const p = JSON.parse(row.payload);
  if (!Number.isSafeInteger(row.revision) || row.revision < 1 || typeof p.enabled !== 'boolean' || !validateCriteriaV8(p.criteria)
    || p.enabled && !p.criteria.bollSqueezeStages.enabled || !Number.isFinite(Date.parse(row.created_at))) throw new Error('invalid_daily_profile');
  return { revision: row.revision, enabled: p.enabled, criteria: p.criteria, createdAt: row.created_at };
}
/** 明確使用者寫入、immutable revision/CAS；沒有來源準備／下載呼叫。 */
export async function saveBollingerDailyProfile(db: ScreenerDatabase, value: { expectedRevision: number; enabled: boolean; criteria: CriteriaV8 }, now = new Date()) {
  if (!value || Object.keys(value).sort().join() !== 'criteria,enabled,expectedRevision'
    || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || typeof value.enabled !== 'boolean'
    || !validateCriteriaV8(value.criteria) || value.enabled && !value.criteria.bollSqueezeStages.enabled) throw new Error('invalid_daily_profile');
  if (!await bollingerPublicationSchemaReady(db)) throw new Error('schema_pending');
  const revision = value.expectedRevision + 1;
  const writeId = crypto.randomUUID();
  await db.prepare(`INSERT INTO screener_bollinger_profiles(revision,payload,created_at)
    SELECT ?,?,? WHERE COALESCE((SELECT MAX(revision) FROM screener_bollinger_profiles),0)=? ON CONFLICT(revision) DO NOTHING`)
    .bind(revision, JSON.stringify({ enabled: value.enabled, criteria: value.criteria, writeId }), now.toISOString(), value.expectedRevision).run();
  const saved = await readBollingerDailyProfile(db);
  const receipt = await db.prepare('SELECT payload FROM screener_bollinger_profiles WHERE revision=?').bind(revision).first<{ payload: string }>();
  // CAS loser must not report another caller's new revision as its own success.
  if (saved?.revision !== revision || !receipt || JSON.parse(receipt.payload).writeId !== writeId)
    throw new Error('profile_revision_conflict');
  return saved;
}
export async function readBollingerPublication(db: ScreenerDatabase, id?: string) {
  if (!await bollingerPublicationSchemaReady(db)) return null;
  // metadata 含完整來源 manifest，不能 JOIN 到每個股票列重複傳輸。
  // 以 immutable publication ID 逐批讀取，避免單次 D1 回應突破字串／記憶體邊界。
  const first = await db.prepare(`SELECT id,metadata,created_at FROM screener_bollinger_publications
    WHERE status='published' AND id=${id ? '?' : "(SELECT snapshot_id FROM screener_bollinger_head WHERE name='v8')"}`)
    .bind(...(id ? [id] : [])).first<{ id: string; metadata: string; created_at: string }>();
  if (!first) return null;
  const metadata = JSON.parse(first.metadata) as BollingerPublicationMetadata;
  if (!Number.isSafeInteger(metadata.total) || metadata.total < 1 || metadata.total > 10000) throw new Error('invalid_v8_publication');
  const rows: BollingerPublishedStock[] = [];
  let after = '', bytes = 0;
  for (let page = 0; page <= 200; page++) {
    const records = (await db.prepare(`SELECT symbol,payload FROM screener_bollinger_rows
      WHERE snapshot_id=? AND symbol>? ORDER BY symbol LIMIT 50`).bind(first.id, after)
      .all<{ symbol: string; payload: string }>()).results ?? [];
    for (const record of records) {
      const size = Buffer.byteLength(record.payload, 'utf8');
      bytes += size;
      if (size > 512 * 1024 || bytes > 256 * 1024 * 1024 || record.symbol <= after || rows.length >= metadata.total)
        throw new Error('invalid_v8_publication');
      const row = JSON.parse(record.payload) as BollingerPublishedStock;
      if (row.symbol !== record.symbol) throw new Error('invalid_v8_publication');
      rows.push(row); after = record.symbol;
    }
    if (records.length < 50) break;
  }
  if (metadata.version !== 8 || metadata.capability !== BOLLINGER_HISTORY_CAPABILITY || metadata.formulaVersion !== SCREENER_V8_FORMULA_VERSION
    || !validBollingerMapping(metadata.sourceMappingVersion) || !validBollingerDate(metadata.effectiveSessionDate)
    || metadata.total !== rows.length || rows.length > 10000 || !rows.length || new Set(rows.map(r => r.symbol)).size !== rows.length
    || !Number.isSafeInteger(metadata.profileRevision) || metadata.profileRevision < 1
    || !Number.isFinite(Date.parse(metadata.validThrough)) || metadata.historySessions.at(-1) !== metadata.effectiveSessionDate)
    throw new Error('invalid_v8_publication');
  if (metadata.sourceMappingVersion !== SCREENER_V8_MAPPING_VERSION) {
    const proof = metadata.sourceEvidence;
    if (!proof || !validBollingerSourceEvidence(proof, metadata.sourceMappingVersion, metadata.historySessions)
      || proof.manifest.universeRevision !== metadata.universeRevision || proof.manifest.universeHash !== metadata.universeHash
      || await technicalEvidenceHash(proof.manifest) !== proof.manifestHash) throw new Error('invalid_v8_source_manifest');
    for (const selection of proof.selections) { const { manifestHash, ...body } = selection;
      if (await technicalEvidenceHash(body) !== manifestHash) throw new Error('invalid_v8_source_manifest'); }
    if (JSON.stringify([...new Set(proof.selections.map(s => s.payloadHash))].sort()) !== JSON.stringify(metadata.sourceHashes))
      throw new Error('invalid_v8_source_manifest');
  } else if (metadata.sourceEvidence) throw new Error('invalid_v8_source_manifest');
  for (const row of rows) if (!await validateAndSealBollingerFrozenFeatures(row.features)
    || row.features.sourceMappingVersion !== metadata.sourceMappingVersion
    || JSON.stringify(row.features.sessions) !== JSON.stringify(metadata.historySessions)) throw new Error('invalid_v8_publication');
  if (bollingerPublicationRowsHash(rows) !== metadata.rowsHash) throw new Error('invalid_v8_publication');
  return { id: first.id, createdAt: first.created_at, metadata, rows, universeRevision: metadata.universeRevision,
    effectiveSessionDate: metadata.effectiveSessionDate, historySessions: metadata.historySessions };
}

/** D1 每句最多 100 個 bound parameters；400 日雙市場必須分批，總回傳預算不放寬。 */
async function readSourceComparisonRecords(db: ScreenerDatabase, keys: string[], status: 'conflict' | 'matched') {
  const records: Array<{ id: string; selection_key: string; payload: string; created_at: string }> = [];
  for (let offset = 0; offset < keys.length; offset += 80) {
    const part = keys.slice(offset, offset + 80);
    records.push(...((await db.prepare(`SELECT id,selection_key,payload,created_at FROM screener_source_comparisons
      WHERE status=? AND selection_key IN (${part.map(() => '?').join(',')}) ORDER BY created_at,id LIMIT 801`)
      .bind(status, ...part).all<{ id: string; selection_key: string; payload: string; created_at: string }>()).results ?? []));
    if (records.length > 800) throw new Error('source_comparison_budget');
  }
  return records.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** 只追加的來源恢復比較不改 publication；查詢時唯讀揭露已知衝突。 */
export async function readBollingerSourceConflicts(db: ScreenerDatabase, proof?: BollingerSourceEvidence) {
  if (!proof) return [];
  const keys = new Map<string, BollingerSourceEvidence['selections'][number]>();
  for (const s of proof.selections) keys.set(await technicalEvidenceHash({ policyVersion: proof.manifest.policyVersion,
    universeRevision: proof.manifest.universeRevision, market: s.market, sessionDate: s.sessionDate }), s);
  const records = await readSourceComparisonRecords(db, [...keys.keys()], 'conflict');
  const conflicts = [];
  for (const r of records) {
    const p = JSON.parse(r.payload), selected = keys.get(r.selection_key)!;
    if (await technicalEvidenceHash(p) !== r.id || p.selectionKey !== r.selection_key
      || p.frozenManifestHash !== selected.manifestHash || !/^[a-f0-9]{64}$/.test(p.payloadHash)) throw new Error('invalid_source_comparison');
    conflicts.push({ id: r.id, market: selected.market, sessionDate: selected.sessionDate, provider: p.provider,
      frozenPayloadHash: selected.payloadHash, officialPayloadHash: p.payloadHash });
  }
  return conflicts;
}

/** 容差內的差異獨立揭露；不重新判定、刪除或隱藏舊 strict conflict。 */
export async function readBollingerSourceVolumeTolerances(db: ScreenerDatabase, proof?: BollingerSourceEvidence) {
  if (!proof) return [];
  const keys = new Map<string, BollingerSourceEvidence['selections'][number]>();
  for (const s of proof.selections) keys.set(await technicalEvidenceHash({ policyVersion: proof.manifest.policyVersion,
    universeRevision: proof.manifest.universeRevision, market: s.market, sessionDate: s.sessionDate }), s);
  const records = await readSourceComparisonRecords(db, [...keys.keys()], 'matched');
  const tolerated = [];
  for (const r of records) {
    const p = JSON.parse(r.payload), selected = keys.get(r.selection_key)!;
    if (await technicalEvidenceHash(p) !== r.id || p.selectionKey !== r.selection_key
      || p.frozenManifestHash !== selected.manifestHash || !/^[a-f0-9]{64}$/.test(p.payloadHash)) throw new Error('invalid_source_comparison');
    if (!p.comparisonPolicy) { // 舊 matched 必須仍為 exact；不能借新政策重解釋舊收據。
      if (!Array.isArray(p.differences) || p.differences.length) throw new Error('invalid_source_comparison');
      continue;
    }
    const amountPolicy=JSON.stringify(p.comparisonPolicy)===JSON.stringify(BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY);
    if (!amountPolicy && JSON.stringify(p.comparisonPolicy) !== JSON.stringify(BOLLINGER_SOURCE_COMPARISON_POLICY)
      || p.policyVersion !== proof.manifest.policyVersion || p.provider !== (selected.market === 'TWSE' ? 'official-twse' : 'official-tpex')
      || !Array.isArray(p.differences) || p.differences.length > selected.rowCount
      || new Set(p.differences.map((d: { symbol: string }) => d.symbol)).size !== p.differences.length) throw new Error('invalid_source_comparison');
    for (const d of p.differences) {
      const assessment = assessSourceComparison(d.frozen, d.official,p.comparisonPolicy);
      if (assessment.verdict !== (amountPolicy?'within_source_tolerance':'within_volume_tolerance') || d.verdict !== assessment.verdict
        || JSON.stringify(d.volumeDifferences) !== JSON.stringify(assessment.volumeDifferences)
        || amountPolicy&&JSON.stringify(d.turnoverDifferences)!==JSON.stringify(assessment.turnoverDifferences)) throw new Error('invalid_source_comparison');
    }
    if (p.differences.length) tolerated.push({ id: r.id, market: selected.market, sessionDate: selected.sessionDate, provider: p.provider,
      frozenPayloadHash: selected.payloadHash, officialPayloadHash: p.payloadHash,
      comparisonPolicyVersion: p.comparisonPolicy.version, volumeTolerancePercent: 1,
      ...(amountPolicy?{turnoverToleranceNtd:1}:{}),
      toleratedSymbols: p.differences.length,
      samples: p.differences.slice(0, 20).map((d: { symbol: string; volumeDifferences: unknown; turnoverDifferences?:unknown }) => ({ symbol: d.symbol,
        volumeDifferences: d.volumeDifferences,...(amountPolicy?{turnoverDifferences:d.turnoverDifferences}:{}) })) });
  }
  return tolerated;
}
