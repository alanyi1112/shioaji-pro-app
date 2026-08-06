# 台股個股籌碼免費資料源核對（2026-07-15）

## 結論

- 歷史日資料以 FinMind v4 Data API 為第一版主要來源；匿名額度為每小時 300 次，註冊並驗證信箱後使用 token 為每小時 600 次。token 只允許放在 Sites runtime 的 `FINMIND_API_TOKEN`，並以 `Authorization: Bearer` 傳送。
- TWSE／TPEx 官方 OpenAPI 用於最新快照、欄位語意核對與可用時補強；不把官方一般查詢頁或需要模擬瀏覽器的端點當正式資料鏈。
- TDCC `GET /v1/opendata/1-5` 是每週全市場最新股權分散快照。證券代號可能含尾端空白，資料日期欄位可能含 BOM，adapter 必須依正規化欄名解析。
- 八大行庫、券商分點與未明確開放自動介接的歷史報表不在本次範圍。

## 來源與欄位

| 資料族群 | 免費來源 | 頻率／覆蓋 | 第一版策略 |
| --- | --- | --- | --- |
| 法人買賣超 | FinMind `TaiwanStockInstitutionalInvestorsBuySell`；TPEx `/tpex_3insti_daily_trading` | FinMind 可依個股日期範圍查詢；TPEx OpenAPI 為最新快照 | 歷史使用 FinMind；TPEx 最新資料以官方欄名解析及核對 |
| 外資持股 | FinMind `TaiwanStockShareholding`；TPEx `/tpex_3insti_qfii` | FinMind 可依個股日期範圍查詢；TPEx OpenAPI 為最新排行快照 | 歷史使用 FinMind；不推算投信／自營商持股 |
| 融資融券 | FinMind `TaiwanStockMarginPurchaseShortSale`；TWSE `/exchangeReport/MI_MARGN`；TPEx `/tpex_mainboard_margin_balance` | FinMind 為歷史日資料；交易所 OpenAPI 為最新快照 | 內部統一成 lot 欄位並保存原始單位 |
| 借券 | FinMind `TaiwanStockSecuritiesLending`；TWSE `/SBL/TWT96U`；TPEx `/tpex_margin_sbl` | FinMind 明確提供借券成交明細；TWSE OpenAPI 為可借券賣出量；TPEx OpenAPI另含借券／借券賣出餘額 | 只呈現來源實際提供欄位；第一版上市歷史餘額可為 `null` |
| 股權分散 | TDCC `/v1/opendata/1-5` | 每週全市場最新快照；TDCC 個股查詢頁說明歷史保存一年 | 每週抓一次全市場快照並存 D1；不爬個股查詢頁回補 |

## 欄位與單位注意事項

- FinMind 法人資料以 `buy`、`sell` 股數及 `name` 類別回傳；`Dealer_self` 與 `Dealer_Hedging` 分開保存，自營商合計只在兩者皆有效時相加。
- FinMind 融資融券欄位及 TWSE／TPEx 官方融資融券快照以交易單位（張）表達；D1/API 使用 `Lots` 命名，避免誤當股數。
- FinMind 借券 `volume` 依 API 欄位保存為成交股數 `transactionShares`，顯示層才除以 1,000 轉為張；不以融券欄位替代。
- TDCC 分級 1 至 15 才能參與門檻加總；16 為差異數調整、17 為合計，只供驗證。
- TDCC 預設散戶為分級 1 至 3（1 至 10,000 股），預設大戶為分級 15（1,000,001 股以上）。
- `0` 只代表來源明確發布零值；缺欄位、未發布與不適用使用 `null`。

## 介接與授權邊界

- [TWSE OpenAPI](https://openapi.twse.com.tw/) 公開 Swagger 並表示歡迎介接。
- [TPEx OpenAPI](https://www.tpex.org.tw/openapi/) 公開 Swagger 並表示歡迎介接。
- [TDCC OpenAPI](https://openapi-t.tdcc.com.tw/) 提供股務開放資料；正式端點為 `https://openapi.tdcc.com.tw/v1/opendata/1-5`。
- [TDCC 集保戶股權分散表](https://www.tdcc.com.tw/portal/zh/smWeb/qryStock) 說明資料按每週最後營業日、經 ID 歸戶後編製，個股查詢歷史保存一年。
- [FinMind Quick Start](https://finmind.github.io/quickstart/) 說明 v4 Data API 與匿名／token 額度。
- [FinMind 登入說明](https://finmind.github.io/login/) 說明官網登入後由使用者資訊頁取得 API token，並以 Bearer header 使用。

## 發布時點與 fallback

- 以上資料皆視為盤後日頻或每週資料，不作盤中即時承諾。
- 最新交易日尚未發布時回傳 `not_published`／`partial_data`，不得以前一日值補成當日。
- TPEx 最新法人 OpenAPI 未提供自營商自行買賣／避險拆分時，只回傳可證明的外資、投信與來源總計，三大法人合計維持 `null`，不把自營商合計冒充分項。
- 上游回傳 402／429、timeout 或格式錯誤時，若 D1 有最近成功資料則回傳 `stale_cache`；完全無資料才標示 `provider_unavailable`。
- 正式部署前重新抽查 `.TW` 與 `.TWO` 代表個股的欄名、資料日期及單位。

## 2026-07-15 本機容量與負載實測

- Miniflare D1 已累積 15 檔、2,423 筆日資料（2025-11-12 至 2026-07-15）；日資料 table 約 3.47 MiB、索引約 72 KiB，平均約 1.5 KiB／row（含 SQLite page overhead）。
- 依此保守外推，單一個股 2,600 筆約 3.9 MiB，100 檔完整十年資料約 390 MiB；因此第一版維持使用者實際查詢才回補，不做全市場日資料排程，後續依正式 D1 用量再訂 retention／壓縮策略。
- 週快照已保存 16 檔、16 筆，table 與索引合計約 40 KiB；日／週查詢的 `EXPLAIN QUERY PLAN` 都命中 `(symbol, date)` 索引。
- 3-panel × 10 pane 可同時建立 30 個 pane；三個 panel 的捲動區均維持 330 px 高，內容高度約 1,545 至 1,574 px 並使用 panel 內垂直捲動。4／6／8 圖固定 A，故第一版不另設 B 勾選上限。
