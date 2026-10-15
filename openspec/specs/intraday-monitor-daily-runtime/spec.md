# intraday-monitor-daily-runtime Specification

## Purpose

規範日常盤中量比執行器、獨立盤後分鐘量基準、保守額度續轉、盤中門檻安全切換及收盤尾筆例外補算，維持來源可追溯、單一 ownership 與零擴張交易權限。

## Requirements

### Requirement: 日常收盤尾筆例外必須有界並以驗證盤後資料補算

從2026-10-15適用的版本化政策MUST允許固定160檔中至多10檔僅缺canonical 13:30，作為日常運作例外；全部商品09:01–13:29 MUST為269個連續、同session／generation／商品／日期／單位的真實live observation，其餘商品MUST完整270分鐘。提早收尾、盤中缺漏、缺兩分鐘、來源gap／malformed／斷線／資源／比較故障或身分未知MUST拒絕，不得廣域取消原安全Gate。

原盤後來源日160份v2 MUST真正完整發布，逐檔驗schema／hash／官方來源日與下一交易日及cohort；缺檔的13:29累積量MUST與原live相同。補算MUST使用同商品前一官方交易日之合法同分鐘v2基準及原session不可變threshold journal對應收尾時真正生效版本，個別覆寫優先，以整數公式計算13:30量比；分母零MUST明列不可比較。MUST NOT新增下載、登入、SSE、訂閱、通知或下單，亦不得寫入live observation／trigger。

通過MUST另存不可變產品判定`passed_with_close_tail_exception`與完整逐檔盤後補算證據；原live partial、原收據及過往failed不改判，liveAcceptance／notificationAuthority／brokerWriteAuthority MUST為false。同鍵相同證據MUST no-op，來源變更MUST拒絕覆寫；未完成或損壞資料不得顯示通過。新政策不能宣稱上游漏送根因已修復。

#### Scenario: 三檔僅缺收盤尾筆且盤後核實完成

- **WHEN** 157檔真實live完整、3檔各269分鐘至13:29，原收尾安全且盤後160份及銜接／前日基準／有效門檻證據全部成立
- **THEN** 日常運作MUST可標示收盤尾筆例外通過並列三筆盤後補算；原live覆蓋仍157／160、原13:40失敗收據保持，補算不通知

#### Scenario: 少數缺兩筆或盤後來源尚未完整

- **WHEN** 缺檔至13:28、母體超過10檔、任何盤中缺口或來源安全故障，或尚無完整160份盤後來源
- **THEN** 前述不合政策情形MUST拒絕例外；來源尚未完整MUST等待，不得用0、13:29或其他交易日資料冒充13:30

#### Scenario: 盤後設定已變更或補算重入

- **WHEN** 使用者盤後另改全域門檻，或相同證據再次要求補算
- **THEN** MUST仍使用原session收尾時durable比較版本及個別覆寫；相同證據no-op，不覆寫原結果或補發通知，journal不合法時拒絕

### Requirement: 採集中斷補件必須保留原件與同週期保守計帳

操作者明確授權後，系統 MUST 在原owner已退出、重開機時間晚於原claim且未存在完成receipt時，使用獨立operator claim／receipt補齊相同官方來源日與下一交易日的固定母體。系統 MUST 保留原manifest、claim及failed／partial，不得把人工補件標成scheduled成功。已合法驗證的manifest MUST 重用且原hash不變；本次請求數、原期限、原冷卻、中央admission與既有速率／保護池 MUST 保持有界。

同日generation改變且來源計數下降 MUST NOT 授權quota重置。操作者專用補件 MAY 以不可變carry保存原high-water，加上新generation的raw usage作保守使用量，並分列raw與保守值；相同scope、帳戶HMAC、上限、原quota identity及charged／quarantined保留 MUST 成立。再次generation改變、帳戶不同、計數退回、預算不足或日曆／來源衝突 MUST 拒絕，不得刪除舊帳或捏造額度。

#### Scenario: 重開機後97份合法基準已存在

- **WHEN** 固定160檔採集中斷且操作者授權補剩餘63檔，原owner已退出，日曆與原期限合法
- **THEN** MUST 只下載缺件並逐檔驗證，保存獨立operator收據及原97份不變證據
- **AND** 成功 MUST 只標翌日基準可用，不追認原生中斷或當日live完整

