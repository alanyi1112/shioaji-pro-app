/** Read-only fast path: a published session can sleep until the next verified session. */
export async function screenerIdleGate(db, now = new Date()) {
  const head = await db.prepare("SELECT effective_session_date,universe_revision,status FROM screener_chip_publication_head WHERE name='v5'").first();
  if (head?.status !== 'published') return null;
  const calendar = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-period-evidence' AND status='verified'").first();
  const history = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='screener-history-progress'").first();
  const universe = await db.prepare("SELECT revision FROM screener_universe ORDER BY data_date DESC,revision DESC LIMIT 1").first();
  if (!calendar || !history || universe?.revision !== head.universe_revision) return null;
  try {
    const periods = JSON.parse(calendar.checkpoint), progress = JSON.parse(history.checkpoint);
    if (progress.remaining !== 0 || progress.failed !== 0 || progress.overdue !== 0
      || !Array.isArray(periods.sessions) || !periods.sessions.includes(head.effective_session_date)) return null;
    const next = periods.sessions.find(date => date > head.effective_session_date);
    if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return null;
    const nextAttemptAt = new Date(`${next}T14:00:00+08:00`).toISOString();
    if (Date.parse(periods.validThrough) < Date.parse(nextAttemptAt) || !Number.isFinite(Date.parse(periods.validThrough))) return null;
    if (now.getTime() >= Date.parse(nextAttemptAt)) return null;
    return { state: 'skipped', reason: 'session_complete_sleeping', effectiveSessionDate: head.effective_session_date, nextAttemptAt };
  } catch { return null; }
}
