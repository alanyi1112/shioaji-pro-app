## ADDED Requirements

### Requirement: 三種來源模式必須揭露 K 棒完整性
本機 MultiView MUST 對`自動`、`Shioaji 即時`、`Yahoo 延遲`的1m、5m、15m、60m、日、週、月payload提供可驗證的continuity狀態、實際來源、涵蓋起訖與安全reason code。來源未回傳、合法無成交、休市／停牌／上市前不適用、時間標記差異、快取缺口與前端漏畫 MUST 分開分類；只有實際資料集合通過對應契約才能標示complete。

#### Scenario: 強制Yahoo的1分資料缺開收盤區間
- **WHEN** Yahoo只回傳完成交易日09:02–13:24等不完整1分集合
- **THEN** payload與UI MUST標示partial及缺少的時段邊界，仍只顯示實際Yahoo K棒
- **AND** MUST NOT以5分K拆分、前值延伸、零volume或Shioaji列補成Yahoo complete

#### Scenario: 自動模式有完整Shioaji與部分Yahoo
- **WHEN** 相同商品與週期的Shioaji candle set完整而Yahoo為partial
- **THEN** 自動模式 MUST 原子採用完整Shioaji candle set並標示實際來源
- **AND** 不得混接Yahoo OHLCV、time或volume；Shioaji失效時fallback MUST如實呈現Yahoo partial

#### Scenario: 日週月交易日連續性
- **WHEN** 日K已依官方交易日計畫分類完成、缺口與排除日期
- **THEN** 週／月 MUST由相同daily base聚合並保留對應continuity與涵蓋日期
- **AND** 休市、停牌、上市前或尚未完成的當期 MUST NOT被製造成K棒或誤報為歷史缺口

#### Scenario: 前端與來源row數一致
- **WHEN** API回傳通過契約的canonical candle set
- **THEN** panel MUST繪製同一generation的全部candle，切換來源／週期後舊generation不得留下或覆蓋
- **AND** 可見狀態、readout、指標與console MUST與該candle set一致
