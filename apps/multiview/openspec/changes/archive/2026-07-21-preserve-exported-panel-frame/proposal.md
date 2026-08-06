## Why

「儲存此商品所有線圖為圖片」產生的長圖會在右側遺失外框，右上與右下圓角也因此不完整。匯出圖片應完整呈現單一商品 panel 的四邊框線與四個圓角，不能因長圖 clone 採用 `overflow: visible` 而讓子圖內容覆蓋外框。

## What Changes

- 在匯出 clone 內建立只供圖片擷取使用的最上層完整框線，覆蓋 panel 的完整匯出寬高。
- 框線沿用當下 panel 的框線顏色、寬度與圓角，確保四邊與四角一致。
- 匯出專用框線不影響畫面中的 panel、不攔截互動，也不加入實際圖表內容或額外高度。
- 新增自動化回歸測試與實際 PNG 邊界像素驗證，確認右框及四個圓角完整。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `chart-panel-image-export`：補充匯出 PNG 必須保留完整四邊框線與四個圓角，且不得由子圖內容覆蓋。

## Impact

- 前端圖片匯出：`public/static/panel-image-export.js`
- 前端 cache-busting：`public/static/index.html`
- 自動化測試：`tests/panel-image-export.test.mjs`、必要的 rendered HTML contract
- 不變更 Worker API、行情資料、籌碼資料、持久化 schema 或外部服務。
