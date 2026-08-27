# smart-order-panel Specification

## Purpose
TBD - created by archiving change add-durable-smart-order-panel-and-protective-exits. Update Purpose after archive.
## Requirements
### Requirement: 工作區必須提供永久標示本機邊界的智慧下單面板
「新增面板」清單 MUST 提供「智慧下單」並建立可持久化的 `smart-order` block。面板 header、設定、確認與監控分頁 MUST 永久顯示「本機監控・非券商雲端」「不作為實盤唯一保護」，以及 Runtime heartbeat、最後 readiness、行情新鮮度與 simulation 狀態。

#### Scenario: 從新增面板建立
- **WHEN** 使用者在「新增面板」選擇「智慧下單」
- **THEN** 工作區 MUST 新增可移動、調整尺寸、關閉且重載後仍存在的面板，並立即顯示本機服務限制

#### Scenario: 本機電腦睡眠或 Runtime 離線
- **WHEN** heartbeat 或 wake recovery 尚未完成
- **THEN** 面板 MUST 顯示「監控未知／離線」，阻擋新啟用與送單，不得顯示雲端監控中

### Requirement: 面板必須與商品聯動但不得改寫已建立策略
草稿 MAY 依現有 workspace 聯動取得預設商品，並顯示 canonical contract、eligible quote time 與 readiness。聯動商品、帳號或 panel focus 變更 MUST 只影響尚未確認草稿；已建立策略的帳號、監控商品與委託商品 MUST 保持不可變。

#### Scenario: 聯動 K 線圖切換商品
- **WHEN** 使用者把聯動 K 線圖由商品 A 切到商品 B
- **THEN** 未確認草稿 MAY 更新為 B，既有 A 策略 MUST 不變且不得改向 B 送單

#### Scenario: 聯動商品沒有 fresh quote
- **WHEN** B 的 canonical contract 或 fresh eligible quote 尚未就緒
- **THEN** 面板 MUST 顯示 unavailable 並阻擋策略確認，不得使用 A 或快取 B 的值

### Requirement: 面板必須提供七種型別化台股智慧單
面板 MUST 提供快速單、長效單、多條件單、母子單、停損停利單、移動出場及定時定量。每種類型 MUST 使用 versioned discriminated schema，不得接受任意 JavaScript、字串 expression 或未知欄位；每種類型 MUST 有獨立 feature flag 與驗收 gate。

#### Scenario: 某一策略類型尚未通過 gate
- **WHEN** Runtime 核心已完成，但該策略的 deterministic、fault 或 simulation gate 尚未通過
- **THEN** 面板 MUST 顯示該類型未啟用，不得因其他類型可用而允許建立

### Requirement: 全新智慧單的類型選擇器必須預設移動出場單
真正零筆策略的空狀態 MUST 提供「新增智慧單」入口，開啟可存取的單選類型選擇器並列出七種類型；全新建立流程 MUST 預設選取「移動出場單」。此預設只決定新草稿的類型，不得建立策略、啟用監控、取得交易寫入授權或送出 broker intent；使用者選擇「下一步」後仍 MUST 完成該類型的設定、canonical confirmation 與 arm。取消或關閉選擇器 MUST 不建立草稿。重新開啟、返回或複製既有草稿 MUST 保留該草稿原類型，不得被預設值覆寫。

#### Scenario: 從空狀態新增全新智慧單
- **WHEN** 使用者在真正零筆策略的空狀態選擇「新增智慧單」
- **THEN** 類型選擇器 MUST 預設選取「移動出場單」，且「下一步」只進入移動出場單草稿設定，不得啟用監控或送單

#### Scenario: 移動出場單尚未通過 gate
- **WHEN** 移動出場單的 feature flag、deterministic、fault 或 simulation gate 任一未通過
- **THEN** 選擇器 MUST 將移動出場單標示為不可用並說明原因，不得因預設值解鎖，也不得自動改選快速單或其他類型；使用者明確選擇另一個已通過 gate 的類型前「下一步」MUST disabled

