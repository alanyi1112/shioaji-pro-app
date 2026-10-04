import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { auditIntradayMonitorFailures, monitorFailureAuditPlist } from './audit-monitor-failures.mjs';

const authority = async () => ({ current: true, isTradingDate: true,
    tradeDate: '2026-10-01' });

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

    it('安裝描述包含開盤前後獨立稽核時點', () => {
        const plist = monitorFailureAuditPlist('/tmp/audit-monitor-failures.mjs');
        expect(plist).toContain('<integer>8</integer><key>Minute</key><integer>52</integer>');
        expect(plist).toContain('<integer>13</integer><key>Minute</key><integer>40</integer>');
    });
});
