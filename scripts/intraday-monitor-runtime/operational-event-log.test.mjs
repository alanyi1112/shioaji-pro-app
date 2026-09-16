import path from 'node:path';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
    INTRADAY_MONITOR_OPERATIONAL_LOG_MAX_BYTES,
    appendIntradayMonitorOperationalEvent,
} from './operational-event-log.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))));

describe('盤中監控共用 operational event log', () => {
    it('保存去敏 schema、incident authority 與 0600 權限', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'intraday-log-'));
        roots.push(root);
        const logPath = path.join(root, 'private', 'events.jsonl');
        await appendIntradayMonitorOperationalEvent(logPath, {
            event: 'first_minute_canary', component: 'capture', tradeDate: '2026-09-16',
            severity: 'incident', alertEligible: true,
            details: { missingCount: 1, token: 'must-not-leak', password: 'must-not-leak' },
        });
        const text = await readFile(logPath, 'utf8');
        expect(text).toContain('intraday-monitor-operational-event/1');
        expect(text).toContain('[REDACTED_SECRET]');
        expect(text).not.toContain('must-not-leak');
        expect(JSON.parse(text)).toMatchObject({ event: 'first_minute_canary',
            severity: 'incident', alertEligible: true, brokerWriteAuthority: false });
        expect((await stat(logPath)).mode & 0o777).toBe(0o600);
    });

    it('超過容量上限時輪替且保留新事件', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'intraday-log-'));
        roots.push(root);
        const logPath = path.join(root, 'events.jsonl');
        await writeFile(logPath, Buffer.alloc(INTRADAY_MONITOR_OPERATIONAL_LOG_MAX_BYTES, 0x20),
            { mode: 0o644 });
        await appendIntradayMonitorOperationalEvent(logPath, {
            event: 'capture_started', component: 'capture', details: {},
        });
        expect((await stat(`${logPath}.1`)).size).toBe(INTRADAY_MONITOR_OPERATIONAL_LOG_MAX_BYTES);
        expect(await readFile(logPath, 'utf8')).toContain('capture_started');
        expect((await stat(logPath)).mode & 0o777).toBe(0o600);
    });
});
