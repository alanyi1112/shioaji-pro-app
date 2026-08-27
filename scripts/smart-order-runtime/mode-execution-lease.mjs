import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export const SMART_ORDER_MODE_EXECUTION_LEASE_SCHEMA_VERSION =
    'smart-order-mode-execution-lease/2026-08-12.1';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_SOCKET_MODE = 0o600;
const EXCLUSIVE_SOCKET_NAME = 'exclusive.sock';
const EXCLUSIVE_TRANSITION_NAME = 'exclusive.transition';
const SHARED_SOCKET_PREFIX = 'shared-';
const SHARED_SOCKET_SUFFIX = '.sock';
const PROBE_TIMEOUT_MS = 250;

export function smartOrderRuntimeLeaseDirectoryForAppSupportRoot(
    appSupportRoot,
) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot)
    ) {
        throw new TypeError('appSupportRoot must be absolute');
    }
    const smartOrderRoot = path.join(path.resolve(appSupportRoot), 'smart-order');
    const shortLeaseBase = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
    const leaseScopeHash = createHash('sha256')
        .update(smartOrderRoot)
        .digest('hex')
        .slice(0, 16);
    return path.join(
        shortLeaseBase,
        `realtimestock-smart-order-${process.getuid?.() ?? 'user'}-${leaseScopeHash}`,
    );
}

export function smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
    appSupportRoot,
) {
    return path.join(
        smartOrderRuntimeLeaseDirectoryForAppSupportRoot(appSupportRoot),
        'mode-execution',
    );
}

export async function prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
    appSupportRoot,
) {
    const runtimeLeaseDirectory =
        smartOrderRuntimeLeaseDirectoryForAppSupportRoot(appSupportRoot);
    try {
        await mkdir(runtimeLeaseDirectory, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
    }
    const metadata = await lstat(runtimeLeaseDirectory);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' &&
            metadata.uid !== process.getuid())
    ) {
        throw new Error(
            'smart-order runtime lease root must be current-user private',
        );
    }
    return path.join(runtimeLeaseDirectory, 'mode-execution');
}

function boundedTimeout(value, label, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new TypeError(`${label} must be a bounded non-negative integer`);
    }
    return value;
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertPrivateDirectory(directoryPath) {
    if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
        throw new TypeError('mode execution lease directoryPath must be absolute');
    }
    const parentPath = path.dirname(directoryPath);
    const parent = await lstat(parentPath);
    if (
        parent.isSymbolicLink() ||
        !parent.isDirectory() ||
        (parent.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && parent.uid !== process.getuid())
    ) {
        throw new Error('mode execution lease parent must be a current-user private directory');
    }
    try {
        await mkdir(directoryPath, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
    }
    const directory = await lstat(directoryPath);
    if (
        directory.isSymbolicLink() ||
        !directory.isDirectory() ||
        (directory.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && directory.uid !== process.getuid())
    ) {
        throw new Error('mode execution lease directory must be current-user private');
    }
}

function listen(server, socketPath) {
    return new Promise((resolve, reject) => {
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
}

function probe(socketPath) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: socketPath });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('mode execution lease probe timed out'));
        }, PROBE_TIMEOUT_MS);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.end();
            resolve(true);
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            if (['ECONNREFUSED', 'ENOENT'].includes(error?.code)) {
                resolve(false);
                return;
            }
            reject(error);
        });
    });
}

