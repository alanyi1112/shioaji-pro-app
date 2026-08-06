## Why

目前正式站的 TDCC 股權分散資料只保存單一週快照，畫面雖顯示「首筆／歷史累積中」，實際上卻沒有執行歷史回補，因而無法繪製大戶／散戶持股比例趨勢與週變化柱。需要把既有「免費官方一年週歷史」要求落成可執行、可恢復且可觀測的回補流程，並清楚揭露 TDCC 是週資料而非每日資料。

## What Changes

- 新增受保護的 TDCC 歷史回補工作：以官方免費且允許自動介接的歷史輸入為優先，按資料週批次驗證、冪等寫入 D1，涵蓋官方實際保留範圍內的普通股與 ETF。
- 正式 Worker 的歷史來源尚未驗證時 MUST fail closed；經使用者明確授權後，可由本機 operator runner 依 TDCC 公開歷史查詢頁的可見表單、官方日期與證券候選，以單一併發、低速、有限重試逐檔取得目前網站清單資料，再透過受保護 ingest 匯入。runner MUST NOT 部署至 Worker、繞過 CAPTCHA／封鎖或擴張為全市場掃描。
- 最新資料仍由 TDCC `GET /v1/opendata/1-5` 全市場週快照持續更新，歷史回補與最新快照共用同一套正規化、完整度驗證與 D1 唯一鍵。
- 新增回補 checkpoint、批次上限、低併發、重試退讓與中斷續跑，避免圖表請求同步觸發大量下載，也避免重複寫入同一週。
- API／健康檢查回報預期週數、已保存週數、起訖日期、最後成功時間、回補狀態與安全錯誤碼，讓「有沒有真的回補」可直接查證。
- 大戶／散戶副圖將單筆狀態改為「目前僅 1 期／尚無前週比較」；只有工作實際進行時才顯示「歷史回補中（已完成／預期週數）」。
- 明確標示資料週期為「週資料／當週最後營業日」；非發布日維持 gap 與「當日無發布資料」，不得 forward-fill、插值或推算為每日數值。
- FinMind `TaiwanStockHoldingSharesPer` 僅列為未來可選的付費歷史來源，不納入免費必要功能，也不假設免費 `FINMIND_API_TOKEN` 可取得。

## Capabilities

### New Capabilities

- `tdcc-history-backfill`: 定義 TDCC 一年週歷史的來源驗證、批次回補、checkpoint、冪等持久化、進度觀測與安全操作契約。

### Modified Capabilities

- `taiwan-stock-chip-data`: 補強股權分散 coverage、歷史回補狀態與 API／健康檢查可觀測欄位，並明確區分週資料與每日資料。
- `taiwan-stock-chip-subcharts`: 修改大戶／散戶副圖的歷史不足與實際回補中狀態文字，並揭露週資料頻率及非發布日缺值語意。

## Impact

- 影響 `worker/taiwan-stock-chip-service.ts`、`worker/taiwan-stock-chip.ts`、`worker/app.ts`、D1 migration／repository、受保護 ingest API 與相關測試。
- 影響前端大戶／散戶 pane 的狀態文字、tooltip metadata 與回補進度顯示，但不改變既有週資料 X 軸對齊與不補值規則。
- 需要驗證 TDCC 官方歷史匯出／下載的自動介接契約；正式站維持 fail closed，本機 operator runner 僅在使用者選擇此 fallback 時依可見表單低速執行，且所有寫入仍通過受保護 endpoint 與相同驗證器。
- 不新增前端秘密；ingest secret、Sites bypass token 與任何未來付費來源 token 仍只存在 runtime 環境變數或受保護 workflow。
