## 1. 鎖定報價狀態 contract

- [x] 1.1 在測試 fixture 建立台股盤中、收盤整理中、已收盤、休市日、未知 `marketState` 與 stale cache 情境。
- [x] 1.2 新增 API contract assertions，鎖定 `marketPhase`、`kind`、`sourceQuoteTime`、`sourceTimeZone` 與 `verification.status` 的允許值及組合。
- [x] 1.3 新增 verifier 呼叫計數測試，確認盤中 `intraday` 對 TWSE、TPEx、TWSE MIS 與 TPEx mirror 的呼叫數均為零。

## 2. Worker 市場階段正規化

- [x] 2.1 在 `worker/market-data.ts` 保留 Yahoo `regularMarketTime`、`marketState` 與 `exchangeTimezoneName`，並將來源時間與時區寫入 quote contract。
- [x] 2.2 建立可單元測試的台股 `marketPhase` 判定，綜合上游狀態、台北交易時段、當日 `sessionDate`、當日 `sourceQuoteTime` 與有效 candle，不讓未知狀態自動等於收盤。
- [x] 2.3 讓台股盤中日 K 產生 `kind = intraday`，收盤整理中與已完成日 K 產生對應的 `marketPhase` 與 `kind`。
- [x] 2.4 驗證平日休市、週末、來源時間缺失及上游狀態矛盾時採取保守結果，不只依星期與時鐘判定開盤。

## 3. 核對狀態機與串流一致性

- [x] 3.1 在 `worker/app.ts` 將盤中核對設為 `not_applicable + market_open`，並在任何第二來源 fetch 前短路返回。
- [x] 3.2 將已收盤但官方資料尚未發布改為 `pending + reference_not_published`，保留真正 provider 失敗時的 `unverified` 原因碼。
- [x] 3.3 確認 `mismatch` 只在交易日、商品與收盤定義一致後產生，並維持既有 TWSE／TPEx 精度比較。
- [x] 3.4 讓 `/api/candles` 與 `/api/stream` 共用同一 quote payload，並以測試證明兩者的 `marketPhase`、`kind`、來源時間與 verification 相同。

## 4. 前端盤中與收盤顯示

- [x] 4.1 更新 `formatQuoteDataState()`，讓盤中只顯示依 `sourceTimeZone` 格式化的 `MM/DD HH:mm`，compact 顯示 `HH:mm`，且不附加任何核對文字。
- [x] 4.2 讓盤中價格標籤顯示「現價」，收盤後才顯示「收盤價」，並加入說明盤中顯示主來源時間的 tooltip。
- [x] 4.3 為 `not_applicable`、`pending`、`verified`、`unverified`、`mismatch` 與 `stale` 建立互斥的 class／`data-quote-status` 行為，移除盤中 `is-quote-unverified` 樣式。
- [x] 4.4 當 `sourceQuoteTime` 缺失時顯示「盤中・時間待確認」，不得使用 Worker 接收時間冒充來源報價時間。
- [x] 4.5 確認盤中 stale payload 仍顯示來源時間與「資料過期」，freshness 警示優先於核對適用性。

## 5. 驗證與正式站驗收

- [x] 5.1 執行 `npm test`，修正所有盤中、收盤、休市日、來源時間及 stream parity 回歸。
- [x] 5.2 執行 `openspec validate --all --strict`，確認主規格與本 change 全部通過。
- [x] 5.3 在本機瀏覽器驗收多圖台股盤中顯示「現價＋來源時間」，不顯示「未驗證」，且資料過期狀態仍可見。
- [x] 5.4 建置並部署新的 Codex Sites version，確認 deployment succeeded 後再做正式站盤中可見行為與 `/api/candles`、`/api/stream` smoke。
- [x] 5.5 在台股收盤後再次驗收 `pending` 到 `verified`／`mismatch`／`unverified` 的轉換，並記錄 TWSE／TPEx 實際官方資料發布與正式站可用時間。
- [x] 5.6 量測盤中 `sourceQuoteTime` 延遲、Yahoo 429 與多圖負載；只有證據支持時才另案調整目前 300 秒日 K cache TTL。

### 盤中正式站驗收紀錄（2026-07-13）

