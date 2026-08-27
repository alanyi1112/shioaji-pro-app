# protective-exit-order-ticket Specification

## Purpose
TBD - created by archiving change add-durable-smart-order-panel-and-protective-exits. Update Purpose after archive.
## Requirements
### Requirement: 下單面板價別必須使用中文名稱且保留 canonical code
下單面板 MUST 將 `LMT` 顯示為「限價單」、`MKT` 顯示為「市價單」；既有商品若實際支援 `MKP`，MAY 顯示「範圍市價」，但不得因此宣稱新保護 Runtime 支援 `MKP`。送給 API 的 canonical code MUST 與顯示文字分離。

#### Scenario: 選擇限價單
- **WHEN** 使用者在價別選擇「限價單」
- **THEN** UI MUST 顯示中文名稱，canonical confirmation 與 API payload MUST 使用 `LMT`

#### Scenario: 顯示範圍市價
- **WHEN** 既有 ticket 商品可顯示 `MKP`，但保護 Runtime 的委託矩陣尚未核准
- **THEN** 「範圍市價」MUST 在自動保護設定中 disabled，不得因顯示支援而可送出

### Requirement: 自動保護第一階段只支援現股多單整股
新保護出場 MUST 只允許 TSE／OTC、`STK`、`Cash`、`Common` 的股票與 ETF 現股多單 simulation；零股、權證、興櫃／特殊板、融資融券、當沖先賣、借券、空頭、期貨、選擇權、複委託與 contract 不完整 MUST 明確禁用。中文價別標籤 MAY 套用既有其他 ticket，但不得擴張自動保護範圍。

#### Scenario: 在融資或空單票券啟用保護
- **WHEN** selected order／position 不是可驗證的 Cash Common 現股多單
- **THEN** UI 與 Runtime MUST 拒絕自動保護並顯示不支援原因，不得套用多單公式猜測

### Requirement: 含保護的新單必須先保存完整計畫才可送進場
勾選保護出場時，Runtime MUST先以同一transaction保存固定帳號、canonical contract、base-share entry intent、保護公式、觸發／委託政策、confirmation hash、risk revision與`PendingProtectionCommitment`／`ProtectionObligation`，再由Runtime送出entry。只要canonical RiskPolicy／PnlPolicy存在可預留的quantity、notional、cash、position或order-count上限，就 MUST在同一transaction建立worst-case `EntryExposureReservation`；它不得扣既有position，且只有policy明示無任何可預留維度時才可省略。未成交時obligation的`filledShares`／`protectedShares`與真正exit claim MUST為0；只有broker confirmed fill與position reconciliation後，才可在transaction中把相應shares建立為`ExitClaim.monitoring_reserved`。前端 MUST NOT先直送entry；Runtime unavailable、DB不可寫或readiness不完整時 MUST阻擋整筆。

#### Scenario: 同一 transaction 保存保護計畫與 entry intent
- **WHEN** 固定帳號、canonical contract、entry payload、保護計畫、quantity／unit、confirmation、reservation與全部Gate／readiness均有效
- **THEN** Runtime MUST在同一durable transaction原子保存canonical entry intent、完整保護計畫、`ProtectionObligation`與適用的`EntryExposureReservation`；該transaction成功commit前broker write必須為零，commit後仍須通過dispatch gates才可交給broker adapter

#### Scenario: Runtime 無法保存保護計畫
- **WHEN** 使用者確認含保護新單，但 sidecar、DB、mode、risk、account、contract 或 quote readiness 不通過
- **THEN** entry MUST NOT 呼叫 broker，UI MUST 顯示「尚未送出／尚未受保護」與具體原因

#### Scenario: 保存後在 broker 回應前當機
- **WHEN** entry intent 與 protection plan 已 commit，broker 可能已受理，但 Runtime 在取得回應前當機
- **THEN** recovery MUST 先對帳 entry，無法唯一確認時進 `manual_intervention`，不得重送 entry 或假稱保護已生效

