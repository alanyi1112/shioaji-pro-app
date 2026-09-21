import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { validateIntradayMonitorBoundedKbarCapture } from '../../../../../scripts/intraday-monitor-runtime/pilot-acceptance-bundle.mjs';

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
    const planPath = argument('plan');
    const capturePath = argument('capture');
    if (!planPath || !capturePath) {
        throw new Error('usage: node verify-kbar-shadow-capture.mjs --plan=PATH --capture=PATH');
    }
    const [plan, capture] = await Promise.all([
        readFile(planPath, 'utf8').then(JSON.parse),
        readFile(capturePath, 'utf8').then(JSON.parse),
    ]);
    const validation = validateIntradayMonitorBoundedKbarCapture(capture, plan);
    process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
    if (!validation.valid) process.exitCode = 1;
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
