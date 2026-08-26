## ADDED Requirements

### Requirement: 主交易畫面台股整股K棒必須顯示精確成交值
主交易畫面的台股整股STK K棒價量readout MUST 在「量」之後顯示「值」，並且只採用與目前canonical candle相同來源、時間bucket及generation的精確Shioaji成交值。歷史1分K MUST 使用`KBars.Amount`；5／15／60分與日K MUST 由bucket內所有可用來源K棒的成交值完整加總。系統 MUST NOT 使用close、open、high、low、average price或volume推算成交值。

#### Scenario: 游標查看歷史1分K
- **WHEN** crosshair命中一根台股整股STK歷史1分K，且同列`KBars.Amount`為合法精確成交值
- **THEN** readout MUST 在該candle的「量」之後顯示由該`Amount`換算的「值」
- **AND** 最新Tick、其他candle或其他時框 MUST NOT 改寫這個歷史讀值

#### Scenario: 聚合5分K成交值
- **WHEN** 同一5分bucket內五根canonical 1分K的`turnoverTwd`均合法
- **THEN** 5分K的「值」 MUST 等於五個精確成交值的總和
- **AND** 系統 MUST NOT 以5分K close乘五分量取代加總

#### Scenario: 聚合來源任一成交值缺漏
- **WHEN** bucket內任一來源K棒缺少、無效或超出安全數值範圍的成交值
- **THEN** 該bucket MUST 顯示`值 —`
- **AND** 合法OHLCV、成交量柱與技術指標 MUST 繼續使用既有資料，不得因成交值不可用而消失

### Requirement: 成交量與成交值必須使用確認的文字、順序及萬元格式
台股整股STK readout MUST 依序顯示`量 <張數>張　值 <萬元>萬`。可見標籤 MUST 使用「值」，tooltip與accessible name MUST 使用完整語意`成交值 <萬元>萬元`；兩者 MUST 使用相同數字精度，且不得另顯示換算前的元金額。

#### Scenario: 顯示一般大量成交值
- **WHEN** candle的canonical volume為910張，格式化成交值為9,355萬元
- **THEN** 可見readout MUST 顯示`量 910張`後接`值 9,355萬`
- **AND** tooltip或accessible name MUST 顯示`成交值 9,355萬元`

#### Scenario: 顯示小額、零值與不可用
- **WHEN** 精確成交值分別為未滿0.1萬元的正值、零或不可用
- **THEN** readout MUST 分別顯示`值 <0.1萬`、`值 0萬`或`值 —`
- **AND** 不可用狀態 MUST NOT 顯示`0萬`或任何估算值

#### Scenario: 窄版與字級放大
- **WHEN** 圖表寬度或使用者字級不足以在單行容納時間、OHLC、量與值
- **THEN** readout MUST 只在欄位邊界換行，`量 + 張數 + 張`及`值 + 數字 + 萬`各自不得拆開、裁切、重疊或覆蓋價格軸
- **AND** 鍵盤焦點、tooltip及accessible name MUST 仍可取得完整成交值語意

### Requirement: 形成中成交值必須防止bootstrap重複與事件重放
形成中台股整股STK candle的成交值 MUST 只接受與目前商品、simulation generation、台北交易日、source time及遞增sequence一致的Tick `amount`／`total_amount`。Bootstrap後 MUST 只加入尚未包含的精確成交值增量；重送、倒退、跨session、舊generation或矛盾欄位 MUST NOT 重複增加成交值。

#### Scenario: Kbars bootstrap後收到合法累計成交值
- **WHEN** 最新Kbars已包含當日累計成交值100,000,000元，下一筆已接受Tick的`total_amount`為100,500,000元
- **THEN** forming candle MUST 只增加500,000元
- **AND** readout MUST 在既有有界更新週期內顯示更新後的萬元值

#### Scenario: 相同Tick重送或累計值倒退
- **WHEN** 相同sequence重送、source time倒退或`total_amount`小於已接受累計值
- **THEN** 成交值 MUST 不增加且該不可信chain MUST fail unavailable
- **AND** 系統 MUST NOT 改用close乘volume補算，也不得把舊值冒充目前值

#### Scenario: 成交值缺漏但價格與量合法
- **WHEN** 已接受Tick具有合法價格與成交量增量，但`amount／total_amount`缺漏或不可驗證
- **THEN** forming candle的OHLCV MUST 依既有契約更新，成交值 MUST 顯示`—`
- **AND** 成交值只有在下一次可信Kbars bootstrap或新session建立後才可恢復available

### Requirement: 成交值能力必須限定於主交易畫面文字readout
本capability MUST NOT 建立成交值價格軸、series、autoscale、圖例、設定開關或副圖，也 MUST NOT 修改MultiView、gateway／Worker payload、cache fingerprint、Volume Profile、技術指標、交易或智慧單資料流。

#### Scenario: 啟用K棒價量readout
- **WHEN** 使用者在主交易畫面顯示具有精確成交值的K棒價量readout
- **THEN** 系統 MUST 只新增「值」文字欄位
- **AND** lightweight-charts series數量、左右價格軸、autoscale及API請求數 MUST 維持原契約

#### Scenario: 開啟MultiView
- **WHEN** 使用者開啟或操作MultiView圖表
- **THEN** MultiView MUST 維持既有K棒、成交量軸、readout、payload與cache契約
- **AND** 本change MUST NOT 讓MultiView出現「值」、成交值軸或turnover metadata