#### Scenario: entry 最終零成交
- **WHEN** entry 被取消、失敗或 IOC 終結且 broker confirmed deal quantity 為 0
- **THEN** ProtectionObligation MUST以zero-fill terminal reason結束，EntryExposureReservation MUST釋放、ExitClaim MUST保持0，且不得建立任何exit leg

### Requirement: confirmation 必須綁定精確 entry 與保護 payload
含保護下單的確認頁 MUST 顯示遮罩帳號、simulation、本機監控限制、商品、買賣別、`Cash/Common`、base shares／CommonLots、entry 價別／效期、每個 trigger、broker execution policy、ATR snapshot、估算價與風險。任一欄位或 mode／risk revision 變更 MUST 使確認失效。

#### Scenario: 確認後修改數量
- **WHEN** 使用者已確認後變更 entry 數量、價別、停損、停利、ATR 或移動出場
- **THEN** 原 confirmation hash MUST 失效，重新確認前不得建立 intent

### Requirement: 停損停利必須支援價位百分比與 ATR
停損與停利 MUST 各自支援「價位」、「百分比」與「ATR」；百分比 MUST保存為整數basis points `pctBps`，第一階段範圍為1至9999；ATR倍數 MUST為有限正數且不超過versioned policy上限。多單canonical理論價 MUST為：百分比停損=`basis × (10000-pctBps) / 10000`、百分比停利=`basis × (10000+pctBps) / 10000`、ATR停損=`basis-k×fixedATR`、ATR停利=`basis+k×fixedATR`。停損／trailing trigger向上取合法tick，停利／activation trigger向下取合法tick；理論stop／trailing價必須大於0，overflow、underflow、非有限值或超出contract限制 MUST阻擋。UI MUST 同時顯示輸入單位、理論價、合法 tick 換算價、估算／成交基準與 trigger comparator。

#### Scenario: 以百分比設定多單停損
- **WHEN** 使用者輸入停損 3%
- **THEN** UI MUST 以目前估算基準顯示理論價與合法 trigger 價，正式保護 MUST 在實際成交後依已保存公式與成交均價重算

#### Scenario: 輸入 NaN、Infinity 或非正數
- **WHEN** 百分比、ATR 倍數或價位不是有限有效值
- **THEN** UI 與 Runtime MUST 拒絕，不得以零、字串 coercion 或 fallback 送出

#### Scenario: canonical 百分比與 ATR golden vector
- **WHEN** 多單basis為100、百分比為3%、fixed ATR為2且倍數為2
- **THEN** 百分比stop／take理論價 MUST分別為97／103，ATR stop／take理論價 MUST分別為96／104，再依canonical contract套用方向性tick，不得使用binary floating-point近似改變結果

### Requirement: ATR 必須使用版本化固定快照
ATR 預設 MUST 使用確認時最近一根已完成日 K 的 Wilder ATR(14)，並保存 timeframe、period、algorithm version、decimal value、`asOfTradingDate`、資料來源與完整性識別。當日未完成 K 不得納入；部分成交與 Runtime 重啟 MUST NOT 重新抓取新的 ATR 值。

#### Scenario: 盤中建立 ATR 保護
- **WHEN** 台股盤中使用者採預設 ATR
- **THEN** 系統 MUST 使用截至上一個已完成交易日的日 K 計算並凍結 ATR(14)

#### Scenario: ATR 資料不足或 revision 不一致
- **WHEN** 已完成 K 棒不足、來源日期不明、除權息造成不可比或資料完整性驗證失敗
- **THEN** 系統 MUST 禁止啟用 ATR 保護並要求新確認，不得改用當日未完成 K、零值或其他週期

### Requirement: 價格換算必須使用 canonical contract 與方向性 tick arithmetic
所有理論價 MUST 以 decimal／整數 tick 運算並使用未過期 canonical contract 的股票或 ETF tick table。多單停損 trigger 理論價落在兩檔間 MUST 向上取合法 tick；多單停利 trigger MUST 向下取合法 tick。trigger 價與實際 sell order 價 MUST 分開換算、驗證漲跌停並在確認頁分別顯示。

