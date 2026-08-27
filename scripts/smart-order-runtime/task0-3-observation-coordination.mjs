import {
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, open, realpath, unlink } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import { readPrivateSecret } from './private-storage.mjs';

export const SMART_ORDER_TASK_0_3_READINESS_SCHEMA_VERSION =
    'smart-order-task-0.3-observer-readiness/2026-08-25.1';
export const SMART_ORDER_TASK_0_3_TRIGGER_PROOF_SCHEMA_VERSION =
    'smart-order-task-0.3-trigger-proof/2026-08-22.1';
export const SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS = 30_000;
export const SMART_ORDER_TASK_0_3_MAX_OBSERVER_LIFETIME_MS = 360_000;

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const issuedCoordinators = new WeakSet();

function exactObject(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an exact object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
        ownKeys.some((key) => typeof key !== 'string') ||
        JSON.stringify([...ownKeys].sort()) !== JSON.stringify([...keys].sort()) ||
        keys.some(
            (key) =>
                !descriptors[key]?.enumerable ||
                !Object.hasOwn(descriptors[key], 'value'),
        )
    ) {
        throw new TypeError(`${label} keys are invalid`);
    }
    return Object.freeze(
        Object.fromEntries(keys.map((key) => [key, descriptors[key].value])),
    );
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function task03TradeIdentitySha256(account, tradeId) {
    const brokerId = account?.broker_id ?? account?.brokerId;
    const accountId = account?.account_id ?? account?.accountId;
    const accountType = account?.account_type ?? account?.accountType;
    if (
        typeof brokerId !== 'string' ||
        brokerId.length < 1 ||
        typeof accountId !== 'string' ||
        accountId.length < 1 ||
        accountType !== 'S' ||
        typeof tradeId !== 'string' ||
        tradeId.length < 1 ||
        tradeId.length > 128
    ) {
        throw new TypeError('Task 0.3 trade identity is invalid');
    }
    return sha256(
        `task-0.3-trade-identity\u001f${canonicalJson([
            brokerId,
            accountId,
            'S',
            tradeId,
        ])}`,
    );
}

async function assertPrivateDirectory(directoryPath) {
    const canonical = await realpath(directoryPath);
    const metadata = await lstat(canonical);
    if (
        canonical !== directoryPath ||
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o777) !== 0o700 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error('Task 0.3 coordination directory is not private');
    }
}

