## Context

本設計承接使用者分享的布林選股對話及本串探索結論：每天盤後產生「正在壓縮」、「準備突破」、「今日正式突破」三類名單，整合既有選股面板。分享頁共一則提問與一則完整回覆，已完整閱讀；其中「準備突破」尚無可執行公式，因此本設計補上靠近上軌的明確定義。

目前條件與 UI 為 v7，既有 `bollPosition` 只判定上／下軌外與中軌附近，`bollReversal` 另有首次穿越及 K 棒結構，均不得改為本策略語意。`stock-screener-v7-publisher.ts` 依賴 v6；v6／v5 間接等待法人、融資與 TDCC。官方 OHLCV 準備器固定 130 日，歷史 canonical 契約沒有成交金額；`pruneScreenerOhlcvV4` 只保護舊能力窗口，現有 idle gate 以 v5 head 作為完成判斷。這些都不能直接當作新策略已可使用的證據。

工作樹含多項尚未提交的圖表、清單及盤中監控變更。本 change 採 additive 契約與精準修改，不重啟既有 simulation API、watchdog、Web、MultiView，不接觸既有盤中擷取的排程與收據。

## Goals / Non-Goals

**Goals:**

- 用可重算且不使用未來資料的已驗證價量證據，決定性產生三類互斥結果；官方日報優先，Shioaji 日行情為獨立驗證的備援。
- 預設找強勢、仍壓縮且量縮的候選，以及近期壓縮後首次放量上破的事件；各數值可調。
- 純價量資料與發布不依賴法人／TDCC，接入本機盤後輪詢、補跑、冪等與休眠。
- 保留舊版策略、版本、偏好、snapshot 與操作安全；資料缺漏、來源未公布、尚未準備均可辨認。
- 窄面板與鍵盤可用，圖表與加入清單沿用既有明確操作。

**Non-Goals:**

- 不做盤中、向下突破、交易指令、預測、報酬回測、參數最佳化或績效保證。
- 第一版不做市場廣度 risk-on/off、NATR 排名、120 日高點距離、全市場前 300 名、動能前 30%或新增商品排除來源；上述進階選配不得掛名已實作。
- 不把 FinLab 的月頻組合、還原價報酬或其他研究結果當作本策略績效；不下載需新增付費／授權的資料。
- 不以來源錯誤推論休市，不回填假 K 棒，不更動既有 v7 公式修正其他問題。

## Decisions

### 1. 新增 v8 契約，獨立純價量底稿與同日組合條件

使用新 criteria／schema／formula version `v8` 與 `bollinger-squeeze-stages-v1`，新增 `bollSqueezeStages` 分支，舊偏好遷移時預設關閉。所有新分支關閉時沿用 v1–v7 projection；啟用時只接受 v8 價量快照。不把 v8 publisher 接在 v7／v6／v5 成功後，改從官方普通股母體、已驗證交易日與同一期 canonical 價量 history 建立。

底稿儲存 BOLL 全歷史序列、所需 MA／量能統計、交易日、實際成交金額、來源 hash 與 readiness。指標只在有界背景工作計算；唯讀 GET 可對固定底稿做有界純函式條件判定與分類，不抓來源、不寫 DB、不重算指標。參數若需要超過底稿範圍，回 `history_pending` 與所需日數；不得縮短回看窗冒充可判定。

全市場讀取時，每份底稿通過完整結構／hash 驗證後深度凍結；同一次讀取後續純函式只可重用該不可變物件的驗證結果。以私有 WeakSet 辨識物件身份，不以 snapshot ID、日期、TTL 或外層 `Object.isFrozen` 當驗證憑證。新 DB 讀取及 clone 仍須完整驗證，publication 的 rowsHash／來源 manifest 仍逐次核對；避免 repository 與條件判定重複驗證 1,977 份相同底稿造成 gateway 逾時，不放寬任何完整性 Gate。

若同時啟用籌碼等舊分支，只接受同一 D、universe revision 與 mapping 相容的舊快照做 join；籌碼未 ready 則該分支為 unknown，而非阻止純價量快照發布。外層沿用三態 AND／OR，仍顯示各分支結果，不能用較舊日期填補 unknown。

替代方案：直接擴寫 v7 容易把舊偏好、cursor 與公式重解釋，也會繼續等待籌碼；另建完全不同的面板則重複現有流程。故選擇新版分支、獨立資料 head、共用面板。

### 2. 用已完成交易日與排除當日的相對帶寬基準

`D` 表示已由兩市場驗證的正式盤後資料日，`P` 為適用的相鄰官方交易日。布林固定 20 日 SMA、母體標準差（除以 20）、2 倍標準差，與現有圖表數學基礎一致；新策略判定使用未作顯示四捨五入的值，另存公式版本，不修改 `indicators.ts` 既有 reference rounding 語意。

