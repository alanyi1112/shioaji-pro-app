import { createHash } from 'node:crypto';
import path from 'node:path';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const INTRADAY_MONITOR_ACCEPTANCE_DOSSIER_SCHEMA =
    'intraday-monitor-acceptance-dossier/2';

const CHANGE_ID = 'add-configurable-intraday-relative-volume-monitor';
const HASH = /^[a-f0-9]{64}$/;
const STAGES = Object.freeze([20]);
const CATEGORY_KEYS = Object.freeze([
    'dataQuality',
    'resources',
    'ui',
    'accessibility',
    'rollback',
    'tests',
]);
const REF_KEYS = Object.freeze(['path', 'sha256']);
const GATE_KEYS = Object.freeze([
    'decision',
    'report',
    'reviewerSignoff',
    'reviewedAt',
]);
const STAGE_KEYS = Object.freeze([
    'stage',
    'decision',
    'approvedActiveMonitorCount',
    'plan',
    'bundle',
    'review',
    'reviewerSignoff',
    'reviewedAt',
]);
const DOSSIER_KEYS = Object.freeze([
    'schemaVersion',
    'changeId',
    'createdAt',
    'gate0',
    'stages',
    'categories',
    'formalActiveMonitorLimit',
    'unresolvedRisks',
    'unresolvedRisksReviewed',
    'finalReviewerSignoff',
    'finalReviewedAt',
    'productionAuthorized',
    'brokerWriteAuthorized',
    'serviceLifecycleAuthorized',
    'dossierHash',
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length &&
        actual.every((key, index) => key === expected[index]);
}

function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function hash(value) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function withHash(seed, key) {
    return deepFreeze({ ...seed, [key]: hash(seed) });
}

function hashMatches(value, key) {
    if (!value || typeof value !== 'object' || !HASH.test(value[key])) return false;
    const seed = { ...value };
    delete seed[key];
    return hash(seed) === value[key];
}

function validRelativePath(value) {
    if (typeof value !== 'string' || value.length < 1 || value.includes('\\')) return false;
    if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) return false;
    return value !== '..' && !value.startsWith('../');
}

function validRef(value) {
    return Boolean(
        exactRecord(value, REF_KEYS) &&
            validRelativePath(value.path) &&
            HASH.test(value.sha256),
    );
}

function nullableRef(value) {
    return value === null || validRef(value);
}

function validReviewedAt(value, signed) {
    return signed ? validInstant(value) : value === null;
}

function validGate(value) {
    return Boolean(
        exactRecord(value, GATE_KEYS) &&
            ['bounded_go', 'no_go'].includes(value.decision) &&
            nullableRef(value.report) &&
            typeof value.reviewerSignoff === 'boolean' &&
            validReviewedAt(value.reviewedAt, value.reviewerSignoff),
    );
}

function validStage(value, expectedStage) {
    return Boolean(
        exactRecord(value, STAGE_KEYS) &&
            value.stage === expectedStage &&
            ['pending', 'go', 'no_go'].includes(value.decision) &&
            (value.approvedActiveMonitorCount === null ||
                (safeCount(value.approvedActiveMonitorCount) &&
                    value.approvedActiveMonitorCount > 0 &&
                    value.approvedActiveMonitorCount <= 20)) &&
            nullableRef(value.plan) &&
            nullableRef(value.bundle) &&
            nullableRef(value.review) &&
            typeof value.reviewerSignoff === 'boolean' &&
            validReviewedAt(value.reviewedAt, value.reviewerSignoff),
    );
}

function validCategories(value) {
    return Boolean(
        exactRecord(value, CATEGORY_KEYS) &&
            CATEGORY_KEYS.every(
                (key) => Array.isArray(value[key]) && value[key].every(validRef),
            ),
    );
}

function validDossier(value) {
    return Boolean(
        exactRecord(value, DOSSIER_KEYS) &&
            value.schemaVersion === INTRADAY_MONITOR_ACCEPTANCE_DOSSIER_SCHEMA &&
            value.changeId === CHANGE_ID &&
            validInstant(value.createdAt) &&
            validGate(value.gate0) &&
            Array.isArray(value.stages) &&
            value.stages.length === STAGES.length &&
            value.stages.every((stage, index) => validStage(stage, STAGES[index])) &&
            validCategories(value.categories) &&
            (value.formalActiveMonitorLimit === null ||
                (safeCount(value.formalActiveMonitorLimit) &&
                    value.formalActiveMonitorLimit > 0 &&
                    value.formalActiveMonitorLimit <= 20)) &&
            Array.isArray(value.unresolvedRisks) &&
            value.unresolvedRisks.length <= 64 &&
            value.unresolvedRisks.every(
                (risk) => typeof risk === 'string' && risk.trim() === risk && risk.length > 0,
            ) &&
            typeof value.unresolvedRisksReviewed === 'boolean' &&
            typeof value.finalReviewerSignoff === 'boolean' &&
            validReviewedAt(value.finalReviewedAt, value.finalReviewerSignoff) &&
            value.productionAuthorized === false &&
            value.brokerWriteAuthorized === false &&
            value.serviceLifecycleAuthorized === false &&
            hashMatches(value, 'dossierHash'),
    );
}

