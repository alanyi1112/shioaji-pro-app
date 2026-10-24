import {
  parseScreenerSessionReadiness, screenerReadinessReason, SCREENER_SESSION_READINESS_ID,
  type ScreenerSessionReadiness,
} from '../../../src/lib/stock-screener-session-readiness.ts';
import type { ScreenerDatabase } from './stock-screener-repository.ts';
import { resolveLocalCompletedSession } from './local-completed-session.ts';

const localContexts = new WeakMap<object, Awaited<ReturnType<typeof resolveLocalCompletedSession>>>();

/** 每個 request 各自持有驗簽結果，不將身分或 I/O 留在共用 D1 proxy。 */
export async function bindLocalScreenerCalendar<T extends ScreenerDatabase>(db: T, proof?: string, secret?: string, now = new Date()): Promise<T> {
  const decision = await resolveLocalCompletedSession(proof, secret, now);
  const scoped = new Proxy(db, { get(target, property) {
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  localContexts.set(scoped, decision);
  return scoped;
}

async function closedReadinessSuperseded(db: ScreenerDatabase, saved: ScreenerSessionReadiness, effective: string | null) {
  const local = localContexts.get(db);
  const expected = local?.expectedSession, window = local?.calendarWindow;
  if (!expected || !window || effective !== expected || saved.expectedSessionDate <= expected) return false;
  const start = Date.parse(`${expected}T00:00:00Z`), end = Date.parse(`${saved.expectedSessionDate}T00:00:00Z`);
  if (end - start > 14 * 86400000) return false;
  for (let at = start + 86400000; at <= end; at += 86400000) {
    const offset = (at - Date.parse(`${window.from}T00:00:00Z`)) / 86400000;
    if (window.TSE[offset] !== 'C' || window.OTC[offset] !== 'C') return false;
  }
  for (const market of ['TWSE','TPEx']) {
    const row = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id=? AND scope='screener-source-period'")
      .bind(`screener-period:${market}:${expected}`).first<{ status: string; checkpoint: string }>();
    let p; try { p = JSON.parse(row?.checkpoint ?? 'null'); } catch { return false; }
    if (row?.status !== 'collected' || p?.source !== market || p.date !== expected || p.complete !== true
      || !/^[a-f0-9]{64}(?::[a-f0-9]{64})?$/.test(p.hash ?? '') || !Number.isInteger(p.total)
      || p.total < (market === 'TWSE' ? 800 : 500) || p.offset !== p.total) return false;
  }
  return true;
}

export interface ScreenerFreshness {
  expectedSessionDate: string | null;
  effectiveSessionDate: string | null;
  pending: boolean;
  reason: string;
  readiness: ScreenerSessionReadiness | null;
}

/** DB-only freshness envelope. GET routes never dispatch maintenance or infer dates from request time. */
export async function readScreenerFreshness(db: ScreenerDatabase, snapshotEffectiveSessionDate: string | null): Promise<ScreenerFreshness> {
  let readiness: ScreenerSessionReadiness | null = null;
  const row = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?')
    .bind(SCREENER_SESSION_READINESS_ID).first<{ checkpoint: string }>();
  try { readiness = row ? parseScreenerSessionReadiness(JSON.parse(row.checkpoint)) : null; }
  catch { readiness = null; }
  const local = localContexts.get(db);
  if (local && !local.expectedSession) return { expectedSessionDate: null, effectiveSessionDate: snapshotEffectiveSessionDate,
    pending: true, reason: local.reasonCode ?? 'calendar_authority_unavailable', readiness };
  if (readiness && await closedReadinessSuperseded(db, readiness, snapshotEffectiveSessionDate)) {
    // 只投影目前已證明完整的交易日；保留舊休市日等待／失敗收據，不改寫為自然完成。
    return { expectedSessionDate: local!.expectedSession, effectiveSessionDate: snapshotEffectiveSessionDate,
      pending: false, reason: 'none', readiness: null };
  }
  if (!readiness || snapshotEffectiveSessionDate && readiness.expectedSessionDate < snapshotEffectiveSessionDate) {
    return { expectedSessionDate: snapshotEffectiveSessionDate, effectiveSessionDate: snapshotEffectiveSessionDate,
      pending: false, reason: 'none', readiness: null };
  }
  const effectiveSessionDate = snapshotEffectiveSessionDate ?? readiness.effectiveSessionDate;
  const pending = !effectiveSessionDate || readiness.expectedSessionDate > effectiveSessionDate || readiness.phase !== 'complete';
  return { expectedSessionDate: readiness.expectedSessionDate, effectiveSessionDate,
    pending, reason: pending ? readiness.phase === 'complete' ? 'mixed_session_dates' : screenerReadinessReason(readiness) : 'none', readiness };
}
