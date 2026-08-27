# taiwan-stock-chip-data Specification

## Purpose
TBD - created by archiving change add-taiwan-stock-chip-subcharts. Update Purpose after archive.
## Requirements
### Requirement: 個股籌碼資料族群與語意

系統 MUST 將籌碼資料分成三大法人買賣超、外資持股、融資融券、借券及股權分散五個獨立資料族群，並保留每個欄位的原始語意、頻率與來源。

#### Scenario: 正規化三大法人買賣超
- **WHEN** 來源回傳單一個股的外資、投信、自營商自行買賣及自營商避險買進／賣出股數
- **THEN** 系統 MUST 分別計算並保存各類別淨買賣超股數
- **AND** 自營商合計 MUST 等於來源定義下可相加的自行買賣與避險淨額

#### Scenario: 計算三大法人合計買賣超
- **WHEN** 同一個股及交易日的外資、投信與自營商合計淨買賣超都有效
- **THEN** `institutionalTotalNetShares` MUST 等於三者淨買賣超股數相加
- **AND** 若來源另提供官方三大法人總計，系統 MUST 交叉驗證兩者一致後才標示該欄位完整

#### Scenario: 三大法人其中一項缺漏
- **WHEN** 同一個股及交易日缺少外資、投信或自營商合計中的任一項
- **THEN** `institutionalTotalNetShares` MUST 為 `null`
- **AND** MUST NOT 將缺少項目視為零後產生部分合計

#### Scenario: 正規化外資持股
- **WHEN** 來源回傳外資及陸資持有股數、發行股數與持股比率
- **THEN** 系統 MUST 保存持股股數及百分比
- **AND** MUST 保留來源日期與最近申報日期等可用 metadata

#### Scenario: 正規化融資融券
- **WHEN** 來源回傳融資與融券買進、賣出、償還、前日餘額、今日餘額及資券互抵
- **THEN** 系統 MUST 保存各流量與餘額
- **AND** MUST 以今日餘額減前日餘額產生可驗證的每日增減

#### Scenario: 正規化借券資料
- **WHEN** 來源只提供借券成交、借券餘額或借券賣出餘額中的部分欄位
- **THEN** 系統 MUST 只填入來源實際提供且語意相符的欄位
- **AND** MUST NOT 以融券或其他借券概念代替缺少欄位

#### Scenario: 正規化每週股權分散資料
- **WHEN** TDCC 開放資料回傳同一資料日期、證券代號與持股分級的人數、股數及占集保庫存數比例
- **THEN** 系統 MUST 將該資料保存為 `shareholder-distribution` 週頻資料
- **AND** MUST NOT 將其標示為每日資料、外資持股或已確認身分的投資人持倉

### Requirement: TDCC 持股分級與大戶散戶計算

系統 MUST 依 TDCC 官方持股分級定義保存與加總股權分散資料；預設散戶 MUST 為分級 1 至 3，預設大戶 MUST 為分級 15，並 MUST 支援以分級 12 至 15 精確組成市場慣稱「400 張以上」的選項；UI 與 API MUST 揭露市場慣稱和實際股數邊界的差異。

#### Scenario: 計算 10 張以下散戶
- **WHEN** 同一個股及資料日期具有分級 1「1-999 股」、分級 2「1,000-5,000 股」與分級 3「5,001-10,000 股」
- **THEN** 散戶持股股數、人數及比例 MUST 分別加總分級 1 至 3
- **AND** 結果 MAY 標示為「10 張以下」

#### Scenario: 計算 1,000 張級距大戶
- **WHEN** 使用者選擇預設「1,000 張大戶」門檻
- **THEN** 系統 MUST 使用分級 15「1,000,001 股以上」的人數、股數及比例
- **AND** label、tooltip 或說明 MUST 揭露實際定義為超過 1,000 張，不得宣稱包含剛好 1,000,000 股

#### Scenario: 計算 400 張級距大戶
- **WHEN** 使用者選擇「400 張以上」門檻
- **THEN** 系統 MUST 加總分級 12「400,001-600,000 股」、分級 13「600,001-800,000 股」、分級 14「800,001-1,000,000 股」與分級 15「1,000,001 股以上」的人數、股數及比例
- **AND** 詳細資料 MUST 揭露實際定義為 `400,001 股以上`，不得宣稱包含剛好 400,000 股

#### Scenario: 處理差異數調整與合計
- **WHEN** TDCC 回傳分級 16「差異數調整」與分級 17「合計」
- **THEN** 系統 MUST 保存兩者供完整度及總量驗證
- **AND** MUST NOT 將分級 16 或 17 加入大戶、散戶或其他持股級距

#### Scenario: 選擇非官方可精確組成的門檻
- **WHEN** 使用者或 API 提交無法由完整 TDCC 級距組成的任意門檻
- **THEN** 系統 MUST 拒絕該門檻或改回支援的官方級距選項
- **AND** MUST NOT 對單一級距按比例拆分或推估人數、股數及比例

### Requirement: 股權分散比例與身分語意

