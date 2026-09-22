## ADDED Requirements

### Requirement: 可設定籌碼副圖不得保存空的 series 選取
MultiView 對具有 series 選單的籌碼 pane MUST 至少保留一條合法 series。讀取舊版或損壞的空選取、過濾未知 series 後變成空集合，或使用者嘗試取消最後一條 series 時，系統 MUST 回復該 pane 的預設 series 並讓 readout 與圖形使用相同的有效選取；不得呈現「readout 有值但圖形空白」的狀態。

#### Scenario: 載入既有空選取設定
- **WHEN** `localStorage` 對外資、投信、融資、融券、券資比、維持率、大戶或散戶 pane 保存空的 series 陣列
- **THEN** 系統 MUST 將該 pane 正規化為其預設 series，並建立至少一條具有可繪資料的圖形
- **AND** MUST 保留其他 pane 的合法非空自訂選取與排序

#### Scenario: 使用者取消最後一條 series
- **WHEN** 使用者在任一可設定籌碼 pane 嘗試取消最後一條已選 series
- **THEN** 系統 MUST 保留或回復該 pane 的預設 series
- **AND** MUST NOT 保存空陣列或讓 readout 與可見圖形互相矛盾

#### Scenario: 選定欄位來源確實無資料
- **WHEN** payload 有其他籌碼 rows，但該 pane 已選欄位在日期範圍內皆為 `null`
- **THEN** 系統 MUST 顯示真實的無資料或部分資料狀態，且 MUST NOT 把 `null` 補成零值柱狀圖或線圖

## MODIFIED Requirements

### Requirement: 副圖相同 material context 不得重複全量 render
MultiView MUST 將副圖 topology reconciliation、neutral time anchor 更新與 material data render 分開。技術副圖的初次 viewport recovery MUST 重用既有 chart 與 series；籌碼 pane MUST 以排除非可見 refresh metadata 的 payload signature、pane 自身 series／threshold control signature，以及實際 candle date mapping signature 去重。所有 signature 都相同時 MUST NOT 再清除並建立相同 series；candle date mapping 改變時 MUST 使用最後已驗證 payload 在本機重建受影響 series，且 MUST NOT 因此重新呼叫籌碼 API。

#### Scenario: 技術副圖初次 time range 尚未成立
- **WHEN** 技術副圖已有合法 indicator points，但初次 layout 後暫時無法讀取 visible time range
- **THEN** recovery MUST resize 既有 chart 並重新套用主圖 logical range
- **AND** MUST NOT `remove()` chart 或遞迴呼叫完整 indicator render

#### Scenario: 日 K 數值改變但日期映射未變
- **WHEN** 同商品日 K 只更新既有日期的 OHLCV，籌碼 material payload、pane 控制與 candle date mapping 都未改變
- **THEN** manager MUST 只更新必要的 neutral time anchor 或 viewport，且每個既有 pane MUST NOT 全量重建 series
- **AND** 純 layout refresh 或群組重排 MUST NOT 建立第二個 API request

#### Scenario: 日 K 日期映射擴充但籌碼內容未改變
- **WHEN** 同商品日 K 新增或移除日期，使籌碼 row 可映射的 chart time 集合改變，而目前 material payload 未改變
- **THEN** manager MUST 使用最後已驗證 payload 在本機重建受影響 pane 的可繪點
- **AND** MUST NOT 呼叫籌碼 API 或清除最後已驗證 payload

#### Scenario: 籌碼實際資料或 pane 控制改變
- **WHEN** response 的可見資料、availability、warning、pane series 選擇或大戶 threshold 實際改變
- **THEN** 受影響 pane MUST 接受一次新的 material render
- **AND** render 成功前不得提前提交 signature，失敗後仍須允許安全重試
