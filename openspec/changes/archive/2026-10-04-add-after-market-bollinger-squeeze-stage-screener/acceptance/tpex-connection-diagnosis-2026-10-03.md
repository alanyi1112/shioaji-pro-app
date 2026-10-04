# 2026-10-03 TPEx 連線分層查證與錯誤紀錄補強

本紀錄接續使用者「先解決 TPEx 的連線問題」。時間使用 Asia/Taipei；這是人工唯讀來源查證，不是正式排程、歷史匯入或每日發布收據。原 [來源前置查證](source-contract-2026-10-03.md) 的失敗結果保留，不以本次部分成功覆寫。

## 結論：最新日入口可用，指定日期入口仍未恢復

- 最新日官方 OpenAPI 本輪以 curl 與 Node 原生 HTTPS 都取得 HTTP 200、完整且合法 JSON。這否定「TPEx 全站都無法連線」，但不等於指定日期歷史來源已恢復。
- 指定日期日報與年度日曆入口仍在送出 HTTP 請求後重設連線，未取得 HTTP status 或 response body。
- 一般 Chrome 開啟官方行情頁也得到該日報 API 查詢錯誤。不能只將問題歸因於本產品的 GET 方法或 TLS 設定。
- 遠端服務故障、網路路徑問題或來源政策限制的最終原因，沒有足夠證據可判定。本輪沒有停用憑證驗證、改 DNS／代理／防火牆、繞過存取限制或購買來源。
- task 1.1／7.2／7.3／7.4 保持未完成，整體仍為 29／33；每日策略仍停用，沒有啟用正式下載或發布。

## 分層證據

### DNS、TCP 與 TLS

- 系統 DNS 可解析 `www.tpex.org.tw`，本輪回應的 IPv4 包含 `203.74.185.130`、`218.210.125.130`、`210.63.162.130`。這些是觀察值，沒有寫死到程式或 hosts。
- TCP 與 TLS 握手成功；協商 TLS1.2，主機名／憑證驗證成功。curl 觀察到 CN 為 `www.tpex.org.tw`，簽發者 TWCA SSLCA，憑證期限 2026-09-07 至 2027-03-24。
- HTTP 請求送出之後，指定日期入口得到 `curl: (56) Recv failure: Connection reset by peer` 或 Node `read ECONNRESET`；HTTP `000`、body `0 bytes`。HTTP `000` 是 curl 未取得狀態碼，不是伺服器回傳的狀態碼。
- 另以 Node 預設 TLS 協商核對同一日報／日曆，仍為 TLS1.2／authorized=true 後 `ECONNRESET`。HTTP/2 協商沒有取得 h2，未將此不支援情況冒充回應失敗的根因。
- 常見 proxy 與 TLS 環境變數僅檢查是否存在，未輸出任何秘密值；本輪皆未設定。

### 指定日期與官方網頁請求方式

- 日報 URL：`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F10%2F02&id=&response=json`。
- 日曆 URL：`https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate?date=2026`。
- 讀取官方 `tables.js`／`main.js` 確認官方頁面使用 `/www/{LANG}/{ACTION}`、中文路徑 `zh-tw`、`afterTrading/dailyQuotes` 與 `$.post(..., 'json')`；CSV 按鈕亦使用同一 action 的 GET query。
- 核對 GET 的日期編碼／未編碼形式、POST 的日期 form，以及官方頁面 AJAX 使用的 Referer／Origin／Accept／X-Requested-With，仍未取得合法 response。每個檢查都有逾時上限，沒有隱藏重試。
- Chrome 官方頁 `https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html` 在 `2026-10-03T05:26:50.399Z`（台北 13:26:50）記錄 error：` in /www/zh-tw/afterTrading/dailyQuotes`，畫面沒有日報資料。
- IAB 同頁另有 `ReferenceError: tables is not defined`（`2026-10-03T05:18:30.891Z`）；與 Chrome 的 API 查詢錯誤分開保留，不用 IAB 的 script 載入問題冒充遠端 API 根因。

### 最新日 OpenAPI 成功，不能當歷史 fallback

- URL：`https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes`。
- HTTP 200；完整 response `4,666,641 bytes`，SHA-256：`28ab13974843bd20a0c87d85a56074d5e17ea09eae077fbd3be3b3973d7f7a26`。
- 共 11,928 列，包含 ETF／權證等非普通股，不是本策略普通股母體數；全部 `Date=1151002`，對應 2026-10-02。
- 實際欄位包含 `Date`、`SecuritiesCompanyCode`、`Open`、`High`、`Low`、`Close`、`TradingShares`、`TransactionAmount`。
- 此入口沒有證明可查任意指定歷史日期。沒有把這份最新日 response 接成 160 日歷史 fallback、沒有正式匯入資料庫或建立 verified source review。

## 程式補強與修正後實際查證

`stock-screener-bollinger-source-fetch.mjs` 共用單次 HTTPS transport，保留原錯誤 cause，區分連線重設、DNS、TLS 驗證、逾時、中止及半份 body 中斷。失敗 evidence 僅保存版本、傳輸階段、白名單代碼、bytes、HTTP status、TLS protocol／authorized，不持久化任意原始錯誤訊息、headers 或憑證內容。

日報準備器與日曆 writer 將此 evidence 寫入新的失敗收據；既有 request 上限、租約、冷卻及 append-only receipt 不變。日曆對外仍回 `calendar_authority_pending`，詳細傳輸原因寫在收據，沒有更改既有 pending 契約。

修正後在 `2026-10-03T05:30:06.850Z`（台北 13:30:06）以專案支援的 Node 24 對上述 2026-10-02 日報做一次 12 秒有界請求，實際結果：

```json
{
  "reason": "source_connection_reset",
  "originalCode": "ECONNRESET",
  "transport": {
    "version": 1,
    "phase": "request_sent",
    "code": "ECONNRESET",
    "bytes": 0,
    "statusCode": null,
    "tlsProtocol": "TLSv1.2",
    "tlsAuthorized": true
  }
}
```

這是「診斷可歸因」的驗證，不是「歷史連線已修復」的驗證。

## 回歸、安全與下一步

- Node focused tests 43／43 通過：source transport、history preparation、publication／calendar。新增 5 項測試涵蓋錯誤分類、半份回應與收據／冷卻保留。
- Vitest 4 files／48 tests 通過：v8 公式、history、query、API。
- TypeScript 與本 change OpenSpec strict validation 通過；空白檢查通過。
- 新日曆測試首輪曾錯誤預期對外回傳詳細 reason，實際契約是 `calendar_authority_pending`；已改為分別檢查公共狀態與收據的 `source_connection_reset`，未放寬資料驗證。
- `8080／5173／5174` listener 仍為原 PID `1273／933／938`，未重啟任何共用服務，沒有 broker login／subscription／交易操作、正式 DB writer、archive、commit 或 push。
- 下一步須在有界冷卻後確認指定日期入口是否恢復；若長期不可用，另行確認可合法、自動化取得指定日期實際成交金額的官方替代來源契約，再調整 mapping。不能用只有最新日的 OpenAPI 宣稱 160 日準備已完成。
