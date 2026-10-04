import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectDirect160StageStart, inspectOptionalPassiveChartEvidence, validateFreshSimulationGeneration,
    verifyLateBootCatchup, verifyLateBootPreparedCapture,
    writeDirect160CaptureFailure } from './capture-direct-160-stage.mjs';
import { createDailySessionRecord,
    IntradayMonitorSessionStateRepository } from './session-state-repository.mjs';

describe('direct 160 stage launcher preflight', () => {
    it('可見圖表只是選用診斷：缺件、錯日或無效不阻擋背景擷取', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'optional-chart-'));
        const file = path.join(root, 'chart.json');
        expect(await inspectOptionalPassiveChartEvidence({ chartEvidencePath: file,
            tradeDate: '2026-09-08' })).toEqual({ state: 'missing', evidence: null });
        await writeFile(file, '{invalid');
        expect(await inspectOptionalPassiveChartEvidence({ chartEvidencePath: file,
            tradeDate: '2026-09-08' })).toEqual({ state: 'unreadable', evidence: null });
        const fixture = new URL('../../openspec/changes/archive/2026-09-16-add-configurable-intraday-relative-volume-monitor/acceptance/passive-chart-freshness-2026-09-08.json', import.meta.url);
        await writeFile(file, await readFile(fixture));
        expect((await inspectOptionalPassiveChartEvidence({ chartEvidencePath: file,
            tradeDate: '2026-09-09' })).state).toBe('invalid');
        expect((await inspectOptionalPassiveChartEvidence({ chartEvidencePath: file,
            tradeDate: '2026-09-08' })).state).toBe('valid');
    });
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
        const lateAnchor = Date.parse('2026-09-15T08:37:00+08:00');
        const recoveryInput = { value: 'simulation:12345678-1234-1234-1234-123456789abc',
            modifiedAtEpochMs: Date.parse('2026-09-14T08:20:00+08:00'),
            tradeDate: '2026-09-15', nowEpochMs,
            anchoredGeneration: 'simulation:12345678-1234-1234-1234-123456789abc',
            anchoredAtEpochMs: lateAnchor };
        expect(validateFreshSimulationGeneration(recoveryInput)).toBe(false);
        expect(validateFreshSimulationGeneration({ ...recoveryInput, manualRecoveryVerified: true })).toBe(true);
        expect(validateFreshSimulationGeneration({ ...recoveryInput, manualRecoveryVerified: true,
            anchoredAtEpochMs: Date.parse('2026-09-15T08:50:01+08:00') })).toBe(false);
    });

    it('08:55 anchor 僅在完整晚開機準備收據核對後可用，08:59 後拒絕', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'late-anchor-proof-'));
        const tradeDate = '2026-10-01';
        const generation = 'simulation:fixture-generation-1234567890';
        const baselineHash = `sha256:${'b'.repeat(64)}`;
        const lateBootId = `late-boot-${tradeDate}-${randomUUID()}`;
        const repository = new IntradayMonitorSessionStateRepository(root);
        const session = createDailySessionRecord({
            sessionId: `session-${tradeDate}-${'a'.repeat(24)}`,
            tradeDate, previousTradeDate: '2026-09-30', configRevision: 9,
            cohortHash: 'c'.repeat(64), baselineHash: 'b'.repeat(64),
            artifactBundleHash: 'd'.repeat(64), approvalHash: 'e'.repeat(64),
            connectionGeneration: generation, schedulerReceiptHash: 'f'.repeat(64),
            calendarAuthority: { current: true, isTradingDate: true, tradeDate,
                previousTradeDate: '2026-09-30', source: 'fixture official',
                sourceVersions: ['fixture-v1'], observedAt: '2026-10-01T08:55:00+08:00' },
            phase: 'starting', itemStates: [{ canonicalSymbol: '2330.TW',
                state: 'awaiting_first_kbar', reason: 'awaiting_first_kbar',
                baselineState: 'complete', baselineTradeDate: '2026-09-30',
                subscriptionState: 'none', firstKbarAt: null,
                updatedAt: '2026-10-01T08:55:00+08:00' }],
            controlPlane: { requested: false, accepted: false },
            freshness: { evidenceAt: '2026-10-01T08:55:00+08:00', budgetMs: 1_200_000 },
            createdAt: '2026-10-01T08:55:00+08:00',
        });
        repository.claimSession(session);
        const directory = path.join(root, 'IntradayMonitor', 'premarket', 'receipts');
        await mkdir(directory, { recursive: true });
        const receipt = { schemaVersion: 'intraday-monitor-late-boot-catchup/1',
            lateBootId, tradeDate, anchoredAt: '2026-10-01T00:55:00.000Z',
            sessionId: session.sessionId, sessionIdentityHash: session.sessionIdentityHash,
            generation, baselineHash, authority: { current: true, isTradingDate: true, tradeDate },
            gates: { simulation: true, businessSession: true, snapshot2330: true,
                artifacts: true, baseline: true, configuredCohort: true } };
        const text = `${JSON.stringify(receipt)}\n`;
        const receiptPath = path.join(directory, `${tradeDate}-late-boot-prepared.json`);
        await writeFile(receiptPath, text);
        const anchor = { lateBootId, tradeDate, generation, anchoredAt: receipt.anchoredAt,
            preparedReceiptSha256: `sha256:${createHash('sha256').update(text).digest('hex')}` };
        expect(await verifyLateBootCatchup({ appSupportRoot: root, tradeDate, anchor,
            generationValue: generation, baseline: { baselineHash } })).toBe(true);
        expect(await verifyLateBootPreparedCapture({ appSupportRoot: root, tradeDate,
            generationValue: generation, baseline: { baselineHash } })).toBe(false);
        receipt.source = 'late_boot';
        await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
        expect(await verifyLateBootPreparedCapture({ appSupportRoot: root, tradeDate,
            generationValue: generation, baseline: { baselineHash } })).toBe(true);
        const generationInput = { value: generation, tradeDate,
            modifiedAtEpochMs: Date.parse('2026-09-30T08:20:00+08:00'),
            nowEpochMs: Date.parse('2026-10-01T08:56:00+08:00'),
            anchoredGeneration: generation,
            anchoredAtEpochMs: Date.parse('2026-10-01T08:55:00+08:00') };
        expect(validateFreshSimulationGeneration(generationInput)).toBe(false);
        expect(validateFreshSimulationGeneration({ ...generationInput, lateBootVerified: true })).toBe(true);
        expect(validateFreshSimulationGeneration({ ...generationInput, lateBootVerified: true,
            anchoredAtEpochMs: Date.parse('2026-10-01T08:59:00+08:00') })).toBe(false);
        expect(await verifyLateBootCatchup({ appSupportRoot: root, tradeDate,
            anchor: { ...anchor, preparedReceiptSha256: `sha256:${'0'.repeat(64)}` },
            generationValue: generation, baseline: { baselineHash } })).toBe(false);
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
