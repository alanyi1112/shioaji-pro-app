import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { parseSmartOrderCanonicalStockContractMetadata } from './canonical-stock-unit-contract.mjs';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';
import { currentTaskProbeWriteSourceFingerprint } from './task-probe-write-preflight.mjs';

export const SMART_ORDER_TASK_PROBE_READONLY_PREFLIGHT_SCHEMA_VERSION =
    'smart-order-task-probe-readonly-preflight/2026-08-26.1';
export const SMART_ORDER_TASK_PROBE_AUTHORIZATION_WINDOW_MS = 300_000;

const BASE_URL = 'http://127.0.0.1:8080';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_AGE_MS = 30_000;
const MAX_MARKET_EVIDENCE_LIFETIME_MS = 30_000;
const MAX_ADJACENT_SNAPSHOT_AGE_MS = 60_000;
const MAX_READONLY_PREFLIGHT_MS = 15_000;
const MAX_ADJACENT_REVALIDATION_MS = 7_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const issuedAuthorities = new WeakMap();
const issuedProjections = new WeakSet();
const DEFAULT_CONTRACT_SCOPE = Object.freeze({
    security_type: 'STK',
    region: 'TW',
    exchange: 'TSE',
    code: '2330',
    target_code: null,
});

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value, seen = new WeakSet()) {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('preflight JSON number is invalid');
        return JSON.stringify(value);
    }
    if (!value || typeof value !== 'object' || utilTypes.isProxy(value)) {
        throw new TypeError('preflight JSON value is invalid');
    }
    if (seen.has(value)) throw new TypeError('preflight JSON cannot be cyclic');
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value.map((entry) => stableJson(entry, seen)).join(',')}]`;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype) {
            throw new TypeError('preflight JSON object prototype is invalid');
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors);
        if (keys.some((key) => typeof key !== 'string')) {
            throw new TypeError('preflight JSON keys are invalid');
        }
        keys.sort();
        return `{${keys
            .map((key) => {
                const descriptor = descriptors[key];
                if (
                    descriptor?.enumerable !== true ||
                    !Object.hasOwn(descriptor, 'value') ||
                    Object.hasOwn(descriptor, 'get') ||
                    Object.hasOwn(descriptor, 'set')
                ) {
                    throw new TypeError('preflight JSON property is invalid');
                }
                return `${JSON.stringify(key)}:${stableJson(descriptor.value, seen)}`;
            })
            .join(',')}}`;
    } finally {
        seen.delete(value);
    }
}

function exact(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be an exact non-Proxy object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        JSON.stringify([...actual].sort()) !== JSON.stringify([...keys].sort())
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    return Object.freeze(
        Object.fromEntries(
            keys.map((key) => {
                const descriptor = descriptors[key];
                if (
                    descriptor?.enumerable !== true ||
                    !Object.hasOwn(descriptor, 'value') ||
                    Object.hasOwn(descriptor, 'get') ||
                    Object.hasOwn(descriptor, 'set')
                ) {
                    throw new TypeError(`${label}.${key} must be an own data property`);
                }
                return [key, descriptor.value];
            }),
        ),
    );
}

function canonicalContractScope(value) {
    const scope = exact(
        value,
        ['code', 'exchange', 'region', 'security_type', 'target_code'],
        'task probe contract scope',
    );
    if (
        scope.security_type !== 'STK' ||
        scope.region !== 'TW' ||
        !['TSE', 'OTC'].includes(scope.exchange) ||
        typeof scope.code !== 'string' ||
        !/^[A-Z0-9]{1,16}$/.test(scope.code) ||
        scope.target_code !== null
    ) {
        throw new TypeError('task probe contract scope is invalid');
    }
    return scope;
}

async function readPrivateToken(filePath, pattern, label) {
    const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
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
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            !pattern.test(value)
        ) {
            throw new Error(`${label} changed or is invalid`);
        }
        return value;
    } finally {
        await handle.close();
    }
}

async function requestJson(fetchImpl, pathname, { body, beforeRequest } = {}) {
    const url = `${BASE_URL}${pathname}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        await Reflect.apply(beforeRequest, undefined, []);
        const response = await Reflect.apply(fetchImpl, globalThis, [url, {
            method: body === undefined ? 'GET' : 'POST',
            headers:
                body === undefined
                    ? { accept: 'application/json' }
                    : { accept: 'application/json', 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
        }]);
        if (!response || response.url !== url || response.redirected === true || !response.ok) {
            throw new Error('task probe read response identity is invalid');
        }
        const contentType = String(response.headers?.get?.('content-type') ?? '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
        if (contentType !== 'application/json') {
            throw new Error('task probe read response type is invalid');
        }
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
            throw new Error('task probe read response is oversized');
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
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

function selectAccount(accounts) {
    if (!Array.isArray(accounts) || accounts.length > 64) {
        throw new Error('task probe accounts response is invalid');
    }
    const candidates = accounts
        .filter((entry) => entry?.signed === true && entry?.account_type === 'S')
        .map(accountTuple);
    if (candidates.length < 1 || candidates.some((entry) => entry === null)) {
        throw new Error('task probe fixed stock account is unavailable');
    }
    const keyed = candidates.map((account) => ({
        account,
        key: `${account.broker_id}\u001f${account.account_id}\u001fS`,
    }));
    if (new Set(keyed.map((entry) => entry.key)).size !== keyed.length) {
        throw new Error('task probe fixed stock account is ambiguous');
    }
    keyed.sort((left, right) => left.key.localeCompare(right.key));
    return keyed[0].account;
}

function decimalMinorUnits(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} is invalid`);
    }
    const scaled = value * 100;
    if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 1e-7) {
        throw new Error(`${label} exceeds exact minor-unit precision`);
    }
    return Math.round(scaled);
}

function parseSnapshot(
    value,
    nowEpochMs,
    expectedContractScope = DEFAULT_CONTRACT_SCOPE,
    maximumAgeMs = MAX_SNAPSHOT_AGE_MS,
) {
    if (!Array.isArray(value) || value.length !== 1) {
        throw new Error('task probe snapshot response is not singular');
    }
    const row = value[0];
    if (
        !row ||
        typeof row !== 'object' ||
        row.code !== expectedContractScope.code ||
        row.exchange !== expectedContractScope.exchange ||
        typeof row.datetime !== 'string'
    ) {
        throw new Error('task probe snapshot identity is invalid');
    }
    const exchangeTimeEpochMs = Date.parse(row.datetime);
    if (!Number.isSafeInteger(exchangeTimeEpochMs)) {
        throw new Error('task probe snapshot time is invalid');
    }
    const tradeDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(exchangeTimeEpochMs));
    if (
        exchangeTimeEpochMs > nowEpochMs ||
        nowEpochMs - exchangeTimeEpochMs > maximumAgeMs
    ) {
        throw new Error('task probe snapshot is stale');
    }
    return Object.freeze({
        tradeDate,
        bestBidMinorUnits: decimalMinorUnits(row.buy_price, 'snapshot.buy_price'),
        bestAskMinorUnits: decimalMinorUnits(row.sell_price, 'snapshot.sell_price'),
        exchangeTimeEpochMs,
    });
}

export async function runSmartOrderTaskProbeReadonlyPreflight({
    appSupportRoot,
    contractScope: contractScopeValue = DEFAULT_CONTRACT_SCOPE,
    expectedApiGeneration,
    observerReadiness,
    candidateOnly = false,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    beforeRequest = async () => {},
}) {
    const contractScope = canonicalContractScope(contractScopeValue);
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        (await realpath(appSupportRoot)) !== appSupportRoot ||
        typeof fetchImpl !== 'function' ||
        utilTypes.isProxy(fetchImpl) ||
        typeof now !== 'function' ||
        utilTypes.isProxy(now) ||
        typeof beforeRequest !== 'function' ||
        utilTypes.isProxy(beforeRequest) ||
        typeof candidateOnly !== 'boolean' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration ?? '')
    ) {
        throw new TypeError('task probe readonly preflight configuration is invalid');
    }
    const startedAtEpochMs = now();
    const readiness = candidateOnly
        ? Object.freeze({
              accountScopeSha256: null,
              current: false,
              evidenceSha256: sha256('candidate-only-no-observer-authority'),
              validUntilEpochMs:
                  startedAtEpochMs +
                  SMART_ORDER_TASK_PROBE_AUTHORIZATION_WINDOW_MS,
          })
        : exact(
              observerReadiness,
              [
                  'accountScopeSha256',
                  'current',
                  'evidenceSha256',
                  'validUntilEpochMs',
              ],
              'task probe observer readiness',
          );
    if (
        (!candidateOnly && readiness.current !== true) ||
        (!candidateOnly && !DIGEST.test(readiness.accountScopeSha256 ?? '')) ||
        !DIGEST.test(readiness.evidenceSha256 ?? '') ||
        !Number.isSafeInteger(readiness.validUntilEpochMs) ||
        readiness.validUntilEpochMs <= startedAtEpochMs ||
        (candidateOnly && observerReadiness !== undefined)
    ) {
        throw new Error('task probe observer is not ready before authorization');
    }
    const modePath = path.join(appSupportRoot, 'runtime-mode');
    const generationPath = path.join(appSupportRoot, 'runtime-api-generation');
    const modeBefore = await readPrivateToken(modePath, /^simulation$/, 'runtime mode');
    const generationBefore = await readPrivateToken(
        generationPath,
        /^simulation:[A-Za-z0-9._:-]{1,240}$/,
        'runtime generation',
    );
    if (modeBefore !== 'simulation' || generationBefore !== expectedApiGeneration) {
        throw new Error('task probe mode or generation is not current simulation');
    }
    const sourceBefore = await currentTaskProbeWriteSourceFingerprint();
    const requestOptions = Object.freeze({ beforeRequest });
    const infoBefore = await requestJson(fetchImpl, '/api/v1/info', requestOptions);
    if (infoBefore?.simulation !== true) throw new Error('task probe API is not simulation');
    const account = selectAccount(
        await requestJson(fetchImpl, '/api/v1/auth/accounts', requestOptions),
    );
    const accountScopeSha256 = smartOrderGateProbeAccountScopeSha256(account);
    if (!candidateOnly && accountScopeSha256 !== readiness.accountScopeSha256) {
        throw new Error('task probe observer account scope drifted');
    }
    const positionRequest = Object.freeze({ ...account, unit: 'Share' });
    const snapshotRequest = Object.freeze({
        contracts: [contractScope],
    });
    const positionsBefore = await requestJson(
        fetchImpl,
        '/api/v1/portfolio/position_unit',
        { body: positionRequest, beforeRequest },
    );
    const tradesBefore = await requestJson(fetchImpl, '/api/v1/order/trades', {
        body: account,
        beforeRequest,
    });
    canonicalizeShioajiRefreshedStockTrades(tradesBefore);
    const contractBefore = parseSmartOrderCanonicalStockContractMetadata(
        await requestJson(
            fetchImpl,
            `/api/v1/data/contracts/${encodeURIComponent(contractScope.code)}/info?security_type=STK&region=TW`,
            { beforeRequest },
        ),
        {
            requestedCode: contractScope.code,
            expectedExchange: contractScope.exchange,
        },
    );
    const snapshotBefore = parseSnapshot(
        await requestJson(fetchImpl, '/api/v1/data/snapshots', {
            body: snapshotRequest,
            beforeRequest,
        }),
        now(),
        contractScope,
    );
    const positionsAfter = await requestJson(
        fetchImpl,
        '/api/v1/portfolio/position_unit',
        { body: positionRequest, beforeRequest },
    );
    const tradesAfter = await requestJson(fetchImpl, '/api/v1/order/trades', {
        body: account,
        beforeRequest,
    });
    canonicalizeShioajiRefreshedStockTrades(tradesAfter);
    const contractAfter = parseSmartOrderCanonicalStockContractMetadata(
        await requestJson(
            fetchImpl,
            `/api/v1/data/contracts/${encodeURIComponent(contractScope.code)}/info?security_type=STK&region=TW`,
            { beforeRequest },
        ),
        {
            requestedCode: contractScope.code,
            expectedExchange: contractScope.exchange,
        },
    );
    const snapshotAfter = parseSnapshot(
        await requestJson(fetchImpl, '/api/v1/data/snapshots', {
            body: snapshotRequest,
            beforeRequest,
        }),
        now(),
        contractScope,
    );
    const infoAfter = await requestJson(fetchImpl, '/api/v1/info', requestOptions);
    const modeAfter = await readPrivateToken(modePath, /^simulation$/, 'runtime mode');
    const generationAfter = await readPrivateToken(
        generationPath,
        /^simulation:[A-Za-z0-9._:-]{1,240}$/,
        'runtime generation',
    );
    const sourceAfter = await currentTaskProbeWriteSourceFingerprint();
    if (
        infoAfter?.simulation !== true ||
        modeAfter !== modeBefore ||
        generationAfter !== generationBefore ||
        sourceAfter !== sourceBefore ||
        stableJson(positionsAfter) !== stableJson(positionsBefore) ||
        stableJson(tradesAfter) !== stableJson(tradesBefore) ||
        stableJson(contractAfter) !== stableJson(contractBefore) ||
        snapshotAfter.tradeDate !== snapshotBefore.tradeDate
    ) {
        throw new Error('task probe readonly source drifted during preflight');
    }
    const completedAtEpochMs = now();
    if (
        readiness.validUntilEpochMs <= completedAtEpochMs ||
        completedAtEpochMs - startedAtEpochMs > MAX_READONLY_PREFLIGHT_MS ||
        contractAfter.updateDate !== snapshotAfter.tradeDate
    ) {
        throw new Error('task probe readonly preflight is stale');
    }
    const validUntilEpochMs = Math.min(
        readiness.validUntilEpochMs,
        completedAtEpochMs + MAX_MARKET_EVIDENCE_LIFETIME_MS,
    );
    const positionsSha256 = sha256(stableJson(positionsAfter));
    const workingOrdersSha256 = sha256(stableJson(tradesAfter));
    const contractEvidenceSha256 = sha256(stableJson(contractAfter));
    const quoteEvidenceSha256 = sha256(stableJson(snapshotAfter));
    const authority = Object.freeze({});
    issuedAuthorities.set(
        authority,
        Object.freeze({
            account,
            positions: positionsAfter,
            trades: tradesAfter,
            contract: contractAfter,
            quote: snapshotAfter,
        }),
    );
    const projection = Object.freeze({
        accountScopeSha256,
        accountRef: `…${accountScopeSha256.slice(-12)}`,
        apiGenerationSha256: sha256(expectedApiGeneration),
        sourceFingerprintSha256: sourceAfter,
        tradeDate: snapshotAfter.tradeDate,
        positionsSha256,
        workingOrdersSha256,
        observerReadinessSha256: readiness.evidenceSha256,
        observerReady: !candidateOnly,
        authorizationDisplayAllowed: !candidateOnly,
        contract: Object.freeze({
            contractKey: contractAfter.contractKey,
            categoryCode: contractAfter.categoryCode,
            contractUnit: contractAfter.contractUnit,
            referenceMinorUnits: contractAfter.referenceMinorUnits,
            limitDownMinorUnits: contractAfter.limitDownMinorUnits,
            limitUpMinorUnits: contractAfter.limitUpMinorUnits,
            updateDate: contractAfter.updateDate,
            observedAtEpochMs: completedAtEpochMs,
            validUntilEpochMs,
            evidenceSha256: contractEvidenceSha256,
        }),
        quote: Object.freeze({
            ...snapshotAfter,
            observedAtEpochMs: completedAtEpochMs,
            validUntilEpochMs,
            evidenceSha256: quoteEvidenceSha256,
        }),
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
    issuedProjections.add(projection);
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_PROBE_READONLY_PREFLIGHT_SCHEMA_VERSION,
        authority,
        projection,
    });
}

export async function runSmartOrderTaskProbeAdjacentRevalidation({
    appSupportRoot,
    expectedApiGeneration,
    observerReadiness,
    priorProjection,
    account: accountValue,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    beforeRequest = async () => {},
}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        (await realpath(appSupportRoot)) !== appSupportRoot ||
        !issuedProjections.has(priorProjection) ||
        typeof fetchImpl !== 'function' ||
        utilTypes.isProxy(fetchImpl) ||
        typeof now !== 'function' ||
        utilTypes.isProxy(now) ||
        typeof beforeRequest !== 'function' ||
        utilTypes.isProxy(beforeRequest) ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration ?? '')
    ) {
        throw new TypeError('task probe adjacent revalidation configuration is invalid');
    }
    const account = accountTuple(accountValue);
    const readiness = exact(
        observerReadiness,
        [
            'accountScopeSha256',
            'current',
            'evidenceSha256',
            'validUntilEpochMs',
        ],
        'task probe adjacent observer readiness',
    );
    const startedAtEpochMs = now();
    if (
        account === null ||
        readiness.current !== true ||
        readiness.accountScopeSha256 !== priorProjection.accountScopeSha256 ||
        readiness.evidenceSha256 !== priorProjection.observerReadinessSha256 ||
        priorProjection.observerReady !== true ||
        priorProjection.authorizationDisplayAllowed !== true ||
        readiness.validUntilEpochMs <= startedAtEpochMs
    ) {
        throw new Error('task probe adjacent authority is stale or drifted');
    }
    issuedProjections.delete(priorProjection);
    const modePath = path.join(appSupportRoot, 'runtime-mode');
    const generationPath = path.join(appSupportRoot, 'runtime-api-generation');
    const modeBefore = await readPrivateToken(modePath, /^simulation$/, 'runtime mode');
    const generationBefore = await readPrivateToken(
        generationPath,
        /^simulation:[A-Za-z0-9._:-]{1,240}$/,
        'runtime generation',
    );
    const sourceBefore = await currentTaskProbeWriteSourceFingerprint();
    if (
        modeBefore !== 'simulation' ||
        generationBefore !== expectedApiGeneration ||
        sha256(expectedApiGeneration) !== priorProjection.apiGenerationSha256 ||
        sourceBefore !== priorProjection.sourceFingerprintSha256 ||
        smartOrderGateProbeAccountScopeSha256(account) !==
            priorProjection.accountScopeSha256
    ) {
        throw new Error('task probe adjacent mode, source or account drifted');
    }
    const requestOptions = Object.freeze({ beforeRequest });
    const info = await requestJson(fetchImpl, '/api/v1/info', requestOptions);
    if (info?.simulation !== true) {
        throw new Error('task probe adjacent API is not simulation');
    }
    const positionRequest = Object.freeze({ ...account, unit: 'Share' });
    const snapshotRequest = Object.freeze({
        contracts: [
            Object.freeze({
                security_type: 'STK',
                region: 'TW',
                exchange: 'TSE',
                code: '2330',
                target_code: null,
            }),
        ],
    });
    const positions = await requestJson(
        fetchImpl,
        '/api/v1/portfolio/position_unit',
        { body: positionRequest, beforeRequest },
    );
    const trades = await requestJson(fetchImpl, '/api/v1/order/trades', {
        body: account,
        beforeRequest,
    });
    canonicalizeShioajiRefreshedStockTrades(trades);
    const contract = parseSmartOrderCanonicalStockContractMetadata(
        await requestJson(
            fetchImpl,
            '/api/v1/data/contracts/2330/info?security_type=STK&region=TW',
            { beforeRequest },
        ),
        { requestedCode: '2330', expectedExchange: 'TSE' },
    );
    const quote = parseSnapshot(
        await requestJson(fetchImpl, '/api/v1/data/snapshots', {
            body: snapshotRequest,
            beforeRequest,
        }),
        now(),
        DEFAULT_CONTRACT_SCOPE,
        MAX_ADJACENT_SNAPSHOT_AGE_MS,
    );
    const modeAfter = await readPrivateToken(modePath, /^simulation$/, 'runtime mode');
    const generationAfter = await readPrivateToken(
        generationPath,
        /^simulation:[A-Za-z0-9._:-]{1,240}$/,
        'runtime generation',
    );
    const sourceAfter = await currentTaskProbeWriteSourceFingerprint();
    const completedAtEpochMs = now();
    const positionsSha256 = sha256(stableJson(positions));
    const workingOrdersSha256 = sha256(stableJson(trades));
    const contractEvidenceSha256 = sha256(stableJson(contract));
    if (modeAfter !== modeBefore || generationAfter !== generationBefore) {
        throw new Error('task probe adjacent mode or generation drifted');
    }
    if (sourceAfter !== sourceBefore) {
        throw new Error('task probe adjacent source fingerprint drifted');
    }
    if (completedAtEpochMs - startedAtEpochMs > MAX_ADJACENT_REVALIDATION_MS) {
        throw new Error('task probe adjacent revalidation exceeded its bound');
    }
    if (readiness.validUntilEpochMs <= completedAtEpochMs) {
        throw new Error('task probe adjacent authorization evidence expired');
    }
    if (positionsSha256 !== priorProjection.positionsSha256) {
        throw new Error('task probe adjacent positions drifted');
    }
    if (workingOrdersSha256 !== priorProjection.workingOrdersSha256) {
        throw new Error('task probe adjacent working orders drifted');
    }
    if (
        contractEvidenceSha256 !== priorProjection.contract.evidenceSha256 ||
        contract.updateDate !== priorProjection.tradeDate
    ) {
        throw new Error('task probe adjacent contract drifted');
    }
    if (
        quote.tradeDate !== priorProjection.tradeDate ||
        quote.exchangeTimeEpochMs < priorProjection.quote.exchangeTimeEpochMs
    ) {
        throw new Error('task probe adjacent trusted market time drifted');
    }
    const validUntilEpochMs = Math.min(
        readiness.validUntilEpochMs,
        completedAtEpochMs + 5_000,
    );
    const authority = Object.freeze({});
    issuedAuthorities.set(
        authority,
        Object.freeze({ account, positions, trades, contract, quote }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_PROBE_READONLY_PREFLIGHT_SCHEMA_VERSION,
        authority,
        projection: Object.freeze({
            ...priorProjection,
            positionsSha256,
            workingOrdersSha256,
            contract: Object.freeze({
                ...priorProjection.contract,
                observedAtEpochMs: completedAtEpochMs,
                validUntilEpochMs,
                evidenceSha256: contractEvidenceSha256,
            }),
            quote: Object.freeze({
                ...quote,
                observedAtEpochMs: completedAtEpochMs,
                validUntilEpochMs,
                evidenceSha256: sha256(stableJson(quote)),
            }),
            authorizationDisplayAllowed: false,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        }),
    });
}

export function consumeSmartOrderTaskProbeReadonlyAuthority(authority) {
    if (!authority || typeof authority !== 'object' || !issuedAuthorities.has(authority)) {
        throw new Error('task probe readonly authority is missing or consumed');
    }
    const value = issuedAuthorities.get(authority);
    issuedAuthorities.delete(authority);
    return value;
}
