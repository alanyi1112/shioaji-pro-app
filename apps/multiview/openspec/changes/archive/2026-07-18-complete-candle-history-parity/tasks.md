## 1. 基線與 D1 schema

- [x] 1.1 重跑現有 `/api/candles`、stream、quote verification 與 history frontend tests，記錄目前 payload、cache metadata、upstream call 次數與 `display_count` 行為基線。
- [x] 1.2 在 `db/schema.ts` 新增 `candle_history` 複合主鍵、OHLCV、quote/source metadata 與查詢索引，產生 additive Drizzle migration，保留既有 `candle_cache`。
- [x] 1.3 新增 migration contract test，驗證 `provider + symbol + interval + time` 唯一性、必要欄位、索引與重複 migration 安全性。

## 2. History domain 與 D1 repository

- [x] 2.1 建立穩定 `provider + symbol + interval` history key、interval persistence policy、interval-aware TTL 與 required rows 計算，涵蓋 display、warmup 及台股日 K raw buffer。
- [x] 2.2 實作 candle row parser、依 time 合併去重與排序，確保新合法 row 覆蓋同 time 舊 OHLCV、quote time 與來源 metadata。
- [x] 2.3 實作 D1 最新 N rows query、受控 batch upsert 與安全 metadata，讓 yfinance `1d`、`1wk`、`1mo` 可跨部署持久化。
- [x] 2.4 為 repository 加入 table 不存在、query 失敗與 write 失敗的安全降級，確認不回傳秘密或完整上游錯誤。

## 3. Single-flight 與資料取得流程

- [x] 3.1 建立 isolate 內 history coordinator，使相同 key 的一般載入、歷史補載、多 panel 與預取共用進行中的 upstream Promise，不同 key 仍可並行。
- [x] 3.2 讓相同 key 的不同 `display_count` caller 共用最大 required rows 或只補真正不足範圍，並以測試證明不會同時下載重複資料窗。
- [x] 3.3 將 Yahoo candle fetch 拆成完整合理歷史窗與最新尾端刷新路徑，保留 Hyperliquid、sample 與既有 provider 錯誤語意。
- [x] 3.4 實作 D1-first acquisition：history 足夠且新鮮時 hit、資料不足時 backfill、到期時 tail refresh，成功 rows 合併後寫回 D1。
- [x] 3.5 實作上游失敗時 stale history fallback；Yahoo-backed 商品完全無合法資料時維持安全 502，並保留 Hyperliquid 既有 sample fallback。

## 4. `/api/candles` 整合與相容性

- [x] 4.1 將合併 history 接入 `candlePayload`，依合併後 rows 執行台股占位正規化、indicator warmup 計算與 display time set 裁切。
- [x] 4.2 保持既有 quote lifecycle、`verifyMarketQuote`、data quality 與 stream payload 行為，D1 hit 不得自動標示為 fresh 或 verified。
- [x] 4.3 擴充 `dataWindow.cache` 或相容 metadata，安全呈現 hit、miss、backfilled、refreshed、stale、disabled、write failed、persistent 與 rows，不破壞既有前端。
- [x] 4.4 確認 frontend history loader 在 D1 較大 window、provider 邊界與無新增 candle 三種情況維持正確 `hasMoreBefore` 與停止條件。

## 5. 自動測試與 browser acceptance

- [x] 5.1 新增 merge、同 time 覆蓋、interval policy、required rows、batch 邊界與 metadata unit tests。
- [x] 5.2 新增 Worker integration tests，涵蓋 D1 hit／miss／partial backfill／tail refresh、跨 `display_count` 重用、stale fallback、write failure 與 upstream call 計數。
- [x] 5.3 新增 concurrency tests，驗證相同 key single-flight、不同 key 可並行、不同 isolate 模擬寫入仍由 D1 unique key 冪等去重。
- [x] 5.4 新增台股占位正規化、warmup 不足、indicator time alignment、quote verification 與 stream parity regression tests。
- [x] 5.5 將來源專案 history zoom acceptance 移植為 Sites runner，驗證 candle 增加或明確停止、visible logical range 保持、主副圖對齊、indicator／overlay 保留與 console 無錯誤。

## 6. 完整驗證與正式部署

- [x] 6.1 執行 migration 檢查、`npm run lint`、`npm test`、`openspec validate --all --strict`、`git diff --check` 與既有秘密掃描，修正所有失敗。
- [x] 6.2 在本機 Sites runtime smoke 預設與較大 `display_count`，確認第二次請求使用合併 history、response schema 相容且無重複上游下載。
- [x] 6.3 依 private Sites 流程套用 migration 並部署，確認 deployment succeeded、首頁、`/api/health`、預設 K 線、stream、台股核對與籌碼副圖沒有回歸。
- [x] 6.4 在正式站驗證 D1 miss → backfilled／refreshed → hit lifecycle、較大 history window、尾端修正與 browser history zoom，保存不含秘密的 API、畫面與 console 證據。
