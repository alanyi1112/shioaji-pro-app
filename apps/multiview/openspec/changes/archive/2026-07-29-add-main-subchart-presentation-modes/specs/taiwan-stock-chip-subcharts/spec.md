## MODIFIED Requirements

### Requirement: 籌碼副圖 A／B 顯示模式

系統 MUST 在「主副圖」全域控制中提供使用者可見的「單一副圖」與「多層副圖」子模式，控制項文案 MUST NOT 顯示 A／B 前綴；實作 MUST 僅在相容邊界沿用方式 A／B 作為內部識別。方式 A MUST 讓每個 panel 只有一個共用副圖槽位；技術副圖與單一籌碼 pane MUST 互相替換，不得在技術副圖下方新增籌碼列。方式 B MUST 保留有實際選取項目的技術副圖，並以複選語意讓每個已勾選籌碼項目建立一個具獨立 Y 軸的 pane，依該頁籤與商品保存的自訂順序上下排列；尚未有自訂順序時 MUST 使用 registry 預設順序。主圖模式 MUST 暫停 A／B 可見 lifecycle，但不得清除兩者偏好。

#### Scenario: 方式 A 由技術副圖替換為籌碼 pane
- **WHEN** 方式 A 正顯示 KD／RSI／MACD／ATR 技術副圖，使用者從「副圖」選單選擇「三大法人合計」
- **THEN** 三大法人 pane MUST 顯示在原技術副圖的同一槽位
- **AND** 技術副圖 MUST 隱藏且主圖下方不得新增另一列
- **AND** 主 K 線與 candles MUST NOT 重新建立或重新請求

#### Scenario: 方式 A 由籌碼 pane 替換回技術副圖
- **WHEN** 方式 A 正顯示籌碼 pane，使用者操作任一技術指標選項
- **THEN** 系統 MUST 銷毀或停用目前籌碼 pane，並在相同槽位恢復技術副圖
- **AND** MUST 恢復保存的技術指標複選組合及最後籌碼作用項目

#### Scenario: 方式 A 替換籌碼作用 pane
- **WHEN** 使用者在方式 A 的同一 panel 從「三大法人合計」選擇「外資買賣超＋持股」
- **THEN** 系統移除三大法人 pane 並在同一共用槽位建立外資 pane
- **AND** 主圖不需重新載入，技術副圖選項也不得被清除

#### Scenario: 方式 B 增加多個 pane
- **WHEN** 使用者在方式 B 依序勾選三大法人合計、融資、融券、大戶持股與散戶持股
- **THEN** 系統 MUST 在有作用時的技術副圖下建立五個獨立 pane，並依目前保存順序排列
- **AND** 相同 dataset 的 pane MUST 共用已取得的 response 與 request，不得重複抓取相同 `symbol + dataset + range`

#### Scenario: 方式 B 取消單一項目
- **WHEN** 使用者在方式 B 取消勾選「融券」
- **THEN** 系統 MUST 只銷毀融券 pane 的 chart、series、讀值、listener 與 observer
- **AND** 其他籌碼 pane、主圖與有作用的技術副圖 MUST 保持作用且依保存順序補位

#### Scenario: A 與 B 保留各自選擇
- **WHEN** 使用者在方式 B 已選取多個 pane 並調整順序，切到方式 A 改用技術副圖或另一個籌碼 pane，再切回方式 B
- **THEN** 系統 MUST 恢復原本 B 的技術副圖狀態、完整籌碼勾選組合與自訂順序
- **AND** MUST NOT 以 A 的作用種類或單一籌碼項目覆寫 B 的保存清單

#### Scenario: 模式控制顯示語意名稱
- **WHEN** 使用者查看全域主副圖模式下拉選單
- **THEN** 選項 MUST 顯示「主圖」、「單一副圖」與「多層副圖」
- **AND** MUST NOT 顯示「A 單一副圖」或「B 多層副圖」

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。主圖與方式 A 必須適用所有市場；只有目前頁籤具有一個以上商品且全部為台股 `.TW`／`.TWO` 時，所有支援圖數 MUST 開放方式 B，台股單一商品頁則只依目標商品判斷方式 B 資格。裝置沒有任何新舊模式偏好時 MUST 首次預設方式 A。方式控制 MUST 是全域設定，所有目前 panel 採用符合市場政策的 effective mode；每個 panel MUST 再依自身 symbol 阻止非台股採用 B。方式 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則；方式 B 的任何圖數都 MUST 讓 panel 依作用中的 pane 自然增高並由 document 捲動。工具列 MUST NOT 以常駐說明列顯示圖數或市場限制文案。

#### Scenario: 首次使用任一頁籤
- **WHEN** 裝置尚未保存新呈現模式或既有 A／B 偏好，且使用者選擇 1、2、3、4、6 或 8 圖
- **THEN** 系統 MUST 啟用方式 A 的單一副圖
- **AND** 主副圖下拉選單 MUST 可操作
- **AND** eligible 台股 MUST NOT 自動建立方式 B 的十二個籌碼 pane

#### Scenario: 台股所有圖數可切換 A 或 B
- **WHEN** 使用者在全台股頁籤選擇 1、2、3、4、6 或 8 圖
- **THEN** 主圖、單一副圖與多層副圖選項 MUST 全部可用
- **AND** 使用者選擇 A 時每個 panel MUST 只保留一個共用副圖槽位
- **AND** 使用者選擇 B 時每個 panel MUST 依已選 pane 自然增高，並使用瀏覽器 document 的垂直捲軸
- **AND** 圖數切換 MUST NOT 覆寫使用者保存的呈現模式偏好

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

#### Scenario: 混合頁籤限制多層副圖
- **WHEN** 自訂頁籤同時包含台股與至少一個非台股商品
- **THEN** 主圖與單一副圖 MUST 可選，多層副圖 option MUST disabled
- **AND** 每個 panel MUST 採相同的主圖或方式 A effective mode
- **AND** 非台股 panel 不得在切換或載入期間短暫建立多層籌碼 pane

#### Scenario: 從台股 B 切到受限頁籤後返回
- **WHEN** 使用者從任一圖數的全台股方式 B 切換至非台股或混合頁籤，再返回原本符合條件的台股頁籤與圖數
- **THEN** 受限期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 系統 MUST NOT 覆寫裝置端保存的 multi 偏好或台股 pane 選擇
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合，多層副圖 option MUST 恢復可操作

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
