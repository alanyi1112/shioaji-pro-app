## ADDED Requirements

### Requirement: 最新 TDCC 週資料必須從官方雙來源擇新

MultiView MUST 讀取 TDCC 官方 CSV 與 OpenAPI JSON 的實際資料日期，且 MUST 僅發布通過欄位、單一日期、合理筆數及目標商品 17 級距完整性驗證的候選。較舊來源 MUST NOT 覆寫較新資料；同日內容衝突 MUST 保留最後已驗證資料並標示衝突。

#### Scenario: CSV 比 OpenAPI 早發布新週次
- **WHEN** CSV 已有新週資料而 JSON 仍為上一週
- **THEN** 系統 MUST 在 CSV 完整驗證後採用其新資料日期，並記錄來源為 TDCC 官方 CSV

#### Scenario: CSV 無效而 JSON 有效
- **WHEN** CSV 缺欄位或目標商品級距不完整，JSON 有效且不比已存資料舊
- **THEN** 系統 MUST 可選用 JSON，且 MUST 保留 CSV 失敗原因

#### Scenario: 兩來源同日衝突
- **WHEN** CSV 與 JSON 的資料日期相同但目標商品持股內容不同
- **THEN** 系統 MUST NOT 靜默覆寫已驗證資料，並 MUST 記錄來源衝突

### Requirement: 新週資料檢查必須提早且有界

本機 MUST 在週五晚至週六上午執行有限次最新資料檢查，保留週六與週日的完整補跑；未發布、限流或網路失敗時 MUST 保留既有資料與安全收據，MUST NOT 密集無界輪詢。

#### Scenario: 早期檢查尚未發布
- **WHEN** 官方資料日期未比已存最新週次新
- **THEN** 檢查 MUST 以未更新／noop 結束，MUST NOT 重複啟動昂貴歷史補建

#### Scenario: 來源發布晚於早期檢查
- **WHEN** 早期檢查未見新週次，而後續週末時槽已見通過驗證的新週次
- **THEN** 後續時槽 MUST 可補入新資料，並以真正資料日期而非執行日期標示線圖
