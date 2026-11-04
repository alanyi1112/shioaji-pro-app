## RENAMED Requirements

- FROM: `### Requirement: 左上角只保留共用 reference 狀態`
- TO: `### Requirement: 圖表必須隱藏 reference 與比較基準資訊列`

## MODIFIED Requirements

### Requirement: 圖表必須隱藏 reference 與比較基準資訊列
系統 MUST 將原共用 reference 狀態及壓撐／費波比較基準三行自圖表左上角隱藏，不重複呈現日期、完成狀態或比較分母資訊。此顯示取捨 MUST NOT 移除 reference 計算、固定歷史狀態、右側 formula／level／價位及百分比標籤；固定歷史的「回到最新」MUST 保留於壓撐選單。

#### Scenario: 三套公式同時啟用
- **WHEN** PivotPoint、三關價與 CDP 同時具有合法 projection
- **THEN** 左上角 MUST 不顯示 reference 狀態及兩種比較基準列，也不得列出十五個 level 值
- **AND** 右側線標籤 MUST 繼續顯示各公式、level 名稱、格式化價位與原本有效的百分比

#### Scenario: 固定歷史 reference
- **WHEN** 使用者在 1D 選取已完成歷史 reference
- **THEN** 系統 MUST 保持固定歷史計算與投影，圖表左上角不恢復已隱藏的資訊列
- **AND** 使用者 MUST 能從壓撐選單執行「回到最新」，不得因隱藏資訊列停用該操作
