import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { IntradayMonitorConfigRepository, resolveIntradayMonitorDatabasePath } from './config-repository.mjs';
import { importIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository, createCapacityApprovalRecord } from './session-state-repository.mjs';
import { inspectIntradayMonitorPremarketDailySession, prepareIntradayMonitorPremarketDailySession } from './premarket-daily-session.mjs';
import { createIntradayMonitorDailySessionRuntimeAuthority } from './daily-session-runtime-authority.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture({ baselineCurrent = true } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'premarket-daily-session-'));
    roots.push(root);
    const repo = path.join(root, 'repo');
    const source = path.join(repo, 'acceptance');
    await mkdir(source, { recursive: true });
    const cohort = { schemaVersion: 'cohort/1', manifestHash: 'a'.repeat(64), cohort: Array.from({ length: 160 }, (_, index) => ({
        canonicalSymbol: `${String(1000 + index)}.TW`,
    })) };
    const baseline = { schemaVersion: 'baseline/1', baselineHash: 'b'.repeat(64), calendar: {
        targetTradeDate: baselineCurrent ? '2026-09-22' : '2026-09-16',
        previousTradeDate: baselineCurrent ? '2026-09-21' : '2026-09-15',
    }, manifests: Array.from({ length: 160 }, () => ({})) };
    const files = { cohort, baseline, plan: { schemaVersion: 'plan/1', stage: 160 },
        prerequisite: { schemaVersion: 'prerequisite/1', decision: 'GO' } };
    for (const [role, value] of Object.entries(files)) {
        await writeFile(path.join(source, `${role}.json`), `${JSON.stringify(value)}\n`);
    }
    const dailyBaselinePath = path.join(root, 'intraday-baselines',
        '2026-09-21-for-2026-09-22-verified', 'baseline-set.json');
    await mkdir(path.dirname(dailyBaselinePath), { recursive: true });
    if (baselineCurrent) await writeFile(dailyBaselinePath, `${JSON.stringify(baseline)}\n`);
    const bundle = await importIntradayMonitorRuntimeArtifactBundle({
        appSupportRoot: root,
        repoDirectory: repo,
        sourceIdentity: 'test-acceptance',
        artifacts: Object.keys(files).map((role) => ({
            role, path: path.join(source, `${role}.json`), schema: `${role}/1`, dependencies: [],
        })),
    });
    const state = new IntradayMonitorSessionStateRepository(root);
    state.writeApproval(createCapacityApprovalRecord({
        approvedActiveLimit: 160, stage: 160, decision: 'go', reviewerType: 'codex_delegated',
        reviewerId: 'codex-delegated-review', reviewedAt: '2026-09-16T14:00:00+08:00',
        evidenceTradeDate: '2026-09-16', artifactBundleHash: bundle.bundleHash,
        authorizationProvenance: 'user_delegated_evidence_review', providerEvidence: {
            physicalUsage: null, otherUsage: null, globalOwnershipComplete: null,
            releaseProven: null, headroom: null,
        },
    }));
    const configRepository = new IntradayMonitorConfigRepository(resolveIntradayMonitorDatabasePath(root));
    configRepository.close();
    return { root, bundle, baseline, dailyBaselinePath,
        config: { artifactBundleHash: bundle.bundleHash },
        authority: { current: true, isTradingDate: true, tradeDate: '2026-09-22',
            previousTradeDate: '2026-09-21', source: 'fixture official calendar',
            sourceVersions: ['fixture-calendar-v1'], observedAt: '2026-09-22T00:20:00.000Z' } };
}

