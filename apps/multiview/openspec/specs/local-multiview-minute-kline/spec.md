# local-multiview-minute-kline 規格

## Purpose

定義本機 MultiView 的分鐘 K interval、simulation-only Shioaji 歷史與即時聚合契約，同時維持遠端部署與真實交易能力關閉。

## Requirements

### Requirement: 本機 MultiView 必須提供固定的分鐘與日週月 K interval 契約

本機 MultiView MUST 允許 canonical `1m`、`5m`、`15m`、`1h`、`1d`、`1wk`、`1mo`，UI MUST 依序顯示 1m、5m、15m、60m、日、週、月。既有合法的 `1wk`、`1mo` 設定 MUST 保留；`intraday` 或其他非法本機 interval MUST 回退 `1d`，不得改動商品、panel 順序、指標或註記。Cloudflare／Sites MUST 維持既有遠端 allowlist 與 feature-off 行為。

#### Scenario: 本機選單與 canonical 60m
- **WHEN** 使用者開啟本機 MultiView 並選擇畫面上的 60m
- **THEN** 選單 MUST 恰好顯示 1m、5m、15m、60m、日、週、月
- **AND** URL、cache、batch、stream 與 candle API MUST 使用 canonical `1h`

#### Scenario: 多圖工具列保留時間週期標籤
- **WHEN** 使用者切換為 1、2、3、4、6 或 8 個圖表
- **THEN** 每個 panel MUST 完整顯示目前選取的 1m、5m、15m、60m、日、週或月
- **AND** 商品名稱可使用省略號，但時間週期 MUST NOT 被壓縮成空白欄位或只剩下拉箭頭

#### Scenario: 遠端部署不開啟分鐘能力
- **WHEN** Cloudflare 或 Sites runtime 回傳 config 與 interval
- **THEN** MUST NOT 因本機能力回傳 Shioaji 分鐘 K 或 realtime capability
- **AND** 本規格 MUST NOT 新增部署、多帳戶或 production 驗收 gate

### Requirement: 本機分鐘 K 必須來自 canonical 1 分 Shioaji Kbars

本機 simulation coordinator MUST 依 1m 3 日、5m 7 日、15m 30 日、60m 60 日取得 canonical 1 分 Kbars，以 `symbol + start + end` page-scoped single-flight 與涵蓋範圍 cache 去重，並保留完整 OHLCV、來源狀態與不可變 snapshot。系統 MUST NOT 以固定 Kbars 輪詢或 production session 取代既有頁面級 SSE。

#### Scenario: 同商品多 panel 共用歷史
- **WHEN** 同頁多個 panel 要求同商品相同或被較長範圍涵蓋的分鐘歷史
- **THEN** 相同 range MUST 最多建立一個 Kbars request
- **AND** 每個 panel MUST 只接受目前 generation 的不可變資料

#### Scenario: simulation guard
- **WHEN** adapter 不是 simulation、回應超限或 OHLCV 不合法
- **THEN** 系統 MUST 拒絕 bootstrap 並顯示安全 reason
- **AND** MUST NOT 建立零值 K、production 連線或真實下單能力

### Requirement: 5／15／60 分 K 必須依台北交易日聚合

系統 MUST 以 `Asia/Taipei` 交易日內的 canonical 1 分 K 聚合 5／15／60 分；open 取第一根、high／low 取極值、close 取最後一根、volume 只加總一次，並以 bucket 第一根實際 minute time 表示。跨日 MUST 切 bucket，缺少分鐘 MUST 標示 partial 且不得補造 candle。

#### Scenario: 跨日與缺口
- **WHEN** 相鄰資料跨交易日或 bucket 中缺少分鐘
- **THEN** 跨日資料 MUST 分屬不同 bucket，缺口 bucket MUST 只使用實際 K 並標示 partial
- **AND** MUST NOT 複製前價、補零量或建立不存在的 1 分 K

### Requirement: Tick 尾端必須沿用一般 Candlestick pipeline

合法 Tick MUST 依 source time 與 sequence 更新目前 canonical 1 分 K 的 OHLC，並只加入未被 bootstrap 計入的 total-volume delta，再重聚合目前 5／15／60 分 provisional bucket。分鐘時框 MUST 使用一般 Candlestick、volume、readout、viewport、Pivot、Fibonacci、技術指標、autoscale 與完整 panel PNG，不得依賴舊 `intraday` 折線分支。

#### Scenario: 倒序、重送與 atomic fallback
- **WHEN** Tick 倒序、重送、屬於舊 session、價格非法、成交量倒退或較舊 generation
- **THEN** 系統 MUST 拒絕更新並保留目前完整 candle set
- **AND** 自動模式 fallback MUST 原子使用完整 Yahoo payload，強制 Shioaji MUST 顯示 unavailable，不得混接兩個 provider 的 OHLCV

#### Scenario: 分鐘圖使用 Pivot 與 Fibonacci
- **WHEN** 使用者在 1m、5m、15m 或 60m 啟用 Pivot、Fibonacci 或技術指標
- **THEN** Pivot MUST 另取同 provider 與時區的 daily reference，Fibonacci MUST 依 symbol 與 interval 隔離，指標 MUST 依完整 candle set latest-wins 重算
- **AND** 完整 panel PNG MUST 包含目前合法 K 棒、readout、overlay 與副圖
