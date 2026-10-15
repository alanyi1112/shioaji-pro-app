import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTieredCohortManifests } from './tiered-capacity-stage-artifacts.mjs';
import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { resolveDailyMinuteVolumeFixedBaseline }
    from './daily-minute-volume-fixed-baseline.mjs';

test('fixed daily gate reuses valid v1 read only and isolates a source conflict', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-fixed-gate-'));
    try {
        const contracts = Array.from({ length: 160 }, (_, index) => ({
            security_type: 'STK', region: 'TW', exchange: 'TSE',
            code: String(1001 + index), target_code: null }));
        const cohort = createTieredCohortManifests({ contracts,
            config: { revision: 1, items: contracts.map(contract => ({ contract, enabled: true })) },
            sourceVersion: 'fixture-only/1', createdAt: '2026-09-11T14:00:00+08:00' })[160];
        const legacySet = fixtureBaseline(cohort);
        const inputs = { root, cohort, legacySet,
            sourceTradeDate: legacySet.calendar.previousTradeDate,
            targetTradeDate: legacySet.calendar.targetTradeDate };
        const ready = resolveDailyMinuteVolumeFixedBaseline(inputs);
        assert.equal(ready.ready, true);
        assert.equal(ready.readyCount, 160);
        assert.equal(ready.manifests.length, 160);
        assert.match(ready.baselineHash, /^[a-f0-9]{64}$/);
        const conflict = resolveDailyMinuteVolumeFixedBaseline({ ...inputs,
            repositoryFactory: () => ({ hasConflict: symbol => symbol === '1001.TW',
                latestForSymbolDate: () => null, close() {} }) });
        assert.equal(conflict.ready, false);
        assert.equal(conflict.conflictCount, 1);
        assert.equal(conflict.readyCount, 159);
        assert.equal(conflict.items[0].state, 'conflict');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
