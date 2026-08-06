## MODIFIED Requirements

### Requirement: 免費股權分散歷史覆蓋

系統 MUST 在免費官方來源允許的範圍內回補普通股與 ETF 的 TDCC 股權分散週歷史，並清楚回報 D1 實際保存的起訖日期、distinct week count、預期週數與 backfill job 狀態；系統 MUST NOT 虛構、forward-fill、插值或未經授權抓取較早週資料。若自動歷史來源尚未驗證，系統 MUST 允許受保護的官方完整檔案匯入，且 MUST NOT 宣稱背景回補正在執行。

#### Scenario: 回補官方可用的一年週歷史
- **WHEN** 受保護 ingest 發現 D1 缺少 TDCC 官方免費保存範圍內的週資料
- **THEN** 系統 MUST 建立可恢復 backfill job，依資料日期分批取得或匯入、驗證並冪等寫入普通股與 ETF rows
- **AND** 相同資料日期的多個 symbol MUST 共用同一份全市場輸入或本機 runner 產生的明確 targeted batch

#### Scenario: D1 只有部分累積資料
- **WHEN** 使用者查詢早於 D1 最早合法保存日期或官方免費歷史範圍的資料
- **THEN** coverage MUST 回傳實際可用起日、distinct week count 及 `history_not_archived` 或同等安全狀態
- **AND** 副圖 MUST 只顯示真實可用的週資料

#### Scenario: 歷史來源暫時不可用
- **WHEN** history adapter 逾時、格式驗證失敗或無法證明允許自動介接
- **THEN** 系統 MUST 保留 D1 已累積與最新 OpenAPI 快照
- **AND** MUST 回傳安全 warning、停止該批次且不得刪除既有週資料
- **AND** MUST 提供受保護官方完整檔案匯入途徑

#### Scenario: 匯入相同資料日期
- **WHEN** 排程、人工匯入或重試再次取得已成功保存的官方週資料
- **THEN** D1 upsert MUST 維持 `symbol + dataDate` 唯一且不得產生重複 rows
- **AND** coverage 與來源狀態 MUST 反映 D1 distinct dates 及最近一次成功驗證時間

#### Scenario: 回報實際回補狀態
- **WHEN** API 或健康檢查回報 shareholder-distribution coverage
- **THEN** response MUST 包含實際起訖、已保存週數、預期週數、最後成功時間與 `idle`／`queued`／`running`／`partial`／`completed`／`failed` 或同等狀態
- **AND** 只有 queued 或 running job 才可標示歷史回補中

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
