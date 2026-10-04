import { normalizeIntradayMonitorStatus } from './intraday-monitor-view-model';

const PREFIX = '/api/intraday-monitor/v1';

export interface IntradayMonitorCapacityView {
    configured: number;
    eligible: number;
    admitted?: number;
    pilotCohort: number;
    approvedActiveLimit?: number;
    evaluationStageTarget?: 50 | 100 | 160 | null;
    evaluationState?: 'not_scheduled' | 'offline_only' | 'preflight_blocked' | 'running' |
        'pending_evidence' | 'ready_for_review' | 'go' | 'no_go' | 'rollback';
    dataActive: number;
    active: number;
    waiting: number;
    waitingGate: number;
    waitingPilotLimit: number;
    waitingCapacity: number;
    waitingBaseline: number;
    degraded: number;
    confirmedPhysicalUsage: number | null;
    confirmedOtherPhysicalUsage: number | null;
    providerReleaseProven?: boolean | null;
    confirmedHeadroom?: number | null;
    localPhysicalLimit: number;
    requiredHeadroom: number;
    availableForMonitor: number;
    gate0EvidenceCurrent: boolean;
    globalOwnershipComplete: boolean;
    boundedTransportReady?: boolean;
    controlPlaneSubscriptionRequested?: boolean;
    awaitingFirstKbar?: number;
    waitingContinuity?: number;
    notificationAuthority?: boolean;
}

export interface IntradayMonitorApprovalView {
    approvedActiveLimit: number;
    stage: 20 | 50 | 100 | 160 | null;
    decision: 'go' | 'no_go' | 'rollback' | null;
    reviewerType: 'human' | 'codex_delegated' | 'system' | null;
    reviewedAt: string | null;
    evidenceTradeDate: string | null;
    historical: boolean;
}

export interface IntradayMonitorSessionView {
    authorityTradeDate: string | null;
    sessionTradeDate: string | null;
    phase: string | null;
    current: boolean;
    configRevision: number | null;
    savedConfigRevision: number | null;
    startedAt: string | null;
    updatedAt: string | null;
    staleReason: string | null;
    controlPlaneRequested: boolean;
    controlPlaneAccepted: boolean;
    firstKbarAt: string | null;
    startupSource?: 'scheduled' | 'late_boot' | 'unknown';
    coldStartRisk?: boolean;
    scheduled0820Success?: boolean | null;
}

export interface IntradayMonitorBaselineSummaryView {
    complete: number;
    missing: number;
    stale: number;
    unknown: number;
    tradeDates: string[];
}

export interface IntradayMonitorFreshnessView {
    evidenceAt: string | null;
    ageMs: number | null;
    budgetMs: number;
    fresh: boolean;
}

export type IntradayMonitorItemState =
    | 'disabled'
    | 'waiting_gate'
    | 'waiting_pilot_limit'
    | 'waiting_capacity'
    | 'waiting_baseline'
    | 'awaiting_first_kbar'
    | 'waiting_continuity'
    | 'active'
    | 'degraded';

export interface IntradayMonitorItemStatusView {
    canonicalSymbol: string;
    state: IntradayMonitorItemState;
    reason: string;
    source: IntradayMonitorConfigItemView['source'];
    enabled: boolean;
    effectiveThreshold: string;
    baseline: {
        state: 'complete' | 'incomplete' | 'missing' | 'unknown';
        tradeDate: string | null;
        sourceVersion: string | null;
    };
    subscription: {
        state: 'requested' | 'confirmed' | 'pending' | 'unknown' | 'none';
        physicalKey: string | null;
    };
    completedMinute: string | null;
    currentCumulativeVolume: number | null;
    previousCumulativeVolume: number | null;
    updatedAt: string;
}

export interface IntradayMonitorStatusView {
    state: 'feature_off' | 'idle' | 'active' | 'degraded';
    reason: string;
    generation: string;
    configRevision: number;
    lease: {
        activeLeaseCount: number;
        sessionState: string;
        acceptingEvents: boolean;
    };
    capacity: IntradayMonitorCapacityView;
    approval: IntradayMonitorApprovalView;
    session: IntradayMonitorSessionView;
    baselineSummary: IntradayMonitorBaselineSummaryView;
    freshness: IntradayMonitorFreshnessView;
    itemStatuses: IntradayMonitorItemStatusView[];
    observedAt: string;
}

