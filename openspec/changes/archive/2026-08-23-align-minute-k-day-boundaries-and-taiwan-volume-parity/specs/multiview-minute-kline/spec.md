## ADDED Requirements

### Requirement: MultiView 分鐘 K 必須繪製亮黃色跨日分隔線
本機 MultiView 的 `1m`、`5m`、`15m`、`1h` Candlestick MUST 依相鄰 canonical candles 的 `Asia/Taipei` 日期變化，在前一日期最後一根與下一日期第一根 K 的 X 座標中點繪製 1.2 CSS px 亮黃色分日線。分日線 MUST 使用獨立 semantic color 並對齊主圖、成交量及所有可見技術 pane；既有 `intraday` 分時走勢與日／週／月 K MUST NOT 套用。

#### Scenario: 分鐘 K 跨越兩個日期
- **WHEN** MultiView 的分鐘 K 資料包含前一台北日期最後一根與下一台北日期第一根 candle
- **THEN** 系統 MUST 在兩根 K 的 X 座標中點顯示 1.2 CSS px 亮黃色分日線
- **AND** 線條 MUST 位於資料背景、不穿過任一根 candle 中心，也不得改變 OHLCV、autoscale、crosshair 或 pointer 工具

#### Scenario: 同日資料缺口與不適用時框
- **WHEN** 相鄰分鐘 K 有時間缺口但台北日期相同，或目前為 `intraday`、`1d`、`1wk`、`1mo`
- **THEN** 系統 MUST NOT 因該缺口或相鄰 candle 日期建立本 capability 的分日線
- **AND** 既有格線、分時線與日週月時間軸 MUST 維持不變

#### Scenario: 主圖、成交量與副圖同步
- **WHEN** panel 同時顯示 Candlestick、volume 與一個以上技術 pane
- **THEN** 每條分日線 MUST 在所有可見 pane 使用相同 X 座標、亮黃色語意色及 1.2 CSS px 視覺寬度
- **AND** pane 建立、移除、重排或 selection 不變的重算 MUST NOT 產生重複、偏移或殘留 primitive

#### Scenario: 歷史補載與 viewport 生命週期
- **WHEN** 系統 prepend 跨日 Kbars，使用者平移、縮放、resize、快速切換商品／時框，或 panel 被銷毀重建
- **THEN** primitive manager MUST 依目前 generation 的 canonical candles 與 time scale 重新計算可見位置
- **AND** 舊 generation、舊 panel 或已 detach primitive MUST NOT 寫回目前畫面

#### Scenario: 多圖與完整 panel 匯出
- **WHEN** 使用者在 1／2／4／8 panel 檢視跨日分鐘 K，或匯出含主圖與副圖的完整 panel PNG
- **THEN** 每個 panel MUST 只呈現自身商品與時框的分日線，匯出結果 MUST 包含可見亮黃色分日線
- **AND** console MUST 無未處理錯誤，其他 panel 的 boundary 或座標 MUST NOT 混入
