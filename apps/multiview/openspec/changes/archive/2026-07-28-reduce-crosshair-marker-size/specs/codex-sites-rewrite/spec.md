## ADDED Requirements

### Requirement: 折線十字準線交點保持緊湊

系統 MUST 將主圖價格折線、技術副圖折線及籌碼副圖折線的原生 crosshair marker 顯示為半徑 2 CSS px、邊框 1 CSS px 的小型圓點，使圓點只略大於 1–2 CSS px 折線且不大面積遮蔽 K 棒、其他折線或讀值。系統 MUST 保留各 series 顏色、既有 marker 顯示條件、費波那契選點期間隱藏行為與跨 pane 十字準線同步。

#### Scenario: 共用十字準線穿過多條主副圖折線

- **WHEN** 使用者將十字準線移至同時具有主圖價格折線、技術副圖折線及籌碼副圖折線資料的日期
- **THEN** 每條可見折線的交點 marker MUST 使用 2 CSS px 半徑與 1 CSS px 邊框
- **AND** marker MUST 保留所屬 series 顏色且不得改變折線線寬、資料或十字準線 X 座標同步
- **AND** 多個 marker 靠近或重疊時 MUST 比原生預設大型圓點少遮蔽底層資訊

#### Scenario: 費波那契選點暫時隱藏主圖 marker

- **WHEN** 使用者正在選取費波那契回撤或拓展錨點
- **THEN** 主圖價格折線 marker MUST 依既有規則暫時隱藏
- **AND** 選點結束或取消後恢復的 marker MUST 維持 2 CSS px 半徑與 1 CSS px 邊框
