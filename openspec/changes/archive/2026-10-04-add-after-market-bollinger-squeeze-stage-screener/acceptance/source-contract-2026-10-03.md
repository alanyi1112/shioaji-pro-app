# 2026-10-03 官方來源前置查證

所有時段以 Asia/Taipei 解讀。本紀錄是本輪人工唯讀查證，不是排程 run、全市場回補或正式發布收據。

## 已確認：TWSE 指定日期日報

- URL：`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20261002&type=ALLBUT0999&response=json`
- 取得時間：`2026-10-03T02:50:54.022Z`（台北 10:50:54）。
- HTTP 200、`stat=OK`、`date=20261002`；回應 247,435 bytes。
- SHA-256：`cecf0d4e4ad34cf1c6068177ba5219afe88ec685e1c236f81ca5f56ea5d7a6ab`。
- 每日收盤行情表 1,380 列（包含非普通股，不能當成本策略普通股母體計數）。
- 實際欄位：`證券代號`、`成交股數`、`成交金額`、`開盤價`、`最高價`、`最低價`、`收盤價`。大盤統計同回應明示 `成交金額(元)`／`成交股數(股)`。
- 2449 京元電子：成交股數 `13,902,351`、成交金額 `4,107,551,351`；收盤 `295.50`。來源金額不是收盤價乘成交量，不能以兩者互相替代。
- 這次僅確認回應契約與代表列，不是 160 日全市場完整性或新 mapping ready 證據；完整 payload 未寫入產品資料庫。

## 未通過：TPEx 真實回應

- 指定日期入口：`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F10%2F02&id=&response=json`。
- Node 原始結果：`fetch failed`；以 curl 核對得到 `curl: (56) Recv failure: Connection reset by peer`，沒有可驗證的 JSON body。
- 官方最新日 OpenAPI `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` 亦得到 `terminated`、cause=`ECONNRESET`。
- 沒有用最新日資料冒充指定日期、沒有換第三方來源或停用 TLS 驗證，沒有無界重試。
- 專案既有 parser 使用 `成交金額(元)`，但不能把舊程式或 fixture 當作本次真實欄位／單位驗證。
- 原錯誤保留；task 1.1 維持未完成，正式 mapping 與發布保持未啟用。

## 授權／使用範圍：已確認與仍待核實分開

- [上市個股日成交資訊資料集](https://data.gov.tw/dataset/11549)及[上櫃股票行情資料集](https://data.gov.tw/dataset/11370)列出成交金額、每日更新、免費與政府資料開放授權條款第 1 版。
- 上述資料集連結 OpenAPI／開放 CSV，不能逕自推論所有指定日期網站入口的歷史擷取及對外展示權也已核實。[TWSE 網站使用條款](https://wwwc.twse.com.tw/zh/terms/use.html)另列政府資料開放例外與其他網站資料的使用限制。
- 啟用 task 3.2–3.3／4.1 正式下載與發布前，仍須核實指定日期入口的適用範圍及 TPEx 真實回應；未成立不新增付費來源、不公開發布資料。

## 本輪安全邊界

僅官方公開資料唯讀查證與隔離公式測試；沒有 broker login／subscription、production、委託、服務重啟、原收據改寫或交易資料變更。

## 接續階段唯讀重查（2026-10-03）

接續實作時對同一 TPEx 指定日期 URL 做一次 `curl --max-time 12 --retry 0`，仍得到原始 `curl: (56) Recv failure: Connection reset by peer`、HTTP `000`、下載 `0 bytes`。未停用 TLS 驗證，未代理或繞過來源限制。此次請求沒有可驗證的 response body，task 1.1 仍未完成。

另用新增「一次呼叫一次 request」的官方 HTTPS transport，採既有 collector 相同的 TPEx TLS1.2 設定及 12 秒有界 abort signal，再做一次唯讀查證；得到 `name=Error`、`message=read ECONNRESET`、`code=ECONNRESET`。沒有 response 可供欄位／日期查證；未啟用正式匯入，亦沒有將傳輸設定修改宣稱成來源問題已解決。

新增準備器要求兩市場都有有效且涵蓋 `local-historical-screener` 用途的 verified source review，才接受匯入。現在沒有為真實來源建立此 review；測試中的 review 全部是隔離 fixture，不可作正式下載／發布授權。新 migration 僅寫成程式檔並在記憶體 SQLite 測試，未安裝到正在運作的資料庫。
