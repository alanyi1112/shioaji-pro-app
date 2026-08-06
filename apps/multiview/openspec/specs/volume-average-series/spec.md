# volume-average-series Specification

## Purpose
TBD - created by archiving change expand-taiwan-chip-detail-series. Update Purpose after archive.
## Requirements
### Requirement: 成交量 MA5 與 MA10

系統 MUST 對目前 K 線 interval 的成交量依時間遞增計算 5 期與 10 期簡單移動平均，並 MUST 將結果與原始成交量使用相同 candle time 回傳；合法的零成交量 MUST 納入期數與平均，缺漏或非有限值不得被偽裝成零。

#### Scenario: 具有完整十期成交量
- **WHEN** 某 panel 已載入至少十筆依時間排序且成交量有效的 candles
- **THEN** 第五筆起 MUST 具有 MA5，第十筆起 MUST 同時具有 MA5 與 MA10
- **AND** 每個平均值 MUST 使用包含當期在內的最近 5 或 10 筆實際 candle 成交量

#### Scenario: 期數不足
- **WHEN** 某 candle 之前含當期不足 5 或 10 筆有效期數
- **THEN** 對應 MA5 或 MA10 MUST 為 `null`
- **AND** 系統 MUST NOT 以較短期平均、0 或未來資料補足

#### Scenario: 成交量為零
- **WHEN** 來源明確回傳某 candle 成交量為 0
- **THEN** 該 0 MUST 視為有效觀測值納入 MA5／MA10
- **AND** MUST NOT 將來源明確的 0 當成缺值跳過

### Requirement: 成交量均線顯示與逐期讀值

系統 MUST 在成交量啟用時以柱狀 series 顯示原始成交量，並以可辨識的兩條折線顯示 MA5 與 MA10；三者 MUST 共用主圖時間軸與成交量尺度，且讀值 MUST 顯示目前 candle 的成交量、MA5、MA10 及各欄位相對前一筆實際資料的方向。

#### Scenario: 顯示成交量均線
- **WHEN** 使用者啟用成交量且目前可見範圍具有 MA5／MA10 資料
- **THEN** 系統 MUST 同時顯示成交量柱、MA5 折線與 MA10 折線
- **AND** 平移、縮放與 crosshair MUST 和主 K 線保持相同 time

#### Scenario: 讀取某一 candle
- **WHEN** crosshair 停在具有成交量、MA5 與 MA10 的 candle
- **THEN** 讀值 MUST 顯示三個數值及各自相對前一筆實際值的增加、減少或持平方向
- **AND** 方向 MUST NOT 以成交量和 MA5／MA10 彼此比較

#### Scenario: 均線尚未形成
- **WHEN** 使用者停在 MA5 或 MA10 仍為 `null` 的 candle
- **THEN** 對應讀值 MUST 顯示「無資料」且不得畫出該點
- **AND** 原始成交量柱 MUST 維持可見
