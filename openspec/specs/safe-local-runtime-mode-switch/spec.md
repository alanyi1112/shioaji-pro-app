# safe-local-runtime-mode-switch Specification

## Purpose
TBD - created by archiving change add-safe-local-runtime-mode-switch. Update Purpose after archive.
## Requirements
### Requirement: 登入後預設啟動 simulation 本機服務
系統 MUST 以 macOS 使用者層級服務在登入後啟動 Shioaji simulation API 與本機 Web，且 MUST 將服務限制於 loopback 位址。

#### Scenario: 使用者登入 macOS
- **WHEN** 已安裝本機 runtime 且使用者登入 macOS
- **THEN** 系統自動啟動 simulation API 與 Web，`/api/v1/info` 回報 `simulation: true`

#### Scenario: 常駐程序異常退出
- **WHEN** simulation API 或 Web 常駐程序非預期退出
- **THEN** `launchd` 重新啟動失敗的服務，不切換到 production

### Requirement: production-readonly 必須手動且暫時啟用
系統 MUST 僅在使用者明確執行模式切換命令時啟用 production-readonly，且重新登入或重開機後 MUST 回到自動啟動 simulation 的設定。

#### Scenario: 手動切換正式行情唯讀
- **WHEN** 使用者執行 `production-readonly` 切換且前置檢查通過
- **THEN** 系統停止 simulation API、啟動唯一的 production API job，並保持 Web URL 不變

#### Scenario: 重新登入或重開機
- **WHEN** 上一個工作階段曾使用 production-readonly 後重新登入或重開機
- **THEN** production job 不會自動載入，simulation API 依預設 LaunchAgent 啟動

### Requirement: 模式切換必須互斥且可回復
系統 MUST 保證 simulation 與 production API job 不會同時占用 8080，並提供可重複執行的 simulation 回復命令。

#### Scenario: 8080 已被已知 runtime job 占用
- **WHEN** 使用者切換模式且 8080 正由另一個已知模式 job 使用
- **THEN** 系統先停止原 job、等待 port 釋放，再啟動目標模式

#### Scenario: production 行情未建立
- **WHEN** production 登入成功但唯讀行情 API 回傳 `SessionNotEstablished` 或其他失敗
- **THEN** 系統不得宣稱正式行情可用，並顯示切回 simulation 的明確操作

### Requirement: production-readonly 必須阻擋交易寫入
系統 MUST 在 production-readonly 模式阻擋下單、改價、改量、刪單、組合下單與組合刪單，且 MUST 不影響行情、帳務及委託查詢。

#### Scenario: Web 嘗試送出交易寫入
- **WHEN** production-readonly 模式下 Web 對已知交易寫入 API 發出請求
- **THEN** client guard 或 Vite proxy 以唯讀錯誤拒絕，且請求不得轉送至 Shioaji server

#### Scenario: Web 查詢委託或帳務
- **WHEN** production-readonly 模式下 Web 查詢 trades、positions 或 account data
- **THEN** 系統允許唯讀請求繼續送往 Shioaji server

### Requirement: production-readonly 不得載入 CA 或保存秘密
系統 MUST 在正式行情唯讀切換前拒絕非空 CA 設定，且 LaunchAgent、mode marker、log 與狀態輸出 MUST NOT 包含 API key、secret、CA 密碼或帳戶識別資料。

#### Scenario: 偵測到 CA 設定
- **WHEN** `.env` 含有非空 `SJ_CA_PATH` 或 `SJ_CA_PASSWD`
- **THEN** production-readonly 切換失敗並僅提示移除 CA 設定，不輸出設定值

#### Scenario: 查看 runtime 狀態
- **WHEN** 使用者執行狀態命令
- **THEN** 輸出僅包含模式、job、port、health 與行情測試摘要

### Requirement: 狀態診斷必須區分服務與行情
系統 MUST 分別呈現本機 Web、Shioaji HTTP health、登入模式與行情業務測試，避免將市場休市、session 未建立或程序停止混為一談。

#### Scenario: 市場休市但 server 健康
- **WHEN** 本機 API 可回應且即時 SSE 沒有新成交
- **THEN** 狀態不得僅因無新 tick 判定本機服務中斷

#### Scenario: 本機程序停止
- **WHEN** 5173 或 8080 沒有 listener
- **THEN** 狀態明確標示對應本機服務未執行

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

### Requirement: 非 simulation fail-closed 必須能在隔離狀態驗證
系統 MUST 提供不切換目前 runtime、不建立 production job、不讀取正式行情的隔離驗證方式，證明任何非 simulation mode 都不啟動 MultiView，且 adapter 在商品契約或行情解析前回 `simulation_required`。

#### Scenario: synthetic 非 simulation mode
- **WHEN** 驗收工具以 repo 外臨時 state 提供 `simulation=false`
- **THEN** runtime plan MUST 不包含 5174 啟動，adapter MUST 在轉送前拒絕契約、Snapshot、Kbars 與 SSE
- **AND** 目前 simulation 8080／5173／5174 MUST 不受影響

### Requirement: 本機生命週期驗收必須保持資料可復原
MultiView 的 restart、備份、restore、uninstall 與重新安裝驗收 MUST 使用精確路徑，並在每個會寫入的步驟前保存可驗證備份。一般 uninstall MUST 保留本機 D1、備份、個人清單與設定；restore 後 MUST 通過 schema、hash、row count 與 `PRAGMA integrity_check`。

#### Scenario: uninstall 後重新安裝
- **WHEN** 使用者執行一般 uninstall 再重新 install／start
- **THEN** 5174 job MUST 可恢復，原 D1、備份與個人清單 MUST 保留且 integrity check 通過

#### Scenario: macOS 重新登入
- **WHEN** 使用者在其他驗收完成且保存狀態後重新登入 macOS
- **THEN** runtime MUST 預設為 simulation，8080／5173／5174 MUST 恢復，且本機資料 hash／row count MUST 與登出前一致