#### Scenario: 返回既有草稿
- **WHEN** 使用者重新開啟、返回或複製一筆原類型不是移動出場單的草稿
- **THEN** 選擇器 MUST 顯示該草稿保存的原類型，不得套用全新建立流程的預設值

### Requirement: 建立前必須確認 Runtime 回傳的 canonical 不可變快照
面板 MUST以Runtime回傳的canonical snapshot顯示遮罩帳號、不可逆authenticated identity group摘要、simulation、本機限制、監控商品、條件、activation policy、委託商品、買賣別、`Cash/Common`、base shares／CommonLots、觸發價、broker價別／效期／價格、有效期間、保護、risk revision與警示。使用者主動確認後才可建立；任何已確認的non-draft strategy，包括paused、recovery、manual、cancel-pending與expired-with-obligation，都不可原地修改交易欄位。

#### Scenario: 監控與委託商品不同
- **WHEN** 多條件單的監控商品與實際委託商品不同
- **THEN** 確認頁 MUST 分區、高可見度列出兩者與 fixed account，未確認前不得啟用

#### Scenario: 確認後 payload 改變
- **WHEN** 帳號、商品、條件、數量、價別、有效期、mode 或 risk revision 任一變動
- **THEN** 原 confirmation hash MUST 失效並要求重新取得 Runtime snapshot；不得只相信前端摘要

#### Scenario: 使用者要修改監控中策略
- **WHEN** 使用者嘗試改變任一non-draft strategy的交易欄位
- **THEN** 面板 MUST 提供「複製為新草稿」或取消後新建，不得原地 mutation

### Requirement: 快速單只可使用九種已驗證行情條件
快速單候選欄位為「成交價、買價、賣價、上漲、下跌、漲幅、跌幅、單量、總量」九種user-facing條件。每項 MUST在Gate 0完成「現行官方UI名稱／語意→本地schema／comparator／單位→實際Shioaji Tick／BidAsk欄位／品質」三層mapping；未證實欄位個別disabled，不得因同名或多條件頁出現就推定快速單完全相同。依`official-smart-order-decision-tables.md` `2026-08-11.2`，快速單只允許單一監控商品，且`monitorContract` MUST等於`orderContract`；建立時 MUST保存`require_rearm`或明確選定的`immediate_if_true`。

#### Scenario: 條件由 false 變 true
- **WHEN** eligible fresh observation 使快速單條件由 false 變 true
- **THEN** Runtime MUST 只建立一個 activation，後續等價或重複 observation 不得重複送單

#### Scenario: 啟用當下已為 true
- **WHEN** confirmation 顯示 current condition 已成立
- **THEN** 預設 MUST 等待 rearm；只有使用者另行確認「啟用後可立即觸發」才可保存 `immediate_if_true`

#### Scenario: quote 欄位未完成 API mapping
- **WHEN** 某 user-facing 欄位的實際來源、單位或品質旗標尚未由 simulation quote 證明
- **THEN** 該欄位 MUST disabled，不得猜測對應

### Requirement: 停損停利單只能保護可驗證現股多單
停損停利單 MUST從固定simulation帳號的reconciled Cash Common現股多單選擇，且position／monitor／order contract MUST相同。現行官方手冊只證實由庫存選擇「停損或停利」的核心；同一策略同時設定兩個 legs 是 RealTimeStock `local-extension`，不得宣稱為券商原子 OCO。策略沿用價位／百分比／固定ATR snapshot、既有部位broker-confirmed average-cost或明確user-specified basis、trigger／broker policy、tick、reservation、atomic OCO remainder與外部drift契約。數量 MUST依最後broker證據不超過account-wide可用部位；這是本地驗證，不得宣稱券商原子reduce-only。

#### Scenario: 為既有部位建立雙向保護
- **WHEN** 使用者為可用現股多單同時設定停損與停利
- **THEN** Runtime MUST 建立共用 protected remainder 的同組 legs，且任一 intent prepared 後 sibling 不得同時送出

#### Scenario: 部位已被其他策略保留
- **WHEN** 另一策略或 working sell 已 reservation 全部可用量
- **THEN** 面板與 Runtime MUST 顯示可用量為零並拒絕超額建立

