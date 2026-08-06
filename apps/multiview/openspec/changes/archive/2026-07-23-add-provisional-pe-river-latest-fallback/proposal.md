## Why

TWSE 免費 OpenAPI 可能在盤後仍停留於前一交易日，而 FinMind 已提供同日 `TaiwanStockPER` 與 `TaiwanStockPrice`，造成河流圖無法顯示最新 completed session。需要在不抓取未授權 TWSE 日期查詢網頁、也不冒充官方資料的前提下，以明確標示的 FinMind 暫代尾端補足最新資料，並在官方 OpenAPI 到齊後自動核對與追認。

## What Changes

- latest lane 在 TWSE／TPEx 官方 OpenAPI 日期落後時，以 bounded FinMind `TaiwanStockPER`＋`TaiwanStockPrice` 取得較新的同商品、同交易日有限正數 P/E 與收盤價，建立獨立的 provisional latest row。
- 新增 `finmind_provisional_latest`、pending verification、追認成功、來源錯配與官方明確無有效 P/E 等狀態；provisional row 不得推進 official verified coverage，也不得標示為官方資料。
- 河流圖可使用既有 verified 五年 percentile multiplier 與 provisional `referenceEps = close / PER` 延伸有限的最新交易日尾端；provisional P/E 不納入五年 percentile 樣本。
- API、readout、狀態列與 PNG 清楚標示「FinMind 暫代、等待交易所確認」、暫代日期與最後官方驗證日期，並區分暫代本益比／參考 EPS和官方值。
- TWSE／TPEx OpenAPI 發布相同日期後，自動以相同市場、canonical symbol、`sessionDate` 的 P/E 與收盤價逐項核對；兩者絕對差皆不超過 `0.01` 才以官方 row 冪等取代暫代 row 並推進 verified coverage。
- 官方與 FinMind 不一致時以官方 row 取代 provisional row 並保存 `source_mismatch`，同時隔離該商品後續的 FinMind 暫代能力；既有與新到達的官方資料仍可使用，不得靜默放寬容許值或讓 FinMind 覆蓋官方資料。
- 排程持續維持 latest-first、bounded retry、D1 原子狀態更新、single-flight 與安全 health；休市、來源日期未前進或上游異常時不得製造假資料。
- 明確禁止以 TWSE／TPEx 一般日期查詢網頁、爬蟲、付費資料或 MOPS 自行重建 EPS 作為本變更的 fallback。

## Capabilities

### New Capabilities

- `provisional-pe-river-latest-fallback`: 規範官方 OpenAPI 延遲時的 FinMind 最新日暫代資料、D1 雙日期 coverage、背景追認、錯配隔離、時效邊界及可觀測狀態。

### Modified Capabilities

- `taiwan-stock-pe-river-chart`: 允許河流圖以既有 verified percentile 延伸明確標示的 provisional latest point，並在 readout、警示與 PNG 中區分暫代值和官方值。

## Impact

- Worker／資料層：`worker/pe-river-data-pipeline.ts`、`worker/pe-river-continuous-backfill.ts`、`worker/taiwan-stock-pe-river.ts`、D1 valuation／fetch state／health repository 與 additive migration。
- 自動化：`.github/workflows/pe-river-continuous-backfill.yml` 的 latest lane、FinMind bounded latest request、追認 retry 與排程驗收。
- API／前端：河流 response 的 verified／display coverage、provisional metadata、warnings、pointed-date readout、overlay 與完整 panel PNG。
- 測試：TWSE 延遲／追上、精確相符、`0.01` 邊界、mismatch、休市、負或空 P/E、原子 promotion、正式 private workflow 與登入後 browser 驗收。
- 授權與安全：維持 private／custom、非商業與來源顯名邊界；不新增秘密值、不提供原始資料 dump，也不呼叫未經授權的交易所網頁介面。
