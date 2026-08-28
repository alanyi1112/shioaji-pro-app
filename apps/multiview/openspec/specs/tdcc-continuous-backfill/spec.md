# tdcc-continuous-backfill Specification

## Purpose
TBD - created by archiving change automate-tdcc-continuous-backfill. Update Purpose after archive.
## Requirements
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

### Requirement: 動態發現所有新加入網站的合格台股

每次背景工作 MUST 從目前 base setup、D1 商品目錄、使用者已加入商品及 baseline 後的官方新上市增量重建目標集合；任何首次出現且符合 TWSE／TPEx 普通股或 ETF eligibility 的 symbol MUST 在一個排程週期內建立逐 symbol coverage 與歷史回補工作，不得只使用部署時固定清單。目標同步 MUST 以至少 51 週且沒有 missing dates 作為 `completed` 的最低條件；只有少量最新週資料的 `queued`／`partial` symbol MUST NOT 被覆寫為 `completed`。完整 target discovery／reconciliation MUST 由 durable scheduler、受保護 control plane 或商品目錄 ingest 執行，MUST NOT 阻塞互動式清單儲存 response。

#### Scenario: 使用者新增一檔既有台股
- **WHEN** 使用者將尚無完整 TDCC coverage 的合格台股普通股或 ETF 加入網站清單
- **THEN** Worker MAY 在 response 後以單一 symbol background upsert 先將該 target 設為 queued 或 partial，且下一次背景 discovery MUST 再次納入該 symbol
- **AND** MUST 依官方免費歷史範圍建立 missing weeks，不要求重新部署或修改 workflow

#### Scenario: 互動式儲存不執行完整 discovery
- **WHEN** 使用者新增、更新或重新儲存一個清單商品
- **THEN** foreground request MUST NOT 重掃完整官方 catalog、所有使用者商品或逐一 reconcile 所有 active targets
- **AND** full discovery 的延後 MUST NOT 影響該次使用者清單 D1 持久化成功

#### Scenario: 少量既有資料不得誤判完成
- **WHEN** 新增 symbol 已保存 1 至 50 週資料，且 expected weeks 尚未規劃或低於最低歷史週數
- **THEN** 目標同步 MUST 保留可 claim 的 `queued` 或 `partial` 狀態
- **AND** 下一次 claim MUST 能取得該 symbol 並建立完整官方日期計畫

#### Scenario: 官方新增上市證券
- **WHEN** baseline 後的官方商品目錄出現新的 active TWSE／TPEx 普通股或 ETF
- **THEN** discovery MUST 在 catalog revision 更新後自動建立該 symbol 的 coverage 與 queue
- **AND** 上市日前 MUST 保持 `pre_listing` 缺值，不得補造 rows

#### Scenario: 首次啟用背景同步
- **WHEN** migration 第一次建立 continuous-backfill baseline
- **THEN** 系統 MUST 將目前已支援 symbol 記錄為 baseline 並保留既有 coverage
- **AND** MUST NOT 將未加入網站的整個既有市場誤當成新 symbol 而啟動全市場歷史掃描

#### Scenario: 商品停用或下市
- **WHEN** 目標 symbol 後續變成 inactive、非普通股或非 ETF
- **THEN** 下一次完整背景 discovery MUST 停止建立新的歷史工作與最新週寫入
- **AND** MUST 保留已驗證歷史供既有資料查詢與稽核

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

### Requirement: 新 symbol 與缺週的背景歷史回補

受保護背景 operator workflow MUST 自動 claim 新 symbol 或 gap 工作，以官方歷史日期、單一併發、至少一秒間隔、有限 symbol／週批次與 checkpoint 操作 TDCC 可見歷史表單；成功資料 MUST 經受保護 ingest 與相同 validator 寫入 D1。workflow MUST NOT 自行擴張至 queue 以外的 symbol，且每次 target refresh MUST 保留未達最低週數的人工或清單 queue。

