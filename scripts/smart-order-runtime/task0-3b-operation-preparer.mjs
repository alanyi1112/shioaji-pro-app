import { types as utilTypes } from 'node:util';
import {
    assertSmartOrderTaskProbePinnedPriceCurrent,
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeReadonlyPreflight,
} from './task-probe-readonly-preflight.mjs';
import {
    buildSmartOrderTask03bOperationContract,
    smartOrderTask03bCustomField,
} from './task0-3b-operation-contract.mjs';
import {
    assertNoExistingSmartOrderTask03bRunTarget,
    verifySmartOrderTask03bCurrentTarget,
} from './task0-3b-target-lineage.mjs';

export const SMART_ORDER_TASK_0_3B_OPERATION_PREPARER_SCHEMA_VERSION =
    'smart-order-task-0.3b-operation-preparer/2026-08-24.1';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const issuedPreparedOperations = new WeakMap();
const issuedCandidateOperations = new WeakMap();

function operationPolicy(operation) {
    if (operation === 'place') {
        return Object.freeze({
            purpose: 'working_non_marketable',
            priceType: 'LMT',
            timeInForce: 'ROD',
            priceOrdinal: 1,
        });
    }
    if (operation === 'update_price') {
        return Object.freeze({
            purpose: 'working_non_marketable',
            priceType: 'LMT',
            timeInForce: 'ROD',
            priceOrdinal: 2,
        });
    }
    if (operation === 'cancel') {
        return Object.freeze({
            purpose: 'cancel_same_run_target',
            priceType: null,
            timeInForce: null,
            priceOrdinal: 0,
        });
    }
    throw new TypeError('Task 0.3b operation is invalid');
}

function marketPlanTarget(privateTarget) {
    if (privateTarget === null) return null;
    return Object.freeze({
        originRunId: privateTarget.originRunId,
        targetIdSha256: privateTarget.targetIdSha256,
        accountScopeSha256: privateTarget.accountScopeSha256,
        tradeDate: privateTarget.tradeDate,
        priceMinorUnits: privateTarget.priceMinorUnits,
        revision: privateTarget.revision,
    });
}

