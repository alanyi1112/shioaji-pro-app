## Why

從多圖 panel 以雙擊開啟的 `view=single` URL 仍保留 `singleChartView`，使用者改回 2／3／4／6／8 圖並切換分類頁時，第一個 panel 會持續顯示單圖商品，造成每頁第一格重複、其餘商品錯位。正式站已在 6 圖重現，且同一狀態會影響所有多圖數量。

這是單圖 deep-link 狀態與一般分類分頁狀態混用造成的跨版型一致性問題，必須在前端狀態轉換、商品切片與回歸驗證一次修正。

## What Changes

- 將 `view=single` 的商品／週期鎖定限制在單圖生命週期；切換至多圖後，所有 panel 一律依目前頁籤與頁碼的 canonical 商品切片產生。
- 修正單圖 deep-link 初始化的分類頁索引計算，不再把商品索引直接當成頁碼。
- 切換圖表數量或分類頁時，清理或重算不再適用的單圖狀態，避免第一個 panel、週期與副圖資格被舊 deep-link 污染。
- 6／8 圖固定使用單一副圖，停用主圖與多層副圖選項，避免高密度版型產生不可用或過度擁擠的副圖配置；切回其他圖數時恢復原本偏好。
- 補上 1／2／3／4／6／8 圖、頁碼切換、單圖 URL 進入後切回多圖及頁籤切換的自動化回歸測試，並以正式站瀏覽器驗證可見商品順序。

## Capabilities

### New Capabilities

### Modified Capabilities

- `codex-sites-rewrite`: 修正多圖圖表數量與分類分頁在單圖 deep-link 後的商品選取、頁碼與 panel 一致性契約。

## Impact

- `public/static/app.js`：單圖 URL 解析、圖表數量切換、分類頁狀態、panel 預設商品與週期。
- `tests/rendered-html.test.mjs` 及必要的前端狀態測試：新增頁碼／商品切片回歸保護。
- 不修改 Worker API、D1 schema、外部資料來源或既有暫緩的 `add-mainforce-chip-subcharts`。
- 完成後需通過 lint、完整測試、OpenSpec strict、`git diff --check`，並以 Cloudflare 正式站驗證所有圖表數量的頁碼切換。
