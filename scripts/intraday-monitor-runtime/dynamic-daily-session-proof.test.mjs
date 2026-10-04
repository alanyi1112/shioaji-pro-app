import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyDynamicDailySessionProof }
    from './dynamic-daily-session-proof.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))); });

async function fixture(mode = 'simulation', generation = 'simulation:1234567890abcdef') {
    const appSupportRoot = await mkdtemp(path.join(os.tmpdir(), 'daily-proof-'));
    roots.push(appSupportRoot);
    await writeFile(path.join(appSupportRoot, 'runtime-mode'), `${mode}\n`);
    await writeFile(path.join(appSupportRoot, 'runtime-api-generation'), `${generation}\n`);
    const calls = [];
    const apiPort = { async preflight() { calls.push('preflight');
        return { simulation: true, businessSessionCurrent: false,
            sourceVersion: 'fixture/1' }; },
    async readSnapshot2330() { calls.push('snapshot');
        return [{ code: '2330', exchange: 'TSE',
            datetime: '2026-09-29T13:24:59' }]; } };
    return { appSupportRoot, apiPort, calls, previousTradeDate: '2026-09-29',
        targetTradeDate: '2026-09-30', expectedGeneration: 'simulation:1234567890abcdef',
        observedAt: '2026-09-29T13:35:00+08:00' };
}

describe('每日基準使用既有 simulation business session', () => {
    it('本機 mode／generation 與 2330 同日 Snapshot 全部通過才發 proof', async () => {
        const input = await fixture();
        expect(await verifyDynamicDailySessionProof(input)).toMatchObject({
            simulation: true, businessSessionCurrent: true,
            connectionGeneration: input.expectedGeneration,
            snapshotTradeDate: '2026-09-29', secondLogin: false,
            secondStream: false });
        expect(input.calls).toEqual(['preflight', 'snapshot']);
    });

    it('production 或 generation 不符時在任何 API 呼叫前拒絕', async () => {
        const production = await fixture('production');
        await expect(verifyDynamicDailySessionProof(production))
            .rejects.toThrow('daily_session_proof_mismatch');
        expect(production.calls).toEqual([]);
        const stale = await fixture('simulation', 'simulation:changed_generation_0001');
        await expect(verifyDynamicDailySessionProof(stale))
            .rejects.toThrow('daily_session_proof_mismatch');
        expect(stale.calls).toEqual([]);
    });

    it('Snapshot 來源日不符時不宣稱 business session current', async () => {
        const input = await fixture();
        input.apiPort.readSnapshot2330 = async () => [{ code: '2330', exchange: 'TSE',
            datetime: '2026-09-24T13:24:59' }];
        await expect(verifyDynamicDailySessionProof(input))
            .rejects.toThrow('daily_session_proof_mismatch');
    });
});
