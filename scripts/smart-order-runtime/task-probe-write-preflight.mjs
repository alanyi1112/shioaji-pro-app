import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION =
    'smart-order-task-probe-write-preflight/2026-08-24.1';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONS = new Set(['place', 'update_price', 'cancel']);
const CONTENT_KEYS = Object.freeze([
    'schemaVersion',
    'sourceFingerprintSha256',
    'createdAtEpochMs',
    'validUntilEpochMs',
    'coordinationId',
    'runId',
    'operationIdSha256',
    'operation',
    'requestSha256',
    'envelopeSha256',
    'marketPlanSha256',
    'cliAuthorizationSha256',
    'accountScopeSha256',
    'tradeDate',
    'targetIdSha256',
    'targetRevision',
    'apiGenerationSha256',
    'modeExecutionLeaseEvidenceSha256',
    'initialSimulationAttestationSha256',
    'adjacentSimulationAttestationSha256',
    'observerReadinessSha256',
    'contractEvidenceSha256',
    'quoteEvidenceSha256',
    'positionsSha256',
    'workingOrdersSha256',
    'quantityCommonLots',
    'modeMarker',
    'apiSimulation',
    'sharedModeLeaseHeld',
    'observerReady',
    'caLoaded',
    'productionLoaded',
    'automaticRetryAllowed',
    'blindCleanupAllowed',
    'brokerWriteAttempted',
    'brokerWriteNetworked',
    'accountIdentifiersPersisted',
]);
const SOURCE_URLS = Object.freeze({
    authorizationRequiredNotifier: new URL(
        './authorization-required-notifier.mjs',
        import.meta.url,
    ),
    evidence: new URL('./task-probe-write-preflight.mjs', import.meta.url),
    marketPlan: new URL('./task-probe-market-plan.mjs', import.meta.url),
    safetyEnvelope: new URL('./gate-probe-safety-envelope.mjs', import.meta.url),
    cliAuthorization: new URL('./gate-probe-cli-authorization.mjs', import.meta.url),
    gateProbeCli: new URL('./gate-probe-cli.mjs', import.meta.url),
    modeAdmission: new URL('./mode-write-admission.mjs', import.meta.url),
    readonlyPreflight: new URL(
        './task-probe-readonly-preflight.mjs',
        import.meta.url,
    ),
    task03bOperationContract: new URL(
        './task0-3b-operation-contract.mjs',
        import.meta.url,
    ),
    task03bOperationPreparer: new URL(
        './task0-3b-operation-preparer.mjs',
        import.meta.url,
    ),
    task03bOperationExecutor: new URL(
        './task0-3b-operation-executor.mjs',
        import.meta.url,
    ),
    task03bContractProbe: new URL(
        '../smart-order-task0-3b-contract-probe.mjs',
        import.meta.url,
    ),
    readonlyContractProbe: new URL(
        '../smart-order-contract-probe.mjs',
        import.meta.url,
    ),
    task0406OperationContract: new URL(
        './task0-4-0-6-operation-contract.mjs',
        import.meta.url,
    ),
    task0406OperationPreparer: new URL(
        './task0-4-0-6-operation-preparer.mjs',
        import.meta.url,
    ),
    task0406OperationExecutor: new URL(
        './task0-4-0-6-operation-executor.mjs',
        import.meta.url,
    ),
    task0406ResultEvidence: new URL(
        './task0-4-0-6-result-evidence.mjs',
        import.meta.url,
    ),
    task0406LiveObserver: new URL(
        './task0-4-0-6-live-observer.mjs',
        import.meta.url,
    ),
    task0406ContractProbe: new URL(
        '../smart-order-task0-4-0-6-contract-probe.mjs',
        import.meta.url,
    ),
    managedRuntimeWrapper: new URL('../realtimestock-runtime', import.meta.url),
    task03ObservationCoordination: new URL(
        './task0-3-observation-coordination.mjs',
        import.meta.url,
    ),
    task03bTargetLineage: new URL(
        './task0-3b-target-lineage.mjs',
        import.meta.url,
    ),
    task03bUpdateReconciliation: new URL(
        './task0-3b-update-reconciliation.mjs',
        import.meta.url,
    ),
    task03bUpdateReconciliationCli: new URL(
        '../smart-order-task0-3b-update-reconcile.mjs',
        import.meta.url,
    ),
    task03cAuthorizationCli: new URL(
        './task0-3c-authorization-cli.mjs',
        import.meta.url,
    ),
    task03cOperationContract: new URL(
        './task0-3c-operation-contract.mjs',
        import.meta.url,
    ),
    task03cOperationPreparer: new URL(
        './task0-3c-operation-preparer.mjs',
        import.meta.url,
    ),
    task03cWorkingSet: new URL(
        './task0-3c-working-set.mjs',
        import.meta.url,
    ),
    task03cExternalSellCli: new URL(
        '../smart-order-task0-3c-external-sell.mjs',
        import.meta.url,
    ),
    task03cAuthorizationPreview: new URL(
        '../smart-order-task0-3c-authorization-preview.mjs',
        import.meta.url,
    ),
    task03cReadonlyPreflight: new URL(
        '../smart-order-task0-3c-preflight.mjs',
        import.meta.url,
    ),
    task03cFinalizer: new URL(
        '../smart-order-task0-3c-finalize.mjs',
        import.meta.url,
    ),
    target: new URL('./node-safe-broker-target.mjs', import.meta.url),
    transport: new URL('./task-probe-pinned-transport.mjs', import.meta.url),
});
const receipts = new WeakMap();
const issuedResultHashes = new Set();

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

