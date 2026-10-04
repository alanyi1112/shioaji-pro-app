import { validateDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';

export const DYNAMIC_DAILY_STATUS_SCHEMA = 'intraday-monitor-daily-status/1';

// 這是每日產品名單的獨立唯讀投影；不能用 Stage 歷史 GO 或舊 pilot active 代填。
export function projectDynamicDailyStatus({ config, plan = null, coverage = null,
    live = null, expectedGeneration = null, pending = null,
    observedAt = new Date().toISOString() } = {}) {
    if (!Number.isSafeInteger(config?.revision) || config.revision < 0 ||
        !Array.isArray(config.items) || config.items.length > 200 ||
        !Number.isFinite(Date.parse(observedAt))) {
        throw new TypeError('daily_status_input_invalid');
    }
    const configured = config.items.length;
    const planValid = validateDynamicDailyCohortPlan(plan);
    const coverageValid = planValid && coverage?.planHash === plan.planHash &&
        coverage.tradeDate === plan.tradeDate &&
        coverage.previousTradeDate === plan.previousTradeDate &&
        Array.isArray(coverage.items) && coverage.items.length === plan.selected.length &&
        coverage.items.every((item, index) =>
            item.canonicalSymbol === plan.selected[index].canonicalSymbol);
    const liveValid = coverageValid && live?.phase === 'running' &&
        /^simulation:[A-Za-z0-9_-]{16,100}$/.test(expectedGeneration ?? '') &&
        live.connectionGeneration === expectedGeneration &&
        live.planHash === plan.planHash && live.tradeDate === plan.tradeDate &&
        live.admission?.planHash === plan.planHash &&
        live.admission.plannedCount === plan.selected.length &&
        Array.isArray(live.admission.items) &&
        live.admission.items.length === plan.selected.length &&
        live.admission.items.every((item, index) =>
            item.canonicalSymbol === plan.selected[index].canonicalSymbol &&
            item.subscriptionState === 'requested') &&
        live.admission.dataActiveCount === live.admission.items.filter((item) =>
            item.dataState === 'active' && item.comparisonEligible === true &&
            coverage.items.find((baseline) => baseline.canonicalSymbol === item.canonicalSymbol)
                ?.state === 'baseline_ready').length;
    const items = planValid ? plan.selected.map((entry, index) => {
        const baseline = coverageValid ? coverage.items[index] : null;
        const runtime = liveValid ? live.admission.items[index] : null;
        return Object.freeze({ canonicalSymbol: entry.canonicalSymbol,
            planned: true,
            baselineState: baseline?.state ?? 'unknown',
            baselineReason: baseline?.reason ?? (coverageValid ? null : 'coverage_unverified'),
            subscriptionState: runtime?.subscriptionState ?? 'not_requested',
            dataState: runtime?.dataState ?? 'unknown',
            comparisonEligible: runtime?.comparisonEligible === true &&
                baseline?.state === 'baseline_ready',
            notificationAuthority: false });
    }) : [];
    const baselineReady = coverageValid ? items.filter((item) =>
        item.baselineState === 'baseline_ready').length : 0;
    const subscriptionRequested = liveValid && live.admission.subscriptionRequestedCount ===
        plan.selected.length ? plan.selected.length : 0;
    const dataActive = liveValid ? items.filter((item) => item.dataState === 'active' &&
        item.comparisonEligible).length : 0;
    const degraded = liveValid ? items.filter((item) => item.dataState === 'partial').length : null;
    const pendingValid = planValid && pending?.planHash === plan.planHash &&
        Number.isSafeInteger(pending.savedRevision) &&
        pending.savedRevision === config.revision &&
        pending.savedRevision >= plan.configRevision &&
        ['same_revision', 'awaiting_premarket_delta', 'pending_next_trade_date',
            'pending_official_trade_date'].includes(pending.decision);
    const revisionAhead = planValid && config.revision > plan.configRevision;
    const revisionBehind = planValid && config.revision < plan.configRevision;
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_STATUS_SCHEMA,
        observedAt, mode: planValid ? 'daily_plan' : 'feature_off',
        configRevision: config.revision, configured,
        planned: planValid ? plan.selected.length : 0,
        waitingCapacity: planValid ? plan.waiting.length : 0,
        baselineReady, subscriptionRequested, dataActive, degraded,
        exact160BaselineReady: planValid && coverageValid && plan.selected.length === 160 &&
            baselineReady === 160,
        effectiveTradeDate: planValid ? plan.tradeDate : null,
        planRevision: planValid ? plan.configRevision : null,
        planHash: planValid ? plan.planHash : null,
        pendingRevision: revisionAhead ? config.revision : null,
        pendingEffectiveTradeDate: pendingValid && pending.savedRevision > plan.configRevision ?
            pending.effectiveTradeDate : null,
        pendingReason: revisionAhead ? pendingValid ? pending.decision :
            'revision_unverified' : null,
        revisionEvidence: !planValid ? 'no_plan' : revisionBehind ?
            'config_older_than_plan' : revisionAhead ? pendingValid ?
                'pending_verified' : 'pending_unverified' : 'same_revision',
        evidenceState: !planValid ? 'no_plan' : !coverageValid ? 'coverage_unverified' :
            !liveValid ? 'not_live' : 'observed',
        items: Object.freeze(items),
        notificationAuthority: false, brokerWriteAuthority: false,
        productionAuthority: false });
}
