# 七種智慧單官方語意決策表

## 版本與適用範圍

| 欄位 | 值 |
|---|---|
| schema | `realtimestock.smart-order-product-decision-table/v1` |
| version | `2026-08-11.2` |
| 查核時間 | 2026-08-11（Asia/Taipei） |
| 適用 change | `add-durable-smart-order-panel-and-protective-exits` |
| 產品邊界 | RealTimeStock 本機 simulation 輔助工具；不是大戶投券商雲端智慧單，也不作為實盤唯一保護 |
| 大戶投操作手冊快照 | PDF 建立／修改時間 2026-01-29 18:12:22 CST；SHA-256 `c4173f81e2a1ca72c0da687285b6243c11dc6142ca7ef3910ec5edb7c06df56b` |
| 規範來源 | 永豐金公開智慧單總覽、各類智慧單官方文章、現行大戶投操作手冊第 46–54、64 頁 |

本表只把官方公開資料能證實的產品核心，轉成 RealTimeStock 可驗收的輸入與拒絕規則。大戶投畫面存在某欄位，不等於 Shioaji 已提供相同欄位、單位、事件品質或券商雲端 API。凡本表標為 `disabled` 的分支，UI 與 Runtime 都必須拒絕建立或啟用，不能用預設值、猜測或另一類智慧單的規則補齊。

## 判定標記

| 標記 | 意義 |
|---|---|
| `official-confirmed` | 現行官方書面或操作手冊畫面可直接確認。 |
| `local-narrowing` | RealTimeStock 為 simulation／安全而採用的較窄規則，不冒充官方完整語意。 |
| `local-extension` | 使用者要求的本機客製功能，官方資料未宣稱為同一能力。 |
| `disabled` | 來源、欄位 mapping、算法或 simulation contract 尚未證實；不得送出 broker intent。 |

## 共用產品契約

