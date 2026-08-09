(function initTaiwanStockChipPanes(global) {
  "use strict";

  const {
    formatCompactLotsAxis = (value) => `${value}張`,
    formatCompactPercentAxis = (value) => `${value}%`,
  } = global.QuoteChartAxisFormatting || {};

  const CHIP_PANE_REGISTRY = [
    { id: "foreign-flow-holding", label: "外資買賣超＋持股", title: "外資", datasets: ["institutional-flow", "foreign-holding"], kind: "foreign-combined" },
    { id: "investment-trust-flow", label: "投信買賣超", title: "投信", dataset: "institutional-flow", kind: "flow", field: "investmentTrustNetShares" },
    { id: "dealer-flow", label: "自營商買賣超", title: "自營商", dataset: "institutional-flow", kind: "flow", field: "dealerTotalNetShares" },
    { id: "institutional-total-flow", label: "三大法人合計", title: "三大法人", dataset: "institutional-flow", kind: "flow", field: "institutionalTotalNetShares" },
    { id: "margin", label: "融資", dataset: "margin-short", kind: "margin" },
    { id: "short", label: "融券", dataset: "margin-short", kind: "short" },
    { id: "securities-lending", label: "借券", dataset: "securities-lending", kind: "lending" },
    { id: "short-margin-ratio", label: "券資比", dataset: "margin-short", kind: "short-margin-ratio" },
    { id: "estimated-margin-maintenance", label: "估算融資維持率", dataset: "margin-short", kind: "estimated-margin-maintenance" },
    { id: "big-holder", label: "大戶持股", dataset: "shareholder-distribution", kind: "holder" },
    { id: "retail-holder", label: "散戶持股", dataset: "shareholder-distribution", kind: "holder" },
    { id: "tdcc-holder-count", label: "集保戶數", dataset: "shareholder-distribution", kind: "holder-total" },
  ];
  const CHIP_PANE_GROUPS = [
    { id: "institutional", label: "法人", paneIds: ["foreign-flow-holding", "investment-trust-flow", "dealer-flow", "institutional-total-flow"] },
    { id: "margin-financing", label: "融資券", paneIds: ["margin", "short", "securities-lending", "short-margin-ratio", "estimated-margin-maintenance"] },
    { id: "holder", label: "持股比", paneIds: ["big-holder", "retail-holder", "tdcc-holder-count"] },
  ];
  const PANE_GROUP_BY_ID = new Map(CHIP_PANE_GROUPS.flatMap((group) => group.paneIds.map((paneId) => [paneId, group.id])));
  const DEFAULT_MODE_B_PANES = CHIP_PANE_REGISTRY.map((pane) => pane.id).filter((paneId) => paneId !== "tdcc-holder-count");
  const DEFAULT_MODE_A_PANE = "institutional-total-flow";
  const SELECTION_DEFAULTS_VERSION = 11;
  const ESTIMATED_MAINTENANCE_PANE_DEFAULTS_VERSION = 10;
  const HOLDER_LINE_DEFAULTS_VERSION = 11;
  const LEGACY_HOLDER_DEFAULT_SERIES = ["ratio", "change", "holders"];
  const PANE_DRAG_EDGE_PX = 72;
  const PANE_DRAG_MAX_SCROLL_PX = 18;
  const CHIP_READOUT_RESERVATION_MANAGERS = new Set();
  let chipReadoutCohortFrame = 0;

  function readoutSegmentText(item = {}) {
    const arrow = item.showArrow ? ({ positive: "↑", negative: "↓", flat: "→" })[item.direction] || "" : "";
    return `${item.label ? `${item.label} ` : ""}${item.value ?? ""}${arrow ? ` ${arrow}` : ""}`;
  }

  function readoutEnvelopeCandidates(readouts = []) {
    const candidates = new Map();
    for (const readout of readouts.filter(Boolean)) {
      const segments = Array.isArray(readout.segments) ? readout.segments : [];
      const structure = segments.map((item) => [item.label || "", item.seriesId || "", Boolean(item.secondary), item.tone || ""]).join("|");
      const key = `${segments.length}:${structure}`;
      const current = candidates.get(key);
      if (!current) {
        candidates.set(key, {
          ...readout,
          segments: segments.map((item) => ({ ...item })),
        });
        continue;
      }
      if (String(readout.date || "").length > String(current.date || "").length) current.date = readout.date;
      segments.forEach((item, index) => {
        if (readoutSegmentText(item).length > readoutSegmentText(current.segments[index]).length) {
          current.segments[index] = { ...item };
        }
      });
    }
    return [...candidates.values()];
  }

  function chipReadoutLayoutSignature({
    mode = "A",
    width = 0,
    fontFamily = "",
    fontSize = "",
    lineHeight = "",
    zoom = 1,
    selectedSeries = [],
    dataState = "",
    threshold = "",
  } = {}) {
    return JSON.stringify([
      mode === "B" ? "B" : "A",
      Math.round((Number(width) || 0) * 2) / 2,
      String(fontFamily || ""),
      String(fontSize || ""),
      String(lineHeight || ""),
      Math.round((Number(zoom) || 1) * 100) / 100,
      [...selectedSeries].map(String).sort(),
      String(dataState || ""),
      String(threshold || ""),
    ]);
  }

  function scheduleChipReadoutCohorts() {
    if (chipReadoutCohortFrame) return;
    const requestFrame = global.requestAnimationFrame || ((callback) => global.setTimeout(callback, 0));
    chipReadoutCohortFrame = requestFrame(() => {
      chipReadoutCohortFrame = 0;
      const groups = new Map();
      for (const manager of CHIP_READOUT_RESERVATION_MANAGERS) manager.clearCohortReservations();
      for (const manager of CHIP_READOUT_RESERVATION_MANAGERS) {
        if (manager.reservationMode() !== "B") continue;
        const panelRect = manager.panelRect();
        if (!panelRect || panelRect.width <= 0) continue;
        for (const entry of manager.readoutReservations()) {
          if (!(entry.localHeight > 0)) continue;
          const key = [Math.round(panelRect.top), entry.paneId, entry.orderPrefix, entry.controlKey].join("|");
          const group = groups.get(key) || [];
          group.push(entry);
          groups.set(key, group);
        }
      }
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const maximum = Math.max(...group.map((entry) => entry.localHeight));
        for (const entry of group) entry.applyCohortHeight(maximum);
      }
    });
  }

  function paneDragScrollVelocity(clientY, viewportHeight) {
    const height = Math.max(0, Number(viewportHeight) || 0);
    const y = Number(clientY);
    if (!Number.isFinite(y) || height <= 0) return 0;
    if (y < PANE_DRAG_EDGE_PX) {
      const strength = Math.min(1, Math.max(0, (PANE_DRAG_EDGE_PX - y) / PANE_DRAG_EDGE_PX));
      return -Math.max(1, Math.round(PANE_DRAG_MAX_SCROLL_PX * strength));
    }
    if (y > height - PANE_DRAG_EDGE_PX) {
      const strength = Math.min(1, Math.max(0, (y - (height - PANE_DRAG_EDGE_PX)) / PANE_DRAG_EDGE_PX));
      return Math.max(1, Math.round(PANE_DRAG_MAX_SCROLL_PX * strength));
    }
    return 0;
  }

  function isPaneDragIgnoredTarget(target) {
    const interactive = target?.closest?.('button, input, select, a, summary, details, [role="menu"], [contenteditable="true"]');
    return Boolean(interactive && !target?.closest?.(".chip-pane-group-drag-handle"));
  }

  function isEligibleContext(symbol, interval) {
    const normalized = String(symbol || "").trim().toUpperCase();
    return interval === "1d" && /^[0-9A-Z]{4,8}\.TW(O)?$/.test(normalized);
  }

  const CHIP_WARNING_DATASET_STYLES = Object.freeze([
    { label: "三大法人買賣超", dataset: "institutional-flow", color: "#f472b6" },
    { label: "外資及陸資持股", dataset: "foreign-holding", color: "#38bdf8" },
    { label: "融資融券", dataset: "margin-short", color: "#fb7185" },
    { label: "借券成交", dataset: "securities-lending", color: "#f59e0b" },
    { label: "股權分散", dataset: "shareholder-distribution", color: "#22d3ee" },
  ]);

  function warningColorForText(text) {
    const value = String(text || "");
    return CHIP_WARNING_DATASET_STYLES.find((style) => value.startsWith(style.label))?.color || "#cbd5e1";
  }

  function warningMessages(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    const text = String(value || "").trim();
    return text ? [text] : [];
  }

  function warningNoticeSignature(context, text) {
    return [String(context?.symbol || "").trim().toUpperCase(), String(context?.interval || ""), warningMessages(text).join("\u0001")].join("|");
  }

  function shouldShowWarningNotice(signature, dismissedSignature) {
    return Boolean(signature) && signature !== dismissedSignature;
  }

  const PANE_SERIES_OPTIONS = {
    "foreign-flow-holding": {
      defaults: ["net", "holdingRatio"],
      items: [
        { id: "net", label: "買賣超", color: "#f472b6" },
        { id: "buy", label: "買進", color: "#f87171" },
        { id: "sell", label: "賣出", color: "#4ade80" },
        { id: "holdingRatio", label: "持股比例", color: "#38bdf8" },
        { id: "holdingShares", label: "持股張數", color: "#facc15" },
      ],
    },
    "investment-trust-flow": {
      defaults: ["net"],
      items: [
        { id: "net", label: "買賣超", color: "#f472b6" },
        { id: "buy", label: "買進", color: "#f87171" },
        { id: "sell", label: "賣出", color: "#4ade80" },
      ],
    },
    "dealer-flow": {
      defaults: ["self"],
      items: [
        { id: "self", label: "自行", color: "#f87171" },
        { id: "hedging", label: "避險", color: "#38bdf8" },
        { id: "net", label: "合計", color: "#f472b6" },
      ],
    },
    margin: {
      defaults: ["balance", "change"],
      items: [
        { id: "balance", label: "餘額", color: "#f472b6" },
        { id: "change", label: "日變化", color: "#e879f9" },
        { id: "buy", label: "買進", color: "#f87171" },
        { id: "sell", label: "賣出", color: "#4ade80" },
        { id: "repayment", label: "償還", color: "#f59e0b" },
        { id: "utilization", label: "使用率", color: "#38bdf8" },
      ],
    },
    short: {
      defaults: ["balance", "change"],
      items: [
        { id: "balance", label: "餘額", color: "#a78bfa" },
        { id: "change", label: "日變化", color: "#e879f9" },
        { id: "buy", label: "買進", color: "#f87171" },
        { id: "sell", label: "賣出", color: "#4ade80" },
        { id: "repayment", label: "償還", color: "#f59e0b" },
        { id: "utilization", label: "使用率", color: "#38bdf8" },
      ],
    },
    "short-margin-ratio": {
      defaults: ["ratio"],
      items: [
        { id: "ratio", label: "券資比", color: "#facc15" },
        { id: "change", label: "日變化", color: "#e879f9" },
      ],
    },
    "estimated-margin-maintenance": {
      defaults: ["maintenance"],
      items: [
        { id: "maintenance", label: "估算維持率", color: "#fb7185" },
      ],
    },
    "big-holder": {
      defaults: ["ratio", "change"],
      items: [
        { id: "ratio", label: "持股比例", color: "#38bdf8" },
        { id: "change", label: "週變化", color: "#e879f9" },
        { id: "holders", label: "股東人數", color: "#a78bfa" },
      ],
    },
    "retail-holder": {
      defaults: ["ratio", "change"],
      items: [
        { id: "ratio", label: "持股比例", color: "#f59e0b" },
        { id: "change", label: "週變化", color: "#e879f9" },
        { id: "holders", label: "股東人數", color: "#a78bfa" },
      ],
    },
    "tdcc-holder-count": {
      defaults: ["holders"],
      items: [
        { id: "holders", label: "集保戶數", color: "#22d3ee" },
      ],
    },
  };
  const PANE_DETAIL_ITEMS = {
    "foreign-flow-holding": [
      { id: "net", label: "買賣超", color: "#f472b6", unit: "shares", get: (row) => row?.institutionalFlow?.foreignNetShares },
      { id: "buy", label: "買進", color: "#f87171", unit: "shares", get: (row) => row?.institutionalFlow?.foreignBuyShares },
      { id: "sell", label: "賣出", color: "#4ade80", unit: "shares", get: (row) => row?.institutionalFlow?.foreignSellShares },
      { id: "holdingRatio", label: "持股比例", color: "#38bdf8", unit: "percent", get: (row) => row?.foreignHolding?.heldRatioPercent },
      { id: "holdingShares", label: "持股張數", color: "#facc15", unit: "shares", get: (row) => row?.foreignHolding?.heldShares },
    ],
    "investment-trust-flow": [
      { id: "net", label: "買賣超", color: "#f472b6", unit: "shares", get: (row) => row?.institutionalFlow?.investmentTrustNetShares },
      { id: "buy", label: "買進", color: "#f87171", unit: "shares", get: (row) => row?.institutionalFlow?.investmentTrustBuyShares },
      { id: "sell", label: "賣出", color: "#4ade80", unit: "shares", get: (row) => row?.institutionalFlow?.investmentTrustSellShares },
    ],
    "dealer-flow": [
      { id: "self", label: "自行", color: "#f87171", unit: "shares", get: (row) => row?.institutionalFlow?.dealerSelfNetShares },
      { id: "hedging", label: "避險", color: "#38bdf8", unit: "shares", get: (row) => row?.institutionalFlow?.dealerHedgingNetShares },
      { id: "net", label: "合計", color: "#f472b6", unit: "shares", get: (row) => row?.institutionalFlow?.dealerTotalNetShares },
    ],
    "institutional-total-flow": [
      { id: "net", label: "三大法人", color: "#f472b6", unit: "shares", get: (row) => row?.institutionalFlow?.institutionalTotalNetShares },
      { id: "foreign", label: "外資", color: "#38bdf8", unit: "shares", get: (row) => row?.institutionalFlow?.foreignNetShares },
      { id: "trust", label: "投信", color: "#facc15", unit: "shares", get: (row) => row?.institutionalFlow?.investmentTrustNetShares },
      { id: "dealer", label: "自營商", color: "#a78bfa", unit: "shares", get: (row) => row?.institutionalFlow?.dealerTotalNetShares },
    ],
    margin: [
      { id: "balance", label: "餘額", color: "#f472b6", unit: "lots", get: (row) => row?.marginShort?.marginTodayBalanceLots },
      { id: "change", label: "日變化", color: "#e879f9", unit: "lots", get: (row) => row?.marginShort?.marginBalanceChangeLots },
      { id: "buy", label: "買進", color: "#f87171", unit: "lots", get: (row) => row?.marginShort?.marginBuyLots },
      { id: "sell", label: "賣出", color: "#4ade80", unit: "lots", get: (row) => row?.marginShort?.marginSellLots },
      { id: "repayment", label: "償還", color: "#f59e0b", unit: "lots", get: (row) => row?.marginShort?.marginCashRepaymentLots },
      { id: "utilization", label: "使用率", color: "#38bdf8", unit: "percent", get: (row) => row?.marginShort?.marginUtilizationPercent },
      { id: "offset", label: "資券互抵", color: "#94a3b8", unit: "lots", get: (row) => row?.marginShort?.offsetLots },
    ],
    short: [
      { id: "balance", label: "餘額", color: "#a78bfa", unit: "lots", get: (row) => row?.marginShort?.shortTodayBalanceLots },
      { id: "change", label: "日變化", color: "#e879f9", unit: "lots", get: (row) => row?.marginShort?.shortBalanceChangeLots },
      { id: "buy", label: "買進", color: "#f87171", unit: "lots", get: (row) => row?.marginShort?.shortBuyLots },
      { id: "sell", label: "賣出", color: "#4ade80", unit: "lots", get: (row) => row?.marginShort?.shortSellLots },
      { id: "repayment", label: "償還", color: "#f59e0b", unit: "lots", get: (row) => row?.marginShort?.shortCashRepaymentLots },
      { id: "utilization", label: "使用率", color: "#38bdf8", unit: "percent", get: (row) => row?.marginShort?.shortUtilizationPercent },
      { id: "offset", label: "資券互抵", color: "#94a3b8", unit: "lots", get: (row) => row?.marginShort?.offsetLots },
    ],
    "securities-lending": [
      { id: "transaction", label: "借券成交", color: "#f59e0b", unit: "shares", get: (row) => row?.securitiesLending?.transactionShares },
      { id: "balance", label: "借券餘額", color: "#38bdf8", unit: "shares", get: (row) => row?.securitiesLending?.balanceShares },
      { id: "shortSaleBalance", label: "借券賣出餘額", color: "#a78bfa", unit: "shares", get: (row) => row?.securitiesLending?.shortSaleBalanceShares },
    ],
    "short-margin-ratio": [
      { id: "ratio", label: "券資比", color: "#facc15", unit: "percent", get: (row) => shortMarginRatioPercent(row?.marginShort) },
      { id: "change", label: "日變化", color: "#e879f9", unit: "percent", get: (row, context) => context?.ratioChanges?.get(row?.sessionDate)?.change },
      { id: "shortBalance", label: "融券餘額", color: "#a78bfa", unit: "lots", get: (row) => row?.marginShort?.shortTodayBalanceLots },
      { id: "marginBalance", label: "融資餘額", color: "#f472b6", unit: "lots", get: (row) => row?.marginShort?.marginTodayBalanceLots },
    ],
    "estimated-margin-maintenance": [
      { id: "maintenance", label: "估算融資維持率", color: "#fb7185", unit: "percent", get: (row) => row?.marginShort?.estimatedMaintenancePercent },
      { id: "balanceChange", label: "融資增減", color: "#e879f9", unit: "lots", get: (row) => row?.marginShort?.marginBalanceChangeLots },
      { id: "estimatedCost", label: "估算融資成本", color: "#facc15", unit: "price", get: (row) => row?.marginShort?.estimatedCostPrice },
      { id: "loanRatio", label: "估算融資成數參數", color: "#38bdf8", unit: "percent", get: (row) => row?.marginShort?.marginLoanRatioPercent },
    ],
    "big-holder": [
      { id: "ratio", label: "持股比例", color: "#38bdf8", unit: "percent" },
      { id: "lots", label: "持股張數", color: "#facc15", unit: "lots" },
      { id: "holders", label: "持股人數", color: "#a78bfa", unit: "people" },
    ],
    "retail-holder": [
      { id: "ratio", label: "持股比例", color: "#f59e0b", unit: "percent" },
      { id: "lots", label: "持股張數", color: "#facc15", unit: "lots" },
      { id: "holders", label: "持股人數", color: "#a78bfa", unit: "people" },
    ],
    "tdcc-holder-count": [
      { id: "holders", label: "集保戶數", color: "#22d3ee", unit: "people" },
    ],
  };

  function seriesColorForReadout(definition, seriesId) {
    if (!seriesId) return "";
    return PANE_SERIES_OPTIONS[definition?.id]?.items.find((item) => item.id === seriesId)?.color
      || PANE_DETAIL_ITEMS[definition?.id]?.find((item) => item.id === seriesId)?.color
      || "";
  }
  const HOLDER_CHANGE_PRICE_SCALE_ID = "holder-change";
  const HOLDER_COUNT_PRICE_SCALE_ID = "holder-count";
  const SHORT_MARGIN_RATIO_CHANGE_PRICE_SCALE_ID = "short-margin-ratio-change";
  const CROSSHAIR_MARKER_RADIUS = 2;
  const CROSSHAIR_MARKER_BORDER_WIDTH = 1;
  const SHARED_CROSSHAIR_OPTIONS = {
    vertLine: { visible: false, labelVisible: false },
    horzLine: { visible: false, labelVisible: false },
  };
  const requestCache = new Map();
  const requestInFlight = new Map();
  const MAX_CACHE_ENTRIES = 80;

  function safeNumber(value) {
    const number = Number(value);
    return value === null || value === undefined || !Number.isFinite(number) ? null : number;
  }

  function shortMarginRatioPercent(marginShort) {
    const shortBalance = safeNumber(marginShort?.shortTodayBalanceLots);
    const marginBalance = safeNumber(marginShort?.marginTodayBalanceLots);
    if (shortBalance === null || shortBalance < 0 || marginBalance === null || marginBalance <= 0) return null;
    return (shortBalance / marginBalance) * 100;
  }

  function shortMarginRatioRows(rows) {
    let previousRatio = null;
    return (rows || []).map((row) => {
      const ratio = shortMarginRatioPercent(row.marginShort);
      const change = ratio === null || previousRatio === null ? null : ratio - previousRatio;
      if (ratio !== null) previousRatio = ratio;
      return { sessionDate: row.sessionDate, ratio, change };
    });
  }

  function formatNumber(value, options = {}) {
    const number = safeNumber(value);
    if (number === null) return "無資料";
    return new Intl.NumberFormat("zh-TW", options).format(number);
  }

  function formatLots(shares) {
    const value = safeNumber(shares);
    return value === null ? "無資料" : `${formatNumber(value / 1000, { maximumFractionDigits: 1 })} 張`;
  }

  function formatPercent(value) {
    const number = safeNumber(value);
    return number === null ? "無資料" : `${formatNumber(number, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function directionFor(value) {
    const number = safeNumber(value);
    if (number === null || number === 0) return "flat";
    return number > 0 ? "positive" : "negative";
  }

  function formatSigned(value, options = {}) {
    const number = safeNumber(value);
    if (number === null) return "無資料";
    return formatNumber(number, { ...options, signDisplay: "always" });
  }

  function formatSignedLotsFromShares(shares) {
    const value = safeNumber(shares);
    return value === null ? "無資料" : `${formatSigned(value / 1000, { maximumFractionDigits: 1 })} 張`;
  }

  function formatDetailValue(value, unit, { signed = false } = {}) {
    const number = safeNumber(value);
    if (number === null) return "無資料";
    const formatter = signed ? formatSigned : formatNumber;
    if (unit === "shares") return `${formatter(number / 1000, { maximumFractionDigits: 1 })} 張`;
    if (unit === "lots") return `${formatter(number, { maximumFractionDigits: 1 })} 張`;
    if (unit === "percent") return `${formatter(number, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    if (unit === "people") return `${formatter(number, { maximumFractionDigits: 0 })} 人`;
    if (unit === "price") return formatter(number, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return formatter(number, { maximumFractionDigits: 2 });
  }

  function detailDirection(value) {
    const number = safeNumber(value);
    return number === null ? "missing" : directionFor(number);
  }

  function detailItemsForPane(paneId) {
    return (PANE_DETAIL_ITEMS[migratePaneId(paneId)] || []).map(({ id, label, color, unit }) => ({ id, label, color, unit }));
  }

  function dailyDetailModel(definition, rows, targetDate) {
    const ordered = [...(rows || [])]
      .filter((row) => row?.sessionDate)
      .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));
    const items = PANE_DETAIL_ITEMS[definition?.id] || [];
    const current = ordered.find((row) => row.sessionDate === targetDate) || null;
    const ratioChanges = new Map(shortMarginRatioRows(ordered).map((row) => [row.sessionDate, row]));
    const context = { ratioChanges };
    const previous = ordered.filter((row) => row.sessionDate < targetDate)
      .filter((row) => items.some((item) => safeNumber(item.get?.(row, context)) !== null))
      .at(-1) || null;
    const metadata = definition?.kind === "estimated-margin-maintenance" ? [
      ["公式版本", current?.marginShort?.estimatedMarginFormulaVersion || "無資料"],
      ["估算成本狀態", current?.marginShort?.estimatedMarginStatus || "無資料"],
      ["估算成本原因", current?.marginShort?.estimatedMarginReasonCode || "無資料"],
      ["估算維持率原因", current?.marginShort?.estimatedMaintenanceReasonCode || "無資料"],
      ["重新起算", current?.marginShort?.estimatedMarginReseeded ? "是" : "否"],
      ["估算成數模型", current?.marginShort?.marginLoanRatioSource || "無資料"],
      ["公式適用日", current?.marginShort?.marginLoanRatioSourceDate || "無資料"],
      ["說明", "固定採 60% 估算；不代表商品實際融資成數、投資人實際成交均價或券商追繳值"],
    ] : [];
    return {
      targetDate,
      currentDate: current?.sessionDate || targetDate,
      previousDate: previous?.sessionDate || "",
      frequency: "日資料",
      rows: items.map((item) => {
        const currentValue = current ? safeNumber(item.get?.(current, context)) : null;
        const previousValue = previous ? safeNumber(item.get?.(previous, context)) : null;
        const change = currentValue === null || previousValue === null ? null : currentValue - previousValue;
        return {
          id: item.id,
          label: item.label,
          color: item.color,
          previous: formatDetailValue(previousValue, item.unit),
          current: formatDetailValue(currentValue, item.unit),
          change: formatDetailValue(change, item.unit, { signed: true }),
          direction: detailDirection(change),
        };
      }),
      metadata,
    };
  }

  function holderDetailModel(definition, snapshots, targetDate) {
    const ordered = [...(snapshots || [])]
      .filter((item) => item?.row?.dataDate && item?.aggregate)
      .sort((left, right) => left.row.dataDate.localeCompare(right.row.dataDate));
    const currentIndex = ordered.findLastIndex((item) => item.row.dataDate <= targetDate);
    const current = currentIndex >= 0 ? ordered[currentIndex] : null;
    const previous = currentIndex > 0 ? ordered[currentIndex - 1] : null;
    const values = (snapshot) => ({
      ratio: snapshot?.aggregate?.ratioPercent,
      lots: snapshot?.aggregate?.lots,
      holders: snapshot?.aggregate?.holders,
    });
    const currentValues = values(current);
    const previousValues = values(previous);
    return {
      targetDate,
      currentDate: current?.row?.dataDate || "",
      previousDate: previous?.row?.dataDate || "",
      frequency: "週資料／當週最後營業日",
      rows: (PANE_DETAIL_ITEMS[definition?.id] || []).map((item) => {
        const currentValue = safeNumber(currentValues[item.id]);
        const previousValue = safeNumber(previousValues[item.id]);
        const change = currentValue === null || previousValue === null ? null : currentValue - previousValue;
        return {
          id: item.id,
          label: item.label,
          color: item.color,
          previous: formatDetailValue(previousValue, item.unit),
          current: formatDetailValue(currentValue, item.unit),
          change: formatDetailValue(change, item.unit, { signed: true }),
          direction: detailDirection(change),
        };
      }),
      metadata: [
        ["指向日期", targetDate || "無資料"],
        ["前一期發布日", previous?.row?.dataDate || "首筆／無前期比較"],
        ["當期發布日", current?.row?.dataDate || "無資料"],
        ["官方級距", current?.aggregate?.description || "無資料"],
        ["資料來源", providerLabel(current?.row?.provenance?.provider)],
        ["資料頻率", "週資料／當週最後營業日"],
        ["提醒", "集保持股級距，不推論投資人身分"],
      ],
    };
  }

  function datasetsForDefinition(definition) {
    return definition.datasets || (definition.dataset ? [definition.dataset] : []);
  }

  function providerLabel(value) {
    return ({ finmind: "FinMind", twse: "TWSE", tpex: "TPEx", tdcc: "TDCC" })[String(value || "").toLowerCase()] || "來源未標示";
  }

  const MINIMUM_TDCC_HISTORY_WEEKS = 51;
  const isHolderDefinition = (definition) => ["holder", "holder-total"].includes(definition?.kind);

  function availabilityLabel(availability, capability, backfill, dispatch) {
    if (capability?.supported === false) return capability.reason === "unsupported_interval" ? "僅支援日 K" : "不適用";
    if (backfill?.status === "queued" && ["started", "cooldown", "already-running"].includes(dispatch?.status)) return "立即回補啟動中";
    if (backfill?.status === "queued" && dispatch?.status === "unavailable") return "已排入背景回補（非立即）";
    if (backfill?.status === "queued" && dispatch?.status === "failed") return "立即啟動失敗，等待背景回補";
    if (backfill?.status === "queued") return "等待背景回補";
    if (backfill?.status === "running") return `背景歷史回補中（${backfill.completedWeeks || 0}/${backfill.expectedWeeks || 0} 週）`;
    if (["partial", "failed"].includes(backfill?.status)) return `回補未完成（${backfill.completedWeeks || 0}/${backfill.expectedWeeks || MINIMUM_TDCC_HISTORY_WEEKS} 週）`;
    if (backfill?.status === "blocked") return "來源阻擋";
    if (backfill?.status === "completed"
      && Number(backfill?.expectedWeeks || 0) >= MINIMUM_TDCC_HISTORY_WEEKS
      && Number(backfill?.completedWeeks || 0) >= Number(backfill?.expectedWeeks || 0)) return "歷史已更新";
    if (availability?.status === "available") return "";
    if (availability?.reason === "stale_cache") return "資料可能過期";
    if (availability?.reason === "history_not_archived") return availability.rowCount ? "目前僅 1 期／尚無前週比較" : "較早週資料未保存";
    if (availability?.reason === "not_published") return "尚未發布／無紀錄";
    if (availability?.reason === "provider_unavailable") return "來源暫時不可用";
    return availability?.status === "partial" ? "部分資料" : availability?.reason || "無資料";
  }

  function backfillMenuState(definition, payload) {
    const datasets = datasetsForDefinition(definition);
    if (!datasets.length || datasets.some((dataset) => payload?.datasetEligibility?.[dataset]?.supported === false)) return { visible: false, disabled: true, label: "" };
    if (isHolderDefinition(definition)) {
      const backfill = payload?.backfill || {};
      const dispatch = payload?.dispatch || {};
      if (backfill.status === "blocked") return { visible: true, disabled: true, label: "來源阻擋，暫不可回補", datasets };
      if (backfill.status === "running") return { visible: true, disabled: true, label: `TDCC 回補中（${backfill.completedWeeks || 0}/${backfill.expectedWeeks || 0} 週）`, datasets };
      if (backfill.status === "queued" && ["started", "cooldown", "already-running"].includes(dispatch.status)) return { visible: true, disabled: true, label: "TDCC 立即回補啟動中", datasets };
      if (backfill.status === "queued" && dispatch.status === "unavailable") return { visible: true, disabled: false, label: "立即回補歷史資料", datasets };
      if (backfill.status === "queued" && dispatch.status === "failed") return { visible: true, disabled: false, label: "重新立即回補歷史資料", datasets };
      if (backfill.status === "queued") return { visible: true, disabled: true, label: "等待背景回補", datasets };
      const availability = payload?.availability?.["shareholder-distribution"];
      const complete = backfill.status === "completed"
        && Number(backfill.expectedWeeks || 0) >= MINIMUM_TDCC_HISTORY_WEEKS
        && Number(backfill.completedWeeks || 0) >= Number(backfill.expectedWeeks || 0)
        && (!Array.isArray(backfill.missingDates) || backfill.missingDates.length === 0);
      const needsBackfill = !complete
        || availability?.reason === "history_not_archived"
        || ["partial", "failed"].includes(backfill.status);
      return needsBackfill
        ? { visible: true, disabled: false, label: "立即回補歷史資料", datasets }
        : { visible: false, disabled: true, label: "", datasets };
    }
    if (datasets.some((dataset) => payload?.availability?.[dataset]?.reason === "rate_limited")) {
      return { visible: true, disabled: true, label: "來源等待重試，請稍後再試", datasets };
    }
    const needsBackfill = datasets.some((dataset) => payload?.availability?.[dataset]?.status !== "available");
    return needsBackfill
      ? { visible: true, disabled: false, label: "立即回補缺少資料", datasets }
      : { visible: false, disabled: true, label: "", datasets };
  }

  function dateForChartTime(time) {
    let date;
    if (typeof time === "number") date = new Date(time * 1000);
    else if (typeof time === "string") date = new Date(time);
    else if (time && typeof time === "object" && "year" in time) date = new Date(Date.UTC(time.year, time.month - 1, time.day));
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  }

  function candleTimeByDate(candles) {
    return new Map((candles || []).map((row) => [dateForChartTime(row.time), row.time]).filter(([date]) => date));
  }

  function selectionStorageKey(tabId, symbol) {
    return `quoteChart.chipPanes.v1:${String(tabId || "default")}:${String(symbol || "").toUpperCase()}`;
  }

  function migratePaneId(id) {
    return ["foreign-flow", "foreign-holding"].includes(id) ? "foreign-flow-holding" : id;
  }

  function normalizePaneIds(ids) {
    const validIds = new Set(CHIP_PANE_REGISTRY.map((item) => item.id));
    return [...new Set((Array.isArray(ids) ? ids : []).map(migratePaneId).filter((id) => validIds.has(id)))];
  }

  function normalizePaneOrder(order, selectedIds = []) {
    return [...new Set([
      ...normalizePaneIds(order),
      ...normalizePaneIds(selectedIds),
      ...CHIP_PANE_REGISTRY.map((item) => item.id),
    ])];
  }

  function groupForPane(paneId) {
    return PANE_GROUP_BY_ID.get(migratePaneId(paneId)) || "";
  }

  function normalizeGroupOrder(order, paneOrder = [], selectedIds = []) {
    const validIds = new Set(CHIP_PANE_GROUPS.map((group) => group.id));
    const normalizedStored = [...new Set((Array.isArray(order) ? order : []).filter((id) => validIds.has(id)))];
    const migrated = normalizePaneOrder(paneOrder, selectedIds)
      .map(groupForPane)
      .filter(Boolean);
    return [...new Set([
      ...normalizedStored,
      ...migrated,
      ...CHIP_PANE_GROUPS.map((group) => group.id),
    ])];
  }

  function paneIdsForGroupOrder(groupOrder, selectedIds = []) {
    const selected = new Set(normalizePaneIds(selectedIds));
    const groups = normalizeGroupOrder(groupOrder, [], selectedIds);
    return groups.flatMap((groupId) => CHIP_PANE_GROUPS.find((group) => group.id === groupId)?.paneIds || [])
      .filter((paneId) => selected.has(paneId));
  }

  function groupSelectionState(groupId, selectedIds = []) {
    const group = CHIP_PANE_GROUPS.find((item) => item.id === groupId);
    if (!group) return "unchecked";
    const selected = new Set(normalizePaneIds(selectedIds));
    const count = group.paneIds.filter((paneId) => selected.has(paneId)).length;
    if (count === 0) return "unchecked";
    return count === group.paneIds.length ? "checked" : "indeterminate";
  }

  function toggleGroupSelection(groupId, selectedIds = [], forceChecked) {
    const group = CHIP_PANE_GROUPS.find((item) => item.id === groupId);
    if (!group) return normalizePaneIds(selectedIds);
    const selected = new Set(normalizePaneIds(selectedIds));
    const checked = forceChecked === undefined
      ? groupSelectionState(groupId, selectedIds) !== "checked"
      : Boolean(forceChecked);
    for (const paneId of group.paneIds) {
      if (checked) selected.add(paneId);
      else selected.delete(paneId);
    }
    return normalizePaneOrder([], [...selected]).filter((paneId) => selected.has(paneId));
  }

  function movePaneInOrder(order, paneId, targetIndex) {
    const next = [...(Array.isArray(order) ? order : [])];
    const fromIndex = next.indexOf(paneId);
    if (fromIndex < 0) return next;
    next.splice(fromIndex, 1);
    const normalizedTarget = Math.max(0, Math.min(Number(targetIndex) || 0, next.length));
    next.splice(normalizedTarget, 0, paneId);
    return next;
  }

  function migrateModeBSelectedPaneIds(stored) {
    if (!Array.isArray(stored?.modeBSelectedPaneIds)) return [...DEFAULT_MODE_B_PANES];
    const selectedIds = normalizePaneIds(stored.modeBSelectedPaneIds);
    const storedVersion = Number(stored.defaultsVersion);
    const needsEstimatedMaintenancePane = selectedIds.length > 0
      && (!Number.isFinite(storedVersion) || storedVersion < ESTIMATED_MAINTENANCE_PANE_DEFAULTS_VERSION)
      && !selectedIds.includes("estimated-margin-maintenance")
      && selectedIds.some((paneId) => groupForPane(paneId) === "margin-financing");
    return needsEstimatedMaintenancePane
      ? normalizePaneIds([...selectedIds, "estimated-margin-maintenance"])
      : selectedIds;
  }

  function readSelection(tabId, symbol) {
    try {
      const stored = JSON.parse(localStorage.getItem(selectionStorageKey(tabId, symbol)) || "null");
      const validIds = new Set(CHIP_PANE_REGISTRY.map((item) => item.id));
      const storedVersion = Number(stored?.defaultsVersion);
      const seriesByPane = Object.fromEntries(Object.entries(PANE_SERIES_OPTIONS).map(([paneId, config]) => {
        const validSeriesIds = new Set(config.items.map((item) => item.id));
        const storedIds = stored?.seriesByPane?.[paneId];
        const validStoredIds = Array.isArray(storedIds) ? storedIds.filter((id) => validSeriesIds.has(id)) : null;
        const legacyHolderDefault = ["big-holder", "retail-holder"].includes(paneId)
          && Array.isArray(validStoredIds)
          && (!Number.isFinite(storedVersion) || storedVersion < HOLDER_LINE_DEFAULTS_VERSION)
          && validStoredIds.length === LEGACY_HOLDER_DEFAULT_SERIES.length
          && LEGACY_HOLDER_DEFAULT_SERIES.every((id) => validStoredIds.includes(id));
        const storedSelection = legacyHolderDefault
          ? validStoredIds.filter((id) => id !== "holders")
          : validStoredIds || config.defaults;
        const selectedIds = paneId === "dealer-flow" && storedSelection.length === 0 ? config.defaults : storedSelection;
        return [paneId, [...new Set(selectedIds)]];
      }));
      const modeAActivePaneId = migratePaneId(stored?.modeAActivePaneId);
      const modeBSelectedPaneIds = migrateModeBSelectedPaneIds(stored);
      return {
        defaultsVersion: SELECTION_DEFAULTS_VERSION,
        modeASlotKind: stored?.modeASlotKind === "chip" ? "chip" : "technical",
        modeAActivePaneId: validIds.has(modeAActivePaneId) ? modeAActivePaneId : DEFAULT_MODE_A_PANE,
        modeBSelectedPaneIds,
        modeBPaneOrder: normalizePaneOrder(stored?.modeBPaneOrder, modeBSelectedPaneIds),
        modeBGroupOrder: normalizeGroupOrder(stored?.modeBGroupOrder, stored?.modeBPaneOrder, modeBSelectedPaneIds),
        seriesByPane,
      };
    } catch {
      return {
        defaultsVersion: SELECTION_DEFAULTS_VERSION,
        modeASlotKind: "technical",
        modeAActivePaneId: DEFAULT_MODE_A_PANE,
        modeBSelectedPaneIds: [...DEFAULT_MODE_B_PANES],
        modeBPaneOrder: normalizePaneOrder([], DEFAULT_MODE_B_PANES),
        modeBGroupOrder: normalizeGroupOrder([], [], DEFAULT_MODE_B_PANES),
        seriesByPane: Object.fromEntries(Object.entries(PANE_SERIES_OPTIONS).map(([paneId, config]) => [paneId, [...config.defaults]])),
      };
    }
  }

  function writeSelection(tabId, symbol, selection) {
    localStorage.setItem(selectionStorageKey(tabId, symbol), JSON.stringify(selection));
  }

  function rangeForCandles(candles) {
    const dates = (candles || []).map((row) => dateForChartTime(row.time)).filter(Boolean).sort();
    return { start: dates[0] || "", end: dates.at(-1) || "" };
  }

  function createAbortError() {
    try {
      return new DOMException("The operation was aborted", "AbortError");
    } catch {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      return error;
    }
  }

  function waitForSharedRequest(request, signal) {
    if (!signal) return request;
    if (signal.aborted) return Promise.reject(createAbortError());
    return new Promise((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const onAbort = () => {
        cleanup();
        reject(createAbortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      request.then(
        (value) => { cleanup(); resolve(value); },
        (error) => { cleanup(); reject(error); },
      );
    });
  }

  async function sharedChipRequest({ symbol, interval, datasets, candles, signal }) {
    const range = rangeForCandles(candles);
    const sortedDatasets = [...new Set(datasets)].sort();
    const key = `${symbol}|${interval}|${range.start}|${range.end}|${sortedDatasets.join(",")}`;
    if (signal?.aborted) throw createAbortError();
    if (requestCache.has(key)) return structuredClone(requestCache.get(key));
    let request = requestInFlight.get(key);
    if (!request) {
      const params = new URLSearchParams({ symbol, interval, start: range.start, end: range.end, datasets: sortedDatasets.join(",") });
      request = fetch(`/api/taiwan-stock-chip?${params}`)
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "籌碼資料載入失敗");
          requestCache.set(key, payload);
          while (requestCache.size > MAX_CACHE_ENTRIES) requestCache.delete(requestCache.keys().next().value);
          return payload;
        })
        .finally(() => requestInFlight.delete(key));
      requestInFlight.set(key, request);
    }
    return structuredClone(await waitForSharedRequest(request, signal));
  }

  function invalidateChipRequestCache(symbol) {
    const prefix = `${String(symbol || "").toUpperCase()}|`;
    for (const key of requestCache.keys()) if (key.startsWith(prefix)) requestCache.delete(key);
  }

  function backfillCoverageState(payload) {
    const coverage = (payload?.coverage || []).find((item) => item.dataset === "shareholder-distribution") || {};
    const backfill = payload?.backfill || {};
    return {
      status: String(backfill.status || coverage.backfillStatus || "idle"),
      savedWeeks: Math.max(0, Number(coverage.savedWeeks || payload?.distributionRows?.length || 0)),
      completedWeeks: Math.max(0, Number(backfill.completedWeeks || coverage.savedWeeks || 0)),
      expectedWeeks: Math.max(0, Number(backfill.expectedWeeks || coverage.expectedWeeks || 0)),
      missingWeeks: Array.isArray(backfill.missingDates) ? backfill.missingDates.length : Math.max(0, Number(coverage.missingWeeks || 0)),
    };
  }

  function shouldContinueBackfillPolling(state) {
    if (!state) return true;
    if (["blocked", "failed", "inactive"].includes(state.status)) return false;
    if (state.status === "completed"
      && state.expectedWeeks >= MINIMUM_TDCC_HISTORY_WEEKS
      && state.completedWeeks >= state.expectedWeeks
      && state.missingWeeks === 0) return false;
    return ["queued", "running", "partial", "completed", "idle"].includes(state.status);
  }

  function holderAggregate(distributionRow, paneId, threshold) {
    const levels = distributionRow?.levels || [];
    let selected;
    if (paneId === "big-holder") {
      const lowerLevel = Number(threshold || 15);
      selected = levels.filter((item) => Number(item.level) >= lowerLevel && Number(item.level) <= 15);
    } else {
      const upperLevel = Number(threshold || 3);
      selected = levels.filter((item) => Number(item.level) >= 1 && Number(item.level) <= upperLevel);
    }
    const expectedLevels = paneId === "big-holder"
      ? [...Array(16 - Number(threshold || 15))].map((_, index) => Number(threshold || 15) + index)
      : [...Array(Number(threshold || 3))].map((_, index) => index + 1);
    if (selected.length !== expectedLevels.length
      || expectedLevels.some((level) => !selected.some((item) => Number(item.level) === level))
      || selected.some((item) => [item.shares, item.holders, item.ratioPercent].some((value) => safeNumber(value) === null))) return null;
    const shares = selected.reduce((sum, item) => sum + safeNumber(item.shares), 0);
    return {
      holders: selected.reduce((sum, item) => sum + safeNumber(item.holders), 0),
      shares,
      lots: shares / 1000,
      ratioPercent: selected.reduce((sum, item) => sum + safeNumber(item.ratioPercent), 0),
      description: paneId === "big-holder"
        ? `${({ 15: "1,000,001 股以上", 14: "800,001 股以上", 13: "600,001 股以上", 12: "400,001 股以上" })[Number(threshold || 15)] || selected[0].range}（依集保持股級距）`
        : `${({ 3: "10,000 股以下", 4: "15,000 股以下", 5: "20,000 股以下" })[Number(threshold || 3)] || selected.at(-1).range}（依集保持股級距）`,
    };
  }

  function chartInteractionOptions(mode = "A") {
    return global.QuoteChartInteractions.chartInteractionOptions(mode);
  }

  function chartOptions(interactionMode = "A", axisSafeWidth = 52) {
    return {
      autoSize: true,
      ...chartInteractionOptions(interactionMode),
      layout: { background: { type: "solid", color: "#111827" }, textColor: "#94a3b8", attributionLogo: false },
      grid: { vertLines: { color: "rgba(148,163,184,.08)" }, horzLines: { color: "rgba(148,163,184,.08)" } },
      crosshair: SHARED_CROSSHAIR_OPTIONS,
      leftPriceScale: { visible: false, borderVisible: false },
      rightPriceScale: { visible: true, borderVisible: true, ticksVisible: true, minimumWidth: Math.max(52, Number(axisSafeWidth) || 52) },
      timeScale: { visible: false, borderVisible: false, rightOffset: 2 },
    };
  }

  function createPaneController(definition, options) {
    const element = document.createElement("section");
    element.className = "chip-pane";
    element.dataset.paneId = definition.id;
    if (isHolderDefinition(definition)) element.classList.add("is-holder-pane");
    const header = document.createElement("header");
    header.className = "chip-pane-header";
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "chip-pane-drag-handle";
    dragHandle.setAttribute("aria-label", `拖曳調整${definition.label}副圖順序`);
    dragHandle.title = "拖曳調整副圖順序";
    dragHandle.textContent = "⠿";
    dragHandle.hidden = true;
    const title = document.createElement("strong");
    title.textContent = definition.title || definition.label;
    title.title = definition.label;
    const inlineReadout = document.createElement("div");
    inlineReadout.className = "chip-pane-inline-readout";
    inlineReadout.setAttribute("role", "status");
    inlineReadout.setAttribute("aria-live", "polite");
    const status = document.createElement("span");
    status.className = "chip-pane-status";
    status.textContent = "載入中";
    header.append(title, inlineReadout, status);
    const seriesConfig = PANE_SERIES_OPTIONS[definition.id];
    const seriesInputs = [];
    if (definition.kind === "holder") {
      const threshold = document.createElement("select");
      threshold.className = "chip-threshold-select";
      threshold.setAttribute("aria-label", `${definition.label}級距`);
      const choices = definition.id === "big-holder"
        ? [[15, "1,000 張以上"], [14, "800 張以上"], [13, "600 張以上"], [12, "400 張以上"]]
        : [[3, "10 張以下"], [4, "15 張以下"], [5, "20 張以下"]];
      for (const [value, label] of choices) threshold.add(new Option(label, String(value)));
      threshold.addEventListener("change", () => render(lastPayload, lastCandles));
      header.appendChild(threshold);
    }
    const surface = document.createElement("div");
    surface.className = "chip-pane-chart";
    surface.tabIndex = 0;
    surface.setAttribute("aria-label", `${definition.label}副圖，按滑鼠右鍵開啟功能表`);
    element.append(header, surface);
    const holderDetails = document.createElement("aside");
    holderDetails.className = "chip-holder-details chip-pane-details";
    holderDetails.setAttribute("role", "dialog");
    holderDetails.setAttribute("aria-modal", "false");
    holderDetails.setAttribute("aria-label", `${definition.label}詳細資料`);
    holderDetails.tabIndex = -1;
    holderDetails.hidden = true;
    const detailsHeader = document.createElement("div");
    detailsHeader.className = "chip-holder-details-header";
    const detailsTitle = document.createElement("strong");
    detailsTitle.textContent = `${definition.label}詳細資料`;
    const holderDetailsClose = document.createElement("button");
    holderDetailsClose.type = "button";
    holderDetailsClose.className = "chip-holder-details-close";
    holderDetailsClose.setAttribute("aria-label", `關閉${definition.label}詳細資料`);
    holderDetailsClose.textContent = "×";
    detailsHeader.append(detailsTitle, holderDetailsClose);
    const table = document.createElement("table");
    table.className = "chip-holder-details-table chip-pane-details-table";
    const caption = document.createElement("caption");
    caption.textContent = `${definition.label}指向日期比較資料`;
    const detailsHead = document.createElement("thead");
    detailsHead.innerHTML = "<tr><th scope=\"col\">項目</th><th scope=\"col\">日期</th><th scope=\"col\">日期</th><th scope=\"col\">變化</th></tr>";
    const holderDetailsBody = document.createElement("tbody");
    const holderDetailsMetadata = document.createElement("tbody");
    holderDetailsMetadata.className = "chip-pane-details-metadata";
    table.append(caption, detailsHead, holderDetailsBody, holderDetailsMetadata);
    holderDetails.append(detailsHeader, table);
    document.body.appendChild(holderDetails);
    let detailsPinnedDate = "";
    let sharedReadoutDate = "";
    let contextMenuTargetDate = "";
    options.stack.appendChild(element);

    const contextMenu = document.createElement("div");
    contextMenu.className = "chip-pane-context-menu";
    contextMenu.setAttribute("role", "menu");
    contextMenu.setAttribute("aria-label", `${definition.label}功能表`);
    contextMenu.hidden = true;
    if (seriesConfig) {
      const seriesSection = document.createElement("div");
      seriesSection.className = "chip-pane-context-series";
      const seriesTitle = document.createElement("div");
      seriesTitle.className = "chip-pane-context-title";
      seriesTitle.textContent = "線圖項目";
      const choices = document.createElement("div");
      choices.className = "chip-series-choices";
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-label", `${definition.label}可顯示線圖`);
      for (const item of seriesConfig.items) {
        const label = document.createElement("label");
        label.className = "chip-series-choice";
        label.style.setProperty("--series-color", item.color);
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = item.id;
        input.setAttribute("role", "menuitemcheckbox");
        input.setAttribute("aria-label", `${definition.label}：${item.label}`);
        const swatch = document.createElement("span");
        swatch.className = "chip-series-swatch";
        swatch.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = item.label;
        label.append(input, swatch, text);
        choices.appendChild(label);
        seriesInputs.push(input);
      }
      seriesSection.append(seriesTitle, choices);
      contextMenu.appendChild(seriesSection);
      const separator = document.createElement("div");
      separator.className = "chip-pane-context-separator";
      separator.setAttribute("role", "separator");
      contextMenu.appendChild(separator);
    }
    const backfillSeparator = document.createElement("div");
    backfillSeparator.className = "chip-pane-context-separator";
    backfillSeparator.setAttribute("role", "separator");
    backfillSeparator.hidden = true;
    const backfillMenuItem = document.createElement("button");
    backfillMenuItem.type = "button";
    backfillMenuItem.className = "chip-pane-context-menu-action chip-pane-context-menu-backfill";
    backfillMenuItem.setAttribute("role", "menuitem");
    backfillMenuItem.setAttribute("aria-label", `立即回補${definition.label}缺少資料`);
    backfillMenuItem.hidden = true;
    const detailsMenuItem = document.createElement("button");
    detailsMenuItem.type = "button";
    detailsMenuItem.className = "chip-pane-context-menu-action chip-pane-context-menu-details";
    detailsMenuItem.setAttribute("role", "menuitem");
    detailsMenuItem.textContent = "詳細資料";
    detailsMenuItem.setAttribute("aria-label", `查看${definition.label}詳細資料`);
    const detailsSeparator = document.createElement("div");
    detailsSeparator.className = "chip-pane-context-separator";
    detailsSeparator.setAttribute("role", "separator");
    contextMenu.append(detailsMenuItem, detailsSeparator);
    const exportMenuItem = document.createElement("button");
    exportMenuItem.type = "button";
    exportMenuItem.className = "chip-pane-context-menu-action chip-pane-context-menu-export";
    exportMenuItem.setAttribute("role", "menuitem");
    exportMenuItem.textContent = "儲存圖片";
    const exportSeparator = document.createElement("div");
    exportSeparator.className = "chip-pane-context-separator";
    exportSeparator.setAttribute("role", "separator");
    contextMenu.append(exportMenuItem, exportSeparator);
    contextMenu.append(backfillSeparator, backfillMenuItem);
    const orderSeparator = document.createElement("div");
    orderSeparator.className = "chip-pane-context-separator chip-pane-context-order-separator";
    orderSeparator.setAttribute("role", "separator");
    const moveUpMenuItem = document.createElement("button");
    moveUpMenuItem.type = "button";
    moveUpMenuItem.className = "chip-pane-context-menu-action chip-pane-context-move-up";
    moveUpMenuItem.setAttribute("role", "menuitem");
    moveUpMenuItem.textContent = "上移資料群組";
    const moveDownMenuItem = document.createElement("button");
    moveDownMenuItem.type = "button";
    moveDownMenuItem.className = "chip-pane-context-menu-action chip-pane-context-move-down";
    moveDownMenuItem.setAttribute("role", "menuitem");
    moveDownMenuItem.textContent = "下移資料群組";
    const pinToTopMenuItem = document.createElement("button");
    pinToTopMenuItem.type = "button";
    pinToTopMenuItem.className = "chip-pane-context-menu-action chip-pane-context-pin-top";
    pinToTopMenuItem.setAttribute("role", "menuitem");
    pinToTopMenuItem.textContent = "置頂";
    pinToTopMenuItem.setAttribute("aria-label", `將${definition.label}資料群組置頂`);
    const pinToBottomMenuItem = document.createElement("button");
    pinToBottomMenuItem.type = "button";
    pinToBottomMenuItem.className = "chip-pane-context-menu-action chip-pane-context-pin-bottom";
    pinToBottomMenuItem.setAttribute("role", "menuitem");
    pinToBottomMenuItem.textContent = "置底";
    pinToBottomMenuItem.setAttribute("aria-label", `將${definition.label}資料群組置底`);
    contextMenu.append(orderSeparator, pinToTopMenuItem, pinToBottomMenuItem, moveUpMenuItem, moveDownMenuItem);
    const removeMenuItem = document.createElement("button");
    removeMenuItem.type = "button";
    removeMenuItem.className = "chip-pane-context-menu-remove";
    removeMenuItem.setAttribute("role", "menuitem");
    removeMenuItem.textContent = "移除副圖";
    removeMenuItem.setAttribute("aria-label", `移除${definition.label}副圖`);
    contextMenu.appendChild(removeMenuItem);
    document.body.appendChild(contextMenu);

    function closeContextMenu() {
      contextMenu.hidden = true;
    }

    function closeHolderDetails({ restoreFocus = false } = {}) {
      if (holderDetails.hidden) return;
      holderDetails.hidden = true;
      detailsPinnedDate = "";
      if (restoreFocus) surface.focus({ preventScroll: true });
    }

    function closeOverlays() {
      closeContextMenu();
      closeHolderDetails();
    }

    function openContextMenu(clientX, clientY, targetDate = "") {
      contextMenuTargetDate = targetDate || sharedReadoutDate || latestReadoutDate();
      updateOrderControls();
      contextMenu.hidden = false;
      contextMenu.style.left = "0px";
      contextMenu.style.top = "0px";
      const rect = contextMenu.getBoundingClientRect();
      const left = Math.max(8, Math.min(clientX, global.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(clientY, global.innerHeight - rect.height - 8));
      contextMenu.style.left = `${left}px`;
      contextMenu.style.top = `${top}px`;
      (seriesInputs[0] || detailsMenuItem || (!backfillMenuItem.hidden ? backfillMenuItem : removeMenuItem)).focus({ preventScroll: true });
    }

    function handleContextMenu(event) {
      event.preventDefault();
      event.stopPropagation();
      const rect = surface.getBoundingClientRect();
      const time = chart?.timeScale().coordinateToTime?.(event.clientX - rect.left);
      openContextMenu(event.clientX, event.clientY, dateForChartTime(time));
    }

    function handleSurfaceKeydown(event) {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      openContextMenu(rect.left + Math.min(rect.width - 8, 24), rect.top + Math.min(rect.height - 8, 24), sharedReadoutDate || latestReadoutDate());
    }

    function handleContextMenuPointerDown(event) {
      if (!contextMenu.hidden && !contextMenu.contains(event.target)) closeContextMenu();
      if (!holderDetails.hidden && !holderDetails.contains(event.target)) closeHolderDetails();
    }

    function handleContextMenuKeydown(event) {
      if (event.key !== "Escape") return;
      if (!contextMenu.hidden) {
        event.preventDefault();
        closeContextMenu();
        surface.focus({ preventScroll: true });
      } else if (!holderDetails.hidden) {
        event.preventDefault();
        closeHolderDetails({ restoreFocus: true });
      }
    }

    function removeFromContextMenu() {
      closeContextMenu();
      options.onRemove(definition.id);
    }

    function updateOrderControls() {
      const sortable = interactionMode === "B";
      orderSeparator.hidden = false;
      pinToTopMenuItem.hidden = false;
      pinToBottomMenuItem.hidden = false;
      moveUpMenuItem.hidden = !sortable;
      moveDownMenuItem.hidden = !sortable;
      pinToTopMenuItem.disabled = !options.canPinToTop?.(definition.id);
      pinToBottomMenuItem.disabled = !options.canPinToBottom?.(definition.id);
      moveUpMenuItem.disabled = !sortable || !options.canMove?.(definition.id, -1);
      moveDownMenuItem.disabled = !sortable || !options.canMove?.(definition.id, 1);
    }

    function pinToTopFromContextMenu() {
      if (pinToTopMenuItem.disabled) return;
      closeContextMenu();
      options.onPinToTop?.(definition.id);
    }

    function pinToBottomFromContextMenu() {
      if (pinToBottomMenuItem.disabled) return;
      closeContextMenu();
      options.onPinToBottom?.(definition.id);
    }

    function moveUpFromContextMenu() {
      if (moveUpMenuItem.disabled) return;
      closeContextMenu();
      options.onMove?.(definition.id, -1);
    }

    function moveDownFromContextMenu() {
      if (moveDownMenuItem.disabled) return;
      closeContextMenu();
      options.onMove?.(definition.id, 1);
    }

    function startPaneDrag(event) {
      options.onDragStart?.(definition.id, event);
    }

    async function requestBackfillFromContextMenu() {
      if (backfillMenuItem.disabled) return;
      backfillMenuItem.disabled = true;
      backfillMenuItem.textContent = "要求回補中…";
      try {
        const result = await options.onBackfill?.(definition.id);
        backfillMenuItem.textContent = result?.message || "回補要求已送出";
      } catch (error) {
        backfillMenuItem.textContent = error?.message || "回補要求失敗，請稍後再試";
      }
    }

    function showHolderDetailsFromContextMenu() {
      closeContextMenu();
      detailsPinnedDate = contextMenuTargetDate || sharedReadoutDate || latestReadoutDate();
      renderDetailTable(detailsPinnedDate);
      renderInlineReadout(resolveReadout(detailsPinnedDate));
      holderDetails.hidden = false;
      holderDetails.style.left = "0px";
      holderDetails.style.top = "0px";
      const surfaceRect = surface.getBoundingClientRect();
      const detailsRect = holderDetails.getBoundingClientRect();
      const left = Math.max(8, Math.min(surfaceRect.right - detailsRect.width, global.innerWidth - detailsRect.width - 8));
      const top = Math.max(8, Math.min(surfaceRect.top + 8, global.innerHeight - detailsRect.height - 8));
      holderDetails.style.left = `${left}px`;
      holderDetails.style.top = `${top}px`;
      holderDetails.focus({ preventScroll: true });
    }

    function closeHolderDetailsFromButton() {
      closeHolderDetails({ restoreFocus: true });
    }

    async function exportPanelFromContextMenu() {
      const date = contextMenuTargetDate || sharedReadoutDate || latestReadoutDate();
      closeContextMenu();
      try {
        await options.onExport?.({ date, paneId: definition.id });
      } catch (error) {
        if (error?.name === "AbortError") return;
        status.textContent = `圖片儲存失敗：${error?.message || "請稍後再試"}`;
        status.hidden = false;
      }
    }

    surface.addEventListener("contextmenu", handleContextMenu);
    surface.addEventListener("keydown", handleSurfaceKeydown);
    dragHandle.addEventListener("pointerdown", startPaneDrag);
    removeMenuItem.addEventListener("click", removeFromContextMenu);
    moveUpMenuItem.addEventListener("click", moveUpFromContextMenu);
    moveDownMenuItem.addEventListener("click", moveDownFromContextMenu);
    pinToTopMenuItem.addEventListener("click", pinToTopFromContextMenu);
    pinToBottomMenuItem.addEventListener("click", pinToBottomFromContextMenu);
    backfillMenuItem.addEventListener("click", requestBackfillFromContextMenu);
    detailsMenuItem?.addEventListener("click", showHolderDetailsFromContextMenu);
    exportMenuItem.addEventListener("click", exportPanelFromContextMenu);
    holderDetailsClose?.addEventListener("click", closeHolderDetailsFromButton);
    document.addEventListener("pointerdown", handleContextMenuPointerDown, true);
    document.addEventListener("keydown", handleContextMenuKeydown, true);
    global.addEventListener("blur", closeOverlays);
    global.addEventListener("resize", closeOverlays);
    global.addEventListener("scroll", closeContextMenu, true);

    let interactionMode = options.interactionMode === "B" ? "B" : "A";
    let chart;
    let anchor;
    let wheelRoutingCleanup;
    let viewportIntentCleanup;
    let series = [];
    let lastPayload;
    let lastCandles = [];
    let resizeObserver;
    let intersectionObserver;
    let destroyed = false;
    let readoutReservationFrame = 0;
    let readoutReservationSignature = "";
    let localReadoutReservation = 0;
    let cohortReadoutReservation = 0;
    let appliedReadoutReservation = 0;
    const readoutMeasurer = document.createElement("div");
    readoutMeasurer.className = "chip-pane-inline-readout chip-pane-readout-measurer";
    readoutMeasurer.setAttribute("aria-hidden", "true");
    readoutMeasurer.setAttribute("data-export-exclude", "true");
    readoutMeasurer.inert = true;

    function mountChart() {
      if (chart || destroyed) return;
      wheelRoutingCleanup = global.QuoteChartInteractions.bindWheelRouting(surface, () => interactionMode);
      viewportIntentCleanup = global.QuoteChartInteractions.bindViewportIntent(surface, {
        source: `chip:${definition.id}`,
        getMode: () => interactionMode,
        onStart: ({ kind }) => options.onViewportIntent?.({ paneId: definition.id, phase: "start", kind }),
        onEnd: ({ kind }) => options.onViewportIntent?.({ paneId: definition.id, phase: "end", kind }),
      });
      chart = global.LightweightCharts.createChart(surface, chartOptions(interactionMode, options.axisSafeWidth));
      anchor = chart.addSeries(global.LightweightCharts.LineSeries, { color: "rgba(0,0,0,0)", lineWidth: 1, priceScaleId: "chip-time-anchor", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      chart.priceScale("chip-time-anchor").applyOptions({ visible: false });
      chart.subscribeCrosshairMove((param) => {
        const localX = Number(param?.point?.x);
        const rect = surface.getBoundingClientRect();
        options.onCrosshair?.({
          time: param?.time,
          screenX: Number.isFinite(localX) ? rect.left + localX : undefined,
        }, definition.id);
      });
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        options.onRange?.(range, definition.id, chart?.timeScale().getVisibleRange?.());
      });
      if ("ResizeObserver" in global) {
        resizeObserver = new ResizeObserver(() => {
          chart?.resize(surface.clientWidth, surface.clientHeight);
          const mainRange = options.getMainRange?.();
          if (mainRange && chart) chart.timeScale().setVisibleLogicalRange(mainRange);
        });
        resizeObserver.observe(surface);
      }
      surface.dataset.chartMounted = "true";
      if (lastPayload !== undefined) render(lastPayload, lastCandles);
      const mainRange = options.getMainRange?.();
      if (mainRange) chart.timeScale().setVisibleLogicalRange(mainRange);
    }

    function unmountChart() {
      if (!chart) return;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      wheelRoutingCleanup?.();
      wheelRoutingCleanup = undefined;
      viewportIntentCleanup?.();
      viewportIntentCleanup = undefined;
      try { chart.remove(); } catch {}
      chart = undefined;
      anchor = undefined;
      series = [];
      delete surface.dataset.chartMounted;
      surface.replaceChildren();
    }

    function clearSeries() {
      if (!chart) { series = []; return; }
      for (const item of series) { try { chart.removeSeries(item); } catch {} }
      series = [];
    }

    function addHistogram(data, priceFormat, extra = {}) {
      const item = chart.addSeries(global.LightweightCharts.HistogramSeries, { priceFormat, priceLineVisible: false, lastValueVisible: false, base: 0, ...extra });
      item.setData(data);
      series.push(item);
      return item;
    }

    function addLine(data, color, priceFormat, extra = {}) {
      const item = chart.addSeries(global.LightweightCharts.LineSeries, {
        color,
        lineWidth: 2,
        priceFormat,
        priceLineVisible: false,
        lastValueVisible: false,
        ...extra,
        crosshairMarkerRadius: CROSSHAIR_MARKER_RADIUS,
        crosshairMarkerBorderWidth: CROSSHAIR_MARKER_BORDER_WIDTH,
      });
      item.setData(data);
      series.push(item);
      return item;
    }

    let dailyRowsByDate = new Map();
    let shortMarginRatioRowsByDate = new Map();
    let holderSnapshots = [];

    function selectedSeriesIds() {
      const stored = options.getSeriesSelection?.(definition.id);
      return new Set(Array.isArray(stored) ? stored : seriesConfig?.defaults || []);
    }

    function syncSeriesControls() {
      const selected = selectedSeriesIds();
      for (const input of seriesInputs) input.checked = selected.has(input.value);
    }

    for (const input of seriesInputs) input.addEventListener("change", () => {
      const selected = seriesInputs.filter((item) => item.checked).map((item) => item.value);
      if (definition.id === "dealer-flow" && selected.length === 0) {
        input.checked = true;
        return;
      }
      options.onSeriesSelectionChange?.(definition.id, selected);
      render(lastPayload, lastCandles);
    });

    function missingReadout(sessionDate, message = "無資料") {
      return { date: sessionDate, segments: [{ value: message, tone: "missing" }], missing: true };
    }

    function segment(label, value, options = {}) {
      return { label, value, ...options };
    }

    function directionalSegment(label, value, formatter, options = {}) {
      const number = safeNumber(value);
      return segment(label, number === null ? "無資料" : formatter(number), {
        direction: number === null ? "flat" : directionFor(number),
        tone: number === null ? "missing" : undefined,
        ...options,
      });
    }

    function previousActualValue(sessionDate, getter) {
      const rows = [...dailyRowsByDate.values()]
        .filter((item) => item.sessionDate < sessionDate)
        .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate));
      for (const item of rows) {
        const value = safeNumber(getter(item));
        if (value !== null) return value;
      }
      return null;
    }

    function trendSegment(sessionDate, label, value, getter, formatter, options = {}) {
      const number = safeNumber(value);
      const previous = number === null ? null : previousActualValue(sessionDate, getter);
      return segment(label, number === null ? "無資料" : formatter(number), {
        direction: number === null || previous === null ? "flat" : directionFor(number - previous),
        showArrow: number !== null && previous !== null,
        tone: number === null ? "missing" : undefined,
        ...options,
      });
    }

    function resolveReadout(sessionDate) {
      if (!sessionDate) return null;
      if (isHolderDefinition(definition)) {
        const exact = holderSnapshots.find((item) => item.row.dataDate === sessionDate);
        if (exact && exact.row.dataDate === sessionDate) {
          if (definition.kind === "holder-total") {
            return {
              date: exact.row.dataDate,
              segments: [
                segment("總戶數", `${formatNumber(exact.aggregate.holders)} 人`, { seriesId: "holders" }),
                exact.holdersChange === null
                  ? segment("戶數變化", "首筆／無前週比較", { tone: "missing", seriesId: "holders" })
                  : directionalSegment("戶數變化", exact.holdersChange, (value) => `${formatSigned(value, { maximumFractionDigits: 0 })} 人`, { seriesId: "holders" }),
              ],
              missing: false,
            };
          }
          const weekChange = exact.direction === null
            ? "首筆／無前週比較"
            : `${formatSigned(exact.direction, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
          const holdingLotsChange = exact.lotsChange === null
            ? "首筆／無前週比較"
            : `${formatSigned(exact.lotsChange, { maximumFractionDigits: 1 })} 張`;
          return {
            date: exact.row.dataDate,
            segments: [
              segment("持股", formatPercent(exact.aggregate.ratioPercent)),
              exact.direction === null
                ? segment("週變化", "首筆／無前週比較", { tone: "missing" })
                : directionalSegment("週變化", exact.direction, (value) => `${formatSigned(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`),
              exact.lotsChange === null
                ? segment("持股", "首筆／無前週比較", { tone: "missing" })
                : directionalSegment("持股", exact.lotsChange, (value) => `${formatSigned(value, { maximumFractionDigits: 1 })} 張`),
              segment("人數", `${formatNumber(exact.aggregate.holders)} 人`, { seriesId: "holders" }),
              exact.holdersChange === null
                ? segment("人數變化", "首筆／無前週比較", { tone: "missing", seriesId: "holders" })
                : directionalSegment("人數變化", exact.holdersChange, (value) => `${formatSigned(value, { maximumFractionDigits: 0 })} 人`, { seriesId: "holders" }),
            ],
            detailRows: [
              ["資料日期", exact.row.dataDate],
              ["持股比例", formatPercent(exact.aggregate.ratioPercent)],
              ["週變化", weekChange],
              ["官方級距", exact.aggregate.description],
              ["持股張數", `${formatNumber(exact.aggregate.lots, { maximumFractionDigits: 1 })} 張`],
              ["持股增減", holdingLotsChange],
              ["持股人數", `${formatNumber(exact.aggregate.holders)} 人`],
              ["資料來源", providerLabel(exact.row.provenance?.provider)],
              ["資料頻率", "週資料／當週最後營業日"],
              ["提醒", "集保持股級距，不推論投資人身分"],
            ],
            missing: false,
          };
        }
        const reference = holderSnapshots.filter((item) => item.row.dataDate < sessionDate).at(-1);
        const segments = [segment("", "當日無資料", { tone: "missing" })];
        if (reference) segments.push(segment("最近一筆", `${reference.row.dataDate}・${definition.kind === "holder-total" ? `${formatNumber(reference.aggregate.holders)} 人` : formatPercent(reference.aggregate.ratioPercent)}`, { secondary: true }));
        return {
          date: sessionDate,
          segments,
          detailRows: [
            ["查詢日期", sessionDate],
            ["資料狀態", "當日無資料"],
            ...(reference ? [["最近一筆", `${reference.row.dataDate}・${definition.kind === "holder-total" ? `${formatNumber(reference.aggregate.holders)} 人` : formatPercent(reference.aggregate.ratioPercent)}`]] : []),
            ["資料頻率", "週資料／當週最後營業日"],
            ["提醒", "集保持股級距，不推論投資人身分"],
          ],
          missing: true,
        };
      }

      const row = dailyRowsByDate.get(sessionDate);
      if (!row) return missingReadout(sessionDate);
      if (definition.kind === "foreign-combined") {
        const institutional = row.institutionalFlow;
        const holding = row.foreignHolding;
        const available = [institutional?.foreignNetShares, institutional?.foreignBuyShares, institutional?.foreignSellShares, holding?.heldShares, holding?.heldRatioPercent]
          .some((item) => safeNumber(item) !== null);
        return {
          date: sessionDate,
          segments: [
            trendSegment(sessionDate, "買賣超", institutional?.foreignNetShares, (item) => item.institutionalFlow?.foreignNetShares, formatSignedLotsFromShares, { seriesId: "net" }),
            trendSegment(sessionDate, "買進", institutional?.foreignBuyShares, (item) => item.institutionalFlow?.foreignBuyShares, formatLots, { seriesId: "buy" }),
            trendSegment(sessionDate, "賣出", institutional?.foreignSellShares, (item) => item.institutionalFlow?.foreignSellShares, formatLots, { seriesId: "sell" }),
            trendSegment(sessionDate, "持股張數", holding?.heldShares, (item) => item.foreignHolding?.heldShares, formatLots, { seriesId: "holdingShares" }),
            trendSegment(sessionDate, "持股比例", holding?.heldRatioPercent, (item) => item.foreignHolding?.heldRatioPercent, formatPercent, { seriesId: "holdingRatio" }),
          ],
          missing: !available,
        };
      }
      if (definition.kind === "flow") {
        const value = row.institutionalFlow;
        if (definition.id === "dealer-flow") {
          const selectedIds = selectedSeriesIds();
          const dealerItems = [
            ["self", "自行", "dealerSelfNetShares"],
            ["hedging", "避險", "dealerHedgingNetShares"],
            ["net", "合計", "dealerTotalNetShares"],
          ].filter(([seriesId]) => selectedIds.has(seriesId));
          const segments = dealerItems.map(([seriesId, label, field]) => trendSegment(
            sessionDate,
            label,
            value?.[field],
            (item) => item.institutionalFlow?.[field],
            formatSignedLotsFromShares,
            { seriesId },
          ));
          return {
            date: sessionDate,
            segments,
            missing: !dealerItems.some(([, , field]) => safeNumber(value?.[field]) !== null),
          };
        }
        const selected = safeNumber(value?.[definition.field]);
        const segments = [trendSegment(sessionDate, "買賣超", selected, (item) => item.institutionalFlow?.[definition.field], formatSignedLotsFromShares, { seriesId: "net" })];
        if (definition.id === "investment-trust-flow") {
          segments.push(
            trendSegment(sessionDate, "買進", value?.investmentTrustBuyShares, (item) => item.institutionalFlow?.investmentTrustBuyShares, formatLots, { seriesId: "buy" }),
            trendSegment(sessionDate, "賣出", value?.investmentTrustSellShares, (item) => item.institutionalFlow?.investmentTrustSellShares, formatLots, { seriesId: "sell" }),
          );
        } else if (definition.id === "institutional-total-flow") {
          segments.push(
            trendSegment(sessionDate, "外資", value?.foreignNetShares, (item) => item.institutionalFlow?.foreignNetShares, formatSignedLotsFromShares),
            trendSegment(sessionDate, "投信", value?.investmentTrustNetShares, (item) => item.institutionalFlow?.investmentTrustNetShares, formatSignedLotsFromShares),
            trendSegment(sessionDate, "自營", value?.dealerTotalNetShares, (item) => item.institutionalFlow?.dealerTotalNetShares, formatSignedLotsFromShares),
          );
        }
        return {
          date: sessionDate,
          segments,
          missing: selected === null,
        };
      }
      if (definition.kind === "estimated-margin-maintenance") {
        const value = row.marginShort;
        const maintenance = safeNumber(value?.estimatedMaintenancePercent);
        const balanceChange = safeNumber(value?.marginBalanceChangeLots);
        return {
          date: sessionDate,
          segments: [
            maintenance === null
              ? segment("估算維持率", "無資料", { tone: "missing", seriesId: "maintenance" })
              : segment("估算維持率", formatPercent(maintenance), { seriesId: "maintenance" }),
            balanceChange === null
              ? segment("融資增減", "無資料", { tone: "missing" })
              : directionalSegment("融資增減", balanceChange, (number) => `${formatSigned(number, { maximumFractionDigits: 1 })} 張`),
          ],
          missing: maintenance === null,
        };
      }
      if (definition.kind === "short-margin-ratio") {
        const value = row.marginShort;
        const derived = shortMarginRatioRowsByDate.get(sessionDate) || { ratio: shortMarginRatioPercent(row.marginShort), change: null };
        const ratioSegment = derived.ratio === null
          ? segment("券資比", "無資料", { tone: "missing", seriesId: "ratio" })
          : segment("券資比", formatPercent(derived.ratio), {
              direction: derived.change === null ? "flat" : directionFor(derived.change),
              showArrow: derived.change !== null,
              seriesId: "ratio",
            });
        const changeSegment = derived.ratio === null
          ? segment("日變化", "無資料", { tone: "missing", seriesId: "change" })
          : derived.change === null
            ? segment("日變化", "首筆／無前日比較", { tone: "missing", seriesId: "change" })
            : directionalSegment("日變化", derived.change, (number) => `${formatSigned(number, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`, { seriesId: "change" });
        const lots = (number) => {
          const normalized = safeNumber(number);
          return normalized === null ? "無資料" : `${formatNumber(normalized, { maximumFractionDigits: 1 })} 張`;
        };
        return {
          date: sessionDate,
          segments: [
            ratioSegment,
            changeSegment,
            segment("融券餘額", lots(value?.shortTodayBalanceLots), { secondary: true }),
            segment("融資餘額", lots(value?.marginTodayBalanceLots), { secondary: true }),
          ],
          missing: derived.ratio === null,
        };
      }
      if (definition.kind === "margin" || definition.kind === "short") {
        const value = row.marginShort;
        const prefix = definition.kind === "margin" ? "margin" : "short";
        const balanceField = definition.kind === "margin" ? "marginTodayBalanceLots" : "shortTodayBalanceLots";
        const changeField = definition.kind === "margin" ? "marginBalanceChangeLots" : "shortBalanceChangeLots";
        const utilizationField = `${prefix}UtilizationPercent`;
        const readoutFields = [balanceField, changeField, `${prefix}BuyLots`, `${prefix}SellLots`, `${prefix}CashRepaymentLots`, utilizationField, "offsetLots"];
        const available = readoutFields.some((field) => safeNumber(value?.[field]) !== null);
        const lots = (number) => `${formatNumber(number, { maximumFractionDigits: 1 })} 張`;
        const signedLots = (number) => `${formatSigned(number, { maximumFractionDigits: 1 })} 張`;
        return {
          date: sessionDate,
          segments: [
            trendSegment(sessionDate, "餘額", value?.[balanceField], (item) => item.marginShort?.[balanceField], lots, { seriesId: "balance" }),
            trendSegment(sessionDate, "變化", value?.[changeField], (item) => item.marginShort?.[changeField], signedLots, { seriesId: "change" }),
            trendSegment(sessionDate, "買進", value?.[`${prefix}BuyLots`], (item) => item.marginShort?.[`${prefix}BuyLots`], lots, { seriesId: "buy" }),
            trendSegment(sessionDate, "賣出", value?.[`${prefix}SellLots`], (item) => item.marginShort?.[`${prefix}SellLots`], lots, { seriesId: "sell" }),
            trendSegment(sessionDate, "償還", value?.[`${prefix}CashRepaymentLots`], (item) => item.marginShort?.[`${prefix}CashRepaymentLots`], lots, { seriesId: "repayment" }),
            trendSegment(sessionDate, "使用率", value?.[utilizationField], (item) => item.marginShort?.[utilizationField], formatPercent, { seriesId: "utilization" }),
            trendSegment(sessionDate, "資券互抵", value?.offsetLots, (item) => item.marginShort?.offsetLots, lots, { secondary: true }),
          ],
          missing: !available,
        };
      }
      const value = row.securitiesLending;
      const available = [value?.transactionShares, value?.balanceShares, value?.shortSaleBalanceShares].some((item) => safeNumber(item) !== null);
      return {
        date: sessionDate,
        segments: available
          ? [segment("成交", formatLots(value?.transactionShares)), segment("借券餘額", formatLots(value?.balanceShares)), segment("借券賣出餘額", formatLots(value?.shortSaleBalanceShares), { secondary: true })]
          : [segment("", "無資料", { tone: "missing" })],
        missing: !available,
      };
    }

    function renderReadoutInto(target, readout) {
      target.replaceChildren();
      if (!readout) return;
      const date = document.createElement("span");
      date.className = "chip-readout-date";
      date.textContent = readout.date || "";
      target.appendChild(date);
      for (const item of readout.segments || []) {
        const node = document.createElement("span");
        node.className = "chip-readout-segment";
        const seriesColor = seriesColorForReadout(definition, item.seriesId);
        if (seriesColor) node.style.setProperty("--readout-series-color", seriesColor);
        const labelNode = document.createElement("span");
        labelNode.className = "chip-readout-label";
        labelNode.textContent = item.label ? `${item.label} ` : "";
        const valueNode = document.createElement("span");
        valueNode.className = "chip-readout-value";
        if (item.direction) valueNode.classList.add(`is-${item.direction}`);
        if (item.tone === "missing") valueNode.classList.add("is-missing");
        if (item.secondary) valueNode.classList.add("is-secondary");
        const arrow = item.showArrow ? ({ positive: "↑", negative: "↓", flat: "→" })[item.direction] || "" : "";
        valueNode.textContent = `${item.value}${arrow ? ` ${arrow}` : ""}`;
        node.append(labelNode, valueNode);
        target.appendChild(node);
      }
      target.title = target.textContent;
    }

    function renderInlineReadout(readout) {
      if (detailsPinnedDate && !holderDetails.hidden) readout = resolveReadout(detailsPinnedDate);
      renderReadoutInto(inlineReadout, readout);
    }

    function readoutModelsForReservation() {
      const dates = new Set([
        ...lastCandles.map((row) => dateForChartTime(row.time)),
        ...dailyRowsByDate.keys(),
        ...holderSnapshots.map((item) => item.row?.dataDate),
        latestReadoutDate(),
      ].filter(Boolean));
      const models = [...dates].map(resolveReadout).filter(Boolean);
      if (isHolderDefinition(definition)) {
        models.push(resolveReadout("0001-01-01"), resolveReadout("9999-12-31"));
      } else {
        models.push(missingReadout("9999-12-31"));
      }
      return readoutEnvelopeCandidates(models);
    }

    function readoutDataState(candidates) {
      return candidates.map((candidate) => (candidate.segments || [])
        .map((item) => `${item.label || ""}:${item.tone || ""}:${item.secondary ? "secondary" : "primary"}`)
        .join(",")).sort().join("|");
    }

    function applyReadoutReservation() {
      const next = Math.ceil(Math.max(localReadoutReservation, cohortReadoutReservation, 0));
      if (next === appliedReadoutReservation) return;
      appliedReadoutReservation = next;
      if (next > 0) inlineReadout.style.setProperty("--chip-readout-reserved-height", `${next}px`);
      else inlineReadout.style.removeProperty("--chip-readout-reserved-height");
      element.dataset.readoutReservation = String(next || 0);
    }

    function clearCohortReadoutReservation() {
      if (!cohortReadoutReservation) return;
      cohortReadoutReservation = 0;
      applyReadoutReservation();
    }

    function measureReadoutReservation() {
      readoutReservationFrame = 0;
      if (destroyed || !element.isConnected) return;
      const width = inlineReadout.getBoundingClientRect().width;
      if (!(width > 0)) return;
      const candidates = readoutModelsForReservation();
      if (!candidates.length) return;
      const computed = global.getComputedStyle(inlineReadout);
      const threshold = element.querySelector(".chip-threshold-select")?.value || "";
      const signature = chipReadoutLayoutSignature({
        mode: interactionMode,
        width,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        lineHeight: computed.lineHeight,
        zoom: global.devicePixelRatio || 1,
        selectedSeries: [...selectedSeriesIds()],
        dataState: readoutDataState(candidates),
        threshold,
      });
      if (signature === readoutReservationSignature && localReadoutReservation > 0) return;
      readoutReservationSignature = signature;
      clearCohortReadoutReservation();
      Object.assign(readoutMeasurer.style, {
        width: `${width}px`,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        rowGap: computed.rowGap,
        columnGap: computed.columnGap,
      });
      document.body.appendChild(readoutMeasurer);
      let measured = 0;
      for (const candidate of candidates) {
        renderReadoutInto(readoutMeasurer, candidate);
        measured = Math.max(measured, readoutMeasurer.getBoundingClientRect().height);
      }
      readoutMeasurer.remove();
      readoutMeasurer.replaceChildren();
      localReadoutReservation = Math.ceil(measured);
      applyReadoutReservation();
      options.onReadoutReservationChange?.();
    }

    function scheduleReadoutReservation({ invalidate = false } = {}) {
      if (invalidate) readoutReservationSignature = "";
      if (readoutReservationFrame || destroyed) return;
      const requestFrame = global.requestAnimationFrame || ((callback) => global.setTimeout(callback, 0));
      readoutReservationFrame = requestFrame(measureReadoutReservation);
    }

    function reservationControlKey() {
      const threshold = element.querySelector(".chip-threshold-select")?.value || "";
      return `${[...selectedSeriesIds()].sort().join(",")}|${threshold}`;
    }

    function renderDetailTable(targetDate) {
      const model = isHolderDefinition(definition)
        ? holderDetailModel(definition, holderSnapshots, targetDate)
        : dailyDetailModel(definition, [...dailyRowsByDate.values()], targetDate);
      holderDetailsBody.replaceChildren();
      holderDetailsMetadata.replaceChildren();
      const headings = detailsHead.querySelectorAll("th");
      headings[1].textContent = model.previousDate || "無前期資料";
      headings[2].textContent = model.currentDate || targetDate || "無資料";
      for (const item of model.rows) {
        const row = document.createElement("tr");
        const heading = document.createElement("th");
        heading.scope = "row";
        heading.textContent = item.label;
        heading.style.setProperty("--detail-series-color", item.color);
        const previous = document.createElement("td");
        previous.textContent = item.previous;
        const current = document.createElement("td");
        current.textContent = item.current;
        const change = document.createElement("td");
        change.textContent = item.change;
        change.className = `chip-pane-detail-change is-${item.direction}`;
        row.append(heading, previous, current, change);
        holderDetailsBody.appendChild(row);
      }
      for (const [label, value] of model.metadata || []) {
        const row = document.createElement("tr");
        const heading = document.createElement("th");
        heading.scope = "row";
        heading.textContent = label;
        const cell = document.createElement("td");
        cell.colSpan = 3;
        cell.textContent = value;
        row.append(heading, cell);
        holderDetailsMetadata.appendChild(row);
      }
    }

    function latestReadoutDate() {
      if (isHolderDefinition(definition)) return holderSnapshots.at(-1)?.row?.dataDate || rangeForCandles(lastCandles).end;
      if (definition.kind === "short-margin-ratio") {
        return [...shortMarginRatioRowsByDate.values()].filter((item) => item.ratio !== null).at(-1)?.sessionDate
          || [...dailyRowsByDate.keys()].at(-1)
          || rangeForCandles(lastCandles).end;
      }
      return [...dailyRowsByDate.keys()].at(-1) || rangeForCandles(lastCandles).end;
    }

    function render(payload, candles) {
      lastPayload = payload;
      lastCandles = candles || [];
      syncSeriesControls();
      if (!chart || !anchor) return;
      clearSeries();
      chart.applyOptions({ rightPriceScale: { visible: true, borderVisible: true, ticksVisible: true } });
      const timeMap = candleTimeByDate(lastCandles);
      // Lightweight Charts cannot always resolve a coordinate for a flat zero-only
      // scale while a synchronized crosshair is being restored.  A neutral,
      // non-zero anchor keeps every candle date addressable without drawing data.
      anchor.setData(lastCandles.map((row) => ({ time: row.time, value: 1 })));
      const daily = payload?.rows || [];
      dailyRowsByDate = new Map(daily.map((row) => [row.sessionDate, row]));
      shortMarginRatioRowsByDate = new Map(shortMarginRatioRows(daily).map((row) => [row.sessionDate, row]));
      holderSnapshots = [];
      const definitionDatasets = datasetsForDefinition(definition);
      const availabilities = definitionDatasets.map((dataset) => payload?.availability?.[dataset]).filter(Boolean);
      const availability = availabilities.every((item) => item.status === "available")
        ? { status: "available" }
        : availabilities.some((item) => ["available", "partial"].includes(item.status))
          ? { status: "partial" }
          : availabilities[0];
      const capability = definitionDatasets.map((dataset) => payload?.datasetEligibility?.[dataset]).find((item) => item?.supported === false);
      status.textContent = availabilityLabel(availability, capability, isHolderDefinition(definition) ? payload?.backfill : null, isHolderDefinition(definition) ? payload?.dispatch : null);
      if (isHolderDefinition(definition) && status.textContent === "歷史已更新") status.textContent = "";
      if (definition.kind === "estimated-margin-maintenance"
        && !daily.some((row) => safeNumber(row.marginShort?.estimatedMaintenancePercent) !== null)) {
        status.textContent = "估算成本或收盤價資料不足";
      }
      status.hidden = !status.textContent;
      status.className = `chip-pane-status chip-status-${availability?.status || "unavailable"}`;
      const backfillState = backfillMenuState(definition, payload);
      backfillMenuItem.hidden = !backfillState.visible;
      backfillMenuItem.disabled = backfillState.disabled;
      backfillMenuItem.textContent = backfillState.label;
      backfillMenuItem.setAttribute("aria-label", isHolderDefinition(definition)
        ? `${backfillState.label}：${definition.label}`
        : `${backfillState.label}：${definition.label}缺少資料`);
      backfillSeparator.hidden = !backfillState.visible;

      if (definition.kind === "foreign-combined") {
        const selected = selectedSeriesIds();
        const flowFields = [
          ["net", "foreignNetShares", "#f472b6", true],
          ["buy", "foreignBuyShares", "#f87171", false],
          ["sell", "foreignSellShares", "#4ade80", false],
        ];
        const flowHasData = flowFields.some(([seriesId, field]) => selected.has(seriesId)
          && daily.some((row) => safeNumber(row.institutionalFlow?.[field]) !== null));
        const ratioHasData = selected.has("holdingRatio") && daily.some((row) => safeNumber(row.foreignHolding?.heldRatioPercent) !== null);
        const sharesHasData = selected.has("holdingShares") && daily.some((row) => safeNumber(row.foreignHolding?.heldShares) !== null);
        const rightGroup = flowHasData ? "flow" : ratioHasData ? "ratio" : sharesHasData ? "shares" : null;
        for (const [seriesId, field, color, signed] of flowFields) {
          if (!selected.has(seriesId)) continue;
          const data = daily.flatMap((row) => {
            const value = safeNumber(row.institutionalFlow?.[field]);
            const time = timeMap.get(row.sessionDate);
            const barColor = signed ? value > 0 ? "#dc2626" : value < 0 ? "#16a34a" : "#64748b" : color;
            return value === null || !time ? [] : [{ time, value: value / 1000, color: barColor }];
          });
          addHistogram(data, { type: "custom", formatter: formatCompactLotsAxis }, { priceScaleId: rightGroup === "flow" ? "right" : "foreign-flow-scale", color });
        }
        if (selected.has("holdingRatio")) {
          const data = daily.flatMap((row) => { const value = safeNumber(row.foreignHolding?.heldRatioPercent); const time = timeMap.get(row.sessionDate); return value === null || !time ? [] : [{ time, value }]; });
          addLine(data, "#38bdf8", { type: "custom", formatter: formatCompactPercentAxis }, { priceScaleId: rightGroup === "ratio" ? "right" : "foreign-ratio-scale" });
        }
        if (selected.has("holdingShares")) {
          const data = daily.flatMap((row) => { const value = safeNumber(row.foreignHolding?.heldShares); const time = timeMap.get(row.sessionDate); return value === null || !time ? [] : [{ time, value: value / 1000 }]; });
          addLine(data, "#facc15", { type: "custom", formatter: formatCompactLotsAxis }, { priceScaleId: rightGroup === "shares" ? "right" : "foreign-holding-scale" });
        }
        if (rightGroup !== "flow" && flowFields.some(([seriesId]) => selected.has(seriesId))) {
          chart.priceScale("foreign-flow-scale").applyOptions({ visible: false, borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } });
        }
        if (rightGroup !== "ratio" && selected.has("holdingRatio")) chart.priceScale("foreign-ratio-scale").applyOptions({ visible: false, borderVisible: false });
        if (rightGroup !== "shares" && selected.has("holdingShares")) chart.priceScale("foreign-holding-scale").applyOptions({ visible: false, borderVisible: false });
      } else if (definition.kind === "flow") {
        const fields = definition.id === "investment-trust-flow"
          ? [
              ["net", "investmentTrustNetShares", "#f472b6", true],
              ["buy", "investmentTrustBuyShares", "#f87171", false],
              ["sell", "investmentTrustSellShares", "#4ade80", false],
            ]
          : definition.id === "dealer-flow"
            ? [
                ["self", "dealerSelfNetShares", "#f87171", true],
                ["hedging", "dealerHedgingNetShares", "#38bdf8", true],
                ["net", "dealerTotalNetShares", "#f472b6", true],
              ]
            : [["net", definition.field, "#f472b6", true]];
        const selected = ["investment-trust-flow", "dealer-flow"].includes(definition.id) ? selectedSeriesIds() : new Set(["net"]);
        for (const [seriesId, field, color, signed] of fields) {
          if (!selected.has(seriesId)) continue;
          const data = daily.flatMap((row) => {
            const value = safeNumber(row.institutionalFlow?.[field]);
            const time = timeMap.get(row.sessionDate);
            const barColor = signed ? value > 0 ? "#dc2626" : value < 0 ? "#16a34a" : "#64748b" : color;
            return value === null || !time ? [] : [{ time, value: value / 1000, color: barColor }];
          });
          addHistogram(data, { type: "custom", formatter: formatCompactLotsAxis }, { priceScaleId: "right", color });
        }
      } else if (definition.kind === "estimated-margin-maintenance") {
        const selected = selectedSeriesIds();
        if (selected.has("maintenance")) {
          const data = daily.flatMap((row) => {
            const value = safeNumber(row.marginShort?.estimatedMaintenancePercent);
            const time = timeMap.get(row.sessionDate);
            if (!time) return [];
            return value === null ? [{ time }] : [{ time, value }];
          });
          addLine(data, "#fb7185", { type: "custom", formatter: formatCompactPercentAxis }, { priceScaleId: "right" });
        }
      } else if (definition.kind === "short-margin-ratio") {
        const selected = selectedSeriesIds();
        const computed = shortMarginRatioRows(daily).map((item) => ({ ...item, time: timeMap.get(item.sessionDate) }));
        if (selected.has("ratio")) {
          addLine(
            computed.filter((item) => item.ratio !== null && item.time).map((item) => ({ time: item.time, value: item.ratio })),
            "#facc15",
            { type: "custom", formatter: formatCompactPercentAxis },
            { priceScaleId: "right" },
          );
        }
        if (selected.has("change")) {
          addHistogram(
            computed.filter((item) => item.change !== null && item.time).map((item) => ({
              time: item.time,
              value: item.change,
              color: item.change > 0 ? "#dc2626" : item.change < 0 ? "#16a34a" : "#64748b",
            })),
            { type: "custom", formatter: (value) => formatCompactPercentAxis(value, { signDisplay: "always" }) },
            { priceScaleId: SHORT_MARGIN_RATIO_CHANGE_PRICE_SCALE_ID },
          );
          chart.priceScale(SHORT_MARGIN_RATIO_CHANGE_PRICE_SCALE_ID).applyOptions({ visible: false, borderVisible: false, scaleMargins: { top: 0.58, bottom: 0.08 } });
        }
      } else if (definition.kind === "margin" || definition.kind === "short") {
        const prefix = definition.kind === "margin" ? "margin" : "short";
        const selected = selectedSeriesIds();
        const balanceField = `${prefix}TodayBalanceLots`;
        const flowFields = [
          ["change", `${prefix}BalanceChangeLots`, "#e879f9", true],
          ["buy", `${prefix}BuyLots`, "#f87171", false],
          ["sell", `${prefix}SellLots`, "#4ade80", false],
          ["repayment", `${prefix}CashRepaymentLots`, "#f59e0b", false],
        ];
        const balanceHasData = selected.has("balance") && daily.some((row) => safeNumber(row.marginShort?.[balanceField]) !== null);
        const flowHasData = flowFields.some(([seriesId, field]) => selected.has(seriesId)
          && daily.some((row) => safeNumber(row.marginShort?.[field]) !== null));
        const utilizationField = `${prefix}UtilizationPercent`;
        const utilizationHasData = selected.has("utilization") && daily.some((row) => safeNumber(row.marginShort?.[utilizationField]) !== null);
        const rightGroup = balanceHasData ? "balance" : flowHasData ? "flow" : utilizationHasData ? "utilization" : null;
        if (selected.has("balance")) {
          const data = daily.flatMap((row) => { const value = safeNumber(row.marginShort?.[balanceField]); const time = timeMap.get(row.sessionDate); return value === null || !time ? [] : [{ time, value }]; });
          addLine(data, definition.kind === "margin" ? "#f472b6" : "#a78bfa", { type: "custom", formatter: formatCompactLotsAxis }, { priceScaleId: rightGroup === "balance" ? "right" : `${prefix}-balance-scale` });
        }
        for (const [seriesId, field, color, signed] of flowFields) {
          if (!selected.has(seriesId)) continue;
          const data = daily.flatMap((row) => {
            const value = safeNumber(row.marginShort?.[field]);
            const time = timeMap.get(row.sessionDate);
            const barColor = signed ? value > 0 ? "#dc2626" : value < 0 ? "#16a34a" : "#64748b" : color;
            return value === null || !time ? [] : [{ time, value, color: barColor }];
          });
          addHistogram(data, { type: "custom", formatter: formatCompactLotsAxis }, { priceScaleId: rightGroup === "flow" ? "right" : `${prefix}-flow-scale`, color });
        }
        if (selected.has("utilization")) {
          const data = daily.flatMap((row) => { const value = safeNumber(row.marginShort?.[utilizationField]); const time = timeMap.get(row.sessionDate); return value === null || !time ? [] : [{ time, value }]; });
          addLine(data, "#38bdf8", { type: "custom", formatter: formatCompactPercentAxis }, { priceScaleId: rightGroup === "utilization" ? "right" : `${prefix}-utilization-scale` });
        }
        if (rightGroup !== "balance" && selected.has("balance")) chart.priceScale(`${prefix}-balance-scale`).applyOptions({ visible: false, borderVisible: false });
        if (rightGroup !== "flow" && flowFields.some(([seriesId]) => selected.has(seriesId))) {
          chart.priceScale(`${prefix}-flow-scale`).applyOptions({ visible: false, borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } });
        }
        if (rightGroup !== "utilization" && selected.has("utilization")) chart.priceScale(`${prefix}-utilization-scale`).applyOptions({ visible: false, borderVisible: false });
      } else if (definition.kind === "lending") {
        const lendingFields = [
          ["transactionShares", "成交", "#f59e0b", "histogram"],
          ["balanceShares", "借券餘額", "#38bdf8", "line"],
          ["shortSaleBalanceShares", "借券賣出餘額", "#a78bfa", "line"],
        ];
        for (const [field, , color, seriesKind] of lendingFields) {
          const data = daily.flatMap((row) => { const value = safeNumber(row.securitiesLending?.[field]); const time = timeMap.get(row.sessionDate); return value === null || !time ? [] : [{ time, value: value / 1000, color }]; });
          if (!data.length) continue;
          if (seriesKind === "histogram") addHistogram(data, { type: "custom", formatter: formatCompactLotsAxis });
          else addLine(data, color, { type: "custom", formatter: formatCompactLotsAxis });
        }
      } else if (definition.kind === "holder-total") {
        let previousHolders = null;
        const computed = (payload?.distributionRows || []).flatMap((row) => {
          const holders = safeNumber(row?.holderMetrics?.totalHolders ?? row?.total?.holders);
          const time = timeMap.get(row.dataDate);
          if (holders === null || !time) return [];
          const holdersChange = previousHolders === null ? null : holders - previousHolders;
          previousHolders = holders;
          return [{
            row,
            aggregate: { holders, description: "TDCC 分級 17 合計" },
            holdersChange,
            direction: holdersChange,
            lotsChange: null,
            time,
          }];
        });
        if (selectedSeriesIds().has("holders")) {
          addHistogram(
            computed.map((item) => ({
              time: item.time,
              value: item.aggregate.holders,
              color: item.holdersChange > 0 ? "#dc2626" : item.holdersChange < 0 ? "#16a34a" : "#22d3ee",
            })),
            { type: "custom", formatter: (value) => `${formatNumber(value, { maximumFractionDigits: 0 })}人` },
            { priceScaleId: "right" },
          );
        }
        holderSnapshots = computed;
      } else {
        const threshold = element.querySelector(".chip-threshold-select")?.value;
        let previous = null;
        let previousLots = null;
        let previousHolders = null;
        const computed = (payload?.distributionRows || []).flatMap((row) => {
          const aggregate = holderAggregate(row, definition.id, threshold);
          const time = timeMap.get(row.dataDate);
          if (!aggregate || !time) return [];
          const direction = previous === null ? null : aggregate.ratioPercent - previous;
          const lotsChange = previousLots === null ? null : aggregate.lots - previousLots;
          const holdersChange = previousHolders === null ? null : aggregate.holders - previousHolders;
          previous = aggregate.ratioPercent;
          previousLots = aggregate.lots;
          previousHolders = aggregate.holders;
          return [{ row, aggregate, direction, lotsChange, holdersChange, time }];
        });
        const ratioColor = definition.id === "big-holder" ? "#38bdf8" : "#f59e0b";
        const selected = selectedSeriesIds();
        if (selected.has("ratio")) {
          addLine(
            computed.map((item) => ({ time: item.time, value: item.aggregate.ratioPercent })),
            ratioColor,
            { type: "custom", formatter: formatCompactPercentAxis },
            { priceScaleId: "right", lineWidth: 1, pointMarkersVisible: true, pointMarkersRadius: CROSSHAIR_MARKER_RADIUS },
          );
        }
        if (selected.has("change")) {
          addHistogram(
            computed.filter((item) => item.direction !== null).map((item) => ({
              time: item.time,
              value: item.direction,
              color: item.direction > 0 ? "#dc2626" : item.direction < 0 ? "#16a34a" : "#64748b",
            })),
            { type: "custom", formatter: (value) => formatCompactPercentAxis(value, { signDisplay: "always" }) },
            { priceScaleId: HOLDER_CHANGE_PRICE_SCALE_ID },
          );
          chart.priceScale(HOLDER_CHANGE_PRICE_SCALE_ID).applyOptions({ visible: false, borderVisible: false, scaleMargins: { top: 0.58, bottom: 0.08 } });
        }
        if (selected.has("holders")) {
          addLine(
            computed.map((item) => ({ time: item.time, value: item.aggregate.holders })),
            "#a78bfa",
            { type: "custom", formatter: (value) => `${formatNumber(value, { maximumFractionDigits: 0 })}人` },
            { priceScaleId: HOLDER_COUNT_PRICE_SCALE_ID, lineWidth: 1, pointMarkersVisible: true, pointMarkersRadius: CROSSHAIR_MARKER_RADIUS },
          );
          chart.priceScale(HOLDER_COUNT_PRICE_SCALE_ID).applyOptions({ visible: false, borderVisible: false });
        }
        holderSnapshots = computed;
      }
      renderInlineReadout(resolveReadout(latestReadoutDate()));
      scheduleReadoutReservation({ invalidate: true });
      if (detailsPinnedDate && !holderDetails.hidden) renderDetailTable(detailsPinnedDate);
      const mainRange = options.getMainRange?.();
      if (mainRange) chart.timeScale().setVisibleLogicalRange(mainRange);
      options.onLayoutChange?.();
    }

    if ("IntersectionObserver" in global) {
      intersectionObserver = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) mountChart();
        else unmountChart();
      }, { root: null, rootMargin: "240px 0px", threshold: 0.01 });
      intersectionObserver.observe(element);
    } else {
      mountChart();
    }

    return {
      id: definition.id,
      element,
      render,
      setCandles(candles) {
        const nextCandles = Array.isArray(candles) ? candles : [];
        const previousRange = rangeForCandles(lastCandles);
        const nextRange = rangeForCandles(nextCandles);
        lastCandles = nextCandles;
        if (previousRange.start === nextRange.start && previousRange.end === nextRange.end) return;
        const latestCandle = lastCandles.at(-1);
        if (anchor && latestCandle?.time) anchor.update({ time: latestCandle.time, value: 1 });
        const mainRange = options.getMainRange?.();
        if (mainRange && chart) chart.timeScale().setVisibleLogicalRange(mainRange);
        scheduleReadoutReservation({ invalidate: true });
      },
      isMounted() { return Boolean(chart); },
      syncSeriesControls,
      syncRange(range) { if (range && chart) chart.timeScale().setVisibleLogicalRange(range); },
      syncTimeRange(range) {
        if (!range || !chart) return;
        try {
          chart.timeScale().setVisibleRange(range);
        } catch {
          const logicalRange = options.getMainRange?.();
          if (!logicalRange) return;
          try { chart.timeScale().setVisibleLogicalRange(logicalRange); } catch {}
        }
      },
      alignCoordinate(time, mainScreenX, mainRange, tolerance = 1) {
        if (!chart || !time || !mainRange || !Number.isFinite(mainScreenX)) return;
        const coordinate = chart.timeScale().timeToCoordinate(time);
        if (!Number.isFinite(coordinate)) return;
        const delta = mainScreenX - (surface.getBoundingClientRect().left + coordinate);
        if (Math.abs(delta) <= tolerance) return;
        const barSpacing = Number(chart.timeScale().options?.().barSpacing);
        if (!(barSpacing > 0)) return;
        const logicalShift = Math.round(delta / barSpacing);
        if (!logicalShift) return;
        chart.timeScale().setVisibleLogicalRange({
          from: Number(mainRange.from) - logicalShift,
          to: Number(mainRange.to) - logicalShift,
        });
      },
      setCrosshair(time) {
        if (!time || !chart || typeof chart.setCrosshairPosition !== "function") return;
        try {
          chart.setCrosshairPosition(1, time, anchor);
        } catch {
          // A pane can be resizing or tearing down while a shared pointer frame
          // is still in flight.  The next pointer frame restores the position.
        }
      },
      clearCrosshair() {
        if (!chart) return;
        try { chart.clearCrosshairPosition?.(); } catch {}
        renderInlineReadout(resolveReadout(latestReadoutDate()));
      },
      showReadout(time) { sharedReadoutDate = dateForChartTime(time); renderInlineReadout(resolveReadout(sharedReadoutDate)); },
      restoreLatestReadout() { renderInlineReadout(resolveReadout(latestReadoutDate())); },
      measureCoordinate(time) {
        const coordinate = chart?.timeScale().timeToCoordinate(time);
        const rect = surface.getBoundingClientRect();
        return {
          paneId: definition.id,
          coordinate,
          screenX: Number.isFinite(coordinate) ? rect.left + coordinate : null,
          plotRect: { left: rect.left, right: rect.right, width: rect.width },
          visibleLogicalRange: chart?.timeScale().getVisibleLogicalRange?.() || null,
          visibleTimeRange: chart?.timeScale().getVisibleRange?.() || null,
        };
      },
      plotRect() { return surface.getBoundingClientRect(); },
      measureAxisSafeWidth() {
        if (!chart) return 0;
        const table = surface.querySelector(".tv-lightweight-charts table");
        if (!table) return 0;
        return Math.max(0, ...[...table.querySelectorAll("tr")]
          .map((row) => row.lastElementChild?.getBoundingClientRect().width || 0)
          .filter((width) => Number.isFinite(width) && width > 0));
      },
      setAxisSafeWidth(width) {
        chart?.applyOptions({ rightPriceScale: { visible: true, borderVisible: true, ticksVisible: true, minimumWidth: Math.max(52, Number(width) || 52) }, leftPriceScale: { visible: false, borderVisible: false } });
      },
      setInteractionMode(mode) {
        const nextMode = mode === "B" ? "B" : "A";
        const changed = interactionMode !== nextMode;
        interactionMode = nextMode;
        dragHandle.hidden = true;
        updateOrderControls();
        chart?.applyOptions(chartInteractionOptions(interactionMode));
        if (changed) scheduleReadoutReservation({ invalidate: true });
      },
      resize() {
        chart?.resize(surface.clientWidth, surface.clientHeight);
        scheduleReadoutReservation();
      },
      reservationReport(orderPrefix = "") {
        return {
          paneId: definition.id,
          orderPrefix,
          controlKey: reservationControlKey(),
          localHeight: localReadoutReservation,
          appliedHeight: appliedReadoutReservation,
          signature: readoutReservationSignature,
          applyCohortHeight(height) {
            const next = Math.ceil(Math.max(0, Number(height) || 0));
            if (next === cohortReadoutReservation) return;
            cohortReadoutReservation = next;
            applyReadoutReservation();
          },
        };
      },
      clearCohortReservation: clearCohortReadoutReservation,
      geometryReport() {
        const headerRect = header.getBoundingClientRect();
        const paneRect = element.getBoundingClientRect();
        const readoutRect = inlineReadout.getBoundingClientRect();
        return {
          paneId: definition.id,
          headerHeight: headerRect.height,
          paneHeight: paneRect.height,
          paneTop: paneRect.top,
          readoutHeight: readoutRect.height,
          readoutOverflowX: Math.max(0, inlineReadout.scrollWidth - inlineReadout.clientWidth),
          localReservation: localReadoutReservation,
          appliedReservation: appliedReadoutReservation,
          layoutSignature: readoutReservationSignature,
        };
      },
      destroy() {
        destroyed = true;
        const cancelFrame = global.cancelAnimationFrame || global.clearTimeout;
        if (readoutReservationFrame) {
          cancelFrame?.(readoutReservationFrame);
          readoutReservationFrame = 0;
        }
        readoutMeasurer.remove();
        inlineReadout.style.removeProperty("--chip-readout-reserved-height");
        delete element.dataset.readoutReservation;
        closeOverlays();
        intersectionObserver?.disconnect();
        intersectionObserver = undefined;
        unmountChart();
        surface.removeEventListener("contextmenu", handleContextMenu);
        surface.removeEventListener("keydown", handleSurfaceKeydown);
        dragHandle.removeEventListener("pointerdown", startPaneDrag);
        removeMenuItem.removeEventListener("click", removeFromContextMenu);
        moveUpMenuItem.removeEventListener("click", moveUpFromContextMenu);
        moveDownMenuItem.removeEventListener("click", moveDownFromContextMenu);
        pinToTopMenuItem.removeEventListener("click", pinToTopFromContextMenu);
        pinToBottomMenuItem.removeEventListener("click", pinToBottomFromContextMenu);
        backfillMenuItem.removeEventListener("click", requestBackfillFromContextMenu);
        detailsMenuItem.removeEventListener("click", showHolderDetailsFromContextMenu);
        exportMenuItem.removeEventListener("click", exportPanelFromContextMenu);
        holderDetailsClose.removeEventListener("click", closeHolderDetailsFromButton);
        document.removeEventListener("pointerdown", handleContextMenuPointerDown, true);
        document.removeEventListener("keydown", handleContextMenuKeydown, true);
        global.removeEventListener("blur", closeOverlays);
        global.removeEventListener("resize", closeOverlays);
        global.removeEventListener("scroll", closeContextMenu, true);
        contextMenu.remove();
        holderDetails.remove();
        element.remove();
      },
      closeOverlays,
    };
  }

  function normalizeChipPaneMode(mode) {
    if (["main", "none"].includes(mode)) return "none";
    if (["multi", "B"].includes(mode)) return "B";
    return "A";
  }

  function presentationModeForChipMode(mode) {
    if (mode === "none") return "main";
    return mode === "B" ? "multi" : "single";
  }

  function createChipPaneManager(options) {
    const controllers = new Map();
    const groupControllers = new Map();
    let context = { symbol: "", interval: "", tabId: "", candles: [] };
    let selection = readSelection("", "");
    let mode = "A";
    let generation = 0;
    let abortController;
    let payload;
    let syncing = false;
    let reloadTimer;
    let backfillPollTimer;
    let backfillPollSymbol = "";
    let backfillPollAttempts = 0;
    let paneDrag;
    let currentNoticeSignature = "";
    let dismissedNoticeSignature = "";
    let manager;
    const backfillPollDelays = [1200, 1800, 2500, 3500, 5000, 7000, 9000, 12000];

    function setNotice(text, { dismissible = false, signature = "" } = {}) {
      const messages = warningMessages(text);
      const content = messages.join("；");
      currentNoticeSignature = signature;
      options.emptyStatus.replaceChildren();
      for (const message of messages) {
        const item = document.createElement("span");
        item.className = "chip-pane-warning-item";
        item.dataset.dataset = CHIP_WARNING_DATASET_STYLES.find((style) => message.startsWith(style.label))?.dataset || "unknown";
        item.style.setProperty("--chip-warning-color", warningColorForText(message));
        item.textContent = message;
        options.emptyStatus.appendChild(item);
      }
      const visible = Boolean(content) && (!dismissible || shouldShowWarningNotice(signature, dismissedNoticeSignature));
      options.notice.hidden = !visible;
      options.noticeClose.hidden = !visible || !dismissible;
      options.onLayoutChange?.();
    }

    function closeNotice() {
      if (!currentNoticeSignature) return;
      dismissedNoticeSignature = currentNoticeSignature;
      options.notice.hidden = true;
      options.noticeClose.hidden = true;
      options.onLayoutChange?.();
    }

    options.noticeClose?.addEventListener("click", closeNotice);

    function ensureGroupController(groupId) {
      const existing = groupControllers.get(groupId);
      if (existing) return existing;
      const definition = CHIP_PANE_GROUPS.find((group) => group.id === groupId);
      if (!definition) return null;
      const element = document.createElement("section");
      element.className = "chip-pane-group";
      element.dataset.groupId = groupId;
      const header = document.createElement("header");
      header.className = "chip-pane-group-header";
      header.title = `拖曳調整${definition.label}資料群組順序`;
      const dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "chip-pane-group-drag-handle";
      dragHandle.textContent = "⠿";
      dragHandle.title = `拖曳調整${definition.label}資料群組順序`;
      dragHandle.setAttribute("aria-label", `拖曳調整${definition.label}資料群組順序`);
      const label = document.createElement("strong");
      label.textContent = definition.label;
      const count = document.createElement("span");
      count.className = "chip-pane-group-count";
      const body = document.createElement("div");
      body.className = "chip-pane-group-body";
      header.append(dragHandle, label, count);
      element.append(header, body);
      const startDrag = (event) => {
        if (isPaneDragIgnoredTarget(event.target)) return;
        startPaneDrag(groupId, event);
      };
      const moveWithKeyboard = (event) => {
        if (mode !== "B" || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        movePane(groupId, event.key === "ArrowUp" ? -1 : 1);
      };
      header.addEventListener("pointerdown", startDrag);
      dragHandle.addEventListener("keydown", moveWithKeyboard);
      const controller = {
        id: groupId,
        element,
        body,
        dragHandle,
        update(paneCount) {
          count.textContent = `${paneCount} 個副圖`;
          dragHandle.hidden = mode !== "B";
        },
        destroy() {
          header.removeEventListener("pointerdown", startDrag);
          dragHandle.removeEventListener("keydown", moveWithKeyboard);
          element.remove();
        },
      };
      groupControllers.set(groupId, controller);
      return controller;
    }

    function stopBackfillPolling() {
      clearTimeout(backfillPollTimer);
      backfillPollTimer = undefined;
      backfillPollSymbol = "";
      backfillPollAttempts = 0;
    }

    function scheduleBackfillPoll(delay) {
      clearTimeout(backfillPollTimer);
      backfillPollTimer = setTimeout(pollBackfill, delay);
    }

    async function pollBackfill() {
      const symbol = backfillPollSymbol;
      if (!symbol || symbol !== context.symbol || backfillPollAttempts >= 80) {
        stopBackfillPolling();
        return;
      }
      backfillPollAttempts += 1;
      invalidateChipRequestCache(symbol);
      await load();
      if (symbol !== context.symbol || symbol !== backfillPollSymbol) return;
      const state = backfillCoverageState(payload);
      if (!shouldContinueBackfillPolling(state)) {
        stopBackfillPolling();
        return;
      }
      scheduleBackfillPoll(backfillPollDelays[Math.min(backfillPollAttempts, backfillPollDelays.length - 1)]);
    }

    function startBackfillPolling(symbol) {
      stopBackfillPolling();
      backfillPollSymbol = symbol;
      scheduleBackfillPoll(backfillPollDelays[0]);
    }

    function desiredPaneIds() {
      if (mode === "none") return [];
      if (!isEligibleContext(context.symbol, context.interval)) return [];
      const selected = mode === "A"
        ? selection.modeASlotKind === "chip" ? [selection.modeAActivePaneId] : []
        : selection.modeBSelectedPaneIds;
      const order = mode === "A"
        ? CHIP_PANE_REGISTRY.map((item) => item.id)
        : paneIdsForGroupOrder(selection.modeBGroupOrder, selected);
      return order.filter((id) => selected.includes(id));
    }

    function desiredGroupIds() {
      const visibleGroups = new Set(desiredPaneIds().map(groupForPane));
      if (mode === "A") return [...visibleGroups].filter(Boolean);
      return normalizeGroupOrder(selection.modeBGroupOrder, selection.modeBPaneOrder, selection.modeBSelectedPaneIds)
        .filter((groupId) => visibleGroups.has(groupId));
    }

    function orderedControllers() {
      return desiredPaneIds().map((id) => controllers.get(id)).filter(Boolean);
    }

    function mountedControllers() {
      return orderedControllers().filter((controller) => controller.isMounted?.());
    }

    function applyControllerOrder(groupIds = desiredGroupIds()) {
      const paneIds = desiredPaneIds();
      for (const groupId of groupIds) {
        const groupController = ensureGroupController(groupId);
        if (!groupController) continue;
        options.stack.appendChild(groupController.element);
        const children = paneIds.filter((paneId) => groupForPane(paneId) === groupId);
        for (const paneId of children) {
          const controller = controllers.get(paneId);
          if (controller) groupController.body.appendChild(controller.element);
        }
        groupController.update(children.length);
      }
    }

    function saveVisibleGroupOrder(ids) {
      const visible = new Set(desiredGroupIds());
      let visibleIndex = 0;
      selection.modeBGroupOrder = normalizeGroupOrder(selection.modeBGroupOrder, selection.modeBPaneOrder, selection.modeBSelectedPaneIds)
        .map((groupId) => visible.has(groupId) ? ids[visibleIndex++] : groupId);
      persist();
    }

    function canMovePane(id, direction) {
      if (mode !== "B") return false;
      const groupId = CHIP_PANE_GROUPS.some((group) => group.id === id) ? id : groupForPane(id);
      const ids = desiredGroupIds();
      const index = ids.indexOf(groupId);
      return index >= 0 && index + direction >= 0 && index + direction < ids.length;
    }

    function canPinPaneToTop(id) {
      if (mode !== "B") return false;
      const groupId = CHIP_PANE_GROUPS.some((group) => group.id === id) ? id : groupForPane(id);
      return desiredGroupIds().indexOf(groupId) > 0;
    }

    function pinPaneToTop(id) {
      if (!canPinPaneToTop(id)) return;
      const groupId = CHIP_PANE_GROUPS.some((group) => group.id === id) ? id : groupForPane(id);
      const ids = desiredGroupIds();
      const next = movePaneInOrder(ids, groupId, 0);
      saveVisibleGroupOrder(next);
      options.onLayoutChange?.({ preserveViewport: true, reason: "pane-reorder" });
      applyControllerOrder(next);
      updateInputs();
    }

    function canPinPaneToBottom(id) {
      if (mode !== "B") return false;
      const groupId = CHIP_PANE_GROUPS.some((group) => group.id === id) ? id : groupForPane(id);
      const ids = desiredGroupIds();
      const index = ids.indexOf(groupId);
      return index >= 0 && index < ids.length - 1;
    }

    function pinPaneToBottom(id) {
      if (!canPinPaneToBottom(id)) return;
      const groupId = CHIP_PANE_GROUPS.some((group) => group.id === id) ? id : groupForPane(id);
      const ids = desiredGroupIds();
      const next = movePaneInOrder(ids, groupId, ids.length - 1);
      saveVisibleGroupOrder(next);
      options.onLayoutChange?.({ preserveViewport: true, reason: "pane-reorder" });
      applyControllerOrder(next);
      updateInputs();
    }

    function movePane(id, direction) {
      if (!canMovePane(id, direction)) return;
      const groupId = CHIP_PANE_GROUPS.some((group) => group.id === id) ? id : groupForPane(id);
      const ids = desiredGroupIds();
      const next = movePaneInOrder(ids, groupId, ids.indexOf(groupId) + direction);
      saveVisibleGroupOrder(next);
      options.onLayoutChange?.({ preserveViewport: true, reason: "pane-reorder" });
      applyControllerOrder(next);
      updateInputs();
    }

    function measurePaneDragRects() {
      if (!paneDrag) return new Map();
      return new Map(paneDrag.originalOrder.map((groupId) => [
        groupId,
        groupControllers.get(groupId)?.element.getBoundingClientRect(),
      ]));
    }

    function clearPaneDragListeners() {
      global.removeEventListener("pointermove", updatePaneDrag, true);
      global.removeEventListener("pointerup", finishPaneDragFromPointer, true);
      global.removeEventListener("pointercancel", cancelPaneDrag, true);
      global.removeEventListener("blur", cancelPaneDrag);
      document.removeEventListener("keydown", handlePaneDragKeydown, true);
      document.removeEventListener("visibilitychange", handlePaneDragVisibilityChange);
      global.removeEventListener("resize", cancelPaneDrag);
    }

    function clearPaneDragStyles() {
      options.stack.classList.remove("is-pane-reordering");
      for (const controller of groupControllers.values()) controller.element.classList.remove("is-dragging");
      paneDrag?.placeholder?.remove();
      paneDrag?.ghost?.remove();
    }

    function finishPaneDrag(commit = true) {
      if (!paneDrag) return;
      const drag = paneDrag;
      const { originalOrder, previewOrder } = drag;
      clearPaneDragListeners();
      if (drag.frame) global.cancelAnimationFrame(drag.frame);
      clearPaneDragStyles();
      paneDrag = undefined;
      if (commit && previewOrder.join("|") !== originalOrder.join("|")) {
        saveVisibleGroupOrder(previewOrder);
        options.onLayoutChange?.({ preserveViewport: true, reason: "pane-reorder" });
        applyControllerOrder(previewOrder);
        updateInputs();
      }
    }

    function cancelPaneDrag() {
      finishPaneDrag(false);
    }

    function finishPaneDragFromPointer(event) {
      if (!paneDrag || event.pointerId !== paneDrag.pointerId) return;
      paneDrag.latestY = event.clientY;
      if (paneDrag.frame) {
        global.cancelAnimationFrame(paneDrag.frame);
        paneDrag.frame = 0;
      }
      paneDrag.rects = measurePaneDragRects();
      updatePaneDragPreview(paneDrag.latestY);
      finishPaneDrag(true);
    }

    function handlePaneDragKeydown(event) {
      if (event.key !== "Escape" || !paneDrag) return;
      event.preventDefault();
      cancelPaneDrag();
    }

    function handlePaneDragVisibilityChange() {
      if (document.hidden) cancelPaneDrag();
    }

    function updatePaneDragPreview(clientY) {
      if (!paneDrag) return;
      const remaining = paneDrag.originalOrder.filter((groupId) => groupId !== paneDrag.groupId);
      let targetIndex = remaining.length;
      for (let index = 0; index < remaining.length; index += 1) {
        const rect = paneDrag.rects.get(remaining[index]);
        if (rect && clientY < rect.top + rect.height / 2) {
          targetIndex = index;
          break;
        }
      }
      const previewOrder = movePaneInOrder(paneDrag.originalOrder, paneDrag.groupId, targetIndex);
      if (previewOrder.join("|") === paneDrag.previewOrder.join("|")) return;
      paneDrag.previewOrder = previewOrder;
      const nextGroupId = remaining[targetIndex];
      const nextElement = nextGroupId ? groupControllers.get(nextGroupId)?.element : null;
      if (nextElement) options.stack.insertBefore(paneDrag.placeholder, nextElement);
      else options.stack.appendChild(paneDrag.placeholder);
    }

    function schedulePaneDragFrame() {
      if (!paneDrag || paneDrag.frame) return;
      paneDrag.frame = global.requestAnimationFrame(runPaneDragFrame);
    }

    function runPaneDragFrame() {
      if (!paneDrag) return;
      paneDrag.frame = 0;
      let scrollVelocity = paneDragScrollVelocity(paneDrag.latestY, global.innerHeight);
      const root = document.documentElement;
      const maxScrollY = Math.max(0, (root?.scrollHeight || 0) - global.innerHeight);
      const scrollY = global.scrollY || root?.scrollTop || 0;
      if ((scrollVelocity < 0 && scrollY <= 0) || (scrollVelocity > 0 && scrollY >= maxScrollY)) scrollVelocity = 0;
      if (scrollVelocity) {
        const before = global.scrollY || root?.scrollTop || 0;
        global.scrollBy(0, scrollVelocity);
        const after = global.scrollY || root?.scrollTop || 0;
        if (after !== before) paneDrag.rects = measurePaneDragRects();
        else scrollVelocity = 0;
      }
      updatePaneDragPreview(paneDrag.latestY);
      if (scrollVelocity) schedulePaneDragFrame();
    }

    function updatePaneDrag(event) {
      if (!paneDrag || event.pointerId !== paneDrag.pointerId) return;
      if (event.buttons === 0) {
        cancelPaneDrag();
        return;
      }
      event.preventDefault();
      paneDrag.latestY = event.clientY;
      paneDrag.latestX = event.clientX;
      paneDrag.ghost.style.left = `${Math.min(global.innerWidth - paneDrag.ghost.offsetWidth - 8, Math.max(8, event.clientX + 14))}px`;
      paneDrag.ghost.style.top = `${Math.min(global.innerHeight - paneDrag.ghost.offsetHeight - 8, Math.max(8, event.clientY + 14))}px`;
      schedulePaneDragFrame();
    }

    function startPaneDrag(id, event) {
      const groupId = CHIP_PANE_GROUPS.some((group) => group.id === id) ? id : groupForPane(id);
      if (mode !== "B" || event.button !== 0 || !groupControllers.has(groupId)) return;
      cancelPaneDrag();
      event.preventDefault();
      event.stopPropagation();
      const originalOrder = desiredGroupIds();
      const groupController = groupControllers.get(groupId);
      const groupDefinition = CHIP_PANE_GROUPS.find((group) => group.id === groupId);
      const placeholder = document.createElement("div");
      placeholder.className = "chip-pane-group-placeholder";
      const groupRect = groupController.element.getBoundingClientRect();
      placeholder.style.height = `${groupRect.height}px`;
      const ghost = document.createElement("div");
      ghost.className = "chip-pane-group-ghost";
      const paneCount = desiredPaneIds().filter((paneId) => groupForPane(paneId) === groupId).length;
      ghost.textContent = `${groupDefinition?.label || groupId}・${paneCount} 個副圖`;
      document.body.appendChild(ghost);
      groupController.element.after(placeholder);
      paneDrag = {
        groupId,
        pointerId: event.pointerId,
        originalOrder,
        previewOrder: [...originalOrder],
        rects: new Map(originalOrder.map((item) => [item, groupControllers.get(item)?.element.getBoundingClientRect()])),
        placeholder,
        ghost,
        latestY: event.clientY,
        latestX: event.clientX,
        frame: 0,
      };
      paneDrag.rects = measurePaneDragRects();
      groupController.element.classList.add("is-dragging");
      options.stack.classList.add("is-pane-reordering");
      global.addEventListener("pointermove", updatePaneDrag, true);
      global.addEventListener("pointerup", finishPaneDragFromPointer, true);
      global.addEventListener("pointercancel", cancelPaneDrag, true);
      global.addEventListener("blur", cancelPaneDrag);
      document.addEventListener("keydown", handlePaneDragKeydown, true);
      document.addEventListener("visibilitychange", handlePaneDragVisibilityChange);
      global.addEventListener("resize", cancelPaneDrag);
      updatePaneDrag(event);
    }

    function notifyPresentation() {
      options.onPresentationChange?.({
        mode: presentationModeForChipMode(mode),
        modeASlotKind: selection.modeASlotKind,
        paneIds: desiredPaneIds(),
      });
    }

    function updateInputs() {
      for (const input of options.inputs) input.checked = desiredPaneIds().includes(input.value);
      for (const input of options.groupInputs || []) {
        const state = groupSelectionState(input.value, selection.modeBSelectedPaneIds);
        input.checked = state === "checked";
        input.indeterminate = state === "indeterminate";
        input.disabled = mode !== "B";
        input.setAttribute("aria-checked", state === "indeterminate" ? "mixed" : String(state === "checked"));
        input.title = mode === "B" ? "勾選或取消整個資料群組" : "單一副圖模式請分別選擇子項目";
      }
      options.stack.dataset.chipMode = presentationModeForChipMode(mode);
      notifyPresentation();
    }

    function persist() {
      writeSelection(context.tabId, context.symbol, selection);
    }

    function removePane(id) {
      if (["big-holder", "retail-holder", "tdcc-holder-count"].includes(id)) stopBackfillPolling();
      if (mode === "A") {
        selection.modeASlotKind = "technical";
        persist();
        reconcile();
        return;
      }
      selection.modeBSelectedPaneIds = selection.modeBSelectedPaneIds.filter((item) => item !== id);
      persist();
      reconcile();
    }

    function updateSeriesSelection(paneId, seriesIds) {
      if (paneId === "dealer-flow" && (!Array.isArray(seriesIds) || seriesIds.length === 0)) return;
      selection.seriesByPane = { ...selection.seriesByPane, [paneId]: [...seriesIds] };
      persist();
    }

    async function requestBackfill(paneId) {
      const definition = CHIP_PANE_REGISTRY.find((item) => item.id === paneId);
      const requestSymbol = context.symbol;
      const range = rangeForCandles(context.candles);
      const datasets = datasetsForDefinition(definition || {});
      const response = await fetch("/api/taiwan-stock-chip/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: requestSymbol, datasets, start: range.start, end: range.end }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "回補要求失敗");
      if (requestSymbol === context.symbol) {
        invalidateChipRequestCache(requestSymbol);
        clearTimeout(reloadTimer);
        if (["started", "already-running", "cooldown"].includes(result.status) && datasets.includes("shareholder-distribution")) {
          startBackfillPolling(requestSymbol);
        } else {
          reloadTimer = setTimeout(() => {
            if (requestSymbol === context.symbol && mode !== "none") load();
          }, result.status === "accepted" ? 1800 : 400);
        }
      }
      return result;
    }

    function reconcile() {
      cancelPaneDrag();
      const suspended = mode === "none";
      if (suspended) {
        generation += 1;
        clearTimeout(reloadTimer);
        stopBackfillPolling();
        abortController?.abort();
        abortController = undefined;
        payload = undefined;
        setNotice("");
      }
      const desired = new Set(desiredPaneIds());
      for (const [id, controller] of controllers) if (!desired.has(id)) { controller.destroy(); controllers.delete(id); }
      for (const groupId of desiredGroupIds()) ensureGroupController(groupId);
      for (const definition of CHIP_PANE_REGISTRY) {
        if (!desired.has(definition.id) || controllers.has(definition.id)) continue;
        const controller = createPaneController(definition, {
          stack: ensureGroupController(groupForPane(definition.id))?.body || options.stack,
          interactionMode: mode,
          axisSafeWidth: options.getAxisSafeWidth?.(),
          onRemove: removePane,
          canPinToTop: canPinPaneToTop,
          onPinToTop: pinPaneToTop,
          canPinToBottom: canPinPaneToBottom,
          onPinToBottom: pinPaneToBottom,
          canMove: canMovePane,
          onMove: movePane,
          onDragStart: startPaneDrag,
          getSeriesSelection(paneId) { return selection.seriesByPane?.[paneId]; },
          onSeriesSelectionChange: updateSeriesSelection,
          onBackfill: requestBackfill,
          onExport: options.onExport,
          getMainRange: options.getMainRange,
          onLayoutChange: options.onLayoutChange,
          onReadoutReservationChange: scheduleChipReadoutCohorts,
          onRange(range, paneId, timeRange) { if (!syncing) options.onRange?.(range, paneId, timeRange); },
          onViewportIntent(intent) { options.onViewportIntent?.(intent); },
          onCrosshair(pointer, paneId) { if (!syncing) options.onCrosshair?.(pointer, paneId); },
        });
        controllers.set(definition.id, controller);
      }
      for (const id of desiredPaneIds()) {
        const controller = controllers.get(id);
        if (controller) {
          controller.syncSeriesControls();
          controller.setInteractionMode(mode);
        }
      }
      applyControllerOrder();
      for (const [groupId, groupController] of groupControllers) {
        if (desiredGroupIds().includes(groupId)) continue;
        groupController.destroy();
        groupControllers.delete(groupId);
      }
      options.stack.hidden = controllers.size === 0;
      options.panel?.classList.toggle("has-chip-panes", controllers.size > 0);
      updateInputs();
      if (payload) for (const controller of controllers.values()) controller.render(payload, context.candles);
      if (!suspended) load();
      options.onLayoutChange?.();
      scheduleChipReadoutCohorts();
    }

    async function load() {
      const current = ++generation;
      abortController?.abort();
      abortController = undefined;
      if (mode === "none") {
        payload = undefined;
        setNotice("");
        return;
      }
      abortController = new AbortController();
      payload = undefined;
      const datasets = [...new Set(desiredPaneIds().flatMap((id) => datasetsForDefinition(CHIP_PANE_REGISTRY.find((item) => item.id === id) || {})))];
      if (!controllers.size || !context.symbol || !context.candles.length || context.interval !== "1d" || !/\.TW(O)?$/.test(context.symbol)) {
        options.stack.classList.toggle("chip-state-unavailable", Boolean(controllers.size));
        setNotice(controllers.size ? (context.interval !== "1d" ? "籌碼副圖只支援日 K" : "此商品沒有可載入的台股證券籌碼資料") : "");
        for (const controller of controllers.values()) controller.render({ rows: [], distributionRows: [], availability: {} }, context.candles);
        return;
      }
      options.stack.classList.remove("chip-state-unavailable");
      setNotice("籌碼資料載入中");
      try {
        const result = await sharedChipRequest({ ...context, datasets, signal: abortController.signal });
        if (current !== generation) return;
        payload = result;
        const warningText = warningMessages(result.warnings);
        if (!warningText.length) dismissedNoticeSignature = "";
        setNotice(warningText, { dismissible: true, signature: warningNoticeSignature(context, warningText) });
        for (const controller of controllers.values()) controller.render(payload, context.candles);
      } catch (error) {
        if (error?.name === "AbortError" || current !== generation) return;
        setNotice(`籌碼資料暫時不可用：${error?.message || "請稍後重試"}`);
        for (const controller of controllers.values()) controller.render({ rows: [], distributionRows: [], availability: {} }, context.candles);
      }
    }

    for (const input of options.inputs) input.addEventListener("change", () => {
      if (mode === "none") {
        updateInputs();
        return;
      }
      if (mode === "A") {
        if (!input.checked) { input.checked = true; return; }
        selection.modeASlotKind = "chip";
        selection.modeAActivePaneId = input.value;
      } else {
        const ids = new Set(selection.modeBSelectedPaneIds);
        if (input.checked) ids.add(input.value); else ids.delete(input.value);
        selection.modeBPaneOrder = normalizePaneOrder(selection.modeBPaneOrder, [...ids]);
        selection.modeBSelectedPaneIds = paneIdsForGroupOrder(selection.modeBGroupOrder, [...ids]);
      }
      persist();
      reconcile();
    });

    for (const input of options.groupInputs || []) input.addEventListener("change", () => {
      if (mode !== "B") {
        updateInputs();
        return;
      }
      selection.modeBSelectedPaneIds = toggleGroupSelection(input.value, selection.modeBSelectedPaneIds, input.checked);
      selection.modeBGroupOrder = normalizeGroupOrder(selection.modeBGroupOrder, selection.modeBPaneOrder, selection.modeBSelectedPaneIds);
      persist();
      reconcile();
    });

    manager = {
      setContext(next) {
        const previousRange = rangeForCandles(context.candles);
        const nextRange = rangeForCandles(next.candles || context.candles);
        const identityChanged = context.symbol !== next.symbol || context.tabId !== next.tabId;
        const dataChanged = identityChanged || context.interval !== next.interval || previousRange.start !== nextRange.start || previousRange.end !== nextRange.end;
        context = { ...context, ...next };
        if (identityChanged) {
          cancelPaneDrag();
          clearTimeout(reloadTimer);
          stopBackfillPolling();
          for (const controller of controllers.values()) controller.closeOverlays?.();
          selection = readSelection(context.tabId, context.symbol);
        }
        if (dataChanged) reconcile();
      },
      updateCandles(candles) {
        const nextCandles = Array.isArray(candles) ? candles : [];
        const previousRange = rangeForCandles(context.candles);
        const nextRange = rangeForCandles(nextCandles);
        context = { ...context, candles: nextCandles };
        if (previousRange.start === nextRange.start && previousRange.end === nextRange.end) return;
        for (const controller of controllers.values()) controller.setCandles(nextCandles);
        scheduleChipReadoutCohorts();
      },
      setMode(nextMode) { const normalized = normalizeChipPaneMode(nextMode); if (mode === normalized) { updateInputs(); return; } cancelPaneDrag(); mode = normalized; reconcile(); },
      activateTechnicalSlot() {
        if (mode !== "A" || selection.modeASlotKind === "technical") return;
        selection.modeASlotKind = "technical";
        persist();
        reconcile();
      },
      syncRange(range) { syncing = true; for (const controller of mountedControllers()) controller.syncRange(range); syncing = false; },
      syncTimeRange(range) { syncing = true; for (const controller of mountedControllers()) controller.syncTimeRange(range); syncing = false; },
      alignCoordinates(time, mainScreenX, mainRange, tolerance = 1) { syncing = true; for (const controller of mountedControllers()) controller.alignCoordinate(time, mainScreenX, mainRange, tolerance); syncing = false; },
      syncCrosshair(time) { syncing = true; for (const controller of mountedControllers()) controller.setCrosshair(time); syncing = false; },
      clearCrosshair() { syncing = true; for (const controller of mountedControllers()) controller.clearCrosshair(); syncing = false; },
      showReadouts(time) { for (const controller of mountedControllers()) controller.showReadout(time); },
      restoreLatestReadouts() { for (const controller of mountedControllers()) controller.restoreLatestReadout(); },
      measureCoordinates(time) { return mountedControllers().map((controller) => controller.measureCoordinate(time)); },
      plotRects() { return mountedControllers().map((controller) => controller.plotRect()); },
      measureAxisSafeWidth() { return Math.max(0, ...mountedControllers().map((controller) => controller.measureAxisSafeWidth())); },
      setAxisSafeWidth(width) { for (const controller of mountedControllers()) controller.setAxisSafeWidth(width); },
      setInteractionMode(nextMode) { const normalized = normalizeChipPaneMode(nextMode); if (normalized === "none") return; for (const controller of controllers.values()) controller.setInteractionMode(normalized); },
      resize() { for (const controller of mountedControllers()) controller.resize(); },
      reservationMode() { return mode; },
      panelRect() { return options.panel?.getBoundingClientRect?.(); },
      readoutReservations() {
        const ordered = desiredPaneIds();
        return ordered.flatMap((paneId, index) => {
          const controller = controllers.get(paneId);
          return controller ? [controller.reservationReport(ordered.slice(0, index + 1).join(","))] : [];
        });
      },
      clearCohortReservations() { for (const controller of controllers.values()) controller.clearCohortReservation(); },
      geometryReport() {
        const ordered = desiredPaneIds();
        const panelRect = options.panel?.getBoundingClientRect?.();
        return ordered.flatMap((paneId, index) => {
          const controller = controllers.get(paneId);
          if (!controller) return [];
          const geometry = controller.geometryReport();
          const nextController = controllers.get(ordered[index + 1]);
          const nextPaneTop = nextController?.element?.getBoundingClientRect?.().top ?? null;
          return [{ ...geometry, nextPaneTop, panelHeight: panelRect?.height ?? null }];
        });
      },
      report() { return { mode: presentationModeForChipMode(mode), chipMode: mode, modeASlotKind: selection.modeASlotKind, paneIds: desiredPaneIds(), modeBPaneOrder: [...selection.modeBPaneOrder], modeBGroupOrder: [...selection.modeBGroupOrder], seriesByPane: structuredClone(selection.seriesByPane), controllerCount: controllers.size, mountedControllerCount: mountedControllers().length, symbol: context.symbol, interval: context.interval }; },
      destroy() { generation += 1; cancelPaneDrag(); clearTimeout(reloadTimer); stopBackfillPolling(); CHIP_READOUT_RESERVATION_MANAGERS.delete(manager); abortController?.abort(); options.noticeClose?.removeEventListener("click", closeNotice); for (const controller of controllers.values()) controller.destroy(); controllers.clear(); for (const groupController of groupControllers.values()) groupController.destroy(); groupControllers.clear(); options.panel?.classList.remove("has-chip-panes"); scheduleChipReadoutCohorts(); },
    };
    CHIP_READOUT_RESERVATION_MANAGERS.add(manager);
    return manager;
  }

  global.QuoteChartChipPanes = {
    CHIP_PANE_REGISTRY,
    CHIP_PANE_GROUPS,
    DEFAULT_MODE_B_PANES,
    availabilityLabel,
    createChipPaneManager,
    isEligibleContext,
    requestData: sharedChipRequest,
    __test: {
      backfillMenuState,
      backfillCoverageState,
      dailyDetailModel,
      detailItemsForPane,
      groupForPane,
      groupSelectionState,
      holderAggregate,
      holderDetailModel,
      invalidateChipRequestCache,
      movePaneInOrder,
      migrateModeBSelectedPaneIds,
      normalizeChipPaneMode,
      normalizeGroupOrder,
      normalizePaneOrder,
      paneDragScrollVelocity,
      paneIdsForGroupOrder,
      readSelection,
      selectionStorageKey,
      chipReadoutLayoutSignature,
      readoutEnvelopeCandidates,
      readoutSegmentText,
      seriesColorForReadout,
      shouldShowWarningNotice,
      shortMarginRatioPercent,
      shortMarginRatioRows,
      shouldContinueBackfillPolling,
      toggleGroupSelection,
      warningColorForText,
      warningMessages,
      warningNoticeSignature,
    },
  };
})(window);
