import http from 'node:http';
import { canonicalManualStockBrokerWriteRequest } from './manual-broker-write-contract.mjs';
import { consumeTaskProbeWritePreflightReceipt } from './task-probe-write-preflight.mjs';

export const SMART_ORDER_TASK_PROBE_PINNED_TRANSPORT_SCHEMA_VERSION =
    'smart-order-task-probe-pinned-transport/2026-08-24.1';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function readResponse(response) {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks = [];
        response.on('data', (chunk) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.byteLength;
            if (total > MAX_JSON_BYTES) {
                response.destroy(new Error('task probe response is oversized'));
                return;
            }
            chunks.push(bytes);
        });
        response.once('error', reject);
        response.once('end', () =>
            resolve(Object.freeze({
                bodyBytes: Buffer.concat(chunks, total),
                headers: response.headers,
                statusCode: response.statusCode,
            })),
        );
    });
}

function request({ agent, expectedSocket, host, port, method, pathname, bodyBytes }) {
    return new Promise((resolve, reject) => {
        let assignedSocket;
        const outgoing = http.request(
            {
                agent,
                host,
                port,
                method,
                path: pathname,
                headers: {
                    Accept: 'application/json',
                    Connection: 'keep-alive',
                    ...(bodyBytes === undefined
                        ? {}
                        : {
                              'Content-Type': 'application/json',
                              'Content-Length': bodyBytes.byteLength,
                          }),
                },
            },
            async (response) => {
                try {
                    resolve(Object.freeze({
                        ...(await readResponse(response)),
                        socket: assignedSocket,
                    }));
                } catch (error) {
                    reject(error);
                }
            },
        );
        outgoing.setTimeout(5_000, () =>
            outgoing.destroy(new Error('task probe request timed out')),
        );
        outgoing.once('error', reject);
        outgoing.once('socket', (socket) => {
            assignedSocket = socket;
            const dispatch = () => {
                if (
                    socket.remoteAddress !== host ||
                    socket.remotePort !== port ||
                    (expectedSocket !== undefined && socket !== expectedSocket)
                ) {
                    outgoing.destroy(new Error('task probe socket identity changed'));
                    return;
                }
                outgoing.end(bodyBytes);
            };
            if (socket.connecting) socket.once('connect', dispatch);
            else dispatch();
        });
    });
}

function upstreamPayload(canonical) {
    const { operation, payload } = canonical.request;
    if (operation === 'place') return payload;
    if (operation === 'update_price') {
        return Object.freeze({ trade_id: payload.trade_id, price: payload.price });
    }
    if (operation === 'cancel') {
        return Object.freeze({ trade_id: payload.trade_id });
    }
    throw new Error('task probe operation is not allowlisted');
}

export async function openTaskProbePinnedTransport({
    host = '127.0.0.1',
    port = 8080,
} = {}) {
    if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new TypeError('task probe endpoint is invalid');
    }
    const agent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 5_000,
        maxFreeSockets: 1,
        maxSockets: 1,
    });
    try {
        const info = await request({
            agent,
            host,
            port,
            method: 'GET',
            pathname: '/api/v1/info',
        });
        const contentType = String(info.headers['content-type'] ?? '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
        let body;
        try {
            body = JSON.parse(info.bodyBytes.toString('utf8'));
        } finally {
            info.bodyBytes.fill(0);
        }
        if (
            info.statusCode !== 200 ||
            contentType !== 'application/json' ||
            body?.simulation !== true
        ) {
            throw new Error('task probe pinned API is not simulation');
        }
        return Object.freeze({
            schemaVersion: SMART_ORDER_TASK_PROBE_PINNED_TRANSPORT_SCHEMA_VERSION,
            async write(requestValue, receipt) {
                // Receipt consumption is deliberately synchronous and occurs
                // before upstream payload construction or any POST bytes.
                const binding = consumeTaskProbeWritePreflightReceipt(receipt);
                const canonical = canonicalManualStockBrokerWriteRequest(requestValue, {
                    expectedOperation: binding.operation,
                });
                if (canonical.requestSha256 !== binding.requestSha256) {
                    throw new Error('task probe receipt does not bind this request');
                }
                const bodyBytes = Buffer.from(
                    JSON.stringify(upstreamPayload(canonical)),
                    'utf8',
                );
                try {
                    return await request({
                        agent,
                        expectedSocket: info.socket,
                        host,
                        port,
                        method: 'POST',
                        pathname: canonical.request.brokerPath,
                        bodyBytes,
                    });
                } finally {
                    bodyBytes.fill(0);
                }
            },
            close() {
                agent.destroy();
            },
        });
    } catch (error) {
        agent.destroy();
        throw error;
    }
}
