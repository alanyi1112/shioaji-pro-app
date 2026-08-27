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
import { canonicalizeShioajiRefreshedStockTrades } from './shioaji-broker-event-mapper.mjs';
import {
    SMART_ORDER_TASK_0_4_0_6_PROFILES,
    buildSmartOrderTask0406OperationContract,
    smartOrderTask0406CustomField,
} from './task0-4-0-6-operation-contract.mjs';
import {
    isIssuedSmartOrderTask0406LiveObserver,
    startSmartOrderTask0406LiveObserver,
} from './task0-4-0-6-live-observer.mjs';

export const SMART_ORDER_TASK_0_4_0_6_OPERATION_PREPARER_SCHEMA_VERSION =
    'smart-order-task-0.4-0.6-operation-preparer/2026-08-26.1';

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const issuedCandidates = new WeakMap();
const issuedPrepared = new WeakMap();
const TASK_0_4_0_6_CONTRACT_SCOPE = Object.freeze({
    security_type: 'STK',
    region: 'TW',
    exchange: 'TSE',
    code: '2330',
    target_code: null,
});
const WORKING_STATUSES = new Set(['PendingSubmit', 'PreSubmitted', 'Submitted']);

function assertTask13_3SellCapacity({ account, contractUnit, positions, trades }) {
    const relevantPositions = positions.filter(
        (position) =>
            position?.code === '2330' && position?.direction === 'Buy',
    );
    if (
        relevantPositions.length !== 1 ||
        !Number.isSafeInteger(relevantPositions[0].quantity) ||
        !Number.isSafeInteger(contractUnit) ||
        contractUnit < 1
    ) {
        throw new Error('Task 13.3 sell position is unavailable or ambiguous');
    }
    const committedShares = canonicalizeShioajiRefreshedStockTrades(trades)
        .filter(
            (trade) =>
                trade.account.brokerId === account.broker_id &&
                trade.account.accountId === account.account_id &&
                trade.account.accountType === 'S' &&
                trade.contractKey === 'TSE:2330:STK:Common' &&
                trade.action === 'Sell' &&
                WORKING_STATUSES.has(trade.status),
        )
        .reduce(
            (total, trade) => total + trade.remaining * contractUnit,
            0,
        );
    if (relevantPositions[0].quantity - committedShares < contractUnit) {
        throw new Error('Task 13.3 sell position has no uncommitted CommonLot');
    }
}

function assertUniqueRun({ account, contractKey, customField, trades }) {
    const matches = canonicalizeShioajiRefreshedStockTrades(trades).filter(
        (trade) =>
            trade.account.brokerId === account.broker_id &&
            trade.account.accountId === account.account_id &&
            trade.account.accountType === 'S' &&
            trade.contractKey === contractKey &&
            trade.customField === customField,
    );
    if (matches.length !== 0) {
        throw new Error('Task 0.4/0.6 run already has a broker order');
    }
}

function planInput({ policy, profile, projection, runId, nowEpochMs }) {
    return {
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: policy.taskId,
        runId,
        operation: 'place',
        purpose: policy.purpose,
        side: policy.side,
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
        nowEpochMs,
        target: null,
        contract: projection.contract,
        quote: projection.quote,
    };
}

async function prepare({
    appSupportRoot,
    expectedApiGeneration,
    fetchImpl,
    nonce,
    now,
    observerReadiness,
    operationId,
    profile,
    runId,
    candidateOnly,
}) {
    const policy = SMART_ORDER_TASK_0_4_0_6_PROFILES[profile];
    if (
        !policy ||
        !UUID.test(runId ?? '') ||
        !UUID.test(operationId ?? '') ||
        !UUID.test(nonce ?? '') ||
        typeof fetchImpl !== 'function' ||
        utilTypes.isProxy(fetchImpl) ||
        typeof now !== 'function' ||
        utilTypes.isProxy(now)
    ) {
        throw new TypeError('Task 0.4/0.6 preparer configuration is invalid');
    }
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot,
        contractScope: TASK_0_4_0_6_CONTRACT_SCOPE,
        expectedApiGeneration,
        observerReadiness,
        candidateOnly,
        fetchImpl,
        now,
    });
    const privateReadonly = consumeSmartOrderTaskProbeReadonlyAuthority(readonly.authority);
    if (policy.taskId === '13.3' && policy.side === 'Sell') {
        assertTask13_3SellCapacity({
            account: privateReadonly.account,
            contractUnit: readonly.projection.contract.contractUnit,
            positions: privateReadonly.positions,
            trades: privateReadonly.trades,
        });
    }
    const market = buildSmartOrderTaskProbeMarketPlan(
        planInput({
            policy,
            profile,
            projection: readonly.projection,
            runId,
            nowEpochMs: now(),
        }),
    );
    const operationContract = buildSmartOrderTask0406OperationContract({
        account: privateReadonly.account,
        marketPlan: market.plan,
        marketPlanSha256: market.planSha256,
        nonce,
        nowEpochMs: now(),
        operationId,
        profile,
    });
    assertUniqueRun({
        account: privateReadonly.account,
        contractKey: market.plan.contractKey,
        customField: operationContract.customField,
        trades: privateReadonly.trades,
    });
    return Object.freeze({
        appSupportRoot,
        expectedApiGeneration,
        fetchImpl,
        nonce,
        now,
        operationId,
        profile,
        runId: runId.toLowerCase(),
        policy,
        operationContract,
        marketPlan: market.plan,
        marketPlanSha256: market.planSha256,
        readonlyProjection: readonly.projection,
        account: privateReadonly.account,
        positions: privateReadonly.positions,
        trades: privateReadonly.trades,
        contract: privateReadonly.contract,
        quote: privateReadonly.quote,
        contractScope: TASK_0_4_0_6_CONTRACT_SCOPE,
    });
}