export interface IntradayMonitorDailyStatusView {
    mode: 'feature_off' | 'daily_plan';
    configRevision: number;
    configured: number;
    planned: number;
    waitingCapacity: number;
    baselineReady: number;
    subscriptionRequested: number;
    dataActive: number;
    degraded: number | null;
    exact160BaselineReady: boolean;
    effectiveTradeDate: string | null;
    planRevision: number | null;
    pendingRevision: number | null;
    pendingEffectiveTradeDate: string | null;
    pendingReason: string | null;
    evidenceState: 'no_plan' | 'coverage_unverified' | 'not_live' | 'observed';
    notificationAuthority: false;
}

export interface IntradayMonitorPostcloseRecoveryView {
    tradeDate: string | null;
    state: 'unverified' | 'source_pending' | 'source_unverified' |
        'postclose_data_recovered' | 'partial_or_source_unverified';
    reason: string | null;
    classification?: string;
    sourceCaptureSha256?: string;
    sourceManifestSha256?: string;
    recoveryArtifactSha256?: string;
    liveLastMinute: string | null;
    originalFormalAcceptanceEvidence: boolean | null;
    boundedDerivedAcceptance: boolean | null;
    postcloseDataRecovered: boolean;
    nextDayBaselineUsable: boolean | null;
    affectedSymbolCount?: number;
    recoveredSymbolCount: number;
    recoveredRows: Array<{
        canonicalSymbol: string;
        minuteKey: string;
        cumulativeVolume: number;
        source: 'postclose_verified';
        sourceTradeDate: string;
        verifiedAt: string;
        liveDelivered: false;
        notificationAuthority: false;
        sourceManifestId: string;
    }>;
    verifiedAt?: string;
}

export interface IntradayMonitorConfigItemView {
    contract: {
        security_type: 'STK';
        region: 'TW';
        exchange: 'TSE' | 'OTC';
        code: string;
        target_code: null;
    };
    enabled: boolean;
    thresholdOverride: string | null;
    source: 'manual' | 'watchlist' | 'after_market_screener';
}

export interface IntradayMonitorConfigView {
    revision: number;
    globalThreshold: string;
    items: IntradayMonitorConfigItemView[];
}

export interface IntradayMonitorTriggerView {
    eventId: string;
    kind: 'live' | 'historical';
    tradeDate: string;
    baselineTradeDate: string;
    canonicalSymbol: string;
    exchange: 'TSE' | 'OTC';
    minuteKey: string;
    configRevision: number;
    threshold: string;
    currentCumulativeVolume: number;
    previousCumulativeVolume: number;
    unit: 'common_lot';
    sourceVersion: string;
    formulaVersion: string;
    completeness: 'complete';
    eventHash: string;
    createdAt: string;
    currentEvidence?: {
        minuteKey: string;
        currentCumulativeVolume: number;
        previousCumulativeVolume: number | null;
        unit: 'common_lot';
        completeness: 'complete' | 'incomplete';
        sourceVersion: string;
        baselineProvenance: 'observed' | 'carry_forward' | 'known_zero' | null;
        updatedAt: string;
    } | null;
    notificationAuthority: boolean;
}

export interface IntradayMonitorDiagnosticsView {
    state: 'feature_off' | 'idle' | 'active' | 'degraded' | 'offline';
    reason: string;
    ownershipRevision: number | null;
    evidenceRevision: number | null;
    baseline: {
        complete: boolean;
        tradeDate: string | null;
        sourceVersion: string | null;
        itemCount: number;
    };
    completedMinute: {
        tradeDate: string | null;
        minuteKey: string | null;
        evidenceAt: string | null;
    };
    approval?: IntradayMonitorApprovalView;
    session?: IntradayMonitorSessionView;
    baselineSummary?: IntradayMonitorBaselineSummaryView;
    freshness?: IntradayMonitorFreshnessView;
}

export interface IntradayMonitorResultsPage {
    generation: string;
    repositoryRevision: number;
    items: IntradayMonitorTriggerView[];
    cursor: string;
    nextCursor: string | null;
    authority?: 'current' | 'historical' | 'unverified';
}

export interface IntradayMonitorLeaseView {
    leaseId: string;
    clientId: string;
    generation: string;
    acquiredAt: string;
    expiresAt: string;
}

