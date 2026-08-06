# 台股本益比河流圖免費資料來源查核（2026-07-22）

## 結論

- TWSE 與 TPEx 均提供官方個股本益比資料；TWSE 說明本益比為「收盤價 ÷ 每股參考稅後純益」，並以當時已申報的近滿四季格式化財報計算，不回溯套用後來資料。
- TWSE `BWIBBU` 與 `STOCK_DAY` 歷史頁面回應，以及 TPEx `peQryStock` 歷史頁面回應，已實測可取得欄位名稱與日期格式；fixtures 僅保留最小欄位及少量列，不含帳號、cookie、token 或其他秘密。
- TWSE 網站使用條款明定，未依同意方式不得用自動化程式下載網站資料；一般歷史頁面並非可直接視為允許批次回補的 OpenAPI。
- TWSE／TPEx OpenAPI 歡迎介接，但目前可驗證的本益比與收盤 OpenAPI 主要是當期資料，未確認能合法、穩定地回補逐檔五年歷史。
- 原本只靠交易所歷史頁面的 production backfill 維持 fail-closed；本次改採 FinMind 免費 `TaiwanStockPER`／`TaiwanStockPrice` 做五年 seed，並以交易所 OpenAPI 最新快照逐檔核對後才推進 verified coverage。
- 正式站仍限定 private／custom、owner-only。因 FinMind 使用條款頁需要 JavaScript 才能讀取，若站點改為公開、workspace-wide、商業使用或提供原始資料再散布，發布前必須重新取得明確授權結論並標示 `license_review_required`。

## 2026-07-22 免費來源實測

| 來源 | 實測結果 | 管線用途 |
| --- | --- | --- |
| FinMind `TaiwanStockPER` | 匿名 API 對 `2330`、`8069` 可依 `start_date`／`end_date` 取得 `date`、`stock_id`、`PER`；`2330` 最近值到 2026-07-22 | 五年歷史 P/E seed |
| FinMind `TaiwanStockPrice` | 同商品、同範圍可取得 `date`、`stock_id`、`close`；不得依兩個 dataset 的列序直接配對 | 五年歷史收盤 seed |
| TWSE `BWIBBU_d` | 市場全量，欄位為 `Date`、`Code`、`ClosePrice`、`PEratio`、`FiscalYearQuarter`；實測 `2330` source date 為 2026-07-21 | 上市最新官方 row 與 overlap gate |
| TWSE `STOCK_DAY_ALL` | 市場全量，提供 `ClosingPrice`；source date 同為 2026-07-21 | TWSE 收盤交叉診斷 |
| TPEx `tpex_mainboard_peratio_analysis` | 市場全量，欄位為 `Date`、`SecuritiesCompanyCode`、`PriceEarningRatio`；`8069` source date 為 2026-07-22 | 上櫃最新官方 P/E |
| TPEx `tpex_mainboard_quotes` | 市場全量，欄位為 `Date`、`SecuritiesCompanyCode`、`Close`；`8069` 2026-07-22 收盤 194.50。正式 Sites 改採此約 0.36 MB 的官方資料集，避免 `tpex_mainboard_daily_close_quotes` 約 3.95 MB payload 在雲端出口逾時 | 上櫃最新官方收盤 |

FinMind `2330` 在 2026-07-21 的 P/E 32.40、收盤 2410，與 TWSE `BWIBBU_d` 完全一致；`8069` 在 2026-07-22 的 P/E 20.20、收盤 194.50，與 TPEx 兩個 OpenAPI 完全一致。promotion gate 對 P/E 與收盤各採 absolute difference `0.01`。超過容許即為 `source_mismatch`，保留既有 verified D1，不輸出上游 body。

TWSE 在本次查核時落後 FinMind 一個交易日，而 TPEx 已發布當日資料。這是真實的 `official_not_published` 情境：系統必須保存各市場實際 `sourceDate`，由 19:30 與 23:30（Asia/Taipei）兩個盤後窗口重試，不得以 FinMind 日期、K 線日期或執行日期冒充官方 coverage。

## 2026-07-23 最新日暫代與官方追認邊界

