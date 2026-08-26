## ADDED Requirements

### Requirement: MultiView指定日期1分K必須原子保留成交值availability
MultiView單圖的target-date loader MUST 從同一次simulation Shioaji Kbars response驗證`Amount`，並把每根合法`turnoverTwd`或明確unavailable狀態納入不可變response、staged projection與atomic commit。成交值缺漏 MUST NOT 阻止合法OHLCV drill-down，但系統 MUST NOT 在commit後從目前realtime、其他日期、Yahoo、舊cache或估算來源補接。

#### Scenario: 指定日期Amount完整
- **WHEN** target-date response的datetime、OHLCV、Volume與Amount欄位長度一致，且每根Amount均為合法非負safe integer元值
- **THEN** 原子commit後每根1分K MUST 保留同列精確成交值
- **AND** candles、volume、turnover availability、readout、indicators及viewport MUST 屬於同一target date與generation

#### Scenario: 指定日期Amount缺漏但OHLCV合法
- **WHEN** target-date response具有合法同日OHLCV與Volume，但Amount欄位缺漏、長度不符或某列無效
- **THEN** drill-down MUST 仍可提交合法OHLCV，受影響candle readout MUST 顯示`值 —`
- **AND** 系統 MUST NOT 以close乘volume、其他日期Amount或目前realtime Tick補值

#### Scenario: 快速切換後舊turnover結果晚到
- **WHEN** target-date staged snapshot尚未commit，商品、panel、interval、source identity、schema revision或generation已改變
- **THEN** 舊snapshot的candles與turnover availability MUST 一起被丟棄
- **AND** MUST NOT 只把舊成交值接到目前panel

#### Scenario: 返回一般日K
- **WHEN** 使用者從指定日期1分K切回日K
- **THEN** 系統 MUST 依一般日K provider及cache契約重新載入成交值availability
- **AND** 單日simulation Amount MUST NOT 寫入或冒充Yahoo、Cloudflare或D1日K成交值
