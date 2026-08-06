## ADDED Requirements

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

上市普通股與 ETF 的 `institutional-flow` 查詢包含今天、且主要歷史來源最新資料日落後時，系統 MUST 嘗試使用 TWSE T86 官方資料補入當日 row。解析 MUST 依官方 `fields` 欄位名稱對應，且 MUST 保存 `twse` provider、資料日期與取得時間。

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
