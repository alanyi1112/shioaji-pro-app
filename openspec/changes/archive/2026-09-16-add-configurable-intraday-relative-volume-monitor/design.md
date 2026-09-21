## Context

RealTimeStock 已具備本機 Shioaji 即時行情、K 線 workspace、server-backed 自選清單、收盤後選股新分頁，以及智慧單使用的有界 quote subscription coordinator。Shioaji 公開的 200 subscriptions 限制不能直接解讀為 200 檔股票，現有 HTTP binary 又沒有 physical inventory／confirmation diagnostics；因此本 change 不再以修改 server 或取得全域 ownership 為交付前提，改採既有多商品 realtime KBar capability 的 20 檔固定 cohort 試辦。

本功能以「使用者最多設定 200 檔候選商品」取代「全市場即時掃描」。使用者開啟「盤中選股」專用分頁後，盤中監控才提出即時需求；runtime 保存已確認的分鐘觀測與基準，將今日最後一個已完成分鐘的累積成交量，與上一個適用交易日同分鐘的累積成交量比較。任何來源、單位、交易日、時間、序號、容量或基準不確定，都必須顯示原因並停止新增觸發。

主要利害關係人是本機 simulation 使用者、行情與圖表功能、警示與智慧單等既有即時 consumer，以及後續負責容量驗證與資料對帳的維護者。

## Goals / Non-Goals

**Goals:**

- 提供最多 200 檔的可設定監控名單，並清楚區分 configured、eligible、active、waiting 與 degraded。
- 以單一多商品 KBar request、單一專用 SSE 與最多 20 檔固定 cohort，對實際收到資料的商品建立可重播分鐘累積量與同分鐘量比。
- 提供 1.5、2、3 倍快速選項及合法自訂門檻，產生可稽核、同日去重的達標事件與通知。
- 建立「盤中選股」新分頁，讓監控設定、達標結果與 K 線在同一 viewport-safe workspace 操作。
- 讓結果商品可明確且冪等加入名稱精確為「盤中選股」的自選清單，不改動目前作用中的清單或交易狀態。
- 以 bounded KBar Gate、固定 20 檔 shadow recording、重播與 dry run 證明正確性；configured、cohort、實際收到資料的 active 檔數及未知 provider physical usage 必須分開記錄。

**Non-Goals:**

- 不做全市場即時掃描，也不保證 200 檔可同時啟用。
- 不以 Snapshot、ticks、Kbars 輪詢或定時輪替訂閱代替持續即時訂閱。
- 不建立自動下單、策略啟用、帳務或持倉功能；達標事件沒有 broker write authority。
- 不啟用 production、真實下單、第二個 Shioaji login、多帳戶共享、Cloudflare／Sites 即時監控或遠端常駐服務。
- 不修改既有收盤後選股的條件、資料日期、「選股」自選清單或 MultiView 個人清單。

## Decisions

### 1. 以兩個 capability 隔離監控引擎與操作介面

`intraday-relative-volume-monitor` 負責設定模型、subscription admission、分鐘資料、基準、判定、事件與證據；`intraday-stock-selection-workspace` 負責新分頁、版面、lease、K 線與自選清單互動。兩者透過版本化本機 API／event schema 連接，不直接共享 React state。

此設計可讓 recorder 與判定接受獨立重播測試，也避免把盤中事件混入既有盤後 snapshot。替代方案是擴充 `after-market-stock-screener`，但兩者的時間語意、資料來源與生命週期不同，會使 stale／current 與清單名稱難以正確隔離，因此不採用。

### 2. configured 200 與固定 active 20 分離