### Requirement: 長效單必須依 1 至 30 日與累計實際成交量執行
長效單 MUST 保存 inclusive 的 `Asia/Taipei` 起訖日期，calendar-date span 為 1–30 日、目標總量、每次最大量、觸發條件與 broker policy；只在日期窗內可驗證的交易 session 監控，同一策略每個交易日最多 activation 一次。依現行官方手冊，`monitorContract` MAY不同於`orderContract`；Runtime MUST分別驗證前者的subscription／condition mapping與後者的fixed account／canonical contract／risk，任一不成立都不得arm。進度 MUST 只累計 broker 已確認的實際成交，不得以已送量或 broker accepted 量計算；隔日只監控剩餘目標，不補送前日未成交 IOC。

#### Scenario: 長效單看 A 下 B
- **WHEN** 使用者以商品A作監控條件、商品B作委託，且A與B皆通過各自的Gate 0 mapping與readiness
- **THEN** schema MUST保留兩個不同canonical contracts，Runtime MUST以A判斷條件、只以B建立intent；不得強迫兩者相同或拿A的contract資料驗B的委託

#### Scenario: 目標量不能整除
- **WHEN** 剩餘目標少於每次最大量且新交易日條件命中
- **THEN** intent 數量 MUST 只等於剩餘目標，全部成交後 Strategy 才可 completed

#### Scenario: 同一交易日再次命中
- **WHEN** 長效單當日已有一個 activation，行情再次符合
- **THEN** Runtime MUST 不建立第二個 activation，並保存下一交易日是否繼續監控的狀態

#### Scenario: 前日 IOC 未成交
- **WHEN** 前日 activation 的 IOC 零成交或部分成交
- **THEN** Runtime MUST 只累計實際成交，未成交 remainder 不自動重送；隔日依剩餘目標重新等待新條件

#### Scenario: 前日 ROD 到期或 broker 拒絕
- **WHEN** 當日唯一activation的LMT+ROD於收盤到期、部分成交、Inactive或Failed
- **THEN** 該交易日activation MUST維持已消耗，只累計broker-confirmed成交；working／unknown未完成對帳前不得啟動隔日activation，隔日只對可驗證剩餘目標重新armed

### Requirement: 多條件單必須限制七條並要求 coherent fresh observations
多條件單 MUST支援最多七個已通過三層mapping的行情條件，並選擇AND或OR。`official-smart-order-decision-tables.md` `2026-08-11.2`依現行官方手冊確認每條condition MAY使用不同`monitorContract`，`orderContract`也MAY不同於所有monitor contracts。Runtime MUST逐一驗證每個監控商品的subscription／condition mapping，並獨立驗證委託商品的fixed account／canonical contract／risk；任一必要商品或欄位未通過gate，整個策略不得arm。已核准拓樸仍須套用本地政策：AND所有true observation同一trade date／stream epoch且時間差不超過3秒；OR只由fresh eligible observation產生edge。

#### Scenario: 多商品拓樸任一 leg 未通過 gate
- **WHEN** 多條件單使用A、B、C作監控並以D委託，但其中任一商品的canonical contract、subscription、行情欄位或D的fixed account／risk尚未通過gate
- **THEN** 整個策略 MUST disabled，不得刪掉未通過的leg、改成同商品或以其他商品資料代替

#### Scenario: AND 使用不同時間的 true
- **WHEN** 某條件數分鐘前為 true，另一條件現在為 true，前者已 stale 或超過 coherence window
- **THEN** AND MUST 視為未成立，不得 latch 舊 true 觸發

#### Scenario: OR 兩條同時成立
- **WHEN** 同一 epoch 中兩個 OR 條件幾乎同時產生 true edge
- **THEN** deterministic activation key MUST 只建立一個 activation，history SHALL 記錄造成 activation 的 observations

#### Scenario: 監控商品與下單商品不同
- **WHEN** 使用者完成看 A 下 B 的設定
- **THEN** Runtime MUST 分別驗證 A 的 subscriptions 與 B 的 account／contract／risk，任一不可用都不得啟用

