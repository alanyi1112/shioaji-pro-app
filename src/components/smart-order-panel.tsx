import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
    cancelSmartOrderStrategy,
    copySmartOrderStrategyToDraft,
    createSmartOrderDraft,
    DEFAULT_SMART_ORDER_STRATEGY_KIND,
    drainSmartOrderPreparedIntent,
    fetchSmartOrderReadiness,
    fetchSmartOrderManualResolutions,
    fetchSmartOrderStrategy,
    fetchSmartOrderStrategies,
    pauseSmartOrderStrategy,
    applySmartOrderUniqueFinalResolution,
    prepareSmartOrderProtectionRelinquishment,
    requestSmartOrderBrokerCancellation,
    resumeSmartOrderStrategy,
    commitSmartOrderProtectionRelinquishment,
    SmartOrderLogicalOperationRegistry,
    SmartOrderLocalApiError,
    updateSmartOrderDraft,
    previewSmartOrderCanonicalConfirmation,
    acceptSmartOrderCanonicalConfirmation,
    type SmartOrderReadinessSnapshot,
    type SmartOrderManualResolutionList,
    type SmartOrderManualResolutionOperation,
    type SmartOrderProtectionRelinquishmentChallenge,
    type SmartOrderFormalProtectionRational,
    type SmartOrderFormalProtectionView,
    type SmartOrderStrategyKind,
    type SmartOrderStrategySnapshot,
    type SmartOrderCanonicalConfirmationBasis,
    type SmartOrderCanonicalConfirmationView,
} from '../lib/smart-order-client';
import { useAccounts } from '../lib/account-store';
import {
    inspectLegacyTriggerJson,
    inspectLegacyTriggerStorage,
    LEGACY_BRACKET_RECOVERY,
} from '../lib/smart-order-legacy-migration';
import {
    fetchSmartOrderHistory,
    type SmartOrderHistoryItem,
} from '../lib/smart-order-history-client';
import { subscribeSmartOrderRuntimeEvents } from '../lib/smart-order-event-client';
import {
    applyCanonicalDraftSharedEdits,
    canonicalDraftSharedView,
    smartOrderActivityStateLabel,
    smartOrderActiveListBucket,
    smartOrderRuntimeDisplayState,
    smartOrderStatePresentation,
    type CanonicalDraftSharedEdits,
    type CanonicalDraftSharedView,
    type CanonicalStopTakeLegEdit,
    type QuoteConditionField,
} from '../lib/smart-order-panel-model';
import type { ContractInfo } from '../lib/types/contract';
import * as styles from './smart-order-panel.css';
import { SmartOrderRiskPolicyEditor } from './smart-order-risk-policy-editor';
import { SMART_ORDER_SCHEDULED_QUANTITY_POLICY } from '../../scripts/smart-order-runtime/scheduled-quantity-policy.mjs';

type PanelTab = 'monitoring' | 'processing' | 'history';
type DraftStep = 'type' | 'condition' | 'order' | 'confirm';

const PANEL_TABS: readonly Readonly<{ value: PanelTab; label: string }>[] =
    Object.freeze([
        { value: 'monitoring', label: '監控中' },
        { value: 'processing', label: '處理中' },
        { value: 'history', label: '歷程' },
    ]);

const DRAFT_STEPS: readonly Readonly<{ step: DraftStep; label: string }>[] =
    Object.freeze([
        { step: 'type', label: '類型' },
        { step: 'condition', label: '條件' },
        { step: 'order', label: '委託' },
        { step: 'confirm', label: '確認' },
    ]);

const STRATEGY_KINDS: readonly Readonly<{
    kind: SmartOrderStrategyKind;
    label: string;
}>[] = Object.freeze([
    { kind: 'quick', label: '快速單' },
    { kind: 'good_till', label: '長效單' },
    { kind: 'multi_condition', label: '多條件單' },
    { kind: 'parent_child', label: '母子單' },
    { kind: 'stop_take', label: '停損停利單' },
    { kind: 'trailing_exit', label: '移動出場單' },
    { kind: 'scheduled_quantity', label: '定時定量單' },
]);

const QUICK_CONDITION_FIELDS = Object.freeze([
    ['last_price', '成交價', 'price_decimal'],
    ['bid_price', '買價', 'price_decimal'],
    ['ask_price', '賣價', 'price_decimal'],
    ['up_amount', '上漲', 'price_decimal'],
    ['down_amount', '下跌', 'price_decimal'],
    ['up_percent', '漲幅', 'percent_decimal'],
    ['down_percent', '跌幅', 'percent_decimal'],
    ['tick_quantity', '單量', 'CommonLot'],
    ['total_quantity', '總量', 'CommonLot'],
] as const);

const LABEL_BY_KIND = new Map(
    STRATEGY_KINDS.map(({ kind, label }) => [kind, label]),
);

const TERMINAL_STATES = new Set(['cancelled', 'completed', 'expired', 'failed']);

const MANUAL_RESOLUTION_OPERATION_LABELS = new Map<
    SmartOrderManualResolutionOperation,
    string
>([
    ['apply_unique_final_evidence', '套用唯一 final evidence'],
    ['reconfirm_and_pause', '重新確認後維持暫停'],
    ['cancel_strategy', '取消本機策略'],
    ['copy_to_new_draft', '複製為新草稿'],
    ['repair_gate_observe_only', '修復 Gate 並保持 observe-only'],
    ['break_glass_relinquish', '二次確認人工接手'],
    ['remain_open', '維持案件開啟'],
]);
function workspaceContractKey(contract: ContractInfo | null): string | undefined {
    if (
        !contract?.exchange ||
        !['TSE', 'OTC'].includes(contract.exchange) ||
        contract.security_type !== 'STK' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(contract.code)
    ) {
        return undefined;
    }
    return `${contract.exchange}:STK:${contract.code}`;
}

function strategyBelongsToTab(
    strategy: SmartOrderStrategySnapshot,
    tab: PanelTab,
): boolean {
    if (tab === 'history') return false;
    return (
        smartOrderActiveListBucket(
            strategy.state,
            strategy.activity?.displayState,
        ) === tab
    );
}

function stateLabel(state: string): string {
    return smartOrderStatePresentation(state).label;
}

function strategyDisplayState(
    strategy: SmartOrderStrategySnapshot,
    snapshotCurrent = true,
): string {
    return snapshotCurrent
        ? smartOrderRuntimeDisplayState(strategy.state, strategy.activity)
        : 'unknown';
}

function strategyActivityRows(
    strategy: SmartOrderStrategySnapshot,
): readonly Readonly<{ label: string; state: string; count: number }>[] {
    const activity = strategy.activity;
    if (!activity) return Object.freeze([]);
    const components = [
        { label: 'Activation', summary: activity.activations },
        { label: 'Intent', summary: activity.intents },
        { label: 'Broker', summary: activity.brokerOrders },
        { label: '進場保護承諾', summary: activity.protectionCommitments },
        { label: '保護義務', summary: activity.protectionObligations },
        { label: '曝險保留', summary: activity.entryExposureReservations },
        { label: '出場 claim', summary: activity.exitClaims },
        { label: '人工處理案件', summary: activity.resolutionCases },
        { label: '安全封鎖', summary: activity.safetyBlockers },
    ] as const;
    return Object.freeze(
        components.flatMap(({ label, summary }) =>
            summary.state === null || summary.count <= 0
                ? []
                : [
                      Object.freeze({
                          label,
                          state: summary.state,
                          count: summary.count,
                      }),
                  ],
        ),
    );
}

function formatProtectionRational(
    rational: SmartOrderFormalProtectionRational,
): string {
    const numerator = Number(rational.numeratorMinorUnits);
    const denominator = Number(rational.denominator);
    if (
        !Number.isSafeInteger(numerator) ||
        !Number.isSafeInteger(denominator) ||
        numerator <= 0 ||
        denominator <= 0
    ) {
        return '未知';
    }
    return new Intl.NumberFormat('zh-TW', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    }).format(numerator / denominator / 100);
}

const FORMAL_LEG_LABELS: Readonly<Record<string, string>> = Object.freeze({
    stop: '停損',
    take: '停利',
    trailing_activation: '移動出場啟動',
    trailing_retracement: '移動出場回撤',
    fixed_stop: '固定停損',
});

function FormalProtectionProjection({
    projection,
    snapshotCurrent,
}: {
    projection: SmartOrderFormalProtectionView;
    snapshotCurrent: boolean;
}) {
    return (
        <section
            className={
                projection.state === 'pending_saved_high' || !snapshotCurrent
                    ? styles.activityTraceRisk
                    : styles.activityTrace
            }
            aria-label={
                snapshotCurrent
                    ? '正式保護投影'
                    : '最後成功正式保護投影，非 current'
            }
        >
            <strong>
                {snapshotCurrent ? '正式保護' : '最後成功正式保護・非 current'}
                {' · '}實際成交 {projection.cumulativeFilledShares.toLocaleString('zh-TW')} 股
            </strong>
            <span>
                估算基準 {formatProtectionRational(projection.estimatedBasis)} →
                正式成交均價 {formatProtectionRational(projection.formalBasis)}
            </span>
            {projection.legs.map((leg) => (
                <span key={leg.type}>
                    {FORMAL_LEG_LABELS[leg.type] ?? leg.type}：
                    {leg.triggerState === 'pending_saved_high'
                        ? '正式觸發價待 Runtime 持久化 saved high；不得以 entry basis 估算冒充正式值'
                        : `估算 ${formatProtectionRational(
                              leg.estimatedTriggerPrice!,
                          )} → 正式 ${formatProtectionRational(
                              leg.formalTriggerPrice!,
                          )}（${leg.differsFromEstimate ? '已依成交均價重算' : '與估算相同'}，觸發 ${leg.comparator === 'lte' ? '<=' : '>='}）`}
                </span>
            ))}
            <span>as-of {formatLocalDateTime(projection.asOfEpochMs)}</span>
        </section>
    );
}

function ManualResolutionProjection({
    projection,
    snapshotCurrent,
    disabled,
    onApplyUniqueFinal,
}: {
    projection: SmartOrderManualResolutionList | undefined;
    snapshotCurrent: boolean;
    disabled: boolean;
    onApplyUniqueFinal: (resolutionKey: string) => void;
}) {
    if (!snapshotCurrent || !projection) {
        return (
            <div
                className={styles.activityTraceRisk}
                role='alert'
                aria-label='人工處理矩陣目前未知'
            >
                人工處理矩陣目前未知；generic resume、釋放 claim 與重送原 intent
                一律禁止。
            </div>
        );
    }
    return (
        <div
            className={styles.activityTrace}
            aria-label='人工處理 reason matrix'
        >
            <strong>Reason-specific resolution</strong>
            <div className={styles.activityTraceRisk}>
                generic resume 永久禁止；原 intent 永不重送。
            </div>
            {projection.cases.map((item) => (
                <section key={item.resolutionKey}>
                    <div className={styles.activityTraceRow}>
                        <span>原因</span>
                        <code>{item.reasonCode}</code>
                    </div>
                    <div className={styles.activityTraceRow}>
                        <span>必要證據</span>
                        <span>{item.requiredEvidence.join('、')}</span>
                    </div>
                    <div className={styles.activityTraceRow}>
                        <span>矩陣允許</span>
                        <span>
                            {item.allowedOperations
                                .map(
                                    (operation) =>
                                        MANUAL_RESOLUTION_OPERATION_LABELS.get(
                                            operation,
                                        ) ?? operation,
                                )
                                .join('、')}
                        </span>
                    </div>
                    {item.uniqueFinalReady ? (
                        <button
                            type='button'
                            className={styles.compactButton}
                            disabled={disabled}
                            onClick={() =>
                                onApplyUniqueFinal(item.resolutionKey)
                            }
                        >
                            套用唯一 final evidence
                        </button>
                    ) : item.allowedOperations.includes(
                          'apply_unique_final_evidence',
                      ) ? (
                        <div className={styles.activityTraceRisk}>
                            尚缺固定帳號唯一 terminal evidence；維持 manual/open。
                        </div>
                    ) : null}
                </section>
            ))}
        </div>
    );
}

function historyStateLabel(state: SmartOrderHistoryItem['state']): string {
    return (
        {
            cancelled: '已取消',
            completed: '已完成',
            expired: '已到期',
            failed: '已失敗',
        } as const
    )[state];
}

function formatLocalDateTime(epochMs: number | null): string {
    return epochMs === null
        ? '尚未成功'
        : new Date(epochMs).toLocaleString('zh-TW', { hour12: false });
}

const LIFECYCLE_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
    account_reconciliation: '固定帳號對帳',
    strategy: '未終結策略',
    activation: '未終結 activation',
    prepared_intent: '尚未授權 adapter 的 prepared intent',
    side_effect_intent: '可能已寫入的委託 intent',
    broker_order: '未終結券商委託',
    protection_commitment: '進場保護承諾',
    protection_obligation: '保護義務',
    entry_exposure_reservation: '進場曝險保留',
    exit_claim: '出場 claim',
    manual_resolution: '人工處理案件',
    safety_blocker: '安全封鎖',
});

const LIFECYCLE_DISPOSITION_LABELS: Readonly<Record<string, string>> =
    Object.freeze({
        complete_current_account_reconciliation: '先完成目前固定帳號完整對帳',
        pause_or_cancel_strategy: '先暫停或取消策略',
        cancel_strategy_or_complete_activation: '先取消所屬策略或完成 activation',
        cancel_proven_unsent_intent_and_release:
            '只可在證明 adapter 未取得權限後本機取消並原子釋放',
        reconcile_intent_before_stop: '先對帳，禁止自動重送',
        cancel_working_order_or_reconcile: '另行確認取消券商委託或完成對帳',
        prove_zero_fill_or_release_pre_dispatch: '證明零成交，或確認尚未 dispatch 後本機釋放',
        prove_zero_fill_confirmed_exit_or_break_glass:
            '證明零成交／已全部退出，否則只能二次確認 break-glass',
        release_proven_unsent_or_reconcile: '證明未送出後釋放，否則先對帳',
        reconcile_or_release_claim: '逐項對帳或釋放 claim',
        complete_reason_specific_resolution: '依 reason-specific evidence 完成人工處理',
        resolve_or_supersede_blocker: '解除或以更嚴格 blocker 取代',
    });

const LIFECYCLE_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
    missing_or_stale: '缺少或已過期',
    draft: '草稿',
    observing: '觀察中',
    monitoring: '監控中',
    paused: '已暫停',
    recovery: '復原中',
    manual_intervention: '人工處理',
    cancel_pending: '取消中',
    expired_with_obligation: '到期但仍有義務',
    candidate: '候選',
    triggered: '已觸發',
    prepared: '已準備且尚未授權 adapter',
    dispatching: '送出中／結果未定',
    working: '工作中',
    part_filled: '部分成交',
    unknown: '未知',
    prepared_authority_granted: 'adapter 權限曾授予',
    acknowledged: 'broker 已接受',
    reconciling: '對帳中',
    pending_submit: '等待送出確認',
    pre_submitted: '預送出',
    submitted: '已委託／未全成',
    pending_entry_fill: '等待進場成交',
    reserved: '已保留',
    monitoring_reserved: '監控保留',
    intent_reserved: '委託意圖保留',
    broker_working: 'broker 工作單',
    open: '未結案',
});