#### Scenario: ETF 停損落在非法檔位
- **WHEN** ETF 停損理論價不是合法 tick
- **THEN** 系統 MUST 依 ETF contract 向上取合法 trigger tick，不得使用股票表或代碼前綴猜分類

#### Scenario: 價格跨越 tick 級距
- **WHEN** 推導價位落在 10、50、100、500 或 1000 等級距邊界
- **THEN** 系統 MUST 依 canonical table 產生合法 decimal 價並通過 round-trip 測試，不得用一般四捨五入

#### Scenario: 委託價超過漲跌停
- **WHEN** 使用者指定或推導的 broker LMT 價超出 contract limit up/down
- **THEN** Runtime MUST 阻擋並要求重新確認，不得只因 trigger 價合法就送出

### Requirement: 觸發條件與 broker 委託政策必須分離
每個保護 leg MUST 分別保存 trigger field、comparator、trigger price，以及 broker `price_type`、`order_type`、limit price 與效期。第一階段 fixed stop、take 與 trailing extreme MUST 只使用非試撮、非零股、同交易日且新鮮的整股最新成交價；買價、賣價或 snapshot 不得代替。第一階段只可使用 simulation contract gate 核准的 `LMT+ROD`、`LMT+IOC`、`MKT+IOC`；不支援 FOK、隱藏映射、MKP、自動追價或未確認重試。

#### Scenario: 停損條件命中
- **WHEN** fresh eligible quote 命中停損 trigger
- **THEN** UI MUST 先標示「已觸發／準備送出」，Runtime MUST 依保存的 broker policy 建立 intent，不得把 trigger price 自動當成未揭露的委託價

#### Scenario: 只有 BidAsk 更新
- **WHEN** 買賣價跨過 trigger，但尚未出現符合條件的新鮮整股成交價
- **THEN** fixed stop、take 與 trailing MUST NOT 因 BidAsk 單獨命中，UI MUST 顯示最後 eligible 成交時間

#### Scenario: MKT IOC 未成交
- **WHEN** broker 接受 `MKT+IOC` 但成交量為零或只有部分
- **THEN** 系統 MUST 顯示「未成交／部分成交／剩餘未受保護」，不得標示已出場或無界重送

### Requirement: 正式保護數量與基準必須使用累計實際成交
entry 前預覽 MUST 標示估算；Runtime MUST 只對 broker 已確認的累計實際成交量建立 reservation，並以加權成交均價依已保存公式更新正式 trigger。保護量 MUST NOT 超過已成交、尚未平倉且未被其他 working order／策略保留的可用量。

#### Scenario: entry 發生滑價
- **WHEN** 實際加權成交均價不同於預覽基準
- **THEN** Runtime MUST 以實際均價重算正式 trigger，保留原 ATR snapshot，並顯示預覽與正式值差異

#### Scenario: entry 部分成交
- **WHEN** entry 只成交部分 CommonLots
- **THEN** Runtime MUST 在同一 transaction 更新 obligation 的累計 fill並只 reservation 已確認成交與 position reconciliation一致的 base shares，後續成交再更新 remainder，不得一次保護完整委託量

### Requirement: 既有部位的百分比與 ATR 基準必須明確且可驗證
對既有現股多單建立停損停利或移動出場時，百分比／ATR預設基準 MUST是固定帳號broker-confirmed average cost，並保存來源、as-of、position quantity與corporate-action／contract revision。系統 MAY允許使用者輸入自訂基準價，但 MUST明確標示為「使用者指定」、驗證合法tick並納入confirmation；不得默默以目前市價、昨收或UI快取代替。average cost缺失／過期、除權息使資料不可比或position reconciliation不一致時，百分比／ATR設定 MUST disabled；固定絕對價位仍須獨立通過contract與position檢查。

#### Scenario: 既有部位缺少可驗證 average cost
- **WHEN** 使用者選擇百分比或ATR，但固定帳號position沒有新鮮且可驗證的average cost
- **THEN** Runtime MUST阻擋該模式並要求使用者修復資料或明確輸入自訂基準後重新確認，不得用目前成交價fallback

