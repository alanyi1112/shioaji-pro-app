/** 背景建立的獨立 v7 技術底稿，沿用 screener_runs additive 儲存，不碰 v5–v7 發布 head。 */
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { buildTechnicalSnapshotEvidenceV7, SCREENER_V7_FORMULA_VERSION, type TechnicalSnapshotEvidenceV7 } from '../../../src/lib/stock-screener-v7.ts';
import { SCREENER_OHLCV_V4_MAPPING_VERSION, type CanonicalOhlcv } from '../../../src/lib/stock-screener-ohlcv.ts';
import { readScreenerV4Snapshot } from './stock-screener-v4-repository.ts';
import type { ScreenerDatabase } from './stock-screener-repository.ts';

const manifestScope = 'screener-v7-technical-manifest', rowScope = 'screener-v7-technical-feature';
const prefix = (id: string) => `v7-technical:${id}:`;
type Snapshot = NonNullable<Awaited<ReturnType<typeof readScreenerV4Snapshot>>>;
type Raw = { symbol: string; data_date: string; open: string; high: string; low: string; close: string; volume_shares: string };
type Coverage = Record<'TWSE' | 'TPEx', { target: number; covered: number; complete130: number; indicatorReady: number; indicatorWarmupUnknown: number; continuityUnknown: number }>;
type Manifest = { version: 1; sourceSnapshotId: string; universeRevision: string; through: string;
  formulaVersion: string; sourceMappingVersion: string; total: number; coverage: Coverage; rowsHash: string };

export async function readTechnicalV7Cache(db: ScreenerDatabase, snapshot: Snapshot) {
  const key = prefix(snapshot.id);
  const m = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=? AND scope=? AND status=\'complete\'')
    .bind(`${key}manifest`, manifestScope).first<{ checkpoint: string }>();
  if (!m) return null;
  const manifest = JSON.parse(m.checkpoint) as Manifest;
  if (manifest.version !== 1 || manifest.sourceSnapshotId !== snapshot.id || manifest.universeRevision !== snapshot.metadata.universeRevision
    || manifest.through !== snapshot.metadata.effectiveSessionDate || manifest.formulaVersion !== SCREENER_V7_FORMULA_VERSION
    || manifest.sourceMappingVersion !== SCREENER_OHLCV_V4_MAPPING_VERSION || manifest.total !== snapshot.inputs.length)
    throw new Error('invalid_v7_technical_cache');
  const entries: Array<{ symbol: string; feature: TechnicalSnapshotEvidenceV7 }> = [];
  let after = `${key}row:`;
  for (;;) {
    const page = (await db.prepare(`SELECT id,checkpoint FROM screener_runs WHERE scope=? AND status='complete'
      AND id>? AND id<? ORDER BY id LIMIT 100`).bind(rowScope, after, `${key}row:\uffff`)
      .all<{ id: string; checkpoint: string }>()).results ?? [];
    for (const r of page) {
      const v = JSON.parse(r.checkpoint);
      if (r.id !== `${key}row:${v.symbol}` || entries.length >= manifest.total) throw new Error('invalid_v7_technical_cache');
      const { evidenceHash, ...evidence } = v.feature;
      if (v.feature.through !== manifest.through || v.feature.formulaVersion !== SCREENER_V7_FORMULA_VERSION
        || v.feature.sourceMappingVersion !== manifest.sourceMappingVersion || await technicalEvidenceHash(evidence) !== evidenceHash)
        throw new Error('invalid_v7_technical_cache');
      entries.push(v);
    }
    if (page.length < 100) break;
    after = page.at(-1)!.id;
  }
  const allowed = new Set(snapshot.inputs.map(r => r.symbol));
  if (entries.length !== manifest.total || new Set(entries.map(r => r.symbol)).size !== entries.length
    || entries.some(r => !allowed.has(r.symbol)) || await technicalEvidenceHash(entries) !== manifest.rowsHash)
    throw new Error('invalid_v7_technical_cache');
  for (const market of ['TWSE','TPEx'] as const) {
    const c = manifest.coverage?.[market], target = snapshot.inputs.filter(r => r.market === market).length;
    if (!c || c.target !== target || c.covered !== target || !Number.isInteger(c.complete130)
      || c.complete130 < 0 || c.complete130 > target
      || [c.indicatorReady,c.indicatorWarmupUnknown,c.continuityUnknown].some(n => !Number.isInteger(n) || n < 0)
      || c.indicatorReady + c.indicatorWarmupUnknown + c.continuityUnknown !== target) throw new Error('invalid_v7_technical_cache');
  }
  return { manifest, features: new Map(entries.map(r => [r.symbol, r.feature])) };
}

