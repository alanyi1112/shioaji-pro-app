## MODIFIED Requirements

### Requirement: 無流量也會執行的背景排程

系統 MUST 由與前端流量無關的 durable scheduler 定期啟動 TDCC 同步，並 MUST 提供受保護的手動重跑入口；開啟圖表 MAY 使用 D1 或觸發既有 opportunistic refresh，但 MUST NOT 是持續更新的唯一觸發方式。Codex Sites 與 Cloudflare 使用獨立 D1 時，scheduler MUST 以 target-specific base URL、credential、run state 與 concurrency 分別執行，不得將一個環境的成功或 lease 套用到另一個環境。

#### Scenario: 網站一週沒有人開啟
- **WHEN** 任一正式站在新的 TDCC 資料週沒有任何使用者流量
- **THEN** 該 deployment 的背景 scheduler MUST 仍執行最新快照檢查並保存合法新 `dataDate`
- **AND** scheduler heartbeat 與結果 MUST 可由同一 deployment 的 health 安全查證

#### Scenario: 排程重複觸發
- **WHEN** 同一 target 同時有 schedule、手動執行或延遲重送重複啟動
- **THEN** target-specific GitHub concurrency 與 D1 lease MUST 防止同一工作被並行處理
- **AND** 相同 `symbol + dataDate` 的重複寫入 MUST 維持冪等

#### Scenario: 另一個 deployment 的排程失敗
- **WHEN** Codex Sites 或 Cloudflare 其中一個 target 同步失敗
- **THEN** 另一個 target 的已成功 run 與 D1 rows MUST 保持有效
- **AND** workflow MUST 分開回報兩個 target 的狀態，不得以部分成功冒充全部成功

### Requirement: 持續回補可觀測性與秘密安全

health 與受保護 API MUST 回報 scheduler 最後心跳、最近成功 run、最新官方 `dataDate`、target／queued／running／blocked symbol 數、逐 symbol coverage、deployment target 與安全錯誤碼；GitHub／Sites／Cloudflare secrets、完整上游 body、內部受保護 URL、cookie 或 synchronizer token session 資料 MUST NOT 出現在 repository、artifact、log 或 response。

#### Scenario: 背景同步正常
- **WHEN** scheduler 最近一個允許週期內成功執行
- **THEN** 同一 deployment 的 health MUST 顯示 healthy、最近心跳、最新 `dataDate` 與 queue 計數
- **AND** 個股 API MUST 回傳該 symbol 的 coverage 與 completed／queued 狀態

#### Scenario: scheduler 心跳過期
- **WHEN** 最後 scheduler heartbeat 超過規格設定門檻
- **THEN** health MUST 顯示 `scheduler_stale` 或同等安全狀態
- **AND** MUST 保留並繼續提供 D1 既有資料

#### Scenario: workflow 使用秘密呼叫 Codex Sites 受保護 API
- **WHEN** GitHub Actions 對 Codex Sites 執行 latest refresh、claim、heartbeat 或 ingest
- **THEN** request MUST 同時通過 Sites 存取與獨立 continuous-backfill 授權
- **AND** shell trace、錯誤序列化與測試 fixture MUST 不得輸出任何秘密值

#### Scenario: workflow 使用機器身分呼叫 Cloudflare 受保護 API
- **WHEN** GitHub Actions 對 Cloudflare 執行 orchestrator 或 ingest
- **THEN** request MUST 同時通過 Cloudflare Access Service Token 與獨立 continuous-backfill 授權
- **AND** health MUST 回報 Cloudflare target 的 run／coverage，不得以 Sites D1 狀態代替

### Requirement: 獨立 D1 的 TDCC 公開歷史資料可安全復原

當 Codex Sites 與 Cloudflare 的獨立 D1 歷史 coverage 不一致時，系統 MUST 提供只處理 TDCC 公開市場資料的可回復流程。流程 MUST 先以官方歷史表單建立本機 dry-run 快照，逐商品逐官方週驗證完整 17 級資料與合法 `pre_listing`／`not_published` gap，再產生 material changed-only 的 additive SQL；MUST NOT 匯出、讀取或寫入登入名單、個人頁籤、個人商品清單或其他使用者資料。

#### Scenario: Cloudflare 只有最新一週
- **WHEN** Cloudflare D1 的目標商品只有最新 TDCC 快照，但正式站需要至少 51 個官方週的歷史序列
- **THEN** 操作者 MUST 先建立 TDCC 公開資料表的可回復備份並驗證官方快照的商品、日期、逐週狀態、row count 與 SHA-256
- **AND** 完整快照通過驗證前 MUST NOT 寫入正式 D1

#### Scenario: 復原流程重跑
- **WHEN** 相同歷史快照因中斷或驗證需要再次套用
- **THEN** `symbol + data_date` MUST 使用 material changed-only upsert，未變歷史資料不得只因抓取時間不同而重寫
- **AND** `tdcc_continuous_items`、逐商品 coverage 與市場 fetch state MUST 由實際快照日期重建，不得把不存在的資料列冒充已發布

#### Scenario: 兩個帳戶共同商品
- **WHEN** 兩個已授權帳戶開啟同一台股商品的大戶／散戶副圖
- **THEN** 兩者 MUST 共用相同的 `taiwan_stock_shareholder_distribution` 歷史資料，不得依帳戶重複抓取或保存副本
- **AND** 個人清單隔離 MUST 不影響共享 TDCC 歷史的日期、筆數與圖形