系統 MUST 將股權分散比例定義為 TDCC 發布的「占集保庫存數比例%」，並 MUST 將大戶／散戶描述為依持股級距計算的市場稱呼，不得推論帳戶背後的法人、自然人、關係人或實質受益人身分。

#### Scenario: 顯示股權分散比例
- **WHEN** 系統回傳大戶或散戶持股比例
- **THEN** response metadata MUST 指明比例分母為集保庫存數
- **AND** MUST NOT 將其誤標為占公司全部發行股數或自由流通股數比例

#### Scenario: 顯示持股人數
- **WHEN** 系統加總 TDCC 各級距人數
- **THEN** UI MUST 將結果標示為經 TDCC 規則編製的持股人數
- **AND** MUST NOT 宣稱每一人都是獨立自然人投資者

### Requirement: 缺值、零值與張數單位

系統 MUST 在內部保存法人與持股相關的整數股數，並只在已確認為普通股的顯示層換算張數；缺少、未發布與不適用 MUST 使用 `null`，不得偽裝成零。

#### Scenario: 普通股股數換算張數
- **WHEN** API 回傳 `foreignNetShares=12500`
- **THEN** 前端可將普通股數值顯示為 `12.5 張`
- **AND** API 與 D1 仍保存 `12500` 股

#### Scenario: 來源明確發布零值
- **WHEN** 來源明確回傳投信買進與賣出皆為零
- **THEN** 系統 MUST 保存投信淨買賣超為 `0`

#### Scenario: 來源沒有該欄位
- **WHEN** 某來源沒有提供借券賣出餘額
- **THEN** 系統 MUST 回傳該欄位為 `null`
- **AND** MUST NOT 以 `0`、前一日值或其他欄位補值

### Requirement: 不推算未公開法人持股

系統 MUST 只提供來源實際發布的外資及陸資持股資料，MUST NOT 由每日買賣超累加產生投信持股比、自營商持股比或任何未公開持倉。

#### Scenario: 使用者查看法人持股
- **WHEN** 使用者選擇外資持股副圖
- **THEN** 系統顯示來源發布的外資及陸資持股股數與比率
- **AND** 不顯示投信持股比或自營商持股比

#### Scenario: 歷史買賣超資料完整但沒有期初持股
- **WHEN** 系統取得多年的投信或自營商買賣超
- **THEN** 系統仍 MUST NOT 將累加結果標示為持股數或持股比

### Requirement: 合法且可追溯的免費資料來源

系統 MUST 優先使用允許自動介接的 TWSE／TPEx／TDCC OpenAPI、政府開放資料或具明確 API 規範的免費歷史來源，並 MUST 為每個資料族群保留 provider、dataset、資料日期及來源更新時間；必要功能 MUST NOT 依賴付費會員資料。經使用者明確啟用的背景 operator workflow MAY 以低速 session 操作 TDCC 公開頁面的原生 GET／POST 表單欄位，但 MUST 遵守當時使用規範、不得規避 CAPTCHA／封鎖，且正式 Worker／前端 MUST NOT 內嵌歷史 HTML parser、cookie／token session 或使用未驗證隱藏 API。

#### Scenario: 使用官方 OpenAPI
- **WHEN** TWSE 或 TPEx OpenAPI 提供目標普通股／ETF 與資料族群
- **THEN** adapter MUST 依官方欄位名稱解析並保存官方 provider metadata
- **AND** 不得以欄位固定位置猜測未知格式

#### Scenario: 使用免費歷史 API
- **WHEN** 官方 OpenAPI 只提供最新快照或不便依證券回補歷史
- **THEN** 系統 MAY 使用具明確 API 規範的免費歷史來源依 symbol 與日期範圍回補
- **AND** response MUST 清楚標示該 provider，不得誤稱為交易所直接回應

#### Scenario: 一般網頁禁止自動擷取
- **WHEN** 某資料只出現在明確限制自動擷取的一般網頁報表
- **THEN** 正式資料鏈與背景 operator workflow MUST NOT 以模擬瀏覽器、爬蟲或規避限制方式抓取
- **AND** 該歷史工作 MUST 標示 `history_automation_not_permitted` 或 unavailable，保留最新合法 OpenAPI 累積資料

#### Scenario: 使用 TDCC 受保護背景 operator workflow
- **WHEN** 使用者已明確啟用背景回補，且 TDCC 公開歷史查詢頁當時規範未禁止該低速操作
- **THEN** GitHub runner MAY 以單一併發、固定間隔、同一 cookie／synchronizer token session 及頁面原生表單取得 queue 指定 symbol／日期
- **AND** MUST 在 CAPTCHA、封鎖、候選不一致或格式漂移時停止，不得規避

#### Scenario: 取得 TDCC 最新全市場週快照
- **WHEN** 受保護同步工作呼叫 TDCC `GET /v1/opendata/1-5` 或同資料集官方 CSV
- **THEN** 系統 MUST 將其標示為 TDCC `shareholder-distribution` 來源
- **AND** MUST 驗證全檔資料日期、證券代號、分級唯一性、有限數值與合計後才寫入 D1

