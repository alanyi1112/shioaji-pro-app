## MODIFIED Requirements

### Requirement: 明確顯示離線或非服務時間
系統 MUST 在降級狀態下於頂部狀態與工作區提示列清楚區分本機 API 未啟動、simulation 業務 session 離線、production-readonly 行情 session 未建立或市場休市且暫無新 tick，且 MUST 說明受影響的行情、自選與交易功能。

#### Scenario: simulation 業務 session 降級
- **WHEN** watchlist 初始化在 simulation 模式因 `SessionNotEstablished` 失敗
- **THEN** 頂部狀態不得顯示 `LIVE`，並顯示可辨識的 simulation 離線狀態與繁體中文說明

#### Scenario: production-readonly 行情 session 未建立
- **WHEN** server 為 production-readonly 且行情業務 API 回傳 `SessionNotEstablished`
- **THEN** 系統顯示「正式行情尚未建立」而非「模擬服務離線」，並維持交易寫入封鎖

#### Scenario: 本機 API 未執行
- **WHEN** 前端無法連線至 Shioaji HTTP server
- **THEN** 系統顯示本機 API 未啟動，且不得誤稱為市場收盤或非服務時間

#### Scenario: 市場休市但連線健康
- **WHEN** HTTP health 與行情 session 可用但 SSE 暫無新 tick
- **THEN** 系統保留連線健康狀態，不因沒有新成交而判定服務中斷
