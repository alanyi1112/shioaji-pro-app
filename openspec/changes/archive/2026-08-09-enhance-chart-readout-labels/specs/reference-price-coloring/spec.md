## MODIFIED Requirements

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