- 正式背景流程仍先呼叫 TWSE `BWIBBU_d`／TPEx OpenAPI；只有官方 `sourceDate` 落後，且 FinMind `TaiwanStockPER`／`TaiwanStockPrice` 對較新的相同商品、相同 `sessionDate` 都提供有限正數時，才建立 `finmind_provisional_latest`。
- 暫代 latest request 只從官方實際日期查至 Asia/Taipei 當日，最長 14 個日曆日；單一商品最多顯示三個 completed sessions。當日 row 在 Asia/Taipei 18:30 前不得採用，避免手動 workflow 把盤中資料誤認為收盤完成值。
- 系統分開保存 `verifiedEnd` 與 `displayEnd`。provisional P/E 不進入五年 P10／P30／P50／P70／P90 樣本、不補足 252 筆門檻，也不推進 official coverage；它只以 `finmindClose / finmindPER` 算出暫定參考 EPS，再套用既有 verified multiplier 延伸價格座標。
- 官方 OpenAPI 到齊後，核對相同 market／symbol／date 的 P/E 與 close；兩項 absolute difference 都不超過 `0.01` 才記為來源相符。reference EPS 是核對後重算的衍生值，不是第三個獨立比對欄位。
- 若超過 `0.01`，可見 row 仍立即改用權威官方值，但 fetch state 記錄 `source_mismatch` 並 quarantine 該商品後續 FinMind 暫代；不得用 FinMind 覆蓋官方或自動放寬誤差。
- provisional latest feature gate 預設關閉，只能由 Sites runtime 的 `PE_RIVER_PROVISIONAL_LATEST_ENABLED=true` 啟用；前端不能改寫。若存取模式不再是 private／custom 非商業，既有 `license_review_required` gate 仍優先阻擋。
- TWSE／TPEx 一般指定日期查詢頁面不在允許來源清單。即使網頁已出現較新資料，production workflow 也不得自動呼叫、解析或爬取；本變更不新增 Data E-Shop、MOPS 重建 EPS 或其他第三方 fallback。

## 免費額度、再利用與 fail-closed 邊界

- FinMind 官方 `llms.txt`（2026-07-22 查核）列示：有 token 每小時 600 requests、無 token 每小時 300 requests；本管線不要求帳號或 token，並以 D1 全域 `240 requests/hour` 作為安全上限。
- 每個新商品只對 `TaiwanStockPER` 與 `TaiwanStockPrice` 各發一個五年 bounded range request；每次 workflow 最多 8 個 history targets，最多使用 16 個主要 FinMind requests。
- HTTP 402 代表額度用盡；402／429／retryable 5xx／timeout 只保存 allowlist reason code 與 next retry，不 busy loop、不重抓已完成 dataset／month checkpoint。
- 本站 API 只服務河流圖的衍生倍率、河流 points、coverage 與 pointed-date readout，不提供通用 FinMind 五年 raw dump、下載端點、轉售或鏡像服務。
- 政府資料開放授權條款第 1 版允許免授權金製作衍生物，但顯名是必要條件；UI 與 API 必須標示臺灣證券交易所或證券櫃檯買賣中心，另標示「歷史資料介接：FinMind」。
- FinMind SPA 使用條款或方案內容若無法在部署前重新驗證、資料集改為非 Free、匿名額度降低，或存取模式不再是 private／custom 非商業，管線一律 fail closed，不改抓交易所一般歷史頁面或不明第三方。

## 實測端點與欄位

| 市場 | 用途 | 實測端點 | 必要欄位 | 日期格式 |
| --- | --- | --- | --- | --- |
| TWSE | 個股月本益比 | `/rwd/zh/afterTrading/BWIBBU?date=YYYYMM01&stockNo=CODE&response=json` | 日期、本益比、財報年/季 | 民國年 `YYY/MM/DD` |
| TWSE | 個股月收盤 | `/rwd/zh/afterTrading/STOCK_DAY?date=YYYYMM01&stockNo=CODE&response=json` | 日期、收盤價 | 民國年 `YYY/MM/DD` |
| TPEx | 個股月本益比 | `/www/zh-tw/afterTrading/peQryStock?date=YYYY/MM/DD&code=CODE&response=json` | 日期、本益比、財報年/季 | 民國年或西元年斜線格式 |
| TPEx | 每日收盤 | 官方每日收盤資料／授權 mirror | 日期、代號、收盤 | 民國年或西元年斜線格式 |

Parser 以欄位名稱尋找 table，不依賴 table index 或欄位順序。數字空白、`-`、零、負數與非有限值一律保留缺口；收盤與本益比須同市場、同代號、同交易日才能配對。

## 歷史範圍與揭示

- TWSE 個股日本益比頁面標示自民國 94 年 9 月 1 日提供；財報年／季自民國 106 年 4 月 12 日提供。
- 河流圖只要求最近五年；實際 coverage 以 D1 已有最早／最晚有效交易日揭示，不以 requested end 偽造 source coverage。
- 可見 UI 與 API attribution 使用「臺灣證券交易所」或「證券櫃檯買賣中心」，並固定揭示「歷史估值位置，不是合理價或投資建議」。

## 官方依據

- TWSE 個股日本益比說明：<https://accessibility.twse.com.tw/zh/trading/historical/bwibbu.html>
- TWSE 使用條款：<https://accessibility.twse.com.tw/zh/terms/use.html>
- TWSE OpenAPI：<https://openapi.twse.com.tw/>
- TPEx OpenAPI：<https://www.tpex.org.tw/openapi/>
- FinMind 官方 API 說明：<https://finmindtrade.com/llms.txt>
- FinMind 完整 dataset 說明：<https://finmindtrade.com/llms-full.txt>
- 政府資料開放授權條款第 1 版：<https://data.gov.tw/license>
