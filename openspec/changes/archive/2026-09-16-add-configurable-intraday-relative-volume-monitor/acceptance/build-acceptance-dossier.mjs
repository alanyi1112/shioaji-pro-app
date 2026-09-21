import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { createIntradayMonitorAcceptanceDossierFromManifest } from '../../../../../scripts/intraday-monitor-runtime/acceptance-dossier-builder.mjs';
import { validateIntradayMonitorAcceptanceDossier } from '../../../../../scripts/intraday-monitor-runtime/acceptance-dossier.mjs';

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('REFUSED: pass --execute');
    const manifestPath = argument('manifest');
    const outputPath = argument('output');
    if (!manifestPath || !outputPath) {
        throw new Error('usage: --execute --manifest=PATH --output=PATH');
    }
    const changeRoot = path.resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const dossier = await createIntradayMonitorAcceptanceDossierFromManifest({
        manifest,
        changeRoot,
    });
    const handle = await open(outputPath, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(dossier, null, 2)}\n`);
    } finally {
        await handle.close();
    }
    process.stdout.write(`${JSON.stringify({
        created: true,
        outputPath,
        ...validateIntradayMonitorAcceptanceDossier(dossier),
    }, null, 2)}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
