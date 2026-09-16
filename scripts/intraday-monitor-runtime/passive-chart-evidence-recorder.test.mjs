import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
    PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
    createPassiveChartEvidenceRecorder,
} from './passive-chart-evidence-recorder.mjs';
import { validatePassiveChartFreshnessEvidence } from './passive-chart-freshness-evidence.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))));

function submission(observedAt, commitAt, sourceAt = commitAt) {
    return {
        schemaVersion: PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
        sourceUrl: 'http://127.0.0.1:5173/?layout=intraday-stock-selection',
        observation: {
            schemaVersion: 'candle-chart-passive-freshness-observation/1', observedAt,
            charts: [{ code: '2330', timeframeMinutes: 1, lastVisualCommitAt: commitAt,
                lastSourceTime: sourceAt,
                freshnessMs: Date.parse(observedAt) - Date.parse(commitAt) }],
            operations: { domReads: 1, networkRequests: 0, navigationCount: 0,
                reloadCount: 0, subscriptionMutations: 0, brokerWrites: 0,
                productionTransitions: 0, serviceLifecycleMutations: 0 },
        },
        geometry: { observedAt, chartCount: 1, canvasCount: 2,
            largestCanvasWidth: 800, largestCanvasHeight: 420, allCanvasesVisible: true },
    };
}

describe('passive chart evidence recorder', () => {
    it('等待同一圖表的 visual commit 前進後才建立 0600 canonical evidence', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'chart-recorder-'));
        roots.push(root);
        const recorder = createPassiveChartEvidenceRecorder({ appSupportRoot: root });
        expect(await recorder.observe(submission(
            '2026-09-16T01:01:10.000Z', '2026-09-16T01:01:09.000Z',
        ))).toMatchObject({ status: 202, body: { state: 'awaiting_visual_commit_advance' } });
        const result = await recorder.observe(submission(
            '2026-09-16T01:02:10.000Z', '2026-09-16T01:02:09.000Z',
        ));
        expect(result).toMatchObject({ status: 201, body: { state: 'complete',
            tradeDate: '2026-09-16', brokerWriteAuthority: false } });
        const target = path.join(root, 'direct-160-live',
            'passive-chart-freshness-2026-09-16.json');
        const evidence = JSON.parse(await readFile(target, 'utf8'));
        expect(validatePassiveChartFreshnessEvidence(evidence).ready).toBe(true);
        expect((await stat(target)).mode & 0o777).toBe(0o600);
        expect(await recorder.observe(submission(
            '2026-09-16T01:03:10.000Z', '2026-09-16T01:03:09.000Z',
        ))).toMatchObject({ status: 200, body: { evidenceHash: evidence.evidenceHash } });
    });

    it('拒絕跨站 URL 與偽造操作帳本', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'chart-recorder-'));
        roots.push(root);
        const recorder = createPassiveChartEvidenceRecorder({ appSupportRoot: root });
        const bad = submission('2026-09-16T01:01:10.000Z', '2026-09-16T01:01:09.000Z');
        bad.sourceUrl = 'https://example.com/';
        expect(await recorder.observe(bad)).toMatchObject({ status: 422,
            body: { reason: 'invalid_passive_chart_observation' } });
        bad.sourceUrl = 'http://127.0.0.1:5173/';
        bad.observation.operations.networkRequests = 1;
        expect(await recorder.observe(bad)).toMatchObject({ status: 422 });
    });

    it('不保存超過 10 秒的舊 commit，等兩次新鮮 visual commit 後才完成', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'chart-recorder-'));
        roots.push(root);
        const recorder = createPassiveChartEvidenceRecorder({ appSupportRoot: root });
        expect(await recorder.observe(submission(
            '2026-09-16T03:07:11.001Z', '2026-09-16T03:07:00.000Z',
        ))).toMatchObject({ status: 202, body: { state: 'awaiting_visual_commit_advance' } });
        expect(await recorder.observe(submission(
            '2026-09-16T03:08:00.500Z', '2026-09-16T03:08:00.000Z',
        ))).toMatchObject({ status: 202 });
        expect(await recorder.observe(submission(
            '2026-09-16T03:08:02.500Z', '2026-09-16T03:08:02.000Z',
        ))).toMatchObject({ status: 201, body: { state: 'complete' } });
        const target = path.join(root, 'direct-160-live',
            'passive-chart-freshness-2026-09-16.json');
        const evidence = JSON.parse(await readFile(target, 'utf8'));
        expect(evidence.firstObservation.freshnessMs).toBe(500);
        expect(evidence.secondObservation.freshnessMs).toBe(500);
    });
});
