## MODIFIED Requirements

### Requirement: 多層副圖高度與捲動

方式 B MUST 為主圖、每個作用中的籌碼 pane，以及至少選取一項指標時的技術副圖保留可讀高度，並讓 panel 與頁面高度依實際可見 pane 數量及目前 layout signature 的穩定 header 保留高度增減；共用游標在同一 layout signature 內更新 readout 時，MUST NOT 改變 header、pane、後續 pane 或 panel 的幾何高度。當內容超過 viewport 時，系統 MUST 以 `html/body` 的瀏覽器頁面作為唯一垂直捲動容器，`.subchart-slot`、`.chip-pane-region`、`.chip-pane-stack` 與 `.chart-panel` MUST NOT 形成可獨立垂直捲動的區域。桌面寬度的方式 B MUST 採緊湊副圖版型：有作用的技術副圖總高 MUST 介於 96–120 CSS px；籌碼 pane 在 header 單列時總高 MUST 介於 88–104 CSS px，需要多列時 MUST 依目前 panel 寬度、series、資料狀態族群、holder 級距及控制項預先保留足以顯示完整 readout 的高度，且 chart 區至少保留 64 CSS px。沒有選取任何技術指標時 MUST 完全移除技術副圖列及其最小高度。籌碼 pane MUST NOT 建立浮動 tooltip，且 inline readout MUST 與標題及控制項共同使用緊湊 header，不得遮住 chart、裁切資訊或造成水平捲動。方式 A MUST 只顯示至多一個作用中的副圖槽位且不得出現多層 stack 或因籌碼 pane 增加額外列。方式 B MUST 依滑鼠 modifier 分流 wheel：主圖、實際可見的技術副圖與籌碼副圖圖表區的一般垂直 wheel MUST 捲動 document 並保持目前 panel 的時間資料區間；只有 `Option/Alt + wheel` MUST 縮放目前 panel。圖表外區域與瀏覽器原生捲軸 MUST 維持捲動 document；觸控垂直滑動 MUST 捲動 document，水平拖曳與 pinch MUST 操作圖表。

#### Scenario: 方式 A 顯示籌碼 pane
- **WHEN** 使用者在方式 A 選擇任一籌碼項目
- **THEN** 籌碼 pane MUST 使用原技術副圖槽位的高度與位置
- **AND** panel 不得新增副圖列、顯示多層 stack 或啟用方式 B 的長頁面版型
- **AND** 讀值 MUST 在 pane header 內安全換行，不得建立浮動 tooltip 或額外固定詳細列
- **AND** 共用游標在完整、部分或缺值日期間移動時 MUST NOT 改變原副圖槽位高度

#### Scenario: 方式 B 勾選多個籌碼項目
- **WHEN** 使用者在 1／2／3／4 圖的方式 B 勾選五個以上籌碼項目且總高度超過 viewport
- **THEN** 主圖、實際有作用的技術副圖與每個 pane MUST 依緊湊高度、穩定 header 保留高度及目前保存順序全部向下展開
- **AND** document 高度 MUST 隨可見 pane 與合法 layout 變更增加並由瀏覽器頁面捲軸查看所有 pane
- **AND** panel、副圖槽位與籌碼區 MUST NOT 出現獨立垂直捲軸
- **AND** 只移動共用游標 MUST NOT 改變 document 高度

#### Scenario: 4 圖方式 B 使用共同頁面捲軸
- **WHEN** 桌面寬度的 4 圖方式 B 在一列四欄顯示，且任一 panel 的多層副圖超過 viewport
- **THEN** 四個 panel MUST 保持同列等寬，並各自依可見 pane 與穩定 header 保留高度增高
- **AND** 副圖配置、順序前綴與控制狀態相容的 panel，MUST 對相同 pane identity 套用同列 cohort 的最大保留高度，使對應 pane 邊界保持對齊
- **AND** 配置不相容的 panel MUST 各自保持游標期間幾何穩定，不得為強制對齊而插入不存在的 pane 或改變順序
- **AND** 頁面 MUST 只使用瀏覽器 document 的垂直捲軸，不得把較長 panel 壓縮成內層捲動區
- **AND** panel、價格軸、readout、工具列或副圖內容 MUST NOT 產生非預期水平捲軸或裁切必要控制項

#### Scenario: 標題列顯示逐日讀值
- **WHEN** 籌碼 pane 已取得資料且游標未作用
- **THEN** header MUST 顯示最新可用日期與完整讀值，空間不足時依原順序換到預先保留的下一列
- **AND** 游標作用時 MUST 原位改為游標日期讀值，離開後恢復最新值
- **AND** 完整資料、部分資料、無資料與最近一筆狀態往返時，header height、pane height、下一個 pane top 與 panel height 的差異 MUST 各小於或等於 1 CSS px
- **AND** 不得以第二個固定明細區、浮動 tooltip 或 chart 右側系列標籤重複顯示

