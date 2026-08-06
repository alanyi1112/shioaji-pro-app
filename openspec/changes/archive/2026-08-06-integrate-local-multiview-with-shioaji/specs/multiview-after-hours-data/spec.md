## ADDED Requirements

### Requirement: 台股盤後資料來源與資料語意必須維持不變
MultiView 本機版 MUST 保留參考 repo 既有 TWSE、TPEx、TDCC、FinMind、Yahoo 與合法 fallback 的 provider routing、欄位、單位、頻率、source date、缺值及 verification 契約。搬到本機 D1 不得把未發布資料補零、forward-fill、改日期或以 Shioaji 盤中值取代盤後資料。

#### Scenario: 載入法人與融資融券資料
- **WHEN** 本機 D1 有合法 `.TW` 或 `.TWO` 的盤後資料
- **THEN** API 與 pane 顯示原 provider、source date、單位、coverage 與缺值狀態
- **AND** 資料日期 MUST 來自可驗證來源 row／report date

#### Scenario: 官方資料尚未發布
- **WHEN** 目標交易日沒有來源列或 provider 明確回未發布
- **THEN** 系統保留缺值與 reason code，不得使用前一日值或零值冒充

### Requirement: 初始本機資料必須採可驗證且最小重複請求的路徑
初始 D1 seed MUST 優先評估經授權的 Cloudflare 權威 D1 data-only export；若無合法授權 session，MUST 改走既有 bounded official backfill。任一路徑都 MUST 排除秘密、Access／audit 與不必要個人資料，並在寫入前備份本機資料庫。

#### Scenario: 可取得權威 data-only export
- **WHEN** 實作當下有合法既有授權且 export schema／coverage 通過唯讀預檢
- **THEN** 系統只匯出所需 market／chip／history tables，以 transaction changed-only 寫入本機 D1
- **AND** 驗收比較 row count、日期 coverage、代表商品及 `PRAGMA integrity_check`

#### Scenario: 沒有合法授權 session
- **WHEN** Cloudflare D1 無法合法讀取、匿名回 `401` 或既有 session 不可用
- **THEN** 系統 MUST NOT 讀 cookie、建立 bypass 或勾選遠端遷移完成
- **AND** 改以官方 bounded backfill 建立可得 coverage並明確記錄仍待補範圍

### Requirement: 盤後排程與回補必須可重入且保存 checkpoint
本機 scheduler MUST 在實際盤後／週末窗口執行既有 latest、history、TDCC continuous 與 PE backfill 流程，並 MUST 以 run-specific id、checkpoint、lease、retry 與完成狀態防止重複寫入。Mac 關機錯過排程後，下一次啟動 MUST 能辨識 overdue work 並有界補跑。

#### Scenario: 正常盤後執行
- **WHEN** scheduler 在設定窗口觸發且 provider 可用
- **THEN** run 記錄實際 trigger、source date、processed／remaining／failed 與 completed 狀態
- **AND** 只有 changed rows 可寫入，不因 fetchedAt 不同重寫相同歷史

#### Scenario: 工作中途停止
- **WHEN** process、網路或 provider 在 backfill 中途失敗
- **THEN** 已完成 checkpoint 保留，lease 到期後可從未完成項目繼續
- **AND** 重跑不得重複插入或破壞已 verified rows

#### Scenario: Mac 錯過排程
- **WHEN** 預定窗口時本機關機，之後重新啟動服務
- **THEN** health 顯示 overdue／pending，scheduler 依 budget 有界補跑
- **AND** 系統 MUST NOT 只因 LaunchAgent 曾排程就宣稱資料已更新

### Requirement: 盤後資料健康狀態必須以 run 與 coverage 為真相
健康檢查 MUST 分別呈現每個 pipeline 的最後成功 run、source date、coverage、remaining、failed、retry 與 D1 integrity。全域最新時間或 HTTP 200 MUST NOT 單獨作為回補完成證據。

#### Scenario: HTTP 成功但資料未完整
- **WHEN** internal route 回 200，但 run 仍有 pending、blocked 或 missing dates
- **THEN** health MUST 顯示 incomplete 並保留可恢復原因
- **AND** 對應 OpenSpec task MUST 維持未完成

#### Scenario: 代表商品 coverage 驗收
- **WHEN** seed 或 backfill 宣稱完成
- **THEN** 測試 MUST 核對至少一檔 `.TW`、一檔 `.TWO`、TDCC 週資料、PE coverage、實際 source date 與 UI 可見 pane
- **AND** 不可只核對 table 存在或 row count 非零

### Requirement: 本機資料回復不得破壞目前可用版本
系統 MUST 提供可識別的 D1 備份、schema revision、restore 操作與 dry-run／驗證步驟。restore MUST 停止寫入 job、驗證目標檔、原子替換並重跑 integrity／coverage；不得自動刪除最後可用備份。

#### Scenario: 新 migration 驗證失敗
- **WHEN** schema、integrity 或 coverage gate 未通過
- **THEN** 系統停止啟用新資料庫並可回復 migration 前備份
- **AND** MultiView MAY 以延遲 provider 繼續服務，但不得宣稱盤後本機資料正常
