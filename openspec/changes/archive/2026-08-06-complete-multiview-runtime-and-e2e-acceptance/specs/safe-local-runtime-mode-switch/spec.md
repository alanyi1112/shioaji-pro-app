## ADDED Requirements

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
