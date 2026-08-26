var globalThis;
(globalThis ||= {}).QuoteDailyMinuteDrilldownContract = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/daily-minute-drilldown-contract.ts
  var daily_minute_drilldown_contract_exports = {};
  __export(daily_minute_drilldown_contract_exports, {
    DAILY_GESTURE_WINDOW_MS: () => DAILY_GESTURE_WINDOW_MS,
    DAILY_MINUTE_MAX_CANDLES: () => DAILY_MINUTE_MAX_CANDLES,
    DAILY_MINUTE_REQUEST_REVISION: () => DAILY_MINUTE_REQUEST_REVISION,
    DAILY_MINUTE_RESPONSE_REVISION: () => DAILY_MINUTE_RESPONSE_REVISION,
    DailyCandleGestureArbiter: () => DailyCandleGestureArbiter,
    TARGET_DATE_TURNOVER_SCHEMA_REVISION: () => TARGET_DATE_TURNOVER_SCHEMA_REVISION,
    TARGET_DATE_TURNOVER_SOURCE_IDENTITY: () => TARGET_DATE_TURNOVER_SOURCE_IDENTITY,
    TargetDateSingleFlight: () => TargetDateSingleFlight,
    commitTargetDateSnapshot: () => commitTargetDateSnapshot,
    createDailyCandleGestureArbiter: () => createDailyCandleGestureArbiter,
    createTargetDateRequest: () => createTargetDateRequest,
    createTargetDateSingleFlight: () => createTargetDateSingleFlight,
    isCompletedTaiwanDailyTarget: () => isCompletedTaiwanDailyTarget,
    targetDateTurnoverAvailability: () => targetDateTurnoverAvailability,
    validateTargetDateResponse: () => validateTargetDateResponse
  });
  var DAILY_MINUTE_REQUEST_REVISION = "daily-minute-target-request/2";
  var DAILY_MINUTE_RESPONSE_REVISION = "daily-minute-target-response/2";
  var TARGET_DATE_TURNOVER_SCHEMA_REVISION = "multiview-kbar-turnover/1";
  var TARGET_DATE_TURNOVER_SOURCE_IDENTITY = "local-shioaji-simulation";
  var DAILY_GESTURE_WINDOW_MS = 260;
  var DAILY_MINUTE_MAX_CANDLES = 600;
  var SUPPORTED_TARGET_DATE_SOURCES = /* @__PURE__ */ new Set([
    "local-shioaji-simulation"
  ]);
  var TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  var TAIPEI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  var TAIWAN_DAY_SESSION_CLOSE_MINUTES = 13 * 60 + 30;
  function canonicalSymbol(value) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
  }
  function validSymbol(value) {
    return /^[A-Z0-9^][A-Z0-9._^-]{0,31}$/.test(value);
  }
  function canonicalSourceIdentity(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }
  function validSourceIdentity(value) {
    return SUPPORTED_TARGET_DATE_SOURCES.has(value);
  }
  function validCalendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  function isCompletedTaiwanDailyTarget(input) {
    if (!validCalendarDate(input.targetDate)) return false;
    const nowMs = input.nowMs ?? Date.now();
    if (!Number.isFinite(nowMs)) return false;
    const now = new Date(nowMs);
    if (Number.isNaN(now.getTime())) return false;
    const parts = TAIPEI_DATE_TIME_FORMATTER.formatToParts(
      now
    ).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    const currentDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (input.targetDate < currentDate) return true;
    if (input.targetDate > currentDate) return false;
    const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    return Number.isFinite(currentMinutes) && currentMinutes >= TAIWAN_DAY_SESSION_CLOSE_MINUTES;
  }
  function createTargetDateRequest(input) {
    const symbol = canonicalSymbol(input.symbol);
    if (!validSymbol(symbol)) {
      return { status: "rejected", reason: "invalid_symbol" };
    }
    if (!validCalendarDate(input.targetDate)) {
      return { status: "rejected", reason: "invalid_target_date" };
    }
    const sourceIdentity = canonicalSourceIdentity(input.sourceIdentity);
    if (!validSourceIdentity(sourceIdentity)) {
      return { status: "rejected", reason: "invalid_source_identity" };
    }
    if (input.mode !== "simulation") {
      return { status: "rejected", reason: "simulation_required" };
    }
    if (!Number.isInteger(input.generation) || Number(input.generation) <= 0) {
      return { status: "rejected", reason: "invalid_generation" };
    }
    const generation = Number(input.generation);
    const singleFlightKey = `${sourceIdentity}|${symbol}|${input.targetDate}|1m`;
    return {
      status: "accepted",
      request: Object.freeze({
        schemaVersion: DAILY_MINUTE_REQUEST_REVISION,
        symbol,
        sourceIdentity,
        mode: "simulation",
        targetDate: input.targetDate,
        startDate: input.targetDate,
        endDate: input.targetDate,
        targetInterval: "1m",
        timeZone: "Asia/Taipei",
        generation,
        maxCandles: DAILY_MINUTE_MAX_CANDLES,
        singleFlightKey,
        requestIdentity: `${singleFlightKey}|${generation}`
      })
    };
  }
  function validTargetDateRequest(value) {
    const request = record(value);
    if (!request) return false;
    const symbol = canonicalSymbol(request.symbol);
    const sourceIdentity = canonicalSourceIdentity(request.sourceIdentity);
    if (request.schemaVersion !== DAILY_MINUTE_REQUEST_REVISION || !validSymbol(symbol) || request.symbol !== symbol || !validSourceIdentity(sourceIdentity) || request.sourceIdentity !== sourceIdentity || request.mode !== "simulation" || !validCalendarDate(request.targetDate) || request.startDate !== request.targetDate || request.endDate !== request.targetDate || request.targetInterval !== "1m" || request.timeZone !== "Asia/Taipei" || !Number.isInteger(request.generation) || Number(request.generation) <= 0 || request.maxCandles !== DAILY_MINUTE_MAX_CANDLES) {
      return false;
    }
    const key = `${sourceIdentity}|${symbol}|${request.targetDate}|1m`;
    return request.singleFlightKey === key && request.requestIdentity === `${key}|${request.generation}`;
  }
  function record(value) {
    return value && typeof value === "object" ? value : null;
  }
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function targetDateTurnoverAvailability(candles) {
    const available = candles.filter(
      (candle) => candle.turnoverTwd !== null
    ).length;
    if (available === 0) return "unavailable";
    return available === candles.length ? "available" : "partial";
  }
  function normalizeTargetDateCandle(value) {
    const candle = record(value);
    if (!candle) return "invalid_candle";
    const priceValues = [
      candle.open,
      candle.high,
      candle.low,
      candle.close
    ];
    if (!Number.isInteger(candle.time) || Number(candle.time) <= 0 || !validCalendarDate(candle.sessionDate) || priceValues.some((price) => !finite(price)) || priceValues.every((price) => price === 0) || !finite(candle.volume) || candle.volume < 0 || !Object.hasOwn(candle, "turnoverTwd") || !(candle.turnoverTwd === null || Number.isSafeInteger(candle.turnoverTwd) && Number(candle.turnoverTwd) >= 0) || candle.turnoverSchemaRevision !== TARGET_DATE_TURNOVER_SCHEMA_REVISION || candle.turnoverSourceIdentity !== TARGET_DATE_TURNOVER_SOURCE_IDENTITY || Number(candle.high) < Math.max(Number(candle.open), Number(candle.close)) || Number(candle.low) > Math.min(Number(candle.open), Number(candle.close)) || Number(candle.high) < Number(candle.low)) {
      return "invalid_candle";
    }
    const normalized = {
      time: Number(candle.time),
      sessionDate: String(candle.sessionDate),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
      turnoverTwd: candle.turnoverTwd === null ? null : Number(candle.turnoverTwd),
      turnoverSchemaRevision: TARGET_DATE_TURNOVER_SCHEMA_REVISION,
      turnoverSourceIdentity: TARGET_DATE_TURNOVER_SOURCE_IDENTITY
    };
    return Object.freeze(normalized);
  }
  function taipeiSessionDate(time) {
    const parts = TAIPEI_DATE_FORMATTER.formatToParts(
      new Date(time * 1e3)
    ).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function validateTargetDateResponse(request, currentGeneration, value) {
    if (!validTargetDateRequest(request)) {
      return { status: "rejected", reason: "schema_mismatch" };
    }
    if (request.generation !== currentGeneration) {
      return { status: "rejected", reason: "stale_generation" };
    }
    const response = record(value);
    if (!response || response.schemaVersion !== DAILY_MINUTE_RESPONSE_REVISION) {
      return { status: "rejected", reason: "schema_mismatch" };
    }
    if (response.requestIdentity !== request.singleFlightKey) {
      return {
        status: "rejected",
        reason: "response_identity_mismatch"
      };
    }
    if (canonicalSymbol(response.symbol) !== request.symbol) {
      return { status: "rejected", reason: "symbol_mismatch" };
    }
    if (canonicalSourceIdentity(response.sourceIdentity) !== request.sourceIdentity) {
      return { status: "rejected", reason: "source_identity_mismatch" };
    }
    if (response.mode !== "simulation") {
      return { status: "rejected", reason: "simulation_required" };
    }
    if (response.targetDate !== request.targetDate) {
      return { status: "rejected", reason: "target_date_mismatch" };
    }
    if (response.interval !== "1m") {
      return { status: "rejected", reason: "interval_mismatch" };
    }
    if (response.timeZone !== "Asia/Taipei") {
      return { status: "rejected", reason: "time_zone_mismatch" };
    }
    if (response.turnoverSchemaRevision !== TARGET_DATE_TURNOVER_SCHEMA_REVISION || response.turnoverSourceIdentity !== TARGET_DATE_TURNOVER_SOURCE_IDENTITY || !["available", "partial", "unavailable"].includes(
      String(response.turnoverAvailability)
    )) {
      return { status: "rejected", reason: "schema_mismatch" };
    }
    if (!Array.isArray(response.candles)) {
      return { status: "rejected", reason: "schema_mismatch" };
    }
    if (response.candles.length > request.maxCandles) {
      return { status: "rejected", reason: "response_too_large" };
    }
    if (response.candles.length === 0) {
      return { status: "rejected", reason: "empty_response" };
    }
    const candles = [];
    let previousTime = 0;
    for (const value2 of response.candles) {
      const candle = normalizeTargetDateCandle(value2);
      if (typeof candle === "string") {
        return { status: "rejected", reason: candle };
      }
      if (candle.sessionDate !== request.targetDate || taipeiSessionDate(candle.time) !== request.targetDate) {
        return { status: "rejected", reason: "mixed_session_date" };
      }
      if (candle.time <= previousTime) {
        return { status: "rejected", reason: "candle_out_of_order" };
      }
      previousTime = candle.time;
      candles.push(candle);
    }
    const turnoverAvailability = targetDateTurnoverAvailability(candles);
    if (response.turnoverAvailability !== turnoverAvailability) {
      return { status: "rejected", reason: "schema_mismatch" };
    }
    return {
      status: "accepted",
      snapshot: Object.freeze({
        schemaVersion: DAILY_MINUTE_RESPONSE_REVISION,
        requestIdentity: request.singleFlightKey,
        symbol: request.symbol,
        sourceIdentity: request.sourceIdentity,
        mode: "simulation",
        targetDate: request.targetDate,
        interval: "1m",
        timeZone: "Asia/Taipei",
        turnoverSchemaRevision: TARGET_DATE_TURNOVER_SCHEMA_REVISION,
        turnoverSourceIdentity: TARGET_DATE_TURNOVER_SOURCE_IDENTITY,
        turnoverAvailability,
        candles: Object.freeze(candles)
      })
    };
  }
  var TargetDateSingleFlight = class {
    inflight = /* @__PURE__ */ new Map();
    run(request, load) {
      const existing = this.inflight.get(request.singleFlightKey);
      if (existing) return existing;
      let promise;
      promise = Promise.resolve().then(() => load(request)).finally(() => {
        if (this.inflight.get(request.singleFlightKey) === promise) {
          this.inflight.delete(request.singleFlightKey);
        }
      });
      this.inflight.set(request.singleFlightKey, promise);
      return promise;
    }
    size() {
      return this.inflight.size;
    }
  };
  function createTargetDateSingleFlight() {
    return new TargetDateSingleFlight();
  }
  function gesturePassthroughReason(event) {
    if (event.button !== 0) return "not_left_button";
    if (event.interval !== "1d") return "not_daily";
    if (!event.validCandle || !event.candleKey) return "invalid_target";
    if (event.mode !== "observe") return "trading_mode";
    if (event.owner !== "none") return event.owner;
    if (!Number.isFinite(event.eventTime)) return "invalid_target";
    return null;
  }
  var DailyCandleGestureArbiter = class {
    constructor(callbacks, windowMs = DAILY_GESTURE_WINDOW_MS) {
      this.callbacks = callbacks;
      this.windowMs = windowMs;
    }
    callbacks;
    windowMs;
    pending = null;
    commitPendingSingle() {
      if (!this.pending) return null;
      const event = this.pending.event;
      this.pending = null;
      this.callbacks.onSingle(event);
      return { action: "single", reason: "single_timeout" };
    }
    handleClick(event) {
      const passthrough = gesturePassthroughReason(event);
      if (passthrough) {
        this.cancel();
        return { action: "passthrough", reason: passthrough };
      }
      if (this.pending && event.eventTime > this.pending.deadline) {
        this.flush(this.pending.deadline);
      }
      if (this.pending && this.pending.event.candleKey === event.candleKey && event.eventTime <= this.pending.deadline) {
        this.pending = null;
        this.callbacks.onDrilldown(event);
        return {
          action: "drilldown",
          reason: "matching_double_click"
        };
      }
      if (this.pending) this.commitPendingSingle();
      this.pending = Object.freeze({
        event: Object.freeze({ ...event }),
        deadline: event.eventTime + this.windowMs
      });
      return { action: "pending", reason: "awaiting_second_click" };
    }
    flush(now) {
      if (!this.pending || now < this.pending.deadline) return null;
      return this.commitPendingSingle();
    }
    cancel() {
      const changed = this.pending !== null;
      this.pending = null;
      return changed;
    }
    snapshot() {
      return this.pending ? Object.freeze({
        event: Object.freeze({ ...this.pending.event }),
        deadline: this.pending.deadline
      }) : null;
    }
  };
  function createDailyCandleGestureArbiter(callbacks) {
    return new DailyCandleGestureArbiter(callbacks);
  }
  function completeLayers(value) {
    const candidate = record(value);
    return candidate !== null && [
      "source",
      "readout",
      "volume",
      "indicators",
      "dayBoundaries",
      "viewport"
    ].every((key) => candidate[key] !== void 0);
  }
  function cloneAndFreeze(value) {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => cloneAndFreeze(item)));
    }
    if (value && typeof value === "object") {
      const clone = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          cloneAndFreeze(item)
        ])
      );
      return Object.freeze(clone);
    }
    return value;
  }
  function commitTargetDateSnapshot(input) {
    const { baseline, request, currentIdentity } = input;
    if (input.cancelled) {
      return {
        status: "rejected",
        reason: "request_cancelled",
        context: baseline
      };
    }
    if (canonicalSymbol(currentIdentity.symbol) !== request.symbol || canonicalSymbol(baseline.symbol) !== request.symbol || baseline.interval !== "1d" || currentIdentity.panelIdentity !== baseline.panelIdentity) {
      return {
        status: "rejected",
        reason: "context_identity_mismatch",
        context: baseline
      };
    }
    const validation = validateTargetDateResponse(
      request,
      currentIdentity.generation,
      input.response
    );
    if (validation.status === "rejected") {
      return { ...validation, context: baseline };
    }
    let layers;
    try {
      layers = input.buildLayers(
        validation.snapshot,
        cloneAndFreeze(baseline)
      );
    } catch {
      return {
        status: "rejected",
        reason: "projection_failed",
        context: baseline
      };
    }
    if (!completeLayers(layers)) {
      return {
        status: "rejected",
        reason: "projection_incomplete",
        context: baseline
      };
    }
    return {
      status: "committed",
      context: cloneAndFreeze({
        symbol: request.symbol,
        panelIdentity: baseline.panelIdentity,
        generation: request.generation,
        interval: "1m",
        candles: validation.snapshot.candles,
        source: layers.source,
        readout: layers.readout,
        volume: layers.volume,
        indicators: layers.indicators,
        dayBoundaries: layers.dayBoundaries,
        viewport: layers.viewport,
        tools: baseline.tools
      })
    };
  }
  return __toCommonJS(daily_minute_drilldown_contract_exports);
})();
