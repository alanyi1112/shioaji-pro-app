import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildIntradayMonitorKbarCaptureFailure, resolveIntradayMonitorCapturePaths,
    writeExclusiveJsonAtomically, writeIntradayMonitorKbarCaptureFailure } from './kbar-capture-outcome-writer.mjs';

const temporaryRoots = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryOutput() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kbar-capture-outcome-'));
    temporaryRoots.push(root);
    return path.join(root, 'capture.json');
}

describe('KBar capture outcome writer', () => {
    it('runner、registry、status 與 monitor 共用 canonical capture 與 sidecar 路徑', async () => {
        const outputPath = await temporaryOutput();
        expect(resolveIntradayMonitorCapturePaths(outputPath)).toEqual({
            capturePath: outputPath, failurePath: `${outputPath}.failure.json`,
        });
        expect(() => resolveIntradayMonitorCapturePaths('capture.json')).toThrow('absolute outputPath');
    });
    it('以原子 exclusive create 寫入主檔且不覆寫既有 evidence', async () => {
        const outputPath = await temporaryOutput();
        await expect(writeExclusiveJsonAtomically(outputPath, { accepted: true }))
            .resolves.toMatchObject({ created: true, outputPath });
        await expect(writeExclusiveJsonAtomically(outputPath, { accepted: false }))
            .rejects.toMatchObject({ code: 'EEXIST' });
        expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual({ accepted: true });
    });

    it('最終化失敗只建立 immutable sidecar 且明確拒絕 baseline 與 live acceptance', async () => {
        const outputPath = await temporaryOutput();
        const options = { outputPath, tradeDate: '2026-09-09', captureMode: 'full-session',
            failedAt: '2026-09-09T05:34:31.000Z', stage: 'session_evidence',
            error: new RangeError('canonical JSON exceeds its byte limit'),
            startReceipt: { started: true, cohortSize: 20, subscribeAccepted: true },
            stopReceipt: { stopped: true, unsubscribeAccepted: true, providerReleaseProven: false },
            transportStatus: { phase: 'stopped', cohortSize: 20, bytes: 123456, kbarFrames: 5400,
                malformedFrames: 0, deliveredEvents: 5400, subscribeAccepted: true,
                unsubscribeAccepted: true, providerReleaseProven: false }, interrupted: false };
        const { failure } = await writeIntradayMonitorKbarCaptureFailure(options);
        const saved = JSON.parse(await readFile(`${outputPath}.failure.json`, 'utf8'));

        expect(failure).toMatchObject({ error: { code: 'evidence_canonical_size_limit_exceeded' },
            output: { mainEvidenceCreated: false, failurePath: `${outputPath}.failure.json` },
            assessment: { baselineUsable: false, liveCaptureAcceptance: false,
                notificationEligible: false, retroactiveTriggerEligible: false },
            operations: { brokerWriteAttemptCount: 0, productionTransitionCount: 0,
                serviceLifecycleMutationCount: 0, rawPayloadSaved: false } });
        expect(saved).toEqual(failure);
        expect(failure.failureHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        await expect(writeIntradayMonitorKbarCaptureFailure(options)).rejects.toMatchObject({ code: 'EEXIST' });
        await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('失敗內容會移除控制字元並維持有界', async () => {
        const outputPath = await temporaryOutput();
        const failure = buildIntradayMonitorKbarCaptureFailure({ outputPath, tradeDate: '2026-09-10',
            captureMode: 'full-session', failedAt: '2026-09-10T05:34:31.000Z', stage: 'capture\nprocess',
            error: new Error(`bad\n${'x'.repeat(400)}`) });
        expect(failure.stage).toBe('capture process');
        expect(failure.error.message).not.toContain('\n');
        expect(failure.error.message.length).toBeLessThanOrEqual(256);
    });
});
