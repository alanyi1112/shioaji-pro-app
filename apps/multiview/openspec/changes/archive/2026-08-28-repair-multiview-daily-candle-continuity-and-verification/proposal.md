## Why

MultiView 目前以歷史總根數與最後日期判定日 K 是否完整，無法辨識資料窗中間缺少真實交易日；因此大立光 `3008.TW` 曾在資料狀態仍標示 `complete` 時，直接從 2026-07-31 跳到 2026-08-17。現行官方核對又只比較收盤價，卻以未限定範圍的「已核對」呈現，無法完整表達 OHLCV 的正確性。

## What Changes

- 對 `.TW`、`.TWO` 日 K 建立逐商品、逐交易日的連續性檢查，區分真實缺漏、休市、上市前日期、停牌或官方無成交，不以一般週一至週五自行補造 K 棒。
- 將歷史是否足夠的判斷從「總根數足夠或曾完成 full fetch」提升為「請求範圍、warmup 與必要 buffer 內的預期交易日已確認完整，且最新已完成交易日存在」。
- 發現內部缺口時動態擴大 Yahoo 抓取範圍；仍缺漏的已成交交易日再以 TWSE／TPEx 官方資料確認並定點修復，失敗時保留既有資料並公開 partial／unknown 狀態，絕不假造 candle。
- 擴充 D1 history state，保存連續性狀態、已核對範圍、缺漏日期與安全原因碼；修復後同步失效相關 candle payload cache，避免舊 payload 遮蔽新資料。
- 擴充 `/api/candles` 的 `dataQuality`／`dataWindow.cache` 診斷資訊，讓前端與健康檢查能逐商品辨識最新 coverage、內部缺口與官方核對範圍。
- 將收盤價單欄核對明確顯示為「收盤已核對」；只有同交易日完整 OHLCV 依規格核對成立時，才可顯示「OHLCV 已核對」。
- 新增大立光 2026-07-31 至 2026-08-17 缺口、固定 5 日 tail 無法修復、休市／停牌防誤判、cache 失效、逐商品健康摘要及實際瀏覽器日期連續性的回歸驗收。

## Capabilities

### New Capabilities

- `daily-candle-session-continuity`: 定義台股日 K 預期交易日、內部缺口偵測、官方定點修復、連續性 metadata、逐商品稽核與 UI 可診斷行為。

### Modified Capabilities

- `candle-history-parity`: 將 history sufficiency、full-window state、刷新策略、cache lifecycle 與驗收條件擴充為必須證明請求範圍內的交易日連續性。
- `codex-sites-rewrite`: 將既有台股官方第二來源核對從未限定範圍的「已核對」改為明確區分收盤價核對與完整 OHLCV 核對。

## Impact

- Worker：`worker/candle-history.ts`、`worker/market-data.ts`、`worker/app.ts`、台股官方資料取得與 health／diagnostic 路由。
- D1：`candle_history_state` 需要 migration，並可能新增逐商品缺口或稽核欄位；既有 `candle_history` 唯一鍵維持不變。
- API／前端：`/api/candles` 增加向後相容 metadata，MultiView quote verification 文案與資料品質提示同步調整。
- 快取：記憶體與持久化 candle payload 在 history 修復後必須精準失效；相同 `provider + symbol + interval` 的 single-flight 身分維持不變。
- 資料來源：Yahoo 保留為大量歷史種子；TWSE／TPEx 僅用於交易日確認、已完成日 K 核對與缺口修復，不新增秘密或付費資料依賴。
- 驗證：migration、unit、Worker integration、D1 逐商品 SQL 稽核、`npm run lint`、`npm test`、OpenSpec strict 與實際瀏覽器 DOM／canvas／console 驗收。