#### Scenario: 同日計數下降但charged仍在

- **WHEN** 重開機後raw usage低於原帳本high-water
- **THEN** MUST 拒絕直接以低計數放行；僅經操作者有界補件可採保留舊帳的同週期保守carry，不能提高來源上限或縮小保護池

### Requirement: 盤中量比門檻必須原子切換而不中斷行情留存

daily MUST 支援1.5、2、3倍及原合法decimal門檻於盤中立即切換。不可變session的交易日、owner、generation、名單與基準資格 MUST 與可變比較版本分開；僅合法門檻差異 MUST NOT 因saved revision與啟動revision不同而停止observation留存或提前收尾。名單增刪／啟停／排序等結構差異 MUST NOT 被此熱切換授權，仍遵守既有daily plan與持久化suppression規則。

原owner MUST 驗證session身分、預期active comparison revision、完整設定及名單hash，以有界至多160檔封閉分鐘快照準備切換，先保存不可變切換收據再原子套用。receipt MUST 包含舊新revision/hash、session/owner/generation、effectiveAt、逐檔effectiveMinute／threshold與no-notification。CAS或持久化失敗 MUST 保留上一有效門檻及合法來源留存，明列切換失敗；不能只把saved revision設成active或全域移除config驗證。恢復時 MUST 重驗durable收據，不能重新login／另開owner或訂閱。

切換 MUST 立即重算最後已驗證的封閉分鐘，不使用形成中分鐘；重新符合 MUST 標示reclassified而不得補發通知。新有效門檻epoch第一可比較值 MUST 靜默，後續真正未符合轉符合才依原notification Gate及去重規則通知。個別覆寫未受全域切換影響的商品 MUST 保留原去重epoch；舊observation／trigger MUST 不改寫。closing的原時窗及新通知限制 MUST 保留。

#### Scenario: 1.5、2、3倍在盤中依序切換

- **WHEN** 同一合法session持續接收資料，使用者依序切換1.5→2→3→1.5倍，且只有門檻改動
- **THEN** 原owner MUST 在每次合法CAS及持久化確認後套用新門檻，保存真正生效時間／封閉分鐘，資料留存持續且新增broker login／訂閱／行情連線數 MUST 為0
- **AND** 切換當下重新符合 MUST 不補發通知，舊版本事件與原收據 MUST 保留

#### Scenario: 切換持久化失敗或過期版本競爭

- **WHEN** 新門檻收據無法持久化、另一分頁先完成CAS或要求亂序
- **THEN** MUST 不宣稱新版本applied，維持上一合法比較版本與行情留存，保存具體失敗，不可用observation_sink_rejected泛化並永久停止整批

#### Scenario: 門檻切換不得掩蓋來源資格失效

- **WHEN** 日期、generation、owner、基準、來源連續性或單位無法核實
- **THEN** MUST 拒絕新比較／通知，且不得因門檻切換取得其他資料或交易資格

### Requirement: 日常監控必須獨立於全日擷取驗收

系統 MUST 提供明確版本化的 `daily` runtime，重用既有 simulation business session、bounded transport、封閉分鐘 adapter、量比 evaluator、SQLite repository 與排他 run registry。日常入口 MUST NOT 要求全日 capture JSON、全日 shadow recorder、雙重 replay、Stage bundle、每日 GO 審閱或被動圖表證據。legacy 完整擷取與 Stage 驗收只屬明確選用的 `diagnostic` 模式，不得改名偽裝日常成功。

#### Scenario: 沒有完整擷取檔仍正常比較

- **WHEN** 當日 session、來源身分、容量核准、逐檔基準及同分鐘 live 資料均合法，但沒有全日 capture 或 Stage bundle
- **THEN** 日常 runtime MUST 正常保存同分鐘結果，且日常路徑對 legacy recorder、replay、capture export 與 tail review 的呼叫數 MUST 為零

#### Scenario: 診斷工具未執行

- **WHEN** 使用者未要求 diagnostic 模式
- **THEN** 系統 MUST 顯示診斷未啟用，不得把缺少診斷證據判為日常監控失敗

### Requirement: 盤後分鐘量基準必須採用獨立版本契約

