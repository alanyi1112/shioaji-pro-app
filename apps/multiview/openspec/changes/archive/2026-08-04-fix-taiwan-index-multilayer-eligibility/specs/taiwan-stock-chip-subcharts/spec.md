## MODIFIED Requirements

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。主圖與方式 A 必須適用所有市場；目前頁籤具有一個以上商品，且所有商品皆為台股 `.TW`／`.TWO` 或明確 allowlist 內的台灣市場基準指數時，1／2／3／4 圖 MUST 開放方式 B；6／8 圖 MUST 固定方式 A。台股單一商品頁只依目標商品判斷方式 B 資格。裝置沒有任何新舊模式偏好時 MUST 首次預設方式 A。方式控制 MUST 是全域設定，但每個 panel MUST 依自身 symbol 採符合資格的 effective mode；台灣市場基準指數 MAY 讓同頁台股商品使用方式 B，但其自身 panel MUST 採方式 A 且不得建立籌碼資料生命週期。方式 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則；方式 B 的支援圖數都 MUST 讓 panel 依作用中的 pane 自然增高並由 document 捲動。工具列 MUST NOT 以常駐說明列顯示圖數或市場限制文案。

#### Scenario: 首次使用任一頁籤
- **WHEN** 裝置尚未保存新呈現模式或既有 A／B 偏好，且使用者選擇 1、2、3、4、6 或 8 圖
- **THEN** 系統 MUST 啟用方式 A 的單一副圖
- **AND** 主副圖下拉選單 MUST 可操作
- **AND** eligible 台股 MUST NOT 自動建立方式 B 的十二個籌碼 pane

#### Scenario: 台股 1／2／3／4 圖可切換 A 或 B
- **WHEN** 使用者在相容台股頁籤選擇 1、2、3 或 4 圖
- **THEN** 主圖、單一副圖與多層副圖選項 MUST 全部可用
- **AND** 使用者選擇 A 時每個 panel MUST 只保留一個共用副圖槽位
- **AND** 使用者選擇 B 時 eligible 台股 panel MUST 依已選 pane 自然增高，並使用瀏覽器 document 的垂直捲軸
- **AND** 圖數切換 MUST NOT 覆寫使用者保存的呈現模式偏好

#### Scenario: 台灣市場指數不封鎖同頁台股多層副圖
- **WHEN** 「台股」頁籤同時包含 allowlist 內的 `^TWII` 與至少一支 `.TW`／`.TWO` 商品，且圖表數量為 1、2、3 或 4
- **THEN** 主圖、單一副圖與多層副圖選項 MUST 全部可用
- **AND** 使用者選擇多層副圖時，`^TWII` panel MUST 採單一技術副圖且不得建立或請求籌碼 pane
- **AND** `.TW`／`.TWO` panel MUST 依保存狀態採多層副圖

#### Scenario: 6／8 圖固定單一副圖
- **WHEN** 使用者選擇 6 或 8 圖
- **THEN** 系統 MUST 使用方式 A 的單一副圖
- **AND** 主圖與多層副圖選項 MUST disabled
- **AND** 切回 1、2、3 或 4 圖後 MUST 恢復切換前保存且符合市場資格的主副圖偏好

#### Scenario: 從多圖開啟台股單一商品頁
- **WHEN** 使用者從多圖雙擊台股 `.TW`／`.TWO` 商品並以有效 `view=single` URL 開啟單一商品頁
- **THEN** 多層副圖資格 MUST 只依該目標商品判斷，不得因來源頁籤另含非台股商品而停用
- **AND** 主圖、單一副圖與多層副圖選項 MUST 可操作並可保存偏好
- **AND** 單一商品頁 MUST 只建立目標商品的一個 panel lifecycle

#### Scenario: 從多圖開啟非台股單一商品頁
- **WHEN** 使用者以有效 `view=single` URL 開啟非台股商品
- **THEN** 主副圖下拉選單 MUST 保持可操作，主圖與單一副圖 MUST 可選，多層副圖 MUST disabled
- **AND** 保存偏好為主圖時 MUST 只呈現主圖，其他不適用偏好 MUST 暫時採方式 A
- **AND** MUST NOT 因來源頁籤另含台股商品而短暫建立多層籌碼 pane

#### Scenario: 非台股頁籤限制多層副圖
- **WHEN** 目前頁籤是美股、匯率債券、期貨期指、加密資產或其他只含非台股商品的頁籤
- **THEN** 主副圖下拉選單 MUST 保持可操作，主圖與單一副圖 MUST 可選
- **AND** 多層副圖 option MUST disabled 並以可存取狀態說明只有台股商品可使用
- **AND** 偏好為 multi 時 effective mode MUST 暫時採方式 A，但不得覆寫保存偏好

#### Scenario: 真正跨市場的混合頁籤限制多層副圖
- **WHEN** 自訂頁籤同時包含台股相容商品與至少一個非台股且不在台灣市場基準指數 allowlist 的商品
- **THEN** 主圖與單一副圖 MUST 可選，多層副圖 option MUST disabled
- **AND** 每個 panel MUST 採相同的主圖或方式 A effective mode
- **AND** 非台股 panel 不得在切換或載入期間短暫建立多層籌碼 pane

#### Scenario: 從台股 B 切到受限頁籤後返回
- **WHEN** 使用者從 1／2／3／4 圖的相容台股方式 B 切換至非台股或真正跨市場的混合頁籤，再返回原本符合條件的台股頁籤與圖數
- **THEN** 受限期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 系統 MUST NOT 覆寫裝置端保存的 multi 偏好或台股 pane 選擇
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合，多層副圖 option MUST 恢復可操作

#### Scenario: 顯示台股 3 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的相容台股頁籤選擇 3 圖方式 B
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面

#### Scenario: 顯示 4 圖方式 A 版面
- **WHEN** 使用者在寬螢幕選擇 4 圖方式 A
- **THEN** 系統 MUST 維持既有 2×2 panel 版面與固定視窗配置
- **AND** 每個 panel MUST 只顯示至多一個共用副圖槽位

#### Scenario: 顯示台股 4 圖方式 B 版面
- **WHEN** 使用者在寬螢幕的相容台股頁籤選擇 4 圖方式 B
- **THEN** 系統 MUST 以一列四欄呈現四個等寬 panel，不得改為 2×2
- **AND** 每個 eligible 台股 panel MUST 依可見副圖內容自然增高，由整個瀏覽器 document 垂直捲動
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄
