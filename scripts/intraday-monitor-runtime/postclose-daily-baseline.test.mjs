import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createTieredCohortManifests } from './tiered-capacity-stage-artifacts.mjs';
import { importIntradayMonitorRuntimeArtifactBundle } from './runtime-artifact-bundle.mjs';
import { IntradayMonitorSessionStateRepository, createCapacityApprovalRecord } from './session-state-repository.mjs';
import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { buildPostcloseBaselineLaunchAgentPlist, resolvePostcloseBaselineCalendar,
    resolvePostcloseDailyBaselinePaths, resolveHistoricalBaselinePaths, runPostcloseDailyBaseline,
    inspectPostcloseDailyBaseline, buildPostcloseBaselineRetryLaunchAgentPlist } from './postclose-daily-baseline.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'postclose-baseline-'));
    roots.push(root);
    const repo = path.join(root, 'repo');
    const source = path.join(repo, 'acceptance');
    await mkdir(source, { recursive: true });
    const contracts = Array.from({ length: 160 }, (_, index) => ({
        security_type: 'STK', region: 'TW', exchange: 'TSE',
        code: String(1001 + index), target_code: null,
    }));
    const cohort = createTieredCohortManifests({ contracts, config: { revision: 1,
        items: contracts.map((contract) => ({ contract, enabled: true })) },
    sourceVersion: 'fixture-only/1', createdAt: '2026-09-11T14:00:00+08:00' })[160];
    const files = { cohort,
        plan: { schemaVersion: 'plan/1', stage: 160 },
        baseline_prerequisite: { schemaVersion: 'prerequisite/1', decision: 'GO' },
    };
    for (const [role, body] of Object.entries(files)) {
        await writeFile(path.join(source, `${role}.json`), JSON.stringify(body));
    }
    const bundle = await importIntradayMonitorRuntimeArtifactBundle({
        appSupportRoot: root, repoDirectory: repo, sourceIdentity: 'test-postclose',
        artifacts: Object.keys(files).map((role) => ({ role, path: path.join(source, `${role}.json`),
            schema: files[role].schemaVersion, dependencies: [] })),
    });
    const state = new IntradayMonitorSessionStateRepository(root);
    state.writeApproval(createCapacityApprovalRecord({
        approvedActiveLimit: 160, stage: 160, decision: 'go', reviewerType: 'codex_delegated',
        reviewerId: 'codex-delegated-review', reviewedAt: '2026-09-10T14:00:00+08:00',
        evidenceTradeDate: '2026-09-10', artifactBundleHash: bundle.bundleHash,
        authorizationProvenance: 'fixture', providerEvidence: { physicalUsage: null,
            otherUsage: null, globalOwnershipComplete: null, releaseProven: null, headroom: null },
    }));
    const configPath = path.join(root, 'IntradayMonitor', 'premarket', 'config.json');
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({ artifactBundleHash: bundle.bundleHash }));
    const baseline = fixtureBaseline(cohort);
    const calendarResolver = async () => ({ tradeDate: '2026-09-11', targetTradeDate: '2026-09-14',
        twse: baseline.calendar.twse, tpex: baseline.calendar.tpex,
        calendarSourceVersion: baseline.calendar.sourceVersion });
    const limit = 524_288_000;
    const sampleReader = async () => ['2026-09-09', '2026-09-10'].map((tradeDate, index) => ({
        tradeDate, manifestHash: cohort.manifestHash, consumedBytes: 18_000_000 + index * 2_000_000,
        providerLimitBytes: limit, verificationSha256: 'a'.repeat(64),
        baselineSha256: 'b'.repeat(64),
        sourceSha256: 'c'.repeat(64), usageStartSha256: 'd'.repeat(64),
        usageEndSha256: 'e'.repeat(64),
    }));
    const preflight = async () => ({ usage: { bytes: limit - 227_592_915,
        remaining_bytes: 227_592_915, limit_bytes: limit },
    availableDiskBytes: 16 * 1024 ** 3, apiVersion: 'fixture' });
    return { root, cohort, baseline, calendarResolver, sampleReader, preflight,
        now: new Date('2026-09-11T13:36:00+08:00') };
}

