import { types as utilTypes } from 'node:util';
import {
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    assertSmartOrderTaskProbePinnedPriceCurrent,
    buildSmartOrderTaskProbeMarketPlan,
} from './task-probe-market-plan.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeReadonlyPreflight,
} from './task-probe-readonly-preflight.mjs';
import {
    buildSmartOrderTask03cOperationContract,
    smartOrderTask03cCustomField,
} from './task0-3c-operation-contract.mjs';
import { assertSmartOrderTask03cExternalSellBaseline } from './task0-3c-working-set.mjs';

export const SMART_ORDER_TASK_0_3C_OPERATION_PREPARER_SCHEMA_VERSION =
    'smart-order-task-0.3c-operation-preparer/2026-08-27.1';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const issuedPreparedOperations = new WeakMap();
const issuedCandidateOperations = new WeakMap();

async function prepareOperation({
    appSupportRoot,
    expectedApiGeneration,
    observerReadiness,
    runId,
    operationId,
    nonce,
    operationOrdinal,
    previousTargets = [],
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    beforeRequest = async () => {},
    candidateOnly = false,
}) {
    if (
        !UUID.test(runId ?? '') ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        ![1, 2].includes(operationOrdinal) ||
        !Array.isArray(previousTargets) ||
        previousTargets.length !== operationOrdinal - 1 ||
        typeof fetchImpl !== 'function' ||
        utilTypes.isProxy(fetchImpl) ||
        typeof now !== 'function' ||
        utilTypes.isProxy(now) ||
        typeof beforeRequest !== 'function' ||
        utilTypes.isProxy(beforeRequest)
    ) {
        throw new TypeError('Task 0.3c preparer configuration is invalid');
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
    const baseline = assertSmartOrderTask03cExternalSellBaseline({
        account: privateReadonly.account,
        contractUnit: privateReadonly.contract.contractUnit,
        expectedCustomField: smartOrderTask03cCustomField(
            runId,
            operationOrdinal,
        ),
        operationOrdinal,
        positions: privateReadonly.positions,
        previousTargets,
        trades: privateReadonly.trades,
    });
    const projection = readonly.projection;
    const planResult = buildSmartOrderTaskProbeMarketPlan({
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: '0.3c',
        runId,
        operation: 'place',
        purpose: 'working_non_marketable',
        side: 'Sell',
        priceType: 'LMT',
        timeInForce: 'ROD',
        priceOrdinal: operationOrdinal,
        quantityCommonLots: 1,
        accountScopeSha256: projection.accountScopeSha256,
        tradeDate: projection.tradeDate,
        sourceFingerprintSha256: projection.sourceFingerprintSha256,
        apiGenerationSha256: projection.apiGenerationSha256,
        positionsSha256: projection.positionsSha256,
        workingOrdersSha256: projection.workingOrdersSha256,
        nowEpochMs: now(),
        target: null,
        contract: projection.contract,
        quote: projection.quote,
    });
    const operationContract = buildSmartOrderTask03cOperationContract({
        account: privateReadonly.account,
        marketPlan: planResult.plan,
        marketPlanSha256: planResult.planSha256,
        nonce,
        nowEpochMs: now(),
        operationId,
        operationOrdinal,
    });
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
            operationOrdinal,
            previousTargets: Object.freeze([...previousTargets]),
            baseline,
            target: null,
        }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_OPERATION_PREPARER_SCHEMA_VERSION,
        preparedAuthority,
        publicSummary: Object.freeze({
            ...operationContract.publicSummary,
            baselineWorkingSellCount: baseline.workingSellCount,
            baselineWorkingSetSha256: baseline.workingSetSha256,
            positionQuantityShares: baseline.position.quantityShares,
        }),
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}

