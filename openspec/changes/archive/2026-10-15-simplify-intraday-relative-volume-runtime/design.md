## Context

2026-10-05 的 160 檔 × 270 分鐘共 43,200 筆 observation 已保存於 SQLite，包含 13:30，與獨立盤後基準全數一致；原正式程序卻在建立 Stage session 時因資源驗證遭拒，未產生完整 capture，連帶使尾端復原停在 `source_pending`。原資源峰值未留存，不能推定到底哪一項超標，也不改寫今日 failed。

實際相依關係：

- `premarket-orchestrator.mjs` 的 08:50 及 `late-boot-catchup.mjs` 呼叫 `capture-direct-160-stage.mjs`；該檔同時承擔 stream ownership、分鐘封存、`createDirect160ProductSink`、量比結果、驗收 recorder、重播與報告。
- `kbar-shadow-session-recorder.mjs` 除了 shared adapter，另將全日資料保存於 `rowsBySymbol` 並展開 slots；產品 repository 已持久化同一 observation。
- `postclose-daily-baseline.mjs` 原本能獨立產生歷史基準，但成功後仍觸發 capture-dependent tail recovery。`audit-monitor-failures.mjs` 的 13:40 檢查仍以 `formalAcceptanceEvidence` 判斷日常故障。
- `collect-direct-160-baseline.py` 每商品取得 contract、兩份同日分鐘 K 及全日 ticks，再以嚴格 v1 builder 驗證。10/5 原 request ledger 為 320 KBar requests／4,964,612 本機 response bytes、160 ticks requests／39,392,787 bytes，另有 649 次 usage 查詢。這些是本機 HTTP response bytes，不是券商 quota 的直接量測。
- 動態名單另有 daily plan／baseline resolver／execution，但 execution 也使用 shadow session 並保存 capture。僅接回這條路徑仍不足以達成簡化。

## Goals / Non-Goals

**Goals:**

- 日常產品採「盤後已驗證分鐘量基準＋盤中同分鐘累積量」；完整擷取 JSON、兩次 replay、每日 Stage 審閱及視覺證據均不是正常運作依賴。
- 同一商品的基準可在沒有當日 live capture 的情況下獨立建立；名單以商品／日期鍵值配對，支援既有動態名單及晚開機能力。
- 減少全日資料重複駐留、序列化與日常全量下載，同時保留可追查的最小 observation／trigger／收據。
- 用明確的 v2 來源品質揭露取消雙抓後的驗證邊界，保留缺漏、unknown、零分母與真實故障的拒絕行為。
- 安全遷移五個相關能力與四個 active changes；原始失敗、歷史容量與舊檔 hash 不變。

**Non-Goals:**

- 不撤銷或改判歷史 Stage、10/2／10/5 失敗，不將新契約回填為舊驗收成功。
- 不提升 active 160／configured 200 上限、不啟用 production／CA／broker write、不另開 login 或行情連線。
- 不用 Snapshot 全天量比例、每筆 ticks 估算或盤中週期 KBar 輪詢取代同分鐘計算。
- 不順便修改 1 分 K 圖表、MultiView 清單、分價量表、資金流向或其他盤後資料 pipeline。
- 不因本機 JSON 減少，就宣稱券商流量會下降相同比例；節省程度須另量測。

## Decisions

### 1. 日常 runtime 與診斷模式使用不同權限及出口

新增版本化日常 runtime，重用 bounded transport、`kbar-stream-adapter`、量比 evaluator、SQLite repository、每日 session 與 shared run registry；不把 legacy capture entry point 直接刪掉，也不藉由把 Stage validator 改寬鬆來達成產品化。

日常模式只保留逐商品目前累積量、連續性 watermark、修訂／重連所需有界窗口，以及必要持久化 observation／trigger。完整 rows／slots 不再同時駐留於第二份全日 shadow recorder。收尾以 SQLite 聚合與最後已核實 watermark 產生小型不可變 receipt，不重新載入全日 raw rows 以組裝報告，也不執行整日雙重 replay。

診斷模式保留舊 recorder、replay、Stage bundle 及資源驗收工具；必須明確選用，沿用同一排他 registry，不能與日常 owner 並行建立第二份訂閱。日常資料需要另做離線重算時，可從唯讀 SQLite 取得，不因此取得 Stage acceptance。