`BBW_t=(U_t-L_t)/M_t`；`b_t=(C_t-L_t)/(U_t-L_t)`。帶寬百分位基準是 t **以前**連續 N 個官方交易日的有效 BBW，不含 t。採固定 Type-7 線性內插 quantile：排序 x，`h=(N-1)*q`，取 `floor(h)`／`ceil(h)` 線性內插；ties 保留，判定採 `BBW_t <= Q_q`，不是跨股票排名。寬度非正、中軌非正或缺必要日為 unknown，不除以零、不剔除缺日後補足 N 筆。

預設 N=120、q=20%；基本參數允許有界調整，N 為 60–250、q 為 5–50%。BOLL(20,2) 第一版固定，避免新增一套與圖表不同的布林設定。

### 3. 共同濾網、壓縮 setup 與正式突破分開

預設共同濾網 G(t)：普通股、`C_t >= 20`、最近 20 個交易日（含 t）實際成交金額均值 `>= 50,000,000 TWD`、`C_t > MA20_t`、`MA20_t > MA60_t`、`MA60_t >= MA60_(t-5)`、`C_t/C_(t-70)-1 > 0`。來源分類沿用既有範圍，不把 KY、處置或全額交割誤稱已排除。

定義壓縮 setup S(t) 為 G(t) 與以下全部 AND：

- `BBW_t <= Q20(BBW_(t-120)..BBW_(t-1))`；
- `BBW_t < BBW_(t-5)`；
- `mean(BBW_(t-4)..BBW_t) < mean(BBW_(t-19)..BBW_t)`；
- `0.60 <= b_t <= 1.00`；
- `mean(V_(t-4)..V_t) < 1.00 * mean(V_(t-19)..V_t)`。

上述候選均量明確**包含當日**，反映最新壓縮狀態；更嚴格量縮可由使用者改成 0.8，並非第一版預設。共同濾網與 setup 的價格、金額／窗口、MA／斜率、動能、收縮窗口、b 下限及量縮倍數均可調；只接受有限數值與合法正整數，短窗須小於長窗、壓縮 b 下限須小於準備門檻且門檻不超過 1，無效設定不更動已套用結果。各 period 上限 250、近期 setup／比較 lag 上限 20，全部設定的歷史需求不得超過 400 個官方交易日。

準備突破 R(t) 為 `S(t) && b_t >= 0.85`，0.85 可調；不是上軌距離的固定價格百分比，亦不是預測。

正式突破 B(D) 為 G(D) 與以下全部 AND：

- `C_D > U_D && C_P <= U_P`；碰上軌等號不算今日突破；連日站在上軌外不重複算首次突破。
- 前 K 個官方交易日（預設 5，不含 D）至少一天 S(t)=pass，保存最近通過日期及當日 setup 證據；不要求昨日一定通過。
- `V_D > 1.3 * mean(V_(D-20)..V_(D-1))`；放量均值排除 D，倍數及窗口可調。

歷史 setup S(t) 使用**同一設定版本與 t 當時可得資料**重算，不能以今天 G(D) 或今天 quantile 套回過去。突破日不要求 S(D)、量縮或持續縮帶寬，也不另強制帶寬放大、紅 K、突破近期高點或法人買超。

替代方案：BBW 固定小於某百分比不適合不同波動股票；同日 squeeze AND breakout 會排除已展開的突破；將量能列為外層平行 OR 分支會繞過價量同時成立。故採相對基準、近期 setup 與策略內部 AND。

### 4. 三態判定、互斥分類與可稽核 evidence

先以三態邏輯分別計算 B(D)、R(D)、S(D)。依序決定今日最高已可確定分類：`breakout` → `preparing` → `compressing` → `notMatched`。若較高類為 unknown，不能直接降為較低類的確定分類，分類為 `unknown` 並保留已知的低階 setup 狀態；例如突破必要歷史缺日不得冒稱「沒有突破」。任何已知 fail 足以使該 AND 分支 fail；近期 K 日 setup 採 OR，有一日 pass 即可確定此子條件 pass，全部 fail 才 fail，其餘 unknown。

全市場守恆：`breakout + preparing + compressing + notMatched + unknown = total`。階段集合選擇只過濾互斥標籤，三階段合計不重複；分支啟用後以選取集合對 stage 判定，再與其他啟用條件組合。發布所有母體股票與 unknown reason，不將停牌或短歷史股票靜默從母體消失。

