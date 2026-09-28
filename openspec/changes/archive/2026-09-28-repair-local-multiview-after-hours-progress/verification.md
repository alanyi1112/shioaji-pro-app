# 程式修復驗證

## 範圍

- 本機受保護 maintenance 新增 continuity，沿用既有 run/item lease 與正式來源稽核；runner 每次一檔、最多 128 批，等待重試時退出，保留 counts。run 結束但未全部 verified 時回報未驗證。
- 籌碼先記錄 attempt，失敗冷卻不清除已保存 coverage；scheduler 有已保存商品時避免不必要的 setup asset 查詢。
- PE 排除含英文字尾 ETF 及 metadata 標示不適用 PE 的商品。未到期 lease 不被搶走，舊不適用工作保留紀錄並標記 not_eligible，排除於 target 統計。
- PE 同範圍重新 discovery 不更新排隊順序與失敗 fence，領取限當次合格 universe，從未成功商品優先於重複成功商品。普通股暫時未公布 PE 不永久排除。

## 結果

- 新增修復與相鄰聚焦測試：69/69（其後追加 runtime schedule 測試納入完整集合）。
- 完整 MultiView：745/745 通過，從 apps/multiview 執行 node --test tests/*.test.mjs。
- pnpm typecheck:multiview、pnpm lint:multiview、pnpm build:multiview 通過。
- zsh -n scripts/realtimestock-runtime、OpenSpec strict 與 git diff --check 通過。
- 首次完整集合從 repo 根目錄執行，742/744：Sites archive 測試因 cwd 找不到腳本；另有既有 runtime 狀態測試期待舊文字。改從 MultiView 目錄並將狀態測試對齊現行 liveDataStatus 行為後完整通過。初次編輯重複套用片段造成型別錯誤，已修正並重跑型別與測試。
- 建置保留 Node module.register deprecation、Vite native config loader 及 vinext route classification 提示。

## 執行環境邊界

未執行 live 回補、未修改行情資料、未啟停或重啟服務，沒有 commit、push、部署或 broker write。
本機 LaunchAgent 使用 Application Support/RealTimeStock/bin/realtimestock-runtime 的獨立副本；本輪只修改 repo 腳本，新增日 K daily 入口須在後續明確同步 runtime 副本後生效。PE 與籌碼下一輪實際執行結果仍需逐商品驗收，離線測試不代表既有缺口已補齊。

## 使用者授權後的實際回補（2026-09-16 台北晚間）

使用者明確要求執行資料回補後，已同步必要 runtime 副本並保留私有備份，未重啟服務。此段更新前述尚未執行的狀態。

- 日 K：原本最新日期 15/53，回補後 53/53；9/7、9/8、9/9、9/10、9/11、9/14、9/15、9/16 各日皆 53 檔實際 candle。
- 完整歷史連續性 27/53 verified、26 unknown。官方月報補入另遇 HTTP 403／provider_unavailable，未繞過來源限制，未將來源失敗改成完整；最終 run 巡訪結束但 runner 如實回報 continuity_requires_source_verification。
- 法人、外資持股、融資券：9/16 各有 53 檔實際非空資料列。
- 借券：9/16 33 檔，另外 20 檔來源未提供當日資料，保留最後可信日期與冷卻，不補零、不宣稱沒有交易。
- PE：39 檔完成、5 檔未取得足夠已驗證資料、3 檔不適用 ETF 已排除；missing/running/blocked/retryWaiting 均 0。額度最後使用 62/240，未繼續重抓已完成工作。
- Live 發現籌碼僅依賴 11 檔 TDCC registry，已修正為與啟用個人台股清單合併，完成漏掉 42 檔的回補。
- 既有日 K audit API 已接上僅限 local loopback 的 LOCAL_PIPELINE_SECRET；未授權 live POST 驗證為 401。
- 最後完整 MultiView 745/745、型別、lint、build、OpenSpec strict 與 diff check 通過。
- 收尾唯讀確認 simulation、watchdog healthy、business session／2330 Snapshot available、5173／5174 up；write master disabled。沒有 commit、push、Cloudflare 部署或 broker write。

逐項機器可讀結果見 `live-backfill-2026-09-16.json`。來源缺口仍需後續正式資料可用時驗證，不能由這次回補推論全部歷史完整。

## 2026-09-17 16:27 heartbeat 實際接續

- 首工具begin，逐組checkpoint，今日已通過tick-tape不重跑。13:27輪及本轮均未再錯接歷史收工；task4.4可完成，資料尚未驗收者仍保留3.x。
- 核對本機`man launchd.plist`確認0／7週日、1週一。原daily用2–6，實際漏週一並多跑週六；原TDCC用7／1，實際落週日／週一，與週六／週日需求不符。已修正repo、已安裝runtime的日曆片段及兩個LaunchAgent。重載前确认兩job無pid，只重載閒置排程；本次重載暫抑制RunAtLoad避免重複抓來源，磁碟原有RunAtLoad=true保留供下次正常登入。讀回launchd：daily[1,2,3,4,5]16:45、TDCC[0,6]22:30，均not running；共用API／watchdog／5173／5174及其他監控未啟停。原檔保留本機私有備份。
- 真實日期2026-09-14至09-20的星期對照回歸3/3、runtime回歸35/35、zsh語法與OpenSpec strict通過。
- 本機TDCC官方OpenAPI獨立唯讀取得HTTP200、68935原始級距列；同時既有Worker受保護refresh-latest未能在30秒內完成，回503 timeout，diagnostic run local-tdcc-diagnostic-20260917-1630保留，nextRetryAt=台北22:30:40。沒有放寬timeout、繞過來源或改成成功；前兩日invalid_response保留，不能以當次timeout倒推前兩日根因。現有9/11、53目標及18/18archive資料保留且不重新補寫。首次手動探查用錯header得401，沒有修改資料；改用repo既有X-MultiChart-Pipeline-Authorization後才建立上述診斷run。
- 本機日K從12/53當日coverage，以受保護有界runner補到9/17的53/53；歷史連續性34/53核實（輪前28），剩19未核實，當日run47已處理、6等待重試（13unknown）。輸出`outputs/local-maintenance/continuity-20260917-1633.jsonl`。今日最新列補齊不代表剩19檔歷史已完整，3.1仍不勾。

- 日籌碼16:35有界補跑HTTP200，實際巡訪15檔，run sites-scheduled-1789634119164完成、remaining0但pending20，沿既有22:00來源截止仍使用9/16交易日；借券source_not_published及冷卻保留，沒有補零、没有把HTTP200當資料完整。

- PE run local-pe-recovery-20260917-1636：latestAccepted34（來源9/16）、historyClaimed8／completed8／failed0，預算16/240（16:00–17:00）。3481為finmind_overlap_verified；3055的232列、3363的759列、4768.TWO的990列仍official_not_published；3149為0列，1101仍official_gap。TPEx診斷明確顯示PE來源9/16、close來源9/17（887/1014列），不同日不得强行拼成已核實。health history ready28→32、missing8→3，整體ready仍39/44；3.3保留未完成。
- runtime終查：simulation=true、business session與2330 Snapshot可用、watchdog healthy零重啟、API／5173／5174 up、D1 integrity ok、production停止、write master disabled。未commit／push／archive。下一步查今天16:45真正自動daily排程、剩19歷史日K與借券20、5檔PE官方對照及來源冷卻；不得用本輪manual當作3.4自動排程驗收。


## 2026-09-17 17:37 實際排程驗收與未完成項補跑

- 查核 daily-pipeline.log 與逐商品 DB 時間：16:45 自動工作接續 6 檔等待項，run processed47→53、complete34→40；PE 自動完成4967（840列）、6505（1091列）、2615（1094列），均finmind_overlap_verified。17:02再次執行日K processed0、PE historyClaimed0，確實跳過已完成項。3.4自動接續驗收完成；先前日曆回歸3/3、runtime回歸35/35結果沿用，本輪未改程式，未重跑已完成測試。
- 區分歷史run與目前資料狀態：17:05–17:06重新稽核官方月份後，009816、009819、2449、3037、3189、8046因provider_unavailable／invalid_response降為unknown，現況一度34/53，不能以run40/53冒充現況。17:35只重試這6檔，全部重新通過官方稽核至9/17，未直接改DB或清除失敗紀錄。尚未證實這是同一稽核範圍的程式回歸，未盲目保留舊complete。
- 17:36針對其餘13檔進行一次有界稽核（每批最多4檔，內部併行2），2801、3055、3149、3231通過。合計本輪6次受保護本機POST、19檔稽核，10通過、9未核實；API未回傳上游請求總量，不能把6次POST當成官方請求數。
- 最後health與D1：當日9/17 coverage53/53；目前歷史連續性44complete、9unknown、0partial、0notAudited。剩3481、3711、4958、8103為invalid_response；0056、006208、00991A、1303、2301為provider_unavailable。所有9檔均有當日資料；missingSessionCount=0不代表歷史已核實。來源失敗後不再本輪密集重試。原daily run40/13留存，最新現況44/9，兩者時間範圍不同，沒有覆寫舊run。
- 證據：outputs/local-maintenance/continuity-recheck-20260917-1738.json（內容實際時間17:35）、continuity-remaining-20260917-1737.json（17:36）、health-20260917-1737.json。
- 本機TDCC17:02自動刷新已成功，source9/11、53/53完成、零blocked／missing／reconciliation／overdue，archive18/18；本輪不重抓。PE歷史ready35、missing0、blocked5；整體39/44，5檔既有來源核對仍待完成，TPEx PE9/16與收盤9/17不能跨日拼接。借券仍20檔source_not_published待正式分類，不補零。
- Cloudflare唯讀刷新：9/18期已完成、剩9期；D1讀345.1k／寫62.28k，扣正常服務26720後可用寫入11000，低於下一期31000成本保留，未再dispatch。scheduler DB實際next_run_at為2026-09-17 20:27:24 Asia/Taipei，屆時再核對額度與來源。
- 終查simulation=true、business session與2330 Snapshot available、watchdog healthy且零重啟、API／5173／5174 up、D1 integrity ok、production停止、write master disabled。本輪無程式修改、未啟停服務、未commit／push／archive。


## 2026-09-17 20:27 heartbeat：日 K 來源驗收完成

- 首工具begin並先判定Cloudflare額度；三組均已巡訪。日K輪前46/53complete、7unknown（3481、4958已於19:05由既有載入核實，未歸為本輪成果）。20:29:48–20:29:52只針對剩7檔0056、006208、00991A、1303、2301、3711、8103做兩次受保護有界POST，全部complete，沒有重跑已完成46檔。上游請求總量API未提供，不以兩次POST冒充官方請求數。
- Fresh health與唯讀D1一致：53/53當日coverage、53complete、0unknown／partial／notAudited，min continuity_through=2026-09-17。task3.1完成，以既有日K稽核範圍為限（display160加125根暖機／緩衝；不足者按現有起始日），不推論未驗證的更早全歷史。保留舊daily run40/13及歷次來源失敗紀錄。
- 20:30 PE有界run local-pe-evening-20260917-2031：latestAccepted39、historyClaimed0、historyFailed0，沒有重抓已完成歷史。TPEx PE與close終於同為9/17（887／1014列），官方日期不同日的阻擋解除；TWSE仍9/16，不能拿聚合max9/17宣稱全部商品都到今天。5檔歷史來源核對仍未完成，task3.3不勾。
- 20:31籌碼有界daily run sites-scheduled-1789648264536完成37檔巡訪，remaining0、pending47、reason source_not_published。此47包含超過20小時freshness的既有資料，不等於新增47檔資料遺失：唯讀DB核對9/16法人／外資持股／融資券仍各53/53、借券33/53。查核2330原coverage及last_success保留，僅last_attempt前進；未修改計數或強行改fresh。原20檔借券合法無資料判定尚待正式來源，task3.2保留。22:00前維持既有9/16完成日窗口。
- TDCC持續healthy、53/53、source9/11、archive18/18，不重抓已完成週。成交明細task5.1已完成，本輪不重跑。runtime終查simulation=true、Snapshot2330與business session可用、watchdog healthy零重啟、8080／5173／5174 up、D1 integrity ok、write master disabled、production停止。
- 證據：outputs/local-maintenance/continuity-20260917-2030.json、pe-20260917-2031.json、chip-20260917-2032.json、evening-health-20260917-2032.json。無程式修改、未啟停服務、無commit／push／archive。


## 2026-09-18 08:30 本機前一完成交易日回補

- 盤前只處理9/17：日K已核實53/53，沒有重跑完成稽核。08:30後stableTaiwanDailyCoverageEnd按現行交易時段契約回null，因此health當日coverage0/53不當成資料遺失；唯讀DB53檔continuity complete、through9/17維持。
- daily有界runner先處理40檔後留下13remaining；本輪使用同一run sites-scheduled-1789691447364連續13次受保護orchestrator-tick接續至53processed、0remaining，沒有另外建立重複run。完畢仍pending21；HTTP200／run completed不代表所有歷史來源完整。
- Fresh D1核對9/17法人／外資持股／融資券各53/53、借券33/53。本輪將前日來源推進到9/17。warm health32ready、21pending，其中20檔借券缺9/17來源，另外包含歷史起始範圍不足（例如00918借券coverage_start2026-04-27，要求窗口2025-09-17）；不能將所有pending都解讀為當日資料缺失或自行補零。冷卻保留，3.2尚未完成。
- 只呼叫一次PE latest-refresh（local-pe-latest-20260918-0833），避免start將歷史target_end推到尚未完成9/18。accepted39，TWSE及TPEx正式sourceDate均9/17，TPEx PE/close同日，failures空；沒有重抓完整歷史。history仍35ready／4insufficient／5blocked，既有5檔來源核對未完，3.3不勾。
- TDCC仍healthy、source9/11、53/53與archive18/18；成交明細5.1已完成，本轮不重跑。simulation、business session與2330 Snapshot可用、watchdog healthy零重啟、API／5173／5174 up、D1 integrity ok、write master disabled、production停止，沒有啟停共用服務。
- 證據：outputs/local-maintenance/chip-20260918-0831.json、chip-resume-20260918-0832.json、pe-latest-20260918-0833.json、health-20260918-0833.json。無程式修改、未commit／push／archive。


## 2026-09-18 10:28 唯讀維護

health與D1確認9/17日K53complete、法人／外資持股／融資券各53、借券33；PE39、兩市場latest均9/17，5檔歷史partial／blocked及無lease維持。借券20檔last_attempt為08:30:47–08:31:36，4小時attempt冷卻尚未到期（最晚12:31:36）；不因health retryWaiting=0忽略orchestrator冷卻。當前交易日尚未完成，不探測9/18日報、不重跑昨日成交明細或日K驗收。TDCC healthy、53/53；simulation／business session／2330 Snapshot／watchdog／8080／5173／5174正常，production停止、write master disabled。證據outputs/local-maintenance/health-20260918-1027.json與db-20260918-1029.json。無資料寫入、無程式修改或服務啟停；3.2／3.3保留。


## 2026-09-18 13:33–13:49 歷史 PE 官方核對與狀態修正

- Cloudflare先完成fresh quota gate及run35311006869的7/9補檔至11/18，再接本機；tick-tape5.1及日K53complete不重跑。借券13:33:20開始同一daily run local-chip-remaining-20260918-1333，21次受保護有界tick後processed21、remaining0、pending21。expectedSessionDate仍9/17；最後缺口嘗試13:34:02，4小時attempt冷卻到17:34:02之後。9/17法人／外資持股／融資券各53、借券33；20檔缺來源＋00918歷史範圍不足保留，不補零、不勾3.2。
- 在官方TWSE歷史月查詢入口與TPEx股票代碼查詢頁確認API／欄位後，只取得4檔有既有正值歷史的最後月份及同月官方收盤：1101為2025/11，3055為2024/03，3363／4768為2026/05。8個實際官方資料GET均200；同日正值PE與收盤價的重疊分別8／8／8／7筆，31組價差及PE差全部0，滿足既有0.01門檻。
- 使用現有受保護歷史匯入API提升既有資料，沒有重抓五年FinMind歷史，也沒有直接修改SQLite。1101提升1018列、3055提升232列、3363提升760列、4768提升990列；其中31筆由官方同日列替換同鍵資料，總列數未增加、不重複、不把空白補成零。
- 真實來源揭露三個程式缺口：TWSE「114年11月12日」未解析、TPEx收盤月報「日 期」未匹配，114Q4被原未錨定正規式誤讀為1922年。已明確支援來源格式，保留N/A/null，不放寬正數與日期配對。
- 匯入成功原本只更新fetch state，job還停在舊blocked／partial；現以已驗證筆數及實際完成月數更新閒置job，保留attempt、排除running／有效lease／not_eligible。較舊歷史不覆蓋新latest_source_date及official_source_date。1101／3055最初匯入後發現此問題，修正後只重用保存payload各重播一次收斂job，沒有再發來源GET；保留原成功及舊失敗紀錄。
- Live API：1101 available、1018筆、verifiedEnd2025-11-12；3363 available、760筆、verifiedEnd2026-05-13；4768 available、990筆、verifiedEnd2026-05-12。這是可用的已驗證歷史，不宣稱這些股票最新日PE為正或五年每交易日都有PE。PE整體ready39→42/44，pending2。
- 3055已完成來源核對但只有232筆<252，仍insufficient_history。3149仍0列；額外一次官方2026/08月报GET200、21列PE均「-」，沒有偽造樣本、沒有把普通股永久排除，也不能據單月推論五年全部無PE。3.3仍未勾，保留兩檔的實際資料限制。官方資料GET共9次；頁面與API格式查核另計，本機tick次數不等於上游實體請求總數。
- health history為38ready／2insufficient／4blocked；額外4個blocked是1303、2344、2408、2409較廣歷史工作，與本輪5檔來源核對清單不同。整體42ready不是全部history工作完成。
- 新增／加強日期、年季、232/252門檻、job狀態、來源日期不得倒退、attempt保留、active lease及mismatch回歸；PE相關38/38通過，build、tsc、scope ESLint通過。Vite直接使用repo修正，沒有啟停共用服務或另開資料runner；正式Cloudflare程式未改版。
- 證據：outputs/local-maintenance/pe-official-overlap-20260918-1337.json、pe-tpex-overlap-20260918-1343.json、pe-api-verified-20260918.json、db-20260918-1345.json、health-20260918-1345.json、pe-repair-tests-20260918.log及各原始官方月報JSON。官方入口：https://www.twse.com.tw/en/trading/historical/bwibbu.html 與 https://www.tpex.org.tw/zh-tw/mainboard/trading/info/stock-pe.html 。

- 本輪結束前scheduler實際next_run_at=2026-09-18T16:26:11+08:00；三組checkpoint皆巡訪，整體仍incomplete。simulation、2330 business Snapshot、watchdog healthy零重啟、8080／5173／5174 listeners及D1 integrity皆正常，production停止、write master disabled；未commit／push／archive。


## 2026-09-18 16:28 例行維護

PE整體42/44、history38ready／2insufficient／4blocked；3055、3149仍樣本不足，已核實歷史不重抓。借券13:33–13:34嘗試的21筆仍在4小時冷卻，未提前重試。health chip ready26／pending27為freshness條件變動；唯讀DB9/17法人／外資持股／融資券各53、借券33仍保留，不能把pending增加当作資料消失。日K歷史53complete／through9/17維持；目前expectedCompletedSession已切到9/18、當日coverage0/53，尚未執行16:45 daily排程，沒有當成9/17歷史回歸或重跑舊稽核。讀回每日週一至週五16:45日曆及loaded job，20:27下一輪核對實際9/18推進。TDCC healthy、53/53、source9/11、archive18/18；simulation、business Snapshot2330、watchdog零重啟、8080／5173／5174及D1 integrity正常，production停止、write master disabled。三組已巡訪，無程式修改、無外部資料寫入或服務啟停；證據outputs/local-maintenance/health-20260918-1627.json與db-20260918-1629.json。


## 2026-09-18 20:34 三組晚間維護

- Fresh health 與唯讀 DB 證明16:45自動daily確實執行（run sites-scheduled-1789721101000，16:46完成），19:21另有已完成run；本輪未重跑。9/18日K當日資料53/53，歷史連續性48complete／5unknown（2882、3008、3026、3055、8103，provider_unavailable或invalid_response），不能把當日coverage當作完整历史驗收；9/17既有3.1證據保留。
- 9/17法人／外資持股／融資券各53、借券33仍保留；9/18目前法人46、外資持股0、融資券0、借券33。22:00發佈切點前orchestrator expectedSession仍9/17，未強推未到期日報。Warm ready37／pending16；依目前實際程式規則唯讀計算25筆pending datasets、due0，最早借券4小時冷卻到23:21:44，部分UI讀取後至9/19 00:32；不沿用13:34舊attempt提前重試。3.2仍未完成，不將來源空白補零。
- PE整體ready42/44，history38ready／2insufficient／4blocked；latest TWSE9/17、TPEx9/18，fresh39／pending4。3055／3149樣本不足仍未解決，3.3不勾選，也未重抓既有官方重疊歷史。TDCC continuous healthy、53/53、source9/11、archive18/18；runtime彙總available_not_verified仍如實保留。
- simulation、business session與2330 Snapshot available、watchdog healthy且零失敗／重啟、8080／5173／5174 up、D1 integrity ok；production停止、write master disabled。未啟停服務，未下單、commit、push或archive。
- 證據：outputs/local-maintenance/health-20260918-2032.json、db-20260918-2034.json、cooldown-20260918-2035.json、runtime-20260918-2034.txt。所有三組已巡訪，整體仍incomplete。Cloudflare fresh gate額度不足維持11/18；tick-tape5.1既有完成不重跑。

## 2026-09-21 09:02–09:10 例行維護與台股週日假K防護

- Fresh本機health加唯讀D1：9/18日報法人／外資持股／融資券各53/53，借券38/53；9/17借券仍33/53，不能把缺回應填零。PE42/44 ready，history38 ready／2 insufficient／4 blocked，3055與3149仍未達來源及樣本門檻；3.2／3.3不勾。TDCC continuous健康，53/53、source9/18，archive18/18；已完成任務不重跑。09:02當日尚在開盤，expectedCompletedSession=null，health 0/53不是前一完成交易日9/18資料遺失。
- 新發現16檔Yahoo台股1d的state coverageEnd顯示9/20週日；唯讀DB核對其中00878有兩筆9/20 10:16／12:00來源列，非官方交易日且量價變動，verifiedThrough仍9/18。這些不是合法日K，不可顯示於圖表或算進指標。
- `candle-history`新增台北週末過濾，在入庫、讀庫及state刷新使用；`market-data`在Yahoo擷取與畫圖前也過濾。保留原DB來源列作事故證據，不直接刪資料；以已過濾列修正該商品coverageEnd，阻止舊MAX規則繼續保留週日終點。台灣正式休市日中的平日仍由原官方交易日continuity稽核判斷，週末過濾只處理這次明確的非交易日來源缺陷。
- 00878真實本機`/api/candles`一次查核：最後5筆9/14、15、16、17、18，20筆中週末0；同時唯讀DB仍有2筆週日原始列，state coverageEnd已回到9/18、continuity complete/through9/18。27項candle-history回歸、MultiView typecheck與build通過。5174及共用行情服務沒有重啟；尚未逐一刷新其餘15檔，後續讀取會套用同一過濾及狀態收斂。
- 9/20 Cloudflare其他維護run的tick_limit_exceeded／provider_unavailable失敗另見Cloudflare線；本地工作未以清除收據掩蓋。新防護已在本地源碼，沒有將其直接部署到Cloudflare正式站。

## 2026-09-21 11:03–11:30 Chrome 錯誤代碼 5 與 5173／5174 中斷修復

- 使用者截圖為 Chrome「無法開啟這個網頁／錯誤代碼：5」。當下唯讀核對 listener 與 HTTP：5173、5174首頁及8080 `/api/v1/health`均為200，Vite PID 920／926、simulation API PID 1256均未中斷，排除本機server停止。
- Chrome Crashpad 在10:12:22與11:03:08各新增 renderer dump；兩筆皆為同一 Chrome Framework 位址的 `EXC_BREAKPOINT/SIGTRAP`，11:03時間與截圖一致。dump僅確認renderer崩潰，不將其冒充應用堆疊。5173與5174均屬同一localhost site，renderer資源失控可同時影響兩個port的頁面。
- 以真實5174四圖盤中頁重現：單一Chrome renderer數分鐘內升至約4.5GB RSS並接近滿載CPU；關閉診斷頁後該負載消失。程式追查顯示 `renderDailyKlines` 對同交易日每一筆即時Snapshot執行 `applyPayload`，反覆重套所有主圖、技術指標與籌碼pane完整series。
- 已把同交易日且K棒數不變的路徑改為 `candleSeries.update` 最後一棒、籌碼時間錨點增量更新及latest-wins技術指標排程；只有換交易日或K棒結構改變時才完整計算並 `applyPayload`。成交量、最新價、資料時間、continuity、固定讀值與價格軸仍同步更新。
- 載入修正版前，共用localhost renderer已由約4.5GB繼續增至6.4GB；只終止該已失控renderer，不重啟Chrome、Vite、simulation API或watchdog。原5173與5174分頁隨後均在原網址重新載入，四圖頁及選股頁實際內容可讀；另兩個使用中的5173／5174分頁也已載入修正版。
- 全新renderer載入真實5174四圖頁後，以10秒間隔連續50秒量測RSS為423.8、426.4、427.5、428.8、426.7、424.8MB，沒有先前數GB持續增長；四個本機分頁的Chrome頁籤記憶體顯示約125、136、357、212MB。Crashpad最新檔仍為11:03:08，驗收期間沒有新增dump；診斷用分頁已關閉。
- 驗證：`node --test apps/multiview/tests/subchart-interaction.test.mjs apps/multiview/tests/realtime-charts.test.mjs` 65/65通過；`pnpm typecheck:multiview`、`pnpm build:multiview`及scope `git diff --check`通過。8080／5173／5174全程維持原PID，未啟用production、CA或下單。

## 2026-09-21 15:26–15:51 盤後 Shioaji 日線空圖與長等待修復

- 真實來源並未慢到足以造成空圖。從5174 `/local-shioaji` 逐檔查核：00918／00919／00878／00929 Snapshot分別約59／64／38／67ms；365日Kbars分別約278／265／275／312ms，回傳63,163／64,010／63,909／63,402筆，最後一筆均為2026-09-21收盤資料。四檔canonical均有資料；00919的close已核實，但high與volume仍mismatch，其餘三檔也未完成整體核對。核對狀態不再阻止Shioaji圖表顯示，且只有status=verified而fieldResults仍有mismatch時也不得接手完整canonical OHLCV。
- 根因一：coordinator先派送Kbars session、後派送snapshot，而日線繪製要求snapshot；收盤後不一定再有即時事件觸發重畫。根因二：強制Shioaji在fallback／stale／unavailable時直接清空K棒。兩者合併使canonical待核對的盤後面板長留空白。
- 根因三：每個日線面板把365日約六萬筆一分鐘Kbars逐筆轉成rich object並逐筆做時區格式化，再聚合成日K。四圖初始載入曾讓單一renderer約4.1GB並持續高CPU，與先前頁面錯誤代碼5的資源耗盡路徑一致。
- 修正後snapshot先於歷史派送；有效Kbars可獨立建立盤後quote並保留到canonical核實；暫時連線失敗保留最近Shioaji Kbars。日線由原始欄式陣列直接彙整每日OHLCV、common_lot成交量與current-schema成交值，daily與minute cache identity分離；分時與指定日期仍取得分鐘資料。
- 真實Chrome四圖以00918／00919／00878／00929、日線、Shioaji即時驗收：四圖均顯示，收盤價34.19／32.27／35.11／29.06，四個狀態均為「已收盤，顯示 Shioaji Kbars；等待 canonical 日 K 核對」，共168個canvas。連續三次冷重新整理後四價與四狀態再次出現；console error／warning為0。新renderer在多次重新整理後CPU為0，RSS約504–709MB，未再出現先前數GB持續增長。
- 回歸：`node --test apps/multiview/tests/realtime-coordinator.test.mjs apps/multiview/tests/taiwan-stock-volume.test.mjs apps/multiview/tests/realtime-charts.test.mjs` 50/50通過；`pnpm typecheck:multiview`與`pnpm build:multiview`通過。全專案`pnpm lint:multiview`被既有未修改的`stock-screener-v4-publisher-route.test.mjs:133`未使用`evidenceHash`警告擋住，本次四個變更檔另做scope lint且零警告。8080健康，5173 PID920、5174 PID926全程維持，未重啟共用服務、未啟用production或下單。

## 2026-09-21 16:39 台北：本機來源 fresh 巡訪

- Fresh 5174 health與唯讀D1顯示今日已自動推進：日K52 complete／1 unknown，9/21 coverage 40/53；unknown為2882 provider_unavailable，未將未取得資料補造。法人來源日已到9/21；借券來源日到9/21，但今日目前只1檔有列。外資持股、融資券仍以9/18為最新，等待盤後正式來源發布與16:45既有排程，不提前把空白當成完成。
- 歷史日報逐日唯讀計數：9/17法人／外資持股／融資券53/53、借券33/53；9/18前三類53/53、借券38/53；9/21當下只有8筆日報，其中法人8、借券1。借券fetch state持續顯示來源真實的`partial_data`／較早coverage；仍不足以把原20檔逐一判定為合法無成交或不適用，3.2不勾、不補零。
- PE維持42/44 ready，history 38 ready／2 insufficient／4 blocked；3055與3149最低樣本不足未改變，3.3不勾且不重抓已驗證的1101／3055／3363／4768官方重疊資料。TDCC continuous健康、53/53、source9/18、archive18/18，完成項未重跑。
- 證據：`outputs/local-maintenance/health-20260921-1639.json`、`outputs/local-maintenance/lending-state-20260921-1640.json`及同一D1的唯讀逐日count。simulation、watchdog、8080／5173／5174維持運作，production與write master停用。

## 2026-09-22 16:28–16:35 台北：本機來源 fresh 巡訪

- `pnpm local-runtime status` 與 `/api/health` 顯示 simulation API、business session、5173、5174、watchdog及 D1 integrity 均正常；watchdog `restart_count=0`，production停止、write master停用。本輪沒有啟停共用服務或觸發交易寫入。
- 日 K 目標已擴至54檔；當下52檔 continuity complete、2檔 unknown（2882、3149皆為來源 `invalid_response`），9/22盤中最新session coverage為9/54。這是尚未到16:45盤後排程的即時狀態，不能當成前一完成交易日資料遺失，也沒有補造K棒。
- 借券來源已有實際前進：唯讀D1於2026-09-21找到32檔正式列；57個現存fetch state中32檔為`available`、25檔為`partial_data`。仍不能將其餘商品的來源空白補零或一律判為不適用，task 3.2保持未完成。當日上午daily orchestrator保存processed40／remaining3／pending26的receipt，沒有清除舊失敗或重新建立第二個runner。
- PE目前product health為43/45 ready、history為35 ready／1 insufficient／5 missing／4 blocked。3055仍只有232筆（2023-03-28至2024-03-12），job為`partial/insufficient_history`；3149仍0筆，fetch state為`partial/official_gap`，普通股未永久排除。已驗證的1101／3055／3363／4768重疊資料沒有重抓，task 3.3保持未完成。
- 本機TDCC仍54/54且archive18/18，不重跑完成項。成交明細完整盤中驗收已於2026-09-17完成並於2026-09-21歸檔，本輪只讀確認archive task 5.1與13:30:25 SSE證據，不重跑盤中驗收。
- 16:45既有launchd盤後pipeline如期執行，`runs=2`、`last exit code=0`，沒有手動建立重複runner。執行後9/22最新session coverage由9/54前進至54/54；continuity為30 complete／24 unknown，latest run因來源`invalid_response`／`provider_unavailable`停在processed50／remaining4的`retry_waiting`，保留逐檔狀態且不把coverage冒充完整驗收。法人、外資持股、融資券來源均核實至9/21；借券coverage到9/21但仍有`partial_data`。PE history由35 ready／5 missing前進至39 ready／0 missing，仍有2 insufficient及4 blocked；latest TPEx為`official_not_published`，因此3.2／3.3仍不勾選。

## 2026-09-22 Maintenance receipt 測試 runner 補正

- `scripts/maintenance-run-receipt.test.mjs` 改由專案 root 的 Vitest 註冊測試，保留原三項 checkpoint、blocked 與完整證據契約；不修改 receipt runtime 行為。
- Focused Vitest：2 files、11 tests passed；repo-wide `pnpm test`：251 files、2548 tests passed，不再出現 `No test suite found`。
- `pnpm build`、`openspec validate repair-local-multiview-after-hours-progress --strict` 與 scope whitespace／diff check：通過；task 3.2、3.3 仍依正式來源證據維持未完成。

## 2026-09-23 08:39–08:44 台北：補做排程巡訪

- 盤前 `expectedCompletedSession=null`，不以當日 `latestSessionCoverage=0/60` 誤判前一完成交易日缺檔。simulation API、business session、8080、5173、5174、watchdog與 D1 integrity 均正常，watchdog零重啟；production停止、write master停用。
- 9/22盤後正式資料已自動前進：法人、外資持股、融資券各60/60；借券有39/60正式列，health來源日與coverage end均為9/22。其餘21檔仍須依正式來源分類，未補零，task 3.2保持未完成。daily orchestrator於08:34完成processed11／remaining0／pending24，保留`source_not_published`與4小時冷卻，不建立重複runner。
- PE latest兩市場來源日均到9/22，產品ready47/51；history為38 ready／9 missing／4 blocked。新增個人清單使target由45擴至51，不能把missing增加說成既有資料倒退。原驗收兩檔仍未達門檻：3055為232筆、3149為0筆；已核實的1101、3055、3363、4768重疊資料沒有重抓，普通股3149未永久排除，task 3.3保持未完成。
- 本機TDCC health仍有歷史59週、coverage end 9/18，但聚合source date顯示9/11且狀態為`available_not_verified`；本輪保留此不一致，不以舊53/53或單一aggregate欄位宣稱新60檔全部完成，也未重跑已驗證archive。
- 成交明細完整盤中驗收已於9/21歸檔，本輪只讀確認archive task 5.1及9/17 13:30:25真實SSE證據，不重跑。

## 2026-09-23 21:45 台北：盤後補做排程巡訪

- 既有16:45 launchd daily pipeline 已完成且 `last exit code=0`，後續 sites-worker orchestrator 於21:33–21:39持續推進；本輪沒有建立重複runner或重跑已完成項。simulation API、business session、5173、5174、watchdog與D1 integrity維持運作，production停止、write master停用。
- 日K 60/60 都有2026-09-23最新session資料；長期continuity為34 complete／26 unknown、0 partial，unknown均保留官方來源 `invalid_response` 等逐檔證據。這些商品沒有缺少今日K棒，仍不能把latest session coverage冒充完整歷史稽核。
- 2026-09-22盤後資料在唯讀D1為法人、外資持股、融資券各60/60，借券39/60；2026-09-23目前只有4檔日報列。health顯示前三類來源已到9/23，借券coverage end為9/22且source date仍9/21、reason為`partial_data`。其餘借券商品仍須來源分類，未補零，task3.2保持未完成。
- PE product health為47/51 ready、3 pending；latest fresh44、pending1，TWSE最後核實來源日9/22、TPEx為9/23。history已推進至43 ready、4 insufficient、0 missing、4 blocked；3055仍232筆且job為`partial/insufficient_history`，3149仍0筆且同為`partial/insufficient_history`，普通股未永久排除，task3.3保持未完成。
- 本機TDCC唯讀D1已有59個data dates、最新2026-09-18、2,331個symbols；backfill顯示coverage end 9/18、savedWeeks59。但aggregate shareholder-distribution仍顯示source date／coverage end 9/11，continuous最後一輪雖52/52完成卻因`invalid_response`標為failed。此不一致保留為待修驗收，未以archive18/18或單一表計數宣稱整體verified，也未重跑已完成archive。

## 2026-09-24 16:10 台北：補做排程 fresh 巡訪

- `pnpm local-runtime status` 與 fresh `/api/health` 顯示 simulation API、business session、5173、5174、watchdog及 D1 integrity 正常；watchdog失敗／重啟均為0，production停止、write master停用。本輪未啟停共用服務或建立第二個runner。
- 當時尚未到既有16:45 launchd盤後pipeline。日K expected session 已切到9/24，最新session coverage為16/60，continuity為32 complete／28 unknown；這是盤後來源尚在發布及既有排程尚未觸發的狀態，不能當成前一完成交易日資料遺失，也未提前補造K棒。
- 法人、外資持股、融資券的source date與coverage end均為9/23；借券coverage end為9/23但source date仍7/31、reason為`partial_data`。唯讀D1於9/23分別有法人39、外資38、融資39、借券27筆；其餘商品仍須正式來源分類，未補零，task 3.2保持未完成。
- 本機TDCC backfill已有59週、coverage end 9/18、2,331個symbols；continuous run `local-tdcc-20260924`雖完成60/60且無missing／blocked，仍因`invalid_response`標為failed，而aggregate shareholder-distribution仍停在9/11。保留兩者不一致，未以60/60冒充verified，也未重跑已完成archive。
- PE product health為47/51 ready、3 pending；history為43 ready／4 insufficient／0 missing／4 blocked，3055仍232筆、3149仍0筆。普通股3149未永久排除，已驗證的官方重疊歷史未重抓，task 3.3保持未完成。

## 2026-09-27 22:14–22:31 台北：週日 TDCC 排程實際觸發但來源逾時

- Fresh 唯讀基線顯示 2026-09-24 日報共 61 檔：法人、外資持股、融資券均 `61/61`，借券 `41/61`，仍有 20 檔缺正式來源列；未補零，也未將來源空白直接判為無成交或不適用，task 3.2 保持未完成。
- 週日 22:30 的既有 `launchd` TDCC pipeline 確實由 `runs=1` 前進至 `runs=2`，PID 啟動後約 23 秒結束。D1 收據 `local-tdcc-20260927` 保存 `status=failed`、`error_code=timeout`，target／queued／claimed／completed／blocked 均為 `0`，表示在取得可規劃的官方日期／來源前就逾時，沒有部分寫入冒充成功；`next_retry_at=2026-09-27T20:30:35.172Z`（台北 2026-09-28 04:30:35）。依來源冷卻保留失敗，不密集手動重試。
- PE 唯讀資料未變：3055 為 `232` 筆（2023-03-28～2024-03-12），3149 仍為 `0` 筆；兩者都未達完成門檻。3149 是普通股，未永久排除；已驗證歷史未重抓，task 3.3 保持未完成。
- 排程後 simulation API、business session、watchdog、5173、5174、D1 integrity／coverage 仍正常，watchdog失敗與重啟皆為 `0`；production停止、write master disabled。這次是來源 timeout 的真實失敗，不是排程未啟動，也沒有啟用交易或重啟共用服務。
- 既有16:45 pipeline仍loaded、前次exit code 0；本次16:10巡訪未在正常觸發前強制建立重複runner，後續以同一既有排程的真實結果判定9/24來源進度。

## 2026-09-28 08:54–08:58 台北：冷卻到期後有界補跑恢復

- 9/27 逾時收據的 `next_retry_at` 已於台北 04:30:35 到期；08:56 確認沒有在途 TDCC pipeline 後，以相同受保護、有界 `pnpm local-runtime multiview-tdcc` 補跑，沒有清除失敗記錄或建立並行 runner。
- 新收據 `local-tdcc-20260928` 於 00:56:57–00:57:50Z 完成：`latest_data_date=2026-09-24`、target/completed=`61/61`、queued/claimed/blocked=`0/0/0`，歷史 claim 為空，因此沒有重抓已完成週期。原 `local-tdcc-20260927` timeout 依然保留在 D1。
- 9/24 日報的法人、外資持股、融資券仍為 `61/61`，借券為 `41/61`；剩餘 20 檔沒有正式來源列，未補零或擅自分類，task 3.2 保持未完成。PE 仍為 3055 `232` 筆、3149 `0` 筆，task 3.3 保持未完成。
- 補跑後 simulation API、business session、watchdog、5173、5174 與 D1 integrity/coverage 均正常，watchdog 失敗與重啟為 0；production 維持停止，write master 維持 disabled。

## 2026-09-25 18:05–18:11 台北：接續同一停滯 daily run

- 16:45既有daily pipeline確實執行，log於16:56結束；日K來源回覆`provider_unavailable`，continuity run進入`retry_waiting`，PE本輪8個history claim亦全部保留`provider_unavailable`，沒有補造資料。Fresh runtime仍為simulation，API、business session、5173、5174、watchdog及D1 integrity正常，production停止、write master停用。
- Health顯示同一daily orchestrator `sites-scheduled-1790326605000` 自16:56停在running、processed40／remaining20，heartbeat超過1小時未更新。沒有另建run；在來源backoff已到期後，使用相同run id經既有受保護loopback endpoint逐筆接續。
- 首兩次tick確認processed40→42、ready0→2；其後18次tick串行完成processed60／remaining0，run狀態為completed。pending由60降至48，其餘12檔已有可用資料；48檔仍保留正式來源pending／provider狀態，HTTP完成不冒充所有資料完整。
- 本機TDCC仍為backfill coverage end 9/18／59週，但aggregate shareholder-distribution source date仍9/11；continuous health於接續前呈現`scheduler_stale`。此不一致未清除或補零，task3.2／3.3仍維持未完成。

## 2026-09-28 09:34–10:10 台北：借券與 PE 官方缺口程式

- TWSE 借券成交全市場 `t13sa710` 以 2026-09-24 實測取得 1,288 筆；2330 正控制共 28 筆、成交數量合計 12,689，來源可用且涵蓋整體市場。20 檔缺列商品在同一有效全市場檔中均無列，因此程式新增 `official_no_activity`，保存核對日期但不新增當日 0 借券列，並以全市場 single-flight／30 分鐘記憶體 cache 避免每檔重抓。
- PE 新增 TWSE `BWIBBU` 月本益比與 `STOCK_DAY` 月收盤的有界回補。整月 P/E 空白只寫入空的 `official_gap` 月 checkpoint；有正值才下載收盤月報並配對同日資料。FinMind 失敗不阻止官方月份 checkpoint，307／403 分類為 `provider_unavailable`，不繞過來源保護。
- blocked／partial job 只能透過受保護 `multiview-pe-official <symbols>` 明確重新認領；attempt 與既有月份證據保留，官方模式只 claim 列出的 TWSE 商品。每商品每輪六個月份，月份間隔兩秒。
- 實際執行 3055、3149：3055 完成月份為 31/61、verified rows 232（2023-03-28 至 2024-03-12）；3149 完成 16/61，全部為官方空白月、verified rows 0。10:07 TWSE 開始回 HTTP 307 且無 `Retry-After`，停止續跑並保留舊收據；程式已修正後續將 307 記為 `provider_unavailable`。3.11 與 3.3 保持未完成，待來源恢復後從 3055 2023-02、3149 2022-12 的未完成月份接續。
- 回歸：官方 PE／runner／借券 92 項通過；新增明確官方回復模式後 PE 32 項通過；MultiView typecheck、build、scope ESLint、runtime Vitest 35 項、OpenSpec strict 與 scope `git diff --check` 通過。

## 2026-09-28 10:26–11:15 台北：官方缺口終態驗收

- 借券 20 檔已全數以 2026-09-24 的 TWSE 全市場成交檔分類為 `official_no_activity`：`0056.TW`、`006208.TW`、`00918.TW`、`00919.TW`、`00929.TW`、`009816.TW`、`009819.TW`、`00981A.TW`、`00982A.TW`、`00991A.TW`、`1809.TW`、`2436.TW`、`2615.TW`、`3055.TW`、`3441.TWO`、`3675.TWO`、`3715.TW`、`4768.TWO`、`8054.TWO`、`8103.TW`。20/20 fetch state 的 `source_date=2026-09-24`；`coverage_end` 沒有因無成交假推進，當日新增的借券零值列為 0。
- 3055、3149 以受保護官方模式逐批接續，完成目前五年視窗 2021-09～2026-09 的 61/61 月份。3055 保留 232 筆有效正值（2023-03-28～2024-03-12），3149 為 0 筆；兩者都明確為 `partial/insufficient_history`、沒有 retry 或 lease。3149 仍是普通股，不標記 `not_eligible`。
- 發現舊 2021-08 checkpoint 仍作歷史證據時，completed count 曾顯示 62/61；修正所有 job completion 與明確官方模式的進度計算，只統計目前 `target_start`／`target_end` 月份。修正後 API 與 D1 均為 61/61，額外舊 checkpoint 未刪除。
- 完成後再次執行相同官方模式，`historyClaimed=0`、`officialHistoryMonths=0`，證明已完成月份不重抓。task 3.2、3.3、3.11 的驗收成立；依當時 252 筆規則，完成代表來源分類與回補終止條件已核實，不代表 3055／3149 可繪製。

## 2026-09-28 PE 足量門檻調整與實際重算

- 原 252 筆約等於完整交易年，但 3055 已有 232 筆經核實正值，涵蓋 2023-03-28～2024-03-12 共 350 個日曆日；只因交易日數少於 252 而禁止顯示，與實際資料跨度不符。
- 足量規則改為至少 220 筆且最早、最晚樣本相隔至少 300 個日曆日。220 筆使 P5／P95 尾端各約有 11 個觀測值；300 日條件阻止短期密集資料誤通過。官方、可信重疊、最近五年、正值與暫代資料不列入樣本等既有條件不變。
- `buildPeRiver`、latest／history fetch state、backfill job、受保護 runner 與前端不足提示共用相同規則。新增邊界測試：220 筆且 300 日以上通過、219 筆失敗、220 筆但少於 300 日失敗、232 筆／350 日既有完成月份只重算狀態而不重抓。
- 11:31 以受保護本機命令重算 3055、3149：`historyClaimed=0`、`officialHistoryMonths=0`、`officialHistoryRows=0`。3055 API 為 `available`、backfill `complete/available`、232 點、350 日；3149 維持 `insufficient_history`、0 點、0 日，未被永久排除。
- runtime 維持 simulation；API、watchdog、5173、5174 與 D1 integrity 正常，production 停止且 write master disabled。
