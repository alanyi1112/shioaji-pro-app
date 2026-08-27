import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { currentTaskProbeWriteSourceFingerprint } from './task-probe-write-preflight.mjs';

export const SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION =
    'smart-order-task13.2-formal-evidence/2026-08-24.1';
export const SMART_ORDER_TASK_13_2_AGGREGATE_SCHEMA_VERSION =
    'smart-order-task13.2-evidence-aggregate/2026-08-26.2';

export const SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE = Object.freeze([
    '0.3:place_confirmed',
    '0.3b:place_confirmed',
    '0.3b:update_confirmed',
    '0.3b:cancel_confirmed',
    '0.3c:external_working_sells_complete',
    '0.4:order_deal_round_trip',
    '0.6:lmt_rod',
    '0.6:lmt_ioc',
    '0.6:mkt_ioc',
    '0.7:unit_contract',
    'pnl_current_day:full_day',
]);

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_KEYS = Object.freeze([
    'schemaVersion',
    'evidenceId',
    'taskId',
    'operationKey',
    'runId',
    'observedTradeDate',
    'accountScopeSha256',
    'apiGenerationSha256',
    'sourceFingerprintSha256',
    'verifierFingerprintSha256',
    'requestSha256',
    'resultSha256',
    'targetIdSha256',
    'quantityCommonLots',
    'generatedAtEpochMs',
    'validUntilEpochMs',
    'formalEvidence',
    'fixture',
    'brokerWriteAttempted',
    'brokerWriteNetworked',
    'automaticRetryAllowed',
    'blindCleanupAllowed',
    'accountIdentifiersPersisted',
]);
const WRITE_KEYS = new Set(
    SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.filter(
        (key) => !key.startsWith('0.7:') && !key.startsWith('pnl_current_day:'),
    ),
);
const verifiedEvidence = new WeakSet();
const VERIFIER_SOURCE_URLS = Object.freeze({
    aggregate: new URL('./task13-2-formal-evidence.mjs', import.meta.url),
    completedEvidenceImporter: new URL(
        '../smart-order-task13-2-completed-evidence-import.mjs',
        import.meta.url,
    ),
    completedEvidenceTrust: new URL(
        './task13-2-completed-evidence-trust.mjs',
        import.meta.url,
    ),
    evidenceCapability: new URL(
        './task13-2-evidence-capability.mjs',
        import.meta.url,
    ),
    evidenceCapabilityRotation: new URL(
        './task13-2-evidence-capability-rotation.mjs',
        import.meta.url,
    ),
    pnlEvidenceImporter: new URL(
        '../smart-order-task13-2-pnl-evidence-import.mjs',
        import.meta.url,
    ),
    productionCli: new URL(
        '../smart-order-task13-2-evidence-aggregate.mjs',
        import.meta.url,
    ),
    unitEvidenceImporter: new URL(
        '../smart-order-task13-2-unit-evidence-import.mjs',
        import.meta.url,
    ),
});
const TASK_0_3_SOURCE_URLS = Object.freeze({
    evidence: new URL('./simulation-write-preflight-evidence.mjs', import.meta.url),
    modeAdmission: new URL('./mode-write-admission.mjs', import.meta.url),
    observationCoordination: new URL(
        './task0-3-observation-coordination.mjs',
        import.meta.url,
    ),
    safetyEnvelope: new URL('./gate-probe-safety-envelope.mjs', import.meta.url),
    sender: new URL('../smart-order-task0-3-event-trigger.mjs', import.meta.url),
});
const TASK_0_7_SOURCE_FILES = Object.freeze([
    Object.freeze({
        path: 'scripts/smart-order-task0-7-unit-probe',
        url: new URL('../smart-order-task0-7-unit-probe', import.meta.url),
    }),
    Object.freeze({
        path: 'scripts/smart-order-task0-7-unit-capability.mjs',
        url: new URL('../smart-order-task0-7-unit-capability.mjs', import.meta.url),
    }),
    Object.freeze({
        path: 'scripts/smart-order-runtime/canonical-stock-unit-contract.mjs',
        url: new URL('./canonical-stock-unit-contract.mjs', import.meta.url),
    }),
    Object.freeze({
        path: 'scripts/smart-order-runtime/shioaji-trade-observer.mjs',
        url: new URL('./shioaji-trade-observer.mjs', import.meta.url),
    }),
    Object.freeze({
        path: 'scripts/smart-order-runtime/node-safe-broker-adapter.mjs',
        url: new URL('./node-safe-broker-adapter.mjs', import.meta.url),
    }),
    Object.freeze({
        path: 'scripts/smart-order-runtime/node-safe-broker-target.mjs',
        url: new URL('./node-safe-broker-target.mjs', import.meta.url),
    }),
]);
const EVIDENCE_SOURCE_URLS = Object.freeze({
    '0.3:place_confirmed': Object.freeze(Object.values(TASK_0_3_SOURCE_URLS)),
    '0.3b:place_confirmed': Object.freeze([
        new URL('../smart-order-task0-3b-contract-probe.mjs', import.meta.url),
        new URL('./task0-3b-operation-contract.mjs', import.meta.url),
        new URL('./task0-3b-operation-executor.mjs', import.meta.url),
    ]),
    '0.3b:update_confirmed': Object.freeze([
        new URL('../smart-order-task0-3b-contract-probe.mjs', import.meta.url),
        new URL('./task0-3b-operation-contract.mjs', import.meta.url),
        new URL('./task0-3b-operation-executor.mjs', import.meta.url),
        new URL('./task0-3b-target-lineage.mjs', import.meta.url),
    ]),
    '0.3b:cancel_confirmed': Object.freeze([
        new URL('../smart-order-task0-3b-contract-probe.mjs', import.meta.url),
        new URL('./task0-3b-operation-contract.mjs', import.meta.url),
        new URL('./task0-3b-operation-executor.mjs', import.meta.url),
        new URL('./task0-3b-target-lineage.mjs', import.meta.url),
    ]),
    '0.3c:external_working_sells_complete': Object.freeze([
        new URL('../smart-order-task0-3c-external-sell.mjs', import.meta.url),
        new URL('../smart-order-task0-3c-authorization-preview.mjs', import.meta.url),
        new URL('../smart-order-task0-3c-finalize.mjs', import.meta.url),
        new URL('../smart-order-task0-3c-preflight.mjs', import.meta.url),
        new URL('./account-reconciliation-coordinator.mjs', import.meta.url),
        new URL('./shioaji-trade-observer.mjs', import.meta.url),
        new URL('./task-probe-readonly-preflight.mjs', import.meta.url),
        new URL('./task0-3b-operation-executor.mjs', import.meta.url),
        new URL('./task0-3c-authorization-cli.mjs', import.meta.url),
        new URL('./task0-3c-operation-contract.mjs', import.meta.url),
        new URL('./task0-3c-operation-preparer.mjs', import.meta.url),
        new URL('./task0-3c-working-set.mjs', import.meta.url),
    ]),
    '0.4:order_deal_round_trip': Object.freeze([
        new URL('./broker-event-normalizer.mjs', import.meta.url),
        new URL('./shioaji-broker-event-mapper.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-contract.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-preparer.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-executor.mjs', import.meta.url),
        new URL('./task0-4-0-6-result-evidence.mjs', import.meta.url),
        new URL('./task0-4-0-6-live-observer.mjs', import.meta.url),
        new URL('../smart-order-task0-4-0-6-contract-probe.mjs', import.meta.url),
    ]),
    '0.6:lmt_rod': Object.freeze([
        new URL('./broker-execution-policy.mjs', import.meta.url),
        new URL('./node-safe-broker-adapter.mjs', import.meta.url),
        new URL('./task-probe-market-plan.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-contract.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-preparer.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-executor.mjs', import.meta.url),
        new URL('./task0-4-0-6-result-evidence.mjs', import.meta.url),
        new URL('./task0-4-0-6-live-observer.mjs', import.meta.url),
        new URL('../smart-order-task0-4-0-6-contract-probe.mjs', import.meta.url),
    ]),
    '0.6:lmt_ioc': Object.freeze([
        new URL('./broker-execution-policy.mjs', import.meta.url),
        new URL('./node-safe-broker-adapter.mjs', import.meta.url),
        new URL('./task-probe-market-plan.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-contract.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-preparer.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-executor.mjs', import.meta.url),
        new URL('./task0-4-0-6-result-evidence.mjs', import.meta.url),
        new URL('./task0-4-0-6-live-observer.mjs', import.meta.url),
        new URL('../smart-order-task0-4-0-6-contract-probe.mjs', import.meta.url),
    ]),
    '0.6:mkt_ioc': Object.freeze([
        new URL('./broker-execution-policy.mjs', import.meta.url),
        new URL('./node-safe-broker-adapter.mjs', import.meta.url),
        new URL('./task-probe-market-plan.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-contract.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-preparer.mjs', import.meta.url),
        new URL('./task0-4-0-6-operation-executor.mjs', import.meta.url),
        new URL('./task0-4-0-6-result-evidence.mjs', import.meta.url),
        new URL('./task0-4-0-6-live-observer.mjs', import.meta.url),
        new URL('../smart-order-task0-4-0-6-contract-probe.mjs', import.meta.url),
    ]),
    '0.7:unit_contract': Object.freeze(
        TASK_0_7_SOURCE_FILES.map((entry) => entry.url),
    ),
    'pnl_current_day:full_day': Object.freeze([
        new URL('./canonical-pnl-policy.mjs', import.meta.url),
        new URL('./account-reconciliation-coordinator.mjs', import.meta.url),
        new URL('./shioaji-trade-observer.mjs', import.meta.url),
        new URL('./task13-2-pnl-current-day-evidence.mjs', import.meta.url),
    ]),
});

