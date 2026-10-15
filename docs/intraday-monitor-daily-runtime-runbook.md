# 盤中量比日常模式操作與驗收（simulation）

## 10/15追加：收盤尾筆例外與補算（正式接線與真實驗證完成）

使用者已授權最多10／160檔且僅缺13:30尾筆的有界例外：全部09:01–13:29必須真實連續live且安全Gate無故障，並待完整160份盤後與前日v2重驗、13:29累積量銜接及收盤時durable門檻核實後，才可取得獨立「日常運作通過（收盤尾筆例外）」。原live partial／08:50 failed／13:40稽核不改；盤中缺漏、兩分鐘缺漏、超過10檔或未知故障不能容錯通過。

盤後補算只讀本機已發布基準，不新下載，不回寫live／trigger，不補發通知。需看獨立`daily-close-tail-exception.json`及API／UI的「盤後補算，不通知」列，不能把歷史列當即時結果。詳細規格、候選回歸及完成後接線步驟見change的`acceptance/close-tail-exception-2026-10-15.md`。

原13:35採集仍在執行時不得接正式API或載入5173。10/15已等原PID11434於16:29:23.551自然complete160、原件及no-op核對後，才依已授權批次載入修正；16:47原頁面與API已驗證三檔補算及完整245結果，原2449／5m復原，八份原件hash、設定revision46及其他服務PID不變。今日獨立補算標operator_after_original_collection，不冒充新hook自然觸發；未來原standalone入口在complete／no-op後自動衍生，失敗不撤銷基準。

正常顯示可同時為：原daily execution partial157／160、日常運作例外通過、10/16基準ready160、通知關閉。盤後新設定與原收盤比較版本不同時，不放寬current Gate、不覆寫設定；補算依durable收盤版本。今日三檔13:30量比為2355=2.7265896758、6191=0.7107725528、6449=0.5223686351，門檻1.5／revision18，僅2355符合，三列都不通知。

收尾後重新載入須以本機cursor讀完整結果，不依賴新lease／SSE；前端上限32頁／20秒，跨頁版本改變或cursor循環拒絕假完整並保留舊結果。10/15實際三頁245筆；不是新增broker下載。若超限或錯誤，先查本機API與既有結果，不用重啟行情服務補畫面。原React／extension錯誤及上游尾筆根因未知限制仍保留，不把本案結案當全系統無故障。

本案10/15完成55／55與最終回歸／strict／diff檢查，可依例外政策結案；不自行歸檔或提交Git。結案heartbeat完成後停止，本機盤前／盤後排程照常，明日仍由原入口核官方日期、額度與安全Gate，不靠Codex手動下載或轉換政策。

## 10/15全日收尾未通過（14:05檢查點）

原13:34收尾及13:40獨立稽核為157／160完整：2355、6191、6449各至13:29，缺13:30。reader已接收的43,197份全部接受，無已記錄資源Gate、斷線或gap通知，仍不能判定券商未推或API內部漏轉；不得以歷史補件改判live。原13:35程序PID11434於14:09:54仍正常採集10/15→10/16（當下35／160，非完整ready），不人工重跑或中止。47／49不變，8.6已完成不重做，7.4及7.6仍未完成；17:05核原生基準、同鍵no-op及獨立尾端證據，詳見change的`acceptance/live-2026-10-15.md`。

## 10/15分頁日期與盤中切換實證

長駐頁面會自動核對台北日期，背景復原也重新核對；換日清除舊結果／cursor而保留草稿，不需要每日重載。若status日期與頁尾「當日」不同，不得把空結果當今日無達標，應分查後端與頁面日期，不為處理UI重啟行情owner。

10/15已以真正原owner完成1.5→2→3→1.5驗收，480份同分鐘公式一致、三個後續分鐘各160份、HAR沒有新登入／訂閱／串流，名單及原結果不變。原偏好恢復1.5倍／revision18；後續不應為已完成8.6再次自動切換。詳見change的`acceptance/threshold-switch-live-2026-10-15.md`。47／49，仍待全日及完整dossier；原API退出觸發者及歷史partial不因此改判。

