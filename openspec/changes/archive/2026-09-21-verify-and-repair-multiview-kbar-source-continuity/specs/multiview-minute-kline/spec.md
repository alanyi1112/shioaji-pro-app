## MODIFIED Requirements

### Requirement: 5／15／60 分 K 必須由同一份 1 分 K 依交易日聚合
系統 MUST 先將來源分鐘時間正規化為代表區間開始的 canonical time，再以 `Asia/Taipei` 交易日內的 canonical 1 分 K 聚合 5／15／60 分 bucket；Shioaji Kbars若以區間結束時間09:01–13:30表示09:00–13:30交易，canonical time MUST 正規化為09:00–13:29並保留原始`sourceTime`。open MUST 取 bucket 第一根實際 K、high／low MUST 取極值、close MUST 取最後一根、volume MUST 加總一次。只有bucket內每根實際candle的`turnoverTwd`均合法時成交值才 MUST 完整加總，任一缺漏或溢位時該bucket成交值 MUST 為unavailable。bucket MUST 使用 canonical bucket開始時間，不得跨交易日或以缺少資料的分鐘補造交易。

#### Scenario: 正規化 Shioaji 分鐘結束時間
- **WHEN** Shioaji在完成交易日回傳09:01–13:30共270根end-labelled一分鐘Kbars
- **THEN** canonical 1分K MUST 為09:00–13:29共270根，原始sourceTime仍為09:01–13:30
- **AND** 5分K MUST 為09:00–13:25共54根，15分K MUST 為09:00–13:15共18根，不得多出09:00或13:30部分棒

#### Scenario: 聚合完整分鐘 bucket
- **WHEN** 同一交易日內連續 canonical 1 分 K 落在同一個 5、15 或 60 分 bucket，且每根成交值均合法
- **THEN** 聚合 OHLCV與成交值 MUST 與對該 minute set 執行 full recompute 的結果相同
- **AND** candle time MUST 使用 canonical bucket開始時間

#### Scenario: 跨日不得合併
- **WHEN** 依時間相鄰的兩根 1 分 K 分屬不同 `Asia/Taipei` 交易日
- **THEN** 後一根 MUST 開始新的 bucket
- **AND** 前一日未滿長度的最後 bucket MUST 保留實際 OHLCV與完整可用的成交值，不得與次日資料合併

#### Scenario: 資料缺口不得補造
- **WHEN** 1 分歷史在某 bucket 內缺少一個以上來源應提供的分鐘
- **THEN** 聚合 MUST 只使用實際存在的合法 K 並將 continuity 標示為 partial；成交值只在這些實際candle全部可用時加總
- **AND** 系統 MUST NOT 複製前價、補零 volume、估算成交值或建立不存在的 1 分 K

#### Scenario: Bucket內成交值不完整
- **WHEN** bucket內任一實際1分K的`turnoverTwd`為unavailable或加總超過safe integer
- **THEN** 聚合candle的成交值 MUST 為unavailable
- **AND** 其他合法OHLCV與continuity MUST 保持正確
