(function initRealtimeCoordinator(globalScope) {
  const MAX_SYMBOLS = 8;
  const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
  const DEMAND_RETRY_DELAYS_MS = [1000, 5000, 15000, 30000];
  const DEGRADED_AFTER_MS = 5000;
  const STALE_AFTER_MS = 15000;

  function createRealtimeCoordinator(options = {}) {
    const WebSocketImpl = options.WebSocketImpl || globalScope.WebSocket;
    const setTimeoutImpl = options.setTimeoutImpl || globalScope.setTimeout?.bind(globalScope);
    const clearTimeoutImpl = options.clearTimeoutImpl || globalScope.clearTimeout?.bind(globalScope);
    const windowTarget = options.windowTarget || globalScope.window || globalScope;
    const documentTarget = options.documentTarget || globalScope.document;
    const isHidden = options.isHidden || (() => documentTarget?.hidden === true);
    const isOnline = options.isOnline || (() => globalScope.navigator?.onLine !== false);
    const now = options.now || (() => Date.now());
    const endpoint = options.endpoint || "/api/realtime/stream";
    const enabled = options.enabled !== false;
    const subscriptions = new Map();
    const latestBySymbol = new Map();
    let socket;
    let reconnectTimer = null;
    let stateTimer = null;
    let reconnectAttempt = 0;

    function symbols() {
      return [...new Set([...subscriptions.values()].map((item) => item.symbol))];
    }

    function socketUrl() {
      if (/^wss?:\/\//.test(endpoint)) return endpoint;
      const location = options.location || globalScope.location;
      if (!location) throw new Error("realtime_location_missing");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${location.host}${endpoint}`;
    }

    function notifyState(state, reasonCode) {
      for (const item of subscriptions.values()) {
        try { item.onState?.({ state, reasonCode }); } catch { /* isolate panels */ }
      }
    }

    function marketPhase() {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(now())).reduce((result, part) => {
        if (part.type !== "literal") result[part.type] = part.value;
        return result;
      }, {});
      if (["Sat", "Sun"].includes(parts.weekday || "")) return "closed";
      const minutes = Number(parts.hour) * 60 + Number(parts.minute);
      if (minutes >= 9 * 60 && minutes <= 13 * 60 + 30) return "open";
      if (minutes > 13 * 60 + 30 && minutes < 15 * 60) return "closing";
      return "closed";
    }

    function notifyFreshState() {
      const phase = marketPhase();
      notifyState(phase === "open" ? "live" : phase, "none");
    }

    function clearReconnect() {
      if (reconnectTimer === null) return;
      clearTimeoutImpl(reconnectTimer);
      reconnectTimer = null;
    }

    function clearStateTimer() {
      if (stateTimer === null) return;
      clearTimeoutImpl(stateTimer);
      stateTimer = null;
    }

    function closeSocket(reasonCode = "realtime_paused") {
      clearReconnect();
      clearStateTimer();
      if (socket) {
        const closing = socket;
        socket = undefined;
        try { closing.close(1000, reasonCode); } catch { /* already closed */ }
      }
    }

    function scheduleStateCheck() {
      clearStateTimer();
      if (!subscriptions.size || isHidden() || !isOnline()) return;
      stateTimer = setTimeoutImpl(() => {
        stateTimer = null;
        const latestTime = Math.max(0, ...[...latestBySymbol.values()].map((item) => Date.parse(item.sourceTime) || 0));
        const age = latestTime ? Math.max(0, now() - latestTime) : Infinity;
        const phase = marketPhase();
        if (phase !== "open") notifyState(phase, "none");
        else if (age > STALE_AFTER_MS) notifyState("fallback", "realtime_source_stale");
        else if (age > DEGRADED_AFTER_MS) notifyState("degraded", "realtime_source_delayed");
        else notifyState("live", "none");
        scheduleStateCheck();
      }, 1000);
    }

    function sendSubscription() {
      if (!socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ type: "subscribe", symbols: symbols() }));
    }

    function dispatchUpdates(updates) {
      for (const update of Array.isArray(updates) ? updates : []) {
        const symbol = String(update?.canonicalSymbol || "");
        if (!symbol) continue;
        const previous = latestBySymbol.get(symbol);
        if (previous) {
          const priorTime = Date.parse(previous.sourceTime) || 0;
          const nextTime = Date.parse(update.sourceTime) || 0;
          if (nextTime < priorTime || (nextTime === priorTime && Number(update.sequence) <= Number(previous.sequence))) continue;
        }
        latestBySymbol.set(symbol, update);
        for (const item of subscriptions.values()) {
          if (item.symbol !== symbol) continue;
          try { item.onSnapshot(update); } catch { /* isolate panels */ }
        }
      }
      notifyFreshState();
      scheduleStateCheck();
    }

    function dispatchSession(session) {
      if (!session || typeof session !== "object") return;
      for (const item of subscriptions.values()) {
        const points = session[item.symbol];
        if (!Array.isArray(points) || !points.length) continue;
        try { item.onSession?.(points); } catch { /* isolate panels */ }
      }
    }

    function scheduleReconnect() {
      if (!enabled || !subscriptions.size || isHidden() || !isOnline() || reconnectTimer !== null) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeoutImpl(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (!enabled || !WebSocketImpl || !subscriptions.size || socket || isHidden() || !isOnline()) return;
      let next;
      try {
        next = new WebSocketImpl(socketUrl());
      } catch {
        notifyState("unavailable", "realtime_connect_failed");
        scheduleReconnect();
        return;
      }
      socket = next;
      next.addEventListener("open", () => {
        if (socket !== next) return;
        reconnectAttempt = 0;
        sendSubscription();
        notifyState("degraded", "realtime_snapshot_pending");
        scheduleStateCheck();
      });
      next.addEventListener("message", (event) => {
        if (socket !== next || typeof event.data !== "string") return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "snapshot") dispatchSession(payload.session);
          if (payload.type === "snapshot" || payload.type === "market-batch-v1") dispatchUpdates(payload.updates);
          if (payload.type === "error") notifyState("degraded", String(payload.reasonCode || "realtime_stream_error"));
        } catch {
          notifyState("degraded", "realtime_stream_payload_invalid");
        }
      });
      next.addEventListener("close", () => {
        if (socket !== next) return;
        socket = undefined;
        clearStateTimer();
        notifyState("fallback", "realtime_stream_closed");
        scheduleReconnect();
      });
      next.addEventListener("error", () => {
        if (socket !== next) return;
        notifyState("degraded", "realtime_stream_error");
      });
    }

    function refreshConnection() {
      if (isHidden() || !isOnline() || !subscriptions.size) {
        closeSocket(isHidden() ? "page_hidden" : "page_offline");
        if (subscriptions.size) notifyState("fallback", isHidden() ? "page_hidden" : "page_offline");
        return;
      }
      connect();
      sendSubscription();
    }

    windowTarget?.addEventListener?.("online", refreshConnection);
    windowTarget?.addEventListener?.("offline", refreshConnection);
    documentTarget?.addEventListener?.("visibilitychange", refreshConnection);

    return {
      subscribe(id, request, onSnapshot, onState = () => {}, onSession = () => {}) {
        const key = String(id);
        const symbol = String(request?.symbol || "").trim().toUpperCase();
        const prospective = new Set(symbols());
        const previous = subscriptions.get(key);
        if (previous) prospective.delete(previous.symbol);
        prospective.add(symbol);
        if (prospective.size > MAX_SYMBOLS) throw new Error("realtime_subscription_capacity");
        const token = Symbol(key);
        subscriptions.set(key, { symbol, onSnapshot, onState, onSession, token });
        const latest = latestBySymbol.get(symbol);
        if (latest) onSnapshot(latest);
        refreshConnection();
        return () => {
          if (subscriptions.get(key)?.token !== token) return;
          subscriptions.delete(key);
          if (!subscriptions.size) closeSocket("no_subscriptions");
          else sendSubscription();
        };
      },
      connectionCount() {
        return socket ? 1 : 0;
      },
      destroy() {
        subscriptions.clear();
        closeSocket("coordinator_destroyed");
      },
    };
  }

  function createLocalShioajiCoordinator(options = {}) {
    const acceptance = globalScope.QuoteChartAcceptance;
    const fetchImpl = options.fetchImpl || globalScope.fetch?.bind(globalScope);
    const EventSourceImpl = options.EventSourceImpl || globalScope.EventSource;
    const windowTarget = options.windowTarget || globalScope.window || globalScope;
    const documentTarget = options.documentTarget || globalScope.document;
    const setTimeoutImpl = options.setTimeoutImpl || globalScope.setTimeout?.bind(globalScope);
    const clearTimeoutImpl = options.clearTimeoutImpl || globalScope.clearTimeout?.bind(globalScope);
    const setIntervalImpl = options.setIntervalImpl || globalScope.setInterval?.bind(globalScope);
    const clearIntervalImpl = options.clearIntervalImpl || globalScope.clearInterval?.bind(globalScope);
    const endpoint = options.endpoint || "/local-shioaji";
    const subscriptions = new Map();
    const contracts = new Map();
    const latest = new Map();
    const sequences = new Map();
    const activeSymbols = new Set();
    const cooldowns = new Map();
    const demandInflight = new Map();
    const demandRetryAttempts = new Map();
    const demandRetryTimers = new Map();
    let source;
    let sourceOpen = false;
    let enabled = options.enabled !== false;
    let generation = 0;
    let mode;
    let modeTimer;

    function desiredSymbols() {
      return [...new Set([...subscriptions.values()].map((item) => item.symbol))];
    }

    function updateDemandMetric() {
      acceptance?.setGauge("activeDemandCount", desiredSymbols().length);
    }

    function notifyState(symbol, state, reasonCode) {
      for (const item of subscriptions.values()) {
        if (item.symbol !== symbol) continue;
        try { item.onState?.({ state, reasonCode }); } catch { /* isolate panels */ }
      }
    }

    function dispatchSession(symbol, points) {
      if (!Array.isArray(points) || !points.length) return;
      for (const item of subscriptions.values()) {
        if (item.symbol !== symbol) continue;
        try { item.onSession?.(points); } catch { /* isolate panels */ }
      }
    }

    function dispatch(snapshot) {
      const prior = latest.get(snapshot.canonicalSymbol);
      if (prior) {
        const priorTime = Date.parse(prior.sourceTime) || 0;
        const nextTime = Date.parse(snapshot.sourceTime) || 0;
        if (nextTime < priorTime || (nextTime === priorTime && Number(snapshot.sequence) <= Number(prior.sequence))) return;
      }
      latest.set(snapshot.canonicalSymbol, snapshot);
      for (const item of subscriptions.values()) {
        if (item.symbol !== snapshot.canonicalSymbol) continue;
        try { item.onSnapshot(snapshot); } catch { /* isolate panels */ }
      }
      notifyState(snapshot.canonicalSymbol, "live", "none");
    }

    function normalizeDateTime(date, time) {
      const rawDate = String(date || "").trim();
      const normalizedDate = /^\d{8}$/.test(rawDate)
        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
        : rawDate;
      const rawTime = String(time || "").trim();
      const milliseconds = rawTime.replace(/(\.\d{3})\d+$/, "$1");
      const value = rawTime ? `${normalizedDate}T${milliseconds}+08:00` : String(date || "").replace(" ", "T");
      const candidate = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+08:00`;
      const timestamp = Date.parse(candidate);
      return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
    }

    function sessionDate(sourceTime) {
      if (!sourceTime) return "";
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date(sourceTime)).reduce((result, part) => {
        if (part.type !== "literal") result[part.type] = part.value;
        return result;
      }, {});
      return `${parts.year}-${parts.month}-${parts.day}`;
    }

    function numeric(value) {
      const result = Number(value);
      return Number.isFinite(result) ? result : NaN;
    }

    function nextSequence(symbol) {
      const next = Number(sequences.get(symbol) || 0) + 1;
      sequences.set(symbol, next);
      return next;
    }

    function validOhlc(open, high, low, close) {
      return [open, high, low, close].every(Number.isFinite) && low <= open && open <= high && low <= close && close <= high;
    }

    function snapshotFromRest(symbol, contract, row) {
      const sourceTime = normalizeDateTime(row.datetime);
      const open = numeric(row.open); const high = numeric(row.high); const low = numeric(row.low); const close = numeric(row.close);
      const averagePrice = numeric(row.average_price);
      if (!sourceTime || !validOhlc(open, high, low, close) || !Number.isFinite(averagePrice)) return null;
      const volumeAvailable = contract.security_type !== "IND" && Number.isFinite(numeric(row.total_volume));
      return {
        canonicalSymbol: symbol,
        exchange: contract.exchange === "OTC" ? "TPEx" : "TWSE",
        securityType: contract.security_type,
        contractCode: contract.code,
        sessionDate: sessionDate(sourceTime), sourceTime, receivedTime: new Date().toISOString(),
        open, high, low, close, averagePrice,
        tickVolume: volumeAvailable ? Math.max(0, numeric(row.volume)) : 0,
        totalVolume: volumeAvailable ? Math.max(0, numeric(row.total_volume)) : 0,
        volumeAvailable,
        sequence: nextSequence(symbol), provider: "shioaji", continuity: "complete", reasonCode: "none",
      };
    }

    function sessionFromKbars(payload) {
      const datetimes = Array.isArray(payload?.datetime) ? payload.datetime : [];
      const opens = Array.isArray(payload?.Open) ? payload.Open : [];
      const highs = Array.isArray(payload?.High) ? payload.High : [];
      const lows = Array.isArray(payload?.Low) ? payload.Low : [];
      const closes = Array.isArray(payload?.Close) ? payload.Close : [];
      const volumes = Array.isArray(payload?.Volume) ? payload.Volume : [];
      if (![opens, highs, lows, closes, volumes].every((values) => values.length === datetimes.length)) return [];
      let totalVolume = 0;
      let weightedAmount = 0;
      return datetimes.flatMap((datetime, index) => {
        const sourceTimeIso = normalizeDateTime(datetime);
        const sourceTime = Date.parse(sourceTimeIso);
        const open = numeric(opens[index]); const high = numeric(highs[index]); const low = numeric(lows[index]); const close = numeric(closes[index]);
        const volume = Math.max(0, numeric(volumes[index]));
        if (!Number.isFinite(sourceTime) || !validOhlc(open, high, low, close) || !Number.isFinite(volume)) return [];
        totalVolume += volume;
        weightedAmount += close * volume;
        return [{
          time: Math.floor(sourceTime / 1000), sourceTime,
          open, high, low, close,
          averagePrice: totalVolume > 0 ? weightedAmount / totalVolume : close,
          volume, totalVolume, continuity: "complete",
        }];
      }).slice(-128);
    }

    function rawField(row, name) {
      const pascal = name.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
      return row?.[name] ?? row?.[pascal];
    }

    function snapshotFromEvent(eventName, row) {
      const code = String(rawField(row, "code") || "").toUpperCase();
      const entry = [...contracts.entries()].find(([, contract]) => contract.code === code || contract.target_code === code);
      if (!entry) return null;
      const [symbol, contract] = entry;
      const previous = latest.get(symbol);
      const sourceTime = normalizeDateTime(rawField(row, "date"), rawField(row, "time"));
      const open = numeric(rawField(row, "open")); const high = numeric(rawField(row, "high")); const low = numeric(rawField(row, "low")); const close = numeric(rawField(row, "close"));
      if (!sourceTime || !validOhlc(open, high, low, close)) return null;
      const indexEvent = eventName === "quote_idx" || contract.security_type === "IND";
      const averageCandidate = numeric(rawField(row, "avg_price") ?? rawField(row, "average_price"));
      const averagePrice = Number.isFinite(averageCandidate) ? averageCandidate : close;
      const volumeAvailable = !indexEvent && Number.isFinite(numeric(rawField(row, "total_volume")));
      return {
        canonicalSymbol: symbol,
        exchange: contract.exchange === "OTC" ? "TPEx" : "TWSE",
        securityType: contract.security_type,
        contractCode: contract.code,
        sessionDate: sessionDate(sourceTime), sourceTime, receivedTime: new Date().toISOString(),
        open, high, low, close, averagePrice,
        tickVolume: volumeAvailable ? Math.max(0, numeric(rawField(row, "volume"))) : 0,
        totalVolume: volumeAvailable ? Math.max(Number(previous?.totalVolume || 0), numeric(rawField(row, "total_volume"))) : 0,
        volumeAvailable,
        sequence: nextSequence(symbol), provider: "shioaji", continuity: previous ? previous.continuity : "partial", reasonCode: previous ? "none" : "snapshot_pending",
      };
    }

    async function api(path, init = {}) {
      acceptance?.increment("requestCount");
      const response = await fetchImpl(`${endpoint}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.reasonCode || `http_${response.status}`));
      return payload;
    }

    async function resolveContract(symbol) {
      if (contracts.has(symbol)) return contracts.get(symbol);
      let contract;
      if (symbol === "^TWII") {
        contract = await api("/api/v1/data/contracts/IX0001/info?security_type=IND&region=TW");
      } else {
        const match = symbol.match(/^(\d{4,6}[A-Z]?)\.(TW|TWO)$/);
        if (!match) throw new Error("unsupported_canonical_symbol");
        contract = await api(`/api/v1/data/contracts/${encodeURIComponent(match[1])}?region=TW`);
      }
      if (!contract || !["STK", "IND", "WRT"].includes(contract.security_type) || !["TSE", "OTC", "OES"].includes(contract.exchange)) throw new Error("unsupported_contract");
      const normalized = { security_type: contract.security_type, region: "TW", exchange: contract.exchange, code: String(contract.code), target_code: contract.target_code || null };
      contracts.set(symbol, normalized);
      return normalized;
    }

    async function subscribeUpstream(symbol, currentGeneration) {
      const contract = await resolveContract(symbol);
      if (!enabled || currentGeneration !== generation || !desiredSymbols().includes(symbol)) return false;
      const quote_type = contract.security_type === "IND" ? "Quote" : "Tick";
      await api("/api/v1/stream/subscribe", { method: "POST", body: JSON.stringify({ ...contract, quote_type, intraday_odd: false }) });
      if (!enabled || currentGeneration !== generation || !desiredSymbols().includes(symbol)) return false;
      acceptance?.increment("subscribeCount");
      const rows = await api("/api/v1/data/snapshots", { method: "POST", body: JSON.stringify({ contracts: [contract] }) });
      const snapshot = Array.isArray(rows) ? snapshotFromRest(symbol, contract, rows[0] || {}) : null;
      if (!snapshot) throw new Error("shioaji_snapshot_invalid");
      if (!enabled || currentGeneration !== generation || !desiredSymbols().includes(symbol)) return false;
      const kbars = await api("/api/v1/data/kbars", {
        method: "POST",
        body: JSON.stringify({ contract, start: snapshot.sessionDate, end: snapshot.sessionDate }),
      });
      if (!enabled || currentGeneration !== generation || !desiredSymbols().includes(symbol)) return false;
      dispatch(snapshot);
      dispatchSession(symbol, sessionFromKbars(kbars));
      activeSymbols.add(symbol);
      return true;
    }

    function clearDemandRetry(symbol) {
      const timer = demandRetryTimers.get(symbol);
      if (timer) clearTimeoutImpl(timer);
      demandRetryTimers.delete(symbol);
      demandRetryAttempts.delete(symbol);
    }

    function scheduleDemandRetry(symbol) {
      if (!enabled || mode !== "simulation" || !sourceOpen || !desiredSymbols().includes(symbol) || demandRetryTimers.has(symbol)) return;
      const attempt = Number(demandRetryAttempts.get(symbol) || 0);
      const delay = DEMAND_RETRY_DELAYS_MS[Math.min(attempt, DEMAND_RETRY_DELAYS_MS.length - 1)];
      demandRetryAttempts.set(symbol, attempt + 1);
      acceptance?.increment("realtimeRetryCount");
      acceptance?.setReason("shioaji_demand_retry");
      const timer = setTimeoutImpl(() => {
        demandRetryTimers.delete(symbol);
        void reconcileSymbol(symbol);
      }, delay);
      demandRetryTimers.set(symbol, timer);
    }

    function reconcileSymbol(symbol) {
      if (!enabled || mode !== "simulation" || !sourceOpen || activeSymbols.has(symbol) || !desiredSymbols().includes(symbol) || demandRetryTimers.has(symbol)) return Promise.resolve(false);
      const existing = demandInflight.get(symbol);
      if (existing) return existing;
      const currentGeneration = generation;
      const task = subscribeUpstream(symbol, currentGeneration)
        .then((activated) => {
          if (!activated) return false;
          const recovered = Number(demandRetryAttempts.get(symbol) || 0) > 0;
          clearDemandRetry(symbol);
          if (recovered) {
            acceptance?.increment("realtimeRecoveryCount");
            acceptance?.setReason("shioaji_demand_recovered");
          }
          return true;
        })
        .catch((error) => {
          const reasonCode = String(error?.message || "").includes("SessionNotEstablished")
            ? "shioaji_business_unavailable"
            : "shioaji_subscription_failed";
          notifyState(symbol, "fallback", reasonCode);
          scheduleDemandRetry(symbol);
          return false;
        })
        .finally(() => {
          if (demandInflight.get(symbol) === task) demandInflight.delete(symbol);
          if (currentGeneration !== generation && sourceOpen && desiredSymbols().includes(symbol)) void reconcileSymbol(symbol);
        });
      demandInflight.set(symbol, task);
      return task;
    }

    function reconcileDemand() {
      for (const symbol of desiredSymbols()) {
        if (!activeSymbols.has(symbol)) void reconcileSymbol(symbol);
      }
    }

    async function unsubscribeUpstream(symbol) {
      clearDemandRetry(symbol);
      const contract = contracts.get(symbol);
      activeSymbols.delete(symbol);
      if (!contract) return;
      const quote_type = contract.security_type === "IND" ? "Quote" : "Tick";
      try {
        await api("/api/v1/stream/unsubscribe", { method: "POST", body: JSON.stringify({ ...contract, quote_type, intraday_odd: false }) });
        acceptance?.increment("unsubscribeCount");
      } catch { /* API may already be down */ }
    }

    function connectSource() {
      if (!enabled || source || !desiredSymbols().length || documentTarget?.hidden || !EventSourceImpl) return;
      source = new EventSourceImpl(`${endpoint}/api/v1/stream/data`);
      acceptance?.setGauge("sseOpenCount", 1);
      source.onopen = () => {
        sourceOpen = true;
        activeSymbols.clear();
        reconcileDemand();
      };
      for (const eventName of ["tick_stk", "quote_idx"]) {
        source.addEventListener(eventName, (event) => {
          try {
            const snapshot = snapshotFromEvent(eventName, JSON.parse(event.data));
            if (snapshot) dispatch(snapshot);
          } catch { /* reject malformed or stale event */ }
        });
      }
      source.onerror = () => {
        sourceOpen = false;
        for (const symbol of desiredSymbols()) notifyState(symbol, "fallback", "shioaji_stream_unavailable");
      };
    }

    function closeSource(reasonCode = "shioaji_paused") {
      generation += 1;
      const closing = source;
      source = undefined;
      sourceOpen = false;
      acceptance?.setGauge("sseOpenCount", 0);
      acceptance?.setReason(reasonCode);
      try { closing?.close(); } catch { /* already closed */ }
      const active = [...activeSymbols];
      activeSymbols.clear();
      for (const symbol of demandRetryTimers.keys()) clearDemandRetry(symbol);
      for (const symbol of active) void unsubscribeUpstream(symbol);
      for (const symbol of desiredSymbols()) notifyState(symbol, "fallback", reasonCode);
    }

    function refresh() {
      if (!enabled || documentTarget?.hidden || globalScope.navigator?.onLine === false) closeSource(documentTarget?.hidden ? "page_hidden" : "page_offline");
      else void checkMode();
    }

    async function checkMode() {
      if (!enabled || !desiredSymbols().length) return;
      try {
        const info = await api("/api/v1/info");
        const next = info?.simulation === true ? "simulation" : "simulation-required";
        if (next !== "simulation") {
          if (mode !== next) {
            latest.clear(); sequences.clear(); contracts.clear();
            closeSource("simulation_required");
          }
          mode = next;
          for (const symbol of desiredSymbols()) notifyState(symbol, "fallback", "simulation_required");
          return;
        }
        if (mode !== next) {
          latest.clear(); sequences.clear(); contracts.clear();
          closeSource("shioaji_mode_changed");
        }
        mode = next;
        connectSource();
        reconcileDemand();
      } catch {
        for (const symbol of desiredSymbols()) notifyState(symbol, "fallback", "shioaji_business_unavailable");
      }
    }

    windowTarget?.addEventListener?.("online", refresh);
    windowTarget?.addEventListener?.("offline", refresh);
    documentTarget?.addEventListener?.("visibilitychange", refresh);
    if (setIntervalImpl) modeTimer = setIntervalImpl(checkMode, 15_000);

    return {
      subscribe(id, request, onSnapshot, onState = () => {}, onSession = () => {}) {
        const key = String(id);
        const symbol = String(request?.symbol || "").trim().toUpperCase();
        const prospective = new Set(desiredSymbols());
        const previous = subscriptions.get(key);
        if (previous) prospective.delete(previous.symbol);
        prospective.add(symbol);
        if (prospective.size > MAX_SYMBOLS) throw new Error("realtime_subscription_capacity");
        const token = Symbol(key);
        subscriptions.set(key, { symbol, onSnapshot, onState, onSession, token });
        updateDemandMetric();
        const timer = cooldowns.get(symbol);
        if (timer) { clearTimeoutImpl(timer); cooldowns.delete(symbol); }
        const cached = latest.get(symbol);
        if (cached) onSnapshot(cached);
        void checkMode();
        return () => {
          if (subscriptions.get(key)?.token !== token) return;
          subscriptions.delete(key);
          updateDemandMetric();
          if (!subscriptions.size) {
            const timer = cooldowns.get(symbol);
            if (timer) clearTimeoutImpl(timer);
            cooldowns.delete(symbol);
            closeSource("no_subscriptions");
            return;
          }
          if (!desiredSymbols().includes(symbol)) {
            clearDemandRetry(symbol);
            const cooldown = setTimeoutImpl(() => {
              cooldowns.delete(symbol);
              if (!desiredSymbols().includes(symbol)) void unsubscribeUpstream(symbol);
            }, 750);
            cooldowns.set(symbol, cooldown);
          }
        };
      },
      setEnabled(next) {
        enabled = next !== false;
        if (!enabled) closeSource("yahoo_forced"); else refresh();
      },
      connectionCount() { return source ? 1 : 0; },
      subscriptionCount() { return activeSymbols.size; },
      destroy() {
        subscriptions.clear();
        updateDemandMetric();
        for (const timer of cooldowns.values()) clearTimeoutImpl(timer);
        cooldowns.clear();
        for (const symbol of demandRetryTimers.keys()) clearDemandRetry(symbol);
        if (modeTimer) clearIntervalImpl(modeTimer);
        closeSource("coordinator_destroyed");
      },
    };
  }

  globalScope.QuoteChartRealtime = { createRealtimeCoordinator, createLocalShioajiCoordinator };
})(globalThis);
