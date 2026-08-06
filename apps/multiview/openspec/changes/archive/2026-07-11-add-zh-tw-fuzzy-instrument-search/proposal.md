## Why

目前「我的清單」商品搜尋只做代號／名稱的字串包含比對，且海外候選直接沿用 Yahoo 英文名稱；正式站已確認 `元太`、`輝達`、`蘋果`、`日經` 等中文查詢無法穩定取得候選，`8069` 也可能只顯示英文名稱。使用者需要以繁體中文、常見別名或商品代號模糊搜尋台股與海外商品，並在辨識清楚的候選中選擇後再確認儲存。

## What Changes

- 建立可搜尋的繁體中文商品名稱與別名索引，完整涵蓋上市、上櫃股票與 ETF，並涵蓋系統既有的海外股票、指數、期貨、外匯、債券與加密貨幣商品。
- 將台股官方中文名稱同步至 Sites D1 搜尋目錄，避免搜尋請求依賴 Codex Sites runtime 即時連線 TPEx。
- 在 `/api/instrument-search` 加入中文／英文／代號正規化、別名展開、模糊比對、結果評分及 `symbol + exchange` 去重。
- 搜尋候選以繁體中文名稱為主、英文正式名稱為輔，並顯示代號、市場、交易所、商品類型與來源，降低同名商品誤選風險。
- 保留現有「點選候選只填入表單，使用者按下『儲存商品』才寫入」的確認流程，不自動新增商品。
- 分離 TWSE、TPEx、中文索引與 Yahoo fallback 的錯誤狀態，單一外部來源失敗時仍回傳其他可用候選與可辨識的 warning。

## Capabilities

### New Capabilities

- `localized-instrument-search`: 規範台股與海外商品的繁體中文名稱／別名索引、模糊搜尋排序、候選顯示、來源容錯及明確確認流程。

### Modified Capabilities

無。

## Impact

- 後端：`worker/app.ts` 的 `/api/instrument-search`、D1 schema 與台股商品目錄 ingest／查詢流程。
- 資料：`public/data/stock_setup.md` 的海外商品顯示名稱，以及新增可維護的繁體中文別名／商品目錄資料。
- 前端：`public/static/app.js` 的搜尋候選呈現與欄位填入；`public/static/index.html` 的搜尋輔助文字可能調整。
- 外部系統：TWSE／TPEx 官方 OpenAPI、private GitHub Actions 商品目錄同步，以及 Yahoo Search fallback；不新增需要付費升級的 Massive 方案或新的 secret。
- 驗證：新增搜尋正規化、排序、來源失敗、D1 目錄與 API contract 測試，並在正式 Codex Site 以中文名稱、別名及代號進行瀏覽器驗收。
