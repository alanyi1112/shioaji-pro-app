import {
    readIntradayMonitorStatus,
    submitPassiveChartEvidenceObservation,
    taipeiTradeDate,
    type IntradayMonitorStatusView,
} from './intraday-monitor-api';
import {
    observeFreshPassiveChartCommits,
    type PassiveChartEvidenceSample,
} from './passive-chart-freshness';

/** Keep chart evidence independent of whether the intraday monitor panel is open. */
export function startPassiveChartEvidenceCollection(dependencies: Readonly<{
    readStatus?: typeof readIntradayMonitorStatus;
    observe?: typeof observeFreshPassiveChartCommits;
    submit?: typeof submitPassiveChartEvidenceObservation;
    intervalMs?: number;
}> = {}): () => void {
    const readStatus = dependencies.readStatus ?? readIntradayMonitorStatus;
    const observe = dependencies.observe ?? observeFreshPassiveChartCommits;
    const submit = dependencies.submit ?? submitPassiveChartEvidenceObservation;
    const intervalMs = dependencies.intervalMs ?? 15_000;
    let stopped = false;
    let checking = false;
    let submitting = false;
    let observing = false;
    let stopObserving: (() => void) | null = null;
    let pendingSample: PassiveChartEvidenceSample | undefined;
    let completedTradeDate: string | null = null;
    let currentTradeDate: string | null = null;
    const lastSourceByChart = new Map<string, string>();

    const detach = () => {
        observing = false;
        stopObserving?.();
        stopObserving = null;
        pendingSample = undefined;
    };
    const drain = async () => {
        if (submitting) return;
        submitting = true;
        try {
            while (!stopped && pendingSample) {
                const { observation, geometry } = pendingSample;
                pendingSample = undefined;
                const result = await submit({
                    schemaVersion: 'candle-chart-passive-freshness-submission/1',
                    sourceUrl: window.location.href,
                    observation,
                    geometry,
                }).catch(() => undefined) as { state?: string; tradeDate?: string } | undefined;
                if (stopped) break;
                if (result?.state === 'complete') {
                    completedTradeDate = result.tradeDate ?? null;
                    detach();
                    break;
                }
            }
        } finally {
            submitting = false;
        }
    };
    const check = async () => {
        if (stopped || checking) return;
        checking = true;
        let status: IntradayMonitorStatusView | null = null;
        try { status = await readStatus(); } catch { /* Unavailable is not evidence of a running session. */ }
        finally { checking = false; }
        if (stopped) return;
        // Capacity `go` is the durable approval; the session phase is the
        // current-day running signal. The capacity field never becomes
        // `running` once Stage 160 has been approved.
        const running = status?.approval?.stage === 160 &&
            status.approval.decision === 'go' &&
            status.capacity.evaluationStageTarget === 160 &&
            status.session?.current === true &&
            status.session.phase === 'running' &&
            status.freshness?.fresh === true;
        if (status?.session?.sessionTradeDate !== currentTradeDate) {
            currentTradeDate = status?.session?.sessionTradeDate ?? null;
            lastSourceByChart.clear();
        }
        if (!running || (status?.session?.sessionTradeDate &&
            completedTradeDate === status.session.sessionTradeDate)) {
            detach();
            return;
        }
        if (stopObserving) return;
        observing = true;
        stopObserving = observe((sample) => {
            if (!observing || stopped) return;
            if (sample.geometry.canvasCount === 0 || !sample.geometry.allCanvasesVisible) return;
            const charts = sample.observation.charts.filter((chart) => {
                const sourceTime = chart.lastSourceTime;
                if (!sourceTime || !currentTradeDate ||
                    taipeiTradeDate(new Date(sourceTime)) !== currentTradeDate) return false;
                const key = `${chart.code}|${chart.timeframeMinutes}`;
                const previous = lastSourceByChart.get(key);
                if (previous && Date.parse(sourceTime) <= Date.parse(previous)) return false;
                lastSourceByChart.set(key, sourceTime);
                return true;
            });
            if (charts.length === 0) return;
            pendingSample = {
                ...sample,
                observation: { ...sample.observation, charts },
            };
            void drain();
        });
    };
    const timer = window.setInterval(() => void check(), intervalMs);
    void check();
    return () => {
        stopped = true;
        window.clearInterval(timer);
        detach();
    };
}
