## Why

MultiView 目前只讀 TDCC OpenAPI JSON，且本機主要更新排在週六 22:30；2026-10-03 08:42（臺北時間）實測官方 CSV 已有 2026-10-02 週資料，JSON 仍停在 2026-09-24，造成大戶持股線圖晚更新。TDCC 未承諾固定發布時刻，因此應依實際來源資料日期判定，而非假設某時一定發布。

## What Changes

- 將 TDCC 官方開放資料 CSV 納入最新週資料來源，與現用 OpenAPI JSON 以資料日期及完整性擇新；來源互相矛盾時保留最後已驗證資料並記錄原因。
- 提前本機週末的有限次檢查；每次確認資料日期與結構，已是最新週次時不重複匯入或執行昂貴歷史補建。
- 保留原週末補跑作為備援，明示目前資料日期、來源與失敗／未發布狀態；不將 HTTP 200 視為新資料已發布。

## Capabilities

### New Capabilities

- `multiview-tdcc-weekly-freshness`: 官方雙來源週資料擇新、驗證、有限排程與誠實狀態。

### Modified Capabilities

- `multiview-chip-data-stability`: 新來源失敗或較舊時，大戶持股線圖仍保留最後已驗證資料。

## Impact

影響 `apps/multiview/worker` 的 TDCC 解析與最新週資料擷取、相關測試、本機 TDCC LaunchAgent 設定及維護文件。不碰 Shioaji 登入、行情訂閱、交易或 production。
