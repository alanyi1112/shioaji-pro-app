import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import { smartOrderGateProbeAccountScopeSha256 } from './gate-probe-safety-envelope.mjs';
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';
import { readOrCreateSmartOrderTask13_2EvidenceCapability } from './task13-2-evidence-capability.mjs';
import { SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_UPDATE_TRUST } from './task13-2-completed-evidence-trust.mjs';
import {
    SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
    createSmartOrderTask13_2FormalEvidence,
    currentSmartOrderTask13_2EvidenceSourceFingerprint,
    currentSmartOrderTask13_2VerifierFingerprint,
    verifySmartOrderTask13_2FormalEvidence,
} from './task13-2-formal-evidence.mjs';
import { currentTaskProbeWriteSourceFingerprint, writeTaskProbeWritePreflightEvidence } from './task-probe-write-preflight.mjs';
import { advanceSmartOrderTask03bTargetRevision } from './task0-3b-target-lineage.mjs';

export const SMART_ORDER_TASK_0_3B_UPDATE_RECONCILIATION_SCHEMA_VERSION =
    'smart-order-task-0.3b-update-reconciliation/2026-08-25.1';

const BASE_URL = 'http://127.0.0.1:8080';
const MAX_BYTES = 64 * 1024;
const WORKING = new Set(['PendingSubmit', 'PreSubmitted', 'Submitted']);

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableBrokerJson(value, seen = new WeakSet()) {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Task 0.3b broker JSON number is invalid');
        }
        return JSON.stringify(value);
    }
    if (!value || typeof value !== 'object' || seen.has(value)) {
        throw new TypeError('Task 0.3b broker JSON value is invalid');
    }
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value
                .map((entry) => stableBrokerJson(entry, seen))
                .join(',')}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError('Task 0.3b broker JSON object is invalid');
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors);
        if (
            keys.some(
                (key) =>
                    typeof key !== 'string' ||
                    descriptors[key]?.enumerable !== true ||
                    !Object.hasOwn(descriptors[key], 'value'),
            )
        ) {
            throw new TypeError('Task 0.3b broker JSON property is invalid');
        }
        keys.sort();
        return `{${keys
            .map(
                (key) =>
                    `${JSON.stringify(key)}:${stableBrokerJson(
                        descriptors[key].value,
                        seen,
                    )}`,
            )
            .join(',')}}`;
    } finally {
        seen.delete(value);
    }
}

function hmac(capability, value) {
    return `sha256:${createHmac('sha256', capability)
        .update(canonicalJson(value))
        .digest('hex')}`;
}

