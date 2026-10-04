import type {
    IntradayMonitorApprovalView,
    IntradayMonitorBaselineSummaryView,
    IntradayMonitorFreshnessView,
    IntradayMonitorItemState,
    IntradayMonitorSessionView,
    IntradayMonitorStatusView,
    IntradayMonitorTriggerView,
} from './intraday-monitor-api';

type LegacyStatus = Omit<IntradayMonitorStatusView,
    'approval' | 'session' | 'baselineSummary' | 'freshness'> &
    Partial<Pick<IntradayMonitorStatusView,
        'approval' | 'session' | 'baselineSummary' | 'freshness'>>;

function normalizedBaselineSummary(status: LegacyStatus): IntradayMonitorBaselineSummaryView {
    if (status.baselineSummary) return status.baselineSummary;
    const counts = { complete: 0, missing: 0, stale: 0, unknown: 0 };
    const tradeDates = new Set<string>();
    for (const item of status.itemStatuses ?? []) {
        const state = item.baseline.state === 'complete' || item.baseline.state === 'missing'
            ? item.baseline.state : 'unknown';
        counts[state] += 1;
        if (item.baseline.tradeDate) tradeDates.add(item.baseline.tradeDate);
    }
    return { ...counts, tradeDates: [...tradeDates].sort() };
}

export function normalizeIntradayMonitorStatus(value: LegacyStatus): IntradayMonitorStatusView {
    const approval: IntradayMonitorApprovalView = value.approval ?? {
        approvedActiveLimit: value.capacity.approvedActiveLimit ?? 20,
        stage: value.capacity.evaluationStageTarget ?? null,
        decision: value.capacity.evaluationState === 'go' || value.capacity.evaluationState === 'no_go' ||
            value.capacity.evaluationState === 'rollback' ? value.capacity.evaluationState : null,
        reviewerType: null,
        reviewedAt: null,
        evidenceTradeDate: null,
        historical: true,
    };
    const session: IntradayMonitorSessionView = value.session ?? {
        authorityTradeDate: null,
        sessionTradeDate: null,
        phase: null,
        current: false,
        configRevision: null,
        savedConfigRevision: value.configRevision,
        startedAt: null,
        updatedAt: null,
        staleReason: 'current_session_missing',
        controlPlaneRequested: false,
        controlPlaneAccepted: false,
        firstKbarAt: null,
    };
    const freshness: IntradayMonitorFreshnessView = value.freshness ?? {
        evidenceAt: null,
        ageMs: null,
        budgetMs: 0,
        fresh: false,
    };
    const current = session.current === true && freshness.fresh === true;
    const capacity = current ? value.capacity : {
        ...value.capacity,
        dataActive: 0,
        active: 0,
        controlPlaneSubscriptionRequested: false,
        notificationAuthority: false,
    };
    return {
        ...value,
        state: current ? value.state : 'feature_off',
        reason: current ? value.reason : session.staleReason ?? 'current_session_missing',
        capacity,
        approval,
        session: { ...session, current },
        baselineSummary: normalizedBaselineSummary(value),
        freshness,
    };
}

export type IntradayMonitorResultSort = 'trigger_time' | 'ratio' | 'code';
export type IntradayMonitorConnectionState = 'starting' | 'connected' | 'reconnecting' | 'paused';

export const itemStateLabels: Record<IntradayMonitorItemState, string> = {
    disabled: '已停用',
    waiting_gate: '等待 bounded Gate',
    waiting_pilot_limit: '等待 pilot limit',
    waiting_capacity: '等待容量',
    waiting_baseline: '等待基準',
    awaiting_first_kbar: '等待首筆行情',
    waiting_continuity: '等待分鐘連續性',
    active: '監控中',
    degraded: '資料降級',
};

export const reasonLabels: Record<string, string> = {
    none: '證據完整',
    disabled: '使用者已停用',
    awaiting_first_kbar: '訂閱已接受，等待第一筆合法 KBar',
    minute_continuity_unknown: '09:01 至目前分鐘仍有缺口',
    gate_evidence_missing: 'Gate 0 證據尚未完整',
    ownership_incomplete: '全域 subscription ownership 尚未完整',
    pilot_limit: '超出固定 20 檔試辦 cohort',
    kbar_contract_unsupported: 'bounded KBar 試辦不支援非四位數或 00 開頭 ETF 代號',
    capacity_exhausted: '共享 subscription 容量不足',
    baseline_missing: '上一交易日同分鐘基準缺漏',
    baseline_incomplete: '上一交易日基準不完整',
    subscription_confirmation_pending: '等待 subscription 確認',
    subscription_confirmation_unknown: 'subscription 狀態無法確認',
    stream_disconnected: '行情串流已中斷',
    continuity_unproven: '中斷區間連續性尚未證實',
    lease_missing: '頁面 lease 尚未生效',
    current_session_missing: '今天尚未建立監控 session',
    session_trade_date_stale: '監控 session 仍停在過去交易日',
    config_revision_mismatch: '今日 session 與目前設定 revision 不一致',
    artifact_bundle_invalid: '執行期 evidence bundle 缺失或驗證失敗',
    generation_mismatch: '今日 session 與 API generation 不一致',
    evidence_stale: '今日監控 evidence 已超過新鮮度上限',
    premarket_capture_failed: '今日 08:50 監控啟動失敗；請查看排程收據與逐檔錯誤，核准容量不代表今日已運作',
    calendar_authority_unavailable: '官方交易日 authority 目前不可用',
    unavailable: '目前沒有可驗證狀態',
};

