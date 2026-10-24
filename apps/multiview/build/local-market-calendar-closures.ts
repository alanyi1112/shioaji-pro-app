import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketCalendar } from '../../../src/lib/market-calendar.ts';
import { parseOfficialFullDayClosures, CLOSURE_POLICY, closureSourceUrl } from '../../../scripts/stock-screener-calendar-exceptions.ts';

export function applySavedTseClosures(calendar: MarketCalendar, record: { status: string; checkpoint: string } | undefined, now: Date) {
  try {
    if (!calendar.annual || record?.status !== 'verified') return calendar;
    const e = JSON.parse(record.checkpoint), day = (d: Date) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei'}).format(d);
    if (e.policy !== CLOSURE_POLICY || e.sourceUrl !== closureSourceUrl(e.year) || typeof e.text !== 'string' || e.text.length > 2*1024**2
      || !Number.isFinite(Date.parse(e.fetchedAt)) || Date.parse(e.fetchedAt) > +now || day(new Date(e.fetchedAt)) !== day(now)
      || createHash('sha256').update(JSON.stringify(e.text)).digest('hex') !== e.sourceHash) return calendar;
    const dates = new Set(parseOfficialFullDayClosures(e.text,e.year,now).flatMap(n => n.dates));
    // TWSE 公告僅可排除上市；不以此推定上櫃也休市。
    return { ...calendar, version: `${calendar.version}|notices:${e.sourceHash}`, annual: { ...calendar.annual,
      days: calendar.annual.days.map(d => dates.has(d.tradeDate) ? { ...d,TSE:'closed' } : d) } };
  } catch { return calendar; }
}

export function readSavedTseClosures(calendar: MarketCalendar, stateDirectory: string, now: Date) {
  let db: DatabaseSync | undefined;
  try {
    const dir = join(stateDirectory,'state/v3/d1/miniflare-D1DatabaseObject');
    const files = readdirSync(dir).filter(n => /^[a-f0-9]{64}\.sqlite$/.test(n));
    if (files.length !== 1) return calendar;
    db = new DatabaseSync(join(dir,files[0]!),{readOnly:true});
    const year = Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric'}).format(now));
    const row = db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').get(`bollinger-calendar-closures:${year}`);
    return applySavedTseClosures(calendar,row as {status:string;checkpoint:string}|undefined,now);
  } catch { return calendar; } finally { db?.close(); }
}
