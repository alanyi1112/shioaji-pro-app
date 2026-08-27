import { constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import {
    assertSmartOrderCanonicalContractUpdateDateCurrent,
    parseSmartOrderCanonicalStockContractMetadata,
    smartOrderCommonLotsToShares,
} from './smart-order-runtime/canonical-stock-unit-contract.mjs';
import {
    prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot,
} from './smart-order-runtime/mode-execution-lease.mjs';
import {
    createSmartOrderResourceCoordinator,
    isIssuedSmartOrderResourceCoordinator,
} from './smart-order-runtime/resource-coordinator.mjs';
import { takeSmartOrderContractProbeRuntimeAuthority } from './smart-order-runtime/smart-order-contract-probe-runtime-authority.mjs';

export const SMART_ORDER_TASK0_7_UNIT_CAPABILITY_SCHEMA =
    'realtimestock.smart-order-task0-7-unit-capability/v1';
export const SMART_ORDER_TASK0_7_UNIT_CAPABILITY_VERSION = '2026-08-22.1';
export const SMART_ORDER_TASK0_7_MAX_EVIDENCE_AGE_MS = 10 * 60 * 1000;

const CONFIRMATION = 'I_CONFIRM_SIMULATION_READONLY_UNIT_CAPABILITY_PROBE';
const BASE_URL = 'http://127.0.0.1:8080';
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;
const MAX_ACCOUNT_ROWS = 32;
const BENCHMARKS = Object.freeze([
    Object.freeze({ code: '2330', kind: 'stock' }),
    Object.freeze({ code: '0050', kind: 'etf' }),
]);
const REQUIRED_CHECK_IDS = Object.freeze([
    'native-managed-simulation-before',
    'fixed-stock-account-redacted',
    'positions-openapi-share-contract-current',
    'positions-request-unit-share',
    'positions-snapshot-stable',
    'common-order-quantity-commonlot',
    'stock-canonical-contract-complete',
    'etf-canonical-contract-complete',
    'share-commonlot-conversion-exact',
    'canonical-contract-snapshot-stable',
    'source-fingerprint-current',
    'native-managed-simulation-after',
    'broker-write-zero',
]);
const SOURCE_FILES = Object.freeze([
    'scripts/smart-order-task0-7-unit-probe',
    'scripts/smart-order-task0-7-unit-capability.mjs',
    'scripts/smart-order-runtime/canonical-stock-unit-contract.mjs',
    'scripts/smart-order-runtime/shioaji-trade-observer.mjs',
    'scripts/smart-order-runtime/node-safe-broker-adapter.mjs',
    'scripts/smart-order-runtime/node-safe-broker-target.mjs',
]);
const ALLOWED_REQUESTS = new Set([
    'GET /openapi.json',
    'GET /api/v1/info',
    'GET /api/v1/auth/accounts',
    'POST /api/v1/order/trades',
    'POST /api/v1/portfolio/position_unit',
    'GET /api/v1/data/contracts/2330/info?security_type=STK&region=TW',
    'GET /api/v1/data/contracts/0050/info?security_type=STK&region=TW',
]);
const TOP_LEVEL_KEYS = Object.freeze([
    'accountIdentifiersPersisted',
    'checks',
    'evidenceClass',
    'executionMode',
    'fingerprint',
    'generatedAt',
    'managedRuntime',
    'network',
    'overall',
    'resultHash',
    'runId',
    'schema',
    'sideEffects',
    'sourceProjection',
    'version',
]);
const FINGERPRINT_KEYS = Object.freeze(['sourceMatrixSha256', 'sources']);
const SOURCE_ROW_KEYS = Object.freeze(['path', 'sha256']);
const MANAGED_RUNTIME_KEYS = Object.freeze([
    'generationStable',
    'processStable',
    'sharedModeLeaseHeld',
    'simulationAttested',
]);
const NETWORK_KEYS = Object.freeze([
    'accountingReads',
    'brokerWritesAttempted',
    'brokerWritesNetworked',
    'requestCount',
]);
const SIDE_EFFECT_KEYS = Object.freeze([
    'brokerWritesAttempted',
    'brokerWritesNetworked',
    'serviceMutations',
]);
const SOURCE_PROJECTION_KEYS = Object.freeze([
    'commonOrderCommonLots',
    'commonOrderContractUnit',
    'commonOrderQuantityShares',
    'commonOrderStatus',
    'commonOrderStatusQuantityCommonLots',
    'commonOrderUnit',
    'etf',
    'positionApiContractSha256',
    'positionsCount',
    'positionsUnit',
    'signedStockAccountCount',
    'stock',
]);
const CONTRACT_PROJECTION_KEYS = Object.freeze([
    'categoryCode',
    'code',
    'contractUnit',
    'exchange',
    'kind',
    'limitDownMinorUnits',
    'limitUpMinorUnits',
    'referenceMinorUnits',
    'securityType',
    'updateDate',
]);

function repositoryRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, keys) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).sort().join('\u001f') ===
            [...keys].sort().join('\u001f')
    );
}