設定層最多接受 200 個去重後合法台股整股 STK 合約；試辦只取使用者排序前 20 個 eligible 商品形成 immutable session cohort。2026-09-07 實機回應證實 `/stream/subscribe/kbars` 的 1 分 KBar stock code 只接受四位 ASCII 數字；同日 3 分鐘 20 檔 rehearsal 又證實 `0050`、`0056` 雖然 batch accepted，但在其他 18 檔皆有連續 KBar 時完全沒有逐檔事件。因此本 change 的 pilot eligibility 保守限定為四位數且不以 `00` 開頭的普通股代號；其他仍屬合法 STK 的代號可保留 configured，但必須標為 `kbar_contract_unsupported`、不得計入 eligible 或 cohort。第 21 個 eligible 商品起顯示 `waiting_pilot_limit`，同一 session 不輪替、不因個別無資料或 unsubscribe accepted 而補位。這是本產品的保守上限，不是對 Shioaji physical counting dimension 的宣稱。

啟動前必須確認 loopback API、`simulation=true`、固定 cohort hash、單一 KBar SSE、通知關閉及非 production；以一次 `POST /api/v1/stream/subscribe/kbars` 提交整批。只有實際收到合法 KBar 的商品可計入 active；HTTP accepted、SSE connection count 或其他 consumer 狀態都不得冒充逐商品資料可用。

### 3. 盤中監控只管理自己的 bounded KBar transport

盤中監控 sidecar 不接管 chart、watchlist、alert、smart order、MultiView 或外部 client，也不自行建構虛假的全域 inventory。它只保存自己建立的 cohort、SSE generation、subscribe／unsubscribe request 摘要、每檔實際 KBar coverage 與停止原因。

每個 session 最多一個 subscribe batch；停止時只對完全相同 cohort 送一次 unsubscribe。因 `success=true` 只能視為 accepted，runtime 不在同一 Shioaji process／session 內重用或補配推定已釋放的容量。需要開始新 cohort 或正式完整日試辦時，由 operator 在既有 simulation-only 授權下建立新的乾淨 session boundary；產品功能本身不得自動重啟服務。

### 4. 頁面 lease 驅動監控 demand，runtime 負責資料與事件

每個「盤中選股」分頁建立有期限的 lease，使用 heartbeat 續期。至少一個合法 lease 存在時，runtime 才依監控設定提出 intraday-only demand、保存分鐘資料並執行比較；所有 lease 到期後，runtime 完成已開始的原子 flush，釋放 intraday-only demand並停止新增事件。已保存的設定、基準、分鐘資料與當日觸發不因關頁被刪除。

多分頁只增加 lease refcount，不重複訂閱或重複通知。瀏覽器崩潰時由短 TTL 自動回收；正常關頁可 best-effort release，但 correctness 不依賴 `beforeunload`。

替代方案是只在前端聚合，會因分頁休眠、重整與多分頁競爭而遺失或重複事件；另一替代是全天常駐 200 檔，則違反使用者要求的頁面啟動邊界並長期占用容量，因此都不採用。

### 5. 以 realtime KBar `volume` 建立 canonical 累積量

即時輸入只接受專用 KBar SSE 的合法台股整股 STK 1 分棒，將每根 `volume` 以 `common_lot`（張）單位依 minute key 單調累加。每筆 observation 包含 canonical contract、trade date、bar time、receive time、stream generation、per-symbol sequence、來源版本與品質旗標。重複 minute、舊 generation、跨日、亂序、負量或未知單位不得推進狀態。

2026-09-07 simulation 實測顯示 KBar 約在標示分鐘後 2.5 秒送達，且稍後歷史 Kbars 的同分鐘量一致；runtime 仍採保守 one-bar delay：收到下一個連續 minute 或 session-close seal 後，前一根才成為 completed。任何 gap、重連或 cohort 外事件都使受影響分鐘為 unknown，不以 0 或 carry-forward 補造。累積量只對連續、已 seal 的棒加總。

替代方案是瀏覽器加總 tick `volume`，會受漏 tick 影響；直接把剛送達的 forming KBar 當完成棒則可能提早觸發，因此皆不採用。

