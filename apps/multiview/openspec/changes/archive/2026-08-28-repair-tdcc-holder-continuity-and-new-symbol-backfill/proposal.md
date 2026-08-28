## Why

MultiView 的 TDCC 大戶持股、散戶持股目前可能以資料筆數取代官方週次身分判斷，導致中間缺週仍被標示為 `completed`；新增商品雖已建立 queue，但本機立即 dispatch 不可用時會等待週末排程，畫面又沒有揭露真實回補進度。這會讓大立光漏掉 `2026-08-07`、`2026-08-14`，也讓晶呈科技只顯示最新一週而沒有開始完整歷史回補。

## What Changes

- 將 TDCC 完整度改為以最近官方日期集合逐週核對，不再以 row count、`expectedWeeks === completedWeeks` 或最新快照日期單獨宣告完成。
- 最新官方快照前進時，重新比對每個 active symbol 的已保存週次與合法 `pre_listing`／`not_published` gap，為中間缺週建立耐久工作，並將錯誤的 `completed` 降回 `queued` 或 `partial`。
- 為新增商品提供有界且可觀測的立即交接：先保存 target／queue；遠端 deployment 嘗試既有受保護 workflow dispatch，本機則由不接觸 TDCC 來源的輕量 queue watcher 在短時間內喚醒既有 single-flight runner，而不是只能等待週末排程。
- 全面 reconcile 既有 active targets，只回補缺少的官方週次並保留已驗證資料；明確修復大立光缺少的兩週，以及晶呈科技最近一年歷史計畫。
- 讓大戶、散戶與集保戶數副圖依目前 symbol 顯示官方週次 coverage、缺週、排隊／執行進度與安全錯誤狀態；最新一週可先繪製，但不得掩蓋歷史仍不足。
- 補齊逐 symbol D1 稽核、runner handoff、非退化畫面更新、實際 DOM／Canvas／console 與排程文件驗證。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `tdcc-continuous-backfill`：以官方日期集合判定完整度，最新快照前進時自動 reconcile 中間缺週，並讓新增商品在本機與遠端 deployment 都有耐久且有界的 runner 交接。
- `watchlist-chip-prewarming`：新增商品保存後，日籌碼與 TDCC 歷史回補必須各自留下可接手的背景工作，且本機立即 dispatch 不可用時不得只依賴週末 cron。
- `taiwan-stock-chip-subcharts`：大戶、散戶與集保戶數副圖必須揭露逐 symbol 真實 coverage／missing dates／queue 進度，不能把最新一週或錯誤 `completed` 顯示成歷史完整。

## Impact

- Worker／D1：`worker/tdcc-continuous-backfill.ts`、`worker/app.ts`、TDCC target／item／run state 與必要 migration。
- 本機 runtime：`scripts/realtimestock-runtime` 的 TDCC queue watcher、single-flight／cooldown 與週末主同步／隔日重試邊界。
- 歷史 runner：`scripts/tdcc-history-backfill.mjs` 的 claim 前檢查、官方日期計畫與缺週續跑。
- 前端：`public/static/chip-panes.js` 的 holder coverage 狀態、輪詢、快取失效與非退化重畫。
- 驗證：逐 symbol 官方日期集合稽核、D1 migration／behavior tests、瀏覽器 holder panes、Canvas、console 與操作手冊一致性。
- 不新增付費資料源，不保存或輸出任何秘密，也不改變 TDCC 每週實際 `dataDate`、不 forward-fill／插值／補造資料。
