## Why

單一線圖使用「多層副圖」時，使用者在主圖或副圖圖表區轉動一般垂直滾輪，現行程式會把事件交給 Lightweight Charts 縮放時間軸；因此原本滿框的 `0～159` 可視邏輯範圍會擴張到負索引，產生左側空白與整體縮小。長頁面的主要意圖是垂直瀏覽所有副圖，一般滾輪不應改變圖表 viewport。

## What Changes

- 多層副圖模式下，主圖、技術副圖與籌碼副圖圖表區的一般垂直滾輪改為捲動瀏覽器 document。
- 一般捲頁前後 MUST 保留主圖與所有可見副圖的 visible logical range、bar spacing 與座標對齊。
- `Option/Alt + wheel` 改為明確的圖表滾輪縮放操作，保留需要以滾輪調整時間範圍的進階路徑。
- 主圖與單一副圖模式維持既有一般滾輪縮放行為；水平拖曳、pinch 與價格軸操作不變。
- 補上滾輪路由單元測試及單圖長頁面的真實捲動驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 修改多層副圖的 wheel 分流規則，使一般垂直滾輪優先捲頁並保持圖表 viewport，只有 `Option/Alt + wheel` 才交由圖表縮放。

## Impact

- 前端互動：`public/static/chart-interactions.js`，並沿用 `public/static/app.js`、`public/static/chip-panes.js` 的既有 routing 綁定。
- 測試：`tests/rendered-html.test.mjs` 與必要的互動回歸測試。
- 不變更 API、D1 schema、資料來源、背景排程、使用者資料或部署環境設定。
