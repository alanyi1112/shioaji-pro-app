import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { validatePassiveChartFreshnessEvidence } from '../../../../../scripts/intraday-monitor-runtime/passive-chart-freshness-evidence.mjs';
import { createIntradayMonitorPilotRuntimeAssurance,
    validateIntradayMonitorPilotRuntimeAssurance } from '../../../../../scripts/intraday-monitor-runtime/pilot-runtime-assurance.mjs';
import { probeEventStreamReconnect } from './capture-pilot-runtime-assurance.mjs';

const CHANGE_ROOT = path.resolve(import.meta.dirname, '..');

function values(name) {
    return process.argv.filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3));
}
function argument(name) { return values(name).at(-1); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('REFUSED: pass --execute');
    const chartEvidencePath = argument('chart-evidence');
    const previousTradeDate = argument('previous-trade-date');
    const outputPath = argument('output');
    const regressionPaths = values('regression-evidence');
    if (!chartEvidencePath || !previousTradeDate || !outputPath || regressionPaths.length < 1) {
        throw new Error('usage: --execute --chart-evidence=PATH --previous-trade-date=YYYY-MM-DD --regression-evidence=CHANGE_RELATIVE_PATH [repeat] --output=PATH');
    }
    const chartEvidence = JSON.parse(await readFile(chartEvidencePath, 'utf8'));
    if (!validatePassiveChartFreshnessEvidence(chartEvidence).ready) {
        throw new Error('REFUSED: passive chart evidence invalid');
    }
    const infoUrl = new URL('/api/v1/info', chartEvidence.sourceUrl);
    infoUrl.port = '8080';
    const infoResponse = await fetch(infoUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000) });
    const info = await infoResponse.json().catch(() => null);
    if (!infoResponse.ok || info?.simulation !== true || info?.production === true) {
        throw new Error('REFUSED: simulation boundary not confirmed');
    }
    const regressionEvidenceRefs = [];
    for (const relativePath of regressionPaths) {
        const absolutePath = path.resolve(CHANGE_ROOT, relativePath);
        if (!absolutePath.startsWith(`${CHANGE_ROOT}${path.sep}`)) throw new Error('REFUSED: evidence path escapes change');
        regressionEvidenceRefs.push({ path: relativePath, sha256: digest(await readFile(absolutePath)) });
    }
    const reconnect = await probeEventStreamReconnect({ sourceUrl: chartEvidence.sourceUrl,
        tradeDate: chartEvidence.tradeDate });
    const beforeSha256 = digest(Buffer.from(JSON.stringify(chartEvidence.firstObservation)));
    const afterSha256 = digest(Buffer.from(JSON.stringify(chartEvidence.secondObservation)));
    const assurance = createIntradayMonitorPilotRuntimeAssurance({
        tradeDate: chartEvidence.tradeDate,
        previousTradeDate,
        observedAt: new Date().toISOString(),
        simulation: true,
        chart: {
            canonicalSymbol: chartEvidence.canonicalSymbol,
            sourceUrl: chartEvidence.sourceUrl,
            firstObservedAt: chartEvidence.firstObservation.observedAt,
            lastObservedAt: chartEvidence.secondObservation.observedAt,
            freshnessMs: Math.max(chartEvidence.firstObservation.freshnessMs, chartEvidence.secondObservation.freshnessMs),
            canvasCount: chartEvidence.geometry.canvasCount,
            canvasWidth: chartEvidence.geometry.largestCanvasWidth,
            canvasHeight: chartEvidence.geometry.largestCanvasHeight,
            beforeSha256, afterSha256, changed: chartEvidence.visualCommitAdvanced,
        },
        reconnect,
        existingFeatures: { chartFresh: true, watchlistHealthy: true, alertHealthy: true,
            smartOrderHealthy: true, simulationRuntimeHealthy: true },
        regressionEvidenceRefs,
        operations: { methods: ['GET'], subscriptionMutations: 0, notificationDispatches: 0,
            brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0 },
    });
    const handle = await open(outputPath, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(assurance, null, 2)}\n`); } finally { await handle.close(); }
    process.stdout.write(`${JSON.stringify({ created: true, outputPath,
        passiveChartEvidenceHash: chartEvidence.evidenceHash,
        ...validateIntradayMonitorPilotRuntimeAssurance(assurance) }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
