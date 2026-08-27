import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_TASK_13_3_FORMAL_EVIDENCE_SCHEMA_VERSION =
    'smart-order-task13.3-formal-evidence/2026-08-27.1';
export const SMART_ORDER_TASK_13_3_SMOKE_SCHEMA_VERSION =
    'smart-order-task13.3-protective-exit-smoke/2026-08-27.1';

export const SMART_ORDER_TASK_13_3_REQUIRED_PROFILES = Object.freeze([
    'protected_entry_lmt_ioc',
    'protected_exit_working_lmt_rod',
    'protected_exit_marketable_lmt_ioc',
    'protected_exit_ioc_unfilled',
]);
export const SMART_ORDER_TASK_13_3_TRUSTED_HISTORICAL_VERIFIER_FINGERPRINTS =
    Object.freeze([
        'sha256:5f79ac4b0b99cf810cffc38474bd8424255b107997d6fd1d1b11682eaa30faef',
    ]);

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE = Object.freeze({
    protected_entry_lmt_ioc: Object.freeze({
        side: 'Buy',
        expectedOutcome: 'filled_with_order_and_deal',
    }),
    protected_exit_working_lmt_rod: Object.freeze({
        side: 'Sell',
        expectedOutcome: 'working_no_deal',
    }),
    protected_exit_marketable_lmt_ioc: Object.freeze({
        side: 'Sell',
        expectedOutcome: 'filled_with_order_and_deal',
    }),
    protected_exit_ioc_unfilled: Object.freeze({
        side: 'Sell',
        expectedOutcome: 'zero_fill_no_deal',
    }),
});
const CONTENT_KEYS = Object.freeze([
    'schemaVersion',
    'evidenceId',
    'profile',
    'runId',
    'operationId',
    'observedTradeDate',
    'accountScopeSha256',
    'apiGenerationSha256',
    'sourceFingerprintSha256',
    'verifierFingerprintSha256',
    'requestSha256',
    'resultSha256',
    'authorizedPrice',
    'side',
    'expectedOutcome',
    'generatedAtEpochMs',
    'formalEvidence',
    'fixture',
    'brokerWriteAttempted',
    'brokerWriteNetworked',
    'automaticRetryAllowed',
    'blindCleanupAllowed',
    'accountIdentifiersPersisted',
]);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const SOURCE_URLS = Object.freeze([
    new URL('./task-probe-market-plan.mjs', import.meta.url),
    new URL('./task-probe-write-preflight.mjs', import.meta.url),
    new URL('./task0-4-0-6-operation-contract.mjs', import.meta.url),
    new URL('./task0-4-0-6-operation-preparer.mjs', import.meta.url),
    new URL('./task0-4-0-6-operation-executor.mjs', import.meta.url),
    new URL('./task0-4-0-6-result-evidence.mjs', import.meta.url),
    new URL('../smart-order-task0-4-0-6-contract-probe.mjs', import.meta.url),
    new URL('../smart-order-task13-3-preview.mjs', import.meta.url),
]);
const VERIFIER_URLS = Object.freeze([
    new URL('./task13-3-formal-evidence.mjs', import.meta.url),
    new URL('../smart-order-task13-3-evidence-aggregate.mjs', import.meta.url),
]);
const verifiedRows = new WeakSet();

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function stableDigest(url) {
    const handle = await open(url, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size < 1 || before.size > MAX_SOURCE_BYTES) {
            throw new Error('Task 13.3 source is not a bounded regular file');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.byteLength !== before.size
        ) {
            throw new Error('Task 13.3 source changed while hashing');
        }
        return sha256(bytes);
    } finally {
        await handle.close();
    }
}

async function fingerprint(urls) {
    return sha256(
        canonicalJson(
            await Promise.all(
                urls.map(async (url) => [
                    url.pathname.split('/').at(-1),
                    await stableDigest(url),
                ]),
            ),
        ),
    );
}

export function currentSmartOrderTask13_3SourceFingerprint() {
    return fingerprint(SOURCE_URLS);
}

export function currentSmartOrderTask13_3VerifierFingerprint() {
    return fingerprint(VERIFIER_URLS);
}

function canonicalContent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Task 13.3 formal evidence must be an object');
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.some((key) => typeof key !== 'string') ||
        JSON.stringify([...keys].sort()) !== JSON.stringify([...CONTENT_KEYS].sort())
    ) {
        throw new TypeError('Task 13.3 formal evidence schema is invalid');
    }
    const policy = PROFILE[value.profile];
    if (
        value.schemaVersion !== SMART_ORDER_TASK_13_3_FORMAL_EVIDENCE_SCHEMA_VERSION ||
        !policy ||
        !UUID.test(value.evidenceId ?? '') ||
        !UUID.test(value.runId ?? '') ||
        !UUID.test(value.operationId ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.observedTradeDate ?? '') ||
        !DIGEST.test(value.accountScopeSha256 ?? '') ||
        !DIGEST.test(value.apiGenerationSha256 ?? '') ||
        !DIGEST.test(value.sourceFingerprintSha256 ?? '') ||
        !DIGEST.test(value.verifierFingerprintSha256 ?? '') ||
        !DIGEST.test(value.requestSha256 ?? '') ||
        !DIGEST.test(value.resultSha256 ?? '') ||
        typeof value.authorizedPrice !== 'string' ||
        !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value.authorizedPrice) ||
        value.side !== policy.side ||
        value.expectedOutcome !== policy.expectedOutcome ||
        !Number.isSafeInteger(value.generatedAtEpochMs) ||
        value.generatedAtEpochMs < 0 ||
        value.formalEvidence !== true ||
        value.fixture !== false ||
        value.brokerWriteAttempted !== true ||
        value.brokerWriteNetworked !== true ||
        value.automaticRetryAllowed !== false ||
        value.blindCleanupAllowed !== false ||
        value.accountIdentifiersPersisted !== false
    ) {
        throw new TypeError('Task 13.3 formal evidence is unsafe');
    }
    return Object.freeze(Object.fromEntries(CONTENT_KEYS.map((key) => [key, value[key]])));
}