- Codex Sites version 14 deployment succeeded；4 個台股面板同時載入，均顯示 `現價`、來源時間與 `not_applicable`，沒有「未驗證」或 panel error。
- `/api/candles` 回傳 `marketPhase = open`、`kind = intraday`、`sourceTimeZone = Asia/Taipei`、`verification = not_applicable + market_open`；瀏覽器內 4 條 `/api/stream` EventSource 均收到啟動事件。
- 11:16:26 量測 `sourceQuoteTime = 10:55:44`，來源延遲約 20 分 42 秒；本次 4 圖載入未觀察到 Yahoo 429。
- 現有證據只支持放寬未知 `marketState` 的盤中來源時間容許範圍至 60 分鐘，不支持降低 300 秒日 K cache TTL，因此維持既有 TTL。

## 6. TWSE 同日收盤核對修正

- [x] 6.1 建立 `MI_INDEX` 同日成功、尚未發布、HTTP 失敗、格式錯誤、table／欄位重排及無成交 `--` fixtures。
- [x] 6.2 實作依 `sessionDate` 查詢 TWSE `MI_INDEX`，以欄位名稱定位證券代號與收盤價，並嚴格驗證官方回傳日期。
- [x] 6.3 將 `.TW` fallback 調整為 `MI_INDEX` 失敗時使用 TWSE MIS `tse`，再保留 `STOCK_DAY_ALL` 作最後保守來源；正常尚未發布仍維持 `pending`。
- [x] 6.4 確認無成交、空值與非有限官方價格不會產生 `mismatch`，只有同交易日且雙方收盤價有效時才比較。
- [x] 6.5 以測試證明多個 `.TW` 面板共用單一全市場 request／inflight promise，並維持成功與 negative cache 的既有負載邊界。
- [x] 6.6 提高 candle cache contract version，避免部署後沿用舊端點產生的 `pending` payload。
- [x] 6.7 執行 `npm test` 與 `openspec validate --all --strict`，再驗證 candles／stream parity 及既有 `.TWO` fallback 不回歸。
- [x] 6.8 部署至 Codex Sites，確認 Worker 可存取 TWSE `MI_INDEX`，並在正式站驗收 `.TW` 由 `pending` 轉為 `verified`；若官方價格不同則顯示 `mismatch` 而非誤判 provider failure。

### 收盤後端點研究紀錄（2026-07-13）

- TWSE 官方每日收盤行情說明：約於每一交易日 14:00、15:30、17:30 各產生一次；14:00 版本包含一般交易，不含零股、鉅額、盤後定價、拍賣及標購。
- 14:36 以日期查詢 TWSE `MI_INDEX` 已取得 2026-07-13 的 1,369 檔上市資料；14:44 `STOCK_DAY_ALL` 仍為 2026-07-09。
- 2026-07-09 交叉比對顯示兩端點商品集合均為 1,369 檔，正常有成交商品收盤價全部一致；5 檔無成交商品分別以 `--` 與 `0.00` 表示。
- 14:36 TPEx 現行盤後端點已取得 2026-07-13 的 1,013 檔資料；TPEx OpenAPI 同時間仍為 2026-07-09，因此 `.TWO` 維持既有主要端點。
- 14:46 正式站八個 `.TW` 面板均顯示 `07/13 收盤・待核對`，直接證明現行 TWSE 端點選擇阻塞同日核對。
- Sites version 15 部署後，正式 API 顯示 Yahoo `marketState = unknown`、`sessionDate = 2026-07-13`、`sourceQuoteTime = 13:30:08`，但原狀態機在 15:00 後仍回傳 `unknown + intraday + unsupported_quote_kind`；因此補上三項同日證據成立且台北時間已達 15:00 才轉為 `closed` 的保守規則，再進行下一版驗收。
- Sites version 16 的新 cache key API 與 stream 已回傳 `closed + session-close + verified`，但首頁仍命中 version 15 寫入的 `quote-state-v3` D1 payload；最終版提高為 `quote-state-v4`，確保正式頁面立即套用收盤狀態修正。
- Sites version 17 deployment succeeded；15:41–15:42 正式站八個 `.TW` 面板全部顯示「收盤價」與 `07/13 已核對`，tooltip 明確標示 `TWSE 官方資料`。
- 正式 `/api/candles` 抽查 `00919.TW`、`2330.TW`、`3231.TW` 均為 `closed + session-close + verified + twse`，`referenceSessionDate = 2026-07-13`；`/api/stream` 的 `2330.TW` 回傳相同 verification 與 `checkedAt`。
- `.TWO` 抽查 `8069.TWO` 為 `closed + session-close + verified + twse-mis`，`referenceSessionDate = 2026-07-13`，既有上櫃 fallback 未回歸。
