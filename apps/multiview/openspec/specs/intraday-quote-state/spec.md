# intraday-quote-state Specification

## Purpose
TBD - created by archiving change improve-intraday-quote-status-display. Update Purpose after archive.
## Requirements
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

### Requirement: 休市顯示不得降級最近交易日核對結果

系統 MUST 將目前市場是否休市與最近交易日報價的 verification 分開處理。台股週末或可由既有市場 metadata 證明的休市日，價格列 MUST 顯示「休市」；若最近一個 `sessionDate` 已通過官方核對，系統 MUST 保留該 verification，且 MUST NOT 只因台北日期跨日或市場未開盤而改成 `unverified` 或顯示「未驗證」。真正的 stale cache 或 verifier 失敗仍 MUST 依既有優先順序顯示。

#### Scenario: 星期六顯示前一交易日已核對收盤
- **WHEN** 台北時間為星期六，台股最近一個 `sessionDate` 是星期五且 verification 已完成
- **THEN** 價格列 MUST 顯示星期五來源時間與「休市」
- **AND** verification metadata MUST 保留星期五的成功結果
- **AND** 可見文案 MUST NOT 顯示「未驗證」

#### Scenario: 星期日顯示休市
- **WHEN** 台北時間為星期日且最近報價仍是上一個有效交易日
- **THEN** 價格列 MUST 顯示「休市」
- **AND** 系統 MUST NOT 因報價日期不是台北當日而重新啟動或降級收盤核對

#### Scenario: 休市時仍優先顯示真正過期資料
- **WHEN** 市場休市且目前只能取得已超過既有 freshness 門檻的 stale cache
- **THEN** 系統 MUST 保留「資料過期」等既有警示
- **AND** tooltip 或狀態 metadata MUST 仍可辨識目前為休市

### Requirement: 價格更新動畫必須只表示盤中實際價格變動

系統 MUST 只有在同一圖表已呈現過有效價格、最新價格相較前一次呈現值實際改變，且正規化市場狀態仍為交易中時，才顯示商品報價欄的價格更新動畫。初次載入、相同價格重送、`quote.kind = session-close` 或市場已收盤時 MUST NOT 顯示紅／綠底更新動畫；收盤核對與資料品質文字 MUST 繼續正常更新。

#### Scenario: 盤中價格實際變動

- **WHEN** 同一台股圖表已呈現有效價格
- **AND** 後續盤中 payload 的最新價格與前一次呈現值不同
- **AND** 正規化市場狀態為 `open` 且 `quote.kind` 不是 `session-close`
- **THEN** 商品報價欄 MUST 依既有漲跌方向顯示一次短暫更新動畫

#### Scenario: 串流重送相同盤中價格

- **WHEN** `/api/stream` 重送同一台股商品的最新 candle
- **AND** 最新價格與前一次呈現值相同
- **THEN** 商品報價欄 MUST NOT 再次顯示價格更新動畫

#### Scenario: 台股收盤後收到相同或更正資料

- **WHEN** 正規化市場狀態不是 `open` 或 `quote.kind = session-close`
- **THEN** 系統 MUST 更新價格、漲跌與核對狀態等可見資料
- **AND** 商品報價欄 MUST NOT 顯示紅／綠底更新動畫
- **AND** 已完成官方核對時 MUST 繼續顯示「已核對」

#### Scenario: 圖表初次載入

- **WHEN** panel 尚未呈現過可比較的有效價格
- **THEN** 系統 MUST 顯示最新價格與狀態
- **AND** 商品報價欄 MUST NOT 將初次載入誤表示為價格更新

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
