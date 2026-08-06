## ADDED Requirements

### Requirement: 報價生命週期必須區分盤中與已完成收盤

系統 MUST 以伺服器端正規化的 `marketPhase` 與 `quote.kind` 區分盤中報價、收盤整理中及已完成收盤，不得因上游回傳未知或未列舉的 `marketState` 就把台股當日盤中日 K 判定為 `session-close`。

#### Scenario: 上游明確回傳台股交易中

- **WHEN** 台股主來源明確表示市場處於 `REGULAR`、`OPEN` 或同等交易中狀態
- **THEN** `quote.marketPhase` MUST 為 `open`
- **AND** `quote.kind` MUST 為 `intraday`
- **AND** 價格標籤 MUST 顯示「現價」

#### Scenario: 上游市場狀態未知但當日報價仍在更新

- **WHEN** 上游 `marketState` 未知或不在既有列舉值
- **AND** 台北時間位於台股一般交易時段
- **AND** 最新 `sessionDate` 與 `sourceQuoteTime` 均對應台北當日且未超過容許的新鮮度範圍
- **THEN** 系統 MUST 將報價保守判定為盤中 `intraday`
- **AND** 系統 MUST NOT 啟動官方收盤核對

#### Scenario: 上游市場狀態未知但當日一般交易已結束

- **WHEN** 上游 `marketState` 未知或不在既有列舉值
- **AND** 最新有效 K、`sessionDate` 與 `sourceQuoteTime` 均對應台北當日
- **AND** 台北時間已達 15:00
- **THEN** `quote.marketPhase` MUST 為 `closed`
- **AND** `quote.kind` MUST 為 `session-close`
- **AND** 系統 MUST 啟動該交易日的官方收盤核對

#### Scenario: 休市日落在平日交易時段

- **WHEN** 台北時間落在週一至週五 09:00–13:30
- **BUT** 主來源沒有台北當日 `sessionDate` 或當日 `sourceQuoteTime`
- **THEN** 系統 MUST NOT 只依星期與時鐘判定市場正在交易

### Requirement: 盤中報價不適用收盤核對

系統 MUST 將盤中報價的 `quote.verification.status` 設為 `not_applicable`，reason 設為 `market_open`，且 MUST NOT 呼叫 TWSE、TPEx、TPEx mirror 或其他收盤 verifier。

#### Scenario: 讀取台股盤中日 K

- **WHEN** `/api/candles` 取得台股當日尚未完成的日 K
- **THEN** API MUST 回傳 `quote.kind = intraday`
- **AND** API MUST 回傳 `quote.verification.status = not_applicable`
- **AND** API MUST 回傳 `quote.verification.reason = market_open`
- **AND** 官方第二來源呼叫次數 MUST 為零

#### Scenario: 串流更新台股盤中日 K

- **WHEN** `/api/stream` 推送同一台股商品的盤中 candle
- **THEN** stream quote MUST 與 `/api/candles` 使用相同的 `marketPhase`、`kind`、`sourceQuoteTime` 及 `verification`

### Requirement: 盤中價格列必須顯示主來源報價時間

系統 MUST 在盤中價格列顯示主來源提供的報價日期時間，並依該市場的來源時區格式化；可見文字 MUST NOT 附加「未驗證」、「待核對」或「已核對」。

#### Scenario: 主來源提供盤中報價時間

- **WHEN** 台股盤中 quote 含有效 `sourceQuoteTime` 與 `sourceTimeZone = Asia/Taipei`
- **THEN** 價格列 MUST 顯示 `MM/DD HH:mm` 格式的台北來源時間
- **AND** 窄版 compact 文字 MUST 顯示 `HH:mm`
- **AND** tooltip MUST 說明盤中顯示主來源資料時間，收盤後才進行第二來源核對

#### Scenario: 主來源未提供有效報價時間

- **WHEN** 台股盤中 quote 沒有有效 `sourceQuoteTime`
- **THEN** 系統 MUST 顯示中性的「盤中・時間待確認」或同等文案
- **AND** 系統 MUST NOT 以 Worker 接收時間冒充來源報價時間

### Requirement: 資料新鮮度必須優先於核對適用性

系統 MUST 在所有市場階段保留 freshness 診斷；盤中不適用收盤核對不得隱藏資料過期、來源中斷或 stale cache。

#### Scenario: 盤中只能取得過期快取

- **WHEN** 台股市場仍在交易
- **AND** API 只能回傳 stale payload
- **THEN** 價格列 MUST 顯示來源時間與「資料過期」
- **AND** `data-quote-status` MUST 為 `stale`
- **AND** 系統 MUST NOT 顯示「未驗證」取代 freshness 警示

### Requirement: 收盤整理期間與完成核對必須分開

系統 MUST 在主市場剛結束但官方目標交易日資料尚未發布時使用 `pending` 核對狀態，只有已完成日 K 且第二來源實際失敗時才使用 `unverified`。

#### Scenario: 收盤後官方資料尚未發布

- **WHEN** 台股當日盤中 K 已轉為已完成日 K
- **AND** 官方第二來源尚未發布相同 `sessionDate`
- **THEN** `quote.marketPhase` MUST 為 `closing` 或 `closed`
- **AND** `quote.verification.status` MUST 為 `pending`
- **AND** 可見文案 MUST 顯示「收盤整理中」或「待核對」，不得顯示「未驗證」

#### Scenario: 收盤後第二來源真正不可用

- **WHEN** 報價已是已完成日 K
- **AND** 第二來源因連線失敗、資料無效或未涵蓋商品而無法核對
- **THEN** `quote.verification.status` MUST 為 `unverified`
- **AND** 系統 MUST 保留安全且可診斷的 reason
