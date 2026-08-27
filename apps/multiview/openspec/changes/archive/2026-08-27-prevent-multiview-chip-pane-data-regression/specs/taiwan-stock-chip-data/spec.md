## ADDED Requirements

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