evidence 保存 D／P、parameter fingerprint、各條件 pass／fail／unknown、U／M／L／BBW／b、quantile 的實際基準日期／值／算法、縮帶寬比較值、多頭結構／動能、候選量縮／成交金額基準、突破量與排除 D 的基準、最近 setup 日期／證據 hash、source mapping／formula version。排序預設 code，可選帶寬、百分位位置、b、突破量倍數與動能；unknown 排序明確置末，不用格式化數值判斷。

### 5. 有界官方價量 history 與跨能力保留

新增 `bollinger-history-v1` capability receipt、progress 與 schema，保留現有 v4 的 130 日約定。預設保留 160 日；從已套用的有效設定計算最早依賴日期，至少滿足 `BOLL period + 帶寬回看日數 + 近期 setup 日數`、各 lag／短長窗及量能／MA／動能需求之最大值。預設近期 5 日 setup 需要最少 145 個原始日資料。改大參數時先顯示準備未完成，由明確儲存的每日策略設定讓背景準備器依預算擴窗；UI／GET 不直接回補。

從現有 TWSE／TPEx 指定日期全市場官方日報，或通過獨立 review 的 Shioaji `daily_quotes` 備援，加入「實際成交金額」獨立欄位、TWD 單位、market mapping、資料日期、exact URL、hash 與驗證收據；先查證所採來源的真實欄位及單位、資料可用性與使用範圍，驗證未通過不得啟用 5,000 萬濾網並假稱 ready。不得用 `close*volume`、盤中 Snapshot、估量或其他未驗證報價替代；缺成交金額為 unknown。

準備以 market/date 批次、最新日優先、只補缺、checkpoint、租約與 cooldown 續跑；初次 bootstrap 大於單次預算時保留 progress，不建立每檔 broker history 查詢。新能力只依已驗證官方交易日 authority；不可沿用「某市場 empty、另一市場 invalid date 就判定休市」的錯誤推論。上市前／停牌／無成交／來源缺日要分開，缺官方 OHLC 不能造 carry-forward K。

清理 policy 採**所有有效能力／尚在準備的計畫與保留快照所需日集合的聯集**；舊 prune 不得刪掉新窗口，回滾亦不得刪除其他能力仍引用的資料。

### 5.1 Shioaji 日期批次備援與獨立來源狀態

官方原始日報可能包含權證、ETF 等非普通股。原始回應採獨立列數硬界線（目前兩個代碼表合計最多 20,000 列、最多 8 MiB），在逐列轉換前檢查；不能沿用普通股母體 10,000 檔上限而拒絕合法全市場日報，也不能截斷、去重或依代碼猜商品種類。日期、欄位與唯一代碼驗證仍保留；完成來源驗證後再依已驗證普通股母體投影。原始 rowCount 與 universeCount 分別記錄，manifest 仍只計普通股投影。2026-10-02 TPEx 日報實測 11,928 列，探測與隔離回歸證據見 `acceptance/tpex-recovery-and-report-row-bound-2026-10-03.md`，不作正式來源使用範圍或全窗口已齊證據。

第一版備援選 `POST /api/v1/data/daily_quotes`，明確傳 `date=YYYY-MM-DD` 與 `exclude=true`，而非逐檔 `/kbars`。既有 API 1.7.1 的契約及 2026-10-02／2026-02-02 真實探測已確認九欄 column arrays；此為可行性證據，尚不是完整來源 review 或 160 日覆蓋。`exclude=true` 只排除權證，不能當作普通股母體。完整契約必須另外驗證價格基礎、交易範圍、歷史覆蓋、量／金額單位及本機使用／展示限制。

- 官方來源的 pending／invalid／failed／cooldown 與 Shioaji 來源 review、嘗試及收據各自保留。當官方入口無法使用，但備援 review 有效且全域 Gate 成立時，可直接選備援；不要求先恢復 TPEx 網站才准備援。schema／日期 invalid 不自動解除，使用備援亦不能改成官方來源成功。
- 官方交易日 authority、普通股母體及價格基礎是共同 Gate；來源錯誤或空行情不能判休市。日曆缺少／過期時保持 pending，不靠 `daily_quotes` 有資料猜出交易日。
- 一個日期只發一次全市場 `daily_quotes`，同日期的兩市場準備工作共用 date-level single-flight、持久 checkpoint／凍結快取與 payload hash；程序中止後重用已保存回應，不能因兩市場各自失敗而重複打同一批。市場由已驗證 universe／商品主檔判定，不能猜股票代碼或副檔名；回應沒有市場欄位。
- 九個 arrays 長度必須相同，Date 必須全部等於請求日，Code 唯一；價格有限、OHLC 合法。Volume／Amount／Transaction 的原始 int64 必須無精度流失地解析及驗證，再映射 canonical 整數；不得先經不安全的 Number 四捨五入。取不到、零成交、停牌及上市前分別列終態，不以缺 OHLC 或零值造 K 棒。
- 實測 2449 的 `daily_quotes.Volume=13,902,351` 與官方日報的股數一致，`Amount=4,107,551,351` 亦一致；仍須正式核實雙市場與歷史樣本。這個 mapping 不沿用分鐘 KBars 的張數規則，不盲乘 1,000；Amount 使用來源實際值，不以價格乘量補算。
- 每個 market/date 選一份完整 OHLCV／Amount 批次，不把不同來源欄位拼成一根 K。不同日期可以採不同已驗證來源，但須確認同為相容的未還原價格、單位及交易範圍。逐列 provenance 與不可變的 source-selection manifest 保存 provider、review／mapping version、請求日／實際日、hash、擷取時間及切換原因；`dataMappingVersion` 引用其版本與 manifest hash，既有官方版快照／cursor 不重解釋，v8 條件公式不改。
- 官方恢復後只追加核對及衝突 evidence，不自動覆寫已凍結歷史／發布 head。正式更正需另建可稽核資料版本，不能以五分鐘重跑暗中更新已發布報告。