日常基準 MUST 使用 `intraday-minute-volume-baseline/2`，明列 sourceTradeDate、targetTradeDate、canonicalSymbol、exchange、來源／版本、fetchedAt、原始與 canonical 單位、calendar reference、payload hash、verifier version、minute coverage、closeMode、逐分鐘累積量與實際 validation checks。成功資格 MUST 為 `minute_volume_baseline_verified_v2`，不得冒充 v1 雙抓、全日 ticks 對帳或 live capture acceptance。

每商品 MUST 驗證官方來源交易日及其緊接下一適用交易日、商品／交易所、Asia/Taipei timestamp mapping、量單位、來源陣列等長、分鐘排序、重複／跨日／盤外／負量與累積量倒退。MUST 使用已核實的來源分鐘編碼，涵蓋開盤撮合及 canonical 09:01–13:30 共 270 個封閉分鐘；未知來源編碼 MUST 拒絕。合法 13:33 延後撮合 MUST 合併於 canonical 13:30，不得產生第 271 個比較分鐘。

#### Scenario: 完整來源單次查詢通過

- **WHEN** 收盤定稿後取得完整直接觀測的 270 分鐘資料，來源、商品、日期、單位、收盤模式及結構均通過
- **THEN** 系統 MUST 保存 v2 基準及實際檢查結果，只授予 targetTradeDate 的 baseline authority，不建立假 refetch time 或 hash

#### Scenario: 開盤時間編碼未知

- **WHEN** 來源第一筆時間的起始／結束分鐘語意未核實，無法確認是否包含 09:00 撮合量
- **THEN** 商品 MUST 維持 waiting，且不得猜測平移時間後發布基準

#### Scenario: 延後收盤基準

- **WHEN** 13:29 前置連續性完整且取得可核實的 13:33 延後撮合資料
- **THEN** 系統 MUST 正確歸入 13:30、保存 `closeMode=delayed_13_33`，且 MUST NOT 建立 13:31–13:33 regular-minute rows

### Requirement: 總量核對與零量補齊必須誠實且逐檔拒絕衝突

已有可信、同商品／日期／單位及 regular-session 收盤總量時，v2 verifier MUST 核對分鐘量總和；不一致 MUST 拒絕該商品。沒有可信獨立總量時，僅完整直接觀測的 270 分鐘資料得依新版來源／結構契約發布，並 MUST 明列 `closeTotalCheck=not_observed`、`independentReconciliation=false`。Snapshot 中零股、盤後或跨日量不得當作相符總量。

缺分鐘 MUST NOT 因空回應、低成交或其他商品成功而直接補 0。只有其餘非負分鐘量已與可信 regular-session 收盤總量對帳、商品狀態合法、缺口確為零成交且有可驗證前一 close 時，才得建立帶證據的 `known_zero`／`carry_forward`；否則只拒絕該商品，並逐檔列出 unknown／waiting。

#### Scenario: 有可信總量但不一致

- **WHEN** 累積分鐘量與已取得的同日可信 regular-session 收盤總量不同
- **THEN** 系統 MUST 保存衝突原值及原因、拒絕基準，不得忽略已存在的總量以取得成功

#### Scenario: 完整分鐘但沒有獨立總量

- **WHEN** 270 分鐘均直接觀測且來源／結構契約通過，但沒有可信獨立收盤總量
- **THEN** v2 MUST 揭露未做獨立總量對帳，不得標成 v1 verified 或完整 live 驗收

#### Scenario: 缺少尾端分鐘

- **WHEN** 缺少 13:30 且沒有充分的零成交證據
- **THEN** 該商品 MUST 維持 waiting，不得用 13:29 累積量充當完整基準；其他合法商品 MUST 獨立發布

### Requirement: 基準發布必須不可變且與當日監控獨立

基準採集 MUST 最早於來源日 13:34:30 收盤定稿後進行，沿用 13:35 本機排程及既有有界補建；MUST NOT 要求當日監控啟動、完整 live coverage、capture 或 interruption evidence。系統 MUST 以商品／交易所／來源版本／來源日／目標日索引、保存 immutable manifest 與 monotonic revision，完成驗證後原子發布。清單重排不得重抓或改變商品身分；同鍵內容衝突 MUST 留存並拒絕覆寫。

