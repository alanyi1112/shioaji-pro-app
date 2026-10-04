export const INTRADAY_MONITOR_CURRENT_SESSION_AUTHORITY_SCHEMA =
    'intraday-monitor-current-session-authority/1';

const LIVE_PHASES = new Set(['starting', 'running', 'closing']);
const ITEM_STATES = new Set([
    'waiting_gate',
    'waiting_pilot_limit',
    'waiting_capacity',
    'waiting_baseline',
    'awaiting_first_kbar',
    'waiting_continuity',
    'active',
    'degraded',
]);
const BASELINE_STATES = new Set(['complete', 'missing', 'stale', 'unknown']);
const DEFAULT_PHASE_BUDGETS_MS = Object.freeze({
    starting: 20 * 60_000,
    running: 2 * 60_000,
    closing: 10 * 60_000,
});

function age(nowEpochMs, instant) {
    const epoch = Date.parse(instant ?? '');
    return Number.isFinite(epoch) && epoch <= nowEpochMs ? nowEpochMs - epoch : null;
}

export function evaluateIntradayMonitorCurrentSession({
    authority,
    session,
    approval,
    artifactBundle,
    savedConfigRevision,
    apiGeneration,
    premarketCaptureFailure = null,
    nowEpochMs = Date.now(),
    phaseBudgetsMs = DEFAULT_PHASE_BUDGETS_MS,
} = {}) {
    const reasons = [];
    if (!session) reasons.push('current_session_missing');
    if (!authority?.current || !authority.tradeDate) reasons.push('calendar_authority_unavailable');
    if (session && authority?.tradeDate && session.tradeDate !== authority.tradeDate) {
        reasons.push('session_trade_date_stale');
    }
    if (session && session.previousTradeDate !== authority?.previousTradeDate) {
        reasons.push('previous_trade_date_mismatch');
    }
    if (!approval) reasons.push('capacity_approval_missing');
    if (session && approval && session.approvalHash !== approval.approvalHash) {
        reasons.push('approval_hash_mismatch');
    }
    if (!artifactBundle?.valid ||
        (session && session.artifactBundleHash !== artifactBundle?.bundleHash)) {
        reasons.push('artifact_bundle_invalid');
    }
    if (session && session.configRevision !== savedConfigRevision) {
        reasons.push('config_revision_mismatch');
    }
    if (session && session.connectionGeneration !== apiGeneration) {
        reasons.push('generation_mismatch');
    }
    if (session && !session.baselineHash) reasons.push('baseline_missing');
    if (session && !LIVE_PHASES.has(session.phase)) reasons.push('session_not_live');
    if (premarketCaptureFailure) reasons.push('premarket_capture_failed');
    const budgetMs = session && LIVE_PHASES.has(session.phase)
        ? phaseBudgetsMs[session.phase]
        : 0;
    const evidenceAgeMs = session ? age(nowEpochMs, session.freshness?.evidenceAt) : null;
    const fresh = Number.isSafeInteger(evidenceAgeMs) && Number.isSafeInteger(budgetMs) &&
        budgetMs > 0 && evidenceAgeMs <= budgetMs;
    if (session && LIVE_PHASES.has(session.phase) && !fresh) reasons.push('evidence_stale');
    const uniqueReasons = [...new Set(reasons)];
    const current = uniqueReasons.length === 0;
    return Object.freeze({
        schemaVersion: INTRADAY_MONITOR_CURRENT_SESSION_AUTHORITY_SCHEMA,
        current,
        reason: uniqueReasons[0] ?? null,
        reasons: Object.freeze(uniqueReasons),
        authorityTradeDate: authority?.tradeDate ?? null,
        sessionTradeDate: session?.tradeDate ?? null,
        phase: session?.phase ?? null,
        configRevision: session?.configRevision ?? null,
        savedConfigRevision: Number.isSafeInteger(savedConfigRevision) ? savedConfigRevision : null,
        evidenceAt: session?.freshness?.evidenceAt ?? null,
        ageMs: evidenceAgeMs,
        budgetMs,
        fresh,
        controlPlaneAuthority: current,
        dataPlaneAuthority: current,
        resultsAuthority: current,
        notificationAuthority: current && approval?.decision === 'go',
        brokerWriteAuthority: false,
        productionAuthority: false,
    });
}