### 5.1.1 成交量相容性容差（2026-10-03 使用者確認）

來源相容性比較新增獨立政策 `bollinger-source-comparison-volume-1pct-v1`，不改 `bollinger-source-selection-v1`、來源 mapping 或策略公式。以官方成交股數為分母，canonical int64／BigInt 檢查 `abs(備援股數−官方股數)*100 <= 官方股數`，包含 1% 等號；官方股數為零時必須雙方皆零，不能以絕對一股例外放行零量／無成交。OHLC（既有 canonical 價格單位）、實際金額、資料日期、readiness／缺漏狀態須完全相容，不能將成交量容差擴及其他欄位。

完全相同與容差內通過均可使用既有資料表的 `matched`，但新收據須保存政策版本／分母／容差、原始比較值、絕對差異及 `within_volume_tolerance`；超過容差或其他欄位不同為 `conflict`。政策及 assessment 進入新 receipt hash，同一比較重跑 no-op。舊 exact／conflict 收據、createdAt、凍結列、manifest、feature hash、head／cursor 原樣保留；不更新舊政策標籤冒充當時已通過。

唯讀 API 分列真正／歷史衝突與新容差通過 evidence；容差摘要顯示政策、原股數、差異及每比較最多 20 檔樣本，完整比較仍保存在來源帳本。前端須驗政策與樣本的整數容差，不把 `matched` 誤說成完全相同。選股仍使用原凍結來源的股數，1% 不作為策略放量／量縮門檻的誤差容許；接近門檻時不同來源可能產生不同結果，來源及原值必須可追溯。

### 5.3 金額一元的新來源核對政策與缺 OHLC 投影

使用者確認新增 `bollinger-source-comparison-volume-1pct-turnover-1ntd-v2`：承接原官方股數分母、≤1% 與零官方量雙零規則，另以 canonical int64／BigInt 驗證 `abs(備援金額−官方金額) <= 1` 元。此為**絕對一元**，不是金額百分之一；價格、日期、readiness、schema、來源 review 與缺資料不放寬。呼叫端明確選新政策才使用；舊政策與無政策的歷史收據不重新解釋。新比較追加原金額、差異、政策與 `within_source_tolerance` assessment；不同政策為不同不可變證據，同鍵重跑 no-op。來源 mapping、凍結量／金額、formula、快照與 head 不因容差而改變，UI 分列金額與量容差，不把僅金額有差說成量有差。

2026-10-03 全市場真實校準發現來源有正成交量／金額／筆數，但四項 OHLC 全 null 的列。新增 `shioaji-daily-quotes-shares-twd-v2`，將這類列保留原成交統計、bar=null、readiness=missing_ohlcv，不能補造價格、判成無成交或阻擋整個日期的其他有效商品。部分 OHLC null、非法高低關係、正量卻零金額／筆數仍拒絕。舊 v1 mapping 保持原解析規則，舊 raw、partial 與收據不覆寫；僅新 mapping 的重新解析證據可追加。

兩日期診斷總 broker request 限二次、明確保留額度與每次上限，原始 response 先保存；usage 可能延後更新，後續只追加非重疊的真實共享 counter 上界觀察，不把 response bytes 或即時 delta=0 冒稱實際 broker 消耗。診斷成功不形成正式快取／發布／額度週期，不能代替集中預算的可信 quota identity 與各工作承諾。

本次確認解除「1 股必須是衝突」的數值相容性限制，不等同來源使用範圍、價格基礎、正式 budget producer 或 160 日已通過。舊 acceptance 的當時 strict 結論保留，由新驗證紀錄說明現在政策。

### 5.2 備援資源與安全邊界