#### Scenario: 使用 TDCC 官方歷史匯出
- **WHEN** TDCC 提供可直接取得、免費且允許自動介接的歷史匯出或檔案
- **THEN** history adapter MUST 保存官方資料日期、下載時間及來源識別，並沿用最新快照的嚴格驗證
- **AND** 若 URL、格式或授權無法確認，正式 network adapter MUST fail closed

### Requirement: 免費股權分散歷史覆蓋

系統 MUST 在免費官方來源允許的範圍內，以背景排程持續保存普通股與 ETF 的 TDCC 股權分散週資料；任何新加入網站且符合 eligibility 的台股 symbol MUST 自動建立 coverage、回補官方免費歷史並持續保存後續新週。系統 MUST 清楚回報 D1 實際保存起訖與 gap，且 MUST NOT 虛構、forward-fill、插值或規避來源限制取得較早週資料。

#### Scenario: 無流量仍保存最新週資料
- **WHEN** 正式站沒有圖表請求但 TDCC 已發布新的合法週快照
- **THEN** 背景排程 MUST 取得、驗證並冪等保存目前目標集合 rows
- **AND** opportunistic refresh MUST 只作為補充，不得是唯一更新機制

#### Scenario: 新加入普通股或 ETF
- **WHEN** 商品目錄或使用者清單首次加入尚無完整 coverage 的合格台股 symbol
- **THEN** 系統 MUST 在下一個排程週期自動建立歷史回補工作
- **AND** 完成後 MUST 持續納入未來最新週 snapshot

#### Scenario: 回補官方可用的一年週歷史
- **WHEN** 背景 discovery 發現 D1 缺少 TDCC 官方免費保存範圍內的週資料
- **THEN** 系統 MUST 依官方實際資料日期分批取得、驗證並冪等寫入普通股與 ETF rows
- **AND** 本機／背景 targeted batch MUST 只處理明確 queue symbol，正式全市場歷史來源則 MUST 共用同一資料日期輸入

#### Scenario: D1 只有部分累積資料
- **WHEN** 使用者查詢早於 D1 最早合法保存日期或官方免費歷史範圍的資料
- **THEN** coverage MUST 回傳實際可用起日、missing weeks 與逐 symbol queue／blocked 狀態
- **AND** 副圖 MUST 只顯示真實可用的週資料

#### Scenario: 歷史來源暫時不可用
- **WHEN** history runner 逾時、格式驗證失敗、來源封鎖或使用規範不允許背景操作
- **THEN** 系統 MUST 保留 D1 已累積與最新 OpenAPI 快照
- **AND** MUST 回傳安全 warning 且不得刪除既有週資料或規避來源限制

#### Scenario: 匯入相同資料日期
- **WHEN** 排程或人工重試再次取得已成功保存的官方週資料
- **THEN** D1 upsert MUST 維持 `symbol + dataDate` 唯一且不得產生重複 rows
- **AND** coverage 與來源狀態 MUST 反映最近一次成功驗證時間

### Requirement: D1 日資料持久化與局部合併

系統 MUST 使用 Sites D1 依 `symbol + sessionDate` 保存正規化日資料、依 `symbol + dataDate` 保存週頻股權分散，並保存每個 dataset 的抓取狀態；不同資料族群的局部更新 MUST NOT 清空彼此欄位。

#### Scenario: 首次回補個股歷史
- **WHEN** D1 沒有請求範圍的 `2330.TW` 籌碼資料且上游回傳有效資料
- **THEN** 系統批次 upsert 每個交易日
- **AND** 寫入 coverage、來源與最近成功時間

#### Scenario: 後續只更新融資融券
- **WHEN** 同一日期已保存法人與外資持股，新的請求只取得融資融券
- **THEN** 系統只更新融資融券欄位與其 provenance
- **AND** 原有法人與外資持股欄位保持不變

#### Scenario: Migration 保持既有資料相容
- **WHEN** 新 D1 migration 套用到已存在清單、K 線快取、商品目錄與 TPEx mirror 的資料庫
- **THEN** 新增 table 與 index MUST 成功建立
- **AND** 既有 table 與資料 MUST 保持可讀寫

#### Scenario: 保存每週股權分散快照
- **WHEN** TDCC 同一資料日期的全市場快照通過驗證
- **THEN** 系統 MUST 以 `symbol + dataDate` 冪等保存分級 1 至 15、差異調整、合計及來源 metadata
- **AND** 再次匯入相同資料日期不得產生重複週資料

### Requirement: 個股籌碼 API 範圍與回應契約

系統 MUST 提供同源 `GET /api/taiwan-stock-chip`，驗證 symbol 與日期範圍，並回傳 top-level eligibility、逐 dataset 的 `datasetEligibility` 與 `availability`、日頻 rows、週頻 `distributionRows`、coverage、sources、cache、股權分散 backfill 安全摘要與 warnings；單次日頻回傳 MUST 不超過 2,600 個交易日，新增欄位 MUST 與既有前端相容。

