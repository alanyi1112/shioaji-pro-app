import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
    TIERED_CAPACITY_STAGES,
    runOfflineTieredCapacityLoad,
} from '../../../../scripts/intraday-monitor-runtime/tiered-capacity-evidence.mjs';

function argumentsFor(name) {
    return process.argv
        .filter((value) => value.startsWith(`--${name}=`))
        .map((value) => value.slice(name.length + 3));
}

function argument(name) {
    return argumentsFor(name).at(-1);
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('REFUSED: pass --execute');
    const capturePath = argument('capture');
    const outputPrefix = argument('output-prefix');
    const targets = argumentsFor('target').map(Number);
    const createdAt = argument('created-at');
    const runs = Number(argument('runs') ?? 2);
    if (!capturePath || !outputPrefix || targets.length < 1 || !createdAt) {
        throw new Error('usage: --execute --capture=PATH --output-prefix=/ABSOLUTE/PREFIX --target=50 [--target=100 --target=160] --created-at=ISO [--runs=2..10]');
    }
    const results = await runOfflineTieredCapacityLoad({
        capturePath,
        outputPrefix,
        targets,
        createdAt,
        runs,
    });
    process.stdout.write(`${JSON.stringify({
        created: true,
        evidenceClass: 'synthetic_load_only',
        results,
    }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