| 決策面 | 官方可確認內容 | RealTimeStock v1 決策 | 狀態 |
|---|---|---|---|
| 執行位置 | 大戶投智慧單由券商雲端洗價，APP 可關閉。 | 本 change 只做 Mac 本機 Runtime；關機、睡眠、斷網、session 或 Runtime 中斷即不監控。 | `local-narrowing` |
| 商品單位 | 現行手冊列出台股整股與零股智慧單，各類畫面可選整／零股；Shioaji simulation公開頁只確認order API可用且不支援興櫃／零股。 | v1候選縮限為TSE／OTC、Cash、Common整股，但完整委託組合與Share↔CommonLot契約仍待task 0.6／0.7實際驗證；未通過前全部`disabled`。零股、融資券、當沖與未知類型不列入v1候選。 | `disabled` 至0.6／0.7 |
| 比較子 | 條件畫面提供 `>=`、`<=`。 | domain 只接受 enum comparator，不接受任意 expression。crossing／level 與 re-arm 是本地明確化。 | `official-confirmed`＋`local-narrowing` |
| 委託選項 | 手冊畫面可見限價、漲停、跌停、平盤、市價及 ROD／IOC／FOK 等選項。 | 只有 task 0.6 實際證明的 `LMT+ROD`、`LMT+IOC`、`MKT+IOC` 可供 automation；其餘維持 `disabled`，且不得縮限既有手動單。 | `disabled` 至 task 0.6 |
| 一般監控期 | 快速單最長一個月；長效、多條件、母單、停損停利、移動出場畫面可在 30 日內選結束日。 | 採 inclusive `Asia/Taipei` calendar-date span 1–30 日的保守上限，只在版本化日曆確認的交易 session 監控。官方畫面未公開完整 cutoff 算法，因此不宣稱與官方日數算法等價。 | `local-narrowing` |
| 當日例外 | 母子單的子單與定時定量僅當日有效。 | 不得跨日補送；已存在 working／unknown broker order 仍須對帳，不因策略到期被抹除。 | `official-confirmed`＋`local-narrowing` |
| 建立後修改 | 現行總覽 FAQ、2026-01-29 手冊與逐類文章寫只能刪除、不能修改；但 [2025-12-11 官方教學文章 Q5](https://www.sinotrade.com.tw/richclub/DawhotouAPP/--68f88b9ba741a30034784081) 寫可取消或修改，來源互相矛盾。 | 不替官方裁決；任一已確認建立的 non-draft strategy 交易 payload 一律不可原地修改。pause／resume 只控制本機執行，修改需求改為複製新草稿。 | `local-narrowing` |
| 條件成立時的 observation | 官方畫面沒有定義 out-of-order、試撮、stream gap 或啟用當下已成立。 | 只接受 task 0.5 證實的 fresh observation；`simtrade`、`intraday_odd`、stale／gap 依 spec fail closed。 | `local-narrowing` |

### 共用有效期 golden vectors

以下只驗收 RealTimeStock 採用的保守 inclusive `Asia/Taipei` calendar-date span，不宣稱是券商官方 cutoff 演算法。日期是否為可交易 session 仍須 task 0.8 的版本化日曆另行證明。

| ID | 輸入 | 預期 |
|---|---|---|
| `DATE-SPAN-01` | start=2026-08-11、end=2026-08-11 | span=1，日期上限可通過；仍須 session readiness。 |
| `DATE-SPAN-30` | start=2026-08-01、end=2026-08-30 | span=30，日期上限可通過；仍須 session readiness。 |
| `DATE-SPAN-31` | start=2026-08-01、end=2026-08-31 | `reject: monitoring_span_exceeds_local_limit`。 |
| `DATE-CALENDAR-UNKNOWN` | 日期落在臨時休市、緊急休市或日曆版本無法確認的範圍 | `disabled: trading_calendar_not_ready`；不得把未知日當交易日或自行順延。 |

## 九種行情條件的官方 UI 層

本節原先只完成「官方 UI 名稱／表面語意」層。2026-08-21已由task 0.5的[`quick-field-mapping.md`](./quick-field-mapping.md)與machine-readable `smart-order-quick-field-mapping/2026-08-21.1`完成實際Shioaji Tick／BidAsk欄位、精確單位、時間與品質mapping。這只關閉mapping缺口；策略condition evaluator仍須task 9.1，broker payload與共同Gate仍須各自完成，不會因此解鎖任何feature或write。

| local key | 官方 UI 名稱 | 官方畫面可確認的值域 | comparator | task 0.5 current mapping |
|---|---|---|---|---|
| `last_price` | 成交價 | 價格輸入 | `gte`／`lte` | `Tick.close`／`price_decimal`；fresh normal-lot only |
| `bid_price` | 買價 | 價格輸入 | `gte`／`lte` | `BidAsk.bid_price[0]`／`price_decimal`；empty side disabled |
| `ask_price` | 賣價 | 價格輸入 | `gte`／`lte` | `BidAsk.ask_price[0]`／`price_decimal`；empty side disabled |
| `up_amount` | 上漲 | 價差輸入 | `gte`／`lte` | `Tick.price_chg > 0`／`price_decimal`正magnitude |
| `down_amount` | 下跌 | 價差輸入 | `gte`／`lte` | `Tick.price_chg < 0`／`price_decimal` absolute magnitude |
| `up_percent` | 漲幅 | 百分比輸入 | `gte`／`lte` | `Tick.pct_chg > 0` integer bps exact除以100 |
| `down_percent` | 跌幅 | 百分比輸入 | `gte`／`lte` | `Tick.pct_chg < 0` integer bps absolute後exact除以100 |
| `tick_quantity` | 單量 | 數量輸入 | `gte`／`lte` | `Tick.volume`／normal-lot `CommonLot` |
| `total_quantity` | 總量 | 累計數量輸入 | `gte`／`lte` | `Tick.total_volume`／same-date nondecreasing `CommonLot` |

## 1. 快速單 `quick/v1`

### 欄位與流程

| 決策面 | 官方語意 | 本地 schema／政策 | 狀態 |
|---|---|---|---|
| 商品拓樸 | 觸發商品與委託商品必須相同，委託商品不可另改。 | `monitorContract === orderContract`；不相等直接拒絕。 | `official-confirmed` |
| 條件 | 九種 UI 條件擇一，可用 `>=` 或 `<=`。 | `condition.field`、`condition.comparator`、decimal threshold；mapping已完成，實際evaluator仍受task 9.1與共同Gate阻擋。 | `mapping-confirmed`／execution disabled |
| 監控期 | 可選開始／結束日，最長一個月。 | inclusive 1–30 calendar dates；日曆未知拒絕。 | `local-narrowing` |
| 觸發流程 | 條件符合即送出設定委託。 | deterministic single activation；預設 `require_rearm`，重複 observation 不重送。 | `local-narrowing` |
| 委託 | 買／賣、價別、張／股數與有效條件由畫面設定。 | 第一階段 Cash Common；payload 組合另受 0.6 gate。 | `disabled` 至 0.6 |

### Golden vectors

| ID | 輸入 | 預期 |
|---|---|---|
| `Q-TOPO-01` | monitor `2330.TSE`、order `2330.TSE` | 拓樸可通過；仍須行情欄位與委託 gate。 |
| `Q-TOPO-02` | monitor `2330.TSE`、order `2317.TSE` | `reject: quick_contract_mismatch`，任何 broker bytes 前停止。 |
| `Q-FIELD-01` | `last_price gte 100`且取得current／fresh normal-lot `Tick.close` | mapping可接受該observation；task 9.1與共同readiness未完成前仍不得建立activation或broker intent。 |
| `Q-EDGE-01` | eligible condition `false → true → true` | 只建立一個 activation；第二個 true 不重送。 |

## 2. 停損停利單 `stop_take/v1`

### 欄位與流程

| 決策面 | 官方語意 | 本地 schema／政策 | 狀態 |
|---|---|---|---|
| 商品拓樸 | 先從庫存選商品；觸發與委託依該庫存商品。 | 固定 account 的 reconciled Cash Common long position；monitor／order／position contract 必須相同。 | `local-narrowing` |
| 方向 | 官方畫面依現股、融資、融券帶入相應買賣方向。 | v1 只允許現股多單 Sell reduce-only 的本地驗證。 | `local-narrowing` |
| 停損／停利 | 畫面選擇停損或停利；監控價預設庫存成本，可調整。 | 價位、bps、fixed ATR 使用 canonical basis／tick formula。 | `official-confirmed`＋`local-extension` |
| 雙 leg | 手冊此頁未證實同一張官方智慧單同時有 stop＋take。 | 使用者要求的雙向保護是本機 `local-extension`；共享 ExitClaim／OCO remainder，不宣稱券商原子 OCO。 | `local-extension` |
| 監控期 | 30 日內可選結束日。 | inclusive 1–30 calendar dates。 | `local-narrowing` |
| 數量 | 預設帶入庫存整股數量，仍可選整／零股。 | 依最新 broker position、working sells、ExternalSellClaim 與 reservation 計算可用 Share；v1 只整股。 | `local-narrowing` |

### Golden vectors

| ID | 輸入 | 預期 |
|---|---|---|
| `ST-POS-01` | position 1,000 Share，無其他 sell claim，保護 1 CommonLot | 可建立一個 1,000 Share ExitClaim；仍須其餘 gates。 |
| `ST-POS-02` | position 1,000 Share，外部 working sell 已 claim 1,000 Share | `reject: no_unreserved_position`。 |
| `ST-OCO-01` | stop 與 take 同一 observation epoch 同時 eligible | 同一 DB transaction 只允許一個 winner；這是本地 OCO，不聲稱官方功能。 |
| `ST-DIR-01` | MarginTrading、ShortSelling、空單或零股 | `disabled: unsupported_automation_order_class`。 |

## 3. 長效單 `good_till/v1`

### 欄位與流程

| 決策面 | 官方語意 | 本地 schema／政策 | 狀態 |
|---|---|---|---|
| 商品拓樸 | 監控商品與委託商品可以不同。 | `monitorContract` MAY differ from `orderContract`；前者驗 subscription／condition，後者驗 fixed account／contract／risk。 | `official-confirmed` |
| 條件 | 一個監控商品使用九種 UI 條件之一，可用 `>=` 或 `<=`。 | `condition.field`、`condition.comparator`、decimal threshold；欄位、單位與基礎condition evaluator已由tasks 0.5／9.1完成；每日activation、目標餘量、terminal reconciliation與隔日重新監控已由tasks 9.4／9.5完成。 | `mapping-confirmed`／local execution complete；broker write disabled |
| 監控期 | 30 日內選起訖日。 | inclusive 1–30 calendar dates；只在可驗證 session 監控。 | `local-narrowing` |
| 觸發頻率 | 每個交易日若條件符合僅送一次委託，直到完成欲成交量或時間失效。 | 每策略每 trade date 最多一個 activation。 | `official-confirmed` |
| 進度 | 欲成交數量大於等於委託數量；依實際成交累計，實際成交可能超過欲成交量。 | 只累計 broker-confirmed deals；本地 intent 上限取 `min(perOrderMax, remainingTarget)`，避免本地已知可防的 overshoot。 | `official-confirmed`＋`local-narrowing` |
| 未成交 | 官方總覽表示未達目標隔日繼續監控。 | 未成交 IOC／未終結 ROD 不自動重送；先完成 terminal reconciliation，隔日重新等新條件。 | `local-narrowing` |

### Golden vectors

| ID | 輸入 | 預期 |
|---|---|---|
| `GT-TOPO-01` | monitor A、order B，兩者皆通過各自 gate | 拓樸可通過，不得強迫 A 等於 B。 |
| `GT-FILL-01` | target 3 lots、per-order max 2；第一日 broker-confirmed fill 2 | progress=2；次一交易日新 activation 最多 1 lot。 |
| `GT-ACK-01` | broker accepted 2 lots、fill 0 | progress=0，不得標示完成或扣除 target。 |
| `GT-DAY-01` | 同一交易日條件再次命中 | 不建立第二個 activation。 |

## 4. 多條件單 `multi_condition/v1`

### 欄位與流程

| 決策面 | 官方語意 | 本地 schema／政策 | 狀態 |
|---|---|---|---|
| 監控商品 | 最多七組，每組可各自設定整／零股與觸發條件。 | 1–7 個 `ConditionLeg`；每個 leg 有獨立 canonical contract。 | `official-confirmed` |
| 委託商品 | 監控商品與委託商品可不同，整／零股也可不同。 | `orderContract` MAY differ from every monitor contract；v1 所有商品仍只接受 Cash Common whole-lot。 | `official-confirmed`＋`local-narrowing` |
| 布林拓樸 | 可選同時符合或任一符合。 | `AND`／`OR` enum；AND 3 秒 coherence、OR fresh edge、deterministic activation 是本地安全政策。 | `official-confirmed`＋`local-narrowing` |
| 條件欄位 | 每組使用九種 UI 條件之一與 `>=`／`<=`。 | 每列mapping已由task 0.5完成；task 9.5尚未完成前整個strategy仍disabled。 | `mapping-confirmed`／execution disabled |
| 監控期 | 30 日內可設定結束日。 | inclusive 1–30 calendar dates。 | `local-narrowing` |

### Golden vectors

| ID | 輸入 | 預期 |
|---|---|---|
| `MC-TOPO-01` | conditions=[A,B,C]、order=D | 官方拓樸允許；Runtime 必須分別驗證 A/B/C quote 與 D order/risk。 |
| `MC-LIMIT-01` | 8 個 conditions | `reject: too_many_conditions`。 |
| `MC-AND-01` | A true at t=0、B true at t=4s | `not_triggered: coherence_expired`。 |
| `MC-MAP-01` | 任一 leg 的mapping revision、subscription lineage或freshness不current | `disabled: quote_mapping_unverified`。 |

## 5. 母子單 `parent_child/v1`

### 欄位與流程

| 決策面 | 官方語意 | 本地 schema／政策 | 狀態 |
|---|---|---|---|
| 每 leg 商品 | 母、子可為不同商品；母 leg 內監控＝委託，子 leg 內監控＝委託。 | `parent.monitor === parent.order`、`child.monitor === child.order`；parent MAY differ from child。 | `official-confirmed` |
| 母單條件 | 母 leg 使用九種 UI 條件之一，可用 `>=` 或 `<=`。 | `parent.condition`依共用九欄位表；mapping已完成，母leg evaluator仍待task 9.7。 | `mapping-confirmed`／execution disabled |
| 子單條件 | 母單全成後，子 leg 使用九種 UI 條件之一，可用 `>=` 或 `<=`。 | `child.condition`依共用九欄位表；mapping已完成，子leg evaluator仍待task 9.7。 | `mapping-confirmed`／execution disabled |
| 母單期限 | 母單畫面可在 30 日內選結束日。 | 母單 inclusive 1–30 calendar dates。 | `local-narrowing` |
| 啟動條件 | 母單完全成交後才啟動子單。 | 只以去重後 broker-confirmed deal total 等於 parent quantity 啟動一次；accepted／partial 不算。 | `official-confirmed` |
| 子單期限 | 子單不獨立監控；若當日未觸發，或已送委託但 13:30 前未成交，隔日失效。 | 子單只在母單全成的 trade date 有監控／再送資格；13:30 之後先依 broker policy 對帳，不能把「失效」猜成任意 cancel。 | `official-confirmed`＋`local-narrowing` |
| 母單被改動 | 官方手冊警示自行更改母單委託會使子單失效。 | 本地 non-draft strategy payload immutable；若外部改動 parent broker order，strategy 進 `manual_intervention`，不得照舊啟動 child。 | `official-confirmed`＋`local-narrowing` |
| v1 方向 | 官方支援的方向組合較廣。 | 第一階段只做同一 fixed account Cash Common Buy parent＋Sell child；child 另驗自身商品可用現股，不由 parent 數量跨商品推導。 | `local-narrowing` |

### Golden vectors

| ID | 輸入 | 預期 |
|---|---|---|
| `PC-TOPO-01` | parent A/A、child B/B | 拓樸可通過；A 可不等於 B。 |
| `PC-TOPO-02` | parent monitor A、parent order B | `reject: parent_leg_contract_mismatch`。 |
| `PC-FILL-01` | parent quantity 2、confirmed fills 1 | child 保持 dormant。 |
| `PC-FILL-02` | parent quantity 2、confirmed fills 2，重複 deal event | child activation 只建立一次。 |
| `PC-CLOSE-01` | child 當日 13:30 仍 working／unknown | 不跨日再送；先對帳，狀態不明進 `manual_intervention`。 |

## 6. 移動出場單 `trailing_exit/v1`

### 欄位與流程

| 決策面 | 官方語意 | 本地 schema／政策 | 狀態 |
|---|---|---|---|
| 商品拓樸 | 從庫存商品帶入，依庫存方向產生相反方向委託。 | v1 只允許 reconciled Cash Common long position 的 Sell exit；position／monitor／order contract 相同。 | `local-narrowing` |
| 部位成本 | 庫存部位有成本資訊，固定停損可用來和成本／其他已確認基準比較。 | 另存 `positionCost` 與來源 revision；不得把它與啟動價混為同一欄位。 | `local-narrowing` |
| 啟動價 | 官方畫面預設帶入現價，可手動調整；價格到達此值後才開始追蹤。 | 保存明確 `activationPrice` 與 confirmation hash；不可隨重啟或新報價漂移。 | `official-confirmed`＋`local-narrowing` |
| 啟動與追蹤 | 價格到達啟動價後開始監控有利最高價；由最高價回檔指定價差或百分比即送委託。 | 持久化 eligible high-water mark；fixed distance／integer bps 使用 canonical tick rounding。 | `official-confirmed`＋`local-narrowing` |
| 固定停損 | 可另設定停損價；多單固定停損必須低於啟動價，若另以成本作為產品限制也須明示驗證。 | v1 驗證 `fixedStopPrice < activationPrice`；觸價產生同一 ExitClaim lineage 的唯一 winner。 | `official-confirmed`＋`local-narrowing` |
| 監控期 | 30 日內可選結束日。 | inclusive 1–30 calendar dates。 | `local-narrowing` |
| gap | 官方資料未定義本機 sleep／斷線後如何重建最高價。 | 任何交易時段 observation gap 一律 `manual_intervention`；historical ticks 不解鎖。 | `local-narrowing` |

### Golden vectors

| ID | 輸入 | 預期 |
|---|---|---|
| `TR-ABS-01` | positionCost=100、activationPrice=105、high=110、retrace=5 | last <=105 時 eligible；high 與回撤門檻持久化。 |
| `TR-PCT-01` | high=110、retrace=500 bps | 理論回撤價 104.5，再依多單保護方向向上取合法 tick。 |
| `TR-STOP-01` | positionCost=100、activationPrice=105、fixedStopPrice=105 | `reject: stop_not_below_activation_price`。 |
| `TR-GAP-01` | high=110 後 Mac sleep，期間行情不可完整證明 | `manual_intervention: trailing_observation_gap`，不得以醒來第一筆 quote 重算。 |

## 7. 定時定量單 `scheduled_quantity/v1`

官方可確認「單一商品、僅當日、定時或定量」與下列 UI 流程，但公開手冊沒有定義足以安全重建的精確 slot／split／尾數／收盤算法。因此兩個 mode 在本版本都必須維持 `disabled`；此判定本身就是 Gate 0 的 fail-closed 結果。

### Mode decision table

| 決策面 | `timed` 官方畫面 | `quantity` 官方畫面 | 缺口與 v1 決策 |
|---|---|---|---|
| 共用欄位 | 單一商品、整／零股、買賣、價別／有效條件、欲成交數量 | 同左 | v1 只可能接受 Cash Common；委託組合仍待 0.6。 |
| 時間輸入 | 開始時間、結束時間、出單間隔 | 開始時間、出單間隔 | 秒／分精度、端點 inclusivity、session clamp 未明，兩者 `disabled`。 |
| 數量輸入 | 以欲成交總量與時間窗計算每筆張數 | 設定每次送單張數；每筆數量與間隔相同 | timed 的 split／rounding 未明；quantity 的總量非整除尾數未明。 |
| slots | 「試算」列出送單時間與數量 | 「試算」列出送單時間與數量 | 試算公式、最後 slot、同 timestamp 排序未公開，`disabled`。 |
| 前單 working | 手冊未說明 | 手冊未說明 | 本地政策為前單 working／unknown 時下一 slot skipped，不 catch up；不冒充官方。 |
| missed／離線 | 手冊未說明 | 手冊未說明 | 本地政策為 missed 不補送、不 burst。 |
| 尾數 | 手冊未說明 | 手冊未說明 | 不猜測；有 remainder 的設定拒絕。 |
| 提早收盤／臨時休市 | 手冊未說明 | 手冊未說明 | official calendar 判為盤外的 slot 到期；不得移至盤外或隔日。 |
| 收盤 remainder | 手冊未說明 | 手冊未說明 | 不自動市價補齊、不跨日；因完整算法未證實，mode 整體 `disabled`。 |

### Golden rejection vectors

| ID | 輸入 | 預期 |
|---|---|---|
| `SQ-TIMED-01` | target=10 lots、09:00–13:30、interval=30m | `disabled: timed_split_algorithm_unverified`；不得自行平均或把尾數塞入最後一筆。 |
| `SQ-QUANTITY-01` | target=5 lots、each=2 lots、start=09:00、interval=30m | `disabled: quantity_remainder_algorithm_unverified`。 |
| `SQ-CLOSE-01` | 任一 mode 的最後 slot 落在提早收盤後 | `disabled: mode_algorithm_unverified`；尚未解鎖前不得產生 slot 或 broker intent。 |
| `SQ-WORKING-01` | 下一 slot 到達，前單仍 working／unknown | `disabled: mode_algorithm_unverified`；尚未解鎖前不得產生 slot 或 broker intent。 |

### 未來若另案解鎖時的最低本地安全政策

下列政策不是現行可執行結果，也不是券商官方語意；只有精確 mode 演算法另有來源、decision table、golden vectors 與 simulation 驗收後，才能成為候選實作：盤外或提早收盤後的 slot 必須到期、不移至隔日；前一筆仍 working／unknown 時跳過下一 slot，不並發、不 catch up；離線 missed slot 不補送、不 burst；收盤 remainder 不自動市價補齊。

## Feature gate 結論

| 類型 | product topology | condition／formula | broker payload | 本表完成後的 write 狀態 |
|---|---|---|---|---|
| 快速單 | 已確認同商品 | 九欄位mapping已完成；evaluator待9.1 | 待 0.6 | `disabled` |
| 停損停利單 | 已確認庫存同商品；雙 leg 為本地 extension | canonical formula 待 domain 實作 | 待 0.6／reservation | `disabled` |
| 長效單 | 已確認可看 A 下 B | 九欄位mapping、基礎evaluator、每日一次、目標餘量、terminal reconciliation與隔日監控已完成 | Node-safe payload已實作；仍待Gate 0.3b／write master | `disabled` |
| 多條件單 | 已確認最多七個監控商品且可看 A 下 B | 九欄位mapping已完成；evaluator待9.5 | 待 0.6 | `disabled` |
| 母子單 | 已確認每 leg 同商品、兩 leg可不同 | 九欄位mapping已完成；母／子evaluator待9.7 | 待 0.6／correlation | `disabled` |
| 移動出場單 | 已確認庫存同商品 | 固定價差／百分比核心已確認；ATR 為本地 extension | 待 0.6／gap／reservation | `disabled` |
| 定時定量單 | 已確認單一商品 | 精確 mode 算法未證實 | 待 0.6 | `disabled`（整個 mode） |

完成本表不等於解鎖送單。只有相應 task、fault tests、simulation gate 與 machine-readable private manifest 全部通過，Runtime 才能讓特定類型／欄位／order class 由 `disabled` 轉成可用；browser、環境變數或單一 feature flag 都不能改寫這項結論。
