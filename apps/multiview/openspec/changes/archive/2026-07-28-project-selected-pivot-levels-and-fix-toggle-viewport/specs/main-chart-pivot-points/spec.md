## MODIFIED Requirements

### Requirement: 主圖必須提供預設關閉的 Pivot Point

系統 MUST 在每個 chart panel 的「主圖」功能表提供「Pivot Point」checkbox，且新建立 panel 預設 MUST 未勾選。Pivot Point 的選取 MUST 與均線、布林、成交量、Fair Value Gaps、Volume Profile、本益比河流圖、估算融資成本及副圖選取互相獨立。

#### Scenario: 新 panel 預設不顯示 Pivot

- **WHEN** 使用者首次開啟網站、建立新 panel 或開啟沒有 Pivot 選取狀態的單圖
- **THEN** 「Pivot Point」checkbox MUST 未勾選
- **AND** 主圖 MUST 不建立 Pivot overlay、autoscale helper 或 readout
- **AND** 系統 MUST 不因 Pivot 額外要求高週期參考行情

#### Scenario: 單獨啟用 Pivot

- **WHEN** 使用者勾選「Pivot Point」
- **THEN** 系統 MUST 保留其他主圖與副圖指標的目前選取狀態
- **AND** 該 panel MUST 預設選取最後一個已完成參考期，並顯示適用下一交易日／週／月的 Pivot 投影
- **AND** 沒有已完成參考期但具有合法未完成參考期時，系統 MUST 將投影明確標示為暫估

### Requirement: Pivot 必須採固定 Traditional 七線公式

系統 MUST 使用所選參考期的最高價 `H`、最低價 `L` 與收盤價 `C` 計算下一個實際交易期的 `P = (H + L + C) / 3`、`R1 = 2P - L`、`S1 = 2P - H`、`R2 = P + (H - L)`、`S2 = P - (H - L)`、`R3 = R1 + (H - L)`、`S3 = S1 - (H - L)`。系統 MUST NOT 以其他 Pivot 類型、參數或更早期水準改寫這些結果。

#### Scenario: 使用合法參考期 OHLC 計算下一期七線

- **WHEN** 所選參考期具有有限數值且 `H >= L`
- **THEN** Worker MUST 依 Traditional 公式產生 P、R1、R2、R3、S1、S2、S3
- **AND** 七個值 MUST 由同一筆所選參考期 H／L／C 計算
- **AND** 投影 MUST 標示為適用下一個實際交易日／週／月，不得冒充所選參考期的當期水準

#### Scenario: 缺少合法參考資料

- **WHEN** 所選參考期不存在、OHLC 缺值、含非有限值或 `H < L`
- **THEN** 對應 Pivot projection MUST 為 unavailable
- **AND** 系統 MUST NOT 補零、沿用其他參考期水準或阻斷既有 K 線

### Requirement: Pivot 參考週期必須符合確認的圖表週期映射

系統 MUST 讓 `1m`、`3m`、`5m`、`15m`、`30m`、`1h`、`4h` 與 `1d` 以交易日為參考期，`1wk` 以完整交易週為參考期，`1mo` 以完整交易月為參考期。參考期 MUST 依相同商品、provider 與來源交易所時區的實際資料決定，不得以固定秒數或日曆日期製造週末、休市或缺交易日資料。

#### Scenario: 日內圖點選 K 棒時使用所屬交易日

- **WHEN** 使用者在 `1m` 至 `4h` 圖表啟用 Pivot 並點選任一日內 K 棒
- **THEN** 系統 MUST 將該 K 棒對應至來源交易所時區的交易日
- **AND** 七個水準 MUST 使用同 provider 的 daily-based H／L／C 計算
- **AND** 系統 MUST NOT 使用單根日內 K 棒或 extended-hours 聚合值替代交易日 OHLC

#### Scenario: 日週月圖投影下一同類週期

