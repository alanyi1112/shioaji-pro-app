## Purpose

定義台股「分時走勢」作為獨立圖表模式的資料、視覺、來源狀態與多圖行為，讓使用者查看當日逐筆價格路徑與成交量，而不是以 1 分 K 取代需求。

## ADDED Requirements

### Requirement: 系統必須提供獨立的分時走勢模式

支援的台股商品 MUST 可選擇「分時」圖；分時圖 MUST 以當日時間為橫軸、最新成交價為價格線，並顯示成交均價線、昨收基準與分時成交量，不得以 1 分 K 棒呈現。

#### Scenario: 盤中開啟分時圖

- **WHEN** 使用者在支援的台股 panel 選擇「分時」
- **THEN** 主圖 MUST 顯示今日開盤至目前的成交價走勢線
- **AND** MUST 顯示當日均價線、昨收基準、分時成交量、最新價與來源時間
- **AND** 主圖 MUST NOT 顯示 candlestick

#### Scenario: 從分時切回日週月

- **WHEN** 使用者從分時切回日、週或月 K 線
- **THEN** 系統 MUST 恢復對應 K 線與原本的 visible state
- **AND** 分時模式 MUST NOT 覆寫已保存的主副圖偏好或 K 線週期

### Requirement: 分時資料必須先補齊再接續 Tick

盤中首次開啟分時圖時，系統 MUST 先載入閘道現有 session buffer；若不足，MUST 以一次有界的當日歷史查詢補齊，再依來源時間去重接續 Tick，不得只從開啟畫面的時間開始畫線。

#### Scenario: 盤中首次開啟已有 session buffer

- **WHEN** 閘道已有該商品今日開盤至目前的資料
- **THEN** 分時圖 MUST 先顯示完整可用區間
- **AND** 後續 Tick MUST 接在最後來源時間之後

#### Scenario: 新增商品後缺少早盤資料

- **WHEN** 商品盤中才加入且 session buffer 不完整
- **THEN** 系統 MUST 執行一次有界回補並立即顯示已取得部分
- **AND** MUST 依時間去重回補與新 Tick
- **AND** MUST NOT 以持續輪詢歷史 API 取代行情訂閱

### Requirement: 分時繪圖必須有界且保留行情語意

系統 MUST 接受逐筆 Tick 以計算最新價、高低、均價與累計量，但 MAY 以有界節流合併前端重繪；價格線 MUST 保留正確時間順序，成交量 MUST 使用固定時間 bucket 或同等可讀方式且不得重複累加。

#### Scenario: 熱門商品每秒多筆成交

- **WHEN** 同一商品在單一前端 frame 內收到多筆 Tick
- **THEN** 系統 MUST 接受其聚合語意並繪出最後有效狀態
- **AND** MAY 合併中間重繪以避免阻塞 UI
- **AND** high、low、累計 volume 與均價 MUST 反映所有已接受 Tick

#### Scenario: 相同時間 bucket 持續成交

- **WHEN** 多筆成交落在相同成交量 bucket
- **THEN** 成交量柱 MUST 更新該 bucket，而不是建立無界數量的重複柱
- **AND** 重送 Tick MUST NOT 重複增加成交量

### Requirement: 分時模式必須顯示來源與市場狀態

分時圖 MUST 顯示 Shioaji 即時、行情中斷、資料過期、Yahoo 延遲備援、收盤整理或已收盤等狀態；只有新鮮 Shioaji Tick 可使用即時標示。

#### Scenario: 即時來源正常

- **WHEN** Shioaji snapshot 新鮮且市場為 open
- **THEN** 分時圖 MUST 顯示「即時」與實際來源時間

#### Scenario: 閘道中斷

- **WHEN** 分時圖已顯示資料但 Shioaji 連線過期
- **THEN** 圖形 MUST 保留最後有效資料
- **AND** 狀態 MUST 改為中斷或過期
- **AND** Yahoo 僅能作延遲備援，不能生成偽逐筆路徑或繼續標示即時

#### Scenario: 收盤後查看

- **WHEN** 一般交易已結束且使用者選擇分時
- **THEN** 系統 MUST 顯示最近完成 session 的分時資料或明確的無可用資料狀態
- **AND** MUST 顯示「已收盤」而不是「即時」

### Requirement: 分時模式必須維持多圖與生命週期邊界

同一頁面 MUST 只使用一條 page-scoped 即時連線 multiplex 所有可見分時與 K 線 panel；隱藏頁面、換頁、換商品、切回 K 線或銷毀 panel 時 MUST 更新訂閱或停止無用繪圖。

#### Scenario: 八圖包含多個分時 panel

- **WHEN** 八圖頁面有多個台股 panel 選擇分時
- **THEN** 瀏覽器 MUST 共用同一條即時連線
- **AND** 每個 panel MUST 只接收或處理其 canonical symbol 的資料

#### Scenario: 頁面進入背景

- **WHEN** document 變為 hidden
- **THEN** 系統 MUST 降低非必要重繪與資料處理
- **AND** 回到前景時 MUST 先取得 latest snapshot 或缺口補齊再恢復繪圖

### Requirement: 分時模式不得套用不相容的 K 線工具

分時模式 MUST 暫停或隱藏僅對 candlestick 週期有意義的主圖工具與技術指標繪圖，但 MUST 保存使用者原設定，切回日週月 K 線後完整恢復。

#### Scenario: K 線已啟用費波那契或技術副圖

- **WHEN** 使用者從日週月 K 線切換到分時
- **THEN** 分時主圖 MUST 不套用 K 線 anchor、pivot、volume profile 或 K 線技術指標
- **AND** 系統 MUST 保存原設定
- **AND** 切回 K 線時 MUST 恢復原工具與副圖，不得重設偏好
