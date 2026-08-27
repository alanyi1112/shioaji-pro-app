import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
    acquireSharedModeExecutionLease,
    SMART_ORDER_MODE_EXECUTION_LEASE_SCHEMA_VERSION,
} from './mode-execution-lease.mjs';
import {
    createSmartOrderManagedApiProcessAttestor,
    isIssuedSmartOrderManagedApiProcessAttestation,
} from './managed-api-process-attestor.mjs';
import { isIssuedSmartOrderResourceCoordinator } from './resource-coordinator.mjs';

export const SMART_ORDER_MODE_WRITE_ADMISSION_SCHEMA_VERSION =
    'smart-order-mode-write-admission/2026-08-12.1';

const MODE_FILE_NAME = 'runtime-mode';
const API_GENERATION_FILE_NAME = 'runtime-api-generation';
const issuedAdmissions = new WeakSet();
const issuedLeases = new WeakSet();

function exactOwnDataSnapshot(value, requiredKeys, optionalKeys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an exact object`);
    }
    let ownKeys;
    let descriptors;
    try {
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} could not be inspected safely`);
    }
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (
        ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
        requiredKeys.some((key) => !ownKeys.includes(key))
    ) {
        throw new TypeError(`${label} keys are invalid`);
    }
    const snapshot = {};
    for (const key of ownKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
            typeof descriptor.get === 'function' ||
            typeof descriptor.set === 'function'
        ) {
            throw new TypeError(`${label}.${key} must be an own data property`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function token(value, label) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 240 ||
        value.trim() !== value ||
        !/^[A-Za-z0-9._:-]+$/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function boundedTimeout(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
        throw new TypeError('mode write admission timeoutMs is invalid');
    }
    return value;
}

function digest(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exactLoopbackInfoUrl(value) {
    const parsed = new URL(value);
    if (
        parsed.protocol !== 'http:' ||
        parsed.hostname !== '127.0.0.1' ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.pathname !== '/api/v1/info' ||
        parsed.search !== '' ||
        parsed.hash !== ''
    ) {
        throw new TypeError('mode write admission requires the exact loopback info URL');
    }
    const port = Number(parsed.port || 80);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new TypeError('mode write admission loopback port is invalid');
    }
    return parsed.toString();
}

async function readPrivateMarker(filePath, label, maximumBytes) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > maximumBytes ||
            (metadata.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
        ) {
            throw new Error(`${label} is not a current-user private file`);
        }
        const text = (await handle.readFile('utf8')).trim();
        if (text.length === 0 || text.includes('\u0000')) {
            throw new Error(`${label} is malformed`);
        }
        return text;
    } finally {
        await handle.close();
    }
}

async function assertPrivateCanonicalRoot(rootPath) {
    const metadata = await lstat(rootPath);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) ||
        (await realpath(rootPath)) !== rootPath
    ) {
        throw new Error(
            'mode write admission root must be a canonical current-user private directory',
        );
    }
}

async function readMarkerPair(appSupportRoot) {
    const mode = await readPrivateMarker(
        path.join(appSupportRoot, MODE_FILE_NAME),
        'runtime mode marker',
        64,
    );
    const apiGeneration = token(
        await readPrivateMarker(
            path.join(appSupportRoot, API_GENERATION_FILE_NAME),
            'API generation marker',
            256,
        ),
        'API generation marker',
    );
    return Object.freeze({ mode, apiGeneration });
}

