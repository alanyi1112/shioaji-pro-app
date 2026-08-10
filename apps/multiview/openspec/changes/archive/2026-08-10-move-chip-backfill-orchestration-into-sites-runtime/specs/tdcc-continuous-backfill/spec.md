## MODIFIED Requirements

### Requirement: 無流量也會執行的背景排程

系統 MUST 由與前端流量無關的 durable scheduler 定期啟動 TDCC 同步，並 MUST 提供受保護的手動重跑入口；Sites Worker MUST 擁有目標同步、最新快照與 run 狀態的業務編排。Codex Sites 尚未提供 cron binding 時，GitHub Actions MAY 作為薄型時鐘呼叫相同受保護 tick；開啟圖表 MAY 使用 D1 或觸發既有 opportunistic refresh，但 MUST NOT 是持續更新的唯一觸發方式。

#### Scenario: 網站一週沒有人開啟
- **WHEN** 正式站在新的 TDCC 資料週沒有任何使用者流量
- **THEN** 背景 scheduler MUST 仍喚醒 Sites Worker 執行最新快照檢查並保存合法新 `dataDate`
- **AND** orchestrator trigger、heartbeat 與結果 MUST 可由 health 安全查證

#### Scenario: 排程重複觸發
- **WHEN** 同一時間有 schedule、手動執行或延遲重送重複啟動
- **THEN** D1 run id 與 lease MUST 防止同一工作被並行處理
- **AND** 相同 `symbol + dataDate` 的重複寫入 MUST 維持冪等

#### Scenario: 外部時鐘不可承載編排
- **WHEN** GitHub Actions 用來喚醒背景工作
- **THEN** workflow MUST NOT 自行決定 TDCC latest 目標、日籌碼目標或完成條件
- **AND** workflow MUST 依 Sites Worker 回傳的 `done` 與安全狀態決定是否繼續 tick

### Requirement: 最新 TDCC 週快照持續保存

部署於 Sites Worker 的背景 orchestrator MUST 優先呼叫 TDCC 官方最新 OpenAPI 或同資料集官方 CSV，以既有全檔 validator 驗證後，將目前目標集合的資料依 `symbol + dataDate` 冪等寫入 D1；檢查 MUST 以每週發布時段為主，並 MAY 在下一日有限重試，資料頻率 MUST 維持 weekly。外部歷史 source adapter MUST NOT 重複執行此 latest 流程。

#### Scenario: TDCC 發布新一期資料
- **WHEN** 最新官方 snapshot 的 `dataDate` 晚於 D1 已保存最新日期
- **THEN** Sites Worker MUST 在不等待歷史 queue 完成的情況下保存所有目前目標 symbol 的合法 rows
- **AND** MUST 更新逐 symbol 最新快照、orchestrator phase 與全域 scheduler 成功時間

#### Scenario: 官方仍是同一期
- **WHEN** 每週背景檢查取得與 D1 相同的 `dataDate`
- **THEN** 工作 MUST 以成功 no-op 結束且不得增加重複 rows 或週數
- **AND** heartbeat MUST 仍記錄本次來源可用

#### Scenario: 最新來源暫時失敗
- **WHEN** TDCC OpenAPI timeout、429、5xx 或回應未通過 validator
- **THEN** 系統 MUST 保留 D1 既有資料並設定有限重試或下一次排程
- **AND** MUST NOT 阻塞歷史資料讀取或清除 coverage

## ADDED Requirements

### Requirement: 新增商品必須立即進入 TDCC 回補路徑

啟用新的台股商品後，系統 MUST 立即註冊 continuous target、建立或更新耐久 history queue，並依部署目標嘗試觸發對應 TDCC workflow；MUST NOT 要求商品等待下一次每週 cron 才進入回補路徑。

#### Scenario: 新增商品且 GitHub dispatch 可用
- **WHEN** 使用者儲存一個符合資格的新台股商品
- **THEN** 系統 MUST 在背景工作建立 target 與 queue，並觸發目前部署目標的 TDCC workflow
- **AND** workflow MUST 以 `tdcc-weekly` scope 執行，不得順帶重跑日籌碼 scope

#### Scenario: Dispatch 暫時不可用
- **WHEN** token 未設定、GitHub API 失敗或 dispatch 被節流
- **THEN** 商品儲存回應 MUST 不受阻塞
- **AND** D1 target 與 queue MUST 保留，供後續每週排程或手動受保護入口接續
