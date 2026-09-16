export const PASSIVE_CHART_FRESHNESS_SCHEMA = 'candle-chart-passive-freshness-observation/1';
export const PASSIVE_CHART_MAX_FRESHNESS_MS = 10_000;
export const PASSIVE_CHART_FALLBACK_POLL_MS = 5_000;

export type PassiveChartFreshnessObservation = Readonly<{
    schemaVersion: typeof PASSIVE_CHART_FRESHNESS_SCHEMA;
    observedAt: string;
    charts: ReadonlyArray<Readonly<{
        code: string;
        timeframeMinutes: number;
        lastVisualCommitAt: string;
        lastSourceTime: string | null;
        freshnessMs: number;
    }>>;
    operations: Readonly<{
        domReads: 1;
        networkRequests: 0;
        navigationCount: 0;
        reloadCount: 0;
        subscriptionMutations: 0;
        brokerWrites: 0;
        productionTransitions: 0;
        serviceLifecycleMutations: 0;
    }>;
}>;

export type PassiveChartGeometry = Readonly<{
    observedAt: string;
    chartCount: number;
    canvasCount: number;
    largestCanvasWidth: number;
    largestCanvasHeight: number;
    allCanvasesVisible: boolean;
}>;

export type PassiveChartEvidenceSample = Readonly<{
    observation: PassiveChartFreshnessObservation;
    geometry: PassiveChartGeometry;
}>;

export function readPassiveChartFreshness(
    root: ParentNode = document,
    nowEpochMs = Date.now(),
): PassiveChartFreshnessObservation {
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        throw new TypeError('passive chart observation time is invalid');
    }
    const charts: Array<PassiveChartFreshnessObservation['charts'][number]> = [];
    for (const node of root.querySelectorAll<HTMLElement>(
        '[data-chart-diagnostic-schema="candle-chart-passive-freshness/1"]',
    )) {
        const code = node.dataset.chartCode ?? '';
        const timeframeMinutes = Number(node.dataset.chartTimeframeMinutes);
        const lastVisualCommitAt = node.dataset.chartLastVisualCommitAt ?? '';
        const lastSourceTime = node.dataset.chartLastSourceTime ?? null;
        const commitEpochMs = Date.parse(lastVisualCommitAt);
        if (!/^[A-Z0-9.]{2,32}$/i.test(code) || !Number.isSafeInteger(timeframeMinutes) ||
            timeframeMinutes < 1 || !Number.isFinite(commitEpochMs) || commitEpochMs > nowEpochMs) continue;
        charts.push({
            code,
            timeframeMinutes,
            lastVisualCommitAt,
            lastSourceTime: lastSourceTime && Number.isFinite(Date.parse(lastSourceTime)) ? lastSourceTime : null,
            freshnessMs: nowEpochMs - commitEpochMs,
        });
    }
    return Object.freeze({
        schemaVersion: PASSIVE_CHART_FRESHNESS_SCHEMA,
        observedAt: new Date(nowEpochMs).toISOString(),
        charts: Object.freeze(charts.map((chart) => Object.freeze(chart))),
        operations: Object.freeze({
            domReads: 1 as const,
            networkRequests: 0 as const,
            navigationCount: 0 as const,
            reloadCount: 0 as const,
            subscriptionMutations: 0 as const,
            brokerWrites: 0 as const,
            productionTransitions: 0 as const,
            serviceLifecycleMutations: 0 as const,
        }),
    });
}

export function readPassiveChartGeometry(
    root: ParentNode = document,
    nowEpochMs = Date.now(),
): PassiveChartGeometry {
    const chartNodes = [...root.querySelectorAll<HTMLElement>(
        '[data-chart-diagnostic-schema="candle-chart-passive-freshness/1"]',
    )];
    const canvases = chartNodes.flatMap((node) => [...node.querySelectorAll<HTMLCanvasElement>('canvas')]);
    const rectangles = canvases.map((canvas) => canvas.getBoundingClientRect());
    return Object.freeze({
        observedAt: new Date(nowEpochMs).toISOString(),
        chartCount: chartNodes.length,
        canvasCount: canvases.length,
        largestCanvasWidth: Math.round(Math.max(0, ...rectangles.map((rect) => rect.width))),
        largestCanvasHeight: Math.round(Math.max(0, ...rectangles.map((rect) => rect.height))),
        allCanvasesVisible: canvases.length > 0 && rectangles.every((rect) =>
            rect.width >= 1 && rect.height >= 1 && rect.bottom > 0 && rect.right > 0 &&
            rect.top < window.innerHeight && rect.left < window.innerWidth),
    });
}

/**
 * Observe real chart commits without touching navigation, subscriptions, or the
 * chart itself. MutationObserver is the primary path; the short timer only
 * covers browser implementations that coalesce or miss an attribute mutation.
 */
export function observeFreshPassiveChartCommits(
    onSample: (sample: PassiveChartEvidenceSample) => void,
    options: Readonly<{
        root?: ParentNode;
        now?: () => number;
        maximumFreshnessMs?: number;
        fallbackPollMs?: number;
    }> = {},
): () => void {
    const root = options.root ?? document;
    const now = options.now ?? Date.now;
    const maximumFreshnessMs = options.maximumFreshnessMs ?? PASSIVE_CHART_MAX_FRESHNESS_MS;
    const fallbackPollMs = options.fallbackPollMs ?? PASSIVE_CHART_FALLBACK_POLL_MS;
    if (!Number.isSafeInteger(maximumFreshnessMs) || maximumFreshnessMs < 0 ||
        !Number.isSafeInteger(fallbackPollMs) || fallbackPollMs < 1) {
        throw new TypeError('passive chart observer timing is invalid');
    }
    let stopped = false;
    let lastSignature = '';
    const sample = () => {
        if (stopped) return;
        const nowEpochMs = now();
        const raw = readPassiveChartFreshness(root, nowEpochMs);
        const charts = raw.charts.filter((chart) => chart.freshnessMs <= maximumFreshnessMs);
        if (charts.length === 0) return;
        const signature = charts.map((chart) =>
            `${chart.code}|${chart.timeframeMinutes}|${chart.lastVisualCommitAt}`).join('\n');
        if (signature === lastSignature) return;
        lastSignature = signature;
        const observation = Object.freeze({ ...raw, charts: Object.freeze(charts) });
        onSample(Object.freeze({
            observation,
            geometry: readPassiveChartGeometry(root, nowEpochMs),
        }));
    };
    const observer = new MutationObserver((records) => {
        if (records.some((record) => record.attributeName === 'data-chart-last-visual-commit-at' ||
            record.attributeName === 'data-chart-last-source-time')) sample();
    });
    observer.observe(root, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-chart-last-visual-commit-at', 'data-chart-last-source-time'],
    });
    sample();
    const timer = window.setInterval(sample, fallbackPollMs);
    return () => {
        stopped = true;
        observer.disconnect();
        window.clearInterval(timer);
    };
}
