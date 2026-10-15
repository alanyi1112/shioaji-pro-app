# intraday-monitor-premarket-readiness Specification

## Purpose
TBD - created by archiving change repair-intraday-monitor-premarket-scheduling-and-live-readiness. Update Purpose after archive.
## Requirements
### Requirement: 使用者時間與交易日排程必須使用明確台北時間
系統 MUST 在沒有使用者離開台灣之明確證據時，將使用者提供的日期與時間解讀為 `Asia/Taipei`。建立或修改關鍵交易日排程後，系統 MUST 讀回 scheduler computed fire time，保存 UTC instant 與台北時間顯示值，且只有台北時間與使用者要求完全一致時才能標記 ready。

#### Scenario: 台北時間排程讀回一致
- **WHEN** 使用者要求下一適用交易日 08:45 執行盤前檢查
- **THEN** 系統 MUST 保存 `timeZone=Asia/Taipei`、canonical UTC instant 與 computed local time 08:45
- **AND** 系統 MUST 在回報排程完成前證明 scheduler 的下一次觸發確實是該交易日台北時間 08:45

#### Scenario: Scheduler 將本地時間誤當 UTC
- **WHEN** scheduler 讀回結果會在台北時間 16:45 才觸發
- **THEN** 系統 MUST 將排程判定為 invalid 並立即回報八小時偏移
- **AND** 系統 MUST NOT 宣稱 08:45 排程已準備完成

#### Scenario: 使用者所在地已明確離開台灣
- **WHEN** 系統已有明確證據顯示使用者所在地不在台灣，且使用者提出新的時間要求
- **THEN** 系統 MUST 在建立排程前詢問使用哪個時區

### Requirement: 關鍵盤前啟動必須由 durable local scheduler 執行
系統 MUST 讓本機 durable scheduler 主責 simulation API 暖機、盤前 Gate 與正式 capture 啟動。Codex heartbeat MUST 只負責監督、診斷、審閱與回報；heartbeat 沒有喚醒時不得阻止 durable runner 依時執行。所有入口 MUST 共用同一 run registry 與 exclusive claim。

#### Scenario: Codex heartbeat 未觸發
- **WHEN** 08:45 前後沒有建立 heartbeat automation run
- **THEN** durable runner MUST 仍依已驗證的台北時間執行盤前流程
- **AND** monitor MUST 保存 heartbeat missing incident 並在可回報時立即通知使用者

#### Scenario: 備援入口發現正式 capture 已啟動
- **WHEN** heartbeat、cron 或人工入口發現相同交易日與 generation 已有 active claim
- **THEN** 該入口 MUST NOT 再次啟動 capture、建立第二條 KBar SSE 或重複訂閱 cohort

### Requirement: 盤前流程必須保留足夠暖機與分層 Gate
系統 MUST 在台北時間 08:20 前後啟動或確認 simulation API，並在 08:35、08:45 分別完成暖機與正式 prerequisite。Gate MUST 分別驗證 runtime mode、API generation、business session、2330 Snapshot、Web、MultiView、baseline、exact cohort、磁碟與 broker-write blockade；任一 Gate 失敗 MUST fail closed。

#### Scenario: API 在 08:45 前已完成暖機
- **WHEN** simulation API generation 自 08:20 起穩定，且 08:35 與 08:45 的 business readiness 都通過
- **THEN** 系統 MAY 在 08:50 建立正式 capture claim 與 KBar 訂閱

#### Scenario: 開盤前才冷啟動且暖機證據不足
- **WHEN** API 在 08:45 後才產生新 generation，或任一暖機 Gate 沒有完成
- **THEN** 系統 MUST 回報 cold-start risk 並維持 Stage 160 未核准
- **AND** 系統 MUST NOT 只因 `/health` 與單一 Snapshot 成功就宣稱 160 檔行情資料 ready

#### Scenario: 08:20 服務程序存在但行情 session 未就緒
- **WHEN** simulation API 程序已存在，但 business session、有效 API generation 或 2330 Snapshot 任一失敗
- **THEN** 系統 MUST NOT 建立 generation anchor 或宣稱暖機完成
- **AND** 系統 MUST 走受智慧單生命週期 Gate 保護的 simulation repair；修復後仍不合格時立即保存 incident 並 fail closed

### Requirement: KBar control-plane 與 data-plane 狀態必須分離
批次 subscribe 成功 MUST 只代表 `subscription_requested`。每個商品在收到符合交易日、generation、身分、source version 與分鐘格式的第一筆 KBar 前 MUST 維持 `awaiting_first_kbar`；收到後才可標示 `active`。`dataActive` MUST 等於已有逐檔 data-plane evidence 的唯一商品數。

#### Scenario: 批次訂閱接受但尚無 KBar
- **WHEN** `POST /api/v1/stream/subscribe/kbars` 回覆 `success=true`，但 160 檔都尚未收到本交易日 KBar
- **THEN** 系統 MUST 顯示 `subscription_requested=160`、`dataActive=0` 與 `boundedTransportReady=false`
- **AND** 系統 MUST NOT 將商品預設為 `active` 或 `subscriptionState=confirmed`

