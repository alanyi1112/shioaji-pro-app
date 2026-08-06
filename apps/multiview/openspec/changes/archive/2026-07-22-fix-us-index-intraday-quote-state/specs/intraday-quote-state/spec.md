## ADDED Requirements

### Requirement: 美股盤中狀態必須以市場時區與來源時間正規化

系統 MUST 以美國市場來源時區、交易時段、最新交易日與來源報價時間共同判定美股日 K 是否仍在盤中；上游 `marketState` 未知時不得直接把當日盤中 K 判定為已完成收盤。

#### Scenario: 美股正常交易時段內來源狀態未知但報價持續更新

- **WHEN** `sourceTimeZone = America/New_York`
- **AND** 紐約當地時間為週一至週五 09:30–16:00
- **AND** 最新 `sessionDate` 與 `sourceQuoteTime` 均為紐約當日，且來源時間仍在容許的新鮮度範圍
- **AND** 上游 `marketState` 為未知或未列舉值
- **THEN** `quote.marketPhase` MUST 為 `open`
- **AND** `quote.kind` MUST 為 `intraday`
- **AND** `quote.verification` MUST 為 `not_applicable / market_open`

#### Scenario: 美股盤中顯示來源最新報價時間

- **WHEN** 美股 quote 的 `marketPhase = open`
- **AND** quote 含有效 `sourceQuoteTime` 與 `sourceTimeZone = America/New_York`
- **THEN** 價格列 MUST 顯示依紐約時區格式化的 `MM/DD HH:mm` 來源報價時間
- **AND** 窄版 compact 文字 MUST 顯示 `HH:mm`
- **AND** 可見文字 MUST NOT 顯示「收盤」、「未驗證」、「待核對」或「已核對」
- **AND** 價格標籤 MUST 顯示「現價」

#### Scenario: 美股來源時間缺失或已過舊

- **WHEN** 上游 `marketState` 為未知或未列舉值
- **AND** `sourceQuoteTime` 缺失、不是紐約當日或超過容許的新鮮度範圍
- **THEN** 系統 MUST NOT 只依星期與當地時鐘判定為 `open`
- **AND** 系統 MUST 保留 `unknown` 或其他有來源證據的市場階段
- **AND** 系統 MUST NOT 將 `unknown` 冒充已完成的 `session-close`

#### Scenario: 美股來源明確表示已收盤

- **WHEN** 上游明確回傳 `closed`、`post`、`afterhours` 或同等已離開正常交易時段的狀態
- **THEN** `quote.marketPhase` MUST 為 `closed`
- **AND** 日 K `quote.kind` MUST 為 `session-close`

#### Scenario: 美股休市日落在一般交易時鐘範圍

- **WHEN** 紐約當地時間落在週一至週五 09:30–16:00
- **BUT** 主來源沒有紐約當日的有效 K 棒與新鮮 `sourceQuoteTime`
- **THEN** 系統 MUST NOT 只依當地時鐘判定市場正在交易
