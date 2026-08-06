## Context

TDCC `GET /v1/opendata/1-5` 是全市場最新股權分散週快照，現行 Worker 會在請求時下載、驗證並寫入 D1，但不會回頭取得較早週。正式站目前因此只有 `2026-07-09` 一期，大戶／散戶比例可顯示單點，無法計算相較前一筆實際發布週資料的百分點變化。

TDCC 官方歷史查詢頁提供約一年資料日期，資料語意是每週最後營業日彙整的持股分級；它不是每日資料。一般 HTML 查詢頁本身不等於正式 server-to-server API，因此 Worker 必須維持 fail closed。使用者已明確選擇免費 fallback 時，允許本機 operator runner 只依可見表單與官方候選逐檔、逐週低速查詢目前網站台股清單，取得後再走受保護匯入；此 runner 不部署、不掃描全市場、不規避 CAPTCHA 或封鎖。FinMind 的 `TaiwanStockHoldingSharesPer` 雖有長期歷史，但官方文件列為贊助者功能，不能作為本變更的免費必要來源。

## Goals / Non-Goals

**Goals:**

- 實際將官方免費可用範圍內的 TDCC 週歷史回補到 D1；正式 Open Data 使用全市場週輸入，本機 fallback 則以明確目標清單的單週合併輸入寫入。
- 讓回補可分批、可中斷續跑、可重試、可冪等重跑，且不阻塞一般圖表 API。
- 由 API／健康檢查直接查證 coverage、預期與完成週數、作業狀態及最後錯誤。
- 讓 UI 分辨「只有一期」、「實際回補中」、「部分回補」、「來源不可用」，並永久揭露週頻語意。
- 保持非發布日 gap，不製造每日大戶／散戶持股值。

**Non-Goals:**

- 不從週資料推算、插值或 forward-fill 每日持股比例。
- 不突破 TDCC 免費保留範圍，不把網頁查詢 runner 部署成正式爬蟲，也不繞過 CAPTCHA、封鎖或查詢限制。
- 不把 FinMind 付費資料集或付費 token 當成本次交付前提。
- 不讓前端直接呼叫上游或持有 ingest secret。

## Decisions

### 1. 以「每個資料日期一份經驗證批次」作為回補單位

正式 history adapter 先列出官方可用 `dataDate`，再依日期取得全市場分級資料；每份輸入只下載一次。若使用本機 fallback，runner 依固定目標 symbol 清單逐檔查詢，將同一日期成功取得的 rows 合併成一個 targeted batch，再經 schema、日期一致性、symbol／level 唯一性、有限數值、分級 17 合計與目標集合檢查後 upsert 到 D1。兩種模式都以資料日期為 checkpoint，禁止 panel 觸發下載。

開圖時逐個 symbol 同步回補仍不採用；本機 runner 由操作者單次啟動、單一併發、固定間隔，與公開圖表請求完全分離。

### 2. 正式來源 fail closed；本機 fallback 必須由使用者明確選擇

實作先以官方文件、回應 header 與穩定 request contract 確認歷史匯出是否可由 server-to-server 自動取得。確認成功才啟用 Worker network adapter；未確認時維持 `history_source_unverified`。使用者明確選擇免費方案 2 後，本機 operator runner 可操作官方公開表單：先以最新官方 OpenAPI 驗證目標代號、讀取官方日期、優先選取 autocomplete 唯一完整候選；若 6 碼證券未提供候選，允許直接送出可見表單，但回傳頁證券代號必須完全相同。runner 再逐筆解析表格，將歷史頁正規化為 OpenAPI 相容的 17 級格式，並透過受保護 ingest endpoint 匯入。

runner 固定單一併發、至少一秒間隔、timeout、有限退讓重試與 checkpoint；遇 CAPTCHA、封鎖、格式漂移或候選不一致立即停止，不嘗試規避。正式 Worker、前端與公開 API 都不得直接操作查詢頁。

目前清單中新上市 ETF 若有 TWSE 官方可追溯上市日，runner 可用非秘密 metadata 在上市日前直接保留 `pre_listing` 缺值，避免對不可能存在的週重複查詢；上市日起仍必須依正式表單結果驗證，不得據此補造資料。

