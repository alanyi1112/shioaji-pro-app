# main-chart-readout-display Specification

## Purpose

定義主 K 線數值在固定左上角與跟隨游標浮動視窗間的切換、跨 panel 偏好同步、最新值回復及生命週期，並確保副圖 readout 不受影響。

## Requirements

### Requirement: 主 K 線數值必須提供左上角與浮動顯示模式

系統 MUST 在每個 chart panel 的「主圖」選單提供「數值顯示」，至少包含「圖區左上角」與「浮動視窗」。預設 MUST 為「圖區左上角」。兩種模式 MUST 使用同一組主 K 線 readout 資料，涵蓋 OHLC、漲跌、漲跌幅與已啟用的主圖指標，不得建立彼此不同步的重複讀值。

#### Scenario: 首次使用預設左上角
- **WHEN** 瀏覽器尚未保存數值顯示偏好並載入 chart panel
- **THEN** 「數值顯示」MUST 選取「圖區左上角」
- **AND** 主 K 線 readout MUST 固定於扣除右側價格軸後的 plot 左上角
- **AND** readout MUST 維持 `pointer-events: none`

#### Scenario: 切換浮動視窗
- **WHEN** 使用者選擇「浮動視窗」並在有效 K 線日期移動游標
- **THEN** main readout MUST 跟隨游標並依可用空間顯示於游標左側或右側
- **AND** 游標離開主圖及同 panel 的圖表區後 MUST 隱藏

### Requirement: 左上角模式必須持續提供目前相關數值

左上角模式 MUST 在沒有有效游標日期時顯示最新一根 K 線及最新可用主圖指標數值；游標指向有效日期時 MUST 在固定位置更新為該日數值。游標離開後 MUST 回復最新資料，不得留下先前日期或空白浮動視窗。

#### Scenario: 游標進入與離開
- **WHEN** 左上角模式的游標由最新資料移到歷史 K 線後離開圖區
- **THEN** readout MUST 先在左上角顯示歷史日期與對應數值
- **AND** 離開後 MUST 在相同位置回復最新一筆可用資料

#### Scenario: 商品、週期或指標更新
- **WHEN** 使用者切換商品、週期或主圖指標
- **THEN** 左上角 readout MUST 依新 payload 與目前指標選取重新顯示
- **AND** MUST NOT 殘留前一商品、週期或已停用指標數值

### Requirement: 數值顯示偏好必須在本機同步且不影響副圖

系統 MUST 將合法模式保存於瀏覽器本機，並同步目前所有 chart panel；重新載入或重建多圖 panel 時 MUST 套用相同模式。未知或損毀值 MUST 回退為「圖區左上角」。副圖技術指標與籌碼 pane 的 inline readout MUST 維持既有位置與最新值／游標值生命週期。

#### Scenario: 多圖同步與重新載入
- **WHEN** 使用者在任一 panel 選擇另一種數值顯示模式
- **THEN** 目前所有 panel 的選擇器與 main readout MUST 立即套用相同模式
- **AND** 重新載入後 MUST 還原該合法偏好

#### Scenario: 不影響副圖
- **WHEN** 使用者切換主 K 線數值顯示模式
- **THEN** technical subchart 與 chip pane 的 inline readout MUST 維持既有 DOM、位置與顯示規則
- **AND** 系統 MUST NOT 將副圖 readout 改成浮動視窗
