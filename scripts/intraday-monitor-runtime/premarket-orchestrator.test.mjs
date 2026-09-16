import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildPremarketLaunchAgentPlist, claimPremarketStep, resolvePremarketOrchestratorPaths,
    ensurePremarketSimulationWarmup, resolvePremarketApprovedActiveLimit, runPremarketStep,
    simulationApiWarmupReady } from './premarket-orchestrator.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('durable 盤前 orchestrator', () => {
    it('非交易時段 rehearsal 分別驗證 warm path 不重啟及 cold path 只啟動一次 simulation', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-warmup-rehearsal-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        const ready = { checks: { simulation: true, apiGeneration: true, businessSession: true,
            snapshot2330: true }, generation: 'simulation:rehearsal_generation_0001', probes: {},
        observedAt: '2026-09-16T00:20:00.000Z' };
        const events = [];
        let runtimeCalls = 0;
        const warm = await ensurePremarketSimulationWarmup({ config: { tradeDate: '2026-09-16' },
            root, paths, inspectGates: async () => ready,
            runRuntime: async () => { runtimeCalls += 1; return { exitCode: 0 }; },
            appendEvent: async (_path, event) => events.push(event) });
        expect(warm).toMatchObject({ serviceLifecycleMutations: 0,
            gates: { generation: 'simulation:rehearsal_generation_0001' } });
        expect(runtimeCalls).toBe(0);

        const runtimeMarker = path.join(root, 'runtime-marker.txt');
        const runtimePath = path.join(root, 'fake-runtime');
        await writeFile(runtimePath, `#!/bin/sh\nprintf '%s' "$1" > '${runtimeMarker}'\n`);
        await chmod(runtimePath, 0o700);
        let inspections = 0;
        const cold = await ensurePremarketSimulationWarmup({ config: { tradeDate: '2026-09-16', runtimePath },
            root, paths, inspectGates: async () => inspections++ === 0
                ? { ...ready, checks: { ...ready.checks, businessSession: false } } : ready,
            appendEvent: async (_path, event) => events.push(event) });
        expect(cold.serviceLifecycleMutations).toBe(1);
        expect(await readFile(runtimeMarker, 'utf8')).toBe('simulation');
        expect(events).toContainEqual(expect.objectContaining({
            event: 'premarket_0820_api_repair_requested' }));
        const anchor = JSON.parse(await readFile(paths.generationAnchorPath, 'utf8'));
        expect(anchor).toMatchObject({ generation: ready.generation, tradeDate: '2026-09-16' });
    });

    it('只有同 manifest 的 complete GO 狀態才讓下一交易日直接啟用 160 檔', () => {
        const config = { productStatePath: '/tmp/direct-160-state.json' };
        const approved = { phase: 'complete_go', evaluationState: 'go',
            approvedActiveLimit: 160, manifestHash: 'a'.repeat(64) };
        expect(resolvePremarketApprovedActiveLimit(config, 'a'.repeat(64), () => approved)).toBe(160);
        expect(resolvePremarketApprovedActiveLimit(config, 'b'.repeat(64), () => approved)).toBe(20);
        expect(resolvePremarketApprovedActiveLimit(config, 'a'.repeat(64),
            () => ({ ...approved, evaluationState: 'no_go' }))).toBe(20);
        expect(resolvePremarketApprovedActiveLimit(config, 'a'.repeat(64), () => null)).toBe(20);
    });

    it('08:20 只有程序存在不算暖機完成，必須通過 generation、business session 與 Snapshot', () => {
        const checks = { simulation: true, apiGeneration: true, businessSession: true, snapshot2330: true };
        expect(simulationApiWarmupReady({ checks })).toBe(true);
        for (const key of Object.keys(checks)) {
            expect(simulationApiWarmupReady({ checks: { ...checks, [key]: false } })).toBe(false);
        }
        expect(simulationApiWarmupReady(null)).toBe(false);
    });

    it('LaunchAgent 固定包含 08:20／08:35／08:45／08:50 四個本地節點', () => {
        const value = buildPremarketLaunchAgentPlist('/tmp/premarket.mjs', '/tmp/premarket.jsonl');
        for (const [hour, minute] of [[8, 20], [8, 35], [8, 45], [8, 50]]) {
            expect(value).toContain(`<key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer>`);
        }
        expect(value).toContain('com.alanyi.realtimestock.intraday-premarket');
    });

    it('dry-run 產生台北時間 receipt，但不建立 claim 或執行服務', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-orchestrator-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(paths.configPath, JSON.stringify({ tradeDate: '2026-09-16',
            officialTradingDates: ['2026-09-15', '2026-09-16'],
        }), { mode: 0o600 });
        const result = await runPremarketStep({ step: '08:45', dryRun: true,
            now: new Date('2026-09-16T08:00:00+08:00'), root });
        expect(result).toMatchObject({ executed: false, reason: 'dry_run', step: '08:45',
            receipt: { timeZone: 'Asia/Taipei', scheduledForUtc: '2026-09-16T00:45:00.000Z',
                consistency: { status: 'ready' } } });
        await expect(stat(paths.claimsDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('未設定的交易日只寫 noop event 且不建立 claim', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-orchestrator-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(paths.configPath, JSON.stringify({ tradeDate: '2026-09-16',
            officialTradingDates: ['2026-09-16'] }), { mode: 0o600 });
        await expect(runPremarketStep({ step: '08:20', now: new Date('2026-09-17T08:20:00+08:00'),
            root })).resolves.toMatchObject({ executed: false, reason: 'not_configured_trading_date' });
        expect(await readFile(paths.logPath, 'utf8')).toContain('not_configured_trading_date');
    });

    it('heartbeat、備援與人工入口競爭時只允許一個 durable claim', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-orchestrator-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        const attempts = await Promise.allSettled(Array.from({ length: 8 }, () =>
            claimPremarketStep(paths, '2026-09-16', '08:50',
                'com.alanyi.realtimestock.intraday-premarket')));
        expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(7);
        expect(attempts.filter((result) => result.status === 'rejected')
            .every((result) => result.reason.message === 'premarket_step_already_claimed')).toBe(true);
    });
});