### Requirement: 母子單必須遵守每leg商品相等與完整有效期
母子單第一階段 MUST限定同一固定帳號、Cash Common的Buy母單與Sell子單；其他方向組合disabled。`parent.monitorContract` MUST等於`parent.orderContract`，`child.monitorContract` MUST等於`child.orderContract`，但parent與child MAY為不同商品。母單監控窗 MUST是本地保守的inclusive `Asia/Taipei` calendar-date span 1–30日，且只在其中可驗證交易session監控；只有母單broker-confirmed deal quantity等於要求數量時，才可啟動一次子單。母單partial／accepted／working都不得啟動。外部改價、改量、取消或其他revision drift使母單不再等於confirmation snapshot時，子單 MUST失效並進`manual_intervention`。子單使用自己的confirmation quantity與child商品可用現股驗證本地reduce-only，不得跨商品從母單數量推導；依現行手冊，子單未觸發或已委託未成交於母單全成交易日13:30後失效，因此監控／再送資格 MUST在該時點終止。已送broker order的ROD／IOC terminal狀態以Gate 0核准policy與account-scoped reconciliation為準；只有核准policy要求cancel且kill switch允許時才可自動cancel，否則轉人工，不得把「失效」自行解讀成任意cancel API。

#### Scenario: 母單部分成交
- **WHEN** 母單只有部分成交
- **THEN** 子單 MUST 保持未啟動，UI MUST 分開顯示母單已成交與剩餘量

#### Scenario: 母單部分成交後被取消
- **WHEN** 母單未全數成交即取消或到期
- **THEN** 子單 MUST 永不自動啟動，已成交現股 MUST 顯示為未由此子單保護並要求使用者另建保護策略

#### Scenario: deal event 重送
- **WHEN** 母單全數成交事件重送或先於 order event
- **THEN** Runtime MUST 依同一母單 activation 只啟動一次子單

#### Scenario: 母子使用不同商品
- **WHEN** 母單商品A全部成交，子單設定商品B
- **THEN** A的監控商品 MUST等於A的委託商品、B的監控商品 MUST等於B的委託商品；子單B只能依B的可用現股與reservation送出，不能把A的成交張數直接當B數量

#### Scenario: 母單在最終有效日收盤後才確認全成
- **WHEN** 母單1–30日監控窗的最後交易日結束後，reconciliation才確認母單全成
- **THEN** 子單 MUST NOT跨日啟動；策略應顯示母單結果與子單未啟動原因，要求使用者另建新策略

#### Scenario: 子單收盤仍 working
- **WHEN** 子單已送出但當日交易時段結束仍未全部成交
- **THEN** 子單策略的監控／再送資格 MUST終止；Runtime MUST先依核准broker policy對帳ROD／IOC terminal狀態，只有policy要求且kill-switch允許才cancel。狀態／取消不明即進`manual_intervention`，不得隔日再送

### Requirement: 移動出場必須只對可驗證現股多單追蹤有利極值
移動出場 MUST選擇reconciled Cash Common現股多單，且position／monitor／order contract MUST相同。現行官方手冊確認基準價、fixed stop、追蹤有利最高價及以固定價差或百分比回撤；固定ATR是RealTimeStock `local-extension`。策略 MUST保存啟動門檻、回撤距離、選用fixed stop、固定ATR snapshot、明確basis、stream epoch與有利最高價。任何交易時段subscription gap、sleep或event-loop pause後 MUST進`manual_intervention`；historical ticks只可事後稽核，不得用來重新解鎖自動出場。Runtime重啟即使能證明沒有行情gap，也必須完成reconciliation並由使用者re-arm才可恢復；第一階段不得提供空單／融券方向。

#### Scenario: Runtime 重啟且無行情缺口
- **WHEN** 已持久化最高價，重啟後 gap 可由完整合格 observations 證明沒有新極值
- **THEN** Runtime MUST在reconciliation後沿用原最高價且顯示尚未re-arm；使用者明確re-arm前不得dispatch，也不得從第一筆quote重算