### Requirement: 保護命中時尚有 entry 餘量必須先處理競態
若保護trigger命中時entry仍為working／part-filled，Runtime MUST阻擋新的entry activation。只有`pause_automation`／`emergency_block_all_writes`未禁止時，Runtime才可建立取消剩餘entry的明確intent並bounded reconciliation；kill switch禁止自動cancel時 MUST立即轉`manual_intervention`並提示券商人工處置。取消結果或最終成交量未確認前，Runtime MUST NOT依猜測數量送出exit。

#### Scenario: 停損命中且 entry 尚有未成交量
- **WHEN** 已成交部位碰到停損，但 entry 仍可能繼續成交
- **THEN** Runtime MUST 先取消／對帳 entry，依最終可驗證成交與可用部位建立 exit；逾時或未知時進 `manual_intervention` 並高優先通知

### Requirement: 移動出場必須保存啟動門檻與有利極值
移動出場 MUST 可設定啟動門檻、啟動後回撤距離及選用固定停損；啟動門檻與回撤距離 MUST 各自支援價差、整數`pctBps`或固定 ATR snapshot。多單activation理論價為basis加上absolute distance、`basis × (10000+pctBps)/10000`或`basis+k×fixedATR`；啟動後最高價為`max(savedHigh, eligibleLast)`，回撤trigger分別為`savedHigh-absoluteDistance`、`savedHigh×(10000-pctBps)/10000`或`savedHigh-k×fixedATR`。activation向下、回撤trigger向上取合法tick；距離、極值與結果必須有限且回撤價大於0。Runtime MUST 持久化啟動 observation、有利最高價、stream epoch、回撤 trigger 與每次有效更新。

#### Scenario: 多單啟動後創高再回撤
- **WHEN** fresh eligible quote 達啟動門檻、之後創新高，再回撤至合法 trigger
- **THEN** Runtime MUST 只依保存的最高價與回撤規則啟動一次 exit，並 journal 啟動價、極值與 trigger

#### Scenario: gap 期間極值不可重建
- **WHEN** sleep／斷線期間可能創高，但完整合格 ticks 無法取得
- **THEN** 策略 MUST 停在 `manual_intervention`，不得以重連第一筆行情重設極值或送單

#### Scenario: 啟動前先碰固定停損
- **WHEN** 移動出場尚未啟動，但同組固定停損先命中
- **THEN** Runtime MUST 依 OCO remainder 規則處理固定停損，移動 leg 不得另送

#### Scenario: 移動出場百分比 golden vector
- **WHEN** 已啟動多單的saved high為110且回撤為5%
- **THEN** canonical理論回撤trigger MUST為104.5，再向上取該contract合法tick；不得以entry basis重新計算

### Requirement: 同組保護必須以 reservation 與 OCO remainder 防止重複出場
停損、停利與移動出場同組legs MUST共用protected remainder、單一active-dispatch slot與每份shares唯一的`ExitClaim` lineage。建立保護時claim為`monitoring_reserved`；一個或多個leg同時eligible時，Runtime MUST在同一DB transaction以protection-group＋remainder-generation的CAS／unique constraint選出唯一winner，將同一claim轉為`intent_reserved`、保存intent並抑制所有sibling；broker確認working後只把同一claim轉為`broker_working`，不得另建或重複計數`PositionExitReservation`。loser MUST在任何broker call前停止。部分成交只消耗claim並減少remainder；unknown claim阻擋全部sibling。只有working order terminal且reconciliation明確、claim已consumed／released或以新remainder更新後，其他sibling才可用新remainder generation重新競爭。

#### Scenario: 同一筆 observation 同時命中停損與停利
- **WHEN** stale/reordered資料或邊界設定使兩個sibling在同一evaluation cycle同時eligible
- **THEN** 同一transaction只能commit一個winner intent；另一個 MUST在broker call前標為suppressed，任何排程競態都不得建立第二筆exit

#### Scenario: OCO winner commit 後當機
- **WHEN** 唯一winner已commit但尚未證明dispatch，Runtime立即當機
- **THEN** 復原後sibling MUST維持suppressed；完成reconciliation與使用者re-arm後只能送原winner一次。若winner可能已dispatch則只可對帳，不得送winner或sibling第二次

