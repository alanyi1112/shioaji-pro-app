import { describe, expect, it } from 'vitest';

import {
    collectIntradayMonitorAcceptanceDossierRefs,
    createIntradayMonitorAcceptanceDossier,
    validateIntradayMonitorAcceptanceDossier,
} from './acceptance-dossier.mjs';

const H = 'a'.repeat(64);
const REF = Object.freeze({ path: 'acceptance/evidence.md', sha256: H });

function dossier(overrides = {}) {
    return createIntradayMonitorAcceptanceDossier({
        createdAt: '2026-09-04T21:00:00+08:00',
        gate0: {
            decision: 'bounded_go',
            report: REF,
            reviewerSignoff: true,
            reviewedAt: '2026-09-04T21:00:00+08:00',
        },
        stages: [20].map((stage) => ({
            stage,
            decision: 'go',
            approvedActiveMonitorCount: stage,
            plan: REF,
            bundle: REF,
            review: REF,
            reviewerSignoff: true,
            reviewedAt: '2026-09-04T21:00:00+08:00',
        })),
        categories: {
            dataQuality: [REF],
            resources: [REF],
            ui: [REF],
            accessibility: [REF],
            rollback: [REF],
            tests: [REF],
        },
        formalActiveMonitorLimit: 20,
        unresolvedRisks: ['provider physical usage 維持 unknown。'],
        unresolvedRisksReviewed: true,
        finalReviewerSignoff: true,
        finalReviewedAt: '2026-09-04T21:00:00+08:00',
        ...overrides,
    });
}

describe('盤中監控 acceptance dossier', () => {
    it('bounded Gate、20 檔兩日與正式上限完整簽核時可進入歸檔候選', () => {
        const value = dossier();
        expect(validateIntradayMonitorAcceptanceDossier(value)).toEqual({
            valid: true,
            readyForArchive: true,
            reasons: [],
            referencedFileCount: 1,
        });
        expect(collectIntradayMonitorAcceptanceDossierRefs(value)).toEqual([REF]);
    });

    it('pending 階段、缺證據與缺 reviewer sign-off 時維持不可歸檔', () => {
        const pendingStages = [20].map((stage) => ({
            stage,
            decision: 'pending',
            approvedActiveMonitorCount: null,
            plan: null,
            bundle: null,
            review: null,
            reviewerSignoff: false,
            reviewedAt: null,
        }));
        const value = dossier({
            gate0: {
                decision: 'no_go',
                report: REF,
                reviewerSignoff: false,
                reviewedAt: null,
            },
            stages: pendingStages,
            categories: {
                dataQuality: [REF],
                resources: [],
                ui: [REF],
                accessibility: [REF],
                rollback: [REF],
                tests: [REF],
            },
            formalActiveMonitorLimit: null,
            unresolvedRisksReviewed: false,
            finalReviewerSignoff: false,
            finalReviewedAt: null,
        });
        const result = validateIntradayMonitorAcceptanceDossier(value);
        expect(result.readyForArchive).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining([
            'final_reviewer_signoff_missing',
            'formal_active_limit_missing',
            'gate0_not_approved',
            'resources_evidence_missing',
            'stage_20_not_approved',
            'stage_20_bundle_missing',
            'unresolved_risks_not_reviewed',
        ]));
    });

    it('正式上限高於 20 檔實證值或 dossier 被竄改時拒絕', () => {
        expect(validateIntradayMonitorAcceptanceDossier(dossier({
            stages: [{
                stage: 20,
                decision: 'go',
                approvedActiveMonitorCount: 12,
                plan: REF,
                bundle: REF,
                review: REF,
                reviewerSignoff: true,
                reviewedAt: '2026-09-04T21:00:00+08:00',
            }],
        })).reasons).toContain('formal_active_limit_exceeds_verified_stage');
        const value = dossier();
        expect(validateIntradayMonitorAcceptanceDossier({
            ...value,
            formalActiveMonitorLimit: 100,
        })).toEqual({
            valid: false,
            readyForArchive: false,
            reasons: ['invalid_dossier'],
            referencedFileCount: 0,
        });
    });
});