export async function prepareSmartOrderTask03cCandidateOperation(input) {
    const candidate = await prepareOperation({
        ...input,
        observerReadiness: undefined,
        candidateOnly: true,
    });
    const value = consumePreparedSmartOrderTask03cOperation({
        preparedAuthority: candidate.preparedAuthority,
        nowEpochMs: input.now?.() ?? Date.now(),
    });
    const candidateAuthority = Object.freeze({});
    issuedCandidateOperations.set(
        candidateAuthority,
        Object.freeze({
            appSupportRoot: input.appSupportRoot,
            expectedApiGeneration: input.expectedApiGeneration,
            value,
            requestSha256:
                value.operationContract.canonical.envelope.requestSha256,
            accountScopeSha256: value.marketPlan.accountScopeSha256,
            validUntilEpochMs:
                value.operationContract.canonical.envelope.validUntilEpochMs,
        }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_OPERATION_PREPARER_SCHEMA_VERSION,
        candidateAuthority,
        operationId: input.operationId,
        runId: input.runId,
        operationOrdinal: input.operationOrdinal,
        requestSha256:
            value.operationContract.canonical.envelope.requestSha256,
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

export async function prepareSmartOrderTask03cOperationAfterObserver({
    candidateAuthority,
    observerReadiness,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    beforeRequest = async () => {},
}) {
    if (!issuedCandidateOperations.has(candidateAuthority)) {
        throw new Error('Task 0.3c candidate operation is missing or consumed');
    }
    const candidate = issuedCandidateOperations.get(candidateAuthority);
    issuedCandidateOperations.delete(candidateAuthority);
    if (now() >= candidate.validUntilEpochMs) {
        throw new Error(
            'Task 0.3c candidate operation expired before observer readiness',
        );
    }
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot: candidate.appSupportRoot,
        expectedApiGeneration: candidate.expectedApiGeneration,
        observerReadiness,
        fetchImpl,
        now,
        beforeRequest,
    });
    const current = consumeSmartOrderTaskProbeReadonlyAuthority(
        readonly.authority,
    );
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
        throw new Error('Task 0.3c candidate drifted before authorization display');
    }
    assertSmartOrderTaskProbePinnedPriceCurrent({
        plan: value.marketPlan,
        contract: readonly.projection.contract,
        quote: readonly.projection.quote,
    });
    const baseline = assertSmartOrderTask03cExternalSellBaseline({
        account: current.account,
        contractUnit: current.contract.contractUnit,
        expectedCustomField: smartOrderTask03cCustomField(
            value.marketPlan.runId,
            value.operationOrdinal,
        ),
        operationOrdinal: value.operationOrdinal,
        positions: current.positions,
        previousTargets: value.previousTargets,
        trades: current.trades,
    });
    const preparedAuthority = Object.freeze({});
    issuedPreparedOperations.set(
        preparedAuthority,
        Object.freeze({
            ...value,
            readonlyProjection: readonly.projection,
            account: current.account,
            positions: current.positions,
            trades: current.trades,
            contract: current.contract,
            quote: current.quote,
            baseline,
        }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_OPERATION_PREPARER_SCHEMA_VERSION,
        preparedAuthority,
        publicSummary: Object.freeze({
            ...value.operationContract.publicSummary,
            baselineWorkingSellCount: baseline.workingSellCount,
            baselineWorkingSetSha256: baseline.workingSetSha256,
            positionQuantityShares: baseline.position.quantityShares,
        }),
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}

export function consumePreparedSmartOrderTask03cOperation({
    preparedAuthority,
    nowEpochMs,
}) {
    if (
        !preparedAuthority ||
        typeof preparedAuthority !== 'object' ||
        !issuedPreparedOperations.has(preparedAuthority)
    ) {
        throw new Error('Task 0.3c prepared operation is missing or consumed');
    }
    const value = issuedPreparedOperations.get(preparedAuthority);
    issuedPreparedOperations.delete(preparedAuthority);
    if (
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs >= value.operationContract.canonical.envelope.validUntilEpochMs
    ) {
        throw new Error('Task 0.3c prepared operation expired before authorization');
    }
    return value;
}
