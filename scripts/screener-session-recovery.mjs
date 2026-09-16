import { createHash } from 'node:crypto';
import { SCREENER_PUBLICATION_MAX_PROBES } from '../src/lib/stock-screener-session-readiness.ts';

/** Caller holds the operator lease. A crash consumes the attempt, never resets it. */
export async function consumeInvalidSessionRecovery(db, readiness, date, now = Date.now()) {
    const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || date !== today
        || readiness?.expectedSessionDate !== date || readiness.phase !== 'invalid'
        || readiness.attempts >= SCREENER_PUBLICATION_MAX_PROBES
        || !(Date.parse(readiness.nextAttemptAt) <= now)) throw new Error('invalid_recovery_precondition');
    const id = `screener-invalid-recovery:${date}`;
    const original = JSON.stringify(readiness);
    const receipt = { version: 1, date, consumedAt: new Date(now).toISOString(),
        originalReadiness: readiness, originalHash: createHash('sha256').update(original).digest('hex') };
    const result = await db.prepare("INSERT INTO screener_runs (id,scope,status,checkpoint,updated_at) VALUES (?,'screener-invalid-recovery','consumed',?,?) ON CONFLICT(id) DO NOTHING")
        .bind(id, JSON.stringify(receipt), receipt.consumedAt).run();
    if (Number(result.meta?.changes ?? result.changes) !== 1) throw new Error('invalid_recovery_already_consumed');
    return { ...readiness, phase: 'awaiting-publication' };
}