async function fetchManagedSimulationInfo({
    infoUrl,
    operationId,
    resourceCoordinator,
    timeoutMs,
}) {
    let grant;
    const standalone = operationId === undefined;
    try {
        if (standalone) {
            grant = await resourceCoordinator.acquireOperation({
                operationId: `mode-info:${randomUUID()}`,
                kind: 'status',
            });
            operationId = grant.operationId;
        }
        await resourceCoordinator.acquireOperationUnit({ operationId });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await globalThis.fetch(infoUrl, {
                method: 'GET',
                headers: Object.freeze({ accept: 'application/json' }),
                redirect: 'error',
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
        if (!response || response.status !== 200) {
            throw new Error('managed simulation info is unavailable');
        }
        const contentType = String(response.headers?.get?.('content-type') ?? '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
        if (contentType !== 'application/json') {
            throw new Error('managed simulation info content type is invalid');
        }
        const body = await response.json();
        if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            body.simulation !== true
        ) {
            throw new Error('managed simulation info did not prove simulation');
        }
    } finally {
        if (standalone && grant) {
            const completed = resourceCoordinator.completeOperation({
                operationId: grant.operationId,
            });
            if (completed.allowed !== true) {
                throw new Error(
                    `mode admission resource settlement failed: ${completed.reason}`,
                );
            }
        }
    }
}

async function verifyCurrentSimulation(config, operationId) {
    const before = await readMarkerPair(config.appSupportRoot);
    if (
        before.mode !== 'simulation' ||
        before.apiGeneration !== config.expectedApiGeneration
    ) {
        throw new Error('private mode marker is not the expected simulation generation');
    }
    const processBefore = await config.processAttestor.attest();
    if (!isIssuedSmartOrderManagedApiProcessAttestation(processBefore)) {
        throw new Error('managed API process attestation is invalid');
    }
    await fetchManagedSimulationInfo({ ...config, operationId });
    const processAfter = await config.processAttestor.attest();
    if (
        !isIssuedSmartOrderManagedApiProcessAttestation(processAfter) ||
        processAfter.processId !== processBefore.processId ||
        processAfter.processStartIdentitySha256 !==
            processBefore.processStartIdentitySha256
    ) {
        throw new Error('managed API process changed during write admission');
    }
    const after = await readMarkerPair(config.appSupportRoot);
    if (
        after.mode !== 'simulation' ||
        after.apiGeneration !== config.expectedApiGeneration ||
        after.mode !== before.mode ||
        after.apiGeneration !== before.apiGeneration
    ) {
        throw new Error('mode or API generation changed during write admission');
    }
    return Object.freeze({
        mode: 'simulation',
        apiGeneration: config.expectedApiGeneration,
        processId: processAfter.processId,
        processStartIdentitySha256:
            processAfter.processStartIdentitySha256,
        managedApiSimulation: true,
        simulationEnvironment: processAfter.simulationEnvironment === true,
        caCredentialsPresent: processAfter.caCredentialsPresent,
        productionModeLoaded: processAfter.productionModeLoaded,
    });
}

export function createSmartOrderModeWriteAdmission(options) {
    const input = exactOwnDataSnapshot(
        options,
        [
            'appSupportRoot',
            'expectedApiGeneration',
            'leaseDirectory',
            'resourceCoordinator',
        ],
        ['expectedRepositoryRoot', 'timeoutMs'],
        'mode write admission options',
    );
    const appSupportRoot = input.appSupportRoot;
    const leaseDirectory = input.leaseDirectory;
    const expectedApiGeneration = input.expectedApiGeneration;
    const timeoutMs = input.timeoutMs ?? 2_000;
    const expectedRepositoryRoot = input.expectedRepositoryRoot;
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        typeof leaseDirectory !== 'string' ||
        !path.isAbsolute(leaseDirectory) ||
        (expectedRepositoryRoot !== undefined &&
            (!path.isAbsolute(expectedRepositoryRoot) ||
                path.resolve(expectedRepositoryRoot) ===
                    path.parse(path.resolve(expectedRepositoryRoot)).root)) ||
        !isIssuedSmartOrderResourceCoordinator(input.resourceCoordinator) ||
        typeof globalThis.fetch !== 'function'
    ) {
        throw new TypeError('mode write admission configuration is invalid');
    }
    const config = Object.freeze({
        appSupportRoot: path.resolve(appSupportRoot),
        leaseDirectory: path.resolve(leaseDirectory),
        expectedApiGeneration: token(
            expectedApiGeneration,
            'expectedApiGeneration',
        ),
        infoUrl: exactLoopbackInfoUrl(
            'http://127.0.0.1:8080/api/v1/info',
        ),
        processAttestor: createSmartOrderManagedApiProcessAttestor(
            expectedRepositoryRoot === undefined
                ? {}
                : {
                      expectedAppSupportRoot: path.resolve(appSupportRoot),
                      expectedRepositoryRoot:
                          path.resolve(expectedRepositoryRoot),
                  },
        ),
        resourceCoordinator: input.resourceCoordinator,
        timeoutMs: boundedTimeout(timeoutMs),
    });
    const admission = Object.freeze({
        schemaVersion: SMART_ORDER_MODE_WRITE_ADMISSION_SCHEMA_VERSION,
        brokerAuthority: false,
        async acquire() {
            await assertPrivateCanonicalRoot(config.appSupportRoot);
            const lease = await acquireSharedModeExecutionLease({
                directoryPath: config.leaseDirectory,
            });
            if (!lease.acquired) {
                throw new Error(`mode write admission denied: ${lease.reason}`);
            }
            let initialAttestation;
            try {
                initialAttestation = await verifyCurrentSimulation(config);
            } catch (error) {
                await lease.close();
                throw error;
            }
            let closed = false;
            const issued = Object.freeze({
                schemaVersion: SMART_ORDER_MODE_WRITE_ADMISSION_SCHEMA_VERSION,
                modeLeaseSchemaVersion:
                    SMART_ORDER_MODE_EXECUTION_LEASE_SCHEMA_VERSION,
                expectedApiGeneration: config.expectedApiGeneration,
                modeExecutionLeaseEvidenceHash: digest(
                    `${SMART_ORDER_MODE_WRITE_ADMISSION_SCHEMA_VERSION}\u001f${lease.leaseId}\u001f${config.expectedApiGeneration}`,
                ),
                initialSimulationAttestationSha256: digest(
                    JSON.stringify(initialAttestation),
                ),
                brokerAuthority: false,
                async revalidate(input) {
                    if (closed) {
                        throw new Error('mode write admission lease is closed');
                    }
                    let operationId;
                    if (input !== undefined) {
                        const current = exactOwnDataSnapshot(
                            input,
                            ['operationId'],
                            [],
                            'mode write revalidation resource context',
                        );
                        operationId = token(
                            current.operationId,
                            'mode write revalidation operationId',
                        );
                    }
                    const adjacentAttestation =
                        await verifyCurrentSimulation(config, operationId);
                    if (
                        adjacentAttestation.processId !==
                            initialAttestation.processId ||
                        adjacentAttestation.processStartIdentitySha256 !==
                            initialAttestation.processStartIdentitySha256
                    ) {
                        throw new Error(
                            'managed API process changed while mode lease was held',
                        );
                    }
                    return Object.freeze({
                        current: true,
                        simulation: true,
                        apiGeneration: config.expectedApiGeneration,
                        simulationAttestationSha256: digest(
                            JSON.stringify(adjacentAttestation),
                        ),
                        caLoaded:
                            adjacentAttestation.caCredentialsPresent === false
                                ? false
                                : null,
                        productionLoaded:
                            adjacentAttestation.productionModeLoaded === false
                                ? false
                                : null,
                        brokerAuthority: false,
                    });
                },
                async close() {
                    if (closed) return;
                    closed = true;
                    await lease.close();
                },
            });
            issuedLeases.add(issued);
            return issued;
        },
    });
    issuedAdmissions.add(admission);
    return admission;
}

export function isIssuedSmartOrderModeWriteAdmission(value) {
    return Boolean(value && typeof value === 'object' && issuedAdmissions.has(value));
}

export function isIssuedSmartOrderModeWriteLease(value) {
    return Boolean(value && typeof value === 'object' && issuedLeases.has(value));
}
