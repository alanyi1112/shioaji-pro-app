## ADDED Requirements

### Requirement: 副圖滑鼠位置必須以主 K 線解析共用交易日

系統 MUST 將主圖、技術副圖與籌碼副圖內的滑鼠絕對螢幕 X 座標映射到主 K 線 plot，並以主圖對應的 candle time 作為共用垂直線、日期標籤、技術讀值及所有籌碼 readout 的唯一交易日。系統 MUST NOT 直接採用可能已漂移副圖的 logical index 或 `crosshairMove.param.time` 覆蓋主圖交易日。

#### Scenario: 在任一籌碼副圖移動滑鼠

- **WHEN** 使用者把滑鼠移到任一可見籌碼 pane 的 plot 左側、中央或右側
- **THEN** 系統 MUST 以該螢幕 X 在主圖解析出同一根 K 棒
- **AND** 共用垂直線、主圖日期、技術指標 readout 與所有籌碼 readout MUST 使用該 K 棒交易日
- **AND** 垂直線與該交易日於每個可見 pane 的資料點 X 座標差 MUST 小於或等於 1 CSS px

#### Scenario: 滑鼠位於副圖價格軸或 plot 外

- **WHEN** 副圖 pointer 的絕對螢幕 X 不在主圖可繪製 plot 範圍內
- **THEN** 系統 MUST 清除或維持未作用的共用游標狀態
- **AND** MUST NOT 以價格軸位置推算另一個交易日或顯示錯誤資料

### Requirement: 技術指標時間域與可見 series 必須跟隨目前 candles

系統 MUST 在圖表套用前將 RSI、KD、MACD、ATR、成交量及主圖衍生線的可視資料限制於目前 canonical candles 的 time domain。當使用者已選取技術指標且 payload 對目前 candles 含合法資料時，商品切換、快取前景更新、快速換頁、resize、捲動或多層副圖重建後 MUST 建立並顯示對應 series；不得因游離時間點、舊 generation 或先移除後失敗而留下空白技術副圖。

#### Scenario: 指標 payload 含顯示 candles 以外的時間

- **WHEN** 技術指標 line 或 histogram 含早於、晚於或不存在於目前 candles 的時間點
- **THEN** 系統 MUST 在呼叫 Lightweight Charts 前移除該游離時間點
- **AND** MUST 保留目前 candle time domain 內的合法指標資料
- **AND** 主圖、技術副圖與籌碼 time anchor 的相同 logical index MUST 代表相同交易日

#### Scenario: 多商品重建已選取技術指標

- **WHEN** 1／2／3／4 圖的商品在快取更新、快速換頁或 layout resize 後重建，且 KD、RSI、MACD 或 ATR 已選取並有合法資料
- **THEN** 每個 panel MUST 顯示所有已選取且有合法資料的技術 series
- **AND** debug／驗收資料 MUST 能區分 series 沒有合法資料與 series 未建立
- **AND** browser Console 與 panel 狀態 MUST NOT 出現圖表重建錯誤

#### Scenario: 技術指標與主圖同步縮放平移

- **WHEN** 使用者在主圖或任一作用中的副圖縮放、平移、捲頁後返回可見區域
- **THEN** 系統 MUST 優先以主圖真實 visible time range 同步所有已建立 time anchor 的副圖
- **AND** logical range fallback MUST NOT 改變同一交易日的 X 座標對齊
- **AND** layout 穩定後左中右測試交易日的跨 pane 最大偏差 MUST 小於或等於 1 CSS px
