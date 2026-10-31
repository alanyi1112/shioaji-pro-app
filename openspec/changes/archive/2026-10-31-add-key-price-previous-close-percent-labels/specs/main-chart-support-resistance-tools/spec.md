## ADDED Requirements

### Requirement: 分K及日K壓撐價位旁必須直接顯示較昨收百分比

主交易畫面 SHALL 在1m、5m、15m、60m及1D的每條已啟用CDP、三關價及Pivot Point合法價位標籤旁顯示較昨收百分比。依最新使用者定義，分母 MUST 為產生這組價位的參考K棒close；即 `(levelPrice / reference.close - 1) * 100`。三種公式 MUST 共用同商品同reference的close，不再使用目前行情T的P日close。標籤 MUST 保留公式前綴、level名稱及原商品價格格式，常駐基準顯示參考K日期與收盤價；原公式、reference選取、真實線價、視窗及儲存不變。

依最新文字需求，價位旁 MUST 只顯示正負號及兩位小數百分比，不顯示「較昨收」三字；未知顯示—。常駐基準列為「壓撐比較基準」，仍清楚保留參考K日期及close，計算方式及漲跌色不變。

#### Scenario: 三套分K公式同時啟用
- **WHEN** 使用者在任一指定分K時框同時啟用Pivot Point七線、三關價三線及CDP五線，且昨收基準可用
- **THEN** 可見線條標籤 MUST 各自顯示名稱、價格及已計算百分比，不需額外互動
- **AND** 不得以新增百分比為由靜默移除任一合法level或以目前分K收盤當分母

#### Scenario: 昨收100的壓撐標籤
- **WHEN** CDP AH為105、三關下為97、PP P為100，昨收為100
- **THEN** 標籤 MUST 分別呈現等價於 `CDP AH 105.00（+5.00%）`、`三關 下 97.00（−3.00%）`、`PP P 100.00（0.00%）` 的資訊，價格依商品formatter顯示

#### Scenario: 歷史及自動壓撐均使用所屬參考K收盤
- **WHEN** 使用者切到1D並啟用CDP、三關價或Pivot Point，包含固定歷史reference
- **THEN** 每個合法壓撐level MUST 使用該組reference.close計算，包含固定歷史K棒；分K也沿用同一參考K的分母
- **AND** 連續換股／切換五種週期後仍須顯示目前商品的基準與百分比

#### Scenario: 參考K收盤與目前昨收不同
- **WHEN** 目前實際昨收100、行情reference95，但此組壓撐參考K收盤103
- **THEN** 三套壓撐 MUST 使用103；改選收盤95的歷史K棒時，價位105 MUST 顯示+10.53%，不帶「較昨收」文字
- **AND** renderer MUST 沿實際繪製的同組reference取得分母，不被舊context或其他商品的close覆蓋；日K費波另依圖表序列最後一根日K的close計算，不共用壓撐分母

#### Scenario: 日線MA／BOLL不自動擴大範圍
- **WHEN** 分鐘圖同時開啟日線MA／BOLL水平投影
- **THEN** 百分比 MUST 只新增在壓撐level，不新增到MA／BOLL標籤
- **AND** 同一renderer中的全部標籤 MUST 維持可讀且不改變原價格視窗
