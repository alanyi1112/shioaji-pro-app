## Why

目前「副圖」選單寬度偏大，籌碼群組主項與次項字級接近，長名稱又容易換行，導致選單層級不夠清楚且占用過多圖表空間。需要在不改變 pane、資料語意與既有選取狀態的前提下，縮窄選單並簡化使用者可見文案。

## What Changes

- 縮小「副圖」功能表的桌面寬度，並保留窄螢幕不超出 viewport 的 responsive 行為。
- 6／8 圖等窄面板進一步縮小選單並改為右側對齊「副圖」按鈕，避免選單右緣被面板裁切。
- 降低技術指標與籌碼群組主項字級，讓籌碼次項使用更小字級，建立清楚的主從層級。
- 將 RSI、KD、MACD、ATR 技術指標選項改為每列兩個，縮短選單高度並保留最下方持股比群組的完整可見性。
- 移除三個籌碼主群組上方的水平分隔線，縮減群組間與群組內的垂直留白，進一步降低功能表高度。
- 將籌碼群組主項「法人」改為「法人買賣超」，「大戶持股」改為「持股比」。
- 將法人次項依序簡化為「外資」、「投信」、「自營商」、「合計」。
- 將持股比次項簡化為「大戶」與「散戶」。
- 移除「籌碼資料」下方的適用範圍說明文字。
- 只有台股普通股或 ETF 的日 K 面板顯示籌碼副圖選項；美股等海外商品及其他不適用情境隱藏整個籌碼群組與既有籌碼 pane。
- 保留所有 checkbox value、資料請求、已保存選取狀態、pane 標題與圖表內容，不改變籌碼資料語意。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `taiwan-stock-chip-subcharts`: 更新單一副圖選單的籌碼群組與次項顯示名稱，加入緊湊寬度、主從字級層級與依商品／週期顯示籌碼選項的要求。

## Impact

- 前端：`public/static/index.html` 的副圖選單文案、`public/static/styles.css` 的一般／6／8 圖選單寬度、定位、字級及 responsive 樣式，以及 `public/static/app.js`、`public/static/chip-panes.js` 的適用性顯示控制。
- 測試：`tests/subchart-interaction.test.mjs` 的選單文案、群組結構與密度 contract。
- 不影響 Worker API、D1 schema、籌碼資料來源、pane registry、偏好儲存格式或 Sites runtime secrets。
