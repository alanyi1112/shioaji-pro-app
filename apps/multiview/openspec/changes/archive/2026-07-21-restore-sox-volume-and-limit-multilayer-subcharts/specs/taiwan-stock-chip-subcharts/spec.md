## MODIFIED Requirements

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。只有目前頁籤具有一個以上商品且全部為台股 `.TW`／`.TWO` 時，1、2、3、4 圖 MUST 可使用 A 或 B 且首次預設 B；6、8 圖 MUST 固定使用 A。非台股頁籤與同時含台股及非台股的混合頁籤，任何圖數都 MUST 固定使用 A。方式控制 MUST 是全域設定，所有目前 panel 採用符合市場與圖數政策的 effective mode；每個 panel MUST 再依自身 symbol 阻止非台股採用 B。使用 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則。工具列 MUST NOT 以常駐說明列顯示圖數或市場限制文案。

#### Scenario: 首次使用台股 1、2、3 或 4 圖
- **WHEN** 裝置尚未保存籌碼副圖偏好，目前頁籤全部為台股，且使用者選擇 1、2、3 或 4 圖
- **THEN** 系統 MUST 啟用方式 B
- **AND** MUST 預設勾選全部十個籌碼副圖
- **AND** 模式下拉選單 MUST 可操作

#### Scenario: 台股 6、8 圖固定方式 A
- **WHEN** 使用者在全台股頁籤選擇 6 或 8 圖
- **THEN** 系統 MUST 套用方式 A
- **AND** 模式下拉選單 MUST 顯示灰色 disabled 的「單一副圖」、設定原生 disabled 與 `aria-disabled="true"`，且不得接受滑鼠或鍵盤切換
- **AND** 每個 panel MUST 只保留一個共用副圖槽位
- **AND** 工具列 MUST NOT 新增另一列說明文字

#### Scenario: 非台股頁籤固定方式 A
- **WHEN** 目前頁籤是美股、匯率債券、期貨期指、加密資產或其他只含非台股商品的頁籤
- **THEN** 任何圖表數量都 MUST 套用方式 A
- **AND** 模式下拉選單 MUST 顯示 disabled 的「單一副圖」與 `aria-disabled="true"`
- **AND** 控制項 title MUST 說明只有台股商品可使用多層副圖

#### Scenario: 混合頁籤固定方式 A
- **WHEN** 自訂頁籤同時包含台股與至少一個非台股商品
- **THEN** 整個頁籤與每個 panel MUST 套用方式 A
- **AND** 非台股 panel 不得在切換或載入期間短暫建立多層籌碼 pane

#### Scenario: 從台股 B 切到受限頁籤後返回
- **WHEN** 使用者從 1、2、3 或 4 圖的全台股方式 B 切換至非台股、混合頁籤或台股 6／8 圖，再返回原本符合條件的台股頁籤與圖數
- **THEN** 受限期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 系統 MUST NOT 覆寫裝置端保存的方式 B 偏好或台股 pane 選擇
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合，模式下拉選單 MUST 恢復可操作

#### Scenario: 顯示台股 3 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的全台股頁籤選擇 3 圖方式 B
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面

#### Scenario: 顯示 4 圖方式 A 版面
- **WHEN** 使用者在寬螢幕選擇 4 圖方式 A
- **THEN** 系統 MUST 維持既有 2×2 panel 版面與固定視窗配置
- **AND** 每個 panel MUST 只顯示至多一個共用副圖槽位

#### Scenario: 顯示台股 4 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的全台股頁籤選擇 4 圖方式 B
- **THEN** 系統 MUST 以一列四欄呈現四個等寬 panel，不得改為 2×2
- **AND** 每個 panel MUST 依可見副圖內容自然增高，由整個瀏覽器 document 垂直捲動
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄
