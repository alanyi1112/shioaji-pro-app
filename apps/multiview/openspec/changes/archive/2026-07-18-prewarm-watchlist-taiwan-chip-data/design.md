## Context

`taiwanStockChipPayload` 已具備 FinMind 歷史 adapter、TWSE／TPEx 最新資料 fallback、D1 局部合併、fetch-state、single-flight 與退讓機制，但目前只有 `GET /api/taiwan-stock-chip` 會呼叫它。新增清單商品時，系統只同步 TDCC continuous target，因此第一次開圖仍可能承擔四類日籌碼歷史下載。

現有 private GitHub Actions 每日執行 TDCC latest refresh 與歷史 runner，已具備 Sites bypass token、獨立 continuous secret、concurrency 及受保護控制面。此變更沿用同一 durable scheduler，避免新增第二套秘密與重疊排程。

## Goals / Non-Goals

**Goals:**

- 「我的清單」中所有合格台股普通股與 ETF，在開圖前就有最近兩年的可用日籌碼快取。
- 新增商品後立即背景預熱；若短生命週期工作沒有完成，由每日 GitHub Actions 接手。
- 每日只處理 missing／stale 目標，並以有限批次、逐 symbol 執行與 retry-after 保護免費來源。
- TDCC 最新週、日籌碼預熱與 TDCC 歷史回補維持清楚的執行順序，單一路徑失敗不清除既有資料。
- 健康狀態能辨識 target、ready、pending 與最近成功時間，但不暴露秘密或上游內容。

**Non-Goals:**

- 不保證免費來源本身沒有發布的 dataset 會產生資料。
- 不掃描未加入網站的整個既有台股市場。
- 不移除開圖時按需補抓；它保留作為排程延遲或來源暫時失敗時的 fallback。
- 不新增付費資料來源，也不提高 FinMind 帳號方案。

## Decisions

### 1. 立即預熱使用 Worker `waitUntil`，durable 補齊使用既有 GitHub Actions

`worker/index.ts` 將 execution context 傳入 `handleAppRequest`。成功保存清單商品後，對每個新加入且 eligible 的 symbol 呼叫 `ctx.waitUntil`，直接重用籌碼 service 取得最近兩年四類日資料。

`waitUntil` 只提供低延遲最佳努力，不被視為完成保證；每日 workflow 會重新查詢 missing／stale targets 並補齊。替代方案「在新增商品 API 回應前同步抓完」會讓使用者儲存清單被免費來源延遲或失敗阻塞，因此不採用。

### 2. 目標集合沿用 TDCC continuous active symbols

現有 target discovery 已合併系統預設台股、所有使用者啟用的 `user_instruments` 與 baseline 後官方新上市增量，並套用相同 eligibility。日籌碼預熱直接讀取 `tdcc_continuous_symbols.active = 1`，避免兩套清單邏輯漂移。

workflow 每次向受保護 API 要求目前 stale／missing targets，不在 YAML 或 runner 內固定 symbol。停用或刪除後不再建立新預熱工作，但已保存資料保留。

### 3. 最近兩年作為預設預熱窗口

前端一般線圖主要使用近一年，預熱兩年可涵蓋常見切換與技術指標所需緩衝，同時控制 FinMind 免費請求與 D1 容量。資料仍以實際交易日保存，不 forward-fill 休市日。

同一 symbol 的四個日 dataset 由既有 service 一次處理；D1 依 `symbol + sessionDate` 局部合併，較不完整 fallback 不得覆蓋既有完整欄位。

### 4. stale-first、有限批次與失敗隔離

控制面依「完全缺 state、coverage 起日不足、最近成功最舊」排序，單次最多回傳有限 symbol。runner 逐 symbol 呼叫同源 API，單一 symbol 失敗只記安全摘要並繼續；遇 rate limit 則尊重已保存的 `retry_after`，後續排程再處理。

TDCC latest refresh 仍最先執行，日籌碼預熱第二，TDCC 歷史表單第三。這確保較可靠的新週資料不被較慢的歷史操作拖延。

### 5. 不新增 queue table，重用 fetch-state 作為工作狀態

四類日資料已各自保存 `coverage_start`、`coverage_end`、`status`、`reason_code`、`last_success_at`、`last_attempt_at` 與 `retry_after`。預熱 discovery 以這些欄位判斷是否需要工作，避免新增與實際資料狀態可能漂移的第二套 queue。

## Risks / Trade-offs

- [清單台股增加後可能超過單次 workflow 時間] → 限制每次 target 數並依最舊成功時間公平排序，下一次排程續跑。
- [FinMind 免費額度或 rate limit] → 一個 symbol 一次請求、沿用 retry-after 與官方最新 fallback；不得以高併發重試。
- [部分 ETF 沒有某類資料] → 保存 `not_published`／`partial_data`，其他 dataset 仍視為可用，不補造數值。
- [Worker `waitUntil` 提前終止] → durable scheduler 重新辨識缺口，不以立即預熱成功作唯一保證。
- [TDCC 歷史頁出現 CAPTCHA 或封鎖] → 只阻擋 TDCC 歷史 lane；日籌碼與 TDCC 最新 OpenAPI 繼續運作。

## Migration Plan

1. 新增背景預熱 service、受保護 target action、runner 與 health 欄位，不變更既有 D1 schema。
2. 先在測試環境驗證新增普通股／ETF後立即預熱、stale 排序、重跑冪等及失敗隔離。
3. 部署 Worker 後設定 `TDCC_HISTORY_AUTOMATION_ENABLED=true`，再部署相同版本讓環境 revision 生效。
4. 手動執行 workflow，觀察既有清單 targets 逐步變成 ready，並抽查普通股與 ETF API。
5. 回滾時可將 TDCC 歷史 automation 設回 `false` 或停用 workflow；既有 D1 籌碼資料保留，前端仍可按需補抓。

## Open Questions

- 若未來「我的清單」規模超過免費額度，需再加入每個使用者優先級或分日配額；本次先以全站去重 symbol 與有限批次處理。
