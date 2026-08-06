## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 合法且可追溯的免費資料來源

系統 MUST 只使用允許自動介接的 TWSE／TPEx／TDCC OpenAPI、政府開放資料或具明確 API 規範的免費歷史來源，並 MUST 為每個資料族群保留 provider、dataset、資料日期及來源更新時間；必要功能 MUST NOT 依賴付費會員資料。

#### Scenario: 使用官方 OpenAPI
- **WHEN** TWSE 或 TPEx OpenAPI 提供目標普通股／ETF 與資料族群
- **THEN** adapter MUST 依官方欄位名稱解析並保存官方 provider metadata
- **AND** 不得以欄位固定位置猜測未知格式

#### Scenario: 使用免費歷史 API
- **WHEN** 官方 OpenAPI 只提供最新快照或不便依證券回補歷史
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

#### Scenario: 使用 TDCC 官方歷史匯出
- **WHEN** TDCC 提供可直接取得、免費且允許自動介接的歷史匯出或檔案
- **THEN** history adapter MUST 保存官方資料日期、下載時間及來源識別，並沿用最新快照的嚴格驗證
- **AND** 若 URL、格式或授權無法確認，adapter MUST fail closed 並改用 D1 已累積資料

### Requirement: 免費股權分散歷史覆蓋

系統 MUST 在免費官方來源允許的範圍內回補普通股與 ETF 的 TDCC 股權分散週歷史，並清楚回報 D1 實際保存的起訖日期；系統 MUST NOT 虛構、forward-fill、插值或未經授權抓取較早週資料。

#### Scenario: 回補官方可用的一年週歷史
- **WHEN** 受保護 ingest 發現 D1 缺少 TDCC 官方免費保存範圍內的週資料
- **THEN** 系統 MUST 依資料日期分批取得、驗證並冪等寫入普通股與 ETF rows
- **AND** 相同資料日期的多個 symbol MUST 共用同一份全市場歷史輸入

#### Scenario: D1 只有部分累積資料
- **WHEN** 使用者查詢早於 D1 最早合法保存日期或官方免費歷史範圍的資料
- **THEN** coverage MUST 回傳實際可用起日及 `history_not_archived` 或同等安全狀態
- **AND** 副圖 MUST 只顯示真實可用的週資料

#### Scenario: 歷史來源暫時不可用
- **WHEN** history adapter 逾時、格式驗證失敗或無法證明允許自動介接
- **THEN** 系統 MUST 保留 D1 已累積與最新 OpenAPI 快照
- **AND** MUST 回傳安全 warning 且不得刪除既有週資料

#### Scenario: 匯入相同資料日期
- **WHEN** 排程或人工重試再次取得已成功保存的官方週資料
- **THEN** D1 upsert MUST 維持 `symbol + dataDate` 唯一且不得產生重複 rows
- **AND** coverage 與來源狀態 MUST 反映最近一次成功驗證時間

### Requirement: 個股籌碼 API 範圍與回應契約

系統 MUST 提供同源 `GET /api/taiwan-stock-chip`，驗證 symbol 與日期範圍，並回傳 top-level eligibility、逐 dataset 的 `datasetEligibility` 與 `availability`、日頻 rows、週頻 `distributionRows`、coverage、sources、cache 與安全 warnings；單次日頻回傳 MUST 不超過 2,600 個交易日，新增欄位 MUST 與既有前端相容。

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

## REMOVED Requirements

### Requirement: 台股普通股籌碼適用範圍

**Reason**: 原 requirement 以商品層級一次排除所有 ETF，與已確認可由免費來源提供的 ETF 籌碼資料不符。

**Migration**: 由新增的「台股證券籌碼資料族群適用範圍」取代；既有普通股 eligibility 保持相容，ETF 改採 dataset 層級判斷。