#### Scenario: 白天未開機但盤後有資料

- **WHEN** 今日沒有 live capture，但盤後已取得合法歷史分鐘資料
- **THEN** 系統 MUST 能建立緊接下一交易日基準，不得以 capture_missing 阻擋

#### Scenario: 一半商品已完成後採集失敗

- **WHEN** 部分商品驗證成功，其餘來源失敗或尚未定稿
- **THEN** 系統 MUST 保存成功商品、逐檔標示缺口，後續只補缺件，不得宣稱整批完整或重新下載已有效基準

### Requirement: 日常下載必須有界且避免固定重複查詢

日常預設 MUST 每商品只取得一次來源日歷史 1 分 K；合法基準與身分有效的合約快取 MUST 重用。全日 ticks、固定第二份 K、額外日線／Snapshot MUST NOT 成為日常基準必要依賴。可恢復來源失敗或未定稿重試 MUST 使用既有期限、嘗試上限、集中保留額度與 append-only 收據，不得以切換新 schema 重設耗盡或冷卻。

usage 查詢合併 MUST 受來源身分、generation、quota epoch 與短期有效時間限制，並配合保守 reservation／charged accounting；未知額度仍 MUST fail closed。預算 MUST 可設定且依實測校準，不得寫死另一個啟動 bytes 門檻。額外來源診斷 MUST 使用明確模式與獨立有限預算。

跨交易日的本機額度週期 MUST 逐日以官方交易日、同一帳戶、08:00 前後來源計數及完整窗口預算重新驗證，不能因前一次成功便自動清空帳本。後續週期 MUST 以版本化 CAS 轉換當前政策、身分與受保護工作承諾，封存前一週期原件；既有 charged／quarantined／失敗收據不得覆寫。quote 保護池若需調整 MUST 有實測、用途、版本化政策與足額 Gate，不得由排程自動縮小或藉縮小冒充來源額度恢復。券商未提供的 quota epoch 不得標示為已驗證。

常態跨日續轉 MUST 由既有本機盤後／盤前排程執行，不依賴 Codex 排程人工提交。盤後 MUST 保存前一官方交易日的私密來源用量錨點；盤前 MUST 僅選同帳戶、該前一交易日的有效錨點，並以新日官方共同交易日及 08:00 後真實計數經雙階段核對。週末及連假 MUST 依官方前一交易日辨識，不用固定日曆日間隔誤拒；缺前日錨點、計數未下降或任何安全 Gate 未通過時，08:50 MUST NOT 啟動新的下載。同日已轉換 MUST no-op，Codex 驗收不能代替本機正式收據。

跨日來源重設與完整窗口預算已重新驗證時，v4 政策效期 MAY 隨同一 CAS 續至多七日，但 MUST NOT 越過最早實測校準樣本的三十日期限；必須同步更新政策與預算效期、以重設 witness 綁定新證據並封存原版。校準過期時 MUST fail closed，不得以無限展延政策替代重新量測。

同一週期的舊基準承諾與新版逐筆保留若指向同一盤後工作，MUST 僅以當週期、同 scope、已 `dispatched`／`charged`／`quarantined` 的 daily-v2 估量承接舊承諾；`reserved`、其他週期及其他工作不得抵扣。改政策前 MUST 核對 simulation、帳戶與 generation、實際來源用量、無 active owner／reservation、原工作承諾及安全餘額，並以 CAS 封存原政策與不可變收據；不能清除既有逐筆債務。

進入下一個經驗證的額度週期時，先前因同週期 daily-v2 已送請求而歸零的舊基準工作承諾 MUST 恢復至少原完整基準配置底額，並與 160 合約／KBar 全窗口及 quote 保護池一同預檢；不得把前一週期的零承諾或已 charged 當作新週期可免費下載。同一份基準工作的保留額與完整窗口預估不得再次相加：可用額度須覆蓋 quote 保護池、其他獨立工作保留與基準完整窗口預估三者的聯集；基準原保留額只能抵扣同一工作預估，不得抵扣 quote 或其他工作。

