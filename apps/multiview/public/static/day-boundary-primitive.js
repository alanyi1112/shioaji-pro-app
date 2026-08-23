(function (global) {
  "use strict";

  const DEFAULT_COLOR = "#facc15";
  const WIDTH_CSS_PX = 1.2;
  const MINUTE_INTERVALS = new Set(["1m", "5m", "15m", "1h", "60m"]);
  const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function normalizeEpochSeconds(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object") {
      const year = Number(value.year);
      const month = Number(value.month);
      const day = Number(value.day);
      if ([year, month, day].every(Number.isFinite)) {
        return Math.floor(Date.UTC(year, month - 1, day) / 1000);
      }
    }
    return Number.NaN;
  }

  function sessionDateForTime(value) {
    const seconds = normalizeEpochSeconds(value);
    if (!Number.isFinite(seconds)) return "";
    return taipeiDateFormatter.format(new Date(seconds * 1000));
  }

  function selectDayBoundaries(candles, interval) {
    if (!MINUTE_INTERVALS.has(String(interval || "").toLowerCase())) return [];
    const rows = Array.isArray(candles) ? candles : [];
    const boundaries = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previousTime = rows[index - 1]?.time;
      const nextTime = rows[index]?.time;
      const previousDate = sessionDateForTime(previousTime);
      const nextDate = sessionDateForTime(nextTime);
      if (!previousDate || !nextDate || previousDate === nextDate) continue;
      boundaries.push({ previousTime, nextTime });
    }
    return boundaries;
  }

  class DayBoundaryRenderer {
    constructor(owner) {
      this.owner = owner;
    }

    draw(target) {
      const chart = this.owner.chart;
      if (!chart || this.owner.boundaries.length === 0) return;
      target.useBitmapCoordinateSpace((scope) => {
        const lineWidth = Math.max(1, WIDTH_CSS_PX * scope.horizontalPixelRatio);
        const context = scope.context;
        context.save();
        context.fillStyle = this.owner.color;
        for (const boundary of this.owner.boundaries) {
          const previous = chart.timeScale().timeToCoordinate(boundary.previousTime);
          const next = chart.timeScale().timeToCoordinate(boundary.nextTime);
          if (previous === null || next === null) continue;
          const mediaX = (Number(previous) + Number(next)) / 2;
          const bitmapX = mediaX * scope.horizontalPixelRatio - lineWidth / 2;
          context.fillRect(bitmapX, 0, lineWidth, scope.bitmapSize.height);
        }
        context.restore();
      });
    }
  }

  class DayBoundaryPaneView {
    constructor(owner) {
      this.paneRenderer = new DayBoundaryRenderer(owner);
    }

    zOrder() {
      return "bottom";
    }

    renderer() {
      return this.paneRenderer;
    }
  }

  class DayBoundaryPrimitive {
    constructor() {
      this.chart = null;
      this.boundaries = [];
      this.color = DEFAULT_COLOR;
      this.requestUpdate = null;
      this.view = new DayBoundaryPaneView(this);
    }

    attached(param) {
      this.chart = param.chart;
      this.requestUpdate = param.requestUpdate;
    }

    detached() {
      this.chart = null;
      this.requestUpdate = null;
    }

    paneViews() {
      return [this.view];
    }

    setData(boundaries, color = DEFAULT_COLOR) {
      this.boundaries = Array.isArray(boundaries) ? boundaries : [];
      this.color = color;
      this.requestUpdate?.();
    }
  }

  class DayBoundarySeriesManager {
    constructor(createPrimitive = () => new DayBoundaryPrimitive()) {
      this.createPrimitive = createPrimitive;
      this.primitives = new Map();
      this.boundaries = [];
      this.color = DEFAULT_COLOR;
    }

    reconcile(seriesList, boundaries = this.boundaries, color = this.color) {
      const liveSeries = new Set((seriesList || []).filter(Boolean));
      for (const [series, primitive] of this.primitives) {
        if (liveSeries.has(series)) continue;
        try {
          series.detachPrimitive(primitive);
        } catch {}
        this.primitives.delete(series);
      }
      this.boundaries = Array.isArray(boundaries) ? boundaries : [];
      this.color = color;
      for (const series of liveSeries) {
        let primitive = this.primitives.get(series);
        if (!primitive) {
          primitive = this.createPrimitive();
          series.attachPrimitive(primitive);
          this.primitives.set(series, primitive);
        }
        primitive.setData(this.boundaries, this.color);
      }
    }

    update(boundaries, color = this.color) {
      this.boundaries = Array.isArray(boundaries) ? boundaries : [];
      this.color = color;
      for (const primitive of this.primitives.values()) {
        primitive.setData(this.boundaries, this.color);
      }
    }

    destroy() {
      for (const [series, primitive] of this.primitives) {
        try {
          series.detachPrimitive(primitive);
        } catch {}
      }
      this.primitives.clear();
      this.boundaries = [];
    }

    get size() {
      return this.primitives.size;
    }
  }

  global.QuoteChartDayBoundaries = Object.freeze({
    DEFAULT_COLOR,
    WIDTH_CSS_PX,
    MINUTE_INTERVALS,
    sessionDateForTime,
    selectDayBoundaries,
    DayBoundaryPrimitive,
    DayBoundarySeriesManager,
  });
})(typeof window !== "undefined" ? window : globalThis);
