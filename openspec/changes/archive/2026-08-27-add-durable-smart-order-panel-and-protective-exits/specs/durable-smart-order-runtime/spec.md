## ADDED Requirements

### Requirement: 智慧單必須明示為本機監控而非券商雲端
系統 MUST 由本機常駐 Runtime 執行已啟用策略，並在所有智慧下單入口、確認頁與監控頁永久顯示「本機監控・非券商雲端」及「不作為實盤唯一保護」的產品邊界。5173 頁面關閉 MUST NOT 刪除策略；本機關機、睡眠、網路、Shioaji session 或 Runtime 不可用時，系統 MUST NOT 宣稱仍在監控或暗示有券商端保護。

#### Scenario: 關閉 5173 後本機服務仍正常
- **WHEN** simulation business session、行情與 Runtime 正常，使用者關閉 5173
- **THEN** Runtime MUST 繼續監控既有策略，重新開頁後 MUST 顯示同一持久化快照

#### Scenario: Runtime 心跳逾時
- **WHEN** 前端無法取得 Runtime heartbeat
- **THEN** UI MUST 推導顯示「監控未知／離線」與最後確認時間，不得假稱 Runtime 已成功把策略改為 paused

### Requirement: 本機控制面必須有 same-origin 認證與 CSRF 邊界
browser MUST 只透過 5173／packaged app 的 same-origin gateway 存取 Runtime。gateway MUST 從 repo 外目前使用者私有的 `0600` 檔讀取 capability 並注入內部請求；capability MUST NOT 暴露給 JavaScript、SQLite、URL、status 或 log。Runtime MUST 只綁 `127.0.0.1`，所有 endpoint 都 MUST 驗證 capability、精確 Host、Origin／Fetch Metadata、method 與 size limit，且 MUST NOT 提供 wildcard CORS 或 GET side effect。mutation endpoint 另 MUST 要求 JSON、CSRF token、schema、request ID、revision 與 replay guard；read endpoint MUST 驗證 query schema 且不得有 side effect；SSE MUST 驗證 auth／Origin、bounded cursor或 `Last-Event-ID`，不要求 JSON body／CSRF revision；health MUST 只回不含個資與秘密的最小摘要。

#### Scenario: 合法 same-origin 請求
- **WHEN** 5173 gateway 收到同源、合法 Origin、CSRF／request ID 與 schema 的請求
- **THEN** gateway MAY 注入內部 capability 並把請求轉送到 loopback Runtime

#### Scenario: 惡意網頁直接呼叫 Runtime
- **WHEN** 請求來自不同 Origin、simple form、惡意 Host、缺少 capability、重放 request 或非 loopback
- **THEN** gateway 與 Runtime MUST 在任何狀態讀寫或 broker 呼叫前拒絕並寫入不含秘密的安全 reason code

#### Scenario: 合法 SSE 連線
- **WHEN** 已認證的 same-origin client 以合法 cursor 建立事件 SSE
- **THEN** Runtime MUST 套用 SSE endpoint 規則與 bounded replay，不得要求 mutation JSON body，也不得允許 SSE 連線改變狀態

#### Scenario: Cloudflare 路徑嘗試建立策略
- **WHEN** 請求經由 Cloudflare、公開 host 或非本機 reverse proxy
- **THEN** 系統 MUST 拒絕智慧單控制面，不得把本機交易 Runtime 暴露為遠端服務

### Requirement: Runtime 必須是 single-writer 並使用具故障邊界的 SQLite
Runtime MUST 以 OS exclusive lock、SQLite fencing token 與 API generation 保證只有一個 active sender。資料庫 MUST 使用專案核准、Node LTS `>=24.15.0 <25`且通過原生Apple Silicon arm64 capability gate的`node:sqlite`、`foreign_keys=ON`、WAL、`synchronous=FULL`、busy timeout、defensive mode、single writer 與 transaction migration。同步 SQLite 操作 MUST 在 dedicated worker thread 或具等價隔離的序列化 DB executor 執行，不得阻塞 quote／trade event loop；DB latency watchdog、queue age或備份超過版本化門檻時 MUST使交易 readiness 為 false。DB、WAL、SHM 與 backup MUST 使用目前使用者私有權限。

本change的sidecar／Node `node:sqlite`交易Runtime第一階段 MUST只在原生、非虛擬化Apple Silicon `arm64` macOS實機啟動。installer、sidecar process entry、capability probe、Gate evidence verifier與broker-authority projection MUST共同驗證`darwin + processArch=arm64 + hardwareArch=arm64 + uname=arm64 + hypervisorPresent=0`；Intel Mac／`x64`、Rosetta、VM、Windows與Linux MUST在sender啟動及任何broker authority核發前fail closed。舊雙架構schema、`x64` report、未受信host key、偽造簽章，或`runId + resultHash`不符合current單host trust manifest綁定的重放report MUST不具eligibility。RealTimeStock一般前端與桌面主程式既有平台支援 MUST維持不變；未來Intel交易Runtime MUST另立OpenSpec change並取得原生Intel實機證據。

#### Scenario: 第二個 Runtime 同時啟動
- **WHEN** 已有 active sender 持有有效 lock 與 fence，第二個程序嘗試使用同一資料庫
- **THEN** 第二個程序 MUST 退出送單角色或只提供明確唯讀診斷，且不得 dispatch

#### Scenario: migration 或 integrity 失敗
- **WHEN** migration、disk full、read-only、permission、integrity check 或 backup 驗證失敗
- **THEN** Runtime MUST 停止 readiness、保留原資料與一致性備份，不得建立空 DB 或降級成無持久化送單

#### Scenario: 活動資料庫備份
- **WHEN** 系統建立智慧單資料備份
- **THEN** MUST 使用 SQLite backup API 或等價一致性 snapshot，restore 後 MUST 通過 schema version、row count 與 integrity check

#### Scenario: SQLite 或備份操作變慢
- **WHEN** DB worker、fsync、checkpoint或backup latency超過核准門檻，或DB queue開始累積
- **THEN** Runtime MUST停止新activation／dispatch並標示repository not ready，不得讓同步SQLite操作卡住行情或成交事件處理後仍繼續送單

### Requirement: 策略與 broker 操作必須固定綁定明確交易身分
策略 MUST 保存建立時的 authenticated identity group、`broker_id`、`account_id`、`account_type`、simulation generation、canonical contract、`Cash/Common`、數量單位與版本。place MUST 帶完整固定帳號；query、position、`update_status` 與 trade subscription MUST account-scoped。若 upstream update/cancel 只接受 `Trade`／`trade_id`，Runtime MUST 先從固定帳號的 refreshed trades 唯一解析，將 target 綁定 immutable broker identifiers、`Asia/Taipei trade_date`、account、contract、side、remaining quantity與broker-order revision，並在per-account／per-order operation lock內、HTTP write緊鄰前重新驗證 terminal state、remaining quantity與revision，再使用 upstream 實際支援的 payload。target已改變時舊intent MUST作廢並reconcile；若可能已有bytes送出則轉unknown，不得retry。operation 後 MUST以 event／account-scoped reconciliation 驗證；不得捏造不支援欄位、使用 UI current account、其他帳號或 server default。

