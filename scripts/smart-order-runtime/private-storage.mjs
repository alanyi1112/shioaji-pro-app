import {
    createHash,
    createHmac,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
    chmod,
    lstat,
    mkdir,
    open,
    realpath,
    rename,
    unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { assertRepoExternalRoot } from './repo-external-root.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { smartOrderRuntimeLeaseDirectoryForAppSupportRoot } from './mode-execution-lease.mjs';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SECRET_BYTES = 32;

function exactOwnDataSnapshot(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an exact object`);
    }
    let descriptors;
    let ownKeys;
    try {
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} could not be inspected safely`);
    }
    if (
        ownKeys.some((key) => typeof key !== 'string') ||
        JSON.stringify([...ownKeys].sort()) !== JSON.stringify([...keys].sort())
    ) {
        throw new TypeError(`${label} keys are invalid`);
    }
    const snapshot = {};
    for (const key of keys) {
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

export const SMART_ORDER_STORAGE_SCHEMA_VERSION =
    'smart-order-private-storage/2026-08-13.3';
export const SMART_ORDER_REPOSITORY_EXPECTATION_SCHEMA_VERSION =
    'smart-order-repository-expectation/2026-08-11.1';
export const SMART_ORDER_LIFECYCLE_STOP_COMPLETION_SCHEMA_VERSION =
    'smart-order-lifecycle-stop-completion/2026-08-12.1';
export const SMART_ORDER_LIFECYCLE_STOP_BARRIER_SCHEMA_VERSION =
    'smart-order-lifecycle-stop-barrier/2026-08-12.1';

async function ensurePrivateDirectory(directoryPath) {
    await mkdir(directoryPath, {
        recursive: true,
        mode: PRIVATE_DIRECTORY_MODE,
    });
    const metadata = await lstat(directoryPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('private runtime directory must not be a symbolic link');
    }
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
        throw new Error('private runtime directory must belong to the current user');
    }
    await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
}

async function ensurePrivateSecret(filePath, { allowCreate = true } = {}) {
    let handle;
    try {
        handle = await open(
            filePath,
            fsConstants.O_WRONLY |
                (allowCreate
                    ? fsConstants.O_CREAT | fsConstants.O_EXCL
                    : 0) |
                fsConstants.O_NOFOLLOW,
            PRIVATE_FILE_MODE,
        );
        if (allowCreate) {
            try {
                await handle.writeFile(randomBytes(SECRET_BYTES));
                await handle.sync();
            } catch (error) {
                await handle.close().catch(() => {});
                handle = undefined;
                await unlink(filePath).catch(() => {});
                throw error;
            }
        }
    } catch (error) {
        if (error?.code === 'ENOENT' && allowCreate === false) {
            throw new Error(
                `required private secret is missing: ${path.basename(filePath)}`,
            );
        }
        if (error?.code !== 'EEXIST') throw error;
        handle = await open(
            filePath,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
    }
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size !== SECRET_BYTES ||
            (metadata.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error(
                `private secret has invalid shape: ${path.basename(filePath)}`,
            );
        }
        await handle.chmod(PRIVATE_FILE_MODE);
    } finally {
        await handle.close();
    }
}

async function ensurePrivateInstallationId(filePath) {
    let handle;
    try {
        handle = await open(
            filePath,
            fsConstants.O_RDWR |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            PRIVATE_FILE_MODE,
        );
        try {
            await handle.writeFile(`${randomUUID()}\n`, 'utf8');
            await handle.sync();
        } catch (error) {
            await handle.close().catch(() => {});
            handle = undefined;
            await unlink(filePath).catch(() => {});
            throw error;
        }
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        handle = await open(
            filePath,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
    }
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 2 ||
            metadata.size > 64 ||
            (metadata.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('private installation id has invalid shape');
        }
        const buffer = Buffer.alloc(metadata.size);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== buffer.length) {
            throw new Error('private installation id could not be read completely');
        }
        const value = buffer.toString('utf8').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
            throw new Error('private installation id is invalid');
        }
        await handle.chmod(PRIVATE_FILE_MODE);
        return value;
    } finally {
        await handle.close();
    }
}

