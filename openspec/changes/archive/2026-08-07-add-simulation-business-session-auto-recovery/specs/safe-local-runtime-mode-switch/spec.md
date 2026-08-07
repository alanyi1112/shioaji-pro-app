## ADDED Requirements

### Requirement: Simulation business session 必須由有界 watchdog 自動恢復
系統 MUST 以獨立的使用者層級 watchdog 每 30 秒執行一次固定、有界且唯讀的 2330 Snapshot business probe，並 MUST 將 HTTP listener、`/health`、實際 mode 與 business availability 分層判定。只有 mode marker 與 `/api/v1/info` 都顯示 simulation、目前 API generation 曾取得合法非空 Snapshot，且連續三次明確回傳 `SessionNotEstablished` 時，watchdog 才能建立 recovery incident 並重啟 simulation API。

#### Scenario: 已建立的 simulation session 中途失效
- **WHEN** 目前 API generation 已通過 business probe，之後在 HTTP health 仍成功時連續三次回傳 `SessionNotEstablished`
- **THEN** watchdog 建立單一 recovery incident，並只對 simulation API LaunchAgent 執行一次受控重啟

#### Scenario: 任一次 business probe 恢復成功
- **WHEN** 尚未達重啟門檻前取得合法非空 Snapshot
- **THEN** watchdog 清除 consecutive failure count 並維持目前 API generation 為 healthy／armed

#### Scenario: 初始 session 從未建立
- **WHEN** 新的 API generation 在至少 90 秒 warm-up 後仍未曾取得合法 business Snapshot
- **THEN** watchdog 維持 unarmed 與可診斷的離線狀態，不得僅因 `SessionNotEstablished` 自動重啟

#### Scenario: 非 session-specific 錯誤
- **WHEN** 市場沒有新 Tick、SSE 沒有事件、單次 timeout、listener down、mode mismatch、一般 HTTP 錯誤或 response shape 不合法
- **THEN** watchdog 只記錄固定安全 reason code，且不得把該結果計入 `SessionNotEstablished` 重啟門檻

### Requirement: Watchdog 重啟必須有限且不得擴大影響範圍
watchdog MUST 只以 `launchctl kickstart -k` 或等效 user-domain 操作重啟已安裝的 simulation API job，MUST NOT 執行完整模式切換，且 MUST NOT bootout、bootstrap、重啟或寫入 5173、5174、MultiView D1、daily pipeline 或 TDCC pipeline。每次重啟後 MUST 保留至少 90 秒 recovery grace；單一 incident 的後續重啟 MUST 至少套用 2 分鐘與 5 分鐘退避，總次數 MUST 不超過三次，耗盡後 MUST 進入 circuit-open。

#### Scenario: 第一次自動重啟
- **WHEN** armed simulation generation 達到連續三次 `SessionNotEstablished` 門檻
- **THEN** 系統只重啟 8080 simulation API，且 5173、5174、D1 與盤後 pipeline 維持目前生命週期與資料狀態

#### Scenario: 重啟後 session 仍未建立
- **WHEN** recovery grace 結束後 business probe 仍明確回傳 `SessionNotEstablished`
- **THEN** watchdog 依 2 分鐘、5 分鐘的最小退避安排後續嘗試，且相同 incident 最多執行三次重啟

#### Scenario: 重啟上限耗盡
- **WHEN** 相同 recovery incident 已執行三次重啟且仍未取得合法 Snapshot
- **THEN** watchdog 進入 circuit-open、停止自動重啟並持續提供安全診斷，直到 Snapshot 成功或使用者明確執行 simulation 回復命令

#### Scenario: Session 恢復
- **WHEN** recovery incident 期間取得合法非空 Snapshot
- **THEN** watchdog 清除 incident、退避與 circuit 狀態，將目前 API generation 標示為 healthy／armed

### Requirement: Watchdog 生命週期與狀態必須遵守 simulation 安全邊界
runtime install MUST 安裝並載入 simulation watchdog；simulation 回復命令 MUST 重設 watchdog incident 並啟動新的 warm-up；production-readonly 切換 MUST 在啟動 production API 前停止 watchdog；uninstall MUST 移除 watchdog job、plist 與純診斷 state。watchdog MUST NOT 切換至 production、載入 CA、呼叫交易／帳務／server-management API，或保存任何秘密及個人資料。

#### Scenario: 切換 production-readonly
- **WHEN** 使用者明確執行 production-readonly 模式切換
- **THEN** runtime 在啟動 production API 前停止 watchdog，且該 watchdog 不得重啟或取代 production job

#### Scenario: 查看 runtime status
- **WHEN** 使用者執行 `pnpm local-runtime status`
- **THEN** 輸出 watchdog job、state、consecutive failure、restart count、last reason 與 next eligible time 的固定安全摘要
- **AND** 輸出不得包含 response body、商品清單、帳戶、environment、API key、secret 或 CA 資料

#### Scenario: 移除本機 runtime
- **WHEN** 使用者執行一般 uninstall
- **THEN** watchdog job、plist 與純診斷 state 被移除，且 `.env`、MultiView D1、備份、清單與設定保持可復原
