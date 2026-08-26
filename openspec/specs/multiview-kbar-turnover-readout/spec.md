# multiview-kbar-turnover-readout Specification

## Purpose
TBD - created by archiving change add-multiview-kbar-turnover-readout. Update Purpose after archive.
## Requirements
### Requirement: MultiView K棒readout必須顯示精確成交值
MultiView 的K棒OHLCV readout MUST 在成交量後顯示「值」，並且只採用與目前canonical candle相同source、bucket、panel identity及generation的精確成交值。系統 MUST NOT 使用open、high、low、close、average price、volume、`weightedAmount`或其他provider欄位推算成交值。

#### Scenario: Crosshair命中有精確Amount的K棒
- **WHEN** crosshair命中本機simulation Shioaji來源且`turnoverTwd`合法的canonical candle
- **THEN** readout MUST 在該candle成交量後顯示由相同candle成交值換算的「值」
- **AND** OHLC、量、值、time及source metadata MUST 屬於相同panel generation

#### Scenario: 最新K棒fallback
- **WHEN** crosshair離開圖表、沒有合法time或位於未來空白區，且panel使用最新candle fallback
- **THEN** 成交量與成交值 MUST 一起回到最新canonical candle
- **AND** MUST NOT 保留上一根游標candle的值或使用右上角quote snapshot代替

#### Scenario: 精確來源不可用
- **WHEN** candle來自Yahoo、國外商品、指數、舊schema，或精確成交值缺漏、非法、溢位
- **THEN** readout MUST 顯示`值 —`且accessible name為`成交值 —`
- **AND** 合法OHLCV、圖表工具與其他readout欄位 MUST 繼續運作

### Requirement: MultiView成交值必須使用一致的萬元格式
MultiView成交值 MUST 以新台幣元保存並以萬元顯示。可見文字 MUST 使用`值 <格式化數字>萬`，tooltip／accessible name MUST 使用`成交值 <格式化數字>萬元`；數值零、小額、不可用與千分位 MUST 有單一確定格式。

#### Scenario: 一般萬元值
- **WHEN** canonical candle成交值為93,550,000元
- **THEN** 可見readout MUST 顯示`值 9,355萬`
- **AND** tooltip／accessible name MUST 為`成交值 9,355萬元`

#### Scenario: 零值與小額
- **WHEN** 成交值分別為0元、999元及1,000元
- **THEN** 可見readout MUST 分別顯示`值 0萬`、`值 <0.1萬`及`值 0.1萬`
- **AND** MUST NOT 把合法零值顯示成unavailable

#### Scenario: 元值不安全
- **WHEN** 來源值為負數、小數元、`NaN`、Infinity、指數字串、超過safe integer或非canonical Decimal字串
- **THEN** formatter前的parser MUST 將該值標示為unavailable
- **AND** MUST NOT 截斷、四捨五入或解析成看似合法的萬元值

### Requirement: 形成中成交值必須服從可信累計cursor
本機simulation Shioaji forming candle MUST 以已接受的`total_amount`相鄰差額更新成交值，並與既有商品、台北交易日、source time、sequence、connection、panel generation及total-volume cursor共同判定。合法`amount`只得在同一已接受事件上作精確fallback或一致性驗證。

#### Scenario: 合法累計成交值推進
- **WHEN** Kbars bootstrap已包含當日100,000,000元，下一個合法Tick的`total_amount`為100,500,000元
- **THEN** 目前forming candle MUST 只增加500,000元
- **AND** 目前1分與由它重聚合的5／15／60分及日K MUST 使用同一增量

#### Scenario: 連續事件的amount與累計差額矛盾
- **WHEN** 連續已接受sequence同時提供`amount`與`total_amount`，但`amount`不等於相鄰累計差額
- **THEN** 成交值chain MUST fail unavailable且不得增加
- **AND** 合法price與volume lifecycle MUST 依各自契約繼續

#### Scenario: Transport合併造成sequence跳號
- **WHEN** 新已接受事件sequence跳過一個以上值，且合法`total_amount`不小於前次累計
- **THEN** 系統 MUST 使用完整累計差額並視為涵蓋多筆成交
- **AND** MUST NOT 用最後一筆`amount`與多筆累計差額強制作相等比較

#### Scenario: Non-trade snapshot與重送
- **WHEN** 收到zero-volume、simtrade、相同event identity、倒序source time、舊session、舊connection或舊generation事件
- **THEN** 該事件 MUST NOT 推進turnover cursor或改寫目前candle
- **AND** UI對同一snapshot的重複觀察 MUST NOT 被當成新的broker event

### Requirement: MultiView成交值readout必須維持多圖效能與可存取性
成交量與成交值各自的標籤、數值及單位 MUST 保持不可拆分，欄位邊界 MAY 換行。1／2／4／8 panel、fixed／floating readout、字級放大、窄版與完整panel PNG MUST 完整呈現可見欄位；crosshair高頻更新 MUST 沿用有界latest-wins排程且不得新增assertive live region。

#### Scenario: 窄版多圖換行
- **WHEN** 4或8 panel使單一圖表寬度不足以在同列容納OHLC、量及值
- **THEN** readout MUST 只在欄位邊界換行
- **AND** `值 9,355萬`內部不得拆開、裁切、重疊或超出panel

#### Scenario: 高頻crosshair移動
- **WHEN** 同一panel在一個animation frame內收到多個crosshair事件
- **THEN** 系統 MUST 只提交最新candle的readout一次
- **AND** 不得重建chart、turnover series、overlay、技術副圖或籌碼readout DOM

#### Scenario: 完整panel PNG
- **WHEN** 匯出含主圖、成交量及副圖的完整panel PNG
- **THEN** 匯出 MUST 包含當下可見的成交值readout
- **AND** 不得加入額外成交值軸、series或其他panel的值

### Requirement: 本change不得恢復成交值軸線或擴張資料與交易權限
MultiView成交值只能作為文字readout資料。系統 MUST NOT 建立turnover price scale、axis label、series、indicator、設定checkbox、Cloudflare／Sites realtime capability、D1 turnover persistence或任何broker authority。

#### Scenario: Production residual檢查
- **WHEN** 執行source scan、production build與browser DOM驗收
- **THEN** 系統 MUST 只有readout consumer使用`turnoverTwd`
- **AND** 不得出現成交值axis、series、設定或額外price scale

#### Scenario: 本機simulation驗收
- **WHEN** 在127.0.0.1:5174驗收歷史與forming成交值
- **THEN** 所有market data MUST 維持既有simulation-only local adapter範圍
- **AND** MUST NOT 啟動production、載入CA、取得broker authority、送出委託、部署或寫入遠端資料庫
