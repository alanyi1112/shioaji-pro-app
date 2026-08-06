## ADDED Requirements

### Requirement: 主圖必須提供預設關閉的 Pivot Point

系統 MUST 在每個 chart panel 的「主圖」功能表提供「Pivot Point」checkbox，且新建立 panel 預設 MUST 未勾選。Pivot Point 的選取 MUST 與均線、布林、成交量、Fair Value Gaps、Volume Profile、本益比河流圖、估算融資成本及副圖選取互相獨立。

#### Scenario: 新 panel 預設不顯示 Pivot

- **WHEN** 使用者首次開啟網站、建立新 panel 或開啟沒有 Pivot 選取狀態的單圖
- **THEN** 「Pivot Point」checkbox MUST 未勾選
- **AND** 主圖 MUST 不建立 Pivot series 或 readout
- **AND** 系統 MUST 不因 Pivot 額外要求高週期參考行情

#### Scenario: 單獨啟用 Pivot

- **WHEN** 使用者勾選「Pivot Point」
- **THEN** 系統 MUST 保留其他主圖與副圖指標的目前選取狀態
- **AND** 該 panel MUST 載入並顯示符合目前商品及週期的 Pivot 水準

### Requirement: Pivot 必須採固定 Traditional 七線公式

系統 MUST 使用前一個有效參考週期的最高價 `H`、最低價 `L` 與收盤價 `C` 計算 `P = (H + L + C) / 3`、`R1 = 2P - L`、`S1 = 2P - H`、`R2 = P + (H - L)`、`S2 = P - (H - L)`、`R3 = R1 + (H - L)`、`S3 = S1 - (H - L)`。第一版 MUST NOT 以其他 Pivot 類型、參數或目前未完成週期改寫這些結果。

#### Scenario: 使用合法前期 OHLC 計算七線

- **WHEN** 前一個參考週期具有有限數值且 `H >= L`
- **THEN** Worker MUST 依 Traditional 公式產生 P、R1、R2、R3、S1、S2、S3
- **AND** 七個值 MUST 由同一筆前期 H／L／C 計算

#### Scenario: 缺少合法參考資料

- **WHEN** 前一個參考週期不存在、OHLC 缺值、含非有限值或 `H < L`
- **THEN** 對應有效週期的 Pivot MUST 為缺值或 unavailable
- **AND** 系統 MUST NOT 補零、沿用更早期水準冒充前期資料或阻斷既有 K 線

### Requirement: Pivot 參考週期必須符合確認的圖表週期映射

系統 MUST 讓 `1m`、`3m`、`5m`、`15m`、`30m`、`1h`、`4h` 使用前一個完整交易日，`1d` 使用前一交易日，`1wk` 使用前一完整交易週，`1mo` 使用前一完整交易月。前期 MUST 依相同商品、provider 與來源交易所時區的實際資料決定，不得以固定秒數或日曆日期製造週末、休市或缺交易日資料。

#### Scenario: 日內圖使用前一交易日

- **WHEN** 使用者在 `1m` 至 `4h` 圖表啟用 Pivot
- **THEN** 每個交易日的七個水準 MUST 由前一個實際完成交易日的 daily-based H／L／C 計算
- **AND** 系統 MUST NOT 使用前一根日內 K 棒或日內 extended-hours 聚合值替代前一交易日

#### Scenario: 日週月圖使用前一同類週期

- **WHEN** 使用者分別在 `1d`、`1wk` 或 `1mo` 圖表啟用 Pivot
- **THEN** 系統 MUST 分別使用前一交易日、前一完整交易週或前一完整交易月計算
- **AND** 同一有效日、週或月內的 Pivot 水準 MUST 保持不變

#### Scenario: 遇到週末或休市

- **WHEN** 目前有效週期之前具有週末、休市日或資料缺口
- **THEN** 系統 MUST 選取同商品資料中的前一個實際完成參考週期
- **AND** 系統 MUST NOT 生成不存在的日曆 K 棒

### Requirement: Pivot 序列必須與 K 線時間及歷史載入一致

系統 MUST 回傳與目前圖表 candle time 對齊的 P、R1～R3、S1～S3 序列；同一有效 period 內 MUST 重複相同水準，只能在進入下一個 period 時切換。history prepend、display window 裁切、candle merge 與 stream 更新 MUST 保持相同參考期，不得產生 look-ahead 或把可視區第一根 K 棒當成前期。

#### Scenario: 歷史水準在週期邊界切換

- **WHEN** payload 涵蓋兩個以上有效 Pivot period
- **THEN** 每組七線 MUST 在各 period 內保持水平
- **AND** 水準 MUST 只在新 period 第一根 candle 開始時切換為由上一期計算的新值

#### Scenario: 向左載入更多歷史

- **WHEN** 使用者向左平移並 prepend 更早 candles
- **THEN** 新增範圍的 Pivot MUST 使用其真正前一期資料重新計算
- **AND** 原有可見時間的 Pivot 與 candle time MUST 不漂移、不重複且不產生斜接 look-ahead

### Requirement: Pivot 必須以可辨識水平線、標籤與 readout 呈現

系統 MUST 在主價格尺度繪製 P、R1～R3、S1～S3 七條細水平階梯線。P、R、S MUST 具有文字級別與格式化價格；R 與 S 可使用不同色系，但使用者不得只能依顏色辨識。主圖 readout MUST 僅在 Pivot 已啟用時，依游標所指 candle 或最新 candle 顯示同一 payload 的七個值。

#### Scenario: 顯示目前有效七線

- **WHEN** Pivot 已啟用且目前 period 具有合法計算結果
- **THEN** 主圖 MUST 同時顯示 P、R1、R2、R3、S1、S2、S3
- **AND** 各線 MUST 顯示可辨識名稱及依商品 tick-size 格式化的價格
- **AND** period 交界 MUST 使用 step transition 或等效水平分段，不得以跨期斜線連接兩組水準

#### Scenario: 十字線讀取歷史 Pivot

- **WHEN** 使用者將十字線移至具有 Pivot 的歷史 candle
- **THEN** readout MUST 顯示該 candle 所屬 period 的 P／R／S 值
- **AND** 游標離開後，固定 readout MUST 回復最新 candle 的有效 Pivot

### Requirement: Pivot 生命週期與匯出必須維持 panel 隔離

系統 MUST 讓每個 panel 的 Pivot series、request、stream、readout 與 cleanup 依該 panel 的商品、週期及選取狀態隔離。取消勾選、切換商品／週期、panel destroy 或較新請求勝出時，舊 Pivot MUST 不再顯示或覆蓋新狀態；完整 panel PNG MUST 包含當下可見的 Pivot 線、標籤與 readout。

#### Scenario: 取消 Pivot 後完整清理

- **WHEN** 使用者取消勾選「Pivot Point」
- **THEN** 該 panel MUST 移除七條 Pivot series、標籤及 Pivot readout
- **AND** 其他主圖指標、副圖、visible range 與註記 MUST 保持不變

#### Scenario: 快速切換商品或週期

- **WHEN** Pivot 載入期間使用者切換商品或週期
- **THEN** 較舊 request／stream 結果 MUST 被中止或忽略
- **AND** 新 panel MUST 只顯示目前商品與週期的 Pivot

#### Scenario: 匯出含 Pivot 的完整 panel

- **WHEN** 使用者在 Pivot 已啟用時匯出完整 panel PNG
- **THEN** 匯出 MUST 保留七線、P／R／S 標籤、格式化價格與 Pivot readout
- **AND** 匯出 MUST 不包含已收合功能表或其他 panel