#### Scenario: 建立後切換 UI 帳號
- **WHEN** 使用者以帳號 A 建立策略後把前端切換為帳號 B
- **THEN** 原策略仍只可使用帳號 A，且任何對帳或委託都不得落到帳號 B

#### Scenario: 帳號欄位缺少或回傳不符
- **WHEN** broker request 缺少固定帳號欄位，或 response／event 的帳號與策略不符
- **THEN** Runtime MUST 拒絕或轉 `manual_intervention`，不得回退到 default account

#### Scenario: update 或 cancel 無法唯一解析 Trade
- **WHEN** 固定帳號 refresh 後找不到唯一符合 broker identifiers、contract 與狀態的 Trade，或 upstream 結果無法回證帳號
- **THEN** Runtime MUST 阻擋 update/cancel 並轉人工處理，不得只憑 UI 傳入的 `trade_id` 操作可能屬於其他帳號的委託

#### Scenario: update 或 cancel 等待期間 target 已變更
- **WHEN** 已解析的Trade在等待limiter／operation lock期間被外部fill、cancel或update而revision、terminal state或remaining quantity改變
- **THEN** Runtime MUST在任何broker bytes前作廢stale intent並reconcile；若無法證明bytes尚未送出則 MUST轉unknown，不得拿舊Trade重送

### Requirement: authenticated identity group 必須穩定不可逆且在不確定時 fail closed
Runtime MUST 只用 Gate 0 證明為 broker-authenticated、可跨固定股票帳號穩定對應同一人的 canonical principal，搭配與 gateway capability 分離的 repo 外 `0600` per-install identity key，以完整 `HMAC-SHA-256` 衍生 `identity_group_id`。原始 principal MUST NOT 寫入 DB、UI、status、URL 或 log；衍生結果 MUST 跨重啟一致。key 遺失／rotation、principal 不可用、帳號 mapping 衝突或疑似 collision 時 MUST 關閉 write master，且有未終結義務時不得建立新 group 繞過計數。

#### Scenario: Runtime 重啟後同一身分登入
- **WHEN** 同一 canonical principal 與未變更 identity key 在 Runtime 重啟後重新載入
- **THEN** MUST 產生相同 identity group 並延續跨帳號本機上限，不得退化為逐帳號計數

#### Scenario: identity key 遺失或 mapping 衝突
- **WHEN** identity key 無法讀取、被替換，或同一帳號對應到不一致 principal group
- **THEN** Runtime MUST fail closed、保留既有義務與 audit，且不得自動產生新 key 後恢復送單

### Requirement: 持久化模型必須分離策略、activation、intent 與 broker order
系統 MUST分別持久化Strategy、Activation、OrderIntent、BrokerOrder、PendingProtectionCommitment／ProtectionObligation、EntryExposureReservation、ExitClaim（含Runtime `PositionExitReservation`與外部 `ExternalSellClaim` lineage）及EventJournal，並為每一層定義allowlisted transition、terminal狀態、reason code、revision與時間。相同名稱的`filled` MUST NOT混用為策略完成、單次activation、broker委託完成或protection obligation進度。

#### Scenario: Runtime 在 part-filled 時重啟
- **WHEN** broker order 為 `part_filled` 且 Strategy 仍有剩餘義務時 Runtime 重啟
- **THEN** Runtime MUST 從各層狀態復原並先 reconciliation，不得把整體策略誤標為 completed

#### Scenario: 非法狀態轉移
- **WHEN** stale event 或舊版 UI 要求不在 transition allowlist 的變更
- **THEN** Runtime MUST 拒絕變更、保留較新 revision 並 journal 該 reason

### Requirement: 每個 broker side effect 必須先持久化意圖
Runtime MUST在呼叫broker前，以同一SQLite transaction保存canonical payload hash、決定性activation ID、order intent、適用的protection obligation／reservation、mode／risk／account／target revision與事件。`prepared→dispatching` MUST先以`dispatch_attempt_nonce`與sender fence完成durable fsync commit，adapter只有在驗證此dispatching state後才可取得寫socket權限；一旦dispatching已commit，任何crash即使發生在第一個byte前也保守視為unknown／reconciling，不得當成proven-unsent。只有仍為prepared且能證明adapter從未取得dispatch權的intent，才可在reconciliation與使用者re-arm後執行一次。建立策略、操作與dispatch MUST使用client request ID及replay guard。

#### Scenario: 程序在 broker 呼叫前當機
- **WHEN** intent 已 commit 但尚未開始 broker 呼叫時程序當機
- **THEN** 復原 MUST 能證明尚未 dispatch並顯示「已準備、尚未送出」；完成 reconciliation、重新確認最新 confirmation／risk revision且使用者明確 re-arm 前不得 dispatch，re-arm 後仍只能使用原 intent 執行一次或取消

#### Scenario: 使用者重複點擊建立
- **WHEN** 相同 client request ID 與 payload hash 被重送
- **THEN** Runtime MUST 回傳同一 canonical 結果，不得建立第二筆策略或 activation

#### Scenario: dispatching commit 後第一個 byte 前當機
- **WHEN** dispatch attempt已durable commit為dispatching，但程序在adapter寫出第一個socket byte前當機
- **THEN** recovery MUST仍把intent列為unknown／reconciling並以固定帳號對帳，不得因推測「可能尚未送」而re-arm或建立第二個attempt

### Requirement: 自動送單只能提供 at-most-once dispatch 不得宣稱 broker exactly-once
每個 activation/leg MUST 只建立一個有效本機 intent；重複行情、重複成交、SSE 重連或重啟 MUST NOT 對已確認 dispatch 的同一 intent 自動重送。canonical broker correlation key MUST至少包含固定account tuple、`Asia/Taipei trade_date`、contract、side及Gate 0證明穩定的broker identifiers；`custom_field`只能是輔助證據，不得單獨識別委託。缺少trade date、跨日identifier碰撞或無法唯一關聯時 MUST進`manual_intervention`，禁止update／cancel／重送。SQLite unique key 或 `custom_field` MUST NOT 被描述為 broker exactly-once 保證。

#### Scenario: HTTP write 後回應遺失
- **WHEN** Runtime 已可能把 request 寫給 broker，但未取得可確認回應
- **THEN** intent MUST 進入 `unknown`／`reconciling`，先以固定帳號和可驗證 identifiers 對帳；無法唯一確認時 MUST 進 `manual_intervention` 且不得自動重送

