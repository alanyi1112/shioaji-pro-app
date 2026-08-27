import { createHash, randomUUID } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { createSmartOrderTradeSubscriptionCoordinator } from './trade-subscription-coordinator.mjs';
import { createSmartOrderTradeSubscriptionTransportAuthority } from './trade-subscription-verifier-authority.mjs';
import {
    SMART_ORDER_QUICK_FIELD_NORMALIZER_SCHEMA_VERSION,
    normalizeSmartOrderQuickFieldEvent,
} from './quick-field-normalizer.mjs';
import { isIssuedSmartOrderResourceCoordinator } from './resource-coordinator.mjs';
import {
    SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
    SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
} from './quick-field-mapping.mjs';
import {
    SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION,
    mapShioajiStockBrokerEvent,
} from './shioaji-broker-event-mapper.mjs';
import { assertSmartOrderShioajiTradeObserverRuntimeAuthority } from './shioaji-trade-observer-runtime-authority.mjs';
import {
    canonicalSmartOrderAccountReconciliationSnapshot,
    createSmartOrderAccountReconciliationCoordinator,
} from './account-reconciliation-coordinator.mjs';
import { createSmartOrderAccountReconciliationTransportAuthority } from './account-reconciliation-verifier-authority.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './canonical-pnl-policy.mjs';
import { createRuntimeFixedWilderAtrSnapshot } from './fixed-wilder-atr-runtime.mjs';
import {
    assertSmartOrderCanonicalContractUpdateDateCurrent,
    parseSmartOrderCanonicalStockContractMetadata,
    smartOrderCommonLotsToShares,
} from './canonical-stock-unit-contract.mjs';

export const SMART_ORDER_CANONICAL_PRINCIPAL_MAPPING_REVISION =
    'smart-order-canonical-principal-mapping/2026-08-13.1';

const VERIFIED_CANONICAL_PRINCIPAL_EVIDENCE = new WeakSet();
const VERIFIED_CANONICAL_CONTRACT_EVIDENCE = new WeakSet();
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export const SMART_ORDER_SHIOAJI_TRADE_OBSERVER_SCHEMA_VERSION =
    'smart-order-shioaji-trade-observer/2026-08-22.1';
export const SMART_ORDER_CANONICAL_CONTRACT_EVIDENCE_SCHEMA_VERSION =
    'smart-order-canonical-contract-evidence/2026-08-21.2';

const BASE_URL = 'http://127.0.0.1:8080';
const ENDPOINTS = Object.freeze({
    accounts: '/api/v1/auth/accounts',
    info: '/api/v1/info',
    marketStream: '/api/v1/stream/data',
    orderStream: '/api/v1/stream/data/order_event',
    positions: '/api/v1/portfolio/position_unit',
    subscribeQuote: '/api/v1/stream/subscribe',
    subscribeTrade: '/api/v1/auth/subscribe_trade',
    trades: '/api/v1/order/trades',
    unsubscribeQuote: '/api/v1/stream/unsubscribe',
    kbars: '/api/v1/data/kbars',
});
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_SSE_EVENT_BYTES = 64 * 1024;
const MAX_ACCOUNTS = 32;
const MAX_RECONCILIATION_CONTRACTS = 256;
const MAX_RECONNECT_ATTEMPTS = 3;
const SSE_HEARTBEAT_TIMEOUT_MS = 30_000;
const ACCOUNT_RECONCILIATION_INTERVAL_MS = 15_000;
const ACCOUNT_RECONCILIATION_ACCOUNT_SPACING_MS = 1_000;
const ACCOUNT_RECONCILIATION_MAX_SNAPSHOT_AGE_MS = 5_000;
const RECONNECT_DELAYS_MS = Object.freeze([1_000, 2_000]);
const FIXED_ATR_COMMON_OPERATION_LIMIT_PER_SECOND = 5;
const fixedAtrReadAuthority = {
    inFlight: false,
    dispatchTimes: [],
    lastMonotonicMs: -1,
};

function acquireFixedAtrReadAuthority(nowMonotonicMs) {
    const now = nowMonotonicMs();
    if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < fixedAtrReadAuthority.lastMonotonicMs
    ) {
        throw new Error('fixed ATR resource clock is invalid');
    }
    fixedAtrReadAuthority.lastMonotonicMs = now;
    const cutoff = now - 1_000;
    while (
        fixedAtrReadAuthority.dispatchTimes.length > 0 &&
        fixedAtrReadAuthority.dispatchTimes[0] < cutoff
    ) {
        fixedAtrReadAuthority.dispatchTimes.shift();
    }
    if (
        fixedAtrReadAuthority.inFlight ||
        fixedAtrReadAuthority.dispatchTimes.length >=
            FIXED_ATR_COMMON_OPERATION_LIMIT_PER_SECOND
    ) {
        throw new Error('fixed ATR historical read is resource blocked');
    }
    fixedAtrReadAuthority.inFlight = true;
    fixedAtrReadAuthority.dispatchTimes.push(now);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        fixedAtrReadAuthority.inFlight = false;
    };
}

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function exactOptions(value) {
    const keys = [
        'apiGeneration',
        'cancelRetry',
        'fetchImpl',
        'nowEpochMs',
        'nowMonotonicMs',
        'quoteSubscriptionCoordinator',
        'resourceCoordinator',
        'reportRuntimeGapLifecycle',
        'runtimeController',
        'runtimeEpochId',
        'scheduleRetry',
    ];
    if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) {
        throw new TypeError('Shioaji trade observer options are invalid');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
        Reflect.ownKeys(descriptors).length !== keys.length ||
        !keys.every((key) => {
            const descriptor = descriptors[key];
            return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
        })
    ) {
        throw new TypeError('Shioaji trade observer options are not exact data properties');
    }
    return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}

function quoteCoordinatorCapability(value) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value) ||
        !Object.isFrozen(value)
    ) {
        throw new TypeError(
            'quoteSubscriptionCoordinator must be a frozen object capability',
        );
    }
    const root = dataProperties(
        value,
        ['browser', 'observer', 'runtime'],
        'quoteSubscriptionCoordinator',
    );
    const observer = dataProperties(
        root.observer,
        ['getSubscriptionStatus', 'pendingPlans', 'status'],
        'quoteSubscriptionCoordinator.observer',
    );
    const runtime = dataProperties(
        root.runtime,
        [
            'acquireDemand',
            'close',
            'confirmPlan',
            'markDisconnected',
            'recordMappedObservation',
            'recordObservation',
            'releaseDemand',
            'replaceConnection',
            'reportPlanFailure',
            'retryPlan',
            'retryResourceAdmission',
        ],
        'quoteSubscriptionCoordinator.runtime',
    );
    for (const [name, fn] of Object.entries({ ...observer, ...runtime })) {
        if (typeof fn !== 'function' || isProxy(fn)) {
            throw new TypeError(
                `quoteSubscriptionCoordinator.${name} must be a non-Proxy method`,
            );
        }
    }
    return Object.freeze({
        observer: Object.freeze({
            receiver: root.observer,
            pendingPlans: observer.pendingPlans,
            status: observer.status,
        }),
        runtime: Object.freeze({
            receiver: root.runtime,
            acquireDemand: runtime.acquireDemand,
            confirmPlan: runtime.confirmPlan,
            markDisconnected: runtime.markDisconnected,
            recordMappedObservation: runtime.recordMappedObservation,
            recordObservation: runtime.recordObservation,
            releaseDemand: runtime.releaseDemand,
            replaceConnection: runtime.replaceConnection,
            reportPlanFailure: runtime.reportPlanFailure,
        }),
    });
}

function token(value, label, maximum = 240) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > maximum ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function offsetTradingDate(value, days, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new TypeError(`${label} must be YYYY-MM-DD`);
    }
    const [year, month, day] = value.split('-').map(Number);
    const timestamp = Date.UTC(year, month - 1, day);
    const canonical = new Date(timestamp).toISOString().slice(0, 10);
    if (canonical !== value) throw new TypeError(`${label} is invalid`);
    return new Date(timestamp + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
}