function exact(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be an exact non-Proxy object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        JSON.stringify([...actual].sort()) !== JSON.stringify([...keys].sort())
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    return Object.freeze(
        Object.fromEntries(
            keys.map((key) => {
                const descriptor = descriptors[key];
                if (
                    descriptor?.enumerable !== true ||
                    !Object.hasOwn(descriptor, 'value') ||
                    Object.hasOwn(descriptor, 'get') ||
                    Object.hasOwn(descriptor, 'set')
                ) {
                    throw new TypeError(`${label}.${key} must be an own data property`);
                }
                return [key, descriptor.value];
            }),
        ),
    );
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function stableSourceDigest(url) {
    let handle;
    try {
        handle = await open(url, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > MAX_SOURCE_BYTES
        ) {
            throw new Error('Task 13.2 source is not a bounded regular file');
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
            throw new Error('Task 13.2 source changed while hashing');
        }
        return sha256(bytes);
    } finally {
        await handle?.close();
    }
}

export async function currentSmartOrderTask13_2VerifierFingerprint() {
    const entries = await Promise.all(
        Object.entries(VERIFIER_SOURCE_URLS).map(async ([key, url]) => [
            key,
            await stableSourceDigest(url),
        ]),
    );
    return sha256(canonicalJson(Object.fromEntries(entries)));
}

export async function currentSmartOrderTask13_2EvidenceSourceFingerprint(
    evidenceKey,
) {
    const urls = EVIDENCE_SOURCE_URLS[evidenceKey];
    if (!urls || !SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.includes(evidenceKey)) {
        throw new TypeError('Task 13.2 evidence source key is invalid');
    }
    if (evidenceKey === '0.3:place_confirmed') {
        const entries = await Promise.all(
            Object.entries(TASK_0_3_SOURCE_URLS).map(async ([key, url]) => [
                key,
                await stableSourceDigest(url),
            ]),
        );
        return sha256(canonicalJson(Object.fromEntries(entries)));
    }
    if (evidenceKey.startsWith('0.3b:')) {
        return currentTaskProbeWriteSourceFingerprint();
    }
    if (evidenceKey === '0.7:unit_contract') {
        const rows = await Promise.all(
            TASK_0_7_SOURCE_FILES.map(async (entry) =>
                Object.freeze({
                    path: entry.path,
                    sha256: (await stableSourceDigest(entry.url)).slice('sha256:'.length),
                }),
            ),
        );
        return sha256(canonicalJson(rows));
    }
    const entries = await Promise.all(
        urls.map(async (url) => [
            url.pathname.split('/').at(-1),
            await stableSourceDigest(url),
        ]),
    );
    if (new Set(entries.map(([name]) => name)).size !== entries.length) {
        throw new Error('Task 13.2 evidence source names are ambiguous');
    }
    return sha256(canonicalJson(Object.fromEntries(entries)));
}

function hmac(capability, value) {
    if (!(capability instanceof Uint8Array) || capability.byteLength < 32) {
        throw new TypeError('Task 13.2 evidence capability is invalid');
    }
    return `sha256:${createHmac('sha256', capability)
        .update(canonicalJson(value))
        .digest('hex')}`;
}

function nullableDigest(value, label) {
    if (value !== null && !DIGEST.test(value ?? '')) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function canonicalContent(value) {
    const input = exact(value, CONTENT_KEYS, 'Task 13.2 formal evidence');
    const key = `${input.taskId}:${input.operationKey}`;
    if (
        input.schemaVersion !== SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION ||
        !SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE.includes(key) ||
        !UUID.test(input.evidenceId ?? '') ||
        !UUID.test(input.runId ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.observedTradeDate ?? '') ||
        !DIGEST.test(input.sourceFingerprintSha256 ?? '') ||
        !DIGEST.test(input.verifierFingerprintSha256 ?? '') ||
        !DIGEST.test(input.resultSha256 ?? '') ||
        !Number.isSafeInteger(input.generatedAtEpochMs) ||
        input.generatedAtEpochMs < 0 ||
        (input.validUntilEpochMs !== null &&
            (!Number.isSafeInteger(input.validUntilEpochMs) ||
                input.validUntilEpochMs <= input.generatedAtEpochMs)) ||
        input.formalEvidence !== true ||
        input.fixture !== false ||
        input.automaticRetryAllowed !== false ||
        input.blindCleanupAllowed !== false ||
        input.accountIdentifiersPersisted !== false
    ) {
        throw new TypeError('Task 13.2 formal evidence is unsafe or stale-schema');
    }
    nullableDigest(input.accountScopeSha256, 'accountScopeSha256');
    nullableDigest(input.apiGenerationSha256, 'apiGenerationSha256');
    nullableDigest(input.requestSha256, 'requestSha256');
    nullableDigest(input.targetIdSha256, 'targetIdSha256');
    const writeExpected = WRITE_KEYS.has(key);
    if (
        input.accountScopeSha256 === null ||
        input.apiGenerationSha256 === null ||
        (key === 'pnl_current_day:full_day') !==
            (input.validUntilEpochMs !== null) ||
        writeExpected !== (input.brokerWriteAttempted === true) ||
        writeExpected !== (input.brokerWriteNetworked === true) ||
        (writeExpected &&
            (input.requestSha256 === null ||
                input.quantityCommonLots !== 1)) ||
        (!writeExpected &&
            (input.brokerWriteAttempted !== false ||
                input.brokerWriteNetworked !== false ||
                input.requestSha256 !== null ||
                input.quantityCommonLots !== null)) ||
        (key.startsWith('0.3b:') !== (input.targetIdSha256 !== null))
    ) {
        throw new TypeError('Task 13.2 evidence operation binding is invalid');
    }
    return Object.freeze({ ...input, evidenceKey: key });
}

export function createSmartOrderTask13_2FormalEvidence({ capability, input }) {
    const content = canonicalContent(input);
    const { evidenceKey: _evidenceKey, ...signedContent } = content;
    const evidenceHashSha256 = sha256(canonicalJson(signedContent));
    const signed = Object.freeze({ ...signedContent, evidenceHashSha256 });
    return Object.freeze({
        ...signed,
        evidenceHmacSha256: hmac(capability, signed),
    });
}

export function verifySmartOrderTask13_2FormalEvidence({
    capability,
    evidence,
    expectedSourceFingerprintSha256,
    expectedVerifierFingerprintSha256,
}) {
    try {
        const value = exact(
            evidence,
            [...CONTENT_KEYS, 'evidenceHashSha256', 'evidenceHmacSha256'],
            'signed Task 13.2 formal evidence',
        );
        const content = canonicalContent(
            Object.fromEntries(CONTENT_KEYS.map((key) => [key, value[key]])),
        );
        const { evidenceKey, ...signedContent } = content;
        const expectedHash = sha256(canonicalJson(signedContent));
        const signed = Object.freeze({ ...signedContent, evidenceHashSha256: expectedHash });
        const expectedHmac = Buffer.from(hmac(capability, signed), 'utf8');
        const actualHmac = Buffer.from(String(value.evidenceHmacSha256), 'utf8');
        const authentic =
            actualHmac.byteLength === expectedHmac.byteLength &&
            timingSafeEqual(actualHmac, expectedHmac);
        expectedHmac.fill(0);
        actualHmac.fill(0);
        if (
            value.evidenceHashSha256 !== expectedHash ||
            !authentic ||
            content.sourceFingerprintSha256 !== expectedSourceFingerprintSha256 ||
            content.verifierFingerprintSha256 !== expectedVerifierFingerprintSha256
        ) {
            return Object.freeze({ eligible: false, reason: 'evidence_invalid' });
        }
        const verified = Object.freeze({
            ...content,
            evidenceHashSha256: expectedHash,
            eligible: true,
            brokerAuthority: false,
        });
        verifiedEvidence.add(verified);
        return verified;
    } catch {
        return Object.freeze({ eligible: false, reason: 'evidence_invalid' });
    }
}

export function aggregateSmartOrderTask13_2FormalEvidence({
    evidence,
    expectedPnlTradeDate,
    nowEpochMs,
    additionalBlockers = [],
}) {
    if (
        !Array.isArray(evidence) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(expectedPnlTradeDate ?? '') ||
        !Number.isSafeInteger(nowEpochMs) ||
        !Array.isArray(additionalBlockers) ||
        additionalBlockers.some(
            (blocker) =>
                typeof blocker !== 'string' ||
                !/^(?:ambiguous|invalid|unreadable):[a-z0-9_.:-]{1,120}$/.test(
                    blocker,
                ),
        )
    ) {
        throw new TypeError('Task 13.2 aggregate input is invalid');
    }
    const rows = evidence.filter(
        (row) =>
            row &&
            typeof row === 'object' &&
            verifiedEvidence.has(row) &&
            row.eligible === true,
    );
    if (rows.length !== evidence.length) {
        const ordered = Object.freeze([]);
        return Object.freeze({
            schemaVersion: SMART_ORDER_TASK_13_2_AGGREGATE_SCHEMA_VERSION,
            eligible: false,
            expectedPnlTradeDate,
            evidence: ordered,
            aggregateSha256: sha256(canonicalJson(ordered)),
            blockers: Object.freeze(['unverified_evidence']),
            automaticOperationAllowed: false,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
    }
    const byKey = new Map();
    const evidenceIds = new Set();
    const resultHashes = new Set();
    const requestHashes = new Set();
    const blockers = new Set(additionalBlockers);
    for (const row of rows) {
        if (byKey.has(row.evidenceKey)) blockers.add(`duplicate:${row.evidenceKey}`);
        byKey.set(row.evidenceKey, row);
        if (evidenceIds.has(row.evidenceId)) blockers.add('replayed_evidence_id');
        evidenceIds.add(row.evidenceId);
        if (resultHashes.has(row.resultSha256)) blockers.add('replayed_result_hash');
        resultHashes.add(row.resultSha256);
        if (row.requestSha256 !== null) {
            if (requestHashes.has(row.requestSha256)) blockers.add('replayed_request_hash');
            requestHashes.add(row.requestSha256);
        }
    }
    for (const key of SMART_ORDER_TASK_13_2_REQUIRED_EVIDENCE) {
        if (!byKey.has(key)) blockers.add(`missing:${key}`);
    }
    if (
        rows.length > 0 &&
        new Set(rows.map((row) => row.accountScopeSha256)).size !== 1
    ) {
        blockers.add('fixed_account_scope_drift');
    }
    const task03b = rows.filter((row) => row.taskId === '0.3b');
    if (
        task03b.length > 0 &&
        (new Set(task03b.map((row) => row.runId)).size !== 1 ||
            new Set(task03b.map((row) => row.targetIdSha256)).size !== 1 ||
            new Set(task03b.map((row) => row.apiGenerationSha256)).size !== 1)
    ) {
        blockers.add('task0.3b_lineage_drift');
    }
    const pnl = byKey.get('pnl_current_day:full_day');
    if (
        pnl &&
        (pnl.observedTradeDate !== expectedPnlTradeDate ||
            pnl.generatedAtEpochMs > nowEpochMs ||
            pnl.validUntilEpochMs === null ||
            pnl.validUntilEpochMs <= nowEpochMs)
    ) {
        blockers.add('current_day_pnl_stale');
    }
    const ordered = [...rows]
        .sort((left, right) => left.evidenceKey.localeCompare(right.evidenceKey))
        .map((row) =>
            Object.freeze({
                evidenceKey: row.evidenceKey,
                evidenceId: row.evidenceId,
                evidenceHashSha256: row.evidenceHashSha256,
                resultSha256: row.resultSha256,
                sourceFingerprintSha256: row.sourceFingerprintSha256,
                verifierFingerprintSha256: row.verifierFingerprintSha256,
            }),
        );
    const blockerList = Object.freeze([...blockers].sort());
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_13_2_AGGREGATE_SCHEMA_VERSION,
        eligible: blockerList.length === 0,
        expectedPnlTradeDate,
        evidence: Object.freeze(ordered),
        aggregateSha256: sha256(canonicalJson(ordered)),
        blockers: blockerList,
        automaticOperationAllowed: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}
