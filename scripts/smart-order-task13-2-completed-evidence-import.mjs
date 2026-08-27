import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import {
    SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_TRUST_SCHEMA_VERSION,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_PLACE_TRUST,
    SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST,
} from './smart-order-runtime/task13-2-completed-evidence-trust.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './smart-order-runtime/task13-2-evidence-capability.mjs';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './smart-order-runtime/task13-2-formal-evidence.mjs';

export const SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_IMPORT_SCHEMA_VERSION =
    'smart-order-task13.2-completed-evidence-import/2026-08-25.1';

const OUTPUT_FILE = 'task13-2-formal-0.3-place-confirmed.json';
const TASK_0_3B_PLACE_OUTPUT_FILE =
    'task13-2-formal-0.3b-place-confirmed.json';
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_BYTES = 64 * 1024;
const PREFLIGHT_SCHEMA =
    'smart-order-simulation-write-preflight-evidence/2026-08-23.1';
const PROOF_SCHEMA = 'smart-order-task-0.3-trigger-proof/2026-08-22.1';
const RESULT_SCHEMA = 'smart-order-task-0.3-event-trigger/2026-08-24.1';
const LEDGER_SCHEMA = 'smart-order-task-0.3-event-trigger/2026-08-24.1';
const PREFLIGHT_KEYS = Object.freeze([
    'accountIdentifiersPersisted',
    'accountScopeSha256',
    'accountType',
    'adjacentSimulationAttestationSha256',
    'apiGenerationSha256',
    'apiSimulation',
    'automaticRetryAllowed',
    'brokerWriteAttempted',
    'brokerWriteNetworked',
    'caLoaded',
    'cleanupAllowed',
    'cliAuthorizationSha256',
    'coordinationId',
    'createdAtEpochMs',
    'envelopeSha256',
    'evidenceHmacSha256',
    'initialSimulationAttestationSha256',
    'maskedAccountRef',
    'maximumQuantity',
    'modeExecutionLeaseEvidenceHash',
    'modeMarker',
    'operation',
    'operationIdSha256',
    'productionLoaded',
    'quantityUnit',
    'readinessCurrent',
    'readinessDeadlineEpochMs',
    'readinessEvidenceSha256',
    'requestSha256',
    'requestedQuantity',
    'resultHash',
    'schemaVersion',
    'sharedModeLeaseHeld',
    'sourceFingerprintSha256',
]);
const PROOF_KEYS = Object.freeze([
    'accountIdentifiersPersisted',
    'accountScopeSha256',
    'brokerWriteAttempted',
    'confirmedAtEpochMs',
    'coordinationId',
    'observerDeadlineEpochMs',
    'proofHmacSha256',
    'requestSha256',
    'resultEvidenceSha256',
    'schemaVersion',
    'state',
    'tradeIdentitySha256',
]);
const RESULT_KEYS = Object.freeze([
    'accountIdentifiersPersisted',
    'adjacentSimulationAttestationSha256',
    'automaticRetryAllowed',
    'boundedReconciliationCanConfirmOutcome',
    'boundedReconciliationObservedMatches',
    'brokerWriteAttempted',
    'brokerWriteNetworked',
    'cleanupAllowed',
    'coordinationId',
    'envelopeSha256',
    'resultEvidenceSha256',
    'schemaVersion',
    'state',
]);
const LEDGER_KEYS = Object.freeze([
    'accountIdentifiersPersisted',
    'accountScopeSha256',
    'apiGenerationSha256',
    'automaticRetryAllowed',
    'brokerWriteAttempted',
    'brokerWriteNetworked',
    'cleanupAllowed',
    'cliAuthorizationSha256',
    'coordinationId',
    'envelopeSha256',
    'initialSimulationAttestationSha256',
    'modeExecutionLeaseEvidenceHash',
    'requestSha256',
    'schemaVersion',
    'state',
]);
const TRUST_KEYS = Object.freeze([
    'schemaVersion',
    'evidenceKey',
    'coordinationId',
    'requestSha256',
    'sourceFingerprintSha256',
    'preflightResultHash',
    'resultEvidenceSha256',
    'tradeIdentitySha256',
    'artifactSha256',
    'evidenceRecord',
]);
const TRUST_ARTIFACT_KEYS = Object.freeze([
    'ledger',
    'result',
    'preflight',
    'proof',
]);

