# multiview-minute-kline Specification

## Purpose
TBD - created by archiving change align-chart-tools-and-add-multiview-minute-klines. Update Purpose after archive.
## Requirements
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

### Requirement: 分鐘時框必須沿用一般 Candlestick 與圖表工具管線
1m、5m、15m、60m MUST 使用與日 K 相同的 Candlestick、volume、crosshair readout、跨日分隔、history paging、viewport coordinator、主副圖 indicator、Pivot、Fibonacci、autoscale、panel cache 與完整 panel PNG pipeline。系統 MUST NOT 套用既有 `intraday` 成交價／均價折線的 `is-intraday` 限制或隱藏 K 線工具。

#### Scenario: 分鐘圖使用 Pivot
- **WHEN** 使用者在 MultiView 的分鐘 K panel 啟用 Pivot
- **THEN** Worker MUST 使用相同商品、provider 與市場時區的 daily-based OHLC 建立 reference projection
- **AND** MUST NOT 使用單根分鐘 K 或不完整畫面窗口代替完整交易日

#### Scenario: 分鐘圖使用 Fibonacci 與技術指標
- **WHEN** 使用者在分鐘 K 建立 Fibonacci 或啟用合法主副圖 indicator
- **THEN** Fibonacci MUST 依 `canonical symbol + interval` 保存並隨 viewport 重繪，indicator MUST 依目前完整 candle set latest-wins 重算
- **AND** 切換時框或較新 generation 勝出時，舊 overlay、series 與 helper MUST 完整清理

#### Scenario: 匯出分鐘 K panel
- **WHEN** 分鐘 K 顯示 Pivot、Fibonacci、volume 或副圖並執行完整 panel PNG
- **THEN** 匯出 MUST 包含當下可見的 K 棒、readout、合法 overlay 與副圖
- **AND** MUST NOT 包含其他 panel、已收合選單或舊 `intraday` 折線

### Requirement: 分鐘 K 必須通過本機 simulation 可見驗收且不擴張遠端權限
本 change MUST 在 `127.0.0.1:5174`、Shioaji simulation 與既有本機 adapter 上驗證 1／2／4／8 panel、四個分鐘時框、重複商品、快速切換、跨日、斷線 fallback、Pivot、Fibonacci、指標與 console。驗收 MUST 記錄安全摘要與 reason code，不得保存完整行情 payload、帳戶、credential 或個人識別；Cloudflare／Sites、production 與真實下單 MUST 保持不在範圍。

#### Scenario: 本機完整可見驗收
- **WHEN** simulation session 具有合法 Kbars 與 Tick，使用者依序切換 1m、5m、15m、60m、日並操作圖表工具
- **THEN** 每個 panel MUST 顯示正確 timeframe、來源狀態、OHLCV、即時尾端、Pivot、Fibonacci 與指標
- **AND** console MUST 無未處理錯誤，頁面級 SSE 與同商品 Kbars request MUST 維持去重

#### Scenario: 遠端與交易能力不擴張
- **WHEN** 執行 production build、OpenSpec validation 或本機驗收
- **THEN** Cloudflare／Sites realtime capability、production mode 與真實下單 MUST 維持關閉
- **AND** 驗收 MUST NOT 要求部署、帳戶、多帳戶或正式站證據

### Requirement: MultiView 分鐘 K 必須繪製亮黃色跨日分隔線
本機 MultiView 的 `1m`、`5m`、`15m`、`1h` Candlestick MUST 依相鄰 canonical candles 的 `Asia/Taipei` 日期變化，在前一日期最後一根與下一日期第一根 K 的 X 座標中點繪製 1.2 CSS px 亮黃色分日線。分日線 MUST 使用獨立 semantic color 並對齊主圖、成交量及所有可見技術 pane；既有 `intraday` 分時走勢與日／週／月 K MUST NOT 套用。

#### Scenario: 分鐘 K 跨越兩個日期
- **WHEN** MultiView 的分鐘 K 資料包含前一台北日期最後一根與下一台北日期第一根 candle
- **THEN** 系統 MUST 在兩根 K 的 X 座標中點顯示 1.2 CSS px 亮黃色分日線
- **AND** 線條 MUST 位於資料背景、不穿過任一根 candle 中心，也不得改變 OHLCV、autoscale、crosshair 或 pointer 工具

#### Scenario: 同日資料缺口與不適用時框
- **WHEN** 相鄰分鐘 K 有時間缺口但台北日期相同，或目前為 `intraday`、`1d`、`1wk`、`1mo`
- **THEN** 系統 MUST NOT 因該缺口或相鄰 candle 日期建立本 capability 的分日線
- **AND** 既有格線、分時線與日週月時間軸 MUST 維持不變

#### Scenario: 主圖、成交量與副圖同步
- **WHEN** panel 同時顯示 Candlestick、volume 與一個以上技術 pane
- **THEN** 每條分日線 MUST 在所有可見 pane 使用相同 X 座標、亮黃色語意色及 1.2 CSS px 視覺寬度
- **AND** pane 建立、移除、重排或 selection 不變的重算 MUST NOT 產生重複、偏移或殘留 primitive

#### Scenario: 歷史補載與 viewport 生命週期
- **WHEN** 系統 prepend 跨日 Kbars，使用者平移、縮放、resize、快速切換商品／時框，或 panel 被銷毀重建
- **THEN** primitive manager MUST 依目前 generation 的 canonical candles 與 time scale 重新計算可見位置
- **AND** 舊 generation、舊 panel 或已 detach primitive MUST NOT 寫回目前畫面

#### Scenario: 多圖與完整 panel 匯出
- **WHEN** 使用者在 1／2／4／8 panel 檢視跨日分鐘 K，或匯出含主圖與副圖的完整 panel PNG
- **THEN** 每個 panel MUST 只呈現自身商品與時框的分日線，匯出結果 MUST 包含可見亮黃色分日線
- **AND** console MUST 無未處理錯誤，其他 panel 的 boundary 或座標 MUST NOT 混入
