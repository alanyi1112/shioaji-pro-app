import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { readLocalMarketCalendar } from '../../../scripts/market-calendar-local.mjs';
import { localCompletedSessionFromCalendar } from '../worker/local-completed-session.ts';
import { marketCalendarDay, type MarketCalendar } from '../../../src/lib/market-calendar.ts';
import { readSavedTseClosures } from './local-market-calendar-closures.ts';

export const LOCAL_CALENDAR_HEADER = 'x-multiview-local-calendar-proof';
export function replaceLocalCalendarProof(request: Pick<IncomingMessage, 'headers' | 'rawHeaders'>, proof = '') {
  delete request.headers[LOCAL_CALENDAR_HEADER];
  // Cloudflare Vite adapter 由 rawHeaders 建立 Request，兩種表示必須一併替換。
  request.rawHeaders = request.rawHeaders.flatMap((value, i, all) => i % 2 === 0
    && value.toLowerCase() !== LOCAL_CALENDAR_HEADER ? [value, all[i + 1]] : []);
  if (proof) { request.headers[LOCAL_CALENDAR_HEADER] = proof; request.rawHeaders.push(LOCAL_CALENDAR_HEADER, proof); }
}
export function signLocalCalendarProof(calendar: MarketCalendar, secret: string, now = new Date()) {
  if (!secret || secret.length < 32) return '';
  const dates = calendar.annual?.days.map(d => d.tradeDate).sort() ?? [];
  const from = dates[0], through = dates.at(-1);
  const count = from && through ? (Date.parse(through+'T00:00:00Z') - Date.parse(from+'T00:00:00Z')) / 86400000 + 1 : 0;
  const calendarWindow = count > 0 && count <= 740 ? { from, through, version: calendar.version,
    validUntil: new Date(calendar.annual!.validUntilEpochMs).toISOString(),
    ...Object.fromEntries((['TSE','OTC'] as const).map(m => [m, Array.from({length:count},(_,i) => {
      const date = new Date(Date.parse(from+'T00:00:00Z') + i*86400000).toISOString().slice(0,10);
      const state = marketCalendarDay(calendar,date,m,now).state;
      return state === 'scheduled' ? 'S' : state === 'closed' ? 'C' : 'U';
    }).join('')])) } : null;
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 'local-completed-session-proof/1', issuedAt: now.toISOString(),
    calendarVersion: calendar.version, calendarWindow, decision: localCompletedSessionFromCalendar(calendar, now) })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

export function localMarketCalendarPlugin(): Plugin {
  return { name: 'multiview-local-market-calendar', enforce: 'pre', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      // 不信任瀏覽器或外部送來的 proof；每次以目前本機設定重算，不保存來源／設定。
      replaceLocalCalendarProof(request);
      const path = new URL(request.url ?? '/', 'http://127.0.0.1:5174').pathname;
      if (path.startsWith('/api/')) {
        try {
          const now = new Date(), secret = process.env.MULTIVIEW_LOCAL_PIPELINE_SECRET ?? '';
          const base = readLocalMarketCalendar(undefined, { now });
          const calendar = readSavedTseClosures(base, process.env.MULTIVIEW_STATE_DIR ?? join(homedir(),'Library/Application Support/RealTimeStock/MultiView'), now);
          const proof = signLocalCalendarProof(calendar, secret, now);
          replaceLocalCalendarProof(request, proof);
          response.setHeader('x-local-calendar-transport', proof ? 'ready' : 'unavailable');
        } catch { /* 缺設定／來源時 Worker fail closed，不猜測開市。 */ }
      }
      next();
    });
  } };
}
