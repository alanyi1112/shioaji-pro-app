import {
  parseScreenerSessionReadiness, screenerReadinessReason, SCREENER_SESSION_READINESS_ID,
  type ScreenerSessionReadiness,
} from '../../../src/lib/stock-screener-session-readiness.ts';
import type { ScreenerDatabase } from './stock-screener-repository.ts';

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
  if (!readiness || snapshotEffectiveSessionDate && readiness.expectedSessionDate < snapshotEffectiveSessionDate) {
    return { expectedSessionDate: snapshotEffectiveSessionDate, effectiveSessionDate: snapshotEffectiveSessionDate,
      pending: false, reason: 'none', readiness: null };
  }
  const effectiveSessionDate = snapshotEffectiveSessionDate ?? readiness.effectiveSessionDate;
  const pending = !effectiveSessionDate || readiness.expectedSessionDate > effectiveSessionDate || readiness.phase !== 'complete';
  return { expectedSessionDate: readiness.expectedSessionDate, effectiveSessionDate,
    pending, reason: pending ? readiness.phase === 'complete' ? 'mixed_session_dates' : screenerReadinessReason(readiness) : 'none', readiness };
}
