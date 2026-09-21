import { link, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
    createPassiveChartFreshnessEvidence,
    validatePassiveChartFreshnessEvidence,
} from '../../../../../scripts/intraday-monitor-runtime/passive-chart-freshness-evidence.mjs';

function argument(name) {
    return process.argv.findLast((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function writeExclusiveAtomically(outputPath, value) {
    const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
        await handle.writeFile(value);
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await link(temporaryPath, outputPath);
    } finally {
        await unlink(temporaryPath).catch(() => undefined);
    }
}

export async function buildPassiveChartFreshnessEvidenceFile({ inputPath, outputPath } = {}) {
    if (!inputPath || !outputPath || path.resolve(inputPath) === path.resolve(outputPath)) {
        throw new TypeError('passive chart evidence file paths are invalid');
    }
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const evidence = createPassiveChartFreshnessEvidence(input);
    await writeExclusiveAtomically(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    return Object.freeze({ created: true, outputPath, evidenceHash: evidence.evidenceHash,
        ...validatePassiveChartFreshnessEvidence(evidence) });
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('REFUSED: pass --execute');
    const inputPath = argument('input');
    const outputPath = argument('output');
    if (!inputPath || !outputPath) {
        throw new Error('usage: --execute --input=READ_ONLY_OBSERVATIONS.json --output=PASSIVE_EVIDENCE.json');
    }
    process.stdout.write(`${JSON.stringify(await buildPassiveChartFreshnessEvidenceFile({
        inputPath, outputPath,
    }), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
