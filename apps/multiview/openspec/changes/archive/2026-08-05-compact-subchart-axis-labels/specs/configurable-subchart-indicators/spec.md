## ADDED Requirements

### Requirement: 技術指標數值軸必須省略無意義的小數零

系統 MUST 在 RSI、KD、MACD 與 ATR 技術副圖的右側數值軸移除尾端無意義的零，並依既有指標量級保留必要的小數精度；此格式 MUST NOT 改變指標計算值或技術副圖 header readout。

#### Scenario: 整數技術刻度不顯示小數零
- **WHEN** 技術指標數值軸的刻度值為 `50.00` 或 `100.00`
- **THEN** 刻度 MUST 分別顯示為 `50` 與 `100`
- **AND** 刻度 MUST NOT 顯示 `.00`

#### Scenario: 技術刻度保留必要小數
- **WHEN** 技術指標數值軸的刻度值為 `50.25` 或 `0.50`
- **THEN** 刻度 MUST 分別顯示為 `50.25` 與 `0.5`
- **AND** 系統 MUST NOT 將非零小數四捨五入為整數

#### Scenario: 軸格式不改變技術讀值與計算
- **WHEN** 技術副圖顯示數值軸與 header readout
- **THEN** 只有數值軸 MUST 套用精簡 formatter
- **AND** RSI、KD、MACD、ATR 的計算資料及 header readout MUST 維持既有行為
