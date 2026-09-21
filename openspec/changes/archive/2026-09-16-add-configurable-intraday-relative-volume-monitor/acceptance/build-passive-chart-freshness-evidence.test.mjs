import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildPassiveChartFreshnessEvidenceFile } from './build-passive-chart-freshness-evidence.mjs';

const temporaryDirectories = [];

function observation(observedAt, lastVisualCommitAt) {
    return {
        schemaVersion: 'candle-chart-passive-freshness-observation/1',
        observedAt,
        charts: [{ code: '2330', timeframeMinutes: 5, lastVisualCommitAt,
            lastSourceTime: lastVisualCommitAt,
            freshnessMs: Date.parse(observedAt) - Date.parse(lastVisualCommitAt) }],
        operations: { domReads: 1, networkRequests: 0, navigationCount: 0, reloadCount: 0,
            subscriptionMutations: 0, brokerWrites: 0, productionTransitions: 0,
            serviceLifecycleMutations: 0 },
    };
}

function input() {
    return {
        tradeDate: '2026-09-11', sourceUrl: 'http://127.0.0.1:5173/?layout=intraday-stock-selection',
        canonicalSymbol: '2330', timeframeMinutes: 5,
        firstObservation: observation('2026-09-11T01:10:02.000Z', '2026-09-11T01:10:01.000Z'),
        secondObservation: observation('2026-09-11T01:10:17.000Z', '2026-09-11T01:10:16.500Z'),
        geometry: { observedAt: '2026-09-11T01:10:18.000Z', chartCount: 1, canvasCount: 7,
            largestCanvasWidth: 900, largestCanvasHeight: 500, allCanvasesVisible: true },
        operations: { domReads: 3, networkRequests: 0, navigationCount: 0, reloadCount: 0,
            clickCount: 0, subscriptionMutations: 0, notificationDispatches: 0,
            brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0 },
    };
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })));
});

describe('被動 K 線 evidence 檔案 builder', () => {
    it('原子 exclusive create，第二次執行不得覆寫既有 evidence', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'passive-chart-evidence-'));
        temporaryDirectories.push(directory);
        const inputPath = path.join(directory, 'input.json');
        const outputPath = path.join(directory, 'evidence.json');
        await writeFile(inputPath, JSON.stringify(input()));
        const result = await buildPassiveChartFreshnessEvidenceFile({ inputPath, outputPath });
        expect(result).toMatchObject({ created: true, valid: true, ready: true });
        const original = await readFile(outputPath, 'utf8');
        await expect(buildPassiveChartFreshnessEvidenceFile({ inputPath, outputPath }))
            .rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(outputPath, 'utf8')).toBe(original);
    });
});
