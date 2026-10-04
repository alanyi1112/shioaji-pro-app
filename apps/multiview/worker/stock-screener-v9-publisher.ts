/** 背景限定：從已驗證完整來源發布獨立短窗，無 fetch、login 或 subscription。 */
import type { ScreenerDatabase } from './stock-screener-repository.ts';
import { candlestickRowsHash, candlestickSchemaReady, readCandlestickPublication, validateCandlestickPublication,
  type CandlestickMetadata } from './stock-screener-v9-repository.ts';
import { readSourceSelection, sourceSelectionSchemaReady, readSourceReview, SOURCE_POLICY_VERSION } from '../../../scripts/stock-screener-source-selection.mjs';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { buildCandlestickHistory } from '../../../src/lib/stock-screener-candlestick.ts';
import type { CandlestickFrozenStock } from '../../../src/lib/stock-screener-candlestick-query.ts';
import { CANDLESTICK_FORMULA_VERSION, CANDLESTICK_HISTORY_CAPABILITY } from '../../../src/lib/stock-screener-v9.ts';
import { SCREENER_PRICE_BASIS } from '../../../src/lib/stock-screener-ohlcv.ts';
import { bollingerUniverseHash, type BollingerUniverseStock } from '../../../src/lib/stock-screener-bollinger-source.ts';
import type { VerifiedBollingerCalendar } from '../../../src/lib/stock-screener-bollinger-history.ts';
import type { BollingerSourceEvidence } from '../../../src/lib/stock-screener-source-evidence.ts';
import { Buffer } from 'node:buffer';

