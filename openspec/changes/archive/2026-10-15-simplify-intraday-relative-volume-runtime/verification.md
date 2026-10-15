# 實作驗證紀錄

## 2026-10-15 16:47：原生翌日基準、例外補算及正式API／UI完成

原13:35同一PID11434於16:29:23.551自然完成attempt02的160份10/15→10/16基準；前次3017失敗159份原件不變。160份schema／hash／日期／cohort、TSE121／OTC39／43,200分鐘及真正scheduled同程序no-op（追加下載／reservation0）核實。當日／前日320份v2重驗、三檔13:29銜接、final seal前durable revision18及BigInt公式一致後，另存operator例外產品收據；原live157／160、08:50 failed、13:40 coverage_incomplete保留。

依已授權批次接線載入5173，正式API與原頁面顯示「日常運作通過（收盤尾筆例外）」及三檔不通知補算。另修前端僅讀首100筆的既有缺口，三頁完整245筆已恢復；原2449／5m圖表已恢復，不選新商品。原八份收據hash、43,197 observation／245 trigger hash、保存設定revision46／1.5與200項名單、API generation及Web971／API83566／MultiView977前後均不變。原收盤比較revision18不覆寫盤後設定46，當下通知仍false。缺完整HAR不量化自動reload或既有訂閱重要求次數，不冒稱全系統零HTTP／零console錯誤；其他服務readiness仍各自判定。

24 Node24＋48 Vitest＋5分頁＋25 Chromium共102項通過，正式Node24型別／build通過（保留chunk警告）；最終strict／diff／新文字whitespace檢查配合dossier完成。完整真實證據見[正式補算與結案dossier](acceptance/close-tail-exception-2026-10-15.md)，7.4依新授權政策完成而非倒改live，9.2–9.6及7.6完成後本案55／55可結案，不自行archive／commit／push，也不替四案原任務自動勾選。

## 2026-10-15：最多10檔13:30尾筆例外候選，待原採集完成

使用者明確更新原change，僅容許最多10／160檔缺單一13:30，全部269分鐘真實前綴及安全Gate須完整；由原盤後160份與前日v2補算並保留原live partial，不宣稱上游已修復。候選純政策／read-only SQLite、不可變產品收據、盤後完成後衍生接線及API／UI已在隔離目錄實作，24項Node24、48項Vitest、24項Chromium及型別／build通過；原chunk警告保留。

真實43,197份前綴檢查通過，但當時原採集仍collecting、完整receipt未到，正確保持pending_postclose。使用者已授權原採集完成後一次5173受控載入，尚未執行；正式共用程式未改。新增政策後tasks48／55，9.2–9.6、7.4／7.6仍待正式接線與真實補算，原14:05失敗及所有歷史partial不改。接續文件與私密補丁guard見[例外補算紀錄](acceptance/close-tail-exception-2026-10-15.md)。

## 2026-10-15 14:05：全日末分鐘三檔缺漏，不能結案

14:09:54唯讀重驗原13:34:42.553 summary、原08:50最終receipt、13:40獨立稽核與SQLite：157／160完整，2355.TW、6191.TW、6449.TW各269分鐘至13:29，13:30缺失；09:01–13:29各160份，共43,197份observation及245筆trigger保留。原runner未提前收尾，reader的43,197份全部接受，三檔13:30／13:33未進reader；source gap通知0、斷線null、資源故障null、最大事件944ms。只能排除已記錄的本機拒收／資源Gate，不能宣稱券商未送、API內部無丟失或上游根因已修復；不做猜測式放大資源或歷史冒充live。

原13:35 scheduled PID11434仍採集10/15→10/16，當下35／160份已發布且schema重驗通過，尚無完成receipt；正常collecting不改判採集失敗。私密audit及原件hash見[今日14:05紀錄](acceptance/live-2026-10-15.md)。維持47／49，7.4／7.6未勾，8.6不撤銷亦不重做；四案矩陣的完整全日與dossier缺口維持，不以歷史sidecar勾通過。僅讀取來源並新增文件，不動服務、分頁、設定、名單、原件或原採集程序；17:05續核獨立翌日基準。

## 2026-10-15 09:47：長駐分頁修正與盤中門檻驗收完成

已修正台北日期固定於載入日的前端閉包，跨日清除舊結果／cursor、隔離遲到回應並保留草稿；原分頁已從10/14／0筆恢復10/15／228筆。23項Chromium面板回歸、Node24型別及隔離build通過，保留既有chunk警告；原Fast Refresh只重接本機頁面事件，不改Vite config或背景owner。

真正同owner PID84453以原頁面完成1.5→2→3→1.5，三張durable receipt的revision16／17／18及480份同分鐘公式重驗通過，09:40／09:41／09:42各160份完整；09:47:41仍active160／degraded0，09:46亦160份。原socket／generation／session、200項名單hash與112筆既有trigger不變。真實HAR中的三個CAS請求及登入／訂閱／新stream0核實，114筆重判事件全部historical／notificationAuthority=false；既有快照等HTTP輪詢非零，不能泛稱全系統零HTTP。詳見[完整盤中實證](acceptance/threshold-switch-live-2026-10-15.md)。8.6完成，47／49；7.4全日與7.6完整dossier仍未完成，原API退出根因及歷史partial不改判。

## 2026-10-13 17:23：原生基準／同鍵實證與門檻正式接線

原scheduled PID72336第二次自然嘗試於16:29:31.667完成10/13→10/14的160份270分鐘基準；17:09逐檔重驗日期、schema／hash、TSE121／OTC39、原claim／receipt／revision與同原程序生成的same-key-noop，追加下載／reservation0，原件不變。closeMode均normal_or_revised_13_30，獨立closeTotalCheck仍not_observed160，不假稱已對帳；7.2可勾，今日live partial及7.4不變。

使用者已明確授權原採集完成後一批受控5173載入，條件成立後接上daily owner、不可變SQLite門檻journal、threshold-only source identity proof、專用API與UI三快捷控制；持久化確認後才換比較版本，單筆切換失敗仍以舊門檻保存分鐘，名單／停用／原registry Gate不放寬。原3倍設定及revision10、200項不變，正式UI可見按鈕，但今日舊runner已結束而status=unsupported_runtime，不能稱今日已即時生效。

21項Node24、70項Vitest與22項完整隔離Chromium通過；型別／build／strict／diff及122份新增文字whitespace通過，既有chunk警告保留。Web924／API55152／MultiView75897 PID、simulation／watchdog restart0及production stopped／write master disabled核實，沒有人工新broker連線或下載。缺完整瀏覽器逐請求錨點，不宣稱重載次數恰1或既有商品重要求0；原圖表目標未證實復原。新紀錄見 [門檻接線及17:05查核](acceptance/threshold-runtime-integration-2026-10-13.md)。8.3／8.4／8.5完成，46／49；8.6仍須下一交易日真實盤中，7.4須完整全日收尾、7.6須完整dossier。

## 2026-10-13 16:09：盤中立即門檻切換規格與候選核心

14:05查核的新故障已定位：13:03:48 UI僅變更全域門檻3倍，saved revision9→10，使綁定9的session因config_revision_mismatch停止留存並在13:30提前partial；不是資源不足。使用者要求1.5／2／3倍均盤中立即生效，已補原change規格與6項tasks，分離行情session與比較版本，不取消原安全Gate。

新增獨立有界`threshold-switch-controller.mjs`，只有同步durable ack後才切換；保留個別覆寫epoch、最後封閉分鐘靜默重判及通知去重。16項Node24與36項既有Vitest、tsc --noEmit／Vite build、strict／diff通過，只有原chunk大小警告。這不是實盤生效或完整修復：8.1／8.2完成，8.3–8.6及原7.2／7.4／7.6未完成，42／49。共用runtime／API／UI尚未接線，沒有重載或另建訂閱；受控載入確認尚待答覆。原失敗、113 trigger及原13:35採集不改判，詳見 [門檻切換及原收尾證據](acceptance/config-threshold-switch-2026-10-13.md)。

## 2026-10-13 09:20：同鍵證據出口補齊，仍待原生收據

09:05暫存查核已同步正式acceptance，未改任何原失敗。已在不屬Vite config相依的standalone盤後entry接上完成後同鍵no-op查核：重新驗160份manifest與原收據／claim，再實際走collector已完成重用分支，禁止新下載／reservation／repository寫入，保存獨立不可變證據及真實trigger／PID；不是另一個獨立排程，不人工倒補舊日。4項Node＋29項Vitest、型別／build／strict／diff及文字whitespace通過。原監控持續至09:19各160份、97結果累積量核對差異0，服務PID未變。既有Codex提示已同步今日進度且時點未改；今日13:35自然完成後的真正same-key-noop、新日曆自動保存、尾盤及13:40稽核仍須實證。40／43與7.2／7.4／7.6未勾不變，詳見 [當日驗收](acceptance/live-2026-10-13.md)。

