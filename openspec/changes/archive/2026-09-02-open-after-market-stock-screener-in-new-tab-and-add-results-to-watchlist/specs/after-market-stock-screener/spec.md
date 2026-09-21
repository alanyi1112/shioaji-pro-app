## MODIFIED Requirements

### Requirement: 主介面必須提供完整交易終端形式的收盤後選股版面

RealTimeStock 本機主介面的 viewport-safe「版面」下拉選單 MUST 在「預設版面 Presets」區提供「選股篩選」入口。啟用後 MUST 以同源新分頁開啟完整交易終端，保留頂部工具列，並套用左側「選股」、右側 K 線圖的專用 workspace；MUST NOT 顯示只有選股控制項的獨立根頁面。新頁 MUST 明示「收盤後」與「上市＋上櫃普通股」範圍，並可查閱排除 ETF、ETN、權證、特別股、興櫃及海外股票的說明。

「＋新增面板」選單 MUST 保留名稱為「選股」的原有 action，啟用後 MUST 以 `addBlock` 建立內嵌 `screener` block，且既有一個時 MUST 依 singleton 語意停用。workspace 或具名版面的 `screener` block MUST 保持可載入、移動、縮放、移除與保存。

#### Scenario: 從版面選單開啟完整選股交易頁

- **WHEN** 使用者在「版面」選單的「預設版面 Presets」區啟用「選股篩選」
- **THEN** 系統 MUST 同步開啟一個具有完整交易終端頂部工具列的新分頁
- **AND** 新分頁 MUST 只有一個左側選股面板及一個右側 K 線圖面板，兩者在桌面 viewport 並排且可各自捲動或操作
- **AND** 來源主頁的 workspace、自選清單及排行榜 MUST 保持原狀

#### Scenario: 面板高度隨可視區域調整

- **WHEN** 選股版面新頁在不同高度的 viewport 開啟，或使用者調整視窗高度使頂部工具列高度改變
- **THEN** 左側選股與右側 K 線主面板 MUST 使用相同高度，且面板底部 MUST 保持在 grid 可視區域內
- **AND** 選股內容超過面板高度時 MUST 在面板內捲動，不得以增加主面板高度造成整個 workspace 超出 viewport

#### Scenario: 新增面板保留內嵌選股

- **WHEN** 目前 workspace 尚無 `screener` block，使用者從「＋新增面板」啟用「選股」
- **THEN** 系統 MUST 在目前 workspace 建立內嵌選股面板，MUST NOT 開啟新分頁
- **AND** 已有 `screener` block 後該 action MUST 顯示已存在並停用

#### Scenario: 保存與載入含選股 block 的版面

- **WHEN** 使用者載入含 `screener` block 的目前 workspace 或具名版面
- **THEN** 系統 MUST 依原內容恢復該 block，不清除 workspace／profile storage key，也不自動開啟新分頁
- **AND** 使用者移除該 block 後 MUST 可正常保存不含它的版面

#### Scenario: 選股資料服務離線

- **WHEN** 選股版面新分頁已開啟但 5174 無法提供選股底稿
- **THEN** 完整交易終端與 K 線圖 MUST 保持可用，選股面板 MUST 呈現既有來源不可用／離線狀態及指引
- **AND** 系統 MUST NOT 自動啟動或重啟任何服務

### Requirement: 選股點選必須只連動新頁內指定且未鎖定的 K 線圖

選股版面新分頁 MUST 沿用同一個 `TradingApp` workspace 內的 chart target 協調。點選或以鍵盤啟用結果內容後，系統 MUST 重新驗證 target 仍存在且未鎖定，並將合法合約只送到該新頁內指定圖表。只有一個可用目標時 MUST 自動選定；有多個時 MUST 提供可辨識的選擇器。系統 MUST NOT 改動來源主頁、其他分頁、其他圖表、全域自選商品、個人清單、下單或智慧下單商品與草稿，MUST NOT 發出任何交易寫入。

#### Scenario: 點選未加入自選清單的股票

- **WHEN** 使用者在選股版面新分頁點選具有完整識別與合法合約的符合股票
- **THEN** 新頁內指定圖表 MUST 顯示該商品 K 線及一致的商品標題／報價，不將選股歷史列冒充最新行情 snapshot
- **AND** 來源主頁、自選清單內容與下單面板的商品、數量、價格及草稿 MUST 保持不變

#### Scenario: 所有圖表已鎖定或沒有圖表

- **WHEN** 點選結果時新頁沒有未鎖定的 K 線圖
- **THEN** 系統 MUST 提示先解鎖或明確開啟新 K 線圖；只有使用者啟用新增動作時才建立日 K 圖，不自動解除既有 pin

#### Scenario: 連點與目標失效

- **WHEN** 使用者快速點選 A 再點 B，或載入期間目標被移除、鎖定或改選
- **THEN** 過時 request／response MUST 不得覆寫 B 或新的目標，且不得把目標失效的 A 顯示為連動成功
- **AND** 來源主頁與其他 chart block MUST 保持原狀

#### Scenario: 多個主交易頁同時開啟

- **WHEN** 瀏覽器同時存在來源主頁與一個或多個選股版面新分頁
- **THEN** 每個分頁的 workspace 與 chart target MUST 隔離，選股點選只作用於發生操作的分頁
- **AND** 選股版面新分頁的拖拉、縮放、新增或移除面板 MUST NOT 覆寫來源主頁持久化 workspace

#### Scenario: 直接開啟選股版面網址

- **WHEN** 使用者從書籤或貼上網址直接開啟合法的選股版面 URL
- **THEN** 系統 MUST 顯示完整交易終端、左側選股與右側 K 線圖，不得退回只有選股控制項的獨立根頁面

#### Scenario: 新增日 K 圖

- **WHEN** 使用者在選股面板明確啟用「新增日 K 圖」
- **THEN** 系統 MUST 在同一個新頁 workspace 建立一個未鎖定日 K 圖，並在建立完成後選用該目標