## 10/13 盤中即時門檻修正進度

使用者要求1.5／2／3倍盤中立即生效，不採下次session才生效。正式接線須分離行情session與比較版本，先由原owner核實CAS及不可變切換收據，再顯示真正effectiveAt／effectiveMinute；只儲存HTTP200不等於生效。只改門檻不能停止分鐘留存；切換當下重新符合不補發通知，名單變動仍依原Gate處理，既有closing與13:34:30最早收尾不變。

10/13原13:35採集於16:29:31完成160份翌日基準及原生same-key-noop後，依使用者當次授權接上runtime／不可變SQLite journal／專用API／三快捷UI。21項Node24、70項Vitest、22項Chromium及型別／build通過，正式頁面可見1.5／2／3控制。今日舊runner已收尾，不重開或倒填；status=unsupported_runtime及「保存不代表當日已生效」正確。明日原排程新runner載入後，只有當其回報applied及effectiveAt才可稱已生效；真正盤中8.6仍待驗收。詳見change的 `acceptance/threshold-runtime-integration-2026-10-13.md`；原revision9→10 partial與所有失敗保留。

快捷按鈕只改正式全域門檻，不送未保存名單草稿；個別覆寫優先。原owner以每秒本機revision查核及封閉observation入口接續，無額外broker HTTP／SSE／subscribe。pending／failed沿用上一有效比較版本，切換當下符合只靜默分類、下一真實穿越依通知Gate去重；closing仍接收來源但不重開通知。journal毀損時比較unknown／不通知，不能將合法行情留存與metadata切換綁成全批拒絕。名單結構／停用仍依原安全政策，不屬門檻熱切換。

本文件對應已於2026-10-15同步主規格並歸檔的 OpenSpec change [`simplify-intraday-relative-volume-runtime`](../openspec/changes/archive/2026-10-15-simplify-intraday-relative-volume-runtime/proposal.md)。上述歷史檢查點保留當時狀態，不代表目前仍待驗收；完整結案證據見[歸檔驗證紀錄](../openspec/changes/archive/2026-10-15-simplify-intraday-relative-volume-runtime/verification.md)及[收盤尾筆例外補算紀錄](../openspec/changes/archive/2026-10-15-simplify-intraday-relative-volume-runtime/acceptance/close-tail-exception-2026-10-15.md)，文中其他 `acceptance/` 相對名稱均以該歸檔目錄為根。本次歸檔不變更程式、服務或本機排程，也不提交或推送Git。

本文件描述安全切換與真實驗收；**程式回歸通過不等於排程或盤中驗收通過**。未另行授權時，不啟用 production、CA、下單、第二個 broker login／行情連線，也不停止或重啟共用 API、watchdog、Web、MultiView。

## 模式與所有權

- `daily-runtime-mode.json` 不存在時，既有 `legacy` 路徑不變。正式 `daily` 模式必須由操作者在無 active owner 的窗口，以 0600 權限及實際本機絕對路徑保存；無效設定一律拒絕，不靜默退回 legacy。任何設定修改都先記錄舊值／hash、原 claim／receipt 與檢查時間，不覆寫原證據。
- 固定 160、動態 daily plan、晚開機與診斷共用 `direct-160-live/registry` 排他所有權。動態名單保持 feature-off，直到其獨立實盤 Gate 完成；固定路徑的實證不能代替動態名單驗收。
- 08:20／08:35／08:45 建同日 session 與安全 Gate，08:50 才啟動單一背景 runner。`daily` 不要求當日 Stage bundle、完整 capture、全日 replay 或可見 1 分 K；歷史容量核准仍須有效，來源 generation、逐檔前日基準及 simulation session 仍須核實。
- `daily` 盤後 13:35 獨立下載來源日 1 分 K、逐檔驗證並發布翌日 v2 基準，不依賴當天監控是否成功。每檔通常一次 K，缺有效同日／同 generation 合約快取才另查合約。舊 14:15／14:55 補跑遇原程序仍在採集時只回報進度；原程序在自身有限嘗試與冷卻範圍內接續。缺 receipt 但程序已退出或截止，保持 unknown／failed，不刪 claim 重試。
- 13:40 稽核分別檢查監控程序、逐檔資料水位、串流／資源故障、小型收尾 receipt 與盤後基準 `collecting`／`ready`／`failed`。正常有界採集尚未完成，不能報成整日擷取失敗。