#### Scenario: 成功取得指定範圍
- **WHEN** 前端以 eligible 普通股或 ETF symbol 與合法 `start`／`end` 查詢
- **THEN** API 回傳依 `sessionDate` 遞增排序且不重複的 rows
- **AND** 每列只含有限數值或 `null`

#### Scenario: 日期範圍無效或過大
- **WHEN** `start` 晚於 `end`、日期格式錯誤或單次範圍超過限制
- **THEN** API MUST 回傳 400 與安全錯誤碼
- **AND** MUST NOT 呼叫上游

#### Scenario: ETF 來源只有部分資料族群
- **WHEN** ETF 的法人、外資持股及融資融券可用但借券沒有紀錄
- **THEN** API MUST 回傳可用 rows，並在 `datasetEligibility`／`availability` 個別標示借券狀態
- **AND** warnings MUST 標示 `partial_data`，不得讓整個請求失敗

#### Scenario: 回傳股權分散週資料
- **WHEN** D1 在請求日期範圍內有同一普通股或 ETF 的 TDCC 快照
- **THEN** API MUST 依 `dataDate` 遞增回傳不重複的 `distributionRows`
- **AND** 每筆 MUST 包含正規化 levels、合計、資料頻率、provider 與實際資料日期
- **AND** shareholder-distribution coverage MUST 附帶不含秘密的 backfill 狀態與週數

#### Scenario: 圖表請求遇到未完成歷史回補
- **WHEN** backfill job 為 queued、running、partial 或 failed
- **THEN** API MUST 立即回傳 D1 目前可用資料與安全狀態
- **AND** MUST NOT 在公開請求內同步下載完整一年歷史

### Requirement: D1-first 快取、single-flight 與失敗退讓

系統 MUST 先讀 D1，只對缺口或過期範圍呼叫上游；相同 symbol、dataset 與日期範圍 MUST 共用 single-flight，並對 rate limit 或供應者失敗採取可重試退讓。「我的清單」內合格台股的法人、外資持股、融資券與借券資料 MUST 由立即背景工作及 durable scheduler 預先填入 D1，開圖時按需補抓只能作為 fallback，不得是取得歷史資料的唯一觸發。

#### Scenario: 多個 panel 同時查詢相同個股
- **WHEN** 多個 panel 同時請求相同 symbol、dataset 與日期範圍
- **THEN** 系統 MUST 最多建立一個進行中的上游請求
- **AND** 所有 panel 共用同一結果

#### Scenario: D1 已完整覆蓋請求範圍
- **WHEN** coverage 顯示 D1 已包含完整且仍有效的日期範圍
- **THEN** API MUST 直接回傳 D1 資料
- **AND** MUST NOT 呼叫上游

#### Scenario: 上游失敗但有舊資料
- **WHEN** 上游 timeout、429 或暫時不可用且 D1 已有部分／過期資料
- **THEN** API MUST 回傳最近成功資料
- **AND** cache 或 warnings MUST 標示 `stale_cache`、`rate_limited` 或 `provider_unavailable`

#### Scenario: 多個 panel 同時需要股權分散資料
- **WHEN** 多個 panel 同時顯示相同或不同台股個股的大戶／散戶副圖
- **THEN** 各 panel MUST 先共用 D1 已保存的週快照
- **AND** 若需要更新最新 TDCC 資料，全站最多執行一個全市場 snapshot 請求，不得逐 panel 或逐 symbol 重複下載

#### Scenario: 清單台股尚未開圖
- **WHEN** 合格台股已加入「我的清單」但使用者從未開啟該商品線圖
- **THEN** 背景立即預熱或 durable scheduler MUST 主動補齊最近兩年可取得的日籌碼
- **AND** 第一次開圖 MUST 優先使用已保存 D1 rows，不等待完整歷史下載才開始顯示

### Requirement: 秘密與診斷資訊安全

任何免費歷史 API token、Sites bypass token 與 ingest secret MUST 只存在 runtime 環境變數或受保護 workflow；前端、repo、OpenSpec、API response、測試 fixture 與 log MUST NOT 包含秘密或完整上游錯誤內容。

#### Scenario: 歷史 API token 已設定
- **WHEN** Worker 使用 `FINMIND_API_TOKEN` 呼叫上游
- **THEN** token MUST 只出現在伺服器端 request header 或允許的 query 位置
- **AND** response 與 log 只回傳 provider 名稱及安全狀態

#### Scenario: 受保護排程 ingest
- **WHEN** private workflow 寫入最新官方資料
- **THEN** internal endpoint MUST 驗證 Sites 存取與獨立 ingest secret
- **AND** payload MUST 驗證資料日期、代號、重複值、筆數及有限數值後才可寫入 D1

### Requirement: 台股證券籌碼資料族群適用範圍

系統 MUST 將商品目錄中啟用的 TWSE／TPEx 普通股與 ETF 視為可評估的台股籌碼證券，並 MUST 依 `institutional-flow`、`foreign-holding`、`margin-short`、`securities-lending`、`shareholder-distribution` 各資料族群分別回報支援與可用狀態。籌碼資料仍 MUST 只支援 `1d` 週期。