#### Scenario: deal event 早於 order ack
- **WHEN** broker deal event 先於 place response 或 order event 到達
- **THEN** Runtime MUST 以帳號、trade ID、contract 與已驗證 metadata 關聯同一 intent，不得建立第二個 broker order

#### Scenario: metadata round-trip gate 未通過
- **WHEN** simulation spike 尚未證明 `custom_field`、order/deal IDs 與帳號可可靠 round-trip
- **THEN** simulation write master MUST 維持關閉

#### Scenario: canonical correlation 唯一解析同交易日 target
- **WHEN** fixed account tuple、`Asia/Taipei trade_date`、contract、side與Gate 0已驗證的broker identifiers共同解析到唯一、non-terminal且revision未變的target
- **THEN** Runtime MAY把該target交給write-adjacent update／cancel重驗，但`custom_field`不得作唯一鍵，任何queue等待後仍須重新確認同一canonical key與revision

#### Scenario: 次交易日重用 seqno 或 ordno
- **WHEN** broker在不同`Asia/Taipei trade_date`回傳相同seqno／ordno，或event缺少可驗證trade date
- **THEN** Runtime MUST保留兩筆獨立證據或轉`manual_intervention`；不得把新單關聯到舊單，也不得對任一筆自動update、cancel或retry

### Requirement: broker reconciliation 必須明確帳號、有界且以事件為主
Runtime MUST 為固定帳號建立 trade subscription，並在啟動、SSE disconnect/reconnect、heartbeat timeout、API generation 改變、wake、未知 submission 或人工 refresh 時，以固定帳號呼叫 `update_status` 並查詢 trades／positions。事件是正常主路徑，polling MUST 有上限與退避。

#### Scenario: 斷線期間 broker order 已成交
- **WHEN** Runtime 重連後查到本機標示 working 的 order 已全部成交
- **THEN** reconciliation MUST 更新 BrokerOrder 與對應 activation，再依策略義務推進，不得重送原單

#### Scenario: upstream 沒有穩定事件序號
- **WHEN** Shioaji SSE 未提供經實證可持久化的全域事件 ID
- **THEN** 系統 MUST 以 connection／heartbeat／generation epoch 觸發 full reconciliation，不得虛構精確事件缺口偵測

### Requirement: 所有 RealTimeStock 交易寫入必須經同一 gateway 與 arbiter
對可啟用自動化的股票帳號，OrderTicket、Flash、Grid、智慧單及所有其他 RealTimeStock 交易入口的 place、update、cancel MUST 經相同 mode、account、unit、risk／reservation governance 與 queue authority；不得由 browser 或 sidecar 旁路直送 8080。系統 MUST 保存並測試 route／order-class coverage matrix，分開「既有手動委託支援矩陣」與「智慧單／自動保護縮限矩陣」；自動化只允許第一階段 `Cash/Common`，但不得因此默默改寫或禁用既有手動 FOK、IntradayOdd、daytrade 或其他已支援類型。任一 write route 未納管或手動等價行為未證明時，該帳號的 automation write master MUST 為 false。

#### Scenario: 手動單與保護單競爭同一部位
- **WHEN** 手動賣單與保護策略同時要求相同可用現股
- **THEN** arbiter MUST 以同一 reservation ledger 序列化決策，拒絕或縮減超過可用量的後來請求

#### Scenario: 外部 App 改變部位
- **WHEN** 非 RealTimeStock client 的委託或成交使 broker position／working orders 與 ledger 不同
- **THEN** Runtime MUST reconciliation 並暫停受影響自動 dispatch；不得宣稱能阻擋外部交易

#### Scenario: 既有手動 FOK 或零股尚未通過 gateway 回歸
- **WHEN** route matrix 發現某既有手動 order class 尚未能以原 payload、確認與風控語意經 gateway 執行
- **THEN** 系統 MUST 保留該手動功能現況並禁止該帳號啟用自動化，或另經使用者同意列為 breaking change；不得讓它成為自動化開啟後的隱藏旁路

### Requirement: 每個 broker write 必須使用 server-derived provenance 防止 confused deputy
Gateway MUST在可信server boundary衍生不可由browser payload指定或降級的`BrokerWriteProvenance`，只允許`manual_user_confirmed`、`automation`、`gate_probe`。`automation`必須綁定strategy／activation／intent並通過完整automation gate conjunct；`manual_user_confirmed`必須來自核准manual route、短效一次性使用者confirmation與coverage manifest，仍通過simulation、固定帳號、canonical risk／unit／reservation，但不要求strategy arm，且scheduler／background不得呼叫；`gate_probe`只可來自獨立CLI nonce envelope。unknown、衝突或缺provenance MUST fail closed。

#### Scenario: automation 偽造 manual provenance
- **WHEN** scheduler、quote callback或automation request嘗試呼叫manual endpoint、重放manual confirmation或在payload宣告`manual_user_confirmed`
- **THEN** gateway MUST在任何broker bytes前拒絕；provenance只能由server依可信route、caller與nonce衍生，不得接受client supplied value

#### Scenario: automation gate 關閉時合法手動 ticket下單
- **WHEN** automation manifest／feature gate未解鎖，但使用者在已完成coverage的manual ticket即時確認合法委託
- **THEN** manual write MAY依manual policy經同一gateway送出，payload與既有語意不得被automation allowlist改寫；該操作仍 MUST通過mode、account、risk、unit與reservation

### Requirement: 每次交易寫入必須雙重證明 simulation
Runtime MUST 在每次 place、update、cancel 緊鄰執行前，同時驗證 mode marker 與 `/api/v1/info.simulation === true`，並確認同一 API generation、single-writer fence 與固定帳號 readiness。broker dispatch MUST在durable `dispatching` commit前取得跨程序 shared mode execution lease，並持有到broker response／event identifiers與結果已durable commit為`acknowledged`／terminal，或已durable commit為`unknown`／`reconciling`；僅HTTP write或response返回不得釋放。若結果持久化失敗，sender MUST fail-stop且DB保留阻擋狀態。mode switch MUST 取得 exclusive lease、先阻擋新 dispatch、等待所有 execution lease 結束後才能改 marker／generation。未知、逾時、不一致、unmanaged 8080、無法驗證 generation 或 mode 正在切換 MUST fail closed。

#### Scenario: 條件命中同時切換 mode
- **WHEN** 條件已建立 intent，但 mode generation 在 broker 呼叫前改變
- **THEN** Runtime MUST 使舊 fence 失效並阻擋 broker call，不得依較早的 simulation 檢查送出

#### Scenario: 直接 sidecar 呼叫 8080
- **WHEN** sidecar 的 broker adapter 準備呼叫 8080
- **THEN** adapter MUST 執行與 Vite guard 等價且更嚴格的雙重 attestation，不得因未經 Vite 而跳過安全邊界

