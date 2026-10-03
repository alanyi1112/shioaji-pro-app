## ADDED Requirements

### Requirement: TDCC 雙來源暫時失效不得清空持股線圖

當 TDCC 官方 CSV 與 OpenAPI JSON 均無有效新資料，MultiView MUST 保留已驗證持股 rows、資料日期與可見線圖，並 MUST 將尚未發布、來源失敗及來源衝突區分呈現，不得將任何一種情況冒稱最新資料已完成。

#### Scenario: 新週資料來源仍停在前週
- **WHEN** 兩個官方端點仍未提供通過驗證的新週資料
- **THEN** 持股線圖 MUST 保留前週已驗證資料，且 MUST 明示實際最新資料日期
