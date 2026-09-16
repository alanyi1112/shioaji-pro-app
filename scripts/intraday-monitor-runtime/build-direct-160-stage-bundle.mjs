import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { writeDirect160Artifact } from './direct-160-storage.mjs';
import {
    createTieredStageEvidenceBundle,
    validateTieredStageEvidenceBundle,
} from './tiered-capacity-stage-artifacts.mjs';

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function absolute(name) {
    const value = argument(name);
    if (!value || !path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
    return value;
}

async function json(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}

export function buildDirect160StageBundle({ capture, plan, manifest, baseline, createdAt } = {}) {
    if (capture?.schemaVersion !== 'intraday-monitor-direct-160-capture/1' ||
        capture.captureMode !== 'full-session' || capture.interrupted !== false ||
        capture.assessment?.readyForBundle !== true || !capture.tieredSession ||
        capture.planHash !== plan?.planHash || capture.manifestHash !== manifest?.manifestHash ||
        capture.baselineHash !== baseline?.baselineHash) {
        throw new TypeError('direct 160 capture is not bundle eligible');
    }
    const bundle = createTieredStageEvidenceBundle({ plan, manifest, baseline,
        sessions: [capture.tieredSession], createdAt });
    const validation = validateTieredStageEvidenceBundle(bundle);
    if (!validation.readyForHumanReview) throw new TypeError(validation.reasons.join(','));
    return bundle;
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('--execute required');
    const capturePath = absolute('capture');
    const planPath = absolute('plan');
    const manifestPath = absolute('manifest');
    const baselinePath = absolute('baseline');
    const outputPath = absolute('output');
    const [capture, plan, manifest, baseline] = await Promise.all([
        json(capturePath), json(planPath), json(manifestPath), json(baselinePath),
    ]);
    const bundle = buildDirect160StageBundle({ capture, plan, manifest, baseline,
        createdAt: new Date().toISOString() });
    const receipt = await writeDirect160Artifact(outputPath, bundle, 'bundle');
    process.stdout.write(`${JSON.stringify({ created: true, outputPath,
        bundleHash: bundle.bundleHash, receipt }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
