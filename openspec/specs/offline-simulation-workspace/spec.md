# offline-simulation-workspace Specification

## Purpose
TBD - created by archiving change allow-offline-simulation-workspace. Update Purpose after archive.
## Requirements
### Requirement: 服務不可用時允許進入工作區
當 Shioaji 本機 HTTP server 可回應，但 server-backed watchlist 因 `SessionNotEstablished` 無法取得時，系統 MUST 結束全畫面載入狀態並渲染既有工作區。

#### Scenario: 模擬 session 未建立
- **WHEN** 初始 watchlist 請求回傳含有 `SessionNotEstablished` 的錯誤
- **THEN** 系統結束「載入交易終端…」並以空白 watchlist 進入工作區

#### Scenario: 後端短暫啟動競態
- **WHEN** 初始 watchlist 請求因非 `SessionNotEstablished` 的暫時性錯誤失敗
- **THEN** 系統先進行有限度退避重試，再於仍失敗時降級進入工作區

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

### Requirement: 服務恢復後可重新連線
系統 MUST 提供重新檢查操作，並在 watchlist 服務恢復時載入 server-backed watchlist、清除離線提示且恢復正常狀態。

#### Scenario: 手動重新檢查成功
- **WHEN** 使用者在服務恢復後按下「重新檢查」且 watchlist 請求成功
- **THEN** 系統載入自選清單、解除離線提示並更新工作區資料

#### Scenario: 手動重新檢查仍失敗
- **WHEN** 使用者按下「重新檢查」但 `SessionNotEstablished` 仍存在
- **THEN** 系統保留工作區與離線提示，不重新顯示全畫面載入狀態

### Requirement: 工作區必須偵測中途 business session 失效並自動恢復
RealTimeStock Web MUST 以單一 document-scoped、simulation-only 且低頻的唯讀 business probe 判斷行情 session，不得以 SSE open、heartbeat 或沒有新 Tick 取代 business success。已載入工作區若收到 `SessionNotEstablished`，系統 MUST 非阻塞切換為 `OFFLINE`，保留既有版面並啟動 single-flight 自動重新檢查；重試延遲 MUST 依 5、10、20、30 秒增加並以 30 秒封頂。

#### Scenario: SSE 仍連線但 business session 失效
- **WHEN** 行情 SSE 仍為 open 或持續 heartbeat，但 simulation business probe 回傳 `SessionNotEstablished`
- **THEN** 頂部狀態與工作區提示切換為 simulation `OFFLINE`，且不得繼續標示 `LIVE`
- **AND** 系統保留工作區，不重新顯示全畫面 boot gate

#### Scenario: 自動重新檢查成功
- **WHEN** 自動重試期間 watchlist 與 business request 恢復成功
- **THEN** 系統自動載回 server-backed watchlist、清除離線提示、恢復正常資料狀態並只顯示一次恢復通知

#### Scenario: 自動重新檢查持續失敗
- **WHEN** 自動重試仍收到 `SessionNotEstablished` 或暫時無法連線
- **THEN** 系統依有界退避維持 single-flight 重試、保留可操作工作區與手動「重新檢查」，且不得產生併發 request storm

#### Scenario: 手動重新檢查與 timer 同時發生
- **WHEN** 使用者在自動重試即將執行或已執行時按下「重新檢查」
- **THEN** 系統合併為一個立即的 single-flight 嘗試，不得同時執行兩組初始化或重複建立 watchlist

#### Scenario: 休市但 business probe 成功
- **WHEN** HTTP health 與唯讀 business probe 成功，但市場休市且 SSE 沒有新 Tick
- **THEN** 系統維持連線健康，不得啟動離線自動恢復流程

### Requirement: 前端自動恢復不得取得 runtime 控制權
Web 的 business monitor 與自動重新檢查 MUST 只呼叫既有唯讀行情、watchlist 與 subscription 路徑；MUST NOT 暴露或呼叫 `launchctl`、runtime restart、mode switch、order、account 或 CA API。自動重啟權限 MUST 僅存在於本機 simulation watchdog。

#### Scenario: Browser 偵測 SessionNotEstablished
- **WHEN** 5173 在 simulation 收到 business session 失效結果
- **THEN** browser 只更新 UI、執行唯讀資料重試並等待 runtime 恢復，不得直接要求或執行本機程序重啟

#### Scenario: 非 simulation 模式
- **WHEN** 實際 runtime mode 不是 simulation
- **THEN** simulation business monitor 與自動 session 修復 MUST 停止，且既有 production-readonly 交易寫入封鎖保持不變
