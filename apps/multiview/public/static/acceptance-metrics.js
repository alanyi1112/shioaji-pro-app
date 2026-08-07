(function initAcceptanceMetrics(globalScope) {
  const VERSION = 2;
  const MAX_COUNTER = 1_000_000_000;
  const MAX_DURATION_MS = 60 * 60 * 1000;
  const COUNTERS = new Set([
    "subscribeCount",
    "unsubscribeCount",
    "requestCount",
    "realtimeRetryCount",
    "realtimeRecoveryCount",
    "indicatorFullRecomputeCount",
    "renderCount",
    "longTaskCount",
  ]);
  const GAUGES = new Set(["panelCount", "sseOpenCount", "activeDemandCount"]);
  const SAFE_REASON = /^[a-z0-9_]{1,64}$/;
  const startedAt = globalScope.performance?.now?.() || 0;
  const output = globalScope.document?.createElement?.("output");
  if (output) {
    output.id = "multiview-acceptance-metrics";
    output.hidden = true;
    output.setAttribute("aria-hidden", "true");
    output.setAttribute("data-schema-version", String(VERSION));
    globalScope.document.documentElement.appendChild(output);
  }
  const values = Object.seal({
    panelCount: 0,
    sseOpenCount: 0,
    activeDemandCount: 0,
    subscribeCount: 0,
    unsubscribeCount: 0,
    requestCount: 0,
    realtimeRetryCount: 0,
    realtimeRecoveryCount: 0,
    indicatorFullRecomputeCount: 0,
    renderCount: 0,
    longTaskCount: 0,
    reasonCode: "none",
  });

  const boundedInteger = (value) => Math.max(0, Math.min(MAX_COUNTER, Math.trunc(Number(value) || 0)));

  function refreshOutput() {
    if (output) output.textContent = JSON.stringify(snapshot());
  }

  function increment(name, amount = 1) {
    if (!COUNTERS.has(name)) throw new Error("acceptance_metric_not_allowed");
    values[name] = boundedInteger(values[name] + boundedInteger(amount));
    refreshOutput();
  }

  function setGauge(name, value) {
    if (!GAUGES.has(name)) throw new Error("acceptance_metric_not_allowed");
    values[name] = boundedInteger(value);
    refreshOutput();
  }

  function setReason(reasonCode = "none") {
    const next = String(reasonCode || "none").toLowerCase();
    values.reasonCode = SAFE_REASON.test(next) ? next : "invalid_reason_code";
    refreshOutput();
  }

  function snapshot() {
    const now = globalScope.performance?.now?.() || startedAt;
    const heap = globalScope.performance?.memory;
    return Object.freeze({
      version: VERSION,
      panelCount: values.panelCount,
      sseOpenCount: values.sseOpenCount,
      activeDemandCount: values.activeDemandCount,
      subscribeCount: values.subscribeCount,
      unsubscribeCount: values.unsubscribeCount,
      requestCount: values.requestCount,
      realtimeRetryCount: values.realtimeRetryCount,
      realtimeRecoveryCount: values.realtimeRecoveryCount,
      indicatorFullRecomputeCount: values.indicatorFullRecomputeCount,
      renderCount: values.renderCount,
      longTaskCount: values.longTaskCount,
      durationMs: Math.max(0, Math.min(MAX_DURATION_MS, Math.round(now - startedAt))),
      heapStatus: Number.isFinite(heap?.usedJSHeapSize) ? "available" : "unsupported",
      heapUsedBytes: Number.isFinite(heap?.usedJSHeapSize) ? boundedInteger(heap.usedJSHeapSize) : null,
      reasonCode: values.reasonCode,
    });
  }

  if (typeof globalScope.PerformanceObserver === "function") {
    try {
      const observer = new globalScope.PerformanceObserver((list) => {
        increment("longTaskCount", list.getEntries().length);
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      setReason("longtask_unsupported");
    }
  }

  const api = Object.freeze({ increment, setGauge, setReason, snapshot });
  Object.defineProperty(globalScope, "QuoteChartAcceptance", { value: api, enumerable: false });
  Object.defineProperty(globalScope, "__MULTIVIEW_ACCEPTANCE__", { get: snapshot, enumerable: false });
  refreshOutput();
})(globalThis);
