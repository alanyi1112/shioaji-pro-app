#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import http from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
    canonicalSmartOrderGateProbeSafetyEnvelope,
    smartOrderGateProbeAccountScopeSha256,
    smartOrderGateProbeEnvelopeIsCurrent,
} from './smart-order-runtime/gate-probe-safety-envelope.mjs';
import {
    canonicalManualStockBrokerWriteRequest,
    SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
} from './smart-order-runtime/manual-broker-write-contract.mjs';
import { createSmartOrderModeWriteAdmission } from './smart-order-runtime/mode-write-admission.mjs';
import { resolveExpectedManagedApiRepositoryRoot } from './smart-order-runtime/installed-managed-api-binding.mjs';
import {
    createSmartOrderResourceCoordinator,
} from './smart-order-runtime/resource-coordinator.mjs';
import {
    smartOrderModeExecutionLeaseDirectoryForAppSupportRoot,
} from './smart-order-runtime/mode-execution-lease.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './smart-order-runtime/shioaji-broker-event-mapper.mjs';
import { verifySmartOrderGateProbeCliAuthorization } from './smart-order-runtime/gate-probe-cli-authorization.mjs';
import { runSmartOrderGateProbeCli } from './smart-order-runtime/gate-probe-cli.mjs';
import {
    readPrivateRuntimeDiscovery,
    readPrivateSecret,
} from './smart-order-runtime/private-storage.mjs';
import {
    createTask03ObservationCoordination,
    SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
    task03TradeIdentitySha256,
} from './smart-order-runtime/task0-3-observation-coordination.mjs';
import {
    SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION,
    consumeSimulationWritePreflightEvidenceReceipt,
    createSimulationWritePreflightEvidence,
    currentSimulationWritePreflightSourceFingerprint,
    readVerifiedSimulationWritePreflightEvidence,
    verifySimulationWritePreflightEvidence,
} from './smart-order-runtime/simulation-write-preflight-evidence.mjs';

export const SMART_ORDER_TASK_0_3_EVENT_TRIGGER_SCHEMA_VERSION =
    'smart-order-task-0.3-event-trigger/2026-08-24.1';

const MAX_DURABLE_LEDGER_BYTES = 64 * 1024;
const LEGACY_TASK_0_3_EVENT_TRIGGER_SCHEMA_VERSION =
    'smart-order-task-0.3-event-trigger/2026-08-22.1';

const CONFIRMATION =
    'I_CONFIRM_TASK_0_3_SIMULATION_PLACE_2330_BUY_LMT_115_1_COMMON_ROD_ONCE';
const APP_SUPPORT_ROOT = path.join(
    homedir(),
    'Library',
    'Application Support',
    'RealTimeStock',
);
const BASE_URL = 'http://127.0.0.1:8080';
const ACCOUNTS_PATH = '/api/v1/auth/accounts';
const TRADES_PATH = '/api/v1/order/trades';
const PLACE_PATH = '/api/v1/order/place_order';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_0_3_FAILURE_STAGES = new Set([
    'current_context',
    'operation_lineage',
    'observer_authorization',
    'runtime_discovery',
    'mode_admission',
    'resource_admission',
    'pinned_simulation_info',
    'adjacent_simulation_attestation',
    'observer_liveness_preflight',
    'preflight_evidence',
    'observer_liveness_final',
    'durable_ledger',
    'broker_dispatch_or_reconciliation',
    'result_persistence',
    'response_proof',
]);

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function taipeiTradeDate(nowEpochMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(nowEpochMs));
    const values = Object.fromEntries(
        parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
}

async function assertPrivateRoot() {
    const canonical = await realpath(APP_SUPPORT_ROOT);
    const metadata = await lstat(canonical);
    if (
        canonical !== APP_SUPPORT_ROOT ||
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error('Task 0.3 app support root is not private and canonical');
    }
    return canonical;
}

async function assertPrivateDirectory(directoryPath, label) {
    const canonical = await realpath(directoryPath);
    const metadata = await lstat(canonical);
    if (
        canonical !== directoryPath ||
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        (metadata.mode & 0o777) !== 0o700 ||
        (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
    ) {
        throw new Error(`${label} is not private and canonical`);
    }
    return canonical;
}

async function readPrivateMarker(filePath, pattern, label) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > 512 ||
            (before.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const value = (await handle.readFile('utf8')).trim();
        const after = await handle.stat();
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            !pattern.test(value)
        ) {
            throw new Error(`${label} changed or is invalid`);
        }
        return value;
    } finally {
        await handle.close();
    }
}

