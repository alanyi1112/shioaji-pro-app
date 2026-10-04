import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { legacyProductStateV1Fixture } from './fixtures/legacy-product-state-v1.mjs';
import { installIntradayMonitorDailyRolloverState } from './install-daily-rollover-state.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))));

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-rollover-install-'));
    roots.push(root);
    const repo = path.join(root, 'repo');
    const appSupport = path.join(root, 'app-support');
    const acceptance = path.join(repo, 'openspec', 'changes', 'archive',
        '2026-09-16-evaluate-tiered-intraday-monitor-expansion-to-160', 'acceptance');
    const verifierDirectory = path.join(repo, 'openspec', 'changes',
        'repair-intraday-monitor-daily-rollover-and-status-truthfulness', 'acceptance');
    await mkdir(acceptance, { recursive: true });
    await mkdir(verifierDirectory, { recursive: true });
    const artifacts = [
        ['tiered-cohort-stage-160-replaced-6187-2026-09-11.json',
            { schemaVersion: 'intraday-monitor-tiered-cohort-manifest/1' }],
        ['direct-stage-plan-160-product-2026-09-14.json',
            { schemaVersion: 'intraday-monitor-tiered-stage-plan/3' }],
        ['direct-160-prerequisite-2026-09-11.json', { review: { decision: 'GO' } }],
    ];
    for (const [name, value] of artifacts) {
        await writeFile(path.join(acceptance, name), `${JSON.stringify(value)}\n`);
    }
    await writeFile(path.join(verifierDirectory, 'runtime-verifier-metadata.json'),
        `${JSON.stringify({ schemaVersion: 'intraday-monitor-runtime-verifier-metadata/1' })}\n`);
    const monitor = path.join(appSupport, 'IntradayMonitor');
    await mkdir(path.join(monitor, 'premarket'), { recursive: true });
    await writeFile(path.join(monitor, 'direct-160-product-runtime.json'),
        `${JSON.stringify(legacyProductStateV1Fixture())}\n`);
    const configPath = path.join(monitor, 'premarket', 'config.json');
    await writeFile(configPath, `${JSON.stringify({ schemaVersion: 'intraday-monitor-premarket-config/1',
        tradeDate: '2026-09-16', manifestPath: '/obsolete/manifest.json',
        planPath: '/obsolete/plan.json', baselinePath: '/obsolete/baseline.json',
        prerequisitePath: '/obsolete/prerequisite.json', runtimePath: '/runtime' })}\n`);
    const authority = { current: true, isTradingDate: true, tradeDate: '2026-09-23',
        previousTradeDate: '2026-09-22', source: 'fixture official calendar',
        sourceVersions: ['fixture/1'], observedAt: '2026-09-22T04:00:00.000Z' };
    return { root, repo, appSupport, configPath,
        resolveNextTradingDay: async () => authority };
}

describe('daily rollover state installer', () => {
    it('dry-run 驗證 bundle、歷史 migration 與四個 next trigger，但不修改正式狀態', async () => {
        const value = await fixture();
        const before = await readFile(value.configPath, 'utf8');
        const result = await installIntradayMonitorDailyRolloverState({
            execute: false, appSupportRoot: value.appSupport, repoDirectory: value.repo,
            now: new Date('2026-09-22T12:00:00+08:00'),
            resolveNextTradingDay: value.resolveNextTradingDay,
        });
        expect(result).toMatchObject({ mode: 'dry_run', installed: false,
            bundle: { valid: true, roles: ['baseline_prerequisite', 'cohort', 'plan', 'verifier'] },
            migration: { historicalOnly: true, currentSessionCreated: false,
                evidenceTradeDate: '2026-09-16', approvedActiveLimit: 160 },
            originalEvidenceModified: false, serviceLifecycleMutations: 0 });
        expect(result.scheduleReceipts.map((receipt) => receipt.computedLocalTime))
            .toEqual(['2026-09-23 08:20:00', '2026-09-23 08:35:00',
                '2026-09-23 08:45:00', '2026-09-23 08:50:00']);
        expect(await readFile(value.configPath, 'utf8')).toBe(before);
        await expect(access(path.join(value.appSupport, 'IntradayMonitor', 'session-state',
            'capacity-approval.json'))).rejects.toThrow();
    });

    it('execute 安裝 immutable bundle、歷史 approval 並移除固定交易日路徑', async () => {
        const value = await fixture();
        const result = await installIntradayMonitorDailyRolloverState({
            execute: true, appSupportRoot: value.appSupport, repoDirectory: value.repo,
            now: new Date('2026-09-22T12:00:00+08:00'),
            resolveNextTradingDay: value.resolveNextTradingDay,
        });
        const config = JSON.parse(await readFile(value.configPath, 'utf8'));
        expect(result).toMatchObject({ mode: 'execute', installed: true });
        expect(config).toMatchObject({ schemaVersion: 'intraday-monitor-premarket-config/2',
            dailyRollover: true, artifactBundleHash: result.bundle.bundleHash });
        expect(config).not.toHaveProperty('tradeDate');
        expect(config).not.toHaveProperty('manifestPath');
        expect(JSON.parse(await readFile(path.join(value.appSupport, 'IntradayMonitor',
            'session-state', 'capacity-approval.json'), 'utf8'))).toMatchObject({
            evidenceTradeDate: '2026-09-16', reviewerType: 'codex_delegated',
        });
    });
});
