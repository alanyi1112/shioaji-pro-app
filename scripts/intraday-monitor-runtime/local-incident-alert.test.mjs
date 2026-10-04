import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { recordIntradayMonitorLocalIncident } from './local-incident-alert.mjs';

describe('盤中監控本機失敗警示', () => {
    it('同一日同一步驟只嘗試一次，且不把 OS 接手說成使用者已看見', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'monitor-alert-'));
        const execFileImpl = vi.fn((_file, _args, _options, done) => done(null));
        const options = { root, tradeDate: '2026-10-01', step: '08:50',
            kind: 'direct_160_capture_failed', platform: 'darwin', execFileImpl };
        const first = await recordIntradayMonitorLocalIncident(options);
        const second = await recordIntradayMonitorLocalIncident(options);
        expect(first).toMatchObject({ attempted: true, handoff: 'os_handoff' });
        expect(second).toMatchObject({ attempted: false, reason: 'already_recorded' });
        expect(execFileImpl).toHaveBeenCalledTimes(1);
        expect(JSON.parse(await readFile(first.receiptPath, 'utf8'))).toMatchObject({
            handoff: 'os_handoff', userSawNotification: null, brokerWriteAuthority: false,
            productionAuthority: false });
    });

    it('通知權限或 osascript 失敗只記錄交付失敗，不掩蓋原始擷取失敗', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'monitor-alert-failure-'));
        const result = await recordIntradayMonitorLocalIncident({ root,
            tradeDate: '2026-10-01', step: '08:35', kind: 'premarket_step_failed',
            platform: 'darwin', execFileImpl: (_file, _args, _options, done) =>
                done(new Error('notification denied')) });
        expect(result).toMatchObject({ attempted: true, handoff: 'failed' });
        expect(JSON.parse(await readFile(result.receiptPath, 'utf8')).handoff).toBe('failed');
        const retry = await recordIntradayMonitorLocalIncident({ root,
            tradeDate: '2026-10-01', step: '08:35', kind: 'premarket_step_failed',
            platform: 'darwin', execFileImpl: (_file, _args, _options, done) => done(null) });
        expect(retry).toMatchObject({ attempted: true, handoff: 'os_handoff' });
        expect(retry.receiptPath).toContain('-retry.json');
    });
});