#### Scenario: 查詢上市或上櫃普通股
- **WHEN** 使用者查詢商品目錄中 `quoteType=EQUITY` 且 exchange／suffix 一致的 `.TW` 或 `.TWO` 日資料
- **THEN** 籌碼 API 將該商品標示為 eligible
- **AND** 依請求日期範圍與交易所回傳各資料族群狀態

#### Scenario: 查詢 ETF 的多個資料族群
- **WHEN** 使用者查詢商品目錄中 `quoteType=ETF` 且 exchange／suffix 一致的 `.TW` 或 `.TWO` 日資料
- **THEN** 籌碼 API MUST 將該 ETF 標示為 eligible 並逐 dataset 評估來源
- **AND** 一個 dataset 無紀錄 MUST NOT 讓其他可用 dataset 失敗

#### Scenario: ETF 某資料族群沒有紀錄
- **WHEN** 來源對目標 ETF 沒有融券、借券或其他指定 dataset 紀錄
- **THEN** 該 dataset MUST 回傳 `not_published`、`unavailable` 或同等安全原因
- **AND** MUST NOT 以零值代替缺值或回傳其他證券資料

#### Scenario: 查詢不支援商品
- **WHEN** 使用者查詢權證、海外商品、未知 symbol、停用商品或 exchange／suffix 不一致的商品
- **THEN** API MUST 回傳 `eligible=false`
- **AND** MUST NOT 呼叫籌碼上游或回傳其他商品的資料

#### Scenario: 查詢非日 K
- **WHEN** eligible 普通股或 ETF 使用非 `1d` 週期請求籌碼
- **THEN** 各 dataset MUST 回傳 `unsupported_interval` 或同等不適用狀態
- **AND** MUST NOT 呼叫籌碼上游

### Requirement: 外資與投信原始買進賣出

系統 MUST 以整數股數保存外資與投信每日原始買進、賣出及淨買賣超，外資 gross 與 net MUST 使用相同來源分類集合；股數轉張只可發生在顯示層，MUST NOT 以已四捨五入張數重新計算淨額。

#### Scenario: 正規化外資分類
- **WHEN** 來源將外資拆成 `Foreign_Investor` 與可相加的 `Foreign_Dealer_Self`
- **THEN** `foreignBuyShares` 與 `foreignSellShares` MUST 分別加總相同分類的原始買進與賣出股數
- **AND** `foreignNetShares` MUST 使用相同分類集合的未四捨五入股數計算或採用可驗證的來源淨額

#### Scenario: 正規化投信買進賣出
- **WHEN** 來源回傳 `Investment_Trust` 的買進與賣出股數
- **THEN** 系統 MUST 保存 `investmentTrustBuyShares` 與 `investmentTrustSellShares`
- **AND** `investmentTrustNetShares` MUST 等於未四捨五入買進股數減賣出股數，或等於通過驗證的來源淨額

#### Scenario: 只有淨額沒有買進賣出
- **WHEN** 合法 fallback 來源只提供某法人淨買賣超而沒有 gross buy／sell
- **THEN** 系統 MUST 保留可用淨額並將缺少的買進、賣出設為 `null`
- **AND** MUST NOT 由淨額任意拆分買進與賣出

#### Scenario: 顯示張數後出現四捨五入差
- **WHEN** 原始買進與賣出股數換算張數後的個別顯示值無法精確重現來源淨額張數
- **THEN** API 與 D1 MUST 保留原始股數與來源淨額語意
- **AND** MUST NOT 為了讓顯示張數相減吻合而修改任一原始欄位

### Requirement: 融資融券限額與使用率

系統 MUST 保存融資、融券今日餘額、限額及使用率；來源發布使用率時 MUST 優先保存來源值，只有來源未發布而今日餘額與正數限額皆有效時，才 MUST 以 `今日餘額 / 限額 * 100` 計算使用率。

#### Scenario: 來源直接發布使用率
- **WHEN** TPEx 或其他合法來源同時回傳今日餘額、quota 與使用率
- **THEN** 系統 MUST 保存來源使用率、限額與 provenance
- **AND** 計算值只可用於合理精度內的交叉驗證，不得覆蓋來源值

#### Scenario: 來源只提供餘額與限額
- **WHEN** TWSE 或歷史 API 回傳有效今日餘額與大於 0 的限額但沒有使用率
- **THEN** 系統 MUST 計算並保存對應的 `marginUtilizationPercent` 或 `shortUtilizationPercent`
- **AND** 計算 MUST 使用同來源、同證券、同日期且已正規化為相同張數單位的餘額與限額

#### Scenario: 限額缺漏或為零
- **WHEN** 限額缺漏、非有限值、為 0 或與餘額單位無法確認
- **THEN** 對應使用率 MUST 為 `null`
- **AND** MUST NOT 改以發行股數、融資餘額或其他不相同分母推算

#### Scenario: 來源值與計算值明顯不一致
- **WHEN** 來源發布使用率與同列餘額／限額計算值超出顯示精度容許範圍
- **THEN** 系統 MUST 保留來源值與 provenance 並產生不含秘密的安全 warning
- **AND** MUST NOT 靜默以計算值覆蓋來源發布值

