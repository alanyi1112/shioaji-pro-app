import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
    recalculateCanonicalPnlTotals,
} from './canonical-pnl-policy.mjs';
import { isVerifiedSmartOrderAccountReconciliationVerifier } from './account-reconciliation-verifier-authority.mjs';

export const SMART_ORDER_ACCOUNT_RECONCILIATION_SCHEMA_VERSION =
    'smart-order-account-reconciliation/2026-08-13.1';
export const SMART_ORDER_MAX_RECONCILIATION_ACCOUNTS = 32;
export const SMART_ORDER_MAX_RECONCILIATION_ROWS = 4096;
export const SMART_ORDER_MAX_RECONCILIATION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = Object.freeze([1_000, 2_000]);

const OPTION_KEYS = Object.freeze([
    'apiGeneration',
    'connectionId',
    'nowMonotonicMs',
    'runtimeEpochId',
    'tradeDate',
    'verifier',
]);
const ACCOUNT_KEYS = Object.freeze(['accountId', 'accountType', 'brokerId']);
const DEMAND_KEYS = Object.freeze(['account', 'consumerId']);
const SNAPSHOT_KEYS = Object.freeze([
    'account',
    'apiGeneration',
    'asOfEpochMs',
    'connectionId',
    'deals',
    'eventStreamWatermarkSha256',
    'fullDayDealsComplete',
    'fullDayFeesComplete',
    'fullDayTaxesComplete',
    'includesExternalClientActivity',
    'includesPreRuntimeActivity',
    'positions',
    'pnlPolicyDefinitionSha256',
    'pnlPolicyRevision',
    'reconciliationGeneration',
    'runtimeEpochId',
    'sourceRevision',
    'tradeDate',
    'workingOrders',
    'workingOrderSetComplete',
]);
const WORKING_ORDER_KEYS = Object.freeze([
    'brokerOrderId',
    'contractKey',
    'filledShares',
    'origin',
    'quantityShares',
    'remainingShares',
    'side',
    'state',
]);
const DEAL_KEYS = Object.freeze([
    'dealId',
    'feeMinorUnits',
    'realizedMinorUnits',
    'transactionTaxMinorUnits',
]);
const POSITION_KEYS = Object.freeze([
    'averagePriceMinorUnits',
    'availableShares',
    'contractKey',
    'lastPriceMinorUnits',
    'positionLineageId',
    'quantityShares',
    'unrealizedMinorUnits',
    'yesterdayQuantityShares',
]);
const FAILURE_KEYS = Object.freeze(['planId', 'reason']);
const FAILURE_REASONS = new Set([
    'positions_failed',
    'read_result_unknown',
    'trades_failed',
    'update_status_failed',
]);
const WORKING_STATES = new Set([
    'PendingSubmit',
    'PreSubmitted',
    'Submitted',
    'PartFilled',
    'Unknown',
]);
const consumedReconciliationEvidenceSha256 = new Set();
const currentReconciliationSourceHeadByScope = new Map();
const issuedReconciliationResults = new WeakMap();

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isProxy(value) {
    try {
        return utilTypes.isProxy(value);
    } catch {
        return true;
    }
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function snapshotExact(value, expectedKeys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        isProxy(value)
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} descriptors are unavailable`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} must be a plain object`);
    }
    const actual = Reflect.ownKeys(descriptors);
    const expected = [...expectedKeys].sort();
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== expected.length ||
        !actual.sort().every((key, index) => key === expected[index])
    ) {
        throw new TypeError(`${label} schema is invalid`);
    }
    const snapshot = {};
    for (const key of expectedKeys) {
        const descriptor = descriptors[key];
        if (
            !descriptor?.enumerable ||
            !Object.hasOwn(descriptor, 'value') ||
            Object.hasOwn(descriptor, 'get') ||
            Object.hasOwn(descriptor, 'set')
        ) {
            throw new TypeError(`${label} must use own data properties`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function snapshotArray(value, maximum, normalize, label) {
    if (!Array.isArray(value) || isProxy(value) || value.length > maximum) {
        throw new TypeError(`${label} is invalid`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = [
        ...Array.from({ length: value.length }, (_, index) => String(index)),
        'length',
    ].sort();
    const actual = Reflect.ownKeys(descriptors);
    if (
        actual.some((key) => typeof key !== 'string') ||
        actual.length !== expected.length ||
        !actual.sort().every((key, index) => key === expected[index])
    ) {
        throw new TypeError(`${label} is sparse or extended`);
    }
    return Object.freeze(
        Array.from({ length: value.length }, (_, index) => {
            const descriptor = descriptors[String(index)];
            if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(`${label} contains an accessor`);
            }
            return normalize(descriptor.value, `${label}[${index}]`);
        }),
    );
}

function token(value, label, maximum = 256) {
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

function digest(value, label) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function nonnegative(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function signed(value, label) {
    if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${label} must be a safe integer`);
    }
    return value;
}

function safeAdd(left, right, label) {
    const value = left + right;
    if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${label} exceeds safe integer bounds`);
    }
    return value;
}

function bool(value, label) {
    if (typeof value !== 'boolean') throw new TypeError(`${label} is invalid`);
    return value;
}

function tradeDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new TypeError('tradeDate is invalid');
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new TypeError('tradeDate is invalid');
    }
    return value;
}

function account(value) {
    const input = snapshotExact(value, ACCOUNT_KEYS, 'fixed account');
    if (input.accountType !== 'S') {
        throw new TypeError('fixed account must be a stock account');
    }
    return Object.freeze({
        accountId: token(input.accountId, 'account.accountId', 128),
        accountType: 'S',
        brokerId: token(input.brokerId, 'account.brokerId', 128),
    });
}

function accountKey(value) {
    return canonicalJson([
        value.brokerId,
        value.accountId,
        value.accountType,
    ]);
}

function accountScopeSha256(value) {
    return sha256(`smart-order-reconciliation-account\u001f${accountKey(value)}`);
}

function sourceHeadScopeSha256({
    accountScopeSha256: accountScope,
    tradeDate: currentTradeDate,
}) {
    return sha256(canonicalJson([
        'smart-order-account-reconciliation-source-head/2026-08-13.1',
        currentTradeDate,
        accountScope,
    ]));
}

function sourceHeadAccepts(scopeSha256, snapshot) {
    const current = currentReconciliationSourceHeadByScope.get(scopeSha256);
    if (!current) {
        return (
            currentReconciliationSourceHeadByScope.size <
            SMART_ORDER_MAX_RECONCILIATION_ROWS
        );
    }
    return !(
        snapshot.asOfEpochMs < current.asOfEpochMs ||
        (snapshot.asOfEpochMs === current.asOfEpochMs &&
            (snapshot.sourceRevision !== current.sourceRevision ||
                snapshot.sourceSnapshotSha256 !== current.sourceSnapshotSha256))
    );
}

export function currentSmartOrderAccountReconciliationProjection(value) {
    const issued = issuedReconciliationResults.get(value);
    if (!issued || issued.result !== value) return undefined;
    const current = currentReconciliationSourceHeadByScope.get(
        issued.sourceHeadScopeSha256,
    );
    if (
        !current ||
        current.asOfEpochMs !== issued.head.asOfEpochMs ||
        current.sourceRevision !== issued.head.sourceRevision ||
        current.sourceSnapshotSha256 !== issued.head.sourceSnapshotSha256
    ) {
        return undefined;
    }
    return issued.projection;
}

function deny(reason, details = {}) {
    return deepFreeze({
        allowed: false,
        reason,
        ...details,
        repositoryMutationAuthority: false,
        runtimeReadinessContribution: false,
        brokerWriteAuthority: false,
    });
}

function verifier(value) {
    if (value === null) return null;
    const snapshot = snapshotExact(
        value,
        ['verifySnapshotEvidence'],
        'account reconciliation verifier',
    );
    if (
        typeof snapshot.verifySnapshotEvidence !== 'function' ||
        isProxy(snapshot.verifySnapshotEvidence) ||
        !isVerifiedSmartOrderAccountReconciliationVerifier(value)
    ) {
        throw new TypeError('account reconciliation verifier is not authority-issued');
    }
    return Object.freeze({
        receiver: value,
        verifySnapshotEvidence: snapshot.verifySnapshotEvidence,
    });
}

function verifiedDigest(value) {
    try {
        const result = snapshotExact(
            value,
            ['evidenceSha256', 'valid'],
            'reconciliation verification result',
        );
        return result.valid === true
            ? digest(result.evidenceSha256, 'verification.evidenceSha256')
            : undefined;
    } catch {
        return undefined;
    }
}

function workingOrder(value, label) {
    const input = snapshotExact(value, WORKING_ORDER_KEYS, label);
    const quantityShares = nonnegative(input.quantityShares, `${label}.quantityShares`);
    const filledShares = nonnegative(input.filledShares, `${label}.filledShares`);
    const remainingShares = nonnegative(input.remainingShares, `${label}.remainingShares`);
    if (
        quantityShares < 1 ||
        remainingShares < 1 ||
        filledShares + remainingShares !== quantityShares ||
        !['Buy', 'Sell'].includes(input.side) ||
        !['external', 'runtime'].includes(input.origin) ||
        !WORKING_STATES.has(input.state)
    ) {
        throw new TypeError(`${label} invariant is invalid`);
    }
    return Object.freeze({
        brokerOrderId: token(input.brokerOrderId, `${label}.brokerOrderId`),
        contractKey: token(input.contractKey, `${label}.contractKey`),
        filledShares,
        origin: input.origin,
        quantityShares,
        remainingShares,
        side: input.side,
        state: input.state,
    });
}

function deal(value, label) {
    const input = snapshotExact(value, DEAL_KEYS, label);
    const feeMinorUnits = nonnegative(input.feeMinorUnits, `${label}.feeMinorUnits`);
    const transactionTaxMinorUnits = nonnegative(
        input.transactionTaxMinorUnits,
        `${label}.transactionTaxMinorUnits`,
    );
    return Object.freeze({
        dealId: token(input.dealId, `${label}.dealId`),
        feeMinorUnits,
        realizedMinorUnits: signed(
            input.realizedMinorUnits,
            `${label}.realizedMinorUnits`,
        ),
        transactionTaxMinorUnits,
    });
}

function position(value, label) {
    const input = snapshotExact(value, POSITION_KEYS, label);
    const quantityShares = nonnegative(input.quantityShares, `${label}.quantityShares`);
    const availableShares = nonnegative(input.availableShares, `${label}.availableShares`);
    if (availableShares > quantityShares) {
        throw new TypeError(`${label} available shares exceed position`);
    }
    return Object.freeze({
        averagePriceMinorUnits: nonnegative(
            input.averagePriceMinorUnits,
            `${label}.averagePriceMinorUnits`,
        ),
        availableShares,
        contractKey: token(input.contractKey, `${label}.contractKey`),
        lastPriceMinorUnits: nonnegative(
            input.lastPriceMinorUnits,
            `${label}.lastPriceMinorUnits`,
        ),
        positionLineageId: token(
            input.positionLineageId,
            `${label}.positionLineageId`,
        ),
        quantityShares,
        unrealizedMinorUnits: signed(
            input.unrealizedMinorUnits,
            `${label}.unrealizedMinorUnits`,
        ),
        yesterdayQuantityShares: nonnegative(
            input.yesterdayQuantityShares,
            `${label}.yesterdayQuantityShares`,
        ),
    });
}

function uniqueSorted(values, keyOf, label) {
    const byKey = new Map();
    for (const value of values) {
        const key = keyOf(value);
        const previous = byKey.get(key);
        if (previous && canonicalJson(previous) !== canonicalJson(value)) {
            throw new TypeError(`${label} contains conflicting duplicate keys`);
        }
        byKey.set(key, value);
    }
    return Object.freeze([...byKey.values()].sort((left, right) =>
        keyOf(left).localeCompare(keyOf(right)),
    ));
}

function normalizeSnapshot(value) {
    const input = snapshotExact(value, SNAPSHOT_KEYS, 'reconciliation snapshot');
    const canonicalAccount = account(input.account);
    const workingOrders = uniqueSorted(
        snapshotArray(
            input.workingOrders,
            SMART_ORDER_MAX_RECONCILIATION_ROWS,
            workingOrder,
            'workingOrders',
        ),
        (entry) => entry.brokerOrderId,
        'workingOrders',
    );
    const deals = uniqueSorted(
        snapshotArray(
            input.deals,
            SMART_ORDER_MAX_RECONCILIATION_ROWS,
            deal,
            'deals',
        ),
        (entry) => entry.dealId,
        'deals',
    );
    const positions = uniqueSorted(
        snapshotArray(
            input.positions,
            SMART_ORDER_MAX_RECONCILIATION_ROWS,
            position,
            'positions',
        ),
        (entry) => entry.contractKey,
        'positions',
    );
    const projection = {
        account: canonicalAccount,
        apiGeneration: token(input.apiGeneration, 'apiGeneration'),
        asOfEpochMs: nonnegative(input.asOfEpochMs, 'asOfEpochMs'),
        connectionId: token(input.connectionId, 'connectionId'),
        deals,
        eventStreamWatermarkSha256: digest(
            input.eventStreamWatermarkSha256,
            'eventStreamWatermarkSha256',
        ),
        fullDayDealsComplete: bool(
            input.fullDayDealsComplete,
            'fullDayDealsComplete',
        ),
        fullDayFeesComplete: bool(
            input.fullDayFeesComplete,
            'fullDayFeesComplete',
        ),
        fullDayTaxesComplete: bool(
            input.fullDayTaxesComplete,
            'fullDayTaxesComplete',
        ),
        includesExternalClientActivity: bool(
            input.includesExternalClientActivity,
            'includesExternalClientActivity',
        ),
        includesPreRuntimeActivity: bool(
            input.includesPreRuntimeActivity,
            'includesPreRuntimeActivity',
        ),
        positions,
        pnlPolicyDefinitionSha256: digest(
            input.pnlPolicyDefinitionSha256,
            'pnlPolicyDefinitionSha256',
        ),
        pnlPolicyRevision: token(
            input.pnlPolicyRevision,
            'pnlPolicyRevision',
        ),
        reconciliationGeneration: nonnegative(
            input.reconciliationGeneration,
            'reconciliationGeneration',
        ),
        runtimeEpochId: token(input.runtimeEpochId, 'runtimeEpochId'),
        sourceRevision: token(input.sourceRevision, 'sourceRevision'),
        tradeDate: tradeDate(input.tradeDate),
        workingOrders,
        workingOrderSetComplete: bool(
            input.workingOrderSetComplete,
            'workingOrderSetComplete',
        ),
    };
    const {
        reconciliationGeneration: _reconciliationGeneration,
        ...sourceProjection
    } = projection;
    if (
        projection.pnlPolicyDefinitionSha256 !==
            SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256 ||
        projection.pnlPolicyRevision !==
            SMART_ORDER_CANONICAL_PNL_POLICY_REVISION
    ) {
        throw new TypeError('reconciliation PnL policy binding is not current');
    }
    return deepFreeze({
        ...projection,
        sourceSnapshotSha256: sha256(canonicalJson(sourceProjection)),
        snapshotSha256: sha256(canonicalJson(projection)),
    });
}

export function canonicalSmartOrderAccountReconciliationSnapshot(value) {
    return normalizeSnapshot(value);
}

export function createSmartOrderAccountReconciliationCoordinator(options) {
    const constructor = snapshotExact(
        options,
        OPTION_KEYS,
        'account reconciliation coordinator options',
    );
    const apiGeneration = token(constructor.apiGeneration, 'apiGeneration');
    const connectionId = token(constructor.connectionId, 'connectionId');
    const runtimeEpochId = token(constructor.runtimeEpochId, 'runtimeEpochId');
    const currentTradeDate = tradeDate(constructor.tradeDate);
    if (
        typeof constructor.nowMonotonicMs !== 'function' ||
        isProxy(constructor.nowMonotonicMs)
    ) {
        throw new TypeError('nowMonotonicMs must be a non-Proxy function');
    }
    const transportVerifier = verifier(constructor.verifier);
    const accounts = new Map();
    const handles = new WeakMap();
    const plans = new WeakMap();
    const pendingPlans = new Map();
    let lastMonotonicMs = -1;
    let clockInvalid = false;
    let closed = false;

    function now() {
        if (clockInvalid) return undefined;
        let value;
        try {
            value = Reflect.apply(constructor.nowMonotonicMs, undefined, []);
        } catch {
            clockInvalid = true;
            return undefined;
        }
        if (
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value < lastMonotonicMs
        ) {
            clockInvalid = true;
            return undefined;
        }
        lastMonotonicMs = value;
        return value;
    }
    if (now() === undefined) throw new TypeError('initial monotonic clock is invalid');

    function issuePlan(record) {
        if (
            closed ||
            !transportVerifier ||
            record.pendingPlanId ||
            ['read_result_unknown', 'retry_exhausted', 'clock_invalid'].includes(
                record.state,
            )
        ) {
            return undefined;
        }
        const issuedAtMonotonicMs = now();
        if (issuedAtMonotonicMs === undefined) {
            record.state = 'clock_invalid';
            return undefined;
        }
        const reconciliationGeneration = record.reconciliationGeneration + 1;
        const planId = `account-reconciliation-plan:${sha256(canonicalJson([
            SMART_ORDER_ACCOUNT_RECONCILIATION_SCHEMA_VERSION,
            runtimeEpochId,
            apiGeneration,
            connectionId,
            currentTradeDate,
            record.accountScopeSha256,
            reconciliationGeneration,
            record.retryAttempt,
        ])).slice(7)}`;
        const plan = deepFreeze({
            schemaVersion: SMART_ORDER_ACCOUNT_RECONCILIATION_SCHEMA_VERSION,
            planId,
            account: record.account,
            accountScopeSha256: record.accountScopeSha256,
            runtimeEpochId,
            apiGeneration,
            connectionId,
            tradeDate: currentTradeDate,
            reconciliationGeneration,
            attempt: record.retryAttempt,
            maximumAttempts: SMART_ORDER_MAX_RECONCILIATION_ATTEMPTS,
            phases: Object.freeze(['update_status', 'trades', 'positions']),
            issuedAtMonotonicMs,
            boundedReadOnlyOperationCount: 3,
            automaticRetryAllowedBeforeUnknown: true,
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        record.pendingPlanId = planId;
        pendingPlans.set(planId, { plan, record });
        plans.set(plan, { plan, record });
        return plan;
    }

    function acquire(input) {
        if (closed) return deny('reconciliation_coordinator_closed');
        let demand;
        let canonicalAccount;
        try {
            demand = snapshotExact(input, DEMAND_KEYS, 'reconciliation demand');
            canonicalAccount = account(demand.account);
            token(demand.consumerId, 'consumerId');
        } catch {
            return deny('reconciliation_demand_invalid');
        }
        const key = accountKey(canonicalAccount);
        if (accounts.has(key)) return deny('reconciliation_account_duplicate');
        if (accounts.size >= SMART_ORDER_MAX_RECONCILIATION_ACCOUNTS) {
            return deny('reconciliation_account_capacity_exhausted');
        }
        const handle = deepFreeze({
            schemaVersion: SMART_ORDER_ACCOUNT_RECONCILIATION_SCHEMA_VERSION,
            handleClass: 'fixed_account_reconciliation',
            accountScopeSha256: accountScopeSha256(canonicalAccount),
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        const record = {
            account: canonicalAccount,
            accountScopeSha256: handle.accountScopeSha256,
            handle,
            pendingPlanId: null,
            reconciliationGeneration: 0,
            retryAttempt: 1,
            retryNotBeforeMonotonicMs: 0,
            latest: null,
            latestHead: null,
            sourceHeadScopeSha256: sourceHeadScopeSha256({
                accountScopeSha256: handle.accountScopeSha256,
                tradeDate: currentTradeDate,
            }),
            state: transportVerifier ? 'reconciling' : 'transport_unintegrated',
            verificationInProgress: false,
        };
        accounts.set(key, record);
        handles.set(handle, record);
        issuePlan(record);
        return handle;
    }

    function planNext(handle) {
        if (closed) return deny('reconciliation_coordinator_closed');
        const record = handles.get(handle);
        if (!record || record.handle !== handle) {
            return deny('reconciliation_handle_invalid');
        }
        if (record.pendingPlanId) return deny('reconciliation_plan_already_pending');
        if (record.state === 'read_result_unknown') {
            return deny('reconciliation_read_result_unknown', {
                reconciliationRequired: true,
                automaticRetryAllowed: false,
            });
        }
        if (record.state === 'retry_exhausted') {
            return deny('reconciliation_retry_exhausted', {
                reconciliationRequired: true,
                automaticRetryAllowed: false,
            });
        }
        if (record.state === 'clock_invalid') {
            return deny('reconciliation_clock_invalid', {
                reconciliationRequired: true,
                automaticRetryAllowed: false,
            });
        }
        if (record.retryNotBeforeMonotonicMs > 0) {
            const current = now();
            if (current === undefined) {
                record.state = 'clock_invalid';
                return deny('reconciliation_clock_invalid', {
                    reconciliationRequired: true,
                    automaticRetryAllowed: false,
                });
            }
            if (current < record.retryNotBeforeMonotonicMs) {
                return deny('reconciliation_retry_backoff', {
                    retryNotBeforeMonotonicMs:
                        record.retryNotBeforeMonotonicMs,
                    reconciliationRequired: true,
                    automaticRetryAllowed: false,
                });
            }
            record.retryNotBeforeMonotonicMs = 0;
        }
        const plan = issuePlan(record);
        if (plan) return plan;
        return record.state === 'clock_invalid'
            ? deny('reconciliation_clock_invalid', {
                  reconciliationRequired: true,
                  automaticRetryAllowed: false,
              })
            : deny('reconciliation_transport_unintegrated');
    }

    function submit(plan, snapshot, evidence) {
        if (closed) return deny('reconciliation_coordinator_closed');
        const issued = plans.get(plan);
        if (!issued || issued.plan !== plan || !transportVerifier) {
            return deny('reconciliation_plan_invalid');
        }
        const pending = pendingPlans.get(plan.planId);
        if (
            !pending ||
            pending.plan !== plan ||
            pending.record !== issued.record ||
            issued.record.pendingPlanId !== plan.planId
        ) {
            return deny('reconciliation_plan_not_current');
        }
        if (issued.record.verificationInProgress) {
            return deny('reconciliation_verification_reentrant', {
                reconciliationRequired: true,
            });
        }
        let normalized;
        try {
            normalized = normalizeSnapshot(snapshot);
        } catch {
            issued.record.state = 'snapshot_invalid';
            return deny('reconciliation_snapshot_invalid', {
                reconciliationRequired: true,
            });
        }
        if (
            accountKey(normalized.account) !== accountKey(issued.record.account) ||
            normalized.runtimeEpochId !== runtimeEpochId ||
            normalized.apiGeneration !== apiGeneration ||
            normalized.connectionId !== connectionId ||
            normalized.tradeDate !== currentTradeDate ||
            normalized.reconciliationGeneration !==
                plan.reconciliationGeneration
        ) {
            issued.record.state = 'scope_mismatch';
            return deny('reconciliation_snapshot_scope_mismatch', {
                reconciliationRequired: true,
            });
        }
        if (
            !sourceHeadAccepts(
                issued.record.sourceHeadScopeSha256,
                normalized,
            )
        ) {
            issued.record.state = 'source_head_conflict';
            return deny('reconciliation_source_head_not_current', {
                reconciliationRequired: true,
            });
        }
        let verification;
        issued.record.verificationInProgress = true;
        try {
            verification = Reflect.apply(
                transportVerifier.verifySnapshotEvidence,
                transportVerifier.receiver,
                [
                    evidence,
                    Object.freeze({
                        accountScopeSha256: issued.record.accountScopeSha256,
                        apiGeneration,
                        connectionId,
                        planId: plan.planId,
                        reconciliationGeneration: plan.reconciliationGeneration,
                        runtimeEpochId,
                        snapshotSha256: normalized.snapshotSha256,
                        sourceSnapshotSha256:
                            normalized.sourceSnapshotSha256,
                        sourceRevision: normalized.sourceRevision,
                        tradeDate: currentTradeDate,
                    }),
                ],
            );
        } catch {
            verification = undefined;
        } finally {
            issued.record.verificationInProgress = false;
        }
        const evidenceSha256 = verifiedDigest(verification);
        const currentPending = pendingPlans.get(plan.planId);
        if (
            !evidenceSha256 ||
            !currentPending ||
            currentPending.plan !== plan ||
            currentPending.record !== issued.record ||
            issued.record.pendingPlanId !== plan.planId ||
            closed ||
            consumedReconciliationEvidenceSha256.has(evidenceSha256) ||
            consumedReconciliationEvidenceSha256.size >=
                SMART_ORDER_MAX_RECONCILIATION_ROWS
        ) {
            issued.record.state = 'evidence_invalid';
            return deny('reconciliation_evidence_invalid', {
                reconciliationRequired: true,
            });
        }
        if (
            !sourceHeadAccepts(
                issued.record.sourceHeadScopeSha256,
                normalized,
            )
        ) {
            issued.record.state = 'source_head_conflict';
            return deny('reconciliation_source_head_not_current', {
                reconciliationRequired: true,
            });
        }
        const coverageComplete = Boolean(
            normalized.workingOrderSetComplete &&
                normalized.fullDayDealsComplete &&
                normalized.fullDayFeesComplete &&
                normalized.fullDayTaxesComplete &&
                normalized.includesPreRuntimeActivity &&
                normalized.includesExternalClientActivity,
        );
        const positionsByContract = new Map(
            normalized.positions.map((entry) => [entry.contractKey, entry]),
        );
        const externalWorkingSells = normalized.workingOrders.filter(
            (entry) => entry.origin === 'external' && entry.side === 'Sell',
        );
        const externalClaimsFullyScoped = externalWorkingSells.every((entry) =>
            positionsByContract.has(entry.contractKey),
        );
        const externalClaimsAllKnown = externalWorkingSells.every(
            (entry) => entry.state !== 'Unknown',
        );
        const externalRemainingSharesByContract = new Map();
        let externalClaimsFitPosition = true;
        try {
            for (const entry of externalWorkingSells) {
                externalRemainingSharesByContract.set(
                    entry.contractKey,
                    safeAdd(
                        externalRemainingSharesByContract.get(entry.contractKey) ?? 0,
                        entry.remainingShares,
                        'externalRemainingShares',
                    ),
                );
            }
            externalClaimsFitPosition = [...externalRemainingSharesByContract].every(
                ([contractKey, remainingShares]) =>
                    remainingShares <=
                    (positionsByContract.get(contractKey)?.quantityShares ?? -1),
            );
        } catch {
            externalClaimsFitPosition = false;
        }
        const externalSellClaimCandidates = Object.freeze(
            externalWorkingSells
                .map((entry) => deepFreeze({
                    candidateId: `external-sell-claim:${sha256(canonicalJson([
                        issued.record.accountScopeSha256,
                        currentTradeDate,
                        entry.brokerOrderId,
                        entry.contractKey,
                    ])).slice(7)}`,
                    accountScopeSha256: issued.record.accountScopeSha256,
                    brokerOrderId: entry.brokerOrderId,
                    contractKey: entry.contractKey,
                    positionLineageId:
                        positionsByContract.get(entry.contractKey)
                            ?.positionLineageId ?? null,
                    quantityShares: entry.remainingShares,
                    state: entry.state === 'Unknown' ? 'unknown' : 'broker_working',
                    evidenceSha256,
                    repositoryMutationAuthority: false,
                })),
        );
        let totals;
        try {
            totals = recalculateCanonicalPnlTotals({
                deals: normalized.deals,
                positions: normalized.positions,
            });
        } catch {
            issued.record.state = 'snapshot_invalid';
            return deny('reconciliation_snapshot_invalid', {
                reconciliationRequired: true,
            });
        }
        const result = deepFreeze({
            allowed: true,
            state: coverageComplete
                ? externalClaimsFullyScoped
                    ? externalClaimsFitPosition
                        ? externalClaimsAllKnown
                            ? 'coverage_verified_offline'
                            : 'external_claim_unknown'
                        : 'external_claim_quantity_conflict'
                    : 'external_claim_scope_incomplete'
                : 'coverage_incomplete',
            accountScopeSha256: issued.record.accountScopeSha256,
            reconciliationGeneration: plan.reconciliationGeneration,
            snapshotSha256: normalized.snapshotSha256,
            evidenceSha256,
            eventStreamWatermarkSha256:
                normalized.eventStreamWatermarkSha256,
            workingOrderCount: normalized.workingOrders.length,
            externalWorkingSellCount: externalSellClaimCandidates.length,
            positionCount: normalized.positions.length,
            dealCount: normalized.deals.length,
            fullDayTotals: Object.freeze(totals),
            coverageComplete:
                coverageComplete &&
                externalClaimsFullyScoped &&
                externalClaimsFitPosition &&
                externalClaimsAllKnown,
            externalSellClaimCandidates,
            automaticWriteAllowed: false,
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
        consumedReconciliationEvidenceSha256.add(evidenceSha256);
        pendingPlans.delete(plan.planId);
        issued.record.pendingPlanId = null;
        issued.record.reconciliationGeneration = plan.reconciliationGeneration;
        issued.record.retryAttempt = 1;
        issued.record.retryNotBeforeMonotonicMs = 0;
        issued.record.latestHead = Object.freeze({
            asOfEpochMs: normalized.asOfEpochMs,
            sourceRevision: normalized.sourceRevision,
            sourceSnapshotSha256: normalized.sourceSnapshotSha256,
        });
        currentReconciliationSourceHeadByScope.set(
            issued.record.sourceHeadScopeSha256,
            issued.record.latestHead,
        );
        issuedReconciliationResults.set(result, {
            result,
            sourceHeadScopeSha256: issued.record.sourceHeadScopeSha256,
            head: issued.record.latestHead,
            projection: deepFreeze({
                schemaVersion:
                    'smart-order-account-reconciliation-projection/2026-08-13.2',
                account: normalized.account,
                tradeDate: normalized.tradeDate,
                asOfEpochMs: normalized.asOfEpochMs,
                sourceRevision: normalized.sourceRevision,
                sourceSnapshotSha256: normalized.sourceSnapshotSha256,
                snapshotSha256: normalized.snapshotSha256,
                evidenceSha256,
                eventStreamWatermarkSha256:
                    normalized.eventStreamWatermarkSha256,
                deals: normalized.deals,
                fullDayTotals: result.fullDayTotals,
                pnlPolicyDefinitionSha256:
                    normalized.pnlPolicyDefinitionSha256,
                pnlPolicyRevision: normalized.pnlPolicyRevision,
                positions: normalized.positions,
                workingOrders: normalized.workingOrders,
                coverageComplete: result.coverageComplete,
                externalSellClaimCandidates:
                    result.externalSellClaimCandidates,
                reconciliationGeneration:
                    result.reconciliationGeneration,
            }),
        });
        issued.record.latest = result;
        issued.record.state = result.state;
        return result;
    }

    function reportFailure(plan, input) {
        if (closed) return deny('reconciliation_coordinator_closed');
        const issued = plans.get(plan);
        let failure;
        try {
            failure = snapshotExact(input, FAILURE_KEYS, 'reconciliation failure');
        } catch {
            return deny('reconciliation_failure_invalid');
        }
        if (
            !issued ||
            issued.plan !== plan ||
            failure.planId !== plan.planId ||
            !FAILURE_REASONS.has(failure.reason) ||
            issued.record.pendingPlanId !== plan.planId
        ) {
            return deny('reconciliation_failure_invalid');
        }
        pendingPlans.delete(plan.planId);
        issued.record.pendingPlanId = null;
        let explicitRetryAllowed = false;
        let retryNotBeforeMonotonicMs;
        if (failure.reason === 'read_result_unknown') {
            issued.record.state = failure.reason;
        } else if (plan.attempt >= SMART_ORDER_MAX_RECONCILIATION_ATTEMPTS) {
            issued.record.state = 'retry_exhausted';
        } else {
            const current = now();
            if (current === undefined) {
                issued.record.state = 'clock_invalid';
            } else {
                issued.record.retryAttempt = plan.attempt + 1;
                retryNotBeforeMonotonicMs =
                    current + RETRY_BACKOFF_MS[plan.attempt - 1];
                issued.record.retryNotBeforeMonotonicMs =
                    retryNotBeforeMonotonicMs;
                issued.record.state = failure.reason;
                explicitRetryAllowed = true;
            }
        }
        return deepFreeze({
            allowed: true,
            state: issued.record.state,
            explicitRetryAllowed,
            ...(retryNotBeforeMonotonicMs === undefined
                ? {}
                : { retryNotBeforeMonotonicMs }),
            reconciliationRequired: true,
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    }

    function status() {
        return deepFreeze({
            schemaVersion: SMART_ORDER_ACCOUNT_RECONCILIATION_SCHEMA_VERSION,
            runtimeEpochIdSha256: sha256(
                `smart-order-runtime-epoch\u001f${runtimeEpochId}`,
            ),
            apiGenerationSha256: sha256(
                `smart-order-api-generation\u001f${apiGeneration}`,
            ),
            connectionIdSha256: sha256(
                `smart-order-trade-connection\u001f${connectionId}`,
            ),
            tradeDate: currentTradeDate,
            fixedAccountCount: accounts.size,
            pendingPlanCount: pendingPlans.size,
            coverageCompleteCount: [...accounts.values()].filter(
                (entry) => entry.latest?.coverageComplete === true,
            ).length,
            transportVerifierConfigured: Boolean(transportVerifier),
            productionAdapterConfigured: false,
            reconciliationRequired: true,
            clockInvalid,
            closed,
            accountIdentifiersExposed: false,
            repositoryMutationAuthority: false,
            runtimeReadinessContribution: false,
            brokerWriteAuthority: false,
        });
    }

    function close() {
        closed = true;
        pendingPlans.clear();
        for (const record of accounts.values()) {
            record.pendingPlanId = null;
            record.state = 'closed_reconciliation_unknown';
        }
        return status();
    }

    return Object.freeze({
        observer: Object.freeze({
            pendingPlans() {
                return Object.freeze(
                    [...pendingPlans.values()]
                        .map((entry) => entry.plan)
                        .sort((left, right) =>
                            left.accountScopeSha256.localeCompare(
                                right.accountScopeSha256,
                            ),
                        ),
                );
            },
            status,
        }),
        runtime: Object.freeze({ acquire, close, planNext, reportFailure, submit }),
    });
}