#### Scenario: 只有部分商品收到第一筆 KBar
- **WHEN** exact cohort 中只有 159 檔收到合法 KBar
- **THEN** 系統 MUST 顯示 `dataActive=159`，未收到者維持 `awaiting_first_kbar`
- **AND** exact 160 readiness MUST 維持失敗

### Requirement: 開盤第一分鐘必須有 exact cohort canary
full-session runner MUST 在 08:50 前完成 SSE 與 exact cohort subscribe，並於 09:02:15（Asia/Taipei）檢查每檔 09:01 completed KBar。缺少任一商品 MUST 建立 incident、立即回報並使當日 Stage 160 live availability Gate 失敗。

#### Scenario: 160 檔第一分鐘準時送達
- **WHEN** 160 檔各自的 09:01 KBar 都在 09:02:15 前以相同 current generation 收到
- **THEN** first-minute canary MUST 通過，系統 MAY 繼續完整日驗收
- **AND** KBar adapter 為允許同分鐘修訂而採用的 one-bar-delay 封存不得使 canary 忽略已通過 envelope 與身分驗證的 09:01 provider event

#### Scenario: 全 cohort 直到 09:10 才開始送達
- **WHEN** 第一批 live SSE 是 09:10 KBar，且 09:01–09:09 未由 live stream 送達
- **THEN** 系統 MUST 將 first-minute canary 與當日 live availability 判定失敗
- **AND** 後續 REST 補抓 MUST NOT 把該失敗改寫為通過

### Requirement: KBar 缺口修復必須有界且保留 provenance
系統 MUST 只對已完成分鐘執行一次性、有界的 REST KBar gap repair，逐檔核對日期、contract identity、欄位等長、時區、一般交易時段、`common_lot` 單位、固定範圍雙抓 hash 與 REST/SSE overlap。任何 coverage 或一致性缺口 MUST fail closed；系統 MUST NOT 把無來源分鐘補成零成交。

#### Scenario: Startup gap 可由權威 REST 完整驗證
- **WHEN** 第一個 live minute 為 09:10，REST 對 09:01–09:09 固定範圍雙抓一致，且與 09:10 SSE overlap 的 volume 一致
- **THEN** 系統 MUST 以 `shioaji-kbars-bootstrap` provenance 保存 09:01–09:09，重建從 09:01 起的累積量
- **AND** 這些分鐘 MUST 保持 `liveDelivered=false`，不能取得 Stage 160 live availability 資格

#### Scenario: 第一個 live minute 到達時 bootstrap 尚未完成
- **WHEN** 第一個 live minute 晚於 09:01，且該商品的 startup gap 尚未完成雙抓、coverage 與 overlap 驗證
- **THEN** 系統 MUST 暫存該 live observation 並維持 `waiting_continuity`
- **AND** 系統 MUST 只在 bootstrap 成功後按分鐘順序重放；bootstrap 失敗時將商品標為 degraded 且不得留下以缺口後單分鐘為起點的錯誤累積量

#### Scenario: REST 與 SSE 重疊分鐘不一致
- **WHEN** 相同商品與分鐘的 REST Volume 與 SSE volume 不一致
- **THEN** 系統 MUST 保存 conflict evidence、停止正式量比觸發並將商品標為 degraded
- **AND** 系統 MUST NOT 靜默覆寫任一來源

#### Scenario: 修復要求超過有界政策
- **WHEN** repair 需要週期 polling、輪替商品、第二條無界 SSE 或超過一次 recovery
- **THEN** 系統 MUST 拒絕該操作並維持 unknown／NO-GO

### Requirement: 累積量與 trigger 必須等待開盤連續性完成
每檔 current cumulative volume MUST 從 09:01 canonical 1 分 K Volume 開始累加。09:01 至 completed watermark 任一分鐘為 unknown 時，該商品 MUST 為 `waiting_continuity`，不得產生正式 live trigger 或通知。

#### Scenario: 第一筆 live KBar 是 09:10
- **WHEN** 商品尚未驗證 09:01–09:09，並收到 09:10 Volume 93
- **THEN** 系統 MUST NOT 將 current cumulative volume 設為 93 後直接進行量比比較
- **AND** 系統 MUST 等待缺口驗證完成或維持 `waiting_continuity`

#### Scenario: Bootstrap 完成後重建累積量
- **WHEN** 09:01 至目前 watermark 的每分鐘都已有合法 canonical row
- **THEN** 系統 MUST 依分鐘順序重建累積成交量，再從第一個完整可比較分鐘開始評估
- **AND** 歷史補算事件 MUST 保持 notification authority false

### Requirement: 盤前與盤中錯誤必須有去敏日誌及即時回報
系統 MUST 以權限 0600 的本機輪替 JSONL 日誌與 evidence 記錄 scheduler、service、generation、Gate、subscribe receipt、逐檔 first-event summary、canary、recovery、bootstrap、failure 與 close seal。日誌 MUST NOT 包含帳號、token、API key、憑證或 raw secret。關鍵失敗與里程碑 MUST 主動回報使用者。

