## Why
個股篩選技術條件在OHLCV升級後漏讀已驗證資料，且進階快照落後；必須逐條件真實驗收。

## What Changes
- 修正v3讀取v2行情及資料保留相容性。
- 修正條件切換的排序版本相容性。
- 有界補齊缺期並發布同日快照，逐項驗證所有条件及組合。

## Capabilities
### Modified Capabilities
- `after-market-stock-screener`: 條件資料與版本相容性。

## Impact
影響本機選股資料準備、發布、UI與回歸測試，不啟停共用服務或交易。
