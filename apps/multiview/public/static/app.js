const CHART_COUNTS = [1, 2, 3, 4, 6, 8];
const {
  formatTechnicalAdaptiveAxis,
  formatTechnicalOscillatorAxis,
} = window.QuoteChartAxisFormatting;
const GRID_CLASSES = {
  1: "grid-1",
  2: "grid-2",
  3: "grid-3",
  4: "grid-4",
  6: "grid-6",
  8: "grid-8",
};
const DEFAULT_MARKET_TAB = "台股";
const ACTIVE_MARKET_TAB_KEY = "activeMarketTab";
const ACTIVE_MARKET_TAB_ID_KEY = "activeMarketTabId";
const DEFAULT_INTERVAL = "1d";
const SOURCE_MODE_KEY = "quoteChart.taiwanSourceMode.v1";
const SOURCE_MODES = new Set(["auto", "shioaji", "yahoo"]);
const INTERVAL_LABELS = {
  intraday: "分時",
  "1m": "1分",
  "3m": "3分",
  "5m": "5分",
  "15m": "15分",
  "30m": "30分",
  "1h": "1小時",
  "4h": "4小時",
  "1d": "日",
  "1wk": "週",
  "1mo": "月",
};
const MAIN_INDICATOR_DEFAULTS = ["ma", "bollinger", "volume"];
const SUB_INDICATOR_DEFAULTS = ["kd", "atr"];
const INDICATOR_SETTINGS_STORAGE_KEY = "quoteChart.indicatorParameters.v1";
const DEFAULT_INDICATOR_PARAMETERS = Object.freeze({
  rsi: Object.freeze({ shortPeriod: 5, longPeriod: 10 }),
  kd: Object.freeze({ period: 9, rsvWeight: 3, kWeight: 3 }),
  macd: Object.freeze({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }),
  atr: Object.freeze({ period: 14 }),
});
const COMPACT_SUBCHART_MODE_KEY = "compactSubchartMode";
const CHART_PRESENTATION_MODE_KEY = "quoteChart.chartPresentationMode.v1";
const CHART_PRESENTATION_MODES = Object.freeze({
  main: "main",
  single: "single",
  multi: "multi",
});
const MAIN_READOUT_MODE_KEY = "mainReadoutMode";
const MAIN_READOUT_MODES = {
  fixed: "fixed",
  floating: "floating",
};
const BOLLINGER_EDGE_COLOR = "#38bdf8";
const ATR_PRICE_SCALE_ID = "atr";
const INDICATOR_TIME_ANCHOR_PRICE_SCALE_ID = "indicator-time-anchor";
const SHARED_PRICE_SCALE_MIN_WIDTH = 52;
const WIDE_PRICE_SCALE_MIN_WIDTH = 72;
const RIGHT_OFFSET_BARS = 2;
const MIN_RIGHT_GAP_BARS = 2;
const MAX_RIGHT_GAP_BARS = 3.75;
const RIGHT_GAP_MEASUREMENT_BAR_WIDTH = 4;
const MIN_RIGHT_GAP_PX = 4;
const MAX_RIGHT_GAP_PX = 72;
const ALIGNMENT_DELTA_LIMIT_PX = 1;
const CROSSHAIR_MARKER_RADIUS = 2;
const CROSSHAIR_MARKER_BORDER_WIDTH = 1;
const SHARED_CROSSHAIR_OPTIONS = {
  vertLine: { visible: false, labelVisible: false },
  horzLine: { visible: true, labelVisible: true },
};
const HISTORY_PREFETCH_THRESHOLD_BARS = 8;
const HISTORY_LOAD_BATCH_BARS = 160;
const MAX_HISTORY_DISPLAY_CANDLES = 1600;
const HISTORY_LOAD_DEBOUNCE_MS = 180;
const PANEL_PAYLOAD_CACHE_LIMIT = 80;
const PREFETCH_ADJACENT_PAGE_DELAY_MS = 1200;
const PREFETCH_NEIGHBOR_TAB_FIRST_PAGE_DELAY_MS = 4500;
const MAX_PANEL_PREFETCH_CONCURRENCY = 2;
const MAX_LOW_PRIORITY_PANEL_PREFETCH_CONCURRENCY = 1;
const SINGLE_CHART_OPEN_STREAM_RESUME_DELAY_MS = 3000;
const PANEL_CANDLE_LOAD_TIMEOUT_MS = 30000;
const PANEL_PREFETCH_TIMEOUT_MS = 18000;
const PANEL_HISTORY_LOAD_TIMEOUT_MS = 30000;
const PANEL_LOAD_RETRY_DELAYS_MS = [5000, 20000];
const FIXED_PROFILE_STATES = {
  idle: "idle",
  armed: "armed",
  firstPointSelected: "first-point-selected",
  completed: "completed",
};
const FIXED_PROFILE_STORAGE_VERSION = 1;
const FIXED_PROFILE_STORAGE_PREFIX = "quoteChart.frvp.v1";
const FIXED_PROFILE_NAME_MAX_LENGTH = 18;
const FIXED_PROFILE_RANGE_COLORS = [
  "#facc15",
  "#22c55e",
  "#38bdf8",
  "#a78bfa",
  "#fb7185",
  "#f97316",
  "#e2e8f0",
];
const PRICE_LIMIT_PERCENT_THRESHOLD = 9.9;
const AUTH_REQUIRED_MESSAGE = "請先使用 Google 登入再管理個人清單。";
const WATCHLIST_SEARCH_DEBOUNCE_MS = 320;
const WATCHLIST_MESSAGE_CLASSES = {
  loading: "watchlist-message--loading",
  success: "watchlist-message--success",
  error: "watchlist-message--error",
  info: "watchlist-message--info",
};
const LATEST_PRICE_DIRECTIONS = {
  up: "▲",
  down: "▼",
  flat: "",
};
const MOVING_AVERAGE_STYLES = {
  ma5: { color: "#f97316", title: "5MA" },
  ma10: { color: "#facc15", title: "10MA" },
  ma20: { color: BOLLINGER_EDGE_COLOR, title: "20MA" },
  ma60: { color: "#a78bfa", title: "60MA" },
  ma120: { color: "#60a5fa", title: "120MA" },
};
const PIVOT_POINT_STYLES = {
  p: { color: "#e2e8f0", title: "P", lineStyle: LightweightCharts.LineStyle.Solid },
  r1: { color: "#fca5a5", title: "R1", lineStyle: LightweightCharts.LineStyle.Solid },
  r2: { color: "#f87171", title: "R2", lineStyle: LightweightCharts.LineStyle.Dashed },
  r3: { color: "#ef4444", title: "R3", lineStyle: LightweightCharts.LineStyle.Dotted },
  s1: { color: "#86efac", title: "S1", lineStyle: LightweightCharts.LineStyle.Solid },
  s2: { color: "#4ade80", title: "S2", lineStyle: LightweightCharts.LineStyle.Dashed },
  s3: { color: "#22c55e", title: "S3", lineStyle: LightweightCharts.LineStyle.Dotted },
};
const VOLUME_AVERAGE_STYLES = {
  ma5: { color: "#fb7185", title: "量 MA5" },
  ma10: { color: "#38bdf8", title: "量 MA10" },
  ma20: { color: "#a78bfa", title: "量 MA20" },
};
const SUB_INDICATOR_STYLES = {
  rsiShort: { color: "#facc15", title: "RSI-S" },
  rsiLong: { color: "#38bdf8", title: "RSI-L" },
  kdK: { color: "#facc15", title: "KD-K" },
  kdD: { color: "#fb7185", title: "KD-D" },
  macd: { color: "#a78bfa", title: "MACD" },
  macdSignal: { color: "#f97316", title: "MACD-S" },
  macdHistogramPositive: { color: "rgba(220, 38, 38, 0.72)", title: "MACD-H+" },
  macdHistogramNegative: { color: "rgba(22, 163, 74, 0.72)", title: "MACD-H-" },
  atr: { color: "#22c55e", title: "ATR" },
};
const BOLLINGER_EDGE_LINE_STYLE = LightweightCharts.LineStyle.Dashed;
const INDICATOR_REFERENCE_LINES = {
  rsi: [70, 50, 30],
  kd: [80, 20],
  macd: [0],
};
const INDICATOR_REFERENCE_LINE_OPTIONS = {
  color: "rgba(148, 163, 184, 0.55)",
  lineWidth: 1,
  lineStyle: LightweightCharts.LineStyle.Dashed,
  axisLabelVisible: false,
};
const FIXED_PROFILE_CALCULATOR = window.QuoteChartFixedRangeVolumeProfile || {};
var computeFixedRangeVolumeProfile = FIXED_PROFILE_CALCULATOR.computeFixedRangeVolumeProfile;
const WATCHLIST_REORDER_DEBOUNCE_MS = 250;
const WATCHLIST_DRAG_EDGE_PX = 42;
const WATCHLIST_DRAG_MAX_SCROLL_PX = 12;
const WATCHLIST_TAB_REORDER_DEBOUNCE_MS = 250;
const PANEL_DRAG_MOVEMENT_THRESHOLD_PX = 6;
const PANEL_DRAG_CLICK_SUPPRESSION_MS = 500;
const PANEL_REORDER_HELPERS = window.QuoteChartPanelReordering || {};
const state = {
  instruments: [],
  marketTabs: [],
  managedTabs: [],
  personalTabs: [],
  categoryPageByTabId: {},
  activeMarketTabId: "",
  activeMarketTab: DEFAULT_MARKET_TAB,
  setupErrors: [],
  intervals: [],
  panels: [],
  panelDrag: undefined,
  panelDragSuppressUntil: 0,
  panelReorderLayoutFrame: 0,
  panelReorderMetrics: { drops: 0, cancels: 0, keyboardMoves: 0 },
  panelRenderGeneration: 0,
  panelDataRequestCount: 0,
  panelStreamSubscriptionCount: 0,
  foregroundPanelRequests: 0,
  panelPayloadCache: new Map(),
  panelPrefetchQueue: [],
  panelPrefetchQueuedKeys: new Set(),
  panelPrefetchInFlight: new Set(),
  panelPrefetchActiveCount: 0,
  panelPrefetchGeneration: 0,
  panelPrefetchTimer: 0,
  panelLowPriorityPrefetchQueue: [],
  panelLowPriorityPrefetchQueuedKeys: new Set(),
  panelLowPriorityPrefetchInFlight: new Set(),
  panelLowPriorityPrefetchActiveCount: 0,
  panelLowPriorityPrefetchTimer: 0,
  singleChartRequest: undefined,
  singleChartView: undefined,
  chartPresentationMode: CHART_PRESENTATION_MODES.single,
  mainReadoutMode: MAIN_READOUT_MODES.fixed,
  sourceMode: SOURCE_MODES.has(localStorage.getItem(SOURCE_MODE_KEY)) ? localStorage.getItem(SOURCE_MODE_KEY) : "auto",
  appConfig: {
    supabaseConfigured: false,
    supabaseUrl: "",
    supabaseAnonKey: "",
    supabaseAuthAvailable: false,
    supabaseDiagnostic: { status: "not_configured", host: "" },
    capabilities: { taiwanRealtime: false, taiwanIntradayTrend: false },
  },
  supabaseClient: undefined,
  authSession: undefined,
  personalSync: { configured: false, authenticated: false },
  accessUsers: [],
  accessAudit: [],
  selectedManagementTabId: undefined,
  selectedManagementSymbol: undefined,
  watchlistMessage: { text: "", type: "info" },
  watchlistReorderControllers: new Map(),
  watchlistDrag: undefined,
  watchlistDragFrame: 0,
  watchlistTabReorderController: undefined,
  watchlistTabDrag: undefined,
  watchlistTabDragFrame: 0,
  watchlistTabMutationPending: false,
  isCreatingManagementTab: false,
  watchlistSearchRequestId: 0,
  indicatorParameters: JSON.parse(JSON.stringify(DEFAULT_INDICATOR_PARAMETERS)),
};
let watchlistSearchTimer;

const liveBatchCoordinator = window.QuoteChartLiveBatch.createLiveBatchCoordinator();
const realtimeCoordinator = window.QuoteChartRealtime.createLocalShioajiCoordinator({ enabled: state.sourceMode !== "yahoo" });

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const countSelect = document.getElementById("chart-count");
  const chipModeSelect = document.getElementById("compact-subchart-mode");
  const sourceModeSelect = document.getElementById("source-mode");
  const saved = Number(localStorage.getItem("chartCount") || "4");
  state.singleChartRequest = parseSingleChartViewRequest(window.location.search);
  state.chartPresentationMode = readChartPresentationMode(localStorage);
  localStorage.setItem(CHART_PRESENTATION_MODE_KEY, state.chartPresentationMode);
  state.mainReadoutMode = normalizeMainReadoutMode(localStorage.getItem(MAIN_READOUT_MODE_KEY));
  state.indicatorParameters = readIndicatorParameters();
  initIndicatorSettingsDialog();
  countSelect.value = state.singleChartRequest ? "1" : CHART_COUNTS.includes(saved) ? String(saved) : "4";
  countSelect.addEventListener("change", () => {
    const nextCount = Number(countSelect.value);
    if (nextCount > 1) leaveSingleChartViewForGrid(nextCount);
    if (!state.singleChartView) localStorage.setItem("chartCount", countSelect.value);
    updateChipModeControl();
    renderCategoryPagination();
    renderPanels(nextCount);
  });
  chipModeSelect?.addEventListener("change", () => {
    const nextMode = normalizeChartPresentationMode(chipModeSelect.value);
    if (!nextMode) return;
    state.chartPresentationMode = nextMode;
    writeChartPresentationMode(localStorage, nextMode);
    updateChipModeControl();
    state.panels.forEach((panel) => panel.refreshChipMode?.());
  });
  if (sourceModeSelect) {
    sourceModeSelect.value = state.sourceMode;
    sourceModeSelect.addEventListener("change", () => {
      state.sourceMode = SOURCE_MODES.has(sourceModeSelect.value) ? sourceModeSelect.value : "auto";
      localStorage.setItem(SOURCE_MODE_KEY, state.sourceMode);
      realtimeCoordinator.setEnabled(state.sourceMode !== "yahoo");
      updateConnectionStatus();
      renderPanels(Number(countSelect.value));
    });
  }
  updateChipModeControl();
  document.getElementById("category-page-prev")?.addEventListener("click", () => setCategoryPage(-1));
  document.getElementById("category-page-next")?.addEventListener("click", () => setCategoryPage(1));
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("keydown", handleWatchlistDragKeydown);

  await initSupabaseAuth();
  initWatchlistManager();
  initAccessManager();
  const instrumentsPromise = loadInstruments();
  const appConfigPromise = loadAppConfig();
  await Promise.all([instrumentsPromise, appConfigPromise]);
  if (!state.appConfig.sourceModes?.includes(state.sourceMode)) state.sourceMode = state.appConfig.defaultSourceMode || "yahoo";
  if (sourceModeSelect) sourceModeSelect.value = state.sourceMode;
  realtimeCoordinator.setEnabled(state.sourceMode !== "yahoo" && Boolean(state.appConfig.capabilities?.taiwanRealtime));
  updateAuthControls();
  restoreActiveMarketTabPreference();
  state.singleChartView = resolveSingleChartViewRequest(state.singleChartRequest);
  applySingleChartView();
  renderMarketTabs();
  renderCategoryPagination();
  renderPanels(Number(countSelect.value));
}

function cloneIndicatorParameters(parameters = DEFAULT_INDICATOR_PARAMETERS) {
  return JSON.parse(JSON.stringify(parameters));
}

function boundedIndicatorInteger(value, minimum, maximum, fallback) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(numeric) && numeric >= minimum && numeric <= maximum ? numeric : fallback;
}

function normalizeIndicatorParameters(input = {}) {
  const shortPeriod = boundedIndicatorInteger(input.rsi?.shortPeriod, 2, 100, DEFAULT_INDICATOR_PARAMETERS.rsi.shortPeriod);
  const longPeriod = boundedIndicatorInteger(input.rsi?.longPeriod, 2, 100, DEFAULT_INDICATOR_PARAMETERS.rsi.longPeriod);
  const fastPeriod = boundedIndicatorInteger(input.macd?.fastPeriod, 2, 200, DEFAULT_INDICATOR_PARAMETERS.macd.fastPeriod);
  const slowPeriod = boundedIndicatorInteger(input.macd?.slowPeriod, 3, 200, DEFAULT_INDICATOR_PARAMETERS.macd.slowPeriod);
  return {
    rsi: shortPeriod < longPeriod ? { shortPeriod, longPeriod } : { ...DEFAULT_INDICATOR_PARAMETERS.rsi },
    kd: {
      period: boundedIndicatorInteger(input.kd?.period, 2, 100, DEFAULT_INDICATOR_PARAMETERS.kd.period),
      rsvWeight: boundedIndicatorInteger(input.kd?.rsvWeight, 1, 20, DEFAULT_INDICATOR_PARAMETERS.kd.rsvWeight),
      kWeight: boundedIndicatorInteger(input.kd?.kWeight, 1, 20, DEFAULT_INDICATOR_PARAMETERS.kd.kWeight),
    },
    macd: fastPeriod < slowPeriod
      ? {
        fastPeriod,
        slowPeriod,
        signalPeriod: boundedIndicatorInteger(input.macd?.signalPeriod, 2, 100, DEFAULT_INDICATOR_PARAMETERS.macd.signalPeriod),
      }
      : { ...DEFAULT_INDICATOR_PARAMETERS.macd },
    atr: { period: boundedIndicatorInteger(input.atr?.period, 2, 100, DEFAULT_INDICATOR_PARAMETERS.atr.period) },
  };
}

function indicatorParameterSignature(parameters = state.indicatorParameters) {
  const normalized = normalizeIndicatorParameters(parameters);
  return [
    `r${normalized.rsi.shortPeriod}.${normalized.rsi.longPeriod}`,
    `k${normalized.kd.period}.${normalized.kd.rsvWeight}.${normalized.kd.kWeight}`,
    `m${normalized.macd.fastPeriod}.${normalized.macd.slowPeriod}.${normalized.macd.signalPeriod}`,
    `a${normalized.atr.period}`,
  ].join("-");
}

function indicatorParametersQuery(parameters = state.indicatorParameters) {
  const normalized = normalizeIndicatorParameters(parameters);
  return new URLSearchParams({
    rsi_short: String(normalized.rsi.shortPeriod),
    rsi_long: String(normalized.rsi.longPeriod),
    kd_period: String(normalized.kd.period),
    kd_rsv_weight: String(normalized.kd.rsvWeight),
    kd_k_weight: String(normalized.kd.kWeight),
    macd_fast: String(normalized.macd.fastPeriod),
    macd_slow: String(normalized.macd.slowPeriod),
    macd_signal: String(normalized.macd.signalPeriod),
    atr_period: String(normalized.atr.period),
  }).toString();
}

function withIndicatorParameters(url, parameters = state.indicatorParameters) {
  return `${url}${url.includes("?") ? "&" : "?"}${indicatorParametersQuery(parameters)}`;
}

function readIndicatorParameters() {
  try {
    const stored = JSON.parse(localStorage.getItem(INDICATOR_SETTINGS_STORAGE_KEY) || "null");
    return stored?.version === 1 ? normalizeIndicatorParameters(stored.parameters) : cloneIndicatorParameters();
  } catch {
    return cloneIndicatorParameters();
  }
}

function writeIndicatorParameters(parameters) {
  localStorage.setItem(INDICATOR_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, parameters }));
}

function populateIndicatorSettingsForm(parameters = state.indicatorParameters) {
  const form = document.getElementById("indicator-settings-form");
  if (!form) return;
  const values = {
    rsiShortPeriod: parameters.rsi.shortPeriod,
    rsiLongPeriod: parameters.rsi.longPeriod,
    kdPeriod: parameters.kd.period,
    kdRsvWeight: parameters.kd.rsvWeight,
    kdKWeight: parameters.kd.kWeight,
    macdFastPeriod: parameters.macd.fastPeriod,
    macdSlowPeriod: parameters.macd.slowPeriod,
    macdSignalPeriod: parameters.macd.signalPeriod,
    atrPeriod: parameters.atr.period,
  };
  Object.entries(values).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);
    if (input) input.value = String(value);
  });
  const error = document.getElementById("indicator-settings-error");
  if (error) { error.hidden = true; error.textContent = ""; }
}

function openIndicatorSettingsDialog() {
  const dialog = document.getElementById("indicator-settings-dialog");
  if (!dialog) return;
  populateIndicatorSettingsForm();
  if (!dialog.open) dialog.showModal();
}

function indicatorParametersFromForm(form) {
  const read = (name) => Number(form.elements.namedItem(name)?.value);
  return {
    rsi: { shortPeriod: read("rsiShortPeriod"), longPeriod: read("rsiLongPeriod") },
    kd: { period: read("kdPeriod"), rsvWeight: read("kdRsvWeight"), kWeight: read("kdKWeight") },
    macd: { fastPeriod: read("macdFastPeriod"), slowPeriod: read("macdSlowPeriod"), signalPeriod: read("macdSignalPeriod") },
    atr: { period: read("atrPeriod") },
  };
}

function initIndicatorSettingsDialog() {
  const dialog = document.getElementById("indicator-settings-dialog");
  const form = document.getElementById("indicator-settings-form");
  const error = document.getElementById("indicator-settings-error");
  if (!dialog || !form) return;
  document.getElementById("indicator-settings-close")?.addEventListener("click", () => dialog.close());
  document.getElementById("indicator-settings-cancel")?.addEventListener("click", () => dialog.close());
  document.getElementById("indicator-settings-reset")?.addEventListener("click", () => populateIndicatorSettingsForm(cloneIndicatorParameters()));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const next = indicatorParametersFromForm(form);
    let message = "";
    if (next.rsi.shortPeriod >= next.rsi.longPeriod) message = "RSI 短週期必須小於長週期。";
    else if (next.macd.fastPeriod >= next.macd.slowPeriod) message = "MACD 快線週期必須小於慢線週期。";
    if (message) {
      error.textContent = message;
      error.hidden = false;
      return;
    }
    state.indicatorParameters = normalizeIndicatorParameters(next);
    writeIndicatorParameters(state.indicatorParameters);
    cancelPanelPayloadPrefetch();
    state.panelPayloadCache.clear();
    dialog.close();
    state.panels.forEach((panel) => panel.load?.());
  });
}

function normalizeMainReadoutMode(value) {
  return value === MAIN_READOUT_MODES.floating ? MAIN_READOUT_MODES.floating : MAIN_READOUT_MODES.fixed;
}

function setMainReadoutMode(value, { persist = true } = {}) {
  state.mainReadoutMode = normalizeMainReadoutMode(value);
  if (persist) localStorage.setItem(MAIN_READOUT_MODE_KEY, state.mainReadoutMode);
  state.panels.forEach((panel) => panel.refreshMainReadoutMode?.());
}

function canonicalSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

const orderBridgeContractCache = new Map();

async function resolveOrderBridgeContract(symbol) {
  const canonical = canonicalSymbol(symbol);
  if (orderBridgeContractCache.has(canonical)) return orderBridgeContractCache.get(canonical);
  const match = canonical.match(/^(\d{4,6}[A-Z]?)\.(TW|TWO)$/);
  if (!match) throw new Error("此商品不支援下單面板");
  const response = await fetch(`/local-shioaji/api/v1/data/contracts/${encodeURIComponent(match[1])}?region=TW`);
  const contract = await response.json().catch(() => null);
  if (response.status === 409 && contract?.reasonCode === "simulation_required") {
    throw new Error("MultiView 本階段只支援 simulation");
  }
  if (!response.ok || !contract || !["STK", "WRT"].includes(contract.security_type) || !["TSE", "OTC", "OES"].includes(contract.exchange)) {
    throw new Error(contract?.security_type === "IND" ? "指數商品不支援下單" : "商品契約無法解析或不支援下單");
  }
  const normalized = { code: String(contract.code).toUpperCase(), security_type: contract.security_type, exchange: contract.exchange };
  orderBridgeContractCache.set(canonical, normalized);
  return normalized;
}

function orderBridgeUrl(contract) {
  const url = new URL("/local-order-ticket", window.location.origin);
  url.searchParams.set("code", contract.code);
  url.searchParams.set("security_type", contract.security_type);
  url.searchParams.set("exchange", contract.exchange);
  return url.toString();
}

function parseSingleChartViewRequest(search = "") {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "single") return undefined;
  return {
    symbol: canonicalSymbol(params.get("symbol")),
    interval: String(params.get("interval") || "").trim(),
    tabId: String(params.get("tab") || "").trim(),
  };
}

function resolveSingleChartViewRequest(request) {
  if (!request) return undefined;
  const requestedSymbol = canonicalSymbol(request.symbol);
  const requestedTab = validMarketTab(request.tabId);
  const symbolTab = state.marketTabs.find((tab) => symbolsForTab(tab).some((item) => canonicalSymbol(item.symbol) === requestedSymbol));
  const tab = requestedTab && symbolsForTab(requestedTab).some((item) => canonicalSymbol(item.symbol) === requestedSymbol)
    ? requestedTab
    : symbolTab || requestedTab || activeMarketTab() || state.marketTabs[0];
  const instruments = symbolsForTab(tab);
  const matched = instruments.find((item) => canonicalSymbol(item.symbol) === requestedSymbol) || instruments[0];
  const fallbackInterval = state.intervals.includes(DEFAULT_INTERVAL) ? DEFAULT_INTERVAL : state.intervals[0] || DEFAULT_INTERVAL;
  return {
    symbol: canonicalSymbol(matched?.symbol || "SAMPLE"),
    interval: state.intervals.includes(request.interval) ? request.interval : fallbackInterval,
    tabId: tabIdentity(tab),
  };
}

function applySingleChartView() {
  const view = state.singleChartView;
  if (!view) return;
  const tab = validMarketTab(view.tabId);
  if (tab) setActiveMarketTabState(tab, { persist: false });
  if (view.tabId) {
    state.categoryPageByTabId[view.tabId] = categoryPageIndexForSymbol(
      symbolsForTab(tab).map((item) => item.symbol),
      view.symbol,
      currentChartCount(),
    ) ?? 0;
  }
  const countSelect = document.getElementById("chart-count");
  if (countSelect) countSelect.value = "1";
}

function leaveSingleChartViewForGrid(chartCount) {
  const view = state.singleChartView;
  if (!view || chartCount <= 1) return;
  const tab = validMarketTab(view.tabId);
  const tabId = tabIdentity(tab);
  const pageIndex = categoryPageIndexForSymbol(
    symbolsForTab(tab).map((item) => item.symbol),
    view.symbol,
    chartCount,
  );
  if (tabId && pageIndex !== undefined) state.categoryPageByTabId[tabId] = pageIndex;
  state.singleChartView = undefined;
  state.singleChartRequest = undefined;
  const url = new URL(window.location.href);
  ["view", "symbol", "interval", "tab"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function buildSingleChartUrl({ symbol, interval, tabId }, baseHref = window.location.href) {
  const url = new URL(baseHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "single");
  url.searchParams.set("symbol", canonicalSymbol(symbol));
  url.searchParams.set("interval", String(interval || DEFAULT_INTERVAL));
  url.searchParams.set("tab", String(tabId || ""));
  return url;
}

async function loadAppConfig() {
  try {
    const response = await fetch("/api/config");
    state.appConfig = await response.json();
  } catch {
    state.appConfig = {
      supabaseConfigured: false,
      supabaseUrl: "",
      supabaseAnonKey: "",
      supabaseAuthAvailable: false,
      supabaseDiagnostic: { status: "config_unavailable", host: "" },
      capabilities: { taiwanRealtime: false, taiwanIntradayTrend: false },
    };
  }
}

const ACCESS_REASON_MESSAGES = {
  invalid_email: "請輸入有效的 Google email。",
  invalid_role: "權限設定無效。",
  invalid_status: "狀態設定無效。",
  email_already_exists: "這個 email 已經在登入名單中。",
  last_owner_required: "至少必須保留一位啟用中的擁有者。",
  owner_required: "只有擁有者可以管理登入名單。",
  access_user_not_found: "找不到這筆登入帳號。",
  access_database_unavailable: "登入名單資料庫暫時無法使用。",
  access_write_failed: "登入名單暫時無法更新，請稍後重試。",
};

function setAccessMessage(text = "", type = "info") {
  const element = document.getElementById("access-message");
  if (!element) return;
  element.textContent = text;
  element.dataset.type = type;
  element.hidden = !text;
}

async function accessApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({ ok: false, reasonCode: "access_write_failed" }));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.reasonCode || "access_write_failed");
    error.reasonCode = payload.reasonCode || "access_write_failed";
    throw error;
  }
  return payload;
}

function renderAccessUsers() {
  const body = document.getElementById("access-user-list");
  if (!body) return;
  body.replaceChildren();
  for (const user of state.accessUsers) {
    const row = document.createElement("tr");
    row.dataset.accessUserId = user.id;
    const emailCell = document.createElement("td");
    const email = document.createElement("input");
    email.type = "email";
    email.value = user.email;
    email.dataset.field = "email";
    emailCell.appendChild(email);
    const roleCell = document.createElement("td");
    const role = document.createElement("select");
    role.dataset.field = "role";
    role.innerHTML = '<option value="member">一般成員</option><option value="owner">擁有者</option>';
    role.value = user.role;
    roleCell.appendChild(role);
    const statusCell = document.createElement("td");
    const status = document.createElement("select");
    status.dataset.field = "status";
    status.innerHTML = '<option value="active">啟用</option><option value="inactive">停用</option>';
    status.value = user.status;
    statusCell.appendChild(status);
    const actionsCell = document.createElement("td");
    actionsCell.className = "access-table-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.dataset.action = "save";
    save.textContent = "儲存";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.action = "delete";
    remove.textContent = "刪除";
    actionsCell.append(save, remove);
    row.append(emailCell, roleCell, statusCell, actionsCell);
    body.appendChild(row);
  }
}

function renderAccessAudit() {
  const container = document.getElementById("access-audit-list");
  if (!container) return;
  container.replaceChildren();
  for (const entry of state.accessAudit) {
    const row = document.createElement("div");
    row.className = "access-audit-entry";
    const actor = entry.actor_email || "系統";
    const target = entry.target_email || "已刪除帳號";
    row.textContent = `${entry.created_at || ""}・${actor}・${entry.action || "變更"}・${target}・${entry.result || ""}`;
    container.appendChild(row);
  }
  if (!state.accessAudit.length) container.textContent = "尚無管理紀錄";
}

async function loadAccessManager() {
  setAccessMessage("正在載入登入名單…");
  try {
    const [users, audit] = await Promise.all([
      accessApi("/api/admin/access-users"),
      accessApi("/api/admin/access-audit?limit=30"),
    ]);
    state.accessUsers = users.users || [];
    state.accessAudit = audit.entries || [];
    renderAccessUsers();
    renderAccessAudit();
    setAccessMessage("");
  } catch (error) {
    setAccessMessage(ACCESS_REASON_MESSAGES[error.reasonCode] || "登入名單載入失敗。", "error");
  }
}

function initAccessManager() {
  const dialog = document.getElementById("access-dialog");
  document.getElementById("access-close")?.addEventListener("click", () => dialog?.close());
  document.getElementById("access-manage")?.addEventListener("click", async () => {
    if (!state.appConfig.canManageAccess || !dialog) return;
    if (!dialog.open) dialog.showModal();
    await loadAccessManager();
  });
  document.getElementById("access-create-submit")?.addEventListener("click", async () => {
    const email = document.getElementById("access-create-email");
    const role = document.getElementById("access-create-role");
    if (!email?.reportValidity()) return;
    setAccessMessage("正在新增登入帳號…");
    try {
      await accessApi("/api/admin/access-users", { method: "POST", body: JSON.stringify({ email: email.value, role: role.value, status: "active" }) });
      email.value = "";
      await loadAccessManager();
      setAccessMessage("登入帳號已新增。", "success");
    } catch (error) {
      setAccessMessage(ACCESS_REASON_MESSAGES[error.reasonCode] || "新增失敗。", "error");
    }
  });
  document.getElementById("access-user-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    const row = button?.closest("tr[data-access-user-id]");
    if (!button || !row) return;
    const id = encodeURIComponent(row.dataset.accessUserId);
    const original = state.accessUsers.find((item) => item.id === row.dataset.accessUserId);
    try {
      if (button.dataset.action === "save") {
        const input = {
          email: row.querySelector('[data-field="email"]').value,
          role: row.querySelector('[data-field="role"]').value,
          status: row.querySelector('[data-field="status"]').value,
        };
        if (original && input.email.trim().toLowerCase() !== original.email && !window.confirm("修改 email 不會移轉舊帳號的個人清單。仍要繼續嗎？")) return;
        setAccessMessage("正在儲存登入帳號…");
        await accessApi(`/api/admin/access-users/${id}`, { method: "PATCH", body: JSON.stringify(input) });
        await loadAccessManager();
        setAccessMessage("登入帳號已更新。", "success");
      }
      if (button.dataset.action === "delete") {
        if (!window.confirm(`確定刪除 ${original?.email || "這個帳號"} 的登入權限？個人清單資料不會一併刪除。`)) return;
        setAccessMessage("正在刪除登入權限…");
        await accessApi(`/api/admin/access-users/${id}`, { method: "DELETE" });
        await loadAccessManager();
        setAccessMessage("登入權限已刪除。", "success");
      }
    } catch (error) {
      setAccessMessage(ACCESS_REASON_MESSAGES[error.reasonCode] || "登入名單更新失敗。", "error");
    }
  });
}

async function initSupabaseAuth() {
  state.authSession = { access_token: "sites-session", user: { email: "Codex Sites 使用者" } };
  updateAuthControls();
}

function updateAuthControls(message) {
  const status = document.getElementById("auth-status");
  const loginButton = document.getElementById("auth-login");
  const logoutButton = document.getElementById("auth-logout");
  const accessButton = document.getElementById("access-manage");
  if (!status || !loginButton || !logoutButton) return;

  status.textContent = message || state.appConfig.userEmail || state.authSession?.user?.email || "Codex Sites 使用者";
  if (accessButton) accessButton.hidden = !state.appConfig.canManageAccess;
  loginButton.hidden = true;
  logoutButton.hidden = true;
}

async function loadInstruments() {
  const response = await fetch("/api/instruments", { headers: getAuthHeaders() });
  const payload = await response.json();
  state.instruments = payload.instruments || [];
  state.marketTabs = payload.marketTabs || [];
  state.managedTabs = payload.managedTabs || payload.marketTabs || [];
  state.personalTabs = payload.personalTabs || [];
  state.setupErrors = payload.setupErrors || [];
  state.intervals = (payload.intervals || ["1d", "1wk", "1mo"]).filter((interval) => ["1d", "1wk", "1mo"].includes(interval));
  state.personalSync = payload.personalSync || { configured: false, authenticated: false };
  reconcileActiveMarketTab();
  updateConnectionStatus();
  renderCategoryPagination();
  renderWatchlistManager();
}

function getAuthHeaders() {
  return {};
}

function updateConnectionStatus() {
  const status = document.getElementById("connection-status");
  if (!status) return;
  const sourceLabel = { auto: "自動來源", shioaji: "Shioaji 即時", yahoo: "Yahoo 延遲" }[state.sourceMode] || "資料來源";
  if (state.setupErrors.length) {
    status.textContent = "設定檔有警示";
  } else if (state.personalSync.authenticated) {
    status.textContent = `${sourceLabel}・個人清單已同步`;
  } else {
    status.textContent = sourceLabel;
  }
}

function tabIdentity(tab) {
  return String(tab?.tabKey || tab?.id || tab?.label || "").trim();
}

function tabDisplayLabel(tab) {
  return String(tab?.displayLabel || tab?.label || "").trim();
}

function activeMarketTab() {
  return state.marketTabs.find((tab) => tabIdentity(tab) === state.activeMarketTabId)
    || state.marketTabs.find((candidate) => candidate.label === state.activeMarketTab)
    || state.marketTabs.find((tab) => tab.isDefault)
    || state.marketTabs[0];
}

function setActiveMarketTabState(tab, { persist = !state.singleChartRequest } = {}) {
  if (!tab) return;
  state.activeMarketTabId = tabIdentity(tab);
  state.activeMarketTab = tab.label || DEFAULT_MARKET_TAB;
  if (!persist) return;
  if (state.activeMarketTabId) localStorage.setItem(ACTIVE_MARKET_TAB_ID_KEY, state.activeMarketTabId);
  localStorage.setItem(ACTIVE_MARKET_TAB_KEY, state.activeMarketTab);
}

function reconcileActiveMarketTab() {
  const current = activeMarketTab();
  if (current) {
    setActiveMarketTabState(current);
    return;
  }
  const fallback = state.marketTabs.find((tab) => tab.label === DEFAULT_MARKET_TAB) || state.marketTabs[0];
  if (fallback) setActiveMarketTabState(fallback);
}

function restoreActiveMarketTabPreference() {
  const savedId = localStorage.getItem(ACTIVE_MARKET_TAB_ID_KEY);
  const savedLabel = localStorage.getItem(ACTIVE_MARKET_TAB_KEY);
  const tab = validMarketTab(savedId)
    || (savedLabel ? state.marketTabs.find((item) => item.label === savedLabel) : undefined)
    || state.marketTabs.find((item) => item.label === DEFAULT_MARKET_TAB)
    || state.marketTabs[0];
  setActiveMarketTabState(tab);
}

function initWatchlistManager() {
  const manageButton = document.getElementById("watchlist-manage");
  const dialog = document.getElementById("watchlist-dialog");
  const newButton = document.getElementById("watchlist-tab-new");
  const saveButton = document.getElementById("watchlist-tab-save");
  const hideButton = document.getElementById("watchlist-tab-hide");
  const resetButton = document.getElementById("watchlist-tab-reset");
  const deleteButton = document.getElementById("watchlist-tab-delete");
  const saveSymbolButton = document.getElementById("watchlist-symbol-save");
  const deleteSymbolButton = document.getElementById("watchlist-symbol-delete");
  const searchInput = document.getElementById("watchlist-symbol-search");
  manageButton?.addEventListener("click", () => openWatchlistManager(state.activeMarketTabId));
  newButton?.addEventListener("click", () => startNewPersonalTab());
  saveButton?.addEventListener("click", () => savePersonalTab());
  hideButton?.addEventListener("click", () => setPersonalTabVisibility(state.selectedManagementTabId, false));
  resetButton?.addEventListener("click", () => resetSystemTab(state.selectedManagementTabId));
  deleteButton?.addEventListener("click", () => deletePersonalTab(state.selectedManagementTabId));
  saveSymbolButton?.addEventListener("click", () => savePersonalInstrument());
  deleteSymbolButton?.addEventListener("click", () => deletePersonalInstrument(state.selectedManagementSymbol));
  searchInput?.addEventListener("input", () => scheduleInstrumentSearch(searchInput.value));
  dialog?.addEventListener("close", handleWatchlistDialogClose);
  renderWatchlistManager();
}

function openWatchlistManager(tabIdOrLabel, symbol) {
  const requested = tabIdOrLabel || state.activeMarketTabId;
  const match = state.marketTabs.find((tab) => tabIdentity(tab) === requested)
    || state.marketTabs.find((tab) => tab.label === requested)
    || state.managedTabs.find((tab) => tabIdentity(tab) === requested)
    || state.managedTabs.find((tab) => tab.label === requested)
    || state.managedTabs.find((tab) => tab.enabled !== false && tab.isDefault)
    || state.managedTabs.find((tab) => tab.enabled !== false)
    || state.marketTabs[0];
  state.selectedManagementTabId = tabIdentity(match);
  state.isCreatingManagementTab = false;
  const dialog = document.getElementById("watchlist-dialog");
  renderWatchlistManager(symbol);
  if (dialog && !dialog.open) dialog.showModal();
  resetWatchlistManagerViewport();
}

function resetWatchlistManagerViewport() {
  const shell = document.querySelector("#watchlist-dialog .watchlist-shell");
  const manager = document.querySelector("#watchlist-dialog .watchlist-tab-manager");
  const hiddenDetails = document.getElementById("watchlist-hidden-tabs");
  if (shell) shell.scrollTop = 0;
  if (manager) manager.scrollTop = 0;
  if (hiddenDetails) hiddenDetails.open = state.managedTabs.some((tab) => tab.enabled === false);
}

function startNewPersonalTab() {
  state.isCreatingManagementTab = true;
  state.selectedManagementTabId = undefined;
  state.selectedManagementSymbol = undefined;
  clearWatchlistInstrumentForm();
  clearWatchlistMessage();
  renderWatchlistManager();
}

function renderWatchlistManager(preferredSymbol) {
  const list = document.getElementById("watchlist-tab-list");
  const hiddenList = document.getElementById("watchlist-hidden-tab-list");
  const hiddenTitle = document.getElementById("watchlist-hidden-tabs-title");
  const labelInput = document.getElementById("watchlist-tab-label");
  const defaultInput = document.getElementById("watchlist-tab-default");
  const sourceNote = document.getElementById("watchlist-tab-source-note");
  const instrumentList = document.getElementById("watchlist-instrument-list");
  const symbolInput = document.getElementById("watchlist-symbol");
  const newButton = document.getElementById("watchlist-tab-new");
  const saveButton = document.getElementById("watchlist-tab-save");
  const hideButton = document.getElementById("watchlist-tab-hide");
  const resetButton = document.getElementById("watchlist-tab-reset");
  const deleteButton = document.getElementById("watchlist-tab-delete");
  if (!list || !hiddenList || !labelInput || !defaultInput || !instrumentList) return;

  const tabs = watchlistTabsForManager();
  const visibleTabs = tabs.filter((tab) => tab.enabled !== false);
  const hiddenTabs = tabs.filter((tab) => tab.enabled === false);
  const canWriteTabs = state.personalSync.configured && Boolean(state.authSession?.access_token);
  const controlsEnabled = canWriteTabs && !state.watchlistTabMutationPending;
  const selected = state.isCreatingManagementTab
    ? undefined
    : (tabs.find((tab) => tabIdentity(tab) === state.selectedManagementTabId) || visibleTabs[0] || tabs[0]);
  state.selectedManagementTabId = state.isCreatingManagementTab ? undefined : tabIdentity(selected);

  list.innerHTML = "";
  visibleTabs.forEach((tab, index) => list.appendChild(renderVisibleManagedTabRow(tab, index, visibleTabs, controlsEnabled)));
  hiddenList.innerHTML = "";
  hiddenTabs.forEach((tab) => hiddenList.appendChild(renderHiddenManagedTabRow(tab, controlsEnabled)));
  if (!hiddenTabs.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-hidden-empty";
    empty.textContent = "目前沒有已隱藏頁籤";
    hiddenList.appendChild(empty);
  }
  if (hiddenTitle) hiddenTitle.textContent = `已隱藏頁籤（${hiddenTabs.length}）`;

  labelInput.value = state.isCreatingManagementTab ? "" : selected?.label || "";
  defaultInput.checked = state.isCreatingManagementTab ? !visibleTabs.some((tab) => tab.isDefault) : selected?.isDefault === true;
  defaultInput.disabled = !controlsEnabled || selected?.enabled === false;
  if (sourceNote) {
    if (state.isCreatingManagementTab) sourceNote.textContent = "新增分類只會儲存在你的個人清單。";
    else if (selected?.source === "system" || selected?.source === "personal-override") {
      sourceNote.textContent = "這會儲存成你的個人覆寫，不會修改共享預設分類。";
    } else {
      sourceNote.textContent = "自訂分類只會儲存在你的個人清單。";
    }
  }
  [saveButton, hideButton, resetButton, deleteButton, newButton].forEach((button) => {
    if (button) button.disabled = !controlsEnabled;
  });
  if (hideButton) {
    hideButton.hidden = state.isCreatingManagementTab || !selected || selected.enabled === false;
    hideButton.disabled = !controlsEnabled || visibleTabs.length <= 1;
  }
  if (resetButton) {
    resetButton.hidden = state.isCreatingManagementTab || !selected?.hasOverride || !tabIdentity(selected).startsWith("system:");
    resetButton.disabled = !controlsEnabled;
  }
  if (deleteButton) {
    deleteButton.hidden = state.isCreatingManagementTab || selected?.source !== "personal";
    deleteButton.disabled = !controlsEnabled || (selected?.enabled !== false && visibleTabs.length <= 1);
  }

  const selectedLabel = selected?.label || activeMarketTab()?.label || state.activeMarketTab;
  const selectedId = selected?.id;
  const instruments = state.isCreatingManagementTab ? [] : orderedInstrumentsForTab(selected);
  const selectedInstrument = instruments.find((item) => item.symbol === state.selectedManagementSymbol)
    || instruments.find((item) => item.symbol === preferredSymbol);
  if (selectedInstrument) state.selectedManagementSymbol = selectedInstrument.symbol;
  instrumentList.innerHTML = "";
  if (!instruments.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.textContent = preferredSymbol ? `${preferredSymbol} 尚未加入這個頁籤` : "這個頁籤尚未設定商品";
    instrumentList.appendChild(empty);
  } else {
    instruments.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "watchlist-instrument-row";
      row.classList.toggle("is-active", item.symbol === state.selectedManagementSymbol);
      row.dataset.symbol = item.symbol;
      const dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "watchlist-drag-handle";
      dragHandle.textContent = "⠿";
      dragHandle.title = "拖曳排序";
      dragHandle.setAttribute("aria-label", `拖曳排序 ${item.symbol}，目前第 ${index + 1} 位，共 ${instruments.length} 位`);
      dragHandle.addEventListener("click", (event) => event.stopPropagation());
      dragHandle.addEventListener("pointerdown", (event) => startWatchlistDrag(event, selected, item.symbol));
      const taiwanItem = isTaiwanStockSymbol(item.symbol);
      const addedAtText = taiwanItem && item.dateStatus === "known" && item.addedAt
        ? `加入 ${item.addedAt}`
        : taiwanItem ? "加入日期未知" : (item.group || item.market || "自訂");
      row.innerHTML = `<div class="watchlist-instrument-info"><b>${escapeHtml(item.symbol)}</b><span class="watchlist-instrument-name">${escapeHtml(item.name)}</span><small class="watchlist-instrument-meta">${escapeHtml(addedAtText)}</small></div>`;
      const recommender = document.createElement("label");
      recommender.className = "watchlist-recommender";
      recommender.setAttribute("aria-label", `${item.symbol} 推薦人`);
      const recommenderInput = document.createElement("input");
      recommenderInput.type = "text";
      recommenderInput.maxLength = 80;
      recommenderInput.placeholder = "推薦人";
      recommenderInput.value = item.recommender || "";
      recommenderInput.dataset.savedValue = item.recommender || "";
      recommenderInput.disabled = !taiwanItem || !item.itemId || !canWriteTabs;
      recommenderInput.title = !item.itemId ? "先儲存這個商品後即可編輯推薦人" : "推薦人（選填）";
      const recommenderStatus = document.createElement("span");
      recommenderStatus.className = "watchlist-recommender-status";
      recommenderStatus.setAttribute("role", "status");
      recommenderStatus.setAttribute("aria-live", "polite");
      recommenderInput.addEventListener("click", (event) => event.stopPropagation());
      recommenderInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          recommenderInput.blur();
        }
      });
      recommenderInput.addEventListener("blur", (event) => {
        event.stopPropagation();
        if (recommenderInput.value.trim() === recommenderInput.dataset.savedValue) return;
        saveWatchlistRecommender(item, recommenderInput, recommenderStatus);
      });
      recommender.append(recommenderInput, recommenderStatus);
      const controls = document.createElement("div");
      controls.className = "watchlist-instrument-order";
      const upButton = document.createElement("button");
      upButton.type = "button";
      upButton.className = "watchlist-order-button";
      upButton.textContent = "↑";
      upButton.title = "上移";
      upButton.setAttribute("aria-label", `上移 ${item.symbol}`);
      upButton.disabled = index === 0;
      upButton.addEventListener("click", (event) => {
        event.stopPropagation();
        moveManagedInstrument(item.symbol, -1);
      });
      const downButton = document.createElement("button");
      downButton.type = "button";
      downButton.className = "watchlist-order-button";
      downButton.textContent = "↓";
      downButton.title = "下移";
      downButton.setAttribute("aria-label", `下移 ${item.symbol}`);
      downButton.disabled = index === instruments.length - 1;
      downButton.addEventListener("click", (event) => {
        event.stopPropagation();
        moveManagedInstrument(item.symbol, 1);
      });
      controls.append(upButton, downButton);
      row.prepend(dragHandle);
      row.append(recommender, controls);
      row.addEventListener("click", () => {
        state.selectedManagementSymbol = item.symbol;
        fillWatchlistInstrumentForm(item);
        renderWatchlistManager();
      });
      instrumentList.appendChild(row);
    });
  }
  fillWatchlistInstrumentForm(selectedInstrument || { tab: selectedLabel, tabId: selectedId });
  if (symbolInput && preferredSymbol && !selectedInstrument) symbolInput.value = preferredSymbol;

  if (!state.personalSync.configured && !state.watchlistMessage?.text) setWatchlistMessage("個人清單尚未設定", "info");
  else if (!state.authSession?.access_token && !state.watchlistMessage?.text) setWatchlistMessage(AUTH_REQUIRED_MESSAGE, "info");
  else renderWatchlistMessage();
}

function selectManagedTab(tab) {
  if (!tab) return;
  const previousTab = selectedManagementTab();
  if (previousTab && tabIdentity(previousTab) !== tabIdentity(tab)) flushWatchlistReorder(previousTab);
  cancelWatchlistDrag();
  cancelWatchlistTabDrag();
  state.isCreatingManagementTab = false;
  state.selectedManagementTabId = tabIdentity(tab);
  state.selectedManagementSymbol = undefined;
  renderWatchlistManager();
}

function managedTabVisibilityIcon(action) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const outline = document.createElementNS(namespace, "path");
  outline.setAttribute("d", "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z");
  const pupil = document.createElementNS(namespace, "circle");
  pupil.setAttribute("cx", "12");
  pupil.setAttribute("cy", "12");
  pupil.setAttribute("r", "2.5");
  svg.append(outline, pupil);
  if (action === "hide") {
    const slash = document.createElementNS(namespace, "path");
    slash.setAttribute("d", "M4 4l16 16");
    svg.appendChild(slash);
  }
  return svg;
}

function managedTabVisibilityControl(action, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `watchlist-tab-control watchlist-tab-control--${action === "hide" ? "hide" : "restore"}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(managedTabVisibilityIcon(action));
  return button;
}

function focusManagedTabDragHandle(tabKey) {
  const row = [...document.querySelectorAll("#watchlist-tab-list .watchlist-tab-row")]
    .find((item) => item.dataset.tabKey === tabKey);
  row?.querySelector(".watchlist-tab-drag-handle")?.focus();
}

function handleManagedTabDragHandleKeydown(event, tabKey) {
  const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (!direction || event.currentTarget.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  const tabs = state.marketTabs;
  const index = tabs.findIndex((tab) => tabIdentity(tab) === tabKey);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= tabs.length) return;
  moveManagedTab(tabKey, direction);
  window.requestAnimationFrame(() => focusManagedTabDragHandle(tabKey));
}

function renderVisibleManagedTabRow(tab, index, visibleTabs, controlsEnabled) {
  const tabKey = tabIdentity(tab);
  const row = document.createElement("div");
  row.className = "watchlist-tab-row";
  row.classList.toggle("is-active", tabKey === state.selectedManagementTabId);
  row.dataset.tabKey = tabKey;
  row.setAttribute("role", "listitem");

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "watchlist-tab-drag-handle";
  handle.textContent = "⠿";
  handle.disabled = !controlsEnabled || visibleTabs.length < 2;
  handle.title = "拖曳頁籤排序；方向鍵可逐項移動";
  handle.setAttribute("aria-label", `拖曳排序 ${tabDisplayLabel(tab)}，目前第 ${index + 1} 位，共 ${visibleTabs.length} 位`);
  handle.addEventListener("click", (event) => event.stopPropagation());
  handle.addEventListener("keydown", (event) => handleManagedTabDragHandleKeydown(event, tabKey));
  handle.addEventListener("pointerdown", (event) => startWatchlistTabDrag(event, tab));

  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "watchlist-tab-button";
  selectButton.textContent = tabDisplayLabel(tab) || tab.label;
  selectButton.title = tabDisplayLabel(tab) || tab.label;
  selectButton.addEventListener("click", () => selectManagedTab(tab));

  const hide = managedTabVisibilityControl("hide", `隱藏頁籤 ${tabDisplayLabel(tab)}`);
  hide.disabled = !controlsEnabled || visibleTabs.length <= 1;
  hide.addEventListener("click", () => setPersonalTabVisibility(tabKey, false));
  row.append(handle, selectButton, hide);
  return row;
}

function renderHiddenManagedTabRow(tab, controlsEnabled) {
  const tabKey = tabIdentity(tab);
  const row = document.createElement("div");
  row.className = "watchlist-hidden-tab-row";
  row.classList.toggle("is-active", tabKey === state.selectedManagementTabId);
  row.dataset.tabKey = tabKey;
  row.setAttribute("role", "listitem");
  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "watchlist-tab-button";
  selectButton.textContent = tabDisplayLabel(tab) || tab.label;
  selectButton.title = tabDisplayLabel(tab) || tab.label;
  selectButton.addEventListener("click", () => selectManagedTab(tab));
  const restore = managedTabVisibilityControl("show", `取消隱藏頁籤 ${tabDisplayLabel(tab)}`);
  restore.disabled = !controlsEnabled;
  restore.addEventListener("click", () => setPersonalTabVisibility(tabKey, true));
  row.append(selectButton, restore);
  return row;
}

function watchlistTabsForManager() {
  const tabs = state.managedTabs.length ? state.managedTabs : state.marketTabs;
  return withDistinguishableDisplayLabels(tabs.map((tab, index) => ({
    ...tab,
    tabKey: tabIdentity(tab),
    displayLabel: tabDisplayLabel(tab) || tab.label,
    sortOrder: tab.sortOrder || index + 1,
    enabled: tab.enabled !== false,
    isDefault: tab.isDefault === true,
    source: tab.source || "system",
    sourceTabId: tab.sourceTabId || (tab.source === "system" ? tab.id : ""),
  })));
}

function withDistinguishableDisplayLabels(tabs) {
  const counts = {};
  tabs.forEach((tab) => {
    const label = String(tab.label || "").trim();
    counts[label] = (counts[label] || 0) + 1;
  });
  const seen = {};
  return tabs.map((tab) => {
    const label = String(tab.label || "").trim();
    seen[label] = (seen[label] || 0) + 1;
    return {
      ...tab,
      displayLabel: tab.displayLabel || (counts[label] > 1 ? `${label} #${seen[label]}` : label),
    };
  });
}

function selectedManagementTab() {
  return watchlistTabsForManager().find((item) => tabIdentity(item) === state.selectedManagementTabId);
}

function reorderScopeForTab(tab) {
  return tabIdentity(tab).startsWith("system:") ? "system" : "personal";
}

function watchlistTabKey(tab) {
  return tabIdentity(tab) || `${reorderScopeForTab(tab)}:${tab?.id || ""}:${tab?.label || ""}`;
}

function reorderItemKey(tab, item) {
  return `${watchlistTabKey(tab)}:${item?.symbol || ""}`;
}

function instrumentBelongsToTab(item, tab) {
  if (!tab) return false;
  const tabId = tab.id;
  if (reorderScopeForTab(tab) === "personal") {
    return item.tabId === tabId || (!item.tabId && item.tab === tab.label && personalTabLabelIsUnique(tab.label));
  }
  return !item.tabId && (item.tab === tab.label || tab.defaultSymbols?.includes(item.symbol));
}

function orderedInstrumentsForTab(tab) {
  const bySymbol = new Map();
  managedInstruments()
    .filter((item) => instrumentBelongsToTab(item, tab))
    .forEach((item) => {
      const current = bySymbol.get(item.symbol);
      if (!current || item.tabId === tabIdentity(tab)) bySymbol.set(item.symbol, item);
    });
  return [...bySymbol.values()]
    .sort((a, b) => instrumentOrderValue(a) - instrumentOrderValue(b) || a.symbol.localeCompare(b.symbol, "en"));
}

function orderedWatchlistInstrumentsForTab(tabId, tabLabel) {
  const tab = watchlistTabsForManager().find((item) => item.id === tabId)
    || watchlistTabsForManager().find((item) => item.label === tabLabel);
  return orderedInstrumentsForTab(tab);
}

function instrumentOrderValue(item) {
  return Number.isInteger(item?.defaultOrder) ? item.defaultOrder : 9999;
}

function moveManagedTab(tabKey, direction) {
  const tabs = state.marketTabs.map((tab) => ({ ...tab }));
  const index = tabs.findIndex((tab) => tabIdentity(tab) === tabKey);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= tabs.length) return;
  const [moved] = tabs.splice(index, 1);
  tabs.splice(targetIndex, 0, moved);
  stageManagedTabOrder(tabs, tabKey);
}

function watchlistTabOrderController() {
  let controller = state.watchlistTabReorderController;
  if (!controller) {
    controller = {
      confirmed: state.marketTabs.map((tab) => ({ ...tab })),
      draft: [],
      revision: 0,
      timer: 0,
      inFlightRevision: 0,
      inFlight: false,
      inFlightPromise: undefined,
      dirty: false,
    };
    state.watchlistTabReorderController = controller;
  }
  return controller;
}

function applyManagedTabOrderLocally(tabs) {
  const normalized = tabs.map((tab, index) => ({ ...tab, sortOrder: index + 1, enabled: true }));
  const visibleKeys = new Set(normalized.map((tab) => tabIdentity(tab)));
  const hidden = state.managedTabs.filter((tab) => !visibleKeys.has(tabIdentity(tab)) && tab.enabled === false);
  state.marketTabs = normalized;
  state.managedTabs = [...normalized, ...hidden];
  renderMarketTabs();
}

function stageManagedTabOrder(tabs, selectedTabKey) {
  if (tabs.length < 1) return;
  const controller = watchlistTabOrderController();
  const normalized = tabs.map((tab, index) => ({ ...tab, sortOrder: index + 1 }));
  controller.draft = normalized.map((tab) => ({ ...tab }));
  controller.revision += 1;
  controller.dirty = true;
  state.selectedManagementTabId = selectedTabKey;
  applyManagedTabOrderLocally(normalized);
  setWatchlistMessage("頁籤排序待儲存…", "info");
  renderWatchlistManager();
  scheduleWatchlistTabReorder(controller);
}

function scheduleWatchlistTabReorder(controller, delay = WATCHLIST_TAB_REORDER_DEBOUNCE_MS) {
  if (controller.timer) window.clearTimeout(controller.timer);
  controller.timer = window.setTimeout(() => {
    controller.timer = 0;
    flushWatchlistTabReorder();
  }, delay);
}

function flushWatchlistTabReorder() {
  const controller = state.watchlistTabReorderController;
  if (!controller) return Promise.resolve();
  if (controller.timer) {
    window.clearTimeout(controller.timer);
    controller.timer = 0;
  }
  if (controller.inFlight) return controller.inFlightPromise || Promise.resolve();
  if (!controller.dirty) return Promise.resolve();
  controller.inFlightPromise = persistWatchlistTabReorder(controller);
  return controller.inFlightPromise;
}

async function persistWatchlistTabReorder(controller) {
  const revision = controller.revision;
  const draft = controller.draft.map((tab) => ({ ...tab }));
  controller.inFlight = true;
  controller.inFlightRevision = revision;
  controller.dirty = false;
  setWatchlistMessage("頁籤排序儲存中…", "loading");
  try {
    const response = await fetchWithPausedPanelStreams("/api/tabs/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        orderedTabKeys: draft.map((tab) => tabIdentity(tab)),
        revision,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
    if (payload.acceptedRevision !== revision) throw new Error("頁籤排序回應版本不一致，請再試一次。");
    controller.confirmed = draft.map((tab) => ({ ...tab }));
    if (controller.revision === revision && !controller.dirty) {
      applyInstrumentSetupPayload(payload, { forceTabOrder: true });
      controller.confirmed = state.marketTabs.map((tab) => ({ ...tab }));
      setWatchlistMessage("頁籤排序已儲存", "success");
    }
  } catch (error) {
    if (controller.revision === revision && !controller.dirty) {
      applyManagedTabOrderLocally(controller.confirmed);
      renderWatchlistManager();
      setWatchlistMessage(tabOperationErrorMessage(error), "error");
    }
  } finally {
    controller.inFlight = false;
    controller.inFlightRevision = 0;
    controller.inFlightPromise = undefined;
    if (controller.dirty) scheduleWatchlistTabReorder(controller, 0);
  }
}

async function settleWatchlistTabReorder() {
  cancelWatchlistTabDrag();
  const controller = state.watchlistTabReorderController;
  if (!controller) return;
  while (controller.dirty || controller.inFlight) {
    await flushWatchlistTabReorder();
    if (controller.inFlightPromise) await controller.inFlightPromise;
  }
}

function startWatchlistTabDrag(event, tab) {
  if (!tab || event.button !== 0 || state.watchlistTabDrag || state.watchlistTabMutationPending) return;
  const handle = event.currentTarget;
  const row = handle.closest(".watchlist-tab-row");
  const list = document.getElementById("watchlist-tab-list");
  const scrollContainer = document.querySelector(".watchlist-tab-manager");
  const tabs = state.marketTabs.map((item) => ({ ...item }));
  if (!row || !list || !scrollContainer || tabs.length < 2) return;
  event.preventDefault();
  event.stopPropagation();
  const indicator = document.createElement("div");
  indicator.className = "watchlist-tab-drop-indicator";
  indicator.setAttribute("aria-hidden", "true");
  const drag = {
    pointerId: event.pointerId,
    tabKey: tabIdentity(tab),
    label: tabDisplayLabel(tab),
    handle,
    row,
    list,
    scrollContainer,
    indicator,
    tabKeys: tabs.map((item) => tabIdentity(item)),
    snapshot: tabs,
    lastClientY: event.clientY,
    moved: false,
  };
  drag.onMove = (moveEvent) => handleWatchlistTabDragMove(moveEvent);
  drag.onUp = (upEvent) => finishWatchlistTabDrag(upEvent);
  drag.onCancel = () => cancelWatchlistTabDrag();
  drag.onBlur = () => cancelWatchlistTabDrag();
  drag.onVisibilityChange = () => {
    if (document.hidden) cancelWatchlistTabDrag();
  };
  state.watchlistTabDrag = drag;
  row.classList.add("is-dragging");
  list.classList.add("is-dragging");
  list.insertBefore(indicator, row);
  handle.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", drag.onMove, true);
  window.addEventListener("pointerup", drag.onUp, true);
  window.addEventListener("pointercancel", drag.onCancel, true);
  window.addEventListener("blur", drag.onBlur);
  document.addEventListener("visibilitychange", drag.onVisibilityChange);
  setWatchlistMessage(`正在移動頁籤 ${drag.label}，按 Escape 可取消`, "info");
  runWatchlistTabDragAutoScroll();
}

function handleWatchlistTabDragMove(event) {
  const drag = state.watchlistTabDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
    finishWatchlistTabDrag(event);
    return;
  }
  event.preventDefault();
  drag.lastClientY = event.clientY;
  updateWatchlistTabDragPosition(event.clientY);
}

function updateWatchlistTabDragPosition(clientY) {
  const drag = state.watchlistTabDrag;
  if (!drag) return;
  const rows = [...drag.list.querySelectorAll(".watchlist-tab-row")];
  let targetIndex = rows.findIndex((row) => clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
  if (targetIndex < 0) targetIndex = rows.length - 1;
  const currentIndex = drag.tabKeys.indexOf(drag.tabKey);
  if (targetIndex === currentIndex || targetIndex < 0) return;
  drag.tabKeys.splice(currentIndex, 1);
  drag.tabKeys.splice(targetIndex, 0, drag.tabKey);
  const rowByKey = new Map(rows.map((row) => [row.dataset.tabKey, row]));
  drag.indicator.remove();
  drag.tabKeys.forEach((key) => drag.list.appendChild(rowByKey.get(key)));
  drag.list.insertBefore(drag.indicator, rowByKey.get(drag.tabKey));
  const tabByKey = new Map(state.marketTabs.map((item) => [tabIdentity(item), item]));
  applyManagedTabOrderLocally(drag.tabKeys.map((key) => tabByKey.get(key)).filter(Boolean));
  refreshWatchlistTabDragPositions(drag);
  drag.moved = true;
}

function refreshWatchlistTabDragPositions(drag) {
  drag.tabKeys.forEach((key, index) => {
    const row = [...drag.list.querySelectorAll(".watchlist-tab-row")].find((item) => item.dataset.tabKey === key);
    const handle = row?.querySelector(".watchlist-tab-drag-handle");
    const label = state.marketTabs.find((tab) => tabIdentity(tab) === key)?.label || key;
    handle?.setAttribute("aria-label", `拖曳排序 ${label}，目前第 ${index + 1} 位，共 ${drag.tabKeys.length} 位`);
  });
}

function runWatchlistTabDragAutoScroll() {
  if (state.watchlistTabDragFrame) return;
  const tick = () => {
    const drag = state.watchlistTabDrag;
    if (!drag) {
      state.watchlistTabDragFrame = 0;
      return;
    }
    const bounds = drag.scrollContainer.getBoundingClientRect();
    const topRatio = Math.max(0, Math.min(1, (bounds.top + WATCHLIST_DRAG_EDGE_PX - drag.lastClientY) / WATCHLIST_DRAG_EDGE_PX));
    const bottomRatio = Math.max(0, Math.min(1, (drag.lastClientY - (bounds.bottom - WATCHLIST_DRAG_EDGE_PX)) / WATCHLIST_DRAG_EDGE_PX));
    const speed = Math.round((bottomRatio - topRatio) * WATCHLIST_DRAG_MAX_SCROLL_PX);
    if (speed) {
      drag.scrollContainer.scrollTop += speed;
      updateWatchlistTabDragPosition(drag.lastClientY);
    }
    state.watchlistTabDragFrame = requestAnimationFrame(tick);
  };
  state.watchlistTabDragFrame = requestAnimationFrame(tick);
}

function finishWatchlistTabDrag(event) {
  const drag = state.watchlistTabDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const bounds = drag.list.getBoundingClientRect();
  const valid = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  if (!valid) {
    cancelWatchlistTabDrag();
    return;
  }
  const tabByKey = new Map(state.marketTabs.map((tab) => [tabIdentity(tab), tab]));
  const reordered = drag.tabKeys.map((key) => tabByKey.get(key)).filter(Boolean);
  const moved = drag.moved;
  const tabKey = drag.tabKey;
  cleanupWatchlistTabDrag();
  if (moved) stageManagedTabOrder(reordered, tabKey);
  else renderWatchlistManager();
}

function cancelWatchlistTabDrag() {
  const drag = state.watchlistTabDrag;
  if (!drag) return;
  applyManagedTabOrderLocally(drag.snapshot);
  cleanupWatchlistTabDrag();
  renderWatchlistManager();
  setWatchlistMessage("已取消頁籤拖曳排序", "info");
}

function cleanupWatchlistTabDrag() {
  const drag = state.watchlistTabDrag;
  if (!drag) return;
  window.removeEventListener("pointermove", drag.onMove, true);
  window.removeEventListener("pointerup", drag.onUp, true);
  window.removeEventListener("pointercancel", drag.onCancel, true);
  window.removeEventListener("blur", drag.onBlur);
  document.removeEventListener("visibilitychange", drag.onVisibilityChange);
  if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  drag.indicator.remove();
  drag.row.classList.remove("is-dragging");
  drag.list.classList.remove("is-dragging");
  state.watchlistTabDrag = undefined;
  if (state.watchlistTabDragFrame) cancelAnimationFrame(state.watchlistTabDragFrame);
  state.watchlistTabDragFrame = 0;
}

async function savePersonalTab() {
  const labelInput = document.getElementById("watchlist-tab-label");
  const defaultInput = document.getElementById("watchlist-tab-default");
  const label = labelInput?.value.trim();
  const isDefault = defaultInput?.checked === true;
  if (!label) {
    setWatchlistMessage("請輸入頁籤名稱", "error");
    return;
  }
  try {
    state.watchlistTabMutationPending = true;
    renderWatchlistManager();
    await settleWatchlistTabReorder();
    setWatchlistMessage("頁籤儲存中...", "loading");
    const tab = selectedManagementTab();
    const tabId = state.isCreatingManagementTab ? newPersonalTabId() : tab?.id;
    const response = await fetchWithPausedPanelStreams("/api/tabs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        ...(state.isCreatingManagementTab ? { id: tabId } : { tabKey: tabIdentity(tab) }),
        label,
        isDefault,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
    applyInstrumentSetupPayload(payload, { forceTabOrder: true });
    state.isCreatingManagementTab = false;
    const saved = (payload.managedTabs || []).find((item) => item.id === tabId)
      || (payload.managedTabs || []).find((item) => tabIdentity(item) === tabIdentity(tab))
      || (payload.managedTabs || []).find((item) => item.label === label);
    state.selectedManagementTabId = tabIdentity(saved) || state.selectedManagementTabId;
    renderWatchlistManager();
    setWatchlistMessage("頁籤已儲存", "success");
  } catch (error) {
    setWatchlistMessage(tabOperationErrorMessage(error), "error");
  } finally {
    state.watchlistTabMutationPending = false;
    renderWatchlistManager();
  }
}

function newPersonalTabId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function setPersonalTabVisibility(tabKey, enabled) {
  if (!tabKey) return;
  const tab = watchlistTabsForManager().find((item) => tabIdentity(item) === tabKey);
  if (!tab) return;
  const previousVisible = state.marketTabs.map((item) => ({ ...item }));
  const wasActive = state.activeMarketTabId === tabKey;
  try {
    state.watchlistTabMutationPending = true;
    renderWatchlistManager();
    await settleWatchlistTabReorder();
    setWatchlistMessage(enabled ? "正在取消隱藏頁籤..." : "頁籤隱藏中...", "loading");
    const response = await fetchWithPausedPanelStreams("/api/tabs/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ tabKey, enabled }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
    applyInstrumentSetupPayload(payload, { forceTabOrder: true });
    state.selectedManagementTabId = tabKey;
    if (!enabled && wasActive) applyHiddenActiveTabFallback(tabKey, previousVisible);
    if (!enabled) document.getElementById("watchlist-hidden-tabs").open = true;
    setWatchlistMessage(enabled ? "已取消隱藏並移到最後，可再拖曳調整。" : "頁籤已隱藏，可在「已隱藏頁籤」取消隱藏。", "success");
    window.requestAnimationFrame(() => {
      const selector = `[data-tab-key="${CSS.escape(tabKey)}"]`;
      const row = document.querySelector(selector);
      const target = enabled ? row?.querySelector(".watchlist-tab-button") : row?.querySelector(".watchlist-tab-control--restore");
      target?.focus();
    });
  } catch (error) {
    setWatchlistMessage(tabOperationErrorMessage(error), "error");
  } finally {
    state.watchlistTabMutationPending = false;
    renderWatchlistManager();
  }
}

function applyHiddenActiveTabFallback(tabKey, previousVisible) {
  const index = previousVisible.findIndex((tab) => tabIdentity(tab) === tabKey);
  const candidates = [previousVisible[index + 1], previousVisible[index - 1]].filter(Boolean);
  const fallback = candidates.map((candidate) => state.marketTabs.find((tab) => tabIdentity(tab) === tabIdentity(candidate))).find(Boolean)
    || state.marketTabs.find((tab) => tab.isDefault)
    || state.marketTabs[0];
  if (!fallback) return;
  setActiveMarketTabState(fallback);
  state.categoryPageByTabId[tabIdentity(fallback)] = 0;
  renderMarketTabs();
  renderCategoryPagination();
  refreshAllSymbolOptions();
  renderPanels(currentChartCount());
}

async function resetSystemTab(tabKey) {
  const tab = watchlistTabsForManager().find((item) => tabIdentity(item) === tabKey);
  if (!tabKey || !tab?.hasOverride) return;
  if (!window.confirm(`將頁籤「${tab.label}」恢復為系統預設？`)) return;
  try {
    state.watchlistTabMutationPending = true;
    renderWatchlistManager();
    await settleWatchlistTabReorder();
    setWatchlistMessage("正在恢復系統預設...", "loading");
    const response = await fetchWithPausedPanelStreams("/api/tabs/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ tabKey }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
    applyInstrumentSetupPayload(payload, { forceTabOrder: true });
    state.selectedManagementTabId = tabKey;
    setWatchlistMessage("已恢復系統預設", "success");
  } catch (error) {
    setWatchlistMessage(tabOperationErrorMessage(error), "error");
  } finally {
    state.watchlistTabMutationPending = false;
    renderWatchlistManager();
  }
}

async function deletePersonalTab(tabKey) {
  const tab = watchlistTabsForManager().find((item) => tabIdentity(item) === tabKey);
  if (!tabKey || !tab || tab.source !== "personal") return;
  if (!window.confirm(`刪除頁籤「${tab.label}」？此頁籤內的個人商品將不再顯示。`)) return;
  const previousVisible = state.marketTabs.map((item) => ({ ...item }));
  const wasActive = state.activeMarketTabId === tabKey;
  try {
    state.watchlistTabMutationPending = true;
    renderWatchlistManager();
    await settleWatchlistTabReorder();
    setWatchlistMessage("頁籤刪除中...", "loading");
    const response = await fetchWithPausedPanelStreams(`/api/tabs/${encodeURIComponent(tabKey)}`, {
      method: "DELETE",
      headers: { ...getAuthHeaders() },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
    state.selectedManagementTabId = undefined;
    state.selectedManagementSymbol = undefined;
    state.isCreatingManagementTab = false;
    applyInstrumentSetupPayload(payload, { forceTabOrder: true });
    if (wasActive) applyHiddenActiveTabFallback(tabKey, previousVisible);
    refreshAllSymbolOptions();
    setWatchlistMessage("頁籤已刪除", "success");
  } catch (error) {
    setWatchlistMessage(tabOperationErrorMessage(error), "error");
  } finally {
    state.watchlistTabMutationPending = false;
    renderWatchlistManager();
  }
}

async function savePersonalInstrument() {
  const tab = selectedManagementTab();
  const symbolInput = document.getElementById("watchlist-symbol");
  const nameInput = document.getElementById("watchlist-symbol-name");
  const groupInput = document.getElementById("watchlist-symbol-group");
  const providerInput = document.getElementById("watchlist-symbol-provider");
  const recommenderInput = document.getElementById("watchlist-symbol-recommender");
  const enabledInput = document.getElementById("watchlist-symbol-enabled");
  const symbol = normalizeCustomSymbol(symbolInput?.value || "");
  if (!symbol) {
    setWatchlistMessage("請輸入商品代號", "error");
    return;
  }
  try {
    setWatchlistMessage("商品儲存中...", "loading");
    const savedTabId = reorderScopeForTab(tab) === "system" ? "" : (tab?.id || "");
    await saveManagedInstrument({
      symbol,
      name: nameInput?.value.trim() || symbol,
      tabId: savedTabId,
      tab: tab?.label || activeMarketTab()?.label || state.activeMarketTab,
      group: groupInput?.value.trim() || "自訂",
      provider: providerInput?.value || providerForSymbol(symbol),
      defaultOrder: defaultOrderForSavedInstrument(symbol, savedTabId, tab?.label || activeMarketTab()?.label || state.activeMarketTab),
      enabled: enabledInput?.checked !== false,
      recommender: recommenderInput?.value || "",
    });
    state.selectedManagementSymbol = symbol;
    refreshAllSymbolOptions(undefined, symbol);
    renderWatchlistManager(symbol);
    setWatchlistMessage("商品已儲存", "success");
  } catch (error) {
    setWatchlistMessage(error.message || AUTH_REQUIRED_MESSAGE, "error");
  }
}

function defaultOrderForSavedInstrument(symbol, tabId, tabLabel) {
  const instruments = orderedWatchlistInstrumentsForTab(tabId, tabLabel);
  const existing = instruments.find((item) => item.symbol === symbol);
  if (existing) return existing.defaultOrder || instruments.indexOf(existing) + 1;
  const orders = instruments.map((item, index) => item.defaultOrder || index + 1);
  return orders.length ? Math.max(...orders) + 1 : 1;
}

function moveManagedInstrument(symbol, direction) {
  const tab = selectedManagementTab();
  const instruments = orderedInstrumentsForTab(tab);
  const index = instruments.findIndex((item) => item.symbol === symbol);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= instruments.length) return;
  const reordered = [...instruments];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moved);
  stageManagedInstrumentOrder(tab, reordered, symbol);
}

function watchlistReorderController(tab) {
  if (!tab) return undefined;
  const key = watchlistTabKey(tab);
  let controller = state.watchlistReorderControllers.get(key);
  if (!controller) {
    controller = {
      tab: { ...tab },
      confirmed: snapshotManagedInstrumentOrder(orderedInstrumentsForTab(tab), tab),
      draft: [],
      revision: 0,
      timer: 0,
      inFlightRevision: 0,
      inFlight: false,
      dirty: false,
      draftSource: "watchlist",
    };
    state.watchlistReorderControllers.set(key, controller);
  }
  return controller;
}

function stageManagedInstrumentOrder(tab, instruments, selectedSymbol, options = {}) {
  if (!tab || instruments.length < 1) return;
  const controller = watchlistReorderController(tab);
  const updates = instruments.map((item, index) => ({ ...item, defaultOrder: index + 1 }));
  controller.tab = { ...tab };
  controller.draft = updates.map((item) => ({ ...item }));
  controller.draftSource = options.source === "panel" ? "panel" : "watchlist";
  controller.revision += 1;
  controller.dirty = true;
  state.selectedManagementSymbol = selectedSymbol;
  applyManagedInstrumentOrderLocally(updates, tab);
  setWatchlistMessage("排序待儲存…", "info");
  if (controller.draftSource === "panel") setPanelReorderStatus("商品順序已更新，等待儲存");
  else setPanelReorderStatus("");
  renderWatchlistManager(selectedSymbol);
  scheduleWatchlistReorder(controller);
}

function scheduleWatchlistReorder(controller, delay = WATCHLIST_REORDER_DEBOUNCE_MS) {
  if (!controller) return;
  if (controller.timer) window.clearTimeout(controller.timer);
  controller.timer = window.setTimeout(() => {
    controller.timer = 0;
    flushWatchlistReorder(controller.tab);
  }, delay);
}

function flushWatchlistReorder(tab) {
  const controller = tab && state.watchlistReorderControllers.get(watchlistTabKey(tab));
  if (!controller) return;
  if (controller.timer) {
    window.clearTimeout(controller.timer);
    controller.timer = 0;
  }
  if (controller.inFlight || !controller.dirty) return;
  void persistWatchlistReorder(controller);
}

async function persistWatchlistReorder(controller) {
  const revision = controller.revision;
  const draft = controller.draft.map((item) => ({ ...item }));
  const draftSource = controller.draftSource;
  controller.inFlight = true;
  controller.inFlightRevision = revision;
  controller.dirty = false;
  setWatchlistMessage("排序儲存中…", "loading");
  try {
    const payload = await saveManagedInstrumentOrderBatch(controller.tab, draft, revision);
    if (payload.revision !== revision || payload.tabId !== controller.tab.id) throw new Error("排序回應版本不一致，請再試一次。");
    controller.confirmed = draft.map((item) => ({ ...item, __watchlistHadExact: true }));
    if (controller.revision === revision) {
      setWatchlistMessage("排序已儲存", "success");
      syncChartOrderForTab(controller.tab);
      if (draftSource === "panel") setPanelReorderStatus("商品順序已永久儲存");
    }
  } catch (error) {
    if (controller.revision === revision && !controller.dirty) {
      restoreManagedInstrumentOrder(controller.confirmed, controller.tab);
      renderWatchlistManager(state.selectedManagementSymbol);
      syncChartOrderForTab(controller.tab);
      setWatchlistMessage(error.message || AUTH_REQUIRED_MESSAGE, "error");
      if (draftSource === "panel") setPanelReorderStatus(`排序儲存失敗，已回復：${error.message || AUTH_REQUIRED_MESSAGE}`);
    }
  } finally {
    controller.inFlight = false;
    controller.inFlightRevision = 0;
    if (controller.dirty) scheduleWatchlistReorder(controller, 0);
  }
}

async function saveManagedInstrumentOrderBatch(tab, instruments, revision) {
  const response = await fetch("/api/instruments/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({
      tabId: tab.id,
      tabLabel: tab.label,
      scope: reorderScopeForTab(tab),
      revision,
      items: instruments.map((item) => ({ symbol: item.symbol, tabId: reorderScopeForTab(tab) === "system" ? "" : tab.id })),
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
  return payload;
}

function handleWatchlistDialogClose() {
  cancelWatchlistDrag();
  cancelWatchlistTabDrag();
  const tab = selectedManagementTab();
  flushWatchlistReorder(tab);
  flushWatchlistTabReorder();
  syncChartOrderForTab(tab);
}

function startWatchlistDrag(event, tab, symbol) {
  if (!tab || event.button !== 0 || state.watchlistDrag) return;
  const handle = event.currentTarget;
  const row = handle.closest(".watchlist-instrument-row");
  const list = document.getElementById("watchlist-instrument-list");
  const instruments = orderedInstrumentsForTab(tab);
  if (!row || !list || instruments.length < 2) return;
  event.preventDefault();
  event.stopPropagation();
  const indicator = document.createElement("div");
  indicator.className = "watchlist-drop-indicator";
  indicator.setAttribute("aria-hidden", "true");
  const drag = {
    pointerId: event.pointerId,
    tab: { ...tab },
    symbol,
    handle,
    row,
    list,
    indicator,
    symbols: instruments.map((item) => item.symbol),
    snapshot: snapshotManagedInstrumentOrder(instruments, tab),
    lastClientY: event.clientY,
    moved: false,
  };
  drag.onMove = (moveEvent) => handleWatchlistDragMove(moveEvent);
  drag.onUp = (upEvent) => finishWatchlistDrag(upEvent);
  drag.onCancel = () => cancelWatchlistDrag();
  drag.onBlur = () => cancelWatchlistDrag();
  drag.onVisibilityChange = () => {
    if (document.hidden) cancelWatchlistDrag();
  };
  state.watchlistDrag = drag;
  row.classList.add("is-dragging");
  list.classList.add("is-dragging");
  list.insertBefore(indicator, row);
  handle.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", drag.onMove, true);
  window.addEventListener("pointerup", drag.onUp, true);
  window.addEventListener("pointercancel", drag.onCancel, true);
  window.addEventListener("blur", drag.onBlur);
  document.addEventListener("visibilitychange", drag.onVisibilityChange);
  setWatchlistMessage(`正在移動 ${symbol}，按 Escape 可取消`, "info");
  runWatchlistDragAutoScroll();
}

function handleWatchlistDragMove(event) {
  const drag = state.watchlistDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
    finishWatchlistDrag(event);
    return;
  }
  event.preventDefault();
  drag.lastClientY = event.clientY;
  updateWatchlistDragPosition(event.clientY);
}

function updateWatchlistDragPosition(clientY) {
  const drag = state.watchlistDrag;
  if (!drag) return;
  const rows = [...drag.list.querySelectorAll(".watchlist-instrument-row")];
  let targetIndex = rows.findIndex((row) => clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
  if (targetIndex < 0) targetIndex = rows.length - 1;
  const currentIndex = drag.symbols.indexOf(drag.symbol);
  if (targetIndex === currentIndex || targetIndex < 0) return;
  drag.symbols.splice(currentIndex, 1);
  drag.symbols.splice(targetIndex, 0, drag.symbol);
  const rowBySymbol = new Map(rows.map((row) => [row.dataset.symbol, row]));
  drag.indicator.remove();
  drag.symbols.forEach((symbol) => drag.list.appendChild(rowBySymbol.get(symbol)));
  drag.list.insertBefore(drag.indicator, rowBySymbol.get(drag.symbol));
  const itemBySymbol = new Map(orderedInstrumentsForTab(drag.tab).map((item) => [item.symbol, item]));
  const updates = drag.symbols.map((symbol, index) => ({ ...itemBySymbol.get(symbol), defaultOrder: index + 1 }));
  applyManagedInstrumentOrderLocally(updates, drag.tab);
  refreshWatchlistDragPositions(drag);
  drag.moved = true;
}

function refreshWatchlistDragPositions(drag) {
  drag.symbols.forEach((symbol, index) => {
    const row = drag.list.querySelector(`.watchlist-instrument-row[data-symbol="${CSS.escape(symbol)}"]`);
    const handle = row?.querySelector(".watchlist-drag-handle");
    handle?.setAttribute("aria-label", `拖曳排序 ${symbol}，目前第 ${index + 1} 位，共 ${drag.symbols.length} 位`);
    const buttons = row?.querySelectorAll(".watchlist-order-button");
    if (buttons?.[0]) buttons[0].disabled = index === 0;
    if (buttons?.[1]) buttons[1].disabled = index === drag.symbols.length - 1;
  });
}

function runWatchlistDragAutoScroll() {
  if (state.watchlistDragFrame) return;
  const tick = () => {
    const drag = state.watchlistDrag;
    if (!drag) {
      state.watchlistDragFrame = 0;
      return;
    }
    const bounds = drag.list.getBoundingClientRect();
    const topRatio = Math.max(0, Math.min(1, (bounds.top + WATCHLIST_DRAG_EDGE_PX - drag.lastClientY) / WATCHLIST_DRAG_EDGE_PX));
    const bottomRatio = Math.max(0, Math.min(1, (drag.lastClientY - (bounds.bottom - WATCHLIST_DRAG_EDGE_PX)) / WATCHLIST_DRAG_EDGE_PX));
    const speed = Math.round((bottomRatio - topRatio) * WATCHLIST_DRAG_MAX_SCROLL_PX);
    if (speed) {
      drag.list.scrollTop += speed;
      updateWatchlistDragPosition(drag.lastClientY);
    }
    state.watchlistDragFrame = requestAnimationFrame(tick);
  };
  state.watchlistDragFrame = requestAnimationFrame(tick);
}

function finishWatchlistDrag(event) {
  const drag = state.watchlistDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const bounds = drag.list.getBoundingClientRect();
  const valid = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  if (!valid) {
    cancelWatchlistDrag();
    return;
  }
  const itemsBySymbol = new Map(orderedInstrumentsForTab(drag.tab).map((item) => [item.symbol, item]));
  const reordered = drag.symbols.map((symbol) => itemsBySymbol.get(symbol)).filter(Boolean);
  const moved = drag.moved;
  const selectedSymbol = drag.symbol;
  cleanupWatchlistDrag();
  if (moved) stageManagedInstrumentOrder(drag.tab, reordered, selectedSymbol);
  else renderWatchlistManager(selectedSymbol);
}

function cancelWatchlistDrag() {
  const drag = state.watchlistDrag;
  if (!drag) return;
  restoreManagedInstrumentOrder(drag.snapshot, drag.tab);
  const symbol = drag.symbol;
  cleanupWatchlistDrag();
  renderWatchlistManager(symbol);
  setWatchlistMessage("已取消拖曳排序", "info");
}

function cleanupWatchlistDrag() {
  const drag = state.watchlistDrag;
  if (!drag) return;
  window.removeEventListener("pointermove", drag.onMove, true);
  window.removeEventListener("pointerup", drag.onUp, true);
  window.removeEventListener("pointercancel", drag.onCancel, true);
  window.removeEventListener("blur", drag.onBlur);
  document.removeEventListener("visibilitychange", drag.onVisibilityChange);
  if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  drag.indicator.remove();
  drag.row.classList.remove("is-dragging");
  drag.list.classList.remove("is-dragging");
  state.watchlistDrag = undefined;
  if (state.watchlistDragFrame) cancelAnimationFrame(state.watchlistDragFrame);
  state.watchlistDragFrame = 0;
}

function handleWatchlistDragKeydown(event) {
  if (event.key !== "Escape" || (!state.watchlistDrag && !state.watchlistTabDrag)) return;
  event.preventDefault();
  if (state.watchlistTabDrag) cancelWatchlistTabDrag();
  else cancelWatchlistDrag();
}

async function deletePersonalInstrument(symbol) {
  if (!symbol) return;
  try {
    setWatchlistMessage("商品刪除中...", "loading");
    const tab = selectedManagementTab();
    await deleteManagedInstrument(symbol, tab);
    state.selectedManagementSymbol = undefined;
    clearWatchlistInstrumentForm();
    refreshAllSymbolOptions();
    renderWatchlistManager();
    setWatchlistMessage("商品已刪除", "success");
  } catch (error) {
    setWatchlistMessage(error.message || AUTH_REQUIRED_MESSAGE, "error");
  }
}

function fillWatchlistInstrumentForm(item) {
  const symbolInput = document.getElementById("watchlist-symbol");
  const nameInput = document.getElementById("watchlist-symbol-name");
  const groupInput = document.getElementById("watchlist-symbol-group");
  const providerInput = document.getElementById("watchlist-symbol-provider");
  const enabledInput = document.getElementById("watchlist-symbol-enabled");
  const recommenderInput = document.getElementById("watchlist-symbol-recommender");
  if (!symbolInput || !nameInput || !groupInput || !providerInput || !enabledInput || !recommenderInput) return;
  symbolInput.value = item?.symbol || "";
  nameInput.value = item?.name || "";
  groupInput.value = item?.group || item?.market || "";
  providerInput.value = item?.provider || providerForSymbol(item?.symbol || "");
  enabledInput.checked = item?.enabled !== false;
  recommenderInput.value = item?.recommender || "";
}

function clearWatchlistInstrumentForm() {
  fillWatchlistInstrumentForm({});
}

function scheduleInstrumentSearch(value) {
  window.clearTimeout(watchlistSearchTimer);
  const query = String(value || "").trim();
  const isSymbolQuery = /^[A-Za-z0-9^=._-]+$/.test(query);
  if (!query || (!isSymbolQuery && query.length < 2)) {
    state.watchlistSearchRequestId += 1;
    renderInstrumentSearchResults([]);
    updateInstrumentSearchStatus(query ? "請再多輸入一些字" : "");
    return;
  }
  const requestId = state.watchlistSearchRequestId + 1;
  state.watchlistSearchRequestId = requestId;
  updateInstrumentSearchStatus("搜尋中...");
  watchlistSearchTimer = window.setTimeout(() => runInstrumentSearch(query, requestId), WATCHLIST_SEARCH_DEBOUNCE_MS);
}

async function runInstrumentSearch(query, requestId) {
  try {
    const response = await fetch(`/api/instrument-search?q=${encodeURIComponent(query)}&limit=8`);
    const payload = await response.json();
    if (requestId !== state.watchlistSearchRequestId) return;
    const results = payload.results || [];
    renderInstrumentSearchResults(results);
    if (results.length) {
      updateInstrumentSearchStatus(payload.warning ? `選一個候選項目填入下方表單（${payload.warning}）` : "選一個候選項目填入下方表單");
    } else if (payload.warning) {
      updateInstrumentSearchStatus(payload.warning);
    } else {
      updateInstrumentSearchStatus("沒有找到候選項目，可直接手動輸入");
    }
  } catch {
    if (requestId === state.watchlistSearchRequestId) {
      renderInstrumentSearchResults([]);
      updateInstrumentSearchStatus("外部商品搜尋暫時不可用，可直接手動輸入");
    }
  }
}

function renderInstrumentSearchResults(results) {
  const container = document.getElementById("watchlist-search-results");
  if (!container) return;
  container.innerHTML = "";
  for (const suggestion of results || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "watchlist-search-result";
    const market = suggestion.market || suggestion.exchange || suggestion.group || "未分類";
    const source = suggestion.source === "local" ? "已收錄" : suggestion.exchange || suggestion.source || "外部";
    const localizedName = suggestion.localizedName || suggestion.name || suggestion.symbol || "";
    const englishName = suggestion.englishName && suggestion.englishName !== localizedName ? suggestion.englishName : "";
    const details = [suggestion.symbol, suggestion.exchange, suggestion.quoteType || suggestion.group].filter(Boolean).join(" · ");
    button.innerHTML = `<strong class="watchlist-search-name">${escapeHtml(localizedName)}</strong><b class="watchlist-search-symbol">${escapeHtml(details)}</b>${englishName ? `<span class="watchlist-search-english">${escapeHtml(englishName)}</span>` : ""}<small class="watchlist-search-meta">${escapeHtml(market)}｜${escapeHtml(source)}</small>`;
    button.addEventListener("click", () => selectInstrumentSuggestion(suggestion));
    container.appendChild(button);
  }
}

function selectInstrumentSuggestion(suggestion) {
  const searchInput = document.getElementById("watchlist-symbol-search");
  fillWatchlistInstrumentForm({
    symbol: suggestion.symbol || "",
    name: suggestion.localizedName || suggestion.name || suggestion.symbol || "",
    group: suggestion.group || suggestion.market || suggestion.exchange || "自訂",
    market: suggestion.market || suggestion.exchange || "",
    provider: suggestion.provider || providerForSymbol(suggestion.symbol || ""),
    enabled: true,
  });
  state.selectedManagementSymbol = suggestion.symbol || undefined;
  if (searchInput) searchInput.value = `${suggestion.symbol || ""} ${suggestion.localizedName || suggestion.name || ""}`.trim();
  renderInstrumentSearchResults([]);
  updateInstrumentSearchStatus("已填入，確認後再按儲存商品");
}

function updateInstrumentSearchStatus(message) {
  const node = document.getElementById("watchlist-search-status");
  if (node) node.textContent = message || "";
}

function tabOperationErrorMessage(error) {
  const message = String(error?.message || AUTH_REQUIRED_MESSAGE).trim();
  if (!message || message === AUTH_REQUIRED_MESSAGE || message.includes("登入")) return message || AUTH_REQUIRED_MESSAGE;
  if (message.includes("商品")) return "頁籤操作未完成，請稍後再試。";
  return message;
}

function sanitizeWatchlistMessage(message) {
  return String(message || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED_SECRET]")
    .replace(/(token|apikey|api_key|secret)=([^&\s]+)/gi, "$1=[REDACTED_SECRET]");
}

function setWatchlistMessage(message, type = "info") {
  const normalizedType = ["loading", "success", "error", "info"].includes(type) ? type : "info";
  state.watchlistMessage = {
    text: sanitizeWatchlistMessage(message),
    type: normalizedType,
  };
  renderWatchlistMessage();
}

function clearWatchlistMessage() {
  setWatchlistMessage("", "info");
}

function renderWatchlistMessage() {
  const node = document.getElementById("watchlist-message");
  if (!node) return;
  const text = state.watchlistMessage?.text || "";
  const type = state.watchlistMessage?.type || "info";
  node.textContent = text;
  node.hidden = !text;
  node.className = `watchlist-message ${WATCHLIST_MESSAGE_CLASSES[type] || WATCHLIST_MESSAGE_CLASSES.info}`;
  node.setAttribute("role", type === "error" ? "alert" : "status");
  node.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
}

function renderMarketTabs() {
  const container = document.getElementById("market-tabs");
  if (!container) return;
  container.innerHTML = "";
  for (const tab of state.marketTabs) {
    const tabId = tabIdentity(tab);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "market-tab";
    button.dataset.marketTab = tabId;
    button.textContent = tabDisplayLabel(tab) || tab.label;
    button.title = `${tab.defaultSymbols?.length || 0} 個預設商品`;
    button.classList.toggle("is-active", tabId === state.activeMarketTabId);
    button.addEventListener("click", () => setActiveMarketTab(tabId));
    container.appendChild(button);
  }
  renderCategoryPagination();
}

function setActiveMarketTab(tabId) {
  const nextTab = validMarketTab(tabId);
  if (!nextTab || tabIdentity(nextTab) === state.activeMarketTabId) return;
  setActiveMarketTabState(nextTab);
  renderMarketTabs();
  renderPanels(Number(document.getElementById("chart-count").value));
}

function validMarketTab(tabId) {
  if (!tabId) return undefined;
  return state.marketTabs.find((tab) => tabIdentity(tab) === tabId || tab.id === tabId);
}

function renderPanels(count) {
  cancelPanelDrag("context-change");
  const grid = document.getElementById("chart-grid");
  const renderGeneration = state.panelRenderGeneration + 1;
  state.panelRenderGeneration = renderGeneration;
  grid.className = `chart-grid ${GRID_CLASSES[count] || "grid-4"}`;
  updateChipModeControl();
  const panelCount = panelCountForActiveCategory(count);
  cancelPanelPayloadPrefetch();
  const previousPanels = state.panels;
  state.panels = [];
  previousPanels.forEach((panel) => panel.destroy());
  grid.innerHTML = "";

  for (let index = 0; index < panelCount; index += 1) {
    const panel = createPanel(index, renderGeneration);
    grid.appendChild(panel.element);
    state.panels.push(panel);
    panel.load();
  }
  refreshPanelReorderAffordances();
  exposeQuoteChartDebug();
}

function setPanelReorderStatus(message = "") {
  const node = document.getElementById("panel-reorder-status");
  if (node) node.textContent = message;
}

function panelCanonicalItemAt(position) {
  return visibleSymbolsForActiveCategory()[position];
}

function panelCanonicalIdentity(tab, item) {
  return tab && item ? reorderItemKey(tab, item) : "";
}

function panelReorderingEnabled() {
  return !isSingleChartViewActive() && Boolean(PANEL_REORDER_HELPERS.enabledForCount?.(currentChartCount(), state.panels.length));
}

function refreshPanelReorderAffordances() {
  const enabled = panelReorderingEnabled();
  state.panels.forEach((panel, position) => {
    panel.setPosition?.(position);
    panel.setReorderEnabled?.(enabled);
  });
}

function panelRectangles() {
  return state.panels.map((panel) => panel.element.getBoundingClientRect());
}

function schedulePanelReorderLayoutRefresh() {
  if (state.panelReorderLayoutFrame) cancelAnimationFrame(state.panelReorderLayoutFrame);
  state.panelReorderLayoutFrame = requestAnimationFrame(() => {
    state.panelReorderLayoutFrame = 0;
    state.panels.forEach((panel) => panel.refreshPanelLayout?.());
  });
}

function reorderExistingPanelsByIdentity(orderedIdentities, { focusIdentity } = {}) {
  const currentIdentities = state.panels.map((panel) => panel.getCanonicalIdentity?.());
  if (!PANEL_REORDER_HELPERS.sameIdentitySet?.(currentIdentities, orderedIdentities)) return false;
  const byIdentity = new Map(state.panels.map((panel) => [panel.getCanonicalIdentity?.(), panel]));
  const reordered = orderedIdentities.map((identity) => byIdentity.get(identity));
  if (reordered.some((panel) => !panel)) return false;
  const grid = document.getElementById("chart-grid");
  const orderChanged = currentIdentities.some((identity, index) => identity !== orderedIdentities[index]);
  state.panels = reordered;
  reordered.forEach((panel, position) => {
    if (orderChanged) grid.appendChild(panel.element);
    panel.setPosition?.(position);
  });
  refreshPanelReorderAffordances();
  if (orderChanged) schedulePanelReorderLayoutRefresh();
  if (focusIdentity) requestAnimationFrame(() => byIdentity.get(focusIdentity)?.focusReorderHandle?.());
  exposeQuoteChartDebug();
  return true;
}

function refreshExistingPanelSymbolOptions() {
  state.panels.forEach((panel) => panel.refreshSymbolOptions?.(panel.getDisplaySymbol?.()));
}

function syncExistingPanelsToCanonicalOrder(tab) {
  if (!tab || tabIdentity(activeMarketTab()) !== tabIdentity(tab) || !state.panels.length) return false;
  const identities = visibleSymbolsForActiveCategory().map((item) => panelCanonicalIdentity(tab, item));
  const synced = identities.length === state.panels.length && reorderExistingPanelsByIdentity(identities);
  if (synced) refreshExistingPanelSymbolOptions();
  return synced;
}

function applyPanelReorder(fromIndex, toIndex, { keyboard = false } = {}) {
  if (!panelReorderingEnabled() || fromIndex === toIndex) return false;
  const tab = activeMarketTab();
  const page = activeCategoryPaginationState();
  const instruments = orderedInstrumentsForTab(tab);
  const fullIdentities = instruments.map((item) => panelCanonicalIdentity(tab, item));
  const visibleIdentities = state.panels.map((panel) => panel.getCanonicalIdentity?.());
  const movedIdentity = visibleIdentities[fromIndex];
  const nextVisible = PANEL_REORDER_HELPERS.moveItem?.(visibleIdentities, fromIndex, toIndex);
  const nextFull = PANEL_REORDER_HELPERS.replacePageSlice?.(fullIdentities, page.pageIndex, page.pageSize, nextVisible);
  if (!movedIdentity || !nextFull) return false;
  const itemByIdentity = new Map(instruments.map((item) => [panelCanonicalIdentity(tab, item), item]));
  const reorderedInstruments = nextFull.map((identity) => itemByIdentity.get(identity));
  if (reorderedInstruments.some((item) => !item)) return false;
  if (!reorderExistingPanelsByIdentity(nextVisible, { focusIdentity: keyboard ? movedIdentity : undefined })) return false;
  const movedPanel = state.panels.find((panel) => panel.getCanonicalIdentity?.() === movedIdentity);
  stageManagedInstrumentOrder(tab, reorderedInstruments, movedPanel?.getCanonicalSymbol?.(), { source: "panel" });
  refreshExistingPanelSymbolOptions();
  if (keyboard) state.panelReorderMetrics.keyboardMoves += 1;
  else state.panelReorderMetrics.drops += 1;
  setPanelReorderStatus(`${movedPanel?.getCanonicalSymbol?.() || "商品"} 已移到第 ${toIndex + 1} 位，正在儲存`);
  return true;
}

function panelDragStartAllowed(target) {
  if (target?.closest?.(".panel-reorder-handle")) return true;
  return !target?.closest?.("select, details, summary, button, input, textarea, a, [contenteditable='true'], .fixed-profile-controls, .fixed-profile-settings");
}

function startPanelDragCandidate(event, panel) {
  if (!panelReorderingEnabled() || event.button !== 0 || state.panelDrag || !panelDragStartAllowed(event.target)) return;
  const sourceIndex = state.panels.indexOf(panel);
  if (sourceIndex < 0) return;
  const drag = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    sourceIndex,
    targetIndex: sourceIndex,
    panel,
    origin: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    activated: false,
    rects: panelRectangles(),
    snapshotIdentities: state.panels.map((item) => item.getCanonicalIdentity?.()),
  };
  drag.onMove = (moveEvent) => handlePanelDragMove(moveEvent);
  drag.onUp = (upEvent) => finishPanelDrag(upEvent);
  drag.onCancel = () => cancelPanelDrag("pointercancel");
  drag.onBlur = () => cancelPanelDrag("blur");
  drag.onVisibility = () => { if (document.hidden) cancelPanelDrag("hidden"); };
  drag.onKeydown = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.preventDefault(); cancelPanelDrag("escape"); } };
  state.panelDrag = drag;
  drag.origin.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", drag.onMove, true);
  window.addEventListener("pointerup", drag.onUp, true);
  window.addEventListener("pointercancel", drag.onCancel, true);
  window.addEventListener("blur", drag.onBlur);
  window.addEventListener("resize", drag.onCancel, { passive: true });
  document.addEventListener("visibilitychange", drag.onVisibility);
  document.addEventListener("keydown", drag.onKeydown, true);
  exposeQuoteChartDebug();
}

function activatePanelDrag(drag) {
  drag.activated = true;
  const ghost = document.createElement("div");
  ghost.className = "panel-reorder-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = `${drag.panel.getCanonicalSymbol?.() || "商品"}｜${drag.panel.getDisplaySymbol?.() || "--"}`;
  const indicator = document.createElement("div");
  indicator.className = "panel-reorder-drop-indicator";
  indicator.setAttribute("aria-hidden", "true");
  document.body.append(ghost, indicator);
  drag.ghost = ghost;
  drag.indicator = indicator;
  drag.panel.element.classList.add("is-panel-drag-source");
  document.getElementById("chart-grid")?.classList.add("is-panel-reordering");
  setPanelReorderStatus(`正在移動 ${drag.panel.getCanonicalSymbol?.() || "商品"}，按 Escape 可取消`);
  updatePanelDragPreview(drag, drag.lastX, drag.lastY);
  exposeQuoteChartDebug();
}

function updatePanelDragPreview(drag, clientX, clientY) {
  if (!drag.activated) return;
  drag.ghost.style.transform = `translate3d(${Math.round(clientX + 14)}px, ${Math.round(clientY + 14)}px, 0)`;
  const targetIndex = PANEL_REORDER_HELPERS.targetIndexFromPoint?.(drag.rects, clientX, clientY);
  if (targetIndex < 0 || !drag.rects[targetIndex]) return;
  drag.targetIndex = targetIndex;
  const target = drag.rects[targetIndex];
  Object.assign(drag.indicator.style, {
    left: `${target.left}px`,
    top: `${target.top}px`,
    width: `${target.width}px`,
    height: `${target.height}px`,
  });
  drag.indicator.dataset.targetIndex = String(targetIndex);
}

function handlePanelDragMove(event) {
  const drag = state.panelDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
    if (drag.activated) finishPanelDrag(event); else cancelPanelDrag("button-release");
    return;
  }
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  if (!drag.activated && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= PANEL_DRAG_MOVEMENT_THRESHOLD_PX) activatePanelDrag(drag);
  if (!drag.activated) return;
  event.preventDefault();
  event.stopPropagation();
  updatePanelDragPreview(drag, event.clientX, event.clientY);
}

function panelDropIsValid(drag, event) {
  const grid = document.getElementById("chart-grid");
  const bounds = grid?.getBoundingClientRect();
  return Boolean(bounds
    && event.clientX >= bounds.left && event.clientX <= bounds.right
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom
    && drag.targetIndex >= 0 && drag.targetIndex < state.panels.length);
}

function finishPanelDrag(event) {
  const drag = state.panelDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.activated) {
    cleanupPanelDrag();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const valid = panelDropIsValid(drag, event);
  const sourceIndex = drag.sourceIndex;
  const targetIndex = drag.targetIndex;
  cleanupPanelDrag();
  state.panelDragSuppressUntil = Date.now() + PANEL_DRAG_CLICK_SUPPRESSION_MS;
  if (!valid) {
    state.panelReorderMetrics.cancels += 1;
    setPanelReorderStatus("已取消商品拖曳排序");
    exposeQuoteChartDebug();
    return;
  }
  if (!applyPanelReorder(sourceIndex, targetIndex)) setPanelReorderStatus("商品順序未變更");
}

function cancelPanelDrag(reason = "cancel") {
  const drag = state.panelDrag;
  if (!drag) return;
  const activated = drag.activated;
  cleanupPanelDrag();
  if (activated) {
    state.panelReorderMetrics.cancels += 1;
    state.panelDragSuppressUntil = Date.now() + PANEL_DRAG_CLICK_SUPPRESSION_MS;
    setPanelReorderStatus(reason === "context-change" ? "已因畫面切換取消商品拖曳" : "已取消商品拖曳排序");
    exposeQuoteChartDebug();
  }
}

function cleanupPanelDrag() {
  const drag = state.panelDrag;
  if (!drag) return;
  window.removeEventListener("pointermove", drag.onMove, true);
  window.removeEventListener("pointerup", drag.onUp, true);
  window.removeEventListener("pointercancel", drag.onCancel, true);
  window.removeEventListener("blur", drag.onBlur);
  window.removeEventListener("resize", drag.onCancel);
  document.removeEventListener("visibilitychange", drag.onVisibility);
  document.removeEventListener("keydown", drag.onKeydown, true);
  if (drag.origin.hasPointerCapture?.(drag.pointerId)) drag.origin.releasePointerCapture(drag.pointerId);
  drag.ghost?.remove();
  drag.indicator?.remove();
  drag.panel.element.classList.remove("is-panel-drag-source");
  document.getElementById("chart-grid")?.classList.remove("is-panel-reordering");
  state.panelDrag = undefined;
  exposeQuoteChartDebug();
}

function handlePanelReorderKeydown(event, panel) {
  const direction = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[event.key];
  if (!direction || !panelReorderingEnabled()) return;
  const currentIndex = state.panels.indexOf(panel);
  const targetIndex = PANEL_REORDER_HELPERS.keyboardTargetIndex?.(panelRectangles(), currentIndex, direction);
  if (targetIndex < 0 || targetIndex === currentIndex) return;
  event.preventDefault();
  event.stopPropagation();
  applyPanelReorder(currentIndex, targetIndex, { keyboard: true });
}

function quoteChartDebugMatrix() {
  return {
    marketTabs: state.marketTabs.map((tab) => tab.label),
    chartCounts: [...CHART_COUNTS],
    activeMarketTab: state.activeMarketTab,
    chartCount: Number(document.getElementById("chart-count")?.value || state.panels.length),
    singleChartView: state.singleChartView ? { ...state.singleChartView } : null,
    chartPresentationMode: state.chartPresentationMode,
    effectiveChartPresentationMode: effectiveChartPresentationMode(),
    mainReadoutMode: state.mainReadoutMode,
    panelReorder: {
      candidate: Boolean(state.panelDrag),
      active: Boolean(state.panelDrag?.activated),
      identities: state.panels.map((panel) => panel.getCanonicalIdentity?.()),
      metrics: { ...state.panelReorderMetrics },
      panelRenderGeneration: state.panelRenderGeneration,
      dataRequestCount: state.panelDataRequestCount,
      streamSubscriptionCount: state.panelStreamSubscriptionCount,
      foregroundRequestCount: state.foregroundPanelRequests,
      prefetchActiveCount: state.panelPrefetchActiveCount + state.panelLowPriorityPrefetchActiveCount,
    },
    realtimeConnectionCount: realtimeCoordinator.connectionCount(),
  };
}

function exposeQuoteChartDebug() {
  const debug = {
    measurePaneAlignment() {
      return publishQuoteChartDebugReport();
    },
    panelViewState() {
      return state.panels.map((panel) => panel.viewStateReport?.()).filter(Boolean);
    },
    chipReadoutGeometry() {
      return {
        matrix: quoteChartDebugMatrix(),
        panels: state.panels.map((panel, panelIndex) => ({
          panelIndex,
          panes: panel.chipReadoutGeometry?.() || [],
        })),
      };
    },
    matrix() {
      return quoteChartDebugMatrix();
    },
  };
  window.__quoteChartDebug = debug;
  document.documentElement.dataset.quoteChartDebugMatrix = JSON.stringify(debug.matrix());
}

function pausePanelStreamsForForegroundRequest() {
  state.foregroundPanelRequests += 1;
  state.panels.forEach((panel) => panel.pauseStream?.());
}

function resumePanelStreamsAfterForegroundRequest() {
  state.foregroundPanelRequests = Math.max(0, state.foregroundPanelRequests - 1);
  if (state.foregroundPanelRequests > 0) return;
  state.panels.forEach((panel) => panel.resumeStream?.());
}

async function fetchWithPausedPanelStreams(input, init) {
  pausePanelStreamsForForegroundRequest();
  try {
    return await fetch(input, init);
  } finally {
    resumePanelStreamsAfterForegroundRequest();
  }
}

function panelPayloadCacheKey(symbol, interval, pivotMode = null) {
  return `${String(symbol || "").trim().toUpperCase()}|${String(interval || "").trim()}|${indicatorParameterSignature()}|pivot:${pivotMode === "traditional" ? "traditional" : "off"}`;
}

function clonePanelPayload(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return undefined;
  }
}

function preparePanelPayload(payload) {
  if (!window.QuoteChartPayload?.preparePayload) {
    const error = new Error("圖表資料正規化元件未載入");
    error.code = "invalid-chart-payload";
    throw error;
  }
  return window.QuoteChartPayload.preparePayload(payload);
}

function mergeIndicatorPayload(current, incoming) {
  if (Array.isArray(incoming)) {
    if (incoming.every((item) => item && typeof item === "object" && Object.prototype.hasOwnProperty.call(item, "referencePeriodKey"))) {
      const merged = Array.isArray(current) ? current.map((item) => ({ ...item })) : [];
      const indexByReference = new Map(merged.map((item, index) => [item.referencePeriodKey, index]));
      incoming.forEach((item) => {
        const index = indexByReference.get(item.referencePeriodKey);
        if (index === undefined) {
          indexByReference.set(item.referencePeriodKey, merged.length);
          merged.push({ ...item });
        } else {
          merged[index] = { ...merged[index], ...item };
        }
      });
      return merged;
    }
    if (!incoming.every((item) => item && typeof item === "object" && Object.prototype.hasOwnProperty.call(item, "time"))) {
      return incoming.map((item) => item && typeof item === "object" ? { ...item } : item);
    }
    const merged = Array.isArray(current) ? current.map((item) => ({ ...item })) : [];
    const indexByTime = new Map(merged.map((item, index) => [JSON.stringify(item.time), index]));
    incoming.forEach((item) => {
      const key = JSON.stringify(item.time);
      const index = indexByTime.get(key);
      if (index === undefined) {
        indexByTime.set(key, merged.length);
        merged.push({ ...item });
      } else {
        merged[index] = { ...merged[index], ...item };
      }
    });
    return merged;
  }
  if (!incoming || typeof incoming !== "object") return incoming;
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return Object.fromEntries(Object.entries(incoming).map(([key, value]) => [key, mergeIndicatorPayload(base[key], value)]).concat(
    Object.entries(base).filter(([key]) => !Object.prototype.hasOwnProperty.call(incoming, key))
  ));
}

function readPanelPayloadCache(symbol, interval, pivotMode = null) {
  const key = panelPayloadCacheKey(symbol, interval, pivotMode);
  const cached = state.panelPayloadCache.get(key);
  if (!cached) return undefined;
  state.panelPayloadCache.delete(key);
  state.panelPayloadCache.set(key, cached);
  return clonePanelPayload(cached);
}

function writePanelPayloadCache(symbol, interval, payload, pivotMode = null) {
  let cloned;
  try {
    cloned = preparePanelPayload(payload);
  } catch {
    return false;
  }
  const key = panelPayloadCacheKey(symbol, interval, pivotMode);
  state.panelPayloadCache.delete(key);
  state.panelPayloadCache.set(key, cloned);
  while (state.panelPayloadCache.size > PANEL_PAYLOAD_CACHE_LIMIT) {
    const oldestKey = state.panelPayloadCache.keys().next().value;
    state.panelPayloadCache.delete(oldestKey);
  }
  return true;
}

function hasPanelPayloadCache(symbol, interval, pivotMode = null) {
  return state.panelPayloadCache.has(panelPayloadCacheKey(symbol, interval, pivotMode));
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json();
    return { response, payload };
  } catch (error) {
    if (timedOut || error?.name === "AbortError") {
      const timeoutError = new Error("資料載入逾時");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function formatLoadErrorMessage(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return "載入逾時，請稍後重新切回此頁或重新選取商品";
  }
  return error?.message || "資料載入失敗";
}

function isRetryableLoadError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

function cancelPanelPayloadPrefetch() {
  if (state.panelPrefetchTimer) {
    clearTimeout(state.panelPrefetchTimer);
    state.panelPrefetchTimer = 0;
  }
  if (state.panelLowPriorityPrefetchTimer) {
    clearTimeout(state.panelLowPriorityPrefetchTimer);
    state.panelLowPriorityPrefetchTimer = 0;
  }
  state.panelPrefetchGeneration += 1;
  state.panelPrefetchQueue = [];
  state.panelPrefetchQueuedKeys.clear();
  state.panelPrefetchInFlight.clear();
  state.panelPrefetchActiveCount = 0;
  state.panelLowPriorityPrefetchQueue = [];
  state.panelLowPriorityPrefetchQueuedKeys.clear();
  state.panelLowPriorityPrefetchInFlight.clear();
  state.panelLowPriorityPrefetchActiveCount = 0;
}

function scheduleAdjacentPagePrefetch() {
  if (state.panelPrefetchTimer) clearTimeout(state.panelPrefetchTimer);
  const generation = state.panelPrefetchGeneration;
  state.panelPrefetchTimer = window.setTimeout(() => {
    state.panelPrefetchTimer = 0;
    if (generation !== state.panelPrefetchGeneration) return;
    queuePanelPayloadPrefetch(adjacentCategoryPrefetchSymbols());
    scheduleNeighborTabFirstPagePrefetch();
  }, PREFETCH_ADJACENT_PAGE_DELAY_MS);
}

function adjacentCategoryPrefetchSymbols() {
  const current = activeCategoryPaginationState();
  if (current.pageCount <= 1) return [];
  const symbols = symbolsForActiveTab().map((item) => item.symbol);
  const interval = currentPanelPrefetchInterval();
  const candidates = [];
  [current.pageIndex + 1, current.pageIndex - 1].forEach((pageIndex) => {
    if (pageIndex < 0 || pageIndex >= current.pageCount) return;
    const page = categoryPaginationState(symbols, currentChartCount(), pageIndex);
    page.visibleSymbols.forEach((symbol) => {
      candidates.push({ symbol, interval });
    });
  });
  return candidates;
}

function scheduleNeighborTabFirstPagePrefetch() {
  if (state.panelLowPriorityPrefetchTimer) clearTimeout(state.panelLowPriorityPrefetchTimer);
  const generation = state.panelPrefetchGeneration;
  state.panelLowPriorityPrefetchTimer = window.setTimeout(() => {
    state.panelLowPriorityPrefetchTimer = 0;
    if (generation !== state.panelPrefetchGeneration) return;
    queueLowPriorityPanelPayloadPrefetch(neighborTabFirstPagePrefetchSymbols());
  }, PREFETCH_NEIGHBOR_TAB_FIRST_PAGE_DELAY_MS);
}

function neighborTabFirstPagePrefetchSymbols() {
  const activeTabId = state.activeMarketTabId || tabIdentity(activeMarketTab());
  const activeTabIndex = state.marketTabs.findIndex((tab) => tabIdentity(tab) === activeTabId);
  if (activeTabIndex < 0) return [];
  const interval = currentPanelPrefetchInterval();
  const candidates = [];
  [activeTabIndex - 1, activeTabIndex + 1].forEach((tabIndex) => {
    const tab = state.marketTabs[tabIndex];
    if (!tab) return;
    const symbols = symbolsForTab(tab).map((item) => item.symbol);
    const page = categoryPaginationState(symbols, currentChartCount(), 0);
    page.visibleSymbols.forEach((symbol) => {
      candidates.push({ symbol, interval });
    });
  });
  return candidates;
}

function currentPanelPrefetchInterval() {
  return document.querySelector(".chart-panel .interval-select")?.value || DEFAULT_INTERVAL;
}

function queuePanelPayloadPrefetch(jobs) {
  jobs.forEach((job) => {
    const key = panelPayloadCacheKey(job.symbol, job.interval);
    if (hasPanelPayloadCache(job.symbol, job.interval)) return;
    if (state.panelPrefetchInFlight.has(key)) return;
    if (state.panelPrefetchQueuedKeys.has(key)) return;
    state.panelPrefetchQueue.push({ ...job, key });
    state.panelPrefetchQueuedKeys.add(key);
  });
  drainPanelPayloadPrefetchQueue();
}

function drainPanelPayloadPrefetchQueue() {
  while (
    state.panelPrefetchActiveCount < MAX_PANEL_PREFETCH_CONCURRENCY
    && state.panelPrefetchQueue.length > 0
  ) {
    const job = state.panelPrefetchQueue.shift();
    state.panelPrefetchQueuedKeys.delete(job.key);
    if (hasPanelPayloadCache(job.symbol, job.interval)) continue;
    state.panelPrefetchActiveCount += 1;
    state.panelPrefetchInFlight.add(job.key);
    const generation = state.panelPrefetchGeneration;
    prefetchPanelPayload(job, generation).finally(() => {
      if (generation !== state.panelPrefetchGeneration) return;
      state.panelPrefetchActiveCount = Math.max(0, state.panelPrefetchActiveCount - 1);
      state.panelPrefetchInFlight.delete(job.key);
      drainPanelPayloadPrefetchQueue();
    });
  }
  if (state.panelPrefetchActiveCount === 0 && state.panelPrefetchQueue.length === 0) {
    drainLowPriorityPanelPayloadPrefetchQueue();
  }
}

function queueLowPriorityPanelPayloadPrefetch(jobs) {
  jobs.forEach((job) => {
    const key = panelPayloadCacheKey(job.symbol, job.interval);
    if (hasPanelPayloadCache(job.symbol, job.interval)) return;
    if (state.panelPrefetchInFlight.has(key) || state.panelPrefetchQueuedKeys.has(key)) return;
    if (state.panelLowPriorityPrefetchInFlight.has(key)) return;
    if (state.panelLowPriorityPrefetchQueuedKeys.has(key)) return;
    state.panelLowPriorityPrefetchQueue.push({ ...job, key });
    state.panelLowPriorityPrefetchQueuedKeys.add(key);
  });
  drainLowPriorityPanelPayloadPrefetchQueue();
}

function drainLowPriorityPanelPayloadPrefetchQueue() {
  if (state.panelPrefetchActiveCount > 0 || state.panelPrefetchQueue.length > 0) return;
  while (
    state.panelLowPriorityPrefetchActiveCount < MAX_LOW_PRIORITY_PANEL_PREFETCH_CONCURRENCY
    && state.panelLowPriorityPrefetchQueue.length > 0
  ) {
    const job = state.panelLowPriorityPrefetchQueue.shift();
    state.panelLowPriorityPrefetchQueuedKeys.delete(job.key);
    if (hasPanelPayloadCache(job.symbol, job.interval)) continue;
    state.panelLowPriorityPrefetchActiveCount += 1;
    state.panelLowPriorityPrefetchInFlight.add(job.key);
    const generation = state.panelPrefetchGeneration;
    prefetchPanelPayload(job, generation).finally(() => {
      if (generation !== state.panelPrefetchGeneration) return;
      state.panelLowPriorityPrefetchActiveCount = Math.max(0, state.panelLowPriorityPrefetchActiveCount - 1);
      state.panelLowPriorityPrefetchInFlight.delete(job.key);
      drainLowPriorityPanelPayloadPrefetchQueue();
    });
  }
}

async function prefetchPanelPayload(job, generation) {
  try {
    const { response, payload } = await fetchJsonWithTimeout(withIndicatorParameters(`/api/candles?symbol=${encodeURIComponent(job.symbol)}&interval=${encodeURIComponent(job.interval)}`), PANEL_PREFETCH_TIMEOUT_MS);
    if (generation !== state.panelPrefetchGeneration) return;
    if (!response.ok || payload.error) return;
    writePanelPayloadCache(job.symbol, job.interval, payload);
  } catch {
    // Background prefetch is best-effort and must not disturb the current page.
  }
}

function publishQuoteChartDebugReport() {
  const report = state.panels
    .map((panel) => panel.alignmentReport());
  document.documentElement.dataset.quoteChartDebugReport = JSON.stringify(report);
  document.documentElement.dataset.quoteChartDebugMatrix = JSON.stringify(quoteChartDebugMatrix());
  return report;
}

function openPanelInNewTab(panelElement, event) {
  if (Date.now() < state.panelDragSuppressUntil || currentChartCount() <= 1 || isPanelNewTabIgnoredTarget(event.target)) return;
  const panel = panelElement?.closest?.(".chart-panel") || panelElement;
  const symbol = panel?.querySelector(".symbol-select")?.value;
  const interval = panel?.querySelector(".interval-select")?.value;
  if (!symbol || !interval) return;
  event.preventDefault();
  const url = buildSingleChartUrl({ symbol, interval, tabId: state.activeMarketTabId });
  const openerPanels = [...state.panels];
  openerPanels.forEach((currentPanel) => currentPanel.pauseStream?.());
  const opened = window.open(url.href, "_blank", "noopener");
  if (opened) opened.opener = null;
  window.setTimeout(() => {
    openerPanels.forEach((currentPanel) => currentPanel.resumeStream?.());
  }, SINGLE_CHART_OPEN_STREAM_RESUME_DELAY_MS);
}

function normalizeChartPresentationMode(value) {
  return Object.values(CHART_PRESENTATION_MODES).includes(value) ? value : null;
}

function readChartPresentationMode(storage) {
  const current = normalizeChartPresentationMode(storage?.getItem(CHART_PRESENTATION_MODE_KEY));
  if (current) return current;
  const legacy = storage?.getItem(COMPACT_SUBCHART_MODE_KEY);
  if (legacy === "A") return CHART_PRESENTATION_MODES.single;
  if (legacy === "B") return CHART_PRESENTATION_MODES.multi;
  return CHART_PRESENTATION_MODES.single;
}

function writeChartPresentationMode(storage, mode) {
  const normalized = normalizeChartPresentationMode(mode);
  if (!normalized) return false;
  storage?.setItem(CHART_PRESENTATION_MODE_KEY, normalized);
  if (normalized === CHART_PRESENTATION_MODES.single) storage?.setItem(COMPACT_SUBCHART_MODE_KEY, "A");
  if (normalized === CHART_PRESENTATION_MODES.multi) storage?.setItem(COMPACT_SUBCHART_MODE_KEY, "B");
  return true;
}

function isTaiwanStockSymbol(symbol) {
  return /\.TW(O)?$/.test(canonicalSymbol(symbol));
}

function isTaiwanRealtimeSymbol(symbol) {
  const normalized = canonicalSymbol(symbol);
  return isTaiwanStockSymbol(normalized) || normalized === "^TWII";
}

function isTaiwanMultiLayerCompatibleSymbol(symbol) {
  const normalized = canonicalSymbol(symbol);
  return isTaiwanStockSymbol(normalized) || ["^TWII"].includes(normalized);
}

function singleSubchartOnlyChartCount(chartCount = currentChartCount()) {
  return Number(chartCount) === 6 || Number(chartCount) === 8;
}

function activeTabSupportsMultiLayerSubcharts() {
  if (singleSubchartOnlyChartCount()) return false;
  if (currentChartCount() === 1 && state.singleChartView?.symbol) return isTaiwanStockSymbol(state.singleChartView.symbol);
  const symbols = symbolsForActiveTab().map((item) => item?.symbol).filter(Boolean);
  return symbols.length > 0 && symbols.every(isTaiwanMultiLayerCompatibleSymbol);
}

function effectiveChartPresentationMode(symbol = "") {
  if (singleSubchartOnlyChartCount()) return CHART_PRESENTATION_MODES.single;
  const preferred = normalizeChartPresentationMode(state.chartPresentationMode) || CHART_PRESENTATION_MODES.single;
  if (preferred !== CHART_PRESENTATION_MODES.multi) return preferred;
  if (symbol && !isTaiwanStockSymbol(symbol)) return CHART_PRESENTATION_MODES.single;
  return activeTabSupportsMultiLayerSubcharts() ? CHART_PRESENTATION_MODES.multi : CHART_PRESENTATION_MODES.single;
}

function updatePageScrollLayout() {
  const grid = document.getElementById("chart-grid");
  const enabled = effectiveChartPresentationMode() === CHART_PRESENTATION_MODES.multi;
  document.body.classList.toggle("is-mode-b-page-scroll", enabled);
  grid?.classList.toggle("is-mode-b-page-scroll", enabled);
  grid?.classList.toggle("is-mode-b-four-up", enabled && currentChartCount() === 4);
}

function chartInteractionOptions(mode = effectiveChartPresentationMode()) {
  return window.QuoteChartInteractions.chartInteractionOptions(mode);
}

function updateChipModeControl() {
  const select = document.getElementById("compact-subchart-mode");
  updatePageScrollLayout();
  if (!select) return;
  const singleOnly = singleSubchartOnlyChartCount();
  const mainOption = select.querySelector('option[value="main"]');
  const multiOption = select.querySelector('option[value="multi"]');
  const multiDisabled = singleOnly || !activeTabSupportsMultiLayerSubcharts();
  select.value = effectiveChartPresentationMode();
  select.disabled = false;
  select.setAttribute("aria-disabled", "false");
  select.title = "";
  if (mainOption) {
    mainOption.disabled = singleOnly;
    mainOption.title = singleOnly ? "6／8 圖固定使用單一副圖" : "";
  }
  if (multiOption) {
    multiOption.disabled = multiDisabled;
    multiOption.title = singleOnly
      ? "6／8 圖固定使用單一副圖"
      : multiDisabled ? "只有全台股頁籤或台股單一商品可使用多層副圖" : "";
  }
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape") {
    state.panels.forEach((panel) => panel.cancelFixedProfileDrawing?.());
  }
}

function isPanelNewTabIgnoredTarget(target) {
  return Boolean(target?.closest('select, input, button, summary, details, a, [role="menu"], [contenteditable="true"]'));
}

function createLifecycleRegistry(options = {}) {
  const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : () => true;
  const requestFrame = options.requestFrame || ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || ((id) => window.cancelAnimationFrame(id));
  const setTimer = options.setTimer || ((callback, delay) => window.setTimeout(callback, delay));
  const clearTimer = options.clearTimer || ((id) => window.clearTimeout(id));
  const frames = new Set();
  const timers = new Set();
  const cleanups = new Set();
  let disposed = false;

  const active = () => !disposed && isCurrent();

  return {
    isActive: active,
    requestFrame(callback) {
      if (!active()) return 0;
      let id = 0;
      id = requestFrame(() => {
        frames.delete(id);
        if (active()) callback();
      });
      frames.add(id);
      return id;
    },
    cancelFrame(id) {
      if (!id) return;
      frames.delete(id);
      cancelFrame(id);
    },
    setTimer(callback, delay) {
      if (!active()) return 0;
      let id = 0;
      id = setTimer(() => {
        timers.delete(id);
        if (active()) callback();
      }, delay);
      timers.add(id);
      return id;
    },
    clearTimer(id) {
      if (!id) return;
      timers.delete(id);
      clearTimer(id);
    },
    addCleanup(cleanup) {
      if (typeof cleanup !== "function") return () => {};
      if (!active()) {
        cleanup();
        return () => {};
      }
      cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      frames.forEach((id) => cancelFrame(id));
      timers.forEach((id) => clearTimer(id));
      frames.clear();
      timers.clear();
      [...cleanups].reverse().forEach((cleanup) => cleanup());
      cleanups.clear();
      return true;
    },
  };
}

function createPanel(index, renderGeneration = state.panelRenderGeneration) {
  const template = document.getElementById("chart-panel-template");
  const element = template.content.firstElementChild.cloneNode(true);
  let panelPosition = index;
  let canonicalItem = panelCanonicalItemAt(index);
  let canonicalIdentity = panelCanonicalIdentity(activeMarketTab(), canonicalItem);
  let canonicalItemSymbol = canonicalItem?.symbol || defaultSymbolForPanel(index);
  const panelSubscriptionId = `panel-${renderGeneration}-${index}`;
  let controller;
  element.dataset.panelIndex = String(panelPosition);
  element.dataset.canonicalIdentity = canonicalIdentity;
  const symbolSelect = element.querySelector(".symbol-select");
  const intervalSelect = element.querySelector(".interval-select");
  const indicatorMenus = [...element.querySelectorAll(".indicator-menu")];
  const subIndicatorMenu = element.querySelector(".sub-indicator-menu");
  const subIndicatorMenuSummary = subIndicatorMenu?.querySelector("summary");
  const mainIndicatorInputs = [...element.querySelectorAll(".main-indicator")];
  const subIndicatorInputs = [...element.querySelectorAll(".sub-indicator")];
  const indicatorSettingsTrigger = element.querySelector(".indicator-settings-trigger");
  const chipIndicatorInputs = [...element.querySelectorAll(".chip-indicator")];
  const chipGroupInputs = [...element.querySelectorAll(".chip-group-indicator")];
  const chipIndicatorOptions = element.querySelector(".chip-indicator-options");
  const surface = element.querySelector(".chart-surface");
  const subchartSlot = element.querySelector(".subchart-slot");
  const indicatorSurface = element.querySelector(".indicator-chart");
  const chipPaneStack = element.querySelector(".chip-pane-stack");
  const chipPaneNotice = element.querySelector(".chip-pane-notice");
  const chipPaneEmpty = element.querySelector(".chip-pane-empty");
  const chipPaneNoticeClose = element.querySelector(".chip-pane-notice-close");
  const profileOverlay = element.querySelector(".profile-overlay");
  const fixedProfileOverlay = element.querySelector(".fixed-profile-overlay");
  const chartAnnotationLayer = element.querySelector(".chart-annotation-layer");
  const pivotPointLayer = element.querySelector(".pivot-point-layer");
  const priceExtremaLayer = element.querySelector(".price-extrema-layer");
  const profileSummary = element.querySelector(".profile-summary");
  const fvgLayer = element.querySelector(".fvg-layer");
  const peRiverLayer = element.querySelector(".pe-river-layer");
  const peRiverStatus = element.querySelector(".pe-river-status");
  const fixedProfileControls = element.querySelector(".fixed-profile-controls");
  const fixedProfileTool = element.querySelector(".fixed-profile-tool");
  const fixedProfileSettingsToggle = element.querySelector(".fixed-profile-settings-toggle");
  const fixedProfileDeleteSelected = element.querySelector(".fixed-profile-delete-selected");
  const fixedProfileClear = element.querySelector(".fixed-profile-clear");
  const fixedProfileSettingsPanel = element.querySelector(".fixed-profile-settings");
  const fixedProfileRangeList = element.querySelector(".fixed-profile-range-list");
  const fixedProfileRowCount = element.querySelector(".fixed-profile-row-count");
  const fixedProfileValueArea = element.querySelector(".fixed-profile-value-area");
  const chartToolButtons = [...element.querySelectorAll(".chart-tool-button")];
  const chartToolClear = element.querySelector(".chart-tool-clear");
  const mainReadoutModeSelect = element.querySelector(".main-readout-mode-select");
  const status = element.querySelector(".panel-status");
  const priceStrip = element.querySelector(".price-strip");
  const panelReorderHandle = element.querySelector(".panel-reorder-handle");
  const priceLabel = element.querySelector(".price-label");
  const priceValue = element.querySelector(".price-value");
  const priceDirection = element.querySelector(".price-direction");
  const priceChange = element.querySelector(".price-change");
  const priceChangePercent = element.querySelector(".price-change-percent");
  const quoteTimeStrip = element.querySelector(".quote-time-strip");
  const mainReadout = element.querySelector(".main-readout");
  const pivotPointReset = element.querySelector(".pivot-point-reset");
  const volumeAvailabilityNote = element.querySelector(".volume-availability-note");
  const subReadout = element.querySelector(".sub-readout");
  const panelCrosshairLine = element.querySelector(".panel-crosshair-line");
  const panelCrosshairDate = element.querySelector(".panel-crosshair-date");
  let chart;
  let indicatorChart;
  let candleSeries;
  let fibonacciAutoScaleLowerSeries;
  let fibonacciAutoScaleUpperSeries;
  let fibonacciAutoScaleSignature = "";
  let pivotAutoScaleLowerSeries;
  let pivotAutoScaleUpperSeries;
  let pivotAutoScaleSignature = "";
  let fibonacciCrosshairMarkersHidden = false;
  let volumeSeries;
  let intradayPriceSeries;
  let intradayAverageSeries;
  let intradayPreviousCloseSeries;
  let intradayAccumulator;
  let pendingIntradaySession = [];
  let volumeMovingAverageSeries = [];
  let bollingerSeries = [];
  let movingAverageSeries = [];
  let pivotProjectionByPeriod = new Map();
  let pivotTargetPeriodByTime = new Map();
  let pivotSelectedReferenceKey;
  let pivotSelectedAnchorTime;
  let pivotSelectionPinned = false;
  let estimatedMarginCostSeries;
  let estimatedMarginRowsByDate = new Map();
  let estimatedMarginAbortController;
  let estimatedMarginRequestId = 0;
  let lineSeries = [];
  let mainLineCrosshairMarkerDefaults = new Map();
  let indicatorSeries = [];
  let indicatorSeriesByKey = new Map();
  let indicatorSelectionSignature = "";
  let indicatorSeriesPointCounts = {};
  let indicatorRenderToken = 0;
  let indicatorRecoveryCount = 0;
  let indicatorTimeAnchorSeries;
  let chipPaneManager;
  let subchartPresentation = { mode: CHART_PRESENTATION_MODES.single, modeASlotKind: "technical", paneIds: [] };
  let eventSource;
  let liveUpdateCleanup;
  let realtimeUpdateCleanup;
  let canonicalPayload = null;
  let latestRealtimeSnapshot = null;
  let realtimeDisplayState = "unavailable";
  let lastPayload = null;
  let lastPayloadRenderSignature = "";
  let destroyed = false;
  const panelLifecycle = createLifecycleRegistry({
    isCurrent: () => state.panelRenderGeneration === renderGeneration,
  });
  const isPanelActive = () => !destroyed && panelLifecycle.isActive();
  const realtimeIndicatorScheduler = window.QuoteChartRealtimeIndicators.createLatestWinsScheduler({ delay: 150 });
  let loadToken = 0;
  let overlayFrame = 0;
  let subchartPresentationFrame = 0;
  let timeScaleFitFrame = 0;
  let timeScaleSyncReleaseFrame = 0;
  let panelLayoutFrame = 0;
  let pendingPanelViewportSnapshot;
  let alignmentFrame = 0;
  let axisSafeWidthFrame = 0;
  let annotationRenderFrame = 0;
  let crosshairRenderFrame = 0;
  let panelLoadRetryTimer = 0;
  let priceScaleMinWidth = SHARED_PRICE_SCALE_MIN_WIDTH;
  let isSyncingTimeScale = false;
  let isSyncingCrosshair = false;
  let historyLoadTimer = 0;
  let priceUpdateTimer = 0;
  let lastRenderedPrice;
  let quoteTimeFitFrame = 0;
  let historyLoadInFlight = false;
  let historyHasMoreBefore = true;
  let historyInteractionArmed = false;
  let sharedHoverTime;
  let pendingSharedHoverTime;
  let resizeObserver;
  let overlayHooksAttached = false;
  let mainWheelRoutingCleanup;
  let indicatorWheelRoutingCleanup;
  let fixedProfileState = FIXED_PROFILE_STATES.idle;
  let fixedProfileFirstTime;
  let fixedProfileRanges = [];
  let selectedFixedProfileId;
  let fixedProfileDragState;
  let fixedProfileNextId = 1;
  let fixedProfileLastError = "";
  let fixedProfileSettings = defaultFixedProfileSettings();
  const panelContextMenu = document.createElement("div");
  panelContextMenu.className = "panel-context-menu";
  panelContextMenu.setAttribute("role", "menu");
  panelContextMenu.setAttribute("aria-label", "商品線圖功能表");
  panelContextMenu.hidden = true;
  panelContextMenu.dataset.exportExclude = "true";
  const panelExportAction = document.createElement("button");
  panelExportAction.type = "button";
  panelExportAction.setAttribute("role", "menuitem");
  panelExportAction.textContent = "儲存此商品所有線圖為圖片";
  panelContextMenu.appendChild(panelExportAction);
  const panelOrderAction = document.createElement("button");
  panelOrderAction.type = "button";
  panelOrderAction.setAttribute("role", "menuitem");
  panelOrderAction.textContent = "下單";
  panelOrderAction.disabled = true;
  panelContextMenu.appendChild(panelOrderAction);
  const panelRemoveTechnicalAction = document.createElement("button");
  panelRemoveTechnicalAction.type = "button";
  panelRemoveTechnicalAction.setAttribute("role", "menuitem");
  panelRemoveTechnicalAction.className = "panel-context-menu-remove-technical";
  panelRemoveTechnicalAction.textContent = "移除副圖";
  panelRemoveTechnicalAction.hidden = true;
  panelContextMenu.appendChild(panelRemoveTechnicalAction);
  const panelPeRiverDetailsAction = document.createElement("button");
  panelPeRiverDetailsAction.type = "button";
  panelPeRiverDetailsAction.setAttribute("role", "menuitem");
  panelPeRiverDetailsAction.setAttribute("aria-expanded", "false");
  panelPeRiverDetailsAction.className = "panel-context-menu-pe-river-action";
  panelPeRiverDetailsAction.textContent = "本益比河流圖詳細說明";
  panelPeRiverDetailsAction.hidden = true;
  panelContextMenu.appendChild(panelPeRiverDetailsAction);
  const panelPeRiverDetails = document.createElement("div");
  panelPeRiverDetails.className = "panel-context-menu-pe-river-details";
  panelPeRiverDetails.setAttribute("role", "note");
  panelPeRiverDetails.hidden = true;
  panelContextMenu.appendChild(panelPeRiverDetails);
  document.body.appendChild(panelContextMenu);
  let panelContextPointedDate = "";
  let panelOrderContract;
  let panelOrderResolveToken = 0;
  let panelExportAbortController;
  const peRiverController = window.QuoteChartPeRiver?.createController({
    layer: peRiverLayer,
    statusNode: peRiverStatus,
    getSymbol: () => symbolSelect.value,
    getInterval: () => intervalSelect.value,
    getChart: () => chart,
    getCandleSeries: () => candleSeries,
    getCandles: () => lastPayload?.candles || [],
    getLoadToken: () => loadToken,
    onSettled: () => {
      if (!isPanelActive()) return;
      state.panels.forEach((panel) => panel.resumeStream?.());
    },
  });
  const chartAnnotationController = window.QuoteChartAnnotations?.createController({
    getIdentity: () => `${String(symbolSelect.value || "").toUpperCase()}|${intervalSelect.value || ""}`,
    onChange: (annotationState) => {
      if (!isPanelActive()) return;
      updateFibonacciCrosshairMarkers(annotationState);
      updateFibonacciAutoScale(annotationState);
      renderChartAnnotations();
      if (annotationState.pending?.type === "fibonacci") status.textContent = `費波那契${annotationState.pending.kind === "retracement" ? "回撤" : "拓展"}：尚需 ${annotationState.pending.remaining} 個錨點`;
      if (annotationState.pending?.type === "priceRange") {
        status.textContent = annotationState.pending.anchors.length
          ? "價格範圍：請點選終點價格"
          : "價格範圍：請點選起點價格";
      }
    },
  });

  element.addEventListener("pointerenter", () => element.classList.add("is-hovered"));
  element.addEventListener("pointerleave", () => element.classList.remove("is-hovered"));
  element.addEventListener("dblclick", (event) => openPanelInNewTab(element, event));
  fillSymbolOptions(symbolSelect, defaultSymbolForPanel(panelPosition));
  fillIntervalOptions(intervalSelect, defaultIntervalForPanel(panelPosition), symbolSelect.value);
  chartAnnotationController?.restore();
  restoreIndicatorDefaults(mainIndicatorInputs, MAIN_INDICATOR_DEFAULTS);
  restoreIndicatorDefaults(subIndicatorInputs, SUB_INDICATOR_DEFAULTS);
  const cleanupIndicatorMenus = wireIndicatorMenus(indicatorMenus);
  refreshMainReadoutMode();

  chipPaneManager = window.QuoteChartChipPanes?.createChipPaneManager({
    panel: element,
    stack: chipPaneStack,
    notice: chipPaneNotice,
    emptyStatus: chipPaneEmpty,
    noticeClose: chipPaneNoticeClose,
    inputs: chipIndicatorInputs,
    groupInputs: chipGroupInputs,
    getAxisSafeWidth: () => getAxisSafeWidth(),
    getMainRange: () => chart?.timeScale().getVisibleLogicalRange?.(),
    onLayoutChange: (change = {}) => {
      if (!isPanelActive()) return;
      schedulePanelLayoutRefresh({ preserveViewport: Boolean(change?.preserveViewport) });
    },
    onRange: (range, _paneId, timeRange) => {
      if (!isPanelActive() || isSyncingTimeScale) return;
      if (isValidTimeRange(timeRange)) setSynchronizedVisibleTimeRange(timeRange, range);
      else syncVisibleLogicalRange(range, chart);
      scheduleAlignmentMeasurement();
    },
    onCrosshair: (pointer) => {
      if (!isPanelActive()) return;
      const time = sharedCandleTimeForScreenX(pointer?.screenX) || candleAt(pointer?.time)?.time;
      if (!time || !candleAt(time)) {
        clearSyncedCrosshair();
        return;
      }
      sharedHoverTime = time;
      syncCrosshairForTime(time);
    },
    onPresentationChange: (presentation) => {
      if (isPanelActive()) applySubchartPresentation(presentation);
    },
    onExport: ({ date } = {}) => exportPanelPng(date),
  });
  chipPaneManager?.setMode(effectivePanelSubchartMode());

  function effectivePanelSubchartMode() {
    return effectiveChartPresentationMode(symbolSelect.value);
  }

  function updateChipIndicatorOptionsAvailability() {
    if (!chipIndicatorOptions) return;
    chipIndicatorOptions.hidden = !window.QuoteChartChipPanes?.isEligibleContext(symbolSelect.value, intervalSelect.value);
  }

  updateChipIndicatorOptionsAvailability();

  function closePanelContextMenu() {
    panelOrderResolveToken += 1;
    panelContextMenu.hidden = true;
    panelRemoveTechnicalAction.hidden = true;
    panelPeRiverDetailsAction.hidden = true;
    panelPeRiverDetailsAction.setAttribute("aria-expanded", "false");
    panelPeRiverDetails.hidden = true;
    panelPeRiverDetails.replaceChildren();
  }

  async function refreshPanelOrderAction() {
    const token = ++panelOrderResolveToken;
    panelOrderContract = undefined;
    panelOrderAction.disabled = true;
    panelOrderAction.textContent = "下單（解析商品中…）";
    panelOrderAction.title = "";
    try {
      const contract = await resolveOrderBridgeContract(symbolSelect.value);
      if (token !== panelOrderResolveToken || panelContextMenu.hidden) return;
      panelOrderContract = contract;
      panelOrderAction.disabled = false;
      panelOrderAction.textContent = "下單";
      panelOrderAction.title = `${contract.code}・開啟 RealTimeStock 下單面板`;
    } catch (error) {
      if (token !== panelOrderResolveToken || panelContextMenu.hidden) return;
      panelOrderAction.disabled = true;
      panelOrderAction.textContent = "下單（不支援）";
      panelOrderAction.title = error?.message || "此商品不支援下單面板";
    }
  }

  function refreshPanelPeRiverDetails() {
    const pointedCandle = lastPayload?.candles?.find((item) => formatChartDate(item.time) === panelContextPointedDate);
    if (pointedCandle) peRiverController?.updateReadout(pointedCandle.time, pointedCandle.close);
    const lines = peRiverController?.getDetailLines?.() || [];
    panelPeRiverDetails.replaceChildren();
    lines.forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      panelPeRiverDetails.appendChild(paragraph);
    });
    panelPeRiverDetailsAction.hidden = lines.length === 0;
    panelPeRiverDetailsAction.setAttribute("aria-expanded", "false");
    panelPeRiverDetails.hidden = true;
  }

  function clampPanelContextMenuToViewport() {
    const rect = panelContextMenu.getBoundingClientRect();
    panelContextMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
    panelContextMenu.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8))}px`;
  }

  function openPanelContextMenu(clientX, clientY, pointedDate = "", showTechnicalRemove = false) {
    panelContextPointedDate = pointedDate || formatChartDate(sharedHoverTime) || formatChartDate(lastPayload?.candles?.at(-1)?.time);
    panelRemoveTechnicalAction.hidden = !showTechnicalRemove;
    refreshPanelPeRiverDetails();
    panelContextMenu.hidden = false;
    panelContextMenu.style.left = "0px";
    panelContextMenu.style.top = "0px";
    const rect = panelContextMenu.getBoundingClientRect();
    panelContextMenu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8))}px`;
    panelContextMenu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8))}px`;
    void refreshPanelOrderAction();
    panelExportAction.focus({ preventScroll: true });
  }

  function togglePanelPeRiverDetails() {
    const expanded = panelPeRiverDetails.hidden;
    panelPeRiverDetails.hidden = !expanded;
    panelPeRiverDetailsAction.setAttribute("aria-expanded", String(expanded));
    if (expanded) clampPanelContextMenuToViewport();
  }

  function pointedDateForPanelEvent(event) {
    const host = event.target?.closest?.(".chart-surface, .indicator-chart");
    if (!host || !element.contains(host)) return formatChartDate(sharedHoverTime);
    const time = sharedCandleTimeForScreenX(event.clientX);
    if (time && candleAt(time)) {
      sharedHoverTime = time;
      syncCrosshairForTime(time);
    }
    return formatChartDate(time || sharedHoverTime);
  }

  function chartPointForPanelEvent(event) {
    const host = event.target?.closest?.(".chart-surface");
    if (!host || host !== surface || !chart || !candleSeries) return undefined;
    const rect = surface.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rightEdge = surface.clientWidth - getAxisSafeWidth();
    const coordinateTime = chart.timeScale().coordinateToTime?.(x);
    const normalizedTime = normalizeChartTime(coordinateTime);
    const candle = candleAt(coordinateTime);
    const price = candleSeries.coordinateToPrice?.(y);
    const time = Number.isFinite(Number(normalizedTime)) ? Number(normalizedTime) : normalizeChartTime(candle?.time);
    if (!Number.isFinite(Number(time)) || !Number.isFinite(price) || x < 0 || x > rightEdge || y < 0 || y > surface.clientHeight) return undefined;
    const rawPoint = { time: Number(time), price: Number(price) };
    const pending = chartAnnotationController?.getState?.().pending;
    if (pending?.type !== "fibonacci") return rawPoint;
    return window.QuoteChartAnnotations?.resolveFibonacciAnchorPoint?.(pending, rawPoint, candle, event.altKey === true) || undefined;
  }

  function latestChartPoint() {
    const candle = lastPayload?.candles?.at(-1);
    const price = Number(candle?.close);
    return candle && Number.isFinite(price) ? { time: normalizeChartTime(candle.time), price } : undefined;
  }

  function handlePanelContextMenu(event) {
    if (event.target?.closest?.(".chip-pane-chart, .chip-pane-context-menu")) return;
    event.preventDefault();
    const fromTechnicalSubchart = Boolean(event.target?.closest?.(".indicator-wrap")) && isTechnicalSubchartVisible();
    openPanelContextMenu(event.clientX, event.clientY, pointedDateForPanelEvent(event), fromTechnicalSubchart);
  }

  function handlePanelContextKeydown(event) {
    if (event.target?.closest?.(".chip-pane-chart")) return;
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.target?.getBoundingClientRect?.() || element.getBoundingClientRect();
    const fromTechnicalSubchart = Boolean(event.target?.closest?.(".indicator-wrap")) && isTechnicalSubchartVisible();
    openPanelContextMenu(rect.left + Math.min(24, rect.width - 8), rect.top + Math.min(24, rect.height - 8), "", fromTechnicalSubchart, latestChartPoint());
  }

  function handlePanelContextPointerDown(event) {
    if (!panelContextMenu.hidden && !panelContextMenu.contains(event.target)) closePanelContextMenu();
  }

  function handlePanelContextKeydownGlobal(event) {
    if (event.key !== "Escape") return;
    if (chartAnnotationController?.cancel()) {
      event.preventDefault();
      status.textContent = "主圖繪圖已取消";
      return;
    }
    if (!panelContextMenu.hidden) {
      event.preventDefault();
      closePanelContextMenu();
    }
  }

  async function exportPanelPng(pointedDate = panelContextPointedDate) {
    closePanelContextMenu();
    for (const menu of indicatorMenus) menu.open = false;
    panelExportAbortController?.abort();
    panelExportAbortController = new AbortController();
    panelExportAction.disabled = true;
    panelExportAction.textContent = "正在產生圖片…";
    if (pointedDate) {
      const candle = lastPayload?.candles?.find((item) => formatChartDate(item.time) === pointedDate);
      if (candle) {
        sharedHoverTime = candle.time;
        syncCrosshairForTime(candle.time);
      }
    }
    try {
      return await window.QuoteChartPanelImageExporter?.exportPanelImage({
        panel: element,
        symbol: symbolSelect.value,
        interval: intervalSelect.value,
        pointedDate,
        signal: panelExportAbortController.signal,
      });
    } finally {
      panelExportAction.disabled = false;
      panelExportAction.textContent = "儲存此商品所有線圖為圖片";
    }
  }

  function handlePanelExportClick() {
    exportPanelPng().catch((error) => {
      if (error?.name === "AbortError") return;
      status.textContent = `圖片儲存失敗：${error?.message || "請稍後再試"}`;
    });
  }

  function handlePanelOrderClick() {
    if (!panelOrderContract) return;
    const popup = window.open(orderBridgeUrl(panelOrderContract), `realtimestock-ticket-${panelOrderContract.code}`);
    if (!popup) {
      status.textContent = "瀏覽器已阻擋下單面板彈出視窗；請允許 127.0.0.1:5174 開啟視窗後重試";
      status.classList.add("is-visible");
      return;
    }
    try { popup.opener = null; popup.focus(); } catch { /* cross-origin redirect may already have started */ }
    closePanelContextMenu();
  }

  function handleRemoveTechnicalSubchart() {
    closePanelContextMenu();
    let changed = false;
    subIndicatorInputs.forEach((input) => {
      if (!input.checked) return;
      input.checked = false;
      changed = true;
    });
    if (!changed) return;
    applySubchartPresentation(subchartPresentation);
    if (lastPayload && !destroyed) applyPayload(lastPayload);
  }

  element.addEventListener("contextmenu", handlePanelContextMenu);
  element.addEventListener("keydown", handlePanelContextKeydown);
  panelExportAction.addEventListener("click", handlePanelExportClick);
  panelOrderAction.addEventListener("click", handlePanelOrderClick);
  panelRemoveTechnicalAction.addEventListener("click", handleRemoveTechnicalSubchart);
  panelPeRiverDetailsAction.addEventListener("click", togglePanelPeRiverDetails);
  document.addEventListener("pointerdown", handlePanelContextPointerDown, true);
  document.addEventListener("keydown", handlePanelContextKeydownGlobal, true);
  window.addEventListener("blur", closePanelContextMenu);

  symbolSelect.addEventListener("change", () => {
    const selectedInterval = intervalSelect.value;
    fillIntervalOptions(intervalSelect, selectedInterval, symbolSelect.value);
    updatePanelReorderLabel();
    chipPaneManager?.setMode(effectivePanelSubchartMode());
    chartAnnotationController?.restore();
    load();
  });
  intervalSelect.addEventListener("change", () => {
    chartAnnotationController?.restore();
    load();
  });
  chartToolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.chartTool === "price-range") {
        if (!chartAnnotationController?.armPriceRange()) return;
        status.textContent = "價格範圍：請點選起點價格";
        for (const menu of indicatorMenus) menu.open = false;
        return;
      }
      const kind = button.dataset.chartTool === "retracement" ? "retracement" : "extension";
      if (!chartAnnotationController?.armFibonacci(kind)) return;
      status.textContent = `費波那契${kind === "retracement" ? "回撤" : "拓展"}：請點選第 1 個錨點`;
      for (const menu of indicatorMenus) menu.open = false;
    });
  });
  chartToolClear?.addEventListener("click", () => {
    chartAnnotationController?.clear("all");
    status.textContent = "主圖繪圖與價格範圍已清除";
  });
  mainReadoutModeSelect?.addEventListener("change", () => {
    setMainReadoutMode(mainReadoutModeSelect.value);
  });
  pivotPointReset?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectDefaultPivotProjection();
  });
  mainIndicatorInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value === "peRiver") {
        if (input.checked) state.panels.forEach((panel) => panel.pauseStream?.());
        if (input.checked) {
          panelLifecycle.setTimer(() => {
            if (isPanelActive() && input.checked) peRiverController?.setEnabled(true);
          }, 100);
        } else {
          peRiverController?.setEnabled(false);
        }
        return;
      }
      if (input.value === "estimatedMarginCost") {
        localStorage.setItem(estimatedMarginCostStorageKey(symbolSelect.value), String(input.checked));
      }
      if (input.value === "pivotPoint") {
        refreshPivotPointSelection();
        return;
      }
      if (lastPayload && !destroyed) applyPayload(lastPayload);
    });
  });
  subIndicatorInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (effectivePanelSubchartMode() === CHART_PRESENTATION_MODES.single) chipPaneManager?.activateTechnicalSlot();
      applySubchartPresentation(subchartPresentation);
      if (lastPayload && !destroyed) applyPayload(lastPayload);
    });
  });
  indicatorSettingsTrigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    for (const menu of indicatorMenus) menu.open = false;
    openIndicatorSettingsDialog();
  });
  fixedProfileTool.addEventListener("click", toggleFixedProfileDrawing);
  fixedProfileSettingsToggle.addEventListener("click", toggleFixedProfileSettingsPanel);
  fixedProfileDeleteSelected.addEventListener("click", deleteSelectedFixedProfileRange);
  fixedProfileClear.addEventListener("click", () => clearFixedRangeVolumeProfile());
  fixedProfileRowCount.addEventListener("change", updateFixedProfileCalculationSettings);
  fixedProfileValueArea.addEventListener("change", updateFixedProfileCalculationSettings);
  surface.addEventListener("click", handleFixedProfileSurfaceClick);
  updateFixedProfileToolAvailability();

  function hasSelectedTechnicalIndicators() {
    return subIndicatorInputs.some((input) => input.checked);
  }

  function isTechnicalSubchartVisible() {
    return subchartPresentation.mode !== CHART_PRESENTATION_MODES.main
      && hasSelectedTechnicalIndicators()
      && (subchartPresentation.mode === CHART_PRESENTATION_MODES.multi || subchartPresentation.modeASlotKind === "technical");
  }

  function applySubchartPresentation(next = {}) {
    const mode = normalizeChartPresentationMode(next.mode)
      || (next.mode === "B" ? CHART_PRESENTATION_MODES.multi : CHART_PRESENTATION_MODES.single);
    const modeASlotKind = next.modeASlotKind === "technical" ? "technical" : "chip";
    const paneIds = Array.isArray(next.paneIds) ? [...next.paneIds] : [...(subchartPresentation.paneIds || [])];
    const hasTechnical = hasSelectedTechnicalIndicators();
    const hasChipPanes = paneIds.length > 0;
    subchartPresentation = { mode, modeASlotKind, paneIds };
    subchartSlot.dataset.subchartMode = mode;
    subchartSlot.dataset.modeASlotKind = modeASlotKind;
    subchartSlot.classList.toggle("has-technical-subchart", hasTechnical);
    subchartSlot.classList.toggle("is-mode-b", mode === CHART_PRESENTATION_MODES.multi);
    subchartSlot.classList.toggle("is-mode-a-technical", mode === CHART_PRESENTATION_MODES.single && modeASlotKind === "technical");
    subchartSlot.classList.toggle("is-mode-a-chip", mode === CHART_PRESENTATION_MODES.single && modeASlotKind === "chip");
    subchartSlot.classList.toggle("is-mode-main", mode === CHART_PRESENTATION_MODES.main);
    element.classList.toggle("has-no-subchart", mode === CHART_PRESENTATION_MODES.main
      || (mode === CHART_PRESENTATION_MODES.single
        ? modeASlotKind === "technical" ? !hasTechnical : !hasChipPanes
        : !hasTechnical && !hasChipPanes));
    const mainOnly = mode === CHART_PRESENTATION_MODES.main;
    if (subIndicatorMenu) {
      if (mainOnly) subIndicatorMenu.open = false;
      subIndicatorMenu.toggleAttribute("inert", mainOnly);
      subIndicatorMenu.classList.toggle("is-disabled", mainOnly);
      subIndicatorMenu.setAttribute("aria-disabled", String(mainOnly));
    }
    if (subIndicatorMenuSummary) {
      subIndicatorMenuSummary.setAttribute("aria-disabled", String(mainOnly));
      subIndicatorMenuSummary.tabIndex = mainOnly ? -1 : 0;
      subIndicatorMenuSummary.title = mainOnly ? "請先切換至單一副圖或多層副圖" : "";
    }
    const interactions = chartInteractionOptions(mode);
    chart?.applyOptions(interactions);
    indicatorChart?.applyOptions(interactions);
    chipPaneManager?.setInteractionMode(mode);
    if (subchartPresentationFrame) panelLifecycle.cancelFrame(subchartPresentationFrame);
    subchartPresentationFrame = panelLifecycle.requestFrame(() => {
      subchartPresentationFrame = 0;
      if (!isPanelActive() || !chart) return;
      if (mainOnly) {
        try { indicatorChart?.clearCrosshairPosition?.(); } catch {}
      } else if (isTechnicalSubchartVisible() && indicatorChart) {
        indicatorChart.resize(indicatorSurface.clientWidth, indicatorSurface.clientHeight);
        syncIndicatorVisibleRangeToMain();
      } else {
        chipPaneManager?.resize();
        chipPaneManager?.syncRange(chart.timeScale().getVisibleLogicalRange?.());
      }
      schedulePanelLayoutRefresh();
      scheduleAlignmentMeasurement();
    });
  }

  function refreshSymbolOptions(preferredSymbol = symbolSelect.value) {
    const fallback = defaultSymbolForPanel(panelPosition);
    const options = visibleSymbolsForActiveCategory();
    const nextSymbol = options.some((item) => item.symbol === preferredSymbol) ? preferredSymbol : fallback;
    fillSymbolOptions(symbolSelect, nextSymbol);
    fillIntervalOptions(intervalSelect, intervalSelect.value, nextSymbol);
    updateLatestPriceInstrumentLabel(nextSymbol, priceLabel.dataset.sessionLabel || "");
    return nextSymbol !== preferredSymbol;
  }

  function applyOrderedSymbol(nextSymbol = defaultSymbolForPanel(panelPosition)) {
    const previousSymbol = symbolSelect.value;
    fillSymbolOptions(symbolSelect, nextSymbol);
    fillIntervalOptions(intervalSelect, intervalSelect.value, symbolSelect.value);
    updateLatestPriceInstrumentLabel(symbolSelect.value, priceLabel.dataset.sessionLabel || "");
    return symbolSelect.value !== previousSymbol;
  }

  function resetCharts() {
    finishFixedProfileDrag();
    if (eventSource) {
      eventSource.close();
      eventSource = undefined;
    }
    liveUpdateCleanup?.();
    liveUpdateCleanup = undefined;
    realtimeUpdateCleanup?.();
    realtimeUpdateCleanup = undefined;
    if (overlayFrame) {
      panelLifecycle.cancelFrame(overlayFrame);
      overlayFrame = 0;
    }
    if (subchartPresentationFrame) {
      panelLifecycle.cancelFrame(subchartPresentationFrame);
      subchartPresentationFrame = 0;
    }
    cancelScheduledTimeScaleRefit();
    if (historyLoadTimer) {
      panelLifecycle.clearTimer(historyLoadTimer);
      historyLoadTimer = 0;
    }
    if (panelLayoutFrame) {
      panelLifecycle.cancelFrame(panelLayoutFrame);
      panelLayoutFrame = 0;
    }
    pendingPanelViewportSnapshot = undefined;
    if (quoteTimeFitFrame) {
      panelLifecycle.cancelFrame(quoteTimeFitFrame);
      quoteTimeFitFrame = 0;
    }
    if (alignmentFrame) {
      panelLifecycle.cancelFrame(alignmentFrame);
      alignmentFrame = 0;
    }
    if (axisSafeWidthFrame) {
      panelLifecycle.cancelFrame(axisSafeWidthFrame);
      axisSafeWidthFrame = 0;
    }
    if (annotationRenderFrame) {
      panelLifecycle.cancelFrame(annotationRenderFrame);
      annotationRenderFrame = 0;
    }
    if (crosshairRenderFrame) {
      panelLifecycle.cancelFrame(crosshairRenderFrame);
      crosshairRenderFrame = 0;
    }
    if (timeScaleSyncReleaseFrame) {
      panelLifecycle.cancelFrame(timeScaleSyncReleaseFrame);
      timeScaleSyncReleaseFrame = 0;
    }
    if (priceUpdateTimer) {
      panelLifecycle.clearTimer(priceUpdateTimer);
      priceUpdateTimer = 0;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = undefined;
    }
    mainWheelRoutingCleanup?.();
    mainWheelRoutingCleanup = undefined;
    indicatorWheelRoutingCleanup?.();
    indicatorWheelRoutingCleanup = undefined;
    const chartToRemove = chart;
    const indicatorChartToRemove = indicatorChart;
    chart = undefined;
    indicatorChart = undefined;
    try { chartToRemove?.unsubscribeCrosshairMove?.(handleCrosshairMove); } catch {}
    try { chartToRemove?.timeScale?.().unsubscribeVisibleLogicalRangeChange?.(handleMainVisibleLogicalRangeChange); } catch {}
    try { indicatorChartToRemove?.unsubscribeCrosshairMove?.(handleIndicatorCrosshairMove); } catch {}
    try { indicatorChartToRemove?.timeScale?.().unsubscribeVisibleLogicalRangeChange?.(handleIndicatorVisibleLogicalRangeChange); } catch {}
    indicatorChartToRemove?.remove?.();
    chartToRemove?.remove?.();
    candleSeries = undefined;
    fibonacciAutoScaleLowerSeries = undefined;
    fibonacciAutoScaleUpperSeries = undefined;
    fibonacciAutoScaleSignature = "";
    pivotAutoScaleLowerSeries = undefined;
    pivotAutoScaleUpperSeries = undefined;
    pivotAutoScaleSignature = "";
    volumeSeries = undefined;
    intradayPriceSeries = undefined;
    intradayAverageSeries = undefined;
    intradayPreviousCloseSeries = undefined;
    intradayAccumulator = undefined;
    pendingIntradaySession = [];
    volumeMovingAverageSeries = [];
    bollingerSeries = [];
    movingAverageSeries = [];
    pivotProjectionByPeriod = new Map();
    pivotTargetPeriodByTime = new Map();
    pivotSelectedReferenceKey = undefined;
    pivotSelectedAnchorTime = undefined;
    pivotSelectionPinned = false;
    estimatedMarginCostSeries = undefined;
    estimatedMarginRowsByDate = new Map();
    estimatedMarginAbortController?.abort();
    estimatedMarginAbortController = undefined;
    estimatedMarginRequestId += 1;
    lineSeries = [];
    mainLineCrosshairMarkerDefaults = new Map();
    fibonacciCrosshairMarkersHidden = false;
    indicatorSeries = [];
    indicatorSeriesByKey = new Map();
    indicatorSelectionSignature = "";
    indicatorSeriesPointCounts = {};
    indicatorRenderToken += 1;
    indicatorRecoveryCount = 0;
    indicatorTimeAnchorSeries = undefined;
    isSyncingTimeScale = false;
    isSyncingCrosshair = false;
    historyLoadInFlight = false;
    historyHasMoreBefore = true;
    historyInteractionArmed = false;
    lastPayloadRenderSignature = "";
    sharedHoverTime = undefined;
    pendingSharedHoverTime = undefined;
    hideSharedCrosshair();
  }

  function buildChart() {
    resetCharts();
    priceScaleMinWidth = SHARED_PRICE_SCALE_MIN_WIDTH;
    element.style.setProperty("--axis-safe-width", `${priceScaleMinWidth}px`);
    surface.innerHTML = "";
    indicatorSurface.innerHTML = "";
    profileOverlay.innerHTML = "";
    fixedProfileOverlay.innerHTML = "";
    priceExtremaLayer.innerHTML = "";
    pivotPointLayer.innerHTML = "";
    renderProfileSummary({});
    fvgLayer.innerHTML = "";
    mainWheelRoutingCleanup = window.QuoteChartInteractions.bindWheelRouting(surface, () => subchartPresentation.mode);
    chart = LightweightCharts.createChart(surface, {
      autoSize: true,
      ...chartInteractionOptions(),
      layout: {
        background: { type: "solid", color: "#18212f" },
        textColor: "#cbd5e1",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.13)" },
        horzLines: { color: "rgba(148, 163, 184, 0.13)" },
      },
      localization: {
        timeFormatter: formatCrosshairTime,
      },
      crosshair: SHARED_CROSSHAIR_OPTIONS,
      rightPriceScale: { borderVisible: false, minimumWidth: currentPriceScaleMinWidth() },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: RIGHT_OFFSET_BARS,
        tickMarkFormatter: formatTimeTick,
      },
    });
    attachOverlayRerenderHooks();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleMainVisibleLogicalRangeChange);
    const intradayMode = intervalSelect.value === "intraday";
    element.classList.toggle("is-intraday", intradayMode);
    element.classList.toggle("has-no-subchart", intradayMode);
    if (intradayMode) {
      intradayPriceSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: "#38bdf8", lineWidth: 2, title: "成交價",
        priceFormat: { type: "custom", formatter: (price) => formatQuotePrice(price, symbolSelect.value) },
      });
      intradayAverageSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: "#facc15", lineWidth: 2, title: "均價", priceLineVisible: false,
        priceFormat: { type: "custom", formatter: (price) => formatQuotePrice(price, symbolSelect.value) },
      });
      intradayPreviousCloseSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: "rgba(226, 232, 240, 0.72)", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed,
        title: "昨收", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: "volume" }, priceScaleId: "", priceLineVisible: false, lastValueVisible: false,
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      if (resizeObserver) resizeObserver.disconnect();
      if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(schedulePanelLayoutRefresh);
        resizeObserver.observe(surface);
      }
      return;
    }
    candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: "#dc2626",
      downColor: "#16a34a",
      borderUpColor: "#dc2626",
      borderDownColor: "#16a34a",
      wickUpColor: "#dc2626",
      wickDownColor: "#16a34a",
      priceFormat: { type: "custom", formatter: (price) => formatQuotePrice(price, symbolSelect.value) },
    });
    chart.subscribeCrosshairMove(handleCrosshairMove);
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
    const fibonacciAutoScaleOptions = {
      color: "rgba(0, 0, 0, 0)",
      lineVisible: false,
      pointMarkersVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "",
    };
    fibonacciAutoScaleLowerSeries = chart.addSeries(LightweightCharts.LineSeries, fibonacciAutoScaleOptions);
    fibonacciAutoScaleUpperSeries = chart.addSeries(LightweightCharts.LineSeries, fibonacciAutoScaleOptions);
    pivotAutoScaleLowerSeries = chart.addSeries(LightweightCharts.LineSeries, fibonacciAutoScaleOptions);
    pivotAutoScaleUpperSeries = chart.addSeries(LightweightCharts.LineSeries, fibonacciAutoScaleOptions);
    updateFibonacciAutoScale(chartAnnotationController?.getState?.());
    volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.74, bottom: 0 } });
    volumeMovingAverageSeries = ["ma5", "ma10", "ma20"].map((key) => chart.addSeries(LightweightCharts.LineSeries, {
      color: VOLUME_AVERAGE_STYLES[key].color,
      lineWidth: 1,
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "",
      priceFormat: { type: "volume" },
    }));
    indicatorWheelRoutingCleanup = window.QuoteChartInteractions.bindWheelRouting(indicatorSurface, () => subchartPresentation.mode);
    indicatorChart = createIndicatorChart();
    attachIndicatorChartSync();
    if (resizeObserver) resizeObserver.disconnect();
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(schedulePanelLayoutRefresh);
      resizeObserver.observe(surface);
    }
  }

  function attachOverlayRerenderHooks() {
    if (overlayHooksAttached) return;
    overlayHooksAttached = true;
    ["wheel", "pointermove", "pointerup", "pointerleave", "dblclick"].forEach((eventName) => {
      surface.addEventListener(eventName, scheduleOverlayRender, { passive: true });
      indicatorSurface.addEventListener(eventName, scheduleOverlayRender, { passive: true });
    });
    surface.addEventListener("wheel", armHistoryInteraction, { passive: true });
    surface.addEventListener("pointerdown", armHistoryInteraction, { passive: true });
    surface.addEventListener("pointermove", handleSurfacePointerMove, { passive: true });
    surface.addEventListener("pointerleave", handleSurfacePointerLeave, { passive: true });
    surface.addEventListener("mouseleave", handleSurfacePointerLeave, { passive: true });
    indicatorSurface.addEventListener("pointermove", handleIndicatorSurfacePointerMove, { passive: true });
    indicatorSurface.addEventListener("pointerleave", handleSurfacePointerLeave, { passive: true });
    indicatorSurface.addEventListener("mouseleave", handleSurfacePointerLeave, { passive: true });
    window.addEventListener("mousemove", handleWindowMouseLocation, { passive: true });
    window.addEventListener("resize", scheduleOverlayRender);
    window.addEventListener("resize", scheduleQuoteTimeFit);
    window.addEventListener("scroll", scheduleOverlayRender, { passive: true });
  }

  function detachOverlayRerenderHooks() {
    if (!overlayHooksAttached) return;
    overlayHooksAttached = false;
    ["wheel", "pointermove", "pointerup", "pointerleave", "dblclick"].forEach((eventName) => {
      surface.removeEventListener(eventName, scheduleOverlayRender);
      indicatorSurface.removeEventListener(eventName, scheduleOverlayRender);
    });
    surface.removeEventListener("wheel", armHistoryInteraction);
    surface.removeEventListener("pointerdown", armHistoryInteraction);
    surface.removeEventListener("pointermove", handleSurfacePointerMove);
    surface.removeEventListener("pointerleave", handleSurfacePointerLeave);
    surface.removeEventListener("mouseleave", handleSurfacePointerLeave);
    indicatorSurface.removeEventListener("pointermove", handleIndicatorSurfacePointerMove);
    indicatorSurface.removeEventListener("pointerleave", handleSurfacePointerLeave);
    indicatorSurface.removeEventListener("mouseleave", handleSurfacePointerLeave);
    window.removeEventListener("mousemove", handleWindowMouseLocation);
    window.removeEventListener("resize", scheduleOverlayRender);
    window.removeEventListener("resize", scheduleQuoteTimeFit);
    window.removeEventListener("scroll", scheduleOverlayRender);
  }

  function clearPanelLoadRetry() {
    if (panelLoadRetryTimer) {
      panelLifecycle.clearTimer(panelLoadRetryTimer);
      panelLoadRetryTimer = 0;
    }
  }

  function schedulePanelLoadRetry(currentLoadToken, retryAttempt, hasCachedPayload) {
    clearPanelLoadRetry();
    const retryDelay = PANEL_LOAD_RETRY_DELAYS_MS[retryAttempt];
    if (retryDelay === undefined) {
      status.textContent = hasCachedPayload
        ? "使用已載入資料，更新逾時，已達重試上限"
        : "載入逾時，已達重試上限，請重新切回此頁或重新選取商品";
      status.classList.add("is-visible");
      return;
    }
    const nextRetryAttempt = retryAttempt + 1;
    const retrySeconds = Math.round(retryDelay / 1000);
    status.textContent = hasCachedPayload
      ? `使用已載入資料，更新逾時，${retrySeconds} 秒後自動重試 ${nextRetryAttempt}/${PANEL_LOAD_RETRY_DELAYS_MS.length}`
      : `載入逾時，${retrySeconds} 秒後自動重試 ${nextRetryAttempt}/${PANEL_LOAD_RETRY_DELAYS_MS.length}`;
    status.classList.add("is-visible");
    panelLoadRetryTimer = panelLifecycle.setTimer(() => {
      panelLoadRetryTimer = 0;
      if (!isPanelActive() || currentLoadToken !== loadToken) return;
      load({ retryAttempt: nextRetryAttempt });
    }, retryDelay);
  }

  async function load(options = {}) {
    if (!isPanelActive()) return;
    realtimeIndicatorScheduler.cancel();
    clearPanelLoadRetry();
    liveUpdateCleanup?.();
    liveUpdateCleanup = undefined;
    realtimeUpdateCleanup?.();
    realtimeUpdateCleanup = undefined;
    latestRealtimeSnapshot = null;
    realtimeDisplayState = "unavailable";
    if (eventSource) {
      eventSource.close();
      eventSource = undefined;
    }
    const currentLoadToken = ++loadToken;
    const retryAttempt = Number(options.retryAttempt || 0);
    if (retryAttempt === 0) lastRenderedPrice = undefined;
    clearFixedRangeVolumeProfile({ silent: true, persist: false });
    resetHistoryLoadState();
    buildChart();
    peRiverController?.refreshContext();
    const symbol = symbolSelect.value;
    const interval = intervalSelect.value;
    if (interval === "intraday") {
      await loadIntraday(symbol, currentLoadToken);
      return;
    }
    restoreEstimatedMarginCostSelection(symbol, interval);
    updateChipIndicatorOptionsAvailability();
    chipPaneManager?.setContext({ symbol, interval, tabId: state.activeMarketTabId, candles: [] });
    const pivotMode = selectedPivotMode();
    const cachedPayload = readPanelPayloadCache(symbol, interval, pivotMode);
    let hasCachedPayload = false;
    if (cachedPayload) {
      try {
        applyCachedPayload(cachedPayload);
        hasCachedPayload = true;
        status.textContent = retryAttempt > 0
          ? `${symbol} / ${formatIntervalLabel(interval)} 使用已載入資料，重試更新 ${retryAttempt}/${PANEL_LOAD_RETRY_DELAYS_MS.length}`
          : `${symbol} / ${formatIntervalLabel(interval)} 已使用已載入資料，更新中`;
        status.classList.add("is-visible");
      } catch {
        state.panelPayloadCache.delete(panelPayloadCacheKey(symbol, interval, pivotMode));
        clearPanelValues();
        status.textContent = "載入資料中";
        status.classList.add("is-visible");
      }
    } else {
      clearPanelValues();
      status.textContent = retryAttempt > 0
        ? `重新載入資料中（重試 ${retryAttempt}/${PANEL_LOAD_RETRY_DELAYS_MS.length}）`
        : "載入資料中";
      status.classList.add("is-visible");
    }
    try {
      state.panelDataRequestCount += 1;
      const cachedDisplayCount = Math.min(MAX_HISTORY_DISPLAY_CANDLES, Number(cachedPayload?.candles?.length) || 0);
      const displayCountQuery = cachedDisplayCount > HISTORY_LOAD_BATCH_BARS
        ? `&display_count=${encodeURIComponent(cachedDisplayCount)}`
        : "";
      const { response, payload } = await fetchJsonWithTimeout(withPanelIndicatorParameters(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}${displayCountQuery}`), PANEL_CANDLE_LOAD_TIMEOUT_MS);
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "資料載入失敗");
      }
      if (destroyed || currentLoadToken !== loadToken) return;
      const preparedPayload = applyPayloadStep("prepare", () => preparePanelPayload(payload));
      const nextRenderSignature = window.QuoteChartPayload.renderSignature(preparedPayload);
      if (nextRenderSignature !== lastPayloadRenderSignature) {
        restoreFixedProfileState(preparedPayload.candles || []);
        applyPayload(preparedPayload, { prepared: true });
      } else {
        lastPayload = preparedPayload;
        lastPayloadRenderSignature = nextRenderSignature;
      }
      if (destroyed || currentLoadToken !== loadToken) return;
      canonicalPayload = preparedPayload;
      writePanelPayloadCache(symbol, interval, preparedPayload, pivotMode);
      connectStream(symbol, interval);
      status.textContent = `${symbol} / ${formatIntervalLabel(interval)} 已載入`;
      delete status.dataset.chartApplyStage;
      status.classList.remove("is-visible");
      scheduleAdjacentPagePrefetch();
    } catch (error) {
      if (destroyed || currentLoadToken !== loadToken) return;
      status.dataset.chartApplyStage = String(error?.chartApplyStage || "");
      if (isRetryableLoadError(error)) {
        schedulePanelLoadRetry(currentLoadToken, retryAttempt, hasCachedPayload);
        return;
      }
      if (error?.chartApplyStage || error?.code === "invalid-chart-payload") {
        console.warn("panel chart update failed", {
          stage: error?.chartApplyStage || "prepare",
          symbol,
          interval,
          message: String(error?.message || error),
        });
        status.textContent = hasCachedPayload || lastPayload
          ? "圖表更新失敗，已保留原有資料"
          : "圖表更新失敗：回傳資料沒有可繪製內容";
      } else {
        const message = formatLoadErrorMessage(error);
        status.textContent = hasCachedPayload ? `使用已載入資料，資料更新失敗：${message}` : `錯誤：${message}`;
      }
      status.classList.add("is-visible");
    }
  }

  async function refreshPivotPointSelection() {
    if (destroyed) return;
    if (!lastPayload || !chart) {
      load();
      return;
    }
    clearPanelLoadRetry();
    const currentLoadToken = ++loadToken;
    const symbol = symbolSelect.value;
    const interval = intervalSelect.value;
    const pivotMode = selectedPivotMode();
    const oldCandleCount = (lastPayload.candles || []).length;
    const viewportSnapshot = captureViewportSnapshot(lastPayload.candles || []);
    if (!pivotMode) {
      eventSource?.close();
      eventSource = undefined;
      if (lastPayload.indicators) delete lastPayload.indicators.pivot_points;
      clearPivotPoints();
      setReadoutSelection(getSelectedMainIndicators(), getSelectedSubIndicators());
      connectStream(symbol, interval);
      status.textContent = "Pivot Point 已移除";
      status.classList.remove("is-visible");
      return;
    }
    pausePanelStreamsForForegroundRequest();
    status.textContent = "載入 Pivot Point…";
    status.classList.add("is-visible");
    try {
      const cachedCandidate = readPanelPayloadCache(symbol, interval, pivotMode);
      const cachedPayload = (cachedCandidate?.candles || []).length >= oldCandleCount
        && cachedCandidate?.indicators?.pivot_points?.contractVersion === "selected-next-period-v1"
        ? cachedCandidate
        : undefined;
      let payload = cachedPayload;
      if (!payload) {
        const fetched = await fetchJsonWithTimeout(
          withPanelIndicatorParameters(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&display_count=${encodeURIComponent(oldCandleCount)}`),
          PANEL_CANDLE_LOAD_TIMEOUT_MS,
        );
        if (!fetched.response.ok || fetched.payload.error) throw new Error(fetched.payload.error || "資料載入失敗");
        payload = fetched.payload;
      }
      if (
        destroyed
        || currentLoadToken !== loadToken
        || symbol !== symbolSelect.value
        || interval !== intervalSelect.value
        || pivotMode !== selectedPivotMode()
      ) return;
      if (payload?.indicators?.pivot_points?.contractVersion !== "selected-next-period-v1") {
        throw new Error("Pivot Point 資料版本不相容");
      }
      if ((payload.candles || []).length < oldCandleCount) {
        lastPayload.indicators = {
          ...(lastPayload.indicators || {}),
          pivot_points: payload.indicators.pivot_points,
        };
        drawPivotPoints(lastPayload.indicators.pivot_points);
        setReadoutSelection(getSelectedMainIndicators(), getSelectedSubIndicators());
      } else {
        const preparedPayload = preparePanelPayload(payload);
        applyPayload(preparedPayload, { prepared: true, viewportSnapshot, oldCandleCount });
        writePanelPayloadCache(symbol, interval, preparedPayload, pivotMode);
      }
      status.textContent = "Pivot Point 已載入";
      status.classList.remove("is-visible");
    } catch (error) {
      if (destroyed || currentLoadToken !== loadToken) return;
      status.textContent = `Pivot Point 更新失敗：${formatLoadErrorMessage(error)}`;
      status.classList.add("is-visible");
    } finally {
      resumePanelStreamsAfterForegroundRequest();
    }
  }

  function applyCachedPayload(cachedPayload) {
    const preparedPayload = preparePanelPayload(cachedPayload);
    restoreFixedProfileState(preparedPayload.candles || []);
    applyPayload(preparedPayload, { prepared: true });
    canonicalPayload = preparedPayload;
    historyHasMoreBefore = preparedPayload.dataWindow?.hasMoreBefore !== false;
  }

  function applyPayloadStep(stage, callback) {
    try {
      return callback();
    } catch (error) {
      if (error && typeof error === "object" && !error.chartApplyStage) error.chartApplyStage = stage;
      throw error;
    }
  }

  function applyPayload(payload, options = {}) {
    if (!isPanelActive()) return;
    if (destroyed || !chart || !candleSeries || !volumeSeries) return;
    const preparedPayload = options.prepared ? payload : applyPayloadStep("prepare", () => preparePanelPayload(payload));
    const previousPayload = lastPayload;
    payload = preparedPayload;
    const preserveVisibleLogicalRange = options.preserveVisibleLogicalRange;
    const userVisibleLogicalRange = !preserveVisibleLogicalRange && historyInteractionArmed
      ? chart.timeScale().getVisibleLogicalRange?.()
      : undefined;
    const oldCandleCount = options.oldCandleCount;
    const viewportSnapshot = options.viewportSnapshot;
    lastPayload = payload;
    try {
    const selectedMain = getSelectedMainIndicators();
    const selectedSub = getSelectedSubIndicators();
    const candles = payload.candles || [];
    cancelScheduledTimeScaleRefit();
    chipPaneManager?.setMode(effectivePanelSubchartMode());
    const indicators = payload.indicators || {};
    clearInvalidFixedProfileForCandles(candles);
    syncPriceScaleMinWidth(candles);
    updateLatestPriceLabel(payload);
    applyPayloadStep("base-series", () => {
      candleSeries.setData(candles);
      volumeSeries.setData(selectedMain.has("volume") ? compactSeries(indicators.volume || []) : []);
      volumeMovingAverageSeries[0]?.setData(selectedMain.has("volume") ? compactSeries(indicators.volume_moving_average?.ma5 || []) : []);
      volumeMovingAverageSeries[1]?.setData(selectedMain.has("volume") ? compactSeries(indicators.volume_moving_average?.ma10 || []) : []);
      volumeMovingAverageSeries[2]?.setData(selectedMain.has("volume") ? compactSeries(indicators.volume_moving_average?.ma20 || []) : []);
    });
    updateVolumeAvailability(payload, selectedMain.has("volume"));
    applyPayloadStep("moving-average", () => {
      if (selectedMain.has("ma")) drawMovingAverage(indicators.moving_average || {});
      else clearMovingAverage();
    });
    applyPayloadStep("bollinger", () => {
      if (selectedMain.has("bollinger")) drawBollinger(indicators.bollinger || {});
      else clearBollinger();
    });
    if (selectedMain.has("pivotPoint")) drawPivotPoints(indicators.pivot_points);
    else clearPivotPoints();
    if (selectedMain.has("fvg")) {
      drawFvg(indicators.fvg || []);
    } else {
      drawFvg([]);
    }
    if (selectedMain.has("volumeProfile")) drawLevels(indicators);
    else clearLevels();
    if (effectivePanelSubchartMode() !== CHART_PRESENTATION_MODES.main) {
      applyPayloadStep("technical-subchart", () => {
        isSyncingTimeScale = true;
        try {
          renderIndicatorChart(indicators, selectedSub);
          syncIndicatorTimeAnchor(candles);
        } finally {
          releaseTimeScaleSyncAfterFrame();
        }
      });
    }
    updateReadout(indicators, selectedMain, selectedSub);
    if (candles.length > 0) {
      const latestCandle = candles[candles.length - 1];
      updateQuoteDataTime(payload.quote, quoteTimeForLatestCandle(payload, latestCandle));
      updateLatestPriceState(latestCandle.close, candles[candles.length - 2]?.close, payload);
    }
    if (viewportSnapshot) {
      restoreViewportSnapshot(viewportSnapshot, candles);
    } else if (preserveVisibleLogicalRange) {
      applyPreservedVisibleLogicalRange(preserveVisibleLogicalRange, oldCandleCount, candles.length);
    } else if (isFiniteLogicalRange(userVisibleLogicalRange)) {
      setSynchronizedVisibleLogicalRange(userVisibleLogicalRange);
    } else {
      applyPayloadStep("viewport", () => refitTimeScalesToCandles(candles));
    }
    chipPaneManager?.setContext({ symbol: symbolSelect.value, interval: intervalSelect.value, tabId: state.activeMarketTabId, candles });
    renderEstimatedMarginCost(candles, selectedMain.has("estimatedMarginCost"));
    lastPayloadRenderSignature = window.QuoteChartPayload.renderSignature(payload);
    renderMainOverlays(indicators, selectedMain);
    scheduleRenderedAxisSafeWidthSync();
    if (!preserveVisibleLogicalRange && !isFiniteLogicalRange(userVisibleLogicalRange)) scheduleTimeScaleRefit();
    scheduleAlignmentMeasurement();
    scheduleOverlayRender();
    peRiverController?.render();
    } catch (error) {
      lastPayload = previousPayload;
      throw error;
    }
  }

  function resetHistoryLoadState() {
    if (historyLoadTimer) {
      panelLifecycle.clearTimer(historyLoadTimer);
      historyLoadTimer = 0;
    }
    if (priceUpdateTimer) {
      panelLifecycle.clearTimer(priceUpdateTimer);
      priceUpdateTimer = 0;
    }
    historyLoadInFlight = false;
    historyHasMoreBefore = true;
    historyInteractionArmed = false;
  }

  function updateVolumeAvailability(payload, volumeSelected) {
    if (!volumeAvailabilityNote) return;
    const availability = payload?.quote?.volumeAvailability || payload?.dataQuality?.volumeAvailability;
    const unavailable = volumeSelected
      && availability?.status === "unavailable"
      && availability?.reason === "source_not_provided";
    const message = unavailable ? String(availability.message || "此指數來源未提供成交量") : "";
    volumeAvailabilityNote.textContent = message;
    volumeAvailabilityNote.title = message;
    volumeAvailabilityNote.setAttribute("aria-label", message);
    volumeAvailabilityNote.hidden = !message;
  }

  function armHistoryInteraction() {
    historyInteractionArmed = true;
    cancelScheduledTimeScaleRefit();
  }

  function clearPanelValues() {
    lastPayload = null;
    lastRenderedPrice = undefined;
    updateLatestPriceInstrumentLabel(symbolSelect.value, "");
    priceValue.textContent = "--";
    priceDirection.textContent = "";
    priceChange.textContent = "--";
    priceChangePercent.textContent = "--";
    updateQuoteDataTime(undefined);
    updateVolumeAvailability(undefined, false);
    priceStrip.classList.remove(
      "trend-up",
      "trend-down",
      "trend-flat",
      "limit-up",
      "limit-down",
      "is-price-updated",
      "updated-trend-up",
      "updated-trend-down",
      "updated-trend-flat"
    );
    [mainReadout, subReadout].forEach((root) => {
      root.querySelectorAll("b").forEach((node) => {
        node.textContent = "--";
      });
      root.querySelectorAll(".trend-up, .trend-down, .trend-flat").forEach((node) => {
        node.classList.remove("trend-up", "trend-down", "trend-flat");
      });
      root.classList.add("hidden");
    });
    mainReadout.querySelectorAll("[data-main-readout]").forEach((node) => {
      node.classList.remove("hidden");
    });
    const selectedMain = getSelectedMainIndicators();
    const selectedSub = getSelectedSubIndicators();
    setReadoutSelection(selectedMain, selectedSub);
  }

  function isFixedProfileAvailable() {
    return isPanelSingleChartEquivalent();
  }

  function isPanelSingleChartEquivalent() {
    const chartCount = Number(document.getElementById("chart-count")?.value || state.panels.length);
    return chartCount === 1;
  }

  function defaultFixedProfileSettings() {
    return {
      rowCount: FIXED_PROFILE_CALCULATOR.FIXED_VOLUME_PROFILE_DEFAULT_ROWS || 24,
      valueAreaPercent: FIXED_PROFILE_CALCULATOR.FIXED_VOLUME_PROFILE_DEFAULT_VALUE_AREA_PERCENT || 70,
    };
  }

  function fixedProfileStorageKey() {
    return `${FIXED_PROFILE_STORAGE_PREFIX}:${symbolSelect.value}:${intervalSelect.value}`;
  }

  function sanitizeFixedProfileName(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized.slice(0, FIXED_PROFILE_NAME_MAX_LENGTH);
  }

  function createFixedProfileRangeName() {
    return `範圍 ${fixedProfileRanges.length + 1}`;
  }

  function createFixedProfileRangeColor() {
    return FIXED_PROFILE_RANGE_COLORS[fixedProfileRanges.length % FIXED_PROFILE_RANGE_COLORS.length];
  }

  function nowFixedProfileTimestamp() {
    return Date.now();
  }

  function persistableFixedProfileRanges() {
    return fixedProfileRanges.map((range) => ({
      id: range.id,
      from: range.from,
      to: range.to,
      name: range.name,
      color: range.color,
      createdAt: range.createdAt,
      updatedAt: range.updatedAt,
    }));
  }

  function saveFixedProfileState() {
    if (!fixedProfileRanges.length) {
      localStorage.removeItem(fixedProfileStorageKey());
      return;
    }
    localStorage.setItem(fixedProfileStorageKey(), JSON.stringify({
      version: FIXED_PROFILE_STORAGE_VERSION,
      settings: { ...fixedProfileSettings },
      ranges: persistableFixedProfileRanges(),
    }));
  }

  function restoreFixedProfileState(candles = []) {
    const raw = localStorage.getItem(fixedProfileStorageKey());
    if (!raw) return;
    let stored;
    try {
      stored = JSON.parse(raw);
    } catch {
      localStorage.removeItem(fixedProfileStorageKey());
      return;
    }
    if (stored?.version !== FIXED_PROFILE_STORAGE_VERSION || !Array.isArray(stored.ranges)) {
      localStorage.removeItem(fixedProfileStorageKey());
      return;
    }
    const availableTimes = new Set(candles.map((row) => normalizeChartTime(row.time)));
    fixedProfileSettings = normalizeFixedProfileSettings(stored.settings);
    fixedProfileRanges = stored.ranges
      .filter((range) => availableTimes.has(normalizeChartTime(range.from)) && availableTimes.has(normalizeChartTime(range.to)))
      .map((range, rangeIndex) => restoredFixedProfileRange(range, rangeIndex))
      .filter(Boolean);
    selectedFixedProfileId = fixedProfileRanges[fixedProfileRanges.length - 1]?.id;
    fixedProfileNextId = nextFixedProfileId();
    fixedProfileState = fixedProfileRanges.length ? FIXED_PROFILE_STATES.completed : FIXED_PROFILE_STATES.idle;
    if (!fixedProfileRanges.length) localStorage.removeItem(fixedProfileStorageKey());
    updateFixedProfileToolAvailability();
  }

  function normalizeFixedProfileSettings(settings = {}) {
    const defaults = defaultFixedProfileSettings();
    return {
      rowCount: clampInteger(settings.rowCount, 8, 80, defaults.rowCount),
      valueAreaPercent: clampInteger(settings.valueAreaPercent, 50, 95, defaults.valueAreaPercent),
    };
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function restoredFixedProfileRange(storedRange, rangeIndex) {
    const from = normalizeChartTime(storedRange.from);
    const to = normalizeChartTime(storedRange.to);
    const result = profileForFixedProfileRange(from, to);
    if (!result) return undefined;
    return {
      id: String(storedRange.id || `frvp-${rangeIndex + 1}`),
      from: Math.min(from, to),
      to: Math.max(from, to),
      name: sanitizeFixedProfileName(storedRange.name) || `範圍 ${rangeIndex + 1}`,
      color: FIXED_PROFILE_RANGE_COLORS.includes(storedRange.color) ? storedRange.color : FIXED_PROFILE_RANGE_COLORS[rangeIndex % FIXED_PROFILE_RANGE_COLORS.length],
      createdAt: Number(storedRange.createdAt) || nowFixedProfileTimestamp(),
      updatedAt: Number(storedRange.updatedAt) || nowFixedProfileTimestamp(),
      profile: result.profile,
      candleCount: result.rangeCandles.length,
    };
  }

  function nextFixedProfileId() {
    const maxId = fixedProfileRanges
      .map((range) => Number(String(range.id).replace("frvp-", "")))
      .filter(Number.isFinite)
      .reduce((max, value) => Math.max(max, value), 0);
    return maxId + 1;
  }

  function updateFixedProfileToolAvailability() {
    const available = isFixedProfileAvailable();
    fixedProfileControls.hidden = !available;
    fixedProfileTool.hidden = !available;
    fixedProfileSettingsToggle.hidden = !available;
    fixedProfileDeleteSelected.hidden = !available;
    fixedProfileClear.hidden = !available;
    fixedProfileTool.disabled = !available;
    fixedProfileSettingsToggle.disabled = !available || !fixedProfileRanges.length;
    fixedProfileSettingsToggle.setAttribute("aria-expanded", String(available && !fixedProfileSettingsPanel.hidden));
    fixedProfileDeleteSelected.disabled = !available || !selectedFixedProfileId;
    if (!available) {
      finishFixedProfileDrag();
      fixedProfileFirstTime = undefined;
      fixedProfileLastError = "";
      fixedProfileState = FIXED_PROFILE_STATES.idle;
      fixedProfileSettingsPanel.hidden = true;
      renderFixedRangeVolumeProfile();
    }
    fixedProfileTool.classList.toggle("is-active", available && isFixedProfileDrawing());
    fixedProfileTool.setAttribute("aria-pressed", String(available && isFixedProfileDrawing()));
    fixedProfileClear.disabled = !available || !fixedProfileRanges.length;
    fixedProfileSettingsToggle.classList.toggle("is-active", available && !fixedProfileSettingsPanel.hidden);
    renderFixedProfileSettingsPanel();
  }

  function toggleFixedProfileSettingsPanel() {
    if (!isFixedProfileAvailable() || !fixedProfileRanges.length) return;
    if (fixedProfileSettingsPanel.hidden) openFixedProfileSettingsPanel();
    else closeFixedProfileSettingsPanel();
  }

  function openFixedProfileSettingsPanel() {
    fixedProfileSettingsPanel.hidden = false;
    fixedProfileSettingsToggle.setAttribute("aria-expanded", "true");
    fixedProfileSettingsToggle.classList.add("is-active");
    document.addEventListener("click", handleFixedProfileDocumentClick);
    renderFixedProfileSettingsPanel();
  }

  function closeFixedProfileSettingsPanel() {
    fixedProfileSettingsPanel.hidden = true;
    fixedProfileSettingsToggle.setAttribute("aria-expanded", "false");
    fixedProfileSettingsToggle.classList.remove("is-active");
    document.removeEventListener("click", handleFixedProfileDocumentClick);
  }

  function handleFixedProfileDocumentClick(event) {
    if (fixedProfileSettingsPanel.hidden) return;
    if (fixedProfileSettingsPanel.contains(event.target) || fixedProfileSettingsToggle.contains(event.target)) return;
    closeFixedProfileSettingsPanel();
  }

  function renderFixedProfileSettingsPanel() {
    if (!fixedProfileRangeList) return;
    fixedProfileRowCount.value = String(fixedProfileSettings.rowCount);
    fixedProfileValueArea.value = String(fixedProfileSettings.valueAreaPercent);
    fixedProfileRangeList.innerHTML = "";
    if (!fixedProfileRanges.length) {
      const empty = document.createElement("div");
      empty.className = "fixed-profile-empty";
      empty.textContent = "尚未建立 FRVP 範圍";
      fixedProfileRangeList.appendChild(empty);
      return;
    }
    fixedProfileRanges.forEach((range) => {
      const item = document.createElement("div");
      item.className = "fixed-profile-range-item";
      item.classList.toggle("is-selected", range.id === selectedFixedProfileId);
      item.dataset.rangeId = range.id;

      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "fixed-profile-color-swatch";
      swatch.dataset.color = nextRangeColor(range.color);
      swatch.style.setProperty("--range-color", range.color);
      swatch.title = "切換範圍顏色";
      swatch.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        updateFixedProfileRangeColor(range.id, swatch.dataset.color);
      });

      const body = document.createElement("div");
      body.className = "fixed-profile-range-body";
      const name = document.createElement("input");
      name.className = "fixed-profile-range-name-input";
      name.type = "text";
      name.maxLength = FIXED_PROFILE_NAME_MAX_LENGTH;
      name.value = range.name;
      name.addEventListener("input", () => renameFixedProfileRange(range.id, name.value));
      name.addEventListener("click", (event) => event.stopPropagation());
      const meta = document.createElement("div");
      meta.className = "fixed-profile-range-meta";
      meta.textContent = `${formatFixedProfileRangeTime(range.from)} - ${formatFixedProfileRangeTime(range.to)}｜${range.candleCount} 根`;
      body.appendChild(name);
      body.appendChild(meta);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "fixed-profile-row-delete";
      remove.textContent = "刪除";
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectFixedProfileRange(range.id);
        deleteSelectedFixedProfileRange();
      });

      item.addEventListener("click", () => selectFixedProfileRange(range.id));
      item.appendChild(swatch);
      item.appendChild(body);
      item.appendChild(remove);
      fixedProfileRangeList.appendChild(item);
    });
  }

  function nextRangeColor(currentColor) {
    const index = FIXED_PROFILE_RANGE_COLORS.indexOf(currentColor);
    return FIXED_PROFILE_RANGE_COLORS[(Math.max(0, index) + 1) % FIXED_PROFILE_RANGE_COLORS.length];
  }

  function formatFixedProfileRangeTime(time) {
    return yyMmDd(time) || String(time);
  }

  function renameFixedProfileRange(rangeId, nextName) {
    const sanitized = sanitizeFixedProfileName(nextName);
    if (!sanitized) return;
    fixedProfileRanges = fixedProfileRanges.map((range) => (
      range.id === rangeId
        ? { ...range, name: sanitized, updatedAt: nowFixedProfileTimestamp() }
        : range
    ));
    saveFixedProfileState();
    renderFixedRangeVolumeProfile();
    publishQuoteChartDebugReport();
  }

  function updateFixedProfileRangeColor(rangeId, nextColor) {
    if (!FIXED_PROFILE_RANGE_COLORS.includes(nextColor)) return;
    fixedProfileRanges = fixedProfileRanges.map((range) => (
      range.id === rangeId
        ? { ...range, color: nextColor, updatedAt: nowFixedProfileTimestamp() }
        : range
    ));
    saveFixedProfileState();
    renderFixedRangeVolumeProfile();
    renderFixedProfileSettingsPanel();
    publishQuoteChartDebugReport();
  }

  function deleteSelectedFixedProfileRange() {
    if (!selectedFixedProfileId) return;
    const deletedIndex = fixedProfileRanges.findIndex((range) => range.id === selectedFixedProfileId);
    fixedProfileRanges = fixedProfileRanges.filter((range) => range.id !== selectedFixedProfileId);
    selectedFixedProfileId = fixedProfileRanges[Math.max(0, Math.min(deletedIndex, fixedProfileRanges.length - 1))]?.id;
    fixedProfileState = fixedProfileRanges.length ? FIXED_PROFILE_STATES.completed : FIXED_PROFILE_STATES.idle;
    fixedProfileLastError = "";
    saveFixedProfileState();
    updateFixedProfileToolAvailability();
    renderFixedRangeVolumeProfile();
    status.textContent = fixedProfileRanges.length ? "固定範圍 VP 已刪除選取範圍" : "固定範圍 VP 已清除";
    publishQuoteChartDebugReport();
  }

  function updateFixedProfileCalculationSettings() {
    fixedProfileSettings = normalizeFixedProfileSettings({
      rowCount: fixedProfileRowCount.value,
      valueAreaPercent: fixedProfileValueArea.value,
    });
    fixedProfileRanges = fixedProfileRanges
      .map((range) => recalculateFixedProfileRange(range.from, range.to, range))
      .filter(Boolean);
    if (!fixedProfileRanges.some((range) => range.id === selectedFixedProfileId)) {
      selectedFixedProfileId = fixedProfileRanges[fixedProfileRanges.length - 1]?.id;
    }
    saveFixedProfileState();
    updateFixedProfileToolAvailability();
    renderFixedRangeVolumeProfile();
    publishQuoteChartDebugReport();
  }

  function recalculateFixedProfileRange(from, to, existing = {}) {
    const normalizedFrom = Math.min(normalizeChartTime(from), normalizeChartTime(to));
    const normalizedTo = Math.max(normalizeChartTime(from), normalizeChartTime(to));
    const result = profileForFixedProfileRange(normalizedFrom, normalizedTo);
    if (!result) return undefined;
    return {
      ...existing,
      id: existing.id || `frvp-${fixedProfileNextId++}`,
      from: normalizedFrom,
      to: normalizedTo,
      name: existing.name || createFixedProfileRangeName(),
      color: existing.color || createFixedProfileRangeColor(),
      createdAt: existing.createdAt || nowFixedProfileTimestamp(),
      updatedAt: nowFixedProfileTimestamp(),
      profile: result.profile,
      candleCount: result.rangeCandles.length,
    };
  }

  function isFixedProfileDrawing() {
    return fixedProfileState === FIXED_PROFILE_STATES.armed
      || fixedProfileState === FIXED_PROFILE_STATES.firstPointSelected;
  }

  function setFixedProfileState(nextState) {
    fixedProfileState = nextState;
    updateFixedProfileToolAvailability();
    publishQuoteChartDebugReport();
  }

  function toggleFixedProfileDrawing() {
    if (!isFixedProfileAvailable()) return;
    if (isFixedProfileDrawing()) {
      cancelFixedProfileDrawing();
      return;
    }
    fixedProfileFirstTime = undefined;
    fixedProfileLastError = "";
    setFixedProfileState(FIXED_PROFILE_STATES.armed);
    status.textContent = "固定範圍 VP：請點選起點 K 線";
    renderFixedRangeVolumeProfile();
  }

  function nearestCandleForCoordinate(x) {
    const candles = lastPayload?.candles || [];
    if (!chart || !candles.length || !Number.isFinite(x)) return undefined;
    const rightEdge = surface.clientWidth - getAxisSafeWidth();
    if (x < 0 || x > rightEdge) return undefined;
    const coordinateToTime = chart.timeScale().coordinateToTime;
    if (typeof coordinateToTime !== "function") return undefined;
    return nearestCandleByTime(coordinateToTime.call(chart.timeScale(), x));
  }

  function nearestCandleByTime(time) {
    const candles = lastPayload?.candles || [];
    const target = normalizeChartTime(time);
    if (!Number.isFinite(target) || !candles.length) return undefined;
    let nearest;
    let nearestDistance = Infinity;
    candles.forEach((row) => {
      const rowTime = normalizeChartTime(row.time);
      if (!Number.isFinite(rowTime)) return;
      const distance = Math.abs(rowTime - target);
      if (distance < nearestDistance) {
        nearest = row;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  function candleIndexForTime(time) {
    const target = normalizeChartTime(time);
    if (!Number.isFinite(target)) return -1;
    return (lastPayload?.candles || []).findIndex((row) => normalizeChartTime(row.time) === target);
  }

  function candleAtIndex(index) {
    const candles = lastPayload?.candles || [];
    return candles[Math.max(0, Math.min(candles.length - 1, index))];
  }

  function rangeCandlesForFixedProfile(firstTime, secondTime) {
    const left = normalizeChartTime(firstTime);
    const right = normalizeChartTime(secondTime);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return [];
    const from = Math.min(left, right);
    const to = Math.max(left, right);
    return (lastPayload?.candles || []).filter((row) => {
      const time = normalizeChartTime(row.time);
      return Number.isFinite(time) && time >= from && time <= to;
    });
  }

  function profileForFixedProfileRange(from, to) {
    const rangeCandles = rangeCandlesForFixedProfile(from, to);
    const profile = computeFixedRangeVolumeProfile(rangeCandles, {
      rowCount: fixedProfileSettings.rowCount,
      valueAreaPercent: fixedProfileSettings.valueAreaPercent,
    });
    return profile ? { profile, rangeCandles } : undefined;
  }

  function createFixedProfileRange(firstTime, secondTime) {
    return recalculateFixedProfileRange(firstTime, secondTime, {
      id: `frvp-${fixedProfileNextId++}`,
      name: createFixedProfileRangeName(),
      color: createFixedProfileRangeColor(),
      createdAt: nowFixedProfileTimestamp(),
    });
  }

  function selectedFixedProfileRange() {
    return fixedProfileRanges.find((range) => range.id === selectedFixedProfileId);
  }

  function activeFixedProfileRange() {
    return selectedFixedProfileRange() || fixedProfileRanges[fixedProfileRanges.length - 1];
  }

  function selectFixedProfileRange(rangeId) {
    if (!fixedProfileRanges.some((range) => range.id === rangeId)) return;
    selectedFixedProfileId = rangeId;
    fixedProfileLastError = "";
    if (!isFixedProfileDrawing()) fixedProfileState = FIXED_PROFILE_STATES.completed;
    updateFixedProfileToolAvailability();
    renderFixedRangeVolumeProfile();
    publishQuoteChartDebugReport();
  }

  function handleFixedProfileSurfaceClick(event) {
    if (chartAnnotationController?.hasPending()) {
      const pendingState = chartAnnotationController.getState().pending;
      const pendingType = pendingState?.type;
      const point = chartPointForPanelEvent(event);
      event.preventDefault();
      event.stopPropagation();
      if (!point) {
        const anchorLabel = pendingType === "fibonacci" ? ["A", "B", "C"][pendingState.anchors.length] : "";
        status.textContent = ["A", "B"].includes(anchorLabel)
          ? `費波那契：${anchorLabel} 點必須選在 K 棒上；按住 Option／Alt 可自由選價`
          : "主圖繪圖：請點選主 K 線的有效價格位置";
        return;
      }
      const result = chartAnnotationController.addPoint(point);
      if (result.reason === "invalid_start") {
        status.textContent = "價格範圍：起點價格必須是有效的非零數值";
      } else if (result.completed) {
        status.textContent = pendingType === "priceRange" ? "價格範圍已建立" : "主圖繪圖已建立";
      }
      return;
    }
    if (isFixedProfileAvailable() && !isFixedProfileDrawing()) {
      if (!selectedFixedProfileId || !fixedProfileRanges.length) {
        selectPivotProjectionForSurfaceEvent(event);
        return;
      }
      selectedFixedProfileId = undefined;
      fixedProfileLastError = "";
      renderFixedRangeVolumeProfile();
      publishQuoteChartDebugReport();
      return;
    }
    if (!isFixedProfileAvailable()) {
      selectPivotProjectionForSurfaceEvent(event);
      return;
    }
    const rect = surface.getBoundingClientRect();
    const candle = nearestCandleForCoordinate(event.clientX - rect.left);
    if (!candle) {
      fixedProfileLastError = "invalid-click";
      status.textContent = "固定範圍 VP：請點選有效 K 線";
      renderFixedRangeVolumeProfile();
      publishQuoteChartDebugReport();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (fixedProfileState === FIXED_PROFILE_STATES.armed) {
      fixedProfileFirstTime = candle.time;
      fixedProfileLastError = "";
      setFixedProfileState(FIXED_PROFILE_STATES.firstPointSelected);
      status.textContent = "固定範圍 VP：請點選終點 K 線";
      renderFixedRangeVolumeProfile();
      return;
    }
    const range = createFixedProfileRange(fixedProfileFirstTime, candle.time);
    if (!range) {
      fixedProfileLastError = "insufficient-data";
      status.textContent = "固定範圍 VP：範圍資料不足";
      renderFixedRangeVolumeProfile();
      publishQuoteChartDebugReport();
      return;
    }
    fixedProfileRanges.push(range);
    selectedFixedProfileId = range.id;
    fixedProfileFirstTime = undefined;
    fixedProfileLastError = "";
    setFixedProfileState(FIXED_PROFILE_STATES.completed);
    status.textContent = `固定範圍 VP 已建立：${range.candleCount} 根 K 線`;
    saveFixedProfileState();
    renderFixedRangeVolumeProfile();
  }

  function cancelFixedProfileDrawing() {
    if (!isFixedProfileDrawing()) return;
    fixedProfileFirstTime = undefined;
    fixedProfileLastError = "";
    setFixedProfileState(fixedProfileRanges.length ? FIXED_PROFILE_STATES.completed : FIXED_PROFILE_STATES.idle);
    renderFixedRangeVolumeProfile();
  }

  function clearFixedRangeVolumeProfile(options = {}) {
    finishFixedProfileDrag();
    fixedProfileFirstTime = undefined;
    fixedProfileRanges = [];
    selectedFixedProfileId = undefined;
    fixedProfileLastError = "";
    fixedProfileState = FIXED_PROFILE_STATES.idle;
    if (options.persist !== false) saveFixedProfileState();
    updateFixedProfileToolAvailability();
    renderFixedRangeVolumeProfile();
    if (!options.silent) {
      status.textContent = "固定範圍 VP 已清除";
      publishQuoteChartDebugReport();
    }
  }

  function clearInvalidFixedProfileForCandles(candles = []) {
    if (!fixedProfileRanges.length) return;
    const times = new Set(candles.map((row) => normalizeChartTime(row.time)));
    fixedProfileRanges = fixedProfileRanges.filter((range) => times.has(range.from) && times.has(range.to));
    if (!fixedProfileRanges.length) {
      clearFixedRangeVolumeProfile({ silent: true });
      return;
    }
    if (!fixedProfileRanges.some((range) => range.id === selectedFixedProfileId)) {
      selectedFixedProfileId = fixedProfileRanges[fixedProfileRanges.length - 1].id;
    }
    saveFixedProfileState();
  }

  function nearestCandleIndexForClientX(clientX) {
    const rect = surface.getBoundingClientRect();
    const candle = nearestCandleForCoordinate(clientX - rect.left);
    return candle ? candleIndexForTime(candle.time) : -1;
  }

  function updateFixedProfileRange(rangeId, from, to) {
    const normalizedFrom = Math.min(normalizeChartTime(from), normalizeChartTime(to));
    const normalizedTo = Math.max(normalizeChartTime(from), normalizeChartTime(to));
    const current = fixedProfileRanges.find((range) => range.id === rangeId);
    const nextRange = recalculateFixedProfileRange(normalizedFrom, normalizedTo, current);
    if (!nextRange) return false;
    fixedProfileRanges = fixedProfileRanges.map((range) => (range.id === rangeId ? nextRange : range));
    saveFixedProfileState();
    return true;
  }

  function startFixedProfileDrag(event, rangeId, mode) {
    if (!isFixedProfileAvailable()) return;
    const range = fixedProfileRanges.find((item) => item.id === rangeId);
    if (!range) return;
    const startIndex = nearestCandleIndexForClientX(event.clientX);
    const originalFromIndex = candleIndexForTime(range.from);
    const originalToIndex = candleIndexForTime(range.to);
    if (startIndex < 0 || originalFromIndex < 0 || originalToIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectedFixedProfileId = rangeId;
    fixedProfileDragState = {
      rangeId,
      mode,
      startIndex,
      originalFromIndex: Math.min(originalFromIndex, originalToIndex),
      originalToIndex: Math.max(originalFromIndex, originalToIndex),
    };
    document.addEventListener("pointermove", updateFixedProfileDrag);
    document.addEventListener("pointerup", finishFixedProfileDrag);
    document.addEventListener("pointercancel", finishFixedProfileDrag);
    status.textContent = mode === "move" ? "固定範圍 VP：拖曳平移中" : "固定範圍 VP：拖曳調整中";
    renderFixedRangeVolumeProfile();
  }

  function updateFixedProfileDrag(event) {
    if (!fixedProfileDragState) return;
    event.preventDefault();
    const candles = lastPayload?.candles || [];
    if (candles.length < 2) return;
    const currentIndex = nearestCandleIndexForClientX(event.clientX);
    if (currentIndex < 0) return;
    const { rangeId, mode, startIndex, originalFromIndex, originalToIndex } = fixedProfileDragState;
    let nextFromIndex = originalFromIndex;
    let nextToIndex = originalToIndex;
    if (mode === "resize-left") {
      nextFromIndex = Math.max(0, Math.min(currentIndex, originalToIndex - 1));
    } else if (mode === "resize-right") {
      nextToIndex = Math.min(candles.length - 1, Math.max(currentIndex, originalFromIndex + 1));
    } else {
      const span = Math.max(1, originalToIndex - originalFromIndex);
      const delta = currentIndex - startIndex;
      nextFromIndex = Math.max(0, Math.min(candles.length - 1 - span, originalFromIndex + delta));
      nextToIndex = nextFromIndex + span;
    }
    const fromCandle = candleAtIndex(nextFromIndex);
    const toCandle = candleAtIndex(nextToIndex);
    if (!fromCandle || !toCandle) return;
    if (updateFixedProfileRange(rangeId, fromCandle.time, toCandle.time)) {
      fixedProfileLastError = "";
      renderFixedRangeVolumeProfile();
      publishQuoteChartDebugReport();
    }
  }

  function finishFixedProfileDrag() {
    if (!fixedProfileDragState) return;
    fixedProfileDragState = undefined;
    document.removeEventListener("pointermove", updateFixedProfileDrag);
    document.removeEventListener("pointerup", finishFixedProfileDrag);
    document.removeEventListener("pointercancel", finishFixedProfileDrag);
    status.textContent = fixedProfileRanges.length ? "固定範圍 VP 已更新" : status.textContent;
    renderFixedRangeVolumeProfile();
    publishQuoteChartDebugReport();
  }

  function refreshPanelLayout() {
    if (!isPanelActive() || !chart) {
      pendingPanelViewportSnapshot = undefined;
      return;
    }
    const viewportSnapshot = pendingPanelViewportSnapshot;
    pendingPanelViewportSnapshot = undefined;
    const visibleLogicalRange = chart.timeScale().getVisibleLogicalRange?.();
    chart.resize(surface.clientWidth, surface.clientHeight);
    if (indicatorChart && isTechnicalSubchartVisible()) indicatorChart.resize(indicatorSurface.clientWidth, indicatorSurface.clientHeight);
    chipPaneManager?.resize();
    syncIndicatorTimeAnchor();
    if (viewportSnapshot) {
      restoreViewportSnapshot(viewportSnapshot, lastPayload?.candles || []);
      normalizePaneCoordinateAlignment(latestCandleTime());
    } else if (isFiniteLogicalRange(visibleLogicalRange)) setSynchronizedVisibleLogicalRange(visibleLogicalRange);
    scheduleQuoteTimeFit();
    scheduleRenderedAxisSafeWidthSync();
    scheduleOverlayRender();
    if (sharedHoverTime !== undefined) positionSharedCrosshair(sharedHoverTime);
  }

  function currentPriceScaleMinWidth() {
    return priceScaleMinWidth;
  }

  function priceScaleMinWidthForCandles(candles = []) {
    const latestClose = Number(candles[candles.length - 1]?.close);
    if (Number.isFinite(latestClose) && Math.abs(latestClose) >= 1000) {
      return WIDE_PRICE_SCALE_MIN_WIDTH;
    }
    return SHARED_PRICE_SCALE_MIN_WIDTH;
  }

  function syncPriceScaleMinWidth(candles = []) {
    const nextWidth = priceScaleMinWidthForCandles(candles);
    priceScaleMinWidth = nextWidth;
    element.style.setProperty("--axis-safe-width", `${nextWidth}px`);
    chart?.applyOptions({ rightPriceScale: { borderVisible: false, minimumWidth: nextWidth } });
    indicatorChart?.applyOptions({ rightPriceScale: { borderVisible: false, minimumWidth: nextWidth } });
    chipPaneManager?.setAxisSafeWidth(nextWidth);
  }

  function scheduleRenderedAxisSafeWidthSync() {
    if (axisSafeWidthFrame) panelLifecycle.cancelFrame(axisSafeWidthFrame);
    axisSafeWidthFrame = panelLifecycle.requestFrame(() => {
      axisSafeWidthFrame = panelLifecycle.requestFrame(() => {
        axisSafeWidthFrame = 0;
        if (!isPanelActive()) return;
        syncRenderedAxisSafeWidth();
        normalizePaneCoordinateAlignment();
        scheduleOverlayRender();
        scheduleAlignmentMeasurement();
      });
    });
  }

  function syncRenderedAxisSafeWidth() {
    if (!isPanelActive()) return;
    const renderedWidth = Math.ceil(Math.max(
      priceScaleMinWidth,
      measureRenderedAxisSafeWidth(surface),
      isTechnicalSubchartVisible() ? measureRenderedAxisSafeWidth(indicatorSurface) : 0,
      chipPaneManager?.measureAxisSafeWidth?.() || 0,
    ));
    if (!Number.isFinite(renderedWidth) || renderedWidth <= 0) return;
    element.style.setProperty("--axis-safe-width", `${renderedWidth}px`);
    chipPaneManager?.setAxisSafeWidth(renderedWidth);
    if (renderedWidth <= priceScaleMinWidth || !chart) return;
    const visibleLogicalRange = chart.timeScale().getVisibleLogicalRange?.();
    priceScaleMinWidth = renderedWidth;
    isSyncingTimeScale = true;
    chart.applyOptions({ rightPriceScale: { borderVisible: false, minimumWidth: renderedWidth } });
    indicatorChart?.applyOptions({ rightPriceScale: { borderVisible: false, minimumWidth: renderedWidth } });
    if (isFiniteLogicalRange(visibleLogicalRange)) {
      chart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
      if (indicatorChart && isTechnicalSubchartVisible()) indicatorChart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
      chipPaneManager?.syncRange(visibleLogicalRange);
    }
    releaseTimeScaleSyncAfterFrame();
  }

  function measureRenderedAxisSafeWidth(root) {
    const table = root?.querySelector(".tv-lightweight-charts table");
    if (!table) return 0;
    const widths = [...table.querySelectorAll("tr")]
      .map((row) => row.lastElementChild?.getBoundingClientRect().width || 0)
      .filter((width) => Number.isFinite(width) && width > 0);
    return Math.max(0, ...widths);
  }

  function normalizePaneCoordinateAlignment() {
    if (!chart) return;
    const mainRange = chart.timeScale().getVisibleLogicalRange?.();
    if (!isFiniteLogicalRange(mainRange)) return;
    isSyncingTimeScale = true;
    if (indicatorChart && isTechnicalSubchartVisible()) indicatorChart.timeScale().setVisibleLogicalRange(mainRange);
    chipPaneManager?.syncRange?.(mainRange);
    releaseTimeScaleSyncAfterFrame();
  }

  function visibleRangeForCandles(candles) {
    const times = (candles || []).map((row) => Number(row.time)).filter(Number.isFinite);
    if (times.length < 2) return undefined;
    const from = times[0];
    const to = times[times.length - 1];
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return undefined;
    return { from, to };
  }

  function visibleLogicalRangeForCandles(candles, rightOffsetBars = 0) {
    const count = (candles || []).length;
    if (count < 2) return undefined;
    return { from: 0, to: count - 1 + rightOffsetBars };
  }

  function isFiniteLogicalRange(range) {
    return Number.isFinite(Number(range?.from)) && Number.isFinite(Number(range?.to)) && Number(range.from) < Number(range.to);
  }

  function isValidTimeRange(range) {
    return range?.from !== undefined && range?.to !== undefined && range.from !== null && range.to !== null;
  }

  function setTimeScaleRangeForCandles(targetChart, range, candles) {
    if (!targetChart) return;
    const logicalRange = visibleLogicalRangeForCandles(candles, RIGHT_OFFSET_BARS);
    if (logicalRange) {
      targetChart.timeScale().setVisibleLogicalRange(logicalRange);
      return;
    }
    if (range) {
      try {
        targetChart.timeScale().setVisibleRange(range);
        return;
      } catch (error) {
        const fallbackRange = visibleLogicalRangeForCandles(candles);
        if (!fallbackRange) throw error;
        targetChart.timeScale().setVisibleLogicalRange(fallbackRange);
        return;
      }
    }
    const fallbackRange = visibleLogicalRangeForCandles(candles);
    if (fallbackRange) targetChart.timeScale().setVisibleLogicalRange(fallbackRange);
  }

  function setLogicalTimeScaleRangeForCandles(targetChart, candles) {
    if (!targetChart) return;
    const range = visibleRangeForCandles(candles);
    if (range) {
      setTimeScaleRangeForCandles(targetChart, range, candles);
      return;
    }
    const logicalRange = visibleLogicalRangeForCandles(candles, RIGHT_OFFSET_BARS);
    if (isFiniteLogicalRange(logicalRange)) targetChart.timeScale().setVisibleLogicalRange(logicalRange);
  }

  function releaseTimeScaleSyncAfterFrame() {
    if (timeScaleSyncReleaseFrame) panelLifecycle.cancelFrame(timeScaleSyncReleaseFrame);
    timeScaleSyncReleaseFrame = panelLifecycle.requestFrame(() => {
      timeScaleSyncReleaseFrame = 0;
      isSyncingTimeScale = false;
    });
  }

  function refitTimeScalesToCandles(candles = lastPayload?.candles || []) {
    if (!chart) return;
    const range = visibleRangeForCandles(candles);
    const logicalRange = visibleLogicalRangeForCandles(candles, RIGHT_OFFSET_BARS);
    isSyncingTimeScale = true;
    try {
      if (isFiniteLogicalRange(logicalRange)) {
        applyPayloadStep("main-logical-range", () => chart.timeScale().setVisibleLogicalRange(logicalRange));
        if (indicatorChart && isTechnicalSubchartVisible()) {
          applyPayloadStep("indicator-logical-range", () => indicatorChart.timeScale().setVisibleLogicalRange(logicalRange));
        }
        applyPayloadStep("chip-logical-range", () => chipPaneManager?.syncRange?.(logicalRange));
      } else {
        setTimeScaleRangeForCandles(chart, range, candles);
        if (indicatorChart && isTechnicalSubchartVisible()) setLogicalTimeScaleRangeForCandles(indicatorChart, candles);
        chart.timeScale().fitContent();
        if (indicatorChart && isTechnicalSubchartVisible()) indicatorChart.timeScale().fitContent();
      }
      applyPayloadStep("indicator-range-sync", () => syncIndicatorVisibleRangeToMain());
    } finally {
      releaseTimeScaleSyncAfterFrame();
    }
    scheduleOverlayRender();
  }

  function applyPreservedVisibleLogicalRange(range, oldCandleCount, newCandleCount) {
    if (!isFiniteLogicalRange(range) || !Number.isFinite(Number(oldCandleCount))) return;
    const addedCandles = Math.max(0, newCandleCount - oldCandleCount);
    const preservedRange = {
      from: Number(range.from) + addedCandles,
      to: Number(range.to) + addedCandles,
    };
    setSynchronizedVisibleLogicalRange(preservedRange);
  }

  function captureViewportSnapshot(candles = lastPayload?.candles || []) {
    const range = chart?.timeScale().getVisibleLogicalRange?.();
    if (!isFiniteLogicalRange(range) || !candles.length) return undefined;
    const fromIndex = Math.max(0, Math.min(candles.length - 1, Math.floor(Number(range.from))));
    const toIndex = Math.max(0, Math.min(candles.length - 1, Math.ceil(Number(range.to))));
    return {
      fromTime: normalizeChartTime(candles[fromIndex]?.time),
      toTime: normalizeChartTime(candles[toIndex]?.time),
      fromFraction: Number(range.from) - fromIndex,
      toFraction: Number(range.to) - toIndex,
      span: Number(range.to) - Number(range.from),
      rightAttached: Number(range.to) >= candles.length - 1 + RIGHT_OFFSET_BARS - 1,
      barSpacing: Number(chart?.timeScale().options?.().barSpacing),
    };
  }

  function restoreViewportSnapshot(snapshot, candles = []) {
    if (!snapshot || !candles.length || !chart) return;
    if (Number.isFinite(snapshot.barSpacing)) chart.timeScale().applyOptions({ barSpacing: snapshot.barSpacing });
    const timeIndex = new Map(candles.map((row, index) => [normalizeChartTime(row.time), index]));
    const fromIndex = timeIndex.get(snapshot.fromTime);
    const toIndex = timeIndex.get(snapshot.toTime);
    let range;
    if (snapshot.rightAttached) {
      const to = candles.length - 1 + RIGHT_OFFSET_BARS;
      range = { from: to - snapshot.span, to };
    } else if (Number.isFinite(fromIndex) && Number.isFinite(toIndex)) {
      range = {
        from: fromIndex + snapshot.fromFraction,
        to: toIndex + snapshot.toFraction,
      };
    } else if (Number.isFinite(toIndex)) {
      const to = toIndex + snapshot.toFraction;
      range = { from: to - snapshot.span, to };
    } else if (Number.isFinite(fromIndex)) {
      const from = fromIndex + snapshot.fromFraction;
      range = { from, to: from + snapshot.span };
    }
    if (isFiniteLogicalRange(range)) setSynchronizedVisibleLogicalRange(range);
  }

  function setSynchronizedVisibleLogicalRange(range) {
    if (!isFiniteLogicalRange(range) || !chart) return;
    isSyncingTimeScale = true;
    try {
      chart.timeScale().setVisibleLogicalRange(range);
      if (indicatorChart && isTechnicalSubchartVisible()) indicatorChart.timeScale().setVisibleLogicalRange(range);
      chipPaneManager?.syncRange(range);
    } finally {
      releaseTimeScaleSyncAfterFrame();
    }
    scheduleOverlayRender();
  }

  function setSynchronizedVisibleTimeRange(range, preferredLogicalRange) {
    if (!isValidTimeRange(range) || !chart) return;
    const fallbackLogicalRange = isFiniteLogicalRange(preferredLogicalRange)
      ? preferredLogicalRange
      : chart.timeScale().getVisibleLogicalRange?.();
    isSyncingTimeScale = true;
    try {
      chart.timeScale().setVisibleRange(range);
      if (indicatorChart && isTechnicalSubchartVisible()) {
        try { indicatorChart.timeScale().setVisibleRange(range); } catch {}
        if (isFiniteLogicalRange(fallbackLogicalRange)) indicatorChart.timeScale().setVisibleLogicalRange(fallbackLogicalRange);
        else setLogicalTimeScaleRangeForCandles(indicatorChart, lastPayload?.candles || []);
      }
      chipPaneManager?.syncTimeRange?.(range);
      if (isFiniteLogicalRange(fallbackLogicalRange)) {
        chart.timeScale().setVisibleLogicalRange(fallbackLogicalRange);
        chipPaneManager?.syncRange?.(fallbackLogicalRange);
      }
    } finally {
      releaseTimeScaleSyncAfterFrame();
    }
    scheduleOverlayRender();
  }

  function syncIndicatorVisibleRangeToMain() {
    if (!chart || !indicatorChart || !isTechnicalSubchartVisible()) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    if (isFiniteLogicalRange(range)) indicatorChart.timeScale().setVisibleLogicalRange(range);
  }

  function scheduleHistoryLoadForRange(range) {
    if (!isFiniteLogicalRange(range) || !lastPayload || historyLoadInFlight || !historyHasMoreBefore) return;
    if (!historyInteractionArmed) return;
    const currentCount = (lastPayload.candles || []).length;
    if (currentCount <= 0 || currentCount >= MAX_HISTORY_DISPLAY_CANDLES) {
      historyHasMoreBefore = false;
      return;
    }
    const visibleBars = Number(range.to) - Number(range.from);
    if (range.from >= 0 && range.to <= currentCount - 1 && visibleBars <= currentCount - 1) return;
    if (range.from > HISTORY_PREFETCH_THRESHOLD_BARS && visibleBars <= currentCount - 1) return;
    if (historyLoadTimer) panelLifecycle.clearTimer(historyLoadTimer);
    const anchorRange = { from: Number(range.from), to: Number(range.to) };
    historyLoadTimer = panelLifecycle.setTimer(() => {
      historyLoadTimer = 0;
      if (!isPanelActive()) return;
      loadMoreHistoricalCandles(anchorRange);
    }, HISTORY_LOAD_DEBOUNCE_MS);
  }

  async function loadMoreHistoricalCandles(anchorRange) {
    if (!isPanelActive() || historyLoadInFlight || !historyHasMoreBefore) return;
    const currentCount = (lastPayload?.candles || []).length;
    const nextDisplayCount = Math.min(MAX_HISTORY_DISPLAY_CANDLES, currentCount + HISTORY_LOAD_BATCH_BARS);
    if (nextDisplayCount <= currentCount) return;
    const currentLoadToken = loadToken;
    const symbol = symbolSelect.value;
    const interval = intervalSelect.value;
    historyLoadInFlight = true;
    try {
      const pivotMode = selectedPivotMode();
      const { response, payload } = await fetchJsonWithTimeout(withPanelIndicatorParameters(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&display_count=${encodeURIComponent(nextDisplayCount)}`), PANEL_HISTORY_LOAD_TIMEOUT_MS);
      if (!response.ok || payload.error) throw new Error(payload.error || "歷史資料補載失敗");
      if (destroyed || currentLoadToken !== loadToken || symbol !== symbolSelect.value || interval !== intervalSelect.value) return;
      const nextCount = (payload.candles || []).length;
      if (nextCount <= currentCount) {
        historyHasMoreBefore = false;
        return;
      }
      const preserveVisibleLogicalRange = chart?.timeScale().getVisibleLogicalRange() || anchorRange;
      const preparedPayload = preparePanelPayload(payload);
      applyPayload(preparedPayload, { prepared: true, preserveVisibleLogicalRange, oldCandleCount: currentCount });
      writePanelPayloadCache(symbol, interval, preparedPayload, pivotMode);
      historyHasMoreBefore = Boolean(payload.dataWindow?.hasMoreBefore);
      if (nextCount >= MAX_HISTORY_DISPLAY_CANDLES) historyHasMoreBefore = false;
      status.textContent = `${symbol} / ${formatIntervalLabel(interval)} 已補載 ${nextCount} 根K線`;
      status.classList.remove("is-visible");
    } catch (error) {
      if (!destroyed && currentLoadToken === loadToken) {
        status.textContent = `補載失敗：${formatLoadErrorMessage(error)}`;
        status.classList.add("is-visible");
      }
    } finally {
      historyLoadInFlight = false;
    }
  }

  function attachIndicatorChartSync() {
    if (!indicatorChart) return;
    indicatorChart.subscribeCrosshairMove(handleIndicatorCrosshairMove);
    indicatorChart.timeScale().subscribeVisibleLogicalRangeChange(handleIndicatorVisibleLogicalRangeChange);
  }

  function handleMainVisibleLogicalRangeChange(range) {
    if (!isPanelActive() || isSyncingTimeScale) return;
    scheduleOverlayRender();
    scheduleAlignmentMeasurement();
    scheduleHistoryLoadForRange(range);
    const timeRange = chart?.timeScale().getVisibleRange?.();
    if (isValidTimeRange(timeRange)) setSynchronizedVisibleTimeRange(timeRange, range);
    else {
      if (isTechnicalSubchartVisible()) syncVisibleLogicalRange(range, indicatorChart);
      chipPaneManager?.syncRange(range);
    }
  }

  function handleIndicatorVisibleLogicalRangeChange(range) {
    if (!isPanelActive() || isSyncingTimeScale) return;
    scheduleOverlayRender();
    scheduleAlignmentMeasurement();
    const timeRange = indicatorChart?.timeScale().getVisibleRange?.();
    if (isValidTimeRange(timeRange)) setSynchronizedVisibleTimeRange(timeRange, range);
    else syncVisibleLogicalRange(range, chart);
  }

  function syncVisibleLogicalRange(range, targetChart) {
    if (!isPanelActive() || !isFiniteLogicalRange(range) || !targetChart || isSyncingTimeScale) return;
    isSyncingTimeScale = true;
    targetChart.timeScale().setVisibleLogicalRange(range);
    isSyncingTimeScale = false;
    if (sharedHoverTime !== undefined) syncCrosshairForTime(sharedHoverTime);
  }

  function scheduleTimeScaleRefit() {
    if (historyInteractionArmed) return;
    if (timeScaleFitFrame) panelLifecycle.cancelFrame(timeScaleFitFrame);
    timeScaleFitFrame = panelLifecycle.requestFrame(() => {
      timeScaleFitFrame = panelLifecycle.requestFrame(() => {
        timeScaleFitFrame = 0;
        if (isPanelActive() && !historyInteractionArmed) {
          syncIndicatorTimeAnchor();
          refitTimeScalesToCandles();
          publishQuoteChartDebugReport();
        }
      });
    });
  }

  function cancelScheduledTimeScaleRefit() {
    if (!timeScaleFitFrame) return;
    panelLifecycle.cancelFrame(timeScaleFitFrame);
    timeScaleFitFrame = 0;
  }

  function schedulePanelLayoutRefresh({ preserveViewport = false } = {}) {
    if (preserveViewport && !pendingPanelViewportSnapshot) {
      pendingPanelViewportSnapshot = captureViewportSnapshot(lastPayload?.candles || []);
    }
    if (panelLayoutFrame) return;
    panelLayoutFrame = panelLifecycle.requestFrame(() => {
      panelLayoutFrame = 0;
      if (isPanelActive()) refreshPanelLayout();
    });
  }

  function scheduleAlignmentMeasurement() {
    if (alignmentFrame) panelLifecycle.cancelFrame(alignmentFrame);
    alignmentFrame = panelLifecycle.requestFrame(() => {
      alignmentFrame = panelLifecycle.requestFrame(() => {
        alignmentFrame = 0;
        if (isPanelActive()) publishQuoteChartDebugReport();
      });
    });
  }

  function alignmentProbeTimes(candles = lastPayload?.candles || []) {
    if (!candles.length) return [];
    const middleIndex = Math.floor((candles.length - 1) / 2);
    const probes = [
      { label: "first", time: candles[0]?.time },
      { label: "middle", time: candles[middleIndex]?.time },
      { label: "last", time: candles[candles.length - 1]?.time },
    ];
    const seen = new Set();
    return probes.filter((probe) => {
      const key = normalizeChartTime(probe.time);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function rectReport(rect) {
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
    };
  }

  function measurePaneCoordinateForTime(time, label = "custom") {
    const errors = [];
    if (!chart) errors.push("chart not ready");
    if (isTechnicalSubchartVisible() && !indicatorChart) errors.push("indicator chart missing");
    if (!time) errors.push("time missing");
    if (errors.length) return { label, time, pass: false, errors };
    const mainCoordinate = chart.timeScale().timeToCoordinate(time);
    const mainRect = surface.getBoundingClientRect();
    const mainScreenX = Number.isFinite(mainCoordinate) ? mainRect.left + mainCoordinate : null;
    const coordinates = [{ paneId: "main", coordinate: mainCoordinate, screenX: mainScreenX, plotRect: rectReport(mainRect) }];
    let indicatorCoordinate = null;
    let indicatorScreenX = null;
    let indicatorRect = null;
    if (isTechnicalSubchartVisible() && indicatorChart) {
      indicatorCoordinate = indicatorChart.timeScale().timeToCoordinate(time);
      indicatorRect = indicatorSurface.getBoundingClientRect();
      indicatorScreenX = Number.isFinite(indicatorCoordinate) ? indicatorRect.left + indicatorCoordinate : null;
      coordinates.push({ paneId: "technical", coordinate: indicatorCoordinate, screenX: indicatorScreenX, plotRect: rectReport(indicatorRect) });
    }
    const chipCoordinates = chipPaneManager?.measureCoordinates(time) || [];
    coordinates.push(...chipCoordinates);
    const invalid = coordinates.filter((item) => !Number.isFinite(item.coordinate) || !Number.isFinite(item.screenX));
    if (invalid.length) errors.push(`time not visible: ${invalid.map((item) => item.paneId).join(",")}`);
    const screenXs = coordinates.map((item) => item.screenX).filter(Number.isFinite);
    const delta = screenXs.length > 1 ? Math.max(...screenXs) - Math.min(...screenXs) : 0;
    return {
      label,
      time,
      mainCoordinate,
      indicatorCoordinate,
      mainScreenX,
      indicatorScreenX,
      delta,
      pass: errors.length === 0 && delta <= ALIGNMENT_DELTA_LIMIT_PX,
      mainPlotRect: rectReport(mainRect),
      indicatorPlotRect: indicatorRect ? rectReport(indicatorRect) : null,
      chipCoordinates,
      coordinates,
      errors,
    };
  }

  function measureRightGapForLatestCandle(candles = lastPayload?.candles || []) {
    const latest = candles[candles.length - 1];
    if (!chart || !latest?.time) {
      return { pass: false, errors: ["latest candle missing"] };
    }
    const coordinate = chart.timeScale().timeToCoordinate(latest.time);
    if (!Number.isFinite(coordinate)) {
      return { pass: false, time: latest.time, coordinate, errors: ["latest candle not visible"] };
    }
    const rect = surface.getBoundingClientRect();
    const barSpacing = Number(chart.timeScale().options().barSpacing) || 1;
    const rightGapPx = Math.max(0, rect.width - getAxisSafeWidth() - coordinate);
    const rightGap = rightGapPx;
    const rightGapBars = rightGap / barSpacing;
    const visualBarSpacing = Math.max(barSpacing, RIGHT_GAP_MEASUREMENT_BAR_WIDTH);
    const visualRightGapBars = rightGapPx / visualBarSpacing;
    return {
      time: latest.time,
      coordinate,
      rightGap,
      rightGapPx,
      barSpacing,
      rightGapBars,
      visualRightGapBars,
      visualBarSpacing,
      pass: rightGapPx >= MIN_RIGHT_GAP_PX
        && rightGapBars >= MIN_RIGHT_GAP_BARS
        && visualRightGapBars <= MAX_RIGHT_GAP_BARS
        && rightGapPx <= MAX_RIGHT_GAP_PX,
      errors: [],
    };
  }

  function alignmentReport() {
    const candles = lastPayload?.candles || [];
    const dataWindow = lastPayload?.dataWindow || {};
    const visibleLogicalRange = chart?.timeScale().getVisibleLogicalRange?.();
    const measurements = alignmentProbeTimes(candles).map((probe) => measurePaneCoordinateForTime(probe.time, probe.label));
    const errors = [];
    if (!lastPayload) errors.push("not loaded");
    if (!candles.length) errors.push("no candles");
    const lastMeasurement = measurements.find((measurement) => measurement.label === "last") || measurements[measurements.length - 1];
    const rightGap = measureRightGapForLatestCandle(candles);
    const fixedProfile = fixedProfileDebugReport();
    return {
      panelIndex: panelPosition,
      canonicalIdentity,
      canonicalSymbol: canonicalItemSymbol,
      displaySymbol: symbolSelect.value,
      symbol: symbolSelect.value,
      interval: intervalSelect.value,
      realtimeState: realtimeDisplayState,
      intraday: element.classList.contains("is-intraday"),
      symbol: symbolSelect.value,
      marketTab: state.activeMarketTab,
      chartCount: Number(document.getElementById("chart-count")?.value || state.panels.length),
      mode: isSingleChartViewActive() ? "single" : "grid",
      loaded: Boolean(lastPayload && candles.length),
      candleCount: candles.length,
      dataWindow,
      rawCandles: dataWindow.rawCandles ?? null,
      displayCandles: dataWindow.displayCandles ?? candles.length,
      availableWarmupCandles: dataWindow.availableWarmupCandles ?? 0,
      insufficientWarmup: Boolean(dataWindow.insufficientWarmup),
      warmupStatus: dataWindow.warmupStatus || "unknown",
      latestTime: latestCandleTime() || null,
      visibleLogicalRange: isFiniteLogicalRange(visibleLogicalRange)
        ? { from: Number(visibleLogicalRange.from), to: Number(visibleLogicalRange.to) }
        : null,
      selectedSubIndicators: [...getSelectedSubIndicators()],
      indicatorSeriesCount: indicatorSeries.length,
      indicatorSeriesPointCounts: { ...indicatorSeriesPointCounts },
      indicatorRecoveryCount,
      hasIndicatorTimeAnchor: Boolean(indicatorTimeAnchorSeries),
      mainVisibleTimeRange: chart?.timeScale().getVisibleRange?.() || null,
      indicatorVisibleLogicalRange: indicatorChart?.timeScale().getVisibleLogicalRange?.() || null,
      indicatorVisibleTimeRange: indicatorChart?.timeScale().getVisibleRange?.() || null,
      measurements,
      alignment: lastMeasurement,
      delta: lastMeasurement?.delta ?? null,
      rightGap,
      axisSafeWidth: getAxisSafeWidth(),
      rightGapBars: rightGap?.rightGapBars ?? null,
      rightGapPass: rightGap?.pass ?? false,
      fixedRangeVolumeProfile: fixedProfile,
      pass: Boolean(measurements.length) && measurements.every((measurement) => measurement.pass) && rightGap?.pass && fixedProfile.pass,
      errors,
    };
  }

  function viewStateReport() {
    const candles = lastPayload?.candles || [];
    const first = candles[0];
    const latest = candles[candles.length - 1];
    const visibleLogicalRange = chart?.timeScale().getVisibleLogicalRange?.();
    return {
      panelIndex: panelPosition,
      canonicalIdentity,
      canonicalSymbol: canonicalItemSymbol,
      displaySymbol: symbolSelect.value,
      symbol: symbolSelect.value,
      interval: intervalSelect.value,
      realtimeState: realtimeDisplayState,
      intraday: element.classList.contains("is-intraday"),
      loaded: Boolean(lastPayload && candles.length),
      candleCount: candles.length,
      visibleLogicalRange: isFiniteLogicalRange(visibleLogicalRange)
        ? { from: Number(visibleLogicalRange.from), to: Number(visibleLogicalRange.to) }
        : null,
      barSpacing: Number(chart?.timeScale().options?.().barSpacing ?? NaN),
      firstCoordinate: first?.time ? chart?.timeScale().timeToCoordinate(first.time) : null,
      latestCoordinate: latest?.time ? chart?.timeScale().timeToCoordinate(latest.time) : null,
      chipPanes: chipPaneManager?.report?.(),
    };
  }

  function assertPaneCoordinateAlignment(time = sharedHoverTime || latestCandleTime()) {
    return measurePaneCoordinateForTime(time, "assert");
  }

  function getSelectedMainIndicators() {
    return new Set(mainIndicatorInputs.filter((input) => input.checked).map((input) => input.value));
  }

  function selectedPivotMode() {
    return getSelectedMainIndicators().has("pivotPoint") ? "traditional" : null;
  }

  function withPanelIndicatorParameters(url) {
    const parameterized = withIndicatorParameters(url);
    return selectedPivotMode() === "traditional" ? `${parameterized}&pivot=traditional` : parameterized;
  }

  function estimatedMarginCostStorageKey(symbol) {
    return `quoteChart.estimatedMarginCost.v1:${String(state.activeMarketTabId || "default")}:${canonicalSymbol(symbol)}`;
  }

  function restoreEstimatedMarginCostSelection(symbol, interval) {
    const input = mainIndicatorInputs.find((candidate) => candidate.value === "estimatedMarginCost");
    if (!input) return;
    const eligible = interval === "1d" && isTaiwanStockSymbol(symbol);
    input.disabled = !eligible;
    input.checked = eligible && localStorage.getItem(estimatedMarginCostStorageKey(symbol)) === "true";
    input.title = eligible ? "以融資流量與日收盤價估算，並非實際融資成交均價" : "僅支援台股普通股與 ETF 日 K";
  }

  function chartSessionDate(time) {
    if (typeof time === "number") return new Date(time * 1000).toISOString().slice(0, 10);
    if (typeof time === "string") return time.slice(0, 10);
    if (time && typeof time === "object" && "year" in time) {
      return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
    }
    return "";
  }

  function clearEstimatedMarginCost() {
    estimatedMarginAbortController?.abort();
    estimatedMarginAbortController = undefined;
    estimatedMarginRequestId += 1;
    estimatedMarginRowsByDate = new Map();
    if (estimatedMarginCostSeries && chart) {
      mainLineCrosshairMarkerDefaults.delete(estimatedMarginCostSeries);
      try { chart.removeSeries(estimatedMarginCostSeries); } catch {}
    }
    estimatedMarginCostSeries = undefined;
  }

  async function renderEstimatedMarginCost(candles, enabled) {
    clearEstimatedMarginCost();
    if (!enabled || !candles.length || intervalSelect.value !== "1d" || !isTaiwanStockSymbol(symbolSelect.value)) return;
    const requestId = ++estimatedMarginRequestId;
    estimatedMarginAbortController = new AbortController();
    const symbol = symbolSelect.value;
    try {
      const payload = await window.QuoteChartChipPanes?.requestData?.({
        symbol,
        interval: "1d",
        datasets: ["margin-short"],
        candles,
        signal: estimatedMarginAbortController.signal,
      });
      if (destroyed || requestId !== estimatedMarginRequestId || symbol !== symbolSelect.value || !chart) return;
      const timeMap = new Map(candles.map((row) => [chartSessionDate(row.time), row.time]).filter(([date]) => date));
      const rows = (payload?.rows || []).filter((row) => row?.sessionDate);
      estimatedMarginRowsByDate = new Map(rows.map((row) => [row.sessionDate, row.marginShort || null]));
      const data = rows.flatMap((row) => {
        const value = Number(row.marginShort?.estimatedCostPrice);
        const time = timeMap.get(row.sessionDate);
        if (!time) return [];
        return Number.isFinite(value) && value > 0 ? [{ time, value }] : [{ time }];
      });
      if (!data.some((item) => Number.isFinite(item.value))) return;
      estimatedMarginCostSeries = addLine(data, "#fb7185", 2, {
        lineStyle: LightweightCharts.LineStyle?.Dashed ?? 2,
        title: "估算融資成本",
      });
    } catch (error) {
      if (error?.name !== "AbortError" && requestId === estimatedMarginRequestId) estimatedMarginRowsByDate = new Map();
    }
  }

  function getSelectedSubIndicators() {
    return new Set(subIndicatorInputs.filter((input) => input.checked).map((input) => input.value));
  }

  function drawBollinger(bands) {
    const values = [bands.upper || [], bands.middle || [], bands.lower || []];
    if (bollingerSeries.length !== values.length) {
      clearBollinger();
      bollingerSeries = [
        addLine(values[0], BOLLINGER_EDGE_COLOR, 1, { lineStyle: BOLLINGER_EDGE_LINE_STYLE }),
        addLine(values[1], BOLLINGER_EDGE_COLOR, 1),
        addLine(values[2], BOLLINGER_EDGE_COLOR, 1, { lineStyle: BOLLINGER_EDGE_LINE_STYLE }),
      ];
      return;
    }
    values.forEach((data, index) => bollingerSeries[index].setData(window.QuoteChartPayload.normalizeValueSeries(data)));
  }

  function clearBollinger() {
    bollingerSeries = removeMainSeries(bollingerSeries);
  }

  function drawMovingAverage(averages) {
    const values = [averages.ma5 || [], averages.ma10 || [], averages.ma20 || [], averages.ma60 || [], averages.ma120 || []];
    if (movingAverageSeries.length !== values.length) {
      clearMovingAverage();
      movingAverageSeries = [
        addLine(values[0], MOVING_AVERAGE_STYLES.ma5.color, 1),
        addLine(values[1], MOVING_AVERAGE_STYLES.ma10.color, 1),
        addLine(values[2], MOVING_AVERAGE_STYLES.ma20.color, 1),
        addLine(values[3], MOVING_AVERAGE_STYLES.ma60.color, 1),
        addLine(values[4], MOVING_AVERAGE_STYLES.ma120.color, 1),
      ];
      return;
    }
    values.forEach((data, index) => movingAverageSeries[index].setData(window.QuoteChartPayload.normalizeValueSeries(data)));
  }

  function clearMovingAverage() {
    movingAverageSeries = removeMainSeries(movingAverageSeries);
  }

  function drawPivotPoints(pivotPoints) {
    if (
      pivotPoints?.type !== "traditional"
      || pivotPoints?.contractVersion !== "selected-next-period-v1"
      || pivotPoints?.status !== "available"
    ) {
      clearPivotPoints();
      return;
    }
    pivotProjectionByPeriod = new Map((pivotPoints.projections || []).map((projection) => [projection.referencePeriodKey, projection]));
    pivotTargetPeriodByTime = new Map((pivotPoints.targets || []).map((target) => [normalizeChartTime(target.time), target.referencePeriodKey]));
    if (!pivotProjectionByPeriod.has(pivotSelectedReferenceKey)) {
      pivotSelectionPinned = false;
      selectDefaultPivotProjection({ render: false });
    } else if (!Number.isFinite(Number(pivotSelectedAnchorTime))) {
      pivotSelectedAnchorTime = latestPivotAnchorTime(pivotSelectedReferenceKey);
    }
    updatePivotAutoScale();
    updatePivotReadout();
    renderPivotPointOverlay();
  }

  function clearPivotPoints() {
    pivotProjectionByPeriod = new Map();
    pivotTargetPeriodByTime = new Map();
    pivotSelectedReferenceKey = undefined;
    pivotSelectedAnchorTime = undefined;
    pivotSelectionPinned = false;
    pivotPointLayer.replaceChildren();
    pivotAutoScaleSignature = "";
    pivotAutoScaleLowerSeries?.setData([]);
    pivotAutoScaleUpperSeries?.setData([]);
    updatePivotReadout();
  }

  function latestPivotAnchorTime(referenceKey) {
    return [...pivotTargetPeriodByTime.entries()]
      .filter(([, period]) => period === referenceKey)
      .map(([time]) => Number(time))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0];
  }

  function defaultPivotProjection() {
    const projections = [...pivotProjectionByPeriod.values()]
      .sort((left, right) => Number(left.referenceTime) - Number(right.referenceTime));
    return projections.filter((projection) => projection.referenceStatus === "completed").at(-1)
      || projections.filter((projection) => projection.referenceStatus === "provisional").at(-1);
  }

  function selectDefaultPivotProjection(options = {}) {
    const projection = defaultPivotProjection();
    pivotSelectionPinned = false;
    pivotSelectedReferenceKey = projection?.referencePeriodKey;
    pivotSelectedAnchorTime = projection ? latestPivotAnchorTime(projection.referencePeriodKey) : undefined;
    updatePivotAutoScale();
    updatePivotReadout();
    if (options.render !== false) renderPivotPointOverlay();
  }

  function selectPivotProjectionForSurfaceEvent(event) {
    if (selectedPivotMode() !== "traditional" || !pivotProjectionByPeriod.size) return false;
    const rect = surface.getBoundingClientRect();
    const candle = nearestCandleForCoordinate(event.clientX - rect.left);
    const time = normalizeChartTime(candle?.time);
    const referenceKey = pivotTargetPeriodByTime.get(time);
    if (!referenceKey || !pivotProjectionByPeriod.has(referenceKey)) return false;
    event.preventDefault();
    event.stopPropagation();
    pivotSelectedReferenceKey = referenceKey;
    pivotSelectedAnchorTime = time;
    pivotSelectionPinned = true;
    updatePivotAutoScale();
    updatePivotReadout();
    renderPivotPointOverlay();
    status.textContent = `Pivot Point 已固定參考 ${referenceKey}`;
    return true;
  }

  function selectedPivotProjection() {
    return pivotProjectionByPeriod.get(pivotSelectedReferenceKey);
  }

  function updatePivotAutoScale() {
    if (!pivotAutoScaleLowerSeries || !pivotAutoScaleUpperSeries) return;
    const projection = selectedPivotProjection();
    const anchorTime = Number(pivotSelectedAnchorTime);
    const values = projection
      ? Object.keys(PIVOT_POINT_STYLES).map((key) => Number(projection[key])).filter(Number.isFinite)
      : [];
    const lower = values.length && Number.isFinite(anchorTime) ? [{ time: anchorTime, value: Math.min(...values) }] : [];
    const upper = values.length && Number.isFinite(anchorTime) ? [{ time: anchorTime, value: Math.max(...values) }] : [];
    const signature = JSON.stringify([lower, upper]);
    if (signature === pivotAutoScaleSignature) return;
    pivotAutoScaleSignature = signature;
    pivotAutoScaleLowerSeries.setData(lower);
    pivotAutoScaleUpperSeries.setData(upper);
    chart?.priceScale("right").applyOptions({ autoScale: true });
  }

  function updatePivotReadout() {
    const projection = selectedPivotProjection();
    const derivedPriceFormatter = (value) => formatQuotePrice(value, symbolSelect.value, "derived-price");
    for (const [key, style] of Object.entries(PIVOT_POINT_STYLES)) {
      const readoutKey = `pivot${key[0].toUpperCase()}${key.slice(1)}`;
      setReadoutValue(mainReadout, readoutKey, projection?.[key], derivedPriceFormatter);
      setReadoutItemColor(mainReadout, readoutKey, style.color);
    }
    const referenceNode = mainReadout.querySelector("[data-pivot-reference]");
    const appliesNode = mainReadout.querySelector("[data-pivot-applies]");
    const statusNode = mainReadout.querySelector("[data-pivot-status]");
    if (referenceNode) referenceNode.textContent = projection?.referencePeriodKey || "--";
    if (appliesNode) appliesNode.textContent = ({
      "next-trading-day": "下一交易日",
      "next-trading-week": "下一交易週",
      "next-trading-month": "下一交易月",
    })[projection?.appliesTo] || "--";
    if (statusNode) statusNode.textContent = projection?.referenceStatus === "provisional" ? "暫估" : projection ? "已完成" : "--";
    statusNode?.closest(".pivot-point-status")?.classList.toggle("is-provisional", projection?.referenceStatus === "provisional");
    if (pivotPointReset) pivotPointReset.disabled = !projection || !pivotSelectionPinned;
  }

  function renderPivotPointOverlay() {
    pivotPointLayer.replaceChildren();
    const projection = selectedPivotProjection();
    const anchorTime = Number(pivotSelectedAnchorTime);
    if (!projection || !chart || !candleSeries || !Number.isFinite(anchorTime)) return;
    const anchorX = chart.timeScale().timeToCoordinate(anchorTime);
    const rightEdge = Math.max(0, surface.clientWidth - getAxisSafeWidth() - 6);
    if (!Number.isFinite(anchorX)) return;
    const visibleAnchorX = Math.max(0, Math.min(anchorX, rightEdge - 8));
    const labelWidth = Math.max(48, getAxisSafeWidth() - 4);
    const labelHeight = 18;
    const labelLeft = rightEdge + 2;
    const levels = Object.entries(PIVOT_POINT_STYLES).flatMap(([key, style]) => {
      const value = Number(projection[key]);
      const y = candleSeries.priceToCoordinate(value);
      return Number.isFinite(value) && Number.isFinite(y) ? [{ key, style, value, y, labelY: y }] : [];
    }).sort((left, right) => left.y - right.y);
    const minGap = labelHeight + 2;
    levels.forEach((level, index) => {
      level.labelY = Math.max(labelHeight / 2 + 2, Math.min(surface.clientHeight - labelHeight / 2 - 2, level.y));
      if (index) level.labelY = Math.max(level.labelY, levels[index - 1].labelY + minGap);
    });
    for (let index = levels.length - 2; index >= 0; index -= 1) {
      levels[index].labelY = Math.min(levels[index].labelY, levels[index + 1].labelY - minGap);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(surface.clientWidth));
    svg.setAttribute("height", String(surface.clientHeight));
    levels.forEach(({ key, style, value, y, labelY }) => {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(visibleAnchorX));
      line.setAttribute("x2", String(rightEdge));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke", style.color);
      line.setAttribute("class", `pivot-point-line ${key === "r1" || key === "s1" ? "is-emphasis" : ""} ${["r2", "s2"].includes(key) ? "is-dashed" : ""} ${["r3", "s3"].includes(key) ? "is-dotted" : ""}`);
      svg.appendChild(line);
      if (Math.abs(labelY - y) > 1) {
        const connector = document.createElementNS("http://www.w3.org/2000/svg", "line");
        connector.setAttribute("x1", String(labelLeft - 12));
        connector.setAttribute("x2", String(labelLeft - 2));
        connector.setAttribute("y1", String(y));
        connector.setAttribute("y2", String(labelY));
        connector.setAttribute("stroke", style.color);
        connector.setAttribute("class", "pivot-point-connector");
        svg.appendChild(connector);
      }
      const label = document.createElement("div");
      label.className = `pivot-point-label pivot-point-label-${key}`;
      label.style.left = `${Math.round(labelLeft)}px`;
      label.style.top = `${Math.round(labelY - labelHeight / 2)}px`;
      label.style.width = `${Math.round(labelWidth)}px`;
      label.style.color = style.color;
      label.textContent = `${style.title} ${formatQuotePrice(value, symbolSelect.value, "derived-price")}`;
      pivotPointLayer.appendChild(label);
    });
    pivotPointLayer.prepend(svg);
  }

  function drawFvg(gaps) {
    const markers = gaps.slice(-20).map((gap) => ({
      time: gap.time,
      position: gap.type === "bullish" ? "belowBar" : "aboveBar",
      color: gap.type === "bullish" ? "#dc2626" : "#16a34a",
      shape: gap.type === "bullish" ? "arrowUp" : "arrowDown",
      text: gap.type === "bullish" ? "FVG 多" : "FVG 空",
    }));
    if (candleSeries.setMarkers) {
      candleSeries.setMarkers(markers);
    }
  }

  function createIndicatorChart() {
    return LightweightCharts.createChart(indicatorSurface, {
      autoSize: true,
      ...chartInteractionOptions(),
      layout: {
        background: { type: "solid", color: "#111827" },
        textColor: "#94a3b8",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      localization: {
        timeFormatter: formatCrosshairTime,
      },
      crosshair: SHARED_CROSSHAIR_OPTIONS,
      rightPriceScale: { borderVisible: false, minimumWidth: currentPriceScaleMinWidth() },
      timeScale: {
        visible: false,
        borderVisible: false,
        rightOffset: RIGHT_OFFSET_BARS,
        tickMarkFormatter: formatTimeTick,
      },
    });
  }

  function syncIndicatorTimeAnchor(candles = lastPayload?.candles || []) {
    if (!indicatorChart) {
      indicatorTimeAnchorSeries = undefined;
      return;
    }
    if (!indicatorTimeAnchorSeries) {
      indicatorTimeAnchorSeries = indicatorChart.addSeries(LightweightCharts.LineSeries, {
        color: "rgba(0, 0, 0, 0)",
        lineWidth: 1,
        priceScaleId: INDICATOR_TIME_ANCHOR_PRICE_SCALE_ID,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: "",
      });
      indicatorChart.priceScale(INDICATOR_TIME_ANCHOR_PRICE_SCALE_ID).applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.5, bottom: 0.5 },
      });
    }
    indicatorTimeAnchorSeries.setData(candles.map((row) => ({ time: row.time, value: 0 })));
  }

  function updateIndicatorTimeAnchor(candle) {
    if (!indicatorTimeAnchorSeries || !candle?.time) return;
    indicatorTimeAnchorSeries.update({ time: candle.time, value: 0 });
  }

  function upsertIndicatorLine(key, data, color, options = {}, referenceLines = []) {
    let series = indicatorSeriesByKey.get(key);
    if (!series) {
      series = addIndicatorLine([], color, options);
      indicatorSeriesByKey.set(key, series);
      indicatorSeries.push(series);
      referenceLines.forEach((price) => addIndicatorReferenceLine(series, price));
    }
    series.setData(compactSeries(data));
    return series;
  }

  function upsertIndicatorHistogram(key, data, color) {
    let series = indicatorSeriesByKey.get(key);
    if (!series) {
      series = addIndicatorHistogram([], color);
      indicatorSeriesByKey.set(key, series);
      indicatorSeries.push(series);
    }
    series.setData(compactSeries(data));
    return series;
  }

  function renderIndicatorChart(indicators, selectedSub, options = {}) {
    const renderToken = ++indicatorRenderToken;
    const selectionSignature = [...selectedSub].sort().join(",");
    indicatorSeriesPointCounts = {};
    if (!selectedSub.size) {
      if (indicatorChart) {
        indicatorChart.remove();
        indicatorChart = undefined;
        indicatorTimeAnchorSeries = undefined;
      }
      indicatorSeries = [];
      indicatorSeriesByKey = new Map();
      indicatorSelectionSignature = "";
      indicatorSurface.innerHTML = '<div class="indicator-empty">副圖指標未選擇</div>';
      return;
    }
    if (!indicatorChart) {
      indicatorSurface.innerHTML = "";
      indicatorChart = createIndicatorChart();
      attachIndicatorChartSync();
    }
    if (selectionSignature !== indicatorSelectionSignature) {
      indicatorSeries = removeIndicatorSeries(indicatorSeries);
      indicatorSeriesByKey = new Map();
      indicatorSelectionSignature = selectionSignature;
    }
    syncIndicatorTimeAnchor();

    if (selectedSub.has("rsi")) {
      indicatorSeriesPointCounts.rsiShort = (indicators.rsi?.short || []).length;
      indicatorSeriesPointCounts.rsiLong = (indicators.rsi?.long || []).length;
      upsertIndicatorLine("rsiShort", indicators.rsi?.short || [], SUB_INDICATOR_STYLES.rsiShort.color, {
        priceFormat: { type: "custom", formatter: formatTechnicalOscillatorAxis },
      }, INDICATOR_REFERENCE_LINES.rsi);
      upsertIndicatorLine("rsiLong", indicators.rsi?.long || [], SUB_INDICATOR_STYLES.rsiLong.color, {
        priceFormat: { type: "custom", formatter: formatTechnicalOscillatorAxis },
      });
    }
    if (selectedSub.has("kd")) {
      indicatorSeriesPointCounts.kdK = (indicators.kd?.k || []).length;
      indicatorSeriesPointCounts.kdD = (indicators.kd?.d || []).length;
      upsertIndicatorLine("kdK", indicators.kd?.k || [], SUB_INDICATOR_STYLES.kdK.color, {
        priceFormat: { type: "custom", formatter: formatTechnicalOscillatorAxis },
      }, INDICATOR_REFERENCE_LINES.kd);
      upsertIndicatorLine("kdD", indicators.kd?.d || [], SUB_INDICATOR_STYLES.kdD.color, {
        priceFormat: { type: "custom", formatter: formatTechnicalOscillatorAxis },
      });
    }
    if (selectedSub.has("macd")) {
      indicatorSeriesPointCounts.macdHistogram = (indicators.macd?.histogram || []).length;
      indicatorSeriesPointCounts.macd = (indicators.macd?.line || []).length;
      indicatorSeriesPointCounts.macdSignal = (indicators.macd?.signal || []).length;
      upsertIndicatorHistogram("macdHistogram", colorMacdHistogramData(indicators.macd?.histogram || []), SUB_INDICATOR_STYLES.macdHistogramPositive.color);
      upsertIndicatorLine("macd", indicators.macd?.line || [], SUB_INDICATOR_STYLES.macd.color, {
        priceFormat: { type: "custom", formatter: formatTechnicalAdaptiveAxis },
      }, INDICATOR_REFERENCE_LINES.macd);
      upsertIndicatorLine("macdSignal", indicators.macd?.signal || [], SUB_INDICATOR_STYLES.macdSignal.color, {
        priceFormat: { type: "custom", formatter: formatTechnicalAdaptiveAxis },
      });
    }
    if (selectedSub.has("atr")) {
      indicatorSeriesPointCounts.atr = (indicators.atr || []).length;
      upsertIndicatorLine("atr", indicators.atr || [], SUB_INDICATOR_STYLES.atr.color, {
        priceScaleId: ATR_PRICE_SCALE_ID,
        priceFormat: { type: "custom", formatter: formatTechnicalAdaptiveAxis },
      });
    }
    indicatorChart.priceScale(ATR_PRICE_SCALE_ID).applyOptions({
      visible: selectedSub.has("atr"),
      borderVisible: false,
      scaleMargins: { top: 0.12, bottom: 0.12 },
    });
    syncIndicatorVisibleRangeToMain();
    if (options.allowRecovery !== false) {
      panelLifecycle.setTimer(() => {
        if (!isPanelActive() || renderToken !== indicatorRenderToken || !indicatorChart || !isTechnicalSubchartVisible()) return;
        const hasExpectedPoints = Object.values(indicatorSeriesPointCounts).some((count) => Number(count) > 0);
        if (!hasExpectedPoints || isValidTimeRange(indicatorChart.timeScale().getVisibleRange?.())) return;
        indicatorRecoveryCount += 1;
        isSyncingTimeScale = true;
        try {
          indicatorChart.remove();
          indicatorChart = undefined;
          indicatorTimeAnchorSeries = undefined;
          indicatorSeries = [];
          indicatorSeriesByKey = new Map();
          indicatorSelectionSignature = "";
          renderIndicatorChart(lastPayload?.indicators || indicators, getSelectedSubIndicators(), { allowRecovery: false });
          syncIndicatorTimeAnchor(lastPayload?.candles || []);
          syncIndicatorVisibleRangeToMain();
        } finally {
          releaseTimeScaleSyncAfterFrame();
        }
        scheduleAlignmentMeasurement();
      }, 120);
    }
  }

  function renderVolumeProfile(indicators) {
    const profile = indicators.volume_profile || [];
    profileOverlay.innerHTML = "";
    if (!profile.length || !chart || !candleSeries) return;
    const maxVolume = Math.max(...profile.map((bucket) => bucket.volume || 0), 1);
    const axisSafeWidth = getAxisSafeWidth();
    const drawableWidth = Math.max(80, surface.clientWidth - axisSafeWidth);
    const maxWidth = Math.max(28, Math.min(78, Math.round(drawableWidth * 0.16)));
    for (const bucket of profile) {
      const highY = candleSeries.priceToCoordinate(bucket.high);
      const lowY = candleSeries.priceToCoordinate(bucket.low);
      if (!Number.isFinite(highY) || !Number.isFinite(lowY)) continue;
      const div = document.createElement("div");
      const mid = (bucket.low + bucket.high) / 2;
      const top = Math.max(0, Math.min(surface.clientHeight, Math.min(highY, lowY)));
      const height = Math.max(2, Math.abs(lowY - highY));
      const width = Math.max(6, Math.round(((bucket.volume || 0) / maxVolume) * maxWidth));
      div.className = "profile-bucket";
      if (Math.abs(mid - indicators.poc) <= (bucket.high - bucket.low) / 2) div.classList.add("poc");
      if (bucket.low >= indicators.val && bucket.high <= indicators.vah) div.classList.add("value-area");
      div.style.top = `${Math.round(top)}px`;
      div.style.height = `${Math.round(height)}px`;
      div.style.width = `${width}px`;
      div.title = `Volume Profile ${formatQuotePrice(bucket.low, symbolSelect.value, "derived-price")}-${formatQuotePrice(bucket.high, symbolSelect.value, "derived-price")}｜量 ${formatInteger(bucket.volume)}`;
      profileOverlay.appendChild(div);
    }
  }

  function timeCoordinateForFixedProfile(time) {
    if (!chart) return undefined;
    const coordinate = chart.timeScale().timeToCoordinate(time);
    return Number.isFinite(coordinate) ? coordinate : undefined;
  }

  function appendFixedProfileBoundary(time) {
    const x = timeCoordinateForFixedProfile(time);
    if (!Number.isFinite(x)) return;
    const rightEdge = surface.clientWidth - getAxisSafeWidth();
    if (x < 0 || x > rightEdge) return;
    const boundary = document.createElement("div");
    boundary.className = "fixed-profile-boundary";
    boundary.style.left = `${Math.round(x)}px`;
    fixedProfileOverlay.appendChild(boundary);
  }

  function renderFixedRangeVolumeProfile() {
    fixedProfileOverlay.innerHTML = "";
    if (!chart || !candleSeries || destroyed) return;
    const rightEdge = Math.max(0, surface.clientWidth - getAxisSafeWidth() - 4);

    fixedProfileRanges.forEach((profileRange) => {
      const fromX = timeCoordinateForFixedProfile(profileRange.from);
      const toX = timeCoordinateForFixedProfile(profileRange.to);
      if (Number.isFinite(fromX) && Number.isFinite(toX)) {
        const left = Math.max(0, Math.min(rightEdge, Math.min(fromX, toX)));
        const right = Math.max(0, Math.min(rightEdge, Math.max(fromX, toX)));
        const width = Math.max(1, right - left);
        const isSelected = profileRange.id === selectedFixedProfileId;
        const range = document.createElement("div");
        range.className = "fixed-profile-range";
        range.classList.toggle("is-selected", isSelected);
        range.classList.toggle("is-muted", !isSelected);
        range.dataset.rangeId = profileRange.id;
        range.dataset.rangeName = profileRange.name;
        range.style.setProperty("--range-color", profileRange.color);
        range.style.left = `${Math.round(left)}px`;
        range.style.width = `${Math.round(width)}px`;
        range.title = profileRange.name;
        range.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          selectFixedProfileRange(profileRange.id);
        });
        range.addEventListener("pointerdown", (event) => startFixedProfileDrag(event, profileRange.id, "move"));
        fixedProfileOverlay.appendChild(range);
        appendFixedProfileBars({ ...profileRange, isSelected }, left, right);
        appendFixedProfileLevels(profileRange.profile, left, right, isSelected, profileRange.id);
        if (isSelected) {
          appendFixedProfileDragHandle(profileRange.id, left, "left");
          appendFixedProfileDragHandle(profileRange.id, right, "right");
        }
      }
    });

    if (fixedProfileState === FIXED_PROFILE_STATES.firstPointSelected && fixedProfileFirstTime !== undefined) {
      appendFixedProfileBoundary(fixedProfileFirstTime);
    }
  }

  function appendFixedProfileBars(profile, left, right) {
    const profileRange = profile;
    const isSelected = Boolean(profileRange.isSelected);
    const buckets = profileRange.profile?.buckets || [];
    if (!buckets.length) return;
    const maxVolume = Math.max(...buckets.map((bucket) => bucket.volume || 0), 1);
    const rangeWidth = Math.max(24, right - left);
    const profileLeft = Math.max(0, Math.min(left + 2, surface.clientWidth - getAxisSafeWidth() - 16));
    const maxWidth = Math.max(24, Math.min(160, Math.round(rangeWidth * 0.45)));
    buckets.forEach((bucket) => {
      const highY = candleSeries.priceToCoordinate(bucket.high);
      const lowY = candleSeries.priceToCoordinate(bucket.low);
      if (!Number.isFinite(highY) || !Number.isFinite(lowY)) return;
      const height = Math.max(2, Math.abs(lowY - highY));
      const top = Math.max(0, Math.min(surface.clientHeight, Math.min(highY, lowY)));
      const width = Math.max(3, Math.round(((bucket.volume || 0) / maxVolume) * maxWidth));
      const bar = document.createElement("div");
      bar.className = "fixed-profile-bucket";
      bar.classList.toggle("is-selected", isSelected);
      bar.classList.toggle("is-muted", !isSelected);
      bar.dataset.rangeId = profileRange.id;
      if (bucket.isPoc) bar.classList.add("poc");
      if (bucket.isValueArea) bar.classList.add("value-area");
      bar.style.top = `${Math.round(top)}px`;
      bar.style.left = `${Math.round(profileLeft)}px`;
      bar.style.width = `${width}px`;
      bar.style.height = `${Math.round(height)}px`;
      bar.title = `固定範圍 VP ${formatQuotePrice(bucket.low, symbolSelect.value, "derived-price")}-${formatQuotePrice(bucket.high, symbolSelect.value, "derived-price")}｜買 ${formatInteger(bucket.buyVolume)}｜賣 ${formatInteger(bucket.sellVolume)}｜總量 ${formatInteger(bucket.volume)}`;
      bar.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectFixedProfileRange(profileRange.id);
      });
      bar.addEventListener("pointerdown", (event) => startFixedProfileDrag(event, profileRange.id, "move"));
      const buyWidth = bucket.volume > 0 ? Math.round(width * ((bucket.buyVolume || 0) / bucket.volume)) : 0;
      const sellWidth = Math.max(0, width - buyWidth);
      const buySegment = document.createElement("span");
      buySegment.className = "fixed-profile-buy-segment";
      buySegment.style.width = `${buyWidth}px`;
      const sellSegment = document.createElement("span");
      sellSegment.className = "fixed-profile-sell-segment";
      sellSegment.style.width = `${sellWidth}px`;
      bar.appendChild(buySegment);
      bar.appendChild(sellSegment);
      fixedProfileOverlay.appendChild(bar);
    });
  }

  function appendFixedProfileLevels(profile, left, right, isSelected, rangeId) {
    const entries = [
      { label: "POC", price: profile.poc, className: "poc" },
      { label: "VAH", price: profile.vah, className: "vah" },
      { label: "VAL", price: profile.val, className: "val" },
    ]
      .map((entry) => ({ ...entry, y: candleSeries.priceToCoordinate(entry.price) }))
      .filter((entry) => Number.isFinite(entry.y))
      .sort((a, b) => a.y - b.y);

    const labelHeight = 16;
    const labelGap = 3;
    let cursor = 0;
    entries.forEach((entry) => {
      const naturalTop = Math.max(0, Math.min(surface.clientHeight - labelHeight, entry.y - 8));
      entry.labelTop = Math.max(naturalTop, cursor);
      cursor = entry.labelTop + labelHeight + labelGap;
    });
    const overflow = Math.max(0, cursor - labelGap - surface.clientHeight);
    if (overflow) {
      entries.forEach((entry) => {
        entry.labelTop = Math.max(0, entry.labelTop - overflow);
      });
    }
    entries.forEach((entry) => appendFixedProfileLevel(entry, left, right, isSelected, rangeId));
  }

  function appendFixedProfileLevel(entry, left, right, isSelected, rangeId) {
    const clippedTop = Math.max(0, Math.min(surface.clientHeight - 1, entry.y));
    const level = document.createElement("div");
    level.className = `fixed-profile-level ${entry.className}`;
    level.classList.toggle("is-muted", !isSelected);
    level.dataset.rangeId = rangeId;
    level.style.left = `${Math.round(left)}px`;
    level.style.top = `${Math.round(clippedTop)}px`;
    level.style.width = `${Math.max(16, Math.round(right - left))}px`;
    level.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectFixedProfileRange(rangeId);
    });
    fixedProfileOverlay.appendChild(level);

    const value = document.createElement("div");
    value.className = `fixed-profile-level-label ${entry.className}`;
    value.classList.toggle("is-muted", !isSelected);
    value.dataset.rangeId = rangeId;
    value.textContent = `${entry.label} ${formatQuotePrice(entry.price, symbolSelect.value, "derived-price")}`;
    value.style.left = `${Math.round(Math.min(right + 4, surface.clientWidth - getAxisSafeWidth() - 88))}px`;
    value.style.top = `${Math.round(entry.labelTop)}px`;
    value.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectFixedProfileRange(rangeId);
    });
    fixedProfileOverlay.appendChild(value);
  }

  function appendFixedProfileDragHandle(rangeId, x, side) {
    const clippedX = Math.max(0, Math.min(surface.clientWidth - getAxisSafeWidth() - 4, x));
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `fixed-profile-drag-handle ${side}`;
    handle.dataset.rangeId = rangeId;
    handle.style.left = `${Math.round(clippedX)}px`;
    handle.setAttribute("aria-label", side === "left" ? "調整固定範圍 VP 左界" : "調整固定範圍 VP 右界");
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectFixedProfileRange(rangeId);
    });
    handle.addEventListener("pointerdown", (event) => (
      startFixedProfileDrag(event, rangeId, side === "left" ? "resize-left" : "resize-right")
    ));
    fixedProfileOverlay.appendChild(handle);
  }

  function fixedProfileDebugReport() {
    const errors = [];
    const activeRange = activeFixedProfileRange();
    const report = {
      available: isFixedProfileAvailable(),
      state: fixedProfileState,
      from: activeRange?.from ?? null,
      to: activeRange?.to ?? null,
      bucketCount: activeRange?.profile?.buckets?.length || 0,
      rangeCount: fixedProfileRanges.length,
      selectedRangeId: selectedFixedProfileId ?? null,
      ranges: fixedProfileRanges.map((range) => ({
        id: range.id,
        from: range.from,
        to: range.to,
        name: range.name,
        color: range.color,
        createdAt: range.createdAt,
        updatedAt: range.updatedAt,
        selected: range.id === selectedFixedProfileId,
        bucketCount: range.profile?.buckets?.length || 0,
        poc: range.profile?.poc ?? null,
        vah: range.profile?.vah ?? null,
        val: range.profile?.val ?? null,
        totalVolume: range.profile?.totalVolume ?? null,
      })),
      poc: activeRange?.profile?.poc ?? null,
      vah: activeRange?.profile?.vah ?? null,
      val: activeRange?.profile?.val ?? null,
      totalVolume: activeRange?.profile?.totalVolume ?? null,
      settings: { ...fixedProfileSettings },
      storageKey: fixedProfileStorageKey(),
      lastError: fixedProfileLastError || null,
      pass: true,
      errors,
    };
    if (!report.available && isFixedProfileDrawing()) {
      errors.push("FRVP active outside one-chart mode");
    }
    fixedProfileRanges.forEach((range) => {
      if (!chart) return;
      const fromX = timeCoordinateForFixedProfile(range.from);
      const toX = timeCoordinateForFixedProfile(range.to);
      const rightEdge = surface.clientWidth - getAxisSafeWidth();
      if (!Number.isFinite(fromX) || !Number.isFinite(toX)) {
        errors.push("FRVP range not visible");
      } else if (Math.max(fromX, toX) > rightEdge + 1) {
        errors.push("FRVP overlaps price axis");
      }
    });
    report.pass = errors.length === 0;
    return report;
  }

  function renderProfileSummary(indicators) {
    profileSummary.innerHTML = "";
    const values = [
      ["POC", indicators.poc],
      ["VAH", indicators.vah],
      ["VAL", indicators.val],
    ];
    if (!values.every(([, value]) => typeof value === "number")) {
      profileSummary.classList.add("hidden");
      return;
    }
    profileSummary.classList.remove("hidden");
    for (const [label, value] of values) {
      const span = document.createElement("span");
      const strong = document.createElement("b");
      span.append(`${label} `);
      strong.textContent = formatQuotePrice(value, symbolSelect.value, "derived-price");
      span.appendChild(strong);
      profileSummary.appendChild(span);
    }
  }

  function renderFvgLayer(gaps) {
    fvgLayer.innerHTML = "";
    if (!gaps.length || !chart || !candleSeries) return;
    const rightEdge = Math.max(0, surface.clientWidth - getAxisSafeWidth() - 8);
    for (const gap of gaps.slice(-12)) {
      const x = chart.timeScale().timeToCoordinate(gap.time);
      const fromY = candleSeries.priceToCoordinate(gap.from);
      const toY = candleSeries.priceToCoordinate(gap.to);
      if (!Number.isFinite(x) || !Number.isFinite(fromY) || !Number.isFinite(toY)) continue;
      const left = Math.max(0, Math.round(x - 12));
      if (left >= rightEdge) continue;
      const top = Math.max(0, Math.round(Math.min(fromY, toY)));
      const height = Math.max(3, Math.round(Math.abs(toY - fromY)));
      const zone = document.createElement("div");
      zone.className = `fvg-zone ${gap.type}`;
      zone.style.left = `${left}px`;
      zone.style.top = `${top}px`;
      zone.style.width = `${Math.max(24, rightEdge - left)}px`;
      zone.style.height = `${height}px`;
      zone.title = gap.type === "bullish"
        ? `FVG 多 ${formatQuotePrice(gap.from, symbolSelect.value)}-${formatQuotePrice(gap.to, symbolSelect.value)}`
        : `FVG 空 ${formatQuotePrice(gap.from, symbolSelect.value)}-${formatQuotePrice(gap.to, symbolSelect.value)}`;
      fvgLayer.appendChild(zone);
    }
  }

  function updateFibonacciAutoScale(annotationState = chartAnnotationController?.getState?.()) {
    if (!chart || !fibonacciAutoScaleLowerSeries || !fibonacciAutoScaleUpperSeries) return;
    const extensions = [];
    const completed = Array.isArray(annotationState?.completed?.fibonacci)
      ? annotationState.completed.fibonacci
      : [];
    completed.filter((entry) => entry.kind === "extension" && entry.levels?.length)
      .forEach((entry) => extensions.push({ anchors: entry.anchors, levels: entry.levels }));
    const lowerByTime = new Map();
    const upperByTime = new Map();
    extensions.forEach(({ anchors, levels }) => {
      const prices = levels.map((level) => Number(level.price)).filter(Number.isFinite);
      const times = [anchors?.[1]?.time, anchors?.[2]?.time].map(Number).filter(Number.isFinite);
      if (!prices.length || !times.length) return;
      const minimum = Math.min(...prices);
      const maximum = Math.max(...prices);
      times.forEach((time) => {
        lowerByTime.set(time, Math.min(lowerByTime.get(time) ?? minimum, minimum));
        upperByTime.set(time, Math.max(upperByTime.get(time) ?? maximum, maximum));
      });
    });
    const toSeriesData = (values) => [...values.entries()]
      .sort(([left], [right]) => left - right)
      .map(([time, value]) => ({ time, value }));
    const lowerData = toSeriesData(lowerByTime);
    const upperData = toSeriesData(upperByTime);
    const signature = JSON.stringify([lowerData, upperData]);
    if (signature === fibonacciAutoScaleSignature) return;
    fibonacciAutoScaleSignature = signature;
    fibonacciAutoScaleLowerSeries.setData(lowerData);
    fibonacciAutoScaleUpperSeries.setData(upperData);
    chart.priceScale("right").applyOptions({ autoScale: true });
    if (annotationRenderFrame) panelLifecycle.cancelFrame(annotationRenderFrame);
    annotationRenderFrame = panelLifecycle.requestFrame(() => {
      annotationRenderFrame = 0;
      if (isPanelActive()) renderChartAnnotations();
    });
  }

  function isFibonacciSelectionActive(annotationState = chartAnnotationController?.getState?.()) {
    return annotationState?.pending?.type === "fibonacci";
  }

  function updateFibonacciCrosshairMarkers(annotationState = chartAnnotationController?.getState?.()) {
    const shouldHide = isFibonacciSelectionActive(annotationState);
    if (shouldHide === fibonacciCrosshairMarkersHidden) return;
    fibonacciCrosshairMarkersHidden = shouldHide;
    [
      ...bollingerSeries,
      ...movingAverageSeries,
      ...lineSeries,
      estimatedMarginCostSeries,
    ].filter(Boolean).forEach((series) => {
      const defaultVisible = mainLineCrosshairMarkerDefaults.get(series) !== false;
      series.applyOptions({ crosshairMarkerVisible: shouldHide ? false : defaultVisible });
    });
  }

  function renderChartAnnotations() {
    if (!chartAnnotationLayer) return;
    chartAnnotationLayer.replaceChildren();
    const annotationState = chartAnnotationController?.getState?.();
    if (!annotationState || !chart || !candleSeries || destroyed) return;
    const width = Math.max(0, surface.clientWidth);
    const height = Math.max(0, surface.clientHeight);
    const rightEdge = Math.max(0, width - getAxisSafeWidth() - 4);
    if (!width || !height || rightEdge < 8) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "費波那契與價格範圍註記");
    const make = (name, attrs = {}) => {
      const node = document.createElementNS(ns, name);
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
      return node;
    };
    const priceRangeTickCount = (startPrice, difference) => {
      const instrument = managedInstruments().find((item) => item.symbol === symbolSelect.value);
      const securityType = window.QuotePriceFormatting?.taiwanSecurityType?.(symbolSelect.value, instrument);
      const tickSize = window.QuotePriceFormatting?.taiwanTickSize?.(startPrice, securityType);
      if (!Number.isFinite(tickSize) || tickSize <= 0) return undefined;
      return Math.round(Math.abs(difference) / tickSize);
    };
    const renderPriceRange = (start, end, result, pending = false) => {
      if (!start || !end || !result) return;
      const rawStartX = chart.timeScale().timeToCoordinate(start.time);
      const rawEndX = chart.timeScale().timeToCoordinate(end.time);
      const rawStartY = candleSeries.priceToCoordinate(start.price);
      const rawEndY = candleSeries.priceToCoordinate(end.price);
      if (![rawStartX, rawEndX, rawStartY, rawEndY].every(Number.isFinite)) return;
      const startX = Math.max(0, Math.min(rightEdge, rawStartX));
      const endX = Math.max(0, Math.min(rightEdge, rawEndX));
      const startY = Math.max(0, Math.min(height, rawStartY));
      const endY = Math.max(0, Math.min(height, rawEndY));
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      const rangeWidth = Math.max(1, Math.abs(endX - startX));
      const rangeHeight = Math.max(1, Math.abs(endY - startY));
      const centerX = left + rangeWidth / 2;
      const bottom = top + rangeHeight;
      const modifier = result.difference >= 0 ? "up" : "down";
      const stateClass = pending ? " is-pending" : "";
      const group = make("g", {
        class: `chart-annotation-price-range chart-annotation-price-range--${modifier}${stateClass}`,
        "aria-label": `價格範圍${result.difference >= 0 ? "上漲" : "下跌"}`,
      });
      group.appendChild(make("rect", {
        x: left,
        y: top,
        width: rangeWidth,
        height: rangeHeight,
        class: "chart-annotation-price-range-fill",
      }));
      group.appendChild(make("line", {
        x1: left,
        y1: top,
        x2: left + rangeWidth,
        y2: top,
        class: "chart-annotation-price-range-boundary",
      }));
      group.appendChild(make("line", {
        x1: left,
        y1: bottom,
        x2: left + rangeWidth,
        y2: bottom,
        class: "chart-annotation-price-range-boundary",
      }));
      group.appendChild(make("line", {
        x1: centerX,
        y1: top + Math.min(5, rangeHeight / 2),
        x2: centerX,
        y2: bottom - Math.min(5, rangeHeight / 2),
        class: "chart-annotation-price-range-arrow",
      }));
      if (rangeHeight >= 8) {
        group.appendChild(make("path", {
          d: `M ${centerX - 5} ${top + 7} L ${centerX} ${top + 1} L ${centerX + 5} ${top + 7}`,
          class: "chart-annotation-price-range-arrowhead",
        }));
        group.appendChild(make("path", {
          d: `M ${centerX - 5} ${bottom - 7} L ${centerX} ${bottom - 1} L ${centerX + 5} ${bottom - 7}`,
          class: "chart-annotation-price-range-arrowhead",
        }));
      }
      group.appendChild(make("circle", {
        cx: startX,
        cy: startY,
        r: 5,
        class: "chart-annotation-price-range-point",
      }));
      group.appendChild(make("circle", {
        cx: endX,
        cy: endY,
        r: 5,
        class: "chart-annotation-price-range-point",
      }));
      const difference = result.difference;
      const signedPrice = `${difference < 0 ? "-" : ""}${formatQuotePrice(Math.abs(difference), symbolSelect.value, "change", start.price)}`;
      const signedPercent = `${result.percent < 0 ? "-" : ""}${Math.abs(result.percent).toFixed(2)}%`;
      const ticks = priceRangeTickCount(start.price, difference);
      const labelText = `${signedPrice} (${signedPercent})${Number.isFinite(ticks) ? ` ${ticks} 格` : ""}`;
      const labelWidth = Math.max(112, Math.min(rightEdge - 8, labelText.length * 7 + 18));
      const labelCenterX = Math.max(labelWidth / 2 + 4, Math.min(rightEdge - labelWidth / 2 - 4, centerX));
      let labelY = Math.max(14, Math.min(height - 8, top - 11));
      const readoutRect = mainReadout && !mainReadout.classList.contains("hidden")
        ? mainReadout.getBoundingClientRect()
        : null;
      const surfaceRect = surface.getBoundingClientRect();
      const readoutBounds = readoutRect
        ? {
            left: readoutRect.left - surfaceRect.left,
            right: readoutRect.right - surfaceRect.left,
            top: readoutRect.top - surfaceRect.top,
            bottom: readoutRect.bottom - surfaceRect.top,
          }
        : null;
      const labelBounds = {
        left: labelCenterX - labelWidth / 2,
        right: labelCenterX + labelWidth / 2,
        top: labelY - 15,
        bottom: labelY + 6,
      };
      const overlapsReadout = readoutBounds
        && labelBounds.left < readoutBounds.right
        && labelBounds.right > readoutBounds.left
        && labelBounds.top < readoutBounds.bottom
        && labelBounds.bottom > readoutBounds.top;
      if (overlapsReadout) {
        labelY = rangeHeight >= 30
          ? Math.min(bottom - 7, top + 19)
          : Math.min(height - 8, bottom + 18);
      }
      group.appendChild(make("rect", {
        x: labelCenterX - labelWidth / 2,
        y: labelY - 15,
        width: labelWidth,
        height: 21,
        rx: 4,
        class: "chart-annotation-price-range-label-bg",
      }));
      const label = make("text", {
        x: labelCenterX,
        y: labelY,
        class: "chart-annotation-price-range-label",
        "text-anchor": "middle",
      });
      label.textContent = labelText;
      group.appendChild(label);
      svg.appendChild(group);
    };
    const fibonacciAnchorPoints = (anchors = []) => anchors
      .map((anchor, index) => ({
        anchor,
        index,
        label: ["A", "B", "C"][index] || String(index + 1),
        x: chart.timeScale().timeToCoordinate(anchor.time),
        y: candleSeries.priceToCoordinate(anchor.price),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    const renderFibonacciAnchors = (anchors, kind, options = {}) => {
      const pending = options.pending === true;
      const monochrome = options.monochrome === true;
      const previewIndex = Number(options.previewIndex);
      const points = fibonacciAnchorPoints(anchors);
      const modifier = kind === "extension" ? "extension" : "retracement";
      const stateClass = `${pending ? " is-pending" : ""}${monochrome ? " is-monochrome" : ""}`;
      if (points.length >= 2) {
        const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
        svg.appendChild(make("polyline", {
          points: polylinePoints,
          class: `chart-annotation-fibonacci-guide chart-annotation-fibonacci-guide--${modifier}${stateClass}`,
        }));
      }
      points.forEach((point) => {
        if (point.x < -6 || point.x > rightEdge + 6 || point.y < -6 || point.y > height + 6) return;
        const isPreview = previewIndex === point.index;
        const group = make("g", {
          class: `chart-annotation-fibonacci-anchor chart-annotation-fibonacci-anchor--${point.label.toLowerCase()}${stateClass}${isPreview ? " is-preview" : ""}`,
          "aria-label": `費波那契${isPreview ? "預覽" : ""}錨點 ${point.label}`,
        });
        if (isPreview) {
          group.setAttribute("data-export-exclude", "");
          const previewPath = `M ${point.x - 5} ${point.y} H ${point.x + 5} M ${point.x} ${point.y - 5} V ${point.y + 5}`;
          group.appendChild(make("path", {
            d: previewPath,
            class: "chart-annotation-fibonacci-anchor-preview-halo",
          }));
          group.appendChild(make("path", {
            d: previewPath,
            class: "chart-annotation-fibonacci-anchor-preview-cross",
          }));
        } else {
          group.appendChild(make("circle", {
            cx: point.x,
            cy: point.y,
            r: 4,
            class: "chart-annotation-fibonacci-anchor-circle",
          }));
        }
        svg.appendChild(group);
      });
      return points;
    };
    const renderFibonacciLevels = (kind, anchors, levels, options = {}) => {
      if (!levels?.length) return;
      const pending = options.pending === true;
      const monochrome = options.monochrome === true;
      const stateClass = `${pending ? " is-pending" : ""}${monochrome ? " is-monochrome" : ""}`;
      const anchorPoints = fibonacciAnchorPoints(anchors);
      const rangeIndexes = kind === "extension" ? [1, 2] : [0, 1];
      const rangePoints = rangeIndexes
        .map((index) => anchorPoints.find((point) => point.index === index))
        .filter(Boolean);
      if (rangePoints.length !== 2) return;
      const lineStartX = Math.max(0, Math.min(rightEdge, Math.min(rangePoints[0].x, rangePoints[1].x)));
      const lineEndX = rightEdge;
      if (lineEndX - lineStartX < 1) return;
      const modifier = kind === "extension" ? "extension" : "retracement";
      const entries = levels
        .map((level, levelIndex) => ({ ...level, levelIndex, y: candleSeries.priceToCoordinate(level.price) }))
        .filter((entry) => Number.isFinite(entry.y) && entry.y >= -16 && entry.y <= height + 16)
        .sort((a, b) => a.y - b.y);
      if (!monochrome) {
        for (let index = 0; index < entries.length - 1; index += 1) {
          const current = entries[index];
          const next = entries[index + 1];
          const bandTop = Math.max(0, Math.min(current.y, next.y));
          const bandBottom = Math.min(height, Math.max(current.y, next.y));
          if (bandBottom - bandTop < 0.5) continue;
          svg.appendChild(make("rect", {
            x: lineStartX,
            y: bandTop,
            width: lineEndX - lineStartX,
            height: bandBottom - bandTop,
            class: `chart-annotation-fibonacci-band chart-annotation-fibonacci-band--${modifier} chart-annotation-fibonacci-level-${current.levelIndex}${stateClass}`,
          }));
        }
      }
      entries.forEach((entry) => {
        svg.appendChild(make("line", {
          x1: lineStartX,
          y1: entry.y,
          x2: lineEndX,
          y2: entry.y,
          class: `chart-annotation-fibonacci-line chart-annotation-fibonacci-line--${modifier} chart-annotation-fibonacci-level-${entry.levelIndex}${stateClass}`,
        }));
        const labelText = `${entry.ratioText ?? window.QuoteChartAnnotations?.ratioText?.(entry.ratio)} (${formatQuotePrice(entry.price, symbolSelect.value, "derived-price")})`;
        const estimatedLabelWidth = labelText.length * 7;
        const hasLeftSpace = lineStartX >= estimatedLabelWidth + 12;
        const label = make("text", {
          x: hasLeftSpace ? lineStartX - 7 : lineStartX + 7,
          y: Math.max(12, Math.min(height - 4, entry.y + 4)),
          class: `chart-annotation-fibonacci-label chart-annotation-fibonacci-label--${modifier} chart-annotation-fibonacci-level-${entry.levelIndex}${stateClass}`,
          "text-anchor": hasLeftSpace ? "end" : "start",
        });
        label.textContent = labelText;
        svg.appendChild(label);
      });
    };
    const renderFibonacciAnchorPriceGuide = (pending) => {
      const guide = window.QuoteChartAnnotations?.fibonacciAnchorPriceGuide?.(pending);
      if (!guide) return;
      const lineY = candleSeries.priceToCoordinate(guide.point.price);
      if (!Number.isFinite(lineY) || lineY < 0 || lineY > height) return;
      const formattedPrice = formatQuotePrice(guide.point.price, symbolSelect.value, "derived-price");
      const labelText = `待選 ${guide.anchorLabel}｜${formattedPrice}`;
      const labelWidth = Math.min(rightEdge - 8, Math.max(96, labelText.length * 7 + 18));
      if (labelWidth < 72) return;
      const labelHeight = 22;
      const labelRight = rightEdge - 4;
      const labelCenterY = Math.max(labelHeight / 2 + 2, Math.min(height - labelHeight / 2 - 2, lineY));
      const group = make("g", {
        class: "chart-annotation-fibonacci-price-guide",
        "aria-label": `費波那契待選錨點 ${guide.anchorLabel}，價格 ${formattedPrice}`,
        "data-export-exclude": "",
      });
      group.appendChild(make("line", {
        x1: 0,
        y1: lineY,
        x2: rightEdge,
        y2: lineY,
        class: "chart-annotation-fibonacci-price-guide-halo",
      }));
      group.appendChild(make("line", {
        x1: 0,
        y1: lineY,
        x2: rightEdge,
        y2: lineY,
        class: "chart-annotation-fibonacci-price-guide-line",
      }));
      group.appendChild(make("rect", {
        x: labelRight - labelWidth,
        y: labelCenterY - labelHeight / 2,
        width: labelWidth,
        height: labelHeight,
        rx: 3,
        class: "chart-annotation-fibonacci-price-guide-label-bg",
      }));
      const label = make("text", {
        x: labelRight - 7,
        y: labelCenterY + 4,
        class: "chart-annotation-fibonacci-price-guide-label",
        "text-anchor": "end",
      });
      label.textContent = labelText;
      group.appendChild(label);
      svg.appendChild(group);
    };
    const fibonacci = Array.isArray(annotationState.completed.fibonacci)
      ? annotationState.completed.fibonacci
      : [];
    fibonacci.forEach((drawing, index) => {
      if (!drawing?.levels?.length) return;
      const monochrome = fibonacci.length > 1 && index > 0;
      renderFibonacciLevels(drawing.kind, drawing.anchors, drawing.levels, { monochrome });
      renderFibonacciAnchors(drawing.anchors, drawing.kind, { monochrome });
    });
    const pendingFibonacci = annotationState.pending?.type === "fibonacci" ? annotationState.pending : null;
    if (pendingFibonacci) {
      const previewIndex = pendingFibonacci.preview ? pendingFibonacci.anchors.length : -1;
      const previewAnchors = pendingFibonacci.preview
        ? [...pendingFibonacci.anchors, pendingFibonacci.preview]
        : pendingFibonacci.anchors;
      const required = pendingFibonacci.kind === "extension" ? 3 : 2;
      const previewLevels = previewAnchors.length === required
        ? window.QuoteChartAnnotations?.fibonacciLevels?.(pendingFibonacci.kind, previewAnchors)
        : [];
      const monochrome = fibonacci.some((drawing) => drawing.kind !== pendingFibonacci.kind);
      renderFibonacciLevels(pendingFibonacci.kind, previewAnchors, previewLevels, { pending: true, monochrome });
      renderFibonacciAnchorPriceGuide(pendingFibonacci);
      if (previewAnchors.length) {
        renderFibonacciAnchors(previewAnchors, pendingFibonacci.kind, { pending: true, previewIndex, monochrome });
      }
    }
    const priceRange = annotationState.completed.priceRange;
    if (priceRange?.result) {
      renderPriceRange(priceRange.start, priceRange.end, priceRange.result);
    }
    const pendingPriceRange = annotationState.pending?.type === "priceRange" ? annotationState.pending : null;
    if (pendingPriceRange?.anchors.length === 1 && pendingPriceRange.preview) {
      const result = window.QuoteChartAnnotations?.priceRange?.(pendingPriceRange.anchors[0], pendingPriceRange.preview);
      renderPriceRange(pendingPriceRange.anchors[0], pendingPriceRange.preview, result, true);
    }
    if (svg.childNodes.length) chartAnnotationLayer.appendChild(svg);
  }

  function renderMainOverlays(indicators, selectedMain) {
    renderFvgLayer([]);
    renderVolumeProfile({});
    renderProfileSummary({});
    renderFixedRangeVolumeProfile();
    renderVisibleRangeExtrema();
    renderChartAnnotations();
    if (selectedMain.has("pivotPoint")) renderPivotPointOverlay();
    else pivotPointLayer.replaceChildren();
    if (destroyed || !lastPayload) return;
    if (selectedMain.has("fvg")) renderFvgLayer(indicators.fvg || []);
    if (selectedMain.has("volumeProfile")) renderVolumeProfile(indicators);
    renderFixedRangeVolumeProfile();
    renderVisibleRangeExtrema();
    renderChartAnnotations();
    if (selectedMain.has("pivotPoint")) renderPivotPointOverlay();
  }

  function renderActiveMainOverlays() {
    if (destroyed || !lastPayload) return;
    renderMainOverlays(lastPayload.indicators || {}, getSelectedMainIndicators());
  }

  function scheduleOverlayRender() {
    if (!isPanelActive() || overlayFrame) return;
    overlayFrame = panelLifecycle.requestFrame(() => {
      overlayFrame = 0;
      if (!isPanelActive()) return;
      renderActiveMainOverlays();
      renderFixedRangeVolumeProfile();
      renderVisibleRangeExtrema();
      renderChartAnnotations();
      peRiverController?.render();
      if (sharedHoverTime !== undefined) positionSharedCrosshair(sharedHoverTime);
    });
  }

  function visibleCandlesForCurrentRange() {
    const candles = lastPayload?.candles || [];
    if (!candles.length || !chart) return [];
    const range = chart.timeScale().getVisibleLogicalRange?.();
    if (!isFiniteLogicalRange(range)) return candles;
    const from = Math.max(0, Math.floor(Number(range.from)));
    const to = Math.min(candles.length - 1, Math.ceil(Number(range.to)));
    if (to < from) return [];
    return candles.slice(from, to + 1);
  }

  function renderVisibleRangeExtrema() {
    if (!priceExtremaLayer) return;
    priceExtremaLayer.innerHTML = "";
    const visibleCandles = visibleCandlesForCurrentRange();
    if (!visibleCandles.length || !chart || !candleSeries || destroyed) return;
    const highCandle = visibleCandles.reduce((best, row) => (
      Number(row.high) > Number(best.high) ? row : best
    ), visibleCandles[0]);
    const lowCandle = visibleCandles.reduce((best, row) => (
      Number(row.low) < Number(best.low) ? row : best
    ), visibleCandles[0]);
    appendPriceExtremaLabel("high", highCandle, highCandle.high, -24);
    const sameCandle = normalizeChartTime(highCandle.time) === normalizeChartTime(lowCandle.time);
    appendPriceExtremaLabel("low", lowCandle, lowCandle.low, sameCandle ? 8 : 6);
  }

  function appendPriceExtremaLabel(kind, candle, value, offsetY) {
    const x = chart.timeScale().timeToCoordinate(candle.time);
    const y = candleSeries.priceToCoordinate(value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rightEdge = surface.clientWidth - getAxisSafeWidth() - 6;
    const labelWidth = 74;
    const labelHeight = 18;
    const left = Math.max(4, Math.min(rightEdge - labelWidth, Math.round(x - labelWidth / 2)));
    const top = Math.max(4, Math.min(surface.clientHeight - labelHeight - 4, Math.round(y + offsetY)));
    const label = document.createElement("div");
    label.className = `price-extrema-label ${kind}`;
    label.textContent = formatQuotePrice(value, symbolSelect.value);
    label.style.left = `${left}px`;
    label.style.top = `${top}px`;
    label.title = `${kind === "high" ? "可視最高價" : "可視最低價"} ${formatQuotePrice(value, symbolSelect.value)}`;
    priceExtremaLayer.appendChild(label);
  }

  function getAxisSafeWidth() {
    const value = Number.parseFloat(getComputedStyle(element).getPropertyValue("--axis-safe-width"));
    return Number.isFinite(value) ? value : 72;
  }

  function drawLevels(indicators) {
    clearLevels();
    const candles = lastPayload?.candles || [];
    const firstTime = candles[0]?.time || Math.floor(Date.now() / 1000) - 86400;
    const latestTime = candles[candles.length - 1]?.time || Math.floor(Date.now() / 1000);
    ["poc", "vah", "val"].forEach((key) => {
      if (typeof indicators[key] !== "number") return;
      lineSeries.push(
        addLine(
          [
            { time: firstTime, value: indicators[key] },
            { time: latestTime, value: indicators[key] },
          ],
          key === "poc" ? "#facc15" : "#a78bfa",
          key === "poc" ? 2 : 1
        )
      );
    });
  }

  function clearLevels() {
    lineSeries = removeMainSeries(lineSeries);
  }

  function addLine(data, color, lineWidth, options = {}) {
    const preserveWhitespace = options.preserveWhitespace === true;
    const seriesOptions = { ...options };
    delete seriesOptions.preserveWhitespace;
    const defaultCrosshairMarkerVisible = options.crosshairMarkerVisible !== false;
    const series = chart.addSeries(LightweightCharts.LineSeries, {
      color,
      lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "",
      priceFormat: { type: "custom", formatter: (price) => formatQuotePrice(price, symbolSelect.value, "derived-price") },
      ...seriesOptions,
      crosshairMarkerRadius: CROSSHAIR_MARKER_RADIUS,
      crosshairMarkerBorderWidth: CROSSHAIR_MARKER_BORDER_WIDTH,
      crosshairMarkerVisible: isFibonacciSelectionActive() ? false : defaultCrosshairMarkerVisible,
    });
    mainLineCrosshairMarkerDefaults.set(series, defaultCrosshairMarkerVisible);
    series.setData(window.QuoteChartPayload.normalizeValueSeries(data, { preserveWhitespace }));
    return series;
  }

  function addIndicatorLine(data, color, options = {}) {
    const series = indicatorChart.addSeries(LightweightCharts.LineSeries, {
      color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "",
      ...options,
      crosshairMarkerRadius: CROSSHAIR_MARKER_RADIUS,
      crosshairMarkerBorderWidth: CROSSHAIR_MARKER_BORDER_WIDTH,
    });
    series.setData(compactSeries(data));
    return series;
  }

  function addIndicatorHistogram(data, color) {
    const series = indicatorChart.addSeries(LightweightCharts.HistogramSeries, {
      color,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "",
      priceFormat: { type: "custom", formatter: formatTechnicalAdaptiveAxis },
    });
    series.setData(compactSeries(data));
    return series;
  }

  function addIndicatorReferenceLine(series, price) {
    if (!series?.createPriceLine) return;
    series.createPriceLine({
      ...INDICATOR_REFERENCE_LINE_OPTIONS,
      price,
    });
  }

  function removeMainSeries(seriesList) {
    seriesList.forEach((series) => {
      mainLineCrosshairMarkerDefaults.delete(series);
      if (chart) chart.removeSeries(series);
    });
    return [];
  }

  function removeIndicatorSeries(seriesList) {
    seriesList.forEach((series) => {
      if (indicatorChart) indicatorChart.removeSeries(series);
    });
    return [];
  }

  function updateReadout(indicators, selectedMain, selectedSub) {
    setReadoutSelection(selectedMain, selectedSub);
    resetReadoutsToLatest();
  }

  function setReadoutSelection(selectedMain, selectedSub) {
    toggleReadoutRow(mainReadout, "ohlc", true);
    toggleReadout(mainReadout, "date", true);
    toggleReadoutRow(mainReadout, "ma", selectedMain.has("ma"));
    toggleReadoutRow(mainReadout, "volume", selectedMain.has("volume"));
    toggleReadoutRow(mainReadout, "bollinger", selectedMain.has("bollinger"));
    toggleReadoutRow(mainReadout, "pivotPoint", selectedMain.has("pivotPoint"));
    toggleReadoutRow(mainReadout, "fvg", selectedMain.has("fvg"));
    toggleReadoutRow(mainReadout, "volumeProfile", selectedMain.has("volumeProfile"));
    toggleReadoutRow(mainReadout, "peRiver", selectedMain.has("peRiver"));
    toggleReadoutRow(mainReadout, "estimatedMarginCost", selectedMain.has("estimatedMarginCost"));
    toggleReadoutGroup(mainReadout, ["open", "high", "low", "close", "change", "changePercent"], true);
    toggleReadoutGroup(mainReadout, ["ma5", "ma10", "ma20", "ma60", "ma120"], selectedMain.has("ma"));
    toggleReadoutGroup(mainReadout, ["volume", "volumeMa5", "volumeMa10", "volumeMa20"], selectedMain.has("volume"));
    toggleReadoutGroup(mainReadout, ["bollU", "bollM", "bollL"], selectedMain.has("bollinger"));
    toggleReadoutGroup(mainReadout, ["pivotReference", "pivotApplies", "pivotStatus", "pivotP", "pivotR1", "pivotR2", "pivotR3", "pivotS1", "pivotS2", "pivotS3"], selectedMain.has("pivotPoint"));
    toggleReadout(mainReadout, "fvg", selectedMain.has("fvg"));
    toggleReadoutGroup(mainReadout, ["volumeProfile", "poc", "vah", "val"], selectedMain.has("volumeProfile"));
    toggleReadout(mainReadout, "estimatedMarginCost", selectedMain.has("estimatedMarginCost"));
    toggleReadoutGroup(subReadout, ["rsiShort", "rsiLong"], selectedSub.has("rsi"));
    toggleReadout(subReadout, "date", true);
    toggleReadout(subReadout, "kdK", selectedSub.has("kd"));
    toggleReadout(subReadout, "kdD", selectedSub.has("kd"));
    toggleReadout(subReadout, "macd", selectedSub.has("macd"));
    toggleReadout(subReadout, "atr", selectedSub.has("atr"));
  }

  function resetReadoutsToLatest() {
    if (state.mainReadoutMode === MAIN_READOUT_MODES.fixed) restoreLatestMainReadout();
    else mainReadout.classList.add("hidden");
    restoreLatestTechnicalReadout();
  }

  function restoreLatestMainReadout() {
    const time = latestCandleTime();
    if (!time || !lastPayload) {
      mainReadout.classList.add("hidden");
      return;
    }
    updateReadoutsForTime(time);
  }

  function refreshMainReadoutMode() {
    const mode = normalizeMainReadoutMode(state.mainReadoutMode);
    if (mainReadoutModeSelect) mainReadoutModeSelect.value = mode;
    mainReadout.classList.toggle("main-readout--fixed", mode === MAIN_READOUT_MODES.fixed);
    mainReadout.classList.toggle("cursor-tooltip", mode === MAIN_READOUT_MODES.floating);
    mainReadout.removeAttribute("data-side");
    mainReadout.style.removeProperty("left");
    if (lastPayload) resetReadoutsToLatest();
  }

  function updateReadoutsForTime(time) {
    if (!lastPayload) return;
    const indicators = lastPayload.indicators || {};
    const selectedMain = getSelectedMainIndicators();
    const selectedSub = getSelectedSubIndicators();
    const derivedPriceFormatter = (value) => formatQuotePrice(value, symbolSelect.value, "derived-price");
    const candle = candleAt(time);
    const previous = previousCandleAt(time);
    setReadoutSelection(selectedMain, selectedSub);
    setReadoutDate(mainReadout, candle?.time ?? time);
    updateOhlcReadout(candle, previous);
    peRiverController?.updateReadout(time, candle?.close);

    const volumeMa5 = indicators.volume_moving_average?.ma5 || [];
    const volumeMa10 = indicators.volume_moving_average?.ma10 || [];
    const volumeMa20 = indicators.volume_moving_average?.ma20 || [];
    setReadoutValue(mainReadout, "volume", candle?.volume, formatInteger);
    setReadoutValue(mainReadout, "volumeMa5", valueAt(volumeMa5, time), formatInteger);
    setReadoutValue(mainReadout, "volumeMa10", valueAt(volumeMa10, time), formatInteger);
    setReadoutValue(mainReadout, "volumeMa20", valueAt(volumeMa20, time), formatInteger);
    setTrend("volume", trendClass((candle?.volume ?? 0) - (previous?.volume ?? candle?.volume ?? 0)), true);
    setTrend("volumeMa5", seriesTrendAt(volumeMa5, time), true);
    setTrend("volumeMa10", seriesTrendAt(volumeMa10, time), true);
    setTrend("volumeMa20", seriesTrendAt(volumeMa20, time), true);

    setReadoutValue(mainReadout, "ma5", valueAt(indicators.moving_average?.ma5 || [], time), derivedPriceFormatter);
    setReadoutValue(mainReadout, "ma10", valueAt(indicators.moving_average?.ma10 || [], time), derivedPriceFormatter);
    setReadoutValue(mainReadout, "ma20", valueAt(indicators.moving_average?.ma20 || [], time), derivedPriceFormatter);
    setReadoutValue(mainReadout, "ma60", valueAt(indicators.moving_average?.ma60 || [], time), derivedPriceFormatter);
    setReadoutValue(mainReadout, "ma120", valueAt(indicators.moving_average?.ma120 || [], time), derivedPriceFormatter);
    setMovingAverageReadoutColors(mainReadout);
    setReadoutValue(mainReadout, "bollU", valueAt(indicators.bollinger?.upper || [], time), derivedPriceFormatter);
    setReadoutValue(mainReadout, "bollM", valueAt(indicators.bollinger?.middle || [], time), derivedPriceFormatter);
    setReadoutValue(mainReadout, "bollL", valueAt(indicators.bollinger?.lower || [], time), derivedPriceFormatter);
    setBollingerReadoutColors(mainReadout);
    updatePivotReadout();
    setReadoutValue(mainReadout, "fvg", fvgCountAt(time, indicators.fvg || []), formatInteger);
    setReadoutValue(mainReadout, "volumeProfile", Array.isArray(indicators.volume_profile) ? indicators.volume_profile.length : undefined, formatInteger);
    setReadoutValue(mainReadout, "poc", indicators.poc, derivedPriceFormatter);
    setReadoutValue(mainReadout, "vah", indicators.vah, derivedPriceFormatter);
    setReadoutValue(mainReadout, "val", indicators.val, derivedPriceFormatter);
    const estimatedMargin = estimatedMarginRowsByDate.get(chartSessionDate(candle?.time ?? time));
    setReadoutValue(mainReadout, "estimatedMarginCost", estimatedMargin?.estimatedCostPrice, derivedPriceFormatter);
    setReadoutItemColor(mainReadout, "estimatedMarginCost", "#fb7185");

    updateTechnicalReadoutForTime(time, { indicators, selectedSub });

    mainReadout.classList.toggle("hidden", !candle || !readoutHasVisibleValues(mainReadout));
  }

  function updateTechnicalReadoutForTime(time, options = {}) {
    const candle = candleAt(time);
    const indicators = options.indicators || lastPayload?.indicators || {};
    const selectedSub = options.selectedSub || getSelectedSubIndicators();
    const latest = Boolean(options.latest);
    setReadoutSelection(getSelectedMainIndicators(), selectedSub);
    setReadoutDate(subReadout, candle?.time ?? time);
    const readValue = (series) => latest ? latestValueAtOrBefore(series, time) : valueAt(series, time);
    const parameters = indicators.parameters || state.indicatorParameters;
    const shortLabel = subReadout.querySelector('[data-sub-label="rsiShort"]');
    const longLabel = subReadout.querySelector('[data-sub-label="rsiLong"]');
    if (shortLabel) shortLabel.textContent = `RSI${parameters.rsi?.shortPeriod || state.indicatorParameters.rsi.shortPeriod}`;
    if (longLabel) longLabel.textContent = `RSI${parameters.rsi?.longPeriod || state.indicatorParameters.rsi.longPeriod}`;
    setReadoutValue(subReadout, "rsiShort", readValue(indicators.rsi?.short || []), formatOscillatorValue);
    setReadoutValue(subReadout, "rsiLong", readValue(indicators.rsi?.long || []), formatOscillatorValue);
    setReadoutValue(subReadout, "kdK", readValue(indicators.kd?.k || []), formatOscillatorValue);
    setReadoutValue(subReadout, "kdD", readValue(indicators.kd?.d || []), formatOscillatorValue);
    setReadoutValue(subReadout, "macd", readValue(indicators.macd?.line || []), formatAdaptiveIndicatorValue);
    setReadoutValue(subReadout, "atr", readValue(indicators.atr || []), formatAdaptiveIndicatorValue);
    setSubIndicatorReadoutColors();
    subReadout.classList.toggle("hidden", !candle || !readoutHasVisibleValues(subReadout));
  }

  function restoreLatestTechnicalReadout() {
    const time = latestCandleTime();
    if (!time || !lastPayload) {
      subReadout.classList.add("hidden");
      return;
    }
    updateTechnicalReadoutForTime(time, { latest: true });
  }

  function updateOhlcReadout(candle, previous) {
    const close = candle?.close;
    const tradePriceFormatter = (value) => formatQuotePrice(value, symbolSelect.value, "trade-price");
    setReadoutValue(mainReadout, "open", candle?.open, tradePriceFormatter);
    setReadoutValue(mainReadout, "high", candle?.high, tradePriceFormatter);
    setReadoutValue(mainReadout, "low", candle?.low, tradePriceFormatter);
    setReadoutValue(mainReadout, "close", close, tradePriceFormatter);
    const change = candle && previous ? close - previous.close : 0;
    const changePercent = candle && previous?.close ? (change / previous.close) * 100 : 0;
    setReadoutValue(mainReadout, "change", change, (value) => formatSignedQuotePrice(value, symbolSelect.value, close));
    setReadoutValue(mainReadout, "changePercent", changePercent, formatSignedPercent);
    const trend = trendClass(change);
    setTrend("close", trend);
    setTrend("change", trend);
    setTrend("changePercent", trend);
  }

  function setMovingAverageReadoutColors(root) {
    setReadoutItemColor(root, "ma5", MOVING_AVERAGE_STYLES.ma5.color);
    setReadoutItemColor(root, "ma10", MOVING_AVERAGE_STYLES.ma10.color);
    setReadoutItemColor(root, "ma20", MOVING_AVERAGE_STYLES.ma20.color);
    setReadoutItemColor(root, "ma60", MOVING_AVERAGE_STYLES.ma60.color);
    setReadoutItemColor(root, "ma120", MOVING_AVERAGE_STYLES.ma120.color);
  }

  function setBollingerReadoutColors(root) {
    setReadoutItemColor(root, "bollU", BOLLINGER_EDGE_COLOR);
    setReadoutItemColor(root, "bollM", BOLLINGER_EDGE_COLOR);
    setReadoutItemColor(root, "bollL", BOLLINGER_EDGE_COLOR);
  }

  function setSubIndicatorReadoutColors() {
    setReadoutItemColor(subReadout, "rsiShort", SUB_INDICATOR_STYLES.rsiShort.color);
    setReadoutItemColor(subReadout, "rsiLong", SUB_INDICATOR_STYLES.rsiLong.color);
    setReadoutItemColor(subReadout, "kdK", SUB_INDICATOR_STYLES.kdK.color);
    setReadoutItemColor(subReadout, "kdD", SUB_INDICATOR_STYLES.kdD.color);
    setReadoutItemColor(subReadout, "macd", SUB_INDICATOR_STYLES.macd.color);
    setReadoutItemColor(subReadout, "atr", SUB_INDICATOR_STYLES.atr.color);
  }

  function candleAt(time) {
    const target = normalizeChartTime(time);
    return (lastPayload?.candles || []).find((row) => normalizeChartTime(row.time) === target);
  }

  function sharedCandleTimeForScreenX(screenX) {
    if (!chart || !lastPayload || !Number.isFinite(Number(screenX))) return undefined;
    const rect = surface.getBoundingClientRect();
    const coordinate = window.QuoteChartPayload?.plotCoordinateForScreenX?.(
      Number(screenX),
      rect.left,
      rect.width,
      getAxisSafeWidth(),
    );
    if (!Number.isFinite(coordinate)) return undefined;
    const time = chart.timeScale().coordinateToTime?.(coordinate);
    return candleAt(time)?.time;
  }

  function sharedCandleTimeForCrosshair(param, sourceSurface = surface) {
    const localX = Number(param?.point?.x);
    if (Number.isFinite(localX) && sourceSurface) {
      const time = sharedCandleTimeForScreenX(sourceSurface.getBoundingClientRect().left + localX);
      if (time) return time;
    }
    return candleAt(param?.time)?.time;
  }

  function previousCandleAt(time) {
    const target = normalizeChartTime(time);
    const candles = lastPayload?.candles || [];
    const index = candles.findIndex((row) => normalizeChartTime(row.time) === target);
    return index > 0 ? candles[index - 1] : undefined;
  }

  function latestCandleTime() {
    const candles = lastPayload?.candles || [];
    return candles[candles.length - 1]?.time;
  }

  function fvgCountAt(time, gaps) {
    const target = normalizeChartTime(time);
    return gaps.filter((gap) => normalizeChartTime(gap.time) === target).length;
  }

  function handleCrosshairMove(param) {
    if (!isPanelActive() || isSyncingCrosshair) return;
    const time = sharedCandleTimeForCrosshair(param, surface);
    if (!time || !candleAt(time)) {
      clearSyncedCrosshair();
      return;
    }
    sharedHoverTime = time;
    syncCrosshairForTime(time);
  }

  function handleIndicatorCrosshairMove(param) {
    if (!isPanelActive() || isSyncingCrosshair) return;
    const time = sharedCandleTimeForCrosshair(param, indicatorSurface);
    if (!time || !candleAt(time)) {
      clearSyncedCrosshair();
      return;
    }
    sharedHoverTime = time;
    syncCrosshairForTime(time);
  }

  function handleSurfacePointerMove(event) {
    if (!isPanelActive() || !chart || !lastPayload) return;
    if (chartAnnotationController?.hasPending?.()) {
      chartAnnotationController.previewPoint(chartPointForPanelEvent(event));
    }
    const time = sharedCandleTimeForScreenX(event.clientX);
    if (!time || !candleAt(time)) return;
    sharedHoverTime = time;
    syncCrosshairForTime(time);
  }

  function handleIndicatorSurfacePointerMove(event) {
    if (!isPanelActive() || !indicatorChart || !lastPayload) return;
    const time = sharedCandleTimeForScreenX(event.clientX);
    if (!time || !candleAt(time)) return;
    sharedHoverTime = time;
    syncCrosshairForTime(time);
  }

  function handleSurfacePointerLeave() {
    chartAnnotationController?.previewPoint();
    clearSyncedCrosshair();
  }

  function handleWindowMouseLocation(event) {
    if (!isPanelActive()) return;
    const chartHost = event.target?.closest?.(".chart-surface, .indicator-chart, .chip-pane-chart");
    if (chartHost && element.contains(chartHost)) {
      if (chartHost !== surface && chartAnnotationController?.hasPending?.()) {
        chartAnnotationController.previewPoint();
      }
      return;
    }
    if (chartAnnotationController?.hasPending?.()) chartAnnotationController.previewPoint();
    if (sharedHoverTime === undefined) return;
    clearSyncedCrosshair();
  }

  function positionCursorTooltip(node, host, screenX) {
    if (!node || node.classList.contains("hidden") || !host || !Number.isFinite(screenX)) return;
    const hostRect = host.getBoundingClientRect();
    const x = screenX - hostRect.left;
    const width = Math.min(node.getBoundingClientRect().width || 0, Math.max(0, hostRect.width - getAxisSafeWidth() - 12));
    const gap = 10;
    const fitsRight = x + gap + width <= hostRect.width - getAxisSafeWidth() - 6;
    node.dataset.side = fitsRight ? "right" : "left";
    node.style.left = `${fitsRight ? Math.max(6, x + gap) : Math.min(hostRect.width - getAxisSafeWidth() - 6, x - gap)}px`;
  }

  function positionSharedCrosshair(time) {
    if (!chart || !time || !candleAt(time)) {
      hideSharedCrosshair();
      return;
    }
    const coordinate = chart.timeScale().timeToCoordinate(time);
    if (!Number.isFinite(coordinate)) {
      hideSharedCrosshair();
      return;
    }
    const panelRect = element.getBoundingClientRect();
    const mainRect = surface.getBoundingClientRect();
    const screenX = mainRect.left + coordinate;
    const plotRects = [mainRect];
    if (isTechnicalSubchartVisible() && indicatorChart) plotRects.push(indicatorSurface.getBoundingClientRect());
    plotRects.push(...(chipPaneManager?.plotRects() || []));
    const bottom = Math.max(...plotRects.map((rect) => rect.bottom));
    panelCrosshairLine.style.left = `${screenX - panelRect.left}px`;
    panelCrosshairLine.style.top = `${mainRect.top - panelRect.top}px`;
    panelCrosshairLine.style.height = `${Math.max(0, bottom - mainRect.top)}px`;
    panelCrosshairLine.hidden = false;
    const dateText = formatChartDate(time);
    if (panelCrosshairDate && dateText) {
      panelCrosshairDate.textContent = dateText;
      panelCrosshairDate.hidden = false;
      const labelWidth = panelCrosshairDate.offsetWidth || 82;
      const clampedX = clampCrosshairDateX(coordinate, mainRect.width, getAxisSafeWidth(), labelWidth);
      panelCrosshairDate.style.left = `${clampedX}px`;
    }
    if (state.mainReadoutMode === MAIN_READOUT_MODES.floating) {
      positionCursorTooltip(mainReadout, surface, screenX);
    }
    chipPaneManager?.showReadouts(time);
  }

  function hideSharedCrosshair() {
    panelCrosshairLine.hidden = true;
    if (panelCrosshairDate) {
      panelCrosshairDate.hidden = true;
      panelCrosshairDate.textContent = "";
    }
    if (state.mainReadoutMode === MAIN_READOUT_MODES.fixed) restoreLatestMainReadout();
    else {
      mainReadout.classList.add("hidden");
      peRiverController?.clearReadout();
    }
    restoreLatestTechnicalReadout();
    chipPaneManager?.restoreLatestReadouts();
  }

  function syncCrosshairForTime(time) {
    if (!isPanelActive() || !chart || !candleSeries || !time || !candleAt(time)) return;
    pendingSharedHoverTime = time;
    if (crosshairRenderFrame) return;
    crosshairRenderFrame = panelLifecycle.requestFrame(() => {
      crosshairRenderFrame = 0;
      if (!isPanelActive()) return;
      const pendingTime = pendingSharedHoverTime;
      pendingSharedHoverTime = undefined;
      renderSyncedCrosshair(pendingTime);
    });
  }

  function renderSyncedCrosshair(time) {
    if (!isPanelActive() || !chart || !candleSeries || !time || !candleAt(time)) return;
    const candle = candleAt(time);
    const indicatorValue = indicatorCrosshairValue(time);
    updateReadoutsForTime(time);
    isSyncingCrosshair = true;
    if (typeof chart.setCrosshairPosition === "function") {
      try { chart.setCrosshairPosition(candle.close, time, candleSeries); } catch {}
    }
    if (isTechnicalSubchartVisible() && indicatorChart && indicatorSeries.length && typeof indicatorChart.setCrosshairPosition === "function" && Number.isFinite(indicatorValue)) {
      try { indicatorChart.setCrosshairPosition(indicatorValue, time, indicatorSeries[0]); } catch {}
    }
    chipPaneManager?.syncCrosshair(time);
    isSyncingCrosshair = false;
    positionSharedCrosshair(time);
  }

  function clearSyncedCrosshair() {
    sharedHoverTime = undefined;
    pendingSharedHoverTime = undefined;
    if (crosshairRenderFrame) {
      panelLifecycle.cancelFrame(crosshairRenderFrame);
      crosshairRenderFrame = 0;
    }
    isSyncingCrosshair = true;
    chipPaneManager?.clearCrosshair();
    if (chart && typeof chart.clearCrosshairPosition === "function") {
      try { chart.clearCrosshairPosition(); } catch {}
    }
    if (isTechnicalSubchartVisible() && indicatorChart && typeof indicatorChart.clearCrosshairPosition === "function") {
      try { indicatorChart.clearCrosshairPosition(); } catch {}
    }
    isSyncingCrosshair = false;
    hideSharedCrosshair();
  }

  function indicatorCrosshairValue(time) {
    if (!lastPayload) return undefined;
    const indicators = lastPayload.indicators || {};
    const selectedSub = getSelectedSubIndicators();
    const candidates = [];
    if (selectedSub.has("rsi")) {
      candidates.push(valueAt(indicators.rsi?.short || [], time));
      candidates.push(valueAt(indicators.rsi?.long || [], time));
    }
    if (selectedSub.has("kd")) {
      candidates.push(valueAt(indicators.kd?.k || [], time));
      candidates.push(valueAt(indicators.kd?.d || [], time));
    }
    if (selectedSub.has("macd")) candidates.push(valueAt(indicators.macd?.line || [], time));
    if (selectedSub.has("atr")) candidates.push(valueAt(indicators.atr || [], time));
    return candidates.find(Number.isFinite);
  }

  function toggleReadoutGroup(root, keys, visible) {
    keys.forEach((key) => toggleReadout(root, key, visible));
  }

  function toggleReadoutRow(root, row, visible) {
    const node = root.querySelector(`[data-readout-row="${row}"]`);
    if (node) node.classList.toggle("hidden", !visible);
  }

  function toggleReadout(root, key, visible) {
    const attr = root === mainReadout ? "data-main-readout" : "data-sub-readout";
    const node = root.querySelector(`[${attr}="${key}"]`);
    if (node) node.classList.toggle("hidden", !visible);
  }

  function readoutHasVisibleValues(root) {
    return [...root.querySelectorAll("[data-main-readout], [data-sub-readout]")].some((node) => {
      const row = node.closest("[data-readout-row]");
      return !node.classList.contains("hidden") && !row?.classList.contains("hidden");
    });
  }

  function setTrend(key, trend, showArrow = false) {
    const node = mainReadout.querySelector(`[data-main-readout="${key}"]`);
    if (!node) return;
    node.classList.remove("trend-up", "trend-down", "trend-flat");
    node.classList.add(trend);
    if (showArrow) node.dataset.trendArrow = trend === "trend-up" ? "↑" : trend === "trend-down" ? "↓" : "";
    else delete node.dataset.trendArrow;
  }

  function applyLiveEvent(event) {
    if (event.type === "status") {
      status.textContent = formatStatusMessage(event.message);
      return;
    }
    if (event.type !== "candle" || !event.candle) return;
    const { latest, previous } = upsertStreamingCandle(event.candle);
    if (event.indicators && lastPayload) lastPayload.indicators = mergeIndicatorPayload(lastPayload.indicators || {}, event.indicators);
    if (event.quote && lastPayload) {
      lastPayload.quote = event.quote;
      lastPayload.quoteTime = event.quote.sourceQuoteTime || null;
      lastPayload.marketSession = event.quote.marketSession || lastPayload.marketSession;
    }
    candleSeries.update(latest);
    const selectedMain = getSelectedMainIndicators();
    if (selectedMain.has("volume")) {
      const volumePoint = (event.indicators?.volume || []).find((row) => normalizeChartTime(row.time) === normalizeChartTime(latest.time));
      if (volumePoint) volumeSeries?.update(volumePoint);
      for (const [seriesIndex, key] of ["ma5", "ma10", "ma20"].entries()) {
        const point = (event.indicators?.volume_moving_average?.[key] || []).find((row) => normalizeChartTime(row.time) === normalizeChartTime(latest.time));
        if (point?.value != null) volumeMovingAverageSeries[seriesIndex]?.update(point);
      }
    }
    if (selectedMain.has("pivotPoint") && event.indicators?.pivot_points) drawPivotPoints(lastPayload.indicators?.pivot_points);
    const selectedSub = getSelectedSubIndicators();
    if (event.indicators && selectedSub.size) {
      renderIndicatorChart(lastPayload.indicators || {}, selectedSub);
      updateTechnicalReadoutForTime(latest.time, { indicators: lastPayload.indicators || {}, selectedSub, latest: true });
    }
    chipPaneManager?.updateCandles?.(lastPayload?.candles || []);
    const liveVisibleTimeRange = chart.timeScale().getVisibleRange?.();
    if (liveVisibleTimeRange?.from && liveVisibleTimeRange?.to) setSynchronizedVisibleTimeRange(liveVisibleTimeRange);
    scheduleRenderedAxisSafeWidthSync();
    if (state.mainReadoutMode === MAIN_READOUT_MODES.fixed) restoreLatestMainReadout();
    updateVolumeAvailability({ quote: event.quote }, selectedMain.has("volume"));
    updateQuoteDataTime(lastPayload?.quote, quoteTimeForLatestCandle(lastPayload, latest));
    updateLatestPriceLabel(lastPayload);
    updateLatestPriceState(latest.close, previous?.close, lastPayload);
    renderVisibleRangeExtrema();
  }

  function realtimeEligible(symbol, interval) {
    return Boolean(state.appConfig.capabilities?.taiwanRealtime)
      && state.sourceMode !== "yahoo"
      && isTaiwanRealtimeSymbol(symbol)
      && ["1d", "1wk", "1mo"].includes(interval);
  }

  function realtimeQuote(snapshot, displayState) {
    return {
      ...(canonicalPayload?.quote || {}),
      kind: "realtime",
      sourceProvider: "shioaji",
      sourceQuoteTime: snapshot.sourceTime,
      sourceTimeZone: "Asia/Taipei",
      sessionDate: snapshot.sessionDate,
      marketPhase: displayState === "closing" ? "closing" : displayState === "closed" ? "closed" : "open",
      marketSession: displayState === "closed" ? "closed" : "open",
      freshness: displayState === "degraded" ? "degraded" : "fresh",
      realtimeState: displayState,
      volumeAvailability: snapshot.volumeAvailable === false
        ? { status: "unavailable", reason: "source_not_provided", message: "此指數即時來源未提供成交量" }
        : { status: "available", reason: null, message: "" },
      verification: { status: "not_applicable", provider: null, reason: "market_open" },
    };
  }

  function scheduleRealtimeIndicatorRefresh(snapshot) {
    if (!lastPayload?.candles?.length) return;
    const symbol = symbolSelect.value;
    const interval = intervalSelect.value;
    const currentLoadToken = loadToken;
    const key = `${symbol}|${interval}|${indicatorParameterSignature()}|${currentLoadToken}|${snapshot.sessionDate}`;
    realtimeIndicatorScheduler.request(
      key,
      lastPayload.candles,
      state.indicatorParameters,
      { volumeAvailable: snapshot.volumeAvailable !== false },
      (computed, resultKey) => {
        const currentKey = `${symbolSelect.value}|${intervalSelect.value}|${indicatorParameterSignature()}|${loadToken}|${snapshot.sessionDate}`;
        if (!isPanelActive() || resultKey !== currentKey || resultKey !== key || !lastPayload) return;
        lastPayload.indicators = { ...(lastPayload.indicators || {}), ...computed };
        const selectedMain = getSelectedMainIndicators();
        const selectedSub = getSelectedSubIndicators();
        const volumeAvailable = snapshot.volumeAvailable !== false;
        volumeSeries?.setData(selectedMain.has("volume") && volumeAvailable ? compactSeries(computed.volume || []) : []);
        for (const [seriesIndex, name] of ["ma5", "ma10", "ma20"].entries()) {
          volumeMovingAverageSeries[seriesIndex]?.setData(
            selectedMain.has("volume") && volumeAvailable ? compactSeries(computed.volume_moving_average?.[name] || []) : [],
          );
        }
        if (selectedMain.has("ma")) drawMovingAverage(computed.moving_average || {});
        if (selectedMain.has("bollinger")) drawBollinger(computed.bollinger || {});
        if (effectivePanelSubchartMode() !== CHART_PRESENTATION_MODES.main && selectedSub.size) {
          renderIndicatorChart(lastPayload.indicators, selectedSub);
          syncIndicatorTimeAnchor(lastPayload.candles);
        }
        updateVolumeAvailability(lastPayload, selectedMain.has("volume"));
        updateReadout(lastPayload.indicators, selectedMain, selectedSub);
        scheduleRenderedAxisSafeWidthSync();
      },
    );
  }

  function applyRealtimeSnapshot(snapshot) {
    if (!canonicalPayload || !candleSeries || !realtimeEligible(symbolSelect.value, intervalSelect.value)) return;
    const previousLatestTime = normalizeChartTime(lastPayload?.candles?.at(-1)?.time);
    const previousVisibleTimeRange = chart.timeScale().getVisibleRange?.();
    const result = window.QuoteChartRealtimeCharts.mergeRealtimeOverlay({
      history: canonicalPayload.candles || [],
      dailyHistory: canonicalPayload.realtimeDailyHistory || [],
      interval: intervalSelect.value,
      snapshot,
      state: realtimeDisplayState,
    });
    if (!result.applied || !result.candle) return;
    const candle = result.candle;
    lastPayload = {
      ...canonicalPayload,
      candles: result.candles,
      quote: realtimeQuote(snapshot, realtimeDisplayState),
      quoteTime: candle.quoteTime,
      marketSession: "open",
    };
    candleSeries.update(candle);
    updateIndicatorTimeAnchor(candle);
    chipPaneManager?.updateCandles?.(result.candles);
    if (previousVisibleTimeRange?.from && previousVisibleTimeRange?.to) {
      const wasLatestVisible = previousLatestTime && normalizeChartTime(previousVisibleTimeRange.to) >= previousLatestTime;
      setSynchronizedVisibleTimeRange({
        from: previousVisibleTimeRange.from,
        to: wasLatestVisible ? candle.time : previousVisibleTimeRange.to,
      });
    }
    scheduleRenderedAxisSafeWidthSync();
    if (getSelectedMainIndicators().has("volume")) {
      if (snapshot.volumeAvailable !== false) volumeSeries?.update({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? "rgba(220, 38, 38, 0.72)" : "rgba(22, 163, 74, 0.72)",
      });
    }
    updateVolumeAvailability(lastPayload, getSelectedMainIndicators().has("volume"));
    scheduleRealtimeIndicatorRefresh(snapshot);
    updateQuoteDataTime(lastPayload.quote, candle.quoteTime);
    const previous = result.candles.at(-2);
    updateLatestPriceState(candle.close, previous?.close, lastPayload);
    updateLatestPriceLabel(lastPayload);
    renderVisibleRangeExtrema();
  }

  function previousCloseForSession(sessionDate) {
    const rows = canonicalPayload?.candles || [];
    return [...rows].reverse().find((row) => window.QuoteChartRealtimeCharts.sessionDateForTime(row.time) < sessionDate)?.close;
  }

  function renderIntraday(snapshot) {
    if (!intradayAccumulator || !intradayPriceSeries || !intradayAverageSeries || !volumeSeries) return;
    const model = intradayAccumulator.snapshot();
    if (!model.prices.length || !model.summary) return;
    intradayPriceSeries.setData(model.prices);
    intradayAverageSeries.setData(model.averages);
    volumeSeries.setData(model.volumes);
    const previousClose = Number(model.summary.previousClose);
    if (Number.isFinite(previousClose)) {
      const first = model.prices[0].time;
      const last = model.prices.at(-1).time;
      intradayPreviousCloseSeries?.setData([{ time: first, value: previousClose }, { time: Math.max(first + 1, last), value: previousClose }]);
    } else {
      intradayPreviousCloseSeries?.setData([]);
    }
    lastPayload = {
      ...(canonicalPayload || {}),
      candles: model.prices.map((point) => ({ time: point.time, open: point.value, high: point.value, low: point.value, close: point.value, volume: 0 })),
      quote: realtimeQuote(snapshot, realtimeDisplayState),
      quoteTime: Math.floor(Date.parse(snapshot.sourceTime) / 1000),
      marketSession: "open",
    };
    const values = { open: model.summary.open, high: model.summary.high, low: model.summary.low, close: model.summary.close };
    for (const [key, value] of Object.entries(values)) {
      const node = mainReadout.querySelector(`[data-ohlc="${key}"]`);
      if (node) node.textContent = formatQuotePrice(value, symbolSelect.value);
    }
    const dateNode = mainReadout.querySelector("[data-main-date]");
    if (dateNode) dateNode.textContent = `${model.summary.sessionDate} 分時`;
    const volumeNode = mainReadout.querySelector('[data-main-indicator="volume"]');
    if (volumeNode) volumeNode.textContent = formatInteger(model.summary.totalVolume);
    mainReadout.classList.remove("hidden");
    mainReadout.querySelectorAll(".readout-row").forEach((row) => row.classList.toggle("hidden", !row.matches('[data-readout-row="ohlc"], [data-readout-row="volume"]')));
    updateQuoteDataTime(lastPayload.quote, lastPayload.quoteTime);
    updateLatestPriceState(model.summary.close, previousClose, lastPayload);
    updateLatestPriceLabel(lastPayload);
    if (model.prices.length === 1) chart?.timeScale().fitContent();
  }

  function applyPendingIntradaySession(snapshot) {
    if (!intradayAccumulator || !pendingIntradaySession.length) return;
    intradayAccumulator.setPreviousClose(previousCloseForSession(snapshot.sessionDate));
    intradayAccumulator.loadMinuteSession(pendingIntradaySession, {
      sessionDate: snapshot.sessionDate,
      open: snapshot.open,
      high: snapshot.high,
      low: snapshot.low,
    });
    pendingIntradaySession = [];
  }

  function applyIntradayState(next) {
    realtimeDisplayState = String(next?.state || "unavailable");
    if (realtimeDisplayState === "live") {
      status.classList.remove("is-visible");
      if (latestRealtimeSnapshot) renderIntraday(latestRealtimeSnapshot);
      return;
    }
    const messages = {
      degraded: "即時連線不穩，分時圖顯示最後已接受行情",
      fallback: "即時行情中斷；Yahoo 延遲備援不提供逐筆分時路徑",
      stale: "即時資料過期，分時圖暫停更新",
      unavailable: "即時行情目前不可用",
      closing: "收盤整理中，分時圖保留今日最後行情",
      closed: "今日已收盤，分時圖顯示最後行情",
    };
    status.textContent = messages[realtimeDisplayState] || "即時行情狀態待確認";
    status.classList.add("is-visible");
    if (lastPayload?.quote) {
      lastPayload.quote = { ...lastPayload.quote, realtimeState: realtimeDisplayState === "degraded" ? "degraded" : "fallback" };
      updateQuoteDataTime(lastPayload.quote, lastPayload.quoteTime);
    }
  }

  async function loadIntraday(symbol, currentLoadToken) {
    if (!realtimeEligible(symbol, "1d") || !state.appConfig.capabilities?.taiwanIntradayTrend) {
      status.textContent = "此環境未啟用分時走勢";
      status.classList.add("is-visible");
      return;
    }
    clearPanelValues();
    canonicalPayload = null;
    intradayAccumulator = window.QuoteChartRealtimeCharts.createIntradayAccumulator();
    status.textContent = "載入今日分時資料中";
    status.classList.add("is-visible");
    realtimeDisplayState = "degraded";
    state.panelStreamSubscriptionCount += 1;
    realtimeUpdateCleanup = realtimeCoordinator.subscribe(panelSubscriptionId, { symbol }, (nextSnapshot) => {
      if (destroyed || currentLoadToken !== loadToken || intervalSelect.value !== "intraday") return;
      latestRealtimeSnapshot = nextSnapshot;
      applyPendingIntradaySession(nextSnapshot);
      intradayAccumulator.setPreviousClose(previousCloseForSession(nextSnapshot.sessionDate));
      if (intradayAccumulator.append(nextSnapshot)) renderIntraday(nextSnapshot);
    }, (next) => {
      if (destroyed || currentLoadToken !== loadToken || intervalSelect.value !== "intraday") return;
      applyIntradayState(next);
    }, (points) => {
      if (destroyed || currentLoadToken !== loadToken || intervalSelect.value !== "intraday") return;
      pendingIntradaySession = points;
      if (latestRealtimeSnapshot) {
        applyPendingIntradaySession(latestRealtimeSnapshot);
        intradayAccumulator.append(latestRealtimeSnapshot);
        renderIntraday(latestRealtimeSnapshot);
      }
    });
    try {
      state.panelDataRequestCount += 1;
      const { response, payload } = await fetchJsonWithTimeout(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=1d&display_count=45`, PANEL_CANDLE_LOAD_TIMEOUT_MS);
      if (!response.ok || payload.error) throw new Error(payload.error || "資料載入失敗");
      if (destroyed || currentLoadToken !== loadToken || intervalSelect.value !== "intraday") return;
      canonicalPayload = payload;
      if (latestRealtimeSnapshot) {
        intradayAccumulator.setPreviousClose(previousCloseForSession(latestRealtimeSnapshot.sessionDate));
        renderIntraday(latestRealtimeSnapshot);
      }
      state.panelStreamSubscriptionCount += 1;
      liveUpdateCleanup = liveBatchCoordinator.subscribe(panelSubscriptionId, { symbol, interval: "1d", pivot: "off", indicatorQuery: "" }, (item) => {
        if (destroyed || currentLoadToken !== loadToken || intervalSelect.value !== "intraday") return;
        if (item?.payload) {
          canonicalPayload = item.payload;
          if (latestRealtimeSnapshot) {
            intradayAccumulator.setPreviousClose(previousCloseForSession(latestRealtimeSnapshot.sessionDate));
            renderIntraday(latestRealtimeSnapshot);
          }
        }
      });
      status.textContent = "等待即時行情 snapshot";
    } catch (error) {
      if (destroyed || currentLoadToken !== loadToken) return;
      status.textContent = `延遲備援載入失敗，仍等待即時行情：${formatLoadErrorMessage(error)}`;
      status.classList.add("is-visible");
    }
  }

  function applyRealtimeState(next) {
    realtimeDisplayState = String(next?.state || "unavailable");
    if (["live", "degraded"].includes(realtimeDisplayState) && latestRealtimeSnapshot) {
      applyRealtimeSnapshot(latestRealtimeSnapshot);
      if (realtimeDisplayState === "degraded") {
        status.textContent = "即時連線不穩，顯示最後可用行情";
        status.classList.add("is-visible");
      } else {
        status.classList.remove("is-visible");
      }
      return;
    }
    if (["closing", "closed"].includes(realtimeDisplayState)) {
      if (canonicalHandoffReady()) {
        applyPayload({
          ...canonicalPayload,
          candles: (canonicalPayload.candles || []).map((row) => ({ ...row })),
          quote: canonicalPayload.quote ? { ...canonicalPayload.quote, realtimeState: "closed" } : canonicalPayload.quote,
        });
        latestRealtimeSnapshot = null;
        status.classList.remove("is-visible");
      } else {
        if (latestRealtimeSnapshot && lastPayload?.quote) {
          lastPayload.quote = realtimeQuote(latestRealtimeSnapshot, realtimeDisplayState);
          updateQuoteDataTime(lastPayload.quote, lastPayload.quoteTime);
        }
        status.textContent = realtimeDisplayState === "closing" ? "收盤整理中，等待 canonical 日 K 核對" : "已收盤，等待 canonical 日 K 核對";
        status.classList.add("is-visible");
      }
      return;
    }
    if (state.sourceMode === "shioaji" && ["fallback", "stale", "unavailable"].includes(realtimeDisplayState)) {
      status.textContent = "Shioaji 即時行情目前不可用；可切換為自動或 Yahoo 延遲";
      status.classList.add("is-visible");
      if (lastPayload?.quote) {
        lastPayload.quote = { ...lastPayload.quote, realtimeState: "unavailable", freshness: "unavailable" };
        updateQuoteDataTime(lastPayload.quote, lastPayload.quoteTime);
      }
      return;
    }
    if (canonicalPayload && ["fallback", "stale", "unavailable"].includes(realtimeDisplayState)) {
      const fallbackPayload = {
        ...canonicalPayload,
        candles: (canonicalPayload.candles || []).map((row) => ({ ...row })),
        quote: canonicalPayload.quote ? { ...canonicalPayload.quote, realtimeState: "fallback" } : canonicalPayload.quote,
      };
      applyPayload(fallbackPayload);
      updateQuoteDataTime(lastPayload?.quote, lastPayload?.quoteTime);
      status.textContent = "即時行情中斷，已切換 Yahoo 延遲備援";
      status.classList.add("is-visible");
    }
  }

  function canonicalHandoffReady() {
    return window.QuoteChartRealtimeCharts.canonicalHandoffReady(canonicalPayload, latestRealtimeSnapshot);
  }

  function connectStream(symbol, interval) {
    const streamPivotMode = selectedPivotMode();
    const streamLoadToken = loadToken;
    liveUpdateCleanup?.();
    liveUpdateCleanup = undefined;
    realtimeUpdateCleanup?.();
    realtimeUpdateCleanup = undefined;
    state.panelStreamSubscriptionCount += 1;
    liveUpdateCleanup = liveBatchCoordinator.subscribe(panelSubscriptionId, {
      symbol,
      interval,
      pivot: streamPivotMode || "off",
      indicatorQuery: indicatorParametersQuery(),
    }, (item) => {
      if (destroyed || !candleSeries || streamLoadToken !== loadToken || symbol !== symbolSelect.value || interval !== intervalSelect.value || streamPivotMode !== selectedPivotMode()) return;
      const payload = item?.payload;
      const candle = payload?.candles?.at(-1);
      if (payload) canonicalPayload = payload;
      if (["closing", "closed"].includes(realtimeDisplayState)) applyRealtimeState({ state: realtimeDisplayState });
      else if (latestRealtimeSnapshot && ["live", "degraded"].includes(realtimeDisplayState)) applyRealtimeSnapshot(latestRealtimeSnapshot);
      else if (candle) applyLiveEvent({ type: "candle", candle, indicators: payload.indicators, quote: payload.quote });
    }, () => {
      if (!destroyed && streamLoadToken === loadToken) status.textContent = "批次更新暫時中斷";
    });
    if (realtimeEligible(symbol, interval)) {
      realtimeDisplayState = "degraded";
      state.panelStreamSubscriptionCount += 1;
      realtimeUpdateCleanup = realtimeCoordinator.subscribe(panelSubscriptionId, { symbol }, (snapshot) => {
        if (destroyed || streamLoadToken !== loadToken || symbol !== symbolSelect.value || interval !== intervalSelect.value) return;
        latestRealtimeSnapshot = snapshot;
        if (["live", "degraded"].includes(realtimeDisplayState)) applyRealtimeSnapshot(snapshot);
      }, (next) => {
        if (destroyed || streamLoadToken !== loadToken || symbol !== symbolSelect.value || interval !== intervalSelect.value) return;
        applyRealtimeState(next);
      });
    } else {
      latestRealtimeSnapshot = null;
      realtimeDisplayState = "unavailable";
    }
  }

  function updateLatestPriceState(price, previousClose, payload) {
    const numeric = Number(price);
    const shouldAnimate = shouldAnimateLatestPriceUpdate(lastRenderedPrice, numeric, payload);
    lastRenderedPrice = Number.isFinite(numeric) ? numeric : undefined;
    priceValue.textContent = formatQuotePrice(numeric, symbolSelect.value);
    const previous = Number(previousClose);
    const change = Number.isFinite(numeric) && Number.isFinite(previous) ? numeric - previous : undefined;
    const changePercent = Number.isFinite(change) && Number.isFinite(previous) && previous !== 0 ? (change / previous) * 100 : undefined;
    renderLatestPriceChangeRow(change, changePercent, symbolSelect.value, numeric);
    const latestPriceState = classifyLatestPriceState(change, changePercent);
    priceStrip.classList.remove("trend-up", "trend-down", "trend-flat", "limit-up", "limit-down");
    priceStrip.classList.add(latestPriceState.trend);
    if (latestPriceState.limit) priceStrip.classList.add(latestPriceState.limit);
    priceDirection.textContent = latestPriceState.direction;
    if (shouldAnimate) triggerLatestPriceUpdate(latestPriceState.trend);
  }

  function updateQuoteDataTime(quote, fallbackTime) {
    if (!quoteTimeStrip) return;
    const display = formatQuoteDataState(quote, fallbackTime);
    const formatted = display.full;
    const compact = display.compact;
    quoteTimeStrip.dataset.fullText = formatted || "";
    quoteTimeStrip.dataset.compactText = compact || "";
    quoteTimeStrip.textContent = formatted || "--";
    quoteTimeStrip.title = display.title;
    quoteTimeStrip.dataset.quoteStatus = display.status;
    priceStrip.dataset.quoteStatus = display.status;
    const quoteStatuses = ["not-applicable", "pending", "verified", "unverified", "mismatch", "stale", "closed"];
    for (const status of quoteStatuses) priceStrip.classList.toggle(`is-quote-${status}`, display.status === status.replace("-", "_"));
    scheduleQuoteTimeFit();
  }

  function scheduleQuoteTimeFit() {
    if (!isPanelActive() || !quoteTimeStrip || quoteTimeFitFrame) return;
    quoteTimeFitFrame = panelLifecycle.requestFrame(() => {
      quoteTimeFitFrame = panelLifecycle.requestFrame(() => {
        quoteTimeFitFrame = 0;
        if (!isPanelActive()) return;
        fitQuoteDataTimeToPriceRow();
      });
    });
  }

  function fitQuoteDataTimeToPriceRow() {
    if (!quoteTimeStrip || !priceValue) return;
    const full = quoteTimeStrip.dataset.fullText || "";
    const compact = quoteTimeStrip.dataset.compactText || "";
    if (!full) {
      quoteTimeStrip.textContent = "--";
      return;
    }
    quoteTimeStrip.textContent = full;
    if (!compact || compact === full) return;
    const fullOverflows = quoteTimeStrip.scrollWidth > quoteTimeStrip.clientWidth + 1;
    if (fullOverflows || nodesOverlap(quoteTimeStrip, priceValue)) {
      quoteTimeStrip.textContent = compact;
    }
  }

  function quoteTimeForLatestCandle(payload, latestCandle) {
    const payloadQuoteTime = payload?.quote?.sourceQuoteTime || (payload ? payload.quoteTime : undefined);
    const candleQuoteTime = latestCandle ? latestCandle.quoteTime : undefined;
    return payloadQuoteTime || candleQuoteTime;
  }

  function triggerLatestPriceUpdate(trend) {
    if (priceUpdateTimer) panelLifecycle.clearTimer(priceUpdateTimer);
    priceStrip.classList.remove("is-price-updated", "updated-trend-up", "updated-trend-down", "updated-trend-flat");
    priceStrip.classList.add("is-price-updated", `updated-${trend || "trend-flat"}`);
    priceUpdateTimer = panelLifecycle.setTimer(() => {
      priceStrip.classList.remove("is-price-updated", "updated-trend-up", "updated-trend-down", "updated-trend-flat");
      priceUpdateTimer = 0;
    }, 850);
  }

  function renderLatestPriceChangeRow(change, changePercent, symbol = symbolSelect.value, referencePrice) {
    priceChange.textContent = Number.isFinite(change) ? formatLatestPriceChange(change, symbol, referencePrice) : "--";
    priceChangePercent.textContent = Number.isFinite(changePercent) ? formatLatestPricePercent(changePercent) : "--";
  }

  function updateLatestPriceLabel(payload) {
    const symbol = String(payload?.symbol || symbolSelect.value || "").trim();
    updateLatestPriceInstrumentLabel(symbol, latestPriceLabelForPayload(payload));
  }

  function updateLatestPriceInstrumentLabel(symbol = symbolSelect.value, sessionLabel = "") {
    const label = instrumentDisplayNameForSymbol(symbol);
    const identity = symbol && label !== symbol ? `${symbol}｜${label}` : label;
    const accessibleLabel = sessionLabel ? `${identity} ${sessionLabel}` : identity;
    priceLabel.textContent = label;
    priceLabel.dataset.sessionLabel = sessionLabel;
    priceLabel.title = accessibleLabel;
    priceStrip.title = accessibleLabel;
    priceStrip.setAttribute("aria-label", accessibleLabel);
  }

  function updatePanelReorderLabel(enabled = panelReorderingEnabled()) {
    const usable = Boolean(enabled && canonicalIdentity && state.panels.length > 1);
    element.dataset.panelReorderEnabled = String(usable);
    priceStrip.dataset.panelReorderEnabled = String(usable);
    panelReorderHandle.hidden = !usable;
    panelReorderHandle.disabled = !usable;
    if (!usable) return;
    const total = state.panels.length;
    const display = symbolSelect.value && symbolSelect.value !== canonicalItemSymbol ? `，目前顯示 ${symbolSelect.value}` : "";
    const label = `移動清單商品 ${canonicalItemSymbol}${display}，目前第 ${panelPosition + 1} 位，共 ${total} 位`;
    panelReorderHandle.setAttribute("aria-label", label);
    panelReorderHandle.title = `${label}；也可按住本區域拖曳`;
  }

  function setPosition(nextPosition) {
    panelPosition = Math.max(0, Number(nextPosition) || 0);
    element.dataset.panelIndex = String(panelPosition);
    updatePanelReorderLabel();
  }

  function setCanonicalItem(nextItem, nextPosition = panelPosition) {
    canonicalItem = nextItem;
    canonicalIdentity = panelCanonicalIdentity(activeMarketTab(), nextItem);
    canonicalItemSymbol = nextItem?.symbol || "";
    element.dataset.canonicalIdentity = canonicalIdentity;
    setPosition(nextPosition);
  }

  function handlePanelReorderPointerDown(event) {
    startPanelDragCandidate(event, controller);
  }

  function handlePanelReorderHandleKeydown(event) {
    handlePanelReorderKeydown(event, controller);
  }

  priceStrip.addEventListener("pointerdown", handlePanelReorderPointerDown);
  panelReorderHandle.addEventListener("keydown", handlePanelReorderHandleKeydown);

  function upsertStreamingCandle(candle) {
    if (!lastPayload) return { latest: candle, previous: undefined };
    const candles = lastPayload.candles || [];
    const candleTime = normalizeChartTime(candle.time);
    const existingIndex = candles.findIndex((row) => normalizeChartTime(row.time) === candleTime);
    if (existingIndex >= 0) {
      candles[existingIndex] = { ...candles[existingIndex], ...candle };
    } else {
      candles.push(candle);
    }
    lastPayload.candles = candles;
    const latestIndex = existingIndex >= 0 ? existingIndex : candles.length - 1;
    if (Object.prototype.hasOwnProperty.call(candles[latestIndex] || {}, "quoteTime")) {
      lastPayload.quoteTime = candles[latestIndex].quoteTime || null;
    }
    return { latest: candles[latestIndex], previous: candles[latestIndex - 1] };
  }

  controller = {
    element,
    load,
    refreshPanelLayout,
    scheduleAlignmentMeasurement,
    alignmentReport,
    viewStateReport,
    chipReadoutGeometry: () => chipPaneManager?.geometryReport?.() || [],
    cancelFixedProfileDrawing,
    updateFixedProfileToolAvailability,
    refreshSymbolOptions,
    applyOrderedSymbol,
    assertPaneCoordinateAlignment,
    refreshMainReadoutMode,
    getPosition: () => panelPosition,
    setPosition,
    getCanonicalIdentity: () => canonicalIdentity,
    getCanonicalSymbol: () => canonicalItemSymbol,
    getDisplaySymbol: () => symbolSelect.value,
    setCanonicalItem,
    setReorderEnabled: updatePanelReorderLabel,
    focusReorderHandle: () => panelReorderHandle.focus(),
    pauseStream() {
      realtimeIndicatorScheduler.cancel();
      eventSource?.close();
      eventSource = undefined;
      liveUpdateCleanup?.();
      liveUpdateCleanup = undefined;
      realtimeUpdateCleanup?.();
      realtimeUpdateCleanup = undefined;
    },
    resumeStream() {
      if (isPanelActive() && lastPayload && !eventSource && !liveUpdateCleanup) connectStream(symbolSelect.value, intervalSelect.value);
    },
    refreshChipMode() {
      if (!isPanelActive()) return;
      const mode = effectivePanelSubchartMode();
      chipPaneManager?.setMode(mode);
      if (mode !== CHART_PRESENTATION_MODES.main && lastPayload && indicatorChart) {
        const selectedSub = getSelectedSubIndicators();
        renderIndicatorChart(lastPayload.indicators || {}, selectedSub);
        syncIndicatorTimeAnchor(lastPayload.candles || []);
        updateReadout(lastPayload.indicators || {}, getSelectedMainIndicators(), selectedSub);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      realtimeIndicatorScheduler.cancel();
      panelLifecycle.dispose();
      liveUpdateCleanup?.();
      liveUpdateCleanup = undefined;
      realtimeUpdateCleanup?.();
      realtimeUpdateCleanup = undefined;
      panelExportAbortController?.abort();
      loadToken++;
      clearPanelLoadRetry();
      finishFixedProfileDrag();
      surface.removeEventListener("click", handleFixedProfileSurfaceClick);
      cleanupIndicatorMenus();
      element.removeEventListener("contextmenu", handlePanelContextMenu);
      element.removeEventListener("keydown", handlePanelContextKeydown);
      panelExportAction.removeEventListener("click", handlePanelExportClick);
      panelOrderAction.removeEventListener("click", handlePanelOrderClick);
      priceStrip.removeEventListener("pointerdown", handlePanelReorderPointerDown);
      panelReorderHandle.removeEventListener("keydown", handlePanelReorderHandleKeydown);
      panelRemoveTechnicalAction.removeEventListener("click", handleRemoveTechnicalSubchart);
      panelPeRiverDetailsAction.removeEventListener("click", togglePanelPeRiverDetails);
      document.removeEventListener("pointerdown", handlePanelContextPointerDown, true);
      document.removeEventListener("keydown", handlePanelContextKeydownGlobal, true);
      window.removeEventListener("blur", closePanelContextMenu);
      panelContextMenu.remove();
      detachOverlayRerenderHooks();
      chipPaneManager?.destroy();
      peRiverController?.destroy();
      chartAnnotationController?.cancel();
      chartAnnotationLayer?.replaceChildren();
      resetCharts();
    },
  };
  updatePanelReorderLabel(false);
  return controller;
}

function restoreIndicatorDefaults(inputs, defaults) {
  const selected = new Set(defaults);
  inputs.forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function resolveIndicatorMenuPlacement(summaryRect, contentHeight, viewportHeight, safetyMargin = 12, gap = 6) {
  const safeMargin = Math.max(0, Number(safetyMargin) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);
  const safeViewportHeight = Math.max(0, Number(viewportHeight) || 0);
  const summaryTop = Number.isFinite(Number(summaryRect?.top)) ? Number(summaryRect.top) : 0;
  const summaryBottom = Number.isFinite(Number(summaryRect?.bottom)) ? Number(summaryRect.bottom) : summaryTop;
  const naturalHeight = Math.max(0, Number(contentHeight) || 0);
  const availableAbove = Math.max(0, summaryTop - safeMargin - safeGap);
  const availableBelow = Math.max(0, safeViewportHeight - summaryBottom - safeMargin - safeGap);
  const direction = naturalHeight > availableBelow && availableAbove > availableBelow ? "up" : "down";
  const availableHeight = direction === "up" ? availableAbove : availableBelow;
  return {
    direction,
    maxHeight: Math.floor(availableHeight),
    needsScroll: naturalHeight > availableHeight,
  };
}

function resolveIndicatorMenuHorizontalAlignment(summaryRect, contentWidth, viewportWidth, safetyMargin = 12) {
  const safeMargin = Math.max(0, Number(safetyMargin) || 0);
  const safeViewportWidth = Math.max(0, Number(viewportWidth) || 0);
  const summaryLeft = Number.isFinite(Number(summaryRect?.left)) ? Number(summaryRect.left) : 0;
  const summaryRight = Number.isFinite(Number(summaryRect?.right)) ? Number(summaryRect.right) : summaryLeft;
  const naturalWidth = Math.max(0, Number(contentWidth) || 0);
  const leftAlignedRight = summaryLeft + naturalWidth;
  const rightAlignedLeft = summaryRight - naturalWidth;
  return leftAlignedRight > safeViewportWidth - safeMargin && rightAlignedLeft >= safeMargin ? "right" : "left";
}

function resetIndicatorMenuPosition(menu) {
  menu?.classList?.remove("opens-upward");
  menu?.classList?.remove("aligns-right");
  menu?.querySelector?.(".indicator-options")?.style?.removeProperty("--indicator-menu-max-height");
}

function positionIndicatorMenu(menu, viewportHeight = window.innerHeight, viewportWidth = window.innerWidth) {
  resetIndicatorMenuPosition(menu);
  if (!menu?.open) return undefined;
  const summary = menu.querySelector("summary");
  const options = menu.querySelector(".indicator-options");
  if (!summary || !options) return undefined;
  const placement = resolveIndicatorMenuPlacement(
    summary.getBoundingClientRect(),
    options.scrollHeight,
    viewportHeight,
  );
  const alignment = resolveIndicatorMenuHorizontalAlignment(
    summary.getBoundingClientRect(),
    options.offsetWidth,
    viewportWidth,
  );
  menu.classList.toggle("opens-upward", placement.direction === "up");
  menu.classList.toggle("aligns-right", alignment === "right");
  options.style.setProperty("--indicator-menu-max-height", `${placement.maxHeight}px`);
  return { ...placement, alignment };
}

function wireIndicatorMenus(menus) {
  const toggleHandlers = new Map();
  menus.forEach((menu) => {
    const handleToggle = () => {
      if (!menu.open) {
        resetIndicatorMenuPosition(menu);
        return;
      }
      menus.forEach((other) => {
        if (other !== menu) {
          other.open = false;
          resetIndicatorMenuPosition(other);
        }
      });
      positionIndicatorMenu(menu);
    };
    toggleHandlers.set(menu, handleToggle);
    menu.addEventListener("toggle", handleToggle);
  });

  function handleViewportChange(event) {
    if (event?.target?.closest?.(".indicator-options")) return;
    menus.forEach((menu) => {
      if (menu.open) positionIndicatorMenu(menu);
    });
  }

  function handleDocumentPointerDown(event) {
    if (event.button !== 0) return;
    for (const menu of menus) {
      if (menu.contains(event.target)) return;
    }
    menus.forEach((menu) => {
      menu.open = false;
      resetIndicatorMenuPosition(menu);
    });
  }

  function handleDocumentKeydown(event) {
    if (event.key !== "Escape") return;
    menus.forEach((menu) => {
      menu.open = false;
      resetIndicatorMenuPosition(menu);
    });
  }

  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("keydown", handleDocumentKeydown, true);
  window.addEventListener("resize", handleViewportChange, { passive: true });
  window.addEventListener("scroll", handleViewportChange, { passive: true, capture: true });
  return () => {
    for (const [menu, handler] of toggleHandlers) menu.removeEventListener("toggle", handler);
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    document.removeEventListener("keydown", handleDocumentKeydown, true);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("scroll", handleViewportChange, true);
    menus.forEach(resetIndicatorMenuPosition);
  };
}

function managedInstruments() {
  return state.instruments;
}

function personalTabLabelIsUnique(label) {
  const matches = state.marketTabs.filter((tab) => tabIdentity(tab).startsWith("personal:") && tab.label === label);
  return matches.length <= 1;
}

function symbolsForTab(tab) {
  return tab ? orderedInstrumentsForTab(tab) : managedInstruments();
}

function symbolsForActiveTab() {
  return symbolsForTab(activeMarketTab());
}

function currentChartCount() {
  const count = Number(document.getElementById("chart-count")?.value || state.panels.length || 4);
  return CHART_COUNTS.includes(count) ? count : 4;
}

function isSingleChartViewActive() {
  return currentChartCount() === 1 && Boolean(state.singleChartView);
}

function panelCountForActiveCategory(chartCount = currentChartCount()) {
  const page = activeCategoryPaginationState();
  return page.visibleSymbols.length || chartCount;
}

function categoryPageIndexForSymbol(symbols, symbol, chartCount) {
  const pageSize = CHART_COUNTS.includes(Number(chartCount)) ? Number(chartCount) : 4;
  const normalized = String(symbol || "").trim().toUpperCase();
  const symbolIndex = symbols.findIndex((item) => String(item || "").trim().toUpperCase() === normalized);
  return symbolIndex < 0 ? undefined : Math.floor(symbolIndex / pageSize);
}

function categoryPaginationState(symbols, chartCount, pageIndex = 0) {
  const pageSize = CHART_COUNTS.includes(Number(chartCount)) ? Number(chartCount) : 4;
  const cleanSymbols = symbols.filter(Boolean);
  const pageCount = Math.max(1, Math.ceil(cleanSymbols.length / pageSize));
  const safeIndex = Math.min(Math.max(Number(pageIndex) || 0, 0), pageCount - 1);
  const start = safeIndex * pageSize;
  return {
    pageIndex: safeIndex,
    pageCount,
    pageSize,
    total: cleanSymbols.length,
    visibleSymbols: cleanSymbols.slice(start, start + pageSize),
  };
}

function activeCategoryPaginationState() {
  const tab = activeMarketTab();
  const tabId = tabIdentity(tab);
  const pageIndex = state.categoryPageByTabId[tabId] || 0;
  const symbols = symbolsForActiveTab().map((item) => item.symbol);
  const page = categoryPaginationState(symbols, currentChartCount(), pageIndex);
  if (tabId) state.categoryPageByTabId[tabId] = page.pageIndex;
  return page;
}

function visibleSymbolsForActiveCategory() {
  const visible = new Set(activeCategoryPaginationState().visibleSymbols);
  return symbolsForActiveTab().filter((item) => visible.has(item.symbol));
}

function setCategoryPage(direction) {
  const tab = activeMarketTab();
  const tabId = tabIdentity(tab);
  if (!tabId) return;
  const current = activeCategoryPaginationState();
  const nextIndex = typeof direction === "number" && Math.abs(direction) === 1
    ? current.pageIndex + direction
    : Number(direction) || 0;
  const next = categoryPaginationState(symbolsForActiveTab().map((item) => item.symbol), currentChartCount(), nextIndex);
  if (next.pageIndex === current.pageIndex) return;
  state.categoryPageByTabId[tabId] = next.pageIndex;
  renderCategoryPagination();
  renderPanels(currentChartCount());
}

function renderCategoryPagination() {
  const container = document.getElementById("category-pagination");
  const status = document.getElementById("category-page-status");
  const prev = document.getElementById("category-page-prev");
  const next = document.getElementById("category-page-next");
  if (!container || !status || !prev || !next) return;
  const page = activeCategoryPaginationState();
  const shouldShow = page.total > page.pageSize;
  container.hidden = !shouldShow;
  status.textContent = `第 ${page.pageIndex + 1} / ${page.pageCount} 頁`;
  prev.disabled = page.pageIndex <= 0;
  next.disabled = page.pageIndex >= page.pageCount - 1;
}

function defaultSymbolForPanel(index) {
  if (isSingleChartViewActive() && index === 0 && state.singleChartView?.tabId === state.activeMarketTabId) return state.singleChartView.symbol;
  const defaults = activeCategoryPaginationState().visibleSymbols;
  const options = visibleSymbolsForActiveCategory();
  return defaults[index] || options[index]?.symbol || "SAMPLE";
}

function defaultIntervalForPanel(index) {
  return isSingleChartViewActive() && index === 0 ? state.singleChartView.interval : DEFAULT_INTERVAL;
}

async function saveManagedInstrument(item) {
  const response = await fetch("/api/instruments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(item),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
  applyInstrumentSetupPayload(payload);
  return payload;
}

async function saveWatchlistRecommender(item, input, statusNode) {
  if (!item?.itemId || !input || !statusNode) return;
  const recommender = input.value.trim();
  if (recommender.length > 80 || /[\u0000-\u001f\u007f]/.test(recommender)) {
    statusNode.textContent = recommender.length > 80 ? "最多 80 字" : "格式錯誤";
    statusNode.className = "watchlist-recommender-status is-error";
    input.setAttribute("aria-invalid", "true");
    return;
  }
  input.disabled = true;
  statusNode.textContent = "儲存中";
  statusNode.className = "watchlist-recommender-status";
  input.removeAttribute("aria-invalid");
  try {
    const response = await fetch(`/api/watchlist-items/${encodeURIComponent(item.itemId)}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ recommender }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
    applyInstrumentSetupPayload(payload, { skipWatchlistRender: true });
    input.value = recommender;
    input.dataset.savedValue = recommender;
    statusNode.textContent = "已儲存";
    statusNode.className = "watchlist-recommender-status is-success";
  } catch (error) {
    statusNode.textContent = error?.message || "儲存失敗";
    statusNode.className = "watchlist-recommender-status is-error";
    input.setAttribute("aria-invalid", "true");
  } finally {
    input.disabled = false;
  }
}

async function deleteManagedInstrument(symbol, tab) {
  const params = new URLSearchParams({
    tabId: tab?.id || "",
    tabLabel: tab?.label || "",
    scope: reorderScopeForTab(tab),
  });
  const response = await fetch(`/api/instruments/${encodeURIComponent(symbol)}?${params}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || AUTH_REQUIRED_MESSAGE);
  applyInstrumentSetupPayload(payload);
  return payload;
}

function applyInstrumentSetupPayload(payload, options = {}) {
  state.instruments = payload.instruments || [];
  const tabController = state.watchlistTabReorderController;
  const preserveTabDraft = !options.forceTabOrder && Boolean(tabController && (tabController.dirty || tabController.inFlight));
  if (!preserveTabDraft) {
    state.marketTabs = payload.marketTabs || state.marketTabs;
    state.managedTabs = payload.managedTabs || payload.marketTabs || state.managedTabs || [];
    if (tabController && options.forceTabOrder) {
      tabController.confirmed = state.marketTabs.map((tab) => ({ ...tab }));
      tabController.draft = [];
      tabController.dirty = false;
    }
  }
  state.personalTabs = payload.personalTabs || state.personalTabs || [];
  state.setupErrors = payload.setupErrors || [];
  state.personalSync = payload.personalSync || state.personalSync;
  reconcileActiveMarketTab();
  renderMarketTabs();
  if (!options.skipWatchlistRender) renderWatchlistManager();
  updateConnectionStatus();
}

function snapshotManagedInstrumentOrder(instruments, tab = selectedManagementTab()) {
  if (!tab) return [];
  const personal = reorderScopeForTab(tab) === "personal";
  return instruments.map((item) => ({
    ...item,
    ...(personal ? { tabId: tab.id, tab: tab.label } : {}),
    __watchlistHadExact: personal ? state.instruments.some((candidate) => candidate.symbol === item.symbol && candidate.tabId === tab.id) : true,
  }));
}

function applyManagedInstrumentOrderLocally(instruments, tab = selectedManagementTab()) {
  if (!tab) return;
  const personal = reorderScopeForTab(tab) === "personal";
  const normalized = instruments.map((item) => {
    const clean = { ...item };
    delete clean.__watchlistHadExact;
    return personal ? { ...clean, tabId: tab.id, tab: tab.label } : clean;
  });
  const byKey = new Map(normalized.map((item) => [reorderItemKey(tab, item), item]));
  const seen = new Set();
  state.instruments = state.instruments.map((item) => {
    const belongs = personal ? item.tabId === tab.id : instrumentBelongsToTab(item, tab);
    const key = reorderItemKey(tab, item);
    if (!belongs || !byKey.has(key)) return item;
    seen.add(key);
    return { ...item, ...byKey.get(key) };
  });
  normalized.forEach((item) => {
    const key = reorderItemKey(tab, item);
    if (!seen.has(key)) state.instruments.push({ ...item });
  });
}

function restoreManagedInstrumentOrder(previousOrder, tab = selectedManagementTab()) {
  if (!tab) return;
  if (reorderScopeForTab(tab) === "personal") {
    const symbols = new Set(previousOrder.map((item) => item.symbol));
    state.instruments = state.instruments.filter((item) => !(item.tabId === tab.id && symbols.has(item.symbol)));
    previousOrder.filter((item) => item.__watchlistHadExact).forEach((item) => {
      const clean = { ...item };
      delete clean.__watchlistHadExact;
      state.instruments.push({ ...clean, tabId: tab.id, tab: tab.label });
    });
    return;
  }
  const byKey = new Map(previousOrder.map((item) => [reorderItemKey(tab, item), item]));
  state.instruments = state.instruments.map((item) => {
    const previous = byKey.get(reorderItemKey(tab, item));
    if (!instrumentBelongsToTab(item, tab) || !previous) return item;
    const clean = { ...previous };
    delete clean.__watchlistHadExact;
    return { ...item, ...clean };
  });
}

function refreshAllSymbolOptions(activeSelect, activeSymbol) {
  state.panels.forEach((panel) => {
    const preferredSymbol = activeSelect && panel.element.contains(activeSelect) ? activeSymbol : undefined;
    const changed = panel.refreshSymbolOptions(preferredSymbol);
    if (changed) panel.load();
  });
}

function syncChartOrderForTab(tab) {
  if (!tab || tabIdentity(activeMarketTab()) !== tabIdentity(tab)) return;
  renderCategoryPagination();
  if (syncExistingPanelsToCanonicalOrder(tab)) {
    cancelPanelPayloadPrefetch();
    scheduleAdjacentPagePrefetch();
    return;
  }
  const visibleItems = visibleSymbolsForActiveCategory();
  state.panels.forEach((panel, index) => {
    panel.setCanonicalItem?.(visibleItems[index], index);
    const changed = panel.applyOrderedSymbol(defaultSymbolForPanel(index));
    if (changed) panel.load();
  });
  refreshPanelReorderAffordances();
  cancelPanelPayloadPrefetch();
  scheduleAdjacentPagePrefetch();
}

function providerForSymbol(symbol) {
  return managedInstruments().find((item) => item.symbol === symbol)?.provider || "yfinance";
}

function instrumentDisplayNameForSymbol(symbol) {
  const instrument = managedInstruments().find((item) => item.symbol === symbol);
  return instrument?.name || symbol || "--";
}

function compactSeries(series) {
  return window.QuoteChartPayload?.normalizeValueSeries?.(series) || [];
}

function colorMacdHistogramData(data) {
  return compactSeries(data).map((row) => ({
    ...row,
    color: Number(row.value) >= 0
      ? SUB_INDICATOR_STYLES.macdHistogramPositive.color
      : SUB_INDICATOR_STYLES.macdHistogramNegative.color,
  }));
}

function fillSymbolOptions(select, selected) {
  select.innerHTML = "";
  const options = visibleSymbolsForActiveCategory();
  for (const item of options) {
    addInstrumentOption(select, item, item.symbol === selected);
  }
  if (selected && !options.some((item) => item.symbol === selected)) {
    addInstrumentOption(select, { symbol: selected, name: "自訂代號", market: "自訂", group: "自訂", provider: providerForSymbol(selected) }, true);
  }
}

function addInstrumentOption(select, item, selected = false) {
  let option = [...select.options].find((node) => node.value === item.symbol);
  if (!option) {
    const groupLabel = item.group || item.market || "其他";
    let group = [...select.querySelectorAll("optgroup")].find((node) => node.label === groupLabel);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = groupLabel;
      select.appendChild(group);
    }
    option = document.createElement("option");
    option.value = item.symbol;
    option.textContent = `${item.symbol}｜${item.name}`;
    group.appendChild(option);
  }
  option.selected = selected;
  return option;
}

function normalizeCustomSymbol(value) {
  return value.trim().toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fillIntervalOptions(select, selected, symbol = "") {
  select.innerHTML = "";
  const intervals = window.QuoteChartRealtimeCharts.availableIntervals(
    state.intervals,
    symbol,
    state.appConfig.capabilities?.taiwanIntradayTrend,
  );
  const nextSelected = intervals.includes(selected)
    ? selected
    : intervals.includes(DEFAULT_INTERVAL) ? DEFAULT_INTERVAL : intervals[0];
  for (const interval of intervals) {
    const option = document.createElement("option");
    option.value = interval;
    option.textContent = formatIntervalLabel(interval);
    option.selected = interval === nextSelected;
    select.appendChild(option);
  }
}

function formatIntervalLabel(interval) {
  return INTERVAL_LABELS[interval] || interval;
}

function formatStatusMessage(message) {
  let text = String(message || "");
  for (const interval of Object.keys(INTERVAL_LABELS).sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(` / ${interval}`, ` / ${formatIntervalLabel(interval)}`);
  }
  return text;
}

function timeToDate(value) {
  if (typeof value === "number") return new Date(value * 1000);
  if (typeof value === "string") return new Date(value);
  if (value && typeof value === "object" && "year" in value && "month" in value && "day" in value) {
    return new Date(Date.UTC(value.year, value.month - 1, value.day));
  }
  return new Date(Number(value) * 1000);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function yyMmDd(value) {
  const date = timeToDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const yy = pad2(date.getFullYear() % 100);
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yy}/${mm}/${dd}`;
}

function yyyyMmDd(value) {
  const exact = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (exact) return exact[0];
  if (value && typeof value === "object" && "year" in value && "month" in value && "day" in value) {
    return `${value.year}-${pad2(value.month)}-${pad2(value.day)}`;
  }
  const date = timeToDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatChartDate(value) {
  return yyyyMmDd(value);
}

function clampCrosshairDateX(coordinate, chartWidth, axisSafeWidth, labelWidth) {
  const width = Math.max(0, Number(chartWidth) || 0);
  const axis = Math.max(0, Number(axisSafeWidth) || 0);
  const label = Math.max(0, Number(labelWidth) || 0);
  const plotRight = Math.max(label, width - axis);
  return Math.max(label / 2, Math.min(Number(coordinate) || 0, plotRight - label / 2));
}

function formatTimeTick(time, tickMarkType) {
  const date = timeToDate(time);
  if (Number.isNaN(date.getTime())) return "";
  const month = date.getMonth() + 1;
  if (tickMarkType === LightweightCharts.TickMarkType.Year) {
    return String(date.getFullYear());
  }
  if (tickMarkType === LightweightCharts.TickMarkType.Month) {
    return `${month}月`;
  }
  if (tickMarkType === LightweightCharts.TickMarkType.Time || tickMarkType === LightweightCharts.TickMarkType.TimeWithSeconds) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  return yyMmDd(time);
}

function formatCrosshairTime(time) {
  const date = timeToDate(time);
  if (Number.isNaN(date.getTime())) return "";
  return yyMmDd(time);
}

function formatQuoteTimeParts(time, timeZone) {
  const date = timeToDate(time);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...(timeZone ? { timeZone } : {}),
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  } catch {
    return null;
  }
}

function formatQuoteDataTime(time, timeZone) {
  const parts = formatQuoteTimeParts(time, timeZone);
  return parts ? `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}` : "";
}

function formatQuoteDataShortTime(time, timeZone) {
  const parts = formatQuoteTimeParts(time, timeZone);
  return parts ? `${parts.hour}:${parts.minute}` : "";
}

function formatQuoteDataState(quote, fallbackTime) {
  if (!quote && !fallbackTime) {
    return { full: "", compact: "", status: "", title: "資料時間：--" };
  }
  const value = quote && typeof quote === "object" ? quote : {};
  const verification = String(value.verification?.status || value.verification || "unverified").toLowerCase();
  const verificationTitle = formatQuoteVerificationTitle(value.verification, value.dataQuality);
  const freshness = String(value.freshness || "fresh").toLowerCase();
  const sessionDate = formatQuoteSessionDate(value.sessionDate);
  const marketClosed = Boolean(globalThis.MultiChartQuoteDisplayState?.isTaiwanMarketClosedDay(value));
  const intradayDisplay = !marketClosed && (value.marketPhase === "open" || verification === "not_applicable");
  const sourceTime = intradayDisplay ? value.sourceQuoteTime : value.sourceQuoteTime || fallbackTime;
  const sourceLabel = formatQuoteDataTime(sourceTime, value.sourceTimeZone);
  const sourceCompact = formatQuoteDataShortTime(sourceTime, value.sourceTimeZone);
  const realtimeState = String(value.realtimeState || "").toLowerCase();
  if (realtimeState === "live") return { full: `${sourceLabel || "--"}・即時`, compact: `${sourceCompact || "--"} 即時`, status: "realtime", title: "Shioaji 即時行情來源時間" };
  if (realtimeState === "degraded") return { full: `${sourceLabel || "--"}・連線不穩`, compact: `${sourceCompact || "--"} 不穩`, status: "degraded", title: "即時行情連線不穩，顯示最後已接受行情" };
  if (realtimeState === "fallback") return { full: `${sourceLabel || "--"}・延遲備援`, compact: `${sourceCompact || "--"} 備援`, status: "fallback", title: "即時行情不可用，已原子切換 Yahoo 延遲行情" };
  if (realtimeState === "closing") return { full: `${sourceLabel || "--"}・收盤整理`, compact: `${sourceCompact || "--"} 整理`, status: "closing", title: "收盤整理中，等待 canonical 日 K 核對" };
  if (realtimeState === "closed") return { full: `${sourceLabel || "--"}・已收盤`, compact: `${sourceCompact || "--"} 收盤`, status: "closed", title: "已由 canonical 收盤資料接手" };
  let base = sourceLabel || "時間未驗證";
  let compact = sourceCompact || "未驗證";
  if (intradayDisplay && !sourceLabel) {
    base = "盤中・時間待確認";
    compact = "時間待確認";
  }
  if (value.kind === "session-close" && sessionDate) {
    base = `${sessionDate} 收盤`;
    compact = `${sessionDate} 收盤`;
  }
  if (freshness === "stale") {
    return { full: `${base}・資料過期`, compact: `${compact} 過期`, status: "stale", title: marketClosed ? "目前休市；主來源報價資料已過期，顯示其最後資料時間" : "主來源報價資料已過期，顯示其最後資料時間" };
  }
  if (marketClosed) {
    return {
      full: `${base}・休市`,
      compact: `${sessionDate || compact} 休市`,
      status: verification === "verified" ? "verified" : "closed",
      title: verification === "verified" ? `${verificationTitle}；目前休市` : `目前休市；${verificationTitle}`,
    };
  }
  if (intradayDisplay) {
    return { full: base, compact, status: "not_applicable", title: "盤中顯示主來源資料時間，收盤後才進行第二來源核對" };
  }
  if (verification === "pending") {
    return { full: `${base}・待核對`, compact: `${sessionDate || compact} 待核對`, status: "pending", title: verificationTitle };
  }
  if (verification === "mismatch") {
    return { full: `${base}・待核對`, compact: `${sessionDate || compact} 待核對`, status: "mismatch", title: verificationTitle };
  }
  if (verification !== "verified") {
    return { full: `${base}・未驗證`, compact: `${sessionDate || compact} 未驗證`, status: "unverified", title: verificationTitle };
  }
  return { full: `${base}・已核對`, compact: `${sessionDate || compact} 已核對`, status: "verified", title: verificationTitle };
}

function formatQuoteVerificationTitle(verification, dataQuality) {
  const value = verification && typeof verification === "object" ? verification : {};
  const providerNames = { twse: "TWSE 官方資料", tpex: "TPEx 官方資料", "twse-mis": "TWSE MIS 上櫃行情", "tpex-mirror": "TPEx 官方鏡像", massive: "Massive" };
  const provider = providerNames[String(value.provider || "").toLowerCase()] || "獨立第二來源";
  const referenceDate = formatQuoteSessionDate(value.referenceSessionDate);
  const reason = String(value.reason || "").toLowerCase();
  const ignoredDates = Array.isArray(dataQuality?.ignoredSessionDates)
    ? dataQuality.ignoredSessionDates.map(formatQuoteSessionDate).filter(Boolean)
    : [];
  const normalizedPrefix = ignoredDates.length ? `已忽略 ${ignoredDates[ignoredDates.length - 1]} 無成交占位資料；` : "";
  if (String(value.status || verification || "").toLowerCase() === "verified") {
    return `${normalizedPrefix}報價已由${provider}核對${referenceDate ? `（${referenceDate}）` : ""}`;
  }
  const reasons = {
    reference_not_published: "第二來源尚未發布目標交易日資料",
    provider_not_configured: "第二來源尚未完成設定",
    invalid_credentials: "第二來源金鑰無效或尚未生效",
    not_entitled: "目前方案未包含這項第二來源資料",
    symbol_not_covered: "第二來源未涵蓋這項商品",
    rate_limited: "第二來源已達暫時查詢上限，稍後再核對",
    provider_unavailable: "第二來源暫時不可用",
    close_mismatch: `主來源與${provider}的同交易日收盤不一致`,
    session_mismatch: `主來源與${provider}的交易日不一致`,
    invalid_reference_data: "第二來源資料不完整",
    unsupported_symbol: "這項商品尚未設定獨立第二來源",
    unsupported_interval: "目前只核對已完成的日 K",
    unsupported_quote_kind: "盤中報價尚未進行收盤核對",
    market_open: "盤中顯示主來源資料時間，收盤後才進行第二來源核對",
    continuous_contract_ambiguous: "期貨連續合約處於轉倉不確定範圍，暫不判定價格差異",
    close_definition_mismatch: "外匯來源的日切時間或收盤定義不同，暫不判定價格錯誤",
  };
  return `${normalizedPrefix}${reasons[reason] || "報價尚未以獨立第二來源交叉驗證"}`;
}

function formatQuoteSessionDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}` : "";
}

function nodesOverlap(first, second) {
  if (!first || !second) return false;
  const a = first.getBoundingClientRect();
  const b = second.getBoundingClientRect();
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function setReadoutValue(root, key, value, formatter = formatPrice) {
  const node = root.querySelector(`[data-main-indicator="${key}"], [data-sub-indicator="${key}"], [data-ohlc="${key}"]`);
  if (!node) return;
  node.textContent = typeof value === "number" && Number.isFinite(value) ? formatter(value) : "--";
}

function setReadoutDate(root, value) {
  const node = root.querySelector("[data-main-date], [data-sub-date]");
  if (node) node.textContent = yyyyMmDd(value) || "--";
}

function setReadoutColor(root, key, color) {
  const node = root.querySelector(`[data-main-indicator="${key}"], [data-sub-indicator="${key}"], [data-ohlc="${key}"]`);
  if (!node) return;
  node.style.color = color;
}

function setReadoutItemColor(root, key, color) {
  const item = root.querySelector(`[data-main-readout="${key}"], [data-sub-readout="${key}"]`);
  if (!item) {
    setReadoutColor(root, key, color);
    return;
  }
  item.style.color = color;
  const valueNode = item.querySelector("b");
  if (valueNode) valueNode.style.color = color;
}

function valueAt(series, time) {
  const target = normalizeChartTime(time);
  const point = series.find((row) => normalizeChartTime(row.time) === target);
  const value = point?.value;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value);
}

function latestValueAtOrBefore(series, time) {
  const target = normalizeChartTime(time);
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index];
    const pointTime = normalizeChartTime(point?.time);
    const value = Number(point?.value);
    if ((!Number.isFinite(Number(target)) || Number(pointTime) <= Number(target)) && Number.isFinite(value)) return value;
  }
  return undefined;
}

function seriesTrendAt(series, time) {
  const target = normalizeChartTime(time);
  let current;
  let previous;
  for (const point of series || []) {
    const pointTime = normalizeChartTime(point?.time);
    if (point?.value === null || point?.value === undefined) continue;
    const value = Number(point?.value);
    if (!Number.isFinite(value) || Number(pointTime) > Number(target)) continue;
    if (Number(pointTime) === Number(target)) current = value;
    else previous = value;
  }
  return !Number.isFinite(current) || !Number.isFinite(previous) ? "trend-flat" : trendClass(current - previous);
}

function normalizeChartTime(time) {
  if (typeof time === "number") return time;
  if (typeof time === "string") return Number(time);
  if (time && typeof time === "object" && "timestamp" in time) return Number(time.timestamp);
  return time;
}

function trendClass(change) {
  if (change > 0) return "trend-up";
  if (change < 0) return "trend-down";
  return "trend-flat";
}

function classifyLatestPriceState(change, changePercent) {
  const trend = Number.isFinite(change) ? trendClass(change) : "trend-flat";
  let direction = LATEST_PRICE_DIRECTIONS.flat;
  if (change > 0) direction = LATEST_PRICE_DIRECTIONS.up;
  if (change < 0) direction = LATEST_PRICE_DIRECTIONS.down;
  if (Number.isFinite(changePercent) && changePercent >= PRICE_LIMIT_PERCENT_THRESHOLD) {
    return { trend, direction: LATEST_PRICE_DIRECTIONS.up, limit: "limit-up" };
  }
  if (Number.isFinite(changePercent) && changePercent <= -PRICE_LIMIT_PERCENT_THRESHOLD) {
    return { trend, direction: LATEST_PRICE_DIRECTIONS.down, limit: "limit-down" };
  }
  if (direction === LATEST_PRICE_DIRECTIONS.flat) {
    return { trend, direction: LATEST_PRICE_DIRECTIONS.flat, limit: undefined };
  }
  return { trend, direction, limit: undefined };
}

function shouldAnimateLatestPriceUpdate(previousPrice, nextPrice, payload) {
  const previous = Number(previousPrice);
  const next = Number(nextPrice);
  if (!Number.isFinite(previous) || !Number.isFinite(next) || previous === next) return false;
  if (payload?.quote?.kind === "session-close") return false;
  return marketSessionState(payload) === "open";
}

function latestPriceLabelForPayload(payload) {
  if (payload?.quote?.kind === "intraday") return "現價";
  if (payload?.quote?.kind === "session-close") return "收盤價";
  return marketSessionState(payload) === "open" ? "現價" : "收盤價";
}

function marketSessionState(payload) {
  const normalizedPhase = String(payload?.quote?.marketPhase || payload?.marketPhase || "").toLowerCase();
  if (normalizedPhase === "open") return "open";
  if (["closing", "closed"].includes(normalizedPhase)) return "closed";
  const explicitState = String(payload?.quote?.marketSession || payload?.marketSession || payload?.market_session || payload?.marketStatus || payload?.market_status || "").toLowerCase();
  if (["open", "regular", "trading"].includes(explicitState)) return "open";
  if (["closed", "close", "post", "afterhours", "after-hours"].includes(explicitState)) return "closed";

  const symbol = String(payload?.symbol || "");
  const instrument = managedInstruments().find((item) => item.symbol === symbol);
  const provider = String(payload?.provider || instrument?.provider || providerForSymbol(symbol));
  const market = String(payload?.market || instrument?.market || "");
  if (provider === "hyperliquid") return "open";
  if (market.includes("台灣股市") || symbol.endsWith(".TW")) {
    return isTaiwanStockMarketOpen() ? "open" : "closed";
  }
  return "closed";
}

function isTaiwanStockMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  if (["Sat", "Sun"].includes(parts.weekday)) return false;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

function formatInteger(value) {
  if (!Number.isFinite(value)) return "--";
  return Math.round(value).toLocaleString("zh-TW");
}

function formatOscillatorValue(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAdaptiveIndicatorValue(value) {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1 ? 2 : abs < 10 ? 2 : 0;
  return value.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatSignedQuotePrice(value, symbol, referencePrice) {
  if (!Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatQuotePrice(value, symbol, "change", referencePrice)}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "--";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatLatestPriceChange(value, symbol, referencePrice) {
  if (!Number.isFinite(value)) return "--";
  return formatQuotePrice(Math.abs(value), symbol, "change", referencePrice);
}

function formatLatestPricePercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `(${Math.abs(value).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)`;
}

function formatPrice(value) {
  return formatQuotePrice(value);
}

function formatQuotePrice(value, symbol, context = "trade-price", referencePrice) {
  if (!Number.isFinite(value)) return "--";
  const precision = pricePrecisionForInstrument(symbol, value, context, referencePrice);
  return value.toLocaleString("zh-TW", {
    minimumFractionDigits: precision.minimumFractionDigits,
    maximumFractionDigits: precision.maximumFractionDigits,
    useGrouping: precision.useGrouping !== false,
  });
}

function pricePrecisionForInstrument(symbol, value, context = "trade-price", referencePrice) {
  if (context === "percent") return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const normalizedContext = context === "price" ? "trade-price" : context;
  const taiwanPrecision = window.QuotePriceFormatting?.taiwanPricePrecision(
    symbol,
    value,
    normalizedContext,
    referencePrice,
    managedInstruments().find((item) => item.symbol === symbol),
  );
  if (taiwanPrecision) return taiwanPrecision;
  if (isJpyCurrencySymbol(symbol)) return { minimumFractionDigits: 2, maximumFractionDigits: 3 };
  if (isCurrencySymbol(symbol)) return { minimumFractionDigits: 4, maximumFractionDigits: 4 };
  if (isYieldSymbol(symbol)) return { minimumFractionDigits: 2, maximumFractionDigits: 3 };
  if (isForeignIndexSymbol(symbol) || isStockLikeSymbol(symbol)) return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (Math.abs(Number(symbol)) >= 1000) return { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  return { minimumFractionDigits: 0, maximumFractionDigits: 4 };
}

function isForeignIndexSymbol(symbol = "") {
  const normalized = String(symbol).toUpperCase();
  return normalized.startsWith("^") || ["DJI", "IXIC", "GSPC", "SOX", "RUT", "NDX"].includes(normalized);
}

function isCurrencySymbol(symbol = "") {
  const normalized = String(symbol).toUpperCase();
  return normalized.endsWith("=X") || /^[A-Z]{6}$/.test(normalized);
}

function isJpyCurrencySymbol(symbol = "") {
  return isCurrencySymbol(symbol) && String(symbol).toUpperCase().includes("JPY");
}

function isYieldSymbol(symbol = "") {
  const normalized = String(symbol).toUpperCase();
  return ["^TNX", "^TYX", "^FVX", "^IRX"].includes(normalized);
}

function isStockLikeSymbol(symbol = "") {
  const normalized = String(symbol).toUpperCase();
  return normalized.endsWith(".TW") || normalized.endsWith(".TWO") || /^[A-Z]{1,5}([.-][A-Z])?$/.test(normalized);
}
