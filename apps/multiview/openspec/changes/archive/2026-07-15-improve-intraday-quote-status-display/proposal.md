## Why

台股盤中日 K 目前可能因上游 `marketState` 未被正確辨識而誤判為 `session-close`，導致系統在交易尚未結束時啟動官方收盤核對，並把「第二來源尚未發布」顯示成「未驗證」。這會混淆「盤中尚不適用收盤核對」與「收盤後核對失敗」兩種完全不同的狀態，也讓使用者無法直接看見主來源的實際報價時間。

2026-07-13 收盤後驗收進一步證實，TWSE 官方約 14:00 已產製一般交易收盤資料，日期指定的官方 `MI_INDEX` 也已能查到當日 1,369 檔上市商品，但現行 verifier 使用的 `STOCK_DAY_ALL` 在 14:44 仍停留於前一交易日，讓正式站的 `.TW` 面板持續顯示 `pending`。因此除了修正盤中語意，也必須讓上市商品使用可取得同日收盤資料的官方端點，否則收盤後狀態無法在合理時間完成轉換。

## What Changes

- 將報價生命週期明確區分為盤中、收盤整理中、已收盤及未知狀態，不再只依單一上游 `marketState` 字串判定。
- 台股盤中日 K 標示為 `intraday`，不呼叫 TWSE／TPEx 收盤 verifier，內部核對狀態使用 `not_applicable`，而不是 `unverified`。
- 盤中價格列顯示「現價」與主來源提供的報價日期時間，不在可見文字附加「未驗證」。
- 收盤後才進入官方第二來源核對；官方尚未發布時使用等待核對語意，真正無法核對時才顯示「未驗證」。
- 上市 `.TW` 收盤核對優先使用 TWSE 日期指定的同日 `MI_INDEX` 資料，官方端點失敗時才使用 TWSE MIS 與既有 `STOCK_DAY_ALL` 作保守 fallback；上櫃 `.TWO` 維持既有 TPEx、D1 官方鏡像與 TWSE MIS 流程。
- TWSE 同日資料必須依回傳欄位名稱尋找證券代號與收盤價、驗證官方日期，並把 `--`、空值與無成交標記視為不可比較，不得誤報 `mismatch`。
- 無論盤中或收盤，資料過期仍必須明確顯示，不能因跳過收盤核對而隱藏 freshness 問題。
- `/api/candles` 與 `/api/stream` 共用相同的市場階段、報價種類、來源時間及核對狀態。
- 補上台股盤中、休市日、收盤轉換、來源時間缺失、過期資料及串流一致性的回歸測試與正式站可見行為驗收。

## Capabilities

### New Capabilities

- `intraday-quote-state`: 定義盤中報價生命週期、來源時間顯示、收盤核對適用性、freshness 優先級及 candles／stream 一致性。

### Modified Capabilities

- `codex-sites-rewrite`: 將台股第二來源核對限定於已完成日 K，把盤中不適用核對與收盤後核對失敗分開處理，並讓 `.TW` 使用可取得同日收盤資料的 TWSE 官方端點與保守 fallback。

## Impact

- Worker 市場資料正規化：`worker/market-data.ts`
- Worker 核對與 D1 快取流程：`worker/app.ts`
- 前端價格列、資料時間、狀態樣式與 tooltip：`public/static/app.js`、`public/static/styles.css`
- API contract：`quote.kind`、`quote.marketPhase`、`quote.sourceQuoteTime`、`quote.sourceTimeZone`、`quote.verification`
- 測試與驗收：`tests/rendered-html.test.mjs`、本機 build／test、正式站台股交易時段與收盤後可見行為
- 不新增外部資料供應商；只在同一 TWSE 官方供應者內調整 `.TW` 端點優先順序，保留既有 TWSE OpenAPI、TPEx、TWSE MIS 與 D1 鏡像作 fallback，且不新增或暴露任何秘密資料。