若原三次正式盤後嘗試因可證實的本機預算錯配耗盡，操作者可在同一來源日、原冷卻已滿、官方日曆與 generation 不變、政策修正且完整有界預算成立後，執行一次獨立第 4 次補件。原三張收據 MUST 不變，第 4 次 MUST 只補缺檔、最多 120 筆請求、台北時間 20:00 截止，並保存獨立 claim／receipt；不得把人工補件冒稱原 13:35 排程成功。此路徑不成為無限重試或新日常排程。

集中限流的等待若在記錄的准入時刻前極短時間返回，採集器 MUST 在有界範圍補等剩餘時間，不得把正常 timer 誤差直接判為缺檔；時鐘完全未推進或明顯倒退時仍 MUST fail closed。若第 4 次原始收據只剩至多 10 檔因此標成 `daily_collection_cooldown_clock_not_advanced`，操作者可在原 15 分鐘冷卻、同日 20:00 截止、相同日曆／generation／simulation、安全 Gate 與共用額度成立後，僅增加一次第 5 次修復補件，最多 20 筆請求。前四張收據 MUST 原樣保留，第 5 次不得成為日常或無限重試，也不得追認原 13:35 排程成功。

#### Scenario: 同日再跑排程

- **WHEN** 同商品與日期已有有效已發布基準
- **THEN** downloader MUST 同鍵 no-op，不發第二次 K 或全日 ticks 請求

#### Scenario: 原生完整發布後保存實際同鍵重用證據

- **WHEN** 原生盤後程序已產生160／160完整收據，而既有14:15／14:55補跑早於完整發布，未留下全批次同鍵no-op證據
- **THEN** 同一盤後入口 MAY 在完整後重新驗證160份已保存manifest，實際以同日期／來源／generation／attempt呼叫collector的已完成收據重用分支，所有新下載、reservation及repository寫入port MUST 禁止
- **AND** MUST 保存獨立不可變查核收據，包含原claim／receipt hash、逐檔manifest hash／品質、原始與查核PID、真實trigger、實際追加下載0與reservation0；不能把原收據的歷史requests數改寫成0，也不得冒稱第二次獨立排程
- **AND** 人工查核 MUST 標manual而非scheduled；原收據與repository revision不得改變，診斷失敗 MUST 分列且不得撤銷已發布基準。只完成程式測試不能勾真實驗收

#### Scenario: 用量快取已過期或身分改變

- **WHEN** usage 快取過期、generation 改變或 quota 身分無法確認
- **THEN** admission MUST 重新取得可信額度或拒絕下載，不得以快取值無限續抓

#### Scenario: 已進入新週期後的下一適用交易日

- **WHEN** 前一個本機日週期已啟用，下一交易日取得同帳戶、官方日期及 08:00 前後來源計數的有效證據
- **THEN** 系統 MUST 重新預留完整窗口並以排他交易轉換新週期；保留前一日身分、政策、工作承諾及已入帳／失敗收據，且不得把同日或身分不符的觀察當成新週期

### Requirement: 盤中結果必須保留同分鐘與連續性安全

runtime MUST 以今日與緊接前日的同一商品、同一 completed-minute、同一 canonical 單位累積量進行比較，分母必須大於零。收到行情、heartbeat、control-plane accepted 及圖表渲染 MUST 分開判定。缺漏／來源 generation 衝突只隔離受影響商品，保留已提交資料；有界 gap repair 與 historical prefix 的原通知限制 MUST 保留，不得變成週期 history polling 或追溯補發。

#### Scenario: 不開啟一分鐘圖表

- **WHEN** 使用者切換商品／週期或關閉圖表，但背景收到合法封閉分鐘
- **THEN** runtime MUST 正常比較並投影 freshness，不得要求圖表可見

#### Scenario: 單檔中斷

- **WHEN** 一檔缺少合法封閉分鐘，而其他商品連續性完整
- **THEN** 該檔 MUST 停止新判定／通知，其他商品 MUST 繼續；重連修復不得產生重複或追溯通知

### Requirement: 日常狀態保存與資源保護必須輕量且可追查

runtime MUST 保留必要 SQLite observations／triggers、逐檔水位、去重身分與有界修訂窗口；MUST NOT 同時建立第二份全日 rows／slots 或在收尾載入全日資料執行雙重 replay。收尾 MUST 以持久化聚合與水位建立小型不可變 receipt，分列 executionOutcome、逐檔 live coverage、最後有效分鐘、來源／generation、資源摘要與獨立 nextBaselineState。

