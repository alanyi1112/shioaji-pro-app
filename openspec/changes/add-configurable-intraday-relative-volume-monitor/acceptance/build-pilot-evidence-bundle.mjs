import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
    createIntradayMonitorFunctionalAcceptanceBundle,
    createIntradayMonitorPilotBundleFromCaptures,
    validateIntradayMonitorFunctionalAcceptanceBundle,
} from '../../../../scripts/intraday-monitor-runtime/pilot-acceptance-bundle.mjs';
import { validateIntradayMonitorPilotEvidenceBundle } from '../../../../scripts/intraday-monitor-runtime/pilot-shadow-evidence.mjs';

const CHANGE_ROOT = path.resolve(import.meta.dirname, '..');

function argumentsFor(name) {
    return process.argv
        .filter((value) => value.startsWith(`--${name}=`))
        .map((value) => value.slice(name.length + 3));
}

function argument(name) {
    return argumentsFor(name).at(-1);
}

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

async function hashChangeEvidence(relativePath) {
    const absolutePath = path.resolve(CHANGE_ROOT, relativePath);
    if (!absolutePath.startsWith(`${CHANGE_ROOT}${path.sep}`)) {
        throw new Error('REFUSED: gate evidence must stay inside change directory');
    }
    return createHash('sha256').update(await readFile(absolutePath)).digest('hex');
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('REFUSED: pass --execute');
    const planPath = argument('plan');
    const capturePaths = argumentsFor('capture');
    const assurancePaths = argumentsFor('assurance');
    const baselineCapturePath = argument('baseline-capture');
    const historicalBaselineManifestPaths = argumentsFor('historical-baseline-manifest');
    const gateEvidencePath = argument('gate-evidence');
    const configRevision = Number(argument('config-revision'));
    const threshold = argument('threshold');
    const calendarSourceVersion = argument('calendar-source-version');
    const outputPath = argument('output');
    const functionalMode = Boolean(baselineCapturePath) || historicalBaselineManifestPaths.length > 0;
    const functionalBaselineModeValid = functionalMode &&
        Boolean(baselineCapturePath) !== (historicalBaselineManifestPaths.length > 0);
    const captureInputsValid = functionalMode
        ? capturePaths.length === 1 && assurancePaths.length === 1 && functionalBaselineModeValid
        : capturePaths.length >= 1 && capturePaths.length === assurancePaths.length;
    if (!planPath || !captureInputsValid ||
        !gateEvidencePath || !Number.isSafeInteger(configRevision) || !threshold ||
        !calendarSourceVersion || !outputPath) {
        throw new Error('usage: --execute --plan=PATH --capture=PATH --assurance=PATH [legacy: repeat capture/assurance in matching order | functional: add exactly one --baseline-capture=PATH or repeat --historical-baseline-manifest=PATH] --gate-evidence=CHANGE_RELATIVE_PATH --config-revision=N --threshold=DECIMAL --calendar-source-version=VERSION --output=PATH');
    }
    const plan = await readJson(planPath);
    const captures = await Promise.all(capturePaths.map(readJson));
    const assurances = await Promise.all(assurancePaths.map(readJson));
    const common = {
        plan,
        gateEvidenceSha256: await hashChangeEvidence(gateEvidencePath),
        configRevision,
        threshold,
        calendarSourceVersion,
        createdAt: new Date().toISOString(),
    };
    const bundle = functionalMode
        ? createIntradayMonitorFunctionalAcceptanceBundle({
            ...common,
            baselineCapture: baselineCapturePath
                ? await readJson(baselineCapturePath)
                : null,
            historicalBaselineManifests: historicalBaselineManifestPaths.length > 0
                ? await Promise.all(historicalBaselineManifestPaths.map(readJson))
                : null,
            capture: captures[0],
            assurance: assurances[0],
        })
        : createIntradayMonitorPilotBundleFromCaptures({
            ...common,
            captures,
            assurances,
        });
    const handle = await open(outputPath, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(bundle, null, 2)}\n`);
    } finally {
        await handle.close();
    }
    const validation = functionalMode
        ? validateIntradayMonitorFunctionalAcceptanceBundle(bundle)
        : validateIntradayMonitorPilotEvidenceBundle(bundle);
    process.stdout.write(`${JSON.stringify({
        created: true,
        outputPath,
        bundleHash: bundle.bundleHash,
        ...validation,
    }, null, 2)}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
