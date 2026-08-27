import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';

export const SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION =
    'smart-order-simulation-write-preflight-evidence/2026-08-23.1';

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_URLS = Object.freeze({
    evidence: new URL('./simulation-write-preflight-evidence.mjs', import.meta.url),
    modeAdmission: new URL('./mode-write-admission.mjs', import.meta.url),
    observationCoordination: new URL(
        './task0-3-observation-coordination.mjs',
        import.meta.url,
    ),
    safetyEnvelope: new URL('./gate-probe-safety-envelope.mjs', import.meta.url),
    sender: new URL('../smart-order-task0-3-event-trigger.mjs', import.meta.url),
});
const CONTENT_KEYS = Object.freeze([
    'schemaVersion',
    'sourceFingerprintSha256',
    'createdAtEpochMs',
    'coordinationId',
    'operationIdSha256',
    'operation',
    'requestSha256',
    'envelopeSha256',
    'cliAuthorizationSha256',
    'accountScopeSha256',
    'maskedAccountRef',
    'accountType',
    'modeMarker',
    'apiSimulation',
    'apiGenerationSha256',
    'sharedModeLeaseHeld',
    'modeExecutionLeaseEvidenceHash',
    'initialSimulationAttestationSha256',
    'adjacentSimulationAttestationSha256',
    'readinessCurrent',
    'readinessEvidenceSha256',
    'readinessDeadlineEpochMs',
    'quantityUnit',
    'requestedQuantity',
    'maximumQuantity',
    'caLoaded',
    'productionLoaded',
    'automaticRetryAllowed',
    'cleanupAllowed',
    'accountIdentifiersPersisted',
    'brokerWriteAttempted',
    'brokerWriteNetworked',
]);
const issuedDurableEvidenceReceipts = new WeakMap();
const issuedDurableEvidenceResultHashes = new Set();

function snapshot(value, requiredKeys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be a non-Proxy exact object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
        ownKeys.some((key) => typeof key !== 'string') ||
        JSON.stringify([...ownKeys].sort()) !==
            JSON.stringify([...requiredKeys].sort())
    ) {
        throw new TypeError(`${label} keys are invalid`);
    }
    const result = {};
    for (const key of requiredKeys) {
        const descriptor = descriptors[key];
        if (
            descriptor?.enumerable !== true ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label}.${key} must be an own data property`);
        }
        result[key] = descriptor.value;
    }
    return Object.freeze(result);
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digest(value, label) {
    if (typeof value !== 'string' || !SHA256.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function epoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative epoch millisecond`);
    }
    return value;
}

function evidenceContent(value) {
    const input = snapshot(value, CONTENT_KEYS, 'simulation write evidence');
    if (
        input.schemaVersion !==
            SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION ||
        !UUID.test(input.coordinationId ?? '') ||
        input.operation !== 'place' ||
        input.accountType !== 'S' ||
        input.modeMarker !== 'simulation' ||
        input.apiSimulation !== true ||
        input.sharedModeLeaseHeld !== true ||
        input.readinessCurrent !== true ||
        input.quantityUnit !== 'CommonLot' ||
        input.requestedQuantity !== 1 ||
        input.maximumQuantity !== 1 ||
        input.caLoaded !== false ||
        input.productionLoaded !== false ||
        input.automaticRetryAllowed !== false ||
        input.cleanupAllowed !== false ||
        input.accountIdentifiersPersisted !== false ||
        input.brokerWriteAttempted !== false ||
        input.brokerWriteNetworked !== false
    ) {
        throw new TypeError('simulation write evidence is not fail-closed');
    }
    const accountScopeSha256 = digest(
        input.accountScopeSha256,
        'accountScopeSha256',
    );
    if (input.maskedAccountRef !== `…${accountScopeSha256.slice(-12)}`) {
        throw new TypeError('simulation write evidence account mask is invalid');
    }
    for (const key of [
        'sourceFingerprintSha256',
        'operationIdSha256',
        'requestSha256',
        'envelopeSha256',
        'cliAuthorizationSha256',
        'apiGenerationSha256',
        'modeExecutionLeaseEvidenceHash',
        'initialSimulationAttestationSha256',
        'adjacentSimulationAttestationSha256',
        'readinessEvidenceSha256',
    ]) {
        digest(input[key], key);
    }
    const createdAtEpochMs = epoch(input.createdAtEpochMs, 'createdAtEpochMs');
    const readinessDeadlineEpochMs = epoch(
        input.readinessDeadlineEpochMs,
        'readinessDeadlineEpochMs',
    );
    if (readinessDeadlineEpochMs <= createdAtEpochMs) {
        throw new TypeError('simulation write evidence readiness already expired');
    }
    return Object.freeze({
        ...input,
        coordinationId: input.coordinationId.toLowerCase(),
        accountScopeSha256,
        createdAtEpochMs,
        readinessDeadlineEpochMs,
    });
}

function hmacSha256(capability, value) {
    if (!(capability instanceof Uint8Array) || capability.byteLength < 32) {
        throw new TypeError('simulation write evidence capability is invalid');
    }
    return `sha256:${createHmac('sha256', capability)
        .update(canonicalJson(value))
        .digest('hex')}`;
}

