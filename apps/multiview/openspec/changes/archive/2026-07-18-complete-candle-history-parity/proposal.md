## Why

Sites 前端雖已具備向左縮放補載與 `display_count` 流程，但 Worker 目前只依 `symbol + interval + displayCount` 快取整包 response，無法像來源專案一樣逐 K 棒合併去重、共用不同資料窗、保存日／週／月歷史並安全更新尾端。這會讓歷史補載重複下載相同上游資料，也無法以 D1 累積可重用的長期 K 線。

## What Changes

- 新增 D1 正規化 K 線歷史資料表，以 provider、symbol、interval 與 candle time 作唯一鍵，保存可覆蓋修正的 OHLCV、報價時間與來源 metadata。
- 將 Yahoo K 線讀取改為 D1-first：先取得已保存歷史，只抓缺漏或最新尾端，再以時間合併去重並批次 upsert；日／週／月 K 提供跨部署持久化。
- 建立同一 provider、symbol 與 interval 的 single-flight，讓一般載入、歷史擴窗、多 panel 與背景預取共用同一上游工作，不因不同 `display_count` 重複下載。
- 保留既有 `/api/candles` response schema、指標 warmup、台股無成交占位正規化、收盤核對與 stale fallback，並擴充 `dataWindow.cache` 診斷以說明 D1 hit、backfill、refresh 或 stale 狀態。
- 為擴大歷史窗、尾端修正、D1 migration、併發去重、provider 失敗降級及前端可視範圍保持建立自動測試與 browser acceptance。

## Capabilities

### New Capabilities

- `candle-history-parity`: 定義 Sites K 線歷史的 D1 持久化、逐時間合併、single-flight、資料窗擴張、尾端修正、stale fallback 與驗收契約。

### Modified Capabilities

- 無。

## Impact

- 主要影響 `worker/market-data.ts`、`worker/app.ts`、`db/schema.ts`、Drizzle migration、`tests/`、瀏覽器 acceptance runner 與 `/api/candles` 的 cache metadata。
- 會新增 D1 migration，但不變更既有公開 route、必要 request 參數或 candle／indicator response 欄位。
- 不依賴 Render 或 Supabase，不新增前端秘密；如需上游憑證，只能保留在 Sites runtime 環境變數。