function mode(metadata) {
    return metadata.mode & 0o777;
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exact(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        JSON.stringify([...actual].sort()) !== JSON.stringify([...keys].sort()) ||
        keys.some((key) => {
            const descriptor = descriptors[key];
            return (
                descriptor?.enumerable !== true ||
                !Object.hasOwn(descriptor, 'value') ||
                Object.hasOwn(descriptor, 'get') ||
                Object.hasOwn(descriptor, 'set')
            );
        })
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

async function assertPrivateDirectory(directoryPath, label) {
    const canonical = await realpath(directoryPath);
    const metadata = await lstat(canonical);
    if (
        canonical !== directoryPath ||
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== process.getuid() ||
        mode(metadata) !== 0o700
    ) {
        throw new Error(`${label} is not a canonical private directory`);
    }
    return canonical;
}

async function readStablePrivateJson(filePath, expectedArtifactSha256) {
    let handle;
    try {
        handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.uid !== process.getuid() ||
            mode(before) !== 0o600 ||
            before.size < 2 ||
            before.size > MAX_BYTES
        ) {
            throw new Error('completed evidence file is not private');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.byteLength !== before.size ||
            (expectedArtifactSha256 !== undefined &&
                sha256(bytes) !== expectedArtifactSha256)
        ) {
            throw new Error('completed evidence changed or is not trusted');
        }
        return JSON.parse(bytes.toString('utf8'));
    } finally {
        await handle?.close();
    }
}

function verifyPreflight({ evidence, expectedSourceFingerprintSha256 }) {
    const value = exact(evidence, PREFLIGHT_KEYS, 'Task 0.3 preflight');
    const content = Object.freeze(
        Object.fromEntries(
            PREFLIGHT_KEYS.filter(
                (key) => !['evidenceHmacSha256', 'resultHash'].includes(key),
            ).map((key) => [key, value[key]]),
        ),
    );
    if (
        value.schemaVersion !== PREFLIGHT_SCHEMA ||
        !UUID.test(value.coordinationId ?? '') ||
        !DIGEST.test(value.accountScopeSha256 ?? '') ||
        !DIGEST.test(value.apiGenerationSha256 ?? '') ||
        !DIGEST.test(value.requestSha256 ?? '') ||
        !DIGEST.test(value.envelopeSha256 ?? '') ||
        !DIGEST.test(value.operationIdSha256 ?? '') ||
        !DIGEST.test(value.cliAuthorizationSha256 ?? '') ||
        !DIGEST.test(value.initialSimulationAttestationSha256 ?? '') ||
        !DIGEST.test(value.adjacentSimulationAttestationSha256 ?? '') ||
        !DIGEST.test(value.modeExecutionLeaseEvidenceHash ?? '') ||
        !DIGEST.test(value.readinessEvidenceSha256 ?? '') ||
        !DIGEST.test(value.resultHash ?? '') ||
        !Number.isSafeInteger(value.createdAtEpochMs) ||
        value.createdAtEpochMs < 0 ||
        !Number.isSafeInteger(value.readinessDeadlineEpochMs) ||
        value.readinessDeadlineEpochMs <= value.createdAtEpochMs ||
        value.resultHash !== sha256(canonicalJson(content)) ||
        value.sourceFingerprintSha256 !== expectedSourceFingerprintSha256 ||
        value.operation !== 'place' ||
        value.accountType !== 'S' ||
        value.maskedAccountRef !== `…${value.accountScopeSha256.slice(-12)}` ||
        value.modeMarker !== 'simulation' ||
        value.apiSimulation !== true ||
        value.sharedModeLeaseHeld !== true ||
        value.readinessCurrent !== true ||
        value.quantityUnit !== 'CommonLot' ||
        value.requestedQuantity !== 1 ||
        value.maximumQuantity !== 1 ||
        value.caLoaded !== false ||
        value.productionLoaded !== false ||
        value.automaticRetryAllowed !== false ||
        value.cleanupAllowed !== false ||
        value.accountIdentifiersPersisted !== false ||
        value.brokerWriteAttempted !== false ||
        value.brokerWriteNetworked !== false ||
        !DIGEST.test(value.evidenceHmacSha256 ?? '')
    ) {
        throw new Error('Task 0.3 preflight is not eligible for re-encoding');
    }
    return value;
}

function verifyProof({ proof, nowEpochMs }) {
    const value = exact(proof, PROOF_KEYS, 'Task 0.3 proof');
    if (
        value.schemaVersion !== PROOF_SCHEMA ||
        !UUID.test(value.coordinationId ?? '') ||
        !DIGEST.test(value.accountScopeSha256 ?? '') ||
        !DIGEST.test(value.requestSha256 ?? '') ||
        !DIGEST.test(value.tradeIdentitySha256 ?? '') ||
        !DIGEST.test(value.resultEvidenceSha256 ?? '') ||
        value.state !== 'confirmed' ||
        value.brokerWriteAttempted !== true ||
        value.accountIdentifiersPersisted !== false ||
        !Number.isSafeInteger(value.confirmedAtEpochMs) ||
        value.confirmedAtEpochMs < 0 ||
        value.confirmedAtEpochMs > nowEpochMs ||
        !Number.isSafeInteger(value.observerDeadlineEpochMs) ||
        value.observerDeadlineEpochMs <= value.confirmedAtEpochMs ||
        !DIGEST.test(value.proofHmacSha256 ?? '')
    ) {
        throw new Error('Task 0.3 proof is not eligible for re-encoding');
    }
    return value;
}

function verifyLedger({ ledger, preflight, proof }) {
    const value = exact(ledger, LEDGER_KEYS, 'Task 0.3 durable ledger');
    if (
        value.schemaVersion !== LEDGER_SCHEMA ||
        value.coordinationId !== preflight.coordinationId ||
        value.coordinationId !== proof.coordinationId ||
        value.accountScopeSha256 !== preflight.accountScopeSha256 ||
        value.apiGenerationSha256 !== preflight.apiGenerationSha256 ||
        value.requestSha256 !== preflight.requestSha256 ||
        value.envelopeSha256 !== preflight.envelopeSha256 ||
        value.cliAuthorizationSha256 !== preflight.cliAuthorizationSha256 ||
        value.initialSimulationAttestationSha256 !==
            preflight.initialSimulationAttestationSha256 ||
        value.modeExecutionLeaseEvidenceHash !==
            preflight.modeExecutionLeaseEvidenceHash ||
        value.state !== 'dispatching_unknown_no_retry' ||
        value.automaticRetryAllowed !== false ||
        value.cleanupAllowed !== false ||
        value.brokerWriteAttempted !== true ||
        value.brokerWriteNetworked !== true ||
        value.accountIdentifiersPersisted !== false
    ) {
        throw new Error('Task 0.3 durable ledger is not eligible for re-encoding');
    }
    return value;
}

function verifyResult({ result, preflight, proof }) {
    const value = exact(result, RESULT_KEYS, 'Task 0.3 result');
    if (
        value.schemaVersion !== RESULT_SCHEMA ||
        value.coordinationId !== preflight.coordinationId ||
        value.coordinationId !== proof.coordinationId ||
        value.envelopeSha256 !== preflight.envelopeSha256 ||
        value.adjacentSimulationAttestationSha256 !==
            preflight.adjacentSimulationAttestationSha256 ||
        value.resultEvidenceSha256 !== proof.resultEvidenceSha256 ||
        value.state !== 'confirmed' ||
        value.brokerWriteAttempted !== true ||
        value.brokerWriteNetworked !== true ||
        value.automaticRetryAllowed !== false ||
        value.cleanupAllowed !== false ||
        value.accountIdentifiersPersisted !== false ||
        value.boundedReconciliationCanConfirmOutcome !== false ||
        value.boundedReconciliationObservedMatches !== null ||
        !DIGEST.test(value.adjacentSimulationAttestationSha256 ?? '')
    ) {
        throw new Error('Task 0.3 result is not eligible for re-encoding');
    }
    return value;
}

function taipeiTradeDate(epochMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(epochMs));
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

async function writeExclusivePrivateJson(filePath, value) {
    let handle;
    try {
        handle = await open(
            filePath,
            fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_WRONLY |
                fsConstants.O_NOFOLLOW,
            0o600,
        );
        await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
        await handle.sync();
    } finally {
        await handle?.close();
    }
    const directory = await open(path.dirname(filePath), fsConstants.O_RDONLY);
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
}

export function verifySmartOrderTask13_2CompletedTask03Lineage({
    ledger,
    preflight,
    proof,
    result,
    trust,
    currentSourceFingerprintSha256,
    nowEpochMs,
}) {
    const trusted = exact(trust, TRUST_KEYS, 'Task 0.3 completed trust anchor');
    const artifactSha256 = exact(
        trusted.artifactSha256,
        TRUST_ARTIFACT_KEYS,
        'Task 0.3 completed trust artifact hashes',
    );
    if (
        trusted.schemaVersion !==
            SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_TRUST_SCHEMA_VERSION ||
        trusted.evidenceKey !== '0.3:place_confirmed' ||
        !UUID.test(trusted.coordinationId ?? '') ||
        !DIGEST.test(trusted.requestSha256 ?? '') ||
        !DIGEST.test(trusted.sourceFingerprintSha256 ?? '') ||
        !DIGEST.test(trusted.preflightResultHash ?? '') ||
        !DIGEST.test(trusted.resultEvidenceSha256 ?? '') ||
        !DIGEST.test(trusted.tradeIdentitySha256 ?? '') ||
        TRUST_ARTIFACT_KEYS.some(
            (key) => !DIGEST.test(artifactSha256[key] ?? ''),
        ) ||
        currentSourceFingerprintSha256 !== trusted.sourceFingerprintSha256
    ) {
        throw new Error('Task 0.3 completed trust anchor is invalid or stale');
    }
    const verifiedPreflight = verifyPreflight({
        evidence: preflight,
        expectedSourceFingerprintSha256: currentSourceFingerprintSha256,
    });
    const verifiedProof = verifyProof({ proof, nowEpochMs });
    const verifiedResult = verifyResult({
        result,
        preflight: verifiedPreflight,
        proof: verifiedProof,
    });
    const verifiedLedger = verifyLedger({
        ledger,
        preflight: verifiedPreflight,
        proof: verifiedProof,
    });
    if (
        verifiedPreflight.coordinationId !== trusted.coordinationId ||
        verifiedProof.coordinationId !== trusted.coordinationId ||
        verifiedResult.coordinationId !== trusted.coordinationId ||
        verifiedLedger.coordinationId !== trusted.coordinationId ||
        verifiedPreflight.requestSha256 !== trusted.requestSha256 ||
        verifiedProof.requestSha256 !== trusted.requestSha256 ||
        verifiedLedger.requestSha256 !== trusted.requestSha256 ||
        verifiedPreflight.resultHash !== trusted.preflightResultHash ||
        verifiedProof.resultEvidenceSha256 !== trusted.resultEvidenceSha256 ||
        verifiedResult.resultEvidenceSha256 !== trusted.resultEvidenceSha256 ||
        verifiedProof.tradeIdentitySha256 !== trusted.tradeIdentitySha256 ||
        verifiedPreflight.accountScopeSha256 !==
            verifiedProof.accountScopeSha256 ||
        verifiedPreflight.createdAtEpochMs > verifiedProof.confirmedAtEpochMs ||
        verifiedPreflight.readinessDeadlineEpochMs !==
            verifiedProof.observerDeadlineEpochMs
    ) {
        throw new Error('Task 0.3 completed evidence lineage drifted');
    }
    return Object.freeze({
        ledger: verifiedLedger,
        preflight: verifiedPreflight,
        proof: verifiedProof,
        result: verifiedResult,
        trust: Object.freeze({ ...trusted, artifactSha256 }),
    });
}

async function readTrustedTask03Lineage({ privateDirectory, nowEpochMs }) {
    const trust = SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3_TRUST;
    const coordinationId = trust.coordinationId;
    const [ledger, preflight, proof, result] = await Promise.all([
        readStablePrivateJson(
            path.join(
                privateDirectory,
                `task0-3-authorized-event-trigger-${coordinationId}.json`,
            ),
            trust.artifactSha256.ledger,
        ),
        readStablePrivateJson(
            path.join(
                privateDirectory,
                `task0-3-simulation-write-preflight-${coordinationId}.json`,
            ),
            trust.artifactSha256.preflight,
        ),
        readStablePrivateJson(
            path.join(
                privateDirectory,
                `task0-3-trigger-proof-${coordinationId}.json`,
            ),
            trust.artifactSha256.proof,
        ),
        readStablePrivateJson(
            path.join(
                privateDirectory,
                `task0-3-authorized-event-trigger-result-${coordinationId}.json`,
            ),
            trust.artifactSha256.result,
        ),
    ]);
    return verifySmartOrderTask13_2CompletedTask03Lineage({
        ledger,
        preflight,
        proof,
        result,
        trust,
        currentSourceFingerprintSha256: trust.sourceFingerprintSha256,
        nowEpochMs,
    });
}

export async function importSmartOrderTask13_2CompletedTask03Evidence({
    appSupportRoot,
    nowEpochMs = Date.now(),
} = {}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < 0
    ) {
        throw new TypeError('Task 13.2 completed evidence import input is invalid');
    }
    const canonicalRoot = await assertPrivateDirectory(
        appSupportRoot,
        'app support root',
    );
    const privateDirectory = await assertPrivateDirectory(
        path.join(canonicalRoot, 'smart-order', 'private'),
        'smart-order private directory',
    );
    const capability =
        await readOrCreateSmartOrderTask13_2EvidenceCapability(privateDirectory);
    try {
        const { ledger, preflight, proof, result, trust } =
            await readTrustedTask03Lineage({ privateDirectory, nowEpochMs });
        const verifierFingerprintSha256 =
            await currentSmartOrderTask13_2VerifierFingerprint();
        const sourceFingerprintSha256 = trust.sourceFingerprintSha256;
        const resultSha256 = sha256(
            canonicalJson({
                schemaVersion:
                    SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_IMPORT_SCHEMA_VERSION,
                trustSchemaVersion: trust.schemaVersion,
                trustedArtifactSha256: trust.artifactSha256,
                ledgerState: ledger.state,
                preflightResultHash: preflight.resultHash,
                responseResultEvidenceSha256: result.resultEvidenceSha256,
                tradeIdentitySha256: proof.tradeIdentitySha256,
            }),
        );
        const formal = createSmartOrderTask13_2FormalEvidence({
            capability,
            input: {
                schemaVersion:
                    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
                evidenceId: proof.coordinationId,
                taskId: '0.3',
                operationKey: 'place_confirmed',
                runId: proof.coordinationId,
                observedTradeDate: taipeiTradeDate(proof.confirmedAtEpochMs),
                accountScopeSha256: proof.accountScopeSha256,
                apiGenerationSha256: preflight.apiGenerationSha256,
                sourceFingerprintSha256,
                verifierFingerprintSha256,
                requestSha256: proof.requestSha256,
                resultSha256,
                targetIdSha256: null,
                quantityCommonLots: 1,
                generatedAtEpochMs: proof.confirmedAtEpochMs,
                validUntilEpochMs: null,
                formalEvidence: true,
                fixture: false,
                brokerWriteAttempted: true,
                brokerWriteNetworked: true,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                accountIdentifiersPersisted: false,
            },
        });
        const verified = verifySmartOrderTask13_2FormalEvidence({
            capability,
            evidence: formal,
            expectedSourceFingerprintSha256: sourceFingerprintSha256,
            expectedVerifierFingerprintSha256: verifierFingerprintSha256,
        });
        if (verified.eligible !== true) {
            throw new Error('Task 13.2 re-encoded evidence failed verification');
        }
        const outputPath = path.join(privateDirectory, OUTPUT_FILE);
        try {
            await writeExclusivePrivateJson(outputPath, formal);
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const existing = await readStablePrivateJson(outputPath);
            if (canonicalJson(existing) !== canonicalJson(formal)) {
                throw new Error('Task 13.2 formal evidence output already differs');
            }
        }
        return Object.freeze({
            schemaVersion:
                SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_IMPORT_SCHEMA_VERSION,
            evidenceKey: '0.3:place_confirmed',
            evidenceHashSha256: formal.evidenceHashSha256,
            resultSha256,
            imported: true,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
    } finally {
        capability.fill(0);
    }
}

export async function importSmartOrderTask13_2CompletedTask03bPlaceEvidence({
    appSupportRoot,
    nowEpochMs = Date.now(),
} = {}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < 0
    ) {
        throw new TypeError('Task 13.2 Task 0.3b place import input is invalid');
    }
    const canonicalRoot = await assertPrivateDirectory(
        appSupportRoot,
        'app support root',
    );
    const privateDirectory = await assertPrivateDirectory(
        path.join(canonicalRoot, 'smart-order', 'private'),
        'smart-order private directory',
    );
    const trust = SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_PLACE_TRUST;
    const operationId = trust.coordinationId;
    const [preflight, dispatch, result, target, proof] = await Promise.all([
        readStablePrivateJson(
            path.join(privateDirectory, `task0-3b-preflight-${operationId}.json`),
            trust.artifactSha256.preflight,
        ),
        readStablePrivateJson(
            path.join(privateDirectory, `task0-3b-dispatch-${operationId}.json`),
            trust.artifactSha256.dispatch,
        ),
        readStablePrivateJson(
            path.join(privateDirectory, `task0-3b-result-${operationId}.json`),
            trust.artifactSha256.result,
        ),
        readStablePrivateJson(
            path.join(
                privateDirectory,
                `task0-3b-target-${trust.runId}-r0.json`,
            ),
            trust.artifactSha256.target,
        ),
        readStablePrivateJson(
            path.join(privateDirectory, `task0-3-trigger-proof-${operationId}.json`),
            trust.artifactSha256.proof,
        ),
    ]);
    if (
        trust.schemaVersion !==
            SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_TRUST_SCHEMA_VERSION ||
        preflight.schemaVersion !==
            'smart-order-task-probe-write-preflight/2026-08-24.1' ||
        dispatch.schemaVersion !==
            'smart-order-task-0.3b-operation-executor/2026-08-24.1' ||
        result.schemaVersion !==
            'smart-order-task-0.3b-operation-executor/2026-08-24.1' ||
        target.schemaVersion !==
            'smart-order-task-0.3b-target-lineage/2026-08-24.1' ||
        proof.schemaVersion !== PROOF_SCHEMA ||
        [preflight, dispatch, result, proof].some(
            (value) => value.coordinationId !== operationId,
        ) ||
        [preflight, dispatch, result].some(
            (value) => value.runId !== trust.runId || value.operation !== 'place',
        ) ||
        preflight.accountScopeSha256 !== trust.accountScopeSha256 ||
        preflight.apiGenerationSha256 !== trust.apiGenerationSha256 ||
        preflight.sourceFingerprintSha256 !== trust.sourceFingerprintSha256 ||
        preflight.requestSha256 !== trust.requestSha256 ||
        preflight.envelopeSha256 !== trust.envelopeSha256 ||
        preflight.marketPlanSha256 !== trust.marketPlanSha256 ||
        preflight.resultHash !== trust.preflightResultHash ||
        preflight.targetIdSha256 !== null ||
        preflight.targetRevision !== null ||
        preflight.brokerWriteAttempted !== false ||
        preflight.brokerWriteNetworked !== false ||
        preflight.automaticRetryAllowed !== false ||
        preflight.blindCleanupAllowed !== false ||
        dispatch.state !== 'dispatching_unknown_no_retry' ||
        dispatch.requestSha256 !== trust.requestSha256 ||
        dispatch.envelopeSha256 !== trust.envelopeSha256 ||
        dispatch.marketPlanSha256 !== trust.marketPlanSha256 ||
        dispatch.brokerWriteAttempted !== true ||
        dispatch.brokerWriteNetworked !== true ||
        dispatch.automaticRetryAllowed !== false ||
        dispatch.blindCleanupAllowed !== false ||
        result.state !== 'place_confirmed_target_revision_0' ||
        result.resultEvidenceSha256 !== trust.resultEvidenceSha256 ||
        result.targetIdSha256 !== trust.targetIdSha256 ||
        result.targetRevision !== 0 ||
        result.brokerWriteAttempted !== true ||
        result.brokerWriteNetworked !== true ||
        result.automaticRetryAllowed !== false ||
        result.blindCleanupAllowed !== false ||
        target.originRunId !== trust.runId ||
        target.accountScopeSha256 !== trust.accountScopeSha256 ||
        target.tradeDate !== trust.tradeDate ||
        target.targetIdSha256 !== trust.targetIdSha256 ||
        target.targetRevision !== trust.targetRevisionSha256 ||
        target.revision !== 0 ||
        target.priceMinorUnits !== trust.priceMinorUnits ||
        proof.state !== 'confirmed' ||
        proof.requestSha256 !== trust.requestSha256 ||
        proof.accountScopeSha256 !== trust.accountScopeSha256 ||
        proof.resultEvidenceSha256 !== trust.resultEvidenceSha256 ||
        proof.tradeIdentitySha256 !== trust.tradeIdentitySha256 ||
        proof.brokerWriteAttempted !== true ||
        proof.accountIdentifiersPersisted !== false ||
        !Number.isSafeInteger(proof.confirmedAtEpochMs) ||
        proof.confirmedAtEpochMs > nowEpochMs
    ) {
        throw new Error('Task 0.3b place completed evidence lineage is not trusted');
    }
    const capability =
        await readOrCreateSmartOrderTask13_2EvidenceCapability(privateDirectory);
    try {
        const verifierFingerprintSha256 =
            await currentSmartOrderTask13_2VerifierFingerprint();
        const resultSha256 = sha256(
            canonicalJson({
                schemaVersion:
                    SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_IMPORT_SCHEMA_VERSION,
                evidenceKey: trust.evidenceKey,
                trustedArtifactSha256: trust.artifactSha256,
                sourceFingerprintSha256: trust.sourceFingerprintSha256,
                preflightResultHash: trust.preflightResultHash,
                resultEvidenceSha256: trust.resultEvidenceSha256,
                targetRevisionSha256: trust.targetRevisionSha256,
            }),
        );
        const formal = createSmartOrderTask13_2FormalEvidence({
            capability,
            input: {
                schemaVersion:
                    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
                evidenceId: operationId,
                taskId: '0.3b',
                operationKey: 'place_confirmed',
                runId: trust.runId,
                observedTradeDate: trust.tradeDate,
                accountScopeSha256: trust.accountScopeSha256,
                apiGenerationSha256: trust.apiGenerationSha256,
                sourceFingerprintSha256: trust.sourceFingerprintSha256,
                verifierFingerprintSha256,
                requestSha256: trust.requestSha256,
                resultSha256,
                targetIdSha256: trust.targetIdSha256,
                quantityCommonLots: 1,
                generatedAtEpochMs: proof.confirmedAtEpochMs,
                validUntilEpochMs: null,
                formalEvidence: true,
                fixture: false,
                brokerWriteAttempted: true,
                brokerWriteNetworked: true,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                accountIdentifiersPersisted: false,
            },
        });
        const verified = verifySmartOrderTask13_2FormalEvidence({
            capability,
            evidence: formal,
            expectedSourceFingerprintSha256: trust.sourceFingerprintSha256,
            expectedVerifierFingerprintSha256: verifierFingerprintSha256,
        });
        if (!verified.eligible) {
            throw new Error('Task 0.3b place formal evidence failed verification');
        }
        const outputPath = path.join(
            privateDirectory,
            TASK_0_3B_PLACE_OUTPUT_FILE,
        );
        try {
            await writeExclusivePrivateJson(outputPath, formal);
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const existing = await readStablePrivateJson(outputPath);
            if (canonicalJson(existing) !== canonicalJson(formal)) {
                throw new Error('Task 0.3b place formal evidence already differs');
            }
        }
        return Object.freeze({
            schemaVersion:
                SMART_ORDER_TASK_13_2_COMPLETED_EVIDENCE_IMPORT_SCHEMA_VERSION,
            evidenceKey: trust.evidenceKey,
            evidenceHashSha256: formal.evidenceHashSha256,
            resultSha256,
            imported: true,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
    } finally {
        capability.fill(0);
    }
}

async function main() {
    if (process.argv.length !== 2) {
        throw new Error('Task 13.2 completed evidence import accepts no arguments');
    }
    const result = await importSmartOrderTask13_2CompletedTask03Evidence({
        appSupportRoot: process.env.REALTIME_STOCK_APP_SUPPORT,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(
            `Task 13.2 completed evidence import blocked: ${
                error?.message ?? 'unknown'
            }\n`,
        );
        process.exitCode = 1;
    });
}