export class IntradayMonitorApiError extends Error {
    constructor(
        public readonly reason: string,
        public readonly details: unknown,
    ) {
        super(reason);
        this.name = 'IntradayMonitorApiError';
    }
}

async function jsonRequest(path: string, init?: RequestInit) {
    const response = await fetch(`${PREFIX}${path}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...init,
        headers: {
            Accept: 'application/json',
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
        },
    });
    const value: unknown = await response.json();
    if (!response.ok) {
        const reason = value && typeof value === 'object' && 'reason' in value
            ? String(value.reason)
            : 'local_api_unavailable';
        const details = value && typeof value === 'object' && 'details' in value
            ? value.details
            : null;
        throw new IntradayMonitorApiError(reason, details);
    }
    return value as Record<string, unknown>;
}

export async function readIntradayMonitorStatus() {
    const value = await jsonRequest('/status') as unknown as IntradayMonitorStatusView;
    return normalizeIntradayMonitorStatus(value);
}

export async function readIntradayMonitorDailyStatus() {
    const response = await jsonRequest('/daily-status') as unknown as {
        daily: IntradayMonitorDailyStatusView;
    };
    return response.daily;
}

export async function readIntradayMonitorPostcloseRecovery(tradeDate: string) {
    const query = new URLSearchParams({ tradeDate });
    const response = await jsonRequest(`/postclose-recovery?${query}`) as unknown as {
        recovery: IntradayMonitorPostcloseRecoveryView;
    };
    return response.recovery;
}

export async function readIntradayMonitorConfig() {
    const response = await jsonRequest('/config') as unknown as {
        config: IntradayMonitorConfigView;
    };
    return response.config;
}

export async function replaceIntradayMonitorConfig(
    config: IntradayMonitorConfigView,
) {
    const response = await jsonRequest('/config', {
        method: 'PUT',
        body: JSON.stringify({
            schemaVersion: 'intraday-monitor-config-replace-request/1',
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: config.revision,
            config: {
                schemaVersion: 'intraday-monitor-config/1',
                revision: config.revision,
                globalThreshold: config.globalThreshold,
                items: config.items,
            },
        }),
    }) as unknown as { config: IntradayMonitorConfigView };
    return response.config;
}

export async function readIntradayMonitorResults(tradeDate: string) {
    return (await readIntradayMonitorResultsPage(tradeDate)).items;
}

export async function readIntradayMonitorResultsPage(tradeDate: string) {
    const query = new URLSearchParams({ tradeDate, limit: '100' });
    return await jsonRequest(`/results?${query}`) as unknown as IntradayMonitorResultsPage;
}

export async function readIntradayMonitorDiagnostics() {
    return await jsonRequest('/diagnostics') as unknown as IntradayMonitorDiagnosticsView;
}

export async function submitPassiveChartEvidenceObservation(body: Record<string, unknown>) {
    return await jsonRequest('/chart-evidence/observations', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

function leaseMutation(
    action: 'acquire' | 'renew' | 'release',
    body: Record<string, unknown>,
) {
    return jsonRequest(`/leases/${action}`, {
        method: 'POST',
        body: JSON.stringify({
            schemaVersion: 'intraday-monitor-lease-request/1',
            idempotencyKey: crypto.randomUUID(),
            ...body,
        }),
    });
}

export async function acquireIntradayMonitorLease(
    clientId: string,
    generation: string,
) {
    const response = await leaseMutation('acquire', { clientId, generation });
    return response.lease as unknown as IntradayMonitorLeaseView;
}

export async function renewIntradayMonitorLease(lease: IntradayMonitorLeaseView) {
    const response = await leaseMutation('renew', {
        clientId: lease.clientId,
        generation: lease.generation,
        leaseId: lease.leaseId,
    });
    return response.lease as unknown as IntradayMonitorLeaseView;
}

export async function releaseIntradayMonitorLease(lease: IntradayMonitorLeaseView) {
    return leaseMutation('release', {
        clientId: lease.clientId,
        generation: lease.generation,
        leaseId: lease.leaseId,
    });
}

export function intradayMonitorEventsUrl(tradeDate: string, cursor?: string | null) {
    const query = new URLSearchParams({ tradeDate, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    return `${PREFIX}/events?${query}`;
}

export function taipeiTradeDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}