describe('premarket daily session rollover', () => {
    it('08:20 原子建立當日 session 並固定 revision、hashes 與 generation', async () => {
        const value = await fixture();
        const result = await prepareIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            schedulerReceipt: { step: '08:20', tradeDate: '2026-09-22' },
            now: new Date('2026-09-22T08:20:00+08:00'),
        });
        expect(result.session).toMatchObject({ tradeDate: '2026-09-22', previousTradeDate: '2026-09-21',
            configRevision: 0, phase: 'starting', baselineHash: 'b'.repeat(64),
            connectionGeneration: 'simulation:generation-20260922' });
        await expect(inspectIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
        })).resolves.toMatchObject({ ready: true });
    });

    it('當日 baseline 尚未到齊時建立 waiting_baseline，不沿用舊日期', async () => {
        const value = await fixture({ baselineCurrent: false });
        const result = await prepareIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            schedulerReceipt: { step: '08:20', tradeDate: '2026-09-22' },
            now: new Date('2026-09-22T08:20:00+08:00'),
        });
        expect(result.session).toMatchObject({ tradeDate: '2026-09-22', phase: 'waiting_baseline',
            baselineHash: null, blocker: 'baseline_missing' });
        await expect(inspectIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
        })).resolves.toMatchObject({ ready: false, reason: 'baseline_missing' });
        await writeFile(value.dailyBaselinePath, `${JSON.stringify({
            ...value.baseline,
            calendar: { targetTradeDate: '2026-09-22', previousTradeDate: '2026-09-21' },
        })}\n`);
        await expect(inspectIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            now: new Date('2026-09-22T08:35:00+08:00'),
        })).resolves.toMatchObject({ ready: true, session: {
            phase: 'starting', baselineHash: 'b'.repeat(64), blocker: null,
        } });
    });

    it('runtime authority 分開保存 control-plane 與第一筆合法 KBar，revision 漂移後 fail closed', async () => {
        const value = await fixture();
        await prepareIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            schedulerReceipt: { step: '08:20', tradeDate: '2026-09-22' },
            now: new Date('2026-09-22T08:20:00+08:00'),
        });
        await inspectIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            now: new Date('2026-09-22T08:45:00+08:00'),
        });
        let instant = '2026-09-22T08:50:00+08:00';
        const runtime = createIntradayMonitorDailySessionRuntimeAuthority({
            appSupportRoot: value.root, tradeDate: '2026-09-22',
            connectionGeneration: 'simulation:generation-20260922', now: () => instant,
        });
        expect(runtime.evaluate()).toMatchObject({ current: true,
            controlPlaneAuthority: true, dataPlaneAuthority: true });
        runtime.markControlPlane({ requested: true, accepted: true });
        let saved = new IntradayMonitorSessionStateRepository(value.root).readSession('2026-09-22');
        expect(saved).toMatchObject({ phase: 'starting', controlPlane: {
            requested: true, accepted: true,
        } });
        expect(saved.itemStates[0]).toMatchObject({ state: 'awaiting_first_kbar',
            subscriptionState: 'accepted', firstKbarAt: null });
        instant = '2026-09-22T09:01:02+08:00';
        runtime.recordFirstKbar({ canonicalSymbol: '1000.TW', receivedAt: instant });
        saved = new IntradayMonitorSessionStateRepository(value.root).readSession('2026-09-22');
        expect(saved.itemStates[0]).toMatchObject({ state: 'active',
            subscriptionState: 'confirmed', firstKbarAt: instant });
        const configRepository = new IntradayMonitorConfigRepository(resolveIntradayMonitorDatabasePath(value.root));
        configRepository.replace({ schemaVersion: 'intraday-monitor-config/1', revision: 0,
            globalThreshold: '1.5', items: [] });
        configRepository.close();
        expect(runtime.evaluate()).toMatchObject({ current: false,
            reason: 'config_revision_mismatch', notificationAuthority: false });
    });

    it('13:30 進入 closing 保留真實 evidence 時間，13:34:30 可封存且不回到 running', async () => {
        const value = await fixture();
        await prepareIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            schedulerReceipt: { step: '08:20', tradeDate: '2026-09-22' },
            now: new Date('2026-09-22T08:20:00+08:00'),
        });
        await inspectIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            now: new Date('2026-09-22T08:45:00+08:00'),
        });
        let instant = '2026-09-22T08:50:00+08:00';
        const runtime = createIntradayMonitorDailySessionRuntimeAuthority({
            appSupportRoot: value.root, tradeDate: '2026-09-22',
            connectionGeneration: 'simulation:generation-20260922', now: () => instant,
        });
        runtime.markControlPlane({ requested: true, accepted: true });
        instant = '2026-09-22T09:01:02+08:00';
        runtime.recordFirstKbar({ canonicalSymbol: '1000.TW', receivedAt: instant });
        instant = '2026-09-22T13:29:45+08:00';
        const repository = new IntradayMonitorSessionStateRepository(value.root);
        const beforeClose = repository.readSession('2026-09-22');
        repository.updateSession({ ...beforeClose,
            freshness: { evidenceAt: instant, budgetMs: 120_000 }, updatedAt: instant });
        instant = '2026-09-22T13:30:15+08:00';
        const wrongGeneration = createIntradayMonitorDailySessionRuntimeAuthority({
            appSupportRoot: value.root, tradeDate: '2026-09-22',
            connectionGeneration: 'simulation:wrong-generation-20260922', now: () => instant,
        });
        expect(() => wrongGeneration.beginClosing()).toThrow('generation_mismatch');
        expect(runtime.beginClosing()).toMatchObject({ current: true, phase: 'closing',
            evidenceAt: '2026-09-22T13:29:45+08:00', ageMs: 30_000, budgetMs: 600_000 });
        expect(() => runtime.beginClosing()).toThrow('session_closing_transition_not_ready');
        instant = '2026-09-22T13:34:30+08:00';
        expect(runtime.evaluate()).toMatchObject({ current: true, phase: 'closing',
            evidenceAt: '2026-09-22T13:29:45+08:00', ageMs: 285_000 });
        runtime.recordObservation({ canonicalSymbol: '1000.TW', receivedAt: instant,
            continuityComplete: true });
        expect(runtime.evaluate()).toMatchObject({ current: true, phase: 'closing',
            evidenceAt: instant, budgetMs: 600_000 });
    });

    it('收盤轉換不能救回盤中已過期 evidence，也不能在收盤窗外啟動', async () => {
        const value = await fixture();
        await prepareIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            schedulerReceipt: { step: '08:20', tradeDate: '2026-09-22' },
            now: new Date('2026-09-22T08:20:00+08:00'),
        });
        await inspectIntradayMonitorPremarketDailySession({
            appSupportRoot: value.root, config: value.config, authority: value.authority,
            connectionGeneration: 'simulation:generation-20260922',
            now: new Date('2026-09-22T08:45:00+08:00'),
        });
        let instant = '2026-09-22T08:50:00+08:00';
        const runtime = createIntradayMonitorDailySessionRuntimeAuthority({
            appSupportRoot: value.root, tradeDate: '2026-09-22',
            connectionGeneration: 'simulation:generation-20260922', now: () => instant,
        });
        runtime.markControlPlane({ requested: true, accepted: true });
        instant = '2026-09-22T13:30:15+08:00';
        expect(() => runtime.beginClosing()).toThrow('evidence_stale');
        expect(runtime.evaluate()).toMatchObject({ current: false, phase: 'starting' });
        instant = '2026-09-22T13:34:30+08:00';
        expect(() => runtime.beginClosing()).toThrow('session_closing_transition_outside_window');
    });
});
