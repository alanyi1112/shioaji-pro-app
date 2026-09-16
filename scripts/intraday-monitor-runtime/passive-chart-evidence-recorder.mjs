import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
    createPassiveChartFreshnessEvidence,
    validatePassiveChartFreshnessEvidence,
} from './passive-chart-freshness-evidence.mjs';
import { writeExclusiveJsonAtomically } from './kbar-capture-outcome-writer.mjs';

export const PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA =
    'candle-chart-passive-freshness-submission/1';
export const PASSIVE_CHART_MAX_FRESHNESS_MS = 10_000;

function taipeiTradeDate(value) {
    if (!Number.isFinite(Date.parse(value ?? ''))) return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
}

function validSourceUrl(value) {
    return typeof value === 'string' &&
        /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/(?:\?[^#]*)?$/.test(value);
}

function outputPath(appSupportRoot, tradeDate) {
    return path.join(appSupportRoot, 'direct-160-live',
        `passive-chart-freshness-${tradeDate}.json`);
}

async function existingEvidence(targetPath, tradeDate) {
    try {
        const value = JSON.parse(await readFile(targetPath, 'utf8'));
        return validatePassiveChartFreshnessEvidence(value).ready && value.tradeDate === tradeDate
            ? value : null;
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

export function createPassiveChartEvidenceRecorder({
    appSupportRoot,
    maximumFreshnessMs = PASSIVE_CHART_MAX_FRESHNESS_MS,
} = {}) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new TypeError('absolute appSupportRoot is required');
    }
    if (!Number.isSafeInteger(maximumFreshnessMs) || maximumFreshnessMs < 0) {
        throw new TypeError('maximumFreshnessMs is invalid');
    }
    const firstByChart = new Map();
    return Object.freeze({
        async observe(submission) {
            if (submission?.schemaVersion !== PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA ||
                !validSourceUrl(submission.sourceUrl) ||
                submission.observation?.schemaVersion !== 'candle-chart-passive-freshness-observation/1' ||
                !Array.isArray(submission.observation.charts) ||
                submission.observation.operations?.domReads !== 1 ||
                submission.observation.operations?.networkRequests !== 0) {
                return { status: 422, body: { schemaVersion: PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
                    ok: false, reason: 'invalid_passive_chart_observation', brokerWriteAuthority: false } };
            }
            const tradeDate = taipeiTradeDate(submission.observation.observedAt);
            if (!tradeDate) {
                return { status: 422, body: { schemaVersion: PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
                    ok: false, reason: 'invalid_observation_time', brokerWriteAuthority: false } };
            }
            const targetPath = outputPath(appSupportRoot, tradeDate);
            const existing = await existingEvidence(targetPath, tradeDate);
            if (existing) return { status: 200, body: { schemaVersion: PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
                ok: true, state: 'complete', tradeDate, evidenceHash: existing.evidenceHash,
                outputPath: targetPath, brokerWriteAuthority: false } };

            for (const chart of submission.observation.charts) {
                if (!chart?.lastSourceTime || !Number.isFinite(Date.parse(chart.lastSourceTime)) ||
                    !Number.isFinite(Date.parse(chart.lastVisualCommitAt)) ||
                    !/^[A-Z0-9.]{2,32}$/i.test(chart.code ?? '') ||
                    !Number.isSafeInteger(chart.timeframeMinutes) || chart.timeframeMinutes < 1 ||
                    !Number.isSafeInteger(chart.freshnessMs) || chart.freshnessMs < 0 ||
                    chart.freshnessMs > maximumFreshnessMs ||
                    Date.parse(submission.observation.observedAt) -
                        Date.parse(chart.lastVisualCommitAt) !== chart.freshnessMs) continue;
                const key = `${tradeDate}|${chart.code}|${chart.timeframeMinutes}`;
                const first = firstByChart.get(key);
                if (!first) {
                    firstByChart.set(key, structuredClone(submission.observation));
                    continue;
                }
                if (Date.parse(chart.lastVisualCommitAt) <= Date.parse(
                    first.charts.find((item) => item.code === chart.code &&
                        item.timeframeMinutes === chart.timeframeMinutes)?.lastVisualCommitAt ?? '')) continue;
                try {
                    const evidence = createPassiveChartFreshnessEvidence({
                        tradeDate,
                        sourceUrl: submission.sourceUrl,
                        canonicalSymbol: chart.code,
                        timeframeMinutes: chart.timeframeMinutes,
                        firstObservation: first,
                        secondObservation: submission.observation,
                        geometry: submission.geometry,
                        operations: {
                            domReads: 2, networkRequests: 0, navigationCount: 0, reloadCount: 0,
                            clickCount: 0, subscriptionMutations: 0, notificationDispatches: 0,
                            brokerWrites: 0, productionTransitions: 0,
                            serviceLifecycleMutations: 0,
                        },
                    });
                    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
                    try { await writeExclusiveJsonAtomically(targetPath, evidence); }
                    catch (error) {
                        if (error?.code !== 'EEXIST') throw error;
                        const raced = await existingEvidence(targetPath, tradeDate);
                        if (!raced) throw error;
                        return { status: 200, body: { schemaVersion: PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
                            ok: true, state: 'complete', tradeDate, evidenceHash: raced.evidenceHash,
                            outputPath: targetPath, brokerWriteAuthority: false } };
                    }
                    return { status: 201, body: { schemaVersion: PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
                        ok: true, state: 'complete', tradeDate, evidenceHash: evidence.evidenceHash,
                        outputPath: targetPath, brokerWriteAuthority: false } };
                } catch {
                    // 其他可用圖表仍可能產生合格證據；單一無效觀察不得建立半成品。
                }
            }
            return { status: 202, body: { schemaVersion: PASSIVE_CHART_EVIDENCE_SUBMISSION_SCHEMA,
                ok: true, state: 'awaiting_visual_commit_advance', tradeDate,
                outputPath: targetPath, brokerWriteAuthority: false } };
        },
    });
}