function ownData(value, requiredKeys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = {};
    for (const key of requiredKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new Error(`${label}.${key} is not an own data property`);
        }
        result[key] = descriptor.value;
    }
    return Object.freeze(result);
}

function accountTuple(value) {
    try {
        const row = ownData(
            value,
            ['account_id', 'account_type', 'broker_id'],
            'stock account',
        );
        if (
            ![row.account_id, row.account_type, row.broker_id].every(
                (entry) =>
                    typeof entry === 'string' &&
                    entry.length > 0 &&
                    entry.length <= 128,
            )
        ) {
            return null;
        }
        return Object.freeze({
            account_id: row.account_id,
            account_type: row.account_type,
            broker_id: row.broker_id,
        });
    } catch {
        return null;
    }
}

function sameAccount(left, right) {
    return (
        left?.account_id === right?.account_id &&
        left?.account_type === right?.account_type &&
        left?.broker_id === right?.broker_id
    );
}

function selectFixedStockAccount(accounts) {
    if (!Array.isArray(accounts) || accounts.length < 1 || accounts.length > MAX_ACCOUNT_ROWS) {
        throw new Error('fixed stock account selection failed');
    }
    const stockAccounts = accounts
        .map((entry, index) => {
            const row = ownData(
                entry,
                ['account_id', 'account_type', 'broker_id', 'signed'],
                `account[${index}]`,
            );
            return row.signed === true && row.account_type === 'S'
                ? accountTuple(row)
                : null;
        })
        .filter(Boolean)
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    if (stockAccounts.length < 1) {
        throw new Error('fixed stock account selection failed');
    }
    const unique = new Map(stockAccounts.map((entry) => [canonicalJson(entry), entry]));
    return Object.freeze({
        account: [...unique.values()][0],
        signedStockAccountCount: unique.size,
    });
}

function validateInfo(value) {
    const info = ownData(value, ['protocols', 'simulation', 'version'], 'API info');
    const protocols = Array.isArray(info.protocols)
        ? info.protocols.map((entry) =>
              typeof entry === 'string' ? entry.toUpperCase() : '',
          )
        : [];
    if (
        info.simulation !== true ||
        typeof info.version !== 'string' ||
        !/^v?1\.7\.1$/.test(info.version) ||
        protocols.length < 1 ||
        protocols.length > 32 ||
        protocols.some((entry) => !/^[A-Z][A-Z0-9._-]{0,31}$/.test(entry)) ||
        !protocols.includes('HTTP')
    ) {
        throw new Error('managed API is not the expected simulation API');
    }
    return sha256(canonicalJson({
        protocols: [...protocols].sort(),
        simulation: true,
        version: info.version,
    }));
}

function validatePositions(value) {
    if (!Array.isArray(value) || value.length > 4096) {
        throw new Error('Share positions response is invalid');
    }
    return Object.freeze(
        value.map((entry, index) => {
            const row = ownData(
                entry,
                [
                    'code',
                    'direction',
                    'id',
                    'last_price',
                    'pnl',
                    'price',
                    'quantity',
                    'yd_quantity',
                ],
                `position[${index}]`,
            );
            if (
                !Number.isSafeInteger(row.id) ||
                !['Buy', 'Sell'].includes(row.direction) ||
                typeof row.code !== 'string' ||
                row.code.length < 1 ||
                row.code.length > 32 ||
                !Number.isSafeInteger(row.quantity) ||
                row.quantity < 0 ||
                !Number.isSafeInteger(row.yd_quantity) ||
                row.yd_quantity < 0 ||
                ![row.last_price, row.pnl, row.price].every(Number.isFinite)
            ) {
                throw new Error('Share positions response is invalid');
            }
            return Object.freeze({
                code: row.code,
                direction: row.direction,
                id: row.id,
                quantityShares: row.quantity,
                yesterdayQuantityShares: row.yd_quantity,
            });
        }),
    );
}