function dataProperties(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} must be a non-Proxy object`);
    }
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} could not be inspected safely`);
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            throw new TypeError(`${label}.${key} must be an own data property`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function isVerifiedSmartOrderCanonicalContractEvidence(value) {
    return Boolean(
        value && VERIFIED_CANONICAL_CONTRACT_EVIDENCE.has(value),
    );
}

function draftStockContract(value, label = 'contractKey') {
    const contractKey = token(value, label);
    const match = contractKey.match(
        /^(TSE|OTC):STK:([A-Za-z0-9][A-Za-z0-9._-]{0,31})$/,
    );
    if (!match) {
        throw new TypeError(`${label} must be a canonical TSE/OTC stock contract`);
    }
    return Object.freeze({
        draftContractKey: contractKey,
        exchange: match[1],
        code: match[2],
        runtimeContractKey: `${match[1]}:${match[2]}:STK:Common`,
    });
}

function issueCanonicalContractEvidence({
    account,
    apiGeneration,
    contract,
    gate,
    response,
    runtimeEpochId,
    nowEpochMs,
    fixedAtrSource,
}) {
    const metadata = parseSmartOrderCanonicalStockContractMetadata(
        response,
        {
            requestedCode: contract.code,
            expectedExchange: contract.exchange,
        },
    );
    const observedAtEpochMs = safeNow(() => nowEpochMs, 'nowEpochMs');
    assertSmartOrderCanonicalContractUpdateDateCurrent(
        metadata,
        observedAtEpochMs,
    );
    const validUntilEpochMs = Math.min(
        observedAtEpochMs + 5_000,
        gate.validUntilEpochMs,
    );
    if (!Number.isSafeInteger(validUntilEpochMs) || validUntilEpochMs <= observedAtEpochMs) {
        throw new Error('contract evidence is already expired');
    }
    const contractProjection = Object.freeze({
        categoryCode: metadata.categoryCode,
        code: contract.code,
        contractUnit: metadata.contractUnit,
        draftContractKey: contract.draftContractKey,
        exchange: contract.exchange,
        limitDownMinorUnits: metadata.limitDownMinorUnits,
        limitUpMinorUnits: metadata.limitUpMinorUnits,
        referenceMinorUnits: metadata.referenceMinorUnits,
        runtimeContractKey: contract.runtimeContractKey,
        securityType: 'STK',
        updateDate: metadata.updateDate,
    });
    const accountScopeSha256 = sha256(
        `smart-order-confirmation-account\u001f${canonicalJson([
            account.brokerId,
            account.accountId,
            'S',
        ])}`,
    );
    const contractRevision = sha256(
        `smart-order-contract-revision\u001f${canonicalJson(contractProjection)}`,
    );
    const corporateActionRevision = sha256(
        `smart-order-corporate-action-revision\u001f${canonicalJson([
            contract.draftContractKey,
            metadata.updateDate,
            metadata.categoryCode,
            metadata.contractUnit,
        ])}`,
    );
    const fixedAtrSnapshot =
        fixedAtrSource === null
            ? null
            : createRuntimeFixedWilderAtrSnapshot({
                  contractKey: contractProjection.runtimeContractKey,
                  contractRevision,
                  corporateActionRevision,
                  decisionTradingDate:
                      fixedAtrSource.decisionTradingDate,
                  requestedEndDate: fixedAtrSource.requestedEndDate,
                  requestedStartDate: fixedAtrSource.requestedStartDate,
                  response: fixedAtrSource.response,
                  strategyDefinitionHash:
                      fixedAtrSource.strategyDefinitionHash,
              });
    const content = Object.freeze({
        schemaVersion: SMART_ORDER_CANONICAL_CONTRACT_EVIDENCE_SCHEMA_VERSION,
        accountScopeSha256,
        apiGeneration,
        contract: contractProjection,
        contractRevision,
        corporateActionRevision,
        fixedAtrSnapshot,
        gateManifestHash: gate.manifestSha256,
        gateManifestRevision: gate.manifestRevision,
        mappingRevision: gate.mappingRevision,
        observedAtEpochMs,
        runtimeEpochId,
        validUntilEpochMs,
    });
    const evidence = Object.freeze({
        ...content,
        evidenceSha256: sha256(canonicalJson(content)),
    });
    VERIFIED_CANONICAL_CONTRACT_EVIDENCE.add(evidence);
    return evidence;
}

function issueVerifiedCanonicalPrincipalEvidence({
    accountResponse,
    gateManifest,
    nowEpochMs,
}) {
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        throw new TypeError('canonical principal evidence time is invalid');
    }
    const gate = dataProperties(
        gateManifest,
        [
            'manifestRevision',
            'manifestSha256',
            'mappingRevision',
            'present',
            'state',
            'validUntilEpochMs',
        ],
        'gateManifest',
    );
    if (
        gate.present !== true ||
        gate.state !== 'eligible' ||
        !SHA256.test(gate.manifestSha256) ||
        !Number.isSafeInteger(gate.validUntilEpochMs) ||
        gate.validUntilEpochMs <= nowEpochMs
    ) {
        throw new Error(
            'current eligible Gate manifest is required for identity mapping',
        );
    }
    const gateMappingRevision = token(
        gate.mappingRevision,
        'gateManifest.mappingRevision',
    );
    const gateManifestRevision = token(
        gate.manifestRevision,
        'gateManifest.manifestRevision',
    );
    if (
        !Array.isArray(accountResponse) ||
        isProxy(accountResponse) ||
        accountResponse.length < 1 ||
        accountResponse.length > MAX_ACCOUNTS
    ) {
        throw new TypeError('broker account response is invalid');
    }
    const signedStockAccounts = accountResponse
        .map((candidate, index) =>
            dataProperties(
                candidate,
                [
                    'account_id',
                    'account_type',
                    'broker_id',
                    'person_id',
                    'signed',
                ],
                `accounts[${index}]`,
            ),
        )
        .filter(
            (candidate) =>
                candidate.signed === true && candidate.account_type === 'S',
        )
        .map((candidate) =>
            Object.freeze({
                accountBrokerRef: token(
                    candidate.broker_id,
                    'account.broker_id',
                    128,
                ),
                accountIdRef: token(
                    candidate.account_id,
                    'account.account_id',
                    128,
                ),
                canonicalPrincipal: token(
                    candidate.person_id,
                    'account.person_id',
                    256,
                ),
            }),
        );
    if (signedStockAccounts.length < 1) {
        throw new Error('signed stock accounts are unavailable');
    }
    const principals = new Set(
        signedStockAccounts.map((account) => account.canonicalPrincipal),
    );
    if (principals.size !== 1) {
        throw new Error(
            'signed stock accounts do not share one canonical principal',
        );
    }
    const canonicalPrincipal = signedStockAccounts[0].canonicalPrincipal;
    const accountScopes = signedStockAccounts
        .map(({ accountBrokerRef, accountIdRef }) =>
            Object.freeze({ accountBrokerRef, accountIdRef }),
        )
        .sort((left, right) =>
            canonicalJson(left).localeCompare(canonicalJson(right)),
        );
    const scopeKeys = accountScopes.map((scope) => canonicalJson(scope));
    if (new Set(scopeKeys).size !== scopeKeys.length) {
        throw new Error('signed stock account scopes are ambiguous');
    }
    const evidenceProjection = Object.freeze({
        schemaVersion: SMART_ORDER_CANONICAL_PRINCIPAL_MAPPING_REVISION,
        accountScopes,
        canonicalPrincipalSha256: sha256(canonicalPrincipal),
        gateManifestRevision,
        gateManifestSha256: gate.manifestSha256,
        gateMappingRevision,
    });
    const evidence = Object.freeze({
        accountScopes: Object.freeze(accountScopes),
        canonicalPrincipal,
        mappingRevision: SMART_ORDER_CANONICAL_PRINCIPAL_MAPPING_REVISION,
        principalEvidenceHash: sha256(canonicalJson(evidenceProjection)),
    });
    VERIFIED_CANONICAL_PRINCIPAL_EVIDENCE.add(evidence);
    return evidence;
}

export function isVerifiedSmartOrderCanonicalPrincipalEvidence(value) {
    return Boolean(
        value && VERIFIED_CANONICAL_PRINCIPAL_EVIDENCE.has(value),
    );
}

function safeNow(fn, label) {
    const value = Reflect.apply(fn, undefined, []);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} returned an invalid time`);
    }
    return value;
}

function digestExpectedEvent(event) {
    return {
        apiGeneration: event.apiGeneration,
        brokerEventKeySha256: event.brokerEventKeySha256,
        brokerEventEvidenceSha256: event.brokerEventEvidenceSha256,
        mappingRevision: event.mappingRevision,
        payloadSha256: event.payloadSha256,
    };
}

function accountBody(account) {
    return Object.freeze({
        broker_id: account.brokerId,
        account_id: account.accountId,
        account_type: account.accountType,
    });
}

function taipeiTradeDate(epochMs) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(epochMs));
}

function safeShare(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative Share integer`);
    }
    return value;
}