describe('收盤後隔日 160 檔基準', () => {
    it('盤後先讀 TWSE 官方 OpenAPI，完成雙市場日曆後供隔日離線使用', async () => {
        const value = await fixture();
        const urls = [];
        const twseRows = value.baseline.calendar.twse.data.map(([date, name, description]) => ({
            Date: `115${date.slice(5, 7)}${date.slice(8, 10)}`,
            Name: name, Description: description,
        }));
        const calendar = await resolvePostcloseBaselineCalendar({ now: value.now,
            fetchImpl: async (url) => {
                urls.push(url);
                if (url.includes('www.twse.com.tw')) throw new Error('old endpoint unavailable');
                return { ok: true, status: 200,
                    json: async () => url.includes('openapi.twse.com.tw')
                        ? twseRows : value.baseline.calendar.tpex };
            },
        });
        expect(calendar).toMatchObject({ tradeDate: '2026-09-11',
            targetTradeDate: '2026-09-14' });
        expect(urls.some((url) => url.includes('openapi.twse.com.tw'))).toBe(true);
        expect(urls.some((url) => url.includes('www.twse.com.tw'))).toBe(false);
    });

    it('歷史補建使用獨立 claim／receipt，且只能補過去 30 日與未來目標交易日', async () => {
        const value = await fixture();
        const sourceDate = '2026-09-11';
        const original = resolvePostcloseDailyBaselinePaths(value.root, sourceDate);
        const historical = resolveHistoricalBaselinePaths(value.root, sourceDate);
        expect(historical.receiptPath).not.toBe(original.receiptPath);
        const blocked = await runPostcloseDailyBaseline({ root: value.root,
            now: new Date('2026-09-14T10:00:00+08:00'), historicalTradeDate: sourceDate,
            calendarResolver: value.calendarResolver });
        expect(blocked.receipt).toMatchObject({ outcome: 'failed',
            reason: 'historical_target_date_not_future', historicalBackfill: true });
        await expect(readFile(original.receiptPath, 'utf8'))
            .rejects.toMatchObject({ code: 'ENOENT' });
        expect(await runPostcloseDailyBaseline({ root: value.root,
            now: new Date('2026-10-20T10:00:00+08:00'), historicalTradeDate: sourceDate }))
            .toMatchObject({ executed: false, reason: 'historical_date_out_of_bounds' });
    });

    it('歷史補建 160 檔驗證成功才原子發布，原排程失敗收據保持原文', async () => {
        const value = await fixture();
        const original = resolvePostcloseDailyBaselinePaths(value.root, '2026-09-11');
        await mkdir(path.dirname(original.receiptPath), { recursive: true });
        const failedRaw = '{"outcome":"failed","reason":"fetch_failed"}\n';
        await writeFile(original.receiptPath, failedRaw);
        const commands = [];
        const result = await runPostcloseDailyBaseline({ root: value.root,
            now: new Date('2026-09-13T16:00:00+08:00'),
            historicalTradeDate: '2026-09-11', calendarResolver: value.calendarResolver,
            preflight: value.preflight, sampleReader: value.sampleReader,
            execute: async (_command, args) => {
                commands.push(args);
                const output = args.find((arg) => arg.startsWith('--output=')).slice(9);
                await mkdir(output, { recursive: true });
                if (args[0].endsWith('build-direct-160-baseline.mjs')) {
                    await writeFile(path.join(output, 'baseline-set.json'),
                        JSON.stringify(value.baseline));
                }
                return { exitCode: 0, stdoutBytes: 0, stderrBytes: 0 };
            } });
        expect(result.receipt).toMatchObject({ outcome: 'verified', historicalBackfill: true,
            scheduledRunAttribution: 'not_applicable', targetTradeDate: '2026-09-14' });
        expect(commands[0]).toContain('--historical-backfill');
        expect(await readFile(original.receiptPath, 'utf8')).toBe(failedRaw);
        expect(JSON.parse(await readFile(result.receipt.baselinePath, 'utf8')).baselineHash)
            .toBe(value.baseline.baselineHash);
        expect(await runPostcloseDailyBaseline({ root: value.root,
            now: new Date('2026-09-13T16:01:00+08:00'),
            historicalTradeDate: '2026-09-11' })).toMatchObject({
            executed: false, reason: 'already_verified',
        });
        expect(await readFile(original.receiptPath, 'utf8')).toBe(failedRaw);
    });
    it('未到 13:35 不 claim、不讀來源', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'postclose-baseline-early-'));
        roots.push(root);
        const calendarResolver = () => { throw new Error('must not run'); };
        const result = await runPostcloseDailyBaseline({ root,
            now: new Date('2026-09-11T13:34:59+08:00'), calendarResolver });
        expect(result).toMatchObject({ executed: false, reason: 'postclose_baseline_window_not_open' });
    });

    it('流量不足保留失敗 receipt，不採集、不發布且重跑不覆寫', async () => {
        const value = await fixture();
        let commands = 0;
        const run = () => runPostcloseDailyBaseline({ root: value.root, now: value.now,
            calendarResolver: value.calendarResolver,
            preflight: async () => { throw new Error('provider_bandwidth_reserve_insufficient'); },
            execute: async () => { commands++; return { exitCode: 0 }; } });
        const first = await run();
        expect(first).toMatchObject({ executed: false, receipt: { outcome: 'failed',
            reason: 'provider_bandwidth_reserve_insufficient',
            calendarEvidence: { tradeDate: '2026-09-11', targetTradeDate: '2026-09-14' } } });
        const paths = resolvePostcloseDailyBaselinePaths(value.root, '2026-09-11');
        const raw = await readFile(paths.receiptPath, 'utf8');
        const second = await run();
        expect(second).toMatchObject({ executed: false, reason: 'retry_window_not_open' });
        expect(await readFile(paths.receiptPath, 'utf8')).toBe(raw);
        expect(commands).toBe(0);
        const status = await inspectPostcloseDailyBaseline({ root: value.root,
            tradeDate: '2026-09-11' });
        expect(status).toMatchObject({ state: 'failed', receipt: {
            reason: 'provider_bandwidth_reserve_insufficient' } });
    });

    it('完整 160 檔才發布精確隔日路徑，收據保存來源和輸出 identity', async () => {
        const value = await fixture();
        const commands = [];
        const result = await runPostcloseDailyBaseline({ root: value.root, now: value.now,
            calendarResolver: value.calendarResolver,
            preflight: value.preflight, sampleReader: value.sampleReader,
            execute: async (_command, args) => {
                commands.push(args);
                if (args[0].endsWith('collect-direct-160-baseline.py')) {
                    const sourceDirectory = args.find((arg) => arg.startsWith('--output=')).slice(9);
                    await mkdir(sourceDirectory, { recursive: true });
                } else {
                    const outputDirectory = args.find((arg) => arg.startsWith('--output=')).slice(9);
                    await mkdir(outputDirectory, { recursive: true });
                    await writeFile(path.join(outputDirectory, 'baseline-set.json'),
                        JSON.stringify(value.baseline));
                }
                return { exitCode: 0, stdoutBytes: 0, stderrBytes: 0 };
            } });
        expect(result).toMatchObject({ executed: true, receipt: { outcome: 'verified',
            baselineHash: value.baseline.baselineHash,
            targetTradeDate: '2026-09-14' } });
        expect(commands).toHaveLength(2);
        expect(result.receipt.baselinePath).toContain('2026-09-11-for-2026-09-14-verified');
        const paths = resolvePostcloseDailyBaselinePaths(value.root, '2026-09-11');
        expect(JSON.parse(await readFile(path.join(paths.sourceDirectory,
            'twse-calendar.json'), 'utf8'))).toEqual(value.baseline.calendar.twse);
    });

    it('來源只有部分商品時保留失敗與來源目錄，不發布基準', async () => {
        const value = await fixture();
        const result = await runPostcloseDailyBaseline({ root: value.root, now: value.now,
            calendarResolver: value.calendarResolver,
            preflight: value.preflight, sampleReader: value.sampleReader,
            execute: async (_command, args) => {
                const sourceDirectory = args.find((arg) => arg.startsWith('--output=')).slice(9);
                await mkdir(sourceDirectory, { recursive: true });
                return { exitCode: 1, stdoutBytes: 0, stderrBytes: 0 };
            } });
        expect(result).toMatchObject({ executed: false, receipt: { outcome: 'failed',
            reason: 'baseline_collect_failed' } });
        expect(result.receipt.sourceDirectory).toContain('2026-09-11-direct160-source');
        await expect(readFile(result.receipt.baselinePath, 'utf8'))
            .rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('驗證只有 159 檔時保留 report，不發布 baseline-set', async () => {
        const value = await fixture();
        const result = await runPostcloseDailyBaseline({ root: value.root, now: value.now,
            calendarResolver: value.calendarResolver,
            preflight: value.preflight, sampleReader: value.sampleReader,
            execute: async (_command, args) => {
                const output = args.find((arg) => arg.startsWith('--output=')).slice(9);
                await mkdir(output, { recursive: true });
                if (args[0].endsWith('build-direct-160-baseline.mjs')) {
                    await writeFile(path.join(output, 'verification.json'),
                        JSON.stringify({ verifiedCount: 159, expectedCount: 160,
                            baselineUsable: false }));
                    return { exitCode: 1, stdoutBytes: 0, stderrBytes: 0 };
                }
                return { exitCode: 0, stdoutBytes: 0, stderrBytes: 0 };
            } });
        expect(result.receipt).toMatchObject({ outcome: 'failed',
            reason: 'baseline_build_failed' });
        expect(JSON.parse(await readFile(result.receipt.verificationPath, 'utf8')))
            .toMatchObject({ verifiedCount: 159, baselineUsable: false });
        await expect(readFile(result.receipt.baselinePath, 'utf8'))
            .rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('既有基準損毀時不再次採集也不覆寫', async () => {
        const value = await fixture();
        const baselinePath = path.join(value.root, 'intraday-baselines',
            '2026-09-11-for-2026-09-14-verified', 'baseline-set.json');
        await mkdir(path.dirname(baselinePath), { recursive: true });
        await writeFile(baselinePath, '{invalid-json');
        let commands = 0;
        const result = await runPostcloseDailyBaseline({ root: value.root, now: value.now,
            calendarResolver: value.calendarResolver,
            preflight: value.preflight,
            execute: async () => { commands++; return { exitCode: 0 }; } });
        expect(result.receipt).toMatchObject({ outcome: 'failed', reason: 'existing_baseline_invalid' });
        expect(await readFile(baselinePath, 'utf8')).toBe('{invalid-json');
        expect(commands).toBe(0);
    });

    it('真實 preflight 依歷史樣本計算動態預算，不受固定 256 MiB 啟動門檻限制', async () => {
        const value = await fixture();
        await writeFile(path.join(value.root, 'runtime-mode'), 'simulation\n');
        let commands = 0;
        const fetchImpl = async (url) => {
            const body = url.endsWith('/info') ? { simulation: true, version: 'fixture' }
                : url.endsWith('/health') ? { status: 'healthy' }
                    : url.endsWith('/snapshots') ? [{ code: '2330' }]
                        : { limit_bytes: 524_288_000, bytes: 296_695_085,
                            remaining_bytes: 227_592_915 };
            return { ok: true, status: 200, json: async () => body };
        };
        const result = await runPostcloseDailyBaseline({ root: value.root, now: value.now,
            calendarResolver: value.calendarResolver, fetchImpl,
            sampleReader: value.sampleReader,
            execute: async () => { commands++; return { exitCode: 1 }; } });
        expect(result.receipt).toMatchObject({ outcome: 'failed',
            reason: 'baseline_collect_failed', budgetEvidence: { ready: true,
                remainingBytes: 227_592_915 } });
        expect(result.receipt.budgetEvidence.requiredStartBytes).toBeLessThan(227_592_915);
        expect(commands).toBe(1);
    });

    it('官方年度日曆不可用時不推測下一交易日', async () => {
        const now = new Date('2026-09-11T13:36:00+08:00');
        await expect(resolvePostcloseBaselineCalendar({ now,
            fetchImpl: async () => ({ ok: true, status: 200, json: async () => '<!DOCTYPE html>' }),
        })).rejects.toThrow();
    });

    it('休市日只保留不可覆寫的失敗 receipt，不採集或推測日期', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'postclose-baseline-holiday-'));
        roots.push(root);
        let commands = 0;
        const result = await runPostcloseDailyBaseline({ root,
            now: new Date('2026-09-12T13:36:00+08:00'),
            calendarResolver: async () => { throw new Error('official_non_trading_date'); },
            execute: async () => { commands++; return { exitCode: 0 }; } });
        expect(result.receipt).toMatchObject({ outcome: 'failed',
            reason: 'official_non_trading_date', baselinePath: null });
        expect(commands).toBe(0);
    });

    it('LaunchAgent 只安排 13:35，不包含 API 啟停或登入', () => {
        const plist = buildPostcloseBaselineLaunchAgentPlist('/tmp/postclose-daily-baseline.mjs');
        expect(plist).toContain('<key>Hour</key><integer>13</integer>');
        expect(plist).toContain('<key>Minute</key><integer>35</integer>');
        expect(plist).not.toMatch(/KeepAlive|StartInterval|realtimestock-runtime simulation/);
    });

    it('重試 LaunchAgent 僅安排 14:15 與 14:55', () => {
        const plist = buildPostcloseBaselineRetryLaunchAgentPlist('/tmp/postclose-daily-baseline.mjs');
        expect(plist).toContain('<key>Minute</key><integer>15</integer>');
        expect(plist).toContain('<key>Minute</key><integer>55</integer>');
        expect(plist).not.toMatch(/KeepAlive|StartInterval|realtimestock-runtime simulation/);
    });

    it('舊版 13:35 失敗收據保留原文，14:15 並行重試只執行一次且成功後不再採集', async () => {
        const value = await fixture();
        const oldRun = await runPostcloseDailyBaseline({ root: value.root, now: value.now,
            calendarResolver: value.calendarResolver,
            preflight: async () => { throw new Error('provider_bandwidth_reserve_insufficient'); },
        });
        expect(oldRun.receipt.outcome).toBe('failed');
        const firstPaths = resolvePostcloseDailyBaselinePaths(value.root, '2026-09-11');
        const firstClaimRaw = await readFile(firstPaths.claimPath, 'utf8');
        const firstReceiptRaw = await readFile(firstPaths.receiptPath, 'utf8');
        let collectors = 0;
        const execute = async (_command, args) => {
            const output = args.find((arg) => arg.startsWith('--output=')).slice(9);
            await mkdir(output, { recursive: true });
            if (args[0].endsWith('collect-direct-160-baseline.py')) {
                collectors++;
            } else {
                await writeFile(path.join(output, 'baseline-set.json'), JSON.stringify(value.baseline));
            }
            return { exitCode: 0, stdoutBytes: 0, stderrBytes: 0 };
        };
        const options = { root: value.root, now: new Date('2026-09-11T14:16:00+08:00'),
            trigger: 'scheduled', calendarResolver: value.calendarResolver,
            preflight: value.preflight, sampleReader: value.sampleReader, execute };
        const results = await Promise.all([
            runPostcloseDailyBaseline(options), runPostcloseDailyBaseline(options),
        ]);
        expect(results.filter((item) => item.executed)).toHaveLength(1);
        expect(collectors).toBe(1);
        const retryPaths = resolvePostcloseDailyBaselinePaths(value.root, '2026-09-11', 2);
        expect(JSON.parse(await readFile(retryPaths.receiptPath, 'utf8'))).toMatchObject({
            outcome: 'verified', attempt: 2, trigger: 'scheduled',
            budgetEvidence: { ready: true, sampleDates: ['2026-09-10', '2026-09-09'] },
        });
        expect(await readFile(firstPaths.claimPath, 'utf8')).toBe(firstClaimRaw);
        expect(await readFile(firstPaths.receiptPath, 'utf8')).toBe(firstReceiptRaw);
        expect(await runPostcloseDailyBaseline({ ...options,
            now: new Date('2026-09-11T14:56:00+08:00') })).toMatchObject({
            executed: false, reason: 'already_verified',
        });
        await expect(readFile(resolvePostcloseDailyBaselinePaths(value.root,
            '2026-09-11', 3).claimPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('兩次可恢復失敗後只允許 14:55 第三次，失敗收據各自不可覆寫', async () => {
        const value = await fixture();
        const options = { root: value.root, calendarResolver: value.calendarResolver,
            preflight: async () => { throw new Error('business_session_unavailable'); } };
        const first = await runPostcloseDailyBaseline({ ...options, now: value.now });
        const second = await runPostcloseDailyBaseline({ ...options,
            now: new Date('2026-09-11T14:16:00+08:00'), trigger: 'scheduled' });
        const third = await runPostcloseDailyBaseline({ ...options,
            now: new Date('2026-09-11T14:56:00+08:00'), trigger: 'scheduled' });
        expect([first.receipt?.attempt, second.receipt?.attempt, third.receipt?.attempt])
            .toEqual([1, 2, 3]);
        const paths = [1, 2, 3].map((attempt) =>
            resolvePostcloseDailyBaselinePaths(value.root, '2026-09-11', attempt));
        const before = await Promise.all(paths.map((item) => readFile(item.receiptPath, 'utf8')));
        const fourth = await runPostcloseDailyBaseline({ ...options,
            now: new Date('2026-09-11T15:00:00+08:00') });
        expect(fourth).toMatchObject({ executed: false, reason: 'attempt_limit_reached' });
        expect(await Promise.all(paths.map((item) => readFile(item.receiptPath, 'utf8'))))
            .toEqual(before);
    });
});