/** 只能由既有背景 publisher 或明確的本機修復呼叫；GET 不可呼叫。 */
export async function prepareTechnicalV7Cache(db: ScreenerDatabase, id?: string, now = new Date()) {
  const snapshot = await readScreenerV4Snapshot(db, id);
  if (!snapshot) return { state: 'pending', reason: 'v4_preparation_pending' } as const;
  const existing = await readTechnicalV7Cache(db, snapshot);
  if (existing) return { state: 'unchanged', sourceSnapshotId: snapshot.id, rowsHash: existing.manifest.rowsHash } as const;
  if (snapshot.inputs.length > 10000) throw new Error('technical_query_budget_exceeded');
  const sessions = snapshot.metadata.technicalAnchors.sessions, through = snapshot.metadata.effectiveSessionDate;
  const bySymbol = new Map<string, Raw[]>();
  let total = 0, afterSymbol = '', afterDate = '';
  for (;;) {
    const page = (await db.prepare(`SELECT symbol,data_date,open,high,low,close,volume_shares
      FROM screener_daily_ohlcv INDEXED BY screener_daily_ohlcv_symbol_date_idx
      WHERE (symbol,data_date)>(?,?) AND data_date>=? AND data_date<=? AND validation='canonical-complete-v2'
      AND volume_unit='shares' AND volume_mapping_version=? ORDER BY symbol,data_date LIMIT 5000`)
      .bind(afterSymbol, afterDate, sessions[0]!, through, SCREENER_OHLCV_V4_MAPPING_VERSION).all<Raw>()).results ?? [];
    total += page.length;
    if (total > 130 * 10000) throw new Error('technical_query_budget_exceeded');
    for (const r of page) { const rows = bySymbol.get(r.symbol) ?? []; rows.push(r); bySymbol.set(r.symbol, rows); }
    if (page.length < 5000) break;
    afterSymbol = page.at(-1)!.symbol; afterDate = page.at(-1)!.data_date;
  }
  const coverage: Coverage = { TWSE: { target: 0, covered: 0, complete130: 0, indicatorReady: 0, indicatorWarmupUnknown: 0, continuityUnknown: 0 },
    TPEx: { target: 0, covered: 0, complete130: 0, indicatorReady: 0, indicatorWarmupUnknown: 0, continuityUnknown: 0 } };
  const entries = [];
  for (const input of snapshot.inputs) {
    const eligible = sessions.filter(d => !input.listingDate || d >= input.listingDate);
    const bars: CanonicalOhlcv[] = (bySymbol.get(input.symbol) ?? []).filter(r => eligible.includes(r.data_date))
      .map(r => ({ sessionDate: r.data_date, open: r.open, high: r.high, low: r.low, close: r.close, volumeShares: r.volume_shares }));
    bySymbol.delete(input.symbol);
    const feature = await buildTechnicalSnapshotEvidenceV7(bars, eligible, technicalEvidenceHash);
    const c = coverage[input.market]; c.target++; c.covered++;
    if (bars.length === 130) c.complete130++;
    if (feature.readinessReason !== 'none') c.continuityUnknown++;
    else if (bars.length >= 35) c.indicatorReady++; else c.indicatorWarmupUnknown++;
    entries.push({ symbol: input.symbol, feature });
  }
  entries.sort((a, b) => a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  const key = prefix(snapshot.id), timestamp = now.toISOString();
  const put = (id: string, scope: string, checkpoint: string) => db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
    VALUES(?,?,'complete',?,?) ON CONFLICT(id) DO NOTHING`).bind(id, scope, checkpoint, timestamp);
  for (let offset = 0; offset < entries.length; offset += 50) await db.batch(entries.slice(offset, offset + 50)
    .map(v => put(`${key}row:${v.symbol}`, rowScope, JSON.stringify(v))));
  const manifest: Manifest = { version: 1, sourceSnapshotId: snapshot.id, universeRevision: snapshot.metadata.universeRevision, through,
    formulaVersion: SCREENER_V7_FORMULA_VERSION, sourceMappingVersion: SCREENER_OHLCV_V4_MAPPING_VERSION,
    total: entries.length, coverage, rowsHash: await technicalEvidenceHash(entries) };
  // 頁列先完整寫入；完整 hash／列數重驗後才可被 GET 視為已準備。
  await put(`${key}manifest`, manifestScope, JSON.stringify(manifest)).run();
  const verified = await readTechnicalV7Cache(db, snapshot);
  if (!verified || verified.manifest.rowsHash !== manifest.rowsHash) throw new Error('invalid_v7_technical_cache');
  const retained = (await db.prepare("SELECT id FROM screener_snapshots WHERE schema_version=4 AND status='published' ORDER BY created_at DESC,id DESC LIMIT 2")
    .all<{ id: string }>()).results ?? [];
  if (retained.length) await db.prepare(`DELETE FROM screener_runs WHERE scope IN (?,?) AND ${retained.map(() => 'id NOT LIKE ?').join(' AND ')}`)
    .bind(manifestScope, rowScope, ...retained.map(r => `${prefix(r.id)}%`)).run();
  return { state: 'published', sourceSnapshotId: snapshot.id, rowsHash: manifest.rowsHash, total: entries.length } as const;
}
