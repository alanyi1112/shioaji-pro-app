## 1. 相依盤點與來源確認

- [x] 1.1 建立常態入口、stream adapter、SQLite sink、shadow recorder、capture export、replay、tail review 與 failure audit 的相依清單，區分必留核心與可取消常態呼叫。
- [x] 1.2 唯讀核實已保存 TSE／OTC 真實分鐘 payload 的 timestamp、Volume／Amount 單位、開盤撮合、零成交及 13:30／13:33 編碼；未知項明列限制，不猜測補值。
- [x] 1.3 盤點可重用的可信 regular-session 收盤總量與合約快取，確認商品／日期／單位／generation；記錄不能當作獨立總量的來源。
- [x] 1.4 建立四個 active changes 的保留／遷移／superseded-by-design 任務矩陣，保留原 failed／partial，不把取消要求勾成通過或自行歸檔。

## 2. 新版日常分鐘量基準

- [x] 2.1 實作 `intraday-minute-volume-baseline/2` 型別、source mapping 與 verifier，覆蓋官方日期、商品／交易所、單位、等長、270 分鐘、重複／跨日／盤外／負量／倒退與延後收盤歸一。
- [x] 2.2 實作可信總量有則對帳、無則明列 not_observed 的品質投影；缺分鐘僅在充分 known-zero 證據下補齊，衝突／未知逐檔拒絕。
- [x] 2.3 實作 immutable manifest、原子發布、monotonic revision、同鍵衝突拒絕與來源日／目標日鍵值查詢，不改舊 manifest 或建立假 refetch 欄位。
- [x] 2.4 實作日常單次 K 採集、合法基準／合約快取重用與只補缺件；移除日常固定第二份 K 和全日 ticks 前置，保留 legacy collector／verifier 診斷入口。
- [x] 2.5 接上中央保守預算、有限嘗試／冷卻及受身分與有效期限制的 usage 合併，依新模式實測校準可設定預算，不重設舊耗盡或寫死 bytes 啟動門檻。
  - 10/6 已以真實來源用量與版本化收據修正同週期舊基準／daily-v2 重複保留，300 MiB 保護池不變；原三次 partial 保留。第 4 次補件為 157／160，餘 3 檔因等待計時器提前返回誤判；修正有界補等後，第 5 次真實補件完成 160／160，原四張收據未變。中央預算與來源用量真實錨點已保存；共享帳戶增量仍不能精確歸因，需在下一次原生排程與跨日驗收完成後判定整項。
- [x] 2.6 實作 daily v2 優先、合法 v1 唯讀沿用的 resolver；保留 diagnostic 原優先序、日期／商品拒絕與零分母語意。

## 3. 輕量日常 runtime

- [x] 3.1 新增獨立 daily runner，重用單一 bounded transport、封閉分鐘 adapter、evaluator 與 SQLite sink，不經全日 shadow recorder 或 Stage builder。
- [x] 3.2 將日常記憶體狀態限制在逐檔水位、累積量、去重及有界修訂窗口；保留必要 observation／trigger 的持久化與安全交易，不再同時保存全日 rows／slots。
- [x] 3.3 保留同 completed-minute 計算、來源／generation／連續性檢查、逐檔隔離、historical prefix、有界 gap repair 與零追溯／重複通知。
- [x] 3.4 將實際資料活動與 heartbeat／accepted／圖表渲染分流，背景監控不得要求可見圖表或 1 分 K 週期。
- [x] 3.5 實作 13:30 closing、13:33 延後撮合窗口及最早 13:34:30 final seal／owner cleanup；以 SQLite 聚合產生小型不可變收尾 receipt，不載入全日資料雙重 replay。
- [x] 3.6 保留可設定 runtime resource／磁碟／backpressure 保護，實際故障記錄受影響範圍；摘要寫入失敗不得回寫全部商品 failed 或撤銷已提交合法結果。
- [x] 3.7 修正 SSE reader 退出後舊 socket 未關閉、日間無 health pulse 的缺口；同 owner 內分類來源沉默／不可復原故障，保存不可變事故並安全 partial 收尾，不新增並行訂閱。
- [x] 3.8 依 10/6 原始實盤收尾證據修正單次 3,006 ms 延遲造成的全名單永久背壓鎖存；保留持續／硬停滯保護，真故障於健康檢查留下事故並提前 partial 收尾。

