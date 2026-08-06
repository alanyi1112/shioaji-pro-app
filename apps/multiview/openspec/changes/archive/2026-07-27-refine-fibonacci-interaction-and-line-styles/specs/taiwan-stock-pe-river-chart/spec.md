## MODIFIED Requirements

### Requirement: 主圖必須繪製可讀且不攔截互動的河流帶

系統 MUST 在主 K 線後方繪製七條 percentile 邊界及 `P5–P20`、`P20–P35`、`P35–P50`、`P50–P65`、`P65–P80`、`P80–P95` 六個低透明度 SVG band。P5 以下與 P95 以上 MUST NOT 填滿整個 plot；overlay MUST `pointer-events: none`，不得遮蔽 K 線、價格軸、crosshair 或 chart 手勢。P50 邊界 MUST 使用 1.4 CSS px，其他六條邊界 MUST 使用 1 CSS px 彩色實線；provisional 尾端 MUST 維持相同線寬但使用虛線、較低透明度與既有狀態文字。各區間 MUST 由低估端冷色、中央中性色至高估端暖色呈現，且不得暗示預測或投資建議。

#### Scenario: 完整 verified 資料首次繪製
- **WHEN** 合資格日 K panel 收到完整且樣本足夠的 verified 河流 response
- **THEN** 七條線與六個 band MUST 依共同 time／price 座標出現在主 K 線後方
- **AND** P50 MUST 為 1.4 CSS px，其他線 MUST 為 1 CSS px 彩色實線

#### Scenario: provisional 尾端保持可辨識
- **WHEN** 河流圖含 `finmind_provisional_latest` 尾端
- **THEN** provisional P50 MUST 維持 1.4 CSS px，其他 provisional 線 MUST 維持 1 CSS px，且全部 MUST 使用虛線與較低透明度
- **AND** UI MUST 保留等待交易所確認的狀態文字，不得將 provisional 尾端呈現為 verified 實線

#### Scenario: 主圖縮放平移與 resize
- **WHEN** 使用者縮放、平移、切換圖數、調整視窗或進出單圖分頁
- **THEN** overlay MUST 以同一 rAF scheduler 重新計算 visible points 的座標
- **AND** 每個有效日期的線與 K 線絕對 X 座標差 MUST 小於或等於 1 CSS px

#### Scenario: dense 多圖保持可讀
- **WHEN** 使用者在 4／6／8 圖版型啟用本益比河流圖
- **THEN** overlay MUST 保持在各自 panel 內並裁切到 plot bounds
- **AND** MUST NOT 增加 panel 高度、形成水平／垂直捲動區或蓋住 toolbar
