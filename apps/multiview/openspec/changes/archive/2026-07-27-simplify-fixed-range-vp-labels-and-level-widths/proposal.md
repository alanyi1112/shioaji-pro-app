## Why

固定範圍 VP 的 VAH／POC／VAL 價格標籤目前會重複顯示「範圍 1／範圍 2」名稱，增加主圖文字密度；三種水平線也使用 2px 與 3px 的不同粗細。需要簡化標籤並統一線寬，讓價位資訊更精簡且不遮蔽 K 棒。

## What Changes

- 固定範圍 VP 的 VAH／POC／VAL 價格標籤只顯示級別名稱與格式化價格，不再顯示「範圍 1／範圍 2」等範圍名稱前綴。
- VAH、POC、VAL 三種水平線全部統一為 1 CSS px，保留既有顏色、線型與聚焦／失焦透明度。
- 聚焦範圍左右黃色拖曳控制線維持 2 CSS px，不隨水平線改為 1px。
- 更新靜態資產 cache key、自動化測試與本機瀏覽器驗收。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `fixed-range-volume-profile-visual-state`：修改價格標籤內容與 VAH／POC／VAL 水平線粗細契約，並釐清 2px 縱向控制線不再與 1px 水平線等粗。

## Impact

- 前端：`public/static/app.js`、`public/static/styles.css`、`public/static/index.html`。
- 測試：`tests/rendered-html.test.mjs`。
- 規格：`fixed-range-volume-profile-visual-state`。
- 不影響固定範圍 VP 計算、範圍名稱管理、保存格式、Worker API 或 D1。
