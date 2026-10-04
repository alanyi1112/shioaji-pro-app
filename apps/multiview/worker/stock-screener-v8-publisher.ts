/** 背景發布入口，僅讀已驗證新 history；不抓來源、不依賴籌碼 head。 */
import type { ScreenerDatabase } from './stock-screener-repository.ts';
import { bollingerPublicationSchemaReady, readBollingerDailyProfile, readBollingerPublication, type BollingerPublicationMetadata,
  type BollingerPublishedStock } from './stock-screener-v8-repository.ts';
import { planBollingerHistory, type VerifiedBollingerCalendar } from '../../../src/lib/stock-screener-bollinger-history.ts';
import { bollingerUniverseHash, projectBollingerReport, validateBollingerSourceReview, bollingerSourceUrl,
  type BollingerOfficialReport, type BollingerSourceReview, type BollingerUniverseStock } from '../../../src/lib/stock-screener-bollinger-source.ts';
import { buildBollingerFrozenFeatures, evaluateBollingerStages, countBollingerStages, BOLLINGER_HISTORY_CAPABILITY,
  SCREENER_V8_FORMULA_VERSION, SCREENER_V8_MAPPING_VERSION, bollingerCriteriaFingerprint } from '../../../src/lib/stock-screener-v8.ts';
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import { readSourceSelection, sourceWindowMapping } from '../../../scripts/stock-screener-source-selection.mjs';
import type { BollingerSourceEvidence } from '../../../src/lib/stock-screener-source-evidence.ts';
import type { BollingerMappingVersion } from '../../../src/lib/stock-screener-v8.ts';