## 2026-10-13：日曆接線修復與08:50原生啟動

使用者授權修正及受控5173載入後，已新增獨立daily官方日曆原文／hash快取與額度witness相容，解除舊v1包超過7日造成的盤前阻礙；原08:20／08:35／08:45失敗保留。今日官方來源修復另標operator-repair，08:50真正排程完成正式CAS、開盤前安全補建session並啟動唯一PID55603；160訂閱accepted及160前日基準complete。首筆KBar於09:01:02.551，09:03已核實09:01及09:02各160份來源observation、API／UI active160及fresh，73筆結果依實際分鐘對照成交量差異0；historical67與live6分列，歷史不通知。36項Vitest、13項Node、型別與build通過，詳見 [當日驗收](acceptance/live-2026-10-13.md)。不把早盤當作全日live完整；尾盤、新快取原生保存及同鍵no-op仍待實證，40／43暫不變。另保留08:51 React更新深度錯誤，尚未歸因，不宣稱console零error。

## 2026-10-12 18:01：已授權的一次 Web 重載與收尾語意實證

使用者允許一次盤後受控 5173 重載後，已接入原 summary 身分分類及 terminal 唯讀投影。Vite 僅一次 config 重載，8080／5174 PID 與 API generation 不變，原五份收據 hash 不變。真正 API／UI 已從誤標啟動失敗改為部分收尾、158／2、session 已收尾唯讀；94 筆結果保留、通知權關閉、10/13 基準 160 就緒，原 2449 5m 與狀態區收合已復原。正式工作區 25 項 Vitest、10 項 Node、型別／build／兩案 strict 通過；詳見 [受控重載驗收](acceptance/authorized-web-reload-2026-10-12.md)。不追認今日 live 完整，不提前結案。

## 2026-10-12 16:47：原生基準完整、自動tail及候選收尾分類

原同一13:35程序第二次嘗試於16:29:26 complete160／160，schema／manifest hash／日期逐檔驗證通過；原159／160失敗保留。原生自動tail收據與summary／collection hash一致，3665／6239末分鐘歷史增量140／684張，不回填live。中央321筆monitor-minute-v2 charged及真實跨日CAS成立，2.5及7.7依證據完成。API末分鐘partial誤標啟動失敗的純候選分類器10項通過，但gateway尚未接線，受控5173重載待使用者授權。詳見 [原生盤後驗收](acceptance/native-postclose-and-tail-2026-10-12.md)，其餘任務仍按缺口判定，不提前結案。

## 2026-10-12：連續兩檔尾盤缺口定位與來源gap候選修正

唯讀對照10/7、10/8、10/12原summary與逐檔SQLite，排除已設定RSS／磁碟／背壓門檻造成的本機拒收；10/12仍158／160，3665、6239的13:30事件未到reader。另確認reader原本忽略所有非KBar事件，已補來源 `kbar_gap` 的有界分類、來源dropped與unknown、hash-only樣本、健康事故及最後收尾partial保護；不重連健康socket、不覆寫舊資料。今天沒有保存來源gap原文且API log僅有hash，不能宣稱三日上游buffer丟包根因已證實。詳見 [調查與修正紀錄](acceptance/repeated-two-symbol-close-gap-2026-10-12.md)。原runner已結束，原13:35採集未動，新修正不追認今日成功。

## 2026-10-12：跨日盤前與盤中實證

原生 08:20 額度續轉 CAS 與 08:20／08:35／08:45 收據已核實；原 08:50 程序持續運作，160／160 活動，92 筆觸發量比獨立重算一致。7.3 完成，其餘全日收尾、原生盤後作業與完整結案證據仍待確認；不追認 10/7、10/8 partial。詳見 [當日驗收紀錄](acceptance/live-2026-10-12.md)。本輪僅唯讀查核與文件更新，不重啟服務或新增行情訂閱；聚焦回歸共 44 項通過。

## 2026-10-05：相依與來源盤點

此紀錄為候選程式實作與唯讀來源核對，不是新模式真實排程／盤中驗收。

### 常態相依清單

| 入口／元件 | 保留核心 | 日常取消或遷移 |
| --- | --- | --- |
| `premarket-orchestrator.mjs`、`late-boot-catchup.mjs` | 官方日期、同日 session、simulation、容量核准、generation、排他 claim | 已完成候選 daily-mode 分流，實際排程尚未切換；舊路徑維持原狀 |
| `bounded-kbar-transport.mjs`、`kbar-stream-adapter.mjs` | 一條有界來源、來源身分、逐檔連續性、封閉分鐘、13:30／13:33 收尾 | 不刪共享 parser／adapter／訂閱 ownership |
| `direct-160-product-runtime.mjs` | evaluator、SQLite observation／trigger、通知 Gate | 每日 Stage 審閱、`finishPendingReview` 與報告錯誤導致全部 failed 的耦合須分流 |
| `kbar-shadow-session-recorder.mjs` | legacy 診斷工具 | 日常不建立全日 `rowsBySymbol`／slots 副本 |
| `dynamic-daily-live-stage.mjs`、`dynamic-daily-execution.mjs` | plan／CAS／suppression／排他 registry、feature-off | shadow session、全日 evaluations／capture export 改為輕量持久化 |
| `collect-direct-160-baseline.py`、`build-direct-160-baseline.mjs` | v1 嚴格來源驗證、舊檔解析、診斷 | 日常改用新 schema、單次 K 與逐檔來源品質，不固定雙抓／全日 ticks |
| `postclose-daily-baseline.mjs` | 13:35、本機有界重試、原 claim／receipt、獨立來源採集 | 已完成候選 daily-mode 分流，不呼叫 capture-dependent tail review；實際排程尚未切換 |
| `audit-monitor-failures.mjs` | 真實失敗、原稽核與通知證據 | 日常不以 formalAcceptanceEvidence／capture 缺件判整日失敗 |

### 已保存真實來源

唯讀資料目錄：`/Users/alanyi/Library/Application Support/RealTimeStock/intraday-baselines/2026-10-05-direct160-source`。

- `source.json`：simulation、Shioaji HTTP 版本 `1.7.1`、來源交易日 `2026-10-05`。
- 160 檔：TSE 121、OTC 39；全部 270 列，首尾為當地時間 `09:01:00`／`13:30:00`。
- 原始欄位：datetime、Open、High、Low、Close、Volume、Amount；contract unit 1000、合約 update_date 為當日。
- 上市樣本 1303 有 7 個明確零量 row；上櫃樣本 1815 有 5 個明確零量 row。來源有明列零量，不須從缺列猜補零。
- 舊 v1 真實基準以相同日期全日 ticks 逐分鐘對帳，提供已保存的 end-minute mapping／common_lot 語意證據；新版仍要求明確版本化編碼，不自動接受未知來源。
- 此批沒有 13:33 真實樣本；延後收盤程式以回歸測試驗證，不能宣稱當日實盤觀察通過。
- 當日 ticks 已保存，可作唯讀總量核對證據；未核實的 Snapshot 全天量不能當 regular-session 總量。尚未實作新 downloader，未宣稱合約快取已正式接線。

### 新舊程式與測試

- 新增 `daily-minute-volume-baseline.mjs`、`daily-minute-volume-repository.mjs`；舊 verifier 僅匯出共用純正規化與 hash，未取消 v1 雙抓／總量要求。
- 新 repository 使用獨立資料庫契約；候選測試只在 mkdtemp 測試目錄讀寫，不碰正式基準 repository。
- 初版新版 21 項測試通過。首次誤以 Node test runner 執行兩個既有 Vitest 檔，產生 suite-context 錯誤；已改以 Node 24 啟動 Vitest 重跑，舊版兩檔 33 項通過。此為測試執行方式修正，不是忽略 failing test。
- 尚未修改已載入排程、重啟服務、新增 login／subscription、寫入正式 v2 基準或宣稱新模式 live。

### 真實已保存資料的唯讀逐檔重算

`acceptance/saved-source-audit-2026-10-05.json` 留存來源 manifest hash、舊基準 SHA-256、逐檔新舊 series hash 與對照結果。160／160 檔（43,200 個封閉分鐘）均與舊 verifier 及 SQLite observation 累積量一致；新舊差異 0、SQLite 差異 0。本輪新增網路請求 0，未發布正式 v2 manifest，亦未將此離線核對當作盤中或隔日驗收。v2 沒有獨立總量來源時，品質仍標示 `not_observed`。

## 2026-10-15：08:05盤前預檢（來源採樣08:09）

09:05增量查核詳見[今日驗收紀錄](acceptance/live-2026-10-15.md)：原08:20政策CAS及08:35／08:45完成，08:38 API換代由08:45原流程保存安全續接，08:50唯一owner PID84453正在running；其最終receipt尚待收尾。09:01–09:03各160份真實observation，09:05:22的09:04為154份仍推進、degraded0；已有95筆結果。既有頁面卻固定查10/14而顯示0筆，UI未通過；未取得完整門檻切換逐請求錨點，本輪沒有操作門檻或重載。啟動門檻applied不能代替8.6，維持46／49，7.4／7.6／8.6未勾；API退出觸發者仍未確認，不以目前健康冒稱永久修復。