### Requirement: 新增籌碼欄位向後相容

系統 MUST 將新增法人 gross 與信用交易限額／使用率保存於既有資料族群 JSON，並維持既有 `GET /api/taiwan-stock-chip` response、D1 rows 與局部合併相容；舊資料缺少新增鍵時 MUST 視為 `null`，不得使整筆資料失效。

#### Scenario: 讀取舊 D1 row
- **WHEN** D1 既有 row 只有法人淨額或融資融券原有欄位
- **THEN** API MUST 正常回傳既有欄位並將新增欄位視為 `null`
- **AND** MUST NOT 因缺少新增鍵刪除或拒絕該 row

#### Scenario: 局部更新新欄位
- **WHEN** refresh 取得同一日期的法人 gross 或信用交易限額／使用率
- **THEN** D1 upsert MUST 更新對應資料族群 JSON 與 provenance
- **AND** MUST NOT 清空同日外資持股、借券或其他未參與更新的資料族群

### Requirement: 日籌碼 coverage 必須反映實際資料日期

系統 MUST 以成功取得並保存的 rows 實際最早與最晚資料日更新日籌碼 fetch-state；請求的 `start`／`end` MUST NOT 直接作為已完成 coverage。來源只回傳前一交易日資料時，系統 MUST 保存可用 rows，但不得宣稱已覆蓋尚未發布的當日。

#### Scenario: 當日請求只取得前一交易日 rows
- **WHEN** API 請求結束日為 2026-07-21，而上游回傳的最新 `sessionDate` 為 2026-07-20
- **THEN** fetch-state 的 `coverage_end` MUST 為 2026-07-20
- **AND** 後續當日請求 MUST NOT 因請求範圍曾到 2026-07-21 而直接命中完整快取

#### Scenario: 上游後續發布當日 rows
- **WHEN** 同一 dataset 稍後成功取得 2026-07-21 rows
- **THEN** 系統 MUST 冪等保存當日資料並將實際 `coverage_end` 更新為 2026-07-21
- **AND** API coverage 與 provenance MUST 回報 2026-07-21

### Requirement: TWSE 三大法人當日官方 fallback

上市普通股與 ETF 的 `institutional-flow` 查詢包含 requested end、且主要歷史來源最新資料日落後時，系統 MUST 嘗試使用 TWSE T86 官方資料補入該日 row，不得受固定發布時間阻擋。解析 MUST 驗證官方頂層 `date` 並依 `fields` 欄位名稱對應，且 MUST 保存 `twse` provider、資料日期與取得時間。

#### Scenario: FinMind 落後但 TWSE 已發布
- **WHEN** FinMind 最新 row 為前一交易日，且 TWSE T86 已發布目標證券的當日資料
- **THEN** API MUST 合併 TWSE 當日 row 並回傳當日三大法人數值
- **AND** 當日 `institutional-flow` provenance MUST 標示 provider 為 `twse`

#### Scenario: TWSE 當日尚未發布
- **WHEN** FinMind 最新 row 落後且 TWSE T86 尚無目標證券當日資料
- **THEN** API MUST 保留最近成功 rows 並將當日 coverage 視為未完成
- **AND** 系統 MUST NOT 產生空白 row、零值 row 或虛構當日資料

#### Scenario: TWSE schema 缺少必要欄位
- **WHEN** T86 response 缺少證券代號、外資、投信、自營商或三大法人總計的必要欄位
- **THEN** adapter MUST fail closed 並保留最近成功資料
- **AND** MUST NOT 依未驗證的固定位置猜測欄位

### Requirement: 部分資料提示必須使用中文並說明更新節奏

API 與圖表提供給使用者的 warnings MUST 使用繁體中文資料名稱與原因，不得直接顯示 `securities-lending`、`foreign-holding`、`partial_data` 等內部代碼。提示 MUST 說明資料實際代表的內容、一般更新時段，以及網站會於背景更新或再次開啟圖表時重新檢查；更新時段 MUST 標明仍以來源實際發布為準。

#### Scenario: 外資及陸資持股尚未到目標交易日
- **WHEN** `foreign-holding` 的最新來源日期早於目標交易日
- **THEN** warning MUST 顯示「外資及陸資持股」，並說明內容為持有股數與占已發行股數比例
- **AND** MUST 說明來源通常於交易日晚間 21:00 更新，網站會於來源更新後重新檢查

#### Scenario: 借券成交最新紀錄早於目標交易日
- **WHEN** `securities-lending` 的最新紀錄日期早於目標交易日
- **THEN** warning MUST 顯示「借券成交」，並說明內容為當日借入證券的成交股數，且不等同借券賣出或放空
- **AND** MUST 說明來源通常於交易日 15:00 更新，但無成交日期可能不會新增零值紀錄，不得一律宣稱尚未發布

