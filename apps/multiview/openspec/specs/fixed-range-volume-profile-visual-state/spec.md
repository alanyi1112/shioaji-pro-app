# fixed-range-volume-profile-visual-state Specification

## Purpose
TBD - created by archiving change refine-fixed-range-volume-profile-focus-visuals. Update Purpose after archive.
## Requirements
### Requirement: 失焦範圍保留關鍵價位資訊

系統 SHALL 在固定範圍 VP 失去焦點後，繼續顯示該範圍的 VAH、POC、VAL 水平線與各自的價格標籤，並以較低透明度表示非目前選取狀態。每個價格標籤 SHALL 只顯示級別名稱與格式化價格，不得顯示「範圍 1／範圍 2」或其他範圍名稱前綴。

#### Scenario: 焦點移到另一個固定範圍 VP

- **WHEN** 使用者建立或選取另一個固定範圍 VP，使原範圍失去焦點
- **THEN** 原範圍的 VAH、POC、VAL 水平線仍然存在
- **AND** 原範圍的 VAH、POC、VAL 價格標籤仍然存在
- **AND** 每個價格標籤只顯示級別名稱與格式化價格
- **AND** 價格標籤不得包含原範圍名稱或自動產生的範圍序號
- **AND** 原範圍的水平線與價格標籤以失焦透明度顯示

### Requirement: 失焦範圍不保留縱向邊界

系統 SHALL 在固定範圍 VP 失去焦點後隱藏該範圍的左右縱向邊界與拖曳控制線，但 SHALL 保留可重新選取該範圍的互動命中區。

#### Scenario: 檢視失焦範圍邊界

- **WHEN** 固定範圍 VP 已失去焦點
- **THEN** 該範圍左右兩側不顯示縱向邊界
- **AND** 該範圍不顯示左右拖曳控制線
- **AND** 使用者仍可透過範圍命中區、柱狀圖、水平線或價格標籤重新選取該範圍

### Requirement: 固定範圍 VP 不遮蔽主圖

系統 SHALL 以分層透明度顯示固定範圍 VP 的柱狀圖、水平線、價格標籤與聚焦底色，使下方 K 棒與各價位層級可同時辨識。

#### Scenario: 檢視聚焦與失焦的固定範圍 VP

- **WHEN** 主圖同時存在聚焦與失焦的固定範圍 VP
- **THEN** 一般柱段、Value Area 柱段與 POC 柱段分別以遞增但低於完全不透明的 alpha 顯示
- **AND** 水平線與價格標籤低於完全不透明
- **AND** 失焦範圍的柱狀圖、水平線與價格標籤比聚焦範圍更淡
- **AND** 失焦範圍底色完全透明，聚焦範圍底色僅使用淡黃色透明提示

### Requirement: 聚焦範圍控制線與水平線分級

系統 SHALL 將固定範圍 VP 的 VAH、POC、VAL 水平線全部顯示為 1 CSS px，並將聚焦範圍左右黃色拖曳控制線維持為 2 CSS px；控制線不得以外擴陰影或附加 border 增加其可見粗細。

#### Scenario: 檢視聚焦固定範圍 VP 的線條

- **WHEN** 固定範圍 VP 是目前選取範圍
- **THEN** VAH、POC、VAL 水平線各為 1 CSS px
- **AND** 左右黃色拖曳控制線各為 2 CSS px
- **AND** 控制線不使用外擴陰影或附加 border 增加粗細
- **AND** 使用者仍可拖曳控制線調整範圍