export async function publishCandlestickHistory(o: { db: ScreenerDatabase; calendar: VerifiedBollingerCalendar;
  through: string; universeRevision: string; universe: BollingerUniverseStock[]; universeHash: string; now?: () => Date }) {
  const { db, calendar, through, universeRevision, universe, universeHash } = o, now = o.now ?? (() => new Date());
  const deadline = now().getTime() + 5 * 60000;
  if (!await candlestickSchemaReady(db) || !await sourceSelectionSchemaReady(db)) return { state: 'pending', reason: 'v9_schema_pending' };
  if (calendar.status !== 'verified' || !/^[a-f0-9]{64}$/.test(calendar.authorityHash) || Date.parse(calendar.validThrough) <= now().getTime()
    || !Number.isFinite(Date.parse(calendar.validThrough)) || !calendar.commonSessions.includes(through)
    || Date.parse(`${through}T14:00:00+08:00`) > now().getTime() || await bollingerUniverseHash(universe) !== universeHash)
    throw new Error('v9_authority_pending');
  const sessions = calendar.commonSessions.filter(d => d <= through).slice(-64);
  if (!sessions.length || sessions.some((d, i) => i > 0 && d <= sessions[i - 1]!)) throw new Error('invalid_v9_calendar');
  const selections: BollingerSourceEvidence['selections'] = [], projections = new Map<string, Map<string, any>>();
  const reviews = new Map<string, Awaited<ReturnType<typeof readSourceReview>>>();
  for (const sessionDate of sessions) for (const market of ['TWSE', 'TPEx'] as const) {
    if (now().getTime() >= deadline) throw new Error('v9_run_deadline');
    const key = await technicalEvidenceHash({ policyVersion: SOURCE_POLICY_VERSION, universeRevision, market, sessionDate });
    const s = await readSourceSelection(db, key);
    if (!s) return { state: 'pending', reason: 'full_ohlcv_source_pending' };
    if (s.manifest.universeHash !== universeHash) throw new Error('invalid_v9_universe');
    if (!reviews.has(s.manifest.reviewId)) reviews.set(s.manifest.reviewId, await readSourceReview(db, s.manifest.reviewId, now()));
    const review = reviews.get(s.manifest.reviewId)!;
    if (review.review.status !== 'verified' || review.review.priceBasis !== 'unadjusted' || review.provider !== s.manifest.provider
      || review.review.evidenceHash !== s.manifest.reviewHash || review.review.mappingVersion !== s.manifest.mappingVersion)
      throw new Error('v9_price_basis_pending');
    if (s.rows.length !== universe.filter(r => r.market === market).length || s.rows.some((r: any) => !universe.some(u => u.symbol === r.symbol && u.market === market)))
      throw new Error('invalid_v9_universe');
    selections.push(s.manifest);
    for (const r of s.rows) {
      if (r.bar && ['open', 'high', 'low', 'close'].some(k => !Object.hasOwn(r.bar, k))) throw new Error('v9_full_ohlc_capability_missing');
      const grid = projections.get(r.symbol) ?? new Map(); grid.set(sessionDate, r); projections.set(r.symbol, grid);
    }
  }
  const manifest = { policyVersion: SOURCE_POLICY_VERSION, universeRevision, universeHash,
    entries: selections.map(s => ({ sessionDate: s.sessionDate, market: s.market, manifestHash: s.manifestHash })) };
  const manifestHash = await technicalEvidenceHash(manifest), sourceMappingVersion = `${SOURCE_POLICY_VERSION}:${manifestHash}`;
  const sourceEvidence: BollingerSourceEvidence = { manifest, manifestHash, selections };
  const sourceHashes = [...new Set(selections.map(s => s.payloadHash))].sort();
  const key = await technicalEvidenceHash({ through, universeRevision, universeHash, formula: CANDLESTICK_FORMULA_VERSION,
    capability: CANDLESTICK_HISTORY_CAPABILITY, sourceMappingVersion, calendarHash: calendar.authorityHash, sourceHashes });
  const existing = await db.prepare("SELECT id FROM screener_candlestick_publications WHERE publication_key=? AND status='published' ORDER BY created_at,id LIMIT 1")
    .bind(key).first<{ id: string }>();
  if (existing) { await readCandlestickPublication(db, existing.id); return { state: 'unchanged', snapshotId: existing.id }; }
  const owner = crypto.randomUUID(), id = crypto.randomUUID(), lease = 'screener-candlestick-lease';
  await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at) VALUES(?,'candlestick-publish','running',?,?,?)
    ON CONFLICT(id) DO UPDATE SET status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at
    WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until<=?`)
    .bind(lease, owner, new Date(deadline).toISOString(), now().toISOString(), now().toISOString()).run();
  const guard = async () => {
    const r = await db.prepare('SELECT checkpoint,lease_until FROM screener_runs WHERE id=?').bind(lease).first<{ checkpoint: string; lease_until: string }>();
    if (r?.checkpoint !== owner || Date.parse(r.lease_until) <= now().getTime() || now().getTime() >= deadline) throw new Error('v9_lease_lost');
  };
  try { await guard(); } catch { return { state: 'pending', reason: 'v9_lease_busy' }; }
  const receipt = (status: string, payload: object) => db.prepare(`INSERT INTO screener_candlestick_receipts(id,run_id,status,payload,created_at) VALUES(?,?,?,?,?)`)
    .bind(crypto.randomUUID(), id, status, JSON.stringify({ sourceRequests: 0, publicationKey: key, ...payload }), now().toISOString());
  let staged = false;
  try {
    const winner = await db.prepare("SELECT id FROM screener_candlestick_publications WHERE publication_key=? AND status='published' ORDER BY created_at,id LIMIT 1")
      .bind(key).first<{ id: string }>();
    if (winner) { await readCandlestickPublication(db, winner.id); return { state: 'unchanged', snapshotId: winner.id }; }
    const prior = await db.prepare("SELECT snapshot_id FROM screener_candlestick_head WHERE name='v9'").first<{ snapshot_id: string }>();
    const old = prior ? await readCandlestickPublication(db, prior.snapshot_id) : null;
    if (old && old.through > through) throw new Error('v9_date_regression');
    const rows: CandlestickFrozenStock[] = [];
    for (const u of [...universe].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      await guard();
      const grid = projections.get(u.symbol)!;
      const bars = sessions.flatMap(d => { const r = grid.get(d); return r?.bar ? [r.bar] : []; });
      const base = await buildCandlestickHistory(bars, sessions, { mappingVersion: sourceMappingVersion, calendarHash: calendar.authorityHash,
        sourceHashes, completedThrough: through, incomparableSessions: sessions.filter(d => grid.get(d)?.provenance?.priceComparable === false) });
      // 缺口保存真實來源理由，不造棒；已有 OHLC 但缺量仍可做純價格型態。
      const { evidenceHash: _, ...body } = base;
      const points = base.points.map(p => ({ ...p, reason: p.bar || grid.get(p.sessionDate)?.bar ? p.reason
        : grid.get(p.sessionDate)?.readiness ?? 'source_missing' }));
      const value = { ...body, points };
      rows.push({ symbol: u.symbol, code: u.code, name: u.name, market: u.market, ordinary: true,
        history: { ...value, evidenceHash: await technicalEvidenceHash(value) } });
    }
    const metadata: CandlestickMetadata = { version: 9, formulaVersion: CANDLESTICK_FORMULA_VERSION, capability: CANDLESTICK_HISTORY_CAPABILITY,
      priceBasis: SCREENER_PRICE_BASIS, sourceMappingVersion, calendarHash: calendar.authorityHash, sourceEvidence, sourceHashes,
      effectiveSessionDate: through, universeRevision, universeHash, historySessions: sessions, rowsHash: candlestickRowsHash(rows),
      total: rows.length, validThrough: new Date(Math.min(Date.parse(calendar.validThrough),
        Date.parse(`${calendar.commonSessions.find(d => d > through) ?? through}T14:00:00+08:00`))).toISOString() };
    if (Date.parse(metadata.validThrough) <= now().getTime()) throw new Error('v9_calendar_coverage_pending');
    await validateCandlestickPublication(metadata, rows);
    const payloads = rows.map(r => JSON.stringify(r));
    if (payloads.some(p => Buffer.byteLength(p) > 128 * 1024) || payloads.reduce((n, p) => n + Buffer.byteLength(p), 0) > 128 * 1024 * 1024)
      throw new Error('v9_publication_budget');
    await guard();
    await db.prepare("INSERT INTO screener_candlestick_publications(id,publication_key,status,metadata,created_at) VALUES(?,?,'staging',?,?)")
      .bind(id, key, JSON.stringify(metadata), now().toISOString()).run(); staged = true;
    for (let offset = 0; offset < rows.length; offset += 50) {
      await guard();
      await db.batch(rows.slice(offset, offset + 50).map((r, i) => db.prepare('INSERT INTO screener_candlestick_rows(snapshot_id,symbol,payload) VALUES(?,?,?)')
        .bind(id, r.symbol, payloads[offset + i]!)));
    }
    await guard();
    if (!await readCandlestickPublication(db, id, true)) throw new Error('invalid_v9_staging');
    await guard();
    await db.batch([
      db.prepare(`UPDATE screener_candlestick_publications SET status='published' WHERE id=? AND status='staging'
        AND (SELECT COUNT(*) FROM screener_candlestick_rows WHERE snapshot_id=?)=?
        AND COALESCE((SELECT snapshot_id FROM screener_candlestick_head WHERE name='v9'),'')=?
        AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND checkpoint=? AND lease_until>?)`)
        .bind(id, id, rows.length, prior?.snapshot_id ?? '', lease, owner, now().toISOString()),
      db.prepare(`INSERT INTO screener_candlestick_head(name,snapshot_id,updated_at)
        SELECT 'v9',id,? FROM screener_candlestick_publications WHERE id=? AND status='published'
        ON CONFLICT(name) DO UPDATE SET snapshot_id=excluded.snapshot_id,updated_at=excluded.updated_at`)
        .bind(now().toISOString(), id),
      db.prepare(`INSERT INTO screener_candlestick_receipts(id,run_id,status,payload,created_at)
        SELECT ?,?,'published',?,? WHERE EXISTS(SELECT 1 FROM screener_candlestick_publications WHERE id=? AND status='published')`)
        .bind(crypto.randomUUID(), id, JSON.stringify({ sourceRequests: 0, publicationKey: key, rowsHash: metadata.rowsHash, total: rows.length }), now().toISOString(), id),
    ]);
    if (!await readCandlestickPublication(db, id)) throw new Error('v9_head_conflict');
    return { state: 'published', snapshotId: id };
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'v9_publication_failed';
    await db.batch([...(staged ? [db.prepare("UPDATE screener_candlestick_publications SET status='failed' WHERE id=? AND status='staging'").bind(id)] : []), receipt('failed', { reason })]);
    throw error;
  } finally { await db.prepare("UPDATE screener_runs SET status='idle',lease_until=NULL WHERE id=? AND checkpoint=?").bind(lease, owner).run(); }
}