備援沿用既有 simulation API／business session；下載前確認 session、usage 與共用來源租約，禁止第二次 login、額外 subscription、production 或服務重啟。正式 rollout 前建立集中且持續保留的 broker 流量額度，以實測用量、已承諾工作、可設定的日額度及行情保留額度作 admission；禁止寫死另一個固定剩餘流量啟動門檻。程序中止的 reservation 必須可依租約核對回收，不影響盤中擷取已保留額度。

每輪價量來源維持**總共最多兩次 HTTP request／8 MiB**，包括官方與備援而非各給一份預算；日曆依原獨立上限併入 15 分鐘整輪。每 provider/date/capability 最多 18 次，至少 20 分鐘一般冷卻，429 遵循 Retry-After 且至少一小時；Shioaji 跨市場批次只計一次請求／額度，兩市場 receipt 引用同一 fetch receipt。每次 admission 前也須符合實際 broker 速率限制；不得用兩個 provider 的嘗試數繞過總 run 或集中日預算。HTTP bytes 與 broker usage 分別記錄，不能假設 JSON bytes 等於扣量；兩日期約 237 KiB 的實測僅供估算，不能宣稱 160 日一定只需約 20 MB。

admission 先驗本機政策、實測與其他工作承諾的有效性，缺失／過期／估量超出設定上限時，不先送 Snapshot／usage 查詢。查詢等待後再驗政策及其條款 fingerprint，避免沿用中途變更的承諾入帳；正式 dispatch 前再驗同一政策及 reservation owner／lease。freshness 每次獨立重驗，單純更新觀察時間不是額度修訂；`broker-budget-terms-v2` fingerprint 只略去 commitmentsObservedAt，其餘額度、實測、證據、效期與 quota identity 仍綁定。舊 fingerprint 的 reservation 保留且不直接送出，不改寫歷史帳本。政策過期或實際條款換版即拒絕，不增加 broker 歷史請求，不刪原 reservation／receipt；尚未 dispatch 的保留可依既有安全 settlement／回收流程處理。

v2 broker 配置與工作承諾觀察分開。唯讀 producer 逐一讀取完整登錄 roster 的 `broker-consumer-commitment:<jobKey>`，驗證 verified 狀態、payload hash、scope／quota epoch／quota 證據、canonical 非負安全整數剩餘 bytes，以及不超過 60 秒的來源觀察時間。只使用各工作實際 observedAt 的最舊值，不把現在時間填成來源觀察；missing／unknown／stale、空 roster 或身份不同均拒絕，不能以零代替。complete 亦須有相同身份的零剩餘承諾證據。quota identity 必須納入正式 port 的政策 fingerprint，usage 與它不一致或途中換 record 不得放行。producer 不送 HTTP、不寫工作 receipt；既有各工作自己的來源／生命週期與已耗 reservation 保持不變。這條讀取接線不代表工作 receipt writer、可信額度週期或正式實測政策已驗收。

工作 receipt writer 使用既有 `screener_runs` 的獨立 scope，不新增服務或排程。每份白名單 observation 以 payload hash 作不可變 `broker-consumer-observation:<hash>`；可變 v2 head 只指向該原始 receipt。writer 必須重驗資料庫目前正式配置，且在 transaction 再綁定相同配置；head 使用舊 checkpoint 的 CAS，避免並行覆蓋。新 observation 時間必須嚴格前進，相同原值重跑 no-op，不重填 observedAt。v1 head 更新前另存原 payload；競爭落敗的真實 observation 可保留但不得成為 head。未知、過期、未登錄或身份不符均拒絕，禁止任意附加憑證欄位。這是供既有工作的寫入接口，不會自行生成 quota reset、實測用量或各工作的剩餘承諾；完整 consumer roster 與各工作呼叫接線仍須實際驗收。

若額度不足或備援失敗，只保留 progress／下一次時間與原失敗，不開逐檔分鐘 K 的第三級備援、不讓 UI／GET 觸發擷取。此版本不包含新增 broker 連線，也不把本機個人使用的來源 review 解讀為可公開再散布。

2026-10-03 使用者確認已線上簽署永豐金證券《API 電子交易風險預告書暨使用同意書（證券）》。本案個人本機分析使用範圍以使用者確認及相關 API 文件作審查依據，不額外要求文件未規定的「個人分析特別書面許可」，亦不索取簽署截圖、帳密或金鑰。隱私聲明的個人資料查閱與本案全市場價量資料不同；證券 API 文件提及程式訊號、行情資訊及約定，但不能據此宣稱可公開再散布或略過來源數值／歷史覆蓋／預算 Gate。來源 review 全部必要證據成立後才可標 verified，使用者簽署確認本身不等於 160 日資料已驗證。