## 4. 常態排程與既有功能遷移

- [x] 4.1 接上 08:20／08:35／08:45／08:50 的 daily mode qualification、durable approval 與新 runner，沿用本機排程及 append-only claim／receipt，不新增 Codex 常態排程。
  - 10/13 修復 daily 官方日曆仍依賴已過期 v1 包的接線：新增獨立原文／hash／期限快取及額度 witness 相容；原 08:20／08:35／08:45 失敗保留，原生08:50開盤前依完整Gate補建同日session並啟動唯一runner。今日 operator-repair 不追認昨日盤後快取成功，13:35自動保存新快取仍須當日證據核對。
  - 10/6 補接跨日額度續轉：13:35 本機盤後保存私密前日錨點，08:20／08:35／08:45／08:50 本機盤前核實來源重設並沿用雙階段 CAS；缺證據時 08:50 不啟動下載。候選回歸通過，10/7 真實排程仍依第 7 節驗收。
- [x] 4.2 遷移 late-boot 的日常啟動與冪等接續，保留原時窗、預檢、原失敗收據及排他 ownership，不因補救形成第二個 owner。
- [x] 4.3 將動態 daily plan／逐商品基準／config CAS／persistent suppression 接入相同 runner 與小型 receipt，保留 feature-off 和既有固定容量，不自行啟用動態名單。
- [x] 4.4 使 13:35 盤後基準建檔完全獨立於 capture／interruption／Stage report；取消成功後常態 tail review 及無用途 import／參數，保留明確選用的唯讀診斷。
- [x] 4.5 修改 13:40 稽核為真實程序、stream 故障、逐檔 coverage、summary write 與 baseline 進度，不因 bounded collecting 或缺少 formal acceptance 誤報失敗。
- [x] 4.6 驗證 fixed／dynamic／late-boot／diagnostic 共用 registry 與 mode 身分，進行中的 legacy owner 不切換、不重啟，失敗診斷不變更歷史 capacity approval。

## 5. API 與盤中選股面板

- [x] 5.1 更新版本化 API 投影與 client 型別，分列 runtimeMode、實際 freshness、live coverage、前日／翌日基準及 diagnostics；新舊未知欄位不得預設成功或偽造 readyForBundle。
- [x] 5.2 更新面板為今日監控、基準與收合診斷資訊；保留歷史容量來源，明列 v2 未做獨立總量核對，不把歷史 GO 當成今日資格。
- [x] 5.3 保留收尾後唯讀結果，分開歷史觸發、最後有效量比與目前通知權限；檢查 partial／ended／collecting／ready／failed／unknown 的呈現。
- [x] 5.4 修正已保存封閉分鐘與逐檔 API 狀態脫節：當日 session 持久化分鐘及同分鐘累積量；非 current 不冒充即時，並補聚焦回歸。真實跨日 UI freshness 仍由 7.3 驗收。

## 6. 回歸與日常路徑移除驗證

