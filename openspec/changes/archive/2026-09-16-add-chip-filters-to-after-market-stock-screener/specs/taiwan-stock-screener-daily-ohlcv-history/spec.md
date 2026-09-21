## ADDED Requirements

### Requirement: 日 K snapshot 必須提供近期收盤新高 evidence

選股 OHLCV feature MUST 能對 2–120 個相鄰官方交易日計算目前 close 是否嚴格高於前 N-1 日所有 close。evidence MUST 保存 lookback sessions、目前 close／date、先前最高 close／date、price basis、source mapping version 與 material hash；不得使用盤中 high、調整前後混合價格或圖表 viewport rows。

#### Scenario: 完整 120 日歷史

- **WHEN** 商品有 through `effectiveSessionDate` 的 120 個相鄰 canonical OHLCV sessions
- **THEN** publisher MUST 可建立 2–120 日任一合法 lookback 的新高 feature，且相同 snapshot 重算產生相同 hash

#### Scenario: 停牌或上市歷史不足

- **WHEN** official session plan 中商品合法停牌，或上市後可用 rows 少於 N
- **THEN** feature MUST 回傳 `insufficient_history`、`suspended` 或對應可驗證原因，不得複製前一 close 補滿 N 日

### Requirement: 日 K snapshot 必須提供收盤價突破 SMA evidence

選股 OHLCV feature MUST 對 SMA5、SMA10、SMA20、SMA60 使用與既有指標相同的 reference SMA 公式，保存前一與目前 session 的 close、SMA、session date、period、price basis、formula version 與 evidence hash。只有前一 close 小於或等於前一 SMA 且目前 close 大於目前 SMA時，向上突破才為 pass。

#### Scenario: 收盤價跨越 SMA60

- **WHEN** 連續 OHLCV 足以暖機 SMA60，前一日 close 不高於 SMA60，而目前 close 高於 SMA60
- **THEN** feature MUST 產出向上突破 pass evidence，且不得以 SMA5 穿越 SMA20 的黃金交叉 evidence 代替

#### Scenario: 均線暖機不足

- **WHEN** canonical history 少於 period 或含無法驗證的必要 session
- **THEN** feature MUST 為 unknown 並回報 `indicator_warmup`、`missing_ohlcv` 或 `non_adjacent_sessions`

### Requirement: 新價格 feature 必須綁定既有 130 日完整性責任

近期新高與 SMA feature MUST 只從 v4／後續版本的 130-session canonical OHLCV snapshot 建立，且 through date MUST 等於 snapshot `effectiveSessionDate`。`full_window_complete`、row count、較新圖表 K 棒或單一市場成功 MUST NOT 取代逐商品 continuity 與雙市場 universe coverage 驗證。

#### Scenario: row count 足夠但中間缺一日

- **WHEN** 商品有至少 130 rows，但 official session sequence 中間存在未分類缺口
- **THEN** publisher MUST 拒絕該商品的新高與 SMA current evidence，直到缺口被修復或合法分類
