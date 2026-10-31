## ADDED Requirements

### Requirement: 日K費波以圖中最後一根K棒收盤計算百分比並放在線段左側

主交易畫面 SHALL 在1D費波回撤及拓展每條合法水準標籤，以同商品目前日K序列最後一根K棒close計算 `(levelPrice / lastDailyClose - 1) * 100`。此最後一根 MUST 為實際圖表資料序列尾端，不是可見視窗最右一根、十字線所指K棒、費波錨點或前一交易日close；盤中包含已接受行情更新的未收盤日K。標籤 MUST 保留原比率與價格，百分比不帶「較昨收」三字，放在線段左側。原公式、錨點、線／色帶、modifier、繪圖順序、儲存與清除範圍 MUST 不變。

#### Scenario: 使用最新圖表收盤
- **WHEN** 前日收盤100、日K序列最後收盤103，費波價位105
- **THEN** 標籤 MUST 顯示+1.94%，不得顯示用100算出的+5.00%
- **AND** 常駐說明 MUST 顯示最後日K的日期及close，不冒稱前一交易日昨收

#### Scenario: 左側標示不改視窗
- **WHEN** 水平線段左端有足夠空間
- **THEN** 完整比率／價格／百分比 MUST 位於該線段左端外側，依真字寬配置
- **AND** 左側空間不足時 MUST 使用原plot左緣的安全空間及必要connector，不裁掉數字、不擴大縱軸、不移動視窗或改小K棒

#### Scenario: 最新收盤更新與歷史視窗
- **WHEN** 最後日Kclose由103更新104，或使用者移動十字線／捲看歷史／調整費波錨點
- **THEN** 百分比 MUST 隨最新圖表尾端close更新；歷史視窗及錨點不能改用其他分母
- **AND** 百分比或文字位置變化 MUST 不額外修改原level線座標、autoscale、bar spacing及visible range

#### Scenario: 預覽與未知狀態
- **WHEN** 合法pending水準轉為完成圖，或最後close缺失／零負／非法／換商品尚未確認
- **THEN** 合法預覽與完成圖 MUST 共用相同尾端收盤；不可用時以無前綴的—表示，不補0或沿用舊商品

#### Scenario: 其他時框與持久化
- **WHEN** 使用分鐘費波、重新載入圖形或清除既有費波
- **THEN** 分鐘費波維持原範圍，1D以目前圖表尾端重新計算，百分比不寫進storage，不新增migration或下載需求
