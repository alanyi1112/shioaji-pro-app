## ADDED Requirements

### Requirement: 指定日期的單次恢復

系統 MUST 僅接受今日且等於 expected session 的 invalid 狀態恢復；保留原冷卻、總探測預算與 operator lease，並在網路探測前保存唯一且不可覆蓋的失敗證據 receipt。

#### Scenario: 合法恢復
- **WHEN** 操作者指定符合條件日期且尚未消耗機會
- **THEN** 保存原 readiness 與 hash，僅允許當次受限探測

#### Scenario: 重複或不合法請求
- **WHEN** 日期不符、非 invalid、冷卻／預算不符或 receipt 已存在
- **THEN** 拒絕恢復，不重設 checkpoint、不重複探測

### Requirement: 資料驗證與發布保持嚴格

恢復 MUST 使用既有雙市場日期、schema 與 universe coverage 驗證，缺期或失敗仍保持 pending，並保留歷史失敗證據。

#### Scenario: 來源仍未就緒
- **WHEN** 恢復探測失敗或其他必要資料尚未齊全
- **THEN** 不發布假結果，receipt 不刪除、不自動再次恢復