#### Scenario: 圖表區使用一般滑鼠滾輪捲頁
- **WHEN** 方式 B 的滑鼠指標位於主圖、實際可見的技術副圖或任一籌碼 pane 的實際圖表區，且使用者未按住 `Option/Alt`、`Ctrl` 或 `Meta` 而轉動垂直滾輪
- **THEN** 瀏覽器 document MUST 依手勢方向垂直捲動
- **AND** 目前 panel 的 visible logical range、bar spacing、首末 K 棒座標與其他 panel 的時間範圍 MUST NOT 改變
- **AND** 同一 panel 的主圖與所有可見副圖 MUST 維持相同時間範圍與小於或等於 1 CSS px 的 X 座標對齊

#### Scenario: 圖表外使用滑鼠滾輪捲頁
- **WHEN** 方式 B 的滑鼠指標位於圖表標題列、panel 工具列、控制區、頁面空白或瀏覽器原生捲軸並轉動中央滾輪
- **THEN** 瀏覽器 document MUST 依手勢方向垂直捲動
- **AND** 任一 panel 的 visible logical range MUST NOT 因該手勢改變
- **AND** 頁面 MUST NOT 被單一 chart、pane 或內層捲動區困住

#### Scenario: 從圖表區明確縮放圖表
- **WHEN** 方式 B 的滑鼠指標位於任一圖表區並以 `Option/Alt + wheel` 操作
- **THEN** 系統 MUST 縮放目前 panel 的 visible logical range，且 MUST NOT 捲動瀏覽器 document
- **AND** 同一 panel 的主圖與所有可見副圖 MUST 同步到相同時間範圍
- **AND** 系統不得增加永久提示列、工具列按鈕或新的互動模式

#### Scenario: 從任一圖表按住左鍵拖曳
- **WHEN** 使用者在方式 A 或方式 B 的主圖、技術副圖或任一籌碼 pane 圖表區按住滑鼠左鍵水平拖曳
- **THEN** 系統 MUST 平移目前 panel 的時間資料範圍
- **AND** 同一 panel 的所有可見圖表 MUST 同步，其他 panel 與 document 垂直位置 MUST 保持不變
- **AND** 只有群組 header 的允許拖曳區 MAY 啟動群組重排

#### Scenario: 多層副圖使用觸控手勢
- **WHEN** 使用者在方式 B 的圖表區使用單指垂直滑動、水平拖曳或雙指 pinch
- **THEN** 單指垂直滑動 MUST 捲動瀏覽器 document
- **AND** 水平拖曳 MUST 平移目前 panel 的時間範圍
- **AND** pinch MUST 縮放目前 panel 並同步同一 panel 的所有可見圖表

#### Scenario: 多圖與窄螢幕使用共同頁面捲軸
- **WHEN** 方式 B 在寬螢幕以 2／3／4 個 panel 並排，或在既定 breakpoint 以下改為單欄
- **THEN** 所有 panel MUST 使用同一個瀏覽器頁面垂直捲軸
- **AND** 每個 panel MUST 依自己的作用 pane 與穩定 header 保留高度增高，不得建立各自的垂直捲動容器
- **AND** 頁面 MUST NOT 因 panel、價格軸、readout 或副圖內容產生非預期水平捲軸
- **AND** 6／8 圖 MUST 維持固定單一副圖，不得啟用方式 B 高度協調

#### Scenario: 取消中間的 pane
- **WHEN** 使用者從方式 B 多層 stack 取消一個非首尾 pane
- **THEN** 其後 pane MUST 依目前保存順序向上補位，panel 與 document 高度 MUST 依新的可見 pane 組合縮短
- **AND** 不得改變其他 pane 的資料、尺度、勾選狀態、visible range、header 讀值或 crosshair 同步

#### Scenario: layout-affecting 狀態改變
- **WHEN** payload、圖數、panel 寬度、responsive breakpoint、字型尺寸、series 選取、holder 級距或可見 pane 組合改變
- **THEN** 系統 MUST 使舊 layout signature 失效，並在單一排程 layout 階段重新計算本地與相容 cohort 的保留高度
- **AND** 重算完成後的共用游標移動 MUST 再次符合 1 CSS px 幾何穩定門檻
- **AND** 一般 pointer move、crosshair frame 或 readout 內容置換 MUST NOT 執行高度量測、chart resize 或 cohort 重算

#### Scenario: 縮放與捲頁後維持共用十字線對齊
- **WHEN** 使用者在方式 B 以 `Option/Alt + wheel` 縮放圖表或以一般 wheel 捲動 document，且 layout 已穩定
- **THEN** 同一 panel 的主圖與所有可見副圖 MUST 保持相同日期範圍
- **AND** 相同日期於各圖表的絕對螢幕 X 座標差 MUST 小於或等於 1 CSS px
- **AND** 共用垂直線與 header 逐日讀值 MUST 繼續對應相同或最近的交易日

#### Scenario: 離開方式 B
- **WHEN** 使用者從方式 B 切到方式 A、6 圖或 8 圖
- **THEN** 系統 MUST 移除方式 B 的長頁面、緊湊 stack 版型、cohort registration 與保留高度 override，恢復固定視窗與至多一個作用中的副圖槽位
- **AND** MUST 清理已隱藏 pane 的 listener／observer／readout／wheel routing 狀態，並正確 resize 保留的主圖與副圖
- **AND** 返回支援方式 B 的圖數後 MUST 恢復原本技術副圖狀態、完整籌碼勾選組合與自訂順序，並依新 layout signature 重建保留高度
