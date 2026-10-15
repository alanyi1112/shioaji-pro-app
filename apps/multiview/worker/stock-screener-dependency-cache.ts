/** 條件專用不可變底稿；不占用完整 v5/v6/v7 head，不改原排程或下載 Gate。 */
import { technicalEvidenceHash } from '../../../src/lib/stock-screener-technical-patterns.ts';
import type { CriteriaV7, ScreenerInputV7 } from '../../../src/lib/stock-screener-v7.ts';
import { buildScreenerV5Evidence } from './stock-screener-v5-publisher.ts';
import { buildScreenerV6Evidence } from './stock-screener-v6-publisher.ts';
import { readScreenerV4Snapshot } from './stock-screener-v4-repository.ts';
import { readTechnicalV7Cache } from './stock-screener-v7-technical-cache.ts';
import type { ScreenerDatabase } from './stock-screener-repository.ts';

const scope = 'screener-condition-dependencies-v1', headId = `${scope}:head`;
const rowId = (id: string, symbol: string) => `${scope}:${id}:row:${symbol}`;
const manifestId = (id: string) => `${scope}:${id}:manifest`;
type BuiltV6 = Extract<Awaited<ReturnType<typeof buildScreenerV6Evidence>>, { state: 'prepared' }>;
type Row = Pick<ScreenerInputV7, 'symbol' | 'chipV5' | 'institutionalV6'>;
type Manifest = { version: 1; id: string; sourceSnapshotId: string; universeRevision: string; createdAt: string;
  through: string; total: number; rowsHash: string; verifiedKeys: string[]; institutionalKeys: string[];
  metadata: BuiltV6['metadata']; digest: string };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** 只有啟用分支取得依賴；籌碼日期不可用純技術或另一來源的日期代替。 */
export function screenerConditionDependencies(c: Partial<CriteriaV7>, sessions: string[]) {
  const required = new Set<string>();
  const add = (dataset: string, count: number) => {
    for (const day of sessions.slice(-count)) for (const market of ['TWSE', 'TPEx']) required.add(`${day}|${market}|${dataset}`);
  };
  if (c.trustOwnership?.enabled) add('institutional-flow', c.trustOwnership.days);
  if (c.priceMargin?.enabled) add('margin-short', c.priceMargin.days + 1);
  if (c.shortMarginRatio?.enabled) add('margin-short', 1);
  for (const key of ['foreignReversal', 'trustReversal'] as const) if (c[key]?.enabled) {
    // 法人序列最多 21 日；價格／量能長窗口由該分支自身逐檔回報 unknown。
    add('institutional-v2', Math.min(21, Math.max(c[key].sellStreakDays + 1, c[key].comparisonDays + 1,
      c[key].liquidityDays + 1, c[key].maPeriod)));
  }
  return [...required].sort();
}

const readHead = (db: ScreenerDatabase) => db.prepare('SELECT checkpoint FROM screener_runs WHERE id=? AND scope=? AND status=\'complete\'')
  .bind(headId, scope).first<{ checkpoint: string }>();

