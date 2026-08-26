## Context

目前 TDCC cache state 只用 `last_success_at < 8 days` 判斷可覆蓋請求，未將 `source_date` 與「此刻應已公布的最新週」比較。2026-08-21 上午在官方新一期尚未出現前成功取得 2026-08-14，會讓舊週資料持續被視為 fresh；同日稍後加入的 `3441.TWO` 雖建立 durable target，但本機 TDCC LaunchAgent 只有單一週六時段且執行失敗，因此只留下 1 週資料。每日 orchestrator 的 scheduled handler 又只執行一個 batch，任何單一目標的 `invalid_response` 都可能讓整輪 50 個目標停在 0。

前端 chip pane manager 會在 tab identity 變化或主圖載入前收到 `candles=[]` 時清除 payload 與 series。即使商品與週期沒有改變，已成功顯示的大戶／散戶線仍會在主圖重建期間消失。現有 health 還把 TDCC heartbeat 當成每日預熱 heartbeat，使營運狀態無法準確指出是哪一條 pipeline 停止。

## Goals / Non-Goals

**Goals:**

- 以台北時間與 TDCC 每週發布窗口判斷最低可接受資料週，官方新週應已發布後不得沿用前一週快取。
- 讓新商品、缺週商品與日籌碼目標在 durable queue 中可續跑，單一目標錯誤不拖垮整批。
- 同商品、同週期的 transient empty context 或 fetch error 保留最後成功副圖，資料來源真正改變時則立即隔離舊 payload。
- 讓本機 TDCC 排程、scheduled handler 與 health 訊號反映各自真實工作狀態。

**Non-Goals:**

- 不更換 TDCC、TWSE、TPEx 等正式資料來源。
- 不新增 D1 schema，不偽造休市週或尚未發布資料。
- 不將歷史表單抓取搬入互動式請求，也不取消既有受保護 control plane。

## Decisions

### 1. 以「最低可接受資料週」而非精確星期五判定 TDCC 新鮮度

系統依 `Asia/Taipei` 計算最近一個已通過發布窗口的資料週，回傳該週星期一作為最低可接受日期。這可使正常星期五資料與因休市落在星期四等同週 business day 都被接受；發布窗口前仍接受前一週，避免官方尚未更新時持續重打。相較固定 8 天 TTL，此判定直接對應資料契約；TTL 只保留為同週內的額外上限。

### 2. 最新快照早於 requested range 不再視為 coverage

只有 `source_date > requested end` 可表示查詢的是較舊歷史區間。`source_date < requested start` 代表最新快照仍不足，必須進入 refresh，而不是把空的 requested range 誤判為已覆蓋。

### 3. Scheduled handler 使用有上限的多 tick 續跑

一次 schedule 喚醒會重複呼叫同一 D1 run 的 tick，直到 `done=true`、沒有進度或達到合約上限。每個 symbol 的 eligibility／provider 錯誤會被轉成安全 reason 並繼續下一個目標；run-level D1 或契約錯誤才終止整輪。相較把 batch size 無限制放大，此作法仍保留 checkpoint、執行時間與重試邊界。

### 4. 前端以 data-source identity 決定是否清除 payload

`tabId` 或 selection identity 改變只重建 pane 結構；只有 canonical symbol 或 interval 改變才清除舊 payload。若新 context 的 candles 暫時為空且 data source 相同，manager 保留前一份非空 candles 與最後成功 payload，待主圖資料到達再 reconcile。真實換股時仍先清除，避免跨商品殘影。

### 5. 排程與健康狀態各自對應真實資料流

本機 TDCC LaunchAgent 對齊週六主要窗口與週日有限重試；每日預熱 health 改讀 `chip_backfill_orchestrator_runs`，TDCC health 繼續讀 `tdcc_continuous_runs`。靜態 seed report 只標示為 seed snapshot，不代表目前 pipeline 成功。

## Risks / Trade-offs

- [TDCC 實際發布延遲超過窗口] → refresh 會得到同一期並成功 no-op，週日重試與下一輪仍會接續，不清除既有資料。
- [休市週最後營業日不是星期五] → 接受同一資料週內任何合法 `dataDate`，不要求固定星期五。
- [單次 scheduled invocation 處理時間過長] → tick 數與目標數維持合約上限，沒有進度時提前停止並保留 D1 checkpoint。
- [保留 payload 顯示短暫舊資料] → 僅限同 symbol／interval，並保留實際 source date 與 warning；跨來源一律清除。

## Migration Plan

1. 先部署純程式與測試，不變更 D1 schema。
2. 重新安裝本機 runtime 時由既有 install 流程更新 LaunchAgent 排程；已存在 durable queue 不需重建。
3. 透過受保護 TDCC tick 或下一個週末窗口補入 2026-08-21，`3441.TWO` 由既有 queued target 接續歷史回補。
4. 若發生回歸，可回退 Worker／static bundle 與 LaunchAgent 定義；D1 已寫入的合法 rows 保持冪等且無需刪除。

## Open Questions

無。TDCC 官方頁面已確認資料為每週最後營業日且保存一年，OpenAPI 已可讀取 2026-08-21，`3441` 亦存在完整 17 級資料。