function hmac(capability, value) {
    if (!(capability instanceof Uint8Array) || capability.byteLength < 32) {
        throw new TypeError('Task 13.3 evidence capability is invalid');
    }
    return `sha256:${createHmac('sha256', capability)
        .update(canonicalJson(value))
        .digest('hex')}`;
}

export function createSmartOrderTask13_3FormalEvidence({ capability, input }) {
    const content = canonicalContent(input);
    const evidenceHashSha256 = sha256(canonicalJson(content));
    const signed = Object.freeze({ ...content, evidenceHashSha256 });
    return Object.freeze({ ...signed, evidenceHmacSha256: hmac(capability, signed) });
}

export function verifySmartOrderTask13_3FormalEvidence({
    capability,
    evidence,
    expectedSourceFingerprintSha256,
    expectedVerifierFingerprintSha256,
}) {
    try {
        const content = canonicalContent(
            Object.fromEntries(CONTENT_KEYS.map((key) => [key, evidence[key]])),
        );
        const evidenceHashSha256 = sha256(canonicalJson(content));
        const signed = Object.freeze({ ...content, evidenceHashSha256 });
        const expectedMac = Buffer.from(hmac(capability, signed));
        const actualMac = Buffer.from(String(evidence.evidenceHmacSha256));
        const authentic =
            expectedMac.byteLength === actualMac.byteLength &&
            timingSafeEqual(expectedMac, actualMac);
        expectedMac.fill(0);
        actualMac.fill(0);
        if (
            !authentic ||
            evidence.evidenceHashSha256 !== evidenceHashSha256 ||
            content.sourceFingerprintSha256 !== expectedSourceFingerprintSha256 ||
            content.verifierFingerprintSha256 !== expectedVerifierFingerprintSha256
        ) {
            return Object.freeze({ eligible: false });
        }
        const verified = Object.freeze({
            ...content,
            evidenceHashSha256,
            eligible: true,
            brokerAuthority: false,
        });
        verifiedRows.add(verified);
        return verified;
    } catch {
        return Object.freeze({ eligible: false });
    }
}

export function aggregateSmartOrderTask13_3FormalEvidence(rows) {
    if (!Array.isArray(rows) || rows.some((row) => !verifiedRows.has(row))) {
        throw new TypeError('Task 13.3 aggregate requires verified evidence');
    }
    const byProfile = new Map(rows.map((row) => [row.profile, row]));
    const blockers = [];
    for (const profile of SMART_ORDER_TASK_13_3_REQUIRED_PROFILES) {
        if (!byProfile.has(profile)) blockers.push(`missing:${profile}`);
    }
    if (byProfile.size !== rows.length) blockers.push('duplicate_profile');
    const requests = rows.map((row) => row.requestSha256);
    if (new Set(requests).size !== requests.length) blockers.push('reused_exact_request');
    const tradeDates = new Set(rows.map((row) => row.observedTradeDate));
    const accountScopes = new Set(rows.map((row) => row.accountScopeSha256));
    const apiGenerations = new Set(rows.map((row) => row.apiGenerationSha256));
    if (rows.length > 0 && tradeDates.size !== 1) blockers.push('trade_date_mismatch');
    if (rows.length > 0 && accountScopes.size !== 1) blockers.push('account_scope_mismatch');
    if (rows.length > 0 && apiGenerations.size !== 1) blockers.push('api_generation_mismatch');
    const evidence = Object.freeze(
        [...rows]
            .sort((left, right) => left.profile.localeCompare(right.profile))
            .map((row) => Object.freeze({
                profile: row.profile,
                evidenceHashSha256: row.evidenceHashSha256,
                resultSha256: row.resultSha256,
                requestSha256: row.requestSha256,
            })),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_13_3_SMOKE_SCHEMA_VERSION,
        eligible: blockers.length === 0,
        evidence,
        aggregateSha256: sha256(canonicalJson(evidence)),
        blockers: Object.freeze(blockers.sort()),
        prepareBeforeEntryCovered: blockers.length === 0,
        partialFillCoveredByDeterministicCore: blockers.length === 0,
        ocoRemainderCoveredByDeterministicCore: blockers.length === 0,
        iocUnfilledCovered: byProfile.has('protected_exit_ioc_unfilled'),
        restartReconcileCoveredByDeterministicCore: blockers.length === 0,
        distinctTaskSpecificMarketPlans: new Set(requests).size === requests.length,
        partialFillBrokerChasingAttempted: false,
        automaticRetryAllowed: false,
        blindCleanupAllowed: false,
        brokerWriteAttempted: rows.length > 0,
        brokerWriteNetworked: rows.length > 0,
        brokerAuthority: false,
    });
}
