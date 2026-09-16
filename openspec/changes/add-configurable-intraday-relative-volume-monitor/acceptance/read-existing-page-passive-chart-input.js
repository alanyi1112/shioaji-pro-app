(async () => {
    const selector = '[data-chart-diagnostic-schema="candle-chart-passive-freshness/1"]';
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let domReads = 0;

    const readObservation = (expected = null) => {
        domReads += 1;
        const observedAt = new Date().toISOString();
        const charts = [...document.querySelectorAll(selector)].map((node) => {
            const lastVisualCommitAt = node.dataset.chartLastVisualCommitAt ?? '';
            const lastSourceTime = node.dataset.chartLastSourceTime ?? '';
            return {
                code: node.dataset.chartCode ?? '',
                timeframeMinutes: Number(node.dataset.chartTimeframeMinutes),
                lastVisualCommitAt,
                lastSourceTime,
                freshnessMs: Date.parse(observedAt) - Date.parse(lastVisualCommitAt),
            };
        }).filter((chart) => /^[A-Z0-9.]{2,32}$/i.test(chart.code) &&
            Number.isSafeInteger(chart.timeframeMinutes) && chart.timeframeMinutes > 0 &&
            Number.isFinite(Date.parse(chart.lastVisualCommitAt)) &&
            Number.isFinite(Date.parse(chart.lastSourceTime)) && chart.freshnessMs >= 0 &&
            (!expected || (chart.code === expected.code &&
                chart.timeframeMinutes === expected.timeframeMinutes)));
        if (charts.length < 1) throw new Error('no_valid_existing_chart_diagnostic');
        return {
            schemaVersion: 'candle-chart-passive-freshness-observation/1',
            observedAt,
            charts,
            operations: {
                domReads: 1, networkRequests: 0, navigationCount: 0, reloadCount: 0,
                subscriptionMutations: 0, brokerWrites: 0, productionTransitions: 0,
                serviceLifecycleMutations: 0,
            },
        };
    };

    const firstObservation = readObservation();
    const selected = firstObservation.charts[0];
    let secondObservation = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        await wait(1_000);
        const candidate = readObservation(selected);
        const chart = candidate.charts[0];
        if (Date.parse(chart.lastVisualCommitAt) > Date.parse(selected.lastVisualCommitAt)) {
            secondObservation = candidate;
            break;
        }
    }
    if (!secondObservation) throw new Error('visual_commit_did_not_advance');

    domReads += 1;
    const chartRoots = [...document.querySelectorAll(selector)];
    const canvases = chartRoots.flatMap((root) => [...root.querySelectorAll('canvas')]);
    const rectangles = canvases.map((canvas) => canvas.getBoundingClientRect());
    const visible = rectangles.map((rectangle) => rectangle.width > 0 && rectangle.height > 0 &&
        rectangle.bottom > 0 && rectangle.right > 0 && rectangle.top < window.innerHeight &&
        rectangle.left < window.innerWidth);
    const largest = rectangles.reduce((current, rectangle) =>
        rectangle.width * rectangle.height > current.width * current.height ? rectangle : current,
    { width: 0, height: 0 });
    const observedAt = new Date().toISOString();
    const tradeDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(observedAt));
    return {
        tradeDate,
        sourceUrl: location.href,
        canonicalSymbol: selected.code,
        timeframeMinutes: selected.timeframeMinutes,
        firstObservation,
        secondObservation,
        geometry: {
            observedAt,
            chartCount: chartRoots.length,
            canvasCount: canvases.length,
            largestCanvasWidth: Math.round(largest.width),
            largestCanvasHeight: Math.round(largest.height),
            allCanvasesVisible: canvases.length > 0 && visible.every(Boolean),
        },
        operations: {
            domReads,
            networkRequests: 0,
            navigationCount: 0,
            reloadCount: 0,
            clickCount: 0,
            subscriptionMutations: 0,
            notificationDispatches: 0,
            brokerWrites: 0,
            productionTransitions: 0,
            serviceLifecycleMutations: 0,
        },
    };
})()