async function unlinkStaleSocket(socketPath, expected) {
    try {
        const metadata = await lstat(socketPath);
        if (metadata.isSymbolicLink() || !metadata.isSocket()) {
            throw new Error('mode execution lease path is not a private Unix socket');
        }
        if (
            expected &&
            (metadata.dev !== expected.dev || metadata.ino !== expected.ino)
        ) {
            return false;
        }
        await unlink(socketPath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return true;
        throw error;
    }
}

async function exclusiveTransitionActive(directoryPath) {
    const transitionPath = path.join(
        directoryPath,
        EXCLUSIVE_TRANSITION_NAME,
    );
    try {
        const metadata = await lstat(transitionPath);
        if (
            metadata.isSymbolicLink() ||
            !metadata.isFile() ||
            (metadata.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error(
                'mode execution exclusive transition barrier is unsafe',
            );
        }
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function createExclusiveTransition(directoryPath) {
    const transitionPath = path.join(
        directoryPath,
        EXCLUSIVE_TRANSITION_NAME,
    );
    let handle;
    try {
        handle = await open(transitionPath, 'wx', PRIVATE_SOCKET_MODE);
    } catch (error) {
        if (error?.code === 'EEXIST') return null;
        throw error;
    }
    try {
        await handle.writeFile(`${randomUUID()}\n`, 'utf8');
        await handle.sync();
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            (metadata.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error(
                'mode execution exclusive transition barrier is unsafe',
            );
        }
        return Object.freeze({ transitionPath, metadata });
    } finally {
        await handle.close();
    }
}

async function closeExclusiveTransition(transition) {
    try {
        const current = await lstat(transition.transitionPath);
        if (
            current.isFile() &&
            !current.isSymbolicLink() &&
            current.dev === transition.metadata.dev &&
            current.ino === transition.metadata.ino
        ) {
            await unlink(transition.transitionPath);
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function socketActiveOrClean(socketPath) {
    let metadata;
    try {
        metadata = await lstat(socketPath);
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
    if (
        metadata.isSymbolicLink() ||
        !metadata.isSocket() ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error('mode execution lease path is not a private Unix socket');
    }
    try {
        if (await probe(socketPath)) return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
    const removed = await unlinkStaleSocket(socketPath, metadata);
    // A replacement between probe and unlink is conservatively treated as an
    // active owner. The next acquisition may probe it; this caller never
    // deletes a socket inode it did not inspect.
    return !removed;
}

async function closeServer(server) {
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function bindLeaseSocket(socketPath) {
    const server = net.createServer((socket) => {
        socket.end('smart-order-mode-execution-lease-active\n');
    });
    await listen(server, socketPath);
    server.unref();
    await chmod(socketPath, PRIVATE_SOCKET_MODE);
    const bound = await lstat(socketPath);
    if (
        bound.isSymbolicLink() ||
        !bound.isSocket() ||
        (bound.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && bound.uid !== process.getuid())
    ) {
        await closeServer(server);
        throw new Error('mode execution lease did not bind a private Unix socket');
    }
    return { server, bound };
}

async function closeBoundSocket(server, socketPath, bound) {
    await closeServer(server);
    try {
        const current = await lstat(socketPath);
        if (
            current.isSocket() &&
            !current.isSymbolicLink() &&
            current.dev === bound.dev &&
            current.ino === bound.ino
        ) {
            await unlink(socketPath);
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function activeSharedLeaseCount(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    let active = 0;
    for (const entry of entries) {
        if (
            entry.name === EXCLUSIVE_SOCKET_NAME ||
            entry.name === EXCLUSIVE_TRANSITION_NAME
        ) {
            continue;
        }
        if (
            !entry.name.startsWith(SHARED_SOCKET_PREFIX) ||
            !entry.name.endsWith(SHARED_SOCKET_SUFFIX) ||
            entry.isSymbolicLink()
        ) {
            throw new Error('mode execution lease directory contains an unexpected entry');
        }
        const socketPath = path.join(directoryPath, entry.name);
        if (await socketActiveOrClean(socketPath)) active += 1;
    }
    return active;
}

async function exclusiveActiveOrClean(directoryPath) {
    return socketActiveOrClean(path.join(directoryPath, EXCLUSIVE_SOCKET_NAME));
}

export async function acquireSharedModeExecutionLease({ directoryPath }) {
    await assertPrivateDirectory(directoryPath);
    if (
        (await exclusiveTransitionActive(directoryPath)) ||
        (await exclusiveActiveOrClean(directoryPath))
    ) {
        return Object.freeze({
            acquired: false,
            mode: 'shared',
            reason: 'exclusive_mode_transition_active',
            brokerAuthority: false,
        });
    }
    const leaseId = randomBytes(8).toString('hex');
    const socketPath = path.join(
        directoryPath,
        `${SHARED_SOCKET_PREFIX}${leaseId}${SHARED_SOCKET_SUFFIX}`,
    );
    const { server, bound } = await bindLeaseSocket(socketPath);
    if (
        (await exclusiveTransitionActive(directoryPath)) ||
        (await exclusiveActiveOrClean(directoryPath))
    ) {
        await closeBoundSocket(server, socketPath, bound);
        return Object.freeze({
            acquired: false,
            mode: 'shared',
            reason: 'exclusive_mode_transition_raced_shared_acquire',
            brokerAuthority: false,
        });
    }
    let closed = false;
    return Object.freeze({
        schemaVersion: SMART_ORDER_MODE_EXECUTION_LEASE_SCHEMA_VERSION,
        acquired: true,
        mode: 'shared',
        leaseId,
        brokerAuthority: false,
        async close() {
            if (closed) return;
            closed = true;
            await closeBoundSocket(server, socketPath, bound);
        },
    });
}

export async function acquireExclusiveModeExecutionLease({
    directoryPath,
    waitTimeoutMs = 5_000,
    pollIntervalMs = 10,
}) {
    await assertPrivateDirectory(directoryPath);
    const boundedWait = boundedTimeout(
        waitTimeoutMs,
        'exclusive mode lease waitTimeoutMs',
        30_000,
    );
    const boundedPoll = boundedTimeout(
        pollIntervalMs,
        'exclusive mode lease pollIntervalMs',
        1_000,
    );
    const transition = await createExclusiveTransition(directoryPath);
    if (!transition) {
        return Object.freeze({
            acquired: false,
            mode: 'exclusive',
            reason: 'exclusive_mode_transition_active',
            brokerAuthority: false,
        });
    }
    const socketPath = path.join(directoryPath, EXCLUSIVE_SOCKET_NAME);
    let boundLease;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            boundLease = await bindLeaseSocket(socketPath);
            break;
        } catch (error) {
            if (error?.code !== 'EADDRINUSE') throw error;
            if (await socketActiveOrClean(socketPath)) {
                await closeExclusiveTransition(transition);
                return Object.freeze({
                    acquired: false,
                    mode: 'exclusive',
                    reason: 'exclusive_mode_lease_active',
                    brokerAuthority: false,
                });
            }
        }
    }
    if (!boundLease) {
        // Keep the durable transition barrier. The owner could not prove a
        // safe acquisition state, so shared dispatch remains fail-closed.
        throw new Error('exclusive mode lease stale-socket recovery did not converge');
    }

    const startedAt = Date.now();
    for (;;) {
        const activeShared = await activeSharedLeaseCount(directoryPath);
        if (activeShared === 0) break;
        if (Date.now() - startedAt >= boundedWait) {
            await closeBoundSocket(
                boundLease.server,
                socketPath,
                boundLease.bound,
            );
            await closeExclusiveTransition(transition);
            return Object.freeze({
                acquired: false,
                mode: 'exclusive',
                reason: 'shared_mode_execution_leases_active',
                activeSharedLeaseCount: activeShared,
                brokerAuthority: false,
            });
        }
        await sleep(boundedPoll);
    }

    let closed = false;
    return Object.freeze({
        schemaVersion: SMART_ORDER_MODE_EXECUTION_LEASE_SCHEMA_VERSION,
        acquired: true,
        mode: 'exclusive',
        leaseId: randomUUID(),
        brokerAuthority: false,
        async close() {
            if (closed) return;
            closed = true;
            await closeBoundSocket(
                boundLease.server,
                socketPath,
                boundLease.bound,
            );
            await closeExclusiveTransition(transition);
        },
    });
}