function repositoryExpectationRecord({
    databasePath,
    installationId,
    repositoryExpected,
}) {
    return Object.freeze({
        schemaVersion: SMART_ORDER_REPOSITORY_EXPECTATION_SCHEMA_VERSION,
        databasePathSha256: `sha256:${createHash('sha256')
            .update(path.resolve(databasePath))
            .digest('hex')}`,
        installationIdSha256: `sha256:${createHash('sha256')
            .update(installationId)
            .digest('hex')}`,
        repositoryExpected,
    });
}

async function databaseArtifactExists(databasePath) {
    try {
        const metadata = await lstat(databasePath);
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new Error('existing SQLite repository must be a regular file');
        }
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function ensureRepositoryExpectationMarker({
    markerPath,
    databasePath,
    installationId,
}) {
    const expectedRecord = repositoryExpectationRecord({
        databasePath,
        installationId,
        repositoryExpected: await databaseArtifactExists(databasePath),
    });
    let handle;
    let marker;
    try {
        handle = await open(
            markerPath,
            fsConstants.O_RDWR |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            PRIVATE_FILE_MODE,
        );
        await handle.writeFile(`${JSON.stringify(expectedRecord)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = await open(
            markerPath,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
    } catch (error) {
        await handle?.close().catch(() => {});
        handle = undefined;
        if (error?.code !== 'EEXIST') throw error;
        handle = await open(
            markerPath,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
    }
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            (metadata.mode & 0o777) !== PRIVATE_FILE_MODE ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('repository expectation marker is not private and writable');
        }
        const parsed = JSON.parse(await handle.readFile('utf8'));
        const expectedKeys = [
            'databasePathSha256',
            'installationIdSha256',
            'repositoryExpected',
            'schemaVersion',
        ];
        if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed) ||
            JSON.stringify(Object.keys(parsed).sort()) !==
                JSON.stringify(expectedKeys.sort()) ||
            parsed.schemaVersion !==
                SMART_ORDER_REPOSITORY_EXPECTATION_SCHEMA_VERSION ||
            parsed.databasePathSha256 !== expectedRecord.databasePathSha256 ||
            parsed.installationIdSha256 !==
                expectedRecord.installationIdSha256 ||
            typeof parsed.repositoryExpected !== 'boolean'
        ) {
            throw new Error('repository expectation marker is invalid');
        }
        marker = Object.freeze({ ...parsed });
    } finally {
        await handle.close();
    }
    return marker;
}

async function writePrivateFileAtomically(filePath, value) {
    const pendingPath = `${filePath}.pending-${randomUUID()}`;
    let handle;
    try {
        handle = await open(
            pendingPath,
            fsConstants.O_WRONLY |
                fsConstants.O_CREAT |
                fsConstants.O_EXCL |
                fsConstants.O_NOFOLLOW,
            PRIVATE_FILE_MODE,
        );
        if (typeof value === 'string') {
            await handle.writeFile(value, 'utf8');
        } else if (value instanceof Uint8Array) {
            await handle.writeFile(value);
        } else {
            throw new TypeError('private file value must be text or bytes');
        }
        await handle.sync();
        await handle.chmod(PRIVATE_FILE_MODE);
        await handle.close();
        handle = undefined;
        await rename(pendingPath, filePath);
        const directory = await open(
            path.dirname(filePath),
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
        try {
            await directory.sync();
        } finally {
            await directory.close();
        }
    } catch (error) {
        await handle?.close().catch(() => {});
        await unlink(pendingPath).catch(() => {});
        throw error;
    }
    const metadata = await lstat(filePath);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error('private settings summary was not published safely');
    }
    await chmod(filePath, PRIVATE_FILE_MODE);
}

/**
 * Rotates only the gateway capability after the caller has acquired the
 * exclusive Runtime lease. The identity HMAC key has a separate lifecycle and
 * must never be changed as a side effect of a Runtime restart.
 */
export async function rotatePrivateGatewayCapability(capabilityPath) {
    const current = await readPrivateSecret(capabilityPath);
    current.fill(0);
    const replacement = randomBytes(SECRET_BYTES);
    try {
        await writePrivateFileAtomically(capabilityPath, replacement);
        const published = await readPrivateSecret(capabilityPath);
        try {
            if (!Buffer.from(published).equals(replacement)) {
                throw new Error('gateway capability rotation verification failed');
            }
        } finally {
            published.fill(0);
        }
    } finally {
        replacement.fill(0);
    }
    return Object.freeze({ rotated: true, secretValuesExposed: false });
}

export async function writePrivateRuntimeDiscovery(filePath, discovery) {
    if (
        !discovery ||
        typeof discovery !== 'object' ||
        Array.isArray(discovery) ||
        JSON.stringify(Object.keys(discovery).sort()) !==
            JSON.stringify(
                [
                    'host',
                    'port',
                    'runtimeEpochId',
                    'schemaVersion',
                    'startedAtEpochMs',
                ].sort(),
            )
    ) {
        throw new TypeError('runtime discovery schema is invalid');
    }
    if (
        discovery.host !== '127.0.0.1' ||
        !Number.isInteger(discovery.port) ||
        discovery.port < 1 ||
        discovery.port > 65_535 ||
        typeof discovery.runtimeEpochId !== 'string' ||
        discovery.runtimeEpochId.length === 0 ||
        discovery.runtimeEpochId.length > 240 ||
        typeof discovery.schemaVersion !== 'string' ||
        discovery.schemaVersion.length === 0 ||
        discovery.schemaVersion.length > 240 ||
        !Number.isSafeInteger(discovery.startedAtEpochMs) ||
        discovery.startedAtEpochMs < 0
    ) {
        throw new TypeError('runtime discovery values are invalid');
    }
    await writePrivateFileAtomically(
        filePath,
        `${JSON.stringify(discovery)}\n`,
    );
}

const lifecycleCompletionDigestPattern = /^sha256:[0-9a-f]{64}$/;
const lifecycleCompletionProofPattern = /^hmac-sha256:[0-9a-f]{64}$/;
const lifecycleCompletionOperations = new Set([
    'graceful_stop',
    'production_readonly',
    'rollback',
    'feature_off',
    'uninstall',
]);

function lifecycleStopCompletionUnsigned(input) {
    const expectedKeys = [
        'operation',
        'runtimeEpochIdSha256',
        'apiGenerationSha256',
        'stopRevision',
        'completionNonceSha256',
        'requestIdSha256',
        'completedAtEpochMs',
        'repositoryClosed',
        'controlPlaneUnpublished',
        'runtimeLeaseReleased',
    ];
    const candidate = exactOwnDataSnapshot(
        input,
        expectedKeys,
        'lifecycle stop completion',
    );
    if (
        !lifecycleCompletionOperations.has(candidate.operation) ||
        !lifecycleCompletionDigestPattern.test(candidate.runtimeEpochIdSha256) ||
        !lifecycleCompletionDigestPattern.test(candidate.apiGenerationSha256) ||
        !Number.isSafeInteger(candidate.stopRevision) ||
        candidate.stopRevision < 0 ||
        !lifecycleCompletionDigestPattern.test(candidate.completionNonceSha256) ||
        !lifecycleCompletionDigestPattern.test(candidate.requestIdSha256) ||
        !Number.isSafeInteger(candidate.completedAtEpochMs) ||
        candidate.completedAtEpochMs < 0 ||
        candidate.repositoryClosed !== true ||
        candidate.controlPlaneUnpublished !== true ||
        candidate.runtimeLeaseReleased !== true
    ) {
        throw new TypeError('lifecycle stop completion values are invalid');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_LIFECYCLE_STOP_COMPLETION_SCHEMA_VERSION,
        ...candidate,
    });
}

function lifecycleStopCompletionProof(capability, unsigned) {
    if (!(capability instanceof Uint8Array) || capability.byteLength !== 32) {
        throw new TypeError('lifecycle completion capability is invalid');
    }
    return `hmac-sha256:${createHmac('sha256', capability)
        .update(canonicalJson(unsigned, { maximumBytes: 4_096 }))
        .digest('hex')}`;
}

function lifecycleStopBarrierUnsigned(input) {
    const expectedKeys = [
        'operation',
        'runtimeEpochIdSha256',
        'apiGenerationSha256',
        'stopRevision',
        'completionNonceSha256',
        'requestIdSha256',
    ];
    const candidate = exactOwnDataSnapshot(
        input,
        expectedKeys,
        'lifecycle stop barrier',
    );
    if (
        !lifecycleCompletionOperations.has(candidate.operation) ||
        !lifecycleCompletionDigestPattern.test(candidate.runtimeEpochIdSha256) ||
        !lifecycleCompletionDigestPattern.test(candidate.apiGenerationSha256) ||
        !Number.isSafeInteger(candidate.stopRevision) ||
        candidate.stopRevision < 0 ||
        !lifecycleCompletionDigestPattern.test(candidate.completionNonceSha256) ||
        !lifecycleCompletionDigestPattern.test(candidate.requestIdSha256)
    ) {
        throw new TypeError('lifecycle stop barrier values are invalid');
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_LIFECYCLE_STOP_BARRIER_SCHEMA_VERSION,
        ...candidate,
    });
}

export async function writePrivateLifecycleStopBarrier(
    filePath,
    { capability, binding },
) {
    const unsigned = lifecycleStopBarrierUnsigned(binding);
    const record = Object.freeze({
        ...unsigned,
        barrierProof: lifecycleStopCompletionProof(capability, unsigned),
    });
    await writePrivateFileAtomically(
        filePath,
        `${canonicalJson(record, { maximumBytes: 4_096 })}\n`,
    );
    return Object.freeze({
        written: true,
        schemaVersion: unsigned.schemaVersion,
        secretValuesExposed: false,
    });
}

export async function assertPrivateLifecycleStopBarrierClear(filePath) {
    try {
        await lstat(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    throw new Error(
        'a previous Runtime lifecycle stop handoff is not finalized',
    );
}

export async function removePrivateLifecycleStopBarrier(
    filePath,
    { capability, expected },
) {
    await verifyPrivateLifecycleStopBarrier(filePath, {
        capability,
        expected,
    });
    await unlink(filePath);
    const directory = await open(
        path.dirname(filePath),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
    return Object.freeze({
        removed: true,
        secretValuesExposed: false,
    });
}

async function readPrivateLifecycleStopBarrier(filePath, capability) {
    const expectedKeys = [
        'operation',
        'runtimeEpochIdSha256',
        'apiGenerationSha256',
        'stopRevision',
        'completionNonceSha256',
        'requestIdSha256',
    ];
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    let metadata;
    let bytes;
    try {
        metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > 4_096 ||
            (metadata.mode & 0o777) !== PRIVATE_FILE_MODE ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error(
                'lifecycle stop barrier is not a private regular file',
            );
        }
        bytes = await handle.readFile();
    } finally {
        await handle.close();
    }
    const current = await lstat(filePath);
    if (
        current.isSymbolicLink() ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        current.size !== metadata.size ||
        current.mtimeMs !== metadata.mtimeMs
    ) {
        bytes?.fill(0);
        throw new Error('lifecycle stop barrier changed while reading');
    }
    let record;
    try {
        const text = bytes.toString('utf8');
        if (!text.endsWith('\n') || text.includes('\u0000')) {
            throw new Error('lifecycle stop barrier encoding is invalid');
        }
        record = JSON.parse(text);
    } finally {
        bytes.fill(0);
    }
    const recordKeys = [
        'apiGenerationSha256',
        'barrierProof',
        'completionNonceSha256',
        'operation',
        'requestIdSha256',
        'runtimeEpochIdSha256',
        'schemaVersion',
        'stopRevision',
    ];
    if (
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        JSON.stringify(Object.keys(record).sort()) !==
            JSON.stringify(recordKeys.sort()) ||
        record.schemaVersion !== SMART_ORDER_LIFECYCLE_STOP_BARRIER_SCHEMA_VERSION ||
        !lifecycleCompletionProofPattern.test(record.barrierProof)
    ) {
        throw new Error('lifecycle stop barrier schema is invalid');
    }
    const { barrierProof, schemaVersion: _schemaVersion, ...candidate } = record;
    const unsigned = lifecycleStopBarrierUnsigned(candidate);
    const expectedProof = lifecycleStopCompletionProof(capability, unsigned);
    const receivedProof = Buffer.from(barrierProof, 'utf8');
    const wantedProof = Buffer.from(expectedProof, 'utf8');
    const proofMatches =
        receivedProof.length === wantedProof.length &&
        timingSafeEqual(receivedProof, wantedProof);
    receivedProof.fill(0);
    wantedProof.fill(0);
    if (!proofMatches) {
        throw new Error('lifecycle stop barrier proof is invalid');
    }
    return Object.freeze(
        Object.fromEntries(expectedKeys.map((key) => [key, unsigned[key]])),
    );
}

export async function verifyPrivateLifecycleStopBarrier(
    filePath,
    { capability, expected },
) {
    const expectedKeys = [
        'operation',
        'runtimeEpochIdSha256',
        'apiGenerationSha256',
        'stopRevision',
        'completionNonceSha256',
        'requestIdSha256',
    ];
    const expectedSnapshot = exactOwnDataSnapshot(
        expected,
        expectedKeys,
        'expected lifecycle stop barrier',
    );
    const binding = await readPrivateLifecycleStopBarrier(
        filePath,
        capability,
    );
    if (expectedKeys.some((key) => binding[key] !== expectedSnapshot[key])) {
        throw new Error('lifecycle stop barrier proof or binding is invalid');
    }
    return binding;
}

export async function writePrivateLifecycleStopCompletion(
    filePath,
    { capability, completion },
) {
    const unsigned = lifecycleStopCompletionUnsigned(completion);
    const record = Object.freeze({
        ...unsigned,
        completionProof: lifecycleStopCompletionProof(capability, unsigned),
    });
    await writePrivateFileAtomically(
        filePath,
        `${canonicalJson(record, { maximumBytes: 4_096 })}\n`,
    );
    return Object.freeze({
        written: true,
        schemaVersion: unsigned.schemaVersion,
        secretValuesExposed: false,
    });
}

async function readPrivateLifecycleStopCompletion(filePath, capability) {
    const expectedKeys = [
        'operation',
        'runtimeEpochIdSha256',
        'apiGenerationSha256',
        'stopRevision',
        'completionNonceSha256',
        'requestIdSha256',
    ];
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    let metadata;
    let bytes;
    try {
        metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > 4_096 ||
            (metadata.mode & 0o777) !== PRIVATE_FILE_MODE ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error(
                'lifecycle stop completion is not a private regular file',
            );
        }
        bytes = await handle.readFile();
    } finally {
        await handle.close();
    }
    const current = await lstat(filePath);
    if (
        current.isSymbolicLink() ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        current.size !== metadata.size ||
        current.mtimeMs !== metadata.mtimeMs
    ) {
        bytes?.fill(0);
        throw new Error('lifecycle stop completion changed while reading');
    }
    let record;
    try {
        const text = bytes.toString('utf8');
        if (!text.endsWith('\n') || text.includes('\u0000')) {
            throw new Error('lifecycle stop completion encoding is invalid');
        }
        record = JSON.parse(text);
    } finally {
        bytes.fill(0);
    }
    const recordKeys = [
        'apiGenerationSha256',
        'completedAtEpochMs',
        'completionNonceSha256',
        'completionProof',
        'controlPlaneUnpublished',
        'operation',
        'repositoryClosed',
        'requestIdSha256',
        'runtimeEpochIdSha256',
        'runtimeLeaseReleased',
        'schemaVersion',
        'stopRevision',
    ];
    if (
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        JSON.stringify(Object.keys(record).sort()) !==
            JSON.stringify(recordKeys.sort()) ||
        record.schemaVersion !==
            SMART_ORDER_LIFECYCLE_STOP_COMPLETION_SCHEMA_VERSION ||
        !lifecycleCompletionProofPattern.test(record.completionProof)
    ) {
        throw new Error('lifecycle stop completion schema is invalid');
    }
    const { completionProof, schemaVersion: _schemaVersion, ...candidate } =
        record;
    const unsigned = lifecycleStopCompletionUnsigned(candidate);
    const expectedProof = lifecycleStopCompletionProof(capability, unsigned);
    const receivedProof = Buffer.from(completionProof, 'utf8');
    const wantedProof = Buffer.from(expectedProof, 'utf8');
    const proofMatches =
        receivedProof.length === wantedProof.length &&
        timingSafeEqual(receivedProof, wantedProof);
    receivedProof.fill(0);
    wantedProof.fill(0);
    if (!proofMatches) {
        throw new Error('lifecycle stop completion proof is invalid');
    }
    return Object.freeze({
        schemaVersion: unsigned.schemaVersion,
        operation: unsigned.operation,
        runtimeEpochIdSha256: unsigned.runtimeEpochIdSha256,
        apiGenerationSha256: unsigned.apiGenerationSha256,
        stopRevision: unsigned.stopRevision,
        completionNonceSha256: unsigned.completionNonceSha256,
        requestIdSha256: unsigned.requestIdSha256,
        completedAtEpochMs: unsigned.completedAtEpochMs,
        repositoryClosed: true,
        controlPlaneUnpublished: true,
        runtimeLeaseReleased: true,
        secretValuesExposed: false,
    });
}

export async function verifyPrivateLifecycleStopCompletion(
    filePath,
    { capability, expected },
) {
    const expectedKeys = [
        'operation',
        'runtimeEpochIdSha256',
        'apiGenerationSha256',
        'stopRevision',
        'completionNonceSha256',
        'requestIdSha256',
    ];
    const expectedSnapshot = exactOwnDataSnapshot(
        expected,
        expectedKeys,
        'expected lifecycle stop completion',
    );
    const completion = await readPrivateLifecycleStopCompletion(
        filePath,
        capability,
    );
    if (
        expectedKeys.some(
            (key) => completion[key] !== expectedSnapshot[key],
        )
    ) {
        throw new Error('lifecycle stop completion proof or binding is invalid');
    }
    return completion;
}

export async function readPendingPrivateLifecycleStopCompletion(
    filePath,
    { capability, barrierPath },
) {
    if (
        typeof barrierPath !== 'string' ||
        path.dirname(barrierPath) !== path.dirname(filePath)
    ) {
        throw new TypeError('lifecycle stop barrier path is invalid');
    }
    const completion = await readPrivateLifecycleStopCompletion(
        filePath,
        capability,
    );
    const expected = Object.freeze({
        operation: completion.operation,
        runtimeEpochIdSha256: completion.runtimeEpochIdSha256,
        apiGenerationSha256: completion.apiGenerationSha256,
        stopRevision: completion.stopRevision,
        completionNonceSha256: completion.completionNonceSha256,
        requestIdSha256: completion.requestIdSha256,
    });
    await verifyPrivateLifecycleStopBarrier(barrierPath, {
        capability,
        expected,
    });
    return Object.freeze({ completion, expected });
}

export async function consumePrivateLifecycleStopCompletion(
    filePath,
    { capability, expected, barrierPath },
) {
    if (typeof barrierPath !== 'string' || path.dirname(barrierPath) !== path.dirname(filePath)) {
        throw new TypeError('lifecycle stop barrier path is invalid');
    }
    const completion = await verifyPrivateLifecycleStopCompletion(filePath, {
        capability,
        expected,
    });
    await verifyPrivateLifecycleStopBarrier(barrierPath, {
        capability,
        expected,
    });
    // Remove the startup-blocking barrier first.  Both authenticated records
    // have already been verified, so a crash after this unlink is safe: the
    // old Runtime has released repository/listener/lease ownership and a new
    // Runtime may remove the now-stale completion during startup.  Removing
    // the completion first could strand an unverifiable lone barrier forever.
    await unlink(barrierPath);
    const directory = await open(
        path.dirname(filePath),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
    await unlink(filePath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
    });
    const completionDirectory = await open(
        path.dirname(filePath),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        await completionDirectory.sync();
    } finally {
        await completionDirectory.close();
    }
    return completion;
}

export async function readPrivateRuntimeDiscovery(
    filePath,
    { nowEpochMs = Date.now() } = {},
) {
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        throw new TypeError('runtime discovery time is invalid');
    }
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    let metadata;
    let bytes;
    try {
        metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > 1_024 ||
            (metadata.mode & 0o777) !== PRIVATE_FILE_MODE ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('runtime discovery is not a private regular file');
        }
        bytes = await handle.readFile();
    } finally {
        await handle.close();
    }
    const current = await lstat(filePath);
    if (
        current.isSymbolicLink() ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        current.size !== metadata.size ||
        current.mtimeMs !== metadata.mtimeMs
    ) {
        bytes?.fill(0);
        throw new Error('runtime discovery changed while reading');
    }
    let discovery;
    try {
        const text = bytes.toString('utf8');
        if (!text.endsWith('\n') || text.includes('\u0000')) {
            throw new Error('runtime discovery encoding is invalid');
        }
        discovery = JSON.parse(text);
    } finally {
        bytes.fill(0);
    }
    if (
        !discovery ||
        typeof discovery !== 'object' ||
        Array.isArray(discovery) ||
        JSON.stringify(Object.keys(discovery).sort()) !==
            JSON.stringify(
                [
                    'host',
                    'port',
                    'runtimeEpochId',
                    'schemaVersion',
                    'startedAtEpochMs',
                ].sort(),
            ) ||
        discovery.schemaVersion !==
            'smart-order-local-sidecar/2026-08-11.1' ||
        discovery.host !== '127.0.0.1' ||
        !Number.isInteger(discovery.port) ||
        discovery.port < 1 ||
        discovery.port > 65_535 ||
        typeof discovery.runtimeEpochId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,240}$/.test(discovery.runtimeEpochId) ||
        !Number.isSafeInteger(discovery.startedAtEpochMs) ||
        discovery.startedAtEpochMs < 0 ||
        discovery.startedAtEpochMs > nowEpochMs + 30_000
    ) {
        throw new Error('runtime discovery values are invalid');
    }
    return Object.freeze({ ...discovery });
}

async function assertContained(parentPath, childPath) {
    const parent = await realpath(parentPath);
    const childParent = await realpath(path.dirname(childPath));
    if (childParent !== parent && !childParent.startsWith(`${parent}${path.sep}`)) {
        throw new Error('private runtime path escaped its configured root');
    }
}

export async function prepareSmartOrderPrivateStorage({ appSupportRoot }) {
    const root = await assertRepoExternalRoot(
        appSupportRoot,
        'appSupportRoot',
    );
    const smartOrderRoot = path.join(root, 'smart-order');
    const databaseDirectory = path.join(smartOrderRoot, 'database');
    const backupDirectory = path.join(smartOrderRoot, 'backups');
    const secretDirectory = path.join(smartOrderRoot, 'private');
    const runDirectory = path.join(smartOrderRoot, 'run');
    const databasePath = path.join(databaseDirectory, 'smart-orders.sqlite3');
    const runtimeLeaseDirectory =
        smartOrderRuntimeLeaseDirectoryForAppSupportRoot(root);
    for (const directoryPath of [
        root,
        smartOrderRoot,
        databaseDirectory,
        backupDirectory,
        secretDirectory,
        runDirectory,
        runtimeLeaseDirectory,
    ]) {
        await ensurePrivateDirectory(directoryPath);
    }

    const capabilityPath = path.join(secretDirectory, 'gateway-capability.bin');
    const gateProbeCliCapabilityPath = path.join(
        secretDirectory,
        'gate-probe-cli-capability.bin',
    );
    const identityKeyPath = path.join(secretDirectory, 'identity-hmac-key.bin');
    await assertContained(smartOrderRoot, capabilityPath);
    await assertContained(smartOrderRoot, gateProbeCliCapabilityPath);
    await assertContained(smartOrderRoot, identityKeyPath);
    await ensurePrivateSecret(capabilityPath);
    await ensurePrivateSecret(gateProbeCliCapabilityPath);

    const installationIdPath = path.join(secretDirectory, 'installation-id');
    await assertContained(smartOrderRoot, installationIdPath);
    const installationId = await ensurePrivateInstallationId(installationIdPath);
    const repositoryExpectationPath = path.join(
        secretDirectory,
        'repository-expectation.json',
    );
    await assertContained(smartOrderRoot, repositoryExpectationPath);
    const repositoryExpectation = await ensureRepositoryExpectationMarker({
        markerPath: repositoryExpectationPath,
        databasePath,
        installationId,
    });
    await ensurePrivateSecret(identityKeyPath, {
        allowCreate: repositoryExpectation.repositoryExpected === false,
    });

    const paths = Object.freeze({
        root: smartOrderRoot,
        databaseDirectory,
        databasePath,
        backupDirectory,
        secretDirectory,
        capabilityPath,
        gateProbeCliCapabilityPath,
        identityKeyPath,
        installationIdPath,
        repositoryExpectationPath,
        runDirectory,
        runtimeLeaseDirectory,
        modeExecutionLeaseDirectory: path.join(
            runtimeLeaseDirectory,
            'mode-execution',
        ),
        senderLockPath: path.join(runDirectory, 'sender.lock.json'),
        senderLeaseSocketPath: path.join(runtimeLeaseDirectory, 'sender.sock'),
        settingsSummaryPath: path.join(smartOrderRoot, 'settings-summary.json'),
        controlPlaneDiscoveryPath: path.join(
            runDirectory,
            'control-plane.json',
        ),
        lifecycleStopCompletionPath: path.join(
            runDirectory,
            'lifecycle-stop-completion.json',
        ),
        lifecycleStopBarrierPath: path.join(
            runDirectory,
            'lifecycle-stop-barrier.json',
        ),
    });
    const summary = Object.freeze({
        schemaVersion: SMART_ORDER_STORAGE_SCHEMA_VERSION,
        repository: 'sqlite-private',
        capability: 'present-private-file',
        identityKey: 'present-private-file',
        secretValuesExposed: false,
    });
    await assertContained(smartOrderRoot, paths.settingsSummaryPath);
    await writePrivateFileAtomically(
        paths.settingsSummaryPath,
        `${JSON.stringify(summary)}\n`,
    );
    return Object.freeze({ paths, summary });
}

export async function readPrivateSecret(filePath) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size !== SECRET_BYTES ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid()) ||
            (metadata.mode & 0o077) !== 0
        ) {
            throw new Error('private secret length or permissions are invalid');
        }
        const value = await handle.readFile();
        return Uint8Array.from(value);
    } finally {
        await handle.close();
    }
}

export async function hardenSqliteArtifacts(databasePath) {
    const artifacts = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
    for (const artifactPath of artifacts) {
        try {
            const metadata = await lstat(artifactPath);
            if (metadata.isSymbolicLink() || !metadata.isFile()) {
                throw new Error('SQLite artifact is not a regular file');
            }
            if (
                (metadata.mode & 0o777) !== PRIVATE_FILE_MODE ||
                (typeof process.getuid === 'function' &&
                    metadata.uid !== process.getuid())
            ) {
                throw new Error(
                    'existing SQLite artifact must already have exact 0600 permissions',
                );
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
}

export async function hardenBackupArtifact(backupPath) {
    const metadata = await lstat(backupPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error('backup artifact is not a regular file');
    }
    if (
        (metadata.mode & 0o777) !== PRIVATE_FILE_MODE ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error(
            'existing backup artifact must already have exact 0600 permissions',
        );
    }
}

export function redactPrivateRuntimeStatus(storage) {
    return Object.freeze({
        schemaVersion: storage.summary.schemaVersion,
        repository: storage.summary.repository,
        capability: storage.summary.capability,
        identityKey: storage.summary.identityKey,
        secretValuesExposed: false,
    });
}