程式亦移除 Shioaji review 中額外的 `localDisplayVerified=true` 前置條件；已開通官方 API 的 `local-historical-screener` 用途不另外要求展示許可。舊欄位只保留原始 metadata，不改寫舊 review／receipt，不憑空填成 true；provider、固定官方端點、本機用途、技術 status、日期／單位／價格／交易範圍、效期、母體及預算檢查保持原樣。此修正只限 Shioaji API，不能用它解除 TWSE／TPEx 官網指定日期歷史入口各自的使用限制。

### 5.4 本機持久保守帳本（使用者同意，2026-10-03）

實際 `/auth/usage` 只有共享 bytes／limit／remaining，沒有額度週期 ID。本機新 v3 政策改採 `local-conservative-v1` 不可變錨點，不再要求不存在的 provider epoch；原 v1／v2 政策及收據保留。錨點以一次性 CAS 建立，明示 `providerQuotaEpochVerified=false`，不由日期、API generation 或 counter 下降推導新身份。原始 counter 與本機保守累計分列；counter 下降不清舊消耗，下一段正增量仍繼續累加。政策到期、limit 改變、錨點破損或觀察競爭一律拒絕，不自行重建或解除債務。

本機 admission 的持久保留、速率及 single-flight 亦納入所有舊 scope／epoch，避免轉換身份時漏扣舊債。已送出／已耗／未知的 estimate 持續扣住；只有確定尚未送出的取消及 owner-dead 回收可以解除。預算使用實際共享 counter 上界樣本，可配置倍率、每批上限、行情／互動／未接中央帳本工作的保護池；保護池是已配置保留，不是假稱其他工作已完成或實際剩餘為零。不得因有保護池就宣稱所有外部消費者已採用中央 admission。

現有盤後基準的預算 producer 讀取真實最新 budget 檔，重算來源樣本、完整 forecast 及配置底額；每次實際讀取追加配置觀察與 CAS head。保留完整 forecast，即使前一日成功亦不自動填零；檔案缺席、破損、身份不同或新增未知 roster 均拒絕。`monitor-baseline-allocation` 是持續保護配置，不是當前工作完成／剩餘用量宣告。其他互動、dynamic candidate、bootstrap、ATR 與手動歷史查詢尚未逐請求加入中央帳本，皆保留在有明確配置的共用保護池內；其額度不能當布林可用額度。既有工作不重啟、不改圖表／清單／盤中流程。

正式啟用須保存實際配置、兩份非重疊用量 evidence、最新基準預算 hash、admission 與安全 business-session。此設計能保守準備本次窗口，但若未知外部工作超過配置池或 lifetime 累計不足，會停止並保留進度，不自動清帳或承諾永不耗盡。

使用者明確授權時，可在原政策仍有效期間執行操作者複核；watcher 不自行延長。入口須核對不可變本機錨點、兩份實測的原始來源與收據 hash，重讀最新盤後基準配置並查詢真實 simulation business-session／usage。保留所有已耗與未知 reservation，無活躍 dispatch 且扣除共用保護池、基準配置與舊債後仍足以容納一批，才可延長效期。新效期最多從複核時間起七日，且不得超過原實測三十日有效期；不改原額度、速率、估量倍率、來源使用範圍或 quota identity。原政策另存不可變 archive，追加複核 proof，以 transaction 綁定原政策、錨點、counter、reservation 與配置 head 的 CAS 更新。原政策已過期、來源證據破損、limit 改變、預算不足或競爭落敗均拒絕，不能只換日期解鎖。當日複核與 admission 成功不等同未來排程或行情已取得。

### 6. 每交易日成功發布一次，本機排程自主續跑

沿用本機已存在五分鐘 watcher 的盤後工作入口，新增 independent readiness 分支與 capability-aware idle gate；不新增 Codex heartbeat，不改 TDCC 頻率。官方交易日 14:00 Asia/Taipei 起可準備，兩市場同日的已驗證官方或備援價量 ready 才發布；14:00 是檢查起點，不保證來源當時已公布。今日兩市場無共同錨點時保留 `expectedSessionDate`／`effectiveSessionDate`／原因與舊快照，舊列標示過期並禁止當作今日可操作結果。

日曆亦不得依賴 TDCC／v5 排程成功。可先共用尚有效的官方交易日 cache；缺少或到期時，純價量入口自行讀取最近三個年度 TWSE／TPEx 官方日曆，涵蓋最多 400 日的計畫需求。單次最多六次、每次不重試／不跟轉址，30 秒及 2 MiB 上限，整輪最多 180 秒／12 MiB，併入同一 15 分鐘 run 預算與共享租約。新年度 cache 最多有效 30 日且不得超過已確認年度結束，避免每天重抓同一份年度日曆；年度缺口、解析錯誤或傳輸失敗保留 pending，不延長過期 authority。此 authority 僅供盤後規劃，不授予 broker write；每日發布仍須兩市場當日已驗證來源的完整批次，不限必須由兩個官方網站分別取回。失敗至少冷卻 20 分鐘，429 至少一小時且遵守 Retry-After；新增日曆失敗收據 append，不改原收據或盤中日曆 policy。

