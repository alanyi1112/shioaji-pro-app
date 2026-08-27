import { randomUUID } from 'node:crypto';
import { chmod, lstat, unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const PRIVATE_SOCKET_MODE = 0o600;
const PROBE_TIMEOUT_MS = 500;

async function assertPrivateParent(socketPath) {
    if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) {
        throw new TypeError('runtime lease socketPath must be absolute');
    }
    const parent = await lstat(path.dirname(socketPath));
    if (parent.isSymbolicLink() || !parent.isDirectory()) {
        throw new Error('runtime lease parent must be a private directory');
    }
    if ((parent.mode & 0o077) !== 0) {
        throw new Error('runtime lease parent permissions are too broad');
    }
    if (typeof process.getuid === 'function' && parent.uid !== process.getuid()) {
        throw new Error('runtime lease parent must belong to the current user');
    }
}

function listenOnce(server, socketPath) {
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

function probeExistingLease(socketPath) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: socketPath });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('runtime lease owner probe timed out'));
        }, PROBE_TIMEOUT_MS);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.end();
            resolve(true);
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOENT') {
                resolve(false);
                return;
            }
            reject(error);
        });
    });
}

async function removeStaleSocket(socketPath) {
    try {
        const metadata = await lstat(socketPath);
        if (metadata.isSymbolicLink() || !metadata.isSocket()) {
            throw new Error('runtime lease path is not a stale Unix socket');
        }
        await unlink(socketPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function closeServer(server) {
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

export async function acquireExclusiveRuntimeLease({ socketPath }) {
    await assertPrivateParent(socketPath);
    let staleRecoveryAttempted = false;
    for (;;) {
        const server = net.createServer((socket) => {
            socket.end('smart-order-runtime-active\n');
        });
        try {
            await listenOnce(server, socketPath);
            await chmod(socketPath, PRIVATE_SOCKET_MODE);
            const bound = await lstat(socketPath);
            if (!bound.isSocket() || bound.isSymbolicLink()) {
                await closeServer(server);
                throw new Error('runtime lease did not bind a private Unix socket');
            }
            let closed = false;
            return Object.freeze({
                acquired: true,
                leaseId: randomUUID(),
                socketPath,
                async close() {
                    if (closed) return;
                    closed = true;
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
                },
            });
        } catch (error) {
            await closeServer(server).catch(() => {});
            if (error?.code !== 'EADDRINUSE') throw error;
            if (await probeExistingLease(socketPath)) {
                return Object.freeze({
                    acquired: false,
                    mode: 'secondary_readonly',
                    reason: 'active_runtime_lease',
                    socketPath,
                });
            }
            if (staleRecoveryAttempted) {
                throw new Error('runtime lease stale-socket recovery did not converge');
            }
            staleRecoveryAttempted = true;
            await removeStaleSocket(socketPath);
        }
    }
}
