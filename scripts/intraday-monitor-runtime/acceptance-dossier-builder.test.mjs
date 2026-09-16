import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateIntradayMonitorAcceptanceDossier } from './acceptance-dossier.mjs';
import { createIntradayMonitorAcceptanceDossierFromManifest } from './acceptance-dossier-builder.mjs';

let temporaryRoot = null;

afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = null;
});

async function fixture() {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'intraday-dossier-'));
    const names = ['gate.md', 'plan.json', 'bundle.json', 'review.md', 'evidence.md'];
    await Promise.all(names.map((name) => writeFile(path.join(temporaryRoot, name), name)));
    return {
        gate0: { decision: 'bounded_go', report: 'gate.md', reviewerSignoff: true, reviewedAt: '2026-09-09T14:00:00+08:00' },
        stage20: { decision: 'go', approvedActiveMonitorCount: 20, plan: 'plan.json', bundle: 'bundle.json', review: 'review.md', reviewerSignoff: true, reviewedAt: '2026-09-09T14:05:00+08:00' },
        categories: Object.fromEntries(['dataQuality', 'resources', 'ui', 'accessibility', 'rollback', 'tests'].map((key) => [key, ['evidence.md']])),
        formalActiveMonitorLimit: 20,
        unresolvedRisks: ['provider physical usage remains unknown'],
        unresolvedRisksReviewed: true,
        finalReviewerSignoff: true,
        finalReviewedAt: '2026-09-09T14:10:00+08:00',
    };
}

describe('盤中監控 acceptance dossier manifest builder', () => {
    it('由路徑自動計算 SHA-256 並建立可歸檔 dossier', async () => {
        const dossier = await createIntradayMonitorAcceptanceDossierFromManifest({
            manifest: await fixture(),
            changeRoot: temporaryRoot,
            createdAt: '2026-09-09T14:11:00+08:00',
        });
        expect(validateIntradayMonitorAcceptanceDossier(dossier)).toMatchObject({
            valid: true,
            readyForArchive: true,
        });
        expect(dossier.productionAuthorized).toBe(false);
        expect(dossier.brokerWriteAuthorized).toBe(false);
    });

    it('拒絕 change 外路徑與不存在的 evidence', async () => {
        const manifest = await fixture();
        manifest.gate0.report = '../outside.md';
        await expect(createIntradayMonitorAcceptanceDossierFromManifest({
            manifest, changeRoot: temporaryRoot,
        })).rejects.toThrow(/path/);
    });
});
