import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { claimDirect160Run, inspectDirect160ActiveClaim }
    from './direct-160-run-registry.mjs';
import { claimDynamicDailyRun, resolveDynamicDailySharedRegistryDirectory }
    from './dynamic-daily-run-registry.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))); });

async function directory() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'daily-run-registry-'));
    roots.push(root);
    return root;
}

const connectionGeneration = 'simulation:1234567890abcdef';
const tradeDate = '2026-09-30';
const claimedAt = '2026-09-30T08:45:00+08:00';
const planHash = 'a'.repeat(64);

describe('每日監控與 Stage 共用排他 claim', () => {
    it('產品路徑固定落在既有 Stage 的同一 registry，不接受相對路徑', async () => {
        const root = await directory();
        expect(resolveDynamicDailySharedRegistryDirectory(root))
            .toBe(path.join(root, 'direct-160-live', 'registry'));
        expect(() => resolveDynamicDailySharedRegistryDirectory('relative/path')).toThrow();
    });
    it('Stage 活躍時每日監控不能開第二個 run；釋放後同 generation 仍不可重用', async () => {
        const root = await directory();
        const stage = await claimDirect160Run({ directory: root, connectionGeneration,
            manifestHash: 'b'.repeat(64), tradeDate, claimedAt });
        await expect(claimDynamicDailyRun({ directory: root, connectionGeneration,
            planHash, tradeDate, claimedAt })).rejects.toThrow('daily_monitor_session_already_active');
        expect((await inspectDirect160ActiveClaim(root)).manifestHash).toBe('b'.repeat(64));
        await stage.release();
        await expect(claimDynamicDailyRun({ directory: root, connectionGeneration,
            planHash, tradeDate, claimedAt })).rejects.toThrow('daily_generation_already_used');
    });

    it('每日監控活躍時 Stage 不能開第二個 run，release 不刪不可重用收據', async () => {
        const root = await directory();
        const daily = await claimDynamicDailyRun({ directory: root, connectionGeneration,
            planHash, tradeDate, claimedAt });
        await expect(claimDirect160Run({ directory: root, connectionGeneration,
            manifestHash: 'b'.repeat(64), tradeDate, claimedAt }))
            .rejects.toThrow('direct_160_stage_already_active');
        expect((await inspectDirect160ActiveClaim(root)).planHash).toBe(planHash);
        await daily.release();
        expect(JSON.parse(await readFile(daily.claimPath, 'utf8')))
            .toMatchObject({ planHash, reusable: false, secondStreamAllowed: false });
        await expect(claimDirect160Run({ directory: root, connectionGeneration,
            manifestHash: 'b'.repeat(64), tradeDate, claimedAt }))
            .rejects.toThrow('direct_160_generation_already_used');
    });
});
