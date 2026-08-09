# reference-price-coloring Specification

## Purpose
TBD - created by archiving change compact-kline-quote-summary-reference-colors. Update Purpose after archive.
## Requirements
### Requirement: 價位方向必須以可靠參考價統一判斷
系統 MUST 以同一個價位方向規則比較數值與可靠的昨收／參考價：高於參考價為 up、低於參考價為 down、相等為 flat。參考價缺少、無效或不適用時 MUST 回傳 flat，不得依欄位名稱、買賣側或推測資料指定方向。

#### Scenario: 價位高於、低於或等於參考價
- **WHEN** reference 為 193.00，價位分別為 199.00、188.50 與 193.00
- **THEN** 系統 MUST 分別判定為 up、down 與 flat

#### Scenario: 參考價無效
- **WHEN** reference 缺少、不是有限數字或小於等於零
- **THEN** 價位方向 MUST 為 flat
- **AND** 系統 MUST NOT 以零、目前價或前一根 candle close 代替

#### Scenario: 套用目前配色慣例
- **WHEN** 價位方向為 up 或 down
- **THEN** 系統 MUST 使用目前 theme 的 up/down token
- **AND** 預設台股配色 MUST 呈現紅漲綠跌
- **AND** 使用者已明確選擇國際配色時 MUST 保留其既有慣例

### Requirement: 行情摘要的價位欄位必須相對參考價判色
非指數行情摘要中的開、高、低、漲停、跌停、委買與委賣價位 MUST 分別和 `ContractInfo.reference` 比較。指數行情摘要中的開、高、低 MUST 和目前有效的 `index.reference` 比較。

#### Scenario: 股票摘要逐欄判色
- **WHEN** reference=193.00、open=193.50、high=199.00、low=188.50、bid=188.50、ask=189.00
- **THEN** open 與 high MUST 使用 up 樣式
- **AND** low、bid 與 ask MUST 使用 down 樣式
- **AND** 系統 MUST NOT 因欄位是 high 或 bid 就固定使用 up，也不得因欄位是 low 或 ask 就固定使用 down

#### Scenario: 參考價與非價位欄位
- **WHEN** 行情摘要顯示 reference、volume、bid volume、ask volume 或 time
- **THEN** reference MUST 使用 flat 樣式
- **AND** volume 與 time 類欄位 MUST 使用中性色，不得和 reference 比較

#### Scenario: 指數市場統計
- **WHEN** 指數摘要顯示上漲、平盤、下跌、漲停或跌停家數
- **THEN** 這些 count MUST 保留其 category 語意色
- **AND** count MUST NOT 和指數 reference 價格比較

### Requirement: 主要最新價與軸標籤必須使用相同方向
商品資訊區的主要最新價、漲跌、漲跌幅，以及 K 線圖右側最新價標籤 MUST 由同一可靠 reference 得出一致方向。這項變更 MUST NOT 改變 candlestick body、wick、border 或 volume series 的顏色規則。

#### Scenario: 最新價低於參考價
- **WHEN** 最新價為 189.00 且 reference 為 193.00
- **THEN** 主要最新價、漲跌、漲跌幅與右側最新價標籤 MUST 全部使用 down 樣式
- **AND** 當前 candlestick 本體仍 MUST 依自己的 open/close 關係著色

#### Scenario: 最新價等於參考價
- **WHEN** 最新價等於有效 reference
- **THEN** 主要最新價與右側最新價標籤 MUST 使用 flat 樣式

### Requirement: K 棒價量回報的價位必須在基準可靠時判色
K 棒價量 readout 的開、高、低、收／最新欄位 MUST 在可取得該 candle 所屬交易日／交易時段的可靠基準時逐欄判色；時間與量 MUST 維持中性色。當日 STK、IND、WRT MUST 使用目前有效的 contract／index reference；歷史 STK、IND、WRT MUST 使用圖表已載入 canonical 原始 1 分 K 所建立的前一個 completed trading session 最後收盤價。系統 MUST NOT 使用目前交易日 reference、同交易日上一根 candle close、未完成 session 或推測值代替。K 棒時間區間與價量 readout MUST 維持在顯示數值區最上方。

#### Scenario: 當日股票 K 棒
- **WHEN** 游標位於台灣今日的 STK、IND 或 WRT candle，且目前 reference 有效
- **THEN** open、high、low、close／latest MUST 各自和 reference 比較後著色
- **AND** time range 與 volume MUST 維持中性色

#### Scenario: 歷史股票 K 棒由已載入前一交易日判色
- **WHEN** 游標位於歷史 STK、IND 或 WRT candle，且已載入原始 K 棒包含該交易日及前一個不同交易日的完整資料
- **THEN** 系統 MUST 以前一交易日最後一根有效原始 candle 的 close 作為該日昨收
- **AND** open、high、low、close MUST 各自和該歷史昨收比較後著色
- **AND** 週末或休市日畫面上的最新 completed session MUST 適用相同規則

#### Scenario: 載入範圍第一個歷史交易日缺少昨收
- **WHEN** 游標位於目前已載入範圍的第一個 STK、IND 或 WRT 交易日，且前一交易日原始 K 棒尚未載入
- **THEN** open、high、low、close MUST 全部使用 flat 樣式
- **AND** 系統 MUST NOT 使用今天 reference、同日上一根 candle close 或推測值冒充該日昨收

#### Scenario: prepend 後補齊歷史昨收
- **WHEN** 歷史 prepend 新增原本第一個交易日之前的完整交易日資料，且 crosshair 仍停在原 candle
- **THEN** 系統 MUST 重新建立該圖的交易日昨收索引
- **AND** readout MUST 在有界更新週期內由 flat 改為依新取得昨收判色
- **AND** 舊商品或時框 generation 的索引 MUST NOT 寫回目前圖表

#### Scenario: 期貨或選擇權無法判定交易時段
- **WHEN** candle 屬於 FUT 或 OPT，且不是可證明仍 forming 且目前 reference 適用的最新 candle
- **THEN** readout 價位 MUST 使用 flat 樣式
- **AND** 系統 MUST NOT 只依日曆日期從原始 K 棒建立歷史昨收

#### Scenario: 游標從當日移到歷史 K 棒
- **WHEN** crosshair 從可判色的當日 candle 移至具有歷史昨收或缺少昨收的歷史 candle
- **THEN** readout MUST 在同一個有界更新週期內套用該歷史昨收或改為 flat
- **AND** 當日 candle 的方向 class MUST NOT 殘留於歷史數值

### Requirement: 非價位紅綠語意不得被參考價規則覆寫
系統 MUST 僅把參考價方向套用到價格數值。成交量、時間、技術指標線、K 棒與成交量柱、買賣操作、損益與市場家數統計 MUST 保留各自既有語意。

#### Scenario: 顯示技術指標與委託操作
- **WHEN** K 線圖同時顯示 MA、BOLL、MACD、買進／賣出操作或持倉損益
- **THEN** 這些項目的顏色 MUST NOT 因商品 reference 改變
- **AND** 系統 MUST NOT 對非價格 count 或 volume 呼叫價位方向比較
