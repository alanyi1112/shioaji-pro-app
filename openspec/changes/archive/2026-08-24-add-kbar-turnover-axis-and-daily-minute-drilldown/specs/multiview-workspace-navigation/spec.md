## ADDED Requirements

### Requirement: MultiView 多圖雙擊必須開啟單圖，單圖日 K 必須進入指定日期 1 分 K
MultiView 的 panel `dblclick` MUST 依目前圖表數量 routing。2／3／4／6／8 圖在既有合法目標上 MUST 以目前 panel 的 canonical 商品與 interval 開啟單圖新分頁；圖表數量為 1 時，只有左鍵雙擊主圖內命中的有效已完成日 K candle，才 MUST 在原 panel 啟動 simulation exact-date drill-down。`select`、`input`、`button`、連結、選單與可編輯內容等既有忽略目標仍 MUST 不開頁也不切換。

#### Scenario: 多圖雙擊有效日 K 棒
- **WHEN** 使用者在 2／3／4／6／8 圖模式雙擊某 panel 的有效日 K 棒
- **THEN** 系統 MUST 以該 panel 的商品與 `1d` interval 開啟單圖新分頁
- **AND** MUST NOT 發出 target-date request 或改變原 panel interval

#### Scenario: 雙擊非日 K 或 panel 背景
- **WHEN** 使用者在多圖模式的既有允許目標雙擊非日 K panel，或雙擊 panel 背景
- **THEN** 系統 MUST 沿用目前商品與 interval 開啟單圖新分頁
- **AND** MUST NOT 發出 target-date request 或改變原 panel interval

#### Scenario: 雙擊控制項不開啟單圖
- **WHEN** 使用者雙擊 panel 內的商品、週期、按鈕、連結、選單或可編輯內容
- **THEN** 系統 MUST 保留控制項原本行為且 MUST NOT 呼叫 `window.open`

#### Scenario: 單圖雙擊有效日 K
- **WHEN** 使用者在圖表數量為 1 的主圖雙擊命中的有效已完成日 K，且沒有 pending drawing 或固定範圍 tool ownership
- **THEN** 系統 MUST 保持原日 K可見直到同日 `1m` 驗證完成，再於原 panel 原子切換
- **AND** MUST NOT 呼叫 `window.open`、不得載入今天或最近交易日替代資料

#### Scenario: 單圖雙擊非日 K或背景
- **WHEN** 使用者在圖表數量為 1 時雙擊分鐘／週／月 K、主圖背景、副圖或非法 candle hit
- **THEN** 系統 MUST 不開頁、不切換 interval且不得建立 target-date request

### Requirement: MultiView 單擊不得等待雙擊導覽判定
MultiView MUST 讓主圖的合法單擊立即交由目前工具處理，不得為區分日 K drill-down 與開頁而設定 260ms timer、取消 pending single click 或攔截事件。雙擊導覽可在 browser 產生 `dblclick` 時獨立處理。

#### Scenario: 日 K 單擊壓撐沒有感知延遲
- **WHEN** 使用者在 MultiView 日 K 主圖單擊合法 K 棒
- **THEN** 既有壓撐選棒或其他 active tool MUST 在同一次 click dispatch 中執行
- **AND** production runtime MUST NOT 建立 daily gesture timer

### Requirement: MultiView 游標熱路徑不得觸發重型重繪
MultiView MUST 以 Lightweight Charts crosshair callback 作為主圖與副圖的單一游標時間來源，並以 animation frame 合併同一 panel 的高頻事件。一般 pointer move MUST NOT 全量重建 FVG、Volume Profile、價格極值、註記或壓撐 overlay；相同 payload 與 candle time MUST NOT 重複更新 readout、所有 pane crosshair 或版面幾何。

#### Scenario: 同一 candle 內快速移動滑鼠
- **WHEN** 使用者在同一根 K 棒範圍內產生多個 pointer／crosshair event
- **THEN** 系統 MUST 每個 animation frame 最多提交一次且只採用最新事件
- **AND** 已提交相同 candle 後 MUST NOT 重複重建主圖、技術與籌碼 readout DOM

#### Scenario: 一般游標移動沒有繪圖工具 ownership
- **WHEN** 使用者只移動滑鼠且沒有 pending Fibonacci、價格範圍或固定範圍工具
- **THEN** production runtime MUST 只更新 crosshair 與必要 readout
- **AND** MUST NOT 呼叫全量 overlay render、座標對齊檢查、axis measurement 或 panel layout refresh

#### Scenario: 繪圖工具 preview
- **WHEN** 合法繪圖工具持有 pointer 並持續更新 preview
- **THEN** annotation state MUST 以 animation frame latest-wins 更新
- **AND** 快速事件 MUST NOT 在同一 frame 同步重建多次 SVG annotation layer