export async function currentSimulationWritePreflightSourceFingerprint() {
    const entries = await Promise.all(
        Object.entries(SOURCE_URLS).map(async ([key, url]) => [
            key,
            sha256(await readFile(url)),
        ]),
    );
    return sha256(canonicalJson(Object.fromEntries(entries)));
}

export function createSimulationWritePreflightEvidence({ capability, input }) {
    const content = evidenceContent(input);
    const resultHash = sha256(canonicalJson(content));
    const signed = Object.freeze({ ...content, resultHash });
    return Object.freeze({
        ...signed,
        evidenceHmacSha256: hmacSha256(capability, signed),
    });
}

export function verifySimulationWritePreflightEvidence({
    capability,
    evidence,
    expected,
    nowEpochMs,
}) {
    try {
        const value = snapshot(
            evidence,
            [...CONTENT_KEYS, 'resultHash', 'evidenceHmacSha256'],
            'signed simulation write evidence',
        );
        const content = evidenceContent(
            Object.fromEntries(CONTENT_KEYS.map((key) => [key, value[key]])),
        );
        const resultHash = digest(value.resultHash, 'resultHash');
        const evidenceHmacSha256 = digest(
            value.evidenceHmacSha256,
            'evidenceHmacSha256',
        );
        const expectedInput = snapshot(
            expected,
            [
                'accountScopeSha256',
                'apiGenerationSha256',
                'coordinationId',
                'cliAuthorizationSha256',
                'envelopeSha256',
                'operationIdSha256',
                'readinessEvidenceSha256',
                'requestSha256',
                'sourceFingerprintSha256',
            ],
            'expected simulation write evidence',
        );
        const now = epoch(nowEpochMs, 'nowEpochMs');
        const expectedResultHash = sha256(canonicalJson(content));
        const signed = Object.freeze({ ...content, resultHash });
        const expectedHmac = Buffer.from(
            hmacSha256(capability, signed),
            'utf8',
        );
        const actualHmac = Buffer.from(evidenceHmacSha256, 'utf8');
        const authentic =
            actualHmac.byteLength === expectedHmac.byteLength &&
            timingSafeEqual(actualHmac, expectedHmac);
        expectedHmac.fill(0);
        actualHmac.fill(0);
        const exactExpected = Object.entries(expectedInput).every(
            ([key, expectedValue]) => content[key] === expectedValue,
        );
        if (
            resultHash !== expectedResultHash ||
            !authentic ||
            !exactExpected ||
            content.createdAtEpochMs > now ||
            content.readinessDeadlineEpochMs <= now
        ) {
            return Object.freeze({ eligible: false, reason: 'evidence_invalid' });
        }
        return Object.freeze({
            eligible: true,
            resultHash,
            sourceFingerprintSha256: content.sourceFingerprintSha256,
            brokerAuthority: false,
        });
    } catch {
        return Object.freeze({ eligible: false, reason: 'evidence_invalid' });
    }
}

export async function readVerifiedSimulationWritePreflightEvidence({
    capability,
    evidencePath,
    expected,
    nowEpochMs,
}) {
    if (typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath)) {
        throw new TypeError('simulation write evidence path must be absolute');
    }
    const handle = await open(
        evidencePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 2 ||
            before.size > 16 * 1024 ||
            (before.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error('simulation write evidence file metadata is invalid');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        const current = await lstat(evidencePath);
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            current.isSymbolicLink() ||
            current.dev !== before.dev ||
            current.ino !== before.ino ||
            current.size !== before.size ||
            current.mtimeMs !== before.mtimeMs
        ) {
            bytes.fill(0);
            throw new Error('simulation write evidence changed while reading');
        }
        let evidence;
        try {
            evidence = JSON.parse(bytes.toString('utf8'));
        } finally {
            bytes.fill(0);
        }
        const verification = verifySimulationWritePreflightEvidence({
            capability,
            evidence,
            expected,
            nowEpochMs,
        });
        if (verification.eligible !== true) {
            throw new Error('stored simulation write evidence is ineligible');
        }
        if (issuedDurableEvidenceResultHashes.has(verification.resultHash)) {
            throw new Error(
                'stored simulation write evidence already issued a receipt',
            );
        }
        // This receipt is deliberately opaque and process-local. Broker
        // transport can consume it exactly once, but callers cannot recreate
        // it by cloning the verified JSON or its public verification result.
        // The signed evidence remains brokerAuthority=false: the receipt only
        // proves that the required durable pre-write boundary was crossed.
        const durableEvidenceReceipt = Object.freeze({});
        issuedDurableEvidenceReceipts.set(
            durableEvidenceReceipt,
            Object.freeze({
                operation: evidence.operation,
                requestSha256: evidence.requestSha256,
            }),
        );
        issuedDurableEvidenceResultHashes.add(verification.resultHash);
        return Object.freeze({
            evidence: Object.freeze(evidence),
            verification,
            durableEvidenceReceipt,
        });
    } finally {
        await handle.close();
    }
}

export function consumeSimulationWritePreflightEvidenceReceipt(receipt) {
    if (
        !receipt ||
        typeof receipt !== 'object' ||
        !issuedDurableEvidenceReceipts.has(receipt)
    ) {
        throw new Error(
            'broker write requires an unconsumed durable preflight evidence receipt',
        );
    }
    const binding = issuedDurableEvidenceReceipts.get(receipt);
    issuedDurableEvidenceReceipts.delete(receipt);
    return binding;
}