async function writeExclusiveRecord(filePath, value) {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
    const handle = await open(
        filePath,
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
            throw new Error('Task 0.3 coordination record is not durable');
        }
        const parent = await open(
            path.dirname(filePath),
            fsConstants.O_RDONLY |
                fsConstants.O_DIRECTORY |
                fsConstants.O_NOFOLLOW,
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

async function readStableRecord(filePath, keys, label) {
    let handle;
    try {
        handle = await open(
            filePath,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 2 ||
            before.size > 16 * 1024 ||
            (before.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
        ) {
            throw new Error(`${label} changed while reading`);
        }
        try {
            return exactObject(JSON.parse(bytes.toString('utf8')), keys, label);
        } finally {
            bytes.fill(0);
        }
    } finally {
        await handle.close();
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hmac(capability, value) {
    return `sha256:${createHmac('sha256', capability)
        .update(canonicalJson(value))
        .digest('hex')}`;
}

function waitForJsonLine(socket, timeoutMs = 2_000) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Task 0.3 authenticated liveness timed out'));
        }, timeoutMs);
        const cleanup = () => {
            clearTimeout(timer);
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('close', onClose);
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onClose = () => {
            cleanup();
            reject(new Error('Task 0.3 observer liveness closed'));
        };
        const onData = (chunk) => {
            buffer += chunk.toString('utf8');
            if (Buffer.byteLength(buffer) > 4_096) {
                cleanup();
                reject(new Error('Task 0.3 liveness response is oversized'));
                return;
            }
            const boundary = buffer.indexOf('\n');
            if (boundary < 0) return;
            cleanup();
            try {
                resolve(JSON.parse(buffer.slice(0, boundary)));
            } catch {
                reject(new Error('Task 0.3 liveness response is invalid'));
            }
        };
        socket.on('data', onData);
        socket.once('error', onError);
        socket.once('close', onClose);
    });
}

export function createTask03ObservationCoordination(options) {
    const input = exactObject(
        options,
        [
            'accountScopeSha256',
            'appSupportRoot',
            'coordinationId',
            'requestSha256',
        ],
        'Task 0.3 coordination options',
    );
    if (
        typeof input.appSupportRoot !== 'string' ||
        !path.isAbsolute(input.appSupportRoot) ||
        !UUID.test(input.coordinationId) ||
        !SHA256.test(input.accountScopeSha256) ||
        !SHA256.test(input.requestSha256)
    ) {
        throw new TypeError('Task 0.3 coordination options are invalid');
    }
    const privateDirectory = path.join(
        path.resolve(input.appSupportRoot),
        'smart-order',
        'private',
    );
    const readinessPath = path.join(
        privateDirectory,
        `task0-3-observer-ready-${input.coordinationId}.json`,
    );
    const proofPath = path.join(
        privateDirectory,
        `task0-3-trigger-proof-${input.coordinationId}.json`,
    );
    const socketPath = path.join(
        '/private/tmp',
        `rts-t03-${createHash('sha256')
            .update(input.coordinationId)
            .digest('hex')
            .slice(0, 20)}.sock`,
    );
    const capabilityPath = path.join(
        privateDirectory,
        'gate-probe-cli-capability.bin',
    );
    let server;
    let serverCapability;
    let serverDeadlineEpochMs;
    let serverDeadlineTimer;
    let readinessSignalClaimed = false;
    const serverConnections = new Set();
    let clientSocket;
    let clientCapability;
    let acceptedReadiness;
    const observationAbortController = new AbortController();

    const expireServerLiveness = async () => {
        for (const connection of serverConnections) connection.destroy();
        serverConnections.clear();
        if (server) {
            const current = server;
            server = undefined;
            await new Promise((resolve) => current.close(() => resolve()));
            await unlink(socketPath).catch((error) => {
                if (error?.code !== 'ENOENT') throw error;
            });
        }
    };

    const closeReadiness = async () => {
        clientSocket?.destroy();
        clientSocket = undefined;
        clientCapability?.fill(0);
        clientCapability = undefined;
        clearTimeout(serverDeadlineTimer);
        await expireServerLiveness();
        serverCapability?.fill(0);
        serverCapability = undefined;
    };

    const challengeClientLiveness = async (minimumRemainingMs) => {
        if (
            !clientSocket ||
            clientSocket.destroyed ||
            !clientCapability ||
            !acceptedReadiness
        ) {
            throw new Error('Task 0.3 observer liveness was not acquired');
        }
        const nonce = randomBytes(32).toString('hex');
        const responsePromise = waitForJsonLine(clientSocket);
        clientSocket.write(`${JSON.stringify({ type: 'challenge', nonce })}\n`);
        const response = exactObject(
            await responsePromise,
            [
                'coordinationId',
                'hmacSha256',
                'nonce',
                'observerDeadlineEpochMs',
                'type',
            ],
            'Task 0.3 liveness response',
        );
        const content = {
            type: 'alive',
            coordinationId: input.coordinationId,
            nonce,
            observerDeadlineEpochMs:
                acceptedReadiness.observerDeadlineEpochMs,
        };
        const expected = Buffer.from(hmac(clientCapability, content), 'utf8');
        const actual = Buffer.from(String(response.hmacSha256), 'utf8');
        const authentic =
            actual.byteLength === expected.byteLength &&
            timingSafeEqual(actual, expected);
        expected.fill(0);
        actual.fill(0);
        if (
            response.type !== content.type ||
            response.coordinationId !== content.coordinationId ||
            response.nonce !== nonce ||
            response.observerDeadlineEpochMs !==
                content.observerDeadlineEpochMs ||
            !authentic ||
            content.observerDeadlineEpochMs - Date.now() < minimumRemainingMs
        ) {
            throw new Error('Task 0.3 observer liveness is invalid or expiring');
        }
        return Object.freeze({
            current: true,
            observerDeadlineEpochMs: content.observerDeadlineEpochMs,
            minimumRemainingMs,
            brokerAuthority: false,
        });
    };

    const coordinator = Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3_READINESS_SCHEMA_VERSION,
        accountScopeSha256: input.accountScopeSha256,
        coordinationId: input.coordinationId,
        requestSha256: input.requestSha256,
        observationAbortSignal: observationAbortController.signal,
        brokerAuthority: false,
        abortObservation() {
            observationAbortController.abort();
        },
        async signalReady({ observerDeadlineEpochMs }) {
            if (readinessSignalClaimed) {
                throw new Error('Task 0.3 observer readiness signal is already claimed');
            }
            readinessSignalClaimed = true;
            await assertPrivateDirectory(privateDirectory);
            const nowEpochMs = Date.now();
            if (
                !Number.isSafeInteger(observerDeadlineEpochMs) ||
                observerDeadlineEpochMs < nowEpochMs + 10_000 ||
                observerDeadlineEpochMs >
                    nowEpochMs + SMART_ORDER_TASK_0_3_MAX_OBSERVER_LIFETIME_MS ||
                server
            ) {
                throw new Error('Task 0.3 observer deadline is invalid');
            }
            serverCapability = await readPrivateSecret(capabilityPath);
            serverDeadlineEpochMs = observerDeadlineEpochMs;
            server = createServer((connection) => {
                serverConnections.add(connection);
                let buffer = '';
                connection.on('close', () => serverConnections.delete(connection));
                connection.on('data', (chunk) => {
                    buffer += chunk.toString('utf8');
                    if (Buffer.byteLength(buffer) > 4_096) {
                        connection.destroy();
                        return;
                    }
                    let boundary;
                    while ((boundary = buffer.indexOf('\n')) >= 0) {
                        const line = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 1);
                        let challenge;
                        try {
                            challenge = exactObject(
                                JSON.parse(line),
                                ['nonce', 'type'],
                                'Task 0.3 liveness challenge',
                            );
                        } catch {
                            connection.destroy();
                            return;
                        }
                        if (
                            challenge.type !== 'challenge' ||
                            !/^[0-9a-f]{64}$/.test(challenge.nonce) ||
                            Date.now() >= serverDeadlineEpochMs
                        ) {
                            connection.destroy();
                            return;
                        }
                        const content = {
                            type: 'alive',
                            coordinationId: input.coordinationId,
                            nonce: challenge.nonce,
                            observerDeadlineEpochMs: serverDeadlineEpochMs,
                        };
                        connection.write(
                            `${JSON.stringify({
                                ...content,
                                hmacSha256: hmac(serverCapability, content),
                            })}\n`,
                        );
                    }
                });
            });
            await new Promise((resolve, reject) => {
                const onError = (error) => {
                    server.off('listening', onListening);
                    reject(error);
                };
                const onListening = () => {
                    server.off('error', onError);
                    resolve();
                };
                server.once('error', onError);
                server.once('listening', onListening);
                server.listen(socketPath);
            });
            await chmod(socketPath, 0o600);
            const content = {
                schemaVersion: SMART_ORDER_TASK_0_3_READINESS_SCHEMA_VERSION,
                coordinationId: input.coordinationId,
                accountScopeSha256: input.accountScopeSha256,
                requestSha256: input.requestSha256,
                readyAtEpochMs: nowEpochMs,
                observerDeadlineEpochMs,
                socketPathSha256: sha256(socketPath),
                brokerWriteAttempted: false,
                accountIdentifiersPersisted: false,
            };
            try {
                await writeExclusiveRecord(readinessPath, {
                    ...content,
                    readinessHmacSha256: hmac(serverCapability, content),
                });
            } catch (error) {
                await closeReadiness();
                throw error;
            }
            serverDeadlineTimer = setTimeout(
                () => void expireServerLiveness().catch(() => {}),
                Math.max(1, observerDeadlineEpochMs - Date.now()),
            );
        },
        async waitForReady({
            timeoutMs = SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
        } = {}) {
            const deadline =
                Date.now() +
                Math.min(
                    SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
                    Math.max(100, timeoutMs),
                );
            while (Date.now() <= deadline) {
                const record = await readStableRecord(
                    readinessPath,
                    [
                        'accountIdentifiersPersisted',
                        'accountScopeSha256',
                        'brokerWriteAttempted',
                        'coordinationId',
                        'observerDeadlineEpochMs',
                        'readyAtEpochMs',
                        'readinessHmacSha256',
                        'requestSha256',
                        'schemaVersion',
                        'socketPathSha256',
                    ],
                    'Task 0.3 observer readiness',
                );
                if (record) {
                    if (
                        record.schemaVersion !== SMART_ORDER_TASK_0_3_READINESS_SCHEMA_VERSION ||
                        record.coordinationId !== input.coordinationId ||
                        record.accountScopeSha256 !== input.accountScopeSha256 ||
                        record.requestSha256 !== input.requestSha256 ||
                        record.brokerWriteAttempted !== false ||
                        record.accountIdentifiersPersisted !== false ||
                        !Number.isSafeInteger(record.readyAtEpochMs) ||
                        !Number.isSafeInteger(record.observerDeadlineEpochMs) ||
                        record.readyAtEpochMs > Date.now() ||
                        record.observerDeadlineEpochMs <= Date.now() ||
                        record.socketPathSha256 !== sha256(socketPath)
                    ) {
                        throw new Error('Task 0.3 observer readiness is invalid');
                    }
                    clientCapability = await readPrivateSecret(capabilityPath);
                    const content = {
                        schemaVersion: record.schemaVersion,
                        coordinationId: record.coordinationId,
                        accountScopeSha256: record.accountScopeSha256,
                        requestSha256: record.requestSha256,
                        readyAtEpochMs: record.readyAtEpochMs,
                        observerDeadlineEpochMs: record.observerDeadlineEpochMs,
                        socketPathSha256: record.socketPathSha256,
                        brokerWriteAttempted: record.brokerWriteAttempted,
                        accountIdentifiersPersisted:
                            record.accountIdentifiersPersisted,
                    };
                    const expected = Buffer.from(hmac(clientCapability, content), 'utf8');
                    const actual = Buffer.from(
                        String(record.readinessHmacSha256),
                        'utf8',
                    );
                    const authentic =
                        actual.byteLength === expected.byteLength &&
                        timingSafeEqual(actual, expected);
                    expected.fill(0);
                    actual.fill(0);
                    if (!authentic) {
                        throw new Error('Task 0.3 readiness HMAC is invalid');
                    }
                    clientSocket = createConnection(socketPath);
                    await new Promise((resolve, reject) => {
                        clientSocket.once('connect', resolve);
                        clientSocket.once('error', reject);
                    });
                    acceptedReadiness = record;
                    await challengeClientLiveness(10_000);
                    return record;
                }
                await delay(25);
            }
            throw new Error('Task 0.3 observer readiness timed out');
        },
        async revalidateReady({ minimumRemainingMs = 7_000 } = {}) {
            return challengeClientLiveness(minimumRemainingMs);
        },
        expireReadinessLiveness: expireServerLiveness,
        async writeProof({
            resultEvidenceSha256,
            state,
            tradeIdentitySha256,
        }) {
            if (
                !SHA256.test(tradeIdentitySha256) ||
                !SHA256.test(resultEvidenceSha256) ||
                ![
                    'confirmed',
                    'broker_rejected_terminal',
                    'broker_terminal_without_working_order',
                ].includes(state) ||
                !acceptedReadiness ||
                !(clientCapability instanceof Uint8Array)
            ) {
                throw new TypeError('Task 0.3 trade identity proof is invalid');
            }
            await assertPrivateDirectory(privateDirectory);
            const nowEpochMs = Date.now();
            if (acceptedReadiness.observerDeadlineEpochMs <= nowEpochMs) {
                throw new Error('Task 0.3 observer expired before proof');
            }
            const content = {
                schemaVersion: SMART_ORDER_TASK_0_3_TRIGGER_PROOF_SCHEMA_VERSION,
                coordinationId: input.coordinationId,
                accountScopeSha256: input.accountScopeSha256,
                requestSha256: input.requestSha256,
                tradeIdentitySha256,
                resultEvidenceSha256,
                state,
                confirmedAtEpochMs: nowEpochMs,
                observerDeadlineEpochMs:
                    acceptedReadiness.observerDeadlineEpochMs,
                brokerWriteAttempted: true,
                accountIdentifiersPersisted: false,
            };
            await writeExclusiveRecord(proofPath, {
                ...content,
                proofHmacSha256: hmac(clientCapability, content),
            });
        },
        async readProof({ timeoutMs = 8_000 } = {}) {
            const deadline = Date.now() + Math.min(10_000, Math.max(100, timeoutMs));
            while (Date.now() <= deadline) {
                const record = await readStableRecord(
                    proofPath,
                    [
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
                    ],
                    'Task 0.3 trigger proof',
                );
                if (record) {
                    if (
                        record.schemaVersion !== SMART_ORDER_TASK_0_3_TRIGGER_PROOF_SCHEMA_VERSION ||
                        record.coordinationId !== input.coordinationId ||
                        record.accountScopeSha256 !== input.accountScopeSha256 ||
                        record.requestSha256 !== input.requestSha256 ||
                        record.brokerWriteAttempted !== true ||
                        record.accountIdentifiersPersisted !== false ||
                        !SHA256.test(record.tradeIdentitySha256) ||
                        !SHA256.test(record.resultEvidenceSha256) ||
                        ![
                            'confirmed',
                            'broker_rejected_terminal',
                            'broker_terminal_without_working_order',
                        ].includes(record.state) ||
                        !Number.isSafeInteger(record.confirmedAtEpochMs) ||
                        !Number.isSafeInteger(record.observerDeadlineEpochMs) ||
                        record.confirmedAtEpochMs > Date.now() ||
                        record.observerDeadlineEpochMs <= record.confirmedAtEpochMs
                    ) {
                        throw new Error('Task 0.3 trigger proof is invalid');
                    }
                    const content = {
                        schemaVersion: record.schemaVersion,
                        coordinationId: record.coordinationId,
                        accountScopeSha256: record.accountScopeSha256,
                        requestSha256: record.requestSha256,
                        tradeIdentitySha256: record.tradeIdentitySha256,
                        resultEvidenceSha256: record.resultEvidenceSha256,
                        state: record.state,
                        confirmedAtEpochMs: record.confirmedAtEpochMs,
                        observerDeadlineEpochMs:
                            record.observerDeadlineEpochMs,
                        brokerWriteAttempted: record.brokerWriteAttempted,
                        accountIdentifiersPersisted:
                            record.accountIdentifiersPersisted,
                    };
                    const expected = Buffer.from(hmac(serverCapability, content), 'utf8');
                    const actual = Buffer.from(
                        String(record.proofHmacSha256),
                        'utf8',
                    );
                    const authentic =
                        actual.byteLength === expected.byteLength &&
                        timingSafeEqual(actual, expected);
                    expected.fill(0);
                    actual.fill(0);
                    if (!authentic) {
                        throw new Error('Task 0.3 trigger proof HMAC is invalid');
                    }
                    return record;
                }
                await delay(25);
            }
            return null;
        },
        closeReadiness,
    });
    issuedCoordinators.add(coordinator);
    return coordinator;
}

export function isIssuedTask03ObservationCoordination(value) {
    return Boolean(value && typeof value === 'object' && issuedCoordinators.has(value));
}
