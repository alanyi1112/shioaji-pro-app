## Context

來源專案以 `provider + symbol + interval` 管理 process memory history，依 candle `time` 合併去重，並對 yfinance `1d`、`1wk`、`1mo` 使用 Supabase 作第二層持久化；資料已足夠時仍會刷新最新尾端，讓盤中暫時 K 棒可在收盤後被修正。Sites 已移植前端歷史補載、warmup、指標裁切與可視範圍保持，但 Worker 目前把完整 `/api/candles` payload 依 `displayCount` 分開存入 `candle_cache`，不同資料窗無法共用逐 K 棒歷史，也沒有同 key 的 upstream single-flight。

本變更必須在 Cloudflare Workers／D1 限制內達成來源行為 parity，同時保留既有台股交易日正規化、報價生命週期、官方第二來源核對、Massive reference cache、籌碼副圖與前端 response schema。現有 `candle_cache` 仍被完整 payload stale fallback 與 Massive reference cache 使用，不能在同一 migration 中直接移除。

## Goals / Non-Goals

**Goals:**

- 以 D1 正規化保存 yfinance 日／週／月 K 線，讓 deploy、restart 或 Worker isolate 更換後仍可重用歷史。
- 讓不同 `display_count` 的請求共用同一份 `provider + symbol + interval` 歷史與同一個進行中的 upstream 更新。
- 依時間合併去重並允許最新資料覆蓋同 time 舊資料，支援尾端更正。
- 保留 display candle、warmup、indicator time set、台股占位正規化、quote verification 與 stale 語意。
- 提供可測試且不含秘密的 cache metadata，以及來源專案同級的歷史縮放 browser acceptance。

**Non-Goals:**

- 不在本變更加入 Finnhub fallback 或 Hyperliquid WebSocket bridge。
- 不將所有分鐘 K 永久保存到 D1；非 `1d`、`1wk`、`1mo` 仍採 interval-aware 短期快取與 upstream 流程。
- 不修改前端歷史補載 UX、最大顯示根數或公開 API route。
- 不刪除既有 `candle_cache`，也不改變 Massive reference cache 的使用方式。
- 不承諾跨所有 Worker isolate 的全域單一 upstream request；本變更提供單一 isolate 內 single-flight，並以 D1 unique key 保證跨 isolate 寫入冪等。

## Decisions

### 1. 新增正規化 `candle_history`，不重用 payload cache

新增 D1 table，以 `provider + symbol + interval + time` 作複合主鍵，保存 OHLCV、`quote_time`、`source_updated_at`、`source` 與 `fetched_at`，並建立支援依 key 取最新 N 根資料的索引。逐 row schema 能讓不同 display window 共用歷史、覆蓋尾端修正並避免重複 time。

替代方案是繼續保存不同 `displayCount` 的完整 JSON payload；這會複製 candle 與 indicators、無法局部更新，也會讓 160、320、480 根請求各自觸發上游，因此不採用。

### 2. 僅將 yfinance 日／週／月設為長期持久化範圍

第一版延續來源專案的 `1d`、`1wk`、`1mo` 範圍。分鐘與小時資料量大、保存期限與免費上游限制不同，仍使用 Worker memory history、既有短期 response cache及外部 provider；所有 interval 都使用相同的 merge 與 single-flight helper。

替代方案是永久保存所有 interval；這會在尚未定義 retention、清理排程與 D1 容量預算前放大儲存與寫入成本，因此不納入本變更。

### 3. 使用穩定 history key 與 isolate 內 single-flight

建立不含 `display_count` 的 `provider + symbol + interval` key。相同 key 同時需要刷新時，共用一個 Promise；每個 caller 在 Promise 完成後依自己的 requested display window 裁切。不同 key 可並行，不讓一個商品阻塞其他商品。

D1 複合主鍵與 upsert 保證不同 isolate 即使同時刷新，也只會得到同 time 的一筆最終 row。若未來需要跨 isolate 嚴格限制 upstream 次數，應另評估 Durable Object 或 D1 lease；本變更不先引入新的協調服務。