### 3. 回補由受保護批次工作驅動，不由公開圖表 API 驅動

新增 backfill job state，保存 `jobId`、模式、目標起訖、預期資料日期、目前 checkpoint、成功／失敗週數、狀態、最近錯誤碼與 timestamps。每次受保護呼叫只處理有限週數與有限 D1 rows，完成後回傳下一 checkpoint；操作者或 Sites 相容 workflow 重複呼叫直到完成。前台 `GET /api/taiwan-stock-chip` 只讀 D1 並可觸發既有最新快照 single-flight，不同步等待一年回補。

替代方案是建立長時間單次 Worker request；它容易超過 runtime 時限且失敗後難以續跑，因此不採用。

### 4. D1 使用既有週資料唯一鍵，另存 coverage 與 job 可觀測狀態

股權分散 rows 繼續以 `symbol + dataDate` 冪等保存；重跑相同週只更新經驗證的來源 metadata，不新增重複資料。dataset coverage 增加實際起訖、distinct week count、最後成功時間與來源；job state 另外呈現「預期」和「已處理」，避免把單純時間經過誤稱為正在下載。

健康檢查只輸出安全摘要與錯誤碼，不輸出秘密、完整上游 body 或受保護 URL。

### 5. UI 只在有 job 證據時顯示「回補中」

只有一筆 `distributionRows` 且沒有 running job 時顯示「目前僅 1 期／尚無前週比較」。只有 API 明確回傳 `backfill.status=running` 時才顯示「歷史回補中（x/y 週）」。完成但受查詢範圍限制時顯示實際 coverage；失敗或部分完成則保留已寫入資料並顯示安全原因。

每個 TDCC pane 固定顯示「週資料／當週最後營業日」。游標落在非 `dataDate` 時仍顯示「當日無發布資料」，不沿用最近一週值。

## Risks / Trade-offs

- [TDCC 歷史匯出沒有可驗證的自動介接契約] → 保持 network adapter fail closed，交付受保護官方檔案匯入與完整操作說明；不以未授權抓取換取自動化。
- [本機逐檔查詢耗時且可能受網站改版影響] → 僅處理明確目標清單、單一併發、checkpoint 續跑；格式漂移或封鎖立即停止，保留已成功週。
- [來源格式或分級定義變更] → 嚴格 schema／level／合計驗證，整週失敗時不部分覆寫 D1，並記錄安全錯誤碼。
- [一年全市場資料量造成 Worker 或 D1 限制] → 按週及 row chunk 分批、低併發、checkpoint 續跑，避免單次 transaction 與 response 過大。
- [假日造成週日期不固定] → 以官方列出的實際 `dataDate` 為準，不自行假設每週五或補成每日。
- [正式站中途部署或工作中斷] → job state 與冪等唯一鍵允許從 checkpoint 重跑；已成功週不刪除。
- [健康資訊洩露內部細節] → 僅輸出 provider、狀態、coverage、計數、時間與 allowlist 錯誤碼。

## Migration Plan

1. 新增 D1 migration：建立／擴充 TDCC backfill job 與 coverage 欄位，保留既有股權分散 rows。
2. 實作共用 parser／validator，先以固定官方樣本及惡意／破損 fixture 測試。
3. 驗證官方歷史來源契約；啟用自動 adapter 或確認受保護檔案匯入 fallback。
4. 部署 API 與 health 欄位後，以小批次跑單一週 smoke，再啟動一年回補。
5. 對照官方抽樣 symbol／日期／級距與 D1 coverage，完成後再啟用 UI 進度與新狀態文字。
6. 若發生錯誤，停用歷史 adapter／job；保留已驗證 rows，最新 OpenAPI 更新與前台讀取繼續運作。

## Open Questions

- 實作階段需以官方文件與實際回應確認：TDCC 是否提供穩定、允許自動介接的歷史全市場下載 URL／格式。此問題不阻擋設計，因為受保護官方檔案匯入是必要 fallback。
