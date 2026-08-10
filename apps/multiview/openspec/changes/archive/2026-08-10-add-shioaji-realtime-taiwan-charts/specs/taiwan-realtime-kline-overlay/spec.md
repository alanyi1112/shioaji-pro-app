## Purpose

定義台股日、週、月 K 線如何把已完成歷史與 Shioaji 當日逐筆行情合併，讓最右側未完成 K 棒即時變化，同時維持收盤核定、指標一致與來源不可混用。

## ADDED Requirements

### Requirement: 日週月 K 線必須即時更新未完成 K 棒

台股 `1d`、`1wk`、`1mo` 圖在 Shioaji 來源新鮮且市場交易中時，MUST 以最新 Tick 更新最右側未完成 K 棒的 open、high、low、close、volume、來源時間及報價；本能力 MUST NOT 新增或顯示 1 分 K 週期。

#### Scenario: 日 K 收到新成交

- **WHEN** 台股日 K 已載入且收到同一交易日的新鮮 Tick
- **THEN** 最右側日 K MUST 使用今日第一筆為 open、今日最高最低為 high／low、最新成交為 close、今日累計量為 volume
- **AND** K 棒形狀、顏色、最新價標籤與成交量 MUST 在下一個前端更新週期可見變化

#### Scenario: 週 K 與月 K 收到新成交

- **WHEN** 台股週 K 或月 K 已載入且收到今日新鮮 Tick
- **THEN** 最右側 K MUST 保留該週或該月第一個交易日 open
- **AND** high／low MUST 為已完成交易日與今日即時值的極值
- **AND** close MUST 為最新成交價
- **AND** volume MUST 為已完成交易日成交量加上今日即時累計量

#### Scenario: 使用者檢查週期選單

- **WHEN** 本變更啟用
- **THEN** K 線週期 MUST 保留日、週、月
- **AND** MUST NOT 因本變更新增「即時 1 分 K」或其他 1 分 K 選項

### Requirement: 當日 overlay 不得與 provisional 歷史重複計算

系統 MUST 將「最近已完成交易日以前的 canonical history」與「今天 Shioaji realtime overlay」分層；若 Yahoo 或快取已含同一當日／週／月 provisional candle，該 provisional candle MUST 被 overlay 取代而非疊加。

#### Scenario: Yahoo 已含今日 provisional 日 K

- **WHEN** historical payload 已含今日資料且 Shioaji realtime overlay 也對應今日
- **THEN** 畫面 MUST 只存在一根今日 K
- **AND** 今日成交量與 OHLC MUST NOT 同時累加 Yahoo 與 Shioaji

#### Scenario: 週月歷史已含本期 provisional K

- **WHEN** 週或月歷史最後一根已涵蓋今日
- **THEN** 系統 MUST 以已完成日資料重建本期 base，再合併今日 overlay
- **AND** 同一交易日 MUST 只計入一次

### Requirement: Tick 次序與交易日切換必須可重現

系統 MUST 以 canonical symbol、台北來源時間、session date 與序號處理 Tick；較舊或重送 Tick 不得倒退 latest close 或累計量，新的交易日 MUST 建立新日 K 並重設當日聚合。

#### Scenario: 倒序或重送 Tick

- **WHEN** 收到來源時間早於已接受資料或序號未前進的 Tick
- **THEN** 系統 MUST 忽略其 latest close 更新
- **AND** MUST NOT 降低既有日內 high、提高既有 low 或重複累加 volume

#### Scenario: 下一個交易日第一筆成交

- **WHEN** 新鮮 Tick 的 session date 晚於目前 overlay
- **THEN** 系統 MUST 封存或移除前一日 provisional overlay
- **AND** MUST 以新交易日第一筆建立新的日 K
- **AND** 週月 K MUST 依期間邊界決定沿用本期或建立新 K

### Requirement: 即時 overlay 與報價及圖表狀態必須一致

同一 panel 的 K 棒、最新價、漲跌、成交量、quote source time 與 `marketPhase` MUST 來自同一個已接受 realtime snapshot；主圖可逐筆更新，完整技術指標 MAY 有界節流，但不得顯示比主圖更新的來源時間更新卻使用較舊價格。

#### Scenario: 主圖逐筆更新但指標節流

- **WHEN** 即時 Tick 到達速度高於完整指標重算頻率
- **THEN** 主 K 棒、價格列與成交量 MUST 先更新
- **AND** 指標 MAY 在設定的有界週期更新
- **AND** UI MUST NOT 把不同來源時間的價格與 quote metadata 組成同一快照

#### Scenario: 多個 panel 顯示相同商品

- **WHEN** 多圖模式有多個 panel 顯示相同 symbol 與週期
- **THEN** 各 panel MUST 共用同一 realtime snapshot
- **AND** MUST 顯示相同的 latest close、source time 與來源狀態

### Requirement: 收盤後必須移除 overlay 並回到 canonical 歷史

一般交易結束後，系統 MUST 進入既有 closing／closed 與官方核對流程；相同交易日 canonical 日 K 可用後 MUST 取代 realtime overlay，週月 K MUST 由 canonical 日資料重算，且不得將未核定 overlay 永久保存為官方收盤。

#### Scenario: 官方資料尚未發布

- **WHEN** 一般交易已結束但 canonical 日 K 或官方核對尚未完成
- **THEN** 最後 overlay MAY 保留為「收盤整理中」
- **AND** MUST NOT 標示「已核對」

#### Scenario: canonical 日 K 與官方核對完成

- **WHEN** 相同 session date 的 canonical 日 K 可用且既有官方核對完成
- **THEN** 系統 MUST 移除該日 realtime overlay
- **AND** 日週月圖 MUST 改用 canonical history
- **AND** verification metadata MUST 沿用既有正式核對結果

### Requirement: 延遲備援不得冒充逐筆 overlay

Shioaji 失效並切換 Yahoo 時，系統 MAY 更新日週月最後一根 K，但 MUST 將來源標為延遲備援，並以完整 Yahoo provisional candle 取代最後 Shioaji overlay；不得只抽取不同來源欄位混合。

#### Scenario: 盤中切換 Yahoo

- **WHEN** Shioaji 對該商品 stale 或 unavailable 且 Yahoo provisional candle 可用
- **THEN** 系統 MUST 原子切換 provider、OHLCV、quote time 與 freshness 狀態
- **AND** 可見狀態 MUST 顯示「延遲備援」
- **AND** MUST NOT 繼續顯示「即時」
