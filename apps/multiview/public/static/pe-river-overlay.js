(function initPeRiverOverlay(global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const KEYS = ["p5", "p20", "p35", "p50", "p65", "p80", "p95"];
  const COLORS = ["#0ea5e9", "#22c55e", "#84cc16", "#eab308", "#fb923c", "#f97316", "#ef4444"];
  const FILLS = ["rgba(14,165,233,0.12)", "rgba(34,197,94,0.11)", "rgba(132,204,22,0.11)", "rgba(234,179,8,0.11)", "rgba(249,115,22,0.11)", "rgba(239,68,68,0.12)"];
  const POLL_DELAYS = [2500, 5000, 10000, 15000];

  function eligibleCandidate(symbol, interval) {
    const normalized = String(symbol || "").toUpperCase();
    if (interval !== "1d") return { supported: false, reason: "unsupported_interval" };
    if (!/^[0-9A-Z]{4,8}\.(TW|TWO)$/.test(normalized) || /^(00\d{2,4}|01\d{2,4})\.(TW|TWO)$/.test(normalized)) return { supported: false, reason: "not_eligible" };
    return { supported: true, reason: "supported" };
  }

  function svgNode(name, attributes = {}) {
    const node = document.createElementNS(NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function dateText(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (value && typeof value === "object" && "year" in value) return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  function splitSegments(points) {
    const segments = [];
    let segment = [];
    for (const point of points) {
      const previous = segment.at(-1);
      const gapDays = previous ? (Date.parse(`${point.sessionDate}T00:00:00Z`) - Date.parse(`${previous.sessionDate}T00:00:00Z`)) / 86400000 : 0;
      const missingCandle = previous && Number.isInteger(previous.candleIndex) && Number.isInteger(point.candleIndex)
        ? point.candleIndex - previous.candleIndex > 1
        : gapDays > 4;
      if (previous && missingCandle) {
        if (segment.length > 1) segments.push(segment);
        segment = [];
      }
      segment.push(point);
    }
    if (segment.length > 1) segments.push(segment);
    return segments;
  }

  function bandFor(segment, lowerKey, upperKey) {
    const upper = segment.map((point) => `${point.x},${point[upperKey]}`).join(" ");
    const lower = [...segment].reverse().map((point) => `${point.x},${point[lowerKey]}`).join(" ");
    return `${upper} ${lower}`;
  }

  function safeStatusText(payload) {
    if (payload.provisional?.status === "source_mismatch") return `本益比河流圖：來源核對不一致，已改用官方資料並停用暫代`;
    if (payload.status === "available" && payload.provisional?.dates?.length) return `本益比河流圖：${payload.coverage.validSamples} 筆（官方至 ${payload.coverage.verifiedEnd}；FinMind 暫代至 ${payload.coverage.displayEnd}，等待交易所確認）`;
    if (payload.status === "available") return `本益比河流圖：${payload.coverage.validSamples} 筆（${payload.coverage.start}～${payload.coverage.end}）`;
    if (payload.status === "insufficient_history") return `本益比河流圖：有效資料 ${payload.coverage?.validSamples || 0} 筆，至少需要 252 筆`;
    if (payload.status === "unsupported_interval") return "本益比河流圖僅支援日 K";
    if (payload.status === "not_eligible") return "此商品不適用本益比河流圖";
    if (payload.backfill?.reasonCode === "rate_limit_waiting") return "本益比河流圖：免費額度暫滿，背景回補稍後續跑";
    if (payload.backfill?.reasonCode === "official_not_published") return "本益比河流圖：等待交易所發布最新資料";
    if (payload.backfill?.reasonCode === "source_mismatch") return "本益比河流圖：來源核對不一致，保留既有資料";
    return "本益比河流圖資料準備中";
  }

  function bandLabel(close, prices) {
    if (!Number.isFinite(close)) return "--";
    if (close < prices.p5) return "P5 以下";
    if (close < prices.p20) return "P5–P20";
    if (close < prices.p35) return "P20–P35";
    if (close < prices.p50) return "P35–P50";
    if (close < prices.p65) return "P50–P65";
    if (close < prices.p80) return "P65–P80";
    if (close < prices.p95) return "P80–P95";
    return "P95 以上";
  }

  function lineLabelText(key, multiplier) {
    return `—${String(key || "").toUpperCase()} ${Number(multiplier).toFixed(2)}x—`;
  }

  function placeLineLabels(entries, height, labelHeight = 16, gap = 2) {
    if (!entries.length) return [];
    const minCenter = labelHeight / 2 + 2;
    const maxCenter = Math.max(minCenter, height - labelHeight / 2 - 2);
    const separation = Math.min(labelHeight + gap, entries.length > 1 ? (maxCenter - minCenter) / (entries.length - 1) : labelHeight + gap);
    const placed = entries
      .map((entry) => ({ ...entry, centerY: Math.max(minCenter, Math.min(maxCenter, entry.y)) }))
      .sort((left, right) => left.y - right.y);
    for (let index = 1; index < placed.length; index += 1) {
      placed[index].centerY = Math.max(placed[index].centerY, placed[index - 1].centerY + separation);
    }
    const overflow = placed.at(-1).centerY - maxCenter;
    if (overflow > 0) placed.forEach((entry) => { entry.centerY -= overflow; });
    for (let index = placed.length - 2; index >= 0; index -= 1) {
      placed[index].centerY = Math.min(placed[index].centerY, placed[index + 1].centerY - separation);
    }
    const underflow = minCenter - placed[0].centerY;
    if (underflow > 0) placed.forEach((entry) => { entry.centerY += underflow; });
    return placed;
  }

  function createController(options) {
    const { layer, statusNode, getSymbol, getInterval, getChart, getCandleSeries, getCandles, getLoadToken, onSettled } = options;
    let enabled = false;
    let payload = null;
    let requestToken = 0;
    let abortController;
    let pollTimer = 0;
    let pollAttempt = 0;
    let detailLines = [];

    function clearVisuals() {
      layer.replaceChildren();
      detailLines = [];
    }

    function cancel() {
      requestToken += 1;
      abortController?.abort();
      abortController = undefined;
      if (pollTimer) global.clearTimeout(pollTimer);
      pollTimer = 0;
      pollAttempt = 0;
      payload = null;
      clearVisuals();
      statusNode.hidden = true;
      statusNode.textContent = "";
    }

    async function load(isPolling = false) {
      const priorPollAttempt = pollAttempt;
      cancel();
      if (isPolling) pollAttempt = priorPollAttempt;
      if (!enabled) return;
      const symbol = getSymbol();
      const interval = getInterval();
      const candidate = eligibleCandidate(symbol, interval);
      if (!candidate.supported) {
        statusNode.hidden = false;
        statusNode.textContent = candidate.reason === "unsupported_interval" ? "本益比河流圖僅支援日 K" : "此商品不適用本益比河流圖";
        return;
      }
      const token = ++requestToken;
      const panelLoadToken = getLoadToken();
      abortController = new AbortController();
      statusNode.hidden = false;
      statusNode.textContent = "本益比河流圖載入中…";
      try {
        const response = await fetch(`/api/taiwan-stock-pe-river?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`, { signal: abortController.signal });
        const next = await response.json();
        if (!enabled || token !== requestToken || panelLoadToken !== getLoadToken() || symbol !== getSymbol() || interval !== getInterval()) return;
        payload = next;
        statusNode.textContent = safeStatusText(next);
        render();
        if (["queued", "running", "partial", "partial_data", "retry_waiting"].includes(next.backfill?.status) && pollAttempt < POLL_DELAYS.length) {
          pollTimer = global.setTimeout(() => { pollAttempt += 1; load(true); }, POLL_DELAYS[pollAttempt]);
        }
      } catch (error) {
        if (error?.name !== "AbortError" && enabled && token === requestToken) statusNode.textContent = "本益比河流圖暫時無法載入";
      } finally {
        if (enabled && token === requestToken) onSettled?.();
      }
    }

    function render() {
      layer.replaceChildren();
      if (!enabled || payload?.status !== "available") return;
      const chart = getChart();
      const series = getCandleSeries();
      if (!chart || !series) return;
      const width = layer.clientWidth;
      const height = layer.clientHeight;
      if (width <= 0 || height <= 0) return;
      const candleEntries = new Map((getCandles?.() || []).map((candle, index) => [dateText(candle.time), { index, time: candle.time }]));
      const projected = payload.points.flatMap((point) => {
        const candleEntry = candleEntries.get(point.sessionDate);
        if (!candleEntry) return [];
        const x = chart.timeScale().timeToCoordinate(candleEntry.time);
        if (!Number.isFinite(x) || x < -2 || x > width + 2) return [];
        const coordinates = Object.fromEntries(KEYS.map((key) => [key, series.priceToCoordinate(point.prices[key])]));
        if (KEYS.some((key) => !Number.isFinite(coordinates[key]))) return [];
        return [{ ...point, ...coordinates, x, candleIndex: candleEntry.index }];
      });
      const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": "本益比河流圖七條界線與六個歷史百分位區帶" });
      const defs = svgNode("defs");
      const clip = svgNode("clipPath", { id: `pe-river-clip-${Math.random().toString(36).slice(2)}` });
      clip.appendChild(svgNode("rect", { x: 0, y: 0, width: Math.max(0, width - 52), height }));
      defs.appendChild(clip);
      svg.appendChild(defs);
      const plot = svgNode("g", { "clip-path": `url(#${clip.id})` });
      const firstProvisional = projected.findIndex((point) => point.validationStatus === "finmind_provisional_latest");
      const verifiedProjected = firstProvisional < 0 ? projected : projected.slice(0, firstProvisional);
      const provisionalProjected = firstProvisional < 0 ? [] : projected.slice(Math.max(0, firstProvisional - 1));
      const appendSegments = (segments, provisional) => {
        for (const segment of segments) {
          for (let index = 0; index < KEYS.length - 1; index += 1) plot.appendChild(svgNode("polygon", { class: `pe-river-band pe-river-band-${index + 1}${provisional ? " pe-river-provisional" : ""}`, points: bandFor(segment, KEYS[index], KEYS[index + 1]), fill: FILLS[index], opacity: provisional ? 0.52 : 1 }));
          KEYS.forEach((key, index) => plot.appendChild(svgNode("polyline", { class: `pe-river-line pe-river-line-${key}${provisional ? " pe-river-provisional" : ""}`, points: segment.map((point) => `${point.x},${point[key]}`).join(" "), fill: "none", stroke: COLORS[index], "stroke-width": key === "p50" ? 1.4 : 1, "stroke-dasharray": provisional ? "5 4" : "none", opacity: provisional ? 0.72 : 1, "vector-effect": "non-scaling-stroke" })));
        }
      };
      appendSegments(splitSegments(verifiedProjected), false);
      appendSegments(splitSegments(provisionalProjected), true);
      const labelAnchor = projected.find((point) => point.x >= 0) || projected[0];
      if (labelAnchor) {
        const labelHeight = 16;
        const labelEntries = KEYS.flatMap((key, index) => {
          const y = Number(labelAnchor[key]);
          if (!Number.isFinite(y) || y < 0 || y > height) return [];
          const label = lineLabelText(key, payload.multipliers[key]);
          return [{ key, index, y, label, labelWidth: Math.max(74, Math.ceil(label.length * 6.2 + 10)) }];
        });
        placeLineLabels(labelEntries, height, labelHeight).forEach(({ key, index, y, label, labelWidth, centerY }) => {
          const leaderAnchor = projected.find((point) => point.x >= labelWidth + 20) || labelAnchor;
          plot.appendChild(svgNode("path", {
            class: `pe-river-level-leader pe-river-level-leader-${key}`,
            d: `M ${labelWidth + 6} ${centerY} L ${leaderAnchor.x} ${leaderAnchor[key] ?? y}`,
            fill: "none",
            stroke: COLORS[index],
            "stroke-width": 1,
            "vector-effect": "non-scaling-stroke",
          }));
          const group = svgNode("g", {
            class: `pe-river-level-label pe-river-level-label-${key}`,
            "data-pe-river-level": key,
            "aria-label": `${key.toUpperCase()} 歷史本益比 ${Number(payload.multipliers[key]).toFixed(2)} 倍`,
          });
          group.appendChild(svgNode("rect", {
            x: 6,
            y: centerY - labelHeight / 2,
            width: labelWidth,
            height: labelHeight,
            rx: 3,
            fill: "#0f172a",
            "fill-opacity": 0.86,
            stroke: COLORS[index],
            "stroke-width": 1,
            "vector-effect": "non-scaling-stroke",
          }));
          const text = svgNode("text", {
            x: 11,
            y: centerY,
            fill: COLORS[index],
            "font-size": 10,
            "font-weight": 700,
            "dominant-baseline": "middle",
          });
          text.textContent = label;
          group.appendChild(text);
          plot.appendChild(group);
        });
      }
      svg.appendChild(plot);
      layer.appendChild(svg);
    }

    function updateReadout(time, close) {
      detailLines = [];
      if (!enabled || payload?.status !== "available") {
        return;
      }
      const date = dateText(time);
      let point = payload.points.find((item) => item.sessionDate === date);
      let estimate = false;
      if (!point && date > String(payload.coverage.end || "")) {
        const latest = [...payload.points].reverse().find((item) => item.validationStatus !== "finmind_provisional_latest");
        if (latest) {
          point = { ...latest, sessionDate: date, officialPeRatio: Number(close) / latest.referenceEps, prices: Object.fromEntries(Object.entries(payload.multipliers).map(([key, multiplier]) => [key, latest.referenceEps * Number(multiplier)])) };
          estimate = true;
        }
      }
      if (!point) {
        return;
      }
      const fiscal = point.fiscalYear && point.fiscalQuarter ? `${point.fiscalYear} Q${point.fiscalQuarter}` : "未提供";
      const multiplierText = KEYS.map((key) => `${key.toUpperCase()} ${Number(payload.multipliers[key]).toFixed(2)}x`).join("　");
      const original = payload.sources?.find((source) => source.role === "original-provider");
      const intermediary = payload.sources?.find((source) => source.role === "historical-intermediary");
      const provisional = point.validationStatus === "finmind_provisional_latest";
      detailLines = [
        estimate ? `盤中估算本益比 ${Number(point.officialPeRatio).toFixed(2)}x` : provisional ? `FinMind 暫代本益比 ${Number(point.officialPeRatio).toFixed(2)}x` : `官方本益比 ${Number(point.officialPeRatio).toFixed(2)}x`,
        `${provisional ? "暫定參考 EPS" : "交易所參考 EPS"} ${Number(point.referenceEps).toFixed(2)}`,
        `財報 ${fiscal}`,
        multiplierText,
        `歷史區帶 ${bandLabel(Number(close), point.prices)}`,
        provisional ? `等待交易所確認；最後官方驗證日期 ${payload.provisional?.officialSourceDate || payload.coverage.verifiedEnd || "--"}` : `原資料提供機關：${original?.attribution || "交易所"} ${estimate ? `(沿用 ${payload.coverage.end} 參考 EPS)` : point.sourceDate}`,
        intermediary?.attribution || "歷史資料介接：FinMind",
        `授權 ${original?.license?.name || "政府資料開放授權條款－第1版"}`,
        `coverage 官方 ${payload.coverage.start}～${payload.coverage.verifiedEnd || payload.coverage.end}，顯示至 ${payload.coverage.displayEnd || payload.coverage.end}，${payload.coverage.validSamples} 筆`,
      ];
    }

    return {
      setEnabled(value) { enabled = Boolean(value); if (enabled) load(); else cancel(); },
      refreshContext() { if (enabled) load(); else cancel(); },
      render,
      updateReadout,
      clearReadout() { detailLines = []; },
      getDetailLines() { return [...detailLines]; },
      destroy() { enabled = false; cancel(); },
      getPayload() { return payload; },
    };
  }

  global.QuoteChartPeRiver = { createController, eligibleCandidate, splitSegments, __test: { bandFor, bandLabel, lineLabelText, placeLineLabels, safeStatusText } };
})(window);
