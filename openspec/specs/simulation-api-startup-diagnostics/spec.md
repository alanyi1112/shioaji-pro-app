# simulation API 啟動診斷規格

## Purpose

規範 simulation API 啟動診斷、程序生命週期與串流記錄，確保診斷安全、有界且可關聯，並明確區分離線驗證、單檔安裝與正式載入。

實作、安裝、自然載入證據與未實測限制見[歸檔驗證紀錄](../../changes/archive/2026-10-23-improve-simulation-api-startup-diagnostics/verification.md)。

## Requirements

### Requirement: 啟動錯誤必須保留可判讀的安全診斷

系統 MUST 以固定允許清單保存錯誤類別、錯誤碼、HTTP 狀態與觀測階段，並保留原 hash、bytes 與 rawMessageSaved=false。系統 MUST NOT 保存原始訊息、自由文字片段、帳號、憑證、token、URL、路徑、argv 或環境內容。未知訊息 MUST 明列 unknown，不將 pattern match 冒充已驗證根因。

#### Scenario: 啟動連線失敗同時夾帶秘密
- **WHEN** stderr 或 stdout 含 DNS／連線／TLS／認證／port／檔案權限等已知錯誤及任意敏感資料
- **THEN** log 保存對應固定類別與安全 code，秘密與自由文字不出現在任何輸出

#### Scenario: 未識別的錯誤
- **WHEN** 訊息不符合允許清單
- **THEN** log 保留 unknown、hash、bytes 與程序關聯，不抄寫原文或猜測原因

### Requirement: 程序生命週期與串流必須完整且有界

每次 wrapper 執行 MUST 建立獨立 attemptId，事件 MUST 包含時間與可用的 childPid。系統 MUST 等待 stdout／stderr 排空後記錄退出結果，保留未換行尾訊息、spawn 失敗及安全 code；逐行分析與待寫入量 MUST 有界，過長訊息 MUST 明示 truncated。日誌 MUST 維持 0700／0600 與既有輪替上限。

#### Scenario: 快速失敗及最後一行沒有換行
- **WHEN** 子程序立即輸出錯誤片段後以非零碼結束
- **THEN** 尾訊息先於 process_exit 保存，所有事件使用同一 attemptId，退出碼與最後診斷可關聯

#### Scenario: 超長或跨 chunk 的敏感訊息
- **WHEN** 子程序輸出超過逐行分析上限或把秘密分段寫出
- **THEN** 記憶體緩衝有界，完整 byte 計數與 hash 保留，截斷及未知狀態如實記錄，秘密不外洩

#### Scenario: 無法產生子程序
- **WHEN** spawn 回 ENOENT 或 EACCES 等已知錯誤
- **THEN** process_exit 記 spawn_error 與安全 code，不保存命令路徑或原始錯誤

### Requirement: 修改與驗證不得操作正式服務

程式修改與離線驗證階段 MUST 只修改 repo 並以離線 fixture 驗證，保留已安裝 wrapper、LaunchAgent 與 observer 原狀。後續若使用者明確授權單檔安裝，系統 MUST 先備份舊版並驗 hash、原子安裝候選並讀回核對；現有程序及其他正式設定 MUST 不變，新版只於下次自然啟動載入。系統 MUST NOT 為測試或檔案安裝重啟、登入、增加下載或查詢兩站；程式驗證、檔案安裝與正式載入 MUST 分開回報。

#### Scenario: 完成離線驗證
- **WHEN** 候選程式與測試通過
- **THEN** 回報候選完成與未換版限制，不啟動正式 API 或製造真實失敗

#### Scenario: 使用者另行核准單檔安裝
- **WHEN** 使用者明確要求安裝 App Support wrapper 並維持現有服務
- **THEN** 保存私密舊版備份、前後 hash 與安裝收據，核對已安裝檔案及權限
- **AND** 不重啟、不登入、不增加下載、不修改兩站或 observer；現有程序持續使用已載入版本，不能冒稱新版已正式執行
