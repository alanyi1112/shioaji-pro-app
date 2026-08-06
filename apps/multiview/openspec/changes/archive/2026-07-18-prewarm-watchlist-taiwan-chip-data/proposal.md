## Why

目前法人、外資持股、融資券與借券等日籌碼資料，主要在使用者開啟個股線圖時才向免費來源抓取；新加入「我的清單」的台股可能在第一次開圖時才開始回補，造成副圖暫時沒有資料。系統需要把清單內合格台股的籌碼資料改為背景預先同步，讓使用者開圖時優先直接讀取已保存的 D1 資料。

## What Changes

- 新增「我的清單」台股籌碼預熱工作：從所有使用者已啟用的清單項目及系統預設台股清單，動態找出合格 TWSE／TPEx 普通股與 ETF，不在 workflow 寫死 symbol。
- 新增受保護的 stale／missing target 查詢，讓 GitHub Actions 每日依缺資料優先、最久未成功優先的順序，分批回補法人、外資持股、融資券與借券資料。
- 使用者新增合格台股後，Worker 立即以 `waitUntil` 啟動該 symbol 的背景預熱；即使立即工作失敗，下一次 durable scheduler 仍會接手重試。
- 預設為每個目標保存最近兩年日籌碼資料；相同 `symbol + sessionDate` 及 dataset 重跑維持冪等，已存在資料不得被較不完整來源覆蓋。
- GitHub workflow 在 TDCC 最新週快照後執行日籌碼預熱，再執行允許的 TDCC 歷史回補；任何單一 symbol／dataset 失敗不得阻止其他目標或清除既有 D1 資料。
- `/api/health` 增加籌碼預熱的目標數、已就緒數、待補數、最近成功時間與安全錯誤原因，秘密與上游完整內容不得出現在 response 或 log。
- 開圖時仍保留按需補抓作為 fallback，但不得再是「我的清單」台股取得籌碼歷史的唯一途徑。

## Capabilities

### New Capabilities

- `watchlist-chip-prewarming`: 定義「我的清單」合格台股的背景目標發現、立即預熱、排程補齊、重試、冪等與健康狀態契約。

### Modified Capabilities

- `taiwan-stock-chip-data`: 將法人、外資持股、融資券及借券資料由按需快取擴充為背景預先同步，並要求開圖優先使用已保存資料。

## Impact

- 影響 `worker/index.ts`、`worker/app.ts`、`worker/taiwan-stock-chip-service.ts`、`scripts/tdcc-history-backfill.mjs`、`.github/workflows/tdcc-continuous-backfill.yml` 與相關測試。
- 沿用既有 D1 `taiwan_stock_chip_daily`、`taiwan_stock_chip_fetch_state`、商品 eligibility、FinMind token、GitHub／Sites secrets 與 TDCC scheduler；原則上不新增付費來源或前端秘密。
- 背景同步會增加免費資料源請求量，必須使用有限批次、來源節流、retry-after 與 stale-first 排序控制，不得無界掃描全市場。
