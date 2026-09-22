## Why

自選清單的 metadata 與商品合約已成功取得時，前端仍會等待整份清單的 Tick／BidAsk 訂閱全部完成才顯示列；只要其中一個訂閱請求持續等待，畫面便會永久停在「載入清單…」。清單內容與即時報價可用性應分離，避免單一行情訂閱故障讓使用者看不到已存在的清單。

## What Changes

- 商品合約解析完成後立即發布可用的自選清單列，不再以整批行情訂閱完成作為顯示前置條件。
- 將作用中清單的行情訂閱改為背景、可重試的工作，並明確區分等待中與已成功訂閱狀態。
- 載入或重新整理期間保留既有清單列，只有首次尚無資料時才顯示載入提示。
- 確保目前載入世代即使遇到訂閱、canonical migration 或清單同步失敗，也能解除 loading，且不讓舊請求覆寫新清單。
- 增加瀏覽器回歸測試，涵蓋訂閱永遠不 resolve、訂閱失敗、重新載入與 latest-wins 等情境。
- 避免清單載入後的多條市場脈動 SSE 吃滿本機開發 origin 的 HTTP/1.1 連線，使切換商品後的 K 線 REST 請求仍能送達 API。

## Capabilities

### New Capabilities

- `watchlist-loading-resilience`: 定義 server-backed 自選清單內容與即時報價訂閱解耦、非阻塞呈現、失敗恢復及競態保護。

### Modified Capabilities

無。

## Impact

- 主要影響 `src/hooks/use-watchlist.ts` 的清單 hydration、loading 狀態與行情訂閱生命週期。
- 影響 `src/lib/market-pulse.ts` 在 Vite loopback 開發環境的 SSE origin 分流；Tauri 與明確 API base 維持原路徑。
- 可能共用或整理 `src/lib/contracts-cache.ts` 已採用的 pending／subscribed 訂閱狀態模式，但不變更 Shioaji API 契約或 server watchlist 格式。
- 增補 `src/hooks/use-watchlist-startup.browser.test.ts` 等瀏覽器測試；不啟用 production、不送出委託，也不改動既有自選清單資料。