[今日原始查核紀錄](acceptance/live-2026-10-15.md)確認官方本機日曆10/15共同預排交易日／前日10/14，160份v2均重驗hash／schema／日期／固定cohort且無來源衝突。真實raw usage由昨晚7,110,566降至248,228 bytes，同帳戶HMAC及524,288,000上限一致；300MiB池不變，純函式320請求窗口試算headroom91,961,052。simulation business session／2330／三服務listener可用，production stopped／write disabled，無active owner或reservation，原charged325保留。正式policy仍10/14且前後不變；Codex未執行prepare／commit、啟動下載或代跑本機排程。08:20原生CAS、08:50唯一runner、09:05真實封閉分鐘與盤中切換、全日收尾尚待真正執行，7.4／7.6／8.6不勾。昨日API退出觸發根因、長駐頁面日期及React故障仍分列未解，不以健康預檢宣稱永久修復。

## 2026-10-14：原生驗收已啟動，但早盤串流換代失敗

最新實證見 [10/14 真實驗收](acceptance/live-2026-10-14.md)。08:20／08:35／08:45 原生步驟完成，08:20 真正 CAS 與 08:45 零資料 generation 恢復均保留；08:50 原 owner PID 34931 自然初始化門檻 journal 並取得訂閱接受，不能因此宣稱收到行情。

API lifecycle log 09:00:57.514 原程序退出、09:00:57.637 重啟；原 reader 09:00:57.551 斷線，恢復因 generation 不同拒絕。09:01:06 原程序提前 partial，160 檔均未保存任何 observation，13:40 原稽核確認 partial；沒有資源不足證據。觸發後端 lifecycle 的操作者／原因未在脫敏 log 保存，不猜測，也不放寬 Gate 重播成成功。

本輪只做已授權的一次 08:51:47 既有 5173 分頁重載；沒有盤中門檻切換。15:13 UI 後續門檻修改晚於故障，現有 1.5 倍及名單不覆寫。15:15 起為事後唯讀查核，不倒填 09:05／14:05；7.4／7.6／8.6 均保持未完成，現行 46/49。跨日修復 59/61 的未完成任務也不由這份失敗證據勾選。

原生盤後 PID 46363 獨立採集 10/14→10/15，原 attempt-01 partial 與同程序自然 attempt-02 保留；15:15 是 85/160 collecting，尚未具完整收據。未中止／重跑／提高速率／變更保護池。長駐分頁載入日固定於 10/13 的缺口已定位，重載只能恢復當日查詢，不等於永久跨日修正；React 更新深度根因與原圖表復原仍分列未知，不宣稱全頁零錯誤。

本輪兩案 strict validation、git diff --check 與新增文字 whitespace 通過；沒有新程式變更，因此不重複完整 build／回歸，不 archive／commit／push。

## 四個 active changes 的遷移矩陣

10/15 16:47結案增量：本案以新授權「最多10檔、僅13:30」政策取得日常產品例外通過，三筆完整盤後補算及正式245結果／API／UI成立；原live157／160與13:40失敗不改。此證據完成本案7.4／9.6，dossier包含政策、原始來源、原生基準、比較版本、資源／網路限制及前後不變證據。下表四案各自的啟用／真實晚開機／動態名單／完整Stage等原始任務仍維持其語意，不因本案結案自動完成。

10/15增量：本案8.6盤中切換與長駐分頁日期修正已驗證，原owner持續留存；不會因此替跨日change尚待的完整全日dossier、動態名單feature-off、晚開機真實啟動或歷史尾棒partial勾通過。各案保留原矩陣邊界，本案僅剩7.4／7.6。

### 10/14 盤後重開機中斷的有界補件接續

**完成更新：** operator PID6215於10/14台北18:16:00.952真正補齊63份，完成收據160／160、126請求／1,008,966 response bytes；18:20獨立重驗160份schema／hash／官方source10/14→target10/15／43,200封閉分鐘、TSE121／OTC39及原97份hash不變，來源日conflict0。原native attempt02無完成receipt仍保留，不追認scheduled或當日live成功；獨立總量仍not_observed160。300MiB池不變，原charged198加新126為324，無active reservation；另保存18:20真正raw provider錨點，供翌日原生CAS核對。詳細完成hash及品質見下列補件證據。主change仍46／49，剩7.4／7.6／8.6，恢復原每日四個驗收查核點，不歸檔／commit／push。

**此前17:14查核（保留當時狀態）：** 使用者另明確授權補齊63檔。原生13:35第二次程序於15:28:09主機重開機中斷，97份已驗證、無完成receipt；保留全部原件。獨立operator補件第一次因同日rawusage回退而零下載partial，原15分鐘冷卻後第二次PID6215於17:13:56開始，17:14正式repository98／160。以同epoch不可變carry加raw usage作保守上界，保持原scope／帳戶／上限／原charged-quarantined、300MiB池、兩請求／分鐘、126請求上限及18:30期限；不以重新登入或清帳冒充重置。詳細原始位置、候選52項回歸與型別／build／strict／diff見 [重開機補件證據](acceptance/interruption-recovery-2026-10-14.md)。當時尚無160完整收據，不稱明日基準完成，不勾7.4／7.6／8.6；成功亦不追認原生或當日live。

| change／既有未完成任務 | 保留與遷移 | 被取代部分／狀態 |
| --- | --- | --- |
| 跨日修復 7.4 | 官方日期、真實 scheduler、session／generation、逐檔 data plane／freshness | 改以 daily 資料證據，不要求新全日 capture；原 failed 保留 |
| 跨日修復 7.5 | 次交易日自動 session、首筆來源、同分鐘、results／通知 Gate | 遷移至本案 7.3，不因取消 Stage 報告直接勾通過 |
| 跨日修復 7.6 | 跨日證據、partial／failed／unknown、UI/API 誠實性 | 原完整 Stage capture／雙 replay 作日常必要條件為 superseded-by-design；dossier 本身仍須實證 |
| 跨日修復 7.7 | 真實 baseline 排程、原用量、日期與 generation | v1 固定雙抓／ticks 日常契約由 v2 取代；原 160 資格與容量不改 |
| 動態名單 5.3 | 明確啟用、plan／CAS／suppression、逐檔來源、單 owner、通知 Gate | daily runner 接線／實盤尚未完成，feature-off 保留 |
| 晚開機 4.4 | 真實晚登入、單次接續、session、首筆來源、安全時窗 | 原 canary 診斷不再作日常全批資格；真實晚開機證據仍未完成 |
| 尾端復原 5.3 | 原工具、來源／live provenance 分離、全部失敗與診斷檔 | 日常自動補成 capture 與 formal acceptance 為 superseded-by-design；不是原任務 passed，不自行歸檔 |

本矩陣只記錄新案的遷移安排；未修改其他四案 checkbox 或刪除歷史證據。

10/13補充：本案7.2已由當日原生完整基準與同程序same-key-noop成立，但跨日修復／動態名單／晚開機／尾端復原的原checkbox均未因本證據自動完成。門檻切換候選接線也不代替四案各自的live Gate；10/13全日partial保留。

## 2026-10-05：候選日常路徑接線與收盤後回歸

以下均為程式及隔離測試證據，不是當日正式排程、真實盤中或跨交易日驗收。

- 新版 13:35 入口在 `daily` mode 使用獨立採集器；每檔先重用相同日期／來源版本的不可變 v2 manifest，缺件才查一次分鐘 K。合約查詢成功但 KBar 失敗時，下一輪可重用同商品、同日期、同來源版本、同 API generation 的精簡合約快取；不同版本或 generation 另存且不得誤沿用。請求仍逐筆經共用保守額度 admission，限流只等待帳本核准的時間，不自行提高速率。來源回應逾時以未知 bytes 結算，不能當作 0 bytes。
- 新版 08:50 與晚開機候選入口共用排他 claim、單一 bounded KBar transport、逐檔 adapter、SQLite observation／trigger sink；未引用全日 shadow recorder、Stage builder 或整日 replay。收尾候選在 13:30:15 進入 closing，13:34:30 才 final seal；無新 KBar 的合法收盤集合競價不人工改寫來源時間。13:40 候選稽核讀小型收尾摘要，盤後基準另列 `collecting`／完成／partial／unknown；採集 claim 過最晚 19:00 仍無收據時，API 不再無限顯示「採集中」。
- 前端與 API 已增加 daily-mode 候選投影，把背景資料活動和可見圖表／頁面 lease 分開；收尾後結果僅供唯讀，不延續通知權限。舊模式仍維持原投影。尚未以真實瀏覽器及當日 live 網路事件驗證此候選。
- Node 24 下 12 個聚焦測試檔共 68 項通過；`pnpm run build` 的 TypeScript 與 Vite 均通過，僅原有大 bundle 警告；OpenSpec strict validation 通過；`git diff --check` 通過。另一次隔離環境的 API 測試因本機 loopback `listen EPERM` 無法啟動，於允許的本機環境重跑 17／17 通過；前一次錯誤不冒充產品失敗或測試通過。