## 啟用前 Gate

1. 核對官方 TWSE／TPEx 今日與下一適用交易日，包括臨時休市公告；確認 simulation business session、2330 Snapshot、API generation、production stopped、write master disabled、8080／5173／5174，以及沒有既有監控 owner。任何一項未知即不切換。
2. 核對固定 rev9 cohort／設定與 durable Stage 160 容量核准；前日 v2 或合法唯讀 v1 基準必須逐檔對應同交易日／商品／市場，不能把任意較舊基準補上。
3. 核對共用本機持久額度政策、身份、效期、consumer 承諾、已 charged／quarantined 的保留以及當下真實 `/auth/usage`。來源用量與 SQLite 政策須分別保存時間；不同時點不能冒充原子快照。預算不足時 fail closed，不靠手改日期、清收據、重設 quota epoch 或猜測剩餘量啟用。
4. 從已驗證實測估算單請求上限與最多 320 筆的情境；政策目前每 60 秒最多兩筆，因此完整首次採集的理論最短時間約 160 分鐘，盤後截止時刻必須容納有界冷卻／重試。HTTP 回應 bytes 與券商額度是兩種不同量，不得相互換算為精確節省率。
5. 保存 mode／設定／政策／runtime 與 claim 的前後 hash，僅在無 owner 且額度 Gate 真正成立後啟用。切換不回填當日 08:50、13:35、13:40 或歷史 failed 收據；若需回復，等下一個無 owner 安全窗口切回 legacy，保留兩邊原證據。

### 跨日額度重設（10/6 已啟用；300 MiB 保護池不變）