/** GET 僅讀 prepared records；不碰原始來源、不補算指標、不寫 DB。 */
export async function readScreenerDependencySnapshot(db: ScreenerDatabase, criteria: Partial<CriteriaV7>, id?: string) {
  let snapshotId = id;
  if (!snapshotId) {
    const head = await readHead(db);
    if (!head) return null;
    snapshotId = JSON.parse(head.checkpoint).id;
  }
  if (!uuid(snapshotId)) throw Error('invalid_dependency_snapshot');
  const record = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=? AND scope=? AND status=\'complete\'')
    .bind(manifestId(snapshotId), scope).first<{ checkpoint: string }>();
  if (!record) return null; // 既有 canonical cursor 不會被誤認為條件底稿。
  const manifest = JSON.parse(record.checkpoint) as Manifest;
  const { digest, ...contents } = manifest;
  if (manifest.version !== 1 || manifest.id !== snapshotId || !uuid(manifest.sourceSnapshotId)
    || !hash(digest) || await technicalEvidenceHash(contents) !== digest
    || !hash(manifest.rowsHash) || !Number.isInteger(manifest.total) || manifest.total < 1 || manifest.total > 2500
    || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.verifiedKeys)
    || !Array.isArray(manifest.institutionalKeys)) throw Error('invalid_dependency_snapshot');
  const base = await readScreenerV4Snapshot(db, id ? manifest.sourceSnapshotId : undefined);
  if (!base) return null;
  if (base.id !== manifest.sourceSnapshotId) return null;
  if (base.metadata.universeRevision !== manifest.universeRevision || base.inputs.length !== manifest.total
    || base.metadata.effectiveSessionDate !== manifest.through || manifest.metadata.baseSnapshotId !== base.id
    || manifest.metadata.universeRevision !== manifest.universeRevision || manifest.metadata.dailyThrough !== manifest.through
    || manifest.metadata.effectiveSessionDate !== manifest.through) throw Error('invalid_dependency_snapshot');
  const verified = new Set([...manifest.verifiedKeys, ...manifest.institutionalKeys.map(k => `${k}|institutional-v2`)]);
  const required = screenerConditionDependencies(criteria, manifest.metadata.dailySessions);
  if (required.some(k => !verified.has(k))) return null;
  const technicalRequired = (['bollPosition','rsiCross','kdCross','macdSignal'] as const).some(k => criteria[k]?.enabled);
  const technical = technicalRequired ? await readTechnicalV7Cache(db, base) : null;
  if (technicalRequired && !technical) return null;
  const entries: Row[] = [];
  let after = rowId(snapshotId, '');
  for (;;) {
    const page = (await db.prepare(`SELECT id,checkpoint FROM screener_runs WHERE scope=? AND status='complete'
      AND id>? AND id<? ORDER BY id LIMIT 100`).bind(scope, after, rowId(snapshotId, '\uffff'))
      .all<{ id: string; checkpoint: string }>()).results ?? [];
    for (const r of page) {
      const v = JSON.parse(r.checkpoint) as Row;
      if (r.id !== rowId(snapshotId, v.symbol) || entries.length >= manifest.total) throw Error('invalid_dependency_snapshot');
      for (const feature of [v.chipV5, v.institutionalV6]) {
        const { evidenceHash, ...evidence } = feature;
        if (!hash(evidenceHash) || await technicalEvidenceHash(evidence) !== evidenceHash || feature.dailyThrough !== manifest.through)
          throw Error('invalid_dependency_snapshot');
      }
      entries.push(v);
    }
    if (page.length < 100) break;
    after = page.at(-1)!.id;
  }
  const bySymbol = new Map(entries.map(r => [r.symbol, r]));
  if (entries.length !== manifest.total || bySymbol.size !== manifest.total || await technicalEvidenceHash(entries) !== manifest.rowsHash
    || base.inputs.some(r => !bySymbol.has(r.symbol))) throw Error('invalid_dependency_snapshot');
  const inputs = base.inputs.map(r => ({ ...r, ...bySymbol.get(r.symbol)!, technicalV7: technical?.features.get(r.symbol) ?? null }));
  return { id: snapshotId, createdAt: manifest.createdAt, inputs,
    metadata: { ...manifest.metadata, technicalCoverage: technical?.manifest.coverage ?? null },
    dependencyScope: { version: 1 as const, sourceSnapshotId: base.id, required, preparedAt: manifest.createdAt } };
}

