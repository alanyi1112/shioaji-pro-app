## ADDED Requirements

### Requirement: 籌碼資料群組一鍵置底

每個籌碼副圖既有的右鍵功能表 MUST 固定提供「置底」操作；在方式 B 可排序狀態下，系統 MUST 將該 pane 所在的完整資料群組移到籌碼副圖區最後一個群組位置，並維持群組內 canonical child order。置底 MUST 沿用既有 `tabId + canonical symbol` 群組順序保存，且不得重新請求 pane 資料。

#### Scenario: 將中間群組一鍵置底
- **WHEN** 使用者在方式 B 對非最後一個群組內任一籌碼 pane 開啟右鍵功能表並選擇「置底」
- **THEN** 該 pane 所在的完整 group wrapper MUST 一次移到籌碼副圖區最後一個群組位置
- **AND** 群組內目前可見 panes MUST 維持 canonical child order，其他群組 MUST 依原相對順序向前補位
- **AND** 系統 MUST 只保存一次偏好、執行一次必要 layout refresh，且不得重新請求資料

#### Scenario: 已在最下方的群組
- **WHEN** 使用者開啟目前最後一個資料群組內任一籌碼 pane 的右鍵功能表
- **THEN** 功能表 MUST 顯示「置底」但設為 disabled
- **AND** 選擇狀態、DOM 順序、偏好與資料請求 MUST 保持不變

#### Scenario: 單層副圖模式顯示置底狀態
- **WHEN** 使用者在方式 A 的籌碼 pane 開啟右鍵功能表
- **THEN** 功能表 MUST 顯示「置底」但設為 disabled
- **AND** 系統 MUST NOT 改變方式 A 的作用種類、技術副圖或籌碼 pane 選擇

#### Scenario: 重新載入後恢復置底順序
- **WHEN** 使用者完成群組置底後重新載入頁面，或切換商品後再返回原商品
- **THEN** 系統 MUST 依該 `tabId + canonical symbol` 保存狀態恢復群組順序
- **AND** MUST NOT 將置底順序套用到其他 tab 或 symbol