#### Scenario: 無法重建睡眠期間極值
- **WHEN** Runtime 無法證明 sleep 期間的最高價與是否回撤
- **THEN** Strategy MUST 進 `manual_intervention`，不得降低 trigger 或猜測出場

### Requirement: 定時定量必須僅限建立當日並禁止補送
定時定量 MUST只針對單一商品建立當日有效策略，允許「定時」或「定量」之一。Gate 0 MUST先以現行官方手冊／畫面建立versioned mode decision table，分別定義每個輸入欄位、單位、start/end inclusivity、interval／split與slot推導、每次量、目標量、尾數、price／order policy、前單working、missed、提早收盤與收盤remainder；每個mode需有來源與golden vectors。未證實的mode／欄位 MUST disabled，不得由實作者猜測。兩者皆不得跨日期；非交易日不得建立，本地安全政策為missed／離線slot不catch up，前一筆working／unknown時不建立下一筆。

#### Scenario: 某 mode 的官方欄位或算法尚未證實
- **WHEN** 定時或定量的decision table缺少來源、單位、尾數／收盤規則或golden vectors
- **THEN** 該mode MUST在UI與Runtime保持disabled，不得以另一mode的欄位或實作者推測補齊

#### Scenario: 使用者嘗試設定跨日
- **WHEN** 草稿包含不同的開始與結束交易日
- **THEN** UI 與 Runtime MUST 拒絕，並說明定時定量僅限當日有效

#### Scenario: 前一 slot 委託仍 working
- **WHEN** 下一 slot 到達但前一筆委託尚未 terminal
- **THEN** Runtime MUST 將下一 slot 標為 skipped／blocked，不得堆疊第二筆或稍後 burst 補送

#### Scenario: 提早收盤或臨時休市
- **WHEN** official calendar／business session 表示 slot 不再屬有效交易時段
- **THEN** slot MUST 到期並 journal 原因，不得改到盤外或隔日

#### Scenario: 剩餘量小於 slot 數量
- **WHEN** slot 到達且剩餘目標少於每次量
- **THEN** intent MUST 只使用剩餘目標，並只在全部實際成交後標示 completed

### Requirement: 策略有效期與歷史必須符合明確例外
一般快速、停損停利、長效、多條件、移動出場與母子單母單的inclusive `Asia/Taipei` calendar-date span MUST為1–30日的本地保守上限，且只在日期窗內可驗證的交易session監控；Gate 0須保存官方UI cutoff算法證據，不能把本地calendar-date解讀冒充官方完整算法。母子單子單與定時定量 MUST當日有效。歷史 MUST保存一年。到期 MUST停止新activation，但不得抹除working order、reservation、obligation或unknown intent。

#### Scenario: 一般策略超過 30 日
- **WHEN** 使用者設定有效期少於 1 日或超過 30 日
- **THEN** UI 與 Runtime MUST 拒絕，不得自動截斷成另一日期

#### Scenario: 策略到期仍有 working order
- **WHEN** validity 結束時 broker order 尚未 terminal
- **THEN** Strategy MUST 顯示 expired-with-obligation 或等價狀態並繼續 reconciliation，不得把 order 當作已取消

### Requirement: 同一 authenticated identity 的未終結策略總數不得超過 20
Runtime MUST以Gate 0證明穩定的broker-authenticated canonical principal與repo外獨立`0600` identity key，使用完整`HMAC-SHA-256`衍生不揭露原始身分且跨重啟一致的identity group，並對所有固定股票帳號以`COUNT(DISTINCT strategy_id)`合併計數；同一strategy同時有order／obligation／reservation仍只算一筆，但任一義務未終結就不能釋出。key遺失／rotation、mapping衝突或無法證明跨帳號同一身分時write master fail closed。paused、recovery、manual_intervention、cancel-pending與expired-with-obligation MUST計入，不能藉狀態繞過。

這是RealTimeStock只涵蓋本change股票範圍、且使用更保守state集合的本機限制。官方20筆則是同一ID跨帳號「台股＋期權」券商雲端額度；Runtime MUST NOT宣稱能讀取、占用或同步它，也不得把兩套計數合併顯示。