#### Scenario: 主排程沒有建立 run
- **WHEN** computed fire time 已過，但 scheduler 沒有相應 run id
- **THEN** monitor MUST 立即保存 `scheduler_run_missing` 並回報要求時間、computed time 與 durable runner 狀態

#### Scenario: 盤中狀態健康且沒有新里程碑
- **WHEN** exact cohort 持續收資料、服務健康且沒有 failure 或 Gate 變化
- **THEN** heartbeat MUST 保持安靜，避免無意義的重複通知

#### Scenario: Simulation API 需要事後鑑識
- **WHEN** KBar 首筆資料延遲或 SSE 中斷
- **THEN** 維運者 MUST 能從受限日誌還原 process start、generation、subscribe、第一筆事件與錯誤時間

#### Scenario: 過去交易日的外部委託 claim 阻擋服務重載
- **WHEN** 模擬帳戶的目前完整 working set 已不含該委託，但 repository 仍保有過去交易日、無 obligation／intent 的 external `exit_claim`
- **THEN** 完整帳戶對帳 MUST 以 repository transaction 將該 claim 轉為 `released` 並寫入 event journal
- **AND** 維運修復 MUST 要求模擬模式、連續兩次一致的空 working set、sidecar 已停止及零券商寫入，缺少任一證據時保持 fail closed

#### Scenario: Runner 與監督使用不同 failure sidecar 檔名
- **WHEN** runner 已建立 `<capture>.failure.json`，但 monitor 查找的是另一個自行拼接的路徑
- **THEN** 系統 MUST 將此情況視為 evidence contract failure，不能回報「沒有 failure sidecar」
- **AND** runner、registry、status API 與 monitor MUST 改用同一個 canonical path constructor 或 runner receipt

### Requirement: 補抓資料完整性不得冒充當時功能可用性
正式 Stage 160 審閱 MUST 分開判斷 `dataContinuityComplete`、`liveAvailabilityComplete` 與受限的 `tailLiveCompletenessException`。exact 160 的 09:01 live canary、盤中量比與結果面板、資源、replay、SSE reconnect 與安全 Gate MUST 通過。一般盤尾端缺口只有在少於 5 檔、每檔至多最後 5 個連續分鐘、收盤後同來源 REST 雙抓一致且與 live prefix 完全相符時，才 MAY 以明確 exception 核准；其他缺口 MUST 維持 NO-GO。

#### Scenario: 資料事後完整但開盤功能不可用
- **WHEN** REST repair 使 160×270 rows 完整，但 09:01 canary 曾失敗
- **THEN** review MUST 保持 NO-GO 並保留 active limit 20
- **AND** evidence MUST 同時呈現資料已修復與當時 live availability 失敗

#### Scenario: 少於 5 檔只缺收盤最後幾分鐘
- **WHEN** 09:01 live canary 為 160／160，最多 4 檔各自只缺連續結尾且落在 13:26–13:30 的至多 5 個分鐘
- **AND** 收盤後同來源歷史 KBar 雙抓 canonical hash 一致、完整包含 270 分鐘，且缺口以前逐分鐘累積量與 live capture 完全相符
- **THEN** review MAY 建立引用原始 capture hash 的 derived acceptance，將盤後資料連續性判定為通過並核准 Stage 160
- **AND** derived evidence MUST 保存 `tailLiveCompletenessException=true` 與每筆回補列的 `liveDelivered=false`
- **AND** 原始 capture、原始 live 缺口與首次 NO-GO 決策 MUST 保留，不得覆寫

#### Scenario: 尾端例外超過界線
- **WHEN** 受影響商品達 5 檔、任一缺口早於 13:26、缺口不是連續尾端、每檔超過 5 分鐘、雙抓不一致或 REST 與 live prefix 不符
- **THEN** 系統 MUST 拒絕尾端例外並維持 NO-GO／active limit 20

#### Scenario: 盤後尾端回補不得產生歷史通知
- **WHEN** 尾端 historical rows 完成回補並參與 replay 或收盤比較
- **THEN** 系統 MUST 將這些 rows 標記為 `liveDelivered=false` 與 historical observation mode
- **AND** notification authority、retroactive trigger authority、broker write 與 production authority MUST 全部為 false

### Requirement: 被動圖表 freshness 必須由真實 visual commit 產生
Stage 160 的圖表 freshness evidence MUST 在圖表完成真實資料繪製後立即被動觀測，並以不超過 5 秒的週期補償可能遺漏的 DOM mutation。觀察距 visual commit 超過 10 秒時 MUST 排除，不得保存為 canonical evidence；系統 MUST 等待同一圖表兩次新鮮且前進的 visual commit。增量繪製失敗時 MAY 使用已驗證的記憶體 KBar 有界重建 series，但重建也失敗時 MUST 留下診斷並維持缺證據，不得偽造 visual commit。