替代方案：單純停止 capture 程式會連同盤中訂閱／比較一起停止；單純放寬 resource budgets 則保留原耦合與資料重複，均不採用。

### 2. 盤後分鐘量基準使用獨立 v2 契約

建議 schema 為 `intraday-minute-volume-baseline/2`，包含 sourceTradeDate、targetTradeDate、canonicalSymbol、exchange、source/version、fetchedAt、raw／canonical unit、source payload hash、verifier version、calendar reference、270 個 cumulative-volume 值、closeMode 與 validation checks。

由 Shioaji 現有歷史分鐘 K 取得當日量，使用已驗證的 timestamp／Volume mapping 轉成 `Asia/Taipei` regular-session canonical keys。不能假設來源 row timestamp 就是封閉分鐘、不能漏掉 09:00 開盤撮合量，也不能把 13:33 直接新增為第 271 個比較分鐘。沿用已測試的 13:30 revision／13:33 延後收盤歸一規則，最早 13:34:30 後才取得定稿資料；既有 13:35 排程保留。

日常預設一次查詢，不要求每檔兩份 K 及全日 ticks。完整 270 分鐘來源須經商品、日期、來源版本、量單位、欄位等長、排序／重複／盤外與非負量檢查，累積不得倒退。若已有可信且同日期／同商品／一般整股 session 的收盤總量，必須對帳；有衝突就拒絕發布。沒有獨立總量時，完整直接觀測的 270 分鐘可依新版來源／結構契約發布，但 `closeTotalCheck=not_observed`、`independentReconciliation=false`，不能假稱總量核對完成。

缺分鐘不能僅以「當日沒成交」推測補零；只有商品狀態及可信收盤總量能證明缺口為零量時才可建立帶證據的 known-zero。沒有這類證據就該商品 waiting，不要求其他商品一起失敗。Snapshot 的零股／盤後量或跨日量不得混成可信 regular-session 總量。

v1 manifest 依原雙抓／ticks 契約繼續唯讀解析；v2 不填造 refetchTime、refetchHash 或假總量。相同 source/version/date/symbol 出現新內容必須建立衝突紀錄，不能覆寫已發布版本。日常 resolver 預設選相符的 v2，若只有合法 v1 則唯讀重用；不為補足報告而重新下載同日已有效基準。

替代方案：刪掉舊 validator 的 ticks／refetch 檢查，卻沿用 v1 verified 名稱，會把較少證據偽裝為原契約通過，因此不採用。

### 3. 輕量採集與集中有界預算

每商品有合法當期合約快取就重用；新商品、來源 generation 或 catalog 版本失效時才重新驗證，不由清單名稱推測合約。重用同商品／來源交易日已發布基準，不因清單重排重抓。

維持集中額度保留、逐請求 admission、期限、有限嘗試與 append-only 收據，但消除同一輪可安全合併的 usage 查詢。可以使用有時效及身分限制的 usage cache 加上保守 reservation／charged accounting；沒有可信額度或 reservation 時仍 fail closed，不以舊值無限續抓。新 profile 預算須以 v2 實測重新校準，不能沿用全日 ticks 舊預估，也不直接寫死較低 bytes 門檻。

實作時發現舊基準的受保護額度與新 daily 每筆 reservation 若同時完整扣除，會重複保留同一項盤後工作。10/6 的 43 檔缺口即為此重複扣算所致，並非券商日額度已耗盡。經使用者授權，v4 同一額度週期的 `daily-baseline-allocation-v1` 只允許已 `dispatched`／`charged`／`quarantined` 的 `monitor-minute-v2:` 估量承接舊基準配置；未送出的 `reserved` 不抵扣，其他週期的預留不抵扣，中央帳本的每筆債務也不刪除。切換必須驗 simulation、帳戶 HMAC、generation、真實 usage、無 active owner／reservation、原承諾與可用預算，並以 CAS 保存原政策、前後 hash 及獨立收據；任一 Gate 不成立即維持原政策。

使用者後續授權依實測自行調整 quote 保護池，但不得以任意調低安全額度換取表面通過。本輪先修正重複扣算，實測可用餘額足夠，因此 quote 保護池仍維持 300 MiB；未來若確需調整，須另作版本化政策修訂，保存用途、來源用量與完整窗口估量。

