import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DAILY_MINUTE_VOLUME_MODE_SCHEMA, readDailyMinuteVolumeMode,
    readDailyMinuteVolumeModeSync, runDailyCollectionAttempts }
    from './daily-minute-volume-postclose.mjs';

test('長時 13:35 採集在原程序內等合法冷卻後只重試缺件，至多三次', async () => {
    let epoch = Date.parse('2026-10-05T16:15:00+08:00');
    const attempts = [];
    const receipt = await runDailyCollectionAttempts({
        limits: { maxAttempts: 3, cooldownMs: 15 * 60_000,
            deadlineAt: '2026-10-05T18:30:00+08:00' },
        now: () => new Date(epoch).toISOString(),
        wait: async ms => { epoch += ms; },
        collect: async attempt => {
            attempts.push(attempt);
            return { outcome: attempt === 2 ? 'complete' : 'partial',
                waitingCount: attempt === 2 ? 0 : 1, completedAt: new Date(epoch).toISOString() };
        },
    });
    assert.deepEqual(attempts, [1, 2]);
    assert.equal(receipt.outcome, 'complete');
    assert.equal(new Date(epoch).toISOString(), '2026-10-05T08:30:00.000Z');
});

test('截止時間或純衝突不會等待、不新增來源請求', async () => {
    let waits = 0, calls = 0;
    const result = await runDailyCollectionAttempts({
        limits: { maxAttempts: 3, cooldownMs: 15 * 60_000,
            deadlineAt: '2026-10-05T16:20:00+08:00' },
        now: () => '2026-10-05T08:15:00.000Z',
        wait: async () => { waits += 1; },
        collect: async () => { calls += 1; return { outcome: 'partial', waitingCount: 1,
            completedAt: '2026-10-05T08:15:00.000Z' }; },
    });
    assert.equal(result.outcome, 'partial');
    assert.equal(calls, 1);
    assert.equal(waits, 0);
});

test('missing mode leaves legacy enabled; invalid mode fails closed', async () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'daily-mode-')));
    try {
        assert.deepEqual(await readDailyMinuteVolumeMode(root),
            { mode: 'legacy', configured: false });
        assert.deepEqual(readDailyMinuteVolumeModeSync(root),
            { mode: 'legacy', configured: false });
        const directory = path.join(root, 'IntradayMonitor');
        mkdirSync(directory);
        const target = path.join(directory, 'daily-runtime-mode.json');
        writeFileSync(target, '{bad-json');
        chmodSync(target, 0o600);
        await assert.rejects(readDailyMinuteVolumeMode(root), /daily_mode_config_invalid/);
        assert.throws(() => readDailyMinuteVolumeModeSync(root), /daily_mode_config_invalid/);
        writeFileSync(target, JSON.stringify({ schemaVersion: DAILY_MINUTE_VOLUME_MODE_SCHEMA,
            mode: 'daily', screenerDatabasePath: '/local/screener.sqlite3',
            limits: { maxRequests: 321, maxResponseBytes: 1024,
                requestTimeoutMs: 1000, maxAttempts: 3,
                cooldownMs: 15 * 60_000, deadlineTime: '15:00:00' } }));
        await assert.rejects(readDailyMinuteVolumeMode(root), /daily_mode_config_invalid/);
        writeFileSync(target, JSON.stringify({ schemaVersion: DAILY_MINUTE_VOLUME_MODE_SCHEMA,
            mode: 'daily', screenerDatabasePath: '/local/screener.sqlite3',
            limits: { maxRequests: 320, maxResponseBytes: 1024,
                requestTimeoutMs: 1000, maxAttempts: 3,
                cooldownMs: 15 * 60_000, deadlineTime: '15:00:00' } }));
        assert.equal((await readDailyMinuteVolumeMode(root)).mode, 'daily');
        assert.equal(readDailyMinuteVolumeModeSync(root).mode, 'daily');
        const valid = await readDailyMinuteVolumeMode(root);
        writeFileSync(target, JSON.stringify({ ...valid, runtimeLimits: {
            maxRssBytes: 2 * 1024 ** 3, minimumFreeDiskBytes: 4 * 1024 ** 3,
            maximumEventProcessingMs: 3000, diskCheckIntervalMs: 30_000,
        } }));
        assert.equal((await readDailyMinuteVolumeMode(root)).runtimeLimits.diskCheckIntervalMs,
            30_000);
        writeFileSync(target, JSON.stringify({ ...valid, runtimeLimits: {
            maxRssBytes: 2 * 1024 ** 3, minimumFreeDiskBytes: 4 * 1024 ** 3,
            maximumEventProcessingMs: 3000, diskCheckIntervalMs: 0,
        } }));
        await assert.rejects(readDailyMinuteVolumeMode(root), /daily_mode_config_invalid/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
