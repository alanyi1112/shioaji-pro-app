import { execFile } from 'node:child_process';

const LOOPBACK_HOST = '127.0.0.1';
const MACOS_LSOF_PATH = '/usr/sbin/lsof';
const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_CONCURRENT = 4;
const MAX_LSOF_OUTPUT_BYTES = 64 * 1024;

function exactPort(value) {
    return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function expectedClientSocketName(clientPort, serverPort) {
    return `${LOOPBACK_HOST}:${clientPort}->${LOOPBACK_HOST}:${serverPort}`;
}

export function parseSmartOrderLoopbackPeerLsofOutput(
    output,
    { clientPort, serverPort, expectedUid },
) {
    if (
        typeof output !== 'string' ||
        output.length === 0 ||
        output.length > MAX_LSOF_OUTPUT_BYTES ||
        /[\r\u0000]/.test(output) ||
        !exactPort(clientPort) ||
        !exactPort(serverPort) ||
        !Number.isSafeInteger(expectedUid) ||
        expectedUid < 0
    ) {
        return false;
    }
    const expectedName = expectedClientSocketName(clientPort, serverPort);
    let currentPid = null;
    let currentUid = null;
    let matched = false;
    for (const line of output.split('\n')) {
        if (line === '') continue;
        const field = line[0];
        const value = line.slice(1);
        if (field === 'p') {
            if (!/^[1-9]\d{0,9}$/.test(value)) return false;
            currentPid = Number(value);
            currentUid = null;
            continue;
        }
        if (field === 'u') {
            if (currentPid === null || !/^\d{1,10}$/.test(value)) {
                return false;
            }
            currentUid = Number(value);
            continue;
        }
        if (field === 'n' && value === expectedName) {
            if (
                currentPid === null ||
                currentUid === null ||
                currentUid !== expectedUid
            ) {
                return false;
            }
            matched = true;
        }
    }
    return matched;
}

function runLsofForPeer({ clientPort, serverPort, expectedUid, timeoutMs }) {
    return new Promise((resolve) => {
        execFile(
            MACOS_LSOF_PATH,
            [
                '-nP',
                '-a',
                `-iTCP@${LOOPBACK_HOST}:${clientPort}`,
                '-sTCP:ESTABLISHED',
                '-F',
                'puftn',
            ],
            {
                encoding: 'utf8',
                maxBuffer: MAX_LSOF_OUTPUT_BYTES,
                timeout: timeoutMs,
                windowsHide: true,
            },
            (error, stdout, stderr) => {
                if (error || stderr !== '') {
                    resolve(false);
                    return;
                }
                resolve(
                    parseSmartOrderLoopbackPeerLsofOutput(stdout, {
                        clientPort,
                        serverPort,
                        expectedUid,
                    }),
                );
            },
        );
    });
}

export function createSmartOrderLoopbackPeerAttestor({
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
} = {}) {
    if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 100 ||
        timeoutMs > 5_000 ||
        !Number.isSafeInteger(maxConcurrent) ||
        maxConcurrent < 1 ||
        maxConcurrent > 16
    ) {
        throw new TypeError('loopback peer attestor bounds are invalid');
    }
    const expectedUid =
        typeof process.getuid === 'function' ? process.getuid() : null;
    const socketDecisions = new WeakMap();
    let concurrent = 0;

    return Object.freeze({
        attest(socket) {
            if (
                process.platform !== 'darwin' ||
                expectedUid === null ||
                !socket ||
                (typeof socket !== 'object' && typeof socket !== 'function')
            ) {
                return Promise.resolve(false);
            }
            const existing = socketDecisions.get(socket);
            if (existing) return existing;
            const clientPort = socket.remotePort;
            const serverPort = socket.localPort;
            if (
                socket.remoteAddress !== LOOPBACK_HOST ||
                socket.localAddress !== LOOPBACK_HOST ||
                !exactPort(clientPort) ||
                !exactPort(serverPort) ||
                concurrent >= maxConcurrent
            ) {
                return Promise.resolve(false);
            }
            concurrent += 1;
            const decision = runLsofForPeer({
                clientPort,
                serverPort,
                expectedUid,
                timeoutMs,
            }).finally(() => {
                concurrent -= 1;
            });
            socketDecisions.set(socket, decision);
            return decision;
        },
    });
}
