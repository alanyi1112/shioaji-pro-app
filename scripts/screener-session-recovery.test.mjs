import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { consumeInvalidSessionRecovery } from './screener-session-recovery.mjs';

const now = Date.parse('2026-09-16T09:30:00Z');
const readiness = { version: 1, expectedSessionDate: '2026-09-16', effectiveSessionDate: '2026-09-14',
    phase: 'invalid', attempts: 1, nextAttemptAt: '2026-09-16T06:30:00Z',
    markets: { TPEx: { status: 'invalid', reason: 'invalid_source_payload' } } };

it('preserves original evidence atomically and never consumes twice', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE screener_runs (id TEXT PRIMARY KEY,scope TEXT,status TEXT,checkpoint TEXT,updated_at TEXT)');
    const adapter = { prepare: sql => ({ bind: (...args) => ({ run: () => db.prepare(sql).run(...args) }) }) };
    try {
        const result = await consumeInvalidSessionRecovery(adapter, readiness, '2026-09-16', now);
        expect(result.phase).toBe('awaiting-publication');
        expect(readiness.phase).toBe('invalid');
        const before = db.prepare('SELECT checkpoint FROM screener_runs').get().checkpoint;
        expect(JSON.parse(before).originalReadiness).toEqual(readiness);
        expect(JSON.parse(before).originalHash).toBe(createHash('sha256').update(JSON.stringify(readiness)).digest('hex'));
        await expect(consumeInvalidSessionRecovery(adapter, readiness, '2026-09-16', now)).rejects.toThrow('already_consumed');
        expect(db.prepare('SELECT checkpoint FROM screener_runs').get().checkpoint).toBe(before);
    } finally { db.close(); }
});

it.each([
    ['2026-09-15', {}], ['2026-09-17', {}], ['2026-09-16', { phase: 'blocked' }],
    ['2026-09-16', { phase: 'complete' }], ['2026-09-16', { attempts: 18 }],
    ['2026-09-16', { nextAttemptAt: '2026-09-16T10:00:00Z' }],
    ['2026-09-16', { expectedSessionDate: '2026-09-15' }],
])('rejects invalid date/state without writing: %s %j', async (date, patch) => {
    const db = { prepare() { throw new Error('unexpected_database_write'); } };
    await expect(consumeInvalidSessionRecovery(db, { ...readiness, ...patch }, date, now))
        .rejects.toThrow('invalid_recovery_precondition');
});
