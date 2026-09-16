import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectDirect160StageStart, validateFreshSimulationGeneration,
    writeDirect160CaptureFailure } from './capture-direct-160-stage.mjs';

describe('direct 160 stage launcher preflight', () => {
    it('完整日只接受 08:50–09:00:30，錯過即拒絕', () => {
        expect(inspectDirect160StageStart({ tradeDate: '2026-09-15', mode: 'full-session',
            nowEpochMs: Date.parse('2026-09-15T08:50:00+08:00') })).toEqual({
            allowed: true,
            reason: null,
            endEpochMs: Date.parse('2026-09-15T13:34:30+08:00'),
        });
        expect(inspectDirect160StageStart({ tradeDate: '2026-09-15', mode: 'full-session',
            nowEpochMs: Date.parse('2026-09-15T09:00:31+08:00') }))
            .toEqual({ allowed: false, reason: 'full_session_start_missed' });
    });

    it('盤中 rehearsal 有界且 simulation generation 必須和 08:20–08:35 anchor 一致', () => {
        expect(inspectDirect160StageStart({ tradeDate: '2026-09-15', mode: 'partial-rehearsal',
            durationMs: 120_000, nowEpochMs: Date.parse('2026-09-15T10:00:00+08:00') })).toMatchObject({ allowed: true });
        const nowEpochMs = Date.parse('2026-09-15T08:50:00+08:00');
        expect(validateFreshSimulationGeneration({ value: 'simulation:12345678-1234-1234-1234-123456789abc',
            modifiedAtEpochMs: Date.parse('2026-09-14T08:20:00+08:00'), tradeDate: '2026-09-15', nowEpochMs,
            anchoredGeneration: 'simulation:12345678-1234-1234-1234-123456789abc',
            anchoredAtEpochMs: Date.parse('2026-09-15T08:21:00+08:00') })).toBe(true);
        expect(validateFreshSimulationGeneration({ value: 'simulation:12345678-1234-1234-1234-123456789abc',
            modifiedAtEpochMs: Date.parse('2026-09-14T08:20:00+08:00'), tradeDate: '2026-09-15', nowEpochMs,
            anchoredGeneration: 'simulation:different_generation_000001',
            anchoredAtEpochMs: Date.parse('2026-09-15T08:21:00+08:00') })).toBe(false);
    });

    it('失敗只建立 bounded sidecar 且保留禁止操作欄位', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'direct-160-failure-'));
        const outputPath = path.join(directory, 'capture.json');
        await writeDirect160CaptureFailure({ outputPath, tradeDate: '2026-09-15', mode: 'full-session',
            error: new Error('stream disconnected\nsecret-like detail'),
            failedAt: '2026-09-15T09:03:00+08:00' });
        const value = JSON.parse(await readFile(`${outputPath}.failure.json`, 'utf8'));
        expect(value).toMatchObject({
            schemaVersion: 'intraday-monitor-direct-160-capture-failure/1',
            mainEvidenceCreated: false,
            notificationEligible: false,
            brokerWriteAuthority: false,
            productionAuthority: false,
            serviceLifecycleAuthority: false,
        });
        expect(value.error.message).not.toContain('\n');
    });
});