可設定資源上限、磁碟保留與 backpressure MUST 保留。真實資源故障 MUST 保存量測或明列 unknown、受影響範圍及退化原因。摘要寫入失敗 MUST 單獨報告，不能撤銷已提交結果或以 Stage 靜態資源 Gate 將全部商品回寫 failed。

單筆事件略超過處理時間軟門檻時，runtime MUST 記錄實際最大延遲與慢事件數，MUST NOT 僅因此永久拒收全部商品。持續在有界時間窗內超過門檻，或單筆達到硬停滯門檻時，runtime MUST 保留背壓保護；健康檢查 MUST 及早寫入不可變事故證據並安全 partial 收尾，不得以來源事件仍抵達掩蓋已停止接收的狀態。

#### Scenario: 收尾摘要輸出失敗

- **WHEN** SQLite 中合法分鐘／結果已提交，但小型 receipt 無法寫入
- **THEN** 系統 MUST 報告 summary_write_failed，保留可讀結果與逐檔狀態，不得偽造 receipt 或重標全部資料無效

#### Scenario: 背壓超量

- **WHEN** 真實處理佇列或磁碟超過已設定上限
- **THEN** 系統 MUST 安全退化並保存故障原因，不得為取得日常成功移除保護或假報資源峰值為零

#### Scenario: 偶發處理延遲與持續背壓

- **WHEN** 一筆事件僅略超過處理時間軟門檻，後續事件恢復正常
- **THEN** 系統 MUST 留存慢事件與峰值量測並繼續接收合法事件，不得將全名單永久標為背壓故障
- **WHEN** 同一有界時間窗內反覆超過軟門檻，或單筆超過硬停滯門檻
- **THEN** 系統 MUST 停止新判定、保存真正故障與受影響範圍，並由定期健康檢查及早留下事故檔及 partial 收尾

### Requirement: 日常串流停滯必須在盤中留下證據並安全退化

SSE `kbar_gap` MUST 與 KBar、heartbeat、socket disconnect 分類保存。有效 `lagged` 通知 MUST 留存來源報告的 dropped 數、接收時間及有界非敏感樣本；格式不合法或累計溢位 MUST 明列 unknown，不能假設零丟失。其他非 KBar event 名稱 MUST 有界計數，不保存任意原文或秘密值。來源 gap MUST 進入健康事故與收尾診斷，不以 socket 存活宣稱來源無缺漏；未知 affected symbols MUST 保持 unknown，不猜測是尾盤兩檔或將全部商品回寫 failed。不得僅因 gap 重開健康 socket、新增訂閱或取消長時間沉默／資源故障的優先保護。

#### Scenario: 收到158筆KBar及來源報告丟失2筆

- **WHEN** 同一原 reader 收到 158 筆合法 KBar 與 `kbar_gap`／`lagged`／`dropped=2`
- **THEN** 收尾 MUST 分列收到158筆與來源報告丟失2筆，不把缺少的2筆造為 KBar，也不得猜測來源報告對應的商品
- **AND** 健康檢查 MUST 保存非斷線的來源 gap 事故；舊日未保留此通知時不得追認為已證實丟包

日常執行器 MUST 在單一 owner 內定期檢查實體 SSE reader 與實際 KBar 來源活動，不能只因程序 PID 尚在、TCP 仍為 ESTABLISHED 或 control-plane 曾接受訂閱就宣稱持續監控。reader 正常結束或異常退出後 MUST 關閉原實體連線、保存分類原因；既有一次有界重連未成功時 MUST 在盤中停止該 owner 並留下 partial 收尾，不得保持無期限假 running 或建立並行 reader／訂閱。

連續交易時段的全名單來源長時間沉默 MUST 以可設定的有界時窗記錄不可變事故；持續沉默時 MUST 安全退出，已保存的 observation／trigger 不得回滾或改稱完整。13:25–13:30 收盤集合競價及合法延後撮合窗口不得因暫停逐筆成交被誤判為來源故障；資料活動、TCP 存活、runner 生命週期須分別呈現。若當日原程序已啟動，更新檔案不得冒充該程序已載入修正或今日 live 驗收成功。