/** 既有 publisher 呼叫；允許本機有界修復，但不得由 HTTP status/results 呼叫。 */
export async function prepareScreenerDependencyCache(db: ScreenerDatabase, now = new Date()) {
  const previousHead = await readHead(db);
  const v5 = await buildScreenerV5Evidence(db, true);
  if (v5.state !== 'prepared') return v5;
  const v6 = await buildScreenerV6Evidence(db, { id: v5.base.id, metadata: v5.metadata, inputs: v5.inputs }, true);
  if (v6.state !== 'prepared') return v6;
  const entries = v6.inputs.map(({ symbol, chipV5, institutionalV6 }) => ({ symbol, chipV5, institutionalV6 }))
    .sort((a, b) => a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  const sizes = entries.map(r => new TextEncoder().encode(JSON.stringify(r)).byteLength);
  if (!entries.length || entries.length > 2500 || sizes.some(n => n > 65536)
    || sizes.reduce((a,b) => a+b,0) > 160 * 1024 * 1024) throw Error('dependency_cache_budget_exceeded');
  const rowsHash = await technicalEvidenceHash(entries);
  const previousPointer = previousHead ? JSON.parse(previousHead.checkpoint) : null;
  const previousId = previousPointer?.id ?? null;
  if (previousId) {
    const old = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=? AND scope=? AND status=\'complete\'')
      .bind(manifestId(previousId), scope).first<{ checkpoint: string }>();
    if (old) {
      const m = JSON.parse(old.checkpoint) as Manifest;
      if (m.sourceSnapshotId === v5.base.id && m.rowsHash === rowsHash
        && JSON.stringify(m.verifiedKeys) === JSON.stringify(v5.verifiedKeys)
        && JSON.stringify(m.institutionalKeys) === JSON.stringify(v6.verifiedKeys)) {
        if (!await readScreenerDependencySnapshot(db, {}, previousId)) throw Error('invalid_dependency_snapshot');
        return { state: 'unchanged', snapshotId: previousId, sourceSnapshotId: v5.base.id, rowsHash } as const;
      }
    }
  }
  const id = crypto.randomUUID(), createdAt = now.toISOString();
  const contents = { version: 1 as const, id, createdAt, sourceSnapshotId: v5.base.id,
    universeRevision: v5.base.metadata.universeRevision, through: v5.metadata.dailyThrough, total: entries.length,
    rowsHash, verifiedKeys: v5.verifiedKeys, institutionalKeys: v6.verifiedKeys, metadata: v6.metadata };
  const manifest = { ...contents, digest: await technicalEvidenceHash(contents) };
  const put = (key: string, value: unknown) => db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
    VALUES(?,?,'complete',?,?)`).bind(key, scope, JSON.stringify(value), createdAt);
  for (let offset = 0; offset < entries.length; offset += 50) await db.batch(entries.slice(offset, offset + 50)
    .map(r => put(rowId(id, r.symbol), r)));
  await put(manifestId(id), manifest).run();
  if (!await readScreenerDependencySnapshot(db, {}, id)) throw Error('invalid_dependency_snapshot');
  // 同父版與原 head CAS；失敗保留未被引用的底稿，不能讓慢 writer 倒退目前指標。
  await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
    SELECT ?,?,'complete',?,? WHERE (SELECT id FROM screener_snapshots WHERE status='published' AND schema_version=4
      ORDER BY created_at DESC,id DESC LIMIT 1)=? AND COALESCE((SELECT checkpoint FROM screener_runs WHERE id=?),'')=?
    ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at
    WHERE screener_runs.checkpoint=?`).bind(headId, scope, JSON.stringify({ id, previousId }), createdAt, v5.base.id,
      headId, previousHead?.checkpoint ?? '', previousHead?.checkpoint ?? '').run();
  const after = await readHead(db);
  if (!after || JSON.parse(after.checkpoint).id !== id) {
    // 只丟棄本次未取得 head 的可重建衍生列，絕不清另一 writer 或任何來源收據。
    await db.prepare('DELETE FROM screener_runs WHERE scope=? AND id LIKE ?').bind(scope, `${scope}:${id}:%`).run();
    return { state: 'pending', reason: 'dependency_publication_conflict' } as const;
  }
  // 按真正成功 head 的鏈保留兩版，不把另一 writer 的 staging 當作上一版，也不刪其正在準備的列。
  if (uuid(previousPointer?.previousId)) await db.prepare('DELETE FROM screener_runs WHERE scope=? AND id LIKE ?')
    .bind(scope, `${scope}:${previousPointer.previousId}:%`).run();
  return { state: 'published', snapshotId: id, sourceSnapshotId: v5.base.id, total: entries.length, rowsHash } as const;
}

/** 候選底稿失敗不阻斷既有 canonical 發布或來源冷卻流程。 */
export async function safelyPrepareScreenerDependencyCache(db: ScreenerDatabase, now = new Date()) {
  try { return await prepareScreenerDependencyCache(db, now); }
  catch { return { state: 'pending', reason: 'condition_dependency_preparation_failed' } as const; }
}