function epochMs(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${label} is invalid`);
    }
    const result =
        value > 1e14
            ? Math.trunc(value / 1e6)
            : value > 1e11
              ? Math.trunc(value)
              : Math.trunc(value * 1_000);
    if (!Number.isSafeInteger(result) || result < 1) {
        throw new TypeError(`${label} is outside the supported range`);
    }
    return result;
}

async function readStablePrivateJson(filePath, expectedSha256) {
    let handle;
    try {
        handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.uid !== process.getuid() ||
            (before.mode & 0o777) !== 0o600 ||
            before.size < 2 ||
            before.size > MAX_BYTES
        ) {
            throw new Error('Task 0.3b reconciliation artifact is not private');
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        const current = await lstat(filePath);
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            current.isSymbolicLink() ||
            current.dev !== before.dev ||
            current.ino !== before.ino ||
            sha256(bytes) !== expectedSha256
        ) {
            throw new Error('Task 0.3b reconciliation artifact drifted');
        }
        return JSON.parse(bytes.toString('utf8'));
    } finally {
        await handle?.close();
    }
}

async function readStablePrivateToken(filePath, pattern, label) {
    let handle;
    try {
        handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const before = await handle.stat();
        if (
            !before.isFile() ||
            before.uid !== process.getuid() ||
            (before.mode & 0o777) !== 0o600 ||
            before.size < 1 ||
            before.size > 512
        ) {
            throw new Error(`${label} is not private`);
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
            throw new Error(`${label} drifted`);
        }
        return value;
    } finally {
        await handle?.close();
    }
}

async function requestJson(fetchImpl, pathname, body) {
    const url = `${BASE_URL}${pathname}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await Reflect.apply(fetchImpl, globalThis, [url, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                accept: 'application/json',
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
        }]);
        if (!response || response.url !== url || response.redirected || !response.ok) {
            throw new Error('Task 0.3b reconciliation read failed');
        }
        const contentType = String(response.headers?.get?.('content-type') ?? '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
        if (contentType !== 'application/json') {
            throw new Error('Task 0.3b reconciliation response type is invalid');
        }
        const text = await response.text();
        if (Buffer.byteLength(text) > 2 * 1024 * 1024) {
            throw new Error('Task 0.3b reconciliation response is oversized');
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

function fixedStockAccount(accounts) {
    if (!Array.isArray(accounts) || accounts.length > 64) {
        throw new Error('Task 0.3b reconciliation accounts are invalid');
    }
    const candidates = accounts
        .filter((value) => value?.signed === true && value?.account_type === 'S')
        .map((value) => ({
            broker_id: value.broker_id,
            account_id: value.account_id,
            account_type: 'S',
        }));
    if (
        candidates.length < 1 ||
        candidates.some(
            (value) =>
                typeof value.broker_id !== 'string' ||
                value.broker_id.length < 1 ||
                typeof value.account_id !== 'string' ||
                value.account_id.length < 1,
        )
    ) {
        throw new Error('Task 0.3b fixed stock account is unavailable');
    }
    candidates.sort((left, right) =>
        `${left.broker_id}\u001f${left.account_id}`.localeCompare(
            `${right.broker_id}\u001f${right.account_id}`,
        ),
    );
    if (
        candidates.length > 1 &&
        candidates[0].broker_id === candidates[1].broker_id &&
        candidates[0].account_id === candidates[1].account_id
    ) {
        throw new Error('Task 0.3b fixed stock account is ambiguous');
    }
    return Object.freeze(candidates[0]);
}

export function verifySmartOrderTask03bHistoricalUpdateLineage({
    trust,
    priorTarget,
    preflight,
    dispatch,
    result,
    laterPreflight,
    laterDispatch,
    laterResult,
}) {
    if (
        trust.evidenceKey !== '0.3b:update_confirmed' ||
        priorTarget.originRunId !== trust.runId ||
        priorTarget.targetIdSha256 !== trust.targetIdSha256 ||
        priorTarget.accountScopeSha256 !== trust.accountScopeSha256 ||
        priorTarget.tradeDate !== trust.tradeDate ||
        priorTarget.revision !== trust.priorRevision ||
        priorTarget.priceMinorUnits !== trust.priorPriceMinorUnits ||
        preflight.coordinationId !== trust.coordinationId ||
        preflight.runId !== trust.runId ||
        preflight.operation !== 'update_price' ||
        preflight.requestSha256 !== trust.requestSha256 ||
        preflight.accountScopeSha256 !== trust.accountScopeSha256 ||
        preflight.apiGenerationSha256 !== trust.apiGenerationSha256 ||
        preflight.sourceFingerprintSha256 !== trust.sourceFingerprintSha256 ||
        preflight.targetIdSha256 !== trust.targetIdSha256 ||
        preflight.targetRevision !== trust.priorRevision ||
        preflight.tradeDate !== trust.tradeDate ||
        preflight.createdAtEpochMs > trust.brokerModifiedEpochMs ||
        preflight.validUntilEpochMs < trust.brokerModifiedEpochMs ||
        dispatch.coordinationId !== trust.coordinationId ||
        dispatch.requestSha256 !== trust.requestSha256 ||
        dispatch.state !== 'dispatching_unknown_no_retry' ||
        result.coordinationId !== trust.coordinationId ||
        result.state !== 'unknown_manual_reconciliation_required' ||
        laterPreflight.coordinationId !== trust.laterNoEffectCoordinationId ||
        laterPreflight.requestSha256 !== trust.requestSha256 ||
        laterPreflight.targetIdSha256 !== trust.targetIdSha256 ||
        laterPreflight.targetRevision !== trust.priorRevision ||
        laterPreflight.createdAtEpochMs <= trust.brokerModifiedEpochMs ||
        laterDispatch.coordinationId !== trust.laterNoEffectCoordinationId ||
        laterDispatch.requestSha256 !== trust.requestSha256 ||
        laterDispatch.state !== 'dispatching_unknown_no_retry' ||
        laterResult.coordinationId !== trust.laterNoEffectCoordinationId ||
        laterResult.state !== 'unknown_manual_reconciliation_required' ||
        [preflight, dispatch, result, laterPreflight, laterDispatch, laterResult].some(
            (value) =>
                value.automaticRetryAllowed !== false ||
                value.blindCleanupAllowed !== false,
        ) ||
        [dispatch, result, laterDispatch, laterResult].some(
            (value) =>
                value.brokerWriteAttempted !== true ||
                value.brokerWriteNetworked !== true,
        ) ||
        [preflight, laterPreflight].some(
            (value) =>
                value.brokerWriteAttempted !== false ||
                value.brokerWriteNetworked !== false,
        )
    ) {
        throw new Error('Task 0.3b historical update lineage is not trusted');
    }
    return Object.freeze({ trusted: true, brokerAuthority: false });
}

export function reconcileSmartOrderTask03bUpdatedTrade({
    account,
    priorTarget,
    trades,
    trust,
}) {
    const canonical = canonicalizeShioajiRefreshedStockTrades(trades);
    const matches = trades.filter(
        (value) =>
            value?.contract?.exchange === 'TSE' &&
            value?.contract?.code === '2330' &&
            value?.contract?.security_type === 'STK' &&
            value?.order?.account?.broker_id === account.broker_id &&
            value?.order?.account?.account_id === account.account_id &&
            value?.order?.account?.account_type === 'S' &&
            value?.order?.id === priorTarget.tradeId &&
            value?.status?.id === priorTarget.orderId &&
            value?.order?.seqno === priorTarget.seqno &&
            value?.order?.ordno === priorTarget.ordno &&
            value?.order?.custom_field === priorTarget.customField,
    );
    if (matches.length !== 1) {
        throw new Error('Task 0.3b updated target is missing or ambiguous');
    }
    const raw = matches[0];
    const modifiedEpochMs = epochMs(
        raw.status?.modified_ts,
        'Task 0.3b status.modified_ts',
    );
    if (
        smartOrderGateProbeAccountScopeSha256(account) !== trust.accountScopeSha256 ||
        Number(raw.order?.price) * 100 !== trust.priorPriceMinorUnits ||
        Number(raw.status?.modified_price) * 100 !== trust.nextPriceMinorUnits ||
        modifiedEpochMs !== trust.brokerModifiedEpochMs ||
        !WORKING.has(raw.status?.status) ||
        raw.status?.deal_quantity !== 0 ||
        raw.status?.cancel_quantity !== 0 ||
        canonical.length !== trades.length
    ) {
        throw new Error('Task 0.3b broker update evidence drifted');
    }
    const next = advanceSmartOrderTask03bTargetRevision({
        account,
        expectedPriceDecimal: String(trust.nextPriceMinorUnits / 100),
        previousTarget: priorTarget,
        refreshedTrades: trades,
    });
    if (
        next.privateTarget.targetIdSha256 !== trust.targetIdSha256 ||
        next.privateTarget.revision !== trust.nextRevision ||
        next.privateTarget.priceMinorUnits !== trust.nextPriceMinorUnits
    ) {
        throw new Error('Task 0.3b reconciled revision is invalid');
    }
    return Object.freeze({ next, modifiedEpochMs, brokerAuthority: false });
}

async function writeExclusiveOrCompare(filePath, value) {
    try {
        await writeTaskProbeWritePreflightEvidence({ evidencePath: filePath, evidence: value });
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await readStablePrivateJson(filePath, sha256(`${JSON.stringify(value)}\n`));
        if (canonicalJson(existing) !== canonicalJson(value)) {
            throw new Error('Task 0.3b reconciliation output already differs');
        }
    }
}

export async function reconcileSmartOrderTask03bHistoricalUpdate({
    appSupportRoot,
    expectedApiGeneration,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    verifyOnly = false,
} = {}) {
    if (
        typeof appSupportRoot !== 'string' ||
        !path.isAbsolute(appSupportRoot) ||
        (await realpath(appSupportRoot)) !== appSupportRoot ||
        typeof expectedApiGeneration !== 'string' ||
        !/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(expectedApiGeneration) ||
        typeof fetchImpl !== 'function' ||
        typeof now !== 'function' ||
        typeof verifyOnly !== 'boolean'
    ) {
        throw new TypeError('Task 0.3b update reconciliation input is invalid');
    }
    const trust = SMART_ORDER_TASK_13_2_COMPLETED_TASK_0_3B_UPDATE_TRUST;
    const privateDirectory = await realpath(
        path.join(appSupportRoot, 'smart-order', 'private'),
    );
    const modePath = path.join(appSupportRoot, 'runtime-mode');
    const generationPath = path.join(appSupportRoot, 'runtime-api-generation');
    const modeBefore = await readStablePrivateToken(modePath, /^simulation$/, 'runtime mode');
    const generationBefore = await readStablePrivateToken(
        generationPath,
        /^simulation:[A-Za-z0-9._:-]{1,240}$/,
        'runtime generation',
    );
    if (
        modeBefore !== 'simulation' ||
        generationBefore !== expectedApiGeneration
    ) {
        throw new Error(
            `Task 0.3b update reconciliation generation drifted (${JSON.stringify({
                mode: modeBefore,
                currentGenerationRef: sha256(generationBefore).slice(0, 19),
                expectedGenerationRef: sha256(expectedApiGeneration).slice(0, 19),
            })})`,
        );
    }
    const reconciliationApiGenerationSha256 = sha256(expectedApiGeneration);
    const artifact = trust.artifactSha256;
    const first = trust.coordinationId;
    const later = trust.laterNoEffectCoordinationId;
    const [priorTarget, preflight, dispatch, result, laterPreflight, laterDispatch, laterResult] =
        await Promise.all([
            readStablePrivateJson(
                path.join(privateDirectory, `task0-3b-target-${trust.runId}-r0.json`),
                artifact.priorTarget,
            ),
            readStablePrivateJson(
                path.join(privateDirectory, `task0-3b-preflight-${first}.json`),
                artifact.preflight,
            ),
            readStablePrivateJson(
                path.join(privateDirectory, `task0-3b-dispatch-${first}.json`),
                artifact.dispatch,
            ),
            readStablePrivateJson(
                path.join(privateDirectory, `task0-3b-result-${first}.json`),
                artifact.result,
            ),
            readStablePrivateJson(
                path.join(privateDirectory, `task0-3b-preflight-${later}.json`),
                artifact.laterPreflight,
            ),
            readStablePrivateJson(
                path.join(privateDirectory, `task0-3b-dispatch-${later}.json`),
                artifact.laterDispatch,
            ),
            readStablePrivateJson(
                path.join(privateDirectory, `task0-3b-result-${later}.json`),
                artifact.laterResult,
            ),
        ]);
    verifySmartOrderTask03bHistoricalUpdateLineage({
        trust,
        priorTarget,
        preflight,
        dispatch,
        result,
        laterPreflight,
        laterDispatch,
        laterResult,
    });
    const sourceBefore = await currentTaskProbeWriteSourceFingerprint();
    const verifierBefore = await currentSmartOrderTask13_2VerifierFingerprint();
    const infoBefore = await requestJson(fetchImpl, '/api/v1/info');
    if (infoBefore?.simulation !== true) {
        throw new Error('Task 0.3b update reconciliation API is not simulation');
    }
    const account = fixedStockAccount(
        await requestJson(fetchImpl, '/api/v1/auth/accounts'),
    );
    const tradesBefore = await requestJson(
        fetchImpl,
        '/api/v1/order/trades',
        account,
    );
    const tradesAfter = await requestJson(
        fetchImpl,
        '/api/v1/order/trades',
        account,
    );
    if (stableBrokerJson(tradesBefore) !== stableBrokerJson(tradesAfter)) {
        throw new Error('Task 0.3b update reconciliation trades drifted');
    }
    const reconciled = reconcileSmartOrderTask03bUpdatedTrade({
        account,
        priorTarget,
        trades: tradesAfter,
        trust,
    });
    const [modeAfter, generationAfter, sourceAfter, verifierAfter, infoAfter] =
        await Promise.all([
            readStablePrivateToken(modePath, /^simulation$/, 'runtime mode'),
            readStablePrivateToken(
                generationPath,
                /^simulation:[A-Za-z0-9._:-]{1,240}$/,
                'runtime generation',
            ),
            currentTaskProbeWriteSourceFingerprint(),
            currentSmartOrderTask13_2VerifierFingerprint(),
            requestJson(fetchImpl, '/api/v1/info'),
        ]);
    if (
        modeAfter !== modeBefore ||
        generationAfter !== generationBefore ||
        sourceAfter !== sourceBefore ||
        verifierAfter !== verifierBefore ||
        infoAfter?.simulation !== true
    ) {
        throw new Error('Task 0.3b update reconciliation authority drifted');
    }
    if (verifyOnly) {
        return Object.freeze({
            schemaVersion: SMART_ORDER_TASK_0_3B_UPDATE_RECONCILIATION_SCHEMA_VERSION,
            state: 'update_reconciliation_verified_readonly',
            operation: 'update_price',
            runId: trust.runId,
            accountRef: `…${trust.accountScopeSha256.slice(-12)}`,
            targetRef: `…${trust.targetIdSha256.slice(-12)}`,
            revision: trust.nextRevision,
            price: String(trust.nextPriceMinorUnits / 100),
            brokerModifiedEpochMs: reconciled.modifiedEpochMs,
            operationApiGenerationSha256: trust.apiGenerationSha256,
            reconciliationApiGenerationSha256,
            historicalSourceFingerprintSha256: trust.sourceFingerprintSha256,
            currentSourceFingerprintSha256: sourceAfter,
            formalEvidenceEligible: false,
            evidenceWriteAttempted: false,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
    }
    const capability =
        await readOrCreateSmartOrderTask13_2EvidenceCapability(privateDirectory);
    try {
        const generatedAtEpochMs = now();
        const reconciliationContent = Object.freeze({
            schemaVersion: SMART_ORDER_TASK_0_3B_UPDATE_RECONCILIATION_SCHEMA_VERSION,
            evidenceKey: trust.evidenceKey,
            coordinationId: trust.coordinationId,
            laterNoEffectCoordinationId: trust.laterNoEffectCoordinationId,
            runId: trust.runId,
            tradeDate: trust.tradeDate,
            accountScopeSha256: trust.accountScopeSha256,
            operationApiGenerationSha256: trust.apiGenerationSha256,
            reconciliationApiGenerationSha256,
            historicalSourceFingerprintSha256: trust.sourceFingerprintSha256,
            sourceFingerprintSha256: sourceAfter,
            verifierFingerprintSha256: verifierAfter,
            requestSha256: trust.requestSha256,
            targetIdSha256: trust.targetIdSha256,
            priorRevision: trust.priorRevision,
            nextRevision: trust.nextRevision,
            priorPriceMinorUnits: trust.priorPriceMinorUnits,
            nextPriceMinorUnits: trust.nextPriceMinorUnits,
            brokerModifiedEpochMs: trust.brokerModifiedEpochMs,
            generatedAtEpochMs,
            artifactSha256: trust.artifactSha256,
            targetRevisionSha256: reconciled.next.privateTarget.targetRevision,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            accountIdentifiersPersisted: false,
        });
        const resultHash = sha256(canonicalJson(reconciliationContent));
        const signedReconciliation = Object.freeze({
            ...reconciliationContent,
            resultHash,
            evidenceHmacSha256: hmac(capability, {
                ...reconciliationContent,
                resultHash,
            }),
        });
        const expectedHmac = Buffer.from(
            hmac(capability, { ...reconciliationContent, resultHash }),
            'utf8',
        );
        const actualHmac = Buffer.from(
            signedReconciliation.evidenceHmacSha256,
            'utf8',
        );
        const authentic =
            actualHmac.byteLength === expectedHmac.byteLength &&
            timingSafeEqual(actualHmac, expectedHmac);
        expectedHmac.fill(0);
        actualHmac.fill(0);
        if (!authentic) {
            throw new Error('Task 0.3b update reconciliation signature failed');
        }
        const formal = createSmartOrderTask13_2FormalEvidence({
            capability,
            input: {
                schemaVersion: SMART_ORDER_TASK_13_2_FORMAL_EVIDENCE_SCHEMA_VERSION,
                evidenceId: trust.coordinationId,
                taskId: '0.3b',
                operationKey: 'update_confirmed',
                runId: trust.runId,
                observedTradeDate: trust.tradeDate,
                accountScopeSha256: trust.accountScopeSha256,
                apiGenerationSha256: trust.apiGenerationSha256,
                sourceFingerprintSha256: sourceAfter,
                verifierFingerprintSha256: verifierAfter,
                requestSha256: trust.requestSha256,
                resultSha256: resultHash,
                targetIdSha256: trust.targetIdSha256,
                quantityCommonLots: 1,
                generatedAtEpochMs: trust.brokerModifiedEpochMs,
                validUntilEpochMs: null,
                formalEvidence: true,
                fixture: false,
                brokerWriteAttempted: true,
                brokerWriteNetworked: true,
                automaticRetryAllowed: false,
                blindCleanupAllowed: false,
                accountIdentifiersPersisted: false,
            },
        });
        const verifiedFormal = verifySmartOrderTask13_2FormalEvidence({
            capability,
            evidence: formal,
            expectedSourceFingerprintSha256: sourceAfter,
            expectedVerifierFingerprintSha256: verifierAfter,
        });
        if (!verifiedFormal.eligible) {
            throw new Error('Task 0.3b update formal evidence failed verification');
        }
        await writeExclusiveOrCompare(
            path.join(privateDirectory, `task0-3b-target-${trust.runId}-r1.json`),
            reconciled.next.privateTarget,
        );
        await writeExclusiveOrCompare(
            path.join(
                privateDirectory,
                `task0-3b-update-reconciliation-${trust.coordinationId}.json`,
            ),
            signedReconciliation,
        );
        await writeExclusiveOrCompare(
            path.join(privateDirectory, 'task13-2-formal-0.3b-update-confirmed.json'),
            formal,
        );
        return Object.freeze({
            schemaVersion: SMART_ORDER_TASK_0_3B_UPDATE_RECONCILIATION_SCHEMA_VERSION,
            state: 'update_confirmed_next_revision',
            operation: 'update_price',
            runId: trust.runId,
            accountRef: `…${trust.accountScopeSha256.slice(-12)}`,
            targetRef: `…${trust.targetIdSha256.slice(-12)}`,
            revision: trust.nextRevision,
            price: String(trust.nextPriceMinorUnits / 100),
            resultEvidenceSha256: resultHash,
            formalEvidenceEligible: true,
            formalEvidenceHashSha256: formal.evidenceHashSha256,
            automaticRetryAllowed: false,
            blindCleanupAllowed: false,
            brokerWriteAttempted: false,
            brokerWriteNetworked: false,
            brokerAuthority: false,
        });
    } finally {
        capability.fill(0);
    }
}