function validatePositionOpenApi(value) {
    const root = ownData(value, ['components', 'paths'], 'OpenAPI root');
    const paths = ownData(
        root.paths,
        ['/api/v1/portfolio/position_unit'],
        'OpenAPI paths',
    );
    const operation = ownData(
        ownData(
            paths['/api/v1/portfolio/position_unit'],
            ['post'],
            'position path',
        ).post,
        ['operationId', 'requestBody', 'responses'],
        'position operation',
    );
    const requestSchema =
        operation.requestBody?.content?.['application/json']?.schema;
    const responseSchema =
        operation.responses?.['200']?.content?.['application/json']?.schema;
    const schemas = root.components?.schemas;
    const positionRequest =
        schemas?.['shioaji.server.http.portf.PositionRequest'];
    const unit = schemas?.['shioaji.api.api_v1.portf.positions.Unit'];
    const position = schemas?.['shioaji.api.api_v1.portf.positions.Position'];
    const stockPosition =
        schemas?.['shioaji.api.api_v1.portf.positions.StockPosition'];
    const requestParts = positionRequest?.allOf;
    const unitPart = Array.isArray(requestParts)
        ? requestParts.find((entry) => entry?.properties?.unit?.$ref)
        : null;
    if (
        operation.operationId !== 'get_positions' ||
        requestSchema?.$ref !==
            '#/components/schemas/shioaji.server.http.portf.PositionRequest' ||
        responseSchema?.type !== 'array' ||
        responseSchema?.items?.$ref !==
            '#/components/schemas/shioaji.api.api_v1.portf.positions.Position' ||
        !Array.isArray(requestParts) ||
        !requestParts.some(
            (entry) =>
                entry?.$ref ===
                '#/components/schemas/shioaji.server.http.types.AccountRequest',
        ) ||
        unitPart?.properties?.unit?.$ref !==
            '#/components/schemas/shioaji.api.api_v1.portf.positions.Unit' ||
        unit?.type !== 'string' ||
        !Array.isArray(unit.enum) ||
        [...unit.enum].sort().join('\u001f') !== 'Common\u001fShare' ||
        !Array.isArray(position?.oneOf) ||
        !position.oneOf.some(
            (entry) =>
                entry?.$ref ===
                '#/components/schemas/shioaji.api.api_v1.portf.positions.StockPosition',
        ) ||
        !Array.isArray(stockPosition?.required) ||
        !['quantity', 'yd_quantity'].every((key) =>
            stockPosition.required.includes(key),
        ) ||
        !['quantity', 'yd_quantity'].every(
            (key) =>
                stockPosition?.properties?.[key]?.type === 'integer' &&
                stockPosition.properties[key].format === 'int32',
        )
    ) {
        throw new Error('position Share OpenAPI contract is invalid');
    }
    return sha256(canonicalJson({
        operationId: operation.operationId,
        positionResponseRef: responseSchema.items.$ref,
        positionUnitEnum: [...unit.enum].sort(),
        quantityFormat: stockPosition.properties.quantity.format,
        quantityType: stockPosition.properties.quantity.type,
        requestRef: requestSchema.$ref,
        ydQuantityFormat: stockPosition.properties.yd_quantity.format,
        ydQuantityType: stockPosition.properties.yd_quantity.type,
    }));
}

function validateCommonOrderQuantity(trades, account, metadataByCode) {
    if (!Array.isArray(trades) || trades.length > 4096) {
        throw new Error('Common order response is invalid');
    }
    for (const [index, trade] of trades.entries()) {
        const row = ownData(trade, ['contract', 'order', 'status'], `trade[${index}]`);
        const contract = ownData(
            row.contract,
            ['code', 'exchange', 'security_type'],
            `trade[${index}].contract`,
        );
        const order = ownData(
            row.order,
            ['account', 'order_lot', 'quantity'],
            `trade[${index}].order`,
        );
        const status = ownData(
            row.status,
            ['order_quantity', 'status'],
            `trade[${index}].status`,
        );
        if (!sameAccount(accountTuple(order.account), account)) {
            throw new Error('Common order account scope is invalid');
        }
        if (order.order_lot !== 'Common') continue;
        if (
            contract.security_type !== 'STK' ||
            !['TSE', 'OTC'].includes(contract.exchange) ||
            ![
                'PendingSubmit',
                'PreSubmitted',
                'Submitted',
                'PartFilled',
                'Filled',
                'Cancelled',
                'Inactive',
                'Failed',
            ].includes(status.status) ||
            !Number.isSafeInteger(order.quantity) ||
            order.quantity < 1 ||
            !Number.isSafeInteger(status.order_quantity) ||
            status.order_quantity < 0
        ) {
            throw new Error('Common order quantity is invalid');
        }
        const metadata = metadataByCode.get(contract.code);
        if (!metadata || metadata.exchange !== contract.exchange) continue;
        const quantityShares = smartOrderCommonLotsToShares(
            order.quantity,
            metadata.contractUnit,
        );
        if (!Number.isSafeInteger(quantityShares) || quantityShares < 1) {
            throw new Error('CommonLot to Share projection is invalid');
        }
        return Object.freeze({
            commonLots: order.quantity,
            contractUnit: metadata.contractUnit,
            quantityShares,
            status: status.status,
            statusQuantityCommonLots: status.order_quantity,
        });
    }
    throw new Error('no current fixed-account Common order evidence is available');
}