### 尚未解決的結案阻礙

1. 新 runner 遇真正 SSE 中斷會安全標記 partial，但還沒有完成「同一 owner、同一來源身分、驗證來源重疊後有界補缺，historical prefix 不追溯通知」；這項尚未勾選，`daily` mode 不可啟用。
2. 動態 daily plan 還未接到同一輕量 runner；正式 feature-off 保留。13:40 稽核與 API 雖能投影摘要，尚未以真實排程證明正確性。
3. 盤後日曆入口目前以年度預定表判定；臨時因颱風等休市仍需官方公告證據與下一適用交易日判定，不得把預定交易日當實際交易日。尚未校準 v2 實際共享額度／資源預算，也未量得新舊路徑 provider usage 差異。
4. 未建立或啟用正式 `daily-runtime-mode.json`，未重啟共用服務、未增加 broker login／subscription、未改原 failed 收據。真正 13:35 自動 v2 基準、下一適用交易日盤中比較、全日收尾及 API/UI 實證仍須未來真實排程完成，不能以 10/5 離線資料或本輪測試代替。

## 2026-10-05：資源保護與 13:40 稽核候選補強

此段只記錄程式與隔離回歸，並非真實盤中故障或收尾驗收。

- daily runner 在啟動時記錄可用磁碟空間，運作期間依可設定的 1–60 秒取樣間隔檢查保留空間；無法取得可信空間或跌破保留值即停止後續新事件的判定，已提交的 SQLite observation 不回滾。RSS 與事件處理背壓仍設上限；故障收據記錄首次觀測時間、全體受影響範圍、實際磁碟取樣、process CPU delta、RSS、處理延遲及資料庫主檔／WAL／SHM 大小。CPU 是執行程序層級的區間量測，不宣稱為券商用量或精確單一商品成本。
- `daily-runtime-mode.json` 可選擇設定上述 runtime 限制；未配置時沿用保守預設。輸入超界拒絕，不因切換模式取消資源 Gate。隔離測試證明磁碟故障及背壓發生後不新增 observation；背壓發生當筆若已寫入，回傳仍忠實標示該筆已接受。故意製造摘要同名衝突時，原檔不覆寫、sidecar 分列 `summary_write_failed`，SQLite 先前 observation 可讀。據此勾選 3.6；磁碟清理沒有自動執行，舊資料與失敗證據不刪除。
- 13:40 稽核候選現在核對同日摘要 schema、預期／實際逐檔覆蓋、收尾與退訂收據、資源故障、串流中斷、摘要寫入失敗及 shared registry owner lock，並把下一日基準 `collecting` 獨立呈現。owner lock 只能證明 ownership 殘留，不能單憑檔案證明 OS 程序仍活著；缺摘要或身份不完整維持 unknown 並通知，不能報正常。4.5 尚未勾選，仍須補真實程序生命週期／排程證據。
- 聚焦 11 檔 67 項測試通過；TypeScript／Vite build 通過（保留原大 chunk 警告）；`openspec validate --strict` 通過。本輪沒有啟用 daily、重啟共用服務、建立 broker login／訂閱、修改正式收據或觸發真實交易。斷線後有界重連及驗證式 gap repair 仍未完成，因此不得切換正式模式。
- 版本化 API 新增逐檔 live coverage、水位、串流中斷及資源故障投影；`ended` 必須有一致的逐檔 270 分鐘、最後 13:30、水位數量及零故障，否則退回 unknown，不因舊 client 缺欄位或錯誤 count 冒稱完成。client 型別同步；面板把執行模式移到小標題，保留 13 個指標高度，逐檔水位預設收起。據此勾選 5.1；5.2／5.3 尚待逐檔 v2 品質、完整狀態與實際 UI 操作驗證。
- API 測試隔離環境初次出現 `listen EPERM 127.0.0.1`，改於允許本機 loopback 的測試環境後 17／17 通過；瀏覽器測試初次誤用非 browser config、第二次遇 `listen EPERM ::1`，改正後發現原「13 欄／170px」舊斷言：新增模式欄造成 14 欄、176.5px。以小標題承載模式並恢復 13 欄後，Chromium 16／16 通過。這些失敗及修正不能當作真實盤中 UI 驗收。

## 2026-10-05：斷線與缺分鐘有界修復候選

- daily adapter 首筆若晚於 09:01，不再先寫入未核實的 partial live row；單檔缺分鐘與 SSE 中斷都維持隔離。既有 diagnostic adapter 的晚首筆語意不變。
- 真正實體 SSE 結束後，同一 owner／generation／cohort 至多重開一次，先確認舊 reader 已結束，重新核對 simulation 與來源版本、退訂原 cohort，再建立一條新 SSE 並重訂原 cohort；若任一步失敗，保持 partial，不開第二次 broker login 或另一條並行串流。重連本身不恢復比較權限。
- 僅在觀察到缺口時，每商品至多一次雙次 REST 驗證，整體同時最多兩檔；核對 REST 穩定、從 09:01 的分鐘連續性、原 live 水位及新 live overlap。成功只把缺件寫成 `shioaji-kbars-bootstrap`，不送進即時 trigger ledger、資料活動時鐘或通知；下一個真正 live 封閉分鐘才恢復比較。來源不符、排程窗口結束或補缺仍追不上現行分鐘時維持 partial。收尾即使 270 筆含歷史補件，也不稱作完整 live 覆蓋。
- 聚焦 4 檔 34 項測試通過，涵蓋首筆晚到、真正 SSE 關閉後新 reader、同世代重疊、逐檔隔離、零追溯 trigger 與 legacy recovery 原語意。這是隔離測試，不是今日真實 SSE 斷線驗收；新路徑尚未啟用。

## 2026-10-05：13:40 程序與盤後採集稽核候選

- 新 daily claim 與盤後採集 claim 均記錄實際啟動程序 PID。稽核只在同日 shared registry 的 active lock 與 immutable claim 相符時，才檢查監控程序是否仍在運作；舊 claim 沒有 PID 仍列 `unverified`，不把鎖檔當成程序存活證明，也不刪改舊檔。PID 活著僅是當下程序存在的診斷證據，不能單獨證明全日資料完整。
- 13:40 的日常摘要繼續核對 schema、cohort 數量、逐檔水位、關閉／退訂、stream 故障、資源故障及 summary-write sidecar；缺摘要時區分程序仍執行、已退出但鎖殘留與身分未證實。盤後基準只有 claim、沒有 receipt 時，僅在程序仍存活且未逾設定 deadline 才顯示 `collecting`；程序退出或逾時列為失敗，舊 claim 無 PID 列 unknown。13:35 正常有界採集不因尚無完成收據誤報。
- 3 個聚焦測試檔在 Node 24 執行 17／17 通過；第一次用預設 Node 26 測試時，只有既有 plist 節點版本限制斷言失敗，改用正式要求的 Node 24 後全通過。這只證明候選稽核邏輯，仍未啟用新模式或執行 13:40 真實排程；原先驗證紀錄中「4.5 尚未勾選」是當時狀態，不回寫歷史段落。

## 2026-10-05：收尾結果與資料品質狀態候選

- daily 收尾後即使 session 不再 current，狀態標籤仍優先顯示完整收尾、部分收尾或摘要寫入失敗；不誤說「今日未啟動」。完成收據的 `ready`／`partial`、有界採集中的 `collecting`、程序退出或超過 deadline 的 `failed`，以及舊 claim 缺少程序身分的 `unknown` 分開投影。API 的盤後 claim 投影也核對 PID，而非只因 claim 檔存在就顯示採集中。
- 摘要寫入失敗時，已提交 SQLite trigger 仍可作唯讀歷史查詢，權限不回復即時通知。收尾後的即時觸發標示為「收尾保留」，與真正歷史重播分開；量比標為「最後有效量比」，不冒稱仍在即時更新。
- 本機 loopback API 聚焦 17／17 通過，view-model 與 13:40 稽核聚焦 12／12 通過，TypeScript 檢查通過。第一次在受限 sandbox 跑 API 測試有 `listen EPERM 127.0.0.1`；允許本機 loopback 後重跑，先發現測試中過早切換 `failed` 狀態導致原歷史查詢預期失敗，已修正測試順序並補 `failed` 結果保留檢查，再重跑全通過。這是候選程式回歸，6.4 的真實大小 UI／API 與既有圖表保護仍未完成。

## 2026-10-05：動態 daily plan 接入輕量 runner 候選

