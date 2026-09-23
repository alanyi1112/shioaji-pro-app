## ADDED Requirements

### Requirement: 等價商品資料刷新不得重置成交明細版面
系統 MUST 以穩定商品識別值判斷成交明細的商品上下文。當 `contract` 物件參照改變但 `security_type`、`exchange`、`code` 與 `target_code` 仍代表同一商品時，系統 MUST 視為同一成交 session，不得因此重置捲動位置、重建 subscription 或清除已載入資料。

#### Scenario: 等價 contract 重新 render
- **WHEN** 父層以新的物件參照重新提供內容相同的商品 `contract`
- **THEN** 成交明細 MUST 保留目前捲動位置與已載入 session
- **AND** MUST NOT 將該次刷新當成商品切換

#### Scenario: 真正切換商品
- **WHEN** 商品的穩定識別值改變
- **THEN** 成交明細 MUST 將虛擬清單捲動位置重置至新商品的起始位置
- **AND** 新商品資料 MUST 依既有 session 流程載入

### Requirement: 版面同步不得形成 React 更新迴圈
成交明細的 layout effect MUST 只有在實際 DOM 捲動位置與已同步狀態不同時才更新 React 捲動 state。等價商品刷新、相同資料重新 render 或已同步的捲動位置 MUST NOT 重複 dispatch 相同 state update，且應用程式 MUST NOT 因成交明細觸發 `Maximum update depth exceeded`。

#### Scenario: 已同步位置再次執行 layout effect
- **WHEN** layout effect 因等價資料重新 render 而執行，且 DOM 捲動位置未改變
- **THEN** 系統 MUST NOT 再次寫入相同捲動 state
- **AND** 交易終端 MUST 維持可操作，不得進入啟動失敗畫面

#### Scenario: 程式化捲動位置改變
- **WHEN** 真正上下文切換或新成交錨定使 DOM 捲動位置改變
- **THEN** 系統 MUST 將新的實際捲動位置同步至 React state 一次
- **AND** 虛擬清單 MUST 以該位置計算可見列

### Requirement: 新成交與使用者捲動語意必須維持
使用者位於清單頂端時 MUST 持續看到最新成交；使用者已捲離頂端時，新增成交 MUST 調整 DOM 捲動位置以保持原可見內容，不得強制跳回最新成交。此行為 MUST 在等價商品資料刷新前後一致。

#### Scenario: 使用者已捲離後收到新成交
- **WHEN** 使用者的捲動位置大於零且清單新增成交列
- **THEN** 系統 MUST 依新增列高度調整捲動位置以維持閱讀錨點
- **AND** 同步後 MUST NOT 產生重複 state update

#### Scenario: 使用者停留在頂端
- **WHEN** 使用者位於頂端且清單新增成交列
- **THEN** 系統 MUST 保持頂端以顯示最新成交