#### Scenario: mode switch 與 HTTP write 競爭
- **WHEN** dispatch 已取得 shared execution lease，另一程序要求切換 mode
- **THEN** mode switch MUST 等待broker結果及其durable state commit，或durable unknown／reconciling commit後才取得 exclusive lease；不得在 request 可能寫入broker或結果只存在記憶體時更換 API generation

#### Scenario: broker ack 後尚未 durable commit 即當機
- **WHEN** broker response或event已回傳accepted identifiers，但Runtime在寫入acknowledged前當機或DB fsync失敗
- **THEN** shared lease不得被正常路徑提前釋放；sender MUST fail-stop，復原時dispatching intent阻擋mode switch並先reconcile，不得以記憶體中的ack宣稱已安全結束

### Requirement: Runtime 必須持有 canonical 風控與分級 kill switch
Runtime MUST 持久化版本化 risk policy、日損／PnL as-of、account readiness 與 `pause_new_exposure`、`pause_automation`、`emergency_block_all_writes`。三種switch的effective policy MUST採deny-union，任何switch不得重新允許另一個已禁止的operation；switch mutation與dispatch MUST共用arbiter線性化點與revision。switch revision durable commit後不得開始新的被禁止write；已越過dispatch線性化點者只能以confirmed或unknown完成並reconcile，不得宣稱 emergency 已撤回該broker write。前端只可透過受驗證 API 編輯；建立與每次 dispatch 都須重新評估。智慧單 MUST NOT 接受 `bypassRisk`。

#### Scenario: 日損上限命中
- **WHEN** canonical risk 判定新增或增加曝險已超過日損／單筆上限
- **THEN** Runtime MUST阻擋exposure-increasing intent；只有同時通過帳號、部位、單位與reservation、依最近broker證據本地驗證的reduce-only protection才可依policy繼續，且UI須揭露外部TOCTOU不是原子保證

#### Scenario: 風控資料過期
- **WHEN** PnL、position、policy revision 或帳號資料已逾時或缺失
- **THEN** Runtime MUST fail closed，不得把不明 intent 當作 reduce-only 繞過

#### Scenario: emergency block
- **WHEN** `emergency_block_all_writes` 啟用
- **THEN** 所有 gateway broker writes 包含保護與取消 MUST 被阻擋，UI MUST 明示使用券商官方管道人工處置

#### Scenario: pause new exposure
- **WHEN** `pause_new_exposure` 啟用且 intent 會新增／增加曝險
- **THEN** Runtime MUST 阻擋該 intent；只有依最後 broker 證據、帳號、單位與 reservation 本地驗證的 reduce-only protection，以及使用者明確取消 working order，才 MAY 依 policy 繼續

#### Scenario: pause automation
- **WHEN** `pause_automation` 啟用
- **THEN** 所有自動 place／update／cancel MUST 停止；原本要求自動取消的收盤或 entry-race 流程 MUST 改為 `manual_intervention`，只有使用者再次確認的人工 cancel MAY 經 gateway 執行

#### Scenario: 多個 kill switch 同時啟用
- **WHEN** `pause_new_exposure`、`pause_automation`或`emergency_block_all_writes`同時存在不同revision
- **THEN** Runtime MUST套用所有禁止條件的聯集，且以最新durable revisions稽核；較寬鬆switch不得覆寫或重新允許較嚴格switch禁止的write

#### Scenario: emergency 與 dispatch 同時發生
- **WHEN** emergency revision在某intent等待arbiter時commit，或在該intent已越過dispatch線性化點後commit
- **THEN** 前者 MUST在任何broker bytes前被阻擋；後者 MUST保守完成confirmed／unknown與reconciliation，不得標示為已被emergency取消

### Requirement: canonical daily PnL 必須有版本化計算與新鮮度契約
Runtime MUST 以版本化 `PnlPolicy` 明定 `Asia/Taipei` trade date、per-account與identity-group aggregation、realized／unrealized／fee／transaction-tax components、broker／deal／position／quote來源欄位、估值價、decimal rounding、盤中 5 秒 freshness TTL 與 reset 條件。每次啟動、重啟與盤中恢復的PnL readiness MUST以account-scoped current-trade-date full reconciliation證明涵蓋所有固定帳號在Runtime啟動前及外部client產生的本交易日成交、費用與稅額；只觀察啟動後event stream不足以解鎖。deal／position event 重排或重複時 MUST 從去重後 canonical deal ledger重算。任何必要 coverage、component、fee／tax、average cost、position、quote、account或identity mapping 缺失／過期時，受影響account與identity group的exposure-increasing write MUST fail closed，不得把缺值當 0或沿用前一交易日。

#### Scenario: 本交易日完整來源可重算 PnL
- **WHEN** current-trade-date account-scoped full reconciliation涵蓋Runtime啟動前與外部client的全部成交、fee、tax、position及估值來源，且as-of未逾5秒
- **THEN** Runtime MUST從去重後canonical deal ledger重算per-account與identity-group PnL，並只在兩層風控皆通過時把結果交給新增曝險判斷

#### Scenario: 成交事件重複或晚到
- **WHEN** 同一 deal 重複到達，或較早成交在較晚 event 後才補到
- **THEN** Runtime MUST 依 broker identifiers去重並重算該帳號與identity group PnL，不得雙重累加或以接收順序決定日損

#### Scenario: 跨交易日但對帳未完成
- **WHEN** `Asia/Taipei` 日期改變，但官方 calendar、business session或任一固定帳號 reconciliation尚未一致
- **THEN** Runtime MUST 保持 exposure-increasing writes 關閉，不得先把日損歸零再送新單

#### Scenario: fee 或 tax mapping 未通過 Gate 0
- **WHEN** 核准 PnL policy 無法從 simulation contract取得必要費用／稅額或經驗證的等價來源
- **THEN** PnL readiness MUST 為 false，write master不得以假設零費用解鎖

#### Scenario: 午盤重啟前已有外部虧損
- **WHEN** Runtime午盤啟動，固定帳號先前已由外部client成交並產生虧損，但broker API無法證明current-trade-date full deal／fee／tax coverage
- **THEN** 該account與identity group的PnL readiness MUST為false且禁止新增曝險；不得只從重啟後event stream計算較小虧損後放行

### Requirement: 行情條件必須使用即時 subscription 與可驗證新鮮度
Runtime MUST 自行管理去重的 Tick／BidAsk subscription、stream epoch、refcount 與重訂閱，不得以盤中輪詢 snapshot、ticks 或 Kbars 代替即時行情。每筆 observation MUST 帶 contract、field、trade date、exchange time、receive time、stream epoch 與品質旗標；跨日、亂序、`simtrade`、`intraday_odd`、非法值或 stale observation MUST NOT 推進條件。

