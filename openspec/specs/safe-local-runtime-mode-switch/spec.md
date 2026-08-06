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