#### Scenario: 不同帳號合計已達 20
- **WHEN** 同一登入身分的帳號 A 有 12 筆、帳號 B 有 8 筆未終結策略
- **THEN** Runtime MUST 拒絕任一帳號的第 21 筆，直到某筆 terminal 且不再有 broker／reservation 義務

#### Scenario: 暫停策略
- **WHEN** 使用者把監控中策略 pause
- **THEN** 該策略 MUST 繼續計入上限

### Requirement: 第一階段支援範圍必須雙層阻擋
智慧單與自動保護的面板／Runtime MUST只允許TSE／OTC `STK`的股票與ETF、`Cash/Common`、整股simulation；自動sell只可依最近broker證據本地驗證的現股多單reduce-only。零股、權證、指數、興櫃／特殊板、融資融券、當沖先賣、借券、期貨、選擇權、複委託、跨市場與contract不明 MUST被自動化拒絕。此矩陣不得誤套到既有手動下單；手動能力依central gateway route／order-class matrix另行等價納管。

#### Scenario: UI 被繞過送入不支援 payload
- **WHEN** client 直接向 Runtime 提交權證、IntradayOdd、MarginTrading 或未知 contract
- **THEN** Runtime MUST 以固定 reason code 拒絕，且不得建立 strategy、reservation 或 broker intent

### Requirement: pause、resume、cancel 與 broker order 操作必須分離
面板 MUST提供pause、resume、cancel strategy、cancel broker order、copy-to-draft與人工處理導引。pause只影響未來activation；resume必須重新confirmation目前readiness與activation policy；cancel strategy不得默認取消或保留working broker order。pause／resume是RealTimeStock本機Runtime控制，不改動immutable交易payload，也不得被描述成大戶投「只能刪除、不可修改」的官方能力。

#### Scenario: 取消仍有 working order 的策略
- **WHEN** 使用者選擇 cancel strategy
- **THEN** 面板 MUST 分別要求如何處理 working broker order，Runtime MUST journal 使用者選擇與 broker 最終結果

#### Scenario: stale UI 操作
- **WHEN** UI 以舊 strategy revision 執行 pause、resume 或 cancel
- **THEN** Runtime MUST 拒絕並回傳最新 canonical snapshot，不得覆寫較新狀態

### Requirement: 面板狀態不得把觸發或接受冒充成交
監控列表與歷程 MUST 分開顯示 condition true、activation、intent prepared、dispatching、broker pending/accepted、working、part-filled、filled、cancelled、failed、inactive、unknown、unprotected remainder 與 manual intervention。交易成功文案只能在 broker confirmed final state 使用。

#### Scenario: broker 接受但尚未成交
- **WHEN** order status 為 Submitted 且 deal quantity 為零
- **THEN** 面板 MUST 顯示「已委託／未成交」，不得顯示「已買進」「已賣出」或「策略完成」

#### Scenario: IOC 部分成交
- **WHEN** IOC 只有部分成交且 remainder 取消
- **THEN** 面板 MUST 顯示成交量、取消量、剩餘目標／未受保護量與下一步，不得把原委託數量當作成交

### Requirement: 面板必須在接近下單面板 footprint 內保持可存取
智慧下單面板 MUST 採與目前 ticket metadata 相同的 default `w=5, h=11` 與 minimum `minW=4,minH=10` grid footprint；窄尺寸 MUST 使用「類型、條件、委託、確認」分段及「監控中、處理中、歷程」分頁。「處理中」MUST涵蓋草稿、已觸發、dispatching、unknown、recovery、manual intervention、cancel-pending與expired-with-obligation；只有broker side effect與本機義務皆terminal後才可進入歷程，UI不得用含糊的「已完成」把仍有working／unknown／obligation的策略誤報為完成。永久本機警示、必要欄位、canonical 摘要、錯誤與主要操作 MUST 不被裁切，並支援鍵盤、focus、screen reader label 與足夠對比。

#### Scenario: 最小核准 footprint
- **WHEN** 面板縮至核准最小尺寸
- **THEN** 使用者 MUST 能辨識本機狀態、完成草稿與確認、查看未受保護／manual intervention，主要操作不得被遮蔽
