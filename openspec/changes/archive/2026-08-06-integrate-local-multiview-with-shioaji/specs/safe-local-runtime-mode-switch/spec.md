## ADDED Requirements

### Requirement: MultiView 服務必須納入本機 runtime 生命週期
本機 runtime install MUST 安裝並啟動獨立 MultiView LaunchAgent，status、simulation 與 uninstall MUST 一併管理 5174 服務，但 MultiView 失敗 MUST NOT 停止或重設 5173／8080。重新登入或重開機後仍 MUST 以 simulation 為預設，MultiView 不得自行切換至其他模式。

#### Scenario: 安裝本機 runtime
- **WHEN** 使用者執行 runtime install 且 dependency 與本機資料路徑通過檢查
- **THEN** simulation API、RealTimeStock Web 與 MultiView Web／Worker LaunchAgent 均被安裝並在 loopback 啟動
- **AND** 任何非 simulation job 維持未自動載入

#### Scenario: MultiView 啟動失敗
- **WHEN** 5174 因 dependency、port 或 D1 問題未通過 health
- **THEN** runtime status 明確標示 MultiView 失敗，5173／8080 的既有模式維持不變
- **AND** 系統 MUST NOT 為修復 MultiView 自動切換至非 simulation 模式或讀取秘密

### Requirement: MultiView 必須只在 simulation 運作並保持 data-only
MultiView 啟動及每次行情／契約／串流請求 MUST 重新確認 8080 的實際模式與 business availability。只有 simulation 可建立 SSE、訂閱或讀取行情；任何非 simulation 模式 MUST 停止 5174 或回 `simulation_required`。5174 adapter 的 order／account／CA 禁止規則 MUST 永久保持相同。

#### Scenario: simulation 啟動 MultiView
- **WHEN** 8080 回報 simulation 且 business request 通過
- **THEN** MultiView 依目前可見商品 bootstrap 並建立去重 SSE
- **AND** data-only allowlist 不得新增任何交易或帳務路徑

#### Scenario: runtime 切至非 simulation
- **WHEN** 8080 回報非 simulation，或模式在現有 SSE 期間改變
- **THEN** runtime MUST 停止 5174，且 adapter MUST 清除行情 provisional、SSE、訂閱與契約快取
- **AND** 手動啟動的 5174 也 MUST 回 `simulation_required`，不得讀取或顯示該模式行情

### Requirement: Runtime status 必須分別呈現三個服務與 MultiView 資料層
狀態診斷 MUST 分別顯示 Shioaji API listener／mode／business test、RealTimeStock 5173、MultiView 5174、MultiView D1 integrity、即時來源與盤後 pipeline 摘要。單一 HTTP 200、SSE heartbeat 或 listener MUST NOT 代表其他層正常。

#### Scenario: 5174 正常但 D1 損壞
- **WHEN** MultiView Web 可回 200，但 D1 integrity 或 schema gate 失敗
- **THEN** status MUST 分別顯示 Web up 與 data unhealthy
- **AND** 盤後功能不得標示 ready

#### Scenario: Shioaji 健康但行情 session 未建立
- **WHEN** 8080 health 成功但 Snapshot／Kbars business test 失敗
- **THEN** status MUST 顯示 API up、market unavailable 與 MultiView delayed fallback
- **AND** 不得顯示 Shioaji realtime ready

### Requirement: Uninstall 不得未經確認刪除 MultiView 資料
runtime uninstall MUST 停止並移除本工具建立的 MultiView LaunchAgent 與安裝腳本，但 MUST 預設保留本機 D1、備份、清單與設定。任何資料刪除 MUST 是另外、明確且指向精確路徑的操作。

#### Scenario: 一般 uninstall
- **WHEN** 使用者執行 runtime uninstall
- **THEN** 5174 job 與 plist 被移除，本機 D1、備份與個人清單仍可復原
- **AND** 輸出明確告知資料保存位置且不包含個人內容
