## MODIFIED Requirements

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、技術副圖及每個籌碼 pane 保留可讀的最低高度，並讓 panel 與頁面高度依作用中的 pane 數量自然增減；當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域，且 MUST NOT 以無限制等比例壓縮容納全部 pane。方式 A MUST 只顯示單一副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外高度；4／6／8 圖與聚焦模式 MUST 維持方式 A 的固定視窗版型。每個可見籌碼 pane 標題 MUST 顯示名稱、最新值、實際資料日期、狀態及適用模式下可操作的移除控制。桌面與窄螢幕 MUST 避免非預期的頁面水平捲動。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、技術副圖與每個 pane MUST 保持規定的最低高度並依固定順序全部向下展開
- **AND** document 高度 MUST 隨內容增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸

#### Scenario: 從圖表內容使用垂直捲動手勢
- **WHEN** 使用者將游標或觸控位置放在主圖、技術副圖或任一籌碼 pane 上並執行垂直 wheel／touch 手勢
- **THEN** 手勢 MUST 可推進瀏覽器 document 的垂直捲動位置
- **AND** MUST NOT 被單一 chart 或 pane 的內層捲動區困住
- **AND** 水平拖曳、時間軸縮放與 crosshair MUST 保持可操作

#### Scenario: 2／3 圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3 個 panel 並排，或在既定 breakpoint 以下改為單欄
- **THEN** 所有 panel MUST 使用同一個瀏覽器頁面垂直捲軸
- **AND** 每個 panel MUST 依自己的作用 pane 自然增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸或副圖內容產生非預期水平捲軸

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依固定順序向上補位，panel 與 document 高度 MUST 自然縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range 或 crosshair 同步

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、4／6／8 圖或聚焦模式
- **THEN** 系統 MUST 移除方式 B 的長頁面版型並恢復固定視窗與單一副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer 並正確 resize 保留的主圖與副圖
- **AND** 返回方式 B 後 MUST 恢復原本技術副圖狀態與完整籌碼勾選組合
