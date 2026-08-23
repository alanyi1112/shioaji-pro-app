## MODIFIED Requirements

### Requirement: 日內跨日邊界必須使用較粗垂直分隔線
在 1m、5m、15m 或 60m 圖中，當依時間遞增的相鄰 canonical candles 之台灣顯示日期不同時，系統 MUST 在前一日最後一根與新日期第一根 candle 之間繪製 1.2 CSS px 的亮黃色垂直跨日分隔線。分隔線 MUST 使用獨立的 day-boundary semantic color、對齊所有現存主副圖 pane，且 MUST NOT 沿用一般 grid color、改變資料、autoscale、crosshair 或圖表點擊行為。

#### Scenario: 股票日內資料跨至下一交易日
- **WHEN** 可見資料由某日最後一根日內 candle 接續至下一日期第一根 candle
- **THEN** 系統 MUST 在兩根 candle 的 X 座標中點繪製 1.2 CSS px 亮黃色分隔線
- **AND** 分隔線 MUST 位於 pane background，不得穿過任一根 candle 的中心或遮住其 OHLCV

#### Scenario: 期貨夜盤跨越午夜
- **WHEN** FUT／OPT 日內 candles 的台灣顯示日期在連續夜盤資料中改變
- **THEN** 系統 MUST 在日期改變處顯示相同的 1.2 CSS px 亮黃色垂直分隔線
- **AND** 系統 MUST NOT 因畫線而改寫 candle 的交易日歸屬、timestamp 或價量

#### Scenario: 同日內有資料缺口
- **WHEN** 相鄰 candles 雖有時間缺口但台灣顯示日期相同
- **THEN** 系統 MUST NOT 將該缺口誤畫為跨日分隔線

#### Scenario: 主圖與副圖對齊
- **WHEN** 圖表具有一個以上技術副圖 pane
- **THEN** 每條可見跨日分隔線 MUST 在主圖與所有副圖使用相同 X 座標、亮黃色語意色及 1.2 CSS px 視覺線寬
- **AND** 新增、移除或重排副圖後 MUST 重新對齊，不得留下重複或殘留線條

#### Scenario: 平移縮放、歷史補載與主題切換
- **WHEN** 使用者平移、縮放或 resize，系統 prepend 歷史 candles，或 theme 改變
- **THEN** 系統 MUST 依目前 canonical candles 與 viewport 重新定位可見分隔線，並使用目前 theme 經對比驗證的亮黃色 day-boundary semantic color
- **AND** 色彩 MUST NOT 退回一般 grid color，舊 generation 的座標或 primitive MUST NOT 寫回新商品、新時框或已銷毀 chart

#### Scenario: 日週月不套用分鐘分日線
- **WHEN** 目前時框為 1D、週或月
- **THEN** 系統 MUST NOT 因每根 candle 的日期不同而在相鄰 K 棒之間增加本 capability 的分隔線
- **AND** 既有格線與時間軸行為 MUST 維持不變

## ADDED Requirements

### Requirement: 主交易畫面台股整股成交量必須以張為 canonical 呈現單位
主交易畫面對 Shioaji 整股 STK Kbars、Tick `volume` 與 `total_volume` MUST 以 `common_lot`（張）解讀並呈現，不得乘除 1,000。歷史、forming candle、成交量柱、均量、readout 與 Volume Profile MUST 使用同一 canonical volume；來源單位不可信或不適用時 MUST 標示不可用，不得猜測。

#### Scenario: 由 Shioaji 1 分 K 聚合日 K
- **WHEN** 同一台北日期的合法整股 STK Kbars 成交量依序為 1、2、3 張
- **THEN** 主交易畫面日 K、成交量柱與 readout MUST 顯示 6 張的 canonical volume
- **AND** 系統 MUST NOT 顯示 6,000、將張誤稱為股或讓衍生指標使用不同數值

#### Scenario: Bootstrap 後接續即時成交量
- **WHEN** 最新 Kbars bootstrap 已包含當日累計 100 張，下一筆合法 Tick 的 `total_volume` 為 103 張
- **THEN** forming candle MUST 只增加 3 張
- **AND** 相同 Tick 重送、sequence 未前進或舊 generation 晚到時 MUST NOT 再增加成交量

#### Scenario: 累計量倒退或跨 session
- **WHEN** 相同 session 的 `total_volume` 倒退，或舊台北日期 Tick 在新 session cursor 建立後抵達
- **THEN** 系統 MUST 拒絕該次 volume 增量並保留目前 canonical candle set
- **AND** 系統 MUST NOT 以 tick volume、零值或其他來源成交量猜補
