# 台股日 K 連續性官方來源契約

## 實測日期與原則

- 實測日期：2026-08-28（Asia/Taipei）。
- 只使用 TWSE／TPEx 官方公開端點，不需要帳號、token 或其他秘密。
- Yahoo 保留為大量歷史種子；只有官方月資料中實際存在的商品日 row 才能證明某日應有 candle。
- 一般平日只用來找「候選缺口」。候選日期必須再經商品官方月資料確認；官方明確沒有 row 時不得補造 candle。

## TWSE 上市個股月資料

- URL：`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=YYYYMM01&stockNo=CODE&response=json`
- 成功條件：HTTP 200、`stat="OK"`、`date` 對應要求月份、`fields` 與 `data` 可依欄位名稱對齊。
- 大立光 2026 年 8 月實測欄位：`日期`、`成交股數`、`成交金額`、`開盤價`、`最高價`、`最低價`、`收盤價`、`漲跌價差`、`成交筆數`、`註記`。
- `日期` 使用民國年；價格含逗號與小數；`成交股數` 單位為股。正規化後 history volume 先保存股數，再由既有台股 volume contract 轉為張。
- 大立光實測 20 rows，response 約 3 KB，單次約 0.18 秒。

## TPEx 上櫃個股月資料

- URL：`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=CODE&date=YYYY/MM/01&id=&response=json`
- 成功條件：HTTP 200、`stat="ok"`、top-level `date`／`code` 與要求一致，從 `tables` 中以 `title="個股日成交資訊"` 或必要欄位名稱選取 table。
- 元太 `8069` 2026 年 8 月實測欄位：`日 期`、`成交張數`、`成交仟元`、`開盤`、`最高`、`最低`、`收盤`、`漲跌`、`筆數`。
- `日 期` 使用民國年；價格含逗號與小數；`成交張數` 單位為張，正規化成 history 前必須乘以 1,000 轉為股，避免重複除以 1,000。
- 元太實測 20 rows，response 約 2.3 KB，單次約 0.08 秒。舊 `st43_result.php` 約 9.9 KB，只保留為人工診斷，不作 Worker parser fallback。

## 停牌與 fallback

- TPEx `https://www.tpex.org.tw/openapi/v1/tpex_spendi_history` 可提供歷史暫停／恢復交易證據；實測 top-level 為陣列，包含 `SecuritiesCompanyCode`、`DateOfSuspendedTrading` 與 `DateOfResumedTrading`。
- 上市／上櫃商品月資料如果在候選日期沒有 row，continuity 不得自行建立 candle；能以停牌或上市日期證明時保存具體排除原因，否則保存 `official_no_row`。
- TPEx 歷史月端點失敗時不使用只含最新收盤的 mirror 冒充歷史 OHLCV；狀態維持 `unknown`。既有 mirror／TWSE MIS 仍可依原契約作最新收盤核對 fallback。

## 請求預算與錯誤契約

- on-demand：只查含候選缺口的月份，每檔、每次最多新增 6 個未快取的官方月請求；超過預算維持 `unknown` 並標示 `audit_request_budget`。後續稽核先重用成功月快取，再從尚未核對月份續跑，直到可證明 `complete`，不得因單次預算宣稱完整。
- batch：每輪最多 8 檔啟用台股商品、官方請求 concurrency 2；後續以 cursor 續跑。
- timeout：單一官方 GET 8 秒；HTTP 429、5xx 或 timeout 每個 key 最多重試 1 次，使用短暫退避；解析失敗不重試。
- 成功 cache：同 exchange／symbol／month 6 小時；`reference_not_published` 5 分鐘；provider failure 60 秒。相同 key 使用 single-flight。
- API 只公開安全 reason code、核對日期、scope 與缺口欄位，不回傳完整官方原始 response 或內部錯誤。

## Workers 相容性

- Adapter 只使用標準 `fetch`、`URL`、`AbortController`、`Intl` 與純 TypeScript parser，不使用 Node-only module。
- unit／Worker integration 以固定 fixture 驗證 parser、timeout、cache、single-flight 與錯誤分類；正式 runtime 可達性必須在另行取得部署授權後重查。
