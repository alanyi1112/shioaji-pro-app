## ADDED Requirements

### Requirement: 指標功能表必須保持在可操作的 viewport 範圍內

系統 MUST 讓每個 chart panel 的「主圖」與「副圖」功能表依按鈕上下可用空間選擇展開方向，並在瀏覽器 viewport 四周保留安全邊距。功能表完整自然高度可容納於下方時 MUST 優先向下展開；下方不足且上方空間較多時 MUST 向上展開；任一方向都不足時 MUST 將高度限制在空間較大的一側並提供功能表內垂直捲動。所有選項 MUST 可經由直接顯示或功能表內捲動抵達，不得被 panel 或 viewport 邊界永久截斷。

#### Scenario: 上排功能表向下完整展開

- **WHEN** 使用者展開上排 panel 的主圖或副圖功能表，且按鈕下方空間足以容納完整內容及安全邊距
- **THEN** 功能表 MUST 向下展開
- **AND** 功能表上下邊界 MUST 位於 viewport 安全範圍內

#### Scenario: 下排功能表改向上展開

- **WHEN** 使用者展開下排 panel 的主圖或副圖功能表，下方空間不足但上方具有較多可用空間
- **THEN** 功能表 MUST 改為向上展開
- **AND** 功能表 MUST 可覆蓋相鄰圖表但不得被所屬 panel 或 viewport 裁切

#### Scenario: 低高度 viewport 使用內部捲動

- **WHEN** 功能表自然高度在按鈕上方及下方都無法完整容納
- **THEN** 系統 MUST 選擇可用空間較大的一側並限制功能表高度
- **AND** 功能表 MUST 提供垂直捲動，使第一個到最後一個選項都可見且可操作
- **AND** 功能表 MUST NOT 產生不必要的水平捲動或把滾輪操作傳遞為背景頁面捲動

#### Scenario: viewport 尺寸或頁面位置改變

- **WHEN** 功能表保持開啟且 viewport resize 或頁面捲動改變按鈕相對位置
- **THEN** 系統 MUST 重新計算展開方向與可用高度
- **AND** 功能表 MUST 繼續位於目前 viewport 安全範圍內

### Requirement: 主圖功能表必須使用緊湊且可讀的排列

系統 MUST 將主圖指標 checkbox 以緊湊多欄布局呈現，短標籤可使用兩欄，長標籤 MUST 橫跨足夠欄寬以完整閱讀。主圖選項文字 MUST 使用至少 12 CSS px 的可讀字級與正常 line-height，checkbox MUST 維持原生可操作尺寸，且完整 label 區域 MUST 可點擊。數值顯示控制 MUST 維持全寬且選取值不得被截斷。

#### Scenario: 8 圖窄 panel 顯示全部主圖選項

- **WHEN** 使用者在 8 圖配置的任一 panel 展開主圖功能表
- **THEN** 「均線」、「布林」、「成交量」與其他短標籤 MUST 以緊湊多欄排列
- **AND** `Fair Value Gaps`、`Volume Profile`、「本益比河流圖」與「估算融資成本」MUST 顯示完整文字，不得以省略號或裁切取代
- **AND** checkbox、label 與「數值顯示」select MUST 仍可用滑鼠及鍵盤操作

#### Scenario: 主圖選項維持既有狀態契約

- **WHEN** 使用者在重排後的主圖功能表切換任一 checkbox 或數值顯示方式
- **THEN** 系統 MUST 沿用既有 checkbox value、預設選取、偏好保存與指標渲染行為
- **AND** 排列變更 MUST NOT 修改資料請求、指標計算、series 或 readout 內容

### Requirement: 主圖繪圖工具必須以緊湊兩欄保持直接操作

系統 MUST 在主圖功能表中將繪圖工具呈現為兩欄：費波那契回撤與費波那契拓展位於第一列，價格範圍與清除繪圖位於第二列。每個按鈕 MUST 保留至少 26 CSS px 高度、完整可辨識文字、既有 hover／focus 樣式與 DOM／鍵盤順序，不得因降低功能表高度而折疊或隱藏繪圖工具。

#### Scenario: 多圖下排操作最後一個繪圖工具

- **WHEN** 使用者在多圖下排 panel 展開主圖功能表並巡覽繪圖工具
- **THEN** 四個繪圖工具按鈕 MUST 全部可見或可經功能表內捲動抵達
- **AND** 使用者 MUST 可啟動價格範圍或清除繪圖，不得因 viewport 邊界而無法點擊

#### Scenario: 鍵盤巡覽緊湊繪圖工具

- **WHEN** 使用者以鍵盤從主圖 checkbox、數值顯示 select 巡覽至繪圖工具
- **THEN** 焦點 MUST 依既有 DOM 順序通過費波那契回撤、費波那契拓展、價格範圍與清除繪圖
- **AND** 視覺兩欄排列 MUST NOT 改變各工具的行為或本機註記生命週期

### Requirement: 指標功能表既有收合與生命週期必須維持相容

系統 MUST 保留同一 panel 主圖／副圖功能表互斥、功能表內多選保持展開、外部滑鼠左鍵收合及 Escape 收合行為。panel 重建或銷毀時 MUST 移除功能表定位相關的 toggle、resize、scroll、pointer 與 keyboard listener，不得累積重複處理器。

#### Scenario: 功能表內連續切換多個選項

- **WHEN** 使用者展開功能表並連續切換兩個以上 checkbox
- **THEN** 功能表 MUST 保持展開並維持當前方向與可用高度
- **AND** 展開另一個功能表時，原功能表 MUST 收合

#### Scenario: 外部收合與 cleanup

- **WHEN** 使用者按 Escape、在功能表外按滑鼠左鍵，或 panel 被銷毀
- **THEN** 已展開功能表 MUST 依既有規則收合
- **AND** panel 銷毀後 MUST 不再保留該 panel 的功能表或 viewport 事件處理器
