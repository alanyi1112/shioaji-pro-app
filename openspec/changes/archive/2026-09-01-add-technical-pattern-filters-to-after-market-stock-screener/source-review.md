# TWSE／TPEx 全市場 OHLC 正式來源核對

## 核對時間與邊界

- 核對時間：2026-09-02 00:08（Asia/Taipei）。
- 只使用 TWSE、TPEx 與政府資料開放平臺公開來源；沒有使用 Yahoo、Shioaji Kbars、自選清單或既有 `candle_history` 補值。
- 原始回應只存於 `/private/tmp` 供當次唯讀核對，repo 只保存非敏感 SHA-256、日期、欄位與守恆結果。
- 最新批次的兩市場發布日期可能不同。v3 只能以兩市場都已實際發布的共同 session 為發布錨點，不得用請求時間重標日期。

## 正式來源、授權與自動化邊界

| 市場 | 最新全市場批次 | 歷史日期報表 | 授權與自動化邊界 |
| --- | --- | --- | --- |
| TWSE | `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` | `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=ALLBUT0999&response=json` | 政府資料開放平臺資料集 11549，政府資料開放授權條款第 1 版、免費、每日更新；OpenAPI 無需帳密。operator 仍須硬 timeout、有界重試、冷卻並遵守 HTTP `Retry-After`，403／CAPTCHA fail closed。 |
| TPEx | `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` | `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=YYYY%2FMM%2FDD&id=&response=json` | 政府資料開放平臺資料集 11371，政府資料開放授權條款第 1 版、免費、每日更新；OpenAPI 無需帳密。資料集含股票、權證、ETF、ETN，必須再與正式普通股名冊交集；operator 的 timeout／retry／cooldown／blocked 規則同上。 |

兩個來源都是未調整的官方盤後成交行情列；本 change 不把它們描述為還原權息價，也不與不同價格基礎混接。TWSE 歷史報表使用「全部（不含權證、牛熊證、可展延牛熊證）」；TPEx 歷史報表含「上櫃股票行情」與「管理股票」兩張同 schema 表，最後仍以普通股 universe 過濾。

## 實際欄位 mapping

| 市場／模式 | 日期 | 代號 | Open | High | Low | Close |
| --- | --- | --- | --- | --- | --- | --- |
| TWSE latest | `Date` | `Code` | `OpeningPrice` | `HighestPrice` | `LowestPrice` | `ClosingPrice` |
| TPEx latest | `Date` | `SecuritiesCompanyCode` | `Open` | `High` | `Low` | `Close` |
| TWSE history | response `date` | `證券代號` | `開盤價` | `最高價` | `最低價` | `收盤價` |
| TPEx history | response `date` | `代號` | `開盤` | `最高` | `最低` | `收盤` |

歷史 parser 必須依完整欄名建立 index，不可依固定欄序；必須同時驗證 `stat`、requested date 等於 actual response `date`、正確市場 table 數、普通股 universe 與 OHLC 邊界。

## Latest 與 history 同日逐檔等價性

### TWSE：2026-08-31

- 公司名冊出表日與 latest actual date 均為 2026-08-31；latest 原始 1,377 列。
- 普通股母體 1,085；latest/history 都有 1,081 檔出現，其中 1,080 檔為合法 OHLC、1 檔四價空白。
- 1,080 檔合法交集逐檔比較 open／high／low／close：0 差異。
- 母體缺列 4 檔；另有 1538 正峰同時在 latest/history 出現，但四價皆空白，即使成交股數為 1、成交金額為 8，也不得造出 K 棒。
- SHA-256：latest `07c71656a12fcf8012405b375813f4080c372f7aebec2f2d446dfd10ec65fef5`；history `3a8d68c3e38f805a01befb362f96b76688727a520d8f1cb0a6519b5bd674c9dd`；universe `f34a09f6877e772c43a9a5e97da53efcdaa0d04f642ae7d06ddee6ca2c3b96df`。

