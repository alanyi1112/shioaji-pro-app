import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

describe('去敏 service JSONL log wrapper', () => {
    it('只保存事件分類與 hash，不保存 stdout／stderr 原文或秘密值', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'service-log-wrapper-'));
        const logPath = path.join(root, 'service.jsonl');
        try {
            await execute(process.execPath, [
                path.resolve('scripts/intraday-monitor-runtime/service-log-wrapper.mjs'),
                `--log=${logPath}`, '--', process.execPath, '-e',
                "console.log('login token=VERY_PRIVATE_VALUE'); console.error('kbar stream failed')",
            ]);
            const content = await readFile(logPath, 'utf8');
            expect(content).not.toContain('VERY_PRIVATE_VALUE');
            expect(content).not.toContain('kbar stream failed');
            const events = content.trim().split('\n').map(JSON.parse);
            expect(events[0].event).toBe('process_start');
            expect(events.at(-1).event).toBe('process_exit');
            expect(new Set(events.slice(1, -1).map((event) => event.event)))
                .toEqual(new Set(['business_session', 'market_data']));
            expect((await stat(logPath)).mode & 0o777).toBe(0o600);
            expect(events.filter((event) => event.messageHash)
                .every((event) => event.rawMessageSaved === false)).toBe(true);
        } finally { await rm(root, { recursive: true, force: true }); }
    });
});
