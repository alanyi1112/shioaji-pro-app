## ADDED Requirements

### Requirement: 台股普通股籌碼適用範圍

系統 MUST 只為商品目錄確認為 TWSE／TPEx 普通股的 `.TW`／`.TWO` symbol 提供個股籌碼資料，且第一版 MUST 只支援 `1d` 週期。

#### Scenario: 查詢上市普通股
- **WHEN** 使用者查詢商品目錄中 `quoteType=EQUITY` 的 `2330.TW` 日資料
- **THEN** 籌碼 API 將該商品標示為 eligible
- **AND** 依請求日期範圍回傳可用日資料

#### Scenario: 查詢上櫃普通股
- **WHEN** 使用者查詢商品目錄中 `quoteType=EQUITY` 的 `8069.TWO` 日資料
- **THEN** 籌碼 API 將該商品標示為 eligible
- **AND** 使用 TPEx／上櫃適用的來源與欄位解析

#### Scenario: 查詢不支援商品或週期
- **WHEN** 使用者查詢 ETF、權證、海外商品、未知 symbol 或非 `1d` 週期
- **THEN** API MUST 回傳 `eligible=false` 或 `availability=unsupported`
- **AND** MUST NOT 呼叫籌碼上游或回傳其他商品的資料

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

系統 MUST 依 TDCC 官方持股分級定義保存與加總股權分散資料；預設散戶 MUST 為分級 1 至 3，預設大戶 MUST 為分級 15，且 UI 與 API MUST 揭露市場慣稱和實際股數邊界的差異。

#### Scenario: 計算 10 張以下散戶
- **WHEN** 同一個股及資料日期具有分級 1「1-999 股」、分級 2「1,000-5,000 股」與分級 3「5,001-10,000 股」
- **THEN** 散戶持股股數、人數及比例 MUST 分別加總分級 1 至 3
- **AND** 結果 MAY 標示為「10 張以下」

#### Scenario: 計算 1,000 張級距大戶
- **WHEN** 使用者選擇預設「1,000 張大戶」門檻
- **THEN** 系統 MUST 使用分級 15「1,000,001 股以上」的人數、股數及比例
- **AND** label、tooltip 或說明 MUST 揭露實際定義為超過 1,000 張，不得宣稱包含剛好 1,000,000 股

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

系統 MUST 只使用允許自動介接的 TWSE／TPEx／TDCC OpenAPI、政府開放資料或具明確 API 規範的歷史來源，並 MUST 為每個資料族群保留 provider、dataset、資料日期及來源更新時間。

#### Scenario: 使用官方 OpenAPI
- **WHEN** TWSE 或 TPEx OpenAPI 提供目標個股與資料族群
- **THEN** adapter MUST 依官方欄位名稱解析並保存官方 provider metadata
- **AND** 不得以欄位固定位置猜測未知格式

#### Scenario: 使用免費歷史 API
- **WHEN** 官方 OpenAPI 只提供最新快照或不便依個股回補歷史
- **THEN** 系統 MAY 使用具明確 API 規範的免費歷史來源依 symbol 與日期範圍回補
- **AND** response MUST 清楚標示該 provider，不得誤稱為交易所直接回應

#### Scenario: 一般網頁可查但未允許自動擷取
- **WHEN** 某資料只出現在限制自動擷取的一般網頁報表
- **THEN** 正式資料鏈 MUST NOT 以模擬瀏覽器、爬蟲或規避限制方式抓取
- **AND** 該欄位 MUST 改用合法 API 或標示 unavailable

#### Scenario: 取得 TDCC 最新全市場週快照
- **WHEN** 受保護同步工作呼叫 TDCC `GET /v1/opendata/1-5` 或同資料集官方 CSV
- **THEN** 系統 MUST 將其標示為 TDCC `shareholder-distribution` 來源
- **AND** MUST 驗證全檔資料日期、證券代號、分級唯一性、有限數值與合計後才寫入 D1

### Requirement: 免費股權分散歷史覆蓋

系統 MUST 清楚回報 D1 實際保存的股權分散歷史起訖日期，且 MUST NOT 因官方 OpenAPI 主要提供最新快照，就虛構、插值或未經授權抓取較早週資料。

#### Scenario: D1 只有上線後累積資料
- **WHEN** 使用者查詢早於 D1 最早合法保存日期的股權分散歷史
- **THEN** coverage MUST 回傳實際可用起日及 `history_not_archived` 或同等安全狀態
- **AND** 副圖 MUST 只顯示真實可用的週資料

#### Scenario: 匯入官方歷史 archive
- **WHEN** 實作確認 TDCC 提供允許批次介接的官方歷史檔案
- **THEN** 系統 MAY 在驗證來源日期、分級與合計後回補 D1
- **AND** MUST 保存 archive 的 provider、dataset 與 fetchedAt，不得誤稱為即時 OpenAPI 回應

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

系統 MUST 提供同源 `GET /api/taiwan-stock-chip`，驗證 symbol 與日期範圍，並回傳日頻 rows、週頻 `distributionRows`、coverage、sources、cache 與安全 warnings；單次日頻回傳 MUST 不超過 2,600 個交易日。

#### Scenario: 成功取得指定範圍
- **WHEN** 前端以 eligible symbol 與合法 `start`／`end` 查詢
- **THEN** API 回傳依 `sessionDate` 遞增排序且不重複的 rows
- **AND** 每列只含有限數值或 `null`

#### Scenario: 日期範圍無效或過大
- **WHEN** `start` 晚於 `end`、日期格式錯誤或單次範圍超過限制
- **THEN** API MUST 回傳 400 與安全錯誤碼
- **AND** MUST NOT 呼叫上游

#### Scenario: 來源只有部分資料族群
- **WHEN** 法人與融資融券可用但外資持股暫時缺少
- **THEN** API MUST 回傳可用 rows
- **AND** coverage 與 warnings MUST 標示 `partial_data`，不得讓整個請求失敗

#### Scenario: 回傳股權分散週資料
- **WHEN** D1 在請求日期範圍內有同一個股的 TDCC 快照
- **THEN** API MUST 依 `dataDate` 遞增回傳不重複的 `distributionRows`
- **AND** 每筆 MUST 包含正規化 levels、合計、資料頻率、provider 與實際資料日期

### Requirement: D1-first 快取、single-flight 與失敗退讓

系統 MUST 先讀 D1，只對缺口或過期範圍呼叫上游；相同 symbol、dataset 與日期範圍 MUST 共用 single-flight，並對 rate limit 或供應者失敗採取可重試退讓。

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