async function readBoundedJson(response, expectedUrl) {
    if (
        !response ||
        response.url !== expectedUrl ||
        response.redirected === true ||
        !response.ok
    ) {
        throw new Error('Shioaji response identity or status is invalid');
    }
    const contentType = String(response.headers?.get?.('content-type') ?? '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
    if (contentType !== 'application/json') {
        throw new Error('Shioaji response content type is invalid');
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
        throw new Error('Shioaji response is oversized');
    }
    return JSON.parse(text);
}

async function requestJson(pathname, { body, allowNonOk = false } = {}) {
    const requestUrl = `${BASE_URL}${pathname}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await globalThis.fetch(requestUrl, {
            method: body === undefined ? 'GET' : 'POST',
            headers:
                body === undefined
                    ? { accept: 'application/json' }
                    : {
                          accept: 'application/json',
                          'content-type': 'application/json',
                      },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
        });
        if (allowNonOk && response.url === requestUrl && !response.redirected) {
            return response;
        }
        return await readBoundedJson(response, requestUrl);
    } finally {
        clearTimeout(timer);
    }
}

function readPinnedResponse(response, maximumBytes = MAX_JSON_BYTES) {
    return new Promise((resolve, reject) => {
        let total = 0;
        const chunks = [];
        response.on('data', (chunk) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.byteLength;
            if (total > maximumBytes) {
                response.destroy(new Error('pinned response is oversized'));
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

function pinnedRequest({
    agent,
    expectedSocket,
    host,
    port,
    method,
    pathname,
    bodyBytes,
}) {
    return new Promise((resolve, reject) => {
        let assignedSocket;
        const request = http.request(
            {
                host,
                port,
                method,
                path: pathname,
                agent,
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
                    const projection = await readPinnedResponse(response);
                    resolve(Object.freeze({
                        ...projection,
                        socket: assignedSocket,
                    }));
                } catch (error) {
                    reject(error);
                }
            },
        );
        request.setTimeout(5_000, () =>
            request.destroy(new Error('pinned request timeout')),
        );
        request.once('error', reject);
        request.once('socket', (socket) => {
            assignedSocket = socket;
            const dispatchOnVerifiedSocket = () => {
                if (
                    socket.remoteAddress !== host ||
                    socket.remotePort !== port ||
                    (expectedSocket !== undefined && socket !== expectedSocket)
                ) {
                    request.destroy(
                        new Error('pinned managed API socket identity changed'),
                    );
                    return;
                }
                request.end(bodyBytes);
            };
            if (socket.connecting) {
                socket.once('connect', dispatchOnVerifiedSocket);
            } else {
                dispatchOnVerifiedSocket();
            }
        });
    });
}

export async function openPinnedSimulationConnection({
    host = '127.0.0.1',
    port = 8080,
} = {}) {
    if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new TypeError('pinned simulation endpoint is invalid');
    }
    const agent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 5_000,
        maxFreeSockets: 1,
        maxSockets: 1,
    });
    try {
        const info = await pinnedRequest({
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
            throw new Error('pinned managed API is not simulation');
        }
        return Object.freeze({
            async place(bodyValue, durableEvidenceReceipt) {
                // Consume synchronously before constructing or writing the
                // broker request. A missing, cloned or reused receipt cannot
                // reach pinnedRequest and therefore emits no broker byte.
                const preflightBinding =
                    consumeSimulationWritePreflightEvidenceReceipt(
                        durableEvidenceReceipt,
                    );
                const canonicalWrite =
                    canonicalManualStockBrokerWriteRequest(
                        Object.freeze({
                            schemaVersion:
                                SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
                            operation: 'place',
                            brokerPath: PLACE_PATH,
                            payload: bodyValue,
                        }),
                        { expectedOperation: 'place' },
                    );
                if (
                    preflightBinding?.operation !== 'place' ||
                    preflightBinding.requestSha256 !==
                        canonicalWrite.requestSha256
                ) {
                    throw new Error(
                        'durable preflight evidence does not bind this broker write',
                    );
                }
                const bodyBytes = Buffer.from(
                    JSON.stringify(canonicalWrite.request.payload),
                    'utf8',
                );
                try {
                    return await pinnedRequest({
                        agent,
                        expectedSocket: info.socket,
                        host,
                        port,
                        method: 'POST',
                        pathname: PLACE_PATH,
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

function accountTuple(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        value.account_type !== 'S' ||
        typeof value.broker_id !== 'string' ||
        value.broker_id.length < 1 ||
        typeof value.account_id !== 'string' ||
        value.account_id.length < 1
    ) {
        return null;
    }
    return Object.freeze({
        broker_id: value.broker_id,
        account_id: value.account_id,
        account_type: 'S',
    });
}

function selectFixedAccount(accounts) {
    if (!Array.isArray(accounts) || accounts.length > 64) {
        throw new Error('simulation account response is invalid');
    }
    const signed = accounts
        .filter((account) => account?.signed === true && account?.account_type === 'S')
        .map(accountTuple);
    if (signed.some((account) => account === null) || signed.length < 1) {
        throw new Error('fixed signed simulation stock account is unavailable');
    }
    const keyed = signed.map((account) => ({
        account,
        key: `${account.broker_id}\u001f${account.account_id}\u001fS`,
    }));
    if (new Set(keyed.map((item) => item.key)).size !== keyed.length) {
        throw new Error('fixed signed simulation stock account is ambiguous');
    }
    keyed.sort((left, right) => left.key.localeCompare(right.key));
    return keyed[0].account;
}

export function buildTask03AuthorizedEnvelope({
    account,
    nowEpochMs,
    runId,
    operationId,
    nonce,
}) {
    const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
    const request = Object.freeze({
        schemaVersion:
            SMART_ORDER_MANUAL_BROKER_WRITE_REQUEST_SCHEMA_VERSION,
        operation: 'place',
        brokerPath: PLACE_PATH,
        payload: Object.freeze({
            contract: Object.freeze({
                security_type: 'STK',
                region: 'TW',
                exchange: 'TSE',
                code: '2330',
                target_code: null,
            }),
            stock_order: Object.freeze({
                action: 'Buy',
                price: 115,
                quantity: 1,
                price_type: 'LMT',
                order_type: 'ROD',
                order_lot: 'Common',
                account,
            }),
        }),
    });
    return canonicalSmartOrderGateProbeSafetyEnvelope(
        Object.freeze({
            schemaVersion:
                SMART_ORDER_GATE_PROBE_SAFETY_ENVELOPE_SCHEMA_VERSION,
            runId,
            operationId,
            nonce,
            request,
            target: null,
            tradeDate: taipeiTradeDate(nowEpochMs),
            confirmation: Object.freeze({
                accountScopeSha256,
                confirmed: true,
                expectedOperation: 'place',
                maximumCommonLots: 1,
                simulation: true,
            }),
            validUntilEpochMs: nowEpochMs + 60_000,
        }),
    );
}

export async function writeExclusivePrivateJson(filePath, value) {
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
            throw new Error('Task 0.3 durable ledger write is invalid');
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

async function readOptionalPrivateJson(filePath, label) {
    let handle;
    try {
        handle = await open(
            filePath,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > MAX_DURABLE_LEDGER_BYTES ||
            (before.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error(`${label} metadata is invalid`);
        }
        const bytes = await handle.readFile();
        try {
            const after = await handle.stat();
            if (
                after.dev !== before.dev ||
                after.ino !== before.ino ||
                after.size !== before.size ||
                after.mtimeMs !== before.mtimeMs
            ) {
                throw new Error(`${label} changed while reading`);
            }
            return JSON.parse(bytes.toString('utf8'));
        } finally {
            bytes.fill(0);
        }
    } finally {
        await handle.close();
    }
}

async function assertPathAbsent(filePath, label) {
    try {
        await lstat(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }
        throw error;
    }
    throw new Error(`${label} already exists; Task 0.3 operation replay is forbidden`);
}

export function task03AuthorizedEventTriggerPaths({
    privateDirectory,
    coordinationId,
}) {
    if (typeof privateDirectory !== 'string' || !path.isAbsolute(privateDirectory)) {
        throw new TypeError('Task 0.3 private directory must be absolute');
    }
    if (!UUID.test(coordinationId ?? '')) {
        throw new TypeError('Task 0.3 coordination id is invalid');
    }
    return Object.freeze({
        legacyLedgerPath: path.join(
            privateDirectory,
            'task0-3-authorized-event-trigger.json',
        ),
        ledgerPath: path.join(
            privateDirectory,
            `task0-3-authorized-event-trigger-${coordinationId}.json`,
        ),
        resultPath: path.join(
            privateDirectory,
            `task0-3-authorized-event-trigger-result-${coordinationId}.json`,
        ),
        preflightEvidencePath: path.join(
            privateDirectory,
            `task0-3-simulation-write-preflight-${coordinationId}.json`,
        ),
    });
}

export async function assertTask03OperationLineageAvailable({
    privateDirectory,
    coordinationId,
}) {
    const paths = task03AuthorizedEventTriggerPaths({
        privateDirectory,
        coordinationId,
    });
    const legacyLedger = await readOptionalPrivateJson(
        paths.legacyLedgerPath,
        'Task 0.3 legacy durable ledger',
    );
    if (legacyLedger !== null) {
        if (
            !legacyLedger ||
            typeof legacyLedger !== 'object' ||
            Array.isArray(legacyLedger) ||
            legacyLedger.schemaVersion !==
                LEGACY_TASK_0_3_EVENT_TRIGGER_SCHEMA_VERSION ||
            !UUID.test(legacyLedger.coordinationId ?? '') ||
            legacyLedger.state !== 'dispatching_unknown_no_retry' ||
            legacyLedger.brokerWriteAttempted !== true ||
            legacyLedger.brokerWriteNetworked !== true ||
            legacyLedger.automaticRetryAllowed !== false ||
            legacyLedger.cleanupAllowed !== false ||
            legacyLedger.accountIdentifiersPersisted !== false
        ) {
            throw new Error('Task 0.3 legacy durable ledger is invalid');
        }
        if (legacyLedger.coordinationId === coordinationId) {
            throw new Error(
                'Task 0.3 legacy durable ledger forbids coordination replay',
            );
        }
    }
    await assertPathAbsent(paths.ledgerPath, 'Task 0.3 durable ledger');
    await assertPathAbsent(paths.resultPath, 'Task 0.3 durable result');
    await assertPathAbsent(
        paths.preflightEvidencePath,
        'Task 0.3 durable preflight evidence',
    );
    return paths;
}

function refreshedTradeIdentitySha256(trade) {
    return sha256(`${trade.account.brokerId}\u001f${trade.account.accountId}\u001f${trade.tradeId}`);
}

function matchesAuthorizedOrder(trade, account) {
    return (
        trade.account.brokerId === account.broker_id &&
        trade.account.accountId === account.account_id &&
        trade.account.accountType === 'S' &&
        trade.contractKey === 'TSE:2330:STK:Common' &&
        trade.action === 'Buy' &&
        trade.price === '115' &&
        trade.priceType === 'LMT' &&
        trade.timeInForce === 'ROD' &&
        trade.orderQuantity === 1 &&
        trade.unit === 'CommonLot'
    );
}

export function classifyTask03PlaceResponse(response, account) {
    if (response?.statusCode !== 200 || !Buffer.isBuffer(response?.bodyBytes)) {
        response?.bodyBytes?.fill?.(0);
        throw new Error('place response status leaves outcome unknown');
    }
    let body;
    try {
        body = JSON.parse(response.bodyBytes.toString('utf8'));
    } finally {
        response.bodyBytes.fill(0);
    }
    const [trade] = canonicalizeShioajiRefreshedStockTrades([body]);
    if (!matchesAuthorizedOrder(trade, account)) {
        throw new Error('place response did not match authorized scope');
    }
    const state = trade.status === 'Failed'
        ? 'broker_rejected_terminal'
        : [
              'PendingSubmit',
              'PreSubmitted',
              'Submitted',
              'PartFilled',
              'Filled',
          ].includes(trade.status)
          ? 'confirmed'
          : 'broker_terminal_without_working_order';
    return Object.freeze({
        state,
        trade,
        resultEvidenceSha256: refreshedTradeIdentitySha256(trade),
        tradeIdentitySha256: task03TradeIdentitySha256(
            trade.account,
            trade.tradeId,
        ),
    });
}

async function currentTask03Context() {
    const appSupportRoot = await assertPrivateRoot();
    const mode = await readPrivateMarker(
        path.join(appSupportRoot, 'runtime-mode'),
        /^simulation$/,
        'runtime mode marker',
    );
    const apiGeneration = await readPrivateMarker(
        path.join(appSupportRoot, 'runtime-api-generation'),
        /^simulation:[A-Za-z0-9._:-]{1,240}$/,
        'runtime API generation marker',
    );
    if (mode !== 'simulation') throw new Error('Task 0.3 requires simulation');
    const account = selectFixedAccount(await requestJson(ACCOUNTS_PATH));
    const privateDirectory = path.join(appSupportRoot, 'smart-order', 'private');
    await assertPrivateDirectory(
        privateDirectory,
        'Task 0.3 private ledger directory',
    );
    return Object.freeze({
        account,
        accountScopeSha256: smartOrderGateProbeAccountScopeSha256(account),
        apiGeneration,
        appSupportRoot,
        privateDirectory,
    });
}

function assertExactAuthorizedRequest(canonical, account) {
    const order = canonical.request.payload.stock_order;
    const contract = canonical.request.payload.contract;
    if (
        canonical.envelope.operation !== 'place' ||
        canonical.envelope.target !== null ||
        canonical.request.brokerPath !== PLACE_PATH ||
        contract.security_type !== 'STK' ||
        contract.region !== 'TW' ||
        contract.exchange !== 'TSE' ||
        contract.code !== '2330' ||
        contract.target_code !== null ||
        order.action !== 'Buy' ||
        order.price !== 115 ||
        order.quantity !== 1 ||
        order.price_type !== 'LMT' ||
        order.order_type !== 'ROD' ||
        order.order_lot !== 'Common' ||
        order.account.broker_id !== account.broker_id ||
        order.account.account_id !== account.account_id ||
        order.account.account_type !== 'S'
    ) {
        throw new Error('Task 0.3 authorized envelope scope is invalid');
    }
}

async function runTask03AuthorizedOperation({
    coordinationId,
    expectedAccountScopeSha256,
    expectedRequestSha256,
}, setFailureStage) {
    setFailureStage('current_context');
    const context = await currentTask03Context();
    setFailureStage('operation_lineage');
    const {
        account,
        accountScopeSha256,
        apiGeneration,
        appSupportRoot,
        privateDirectory,
    } = context;
    const {
        ledgerPath,
        resultPath,
        preflightEvidencePath,
    } = await assertTask03OperationLineageAvailable({
        privateDirectory,
        coordinationId,
    });
    if (accountScopeSha256 !== expectedAccountScopeSha256) {
        throw new Error('Task 0.3 fixed account pin changed');
    }
    const task03Coordination = createTask03ObservationCoordination({
        accountScopeSha256,
        appSupportRoot,
        coordinationId,
        requestSha256: expectedRequestSha256,
    });
    let canonical;
    let observerReadiness;
    let interactiveAuthorization;
    try {
        setFailureStage('observer_authorization');
        observerReadiness = await task03Coordination.waitForReady({
            timeoutMs: SMART_ORDER_TASK_0_3_MAX_READINESS_WAIT_MS,
        });
        canonical = buildTask03AuthorizedEnvelope({
            account,
            nowEpochMs: Date.now(),
            runId: coordinationId,
            operationId: randomUUID(),
            nonce: randomUUID(),
        });
        assertExactAuthorizedRequest(canonical, account);
        if (
            canonical.envelope.accountScopeSha256 !== accountScopeSha256 ||
            canonical.envelope.requestSha256 !== expectedRequestSha256 ||
            !smartOrderGateProbeEnvelopeIsCurrent(canonical.envelope, Date.now())
        ) {
            throw new Error('Task 0.3 authorization is stale or account-unbound');
        }
        interactiveAuthorization = await runSmartOrderGateProbeCli({
            envelope: canonical.sourceEnvelope,
            appSupportRoot,
            expectedApiGeneration: apiGeneration,
            returnAuthorizationOnly: true,
        });
    } catch (error) {
        await task03Coordination.closeReadiness().catch(() => {});
        throw error;
    }
    setFailureStage('runtime_discovery');
    const discovery = await readPrivateRuntimeDiscovery(
        path.join(appSupportRoot, 'smart-order', 'run', 'control-plane.json'),
        { nowEpochMs: Date.now() },
    );
    const capability = await readPrivateSecret(
        path.join(
            privateDirectory,
            'gate-probe-cli-capability.bin',
        ),
    );
    let cliEvidence;
    let cliCapabilitySha256;
    try {
        cliEvidence = verifySmartOrderGateProbeCliAuthorization({
            capability,
            envelope: canonical.sourceEnvelope,
            authorization: interactiveAuthorization.authorization,
            nowEpochMs: Date.now(),
            expectedApiGenerationSha256: sha256(apiGeneration),
            expectedRuntimeEpochIdSha256: sha256(discovery.runtimeEpochId),
        });
        cliCapabilitySha256 = sha256(capability);
    } finally {
        capability.fill(0);
    }
    const coordinator = createSmartOrderResourceCoordinator();
    const admission = createSmartOrderModeWriteAdmission({
        appSupportRoot,
        expectedApiGeneration: apiGeneration,
        expectedRepositoryRoot: resolveExpectedManagedApiRepositoryRoot(),
        leaseDirectory:
            smartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                appSupportRoot,
            ),
        resourceCoordinator: coordinator,
    });
    let modeLease;
    let operationGranted = false;
    let operationDispatching = false;
    let pinnedConnection;
    try {
        setFailureStage('mode_admission');
        modeLease = await admission.acquire();
        setFailureStage('resource_admission');
        const operation = await coordinator.acquireOperation({
            operationId: canonical.envelope.operationId,
            kind: 'new_exposure',
        });
        operationGranted = operation.allowed === true;
        await coordinator.acquireOperationUnit({
            operationId: canonical.envelope.operationId,
        });
        const dispatch = coordinator.markOperationDispatching({
            operationId: canonical.envelope.operationId,
        });
        if (dispatch.allowed !== true) {
            throw new Error('Task 0.3 resource dispatch phase was denied');
        }
        operationDispatching = true;
        setFailureStage('pinned_simulation_info');
        pinnedConnection = await openPinnedSimulationConnection();
        setFailureStage('adjacent_simulation_attestation');
        const adjacent = await modeLease.revalidate({
            operationId: canonical.envelope.operationId,
        });
        if (
            adjacent.current !== true ||
            adjacent.simulation !== true ||
            adjacent.caLoaded !== false ||
            adjacent.productionLoaded !== false ||
            adjacent.apiGeneration !== apiGeneration ||
            !smartOrderGateProbeEnvelopeIsCurrent(
                canonical.envelope,
                Date.now(),
            )
        ) {
            throw new Error('Task 0.3 adjacent simulation attestation failed');
        }
        setFailureStage('observer_liveness_preflight');
        const currentReadiness = await task03Coordination.revalidateReady({
            minimumRemainingMs: 10_000,
        });
        setFailureStage('preflight_evidence');
        const sourceFingerprintSha256 =
            await currentSimulationWritePreflightSourceFingerprint();
        const readinessEvidenceSha256 = sha256(
            JSON.stringify({
                schemaVersion: task03Coordination.schemaVersion,
                coordinationId,
                accountScopeSha256,
                requestSha256: canonical.envelope.requestSha256,
                readyAtEpochMs: observerReadiness.readyAtEpochMs,
                observerDeadlineEpochMs:
                    currentReadiness.observerDeadlineEpochMs,
                minimumRemainingMs: currentReadiness.minimumRemainingMs,
                current: currentReadiness.current,
            }),
        );
        const evidenceCapability = await readPrivateSecret(
            path.join(
                privateDirectory,
                'gate-probe-cli-capability.bin',
            ),
        );
        let preflightEvidence;
        let verifiedPreflightEvidence;
        try {
            if (sha256(evidenceCapability) !== cliCapabilitySha256) {
                throw new Error(
                    'Task 13.1 CLI capability changed before broker write',
                );
            }
            const adjacentDiscovery = await readPrivateRuntimeDiscovery(
                path.join(
                    appSupportRoot,
                    'smart-order',
                    'run',
                    'control-plane.json',
                ),
                { nowEpochMs: Date.now() },
            );
            if (
                adjacentDiscovery.runtimeEpochId !== discovery.runtimeEpochId
            ) {
                throw new Error(
                    'Task 13.1 Runtime discovery changed before broker write',
                );
            }
            const adjacentCliEvidence =
                verifySmartOrderGateProbeCliAuthorization({
                    capability: evidenceCapability,
                    envelope: canonical.sourceEnvelope,
                    authorization: interactiveAuthorization.authorization,
                    nowEpochMs: Date.now(),
                    expectedApiGenerationSha256: sha256(apiGeneration),
                    expectedRuntimeEpochIdSha256: sha256(
                        adjacentDiscovery.runtimeEpochId,
                    ),
                });
            if (
                adjacentCliEvidence.cliAuthorizationSha256 !==
                    cliEvidence.cliAuthorizationSha256
            ) {
                throw new Error(
                    'Task 13.1 CLI authorization changed before broker write',
                );
            }
            const evidenceInput = Object.freeze({
                schemaVersion:
                    SMART_ORDER_SIMULATION_WRITE_PREFLIGHT_EVIDENCE_SCHEMA_VERSION,
                sourceFingerprintSha256,
                createdAtEpochMs: Date.now(),
                coordinationId,
                operationIdSha256: sha256(canonical.envelope.operationId),
                operation: 'place',
                requestSha256: canonical.envelope.requestSha256,
                envelopeSha256: canonical.envelopeSha256,
                cliAuthorizationSha256:
                    adjacentCliEvidence.cliAuthorizationSha256,
                accountScopeSha256,
                maskedAccountRef: `…${accountScopeSha256.slice(-12)}`,
                accountType: 'S',
                modeMarker: 'simulation',
                apiSimulation: adjacent.simulation,
                apiGenerationSha256: sha256(apiGeneration),
                sharedModeLeaseHeld: true,
                modeExecutionLeaseEvidenceHash:
                    modeLease.modeExecutionLeaseEvidenceHash,
                initialSimulationAttestationSha256:
                    modeLease.initialSimulationAttestationSha256,
                adjacentSimulationAttestationSha256:
                    adjacent.simulationAttestationSha256,
                readinessCurrent: currentReadiness.current,
                readinessEvidenceSha256,
                readinessDeadlineEpochMs:
                    currentReadiness.observerDeadlineEpochMs,
                quantityUnit: 'CommonLot',
                requestedQuantity: canonical.envelope.quantityCommonLots,
                maximumQuantity:
                    canonical.sourceEnvelope.confirmation.maximumCommonLots,
                caLoaded: adjacent.caLoaded,
                productionLoaded: adjacent.productionLoaded,
                automaticRetryAllowed: false,
                cleanupAllowed: false,
                accountIdentifiersPersisted: false,
                brokerWriteAttempted: false,
                brokerWriteNetworked: false,
            });
            preflightEvidence = createSimulationWritePreflightEvidence({
                capability: evidenceCapability,
                input: evidenceInput,
            });
            const verification = verifySimulationWritePreflightEvidence({
                capability: evidenceCapability,
                evidence: preflightEvidence,
                expected: {
                    accountScopeSha256,
                    apiGenerationSha256: sha256(apiGeneration),
                    cliAuthorizationSha256:
                        adjacentCliEvidence.cliAuthorizationSha256,
                    coordinationId,
                    envelopeSha256: canonical.envelopeSha256,
                    operationIdSha256: sha256(
                        canonical.envelope.operationId,
                    ),
                    readinessEvidenceSha256,
                    requestSha256: canonical.envelope.requestSha256,
                    sourceFingerprintSha256,
                },
                nowEpochMs: Date.now(),
            });
            if (verification.eligible !== true) {
                throw new Error(
                    'Task 13.1 simulation preflight evidence failed verification',
                );
            }
            await writeExclusivePrivateJson(
                preflightEvidencePath,
                preflightEvidence,
            );
            verifiedPreflightEvidence =
                await readVerifiedSimulationWritePreflightEvidence({
                    capability: evidenceCapability,
                    evidencePath: preflightEvidencePath,
                    expected: {
                        accountScopeSha256,
                        apiGenerationSha256: sha256(apiGeneration),
                        cliAuthorizationSha256:
                            adjacentCliEvidence.cliAuthorizationSha256,
                        coordinationId,
                        envelopeSha256: canonical.envelopeSha256,
                        operationIdSha256: sha256(
                            canonical.envelope.operationId,
                        ),
                        readinessEvidenceSha256,
                        requestSha256: canonical.envelope.requestSha256,
                        sourceFingerprintSha256,
                    },
                    nowEpochMs: Date.now(),
                });
        } finally {
            evidenceCapability.fill(0);
        }
        if (
            (await currentSimulationWritePreflightSourceFingerprint()) !==
            sourceFingerprintSha256
        ) {
            throw new Error(
                'Task 13.1 simulation preflight source changed before broker write',
            );
        }
        setFailureStage('observer_liveness_final');
        const finalReadiness = await task03Coordination.revalidateReady({
            minimumRemainingMs: 5_000,
        });
        if (
            finalReadiness.current !== true ||
            finalReadiness.observerDeadlineEpochMs !==
                currentReadiness.observerDeadlineEpochMs
        ) {
            throw new Error(
                'Task 13.1 observer readiness changed before broker write',
            );
        }
        const durableEvidenceReceipt =
            verifiedPreflightEvidence?.durableEvidenceReceipt;
        setFailureStage('durable_ledger');
        await writeExclusivePrivateJson(ledgerPath, {
            schemaVersion: SMART_ORDER_TASK_0_3_EVENT_TRIGGER_SCHEMA_VERSION,
            state: 'dispatching_unknown_no_retry',
            coordinationId,
            envelopeSha256: canonical.envelopeSha256,
            requestSha256: canonical.envelope.requestSha256,
            cliAuthorizationSha256: cliEvidence.cliAuthorizationSha256,
            accountScopeSha256,
            apiGenerationSha256: sha256(apiGeneration),
            modeExecutionLeaseEvidenceHash:
                modeLease.modeExecutionLeaseEvidenceHash,
            initialSimulationAttestationSha256:
                modeLease.initialSimulationAttestationSha256,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            accountIdentifiersPersisted: false,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
        });
        if (
            finalReadiness.observerDeadlineEpochMs <= Date.now() ||
            !smartOrderGateProbeEnvelopeIsCurrent(
                canonical.envelope,
                Date.now(),
            )
        ) {
            throw new Error(
                'Task 0.3 dispatch evidence expired after durable ledger fsync',
            );
        }

        setFailureStage('broker_dispatch_or_reconciliation');
        let state = 'unknown_manual_reconciliation_required';
        let resultEvidenceSha256 = sha256('response-unavailable');
        let boundedReconciliationObservedMatches = null;
        let tradeIdentitySha256 = null;
        try {
            const response = await pinnedConnection.place(
                canonical.request.payload,
                durableEvidenceReceipt,
            );
            const classified = classifyTask03PlaceResponse(response, account);
            state = classified.state;
            resultEvidenceSha256 = classified.resultEvidenceSha256;
            tradeIdentitySha256 = classified.tradeIdentitySha256;
        } catch {
            const refreshed = canonicalizeShioajiRefreshedStockTrades(
                await requestJson(TRADES_PATH, { body: account }),
            );
            boundedReconciliationObservedMatches = refreshed.filter((trade) =>
                matchesAuthorizedOrder(trade, account),
            ).length;
        }
        setFailureStage('result_persistence');
        await writeExclusivePrivateJson(resultPath, {
            schemaVersion: SMART_ORDER_TASK_0_3_EVENT_TRIGGER_SCHEMA_VERSION,
            state,
            coordinationId,
            envelopeSha256: canonical.envelopeSha256,
            resultEvidenceSha256,
            boundedReconciliationObservedMatches,
            boundedReconciliationCanConfirmOutcome: false,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            accountIdentifiersPersisted: false,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            adjacentSimulationAttestationSha256:
                adjacent.simulationAttestationSha256,
        });
        const completed = coordinator.completeOperation({
            operationId: canonical.envelope.operationId,
        });
        if (completed.allowed !== true) {
            throw new Error('Task 0.3 resource completion failed closed');
        }
        operationGranted = false;
        operationDispatching = false;
        setFailureStage('response_proof');
        if (tradeIdentitySha256) {
            await task03Coordination.writeProof({
                resultEvidenceSha256,
                state,
                tradeIdentitySha256,
            });
        }
        return Object.freeze({
            schemaVersion: SMART_ORDER_TASK_0_3_EVENT_TRIGGER_SCHEMA_VERSION,
            state,
            order: 'Buy TSE:2330 LMT@115 ROD 1 CommonLot',
            accountRef: `…${accountScopeSha256.slice(-12)}`,
            automaticRetryAllowed: false,
            cleanupAllowed: false,
            accountIdentifiersExposed: false,
            brokerWriteAttempted: true,
            brokerWriteNetworked: true,
            preflightEvidenceResultHash: preflightEvidence.resultHash,
        });
    } finally {
        if (operationGranted) {
            if (operationDispatching) {
                coordinator.handleOperationFailure({
                    operationId: canonical.envelope.operationId,
                    failure: 'connection_error',
                });
            } else {
                coordinator.abandonOperation({
                    operationId: canonical.envelope.operationId,
                });
            }
        }
        pinnedConnection?.close();
        await modeLease?.close().catch(() => {});
        await task03Coordination.closeReadiness().catch(() => {});
        coordinator.close();
    }
}

async function run(input) {
    let failureStage = 'current_context';
    try {
        return await runTask03AuthorizedOperation(input, (nextStage) => {
            if (!TASK_0_3_FAILURE_STAGES.has(nextStage)) {
                throw new TypeError('Task 0.3 failure stage is invalid');
            }
            failureStage = nextStage;
        });
    } catch {
        const unavailable = new Error('Task 0.3 operation is unavailable');
        Object.defineProperty(unavailable, 'task03FailureStage', {
            configurable: false,
            enumerable: false,
            value: failureStage,
            writable: false,
        });
        throw unavailable;
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--read-account-scope') {
        const context = await currentTask03Context();
        const canonical = buildTask03AuthorizedEnvelope({
            account: context.account,
            nowEpochMs: Date.now(),
            runId: randomUUID(),
            operationId: randomUUID(),
            nonce: randomUUID(),
        });
        process.stdout.write(`${JSON.stringify({
            accountScopeSha256: context.accountScopeSha256,
            requestSha256: canonical.envelope.requestSha256,
            accountRef: `…${context.accountScopeSha256.slice(-12)}`,
            brokerWriteAttempted: false,
        })}\n`);
        return;
    }
    const accountScopeArgument = args.find((argument) =>
        argument.startsWith('--account-scope='),
    );
    const expectedAccountScopeSha256 = accountScopeArgument?.slice(
        '--account-scope='.length,
    );
    const requestSha256Argument = args.find((argument) =>
        argument.startsWith('--request-sha256='),
    );
    const expectedRequestSha256 = requestSha256Argument?.slice(
        '--request-sha256='.length,
    );
    const coordinationArgument = args.find((argument) =>
        argument.startsWith('--coordination-id='),
    );
    const coordinationId = coordinationArgument?.slice(
        '--coordination-id='.length,
    );
    if (!/^sha256:[0-9a-f]{64}$/.test(expectedAccountScopeSha256 ?? '')) {
        throw new TypeError('Task 0.3 account scope pin is required');
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(expectedRequestSha256 ?? '')) {
        throw new TypeError('Task 0.3 request hash pin is required');
    }
    if (!UUID.test(coordinationId ?? '')) {
        throw new TypeError('Task 0.3 coordination id is required');
    }
    if (
        args.length !== 4 ||
        !args.includes(`--confirm=${CONFIRMATION}`)
    ) {
        throw new TypeError(
            `usage: node scripts/smart-order-task0-3-event-trigger.mjs --read-account-scope | --confirm=${CONFIRMATION} --account-scope=<sha256> --request-sha256=<sha256> --coordination-id=<uuid>`,
        );
    }
    const result = await run({
        coordinationId,
        expectedAccountScopeSha256,
        expectedRequestSha256,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.state !== 'confirmed') {
        process.exitCode = 2;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        const failureStage = TASK_0_3_FAILURE_STAGES.has(
            error?.task03FailureStage,
        )
            ? error.task03FailureStage
            : 'unclassified';
        process.stderr.write(
            `smart_order_task0_3_event_trigger=unavailable:${failureStage}\n`,
        );
        process.exitCode = 1;
    });
}
