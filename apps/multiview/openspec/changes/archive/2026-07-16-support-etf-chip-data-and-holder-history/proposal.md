## Why

目前籌碼 API 以 `quoteType === "EQUITY"` 一次排除所有 ETF，導致已能由 FinMind、TWSE／TPEx 或 TDCC 提供的 ETF 法人、融資券、外資持股、借券及股權分散資料完全無法顯示。大戶／散戶副圖又只取得 TDCC 最新一週快照，長日期範圍通常只有一根難以辨識的柱，無法形成可閱讀的持股趨勢。

## What Changes

- 將台股籌碼 eligibility 從「整個商品允許／拒絕」改為「依商品類型與資料族群判斷」，讓上市、上櫃 ETF 可使用來源確實提供的籌碼資料。
- ETF 沒有某一資料族群時，只將該資料族群標示為 unavailable，不影響其他可用籌碼副圖。
- 新增 TDCC 股權分散週歷史回補流程，優先使用允許自動介接的免費官方歷史來源；無法安全回補時保留已累積快照，且不得把週資料偽造成每日資料。
- 將大戶／散戶副圖改為「持股比例週頻線圖＋相較前一週的百分點變化柱狀圖」，並保留級距、張數、人數、來源與實際資料日期。
- 在日 K 上只對齊 TDCC 真實發布日，其他交易日保留 gap；UI 必須清楚標示「週資料／週變化」，不得顯示成每日變化。
- 補上 ETF、多資料族群部分可用、歷史回補、單筆快照降級及線柱複合圖的測試與正式站驗收。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `codex-sites-rewrite`：將正式站籌碼能力從只支援台股普通股，擴充為可依資料族群支援台股普通股與 ETF。
- `taiwan-stock-chip-data`：修改 eligibility、availability 與 TDCC 週歷史取得／快取契約，支援 ETF 及資料族群層級的安全降級。
- `taiwan-stock-chip-subcharts`：修改大戶／散戶呈現契約為週頻比例線圖與週變化柱狀圖，並加入 ETF 的 UI 狀態與標示。

## Impact

- `worker/taiwan-stock-chip.ts`、`worker/taiwan-stock-chip-service.ts` 與 `worker/app.ts` 的 eligibility、adapter、API response、D1 coverage／cache 邏輯。
- TDCC 官方週快照與可允許介接的免費歷史來源，以及既有 FinMind、TWSE、TPEx adapter；不在前端或 repo 內保存 `FINMIND_API_TOKEN`。
- `public/static/chip-panes.js` 的資料族群判斷、狀態訊息、大戶／散戶 series 與讀值。
- D1 migration／同步工作可能需要新增歷史匯入狀態或唯一鍵，但必須相容既有快取資料。
- Worker、service、前端 contract、瀏覽器互動與正式 Sites 部署驗證。
