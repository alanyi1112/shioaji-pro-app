## Context

正式站第 60 版的 `POST /api/taiwan-stock-chip/backfill` 會將 TDCC symbol 設為 `queued`，但真正抓取官方歷史表單的是每日 GitHub Actions。實測 2026-07-19 手動 dispatch 後，workflow 成功結束卻回報 `completedSymbols: 0`、`completedWeeks: 0`。原因是 runner 在 `start-run`、`refresh-latest` 與 `claim` 前會重新同步目標；`saveTdccContinuousTarget` 以目前已保存週數同時填入 expected 與 completed，導致只有 2 週資料的 `queued` symbol 被覆寫為 `completed`，claim 因而取不到工作。

前端收到 202 後只在 1.8 秒後重載一次。即使外部 runner 稍後完成，使用者仍會看到舊的兩個點，除非整頁重新整理。現有 durable scheduler 與 GitHub runner 已具備官方來源節流、checkpoint、lease、validator 與秘密隔離，本變更沿用該路徑，不在瀏覽器或 Worker 另做一套 TDCC 歷史爬取器。

## Goals / Non-Goals

**Goals:**

- 未達 `TDCC_CONTINUOUS_CONTRACT.minimumHistoryWeeks` 的 symbol 必須維持可 claim 的 `queued`／`partial` 狀態。
- 使用者點選立即回補後，由 Worker 的伺服器端 GitHub API 呼叫立刻 dispatch 既有 workflow，並以 D1 去重與冷卻避免重複啟動。
- 前端持續讀取該 symbol 的 coverage 與 backfill 狀態；每當保存週數增加就重畫線圖，直到完成、受阻或達安全期限。
- 新增清單台股仍由 Worker 預熱日資料、由 durable runner 補 TDCC 歷史，且 health 能區分日資料預熱與 TDCC 歷史完成度。

**Non-Goals:**

- 不從瀏覽器直接呼叫 GitHub API，也不把任何 GitHub token 回傳前端。
- 不提高 TDCC 官方查詢併發、不縮短既有至少一秒間隔，也不規避 CAPTCHA 或來源限制。
- 不把「立即」解讀成同步等待 51 週全部完成；它表示 runner 立即啟動、進度可見，資料寫入即時反映。
- 不為整個台股市場建立歷史回補，只處理既有 setup、使用者清單與 baseline 後的新上市合格商品。

## Decisions

### 1. 完成判定必須包含最低歷史週數

`tdccContinuousTargetSyncState` 除了比較 `completedWeeks >= expectedWeeks` 與 `missingDates`，還必須要求 expected／completed 至少達 51 週。既有狀態為 `queued` 且覆蓋不足時必須保留 `queued`；已有部分資料則使用 `partial`。這可避免每次 target refresh 抹掉人工或清單建立的 queue。

替代方案是只在 `claim` 前略過 target refresh，但其他 action 仍會重算狀態，且會失去最新清單 discovery，因此不採用。

新上市商品的上市前官方週次不可能存在真實持股資料；規劃時仍將這些週次納入完整官方日期集合，並以 `pre_listing` 合法缺值完成。如此既不補造線圖點，也能讓有效覆蓋總數達到最低歷史週數，避免同一商品在沒有缺週時被反覆 claim。

### 2. 沿用 GitHub runner，Worker 只負責安全 dispatch

Worker 新增伺服器端 `dispatchTdccContinuousWorkflow`，使用 runtime secret `[REDACTED_SECRET]` 呼叫 GitHub Actions workflow dispatch API。GitHub owner、repo、workflow 與 ref 使用程式常數，不接受前端輸入；回應只保留 `started`、`already-running`、`cooldown`、`unavailable`、`failed` 等安全狀態。

替代方案包括提高每日 cron 頻率，或把官方歷史表單搬到 Worker。前者仍不是立即，後者會複製 session/parser/節流邏輯並受 Worker background lifetime 限制，因此不採用。

### 3. D1 保存 dispatch 去重狀態

新增輕量 dispatch 記錄，至少包含 symbol、狀態、requested time、cooldown 與安全錯誤碼。若已有新鮮的 running run 或冷卻期內成功 dispatch，API 不再重複啟動；失敗或未設定時可明確回報並保留 durable queue，讓每日 scheduler 接手。

### 4. 前端以 coverage 變化驅動重畫

右鍵功能表顯示「立即回補歷史資料」。API 回應 `dispatch.started` 後，前端以漸進間隔輪詢該 symbol 的籌碼 API；每次先清除 request cache，再比較 `savedWeeks`、`completedWeeks`、`missingDates` 與 status。任何保存週數增加都立刻呼叫既有 `load()` 重畫；完成、blocked、failed 或達輪詢上限時停止。切換 symbol、移除副圖或銷毀 controller 時必須取消 timer。

### 5. 正式驗收以個別 symbol 為準

全域 `dataDate` 或 workflow `success` 不能證明歷史回補完成。驗收必須選一檔原本只有少量週資料的清單台股，記錄操作前後 `coverage.savedWeeks`、`expectedWeeks`、`missingDates`、`backfill.status` 與圖表點數，並核對 GitHub run 的 `week-complete` 事件。

## Risks / Trade-offs

- [GitHub dispatch secret 尚未設定] → API 明確回傳 `unavailable` 並保留 queue；正式啟用前以 Sites runtime secret 設定，文件與 log 僅使用 `[REDACTED_SECRET]`。前端不得因 D1 保存過去的 `unavailable` 紀錄而永久停用操作，設定補齊後仍需允許使用者再次要求立即回補。
- [使用者重複點擊造成 Actions 浪費] → D1 冷卻、running heartbeat 與 GitHub concurrency 三層去重。
- [單次 runner 只能處理有限週數] → 前端顯示逐批進度，symbol 保持 `partial`，後續立即或每日 run 從 checkpoint 續跑。
- [前端輪詢增加 API 流量] → 只在使用者主動回補的 symbol 啟動，採漸進間隔、單一 timer 與硬上限。
- [GitHub API 暫時失敗] → 不清除 queue；回傳安全失敗狀態，durable scheduler 仍可接手。

## Migration Plan

1. 先部署狀態判定、D1 dispatch 記錄、API 與前端輪詢；未設定秘密時 fail closed。
2. 於 Sites runtime 設定 GitHub workflow dispatch 的 fine-grained secret，權限只限本 private repo 的 Actions workflow 寫入；不得提交至 repo。
3. 部署後以一檔覆蓋不足的清單台股觸發立即回補，確認 workflow 立刻建立且週數開始增加。
4. 若需 rollback，移除 dispatch secret 並回退部署；既有每日 scheduler、D1 queue 與已寫入資料可繼續運作。

## Open Questions

- 正式環境需要一次性設定 GitHub fine-grained workflow dispatch secret；秘密值不得在 OpenSpec、commit、log 或對話內容中傳遞。