#### Scenario: 快取行情已逾時
- **WHEN** 最後 observation 超過該條件 freshness window
- **THEN** 條件 MUST 顯示 stale 並停止 activation，不得用快取值假裝即時

#### Scenario: AND 條件時間不一致
- **WHEN** 多條件 AND 的 observation 不同交易日、不同 stream epoch 或時間差超過 3 秒
- **THEN** AND MUST 視為未成立，直到所有條件取得 coherent fresh observations

#### Scenario: 啟用時條件已成立
- **WHEN** fresh current observation 在策略啟用時已為 true
- **THEN** 預設 `require_rearm` MUST 等待 false 後再出現 true；只有已保存且明確確認 `immediate_if_true` 才可立即 activation

### Requirement: 斷線、睡眠與 clock gap 必須採可重建或人工處理
Runtime MUST 偵測 SSE 斷線、API generation 變化、macOS sleep/wake、長 event-loop pause 與 wall-clock jump。恢復後 MUST 先停止 dispatch、reconcile orders／positions／subscriptions／calendar，再依策略類型處理 gap；不得自動補造 crossing、trailing 極值或 missed schedule。

#### Scenario: crossing 條件在 gap 期間可能發生
- **WHEN** Runtime 無法以完整可驗證資料判定 false-to-true crossing 是否在 gap 期間發生
- **THEN** 策略 MUST 進 `recovery` 或 `manual_intervention`，不得依重連第一筆行情猜測

#### Scenario: trailing 極值無法完整重建
- **WHEN** sleep／斷線期間的完整 ticks 無法取得或資料不符合交易日與品質契約
- **THEN** Runtime MUST 保留最後已確認極值、停止自動 dispatch並要求人工處理；盤中查詢 historical ticks只可事後稽核，不得用來重新解鎖或重設極值

#### Scenario: 排程點在離線期間錯過
- **WHEN** 定時定量 slot 在 Runtime 不 ready 時已過
- **THEN** slot MUST 標為 missed，不得復原後 burst 或隔日補送

### Requirement: 交易日曆與 canonical contract 不可用時必須停止
排程 MUST 使用 `Asia/Taipei`、版本化 TWSE／TPEx 官方交易日曆、Gate 0 核准的 trusted time authority 與可驗證 business session。時間型 activation 前本機 wall clock 與 trusted time skew MUST 不超過 2 秒。交易價格與數量 MUST 使用完整、未過期 canonical contract 的 exchange、security type、category、reference、limit up/down、unit 與 update date；不得以平日推測交易日或以代碼前綴猜 ETF。

#### Scenario: 臨時休市或日曆過期
- **WHEN** 官方 calendar 未涵蓋日期、來源過期、與 business session 矛盾或發生臨時休市
- **THEN** 所有時間型 activation MUST 暫停並 journal 原因，不得送盤外或猜測委託

#### Scenario: 本機時鐘偏差
- **WHEN** 排程點到達但 trusted time 不可用，或本機 wall clock skew 超過 2 秒
- **THEN** 時間型 activation MUST 暫停且該 slot不得補送，直到校時與下一個合法 slot

#### Scenario: contract metadata 不完整
- **WHEN** contract unit、商品類別、reference／漲跌停或 update date 無法確認
- **THEN** Runtime MUST 阻擋價格換算與送單，不得使用顯示層 fallback

### Requirement: 部位 reservation 與張股單位必須 account-wide
證券數量 MUST 以帶 unit 的 base `Share` 持久化，只有在受測 broker adapter 邊界依 canonical contract unit 精確轉換 `CommonLot`。Runtime MUST 在 Gate 0 以官方完整性契約或等價可重現probe證明 account-scoped broker view 能完整列出啟動前由外部 client 建立的 working sells；單筆可見不等於集合完整。對任何exposure-increasing intent，只要versioned RiskPolicy／PnlPolicy具有quantity、notional、cash、position或order-count等可預留上限，Runtime MUST在建立intent的同一transaction原子建立worst-case `EntryExposureReservation`，並在risk評估納入所有RealTimeStock manual／automation prepared、dispatching、working buy、既有reservation與broker部位；只有policy明示沒有任何可預留維度時才可省略，且manifest MUST綁定該policy revision。對exit，Runtime MUST以每一份base shares的唯一`ExitClaim` lineage在`monitoring_reserved → intent_reserved → broker_working → consumed/released`間轉態，`unknown`為阻擋狀態；OCO winner與Runtime broker working sell沿用同一claim，不得各新增扣量，外部working sell則建立獨立`ExternalSellClaim`。依`COUNT(DISTINCT exit_claim_id)`計算的claims、外部claims與可用position MUST滿足account＋contract invariant；能力未證實時該帳號自動化保持關閉。系統 MUST 明示外部 client 在 snapshot 後仍可造成 TOCTOU，不能宣稱原子 reduce-only。

#### Scenario: 並發新增曝險納入同一 reservation CAS
- **WHEN** 兩筆exposure-increasing intent在納入全部既有position、working buy與active reservation後，合計仍低於目前account與identity-group上限
- **THEN** Runtime MUST以同一arbiter revision依序原子保存兩筆worst-case reservation，且任一筆都不得只使用提交前的舊position或PnL快照

#### Scenario: 一張與一千股轉換
- **WHEN** canonical contract unit 為 1000 shares 且使用者建立 1 CommonLot 委託
- **THEN** ledger MUST 保存 1000 Share 並只在 adapter 送出 quantity 1，任何不整除 unit 的整股請求 MUST 被拒絕

#### Scenario: current managed simulation 張股能力證據
- **WHEN** Gate 0驗證position與整股委託的單位來源
- **THEN** 唯讀probe MUST在shared mode lease內前後固定managed simulation process／generation／API fingerprint，以current OpenAPI證明`position_unit`接受`Share`且stock position的`quantity／yd_quantity`為integer，實際positions請求 MUST明確使用`unit=Share`；同一固定帳號的current Common order MUST前後一致並以其canonical contract `unit`精確換算，股票與ETF benchmark MUST各自驗證`unit／category／reference／limit_up／limit_down／update_date`。report不得保存帳號識別資料，MUST綁current production parser／observer／adapter source matrix並由verifier重算；空positions response只有在current OpenAPI契約同時通過時才可作為無持股的正常結果，fixture、舊schema、stale／重放、source drift、欄位缺漏、snapshot漂移或任何broker write計數非0都 MUST拒絕。

#### Scenario: 兩個策略保護同一部位
- **WHEN** 第一個策略已 reservation 全部可用部位，第二個策略要求相同數量
- **THEN** Runtime MUST 拒絕或只允許剩餘可用量，不得讓兩者各自保護整筆部位

