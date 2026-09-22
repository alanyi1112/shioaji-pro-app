## ADDED Requirements

### Requirement: 資料來源交接必須以時間錨點維持有效 viewport
MultiView 在來源 bootstrap、fallback、重連、換交易日或收盤 canonical handoff 改變 candle 集合時，MUST 以 candle 時間而非舊陣列 logical index 轉換 viewport。轉換後的範圍 MUST 與新資料索引重疊，且 MUST NOT 在資料任一側產生超過既定 right offset 的大面積空白。

#### Scenario: 自動日線由較長 canonical 集合交接到較短 Shioaji 集合
- **WHEN** 目前資料有 524 根 candle，而完整 Shioaji bootstrap 只有 242 根
- **THEN** 系統 MUST 依 242 根資料建立有效可視範圍，不得沿用 524 根資料的 logical 終點
- **AND** 主圖、技術副圖與已掛載籌碼副圖 MUST 使用相同範圍

#### Scenario: 使用者已縮放後發生來源 fallback
- **WHEN** 使用者已接受一個以日期界定的局部 viewport，之後來源切換為不同長度的完整 payload
- **THEN** 系統 MUST 優先保留相同日期區間與 bar spacing
- **AND** 缺少一側日期錨點時 MUST 依可用錨點與原跨度安全收斂，不得跳到不存在的 logical slots

#### Scenario: 未操作的初始 viewport 收到第一筆 snapshot
- **WHEN** 初始 Shioaji bootstrap 已完成且第一筆同交易日 snapshot 更新最後一棒
- **THEN** viewport MUST 保持 bootstrap 後的 canonical 範圍與既定右側空間
- **AND** snapshot MUST NOT 觸發全圖 refit、整包 `setData` 或可見位移
