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
