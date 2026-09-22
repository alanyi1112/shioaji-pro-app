## ADDED Requirements

### Requirement: 清單內容不得等待即時報價訂閱

系統 MUST 在 server-backed watchlist 與可解析的 canonical 合約就緒後發布清單列並結束該世代的內容載入狀態；Tick、BidAsk 或 Quote 訂閱 MUST 在背景執行，任一訂閱持續等待、逾時或失敗均不得讓整份清單停在「載入清單…」。

#### Scenario: 單一訂閱持續等待

- **WHEN** 自選清單含有多個已解析商品，且其中一個 `/api/v1/stream/subscribe` promise 持續未完成
- **THEN** 系統 MUST 顯示全部已解析清單列並解除內容 loading，尚無行情的欄位 MUST 保持可辨識的空值或既有值

#### Scenario: 部分訂閱失敗

- **WHEN** 清單合約解析成功，但一個或多個必要行情訂閱失敗或逾時
- **THEN** 系統 MUST 保留清單列，不得把整份清單改為空白或永久 loading

### Requirement: 訂閱狀態必須反映實際完成結果

系統 MUST 分別追蹤等待中的訂閱與已成功訂閱商品；等待中的同商品不得重複送出請求，且只有該商品所需報價種類全部成功時才能標記為已訂閱。失敗或逾時 MUST 釋放等待狀態，讓後續既有 reload 或 session recovery 可以重新嘗試，而不得建立無界自動重試迴圈。

#### Scenario: 等待中的商品被再次要求訂閱

- **WHEN** 某商品的背景訂閱仍在 pending，且同一文件再次要求該商品訂閱
- **THEN** 系統 MUST 共用或略過該次需求，不得建立第二組並行訂閱請求

#### Scenario: 訂閱失敗後重新載入

- **WHEN** 某商品的必要訂閱已失敗並結束，之後同一清單因明確 reload 或 session recovery 再次載入
- **THEN** 系統 MUST 允許重新嘗試該商品訂閱，且不得因先前曾送出請求就誤判為已訂閱

### Requirement: 清單重新載入必須保留正確內容並採 latest-wins

系統 MUST 在同一 list id 重新載入時保留現有列直到新解析結果就緒；切換不同 list id 時 MUST 清除前一清單列。任何較舊載入世代均不得覆寫較新的作用中清單、列內容或 loading 狀態。

#### Scenario: 同一清單背景刷新

- **WHEN** 目前清單因 invalidation 或服務恢復開始重新載入，且既有列仍可用
- **THEN** 系統 MUST 保留既有列，並在最新解析結果完成後原子更新，不得先顯示空白清單

#### Scenario: 切換到另一份清單

- **WHEN** 使用者從 list A 切換到 list B，而 list B 尚在解析
- **THEN** 系統 MUST 不再顯示 list A 的列，並在 list B 最新世代完成後只顯示 list B 內容

#### Scenario: 舊世代晚於新世代完成

- **WHEN** list A 的較舊載入在 list B 的較新載入之後才完成
- **THEN** list A 的結果與 finally MUST NOT 覆寫 list B 的列或提前解除 list B 的 loading

### Requirement: 載入收尾不得受背景同步阻塞

系統 MUST 讓目前載入世代在合約解析完成後可靠解除 loading。canonical migration 或 server watchlist 同步 MUST 在背景處理自身錯誤，不得阻止已解析列顯示或留下永久 loading。

#### Scenario: canonical migration 同步失敗

- **WHEN** canonical 合約已解析並發布，但後續 server watchlist 同步失敗
- **THEN** 系統 MUST 保留已發布列、解除 loading 並以非阻塞方式回報同步失敗

### Requirement: 背景串流不得耗盡互動式資料請求連線

系統 MUST 在本機 Vite HTTP/1.1 開發環境中保留足夠連線供 K 線等互動式 REST 請求使用。即時訊號面板的多條長效 SSE MUST NOT 與主行情、合約事件共同占滿頁面 origin 的瀏覽器連線額度；非 loopback 或非開發環境 MUST NOT 擅自改寫 API origin。

#### Scenario: 清單載入後切換線圖商品

- **WHEN** 主行情、合約事件與即時訊號通道皆已連線，使用者再從自選清單切換線圖商品或時間框架
- **THEN** 對應 K 線 REST request MUST 能送達本機 API 並讓線圖離開 loading，不得因 SSE 連線占滿而永久停在瀏覽器佇列

#### Scenario: 打包版或明確 API base

- **WHEN** 應用程式執行於 Tauri、明確設定 API base、非開發模式或非 loopback hostname
- **THEN** 系統 MUST 保留既有 API base，不得套用 Vite loopback hostname 分流
