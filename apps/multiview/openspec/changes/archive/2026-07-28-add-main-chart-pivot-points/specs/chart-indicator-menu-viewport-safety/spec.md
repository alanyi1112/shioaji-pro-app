## ADDED Requirements

### Requirement: Pivot Point 選項必須維持多圖功能表可操作

系統 MUST 將「Pivot Point」納入主圖指標的緊湊排列、viewport 邊界、內部捲動與鍵盤巡覽契約。新增選項不得讓既有主圖 checkbox、數值顯示或繪圖工具被裁切、遮蔽或無法操作。

#### Scenario: 8 圖顯示 Pivot Point 選項

- **WHEN** 使用者在 8 圖配置的上排或下排 panel 展開主圖功能表
- **THEN** 「Pivot Point」文字、checkbox 與完整可點擊 label MUST 可直接看到或經功能表內捲動抵達
- **AND** 功能表 MUST 依可用空間正確向上／向下展開及靠左／靠右對齊
- **AND** 最後一個主圖選項、數值顯示與四個繪圖工具 MUST 仍可操作

#### Scenario: 鍵盤切換 Pivot Point

- **WHEN** 使用者以鍵盤巡覽主圖指標並聚焦「Pivot Point」
- **THEN** 使用者 MUST 可切換 checkbox
- **AND** 功能表 MUST 保持現有焦點順序、收合與 cleanup 行為
