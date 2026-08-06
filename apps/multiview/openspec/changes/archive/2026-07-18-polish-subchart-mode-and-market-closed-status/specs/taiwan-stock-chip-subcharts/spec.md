## MODIFIED Requirements

### Requirement: 籌碼副圖 A／B 顯示模式

系統 MUST 提供使用者可見的「單一副圖」與「多層副圖」兩種顯示模式，控制項文案 MUST NOT 顯示 A／B 前綴；內部 MAY 沿用方式 A／B 作為相容識別。方式 A MUST 讓每個 panel 只有一個共用副圖槽位；技術副圖與單一籌碼 pane MUST 互相替換，不得在技術副圖下方新增籌碼列。方式 B MUST 保留既有技術副圖，並以複選語意讓每個已勾選籌碼項目建立一個具獨立 Y 軸的 pane，依固定選單順序上下排列。

#### Scenario: 方式 A 由技術副圖替換為籌碼 pane
- **WHEN** 方式 A 正顯示 KD／RSI／MACD／ATR 技術副圖，使用者從「副圖」選單選擇「三大法人合計」
- **THEN** 三大法人合計 pane MUST 顯示在原技術副圖的同一槽位
- **AND** 技術副圖 MUST 隱藏且主圖下方不得新增另一列
- **AND** 主 K 線與 candles MUST NOT 重新建立或重新請求

#### Scenario: 方式 A 由籌碼 pane 替換回技術副圖
- **WHEN** 方式 A 正顯示籌碼 pane，使用者操作任一技術指標選項
- **THEN** 系統 MUST 銷毀或停用目前籌碼 pane，並在相同槽位恢復技術副圖
- **AND** MUST 恢復保存的技術指標複選組合及最後籌碼作用項目

#### Scenario: 方式 A 替換籌碼作用 pane
- **WHEN** 使用者在方式 A 的同一 panel 從「三大法人合計」選擇「外資持股」
- **THEN** 系統移除三大法人合計 pane並在同一共用槽位建立外資持股 pane
- **AND** 主圖不需重新載入，技術副圖選項也不得被清除

#### Scenario: 方式 B 增加多個 pane
- **WHEN** 使用者在方式 B 依序勾選三大法人合計、融資、融券、大戶持股與散戶持股
- **THEN** 系統 MUST 在既有技術副圖下建立五個獨立 pane，並依固定 registry 順序排列
- **AND** 相同 dataset 的 pane MUST 共用已取得的 response 與 request，不得重複抓取相同 `symbol + dataset + range`

#### Scenario: 方式 B 取消單一項目
- **WHEN** 使用者在方式 B 取消勾選「融券」
- **THEN** 系統 MUST 只銷毀融券 pane 的 chart、series、讀值、listener 與 observer
- **AND** 其他籌碼 pane、主圖與技術副圖 MUST 保持作用且重新排列

#### Scenario: A 與 B 保留各自選擇
- **WHEN** 使用者在方式 B 已選取多個 pane，切到方式 A 改用技術副圖或另一個籌碼 pane，再切回方式 B
- **THEN** 系統 MUST 恢復原本 B 的技術副圖狀態與完整籌碼勾選組合
- **AND** MUST NOT 以 A 的作用種類或單一籌碼項目覆寫 B 的保存清單

#### Scenario: 模式控制顯示語意名稱
- **WHEN** 使用者查看全域副圖模式下拉選單
- **THEN** 選項 MUST 顯示「單一副圖」與「多層副圖」
- **AND** MUST NOT 顯示「A 單一副圖」或「B 多層副圖」

### Requirement: 圖表數量與副圖模式政策

系統 MUST 支援 1、2、3、4、6、8 圖。1、2、3 圖 MUST 可使用 A 或 B 且首次預設 B；4、6、8 圖 MUST 固定使用 A。方式控制 MUST 是全域設定，所有目前 panel 採用相同 effective mode；使用 A 的任何圖數都 MUST 套用同一個共用副圖槽位規則。工具列 MUST NOT 以常駐說明列顯示「1～3 圖可切換」或「4 圖以上固定單一副圖」等文案。

#### Scenario: 首次使用 1、2 或 3 圖
- **WHEN** 裝置尚未保存籌碼副圖偏好且使用者選擇 1、2 或 3 圖
- **THEN** 系統 MUST 啟用方式 B
- **AND** MUST 預設勾選三大法人合計、融資、融券、大戶持股與散戶持股
- **AND** 模式下拉選單 MUST 可操作

#### Scenario: 4、6、8 圖固定方式 A
- **WHEN** 使用者選擇 4、6 或 8 圖
- **THEN** 系統 MUST 套用方式 A
- **AND** 模式下拉選單 MUST 顯示灰色 disabled 的「單一副圖」、設定原生 disabled 與 `aria-disabled="true"`，且不得接受滑鼠或鍵盤切換
- **AND** 每個 panel MUST 只保留一個共用副圖槽位
- **AND** 工具列 MUST NOT 新增另一列說明文字

#### Scenario: 從 B 切到 4、6、8 圖後返回
- **WHEN** 使用者從 1、2 或 3 圖的方式 B 切換至 4、6 或 8 圖，再返回 1、2 或 3 圖
- **THEN** 4、6、8 圖期間 MUST 只顯示方式 A 最後作用的技術副圖或單一籌碼 pane
- **AND** 返回後 MUST 恢復原本方式 B、技術副圖狀態與完整籌碼勾選組合
- **AND** 模式下拉選單 MUST 恢復可操作

#### Scenario: 4、6、8 圖進入聚焦模式
- **WHEN** 使用者在 4、6 或 8 圖中聚焦任一 panel
- **THEN** 聚焦 panel MUST 維持方式 A 與單一共用副圖槽位
- **AND** 聚焦動作 MUST NOT 暫時或永久啟用方式 B

#### Scenario: 顯示新增的 3 圖版面
- **WHEN** 使用者在寬螢幕選擇 3 圖
- **THEN** 系統 MUST 以三欄一列呈現三個等寬 panel
- **AND** 低於多圖可讀性 breakpoint 時 MUST 改為單欄，不得使用不對稱的二加一版面