原先使用者要求維持 300 MiB quote 保護池，後續授權按實測判斷調整；10/6 的正式修訂並未縮減保護池。Shioaji 官方說明日流量額度在交易日 08:00 重設，但本機 v3 保守帳本刻意不因換日或 API generation 改變而清帳。要支援跨日常態運作，須在新版本週期中同時證明官方交易日、重設前後實際來源計數下降、相同帳戶身分與相同額度上限，並以不可變證據及原子政策遷移封存舊週期；舊週期的 charged／quarantined／失敗收據不得刪改。僅有來源規則、日期、計數下降或本機新 UUID 任一單項，都不得授予新額度。沒有足夠證據時維持舊保守高水位及 mode-off。`broker-daily-reset-witness/1` 先只分類候選，**沒有**新週期／admission 權限；正式帳本與政策遷移須另經回歸及真實跨日驗證。

本機跨日候選以只在本機持有的 HMAC key 摘要證券帳戶集合；原始帳號不落盤。重設前後的 `/auth/usage` 原值以 0600 append-only 收據保留，私密 key 也不入 repo。新版 `local-verified-daily-reset-v1` 僅在保存 witness 收據、舊政策／承諾與無 active reservation 的 CAS、以及 300 MiB 保護池加上 160 合約及 160 KBar 全窗口估量都成立時，才可轉為正式新週期；舊週期預留與失敗仍歷史可讀，不將其當成本交易日耗額。啟用分成唯讀準備與明確提交兩階段；提交前重新驗日曆原檔、帳戶 HMAC、simulation generation、mode 與排他 owner，不沿用已變動的準備結果。轉換後每次 admission 再核對同一帳戶 HMAC、simulation／generation 及本週期單調來源計數；中途帳戶變動或計數再下降均拒絕，不自行建立第三個週期。10/6 已依真實來源重設證據完成 v4 轉換及 daily mode 啟用；當日盤中結果仍以原 partial 收據判定，不能用政策成功代替全日驗收。

因既有每分鐘最多兩筆的速率使全 160 檔首次合約加 KBar 最短約 160 分鐘，13:35 原程序可在同一所有權內依有限次數與冷卻自行接續。14:15／14:55 補跑若遇原程序仍在執行或尚未到重試時刻，只回報進度／冷卻，不建立競爭 claim；真正程序退出且缺收據時保持未知，不清除原 claim 逕行重跑。

10/6 第 4 次有界補件寫入 157／160，剩餘 3 檔的收據均為 `daily_collection_cooldown_clock_not_advanced`，不是券商額度拒絕。集中限流等待原先只在一次計時器返回後立即比較 ISO 截止時刻；計時器可能稍早返回而形成誤判。修正為在時鐘已有推進、距截止不逾一秒時最多補等三次；時鐘未推進仍拒絕。保留第 4 次 partial 原件，僅允許其餘三檔在原冷卻滿、同一來源日與 generation、原安全 Gate 下再做一次上限 20 請求且 20:00 截止的補件，不提高日常速率或改原模式檔。

跨日額度的雙階段安全核對接回既有本機排程，而非 Codex 常態執行。13:35 盤後流程結束時以既有 simulation API 保存前一交易日的私密計數錨點；盤前 08:20／08:35／08:45 可對前一官方交易日的最新已驗證錨點重試，08:50 啟動前再核對一次。只有官方共同交易日、同帳戶 HMAC、來源 08:00 後實際計數下降、同上限、無 owner／reservation 與 320 請求完整預算成立，才 `prepare`／`commit` CAS 新額度週期；同日已轉換則 no-op。週末或連假按官方前一交易日辨識，不以固定 36 小時誤擋；前一交易日不符或觀測太舊仍拒絕。盤前早期核對失敗仍可建立同日 session，但 08:50 不會在舊額度週期啟動新下載；原 claim／receipt 不覆寫。

原 v3 操作者效期複核只支援舊身分，v4 若直接沿用舊 `validThrough` 會在數日後即使真實跨日重設成功仍停住。每次 v4 來源重設 CAS 因已重新查核完整 320 請求預算，可將同一政策效期續到至多七日後、且絕不越過最早實測校準樣本的三十日期限；政策與 budgetPolicy 同步版本化並綁入 witness hash。沒有新鮮校準時拒絕續轉，不在來源資料陳舊時無限自動延長。10/7 真正 CAS 尚待實盤驗證。