#### Scenario: 新 symbol 沒有完整歷史 coverage
- **WHEN** queue claim 取得一檔新加入且最新官方資料可驗證、但未達最低 51 週的合格 symbol
- **THEN** runner MUST 比對官方免費歷史日期與 D1 distinct dates，按固定順序處理 missing weeks
- **AND** 完成後 MUST 保存 expected、completed、failed weeks 與 coverage 起訖

#### Scenario: 新上市商品的上市前週次
- **WHEN** 完整官方日期集合包含商品上市日前的週次
- **THEN** 系統 MUST 將上市前週次納入 expected weeks，並以 `pre_listing` 合法缺值標記為完成
- **AND** MUST NOT 產生虛構 TDCC rows 或線圖點，也 MUST NOT 因實際上市後資料少於 51 週而反覆 claim 空工作

#### Scenario: 既有 symbol 漏掉中間一週
- **WHEN** 官方歷史日期集合包含 D1 未保存且不屬於 `pre_listing` 的 `dataDate`
- **THEN** 系統 MUST 將該日期建立為 gap item 並由背景 runner 自動補洞
- **AND** 不得重抓已存在且通過驗證的其他週

#### Scenario: 官方表單合法回覆查無此資料
- **WHEN** queue 指定 symbol／官方日期的 TDCC 公開表單明確回覆「查無此資料」，且沒有 CAPTCHA、封鎖或候選代號不一致
- **THEN** runner MUST 將該週完成為 `not_published` gap 並保留原因，不得寫入虛構 rows
- **AND** MUST 繼續同一有限批次的後續週，不得將合法缺值誤判為 `invalid_response`

#### Scenario: 工作時間或批次用完
- **WHEN** runner 達到單次 symbol、週數或總執行時間上限
- **THEN** MUST 保存 checkpoint、釋放或續租目前工作並正常結束
- **AND** 下一次排程 MUST 從未完成週續跑

#### Scenario: 歷史頁回傳 CAPTCHA 或封鎖
- **WHEN** runner 偵測 CAPTCHA、封鎖、候選不一致、使用規範不允許自動操作或 HTML 格式漂移
- **THEN** MUST 停止該次歷史工作並將原因設為 allowlist blocked 狀態
- **AND** MUST NOT 規避限制、持續高速重試或影響最新 OpenAPI snapshot 工作

#### Scenario: parser 修正後由 operator 重新排入誤判工作
- **WHEN** 已部署並驗證的 parser 修正可處理先前 `candidate_mismatch` 或 `invalid_response`，且 operator 透過受保護控制面指定原 reason 與有限 symbol 清單
- **THEN** 系統 MAY 只將仍為該 blocked reason 的明確 symbols 重設為 `queued`
- **AND** CAPTCHA、來源封鎖或未指定 symbols MUST NOT 被自動解鎖或視為可重試

### Requirement: Queue lease、續跑與公平性

系統 MUST 以 D1 保存逐 symbol／週工作、lease owner、lease expiry、heartbeat、attempt、next retry 與 checkpoint；claim MUST 為原子操作，過期 lease MUST 可安全回收，且 queue MUST 避免單一大量 symbol 永久餓死其他新 symbol。

#### Scenario: workflow 執行中途終止
- **WHEN** GitHub runner、網路或部署在工作完成前中止
- **THEN** 已成功週 MUST 保留，running item MUST 在 lease 到期後回到可 claim 狀態
- **AND** 下一次執行 MUST 從 checkpoint 續跑且不得複製 rows

#### Scenario: 多檔新台股同時排隊
- **WHEN** queue 同時包含多個新 symbol 與既有 gap
- **THEN** claim MUST 依明確 oldest-first 或 round-robin 規則分配有限批次
- **AND** latest snapshot 工作 MUST 保持最高優先級

#### Scenario: 可重試上游錯誤
- **WHEN** 工作遇到 timeout、429 或暫時性 5xx
- **THEN** 系統 MUST 依有限退讓策略增加 attempt 並設定 `nextRetryAt`
- **AND** 超過上限後 MUST 設為 partial／failed，不得無限循環

### Requirement: 持續回補可觀測性與秘密安全

