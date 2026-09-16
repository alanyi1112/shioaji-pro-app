# classified-chip-downloads Specification

## Purpose
TBD - created by archiving change optimize-after-market-chip-downloads. Update Purpose after archive.
## Requirements
### Requirement: 分類下載與獨立重試
系統 MUST 依市場、資料類別、日期管理下載窗口與耐久重試，單一來源失敗不得阻止其他來源入庫。

#### Scenario: 融資券未公布但法人已可用
- **WHEN** 一個融資券接口回傳空報表
- **THEN** 系統保存該項重試時間並繼續其他報表，已驗證資料不重抓

#### Scenario: 當日下載窗口前
- **WHEN** 台北時間未達法人 16:00 或融資券 21:00
- **THEN** 系統不請求該當日报表並回報下次允許時間

#### Scenario: 報表缺口未齊
- **WHEN** 任一必要報表未驗證
- **THEN** 系統保留原有完整 v5 發布結果，不發布不完整新版

### Requirement: 完成後休眠
系統 MUST 在 v5 已發布、名冊相符且週資料無待辦時，以已驗證交易日曆決定下一交易日 14:00 喚醒；期間僅做唯讀快速判斷，不執行選股採集與發布。日曆無效或資料缺口 MUST 回到既有維護流程。

#### Scenario: 完成後遇週末
- **WHEN** 星期五資料完整且驗證日曆下一交易日為星期一
- **THEN** 選股採集休眠至星期一 14:00，TDCC queue watcher 維持獨立運作

#### Scenario: 剩餘報表尚未到期
- **WHEN** 所有缺口尚未到下載窗口或重試時間
- **THEN** 系統回報等待，不建立採集 run 或重新計算 v5 發布