- 目前 300 MiB quote 保護池（314,572,800 bytes）仍維持原值；10/6 的 43 檔缺口是同一盤後工作重複扣算，不是券商額度耗盡，因此不藉縮小保護池放行。Shioaji 官方說明交易日 08:00 重設日流量，但不能僅因日期跨越而修改帳本。10/6 19:47 已另存 10/7 所需的重設前私密錨點；證據 hash 見本 change `acceptance/budget-duplication-and-recovery-2026-10-06.md`，原始帳號與 HMAC key 不進 repo。
- 下一交易日 08:00 後，以同一 simulation session 唯讀觀察來源 `/auth/usage` 與證券帳戶集合，保存新的 0600 錨點；使用已驗證的 TWSE／TPEx 本機官方日曆、兩份不可變收據與同一 HMAC key 檢查計數是否真正下降、額度上限未變。新 API generation 可以不同，但帳戶集合不能不同。盤前官方日曆無法證實或來源計數未下降時，沿用舊保守帳本，絕不宣稱新週期。
- `broker-daily-reset-witness/1` 只產生候選，不直接放行。版本化遷移候選需在舊政策仍有效、無 `reserved`／`dispatched`、工作承諾證據新鮮、全 160 檔最保守 320 筆請求與 300 MiB 保護池同時足額時，才原子封存舊政策及承諾、保留舊 charged／quarantined，建立新週期。政策 CAS 或任何來源身分檢查失敗都保持 mode-off；不能把新週期候選、隔離測試或舊請求數當真實自動下載。
- 啟用入口分 `prepareBrokerDailyResetActivation` 與 `commitBrokerDailyResetActivation`。前者會留下新的私密用量觀察並刷新既有 append-only 工作承諾，計算不變的 300 MiB 加完整 320 請求預算，**不修改額度政策或 daily mode**。後者須在觀察有效期內再次讀回兩份來源收據、官方日曆原檔及帳戶 HMAC，並重查 simulation generation、mode、owner；來源或政策一旦變動即中止。只有真正提交成功後，才另外核對固定／動態 feature Gate 並安全保存 daily mode 設定；不能把準備結果當成已啟用。原始收據及失敗原因均保留。
- 已進入 v4 `daily` mode 後，真正 13:35 本機盤後排程結束時會額外保存一份當日私密來源用量錨點；08:20／08:35／08:45／08:50 本機盤前流程會選取**前一官方交易日**的最新有效錨點，沿用雙階段 `prepare`／`commit`。前一日週五、當日週一的間隔按官方前一交易日辨識，不以連續日曆日或固定 36 小時誤擋。當日已成功轉換則 no-op；證據缺失或計數未真正下降時維持舊週期，08:50 不啟動新的下載。這是本機程式的常態流程，Codex 僅驗收，不代跑政策轉換。提交時以 CAS 封存前一日 identity／政策／承諾，保留舊 charged、quarantined 與失敗收據；不得沿用前一天 witness、以日期清帳或宣稱券商提供可驗證 quota epoch。10/7 真正排程仍須現場核對，不能把隔離測試當成已成功執行。
- 來源重設與全窗口預算均成立時，v4 同一 CAS 會把政策效期續至多七日，且不超過最早實測校準樣本後三十日；政策與預算效期一起留不可變版本證據。這避免舊版 v3 專用複核入口造成 v4 在 10/10 效期後無故卡住，但校準資料過期時仍須重新實測，不會無限自動展延。

## 真實驗收與判定

### daily 日曆快取與日曆失敗補建

- daily 盤後入口保存 `IntradayMonitor/official-calendar-cache/` 的獨立雙市場原文／來源 hash／實際時間；盤前優先驗它，不依賴停更的 v1 包。新版缺席才沿用合法 legacy；新版損壞或過期仍拒絕，不能修改舊日曆的取得時間。
- 操作者授權的官方來源修復另標 `operator-repair`，不追認昨日排程。原 08:20 日曆失敗、沒有今日成功 claim／session／資料時，真正 08:50 原排程在 09:00 前仍可按完整 Gate 自行補建；原三個盤前失敗原件保留。不得為趕驗收手動代跑 08:50 或建立第二個 owner。

### 10/14 重開機中斷補件

- 原claim有owner PID但沒有receipt時，先核實程序確實已退出、主機boot晚於claim、無其他owner／reserved／dispatched，再取得操作者明確授權；不能直接重跑原生入口或製造原receipt。
- `recoverInterruptedDailyMinuteVolume` 使用原claim hash下的私密operator namespace，保留原母體、官方cache、原18:30期限、15分鐘冷卻與已驗證manifest。第二次補件只限第一張operator receipt為零下載的`broker_budget_pending`，不得無限重設嘗試。
- 同日重開機usage下降以專用`same-epoch-conservative-carry.json`保留原high-water並加上新raw計數；並非重置quota。原HMAC／scope／daily identity／上限、300MiB池、兩請求／分鐘、charged／quarantined均保留。再次身分／generation／計數異常即拒絕。
- 成功依operator完成receipt與正式repository160份重驗判定，另核原97份及原claim／receipt hash未變；原生中斷與當日live失敗仍保留。此入口不重啟服務、不登入或訂閱，不把operator receipt冒充scheduled證據。

### 10/6 預算錯配補件的原邊界