- 明確啟用的動態路徑只有在 `daily` mode、保存的 active plan 與 08:45 final／baseline Gate 身分一致時，才使用共用輕量 runner；未啟用仍於讀檔、claim、訂閱前返回 `feature_off`。`legacy` mode 仍保持原執行分支，不改當日既有 owner。
- runner 的訂閱商品取自封存 plan，不以當前設定重排或補位；門檻與 revision 取封存 plan。逐檔 v1／v2 基準、來源 hash、日期／市場與 Gate 逐項核對。部分就緒時缺基準商品仍占原名額、保留真實 observation，但不得比較或通知；其餘合法商品照常比較。讀取持久 suppression 失敗時結果投影 fail-closed，不偽造可比較商品。
- 新分支保存動態狀態、SQLite-backed 小型收尾 receipt 與 shared owner cleanup；不建立 `capture.json`／`evaluations.json`，不呼叫 shadow Stage。動態狀態持續列出訂閱、data-active 與已保存觸發；所有通知權限仍為 false，不能把此候選當作實盤通知已驗證。原有固定 160 容量核准與共用排他 registry 未更動。
- Node 24 下動態執行、共用 runner、sink 與 workflow inputs 聚焦 18／18 通過；額外檢查動態狀態可被產品投影讀取、legacy Stage 呼叫數為零。這些是隔離測試，不代表動態名單已啟用或 08:50 真正排程已成功。動態實盤與 mode 切換仍列於第 7 節，不能提前結案。

## 2026-10-05：v2 基準品質面板候選

- 每日模式從 v2 repository 唯讀統計前日逐檔 manifest 的「已保存、缺漏、未知」，並將獨立收盤總量核對分成 `matched` 與 `not_observed`。資料庫不存在時不建立檔案、不填零冒充核對成功；查詢或 schema 異常仍顯示未證實。歷史 v1 基準明示為唯讀，不當作今日 v2 資格。
- 面板的來源品質與選用診斷預設收合，明列「270 分鐘完整不等於獨立總量已對帳」。唯讀品質測試與本機 API 17／17 通過，Chromium 面板回歸 17／17 通過。首次瀏覽器回歸有兩項舊文字斷言仍預期「即時／歷史」兩類；現行設計已加入「收尾保留」第三類，已更新斷言並重跑全通過。這是 fixture UI 回歸，不代替真正 API／交易日的前日 manifest 品質驗收。

## 2026-10-05：來源、排他與訂閱交界回歸

- v2 來源測試新增官方臨時休市、09:00 非封閉分鐘、未宣告的 13:33 與宣告卻缺少的 13:33 拒絕案例；原有未知單位／編碼、270 分鐘、known-zero、總量衝突、不可變 manifest、v1／v2 身分隔離持續通過。`daily-minute-volume-baseline.test.mjs` 26／26 通過。
- daily runner、來源採集、排程、晚開機、動態執行、共用排他 registry 與稽核的 8 檔 51／51、6 檔 40／40 聚焦測試通過。共用 registry 會拒絕 Stage 與 daily 同時擁有 owner，釋放後同一 generation 仍不可重用；正式 `daily-runtime-mode.json` 不存在，故原 legacy 程序及歷史容量核准未被切換或改寫。上述為隔離／唯讀檢查，不是新模式真實盤中驗收。
- 修正訂閱成功回應與 runner 標記控制面之間的短暫時序：bounded transport 在確認單一 batch 訂閱已接受後、回傳 `start()` 前呼叫控制面回調；回調拒絕則清理 reader 並失敗，不讓來源事件在控制面尚未標記時被當成正常比較。保留注入測試 transport 的啟動後 fallback。transport、runner、動態執行聚焦 19／19 通過；仍需真實來源事件才能完成 7.3。
- 唯讀計算 10/5 已保存舊路徑的 160 份第一輪 K 檔約 2,795,106 bytes、單檔最大 19,435 bytes；160 份合約檔約 132,132 bytes。這是重新序列化後的**本機檔案大小**，不是新模式實際 HTTP response bytes 或券商 quota 扣量；不可據此宣稱 2.5 的新 profile 已校準。舊路徑的 10/5→10/6 v1 基準集含 160 份，但不冒充明日 v2 自動排程成功。
- 補強收尾後動態名單的唯讀狀態：`complete`／`partial`／`failed` 不因超過兩分鐘未有 heartbeat 轉成 `stale`；已保存觸發可讀，但 `dataActive=0`、比較與通知權限均關閉。最初動態執行測試仍預期兩分鐘後 `stale` 而失敗，已更新為收尾只讀語意，重跑狀態與執行測試 8／8 通過。
- Chromium 以 160 檔等量 fixture 驗證面板可呈現、聚焦、排序及 K 線連動；本輪面板、K 線完整性、成交明細共 31／31 通過。本機 API、view-model、分價量表與資金流向共 48／48 通過。這證明回歸及 UI 負載，不是今日真實 daily runner 的網路請求或券商訂閱數；7.3／7.5 仍需下一交易日實測。
- 08:50、晚開機、13:35 與動態 plan 在 `daily` 分支的測試分別核對只呼叫輕量 runner／採集器；動態測試以 Stage spy 確認零次呼叫，無全日 capture／evaluations 檔。舊 Stage、capture、tail recovery 仍保留在明確選擇的 legacy／diagnostic 分支供既有回復與稽核，不再是 daily 常態必經步驟；不能因模式候選通過就刪除舊證據。
- 最終候選聚焦 17 檔 133／133、Chromium 3 檔 31／31、API／view-model／分價量表／資金流向 4 檔 48／48 通過。Node 24 的 TypeScript build、Vite build 通過，只有既有大 chunk 警告；OpenSpec strict validation、`git diff --check` 及本案新增文字檔尾隨空白檢查通過。以上不包含尚未發生的 daily 自動盤後基準、下一交易日來源事件或全日收尾，故第 7 節仍未勾選。

## 2026-10-05 19:24：中央額度接線與正式切換前阻礙

- daily 盤後採集仍使用既有持久保守帳本的每筆 `reserve`／`start`／`settle`，沒有自行取得額度或下載。新增僅供 daily port 啟用的最多 5 秒 usage 觀察快取；每次先驗政策及本機 simulation／API generation，政策身分、quota epoch、generation 或有效期變更即重查。快取命中仍逐筆進行原子保留；失敗不留快取。一般選股 port 預設 `usageCacheMs=0`，原行為不變。Vitest 3／3 及 MultiView 的 Node 測試 11／11 通過，涵蓋相同身分合併、generation 換代、production 拒絕及 reserve／settle 實際 usage 次數。
- 唯讀讀取現行 MultiView 本機 D1 主檔的 immutable 視圖：政策為 verified v3、有效至 `2026-10-10T15:59:59Z`，quote 保護池 314,572,800 bytes、舊盤後基準最低保留 85,667,193 bytes、速率每 60 秒最多兩筆；已入帳且未釋放的 charged estimates 合計 65,362,668 bytes。這個主檔快照的檔案修改時間為 19:17，可能不含稍後寫入；不以它宣稱即時資料庫事務快照。19:21 既有 simulation API 唯讀 `/auth/usage` 顯示剩餘 452,733,348 bytes；這個觀察與主檔不是原子同步。以這兩個錨點估算，扣除既有三項保留為負 12,869,313 bytes，中央 admission 應安全拒絕新的第一筆，而非強行採集。
- 現行兩筆政策樣本的最大 usage 增量為 244,804 bytes，乘以 1.5 得每請求保守估量 367,206 bytes。若當日 160 檔都需重新查合約及單次 K，共至多 320 請求，保守預留上界 117,505,920 bytes；這是依**舊樣本**作的容量情境，不是新版 provider usage 實測或精確花費。160 份已保存舊合約不符合新來源日期，不能當作翌日全數可重用。既有政策之下，7.1 切換後 13:35 的 v2 基準會被額度 Gate 擋下，故本輪沒有建立 `daily-runtime-mode.json`、沒有新 claim／下載／broker 訂閱，也沒有改變 300 MiB 保護池或舊收據。
- 已向使用者提出有界政策調整選項；在得到明確選擇、核對當時真實額度與正確去重保留方式之前，不把推估當成已校準的新 profile，不勾 2.5 或 7.1。即使獲准調整，仍必須保留中央逐請求 admission、舊 charged／quarantined、失敗收據及全部保護 Gate；正式新舊路徑用量差與資源差仍待 7.5 真實量測。

## 2026-10-05 19:40：保護額度承接候選（尚未正式啟用）