翌日額度重置時，基準最低配置 85,667,193 bytes 與 160 檔完整窗口預估亦保護同一件工作。政策轉換仍須恢復此配置、保留 300 MiB quote 池與 320 筆完整估量，但只要求完整窗口預估**超過**基準配置的差額另有餘額；轉換後逐筆 charged 持續承接配置，不重複扣算。其他獨立工作承諾不折抵。隔離回歸涵蓋餘額 450,000,000 bytes 可通過、420,000,000 bytes 仍拒絕的邊界，不能把此修正當作 10/7 真實來源重置證據。

正常 source failure、未定稿或可恢復缺漏才進入既有有界重試；成功商品不重抓，衝突原值保留。全日 ticks、固定雙抓及額外日線／snapshot 查詢不列為正常必需；若需額外來源診斷，另由明確模式與獨立有限預算授權，不循環下載充當盤中行情。

### 4. 盤中與翌日基準完全分離

10/13查出同鍵no-op實證出口缺漏：原14:15／14:55補跑通常早於16:29完整發布，而CLI輸出沒有持久化完整後重用證據。僅在獨立盤後entry新增完成後查核，未接入Vite config的81檔相依鏈，也不改已執行runner。查核先以唯讀SQLite逐檔重驗v2 hash／日期／來源及原claim／receipt，再實際呼叫collector相同attempt的已完成收據分支；所有下載／admission／repository寫入port均注入拒絕，任一被呼叫就拒絕成功。確認原件、revision及manifest內容未變後才用exclusive create留 `attempt-XX-same-key-noop.json`。收據區分真正scheduled與manual、原PID與查核PID、原歷史requests與追加0；這不是新增排程或第二次下載。原生程序下午自然執行後才算實證，舊日不人工倒補成排程成功。診斷失敗另列，不撤銷原已發布基準。

今日 runtime 成敗不影響獨立盤後採集入口；有源資料就可建立翌日基準。當天電腦沒有盤中啟動、部分串流中斷或報告失敗，都不構成禁止下一日基準的理由。

比較仍是同一商品與同一 completed-minute 的 `today_cumulative >= threshold × previous_cumulative`，前日分母須大於零；完整性、來源、日期、單位、設定／plan、generation 不合法的商品保持 waiting／degraded，不發通知。真正 received data、runtime heartbeat 與圖表渲染是不同狀態，不能以是否打開 1 分 K 決定背景活動。

盤中既有 gap repair 不因簡化而偷偷刪掉：已核實的來源重疊與有界 REST 修復保留，歷史前綴標 historical，不發追溯通知；其下載、用途與範圍要獨立計數。此 change 不放寬晚開機截止或未核實累積量規則。

### 5. 正常收尾與資源事故不再等同 Stage NO-GO

保留 13:30:15 closing 與最早 13:34:30 final seal／unsubscribe，直到正常 13:30 與合法 13:33 傳輸寬限結束。只停止本 owner 對應的訂閱，本機 HTTP API／watchdog／Web／MultiView 不停止。

每日 receipt 分列 executionOutcome、liveCoverageBySymbol、lastComparableMinute、source／generation、runtime resource summary、nextBaselineState（由獨立來源查詢）與 diagnosticsState。某檔尾端缺漏只標該檔 partial；收尾檔寫入失敗另記報告錯誤，不能倒改已提交分鐘或所有商品狀態。

日常仍有可設定資源上限、磁碟保留與 backpressure。真正超量需明確事件、受影響範圍及安全退化；不能以 Stage 靜態 DB growth／整日 replay Gate 單獨撤銷當日先前合法結果。CPU、RSS、DB bytes 與處理延遲應實測，不偽造 0、不預先保證這次可消除 10/5 未知資源拒絕。

10/6 實盤發現程序與 TCP 仍存在，但 10:36 後 SQLite 停寫、SSE 接收佇列增加；當時尚未取得收尾收據，不能武斷判為 byte limit。修正日常 reader 異常結束時未立即關閉舊實體連線的缺口，並由全日執行器每 15 秒檢查同 owner 的 transport 狀態與實際來源時間。不可復原的 reader／重連故障須先寫不可變事故檔，再提前 partial 收尾；連續交易時段逾 3 分鐘無全名單 KBar 先記停滯，再持續 3 分鐘才安全退出。13:25 後的集合競價與合法延後撮合不以同一來源沉默門檻判故障。這只是下一次啟動的新程式保護，不會熱載入 10/6 已執行的程序，也不把歷史補值宣稱 live。

