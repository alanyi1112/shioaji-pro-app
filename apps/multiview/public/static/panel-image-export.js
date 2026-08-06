(function initPanelImageExporter(global) {
  "use strict";

  const DEFAULT_MAX_PIXELS = 32_000_000;
  const DEFAULT_MAX_DIMENSION = 16_384;
  const EXPORT_FRAME_INSET = 1;
  const EXCLUDE_SELECTOR = [
    "[data-export-exclude]",
    ".chip-pane-group-ghost",
    ".chip-pane-group-placeholder",
    ".indicator-options",
    ".fixed-profile-settings",
    ".is-pane-reordering",
  ].join(",");

  function safeFilenamePart(value, fallback) {
    const normalized = String(value || "").trim().replace(/[^0-9A-Za-z._-]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized || fallback;
  }

  function filenameForPanel(symbol, interval, now = new Date()) {
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    return `${safeFilenamePart(symbol, "chart")}_${safeFilenamePart(interval, "interval")}_${timestamp}.png`;
  }

  function visibleDescendantBounds(panel, panelRect) {
    let right = Math.max(0, panelRect.width || 0);
    let bottom = Math.max(0, panelRect.height || 0);
    const descendants = panel.querySelectorAll?.("*") || [];
    for (const element of descendants) {
      if (element.hidden || element.matches?.(EXCLUDE_SELECTOR) || element.closest?.(EXCLUDE_SELECTOR) || element.closest?.("[hidden]")) continue;
      const rect = element.getBoundingClientRect?.();
      if (!rect || (!rect.width && !rect.height)) continue;
      right = Math.max(right, rect.right - panelRect.left);
      bottom = Math.max(bottom, rect.bottom - panelRect.top);
    }
    return { right, bottom };
  }

  function captureDimensions(panel, options = {}) {
    const rect = panel.getBoundingClientRect();
    const paintedBounds = visibleDescendantBounds(panel, rect);
    const width = Math.max(1, Math.ceil(Math.max(rect.width, panel.scrollWidth || 0, paintedBounds.right)));
    const height = Math.max(1, Math.ceil(Math.max(rect.height, panel.scrollHeight || 0, paintedBounds.bottom)));
    const requestedScale = Math.max(1, Number(options.pixelRatio || global.devicePixelRatio || 1));
    const maxPixels = Math.max(1, Number(options.maxPixels || DEFAULT_MAX_PIXELS));
    const maxDimension = Math.max(1, Number(options.maxDimension || DEFAULT_MAX_DIMENSION));
    const scale = Math.min(
      requestedScale,
      maxDimension / width,
      maxDimension / height,
      Math.sqrt(maxPixels / (width * height)),
    );
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("線圖尺寸超過可匯出上限");
    return { width, height, scale, outputWidth: Math.max(1, Math.floor(width * scale)), outputHeight: Math.max(1, Math.floor(height * scale)) };
  }

  function copyComputedStyle(source, target) {
    const computed = global.getComputedStyle(source);
    let cssText = "";
    for (const property of computed) cssText += `${property}:${computed.getPropertyValue(property)};`;
    target.setAttribute("style", cssText);
  }

  function cloneNodeForExport(source) {
    if (source.nodeType === 3) return document.createTextNode(source.nodeValue || "");
    if (source.nodeType !== 1) return document.createTextNode("");
    if (source.matches(EXCLUDE_SELECTOR)) return document.createTextNode("");
    let target;
    if (source instanceof HTMLCanvasElement) {
      target = document.createElement("img");
      target.src = source.toDataURL("image/png");
      target.alt = "";
      target.width = source.width;
      target.height = source.height;
    } else {
      target = source.cloneNode(false);
    }
    copyComputedStyle(source, target);
    if (source instanceof HTMLInputElement) {
      target.setAttribute("value", source.value);
      if (source.checked) target.setAttribute("checked", "checked");
      else target.removeAttribute("checked");
    } else if (source instanceof HTMLTextAreaElement) {
      target.textContent = source.value;
    } else if (source instanceof HTMLSelectElement) {
      [...source.options].forEach((option, index) => {
        if (option.selected) target.options[index]?.setAttribute("selected", "selected");
        else target.options[index]?.removeAttribute("selected");
      });
    }
    if (!(source instanceof HTMLCanvasElement)) {
      for (const child of source.childNodes) target.appendChild(cloneNodeForExport(child));
    }
    return target;
  }

  function serializePanel(panel, dimensions) {
    const clone = cloneNodeForExport(panel);
    clone.classList.remove("is-hovered", "is-exporting");
    clone.style.width = `${dimensions.width}px`;
    clone.style.height = `${dimensions.height}px`;
    clone.style.maxHeight = "none";
    clone.style.overflow = "visible";
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    return new XMLSerializer().serializeToString(clone);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 編碼失敗")), "image/png");
    });
  }

  function nextPaint(signal) {
    return new Promise((resolve, reject) => {
      global.requestAnimationFrame(() => global.requestAnimationFrame(() => {
        if (signal?.aborted) reject(new DOMException("匯出已取消", "AbortError"));
        else resolve();
      }));
    });
  }

  function captureFrameStyle(panel) {
    const computed = global.getComputedStyle(panel);
    return {
      borderTop: computed.borderTop,
      borderRight: computed.borderRight,
      borderBottom: computed.borderBottom,
      borderLeft: computed.borderLeft,
      borderRadius: computed.borderRadius,
    };
  }

  function appendExportFrame(clonedDocument, clonedPanel, dimensions, frameStyle) {
    const frame = clonedDocument.createElement("div");
    frame.dataset.panelExportFrame = "";
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: `${Math.max(1, dimensions.width - (EXPORT_FRAME_INSET * 2))}px`,
      height: `${Math.max(1, dimensions.height - (EXPORT_FRAME_INSET * 2))}px`,
      boxSizing: "border-box",
      borderTop: frameStyle.borderTop,
      borderRight: frameStyle.borderRight,
      borderBottom: frameStyle.borderBottom,
      borderLeft: frameStyle.borderLeft,
      borderRadius: frameStyle.borderRadius,
      background: "transparent",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    clonedPanel.appendChild(frame);
    return frame;
  }

  async function renderPanelBlob(panel, options = {}) {
    if (!panel?.isConnected) throw new Error("找不到要匯出的商品線圖");
    if (options.signal?.aborted) throw new DOMException("匯出已取消", "AbortError");
    if (typeof global.html2canvas !== "function") throw new Error("圖片匯出元件尚未載入");
    const dimensions = captureDimensions(panel, options);
    const frameStyle = captureFrameStyle(panel);
    const exportToken = `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    panel.dataset.panelExportToken = exportToken;
    let canvas;
    try {
      canvas = await global.html2canvas(panel, {
        allowTaint: false,
        backgroundColor: global.getComputedStyle(panel).backgroundColor || "#111827",
        foreignObjectRendering: false,
        height: dimensions.height,
        ignoreElements: (element) => element.matches?.(EXCLUDE_SELECTOR),
        logging: false,
        onclone: (clonedDocument) => {
          const clonedPanel = clonedDocument.querySelector(`[data-panel-export-token="${exportToken}"]`);
          if (!clonedPanel) return;
          clonedPanel.style.maxHeight = "none";
          clonedPanel.style.overflow = "visible";
          clonedPanel.style.borderColor = "transparent";
          appendExportFrame(clonedDocument, clonedPanel, dimensions, frameStyle);
        },
        removeContainer: true,
        scale: dimensions.scale,
        useCORS: true,
        width: dimensions.width,
        windowHeight: global.innerHeight,
        windowWidth: global.innerWidth,
      });
    } finally {
      delete panel.dataset.panelExportToken;
    }
    if (options.signal?.aborted) throw new DOMException("匯出已取消", "AbortError");
    return { blob: await canvasToBlob(canvas), dimensions };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      global.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  async function exportPanelImage(options) {
    const { panel, signal } = options || {};
    panel?.classList.add("is-exporting");
    try {
      await nextPaint(signal);
      const result = await renderPanelBlob(panel, options);
      const filename = filenameForPanel(options.symbol, options.interval, options.now);
      downloadBlob(result.blob, filename);
      return { ...result, filename, mimeType: result.blob.type };
    } finally {
      panel?.classList.remove("is-exporting");
    }
  }

  global.QuoteChartPanelImageExporter = {
    exportPanelImage,
    __test: {
      appendExportFrame,
      captureDimensions,
      captureFrameStyle,
      filenameForPanel,
      safeFilenamePart,
      serializePanel,
      visibleDescendantBounds,
    },
  };
})(window);
