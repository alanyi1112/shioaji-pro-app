(function initChartAnnotations(global) {
  "use strict";

  const STORAGE_PREFIX = "quoteChart.annotations.v1";
  const RETRACEMENT_LEVELS = [-0.62, -0.27, 0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1];
  const EXTENSION_LEVELS = [0.618, 0.705, 0.786, 1, 1.272, 1.414, 1.618, 2];
  const LEGACY_LEVEL_COLORS = ["#fb7185", "#fb923c", "#facc15", "#84cc16", "#2dd4bf", "#22d3ee", "#818cf8"];
  const ADDED_LEVEL_COLORS = new Map([[-0.62, "#a78bfa"], [-0.27, "#e879f9"], [0.705, "#f472b6"]]);
  const LEGACY_LEVELS_BY_KIND = {
    retracement: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
    extension: [0.618, 0.786, 1, 1.272, 1.414, 1.618, 2],
  };
  const productClearListeners = new Set();

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

  function fibonacciLevelKey(level) {
    const text = ratioText(level);
    return text ? text.replace("-", "negative-").replaceAll(".", "-") : "unknown";
  }

  function fibonacciLevelColor(kind, level) {
    if ((kind === "retracement" || Number(level) === 0.705) && ADDED_LEVEL_COLORS.has(Number(level))) return ADDED_LEVEL_COLORS.get(Number(level));
    const index = LEGACY_LEVELS_BY_KIND[kind]?.indexOf(Number(level)) ?? -1;
    return LEGACY_LEVEL_COLORS[index] || "#cbd5e1";
  }

  function identityParts(identity) {
    const normalized = String(identity || "").trim();
    const separator = normalized.lastIndexOf("|");
    if (separator <= 0 || separator === normalized.length - 1) return null;
    return { symbol: normalized.slice(0, separator).toUpperCase(), interval: normalized.slice(separator + 1) };
  }

  function identityFromStorageKey(key) {
    const prefix = `${STORAGE_PREFIX}.`;
    return String(key || "").startsWith(prefix) ? String(key).slice(prefix.length) : "";
  }

  function storageKeys(storage) {
    if (!storage || typeof storage.key !== "function" || !Number.isFinite(Number(storage.length))) return [];
    const keys = [];
    for (let index = 0; index < Number(storage.length); index += 1) {
      const key = storage.key(index);
      if (typeof key === "string") keys.push(key);
    }
    return keys;
  }

  function subscribeProductClear(listener) {
    if (typeof listener !== "function") return () => {};
    productClearListeners.add(listener);
    return () => { productClearListeners.delete(listener); };
  }

  function publishProductClear(symbol) {
    productClearListeners.forEach((listener) => listener(symbol));
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
      if (["retracement", "extension"].includes(kind)) {
        completed.fibonacci = completed.fibonacci.filter((entry) => entry.kind !== kind);
        if (pending?.type === "fibonacci" && pending.kind === kind) pending = null;
      }
      if (kind === "fibonacci" || kind === "all") {
        completed.fibonacci = [];
        if (pending?.type === "fibonacci") pending = null;
      }
      if (kind === "priceRange" || kind === "distance" || kind === "all") {
        completed.priceRange = null;
        if (pending?.type === "priceRange") pending = null;
      }
      if (completed.fibonacci.length || completed.priceRange) save(); else clearStorage();
      notify();
    }

    function applyProductClear(symbol) {
      const currentSymbol = identityParts(getIdentity())?.symbol;
      const targetSymbol = String(symbol || "").trim().toUpperCase();
      if (!currentSymbol || currentSymbol !== targetSymbol) return false;
      const changed = completed.fibonacci.length > 0 || pending?.type === "fibonacci";
      completed.fibonacci = [];
      if (pending?.type === "fibonacci") pending = null;
      if (changed) notify();
      return changed;
    }

    function clearAllFibonacciIntervals() {
      const currentIdentity = String(getIdentity() || "").trim();
      const symbol = identityParts(currentIdentity)?.symbol;
      if (!symbol) {
        clear("fibonacci");
        return;
      }
      const currentKey = storageKey();
      const keys = storageKeys(storage).filter((key) => identityParts(identityFromStorageKey(key))?.symbol === symbol);
      if (!keys.length && currentKey) keys.push(currentKey);
      keys.forEach((key) => {
        try {
          const parsed = JSON.parse(storage.getItem(key) || "null");
          const normalized = parsed && [1, 2, 3].includes(parsed.version)
            ? validCompleted(parsed.completed)
            : { fibonacci: [], priceRange: null };
          normalized.fibonacci = [];
          if (normalized.priceRange) storage.setItem(key, JSON.stringify({ version: 3, completed: normalized }));
          else storage.removeItem(key);
        } catch {
          try { storage.removeItem(key); } catch {}
        }
      });
      completed.fibonacci = [];
      if (pending?.type === "fibonacci") pending = null;
      notify();
      publishProductClear(symbol);
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

    return {
      restore,
      armFibonacci,
      armPriceRange,
      addPoint,
      previewPoint,
      cancel,
      clear,
      clearAllFibonacciIntervals,
      applyProductClear,
      getState,
      hasPending: () => Boolean(pending),
    };
  }

  global.QuoteChartAnnotations = {
    createController,
    fibonacciAnchorPriceGuide,
    fibonacciLevels,
    fibonacciLevelColor,
    fibonacciLevelKey,
    resolveFibonacciAnchorPoint,
    subscribeProductClear,
    ratioText,
    priceRange,
    RETRACEMENT_LEVELS,
    EXTENSION_LEVELS,
  };
})(window);
