## Why

MultiView 的 `自動`、`Shioaji 即時`、`Yahoo 延遲`雖能顯示線圖，但目前缺少跨來源、跨週期的逐項 K 棒完整性契約。實際盤後查核已發現 Shioaji 一分鐘 Kbars 使用區間結束時間，前端卻當成區間開始時間，造成 5／15 分鐘首尾部分棒與內容錯位；Yahoo 1 分來源也有開收盤缺列，但現行 payload 仍可能呈現為完整。

## What Changes

- 建立三種來源模式 × `intraday`、1m、5m、15m、60m、日、週、月的完整性矩陣，區分來源未提供、合法無成交、時間標記差異、聚合缺陷、快取缺口與前端漏畫。
- 將 Shioaji Kbars 的分鐘結束時間正規化為 canonical 分鐘開始時間，再由同一份 1 分 K 聚合 5／15／60 分，避免多出首尾部分棒或跨 bucket 錯位。
- 對 Yahoo 與 canonical 分鐘資料加入交易時段邊界與 continuity 判定；上游未回傳的分鐘不得補造，必須標示 partial／source gap，並在自動模式優先使用完整 Shioaji candle set。
- 驗證日 K 交易日連續性及週／月由完整日 K 聚合後的 period coverage；停牌、未上市、休市與合法無成交不列為程式缺棒。
- 新增來源、聚合、快取與真實 5174 瀏覽器回歸，保留 simulation-only、來源單位與原子切換契約。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `multiview-minute-kline`: 明確規範 Shioaji end-labelled 一分鐘 Kbars 的 canonical 開始時間、交易時段邊界與聚合後的 expected bucket coverage。
- `multiview-taiwan-realtime-market-data`: 三種來源模式必須揭露分鐘／日週月 K 棒 continuity，來源缺列不得冒充 complete，自動模式只可原子採用完整同源 candle set。

## Impact

影響 `apps/multiview/public/static/realtime-coordinator.js`、`realtime-charts.js`、Worker candle payload 的 continuity metadata、相關測試與本機 5174 驗收。維持既有 8080、5173、5174、watchdog 與行情串流，不啟用 production、CA、真實下單或遠端 Shioaji capability，也不以人工補值改寫正式行情。