export interface BollingerPublishOptions {
  db: ScreenerDatabase; through: string; calendar: VerifiedBollingerCalendar; universeRevision: string;
  universe: BollingerUniverseStock[]; universeEvidence: { status: 'verified'; hash: string; ordinary: true };
  reviews: Record<'TWSE' | 'TPEx', BollingerSourceReview>; now?: () => Date; trigger: 'manual' | 'watcher' | 'late-boot'; maxDurationMs?: number;
  useSourceSelections?: boolean;
}
export async function publishBollingerDaily(options: BollingerPublishOptions) {
  const { db, through, calendar, universeRevision, universe, reviews, trigger } = options;
  const now = options.now ?? (() => new Date()), started = now(), at = started.toISOString();
  if (!await bollingerPublicationSchemaReady(db)) return { state: 'pending', reason: 'schema_pending' };
  const profile = await readBollingerDailyProfile(db);
  if (!profile?.enabled) return { state: 'skipped', reason: 'profile_disabled' };
  if (options.useSourceSelections) {
    const immutable = await db.prepare(`SELECT id FROM screener_bollinger_publications WHERE status='published'
      AND json_extract(metadata,'$.effectiveSessionDate')=? AND json_extract(metadata,'$.universeRevision')=?
      AND json_extract(metadata,'$.universeHash')=? AND json_extract(metadata,'$.profileRevision')=?
      AND json_extract(metadata,'$.sourceMappingVersion') LIKE 'bollinger-source-selection-v1:%' ORDER BY created_at DESC,id LIMIT 1`)
      .bind(through, universeRevision, await bollingerUniverseHash(universe), profile.revision).first<{ id: string }>();
    if (immutable) {
      const frozen = await readBollingerPublication(db, immutable.id);
      if (!frozen) throw new Error('invalid_v8_publication');
      return { state: 'unchanged', snapshotId: frozen.id, profileRevision: profile.revision };
    }
  }
  const plan = planBollingerHistory(calendar, through, profile.criteria.bollSqueezeStages, String(profile.revision), started);
  const universeHash = await bollingerUniverseHash(universe);
  let sourceEvidence: BollingerSourceEvidence | undefined, mapping: BollingerMappingVersion = SCREENER_V8_MAPPING_VERSION;
  if (options.useSourceSelections) {
    if (plan.state !== 'planned') return { state: 'pending', reason: 'history_pending', plan };
    let window;
    try { window = await sourceWindowMapping(db, { universeRevision, universeHash, sessions: plan.sessions }); }
    catch (e) { if (e instanceof Error && e.message === 'source_selection_pending') return { state: 'pending', reason: e.message }; throw e; }
    mapping = window.dataMappingVersion as BollingerMappingVersion;
    const selections = [];
    for (const entry of window.manifest.entries) {
      const key = await technicalEvidenceHash({ policyVersion: window.manifest.policyVersion, universeRevision, market: entry.market, sessionDate: entry.sessionDate });
      selections.push((await readSourceSelection(db, key))!.manifest);
    }
    sourceEvidence = { manifest: window.manifest, manifestHash: window.manifestHash, selections };
  }
  const key = JSON.stringify([through, universeRevision, mapping, SCREENER_V8_FORMULA_VERSION, profile.revision]);
  const priorKey = await db.prepare('SELECT id,status FROM screener_bollinger_publications WHERE publication_key=?').bind(key)
    .first<{ id: string; status: string }>();
  // 同鍵成功 fast path 必須先於來源 Gate、全資料讀取、指標重算及租約寫入。
  if (priorKey?.status === 'published') return { state: 'unchanged', snapshotId: priorKey.id, profileRevision: profile.revision };
  if (!universeRevision || options.universeEvidence?.status !== 'verified' || !options.universeEvidence.ordinary
    || options.universeEvidence.hash !== universeHash) return { state: 'pending', reason: 'universe_contract_pending' };
  if (!options.useSourceSelections && !(['TWSE', 'TPEx'] as const).every(m => validateBollingerSourceReview(reviews?.[m], m, started)))
    return { state: 'pending', reason: 'source_contract_pending' };
  if (plan.state !== 'planned') return { state: 'pending', reason: 'history_pending', plan };
  const maxDurationMs = options.maxDurationMs ?? 15 * 60000;
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 15 * 60000) throw new Error('invalid_bollinger_budget');
  const owner = crypto.randomUUID(), runId = crypto.randomUUID(), deadline = started.getTime() + maxDurationMs;
  await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,lease_until,updated_at)
    VALUES('screener-bollinger-lease','screener-bollinger-lease','running',?,?,?) ON CONFLICT(id) DO UPDATE SET
    status='running',checkpoint=excluded.checkpoint,lease_until=excluded.lease_until,updated_at=excluded.updated_at
    WHERE screener_runs.lease_until IS NULL OR screener_runs.lease_until<=?`)
    .bind(owner, new Date(deadline).toISOString(), at, at).run();
  const owned = async () => {
    const r = await db.prepare("SELECT checkpoint,lease_until FROM screener_runs WHERE id='screener-bollinger-lease'")
      .first<{ checkpoint: string; lease_until: string }>();
    return r?.checkpoint === owner && Date.parse(r.lease_until) > now().getTime();
  };
  if (!await owned()) return { state: 'skipped', reason: 'lease_busy' };
  const guard = async () => { if (now().getTime() >= deadline) throw new Error('run_deadline');
    if (!await owned()) throw new Error('lease_lost'); };
  const receipt = (status: string, payload: object) => db.prepare(`INSERT INTO screener_bollinger_receipts(id,target_key,run_id,status,payload,created_at) VALUES(?,NULL,?,?,?,?)`)
    .bind(crypto.randomUUID(), runId, status, JSON.stringify({ publicationKey: key, trigger, through, profileRevision: profile.revision, ...payload }), now().toISOString()).run();
  await receipt('publication_started', { startedAt: at });
  try {
    const expected: ReturnType<typeof projectBollingerReport> = [], hashes: string[] = [];
    for (const target of plan.targets) {
      await guard();
      if (sourceEvidence) {
        const selectionKey = await technicalEvidenceHash({ policyVersion: sourceEvidence.manifest.policyVersion, universeRevision,
          market: target.market, sessionDate: target.sessionDate });
        const selection = await readSourceSelection(db, selectionKey);
        if (!selection || selection.manifest.universeHash !== universeHash) throw new Error('invalid_history_provenance');
        expected.push(...selection.rows); hashes.push(selection.manifest.payloadHash); continue;
      }
      const batch = await db.prepare('SELECT status,report FROM screener_bollinger_batches WHERE target_key=?').bind(target.key)
        .first<{ status: string; report: string | null }>();
      if (batch?.status !== 'complete' || !batch.report) {
        await receipt('publication_partial', { reason: 'history_pending', target: target.key });
        return { state: 'pending', reason: 'history_pending', plan };
      }
      const saved = JSON.parse(batch.report) as { report: BollingerOfficialReport; hash: string };
      const report = saved.report;
      if (!report || await technicalEvidenceHash(report) !== saved.hash) throw new Error('invalid_history_provenance');
      if (report.market !== target.market || report.sessionDate !== target.sessionDate || report.mappingVersion !== SCREENER_V8_MAPPING_VERSION
        || report.reviewHash !== reviews[target.market].evidenceHash || report.sourceUrl !== bollingerSourceUrl(target.market, target.sessionDate)
        || report.volumeUnit !== 'shares' || report.turnoverUnit !== 'TWD' || !/^[a-f0-9]{64}$/.test(report.payloadHash)) throw new Error('invalid_history_provenance');
      const projected = projectBollingerReport(report, universe);
      const stored = (await db.prepare('SELECT symbol,payload FROM screener_bollinger_daily WHERE universe_revision=? AND session_date=? AND market=?')
        .bind(universeRevision, target.sessionDate, target.market).all<{ symbol: string; payload: string }>()).results ?? [];
      const map = new Map(stored.map(r => [r.symbol, r.payload]));
      if (map.size !== projected.length || stored.length !== projected.length || projected.some(r => map.get(r.symbol) !== JSON.stringify(r)))
        throw new Error('invalid_history_projection');
      expected.push(...projected); hashes.push(report.payloadHash);
    }
    const head = await db.prepare("SELECT snapshot_id FROM screener_bollinger_head WHERE name='v8'").first<{ snapshot_id: string }>();
    const previous = head ? await db.prepare('SELECT metadata FROM screener_bollinger_publications WHERE id=?').bind(head.snapshot_id)
      .first<{ metadata: string }>() : null;
    if (previous && JSON.parse(previous.metadata).effectiveSessionDate > through) throw new Error('snapshot_regression');
    // 相同日期／母體／窗口只引用已凍結指標；不同每日參數不重新計算 BOLL。
    const reusable = await db.prepare(`SELECT id FROM screener_bollinger_publications WHERE status='published'
      AND json_extract(metadata,'$.effectiveSessionDate')=? AND json_extract(metadata,'$.universeRevision')=?
      AND json_extract(metadata,'$.universeHash')=? AND json_extract(metadata,'$.formulaVersion')=?
      AND json_extract(metadata,'$.sourceMappingVersion')=? AND json_extract(metadata,'$.historySessions')=?
      AND json_extract(metadata,'$.sourceHashes')=? ORDER BY created_at DESC,id DESC LIMIT 1`)
      .bind(through, universeRevision, universeHash, SCREENER_V8_FORMULA_VERSION, mapping,
        JSON.stringify(plan.sessions), JSON.stringify([...new Set(hashes)].sort())).first<{ id: string }>();
    const reuse = new Map<string, BollingerPublishedStock>();
    // 先驗 immutable rowsHash／feature hash；不能把被修改的旧底稿帶入新 revision。
    if (reusable) for (const row of (await readBollingerPublication(db, reusable.id))!.rows) reuse.set(row.symbol, row);
    const rows: BollingerPublishedStock[] = [];
    // 建索引避免全市場逐檔掃描全部 160 日投影。
    const bySymbol = new Map<string, ReturnType<typeof projectBollingerReport>>();
    for (const p of expected) { const bucket = bySymbol.get(p.symbol) ?? []; bucket.push(p); bySymbol.set(p.symbol, bucket); }
    for (const stock of [...universe].sort((a, b) => a.symbol < b.symbol ? -1 : 1)) {
      await guard();
      const daily = bySymbol.get(stock.symbol) ?? [];
      const features = reuse.get(stock.symbol)?.features ?? await buildBollingerFrozenFeatures(daily.flatMap(r => r.bar ? [r.bar] : []), plan.sessions, hashes, mapping);
      rows.push({ symbol: stock.symbol, code: stock.code, name: stock.name, market: stock.market, ordinary: true, features,
        readiness: daily.map(r => ({ sessionDate: r.sessionDate, reason: r.readiness })).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)),
        dailyOutcome: await evaluateBollingerStages(features, profile.criteria.bollSqueezeStages, true) });
    }
    const counts = countBollingerStages(rows.map(r => ({ market: r.market, stage: r.dailyOutcome.stage })));
    const metadata: BollingerPublicationMetadata = { version: 8, capability: BOLLINGER_HISTORY_CAPABILITY,
      formulaVersion: SCREENER_V8_FORMULA_VERSION, sourceMappingVersion: mapping,
      effectiveSessionDate: through, universeRevision, universeHash, authorityHash: calendar.authorityHash,
      profileRevision: profile.revision, criteriaFingerprint: bollingerCriteriaFingerprint(profile.criteria.bollSqueezeStages),
      historySessions: plan.sessions, sourceHashes: [...new Set(hashes)].sort(), total: rows.length,
      rowsHash: await technicalEvidenceHash(rows), counts, validThrough: calendar.validThrough, ...(sourceEvidence ? { sourceEvidence } : {}) };
    const payloads = rows.map(r => JSON.stringify(r));
    if (payloads.some(p => new TextEncoder().encode(p).byteLength > 512 * 1024)
      || payloads.reduce((n, p) => n + new TextEncoder().encode(p).byteLength, 0) > 256 * 1024 * 1024) throw new Error('publication_budget_exceeded');
    await guard();
    const id = priorKey?.id ?? crypto.randomUUID();
    await db.prepare(`INSERT INTO screener_bollinger_publications(id,publication_key,status,metadata,created_at)
      VALUES(?,?,'staging',?,?) ON CONFLICT(publication_key) DO NOTHING`).bind(id, key, JSON.stringify(metadata), at).run();
    const staged = await db.prepare('SELECT metadata FROM screener_bollinger_publications WHERE id=?').bind(id).first<{ metadata: string }>();
    if (!staged || staged.metadata !== JSON.stringify(metadata)) throw new Error('publication_staging_conflict');
    for (let offset = 0; offset < rows.length; offset += 50) {
      await guard();
      await db.batch(rows.slice(offset, offset + 50).map((r, index) => db.prepare(`INSERT INTO screener_bollinger_rows(snapshot_id,symbol,payload)
        SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM screener_runs WHERE id='screener-bollinger-lease' AND checkpoint=? AND lease_until>?)
        ON CONFLICT(snapshot_id,symbol) DO NOTHING`).bind(id, r.symbol, payloads[offset + index]!, owner, now().toISOString())));
    }
    const frozen = (await db.prepare('SELECT payload FROM screener_bollinger_rows WHERE snapshot_id=? ORDER BY symbol').bind(id)
      .all<{ payload: string }>()).results ?? [];
    if (frozen.length !== rows.length || await technicalEvidenceHash(frozen.map(r => JSON.parse(r.payload))) !== metadata.rowsHash)
      throw new Error('publication_staging_conflict');
    await guard();
    await db.batch([
      db.prepare(`UPDATE screener_bollinger_publications SET status='published' WHERE id=? AND status='staging'
        AND COALESCE((SELECT snapshot_id FROM screener_bollinger_head WHERE name='v8'),'')=?
        AND (SELECT MAX(revision) FROM screener_bollinger_profiles)=?
        AND EXISTS(SELECT 1 FROM screener_runs WHERE id='screener-bollinger-lease' AND checkpoint=? AND lease_until>?)`)
        .bind(id, head?.snapshot_id ?? '', profile.revision, owner, now().toISOString()),
      db.prepare(`INSERT INTO screener_bollinger_head(name,snapshot_id,updated_at) SELECT 'v8',?,?
        WHERE EXISTS(SELECT 1 FROM screener_bollinger_publications WHERE id=? AND status='published')
        ON CONFLICT(name) DO UPDATE SET snapshot_id=excluded.snapshot_id,updated_at=excluded.updated_at`).bind(id, now().toISOString(), id),
      db.prepare(`INSERT INTO screener_bollinger_receipts(id,target_key,run_id,status,payload,created_at)
        SELECT ?,NULL,?,'publication_complete',?,? WHERE EXISTS(SELECT 1 FROM screener_bollinger_publications WHERE id=? AND status='published')`)
        .bind(crypto.randomUUID(), runId, JSON.stringify({ publicationKey: key, trigger, through, profileRevision: profile.revision,
          snapshotId: id, counts, rows: rows.length, finishedAt: now().toISOString() }), now().toISOString(), id),
    ]);
    const success = await db.prepare('SELECT status FROM screener_bollinger_publications WHERE id=?').bind(id).first<{ status: string }>();
    if (success?.status !== 'published') throw new Error('publication_conflict');
    return { state: 'published', snapshotId: id, profileRevision: profile.revision, counts };
  } catch (e) {
    await receipt('publication_failed', { reason: e instanceof Error ? e.message : 'publication_failed' });
    throw e;
  } finally {
    await db.prepare("UPDATE screener_runs SET status='released',lease_until=NULL WHERE id='screener-bollinger-lease' AND checkpoint=?").bind(owner).run();
  }
}
