## Why

目前台股籌碼背景工作雖由 GitHub Actions 自動執行，但日籌碼與 TDCC 最新快照的流程編排仍放在未隨 Sites 發布的 Node runner；同時預熱視窗把非交易日當成必要資料日，造成週末所有目標誤列 pending，且單次 40 檔上限沒有明確的同輪續跑終態。需要把可在 Worker 安全執行的編排程式部署到網站 runtime，讓外部排程只負責喚醒，而不是承載產品業務邏輯。

## What Changes

- 在 Sites Worker 新增受保護的籌碼背景 orchestrator，以 D1 run 狀態執行目標同步、TDCC 最新 OpenAPI 快照、日籌碼有限批次預熱、heartbeat、續跑與完成判定。
- 讓 Worker entry 同時提供 Cloudflare `scheduled` handler；在 Codex Sites 尚未提供 cron 綁定時，GitHub Actions 僅以受保護 HTTP tick 喚醒相同 orchestrator。
- 將日籌碼預期終點改為 Asia/Taipei 最近已完成交易日，週末不得要求不存在的當日資料；來源尚未發布時保留 pending 原因，不得以請求日期冒充 coverage。
- 將單次 40 檔改為 D1 可觀測的有限批次與近期嘗試冷卻，使同一排程 run 能逐批處理所有到期目標，且不會在同輪反覆挑到同一 symbol。
- GitHub workflow 移除最新 TDCC 與日籌碼的 Node 業務編排，只保留薄型 tick 迴圈；TDCC 歷史可見表單因 session、來源規範與長時間限制，保留為明確分離的外部 source adapter，queue、claim、plan、lease、ingest 與完成狀態仍由 Sites Worker／D1 決定。
- health 增加 orchestrator 的 trigger、phase、處理批次、剩餘 due、預期交易日與來源等待原因，區分「官方尚未發布」、「本輪尚未輪到」與真正失敗。
- 薄型 workflow 僅輸出 allowlist 的 phase／status／processed／remaining／pending／reason 摘要；HTTP 失敗或 tick 上限到期時，必須呼叫受保護失敗終結點，將 orchestrator 與 TDCC run 收尾為 failed／retry-waiting，避免 D1 長期遺留 `running`。
- 將每日籌碼預熱與每週 TDCC 最新快照拆成不同 scope 與 workflow：每日流程不得抓取 TDCC，TDCC 流程不得重跑日籌碼；每週發布檢查於週末執行，並保留下一日一次有限重試。
- 新增商品啟用後不等待背景排程：立即預熱日籌碼、註冊並排入 TDCC 歷史 queue，且依 Sites／Cloudflare 部署目標觸發對應的每週 TDCC workflow；若外部 dispatch 暫時不可用，D1 queue 必須保留供後續排程接續。

## Capabilities

### New Capabilities

- `sites-chip-backfill-orchestrator`: 定義部署於 Sites Worker 的籌碼背景 orchestrator、受保護 tick、scheduled handler、D1 run 狀態與薄型外部喚醒契約。

### Modified Capabilities

- `watchlist-chip-prewarming`: 將預熱視窗改為最近已完成交易日，並新增有限批次續跑、公平性、同輪冷卻及可觀測剩餘工作。
- `tdcc-continuous-backfill`: 將 TDCC 最新快照編排移入 Sites Worker，並明確分離網站內 orchestrator 與只負責歷史來源 session 的外部 adapter。

## Impact

- 影響 `worker/app.ts`、`worker/index.ts`、`worker/watchlist-chip-prewarming.ts`、`worker/tdcc-continuous-backfill.ts` 與新增的 Worker orchestrator 模組。
- 拆分 Sites／Cloudflare 的每日籌碼與每週 TDCC workflows，並調整 TDCC runner 參數，使 GitHub Actions 僅執行 scoped tick 與必要的歷史 source adapter。
- 可能新增 D1 migration，以保存 orchestrator run phase、批次計數、預期交易日、剩餘 due 與安全錯誤碼。
- 更新 `/api/health` 的台股籌碼背景狀態與相關測試；不改變公開圖表資料格式、Sites 存取模式或既有 D1 已驗證資料。
