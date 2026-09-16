import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
    createTieredStagePlan,
    validateTieredCohortManifest,
} from '../../../../scripts/intraday-monitor-runtime/tiered-capacity-stage-artifacts.mjs';

const LOCKED_BUDGETS = Object.freeze({
    maxCpuBasisPoints: 2_500,
    maxRssBytes: 1_073_741_824,
    maxDatabaseGrowthBytes: 33_554_432,
    minimumAvailableDiskBytes: 8_589_934_592,
    maxEventToSealLatencyMs: 10_000,
    maxChartFreshnessMs: 10_000,
    reconnectRequired: true,
    existingFeaturesRequired: true,
});

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function prepareTieredStagePlans({ directory, createdAt } = {}) {
    if (typeof directory !== 'string' || !Number.isFinite(Date.parse(createdAt ?? ''))) {
        throw new TypeError('plan options invalid');
    }
    const results = [];
    for (const stage of [160]) {
        const manifestPath = path.join(directory, `tiered-cohort-stage-${stage}.json`);
        const outputPath = path.join(directory, `direct-stage-plan-${stage}-single-day-${createdAt.slice(0, 10)}.json`);
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (!validateTieredCohortManifest(manifest).valid) {
            throw new Error(`REFUSED: invalid stage ${stage} manifest`);
        }
        const plan = createTieredStagePlan({ manifest, budgets: LOCKED_BUDGETS, createdAt });
        await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
            encoding: 'utf8', flag: 'wx', mode: 0o600,
        });
        results.push({ stage, outputPath, planHash: plan.planHash,
            manifestHash: plan.manifestHash, minimumCompleteTradingDays: plan.minimumCompleteTradingDays });
    }
    return Object.freeze({
        created: true,
        budgetBasis: 'direct160_offline_storage_measurement_2026-09-11_pre_live_budget',
        lockedBudgets: LOCKED_BUDGETS,
        stages: results,
        providerRequestAuthority: false,
        subscriptionTransportAuthority: false,
        serviceLifecycleAuthority: false,
        brokerWriteAuthority: false,
    });
}

async function main() {
    if (!process.argv.includes('--execute') || !argument('directory')) {
        throw new Error('usage: --execute --directory=/ABS/PATH --created-at=ISO');
    }
    const result = await prepareTieredStagePlans({
        directory: argument('directory'),
        createdAt: argument('created-at'),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
