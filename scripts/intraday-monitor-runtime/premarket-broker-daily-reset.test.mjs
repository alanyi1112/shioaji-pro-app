import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPremarketBrokerDailyReset } from './premarket-broker-daily-reset.mjs';

const authority = { isTradingDate: true, tradeDate: '2026-10-07',
    previousTradeDate: '2026-10-06' };

async function fixture(epoch = 'local-daily:2026-10-06') {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'premarket-broker-reset-')));
    await chmod(root, 0o700);
    await mkdir(path.join(root, 'IntradayMonitor'), { mode: 0o700 });
    await writeFile(path.join(root, 'IntradayMonitor', 'daily-runtime-mode.json'),
        JSON.stringify({ schemaVersion: 'intraday-minute-volume-runtime-mode/1',
            mode: 'daily', screenerDatabasePath: path.join(root, 'screener.sqlite3'),
            limits: { maxRequests: 320, maxResponseBytes: 2097152,
                requestTimeoutMs: 20000, maxAttempts: 3, cooldownMs: 900000,
                deadlineTime: '19:00:00' } }), { mode: 0o600 });
    let closed = 0;
    const openDatabase = () => ({
        prepare: () => ({ first: async () => ({ status: 'verified',
            checkpoint: JSON.stringify({ version: 4, quotaEpoch: epoch }) }) }),
        close: () => { closed++; },
    });
    return { root, openDatabase, closed: () => closed,
        cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('當日已續轉時不建立新來源觀察或額度週期', async () => {
    const f = await fixture('local-daily:2026-10-07');
    try {
        const result = await runPremarketBrokerDailyReset({ ...f, authority,
            findBefore: () => { throw new Error('unexpected observation'); } });
        assert.equal(result.state, 'current');
        assert.equal(f.closed(), 1);
    } finally { await f.cleanup(); }
});

test('前日錨點缺失時保持 waiting，不能自行假設重設', async () => {
    const f = await fixture();
    try {
        const result = await runPremarketBrokerDailyReset({ ...f, authority,
            findBefore: async input => {
                assert.equal(input.previousTradeDate, '2026-10-06');
                return null;
            }, prepare: () => { throw new Error('unexpected migration'); } });
        assert.deepEqual(result, { state: 'waiting', reason: 'previous_usage_anchor_missing' });
        assert.equal(f.closed(), 1);
    } finally { await f.cleanup(); }
});

test('有前日錨點才走既有 prepare／commit 雙階段，結果帶證據', async () => {
    const f = await fixture();
    try {
        const calls = [];
        const result = await runPremarketBrokerDailyReset({ ...f, authority,
            findBefore: async () => ({ evidenceHash: 'a'.repeat(64) }),
            prepare: async input => {
                calls.push('prepare');
                assert.equal(input.beforeEvidenceHash, 'a'.repeat(64));
                return { plan: { identity: { quotaEpoch: 'local-daily:2026-10-07' } },
                    witness: { evidenceHash: 'b'.repeat(64) } };
            },
            commit: async () => { calls.push('commit'); return { state: 'migrated' }; },
        });
        assert.deepEqual(calls, ['prepare', 'commit']);
        assert.equal(result.state, 'current');
        assert.equal(result.evidenceHash, 'b'.repeat(64));
        assert.equal(f.closed(), 1);
    } finally { await f.cleanup(); }
});
