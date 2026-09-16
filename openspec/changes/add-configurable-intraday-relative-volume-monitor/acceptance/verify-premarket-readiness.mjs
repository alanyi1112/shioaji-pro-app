import { constants } from 'node:fs';
import { access, readFile, stat, statfs } from 'node:fs/promises';
import process from 'node:process';

import { evaluateIntradayMonitorPremarketReadiness } from '../../../../scripts/intraday-monitor-runtime/premarket-readiness.mjs';

function argument(name) {
    return process.argv
        .find((value) => value.startsWith(`--${name}=`))
        ?.slice(name.length + 3);
}

const planPath = argument('plan');
const cohortReceiptsPath = argument('cohort-receipts');
const runtimeSnapshotPath = argument('runtime-snapshot');
const evidenceDirectory = argument('evidence-dir');
const minimumRequiredDiskBytes = Number(argument('minimum-free-bytes'));

if (
    !planPath ||
    !cohortReceiptsPath ||
    !runtimeSnapshotPath ||
    !evidenceDirectory ||
    !Number.isSafeInteger(minimumRequiredDiskBytes) ||
    minimumRequiredDiskBytes <= 0
) {
    console.error(
        'usage: node verify-premarket-readiness.mjs --plan=<json> --cohort-receipts=<json> --runtime-snapshot=<json> --evidence-dir=<directory> --minimum-free-bytes=<count>',
    );
    process.exit(2);
}

let plan;
let cohortReceipts;
let runtime;
try {
    [plan, cohortReceipts, runtime] = await Promise.all([
        readFile(planPath, 'utf8').then(JSON.parse),
        readFile(cohortReceiptsPath, 'utf8').then(JSON.parse),
        readFile(runtimeSnapshotPath, 'utf8').then(JSON.parse),
    ]);
} catch {
    console.error(JSON.stringify({
        validInputs: false,
        readyForControlledPilot: false,
        reasons: ['unreadable_or_invalid_json'],
    }));
    process.exit(2);
}

let directoryExists = false;
let readable = false;
let writable = false;
let availableDiskBytes = 0;
try {
    const details = await stat(evidenceDirectory);
    directoryExists = details.isDirectory();
    if (directoryExists) {
        const fileSystem = await statfs(evidenceDirectory);
        availableDiskBytes = Math.floor(fileSystem.bavail * fileSystem.bsize);
        await access(evidenceDirectory, constants.R_OK);
        readable = true;
        await access(evidenceDirectory, constants.W_OK);
        writable = true;
    }
} catch {
    // 狀態由 evaluator 以明確 reason code 回報；唯讀 preflight 不建立目錄或測試檔。
}

const result = evaluateIntradayMonitorPremarketReadiness({
    plan,
    cohortReceipts,
    runtime,
    storage: {
        evidenceDirectory,
        directoryExists,
        readable,
        writable,
        availableDiskBytes: Number.isSafeInteger(availableDiskBytes) ? availableDiskBytes : 0,
        minimumRequiredDiskBytes,
        capturedAt: new Date().toISOString(),
    },
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.readyForControlledPilot ? 0 : 1);