10/6 原程序收尾後，`summary.json` 證實真正故障為 10:37:09 首次事件處理耗時 3,006 ms，略高於 3,000 ms 門檻；舊程式以「整日最大值」作永久全名單背壓鎖存，故即使後續 SSE 事件仍抵達，也全部拒收。修正後保留可設定 3,000 ms 軟門檻及資源 Gate；單筆慢事件只計數與保留峰值，60 秒內 3 筆慢事件或單筆超過軟門檻 5 倍才視為真實背壓並停止新判定。15 秒健康檢查也直接核對資源故障，先寫不可變事故再提早 partial 收尾，不讓來源活動掩蓋接收已停止。此政策只作用於下次啟動的新程序；10/6 原始 partial、已提交分鐘與稽核失敗均不改寫。

### 6. 常態尾端衍生驗收改為選用診斷

`postclose-daily-baseline` 正常成功後不再自動呼叫 capture-dependent tail review；因為下一日只需要新歷史基準，補成昨天的完整 capture 對今天比較沒有必要。

10/7 與 10/8 的日常路徑各有兩檔 13:30 KBar 未進入監控 SSE，且缺檔每日不同；所有已進入日常 reader 的 frame 均已被接受，無斷線或 malformed。10/8 的 2603／5284 在獨立歷史 v2 基準顯示 13:30 分別增加 1,590／12 張，並與 live 13:29 累積量相符，故不是可推論為零量的缺棒。現有證據尚無法區分券商未推與本機 API 未轉送。日常 transport 因此追加有界逐商品 13:29／13:30／13:33 frame 計數及最後接收時間，供下次真實收尾定位，不能把全域 SSE healthy 當逐檔完整。

使用者要求處理反覆出現的尾棒缺漏。這裡新增與舊 capture tail review 不同的本機唯讀核實：原生盤後 v2 基準 160／160 真正完成後，僅針對原 daily summary 中至多四檔、前綴 268 或 269 分鐘 live 完整且只缺最後一至兩分鐘的個股，比對 SQLite 最後 live 累積量與同日已發布 v2 manifest 的重疊端點及逐一尾端分鐘。身分、來源日期、manifest ID、generation、收盤模式或重疊量不符就拒絕；相符才用 `wx` 留獨立不可變 `postclose-tail-reconciliation.json`，標 `liveDelivered=false`、`liveAcceptance=false`。不補寫 live observation／trigger、不補發通知、不新增 HTTP 或 broker 訂閱，也不改原 summary 與 13:40 稽核。當日盤中完整性仍為 partial，翌日基準可獨立 ready；核實的尾端量供盤後追查而非冒充 live。今日已啟動的原採集程序不會熱載入新程式，需在其 160／160 收據出現後以同一唯讀核實器補記今日 sidecar，並待下一交易日觀察真正自動接線。

若使用者要追查當日缺口，診斷只讀 SQLite 已收到分鐘與新版獨立基準，產生獨立 provenance；不填回 live observations、不補發 trigger／通知，也不把它當成原始 live 成功。舊復原工具與已保存結果保留，只有常態呼叫、無用途 import／旗標／投影依賴精準移除。

13:40 failure audit 改查日常程序結束／是否仍意外執行、真實串流故障、已保存收尾摘要或摘要寫入故障，以及盤後基準的 collecting／ready／failed。13:35 工作尚在有界採集時報進度，不因尚未出現基準或 capture 報完成失敗。

### 7. 保留既有名單與啟動安全機制

日常 owner 依封存 daily plan／設定版本、逐商品基準及 durable capacity approval 啟動。歷史 Stage bundle 只引用已核准容量，不檢查每日新 capture；排序不改變商品身分，新增商品的前日基準仍須盤前完成。

08:20／08:35／08:45 與登入後接續維持可恢復、同日冪等及原收據不覆寫；08:50 改呼叫日常 runner。late-boot、固定路徑、動態路徑與診斷入口共用互斥 ownership，不能用多條監控同時試驗。通知仍遵守已保存的使用者開關、系統授權與 current data Gate，本案不替使用者自動開啟。