- `stock-screener-runtime-budget-producer` 增加明確的新政策模式 `daily-baseline-allocation-v1`。只有政策選定此模式、且私有 daily mode 設定驗證通過時，才以帳本中 `monitor-minute-v2:` 已送出且仍保留的 `dispatched`／`charged`／`quarantined` 估量，抵扣原盤後基準配置；尚未送出的 `reserved` 不抵扣，其他工作也不抵扣。抵扣最多至原配置額度歸零；新估量仍由共用帳本獨立保留，不刪除舊債。舊 `baseline-protected-allocation-v1` 的來源證據 hash 內容維持原狀。三項本機隔離測試通過，覆蓋舊模式不變、未送出不抵扣、分段承接與歸零。
- 這只是實作候選；現行正式政策仍是舊模式且 private daily mode 檔不存在。政策修訂、保護池數額、正式請求及 v2 實測均尚未發生；不得把此隔離測試當成 2.5 或 7.1 完成。正式修訂前須取得使用者對降低其他用途保護池的明確回覆，再以真實最新 usage／帳本重新核算並保存版本化授權與前後證據。
- 查出另一個長時採集競爭：政策每 60 秒最多兩筆，320 筆最少約 160 分鐘；若 13:35 工作仍在採集，14:15／14:55 的既有補跑不應再對相同 attempt 使用 `wx` 建 claim。已補候選同日 claim／receipt／generation／target 日期與 PID 稽核：原程序仍在期限內時回報 `daily_collection_in_progress`，原程序退出或過期但缺 receipt 則回報 `daily_collection_claim_without_receipt`，兩者都不建立第二份下載、不刪原 claim。Node 24 的盤後入口 18／18 回歸通過；第一次誤用預設 Node 26 時僅兩項既有 LaunchAgent Node 24 限制斷言失敗，換正式 Node 24 後全通過。仍須用真正本機排程證實長時採集與補跑的實際交會情況。
- 原 13:35 程序在單次部分成功後，會在自身的有界 `maxAttempts`、冷卻與截止時刻內只補缺件；不依賴已早於首輪完成的 14:15／14:55 才有第二次機會。補跑若碰到前輪收據未到冷卻期，回報 `daily_collection_retry_cooldown`；恰在冷卻邊界與原程序競爭時，仍以排他 claim 決定唯一 owner，敗方只回報進度。Node 24 的相關 2 檔 23／23 回歸通過。這是排程競爭的程式候選驗證；尚未觀察真正長時 13:35 執行，不勾 7.2。
- 新增日常操作 runbook，明列 mode-off、中央額度、原／後續排程、單一 owner、來源品質、延後撮合與真實驗收準則。相關 Node 24 聚焦 13 檔 102／102、TypeScript 專案檢查與 Vite build 通過；僅有既有大 chunk 警告。本輪仍未達成正式額度政策調整或真實切換，因此 2.5／7.1–7.6 保持未勾，不把 runbook 草案當成 7.6 完成。

## 2026-10-05 20:05：保護池維持 300 MiB 與跨日額度證據