#### Scenario: 兩個並發買單合計超過曝險上限
- **WHEN** 兩個exposure-increasing intent各自看似低於上限，但worst-case數量／notional合計超過同一account或identity policy
- **THEN** 同一arbiter transaction／CAS最多允許其中一筆建立完整EntryExposureReservation；另一筆 MUST縮減或拒絕，不得以尚未成交為由忽略

#### Scenario: OCO winner 轉為 broker working 不得重複扣量
- **WHEN** 1000 Share protection claim從monitoring_reserved成為winner intent，再被broker確認working
- **THEN** account invariant仍 MUST只計同一1000 Share的單一ExitClaim lineage，不得因reservation、winner與working order三個representation變成2000或3000 Share

#### Scenario: working order 與 position drift
- **WHEN** 外部成交或取消回報使 available position／working order 無法與 reservation 唯一對應
- **THEN** 受影響策略 MUST 進 `manual_intervention`，不得自動形成反向空頭

#### Scenario: Runtime 啟動前已有外部 working sell
- **WHEN** 固定帳號在 Runtime 啟動前由券商 App或另一 client建立 working sell
- **THEN** readiness只有在Gate 0以多筆已知外部working sells、sidecar停止／重啟及前後identifier／quantity／status集合對照，或更強官方契約證明完整列舉並納入ExternalSellClaim後才可為true；只看到一筆probe order或Runtime自己的order不足，無法證明時該帳號自動化 MUST disabled

#### Scenario: 外部 sell 在最後對帳後競爭
- **WHEN** Runtime 已依最新 snapshot通過本地 reduce-only檢查，但外部 client在 broker write前新增或成交 sell
- **THEN** Runtime MUST 把這視為殘餘風險，在下一個 event／reconciliation立即停送與告警，且不得自動重送或宣稱絕對不會超賣

#### Scenario: exit 在 queue 等待時出現外部 sell
- **WHEN** exit intent已prepared並等待limiter／arbiter slot，期間外部client新增或成交sell
- **THEN** Runtime MUST在取得account arbiter slot後、broker write緊鄰前以有界新鮮度重驗position、working-sell set與revision；已改變時作廢舊intent並reconcile／轉人工，不得送出舊數量

### Requirement: health 與交易 readiness 必須分開
`health` MUST 只表示程序可回應；交易 `readiness` MUST 同時要求 repository integrity、single-writer fence、simulation 雙重 attestation、固定帳號 signed、stable identity group、account-scoped orders／positions與外部 working-sell reconciliation、trade subscription、canonical risk／PnL、calendar、contract、fresh quote、全域資源 headroom 與無阻擋 unknown intent。2330 Snapshot watchdog 成功 MUST NOT 單獨代表可送單。

#### Scenario: API listener 正常但帳號事件未訂閱
- **WHEN** 8080 health 成功，但固定帳號 trade subscription 或 reconciliation 未完成
- **THEN** Runtime health MAY 為 up，但 write readiness MUST 為 false

#### Scenario: quote ready 但 DB read-only
- **WHEN** 行情新鮮且 simulation session 正常，但 repository 不可寫
- **THEN** Runtime MUST 拒絕所有新 strategy、intent 與 broker writes

### Requirement: Runtime 資源使用必須遠離官方上限
Runtime MUST 共用既有 Shioaji login且不得自行建立第二個 login。官方公開限制 MUST 分開記錄與計量：market data 50 次／10 秒、accounting 25 次／5 秒、orders 250 次／10 秒、`api.subscribe()` 最多200個subscriptions／訂閱項目、每個`person_id`最多5個connections、login每日最多1000次。官方頁面未定義200的Tick／BidAsk／商品等實際計數維度與跨client共享範圍；Runtime MUST NOT把它改寫成「200個標的」或已證實的「同一login全域subscription 200」。Gate 0 task 0.16 MUST先證實計數維度，以及5173、5174、watchlist、chart、alert與smart-order是否共享同一個可列舉的subscribe ownership／資源池；只有完整可見且計數維度明確時，coordinator MAY對該已證實資源池採本地160上限與40 headroom，無法取得完整ownership／usage時智慧單不得新增demand。place、update、cancel、`update_status`等operation MUST先由Gate 0分類到正確官方rate bucket，並在分類未完成前套用更保守的本地共同limiter；核准後仍採本地平均不超過每秒5筆及bounded queue／backpressure。queue MUST保留不可被新曝險消耗的安全容量與優先級：reconciliation／status最高，其次為使用者即時確認的cancel與已驗證reduce-only protection，最後才是新曝險；低優先operation不得餓死安全工作。subscription、read-only reconciliation及「尚未進入dispatch、可證明沒有任何bytes寫向broker」的prepared intent MAY使用有界退避；write一旦進入dispatch或可能寫到socket，timeout／connection error MUST視為unknown並對帳，MUST NOT重新排隊或重送。

#### Scenario: 已知全域使用量仍保有本地 headroom
- **WHEN** Gate 0已證實subscription計數維度、全部ownership、目前usage及operation rate bucket，且加入需求後仍低於本地160上限並保留40 headroom
- **THEN** resource coordinator MAY配置該subscription或queue slot，但 MUST持續使用bounded queue、版本化limiter與queue-head write-adjacent revalidation

#### Scenario: subscription budget 用盡
- **WHEN** 已證實共享的本地資源池 demand 加上新策略會達160、ownership未知、外部client使用量不可見或subscribe回報失敗
- **THEN** Runtime MUST 拒絕啟用並顯示資源原因，不得輪詢 snapshot 代替

#### Scenario: rate bucket 尚未證實
- **WHEN** Runtime 無法證明一個 accounting、status 或 order operation 應計入哪個官方 rate bucket
- **THEN** Runtime MUST套用較保守的本地共同 limiter 或停用受影響功能，不得把較寬鬆的 bucket 當預設值

#### Scenario: broker queue 滿
- **WHEN** pending broker writes 達 bounded queue 上限
- **THEN** Runtime MUST 停止接受新 activation、保留既有 intent 與告警，不得無界堆積或越過 limiter

#### Scenario: 新曝險塞滿一般 queue
- **WHEN** 多筆新曝險intent已用盡一般queue capacity，且此時需要reconciliation、status或使用者確認cancel
- **THEN** Runtime MUST仍保有安全預留容量並先處理較高優先工作；不得讓新曝險排程占滿全部capacity後阻止確認未知結果或處理風險

#### Scenario: broker write timeout
- **WHEN** place、update 或 cancel 已進入 dispatch 後發生 timeout或連線錯誤
- **THEN** intent MUST 轉 unknown／reconciling，且 limiter／retry queue MUST NOT 再送相同 write