function digest(value, label) {
    if (typeof value !== 'string' || !DIGEST.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function epoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be an epoch millisecond`);
    }
    return value;
}

function content(value) {
    const input = exact(value, CONTENT_KEYS, 'task probe write preflight');
    if (
        input.schemaVersion !== SMART_ORDER_TASK_PROBE_WRITE_PREFLIGHT_SCHEMA_VERSION ||
        !UUID.test(input.coordinationId ?? '') ||
        !UUID.test(input.runId ?? '') ||
        !OPERATIONS.has(input.operation) ||
        input.quantityCommonLots !== 1 ||
        input.modeMarker !== 'simulation' ||
        input.apiSimulation !== true ||
        input.sharedModeLeaseHeld !== true ||
        input.observerReady !== true ||
        input.caLoaded !== false ||
        input.productionLoaded !== false ||
        input.automaticRetryAllowed !== false ||
        input.blindCleanupAllowed !== false ||
        input.brokerWriteAttempted !== false ||
        input.brokerWriteNetworked !== false ||
        input.accountIdentifiersPersisted !== false ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate ?? '')
    ) {
        throw new TypeError('task probe write preflight is not fail-closed');
    }
    for (const key of CONTENT_KEYS.filter((key) => key.endsWith('Sha256'))) {
        if (input[key] !== null) digest(input[key], key);
    }
    if (
        (input.operation === 'place' &&
            (input.targetIdSha256 !== null || input.targetRevision !== null)) ||
        (input.operation !== 'place' &&
            (!DIGEST.test(input.targetIdSha256 ?? '') ||
                !Number.isSafeInteger(input.targetRevision) ||
                input.targetRevision < 0))
    ) {
        throw new TypeError('task probe target binding is invalid');
    }
    const createdAtEpochMs = epoch(input.createdAtEpochMs, 'createdAtEpochMs');
    const validUntilEpochMs = epoch(input.validUntilEpochMs, 'validUntilEpochMs');
    if (
        validUntilEpochMs <= createdAtEpochMs ||
        validUntilEpochMs - createdAtEpochMs > 5_000
    ) {
        throw new TypeError('task probe write preflight lifetime is invalid');
    }
    return Object.freeze({
        ...input,
        coordinationId: input.coordinationId.toLowerCase(),
        runId: input.runId.toLowerCase(),
        createdAtEpochMs,
        validUntilEpochMs,
    });
}

function hmac(capability, value) {
    if (!(capability instanceof Uint8Array) || capability.byteLength < 32) {
        throw new TypeError('task probe preflight capability is invalid');
    }
    return `sha256:${createHmac('sha256', capability)
        .update(canonicalJson(value))
        .digest('hex')}`;
}

export async function currentTaskProbeWriteSourceFingerprint() {
    const entries = await Promise.all(
        Object.entries(SOURCE_URLS).map(async ([key, url]) => [key, sha256(await readFile(url))]),
    );
    return sha256(canonicalJson(Object.fromEntries(entries)));
}

export function createTaskProbeWritePreflightEvidence({ capability, input }) {
    const projection = content(input);
    const resultHash = sha256(canonicalJson(projection));
    const signed = Object.freeze({ ...projection, resultHash });
    return Object.freeze({ ...signed, evidenceHmacSha256: hmac(capability, signed) });
}

export function verifyTaskProbeWritePreflightEvidence({
    capability,
    evidence,
    expected,
    nowEpochMs,
}) {
    try {
        const value = exact(
            evidence,
            [...CONTENT_KEYS, 'resultHash', 'evidenceHmacSha256'],
            'signed task probe preflight',
        );
        const projection = content(
            Object.fromEntries(CONTENT_KEYS.map((key) => [key, value[key]])),
        );
        const expectedInput = exact(
            expected,
            [
                'accountScopeSha256',
                'apiGenerationSha256',
                'coordinationId',
                'envelopeSha256',
                'marketPlanSha256',
                'operation',
                'operationIdSha256',
                'requestSha256',
                'runId',
                'sourceFingerprintSha256',
                'targetIdSha256',
                'targetRevision',
            ],
            'expected task probe preflight',
        );
        const resultHash = sha256(canonicalJson(projection));
        const signed = Object.freeze({ ...projection, resultHash });
        const actualMac = Buffer.from(value.evidenceHmacSha256, 'utf8');
        const expectedMac = Buffer.from(hmac(capability, signed), 'utf8');
        const authentic =
            actualMac.byteLength === expectedMac.byteLength &&
            timingSafeEqual(actualMac, expectedMac);
        actualMac.fill(0);
        expectedMac.fill(0);
        const exactExpected = Object.entries(expectedInput).every(
            ([key, expectedValue]) => projection[key] === expectedValue,
        );
        const now = epoch(nowEpochMs, 'nowEpochMs');
        if (
            value.resultHash !== resultHash ||
            !authentic ||
            !exactExpected ||
            projection.createdAtEpochMs > now ||
            projection.validUntilEpochMs <= now
        ) {
            return Object.freeze({ eligible: false, reason: 'evidence_invalid' });
        }
        return Object.freeze({ eligible: true, resultHash, brokerAuthority: false });
    } catch {
        return Object.freeze({ eligible: false, reason: 'evidence_invalid' });
    }
}

export async function writeTaskProbeWritePreflightEvidence({
    evidence,
    evidencePath,
}) {
    if (typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath)) {
        throw new TypeError('task probe evidence path must be absolute');
    }
    const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`, 'utf8');
    const handle = await open(
        evidencePath,
        fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            fsConstants.O_NOFOLLOW,
        0o600,
    );
    try {
        await handle.writeFile(bytes);
        await handle.chmod(0o600);
        await handle.sync();
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size !== bytes.byteLength ||
            (metadata.mode & 0o777) !== 0o600
        ) {
            throw new Error('task probe evidence durable write is invalid');
        }
        const parent = await open(
            path.dirname(evidencePath),
            fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
        );
        try {
            await parent.sync();
        } finally {
            await parent.close();
        }
    } finally {
        bytes.fill(0);
        await handle.close();
    }
}