#### Scenario: 圖表在 11:07 推進但舊輪詢較晚才讀取
- **WHEN** 圖表於 11:07 完成 visual commit，但定時觀察時該 commit 已超過 10 秒
- **THEN** 系統 MUST 排除該過期觀察並等待下一次真實 visual commit
- **AND** visual commit 的 DOM mutation MUST 觸發即時觀察，避免 15 秒輪詢與 10 秒門檻互相衝突

#### Scenario: 增量 series update 被圖表函式庫拒絕
- **WHEN** 新行情已通過 canonical 驗證，但 candlestick 或 volume series 的增量更新拋出錯誤
- **THEN** 圖表 MUST 以目前 canonical in-memory bars 嘗試一次完整 series resync
- **AND** 只有 resync 成功才能推進 visual commit；再次失敗 MUST 保存診斷並使 freshness evidence 維持未完成

#### Scenario: 2026-09-15 部分日證據結案
- **WHEN** 當日 capture 於 13:34:30 結束且確認缺少 09:01–09:09 live rows
- **THEN** 系統 MUST 將其保存為 partial／NO-GO 負載與復原證據
- **AND** 系統 MUST NOT 建立 160 activation 或把該日轉成 live full-session baseline

#### Scenario: 當日只有 41,752 筆且四檔提前停在 13:28
- **WHEN** 156 檔各有 09:10–13:30 的 261 筆，2395.TW、3023.TW、3680.TWO、6770.TW 各只有 259 筆且最後分鐘為 13:28
- **THEN** review MUST 同時列出 opening gap 與 per-symbol close gap，並維持 NO-GO／active limit 20
- **AND** 系統 MUST NOT 以全域 process 正常、41,752 大於零或大多數商品到 13:30 取代逐檔 coverage 驗證

### Requirement: 封存必須支援逐檔延後收盤
系統 MUST 將 13:30 視為一般盤名目邊界，不得用固定時間同時封存所有商品。每檔商品 MUST 保存適用的 expected-minute set、nominal close、延後收盤狀態、實際最後事件、權威 close evidence 與 seal time。若個股延後收盤，系統 MUST 繼續接收該商品資料直到 close condition 成立或安全截止點到達。

#### Scenario: 個股在 13:30 後才完成收盤
- **WHEN** exact cohort 中某檔商品有可驗證的延後收盤狀態，且 13:30 後仍有正式交易事件
- **THEN** runner MUST 保持該商品未封存並保存延後區段資料
- **AND** Stage 160 review MUST 將延後區段與 close evidence 納入該商品完整性

#### Scenario: 延後期間沒有每分鐘成交
- **WHEN** 商品尚未取得 close evidence，但延後期間某些分鐘沒有權威 KBar 或成交事件
- **THEN** 系統 MUST NOT 補造零成交 row 或用固定分鐘數宣稱完整
- **AND** 系統 MUST 依該商品 expected-minute set 與實際來源證據判斷 coverage

#### Scenario: 安全截止點仍無法確認收盤
- **WHEN** 到達 capture 安全截止點仍無法取得某商品的權威 close evidence
- **THEN** 該商品 MUST 標記 `closeStatus=unknown`，當日驗收 MUST fail closed
- **AND** evidence MUST 保留最後事件時間與缺少的 close condition

#### Scenario: 安全截止後符合受限尾端例外
- **WHEN** 安全截止時 close evidence unresolved，但缺口符合少於 5 檔、每檔至多最後 5 個連續分鐘的限制
- **THEN** 系統 MUST 先以原始 capture 保存 unknown／NO-GO，再執行唯讀盤後雙抓審閱
- **AND** 只有雙抓、完整 270 分鐘與 live prefix 全部驗證成功，derived acceptance 才 MAY 取得 GO 資格

### Requirement: daily 官方日曆不得依賴舊版基準包持續更新

daily 盤後入口 MUST 在實際雙市場官方日曆來源與相鄰交易日已驗證後，獨立保存原文、來源版本、實際取得時間與內容 hash；不能僅保存新版分鐘基準卻繼續依賴停止更新的 v1 `baseline-set.json`。盤前 MUST 優先驗證新版不可變日曆快取；沒有新版快取才可沿用原合法 legacy authority。新快取損壞、日期／hash／來源不符或逾原新鮮度期限 MUST fail closed，不回退舊快取掩蓋錯誤，不自動改日期或在盤前反覆連官方網站。

明確授權的臨時官方來源修復 MAY 另存 `operator-repair` 證據，但 MUST 使用真正原文與實際取得時間，不改舊原件，不冒充昨日盤後排程或授予 broker write／通知權限。額度續轉 MUST 重新核對此新版 authority 的私密原檔及 hash，保留相同帳戶、來源計數與 CAS 安全條件。

#### Scenario: v1 包已過期但 daily 盤後日曆有效

- **WHEN** 日常模式已保存新鮮、來源與 hash 相符的雙市場日曆，而舊 v1 包已超過原期限
- **THEN** 盤前 MUST 以新版 authority 判定今日及前一共同交易日，不以舊包過期誤擋；新版分鐘基準仍需逐檔驗證