#### Scenario: 停利部分成交
- **WHEN** 停利 leg 只成交部分數量
- **THEN** Runtime MUST 保留剩餘部位與 reservation，其他 sibling 在該 working order 未 terminal 前 MUST 保持抑制

#### Scenario: cancel 與 fill 同時到達
- **WHEN** 取消回報與成交回報競態
- **THEN** Runtime MUST 以 broker 最終成交／取消數量重新計算 remainder，未確認前不得啟用第二個 leg

#### Scenario: 第一個 leg 結果未知
- **WHEN** 已送出的保護 leg 無法確認是否被 broker 接受
- **THEN** 同組所有 sibling MUST 暫停並進 reconciliation／人工處理，不得再送另一個 exit

#### Scenario: claim representation 不得重複計數
- **WHEN** 1000 Share protection從monitoring reservation依序成為winner intent與broker working order
- **THEN** protected／actively covered總量 MUST始終只由同一ExitClaim lineage計1000 Share，不得把三個state各加1000 Share

### Requirement: 外部部位變動不得導致超賣
Runtime MUST在Gate 0先證明能完整看見固定帳號於Runtime啟動前由外部client建立的working sells，並在建立保護、trigger前、intent prepared、order/deal/cancel後及recovery時重查position與working sells；能力未證實時該帳號自動保護 disabled。外部／手動變動造成可用量下降時 MUST縮減尚未觸發reservation或停止策略；存在working／unknown競態時 MUST轉人工。此檢查只保證RealTimeStock依最後broker證據不主動超額，不能消除外部client在檢查後競爭的TOCTOU。

#### Scenario: 使用者在券商 App 手動賣出
- **WHEN** 外部成交使可用現股少於 protected remainder
- **THEN** Runtime MUST 依 broker 證據縮減未觸發保護或進 `manual_intervention`，任何自動 exit 都不得超過可用量或建立空頭

### Requirement: UI 必須區分保護生命週期與未受保護數量
UI MUST分開顯示「計畫已保存」、「等待entry成交」、「監控中」、「已觸發」、「準備送出」、「broker已接受」、「部分成交」、「全部成交」、「未成交」、「取消中」、「結果未知」、「未受保護」與「人工處理」。Runtime未接受、entry未成交或broker未全部成交時 MUST NOT顯示「已保護／已出場」。confirmation與離線畫面 MUST高可見度揭露「Runtime／LaunchAgent重啟後不會自動恢復送出，完成對帳後仍需手動re-arm」。

#### Scenario: broker 回傳 PendingSubmit
- **WHEN** place response 只有 `PendingSubmit`
- **THEN** UI MUST 顯示送出中並等待 event／update_status，不能顯示 broker 已正式接受或已成交

#### Scenario: 保護 Runtime 離線
- **WHEN** 仍有 position 或 strategy obligation，但 Runtime heartbeat 逾時
- **THEN** UI MUST 高可見度顯示未能確認監控、最後已知未受保護數量與as-of時間，並把目前未受保護數量標為「未知」及顯示券商官方人工處置提示；不得把last-known數字冒充即時精確值

### Requirement: 保護設定在最小 footprint 必須可讀可操作
下單面板 MUST 維持目前 ticket default `w=5,h=11` 與 minimum `minW=4,minH=10`，以「固定保護／移動出場」分段並縮小「停損價」「停利價」等輔助文字但不降低可讀性。內容超過可用高度時，設定區 MUST 可捲動且主要下單操作維持可見；必要欄位、單位、換算、估算／正式、驗證、永久本機警示與主要操作 MUST 不被裁切，且支援鍵盤、focus、screen reader label 與可辨識對比。

#### Scenario: 預設最小下單面板
- **WHEN** 面板使用核准的最小 footprint
- **THEN** 使用者 MUST 能完成價位／百分比／ATR／移動出場設定、閱讀確認與錯誤，主要按鈕不得被遮蔽
