import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildPremarketLaunchAgentPlist, claimPremarketStep, resolvePremarketOrchestratorPaths,
    ensurePremarketSimulationWarmup, resolvePremarketApprovedActiveLimit, runPremarketStep,
    simulationApiWarmupReady, recoverUnstartedPremarketGeneration,
    recoverMissingPremarketSession,
    configuredCohortMatches } from './premarket-orchestrator.mjs';
import { IntradayMonitorSessionStateRepository,
    createDailySessionRecord } from './session-state-repository.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const tradingDay = (tradeDate = '2026-09-16') => async () => ({
    current: true,
    tradeDate,
    previousTradeDate: '2026-09-15',
    isTradingDate: true,
    source: 'fixture official calendar',
    sourceVersions: ['fixture-calendar-v1'],
    observedAt: `${tradeDate}T00:20:00.000Z`,
});

describe('durable 盤前 orchestrator', () => {
    it('08:35 官方來源恢復後可用獨立證據補建 session，不覆寫 08:20 失敗', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-rollover-recovery-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.receiptsDirectory, { recursive: true });
        const original = { step: '08:20', localDate: '2026-09-22',
            rolloverOutcome: 'failed', reason: 'calendar_authority_unavailable', sessionId: null };
        const originalText = `${JSON.stringify(original)}\n`;
        await writeFile(path.join(paths.receiptsDirectory, '2026-09-22-0820.json'), originalText);
        let prepared = 0;
        const result = await recoverMissingPremarketSession({ root, step: '08:35',
            now: new Date('2026-09-22T08:35:00+08:00'),
            authority: await tradingDay('2026-09-22')(), config: {},
            readNoCurrentData: async () => true,
            inspectGates: async () => ({ ready: true,
                checks: { simulation: true, apiGeneration: true, businessSession: true,
                    snapshot2330: true }, generation: 'simulation:test-generation-1234567890',
                observedAt: '2026-09-22T00:35:00.000Z' }),
            prepareDailySession: async ({ schedulerReceipt }) => {
                prepared++;
                expect(schedulerReceipt).toMatchObject({ step: '08:35', recoveryOf: '08:20',
                    scheduledSuccess: false, originalReceiptSha256: expect.stringMatching(/^sha256:/) });
                return { baselineCurrent: true, session: { sessionId: 'fixture-session',
                    phase: 'starting' } };
            },
        });
        expect(result).toMatchObject({ recovered: true, scheduled0820Success: false,
            sessionId: 'fixture-session' });
        expect(prepared).toBe(1);
        expect(await readFile(path.join(paths.receiptsDirectory, '2026-09-22-0820.json'), 'utf8'))
            .toBe(originalText);
        expect(JSON.parse(await readFile(paths.generationAnchorPath, 'utf8')))
            .toMatchObject({ rolloverRecoveryStep: '08:35', tradeDate: '2026-09-22' });
    });

    it('08:35 不可在原 08:20 非日曆失敗或已有今日資料時補建', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-rollover-denied-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.receiptsDirectory, { recursive: true });
        await writeFile(path.join(paths.receiptsDirectory, '2026-09-22-0820.json'),
            JSON.stringify({ step: '08:20', localDate: '2026-09-22', rolloverOutcome: 'failed',
                reason: 'premarket_0820_api_warmup_failed', sessionId: null }));
        const prepareDailySession = async () => { throw new Error('must not prepare'); };
        const args = { root, step: '08:35', authority: await tradingDay('2026-09-22')(),
            config: {}, prepareDailySession, readNoCurrentData: async () => true };
        await expect(recoverMissingPremarketSession(args)).resolves.toMatchObject({ recovered: false });
        await writeFile(path.join(paths.receiptsDirectory, '2026-09-22-0820.json'),
            JSON.stringify({ step: '08:20', localDate: '2026-09-22', rolloverOutcome: 'failed',
                reason: 'calendar_authority_unavailable', sessionId: null }));
        await expect(recoverMissingPremarketSession({ ...args,
            readNoCurrentData: async () => false })).resolves.toMatchObject({ recovered: false });
    });

    it('08:35 自動補救需再查完整 Gate，並在本步收據標明非 08:20 成功', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-rollover-step-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true });
        await writeFile(paths.configPath, '{}');
        let inspections = 0;
        const result = await runPremarketStep({ root, step: '08:35',
            now: new Date('2026-09-22T08:35:00+08:00'),
            resolveTradingDay: tradingDay('2026-09-22'),
            inspectGates: async () => { inspections++; return { ready: true,
                checks: { artifacts: true, configuredCohort: true, generationStable: true },
                configuredCohort: { reason: 'checked' }, generation: 'simulation:fixture' }; },
            inspectDailySession: async () => inspections === 1
                ? { ready: false, reason: 'current_session_missing', session: null }
                : { ready: true, reason: null, session: { sessionId: 'recovered-session' } },
            recoverMissingSession: async () => ({ recovered: true,
                originalReceiptSha256: `sha256:${'a'.repeat(64)}` }),
        });
        expect(inspections).toBe(2);
        expect(result.outcome).toMatchObject({
            rolloverOutcome: 'session_recovered_after_0820_failure' });
        expect(JSON.parse(await readFile(path.join(paths.receiptsDirectory,
            '2026-09-22-0835.json'), 'utf8'))).toMatchObject({
            sessionId: 'recovered-session',
            rolloverOutcome: 'session_recovered_after_0820_failure',
            original0820ReceiptSha256: `sha256:${'a'.repeat(64)}`,
        });
    });

    it('在 08:35 前核對設定前 160 檔與核准 cohort 的精確順序', () => {
        const approved = Array.from({ length: 160 }, (_, index) => `${1000 + index}.TW`);
        expect(configuredCohortMatches([...approved, '9999.TW'], approved)).toBe(true);
        expect(configuredCohortMatches([...approved.slice(1), approved[0]], approved)).toBe(false);
        expect(configuredCohortMatches(approved.slice(0, 159), approved)).toBe(false);
    });

    it('08:35 偵測設定 cohort 不符時保存明確失敗收據，且不執行 capture', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-cohort-mismatch-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(paths.configPath, JSON.stringify({ tradeDate: '2026-09-22' }),
            { mode: 0o600 });
        let captures = 0;
        await expect(runPremarketStep({ root, step: '08:35',
            now: new Date('2026-09-22T08:35:00+08:00'),
            resolveTradingDay: tradingDay('2026-09-22'),
            inspectGates: async () => ({ ready: false,
                checks: { artifacts: true, configuredCohort: false, generationStable: true },
                configuredCohort: { matches: false, enabled: 200, reason: 'checked' },
                generation: 'simulation:test-cohort-generation' }),
            inspectDailySession: async () => ({ ready: true,
                session: { sessionId: 'fixture-session' } }),
            runCapture: async () => { captures++; return { exitCode: 0 }; },
        })).rejects.toThrow('configured_cohort_mismatch');
        expect(captures).toBe(0);
        expect(JSON.parse(await readFile(path.join(paths.receiptsDirectory,
            '2026-09-22-0835.json'), 'utf8'))).toMatchObject({
            rolloverOutcome: 'failed', reason: 'configured_cohort_mismatch',
        });
    });

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
            now: new Date('2026-09-16T08:00:00+08:00'), root,
            resolveTradingDay: tradingDay() });
        expect(result).toMatchObject({ executed: false, reason: 'dry_run', step: '08:45',
            receipt: { timeZone: 'Asia/Taipei', scheduledForUtc: '2026-09-16T00:45:00.000Z',
                consistency: { status: 'ready' } } });
        await expect(stat(paths.claimsDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('官方非交易日只寫 noop event 且不建立 claim', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-orchestrator-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(paths.configPath, JSON.stringify({ tradeDate: '2026-09-16',
            officialTradingDates: ['2026-09-16'] }), { mode: 0o600 });
        await expect(runPremarketStep({ step: '08:20', now: new Date('2026-09-17T08:20:00+08:00'),
            root, resolveTradingDay: async () => ({ current: true, tradeDate: '2026-09-17',
                previousTradeDate: '2026-09-16', isTradingDate: false,
                source: 'fixture official calendar', sourceVersions: ['fixture-calendar-v1'],
                observedAt: '2026-09-17T00:20:00.000Z' }) }))
            .resolves.toMatchObject({ executed: false, reason: 'official_non_trading_date' });
        expect(await readFile(paths.logPath, 'utf8')).toContain('official_non_trading_date');
    });

    it('官方來源重試後仍不可用時保留失敗收據，不建立今日 session claim', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-calendar-unavailable-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(paths.configPath, JSON.stringify({ tradeDate: '2026-09-16' }), { mode: 0o600 });
        const result = await runPremarketStep({ step: '08:20',
            now: new Date('2026-09-22T08:20:00+08:00'), root,
            resolveTradingDay: async () => ({ current: false, tradeDate: '2026-09-22',
                previousTradeDate: null, isTradingDate: null, reason: 'calendar_fetch_timeout' }) });
        expect(result).toMatchObject({ executed: false, reason: 'calendar_authority_unavailable' });
        expect(JSON.parse(await readFile(path.join(paths.receiptsDirectory,
            '2026-09-22-0820.json'), 'utf8'))).toMatchObject({
            step: '08:20', sessionId: null, stepClaim: null,
            rolloverOutcome: 'failed', reason: 'calendar_authority_unavailable',
        });
        await expect(stat(paths.claimsDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('不沿用 legacy config 的固定日期，dry-run 改以官方 authority 日期排程', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-rollover-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(paths.configPath, JSON.stringify({ tradeDate: '2026-09-16',
            officialTradingDates: ['2026-09-16'] }), { mode: 0o600 });
        const result = await runPremarketStep({ step: '08:20', dryRun: true,
            now: new Date('2026-09-22T08:00:00+08:00'), root,
            resolveTradingDay: tradingDay('2026-09-22') });
        expect(result).toMatchObject({ reason: 'dry_run', authority: { tradeDate: '2026-09-22' },
            receipt: { tradeDate: '2026-09-22', requestedLocalTime: '08:20:00' } });
    });

    it('四個 durable steps 共用同一 session，並把 baseline、output 與 chart evidence rollover 到當日', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-four-step-session-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(paths.configPath, JSON.stringify({
            schemaVersion: 'intraday-monitor-premarket-config/2',
            artifactBundleHash: 'a'.repeat(64), registryDirectory: path.join(root, 'registry'),
            generationPath: path.join(root, 'runtime-api-generation'),
            configDatabasePath: path.join(root, 'config.sqlite3'),
            evidenceDatabasePath: path.join(root, 'evidence.sqlite3'),
            productStatePath: path.join(root, 'product-state.json'),
        }), { mode: 0o600 });
        const authority = { current: true, tradeDate: '2026-09-22',
            previousTradeDate: '2026-09-21', isTradingDate: true,
            source: 'fixture official calendar', sourceVersions: ['fixture-calendar-v1'],
            observedAt: '2026-09-22T00:20:00.000Z' };
        const session = { sessionId: 'session-2026-09-22-shared', tradeDate: '2026-09-22' };
        const effectiveConfigs = [];
        const gates = { ready: true, generation: 'simulation:four-step-generation',
            artifacts: { resolvedConfig: { manifestPath: '/bundle/cohort.json',
                planPath: '/bundle/plan.json', baselinePath: '/daily/baseline.json',
                prerequisitePath: '/bundle/prerequisite.json' } } };
        const results = [];
        for (const step of ['08:20', '08:35', '08:45', '08:50']) {
            results.push(await runPremarketStep({ step, root,
                now: new Date(`2026-09-22T${step}:00+08:00`),
                resolveTradingDay: async () => authority,
                warmup: async ({ config }) => { effectiveConfigs.push(config); return { gates,
                    serviceLifecycleMutations: 0 }; },
                inspectGates: async (config) => { effectiveConfigs.push(config); return gates; },
                prepareDailySession: async ({ config }) => { effectiveConfigs.push(config); return {
                    session, approval: { approvedActiveLimit: 160 }, baselineCurrent: true,
                }; },
                inspectDailySession: async ({ config }) => { effectiveConfigs.push(config); return {
                    ready: true, session, approval: { approvedActiveLimit: 160 },
                }; },
                runCapture: async () => ({ exitCode: 0 }),
            }));
        }
        expect(results.map((result) => result.outcome.dailySession.sessionId))
            .toEqual(Array(4).fill(session.sessionId));
        expect(effectiveConfigs.every((config) =>
            config.baselinePath === path.join(root, 'intraday-baselines',
                '2026-09-21-for-2026-09-22-verified', 'baseline-set.json') &&
            config.outputPath === path.join(root, 'direct-160-live', 'capture-2026-09-22.json') &&
            config.chartEvidencePath === path.join(root, 'direct-160-live',
                'passive-chart-freshness-2026-09-22.json'))).toBe(true);
        for (const step of ['0820', '0835', '0845', '0850']) {
            expect(JSON.parse(await readFile(path.join(paths.receiptsDirectory,
                `2026-09-22-${step}.json`), 'utf8'))).toMatchObject({
                sessionId: session.sessionId, rolloverOutcome: expect.any(String),
            });
        }
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

    it('08:35 換代只在零活動與完整 Gate 時保留 transition 並更新 anchor', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-generation-recovery-'));
        roots.push(root);
        const paths = resolvePremarketOrchestratorPaths(root);
        await mkdir(paths.directory, { recursive: true });
        const oldGeneration = 'simulation:original-generation-20260922';
        const newGeneration = 'simulation:replacement-generation-20260922';
        await writeFile(paths.generationAnchorPath, JSON.stringify({ generation: oldGeneration,
            tradeDate: '2026-09-22' }));
        const itemStates = Array.from({ length: 160 }, (_, index) => ({
            canonicalSymbol: `${String(1000 + index)}.TW`, state: 'awaiting_first_kbar',
            reason: 'awaiting_first_kbar', baselineState: 'complete',
            subscriptionState: 'none', firstKbarAt: null,
            updatedAt: '2026-09-22T08:20:00+08:00',
        }));
        const repository = new IntradayMonitorSessionStateRepository(root);
        const session = repository.claimSession(createDailySessionRecord({
            sessionId: 'session-2026-09-22-recovery', tradeDate: '2026-09-22',
            previousTradeDate: '2026-09-21', configRevision: 8,
            cohortHash: 'a'.repeat(64), baselineHash: 'b'.repeat(64),
            artifactBundleHash: 'c'.repeat(64), approvalHash: 'd'.repeat(64),
            connectionGeneration: oldGeneration, schedulerReceiptHash: 'e'.repeat(64),
            calendarAuthority: { current: true, tradeDate: '2026-09-22',
                previousTradeDate: '2026-09-21', isTradingDate: true,
                source: 'fixture official calendar', sourceVersions: ['fixture-calendar-v1'],
                observedAt: '2026-09-22T08:20:00+08:00' },
            phase: 'starting', itemStates, controlPlane: { requested: false, accepted: false },
            freshness: { evidenceAt: '2026-09-22T08:20:00+08:00', budgetMs: 1_200_000 },
            createdAt: '2026-09-22T08:20:00+08:00',
        }));
        const checks = Object.fromEntries(['simulation', 'apiGeneration', 'businessSession',
            'snapshot2330', 'web', 'multiView', 'artifacts', 'exactCohort', 'baseline',
            'disk', 'brokerWriteBlockade'].map((key) => [key, true]));
        checks.generationStable = false;
        const gates = { checks, generation: newGeneration,
            generationAnchor: { generation: oldGeneration } };
        const daily = { ready: false, reason: 'generation_mismatch',
            reasons: ['generation_mismatch'], session, savedConfig: { revision: 8 } };
        const authority = { current: true, isTradingDate: true,
            tradeDate: '2026-09-22', previousTradeDate: '2026-09-21' };
        const config = { outputPath: path.join(root, 'capture.json'),
            productStatePath: path.join(root, 'product-state.json'),
            evidenceDatabasePath: path.join(root, 'evidence.sqlite3') };
        const blocked = await recoverUnstartedPremarketGeneration({ root, config,
            authority, step: '08:35', gates, daily, readNoCurrentData: async () => false,
            now: new Date('2026-09-22T08:35:00+08:00') });
        expect(blocked).toMatchObject({ recovered: false,
            reason: 'generation_recovery_not_authorized' });
        expect(repository.readSession('2026-09-22').connectionGeneration).toBe(oldGeneration);
        const missingBaseline = await recoverUnstartedPremarketGeneration({ root, config,
            authority, step: '08:35', gates: { ...gates,
                checks: { ...checks, baseline: false } }, daily,
            readNoCurrentData: async () => true });
        expect(missingBaseline.recovered).toBe(false);
        const revisionChanged = await recoverUnstartedPremarketGeneration({ root, config,
            authority, step: '08:35', gates,
            daily: { ...daily, savedConfig: { revision: 9 } },
            readNoCurrentData: async () => true });
        expect(revisionChanged.recovered).toBe(false);
        const captureStep = await recoverUnstartedPremarketGeneration({ root, config,
            authority, step: '08:50', gates, daily, readNoCurrentData: async () => true });
        expect(captureStep.recovered).toBe(false);
        const result = await recoverUnstartedPremarketGeneration({ root, config,
            authority, step: '08:35', gates, daily, readNoCurrentData: async () => true,
            now: new Date('2026-09-22T08:35:00+08:00') });
        expect(result).toMatchObject({ recovered: true,
            transitionId: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(repository.readSession('2026-09-22').connectionGeneration).toBe(newGeneration);
        const transition = JSON.parse(await readFile(path.join(
            repository.paths.generationTransitionsDirectory, '2026-09-22',
            `${result.transitionId}.json`), 'utf8'));
        expect(transition).toMatchObject({ previousGeneration: oldGeneration,
            newGeneration, priorSessionIdentityHash: session.sessionIdentityHash,
            nextSessionIdentityHash: result.sessionIdentityHash });
        expect(JSON.parse(await readFile(paths.generationAnchorPath, 'utf8')))
            .toMatchObject({ generation: newGeneration, recoveryTransitionId: result.transitionId });
        await writeFile(paths.generationAnchorPath, JSON.stringify({
            generation: oldGeneration, tradeDate: '2026-09-22' }));
        const finalized = await recoverUnstartedPremarketGeneration({ root, config,
            authority, step: '08:45', gates,
            daily: { ready: true, session: repository.readSession('2026-09-22'),
                savedConfig: { revision: 8 } },
            readNoCurrentData: async () => true,
            now: new Date('2026-09-22T08:45:00+08:00') });
        expect(finalized).toMatchObject({ recovered: true, anchorFinalized: true,
            transitionId: result.transitionId });
        expect(JSON.parse(await readFile(paths.generationAnchorPath, 'utf8')))
            .toMatchObject({ generation: newGeneration, recoveryTransitionId: result.transitionId });

        const thirdGeneration = 'simulation:third-generation-20260922';
        await writeFile(paths.configPath, JSON.stringify({ ...config,
            artifactBundleHash: 'c'.repeat(64) }));
        let gateInspections = 0;
        const scheduled = await runPremarketStep({ root, step: '08:45',
            now: new Date('2026-09-22T08:46:00+08:00'),
            resolveTradingDay: async () => ({ ...authority,
                previousTradeDate: '2026-09-21', source: 'fixture official calendar',
                sourceVersions: ['fixture-calendar-v1'],
                observedAt: '2026-09-22T08:20:00+08:00' }),
            inspectGates: async () => {
                gateInspections++;
                return { ready: gateInspections > 1,
                    checks: { ...checks, generationStable: gateInspections > 1 },
                    generation: thirdGeneration,
                    generationAnchor: { generation: newGeneration } };
            },
            inspectDailySession: async () => {
                const current = repository.readSession('2026-09-22');
                const ready = current.connectionGeneration === thirdGeneration;
                return { ready, reason: ready ? null : 'generation_mismatch',
                    reasons: ready ? [] : ['generation_mismatch'], session: current,
                    savedConfig: { revision: 8 } };
            },
        });
        expect(scheduled).toMatchObject({ executed: true,
            outcome: { generationRecovery: { recovered: true },
                gates: { ready: true } } });
        expect(gateInspections).toBe(2);
        expect(repository.readSession('2026-09-22').connectionGeneration).toBe(thirdGeneration);
    });
});
