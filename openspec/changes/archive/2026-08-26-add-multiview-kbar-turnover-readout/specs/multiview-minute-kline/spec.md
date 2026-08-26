## MODIFIED Requirements

### Requirement: 本機 MultiView 必須以 canonical 1 分 Kbars 建立分鐘 K 歷史
本機 MultiView MUST 透過既有 simulation-only local Shioaji adapter 取得指定商品與日期範圍的合法 1 分 Kbars，保留每根 `time`、`open`、`high`、`low`、`close`、`volume`、精確`turnoverTwd`或其unavailable狀態與來源狀態，並以 `canonical symbol + start + end + source identity + turnover schema revision` page-scoped single-flight 去重。同商品多 panel 或涵蓋範圍的時框切換 MUST 重用相同revision的已載入資料；系統 MUST NOT 以固定輪詢 Kbars 取代訂閱行情，也不得把舊OHLCV-only cache冒充新schema。

#### Scenario: 載入各分鐘時框的歷史範圍
- **WHEN** 使用者選擇 1m、5m、15m 或 60m
- **THEN** 系統 MUST 取得足以建立該時框既定資料窗的 canonical 1 分 Kbars，預設分別涵蓋 3、7、30、60 日
- **AND** 較短範圍已被同商品、同source identity及同schema revision的較長快取涵蓋時 MUST 不重複呼叫 Kbars

#### Scenario: 八個 panel 含重複商品
- **WHEN** 同頁多個 panel 同時要求同商品相同或重疊日期範圍
- **THEN** 相同 range key MUST 最多有一個進行中的 Kbars request
- **AND** 所有 consumer MUST 收到各自 generation 合法且含turnover availability的不可變 candle snapshot

#### Scenario: Bootstrap 回應不合法或超限
- **WHEN** Kbars 缺少 OHLCV、時間倒序、包含非有限價格、超過 response size guard 或 adapter 不是 simulation
- **THEN** 系統 MUST 拒絕該 bootstrap 並顯示安全 reason code
- **AND** MUST NOT 建立零值 K、假 candle、production 連線或真實下單能力

#### Scenario: Amount缺漏但OHLCV合法
- **WHEN** Kbars的`Amount`缺漏、長度與datetime不一致或某列不是非負safe integer元值，但OHLCV與Volume合法
- **THEN** 系統 MUST 保留合法candle並把受影響成交值標示為unavailable
- **AND** MUST NOT 以close、average price或volume推算成交值

### Requirement: 5／15／60 分 K 必須由同一份 1 分 K 依交易日聚合
系統 MUST 以 `Asia/Taipei` 交易日內的 canonical 1 分 K 聚合 5／15／60 分 bucket；open MUST 取 bucket 第一根實際 K、high／low MUST 取極值、close MUST 取最後一根、volume MUST 加總一次。只有bucket內每根實際candle的`turnoverTwd`均合法時成交值才 MUST 完整加總，任一缺漏或溢位時該bucket成交值 MUST 為unavailable。bucket MUST 以實際第一根 minute time 表示，不得跨交易日或以缺少資料的分鐘補造交易。

#### Scenario: 聚合完整分鐘 bucket
- **WHEN** 同一交易日內連續 canonical 1 分 K 落在同一個 5、15 或 60 分 bucket，且每根成交值均合法
- **THEN** 聚合 OHLCV與成交值 MUST 與對該 minute set 執行 full recompute 的結果相同
- **AND** candle time MUST 使用 bucket 第一根實際 1 分 K 的 time

#### Scenario: 跨日不得合併
- **WHEN** 依時間相鄰的兩根 1 分 K 分屬不同 `Asia/Taipei` 交易日
- **THEN** 後一根 MUST 開始新的 bucket
- **AND** 前一日未滿長度的最後 bucket MUST 保留實際 OHLCV與完整可用的成交值，不得與次日資料合併

#### Scenario: 資料缺口不得補造
- **WHEN** 1 分歷史在某 bucket 內缺少一個以上分鐘
- **THEN** 聚合 MUST 只使用實際存在的合法 K 並將 continuity 標示為 partial；成交值只在這些實際candle全部可用時加總
- **AND** 系統 MUST NOT 複製前價、補零 volume、估算成交值或建立不存在的 1 分 K

#### Scenario: Bucket內成交值不完整
- **WHEN** bucket內任一實際1分K的`turnoverTwd`為unavailable或加總超過safe integer
- **THEN** 聚合candle的成交值 MUST 為unavailable
- **AND** 其他合法OHLCV與continuity MUST 保持正確

### Requirement: Tick 必須只更新目前未完成分鐘 bucket
完成 Kbars bootstrap 後，系統 MUST 依合法 Tick 的 source time、sequence、close、total-volume delta及可信`amount／total_amount`增量更新目前未完成 1 分 bucket，再由 canonical 1 分尾端重聚合目前 5／15／60 分 bucket。第一筆 Tick close MUST 建立或延續 open，high／low MUST 取已接受成交價極值，close MUST 取最新接受值，volume與成交值 MUST 不與bootstrap重複計入；成交值失效 MUST NOT 阻止合法price與volume更新。

#### Scenario: Bootstrap 後接續同分鐘 Tick
- **WHEN** 最新 bootstrap K 與後續 Tick 落在同一分鐘，且累計volume與turnover均合法推進
- **THEN** 系統 MUST 保留 bootstrap open，合併 high／low／close並只加入bootstrap尚未包含的volume與turnover delta
- **AND** 1m 及目前較長分鐘 bucket MUST 由相同 canonical 尾端更新

#### Scenario: 新分鐘第一筆 Tick
- **WHEN** 合法 Tick source time 進入下一個 minute bucket
- **THEN** 系統 MUST 完成前一 bucket 並以該 Tick close 建立新 bucket 的 open／high／low／close
- **AND** 新 bucket volume與成交值 MUST 只使用非負、未重複且通過各自availability契約的增量

#### Scenario: 倒序重送與舊 session
- **WHEN** Tick 的 source time／sequence 不晚於已接受事件、session date 早於目前 session、價格不合法或 total volume倒退
- **THEN** 系統 MUST 丟棄該更新並保留目前 candle set
- **AND** 舊 generation、舊商品與舊 interval MUST NOT 更新目前 panel

#### Scenario: 成交值欄位不可信但price與volume合法
- **WHEN** Tick的price與total volume合法，但`amount／total_amount`缺漏、非法、倒退或對連續sequence互相矛盾
- **THEN** 系統 MUST 依既有契約更新price與volume，並將forming成交值chain標示為unavailable
- **AND** MUST NOT 以price乘volume、重送、輪詢或其他欄位猜補
