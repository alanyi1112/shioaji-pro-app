(function initQuoteChartInteractions(global) {
  "use strict";

  const MODE_MULTI = "multi";
  const DOM_DELTA_LINE = 1;
  const DOM_DELTA_PAGE = 2;
  const DEFAULT_LINE_HEIGHT_PX = 16;

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

  global.QuoteChartInteractions = {
    chartInteractionOptions,
    normalizeMode,
    normalizeWheelDelta,
    bindWheelRouting,
  };
})(window);
