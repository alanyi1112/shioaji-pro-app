## ADDED Requirements

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

## MODIFIED Requirements

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
