import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/static/panel-image-export.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/static/app.js", import.meta.url), "utf8");
const window = { devicePixelRatio: 2 };
vm.runInNewContext(source, { window, Date, Math, DOMException });
const { appendExportFrame, captureDimensions, captureFrameStyle, filenameForPanel, safeFilenamePart } = window.QuoteChartPanelImageExporter.__test;

test("PNG 檔名使用安全 symbol、interval 與固定時間戳", () => {
  const now = new Date("2026-07-20T04:05:06.789Z");
  assert.equal(filenameForPanel("2330.TW", "1d", now), "2330.TW_1d_2026-07-20T04-05-06-789Z.png");
  assert.equal(safeFilenamePart("../../台積電 / 2330", "chart"), "..-..-2330");
  assert.equal(safeFilenamePart("", "chart"), "chart");
});

test("匯出尺寸採完整 scroll height 並受最大像素與最大邊長限制", () => {
  const panel = {
    scrollWidth: 900,
    scrollHeight: 4200,
    getBoundingClientRect: () => ({ width: 860, height: 700 }),
  };
  const full = JSON.parse(JSON.stringify(captureDimensions(panel, { pixelRatio: 2, maxPixels: 40_000_000, maxDimension: 16_384 })));
  assert.equal(full.width, 900);
  assert.equal(full.height, 4200);
  assert.equal(full.outputWidth, 1800);
  assert.equal(full.outputHeight, 8400);

  const capped = captureDimensions(panel, { pixelRatio: 4, maxPixels: 4_000_000, maxDimension: 4096 });
  assert.ok(capped.outputWidth * capped.outputHeight <= 4_000_000);
  assert.ok(capped.outputHeight <= 4096);
});

test("匯出尺寸涵蓋超出 scrollHeight 的可見群組後代並只等比例縮放", () => {
  const descendant = (rect, excluded = false) => ({
    hidden: false,
    matches: () => excluded,
    closest: () => null,
    getBoundingClientRect: () => rect,
  });
  const panel = {
    scrollWidth: 900,
    scrollHeight: 1800,
    getBoundingClientRect: () => ({ left: 100, top: 200, right: 1000, bottom: 900, width: 900, height: 700 }),
    querySelectorAll: () => [
      descendant({ left: 100, top: 1700, right: 1000, bottom: 2050, width: 900, height: 350 }),
      descendant({ left: 100, top: 2050, right: 1120, bottom: 2600, width: 1020, height: 550 }),
      descendant({ left: 100, top: 2600, right: 1120, bottom: 3000, width: 1020, height: 400 }),
      descendant({ left: 100, top: 3000, right: 1200, bottom: 3400, width: 1100, height: 400 }, true),
    ],
  };

  const full = captureDimensions(panel, { pixelRatio: 2, maxPixels: 40_000_000, maxDimension: 16_384 });
  assert.equal(full.width, 1020);
  assert.equal(full.height, 2800);
  assert.equal(full.outputWidth, 2040);
  assert.equal(full.outputHeight, 5600);

  const capped = captureDimensions(panel, { pixelRatio: 4, maxPixels: 4_000_000, maxDimension: 4096 });
  assert.equal(capped.width, 1020);
  assert.equal(capped.height, 2800);
  assert.ok(capped.outputWidth * capped.outputHeight <= 4_000_000);
  assert.ok(Math.abs((capped.outputWidth / capped.outputHeight) - (1020 / 2800)) < 0.002);
});

test("匯出 clone 以最上層 frame 保留四側框線與完整圓角", () => {
  const frameStyle = {
    borderTop: "1px solid rgb(56, 189, 248)",
    borderRight: "1px solid rgb(56, 189, 248)",
    borderBottom: "1px solid rgb(56, 189, 248)",
    borderLeft: "1px solid rgb(56, 189, 248)",
    borderRadius: "8px",
  };
  const appended = [];
  const clonedPanel = { appendChild: (node) => appended.push(node) };
  const clonedDocument = {
    createElement: () => ({ dataset: {}, style: {}, setAttribute(name, value) { this[name] = value; } }),
  };

  const frame = appendExportFrame(clonedDocument, clonedPanel, { width: 1481, height: 1595 }, frameStyle);

  assert.equal(appended.length, 1);
  assert.equal(frame.dataset.panelExportFrame, "");
  assert.equal(frame["aria-hidden"], "true");
  assert.equal(frame.style.position, "absolute");
  assert.equal(frame.style.top, "0");
  assert.equal(frame.style.left, "0");
  assert.equal(frame.style.width, "1479px");
  assert.equal(frame.style.height, "1593px");
  assert.equal(frame.style.borderTop, frameStyle.borderTop);
  assert.equal(frame.style.borderRight, frameStyle.borderRight);
  assert.equal(frame.style.borderBottom, frameStyle.borderBottom);
  assert.equal(frame.style.borderLeft, frameStyle.borderLeft);
  assert.equal(frame.style.borderRadius, "8px");
  assert.equal(frame.style.pointerEvents, "none");
  assert.equal(frame.style.zIndex, "2147483647");
});

test("匯出 frame 從 live panel 複製四側 computed border 與圓角", () => {
  window.getComputedStyle = () => ({
    borderTop: "1px solid top",
    borderRight: "2px dashed right",
    borderBottom: "3px dotted bottom",
    borderLeft: "4px double left",
    borderRadius: "8px",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(captureFrameStyle({}))), {
    borderTop: "1px solid top",
    borderRight: "2px dashed right",
    borderBottom: "3px dotted bottom",
    borderLeft: "4px double left",
    borderRadius: "8px",
  });
});

test("exporter 置換 Canvas、排除暫態 UI、只序列化指定 panel 且不含上傳路徑", () => {
  assert.match(source, /source instanceof HTMLCanvasElement/);
  assert.match(source, /source\.toDataURL\("image\/png"\)/);
  assert.match(source, /\[data-export-exclude\]/);
  assert.match(source, /if \(source\.matches\(EXCLUDE_SELECTOR\)\) return document\.createTextNode\(""\)/);
  assert.match(appSource, /class: "chart-annotation-fibonacci-price-guide"[\s\S]*?"data-export-exclude": ""/);
  assert.match(appSource, /圖片已儲存：\$\{result\.filename\}/);
  assert.match(source, /\.chip-pane-group-ghost/);
  assert.match(source, /\.indicator-options/);
  assert.match(source, /serializePanel\(panel, dimensions\)/);
  assert.match(source, /panel\.scrollHeight/);
  assert.match(source, /visibleDescendantBounds\(panel, rect\)/);
  assert.match(source, /rect\.bottom - panelRect\.top/);
  assert.match(source, /onclone: \(clonedDocument\)/);
  assert.match(source, /clonedPanel\.style\.overflow = "visible"/);
  assert.match(source, /clonedPanel\.style\.borderColor = "transparent"/);
  assert.match(source, /appendExportFrame\(clonedDocument, clonedPanel, dimensions, frameStyle\)/);
  assert.match(source, /frame\.dataset\.panelExportFrame = ""/);
  assert.match(source, /windowHeight: global\.innerHeight/);
  assert.match(source, /windowWidth: global\.innerWidth/);
  assert.doesNotMatch(source, /windowHeight: dimensions\.height/);
  assert.match(source, /new XMLSerializer\(\)\.serializeToString/);
  assert.match(source, /signal\?\.aborted/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /global\.html2canvas\(panel/);
  assert.match(source, /foreignObjectRendering: false/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
});