- **WHEN** 使用者分別在 `1d`、`1wk` 或 `1mo` 圖表選取一根 K 棒
- **THEN** 系統 MUST 分別使用該交易日、交易週或交易月的 H／L／C 計算
- **AND** readout MUST 分別標示適用下一交易日、下一交易週或下一交易月

#### Scenario: 遇到週末、休市或未知下一日期

- **WHEN** 下一個實際交易期尚未出現在資料中或中間具有週末、休市日或資料缺口
- **THEN** 系統 MUST 使用「下一交易日／週／月」相對語意標示適用期
- **AND** 系統 MUST NOT 生成不存在的日曆 K 棒、假日期或假 time point

#### Scenario: 未完成參考期只能顯示暫估

- **WHEN** 使用者明確點選目前尚未完成但已有合法累計 OHLC 的日、週或月
- **THEN** 系統 MUST 顯示由該累計 OHLC 計算的 projection
- **AND** overlay 與 readout MUST 同時標示「暫估」
- **AND** 系統 MUST NOT 將該 projection 保存或標示為 completed

### Requirement: Pivot 序列必須與 K 線時間及歷史載入一致

系統 MUST 回傳可由參考 K 棒 time 或參考 period key 唯一取得的 P、R1～R3、S1～S3 下一期 projection；history prepend、display window 裁切、candle merge 與 stream 更新 MUST 保持相同參考期、完成狀態及公式結果，不得產生 look-ahead 或以畫面內第一根 candle 冒充完整參考期。

#### Scenario: 點選歷史 K 棒取得下一期投影

- **WHEN** 使用者點選具有合法 completed projection 的歷史 K 棒
- **THEN** 系統 MUST 顯示由該 K 棒所屬參考期計算的下一期七個水準
- **AND** 歷史資料已包含下一個實際 period 時 MUST 可顯示其實際 period key
- **AND** 系統 MUST NOT 改用目前最新 K 棒或該歷史 K 棒的前一期水準

#### Scenario: 向左載入更多歷史

- **WHEN** 使用者向左平移並 prepend 更早 candles
- **THEN** 新增範圍的 projection MUST 使用各自真正參考期資料計算
- **AND** 原有 reference key、completion status、projection 值與 candle time MUST 不漂移、不重複且不產生 look-ahead

#### Scenario: Stream 更新暫估與完成狀態

- **WHEN** 最新未完成參考期收到合法 OHLC 更新或市場進入下一個實際交易期
- **THEN** 系統 MUST 只更新受影響的 provisional projection，或將已完成參考期轉為 completed
- **AND** 使用者已固定的歷史 completed projection MUST 不受最新報價改變

### Requirement: Pivot 必須以可辨識水平線、標籤與 readout 呈現

系統 MUST 只呈現目前預設或使用者固定參考期的 P、R1～R3、S1～S3 七條右向水平投影，不得以完整歷史 step lines 覆蓋所有 K 棒。每條投影 MUST 從參考 K 棒位置延伸至右側價格軸安全邊距前，並以文字級別、線型、明暗及格式化價格辨識；使用者不得只能依顏色判斷。主圖 readout MUST 顯示參考期、適用期、完成／暫估狀態及同一 projection 的七個值。

#### Scenario: 預設顯示最後完成參考期的下一期七線

- **WHEN** Pivot 已啟用且最後完成參考期具有合法 projection
- **THEN** 主圖 MUST 同時顯示 P、R1、R2、R3、S1、S2、S3
- **AND** 七線 MUST 由該參考 K 棒向右延伸至價格軸前，不得向左覆蓋完整歷史
- **AND** 各線 MUST 顯示可辨識名稱及依商品 tick-size 格式化的價格

#### Scenario: 點選 K 棒固定 Pivot 參考期

