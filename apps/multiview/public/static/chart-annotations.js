(function initChartAnnotations(global) {
  "use strict";

  const STORAGE_PREFIX = "quoteChart.annotations.v1";
  const RETRACEMENT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const EXTENSION_LEVELS = [0.618, 0.786, 1, 1.272, 1.414, 1.618, 2];

  function finitePoint(point) {
    return point && Number.isFinite(Number(point.time)) && Number.isFinite(Number(point.price));
  }

  function normalizedPoint(point) {
    return { time: Number(point.time), price: Number(point.price) };
  }

  function percentageText(level) {
    const value = level * 100;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
  }

  function ratioText(level) {
    const value = Number(level);
    if (!Number.isFinite(value)) return "";
    return String(Number(value.toFixed(3)));
  }

  function fibonacciLevels(kind, anchors) {
    if (!Array.isArray(anchors) || (kind === "retracement" && anchors.length !== 2) || (kind === "extension" && anchors.length !== 3)) return [];
    const [a, b, c] = anchors;
    if (![a, b, c].filter(Boolean).every(finitePoint)) return [];
    const levels = kind === "retracement" ? RETRACEMENT_LEVELS : EXTENSION_LEVELS;
    return levels.map((ratio) => ({
      ratio,
      ratioText: ratioText(ratio),
      percentage: percentageText(ratio),
      price: kind === "retracement" ? b.price - ratio * (b.price - a.price) : c.price + ratio * (b.price - a.price),
    })).filter((entry) => Number.isFinite(entry.price));
  }

  function fibonacciAnchorPriceGuide(pending) {
    if (pending?.type !== "fibonacci" || !finitePoint(pending.preview)) return null;
    const anchorIndex = Array.isArray(pending.anchors) ? pending.anchors.length : 0;
    const anchorLabel = ["A", "B", "C"][anchorIndex];
    if (!anchorLabel) return null;
    return { anchorLabel, point: normalizedPoint(pending.preview) };
  }

  function resolveFibonacciAnchorPoint(pending, rawPoint, candle, freePrice = false) {
    if (pending?.type !== "fibonacci" || !finitePoint(rawPoint)) return null;
    const anchorIndex = Array.isArray(pending.anchors) ? pending.anchors.length : 0;
    if (anchorIndex < 0 || anchorIndex > 2) return null;
    const candleTime = Number(candle?.time);
    const hasCandle = Number.isFinite(candleTime);
    const time = hasCandle ? candleTime : Number(rawPoint.time);
    if (freePrice) return { time, price: Number(rawPoint.price) };
    if (anchorIndex === 0 || anchorIndex === 1) {
      const price = Number(anchorIndex === 0 ? candle?.low : candle?.high);
      return hasCandle && Number.isFinite(price) ? { time, price } : null;
    }
    const low = Number(candle?.low);
    return hasCandle && Number.isFinite(low)
      ? { time, price: low }
      : normalizedPoint(rawPoint);
  }

  function priceRange(start, end) {
    if (!finitePoint(start) || !finitePoint(end) || Number(start.price) === 0) return null;
    const difference = Number(end.price) - Number(start.price);
    return { difference, percent: (difference / Number(start.price)) * 100 };
  }

  function createController(options = {}) {
    const getIdentity = typeof options.getIdentity === "function" ? options.getIdentity : () => "default";
    const storage = options.storage || global.localStorage;
    const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
    let completed = { fibonacci: [], priceRange: null };
    let pending = null;
    let nextFibonacciOrder = 1;

    function storageKey() {
      const identity = String(getIdentity() || "").trim();
      return identity ? `${STORAGE_PREFIX}.${identity}` : "";
    }

    function notify() { onChange(getState()); }

    function save() {
      const key = storageKey();
      if (!key) return;
      try { storage.setItem(key, JSON.stringify({ version: 3, completed })); } catch {}
    }

    function clearStorage() {
      const key = storageKey();
      if (!key) return;
      try { storage.removeItem(key); } catch {}
    }

    function validCompleted(value) {
      if (!value || typeof value !== "object") return { fibonacci: [], priceRange: null };
      const candidates = Array.isArray(value.fibonacci)
        ? value.fibonacci
        : value.fibonacci ? [value.fibonacci] : [];
      const uniqueFibonacci = new Map();
      candidates.forEach((fibonacci, index) => {
        if (!fibonacci || !["retracement", "extension"].includes(fibonacci.kind) || !Array.isArray(fibonacci.anchors)) return;
        const required = fibonacci.kind === "retracement" ? 2 : 3;
        if (fibonacci.anchors.length !== required || !fibonacci.anchors.every(finitePoint)) return;
        const order = Number.isFinite(Number(fibonacci.order)) && Number(fibonacci.order) > 0
          ? Number(fibonacci.order)
          : index + 1;
        const normalized = { kind: fibonacci.kind, anchors: fibonacci.anchors.map(normalizedPoint), order };
        const previous = uniqueFibonacci.get(fibonacci.kind);
        if (!previous || previous.order <= order) uniqueFibonacci.set(fibonacci.kind, normalized);
      });
      const fibonacci = [...uniqueFibonacci.values()].sort((left, right) => left.order - right.order);
      const storedPriceRange = value.priceRange || value.distance;
      return {
        fibonacci,
        priceRange: storedPriceRange && finitePoint(storedPriceRange.start) && finitePoint(storedPriceRange.end) && Number(storedPriceRange.start.price) !== 0
          ? { start: normalizedPoint(storedPriceRange.start), end: normalizedPoint(storedPriceRange.end) }
          : null,
      };
    }

    function restore() {
      pending = null;
      const key = storageKey();
      if (!key) {
        completed = { fibonacci: [], priceRange: null };
        nextFibonacciOrder = 1;
        notify();
        return completed;
      }
      try {
        const parsed = JSON.parse(storage.getItem(key) || "null");
        if (!parsed || ![1, 2, 3].includes(parsed.version)) throw new Error("invalid");
        completed = validCompleted(parsed.completed);
        nextFibonacciOrder = Math.max(0, ...completed.fibonacci.map((entry) => Number(entry.order) || 0)) + 1;
        if (parsed.version !== 3) save();
      } catch {
        completed = { fibonacci: [], priceRange: null };
        nextFibonacciOrder = 1;
        clearStorage();
      }
      notify();
      return completed;
    }

    function armFibonacci(kind) {
      if (!["retracement", "extension"].includes(kind)) return false;
      pending = { type: "fibonacci", kind, anchors: [] };
      notify();
      return true;
    }

    function armPriceRange() {
      pending = { type: "priceRange", anchors: [] };
      notify();
      return true;
    }

    function addPoint(point) {
      if (!pending || !finitePoint(point)) return { completed: false, reason: "not_armed" };
      if (pending.type === "priceRange" && pending.anchors.length === 0 && Number(point.price) === 0) {
        return { completed: false, reason: "invalid_start" };
      }
      delete pending.preview;
      pending.anchors.push(normalizedPoint(point));
      if (pending.type === "fibonacci") {
        const required = pending.kind === "retracement" ? 2 : 3;
        if (pending.anchors.length < required) {
          notify();
          return { completed: false, remaining: required - pending.anchors.length };
        }
        completed.fibonacci = [
          ...completed.fibonacci.filter((entry) => entry.kind !== pending.kind),
          { kind: pending.kind, anchors: pending.anchors.slice(0, required), order: nextFibonacciOrder },
        ].sort((left, right) => left.order - right.order);
        nextFibonacciOrder += 1;
      } else {
        if (pending.anchors.length < 2) {
          notify();
          return { completed: false, remaining: 1 };
        }
        completed.priceRange = { start: pending.anchors[0], end: pending.anchors[1] };
      }
      pending = null;
      save();
      notify();
      return { completed: true };
    }

    function previewPoint(point) {
      if (!pending) return false;
      if (!finitePoint(point)) {
        if (!pending.preview) return false;
        delete pending.preview;
        notify();
        return true;
      }
      const preview = normalizedPoint(point);
      if (pending.preview?.time === preview.time && pending.preview?.price === preview.price) return false;
      pending.preview = preview;
      notify();
      return true;
    }

    function cancel() {
      if (!pending) return false;
      pending = null;
      notify();
      return true;
    }

    function clear(kind) {
      if (kind === "fibonacci" || kind === "all") completed.fibonacci = [];
      if (kind === "priceRange" || kind === "distance" || kind === "all") completed.priceRange = null;
      pending = null;
      if (completed.fibonacci.length || completed.priceRange) save(); else clearStorage();
      notify();
    }

    function getState() {
      const fibonacci = completed.fibonacci.map((entry) => ({
        ...entry,
        anchors: entry.anchors.map((anchor) => ({ ...anchor })),
        levels: fibonacciLevels(entry.kind, entry.anchors),
      }));
      const completedPriceRange = completed.priceRange ? { ...completed.priceRange, result: priceRange(completed.priceRange.start, completed.priceRange.end) } : null;
      const required = pending?.type === "fibonacci" ? (pending.kind === "retracement" ? 2 : 3) : pending?.type === "priceRange" ? 2 : 0;
      return {
        completed: { fibonacci, priceRange: completedPriceRange },
        pending: pending
          ? {
              ...pending,
              anchors: pending.anchors.slice(),
              ...(pending.preview ? { preview: { ...pending.preview } } : {}),
              remaining: required - pending.anchors.length,
            }
          : null,
      };
    }

    return { restore, armFibonacci, armPriceRange, addPoint, previewPoint, cancel, clear, getState, hasPending: () => Boolean(pending) };
  }

  global.QuoteChartAnnotations = {
    createController,
    fibonacciAnchorPriceGuide,
    fibonacciLevels,
    resolveFibonacciAnchorPoint,
    ratioText,
    priceRange,
    RETRACEMENT_LEVELS,
    EXTENSION_LEVELS,
  };
})(window);