### 8. API/UI 用小型狀態而非驗收術語

10/15確認長駐分頁以空相依useMemo固定載入日，會出現status為今日而results查昨日的矛盾。日期改由台北日期state及10秒本機檢查、focus／visibilitychange推進；僅日期真的改變才切換本機頁面lease與事件範圍，清除前日cursor／結果／盤後投影並拒收舊回應。設定及未保存名單草稿保留，不修改背景runner或broker訂閱。真正盤中三快捷CAS及來源不中斷證據另存10/15驗收，不能以候選測試或頁面載入代替。

新版 API 帶 runtimeMode／schemaVersion／tradeDate／plan／generation 與逐檔基準、連續性、最後有效分鐘；診斷缺件明示 disabled／not_requested，不回傳假的 formal acceptance。相容舊 client 時未知欄位不得被預設為 ready，也不把 v2 填成舊 `readyForBundle=true`。

面板以「今日監控」、「前日基準」、「下一交易日基準」、「診斷」四種資訊分開；歷史容量仍可在收合說明查看，但不占據正常主要狀態。收尾後合法結果可供唯讀查看，通知權限結束；畫面不把過去 trigger 當成目前仍達標。

### 9. daily 官方日曆獨立接線

10/13 真實盤前發現 v2 基準已到 10/12→10/13，但盤前仍只讀 10/5→10/6 的 v1 包，來源跨過原 7 日期限而拒絕。不能延長舊時間或偽造新的 v1 bundle。新增 `intraday-monitor-official-calendar-cache/1`：盤後實際官方來源與相鄰交易日驗證後，以 exclusive create／0600／fsync 保存獨立原文與內容 hash；盤前先驗新快取的來源、內容、日期與原期限，沒有新快取才沿用原 legacy。新版快取不合法時不回退舊值。

本次使用者授權的兩次官方 HTTP 只產生新 `operator-repair` 日曆證據，不抓券商行情、不修改舊包、不冒充昨日原生排程。正式額度 witness 接受經私密檔案及 hash 重驗的新版 authority，其帳戶、來源重置、完整窗口及 CAS 條件不變。08:50 在開盤前可沿用同日補建 Gate：只有原 08:20 日曆失敗、無成功 claim／session／今日資料及完整安全 Gate 才補建；原失敗保留，09:00 後拒絕。新鮮日曆不代表當日行情或完整全日已通過。

### 10/13 補充：盤中即時門檻切換

本日13:03:48正式UI僅將全域門檻改3、saved revision9→10，但session仍9；sink的current Gate因config_revision_mismatch拒收，adapter泛化observation_sink_rejected並鎖存，13:30轉closing失敗而提前partial。這是設定／資料資格耦合，不是券商額度或資源不足。原summary、13:40失敗、38,720筆observation及113筆trigger保留，不以歷史重算追認成功。

使用者明確要求1.5、2、3倍都可在盤中切換並立即生效，不採「下次session才生效」。行情session保留啟動時交易日、owner、generation、名單與基準身分；另設比較版本與去重epoch。只有全域／逐商品門檻差異可以熱切換；新增、移除、啟停、排序及其他結構差異仍走既有daily plan／suppression規則，不因新門檻機制另開訂閱或全域取消config Gate。

現有owner在有界本機控制檢查及下一來源事件前核對saved revision，CAS驗證預期比較版本與完整原名單hash，準備至多160檔最後已驗證封閉分鐘的切換快照。先以同步持久化port保存不可變收據，再一次更新記憶體比較版本；收據包含session／owner／generation、舊新設定hash／revision、真正生效時間、逐檔有效分鐘／門檻、變更商品及no-notification。持久化拒絕或CAS失敗不宣稱已生效，沿用上一有效比較門檻；來源仍合法時不得使分鐘留存中斷。程序中斷後不可盲信saved revision或另啟owner；需核對正式切換收據與durable指標，未核實前比較／通知拒絕並明列原因。

立即生效不表示用形成中分鐘：切換後立刻以最後合法封閉分鐘重新判定，標示「門檻調整後符合」，不補發通知；下一來源封閉分鐘才依新門檻與原通知開關判斷。每個有效門檻epoch第一筆可比較值作靜默起點，只有其後真正not_matched→matched且未通知過的事件可通知。未受全域門檻改動影響的個別覆寫商品保留原epoch，避免相同門檻因全域revision增加而重複觸發。舊trigger的門檻／版本／時間不改寫。