#### Scenario: 08:45 後恢復官方日曆但今日 session 尚未建立

- **WHEN** 原 08:20 因日曆 unavailable 而失敗、沒有其成功 claim／今日 session／今日資料，且真正 08:50 排程在開盤前恢復合法 authority、完整額度與原安全 Gate
- **THEN** 08:50 MAY 沿用既有同日補建機制建立 session 並繼續原排程，明列 recoveryOf=08:20／scheduled0820Success=false；原失敗收據 MUST 不變
- **AND** 此補建 MUST 限 08:50–09:00，已有今日資料、其他失敗原因或任一 Gate 不成立時 MUST 拒絕，不手動代跑排程或建立第二個 owner

### Requirement: 日常盤前排程必須啟動獨立日常 runner

啟用 daily 模式時，08:20／08:35／08:45 本機排程與既有晚開機接續 MUST 驗證官方交易日、同日 session、設定／plan、durable capacity approval、逐檔合法基準、API generation 與 simulation 安全 Gate；08:50 MUST 呼叫日常 runner，不再要求新的 Stage bundle 或完整 capture。舊 Stage 盤前／首分鐘 canary／擷取資格僅供 diagnostic 模式，不得冒充 daily 證據。

各入口 MUST 使用同一排他 run registry 與同日冪等 claim，保留原失敗收據。固定 160 與動態 plan MUST 使用一致的模式契約；本案不得放寬晚開機時窗、商品基準或通知授權，亦不得新增常態 Codex 排程。

#### Scenario: 已有容量核准而沒有今日 Stage bundle

- **WHEN** daily 模式今日預檢通過，durable 核准有效且逐檔基準已驗證
- **THEN** 08:50 MUST 啟動單一日常 owner，不得因缺少今日 Stage bundle 或昨日 capture 退出

#### Scenario: 晚開機接續與正常排程競爭

- **WHEN** 同日排程與 late-boot 同時嘗試啟動
- **THEN** 僅一個入口 MUST 成功取得 ownership，其他入口 MUST 保存冪等／拒絕原因而不另開行情連線

### Requirement: 日常收尾稽核必須查真實程序與基準進度

daily 模式的 13:40 稽核 MUST 分別核對日常程序收尾、真實 stream／持久化故障、逐檔 coverage、小型 receipt 或寫入故障，以及獨立盤後 baseline 的 collecting／ready／failed；MUST NOT 以 `formalAcceptanceEvidence`、完整 capture、雙重 replay 或被動圖表檔作日常成功前提。尚在期限及預算內的 13:35 採集 MUST 表示進度而非整日擷取失敗。

#### Scenario: 基準仍在正常採集

- **WHEN** 日常監控已正常收尾，13:35 基準程序仍在合法期限內 collecting
- **THEN** 稽核 MUST 分列日常 ended 與 baseline collecting，不得發出 capture_missing 或 falsely failed 通知

#### Scenario: 正式 runtime 真實故障

- **WHEN** ownership 異常、程序逾期未收尾、已記錄串流故障或摘要寫入失敗
- **THEN** 稽核 MUST 保存可歸因故障／unknown，不能因有歷史基準或舊 GO 隱藏當日問題

### Requirement: Durable premarket 必須每日建立目前交易日 session authority

系統 MUST 由 durable local scheduler 在每次 08:20 執行時，以 `Asia/Taipei`、前一適用交易日盤後已發布且完整驗證的本機 TWSE／TPEx 官方年度日曆判定當日與上一個適用交易日；盤前四步 MUST NOT 依賴當時再連官方網站。適用交易日 MUST 原子建立唯一 session manifest，綁定 trade date、previous trade date、config revision、cohort hash、baseline hash、artifact bundle hash、approval hash、API generation 與 scheduler receipt；08:35、08:45、08:50 MUST 讀取並驗證同一份 manifest。固定日期 config、過去交易日 claim 或昨日 successful state MUST NOT 取代當日 rollover。

現行 daily MUST 優先驗證原盤後流程獨立保存的 `official-calendar-cache` 原文／來源 hash／實際時間及有界期限，不以停更 v1 baseline 包作唯一日曆來源；新版缺席才可沿用合法 legacy，新版存在但損壞或過期 MUST 拒絕。日曆 authority 與 160 檔量比基準 MUST 分別核對，日曆有效不代表基準完整。

#### Scenario: 下一個適用交易日自動 rollover
- **WHEN** 官方交易日 authority 判定今天為新的適用交易日，且上一日 approval 與所需 artifacts 有效
- **THEN** 08:20 runner MUST 建立今天唯一的 current-session manifest，後續三個步驟 MUST 使用相同 session id 與 hashes
- **AND** operator MUST NOT 需要手動修改 `tradeDate` 或複製前一日設定