### Requirement: 策略控制與 confirmation 必須版本化且不可變
任何已確認建立的 non-draft strategy，包括 observing、monitoring、paused、recovery、manual_intervention、cancel_pending 與 expired_with_obligation，其交易參數 MUST 不可原地修改；使用者只能執行 allowlisted pause、resume、cancel或複製為新 draft。pause MUST 只停止未來 activation，不得默默取消 broker working order；取消策略與取消 broker order MUST 是分開 operation。任何帳號、商品、條件、數量、價別、保護、mode或risk revision變更 MUST 使 draft confirmation hash失效。

#### Scenario: pause 時仍有 working order
- **WHEN** 使用者 pause 一筆仍有 broker working order 的策略
- **THEN** Runtime MUST 停止新的 activation，但保留並顯示 working order；除非使用者另行確認，不得自動取消

#### Scenario: resume 時條件已成立
- **WHEN** paused 策略完成 reconciliation 後 resume，而條件目前為 true
- **THEN** Runtime MUST 依已保存 activation policy 處理，且不能用 resume 操作偷偷改成 immediate trigger

#### Scenario: 修改已確認 payload
- **WHEN** confirmation 後任一交易欄位或 mode／risk revision 改變
- **THEN** create／activate MUST 被拒絕直到顯示新的 canonical snapshot 並由使用者重新確認

#### Scenario: paused 策略嘗試修改交易欄位
- **WHEN** 使用者對 paused／recovery strategy修改商品、條件、數量、價別或有效期
- **THEN** Runtime MUST 拒絕原地修改，只能複製目前內容為新 draft並產生新 strategy ID／confirmation

### Requirement: manual intervention 必須依 reason code 使用版本化解除矩陣
每個進入`manual_intervention`的reason code MUST對應版本化resolution matrix，明定必要broker evidence、允許的operation、可到達state、是否允許re-arm、EntryExposureReservation／ExitClaim／ProtectionObligation處理及audit欄位。generic resume、UI toggle或單一管理者判斷 MUST NOT清除manual狀態。unknown submission只有在固定帳號取得唯一broker final evidence時，才可依矩陣結案；若證據永遠不足，只能使用二次確認的break-glass relinquish並標示unmonitored，且原intent永不得重送。外部drift等可復原reason只有在full reconciliation、新confirmation與矩陣明示允許後才可re-arm。

#### Scenario: unknown submission 直接按 resume
- **WHEN** 使用者對無唯一broker結果的unknown／manual intent要求一般resume
- **THEN** Runtime MUST拒絕並顯示缺少的broker evidence與允許操作，不得清除unknown、釋放claim後重送原intent

#### Scenario: 唯一 final evidence 解決 manual 狀態
- **WHEN** 固定帳號reconciliation取得與canonical correlation key唯一匹配的terminal broker evidence
- **THEN** Runtime MAY依該reason code矩陣更新broker／intent／obligation／claim，保存證據hash與操作者，再決定策略是否仍需新confirmation；不得跨矩陣跳轉

#### Scenario: 無法取得證據而人工接手
- **WHEN** 使用者選擇break-glass relinquish未知義務
- **THEN** Runtime MUST二次確認、保存一致性snapshot與人工接手reason、將項目標為unmonitored，且永不自動重送原broker side effect

### Requirement: observe-only 與 write master 必須預設安全
新安裝、migration、mode 切換、Runtime upgrade、recovery 或 feature flag 首次啟用 MUST 先進入 observe-only／shadow mode。simulation 自動送單 write master MUST 由使用者在最新 readiness 與警示上明確開啟；回到 simulation 或重啟後不得自動恢復舊策略或 proven-unsent prepared intent送單。LaunchAgent自動重啟 MUST NOT 被描述為保護自動恢復。

#### Scenario: Runtime crash 後由 LaunchAgent 自動重啟
- **WHEN** Runtime在monitoring、prepared或未知broker結果期間當機並被LaunchAgent重新啟動
- **THEN** 新generation MUST先進observe-only、reconcile所有固定帳號與義務；strategy與proven-unsent prepared intent維持paused，可能已dispatch者維持unknown／reconciling，使用者明確re-arm前不得送出任何broker write

#### Scenario: 從 production-readonly 回到 simulation
- **WHEN** simulation API 與 Runtime 重新啟動
- **THEN** 既有策略 MUST 維持 paused／observe-only，完成 reconciliation 後仍需使用者明確 resume 與 arm

#### Scenario: Gate 0 尚未完成
- **WHEN** 任一 account、correlation、unit、SQLite、security 或 product-boundary gate 未通過
- **THEN** write master MUST 不可開啟，即使 UI 與 shadow conditions 正常

### Requirement: gate manifest 必須在 dispatch path 機械性強制執行
Gate runner MUST 產生 browser不可修改的machine-readable私有manifest，綁定app build、sidecar schema／adapter revision、Shioaji server version／capability fingerprint、Node／SQLite／OS platform、evidence ID／class／schema／immutable source code digest／eligibility／result hash、route coverage、PnL policy、產品邊界consent與各feature gate。每筆evidence MUST由manifest verifier以canonical serialization獨立重算result hash、required-check set與eligibility，不能相信report自稱的eligibility布林值；verifier並須確認目前source digest、必要checks全pass、零blocked／inconclusive、零broker write attempt／networked、redaction通過且app／adapter／Shioaji必要fingerprint完整。`fixture`／`test_fixture`、historical failed attempt、舊revision、`overall=test_only`或重算eligibility非true的report一律不得成為gate conjunct。`automation` provenance每次dispatch MUST驗證 `manifest valid AND Gate 1 passed AND feature gate passed AND user write master armed AND strategy armed AND current readiness`；`manual_user_confirmed`改驗manual route coverage、短效confirmation與共同mode／account／risk／unit／reservation gates，不得要求不存在的strategy arm；`gate_probe`只驗獨立probe manifest、run lineage與nonce envelope。Runtime／Shioaji／adapter／mapping／policy改變或manifest mismatch MUST回observe-only；環境變數、feature flag、UI值、provenance payload或DB單一欄位不得覆蓋相應conjunct，unknown provenance fail closed。

#### Scenario: current eligible manifest 的全部 conjunct 一致
- **WHEN** verifier依current build、schema、adapter、Shioaji與platform fingerprint重算所有required evidence hash／eligibility皆一致，且對應provenance的Gate、arm與readiness conjunct全部為true
- **THEN** manifest檢查 MAY只把請求交給下一層arbiter，仍不得單獨授予broker write authority

#### Scenario: 手動設定 write-master 環境變數
- **WHEN** Gate manifest缺失／失效，但環境變數或feature flag被設為enabled
- **THEN** dispatch MUST在建立broker side effect前拒絕，readiness MUST顯示精確缺少的gate，不能把設定值視為通過證據

