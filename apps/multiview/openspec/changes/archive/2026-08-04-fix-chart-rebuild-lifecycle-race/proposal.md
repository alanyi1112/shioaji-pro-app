## Why

部署後瀏覽器驗收發現，正常單次切換圖表數量、分類分頁或市場頁籤皆能正確完成，但快速連續切換會讓已銷毀的 Lightweight Charts 實例偶發收到延遲回呼，造成 `Uncaught Error: Value is null`。進一步以 Lightweight Charts development build 診斷後，也確認技術副圖會在 ATR series 建立前設定尚不存在的 `atr` 自訂 price scale；production build 將這個明確錯誤同樣壓縮成 `Value is null`。兩條路徑都必須在後續功能擴充前修正。

## What Changes

- 讓圖表數量、分類分頁、市場頁籤與主副圖狀態造成的 panel 重建具備一致的 generation／disposed 邊界，並讓頁面級 batch response 只能回到發出 request 時的同一個 subscription token。
- 在銷毀 panel 時取消或隔離仍可能操作主圖、副圖、overlay、crosshair、resize 與延遲 layout 的 callback。
- 調整 ATR 副圖初始化順序，先建立使用 `atr` price scale 的 series，再設定該 scale 的顯示選項。
- 保留既有商品切片、6／8 圖固定單一副圖、deep link 清理與圖表偏好行為，不以 debounce 改變使用者最後一次選擇。
- 新增快速連續切換的自動化測試與乾淨瀏覽器驗收，要求最後狀態正確且 Console 不得出現 Lightweight Charts lifecycle error。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `codex-sites-rewrite`: 補充多圖重建時的非同步生命週期安全要求，涵蓋快速切換圖表數量、分類分頁與市場頁籤。

## Impact

- 主要影響 `public/static/app.js` 的 panel 建立、銷毀、排程 callback、圖表互動與重建流程。
- 可能同步調整共用前端 helper 與 `tests/` 內的 lifecycle／rendered HTML／瀏覽器驗收測試。
- 不變更 Worker API、D1 schema、資料來源、個人清單內容、存取控制或部署秘密。