function normalizedConfiguredItem(item) {
    return {
        canonicalSymbol: item.canonicalSymbol,
        enabled: item.enabled !== false,
        eligible: item.eligible !== false,
    };
}

export function normalizeIntradayMonitorSessionItems({
    configuredItems = [],
    sessionItems = [],
    approvedActiveLimit = 20,
    currentSession,
    observedAt = new Date().toISOString(),
} = {}) {
    const rawBySymbol = new Map(sessionItems.map((item) => [item.canonicalSymbol, item]));
    let admittedPosition = 0;
    const items = configuredItems.map(normalizedConfiguredItem).map((item) => {
        const raw = rawBySymbol.get(item.canonicalSymbol);
        let state;
        let reason;
        if (!item.enabled || !item.eligible) {
            state = 'degraded';
            reason = item.enabled ? 'kbar_contract_unsupported' : 'disabled';
        } else if (admittedPosition++ >= approvedActiveLimit) {
            state = 'waiting_pilot_limit';
            reason = 'approved_active_limit';
        } else if (!currentSession?.current) {
            state = 'waiting_gate';
            reason = currentSession?.reason ?? 'current_session_missing';
        } else if (!raw || !ITEM_STATES.has(raw.state)) {
            state = 'degraded';
            reason = 'session_item_missing';
        } else {
            state = raw.state;
            reason = raw.reason;
        }
        const baselineState = BASELINE_STATES.has(raw?.baselineState)
            ? raw.baselineState
            : 'unknown';
        if (state === 'active' && baselineState !== 'complete') {
            state = 'waiting_baseline';
            reason = baselineState === 'stale' ? 'baseline_stale' : 'baseline_missing';
        }
        return Object.freeze({
            canonicalSymbol: item.canonicalSymbol,
            state,
            reason,
            baselineState,
            baselineTradeDate: raw?.baselineTradeDate ?? null,
            subscriptionState: currentSession?.current ? raw?.subscriptionState ?? 'unknown' : 'none',
            firstKbarAt: currentSession?.current ? raw?.firstKbarAt ?? null : null,
            updatedAt: raw?.updatedAt ?? observedAt,
        });
    });
    const count = (state) => items.filter((item) => item.state === state).length;
    const capacity = Object.freeze({
        configured: items.length,
        eligible: configuredItems.filter((item) => item.enabled !== false && item.eligible !== false).length,
        admitted: Math.min(approvedActiveLimit,
            configuredItems.filter((item) => item.enabled !== false && item.eligible !== false).length),
        dataActive: currentSession?.current ? count('active') : 0,
        active: currentSession?.current ? count('active') : 0,
        waitingGate: count('waiting_gate'),
        waitingPilotLimit: count('waiting_pilot_limit'),
        waitingCapacity: count('waiting_capacity'),
        waitingBaseline: count('waiting_baseline'),
        awaitingFirstKbar: count('awaiting_first_kbar'),
        waitingContinuity: count('waiting_continuity'),
        degraded: count('degraded'),
    });
    const accounted = capacity.dataActive + capacity.waitingGate + capacity.waitingPilotLimit +
        capacity.waitingCapacity + capacity.waitingBaseline + capacity.awaitingFirstKbar +
        capacity.waitingContinuity + capacity.degraded;
    if (accounted !== capacity.configured) {
        throw new Error('intraday_monitor_state_count_invariant_failed');
    }
    const baselineSummary = Object.freeze({
        complete: items.filter((item) => item.baselineState === 'complete').length,
        missing: items.filter((item) => item.baselineState === 'missing').length,
        stale: items.filter((item) => item.baselineState === 'stale').length,
        unknown: items.filter((item) => item.baselineState === 'unknown').length,
        tradeDates: Object.freeze([...new Set(items.map((item) => item.baselineTradeDate)
            .filter((value) => typeof value === 'string'))].sort()),
    });
    return Object.freeze({ items: Object.freeze(items), capacity, baselineSummary });
}

export const intradayMonitorCurrentSessionDefaults = Object.freeze({
    phaseBudgetsMs: DEFAULT_PHASE_BUDGETS_MS,
});
