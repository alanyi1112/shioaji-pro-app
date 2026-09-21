import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { createIntradayMonitorPilotCohortReceiptManifest } from '../../../../../scripts/intraday-monitor-runtime/pilot-cohort-receipts.mjs';

function argument(name) {
    return process.argv
        .find((value) => value.startsWith(`--${name}=`))
        ?.slice(name.length + 3);
}

const execute = process.argv.includes('--execute');
const candidatesPath = argument('candidates');
const contractsPath = argument('contracts');
const sourceEndpoint = argument('source-endpoint');
const sourceVersion = argument('source-version');
const verifiedAt = argument('verified-at');
const outputPath = argument('output');

if (
    !execute ||
    !candidatesPath ||
    !contractsPath ||
    !sourceEndpoint ||
    !sourceVersion ||
    !verifiedAt ||
    !outputPath
) {
    console.error(
        'usage: node prepare-pilot-cohort-receipts.mjs --execute --candidates=<txt> --contracts=<json> --source-endpoint=<loopback-url> --source-version=<version> --verified-at=<ISO> --output=<json>',
    );
    process.exit(2);
}

let requestedSymbols;
let contracts;
try {
    requestedSymbols = (await readFile(candidatesPath, 'utf8'))
        .split(/[\s,]+/u)
        .map((value) => value.trim())
        .filter(Boolean);
    const parsed = JSON.parse(await readFile(contractsPath, 'utf8'));
    contracts = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.contracts)
            ? parsed.contracts
            : parsed?.body?.contracts;
} catch {
    console.error('REFUSED: candidate or contract export is unreadable');
    process.exit(2);
}

let manifest;
try {
    manifest = createIntradayMonitorPilotCohortReceiptManifest({
        requestedSymbols,
        contracts,
        sourceEndpoint,
        sourceVersion,
        verifiedAt,
    });
} catch (error) {
    console.error(`REFUSED: ${error instanceof Error ? error.message : 'invalid receipts'}`);
    process.exit(2);
}

try {
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
    });
} catch {
    console.error('REFUSED: output exists or cannot be created');
    process.exit(2);
}

console.log(JSON.stringify({
    created: true,
    cohortCount: manifest.cohort.length,
    manifestHash: manifest.manifestHash,
    outputPath,
    providerRequestAuthority: manifest.providerRequestAuthority,
    subscriptionTransportAuthority: manifest.subscriptionTransportAuthority,
    serviceLifecycleAuthority: manifest.serviceLifecycleAuthority,
    brokerWriteAuthority: manifest.brokerWriteAuthority,
}));
