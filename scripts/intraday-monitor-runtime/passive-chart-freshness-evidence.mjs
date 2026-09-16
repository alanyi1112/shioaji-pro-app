import { createHash } from 'node:crypto';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

export const PASSIVE_CHART_FRESHNESS_EVIDENCE_SCHEMA = 'candle-chart-passive-freshness-evidence/1';
export const PASSIVE_CHART_FRESHNESS_OBSERVATION_SCHEMA = 'candle-chart-passive-freshness-observation/1';
const HASH = /^[a-f0-9]{64}$/;

function digest(value) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validInstant(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validObservation(value) {
    return value && validInstant(value.observedAt) && validInstant(value.lastVisualCommitAt) &&
        validInstant(value.lastSourceTime) && Number.isSafeInteger(value.freshnessMs) && value.freshnessMs >= 0 &&
        Date.parse(value.observedAt) - Date.parse(value.lastVisualCommitAt) === value.freshnessMs;
}

function taipeiTradeDate(value) {
    if (!validInstant(value)) return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
}

function validZeroOperationLedger(value) {
    return Boolean(value && Number.isSafeInteger(value.domReads) && value.domReads >= 2 &&
        value.networkRequests === 0 && value.navigationCount === 0 && value.reloadCount === 0 &&
        value.clickCount === 0 && value.subscriptionMutations === 0 &&
        value.notificationDispatches === 0 && value.brokerWrites === 0 &&
        value.productionTransitions === 0 && value.serviceLifecycleMutations === 0);
}

function chartFromObservation(observation, canonicalSymbol, timeframeMinutes) {
    if (observation?.schemaVersion !== PASSIVE_CHART_FRESHNESS_OBSERVATION_SCHEMA ||
        !validInstant(observation.observedAt) || !Array.isArray(observation.charts) ||
        observation.operations?.domReads !== 1 || observation.operations?.networkRequests !== 0 ||
        observation.operations?.navigationCount !== 0 || observation.operations?.reloadCount !== 0 ||
        observation.operations?.subscriptionMutations !== 0 || observation.operations?.brokerWrites !== 0 ||
        observation.operations?.productionTransitions !== 0 ||
        observation.operations?.serviceLifecycleMutations !== 0) return null;
    return observation.charts.find((chart) => chart?.code === canonicalSymbol &&
        chart.timeframeMinutes === timeframeMinutes && validInstant(chart.lastVisualCommitAt) &&
        validInstant(chart.lastSourceTime) && Number.isSafeInteger(chart.freshnessMs) &&
        chart.freshnessMs >= 0 &&
        Date.parse(observation.observedAt) - Date.parse(chart.lastVisualCommitAt) === chart.freshnessMs) ?? null;
}

export function createPassiveChartFreshnessEvidence(input = {}) {
    const firstChart = chartFromObservation(input.firstObservation, input.canonicalSymbol,
        input.timeframeMinutes);
    const secondChart = chartFromObservation(input.secondObservation, input.canonicalSymbol,
        input.timeframeMinutes);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate ?? '') ||
        taipeiTradeDate(input.firstObservation?.observedAt) !== input.tradeDate ||
        taipeiTradeDate(input.secondObservation?.observedAt) !== input.tradeDate ||
        !firstChart || !secondChart ||
        Date.parse(input.secondObservation.observedAt) <= Date.parse(input.firstObservation.observedAt) ||
        Date.parse(secondChart.lastVisualCommitAt) <= Date.parse(firstChart.lastVisualCommitAt) ||
        !validInstant(input.geometry?.observedAt) ||
        taipeiTradeDate(input.geometry.observedAt) !== input.tradeDate ||
        Date.parse(input.geometry.observedAt) < Date.parse(input.secondObservation.observedAt) ||
        !Number.isSafeInteger(input.geometry.chartCount) || input.geometry.chartCount < 1 ||
        !Number.isSafeInteger(input.geometry.canvasCount) || input.geometry.canvasCount < 1 ||
        !Number.isSafeInteger(input.geometry.largestCanvasWidth) || input.geometry.largestCanvasWidth < 200 ||
        !Number.isSafeInteger(input.geometry.largestCanvasHeight) || input.geometry.largestCanvasHeight < 100 ||
        input.geometry.allCanvasesVisible !== true || !validZeroOperationLedger(input.operations)) {
        throw new TypeError('passive chart freshness evidence input is invalid');
    }
    const seed = {
        schemaVersion: PASSIVE_CHART_FRESHNESS_EVIDENCE_SCHEMA,
        tradeDate: input.tradeDate,
        sourceUrl: input.sourceUrl,
        canonicalSymbol: input.canonicalSymbol,
        timeframeMinutes: input.timeframeMinutes,
        firstObservation: {
            observedAt: input.firstObservation.observedAt,
            lastVisualCommitAt: firstChart.lastVisualCommitAt,
            lastSourceTime: firstChart.lastSourceTime,
            freshnessMs: firstChart.freshnessMs,
        },
        secondObservation: {
            observedAt: input.secondObservation.observedAt,
            lastVisualCommitAt: secondChart.lastVisualCommitAt,
            lastSourceTime: secondChart.lastSourceTime,
            freshnessMs: secondChart.freshnessMs,
        },
        visualCommitAdvanced: true,
        geometry: structuredClone(input.geometry),
        operations: structuredClone(input.operations),
        provider: {
            physicalUsage: null,
            globalOwnershipComplete: null,
            releaseProven: null,
            headroom: null,
        },
    };
    const evidence = { ...seed, evidenceHash: digest(seed) };
    if (!validatePassiveChartFreshnessEvidence(evidence).ready) {
        throw new TypeError('passive chart freshness evidence input is invalid');
    }
    return Object.freeze(evidence);
}

export function validatePassiveChartFreshnessEvidence(value) {
    const seed = value && typeof value === 'object' ? { ...value } : null;
    if (seed) delete seed.evidenceHash;
    const valid = Boolean(value?.schemaVersion === PASSIVE_CHART_FRESHNESS_EVIDENCE_SCHEMA &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate ?? '') &&
        typeof value.sourceUrl === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value.sourceUrl) &&
        /^[A-Z0-9.]{2,32}$/.test(value.canonicalSymbol ?? '') &&
        Number.isSafeInteger(value.timeframeMinutes) && value.timeframeMinutes > 0 &&
        validObservation(value.firstObservation) && validObservation(value.secondObservation) &&
        taipeiTradeDate(value.firstObservation?.observedAt) === value.tradeDate &&
        taipeiTradeDate(value.secondObservation?.observedAt) === value.tradeDate &&
        Date.parse(value.secondObservation.observedAt) > Date.parse(value.firstObservation.observedAt) &&
        Date.parse(value.secondObservation.lastVisualCommitAt) > Date.parse(value.firstObservation.lastVisualCommitAt) &&
        value.visualCommitAdvanced === true && value.geometry?.chartCount >= 1 &&
        value.geometry?.canvasCount >= 1 && value.geometry?.largestCanvasWidth >= 200 &&
        value.geometry?.largestCanvasHeight >= 100 && value.geometry?.allCanvasesVisible === true &&
        validZeroOperationLedger(value.operations) &&
        value.provider?.physicalUsage === null && value.provider?.globalOwnershipComplete === null &&
        value.provider?.releaseProven === null && value.provider?.headroom === null &&
        HASH.test(value.evidenceHash ?? '') && digest(seed) === value.evidenceHash);
    return Object.freeze({ valid, ready: valid, reasons: valid ? [] : ['invalid_passive_chart_freshness_evidence'],
        networkRequestAuthority: false, subscriptionTransportAuthority: false });
}
