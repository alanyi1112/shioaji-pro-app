## ADDED Requirements

### Requirement: 台股逐筆報價必須公開可辨識的來源狀態

系統 MUST 在台股盤中 quote 中公開正規化的 realtime provider、gateway state、source quote time、received time 與 freshness；只有新鮮 Shioaji Tick 可使用「即時」，Yahoo 或其他輪詢來源 MUST 標示為延遲或備援。

#### Scenario: 新鮮 Shioaji Tick

- **WHEN** quote 來自已驗證閘道且來源時間仍在即時門檻內
- **THEN** `quote.kind` MUST 為 `intraday`
- **AND** `quote.marketPhase` MUST 為 `open`
- **AND** provider state MUST 可辨識為 `shioaji / live`
- **AND** 價格列 MUST 顯示「即時」與台北來源時間

#### Scenario: Yahoo 盤中備援

- **WHEN** Shioaji 不可用且盤中 quote 改由 Yahoo 提供
- **THEN** `quote.kind` MAY 維持 `intraday`
- **AND** provider state MUST 可辨識為 Yahoo fallback
- **AND** 價格列 MUST 顯示「延遲備援」或同等文案
- **AND** MUST NOT 顯示「即時」

### Requirement: 日週月逐筆更新必須沿用相同報價生命週期

台股日、週、月 K 線的逐筆 overlay MUST 共用相同的 source time、market phase、freshness、fallback 與價格動畫判定；週期切換不得把過期來源重新標示為即時。

#### Scenario: 相同 Tick 更新日週月

- **WHEN** 同一商品的新鮮 Tick 同時影響日、週、月最後一根 K
- **THEN** 三個週期的 quote source time、latest price 與 provider state MUST 一致
- **AND** 盤中實際價格改變時 MAY 顯示既有價格更新動畫

#### Scenario: 切換週期時來源已過期

- **WHEN** 使用者從日切換到週或月時閘道來源已 stale
- **THEN** 新週期 MUST 沿用 stale／fallback 狀態
- **AND** MUST NOT 因重新建立 panel 而顯示新的「即時」動畫或時間

### Requirement: 即時來源時間不得由接收時間冒充

系統 MUST 以 Shioaji 提供的台北成交時間作為 `sourceQuoteTime`，Cloudflare 或瀏覽器接收時間只能用於延遲診斷；缺少有效來源時間的資料不得驅動即時 K 棒或分時走勢。

#### Scenario: 微批次延遲到達

- **WHEN** Cloudflare 接收時間晚於來源時間
- **THEN** UI MUST 顯示來源成交時間
- **AND** health MAY 顯示安全的延遲值
- **AND** MUST NOT 使用接收時間改寫 Tick 的 session 或排序

#### Scenario: Tick 缺少合法來源時間

- **WHEN** 正規化 Tick 沒有可解析的台北來源日期時間
- **THEN** 系統 MUST 拒絕該 Tick 作為即時更新
- **AND** MUST 保留上一個有效狀態或降級備援