### TPEx：2026-09-01

- 公司名冊出表日與 latest actual date 均為 2026-09-01；latest 原始 10,770 列，因資料集含非普通股，不可直接當母體。
- 普通股母體 890；latest/history 都有 888 檔出現，其中 865 檔為合法 OHLC、23 檔四價 `---`。
- 865 檔合法交集逐檔比較 open／high／low／close：0 差異。
- 母體缺列 2 檔；另有 23 檔的四價均為 `---`、成交量與成交值為 0，代表該 session 沒有合法 OHLC，保存 `missing_ohlcv`，不補 0、不沿用前收。
- SHA-256：latest `0cc19c39baad8537b74f20c00ca4c5aef41850e1616d2e3b3b918362b5016c0f`；history `e59a1ab0e83498e2784562a7b7dad56dce948e1df4ae3abe47b248bd07598f03`；universe `907aa66cf1c0f8a6be013ebcb58fd8787f472138d1801b2bc4961732f6529fa1`。

## 非交易日與 ignored-date 防護

- TWSE 請求 2026-08-30：回應沒有 `date`／`tables`，`stat=很抱歉，沒有符合條件的資料!`，SHA-256 `a5691b2512d7068ab2f69df75c3ef8fbc38dc565086422b1602656895c92c652`。
- TPEx 請求 2026-08-30：actual `date=20260830`、`stat=ok`，但兩張表都是 0 列，SHA-256 `e2d0556ba743bdc845c767d7deaa5c36d5480349a491b3519a73502f9e2536df`。
- 因此只有「requested date 與 actual date 相同、正確 schema table 存在、且 ordinary-universe coverage receipt 已形成」才算 collected。空表、回傳其他日期或格式漂移都不得接受。

## 60 個共同 session 基線

以 TWSE／TPEx 官方 2026 開休市日曆交集，並以兩市場都已實際發布的較舊 latest date 2026-08-31 截止，最新 60 個 session 為 2026-06-08 至 2026-08-31。日曆來源 hashes：

- TWSE：`7fefe785ea7155a5004a2eb74486ad865ea5c4b5f02ee0cffbbdacb1ca2ea390`
- TPEx：`c5cea6bd3a10bc7cd3e577d9ad78e600ae7d64508a1bc9b09be32fb396d0dc41`
- TDCC 週期錨點：`f191b2164ac2bfa0fd1b88153c6cc5a1d0f7cdaf1a5dfc6c524527898b11dce7`

代表商品：新上市 7855 和運租車（TWSE，2026-08-11）與 7814 海昌生技（TPEx，2026-07-16）；無合法四價代表為 1538 正峰與 2073 雄順。planner 必須依上市日只建立合法 session target；個股缺列是可解釋 unknown，市場整批未處理則阻擋 v3 發布。

## 臨時休市修正：2026-07-10

- annual／planned calendar baseline 曾包含 2026-07-10，但 full bootstrap 的兩個正式歷史報表共同否定該日：TWSE 回 `stat=很抱歉，沒有符合條件的資料!`，TPEx 回 requested date 的正確表結構但 0 筆股票行情；兩者都沒有形成任何 OHLC row。
- TWSE 官方重大訊息另載明 115 年 7 月 10 日受巴威颱風影響為非營業日，原定作業順延至 7 月 13 日：`https://www.twse.com.tw/zh/ETFortune/announcement?company=A00005&date=20260713&fund=ZZZZ&seq=1&type=all`。
- 因此 planner 不直接信任年度日曆可預見颱風休市；只有同一過去日期同時出現「TWSE no-data date response」與「TPEx empty report」的精確 failed receipt 組合，才排除該日並向前補足第 60 個 session。一側失敗、兩側 date mismatch、schema drift 或 transport failure 均不得自動排除。
- 修正後 60-session anchors 為 2026-06-08 至 2026-09-01，明確排除 2026-07-10；aggregate progress 重新守恆為 target 120、兩市場各 60。
