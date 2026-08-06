## MODIFIED Requirements

### Requirement: 失焦範圍保留關鍵價位資訊

系統 SHALL 在固定範圍 VP 失去焦點後，繼續顯示該範圍的 VAH、POC、VAL 水平線與各自的價格標籤，並以較低透明度表示非目前選取狀態。每個價格標籤 SHALL 只顯示級別名稱與格式化價格，不得顯示「範圍 1／範圍 2」或其他範圍名稱前綴。

#### Scenario: 焦點移到另一個固定範圍 VP

- **WHEN** 使用者建立或選取另一個固定範圍 VP，使原範圍失去焦點
- **THEN** 原範圍的 VAH、POC、VAL 水平線仍然存在
- **AND** 原範圍的 VAH、POC、VAL 價格標籤仍然存在
- **AND** 每個價格標籤只顯示級別名稱與格式化價格
- **AND** 價格標籤不得包含原範圍名稱或自動產生的範圍序號
- **AND** 原範圍的水平線與價格標籤以失焦透明度顯示

### Requirement: 聚焦範圍控制線與水平線分級

系統 SHALL 將固定範圍 VP 的 VAH、POC、VAL 水平線全部顯示為 1 CSS px，並將聚焦範圍左右黃色拖曳控制線維持為 2 CSS px；控制線不得以外擴陰影或附加 border 增加其可見粗細。

#### Scenario: 檢視聚焦固定範圍 VP 的線條

- **WHEN** 固定範圍 VP 是目前選取範圍
- **THEN** VAH、POC、VAL 水平線各為 1 CSS px
- **AND** 左右黃色拖曳控制線各為 2 CSS px
- **AND** 控制線不使用外擴陰影或附加 border 增加粗細
- **AND** 使用者仍可拖曳控制線調整範圍

## RENAMED Requirements

- FROM: `### Requirement: 聚焦範圍縱向控制線與水平線等粗`
- TO: `### Requirement: 聚焦範圍控制線與水平線分級`
