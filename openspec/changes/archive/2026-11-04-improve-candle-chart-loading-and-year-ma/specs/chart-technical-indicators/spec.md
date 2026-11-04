## MODIFIED Requirements

### Requirement: 主圖組合指標必須保留 RealTimeStock 既有能力
系統 MUST 提供參考均線組、BOLL、Volume MA、FVG、K 線固定區間 Volume Profile 及 Traditional Pivot Point。這些指標 MUST 使用目前圖表依 time 排序的 candles 計算；近期資料沿用 Shioaji，1D 可依 `main-chart-daily-history-display` 合併通過時間、單位與重疊價格驗真的展示專用本機日線前綴。系統 MUST NOT 另外呼叫來源 repo、Cloudflare、D1 或未授權市場資料服務，也不得將展示前綴當成分鐘／盤中量比／盤後基準。既有額外指標與自訂指標 MUST 保持可選且不得被移除或改名。

#### Scenario: 顯示參考均線組
- **WHEN** 使用者新增「參考均線組」
- **THEN** 主圖 MUST 同時顯示使用 close 計算的 SMA5、SMA10、SMA20、SMA60、SMA120、SMA240（年線）
- **AND** 每條線 MUST 在累積對應期數前維持 whitespace
- **AND** 使用者仍可另外新增既有單線 SMA、EMA 或 WMA

#### Scenario: 顯示 BOLL
- **WHEN** 使用者以預設 period=20、multiplier=2 新增 BOLL
- **THEN** 中軌 MUST 為最近二十根 close 的 SMA，上下軌 MUST 使用同 window 母體標準差的正負兩倍
- **AND** 固定 fixture 的第一組 upper／middle／lower MUST 分別為 20.830952／15／9.169048

#### Scenario: 顯示成交量與 Volume MA
- **WHEN** 使用者啟用 Volume MA 且目前圖表顯示成交量柱
- **THEN** 系統 MUST 透過 definition render metadata 在相同 `vol` price scale 顯示 Volume SMA5、SMA10 與 SMA20
- **AND** 合法的零成交量 MUST 納入期數與平均
- **AND** 期數不足時 MUST 維持 whitespace，不得把缺值當零

#### Scenario: 既有均線組補上年線設定
- **WHEN** 使用者開啟先前保存的參考均線組設定
- **THEN** 系統 MUST 顯示可調整的 SMA240 年線 output，保留其他均線及原樣式設定
