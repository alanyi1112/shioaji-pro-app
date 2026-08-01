## Why

Shioaji 模擬服務在非服務時間可能只維持本機 HTTP health，卻無法建立 paper session，導致自選清單啟動流程長時間停在「載入交易終端…」。使用者需要在週末仍能進入工作區查看與調整版面，並清楚知道行情、自選與交易功能目前不可用。

## What Changes

- 將 `SessionNotEstablished` 視為可降級的服務不可用狀態，不再阻塞整個工作區。
- 在頂部狀態與工作區提示列明確顯示「模擬服務離線／非服務時間」。
- 保留手動重新檢查功能；服務恢復時重新載入 server-backed watchlist 並解除提示。
- 其他短暫啟動錯誤仍保留有限度重試，避免後端剛啟動時過早降級。

## Capabilities

### New Capabilities

- `offline-simulation-workspace`: 模擬服務 session 不可用時的非阻塞工作區、狀態提示與恢復行為。

### Modified Capabilities

無。

## Impact

- `src/hooks/use-watchlist.ts`：回報服務可用性、快速降級與重新檢查。
- `src/App.tsx`、`src/App.css.ts`：顯示離線提示列並允許工作區渲染。
- `src/components/hud-header.tsx`：避免僅以本機 SSE 狀態誤顯示 `LIVE`。
- 不新增依賴、不變更 Shioaji API、不啟用 production，也不處理或保存任何秘密值。
