## ADDED Requirements

### Requirement: 籌碼副圖數值軸必須使用精簡刻度

系統 MUST 僅在籌碼副圖右側數值軸精簡張數與百分比刻度；張數絕對值達千位時 MUST 使用 `K張`，百分比 MUST 移除尾端無意義的零，同時保留必要的小數、正負號與單位。圖例、游標讀值、詳細資料及原始數值 MUST 維持既有完整格式與精度。

#### Scenario: 千位張數使用 K 縮寫
- **WHEN** 籌碼副圖右側數值軸需要顯示 `50,000` 張或 `1,500` 張
- **THEN** 刻度 MUST 分別顯示為 `50K張` 與 `1.5K張`
- **AND** 刻度 MUST NOT 顯示為 `50,000張` 或補上無意義的小數

#### Scenario: 小於千位張數維持張單位
- **WHEN** 籌碼副圖右側數值軸需要顯示 `500` 張
- **THEN** 刻度 MUST 顯示為 `500張`
- **AND** 系統 MUST NOT 將其誤寫為 `0.5K張`

#### Scenario: 百分比移除尾端零
- **WHEN** 籌碼副圖右側數值軸需要顯示 `2.00%`、`2.50%` 或 `-0.25%`
- **THEN** 刻度 MUST 分別顯示為 `2%`、`2.5%` 與 `-0.25%`
- **AND** 必要的非零小數與負號 MUST 保留

#### Scenario: 精簡格式不影響讀值
- **WHEN** 同一籌碼 series 同時顯示右側數值軸與 header 或游標 readout
- **THEN** 只有數值軸 MUST 使用精簡刻度 formatter
- **AND** header、游標 readout 與詳細資料 MUST 維持既有完整格式
