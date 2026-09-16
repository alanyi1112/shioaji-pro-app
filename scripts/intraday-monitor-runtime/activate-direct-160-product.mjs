import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { activateDirect160ProductRuntime, prepareDirect160ProductRuntimeTailGapReview,
    readDirect160ProductRuntimeState, validateDirect160LiveAcceptanceCapture,
    validateDirect160TailGapReview } from './direct-160-product-runtime.mjs';
import { writeDirect160Artifact } from './direct-160-storage.mjs';
import { createTieredStageReview, validateTieredStageEvidenceBundle } from './tiered-capacity-stage-artifacts.mjs';

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function absolute(name) {
    const value = argument(name);
    if (!value || !path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
    return value;
}

async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }

export async function reviewAndActivateDirect160Product({ capture, bundle, statePath, reviewPath,
    reviewedAt = new Date().toISOString() } = {}) {
    const validation = validateTieredStageEvidenceBundle(bundle);
    if (!validation.readyForHumanReview || !validateDirect160LiveAcceptanceCapture(capture) ||
        capture.assessment.readyForBundle !== true || capture.tieredSession?.sessionHash !== bundle.sessions?.[0]?.sessionHash) {
        throw new TypeError('direct 160 evidence is not ready for GO review');
    }
    const currentState = readDirect160ProductRuntimeState(statePath);
    if (currentState?.phase === 'failed' && validateDirect160TailGapReview(capture)) {
        prepareDirect160ProductRuntimeTailGapReview({ statePath, capture, preparedAt: reviewedAt });
    }
    let review;
    let receipt;
    try {
        review = await json(reviewPath);
        receipt = { created: false, outputPath: reviewPath };
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        review = createTieredStageReview({ bundle, decision: 'GO', approvedActiveLimit: 160,
            reviewerSignoff: true, reviewedAt });
        receipt = await writeDirect160Artifact(reviewPath, review, 'session');
    }
    const state = activateDirect160ProductRuntime({ statePath, capture, bundle, review, activatedAt: reviewedAt });
    return { review, receipt, state };
}

async function main() {
    if (!process.argv.includes('--execute')) throw new Error('--execute required');
    const capturePath = absolute('capture');
    const bundlePath = absolute('bundle');
    const statePath = absolute('product-state');
    const reviewPath = absolute('review-output');
    const [capture, bundle] = await Promise.all([json(capturePath), json(bundlePath)]);
    const result = await reviewAndActivateDirect160Product({ capture, bundle, statePath, reviewPath });
    process.stdout.write(`${JSON.stringify({ activated: true, approvedActiveLimit: result.state.approvedActiveLimit,
        evaluationState: result.state.evaluationState, reviewHash: result.review.reviewHash,
        reviewPath, productStatePath: statePath }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
