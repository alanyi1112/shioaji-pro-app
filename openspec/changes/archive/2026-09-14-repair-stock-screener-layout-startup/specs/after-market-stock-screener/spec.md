## ADDED Requirements

### Requirement: 專用選股版面啟動不得依賴作用中自選清單行情

`layout=stock-screener` MUST 在 grid 容器就緒後先呈現完整交易終端、左側選股面板與右側 K 線面板，不得等待作用中自選清單全部商品完成合約解析、Snapshot 載入或行情訂閱。系統 MAY 在背景讀取 watchlist metadata 以支援清單整合，但開頁本身 MUST NOT 替作用中清單商品建立 Tick、BidAsk 或 Quote 訂閱。使用者明確點選可操作的選股結果後，系統才 MUST 為該次 selection generation 載入指定圖表所需的單一商品資料。

#### Scenario: 自選清單初始化持續等待

- **WHEN** 使用者開啟 `layout=stock-screener`，且 watchlist metadata、合約解析或既有清單行情仍在等待
- **THEN** 新頁 MUST 先顯示可操作的選股面板與右側 K 線面板，不得持續只顯示「載入交易終端…」
- **AND** 初始尚無圖表商品時 MUST 顯示可理解的等待商品狀態

#### Scenario: 開頁不訂閱作用中清單

- **WHEN** 專用選股版面完成首次渲染，且使用者尚未點選選股結果
- **THEN** 系統 MUST NOT 因作用中自選清單內容呼叫 `/api/v1/stream/subscribe`
- **AND** 來源主頁既有行情訂閱與一般交易 workspace 行為 MUST 保持不變

#### Scenario: 點選結果後載入指定商品

- **WHEN** 使用者明確點選一筆可操作的選股結果並指定未鎖定 K 線圖
- **THEN** 系統 MUST 只為該 selection generation 解析商品並取得圖表與 Snapshot 所需資料
- **AND** MUST NOT 因這次點選回頭載入或訂閱整份作用中自選清單

#### Scenario: 選股底稿可用但 Shioaji watchlist 延遲

- **WHEN** 5174 選股底稿可讀，但 Shioaji watchlist 請求延遲或失敗
- **THEN** 使用者 MUST 仍可設定條件、檢視底稿狀態及執行不依賴 Shioaji 的選股查詢
- **AND** 依賴清單或圖表的操作 MUST 個別呈現其錯誤，不得重新封鎖整個 workspace