#### Scenario: adapter 或 Shioaji capability 改變
- **WHEN** manifest綁定的adapter revision或Shioaji capability fingerprint與目前Runtime不符
- **THEN** 所有feature MUST回observe-only，直到重新執行相應probe、更新evidence並產生新manifest

#### Scenario: fixture、舊版或遭竄改的 probe report
- **WHEN** gate runner收到`executionMode=fixture`、`evidenceClass=test_fixture`、`overall=test_only`、historical failed attempt、舊schema／source digest、必要check缺漏／重複、任一blocked／inconclusive check，或呼叫者只把eligibility布林值改為true的report
- **THEN** manifest verifier MUST獨立重算後拒絕該evidence、標示`invalid_for_gate`且write master維持關閉；不得只因result hash格式正確、fixture可重現或report自稱eligible就採信

### Requirement: Gate 0 simulation probe 必須使用不可被策略重用的 safety envelope
需要place/update/cancel的Gate 0 contract probe MUST只透過獨立CLI／entrypoint執行，不得由策略scheduler、quote callback、一般UI API或feature flag呼叫。每次operation MUST使用一次性nonce、即時shared mode lease＋雙重simulation attestation、固定完整帳號但只在UI／evidence遮罩、最大1 CommonLot、CA／production未載入證據與該次使用者明確授權；不得開啟一般write master或自動retry。probe update／cancel只可操作同一probe run／nonce先前建立、以canonical correlation唯一確認且仍non-terminal的order，target lineage、account、trade date與revision在write緊鄰前任一改變都 MUST停止；不得接受任意UI `trade_id`、其他run order或既有simulation委託。operation後 MUST做bounded account-scoped `update_status`／trades／positions reconciliation；結果unknown時停止並轉人工，不得為cleanup猜測cancel。

Task 0.3之後的每個task-specific probe在顯示或消耗使用者授權前，MUST先以唯讀方式取得並前後固定current `reference／limit_down／limit_up／update_date／category`、合法tick、best bid／ask、可信trade date／exchange time、固定simulation帳號positions／working orders、managed generation與probe source fingerprint。短效envelope、request hash與CLI授權 MUST綁定exact商品、side、price／price type／TIF、quantity、account scope、operation、run及update／cancel target revision，production transport MUST只能傳送相同payload。Task 0.3既有`115` sender／hash／evidence MUST保持不可變且不得被後續task重用。marketable、working non-marketable與IOC zero-fill MUST各依current BBO產生不同目的價位；缺漏、stale、非法tick、穿價、漲跌停外或任何scope／fingerprint漂移 MUST fail closed。

#### Scenario: 動態價位計畫與exact授權
- **WHEN** task-specific probe已取得current完整唯讀preflight，且依測試目的產生合法、不穿價或明確marketable的短效價位計畫
- **THEN** CLI MAY顯示exact envelope供該一個operation逐次授權；授權hash、durable preflight receipt與broker payload MUST完全一致，任何重新取價或payload改動都必須作廢舊授權

#### Scenario: 無法確定重現特定simulation狀態
- **WHEN** PartFilled或其他status無法以單一bounded operation確定重現
- **THEN** probe MUST停在安全邊界並將該evidence contract標示為阻塞；不得新增或重送委託碰運氣，也不得用fixture冒充live evidence

#### Scenario: 逐次授權 probe 操作同 run 唯一 target
- **WHEN** 獨立probe entrypoint取得單次使用者授權、一次性nonce、shared mode lease、雙重simulation attestation與固定帳號，且update／cancel target由同run唯一correlation解析、revision未變、quantity不超過1 CommonLot
- **THEN** probe MAY執行該一個operation並立即做有界對帳，但一般strategy write master MUST維持關閉，該nonce與authority不得重用

#### Scenario: 未授權的 probe 嘗試送單
- **WHEN** probe沒有該次操作的一次性nonce與使用者確認，或被策略Runtime嘗試呼叫
- **THEN** probe adapter MUST在任何broker write前拒絕，且不得因Gate 0尚未完成而放寬simulation attestation

#### Scenario: probe response遺失
- **WHEN** 最小simulation probe可能已寫入broker但response遺失
- **THEN** probe MUST停止後續writes、以固定帳號有界對帳並標記unknown／manual；不得重送原operation或盲目取消

#### Scenario: probe 嘗試操作其他 run 的委託
- **WHEN** update／cancel target不是同一probe run建立，或target correlation／revision在取得operation slot前已改變
- **THEN** probe MUST在任何broker bytes前拒絕並保留稽核；不得用使用者輸入trade_id操作既有或跨run simulation order

### Requirement: 歷程、通知與資料保留不得冒充 broker 證據
Runtime MUST依versioned `Asia/Taipei` calendar-year policy保存策略、狀態、操作與bounded event journal；`purgeEligibleAt`取strategy terminal／released時間與最後關聯broker／audit evidence時間兩者較晚者，加1個calendar year，不以固定365日計。non-terminal strategy、unknown intent、working order、obligation或reservation MUST NOT因年限purge。內容不得包含API key、secret、CA、capability或未遮罩秘密。macOS通知 MAY提醒觸發、接受、部分／全部成交、失敗、離線與人工介入，但通知 MUST NOT作為broker狀態證據。

#### Scenario: 查看策略歷程
- **WHEN** 使用者開啟策略詳情
- **THEN** 系統 MUST 顯示 exchange／broker／receive time、reason code、intent 與 broker 狀態的區別，帳號以遮罩識別顯示

#### Scenario: 一年資料到期
- **WHEN** terminal／released strategy的較晚終結或最後證據時間加1個calendar year已到，且不再有任何未終結義務
- **THEN** Runtime MAY依版本化purge policy移除或彙總；閏日／月底 MUST依golden vectors一致處理，且不得刪除仍與non-terminal／unknown／working／obligation／reservation關聯的證據

### Requirement: 舊交易 trigger 與新 Runtime 不得同時送單
系統 MUST 以單一 authority flag 原子停用舊 browser 交易 trigger 的送單能力，只允許唯讀偵測與人工重建；純 alert MUST 與交易 side effect 分離。缺少固定帳號、confirmation revision 或 broker correlation 的舊 trigger MUST NOT 自動匯入或啟用。

#### Scenario: 升級時發現舊 trigger
- **WHEN** `localStorage` 中存在 schema 可讀的舊交易 trigger
- **THEN** UI MUST 顯示「待人工重建」，要求重新選帳號、商品、數量與 simulation confirmation，不得靜默啟用

#### Scenario: 新 Runtime 成為 authority
- **WHEN** smart-order Runtime 的 authority flag 已啟用
- **THEN** 舊 `trigger-engine` MUST NOT 呼叫任何 broker write；純 alert 仍可在無交易權限的路徑運作