function contractProjection(metadata, kind) {
    return Object.freeze({
        categoryCode: metadata.categoryCode,
        code: metadata.code,
        contractUnit: metadata.contractUnit,
        exchange: metadata.exchange,
        kind,
        limitDownMinorUnits: metadata.limitDownMinorUnits,
        limitUpMinorUnits: metadata.limitUpMinorUnits,
        referenceMinorUnits: metadata.referenceMinorUnits,
        securityType: metadata.securityType,
        updateDate: metadata.updateDate,
    });
}

async function sourceFingerprints() {
    const root = repositoryRoot();
    const rows = [];
    for (const relativePath of SOURCE_FILES) {
        const absolutePath = path.join(root, relativePath);
        const before = await lstat(absolutePath);
        if (before.isSymbolicLink() || !before.isFile() || before.size < 1) {
            throw new Error('Task 0.7 source fingerprint is invalid');
        }
        const bytes = await readFile(absolutePath);
        const after = await lstat(absolutePath);
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs
        ) {
            throw new Error('Task 0.7 source changed while hashing');
        }
        rows.push(Object.freeze({ path: relativePath, sha256: sha256(bytes) }));
    }
    return Object.freeze({
        sourceMatrixSha256: sha256(canonicalJson(rows)),
        sources: Object.freeze(rows),
    });
}

async function readPrivateToken(filePath, maximumBytes) {
    const handle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.size < 1 ||
            before.size > maximumBytes ||
            (before.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' && before.uid !== process.getuid())
        ) {
            throw new Error('private Runtime marker is invalid');
        }
        const value = (await handle.readFile('utf8')).trim();
        const after = await handle.stat();
        if (
            after.dev !== before.dev ||
            after.ino !== before.ino ||
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            value.length < 1 ||
            value.length > maximumBytes ||
            !/^[A-Za-z0-9._:-]+$/.test(value)
        ) {
            throw new Error('private Runtime marker is invalid');
        }
        return value;
    } finally {
        await handle.close();
    }
}

