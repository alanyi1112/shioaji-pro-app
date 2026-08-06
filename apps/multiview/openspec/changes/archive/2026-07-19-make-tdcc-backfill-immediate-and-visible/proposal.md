## Why

目前「回補歷史資料」只把 TDCC 商品標記為 `queued`，但 runner 啟動時的目標同步會把僅有少量週資料的商品誤判為 `completed`，因此實際執行結果可能為 `completedSymbols: 0`、`completedWeeks: 0`。此外，使用者操作後只會看到「已排入回補」，前端也只重載一次，無法保證立即啟動 runner 或在新資料寫入後自動更新線圖。

## What Changes

- 修正 TDCC 目標同步判定：未達 51 週最低歷史覆蓋時，不得把 `queued` 或 `partial` 誤判為 `completed`。
- 讓使用者從副圖右鍵要求回補時，除了排入佇列，也安全地要求 GitHub Actions runner 立即啟動；伺服器未設定 dispatch 憑證時必須明確回報降級狀態，不得顯示成已立即啟動。
- 前端在回補進行中依每個商品的 `backfill.status`、`coverage` 與 `missingDates` 輪詢，資料筆數增加時立即重畫大戶／散戶線圖，直到完成、受阻或逾時。
- 新增 dispatch 去重、冷卻時間與伺服器端秘密保護，避免連續右鍵操作重複啟動 workflow。
- 確認「我的清單」內符合資格的台股仍會加入背景回補目標，並以未達最低週數的商品可被 runner claim 作為驗收條件。

## Capabilities

### New Capabilities

- `immediate-chip-backfill`: 定義使用者要求立即回補時的 runner 啟動、降級回應、前端進度追蹤與資料更新行為。

### Modified Capabilities

- `tdcc-continuous-backfill`: 修正最低歷史覆蓋、佇列狀態保存、claim 與逐批完成的需求。
- `watchlist-chip-prewarming`: 補強新加入清單台股的 TDCC 背景目標建立與健康驗證需求。

## Impact

- Worker API：`POST /api/taiwan-stock-chip/backfill`、TDCC 目標同步與健康狀態。
- 前端：`public/static/chip-panes.js` 的右鍵回補狀態、輪詢與圖表重載。
- 自動化：`.github/workflows/tdcc-continuous-backfill.yml` 的 `workflow_dispatch` 啟動路徑。
- Runtime 設定：新增僅限伺服器端使用的 GitHub workflow dispatch 秘密值；規格與紀錄僅使用 `[REDACTED_SECRET]`，不得回傳到瀏覽器或 log。
- 測試與正式驗收：狀態轉換、dispatch 去重、前端輪詢、GitHub Actions 執行事件與個別商品覆蓋筆數。