export function displayedRatio(
    current: number,
    previous: number | null,
) {
    if (previous === null || previous <= 0) return null;
    return (current / previous).toFixed(2);
}

export function triggerRatio(item: IntradayMonitorTriggerView) {
    return displayedRatio(item.currentCumulativeVolume, item.previousCumulativeVolume);
}

export function latestRatio(item: IntradayMonitorTriggerView) {
    const evidence = item.currentEvidence;
    if (!evidence || evidence.completeness !== 'complete') return null;
    return displayedRatio(evidence.currentCumulativeVolume, evidence.previousCumulativeVolume);
}

export function sortIntradayMonitorResults(
    items: readonly IntradayMonitorTriggerView[],
    sort: IntradayMonitorResultSort,
) {
    return [...items].sort((left, right) => {
        let order = 0;
        if (sort === 'code') order = left.canonicalSymbol.localeCompare(right.canonicalSymbol);
        else if (sort === 'ratio') order = Number(latestRatio(right) ?? triggerRatio(right) ?? '-Infinity')
            - Number(latestRatio(left) ?? triggerRatio(left) ?? '-Infinity');
        else order = left.minuteKey.localeCompare(right.minuteKey)
            || (left.createdAt ?? '').localeCompare(right.createdAt ?? '');
        return order || left.eventId.localeCompare(right.eventId);
    });
}

export function overallMonitorLabel(
    status: IntradayMonitorStatusView | null,
    offline: boolean,
    connection: IntradayMonitorConnectionState,
) {
    if (offline) return '服務離線';
    if (!status) return '尚未開始';
    if (!status.session.current) return '今日未啟動';
    if (status.state === 'feature_off') return '等待 bounded Gate';
    if (connection === 'starting') return '尚未開始';
    if (connection === 'paused') return '監控已暫停';
    if (connection === 'reconnecting') return '重新連線中';
    if (status.state === 'degraded' || status.capacity.degraded > 0) return '部分 degraded';
    if ((status.capacity.awaitingFirstKbar ?? 0) > 0) return '等待首筆行情';
    if (status.capacity.waitingBaseline > 0 && status.capacity.active === 0) return '等待基準';
    if (status.capacity.waitingPilotLimit > 0 && status.capacity.active === 0) return '等待 pilot limit';
    if (status.capacity.waitingCapacity > 0 && status.capacity.active === 0) return '等待容量';
    if (status.state === 'active' && status.lease.acceptingEvents && status.capacity.active > 0) return '監控中';
    return '等待監控';
}

export function emptyIntradayMonitorResultMessage(
    status: IntradayMonitorStatusView | null,
    offline: boolean,
    connection: IntradayMonitorConnectionState,
) {
    const label = overallMonitorLabel(status, offline, connection);
    if (offline) return '服務離線，目前沒有可保留的當日結果。';
    if (!status || label === '尚未開始') return '監控尚未開始，正在取得頁面 lease 與狀態。';
    if (!status.session.current || !status.freshness.fresh) return '今日監控未啟動，沒有可驗證的當日達標結果。';
    if (label === '等待 bounded Gate') return '等待 bounded Gate；目前不會產生達標結果。';
    if (label === '監控已暫停') return '監控已暫停；恢復前不會新增達標結果。';
    if (label === '重新連線中') return '正在重新連線；恢復前不會新增達標結果。';
    if (label === '等待首筆行情') return '等待第一筆合法 KBar；目前不會產生達標結果。';
    if (label === '等待容量') return '等待可用容量；目前沒有達標結果。';
    if (label === '等待基準') return '等待完整同分鐘基準；目前不會產生達標結果。';
    if (label === '等待 pilot limit') return '等待 pilot limit；目前不會產生達標結果。';
    if (label === '部分 degraded') return '資料降級期間不新增結果。';
    if (label === '監控中' && status.state === 'active' && status.lease.acceptingEvents && status.capacity.active > 0) {
        return '監控已啟動，目前沒有達標結果。';
    }
    return '等待監控條件就緒；目前不會產生達標結果。';
}
