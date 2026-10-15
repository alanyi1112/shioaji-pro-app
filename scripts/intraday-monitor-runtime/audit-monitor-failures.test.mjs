import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { auditIntradayMonitorFailures, monitorFailureAuditPlist } from './audit-monitor-failures.mjs';

const authority = async () => ({ current: true, isTradingDate: true,
    tradeDate: '2026-10-01' });
const dailySummary = () => ({ schemaVersion: 'intraday-monitor-daily-runner/1',
    tradeDate: '2026-10-01', executionOutcome: 'ended',
    startReceipt: { cohortSize: 1 }, closeReceipt: { accepted: true },
    stopReceipt: { stopped: true, unsubscribeAccepted: true },
    resources: { resourceFault: null }, stream: { disconnect: null },
    lastAcceptedEventAt: '2026-10-01T05:33:00Z',
    liveCoverageBySymbol: [{ canonicalSymbol: '2330.TW', state: 'complete',
        observationCount: 270, lastComparableMinute: '13:30' }] });

describe('盤中監控獨立失敗稽核', () => {
    it('08:52 發現 08:50 失敗，13:40 發現正式擷取失敗', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'monitor-failure-audit-'));
        const receiptRoot = path.join(root, 'IntradayMonitor', 'premarket', 'receipts');
        const captureRoot = path.join(root, 'direct-160-live');
        await mkdir(receiptRoot, { recursive: true });
        await mkdir(captureRoot, { recursive: true });
        await writeFile(path.join(receiptRoot, '2026-10-01-0850.json'),
            JSON.stringify({ rolloverOutcome: 'failed', reason: 'direct_160_capture_failed' }));
        await writeFile(path.join(captureRoot, 'capture-2026-10-01.json.failure.json'),
            JSON.stringify({ failedAt: '2026-10-01T05:34:30Z' }));
        const notify = vi.fn(async (incident) => incident);
        const morning = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T08:52:00+08:00'), resolveTradingDay: authority, notify });
        expect(morning.notices).toMatchObject([{
            step: '08:50', kind: 'direct_160_capture_failed' }]);
        const afternoon = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'), resolveTradingDay: authority, notify });
        expect(afternoon.notices).toMatchObject([{
            step: '08:50', kind: 'direct_160_capture_failed' },
        { step: '13:40', kind: 'direct_160_capture_failed' }]);
    });

    it('非交易日不發警示，正式證據完整則不誤報', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'monitor-audit-noop-'));
        const notify = vi.fn();
        expect((await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'),
            resolveTradingDay: async () => ({ current: true, isTradingDate: false,
                tradeDate: '2026-10-01' }), notify })).checked).toBe(false);
        const receiptRoot = path.join(root, 'IntradayMonitor', 'premarket', 'receipts');
        const captureRoot = path.join(root, 'direct-160-live');
        await mkdir(receiptRoot, { recursive: true });
        await mkdir(captureRoot, { recursive: true });
        await writeFile(path.join(receiptRoot, '2026-10-01-0850.json'),
            JSON.stringify({ rolloverOutcome: 'step_complete' }));
        await writeFile(path.join(captureRoot, 'capture-2026-10-01.json'),
            JSON.stringify({ assessment: { formalAcceptanceEvidence: true } }));
        expect((await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'),
            resolveTradingDay: authority, notify })).notices).toEqual([]);
        expect(notify).not.toHaveBeenCalled();
    });

    it('08:52 正式擷取仍在執行時，不把尚未產生收尾收據誤報為失敗', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'monitor-audit-running-'));
        const monitorRoot = path.join(root, 'IntradayMonitor');
        await mkdir(path.join(monitorRoot, 'premarket', 'claims'), { recursive: true });
        await mkdir(path.join(monitorRoot, 'session-state', 'sessions'), { recursive: true });
        await writeFile(path.join(monitorRoot, 'premarket', 'claims',
            '2026-10-01-0850.json'), JSON.stringify({ tradeDate: '2026-10-01',
            step: '08:50', claimedAt: '2026-10-01T00:50:06Z' }));
        await writeFile(path.join(monitorRoot, 'session-state', 'sessions',
            '2026-10-01.json'), JSON.stringify({ tradeDate: '2026-10-01',
            phase: 'starting', controlPlane: { accepted: true }, blocker: null,
            updatedAt: '2026-10-01T00:50:10Z' }));
        const notify = vi.fn();
        const running = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T08:52:00+08:00'), resolveTradingDay: authority, notify });
        expect(running.notices).toEqual([]);
        expect(notify).not.toHaveBeenCalled();

        const stale = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T08:56:00+08:00'), resolveTradingDay: authority,
            notify: vi.fn(async (incident) => incident) });
        expect(stale.notices).toMatchObject([{ step: '08:50',
            kind: 'premarket_step_failed' }]);
    });

    it('daily mode 13:40 只核對逐檔小型摘要，不要求舊 capture 檔', async () => {
        const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'daily-audit-')));
        const monitorRoot = path.join(root, 'IntradayMonitor');
        const dailyRoot = path.join(monitorRoot, 'daily-run', '2026-10-01');
        await mkdir(dailyRoot, { recursive: true, mode: 0o700 });
        await writeFile(path.join(monitorRoot, 'daily-runtime-mode.json'), JSON.stringify({
            schemaVersion: 'intraday-minute-volume-runtime-mode/1', mode: 'daily',
            screenerDatabasePath: path.join(root, 'screener.sqlite3'),
            limits: { maxRequests: 320, maxResponseBytes: 2 * 1024 ** 2,
                requestTimeoutMs: 20_000, maxAttempts: 3,
                cooldownMs: 15 * 60_000, deadlineTime: '19:00:00' },
        }), { mode: 0o600 });
        await mkdir(path.join(monitorRoot, 'premarket', 'receipts'), { recursive: true });
        await writeFile(path.join(monitorRoot, 'premarket', 'receipts',
            '2026-10-01-0850.json'), JSON.stringify({ rolloverOutcome: 'step_complete' }));
        await writeFile(path.join(dailyRoot, 'summary.json'),
            JSON.stringify(dailySummary()), { mode: 0o600 });
        const notify = vi.fn(async incident => incident);
        const completed = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'), resolveTradingDay: authority, notify });
        expect(completed.notices).toEqual([]);
        expect(completed.dailyMonitor).toMatchObject({ state: 'ended',
            completeCount: 1, partialCount: 0, lastComparableMinute: '13:30' });
        expect(completed.nextBaseline).toMatchObject({ state: 'unknown' });
        const collectionRoot = path.join(monitorRoot,
            'daily-minute-volume-collection', '2026-10-01');
        await mkdir(collectionRoot, { recursive: true });
        await writeFile(path.join(collectionRoot, 'attempt-01-claim.json'), JSON.stringify({
            schemaVersion: 'intraday-minute-volume-collection/2',
            sourceDate: '2026-10-01', attempt: 1, ownerPid: process.pid }), { mode: 0o600 });
        const collecting = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'), resolveTradingDay: authority, notify });
        expect(collecting.nextBaseline).toMatchObject({ state: 'collecting', attempt: 1 });
        expect(collecting.notices).toEqual([]);
        await writeFile(path.join(dailyRoot, 'summary.json'), JSON.stringify({
            ...dailySummary(), executionOutcome: 'partial',
            resources: { resourceFault: 'disk_reserve_insufficient' },
            liveCoverageBySymbol: [{ canonicalSymbol: '2330.TW', state: 'partial',
                observationCount: 269, lastComparableMinute: '13:29' }],
        }), { mode: 0o600 });
        const incomplete = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'), resolveTradingDay: authority, notify });
        expect(incomplete.notices).toMatchObject([{ kind: 'daily_monitor_incomplete',
            step: '13:40' }]);
        expect(incomplete.dailyMonitor).toMatchObject({ state: 'partial',
            reason: 'disk_reserve_insufficient', completeCount: 0, partialCount: 1 });
    });

    it('daily 13:40 無摘要但 owner lock 殘留、或摘要寫入失敗，分開記錄而不冒稱程序正常', async () => {
        const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'daily-audit-missing-')));
        const monitorRoot = path.join(root, 'IntradayMonitor');
        await mkdir(monitorRoot, { recursive: true });
        await writeFile(path.join(monitorRoot, 'daily-runtime-mode.json'), JSON.stringify({
            schemaVersion: 'intraday-minute-volume-runtime-mode/1', mode: 'daily',
            screenerDatabasePath: path.join(root, 'screener.sqlite3'),
            limits: { maxRequests: 320, maxResponseBytes: 1024,
                requestTimeoutMs: 1000, maxAttempts: 3,
                cooldownMs: 15 * 60_000, deadlineTime: '19:00:00' },
        }), { mode: 0o600 });
        await mkdir(path.join(monitorRoot, 'premarket', 'receipts'), { recursive: true });
        await writeFile(path.join(monitorRoot, 'premarket', 'receipts',
            '2026-10-01-0850.json'), JSON.stringify({ rolloverOutcome: 'step_complete' }));
        const registry = path.join(root, 'direct-160-live', 'registry');
        await mkdir(registry, { recursive: true });
        const claimPath = path.join(registry, 'daily-2026-10-01-generation.json');
        await writeFile(claimPath, JSON.stringify({ tradeDate: '2026-10-01',
            ownerPid: 12345 }));
        await writeFile(path.join(registry, 'active.lock'), JSON.stringify({
            tradeDate: '2026-10-01', claimPath, ownerPid: 12345 }));
        const notify = vi.fn(async incident => incident);
        const missing = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'), resolveTradingDay: authority, notify,
            processProbe: () => false });
        expect(missing.dailyMonitor).toMatchObject({ state: 'unknown',
            reason: 'owner_process_exited_without_summary', ownerLockPresent: true,
            ownerProcessState: 'exited' });
        const dailyRoot = path.join(monitorRoot, 'daily-run', '2026-10-01');
        await mkdir(dailyRoot, { recursive: true });
        await writeFile(path.join(dailyRoot, 'summary-write-failed.json'), JSON.stringify({
            reason: 'summary_write_failed' }));
        const failed = await auditIntradayMonitorFailures({ root,
            now: new Date('2026-10-01T13:40:00+08:00'), resolveTradingDay: authority, notify,
            processProbe: () => true });
        expect(failed.dailyMonitor).toMatchObject({ state: 'failed',
            reason: 'summary_write_failed', ownerLockPresent: true, ownerProcessState: 'alive' });
    });

    it('盤後基準 claim 須由仍在運作的程序證明採集中，退出或逾時不得冒稱採集', async () => {
        const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'daily-baseline-audit-')));
        const monitorRoot = path.join(root, 'IntradayMonitor');
        const collectionRoot = path.join(monitorRoot, 'daily-minute-volume-collection', '2026-10-01');
        await mkdir(collectionRoot, { recursive: true });
        await writeFile(path.join(monitorRoot, 'daily-runtime-mode.json'), JSON.stringify({
            schemaVersion: 'intraday-minute-volume-runtime-mode/1', mode: 'daily',
            screenerDatabasePath: path.join(root, 'screener.sqlite3'),
            limits: { maxRequests: 320, maxResponseBytes: 1024,
                requestTimeoutMs: 1000, maxAttempts: 3,
                cooldownMs: 15 * 60_000, deadlineTime: '14:30:00' },
        }), { mode: 0o600 });
        await writeFile(path.join(collectionRoot, 'attempt-01-claim.json'), JSON.stringify({
            schemaVersion: 'intraday-minute-volume-collection/2',
            sourceDate: '2026-10-01', attempt: 1, ownerPid: 12345 }));
        const check = (at, processProbe) => auditIntradayMonitorFailures({ root,
            now: new Date(at), resolveTradingDay: authority,
            notify: async incident => incident, processProbe });
        expect((await check('2026-10-01T13:40:00+08:00', () => true)).nextBaseline)
            .toMatchObject({ state: 'collecting', reason: null });
        expect((await check('2026-10-01T13:40:00+08:00', () => false)).nextBaseline)
            .toMatchObject({ state: 'failed', reason: 'collector_process_exited_without_receipt' });
        expect((await check('2026-10-01T14:31:00+08:00', () => true)).nextBaseline)
            .toMatchObject({ state: 'failed', reason: 'collection_deadline_exceeded' });
    });

    it('安裝描述包含開盤前後獨立稽核時點', () => {
        const plist = monitorFailureAuditPlist('/tmp/audit-monitor-failures.mjs');
        expect(plist).toContain('<integer>8</integer><key>Minute</key><integer>52</integer>');
        expect(plist).toContain('<integer>13</integer><key>Minute</key><integer>40</integer>');
    });
});