UI須分開「已儲存」、「套用中」、「已生效」、「切換失敗」與「盤後無active owner」，回傳saved／active comparison revision、global threshold及真正effectiveAt／逐檔effectiveMinute。沒有runner確認不能顯示已生效。1.5／2／3快捷按鈕使用專用門檻操作，不能把未保存的名單草稿一併送出；多分頁仍使用CAS，快速連按可合併尚未接手的要求，但不可亂序套用或把被取代的版本標成applied。

既有closing、13:33窗口與13:34:30最早收尾不變；closing中可切門檻但不重開通知。新shared模組接線可能觸發Vite重載，先完成不在config相依鏈的獨立核心／回歸；實際受控載入須確認原盤後程序不受影響並取得使用者授權。原程序不會熱載入新碼，不把候選測試冒充今日實盤。

### 10/14 補充：重開機中斷的操作者補件

原生13:35第二次採集在主機15:28:09重開機時中斷，留下claim但沒有完成receipt；97份合法manifest保留，尚缺63份。使用者明確要求補件，不套用要求原三次budget partial的舊補件入口，也不捏造原第二、三次收據。獨立standalone入口驗證原owner已退出、開機時間晚於claim、原冷卻、官方日曆／固定160母體／容量核准與既有simulation身分；以原claim hash建立排他operator namespace、追加claim／receipt及原97份hash快照。正式repository與中央admission共用，僅查缺件，原18:30期限、兩請求／分鐘及300MiB保護池不變；本次最多126筆合約／分鐘K查詢，不新增登入／訂閱或操作服務。

同日重開機後原始usage從帳本17,295,412 bytes降至約2.2MB，原v4單調檢查拒絕，不把此下降當新額度週期。操作者補件專用admission保存不可變同週期carry：原high-water加新generation原始usage作保守上界；raw／carry／conservativeUsedBytes分列，scope／HMAC／上限／daily identity不變，charged／quarantined和所有舊收據不刪。仍使用中央原子reserve／start／settle、政策效期與兩請求速率。再一次generation／帳戶／計數退回一律拒絕，不能清帳放行。第一次operator因budget_pending零下載的partial保留，修正後第二次亦需完整15分鐘冷卻；不增加原生嘗試次數。

成功只代表10/14→10/15歷史分鐘基準備妥，不能追認10/14 live或原生排程完整。入口不在Vite config接線鏈，無服務重載；狀態與後續通知以實際operator收據及160份正式manifest為準，不把原生中斷投影改成原生成功。

### 10/15追加決策：產品可用性與原始live完整性分開

依使用者明確授權，新增版本化`intraday-close-tail-exception/1`政策及不可變`daily-close-tail-exception.json`。政策從2026-10-15適用，固定母體160、最多10檔、只容許單一canonical 13:30缺漏；其他150至159檔須各270筆，所有商品09:01–13:29共269分鐘須逐筆檢查同日期／generation／來源／單位、連續且非歷史補件。13:34:30前收尾、來源gap／malformed／disconnect／健康事故／資源故障／比較設定故障、兩分鐘以上或盤中缺口、超過10檔、身分未知均拒絕例外。

原生盤後160份來源日v2完整發布後，僅讀本機repository與原收據，逐檔重驗schema／manifest hash／官方前後日期／cohort、13:29與原live累積量一致，前日基準須為同商品、session前一官方交易日及目標本日的合法v2。從不可變threshold journal驗證session／hash chain與收尾summary對應的實際已生效比較版本，個別覆寫優先；不得使用盤後最新全域設定代替。以BigInt交叉相乘重算13:30累積量比，前日分母零列不可比較而非達標；每個缺檔都留一列，不僅保存達標列。

獨立產品判定可為`passed_with_close_tail_exception`，但原executionOutcome、liveCoverage及liveAcceptance=false保留；artifact記錄政策版本、原summary／collection／session／journal與manifest證據hash、採集trigger與評估trigger分流、逐檔補算量／門檻／版本／判定。無任何fetch／broker／subscribe／交易port，不寫live資料或trigger；同鍵相同證據no-op、不同證據拒絕覆寫。API僅驗證讀取artifact，未知或損壞顯示未通過；UI同時顯示原live覆蓋、例外產品判定及「盤後補算，不通知」列，不能冒充即時訊號。