每個 provider/market/date/capability 最多 18 次來源嘗試；Shioaji 的 market scope 為共用全市場，不分市場重複計數。一般等待至少 20 分鐘，429 依 Retry-After 且至少一小時，傳輸失敗有界退避；schema／日期契約違反時保留 invalid，不自動解除。run 上限 15 分鐘、單一租約與 checkpoint；程序中止後可續跑，失敗收據 append，不覆寫。新能力預算不借用盤中擷取流量，不改既有來源安全 policy。

唯一成功發布鍵是 `(D, universeRevision, dataMappingVersion, formulaVersion, dailyProfileRevision)`，先 staging、核對母體／雙市場 batch 終態、再原子切 head。成功後同鍵重觸發為 no-op，不重抓或重算。資料底稿與每日預設報告保存引用關係；只有使用者明確儲存不同每日 profile，才可另建同日新設定版本，舊報告保留，不拿自動重跑當設定變更。

RunAtLoad／既有 watcher 喚醒時解析官方完成交易日；晚開機只補最近已完成且未完成的日，不自動從數週前無界補跑每日報告。休市不產生新 D。每次 receipt 保存 nextAttemptAt／實際開始結束／trigger，完成後下一允許工作為下一官方交易日 14:00。新能力完成不停止其他未完成 capability；v5 完成也不能令新能力提早休眠。背景已完成的查詢參數調整可以依凍結底稿唯讀判定，不構成來源重跑。

### 7. 精簡 UI、偏好與操作隔離

新增「技術型態 → 布林壓縮與突破」，v7→v8 偏好只新增預設關閉的分支、預設全選三類，其餘值保留。啟用才展開階段選擇與主要門檻；其他參數放進進階設定收合。結果區提供全部／正在壓縮／準備突破／今日正式突破切換，分類計數以全市場策略結果計算；若另啟用其他條件，明示交集／組合後筆數，不能與策略總數混淆。

草稿更動不改動已套用查詢或每日自動 profile；「開始篩選」查詢當期凍結底稿，「套用至每日自動篩選」是獨立、明確的本機設定儲存動作，保存 revision 與生效狀態，不觸發來源擷取。完成初始化後可在沒有任何瀏覽器的情況下繼續每日工作。參數需要擴窗時顯示待準備及所需／已備日數，不影響既有可用報告。

結果卡短摘要保存 symbol／名稱／互斥階段／資料日、BBW／percentile／b 與量能倍數；完整 evidence 收合。只點選股票連動指定且未鎖定圖表；明確「加入清單」才沿用現有 Shioaji「選股」與 MultiView「選股篩選」流程，不自動跟隨切換、不改交易商品／草稿。未知原因與過期警告不能被收合到不可見。所有文案為資料訊號，不稱「明日必漲」或借用研究年化報酬。

## Risks / Trade-offs

### 臨時全日休市修正（2026-10-04）

年度表是預定交易日，不是臨時休市的完整清單。新增 `official-full-day-market-closures-v1`：從已驗證的 TWSE 年度新聞清單 `rwd/zh/news/newsList?response=json&startDate=YYYY&endDate=YYYY` 取得明確「集中交易市場某年月日全日休市」公告；完整 fields、totalCount、年度、合法日期、公告 ID 及原文 hash 均須驗證。民國／西元、最多七日跨度及非颱風緊急原因可解析，不寫死 7/10 或颱風名稱。條件式防災規則、公司代號具名停復牌、個別商品、盤後／下午／夜盤停止不排除全日；撤銷／恢復、日期／範圍不明回 review_required，不能自行推定。以明確全日停止的一市場公告排除「兩市場共同交易日」，不把 TWSE 證據冒充 TPEx 公告；TPEx-only 突發公告尚無已驗證 transport/schema，自動辨識屬保留限制，空行情仍阻止完整發布而非猜休市。

公告按年度 checkpoint；當年度每個台北日期刷新一次、過去年度 30 日，年度表仍沿用原 30 日 cache。三年度最多三次公告 HTTP，每次 30 秒／2 MiB、不跟轉址／不內部重試，整輪 180 秒／6 MiB 並納入既有 15 分鐘 deadline；價量的兩 HTTP／run 與 broker 用量政策不變。來源失敗至少 20 分鐘、429 至少一小時並遵守 Retry-After。single-flight 租約、冷卻與同日有效快取的 zero-write 分開；失去租約者不能覆寫新來源 head。

