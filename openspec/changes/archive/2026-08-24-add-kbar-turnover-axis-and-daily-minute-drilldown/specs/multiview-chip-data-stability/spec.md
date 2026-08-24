## ADDED Requirements

### Requirement: 同 context 籌碼刷新不得清除最後一份已驗證資料
MultiView 籌碼 manager MUST 以 canonical symbol、interval、K 棒日期範圍與排序後 dataset 集合建立 request identity。同一商品與週期刷新期間，manager MUST 保留最後一份已驗證 payload，直到新 response 成功；取消、暫時失敗或載入流程短暫傳入空 K 棒 MUST NOT 將大戶持股或其他既有 pane render 成空集合。

#### Scenario: 主圖重新整理期間暫時沒有 candles
- **WHEN** 同一商品與週期開始重新載入，panel 先以空 candles 更新 context，稍後才提交完整 candles
- **THEN** 大戶持股 MUST 保留最後可用線圖與 readout，不得先消失再出現

#### Scenario: 背景刷新暫時失敗
- **WHEN** 同一商品的籌碼刷新 request 失敗，且 manager 已有一份已驗證 payload
- **THEN** 系統 MUST 顯示暫時不可用提示並保留既有大戶持股資料
- **AND** MUST NOT 以 `{ distributionRows: [] }` 覆蓋該 payload

### Requirement: 籌碼重排與相同 identity reconciliation 不得重抓資料
籌碼 pane 增刪、群組重排或 mode reconciliation 後，若 request identity 沒有改變，manager MUST 重用目前 payload，不得重新發出相同 API request。只有 dataset 集合、商品、週期或日期範圍改變，或使用者明確觸發回補 invalidation，才可重新載入。

#### Scenario: 大戶持股群組置頂
- **WHEN** 使用者將包含大戶持股的群組置頂或置底，且資料 identity 未變
- **THEN** manager MUST 以既有 payload 重繪並只執行 layout refresh
- **AND** MUST NOT 清空大戶線圖或重新呼叫籌碼 API

#### Scenario: 切換商品或週期
- **WHEN** canonical symbol 或 interval 改變
- **THEN** manager MUST abort 舊 waiter、清除舊 payload identity 並以新 context 載入
- **AND** MUST NOT 把前一商品的大戶持股顯示在新商品

### Requirement: 副圖相同 material context 不得重複全量 render
MultiView MUST 將副圖 topology reconciliation、neutral time anchor 更新與 material data render 分開。技術副圖的初次 viewport recovery MUST 重用既有 chart 與 series；籌碼 pane MUST 以排除非可見 refresh metadata 的 payload signature，加上 pane 自身 series／threshold control signature 去重。相同 signature MUST NOT 再清除並建立相同 series。

#### Scenario: 技術副圖初次 time range 尚未成立
- **WHEN** 技術副圖已有合法 indicator points，但初次 layout 後暫時無法讀取 visible time range
- **THEN** recovery MUST resize 既有 chart 並重新套用主圖 logical range
- **AND** MUST NOT `remove()` chart 或遞迴呼叫完整 indicator render

#### Scenario: 日 K context 擴充但籌碼內容未改變
- **WHEN** 同商品日 K 日期範圍改變，籌碼 request 回傳與目前 material payload 相同的可見資料
- **THEN** manager MUST 只更新 pane 的 neutral time anchor，且每個既有 pane MUST NOT 全量重建 series
- **AND** 相同 request identity、純 layout refresh 或群組重排 MUST NOT 建立第二個 API request

#### Scenario: 籌碼實際資料或 pane 控制改變
- **WHEN** response 的可見資料、availability、warning、pane series 選擇或大戶 threshold 實際改變
- **THEN** 受影響 pane MUST 接受一次新的 material render
- **AND** render 成功前不得提前提交 signature，失敗後仍須允許安全重試