未完成的原13:35程序不熱載入／重跑。候選先在隔離目錄開發；今日原程序真正完成後，允許本機唯讀衍生評估獨立產物，標operator_after_original_collection而非原生採集／live成功。後續原standalone盤後入口在完成及同鍵查核後自動衍生，評估失敗不撤銷baseline ready。API／UI接線若需受控載入，先確認原採集已完成及服務授權邊界。7.4可依本新政策的完整真實補算實證通過，不要求把原live缺口改成完整；7.6仍需完整dossier與回歸。

10/15正式載入揭露既有結果讀取只抓第一頁100筆：盤中頁面曾靠SSE累積245筆，但收尾後沒有通知lease，重載無法補到後頁。改為前端使用本機cursor，最多32頁、共享20秒期限，跨頁generation／repository revision須相同，循環／逾界拒絕而不把部分當完整；不新增broker來源。正式三頁245筆與原trigger hash均已核對，與盤後三檔補算清單分開。盤後使用者已另存revision46，原收盤journal18只供當日補算，不回寫設定或取消原current Gate。

## Risks / Trade-offs

- [一次抓取少了雙抓穩定性與全日逐筆核對] → 新版驗證品質明示；日期／單位／完整 coverage 嚴格，可信總量衝突拒絕，缺分鐘需權威零量證據；診斷可另行核對，不冒充舊驗證。
- [刪 recorder 時一併刪除核心 adapter／ownership] → 先建立 dependency inventory，單獨 runner 測試與 dry-run；只取消日常側錄，不刪共享核心。
- [SQLite 留存仍有寫入負荷] → 不重複留在全日記憶體，批次／交易與有界狀態更新量測，保留可配置保留政策；本案不自動刪舊資料回收容量。
- [舊 Stage validator 與新狀態混用] → schema／mode 分流，交叉餵入測試必須拒絕；舊 artifact hash 不變。
- [新舊 runner 同時持有訂閱] → 共用排他 registry，切換前確認無 owner；同日已執行時不得重啟新 runner冒充自動成功。
- [關機使盤後工作漏跑] → 保留既有登入後／盤前有界補建與有限重試，缺資料逐檔等待；不承諾開盤前幾分鐘可補齊任意名單。
- [傳輸量節省估計不實] → 保存本機 HTTP count/bytes 與 provider usage 前後錨點，分開報告；不能由 JSON 大小推算券商 quota。

## Migration Plan

1. 建立本案與四個 active changes 的保留／遷移／被取代矩陣，保留它們的失敗證據及尚未完成的真實任務；已被替代的目標明示 superseded-by-design，不勾成 passed。
2. 實作 versioned baseline／日常 adapter runner／小型 receipt，維持新模式未啟用，先用真實已保存資料唯讀比對與回歸。
3. 接上本機排程、晚開機、動態 plan、API/UI 的模式分流；先唯讀 dry-run，日常路徑對 legacy recorder/replay/capture/tail-review 呼叫數須為零。
4. 在同日已結束且無監控 owner 的安全窗口，保存模式與 claim 前後證據，更新閒置監控工作設定供下一適用交易日；不重啟共享服務，不追造今日驗收。
5. 執行一次真正盤後 v2 自動基準建立＋翌日真實盤中同分鐘比較，確認單一 owner／subscription、無完整 capture 也能運作、無重複通知、實測負荷與收尾摘要。
6. 新路徑通過後才移除不再可達的常態程式／參數；legacy 診斷入口與原始檔維持可讀。若需回復，於無 owner 的下一安全窗口切回原模式，不在盤中另建第二條行情串流，也不覆寫設定或證據。

## Open Questions

- Shioaji 已保存來源的 timestamp／分鐘量／收盤 revision mapping 與台股零成交分鐘輸出，必須在 task 1.2／2.1 以實際 TSE／OTC payload 逐項核實；未知編碼保持拒絕。
- 可重用的同日 regular-session 收盤總量快取實際提供哪些欄位／來源日期／單位，需 source audit；若不可確認，v2 明列 not_observed，不能用混有零股／盤後的總量強行對帳。
- 日常資源／保留與下載預算的具體值由現有實測及新模式有界量測決定，不能在提案先宣稱節省百分比或把未知資源事故判定已解決。
