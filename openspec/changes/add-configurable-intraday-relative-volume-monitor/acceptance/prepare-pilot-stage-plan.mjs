import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { validateIntradayMonitorPilotCohortReceiptManifest } from '../../../../scripts/intraday-monitor-runtime/pilot-cohort-receipts.mjs';
import { createIntradayMonitorPilotStagePlan } from '../../../../scripts/intraday-monitor-runtime/pilot-shadow-evidence.mjs';

function argument(name) {
    return process.argv
        .find((value) => value.startsWith(`--${name}=`))
        ?.slice(name.length + 3);
}

const execute = process.argv.includes('--execute');
const stage = Number(argument('stage'));
const cohortReceiptsPath = argument('cohort-receipts');
const outputPath = argument('output');
const createdAt = argument('created-at');
const minimumActiveMonitorCount = Number(argument('minimum-active'));
const resourceBudgets = {
    maxCpuBasisPoints: Number(argument('max-cpu-bps')),
    maxRssBytes: Number(argument('max-rss-bytes')),
    maxDatabaseGrowthBytes: Number(argument('max-db-growth-bytes')),
    maxSseLatencyMs: Number(argument('max-sse-latency-ms')),
    maxChartFreshnessMs: Number(argument('max-chart-freshness-ms')),
};

if (
    !execute ||
    !cohortReceiptsPath ||
    !outputPath ||
    !createdAt ||
    !Number.isSafeInteger(minimumActiveMonitorCount) ||
    Object.values(resourceBudgets).some((value) => !Number.isSafeInteger(value)) ||
    ![20, 50, 100, 160].includes(stage)
) {
    console.error(
        'usage: node prepare-pilot-stage-plan.mjs --execute --stage=20|50|100|160 --minimum-active=<count> --cohort-receipts=<json> --max-cpu-bps=<count> --max-rss-bytes=<count> --max-db-growth-bytes=<count> --max-sse-latency-ms=<count> --max-chart-freshness-ms=<count> --created-at=<ISO> --output=<json>',
    );
    process.exit(2);
}

let cohortReceipts;
try {
    cohortReceipts = JSON.parse(await readFile(cohortReceiptsPath, 'utf8'));
    if (!validateIntradayMonitorPilotCohortReceiptManifest(cohortReceipts).valid) {
        throw new Error('invalid cohort receipts');
    }
} catch {
    console.error('REFUSED: cohort receipt manifest is unreadable or invalid');
    process.exit(2);
}

let plan;
try {
    plan = createIntradayMonitorPilotStagePlan({
        stage,
        cohort: cohortReceipts.cohort,
        cohortReceiptManifestHash: cohortReceipts.manifestHash,
        minimumActiveMonitorCount,
        resourceBudgets,
        createdAt,
    });
} catch (error) {
    console.error(`REFUSED: ${error instanceof Error ? error.message : 'invalid plan'}`);
    process.exit(2);
}

try {
    await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
    });
} catch {
    console.error('REFUSED: output exists or cannot be created');
    process.exit(2);
}

console.log(
    JSON.stringify({
        created: true,
        stage: plan.stage,
        cohortCount: plan.cohort.length,
        cohortReceiptManifestHash: plan.cohortReceiptManifestHash,
        minimumActiveMonitorCount: plan.minimumActiveMonitorCount,
        resourceBudgets: plan.resourceBudgets,
        planHash: plan.planHash,
        outputPath,
        providerRequestAuthority: plan.providerRequestAuthority,
        subscriptionTransportAuthority: plan.subscriptionTransportAuthority,
        serviceLifecycleAuthority: false,
        brokerWriteAuthority: false,
    }),
);
