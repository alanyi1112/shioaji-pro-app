## ADDED Requirements

### Requirement: Workers Pivot Point 必須採 lazy 且一致的資料 contract

系統 MUST 只在合法 Pivot query 已啟用時取得必要高週期參考資料並回傳 `indicators.pivot_points`。`/api/candles`、`/api/stream`、single-flight 與 candle payload cache MUST 使用相同正規化 Pivot mode；Pivot 未啟用時 MUST 維持既有 candle payload 行為，且不得增加高週期上游請求。

#### Scenario: 未啟用 Pivot 維持既有請求成本

- **WHEN** `/api/candles` 或 `/api/stream` 未提供合法 Pivot mode
- **THEN** Worker MUST 不為 Pivot 額外取得日、週或月參考行情
- **AND** 既有 K 線、RSI、KD、MACD、ATR、Bollinger、Volume Profile 與其他 payload MUST 維持相容

#### Scenario: 啟用 Pivot 區分 cache identity

- **WHEN** 相同商品、週期與 display count 分別以停用及 `pivot=traditional` 要求 candles
- **THEN** candle payload cache MUST 將兩者視為不同 identity
- **AND** 啟用版本 MUST 包含正規化 type、reference interval、status 與七組 Pivot 序列

#### Scenario: candles 與 stream 使用相同 Pivot

- **WHEN** 前端以 `pivot=traditional` 建立 candle request 與 EventSource stream
- **THEN** 初始 candle payload、stream snapshot 與後續更新 MUST 使用相同參考週期及 Traditional 公式
- **AND** 同一有效 period 內即時報價更新 MUST NOT 改變 Pivot 水準

#### Scenario: Pivot 參考資料失敗時隔離錯誤

- **WHEN** Pivot 所需高週期參考資料暫時無法取得
- **THEN** Worker MUST 將 Pivot 標示為 unavailable 或回傳缺值
- **AND** 既有 candles 與其他指標 MUST 仍可正常回應
- **AND** response MUST 不洩漏上游 body、秘密、內部 URL 或例外細節
