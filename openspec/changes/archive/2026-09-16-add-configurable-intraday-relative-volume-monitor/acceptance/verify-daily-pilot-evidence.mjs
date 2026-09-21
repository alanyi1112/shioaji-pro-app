import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { assessIntradayMonitorDailyEvidence } from '../../../../../scripts/intraday-monitor-runtime/pilot-daily-evidence-status.mjs';

const ACCEPTANCE_ROOT = import.meta.dirname;

function argument(name) {
    return process.argv.findLast((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function exists(filePath) {
    try { await access(filePath); return true; } catch { return false; }
}

async function readOptionalJson(filePath) {
    return await exists(filePath) ? JSON.parse(await readFile(filePath, 'utf8')) : null;
}

export async function verifyDailyPilotEvidence({
    tradeDate,
    previousTradeDate,
    now = new Date().toISOString(),
    planPath = path.join(ACCEPTANCE_ROOT, 'pilot-stage-plan-20-2026-09-07.json'),
    capturePath = path.join(ACCEPTANCE_ROOT, `kbar-shadow-${tradeDate}.json`),
    chartEvidencePath = path.join(ACCEPTANCE_ROOT, `passive-chart-freshness-${tradeDate}.json`),
    assurancePath = path.join(ACCEPTANCE_ROOT, `pilot-runtime-assurance-${tradeDate}.json`),
} = {}) {
    const captureFailurePath = `${capturePath}.failure.json`;
    return assessIntradayMonitorDailyEvidence({
        tradeDate, previousTradeDate, now,
        plan: JSON.parse(await readFile(planPath, 'utf8')),
        capture: await readOptionalJson(capturePath),
        captureFailure: await readOptionalJson(captureFailurePath),
        chartEvidence: await readOptionalJson(chartEvidencePath),
        assurance: await readOptionalJson(assurancePath),
    });
}

async function main() {
    const tradeDate = argument('trade-date');
    const previousTradeDate = argument('previous-trade-date');
    if (!tradeDate || !previousTradeDate) {
        throw new Error('usage: --trade-date=YYYY-MM-DD --previous-trade-date=YYYY-MM-DD [--now=ISO] [--plan=PATH] [--capture=PATH] [--chart-evidence=PATH] [--assurance=PATH]');
    }
    const result = await verifyDailyPilotEvidence({
        tradeDate, previousTradeDate, now: argument('now') ?? new Date().toISOString(),
        planPath: argument('plan') ?? undefined,
        capturePath: argument('capture') ?? undefined,
        chartEvidencePath: argument('chart-evidence') ?? undefined,
        assurancePath: argument('assurance') ?? undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'failed' || result.status === 'attention') process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