原年度 cache、日行情空批次及已耗 18 次紀錄保持原樣；新增 append-only 原始公告／來源 hash、有效共同日 authority 及 calendar_replanned 收據。使用新共同日重新計算 160 日（或設定所需更長）窗口，依法向前延伸，不以較早日冒充休市日；只有新計畫新增的實際交易日才需要既有 watcher 有界補建。曾發布的歷史快照仍保留；成功 idle gate 必須核對 historySessions，混合來源的新 mapping 綁定新窗口，舊固定 mapping 窗口更正則明示 review_required 而不暗中覆寫同鍵快照。

- [初次 160 日及成交金額回補較久] → 同市場日期批次、最新日優先、只補缺、有界續跑；尚未備齊明示 pending，不先降成 130 日。
- [突破日沿用縮量會漏訊號] → setup 與 trigger 分開，回歸測試包含當日帶寬展開、量放大且前日壓縮案例。
- [不同參數／日期混算] → 凍結 D、profile／criteria fingerprint、來源／formula version、cursor 與 evidence hash；純價量與籌碼同日 join。
- [空報表被誤當休市] → 使用官方 authority，來源失敗不更動交易日歷史。
- [舊 idle／prune 使新能力漏跑或缺歷史] → capability-aware readiness 與 retention union 測試必須涵蓋 v5 已完成、v8 未完成。
- [未還原價格受除權息／分割影響] → 與既有官方未還原基礎一致且 UI 明示；不混還原資料，相關事件過濾未納第一版、不宣稱已排除假突破。
- [邊界浮點與顯示 rounding] → 新策略獨立未格式化精度契約、量／金額以 canonical 整數比較、固定 quantile 算法與 ties；既有圖表 reference formula 保持不變。
- [研究參數被解讀為高勝率] → 來源參考與本產品預設分開，沒有回測不寫績效保證。

## Migration Plan

1. 分別驗證官方日報／Shioaji 日行情的成交金額欄位、單位、date／使用權與來源限制；只採有效 review 的來源，新增獨立 capability/schema，不啟用正式查詢。
2. 建立 v8 純函式、設定驗證／偏好遷移、history plan 與保留聯集，跑現有 v1–v7 回歸。
3. 以有界準備器補預設 160 日、雙市場逐商品核對；符合合法例外者分類 unknown，不補造資料。
4. staging v8 價量底稿與預設三類報告，核對全市場守恆與代表商品公式，不改舊 head。
5. 接入新版 API／gateway／UI／每日 profile 儲存與本機 readiness；檢查真正載入的排程入口、版本與下一工作時間，變更排程不得重啟共用服務。
6. 完成至少一個真實官方交易日資料的原始自動 run／發布／重複觸發 no-op 與畫面驗收後才宣告功能完成；late-boot、斷程序續跑可用隔離測試驗證，不偽稱當日真實事件。
7. 回滾只關閉 v8 能力／每日 profile 或回退 v7 查詢，保留 v8 原始收據、報告與其他能力需要的歷史；不停止行情服務。

## Open Questions

- TWSE／TPEx 與 Shioaji 各自的實際成交金額、單位、歷史可取得範圍、價格／交易範圍相容性及使用限制，須於 task 1.1／8.1 以真實 response 與來源文件核實；兩日期探測不能代替全窗口驗證。來源 review 不互相冒充，共同日曆缺口仍 fail closed。
- 有界歷史補齊的全市場 bytes／run time 與 snapshot 體積須量測，再設定在既有來源限制內的每次日期批次額度；不足時續跑，不承諾初始化當次必完成。

策略定義與 UI 決策沒有待使用者選擇的阻礙，上述為實作前置查證。

## References

- 使用者分享對話：https://chatgpt.com/share/6ac062c0-5ce0-83ee-9b92-ce294b049fa6
- John Bollinger 官方規則：https://www.bollingerbands.com/bollinger-band-rules
- FinLab 研究：https://finlab.finance/blog/bollinger-bands-taiwan （月頻策略，不能當本功能績效）
- Shioaji 官方每日行情參考：https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md#daily-quotes-每日行情
- Shioaji 官方歷史資料：https://sinotrade.github.io/tutor/market_data/historical/ （KBars 為分鐘資料；第一版備援不採逐檔分鐘回補）
- Shioaji 官方用量限制：https://sinotrade.github.io/tutor/limit/

`b >= 0.85` 的準備門檻、近期 5 日 setup、互斥分類及排除當日量能基準為本 change 的設計決策；不冒稱已由實盤或回測證明最佳。
