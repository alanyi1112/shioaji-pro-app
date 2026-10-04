# Shioaji 每日行情備援可行性（2026-10-03）

## 範圍與判定

本檔整理前一輪同日實際執行的兩次唯讀探測，不是新 scheduler receipt。結果證明既有 API 可取得兩個指定日期的每日行情，可規劃日期批次備援；**尚未完成正式來源 review、160 日逐商品覆蓋、自動下載或發布驗收**。本輪只更新 OpenSpec artifacts，未再次查行情或啟用策略。

沿用既有 simulation 連線，未新增 broker login／subscription、寫入行情 DB、啟用 production、重啟服務、archive、commit 或 push。未保存大型原始 payload 至 repo，以下為可核對的摘要與 hash，不能冒稱仍有完整 raw payload 可重播。

## 已確認契約

本機 `/openapi.json` 顯示 API 1.7.1，提供 `POST /api/v1/data/daily_quotes`。請求明確使用 `date` 與 `exclude=true`；回應為 `Date`、`Code`、`Open`、`High`、`Low`、`Close`、`Volume`、`Transaction`、`Amount` 九組 column arrays。量／金額／筆數 schema 為 int64，價格為 double。沒有市場欄位，且排除權證不等於只含普通股。

來源文件：[Shioaji 官方每日行情參考](https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/MARKET_DATA.md#daily-quotes-每日行情)、[歷史資料](https://sinotrade.github.io/tutor/market_data/historical/)、[用量限制](https://sinotrade.github.io/tutor/limit/)。文件與 API 入口存在不能代替本機使用／展示權利、單位與逐商品覆蓋的正式 review。

## 兩次實際 response

兩次 sequential POST，各設 15 秒 timeout／2 MiB response 上限，不另登入，不重試。

| 請求資料日 | 實際開始（Asia/Taipei） | HTTP | JSON bytes | 九欄長度 | Date 核對 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-02 | 2026-10-03 14:52:17.134 | 200 | 121,855 | 各 1,982 | 全部 2026-10-02 |
| 2026-02-02 | 2026-10-03 14:52:17.351 | 200 | 120,412 | 各 1,955 | 全部 2026-02-02 |

payload SHA-256：

- 10/2：`4edd49d20a463219ee40d455c51e1c81e3ad2a5b0c78fb1a56a3b1818ce83c1e`
- 2/2：`555256a6647dfb05c8a0f0bcc34d91489611d55ceb016eb40341c84cf3f19cd8`

row count 包含非普通股，不能當策略母體或雙市場完整覆蓋證據。

### 10/2 代表商品

| Code | Open | High | Low | Close | Volume（原值） | Transaction | Amount（原值） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2449 | 295.5 | 298 | 292 | 295.5 | 13,902,351 | 19,519 | 4,107,551,351 |
| 2330 | 2505 | 2515 | 2495 | 2500 | 15,792,206 | 65,783 | 39,508,159,297 |
| 6488 | 1090 | 1190 | 1075 | 1190 | 16,255,922 | 30,486 | 18,622,066,280 |
| 6510 | 3000 | 3120 | 3000 | 3070 | 574,903 | 3,596 | 1,760,085,005 |

2449 的 Volume、Amount、Close 與先前已取得 TWSE 10/2 日報相符；此樣本支持 Volume 為股、Amount 為實際 TWD 金額。不能據此宣稱所有列或上櫃已跨來源完全一致，也不能沿用 KBars 的張數 mapping 乘 1,000。

### 2/2 代表商品

| Code | Open | High | Low | Close | Volume（原值） | Transaction | Amount（原值） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2449 | 289.5 | 293.5 | 280 | 285 | 17,191,140 | 27,048 | 4,908,944,906 |
| 2330 | 1750 | 1765 | 1745 | 1765 | 33,342,358 | 227,693 | 58,467,099,660 |
| 6488 | 495 | 497 | 467 | 473 | 5,676,322 | 9,790 | 2,721,453,490 |
| 6510 | 3295 | 3450 | 3280 | 3435 | 835,873 | 2,016 | 2,834,391,415 |

## 用量觀察與限制

- 前後 usage connections 都是 1；limit 為 524,288,000 bytes。
- 前：已用 5,194,388，剩餘 519,093,612 bytes。
- 後：已用 5,456,343，剩餘 518,831,657 bytes。
- 觀察差額為 261,955 bytes；同期共用服務仍運作，不能全部歸因於兩次請求。兩次 JSON 合計 242,267 bytes，與 usage 差額分開。
- 依樣本推估 160 日期 JSON 約 19.4 MB，僅為規劃估算；不是 broker 扣量保證，也不是許可立即下載。必須依實測、集中 reservation、可設定額度及行情保留預算 admission。

## 成功／未完成分開

成功：現有連線能回覆兩日期合法九欄結構，含上市／上櫃代表代碼及實際量／金額，2449 最新日有官方對照樣本。

未完成／unknown：完整 160 日期與逐商品連續性、雙市場完整母體、歷史價格／交易範圍相容性、零成交／停牌終態、int64 無損 parser、使用／展示限制 review、集中流量 admission、正式 fallback／自動發布與 UI。官方 TPEx 日期入口及日曆先前失敗仍原樣保留，行情備援不能解除共同日曆缺口。

對應新增 tasks 8.1–8.8，全部保持未勾；原 tasks 1.1／7.2–7.4 亦未因本探測完成。
