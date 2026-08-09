(function initQuoteChartInteractions(global) {
  "use strict";

  const MODE_MULTI = "multi";
  const DOM_DELTA_LINE = 1;
  const DOM_DELTA_PAGE = 2;
  const DEFAULT_LINE_HEIGHT_PX = 16;
  const DEFAULT_WHEEL_INTENT_MS = 320;

  function normalizeMode(mode) {
    if (["main", "single", MODE_MULTI].includes(mode)) return mode;
    if (mode === "B") return MODE_MULTI;
    return "single";
  }

  function chartInteractionOptions(mode = "single") {
    const modeB = normalizeMode(mode) === MODE_MULTI;
    return {
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: !modeB,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    };
  }

  function normalizeWheelDelta(event) {
    const delta = Number(event?.deltaY) || 0;
    if (event?.deltaMode === DOM_DELTA_LINE) return delta * DEFAULT_LINE_HEIGHT_PX;
    if (event?.deltaMode === DOM_DELTA_PAGE) return delta * Math.max(1, Number(global.innerHeight) || 1);
    return delta;
  }

  function bindWheelRouting(surface, getMode) {
    if (!surface?.addEventListener) return () => {};
    const handleWheel = (event) => {
      if (normalizeMode(getMode?.()) !== MODE_MULTI || event.altKey || event.ctrlKey || event.metaKey) return;
      const delta = normalizeWheelDelta(event);
      if (!delta) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      global.scrollBy?.({ top: delta, left: 0, behavior: "auto" });
    };
    surface.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => surface.removeEventListener("wheel", handleWheel, { capture: true });
  }

  function bindViewportIntent(surface, options = {}) {
    if (!surface?.addEventListener) return () => {};
    const source = String(options.source || "unknown");
    const getMode = typeof options.getMode === "function" ? options.getMode : () => "single";
    const onStart = typeof options.onStart === "function" ? options.onStart : () => {};
    const onEnd = typeof options.onEnd === "function" ? options.onEnd : () => {};
    const ownerWindow = surface.ownerDocument?.defaultView || global;
    let activePointerId;

    const finishPointer = (event) => {
      if (activePointerId === undefined || (event?.pointerId !== undefined && event.pointerId !== activePointerId)) return;
      const pointerId = activePointerId;
      activePointerId = undefined;
      onEnd({ source, kind: "pointer", pointerId });
    };
    const handlePointerDown = (event) => {
      if (event?.button !== undefined && event.button !== 0) return;
      activePointerId = event?.pointerId ?? 0;
      onStart({ source, kind: "pointer", pointerId: activePointerId });
    };
    const handleWheel = (event) => {
      const mode = normalizeMode(getMode());
      if (mode === MODE_MULTI && !event?.altKey && !event?.ctrlKey && !event?.metaKey) return;
      onStart({ source, kind: "wheel" });
    };
    surface.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
    surface.addEventListener("wheel", handleWheel, { capture: true, passive: true });
    ownerWindow?.addEventListener?.("pointerup", finishPointer, true);
    ownerWindow?.addEventListener?.("pointercancel", finishPointer, true);
    ownerWindow?.addEventListener?.("blur", finishPointer);
    return () => {
      surface.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      surface.removeEventListener("wheel", handleWheel, { capture: true });
      ownerWindow?.removeEventListener?.("pointerup", finishPointer, true);
      ownerWindow?.removeEventListener?.("pointercancel", finishPointer, true);
      ownerWindow?.removeEventListener?.("blur", finishPointer);
      finishPointer();
    };
  }

  function isFiniteLogicalRange(range) {
    return Boolean(range)
      && Number.isFinite(Number(range.from))
      && Number.isFinite(Number(range.to))
      && Number(range.to) > Number(range.from);
  }

  function cloneLogicalRange(range) {
    return isFiniteLogicalRange(range)
      ? { from: Number(range.from), to: Number(range.to) }
      : null;
  }

  function createViewportCoordinator(options = {}) {
    const requestFrame = options.requestFrame || global.requestAnimationFrame || ((callback) => global.setTimeout(callback, 0));
    const cancelFrame = options.cancelFrame || global.cancelAnimationFrame || global.clearTimeout;
    const now = options.now || (() => Date.now());
    const isCurrent = options.isCurrent || (() => true);
    const onRestore = options.onRestore || (() => {});
    const wheelIntentMs = Math.max(1, Number(options.wheelIntentMs) || DEFAULT_WHEEL_INTENT_MS);
    const maxRepairs = Math.max(1, Number(options.maxRepairs) || 8);
    const generation = options.generation;
    const pointerSources = new Set();
    const wheelSources = new Map();
    let acceptedRange = null;
    let programmaticDepth = 0;
    let userInteracted = false;
    let restoreFrame = 0;
    let repairCount = 0;
    let rejectedCallbackCount = 0;
    let destroyed = false;

    function current() {
      return !destroyed && isCurrent(generation);
    }

    function sourceAuthorized(source) {
      if (pointerSources.has(source)) return true;
      const expiresAt = Number(wheelSources.get(source) || 0);
      if (expiresAt > now()) return true;
      wheelSources.delete(source);
      return false;
    }

    function scheduleRestore() {
      if (!current() || !acceptedRange || restoreFrame) return;
      restoreFrame = requestFrame(() => {
        restoreFrame = 0;
        if (!current() || !acceptedRange) return;
        onRestore(cloneLogicalRange(acceptedRange));
      });
    }

    return {
      beginGesture(source, kind = "pointer") {
        if (!current() || !source) return false;
        if (kind === "wheel") wheelSources.set(source, now() + wheelIntentMs);
        else pointerSources.add(source);
        return true;
      },
      endGesture(source, kind = "pointer") {
        if (kind === "wheel") wheelSources.delete(source);
        else pointerSources.delete(source);
      },
      runProgrammatic(callback) {
        if (!current()) return undefined;
        programmaticDepth += 1;
        try {
          return callback?.();
        } finally {
          programmaticDepth = Math.max(0, programmaticDepth - 1);
        }
      },
      commit(range, { user = false } = {}) {
        const normalized = cloneLogicalRange(range);
        if (!current() || !normalized) return false;
        acceptedRange = normalized;
        if (user) userInteracted = true;
        return true;
      },
      acceptCallback(source, range) {
        const normalized = cloneLogicalRange(range);
        if (!current() || !normalized) return false;
        if (programmaticDepth > 0 || !sourceAuthorized(source)) {
          rejectedCallbackCount += 1;
          scheduleRestore();
          return false;
        }
        acceptedRange = normalized;
        userInteracted = true;
        return true;
      },
      restore() {
        scheduleRestore();
      },
      recordRepair(range) {
        if (userInteracted || repairCount >= maxRepairs) return false;
        const committed = this.commit(range);
        if (committed) repairCount += 1;
        return committed;
      },
      acceptedRange() {
        return cloneLogicalRange(acceptedRange);
      },
      hasUserInteracted() {
        return userInteracted;
      },
      report() {
        return {
          generation,
          acceptedRange: cloneLogicalRange(acceptedRange),
          userInteracted,
          programmatic: programmaticDepth > 0,
          repairCount,
          rejectedCallbackCount,
        };
      },
      destroy() {
        destroyed = true;
        pointerSources.clear();
        wheelSources.clear();
        if (restoreFrame) cancelFrame?.(restoreFrame);
        restoreFrame = 0;
      },
    };
  }

  function measureInitialViewportInvariant(input = {}) {
    const range = cloneLogicalRange(input.range);
    const candleCount = Math.max(0, Number(input.candleCount) || 0);
    const lastIndex = candleCount - 1;
    const plotWidth = Math.max(0, Number(input.plotWidth) || 0);
    const firstCoordinate = Number(input.firstCoordinate);
    const latestCoordinate = Number(input.latestCoordinate);
    const errors = [];
    if (!range) errors.push("logical range invalid");
    if (candleCount <= 0) errors.push("candles missing");
    if (!Number.isFinite(firstCoordinate)) errors.push("first coordinate invalid");
    if (!Number.isFinite(latestCoordinate)) errors.push("latest coordinate invalid");
    const overlap = range && candleCount > 0
      ? Math.max(0, Math.min(range.to, lastIndex) - Math.max(range.from, 0))
      : 0;
    const dataSpan = Math.max(1, lastIndex);
    const coverageRatio = overlap / dataSpan;
    if (range && candleCount > 0 && overlap <= 0) errors.push("viewport does not overlap candles");
    if (!input.userInteracted) {
      if (coverageRatio < 0.9) errors.push("canonical candle coverage too small");
      if (range && range.from < -4) errors.push("left blank range too large");
      if (range && range.to > lastIndex + 4) errors.push("right blank range too large");
      if (plotWidth > 0 && firstCoordinate < -Math.max(12, plotWidth * 0.05)) errors.push("first candle outside initial plot");
      if (plotWidth > 0 && latestCoordinate < plotWidth * 0.5) errors.push("latest candle too far left");
      if (input.rightGapPass === false) errors.push("right gap invalid");
    }
    return {
      pass: errors.length === 0,
      errors,
      coverageRatio,
      overlap,
      userInteracted: Boolean(input.userInteracted),
    };
  }

  global.QuoteChartInteractions = {
    chartInteractionOptions,
    normalizeMode,
    normalizeWheelDelta,
    bindWheelRouting,
    bindViewportIntent,
    createViewportCoordinator,
    measureInitialViewportInvariant,
  };
})(window);