- [x] 6.1 以真實已保存資料唯讀比較 v2 canonical series／累積量與舊 verifier／SQLite，逐檔記錄一致、衝突與 unknown，保留來源 hash；離線結果不當作 live。
- [x] 6.2 補來源驗證測試：日期／休市、單位／編碼未知、270 分鐘、known-zero、總量衝突、13:30 revision／13:33、manifest conflict 與 v1／v2 資格隔離。
- [x] 6.3 補 runtime／排程測試：無 capture 正常比較、同分鐘／去重／修訂／gap repair、單檔 partial、closing freshness、receipt 故障、backpressure、排他 ownership 與晚開機／動態 feature-off。
- [x] 6.4 補真實大小資料的 UI／API 回歸與原圖表／清單／分價量表／資金流向保護測試，確認結果可讀且不引入訂閱副作用。
- [x] 6.5 驗證日常入口對 legacy 全日 recorder／capture export／replay／tail review 呼叫數為零，取消不再可達的常態程式與旗標，但保留診斷 CLI、共享核心及全部舊證據。
- [x] 6.6 執行相關 focused tests、型別／build、OpenSpec strict validation、git diff --check 與新增文字檔 whitespace 檢查，記錄無關既有失敗而非隱藏。
- [x] 6.7 補 reader 異常、來源靜默、收盤集合競價、早期 partial 與不新增並行訂閱的回歸；完成聚焦測試、型別／build、strict validation 與 diff 檢查。
- [x] 6.8 針對反覆少數商品尾盤 frame 缺漏，加入逐商品尾盤 reader 計數與只讀 v2 基準重疊核實、不可變獨立 sidecar；涵蓋最後一至兩分鐘，測試完整前綴、來源身分、量衝突、同鍵 no-op、零 broker 請求及不升格 live。
  - 10/12 候選補修原 reader 略過 `kbar_gap` 的診斷缺口：來源報告丟失數／非 KBar event 有界計數、hash-only 樣本及健康事故分流；25 項transport／runner回歸與擴大52項相關回歸通過。尚無今日原始 gap 通知，不能把重現 fixture 當作三日上游丟包根因已證實，原 158／160 partial 不改判。下一次真正來源觀測仍由 7.7 核對。

## 7. 安全切換與真實環境驗收

- [x] 7.1 回歸通過後，在無 active owner 的安全窗口保存 mode／設定／claim／runtime 前後證據並啟用 daily 路徑；不重啟共用服務、不改原收據、不冒充當日排程成功，保留可逆切換方式。
- [x] 7.2 核對一次真正本機盤後排程自動建立 v2 基準，逐檔驗證 TSE／OTC 日期、coverage、close mode、品質與 hash，下一次同鍵 no-op；不得手動發布冒充排程。
  - 10/13原scheduled PID72336的attempt-02於16:29:31.667自然完成160／160；同一原程序真正collector重入保存same-key-noop，追加下載／reservation均0。17:09唯讀重驗全部hash、日期、270分鐘、TSE121／OTC39及原收據；獨立closeTotalCheck=not_observed160，不冒充獨立成交總量對帳。此no-op是同原程序第二次重用，不是另一個獨立排程；詳見 `acceptance/threshold-runtime-integration-2026-10-13.md`。
  - 10/13補齊原生完整後同鍵重用的獨立收據出口，零下載／零reservation，重驗160份與原件hash。僅standalone盤後entry接線，不觸發Web重載；今日原生完成後真正執行及收據核實前仍未勾，不把回歸或人工診斷當scheduled。
  - 10/6 原生 13:35 三次 partial 後，人工第 4／5 次缺件補足翌日 160／160；這不等於原生排程自行完成，本項仍待下一個適用交易日驗收。
- [x] 7.3 在緊接下一適用交易日驗證原盤前／晚開機安全 Gate、單一 owner／連線、真實來源事件與 sealed-minute 累積量、results／通知 Gate／UI freshness，證明無完整 capture 也能工作。
- [x] 7.4 完成真實全日收尾與獨立翌日基準核對；依10/15使用者授權，完整live或符合「最多10檔只缺13:30、269分鐘真實前綴及完整盤後補算」政策可取得日常運作通過。保存原逐檔partial、13:30／延後收盤限制、13:40稽核與已提交結果，不以歷史補齊宣稱live complete。
- [x] 7.5 保存新舊路徑 HTTP request count／response bytes、可取得的 provider usage 前後錨點、CPU／RSS／DB／延遲，區分本機與券商額度；沒有錨點不得宣稱確切節省比例。
- [x] 7.6 彙整繁體中文 verification／acceptance、四案遷移矩陣與日常 runbook，完整證據才勾任務；保留失敗與選用診斷限制，結案前再次 strict validation／diff 檢查，不自動 archive／commit／push。
- [x] 7.7 以真正原生 13:35 完整收據核實 10/8 末分鐘缺口，並於下一適用交易日驗證新逐檔 frame 計數與自動獨立 sidecar；無原始 frame 時不得聲稱上游已修復。
  - 10/12原生attempt-02完成160／160，16:29:26.564真正自動生成tail sidecar，逐檔frame計數與雜湊核實成立；兩檔歷史末分鐘140／684張，live仍partial。原10/8缺口核實亦保留，不宣稱新增gap候選已真實載入或上游丟包根因已修復。詳見 `acceptance/native-postclose-and-tail-2026-10-12.md`。

