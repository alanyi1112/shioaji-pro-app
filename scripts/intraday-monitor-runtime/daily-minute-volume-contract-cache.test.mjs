import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDailyMinuteVolumeContractCache } from './daily-minute-volume-contract-cache.mjs';

const entry = { canonicalSymbol: '2330.TW', contractIdentity: {
    security_type: 'STK', region: 'TW', exchange: 'TSE', code: '2330', target_code: null } };
const tradeDate = '2026-10-05';
const sourceVersion = 'shioaji-http-source/1';
const connectionGeneration = 'simulation:contract-cache-test-001';
const value = { code: '2330', exchange: 'TSE', security_type: 'STK', region: 'TW',
    unit: 1000, trading_suspended: false, update_date: tradeDate,
    unrelatedResponseField: 'never persisted' };

test('same-day contract cache is immutable, source-bound, and stores only verified fields', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-contract-cache-'));
    try {
        const cache = createDailyMinuteVolumeContractCache(root);
        const input = { entry, tradeDate, sourceVersion, connectionGeneration, value };
        assert.equal(await cache.readCachedContract({ entry, sourceDate: tradeDate,
            sourceVersion, connectionGeneration }), null);
        await cache.writeCachedContract(input);
        const saved = await cache.readCachedContract({ entry, sourceDate: tradeDate,
            sourceVersion, connectionGeneration });
        assert.equal(saved.identityVerified, true);
        assert.equal(saved.value.unrelatedResponseField, undefined);
        assert.equal(saved.value.update_date, tradeDate);
        await cache.writeCachedContract(input);
        assert.equal(await cache.readCachedContract({ entry, sourceDate: tradeDate,
            sourceVersion: 'changed-source', connectionGeneration }), null);
        assert.equal(await cache.readCachedContract({ entry, sourceDate: tradeDate,
            sourceVersion, connectionGeneration: 'simulation:other-generation-001' }), null);
        await cache.writeCachedContract({ ...input,
            connectionGeneration: 'simulation:other-generation-001' });
        assert.equal((await cache.readCachedContract({ entry, sourceDate: tradeDate,
            sourceVersion, connectionGeneration: 'simulation:other-generation-001' }))
            .value.update_date, tradeDate);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