- 使用者明確要求**不縮小**原 300 MiB quote 保護池；先前「等待是否調低保護池」的建議不再適用。未修改正式政策、模式檔或中央帳本。
- [Shioaji 官方流量說明](https://sinotrade.github.io/zh/tutor/limit/)記載日流量在交易日 08:00 重設。這是來源規則，**不是**本帳戶 10/6 真正已重設的證據；本機 v3 高水位也不會自動因換日清除。若不補可驗證的新週期機制，保守累計最終會永久占滿額度，即使當日券商實際可用額度已恢復。
- 新增不具授權能力的 `broker-daily-reset-witness/1` 純函式：同時檢查 TWSE／TPEx 官方共同交易日證據、08:00 前後的同一帳戶 hash、相同額度上限、實際來源計數下降與時間窗口；只回傳候選 hash，`authorizesAdmission=false`。日期推斷、帳戶變更、額度變更、未下降及跨錯誤時窗皆不能認定。Node 測試 3／3 通過。這**不是** 2.5 完成：尚無正式帳戶來源錨點、實際跨日觀察、版本化政策／reservation 週期遷移，也沒有新模式下載。
- 為避免短帳號可由無鹽 SHA-256 反推，帳戶身分改由本機私密 32-byte HMAC key 計算。只保存 hash，不保存 API 回傳帳號。唯讀觀察器會核對 simulation mode／generation、API info／health、帳戶與 `/auth/usage`，用 `wx` 在 `Application Support/RealTimeStock/IntradayMonitor/broker-quota-reset-observations/` 留下私密不可覆寫原始計數錨點，並明示無 admission 權限。2026-10-05 20:11:46 Asia/Taipei 已於既有 session 保存重設前錨點，證據 hash `787040173a28b468af7c6496ea3149e81cdc506b9f15502531473b38895fce7a`；本機 HMAC key 權限 0600、收據目錄 0700。未輸出或寫入原始帳號／金鑰。帳戶、候選及觀察器聚焦 7／7 通過。明日仍須官方交易日及真正 08:00 後新計數，不能提前宣稱重設。
- 後續程式候選加入私密收據讀回驗 hash、正式盤前雙市場日曆與原檔 hash 的 witness 組裝，以及 `local-verified-daily-reset-v1` 新週期計帳。新版共用 admission 只會在正式 v4 政策、持久 witness/head、同一帳戶 HMAC 及本週期單調計數均合法時採用當期額度；v3 原有全歷史保守計法不變。隔離測試證實跨週期 charged 仍保存但不被當成新日已耗額；帳戶換掉、計數倒退或 witness 缺件均拒絕。
- 版本化遷移候選維持 quote 保護池 **314,572,800 bytes**，先以 160 合約加 160 KBar 共 320 筆保守估量做全窗口預檢。隔離交易測試驗證舊政策、舊承諾及舊 charged 原件保留，新 witness／head／承諾與 v4 政策 CAS 寫入；未足額、已過期或仍有 active reservation 則拒絕。政策遷移器尚未對真實資料執行；目前正式政策仍 v3、沒有 `daily-runtime-mode.json`。真實 08:00 後來源計數、正式遷移與排程下載均待下個適用交易日，故 2.5／7.1–7.6 繼續未完成，不能把隔離測試當結案。

## 2026-10-05 20:45：跨日政策啟用入口的二次核對

- 新增雙階段 `prepareBrokerDailyResetActivation`／`commitBrokerDailyResetActivation`。準備階段以既有 simulation session、正式雙市場日曆、已保存的 08:00 前後同帳戶來源計數、現行 v3 政策與受保護工作承諾，計算完整 320 請求容量；會在既有 append-only 帳本刷新當下工作承諾並保存新的來源觀察收據，**不更改額度政策、模式或放行下載**。寫入前再次從私密收據與日曆原檔建立相同 witness，重查帳戶 HMAC、simulation generation、mode 與 active owner，變動即拒絕。持久化器另以原政策／承諾 CAS、無 active reservation 及資料庫交易保障舊 charged／失敗／政策原件不覆寫。
- 隔離測試新增四項：準備不改額度政策且 **314,572,800 bytes 保護池不變**、帳戶或官方證據改變、generation 或 owner 改變、全窗口預算不足均正確拒絕。測試中的工作承諾刷新為注入的 no-op，不用它宣稱真實準備零寫入。相關 Node 9 檔 31／31、Vitest 1 檔 3／3 通過；TypeScript／Vite build 通過（仍有既有大 chunk 警告），OpenSpec strict validation 通過。首次將 Vitest 檔誤放入 `node --test` 得到 runner 錯誤，已改用正式 Vitest 重跑，這不是產品失敗。
- 這是**候選程式驗證**，不是 10/6 真實重設、政策遷移、模式切換或盤後基準驗收。現行 300 MiB 保護池與 v3 政策均未調整，2.5 及 7.1–7.6 保持未完成；即使明日來源證據足夠，也須先複核所有安全 Gate，不能用今日隔離 fixture 冒充正式收據。

## 2026-10-05 21:25：後續交易日的額度週期續轉

- 發現原候選只涵蓋 v3→v4 首次轉換；若往後交易日已有 v4，仍會因僅允許 `legacy` mode 與首次空 reset head 而無法建立新週期。已擴充雙階段入口與持久遷移器，讓 `daily` mode 的 v4 政策可在**下一**適用交易日重新核對來源、帳戶、官方日期、完整 320 筆預算及無 active owner／reservation 後，以 CAS 續轉 v4。新 identity 串接前一日 identity hash；前一日完整 head、政策與工作承諾留下不可變封存或收據，舊 charged 與失敗紀錄不清除。前一日 head 須經保存的 witness 與 hash 再驗證，不能只相信呼叫端傳入的身分物件。
- 隔離測試新增 v4→v4 成功及同日拒絕，並經完整雙階段入口驗證 `daily` mode 續轉。原首次轉換與拒絕案例維持通過；相關 MultiView Node 60／60、Vitest 3／3、TypeScript／Vite build、OpenSpec strict validation 與 `git diff --check` 通過。build 仍有既有大 chunk 警告。測試中的下一日來源、日曆、帳戶及計數均為 fixture，**不是**正式 10/6 或 10/7 觀察；未改 live 模式或額度政策，300 MiB（314,572,800 bytes）保護池未縮減。
- 2.5 尚待真正來源計數、當日正式 v4 policy 與新模式請求的共享用量校準；7.1–7.6 尚待真實安全切換、排程、跨日盤中、全日收尾及資源比較。今晚不可用隔離回歸取代以上實證，原失敗／partial 證據均保留。

## 2026-10-05 21:55：使用者授權正式切換後的實際預檢

使用者已授權在有助於結案且安全 Gate 完整時切換 daily 模式或調整現行服務；這不等於授權偽造券商重置、縮小 300 MiB 保護池或跳過 simulation／排他檢查。實際來源與政策、160 檔前日基準、服務及排程 next-run 證據見 `acceptance/pre-reset-preflight-2026-10-05.md`。當時仍是 10/5 晚間，來源用量比 20:11 的同日錨點增加，並未跨 08:00；即使不扣舊 charged，舊週期完整 320 請求預算仍不足。故**不以重啟服務或提前寫入 daily mode 充當 7.1 成功**；明日真實來源重置與政策 CAS 成立後才允許轉換，未完成任務保持未勾。

## 2026-10-06 08:20：正式額度週期與 daily 模式啟用

- 真正的 08:00 後來源計數下降、相同帳戶範圍 HMAC／上限、雙市場交易日、160 檔前日基準與完整保守窗口成立後，雙階段 CAS 已將 v3 政策遷移至 verified v4；保留原 charged／failed，300 MiB quote 保護池未縮小。無 active owner 時獨佔建立私有 0600 daily mode 設定，正式讀回為 `daily`，共用服務未重啟。
- 首次 `commit` 實際遇到 `broker_daily_migration_source_changed`：prepare 與 commit 重新建 witness 時 `observedAt` 隨真實時鐘改變，導致同源也不同 hash。修正為用 prepare 時刻重驗同一 witness，另外拒絕逾 60 秒的舊見證。新真實時鐘回歸及拒絕案例通過；失敗原件與後續成功分列，不抹除首次失敗。
- 今日真正 08:20 本機排程原始 claim／receipt 顯示 `session_created`、`brokerWriteAuthority=false`。但 08:35／08:45／08:50 尚待其自身收據，未將 session 建立冒充 daily runner 或盤中結果。逐項來源、時間、預算與收據摘要見 `acceptance/live-2026-10-06.md`。
- 相關 Node 測試 9／9、daily mode Vitest 3／3、OpenSpec strict validation、`git diff --check` 及本案新增文字尾隨空白檢查通過。一次誤以 Node test runner 執行 Vitest 檔、以及受限環境對 Vite 暫存檔的 EPERM，均已改用正確 runner／授權執行重跑成功；它們不是產品 live 結果。

## 2026-10-06 09:10：實際 daily 背景資料與逐檔投影缺口

- 08:35／08:45 原排程 Gate 與 08:20 同一 session／generation 成功。08:50 原排程已建立唯一 daily owner，Node 24 runner 仍執行且與原 8080 API 保持一條連線；其收尾 receipt 預定至全日結束才出現。正式 SQLite 於 09:09 保存 160 檔 × 09:01–09:08 共 1,280 筆，獨立重算 `1303.TW` 09:02 的 7,983／4,833 ≈ 1.65177，超過 1.5 門檻。historical 前綴與 live trigger 分列，不以離線資料冒充通知。正式啟用與模式、政策、claim、runtime 前後證據足以勾選 7.1；翌日 v2 基準、跨日與全日任務仍不勾。
- 真正 status API 回傳 daily、dataActive 160、freshness=true、session current；結果 API 可讀 50 筆且 replayNotificationAuthority=false。然而逐檔 completedMinute／今日與前日累積量均為 null，與 SQLite 水位不符；此為 UI/API partial，需在不打斷盤中共用服務的安全窗口修正後再驗。詳見 `acceptance/live-2026-10-06.md`，不可將背景成功宣稱為 UI 全部通過。
- 09:10 的 provider usage、程序 RSS 與 SQLite 主檔／WAL／SHM 實測已留錨點；共用帳戶用量不可歸因為本監控獨佔，且尚無全天峰值或新舊等時窗口，因此 2.5、7.5 保持未完成。

## 2026-10-06 盤中背壓誤鎖存的候選修正

- 13:30 原始不可變收尾收據確認：單筆處理延遲 3,006 ms 略超 3,000 ms，原 runner 把整日最大值當永久故障；160 檔只有 95–96 個觀測分鐘，13:30 仍有來源事件、但 10:37 後未接受。原 `partial`、SQLite 已提交資料及 13:40 稽核失敗不改寫，詳見 `acceptance/live-2026-10-06.md`。
- 新 runner 保留可設定軟門檻、RSS／磁碟 Gate；單次略超限只計數，60 秒內 3 次慢事件或單次超軟門檻 5 倍才鎖存背壓。資源故障由 15 秒健康檢查即時寫不可變事故並提前 partial；收尾記錄軟／硬門檻、慢事件數與峰值，真背壓不撤銷已提交觀測。Node 24 聚焦 3 檔 23／23 通過，包括原 3,006 ms 重現、硬停滯、連續慢事件與事故檔。這只驗證下次啟動的新程式，不把 10/6 失敗改稱成功；7.2–7.6 仍依真實排程與跨日證據判定。

## 2026-10-06 盤後：逐檔水位 API 候選修正

- 09:10 真實 status 曾顯示 160 檔 dataActive，但逐檔 `completedMinute`、今日與前日累積量全為 null；與當時已提交的 1,280 筆 observation 不符。根因是 daily sink 只更新記憶體水位，session authority 沒有持久化這三欄，而 gateway 正是讀取 session 的逐檔投影。原始 API partial 與 SQLite 證據保留。
- 現在每筆已接受的封閉分鐘在當日 session 寫入分鐘鍵、今日累積量及合法前日同分鐘累積量；缺基準明列 null，非 current session 不向 API 投影舊水位。量比／通知仍需原有連續性、安全 Gate，不因顯示前日值而放寬比較資格，也不增加行情訂閱。session repository 對新欄位做可選值驗證，舊紀錄仍可讀。
- Node 24 的 sink、session authority、current-session projection、本機 API 四檔聚焦測試 **39／39 通過**；擴大至 runner、全日執行器與前端 view-model 七檔 **59／59 通過**。TypeScript／Vite build、OpenSpec strict validation、`git diff --check` 及本輪文字尾隨空白檢查通過；build 僅有既有大 chunk 警告。此為下次新程序的候選修正；10/6 08:50 原 runner 不熱載入，且原背壓 partial 不會因此轉成完整驗收。7.3 的真實 API／UI freshness 仍待下一適用交易日。

## 2026-10-06 盤後：中央預算去重與獨立缺件補建

- 原生 `attempt-01` 留下 117／160、237 次請求、43 檔等待；`attempt-02`／`03` 均因 `broker_budget_or_rate_denied` 而零請求，三張不可變收據不改寫。當時券商來源仍有近 483 MiB 額度；本機舊基準 85,667,193 bytes 與同一工作已 charged 的 87,027,822 bytes 全額重複扣除，才使 admission 可用值低於下一筆估量。
- 同一 quota epoch 的 daily-v2 已送估量承接舊基準工作承諾，但 `reserved`、其他週期及其他工作不能抵扣；翌日新週期重新預留至少完整基準底額。正式 v4 政策以 simulation、帳戶 HMAC、generation、無 active owner／reservation、真實 usage 及 CAS 切換至 `daily-baseline-allocation-v1`，不可變收據見 `acceptance/budget-duplication-and-recovery-2026-10-06.md`；300 MiB quote 保護池未調整，舊 charged 及失敗原件保留。
- 隔離 Node 回歸涵蓋同週期抵扣、跨週期不抵扣、active reservation／帳戶身分拒絕、下一週期恢復承諾、三次原收據加第 4 次有界補件；本案及相依 focused tests 通過。原本誤以 `node --test` 執行兩個 Vitest 檔造成 runner 錯誤，已用 `pnpm exec vitest run` 重跑 9／9 通過。`pnpm exec tsc --noEmit`、`pnpm build`、OpenSpec strict validation、`git diff --check` 及新增文字尾隨空白檢查通過；build 僅有既有大 chunk 警告。
- 18:38 新增 `attempt-04-claim.json`，僅補缺件，最多 120 次請求、20:00 截止；完成收據及 160 檔品質尚待實際核對。即使補件成功，也只證明翌日基準可用，不把原 13:35 三次 partial 或今日盤中 10:37 後 partial 改稱成功。2.5、7.2–7.6 仍按各自實盤證據判定。

## 2026-10-06 19:20：第 4 次補件原收據與等待計時器修正

- 第 4 次真實收據為 157／160 partial、78 requests、648,927 HTTP response bytes、38 次限流等待，三檔 `5388.TW`、`3025.TW`、`8155.TWO` 均因 `daily_collection_cooldown_clock_not_advanced` 等待，非額度耗盡。157 份 manifest 不重複，全部為 270 個 09:01–13:30 封閉分鐘。原收據保存，未倒填成功。
- 採集器對 ISO 准入時刻的一次性嚴格比較可能將計時器極短提早喚醒當成時鐘停滯；已改為有界補等，停滯或倒退仍拒絕。專用隔離回歸 8／8、補件入口 4／4 通過。原 15 分鐘冷卻未到前不啟動額外來源請求；屆滿後第 5 次只准修復此三檔、最多 20 requests、20:00 截止，不修改原模式與前四次收據。實盤結果另記，不將候選測試冒充 160／160。
- 19:34 真實第 5 次收據為 160／160 complete、6 requests、45,499 HTTP response bytes、0 waiting／conflict。唯讀驗證 160 份 manifest 的 hash／schema／日期／270 分鐘皆通過，上市 121、上櫃 39；原前四張收據雜湊不變。來源使用量剩餘 481,970,126／524,288,000 bytes、連線數 1，300 MiB quote 保護池仍未縮小；共用來源用量增量不能當本工作精確成本。這是 10/7 基準可用證據，**不追認** 10/6 原生 13:35 排程或盤中全日成功。詳見 `acceptance/budget-duplication-and-recovery-2026-10-06.md`。
- 補件後 Node 聚焦 13／13、Vitest 採集／盤後 11／11、TypeScript／Vite build、OpenSpec strict validation、`git diff --check` 與本輪新增文字尾隨空白檢查通過；build 仍只有既有大 chunk 警告。既有 Codex 驗收 heartbeat 已更新為 10/7 跨日查核；本機 scheduler DB 顯示名義 08:05、下一次提前喚醒 08:00:07（Asia/Taipei），不能把提前喚醒當作 08:05 排程已執行。08:20 等日常工作仍為程式的本機排程，不由 Codex 代跑。

## 2026-10-06 19:47：下一日重設前錨點與本機排程接線

- 真正 simulation API 唯讀保存 19:47:53 來源計數私密錨點，hash `39a8698fee07ce3f2026ef4cbac31d2d0f1c4a16497fbe334dcd8b269ad96de7`；只存帳戶 HMAC，不存原始帳號／金鑰。唯讀查核候選選取器會以 10/7 08:00 邊界挑到該張 10/6 收據。
- 跨日 CAS 的 `prepare`／`commit` 已接回本機 08:20／08:35／08:45／08:50 排程，13:35 盤後程式於完成本輪後保存下次來源錨點；Codex heartbeat 只觀測，不負責常態遷移。同日已轉換 no-op；缺錨點、來源計數未下降、官方日期或安全 Gate 不成立時 08:50 拒絕新下載，保留原失敗收據。週末／連假以官方前一交易日驗證，仍受新鮮度上界限制。
- Node 相關 19／19、盤前／盤後／採集 Vitest 46／46 通過；包含同日 no-op、缺前日錨點、雙階段順序、08:50 阻止下載及週五至週一。這些均屬候選程式測試，**不代表**10/7 真正來源重設或原生排程已完成；2.5、7.2–7.6 保持未勾。
- 唯讀正式政策確認 v4 `validThrough=2026-10-10T15:59:59Z`、quote 保護池 314,572,800 bytes、基準最低配置 85,667,193 bytes。為避免 v3 專用的人工複核入口使 v4 在數日後停住，真正來源重設且 320 請求完整預算通過時，CAS 可將政策與預算效期同步延至最多七日後，但不超過最早校準樣本三十日；逾期拒絕，不能無限自動展延。v4 續轉／校準過期聚焦回歸通過；今晚正式政策效期未修改，仍待 10/7 真正收據。
- 另檢查隔日 v4 政策，發現新的 160 檔全窗口預估與恢復的同一基準工作配置仍被相加；已改為只要求超出既有基準配置的差額，保留 quote 300 MiB 及其他獨立工作保留。450,000,000 bytes 餘額可通過、420,000,000 bytes 不足仍拒絕的隔離案例通過；這是明日預檢候選程式驗證，不代表 10/7 來源用量已重置。

## 2026-10-08 16:14：連兩日尾盤缺棒定位與候選補證

- 10/7 原 daily summary 為 158／160，缺 3533.TW、6426.TW；10/8 原 summary 仍為 158／160，但改缺 2603.TW、5284.TW。10/8 兩檔各有 269 個 live 封閉分鐘至 13:29；全程 43,198 個 KBar frame 均進入 adapter 且接受，沒有 malformed frame、transport disconnect 或 health incident。這證明本機 monitor reader／adapter 沒有拒絕已送到它的幀；但尚無上游逐檔原文，不能斷言是券商未推或本機 API 未轉送。原 13:40 `coverage_incomplete` 與 10/7、10/8 partial 均保留。
- 10/8 已發布的獨立歷史 v2 manifest 中，2603.TW 的 13:29 累積量 5,053、13:30 累積量 6,643；5284.TW 為 267、279。兩檔的 13:29 與 live SQLite 相符，13:30 分別有 1,590、12 張，並非可推論為零量；原 live 缺口不能靠延長 seal 或假造 KBar 補成 live complete。
- 候選修正只保存 transport 對 13:29／13:30／13:33 的逐檔 reader 幀計數與最後接收時間。當原生盤後 v2 收據真正 160／160 完成後，另以唯讀 SQLite 與原 manifest ID／來源日期／generation／13:29 重疊量核實至多四檔單一尾棒缺口，採 `wx` 建立獨立 sidecar；不新增券商 HTTP／登入／訂閱、不改原 observation／trigger／收據，也不補發通知或追認 live。
- 16:14 原生 13:35 採集 `attempt-01` 為 159／160 partial；3017.TW 的來源回傳 `daily_minute_volume_source_failed`，原程序 PID 66967 仍在原有界冷卻／重試流程。此原失敗收據保留，不手動重跑；10/8→10/12 尚無完整原收據，今天的 sidecar **尚未生成**，新程式也不會熱載入已啟動的原程序。Node 24 專用核實測試 3／3（含來源身分、量衝突及同鍵 no-op）、Vitest 相關 18／18、即時訊號隔離瀏覽器 2／2、TypeScript／build、兩個 change strict validation 通過；瀏覽器測試在沙箱內先遇本機監聽 EPERM，獲允許的隔離本機埠重跑才通過。上述皆屬程式候選回歸，不是明日自動修復或今日 live 完整性證據。

## 2026-10-08 16:28：跨兩日尾端分鐘校正與 10/7 真實來源核對

- 重新直接讀取 10/7 不可變 daily summary 與 live SQLite，確認 3533.TW、6426.TW **各只有 268 個封閉分鐘、最後為 13:28**；13:29 frame 曾進 adapter，不等於 13:29 已封存。原 13:40 `coverage_incomplete` 仍維持。10/8 的 2603.TW、5284.TW 則各 269 分鐘至 13:29。核實器因此嚴格限定最後一或兩分鐘缺口，逐分鐘核對，不將 10/7 錯當成單一尾棒。
- 10/7 原生 13:35 `attempt-02` 於 16:29 已有真正 160／160 complete 收據；只以該既有收據及本機 SQLite、manifest 唯讀核對，另建不可變 `daily-run/2026-10-07/postclose-tail-reconciliation.json`。3533.TW：live 13:28 累積 741，歷史 13:29 為 741（0 張）、13:30 為 887（146 張）；6426.TW：live 13:28 為 2,364，13:29 仍 2,364（0 張）、13:30 為 2,528（164 張）。兩檔重疊端點、日期、generation、manifest ID 與收盤模式一致。sidecar 明列 `liveDelivered=false`、`liveAcceptance=false`，**不是**原生排程補跑或 live 成功收據；沒有修改原 observation、summary、稽核或通知。
- 專用 Node 測試增為 4／4（268 與 269 分鐘前綴、量衝突、非尾端、generation、同鍵 no-op）。10/8 原生採集仍待自身重試完成，不能用 10/7 的成功推論今日 3017.TW 或今日兩檔缺棒已核實。下次真正自動 sidecar 與 reader 逐檔 frame 計數仍待適用交易日觀察，7.7 未勾。

## 2026-10-08 16:30：今日原生盤後補完與尾端核實

- 原生 13:35 工作依原 15 分鐘冷卻自動建立 `attempt-02`，16:29:25 Asia/Taipei 收據為 **160／160 complete**；3017.TW 已由同程序補足，`attempt-01` 的 159／160 partial 保留。這是 10/8→10/12 翌日基準完整，不是 10/8 盤中 160／160。
- 以該完整收據及原本已存的本機資料建立 10/8 獨立 sidecar：2603.TW 13:30 經核實為 1,590 張；5284.TW 為 12 張，13:29 live 重疊累積量一致。與 10/7 兩檔的 13:28→13:29 零量→13:30 正量一併記於 `acceptance/live-2026-10-08.md`。兩日原 live 仍為 partial，沒有追認成功。
