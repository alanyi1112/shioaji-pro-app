## Why

MultiView 的籌碼副圖目前可能把「最近曾成功下載」誤判為「已涵蓋最新公布週次」，使 TDCC 上週五資料與新加入商品長期停留在舊快照；前端又會在切換分頁或主圖暫時尚無 K 線時清掉已成功載入的副圖，造成線圖出現後又消失。這些問題同時被單次排程、錯置的健康狀態來源與本機排程時段放大，必須從資料新鮮度、回補、顯示狀態與可觀測性一起修正。

## What Changes

- TDCC 快取與連續回補改以「目前應可取得的最新公布週次」判斷新鮮度，不再只以最後成功時間或任一筆分布資料判定完成。
- 新加入商品與缺漏商品持續保留 durable target，排程依公布時段執行週末主同步與隔日重試，直到最新週次與歷史範圍均已補齊。
- 每日籌碼副圖排程在單次喚醒內執行有上限的多批處理，單一商品或供應者回應異常不得中止整批工作。
- 健康狀態改讀取對應的每日 orchestrator 與 TDCC scheduler 執行紀錄，避免以靜態 seed 報告或其他排程 heartbeat 誤報正常。
- 前端在同商品、同週期的暫時空 K 線或 transient fetch error 下保留最後一次成功副圖；僅在商品或週期真正改變時清除舊來源資料。
- 補上 TDCC 公布週次、聯一光類型新商品、排程容錯及副圖切換/重建情境的回歸測試。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `tdcc-continuous-backfill`: 明確要求依 TDCC 公布週次判斷最新資料、週末主同步與隔日重試，並確保新商品 durable target 不會因舊快照成功而提前完成。
- `sites-chip-backfill-orchestrator`: 排程喚醒必須在資源上限內持續處理多批目標，且隔離單一目標錯誤。
- `watchlist-chip-prewarming`: 健康狀態必須使用每日副圖 orchestrator 自身的 heartbeat 與結果，不得挪用 TDCC 執行紀錄。
- `taiwan-stock-chip-subcharts`: 同資料來源的暫時空 K 線或抓取失敗不得清除最後成功副圖；切換資料來源時不得顯示前一商品資料。

## Impact

- Worker：`worker/taiwan-stock-chip-service.ts`、`worker/app.ts`、`worker/watchlist-chip-prewarming.ts` 與相關排程/回補邏輯。
- 前端：`public/static/chip-panes.js` 的 context、payload 與 series lifecycle。
- 本機 runtime：`scripts/realtimestock-runtime` 的 TDCC LaunchAgent 排程與狀態輸出。
- 測試與文件：MultiView 的 TDCC、orchestrator、health、chip pane 回歸測試及本機 runtime 說明。
- 不變更公開 API response schema，不導入新的外部資料來源或機密設定。