#### Scenario: 讀取循環退出但程序仍存活

- **WHEN** SSE reader 因上限或讀取錯誤退出、舊 TCP 仍可能留存，且同一 owner 的有界重連無法成功
- **THEN** 原 reader MUST 被關閉，日常程序 MUST 在盤中保存故障與受影響時點、以 partial 收尾釋放其 owner；不得等到 13:34 才以程序存活推定成功

#### Scenario: 集合競價期間沒有一般逐筆成交

- **WHEN** 13:25 後至合法收盤／延後撮合期間暫無新 KBar，但 reader 仍有效
- **THEN** 靜默偵測 MUST NOT 僅因該段時間沒有新來源事件而中止監控或偽造缺漏

### Requirement: 收盤與選用診斷不得混淆 live 與歷史來源

日常 owner MUST 保留正常 13:30 與合法 13:33 延後收盤接收及修訂窗口，最早 13:34:30 才 final seal／unsubscribe。完成後 MUST 停止本 owner 的新通知權限，只釋放其擁有的訂閱，不停止共用服務。盤後 tail review 不再是常態呼叫；選用診斷只能唯讀比對 SQLite 與歷史基準，MUST NOT 補寫 live observation、補發 trigger／通知或改寫原 failed。

日常 KBar transport MUST 以有界逐商品計數保留尾盤 13:29／13:30／13:33 已進入 reader 的 frame 證據。原生盤後 v2 基準完整發布後，若原 daily summary 至多四檔只缺最後一或兩個封閉分鐘，系統 MAY 自動以本機唯讀 SQLite／v2 manifest 進行尾端核實；MUST 核對同商品、日期、generation、manifest ID、268 或 269 分鐘連續 live 前綴、最後 live 分鐘累積量、逐一缺漏分鐘的非負增量與合法收盤模式，並以不可變獨立 artifact 標示 `liveDelivered=false`、`liveAcceptance=false`。不得為核實新增券商請求、補寫 live observation、補發訊號／通知或改寫原 partial／稽核。

#### Scenario: 尾盤來源未進入 reader 但盤後基準可核實

- **WHEN** 13:30 某商品沒有 KBar frame、原 live 僅至 13:28 或 13:29，但同日已驗證 v2 基準在最後 live 分鐘的累積量與原 live 相同，且尾端一至兩分鐘的量均可核實
- **THEN** 系統 MUST 逐分鐘保存來源為盤後歷史的獨立尾端量證據，仍顯示當日 live partial；若重疊量不同或來源未就緒則 MUST 不發布核實結果

#### Scenario: 尾端缺漏但翌日基準通過

- **WHEN** 某檔 live 尾端 partial，獨立盤後歷史 v2 基準完整通過
- **THEN** 系統 MUST 同時顯示 live partial 與翌日 baseline ready，不得把歷史成功改成 live complete

### Requirement: 新舊模式切換必須排他且保留原證據

daily、固定／動態路徑、late-boot 與 diagnostic MUST 共用排他 ownership，同交易日不得形成第二個 monitor owner 或 broker login／行情連線。正式切換 MUST 先通過回歸並確認無既有 owner，保存設定／claim 前後證據；進行中的舊程序不得被重啟以冒充新模式實證。舊 manifests、收據、Stage 核准及 failed／partial 證據 MUST 保持原值與 hash。

相關 active changes 的每項任務 MUST 分列保留、遷移或 `superseded-by-design`；被取消的 capture 驗收要求不得勾為 passed 或自動歸檔。新模式正式驗收 MUST 包含真實自動盤後基準與下一適用交易日的背景比較、收尾、單一 ownership、實際 request count／bytes 及資源量測；離線測試不得冒充 live。

#### Scenario: 日常程序仍在執行時要求診斷

- **WHEN** registry 已存在 current owner
- **THEN** 第二個入口 MUST 拒絕建立新擷取／訂閱，且不得停止原 owner 以取得測試成功

#### Scenario: 已取消的舊驗收目標

- **WHEN** 常態完整 capture 要求因本案被取代
- **THEN** 任務 MUST 保留原失敗證據與被取代原因，不得記為真實驗收通過
