import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createIntradayMonitorAcceptanceDossier } from './acceptance-dossier.mjs';

const CATEGORY_KEYS = Object.freeze([
    'dataQuality', 'resources', 'ui', 'accessibility', 'rollback', 'tests',
]);

function safeRelativePath(value) {
    return typeof value === 'string' && value.length > 0 &&
        !value.includes('\\') && !path.posix.isAbsolute(value) &&
        path.posix.normalize(value) === value &&
        value !== '..' && !value.startsWith('../');
}

async function reference(changeRoot, relativePath) {
    if (relativePath === null) return null;
    if (!safeRelativePath(relativePath)) throw new TypeError('dossier evidence path is invalid');
    const root = path.resolve(changeRoot);
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
        throw new TypeError('dossier evidence path escapes change root');
    }
    const contents = await readFile(absolutePath);
    return {
        path: relativePath,
        sha256: createHash('sha256').update(contents).digest('hex'),
    };
}

export async function createIntradayMonitorAcceptanceDossierFromManifest({
    manifest,
    changeRoot,
    createdAt = new Date().toISOString(),
} = {}) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
        typeof changeRoot !== 'string' || changeRoot.length < 1 ||
        !manifest.gate0 || !manifest.stage20 || !manifest.categories ||
        CATEGORY_KEYS.some((key) => !Array.isArray(manifest.categories[key]))) {
        throw new TypeError('acceptance dossier manifest is invalid');
    }
    const categories = {};
    for (const key of CATEGORY_KEYS) {
        categories[key] = await Promise.all(
            manifest.categories[key].map((relativePath) => reference(changeRoot, relativePath)),
        );
    }
    return createIntradayMonitorAcceptanceDossier({
        createdAt,
        gate0: {
            decision: manifest.gate0.decision,
            report: await reference(changeRoot, manifest.gate0.report),
            reviewerSignoff: manifest.gate0.reviewerSignoff,
            reviewedAt: manifest.gate0.reviewedAt,
        },
        stages: [{
            stage: 20,
            decision: manifest.stage20.decision,
            approvedActiveMonitorCount: manifest.stage20.approvedActiveMonitorCount,
            plan: await reference(changeRoot, manifest.stage20.plan),
            bundle: await reference(changeRoot, manifest.stage20.bundle),
            review: await reference(changeRoot, manifest.stage20.review),
            reviewerSignoff: manifest.stage20.reviewerSignoff,
            reviewedAt: manifest.stage20.reviewedAt,
        }],
        categories,
        formalActiveMonitorLimit: manifest.formalActiveMonitorLimit,
        unresolvedRisks: manifest.unresolvedRisks,
        unresolvedRisksReviewed: manifest.unresolvedRisksReviewed,
        finalReviewerSignoff: manifest.finalReviewerSignoff,
        finalReviewedAt: manifest.finalReviewedAt,
    });
}
