import { validateDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { validateDynamicDailyFinalGateReceipt }
    from './dynamic-daily-premarket-gate.mjs';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';
import { INTRADAY_MONITOR_OBSERVATION_SCHEMA } from './minute-accumulator.mjs';
import { evaluateIntradayRelativeVolume } from './relative-volume-evaluator.mjs';

export const DYNAMIC_DAILY_OBSERVATION_SCHEMA = 'intraday-monitor-daily-observation-evaluation/1';

// 只接受已由 KBar adapter 封存的觀測；沒有任何網路、通知或訂閱副作用。
// baseline 依商品與相同 minuteKey 配對，缺口只影響該商品。
export function evaluateDynamicDailySealedObservation({ plan, coverage,
    manifests = [], finalGate = null, observation, connectionGeneration } = {}) {
    if (!validateDynamicDailyCohortPlan(plan) ||
        coverage?.planHash !== plan.planHash || coverage.tradeDate !== plan.tradeDate ||
        coverage.previousTradeDate !== plan.previousTradeDate ||
        !Array.isArray(coverage.items) || coverage.items.length !== plan.selected.length ||
        !Array.isArray(manifests) ||
        observation?.schemaVersion !== INTRADAY_MONITOR_OBSERVATION_SCHEMA ||
        observation.tradeDate !== plan.tradeDate ||
        observation.connectionGeneration !== connectionGeneration ||
        observation.unit !== 'common_lot' || observation.continuity !== 'complete' ||
        observation.source !== 'shioaji-kbar-stream' ||
        !Number.isSafeInteger(observation.cumulativeVolume) ||
        observation.cumulativeVolume < 0) {
        throw new TypeError('daily_sealed_observation_input_invalid');
    }
    const symbol = observation.contract?.canonicalSymbol;
    const position = plan.selected.findIndex((entry) => entry.canonicalSymbol === symbol &&
        entry.exchange === observation.contract?.exchange);
    if (position < 0 || coverage.items[position]?.canonicalSymbol !== symbol) {
        throw new TypeError('daily_observation_symbol_not_planned');
    }
    const planned = plan.selected[position];
    const baselineState = coverage.items[position];
    const candidates = manifests.filter((manifest) => manifest?.symbol === symbol);
    const manifest = candidates.length === 1 ? candidates[0] : null;
    const validManifest = baselineState.state === 'baseline_ready' &&
        candidates.length === 1 && isHistoricalKbarBaselineManifest(manifest) &&
        manifest.manifestId === baselineState.manifestId &&
        manifest.symbol === symbol && manifest.exchange === planned.exchange &&
        manifest.tradeDate === plan.previousTradeDate &&
        manifest.targetTradeDate === plan.tradeDate &&
        manifest.timeZone === 'Asia/Taipei' && manifest.canonicalUnit === 'common_lot' &&
        manifest.minuteCoverage?.expectedMinuteCount === 270 &&
        manifest.minuteCoverage?.canonicalMinuteCount === 270 &&
        manifest.finalVolumeReconciliation?.matched === true;
    const baselineRows = validManifest ? manifest.cumulativeSeries.filter((row) =>
        row.minuteKey === observation.minuteKey) : [];
    const baseline = baselineRows.length === 1 ? baselineRows[0] : null;
    const gateCurrent = validateDynamicDailyFinalGateReceipt(finalGate, plan) &&
        finalGate.connectionGeneration === connectionGeneration;
    const result = evaluateIntradayRelativeVolume({ admitted: true,
        tradeDate: plan.tradeDate, baselineTradeDate: plan.previousTradeDate,
        canonicalSymbol: symbol, exchange: planned.exchange,
        minuteKey: observation.minuteKey, configRevision: plan.configRevision,
        threshold: planned.threshold,
        currentCumulativeVolume: observation.cumulativeVolume,
        previousCumulativeVolume: baseline?.cumulativeVolume ?? 0,
        todayCompleteness: 'complete',
        baselineCompleteness: baseline ? 'complete' : 'missing',
        calendarCurrent: gateCurrent, sessionCurrent: gateCurrent,
        generationCurrent: gateCurrent,
        continuityComplete: true, unit: 'common_lot',
        sourceVersion: observation.sourceVersion, observationMode: 'live',
        revisionFirstComparable: false, createdAt: observation.receivedTime });
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_OBSERVATION_SCHEMA,
        tradeDate: plan.tradeDate, planHash: plan.planHash,
        canonicalSymbol: symbol, minuteKey: observation.minuteKey,
        baselineManifestId: validManifest ? manifest.manifestId : null,
        baselineState: validManifest ? 'baseline_ready' : 'waiting_baseline',
        gateCurrent,
        currentCumulativeVolume: observation.cumulativeVolume,
        previousCumulativeVolume: baseline?.cumulativeVolume ?? null,
        classification: result.classification, reason: result.reason,
        comparable: result.comparable, matched: result.matched,
        notificationAuthority: false, notificationDispatchCount: 0,
        brokerWriteAuthority: false, productionAuthority: false });
}