export async function prepareSmartOrderTask0406CandidateOperation({
    appSupportRoot,
    expectedApiGeneration,
    fetchImpl = globalThis.fetch,
    nonce,
    now = () => Date.now(),
    operationId,
    profile,
    runId,
}) {
    const value = await prepare({
        appSupportRoot,
        expectedApiGeneration,
        fetchImpl,
        nonce,
        now,
        observerReadiness: undefined,
        operationId,
        profile,
        runId,
        candidateOnly: true,
    });
    const candidateAuthority = Object.freeze({});
    issuedCandidates.set(candidateAuthority, value);
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_4_0_6_OPERATION_PREPARER_SCHEMA_VERSION,
        candidateAuthority,
        taskId: value.policy.taskId,
        profile,
        operationId,
        runId: value.runId,
        publicSummary: value.operationContract.publicSummary,
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

export async function startSmartOrderTask0406ObserverForCandidate({
    candidateAuthority,
}) {
    const candidate = issuedCandidates.get(candidateAuthority);
    if (
        !candidate ||
        candidate.now() >=
            candidate.operationContract.canonical.envelope.validUntilEpochMs
    ) {
        throw new Error('Task 0.4/0.6 candidate is missing or expired');
    }
    const observer = await startSmartOrderTask0406LiveObserver({
        account: candidate.account,
        accountScopeSha256: candidate.marketPlan.accountScopeSha256,
        fetchImpl: candidate.fetchImpl,
        now: candidate.now,
    });
    return Object.freeze({
        observer,
        observerReadiness: Object.freeze({
            accountScopeSha256: observer.accountScopeSha256,
            current: true,
            evidenceSha256: observer.evidenceSha256,
            validUntilEpochMs: observer.validUntilEpochMs,
        }),
        brokerAuthority: false,
    });
}

export async function prepareSmartOrderTask0406OperationAfterObserver({
    candidateAuthority,
    observer,
    observerReadiness,
}) {
    const candidate = issuedCandidates.get(candidateAuthority);
    issuedCandidates.delete(candidateAuthority);
    if (
        !candidate ||
        !isIssuedSmartOrderTask0406LiveObserver(observer) ||
        observer.accountScopeSha256 !== candidate.marketPlan.accountScopeSha256 ||
        candidate.now() >=
            candidate.operationContract.canonical.envelope.validUntilEpochMs
    ) {
        throw new Error('Task 0.4/0.6 candidate/observer is invalid or expired');
    }
    await observer.revalidateReady({ minimumRemainingMs: 15_000 });
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot: candidate.appSupportRoot,
        contractScope: candidate.contractScope,
        expectedApiGeneration: candidate.expectedApiGeneration,
        fetchImpl: candidate.fetchImpl,
        now: candidate.now,
        observerReadiness,
        candidateOnly: false,
    });
    const current = consumeSmartOrderTaskProbeReadonlyAuthority(readonly.authority);
    if (candidate.policy.taskId === '13.3' && candidate.policy.side === 'Sell') {
        assertTask13_3SellCapacity({
            account: current.account,
            contractUnit: readonly.projection.contract.contractUnit,
            positions: current.positions,
            trades: current.trades,
        });
    }
    if (
        readonly.projection.accountScopeSha256 !==
            candidate.marketPlan.accountScopeSha256 ||
        readonly.projection.sourceFingerprintSha256 !==
            candidate.marketPlan.sourceFingerprintSha256 ||
        readonly.projection.apiGenerationSha256 !==
            candidate.marketPlan.apiGenerationSha256 ||
        readonly.projection.tradeDate !== candidate.marketPlan.tradeDate ||
        readonly.projection.positionsSha256 !==
            candidate.marketPlan.positionsSha256 ||
        readonly.projection.workingOrdersSha256 !==
            candidate.marketPlan.workingOrdersSha256 ||
        readonly.projection.contract.evidenceSha256 !==
            candidate.marketPlan.contractEvidenceSha256
    ) {
        throw new Error('Task 0.4/0.6 exact candidate drifted before authorization');
    }
    assertSmartOrderTaskProbePinnedPriceCurrent({
        plan: candidate.marketPlan,
        contract: readonly.projection.contract,
        quote: readonly.projection.quote,
    });
    assertUniqueRun({
        account: current.account,
        contractKey: candidate.marketPlan.contractKey,
        customField: candidate.operationContract.customField,
        trades: current.trades,
    });
    const preparedAuthority = Object.freeze({});
    issuedPrepared.set(
        preparedAuthority,
        Object.freeze({
            ...candidate,
            observer,
            readonlyProjection: readonly.projection,
            account: current.account,
            positions: current.positions,
            trades: current.trades,
            contract: current.contract,
            quote: current.quote,
        }),
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_4_0_6_OPERATION_PREPARER_SCHEMA_VERSION,
        preparedAuthority,
        publicSummary: candidate.operationContract.publicSummary,
        observerReady: true,
        authorizationDisplayAllowed: true,
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        brokerAuthority: false,
    });
}

export function consumePreparedSmartOrderTask0406Operation({
    preparedAuthority,
    nowEpochMs,
}) {
    const value = issuedPrepared.get(preparedAuthority);
    issuedPrepared.delete(preparedAuthority);
    if (
        !value ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs >=
            value.operationContract.canonical.envelope.validUntilEpochMs
    ) {
        throw new Error('Task 0.4/0.6 prepared operation is missing, consumed or expired');
    }
    return value;
}
