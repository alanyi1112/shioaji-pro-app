## Why

每日籌碼排程可能在上游尚未發布當日資料時先取得前一交易日 rows，但目前 fetch-state 會把請求的 `end` 誤記為實際 coverage，導致 health 錯誤顯示 ready，且圖表在數小時內持續命中舊快取。2026-07-21 正式站已重現：TWSE 與 FinMind 均已有當日三大法人資料，Sites 仍回傳 2026-07-20。

## What Changes

- fetch-state 的 coverage 起訖改由實際成功取得的 rows 計算，不再使用請求範圍冒充資料覆蓋。
- 當日資料尚未發布時，預熱 health 必須維持 pending，並允許後續請求或排程重新抓取。
- 為 TWSE 上市普通股與 ETF 的 `institutional-flow` 增加官方 T86 最新資料 fallback，避免 FinMind 發布時差讓當日三大法人長時間停在前一交易日。
- 新增來源日期落後、快取判定、TWSE T86 正規化與正式回應契約的回歸測試。
- 將 API／圖表 warnings 的內部 dataset 與 reason code 改為繁體中文資料名稱，並說明資料內容、正常發布時段及網站重查方式；借券成交沒有當日紀錄時不得誤稱為資料漏抓。
- 將籌碼資料提示移到所有已選副圖之後，並提供可關閉控制；新商品或不同內容的提示仍須重新出現。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `taiwan-stock-chip-data`：日籌碼 coverage 必須反映實際資料日期，且 TWSE 三大法人可使用官方 T86 當日 fallback。
- `watchlist-chip-prewarming`：ready／pending 健康判定必須依實際 coverage，而非請求範圍或僅有成功時間。
- `taiwan-stock-chip-data`：使用者可見 warnings 必須以中文說明資料內容與更新節奏，不得直接顯示內部 dataset／reason code。
- `taiwan-stock-chip-subcharts`：資料提示必須位於籌碼副圖尾端，且可由使用者逐圖表關閉。

## Impact

- 主要影響 `worker/taiwan-stock-chip-service.ts`、TWSE 三大法人正規化邏輯、D1 fetch-state、`public/static/chip-panes.js`、副圖提示 markup／樣式與相關測試。
- `GET /api/taiwan-stock-chip` response shape 維持相容，但 `coverage`、`cache.mode`、`availability` 與 `sources` 將更準確。
- 不新增秘密、外部套件或 D1 migration；資料來源仍限於既有合法免費 API。