- **WHEN** Pivot 已啟用、沒有高優先權繪圖操作進行中，且使用者在主圖單擊合法 K 棒
- **THEN** 系統 MUST 固定該 K 棒所屬參考期的 projection
- **AND** 後續 hover／十字線移動 MUST NOT 改變固定 Pivot
- **AND** 使用者 MUST 可透過可鍵盤操作的「回到最新」控制恢復最後完成參考期

#### Scenario: 繪圖工具優先於 Pivot 點選

- **WHEN** 費波那契、價格範圍或固定範圍 VP 正在等待圖表點選
- **THEN** 該點擊 MUST 只交由目前繪圖工具處理
- **AND** Pivot 固定參考期 MUST 保持不變

#### Scenario: 投影不得污染時間軸

- **WHEN** 參考 K 棒是最後一根 candle
- **THEN** 七線 MUST 仍可延伸至價格軸安全邊距前
- **AND** 系統 MUST NOT 建立未來 timestamp、假 candle 或觸發不必要的 history load
- **AND** hover MUST NOT 反覆改變 autoscale

#### Scenario: 價格標籤過近時保持可讀

- **WHEN** 兩個以上 Pivot 水準的價格標籤在目前尺度下發生重疊
- **THEN** 系統 MUST 以固定排序、垂直避碰及必要的短導引線顯示完整名稱與價格
- **AND** 各水平線 MUST 仍位於真實價位

### Requirement: Pivot 生命週期與匯出必須維持 panel 隔離

系統 MUST 讓每個 panel 的 Pivot request、stream、projection map、固定參考期、overlay、readout、autoscale helper 與 cleanup 依該 panel 的商品、週期及選取狀態隔離。取消勾選、切換商品／週期、panel destroy 或較新請求勝出時，舊 Pivot MUST 不再顯示或覆蓋新狀態；完整 panel PNG MUST 包含當下可見的 Pivot 投影、標籤與 readout。

#### Scenario: 取消 Pivot 後完整清理但保留目前資料窗

- **WHEN** 使用者取消勾選「Pivot Point」
- **THEN** 該 panel MUST 移除 Pivot overlay、標籤、readout 與 autoscale helper
- **AND** 系統 MUST 保留目前 candles、其他主圖指標、副圖、註記、bar spacing 及同一批可視 K 棒
- **AND** 系統 MUST NOT 以較短 `pivot:off` cache payload 覆蓋目前較長的 candle window

#### Scenario: 較長歷史啟用與取消 Pivot

- **WHEN** panel 已載入超過預設 display count 的歷史，並啟用或取消 Pivot
- **THEN** Pivot request MUST 要求至少目前 candle 數，或只更新 Pivot 資源而不替換 candle payload
- **AND** 若 payload time set 不同，系統 MUST 依切換前可視 candle time 還原 viewport，不得直接套用失效 logical index
- **AND** 主圖、技術副圖與籌碼副圖 MUST 維持相同可視時間範圍

#### Scenario: 快速切換商品、週期或 Pivot 狀態

- **WHEN** Pivot 載入期間使用者切換商品、週期或再次切換 Pivot checkbox
- **THEN** 較舊 request／stream 結果 MUST 被中止或忽略
- **AND** 新 panel MUST 只顯示目前商品、週期與 mode 的 Pivot
- **AND** 取消後晚到的 Pivot event MUST NOT 重建 overlay 或改變 viewport

#### Scenario: 固定參考期不在新資料窗

- **WHEN** 商品／週期切換或 provider 邊界使目前固定 reference key 不存在於新 payload
- **THEN** 系統 MUST 回退至新 payload 的最後 completed projection
- **AND** readout MUST 同步更新，不得保留指向不存在 candle 的固定狀態

#### Scenario: 匯出含 Pivot 的完整 panel

- **WHEN** 使用者在 Pivot 已啟用時匯出完整 panel PNG
- **THEN** 匯出 MUST 保留右向七線、P／R／S 標籤、參考／適用期、完成／暫估狀態與格式化價格
- **AND** 匯出 MUST 不包含已收合功能表或其他 panel