health 與受保護 API MUST 回報 scheduler 最後心跳、最近成功 run、最新官方 `dataDate`、target／queued／running／blocked symbol 數、逐 symbol coverage 與安全錯誤碼；GitHub／Sites secrets、完整上游 body、內部受保護 URL、cookie 或 synchronizer token session 資料 MUST NOT 出現在 repository、artifact、log 或 response。

#### Scenario: 背景同步正常
- **WHEN** scheduler 最近一個允許週期內成功執行
- **THEN** health MUST 顯示 healthy、最近心跳、最新 `dataDate` 與 queue 計數
- **AND** 個股 API MUST 回傳該 symbol 的 coverage 與 completed／queued 狀態

#### Scenario: scheduler 心跳過期
- **WHEN** 最後 scheduler heartbeat 超過規格設定門檻
- **THEN** health MUST 顯示 `scheduler_stale` 或同等安全狀態
- **AND** MUST 保留並繼續提供 D1 既有資料

#### Scenario: workflow 使用秘密呼叫受保護 API
- **WHEN** GitHub Actions 執行 latest refresh、claim、heartbeat 或 ingest
- **THEN** request MUST 同時通過 Sites 存取與獨立 continuous-backfill 授權
- **AND** shell trace、錯誤序列化與測試 fixture MUST 不得輸出任何秘密值

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

### Requirement: TDCC 最新快照必須依發布週次判斷新鮮度

系統 MUST 依 `Asia/Taipei` 的 TDCC 每週發布窗口計算目前最低可接受資料週；當 requested range 包含該週時，cache state 的 `source_date` MUST 位於該週或更晚，只有最近成功時間不得視為已覆蓋。判定 MUST 接受同一週內因休市產生的合法最後營業日，不得硬寫成固定星期五日期。

#### Scenario: 發布窗口前官方仍是前一期
- **WHEN** 本週資料尚未進入預定發布窗口，官方最新 `dataDate` 仍在前一資料週
- **THEN** 系統 MUST 接受前一資料週為目前最新可用資料
- **AND** MUST NOT 因尚未發布而清除既有分布資料

#### Scenario: 發布窗口後 cache 仍是前一期
- **WHEN** 已進入新資料週的發布窗口後，cache `source_date` 仍早於該週星期一
- **THEN** 系統 MUST 將 cache 視為 stale 並嘗試 latest refresh
- **AND** `last_success_at` 尚未超過 8 天 MUST NOT 阻止此次 refresh

#### Scenario: 新商品只有一週舊資料
- **WHEN** 新加入商品的 target 已保存一筆舊週快照，但最新已發布週與最低歷史 coverage 尚未完成
- **THEN** target MUST 保持 `queued` 或 `partial` 並可由後續排程 claim
- **AND** 舊快照 MUST NOT 讓 latest 或 history 工作提前標示完成

### Requirement: 本機 TDCC 排程必須涵蓋主同步與隔日重試

本機 runtime 的 durable scheduler MUST 在 TDCC 發布窗口後執行每週主要同步，並 MUST 於下一日提供一次有限重試；兩次執行 MUST 使用相同受保護的 `tdcc-weekly` pipeline 與 durable queue。

#### Scenario: 主要同步時官方尚未更新
- **WHEN** 週六主要同步只取得前一期 `dataDate` 或遇到可重試上游錯誤
- **THEN** 系統 MUST 保留既有 rows 與 queued targets
- **AND** 週日重試 MUST 再次檢查 latest 並接續未完成 queue

### Requirement: TDCC 完整度必須由官方週次身分證明

系統 MUST 以 TDCC 官方歷史日期集合建立逐 symbol 日期計畫，並將已驗證分布資料、合法 `pre_listing` 與合法 `not_published` 視為各自可稽核的 resolved date；row count、最新快照日期、請求成功時間或 `expectedWeeks === completedWeeks` 單獨成立時 MUST NOT 宣告歷史完整。`completed` MUST 同時滿足至少最近 51 個官方週次均已規劃、每個計畫日期均 resolved、沒有 missing／failed date，且計畫已涵蓋最新官方 `dataDate`。

