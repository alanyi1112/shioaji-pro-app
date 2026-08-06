## Why

既有本益比河流圖已完成主要資料模型、API 與前端，但 TWSE／TPEx 一般歷史查詢頁面不允許未經同意的自動化下載，導致 production 五年回補必須 fail-closed。現在需要改採可免費自動介接、具五年歷史且能持續補到最新交易日的資料組合，才能完成真實回補、正式驗收與部署，同時維持可追溯的交易所本益比口徑。

## What Changes

- 以 FinMind 免費 `TaiwanStockPER` 與 `TaiwanStockPrice` 作為上市、上櫃普通股的五年歷史 seed，依同商品、同交易日配對本益比與收盤價，不爬取 TWSE／TPEx 歷史網頁。
- 以政府資料開放平臺所列、採政府資料開放授權條款第 1 版的 TWSE／TPEx OpenAPI 作為每日官方最新快照與重疊日期核對來源。
- 新增耐久背景回補流程：可從 D1 actual coverage 規劃缺口、分批寫入、保存 checkpoint、服務重啟後續跑，並在沒有 panel 流量時持續補足最新交易日。
- 對同商品的首次回補、排程更新與重複 panel request 做 single-flight／job dedupe；免費來源限流或暫時失敗時採 bounded retry、retry-after 與 stale D1，不回退到未授權 scraping。
- 對 FinMind 與官方 OpenAPI 的重疊日期執行 P/E／收盤價一致性核對；不一致、schema drift、來源延遲或資料缺口必須保留安全狀態，不得偽造 coverage。
- 在 API、readout 與說明中標示原資料提供機關、FinMind 歷史 seed、實際 coverage 與政府資料開放授權；不得提供五年原始資料下載或建置 FinMind 鏡像服務。
- 保留既有交易所參考 EPS、五年 P10／P30／P50／P70／P90、至少 252 筆門檻、普通股日 K 適用性，以及禁止同業／產業本益比的產品邊界。
- 將免費來源背景回補接入原變更 `add-taiwan-stock-pe-river-chart` 的剩餘實作與驗收流程，完成真實首次回補後才能進行正式 Sites 發布。

## Capabilities

### New Capabilities

- `free-pe-river-data-pipeline`: 規範免費歷史 seed、官方每日快照、來源交叉驗證、D1 actual coverage、耐久背景回補、最新資料排程、免費額度、授權標示與安全失敗行為。

### Modified Capabilities

無。

## Impact

- Worker／資料層：`worker/taiwan-stock-pe-river.ts`、`worker/app.ts`、D1 repository、job／checkpoint／health 與來源 adapter。
- 自動化：新增或沿用私有 GitHub Actions workflow，排程補足使用中商品的缺口與最新交易日，並透過既有安全 ingest 邊界分批寫入。
- API／前端：河流圖 response 的 `sources`、`warnings`、`coverage`、`backfill`、attribution 與安全狀態文案。
- 測試：FinMind 五年回覆 fixture、TWSE／TPEx OpenAPI fixture、重疊核對、限流、續跑、每日排程、無 panel 流量更新及正式 browser 驗收。
- 授權與安全：零資料費，但必須遵守政府資料顯名義務與 FinMind 服務使用範圍；不得寫入帳號、密碼、token、cookie、憑證或其他秘密值。