### 4. 採 D1-first、尾端刷新、合併後裁切流程

每次請求先計算 `display_count + warmup + 台股日 K raw buffer` 的 required rows。持久化 interval 先查 D1 最新 rows：

1. 資料足夠且仍在 interval TTL 內，直接產生 payload。
2. 資料足夠但需刷新，向 Yahoo 取得最小合理 tail，依 time 合併並批次 upsert。
3. 資料不足時，以既有 D1 rows 為基礎下載 provider 可提供的合理歷史窗，合併後 upsert。
4. 上游失敗但存在可用歷史時，回傳 stale payload；完全沒有可用資料時維持既有安全 502。

Yahoo chart 的 period/range 能力不是精準缺口 API，因此不足時允許抓 provider 支援的最小合理範圍，但成功結果必須寫回 history，避免短時間重複下載。

### 5. 指標與 quote pipeline 只接受合併、正規化後的 rows

D1 與上游 rows 先合併去重，再執行台股無成交占位正規化；完整正規化序列用於 indicators，最後才裁切 display candles 與 indicator time set。`verifyMarketQuote` 仍在 candle payload 完成後執行，D1 hit 不得自動等同 `fresh` 或 `verified`。

### 6. Cache metadata 採向後相容擴充

保留 `dataWindow.cache.store/state/source`，並允許增加 `historyStore`、`persistent`、`rows`、`tailRefresh` 或安全 reason code。狀態至少涵蓋 `hit`、`miss`、`backfilled`、`refreshed`、`stale`、`disabled` 與 `write_failed`。前端忽略新增欄位時仍能正常顯示。

### 7. Migration 先新增後切換，保留既有 fallback

先部署 additive migration 與 schema，再切換 read/write path。既有 `candle_cache` 不清空，讓 rollout 初期仍可作 response stale fallback與其他 reference cache；確認正式站 D1 history 命中及補載後，後續變更再評估舊 candle payload key 的 retention。

## Risks / Trade-offs

- [D1 rows 隨商品與歷史累積] → 第一版只持久化 yfinance 日／週／月，使用受控 batch，並在 health／測試中監測 row 數；分鐘資料不寫入長期 table。
- [多 isolate 仍可能同時呼叫 Yahoo] → isolate 內 single-flight 降低主要多 panel 重複量，D1 upsert 保證寫入冪等；跨 isolate 全域協調留待有實際證據後另案處理。
- [尾端刷新失敗造成舊資料被誤標為最新] → 將 cache state 設為 `stale`，quote freshness 與 verification 分開判斷，且不回傳完整上游錯誤。
- [migration 成功但新 query 有錯] → 保留既有 payload cache 與外部 provider fallback；runtime path 可回退至舊版，additive table 不需刪除。
- [台股占位 row 已寫入 D1] → 每次對外使用前仍執行正規化，新的成功刷新會以同 time upsert 修正，不要求人工清表。

## Migration Plan

1. 新增 `candle_history` Drizzle schema、migration、索引與 migration contract test。
2. 實作 row parser、query、batch upsert、merge 與 interval persistence policy，不先切換公開路徑。
3. 加入 history coordinator 與 D1-first acquisition，讓 `/api/candles` 在 table 可用時使用新流程；table 不可用時安全降級。
4. 執行 unit、Worker integration、concurrency、stale、warmup、quote verification 與 browser history zoom tests。
5. 部署 migration 與 Worker，先 smoke 預設 window，再驗證較大 `display_count`、D1 hit、尾端修正及正式站縮放可視範圍。
6. 若正式站回歸，回退 Worker 版本；新增 table 保留，不執行破壞性 rollback。

## Open Questions

- 無阻擋實作的未決問題。跨 isolate 全域 upstream lease 與分鐘 K retention 明確排除於本變更，待正式流量證據再評估。