#### Scenario: 排程執行但設定仍停在過去交易日
- **WHEN** durable scheduler 已於今天觸發，但可讀取的 session 或 legacy config 仍綁定過去交易日
- **THEN** 系統 MUST 記錄 `session_rollover_missing` 或 `session_trade_date_stale` incident
- **AND** MUST NOT 將此情況記成 non-trading no-op、沿用歷史 subscription receipt 或宣稱今日監控已啟動

#### Scenario: 今天不是官方交易日
- **WHEN** 官方交易日 authority 明確判定今天不是適用交易日
- **THEN** 系統 MUST 保存帶 authority 來源與日期的 non-trading receipt，且不得建立 KBar demand

#### Scenario: 盤後官方來源暫時連線失敗
- **WHEN** 盤後建檔取得 TWSE／TPEx 官方年度日曆時，任一來源失敗、逾時或 schema 不合格
- **THEN** 採集器 MAY 以 TWSE 官方 OpenAPI 與另一個 TWSE 官方年度端點作有界來源切換；TPEx 官方來源仍必須驗證
- **AND** 未完成雙來源及 baseline 驗證時 MUST 保存失敗收據，不得發布可供隔日盤前使用的新 artifact

#### Scenario: 盤前使用前一日已驗證的本機官方日曆
- **WHEN** 08:20／08:35／08:45／08:50 需要判定當日是否為預排交易日
- **THEN** runner MUST 唯讀驗證 daily 獨立日曆快取或合法 legacy artifact 的 hash、官方雙來源 schema／年份／日期、source version、來源日與目標交易日，不向官方網站發起新請求
- **AND** 最新 artifact 缺失、篡改、來源不一致或超過有界期限時 MUST 保存 `calendar_authority_unavailable`，不得猜測交易日或回退至更舊 artifact

#### Scenario: 08:20 失敗後後續盤前步驟有條件恢復
- **WHEN** 08:20 留下同日 `calendar_authority_unavailable` 原始失敗收據且無 session，後續步驟重新取得合格的本機 authority 與完整基準、安全 Gate，並能證明今日無 capture／訂閱／observation／trigger
- **THEN** 08:35／08:45 MAY 以自身 claim 建立 session 並重驗完整 Gate，收據 MUST 連結原 08:20 收據 SHA-256 且標為 `session_recovered_after_0820_failure`
- **AND** MUST 保留原 08:20 失敗與 `scheduled0820Success=false` 語意；不得啟停服務、建立第二條訂閱或把恢復冒稱 08:20 自動驗收成功；legacy 08:50 不得補建

#### Scenario: daily 原 08:50 在開盤前依既有日曆規則安全補建
- **WHEN** daily 的原盤前日曆失敗收據保留，尚無今日成功 claim／session／資料，且原 08:50 排程在 09:00 前取得合法本機官方日曆、完整 160 基準與全部安全 Gate
- **THEN** 原 daily 流程 MAY 依現行有界日曆恢復契約補建並繼續原步驟，不得手動代跑、刪改原三張失敗或建立第二 owner
- **AND** 此情境 MUST NOT 授權在 08:50 同時重綁已有 session 的 generation；generation recovery 仍只限首筆資料前、原 08:35／08:45 合法時窗

### Requirement: 盤前產品啟動輸入與失敗警示必須提早、獨立驗證

08:35／08:45 的 Gate MUST 唯讀執行與正式產品 sink 相同的固定 cohort 順序、160 檔基準及 durable Stage 160 approval 靜態輸入驗證；前一日可變 `failed`／`complete_go` 不得決定今日核准。預檢不得建立訂閱、修改 session 或取代當日 authority／generation Gate。正式排程失敗時 MUST 保存原始收據並同日嘗試本機警示；獨立唯讀稽核 MUST 在 08:52 檢查 08:50 收據、13:40 檢查正式擷取結果。警示交付結果 MUST 另存不可覆寫收據，區分 OS 接手、交付失敗與使用者實際看見（未知）；通知失敗不得隱藏原故障或觸發 broker／服務操作。

#### Scenario: 前一日擷取失敗但今日正式核准與 session 有效
- **WHEN** 前一日產品狀態為 `failed`，今日固定 cohort、基準、正式 Stage 160 approval 與 current session 均通過
- **THEN** 08:35／08:45 預檢 MUST 通過產品靜態輸入，08:50 不得再因前一日 phase 拒絕產品 sink

#### Scenario: 盤前預檢或收盤擷取失敗
- **WHEN** 盤前產品輸入不合格，或正式擷取收尾產生失敗 sidecar
- **THEN** 系統 MUST 保留原失敗證據、嘗試同日通知，並由 08:52／13:40 獨立稽核發現漏報
- **AND** `alertEligible` 或 `os_handoff` MUST NOT 被當成使用者已讀或當日監控成功

#### Scenario: 08:52 正式擷取仍在執行
- **WHEN** 08:50 已有當日排程 claim、同日 session 已接受 control-plane 訂閱且仍新鮮執行中，尚無失敗 sidecar，但 full-session 擷取尚未產生收尾 receipt
- **THEN** 08:52 稽核 MUST 將收尾 receipt 缺席視為待完成，不得單憑缺席送出 `premarket_step_failed` 通知
- **AND** 當日失敗 sidecar、明確失敗 receipt 或有界執行中證據過期時仍 MUST 保留原警示與 13:40 收尾稽核