async function prepareOperation({
    appSupportRoot,
    expectedApiGeneration,
    observerReadiness,
    runId,
    operationId,
    nonce,
    operation,
    target = null,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    beforeRequest = async () => {},
    candidateOnly = false,
}) {
    if (
        !UUID.test(runId ?? '') ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        typeof fetchImpl !== 'function' ||
        utilTypes.isProxy(fetchImpl) ||
        typeof now !== 'function' ||
        utilTypes.isProxy(now) ||
        typeof beforeRequest !== 'function' ||
        utilTypes.isProxy(beforeRequest)
    ) {
        throw new TypeError('Task 0.3b preparer configuration is invalid');
    }
    const policy = operationPolicy(operation);
    if ((operation === 'place') !== (target === null)) {
        throw new TypeError('Task 0.3b preparer target is invalid');
    }
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot,
        expectedApiGeneration,
        observerReadiness,
        fetchImpl,
        now,
        beforeRequest,
        candidateOnly,
    });
    const privateReadonly = consumeSmartOrderTaskProbeReadonlyAuthority(
        readonly.authority,
    );
    const projection = readonly.projection;
    const planResult = buildSmartOrderTaskProbeMarketPlan({
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: '0.3b',
        runId,
        operation,
        purpose: policy.purpose,
        side: 'Buy',
        priceType: policy.priceType,
        timeInForce: policy.timeInForce,
        priceOrdinal: policy.priceOrdinal,
        quantityCommonLots: 1,
        accountScopeSha256: projection.accountScopeSha256,
        tradeDate: projection.tradeDate,
        sourceFingerprintSha256: projection.sourceFingerprintSha256,
        apiGenerationSha256: projection.apiGenerationSha256,
        positionsSha256: projection.positionsSha256,
        workingOrdersSha256: projection.workingOrdersSha256,
        nowEpochMs: now(),
        target: marketPlanTarget(target),
        contract: projection.contract,
        quote: projection.quote,
    });
    const operationContract = buildSmartOrderTask03bOperationContract({
        account: privateReadonly.account,
        marketPlan: planResult.plan,
        marketPlanSha256: planResult.planSha256,
        nonce,
        nowEpochMs: now(),
        operationId,
        target,
    });
    if (operation === 'place') {
        assertNoExistingSmartOrderTask03bRunTarget({
            account: privateReadonly.account,
            expectedCustomField: smartOrderTask03bCustomField(runId),
            refreshedTrades: privateReadonly.trades,
        });
    }
    const preparedAuthority = Object.freeze({});
    issuedPreparedOperations.set(
        preparedAuthority,
        Object.freeze({
            operationContract,
            marketPlan: planResult.plan,
            marketPlanSha256: planResult.planSha256,
            readonlyProjection: projection,
            account: privateReadonly.account,
            positions: privateReadonly.positions,
            trades: privateReadonly.trades,
            contract: privateReadonly.contract,
            quote: privateReadonly.quote,
            target,
        }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3B_OPERATION_PREPARER_SCHEMA_VERSION,
        preparedAuthority,
        publicSummary: operationContract.publicSummary,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}

export async function prepareSmartOrderTask03bOperation(input) {
    return prepareOperation(input);
}

export async function prepareSmartOrderTask03bCandidateOperation(input) {
    const candidate = await prepareOperation({
        ...input,
        observerReadiness: undefined,
        candidateOnly: true,
    });
    const value = consumePreparedSmartOrderTask03bOperation({
        preparedAuthority: candidate.preparedAuthority,
        nowEpochMs: input.now?.() ?? Date.now(),
    });
    const candidateAuthority = Object.freeze({});
    issuedCandidateOperations.set(candidateAuthority, Object.freeze({
        appSupportRoot: input.appSupportRoot,
        expectedApiGeneration: input.expectedApiGeneration,
        value,
        requestSha256: value.operationContract.canonical.envelope.requestSha256,
        accountScopeSha256: value.marketPlan.accountScopeSha256,
        validUntilEpochMs:
            value.operationContract.canonical.envelope.validUntilEpochMs,
    }));
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3B_OPERATION_PREPARER_SCHEMA_VERSION,
        candidateAuthority,
        operationId: input.operationId,
        runId: input.runId,
        operation: input.operation,
        requestSha256: value.operationContract.canonical.envelope.requestSha256,
        accountScopeSha256: value.marketPlan.accountScopeSha256,
        validUntilEpochMs:
            value.operationContract.canonical.envelope.validUntilEpochMs,
        observerReady: false,
        authorizationDisplayAllowed: false,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}

export async function prepareSmartOrderTask03bOperationAfterObserver({
    candidateAuthority,
    observerReadiness,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    beforeRequest = async () => {},
}) {
    if (!issuedCandidateOperations.has(candidateAuthority)) {
        throw new Error('Task 0.3b candidate operation is missing or consumed');
    }
    const candidate = issuedCandidateOperations.get(candidateAuthority);
    issuedCandidateOperations.delete(candidateAuthority);
    if (now() >= candidate.validUntilEpochMs) {
        throw new Error('Task 0.3b candidate operation expired before observer readiness');
    }
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot: candidate.appSupportRoot,
        expectedApiGeneration: candidate.expectedApiGeneration,
        observerReadiness,
        fetchImpl,
        now,
        beforeRequest,
    });
    const current = consumeSmartOrderTaskProbeReadonlyAuthority(readonly.authority);
    const value = candidate.value;
    if (
        readonly.projection.accountScopeSha256 !== candidate.accountScopeSha256 ||
        readonly.projection.sourceFingerprintSha256 !==
            value.marketPlan.sourceFingerprintSha256 ||
        readonly.projection.apiGenerationSha256 !==
            value.marketPlan.apiGenerationSha256 ||
        readonly.projection.tradeDate !== value.marketPlan.tradeDate ||
        readonly.projection.positionsSha256 !== value.marketPlan.positionsSha256 ||
        readonly.projection.workingOrdersSha256 !==
            value.marketPlan.workingOrdersSha256 ||
        readonly.projection.contract.evidenceSha256 !==
            value.marketPlan.contractEvidenceSha256
    ) {
        throw new Error('Task 0.3b candidate drifted before authorization display');
    }
    assertSmartOrderTaskProbePinnedPriceCurrent({
        plan: value.marketPlan,
        contract: readonly.projection.contract,
        quote: readonly.projection.quote,
    });
    if (value.target === null) {
        assertNoExistingSmartOrderTask03bRunTarget({
            account: current.account,
            expectedCustomField: smartOrderTask03bCustomField(value.marketPlan.runId),
            refreshedTrades: current.trades,
        });
    } else {
        verifySmartOrderTask03bCurrentTarget({
            account: current.account,
            target: value.target,
            refreshedTrades: current.trades,
        });
    }
    const preparedAuthority = Object.freeze({});
    issuedPreparedOperations.set(preparedAuthority, Object.freeze({
        ...value,
        readonlyProjection: readonly.projection,
        account: current.account,
        positions: current.positions,
        trades: current.trades,
        contract: current.contract,
        quote: current.quote,
    }));
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3B_OPERATION_PREPARER_SCHEMA_VERSION,
        preparedAuthority,
        publicSummary: value.operationContract.publicSummary,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}

export function consumePreparedSmartOrderTask03bOperation({
    preparedAuthority,
    nowEpochMs,
}) {
    if (
        !preparedAuthority ||
        typeof preparedAuthority !== 'object' ||
        !issuedPreparedOperations.has(preparedAuthority)
    ) {
        throw new Error('Task 0.3b prepared operation is missing or consumed');
    }
    const value = issuedPreparedOperations.get(preparedAuthority);
    issuedPreparedOperations.delete(preparedAuthority);
    if (
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs >=
            value.operationContract.canonical.envelope.validUntilEpochMs
    ) {
        throw new Error('Task 0.3b prepared operation expired before authorization');
    }
    return value;
}