function lifecycleQuantityLabel(
    quantityShares: number | null,
    quantityState: 'not_applicable' | 'exact' | 'conservative_maximum',
): string | null {
    if (quantityState === 'not_applicable' || quantityShares === null) {
        return null;
    }
    return quantityState === 'exact'
        ? `${quantityShares} Share（精確）`
        : `最多 ${quantityShares} Share（保守上限）`;
}

function draftReviewFingerprint(
    draft: SmartOrderStrategySnapshot | null,
    definition: unknown,
    readiness: SmartOrderReadinessSnapshot | null,
): string {
    return JSON.stringify({
        strategyId: draft?.strategyId ?? null,
        revision: draft?.revision ?? null,
        definitionHash: draft?.definitionHash ?? null,
        definition,
        readiness: readiness
            ? {
                  runtimeMode: readiness.runtime.mode,
                  runtimeRole: readiness.runtime.role,
                  runtimeState: readiness.runtime.state,
                  writeMaster: readiness.writeMaster,
                  quoteState: readiness.quote.state,
                  quoteAsOf: readiness.quote.asOfExchangeTime,
                  automationState: readiness.gates.automation.state,
                  automationBlocker: readiness.gates.automation.blocker,
                  blockers: readiness.blockers,
              }
            : null,
    });
}

function editsFromCanonicalView(
    view: CanonicalDraftSharedView,
): CanonicalDraftSharedEdits {
    return {
        commonLots: view.order.commonLots,
        triggerField:
            view.definition.kind === 'quick'
                ? view.definition.parameters.condition.field
                : null,
        triggerComparator:
            view.definition.kind === 'quick'
                ? view.definition.parameters.condition.comparator
                : null,
        triggerThreshold: view.trigger?.threshold ?? null,
        activationPolicy:
            view.definition.kind === 'quick' ||
            view.definition.kind === 'multi_condition'
                ? view.definition.parameters.activationPolicy
                : null,
        limitPrice: view.order.limitPrice,
        startDate: view.validity.startDate,
        endDate: view.validity.endDate,
        stopTakeLegs: view.stopTakeLegs,
        multiOperator:
            view.definition.kind === 'multi_condition'
                ? view.definition.parameters.operator
                : null,
        multiConditions:
            view.definition.kind === 'multi_condition'
                ? view.definition.parameters.conditions.map((entry) => ({
                      monitorContractKey: entry.monitorContractKey,
                      field: entry.condition.field,
                      comparator: entry.condition.comparator,
                      threshold: entry.condition.threshold,
                  }))
                : null,
    };
}

function DraftStepper({ activeStep }: { activeStep: DraftStep }) {
    const activeIndex = DRAFT_STEPS.findIndex(({ step }) => step === activeStep);
    return (
        <ol className={styles.stepper} aria-label='智慧單草稿流程'>
            {DRAFT_STEPS.map(({ step, label }, index) => (
                <li
                    key={step}
                    className={
                        index === activeIndex
                            ? styles.step.active
                            : index < activeIndex
                              ? styles.step.complete
                              : styles.step.pending
                    }
                    aria-current={index === activeIndex ? 'step' : undefined}
                >
                    <span aria-hidden='true'>{index + 1}</span>
                    {label}
                </li>
            ))}
        </ol>
    );
}

function friendlyError(error: unknown): string {
    if (error instanceof SmartOrderLocalApiError) {
        const messages: Readonly<Record<string, string>> = {
            strategy_resume_not_ready: 'Gate 尚未完成，策略只能保存為草稿。',
            broker_order_cancel_not_ready:
                '無法唯一確認 current working 券商委託、Gate、對帳或 correlation；未建立取消 intent，也未送出 broker bytes。',
            stale_revision: '資料已在其他視窗更新，請重新整理。',
            mutation_service_not_wired: '本機智慧下單 Runtime 尚未啟用。',
            operation_result_persistence_failed:
                '草稿結果尚未安全寫入，請不要重複操作並檢查 Runtime。',
            operation_reserved:
                '這次操作的結果尚未確定；已保留同一操作識別，請不要建立新操作，先檢查 Runtime。',
            operation_outcome_unknown:
                '舊版操作只有雜湊、無法還原結果；已保留原操作識別，請人工核對策略清單，禁止直接重做。',
            invalid_copy_result:
                'Runtime 回傳的草稿類型與原策略不一致，已停止使用這份複本。',
            invalid_strategy_result:
                'Runtime 回傳的策略識別不一致，已停止更新畫面。',
        };
        return messages[error.code] ?? `本機 Runtime 拒絕操作（${error.code}）。`;
    }
    return '無法連線本機智慧下單 Runtime；目前不會送出任何委託。';
}