export function createIntradayMonitorAcceptanceDossier(input = {}) {
    const seed = {
        schemaVersion: INTRADAY_MONITOR_ACCEPTANCE_DOSSIER_SCHEMA,
        changeId: CHANGE_ID,
        createdAt: input.createdAt,
        gate0: structuredClone(input.gate0),
        stages: structuredClone(input.stages),
        categories: structuredClone(input.categories),
        formalActiveMonitorLimit: input.formalActiveMonitorLimit,
        unresolvedRisks: structuredClone(input.unresolvedRisks),
        unresolvedRisksReviewed: input.unresolvedRisksReviewed,
        finalReviewerSignoff: input.finalReviewerSignoff,
        finalReviewedAt: input.finalReviewedAt,
        productionAuthorized: false,
        brokerWriteAuthorized: false,
        serviceLifecycleAuthorized: false,
    };
    const dossier = withHash(seed, 'dossierHash');
    if (!validDossier(dossier)) throw new TypeError('acceptance dossier is invalid');
    return dossier;
}

export function validateIntradayMonitorAcceptanceDossier(value) {
    if (!validDossier(value)) {
        return deepFreeze({
            valid: false,
            readyForArchive: false,
            reasons: ['invalid_dossier'],
            referencedFileCount: 0,
        });
    }
    const reasons = new Set();
    if (value.gate0.decision !== 'bounded_go') reasons.add('gate0_not_approved');
    if (!value.gate0.report) reasons.add('gate0_report_missing');
    if (!value.gate0.reviewerSignoff) reasons.add('gate0_reviewer_signoff_missing');

    for (const stage of value.stages) {
        if (stage.decision !== 'go') reasons.add(`stage_${stage.stage}_not_approved`);
        if (!stage.plan) reasons.add(`stage_${stage.stage}_plan_missing`);
        if (!stage.bundle) reasons.add(`stage_${stage.stage}_bundle_missing`);
        if (!stage.review) reasons.add(`stage_${stage.stage}_review_missing`);
        if (!stage.reviewerSignoff) reasons.add(`stage_${stage.stage}_reviewer_signoff_missing`);
        if (stage.approvedActiveMonitorCount === null) {
            reasons.add(`stage_${stage.stage}_active_limit_missing`);
        }
    }

    for (const key of CATEGORY_KEYS) {
        if (value.categories[key].length === 0) reasons.add(`${key}_evidence_missing`);
    }
    if (value.formalActiveMonitorLimit === null) reasons.add('formal_active_limit_missing');
    const verifiedStageLimit = value.stages[0].approvedActiveMonitorCount;
    if (
        value.formalActiveMonitorLimit !== null &&
        verifiedStageLimit !== null &&
        value.formalActiveMonitorLimit > verifiedStageLimit
    ) {
        reasons.add('formal_active_limit_exceeds_verified_stage');
    }
    if (!value.unresolvedRisksReviewed) reasons.add('unresolved_risks_not_reviewed');
    if (!value.finalReviewerSignoff) reasons.add('final_reviewer_signoff_missing');

    const refs = collectIntradayMonitorAcceptanceDossierRefs(value);
    return deepFreeze({
        valid: true,
        readyForArchive: reasons.size === 0,
        reasons: [...reasons].sort(),
        referencedFileCount: refs.length,
    });
}

export function collectIntradayMonitorAcceptanceDossierRefs(value) {
    if (!validDossier(value)) return deepFreeze([]);
    const refs = [];
    if (value.gate0.report) refs.push(value.gate0.report);
    for (const stage of value.stages) {
        for (const key of ['plan', 'bundle', 'review']) {
            if (stage[key]) refs.push(stage[key]);
        }
    }
    for (const key of CATEGORY_KEYS) refs.push(...value.categories[key]);
    const unique = new Map(refs.map((ref) => [`${ref.path}\u0000${ref.sha256}`, ref]));
    return deepFreeze([...unique.values()].map((ref) => structuredClone(ref)));
}