台股個別有價證券可能因收盤前瞬間價格穩定措施延後至 13:33 撮合。現有 Shioaji HTTP API 沒有提供可驗證的逐檔延後收盤旗標，因此 recorder 不得在 13:31 對整批 cohort 封存或取消訂閱。試辦採保守共同邊界：維持相同單一 SSE 與 immutable cohort 至 13:33 後，保留 90 秒資料傳輸寬限期，最早於 13:34:30 才核發不可偽造的 session-close authority。

規則依據為[臺灣證券交易所集中市場交易制度](https://www.twse.com.tw/zh/products/system/trading.html)、[臺灣證券交易所投資人問答](https://investoredu.twse.com.tw/pages/TWSE_InvestmentQA.aspx?ID=14)及[證券櫃檯買賣中心交易系統簡介](https://www.tpex.org.tw/zh-tw/mainboard/trading/rules/system.html)。市場制度的 13:33 是撮合時點；額外 90 秒只是本 recorder 對本機 HTTP／SSE 傳輸的有界寬限，不得解讀為市場交易時間延長。

一般商品的最後 forming 棒仍為 `13:30`；若 provider 在 13:33 送出延後收盤 KBar，recorder 只在相同 generation 的 regular-session sequence 已連續至 13:29 時接受。來源若有 13:30 forming 棒，將 13:33 撮合量接續併入；來源若因 13:30 沒有實際撮合而從 13:29 直接送出 13:33，則由 13:33 延後撮合事件證明該合法收盤橋接。兩種情況都只形成 canonical `13:30` 累積端點，13:31、13:32、13:33 不得被補造成 regular-session minute rows。來源若以其他未知方式編碼、延後棒缺少前置連續性、量倒退或硬截止前仍無法完成，該商品必須 fail closed，當日不得成為 baseline。

### 6. 基準採分級可信來源，正常歷史基準與中斷回補分開

每個商品的比較基準必須是緊接目前交易日之前的適用官方交易日，並具有 09:01–13:30 regular-session canonical cumulative-volume series。來源優先序固定為：`live_full_session_verified`、`historical_baseline_verified`、`historical_repaired_verified`。只要前一交易日基準及今日截至目前的 sealed KBar 都完整，即可比較；不再要求先累積兩個 live capture 日才允許功能驗收。

`live_full_session_verified` 仍是最高優先來源，來自相同 bounded KBar recorder 與 completeness 規則完成的完整交易日。若上一交易日沒有合法 live baseline，系統 MAY 在該日 13:34:30 收盤定稿後、下一適用交易日開始比較前，執行正常冷啟動歷史基準流程。該流程對固定 cohort 逐商品進行一次性、有界 fetch／refetch，不是盤中 polling，也不得在已有合法 live baseline 時以歷史資料覆蓋。

正常歷史候選預設仍為 `historical_unverified`。只有官方交易日、緊接關係、交易所與商品身分、Asia/Taipei、來源／版本、原始與 canonical 單位、OHLC／Volume／Amount 等長結構、嚴格遞增分鐘、盤外／跨日／重複／負量／倒退、可信 regular-session 收盤總量，以及相同來源版本兩次抓取的內容與 payload hash 穩定性全部逐檔通過，才可升格為 `historical_baseline_verified`。任一項未知或衝突都逐檔 fail closed。

頁面晚於完整日錄製起點才開啟、盤中中斷、缺少任一預期分鐘或 session-close seal 失敗時，當下只能保存 partial evidence；UI 必須顯示有效起點，且不得產生或否認缺口期間的歷史 trigger。盤中不得抓取歷史 Kbars 補洞，也不得恢復受影響商品的新量比判定。

收盤後中斷回補是另一個嚴格且逐商品的例外。最早於受影響交易日 13:34:30（Asia/Taipei）完成收盤定稿後，recovery worker 才可對指定日期執行一次性、有界歷史 1 分 K 抓取；候選資料除正常歷史基準的驗證外，還必須驗證所有既有 live 重疊分鐘與中斷 provenance。任一項未知或衝突都逐檔 fail closed。

缺少的分鐘不得直接補 0。只有其餘非負分鐘量加總已等於可信收盤 regular-session 總量、商品狀態允許，因而能證明所有缺口成交量為 0，且具備可承接的前一個 close 時，才可建立 `known_zero`／`carry_forward`。13:33 延後撮合只可併入 canonical 13:30；不得建立 13:31–13:33 regular-minute rows，未知收盤編碼、13:29 前置連續性不足或累積量倒退都拒絕升格。

全數通過後，系統才重建 09:01–13:30 共 270 個 canonical cumulative-volume points。正常歷史基準保存 immutable baseline manifest，provenance 固定為 `historical_baseline_verified`；中斷回補保存 immutable repair manifest，provenance 固定為 `historical_repaired_verified`。兩類 manifest 都至少保存商品、日期、來源／版本、兩次抓取時間、分鐘涵蓋、收盤量對帳、close mode、兩次 payload hash、verifier version 與 cohort hash；repair manifest 另保存修復缺口、live overlap、generation／sequence 與中斷原因。

兩種歷史升格都只令該商品 `baselineUsable=true`，並固定 `liveCaptureAcceptance=false`、`notificationEligible=false`、`retroactiveTriggerEligible=false`；只能供緊接的下一個適用交易日作 baseline，不得回頭補發聲音、系統通知或 trigger。自有 live evidence 以 `cohort hash + symbol + trade date + recorder version + payload hash` 在本機 SQLite repository 保存；歷史 evidence 另以 immutable manifest 與 monotonic repository revision 保存。同一來源版本、商品與日期若出現不同 payload hash，或寫入 revision 過時，必須視為 conflict 並拒絕覆寫。正常 full-session live baseline 的優先序高於兩種歷史 baseline，既有流程不得因新增流程而改變。不得以昨日全天總量按比例估算，也不得用週期 Kbars polling 補洞。

### 6A. Live freeze 與兩階段整合邊界

2026-09-09 full-session capture 執行期間，以下 transitive import chain 視為不可修改：`capture-bounded-kbar-shadow.mjs`、`bounded-kbar-transport.mjs`、`kbar-shadow-session-recorder.mjs`、`kbar-stream-adapter.mjs`、`minute-accumulator.mjs`、`pilot-cohort-receipts.mjs`、`canonical-json.mjs`。第一階段只可更新本 change artifacts，並新增未接入 live path 的 repair domain、validator、repository 與 fixture-only tests；不得啟動第二個 capture、連接 8080／SSE 或占用 5173／5174。

2026-09-09 capture 已於收盤後在 `session.evidence` canonical hashing 階段失敗，主 evidence 與暫存檔皆未建立，因此原訂「正常結束且 validator 通過」條件沒有成立，當日永久不得列入 live acceptance 或 baseline。原始行程已結束；失敗後被 launchd 推斷為 keepalive 的重複呼叫已移除，log size／mtime／SHA-256 與失敗原因另存於 `acceptance/kbar-shadow-failure-2026-09-09.md`。在確認沒有 capture process、今日輸出不存在且 simulation API、5173、5174 仍運作後，才依使用者明確指示進入工具修復：修改共用 recorder、建立失敗 sidecar 與接入純 post-close recovery worker。此例外是為避免同一失敗重現，不得解讀為原驗收條件已通過，也不得對 2026-09-09 執行歷史升格。

後續完整日 capture 必須以明確 `KeepAlive=false` 的 one-shot LaunchAgent 啟動；主 evidence 使用足以容納 20 × 270 rows、但仍有界的專用 canonical hash budget，並以同目錄 temporary file、fsync 與 atomic exclusive link 建立。任何階段失敗只可建立獨立 immutable `.failure.json`，其 `baselineUsable` 與 `liveCaptureAcceptance` 固定為 false。任何回補整合都沒有 production、broker write、第二 login、通知或既有服務生命週期權限。

### 7. 判定採精確整數不等式，事件採 latch 而非目前狀態列表

門檻以最多兩位小數的 decimal 儲存，預設 1.5，可選 1.5、2、3 或輸入 1.00–100.00。判定使用等價的整數／decimal 不等式 `today_cumulative >= threshold × previous_cumulative`，不先四捨五入 ratio，且要求 `previous_cumulative > 0`。

第一次由未達標跨到達標時建立 immutable trigger event；事件包含 trade date、symbol、minute key、設定 revision、門檻、兩側累積量、來源版本、完整度與 hash。結果在該交易日保持可見，即使稍後 ratio 回落。同一 `trade date + symbol + threshold config revision` 最多一個通知事件；修改門檻後若商品已高於新門檻，只標示「依新設定已符合」，不得把設定動作偽裝成新的即時跨越通知。

替代方案是每分鐘只顯示當前符合清單，會使曾經觸發的商品消失且難以稽核，因此不採用。

### 8. 通知與結果推送分級處理

頁內結果更新不需系統通知權限；系統通知必須由使用者明確啟用且瀏覽器權限為 granted。只有 lease 存續期間新產生的 live trigger 才可發出聲音／系統通知；重播、重新連線、歷史補算與頁面重整不得補發。多分頁由 runtime event id 與 client acknowledgement 去重，但任一分頁皆可顯示已存在的結果。

替代方案是由每個分頁獨立比較與通知，會在多分頁及重整後重複提醒，因此不採用。

### 9. API 與儲存皆採本機、版本化與可重播邊界

本機 API 分為：設定讀寫、lease acquire／renew／release、status／capacity、當日 results、SSE event stream 與受控 diagnostics。所有輸入以固定 schema 驗證，mutation 使用 revision／idempotency key；GET 不得觸發 provider 抓取。監控 API 不具 broker write authority，也不得攜帶帳號、憑證、委託或持倉資料。

儲存至少包含 monitor config、baseline minute rows、current-session minute rows、trigger events、lease／admission 狀態及非敏感 evidence manifest。分鐘資料按 `symbol + trade date + minute key` 唯一，寫入採 monotonic revision。保留範圍先以「上一個完整基準日、當日及有限稽核期」為原則，實際天數在 Gate 0 量測容量後定案；任何清理不得刪除仍被當日結果引用的 evidence。

### 10. 專用 workspace 重用既有交易終端與安全互動

「版面」選單新增「盤中選股」同步開新分頁。桌面寬度採左側監控／結果與右側 K 線並排，窄 viewport 改為可抵達的上下排列；兩區各自捲動，不讓整體超出可視高度。結果內容與右上「加入清單」按鈕是互斥 action：前者只更新同頁指定且未鎖定的 chart，後者只寫入名稱精確為「盤中選股」的 server-backed watchlist。

此專用 workspace 使用自己的 route／layout identity，不寫回來源主頁 current workspace。盤中監控可透過 5174 loopback 的明確唯讀模式列出 MultiView「我的清單」頁籤與其中台股，使用者選定後只複製代號到監控草稿，且仍由 Shioaji 驗證 canonical 合約；唯讀模式不得觸發 MultiView realtime watchlist 同步或改寫 `user_tabs`／`user_instruments`。替代方案是把功能塞進 MultiView panel，但會混淆 MultiView D1 個人清單與 RealTimeStock server-backed watchlist，因此不採用。

### 11. 固定 20 檔試辦使用不可自我授權的 evidence 工具包

試辦使用版本化 cohort receipt manifest、20 檔 stage plan、可信前一交易日 baseline、完整盤中交易日 session 與 evidence bundle。plan 綁定 immutable cohort hash、一個完整盤中驗收日、人工核定的 CPU／RSS／DB 成長／SSE latency／K 線新鮮度預算、simulation-only、user-visible feature-off 與通知關閉。provider physical usage 保持 `unknown`，不得轉寫為 20 或一個 request。

recorder 只管理 bounded KBar transport，沒有 broker write、production 或自動 service lifecycle authority。自動 validator 只有在上一個適用交易日的 20 檔 baseline 全部為 `live_full_session_verified` 或 `historical_baseline_verified`，且一個完整盤中驗收日的 20 檔皆具預期 sealed minute evidence、量比可重算、replay trigger count 一致、零不完整資料誤報、零通知、零 broker write／production／自動重啟且既有功能無退化時，才輸出 `readyForHumanReview=true`。`historical_repaired_verified` 可供產品下一日 baseline，但因其代表曾發生 live 中斷，不得用來取代本案功能驗收 bundle 所需的正常前日基準。

50／100／160 active 擴量不屬本 change；若 20 檔完成並經人工核定，另開 change 評估。最終 acceptance dossier 綁定 bounded KBar Gate、20 檔完整日、資料品質、資源、UI、accessibility、rollback、tests 與 reviewer sign-off；結構或檔案 hash 任一失敗都不得歸檔。

完整盤中驗收日採三件式 evidence contract，不再把 KBar capture 當成唯一完成條件：`kbar-shadow-<date>.json`、`passive-chart-freshness-<date>.json` 與 `pilot-runtime-assurance-<date>.json` 必須使用相同交易日，assurance 必須引用官方前一交易日與其 baseline manifest／capture hash。被動 K 線證據只能從已存在且已穩定的頁面，以至少兩次零 navigation、零 reload、零 click、零網路請求及零 subscription mutation 的 DOM 觀測建立；由專用 builder 驗證同日、同商品、同週期、visual commit 推進、canvas 可見性與完整 operation ledger，再原子 exclusive create。

每日完整性守門器在 10:00（Asia/Taipei）後仍缺被動 K 線 evidence 時輸出 `attention`，讓排程在尚可補救的盤中時段立即處理；13:34:30 後若 capture outcome、被動 K 線 evidence 或 runtime assurance 任一缺漏／不合法，固定輸出 `failed` 與 `readyForDailyBundle=false`。它不得事後補造盤中觀測，也不得讓 capture-only 成功成為完整盤中驗收日。2026-09-10 的 capture 本身可作 2026-09-11 的 `live_full_session_verified` baseline；若 2026-09-11 的三件式 evidence 與跨日量比重播全部通過，即足以進入功能人工審閱，不必為了功能驗收再等待 2026-09-14。第二個完整盤中日 SHOULD 作為非阻擋的穩定性追蹤；若追蹤發現退化，MUST 重新開啟風險處理，但在尚未發現退化前不得阻擋已通過的一日功能驗收。

## Risks / Trade-offs

- [200 的實際計數維度仍未知] → 不再把它當成本 change 可解決的相依；active 固定最多 20，physical usage 明示 unknown，沒有實際 KBar 的商品不算 active。
- [既有 ownership 分散] → 不接管或重排既有 owner；盤中監控只管理自己的單一 batch 與 SSE，任何既有行情退化即停止試辦。
- [一次性分鐘 bootstrap 可能受 rate limit 或資料涵蓋限制] → 量測正式欄位與 bucket，採有界 queue、cache 與 backpressure；未通過就維持 `waiting_baseline`，不以估算補值。
- [20 檔仍可能碰到未知 provider 限制] → 一個 immutable cohort、零輪替、逐檔 data receipt、缺檔即 fail closed；不顯示推定 headroom。
- [頁面休眠或網路中斷造成 lease 逾時] → runtime 以 TTL 回收並保存最後一致資料；重連需取得新 generation 後才繼續，缺口期間不得觸發。
- [低流動性商品有零分母或長時間無成交] → 區分合法 carry-forward、已知 0 與缺資料；前一日分母為 0 時結果為不可比較。
- [新增 KBar batch 可能影響既有行情] → 不修改既有 coordinator；以 K 線新鮮度與 runtime regression 監控，任何退化立即停止 batch 並保持 feature-off。
- [個股可能延後至 13:33 收盤且 provider 沒有逐檔旗標] → cohort 一律監聽至 13:33 後有界寬限期；一般與延後收盤逐檔記錄 `closeMode`，未知編碼或缺少連續證據時保持 partial，不在 13:31 提前 unsubscribe。
- [歷史 Kbars 可能完整但仍不可證明可信] → 預設維持 `historical_unverified`；只有逐檔通過 live overlap、final volume、重抓穩定性與收盤語意的 immutable manifest 才升格，任一部分成功不得宣稱整批成功。
- [正常歷史來源可能在不同抓取時間修訂內容] → `historical_baseline_verified` 必須以相同 source version 執行兩次獨立抓取並得到相同 canonical payload hash；不穩定、無法對帳或不是緊接的前一交易日一律維持 `waiting_baseline`。
- [回補掩蓋即時串流退化] → 永久分離 `baselineUsable` 與 `liveCaptureAcceptance`；修復成功仍保留當日中斷事實、零補發通知，完整 live 驗收日不得被取代。
- [通知被瀏覽器阻擋或多分頁重複] → 權限狀態可見、頁內結果始終可用，通知由 server event id 與本機 acknowledgement 去重。
- [分鐘資料量增加] → 只保存 20 檔 sealed cumulative minute evidence、建立唯一索引與 retention；另案擴量前重新量測。

## Migration Plan

1. 先建立 feature-off 的 schema、domain、diagnostics 與 Gate 0 工具，不取得新 subscription、不變更服務啟停與既有行情。
2. 以既有 multi-stock KBar endpoint 完成 2 檔受控探針，確認單 batch、逐檔事件、payload、分鐘時序與 simulation-only；provider physical usage 保持 unknown。
3. 建立 bounded KBar transport、one-bar delay recorder、baseline／trigger repository 與離線重播，不推送使用者通知。
4. 在不接入 live capture 的獨立模組中建立 post-close repair domain、validator、immutable manifest repository 與 fixture-only tests；歷史資料預設仍為 `historical_unverified`。
5. 2026-09-09 live evidence 最終化失敗後，先保存不可升格的失敗證據並解除錯誤 keepalive；再修正完整 evidence 的有界容量、原子成功檔與 immutable failure sidecar，並以 20 × 270 離線 fixture 驗證。repair worker 只接入具不可偽造 post-close authority 的 recovery path；所有 provider fetch 必須晚於 13:34:30、一次性、有界且逐檔 fail closed，2026-09-09 不得回補升格。
6. 建立正常前一交易日歷史 1 分 K baseline validator、雙重抓取穩定性、immutable manifest、repository precedence 與離線測試；只有通過者才標示 `historical_baseline_verified`。
7. 以固定 20 檔完成「可信前日基準＋一個完整盤中日」的 simulation 功能試辦，驗證分鐘與量比正確率、既有 K 線新鮮度、CPU、記憶體、DB 與零誤報；第二個完整盤中日另作非阻擋穩定性追蹤，50 檔以上另案。
8. 完成「盤中選股」UI、K 線連動與自選清單 mutation 後，先開啟頁內結果，再另行開啟使用者主動授權的系統通知。
9. rollback 時關閉 feature flag、拒絕新 lease、對完全相同 cohort 送一次 unsubscribe 並保留 accepted／unknown 狀態與 evidence；產品不得自行停止 simulation API、5173／5174 或既有行情連線。

## Open Questions

- 20 檔試辦完成後，是否另開 change 評估 50 檔以上；在取得新證據前不得沿用本案結論擴量。
- 正常歷史 1 分 K 來源可否長期提供穩定 source version、收盤總量及 13:33 編碼？在完成實際 20 檔雙重抓取前只能維持 feature-off；若不成立，改用上一日完整 live capture，不降低 validator。
- 分鐘 evidence 的正式 retention 天數與最大磁碟上限為何？Gate 0／20 檔階段須先量測再定案。
- 系統通知是否僅在分頁可見時播放聲音，或允許分頁背景時通知？不論選擇為何，所有 lease 消失後皆不得通知。