function minorUnits(value, label, { signed = false } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must be a finite amount`);
    }
    const projected = Math.round(value * 100);
    if (
        !Number.isSafeInteger(projected) ||
        (!signed && projected < 0) ||
        Math.abs(projected / 100 - value) > 1e-9
    ) {
        throw new TypeError(`${label} cannot be represented in minor units`);
    }
    return projected;
}

function exactAccountFromTrade(trade, account, label) {
    const candidate = dataProperties(
        trade.order?.account,
        ['account_id', 'account_type', 'broker_id'],
        `${label}.order.account`,
    );
    if (
        candidate.account_id !== account.accountId ||
        candidate.account_type !== 'S' ||
        candidate.broker_id !== account.brokerId
    ) {
        throw new Error(`${label} account scope mismatch`);
    }
}

function canonicalTradeContract(trade, label) {
    const contract = dataProperties(
        trade.contract,
        ['code', 'exchange', 'security_type'],
        `${label}.contract`,
    );
    if (
        !['TSE', 'OTC'].includes(contract.exchange) ||
        contract.security_type !== 'STK'
    ) {
        throw new Error(`${label} is outside the fixed stock contract scope`);
    }
    return Object.freeze({
        code: token(contract.code, `${label}.contract.code`, 32),
        contractKey: `${contract.exchange}:${contract.code}:STK:Common`,
    });
}

function boundedReconciliationResponses({
    positionsResponse,
    tradesResponse,
    updateStatusResponse,
}) {
    if (
        !Array.isArray(updateStatusResponse) ||
        !Array.isArray(tradesResponse) ||
        !Array.isArray(positionsResponse) ||
        isProxy(updateStatusResponse) ||
        isProxy(tradesResponse) ||
        isProxy(positionsResponse) ||
        updateStatusResponse.length > 4096 ||
        tradesResponse.length > 4096 ||
        positionsResponse.length > 4096
    ) {
        throw new TypeError('bounded reconciliation responses are invalid');
    }
}

function reconciliationContractLookups({
    positionsResponse,
    tradesResponse,
    updateStatusResponse,
}) {
    boundedReconciliationResponses({
        positionsResponse,
        tradesResponse,
        updateStatusResponse,
    });
    const expectedExchangeByCode = new Map();
    for (const [collectionLabel, rows] of [
        ['updateStatus', updateStatusResponse],
        ['trades', tradesResponse],
    ]) {
        for (const [index, trade] of rows.entries()) {
            const contract = canonicalTradeContract(
                trade,
                `${collectionLabel}[${index}]`,
            );
            const exchange = contract.contractKey.split(':', 1)[0];
            const previous = expectedExchangeByCode.get(contract.code);
            if (previous !== undefined && previous !== exchange) {
                throw new Error(
                    'reconciliation contract code maps to multiple exchanges',
                );
            }
            expectedExchangeByCode.set(contract.code, exchange);
        }
    }
    for (const [index, rawPosition] of positionsResponse.entries()) {
        const position = dataProperties(
            rawPosition,
            ['code'],
            `positions[${index}]`,
        );
        const code = token(position.code, `positions[${index}].code`, 32);
        if (!expectedExchangeByCode.has(code)) {
            expectedExchangeByCode.set(code, null);
        }
    }
    if (expectedExchangeByCode.size > MAX_RECONCILIATION_CONTRACTS) {
        throw new Error('reconciliation contract set exceeds its safe bound');
    }
    return Object.freeze(
        [...expectedExchangeByCode]
            .map(([code, expectedExchange]) =>
                Object.freeze({ code, expectedExchange }),
            )
            .sort((left, right) => left.code.localeCompare(right.code)),
    );
}

function reconciliationContractMetadataProjection(contractMetadataByCode) {
    if (
        !(contractMetadataByCode instanceof Map) ||
        contractMetadataByCode.size > MAX_RECONCILIATION_CONTRACTS
    ) {
        throw new TypeError('reconciliation contract metadata is invalid');
    }
    return Object.freeze(
        [...contractMetadataByCode.values()]
            .map((metadata) =>
                Object.freeze({
                    categoryCode: metadata.categoryCode,
                    code: metadata.code,
                    contractKey: metadata.contractKey,
                    contractUnit: metadata.contractUnit,
                    limitDownMinorUnits: metadata.limitDownMinorUnits,
                    limitUpMinorUnits: metadata.limitUpMinorUnits,
                    referenceMinorUnits: metadata.referenceMinorUnits,
                    updateDate: metadata.updateDate,
                }),
            )
            .sort((left, right) => left.code.localeCompare(right.code)),
    );
}

function projectAccountReconciliationSnapshot({
    account,
    apiGeneration,
    completenessCapabilityVerified,
    connectionId,
    contractMetadataByCode,
    plan,
    positionsResponse,
    runtimeEpochId,
    tradesResponse,
    updateStatusResponse,
    nowEpochMs,
}) {
    boundedReconciliationResponses({
        positionsResponse,
        tradesResponse,
        updateStatusResponse,
    });
    if (
        !(contractMetadataByCode instanceof Map) ||
        contractMetadataByCode.size > MAX_RECONCILIATION_CONTRACTS
    ) {
        throw new TypeError('reconciliation contract metadata is invalid');
    }
    const tradeDate = taipeiTradeDate(nowEpochMs);
    const workingOrders = [];
    for (const [index, trade] of updateStatusResponse.entries()) {
        const label = `updateStatus[${index}]`;
        exactAccountFromTrade(trade, account, label);
        const contract = canonicalTradeContract(trade, label);
        const order = dataProperties(
            trade.order,
            ['account', 'action', 'id', 'order_lot', 'quantity'],
            `${label}.order`,
        );
        const status = dataProperties(
            trade.status,
            ['cancel_quantity', 'deal_quantity', 'order_quantity', 'status'],
            `${label}.status`,
        );
        if (
            !['Buy', 'Sell'].includes(order.action) ||
            order.order_lot !== 'Common' ||
            !['PendingSubmit', 'PreSubmitted', 'Submitted', 'PartFilled'].includes(
                status.status,
            )
        ) {
            continue;
        }
        const quantityLots = safeShare(
            status.order_quantity,
            `${label}.status.order_quantity`,
        );
        const requestedLots = safeShare(
            order.quantity,
            `${label}.order.quantity`,
        );
        const filledLots = safeShare(
            status.deal_quantity,
            `${label}.status.deal_quantity`,
        );
        const cancelledLots = safeShare(
            status.cancel_quantity,
            `${label}.status.cancel_quantity`,
        );
        if (requestedLots < 1 || requestedLots !== quantityLots) {
            throw new Error(
                `${label} CommonLot order/status quantity is inconsistent`,
            );
        }
        const metadata = contractMetadataByCode.get(contract.code);
        if (!metadata || metadata.contractKey !== contract.contractKey) {
            throw new Error(`${label} canonical contract metadata is unavailable`);
        }
        const quantityShares = smartOrderCommonLotsToShares(
            quantityLots,
            metadata.contractUnit,
        );
        const filledShares = smartOrderCommonLotsToShares(
            filledLots,
            metadata.contractUnit,
        );
        const cancelledShares = smartOrderCommonLotsToShares(
            cancelledLots,
            metadata.contractUnit,
        );
        const remainingShares = quantityShares - filledShares - cancelledShares;
        if (quantityShares < 1 || remainingShares < 1) {
            throw new Error(`${label} working quantity projection is invalid`);
        }
        workingOrders.push(Object.freeze({
            brokerOrderId: token(order.id, `${label}.order.id`),
            contractKey: contract.contractKey,
            filledShares,
            origin: 'external',
            quantityShares: filledShares + remainingShares,
            remainingShares,
            side: order.action,
            state: status.status,
        }));
    }
    const deals = [];
    for (const [tradeIndex, trade] of tradesResponse.entries()) {
        const label = `trades[${tradeIndex}]`;
        exactAccountFromTrade(trade, account, label);
        const contract = canonicalTradeContract(trade, label);
        const metadata = contractMetadataByCode.get(contract.code);
        if (!metadata || metadata.contractKey !== contract.contractKey) {
            throw new Error(`${label} canonical contract metadata is unavailable`);
        }
        const order = dataProperties(
            trade.order,
            ['account', 'id'],
            `${label}.order`,
        );
        const orderId = token(order.id, `${label}.order.id`);
        const status = dataProperties(
            trade.status,
            ['deals', 'status'],
            `${label}.status`,
        );
        if (!Array.isArray(status.deals) || isProxy(status.deals)) {
            throw new TypeError(`${label}.status.deals is invalid`);
        }
        for (const [dealIndex, rawDeal] of status.deals.entries()) {
            const deal = dataProperties(
                rawDeal,
                ['fee', 'realized_pnl', 'seq', 'tax'],
                `${label}.status.deals[${dealIndex}]`,
            );
            deals.push(Object.freeze({
                dealId: sha256(canonicalJson([
                    'smart-order-pnl-deal-id/2026-08-13.1',
                    account.brokerId,
                    account.accountId,
                    tradeDate,
                    contract.contractKey,
                    orderId,
                    token(deal.seq, `${label}.deal.seq`),
                ])),
                feeMinorUnits: minorUnits(deal.fee, `${label}.deal.fee`),
                realizedMinorUnits: minorUnits(
                    deal.realized_pnl,
                    `${label}.deal.realized_pnl`,
                    { signed: true },
                ),
                transactionTaxMinorUnits: minorUnits(
                    deal.tax,
                    `${label}.deal.tax`,
                ),
            }));
        }
    }
    const positionSnapshots = positionsResponse.map((rawPosition, index) => {
        const position = dataProperties(
            rawPosition,
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
            `positions[${index}]`,
        );
        if (!['Buy', 'Sell'].includes(position.direction)) {
            throw new TypeError(`positions[${index}].direction is unsupported`);
        }
        return Object.freeze({ index, position });
    });
    const positions = positionSnapshots
        .filter(({ position }) => position.direction === 'Buy')
        .map(({ index, position }) => {
            const code = token(position.code, `positions[${index}].code`, 32);
            const metadata = contractMetadataByCode.get(code);
            const contractKey = metadata?.contractKey;
            if (!contractKey || !Number.isSafeInteger(position.id)) {
                throw new Error('position contract lineage is not uniquely mapped');
            }
            const quantityShares = safeShare(
                position.quantity,
                `positions[${index}].quantity`,
            );
            const workingSellShares = workingOrders
                .filter(
                    (order) =>
                        order.contractKey === contractKey &&
                        order.side === 'Sell',
                )
                .reduce((sum, order) => sum + order.remainingShares, 0);
            if (
                !Number.isSafeInteger(workingSellShares) ||
                workingSellShares > quantityShares
            ) {
                throw new Error('working sells exceed the fixed-account position');
            }
            return Object.freeze({
                averagePriceMinorUnits: minorUnits(
                    position.price,
                    `positions[${index}].price`,
                ),
                availableShares: quantityShares - workingSellShares,
                contractKey,
                lastPriceMinorUnits: minorUnits(
                    position.last_price,
                    `positions[${index}].last_price`,
                ),
                positionLineageId: sha256(canonicalJson([
                    'smart-order-position-lineage/2026-08-22.1',
                    account.brokerId,
                    account.accountId,
                    position.id,
                    contractKey,
                    metadata.categoryCode,
                    metadata.contractUnit,
                    metadata.limitDownMinorUnits,
                    metadata.limitUpMinorUnits,
                    metadata.referenceMinorUnits,
                    metadata.updateDate,
                ])),
                quantityShares,
                unrealizedMinorUnits: minorUnits(
                    position.pnl,
                    `positions[${index}].pnl`,
                    { signed: true },
                ),
                yesterdayQuantityShares: safeShare(
                    position.yd_quantity,
                    `positions[${index}].yd_quantity`,
                ),
            });
        });
    const sourceRevision = sha256(canonicalJson([
        'smart-order-account-reconciliation-source/2026-08-22.2',
        connectionId,
        plan.reconciliationGeneration,
        reconciliationContractMetadataProjection(contractMetadataByCode),
        workingOrders,
        deals,
        positions,
    ]));
    const coverageVerified = completenessCapabilityVerified === true;
    return Object.freeze({
        account,
        apiGeneration,
        asOfEpochMs: nowEpochMs,
        connectionId,
        deals,
        eventStreamWatermarkSha256: sha256(canonicalJson([
            'smart-order-trade-stream-watermark/2026-08-13.1',
            connectionId,
            plan.reconciliationGeneration,
        ])),
        fullDayDealsComplete: coverageVerified,
        fullDayFeesComplete: coverageVerified,
        fullDayTaxesComplete: coverageVerified,
        includesExternalClientActivity: coverageVerified,
        includesPreRuntimeActivity: coverageVerified,
        positions,
        pnlPolicyDefinitionSha256:
            SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
        pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
        reconciliationGeneration: plan.reconciliationGeneration,
        runtimeEpochId,
        sourceRevision,
        tradeDate,
        workingOrders,
        workingOrderSetComplete: coverageVerified,
    });
}

function quotePlanBody(plan) {
    return Object.freeze({
        security_type: plan.contract.securityType,
        region: 'TW',
        exchange: plan.contract.exchange,
        code: plan.contract.code,
        target_code: null,
        quote_type: plan.quoteType === 'tick' ? 'Tick' : 'BidAsk',
        intraday_odd: false,
    });
}

function quoteStreamKey(quoteType, code) {
    return `${quoteType}\u001f${code}`;
}

function publicStatus(state) {
    return Object.freeze({
        schemaVersion: SMART_ORDER_SHIOAJI_TRADE_OBSERVER_SCHEMA_VERSION,
        state: state.state,
        fixedAccountCount: state.accountCount,
        confirmedAccountCount: state.confirmedAccountCount,
        acceptedEventCount: state.acceptedEventCount,
        duplicateEventCount: state.duplicateEventCount,
        unmatchedEventCount: state.unmatchedEventCount,
        reconnectAttempt: state.reconnectAttempt,
        gateVerified: state.gateVerified,
        mappingRevisionCurrent: state.mappingRevisionCurrent,
        identityMappingState: state.identityMappingState,
        quoteConnectionActive: state.quoteConnectionActive,
        quoteConfirmedSubscriptionCount:
            state.quoteConfirmedSubscriptionCount,
        quoteObservationCount: state.quoteObservationCount,
        normalizedQuoteEventCount: state.normalizedQuoteEventCount,
        normalizedQuoteFieldCount: state.normalizedQuoteFieldCount,
        rejectedQuoteEventCount: state.rejectedQuoteEventCount,
        lastQuickFieldRejectionReason:
            state.lastQuickFieldRejectionReason,
        protectiveTriggerCandidateCount:
            state.protectiveTriggerCandidateCount,
        quotePlanFailureCount: state.quotePlanFailureCount,
        quoteAmbiguousEventCount: state.quoteAmbiguousEventCount,
        subscriptionBarrierOpen: state.subscriptionBarrierOpen,
        preSubscriptionEventDiscardCount:
            state.preSubscriptionEventDiscardCount,
        quickFieldNormalizerSchemaVersion:
            SMART_ORDER_QUICK_FIELD_NORMALIZER_SCHEMA_VERSION,
        quickFieldMappingState: 'verified_current',
        quickFieldMappingRevision: SMART_ORDER_QUICK_FIELD_MAPPING_REVISION,
        quickFieldMappingDefinitionSha256:
            SMART_ORDER_QUICK_FIELD_MAPPING_DEFINITION_SHA256,
        protectiveTriggerPolicy:
            'current_fresh_normal_lot_last_trade_only',
        productionQuoteTransportConfigured: true,
        sharedExistingLogin: true,
        createsNewLogin: false,
        snapshotPollingFallbackAllowed: false,
        ticksPollingFallbackAllowed: false,
        kbarsPollingFallbackAllowed: false,
        reconciliationRequired: !(
            state.subscriptionBarrierOpen === true &&
            state.accountCount > 0 &&
            state.reconciliationPersistedCount === state.accountCount &&
            state.reconciliationFailureCount === 0
        ),
        reconciliationCoverageCompleteCount:
            state.reconciliationCoverageCompleteCount,
        reconciliationPersistedCount: state.reconciliationPersistedCount,
        reconciliationFailureCount: state.reconciliationFailureCount,
        accountIdentifiersExposed: false,
        eventIdentifiersExposed: false,
        runtimeReadinessContribution:
            state.subscriptionBarrierOpen === true &&
            state.accountCount > 0 &&
            state.reconciliationPersistedCount === state.accountCount &&
            state.reconciliationFailureCount === 0,
        conditionEligibilityAuthority: false,
        brokerWriteAuthority: false,
    });
}

async function readJson(response, requestUrl) {
    if (response.url !== requestUrl || response.redirected === true || !response.ok) {
        throw new Error('Shioaji read-only response identity/status is invalid');
    }
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        throw new Error('Shioaji read-only response is not JSON');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_JSON_BYTES) {
        throw new Error('Shioaji read-only response exceeds its bound');
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

function validateAccounts(value) {
    if (!Array.isArray(value) || isProxy(value) || value.length > MAX_ACCOUNTS) {
        throw new Error('Shioaji account list is invalid');
    }
    const accounts = value
        .filter((candidate) => candidate?.signed === true && candidate?.account_type === 'S')
        .map((candidate) => Object.freeze({
            brokerId: token(candidate.broker_id, 'account.broker_id', 128),
            accountId: token(candidate.account_id, 'account.account_id', 128),
            accountType: 'S',
        }))
        .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
    const keys = accounts.map((account) => JSON.stringify(account));
    if (accounts.length < 1 || new Set(keys).size !== keys.length) {
        throw new Error('signed fixed stock accounts are missing or ambiguous');
    }
    return Object.freeze(accounts);
}

function splitSseEvents(buffer) {
    const events = [];
    let remaining = buffer;
    let boundary;
    while ((boundary = remaining.search(/\r?\n\r?\n/)) >= 0) {
        const separator = remaining.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
        const block = remaining.slice(0, boundary);
        remaining = remaining.slice(boundary + separator.length);
        if (new TextEncoder().encode(block).byteLength > MAX_SSE_EVENT_BYTES) {
            throw new Error('Shioaji SSE event exceeds its bound');
        }
        let event = 'message';
        const data = [];
        for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        events.push(Object.freeze({ event, data: data.join('\n') }));
    }
    if (new TextEncoder().encode(remaining).byteLength > MAX_SSE_EVENT_BYTES) {
        throw new Error('Shioaji SSE buffer exceeds its bound');
    }
    return Object.freeze({ events: Object.freeze(events), remaining });
}

export async function startSmartOrderShioajiTradeObserver(options) {
    const config = exactOptions(options);
    const apiGeneration = token(config.apiGeneration, 'apiGeneration');
    const runtimeEpochId = token(config.runtimeEpochId, 'runtimeEpochId');
    if (!isIssuedSmartOrderResourceCoordinator(config.resourceCoordinator)) {
        throw new TypeError(
            'resourceCoordinator must be a module-issued process-wide capability',
        );
    }
    const resourceCoordinator = config.resourceCoordinator;
    const quoteCoordinator = quoteCoordinatorCapability(
        config.quoteSubscriptionCoordinator,
    );
    for (const [name, fn] of Object.entries({
        fetchImpl: config.fetchImpl,
        nowEpochMs: config.nowEpochMs,
        nowMonotonicMs: config.nowMonotonicMs,
        scheduleRetry: config.scheduleRetry,
        cancelRetry: config.cancelRetry,
        reportRuntimeGapLifecycle: config.reportRuntimeGapLifecycle,
    })) {
        if (typeof fn !== 'function' || isProxy(fn)) {
            throw new TypeError(`${name} must be a non-Proxy function`);
        }
    }
    if (
        !config.runtimeController ||
        typeof config.runtimeController.gateManifestStatus !== 'function' ||
        typeof config.runtimeController.recordCanonicalBrokerEvent !== 'function' ||
        typeof config.runtimeController.recordQuickQuoteObservation !==
            'function' ||
        typeof config.runtimeController.recordProtectiveQuoteObservation !==
            'function' ||
        typeof config.runtimeController.recordAccountReconciliation !== 'function' ||
        typeof config.runtimeController.materializeProtectedEntryFill !==
            'function' ||
        typeof config.runtimeController.completeBrokerObservationReconciliation !==
            'function' ||
        typeof config.runtimeController.acceptAuthenticatedIdentityEvidence !==
            'function' ||
        typeof config.runtimeController.invalidateAuthenticatedIdentityEvidence !==
            'function'
    ) {
        throw new TypeError('runtimeController lacks the read-only broker ingress contract');
    }
    await assertSmartOrderShioajiTradeObserverRuntimeAuthority({
        fetchImpl: config.fetchImpl,
        runtimeController: config.runtimeController,
    });

    const state = {
        state: 'gate_unverified',
        accountCount: 0,
        confirmedAccountCount: 0,
        acceptedEventCount: 0,
        duplicateEventCount: 0,
        unmatchedEventCount: 0,
        reconnectAttempt: 0,
        gateVerified: false,
        mappingRevisionCurrent: false,
        identityMappingState: 'principal_unavailable_fail_closed',
        quoteConnectionActive: false,
        quoteConfirmedSubscriptionCount: 0,
        quoteObservationCount: 0,
        normalizedQuoteEventCount: 0,
        normalizedQuoteFieldCount: 0,
        rejectedQuoteEventCount: 0,
        lastQuickFieldRejectionReason: null,
        protectiveTriggerCandidateCount: 0,
        quotePlanFailureCount: 0,
        quoteAmbiguousEventCount: 0,
        subscriptionBarrierOpen: false,
        preSubscriptionEventDiscardCount: 0,
        reconciliationCoverageCompleteCount: 0,
        reconciliationPersistedCount: 0,
        reconciliationFailureCount: 0,
    };
    let closed = false;
    let retryHandle;
    let reconciliationRetryHandle;
    let reconciliationInFlight;
    let reconciliationPacingHandle;
    let reconciliationPacingResolve;
    let authenticatedAccounts = Object.freeze([]);
    let connectionAbort;
    let coordinator;
    let reconciliationCoordinator;
    let readLoop;
    let connectInFlight;
    let quotePlanPump;
    let quotePlanPumpRequested = false;
    let quoteConnectionId;
    let connectionSubscriptionBarrier;
    let reconnectBlockedByQuotePlanFailure = false;
    let quoteReceiveSequence = 0;
    let resourceOperationSequence = 0;
    const quoteStreams = new Map();
    const quoteMutationAborts = new Set();

    function quoteFullKey(plan) {
        return JSON.stringify([
            plan.contract.exchange,
            plan.contract.securityType,
            plan.contract.code,
            plan.quoteType,
        ]);
    }

    function addQuoteStream(plan, streamAuthority) {
        const eventKey = quoteStreamKey(plan.quoteType, plan.contract.code);
        let candidates = quoteStreams.get(eventKey);
        if (!candidates) {
            candidates = new Map();
            quoteStreams.set(eventKey, candidates);
        }
        candidates.set(quoteFullKey(plan),
            Object.freeze({
                contract: plan.contract,
                quoteType: plan.quoteType,
                streamAuthority,
            }),
        );
        state.quoteConfirmedSubscriptionCount = [...quoteStreams.values()].reduce(
            (count, entries) => count + entries.size,
            0,
        );
    }

    function removeQuoteStream(plan) {
        const eventKey = quoteStreamKey(plan.quoteType, plan.contract.code);
        const candidates = quoteStreams.get(eventKey);
        candidates?.delete(quoteFullKey(plan));
        if (candidates?.size === 0) quoteStreams.delete(eventKey);
        state.quoteConfirmedSubscriptionCount = [...quoteStreams.values()].reduce(
            (count, entries) => count + entries.size,
            0,
        );
    }

    function clearQuoteStreams() {
        quoteStreams.clear();
        state.quoteConfirmedSubscriptionCount = 0;
    }

    function markQuoteDisconnected(connectionId) {
        if (!connectionId || quoteConnectionId !== connectionId) return;
        if (connectionSubscriptionBarrier) {
            connectionSubscriptionBarrier.open = false;
        }
        state.subscriptionBarrierOpen = false;
        Reflect.apply(
            quoteCoordinator.runtime.markDisconnected,
            quoteCoordinator.runtime.receiver,
            [{ apiGeneration, connectionId }],
        );
        quoteConnectionId = undefined;
        state.quoteConnectionActive = false;
        clearQuoteStreams();
    }

    async function executeQuotePlan(plan, connectionId) {
        const endpoint =
            plan.action === 'subscribe'
                ? ENDPOINTS.subscribeQuote
                : ENDPOINTS.unsubscribeQuote;
        let failedReason;
        try {
            const result = await requestJson(endpoint, {
                method: 'POST',
                body: quotePlanBody(plan),
                quoteMutation: true,
            });
            if (
                !result ||
                typeof result !== 'object' ||
                Array.isArray(result) ||
                isProxy(result) ||
                result.success !== true
            ) {
                failedReason =
                    plan.action === 'subscribe'
                        ? 'subscribe_failed'
                        : 'unsubscribe_failed';
            }
        } catch {
            // Once fetch has been invoked, a thrown transport/read error cannot
            // prove that the server did not apply the subscription mutation.
            // Keep the resource reserved and require connection invalidation;
            // never classify an ambiguous result as a definite rejection.
            failedReason = 'transport_timeout';
        }
        if (failedReason) {
            Reflect.apply(
                quoteCoordinator.runtime.reportPlanFailure,
                quoteCoordinator.runtime.receiver,
                [
                    plan,
                    {
                        action: plan.action,
                        apiGeneration,
                        connectionId,
                        planId: plan.planId,
                        reason: failedReason,
                    },
                ],
            );
            state.quotePlanFailureCount += 1;
            return;
        }
        const confirmed = Reflect.apply(
            quoteCoordinator.runtime.confirmPlan,
            quoteCoordinator.runtime.receiver,
            [
                plan,
                {
                    action: plan.action,
                    apiGeneration,
                    connectionId,
                    planId: plan.planId,
                },
            ],
        );
        if (confirmed?.allowed !== true) {
            state.quotePlanFailureCount += 1;
            return;
        }
        if (plan.action === 'subscribe') {
            addQuoteStream(plan, confirmed.streamAuthority);
        } else {
            removeQuoteStream(plan);
        }
    }

    async function pumpQuotePlans() {
        quotePlanPumpRequested = true;
        if (quotePlanPump) return quotePlanPump;
        quotePlanPump = (async () => {
            while (!closed && quoteConnectionId) {
                quotePlanPumpRequested = false;
                const plans = Reflect.apply(
                    quoteCoordinator.observer.pendingPlans,
                    quoteCoordinator.observer.receiver,
                    [],
                );
                if (!Array.isArray(plans) || plans.length === 0) {
                    if (quotePlanPumpRequested) continue;
                    return;
                }
                const plan = plans[0];
                const currentConnectionId = quoteConnectionId;
                if (
                    plan.apiGeneration !== apiGeneration ||
                    plan.connectionId !== currentConnectionId
                ) {
                    markQuoteDisconnected(currentConnectionId);
                    return;
                }
                await executeQuotePlan(plan, currentConnectionId);
                if (quoteConnectionId !== currentConnectionId) return;
            }
        })();
        try {
            return await quotePlanPump;
        } finally {
            quotePlanPump = undefined;
        }
    }

    function allDemandedQuoteSubscriptionsConfirmed(connectionId) {
        const status = Reflect.apply(
            quoteCoordinator.observer.status,
            quoteCoordinator.observer.receiver,
            [],
        );
        if (
            status.connectionActive !== true ||
            status.apiGeneration !== apiGeneration ||
            status.connectionId !== connectionId ||
            status.pendingPlanCount !== 0 ||
            !Array.isArray(status.subscriptions)
        ) {
            return false;
        }
        let countedDemand = 0;
        for (const subscription of status.subscriptions) {
            const runtimeRefCount = subscription.runtimeRefCount ?? 0;
            const browserRefCount = subscription.browserRefCount ?? 0;
            countedDemand += runtimeRefCount + browserRefCount;
            if (
                runtimeRefCount + browserRefCount > 0 &&
                !(
                    subscription.connectionActive === true &&
                    subscription.apiGeneration === apiGeneration &&
                    subscription.connectionId === connectionId &&
                    subscription.subscriptionConfirmedCurrentLineage === true &&
                    subscription.physicalState === 'confirmed' &&
                    subscription.resourceAdmitted === true &&
                    subscription.resourceCurrent === true
                )
            ) {
                return false;
            }
        }
        return countedDemand === status.totalDemandCount;
    }

    function latchUnconfirmedQuoteDemand(connectionId) {
        if (allDemandedQuoteSubscriptionsConfirmed(connectionId)) return false;
        reconnectBlockedByQuotePlanFailure = true;
        if (connectionSubscriptionBarrier) {
            connectionSubscriptionBarrier.open = false;
        }
        state.subscriptionBarrierOpen = false;
        state.state = 'quote_subscription_manual_recovery_required';
        connectionAbort?.abort();
        return true;
    }

    async function recordQuoteEvent(eventName, rawData) {
        const quoteType = eventName === 'tick_stk' ? 'tick' : 'bidask';
        let payload;
        try {
            payload = JSON.parse(rawData);
            if (
                !payload ||
                typeof payload !== 'object' ||
                Array.isArray(payload) ||
                isProxy(payload) ||
                payload.intraday_odd === true ||
                payload.simtrade === true
            ) {
                return;
            }
        } catch {
            return;
        }
        let code;
        try {
            code = token(payload.code, 'quote.code', 32);
        } catch {
            return;
        }
        const candidates = quoteStreams.get(quoteStreamKey(quoteType, code));
        if (!candidates || candidates.size !== 1) {
            state.quoteAmbiguousEventCount += 1;
            return;
        }
        const [{ contract, streamAuthority }] = candidates.values();
        quoteReceiveSequence += 1;
        const descriptors = Object.getOwnPropertyDescriptors(payload);
        const rawValue = (key) =>
            Object.hasOwn(descriptors[key] ?? {}, 'value')
                ? descriptors[key].value
                : undefined;
        const receiveTimeMs = safeNow(config.nowEpochMs, 'nowEpochMs');
        const normalized = normalizeSmartOrderQuickFieldEvent({
            contractKey: `${contract.exchange}:${contract.securityType}:${contract.code}`,
            event:
                eventName === 'tick_stk'
                    ? {
                          eventKind: 'tick',
                          code: rawValue('code'),
                          date: rawValue('date'),
                          time: rawValue('time'),
                          close: rawValue('close'),
                          volume: rawValue('volume'),
                          totalVolume: rawValue('total_volume'),
                          priceChange: rawValue('price_chg'),
                          percentChange: rawValue('pct_chg'),
                          simtrade: rawValue('simtrade'),
                          intradayOdd: rawValue('intraday_odd'),
                      }
                    : {
                          eventKind: 'bidask',
                          code: rawValue('code'),
                          date: rawValue('date'),
                          time: rawValue('time'),
                          bidPrices: rawValue('bid_price'),
                          askPrices: rawValue('ask_price'),
                          simtrade: rawValue('simtrade'),
                          intradayOdd: rawValue('intraday_odd'),
                      },
            receiveTimeMs,
            sequence: quoteReceiveSequence,
            streamEpoch: quoteConnectionId,
        });
        if (normalized.accepted !== true) {
            state.rejectedQuoteEventCount += 1;
            state.lastQuickFieldRejectionReason = normalized.reason;
            return;
        }
        state.lastQuickFieldRejectionReason = null;
        state.normalizedQuoteEventCount += 1;
        state.normalizedQuoteFieldCount += normalized.projections.length;
        const recorded = Reflect.apply(
            quoteCoordinator.runtime.recordMappedObservation,
            quoteCoordinator.runtime.receiver,
            [streamAuthority, normalized],
        );
        if (recorded?.allowed === true) {
            state.quoteObservationCount += 1;
            if (recorded.quickConditionEligible === true) {
                try {
                    await config.runtimeController.recordQuickQuoteObservation({
                        observation: recorded,
                    });
                } catch (error) {
                    state.state = 'reconciliation_required';
                    reportRuntimeGapLifecycle(
                        'disconnect',
                        quoteConnectionId ?? recorded.streamEpoch,
                    );
                    throw error;
                }
            }
            if (recorded.protectiveTriggerEligible === true) {
                state.protectiveTriggerCandidateCount += 1;
                try {
                    await config.runtimeController.recordProtectiveQuoteObservation({
                        observation: recorded,
                    });
                } catch (error) {
                    state.state = 'reconciliation_required';
                    reportRuntimeGapLifecycle(
                        'disconnect',
                        quoteConnectionId ?? recorded.streamEpoch,
                    );
                    throw error;
                }
            }
        }
    }

    function reportRuntimeGapLifecycle(phase, connectionId) {
        config.reportRuntimeGapLifecycle(
            Object.freeze({
                observedWallTimeMs: safeNow(config.nowEpochMs, 'nowEpochMs'),
                phase,
                streamEpoch: token(connectionId, 'connectionId'),
                streamId: 'shioaji-trade-sse',
            }),
        );
    }

    async function withResourceOperation(kind, label, operation) {
        if (resourceOperationSequence === Number.MAX_SAFE_INTEGER) {
            throw new Error('resource operation sequence is exhausted');
        }
        resourceOperationSequence += 1;
        const operationId = sha256(
            canonicalJson([
                'smart-order-shioaji-read-operation/2026-08-22.1',
                runtimeEpochId,
                apiGeneration,
                kind,
                label,
                resourceOperationSequence,
            ]),
        );
        const grant = await resourceCoordinator.acquireOperation({
            operationId,
            kind,
        });
        try {
            await resourceCoordinator.acquireOperationUnit({
                operationId: grant.operationId,
            });
            return await operation();
        } finally {
            const completed = resourceCoordinator.completeOperation({
                operationId: grant.operationId,
            });
            if (completed.allowed !== true) {
                throw new Error(
                    `resource read operation settlement failed: ${completed.reason}`,
                );
            }
        }
    }

    function resourceKindForRequest(endpoint) {
        if (
            endpoint === ENDPOINTS.kbars ||
            endpoint.startsWith('/api/v1/data/contracts/')
        ) {
            return 'market_data';
        }
        if (
            [
                ENDPOINTS.positions,
                ENDPOINTS.trades,
            ].includes(endpoint)
        ) {
            return 'reconciliation';
        }
        return 'status';
    }

    async function requestJson(
        endpoint,
        {
            method = 'GET',
            body,
            allowEmptyResponse = false,
            quoteMutation = false,
        } = {},
    ) {
        return withResourceOperation(
            resourceKindForRequest(endpoint),
            `http:${method}:${endpoint}`,
            () =>
                requestJsonAfterResourceAdmission(endpoint, {
                    method,
                    body,
                    allowEmptyResponse,
                    quoteMutation,
                }),
        );
    }

    async function requestJsonAfterResourceAdmission(
        endpoint,
        { method, body, allowEmptyResponse, quoteMutation },
    ) {
        const requestUrl = `${BASE_URL}${endpoint}`;
        const controller = new AbortController();
        if (quoteMutation) quoteMutationAborts.add(controller);
        const timer = setTimeout(() => controller.abort(), 5_000);
        try {
            const response = await config.fetchImpl(requestUrl, {
                method,
                headers:
                    body === undefined
                        ? { accept: 'application/json' }
                        : {
                              accept: 'application/json',
                              'content-type': 'application/json',
                          },
                body: body === undefined ? undefined : JSON.stringify(body),
                cache: 'no-store',
                redirect: 'error',
                signal: controller.signal,
            });
            if (
                allowEmptyResponse &&
                (response.status === 204 ||
                    response.headers?.get?.('content-length') === '0')
            ) {
                if (
                    response.url !== requestUrl ||
                    response.redirected === true ||
                    !response.ok
                ) {
                    throw new Error(
                        'Shioaji read-only response identity/status is invalid',
                    );
                }
                return null;
            }
            return await readJson(response, requestUrl);
        } finally {
            clearTimeout(timer);
            quoteMutationAborts.delete(controller);
        }
    }

    async function currentGateManifest() {
        const gate = await config.runtimeController.gateManifestStatus({
            provenance: 'automation',
            nowEpochMs: safeNow(config.nowEpochMs, 'nowEpochMs'),
        });
        state.gateVerified = gate?.state === 'eligible';
        state.mappingRevisionCurrent =
            gate?.mappingRevision === SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION;
        return state.gateVerified && state.mappingRevisionCurrent
            ? gate
            : undefined;
    }

    async function reconcileFixedAccounts(
        accounts,
        connectionId,
        brokerObservationEvidenceSha256 = null,
    ) {
        const reconciliationNow = safeNow(config.nowEpochMs, 'nowEpochMs');
        const authority =
            await createSmartOrderAccountReconciliationTransportAuthority({
                fetchImpl: config.fetchImpl,
                nowEpochMs: reconciliationNow,
                runtimeController: config.runtimeController,
            });
        reconciliationCoordinator =
            createSmartOrderAccountReconciliationCoordinator({
                apiGeneration,
                connectionId,
                nowMonotonicMs: config.nowMonotonicMs,
                runtimeEpochId,
                tradeDate: taipeiTradeDate(reconciliationNow),
                verifier: authority.verifier,
            });
        for (const account of accounts) {
            reconciliationCoordinator.runtime.acquire({
                account,
                consumerId: `runtime:${runtimeEpochId}`,
            });
        }
        const plans = reconciliationCoordinator.observer.pendingPlans();
        if (plans.length !== accounts.length) {
            throw new Error(
                'fixed-account reconciliation plan set is incomplete',
            );
        }
        for (const [planIndex, plan] of plans.entries()) {
            const readAccountSnapshot = async () => {
                const tradesResponse = await requestJson(ENDPOINTS.trades, {
                    method: 'POST',
                    body: accountBody(plan.account),
                });
                // Shioaji server v1.7.1 defines this account-scoped operation
                // as update-status first, then return the refreshed trade cache.
                const updateStatusResponse = tradesResponse;
                const positionsResponse = await requestJson(
                    ENDPOINTS.positions,
                    {
                        method: 'POST',
                        body: Object.freeze({
                            ...accountBody(plan.account),
                            unit: 'Share',
                        }),
                    },
                );
                boundedReconciliationResponses({
                    positionsResponse,
                    tradesResponse,
                    updateStatusResponse,
                });
                return Object.freeze({
                    positionsResponse,
                    tradesResponse,
                    updateStatusResponse,
                });
            };
            const readContractMetadata = async (accountSnapshot) => {
                const lookups = reconciliationContractLookups(
                    accountSnapshot,
                );
                const contractMetadataByCode = new Map();
                for (const lookup of lookups) {
                    const endpoint = `/api/v1/data/contracts/${encodeURIComponent(
                        lookup.code,
                    )}/info?security_type=STK&region=TW`;
                    const response = await requestJson(endpoint);
                    contractMetadataByCode.set(
                        lookup.code,
                        parseSmartOrderCanonicalStockContractMetadata(response, {
                            requestedCode: lookup.code,
                            expectedExchange: lookup.expectedExchange,
                        }),
                    );
                }
                return Object.freeze({ contractMetadataByCode, lookups });
            };
            await authority.assertCurrentCompletenessCapability(
                safeNow(config.nowEpochMs, 'nowEpochMs'),
            );
            const accountSnapshotBefore = await readAccountSnapshot();
            const metadataBefore = await readContractMetadata(
                accountSnapshotBefore,
            );
            const accountSnapshotMiddle = await readAccountSnapshot();
            const metadataAfter = await readContractMetadata(
                accountSnapshotMiddle,
            );
            const metadataObservedAtEpochMs = safeNow(
                config.nowEpochMs,
                'nowEpochMs',
            );
            const accountSnapshotAfter = await readAccountSnapshot();
            const persistenceNowEpochMs = safeNow(
                config.nowEpochMs,
                'nowEpochMs',
            );
            if (
                persistenceNowEpochMs < metadataObservedAtEpochMs ||
                persistenceNowEpochMs - metadataObservedAtEpochMs >
                    ACCOUNT_RECONCILIATION_MAX_SNAPSHOT_AGE_MS
            ) {
                throw new Error(
                    'account reconciliation metadata freshness expired during its bounded read window',
                );
            }
            const accountBeforeJson = JSON.stringify(accountSnapshotBefore);
            if (
                accountBeforeJson !== JSON.stringify(accountSnapshotMiddle) ||
                accountBeforeJson !== JSON.stringify(accountSnapshotAfter) ||
                canonicalJson(metadataBefore.lookups) !==
                    canonicalJson(metadataAfter.lookups) ||
                canonicalJson(
                    reconciliationContractMetadataProjection(
                        metadataBefore.contractMetadataByCode,
                    ),
                ) !==
                    canonicalJson(
                        reconciliationContractMetadataProjection(
                            metadataAfter.contractMetadataByCode,
                        ),
                    )
            ) {
                throw new Error(
                    'account reconciliation source changed during its bounded read window',
                );
            }
            for (const metadata of metadataAfter.contractMetadataByCode.values()) {
                assertSmartOrderCanonicalContractUpdateDateCurrent(
                    metadata,
                    metadataObservedAtEpochMs,
                );
            }
            const snapshot = projectAccountReconciliationSnapshot({
                account: plan.account,
                apiGeneration,
                completenessCapabilityVerified: true,
                connectionId,
                contractMetadataByCode: metadataAfter.contractMetadataByCode,
                plan,
                positionsResponse: accountSnapshotMiddle.positionsResponse,
                runtimeEpochId,
                tradesResponse: accountSnapshotMiddle.tradesResponse,
                updateStatusResponse: accountSnapshotMiddle.updateStatusResponse,
                nowEpochMs: metadataObservedAtEpochMs,
            });
            const normalized =
                canonicalSmartOrderAccountReconciliationSnapshot(snapshot);
            const evidence = authority.issuer.issueSnapshotEvidence(
                Object.freeze({
                    accountScopeSha256: plan.accountScopeSha256,
                    apiGeneration,
                    connectionId,
                    planId: plan.planId,
                    reconciliationGeneration: plan.reconciliationGeneration,
                    runtimeEpochId,
                    snapshotSha256: normalized.snapshotSha256,
                    sourceSnapshotSha256:
                        normalized.sourceSnapshotSha256,
                    sourceRevision: normalized.sourceRevision,
                    tradeDate: plan.tradeDate,
                }),
            );
            const result = reconciliationCoordinator.runtime.submit(
                plan,
                snapshot,
                evidence,
            );
            if (result?.allowed !== true || result.coverageComplete !== true) {
                state.reconciliationFailureCount += 1;
                throw new Error(
                    'fixed-account reconciliation coverage is incomplete',
                );
            }
            state.reconciliationCoverageCompleteCount += 1;
            const persisted =
                await config.runtimeController.recordAccountReconciliation({
                    brokerObservationEvidenceSha256,
                    nowEpochMs: persistenceNowEpochMs,
                    result,
                });
            if (
                persisted?.state !== 'recorded' ||
                persisted.brokerWriteAuthority !== false
            ) {
                state.reconciliationFailureCount += 1;
                throw new Error(
                    'fixed-account reconciliation durable persistence failed',
                );
            }
            state.reconciliationPersistedCount += 1;
            const candidateIntentIds =
                persisted.protectedEntryMaterializationIntentIds;
            if (
                !Array.isArray(candidateIntentIds) ||
                candidateIntentIds.length > 128 ||
                new Set(candidateIntentIds).size !== candidateIntentIds.length ||
                candidateIntentIds.some(
                    (intentId) =>
                        typeof intentId !== 'string' ||
                        intentId.length < 1 ||
                        intentId.length > 256,
                )
            ) {
                throw new Error(
                    'protected entry materialization candidate projection is invalid',
                );
            }
            for (const intentId of candidateIntentIds) {
                const materialized =
                    await config.runtimeController.materializeProtectedEntryFill({
                        brokerObservationEvidenceSha256,
                        intentId,
                        nowEpochMs: persistenceNowEpochMs,
                        reconciliationResult: result,
                    });
                if (materialized?.brokerWriteAuthority !== false) {
                    throw new Error(
                        'protected entry materialization authority projection is invalid',
                    );
                }
                if (
                    ![
                        'waiting_entry_fill',
                        'zero_fill_terminal',
                        'partial',
                        'final',
                    ].includes(materialized.state)
                ) {
                    throw new Error(
                        'protected entry materialization remains reconciliation required',
                    );
                }
            }
            if (planIndex + 1 < plans.length) {
                await new Promise((resolve) => {
                    reconciliationPacingResolve = resolve;
                    reconciliationPacingHandle = config.scheduleRetry(() => {
                        reconciliationPacingHandle = undefined;
                        reconciliationPacingResolve = undefined;
                        resolve();
                    }, ACCOUNT_RECONCILIATION_ACCOUNT_SPACING_MS);
                    reconciliationPacingHandle?.unref?.();
                });
                if (closed || quoteConnectionId !== connectionId) {
                    throw new Error(
                        'fixed-account reconciliation lost its current connection',
                    );
                }
            }
        }
        if (brokerObservationEvidenceSha256 !== null) {
            const completed =
                config.runtimeController.completeBrokerObservationReconciliation({
                    eventEvidenceSha256: brokerObservationEvidenceSha256,
                });
            if (
                completed?.dispatchAllowed !== false ||
                completed.brokerWriteAuthority !== false
            ) {
                throw new Error(
                    'broker observation reconciliation completion authority projection is invalid',
                );
            }
        }
    }

    async function runFixedAccountReconciliation(
        accounts,
        connectionId,
        brokerObservationEvidenceSha256 = null,
    ) {
        if (reconciliationInFlight) {
            if (brokerObservationEvidenceSha256 === null) {
                return reconciliationInFlight;
            }
            // A cycle that began before the broker observation cannot prove
            // the post-event account state. Wait for it to settle, then force
            // a fresh cycle bound to the observation digest.
            await reconciliationInFlight.catch(() => {});
            if (closed || quoteConnectionId !== connectionId) {
                throw new Error(
                    'broker observation reconciliation lost its current connection',
                );
            }
        }
        state.reconciliationCoverageCompleteCount = 0;
        state.reconciliationPersistedCount = 0;
        state.reconciliationFailureCount = 0;
        reconciliationInFlight = reconcileFixedAccounts(
            accounts,
            connectionId,
            brokerObservationEvidenceSha256,
        ).finally(() => {
            reconciliationInFlight = undefined;
        });
        return reconciliationInFlight;
    }

    function cancelPeriodicReconciliation() {
        if (reconciliationRetryHandle !== undefined) {
            config.cancelRetry(reconciliationRetryHandle);
            reconciliationRetryHandle = undefined;
        }
        if (reconciliationPacingHandle !== undefined) {
            config.cancelRetry(reconciliationPacingHandle);
            reconciliationPacingHandle = undefined;
            const resolve = reconciliationPacingResolve;
            reconciliationPacingResolve = undefined;
            resolve?.();
        }
    }

    function schedulePeriodicReconciliation(accounts, connectionId) {
        cancelPeriodicReconciliation();
        if (closed || quoteConnectionId !== connectionId) return;
        reconciliationRetryHandle = config.scheduleRetry(() => {
            reconciliationRetryHandle = undefined;
            if (closed || quoteConnectionId !== connectionId) return;
            void runFixedAccountReconciliation(accounts, connectionId)
                .catch(() => {
                    state.reconciliationFailureCount += 1;
                    state.state = 'observing_reconciliation_required';
                })
                .finally(() => {
                    schedulePeriodicReconciliation(accounts, connectionId);
                });
        }, ACCOUNT_RECONCILIATION_INTERVAL_MS);
        reconciliationRetryHandle?.unref?.();
    }

    function scheduleReconnect() {
        if (reconnectBlockedByQuotePlanFailure) {
            state.state = 'quote_subscription_manual_recovery_required';
            return;
        }
        if (closed || state.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
            state.state = closed ? 'closed' : 'retry_exhausted';
            return;
        }
        const delay = RECONNECT_DELAYS_MS[Math.min(
            state.reconnectAttempt - 1,
            RECONNECT_DELAYS_MS.length - 1,
        )];
        retryHandle = config.scheduleRetry(() => {
            retryHandle = undefined;
            void connect().catch(() => {});
        }, delay);
        retryHandle?.unref?.();
    }

    async function mapAndPersist(payload, streams, accounts) {
        const matches = [];
        for (const account of accounts) {
            let refreshed;
            try {
                refreshed = await requestJson(ENDPOINTS.trades, {
                    method: 'POST',
                    body: accountBody(account),
                });
                const event = mapShioajiStockBrokerEvent({
                    account,
                    apiGeneration,
                    payload,
                    receiveEpochMs: safeNow(config.nowEpochMs, 'nowEpochMs'),
                    refreshedTrades: refreshed,
                });
                matches.push({ account, event });
            } catch {
                // Another fixed account may own the event. Zero or multiple
                // matches stay reconciliation-only.
            }
        }
        if (matches.length !== 1) {
            state.unmatchedEventCount += 1;
            state.state = 'reconciliation_required';
            return;
        }
        const match = matches[0];
        const stream = streams.get(JSON.stringify(match.account));
        if (!stream) {
            state.unmatchedEventCount += 1;
            state.state = 'reconciliation_required';
            return;
        }
        const expected = Object.freeze({
            accountScopeSha256: stream.accountScopeSha256,
            ...digestExpectedEvent(match.event),
            connectionId: stream.connectionId,
            connectionLineageRevision: stream.connectionLineageRevision,
        });
        const evidence = stream.authority.issueEventEvidence(expected);
        const accepted = stream.coordinator.runtime.recordEvent(
            stream.stream,
            match.event,
            evidence,
        );
        if (accepted.allowed !== true) {
            state.state = 'reconciliation_required';
            return;
        }
        try {
            const stored = await config.runtimeController.recordCanonicalBrokerEvent({
                event: accepted.event,
            });
            if (stored.state === 'accepted') state.acceptedEventCount += 1;
            if (stored.state === 'duplicate') state.duplicateEventCount += 1;
        } catch {
            // External activity or an unresolved internal correlation is not
            // guessed. The same event still triggers a complete account
            // reconciliation so manual/external working orders update the
            // durable claim ledger without waiting for the periodic cycle.
            state.unmatchedEventCount += 1;
            state.state = 'reconciliation_required';
        }
        try {
            await runFixedAccountReconciliation(
                accounts,
                stream.connectionId,
                accepted.event.brokerEventEvidenceSha256,
            );
        } catch {
            state.reconciliationFailureCount += 1;
            state.state = 'reconciliation_required';
        }
    }

    async function consumeSse(
        response,
        streams,
        accounts,
        abortSignal,
        connectionId,
        streamKind,
        subscriptionBarrier,
    ) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lifecycleReported = false;
        try {
            while (!closed && !abortSignal.aborted) {
                let heartbeatHandle;
                let heartbeatExpired = false;
                const heartbeat = new Promise((_, reject) => {
                    heartbeatHandle = setTimeout(() => {
                        heartbeatExpired = true;
                        reject(new Error('Shioaji trade SSE heartbeat timed out'));
                    }, SSE_HEARTBEAT_TIMEOUT_MS);
                    heartbeatHandle?.unref?.();
                });
                let chunk;
                try {
                    chunk = await Promise.race([reader.read(), heartbeat]);
                } catch (error) {
                    if (
                        heartbeatExpired &&
                        !closed &&
                        !abortSignal.aborted
                    ) {
                        reportRuntimeGapLifecycle(
                            'heartbeat_timeout',
                            connectionId,
                        );
                        lifecycleReported = true;
                    }
                    throw error;
                } finally {
                    clearTimeout(heartbeatHandle);
                }
                const { done, value } = chunk;
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parsed = splitSseEvents(buffer);
                buffer = parsed.remaining;
                for (const event of parsed.events) {
                    if (
                        streamKind === 'market' &&
                        (event.event === 'tick_stk' ||
                            event.event === 'bidask_stk') &&
                        event.data.length > 0
                    ) {
                        if (subscriptionBarrier.open !== true) {
                            state.preSubscriptionEventDiscardCount += 1;
                            state.state = 'reconciliation_required';
                            continue;
                        }
                        await recordQuoteEvent(event.event, event.data);
                        continue;
                    }
                    if (
                        streamKind !== 'order' ||
                        event.event !== 'order_event' ||
                        event.data.length === 0
                    ) {
                        continue;
                    }
                    if (subscriptionBarrier.open !== true) {
                        state.preSubscriptionEventDiscardCount += 1;
                        state.state = 'reconciliation_required';
                        continue;
                    }
                    let payload;
                    try {
                        payload = JSON.parse(event.data);
                    } catch {
                        state.state = 'reconciliation_required';
                        continue;
                    }
                    await mapAndPersist(payload, streams, accounts);
                }
            }
        } catch (error) {
            if (
                !lifecycleReported &&
                !closed &&
                !abortSignal.aborted
            ) {
                reportRuntimeGapLifecycle('disconnect', connectionId);
                lifecycleReported = true;
            }
            throw error;
        } finally {
            await reader.cancel().catch(() => {});
        }
        if (!closed && !abortSignal.aborted) {
            if (!lifecycleReported) {
                reportRuntimeGapLifecycle('disconnect', connectionId);
            }
            throw new Error('Shioaji trade SSE disconnected');
        }
    }

    async function openSse(endpoint, abortSignal) {
        const requestUrl = `${BASE_URL}${endpoint}`;
        const response = await withResourceOperation(
            'status',
            `http:GET:${endpoint}`,
            () =>
                config.fetchImpl(requestUrl, {
                    method: 'GET',
                    headers: { accept: 'text/event-stream' },
                    cache: 'no-store',
                    redirect: 'error',
                    signal: abortSignal,
                }),
        );
        if (
            response.url !== requestUrl ||
            response.redirected === true ||
            !response.ok ||
            !response.body?.getReader ||
            !/^text\/event-stream(?:\s*;|$)/i.test(
                response.headers?.get?.('content-type') ?? '',
            )
        ) {
            throw new Error('Shioaji SSE response is invalid');
        }
        return response;
    }

    async function connect() {
        if (closed || connectInFlight) return connectInFlight;
        connectInFlight = (async () => {
            state.reconnectAttempt += 1;
            const gateManifest = await currentGateManifest();
            if (!gateManifest) {
                await config.runtimeController.invalidateAuthenticatedIdentityEvidence();
                state.identityMappingState =
                    'principal_unavailable_fail_closed';
                state.state = 'gate_unverified';
                return;
            }
            const info = await requestJson(ENDPOINTS.info);
            const accountResponse = await requestJson(ENDPOINTS.accounts);
            if (info?.simulation !== true) {
                throw new Error('managed Shioaji server is not simulation');
            }
            const accounts = validateAccounts(accountResponse);
            state.accountCount = accounts.length;
            try {
                const principalEvidence =
                    issueVerifiedCanonicalPrincipalEvidence({
                        accountResponse,
                        gateManifest,
                        nowEpochMs: safeNow(config.nowEpochMs, 'nowEpochMs'),
                    });
                const expectedScopes = accounts.map((account) =>
                    JSON.stringify({
                        accountBrokerRef: account.brokerId,
                        accountIdRef: account.accountId,
                    }),
                );
                const issuedScopes = principalEvidence.accountScopes.map(
                    (scope) => JSON.stringify(scope),
                );
                if (
                    JSON.stringify([...expectedScopes].sort()) !==
                    JSON.stringify([...issuedScopes].sort())
                ) {
                    throw new Error(
                        'canonical principal account scope projection mismatch',
                    );
                }
                const accepted =
                    await config.runtimeController.acceptAuthenticatedIdentityEvidence(
                        principalEvidence,
                    );
                if (accepted?.state !== 'authenticated') {
                    throw new Error(
                        'Runtime rejected authenticated identity evidence',
                    );
                }
                authenticatedAccounts = accounts;
                state.identityMappingState = 'authenticated';
            } catch {
                authenticatedAccounts = Object.freeze([]);
                await config.runtimeController.invalidateAuthenticatedIdentityEvidence();
                state.identityMappingState =
                    'principal_unavailable_fail_closed';
            }
            connectionAbort = new AbortController();
            const marketResponse = await openSse(
                ENDPOINTS.marketStream,
                connectionAbort.signal,
            );
            const orderResponse = await openSse(
                ENDPOINTS.orderStream,
                connectionAbort.signal,
            );
            const connectionId = `shioaji-sse:${randomUUID()}`;
            const quoteConnection = Reflect.apply(
                quoteCoordinator.runtime.replaceConnection,
                quoteCoordinator.runtime.receiver,
                [{ apiGeneration, connectionId }],
            );
            if (quoteConnection?.allowed !== true) {
                throw new Error(
                    'quote subscription connection lineage replacement failed',
                );
            }
            quoteConnectionId = connectionId;
            cancelPeriodicReconciliation();
            quoteReceiveSequence = 0;
            state.reconciliationCoverageCompleteCount = 0;
            state.reconciliationPersistedCount = 0;
            state.reconciliationFailureCount = 0;
            state.quoteConnectionActive = true;
            clearQuoteStreams();
            const authority = createSmartOrderTradeSubscriptionTransportAuthority();
            const initializeExpected = Object.freeze({
                action: 'initialize',
                currentApiGeneration: null,
                currentConnectionId: null,
                currentConnectionLineageRevision: 0,
                nextApiGeneration: apiGeneration,
                nextConnectionId: connectionId,
            });
            coordinator = createSmartOrderTradeSubscriptionCoordinator({
                apiGeneration,
                connectionId,
                initialConnectionEvidence:
                    authority.issueConnectionEvidence(initializeExpected),
                nowMonotonicMs: config.nowMonotonicMs,
                transportVerifier: authority.verifier,
            });
            const streams = new Map();
            const subscriptionBarrier = { open: false };
            connectionSubscriptionBarrier = subscriptionBarrier;
            state.subscriptionBarrierOpen = false;
            for (const account of accounts) {
                coordinator.runtime.acquireFixedAccount({
                    account,
                    consumerId: `runtime:${runtimeEpochId}`,
                });
            }
            readLoop = Promise.all([
                consumeSse(
                    marketResponse,
                    streams,
                    accounts,
                    connectionAbort.signal,
                    connectionId,
                    'market',
                    subscriptionBarrier,
                ),
                consumeSse(
                    orderResponse,
                    streams,
                    accounts,
                    connectionAbort.signal,
                    connectionId,
                    'order',
                    subscriptionBarrier,
                ),
            ]).catch(() => {
                if (closed) return;
                connectionAbort?.abort();
                cancelPeriodicReconciliation();
                markQuoteDisconnected(connectionId);
                coordinator?.runtime.close();
                reconciliationCoordinator?.runtime.close();
                state.confirmedAccountCount = 0;
                state.state = 'disconnected_reconciliation_required';
                const activeConnect = connectInFlight;
                if (activeConnect) {
                    void activeConnect.then(
                        () => scheduleReconnect(),
                        () => scheduleReconnect(),
                    );
                } else {
                    scheduleReconnect();
                }
            });
            for (const plan of coordinator.observer.pendingSubscriptionPlans()) {
                let subscriptionResult;
                try {
                    subscriptionResult = await requestJson(
                        ENDPOINTS.subscribeTrade,
                        {
                            method: 'POST',
                            body: accountBody(plan.account),
                            allowEmptyResponse: true,
                        },
                    );
                } catch (error) {
                    coordinator.runtime.reportSubscriptionFailure(plan, {
                        apiGeneration,
                        connectionId,
                        planId: plan.planId,
                        reason:
                            error?.name === 'AbortError'
                                ? 'subscribe_result_unknown'
                                : 'subscribe_failed',
                    });
                    throw error;
                }
                if (subscriptionResult?.ok === false || subscriptionResult?.success === false) {
                    coordinator.runtime.reportSubscriptionFailure(plan, {
                        apiGeneration,
                        connectionId,
                        planId: plan.planId,
                        reason: 'subscribe_failed',
                    });
                    throw new Error('fixed-account trade subscription was rejected');
                }
                const expected = Object.freeze({
                    accountScopeSha256: plan.accountScopeSha256,
                    apiGeneration,
                    connectionId,
                    connectionLineageRevision: plan.connectionLineageRevision,
                    planId: plan.planId,
                });
                const stream = coordinator.runtime.confirmSubscription(
                    plan,
                    authority.issueSubscriptionEvidence(expected),
                );
                if (!stream || stream.allowed === false) {
                    throw new Error('fixed-account trade subscription confirmation failed');
                }
                streams.set(JSON.stringify(plan.account), {
                    accountScopeSha256: plan.accountScopeSha256,
                    authority,
                    coordinator,
                    stream,
                    connectionId,
                    connectionLineageRevision: plan.connectionLineageRevision,
                });
            }
            await pumpQuotePlans();
            if (
                connectionAbort.signal.aborted ||
                streams.size !== accounts.length ||
                latchUnconfirmedQuoteDemand(connectionId)
            ) {
                throw new Error(
                    'Shioaji SSE disconnected before subscriptions were confirmed',
                );
            }
            subscriptionBarrier.open = true;
            state.subscriptionBarrierOpen = true;
            // Establish and consume the event stream before bounded snapshot
            // reads. Events remain authoritative; the account-scoped trades
            // status refresh and positions only close the startup/reconnect
            // observation window.
            try {
                await runFixedAccountReconciliation(accounts, connectionId);
            } catch {
                state.reconciliationFailureCount += 1;
                reconciliationCoordinator?.runtime.close();
            }
            schedulePeriodicReconciliation(accounts, connectionId);
            state.confirmedAccountCount = streams.size;
            state.state = 'observing_reconciliation_required';
            if (state.reconnectAttempt > 1) {
                reportRuntimeGapLifecycle('reconnect', connectionId);
            }
        })();
        try {
            return await connectInFlight;
        } catch {
            authenticatedAccounts = Object.freeze([]);
            cancelPeriodicReconciliation();
            await Promise.resolve()
                .then(() =>
                    config.runtimeController.invalidateAuthenticatedIdentityEvidence(),
                )
                .catch(() => {});
            state.identityMappingState = 'principal_unavailable_fail_closed';
            connectionAbort?.abort();
            markQuoteDisconnected(quoteConnectionId);
            coordinator?.runtime.close();
            reconciliationCoordinator?.runtime.close();
            state.confirmedAccountCount = 0;
            state.state = 'transport_failed_reconciliation_required';
            scheduleReconnect();
        } finally {
            connectInFlight = undefined;
        }
    }

    await connect();
    function protectiveQuoteStatus() {
        const coordinatorStatus = Reflect.apply(
            quoteCoordinator.observer.status,
            quoteCoordinator.observer.receiver,
            [],
        );
        const demandedTicks = coordinatorStatus.subscriptions.filter(
            (entry) => entry.quoteType === 'tick' && entry.runtimeRefCount > 0,
        );
        const allFresh =
            demandedTicks.length > 0 &&
            demandedTicks.every(
                (entry) => entry.protectiveTriggerCurrent === true,
            );
        const latestEligible = demandedTicks.reduce(
            (latest, entry) =>
                Number.isSafeInteger(entry.lastEligibleExchangeTimeMs) &&
                entry.lastEligibleExchangeTimeMs > latest
                    ? entry.lastEligibleExchangeTimeMs
                    : latest,
            -1,
        );
        return Object.freeze({
            state: allFresh
                ? 'fresh'
                : latestEligible >= 0
                  ? 'stale'
                  : 'unverified',
            asOfExchangeTime:
                latestEligible >= 0
                    ? new Date(latestEligible).toISOString()
                    : null,
            authoritativeForActivation: false,
        });
    }
    return Object.freeze({
        schemaVersion: SMART_ORDER_SHIOAJI_TRADE_OBSERVER_SCHEMA_VERSION,
        status() {
            return publicStatus(state);
        },
        protectiveQuoteStatus,
        async acquireRuntimeQuoteDemand(input) {
            if (closed) {
                return Object.freeze({
                    allowed: false,
                    reason: 'shioaji_trade_observer_closed',
                    brokerWriteAuthority: false,
                });
            }
            const handle = Reflect.apply(
                quoteCoordinator.runtime.acquireDemand,
                quoteCoordinator.runtime.receiver,
                [input],
            );
            await pumpQuotePlans();
            if (quoteConnectionId) {
                latchUnconfirmedQuoteDemand(quoteConnectionId);
            }
            return handle;
        },
        async releaseRuntimeQuoteDemand(handle) {
            const result = Reflect.apply(
                quoteCoordinator.runtime.releaseDemand,
                quoteCoordinator.runtime.receiver,
                [handle],
            );
            await pumpQuotePlans();
            if (quoteConnectionId) {
                latchUnconfirmedQuoteDemand(quoteConnectionId);
            }
            return result;
        },
        async issueCanonicalContractEvidence(input) {
            if (closed || state.identityMappingState !== 'authenticated') {
                throw new Error(
                    'canonical contract evidence requires the current authenticated observer',
                );
            }
            if (
                !input ||
                typeof input !== 'object' ||
                Array.isArray(input) ||
                isProxy(input) ||
                Reflect.ownKeys(Object.getOwnPropertyDescriptors(input)).length !== 6
            ) {
                throw new TypeError('canonical contract evidence input is invalid');
            }
            const current = dataProperties(
                input,
                [
                    'accountBrokerRef',
                    'accountIdRef',
                    'contractKey',
                    'decisionTradingDate',
                    'fixedAtrRequired',
                    'strategyDefinitionHash',
                ],
                'canonical contract evidence input',
            );
            const account = authenticatedAccounts.find(
                (candidate) =>
                    candidate.brokerId === current.accountBrokerRef &&
                    candidate.accountId === current.accountIdRef,
            );
            if (!account) {
                throw new Error('canonical contract evidence account is not fixed/current');
            }
            const contract = draftStockContract(current.contractKey);
            const gate = await currentGateManifest();
            if (!gate) {
                throw new Error('canonical contract evidence requires current Gate evidence');
            }
            const endpoint = `/api/v1/data/contracts/${encodeURIComponent(
                contract.code,
            )}/info?security_type=STK&region=TW`;
            const responseBefore = await requestJson(endpoint);
            let response = responseBefore;
            let fixedAtrSource = null;
            if (current.fixedAtrRequired === true) {
                const decisionTradingDate = offsetTradingDate(
                    current.decisionTradingDate,
                    0,
                    'decisionTradingDate',
                );
                if (
                    typeof current.strategyDefinitionHash !== 'string' ||
                    !SHA256.test(current.strategyDefinitionHash)
                ) {
                    throw new TypeError(
                        'fixed ATR requires the current strategy definition hash',
                    );
                }
                const requestedStartDate = offsetTradingDate(
                    decisionTradingDate,
                    -30,
                    'decisionTradingDate',
                );
                const requestedEndDate = offsetTradingDate(
                    decisionTradingDate,
                    -1,
                    'decisionTradingDate',
                );
                const releaseFixedAtrRead = acquireFixedAtrReadAuthority(
                    config.nowMonotonicMs,
                );
                let kbars;
                try {
                    kbars = await requestJson(ENDPOINTS.kbars, {
                        method: 'POST',
                        body: {
                            contract: {
                                security_type: 'STK',
                                region: 'TW',
                                exchange: contract.exchange,
                                code: contract.code,
                                target_code: null,
                            },
                            start: requestedStartDate,
                            end: requestedEndDate,
                        },
                    });
                } finally {
                    releaseFixedAtrRead();
                }
                fixedAtrSource = Object.freeze({
                    decisionTradingDate,
                    requestedStartDate,
                    requestedEndDate,
                    response: kbars,
                    strategyDefinitionHash:
                        current.strategyDefinitionHash,
                });
                const responseAfter = await requestJson(endpoint);
                const metadataBefore =
                    parseSmartOrderCanonicalStockContractMetadata(
                        responseBefore,
                        {
                            requestedCode: contract.code,
                            expectedExchange: contract.exchange,
                        },
                    );
                const metadataAfter =
                    parseSmartOrderCanonicalStockContractMetadata(
                        responseAfter,
                        {
                            requestedCode: contract.code,
                            expectedExchange: contract.exchange,
                        },
                    );
                if (
                    canonicalJson(metadataBefore) !==
                    canonicalJson(metadataAfter)
                ) {
                    throw new Error(
                        'canonical contract metadata changed while fixed ATR was read',
                    );
                }
                response = responseAfter;
            } else if (
                current.fixedAtrRequired !== false ||
                current.decisionTradingDate !== null ||
                current.strategyDefinitionHash !== null
            ) {
                throw new TypeError(
                    'non-ATR contract evidence must not carry ATR context',
                );
            }
            return issueCanonicalContractEvidence({
                account,
                apiGeneration,
                contract,
                gate,
                response,
                runtimeEpochId,
                nowEpochMs: safeNow(config.nowEpochMs, 'nowEpochMs'),
                fixedAtrSource,
            });
        },
        async close() {
            if (closed) return publicStatus(state);
            closed = true;
            authenticatedAccounts = Object.freeze([]);
            if (retryHandle !== undefined) config.cancelRetry(retryHandle);
            cancelPeriodicReconciliation();
            connectionAbort?.abort();
            for (const controller of quoteMutationAborts) controller.abort();
            await quotePlanPump?.catch(() => {});
            await reconciliationInFlight?.catch(() => {});
            coordinator?.runtime.close();
            reconciliationCoordinator?.runtime.close();
            await readLoop?.catch(() => {});
            state.confirmedAccountCount = 0;
            state.state = 'closed';
            return publicStatus(state);
        },
    });
}
