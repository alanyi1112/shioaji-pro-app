/** 既有 watcher 的獨立 v9 準備；只讀已驗證日曆與完整來源，不下載、不依賴 v8 profile/head。 */
import type { ScreenerDatabase } from '../apps/multiview/worker/stock-screener-repository.ts';
import { publishCandlestickHistory } from '../apps/multiview/worker/stock-screener-v9-publisher.ts';
import { candlestickSchemaReady } from '../apps/multiview/worker/stock-screener-v9-repository.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
import { isIsoDate } from '../src/lib/stock-screener-domain.ts';
import { bollingerUniverseHash, type BollingerUniverseStock } from '../src/lib/stock-screener-bollinger-source.ts';
import { CLOSURE_POLICY, closureSourceUrl, parseOfficialFullDayClosures } from './stock-screener-calendar-exceptions.ts';
import type { VerifiedBollingerCalendar } from '../src/lib/stock-screener-bollinger-history.ts';

/** 重算保存的 authority，不能從 close-only snapshot 或自行猜平日取得 grid。 */
export async function readCandlestickStoredCalendar(db: ScreenerDatabase, at: Date): Promise<VerifiedBollingerCalendar | null> {
  const effective = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='bollinger-calendar-effective' AND status='verified'")
    .first<{ checkpoint: string }>();
  if (!effective) return null;
  const e = JSON.parse(effective.checkpoint);
  // 與既有年度 authority 相同，允許重用已驗證 period cache；只能取 hash 精確對應有效公告投影者。
  let b: any = null;
  for (const id of ['screener-bollinger-calendar', 'screener-period-evidence']) {
    const record = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id=? AND status='verified'").bind(id).first<{ checkpoint: string }>();
    if (!record) continue;
    const candidate = JSON.parse(record.checkpoint);
    if (await technicalEvidenceHash(candidate) === e.baseAuthorityHash) { b = candidate; break; }
  }
  if (!b) return null;
  const day = new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  if (b.version !== 1 || !Array.isArray(b.sessions) || !b.sessions.length || b.sessions.length > 800
    || b.sessions.some((d: string, i: number) => !isIsoDate(d) || i > 0 && d <= b.sessions[i - 1])
    || Date.parse(b.validThrough) <= at.getTime() || !Number.isFinite(Date.parse(b.validThrough))
    || !Array.isArray(b.sourceHashes) || b.sourceHashes.length < 2 || b.sourceHashes.some((h: string) => !/^[a-f0-9]{64}$/.test(h))
    || e.policy !== CLOSURE_POLICY || e.baseAuthorityHash !== await technicalEvidenceHash(b) || !Array.isArray(e.proofs)) return null;
  const years = [...new Set(b.sessions.map((d: string) => Number(d.slice(0, 4))))];
  if (e.proofs.length !== years.length || new Set(e.proofs.map((p: any) => p.year)).size !== years.length) return null;
  const proofs = [];
  for (const p of e.proofs) {
    if (!years.includes(p.year)) return null;
    const record = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=? AND status=\'verified\'')
      .bind(`bollinger-calendar-closures:${p.year}`).first<{ checkpoint: string }>();
    if (!record) return null;
    const c = JSON.parse(record.checkpoint), fetched = Date.parse(c.fetchedAt);
    if (c.policy !== CLOSURE_POLICY || c.sourceUrl !== closureSourceUrl(p.year) || typeof c.text !== 'string'
      || !Number.isFinite(fetched) || fetched > at.getTime() || c.sourceHash !== p.sourceHash
      || await technicalEvidenceHash(c.text) !== p.sourceHash
      || (p.year === Number(day.slice(0, 4)) ? new Date(fetched + 8 * 3600000).toISOString().slice(0, 10) !== day : at.getTime() - fetched >= 30 * 86400000)) return null;
    const notices = parseOfficialFullDayClosures(c.text, p.year, at);
    if (await technicalEvidenceHash(notices) !== await technicalEvidenceHash(p.notices)) return null;
    proofs.push({ year: p.year, sourceHash: p.sourceHash, sourceUrl: c.sourceUrl, notices });
  }
  const removed = new Set(proofs.flatMap(p => p.notices.flatMap(n => n.dates)));
  const commonSessions = b.sessions.filter((d: string) => !removed.has(d));
  const authorityHash = await technicalEvidenceHash({ policy: CLOSURE_POLICY, baseAuthorityHash: e.baseAuthorityHash, proofs, commonSessions });
  if (e.authorityHash !== authorityHash || JSON.stringify(e.commonSessions) !== JSON.stringify(commonSessions)) return null;
  return { status: 'verified', commonSessions, authorityHash, validThrough: b.validThrough };
}
export async function updateCandlestickScheduled(db: ScreenerDatabase, now = () => new Date()) {
  if (!await candlestickSchemaReady(db)) return { state: 'pending', reason: 'v9_schema_pending' };
  let result: { state: string; reason?: string; snapshotId?: string; expectedSessionDate?: string };
  try {
    const calendar = await readCandlestickStoredCalendar(db, now());
    if (!calendar) result = { state: 'pending', reason: 'calendar_authority_pending' };
    else {
      const through = calendar.commonSessions.filter(d => Date.parse(`${d}T14:00:00+08:00`) <= now().getTime()).at(-1);
      if (!through) result = { state: 'pending', reason: 'source_not_closed' };
      else {
        const records = (await db.prepare(`SELECT revision,symbol,market,data_date,payload FROM screener_universe
          WHERE revision=(SELECT revision FROM screener_universe ORDER BY data_date DESC,revision DESC LIMIT 1) ORDER BY symbol LIMIT 10001`)
          .all<{ revision: string; symbol: string; market: string; data_date: string; payload: string }>()).results ?? [];
        if (!records.length || records.length > 10000) throw new Error('universe_contract_pending');
        const universe: BollingerUniverseStock[] = records.map(r => {
          const e = JSON.parse(r.payload), s = e?.stock;
          if (e.review !== 'verified' || e.revision !== r.revision || e.sourceDate !== r.data_date || s?.symbol !== r.symbol
            || s.market !== r.market || s.kind !== 'ordinary' || !s.classificationVersion || e.provenance?.source !== r.market
            || !/^[a-f0-9]{64}$/.test(e.provenance?.payloadHash ?? '')) throw new Error('universe_contract_pending');
          return { symbol: s.symbol, code: s.code, name: s.name, market: s.market, listingDate: s.listingDate ?? null };
        });
        result = { ...await publishCandlestickHistory({ db, calendar, through, universeRevision: records[0]!.revision,
          universe, universeHash: await bollingerUniverseHash(universe), now }), expectedSessionDate: through };
      }
    }
  } catch (error) { result = { state: 'pending', reason: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'v9_preparation_failed' }; }
  // 相同 pending／同鍵休眠不堆疊收據或寫入；查詢端永不呼叫此函式。
  const payload = JSON.stringify(result);
  await db.prepare(`INSERT INTO screener_candlestick_state(name,payload,updated_at) VALUES('v9',?,?)
    ON CONFLICT(name) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE payload<>excluded.payload`)
    .bind(payload, now().toISOString()).run();
  return result;
}