#### Scenario: 部分資料彙總提示
- **WHEN** 至少一項籌碼資料 available 且至少一項尚未完整
- **THEN** warning MUST 使用「部分資料」中文標題，說明其他籌碼仍正常顯示
- **AND** warning MUST NOT 洩漏內部 reason code

### Requirement: TDCC 總戶數與人數變化

系統 MUST 從每筆完整 TDCC 快照的分級 17「合計」取得總戶數，並為總戶數及每個可精確聚合的大戶／散戶級距計算相對前一筆實際發布快照的人數變化。人數變化 MUST 使用當期減前期，並附兩筆實際 `dataDate`；週資料不得 forward-fill 成日資料。

#### Scenario: 計算總戶數變化
- **WHEN** 同一商品具有連續兩筆通過驗證的 TDCC 分級 17 合計
- **THEN** API MUST 回傳當期總戶數與「當期總戶數減前期總戶數」
- **AND** MUST 同時回傳當期與前期實際 `dataDate`

#### Scenario: 計算級距持股人數變化
- **WHEN** 使用者選定的大戶或散戶級距在連續兩筆快照皆完整
- **THEN** API MUST 回傳該級距當期聚合人數及相對前期的人數變化
- **AND** 任一必要分級缺漏時 MUST 回傳 `null` 或 partial，不得將缺漏視為零

### Requirement: 估算融資輸入與來源語意

台股籌碼資料契約 MUST 以股數或可無損正規化為股數的單位提供逐日融資餘額、買進、賣出、現金償還及相對前日餘額變化。個股「估算融資維持率」MUST 使用固定 60% 作為公開揭露的估算模型參數，並回傳模型來源與 `formulaVersion`；該參數不得宣稱為商品當日實際融資成數、個別券商授信成數或客戶帳戶實際維持率。若另有可驗證的實際融資成數資料，資料契約 MAY 另外回傳其數值、規則來源與有效日期，但 MUST NOT 在未揭露公式版本的情況下取代固定 60% 估算序列。

#### Scenario: 回傳完整估算輸入
- **WHEN** API 回傳某商品逐日融資流量、餘額及估算融資維持率輸入
- **THEN** API MUST 回傳正規化數值、原始單位、來源、來源日期、固定 60% 模型參數、模型來源與 `formulaVersion`
- **AND** 前端 MUST NOT 再自行猜測單位、模型參數或公式版本

#### Scenario: 無法取得實際融資成數
- **WHEN** 商品實際融資成數無法由可驗證資料判定
- **THEN** API MUST 仍可使用已揭露的固定 60% 模型參數計算「估算融資維持率」
- **AND** UI MUST 明確揭露該值不是商品實際融資成數或客戶帳戶實際維持率

#### Scenario: 缺少估算成本或收盤價
- **WHEN** 某交易日缺少合法估算融資成本或收盤價
- **THEN** 該日估算融資維持率 MUST 為 `null` 並提供可辨識原因
- **AND** MUST NOT 因固定模型參數存在而沿用前值、內插或生成虛構結果

### Requirement: 混合日籌碼請求必須保留來源實際日期

`GET /api/taiwan-stock-chip` 同時請求多個日資料集時，每個 dataset 欄位 MUST 具有可驗證且與 row `sessionDate` 相同的 `provenance.sourceDate`。來源回傳的最新日期早於 requested end 時，系統 MUST 保留實際日期並維持 partial／retry，不得把前一日數值複製、改標或補成 requested end。coverage、availability 與 warnings MUST 依實際合法 rows 計算。

#### Scenario: 來源已發布 requested end
- **WHEN** 任一時間來源回傳 requested end 當日的 `institutional-flow` 或 `margin-short`，且 row 日期可由來源 payload 驗證
- **THEN** API MUST 立即保存並回傳該日資料，不得等待固定時刻
- **AND** `sessionDate`、`sourceDate`、coverage end 與副圖 readout MUST 都是來源實際日期

#### Scenario: 來源只發布前一日
- **WHEN** requested end 為 8/5，但融資券來源最新合法 row 為 8/4
- **THEN** API MUST 只回傳標示 8/4 的融資券資料，coverage end MUST 為 8/4
- **AND** MUST NOT 建立 8/5 融資券 row、沿用 8/4 數值或讓 8/4 與 8/5 顯示相同資料

#### Scenario: row 與 provenance 日期不一致
- **WHEN** cache row 的 `sessionDate` 與 dataset `provenance.sourceDate` 不同，或日期無法由來源證明
- **THEN** API MUST 排除該 dataset 欄位並重新檢查來源，不得將該 row 視為完整 coverage

### Requirement: TWSE 融資券 fallback 必須驗證報表日期

上市普通股與 ETF 的 `margin-short` 官方 fallback MUST 使用回應中含明確報表 `date` 的 TWSE 日期查詢資料，並驗證彙總 table schema 後才可建立 row。沒有報表日期的 `MI_MARGN` OpenAPI 快照、HTTP header、請求日期或伺服器日期 MUST NOT 作為 `sessionDate`／`sourceDate`。