#### Scenario: 筆數足夠但中間缺少官方週次
- **WHEN** 某 symbol 已保存至少 51 筆分布資料，但官方日期集合中的 `2026-08-07`、`2026-08-14` 或任一中間日期沒有資料列或合法 gap item
- **THEN** 該 symbol MUST 顯示 `queued` 或 `partial`，並將每個缺少日期建立為 gap item
- **AND** 系統 MUST NOT 因總筆數足夠而保留 `completed`

#### Scenario: 最新 OpenAPI 快照晚於已驗證計畫
- **WHEN** 最新官方 OpenAPI 保存新的 `dataDate`，但目前 symbol 的官方日期計畫尚未涵蓋至該日期
- **THEN** 系統 MUST 將該 symbol 標示為需要 reconcile 並保持可 claim
- **AND** 下一次 runner MUST 取得官方日期集合、補建介於舊計畫與最新日期間的日期工作，再重新計算完成狀態

#### Scenario: 合法上市前或查無資料週
- **WHEN** 官方日期屬於商品上市前，或官方表單合法回覆該 symbol 在該日期查無資料
- **THEN** 系統 MUST 以 `pre_listing` 或 `not_published` resolved item 保存日期與原因
- **AND** MUST NOT 建立虛構分布資料、forward-fill 或只增加匿名完成筆數

#### Scenario: 逐 symbol 完整度重新計算
- **WHEN** operator、migration 後 reconciliation 或 durable scheduler 稽核既有 active targets
- **THEN** 系統 MUST 從官方日期計畫及逐日期 resolved evidence 重新計算 expected、completed、missing 與狀態
- **AND** MUST 保留已驗證 rows，只建立缺少工作並修正錯誤狀態

### Requirement: 新增 TDCC target 必須完成有界背景交接

新增或重新啟用合格台股後，系統 MUST 先耐久保存 target 與 queue，再於 deployment 可用的背景執行面完成 runner handoff；遠端 deployment MUST 嘗試既有受保護 workflow dispatch，本機 deployment MUST 由不依賴 GitHub token 的 queue watcher 在最晚五分鐘內接手 runnable target。完整歷史 MAY 分批完成，但系統 MUST 可證明工作已排隊、已被接手或因安全原因無法啟動，不得只留下無限期 `queued`。

#### Scenario: 本機新增商品且 GitHub dispatch 未設定
- **WHEN** 本機使用者新增一檔合格台股，target 已排隊但 GitHub dispatch 不可用
- **THEN** 本機 queue watcher MUST 在最晚五分鐘內偵測 runnable target，並以既有 single-flight／lease runner 接手
- **AND** 沒有 runnable target 時 watcher MUST 成功 no-op，且不得查詢 TDCC 歷史來源

#### Scenario: 遠端 workflow dispatch 成功
- **WHEN** Sites 或 Cloudflare deployment 保存新 target 且受保護 dispatch 設定完整
- **THEN** 系統 MUST 將對應 deployment 的 TDCC workflow 啟動請求送出並保存安全結果
- **AND** 不得將另一個 deployment 的 run、D1 或 credential 當成已接手證據

#### Scenario: 遠端 dispatch 不可用
- **WHEN** 遠端 deployment 缺少 dispatch 設定、GitHub API 失敗或被節流
- **THEN** target／queue MUST 保留，API 與 health MUST 顯示 `dispatch_not_configured`、`dispatch_failed` 或同等 allowlist 狀態
- **AND** 系統 MUST NOT 宣稱 runner 已開始，既有 durable scheduler 與手動受保護入口 MUST 仍可接手

#### Scenario: 重複 watcher 與週末排程相遇
- **WHEN** queue watcher、週末主要同步、隔日重試或手動受保護 run 同時嘗試接手相同 target
- **THEN** run id、lease 與 single-flight MUST 讓同一 symbol／date 只有一個有效 owner
- **AND** 其他執行 MUST 安全 no-op 或處理不同可 claim 工作