export function SmartOrderPanel({
    contract,
}: {
    contract: ContractInfo | null;
}) {
    const { selectedStock } = useAccounts();
    const legacyInspection = useMemo(() => {
        if (typeof window === 'undefined') return inspectLegacyTriggerJson(null);
        try {
            return inspectLegacyTriggerStorage(window.localStorage);
        } catch {
            return inspectLegacyTriggerJson(null);
        }
    }, []);
    const [tab, setTab] = useState<PanelTab>('monitoring');
    const [draftFlow, setDraftFlow] = useState<
        'closed' | 'selector' | 'settings'
    >('closed');
    const [draftStep, setDraftStep] = useState<DraftStep>('type');
    const [selectedKind, setSelectedKind] =
        useState<SmartOrderStrategyKind>(DEFAULT_SMART_ORDER_STRATEGY_KIND);
    const [activeDraft, setActiveDraft] =
        useState<SmartOrderStrategySnapshot | null>(null);
    const [draftWorkspaceContractKey, setDraftWorkspaceContractKey] = useState<
        string | null
    >(null);
    const [draftEdits, setDraftEdits] =
        useState<CanonicalDraftSharedEdits | null>(null);
    const [reviewedDraftFingerprint, setReviewedDraftFingerprint] = useState<
        string | null
    >(null);
    const [confirmationBasisSource, setConfirmationBasisSource] = useState<
        'broker_average_cost' | 'user_specified'
    >('broker_average_cost');
    const [userSpecifiedBasis, setUserSpecifiedBasis] = useState('');
    const [canonicalConfirmation, setCanonicalConfirmation] = useState<
        SmartOrderCanonicalConfirmationView | null
    >(null);
    const [canonicalConfirmationId, setCanonicalConfirmationId] = useState<
        string | null
    >(null);
    const [readiness, setReadiness] =
        useState<SmartOrderReadinessSnapshot | null>(null);
    const [strategies, setStrategies] = useState<
        readonly SmartOrderStrategySnapshot[]
    >([]);
    const [manualResolutions, setManualResolutions] = useState<
        ReadonlyMap<string, SmartOrderManualResolutionList>
    >(new Map());
    const [historyItems, setHistoryItems] = useState<
        readonly SmartOrderHistoryItem[]
    >([]);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [historyLastSuccessAt, setHistoryLastSuccessAt] = useState<
        number | null
    >(null);
    const [lastContactAt, setLastContactAt] = useState<number | null>(null);
    const [strategiesSnapshotCurrent, setStrategiesSnapshotCurrent] =
        useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [copyingStrategyId, setCopyingStrategyId] = useState<string | null>(
        null,
    );
    const [controllingStrategyId, setControllingStrategyId] = useState<
        string | null
    >(null);
    const [relinquishmentChallenge, setRelinquishmentChallenge] = useState<
        SmartOrderProtectionRelinquishmentChallenge | null
    >(null);
    const [error, setError] = useState<string | null>(null);
    const mutationOperations = useRef(new SmartOrderLogicalOperationRegistry());
    const draftDialogRef = useRef<HTMLElement | null>(null);
    const focusBeforeDraftDialog = useRef<HTMLElement | null>(null);
    const savingRef = useRef(saving);

    useEffect(() => {
        savingRef.current = saving;
    }, [saving]);

    const operationIdFor = useCallback((slot: string, fingerprint: string) => {
        return mutationOperations.current.operationIdFor(slot, fingerprint);
    }, []);

    const settleOperation = useCallback((slot: string, failure?: unknown) => {
        mutationOperations.current.settle(slot, failure);
    }, []);

    const adoptDraft = useCallback(
        (draft: SmartOrderStrategySnapshot, creationContractKey?: string) => {
            const canonicalView = canonicalDraftSharedView(
                draft.definition,
                draft.accountBound,
            );
            const legacyWorkspaceContractKey =
                typeof draft.definition?.workspaceContractKey === 'string'
                    ? draft.definition.workspaceContractKey
                    : undefined;
            setSelectedKind(draft.strategyKind);
            setActiveDraft(draft);
            setDraftWorkspaceContractKey(
                canonicalView?.order.contractKey ??
                    legacyWorkspaceContractKey ??
                    creationContractKey ??
                    null,
            );
            setDraftEdits(
                canonicalView ? editsFromCanonicalView(canonicalView) : null,
            );
            setReviewedDraftFingerprint(null);
            setConfirmationBasisSource('broker_average_cost');
            setUserSpecifiedBasis('');
            setCanonicalConfirmation(null);
            setCanonicalConfirmationId(null);
            setDraftStep('condition');
            setDraftFlow('settings');
        },
        [],
    );

    const refresh = useCallback(async () => {
        const results = await Promise.allSettled([
            fetchSmartOrderReadiness(),
            fetchSmartOrderStrategies(),
            fetchSmartOrderHistory(),
        ]);
        const receivedAt = Date.now();
        const readinessResult = results[0];
        const strategiesResult = results[1];
        const historyResult = results[2];
        if (readinessResult.status === 'fulfilled') {
            setReadiness(readinessResult.value);
        } else {
            setReadiness(null);
        }
        if (strategiesResult.status === 'fulfilled') {
            setStrategies(strategiesResult.value);
        }
        setStrategiesSnapshotCurrent(
            readinessResult.status === 'fulfilled' &&
                strategiesResult.status === 'fulfilled',
        );
        if (historyResult.status === 'fulfilled') {
            setHistoryItems(historyResult.value);
            setHistoryError(null);
            setHistoryLastSuccessAt(receivedAt);
        } else {
            setHistoryError(friendlyError(historyResult.reason));
        }
        if (readinessResult.status === 'fulfilled') {
            setLastContactAt(receivedAt);
        }
        if (
            readinessResult.status === 'fulfilled' ||
            strategiesResult.status === 'fulfilled' ||
            historyResult.status === 'fulfilled'
        ) {
            setError(null);
        } else {
            setError(friendlyError(readinessResult.reason));
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), 10_000);
        return () => window.clearInterval(timer);
    }, [refresh]);

    useEffect(() => {
        let cancelled = false;
        if (!strategiesSnapshotCurrent) {
            setManualResolutions(new Map());
            return () => {
                cancelled = true;
            };
        }
        const manualStrategies = strategies.filter(
            (strategy) => strategy.state === 'manual_intervention',
        );
        if (manualStrategies.length === 0) {
            setManualResolutions(new Map());
            return () => {
                cancelled = true;
            };
        }
        void Promise.allSettled(
            manualStrategies.map(async (strategy) => [
                strategy.strategyId,
                await fetchSmartOrderManualResolutions(strategy.strategyId),
            ] as const),
        ).then((results) => {
            if (cancelled) return;
            setManualResolutions(
                new Map(
                    results.flatMap((result) =>
                        result.status === 'fulfilled'
                            ? [result.value]
                            : [],
                    ),
                ),
            );
        });
        return () => {
            cancelled = true;
        };
    }, [strategies, strategiesSnapshotCurrent]);

    useEffect(() => {
        if (typeof EventSource !== 'function') return undefined;
        let refreshTimer: number | null = null;
        const scheduleSnapshotRefresh = () => {
            if (refreshTimer !== null) return;
            refreshTimer = window.setTimeout(() => {
                refreshTimer = null;
                void refresh();
            }, 50);
        };
        let close: () => void = () => undefined;
        try {
            close = subscribeSmartOrderRuntimeEvents({
                onRuntimeEvent: scheduleSnapshotRefresh,
                onGap: scheduleSnapshotRefresh,
                // Polling remains the fallback. A transport error never turns
                // an SSE frame into broker evidence or clears prior state.
                onTransportError: () => undefined,
            });
        } catch {
            return undefined;
        }
        return () => {
            close();
            if (refreshTimer !== null) window.clearTimeout(refreshTimer);
        };
    }, [refresh]);

    useEffect(() => {
        if (draftFlow === 'closed') {
            const previous = focusBeforeDraftDialog.current;
            focusBeforeDraftDialog.current = null;
            if (previous?.isConnected) previous.focus();
            return;
        }
        if (focusBeforeDraftDialog.current === null) {
            focusBeforeDraftDialog.current =
                document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
        }
        const focusFrame = window.requestAnimationFrame(() => {
            const dialog = draftDialogRef.current;
            if (!dialog) return;
            const selectedRadio = dialog.querySelector<HTMLInputElement>(
                'input[type="radio"]:checked:not(:disabled)',
            );
            const firstFocusable = dialog.querySelector<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
            );
            (selectedRadio ?? firstFocusable ?? dialog).focus();
        });
        const onKeyDown = (event: KeyboardEvent) => {
            const dialog = draftDialogRef.current;
            if (!dialog) return;
            if (event.key === 'Escape') {
                if (savingRef.current) return;
                event.preventDefault();
                setDraftFlow('closed');
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(
                dialog.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
                ),
            ).filter(
                (element) =>
                    element.getAttribute('aria-hidden') !== 'true' &&
                    element.getClientRects().length > 0,
            );
            if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [draftFlow]);

    const onTabListKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            const currentIndex = PANEL_TABS.findIndex(
                ({ value }) => value === tab,
            );
            let nextIndex: number | null = null;
            if (event.key === 'ArrowRight') {
                nextIndex = (currentIndex + 1) % PANEL_TABS.length;
            } else if (event.key === 'ArrowLeft') {
                nextIndex =
                    (currentIndex - 1 + PANEL_TABS.length) % PANEL_TABS.length;
            } else if (event.key === 'Home') {
                nextIndex = 0;
            } else if (event.key === 'End') {
                nextIndex = PANEL_TABS.length - 1;
            }
            if (nextIndex === null) return;
            event.preventDefault();
            const next = PANEL_TABS[nextIndex];
            if (!next) return;
            setDraftFlow('closed');
            setTab(next.value);
            event.currentTarget
                .querySelector<HTMLButtonElement>(
                    `[role="tab"][data-smart-order-tab="${next.value}"]`,
                )
                ?.focus();
        },
        [tab],
    );

    useEffect(
        () => () => {
            const previous = focusBeforeDraftDialog.current;
            focusBeforeDraftDialog.current = null;
            if (previous?.isConnected) previous.focus();
        },
        [],
    );

    const visibleStrategies = useMemo(
        () =>
            strategies.filter((strategy) =>
                strategiesSnapshotCurrent
                    ? strategyBelongsToTab(strategy, tab)
                    : tab === 'processing',
            ),
        [strategies, strategiesSnapshotCurrent, tab],
    );

    const beginDraft = useCallback(async () => {
        const creationContractKey = workspaceContractKey(contract);
        const operationSlot = 'create-draft';
        const operationId = operationIdFor(
            operationSlot,
            JSON.stringify({
                strategyKind: selectedKind,
                workspaceContractKey: creationContractKey ?? null,
            }),
        );
        setSaving(true);
        setError(null);
        try {
            const created = await createSmartOrderDraft({
                strategyKind: selectedKind,
                workspaceContractKey: creationContractKey,
                operationId,
            });
            settleOperation(operationSlot);
            adoptDraft(created, creationContractKey);
            setTab('processing');
            await refresh();
        } catch (nextError) {
            settleOperation(operationSlot, nextError);
            setError(friendlyError(nextError));
        } finally {
            setSaving(false);
        }
    }, [
        adoptDraft,
        contract,
        operationIdFor,
        refresh,
        selectedKind,
        settleOperation,
    ]);

    const copyToDraft = useCallback(
        async (
            strategy: Pick<
                SmartOrderStrategySnapshot,
                'strategyId' | 'strategyKind' | 'revision'
            >,
        ) => {
            const operationSlot = `copy:${strategy.strategyId}`;
            const operationId = operationIdFor(
                operationSlot,
                JSON.stringify({
                    expectedRevision: strategy.revision,
                    strategyId: strategy.strategyId,
                }),
            );
            setCopyingStrategyId(strategy.strategyId);
            setError(null);
            try {
                const copied = await copySmartOrderStrategyToDraft({
                    strategyId: strategy.strategyId,
                    expectedRevision: strategy.revision,
                    expectedStrategyKind: strategy.strategyKind,
                    operationId,
                });
                settleOperation(operationSlot);
                adoptDraft(copied);
                setTab('processing');
                await refresh();
            } catch (nextError) {
                settleOperation(operationSlot, nextError);
                if (
                    nextError instanceof SmartOrderLocalApiError &&
                    nextError.code === 'stale_revision' &&
                    nextError.latestStrategySnapshot
                ) {
                    const latest = nextError.latestStrategySnapshot;
                    setStrategies((current) => {
                        const retained = current.filter(
                            (item) => item.strategyId !== latest.strategyId,
                        );
                        return Object.freeze([...retained, latest]);
                    });
                    void refresh();
                }
                setError(friendlyError(nextError));
            } finally {
                setCopyingStrategyId(null);
            }
        },
        [adoptDraft, operationIdFor, refresh, settleOperation],
    );

    const reopenDraft = useCallback(async (strategyId: string) => {
        setControllingStrategyId(strategyId);
        setError(null);
        try {
            const draft = await fetchSmartOrderStrategy(strategyId);
            if (draft.state !== 'draft') {
                throw new SmartOrderLocalApiError(409, 'stale_revision');
            }
            adoptDraft(draft);
        } catch (nextError) {
            setError(friendlyError(nextError));
        } finally {
            setControllingStrategyId(null);
        }
    }, [adoptDraft]);

    const controlStrategy = useCallback(
        async (
            strategy: SmartOrderStrategySnapshot,
            action: 'pause' | 'resume' | 'cancel',
        ) => {
            if (
                action === 'cancel' &&
                !window.confirm(
                    '確定取消這筆本機策略？這不等於取消已送到券商的委託；若仍有 working／unknown 委託，策略會留在處理中等待對帳。',
                )
            ) {
                return;
            }
            if (action === 'resume') {
                let latest: SmartOrderStrategySnapshot;
                try {
                    latest = await fetchSmartOrderStrategy(
                        strategy.strategyId,
                    );
                } catch (nextError) {
                    setError(friendlyError(nextError));
                    return;
                }
                if (
                    latest.revision !== strategy.revision ||
                    latest.state !== 'paused'
                ) {
                    setStrategies((current) => [
                        ...current.filter(
                            (item) =>
                                item.strategyId !== latest.strategyId,
                        ),
                        latest,
                    ]);
                    setError(
                        '策略已在其他視窗更新；請檢查最新狀態後重新操作。',
                    );
                    return;
                }
                const activationPolicy =
                    latest.definition?.activationPolicy;
                if (
                    activationPolicy !== 'require_rearm' &&
                    activationPolicy !== 'immediate_if_true'
                ) {
                    setError(
                        'Runtime 未提供可重新確認的 canonical activation policy；策略維持暫停。',
                    );
                    return;
                }
                const policyLabel =
                    activationPolicy === 'require_rearm'
                        ? '先觀察到 false，之後再發生 false→true 才可觸發'
                        : '若目前條件為 true，恢復監控後可立即成為候選';
                if (
                    !window.confirm(
                        `重新確認並恢復本機監控？\nActivation policy：${policyLabel}\nRuntime 仍會重新驗證 current Gate、帳號對帳、confirmation 與一次性 arm；這個動作本身不會送出券商委託。`,
                    )
                ) {
                    return;
                }
            }
            const operationSlot = `${action}:${strategy.strategyId}`;
            const operationId = operationIdFor(
                operationSlot,
                JSON.stringify({
                    action,
                    expectedRevision: strategy.revision,
                    strategyId: strategy.strategyId,
                }),
            );
            setControllingStrategyId(strategy.strategyId);
            setError(null);
            try {
                const request = {
                    strategyId: strategy.strategyId,
                    expectedRevision: strategy.revision,
                    operationId,
                };
                if (action === 'pause') {
                    await pauseSmartOrderStrategy(request);
                } else if (action === 'resume') {
                    await resumeSmartOrderStrategy(request);
                } else {
                    await cancelSmartOrderStrategy(request);
                }
                settleOperation(operationSlot);
                await refresh();
            } catch (nextError) {
                settleOperation(operationSlot, nextError);
                if (
                    nextError instanceof SmartOrderLocalApiError &&
                    nextError.code === 'stale_revision' &&
                    nextError.latestStrategySnapshot
                ) {
                    const latest = nextError.latestStrategySnapshot;
                    setStrategies((current) => {
                        const retained = current.filter(
                            (item) => item.strategyId !== latest.strategyId,
                        );
                        return Object.freeze([...retained, latest]);
                    });
                    void refresh();
                }
                setError(friendlyError(nextError));
            } finally {
                setControllingStrategyId(null);
            }
        },
        [operationIdFor, refresh, settleOperation],
    );

    const cancelWorkingBrokerOrder = useCallback(
        async (strategy: SmartOrderStrategySnapshot) => {
            if (
                !window.confirm(
                    '確定準備取消這筆策略唯一可識別的 working 券商委託？Runtime 會重新驗證 current Gate、對帳、target revision 與 durable correlation；此按鈕只建立取消 intent，不會在本次 HTTP 請求直接送出 broker bytes。',
                )
            ) {
                return;
            }
            const operationSlot = `cancel-broker-order:${strategy.strategyId}`;
            const operationId = operationIdFor(
                operationSlot,
                JSON.stringify({
                    action: 'cancel_broker_order',
                    expectedRevision: strategy.revision,
                    strategyId: strategy.strategyId,
                }),
            );
            setControllingStrategyId(strategy.strategyId);
            setError(null);
            try {
                await requestSmartOrderBrokerCancellation({
                    strategyId: strategy.strategyId,
                    expectedRevision: strategy.revision,
                    operationId,
                });
                settleOperation(operationSlot);
                setTab('processing');
                await refresh();
            } catch (nextError) {
                settleOperation(operationSlot, nextError);
                if (
                    nextError instanceof SmartOrderLocalApiError &&
                    nextError.code === 'stale_revision' &&
                    nextError.latestStrategySnapshot
                ) {
                    const latest = nextError.latestStrategySnapshot;
                    setStrategies((current) => [
                        ...current.filter(
                            (item) => item.strategyId !== latest.strategyId,
                        ),
                        latest,
                    ]);
                }
                setError(friendlyError(nextError));
            } finally {
                setControllingStrategyId(null);
            }
        },
        [operationIdFor, refresh, settleOperation],
    );

    const drainPreparedIntent = useCallback(
        async (strategy: SmartOrderStrategySnapshot) => {
            if (
                !window.confirm(
                    '確定只在本機取消這筆已證明尚未授權 adapter 的 prepared intent？此操作會原子釋放對應 reservation／claim／未成交保護義務，不會呼叫券商；若存在任何 broker evidence，Runtime 會拒絕。',
                )
            ) {
                return;
            }
            const operationSlot = `drain-prepared:${strategy.strategyId}`;
            const operationId = operationIdFor(
                operationSlot,
                JSON.stringify({
                    action: 'drain_prepared',
                    expectedRevision: strategy.revision,
                    strategyId: strategy.strategyId,
                }),
            );
            setControllingStrategyId(strategy.strategyId);
            setError(null);
            try {
                await drainSmartOrderPreparedIntent({
                    strategyId: strategy.strategyId,
                    expectedRevision: strategy.revision,
                    operationId,
                });
                settleOperation(operationSlot);
                await refresh();
            } catch (nextError) {
                settleOperation(operationSlot, nextError);
                setError(friendlyError(nextError));
            } finally {
                setControllingStrategyId(null);
            }
        },
        [operationIdFor, refresh, settleOperation],
    );

    const relinquishProtection = useCallback(
        async (strategy: SmartOrderStrategySnapshot) => {
            const currentChallenge =
                relinquishmentChallenge?.strategyId === strategy.strategyId &&
                relinquishmentChallenge.strategyRevision === strategy.revision
                    ? relinquishmentChallenge
                    : null;
            const operationSlot = currentChallenge
                ? `relinquish-protection-commit:${strategy.strategyId}`
                : `relinquish-protection-prepare:${strategy.strategyId}`;
            if (currentChallenge === null) {
                if (
                    !window.confirm(
                        '第一次確認：準備把本機保護監控責任交由人工處理。這不代表券商委託已取消、部位已平倉或風險已消失；Runtime 只會建立一致性 snapshot，尚不釋放任何義務。',
                    )
                ) {
                    return;
                }
            } else if (
                !window.confirm(
                    `第二次確認：將 ${currentChallenge.obligationCount} 筆保護義務標為 unmonitored，並永久保留 unknown-exposure blocker。可能仍有 ${currentChallenge.brokerOrderCount} 筆券商委託、${currentChallenge.sideEffectIntentCount} 筆 side-effect intent；原 intent 永不自動重送。確定由人工接手嗎？`,
                )
            ) {
                return;
            }
            const operationId = operationIdFor(
                operationSlot,
                JSON.stringify({
                    action:
                        currentChallenge === null
                            ? 'relinquish_protection_prepare'
                            : 'relinquish_protection_commit',
                    challengeId: currentChallenge?.challengeId ?? null,
                    expectedRevision: strategy.revision,
                    strategyId: strategy.strategyId,
                }),
            );
            setControllingStrategyId(strategy.strategyId);
            setError(null);
            try {
                if (currentChallenge === null) {
                    const challenge =
                        await prepareSmartOrderProtectionRelinquishment({
                            strategyId: strategy.strategyId,
                            expectedRevision: strategy.revision,
                            operationId,
                        });
                    settleOperation(operationSlot);
                    setRelinquishmentChallenge(challenge);
                } else {
                    await commitSmartOrderProtectionRelinquishment({
                        strategyId: strategy.strategyId,
                        expectedRevision: strategy.revision,
                        challengeId: currentChallenge.challengeId,
                        operationId,
                    });
                    settleOperation(operationSlot);
                    setRelinquishmentChallenge(null);
                    await refresh();
                }
            } catch (nextError) {
                settleOperation(operationSlot, nextError);
                setError(friendlyError(nextError));
            } finally {
                setControllingStrategyId(null);
            }
        },
        [
            operationIdFor,
            refresh,
            relinquishmentChallenge,
            settleOperation,
        ],
    );

    const manualResolutionOperationAllowed = useCallback(
        (
            strategy: SmartOrderStrategySnapshot,
            operation: SmartOrderManualResolutionOperation,
        ) => {
            if (strategy.state !== 'manual_intervention') return true;
            const projection = manualResolutions.get(strategy.strategyId);
            return Boolean(
                projection &&
                    projection.cases.length > 0 &&
                    projection.cases.every((item) =>
                        item.executableOperations.includes(operation),
                    ),
            );
        },
        [manualResolutions],
    );

    const applyUniqueFinalResolution = useCallback(
        async (
            strategy: SmartOrderStrategySnapshot,
            resolutionKey: string,
        ) => {
            if (
                !window.confirm(
                    'Runtime 已從固定帳號的完整 reconciliation、唯一 correlation 與 terminal broker quantity 重新證明 final outcome。套用後只會原子結案本機 unknown intent、解決對應 blocker並把策略維持 paused；原 intent 永不重送，也不會產生 broker bytes。確定套用？',
                )
            ) {
                return;
            }
            const operationSlot = `manual-resolution-final:${strategy.strategyId}`;
            const operationId = operationIdFor(
                operationSlot,
                JSON.stringify({
                    action: 'apply_unique_final_evidence',
                    expectedRevision: strategy.revision,
                    resolutionKey,
                    strategyId: strategy.strategyId,
                }),
            );
            setControllingStrategyId(strategy.strategyId);
            setError(null);
            try {
                await applySmartOrderUniqueFinalResolution({
                    strategyId: strategy.strategyId,
                    expectedRevision: strategy.revision,
                    resolutionKey,
                    operationId,
                });
                settleOperation(operationSlot);
                await refresh();
            } catch (nextError) {
                settleOperation(operationSlot, nextError);
                setError(friendlyError(nextError));
            } finally {
                setControllingStrategyId(null);
            }
        },
        [operationIdFor, refresh, settleOperation],
    );

    const activeDraftCanonicalView = useMemo(
        () =>
            activeDraft
                ? canonicalDraftSharedView(
                      activeDraft.definition,
                      activeDraft.accountBound,
                  )
                : null,
        [activeDraft],
    );

    const draftCandidate = useMemo(() => {
        if (!activeDraftCanonicalView || !draftEdits) {
            return {
                definition: null,
                view: null,
                error:
                    'Runtime 尚未提供完整 versioned canonical draft；本畫面不會猜測 fixed account、contract unit、行情 mapping 或 broker policy。',
            } as const;
        }
        try {
            const definition = applyCanonicalDraftSharedEdits(
                activeDraftCanonicalView,
                draftEdits,
            );
            return {
                definition,
                view: canonicalDraftSharedView(
                    definition,
                    activeDraft?.accountBound ?? false,
                ),
                error: null,
            } as const;
        } catch {
            return {
                definition: null,
                view: null,
                error:
                    '草稿欄位不符合 canonical schema。請檢查正整數張數、decimal 價位與 YYYY-MM-DD 有效期。',
            } as const;
        }
    }, [activeDraft, activeDraftCanonicalView, draftEdits]);

    const selectedConfirmationBasis: SmartOrderCanonicalConfirmationBasis | null =
        activeDraft?.strategyKind === 'quick' ||
        activeDraft?.strategyKind === 'parent_child'
            ? null
            : confirmationBasisSource === 'broker_average_cost'
            ? Object.freeze({ source: 'broker_average_cost' })
            : Object.freeze({
                  source: 'user_specified',
                  priceDecimal: userSpecifiedBasis,
              });

    const updateStopTakeLeg = (
        type: CanonicalStopTakeLegEdit['type'],
        next: CanonicalStopTakeLegEdit | null,
    ) => {
        setDraftEdits((current) => {
            if (!current) return current;
            const existing = current.stopTakeLegs ?? [];
            const filtered = existing.filter((leg) => leg.type !== type);
            const stopTakeLegs = next
                ? [...filtered, next].sort((left, right) =>
                      left.type === right.type
                          ? 0
                          : left.type === 'stop'
                            ? -1
                            : 1,
                  )
                : filtered;
            return { ...current, stopTakeLegs };
        });
        setCanonicalConfirmation(null);
        setCanonicalConfirmationId(null);
        setReviewedDraftFingerprint(null);
    };

    const saveCanonicalDraft = useCallback(async () => {
        if (!activeDraft || !draftCandidate.definition) return;
        if (
            reviewedDraftFingerprint === null ||
            reviewedDraftFingerprint !==
                draftReviewFingerprint(
                    activeDraft,
                    draftCandidate.definition,
                    readiness,
                )
        ) {
            setError(
                '草稿確認摘要已失效；請重新檢查條件與委託，再進入確認。',
            );
            return;
        }
        const operationSlot = `save:${activeDraft.strategyId}`;
        const operationId = operationIdFor(
            operationSlot,
            JSON.stringify({
                accountBrokerRef: selectedStock?.broker_id ?? null,
                accountIdRef: selectedStock?.account_id ?? null,
                basisSelection: selectedConfirmationBasis,
                confirmationId: canonicalConfirmationId,
                confirmationSnapshotHash:
                    canonicalConfirmation?.snapshotHash ?? null,
                definition: draftCandidate.definition,
                expectedRevision: activeDraft.revision,
                strategyId: activeDraft.strategyId,
            }),
        );
        setSaving(true);
        setError(null);
        try {
            if (
                ['quick', 'parent_child', 'stop_take', 'trailing_exit'].includes(
                    activeDraft.strategyKind,
                )
            ) {
                if (
                    !selectedStock ||
                    !canonicalConfirmation ||
                    !canonicalConfirmationId
                ) {
                    throw new SmartOrderLocalApiError(
                        409,
                        'canonical_confirmation_missing',
                    );
                }
                const accepted =
                    await acceptSmartOrderCanonicalConfirmation({
                        strategyId: activeDraft.strategyId,
                        expectedRevision: activeDraft.revision,
                        accountBrokerRef: selectedStock.broker_id,
                        accountIdRef: selectedStock.account_id,
                        basisSelection: selectedConfirmationBasis,
                        confirmationId: canonicalConfirmationId,
                        snapshotHash:
                            canonicalConfirmation.snapshotHash,
                        userAcknowledged: true,
                        operationId,
                    });
                if (!accepted.strategy) {
                    throw new SmartOrderLocalApiError(
                        502,
                        'invalid_canonical_confirmation_response',
                    );
                }
                settleOperation(operationSlot);
                setActiveDraft(accepted.strategy);
                setCanonicalConfirmation(accepted);
            } else {
                const updated = await updateSmartOrderDraft({
                    strategyId: activeDraft.strategyId,
                    expectedRevision: activeDraft.revision,
                    draft: draftCandidate.definition,
                    operationId,
                });
                settleOperation(operationSlot);
                setActiveDraft(updated);
            }
            setDraftFlow('closed');
            setTab('processing');
            await refresh();
        } catch (nextError) {
            settleOperation(operationSlot, nextError);
            setError(friendlyError(nextError));
        } finally {
            setSaving(false);
        }
    }, [
        activeDraft,
        draftCandidate.definition,
        canonicalConfirmation,
        canonicalConfirmationId,
        operationIdFor,
        readiness,
        refresh,
        reviewedDraftFingerprint,
        selectedConfirmationBasis,
        selectedStock,
        settleOperation,
    ]);

    const online = readiness !== null;
    const selectedFeatureEnabled =
        selectedKind !== 'scheduled_quantity' &&
        readiness?.gates?.automation?.state === 'eligible' &&
        readiness.gates.automation.featureGates[selectedKind] === true;
    const contactLabel = lastContactAt
        ? new Date(lastContactAt).toLocaleTimeString('zh-TW', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
          })
        : '尚未連線';
    const historyLastSuccessLabel = formatLocalDateTime(historyLastSuccessAt);

    const openDraftSelector = () => {
        setSelectedKind(DEFAULT_SMART_ORDER_STRATEGY_KIND);
        setActiveDraft(null);
        setDraftWorkspaceContractKey(null);
        setDraftEdits(null);
        setReviewedDraftFingerprint(null);
        setConfirmationBasisSource('broker_average_cost');
        setUserSpecifiedBasis('');
        setCanonicalConfirmation(null);
        setCanonicalConfirmationId(null);
        setDraftStep('type');
        setDraftFlow('selector');
    };

    const displayedDraftView =
        draftCandidate.view ?? activeDraftCanonicalView;
    const displayedOrder = displayedDraftView?.order;
    const displayedTrigger = displayedDraftView?.trigger;
    const draftContractLabel =
        displayedOrder?.contractKey ??
        draftWorkspaceContractKey ??
        'canonical contract 尚未就緒';
    const currentDraftFingerprint = draftReviewFingerprint(
        activeDraft,
        draftCandidate.definition,
        readiness,
    );
    const draftReviewInvalidated =
        reviewedDraftFingerprint !== null &&
        reviewedDraftFingerprint !== currentDraftFingerprint;
    const selectedStockScope = selectedStock
        ? `${selectedStock.broker_id}\u001f${selectedStock.account_id}`
        : null;

    useEffect(() => {
        setCanonicalConfirmation(null);
        setCanonicalConfirmationId(null);
        setReviewedDraftFingerprint(null);
    }, [selectedStockScope]);

    useEffect(() => {
        if (
            canonicalConfirmation &&
            reviewedDraftFingerprint !== null &&
            reviewedDraftFingerprint !== currentDraftFingerprint
        ) {
            setCanonicalConfirmation(null);
            setCanonicalConfirmationId(null);
        }
    }, [
        canonicalConfirmation,
        currentDraftFingerprint,
        reviewedDraftFingerprint,
    ]);

    const reviewCurrentDraft = async () => {
        if (!activeDraft || !draftCandidate.definition) return;
        if (
            !['quick', 'parent_child', 'stop_take', 'trailing_exit'].includes(
                activeDraft.strategyKind,
            )
        ) {
            setReviewedDraftFingerprint(currentDraftFingerprint);
            setDraftStep('confirm');
            return;
        }
        if (!selectedStock) {
            setError('沒有目前固定股票帳號；無法建立 Runtime canonical confirmation。');
            return;
        }
        if (
            activeDraft.strategyKind === 'quick' &&
            draftCandidate.view?.activationPolicy === 'immediate_if_true' &&
            !window.confirm(
                '你選擇「目前為 true 即可立即成為候選」。這仍不代表成交，也不會在本次操作送出 broker bytes；是否繼續建立 Runtime canonical confirmation？',
            )
        ) {
            return;
        }
        if (
            ['stop_take', 'trailing_exit'].includes(activeDraft.strategyKind) &&
            confirmationBasisSource === 'user_specified' &&
            (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(userSpecifiedBasis) ||
                Number(userSpecifiedBasis) <= 0)
        ) {
            setError('使用者指定基準價必須是正值且最多兩位小數。');
            return;
        }
        const updateSlot = `confirmation-draft:${activeDraft.strategyId}`;
        const updateOperationId = operationIdFor(
            updateSlot,
            JSON.stringify({
                definition: draftCandidate.definition,
                expectedRevision: activeDraft.revision,
            }),
        );
        setSaving(true);
        setError(null);
        try {
            const updated = await updateSmartOrderDraft({
                strategyId: activeDraft.strategyId,
                expectedRevision: activeDraft.revision,
                draft: draftCandidate.definition,
                operationId: updateOperationId,
            });
            settleOperation(updateSlot);
            setActiveDraft(updated);
            const previewSlot = `confirmation-preview:${updated.strategyId}`;
            const previewOperationId = operationIdFor(
                previewSlot,
                JSON.stringify({
                    accountBrokerRef: selectedStock.broker_id,
                    accountIdRef: selectedStock.account_id,
                    basisSelection: selectedConfirmationBasis,
                    expectedRevision: updated.revision,
                    strategyId: updated.strategyId,
                }),
            );
            const preview = await previewSmartOrderCanonicalConfirmation({
                strategyId: updated.strategyId,
                expectedRevision: updated.revision,
                accountBrokerRef: selectedStock.broker_id,
                accountIdRef: selectedStock.account_id,
                basisSelection: selectedConfirmationBasis,
                operationId: previewOperationId,
            });
            settleOperation(previewSlot);
            setCanonicalConfirmation(preview);
            setCanonicalConfirmationId(previewOperationId);
            setReviewedDraftFingerprint(
                draftReviewFingerprint(updated, updated.definition, readiness),
            );
            setDraftStep('confirm');
        } catch (nextError) {
            settleOperation(updateSlot, nextError);
            setCanonicalConfirmation(null);
            setCanonicalConfirmationId(null);
            setError(friendlyError(nextError));
        } finally {
            setSaving(false);
        }
    };

    const draftDialog =
        draftFlow !== 'closed' && typeof document !== 'undefined'
            ? createPortal(
                  <div
                      className={styles.dialogBackdrop}
                      onPointerDown={(event) => {
                          if (event.target === event.currentTarget && !saving) {
                              setDraftFlow('closed');
                          }
                      }}
                  >
                      <section
                          ref={draftDialogRef}
                          className={styles.selector}
                          role='dialog'
                          aria-modal='true'
                          tabIndex={-1}
                          aria-labelledby={
                              draftFlow === 'selector'
                                  ? 'smart-order-kind-heading'
                                  : 'smart-order-settings-heading'
                          }
                          aria-describedby='smart-order-dialog-description'
                      >
                          <DraftStepper
                              activeStep={
                                  draftFlow === 'selector' ? 'type' : draftStep
                              }
                          />
                          {draftFlow === 'selector' ? (
                              <>
                                  <h3
                                      id='smart-order-kind-heading'
                                      className={styles.selectorHeading}
                                  >
                                      選擇智慧單類型
                                      <span
                                          className={styles.infoBadge}
                                          title='這裡只建立本機草稿，不會送出委託。'
                                          aria-label='這裡只建立本機草稿，不會送出委託'
                                      >
                                          i
                                      </span>
                                  </h3>
                                  <p
                                      id='smart-order-dialog-description'
                                      className={styles.selectorHelp}
                                  >
                                      預設為「移動出場單」。未通過獨立 Gate
                                      的類型會保持不可用，也不會自動改選其他類型。
                                  </p>
                                  <div
                                      className={styles.kindGrid}
                                      role='radiogroup'
                                      aria-label='智慧單類型'
                                  >
                                      {STRATEGY_KINDS.map(({ kind, label }) => {
                                          const selected = kind === selectedKind;
                                          return (
                                              <label
                                                  key={kind}
                                                  className={
                                                      selected
                                                          ? styles.kindOption.selected
                                                          : styles.kindOption.idle
                                                  }
                                              >
                                                  <input
                                                      type='radio'
                                                      name='smart-order-kind'
                                                      value={kind}
                                                      checked={selected}
                                                      onChange={() =>
                                                          setSelectedKind(kind)
                                                      }
                                                      className={styles.visuallyHidden}
                                                  />
                                                  <span
                                                      className={styles.radio}
                                                      aria-hidden='true'
                                                  >
                                                      {selected ? '✓' : ''}
                                                  </span>
                                                  <span>{label}</span>
                                                  {!readiness?.gates?.automation
                                                      ?.featureGates[kind] ? (
                                                      <small
                                                          className={styles.kindGate}
                                                      >
                                                          未解鎖
                                                      </small>
                                                  ) : null}
                                              </label>
                                          );
                                      })}
                                  </div>
                                  {selectedKind === 'scheduled_quantity' ? (
                                      <p
                                          className={styles.selectorHelp}
                                          role='status'
                                          aria-label='定時定量算法未證實'
                                      >
                                          定時模式維持 disabled_unverified（
                                          {
                                              SMART_ORDER_SCHEDULED_QUANTITY_POLICY
                                                  .modes.timed.blocker
                                          }
                                          ）；定量模式維持 disabled_unverified（
                                          {
                                              SMART_ORDER_SCHEDULED_QUANTITY_POLICY
                                                  .modes.quantity.blocker
                                          }
                                          ）。不產生 slot、不補送 missed
                                          slot、前單 working／unknown
                                          時不疊單，也不建立 broker intent。
                                      </p>
                                  ) : null}
                                  <div className={styles.actions}>
                                      <button
                                          type='button'
                                          className={styles.secondaryButton}
                                          onClick={() => setDraftFlow('closed')}
                                          disabled={saving}
                                      >
                                          取消
                                      </button>
                                      <button
                                          type='button'
                                          className={styles.primaryButton}
                                          onClick={() => void beginDraft()}
                                          disabled={
                                              saving ||
                                              !online ||
                                              !selectedFeatureEnabled
                                          }
                                          title={
                                              selectedFeatureEnabled
                                                  ? '進入草稿設定'
                                                  : selectedKind ===
                                                      'scheduled_quantity'
                                                    ? '定時與定量算法尚未證實'
                                                    : '此類型尚未通過獨立 Gate'
                                          }
                                      >
                                          {saving ? '建立草稿中…' : '下一步'}
                                      </button>
                                  </div>
                              </>
                          ) : (
                              <>
                                  <h3
                                      id='smart-order-settings-heading'
                                      className={styles.selectorHeading}
                                  >
                                      {LABEL_BY_KIND.get(selectedKind)}草稿
                                  </h3>
                                  <p
                                      id='smart-order-dialog-description'
                                      className={styles.selectorHelp}
                                  >
                                      本流程只編輯 Runtime 草稿。最後一步只保存
                                      versioned canonical draft；不會 arm、啟用監控或送出
                                      broker 委託。
                                  </p>

                                  {draftCandidate.error ? (
                                      <div className={styles.lockedNotice} role='note'>
                                          {draftCandidate.error}
                                      </div>
                                  ) : null}

                                  {draftReviewInvalidated ? (
                                      <div className={styles.error} role='alert'>
                                          先前的草稿確認摘要已失效。canonical
                                          欄位或 Runtime／行情 readiness
                                          已變更；請重新檢查條件與委託，再進入確認。
                                      </div>
                                  ) : null}

                                  {draftStep === 'condition' ? (
                                      <div className={styles.formStack}>
                                          {activeDraft?.strategyKind === 'stop_take' ? (
                                              <section className={styles.formSection}>
                                                  <h4>停損／停利條件</h4>
                                                  <p className={styles.fieldHelp}>
                                                      停損與停利可各自選擇價差、basis points 或固定 ATR；Runtime confirmation
                                                      會依目前可驗證部位基準重新推導理論價與方向性合法 tick，草稿值不具 broker authority。
                                                  </p>
                                                  {(['stop', 'take'] as const).map((type) => {
                                                      const leg = draftEdits?.stopTakeLegs?.find(
                                                          (candidate) => candidate.type === type,
                                                      );
                                                      const onlyLeg =
                                                          (draftEdits?.stopTakeLegs?.length ?? 0) <= 1;
                                                      return (
                                                          <div className={styles.formGrid} key={type}>
                                                              <label className={styles.field}>
                                                                  <span>{type === 'stop' ? '停損' : '停利'}</span>
                                                                  <input
                                                                      aria-label={`${type === 'stop' ? '停損' : '停利'}啟用`}
                                                                      type='checkbox'
                                                                      checked={Boolean(leg)}
                                                                      disabled={Boolean(leg) && onlyLeg}
                                                                      onChange={(event) =>
                                                                          updateStopTakeLeg(
                                                                              type,
                                                                              event.target.checked
                                                                                  ? {
                                                                                        type,
                                                                                        distance: {
                                                                                            kind: 'pct_bps',
                                                                                            pctBps: 500,
                                                                                        },
                                                                                    }
                                                                                  : null,
                                                                          )
                                                                      }
                                                                  />
                                                              </label>
                                                              {leg ? (
                                                                  <>
                                                                      <label className={styles.field}>
                                                                          <span>距離單位</span>
                                                                          <select
                                                                              aria-label={`${type === 'stop' ? '停損' : '停利'}距離單位`}
                                                                              value={leg.distance.kind}
                                                                              onChange={(event) => {
                                                                                  const kind = event.target.value;
                                                                                  updateStopTakeLeg(type, {
                                                                                      type,
                                                                                      distance:
                                                                                          kind === 'absolute'
                                                                                              ? { kind, value: '1' }
                                                                                              : kind === 'pct_bps'
                                                                                                ? { kind, pctBps: 500 }
                                                                                                : {
                                                                                                      kind: 'fixed_atr',
                                                                                                      atr: '1',
                                                                                                      multiplier: '1',
                                                                                                      atrSnapshotRevision:
                                                                                                          'runtime-fixed-atr-required',
                                                                                                  },
                                                                                  });
                                                                              }}
                                                                          >
                                                                              <option value='absolute'>價差</option>
                                                                              <option value='pct_bps'>basis points</option>
                                                                              <option value='fixed_atr'>固定 ATR snapshot</option>
                                                                          </select>
                                                                      </label>
                                                                      {leg.distance.kind === 'absolute' ? (
                                                                          <label className={styles.field}>
                                                                              <span>價差</span>
                                                                              <input
                                                                                  aria-label={`${type === 'stop' ? '停損' : '停利'}價差`}
                                                                                  inputMode='decimal'
                                                                                  value={leg.distance.value}
                                                                                  onChange={(event) =>
                                                                                      updateStopTakeLeg(type, {
                                                                                          type,
                                                                                          distance: {
                                                                                              kind: 'absolute',
                                                                                              value: event.target.value,
                                                                                          },
                                                                                      })
                                                                                  }
                                                                              />
                                                                          </label>
                                                                      ) : leg.distance.kind === 'pct_bps' ? (
                                                                          <label className={styles.field}>
                                                                              <span>百分比（bps）</span>
                                                                              <input
                                                                                  aria-label={`${type === 'stop' ? '停損' : '停利'}百分比 bps`}
                                                                                  inputMode='numeric'
                                                                                  value={leg.distance.pctBps}
                                                                                  onChange={(event) =>
                                                                                      updateStopTakeLeg(type, {
                                                                                          type,
                                                                                          distance: {
                                                                                              kind: 'pct_bps',
                                                                                              pctBps: Number(event.target.value),
                                                                                          },
                                                                                      })
                                                                                  }
                                                                              />
                                                                          </label>
                                                                      ) : (
                                                                          <>
                                                                              <p
                                                                                  role='status'
                                                                                  aria-label={`${type === 'stop' ? '停損' : '停利'}固定 ATR authority`}
                                                                              >
                                                                                  固定 ATR 值與 snapshot revision 由 Runtime 在確認時，以已完成日 K 的 Wilder ATR(14) 取得；草稿不能自行指定。
                                                                              </p>
                                                                              <label className={styles.field}>
                                                                                  <span>ATR 倍數</span>
                                                                                  <input
                                                                                      aria-label={`${type === 'stop' ? '停損' : '停利'}ATR 倍數`}
                                                                                      inputMode='decimal'
                                                                                      value={leg.distance.multiplier}
                                                                                      onChange={(event) =>
                                                                                          updateStopTakeLeg(type, {
                                                                                              type,
                                                                                              distance: {
                                                                                                  kind: 'fixed_atr',
                                                                                                  atr:
                                                                                                      leg.distance.kind === 'fixed_atr'
                                                                                                          ? leg.distance.atr
                                                                                                          : '1',
                                                                                                  multiplier: event.target.value,
                                                                                                  atrSnapshotRevision:
                                                                                                      leg.distance.kind === 'fixed_atr'
                                                                                                          ? leg.distance.atrSnapshotRevision
                                                                                                          : 'runtime-fixed-atr-required',
                                                                                              },
                                                                                          })
                                                                                      }
                                                                                  />
                                                                              </label>
                                                                          </>
                                                                      )}
                                                                  </>
                                                              ) : null}
                                                          </div>
                                                      );
                                                  })}
                                              </section>
                                          ) : null}
                                          <section className={styles.formSection}>
                                              <h4>固定範圍</h4>
                                              <div className={styles.formGrid}>
                                                  <label className={styles.field}>
                                                      <span>固定帳號</span>
                                                      <input
                                                          aria-label='固定帳號'
                                                          value={
                                                              displayedDraftView?.fixedAccountLabel ??
                                                              '待 Runtime canonical confirmation 固定'
                                                          }
                                                          readOnly
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>canonical contract</span>
                                                      <input
                                                          aria-label='canonical contract'
                                                          value={draftContractLabel}
                                                          readOnly
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>order condition</span>
                                                      <input
                                                          aria-label='order condition'
                                                          value={
                                                              displayedOrder?.orderCond ??
                                                              'Cash（待 canonical draft）'
                                                          }
                                                          readOnly
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>order lot</span>
                                                      <input
                                                          aria-label='order lot'
                                                          value={
                                                              displayedOrder?.orderLot ??
                                                              'Common（待 canonical draft）'
                                                          }
                                                          readOnly
                                                      />
                                                  </label>
                                              </div>
                                              <p className={styles.fieldHelp}>
                                                  畫面不接受任意帳號、商品、融資券或零股；帳號識別不會輸出到 browser。
                                              </p>
                                          </section>

                                          {['stop_take', 'trailing_exit'].includes(
                                              activeDraft?.strategyKind ?? '',
                                          ) ? (
                                              <section className={styles.formSection}>
                                                  <h4>既有部位基準</h4>
                                                  <div className={styles.formGrid}>
                                                      <label className={styles.field}>
                                                          <span>基準來源</span>
                                                          <select
                                                              aria-label='既有部位基準來源'
                                                              value={confirmationBasisSource}
                                                              onChange={(event) => {
                                                                  setConfirmationBasisSource(
                                                                      event.target.value as
                                                                          | 'broker_average_cost'
                                                                          | 'user_specified',
                                                                  );
                                                                  setCanonicalConfirmation(null);
                                                                  setCanonicalConfirmationId(null);
                                                                  setReviewedDraftFingerprint(null);
                                                              }}
                                                          >
                                                              <option value='broker_average_cost'>
                                                                  券商確認平均成本（預設）
                                                              </option>
                                                              <option value='user_specified'>
                                                                  使用者指定基準
                                                              </option>
                                                          </select>
                                                      </label>
                                                      {confirmationBasisSource ===
                                                      'user_specified' ? (
                                                          <label className={styles.field}>
                                                              <span>使用者指定基準價</span>
                                                              <input
                                                                  aria-label='使用者指定基準價'
                                                                  inputMode='decimal'
                                                                  value={userSpecifiedBasis}
                                                                  onChange={(event) => {
                                                                      setUserSpecifiedBasis(
                                                                          event.target.value,
                                                                      );
                                                                      setCanonicalConfirmation(null);
                                                                      setCanonicalConfirmationId(null);
                                                                      setReviewedDraftFingerprint(null);
                                                                  }}
                                                                  placeholder='例如 100'
                                                              />
                                                          </label>
                                                      ) : null}
                                                  </div>
                                                  <p className={styles.fieldHelp}>
                                                      預設只接受固定帳號最新、完整 reconciliation
                                                      的 broker-confirmed average cost；缺失或過期時不會以市價、昨收或 UI
                                                      快取替代。使用者指定值會標示來源、驗證合法 tick，並納入 confirmation hash。
                                                  </p>
                                              </section>
                                          ) : null}

                                          {activeDraft?.strategyKind === 'multi_condition' &&
                                          draftEdits?.multiConditions ? (
                                              <section className={styles.formSection}>
                                                  <h4>多條件監控（最多七條）</h4>
                                                  <div className={styles.formGrid}>
                                                      <label className={styles.field}>
                                                          <span>條件組合</span>
                                                          <select
                                                              aria-label='多條件組合'
                                                              value={draftEdits.multiOperator ?? 'AND'}
                                                              onChange={(event) =>
                                                                  setDraftEdits((current) =>
                                                                      current
                                                                          ? {
                                                                                ...current,
                                                                                multiOperator:
                                                                                    event.target.value as 'AND' | 'OR',
                                                                            }
                                                                          : current,
                                                                  )
                                                              }
                                                          >
                                                              <option value='AND'>全部成立（AND）</option>
                                                              <option value='OR'>任一新鮮 edge（OR）</option>
                                                          </select>
                                                      </label>
                                                      <label className={styles.field}>
                                                          <span>activation policy</span>
                                                          <select
                                                              aria-label='多條件 activation policy'
                                                              value={draftEdits.activationPolicy ?? 'require_rearm'}
                                                              onChange={(event) =>
                                                                  setDraftEdits((current) =>
                                                                      current
                                                                          ? {
                                                                                ...current,
                                                                                activationPolicy:
                                                                                    event.target.value as
                                                                                        | 'require_rearm'
                                                                                        | 'immediate_if_true',
                                                                            }
                                                                          : current,
                                                                  )
                                                              }
                                                          >
                                                              <option value='require_rearm'>先 false，再 false→true（預設）</option>
                                                              <option value='immediate_if_true'>目前 true 可立即成為候選（需明確確認）</option>
                                                          </select>
                                                      </label>
                                                  </div>
                                                  {draftEdits.multiConditions.map(
                                                      (condition, index) => (
                                                          <fieldset
                                                              key={`${index}-${condition.monitorContractKey}`}
                                                              className={styles.formSection}
                                                          >
                                                              <legend>條件 {index + 1}</legend>
                                                              <div className={styles.formGrid}>
                                                                  <label className={styles.field}>
                                                                      <span>監控商品 canonical key</span>
                                                                      <input
                                                                          aria-label={`條件 ${index + 1} 監控商品`}
                                                                          value={condition.monitorContractKey}
                                                                          onChange={(event) =>
                                                                              setDraftEdits((current) =>
                                                                                  current?.multiConditions
                                                                                      ? {
                                                                                            ...current,
                                                                                            multiConditions:
                                                                                                current.multiConditions.map(
                                                                                                    (entry, entryIndex) =>
                                                                                                        entryIndex === index
                                                                                                            ? {
                                                                                                                  ...entry,
                                                                                                                  monitorContractKey:
                                                                                                                      event.target.value,
                                                                                                              }
                                                                                                            : entry,
                                                                                                ),
                                                                                        }
                                                                                      : current,
                                                                              )
                                                                          }
                                                                      />
                                                                  </label>
                                                                  <label className={styles.field}>
                                                                      <span>來源欄位</span>
                                                                      <select
                                                                          aria-label={`條件 ${index + 1} 來源欄位`}
                                                                          value={condition.field}
                                                                          onChange={(event) =>
                                                                              setDraftEdits((current) =>
                                                                                  current?.multiConditions
                                                                                      ? {
                                                                                            ...current,
                                                                                            multiConditions:
                                                                                                current.multiConditions.map(
                                                                                                    (entry, entryIndex) =>
                                                                                                        entryIndex === index
                                                                                                            ? {
                                                                                                                  ...entry,
                                                                                                                  field: event.target.value as QuoteConditionField,
                                                                                                              }
                                                                                                            : entry,
                                                                                                ),
                                                                                        }
                                                                                      : current,
                                                                              )
                                                                          }
                                                                      >
                                                                          {QUICK_CONDITION_FIELDS.map(
                                                                              ([field, label, unit]) => (
                                                                                  <option key={field} value={field}>
                                                                                      {label}（{unit}）
                                                                                  </option>
                                                                              ),
                                                                          )}
                                                                      </select>
                                                                  </label>
                                                                  <label className={styles.field}>
                                                                      <span>比較子</span>
                                                                      <select
                                                                          aria-label={`條件 ${index + 1} 比較子`}
                                                                          value={condition.comparator}
                                                                          onChange={(event) =>
                                                                              setDraftEdits((current) =>
                                                                                  current?.multiConditions
                                                                                      ? {
                                                                                            ...current,
                                                                                            multiConditions:
                                                                                                current.multiConditions.map(
                                                                                                    (entry, entryIndex) =>
                                                                                                        entryIndex === index
                                                                                                            ? {
                                                                                                                  ...entry,
                                                                                                                  comparator:
                                                                                                                      event.target.value as 'gte' | 'lte',
                                                                                                              }
                                                                                                            : entry,
                                                                                                ),
                                                                                        }
                                                                                      : current,
                                                                              )
                                                                          }
                                                                      >
                                                                          <option value='gte'>大於等於（gte）</option>
                                                                          <option value='lte'>小於等於（lte）</option>
                                                                      </select>
                                                                  </label>
                                                                  <label className={styles.field}>
                                                                      <span>門檻</span>
                                                                      <input
                                                                          aria-label={`條件 ${index + 1} 門檻`}
                                                                          inputMode='decimal'
                                                                          value={condition.threshold}
                                                                          onChange={(event) =>
                                                                              setDraftEdits((current) =>
                                                                                  current?.multiConditions
                                                                                      ? {
                                                                                            ...current,
                                                                                            multiConditions:
                                                                                                current.multiConditions.map(
                                                                                                    (entry, entryIndex) =>
                                                                                                        entryIndex === index
                                                                                                            ? {
                                                                                                                  ...entry,
                                                                                                                  threshold:
                                                                                                                      event.target.value,
                                                                                                              }
                                                                                                            : entry,
                                                                                                ),
                                                                                        }
                                                                                      : current,
                                                                              )
                                                                          }
                                                                      />
                                                                  </label>
                                                              </div>
                                                              <button
                                                                  type='button'
                                                                  onClick={() =>
                                                                      setDraftEdits((current) =>
                                                                          current?.multiConditions &&
                                                                          current.multiConditions.length > 1
                                                                              ? {
                                                                                    ...current,
                                                                                    multiConditions:
                                                                                        current.multiConditions.filter(
                                                                                            (_, entryIndex) => entryIndex !== index,
                                                                                        ),
                                                                                }
                                                                              : current,
                                                                      )
                                                                  }
                                                                  disabled={(draftEdits.multiConditions?.length ?? 0) <= 1}
                                                              >
                                                                  移除此條件
                                                              </button>
                                                          </fieldset>
                                                      ),
                                                  )}
                                                  <button
                                                      type='button'
                                                      onClick={() =>
                                                          setDraftEdits((current) => {
                                                              const multiConditions =
                                                                  current?.multiConditions;
                                                              const first = multiConditions?.[0];
                                                              return multiConditions &&
                                                                  first &&
                                                                  multiConditions.length < 7
                                                                  ? {
                                                                        ...current,
                                                                        multiConditions: [
                                                                            ...multiConditions,
                                                                            {
                                                                                monitorContractKey:
                                                                                    draftWorkspaceContractKey ??
                                                                                    first.monitorContractKey,
                                                                                field: 'last_price',
                                                                                comparator: 'gte',
                                                                                threshold: '1',
                                                                            },
                                                                        ],
                                                                    }
                                                                  : current;
                                                          })
                                                      }
                                                      disabled={(draftEdits.multiConditions?.length ?? 7) >= 7}
                                                  >
                                                      新增條件
                                                  </button>
                                                  <p className={styles.fieldHelp}>
                                                      每條監控商品都必須取得 current subscription、canonical contract 與 mapping；任一缺失會讓整體不ready。AND另要求同交易日、同stream epoch且3秒內coherent；OR只接受fresh edge。
                                                  </p>
                                              </section>
                                          ) : null}

                                          {!['stop_take', 'multi_condition'].includes(
                                              activeDraft?.strategyKind ?? '',
                                          ) ? (
                                          <section className={styles.formSection}>
                                              <h4>Trigger</h4>
                                              <div className={styles.formGrid}>
                                                  <label className={styles.field}>
                                                      <span>來源欄位</span>
                                                      {activeDraft?.strategyKind === 'quick' ? (
                                                          <select
                                                              aria-label='觸發來源欄位'
                                                              value={draftEdits?.triggerField ?? 'last_price'}
                                                              onChange={(event) =>
                                                                  setDraftEdits((current) =>
                                                                      current
                                                                          ? {
                                                                                ...current,
                                                                                triggerField:
                                                                                    event.target.value as NonNullable<CanonicalDraftSharedEdits['triggerField']>,
                                                                            }
                                                                          : current,
                                                                  )
                                                              }
                                                          >
                                                              {QUICK_CONDITION_FIELDS.map(
                                                                  ([field, label, unit]) => (
                                                                      <option key={field} value={field}>
                                                                          {label}（{unit}）
                                                                      </option>
                                                                  ),
                                                              )}
                                                          </select>
                                                      ) : (
                                                          <input
                                                              aria-label='觸發來源欄位'
                                                              value={displayedTrigger?.field ?? '待 Runtime mapping'}
                                                              readOnly
                                                          />
                                                      )}
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>比較子</span>
                                                      {activeDraft?.strategyKind === 'quick' ? (
                                                          <select
                                                              aria-label='觸發比較子'
                                                              value={draftEdits?.triggerComparator ?? 'gte'}
                                                              onChange={(event) =>
                                                                  setDraftEdits((current) =>
                                                                      current
                                                                          ? {
                                                                                ...current,
                                                                                triggerComparator:
                                                                                    event.target.value as 'gte' | 'lte',
                                                                            }
                                                                          : current,
                                                                  )
                                                              }
                                                          >
                                                              <option value='gte'>大於等於（gte）</option>
                                                              <option value='lte'>小於等於（lte）</option>
                                                          </select>
                                                      ) : (
                                                          <input
                                                              aria-label='觸發比較子'
                                                              value={
                                                                  displayedTrigger?.comparator === 'gte'
                                                                      ? '大於等於（gte）'
                                                                      : displayedTrigger?.comparator === 'lte'
                                                                        ? '小於等於（lte）'
                                                                        : '待 Runtime mapping'
                                                              }
                                                              readOnly
                                                          />
                                                      )}
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>門檻（canonical decimal）</span>
                                                      <input
                                                          aria-label='觸發門檻'
                                                          inputMode='decimal'
                                                          value={
                                                              draftEdits?.triggerThreshold ?? ''
                                                          }
                                                          onChange={(event) =>
                                                              setDraftEdits((current) =>
                                                                  current
                                                                      ? {
                                                                            ...current,
                                                                            triggerThreshold:
                                                                                event.target.value,
                                                                        }
                                                                      : current,
                                                              )
                                                          }
                                                          disabled={!displayedTrigger}
                                                          placeholder='由 Runtime canonical draft 提供'
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>activation policy</span>
                                                      {activeDraft?.strategyKind === 'quick' ? (
                                                          <select
                                                              aria-label='activation policy'
                                                              value={draftEdits?.activationPolicy ?? 'require_rearm'}
                                                              onChange={(event) =>
                                                                  setDraftEdits((current) =>
                                                                      current
                                                                          ? {
                                                                                ...current,
                                                                                activationPolicy:
                                                                                    event.target.value as
                                                                                        | 'require_rearm'
                                                                                        | 'immediate_if_true',
                                                                            }
                                                                          : current,
                                                                  )
                                                              }
                                                          >
                                                              <option value='require_rearm'>先 false，再 false→true（預設）</option>
                                                              <option value='immediate_if_true'>目前 true 可立即成為候選（需明確確認）</option>
                                                          </select>
                                                      ) : (
                                                          <input
                                                              aria-label='activation policy'
                                                              value={displayedDraftView?.activationPolicy ?? '不適用／尚未提供'}
                                                              readOnly
                                                          />
                                                      )}
                                                  </label>
                                              </div>
                                              <p className={styles.fieldHelp}>
                                                  來源欄位、比較子與 mapping revision
                                                  不能由畫面猜測；預設 require_rearm，觸發不等於成交。
                                              </p>
                                          </section>
                                          ) : null}

                                          <section className={styles.formSection}>
                                              <h4>Validity</h4>
                                              <div className={styles.formGrid}>
                                                  <label className={styles.field}>
                                                      <span>開始日</span>
                                                      <input
                                                          type='date'
                                                          aria-label='有效期開始日'
                                                          value={draftEdits?.startDate ?? ''}
                                                          onChange={(event) =>
                                                              setDraftEdits((current) =>
                                                                  current
                                                                      ? {
                                                                            ...current,
                                                                            startDate:
                                                                                event.target.value,
                                                                        }
                                                                      : current,
                                                              )
                                                          }
                                                          disabled={!displayedDraftView}
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>結束日</span>
                                                      <input
                                                          type='date'
                                                          aria-label='有效期結束日'
                                                          value={draftEdits?.endDate ?? ''}
                                                          onChange={(event) =>
                                                              setDraftEdits((current) =>
                                                                  current
                                                                      ? {
                                                                            ...current,
                                                                            endDate:
                                                                                event.target.value,
                                                                        }
                                                                      : current,
                                                              )
                                                          }
                                                          disabled={!displayedDraftView}
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>calendar revision</span>
                                                      <input
                                                          aria-label='calendar revision'
                                                          value={
                                                              displayedDraftView?.validity
                                                                  .calendarVersion ??
                                                              '待 Runtime calendar'
                                                          }
                                                          readOnly
                                                      />
                                                  </label>
                                              </div>
                                          </section>
                                      </div>
                                  ) : null}

                                  {draftStep === 'order' ? (
                                      <div className={styles.formStack}>
                                          <section className={styles.formSection}>
                                              <h4>
                                                  {displayedDraftView?.orderLabel ??
                                                      '委託'}
                                              </h4>
                                              <div className={styles.formGrid}>
                                                  <label className={styles.field}>
                                                      <span>商品</span>
                                                      <input
                                                          aria-label='委託商品'
                                                          value={draftContractLabel}
                                                          readOnly
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>買賣別</span>
                                                      <input
                                                          aria-label='買賣別'
                                                          value={
                                                              displayedOrder?.side ??
                                                              '待 canonical draft'
                                                          }
                                                          readOnly
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>價別</span>
                                                      <select
                                                          aria-label='broker price type'
                                                          value={displayedOrder?.priceType ?? 'LMT'}
                                                          disabled
                                                      >
                                                          <option value='LMT'>限價單（LMT）</option>
                                                          <option value='MKT'>市價單（MKT）</option>
                                                      </select>
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>效期</span>
                                                      <select
                                                          aria-label='broker time in force'
                                                          value={
                                                              displayedOrder?.timeInForce ?? 'ROD'
                                                          }
                                                          disabled
                                                      >
                                                          <option value='ROD'>ROD</option>
                                                          <option value='IOC'>IOC</option>
                                                      </select>
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>張數（CommonLot）</span>
                                                      <input
                                                          aria-label='委託張數 CommonLot'
                                                          inputMode='numeric'
                                                          value={draftEdits?.commonLots ?? ''}
                                                          onChange={(event) =>
                                                              setDraftEdits((current) =>
                                                                  current
                                                                      ? {
                                                                            ...current,
                                                                            commonLots:
                                                                                event.target.value,
                                                                        }
                                                                      : current,
                                                              )
                                                          }
                                                          disabled={!displayedOrder}
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>股數（Share）</span>
                                                      <input
                                                          aria-label='委託股數 Share'
                                                          value={
                                                              displayedOrder?.baseShares ?? ''
                                                          }
                                                          readOnly
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>每張股數（contract unit）</span>
                                                      <input
                                                          aria-label='contract unit'
                                                          value={
                                                              displayedOrder?.contractUnit ?? ''
                                                          }
                                                          readOnly
                                                      />
                                                  </label>
                                                  <label className={styles.field}>
                                                      <span>限價</span>
                                                      <input
                                                          aria-label='broker limit price'
                                                          inputMode='decimal'
                                                          value={draftEdits?.limitPrice ?? ''}
                                                          onChange={(event) =>
                                                              setDraftEdits((current) =>
                                                                  current
                                                                      ? {
                                                                            ...current,
                                                                            limitPrice:
                                                                                event.target.value,
                                                                        }
                                                                      : current,
                                                              )
                                                          }
                                                          disabled={
                                                              displayedOrder?.priceType !== 'LMT'
                                                          }
                                                      />
                                                  </label>
                                              </div>
                                              <p className={styles.fieldHelp}>
                                                  Cash／Common、商品、方向、價別與效期皆由既有
                                                  canonical policy 固定；共用表單只會以 contract
                                                  unit 精確推導 Share，不會隱含 1000。
                                              </p>
                                          </section>
                                      </div>
                                  ) : null}

                                  {draftStep === 'confirm' ? (
                                      <div className={styles.formStack}>
                                          <div
                                              className={styles.confirmationWarning}
                                              role='note'
                                          >
                                              本機監控・非券商雲端；不作為實盤唯一保護。只有 Runtime
                                              重新驗證目前帳號、部位、商品、mode、risk 與 Gate 後回傳的 canonical
                                              snapshot 才能接受；本步驟不 arm、不啟用監控，也不送出 broker 委託。
                                          </div>
                                          <section className={styles.formSection}>
                                              <h4>Runtime canonical confirmation</h4>
                                              <dl className={styles.summaryList}>
                                                  <div>
                                                      <dt>類型</dt>
                                                      <dd>
                                                          {LABEL_BY_KIND.get(
                                                              selectedKind,
                                                          )}
                                                      </dd>
                                                  </div>
                                                  <div>
                                                      <dt>固定帳號</dt>
                                                      <dd>
                                                          {displayedDraftView?.fixedAccountLabel ??
                                                              '待 Runtime canonical confirmation 固定'}
                                                      </dd>
                                                  </div>
                                                  <div>
                                                      <dt>商品</dt>
                                                      <dd>{draftContractLabel}</dd>
                                                  </div>
                                                  <div>
                                                      <dt>委託分類</dt>
                                                      <dd>
                                                          {displayedOrder
                                                              ? `${displayedOrder.orderCond}/${displayedOrder.orderLot}`
                                                              : '待 canonical draft'}
                                                      </dd>
                                                  </div>
                                                  <div>
                                                      <dt>數量</dt>
                                                      <dd>
                                                          {displayedOrder
                                                              ? `${displayedOrder.commonLots} CommonLot = ${displayedOrder.baseShares} Share（unit ${displayedOrder.contractUnit}）`
                                                              : '待 canonical contract unit'}
                                                      </dd>
                                                  </div>
                                                  <div>
                                                      <dt>Trigger</dt>
                                                      <dd>
                                                          {displayedTrigger
                                                              ? `${displayedTrigger.field} ${displayedTrigger.comparator} ${displayedTrigger.threshold}`
                                                              : '不適用／待類型專屬條件'}
                                                      </dd>
                                                  </div>
                                                  <div>
                                                      <dt>Broker policy</dt>
                                                      <dd>
                                                          {displayedOrder
                                                              ? `${displayedOrder.priceType}/${displayedOrder.timeInForce}${displayedOrder.limitPrice ? ` @ ${displayedOrder.limitPrice}` : ''}`
                                                              : '待 Runtime policy'}
                                                      </dd>
                                                  </div>
                                                  <div>
                                                      <dt>有效期</dt>
                                                      <dd>
                                                          {displayedDraftView
                                                              ? `${displayedDraftView.validity.startDate} ～ ${displayedDraftView.validity.endDate}`
                                                              : '待 Runtime calendar'}
                                                      </dd>
                                                  </div>
                                                  <div>
                                                      <dt>目前 revision/hash</dt>
                                                      <dd>
                                                          {activeDraft
                                                              ? `${activeDraft.revision} / ${activeDraft.definitionHash}`
                                                              : '—'}
                                                      </dd>
                                                  </div>
                                                  {canonicalConfirmation ? (
                                                      <>
                                                          <div>
                                                              <dt>Runtime 固定帳號</dt>
                                                              <dd>
                                                                  {
                                                                      canonicalConfirmation.fixedAccountLabel
                                                                  }
                                                              </dd>
                                                          </div>
                                                          {canonicalConfirmation.position ? (
                                                              <>
                                                                  <div>
                                                                      <dt>部位／可用量</dt>
                                                                      <dd>
                                                                          {canonicalConfirmation.position.quantityShares}{' '}
                                                                          Share／可用{' '}
                                                                          {canonicalConfirmation.position.availableShares}{' '}
                                                                          Share
                                                                      </dd>
                                                                  </div>
                                                                  {'basisSource' in
                                                                  canonicalConfirmation.position ? (
                                                                      <div>
                                                                          <dt>基準來源／價格</dt>
                                                                          <dd>
                                                                              {canonicalConfirmation.position.basisSource ===
                                                                              'broker_average_cost'
                                                                                  ? '券商確認平均成本'
                                                                                  : '使用者指定'}{' '}
                                                                              /{' '}
                                                                              {(
                                                                                  canonicalConfirmation.position.basisPriceMinorUnits / 100
                                                                              ).toFixed(2)}
                                                                          </dd>
                                                                      </div>
                                                                  ) : (
                                                                      <div>
                                                                          <dt>子單 reduce-only 依據</dt>
                                                                          <dd>
                                                                              子單商品目前可用現股；不得使用母單成交量跨商品推導
                                                                          </dd>
                                                                      </div>
                                                                  )}
                                                                  <div>
                                                                      <dt>部位 as-of</dt>
                                                                      <dd>
                                                                          {formatLocalDateTime(
                                                                              canonicalConfirmation.position.asOfEpochMs,
                                                                          )}
                                                                      </dd>
                                                                  </div>
                                                              </>
                                                          ) : (
                                                              <div>
                                                                  <dt>部位證據</dt>
                                                                  <dd>快速單不適用；已綁定目前 mapping／商品／risk／Runtime heads</dd>
                                                              </div>
                                                          )}
                                                          <div>
                                                              <dt>商品 revision</dt>
                                                              <dd>
                                                                  {
                                                                      canonicalConfirmation.contract
                                                                          .contractRevision
                                                                  }
                                                                  {' / '}
                                                                  {
                                                                      canonicalConfirmation.contract
                                                                          .corporateActionRevision
                                                                  }
                                                              </dd>
                                                          </div>
                                                          {canonicalConfirmation.childContract ? (
                                                              <div>
                                                                  <dt>母單／子單商品</dt>
                                                                  <dd>
                                                                      {
                                                                          canonicalConfirmation.contract
                                                                              .contractKey
                                                                      }
                                                                      {' → '}
                                                                      {
                                                                          canonicalConfirmation.childContract
                                                                              .contractKey
                                                                      }
                                                                      {'；各自監控同一委託商品'}
                                                                  </dd>
                                                              </div>
                                                          ) : null}
                                                          <div>
                                                              <dt>unit／類別／資料日</dt>
                                                              <dd>
                                                                  {
                                                                      canonicalConfirmation.contract
                                                                          .contractUnit
                                                                  }{' '}
                                                                  Share／
                                                                  {
                                                                      canonicalConfirmation.contract
                                                                          .category
                                                                  }
                                                                  ／
                                                                  {
                                                                      canonicalConfirmation.contract
                                                                          .updateDate
                                                                  }
                                                              </dd>
                                                          </div>
                                                          <div>
                                                              <dt>mode／risk／Runtime revision</dt>
                                                              <dd>
                                                                  {
                                                                      canonicalConfirmation.modeGeneration
                                                                  }
                                                                  {' / '}
                                                                  {
                                                                      canonicalConfirmation.riskRevision
                                                                  }
                                                                  {' / '}
                                                                  {
                                                                      canonicalConfirmation.runtimeRevision
                                                                  }
                                                              </dd>
                                                          </div>
                                                          <div>
                                                              <dt>confirmation 到期</dt>
                                                              <dd>
                                                                  {formatLocalDateTime(
                                                                      canonicalConfirmation.validUntilEpochMs,
                                                                  )}
                                                              </dd>
                                                          </div>
                                                      </>
                                                  ) : null}
                                              </dl>
                                              <p className={styles.fieldHelp}>
                                                  帳號識別不會輸出到 browser。任何帳號、商品、數量、價別、basis、保護、mode、risk、position
                                                  或 Gate head 漂移，accept 時都會重新計算並拒絕舊 snapshot。
                                              </p>
                                          </section>
                                      </div>
                                  ) : null}

                                  <div className={styles.actions}>
                                      <button
                                          type='button'
                                          className={styles.secondaryButton}
                                          onClick={() => {
                                              if (draftStep === 'condition') {
                                                  setDraftFlow('closed');
                                              } else if (draftStep === 'order') {
                                                  setDraftStep('condition');
                                              } else {
                                                  setDraftStep('order');
                                              }
                                          }}
                                          disabled={saving}
                                      >
                                          {draftStep === 'condition'
                                              ? '返回清單'
                                              : '上一步'}
                                      </button>
                                      {draftStep === 'confirm' ? (
                                          <button
                                              type='button'
                                              className={styles.primaryButton}
                                              onClick={() =>
                                                  void saveCanonicalDraft()
                                              }
                                                  disabled={
                                                      saving ||
                                                      !activeDraft ||
                                                      !draftCandidate.definition ||
                                                      reviewedDraftFingerprint === null ||
                                                      draftReviewInvalidated ||
                                                      (['quick', 'parent_child', 'stop_take', 'trailing_exit'].includes(
                                                          activeDraft.strategyKind,
                                                      ) && !canonicalConfirmation)
                                                  }
                                              title='只接受 Runtime canonical confirmation，不會 arm 或送出 broker 委託'
                                          >
                                              {saving
                                                  ? '接受中…'
                                                  : ['quick', 'parent_child', 'stop_take', 'trailing_exit'].includes(
                                                          activeDraft?.strategyKind ?? '',
                                                    )
                                                    ? '接受 Runtime canonical confirmation'
                                                    : '保存 canonical 草稿'}
                                          </button>
                                      ) : (
                                          <button
                                              type='button'
                                              className={styles.primaryButton}
                                              onClick={() =>
                                                  draftStep === 'condition'
                                                      ? setDraftStep('order')
                                                      : reviewCurrentDraft()
                                              }
                                              disabled={
                                                  saving ||
                                                  !activeDraft ||
                                                  !draftCandidate.definition
                                              }
                                          >
                                              下一步
                                          </button>
                                      )}
                                  </div>
                              </>
                          )}
                      </section>
                  </div>,
                  document.body,
              )
            : null;

    return (
        <>
        <div className={styles.root}>
            <div className={styles.boundaryNotice} role='note'>
                <span
                    className={
                        online ? styles.statusDot.online : styles.statusDot.offline
                    }
                    aria-hidden='true'
                />
                <span>
                    本機監控・非券商雲端。Mac 關機、睡眠、斷網或交易 session
                    中斷時不會持續監控；實盤不可把它當成唯一保護。
                </span>
            </div>

            <div
                className={styles.exposureBoundaryNotice}
                role='note'
                aria-label='本地 reduce-only 與外部交易限制'
            >
                <strong>本地 reduce-only 非券商原子保證：</strong>
                <span>
                    判定只依最後一次固定帳號的部位與完整 working-sell
                    對帳。券商 App、其他 client 或電話委託仍可能在 snapshot
                    後改變部位；Runtime 會在下一個 event／對帳停送並轉人工，但不能消除外部
                    TOCTOU 競態。
                </span>
            </div>

            <div
                className={styles.runtimeStrip}
                role='status'
                aria-live='polite'
                aria-atomic='true'
                aria-label='智慧下單 Runtime 狀態'
            >
                <div className={styles.runtimeCell}>
                    <span className={styles.runtimeLabel}>Runtime</span>
                    <span className={styles.runtimeValue}>
                        {readiness
                            ? `SIM · ${readiness.runtime.state}`
                            : 'offline'}
                    </span>
                </div>
                <div className={styles.runtimeCell}>
                    <span className={styles.runtimeLabel}>最後 readiness</span>
                    <span className={styles.runtimeValue}>{contactLabel}</span>
                </div>
                <div className={styles.runtimeCell}>
                    <span className={styles.runtimeLabel}>行情 freshness</span>
                    <span className={styles.runtimeValue}>
                        {readiness
                            ? `${readiness.quote.state}${
                                  readiness.quote.asOfExchangeTime
                                      ? ` · ${readiness.quote.asOfExchangeTime}`
                                      : ''
                              }`
                            : 'unverified'}
                    </span>
                </div>
                <div className={styles.runtimeCell}>
                    <span className={styles.runtimeLabel}>自動寫入</span>
                    <span className={styles.runtimeValue}>
                        {readiness?.writeMaster === 'disabled' ? '已封鎖' : '未知'}
                    </span>
                </div>
            </div>

            <div className={styles.limitNotice} role='note'>
                <span>
                    RealTimeStock 股票本機上限：同一已驗證身分跨固定股票帳號 20
                    筆，且 paused／recovery／manual／未結義務等較保守狀態仍計入；目前尚未解鎖。
                </span>
                <span>
                    大戶投券商雲端上限：同一 ID 跨帳號台股＋期權 20
                    筆；本機不會讀取、占用或同步該額度。
                </span>
            </div>

            <div className={styles.limitNotice} role='note'>
                {legacyInspection.manualRebuildCount > 0 ? (
                    <span>
                        偵測到 {legacyInspection.manualRebuildCount}{' '}
                        筆舊版停損／停利觸價資料；因缺少固定帳號、單位、confirmation
                        revision 與 broker correlation，只能人工核對後重建，不會自動匯入或啟用。
                    </span>
                ) : null}
                {legacyInspection.pureAlertCount > 0 ? (
                    <span>
                        另有 {legacyInspection.pureAlertCount}{' '}
                        筆舊版純警示，只能作唯讀檢視；警示通知不是 broker 證據。
                    </span>
                ) : null}
                {!legacyInspection.parsed || legacyInspection.invalidCount > 0 ? (
                    <span>
                        舊版觸價資料含無法安全辨識的內容，已忽略且未取得任何交易權限。
                    </span>
                ) : null}
                <span>{LEGACY_BRACKET_RECOVERY.message}</span>
            </div>

            <SmartOrderRiskPolicyEditor />

            <section
                className={styles.drainSummary}
                aria-label='智慧下單停止與卸載阻擋摘要'
            >
                <div className={styles.drainSummaryHeader}>
                    <span>停止／rollback／uninstall drain</span>
                    <span>
                        {readiness?.lifecycle.state ===
                        'verified_repository_projection'
                            ? `${readiness.lifecycle.blockerCount ?? '未知'} 項阻擋`
                            : '未能驗證，預設拒絕'}
                    </span>
                </div>
                {readiness?.lifecycle.drainItems
                    .filter((item) => item.count > 0)
                    .map((item) => (
                        <div
                            key={item.kind}
                            className={styles.drainItem}
                        >
                            <strong>
                                {LIFECYCLE_KIND_LABELS[item.kind] ?? item.kind} ×{' '}
                                {item.count}
                            </strong>
                            <span>
                                {LIFECYCLE_DISPOSITION_LABELS[
                                    item.disposition
                                ] ?? item.disposition}
                            </span>
                        </div>
                    ))}
                {readiness?.lifecycle.drainRecords.length ? (
                    <ol
                        className={styles.drainRecordList}
                        aria-label='逐項停止阻擋清單'
                    >
                        {readiness.lifecycle.drainRecords.map((record) => {
                            const quantity = lifecycleQuantityLabel(
                                record.quantityShares,
                                record.quantityState,
                            );
                            return (
                                <li
                                    key={record.ordinal}
                                    className={styles.drainRecord}
                                >
                                    <strong>
                                        #{record.ordinal}{' '}
                                        {LIFECYCLE_KIND_LABELS[record.kind] ??
                                            '未知 Runtime 義務'}
                                    </strong>
                                    <span>
                                        {LIFECYCLE_STATE_LABELS[record.state] ??
                                            '狀態未對應'}
                                        {quantity ? ` · ${quantity}` : ''}
                                    </span>
                                    <span>
                                        {LIFECYCLE_DISPOSITION_LABELS[
                                            record.disposition
                                        ] ?? '必須先完成對帳與人工處理'}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                ) : null}
                {readiness?.lifecycle.drainRecordsTruncated ? (
                    <div className={styles.drainItem} role='alert'>
                        <strong>逐項清單已達 100 筆上限</strong>
                        <span>
                            尚有未顯示阻擋項目；停止、rollback 與 uninstall 仍維持拒絕。
                        </span>
                    </div>
                ) : null}
                {readiness?.lifecycle.runtimeTrackedUnprotectedRemainder.state ===
                'unknown' ? (
                    <div className={styles.drainItem} role='alert'>
                        <strong>Runtime 未受保護量：未知</strong>
                        <span>
                            必須先完成固定帳號對帳；不得把 last-known 或一般持股當成可安全停止的證據。
                        </span>
                    </div>
                ) : null}
                <small>
                    此處只顯示去識別化阻擋類型與數量；請在對應策略卡分別執行取消策略、取消券商委託、本機取消未送出意圖或二次確認人工relinquish，不會以單一按鈕混用權限。
                </small>
            </section>

            <div
                className={styles.tabs}
                role='tablist'
                aria-label='智慧單狀態'
                onKeyDown={onTabListKeyDown}
            >
                {PANEL_TABS.map(({ value, label }) => (
                    <button
                        key={value}
                        id={`smart-order-tab-${value}`}
                        type='button'
                        role='tab'
                        data-smart-order-tab={value}
                        tabIndex={tab === value ? 0 : -1}
                        aria-selected={tab === value}
                        aria-controls={`smart-order-tabpanel-${value}`}
                        className={
                            tab === value ? styles.tab.active : styles.tab.idle
                        }
                        onClick={() => {
                            setDraftFlow('closed');
                            setTab(value);
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div
                id={`smart-order-tabpanel-${tab}`}
                className={styles.content}
                role='tabpanel'
                aria-labelledby={`smart-order-tab-${tab}`}
            >
                {error ? (
                    <div className={styles.error} role='alert'>
                        {error}
                    </div>
                ) : null}

                {tab === 'history' ? (
                    <div className={styles.historyToolbar}>
                        <span>
                            最後成功讀取：{historyLastSuccessLabel}
                            {historyError && historyLastSuccessAt !== null
                                ? '（目前顯示舊快照）'
                                : ''}
                        </span>
                        <button
                            type='button'
                            className={styles.compactButton}
                            onClick={() => void refresh()}
                        >
                            重新整理歷程
                        </button>
                    </div>
                ) : null}

                {tab === 'history' && historyError ? (
                    <div className={styles.error} role='alert'>
                        歷程更新失敗：{historyError}{' '}
                        {historyLastSuccessAt === null
                            ? '目前沒有成功讀取過的歷程；畫面不會用一般策略清單猜測 terminal 結果。'
                            : `目前保留最後成功於 ${historyLastSuccessLabel} 讀取的舊快照；請勿把舊快照、通知或本機顯示當成 broker 證據。`}
                    </div>
                ) : null}

                {tab === 'history' ? (
                    historyItems.length > 0 ? (
                        <div className={styles.cardList}>
                            {historyItems.map((item) => (
                                <article
                                    key={item.strategyId}
                                    className={styles.strategyCard}
                                >
                                    <div className={styles.strategyCardHeader}>
                                        <span>
                                            {LABEL_BY_KIND.get(item.strategyKind) ??
                                                item.strategyKind}
                                        </span>
                                        <span>{historyStateLabel(item.state)}</span>
                                    </div>
                                    <div className={styles.strategyMeta}>
                                        reason {item.reasonCode} · revision{' '}
                                        {item.revision}
                                        <br />
                                        終結{' '}
                                        {new Date(
                                            item.terminalAtEpochMs,
                                        ).toLocaleString('zh-TW', {
                                            hour12: false,
                                        })}
                                        <br />
                                        exchange{' '}
                                        {item.exchangeEpochMs === null
                                            ? '—'
                                            : new Date(
                                                  item.exchangeEpochMs,
                                              ).toLocaleString('zh-TW', {
                                                  hour12: false,
                                              })}{' '}
                                        · broker{' '}
                                        {item.brokerEpochMs === null
                                            ? '—'
                                            : new Date(
                                                  item.brokerEpochMs,
                                              ).toLocaleString('zh-TW', {
                                                  hour12: false,
                                              })}{' '}
                                        · receive{' '}
                                        {new Date(
                                            item.receiveEpochMs,
                                        ).toLocaleString('zh-TW', {
                                            hour12: false,
                                        })}
                                        <br />
                                        {item.maskedAccountLabel}；通知與本機顯示不是
                                        broker 證據。
                                    </div>
                                    <div className={styles.strategyActions}>
                                        <button
                                            type='button'
                                            className={styles.compactButton}
                                            onClick={() => void copyToDraft(item)}
                                            disabled={
                                                copyingStrategyId !== null ||
                                                controllingStrategyId !== null
                                            }
                                        >
                                            {copyingStrategyId === item.strategyId
                                                ? '複製中…'
                                                : '複製為草稿'}
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.empty}>
                            <h3 className={styles.emptyTitle}>
                                {loading
                                    ? '正在讀取本機歷程…'
                                    : historyError
                                      ? '歷程暫時無法讀取'
                                      : '目前沒有歷程紀錄'}
                            </h3>
                            <p className={styles.emptyText}>
                                {historyError
                                    ? `${historyError} 畫面不會用一般策略清單猜測 terminal 結果。`
                                    : '只有 broker side effect 與所有本機義務都終結後，策略才會出現在這裡。'}
                            </p>
                        </div>
                    )
                ) : visibleStrategies.length > 0 ? (
                    <div className={styles.cardList}>
                        {visibleStrategies.map((strategy) => (
                            <article
                                key={strategy.strategyId}
                                className={styles.strategyCard}
                            >
                                <div className={styles.strategyCardHeader}>
                                    <span>
                                        {LABEL_BY_KIND.get(strategy.strategyKind) ??
                                            strategy.strategyKind}
                                    </span>
                                    <span>
                                        {stateLabel(
                                            strategyDisplayState(
                                                strategy,
                                                strategiesSnapshotCurrent,
                                            ),
                                        )}
                                    </span>
                                </div>
                                <div className={styles.strategyMeta}>
                                    revision {strategy.revision} · 更新{' '}
                                    {new Date(
                                        strategy.updatedAtEpochMs,
                                    ).toLocaleString('zh-TW', { hour12: false })}
                                    <br />
                                    {strategy.accountBound
                                        ? (strategy.maskedAccountLabel ??
                                          '帳號已固定（識別資訊不顯示）')
                                        : '尚未綁定帳號・不可啟動'}
                                    {strategyDisplayState(
                                        strategy,
                                        strategiesSnapshotCurrent,
                                    ) !==
                                    strategy.state ? (
                                        <>
                                            <br />
                                            策略外層：{stateLabel(strategy.state)}
                                        </>
                                    ) : null}
                                </div>
                                {strategy.strategyKind === 'parent_child' &&
                                [
                                    'manual_intervention',
                                    'expired_with_obligation',
                                ].includes(strategy.state) ? (
                                    <div
                                        className={styles.activityTraceRisk}
                                        role='alert'
                                        aria-label='母子單自動推進已停止'
                                    >
                                        <strong>母子單自動推進已停止</strong>
                                        <span>
                                            母單若未全部成交，已成交現股不由此子單保護；子單若已委託、部分成交或結果未知，請先以券商資料完成對帳。
                                        </span>
                                        <span>
                                            需要後續保護時請另建新策略，不會跨日或自動重送原子單。
                                        </span>
                                    </div>
                                ) : null}
                                {!strategiesSnapshotCurrent ? (
                                    <div
                                        className={styles.activityTraceRisk}
                                        role='alert'
                                        aria-label='策略目前狀態未知'
                                    >
                                        <strong>目前 Runtime 狀態：未知</strong>
                                        <span>
                                            最後成功快照：{stateLabel(strategyDisplayState(strategy))} · as-of{' '}
                                            {formatLocalDateTime(strategy.updatedAtEpochMs)}
                                        </span>
                                        <span>
                                            即使 last-known 未受保護量為 0，也不得視為目前仍在監控或完整受保護。
                                        </span>
                                    </div>
                                ) : null}
                                {strategyActivityRows(strategy).length > 0 ? (
                                    <div
                                        className={styles.activityTrace}
                                        aria-label={
                                            strategiesSnapshotCurrent
                                                ? 'Runtime 實際處理狀態'
                                                : 'Runtime 最後成功快照處理狀態，非 current'
                                        }
                                    >
                                        {!strategiesSnapshotCurrent ? (
                                            <div className={styles.activityTraceRisk}>
                                                以下狀態皆為最後成功快照，非 current Runtime 狀態。
                                            </div>
                                        ) : null}
                                        {strategyActivityRows(strategy).map(
                                            (entry) => (
                                                <div
                                                    key={entry.label}
                                                    className={styles.activityTraceRow}
                                                >
                                                    <span>{entry.label}</span>
                                                    <span>
                                                        {smartOrderActivityStateLabel(
                                                            entry.state,
                                                        )}{' '}
                                                        × {entry.count}
                                                    </span>
                                                </div>
                                            ),
                                        )}
                                        {strategy.activity?.formalProtection ? (
                                            <FormalProtectionProjection
                                                projection={
                                                    strategy.activity.formalProtection
                                                }
                                                snapshotCurrent={
                                                    strategiesSnapshotCurrent
                                                }
                                            />
                                        ) : strategy.activity
                                              ?.protectionObligations.count ? (
                                            <div
                                                className={styles.activityTraceRisk}
                                                role='alert'
                                                aria-label='正式保護投影目前未知'
                                            >
                                                正式保護投影目前未知；不得把預覽估算視為已建立的保護。
                                            </div>
                                        ) : null}
                                        {strategy.activity
                                            ?.runtimeTrackedUnprotectedRemainder
                                            .state === 'last_known' ? (
                                            <div
                                                className={styles.activityTraceRisk}
                                                role='alert'
                                                aria-label='未受保護數量目前未知'
                                            >
                                                <strong>
                                                    目前未受保護量：未知
                                                </strong>
                                                <span>
                                                    最後已知{' '}
                                                    {strategy.activity.runtimeTrackedUnprotectedRemainder.lastKnownShares.toLocaleString(
                                                        'zh-TW',
                                                    )}{' '}
                                                    股 · as-of{' '}
                                                    {formatLocalDateTime(
                                                        strategy.activity.runtimeTrackedUnprotectedRemainder.asOfEpochMs,
                                                    )}
                                                </span>
                                                <span>
                                                    Runtime 尚未證實 current；請先以券商官方委託與部位人工核對。
                                                </span>
                                            </div>
                                        ) : null}
                                        {strategy.activity?.hasUnknownExitClaim ? (
                                            <div className={styles.activityTraceRisk}>
                                                出場 claim 結果未知，禁止自動重送
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                                {strategy.state === 'manual_intervention' ? (
                                    <ManualResolutionProjection
                                        projection={manualResolutions.get(
                                            strategy.strategyId,
                                        )}
                                        snapshotCurrent={
                                            strategiesSnapshotCurrent
                                        }
                                        disabled={
                                            controllingStrategyId !== null ||
                                            copyingStrategyId !== null
                                        }
                                        onApplyUniqueFinal={(resolutionKey) =>
                                            void applyUniqueFinalResolution(
                                                strategy,
                                                resolutionKey,
                                            )
                                        }
                                    />
                                ) : null}
                                <div
                                    className={
                                        smartOrderStatePresentation(
                                            strategyDisplayState(
                                                strategy,
                                                strategiesSnapshotCurrent,
                                            ),
                                        ).highRisk
                                            ? styles.stateDetail.risk
                                            : styles.stateDetail.normal
                                    }
                                >
                                    {
                                        smartOrderStatePresentation(
                                            strategyDisplayState(
                                                strategy,
                                                strategiesSnapshotCurrent,
                                            ),
                                        ).detail
                                    }
                                </div>
                                {strategy.state === 'draft' ? (
                                    <div className={styles.strategyActions}>
                                        <button
                                            type='button'
                                            className={styles.compactButton}
                                            onClick={() =>
                                                void reopenDraft(
                                                    strategy.strategyId,
                                                )
                                            }
                                            disabled={
                                                controllingStrategyId !== null ||
                                                copyingStrategyId !== null
                                            }
                                        >
                                            繼續設定
                                        </button>
                                    </div>
                                ) : null}
                                {strategy.state !== 'draft' ? (
                                    <div className={styles.strategyActions}>
                                        {['observing', 'monitoring'].includes(
                                            strategy.state,
                                        ) ? (
                                            <button
                                                type='button'
                                                className={styles.compactButton}
                                                onClick={() =>
                                                    void controlStrategy(
                                                        strategy,
                                                        'pause',
                                                    )
                                                }
                                                disabled={
                                                    controllingStrategyId !== null ||
                                                    copyingStrategyId !== null
                                                }
                                            >
                                                暫停監控
                                            </button>
                                        ) : null}
                                        {strategy.state === 'paused' ? (
                                            <button
                                                type='button'
                                                className={styles.compactButton}
                                                onClick={() =>
                                                    void controlStrategy(
                                                        strategy,
                                                        'resume',
                                                    )
                                                }
                                                disabled={
                                                    controllingStrategyId !== null ||
                                                    copyingStrategyId !== null ||
                                                    readiness?.gates
                                                        ?.manual_user_confirmed
                                                        ?.state !== 'eligible' ||
                                                    readiness?.gates
                                                        .manual_user_confirmed
                                                        ?.featureGates[
                                                        strategy.strategyKind
                                                    ] !== true
                                                }
                                                title='必須重新確認 current Gate、帳號對帳、confirmation 與 activation policy'
                                            >
                                                重新確認並繼續
                                            </button>
                                        ) : null}
                                        <button
                                            type='button'
                                            className={styles.compactButton}
                                            onClick={() =>
                                                void copyToDraft(strategy)
                                            }
                                            disabled={
                                                copyingStrategyId !== null ||
                                                controllingStrategyId !== null ||
                                                !manualResolutionOperationAllowed(
                                                    strategy,
                                                    'copy_to_new_draft',
                                                )
                                            }
                                        >
                                            {copyingStrategyId ===
                                            strategy.strategyId
                                                ? '複製中…'
                                                : '複製為草稿'}
                                        </button>
                                        {(strategy.activity?.brokerOrders
                                            .count ?? 0) > 0 &&
                                        !TERMINAL_STATES.has(
                                            strategy.state,
                                        ) ? (
                                            <button
                                                type='button'
                                                className={
                                                    styles.compactDangerButton
                                                }
                                                onClick={() =>
                                                    void cancelWorkingBrokerOrder(
                                                        strategy,
                                                    )
                                                }
                                                disabled={
                                                    controllingStrategyId !==
                                                        null ||
                                                    copyingStrategyId !== null
                                                }
                                                title='獨立建立取消券商委託 intent；不等於取消本機策略，且此 HTTP 請求不直接送出 broker bytes'
                                            >
                                                準備取消券商委託
                                            </button>
                                        ) : null}
                                        {strategy.state === 'cancel_pending' &&
                                        strategy.activity?.intents.state ===
                                            'prepared' ? (
                                            <button
                                                type='button'
                                                className={styles.compactDangerButton}
                                                onClick={() =>
                                                    void drainPreparedIntent(
                                                        strategy,
                                                    )
                                                }
                                                disabled={
                                                    controllingStrategyId !== null ||
                                                    copyingStrategyId !== null
                                                }
                                                title='只取消已證明未授權 adapter 的 prepared intent，並原子釋放本機 companions；不呼叫券商'
                                            >
                                                本機取消未送出意圖
                                            </button>
                                        ) : null}
                                        {(strategy.activity
                                        ?.protectionObligations.count ?? 0) >
                                            0 &&
                                        strategy.activity?.intents.state !==
                                            'prepared' &&
                                        manualResolutionOperationAllowed(
                                            strategy,
                                            'break_glass_relinquish',
                                        ) &&
                                        [
                                            'paused',
                                            'recovery',
                                            'manual_intervention',
                                            'cancel_pending',
                                            'expired_with_obligation',
                                        ].includes(strategy.state) ? (
                                            <button
                                                type='button'
                                                className={styles.compactDangerButton}
                                                onClick={() =>
                                                    void relinquishProtection(
                                                        strategy,
                                                    )
                                                }
                                                disabled={
                                                    controllingStrategyId !== null ||
                                                    copyingStrategyId !== null
                                                }
                                                title='需兩次分離確認；只轉交本機監控責任，並留下 durable unknown-exposure blocker'
                                            >
                                                {relinquishmentChallenge
                                                    ?.strategyId ===
                                                    strategy.strategyId &&
                                                relinquishmentChallenge.strategyRevision ===
                                                    strategy.revision
                                                    ? '第二次確認人工接手'
                                                    : '準備人工接手保護'}
                                            </button>
                                        ) : null}
                                        {!TERMINAL_STATES.has(strategy.state) &&
                                        strategy.state !== 'cancel_pending' &&
                                        manualResolutionOperationAllowed(
                                            strategy,
                                            'cancel_strategy',
                                        ) ? (
                                            <button
                                                type='button'
                                                className={styles.compactDangerButton}
                                                onClick={() =>
                                                    void controlStrategy(
                                                        strategy,
                                                        'cancel',
                                                    )
                                                }
                                                disabled={
                                                    controllingStrategyId !== null ||
                                                    copyingStrategyId !== null
                                                }
                                                title='只取消本機策略；不會默認取消券商 working order'
                                            >
                                                取消策略
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </article>
                        ))}
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <h3 className={styles.emptyTitle}>
                            {loading
                                ? '正在讀取本機策略…'
                                : tab === 'monitoring'
                                  ? '目前沒有監控中的智慧單'
                                  : tab === 'processing'
                                    ? '目前沒有處理中的智慧單'
                                    : '目前沒有歷程紀錄'}
                        </h3>
                        <p className={styles.emptyText}>
                            設定條件後由 Mac 本機 Runtime 持續監控。觸發不等於成交，斷線或結果未知時會停止自動動作並要求人工確認。
                        </p>
                        <button
                            type='button'
                            className={styles.primaryButton}
                            onClick={openDraftSelector}
                            disabled={loading}
                        >
                            新增智慧單
                        </button>
                    </div>
                )}
            </div>
        </div>
        {draftDialog}
        </>
    );
}