## 8. 盤中即時門檻切換（10/13追加）

- [x] 8.1 補原change的1.5／2／3盤中立即生效契約，分離行情session與比較版本、原子收據／CAS、靜默重判及UI實際生效狀態；保留今日revision9→10失敗。
- [x] 8.2 實作不依賴服務的有界門檻切換核心與測試，涵蓋三快捷值、個別覆寫、CAS／持久化失敗、no-op、來源身分、逐檔封閉分鐘及零追溯／重複通知。
  - 16項Node24核心與36項既有Vitest回歸通過；本輪只完成不在Vite config相依鏈的候選核心，尚無實際durable journal或live owner／API／UI接線，不把注入port的fixture成功當盤中生效。
- [x] 8.3 接上daily owner、session authority及sink，持久化切換／恢復證據；只改門檻不得中斷SQLite，拒絕根因須保留且健康檢查不得假健康。
  - 已接原owner、不可變SQLite切換journal、threshold-only身分proof與1秒本機control poll；持久化失敗時以原門檻持續保存分鐘，根因及健康incident保留。21項Node及真實SQLite整合fixture通過；恢復是驗證收據重建core，不允許第二owner或自動重開券商。
- [x] 8.4 接上專用API與UI三快捷操作及saved／active／pending／failed／effectiveAt顯示，保留草稿、名單安全Gate與舊結果。
  - 專用threshold CAS不送草稿items；pending維持舊active、ack後刷新結果，closing不重開通知。22項隔離Chromium與正式頁面可見三按鈕成立；正式保存仍revision10／3倍／200項，舊程序已結束故unsupported_runtime，不假稱今日生效。
- [x] 8.5 執行整合／競爭／closing／恢復回歸、Node24型別/build、strict validation、diff與新增文字whitespace；受控載入前核權限與原生採集不受影響。
  - 21項Node24、70項Vitest、22項Chromium、tsc／build／strict／diff及122份untracked文字whitespace通過；原13:35程序先自然完成才依授權載入，8080／watchdog／5174與原失敗檔保留。46／49，7.4／7.6／8.6仍未勾。
- [x] 8.6 真正盤中以同owner切1.5→2→3→1.5，核實生效收據、同分鐘公式、不中斷留存／新broker login與訂閱0、通知去重及UI；候選／盤後測試不能勾live。
  - 10/15原owner PID84453在09:40–09:43真正切2／3／1.5，revision16／17／18均durable applied；480份同分鐘整數公式一致、各下一分鐘160份完整，原112筆trigger及200項名單hash不變。HAR登入／訂閱／新stream0，原socket／generation不變，114筆重判事件均historical且無通知權限；修正日期後原分頁顯示10/15及228結果。23項Chromium、型別／build通過；詳見`acceptance/threshold-switch-live-2026-10-15.md`。47／49，僅7.4／7.6未完成。

## 9. 收盤尾筆例外與盤後補算（10/15授權追加）

- [x] 9.1 更新原change政策與驗收標準：最多10／160、僅缺13:30、269分鐘真實前綴、安全Gate及原partial不改判。
- [x] 9.2 實作純政策與本機唯讀補算，驗完整160份當日／前日v2、銜接量、durable門檻及整數公式，拒絕未知／損壞／非尾端缺漏。
- [x] 9.3 保存不可變獨立例外產品收據，同鍵no-op／衝突拒絕；接原standalone盤後完成路徑，不新增下載或改原採集收據，今日原程序不受影響。
- [x] 9.4 接API與UI的例外通過／待補算／拒絕狀態與盤後補算列，保留live覆蓋、原trigger及通知限制。
- [x] 9.5 完成聚焦回歸、型別／build、strict／diff／文字whitespace及安全接線；需要受控載入時先核原採集完成及授權。
- [x] 9.6 原13:35程序完成後，核對今日真實三檔補算與完整例外證據／API／UI、原件hash及零額外broker副作用；人工衍生標operator，不冒充原生採集或live完整。