### Requirement: Premarket 執行 artifacts 必須在 OpenSpec 歸檔後保持可解析

系統 MUST 將 cohort、plan、baseline prerequisite 與 verifier metadata 匯入以 SHA-256 定址的 immutable runtime artifact bundle。執行期 MUST 以 bundle manifest 驗證 schema、來源 identity、hash 與相依關係，不得依賴可被 OpenSpec archive 搬移的 active-change 絕對路徑，亦不得以 basename 搜尋、symlink 或最近檔案猜測替代。

#### Scenario: OpenSpec change 歸檔後啟動下一交易日
- **WHEN** 原始 acceptance artifacts 已由 `openspec/changes/<name>/` 搬至 archive
- **THEN** premarket Gate MUST 透過既有 immutable runtime bundle 解析完全相同的內容與 hashes
- **AND** archive 搬移 MUST NOT 使合法下一交易日啟動失敗

#### Scenario: Bundle 缺檔或 hash 不符
- **WHEN** runtime bundle 缺少必要 artifact、schema 不符或內容 hash 與 manifest 不一致
- **THEN** runner MUST fail closed、保存 `artifact_bundle_invalid`，且不得啟動 subscription、通知、production 或 broker write

### Requirement: Premarket 排程必須保存每日實際執行與 rollover 結果

每個排程時點 MUST 保存 scheduler computed fire time、實際開始時間、當地日期、session id、step claim、rollover outcome 與失敗 reason。status 與維運查詢 MUST 能區分 scheduler 未執行、非交易日 no-op、rollover 失敗、Gate 失敗與 capture 已啟動；stdout／stderr 丟棄或 LaunchAgent loaded MUST NOT 作為執行成功證據。

#### Scenario: 四個排程時點都有 run 但 rollover 失敗
- **WHEN** 08:20、08:35、08:45、08:50 都有 scheduler run，而 current-session manifest 未建立
- **THEN** 狀態 MUST 回報四個 run 與共同 rollover blocker，不得只顯示 LaunchAgent loaded 或 historical GO

### Requirement: 下一交易日的分鐘量基準必須在前一交易日收盤後有界產出

本 Requirement 下列 v1 雙抓、ticks、精確 bundle 路徑及三次外層重試的來源契約 MUST 僅適用於 legacy diagnostic。現行 daily MUST 依 `intraday-monitor-daily-runtime` 的獨立 v2、既有本機有界採集／續轉與逐檔發布規則；MUST NOT 因未產生 v1 capture、雙抓或 ticks 對帳而拒絕合法 v2，也不得把 v2 宣稱為已通過 v1。兩種模式均須保留原 claim／receipt、真實來源日期、固定 cohort 與未知品質，不互相追認成功。

系統 MUST 在官方 authority 確認的適用交易日收盤後，使用既有 simulation business session 逐檔取得同日歷史 1 分 K，累計封閉分鐘成交量，並依既有雙抓、逐筆每分鐘、契約、`common_lot`、官方日曆與 cohort hash 驗證。啟動預算 MUST 由目前 provider 總額、同 cohort 近期至少兩次完整驗證的實測成本及有界安全係數計算，不得採用固定剩餘 bytes 起跑線；樣本或 usage 欄位不足 MUST fail closed。採集期間 MUST 在每個資料請求前重新查核 provider 剩餘額度與動態保留額，並持續估計剩餘 160 檔工作量。MUST 保留 8 GiB 磁碟保留、串行間隔與有界期限；MUST NOT 自行登入、訂閱、重啟服務或降低資料驗證條件。只有 160 檔完整合格時才可原子發布下一適用交易日精確日期路徑的 baseline bundle。

#### Scenario: 歷史 1 分 K 與逐筆資料完整
- **WHEN** 收盤後來源、官方日期、流量與 cohort 均合格，且 160 檔每分鐘成交量及終量核對一致
- **THEN** 排程 MUST 保存來源／驗證 receipt，並發布 160 檔、270 個已封閉分鐘的隔日 baseline bundle

#### Scenario: 流量不足或部分商品驗證失敗
- **WHEN** provider 使用量不足以涵蓋動態保留額與實測預算、實測樣本不足，或任一商品資料缺漏／不一致
- **THEN** 系統 MUST 保留失敗或 partial receipt，MUST NOT 發布可用 baseline，隔日 session MUST 顯示 `baseline_missing`

#### Scenario: 同日有限重試不覆寫第一次失敗
- **WHEN** 第一次嘗試已留下完整失敗 receipt，且原因可恢復、仍在同一適用交易日的指定重試時段
- **THEN** runner MAY 建立最多第二、第三次獨立 claim／來源／budget／receipt，MUST NOT 覆寫先前任何證據
- **AND** 前次仍在執行、已有可用 baseline 或超出嘗試上限時 MUST no-op