#### Scenario: TWSE 日期報表已發布
- **WHEN** requested end 的 TWSE 融資融券日期報表回傳 `stat=OK`、相同 `date`、合法 table schema 與目標證券資料
- **THEN** API MUST 立即保存並回傳該日 `margin-short`，provenance MUST 標示 provider `twse` 及已驗證來源日期

#### Scenario: TWSE 日期報表尚未發布
- **WHEN** requested end 的日期報表回覆查無資料，且其他來源最新 row 仍為前一日
- **THEN** API MUST 只保留前一日 row 並維持 requested end 未完成
- **AND** MUST NOT 以無日期 OpenAPI 快照建立 requested end row

#### Scenario: 舊版無日期 TWSE cache
- **WHEN** D1 中存在 provider `twse` 但沒有來源日期驗證標記的 `margin-short` row
- **THEN** API MUST 不顯示該欄位且不得以其日期命中完整 cache
- **AND** MUST 重新向可驗證日期的來源取得資料

### Requirement: 籌碼資料逐 dataset 非退化回應

系統 MUST 將 `institutional-flow`、`foreign-holding`、`margin-short`、`securities-lending` 與 `shareholder-distribution` 視為可獨立驗證及合併的資料切片。相同 `symbol + interval + dataset` 已有最後一次合法資料時，新的 HTTP 成功回應若為空、實際最新日期倒退、有效資料日期減少、provenance 失效或 coverage 不合理縮小，MUST 保留既有合法 rows、實際日期、coverage 與來源；其他有進步的 dataset MUST 仍可獨立更新。保留行為不得 forward-fill、插值、補零或把舊資料改標成 requested end。

#### Scenario: TDCC 最新回應暫時沒有目標商品
- **WHEN** D1 或最後已驗證切片已有某商品多週合法 `distributionRows`，但新的 TDCC HTTP 成功回應沒有該商品資料
- **THEN** 系統 MUST 保留既有 `distributionRows`、實際 `dataDate` 與 coverage
- **AND** availability／warning MUST 表達來源暫時未提供更新及目前保留最後已驗證資料，不得回傳假的 requested-end row

#### Scenario: 混合回應只有部分 dataset 更新
- **WHEN** 同一請求的法人資料新增合法交易日，但 `shareholder-distribution` 或借券資料較舊、為空或 coverage 倒退
- **THEN** 系統 MUST 接受法人 dataset 的新資料並保留其他 dataset 的最後合法切片
- **AND** 每個 dataset 的 coverage、source date、availability 與 provenance MUST 依自身實際資料計算

#### Scenario: 同一實際日期的合法來源修正
- **WHEN** 候選回應與既有切片具有相同實際資料日期，且候選值、完整度與 provenance 均通過驗證
- **THEN** 系統 MUST 可接受候選修正版並更新該日期資料
- **AND** MUST NOT 只因 row 數沒有增加而永久拒絕合法修正

#### Scenario: 首次請求確實沒有資料
- **WHEN** 相同 `symbol + interval + dataset` 沒有任何最後已驗證切片，且 API 合法回應為未發布或空資料
- **THEN** 系統 MUST 回傳真實的 empty／unavailable 狀態
- **AND** MUST NOT 借用其他 symbol、interval、dataset 或日期範圍的資料填入

#### Scenario: D1 上游更新失敗
- **WHEN** D1 已保存合法歷史資料，而上游 timeout、429、provider failure 或空回應
- **THEN** Worker MUST 以 D1 資料為基底回傳目前可用 rows 與實際 coverage
- **AND** MUST NOT 刪除、清空或以失敗 request 的 requested end 抬高既有資料日期

#### Scenario: Response identity 與 request 不一致
- **WHEN** payload、日資料 row 或 TDCC row 的 symbol／interval 與目前 request identity 不一致
- **THEN** 系統 MUST 拒絕整個候選 response，且不得寫入 request cache 或 verified-slice store
- **AND** MUST NOT 將錯誤商品的資料重新標成目前商品後顯示

#### Scenario: 同日候選欄位完整度退化
- **WHEN** 候選與既有資料日期相同，但候選缺少既有 dataset 中一個以上的已知有效欄位
- **THEN** 系統 MUST 保留較完整的既有 dataset object 與 provenance
- **AND** 完整度不退化且通過驗證的同日修正 MUST 仍可更新

#### Scenario: TDCC 級距不完整或無法對帳
- **WHEN** TDCC 候選缺少 1 至 15 任一級、調整列、合計列，或人數／股數／比例無法依官方語意對帳
- **THEN** 系統 MUST 將候選視為 invalid response，並保留相同 identity 的完整既有切片
- **AND** MUST NOT 只因預設大戶或散戶門檻仍可計算就接受部分級距

#### Scenario: 官方最新資料成功補尾且 D1 保留歷史
- **WHEN** 官方 fallback 成功取得 requested end 的合法新資料，而 D1 同時保留較早的已驗證歷史
- **THEN** availability MUST 依實際最新日期標示 available／partial，而不得只因 D1 rows 多於本次來源 rows 就標示 stale_cache
- **AND** coverage 與 rowCount MUST 依最後 D1 讀回的實際顯示資料計算