- 若 `/auth/usage` 尚有額度、但 admission 回 `broker_budget_or_rate_denied`，分開核對 quote 保護池、其他工作承諾、同週期 daily-v2 `charged`／`quarantined` 及未送出的 `reserved`；不能把本機拒絕直接稱為券商流量耗盡。
- 經操作者授權的 `daily-baseline-allocation-v1` 政策轉換只承接同 scope、同額度週期且已送出的 daily-v2 估量，保留原帳及不可變前後政策收據。10/6 實際轉換沒有縮小 300 MiB quote 保護池；之後要調整池大小必須另有實測及版本化政策證據。
- 若原 3 次已因該政策錯配而 partial，`recoverDailyMinuteVolumeAfterBudgetCorrection` 可在來源日 20:00 前、原 15 分鐘冷卻已過且日曆／generation 不變時，由操作者明確啟動一次第 4 次補件。最多 120 請求，只補缺件並新增第 4 張 claim／receipt；不可刪改前 3 張、假稱原生排程成功、放寬來源真實性或變成常態無限重試。

- 先由真正 13:35 本機排程建立來源日 v2：核對 160 檔 TSE／OTC 日期、270 個 09:01–13:30 canonical 分鐘、合法 13:33 歸一、來源 hash、量單位、總量核對品質及逐檔 waiting／conflict。同鍵後次排程必須 no-op；手動重算與 fixture 不算自動發布。
- 原生完整後entry會保存 `daily-minute-volume-collection/<來源日>/attempt-XX-same-key-noop.json`：重新驗160份manifest與原claim／receipt hash，實際走collector相同鍵的已完成重用分支，禁止所有新下載／reservation／repository寫入。核對trigger=scheduled、原程序／查核PID、追加下載0及原件不變；原collection receipt歷史requests數不改。此為同程序完成後的第二次collector重用查核，不是第二份採集或另一個獨立排程。manual或diagnostic_failed不能冒充原生通過；查核故障不撤銷baseline complete。
- 緊接下一適用交易日核對原盤前／晚開機 Gate、單一 owner／SSE、真實封閉分鐘與前日同分鐘累積量、結果與通知 Gate、API/UI 資料時間。背景監控不要求任何圖表可見或切到 1 分 K。
- 全日核對 13:30 closing、合法延後撮合觀測、最早 13:34:30 收尾、逐檔完整／partial／unknown、已提交 SQLite 結果及 13:40 稽核；盤後歷史基準完整不能倒改當日 live partial。
- 背景程序每 15 秒檢查 reader、來源時間及已鎖存的資源故障。單筆處理延遲略超軟門檻只保留峰值與慢事件數；60 秒內 3 筆超限或單筆超軟門檻 5 倍屬真背壓，應先有不可變事故與提前 partial，不能讓後續來源計數掩蓋停收。10/6 原始 3,006／3,000 ms 全名單誤鎖存案例已保存；候選修正須由後續實盤驗證，不回填當日結果。
- 分別保存新舊路徑的 HTTP request count／response bytes、可取得的 provider usage 前後錨點、CPU／RSS／DB bytes／延遲。沒有前後錨點或有其他共用工作交錯，明列不能歸因，不宣稱精確流量節省。
- 若反覆少數商品缺收盤棒，先對照原 summary 的 `closeFramesByCode`、`sourceGapEvents`／`sourceDroppedFrames`／`sourceGapSamples`、資源故障與實體斷線。沒有新欄位的舊收據是未觀測，不是0丟包。來源gap格式不合法須unknown，socket健康不能代替來源完整；有gap但未證實affected symbols時不能猜測就是缺少的兩檔。僅有來源gap未重新驗證，不可標全日ended；不因此重啟API或重訂閱健康socket。今日部署版本未保留的原始通知不得用測試重現倒填。
- 四個相關 active changes 的原始 failed／partial 與未通過任務保留；被新設計取代的完整 capture 驗收標示 `superseded-by-design`，不勾成 passed，也不因本 change 完成而自行歸檔、commit 或 push。
