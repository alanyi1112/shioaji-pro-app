## ADDED Requirements

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
