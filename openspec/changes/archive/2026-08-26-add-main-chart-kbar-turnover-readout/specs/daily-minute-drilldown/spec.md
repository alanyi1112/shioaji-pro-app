## ADDED Requirements

### Requirement: 主交易畫面指定日期1分K必須原子保留成交值availability
主交易畫面的target-date loader MUST 從同一次Shioaji simulation Kbars response驗證每根1分K的`Amount`，並將合法精確成交值或明確unavailable狀態與相同symbol、target date、generation及canonical candle一起提交。成交值缺漏 MUST NOT 阻止合法OHLCV drill-down，但系統 MUST NOT 在commit後從其他日期、最新行情或估算來源補接成交值。

#### Scenario: 指定日期回傳完整Amount
- **WHEN** 主交易畫面指定日期response的datetime、OHLCV、Volume及Amount欄位長度一致，且每根Amount均合法
- **THEN** atomic commit後每根1分K readout MUST 顯示同列精確成交值的萬元格式
- **AND** candles、volume、turnover availability、readout、indicators及viewport MUST 屬於同一不可變snapshot與generation

#### Scenario: 指定日期Amount缺漏但OHLCV合法
- **WHEN** target-date response具有合法同日OHLCV與Volume，但Amount欄位缺漏、長度不符或某列無效
- **THEN** drill-down MUST 仍可原子顯示合法1分K，受影響readout MUST 顯示`值 —`
- **AND** 系統 MUST NOT 以close乘volume、其他日期Amount或目前realtime Tick補值

#### Scenario: 舊target-date response晚到
- **WHEN** 含成交值的舊response返回前，商品、日期、interval、panel identity或generation已改變
- **THEN** 舊candles與成交值 MUST 一起被丟棄
- **AND** 舊成交值 MUST NOT 單獨寫入目前readout或形成中cursor

#### Scenario: MultiView指定日期loader
- **WHEN** MultiView單圖依既有契約載入指定日期1分K
- **THEN** MultiView MUST 維持原有target-date payload與commit layers
- **AND** 本requirement MUST NOT 要求MultiView接收Amount、成交值readout或turnover metadata
