/** 本機只讀主終端現成日曆投影；不更新官方來源、不寫休市設定。 */
import { marketCalendarDay, type MarketCalendar } from '../../../src/lib/market-calendar.ts';
import type { CompletedSession } from './official-trading-session';
import type { LocalCalendarWindow } from './taiwan-daily-continuity';
type LocalCompletedSession = CompletedSession & { calendarWindow?: LocalCalendarWindow };

export function localCompletedSessionFromCalendar(calendar: MarketCalendar, now = new Date()): CompletedSession {
  const unknown = (reasonCode: string): CompletedSession => ({ expectedSession: null, status: 'unknown', reasonCode });
  if (!calendar || calendar.schemaVersion !== 'shared-local-market-calendar/1'
    || !Number.isFinite(Date.parse(calendar.observedAt)) || Date.parse(calendar.observedAt) > +now
    || +now - Date.parse(calendar.observedAt) > 30000) return unknown('calendar_projection_stale');
  const clock = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: string) => clock.find(p => p.type === type)?.value ?? '';
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  let at = Date.parse(`${date}T00:00:00Z`) - (Number(part('hour')) * 60 + Number(part('minute')) < 900 ? 86400000 : 0);
  for (let i = 0; i < 14; i++, at -= 86400000) {
    const candidate = new Date(at).toISOString().slice(0, 10);
    const states = (['TSE','OTC'] as const).map(m => marketCalendarDay(calendar, candidate, m, now).state);
    if (states.includes('unknown')) return unknown('calendar_authority_unavailable');
    if (states[0] !== states[1]) return unknown('calendar_market_conflict');
    if (states[0] === 'scheduled') return { expectedSession: candidate, status: 'verified', reasonCode: null };
  }
  return unknown('calendar_coverage_unavailable');
}

export async function resolveLocalCompletedSession(proof: string | undefined, secret: string | undefined, now = new Date()): Promise<LocalCompletedSession> {
  const unknown = (reasonCode = 'calendar_projection_unavailable'): CompletedSession => ({ expectedSession: null, status: 'unknown', reasonCode });
  try {
    if (!secret || secret.length < 32) return unknown('calendar_projection_not_configured');
    if (!proof || proof.length > 4096) return unknown('calendar_projection_missing');
    const [payload, signature, extra] = proof.split('.');
    if (extra !== undefined || !/^[a-f0-9]{64}$/.test(signature ?? '') || !/^[A-Za-z0-9_-]+$/.test(payload ?? '')) return unknown();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(signature.match(/../g)!, x => parseInt(x,16));
    if (!await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(payload))) return unknown('calendar_projection_signature_invalid');
    const text = atob(payload.replace(/-/g,'+').replace(/_/g,'/'));
    const body = JSON.parse(new TextDecoder().decode(Uint8Array.from(text, x => x.charCodeAt(0))));
    if (body.schemaVersion !== 'local-completed-session-proof/1' || !Number.isFinite(Date.parse(body.issuedAt))
      || Date.parse(body.issuedAt) > +now || +now - Date.parse(body.issuedAt) > 30000
      || typeof body.calendarVersion !== 'string' || !body.calendarVersion || body.calendarVersion.length > 256) return unknown();
    const w = body.calendarWindow;
    let calendarWindow: LocalCalendarWindow | undefined;
    if (w) {
      const count = (Date.parse(w.through+'T00:00:00Z') - Date.parse(w.from+'T00:00:00Z')) / 86400000 + 1;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w.from) || !/^\d{4}-\d{2}-\d{2}$/.test(w.through)
        || !Number.isInteger(count) || count < 1 || count > 740 || typeof w.TSE !== 'string' || typeof w.OTC !== 'string'
        || w.TSE.length !== count || w.OTC.length !== count || !/^[SCU]+$/.test(w.TSE) || !/^[SCU]+$/.test(w.OTC)
        || w.version !== body.calendarVersion || !Number.isFinite(Date.parse(w.validUntil)) || Date.parse(w.validUntil) <= +now) return unknown();
      calendarWindow = w;
    }
    const d = body.decision;
    if (d?.status === 'verified' && typeof d.expectedSession === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.expectedSession)
      && new Date(d.expectedSession+'T00:00:00Z').toISOString().slice(0,10) === d.expectedSession && d.reasonCode === null)
      return { status: 'verified', expectedSession: d.expectedSession, reasonCode: null, ...(calendarWindow ? { calendarWindow } : {}) };
    if (d?.status === 'unknown' && d.expectedSession === null && ['calendar_projection_stale','calendar_authority_unavailable',
      'calendar_market_conflict','calendar_coverage_unavailable'].includes(d.reasonCode)) return { status:'unknown',expectedSession:null,reasonCode:d.reasonCode };
    return unknown();
  } catch { return unknown(); }
}