export async function readTaskProbeWritePreflightReceipt({
    capability,
    evidencePath,
    expected,
    nowEpochMs,
}) {
    if (typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath)) {
        throw new TypeError('task probe evidence path must be absolute');
    }
    const handle = await open(evidencePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 2 ||
            before.size > 32 * 1024 ||
            (before.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error('task probe evidence metadata is invalid');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        const current = await lstat(evidencePath);
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            current.isSymbolicLink() ||
            current.dev !== before.dev ||
            current.ino !== before.ino ||
            current.size !== before.size ||
            current.mtimeMs !== before.mtimeMs
        ) {
            bytes.fill(0);
            throw new Error('task probe evidence changed while reading');
        }
        let evidence;
        try {
            evidence = JSON.parse(bytes.toString('utf8'));
        } finally {
            bytes.fill(0);
        }
        const verification = verifyTaskProbeWritePreflightEvidence({
            capability,
            evidence,
            expected,
            nowEpochMs,
        });
        if (verification.eligible !== true) {
            throw new Error('task probe evidence is ineligible');
        }
        if (issuedResultHashes.has(verification.resultHash)) {
            throw new Error('task probe evidence already issued a receipt');
        }
        const receipt = Object.freeze({});
        receipts.set(
            receipt,
            Object.freeze({
                operation: evidence.operation,
                requestSha256: evidence.requestSha256,
                runId: evidence.runId,
                targetIdSha256: evidence.targetIdSha256,
                targetRevision: evidence.targetRevision,
            }),
        );
        issuedResultHashes.add(verification.resultHash);
        return Object.freeze({ evidence: Object.freeze(evidence), receipt, verification });
    } finally {
        await handle.close();
    }
}

export function consumeTaskProbeWritePreflightReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object' || !receipts.has(receipt)) {
        throw new Error('task probe broker write requires an unconsumed receipt');
    }
    const binding = receipts.get(receipt);
    receipts.delete(receipt);
    return binding;
}
