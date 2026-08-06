## Why

目前本機 Web 前端與 Shioaji HTTP server 由臨時終端程序啟動，Codex 工作階段或終端結束後服務會一併停止，使用者容易誤判為收盤後無法連線。專案也缺少 simulation 與正式行情唯讀之間可驗證、可回復且不會意外啟用真實交易的切換流程。

## What Changes

- 新增 macOS 使用者層級的 simulation 常駐啟動流程，登入後自動啟動，異常退出時可重啟，且不把秘密值寫入 LaunchAgent。
- 新增單一模式切換與狀態指令，支援 `simulation` 與 `production-readonly`，確保 8080 同一時間只有一個 Shioaji server。
- 正式行情唯讀切換必須由使用者手動觸發；重新登入或開機時預設回到 simulation。
- 正式行情唯讀模式不得載入 CA，並在本機 Web 入口阻擋下單、改單、刪單及其他交易寫入 API。
- 模式切換後驗證 `/api/v1/info`、`/api/v1/health`、前端與唯讀行情；若正式行情未建立，提供明確診斷與可回復的 simulation 切換。
- 補上自動化測試與操作文件，區分「本機程序停止」、「行情 session 未建立」與「市場休市但服務仍健康」。

## Capabilities

### New Capabilities

- `safe-local-runtime-mode-switch`: 規範本機 simulation 常駐、正式行情唯讀手動切換、交易 API fail-closed 與模式健康檢查。

### Modified Capabilities

- `offline-simulation-workspace`: 擴充離線判定，讓前端能區分本機 API 未啟動、simulation 業務 session 離線與正式行情唯讀 session 未建立。

## Impact

- 影響 `scripts/`、`vite.config.ts`、本機 runtime 診斷與相關測試。
- 新增使用者層級 `LaunchAgent` 安裝／移除流程及本機忽略的 runtime 狀態檔；不新增遠端服務或資料庫。
- 不修改 API key／secret，不載入 CA，不啟用交易權限，也不呼叫真實委託 API。
