import { validateIntradayMonitorBoundedKbarCapture } from './pilot-acceptance-bundle.mjs';
import { validatePassiveChartFreshnessEvidence } from './passive-chart-freshness-evidence.mjs';
import { validateIntradayMonitorPilotRuntimeAssurance } from './pilot-runtime-assurance.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHART_ATTENTION_TIME = '10:00:00';
const CLOSE_FINALIZATION_TIME = '13:34:30';

function taipeiInstant(tradeDate, time) {
    return Date.parse(`${tradeDate}T${time}+08:00`);
}

function present(value) {
    return value !== null && value !== undefined;
}

export function assessIntradayMonitorDailyEvidence({
    tradeDate,
    previousTradeDate,
    now,
    plan,
    capture = null,
    captureFailure = null,
    chartEvidence = null,
    assurance = null,
} = {}) {
    const nowEpochMs = Date.parse(now ?? '');
    if (!DATE.test(tradeDate ?? '') || !DATE.test(previousTradeDate ?? '') ||
        previousTradeDate >= tradeDate || !Number.isFinite(nowEpochMs) || !plan) {
        throw new TypeError('daily pilot evidence status input is invalid');
    }
    const afterChartAttention = nowEpochMs >= taipeiInstant(tradeDate, CHART_ATTENTION_TIME);
    const afterClose = nowEpochMs >= taipeiInstant(tradeDate, CLOSE_FINALIZATION_TIME);
    const chartResult = present(chartEvidence)
        ? validatePassiveChartFreshnessEvidence(chartEvidence)
        : null;
    const assuranceResult = present(assurance)
        ? validateIntradayMonitorPilotRuntimeAssurance(assurance)
        : null;
    const captureResult = present(capture)
        ? validateIntradayMonitorBoundedKbarCapture(capture, plan)
        : null;
    const reasons = [];
    const warnings = [];

    if (present(captureFailure)) reasons.push('capture_failure_present');
    if (captureResult && !captureResult.valid) reasons.push('capture_invalid');
    if (!afterClose && captureResult?.valid) reasons.push('capture_finalized_before_close');
    if (chartResult && !chartResult.ready) reasons.push('passive_chart_evidence_invalid');
    if (chartEvidence?.tradeDate && chartEvidence.tradeDate !== tradeDate) {
        reasons.push('passive_chart_trade_date_mismatch');
    }
    if (assuranceResult && !assuranceResult.ready) reasons.push('runtime_assurance_invalid');
    if (assurance?.tradeDate && assurance.tradeDate !== tradeDate) {
        reasons.push('runtime_assurance_trade_date_mismatch');
    }
    if (assurance?.previousTradeDate && assurance.previousTradeDate !== previousTradeDate) {
        reasons.push('runtime_assurance_previous_trade_date_mismatch');
    }
    if (present(assurance) && !present(chartEvidence)) {
        reasons.push('runtime_assurance_without_chart_evidence');
    }

    if (afterClose) {
        if (!present(capture) && !present(captureFailure)) reasons.push('capture_outcome_missing');
        if (!present(chartEvidence)) reasons.push('passive_chart_evidence_missing');
        if (!present(assurance)) reasons.push('runtime_assurance_missing');
    } else if (afterChartAttention) {
        if (!present(chartEvidence)) warnings.push('passive_chart_evidence_overdue');
        else if (!present(assurance)) warnings.push('runtime_assurance_overdue');
    }

    const readyForDailyBundle = afterClose && reasons.length === 0 &&
        captureResult?.valid === true && chartResult?.ready === true && assuranceResult?.ready === true;
    const status = readyForDailyBundle ? 'complete' : reasons.length > 0 ? 'failed' :
        warnings.length > 0 ? 'attention' : 'healthy';
    const nextActions = [];
    if (!afterClose && !present(chartEvidence)) {
        nextActions.push('observe_existing_chart_twice_without_interaction');
        nextActions.push('build_and_validate_passive_chart_evidence');
    }
    if (!afterClose && present(chartEvidence) && !present(assurance)) {
        nextActions.push('build_and_validate_runtime_assurance');
    }
    if (afterClose && !readyForDailyBundle) {
        nextActions.push('preserve_day_as_incomplete_and_do_not_build_two_day_bundle');
    }
    return Object.freeze({
        schemaVersion: 'intraday-monitor-daily-evidence-status/1',
        tradeDate,
        previousTradeDate,
        assessedAt: now,
        phase: afterClose ? 'post_close' : 'live_or_preopen',
        status,
        readyForDailyBundle,
        artifacts: Object.freeze({
            capture: Object.freeze({ present: present(capture), valid: captureResult?.valid ?? null }),
            captureFailure: Object.freeze({ present: present(captureFailure) }),
            passiveChartEvidence: Object.freeze({ present: present(chartEvidence), ready: chartResult?.ready ?? null }),
            runtimeAssurance: Object.freeze({ present: present(assurance), ready: assuranceResult?.ready ?? null }),
        }),
        reasons: Object.freeze([...new Set(reasons)]),
        warnings: Object.freeze([...new Set(warnings)]),
        nextActions: Object.freeze(nextActions),
        deadlines: Object.freeze({
            passiveChartAttentionAt: `${tradeDate}T${CHART_ATTENTION_TIME}+08:00`,
            closeFinalizationAt: `${tradeDate}T${CLOSE_FINALIZATION_TIME}+08:00`,
        }),
    });
}