async function requestJson(fetchImpl, coordinator, metrics, endpoint, init = {}) {
    const method = init.method ?? 'GET';
    if (!ALLOWED_REQUESTS.has(`${method} ${endpoint}`)) {
        throw new Error('Task 0.7 probe endpoint is not read-only allowlisted');
    }
    const operationId = `task0-7:${randomUUID()}`;
    const grant = await coordinator.acquireOperation({
        operationId,
        kind: endpoint === '/api/v1/info' ? 'status' : 'reconciliation',
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const url = `${BASE_URL}${endpoint}`;
    try {
        await coordinator.acquireOperationUnit({ operationId: grant.operationId });
        metrics.accountingReads += 1;
        metrics.requestCount += 1;
        const response = await fetchImpl(url, {
            method,
            redirect: 'error',
            signal: controller.signal,
            headers: init.body
                ? Object.freeze({ 'content-type': 'application/json' })
                : undefined,
            body: init.body ? JSON.stringify(init.body) : undefined,
        });
        if (
            response?.ok !== true ||
            response.redirected !== false ||
            response.url !== url ||
            !/^application\/json(?:\s*;|$)/i.test(
                response.headers?.get?.('content-type') ?? '',
            )
        ) {
            throw new Error('Task 0.7 read-only response boundary failed');
        }
        const declared = Number(response.headers?.get?.('content-length') ?? 0);
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
            throw new Error('Task 0.7 response exceeds its safe bound');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_RESPONSE_BYTES) {
            throw new Error('Task 0.7 response exceeds its safe bound');
        }
        return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
        clearTimeout(timer);
        const completed = coordinator.completeOperation({
            operationId: grant.operationId,
        });
        if (completed.allowed !== true) {
            throw new Error('Task 0.7 resource operation settlement failed');
        }
    }
}

function makeCheck(id) {
    return Object.freeze({ id, status: 'pass' });
}

function reportHash(report) {
    return sha256(canonicalJson({ ...report, resultHash: '' }));
}

export function verifySmartOrderTask0_7UnitCapabilityEvidence({
    report,
    expectedSourceMatrixSha256,
    nowEpochMs,
    maximumAgeMs = SMART_ORDER_TASK0_7_MAX_EVIDENCE_AGE_MS,
}) {
    const reasons = new Set();
    if (!exactKeys(report, TOP_LEVEL_KEYS)) {
        return Object.freeze({ eligible: false, reasons: Object.freeze(['report_schema_invalid']) });
    }
    if (
        !/^[a-f0-9]{64}$/.test(expectedSourceMatrixSha256 ?? '') ||
        !Number.isSafeInteger(nowEpochMs) ||
        !Number.isSafeInteger(maximumAgeMs) ||
        maximumAgeMs < 1
    ) {
        throw new TypeError('Task 0.7 verifier context is invalid');
    }
    if (
        report.schema !== SMART_ORDER_TASK0_7_UNIT_CAPABILITY_SCHEMA ||
        report.version !== SMART_ORDER_TASK0_7_UNIT_CAPABILITY_VERSION
    ) reasons.add('schema_or_version_stale');
    if (
        typeof report.runId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            report.runId,
        )
    ) reasons.add('run_lineage_invalid');
    if (
        report.executionMode !== 'managed-live-readonly' ||
        report.evidenceClass !== 'task0_7_unit_capability' ||
        report.overall !== 'pass'
    ) reasons.add('execution_or_outcome_invalid');
    const generatedAtEpochMs = Date.parse(report.generatedAt);
    if (
        !Number.isSafeInteger(generatedAtEpochMs) ||
        new Date(generatedAtEpochMs).toISOString() !== report.generatedAt ||
        generatedAtEpochMs > nowEpochMs ||
        nowEpochMs - generatedAtEpochMs > maximumAgeMs
    ) reasons.add('report_stale_or_replayed');
    if (
        typeof report.resultHash !== 'string' ||
        report.resultHash !== reportHash(report)
    ) reasons.add('result_hash_mismatch');
    if (
        !exactKeys(report.fingerprint, FINGERPRINT_KEYS) ||
        report.fingerprint.sourceMatrixSha256 !== expectedSourceMatrixSha256 ||
        !Array.isArray(report.fingerprint.sources) ||
        report.fingerprint.sources.length !== SOURCE_FILES.length ||
        report.fingerprint.sources.some(
            (row, index) =>
                !exactKeys(row, SOURCE_ROW_KEYS) ||
                row.path !== SOURCE_FILES[index] ||
                !/^[a-f0-9]{64}$/.test(row.sha256 ?? ''),
        ) ||
        sha256(canonicalJson(report.fingerprint.sources)) !==
            report.fingerprint.sourceMatrixSha256
    ) reasons.add('source_fingerprint_mismatch');
    const seen = new Map();
    if (!Array.isArray(report.checks)) {
        reasons.add('check_matrix_invalid');
    } else {
        for (const check of report.checks) {
            if (!exactKeys(check, ['id', 'status']) || check.status !== 'pass') {
                reasons.add('check_matrix_invalid');
                continue;
            }
            seen.set(check.id, (seen.get(check.id) ?? 0) + 1);
        }
        if (
            seen.size !== REQUIRED_CHECK_IDS.length ||
            !REQUIRED_CHECK_IDS.every((id) => seen.get(id) === 1)
        ) reasons.add('check_matrix_invalid');
    }
    if (
        report.accountIdentifiersPersisted !== false ||
        !exactKeys(report.sideEffects, SIDE_EFFECT_KEYS) ||
        !exactKeys(report.network, NETWORK_KEYS) ||
        !Object.values(report.sideEffects).every(
            (value) => Number.isSafeInteger(value) && value === 0,
        ) ||
        !Object.values(report.network).every(
            (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        report.network.accountingReads !== report.network.requestCount ||
        report.network.brokerWritesAttempted !== 0 ||
        report.network.brokerWritesNetworked !== 0
    ) reasons.add('side_effect_or_redaction_invalid');
    if (
        !exactKeys(report.managedRuntime, MANAGED_RUNTIME_KEYS) ||
        report.managedRuntime?.sharedModeLeaseHeld !== true ||
        report.managedRuntime?.simulationAttested !== true ||
        report.managedRuntime?.processStable !== true ||
        report.managedRuntime?.generationStable !== true
    ) reasons.add('managed_runtime_attestation_invalid');
    const projection = report.sourceProjection;
    const contractProjections = [projection?.stock, projection?.etf];
    let exactQuantityProjection = false;
    try {
        exactQuantityProjection =
            Number.isSafeInteger(projection?.commonOrderCommonLots) &&
            projection.commonOrderCommonLots > 0 &&
            Number.isSafeInteger(projection?.commonOrderContractUnit) &&
            projection.commonOrderContractUnit > 0 &&
            Number.isSafeInteger(projection?.commonOrderQuantityShares) &&
            projection.commonOrderQuantityShares > 0 &&
            BigInt(projection.commonOrderQuantityShares) ===
                BigInt(projection.commonOrderCommonLots) *
                    BigInt(projection.commonOrderContractUnit);
    } catch {
        exactQuantityProjection = false;
    }
    if (
        !exactKeys(projection, SOURCE_PROJECTION_KEYS) ||
        !contractProjections.every((entry) =>
            exactKeys(entry, CONTRACT_PROJECTION_KEYS),
        ) ||
        report.sourceProjection?.positionsUnit !== 'Share' ||
        report.sourceProjection?.commonOrderUnit !== 'CommonLot' ||
        report.sourceProjection?.stock?.code !== '2330' ||
        report.sourceProjection?.stock?.kind !== 'stock' ||
        report.sourceProjection?.etf?.code !== '0050' ||
        report.sourceProjection?.etf?.kind !== 'etf' ||
        !contractProjections.every(
            (entry) =>
                /^\d{2}$/.test(entry.categoryCode ?? '') &&
                Number.isSafeInteger(entry.contractUnit) &&
                entry.contractUnit > 0 &&
                ['TSE', 'OTC'].includes(entry.exchange) &&
                entry.securityType === 'STK' &&
                Number.isSafeInteger(entry.referenceMinorUnits) &&
                Number.isSafeInteger(entry.limitUpMinorUnits) &&
                Number.isSafeInteger(entry.limitDownMinorUnits) &&
                entry.limitDownMinorUnits <= entry.referenceMinorUnits &&
                entry.referenceMinorUnits <= entry.limitUpMinorUnits &&
                /^\d{4}-\d{2}-\d{2}$/.test(entry.updateDate ?? ''),
        ) ||
        !Number.isSafeInteger(projection.positionsCount) ||
        projection.positionsCount < 0 ||
        ![
            'PendingSubmit',
            'PreSubmitted',
            'Submitted',
            'PartFilled',
            'Filled',
            'Cancelled',
            'Inactive',
            'Failed',
        ].includes(projection.commonOrderStatus) ||
        !Number.isSafeInteger(
            projection.commonOrderStatusQuantityCommonLots,
        ) ||
        projection.commonOrderStatusQuantityCommonLots < 0 ||
        !/^[a-f0-9]{64}$/.test(projection.positionApiContractSha256 ?? '') ||
        !Number.isSafeInteger(projection.signedStockAccountCount) ||
        projection.signedStockAccountCount < 1 ||
        projection.signedStockAccountCount > MAX_ACCOUNT_ROWS ||
        !exactQuantityProjection
    ) reasons.add('unit_projection_invalid');
    return reasons.size === 0
        ? Object.freeze({
              eligible: true,
              evidenceClass: 'task0_7_unit_capability',
              evidenceId: report.runId,
              resultSha256: `sha256:${report.resultHash}`,
              sourceMatrixSha256: report.fingerprint.sourceMatrixSha256,
          })
        : Object.freeze({
              eligible: false,
              reasons: Object.freeze([...reasons].sort()),
          });
}

export async function runSmartOrderTask0_7UnitCapabilityProbe(options = {}) {
    const appSupportRoot = options.appSupportRoot ?? path.join(
        homedir(),
        'Library',
        'Application Support',
        'RealTimeStock',
    );
    const canonicalRoot = await realpath(appSupportRoot);
    const rootMetadata = await lstat(canonicalRoot);
    if (
        canonicalRoot !== path.resolve(appSupportRoot) ||
        rootMetadata.isSymbolicLink() ||
        !rootMetadata.isDirectory() ||
        (rootMetadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && rootMetadata.uid !== process.getuid())
    ) {
        throw new Error('Task 0.7 app support root is not private');
    }
    const authority = options.authority ?? takeSmartOrderContractProbeRuntimeAuthority();
    const coordinator = options.resourceCoordinator ?? createSmartOrderResourceCoordinator();
    const ownsCoordinator = options.resourceCoordinator === undefined;
    if (
        authority?.fetchImpl !== globalThis.fetch ||
        typeof authority.acquireSharedLease !== 'function' ||
        typeof authority.processAttestor?.attest !== 'function' ||
        typeof authority.isManagedAttestation !== 'function' ||
        !isIssuedSmartOrderResourceCoordinator(coordinator)
    ) {
        throw new Error('Task 0.7 managed Runtime authority is unavailable');
    }
    const metrics = {
        accountingReads: 0,
        brokerWritesAttempted: 0,
        brokerWritesNetworked: 0,
        requestCount: 0,
    };
    let lease;
    try {
        const leaseDirectory =
            await prepareSmartOrderModeExecutionLeaseDirectoryForAppSupportRoot(
                canonicalRoot,
            );
        lease = await authority.acquireSharedLease({ directoryPath: leaseDirectory });
        if (!lease?.acquired || lease.mode !== 'shared' || lease.brokerAuthority !== false) {
            throw new Error('Task 0.7 shared mode lease is unavailable');
        }
        const modePath = path.join(canonicalRoot, 'runtime-mode');
        const generationPath = path.join(canonicalRoot, 'runtime-api-generation');
        const modeBefore = await readPrivateToken(modePath, 32);
        const generationBefore = await readPrivateToken(generationPath, 256);
        const processBefore = await authority.processAttestor.attest();
        if (modeBefore !== 'simulation' || !authority.isManagedAttestation(processBefore)) {
            throw new Error('Task 0.7 managed simulation attestation failed');
        }
        const infoBefore = validateInfo(
            await requestJson(authority.fetchImpl, coordinator, metrics, '/api/v1/info'),
        );
        const positionApiContractBefore = validatePositionOpenApi(
            await requestJson(
                authority.fetchImpl,
                coordinator,
                metrics,
                '/openapi.json',
            ),
        );
        const accounts = await requestJson(
            authority.fetchImpl,
            coordinator,
            metrics,
            '/api/v1/auth/accounts',
        );
        const selection = selectFixedStockAccount(accounts);
        const account = selection.account;
        const positionsBody = Object.freeze({ ...account, unit: 'Share' });
        const positionsBefore = validatePositions(
            await requestJson(
                authority.fetchImpl,
                coordinator,
                metrics,
                '/api/v1/portfolio/position_unit',
                { method: 'POST', body: positionsBody },
            ),
        );
        const tradesBefore = await requestJson(
            authority.fetchImpl,
            coordinator,
            metrics,
            '/api/v1/order/trades',
            { method: 'POST', body: account },
        );
        const observedAtEpochMs = options.nowEpochMs?.() ?? Date.now();
        const metadataByCode = new Map();
        for (const benchmark of BENCHMARKS) {
            const raw = await requestJson(
                authority.fetchImpl,
                coordinator,
                metrics,
                `/api/v1/data/contracts/${benchmark.code}/info?security_type=STK&region=TW`,
            );
            const metadata = parseSmartOrderCanonicalStockContractMetadata(raw, {
                requestedCode: benchmark.code,
            });
            assertSmartOrderCanonicalContractUpdateDateCurrent(
                metadata,
                observedAtEpochMs,
            );
            metadataByCode.set(benchmark.code, metadata);
        }
        const commonOrder = validateCommonOrderQuantity(
            tradesBefore,
            account,
            metadataByCode,
        );
        const positionsAfter = validatePositions(
            await requestJson(
                authority.fetchImpl,
                coordinator,
                metrics,
                '/api/v1/portfolio/position_unit',
                { method: 'POST', body: positionsBody },
            ),
        );
        const tradesAfter = await requestJson(
            authority.fetchImpl,
            coordinator,
            metrics,
            '/api/v1/order/trades',
            { method: 'POST', body: account },
        );
        const commonOrderAfter = validateCommonOrderQuantity(
            tradesAfter,
            account,
            metadataByCode,
        );
        const contractsAfter = new Map();
        for (const benchmark of BENCHMARKS) {
            const raw = await requestJson(
                authority.fetchImpl,
                coordinator,
                metrics,
                `/api/v1/data/contracts/${benchmark.code}/info?security_type=STK&region=TW`,
            );
            const metadata = parseSmartOrderCanonicalStockContractMetadata(raw, {
                requestedCode: benchmark.code,
            });
            assertSmartOrderCanonicalContractUpdateDateCurrent(
                metadata,
                observedAtEpochMs,
            );
            contractsAfter.set(benchmark.code, metadata);
        }
        if (
            canonicalJson(positionsBefore) !== canonicalJson(positionsAfter) ||
            canonicalJson(commonOrder) !== canonicalJson(commonOrderAfter) ||
            canonicalJson([...metadataByCode]) !== canonicalJson([...contractsAfter])
        ) {
            throw new Error('Task 0.7 source changed during its bounded read window');
        }
        const infoAfter = validateInfo(
            await requestJson(authority.fetchImpl, coordinator, metrics, '/api/v1/info'),
        );
        const positionApiContractAfter = validatePositionOpenApi(
            await requestJson(
                authority.fetchImpl,
                coordinator,
                metrics,
                '/openapi.json',
            ),
        );
        const modeAfter = await readPrivateToken(modePath, 32);
        const generationAfter = await readPrivateToken(generationPath, 256);
        const processAfter = await authority.processAttestor.attest();
        if (
            modeAfter !== 'simulation' ||
            generationAfter !== generationBefore ||
            infoAfter !== infoBefore ||
            positionApiContractAfter !== positionApiContractBefore ||
            !authority.isManagedAttestation(processAfter) ||
            processAfter.processStartIdentitySha256 !==
                processBefore.processStartIdentitySha256
        ) {
            throw new Error('Task 0.7 managed Runtime changed during the probe');
        }
        const fingerprint = await sourceFingerprints();
        const stock = contractProjection(metadataByCode.get('2330'), 'stock');
        const etf = contractProjection(metadataByCode.get('0050'), 'etf');
        const report = {
            schema: SMART_ORDER_TASK0_7_UNIT_CAPABILITY_SCHEMA,
            version: SMART_ORDER_TASK0_7_UNIT_CAPABILITY_VERSION,
            generatedAt: new Date(observedAtEpochMs).toISOString(),
            runId: options.runId ?? randomUUID(),
            executionMode: 'managed-live-readonly',
            evidenceClass: 'task0_7_unit_capability',
            accountIdentifiersPersisted: false,
            managedRuntime: {
                generationStable: true,
                processStable: true,
                sharedModeLeaseHeld: true,
                simulationAttested: true,
            },
            network: metrics,
            sideEffects: {
                brokerWritesAttempted: 0,
                brokerWritesNetworked: 0,
                serviceMutations: 0,
            },
            fingerprint,
            sourceProjection: {
                commonOrderCommonLots: commonOrder.commonLots,
                commonOrderContractUnit: commonOrder.contractUnit,
                commonOrderQuantityShares: commonOrder.quantityShares,
                commonOrderStatus: commonOrder.status,
                commonOrderStatusQuantityCommonLots:
                    commonOrder.statusQuantityCommonLots,
                commonOrderUnit: 'CommonLot',
                etf,
                positionApiContractSha256: positionApiContractAfter,
                positionsCount: positionsAfter.length,
                positionsUnit: 'Share',
                signedStockAccountCount: selection.signedStockAccountCount,
                stock,
            },
            checks: REQUIRED_CHECK_IDS.map(makeCheck),
            overall: 'pass',
            resultHash: '',
        };
        report.resultHash = reportHash(report);
        return Object.freeze(report);
    } finally {
        if (lease?.acquired) await lease.close().catch(() => {});
        if (ownsCoordinator) coordinator.close();
    }
}

export async function currentSmartOrderTask0_7UnitCapabilityFingerprints() {
    return sourceFingerprints();
}

function parseCli(argv) {
    return argv.length === 1 && argv[0] === `--confirm=${CONFIRMATION}`;
}

async function main() {
    if (!parseCli(process.argv.slice(2))) {
        process.stderr.write(
            `usage: node scripts/smart-order-task0-7-unit-capability.mjs --confirm=${CONFIRMATION}\n`,
        );
        process.exitCode = 2;
        return;
    }
    try {
        const report = await runSmartOrderTask0_7UnitCapabilityProbe();
        const currentFingerprint =
            await currentSmartOrderTask0_7UnitCapabilityFingerprints();
        const verified = verifySmartOrderTask0_7UnitCapabilityEvidence({
            report,
            expectedSourceMatrixSha256:
                currentFingerprint.sourceMatrixSha256,
            nowEpochMs: Date.now(),
        });
        process.stdout.write(`${JSON.stringify({ report, verified }, null, 2)}\n`);
        if (verified.eligible !== true) process.exitCode = 2;
    } catch (error) {
        process.stderr.write(`Task 0.7 unit capability probe blocked: ${error?.message ?? 'unknown'}\n`);
        process.exitCode = 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