#### Scenario: 當日排程失敗後的事後歷史補建
- **WHEN** 使用者明確指定過去 1–30 日的來源交易日，下一個由當前 TWSE／TPEx 官方日曆證實的適用交易日尚未到來，且既有 simulation business session、不可變 160 檔 cohort、動態流量預算及磁碟保留皆通過
- **THEN** 系統 MAY 在獨立 namespace 進行最多三次有界歷史採集，MUST 維持同日採集的雙抓、逐檔 270 分鐘、ticks、契約、單位、成交量與來源日期驗證
- **AND** 只有 160/160 完整通過才 MAY 原子發布供下一適用交易日使用的精確 baseline 路徑；原排程失敗 claim／receipt MUST 原樣保存，補建 receipt MUST 明示非當時排程成功，且不得取代翌日真實 session／盤中驗收

### Requirement: 開盤前 API 換代只能在零資料活動時受控恢復

若 08:20 後 API generation 改變，runner MUST 先將舊 session 視為 `generation_mismatch`。僅在同交易日官方 authority、cohort／bundle／approval／config revision、simulation business session 與 Snapshot 重新驗證，且原 session 尚未提出或接受訂閱、逐檔無訂閱與第一筆 KBar、無結果及觸發時，MAY 以 append-only transition receipt 推進同 session 的 generation epoch。MUST 保留原身份與失敗收據，轉換後重跑完整 Gate；任一條件未知或已活動時 MUST fail closed。

#### Scenario: 08:20 後 API 於訂閱前換代
- **WHEN** 原 session 無 control-plane／data-plane 活動、所有資料 identity 與新 simulation generation 均已核對
- **THEN** runner MAY 記錄舊／新 identity 與 generation 的不可覆寫 receipt，恢復後再通過完整 premarket Gate

#### Scenario: 換代時已有合法 KBar 或訂閱
- **WHEN** 任一 control-plane、逐檔 subscription、第一筆 KBar、結果或觸發已存在或不可證明為零
- **THEN** runner MUST 保持 `generation_mismatch`，不得重綁 session 或重播結果

### Requirement: 基準排程驗收必須核對已載入條件與真實觸發收據

原生基準排程驗收 MUST 唯讀核對 scheduler 已載入的 label、程式及參數、受支援執行器路徑、calendar interval 與實際台北時間，並將原系統觸發、同次 claim／receipt、日期、原 owner／generation、完整 160 檔基準及原流量紀錄相互對照。單憑 plist、LaunchAgent loaded、runs／exit code、originTrigger 字串、HTTP 200 或自行推算的下次時間 MUST NOT 判定成功。

UserEventAgent 等原系統提供的 `Running StartCalendarInterval` MUST 與 claim 時間及 job identity 對應；後續有限嘗試可於同一原程序內完成，前次 partial／failed、請求數及 bytes MUST 保留，不把最後 complete 冒稱首次即成功。原生完成與 operator 補件 MUST 分列。下一適用交易日的 160 份基準使用、simulation session、原盤前收據與首筆資料前受控換代 MUST 由各自原件核實，離線 fixture 不能取代。

scheduler 若公開獨立的 future-fire 欄位或 `Rescheduling StartCalendarInterval` 日誌，MUST 保存可取得的原值、來源及觀測時間；未取得時 MUST 明列未知，不能以 Codex heartbeat next_run_at、程式 computedFireAt 或自行計算冒充。已載入條件與真實觸發／完成鏈齊備時，MAY 完成此排程驗收，而不要求不可讀的 future-fire 欄位。查核 MUST NOT 重載、重裝或代跑工作，不新增下載、broker login／SSE／訂閱、通知或交易，也不改寫原證據。

#### Scenario: 已載入但缺少真實觸發或完成收據
- **WHEN** 只讀到 13:35 CalendarInterval，或只有 claim 而無合法完成鏈
- **THEN** MUST 保持未確認／進行中／失敗，不得僅因 job loaded 就通過驗收

#### Scenario: 原程序在有限重試後完成完整基準
- **WHEN** 原系統 13:35 trigger 可對應同次 claim，原程序第一次 partial 留存，後續同 owner 有界嘗試完成 160 份合法來源日／目標日基準
- **THEN** MUST 以完整觸發鏈核實原生完成，保留第一次 partial 與全部 requests／bytes，不得重跑下載器製造收據

#### Scenario: 原系統有實際重新排程時間
- **WHEN** scheduler 日誌提供原 job 的 Rescheduling 事件與下一次台北時間
- **THEN** MUST 原樣保存該來源；若只有自行計算值則 MUST 標示為推算，不能宣稱為 scheduler 獨立讀回

#### Scenario: 人工補件與下一日受控換代
- **WHEN** 前日基準曾由 operator 補足，而次日原盤前 session 首筆資料前另完成合法 generation transition
- **THEN** MUST 各自保留 operator／scheduled／transition provenance，確認實際使用同一組合法 160 基準；不得把人工補件追認為前日排程或全日 live 成功
