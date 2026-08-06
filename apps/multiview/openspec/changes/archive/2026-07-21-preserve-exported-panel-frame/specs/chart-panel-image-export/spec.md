## ADDED Requirements

### Requirement: 匯出 PNG 必須具有完整商品 panel 外框

系統 MUST 在匯出的單一商品 PNG 最上層繪製完整 panel 外框。外框 MUST 同時包含上、右、下、左四邊框線及左上、右上、右下、左下四個圓角，並沿用匯出當下 panel 的框線顏色、寬度、樣式與圓角；任何 K 線 Canvas、右側數值軸、技術副圖、籌碼副圖或允許溢出的後代內容 MUST NOT 覆蓋外框。

#### Scenario: 多層長圖保留四邊與四角

- **WHEN** 使用者匯出高度超過 viewport 且包含多層副圖的商品 panel
- **THEN** PNG 的上、右、下、左邊界 MUST 都顯示連續且一致的 panel 框線
- **AND** 左上、右上、右下、左下 MUST 顯示相同半徑的完整圓角
- **AND** 右側數值軸與最底層副圖 MUST 保持在外框內，不得覆蓋右框或下框

#### Scenario: 匯出專用外框不改變畫面或內容尺寸

- **WHEN** 系統為圖片擷取建立匯出 clone
- **THEN** 完整外框 MUST 只存在於離屏 clone 並位於所有圖表內容之上
- **AND** MUST NOT 改變 live panel 的 DOM、圖表 layout、完整擷取寬高或任何互動狀態
- **AND** 匯出結束後 MUST 隨 clone 一併清除
